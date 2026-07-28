/**
 * BriefingEngine.ts
 *
 * Briefing — capture map states as slides, play them back with smooth goTo
 * transitions, stage reveal "builds" (appear / fade / flyIn / drawOn) driven by
 * the bundled GSAP ticker (window.TweenMax — durations in SECONDS), and arrange
 * slides in a drag-and-drop slide sorter (openSorter / moveSlide / duplicateSlide).
 *
 * PLAYBACK lives in Present/PresentSession — fullscreen, the presenter view
 * (notes / timer / next slide / jump grid, poppable to a second screen), the
 * laser / pen / spotlight annotator, blackout, autoplay, the auto-hiding
 * control bar and step-through builds. This file owns the slides; that one
 * owns the show. The public present API (enterPresent / exitPresent /
 * togglePresent / startAutoplay / stopAutoplay) simply forwards.
 *
 * Singleton mirroring the DeploymentBuilderEngine lifecycle, dynamically
 * loaded by SymbolEngine behind the `features.briefing` flag.
 *
 * Slides reference graphics by stable `graphic.attributes.id`, which
 * round-trips through plan save/load. A briefing is persisted as its own
 * JSON document (exportBriefing / importBriefing / saveBriefingToFile /
 * loadBriefingFromFile). PowerPoint decks import as screen-only slides via
 * importPptxFromFile (PptxImporter), and captureIntoSlide re-shoots the map
 * into an existing slide beneath its annotations.
 *
 * Global shortcuts (see _attachGlobalShortcuts — separate from the shared
 * KeyboardShortcutManager, since Briefing is an optional dynamically-loaded
 * feature): Ctrl+Shift+S add slide, Ctrl+Shift+B add blank slide,
 * Ctrl+Shift+P toggle the panel.
 */

import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import Extent from '@arcgis/core/geometry/Extent';
import Camera from '@arcgis/core/Camera';
import Polyline from '@arcgis/core/geometry/Polyline';
import Polygon from '@arcgis/core/geometry/Polygon';

import GraphicsLayerManager, {
  LAYER_NAMES,
  LEGACY_MIL_SYMBOLS_LAYER_ID,
  SYMBOL_LAYER_IDS,
} from '../../Managers/GraphicsLayerManager';
import type SerializationEngine from '../ImportExport/SerializationEngine';
import EngineLogger from '../../Support/EngineLogger';
import settingsData from '../../Data/Settings.json';
import { composeOverlayThumbnail } from './OverlayFabric';
import { layoutById } from './SlideLayouts';
import { openCount } from './SlideCommentUtils';
import { pruneLinks } from './SlideLinks';
import PresentSession from './Present/PresentSession';
import { type BuildGroup, revealedIds, type ScheduledStep } from './Present/BuildSequencer';
import type { SlideEditorHost } from './SlideEditor';
import type {
  BriefingDocument,
  BuildStep,
  CapturedViewState,
  ChartSpec,
  Slide,
  SlideBuildMode,
  SlideCommentEntry,
  SlideOverlay,
  SlideTransitionType,
} from './BriefingTypes';

const ENGINE_NAME = 'BriefingEngine';

/** 3D-headless takeScreenshot hangs — never await a thumbnail longer than this. */
const THUMBNAIL_TIMEOUT_MS = 2500;
const THUMB_WIDTH = 240;
const THUMB_HEIGHT = 135;
/** Full-res editor background gets longer, but still bounded. */
const FULL_SCREENSHOT_TIMEOUT_MS = 8000;

/** All layer ids a slide snapshots visibility for. */
const BRIEFING_LAYER_IDS: readonly string[] = [
  ...Object.values(LAYER_NAMES),
  LEGACY_MIL_SYMBOLS_LAYER_ID,
];

interface ActiveBuild {
  cancel: () => void;
}

class BriefingEngine {
  private static _instance: BriefingEngine | null = null;

  private _view: MapView | SceneView | null = null;
  private _enabled = false;

  private _slides: Slide[] = [];
  private _current = -1;
  private _transitioning = false;

  // Builds
  private _activeBuilds: ActiveBuild[] = [];
  /** Graphic ids this engine itself hid (slide exceptions + pending builds). */
  private _hiddenByBriefing: Set<string> = new Set();

  /**
   * Playback (present mode) lives in its own module — see Present/PresentSession.
   * Created lazily so the engine can be constructed headless.
   */
  private _presentSession: PresentSession | null = null;

  // Panel UI
  private _panel: HTMLElement | null = null;
  private _strip: HTMLElement | null = null;
  private _panelCountEl: HTMLElement | null = null;
  private _panelMinimized = false;
  /** Ctrl+Shift+S / Ctrl+Shift+B / Ctrl+Shift+P — see _attachGlobalShortcuts(). Attached once in start(), detached in destroy(). */
  private _globalShortcutHandler: ((e: KeyboardEvent) => void) | null = null;

  // Slide-sorter UI
  private _sorter: HTMLElement | null = null;
  private _sorterGrid: HTMLElement | null = null;
  private _sorterKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _dragIndex: number | null = null;

  // Slide editor
  private _slideEditor: any = null;

  private constructor() {}

  /** The playback session, built on first use against this engine as its host. */
  private get _present(): PresentSession {
    if (!this._presentSession) {
      this._presentSession = new PresentSession({
        getView: () => this._view,
        getSlides: () => this._slides,
        getIndex: () => this._current,
        cfg: () => this._cfg,
        goToSlide: (i: number) => this.goToSlide(i),
        firstVisibleIndex: () => this.firstVisibleIndex(),
        lastVisibleIndex: () => this.lastVisibleIndex(),
        nextVisibleIndex: (from: number, dir: 1 | -1) => this.nextVisibleIndex(from, dir),
        isScreenOnly: (s: Slide) => this._isScreenOnly(s),
        openSlideEditor: (i: number) => void this.openSlideEditor(i),
        cancelBuilds: () => this._cancelBuilds(),
        hideBuildTargets: (s: Slide) => this._hideBuildTargets(s),
        runBuildSteps: (steps: ScheduledStep[]) => this._runBuildSteps(steps),
        snapBuildGroups: (s: Slide, groups: BuildGroup[], revealed: number) =>
          this._snapBuildGroups(s, groups, revealed),
      });
    }
    return this._presentSession;
  }

  public static getInstance(): BriefingEngine {
    if (!BriefingEngine._instance) {
      BriefingEngine._instance = new BriefingEngine();
    }
    return BriefingEngine._instance;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  public start(view: MapView | SceneView, _serialEngine?: SerializationEngine): void {
    this._view = view;
    this._injectStyles();
    this._attachGlobalShortcuts();
    EngineLogger.success(ENGINE_NAME, 'BriefingEngine started');
  }

  /**
   * Ctrl+Shift+S / Ctrl+Shift+B / Ctrl+Shift+P — add slide / add blank slide /
   * toggle the Briefing panel, from anywhere. Bubble phase, like
   * KeyboardShortcutManager (which doesn't bind these — checked against it,
   * SlideEditor, and the harness in src/main.ts before picking them). Skips
   * while typing in a field, while the Slide Editor is open (its own
   * capture-phase tool shortcuts own the keyboard then), while Present mode
   * is active (its own handler owns the keyboard then), and while the
   * feature itself is disabled.
   */
  private _attachGlobalShortcuts(): void {
    if (this._globalShortcutHandler) return;
    this._globalShortcutHandler = (e: KeyboardEvent) => {
      if (!this._enabled || this.isPresenting() || this._slideEditor?.isOpen()) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable) {
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
      switch (e.key.toLowerCase()) {
        case 's':
          e.preventDefault();
          this.captureSlide();
          this.openPanel();
          break;
        case 'b':
          e.preventDefault();
          this.addBlankSlide();
          this.openPanel();
          break;
        case 'p':
          e.preventDefault();
          this.togglePanel();
          break;
      }
    };
    document.addEventListener('keydown', this._globalShortcutHandler);
  }

  private _detachGlobalShortcuts(): void {
    if (!this._globalShortcutHandler) return;
    document.removeEventListener('keydown', this._globalShortcutHandler);
    this._globalShortcutHandler = null;
  }

  public onViewChanged(view: MapView | SceneView): void {
    // Present mode must never survive a view switch — restore HUD/UI first.
    this.exitPresent();
    this._slideEditor?.close(false);
    this._cancelBuilds();
    this._view = view;
  }

  public enable(): void {
    this._enabled = true;
  }

  public disable(): void {
    this._enabled = false;
    this.exitPresent();
    this._slideEditor?.close(false);
    this._cancelBuilds();
    this.closePanel();
    this.closeSorter();
  }

  public destroy(): void {
    // Silent: teardown must not stop to ask whether to keep present-mode ink.
    this._presentSession?.exit({ silent: true });
    this.disable();
    this._detachGlobalShortcuts();
    if (this._panel) {
      this._panel.remove();
      this._panel = null;
      this._strip = null;
    }
    if (this._sorter) {
      this._sorter.remove();
      this._sorter = null;
      this._sorterGrid = null;
    }
    this._view = null;
    BriefingEngine._instance = null;
  }

  private get _layerManager(): GraphicsLayerManager | null {
    return this._view ? GraphicsLayerManager.getInstance(this._view) : null;
  }

  private get _cfg(): any {
    // settingsData is mutated in place by SymbolEngine.onSettingChanged, so
    // reading lazily always sees the live briefing.* values.
    return (settingsData as any).briefing ?? {};
  }

  // ── Slides: capture / query / edit ─────────────────────────────────────────

  /**
   * Snapshot the current view (2D extent or 3D camera), layer visibility and
   * per-graphic hidden exceptions into a new slide. The thumbnail is fetched
   * lazily behind a timeout so a stuck 3D-headless takeScreenshot never
   * freezes capture.
   */
  public captureSlide(title?: string): Slide | null {
    const v: any = this._view;
    if (!v || !this._enabled) return null;

    const snap = this._snapshotMapState();
    const slide: Slide = {
      id: this._uuid(),
      title: title ?? `Slide ${this._slides.length + 1}`,
      view: snap.view,
      visibleLayers: snap.visibleLayers,
      graphicVisibility: snap.graphicVisibility,
      transitionMs: Number(this._cfg.defaultTransitionMs) || 1000,
    };
    this._slides.push(slide);
    this._current = this._slides.length - 1;
    this._refreshStrip();
    EngineLogger.success(ENGINE_NAME, `Captured "${slide.title}" (${this._slides.length} slides)`);

    void this._tryThumbnail().then((dataUrl) => {
      if (dataUrl) {
        slide.thumbnailDataUrl = dataUrl;
        this._refreshStrip();
      }
    });
    // Frozen full-res fallback for the slide editor — captured now because
    // this is the only time the live map is guaranteed to hold this slide's
    // symbol graphics (see _symbolGraphicsMissing / prepareBackground).
    void this._tryFullScreenshot().then((dataUrl) => {
      if (dataUrl) slide.backgroundDataUrl = dataUrl;
    });
    return slide;
  }

  /**
   * Append an empty screen-only slide (same shape as an imported PPTX slide:
   * no extent/camera, playback leaves the map untouched, `visibleLayers` is
   * empty so nothing gets toggled). The solid-white background raster is what
   * the editor, present mode and PPTX export all show — open the slide in the
   * editor (✎) to put text and shapes on it. captureIntoSlide() can later
   * turn it into a live map slide.
   */
  public addBlankSlide(title?: string): Slide | null {
    if (!this._enabled) return null;
    const v: any = this._view;
    const bg = this._makeBlankBackground();
    const slide: Slide = {
      id: this._uuid(),
      title: title ?? `Slide ${this._slides.length + 1}`,
      view: { capturedIn: v?.type === '3d' ? '3d' : '2d' },
      visibleLayers: {},
      transitionMs: Number(this._cfg.defaultTransitionMs) || 1000,
      backgroundDataUrl: bg?.background,
      thumbnailDataUrl: bg?.thumbnail,
    };
    this._slides.push(slide);
    this._current = this._slides.length - 1;
    this._refreshStrip();
    EngineLogger.success(
      ENGINE_NAME,
      `Added blank slide "${slide.title}" (${this._slides.length} slides)`,
    );
    return slide;
  }

  /** Solid-white rasters a blank slide stores as its background + thumbnail. */
  private _makeBlankBackground(): { background: string; thumbnail: string } | null {
    const paint = (w: number, h: number): string | null => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      if (!g) return null;
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
      return c.toDataURL('image/png');
    };
    const background = paint(1280, 720);
    const thumbnail = paint(THUMB_WIDTH, THUMB_HEIGHT);
    return background && thumbnail ? { background, thumbnail } : null;
  }

  /**
   * Re-shoot the current map into an EXISTING slide: view state, layer
   * visibility, background and thumbnail are refreshed while title, notes,
   * annotation overlays and builds are kept — the new capture slides in
   * BENEATH the slide's elements. Works on imported (screen-only) slides
   * too, turning them into live map slides. With no target slide the call
   * degrades to captureSlide().
   */
  public captureIntoSlide(ref?: number | string): Slide | null {
    const v: any = this._view;
    if (!v || !this._enabled) return null;
    const idx = ref == null ? this._current : this._slideIndex(ref);
    if (idx < 0 || idx >= this._slides.length) {
      EngineLogger.nextStep(ENGINE_NAME, 'No slide selected — capturing a new slide instead');
      return this.captureSlide();
    }

    const slide = this._slides[idx];
    const snap = this._snapshotMapState();
    slide.view = snap.view;
    slide.visibleLayers = snap.visibleLayers;
    slide.graphicVisibility = snap.graphicVisibility;
    this._current = idx;
    this._refreshStrip();
    EngineLogger.success(
      ENGINE_NAME,
      `Captured map into "${slide.title}" — beneath ${slide.overlays?.length ?? 0} annotation(s)`,
    );

    void this._tryThumbnail().then(async (dataUrl) => {
      if (!dataUrl) return;
      // The strip tile should show what the slide really contains — overlays
      // composited over the fresh map shot (plain map shot when compositing
      // is unavailable).
      slide.thumbnailDataUrl = (await this._composeThumbnail(dataUrl, slide.overlays)) ?? dataUrl;
      this._refreshStrip();
    });
    void this._tryFullScreenshot().then((dataUrl) => {
      if (dataUrl) slide.backgroundDataUrl = dataUrl;
    });
    return slide;
  }

  /** Current view + layer visibility + hidden-graphic exceptions, slide-shaped. */
  private _snapshotMapState(): {
    view: CapturedViewState;
    visibleLayers: Record<string, boolean>;
    graphicVisibility?: Record<string, boolean>;
  } {
    const v: any = this._view;
    const viewState: CapturedViewState = { capturedIn: v?.type === '3d' ? '3d' : '2d' };
    try {
      if (viewState.capturedIn === '2d') {
        viewState.extent = v.extent?.toJSON();
        if (typeof v.rotation === 'number') viewState.rotation = v.rotation;
      } else {
        viewState.camera = v.camera?.toJSON();
      }
    } catch (err) {
      EngineLogger.error(ENGINE_NAME, `Could not snapshot view state: ${err}`);
    }

    const lm = this._layerManager;
    const visibleLayers: Record<string, boolean> = {};
    for (const name of BRIEFING_LAYER_IDS) {
      const layer = lm?.getLayer(name);
      if (layer) visibleLayers[name] = layer.visible !== false;
    }

    // Exceptions only: record graphics currently hidden, keyed by stable id.
    const graphicVisibility: Record<string, boolean> = {};
    for (const layerId of SYMBOL_LAYER_IDS) {
      const layer = lm?.getLayer(layerId);
      (layer?.graphics as any)?.forEach((g: Graphic) => {
        const id = g.attributes?.id;
        if (id && g.visible === false) graphicVisibility[id] = false;
      });
    }

    return {
      view: viewState,
      visibleLayers,
      graphicVisibility: Object.keys(graphicVisibility).length ? graphicVisibility : undefined,
    };
  }

  /**
   * Draw a slide's overlays onto a fresh map thumbnail. Shared with
   * PptxImporter — see OverlayFabric.composeOverlayThumbnail.
   */
  private _composeThumbnail(
    mapThumb: string,
    overlays: readonly SlideOverlay[] | undefined,
  ): Promise<string | undefined> {
    return composeOverlayThumbnail(mapThumb, overlays);
  }

  public getSlides(): readonly Slide[] {
    return this._slides;
  }

  public get currentIndex(): number {
    return this._current;
  }

  public removeSlide(ref: number | string): void {
    const idx = this._slideIndex(ref);
    if (idx < 0) return;
    this._slides.splice(idx, 1);
    if (this._current >= this._slides.length) this._current = this._slides.length - 1;
    this._refreshStrip();
  }

  public renameSlide(ref: number | string, title: string): void {
    const idx = this._slideIndex(ref);
    if (idx < 0) return;
    this._slides[idx].title = title;
    this._refreshStrip();
  }

  public setSlideNotes(ref: number | string, notes: string): void {
    const idx = this._slideIndex(ref);
    if (idx >= 0) this._slides[idx].notes = notes;
  }

  /**
   * Put a slide in a PowerPoint section (empty/undefined removes it).
   * Consecutive slides sharing a title form one section on export — see
   * Slide.section.
   */
  public setSlideSection(ref: number | string, section?: string): void {
    const idx = this._slideIndex(ref);
    if (idx < 0) return;
    const title = String(section ?? '').trim();
    if (title) this._slides[idx].section = title;
    else delete this._slides[idx].section;
    this._refreshStrip();
  }

  /** Distinct section titles in slide order — what the exporter declares. */
  public getSections(): string[] {
    const seen: string[] = [];
    for (const s of this._slides) {
      const t = String(s.section ?? '').trim();
      if (t && !seen.includes(t)) seen.push(t);
    }
    return seen;
  }

  /**
   * Add a chart overlay to a slide (default: the current one).
   *
   * The chart persists as a ChartSpec, so the editor re-renders it at any size
   * and PptxExporter emits a NATIVE PowerPoint chart from the same model —
   * see ChartFactory. `box` is normalized [0..1] like every other overlay.
   *
   * When the slide editor happens to be open on the target slide the overlay
   * is handed to it instead of written to the model, because the editor would
   * otherwise save its own (older) overlay list straight over the top.
   */
  public async addChartOverlay(
    spec: ChartSpec,
    ref?: number | string,
    box: { x: number; y: number; w: number; h: number } = { x: 0.08, y: 0.16, w: 0.42, h: 0.4 },
  ): Promise<SlideOverlay | null> {
    if (!this._enabled) return null;
    const idx = ref == null ? this._current : this._slideIndex(ref);
    const slide = this._slides[idx];
    if (!slide) {
      EngineLogger.error(ENGINE_NAME, 'No slide to add a chart to — capture or add one first');
      return null;
    }
    const overlay: SlideOverlay = { id: this._uuid(), kind: 'chart', ...box, chart: spec };

    // Dynamic, exactly as openSlideEditor does — the editor is a large module
    // and must not be pulled in just because a chart was added. When it IS
    // open the module is already resolved, so this costs nothing.
    const { default: SlideEditor } = await import('./SlideEditor');
    const editor = SlideEditor.getInstance();
    if (editor.isOpen() && editor.editingIndex === idx) {
      if (editor.insertOverlays([overlay])) {
        EngineLogger.success(ENGINE_NAME, `Chart inserted into the open editor (${spec.type})`);
        return overlay;
      }
    }

    slide.overlays = [...(slide.overlays ?? []), overlay];
    this._refreshStrip();
    EngineLogger.success(
      ENGINE_NAME,
      `Chart added to "${slide.title}" (${spec.type}, ${spec.series.length} series)`,
    );
    return overlay;
  }

  public setSlideTransition(ref: number | string, type?: SlideTransitionType): void {
    const idx = this._slideIndex(ref);
    if (idx >= 0) this._slides[idx].slideTransition = type;
  }

  // ── Hidden slides ──────────────────────────────────────────────────────────

  /**
   * PowerPoint's "Hide Slide": the slide stays in the deck and keeps its
   * number, but playback steps over it. `hidden` omitted toggles.
   *
   * Only the STEPPING paths skip it — goToSlide(), the sorter tiles and a typed
   * slide number all still reach a hidden slide on purpose, because that is how
   * you author one.
   */
  public setSlideHidden(ref: number | string, hidden?: boolean): void {
    const idx = this._slideIndex(ref);
    if (idx < 0) return;
    const slide = this._slides[idx];
    const next = hidden ?? !slide.hidden;
    slide.hidden = next || undefined; // absent, not `false` — keeps the JSON clean
    this._refreshStrip();
    EngineLogger.nextStep(
      ENGINE_NAME,
      `Slide ${idx + 1} "${slide.title}" ${next ? 'hidden — skipped in playback' : 'shown again'}`,
    );
  }

  public toggleSlideHidden(ref: number | string): void {
    this.setSlideHidden(ref);
  }

  /** Index of the first slide playback would show, or -1 when every slide is hidden. */
  public firstVisibleIndex(): number {
    return this._slides.findIndex((s) => !s.hidden);
  }

  /** Index of the last slide playback would show, or -1 when every slide is hidden. */
  public lastVisibleIndex(): number {
    for (let i = this._slides.length - 1; i >= 0; i--) {
      if (!this._slides[i].hidden) return i;
    }
    return -1;
  }

  /**
   * The next visible slide in `dir` from `from` (exclusive), or -1 when there is
   * none. Every stepping path goes through here, so the skip rule lives in one
   * place — a hidden slide is passed over even when several sit in a row, and a
   * briefer standing ON a hidden slide still steps out of it correctly.
   */
  public nextVisibleIndex(from: number, dir: 1 | -1): number {
    for (let i = from + dir; i >= 0 && i < this._slides.length; i += dir) {
      if (!this._slides[i].hidden) return i;
    }
    return -1;
  }

  /** How many slides playback will skip — drives the sorter's count line. */
  private _hiddenCount(): number {
    return this._slides.reduce((n, s) => n + (s.hidden ? 1 : 0), 0);
  }

  /**
   * Move a slide so it ends up at index `to`. The current-slide marker keeps
   * following the slide it was on. Order is the persistence format — the
   * exported BriefingDocument simply serializes the array.
   */
  public moveSlide(from: number | string, to: number): void {
    const fromIdx = this._slideIndex(from);
    if (fromIdx < 0) return;
    const currentId = this._slides[this._current]?.id;
    const [slide] = this._slides.splice(fromIdx, 1);
    const clamped = Math.max(0, Math.min(Math.round(to), this._slides.length));
    this._slides.splice(clamped, 0, slide);
    if (currentId) this._current = this._slides.findIndex((s) => s.id === currentId);
    this._refreshStrip();
  }

  /** Deep-copy a slide (new id, " (copy)" title) and insert it right after the original. */
  public duplicateSlide(ref: number | string): Slide | null {
    const idx = this._slideIndex(ref);
    if (idx < 0) return null;
    const copy: Slide = JSON.parse(JSON.stringify(this._slides[idx]));
    copy.id = this._uuid();
    copy.title = `${this._slides[idx].title} (copy)`;
    const currentId = this._slides[this._current]?.id;
    this._slides.splice(idx + 1, 0, copy);
    if (currentId) this._current = this._slides.findIndex((s) => s.id === currentId);
    this._refreshStrip();
    return copy;
  }

  /**
   * How a slide's builds play in present mode.
   *
   * 'auto' (the default, and what every pre-existing briefing uses) fires every
   * step on one shared clock at its absolute delayMs. 'click' groups the steps
   * by their `trigger` and waits for the briefer to advance between groups —
   * Space / → / click reveal the next group, and only once they are all out
   * does advancing move to the next slide.
   */
  public setSlideBuildMode(ref: number | string, mode?: SlideBuildMode): void {
    const idx = this._slideIndex(ref);
    if (idx >= 0) this._slides[idx].buildMode = mode === 'click' ? 'click' : undefined;
  }

  /**
   * Append a staged-reveal step to a slide (defaults from briefing settings).
   * `trigger` only matters once the slide's buildMode is 'click' — see
   * setSlideBuildMode and BuildTrigger.
   */
  public addBuildStep(
    ref: number | string,
    step: Partial<BuildStep> & { graphicId: string },
  ): BuildStep | null {
    const idx = this._slideIndex(ref);
    if (idx < 0 || !step.graphicId) return null;
    const slide = this._slides[idx];
    const full: BuildStep = {
      graphicId: step.graphicId,
      effect: step.effect ?? (this._cfg.defaultEffect as any) ?? 'appear',
      delayMs: step.delayMs ?? 0,
      durationMs: step.durationMs ?? 800,
      flyFrom: step.flyFrom,
      trigger: step.trigger,
    };
    (slide.builds ??= []).push(full);
    return full;
  }

  public clearBuildSteps(ref: number | string): void {
    const idx = this._slideIndex(ref);
    if (idx >= 0) this._slides[idx].builds = undefined;
  }

  private _slideIndex(ref: number | string): number {
    if (typeof ref === 'number') {
      return ref >= 0 && ref < this._slides.length ? ref : -1;
    }
    return this._slides.findIndex((s) => s.id === ref);
  }

  // ── Playback ───────────────────────────────────────────────────────────────

  /**
   * Fly to a slide, re-apply its layer/graphic visibility, then run its
   * builds. Rapid Next/Prev is debounced: advances during an in-flight goTo
   * are ignored (the transition itself swallows AbortError via .catch).
   */
  public async goToSlide(index: number): Promise<void> {
    const v: any = this._view;
    if (!v || index < 0 || index >= this._slides.length) return;
    if (this._transitioning) return;
    this._transitioning = true;

    this._cancelBuilds();
    const prevSlide = this._current >= 0 ? this._slides[this._current] : null;
    const prevOverlay = this._presentSession?.beginSlideChange() ?? null;
    this._current = index;
    const slide = this._slides[index];
    this._refreshStrip();

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
    // Step-through claims a click-mode slide's builds while presenting; every
    // other case keeps the original shared-clock timer schedule.
    if (!this._presentSession?.armBuilds(slide)) this._runBuilds(slide);
    await this._presentSession?.onSlideEntered(slide, prevSlide, prevOverlay);
  }

  /**
   * In present mode this is one briefer ADVANCE, so a slide with click-mode
   * builds reveals its next group before moving on. Outside present mode it is
   * a plain slide step — over hidden slides, so stepping matches playback.
   */
  public async nextSlide(): Promise<void> {
    if (this._presentSession?.isActive()) {
      await this._presentSession.advance();
      return;
    }
    const next = this.nextVisibleIndex(this._current, 1);
    if (next >= 0) await this.goToSlide(next);
  }

  public async prevSlide(): Promise<void> {
    if (this._presentSession?.isActive()) {
      await this._presentSession.back();
      return;
    }
    const prev = this.nextVisibleIndex(this._current, -1);
    if (prev >= 0) await this.goToSlide(prev);
  }

  /**
   * Headless slide apply for the PPTX exporter: jump (no animation) to the
   * slide's view state and apply its visibility instantly. `revealedBuilds`
   * is the number of leading build steps whose targets are shown — omit for
   * the slide's final (all-revealed) state, pass 0..n for explode-builds.
   */
  public async applySlideForExport(index: number, revealedBuilds?: number): Promise<Slide | null> {
    const v: any = this._view;
    if (!v || index < 0 || index >= this._slides.length) return null;
    this._cancelBuilds();
    this._presentSession?.cancelTransition();
    this._presentSession?.clearOverlays();
    this._current = index;
    const slide = this._slides[index];
    this._refreshStrip();

    const target = this._resolveGoToTarget(slide.view);
    if (target) await v.goTo(target, { animate: false }).catch(() => {});

    this._applySlideState(slide);
    const builds = slide.builds ?? [];
    const reveal = revealedBuilds ?? builds.length;
    builds.forEach((step, i) => {
      const g = this._findGraphicById(step.graphicId);
      if (!g) return;
      g.visible = i < reveal;
      if (!g.visible) this._hiddenByBriefing.add(step.graphicId);
    });
    return slide;
  }

  /**
   * Resolve the goTo target from stored state — prefer the representation
   * matching the active view type; fall back to the other and let goTo adapt.
   */
  private _resolveGoToTarget(state: CapturedViewState): any {
    const is3D = this._view?.type === '3d';
    try {
      if (is3D && state.camera) return Camera.fromJSON(state.camera);
      if (!is3D && state.extent) {
        const extent = Extent.fromJSON(state.extent);
        return state.rotation != null ? { target: extent, rotation: state.rotation } : extent;
      }
      if (state.camera) {
        const camera = Camera.fromJSON(state.camera);
        // MapView.goTo does not accept a Camera — a 3D-captured slide played
        // in 2D degrades to centering on the camera position (zoom untouched).
        return is3D ? camera : { target: camera.position };
      }
      if (state.extent) return Extent.fromJSON(state.extent);
    } catch (err) {
      EngineLogger.error(ENGINE_NAME, `Could not resolve slide view state: ${err}`);
    }
    return null;
  }

  /** Re-apply a slide's layer visibility and per-graphic exceptions. */
  private _applySlideState(slide: Slide): void {
    const lm = this._layerManager;
    if (!lm) return;

    // Restore everything this engine hid on previous slides before applying
    // the new slide's exceptions — never stomp visibility managed elsewhere
    // (declutter zoom-hiding etc.).
    for (const id of this._hiddenByBriefing) {
      const g = this._findGraphicById(id);
      if (g) g.visible = true;
    }
    this._hiddenByBriefing.clear();

    for (const [name, vis] of Object.entries(slide.visibleLayers ?? {})) {
      const layer = lm.getLayer(name);
      if (layer) layer.visible = vis;
    }

    for (const [id, vis] of Object.entries(slide.graphicVisibility ?? {})) {
      const g = this._findGraphicById(id);
      if (!g) continue;
      g.visible = vis;
      if (!vis) this._hiddenByBriefing.add(id);
    }
  }

  // ── Build effects ──────────────────────────────────────────────────────────

  /**
   * Schedule every BuildStep at its delayMs from slide-enter (shared clock,
   * steps may overlap). Build targets start hidden and reveal via the effect.
   */
  private _runBuilds(slide: Slide): void {
    const steps = slide.builds ?? [];
    if (!steps.length) return;

    // Hide all build targets up front so staggered steps reveal them.
    for (const step of steps) {
      const g = this._findGraphicById(step.graphicId);
      if (g) {
        g.visible = false;
        this._hiddenByBriefing.add(step.graphicId);
      }
    }

    for (const step of steps) {
      const timer = window.setTimeout(() => this._startEffect(step), Math.max(0, step.delayMs));
      this._activeBuilds.push({
        cancel: () => {
          clearTimeout(timer);
          const g = this._findGraphicById(step.graphicId);
          if (g) g.visible = true;
        },
      });
    }
  }

  private _startEffect(step: BuildStep): void {
    const g = this._findGraphicById(step.graphicId);
    if (!g) return;
    const TweenMax = (window as any).TweenMax;
    const durationSec = Math.max(0, step.durationMs) / 1000; // GSAP wants SECONDS

    if (!TweenMax || step.durationMs <= 0 || step.effect === 'appear') {
      g.visible = true;
      return;
    }

    switch (step.effect) {
      case 'fade':
        this._runFade(g, durationSec, TweenMax);
        break;
      case 'flyIn':
        this._runFlyIn(g, step, durationSec, TweenMax);
        break;
      case 'drawOn':
        this._runDrawOn(g, durationSec, TweenMax);
        break;
      default:
        g.visible = true;
    }
  }

  /**
   * ArcGIS graphics have no per-graphic opacity — fade through a private temp
   * layer's opacity, then restore the graphic to its origin layer.
   */
  private _runFade(g: Graphic, durationSec: number, TweenMax: any): void {
    const v: any = this._view;
    const origin: any = (g as any).layer;
    if (!v?.map || !origin) {
      g.visible = true;
      return;
    }

    const temp = new GraphicsLayer({
      listMode: 'hide',
      elevationInfo: { mode: 'on-the-ground' },
    } as any);
    v.map.add(temp);
    origin.remove(g);
    temp.add(g);
    temp.opacity = 0;
    g.visible = true;

    let finalized = false;
    const finalize = () => {
      if (finalized) return;
      finalized = true;
      try {
        temp.remove(g);
        origin.add(g);
        this._view?.map?.remove(temp);
      } catch {
        /* view may be tearing down */
      }
    };

    const tween = TweenMax.to(temp, durationSec, { opacity: 1, onComplete: finalize });
    this._activeBuilds.push({
      cancel: () => {
        try {
          tween?.kill?.();
        } catch {}
        finalize();
        g.visible = true;
      },
    });
  }

  /** Translate in from an offset, easing back to the true position. */
  private _runFlyIn(g: Graphic, step: BuildStep, durationSec: number, TweenMax: any): void {
    const geom: any = g.geometry;
    if (!geom) {
      g.visible = true;
      return;
    }
    const original = geom.clone();
    const extentWidth = (this._view as any)?.extent?.width ?? 4000;
    const dx = step.flyFrom?.dx ?? -extentWidth / 4;
    const dy = step.flyFrom?.dy ?? 0;

    const state = { t: 1 };
    g.geometry = this._translateGeometry(original, dx, dy);
    g.visible = true;

    const tween = TweenMax.to(state, durationSec, {
      t: 0,
      onUpdate: () => {
        g.geometry = this._translateGeometry(original, dx * state.t, dy * state.t);
      },
      onComplete: () => {
        g.geometry = original;
      },
    });
    this._activeBuilds.push({
      cancel: () => {
        try {
          tween?.kill?.();
        } catch {}
        g.geometry = original;
        g.visible = true;
      },
    });
  }

  /** Progressive polyline/ring reveal by re-assigning a growing vertex slice. */
  private _runDrawOn(g: Graphic, durationSec: number, TweenMax: any): void {
    const geom: any = g.geometry;
    if (!geom || (geom.type !== 'polyline' && geom.type !== 'polygon')) {
      // Points / other geometries have nothing to trace — appear instead.
      g.visible = true;
      return;
    }
    const original = geom.clone();
    const isLine = original.type === 'polyline';
    const paths: number[][][] = isLine ? original.paths : original.rings;
    const total = paths.reduce((n: number, p: number[][]) => n + p.length, 0);
    if (total < 3) {
      g.visible = true;
      return;
    }

    const sr = original.spatialReference;
    const state = { p: 0 };
    const applyFraction = (fraction: number) => {
      let budget = Math.max(2, Math.round(total * fraction));
      const partial: number[][][] = [];
      for (const path of paths) {
        if (budget <= 0) break;
        const take = Math.min(path.length, Math.max(2, budget));
        partial.push(path.slice(0, take));
        budget -= take;
      }
      g.geometry = isLine
        ? new Polyline({ paths: partial, spatialReference: sr })
        : new Polygon({ rings: partial, spatialReference: sr });
    };

    applyFraction(0);
    g.visible = true;

    const tween = TweenMax.to(state, durationSec, {
      p: 1,
      onUpdate: () => applyFraction(state.p),
      onComplete: () => {
        g.geometry = original;
      },
    });
    this._activeBuilds.push({
      cancel: () => {
        try {
          tween?.kill?.();
        } catch {}
        g.geometry = original;
        g.visible = true;
      },
    });
  }

  /** Pure translation clone — geometry only; builds always end at the true position. */
  private _translateGeometry(original: any, dx: number, dy: number): any {
    const clone = original.clone();
    if (clone.type === 'point') {
      clone.x += dx;
      clone.y += dy;
    } else if (clone.type === 'polyline') {
      clone.paths = clone.paths.map((path: number[][]) =>
        path.map((pt: number[]) => [pt[0] + dx, pt[1] + dy, ...pt.slice(2)]),
      );
    } else if (clone.type === 'polygon') {
      clone.rings = clone.rings.map((ring: number[][]) =>
        ring.map((pt: number[]) => [pt[0] + dx, pt[1] + dy, ...pt.slice(2)]),
      );
    }
    return clone;
  }

  private _cancelBuilds(): void {
    const builds = this._activeBuilds;
    this._activeBuilds = [];
    for (const b of builds) {
      try {
        b.cancel();
      } catch {}
    }
  }

  // ── Present mode (delegated to Present/PresentSession) ─────────────────────

  /**
   * Distraction-free playback. Everything about a running slideshow — the
   * keyboard, fullscreen, the control bar, annotation tools, the presenter
   * panel and step-through builds — lives in PresentSession; this engine only
   * owns the slides it plays.
   */
  public enterPresent(): void {
    if (!this._enabled) return;
    this.closeSorter();
    this._present.enter();
  }

  /** Idempotent — also called from onViewChanged / disable / destroy. */
  public exitPresent(): void {
    this._presentSession?.exit();
  }

  public togglePresent(): void {
    this._presentSession?.isActive() ? this.exitPresent() : this.enterPresent();
  }

  /** True while a slideshow is running. */
  public isPresenting(): boolean {
    return !!this._presentSession?.isActive();
  }

  /** Show/hide the presenter view (notes, timer, next-slide preview, jump grid). */
  public togglePresenterPanel(open?: boolean): void {
    this._presentSession?.togglePanel(open);
  }

  public startAutoplay(intervalMs?: number): void {
    this._present.startAutoplay(intervalMs);
  }

  public stopAutoplay(): void {
    this._presentSession?.stopAutoplay();
  }

  public isAutoplaying(): boolean {
    return !!this._presentSession?.autoplaying;
  }

  // ── Build playback hooks used by PresentSession's step-through ─────────────

  /** Hide every graphic the slide's builds target, so steps can reveal them. */
  private _hideBuildTargets(slide: Slide): void {
    for (const step of slide.builds ?? []) {
      const g = this._findGraphicById(step.graphicId);
      if (!g) continue;
      g.visible = false;
      this._hiddenByBriefing.add(step.graphicId);
    }
  }

  /**
   * Play one click group: each step fires at its own offset from NOW (the
   * group's clock), rather than from slide-enter as the auto schedule does.
   */
  private _runBuildSteps(steps: ScheduledStep[]): void {
    for (const { step, at } of steps) {
      const timer = window.setTimeout(() => this._startEffect(step), Math.max(0, at));
      this._activeBuilds.push({
        cancel: () => {
          clearTimeout(timer);
          const g = this._findGraphicById(step.graphicId);
          if (g) g.visible = true;
        },
      });
    }
  }

  /**
   * Snap graphic visibility to "the first `revealed` groups have played" with
   * no animation — how step-through moves BACKWARDS, and how a slide entered
   * in reverse arrives fully built.
   */
  private _snapBuildGroups(slide: Slide, groups: BuildGroup[], revealed: number): void {
    const shown = revealedIds(groups, revealed);
    for (const step of slide.builds ?? []) {
      const g = this._findGraphicById(step.graphicId);
      if (!g) continue;
      const visible = shown.has(step.graphicId);
      g.visible = visible;
      if (visible) this._hiddenByBriefing.delete(step.graphicId);
      else this._hiddenByBriefing.add(step.graphicId);
    }
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  public exportBriefing(): BriefingDocument {
    // version 10 = hidden slides; 9 = overlay links; 8 = per-slide buildMode +
    // build triggers; 7 = review comments; 6 = milsym overlays + block/tactical
    // arrows; 5 = table overlays + text listStyle; 4 = slides may be screen-only
    // (imported PPTX: no extent/camera, backgroundDataUrl is the slide);
    // 3 = full-res background fallback; 2 = editor overlays. Import accepts
    // 1–10 (every added field is optional, so it reads older documents
    // unchanged).
    return { version: 10, slides: this._slides.map((s) => ({ ...s })) };
  }

  /**
   * Every review comment in the briefing, flattened with a typed anchor — the
   * entry point for scripting and tooling ("show me everything people flagged").
   */
  public listComments(): Array<{
    slideIndex: number;
    slideId: string;
    id: string;
    anchor:
      | { type: 'overlay'; overlayId: string }
      | { type: 'point'; x: number; y: number }
      | { type: 'slide' };
    author: string;
    at: string;
    text: string;
    resolved: boolean;
    replies: SlideCommentEntry[];
  }> {
    return this._slides.flatMap((s, slideIndex) =>
      (s.comments ?? []).map((c) => ({
        slideIndex,
        slideId: s.id,
        id: c.id,
        anchor: c.overlayId
          ? ({ type: 'overlay', overlayId: c.overlayId } as const)
          : typeof c.x === 'number' && typeof c.y === 'number'
            ? ({ type: 'point', x: c.x, y: c.y } as const)
            : ({ type: 'slide' } as const),
        author: c.author,
        at: c.at,
        text: c.text,
        resolved: !!c.resolved,
        replies: c.replies ?? [],
      })),
    );
  }

  public importBriefing(doc: BriefingDocument | null | undefined): void {
    if (!doc || !Array.isArray(doc.slides)) {
      EngineLogger.error(ENGINE_NAME, 'Invalid briefing document');
      return;
    }
    this._cancelBuilds();
    this._slides = doc.slides.map((s) => ({ ...s }));
    this._current = -1;
    // A link whose target slide was deleted in another session would look
    // clickable in the editor and do nothing in present mode — same dangling
    // reference `labelOf` and comment anchors drop on load.
    const droppedLinks = pruneLinks(this._slides);
    this._refreshStrip();
    EngineLogger.success(ENGINE_NAME, `Briefing imported — ${this._slides.length} slides`);
    if (droppedLinks) {
      EngineLogger.nextStep(
        ENGINE_NAME,
        `${droppedLinks} link${droppedLinks > 1 ? 's' : ''} pointed at slides that are no longer in the briefing — dropped`,
      );
    }
    // Surface completion + slide count by popping the strip open — importing
    // a briefing with no visible feedback otherwise looks like it did nothing.
    this.openPanel();
  }

  public saveBriefingToFile(filename?: string): void {
    this._downloadJSON(this.exportBriefing(), filename ?? `pams8_briefing_${Date.now()}.json`);
  }

  public loadBriefingFromFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          this.importBriefing(JSON.parse(String(reader.result)));
        } catch (err) {
          EngineLogger.error(ENGINE_NAME, `Could not parse briefing file: ${err}`);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  /**
   * Import a PowerPoint (.pptx) file — its slides (text, shapes, pictures,
   * tables, speaker notes) are parsed by PptxImporter and APPENDED to the
   * current briefing as screen-only slides (no map state; playback leaves
   * the map untouched). pptxgenjs cannot read .pptx, so the parser is our
   * own OOXML reader over the bundle's JSZip — see PptxImporter.ts.
   */
  public importPptxFromFile(): void {
    if (!this._enabled) {
      EngineLogger.error(ENGINE_NAME, 'Briefing disabled — enable features.briefing first');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept =
      '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        EngineLogger.nextStep(ENGINE_NAME, `Importing "${file.name}"…`);
        // Parser (and the pptxgen bundle it piggybacks on for JSZip) loads on
        // first use only.
        const { parsePptx } = await import('../ImportExport/PptxImporter');
        const v: any = this._view;
        const result = await parsePptx(await file.arrayBuffer(), {
          capturedIn: v?.type === '3d' ? '3d' : '2d',
          defaultTransitionMs: Number(this._cfg.defaultTransitionMs) || 1000,
        });
        for (const w of result.warnings) EngineLogger.nextStep(ENGINE_NAME, w);
        if (!result.slides.length) {
          EngineLogger.error(ENGINE_NAME, `No slides could be read from "${file.name}"`);
          return;
        }
        const firstNew = this._slides.length;
        this._slides.push(...result.slides);
        this._current = firstNew;
        this._refreshStrip();
        this.openPanel();
        EngineLogger.success(
          ENGINE_NAME,
          `Imported ${result.slides.length} slide(s) from "${file.name}"` +
            (firstNew ? ` — appended after slide ${firstNew}` : '') +
            ((): string => {
              const h = result.slides.filter((s) => s.hidden).length;
              return h ? ` · ${h} came in hidden (PowerPoint had them hidden too)` : '';
            })(),
        );
      } catch (err) {
        EngineLogger.error(ENGINE_NAME, `PPTX import failed: ${err}`);
      }
    };
    input.click();
  }

  // ── Slide-strip panel ──────────────────────────────────────────────────────

  public openPanel(): void {
    if (!this._panel) this._buildPanel();
    this._panel!.classList.add('ms-visible');
    this._panelMinimized = false;
    this._applyPanelMinimizeState();
    this._refreshStrip();
  }

  public closePanel(): void {
    if (this._panel) this._panel.classList.remove('ms-visible');
  }

  public togglePanel(): void {
    this._panel?.classList.contains('ms-visible') ? this.closePanel() : this.openPanel();
  }

  private _buildPanel(): void {
    const panel = document.createElement('div');
    panel.id = 'briefingPanel';
    panel.innerHTML = `
      <div class="ms-briefing-head" id="briefing-drag-handle">
        <span class="ms-briefing-icon">⛶</span>
        <span class="ms-briefing-title">Briefing</span>
        <span class="ms-briefing-count"></span>
        <span class="ms-briefing-head-spacer"></span>
        <button class="ms-briefing-iconbtn" data-act="minimize" title="Minimize">﹀</button>
        <button class="ms-briefing-iconbtn" data-act="close" title="Close the briefing panel. Tip: Ctrl+Shift+P toggles it from anywhere.">✕</button>
      </div>
      <div class="ms-briefing-body">
        <div class="ms-briefing-toolbar">
          <button class="ms-briefing-btn primary" data-act="capture" title="Adds Current Map View as Slide. Tip: Ctrl+Shift+S anywhere.">＋ Add Slide</button>
          <button class="ms-briefing-btn" data-act="blank" title="Add an empty slide — the map stays untouched; open it in the editor (✎) to add text and shapes. Tip: Ctrl+Shift+B anywhere.">◻ Blank Slide</button>
          <button class="ms-briefing-btn" data-act="recapture" title="Re-shoot the map into the selected slide — the image goes beneath the slide's annotations. With no slide selected, adds a new slide.">📷 Capture into Slide</button>
          <button class="ms-briefing-btn" data-act="prev" title="Previous slide (goTo transition).">◀ Prev</button>
          <button class="ms-briefing-btn" data-act="next" title="Next slide (goTo transition).">Next ▶</button>
          <button class="ms-briefing-btn" data-act="present" title="Enter full-screen present mode — Esc exits, arrows/space/click advance.">▶ Present</button>
          <button class="ms-briefing-btn" data-act="sorter" title="Open the slide sorter — drag tiles to reorder, duplicate or remove slides.">⊞ Sorter</button>
          <button class="ms-briefing-btn" data-act="save" title="Download this briefing as a JSON file.">⬇ Save</button>
          <button class="ms-briefing-btn" data-act="load" title="Load a briefing JSON file.">⬆ Load</button>
          <button class="ms-briefing-btn" data-act="importPptx" title="Import a PowerPoint (.pptx) — its text, shapes, pictures, tables and notes become editable slides appended to this briefing.">⬆ Import PPTX</button>
        </div>
        <div class="ms-briefing-strip"></div>
      </div>
      <div class="ms-briefing-resize" data-resize="e" title="Drag to resize the panel width"></div>`;
    document.body.appendChild(panel);
    this._panel = panel;
    this._strip = panel.querySelector('.ms-briefing-strip') as HTMLElement;
    this._panelCountEl = panel.querySelector('.ms-briefing-count') as HTMLElement;

    // The strip only scrolls horizontally (overflow-x: auto); a plain mouse
    // wheel reports vertical deltaY, which the browser does not remap to
    // horizontal scroll on its own — only Shift+wheel or dragging the
    // scrollbar did anything before this. Remap deltaY to scrollLeft
    // ourselves; leave genuinely horizontal input (trackpad/Shift+wheel)
    // to the browser's own default handling.
    this._strip.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        if (e.deltaY === 0 || e.deltaX !== 0) return;
        e.preventDefault();
        this._strip!.scrollLeft += e.deltaY;
      },
      { passive: false },
    );

    panel.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!btn) return;
      switch (btn.dataset.act) {
        case 'capture':
          this.captureSlide();
          break;
        case 'blank':
          this.addBlankSlide();
          break;
        case 'recapture':
          this.captureIntoSlide();
          break;
        case 'importPptx':
          this.importPptxFromFile();
          break;
        case 'prev':
          void this.prevSlide();
          break;
        case 'next':
          void this.nextSlide();
          break;
        case 'present':
          this.enterPresent();
          break;
        case 'sorter':
          this.toggleSorter();
          break;
        case 'save':
          this.saveBriefingToFile();
          break;
        case 'load':
          this.loadBriefingFromFile();
          break;
        case 'minimize':
          this._togglePanelMinimize();
          break;
        case 'close':
          this.closePanel();
          break;
      }
    });

    this._makeDraggable(panel.querySelector('#briefing-drag-handle') as HTMLElement, panel);
    this._makeResizable(panel);
  }

  private _togglePanelMinimize(): void {
    this._panelMinimized = !this._panelMinimized;
    this._applyPanelMinimizeState();
  }

  private _applyPanelMinimizeState(): void {
    if (!this._panel) return;
    const body = this._panel.querySelector('.ms-briefing-body') as HTMLElement | null;
    const btn = this._panel.querySelector('[data-act="minimize"]') as HTMLElement | null;
    body?.classList.toggle('ms-minimized', this._panelMinimized);
    this._panel.classList.toggle('ms-briefing-minimized', this._panelMinimized);
    if (btn) {
      btn.textContent = this._panelMinimized ? '︿' : '﹀';
      btn.title = this._panelMinimized ? 'Expand' : 'Minimize';
    }
  }

  /**
   * Pointer-events drag (mouse + touch + pen in one code path) — same pattern
   * as the top-bar's makeDraggable(). Buttons/inputs inside the handle never
   * start a drag, so the header's own action buttons stay clickable.
   */
  private _makeDraggable(handle: HTMLElement, panel: HTMLElement): void {
    let dragging = false;
    let ox = 0;
    let oy = 0;
    handle.style.touchAction = 'none';

    handle.addEventListener('pointerdown', (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('button, input, select')) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.transform = 'none';
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      document.body.style.userSelect = 'none';
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        /* best-effort only — dragging still works via the pointermove listener below */
      }
      e.preventDefault();
    });

    handle.addEventListener('pointermove', (e: PointerEvent) => {
      if (!dragging) return;
      const maxLeft = window.innerWidth - panel.offsetWidth - 4;
      const maxTop = window.innerHeight - panel.offsetHeight - 4;
      panel.style.left = `${Math.max(0, Math.min(e.clientX - ox, maxLeft))}px`;
      panel.style.top = `${Math.max(0, Math.min(e.clientY - oy, maxTop))}px`;
    });

    const endDrag = () => {
      dragging = false;
      document.body.style.userSelect = '';
    };
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  }

  /** Right-edge width resize — pointer-events, so a finger drag works as well as a mouse. */
  private _makeResizable(panel: HTMLElement): void {
    const handle = panel.querySelector('[data-resize="e"]') as HTMLElement | null;
    if (!handle) return;
    handle.style.touchAction = 'none';
    const MIN_W = 460;

    handle.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = panel.getBoundingClientRect().width;
      // Capture is best-effort: a throw here (unsupported browser, pointer not
      // recognized as active) must not stop the move/up listeners from being
      // wired below — without capture, the drag still tracks fine as long as
      // the pointer stays over the (9px-wide, easy to overshoot) handle.
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        /* best-effort only */
      }
      document.body.style.userSelect = 'none';

      const onMove = (me: PointerEvent) => {
        const maxW = window.innerWidth * 0.96;
        const w = Math.max(MIN_W, Math.min(maxW, startW + (me.clientX - startX)));
        panel.style.width = `${w}px`;
        panel.style.maxWidth = 'none';
      };
      const onUp = () => {
        document.body.style.userSelect = '';
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
    });
  }

  private _refreshStrip(): void {
    // Every slide mutation funnels through here — keep the sorter in sync
    // even when the strip panel was never built.
    this._refreshSorter();
    if (this._panelCountEl) {
      const n = this._slides.length;
      this._panelCountEl.textContent = this._current >= 0
        ? `${this._current + 1} / ${n}`
        : n === 1 ? '1 slide' : `${n} slides`;
    }
    if (!this._strip) return;
    this._strip.innerHTML = '';
    this._slides.forEach((slide, i) => {
      const tile = document.createElement('div');
      tile.className =
        'ms-briefing-tile' +
        (i === this._current ? ' active' : '') +
        (slide.hidden ? ' ms-hidden-slide' : '');
      tile.title =
        `${slide.title}${slide.notes ? `\n${slide.notes}` : ''}` +
        `${slide.hidden ? '\nHidden — skipped in playback' : ''}` +
        `\n(click: go to · dblclick/✎: edit)`;
      if (slide.thumbnailDataUrl) {
        tile.style.backgroundImage = `url(${slide.thumbnailDataUrl})`;
      }
      const open = openCount(slide.comments);
      const cmtBadge = open
        ? `<span class="ms-brief-cmt" title="${open} open comment(s)">${open}</span>`
        : '';
      tile.innerHTML = `
        <span class="ms-briefing-tile-num">${i + 1}</span>
        ${cmtBadge}
        <span class="ms-briefing-tile-title">${this._escapeHtml(slide.title)}</span>
        <button class="ms-briefing-tile-hide" title="${
          slide.hidden ? 'Hidden — click to show in playback.' : 'Hide this slide from playback.'
        }">${slide.hidden ? '🚫' : '👁'}</button>
        <button class="ms-briefing-tile-edit" title="Edit slide — text, shapes, arrows, colors.">✎</button>
        <button class="ms-briefing-tile-del" title="Remove this slide.">✕</button>`;
      tile.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.ms-briefing-tile-hide')) {
          this.toggleSlideHidden(i);
        } else if ((e.target as HTMLElement).closest('.ms-briefing-tile-edit')) {
          void this.openSlideEditor(i);
        } else if ((e.target as HTMLElement).closest('.ms-briefing-tile-del')) {
          this.removeSlide(i);
        } else {
          void this.goToSlide(i);
        }
      });
      tile.addEventListener('dblclick', (e) => {
        if (
          (e.target as HTMLElement).closest(
            '.ms-briefing-tile-del, .ms-briefing-tile-edit, .ms-briefing-tile-hide',
          )
        ) {
          return;
        }
        void this.openSlideEditor(i);
      });
      this._strip!.appendChild(tile);
    });
  }

  // ── Slide sorter ───────────────────────────────────────────────────────────

  /**
   * Full-screen sorter grid — drag tiles to reorder, click to go to a slide,
   * double-click to rename, ⧉/✕ to duplicate/remove. Esc (capture phase, same
   * rationale as present mode) or Done closes it.
   */
  public openSorter(): void {
    if (!this._enabled) return;
    if (!this._sorter) this._buildSorter();
    this._sorter!.style.display = 'flex';
    this._refreshSorter();
    if (!this._sorterKeyHandler) {
      this._sorterKeyHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          e.preventDefault();
          this.closeSorter();
        }
      };
      document.addEventListener('keydown', this._sorterKeyHandler, true);
    }
  }

  public closeSorter(): void {
    if (this._sorter) this._sorter.style.display = 'none';
    if (this._sorterKeyHandler) {
      document.removeEventListener('keydown', this._sorterKeyHandler, true);
      this._sorterKeyHandler = null;
    }
    this._dragIndex = null;
  }

  public toggleSorter(): void {
    this._sorter?.style.display === 'flex' ? this.closeSorter() : this.openSorter();
  }

  private _buildSorter(): void {
    const el = document.createElement('div');
    el.id = 'briefingSorter';
    el.innerHTML = `
      <div class="ms-sorter-header">
        <span class="ms-sorter-icon">⊞</span>
        <span class="ms-sorter-title">Slide Sorter</span>
        <span class="ms-sorter-count"></span>
        <span class="ms-sorter-hint">drag to reorder · click: go to · double-click: rename · ✎ edit · ⧉ duplicate · ✕ remove</span>
        <button class="ms-sorter-done" data-act="present" title="Start the slide show (Esc exits).">▶ Present</button>
        <button class="ms-sorter-done" data-act="close" title="Close the slide sorter (Esc).">Done</button>
      </div>
      <div class="ms-sorter-grid"></div>`;
    document.body.appendChild(el);
    this._sorter = el;
    this._sorterGrid = el.querySelector('.ms-sorter-grid') as HTMLElement;

    el.querySelector('[data-act="close"]')!.addEventListener('click', () => this.closeSorter());
    // enterPresent() closes the sorter itself before taking over the screen.
    el.querySelector('[data-act="present"]')!.addEventListener('click', () => this.enterPresent());

    // Dropping in empty grid space (past the last tile) moves to the end.
    this._sorterGrid.addEventListener('dragover', (e) => {
      if (this._dragIndex !== null) e.preventDefault();
    });
    this._sorterGrid.addEventListener('drop', (e) => {
      e.preventDefault();
      if (this._dragIndex === null) return;
      const from = this._dragIndex;
      this._dragIndex = null;
      this.moveSlide(from, this._slides.length - 1);
    });
  }

  private _refreshSorter(): void {
    const grid = this._sorterGrid;
    if (!grid || this._sorter?.style.display !== 'flex') return;
    grid.innerHTML = '';

    const count = this._sorter!.querySelector('.ms-sorter-count');
    if (count) {
      const hidden = this._hiddenCount();
      count.textContent =
        (this._slides.length === 1 ? '1 slide' : `${this._slides.length} slides`) +
        (hidden ? ` · ${hidden} hidden` : '');
    }

    if (!this._slides.length) {
      const empty = document.createElement('div');
      empty.className = 'ms-sorter-empty';
      empty.textContent = 'No slides yet — capture some from the Briefing panel.';
      grid.appendChild(empty);
      return;
    }

    this._slides.forEach((slide, i) => {
      const tile = document.createElement('div');
      tile.className =
        'ms-sorter-tile' +
        (i === this._current ? ' active' : '') +
        (slide.hidden ? ' ms-hidden-slide' : '');
      tile.draggable = true;
      tile.title =
        `${slide.title}${slide.notes ? `\n${slide.notes}` : ''}` +
        `${slide.hidden ? '\nHidden — skipped in playback' : ''}`;
      if (slide.thumbnailDataUrl) {
        tile.style.backgroundImage = `url(${slide.thumbnailDataUrl})`;
      }
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
          <button class="ms-sorter-tile-btn" data-act="hide" title="${
            slide.hidden
              ? 'Hidden — click to show in playback.'
              : 'Hide this slide from playback (it stays in the deck).'
          }">${slide.hidden ? '🚫' : '👁'}</button>
          <button class="ms-sorter-tile-btn" data-act="edit" title="Edit this slide — text, shapes, arrows, colors.">✎</button>
          <button class="ms-sorter-tile-btn" data-act="dup" title="Duplicate this slide.">⧉</button>
          <button class="ms-sorter-tile-btn" data-act="del" title="Remove this slide.">✕</button>
        </span>`;

      tile.addEventListener('click', (e) => {
        const act = ((e.target as HTMLElement).closest('[data-act]') as HTMLElement | null)
          ?.dataset.act;
        if (act === 'del') {
          this.removeSlide(i);
        } else if (act === 'hide') {
          this.toggleSlideHidden(i);
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
      tile.addEventListener('dblclick', (e) => {
        if ((e.target as HTMLElement).closest('[data-act]')) return;
        const title = prompt('Slide title', slide.title);
        if (title != null && title.trim()) this.renameSlide(i, title.trim());
      });

      tile.addEventListener('dragstart', (e) => {
        this._dragIndex = i;
        tile.classList.add('dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(i)); // Firefox needs data set
          this._setDragImage(e, slide, i);
        }
      });
      tile.addEventListener('dragend', () => {
        this._dragIndex = null;
        this._clearDropMarkers();
      });
      tile.addEventListener('dragover', (e) => {
        if (this._dragIndex === null || this._dragIndex === i) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        this._clearDropMarkers();
        tile.classList.add(this._dropsBefore(e, tile) ? 'drop-before' : 'drop-after');
      });
      tile.addEventListener('dragleave', () => {
        tile.classList.remove('drop-before', 'drop-after');
      });
      tile.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this._dragIndex === null || this._dragIndex === i) return;
        const from = this._dragIndex;
        this._dragIndex = null;
        // Insertion point in the pre-move array, shifted for the removal.
        let insertAt = this._dropsBefore(e, tile) ? i : i + 1;
        if (insertAt > from) insertAt -= 1;
        this.moveSlide(from, insertAt);
      });

      grid.appendChild(tile);
    });
  }

  /** Left half of a tile inserts before it, right half after. */
  private _dropsBefore(e: DragEvent, tile: HTMLElement): boolean {
    const rect = tile.getBoundingClientRect();
    return e.clientX < rect.left + rect.width / 2;
  }

  /**
   * Custom drag preview — the native ghost is an oversized translucent
   * snapshot of the grid tile; replace it with a compact card. The browser
   * rasterizes the element synchronously during dragstart, so it can leave
   * the DOM on the next tick.
   */
  private _setDragImage(e: DragEvent, slide: Slide, index: number): void {
    const ghost = document.createElement('div');
    ghost.className = 'ms-sorter-ghost';
    if (slide.thumbnailDataUrl) {
      ghost.style.backgroundImage = `url(${slide.thumbnailDataUrl})`;
    }
    ghost.innerHTML = `
      <span class="ms-sorter-tile-num">${index + 1}</span>
      <span class="ms-sorter-tile-title">${this._escapeHtml(slide.title)}</span>`;
    document.body.appendChild(ghost);
    e.dataTransfer!.setDragImage(ghost, 88, 50);
    setTimeout(() => ghost.remove(), 0);
  }

  private _clearDropMarkers(): void {
    this._sorterGrid
      ?.querySelectorAll('.drop-before, .drop-after, .dragging')
      .forEach((el) => el.classList.remove('drop-before', 'drop-after', 'dragging'));
  }

  // ── Slide editor (annotations) ─────────────────────────────────────────────

  /**
   * Open the full-screen PowerPoint-like editor for a slide. The editor works
   * on a frozen full-res screenshot of the slide's map state; saved
   * annotations live on slide.overlays, render in present mode, and re-emit
   * as native objects in the PPTX export.
   */
  public async openSlideEditor(ref: number | string): Promise<void> {
    const idx = this._slideIndex(ref);
    if (idx < 0 || !this._enabled) return;
    this.exitPresent(); // editor and present mode are mutually exclusive
    this.closeSorter();
    try {
      const { default: SlideEditor } = await import('./SlideEditor');
      const editor = SlideEditor.getInstance();
      if (editor.isOpen()) return;
      this._slideEditor = editor;
      await editor.open(this._editorHost(), idx);
    } catch (err) {
      EngineLogger.error(ENGINE_NAME, `Could not open slide editor: ${err}`);
    }
  }

  private _editorHost(): SlideEditorHost {
    return {
      getSlide: (i: number) => this._slides[i] ?? null,
      getSlideCount: () => this._slides.length,
      onPresent: (i: number) => {
        // Editor's ⛶ Slideshow — it saved & closed itself; present from there.
        // `fromEditor` makes Esc reopen the editor on this slide rather than
        // dropping the briefer back onto the bare map.
        if (i >= 0 && i < this._slides.length) this._current = i;
        this._refreshStrip();
        if (!this._enabled) return;
        this.closeSorter();
        this._present.enter({ fromEditor: true });
      },
      prepareBackground: async (i: number) => {
        // Screen-only slide (imported PPTX): the stored background IS the
        // slide — no map state to apply, no screenshot to take.
        const pre = this._slides[i];
        if (pre && this._isScreenOnly(pre) && pre.backgroundDataUrl) {
          return { dataUrl: pre.backgroundDataUrl, missingSymbols: false, usedFallback: false };
        }
        await this.applySlideForExport(i);
        await this._settleView();
        const slide = this._slides[i];
        const missingSymbols = slide ? this._symbolGraphicsMissing(slide) : false;
        // Live symbols are gone (usual cause: briefing imported without its
        // matching plan/session) but this slide has its own capture-time
        // snapshot — use that instead of a fresh (symbol-less) screenshot.
        const usedFallback = missingSymbols && !!slide?.backgroundDataUrl;
        const dataUrl = usedFallback
          ? slide!.backgroundDataUrl!
          : (await this._tryFullScreenshot()) ?? null;
        return { dataUrl, missingSymbols, usedFallback };
      },
      onSaved: (i: number, patch) => {
        const s = this._slides[i];
        if (!s) return;
        s.title = patch.title;
        s.notes = patch.notes;
        s.overlays = patch.overlays;
        s.comments = patch.comments;
        s.slideTransition = patch.slideTransition;
        if (patch.thumbnailDataUrl) s.thumbnailDataUrl = patch.thumbnailDataUrl;
        this._refreshStrip();
        EngineLogger.success(
          ENGINE_NAME,
          `Slide "${s.title}" saved (${patch.overlays?.length ?? 0} annotations)`,
        );
      },

      // ── Slide rail ───────────────────────────────────────────────────────
      // Each of these is an existing public method — the rail is a second view
      // onto the same operations the floating panel and the sorter already
      // drive, so all three stay in step through _refreshStrip / _refreshSorter.

      listSlides: () =>
        this._slides.map((s, i) => ({
          title: s.title || `Slide ${i + 1}`,
          thumb: s.thumbnailDataUrl,
          openComments: openCount(s.comments),
          // Only reported for screen-only slides: a map-view slide's stored
          // transition is ignored on playback, so badging it would lie.
          slideTransition: this._isScreenOnly(s) ? s.slideTransition : undefined,
          hidden: s.hidden,
        })),
      listComments: () =>
        this._slides.flatMap((s, slideIndex) =>
          (s.comments ?? []).map((comment) => ({ slideIndex, comment })),
        ),
      moveSlide: (from: number, to: number) => this.moveSlide(from, to),
      toggleSlideHidden: (i: number) => this.toggleSlideHidden(i),
      duplicateSlide: (i: number) => {
        this.duplicateSlide(i);
      },
      removeSlide: (i: number) => this.removeSlide(i),
      addSlideFromLayout: (layoutId: string) => {
        const layout = layoutById(layoutId);
        const slide = this.addBlankSlide(layout && layout.id !== 'blank' ? layout.name : undefined);
        if (!slide) return null;
        const overlays = layout?.overlays() ?? [];
        if (overlays.length) slide.overlays = overlays;
        this._refreshStrip();
        this._refreshSorter();
        return this._slides.indexOf(slide);
      },

      // ── Deck setup ───────────────────────────────────────────────────────
      // Backs the editor's Deck button. Sections are per-slide state, so they
      // go straight into the model; the other two hand off to surfaces that
      // already exist rather than duplicating them inside the editor.

      setSlideSection: (i: number, section: string) => this.setSlideSection(i, section),
      listSections: () => this.getSections(),
      exportDeck: () => {
        const run = (window as any).exportPptxDeck;
        if (typeof run !== 'function') {
          EngineLogger.error(ENGINE_NAME, 'PPTX exporter not registered');
          return;
        }
        void Promise.resolve(run()).catch((err: unknown) =>
          EngineLogger.error(ENGINE_NAME, `Export failed: ${err}`),
        );
      },
      openExportSettings: () => {
        // Global published by ExportToolsSettingsWidget, which is side-effect
        // imported from SymbolEngine — so it exists whenever the app is up.
        const open = (window as any).openExportToolsSettings;
        if (typeof open === 'function') open();
        else EngineLogger.nextStep(ENGINE_NAME, 'Open PPTX Export from Ctrl+K');
      },
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private _findGraphicById(id: string): Graphic | null {
    const lm = this._layerManager;
    if (!lm) return null;
    for (const layerId of SYMBOL_LAYER_IDS) {
      const layer = lm.getLayer(layerId);
      const hit = (layer?.graphics as any)?.find((g: Graphic) => g.attributes?.id === id);
      if (hit) return hit;
    }
    return null;
  }

  /** Imported PPTX slides are screen-only: no captured extent/camera. */
  private _isScreenOnly(slide: Slide): boolean {
    return !slide.view?.extent && !slide.view?.camera;
  }

  /**
   * True when the slide was captured with symbol layers visible but none of
   * those layers currently hold any graphics — the usual cause is importing
   * a Briefing JSON without also loading the matching plan/session, since
   * slides only reference graphics by id rather than owning their geometry.
   */
  private _symbolGraphicsMissing(slide: Slide): boolean {
    const lm = this._layerManager;
    if (!lm) return false;
    const expected = SYMBOL_LAYER_IDS.some((id) => slide.visibleLayers?.[id] === true);
    if (!expected) return false;
    return !SYMBOL_LAYER_IDS.some((id) => ((lm.getLayer(id)?.graphics as any)?.length ?? 0) > 0);
  }

  /**
   * Screenshot guarded with a timeout — takeScreenshot HANGS in a 3D
   * SceneView under headless preview (rAF frozen); never let it block.
   */
  private async _tryThumbnail(): Promise<string | undefined> {
    const v: any = this._view;
    if (!v?.takeScreenshot) return undefined;
    try {
      const shot: any = await Promise.race([
        v.takeScreenshot({ width: THUMB_WIDTH, height: THUMB_HEIGHT }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), THUMBNAIL_TIMEOUT_MS)),
      ]);
      return shot?.dataUrl ?? undefined;
    } catch {
      return undefined;
    }
  }

  /** Full-view screenshot for the slide-editor background (same hang guard). */
  private async _tryFullScreenshot(): Promise<string | undefined> {
    const v: any = this._view;
    if (!v?.takeScreenshot) return undefined;
    const viewW = Number(v.width) || 1280;
    const viewH = Number(v.height) || 720;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.min(Math.round(viewW * pixelRatio), 1920);
    const height = Math.round(width * (viewH / viewW));
    try {
      const shot: any = await Promise.race([
        // jpg keeps this — and the backgroundDataUrl fallback stored per
        // slide — from bloating the briefing JSON; png default was several
        // times larger for the same map imagery.
        v.takeScreenshot({ width, height, format: 'jpg', quality: 80 }),
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), FULL_SCREENSHOT_TIMEOUT_MS),
        ),
      ]);
      return shot?.dataUrl ?? undefined;
    } catch {
      return undefined;
    }
  }

  /** Give the renderer a beat after a headless slide-apply (always bounded). */
  private _settleView(): Promise<void> {
    const v: any = this._view;
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      try {
        const handle = v?.watch?.('updating', (updating: boolean) => {
          if (!updating) {
            handle?.remove?.();
            finish();
          }
        });
        if (v?.updating === false) {
          handle?.remove?.();
          finish();
        }
      } catch {
        /* fall through to timer */
      }
      setTimeout(finish, 1500);
    });
  }

  private _downloadJSON(data: any, filename: string): void {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  private _uuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  private _escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
    );
  }

  private _injectStyles(): void {
    if (document.getElementById('ms-briefing-style')) return;
    const style = document.createElement('style');
    style.id = 'ms-briefing-style';
    style.textContent = `
      /* Present mode hides the HUD (top bar + panels + the briefing strip). */
      .ms-present-mode #infoDiv,
      .ms-present-mode #settingsPanel,
      .ms-present-mode #apiPanel,
      .ms-present-mode #analysisHubPanel,
      .ms-present-mode #engineLogPanel,
      .ms-present-mode #briefingPanel,
      .ms-present-mode #briefingSorter { display: none !important; }

      #briefingPanel {
        position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%);
        z-index: 9500; display: none; flex-direction: column;
        width: min(94vw, 960px); max-width: min(94vw, 960px); min-width: 460px;
        background: var(--ms-bg, #141820); border: 1px solid var(--ms-border, rgba(90,140,220,0.25));
        border-radius: var(--ms-radius, 9px); box-shadow: var(--ms-shadow, 0 8px 36px rgba(0,0,0,0.55));
        font: var(--ms-fs, 12px)/1.4 var(--ms-font, 'Segoe UI', system-ui, sans-serif);
        color: var(--ms-text, #dce8f5); overflow: visible;
        animation: msBriefingIn 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      #briefingPanel.ms-visible { display: flex; }
      @keyframes msBriefingIn {
        from { opacity: 0; transform: translateX(-50%) scale(0.97) translateY(6px); }
        to   { opacity: 1; transform: translateX(-50%) scale(1) translateY(0); }
      }

      .ms-briefing-head {
        display: flex; align-items: center; gap: 7px;
        padding: 8px 8px 8px 10px;
        background: var(--ms-bg-header, rgba(26,32,48,0.97));
        border-bottom: 1px solid var(--ms-divider, rgba(80,100,150,0.18));
        border-radius: var(--ms-radius, 9px) var(--ms-radius, 9px) 0 0;
        cursor: grab; flex-shrink: 0; touch-action: none;
      }
      .ms-briefing-head:active { cursor: grabbing; }
      .ms-briefing-icon { font-size: 15px; line-height: 1; flex-shrink: 0; }
      .ms-briefing-title {
        font-weight: 700; font-size: 13px; letter-spacing: 0.04em;
        color: var(--ms-accent, #EF9F27); white-space: nowrap;
      }
      .ms-briefing-count {
        font-family: var(--ms-font-mono, Consolas, monospace);
        font-size: var(--ms-fs-xs, 10px); font-weight: 600; padding: 2px 7px;
        color: var(--ms-text-dim, rgba(155,180,215,0.72));
        background: rgba(255,255,255,0.06); border: 1px solid var(--ms-divider, rgba(80,100,150,0.18));
        border-radius: 9px; white-space: nowrap;
      }
      .ms-briefing-head-spacer { flex: 1; }
      .ms-briefing-iconbtn {
        width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center;
        background: none; border: 1px solid transparent; border-radius: var(--ms-radius-sm, 4px);
        color: var(--ms-text-dim, rgba(155,180,215,0.72)); cursor: pointer; font-size: 13px;
        transition: var(--ms-transition, all 0.15s ease); flex-shrink: 0; touch-action: manipulation;
      }
      .ms-briefing-iconbtn:hover {
        color: var(--ms-text, #dce8f5); background: rgba(255,255,255,0.08);
        border-color: var(--ms-border, rgba(90,140,220,0.25));
      }
      .ms-briefing-iconbtn:last-child:hover {
        color: var(--ms-danger, #DC3C30); border-color: var(--ms-danger, #DC3C30);
        background: rgba(220,60,48,0.14);
      }

      .ms-briefing-body { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px 10px; }
      .ms-briefing-body.ms-minimized { display: none; }

      .ms-briefing-toolbar { display: flex; flex-wrap: wrap; gap: 6px; }
      .ms-briefing-btn {
        background: var(--ms-bg-input, rgba(0,0,0,0.28)); color: var(--ms-text, #dce8f5);
        border: 1px solid var(--ms-border, rgba(90,140,220,0.25)); border-radius: var(--ms-radius-sm, 4px);
        padding: 6px 10px; cursor: pointer; font: inherit; font-size: var(--ms-fs-xs, 10px);
        white-space: nowrap; transition: var(--ms-transition, all 0.15s ease); touch-action: manipulation;
      }
      .ms-briefing-btn:hover { background: rgba(255,255,255,0.1); border-color: var(--ms-accent, #EF9F27); }
      .ms-briefing-btn.primary {
        background: var(--ms-accent, #EF9F27); border-color: var(--ms-accent, #EF9F27);
        color: #14181f; font-weight: 700;
      }
      .ms-briefing-btn.primary:hover { filter: brightness(1.1); }

      .ms-briefing-strip {
        display: flex; gap: 8px; overflow-x: auto; padding: 2px 2px 6px;
        min-height: 68px; scrollbar-width: thin; scroll-snap-type: x proximity;
        scrollbar-color: var(--ms-border, rgba(90,140,220,0.25)) transparent;
      }
      .ms-briefing-strip::-webkit-scrollbar { height: 6px; }
      .ms-briefing-strip::-webkit-scrollbar-thumb {
        background: var(--ms-border, rgba(90,140,220,0.25)); border-radius: 3px;
      }
      .ms-briefing-strip::-webkit-scrollbar-thumb:hover { background: var(--ms-accent, #EF9F27); }
      .ms-briefing-tile {
        position: relative; flex: 0 0 auto; width: 108px; height: 64px;
        scroll-snap-align: start;
        border: 2px solid var(--ms-border, rgba(90,140,220,0.25)); border-radius: 6px;
        background: linear-gradient(135deg, #26313a, #17202a) center/cover no-repeat;
        cursor: pointer; overflow: hidden; transition: border-color 0.12s ease, transform 0.12s ease;
      }
      .ms-briefing-tile:hover { transform: translateY(-1px); }
      .ms-briefing-tile.active {
        border-color: var(--ms-accent, #EF9F27); box-shadow: 0 0 0 1px var(--ms-accent, #EF9F27);
      }
      .ms-briefing-tile-num {
        position: absolute; top: 3px; left: 5px; font-weight: 700; font-size: 11px;
        color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.9);
      }
      .ms-briefing-tile-title {
        position: absolute; left: 0; right: 0; bottom: 0; padding: 2px 5px;
        background: rgba(0,0,0,0.55); color: #eef2f5; font-size: 10px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .ms-briefing-tile-del, .ms-briefing-tile-edit, .ms-briefing-tile-hide {
        position: absolute; top: 2px; width: 18px; height: 18px;
        border: none; border-radius: 3px; background: rgba(0,0,0,0.6);
        font-size: 10px; line-height: 1; cursor: pointer; opacity: 0; transition: opacity 0.12s ease;
      }
      .ms-briefing-tile-hide { right: 42px; color: #cfd6dd; }
      .ms-briefing-tile-edit { right: 22px; color: #9ecbff; }
      .ms-briefing-tile-del { right: 2px; color: #f1b0b0; }
      .ms-briefing-tile:hover .ms-briefing-tile-del,
      .ms-briefing-tile:hover .ms-briefing-tile-edit,
      .ms-briefing-tile:hover .ms-briefing-tile-hide { opacity: 1; }
      /* A hidden slide's own toggle stays visible without hover — otherwise the
         only clue the tile is dimmed on purpose is the struck-through number. */
      .ms-briefing-tile.ms-hidden-slide .ms-briefing-tile-hide { opacity: 1; }
      .ms-brief-cmt {
        /* top-right is the hover-revealed edit/delete pair and the bottom edge
           is the title bar, so this sits top-left instead, offset past
           .ms-briefing-tile-num (top: 3px; left: 5px; 11px bold, no
           background box — a 2-digit slide number spans roughly 5px to 21px)
           with a few px of clearance. Pure indicator: pointer-events is off so
           it can never intercept a click meant for a control beneath it. */
        position: absolute; top: 3px; left: 26px;
        min-width: 15px; height: 15px; padding: 0 3px;
        border-radius: 999px; background: #ffd166; color: #10161d;
        font: 700 9.5px/15px sans-serif; text-align: center; z-index: 3;
        pointer-events: none;
      }

      .ms-briefing-resize {
        position: absolute; top: 0; right: -4px; bottom: 0; width: 9px;
        cursor: ew-resize; touch-action: none; z-index: 2;
      }
      .ms-briefing-resize::after {
        content: ''; position: absolute; top: 50%; right: 3px; width: 3px; height: 28px;
        transform: translateY(-50%); border-radius: 2px;
        background: var(--ms-border, rgba(90,140,220,0.25));
      }
      .ms-briefing-resize:hover::after, .ms-briefing-resize:active::after {
        background: var(--ms-accent, #EF9F27);
      }

      /* Touch: bigger tap targets; edit/remove affordances can't rely on hover. */
      @media (pointer: coarse) {
        .ms-briefing-btn { min-height: 38px; padding: 8px 12px; }
        .ms-briefing-iconbtn { width: 32px; height: 32px; font-size: 16px; }
        .ms-briefing-tile { width: 128px; height: 76px; }
        .ms-briefing-tile-del, .ms-briefing-tile-edit, .ms-briefing-tile-hide {
          opacity: 1; width: 22px; height: 22px;
        }
        .ms-briefing-tile-hide { right: 50px; }
        .ms-briefing-tile-edit { right: 26px; }
        .ms-briefing-resize { width: 16px; right: -8px; }
      }

      /* Small screens: dock full-width at the bottom instead of a floating bar —
         free dragging/resizing on a phone-sized viewport does more harm than good. */
      @media (max-width: 640px) {
        #briefingPanel {
          left: 8px !important; right: 8px !important; bottom: 8px !important; top: auto !important;
          transform: none !important; width: auto !important; max-width: none !important; min-width: 0;
        }
        .ms-briefing-resize { display: none; }
      }
      /* Present-mode annotation overlay — above the map, below the counter. */
      .ms-briefing-overlay-canvas {
        position: absolute; inset: 0; pointer-events: none; z-index: 40;
      }
      .ms-briefing-counter {
        position: fixed; right: 16px; bottom: 12px; z-index: 9600;
        padding: 4px 10px; border-radius: 6px;
        background: rgba(18, 22, 26, 0.75); color: #dde3e8;
        font: 12px/1.4 system-ui, sans-serif; pointer-events: none;
      }

      /* Slide sorter overlay — shares the Widgets.css ops-dark design tokens
         (fallbacks keep it usable if a host app doesn't load that stylesheet). */
      #briefingSorter {
        position: fixed; inset: 0; z-index: 9550; display: none;
        flex-direction: column;
        background: rgba(13, 16, 22, 0.93);
        backdrop-filter: blur(10px);
        font-family: var(--ms-font, 'Segoe UI', system-ui, sans-serif);
        font-size: 12.5px; color: var(--ms-text, #dce8f5);
        animation: msSorterIn 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      @keyframes msSorterIn {
        from { opacity: 0; transform: scale(0.985); }
        to   { opacity: 1; transform: scale(1); }
      }
      .ms-sorter-header {
        display: flex; align-items: center; gap: 10px;
        padding: 11px 18px; flex-shrink: 0;
        background: var(--ms-bg-header, rgba(26, 32, 48, 0.97));
        border-bottom: 1px solid var(--ms-divider, rgba(80, 100, 150, 0.18));
      }
      .ms-sorter-icon {
        font-size: 12px; font-weight: 700; padding: 2px 6px;
        color: var(--ms-accent, #EF9F27);
        border: 1px solid var(--ms-border, rgba(90, 140, 220, 0.25));
        border-radius: 3px;
      }
      .ms-sorter-title {
        font-size: 15px; font-weight: 700; letter-spacing: 0.12em;
        text-transform: uppercase; color: var(--ms-accent, #EF9F27);
        white-space: nowrap;
      }
      .ms-sorter-count {
        font-family: var(--ms-font-mono, Consolas, monospace);
        font-size: 11px; font-weight: 700; padding: 1px 9px;
        color: var(--ms-accent, #EF9F27);
        background: rgba(239, 159, 39, 0.12);
        border: 1px solid rgba(239, 159, 39, 0.32);
        border-radius: 10px; white-space: nowrap;
      }
      .ms-sorter-hint {
        flex: 1; text-align: right; font-size: 11px; letter-spacing: 0.04em;
        color: var(--ms-text-label, rgba(120, 150, 185, 0.75));
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .ms-sorter-done {
        padding: 7px 22px; cursor: pointer;
        font-family: inherit; font-size: 11px; font-weight: 700;
        letter-spacing: 0.08em; text-transform: uppercase;
        border-radius: var(--ms-radius-sm, 4px);
        border: 1px solid var(--ms-accent, #EF9F27);
        background: rgba(239, 159, 39, 0.10);
        color: var(--ms-accent, #EF9F27);
        transition: all 0.15s ease;
      }
      .ms-sorter-done:hover { background: rgba(239, 159, 39, 0.22); color: #fff; }
      .ms-sorter-done:active { transform: scale(0.97); }
      .ms-sorter-grid {
        flex: 1; overflow-y: auto; padding: 20px;
        display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
        gap: 16px; align-content: start; scrollbar-width: thin;
      }
      .ms-sorter-grid::-webkit-scrollbar { width: 6px; }
      .ms-sorter-grid::-webkit-scrollbar-thumb {
        background: var(--ms-border, rgba(90, 140, 220, 0.25)); border-radius: 3px;
      }
      .ms-sorter-empty {
        grid-column: 1 / -1; text-align: center; padding: 56px 0;
        color: var(--ms-text-label, rgba(120, 150, 185, 0.75)); font-style: italic;
      }
      .ms-sorter-tile {
        position: relative; aspect-ratio: 16 / 9;
        border: 1px solid var(--ms-border, rgba(90, 140, 220, 0.25));
        border-radius: var(--ms-radius, 9px);
        background: linear-gradient(135deg, #1d2735, #12181f) center/cover no-repeat;
        cursor: grab; overflow: hidden;
        transition: border-color 0.15s ease, transform 0.15s ease,
                    box-shadow 0.15s ease, opacity 0.15s ease;
      }
      .ms-sorter-tile:hover {
        border-color: var(--ms-accent, #EF9F27);
        transform: translateY(-2px);
        box-shadow: 0 8px 22px rgba(0, 0, 0, 0.45);
      }
      .ms-sorter-tile.active {
        border-color: var(--ms-accent, #EF9F27);
        box-shadow: 0 0 0 1px var(--ms-accent, #EF9F27), 0 0 16px rgba(239, 159, 39, 0.28);
      }
      .ms-sorter-tile.dragging { opacity: 0.35; cursor: grabbing; transform: none; }
      .ms-sorter-tile.drop-before {
        box-shadow: -5px 0 0 -1px var(--ms-accent, #EF9F27), -5px 0 14px rgba(239, 159, 39, 0.45);
      }
      .ms-sorter-tile.drop-after {
        box-shadow: 5px 0 0 -1px var(--ms-accent, #EF9F27), 5px 0 14px rgba(239, 159, 39, 0.45);
      }
      .ms-sorter-tile-num {
        position: absolute; top: 6px; left: 6px; min-width: 20px;
        padding: 2px 6px; text-align: center;
        font-family: var(--ms-font-mono, Consolas, monospace);
        font-size: 11px; font-weight: 700; color: var(--ms-accent, #EF9F27);
        background: rgba(10, 13, 18, 0.78);
        border: 1px solid rgba(239, 159, 39, 0.35);
        border-radius: 4px;
      }
      .ms-sorter-tile-title {
        position: absolute; left: 0; right: 0; bottom: 0; padding: 14px 9px 5px;
        background: linear-gradient(transparent, rgba(8, 11, 16, 0.88) 55%);
        color: var(--ms-text, #dce8f5); font-size: 11.5px; font-weight: 600;
        letter-spacing: 0.02em;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .ms-sorter-tile-builds {
        position: absolute; top: 6px; right: 6px; padding: 2px 7px;
        font-family: var(--ms-font-mono, Consolas, monospace);
        font-size: 10px; font-weight: 700;
        color: var(--ms-warning, #e5a540);
        background: rgba(10, 13, 18, 0.78);
        border: 1px solid rgba(229, 165, 64, 0.35);
        border-radius: 10px;
      }
      /* Hidden slides (PowerPoint's "Hide Slide") — same treatment in the slide
         strip and the sorter. A scrim dims the THUMBNAIL only: it is generated
         first, so the number, title and controls (all positioned, all later in
         the DOM) still paint above it at full strength and stay clickable.
         PowerPoint strikes the slide number through; so do we. */
      .ms-briefing-tile.ms-hidden-slide::before,
      .ms-sorter-tile.ms-hidden-slide::before {
        content: ''; position: absolute; inset: 0;
        background: rgba(8, 11, 16, 0.66);
        pointer-events: none;
      }
      .ms-briefing-tile.ms-hidden-slide:hover::before,
      .ms-sorter-tile.ms-hidden-slide:hover::before { background: rgba(8, 11, 16, 0.34); }
      .ms-briefing-tile.ms-hidden-slide .ms-briefing-tile-num,
      .ms-sorter-tile.ms-hidden-slide .ms-sorter-tile-num {
        text-decoration: line-through;
        text-decoration-thickness: 2px;
      }
      .ms-briefing-tile.ms-hidden-slide .ms-briefing-tile-title,
      .ms-sorter-tile.ms-hidden-slide .ms-sorter-tile-title {
        font-style: italic; color: var(--ms-text-dim, rgba(155, 180, 215, 0.72));
      }
      .ms-sorter-tile-actions {
        position: absolute; top: 5px; right: 5px; display: none; gap: 4px;
      }
      .ms-sorter-tile:hover .ms-sorter-tile-actions { display: flex; }
      .ms-sorter-tile:hover .ms-sorter-tile-builds { display: none; }
      .ms-sorter-tile-btn {
        width: 22px; height: 22px; padding: 0;
        display: inline-flex; align-items: center; justify-content: center;
        border: 1px solid var(--ms-border, rgba(90, 140, 220, 0.25));
        border-radius: var(--ms-radius-sm, 4px);
        background: rgba(10, 13, 18, 0.82);
        color: var(--ms-text-dim, rgba(155, 180, 215, 0.72));
        font-size: 11px; line-height: 1; cursor: pointer;
        transition: all 0.15s ease;
      }
      .ms-sorter-tile-btn:hover {
        color: var(--ms-accent, #EF9F27);
        border-color: var(--ms-accent, #EF9F27);
        background: rgba(239, 159, 39, 0.14);
      }
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

      /* Drag-preview card — rendered offscreen only for setDragImage(). */
      .ms-sorter-ghost {
        position: fixed; top: -200px; left: -200px;
        width: 176px; height: 99px; overflow: hidden;
        border: 1px solid var(--ms-accent, #EF9F27);
        border-radius: 8px;
        background: linear-gradient(135deg, #1d2735, #12181f) center/cover no-repeat;
        font-family: var(--ms-font, 'Segoe UI', system-ui, sans-serif);
      }`;
    document.head.appendChild(style);
  }
}

export default BriefingEngine;
