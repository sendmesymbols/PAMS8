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
import type { Slide, SlideOverlay } from './BriefingTypes';
import LaserTrail from './LaserTrail';
import {
  buildArrowPath,
  dashProps,
  fabricToOverlay,
  isBoxKind,
  makeArrowGroup,
  makeShapeObject,
  overlayToFabric,
  overlayUuid,
  parseColor,
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

export default class SlideEditor {
  private static _instance: SlideEditor | null = null;
  /** Static so copied annotations survive slide navigation → cross-slide paste. */
  private static _clipboard: SlideOverlay[] = [];

  private _stage: HTMLElement | null = null;
  private _ui: SlideEditorUI | null = null;
  private _fc: any = null; // fabric.Canvas
  private _host: SlideEditorHost | null = null;
  private _index = -1;
  private _W = 0;
  private _H = 0;
  private _tool: Tool = 'select';
  private _opening = false;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _drawing: { obj: any; startX: number; startY: number } | null = null;
  private _laser: LaserTrail | null = null;
  private _lassoPts: Array<{ x: number; y: number }> | null = null;
  private _arrowChain: Array<{ x: number; y: number }> | null = null;
  private _arrowPreview: any = null;
  private _arrowLastClickAt = 0;
  private _bendDrag: { obj: any; segmentIndex: number; lastPoint: { x: number; y: number } } | null = null;
  private _bendPreview: any = null;
  private _erasing = false;
  private _erasedAny = false;
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
      if (ui.titleInput) ui.titleInput.value = slide.title ?? '';
      if (ui.notesArea) {
        ui.notesArea.value = slide.notes ?? '';
        if (slide.notes) ui.notesArea.style.display = '';
      }
      ui.updateNav(index, host.getSlideCount());

      try {
        this._fc?.dispose?.();
      } catch {}
      this._fc = null;
      this._laser = null;
      this._drawing = null;
      this._lassoPts = null;
      this._erasing = false;
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
      // Only warn persistently when we truly have nothing to show — a
      // successful fallback gets a toast instead (see below), not a banner.
      this._initCanvas(fabric, slide, size, bg.missingSymbols && !bg.usedFallback);
      // Fresh undo baseline per slide — history never crosses slides.
      if (this._commitTimer) clearTimeout(this._commitTimer);
      this._commitTimer = null;
      this._undo = [this._snapshotJson()];
      this._redo = [];
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
    if (this._commitTimer) {
      clearTimeout(this._commitTimer);
      this._commitTimer = null;
    }
    this._laser?.dispose();
    this._laser = null;
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
    this._fc.requestRenderAll();
    this._commit();
  }

  private _deleteSelection(): void {
    const objs: any[] = this._fc?.getActiveObjects?.() ?? [];
    if (!objs.length) return;
    if (this._bendDrag) {
      if (this._bendPreview) {
        this._fc.remove(this._bendPreview);
        this._bendPreview = null;
      }
      this._bendDrag = null;
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

    const barH = ui.bar?.offsetHeight ?? 56;
    const maxW = Math.max(320, window.innerWidth - 32);
    const maxH = Math.max(180, window.innerHeight - barH - 48);
    const srcW = size?.w ?? 1280;
    const srcH = size?.h ?? 720;
    const scale = Math.min(maxW / srcW, maxH / srcH, 1.5);
    this._W = Math.max(320, Math.round(srcW * scale));
    this._H = Math.max(180, Math.round(srcH * scale));

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
        if (obj.data?.kind === 'arrow') this._attachArrowControls(obj);
        this._fc.add(obj);
      } else {
        EngineLogger.error(ENGINE_NAME, `Skipped invalid overlay entry (${o?.kind ?? '?'})`);
      }
    }

    this._fc.on('mouse:down', (opt: any) => this._onMouseDown(opt));
    this._fc.on('mouse:move', (opt: any) => this._onMouseMove(opt));
    this._fc.on('mouse:up', (opt: any) => this._onMouseUp(opt));
    this._fc.on('path:created', (e: any) => this._onPathCreated(e));
    this._fc.on('selection:created', () => this._syncControlsFromSelection());
    this._fc.on('selection:updated', () => this._syncControlsFromSelection());
    this._fc.on('selection:cleared', () => this._syncPanelContext());
    this._fc.on('object:modified', () => {
      if (this._bendDrag) {
        this._finalizeArrowBend();
        return;
      }
      this._commit();
    });
    this._fc.on('text:editing:exited', (e: any) => {
      const t = e?.target;
      if (t && !String(t.text ?? '').trim()) this._fc.remove(t);
      this._commit();
    });
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

  // ── Tools ──────────────────────────────────────────────────────────────────

  private _setTool(t: Tool): void {
    if (!this._fc) return;
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
      this._setTool('select');
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
    } else {
      obj.set({ selectable: true, evented: true });
      obj.setCoords();
    }

    const wasCallout = t === 'callout';
    this._setTool('select');
    this._fc.setActiveObject(finalObj);
    this._fc.requestRenderAll();
    this._commit();
    if (wasCallout) this._addCalloutText(finalObj);
  }

  /**
   * A callout is bubble + a separate centered text object (fabric 4.5 can't
   * edit text inside a group) — spawn the text already in edit mode.
   */
  private _addCalloutText(bubble: any): void {
    const fabric = (window as any).fabric;
    const d = this._defaults;
    const bw = bubble.getScaledWidth();
    const bh = bubble.getScaledHeight() * 0.78; // body above the tail
    const fontSize = Math.max(10, Math.min(d.fontSizePx, Math.round(bh * 0.32)));
    const tb = new fabric.Textbox('Text', {
      left: (bubble.left ?? 0) + bw * 0.12,
      top: (bubble.top ?? 0) + bh / 2 - fontSize * 0.7,
      width: bw * 0.76,
      fontSize,
      fontFamily: d.fontFamily,
      fontWeight: d.bold ? 'bold' : 'normal',
      fontStyle: d.italic ? 'italic' : 'normal',
      underline: d.underline,
      textAlign: 'center',
      fill: d.textColor,
      data: { id: overlayUuid(), kind: 'text' },
    });
    this._fc.add(tb);
    this._fc.setActiveObject(tb);
    tb.enterEditing();
    tb.selectAll();
    this._fc.requestRenderAll();
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
    if (this._arrowPreview) {
      this._fc.remove(this._arrowPreview);
      this._arrowPreview = null;
    }
    this._arrowChain = null;
    if (pts.length >= 2) {
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 4) pts.pop();
    }
    if (pts.length < 2) {
      this._setTool('select');
      return;
    }
    const style = this._creationStyle();
    const finalObj = makeArrowGroup(
      pts,
      style.stroke,
      style.strokeWidth,
      { opacity: this._defaults.opacity },
      style.strokeDash,
      this._defaults.arrowType,
    );
    this._attachArrowControls(finalObj);
    this._fc.add(finalObj);
    this._setTool('select');
    this._fc.setActiveObject(finalObj);
    this._fc.requestRenderAll();
    this._commit();
  }

  /** Adds a small draggable "bow" control at each segment's midpoint so dragging one inserts a bend. */
  private _attachArrowControls(grp: any): void {
    const fabric = (window as any).fabric;
    const pts: Array<{ x: number; y: number }> = grp.data?.localPoints ?? [];
    const controls: Record<string, any> = { ...fabric.Object.prototype.controls };
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
          ctx.arc(left, top, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        },
      });
    }
    grp.controls = controls;
    grp.setCoords();
  }

  /**
   * Per-tick bow-handle drag callback. Never mutates/removes the pinned arrow
   * object itself (fabric keeps `transform.target` fixed to it for the whole
   * gesture) — only swaps a cheap, throwaway dashed preview path, mirroring
   * `_updateArrowPreview`'s already-proven pattern in this file. The real
   * geometry swap happens once, at drag end, via `_finalizeArrowBend`.
   */
  private _dragArrowBend(obj: any, segmentIndex: number, canvasX: number, canvasY: number): void {
    if (!obj || obj.data?.kind !== 'arrow') return;
    const fabric = (window as any).fabric;
    const lp: Array<{ x: number; y: number }> = obj.data?.localPoints ?? [];
    if (segmentIndex < 0 || segmentIndex + 1 >= lp.length) return;
    this._bendDrag = { obj, segmentIndex, lastPoint: { x: canvasX, y: canvasY } };
    const m = obj.calcTransformMatrix();
    const absPoints = lp.map((p) => {
      const abs = fabric.util.transformPoint(new fabric.Point(p.x, p.y), m);
      return { x: abs.x, y: abs.y };
    });
    absPoints.splice(segmentIndex + 1, 0, { x: canvasX, y: canvasY });
    const pathChild = obj.getObjects()[0];
    const { d } = buildArrowPath(absPoints, obj.data?.arrowType ?? 'sharp');
    if (this._bendPreview) this._fc.remove(this._bendPreview);
    this._bendPreview = new fabric.Path(d, {
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

  /** Called once at bow-handle drag end (via the `object:modified` listener in `_initCanvas`). */
  private _finalizeArrowBend(): void {
    const drag = this._bendDrag;
    this._bendDrag = null;
    if (this._bendPreview) {
      this._fc.remove(this._bendPreview);
      this._bendPreview = null;
    }
    if (!drag) return;
    this._insertArrowBend(drag.obj, drag.segmentIndex, drag.lastPoint.x, drag.lastPoint.y);
  }

  /** Splices a new point into an arrow's geometry at the drag location and rebuilds it in place. */
  private _insertArrowBend(obj: any, segmentIndex: number, canvasX: number, canvasY: number): void {
    if (!obj || obj.data?.kind !== 'arrow') return;
    const fabric = (window as any).fabric;
    const lp: Array<{ x: number; y: number }> = obj.data?.localPoints ?? [];
    if (segmentIndex < 0 || segmentIndex + 1 >= lp.length) return;
    const m = obj.calcTransformMatrix();
    const absPoints = lp.map((p) => {
      const abs = fabric.util.transformPoint(new fabric.Point(p.x, p.y), m);
      return { x: abs.x, y: abs.y };
    });
    absPoints.splice(segmentIndex + 1, 0, { x: canvasX, y: canvasY });
    const rebuilt = this._rebuildArrow(obj, absPoints);
    this._fc.setActiveObject(rebuilt);
    this._fc.requestRenderAll();
  }

  /** Replaces an arrow group with a freshly-built one from an absolute-coordinate point list, preserving style/id. Reused by Task 6. */
  private _rebuildArrow(obj: any, absPoints: Array<{ x: number; y: number }>): any {
    const arrowType: ArrowType = obj.data?.arrowType ?? 'sharp';
    const pathChild = obj.getObjects()[0];
    this._fc.remove(obj);
    const rebuilt = makeArrowGroup(
      absPoints,
      pathChild.stroke,
      pathChild.strokeWidth,
      { opacity: obj.opacity, data: { id: obj.data.id } },
      obj.data.strokeDash,
      arrowType,
    );
    this._attachArrowControls(rebuilt);
    this._fc.add(rebuilt);
    this._commit();
    return rebuilt;
  }

  private _clearArrowChain(): void {
    if (this._arrowPreview) {
      this._fc?.remove(this._arrowPreview);
      this._arrowPreview = null;
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
    if (target?.data?.kind) {
      this._fc.remove(target);
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
    ctx.strokeStyle = 'rgba(90, 155, 255, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
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
    return this._withFlatSelection(() => {
      const objs: any[] = this._fc?.getActiveObjects?.() ?? [];
      return objs
        .map((o) => fabricToOverlay(o, this._W, this._H))
        .filter(Boolean) as SlideOverlay[];
    });
  }

  /** Run `fn` with any ActiveSelection temporarily dissolved (absolute coords), then re-select. */
  private _withFlatSelection<T>(fn: () => T): T {
    const fc = this._fc;
    const sel: any = fc?.getActiveObject?.();
    if (!sel || sel.type !== 'activeSelection') return fn();
    const members: any[] = sel.getObjects().slice();
    fc.discardActiveObject();
    try {
      return fn();
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
    for (const o of overlays) {
      const obj = overlayToFabric({ ...o, id: overlayUuid() }, this._W, this._H);
      if (!obj) continue;
      obj.set({ left: (obj.left ?? 0) + offsetPx, top: (obj.top ?? 0) + offsetPx });
      obj.setCoords();
      if (obj.data?.kind === 'arrow') this._attachArrowControls(obj);
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
    if (this._bendDrag) {
      if (this._bendPreview) {
        this._fc.remove(this._bendPreview);
        this._bendPreview = null;
      }
      this._bendDrag = null;
    }
    this._fc.discardActiveObject();
    (this._fc.getObjects() as any[]).slice().forEach((o) => this._fc.remove(o));
    for (const o of overlays) {
      const obj = overlayToFabric(o, this._W, this._H);
      if (obj) {
        if (obj.data?.kind === 'arrow') this._attachArrowControls(obj);
        this._fc.add(obj);
      }
    }
    this._fc.requestRenderAll();
    this._syncPanelContext();
  }

  // ── Style controls ↔ selection ─────────────────────────────────────────────

  private _onStyleChanged(prop: StyleProp): void {
    const objs: any[] = this._fc?.getActiveObjects?.() ?? [];
    for (const obj of objs) this._applyStyleTo(obj, prop);
    if (objs.length) {
      this._fc.requestRenderAll();
      this._commitDebounced();
    }
    if (this._fc?.isDrawingMode) this._configureBrush();
  }

  private _applyStyleTo(obj: any, prop: StyleProp): void {
    const d = this._defaults;
    const kind = obj?.data?.kind;
    if (!kind) return;
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
      case 'fillOpacity':
        if (isBoxKind(kind)) {
          obj.set('fill', d.fill ? withAlpha(d.fill, d.fillOpacity) : '');
        }
        break;
      case 'stroke':
        if (kind === 'arrow') {
          obj.getObjects?.()?.forEach((ch: any) => {
            if (ch.type === 'path') ch.set({ stroke: d.stroke });
            else ch.set({ fill: d.stroke });
          });
          obj.dirty = true;
        } else if (kind !== 'text') {
          obj.set('stroke', d.stroke);
        }
        break;
      case 'strokeWidthPx':
        if (kind === 'arrow') {
          const line = obj.getObjects?.()?.find((ch: any) => ch.type === 'path');
          line?.set({
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
        const width =
          kind === 'arrow'
            ? obj.getObjects?.()?.find((ch: any) => ch.type === 'path')?.strokeWidth ?? 3
            : obj.strokeWidth ?? 3;
        if (kind === 'arrow') {
          const line = obj.getObjects?.()?.find((ch: any) => ch.type === 'path');
          line?.set(dashProps(dashVal, width));
          obj.dirty = true;
        } else {
          obj.set(dashProps(dashVal, width));
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
    const objs: any[] = this._fc?.getActiveObjects?.() ?? [];
    if (objs.length) {
      const kinds = new Set(objs.map((o) => o?.data?.kind).filter(Boolean));
      let kind: PanelContext['kind'] = 'mixed';
      if (kinds.size === 1) {
        const k = [...kinds][0] as string;
        kind =
          k === 'text' ? 'text' : isBoxKind(k) ? 'box' : k === 'highlight' ? 'highlight' : 'linework';
      }
      return { kind, hasSelection: true };
    }
    if (BOX_TOOLS.has(this._tool)) return { kind: 'box', hasSelection: false };
    switch (this._tool) {
      case 'text':
        return { kind: 'text', hasSelection: false };
      case 'line':
      case 'arrow':
      case 'freehand':
        return { kind: 'linework', hasSelection: false };
      case 'highlighter':
        return { kind: 'highlight', hasSelection: false };
      default:
        return { kind: 'none', hasSelection: false };
    }
  }

  private _syncPanelContext(): void {
    this._ui?.showPanel(this._panelContextFor());
  }

  /** Populate the properties island from the newly-selected object. */
  private _syncControlsFromSelection(): void {
    const obj: any = this._fc?.getActiveObject?.();
    const kind = obj?.data?.kind;
    const d = this._defaults;
    if (!kind) {
      // Multi-select (ActiveSelection carries no kind) or nothing — just
      // re-contextualize the panel around current defaults.
      this._syncPanelContext();
      return;
    }

    if (kind === 'text') {
      d.fontFamily = obj.fontFamily || 'Arial';
      d.fontSizePx = Math.round(obj.fontSize ?? 28);
      d.bold = obj.fontWeight === 'bold';
      d.italic = obj.fontStyle === 'italic';
      d.underline = !!obj.underline;
      d.align = obj.textAlign === 'center' || obj.textAlign === 'right' ? obj.textAlign : 'left';
      d.textColor = parseColor(obj.fill)?.hex ?? d.textColor;
    } else {
      if (isBoxKind(kind)) {
        const fill = parseColor(obj.fill);
        if (fill) {
          d.fill = fill.hex;
          d.fillOpacity = fill.alpha;
        } else {
          d.fill = null;
        }
      }
      const strokeSrc =
        kind === 'arrow' ? obj.getObjects?.()?.find((ch: any) => ch.type === 'path') : obj;
      const stroke = parseColor(strokeSrc?.stroke);
      if (stroke) d.stroke = stroke.hex;
      if (strokeSrc?.strokeWidth) {
        if (kind === 'highlight') d.highlightWidthPx = Math.round(strokeSrc.strokeWidth);
        else d.strokeWidthPx = Math.round(strokeSrc.strokeWidth);
      }
      d.strokeDash = obj.data.strokeDash ?? 'solid';
    }
    d.opacity = obj.opacity ?? 1;
    this._syncPanelContext();
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
      if (mod && !e.altKey) {
        const k = e.key.toLowerCase();
        let handled = true;
        switch (k) {
          case 'c':
            this._copySelection();
            break;
          case 'x':
            this._cutSelection();
            break;
          case 'v':
            this._paste();
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
        // Single-key tool shortcuts (Excalidraw layout).
        const def = TOOL_DEFS.find((t) => t.letter === e.key.toLowerCase() || t.num === e.key);
        if (def) {
          e.preventDefault();
          e.stopPropagation();
          this._setTool(def.tool);
          return;
        }
        if (NUDGE_KEYS[e.key] && active) {
          e.preventDefault();
          e.stopPropagation();
          const [dx, dy] = NUDGE_KEYS[e.key];
          const step = e.shiftKey ? 10 : 1;
          active.set({ left: (active.left ?? 0) + dx * step, top: (active.top ?? 0) + dy * step });
          active.setCoords();
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
  }
}
