# Briefing Slide-View Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play a fade/push/wipe transition in Present mode when moving between two screen-only ("slide view") Briefing slides, while leaving map-based slide playback completely untouched.

**Architecture:** Extract the existing screen-only overlay-canvas builder into an awaitable helper, keep the outgoing overlay canvas alive alongside a freshly-built incoming one, and crossfade/slide/wipe between the two stacked DOM canvases with a TweenMax-driven state tween — the same animation pattern `_runFade`/`_runFlyIn`/`_runDrawOn` already use for build effects. A new optional `Slide.slideTransition` field (default absent = today's instant cut) drives it; a Sorter-tile `<select>` lets the user set it per slide.

**Tech Stack:** TypeScript, `@arcgis/core` (MapView/SceneView), bundled `window.TweenMax` (GSAP), bundled `window.fabric` (fabric.js `StaticCanvas`) — no new dependencies.

## Global Constraints

- **No new dependencies, no CDN.** Every library this feature touches (`TweenMax`, `fabric`) is already bundled/local and loaded exactly as today. Do not add any new `<script src="https://...">` or npm package — the user explicitly requires all JS/CSS to be local.
- **Scope boundary.** A transition plays only when both the outgoing and incoming slides are screen-only (`_isScreenOnly`: no `view.extent` and no `view.camera`) AND the incoming slide has `slideTransition` set AND Present mode is active. Every other case (map slide on either end, or no `slideTransition`) must behave byte-for-byte like it does today — an instant overlay swap, map slides still driven by `view.goTo`.
- **No automated test runner in this project.** There is no jest/vitest/etc. — verification per task is: (1) `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit` then grep the output down to the files this task touched, ignoring the ~3000 pre-existing `TS2307: Cannot find module '@arcgis/core/...'` errors (module-resolution noise unrelated to any change — see project memory `typecheck-baseline`); only new, non-`TS2307` errors matter. (2) `vite build` (NOT `npm run build` — that script's final `tsc` step always exits non-zero on this baseline and short-circuits anything chained after it with `&&`). (3) A manual GUI check, described per task, that the **user** performs in their own already-running dev server.
- **Never start the dev server yourself.** Do not call `preview_start`, `npm run dev`, or similar — the user runs it themselves. When a task needs GUI verification, describe exactly what to click/observe and ask the user to confirm it, rather than trying to drive a browser.
- **Do not commit.** Skip this skill's default per-task "commit" step — do not run `git add`/`git commit` unless the user explicitly asks for it in the moment. End each task by reporting the diff and verification results, and wait before moving on if executing inline.

---

### Task 1: Data model + public API

**Files:**
- Modify: `MS/Engines/Briefing/BriefingTypes.ts`
- Modify: `MS/Engines/Briefing/BriefingEngine.ts`

**Interfaces:**
- Produces: `SlideTransitionType` (exported type), `Slide.slideTransition?: SlideTransitionType`, `BriefingEngine.setSlideTransition(ref: number | string, type?: SlideTransitionType): void`. Tasks 2–4 depend on all three.

- [ ] **Step 1: Add `SlideTransitionType` to `BriefingTypes.ts`**

In `MS/Engines/Briefing/BriefingTypes.ts`, find:

```ts
export type BuildEffect = 'appear' | 'fade' | 'flyIn' | 'drawOn';
```

Replace with:

```ts
export type BuildEffect = 'appear' | 'fade' | 'flyIn' | 'drawOn';

/**
 * Present-mode transition played entering a screen-only ("slide view") slide
 * from another screen-only slide. Map-based slides never use this — their
 * view.goTo() pan/zoom is the transition.
 */
export type SlideTransitionType = 'fade' | 'pushLeft' | 'pushRight' | 'wipe';
```

- [ ] **Step 2: Add `slideTransition` to the `Slide` interface**

In the same file, find:

```ts
  /** goTo duration entering this slide (ms). */
  transitionMs: number;
```

Replace with:

```ts
  /** goTo duration entering this slide (ms). Also reused as the slideTransition duration. */
  transitionMs: number;
  /**
   * Present-mode transition played when both this slide and the one before it
   * are screen-only. Absent = the existing instant cut. See SlideTransitionType.
   */
  slideTransition?: SlideTransitionType;
```

- [ ] **Step 3: Import the new type in `BriefingEngine.ts`**

Find:

```ts
import type {
  BriefingDocument,
  BuildStep,
  CapturedViewState,
  Slide,
  SlideOverlay,
} from './BriefingTypes';
```

Replace with:

```ts
import type {
  BriefingDocument,
  BuildStep,
  CapturedViewState,
  Slide,
  SlideOverlay,
  SlideTransitionType,
} from './BriefingTypes';
```

- [ ] **Step 4: Add `setSlideTransition`**

In `BriefingEngine.ts`, find (this is `setSlideNotes`, right after `renameSlide`):

```ts
  public setSlideNotes(ref: number | string, notes: string): void {
    const idx = this._slideIndex(ref);
    if (idx >= 0) this._slides[idx].notes = notes;
  }
```

Replace with:

```ts
  public setSlideNotes(ref: number | string, notes: string): void {
    const idx = this._slideIndex(ref);
    if (idx >= 0) this._slides[idx].notes = notes;
  }

  public setSlideTransition(ref: number | string, type?: SlideTransitionType): void {
    const idx = this._slideIndex(ref);
    if (idx >= 0) this._slides[idx].slideTransition = type;
  }
```

- [ ] **Step 5: Type-check**

Run: `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit`
Then check only lines mentioning `BriefingTypes.ts` or `BriefingEngine.ts`. Expected: no new errors beyond pre-existing `TS2307` @arcgis/core noise.

- [ ] **Step 6: Build**

Run: `vite build`
Expected: exits 0, writes `dist/MS/**`.

- [ ] **Step 7: Manual smoke check**

Ask the user (in their running `npm run dev` session, browser devtools console, with at least one Briefing slide already captured) to run:

```js
window.briefingEngine.setSlideTransition(0, 'fade');
window.briefingEngine.getSlides()[0].slideTransition; // expect 'fade'
window.briefingEngine.setSlideTransition(0, undefined);
window.briefingEngine.getSlides()[0].slideTransition; // expect undefined
```

Confirm both return the expected values and nothing throws or changes on screen (this step wires the field but nothing reads it yet).

---

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
    const gen = this._overlayGeneration;
    void this._buildOverlayCanvas(slide)
      .then((handle) => {
        // Stale if the slide changed OR present mode/view was torn down while
        // the background image was loading (_clearPresentOverlays bumps the
        // generation on every call, including ones that don't touch _current —
        // exitPresent/onViewChanged/disable — so this catches those too, not
        // just slide navigation).
        if (gen !== this._overlayGeneration || slide !== this._slides[this._current]) {
          if (handle) {
            try {
              handle.canvas.dispose();
            } catch {}
            handle.el.remove();
          }
          return;
        }
        this._presentOverlay = handle;
      })
      .catch(() => {});
  }
```

- [ ] **Step 2: Add an invalidation-generation counter**

Deferring the `_presentOverlay` assignment until a build resolves (previous
step) means the old synchronous guard's implicit invalidation — any
`_clearPresentOverlays()` call, for any reason, doomed a pending build merely
by being called — no longer holds, because assignment now happens later, in
a `.then()`. `exitPresent()`/`onViewChanged()`/`disable()` all call
`_clearPresentOverlays()` **without** also changing `this._current`, so the
`slide !== this._slides[this._current]` check alone misses "present mode was
torn down while a background image was still loading" — the resolved build
would reattach a `.ms-briefing-overlay-canvas` after Present mode already
exited, with nothing left to clean it up until the next navigation. Fix by
centralizing invalidation in `_clearPresentOverlays()` itself via a counter
every consumer compares against.

Find:

```ts
  // Slide editor + present-mode annotation overlays
  private _slideEditor: any = null;
  private _presentOverlay: { el: HTMLCanvasElement; canvas: any } | null = null;
```

Replace with:

```ts
  // Slide editor + present-mode annotation overlays
  private _slideEditor: any = null;
  private _presentOverlay: { el: HTMLCanvasElement; canvas: any } | null = null;
  /** Bumped by every _clearPresentOverlays() call — lets in-flight _buildOverlayCanvas builds detect any teardown, not just a slide change. */
  private _overlayGeneration = 0;
```

Find:

```ts
  private _clearPresentOverlays(): void {
    if (!this._presentOverlay) return;
    try {
      this._presentOverlay.canvas.dispose();
    } catch {}
    this._presentOverlay.el.remove();
    this._presentOverlay = null;
  }
```

Replace with:

```ts
  private _clearPresentOverlays(): void {
    this._overlayGeneration++; // bump before the early-return: even "nothing to clear" invalidates pending builds
    if (!this._presentOverlay) return;
    try {
      this._presentOverlay.canvas.dispose();
    } catch {}
    this._presentOverlay.el.remove();
    this._presentOverlay = null;
  }
```

(The `gen` capture and comparison in `_renderPresentOverlays`, added in Step 1
above, already reads `this._overlayGeneration` — this step is what makes that
comparison meaningful.)

- [ ] **Step 3: Type-check**

Run: `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit`
Check lines mentioning `BriefingEngine.ts`. Expected: no new errors beyond pre-existing `TS2307` noise.

- [ ] **Step 4: Build**

Run: `vite build`
Expected: exits 0.

- [ ] **Step 5: Manual regression check**

Ask the user to open Present mode on a briefing containing at least one screen-only slide with overlays (an imported PPTX slide, or any slide edited in the Slide Editor with annotations) and confirm: the background image and annotations still appear exactly as before, Next/Prev still instantly swap between slides with no visual regression, and no extra canvases pile up in the DOM (devtools: `document.querySelectorAll('.ms-briefing-overlay-canvas').length` should read `1` while sitting on any slide, `0` outside Present mode). Also confirm the fix itself: enter Present mode on a screen-only slide, and while its background image is still loading (throttle the network in devtools if it loads too fast to catch), press Esc to exit — confirm no `.ms-briefing-overlay-canvas` appears afterward (`document.querySelectorAll('.ms-briefing-overlay-canvas').length` should read `0`).

---

### Task 3: Transition engine — cancellable crossfade/push/wipe

**Files:**
- Modify: `MS/Engines/Briefing/BriefingEngine.ts`

**Interfaces:**
- Consumes: `_buildOverlayCanvas` (Task 2), `Slide.slideTransition` / `SlideTransitionType` (Task 1).
- Produces: `private _transitionPresentOverlays(oldHandle, slide, type, durationMs): Promise<void>`, `private _cancelPresentTransition(): void`, restructured `public goToSlide(index: number): Promise<void>` (signature unchanged). Task 4 does not depend on these directly, but exercises them through the UI.

- [ ] **Step 1: Add the `_activeTransition` field**

Find (Task 2 added the `_overlayGeneration` line below `_presentOverlay` — it
should already be there; if it isn't, stop and report NEEDS_CONTEXT rather
than guessing):

```ts
  // Slide editor + present-mode annotation overlays
  private _slideEditor: any = null;
  private _presentOverlay: { el: HTMLCanvasElement; canvas: any } | null = null;
  private _overlayGeneration = 0;
```

Replace with:

```ts
  // Slide editor + present-mode annotation overlays
  private _slideEditor: any = null;
  private _presentOverlay: { el: HTMLCanvasElement; canvas: any } | null = null;
  private _overlayGeneration = 0;
  private _activeTransition: ActiveBuild | null = null;
  /** Bumped at the start of every _transitionPresentOverlays call — see Step 3. */
  private _transitionSeq = 0;
```

(`ActiveBuild` is the existing `{ cancel: () => void }` interface declared above the class — already in scope, no new import needed.)

**Why `_transitionSeq` exists, separately from Task 2's `_overlayGeneration`:** `_overlayGeneration` is only bumped by `_clearPresentOverlays()`, which the animated path deliberately never calls (that would dispose the outgoing frame immediately, defeating the crossfade). So `_overlayGeneration` protects the *instant* path for free (every `_renderPresentOverlays` call clears first) but does nothing for the animated path. Without a separate counter, two `_transitionPresentOverlays` calls racing to build a frame for the *same* slide (e.g. Next, Next, Prev landing back on a slide whose earlier build is still loading, or double-clicking the same slide in the Sorter) both pass the slide-identity check — neither is "stale" by that test alone — so both can complete, the second silently orphaning the first's already-assigned `newHandle` (never disposed) while double-disposing the shared `oldHandle`. `_transitionSeq`, bumped once per call before its await, restores "only the most recently issued attempt may complete" regardless of whether slide identities repeat.

- [ ] **Step 2: Add `_cancelPresentTransition`**

Find:

```ts
  private _cancelBuilds(): void {
    const builds = this._activeBuilds;
    this._activeBuilds = [];
    for (const b of builds) {
      try {
        b.cancel();
      } catch {}
    }
  }
```

Replace with:

```ts
  private _cancelBuilds(): void {
    const builds = this._activeBuilds;
    this._activeBuilds = [];
    for (const b of builds) {
      try {
        b.cancel();
      } catch {}
    }
  }

  /** Jump-cuts an in-flight slide transition to its end state (disposes the outgoing frame, keeps the incoming one). No-op if nothing is animating. */
  private _cancelPresentTransition(): void {
    const t = this._activeTransition;
    this._activeTransition = null;
    try {
      t?.cancel();
    } catch {}
  }
```

- [ ] **Step 3: Add `_transitionPresentOverlays`**

Find the `_clearPresentOverlays` method:

```ts
  private _clearPresentOverlays(): void {
```

Insert the new method immediately **before** it:

```ts
  /**
   * Crossfade/slide/wipe from `oldHandle` (the outgoing screen-only slide's
   * overlay frame) into a freshly-built frame for `slide`, per `type`, over
   * `durationMs`. Only ever called when both slides are screen-only — see
   * the eligibility check in goToSlide. Leaves `_presentOverlay` pointing at
   * the new frame once done; disposes `oldHandle` once it's no longer shown.
   */
  private async _transitionPresentOverlays(
    oldHandle: { el: HTMLCanvasElement; canvas: any },
    slide: Slide,
    type: SlideTransitionType,
    durationMs: number,
  ): Promise<void> {
    const gen = this._overlayGeneration;
    const seq = ++this._transitionSeq; // this call's ticket; any later call invalidates it even if slide/gen are unchanged
    const newHandle = await this._buildOverlayCanvas(slide);
    // Stale if: present mode/view was torn down (gen — same mechanism as
    // _renderPresentOverlays, Task 2 Step 2), OR the slide changed, OR a
    // newer _transitionPresentOverlays call has since started (seq — needed
    // because this path never calls _clearPresentOverlays, so repeated
    // navigation back to the SAME still-loading slide would otherwise pass
    // both other checks and race the newer call). Back out without touching
    // _presentOverlay/oldHandle; whichever call is current owns disposing them.
    if (
      gen !== this._overlayGeneration ||
      slide !== this._slides[this._current] ||
      seq !== this._transitionSeq
    ) {
      if (newHandle) {
        try {
          newHandle.canvas.dispose();
        } catch {}
        newHandle.el.remove();
      }
      return;
    }
    const disposeOld = () => {
      try {
        oldHandle.canvas.dispose();
      } catch {}
      oldHandle.el.remove();
    };
    if (!newHandle) {
      disposeOld();
      this._presentOverlay = null;
      return;
    }

    const oldEl = oldHandle.el;
    const newEl = newHandle.el;
    newEl.style.zIndex = '41'; // must beat the .ms-briefing-overlay-canvas class's z-index:40, or the incoming frame paints BELOW the outgoing one and 'wipe' never becomes visible

    // Final-review finding: .esri-view/.esri-view-root/.esri-view-surface do
    // NOT clip overflow in @arcgis/core 5.0.19 (verified against the vendored
    // CSS — the spec's opposite assumption was wrong). Scope a clip guard to
    // the container for push types only, for this transition's duration, so a
    // push can't bleed a transient horizontal scrollbar or (for a library
    // consumer embedding the view in a non-full-bleed div) slide across the
    // whole host page.
    const container: HTMLElement | undefined = (this._view as any)?.container;
    const isPush = type === 'pushLeft' || type === 'pushRight';
    const savedPosition = container?.style.position ?? '';
    const savedOverflow = container?.style.overflow ?? '';
    if (container && isPush) {
      container.style.position = 'relative';
      container.style.overflow = 'hidden';
    }

    const applyFrame = (t: number) => {
      switch (type) {
        case 'fade':
          // Only the incoming frame fades in — the outgoing frame stays at
          // full opacity underneath. Fading both simultaneously let the live
          // map bleed through at ~25% at the midpoint (final-review finding).
          newEl.style.opacity = String(t);
          break;
        case 'pushLeft':
          newEl.style.transform = `translateX(${(1 - t) * 100}%)`;
          oldEl.style.transform = `translateX(${-t * 100}%)`;
          break;
        case 'pushRight':
          newEl.style.transform = `translateX(${-(1 - t) * 100}%)`;
          oldEl.style.transform = `translateX(${t * 100}%)`;
          break;
        case 'wipe':
          newEl.style.clipPath = `inset(0 ${(1 - t) * 100}% 0 0)`;
          break;
      }
    };
    applyFrame(0);

    const finish = () => {
      disposeOld();
      newEl.style.opacity = '';
      newEl.style.transform = '';
      newEl.style.clipPath = '';
      newEl.style.zIndex = '';
      if (container && isPush) {
        container.style.position = savedPosition;
        container.style.overflow = savedOverflow;
      }
      this._presentOverlay = newHandle;
    };

    await new Promise<void>((resolve) => {
      const TweenMax = (window as any).TweenMax;
      if (!TweenMax || durationMs <= 0) {
        applyFrame(1);
        finish();
        resolve();
        return;
      }
      const state = { t: 0 };
      const tween = TweenMax.to(state, durationMs / 1000, {
        t: 1,
        onUpdate: () => applyFrame(state.t),
        onComplete: () => {
          finish();
          resolve();
        },
      });
      this._activeTransition = {
        cancel: () => {
          try {
            tween?.kill?.();
          } catch {}
          applyFrame(1);
          finish();
          resolve();
        },
      };
    });
    this._activeTransition = null;
  }

```

- [ ] **Step 4: Restructure `goToSlide`**

Find:

```ts
  public async goToSlide(index: number): Promise<void> {
    const v: any = this._view;
    if (!v || index < 0 || index >= this._slides.length) return;
    if (this._transitioning) return;
    this._transitioning = true;

    this._cancelBuilds();
    this._clearPresentOverlays();
    this._current = index;
    const slide = this._slides[index];
    this._refreshStrip();
    this._updateCounter();

    try {
      const target = this._resolveGoToTarget(slide.view);
      if (target) {
        await v
          .goTo(target, {
            duration: slide.transitionMs ?? 1000,
            easing: 'ease-in-out',
          })
          .catch(() => {}); // user-interrupt AbortError is expected
      }
    } finally {
      this._transitioning = false;
    }

    this._applySlideState(slide);
    this._runBuilds(slide);
    if (this._presentMode) this._renderPresentOverlays(slide);
  }
```

Replace with:

```ts
  public async goToSlide(index: number): Promise<void> {
    const v: any = this._view;
    if (!v || index < 0 || index >= this._slides.length) return;
    if (this._transitioning) return;
    this._transitioning = true;

    this._cancelBuilds();
    this._cancelPresentTransition();
    const prevSlide = this._current >= 0 ? this._slides[this._current] : null;
    const prevOverlay = this._presentOverlay;
    this._current = index;
    const slide = this._slides[index];
    this._refreshStrip();
    this._updateCounter();

    try {
      const target = this._resolveGoToTarget(slide.view);
      if (target) {
        await v
          .goTo(target, {
            duration: slide.transitionMs ?? 1000,
            easing: 'ease-in-out',
          })
          .catch(() => {}); // user-interrupt AbortError is expected
      }
    } finally {
      this._transitioning = false;
    }

    this._applySlideState(slide);
    this._runBuilds(slide);
    if (!this._presentMode) return; // present mode was exited mid-navigation; _clearPresentOverlays already ran

    const canAnimate =
      !!prevSlide &&
      !!prevOverlay &&
      this._presentOverlay === prevOverlay &&
      !!slide.slideTransition &&
      this._isScreenOnly(prevSlide) &&
      this._isScreenOnly(slide);

    if (canAnimate) {
      await this._transitionPresentOverlays(
        prevOverlay!,
        slide,
        slide.slideTransition!,
        slide.transitionMs ?? 1000,
      );
    } else {
      this._renderPresentOverlays(slide); // disposes prevOverlay itself if it's still current
    }
  }
```

- [ ] **Step 5: Cancel any in-flight transition on present-mode exit**

Find:

```ts
    this._presentClickHandler = null;
    this._presentContainer = null;

    this._clearPresentOverlays();
    this.stopAutoplay();
```

Replace with:

```ts
    this._presentClickHandler = null;
    this._presentContainer = null;

    this._cancelPresentTransition();
    this._clearPresentOverlays();
    this.stopAutoplay();
```

- [ ] **Step 6: Type-check**

Run: `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit`
Check lines mentioning `BriefingEngine.ts`. Expected: no new errors beyond pre-existing `TS2307` noise.

- [ ] **Step 7: Build**

Run: `vite build`
Expected: exits 0.

- [ ] **Step 8: Manual verification**

Ask the user to, in their running dev server:
1. Build (or open) a briefing with at least 3 screen-only slides (mix of blank/captured/imported is fine).
2. In the browser console, set transitions on slides 2 and 3: `window.briefingEngine.setSlideTransition(1, 'fade'); window.briefingEngine.setSlideTransition(2, 'pushLeft');` (UI for this lands in Task 4 — the console is the only way to set it right now).
3. Enter Present mode on slide 1, click/press Next twice, and confirm slide 2 fades in and slide 3 pushes in from the right, each over roughly one second.
4. Press Prev back to slide 1 and confirm it also transitions (direction is fixed to the configured type regardless of navigation direction — this is expected, not a bug).
5. Rapid-fire Next several times in a row mid-transition and confirm no visual glitching, no stuck/duplicate canvases (`document.querySelectorAll('.ms-briefing-overlay-canvas').length` should settle back to `1` a moment after you stop clicking), and the final slide shown matches the last one clicked to.
6. If the briefing also has a map-based slide, confirm moving into/out of it is still an instant cut with the map's own pan/zoom — no transition should play across that boundary even if the screen-only slide's `slideTransition` is set.

---

### Task 4: Sorter tile transition control

**Files:**
- Modify: `MS/Engines/Briefing/BriefingEngine.ts`

**Interfaces:**
- Consumes: `setSlideTransition` (Task 1), `_isScreenOnly` (existing), `SlideTransitionType` (Task 1).
- Produces: nothing further downstream — this is the last task.

- [ ] **Step 1: Add the transition `<select>` to each Sorter tile**

Find (inside `_refreshSorter`):

```ts
      const buildCount = slide.builds?.length ?? 0;
      tile.innerHTML = `
        <span class="ms-sorter-tile-num">${i + 1}</span>
        ${buildCount ? `<span class="ms-sorter-tile-builds" title="${buildCount} build step(s)">⚡${buildCount}</span>` : ''}
        <span class="ms-sorter-tile-title">${this._escapeHtml(slide.title)}</span>
        <span class="ms-sorter-tile-actions">
          <button class="ms-sorter-tile-btn" data-act="edit" title="Edit this slide — text, shapes, arrows, colors.">✎</button>
          <button class="ms-sorter-tile-btn" data-act="dup" title="Duplicate this slide.">⧉</button>
          <button class="ms-sorter-tile-btn" data-act="del" title="Remove this slide.">✕</button>
        </span>`;
```

Replace with:

```ts
      const buildCount = slide.builds?.length ?? 0;
      const screenOnly = this._isScreenOnly(slide);
      const transitionOptions: Array<[string, string]> = [
        ['', 'Cut'],
        ['fade', 'Fade'],
        ['pushLeft', 'Push Left'],
        ['pushRight', 'Push Right'],
        ['wipe', 'Wipe'],
      ];
      const transitionOptionsHtml = transitionOptions
        .map(([value, label]) => {
          const selected =
            slide.slideTransition === value || (!slide.slideTransition && value === '');
          return `<option value="${value}"${selected ? ' selected' : ''}>${label}</option>`;
        })
        .join('');
      tile.innerHTML = `
        <span class="ms-sorter-tile-num">${i + 1}</span>
        ${buildCount ? `<span class="ms-sorter-tile-builds" title="${buildCount} build step(s)">⚡${buildCount}</span>` : ''}
        <span class="ms-sorter-tile-title">${this._escapeHtml(slide.title)}</span>
        <span class="ms-sorter-tile-actions">
          <select class="ms-sorter-tile-transition" data-act="transition" ${screenOnly ? '' : 'disabled'} title="${screenOnly ? 'Transition played entering this slide from another slide-view slide.' : 'Only applies between slide-view slides — no live map.'}">${transitionOptionsHtml}</select>
          <button class="ms-sorter-tile-btn" data-act="edit" title="Edit this slide — text, shapes, arrows, colors.">✎</button>
          <button class="ms-sorter-tile-btn" data-act="dup" title="Duplicate this slide.">⧉</button>
          <button class="ms-sorter-tile-btn" data-act="del" title="Remove this slide.">✕</button>
        </span>`;
```

- [ ] **Step 2: Stop the tile's click handler from treating the select as "go to slide"**

Find:

```ts
      tile.addEventListener('click', (e) => {
        const act = ((e.target as HTMLElement).closest('[data-act]') as HTMLElement | null)
          ?.dataset.act;
        if (act === 'del') {
          this.removeSlide(i);
        } else if (act === 'dup') {
          this.duplicateSlide(i);
        } else if (act === 'edit') {
          // openSlideEditor closes the sorter itself.
          void this.openSlideEditor(i);
        } else {
          void this.goToSlide(i);
        }
      });
```

Replace with:

```ts
      tile.addEventListener('click', (e) => {
        const act = ((e.target as HTMLElement).closest('[data-act]') as HTMLElement | null)
          ?.dataset.act;
        if (act === 'del') {
          this.removeSlide(i);
        } else if (act === 'dup') {
          this.duplicateSlide(i);
        } else if (act === 'edit') {
          // openSlideEditor closes the sorter itself.
          void this.openSlideEditor(i);
        } else if (act === 'transition') {
          // Handled by its own 'change' listener below — clicking to open
          // the dropdown must not also navigate to this slide.
        } else {
          void this.goToSlide(i);
        }
      });

      const transitionSelect = tile.querySelector<HTMLSelectElement>(
        '.ms-sorter-tile-transition',
      );
      transitionSelect?.addEventListener('change', () => {
        this.setSlideTransition(
          i,
          (transitionSelect.value || undefined) as SlideTransitionType | undefined,
        );
      });
```

- [ ] **Step 3: Add tile CSS**

Find:

```ts
      .ms-sorter-tile-btn[data-act="del"]:hover {
        color: #ff8d80;
        border-color: var(--ms-danger, #DC3C30);
        background: rgba(220, 60, 48, 0.16);
      }
```

Replace with:

```ts
      .ms-sorter-tile-btn[data-act="del"]:hover {
        color: #ff8d80;
        border-color: var(--ms-danger, #DC3C30);
        background: rgba(220, 60, 48, 0.16);
      }
      .ms-sorter-tile-transition {
        height: 22px; padding: 0 4px;
        border: 1px solid var(--ms-border, rgba(90, 140, 220, 0.25));
        border-radius: var(--ms-radius-sm, 4px);
        background: rgba(10, 13, 18, 0.82);
        color: var(--ms-text-dim, rgba(155, 180, 215, 0.72));
        font-size: 10px; line-height: 1; cursor: pointer;
      }
      .ms-sorter-tile-transition:hover:not(:disabled) {
        color: var(--ms-accent, #EF9F27);
        border-color: var(--ms-accent, #EF9F27);
      }
      .ms-sorter-tile-transition:disabled {
        opacity: 0.35; cursor: not-allowed;
      }
```

- [ ] **Step 4: Type-check**

Run: `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit`
Check lines mentioning `BriefingEngine.ts`. Expected: no new errors beyond pre-existing `TS2307` noise.

- [ ] **Step 5: Build**

Run: `vite build`
Expected: exits 0.

- [ ] **Step 6: Manual verification**

Ask the user to open the Slide Sorter (⊞) on a briefing with both screen-only and map-based slides, and confirm: hovering a screen-only tile shows the transition dropdown alongside ✎/⧉/✕ and it's interactive (opening it doesn't navigate to that slide); hovering a map-based tile shows the same dropdown but greyed out/disabled with a tooltip explaining why; picking a value on a screen-only tile sticks (re-opening the Sorter still shows the chosen value selected); and Presenting through the deck reproduces the transition picked here (same check as Task 3 Step 8, now driven entirely from the UI instead of the console).

## Addendum: final whole-branch review fixes

The final review (after all 4 tasks passed individually) traced cross-task
interactions no single task review could see and found two Important gaps,
both fixed in place (user approved the container-clipping fix's approach
directly):

- **Container clipping (see `_transitionPresentOverlays` above, now updated):**
  the spec's premise that `.esri-view-root` clips overflow is false for
  `@arcgis/core` 5.0.19 (verified against the vendored CSS) — nothing in the
  ArcGIS view chrome clips an absolutely-positioned child, so an unguarded
  `pushLeft`/`pushRight` could bleed a transient scrollbar, or for a library
  consumer embedding the view in a non-full-bleed div, visibly slide across
  the whole host page. Fixed by scoping `position: relative; overflow:
  hidden` to the view container for the duration of push transitions only,
  saving/restoring its prior inline values in `finish()` — reflected in the
  `_transitionPresentOverlays` code block above.
- **`fade` bled the live map through at its midpoint** — both frames
  animated opacity simultaneously (`0.5 + 0.5·0.5 = 0.75`, so 25% of
  whatever's behind showed through). Fixed by only fading the incoming frame
  in; the outgoing one stays fully opaque underneath until `finish()` removes
  it — reflected in the `applyFrame` code block above.
- **`applySlideForExport` (the headless PPTX-export path) doesn't cancel an
  in-flight transition.** The original reasoning ("extremely unlikely to run
  concurrently with Present mode") doesn't hold — Ctrl+K reaches the export
  command during Present mode (not blocked by the present-mode keydown
  handler or hidden by `.ms-present-mode` CSS), and `_overlayGeneration`
  alone doesn't rescue it since `_transitionPresentOverlays`'s staleness
  check only runs once, before the tween starts. Fix, symmetric with
  `exitPresent()`'s existing `_cancelPresentTransition()` call:

  Find (`BriefingEngine.ts`, inside `applySlideForExport`):
  ```ts
    public async applySlideForExport(index: number, revealedBuilds?: number): Promise<Slide | null> {
      const v: any = this._view;
      if (!v || index < 0 || index >= this._slides.length) return null;
      this._cancelBuilds();
      this._clearPresentOverlays();
      this._current = index;
  ```
  Replace with:
  ```ts
    public async applySlideForExport(index: number, revealedBuilds?: number): Promise<Slide | null> {
      const v: any = this._view;
      if (!v || index < 0 || index >= this._slides.length) return null;
      this._cancelBuilds();
      this._cancelPresentTransition();
      this._clearPresentOverlays();
      this._current = index;
  ```

Deferred (accepted as-is, recorded for anyone revisiting this feature):
transient duplicate canvases on the instant path under rapid nav
(self-healing); a stranded/now-partially-contradictory JSDoc block left over
from the pre-Task-2 `_renderPresentOverlays` (two doc comments now sit back
to back above `_buildOverlayCanvas`/`_renderPresentOverlays`); the trailing
`this._activeTransition = null` not being seq-gated (latent only, traced
safe); unvalidated `slideTransition` values on import degrading to a silent
freeze instead of an instant cut (consistent with this file's existing trust
model for `transitionMs`/`builds`/`overlays`); a missing comment on the
load-bearing cancel-before-clear ordering in `exitPresent()`; an autoplay/
transition-duration interaction note (informational, not a defect).

## Self-Review Notes

- **Spec coverage:** scope rule (Task 3 `canAnimate`), data model (Task 1), mechanism/table (Task 3), cancellation (Task 3 `_cancelPresentTransition`), container overflow (called out as a live-verification item in Task 3 Step 8 rather than a code change, per the spec), UI (Task 4), no-new-dependencies (Global Constraints + confirmed no new imports anywhere above). All spec sections have a corresponding task.
- **Type consistency:** `_buildOverlayCanvas`'s return type (`{ el: HTMLCanvasElement; canvas: any } | null`) matches `_presentOverlay`'s existing declared type exactly (both Task 2 and the pre-existing field use the identical shape), and matches what Task 3's `_transitionPresentOverlays` destructures. `setSlideTransition`'s parameter type (`SlideTransitionType | undefined`) matches what Task 4's `change` listener passes.
- **No placeholders:** every step above is a complete, exact old→new code replacement or a fully-specified command/manual check — nothing deferred to "later."
