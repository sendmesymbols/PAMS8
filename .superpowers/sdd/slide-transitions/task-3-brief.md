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
```

(`ActiveBuild` is the existing `{ cancel: () => void }` interface declared above the class — already in scope, no new import needed.)

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
    const newHandle = await this._buildOverlayCanvas(slide);
    // Stale if the slide changed OR present mode/view was torn down while the
    // new frame was loading (same _overlayGeneration mechanism as
    // _renderPresentOverlays — see Task 2 Step 2). Back out without touching
    // _presentOverlay/oldHandle; whichever navigation/teardown is current
    // owns disposing them.
    if (gen !== this._overlayGeneration || slide !== this._slides[this._current]) {
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
    newEl.style.zIndex = '1'; // incoming frame always stacks above the outgoing one

    const applyFrame = (t: number) => {
      switch (type) {
        case 'fade':
          newEl.style.opacity = String(t);
          oldEl.style.opacity = String(1 - t);
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

