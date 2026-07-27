/**
 * PresentSession.ts
 *
 * Everything that happens while a briefing is being PLAYED. Lifted out of
 * BriefingEngine (which kept growing) and extended; the engine now owns slides,
 * capture, persistence and authoring, and delegates playback here.
 *
 * Responsibilities:
 *   • lifecycle — HUD hide, ArcGIS view UI stash, real fullscreen, teardown
 *   • input     — one capture-phase keydown owning the whole keyboard, plus
 *                 click-to-advance / right-click-to-go-back on the view
 *   • overlays  — the fabric StaticCanvas frame per slide, and the
 *                 fade / push / wipe transitions between screen-only slides
 *   • builds    — the step-through cursor over BuildSequencer's click groups
 *   • chrome    — auto-hiding control bar, slide counter, progress bar,
 *                 blackout / whiteout, idle cursor hiding
 *   • delegates — PresentAnnotator (laser / pen / spotlight) and
 *                 PresenterPanel (notes / timer / next / jump grid)
 *
 * Keys: → Space PgDn Enter advance · ← PgUp Backspace back · Home/End first/last ·
 * digits+Enter jump · B blackout · W whiteout · G grid · N presenter panel ·
 * L laser · P pen · S spotlight · E erase ink · [ ] spotlight size ·
 * T reset timer · A autoplay · F fullscreen · Esc unwind/exit.
 */

import EngineLogger from '../../../Support/EngineLogger';
import PresentAnnotator, { type PresentTool } from './PresentAnnotator';
import PresenterPanel, { type PresenterSlideRef } from './PresenterPanel';
import { type BuildGroup, buildModeOf, groupSteps, type ScheduledStep } from './BuildSequencer';
import type { Slide, SlideTransitionType } from '../BriefingTypes';
import { overlayToFabric, preloadOverlayImages } from '../OverlayFabric';

const ENGINE_NAME = 'BriefingEngine';

/** A DOM-attached, fully-rendered overlay frame for one slide. */
export interface OverlayHandle {
  el: HTMLCanvasElement;
  canvas: any;
}

/** What PresentSession needs back from BriefingEngine. */
export interface PresentHost {
  getView(): any;
  getSlides(): Slide[];
  getIndex(): number;
  cfg(): any;
  goToSlide(index: number): Promise<void>;
  isScreenOnly(slide: Slide): boolean;
  openSlideEditor(index: number): void;
  /** Cancel every in-flight build timer/tween and restore its target. */
  cancelBuilds(): void;
  /** Hide every graphic the slide's builds target (step-through arm). */
  hideBuildTargets(slide: Slide): void;
  /** Run these steps now, each at its own `at` offset from this moment. */
  runBuildSteps(steps: ScheduledStep[]): void;
  /** Instantly match graphic visibility to `revealed` groups having played. */
  snapBuildGroups(slide: Slide, groups: BuildGroup[], revealed: number): void;
}

/** Debounce for view-resize driven overlay rebuilds. */
const RESIZE_DEBOUNCE_MS = 140;
const DEFAULT_IDLE_MS = 2500;

export default class PresentSession {
  private _host: PresentHost;
  private _active = false;

  /** Esc reopens the Slide Editor only when the session was launched from it. */
  private _fromEditor = false;

  private _savedUiComponents: any = null;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _clickHandler: ((e: MouseEvent) => void) | null = null;
  private _contextHandler: ((e: MouseEvent) => void) | null = null;
  private _moveHandler: ((e: MouseEvent) => void) | null = null;
  private _fsHandler: (() => void) | null = null;
  private _resizeHandler: (() => void) | null = null;
  private _container: HTMLElement | null = null;
  private _resizeObserver: ResizeObserver | null = null;
  private _resizeTimer: number | null = null;

  // Chrome
  private _counterEl: HTMLElement | null = null;
  private _barEl: HTMLElement | null = null;
  private _progressEl: HTMLElement | null = null;
  private _maskEl: HTMLElement | null = null;
  private _idleTimer: number | null = null;
  private _autoplayTimer: number | null = null;

  // Overlay frames
  private _overlay: OverlayHandle | null = null;
  /** Bumped by every clearOverlays() — lets in-flight builds detect any teardown. */
  private _overlayGeneration = 0;
  private _activeTransition: { cancel: () => void } | null = null;
  /** Bumped at the start of every _transitionOverlays call — see that method. */
  private _transitionSeq = 0;

  // Step-through builds
  private _groups: BuildGroup[] = [];
  private _cursor = 0;
  /** Set by back() so the previous slide is entered with all builds already out. */
  private _enterFullyBuilt = false;

  // Sub-widgets
  private _annotator: PresentAnnotator | null = null;
  private _panel: PresenterPanel | null = null;
  private _panelOpen = false;

  private _blackout: 'none' | 'black' | 'white' = 'none';
  private _wentFullscreen = false;
  /** performance.now() before which fullscreenchange is ours, not the briefer's. */
  private _fsExemptUntil = 0;
  private _jumpBuffer = '';

  constructor(host: PresentHost) {
    this._host = host;
    this._injectStyles();
  }

  public isActive(): boolean {
    return this._active;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  public enter(opts?: { fromEditor?: boolean }): void {
    if (this._active) return;
    const slides = this._host.getSlides();
    if (!slides.length) {
      EngineLogger.error(ENGINE_NAME, 'Cannot present: no slides captured');
      return;
    }
    const v: any = this._host.getView();
    this._active = true;
    this._fromEditor = !!opts?.fromEditor;
    this._blackout = 'none';
    this._jumpBuffer = '';
    document.body.classList.add('ms-present-mode');

    try {
      this._savedUiComponents = v?.ui ? [...(v.ui.components ?? [])] : null;
      if (v?.ui) v.ui.components = [];
    } catch {
      this._savedUiComponents = null;
    }

    this._container = v?.container ?? null;
    this._attachInput();
    this._buildChrome();

    if (this._container) {
      this._annotator = new PresentAnnotator(this._container, {
        penColor: this._host.cfg().penColor,
        penWidth: Number(this._host.cfg().penWidth),
        spotlightRadius: Number(this._host.cfg().spotlightRadius),
      });
    }

    if (this._host.cfg().fullscreen !== false) void this._requestFullscreen();
    if (this._host.cfg().presenterPanel === true) this.togglePanel(true);

    const index = this._host.getIndex();
    if (index < 0) {
      void this._host.goToSlide(0);
    } else {
      // Resuming on a slide the map already shows: keep it fully built rather
      // than yanking its graphics away. ← still steps back through the builds.
      const cur = slides[index];
      this._annotator?.setSlide(cur.id);
      this._armBuildsFor(cur, /* fullyBuilt */ true);
      this._renderOverlays(cur);
      this._syncChrome();
    }
    EngineLogger.success(ENGINE_NAME, 'Present mode entered (Esc to exit)');
  }

  /**
   * Idempotent — also reached from onViewChanged / disable / destroy.
   * `silent` suppresses the keep-your-ink prompt: engine teardown must never
   * put a blocking confirm() in front of a page that is going away.
   */
  public exit(opts?: { silent?: boolean }): void {
    if (!this._active && !document.body.classList.contains('ms-present-mode')) return;
    const wasFromEditor = this._fromEditor;
    const index = this._host.getIndex();
    this._active = false;
    this._fromEditor = false;
    document.body.classList.remove('ms-present-mode', 'ms-present-idle');

    if (!opts?.silent) this._offerToKeepInk();

    const v: any = this._host.getView();
    try {
      if (v?.ui && this._savedUiComponents) v.ui.components = this._savedUiComponents;
    } catch {}
    this._savedUiComponents = null;

    this._detachInput();
    this.cancelTransition();
    this.clearOverlays();
    this.stopAutoplay();
    this._annotator?.dispose();
    this._annotator = null;
    this._panel?.destroy();
    this._panel = null;
    this._panelOpen = false;
    this._removeChrome();
    this._blackout = 'none';
    this._groups = [];
    this._cursor = 0;
    this._enterFullyBuilt = false;
    void this._exitFullscreen();

    EngineLogger.success(ENGINE_NAME, 'Present mode exited');

    // Slideshow launched from the Slide Editor is a preview of the slide being
    // edited — return to editing it rather than to the bare map.
    if (wasFromEditor && index >= 0) this._host.openSlideEditor(index);
  }

  public toggle(): void {
    this._active ? this.exit() : this.enter();
  }

  /** The view was swapped (2D↔3D) — present mode cannot survive it. */
  public onViewChanged(): void {
    this.exit();
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  private _attachInput(): void {
    this._keyHandler = (e: KeyboardEvent) => this._onKey(e);
    // Capture phase so present-mode keys win over every other document handler.
    document.addEventListener('keydown', this._keyHandler, true);

    this._clickHandler = (e: MouseEvent) => {
      // A tool owns the pointer; the annotator already swallowed the event, but
      // guard anyway in case the click landed outside its canvas.
      if (this._annotator && this._annotator.tool !== 'none') return;
      if (e.button !== 0) return;
      void this.advance();
    };
    this._contextHandler = (e: MouseEvent) => {
      e.preventDefault();
      if (this._annotator && this._annotator.tool !== 'none') return;
      void this.back();
    };
    this._container?.addEventListener('click', this._clickHandler);
    this._container?.addEventListener('contextmenu', this._contextHandler);

    this._moveHandler = () => this._wake();
    document.addEventListener('mousemove', this._moveHandler);

    this._fsHandler = () => {
      // Ignore fullscreen changes WE caused — popping the presenter panel out
      // opens a window, which makes the browser drop fullscreen on this one.
      if (performance.now() < this._fsExemptUntil) return;
      // The browser's own Esc / F11 leaves fullscreen without touching us —
      // follow it out rather than sitting in a half-exited state.
      if (this._active && this._wentFullscreen && !document.fullscreenElement) {
        this._wentFullscreen = false;
        this.exit();
      }
    };
    document.addEventListener('fullscreenchange', this._fsHandler);

    this._resizeHandler = () => this._onResize();
    window.addEventListener('resize', this._resizeHandler);
    if (this._container && typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this._onResize());
      this._resizeObserver.observe(this._container);
    }
  }

  private _detachInput(): void {
    if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler, true);
    this._keyHandler = null;
    if (this._clickHandler) this._container?.removeEventListener('click', this._clickHandler);
    if (this._contextHandler)
      this._container?.removeEventListener('contextmenu', this._contextHandler);
    this._clickHandler = null;
    this._contextHandler = null;
    if (this._moveHandler) document.removeEventListener('mousemove', this._moveHandler);
    this._moveHandler = null;
    if (this._fsHandler) document.removeEventListener('fullscreenchange', this._fsHandler);
    this._fsHandler = null;
    if (this._resizeHandler) window.removeEventListener('resize', this._resizeHandler);
    this._resizeHandler = null;
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    if (this._resizeTimer !== null) {
      clearTimeout(this._resizeTimer);
      this._resizeTimer = null;
    }
    if (this._idleTimer !== null) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
    this._container = null;
  }

  private _onKey(e: KeyboardEvent): void {
    // Never steal typing — the presenter panel has no fields today, but a
    // consumer embedding one, or a browser autofill popup, would break here.
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return;

    const stop = () => {
      e.stopPropagation();
      e.preventDefault();
    };
    this._wake();

    // Digit accumulation: "12" then Enter jumps to slide 12.
    if (/^[0-9]$/.test(e.key)) {
      stop();
      this._jumpBuffer = (this._jumpBuffer + e.key).slice(0, 4);
      this._syncCounter();
      return;
    }

    switch (e.key) {
      case 'Escape': {
        stop();
        // Unwind one layer at a time so Esc never destroys more than expected.
        if (this._panel?.gridOpen) {
          this._panel.closeGrid();
          return;
        }
        if (this._jumpBuffer) {
          this._jumpBuffer = '';
          this._syncCounter();
          return;
        }
        if (this._annotator && this._annotator.tool !== 'none') {
          this._setTool('none');
          return;
        }
        if (this._blackout !== 'none') {
          this._setBlackout('none');
          return;
        }
        this.exit();
        return;
      }
      case 'Enter':
        stop();
        if (this._jumpBuffer) {
          const n = Number(this._jumpBuffer);
          this._jumpBuffer = '';
          void this._jumpTo(n - 1);
        } else {
          void this.advance();
        }
        return;
      case 'ArrowRight':
      case ' ':
      case 'PageDown':
        stop();
        void this.advance();
        return;
      case 'ArrowLeft':
      case 'PageUp':
      case 'Backspace':
        stop();
        void this.back();
        return;
      case 'Home':
        stop();
        void this._jumpTo(0);
        return;
      case 'End':
        stop();
        void this._jumpTo(this._host.getSlides().length - 1);
        return;
      case '[':
        stop();
        this._annotator?.nudgeSpotlight(-0.02);
        return;
      case ']':
        stop();
        this._annotator?.nudgeSpotlight(0.02);
        return;
    }

    switch (e.key.toLowerCase()) {
      case 'b':
        stop();
        this._setBlackout(this._blackout === 'black' ? 'none' : 'black');
        return;
      case 'w':
        stop();
        this._setBlackout(this._blackout === 'white' ? 'none' : 'white');
        return;
      case 'g':
        stop();
        this.togglePanel(true);
        this._panel?.toggleGrid();
        return;
      case 'n':
        stop();
        this.togglePanel();
        return;
      case 'l':
        stop();
        this._setTool(this._annotator?.tool === 'laser' ? 'none' : 'laser');
        return;
      case 'p':
        stop();
        this._setTool(this._annotator?.tool === 'pen' ? 'none' : 'pen');
        return;
      case 's':
        stop();
        this._setTool(this._annotator?.tool === 'spotlight' ? 'none' : 'spotlight');
        return;
      case 'e':
        stop();
        this._annotator?.clearInk();
        return;
      case 't':
        stop();
        this._panel?.resetTimer();
        return;
      case 'a':
        stop();
        this._autoplayTimer === null ? this.startAutoplay() : this.stopAutoplay();
        this._syncChrome();
        return;
      case 'f':
        stop();
        void (document.fullscreenElement ? this._exitFullscreen() : this._requestFullscreen());
        return;
    }
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  /**
   * One briefer advance: reveal the slide's next build group if any remain,
   * otherwise move to the next slide. At the very end, autoplay either loops
   * or stops; a manual advance simply does nothing.
   */
  public async advance(): Promise<void> {
    if (!this._active) return;
    if (this._cursor < this._groups.length) {
      this._host.runBuildSteps(this._groups[this._cursor].steps);
      this._cursor++;
      this._syncChrome();
      return;
    }
    const index = this._host.getIndex();
    const total = this._host.getSlides().length;
    if (index + 1 < total) {
      await this._host.goToSlide(index + 1);
    } else if (this._autoplayTimer !== null) {
      if (this._host.cfg().autoplayLoop === true) await this._host.goToSlide(0);
      else this.stopAutoplay();
    }
  }

  /**
   * One step back. Within a slide this SNAPS to the previous build state rather
   * than playing effects in reverse — predictable, and it matches what a
   * briefer wants when they overshot. At the top of a slide it moves to the
   * previous slide, entered fully built.
   */
  public async back(): Promise<void> {
    if (!this._active) return;
    if (this._cursor > 0) {
      this._cursor--;
      this._host.cancelBuilds();
      const slide = this._host.getSlides()[this._host.getIndex()];
      if (slide) this._host.snapBuildGroups(slide, this._groups, this._cursor);
      this._syncChrome();
      return;
    }
    const index = this._host.getIndex();
    if (index > 0) {
      this._enterFullyBuilt = true;
      await this._host.goToSlide(index - 1);
    }
  }

  private async _jumpTo(index: number): Promise<void> {
    const total = this._host.getSlides().length;
    if (index < 0 || index >= total || index === this._host.getIndex()) {
      this._syncChrome();
      return;
    }
    this._enterFullyBuilt = false;
    await this._host.goToSlide(index);
  }

  // ── Slide-change hooks, driven by BriefingEngine.goToSlide ─────────────────

  /**
   * Called before the index moves. Cancels any running transition and hands the
   * caller the outgoing overlay frame so it can be transitioned out of.
   */
  public beginSlideChange(): OverlayHandle | null {
    this.cancelTransition();
    return this._overlay;
  }

  /**
   * Arm build playback for a slide the engine is entering. Returns true when
   * step-through has taken over, in which case the engine must NOT run its own
   * timer-driven builds.
   */
  public armBuilds(slide: Slide): boolean {
    if (!this._active) return false;
    const fully = this._enterFullyBuilt;
    this._enterFullyBuilt = false;
    return this._armBuildsFor(slide, fully);
  }

  private _armBuildsFor(slide: Slide, fullyBuilt: boolean): boolean {
    this._groups = groupSteps(slide);
    if (buildModeOf(slide) !== 'click' || !this._groups.length) {
      // Auto slides expose no step cursor — the engine's timer path owns them.
      this._groups = [];
      this._cursor = 0;
      return false;
    }
    if (fullyBuilt) {
      this._cursor = this._groups.length;
      this._host.snapBuildGroups(slide, this._groups, this._cursor);
    } else {
      this._cursor = 0;
      this._host.hideBuildTargets(slide);
    }
    return true;
  }

  /** Called after the goTo settles: swap overlay frames and refresh chrome. */
  public async onSlideEntered(
    slide: Slide,
    _prevSlide: Slide | null,
    prevOverlay: OverlayHandle | null,
  ): Promise<void> {
    if (!this._active) return; // exited mid-navigation; clearOverlays already ran
    this._annotator?.setSlide(slide.id);
    this._syncChrome();

    // A transition needs a stored type and a screen-only DESTINATION — the
    // incoming frame is what animates, and it has to cover the screen. The
    // outgoing frame is optional: arriving from a map slide there may be none,
    // and the new frame simply animates in over the live map, which removes the
    // hard cut map→slide used to have. `prevSlide` is deliberately not
    // consulted; what matters is whether there is a frame to move out.
    const outgoing = prevOverlay && this._overlay === prevOverlay ? prevOverlay : null;
    const canAnimate = !!slide.slideTransition && this._host.isScreenOnly(slide);

    if (canAnimate) {
      await this._transitionOverlays(
        outgoing,
        slide,
        slide.slideTransition!,
        slide.transitionMs ?? 1000,
      );
    } else {
      this._renderOverlays(slide); // disposes the old frame itself
    }
  }

  // ── Overlay frames ─────────────────────────────────────────────────────────

  /**
   * Build a fully-rendered, DOM-attached overlay canvas for `slide` without
   * touching `_overlay` — the caller decides what to do with the result
   * (assign it, or transition into it). Resolves null when there is nothing to
   * draw. Async because screen-only slides load their background image.
   */
  private _buildOverlayCanvas(slide: Slide): Promise<OverlayHandle | null> {
    const fabric = (window as any).fabric;
    const v: any = this._host.getView();
    const screenBg = this._host.isScreenOnly(slide) ? slide.backgroundDataUrl : undefined;
    if (!fabric || !v?.container || (!slide.overlays?.length && !screenBg)) {
      return Promise.resolve(null);
    }
    // Read the size at BUILD time, not entry time — the view may have been
    // resized (fullscreen, window drag) since the session started.
    const W = v.width || v.container.clientWidth || 1;
    const H = v.height || v.container.clientHeight || 1;
    const el = document.createElement('canvas');
    el.className = 'ms-briefing-overlay-canvas';
    v.container.appendChild(el);
    const sc = new fabric.StaticCanvas(el, { width: W, height: H });
    const handle: OverlayHandle = { el, canvas: sc };

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

    // Picture overlays render from a synchronous decode cache, so it has to be
    // warm before draw() runs — see OverlayFabric.preloadOverlayImages.
    if (!screenBg) {
      return preloadOverlayImages(slide.overlays).then(() => {
        draw({ x: 0, y: 0, w: W, h: H });
        return handle;
      });
    }
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const iw = img.naturalWidth || 1;
        const ih = img.naturalHeight || 1;
        const scale = Math.min(W / iw, H / ih);
        const fit = {
          x: (W - iw * scale) / 2,
          y: (H - ih * scale) / 2,
          w: iw * scale,
          h: ih * scale,
        };
        sc.setBackgroundColor('#101418');
        sc.setBackgroundImage(
          new fabric.Image(img, { left: fit.x, top: fit.y, scaleX: scale, scaleY: scale }),
          () => {
            void preloadOverlayImages(slide.overlays).then(() => {
              draw(fit);
              resolve(handle);
            });
          },
        );
      };
      img.onerror = () => {
        void preloadOverlayImages(slide.overlays).then(() => {
          draw({ x: 0, y: 0, w: W, h: H });
          resolve(handle);
        });
      };
      img.src = screenBg;
    });
  }

  /** Instant (non-animated) overlay swap — used whenever a transition doesn't apply. */
  private _renderOverlays(slide: Slide): void {
    this.clearOverlays();
    const gen = this._overlayGeneration;
    void this._buildOverlayCanvas(slide)
      .then((handle) => {
        // Stale if the slide changed OR the session/view was torn down while
        // the background image was loading (clearOverlays bumps the generation
        // on every call, including ones that don't touch the index).
        if (gen !== this._overlayGeneration || slide !== this._currentSlide()) {
          this._dispose(handle);
          return;
        }
        this._overlay = handle;
      })
      .catch(() => {});
  }

  /**
   * Animate from `oldHandle` (which may be null — e.g. arriving from a map
   * slide, where there is no outgoing frame to move) into a freshly-built frame
   * for `slide`. Leaves `_overlay` pointing at the new frame; disposes
   * `oldHandle` once it is no longer shown.
   */
  private async _transitionOverlays(
    oldHandle: OverlayHandle | null,
    slide: Slide,
    type: SlideTransitionType,
    durationMs: number,
  ): Promise<void> {
    const gen = this._overlayGeneration;
    const seq = ++this._transitionSeq; // any later call invalidates this ticket
    const newHandle = await this._buildOverlayCanvas(slide);
    // Stale if: the session/view was torn down (gen), OR the slide changed, OR
    // a newer _transitionOverlays call has since started (seq — needed because
    // this path never calls clearOverlays, so repeated navigation back to the
    // SAME still-loading slide would otherwise pass both other checks). Back
    // out without touching _overlay/oldHandle; whichever call is current owns
    // disposing them.
    if (
      gen !== this._overlayGeneration ||
      slide !== this._currentSlide() ||
      seq !== this._transitionSeq
    ) {
      this._dispose(newHandle);
      return;
    }
    const disposeOld = () => this._dispose(oldHandle);
    if (!newHandle) {
      disposeOld();
      this._overlay = null;
      return;
    }

    const oldEl = oldHandle?.el ?? null;
    const newEl = newHandle.el;
    // Must beat the .ms-briefing-overlay-canvas class's z-index:40, or the
    // incoming frame paints BELOW the outgoing one and 'wipe' never shows.
    newEl.style.zIndex = '41';

    // .esri-view/.esri-view-root/.esri-view-surface do NOT clip overflow in
    // @arcgis/core 5.0.19. Scope a clip guard to the container for push types
    // only, for this transition's duration, so a push can't bleed a transient
    // horizontal scrollbar or (for a consumer embedding the view in a
    // non-full-bleed div) slide across the whole host page.
    const container: HTMLElement | null = this._container;
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
          // Only the incoming frame fades in — the outgoing frame stays at full
          // opacity underneath. Fading both let the live map bleed through at
          // ~25% at the midpoint.
          newEl.style.opacity = String(t);
          break;
        case 'pushLeft':
          newEl.style.transform = `translateX(${(1 - t) * 100}%)`;
          if (oldEl) oldEl.style.transform = `translateX(${-t * 100}%)`;
          break;
        case 'pushRight':
          newEl.style.transform = `translateX(${-(1 - t) * 100}%)`;
          if (oldEl) oldEl.style.transform = `translateX(${t * 100}%)`;
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
      this._overlay = newHandle;
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

  /** Jump-cut an in-flight transition to its end state. No-op if nothing runs. */
  public cancelTransition(): void {
    const t = this._activeTransition;
    this._activeTransition = null;
    try {
      t?.cancel();
    } catch {}
  }

  public clearOverlays(): void {
    this._overlayGeneration++; // bump before the early-return: even "nothing to clear" invalidates pending builds
    if (!this._overlay) return;
    this._dispose(this._overlay);
    this._overlay = null;
  }

  private _dispose(handle: OverlayHandle | null): void {
    if (!handle) return;
    try {
      handle.canvas.dispose();
    } catch {}
    handle.el.remove();
  }

  private _currentSlide(): Slide | undefined {
    return this._host.getSlides()[this._host.getIndex()];
  }

  // ── Resize ─────────────────────────────────────────────────────────────────

  /**
   * The overlay frame bakes the view size at build time, so any resize
   * (entering fullscreen, dragging the window, a rail collapsing) leaves it
   * stretched or clipped. Rebuild it — debounced, since a drag fires
   * continuously and each rebuild re-decodes the background image.
   */
  private _onResize(): void {
    if (!this._active) return;
    this._annotator?.resize();
    if (this._resizeTimer !== null) clearTimeout(this._resizeTimer);
    this._resizeTimer = window.setTimeout(() => {
      this._resizeTimer = null;
      if (!this._active) return;
      this.cancelTransition();
      const slide = this._currentSlide();
      if (slide) this._renderOverlays(slide);
    }, RESIZE_DEBOUNCE_MS);
  }

  // ── Fullscreen ─────────────────────────────────────────────────────────────

  private async _requestFullscreen(): Promise<void> {
    if (document.fullscreenElement) {
      this._wentFullscreen = true;
      return;
    }
    try {
      await document.documentElement.requestFullscreen?.();
      this._wentFullscreen = true;
    } catch {
      // Denied (no user gesture, or the browser refuses) — present mode still
      // works, it just keeps the browser chrome. Not worth surfacing.
      this._wentFullscreen = false;
    }
  }

  /**
   * Called around the presenter panel opening or closing its own window. The
   * popup steals focus, so the browser drops fullscreen on the map window and
   * fires fullscreenchange — which, untreated, ends the show and closes the
   * window that was just opened. Ignore that event, then take fullscreen back
   * for the audience screen (still inside the click's transient activation, so
   * the browser normally grants it; if it refuses, the show simply continues
   * windowed).
   */
  private _exemptFullscreenChange(): void {
    this._fsExemptUntil = performance.now() + 3000;
    if (!this._wentFullscreen) return;
    window.setTimeout(() => {
      if (!this._active || document.fullscreenElement) return;
      if (this._host.cfg().fullscreen === false) return;
      void this._requestFullscreen();
    }, 300);
  }

  private async _exitFullscreen(): Promise<void> {
    if (!this._wentFullscreen) return;
    this._wentFullscreen = false;
    try {
      if (document.fullscreenElement) await document.exitFullscreen?.();
    } catch {}
  }

  // ── Tools / blackout / presenter panel ─────────────────────────────────────

  private _setTool(tool: PresentTool): void {
    this._annotator?.setTool(tool);
    this._syncChrome();
  }

  private _setBlackout(mode: 'none' | 'black' | 'white'): void {
    this._blackout = mode;
    if (this._maskEl) {
      this._maskEl.style.display = mode === 'none' ? 'none' : 'block';
      this._maskEl.style.background = mode === 'white' ? '#ffffff' : '#000000';
    }
    this._syncChrome();
  }

  public togglePanel(forceOpen?: boolean): void {
    const open = forceOpen ?? !this._panelOpen;
    if (open === this._panelOpen) return;
    this._panelOpen = open;
    if (!open) {
      this._panel?.destroy();
      this._panel = null;
      this._syncChrome();
      return;
    }
    this._panel = new PresenterPanel({
      next: () => void this.advance(),
      prev: () => void this.back(),
      goTo: (i: number) => void this._jumpTo(i),
      toggleBlackout: () => this._setBlackout(this._blackout === 'black' ? 'none' : 'black'),
      exit: () => this.exit(),
      listSlides: (): PresenterSlideRef[] =>
        this._host
          .getSlides()
          .map((s, i) => ({ title: s.title || `Slide ${i + 1}`, thumb: s.thumbnailDataUrl })),
      onWindowChange: () => this._exemptFullscreenChange(),
    });
    this._panel.mount(document);
    this._syncChrome();
  }

  /**
   * Pen ink is a session artefact by default. If any was drawn, offer to keep
   * it — converted into ordinary 'freehand' overlays, so it renders, exports
   * and edits exactly like anything drawn in the slide editor.
   */
  private _offerToKeepInk(): void {
    const annotator = this._annotator;
    if (!annotator?.hasAnyInk()) return;
    const byslide = annotator.inkAsOverlays();
    if (!byslide.size) return;
    let kept = 0;
    try {
      if (!window.confirm('Keep the ink you drew as slide annotations?')) return;
    } catch {
      return;
    }
    for (const slide of this._host.getSlides()) {
      const add = byslide.get(slide.id);
      if (!add?.length) continue;
      slide.overlays = [...(slide.overlays ?? []), ...add];
      kept += add.length;
    }
    if (kept) EngineLogger.success(ENGINE_NAME, `Kept ${kept} ink stroke(s) as slide annotations`);
  }

  // ── Autoplay ───────────────────────────────────────────────────────────────

  public startAutoplay(intervalMs?: number): void {
    this.stopAutoplay();
    const interval = intervalMs ?? Number(this._host.cfg().autoplayIntervalMs) ?? 5000;
    this._autoplayTimer = window.setInterval(() => {
      // advance() handles builds, end-of-deck and looping in one place.
      if (!this._active) {
        this.stopAutoplay();
        return;
      }
      const last = this._host.getIndex() + 1 >= this._host.getSlides().length;
      if (last && this._cursor >= this._groups.length && this._host.cfg().autoplayLoop !== true) {
        this.stopAutoplay();
        this._syncChrome();
        return;
      }
      void this.advance();
    }, Math.max(500, interval));
    this._syncChrome();
  }

  public stopAutoplay(): void {
    if (this._autoplayTimer !== null) {
      clearInterval(this._autoplayTimer);
      this._autoplayTimer = null;
    }
  }

  public get autoplaying(): boolean {
    return this._autoplayTimer !== null;
  }

  // ── Chrome: counter, control bar, progress, blackout mask ──────────────────

  private _buildChrome(): void {
    const mask = document.createElement('div');
    mask.className = 'ms-present-mask';
    mask.style.display = 'none';
    // The mask covers the control bar, so a click on it has to be the way back
    // — otherwise a blacked-out screen can only be undone from the keyboard.
    mask.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._setBlackout('none');
    });
    document.body.appendChild(mask);
    this._maskEl = mask;

    const counter = document.createElement('div');
    counter.className = 'ms-briefing-counter';
    document.body.appendChild(counter);
    this._counterEl = counter;

    const bar = document.createElement('div');
    bar.className = 'ms-present-bar';
    bar.innerHTML = `
      <button class="ms-present-b" data-act="prev" title="Previous (← / right-click)">◀</button>
      <button class="ms-present-b" data-act="next" title="Next (→ / Space / click)">▶</button>
      <span class="ms-present-sep"></span>
      <button class="ms-present-b" data-act="laser" title="Laser pointer (L)">✦</button>
      <button class="ms-present-b" data-act="pen" title="Pen — draw on the slide (P), E erases">✎</button>
      <button class="ms-present-b" data-act="spotlight" title="Spotlight (S) — [ ] resize">◎</button>
      <span class="ms-present-sep"></span>
      <button class="ms-present-b" data-act="black" title="Black screen (B) · W for white">◼</button>
      <button class="ms-present-b" data-act="grid" title="All slides (G)">⊞</button>
      <button class="ms-present-b" data-act="panel" title="Presenter view — notes &amp; timer (N)">☰</button>
      <button class="ms-present-b" data-act="auto" title="Autoplay (A)">⏱</button>
      <span class="ms-present-sep"></span>
      <button class="ms-present-b" data-act="exit" title="End the slideshow (Esc)">✕</button>`;
    document.body.appendChild(bar);
    this._barEl = bar;
    bar.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement)?.closest?.('[data-act]')?.getAttribute('data-act');
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();
      this._wake();
      switch (act) {
        case 'prev':
          void this.back();
          break;
        case 'next':
          void this.advance();
          break;
        case 'laser':
          this._setTool(this._annotator?.tool === 'laser' ? 'none' : 'laser');
          break;
        case 'pen':
          this._setTool(this._annotator?.tool === 'pen' ? 'none' : 'pen');
          break;
        case 'spotlight':
          this._setTool(this._annotator?.tool === 'spotlight' ? 'none' : 'spotlight');
          break;
        case 'black':
          this._setBlackout(this._blackout === 'black' ? 'none' : 'black');
          break;
        case 'grid':
          this.togglePanel(true);
          this._panel?.toggleGrid();
          break;
        case 'panel':
          this.togglePanel();
          break;
        case 'auto':
          this.autoplaying ? this.stopAutoplay() : this.startAutoplay();
          this._syncChrome();
          break;
        case 'exit':
          this.exit();
          break;
      }
    });

    const progress = document.createElement('div');
    progress.className = 'ms-present-progress';
    progress.innerHTML = '<i></i>';
    document.body.appendChild(progress);
    this._progressEl = progress;

    this._wake();
  }

  private _removeChrome(): void {
    this._counterEl?.remove();
    this._barEl?.remove();
    this._progressEl?.remove();
    this._maskEl?.remove();
    this._counterEl = null;
    this._barEl = null;
    this._progressEl = null;
    this._maskEl = null;
  }

  /** Show the chrome and restart the idle countdown that hides it again. */
  private _wake(): void {
    if (!this._active) return;
    document.body.classList.remove('ms-present-idle');
    if (this._idleTimer !== null) clearTimeout(this._idleTimer);
    const idleMs = Number(this._host.cfg().controlsIdleMs) || DEFAULT_IDLE_MS;
    this._idleTimer = window.setTimeout(() => {
      this._idleTimer = null;
      if (this._active) document.body.classList.add('ms-present-idle');
    }, Math.max(600, idleMs));
  }

  private _syncCounter(): void {
    if (!this._counterEl) return;
    const slides = this._host.getSlides();
    const index = this._host.getIndex();
    const slide = slides[index];
    const jump = this._jumpBuffer ? ` · go to ${this._jumpBuffer}…` : '';
    const build =
      this._groups.length > 0 ? ` · build ${this._cursor}/${this._groups.length}` : '';
    this._counterEl.textContent = slide
      ? `${index + 1} / ${slides.length} — ${slide.title}${build}${jump}`
      : `${slides.length} slides${jump}`;
  }

  /** Push current state into every piece of chrome. Cheap; call freely. */
  private _syncChrome(): void {
    if (!this._active) return;
    this._syncCounter();

    if (this._progressEl) {
      const total = Math.max(1, this._host.getSlides().length);
      const done = (this._host.getIndex() + 1) / total;
      const fill = this._progressEl.firstElementChild as HTMLElement | null;
      if (fill) fill.style.width = `${Math.max(0, Math.min(1, done)) * 100}%`;
    }

    if (this._barEl) {
      const tool = this._annotator?.tool ?? 'none';
      const on = (act: string, state: boolean) =>
        this._barEl!.querySelector(`[data-act="${act}"]`)?.classList.toggle('ms-on', state);
      on('laser', tool === 'laser');
      on('pen', tool === 'pen');
      on('spotlight', tool === 'spotlight');
      on('black', this._blackout !== 'none');
      on('panel', this._panelOpen);
      on('auto', this.autoplaying);
    }

    if (this._panel) {
      const slides = this._host.getSlides();
      const index = this._host.getIndex();
      const slide = slides[index];
      const next = slides[index + 1];
      this._panel.update({
        index,
        total: slides.length,
        title: slide?.title ?? '',
        notes: slide?.notes ?? '',
        current: slide
          ? { title: slide.title || `Slide ${index + 1}`, thumb: slide.thumbnailDataUrl }
          : null,
        next: next
          ? { title: next.title || `Slide ${index + 2}`, thumb: next.thumbnailDataUrl }
          : null,
        buildRevealed: this._cursor,
        buildTotal: this._groups.length,
        blackout: this._blackout !== 'none',
      });
    }
  }

  // ── Styles ─────────────────────────────────────────────────────────────────

  private _injectStyles(): void {
    if (document.getElementById('ms-present-style')) return;
    const style = document.createElement('style');
    style.id = 'ms-present-style';
    style.textContent = `
      .ms-present-annotator { position: absolute; inset: 0; }

      /* Blacks/whites the audience screen: above the control bar, counter and
         progress (which would otherwise leak through a "black" screen), but
         below the presenter panel (9700) on purpose — the briefer keeps their
         notes while the room sees nothing. Clicking it restores the slide. */
      .ms-present-mask { position: fixed; inset: 0; z-index: 9690; cursor: pointer; }

      .ms-present-bar {
        position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%);
        z-index: 9680; display: flex; align-items: center; gap: 4px;
        padding: 6px 8px; border-radius: 10px;
        background: rgba(14,18,24,0.86); border: 1px solid rgba(90,140,220,0.26);
        box-shadow: 0 6px 26px rgba(0,0,0,0.5); backdrop-filter: blur(6px);
        opacity: 1; transition: opacity 0.25s ease, transform 0.25s ease;
      }
      .ms-present-b {
        min-width: 30px; height: 28px; padding: 0 8px;
        display: inline-flex; align-items: center; justify-content: center;
        background: transparent; color: #cfdcea; cursor: pointer; font-size: 13px;
        border: 1px solid transparent; border-radius: 6px; transition: all 0.15s ease;
      }
      .ms-present-b:hover { background: rgba(255,255,255,0.1); border-color: rgba(90,140,220,0.3); }
      .ms-present-b.ms-on { background: #EF9F27; border-color: #EF9F27; color: #14181f; }
      .ms-present-sep { width: 1px; height: 18px; background: rgba(120,150,190,0.25); margin: 0 3px; }

      .ms-present-progress {
        position: fixed; left: 0; right: 0; bottom: 0; height: 3px; z-index: 9670;
        background: rgba(255,255,255,0.08); pointer-events: none;
        opacity: 1; transition: opacity 0.25s ease;
      }
      .ms-present-progress > i {
        display: block; height: 100%; width: 0;
        background: #EF9F27; transition: width 0.35s ease;
      }

      /* Idle: the chrome fades out and the cursor goes with it, so a projected
         briefing shows nothing but the slide. Any mouse move brings it back. */
      .ms-present-idle .ms-present-bar { opacity: 0; transform: translateX(-50%) translateY(8px); pointer-events: none; }
      .ms-present-idle .ms-present-progress { opacity: 0; }
      .ms-present-idle .ms-briefing-counter { opacity: 0; }
      .ms-present-idle .esri-view, .ms-present-idle .ms-present-annotator { cursor: none !important; }

      .ms-present-mode .ms-briefing-counter { transition: opacity 0.25s ease; }
    `;
    document.head.appendChild(style);
  }
}
