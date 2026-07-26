/**
 * SlideEditor.ts
 *
 * Full-screen PowerPoint-like editor for one Briefing slide. The slide's map
 * state is applied headlessly and shot once at full resolution; the editor
 * then works on a frozen fabric.js canvas (screenshot background + annotation
 * objects). Annotations persist as SlideOverlay[] on the slide (normalized
 * coords — see OverlayFabric.ts) and are re-emitted natively by PptxExporter.
 *
 * Chrome (top tool strip + floating properties island) lives in
 * SlideEditorUI.ts; this file owns the editing semantics: tools, drawing,
 * clipboard, undo/redo, lasso/eraser/laser, keyboard shortcuts.
 *
 * fabric.js 4.5 is a CDN global (`window.fabric`) — never import it.
 * Dynamically imported by BriefingEngine so none of this loads until the
 * first edit.
 */

import EngineLogger from '../../Support/EngineLogger';
import type { Slide, SlideOverlay, SlideTransitionType } from './BriefingTypes';
import LaserTrail from './LaserTrail';
import {
  applyLockState,
  buildArrowPath,
  dashProps,
  fabricToOverlay,
  isBoxKind,
  loadOverlayImage,
  makeArrowGroup,
  makeShapeObject,
  overlayToFabric,
  overlayUuid,
  parseColor,
  preloadOverlayImages,
  restoreSelectionControls,
  styleSelectionControls,
  withAlpha,
  type ArrowType,
} from './OverlayFabric';
import SlideEditorUI, { TOOL_DEFS } from './SlideEditorUI';
import type { PanelContext, StyleDefaults, StyleProp, Tool } from './SlideEditorUI';

const ENGINE_NAME = 'SlideEditor';
const THUMB_WIDTH = 240;
const UNDO_CAP = 50;
const PASTE_OFFSET_PX = 16;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 5;
const ZOOM_STEP = 1.2;

export interface SlideEditorHost {
  getSlide(index: number): Slide | null;
  /** Total slide count — drives the editor's ◀ / ▶ slide navigation. */
  getSlideCount(): number;
  /** Optional: start present mode at `index` (editor saves & closes first). */
  onPresent?(index: number): void;
  /**
   * Apply slide state headlessly and return a full-res screenshot dataUrl
   * (null on failure) plus whether symbol graphics the slide expects are
   * absent from the live map (e.g. a Briefing was imported without also
   * loading the plan/session its graphic ids point into). When symbols are
   * missing but the slide has its own capture-time snapshot, dataUrl is that
   * frozen snapshot instead and usedFallback is true.
   */
  prepareBackground(index: number): Promise<{
    dataUrl: string | null;
    missingSymbols: boolean;
    usedFallback: boolean;
  }>;
  onSaved(
    index: number,
    patch: {
      title: string;
      notes?: string;
      overlays?: SlideOverlay[];
      thumbnailDataUrl?: string;
      slideTransition?: SlideTransitionType;
    },
  ): void;
}

const BOX_TOOLS: ReadonlySet<Tool> = new Set([
  'rect',
  'diamond',
  'ellipse',
  'triangle',
  'star',
  'callout',
]);
/** Box tools whose geometry can't reflow from width/height — drag-preview via scale. */
const SCALED_BOX_TOOLS: ReadonlySet<Tool> = new Set(['diamond', 'star', 'callout']);
const SCALE_BASE = 100;

const NUDGE_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Every style slot Ctrl+Alt+V transfers directly. The arrow slots are excluded — they're geometry, not property sets. */
const COPYABLE_STYLE_PROPS: readonly StyleProp[] = [
  'fontFamily',
  'fontSizePx',
  'bold',
  'italic',
  'underline',
  'align',
  'textColor',
  'fill',
  'fillOpacity',
  'stroke',
  'strokeWidthPx',
  'strokeDash',
  'opacity',
  'highlightWidthPx',
];

type AlignMode = 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom';

/**
 * Kinds rendered as a multi-point group by OverlayFabric.makeArrowGroup: the
 * shape control (sharp/curved/elbow), the bend handles, the rebuild path and
 * the child-patching style cases are all shared between them. Their stroke
 * lives on child 0, never on the group.
 */
const LINEWORK_KINDS: ReadonlySet<string> = new Set(['arrow', 'line']);

function isLinework(obj: any): boolean {
  return LINEWORK_KINDS.has(obj?.data?.kind);
}

/** Overlay kind → properties-island context, for the kinds that map 1:1. */
const PANEL_KIND_BY_OVERLAY: Record<string, PanelContext['kind']> = {
  text: 'text',
  image: 'image',
  highlight: 'highlight',
  arrow: 'arrow',
  line: 'line',
};

/**
 * Where a bound label sits inside its container: `w` is the fraction of the
 * container's width the text box may use, `dy` shifts the text's center off the
 * container's center as a fraction of height. Diamonds and stars only inscribe
 * a narrow box; a point-up triangle's usable area is low; a callout's body is
 * its top 78% (the rest is the tail — see OverlayFabric.makeShapeObject).
 */
const LABEL_FIT: Record<string, { w: number; dy: number }> = {
  rect: { w: 0.86, dy: 0 },
  ellipse: { w: 0.72, dy: 0 },
  diamond: { w: 0.6, dy: 0 },
  triangle: { w: 0.56, dy: 0.14 },
  star: { w: 0.5, dy: 0.04 },
  callout: { w: 0.86, dy: -0.11 },
};

export default class SlideEditor {
  private static _instance: SlideEditor | null = null;
  /** Static so copied annotations survive slide navigation → cross-slide paste. */
  private static _clipboard: SlideOverlay[] = [];
  /** Ctrl+Alt+C style snapshot — static for the same reason as _clipboard. */
  private static _styleClipboard: StyleDefaults | null = null;

  private _stage: HTMLElement | null = null;
  private _ui: SlideEditorUI | null = null;
  private _fc: any = null; // fabric.Canvas
  private _host: SlideEditorHost | null = null;
  private _index = -1;
  private _W = 0;
  private _H = 0;
  /** Natural screenshot pixel size — kept so the stage can be refit without reloading the background. */
  private _srcW = 0;
  private _srcH = 0;
  private _tool: Tool = 'select';
  private _opening = false;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _keyUpHandler: ((e: KeyboardEvent) => void) | null = null;
  private _pasteHandler: ((e: ClipboardEvent) => void) | null = null;
  private _blurHandler: (() => void) | null = null;
  private _drawing: { obj: any; startX: number; startY: number } | null = null;
  private _laser: LaserTrail | null = null;
  private _lassoPts: Array<{ x: number; y: number }> | null = null;
  private _arrowChain: Array<{ x: number; y: number }> | null = null;
  private _arrowReopenedObj: any = null;
  private _arrowPreview: any = null;
  private _arrowLastClickAt = 0;
  /**
   * When the arrow tool was finished by a double-click. Expires on its own, so
   * a genuine double-click later can never be swallowed. See _onArrowClick.
   */
  private _arrowFinishedByDblClickAt = 0;
  private _bendDrag: { obj: any; segmentIndex: number; lastPoint: { x: number; y: number } } | null = null;
  private _vertexDrag: { obj: any; index: number; lastPoint: { x: number; y: number } } | null = null;
  private _bendPreview: any = null;
  /** Vertex the right-click menu was opened on, if any — drives "Delete point". */
  private _ctxVertex: { obj: any; index: number } | null = null;
  private _erasing = false;
  private _erasedAny = false;
  /** Q — keep the active shape tool armed after each completed draw. */
  private _toolLock = false;
  /** Held space arms panning, so a drag pans instead of drawing or selecting. */
  private _spaceDown = false;
  /** Tears down an in-flight pan's document listeners; null when not panning. */
  private _panCleanup: (() => void) | null = null;
  private _undo: string[] = [];
  private _redo: string[] = [];
  private _commitTimer: ReturnType<typeof setTimeout> | null = null;

  private _defaults: StyleDefaults = {
    fontFamily: 'Arial',
    fontSizePx: 28,
    bold: false,
    italic: false,
    underline: false,
    align: 'left',
    textColor: '#ffffff',
    fill: '#ffd166',
    fillOpacity: 0.35,
    stroke: '#ff3b30',
    strokeWidthPx: 3,
    strokeDash: 'solid',
    opacity: 1,
    highlightWidthPx: 20,
    arrowType: 'sharp',
    arrowStart: 'none',
    arrowEnd: 'triangle',
    closed: false,
  };

  private constructor() {}

  public static getInstance(): SlideEditor {
    if (!SlideEditor._instance) {
      SlideEditor._instance = new SlideEditor();
    }
    return SlideEditor._instance;
  }

  public isOpen(): boolean {
    return !!this._stage || this._opening;
  }

  // ── Open / close ───────────────────────────────────────────────────────────

  public async open(host: SlideEditorHost, index: number): Promise<boolean> {
    if (this.isOpen()) return false;
    const fabric = (window as any).fabric;
    if (!fabric) {
      EngineLogger.error(ENGINE_NAME, 'fabric.js not available — slide editor cannot open');
      return false;
    }
    const slide = host.getSlide(index);
    if (!slide) return false;

    this._host = host;
    this._index = index;
    this._buildStage(slide);
    await this._loadSlide(index);
    if (!this._stage) return false; // closed while preparing
    this._attachKeys();
    EngineLogger.success(ENGINE_NAME, `Editing "${slide.title}"`);
    return true;
  }

  /** Persist the current canvas + title/notes to the slide — used by Save & Close, slide navigation and Slideshow. */
  private _saveCurrent(): void {
    const host = this._host;
    const index = this._index;
    if (!this._fc || !host || index < 0) return;
    if (this._arrowChain) this._clearArrowChain();
    try {
      const active: any = this._fc.getActiveObject?.();
      active?.exitEditing?.();
      this._fc.discardActiveObject();
      this._fc.renderAll();

      const overlays = (this._fc.getObjects() as any[])
        .map((o) => fabricToOverlay(o, this._W, this._H))
        .filter(Boolean) as SlideOverlay[];
      const thumbnailDataUrl = this._fc.toDataURL({
        format: 'jpeg',
        quality: 0.72,
        multiplier: THUMB_WIDTH / this._W,
      });
      const slide = host.getSlide(index);
      host.onSaved(index, {
        title: (this._ui?.titleInput?.value ?? '').trim() || slide?.title || `Slide ${index + 1}`,
        notes: (this._ui?.notesArea?.value ?? '').trim() || undefined,
        overlays: overlays.length ? overlays : undefined,
        thumbnailDataUrl,
        slideTransition: (this._ui?.transitionSelect?.value || undefined) as
          | SlideTransitionType
          | undefined,
      });
    } catch (err) {
      EngineLogger.error(ENGINE_NAME, `Save failed: ${err}`);
    }
  }

  /**
   * Load `index` into the already-open stage: swap title/notes, rebuild the
   * fabric canvas on the slide's background. Shared by open() and ◀ / ▶
   * navigation (which saves first — PowerPoint-style, moving slides commits).
   */
  private async _loadSlide(index: number): Promise<void> {
    const host = this._host;
    const fabric = (window as any).fabric;
    const ui = this._ui;
    if (!host || !fabric || !this._stage || !ui) return;
    const slide = host.getSlide(index);
    if (!slide) return;

    this._opening = true;
    try {
      this._index = index;
      ui.hideContextMenu();
      ui.closeHelp();
      if (ui.titleInput) ui.titleInput.value = slide.title ?? '';
      ui.syncNotes(slide);
      ui.syncTransitionControl(slide);
      ui.updateNav(index, host.getSlideCount());

      try {
        this._fc?.dispose?.();
      } catch {}
      this._fc = null;
      this._laser = null;
      this._drawing = null;
      this._lassoPts = null;
      this._erasing = false;
      this._arrowChain = null;
      this._arrowPreview = null;
      this._arrowReopenedObj = null;
      this._bendDrag = null;
      this._vertexDrag = null;
      this._bendPreview = null;
      this._ctxVertex = null;
      // _fc is about to be null for the whole await below — assign the field
      // directly (never through _setTool, which no-ops without a canvas) so
      // Escape's "de-arm the tool" rung can still reach close() mid-load.
      this._tool = 'select';
      if (ui.stageWrap) {
        ui.stageWrap.innerHTML = '<span class="ms-sledit-loading">Preparing slide…</span>';
      }

      const bg = await host.prepareBackground(index);
      if (!this._stage) return; // closed while preparing
      const size = await this._loadImage(bg.dataUrl);
      // overlayToFabric is synchronous, so picture overlays must be decoded
      // before the canvas is built or they'd be skipped.
      await preloadOverlayImages(slide.overlays);
      if (!this._stage) return;
      // Only warn persistently when we truly have nothing to show — a
      // successful fallback gets a toast instead (see below), not a banner.
      this._initCanvas(fabric, slide, size, bg.missingSymbols && !bg.usedFallback);
      // Fresh undo baseline per slide — history never crosses slides.
      if (this._commitTimer) clearTimeout(this._commitTimer);
      this._commitTimer = null;
      this._undo = [this._snapshotJson()];
      this._redo = [];
      ui.setZoom(1); // fresh canvas per slide, so zoom always starts at 1:1
      this._setTool('select'); // never carry a draw tool across slides
      if (bg.usedFallback) {
        this._showToast(
          'Live symbol graphics not found — showing the snapshot captured with this slide.',
        );
      }
    } finally {
      this._opening = false;
    }
  }

  /** Save the current slide, then edit its neighbor (◀ / ▶). */
  private async _navigate(delta: number): Promise<void> {
    if (this._opening || !this._host) return;
    const count = this._host.getSlideCount();
    const next = this._index + delta;
    if (next < 0 || next >= count) return;
    this._saveCurrent();
    await this._loadSlide(next);
  }

  public close(save: boolean): void {
    if (!this._stage) return;

    if (save) this._saveCurrent();

    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler, true);
      this._keyHandler = null;
    }
    if (this._keyUpHandler) {
      document.removeEventListener('keyup', this._keyUpHandler, true);
      this._keyUpHandler = null;
    }
    if (this._pasteHandler) {
      document.removeEventListener('paste', this._pasteHandler, true);
      this._pasteHandler = null;
    }
    if (this._blurHandler) {
      window.removeEventListener('blur', this._blurHandler);
      this._blurHandler = null;
    }
    // Closing mid-pan must not leave the pan's document listeners behind.
    this._endPan();
    this._spaceDown = false;
    if (this._commitTimer) {
      clearTimeout(this._commitTimer);
      this._commitTimer = null;
    }
    this._laser?.dispose();
    this._laser = null;
    // Drops the menu's document-level dismiss listener as well as its DOM.
    this._ui?.hideContextMenu();
    restoreSelectionControls();
    try {
      this._fc?.dispose?.();
    } catch {}
    this._fc = null;
    this._stage?.remove();
    this._stage = null;
    this._ui = null;
    this._host = null;
    this._index = -1;
    this._drawing = null;
    this._lassoPts = null;
    this._erasing = false;
    this._arrowChain = null;
    this._arrowPreview = null;
    this._arrowReopenedObj = null;
    this._bendDrag = null;
    this._vertexDrag = null;
    this._bendPreview = null;
    this._ctxVertex = null;
    this._undo = [];
    this._redo = [];
    this._tool = 'select';
  }

  // ── Stage / chrome ─────────────────────────────────────────────────────────

  private _buildStage(slide: Slide): void {
    const stage = document.createElement('div');
    stage.id = 'msSlideEditor';
    document.body.appendChild(stage);
    this._stage = stage;
    this._ui = new SlideEditorUI({
      defaults: this._defaults,
      onToolSelected: (t) => this._setTool(t),
      onAction: (act) => this._onAction(act),
      onStyleChanged: (prop) => this._onStyleChanged(prop),
    });
    this._ui.build(stage, slide);
    this._attachImageDrop(stage);
  }

  private _onAction(act: string): void {
    switch (act) {
      case 'save':
        this.close(true);
        break;
      case 'cancel':
        this.close(false);
        break;
      case 'prevSlide':
        void this._navigate(-1);
        break;
      case 'nextSlide':
        void this._navigate(1);
        break;
      case 'present': {
        // Save, close, then hand off to the host's present mode — the two
        // surfaces are mutually exclusive (BriefingEngine enforces the same).
        const host = this._host;
        const index = this._index;
        this._saveCurrent();
        this.close(false); // already saved
        host?.onPresent?.(index);
        break;
      }
      case 'notes':
        this._ui?.toggleNotes();
        // Opening/closing the drawer changes how much vertical room the stage
        // has — refit so the canvas never ends up taller than its container
        // (which otherwise shows up as an unexpected scrollbar).
        this._resizeStageToFit();
        break;
      case 'help':
        this._ui?.toggleHelp();
        break;
      case 'zoomIn':
        this._zoomTo((this._fc?.getZoom() ?? 1) * ZOOM_STEP);
        break;
      case 'zoomOut':
        this._zoomTo((this._fc?.getZoom() ?? 1) / ZOOM_STEP);
        break;
      case 'zoomReset':
        this._resetZoom();
        break;
      case 'toolLock':
        this._setToolLock(!this._toolLock);
        break;
      case 'del':
        this._deleteSelection();
        break;
      case 'dup':
        this._duplicateSelection();
        break;
      case 'front':
      case 'forward':
      case 'backward':
      case 'back':
        this._layerAction(act);
        break;
      case 'group':
        this._groupSelection();
        break;
      case 'ungroup':
        this._ungroupSelection();
        break;
      case 'lock':
        this._toggleLock();
        break;
      case 'flipH':
        this._flipSelection('x');
        break;
      case 'flipV':
        this._flipSelection('y');
        break;
      case 'deletePoint':
        this._deleteVertex();
        break;
      case 'copy':
        this._copySelection();
        break;
      case 'cut':
        this._cutSelection();
        break;
      case 'paste':
        this._paste();
        break;
      case 'copyStyles':
        this._copyStyles();
        break;
      case 'pasteStyles':
        this._pasteStyles();
        break;
      case 'selectAll':
        this._selectAll();
        break;
      case 'alignLeft':
      case 'alignRight':
      case 'alignTop':
      case 'alignBottom':
      case 'alignCenterH':
      case 'alignCenterV': {
        const mode = (act.slice(5, 6).toLowerCase() + act.slice(6)) as AlignMode;
        this._alignSelection(mode);
        break;
      }
      case 'distributeH':
        this._distributeSelection('h');
        break;
      case 'distributeV':
        this._distributeSelection('v');
        break;
    }
  }

  private _layerAction(act: 'front' | 'forward' | 'backward' | 'back'): void {
    const obj = this._fc?.getActiveObject?.();
    if (!obj) return;
    // Canvas-level stacking methods handle ActiveSelection natively.
    if (act === 'front') this._fc.bringToFront(obj);
    else if (act === 'forward') this._fc.bringForward(obj);
    else if (act === 'backward') this._fc.sendBackwards(obj);
    else this._fc.sendToBack(obj);
    this._normalizeLabelStacking();
    this._fc.requestRenderAll();
    this._commit();
  }

  private _deleteSelection(): void {
    const objs = this._withBoundLabels(this._unlockedSelection());
    if (!objs.length) return;
    if (this._bendDrag || this._vertexDrag) {
      this._clearLineworkPreview();
      this._bendDrag = null;
      this._vertexDrag = null;
    }
    objs.forEach((o) => this._fc.remove(o));
    this._fc.discardActiveObject();
    this._fc.requestRenderAll();
    this._syncPanelContext();
    this._commit();
  }

  // ── Canvas init ────────────────────────────────────────────────────────────

  private _loadImage(
    dataUrl: string | null,
  ): Promise<{ img: HTMLImageElement; w: number; h: number } | null> {
    if (!dataUrl) return Promise.resolve(null);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ img, w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  private _initCanvas(
    fabric: any,
    slide: Slide,
    size: { img: HTMLImageElement; w: number; h: number } | null,
    missingSymbols?: boolean,
  ): void {
    const ui = this._ui;
    if (!ui?.stageWrap) return;
    styleSelectionControls();
    ui.stageWrap.innerHTML = '';
    // Slide navigation re-inits the canvas — drop the previous slide's banner.
    this._stage?.querySelectorAll('.ms-sledit-warn').forEach((el) => el.remove());

    const warnings: string[] = [];
    if (!size) warnings.push('Screenshot unavailable — annotations are still editable');
    if (missingSymbols) {
      warnings.push(
        'Symbol graphics not found on the map — load the matching plan/session to show them here',
      );
    }
    if (warnings.length) {
      const warn = document.createElement('div');
      warn.className = 'ms-sledit-warn';
      warn.textContent = warnings.join(' · ');
      this._stage!.appendChild(warn);
    }

    this._srcW = size?.w ?? 1280;
    this._srcH = size?.h ?? 720;
    const fit = this._computeFitSize();
    this._W = fit.w;
    this._H = fit.h;

    const canvasEl = document.createElement('canvas');
    canvasEl.width = this._W;
    canvasEl.height = this._H;
    ui.stageWrap.appendChild(canvasEl);
    // The properties island lives inside stageWrap (it overlays the canvas)
    // and the innerHTML reset above detached it — put it back.
    ui.remountPanel();

    this._fc = new fabric.Canvas(canvasEl, {
      preserveObjectStacking: true,
      selection: true,
      backgroundColor: '#1a2129',
      // Excalidraw's convention (fabric's default is the other way round):
      // corner drags resize freely, Shift constrains to the aspect ratio.
      uniformScaling: false,
      uniScaleKey: 'shiftKey',
      // Needed for middle-drag panning — fabric swallows the middle button otherwise.
      fireMiddleClick: true,
    });
    if (size) {
      const bgImg = new fabric.Image(size.img, { originX: 'left', originY: 'top' });
      this._fc.setBackgroundImage(bgImg, () => this._fc.requestRenderAll(), {
        scaleX: this._W / size.w,
        scaleY: this._H / size.h,
      });
    }

    for (const o of slide.overlays ?? []) {
      const obj = overlayToFabric(o, this._W, this._H);
      if (obj) {
        if (isLinework(obj)) this._attachArrowControls(obj);
        this._fc.add(obj);
      } else {
        EngineLogger.error(ENGINE_NAME, `Skipped invalid overlay entry (${o?.kind ?? '?'})`);
      }
    }
    // A label whose container was dropped above (or never saved) becomes plain text.
    this._dropOrphanLabels();

    // Both listeners below live on DOM nodes fabric created and destroys with
    // the canvas (dispose() detaches wrapperEl), so they need no teardown.
    this._fc.wrapperEl?.addEventListener(
      'mousedown',
      (e: MouseEvent) => this._onPreMouseDown(e),
      true,
    );
    this._fc.upperCanvasEl?.addEventListener('contextmenu', (e: MouseEvent) =>
      this._onCanvasContextMenu(e),
    );

    this._fc.on('mouse:down', (opt: any) => this._onMouseDown(opt));
    this._fc.on('mouse:move', (opt: any) => this._onMouseMove(opt));
    this._fc.on('mouse:up', (opt: any) => this._onMouseUp(opt));
    this._fc.on('path:created', (e: any) => this._onPathCreated(e));
    this._fc.on('selection:created', () => this._syncControlsFromSelection());
    this._fc.on('selection:updated', () => this._syncControlsFromSelection());
    this._fc.on('selection:cleared', () => this._syncPanelContext());
    this._fc.on('object:modified', () => {
      if (this._vertexDrag) {
        this._finalizeVertexDrag();
        return;
      }
      if (this._bendDrag) {
        this._finalizeArrowBend();
        return;
      }
      this._commit();
    });
    this._fc.on('mouse:wheel', (opt: any) => this._onWheel(opt));
    this._fc.on('mouse:dblclick', (opt: any) => this._onDoubleClick(opt));
    this._fc.on('text:editing:exited', (e: any) => {
      const t = e?.target;
      if (t && !String(t.text ?? '').trim()) {
        // Emptying a label is how you remove it — the container just loses its text.
        this._fc.remove(t);
      } else if (t?.data?.labelOf) {
        // Typing changed the text's height — re-center it in its container.
        const owner = this._containerFor(t);
        if (owner) this._layoutLabel(owner, t);
      }
      this._commit();
    });
    this._fc.requestRenderAll();
  }

  /**
   * Fit `_srcW`x`_srcH` inside whatever room `.ms-sledit-stagewrap` currently
   * has (measured live, so it always reflects the top bar + notes drawer's
   * actual current height rather than an approximation of them).
   */
  private _computeFitSize(): { w: number; h: number } {
    const wrap = this._ui?.stageWrap;
    const boxW = wrap?.clientWidth ?? Math.max(320, window.innerWidth - 32);
    const boxH = wrap?.clientHeight ?? Math.max(180, window.innerHeight - 104);
    const maxW = Math.max(320, boxW - 24); // stagewrap's own 12px padding, both sides
    const maxH = Math.max(180, boxH - 24);
    const scale = Math.min(maxW / this._srcW, maxH / this._srcH, 1.5);
    return {
      w: Math.max(320, Math.round(this._srcW * scale)),
      h: Math.max(180, Math.round(this._srcH * scale)),
    };
  }

  /**
   * Recompute the fit and rescale the live canvas (dimensions, background,
   * every object) in place — cheaper than reloading the slide, and used
   * whenever the notes drawer's open/closed state changes the stage's
   * available height so the canvas never ends up larger than its container.
   */
  private _resizeStageToFit(): void {
    if (!this._fc || !this._srcW || !this._srcH) return;
    const { w: newW, h: newH } = this._computeFitSize();
    if (newW === this._W && newH === this._H) return;
    const ratio = newW / this._W;
    this._fc.setDimensions({ width: newW, height: newH });
    const bg = this._fc.backgroundImage;
    if (bg) {
      bg.scaleX = (bg.scaleX ?? 1) * ratio;
      bg.scaleY = (bg.scaleY ?? 1) * ratio;
    }
    for (const obj of this._fc.getObjects() as any[]) {
      obj.set({
        left: (obj.left ?? 0) * ratio,
        top: (obj.top ?? 0) * ratio,
        scaleX: (obj.scaleX ?? 1) * ratio,
        scaleY: (obj.scaleY ?? 1) * ratio,
      });
      obj.setCoords();
    }
    this._W = newW;
    this._H = newH;
    this._fc.requestRenderAll();
  }

  /** Transient bottom-center notice — CSS-driven fade so it needs no rAF. */
  private _showToast(message: string): void {
    if (!this._stage) return;
    const toast = document.createElement('div');
    toast.className = 'ms-sledit-toast';
    toast.textContent = message;
    this._stage.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  // ── Images ─────────────────────────────────────────────────────────────────

  /** Opens a file dialog. The image "tool" is really this action — see _setTool. */
  private _pickImage(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.onchange = () => {
      const file = input.files?.[0];
      input.remove();
      if (file) void this._insertImageFile(file);
    };
    document.body.appendChild(input);
    input.click();
  }

  /** Shared by the file dialog, paste and drop. */
  private async _insertImageFile(file: File, at?: { x: number; y: number }): Promise<void> {
    if (!file.type?.startsWith('image/')) return;
    const src = await new Promise<string | null>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(file);
    });
    if (src) await this._insertImageSrc(src, at);
  }

  /**
   * Place a picture, scaled to fit comfortably inside the slide and centred on
   * `at` (the drop point) or the canvas centre.
   */
  private async _insertImageSrc(src: string, at?: { x: number; y: number }): Promise<void> {
    const el = await loadOverlayImage(src);
    if (!el || !this._fc || !this._stage) return;
    const nw = el.naturalWidth || 1;
    const nh = el.naturalHeight || 1;
    const k = Math.min((this._W * 0.4) / nw, (this._H * 0.4) / nh, 1);
    const w = Math.max(8, nw * k);
    const h = Math.max(8, nh * k);
    const cx = at?.x ?? this._W / 2;
    const cy = at?.y ?? this._H / 2;
    this._setTool('select');
    this._addOverlays(
      [
        {
          id: overlayUuid(),
          kind: 'image',
          src,
          x: (cx - w / 2) / this._W,
          y: (cy - h / 2) / this._H,
          w: w / this._W,
          h: h / this._H,
        },
      ],
      0,
    );
  }

  /**
   * Drag-and-drop onto the stage. Registered on the stage rather than the canvas
   * so a drop just outside the artwork still lands (clamped into the frame).
   */
  private _attachImageDrop(stage: HTMLElement): void {
    stage.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
    });
    stage.addEventListener('drop', (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      e.preventDefault();
      let at: { x: number; y: number } | undefined;
      const canvasEl = this._fc?.upperCanvasEl as HTMLCanvasElement | undefined;
      if (canvasEl) {
        const r = canvasEl.getBoundingClientRect();
        const zoom = this._fc.getZoom?.() || 1;
        const vpt = this._fc.viewportTransform ?? [1, 0, 0, 1, 0, 0];
        at = {
          x: Math.max(0, Math.min(this._W, (e.clientX - r.left - vpt[4]) / zoom)),
          y: Math.max(0, Math.min(this._H, (e.clientY - r.top - vpt[5]) / zoom)),
        };
      }
      void this._insertImageFile(file, at);
    });
  }

  // ── Zoom / pan ─────────────────────────────────────────────────────────────

  /**
   * Ctrl+wheel zooms about the pointer. Plain wheel is left alone so it keeps
   * scrolling the stage, which is what it does today when the canvas overflows.
   */
  private _onWheel(opt: any): void {
    const e: WheelEvent = opt?.e;
    if (!this._fc || !e) return;
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    this._zoomTo(this._fc.getZoom() * 0.999 ** e.deltaY, {
      x: e.offsetX,
      y: e.offsetY,
    });
  }

  /**
   * Apply a clamped zoom, about `point` in canvas-element coordinates when
   * given, otherwise about the canvas centre.
   */
  private _zoomTo(zoom: number, point?: { x: number; y: number }): void {
    const fc = this._fc;
    if (!fc) return;
    const fabric = (window as any).fabric;
    const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
    const about = point ?? { x: this._W / 2, y: this._H / 2 };
    fc.zoomToPoint(new fabric.Point(about.x, about.y), next);
    fc.requestRenderAll();
    this._ui?.setZoom(next);
  }

  /** Back to 1:1, with the slide re-centred in the frame. */
  private _resetZoom(): void {
    const fc = this._fc;
    if (!fc) return;
    fc.setViewportTransform([1, 0, 0, 1, 0, 0]);
    fc.requestRenderAll();
    this._ui?.setZoom(1);
  }

  /**
   * Space-drag or middle-drag panning. Runs off document-level listeners so the
   * gesture survives the pointer leaving the canvas, and registers a cleanup so
   * closing the editor mid-drag can't leak them.
   */
  private _beginPan(e: MouseEvent): void {
    const fabric = (window as any).fabric;
    let last = { x: e.clientX, y: e.clientY };
    const move = (ev: MouseEvent) => {
      if (!this._fc) return;
      this._fc.relativePan(new fabric.Point(ev.clientX - last.x, ev.clientY - last.y));
      last = { x: ev.clientX, y: ev.clientY };
    };
    const end = () => this._endPan();
    this._panCleanup = () => {
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('mouseup', end, true);
      this._panCleanup = null;
      if (this._fc) this._fc.defaultCursor = this._tool === 'select' ? 'default' : 'crosshair';
    };
    document.addEventListener('mousemove', move, true);
    document.addEventListener('mouseup', end, true);
    this._fc.defaultCursor = 'grabbing';
  }

  private _endPan(): void {
    this._panCleanup?.();
  }

  // ── Tools ──────────────────────────────────────────────────────────────────

  private _setTool(t: Tool): void {
    if (!this._fc) return;
    this._ui?.hideContextMenu();
    if (t === 'image') {
      // Not a mode — picking a file is the whole interaction, so the armed tool
      // never changes and the strip button acts as a one-shot.
      this._pickImage();
      return;
    }
    if (this._arrowChain && t !== 'arrow') {
      this._clearArrowChain();
    }
    const prev = this._tool;

    if (prev !== t) {
      // Switching tools mid-gesture (keyboard shortcuts and Escape both can)
      // must not leave a ghost preview object, an abandoned lasso outline
      // still painted on contextTop, or a stuck erase-drag flag behind —
      // _onMouseMove/_onMouseUp branch on the CURRENT tool, not the one the
      // gesture started with, so any of those would otherwise corrupt or
      // silently drop whatever was mid-flight.
      if (this._drawing) {
        this._fc.remove(this._drawing.obj);
        this._drawing = null;
      }
      if (this._lassoPts) {
        this._lassoPts = null;
        try {
          this._fc.clearContext(this._fc.contextTop);
        } catch {}
      }
      this._erasing = false;
    }
    this._tool = t;

    if (prev === 'laser' && t !== 'laser') {
      this._laser?.dispose();
    }
    if (t === 'laser' && !this._laser) {
      this._laser = new LaserTrail(this._fc);
    }
    if (t === 'arrow' && prev !== 'arrow') {
      const active = this._fc.getActiveObject();
      if (active?.data?.kind === 'arrow') this._onArrowReopen(active);
    }

    const drawingMode = t === 'freehand' || t === 'highlighter';
    this._fc.isDrawingMode = drawingMode;
    if (drawingMode) this._configureBrush();

    if (t !== 'select' && prev === 'select') {
      // Entering any non-select tool drops the selection — clicks must never
      // grab objects while a tool is armed.
      this._fc.discardActiveObject();
      this._fc.requestRenderAll();
    }
    if (t === 'eraser' && prev !== 'eraser') {
      // Objects must not become the active object while erasing: fabric sets
      // up its own drag-transform on mousedown before our handler runs, which
      // both (a) fires selection:created and leaks the doomed object's style
      // into the panel defaults, and (b) pins findTarget to that transform's
      // target for the rest of the drag, so sweeping past other objects
      // erases nothing until the mouse button is released and pressed again.
      (this._fc.getObjects() as any[]).forEach((o: any) => {
        if (o?.data?.kind) o.selectable = false;
      });
    } else if (prev === 'eraser' && t !== 'eraser') {
      (this._fc.getObjects() as any[]).forEach((o: any) => {
        if (o?.data?.kind) o.selectable = true;
      });
    }
    this._fc.selection = t === 'select';
    this._fc.skipTargetFind = t !== 'select' && t !== 'eraser';
    this._fc.defaultCursor = t === 'select' ? 'default' : 'crosshair';
    this._fc.hoverCursor = t === 'eraser' ? 'crosshair' : 'move';

    this._ui?.setActiveTool(t);
    this._syncPanelContext();
  }

  private _configureBrush(): void {
    const fabric = (window as any).fabric;
    if (!this._fc.freeDrawingBrush) {
      this._fc.freeDrawingBrush = new fabric.PencilBrush(this._fc);
    }
    const b = this._fc.freeDrawingBrush;
    if (this._tool === 'highlighter') {
      b.color = withAlpha(this._defaults.stroke, 0.45);
      b.width = this._defaults.highlightWidthPx;
    } else {
      b.color = this._defaults.stroke;
      b.width = this._defaults.strokeWidthPx;
    }
  }

  /** Creation-time style shared by every draw tool. */
  private _creationStyle() {
    const d = this._defaults;
    return {
      fill: d.fill ? withAlpha(d.fill, d.fillOpacity) : '',
      stroke: d.stroke,
      strokeWidth: d.strokeWidthPx,
      strokeDash: d.strokeDash === 'solid' ? undefined : d.strokeDash,
    };
  }

  private _onMouseDown(opt: any): void {
    if (!this._fc) return;
    const t = this._tool;
    if (t === 'select' || t === 'freehand' || t === 'highlighter') return;
    const fabric = (window as any).fabric;
    const p = this._fc.getPointer(opt.e);
    const d = this._defaults;

    if (t === 'laser') {
      this._laser?.onDown(p.x, p.y);
      return;
    }
    if (t === 'eraser') {
      this._erasing = true;
      this._erasedAny = false;
      this._eraseAt(opt);
      return;
    }
    if (t === 'lasso') {
      this._lassoPts = [{ x: p.x, y: p.y }];
      return;
    }
    if (t === 'arrow') {
      this._onArrowClick(p);
      return;
    }

    if (t === 'text') {
      // Clicking a label-capable shape with the text tool labels it, exactly
      // like double-clicking the shape. findTarget is gated by skipTargetFind
      // (set for every armed tool), so it has to be bypassed for this probe.
      const prevSkip = this._fc.skipTargetFind;
      this._fc.skipTargetFind = false;
      const under: any = this._fc.findTarget?.(opt.e, true);
      this._fc.skipTargetFind = prevSkip;
      if (under && this._canHoldLabel(under) && !under.data.locked) {
        this._setTool('select');
        this._editLabel(under);
        return;
      }
      const tb = new fabric.Textbox('Text', {
        left: p.x,
        top: p.y,
        width: Math.min(240, this._W * 0.3),
        fontSize: d.fontSizePx,
        fontFamily: d.fontFamily,
        fontWeight: d.bold ? 'bold' : 'normal',
        fontStyle: d.italic ? 'italic' : 'normal',
        underline: d.underline,
        textAlign: d.align,
        fill: d.textColor,
        opacity: d.opacity,
        data: { id: overlayUuid(), kind: 'text' },
      });
      this._setTool('select');
      this._fc.add(tb);
      this._fc.setActiveObject(tb);
      tb.enterEditing();
      tb.selectAll();
      this._fc.requestRenderAll();
      return;
    }

    const style = this._creationStyle();
    const dash = dashProps(style.strokeDash, style.strokeWidth);
    let obj: any = null;
    if (t === 'rect' || t === 'triangle') {
      const Ctor = t === 'rect' ? fabric.Rect : fabric.Triangle;
      obj = new Ctor({
        left: p.x,
        top: p.y,
        width: 1,
        height: 1,
        fill: style.fill,
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        ...dash,
        strokeLineJoin: 'round',
        opacity: d.opacity,
        data: { id: overlayUuid(), kind: t, strokeDash: style.strokeDash },
      });
    } else if (t === 'ellipse') {
      obj = new fabric.Ellipse({
        left: p.x,
        top: p.y,
        rx: 1,
        ry: 1,
        fill: style.fill,
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        ...dash,
        opacity: d.opacity,
        data: { id: overlayUuid(), kind: 'ellipse', strokeDash: style.strokeDash },
      });
    } else if (SCALED_BOX_TOOLS.has(t)) {
      obj = makeShapeObject(
        t as 'diamond' | 'star' | 'callout',
        { left: p.x, top: p.y, width: SCALE_BASE, height: SCALE_BASE },
        style,
        { opacity: d.opacity },
      );
      obj.set({ scaleX: 0.02, scaleY: 0.02 });
    } else if (t === 'line') {
      obj = new fabric.Line([p.x, p.y, p.x, p.y], {
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        ...dash,
        opacity: d.opacity,
        data: { id: overlayUuid(), kind: 'line', strokeDash: style.strokeDash },
      });
    }
    if (obj) {
      obj.set({ selectable: false, evented: false });
      this._fc.add(obj);
      this._fc.discardActiveObject();
      this._drawing = { obj, startX: p.x, startY: p.y };
    }
  }

  private _onMouseMove(opt: any): void {
    if (!this._fc) return;
    const t = this._tool;
    if (t === 'arrow') {
      if (this._arrowChain) this._updateArrowPreview(this._fc.getPointer(opt.e));
      return;
    }
    if (t === 'laser') {
      const p = this._fc.getPointer(opt.e);
      this._laser?.onMove(p.x, p.y);
      return;
    }
    if (t === 'eraser') {
      if (this._erasing) this._eraseAt(opt);
      return;
    }
    if (t === 'lasso') {
      if (this._lassoPts) {
        const p = this._fc.getPointer(opt.e);
        this._lassoPts.push({ x: p.x, y: p.y });
        this._drawLassoPreview();
      }
      return;
    }
    if (!this._drawing) return;
    const p = this._fc.getPointer(opt.e);
    const { obj, startX, startY } = this._drawing;
    if (t === 'rect' || t === 'triangle') {
      obj.set({
        left: Math.min(startX, p.x),
        top: Math.min(startY, p.y),
        width: Math.abs(p.x - startX),
        height: Math.abs(p.y - startY),
      });
    } else if (t === 'ellipse') {
      obj.set({
        left: Math.min(startX, p.x),
        top: Math.min(startY, p.y),
        rx: Math.abs(p.x - startX) / 2,
        ry: Math.abs(p.y - startY) / 2,
      });
    } else if (SCALED_BOX_TOOLS.has(t)) {
      obj.set({
        left: Math.min(startX, p.x),
        top: Math.min(startY, p.y),
        scaleX: Math.max(0.02, Math.abs(p.x - startX) / SCALE_BASE),
        scaleY: Math.max(0.02, Math.abs(p.y - startY) / SCALE_BASE),
      });
    } else {
      obj.set({ x2: p.x, y2: p.y });
    }
    this._fc.requestRenderAll();
  }

  private _onMouseUp(opt: any): void {
    if (!this._fc) return;
    const t = this._tool;
    if (t === 'laser') {
      this._laser?.onUp();
      return;
    }
    if (t === 'eraser') {
      this._erasing = false;
      if (this._erasedAny) this._commit();
      this._erasedAny = false;
      return;
    }
    if (t === 'lasso') {
      this._finishLasso();
      return;
    }
    if (!this._drawing) return;
    const { obj, startX, startY } = this._drawing;
    this._drawing = null;

    const isLineKind = t === 'line';
    const degenerate = isLineKind
      ? Math.hypot((obj.x2 ?? 0) - (obj.x1 ?? 0), (obj.y2 ?? 0) - (obj.y1 ?? 0)) < 4
      : obj.getScaledWidth() < 4 && obj.getScaledHeight() < 4;
    if (degenerate) {
      this._fc.remove(obj);
      if (!this._toolLock) this._setTool('select');
      return;
    }

    let finalObj: any = obj;
    if (SCALED_BOX_TOOLS.has(t)) {
      const p = this._fc.getPointer(opt.e);
      this._fc.remove(obj);
      finalObj = makeShapeObject(
        t as 'diamond' | 'star' | 'callout',
        {
          left: Math.min(startX, p.x),
          top: Math.min(startY, p.y),
          width: Math.abs(p.x - startX),
          height: Math.abs(p.y - startY),
        },
        this._creationStyle(),
        { opacity: this._defaults.opacity },
      );
      this._fc.add(finalObj);
    } else if (isLineKind) {
      // The drag preview is a plain fabric.Line; a persisted line is the same
      // multi-point group an arrow uses (minus terminators), which is what gives
      // it the shape control and the bend handles. Swap it in now.
      const p = this._fc.getPointer(opt.e);
      const style = this._creationStyle();
      this._fc.remove(obj);
      finalObj = makeArrowGroup(
        [
          { x: startX, y: startY },
          { x: p.x, y: p.y },
        ],
        style.stroke,
        style.strokeWidth,
        { opacity: this._defaults.opacity },
        style.strokeDash,
        this._defaults.arrowType,
        { kind: 'line', closed: this._defaults.closed, fill: style.fill },
      );
      this._attachArrowControls(finalObj);
      this._fc.add(finalObj);
    } else {
      obj.set({ selectable: true, evented: true });
      obj.setCoords();
    }

    // Tool lock keeps the tool armed and leaves the new shape unselected (a
    // selection under an armed draw tool can't be interacted with anyway).
    // Callouts always revert — their auto-spawned label needs select semantics.
    const wasCallout = t === 'callout';
    if (this._toolLock && !wasCallout) {
      this._fc.discardActiveObject();
    } else {
      this._setTool('select');
      this._fc.setActiveObject(finalObj);
    }
    this._fc.requestRenderAll();
    this._commit();
    // A callout is a bubble plus its bound label — drawing one goes straight
    // into typing, and from then on the pair moves and deletes as a unit.
    if (wasCallout) this._editLabel(finalObj);
  }

  /** PencilBrush paths become Polylines so the persisted model stays point-based. */
  private _onPathCreated(e: any): void {
    const fabric = (window as any).fabric;
    const path = e?.path;
    if (!path || !this._fc) return;
    const pts: Array<{ x: number; y: number }> = [];
    for (const cmd of path.path ?? []) {
      if (Array.isArray(cmd) && cmd.length >= 3) {
        pts.push({ x: Number(cmd[cmd.length - 2]), y: Number(cmd[cmd.length - 1]) });
      }
    }
    this._fc.remove(path);
    if (pts.length < 2) return;
    const d = this._defaults;
    const isHighlight = this._tool === 'highlighter';
    const style = this._creationStyle();
    const poly = new fabric.Polyline(pts, {
      fill: '',
      stroke: d.stroke,
      strokeWidth: isHighlight ? d.highlightWidthPx : d.strokeWidthPx,
      ...(isHighlight
        ? { opacity: 0.45, strokeLineCap: 'round', strokeLineJoin: 'round' }
        : { ...dashProps(style.strokeDash, d.strokeWidthPx), opacity: d.opacity }),
      data: {
        id: overlayUuid(),
        kind: isHighlight ? 'highlight' : 'freehand',
        strokeDash: isHighlight ? undefined : style.strokeDash,
      },
    });
    this._fc.add(poly);
    this._fc.requestRenderAll();
    this._commit();
  }

  private _onArrowClick(p: { x: number; y: number }): void {
    const now = Date.now();
    const isFinish =
      !!this._arrowChain &&
      now - this._arrowLastClickAt < 400 &&
      Math.hypot(
        p.x - this._arrowChain[this._arrowChain.length - 1].x,
        p.y - this._arrowChain[this._arrowChain.length - 1].y,
      ) < 6;
    this._arrowLastClickAt = now;
    if (isFinish) {
      // Finishing an arrow IS a double-click, and the browser's trailing
      // dblclick arrives after _onArrowFinish has already switched to the
      // select tool and made the new arrow active — so without this the same
      // gesture would fall straight through to "label this arrow".
      this._arrowFinishedByDblClickAt = now;
      this._onArrowFinish();
      return;
    }
    if (!this._arrowChain) this._arrowChain = [p];
    else this._arrowChain.push(p);
    this._updateArrowPreview(p);
  }

  private _updateArrowPreview(cursor: { x: number; y: number }): void {
    if (!this._fc || !this._arrowChain) return;
    const fabric = (window as any).fabric;
    const style = this._creationStyle();
    const pts = [...this._arrowChain, cursor];
    const { d } = buildArrowPath(pts, this._defaults.arrowType);
    if (this._arrowPreview) this._fc.remove(this._arrowPreview);
    this._arrowPreview = new fabric.Path(d, {
      fill: '',
      stroke: style.stroke,
      strokeWidth: style.strokeWidth,
      strokeDashArray: [6, 4],
      selectable: false,
      evented: false,
      opacity: 0.85,
    });
    this._fc.add(this._arrowPreview);
    this._fc.requestRenderAll();
  }

  private _onArrowFinish(): void {
    if (this._tool !== 'arrow' || !this._arrowChain) return;
    const pts = [...this._arrowChain];
    const reopened = this._arrowReopenedObj;
    if (this._arrowPreview) {
      this._fc.remove(this._arrowPreview);
      this._arrowPreview = null;
    }
    this._arrowChain = null;
    this._arrowReopenedObj = null;
    if (pts.length >= 2) {
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 4) pts.pop();
    }
    if (pts.length < 2) {
      if (reopened) {
        this._fc.add(reopened);
        this._fc.setActiveObject(reopened);
      }
      if (!this._toolLock || reopened) this._setTool('select');
      return;
    }
    const style = this._creationStyle();
    const finalObj = makeArrowGroup(
      pts,
      style.stroke,
      style.strokeWidth,
      { opacity: this._defaults.opacity, data: reopened ? { id: reopened.data.id } : undefined },
      style.strokeDash,
      this._defaults.arrowType,
      { start: this._defaults.arrowStart, end: this._defaults.arrowEnd },
    );
    this._attachArrowControls(finalObj);
    this._fc.add(finalObj);
    if (this._toolLock) {
      this._fc.discardActiveObject();
    } else {
      this._setTool('select');
      this._fc.setActiveObject(finalObj);
    }
    this._fc.requestRenderAll();
    this._commit();
  }

  /** Removes an existing arrow from the canvas and seeds `_arrowChain` with its points (converted to
   * absolute canvas coordinates) so click-chain placement can append to it; `_onArrowFinish`/
   * `_clearArrowChain` consult `_arrowReopenedObj` to preserve identity or restore on cancel. */
  private _onArrowReopen(obj: any): void {
    const fabric = (window as any).fabric;
    const lp: Array<{ x: number; y: number }> = obj.data?.localPoints ?? [];
    if (lp.length < 2) return;
    const m = obj.calcTransformMatrix();
    const pts = lp.map((p) => {
      const abs = fabric.util.transformPoint(new fabric.Point(p.x, p.y), m);
      return { x: abs.x, y: abs.y };
    });
    const pathChild = obj.getObjects()[0];
    const avgScale = ((obj.scaleX ?? 1) + (obj.scaleY ?? 1)) / 2;
    const d = this._defaults;
    d.stroke = parseColor(pathChild?.stroke)?.hex ?? d.stroke;
    d.strokeWidthPx = Math.max(1, Math.round((pathChild?.strokeWidth ?? d.strokeWidthPx) * avgScale));
    d.strokeDash = (obj.data?.strokeDash ?? 'solid') as StyleDefaults['strokeDash'];
    d.opacity = obj.opacity ?? 1;
    d.arrowType = (obj.data?.arrowType ?? 'sharp') as ArrowType;
    d.arrowStart = obj.data?.arrowStart ?? 'none';
    d.arrowEnd = obj.data?.arrowEnd ?? 'triangle';
    this._fc.discardActiveObject();
    this._fc.remove(obj);
    this._arrowReopenedObj = obj;
    this._arrowChain = pts;
    this._arrowLastClickAt = 0;
    this._updateArrowPreview(pts[pts.length - 1]);
    this._ui?.refreshPanelValues();
  }

  /** Absolute canvas coordinates of a linework group's vertices. */
  private _absPointsOf(obj: any): Array<{ x: number; y: number }> {
    const fabric = (window as any).fabric;
    const lp: Array<{ x: number; y: number }> = obj?.data?.localPoints ?? [];
    if (!lp.length) return [];
    const m = obj.calcTransformMatrix();
    return lp.map((p) => {
      const abs = fabric.util.transformPoint(new fabric.Point(p.x, p.y), m);
      return { x: abs.x, y: abs.y };
    });
  }

  /**
   * Editing handles for a linework group: a square at every vertex (drag to move
   * it) and a round dot at every segment midpoint (drag to insert a bend).
   * Elbow arrows get vertices only — splicing a bend into a derived dogleg has
   * no well-defined meaning. Removing a vertex is on the right-click menu.
   */
  private _attachArrowControls(grp: any): void {
    const fabric = (window as any).fabric;
    const pts: Array<{ x: number; y: number }> = grp.data?.localPoints ?? [];
    // Point handles are registered BEFORE the inherited bbox controls, because
    // fabric hit-tests controls in key order: a line's endpoints land exactly on
    // the bbox corners (or the mid-edge handles, when it's axis-aligned), and
    // whichever is declared first wins. Moving a point is what you want there;
    // the remaining edge handles and the rotate handle still scale/rotate.
    const controls: Record<string, any> = {};

    for (let i = 0; i < pts.length; i++) {
      controls[`vtx${i}`] = new fabric.Control({
        x: 0,
        y: 0,
        cursorStyle: 'move',
        positionHandler: (_dim: any, finalMatrix: number[], obj: any) => {
          const lp: Array<{ x: number; y: number }> = obj.data?.localPoints ?? [];
          const p = lp[i];
          if (!p) return new fabric.Point(0, 0);
          return fabric.util.transformPoint(new fabric.Point(p.x, p.y), finalMatrix);
        },
        actionHandler: (_eventData: any, transform: any, x: number, y: number) => {
          this._dragVertex(transform.target, i, x, y);
          return true;
        },
        actionName: 'moveVertex',
        // Square, to read as "this is a point" against the round insert dots.
        render: (ctx: CanvasRenderingContext2D, left: number, top: number) => {
          ctx.save();
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#2d6cdf';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.rect(left - 4.5, top - 4.5, 9, 9);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        },
      });
    }

    if (grp.data?.arrowType !== 'elbow') {
      for (let i = 0; i < pts.length - 1; i++) {
        controls[`bow${i}`] = new fabric.Control({
          x: 0,
          y: 0,
          cursorStyle: 'crosshair',
          positionHandler: (_dim: any, finalMatrix: number[], obj: any) => {
            const lp: Array<{ x: number; y: number }> = obj.data?.localPoints ?? [];
            const a = lp[i];
            const b = lp[i + 1];
            if (!a || !b) return new fabric.Point(0, 0);
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            return fabric.util.transformPoint(new fabric.Point(mid.x, mid.y), finalMatrix);
          },
          actionHandler: (_eventData: any, transform: any, x: number, y: number) => {
            this._dragArrowBend(transform.target, i, x, y);
            return true;
          },
          actionName: 'insertArrowBend',
          render: (ctx: CanvasRenderingContext2D, left: number, top: number) => {
            ctx.save();
            ctx.fillStyle = '#2d6cdf';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(left, top, 4.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          },
        });
      }
    }
    grp.controls = { ...controls, ...fabric.Object.prototype.controls };
    grp.setCoords();
  }

  /**
   * Throwaway dashed preview of a point list, shown while a vertex or bend
   * handle is being dragged. The pinned object itself is never mutated or
   * removed mid-gesture — fabric keeps `transform.target` fixed for the whole
   * drag, so the real geometry swap happens once, at drag end.
   */
  private _showLineworkPreview(obj: any, absPoints: Array<{ x: number; y: number }>): void {
    const fabric = (window as any).fabric;
    const pathChild = obj.getObjects()[0];
    const { d } = buildArrowPath(absPoints, obj.data?.arrowType ?? 'sharp');
    this._clearLineworkPreview();
    this._bendPreview = new fabric.Path(obj.data?.closed ? `${d} Z` : d, {
      fill: '',
      stroke: pathChild.stroke,
      strokeWidth: pathChild.strokeWidth,
      strokeDashArray: [6, 4],
      selectable: false,
      evented: false,
      opacity: 0.9,
    });
    this._fc.add(this._bendPreview);
    this._fc.requestRenderAll();
  }

  private _clearLineworkPreview(): void {
    if (this._bendPreview) {
      this._fc?.remove(this._bendPreview);
      this._bendPreview = null;
    }
  }

  /** Per-tick vertex-handle drag callback. */
  private _dragVertex(obj: any, index: number, canvasX: number, canvasY: number): void {
    if (!obj || !isLinework(obj)) return;
    const absPoints = this._absPointsOf(obj);
    if (index < 0 || index >= absPoints.length) return;
    this._vertexDrag = { obj, index, lastPoint: { x: canvasX, y: canvasY } };
    absPoints[index] = { x: canvasX, y: canvasY };
    this._showLineworkPreview(obj, absPoints);
  }

  /** Called once at vertex-handle drag end (via the `object:modified` listener). */
  private _finalizeVertexDrag(): void {
    const drag = this._vertexDrag;
    this._vertexDrag = null;
    this._clearLineworkPreview();
    if (!drag) return;
    const absPoints = this._absPointsOf(drag.obj);
    if (drag.index < 0 || drag.index >= absPoints.length) return;
    absPoints[drag.index] = drag.lastPoint;
    const rebuilt = this._rebuildArrow(drag.obj, absPoints);
    this._fc.setActiveObject(rebuilt);
    this._fc.requestRenderAll();
  }

  /** Per-tick bow-handle drag callback — see _showLineworkPreview. */
  private _dragArrowBend(obj: any, segmentIndex: number, canvasX: number, canvasY: number): void {
    if (!obj || !isLinework(obj)) return;
    const absPoints = this._absPointsOf(obj);
    if (segmentIndex < 0 || segmentIndex + 1 >= absPoints.length) return;
    this._bendDrag = { obj, segmentIndex, lastPoint: { x: canvasX, y: canvasY } };
    absPoints.splice(segmentIndex + 1, 0, { x: canvasX, y: canvasY });
    this._showLineworkPreview(obj, absPoints);
  }

  /** Called once at bow-handle drag end (via the `object:modified` listener in `_initCanvas`). */
  private _finalizeArrowBend(): void {
    const drag = this._bendDrag;
    this._bendDrag = null;
    this._clearLineworkPreview();
    if (!drag) return;
    this._insertArrowBend(drag.obj, drag.segmentIndex, drag.lastPoint.x, drag.lastPoint.y);
  }

  /** Splices a new point into a linework group's geometry at the drag location and rebuilds it in place. */
  private _insertArrowBend(obj: any, segmentIndex: number, canvasX: number, canvasY: number): void {
    if (!obj || !isLinework(obj)) return;
    const absPoints = this._absPointsOf(obj);
    if (segmentIndex < 0 || segmentIndex + 1 >= absPoints.length) return;
    absPoints.splice(segmentIndex + 1, 0, { x: canvasX, y: canvasY });
    const rebuilt = this._rebuildArrow(obj, absPoints);
    this._fc.setActiveObject(rebuilt);
    this._fc.requestRenderAll();
  }

  /**
   * The vertex handle under a pointer event, if the single selected linework
   * object has one there. Used by the right-click menu to offer "Delete point";
   * a 2-point line has none to spare.
   */
  private _vertexHitAt(e: MouseEvent): { obj: any; index: number } | null {
    const fc = this._fc;
    const objs = this._selectedObjects();
    if (!fc || objs.length !== 1) return null;
    const obj = objs[0];
    if (!isLinework(obj) || obj.data.locked) return null;
    const pts = this._absPointsOf(obj);
    if (pts.length <= 2) return null;
    const p = fc.getPointer(e);
    // Handles are drawn at a fixed screen size, so the hit radius has to shrink
    // as the canvas zooms in.
    const tol = 10 / (fc.getZoom?.() || 1);
    for (let i = 0; i < pts.length; i++) {
      if (Math.hypot(pts[i].x - p.x, pts[i].y - p.y) <= tol) return { obj, index: i };
    }
    return null;
  }

  /** Removes the right-clicked vertex and rebuilds the linework without it. */
  private _deleteVertex(): void {
    const hit = this._ctxVertex;
    this._ctxVertex = null;
    if (!hit) return;
    const absPoints = this._absPointsOf(hit.obj);
    if (absPoints.length <= 2 || hit.index < 0 || hit.index >= absPoints.length) return;
    absPoints.splice(hit.index, 1);
    const rebuilt = this._rebuildArrow(hit.obj, absPoints);
    this._fc.setActiveObject(rebuilt);
    this._fc.requestRenderAll();
  }

  /** Replaces a linework group (arrow or line) with a freshly-built one from an absolute-coordinate point list, preserving kind/style/id. */
  private _rebuildArrow(obj: any, absPoints: Array<{ x: number; y: number }>): any {
    const arrowType: ArrowType = obj.data?.arrowType ?? 'sharp';
    const pathChild = obj.getObjects()[0];
    const avgScale = ((obj.scaleX ?? 1) + (obj.scaleY ?? 1)) / 2;
    const idx = this._fc.getObjects().indexOf(obj);
    this._fc.remove(obj);
    const rebuilt = makeArrowGroup(
      absPoints,
      pathChild.stroke,
      pathChild.strokeWidth * avgScale,
      { opacity: obj.opacity, data: { id: obj.data.id } },
      obj.data.strokeDash,
      arrowType,
      {
        start: obj.data.arrowStart,
        end: obj.data.arrowEnd,
        kind: obj.data.kind,
        closed: obj.data.closed,
        // Closing an open line has no fill to carry over — seed it from the
        // panel so the polygon doesn't come back invisible.
        fill:
          pathChild.fill ||
          (obj.data.closed && this._defaults.fill
            ? withAlpha(this._defaults.fill, this._defaults.fillOpacity)
            : ''),
      },
    );
    // makeArrowGroup rebuilds `data` from its arguments, so the cross-kind
    // state that doesn't describe geometry has to be carried over by hand or a
    // bend/head edit would silently unlink and unlock the arrow.
    if (obj.data.groupId) rebuilt.data.groupId = obj.data.groupId;
    if (obj.data.locked) applyLockState(rebuilt, true);
    this._attachArrowControls(rebuilt);
    this._fc.add(rebuilt);
    if (idx >= 0) this._fc.moveTo(rebuilt, idx);
    // Bending or re-typing an arrow moves its midpoint — the label follows.
    // (No-ops while the pair is inside an ActiveSelection; see _layoutLabel.)
    const label = this._labelFor(rebuilt);
    if (label) {
      this._layoutLabel(rebuilt, label);
      this._fc.moveTo(label, this._overlayIndex(rebuilt) + 1);
    }
    this._commit();
    return rebuilt;
  }

  private _clearArrowChain(): void {
    if (this._arrowPreview) {
      this._fc?.remove(this._arrowPreview);
      this._arrowPreview = null;
    }
    if (this._arrowReopenedObj) {
      this._fc?.add(this._arrowReopenedObj);
      this._fc?.setActiveObject(this._arrowReopenedObj);
      this._arrowReopenedObj = null;
    }
    this._arrowChain = null;
  }

  // ── Eraser ─────────────────────────────────────────────────────────────────

  private _eraseAt(opt: any): void {
    // Always hit-test fresh rather than trust opt.target: objects stay
    // selectable=false while erasing (see _setTool) specifically so fabric
    // never pins a drag-transform target across this sweep, but re-deriving
    // the target here too means a sweep still erases everything it passes
    // over even if that invariant is ever violated.
    const target = this._fc?.findTarget?.(opt.e, false);
    if (target?.data?.kind && !target.data.locked) {
      const label = this._labelFor(target);
      this._fc.remove(target);
      if (label) this._fc.remove(label); // never leave an orphaned label behind
      this._erasedAny = true;
      this._fc.requestRenderAll();
    }
  }

  // ── Lasso ──────────────────────────────────────────────────────────────────

  /** The in-progress lasso renders on contextTop — no fabric object churn. */
  private _drawLassoPreview(): void {
    const fc = this._fc;
    const pts = this._lassoPts;
    const ctx = fc?.contextTop;
    if (!ctx || !pts || pts.length < 2) return;
    fc.clearContext(ctx);
    ctx.save();
    // Lasso points are scene coordinates; contextTop paints in screen space, so
    // the viewport transform has to be applied (and the stroke divided back out
    // of the zoom to stay a hairline).
    const vpt = fc.viewportTransform;
    const zoom = fc.getZoom?.() || 1;
    if (vpt) ctx.transform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);
    ctx.strokeStyle = 'rgba(90, 155, 255, 0.9)';
    ctx.lineWidth = 1.5 / zoom;
    ctx.setLineDash([5 / zoom, 4 / zoom]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.restore();
  }

  private _finishLasso(): void {
    const fc = this._fc;
    const pts = this._lassoPts;
    this._lassoPts = null;
    if (!fc) return;
    try {
      fc.clearContext(fc.contextTop);
    } catch {}
    if (!pts || pts.length < 3) {
      this._setTool('select');
      return;
    }
    const inside = (p: { x: number; y: number }): boolean => {
      // Ray casting.
      let hit = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i];
        const b = pts[j];
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
          hit = !hit;
        }
      }
      return hit;
    };
    const matches = (fc.getObjects() as any[]).filter(
      (o) => o?.data?.kind && inside(o.getCenterPoint()),
    );
    this._setTool('select');
    if (!matches.length) return;
    if (matches.length === 1) {
      fc.setActiveObject(matches[0]);
    } else {
      const fabric = (window as any).fabric;
      const sel = new fabric.ActiveSelection(matches, { canvas: fc });
      fc.setActiveObject(sel);
    }
    fc.requestRenderAll();
    this._syncControlsFromSelection();
  }

  // ── Clipboard / duplicate ──────────────────────────────────────────────────

  /**
   * Serialize the selection through the persisted overlay model — normalized
   * coords make the clipboard slide-independent, and ActiveSelection members
   * are flattened first (their left/top are group-relative while selected).
   */
  private _selectionOverlays(): SlideOverlay[] {
    return this._withFlatSelection((members) =>
      this._withBoundLabels(members)
        .map((o) => fabricToOverlay(o, this._W, this._H))
        .filter(Boolean) as SlideOverlay[],
    );
  }

  /**
   * Run `fn` with any ActiveSelection temporarily dissolved (so members report
   * absolute coordinates), then re-select. The member list is passed in because
   * dissolving the selection empties `getActiveObjects()` — reading it inside
   * the callback would see nothing.
   */
  private _withFlatSelection<T>(fn: (members: any[]) => T): T {
    const fc = this._fc;
    const sel: any = fc?.getActiveObject?.();
    if (!sel) return fn([]);
    if (sel.type !== 'activeSelection') return fn(sel.data?.kind ? [sel] : []);
    const members: any[] = sel.getObjects().slice();
    fc.discardActiveObject();
    try {
      return fn(members.filter((o) => o?.data?.kind));
    } finally {
      const fabric = (window as any).fabric;
      const ns = new fabric.ActiveSelection(members, { canvas: fc });
      fc.setActiveObject(ns);
      fc.requestRenderAll();
    }
  }

  private _copySelection(): boolean {
    const overlays = this._selectionOverlays();
    if (!overlays.length) return false;
    SlideEditor._clipboard = overlays;
    this._showToast(`Copied ${overlays.length} object${overlays.length > 1 ? 's' : ''}`);
    return true;
  }

  private _cutSelection(): void {
    if (this._copySelection()) this._deleteSelection();
  }

  private _paste(): void {
    this._addOverlays(SlideEditor._clipboard, PASTE_OFFSET_PX);
  }

  private _duplicateSelection(): void {
    this._addOverlays(this._selectionOverlays(), PASTE_OFFSET_PX);
  }

  private _addOverlays(overlays: readonly SlideOverlay[], offsetPx: number): void {
    if (!this._fc || !overlays.length) return;
    const added: any[] = [];
    // Copies group and label among themselves, never back into the originals.
    for (const o of this._reidOverlays(overlays)) {
      const obj = overlayToFabric(o, this._W, this._H);
      if (!obj) continue;
      obj.set({ left: (obj.left ?? 0) + offsetPx, top: (obj.top ?? 0) + offsetPx });
      obj.setCoords();
      if (isLinework(obj)) this._attachArrowControls(obj);
      this._fc.add(obj);
      added.push(obj);
    }
    if (!added.length) return;
    this._setTool('select');
    this._fc.discardActiveObject();
    if (added.length === 1) {
      this._fc.setActiveObject(added[0]);
    } else {
      const fabric = (window as any).fabric;
      this._fc.setActiveObject(new fabric.ActiveSelection(added, { canvas: this._fc }));
    }
    this._fc.requestRenderAll();
    this._commit();
    this._syncControlsFromSelection();
  }

  private _selectAll(): void {
    if (!this._fc) return;
    const objs = (this._fc.getObjects() as any[]).filter((o) => o?.data?.kind);
    if (!objs.length) return;
    this._setTool('select');
    this._fc.discardActiveObject();
    if (objs.length === 1) {
      this._fc.setActiveObject(objs[0]);
    } else {
      const fabric = (window as any).fabric;
      this._fc.setActiveObject(new fabric.ActiveSelection(objs, { canvas: this._fc }));
    }
    this._fc.requestRenderAll();
    this._syncControlsFromSelection();
  }

  // ── Bound text labels ──────────────────────────────────────────────────────

  /** Every annotation object on the canvas (skips previews and the background). */
  private _overlayObjects(): any[] {
    return ((this._fc?.getObjects?.() ?? []) as any[]).filter((o) => o?.data?.kind);
  }

  private _overlayIndex(obj: any): number {
    return ((this._fc?.getObjects?.() ?? []) as any[]).indexOf(obj);
  }

  /** The text object bound to `container`, if it has one. */
  private _labelFor(container: any): any | null {
    const id = container?.data?.id;
    if (!id) return null;
    return this._overlayObjects().find((o) => o.data.labelOf === id) ?? null;
  }

  private _containerFor(label: any): any | null {
    const id = label?.data?.labelOf;
    if (!id) return null;
    return this._overlayObjects().find((o) => o.data.id === id) ?? null;
  }

  /** Kinds a label can be bound to: every box shape, plus arrows and lines. */
  private _canHoldLabel(obj: any): boolean {
    const k = obj?.data?.kind;
    return !!k && (isBoxKind(k) || isLinework(obj));
  }

  /** Exactly one container plus its own label — the combined panel context. */
  private _labeledPair(objs: any[]): { container: any; label: any } | null {
    if (objs.length !== 2) return null;
    const label = objs.find((o) => o.data.labelOf);
    const container = objs.find((o) => o !== label);
    if (!label || !container || label.data.labelOf !== container.data.id) return null;
    return { container, label };
  }

  /** Add the bound label of every container in `objs` (a shape's label follows it). */
  private _withBoundLabels(objs: any[]): any[] {
    if (!objs.length) return objs;
    const ids = new Set(objs.map((o) => o.data.id));
    const labels = this._overlayObjects().filter(
      (o) => o.data.labelOf && ids.has(o.data.labelOf) && !objs.includes(o),
    );
    return labels.length ? [...objs, ...labels] : objs;
  }

  /**
   * Everything that must be selected together with `obj`: its soft group (if
   * any) and every bound label on the result. A label resolves to its container
   * first, so clicking either half of a labelled shape selects the pair — which
   * is what makes moving, scaling and rotating carry the text along without any
   * per-frame relayout.
   */
  private _cohortFor(obj: any): any[] {
    const all = this._overlayObjects();
    let seed = obj;
    if (obj?.data?.labelOf) {
      const owner = all.find((o) => o.data.id === obj.data.labelOf);
      if (owner) seed = owner;
    }
    const gid: string | undefined = seed.data.groupId;
    const base = gid ? all.filter((o) => o.data.groupId === gid) : [seed];
    const ids = new Set(base.map((o) => o.data.id));
    return [
      ...base,
      ...all.filter((o) => o.data.labelOf && ids.has(o.data.labelOf) && !base.includes(o)),
    ];
  }

  /** Half-way along an arrow's polyline — a bent arrow's middle vertex can sit well off its visual center. */
  private _arrowMidpoint(arrow: any): any | null {
    const fabric = (window as any).fabric;
    const lp: Array<{ x: number; y: number }> = arrow?.data?.localPoints ?? [];
    if (lp.length < 2) return null;
    const m = arrow.calcTransformMatrix();
    const pts = lp.map((p) => fabric.util.transformPoint(new fabric.Point(p.x, p.y), m));
    const segs: number[] = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      segs.push(d);
      total += d;
    }
    let walked = 0;
    for (let i = 0; i < segs.length; i++) {
      if (walked + segs[i] >= total / 2) {
        const t = segs[i] ? (total / 2 - walked) / segs[i] : 0;
        return new fabric.Point(
          pts[i].x + (pts[i + 1].x - pts[i].x) * t,
          pts[i].y + (pts[i + 1].y - pts[i].y) * t,
        );
      }
      walked += segs[i];
    }
    return pts[pts.length - 1];
  }

  /**
   * Re-fit and re-center a label on its container. Only ever called with both
   * objects out of any ActiveSelection, so their coordinates are absolute.
   * Any scale the label picked up from a container resize is preserved — the
   * width is divided back out so the glyph size stays where the user left it.
   */
  private _layoutLabel(container: any, label: any): void {
    const fabric = (window as any).fabric;
    if (!container || !label) return;
    // Inside an ActiveSelection every coordinate is group-relative, so any
    // position computed here would be wrong — the pair moves as one anyway.
    if (container.group || label.group) return;
    const sx = label.scaleX || 1;
    if (isLinework(container)) {
      const mid = this._arrowMidpoint(container);
      if (!mid) return;
      label.set({ angle: 0, width: Math.max(40, (container.getScaledWidth() * 0.6) / sx) });
      label.setPositionByOrigin(mid, 'center', 'center');
    } else {
      const fit = LABEL_FIT[container.data.kind] ?? { w: 0.86, dy: 0 };
      const w = container.getScaledWidth();
      const h = container.getScaledHeight();
      const angle = container.angle ?? 0;
      label.set({ angle, width: Math.max(24, (w * fit.w) / sx) });
      const offset = fabric.util.rotateVector(
        new fabric.Point(0, h * fit.dy),
        fabric.util.degreesToRadians(angle),
      );
      label.setPositionByOrigin(container.getCenterPoint().add(offset), 'center', 'center');
    }
    label.setCoords();
  }

  /** Create the container's label if it has none, then drop straight into text editing. */
  private _editLabel(container: any): void {
    const fc = this._fc;
    if (!fc || !this._canHoldLabel(container) || container.data.locked) return;
    // Drop the selection FIRST: double-clicking a shape arrives with the
    // container already promoted into an ActiveSelection (see _cohortFor), and
    // _layoutLabel refuses group-relative coordinates — laying out before this
    // would leave a brand-new label parked at the canvas origin.
    fc.discardActiveObject();
    let label = this._labelFor(container);
    const created = !label;
    if (!label) {
      const fabric = (window as any).fabric;
      const d = this._defaults;
      // Start at a size that fits the shape; the user can set any size after.
      const fontSize = isLinework(container)
        ? d.fontSizePx
        : Math.max(9, Math.min(d.fontSizePx, Math.round(container.getScaledHeight() * 0.3)));
      label = new fabric.Textbox('Text', {
        left: 0,
        top: 0,
        width: 60,
        fontSize,
        fontFamily: d.fontFamily,
        fontWeight: d.bold ? 'bold' : 'normal',
        fontStyle: d.italic ? 'italic' : 'normal',
        underline: d.underline,
        textAlign: 'center',
        fill: d.textColor,
        opacity: container.opacity ?? 1,
        data: { id: overlayUuid(), kind: 'text', labelOf: container.data.id },
      });
      fc.add(label);
    }
    this._layoutLabel(container, label);
    fc.moveTo(label, this._overlayIndex(container) + 1);
    fc.setActiveObject(label);
    label.enterEditing();
    if (created) label.selectAll();
    fc.requestRenderAll();
  }

  /** Double-click: label a shape / arrow, or edit an existing text object. */
  private _onDoubleClick(opt: any): void {
    const fc = this._fc;
    if (!fc || this._tool !== 'select') return;
    // Trailing half of the double-click that just finished an arrow — not a
    // request to label it.
    if (Date.now() - this._arrowFinishedByDblClickAt < 600) {
      this._arrowFinishedByDblClickAt = 0;
      return;
    }
    // skipGroup, so a container inside the live ActiveSelection resolves to the
    // object itself rather than the selection frame.
    const target: any = fc.findTarget?.(opt.e, true);
    if (!target?.data?.kind || target.data.locked) return;
    if (target.data.kind === 'text') {
      // Reached explicitly: fabric's own double-click-to-edit only fires when
      // the text is the sole active object, and a label never is (see _cohortFor).
      fc.discardActiveObject();
      fc.setActiveObject(target);
      target.enterEditing?.();
      fc.requestRenderAll();
      return;
    }
    this._editLabel(target);
  }

  /** Bound labels always sit directly above their container in the stack. */
  private _normalizeLabelStacking(): void {
    const fc = this._fc;
    if (!fc) return;
    for (const label of this._overlayObjects()) {
      if (!label.data.labelOf) continue;
      const owner = this._containerFor(label);
      if (!owner) continue;
      const want = this._overlayIndex(owner) + 1;
      if (this._overlayIndex(label) !== want) fc.moveTo(label, want);
    }
  }

  /** A link into an overlay that no longer exists degrades to plain text. */
  private _dropOrphanLabels(): void {
    const objs = this._overlayObjects();
    const ids = new Set(objs.map((o) => o.data.id));
    for (const o of objs) {
      if (o.data.labelOf && !ids.has(o.data.labelOf)) delete o.data.labelOf;
    }
  }

  // ── Selection helpers ──────────────────────────────────────────────────────

  /** Selected overlay objects — an ActiveSelection is already reported as its members. */
  private _selectedObjects(): any[] {
    return ((this._fc?.getActiveObjects?.() ?? []) as any[]).filter((o) => o?.data?.kind);
  }

  /** The selection minus locked objects — every mutating action works off this. */
  private _unlockedSelection(): any[] {
    return this._selectedObjects().filter((o) => !o.data.locked);
  }

  /** Select exactly `objs` (single object or ActiveSelection) and resync the panel. */
  private _selectObjects(objs: any[]): void {
    const fc = this._fc;
    if (!fc) return;
    fc.discardActiveObject();
    if (objs.length === 1) {
      fc.setActiveObject(objs[0]);
    } else if (objs.length > 1) {
      const fabric = (window as any).fabric;
      fc.setActiveObject(new fabric.ActiveSelection(objs, { canvas: fc }));
    }
    fc.requestRenderAll();
    this._syncControlsFromSelection();
  }

  /**
   * Runs in the canvas wrapper's capture phase, i.e. BEFORE fabric's own
   * mousedown listener on the child upper canvas (at the target element the
   * capture flag no longer orders listeners, so the wrapper is the last place
   * that reliably goes first). Both behaviours here have to land before
   * fabric sets up its drag transform:
   *
   *  - Alt+drag leaves a copy behind, so the drag itself needs no special case.
   *  - Clicking one member of a soft group promotes the selection to the whole
   *    group, so the transform fabric is about to build covers every member.
   */
  private _onPreMouseDown(e: MouseEvent): void {
    const fc = this._fc;
    if (!fc) return;
    // Panning outranks every tool, so it's resolved before the tool check —
    // and swallowing the event here stops fabric starting a draw or a selection.
    if (this._spaceDown || e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      this._beginPan(e);
      return;
    }
    if (this._tool !== 'select' || e.button !== 0) return;
    const target: any = fc.findTarget?.(e, false);
    if (!target?.data?.kind) return;

    if (e.altKey && !target.__corner && !target.data.locked) {
      this._leaveCopyBehind(target);
      return;
    }
    // Shift+click is fabric's add-to-selection gesture — leave it alone.
    if (e.shiftKey) return;
    const cohort = this._cohortFor(target);
    if (cohort.length < 2) return;
    const current = this._selectedObjects();
    if (current.length === cohort.length && cohort.every((m) => current.includes(m))) return;
    const fabric = (window as any).fabric;
    fc.discardActiveObject();
    fc.setActiveObject(new fabric.ActiveSelection(cohort, { canvas: fc }), e);
    fc.requestRenderAll();
  }

  /**
   * Alt+drag duplicate: drop an unselected copy at the object's current spot
   * and let the user drag the original away. Same result as Excalidraw without
   * swapping fabric's drag target mid-gesture. Groups and labels copy as a unit.
   */
  private _leaveCopyBehind(target: any): void {
    const fc = this._fc;
    if (!fc) return;
    const pairs = this._cohortFor(target)
      .map((obj) => ({ obj, overlay: fabricToOverlay(obj, this._W, this._H) }))
      .filter((p) => !!p.overlay);
    if (!pairs.length) return;
    const clones = this._reidOverlays(pairs.map((p) => p.overlay as SlideOverlay));
    let copied = 0;
    clones.forEach((o, i) => {
      const clone = overlayToFabric(o, this._W, this._H);
      if (!clone) return;
      if (isLinework(clone)) this._attachArrowControls(clone);
      fc.add(clone);
      fc.moveTo(clone, Math.max(0, this._overlayIndex(pairs[i].obj)));
      copied++;
    });
    if (copied) this._commit();
  }

  /**
   * Fresh ids for a batch of overlays, with `groupId` and `labelOf` rewritten
   * to point inside the copy rather than back at the originals. A label copied
   * without its container loses its link and becomes plain text.
   */
  private _reidOverlays(overlays: readonly SlideOverlay[]): SlideOverlay[] {
    const ids = new Map<string, string>();
    const groups = new Map<string, string>();
    for (const o of overlays) ids.set(o.id, overlayUuid());
    return overlays.map((o) => {
      const next: SlideOverlay = { ...o, id: ids.get(o.id) ?? overlayUuid() };
      if (o.groupId) {
        if (!groups.has(o.groupId)) groups.set(o.groupId, overlayUuid());
        next.groupId = groups.get(o.groupId);
      }
      if (o.labelOf) {
        const owner = ids.get(o.labelOf);
        if (owner) next.labelOf = owner;
        else delete next.labelOf;
      }
      return next;
    });
  }

  // ── Group / lock / flip / arrange ───────────────────────────────────────────

  private _groupSelection(): void {
    const objs = this._selectedObjects();
    // Counted in units: a shape and its own label are already inseparable, so
    // that pair alone is not a group.
    if (objs.filter((o) => !o.data.labelOf).length < 2) return;
    const gid = overlayUuid();
    objs.forEach((o) => {
      o.data.groupId = gid;
    });
    this._commit();
    this._selectObjects(objs);
    this._showToast(`Grouped ${objs.length} objects`);
  }

  private _ungroupSelection(): void {
    const objs = this._selectedObjects();
    if (!objs.some((o) => o.data.groupId)) return;
    objs.forEach((o) => {
      delete o.data.groupId;
    });
    this._commit();
    this._selectObjects(objs);
    this._showToast('Ungrouped');
  }

  /** Lock the selection unless it's already fully locked, in which case unlock it. */
  private _toggleLock(): void {
    const objs = this._selectedObjects();
    if (!objs.length) return;
    const lock = !objs.every((o) => !!o.data.locked);
    objs.forEach((o) => applyLockState(o, lock));
    // An ActiveSelection drags its members regardless of their own lock flags,
    // so locking has to drop the selection to actually pin anything.
    if (lock) this._fc.discardActiveObject();
    this._fc.requestRenderAll();
    this._commit();
    this._syncPanelContext();
    this._showToast(lock ? 'Locked' : 'Unlocked');
  }

  /**
   * Mirror the selection about its own bounding box. Box kinds and text flip
   * via fabric's flipX/flipY (persisted, and native in PPTX); point-based
   * kinds mirror their `points` instead, so both round-trip with no
   * shape-specific case. Rotated boxes mirror their bounding box rather than
   * their rotated frame — the same approximation the resize handles make.
   */
  private _flipSelection(axis: 'x' | 'y'): void {
    const objs = this._unlockedSelection();
    if (!objs.length) return;
    this._rebuildFromOverlays(objs, (list) => {
      let min = Infinity;
      let max = -Infinity;
      for (const o of list) {
        const lo = axis === 'x' ? o.x : o.y;
        const hi = lo + (axis === 'x' ? o.w : o.h);
        if (lo < min) min = lo;
        if (hi > max) max = hi;
      }
      const c = (min + max) / 2;
      return list.map((o) => {
        const next: SlideOverlay = { ...o };
        if (next.points) {
          next.points = next.points.map((p) =>
            axis === 'x' ? { x: 2 * c - p.x, y: p.y } : { x: p.x, y: 2 * c - p.y },
          );
        } else if (next.kind !== 'text') {
          // Text mirrors its position with the rest of the selection but keeps
          // its glyphs readable — mirrored type is never what's wanted, and
          // PPTX text has no dependable flip either.
          const key = axis === 'x' ? 'flipX' : 'flipY';
          if (next[key]) delete next[key];
          else next[key] = true;
          // A mirror reverses the sense of rotation: M∘R(θ) = R(−θ)∘M, for
          // either axis. Without this, flipping a rotated shape tilts it the
          // wrong way.
          if (next.rotation) next.rotation = (360 - next.rotation) % 360;
        }
        if (axis === 'x') next.x = 2 * c - (o.x + o.w);
        else next.y = 2 * c - (o.y + o.h);
        return next;
      });
    });
  }

  /**
   * Round-trip `objs` through the persisted overlay model with `transform`
   * applied, then swap the rebuilt objects back in at their original stacking
   * positions. Ids, grouping and lock state survive because they live on the
   * overlay. Used by geometry edits that no fabric property set expresses.
   */
  private _rebuildFromOverlays(
    objs: any[],
    transform: (list: SlideOverlay[]) => SlideOverlay[],
  ): void {
    const fc = this._fc;
    if (!fc || !objs.length) return;
    // Members of an ActiveSelection carry group-relative left/top — drop the
    // selection first so fabricToOverlay sees absolute coordinates. (The usual
    // _withFlatSelection helper can't be used here: it restores the selection
    // from objects this method is about to remove.)
    fc.discardActiveObject();

    const stack = fc.getObjects() as any[];
    const entries = objs
      .map((obj) => ({
        obj,
        index: stack.indexOf(obj),
        overlay: fabricToOverlay(obj, this._W, this._H),
      }))
      .filter((e) => !!e.overlay);
    if (!entries.length) return;

    const next = transform(entries.map((e) => e.overlay as SlideOverlay));
    const rebuilt: any[] = [];
    entries.forEach((e, i) => {
      const obj = overlayToFabric(next[i], this._W, this._H);
      if (!obj) return;
      fc.remove(e.obj);
      if (isLinework(obj)) this._attachArrowControls(obj);
      fc.add(obj);
      if (e.index >= 0) fc.moveTo(obj, e.index);
      rebuilt.push(obj);
    });
    if (!rebuilt.length) return;
    this._commit();
    this._selectObjects(rebuilt);
  }

  /** Absolute bounding boxes of `objs`, valid only with the selection dissolved. */
  private _boxesOf(objs: any[]): Array<{ obj: any; r: any }> {
    return objs.map((obj) => ({ obj, r: obj.getBoundingRect(true, true) }));
  }

  private _shift(obj: any, dx: number, dy: number): void {
    if (!dx && !dy) return;
    obj.set({ left: (obj.left ?? 0) + dx, top: (obj.top ?? 0) + dy });
    obj.setCoords();
  }

  /** Move an object and its bound label together — align/distribute move units, not objects. */
  private _shiftUnit(obj: any, dx: number, dy: number): void {
    this._shift(obj, dx, dy);
    const label = this._labelFor(obj);
    if (label && label !== obj) this._shift(label, dx, dy);
  }

  /**
   * Align/distribute targets: the selection minus bound labels, which travel
   * with their container instead of being positioned in their own right.
   */
  private _arrangeUnits(): any[] {
    return this._unlockedSelection().filter((o) => !o.data.labelOf);
  }

  private _alignSelection(mode: AlignMode): void {
    const objs = this._arrangeUnits();
    if (objs.length < 2) return;
    const horizontal = mode === 'left' || mode === 'right' || mode === 'centerH';
    this._withFlatSelection(() => {
      const boxes = this._boxesOf(objs);
      let min = Infinity;
      let max = -Infinity;
      for (const b of boxes) {
        const lo = horizontal ? b.r.left : b.r.top;
        const hi = lo + (horizontal ? b.r.width : b.r.height);
        if (lo < min) min = lo;
        if (hi > max) max = hi;
      }
      for (const b of boxes) {
        const lo = horizontal ? b.r.left : b.r.top;
        const size = horizontal ? b.r.width : b.r.height;
        let delta = 0;
        switch (mode) {
          case 'left':
          case 'top':
            delta = min - lo;
            break;
          case 'right':
          case 'bottom':
            delta = max - (lo + size);
            break;
          default: // centerH | centerV
            delta = (min + max) / 2 - (lo + size / 2);
        }
        this._shiftUnit(b.obj, horizontal ? delta : 0, horizontal ? 0 : delta);
      }
    });
    this._fc.requestRenderAll();
    this._commit();
  }

  /** Even out the gaps between the outermost two objects' centers. */
  private _distributeSelection(axis: 'h' | 'v'): void {
    const objs = this._arrangeUnits();
    if (objs.length < 3) return;
    this._withFlatSelection(() => {
      const center = (r: any) => (axis === 'h' ? r.left + r.width / 2 : r.top + r.height / 2);
      const boxes = this._boxesOf(objs).sort((a, b) => center(a.r) - center(b.r));
      const first = center(boxes[0].r);
      const last = center(boxes[boxes.length - 1].r);
      const step = (last - first) / (boxes.length - 1);
      boxes.forEach((b, i) => {
        if (i === 0 || i === boxes.length - 1) return;
        const delta = first + step * i - center(b.r);
        this._shiftUnit(b.obj, axis === 'h' ? delta : 0, axis === 'h' ? 0 : delta);
      });
    });
    this._fc.requestRenderAll();
    this._commit();
  }

  // ── Style clipboard ────────────────────────────────────────────────────────

  private _copyStyles(): void {
    if (!this._selectedObjects().length) return;
    // _defaults already mirrors the selection — see _syncControlsFromSelection.
    SlideEditor._styleClipboard = { ...this._defaults };
    this._showToast('Styles copied');
  }

  private _pasteStyles(): void {
    const clip = SlideEditor._styleClipboard;
    const objs = this._unlockedSelection();
    if (!clip || !objs.length) return;
    this._defaults = { ...clip };
    for (const obj of objs) {
      for (const prop of COPYABLE_STYLE_PROPS) this._applyStyleTo(obj, prop);
    }
    // Arrow shape and terminators are geometry — those arrows have to be
    // rebuilt, and the rebuild replaces the object, so the selection is
    // re-formed from the new ones.
    const stale = objs.filter(
      (o) =>
        isLinework(o) &&
        ((o.data.arrowType ?? 'sharp') !== clip.arrowType ||
          (o.data.kind === 'arrow' &&
            ((o.data.arrowStart ?? 'none') !== clip.arrowStart ||
              (o.data.arrowEnd ?? 'triangle') !== clip.arrowEnd))),
    );
    if (stale.length) {
      const kept = objs.filter((o) => !stale.includes(o));
      const rebuilt = stale.map((o) => this._applyArrowGeometryChange(o, true));
      this._selectObjects([...kept, ...rebuilt]);
    }
    this._fc.requestRenderAll();
    this._commit();
    this._ui?.refreshPanelValues();
  }

  // ── Tool lock ──────────────────────────────────────────────────────────────

  private _setToolLock(on: boolean): void {
    this._toolLock = on;
    this._ui?.setToolLock(on);
    this._showToast(on ? 'Tool stays armed after each draw (Q)' : 'Tool reverts to Select (Q)');
  }

  // ── Right-click menu ───────────────────────────────────────────────────────

  private _onCanvasContextMenu(e: MouseEvent): void {
    e.preventDefault();
    const fc = this._fc;
    const ui = this._ui;
    if (!fc || !ui) return;
    if (this._tool !== 'select') this._setTool('select');

    const target: any = fc.findTarget?.(e, false);
    if (target?.data?.kind && !this._selectedObjects().includes(target)) {
      this._selectObjects(this._cohortFor(target));
    } else if (!target) {
      fc.discardActiveObject();
      fc.requestRenderAll();
    }

    // Resolved after the selection settles — the hit test needs the object that
    // is actually selected now.
    this._ctxVertex = this._vertexHitAt(e);

    const objs = this._selectedObjects();
    ui.showContextMenu(e.clientX, e.clientY, {
      canDeletePoint: !!this._ctxVertex,
      count: objs.length,
      locked: objs.length > 0 && objs.every((o) => !!o.data.locked),
      canGroup: objs.length > 1,
      canUngroup: objs.some((o) => !!o.data.groupId),
      canPaste: SlideEditor._clipboard.length > 0,
      canPasteStyles: !!SlideEditor._styleClipboard,
    });
  }

  // ── Undo / redo ────────────────────────────────────────────────────────────

  private _snapshotJson(): string {
    if (!this._fc) return '[]';
    return this._withFlatSelection(() =>
      JSON.stringify(
        (this._fc.getObjects() as any[])
          .map((o) => fabricToOverlay(o, this._W, this._H))
          .filter(Boolean),
      ),
    );
  }

  /** Push an undo snapshot if the canvas actually changed. */
  private _commit(): void {
    if (!this._fc) return;
    if (this._commitTimer) {
      clearTimeout(this._commitTimer);
      this._commitTimer = null;
    }
    const snap = this._snapshotJson();
    if (snap === this._undo[this._undo.length - 1]) return;
    this._undo.push(snap);
    if (this._undo.length > UNDO_CAP) this._undo.shift();
    this._redo = [];
  }

  /** Coalesce rapid-fire mutations (sliders, arrow-key nudges) into one undo step. */
  private _commitDebounced(): void {
    if (this._commitTimer) clearTimeout(this._commitTimer);
    this._commitTimer = setTimeout(() => {
      this._commitTimer = null;
      this._commit();
    }, 350);
  }

  private _undoRedo(redo: boolean): void {
    if (!this._fc) return;
    if (this._commitTimer) this._commit(); // flush pending debounce first
    if (redo) {
      const next = this._redo.pop();
      if (!next) return;
      this._undo.push(next);
      this._restore(next);
    } else {
      if (this._undo.length < 2) return;
      this._redo.push(this._undo.pop()!);
      this._restore(this._undo[this._undo.length - 1]);
    }
  }

  private _restore(json: string): void {
    let overlays: SlideOverlay[] = [];
    try {
      overlays = JSON.parse(json);
    } catch {
      return;
    }
    if (this._bendDrag || this._vertexDrag) {
      this._clearLineworkPreview();
      this._bendDrag = null;
      this._vertexDrag = null;
    }
    if (this._arrowChain) {
      if (this._arrowPreview) {
        this._fc.remove(this._arrowPreview);
        this._arrowPreview = null;
      }
      this._arrowChain = null;
      this._arrowReopenedObj = null;
    }
    this._fc.discardActiveObject();
    (this._fc.getObjects() as any[]).slice().forEach((o) => this._fc.remove(o));
    for (const o of overlays) {
      const obj = overlayToFabric(o, this._W, this._H);
      if (obj) {
        if (isLinework(obj)) this._attachArrowControls(obj);
        this._fc.add(obj);
      }
    }
    this._dropOrphanLabels();
    this._fc.requestRenderAll();
    this._syncPanelContext();
  }

  // ── Style controls ↔ selection ─────────────────────────────────────────────

  private _onStyleChanged(prop: StyleProp): void {
    const objs = this._unlockedSelection();
    // An arrow's shape and terminators are geometry, not properties, so those
    // arrows get rebuilt instead of patched — which replaces the object and so
    // re-forms the selection. Stroke width joins them because terminators are
    // sized from it: patching alone would leave a thick arrow with a tiny head.
    const shapeOnly =
      prop === 'arrowType' || prop === 'arrowStart' || prop === 'arrowEnd' || prop === 'closed';
    if (!shapeOnly) {
      for (const obj of objs) this._applyStyleTo(obj, prop);
    }
    if (shapeOnly || prop === 'strokeWidthPx') {
      // Terminators are arrow-only; the shape control and stroke width apply to
      // every linework kind.
      const arrows = objs.filter((o) => {
        if (prop === 'arrowStart' || prop === 'arrowEnd') return o?.data?.kind === 'arrow';
        if (prop === 'closed') return o?.data?.kind === 'line';
        return isLinework(o);
      });
      if (arrows.length) {
        const kept = objs.filter((o) => !arrows.includes(o));
        // Only stamp the panel's arrow slots when the arrow slots are what
        // changed — a width change must not normalize every selected arrow's
        // shape and terminators onto whatever the panel happens to show.
        const rebuilt = arrows.map((o) => this._applyArrowGeometryChange(o, shapeOnly));
        this._selectObjects([...kept, ...rebuilt]);
      }
    }
    if (objs.length) {
      this._fc.requestRenderAll();
      this._commitDebounced();
    }
    if (this._fc?.isDrawingMode) this._configureBrush();
  }

  /**
   * Rebuild one arrow, optionally re-stamping its shape + terminators from the
   * current panel defaults first. Without the stamp it just regenerates at its
   * existing settings — which is what a stroke-width change needs, so the
   * terminators come back out at the new size.
   */
  private _applyArrowGeometryChange(obj: any, stampDefaults: boolean): any {
    const fabric = (window as any).fabric;
    const lp: Array<{ x: number; y: number }> = obj.data?.localPoints ?? [];
    const m = obj.calcTransformMatrix();
    const absPoints = lp.map((p) => {
      const abs = fabric.util.transformPoint(new fabric.Point(p.x, p.y), m);
      return { x: abs.x, y: abs.y };
    });
    if (stampDefaults) {
      obj.data.arrowType = this._defaults.arrowType;
      if (obj.data.kind === 'arrow') {
        obj.data.arrowStart = this._defaults.arrowStart;
        obj.data.arrowEnd = this._defaults.arrowEnd;
      } else {
        obj.data.closed = this._defaults.closed;
      }
    }
    return this._rebuildArrow(obj, absPoints);
  }

  /** The path child that carries a linework group's stroke — always child 0. */
  private _lineworkPath(obj: any): any | null {
    return obj?.getObjects?.()?.[0] ?? null;
  }

  private _applyStyleTo(obj: any, prop: StyleProp): void {
    const d = this._defaults;
    const kind = obj?.data?.kind;
    if (!kind) return;
    const linework = isLinework(obj);
    const dashVal = d.strokeDash === 'solid' ? undefined : d.strokeDash;
    switch (prop) {
      case 'fontFamily':
        if (kind === 'text') obj.set('fontFamily', d.fontFamily);
        break;
      case 'fontSizePx':
        if (kind === 'text') obj.set('fontSize', d.fontSizePx);
        break;
      case 'bold':
        if (kind === 'text') obj.set('fontWeight', d.bold ? 'bold' : 'normal');
        break;
      case 'italic':
        if (kind === 'text') obj.set('fontStyle', d.italic ? 'italic' : 'normal');
        break;
      case 'underline':
        if (kind === 'text') obj.set('underline', d.underline);
        break;
      case 'align':
        if (kind === 'text') obj.set('textAlign', d.align);
        break;
      case 'textColor':
        if (kind === 'text') obj.set('fill', d.textColor);
        break;
      case 'fill':
      case 'fillOpacity': {
        const paint = d.fill ? withAlpha(d.fill, d.fillOpacity) : '';
        if (isBoxKind(kind)) {
          obj.set('fill', paint);
        } else if (kind === 'line' && obj.data.closed) {
          // Only a closed line has an interior to paint.
          this._lineworkPath(obj)?.set({ fill: paint });
          obj.dirty = true;
        }
        break;
      }
      case 'stroke':
        if (linework) {
          obj.getObjects?.()?.forEach((ch: any) => {
            // Terminators say which slot their colour lives in; anything
            // untagged is the linework's own path.
            if (ch.data?.arrowHead && !ch.data.strokeOnly) ch.set({ fill: d.stroke });
            else ch.set({ stroke: d.stroke });
          });
          obj.dirty = true;
        } else if (kind !== 'text') {
          obj.set('stroke', d.stroke);
        }
        break;
      case 'strokeWidthPx':
        if (linework) {
          this._lineworkPath(obj)?.set({
            strokeWidth: d.strokeWidthPx,
            ...dashProps(obj.data.strokeDash, d.strokeWidthPx),
          });
          obj.dirty = true;
        } else if (kind !== 'text' && kind !== 'highlight') {
          obj.set({
            strokeWidth: d.strokeWidthPx,
            ...dashProps(obj.data.strokeDash, d.strokeWidthPx),
          });
        }
        break;
      case 'highlightWidthPx':
        if (kind === 'highlight') obj.set('strokeWidth', d.highlightWidthPx);
        break;
      case 'strokeDash': {
        if (kind === 'text' || kind === 'highlight') break;
        obj.data.strokeDash = dashVal;
        if (linework) {
          const path = this._lineworkPath(obj);
          path?.set(dashProps(dashVal, path.strokeWidth ?? 3));
          obj.dirty = true;
        } else {
          obj.set(dashProps(dashVal, obj.strokeWidth ?? 3));
        }
        break;
      }
      case 'opacity':
        obj.set('opacity', d.opacity);
        break;
    }
    obj.setCoords?.();
  }

  private _panelContextFor(): PanelContext {
    const objs = this._selectedObjects();
    if (objs.length) {
      const locked = objs.every((o) => !!o.data.locked);
      // Counted in units, not objects — a bound label isn't independently
      // alignable, so a labelled shape must not read as a two-object selection.
      const count = objs.filter((o) => !o.data.labelOf).length;
      const closed = objs.some((o) => o.data.kind === 'line' && o.data.closed);
      // A shape with its label shows both sets of controls in one island —
      // style changes route per-object by kind, so they can't collide.
      const pair = this._labeledPair(objs);
      if (pair) {
        const ck = pair.container.data.kind;
        return {
          kind: ck === 'arrow' ? 'labeledArrow' : ck === 'line' ? 'labeledLine' : 'labeled',
          hasSelection: true,
          count,
          locked,
          closed,
        };
      }
      const kinds = new Set(objs.map((o) => o?.data?.kind).filter(Boolean));
      let kind: PanelContext['kind'] = 'mixed';
      if (kinds.size === 1) {
        const k = [...kinds][0] as string;
        // Every box shape shares one context; the rest map to themselves, and
        // freehand is the only thing left over as generic 'linework'.
        if (isBoxKind(k)) kind = 'box';
        else if (PANEL_KIND_BY_OVERLAY[k]) kind = PANEL_KIND_BY_OVERLAY[k];
        else kind = 'linework';
      }
      return { kind, hasSelection: true, count, locked, closed };
    }
    // No selection — the panel edits the tool's defaults instead.
    const idle = {
      hasSelection: false,
      count: 0,
      locked: false,
      closed: this._defaults.closed,
    };
    if (BOX_TOOLS.has(this._tool)) return { kind: 'box', ...idle };
    switch (this._tool) {
      case 'text':
        return { kind: 'text', ...idle };
      case 'arrow':
        return { kind: 'arrow', ...idle };
      case 'line':
        return { kind: 'line', ...idle };
      case 'freehand':
        return { kind: 'linework', ...idle };
      case 'highlighter':
        return { kind: 'highlight', ...idle };
      default:
        return { kind: 'none', ...idle };
    }
  }

  private _syncPanelContext(): void {
    this._ui?.showPanel(this._panelContextFor());
  }

  /** Populate the properties island from the newly-selected object(s). */
  private _syncControlsFromSelection(): void {
    const obj: any = this._fc?.getActiveObject?.();
    if (obj?.data?.kind) {
      this._readStyleFrom(obj);
    } else {
      // Multi-select: an ActiveSelection carries no kind of its own, so only a
      // shape-plus-its-label pair has an unambiguous style to show. Shape
      // first, then the label — the text slots must be the ones that stick.
      const pair = this._labeledPair(this._selectedObjects());
      if (pair) {
        this._readStyleFrom(pair.container);
        this._readStyleFrom(pair.label);
      }
    }
    this._syncPanelContext();
  }

  /** Copy one object's style into the panel defaults. */
  private _readStyleFrom(obj: any): void {
    const kind = obj?.data?.kind;
    const d = this._defaults;
    if (!kind) return;

    if (kind === 'text') {
      d.fontFamily = obj.fontFamily || 'Arial';
      d.fontSizePx = Math.round(obj.fontSize ?? 28);
      d.bold = obj.fontWeight === 'bold';
      d.italic = obj.fontStyle === 'italic';
      d.underline = !!obj.underline;
      d.align = obj.textAlign === 'center' || obj.textAlign === 'right' ? obj.textAlign : 'left';
      d.textColor = parseColor(obj.fill)?.hex ?? d.textColor;
    } else {
      const closedLine = kind === 'line' && !!obj.data.closed;
      if (isBoxKind(kind) || closedLine) {
        const fill = parseColor(closedLine ? this._lineworkPath(obj)?.fill : obj.fill);
        if (fill) {
          d.fill = fill.hex;
          d.fillOpacity = fill.alpha;
        } else {
          d.fill = null;
        }
      }
      if (kind === 'line') d.closed = closedLine;
      const strokeSrc = isLinework(obj) ? this._lineworkPath(obj) : obj;
      const stroke = parseColor(strokeSrc?.stroke);
      if (stroke) d.stroke = stroke.hex;
      if (strokeSrc?.strokeWidth) {
        if (kind === 'highlight') d.highlightWidthPx = Math.round(strokeSrc.strokeWidth);
        else d.strokeWidthPx = Math.round(strokeSrc.strokeWidth);
      }
      d.strokeDash = obj.data.strokeDash ?? 'solid';
      // One shared shape slot for both linework kinds; terminators are arrows only.
      if (isLinework(obj)) d.arrowType = (obj.data.arrowType ?? 'sharp') as ArrowType;
      if (kind === 'arrow') {
        d.arrowStart = obj.data.arrowStart ?? 'none';
        d.arrowEnd = obj.data.arrowEnd ?? 'triangle';
      }
    }
    d.opacity = obj.opacity ?? 1;
  }

  // ── Keys ───────────────────────────────────────────────────────────────────

  private _attachKeys(): void {
    this._keyHandler = (e: KeyboardEvent) => {
      if (!this._stage) return;
      const target = e.target as HTMLElement | null;
      const inInput =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      const active: any = this._fc?.getActiveObject?.();
      const editingText = !!active?.isEditing;

      if (e.key === 'Escape' && inInput) {
        // Chrome inputs (title/notes/font-size/custom-color…) — just drop
        // focus. Falling into the ladder below would reach close(false) and
        // silently discard every unsaved annotation/title/notes edit.
        e.stopPropagation();
        target?.blur();
        return;
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        if (this._ui?.helpOpen) {
          this._ui.closeHelp();
          return;
        }
        if (this._ui?.contextMenuOpen) {
          this._ui.hideContextMenu();
          return;
        }
        if (editingText) {
          active.exitEditing();
          return;
        }
        if (this._arrowChain) {
          this._clearArrowChain();
          this._fc?.requestRenderAll();
          this._setTool('select');
          return;
        }
        if (this._tool !== 'select') {
          this._setTool('select');
          return;
        }
        if (active) {
          this._fc.discardActiveObject();
          this._fc.requestRenderAll();
          this._syncPanelContext();
          return;
        }
        this.close(false);
        return;
      }
      // While typing (text object or chrome inputs) leave every other key
      // native — including Ctrl+C/V for real text clipboard.
      if (inInput || editingText) return;

      if (e.key === 'Enter' && this._arrowChain) {
        e.preventDefault();
        e.stopPropagation();
        this._onArrowFinish();
        return;
      }

      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.altKey) {
        // Style clipboard — Excalidraw's Ctrl+Alt+C / Ctrl+Alt+V.
        const k = e.key.toLowerCase();
        if (k !== 'c' && k !== 'v') return;
        e.preventDefault();
        e.stopPropagation();
        if (k === 'c') this._copyStyles();
        else this._pasteStyles();
        return;
      }
      if (mod && !e.altKey) {
        const k = e.key.toLowerCase();
        let handled = true;
        switch (k) {
          case 'c':
            this._copySelection();
            break;
          case 'g':
            if (e.shiftKey) this._ungroupSelection();
            else this._groupSelection();
            break;
          case 'l':
            if (e.shiftKey) this._toggleLock();
            else handled = false;
            break;
          case 'x':
            this._cutSelection();
            break;
          case 'v':
            // Only claim Ctrl+V when there is something of ours to paste.
            // Otherwise let it through: preventDefault here would suppress the
            // native paste event, which is the only way to reach an image on
            // the OS clipboard (see the paste listener in _attachKeys).
            if (SlideEditor._clipboard.length) this._paste();
            else handled = false;
            break;
          case 'd':
            this._duplicateSelection();
            break;
          case 'a':
            this._selectAll();
            break;
          case 'z':
            this._undoRedo(e.shiftKey);
            break;
          case 'y':
            this._undoRedo(true);
            break;
          case ']':
            this._layerAction('forward');
            break;
          case '}': // Shift+] on a US layout reports e.key as '}', not ']'
            this._layerAction('front');
            break;
          case '[':
            this._layerAction('backward');
            break;
          case '{': // Shift+[ → '{', same reasoning as '}' above
            this._layerAction('back');
            break;
          case 'k':
            // No editor use for Ctrl+K — swallow it so the command palette
            // can't open (invisibly, behind this full-screen modal) underneath.
            break;
          case '0':
            this._resetZoom();
            break;
          case '=':
          case '+':
            this._zoomTo(this._fc.getZoom() * ZOOM_STEP);
            break;
          case '-':
            this._zoomTo(this._fc.getZoom() / ZOOM_STEP);
            break;
          default:
            handled = false;
        }
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      if (!mod && !e.altKey) {
        const k = e.key.toLowerCase();
        if (e.key === ' ') {
          // Arm panning; also swallow the key so it can't scroll the stage.
          e.preventDefault();
          e.stopPropagation();
          if (!this._spaceDown) {
            this._spaceDown = true;
            if (this._fc) this._fc.defaultCursor = 'grab';
          }
          return;
        }
        if (e.key === '?') {
          e.preventDefault();
          e.stopPropagation();
          this._ui?.toggleHelp();
          return;
        }
        // Shift+H / Shift+V flip. Checked before the tool table, which would
        // otherwise see the same 'h' / 'v' and arm the highlighter / select.
        if (e.shiftKey && (k === 'h' || k === 'v')) {
          e.preventDefault();
          e.stopPropagation();
          this._flipSelection(k === 'h' ? 'x' : 'y');
          return;
        }
        if (!e.shiftKey) {
          if (k === 'q') {
            e.preventDefault();
            e.stopPropagation();
            this._setToolLock(!this._toolLock);
            return;
          }
          // Single-key tool shortcuts (Excalidraw layout).
          const def = TOOL_DEFS.find((t) => t.letter === k || t.num === e.key);
          if (def) {
            e.preventDefault();
            e.stopPropagation();
            this._setTool(def.tool);
            return;
          }
        }
        if (NUDGE_KEYS[e.key] && active) {
          e.preventDefault();
          e.stopPropagation();
          // Locked objects never move — drop them from the selection first so
          // the ActiveSelection frame stays in step with what actually shifts.
          const movable = this._unlockedSelection();
          if (!movable.length) return;
          if (movable.length !== this._selectedObjects().length) this._selectObjects(movable);
          const target: any = this._fc.getActiveObject();
          if (!target) return;
          const [dx, dy] = NUDGE_KEYS[e.key];
          const step = e.shiftKey ? 10 : 1;
          this._shift(target, dx * step, dy * step);
          this._fc.requestRenderAll();
          this._commitDebounced();
          return;
        }
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Modal editor: never let these leak to KeyboardShortcutManager's
        // document-level (bubble-phase) handler underneath, selected or not
        // — an unhandled Delete here previously fell through and could
        // delete a real map graphic/selection behind the frozen screenshot.
        e.stopPropagation();
        e.preventDefault();
        const objs: any[] = this._fc?.getActiveObjects?.() ?? [];
        if (objs.length) this._deleteSelection();
      }
    };
    // Capture phase so Esc/Delete win over app-level shortcut managers.
    document.addEventListener('keydown', this._keyHandler, true);

    // Space is a held modifier for panning, so releasing it has to disarm —
    // including on window blur, or the cursor stays stuck in grab mode.
    this._keyUpHandler = (e: KeyboardEvent) => {
      if (e.key !== ' ' || !this._spaceDown) return;
      this._spaceDown = false;
      this._endPan();
      if (this._fc) this._fc.defaultCursor = this._tool === 'select' ? 'default' : 'crosshair';
    };
    this._blurHandler = () => {
      this._spaceDown = false;
      this._endPan();
    };
    // Images off the OS clipboard. Only reachable because the Ctrl+V branch
    // above declines to preventDefault when our own clipboard is empty.
    this._pasteHandler = (e: ClipboardEvent) => {
      if (!this._stage) return;
      const active: any = this._fc?.getActiveObject?.();
      if (active?.isEditing) return; // typing in a textbox — that's a text paste
      for (const item of Array.from(e.clipboardData?.items ?? [])) {
        if (item.kind === 'file' && item.type?.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            void this._insertImageFile(file);
            return;
          }
        }
      }
    };
    document.addEventListener('keyup', this._keyUpHandler, true);
    document.addEventListener('paste', this._pasteHandler, true);
    window.addEventListener('blur', this._blurHandler);
  }
}
