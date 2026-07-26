### Task 2: Extract `_buildOverlayCanvas` (behavior-preserving refactor)

**Files:**
- Modify: `MS/Engines/Briefing/BriefingEngine.ts`

**Interfaces:**
- Consumes: nothing new from Task 1 (this task is a pure internal refactor).
- Produces: `private _buildOverlayCanvas(slide: Slide): Promise<{ el: HTMLCanvasElement; canvas: any } | null>` — Task 3 depends on this exact signature (awaits it directly).

- [ ] **Step 1: Replace `_renderPresentOverlays` with the split version**

Find the current method (it starts right after the `_clearPresentOverlays` JSDoc comment block):

```ts
  private _renderPresentOverlays(slide: Slide): void {
    this._clearPresentOverlays();
    const fabric = (window as any).fabric;
    const v: any = this._view;
    const screenBg = this._isScreenOnly(slide) ? slide.backgroundDataUrl : undefined;
    if (!fabric || !v?.container || (!slide.overlays?.length && !screenBg)) return;
    const el = document.createElement('canvas');
    el.className = 'ms-briefing-overlay-canvas';
    v.container.appendChild(el);
    const sc = new fabric.StaticCanvas(el, { width: v.width, height: v.height });
    this._presentOverlay = { el, canvas: sc };

    // Map slides: overlays span the live view rect. Screen-only slides:
    // everything is normalized to the imported slide box — contain-fit it
    // (like the editor/exporter do) and offset the overlays into that rect.
    const draw = (fit: { x: number; y: number; w: number; h: number }) => {
      for (const o of slide.overlays ?? []) {
        const obj = overlayToFabric(o, fit.w, fit.h);
        if (!obj) continue;
        if (fit.x || fit.y) {
          obj.set({ left: (obj.left ?? 0) + fit.x, top: (obj.top ?? 0) + fit.y });
          obj.setCoords?.();
        }
        sc.add(obj);
      }
      sc.renderAll();
    };

    if (!screenBg) {
      draw({ x: 0, y: 0, w: v.width, h: v.height });
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (this._presentOverlay?.canvas !== sc) return; // slide changed meanwhile
      const iw = img.naturalWidth || 1;
      const ih = img.naturalHeight || 1;
      const scale = Math.min(v.width / iw, v.height / ih);
      const fit = {
        x: (v.width - iw * scale) / 2,
        y: (v.height - ih * scale) / 2,
        w: iw * scale,
        h: ih * scale,
      };
      sc.setBackgroundColor('#101418');
      sc.setBackgroundImage(
        new fabric.Image(img, { left: fit.x, top: fit.y, scaleX: scale, scaleY: scale }),
        () => draw(fit),
      );
    };
    img.onerror = () => draw({ x: 0, y: 0, w: v.width, h: v.height });
    img.src = screenBg;
  }
```

Replace it with:

```ts
  /**
   * Build a fully-rendered, DOM-attached overlay canvas for `slide` without
   * touching `_presentOverlay` — the caller decides what to do with the
   * result (assign it immediately, or crossfade into it). Resolves `null` on
   * the same early-outs the old inline version had (no fabric / nothing to
   * draw). Async because screen-only slides load their background image.
   */
  private _buildOverlayCanvas(
    slide: Slide,
  ): Promise<{ el: HTMLCanvasElement; canvas: any } | null> {
    const fabric = (window as any).fabric;
    const v: any = this._view;
    const screenBg = this._isScreenOnly(slide) ? slide.backgroundDataUrl : undefined;
    if (!fabric || !v?.container || (!slide.overlays?.length && !screenBg)) {
      return Promise.resolve(null);
    }
    const el = document.createElement('canvas');
    el.className = 'ms-briefing-overlay-canvas';
    v.container.appendChild(el);
    const sc = new fabric.StaticCanvas(el, { width: v.width, height: v.height });
    const handle = { el, canvas: sc };

    // Map slides: overlays span the live view rect. Screen-only slides:
    // everything is normalized to the imported slide box — contain-fit it
    // (like the editor/exporter do) and offset the overlays into that rect.
    const draw = (fit: { x: number; y: number; w: number; h: number }) => {
      for (const o of slide.overlays ?? []) {
        const obj = overlayToFabric(o, fit.w, fit.h);
        if (!obj) continue;
        if (fit.x || fit.y) {
          obj.set({ left: (obj.left ?? 0) + fit.x, top: (obj.top ?? 0) + fit.y });
          obj.setCoords?.();
        }
        sc.add(obj);
      }
      sc.renderAll();
    };

    if (!screenBg) {
      draw({ x: 0, y: 0, w: v.width, h: v.height });
      return Promise.resolve(handle);
    }
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const iw = img.naturalWidth || 1;
        const ih = img.naturalHeight || 1;
        const scale = Math.min(v.width / iw, v.height / ih);
        const fit = {
          x: (v.width - iw * scale) / 2,
          y: (v.height - ih * scale) / 2,
          w: iw * scale,
          h: ih * scale,
        };
        sc.setBackgroundColor('#101418');
        sc.setBackgroundImage(
          new fabric.Image(img, { left: fit.x, top: fit.y, scaleX: scale, scaleY: scale }),
          () => {
            draw(fit);
            resolve(handle);
          },
        );
      };
      img.onerror = () => {
        draw({ x: 0, y: 0, w: v.width, h: v.height });
        resolve(handle);
      };
      img.src = screenBg;
    });
  }

  /** Instant (non-animated) overlay swap — today's behavior, used whenever a transition doesn't apply. */
  private _renderPresentOverlays(slide: Slide): void {
    this._clearPresentOverlays();
    void this._buildOverlayCanvas(slide).then((handle) => {
      // goToSlide may have moved to a different slide while a background
      // image was loading — don't resurrect a stale frame over the wrong one.
      if (slide !== this._slides[this._current]) {
        if (handle) {
          try {
            handle.canvas.dispose();
          } catch {}
          handle.el.remove();
        }
        return;
      }
      this._presentOverlay = handle;
    });
  }
```

- [ ] **Step 2: Type-check**

Run: `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit`
Check lines mentioning `BriefingEngine.ts`. Expected: no new errors beyond pre-existing `TS2307` noise.

- [ ] **Step 3: Build**

Run: `vite build`
Expected: exits 0.

- [ ] **Step 4: Manual regression check**

Ask the user to open Present mode on a briefing containing at least one screen-only slide with overlays (an imported PPTX slide, or any slide edited in the Slide Editor with annotations) and confirm: the background image and annotations still appear exactly as before, Next/Prev still instantly swap between slides with no visual regression, and no extra canvases pile up in the DOM (devtools: `document.querySelectorAll('.ms-briefing-overlay-canvas').length` should read `1` while sitting on any slide, `0` outside Present mode).

---

