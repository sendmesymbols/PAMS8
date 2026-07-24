/**
 * SlideEditor.ts
 *
 * Full-screen PowerPoint-like editor for one Briefing slide. The slide's map
 * state is applied headlessly and shot once at full resolution; the editor
 * then works on a frozen fabric.js canvas (screenshot background + annotation
 * objects). Annotations persist as SlideOverlay[] on the slide (normalized
 * coords — see OverlayFabric.ts) and are re-emitted natively by PptxExporter.
 *
 * fabric.js 4.5 is a CDN global (`window.fabric`) — never import it.
 * Dynamically imported by BriefingEngine so none of this loads until the
 * first edit.
 */

import EngineLogger from '../../Support/EngineLogger';
import type { Slide, SlideOverlay } from './BriefingTypes';
import {
  fabricToOverlay,
  makeArrowGroup,
  overlayToFabric,
  overlayUuid,
  parseColor,
  withAlpha,
} from './OverlayFabric';

const ENGINE_NAME = 'SlideEditor';
const THUMB_WIDTH = 240;

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

type Tool = 'select' | 'text' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'freehand';

interface StyleDefaults {
  fontFamily: string;
  fontSizePx: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: 'left' | 'center' | 'right';
  textColor: string;
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeWidthPx: number;
}

export default class SlideEditor {
  private static _instance: SlideEditor | null = null;

  private _stage: HTMLElement | null = null;
  private _bar: HTMLElement | null = null;
  private _stageWrap: HTMLElement | null = null;
  private _fc: any = null; // fabric.Canvas
  private _host: SlideEditorHost | null = null;
  private _index = -1;
  private _W = 0;
  private _H = 0;
  private _tool: Tool = 'select';
  private _opening = false;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _drawing: { obj: any; startX: number; startY: number } | null = null;

  private _titleInput: HTMLInputElement | null = null;
  private _notesArea: HTMLTextAreaElement | null = null;

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
    this._injectStyles();
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
        title: (this._titleInput?.value ?? '').trim() || slide?.title || `Slide ${index + 1}`,
        notes: (this._notesArea?.value ?? '').trim() || undefined,
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
    if (!host || !fabric || !this._stage) return;
    const slide = host.getSlide(index);
    if (!slide) return;

    this._opening = true;
    try {
      this._index = index;
      if (this._titleInput) this._titleInput.value = slide.title ?? '';
      if (this._notesArea) {
        this._notesArea.value = slide.notes ?? '';
        if (slide.notes) this._notesArea.style.display = '';
      }
      this._updateNavState();

      try {
        this._fc?.dispose?.();
      } catch {}
      this._fc = null;
      this._drawing = null;
      if (this._stageWrap) {
        this._stageWrap.innerHTML = '<span class="ms-sledit-loading">Preparing slide…</span>';
      }

      const bg = await host.prepareBackground(index);
      if (!this._stage) return; // closed while preparing
      const size = await this._loadImage(bg.dataUrl);
      // Only warn persistently when we truly have nothing to show — a
      // successful fallback gets a toast instead (see below), not a banner.
      this._initCanvas(fabric, slide, size, bg.missingSymbols && !bg.usedFallback);
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

  private _updateNavState(): void {
    if (!this._bar || !this._host) return;
    const count = this._host.getSlideCount();
    const counter = this._bar.querySelector('.ms-sledit-navcount');
    if (counter) counter.textContent = `${this._index + 1} / ${count}`;
    const prev = this._bar.querySelector('[data-act="prevSlide"]') as HTMLButtonElement | null;
    const next = this._bar.querySelector('[data-act="nextSlide"]') as HTMLButtonElement | null;
    if (prev) prev.disabled = this._index <= 0;
    if (next) next.disabled = this._index >= count - 1;
  }

  public close(save: boolean): void {
    if (!this._stage) return;

    if (save) this._saveCurrent();

    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler, true);
      this._keyHandler = null;
    }
    try {
      this._fc?.dispose?.();
    } catch {}
    this._fc = null;
    this._stage?.remove();
    this._stage = null;
    this._bar = null;
    this._stageWrap = null;
    this._titleInput = null;
    this._notesArea = null;
    this._host = null;
    this._index = -1;
    this._drawing = null;
    this._tool = 'select';
  }

  // ── Stage / toolbar DOM ────────────────────────────────────────────────────

  private _buildStage(slide: Slide): void {
    const stage = document.createElement('div');
    stage.id = 'msSlideEditor';
    stage.innerHTML = `
      <div class="ms-sledit-bar">
        <span class="ms-sledit-tools">
          <button data-tool="select" class="active" title="Select / move / resize / rotate">⬚</button>
          <button data-tool="text" title="Add text box (click on slide)">T</button>
          <button data-tool="rect" title="Draw rectangle (drag)">▭</button>
          <button data-tool="ellipse" title="Draw ellipse (drag)">◯</button>
          <button data-tool="line" title="Draw line (drag)">╱</button>
          <button data-tool="arrow" title="Draw arrow (drag)">➔</button>
          <button data-tool="freehand" title="Freehand ink">✎</button>
        </span>
        <span class="ms-sledit-sep"></span>
        <select class="ms-sledit-font" title="Font family">
          <option>Arial</option><option>Calibri</option><option>Courier New</option>
          <option>Georgia</option><option>Impact</option><option>Tahoma</option>
          <option>Times New Roman</option><option>Verdana</option>
        </select>
        <input type="number" class="ms-sledit-fontsize" min="8" max="120" step="1" value="28" title="Font size (px)">
        <button data-style="bold" title="Bold"><b>B</b></button>
        <button data-style="italic" title="Italic"><i>I</i></button>
        <button data-style="underline" title="Underline"><u>U</u></button>
        <select class="ms-sledit-align" title="Text alignment">
          <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
        </select>
        <label title="Text color">Text <input type="color" class="ms-sledit-textcolor" value="#ffffff"></label>
        <span class="ms-sledit-sep"></span>
        <label title="Fill color (rect / ellipse)">Fill <input type="color" class="ms-sledit-fill" value="#ffd166"></label>
        <input type="range" class="ms-sledit-fillop" min="0" max="100" value="35" title="Fill opacity %">
        <label title="Line / outline color">Line <input type="color" class="ms-sledit-stroke" value="#ff3b30"></label>
        <input type="number" class="ms-sledit-strokew" min="1" max="24" value="3" title="Line width (px)">
        <span class="ms-sledit-sep"></span>
        <button data-act="front" title="Bring forward">⬆</button>
        <button data-act="back" title="Send backward">⬇</button>
        <button data-act="dup" title="Duplicate selection">⧉</button>
        <button data-act="del" title="Delete selection">🗑</button>
        <span class="ms-sledit-sep"></span>
        <input type="text" class="ms-sledit-title" placeholder="Slide title" title="Slide title (saved with the slide)">
        <button data-act="notes" title="Toggle speaker notes">📝</button>
        <span class="ms-sledit-sep"></span>
        <button data-act="prevSlide" title="Save this slide and edit the previous one">◀</button>
        <span class="ms-sledit-navcount">– / –</span>
        <button data-act="nextSlide" title="Save this slide and edit the next one">▶</button>
        <button data-act="present" title="Save this slide and start the slide show from here (Esc exits)">⛶ Slideshow</button>
        <span class="ms-sledit-spring"></span>
        <button data-act="save" class="primary" title="Save annotations, title and notes to the slide">Save &amp; Close</button>
        <button data-act="cancel" title="Discard changes (Esc)">Cancel</button>
      </div>
      <textarea class="ms-sledit-notes" placeholder="Speaker notes…" style="display:none"></textarea>
      <div class="ms-sledit-stagewrap"><span class="ms-sledit-loading">Preparing slide…</span></div>`;
    document.body.appendChild(stage);
    this._stage = stage;
    this._bar = stage.querySelector('.ms-sledit-bar') as HTMLElement;
    this._stageWrap = stage.querySelector('.ms-sledit-stagewrap') as HTMLElement;
    this._titleInput = stage.querySelector('.ms-sledit-title') as HTMLInputElement;
    this._notesArea = stage.querySelector('.ms-sledit-notes') as HTMLTextAreaElement;
    this._titleInput.value = slide.title ?? '';
    this._notesArea.value = slide.notes ?? '';
    if (slide.notes) this._notesArea.style.display = '';

    this._bar.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-tool],[data-style],[data-act]') as
        | HTMLElement
        | null;
      if (!el) return;
      if (el.dataset.tool) {
        this._setTool(el.dataset.tool as Tool);
      } else if (el.dataset.style) {
        const key = el.dataset.style as 'bold' | 'italic' | 'underline';
        this._defaults[key] = !this._defaults[key];
        el.classList.toggle('active', this._defaults[key]);
        this._applyToSelection(key);
      } else {
        this._onAction(el.dataset.act!);
      }
    });

    const bind = (sel: string, ev: string, fn: (el: any) => void) => {
      const el = this._bar!.querySelector(sel) as any;
      el?.addEventListener(ev, () => fn(el));
    };
    bind('.ms-sledit-font', 'change', (el) => {
      this._defaults.fontFamily = el.value;
      this._applyToSelection('fontFamily');
    });
    bind('.ms-sledit-fontsize', 'change', (el) => {
      this._defaults.fontSizePx = Math.max(6, Number(el.value) || 28);
      this._applyToSelection('fontSizePx');
    });
    bind('.ms-sledit-align', 'change', (el) => {
      this._defaults.align = el.value;
      this._applyToSelection('align');
    });
    bind('.ms-sledit-textcolor', 'input', (el) => {
      this._defaults.textColor = el.value;
      this._applyToSelection('textColor');
    });
    bind('.ms-sledit-fill', 'input', (el) => {
      this._defaults.fill = el.value;
      this._applyToSelection('fill');
    });
    bind('.ms-sledit-fillop', 'input', (el) => {
      this._defaults.fillOpacity = Math.max(0, Math.min(1, Number(el.value) / 100));
      this._applyToSelection('fill');
    });
    bind('.ms-sledit-stroke', 'input', (el) => {
      this._defaults.stroke = el.value;
      this._applyToSelection('stroke');
    });
    bind('.ms-sledit-strokew', 'change', (el) => {
      this._defaults.strokeWidthPx = Math.max(1, Number(el.value) || 3);
      this._applyToSelection('stroke');
    });
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
        if (this._notesArea) {
          this._notesArea.style.display = this._notesArea.style.display === 'none' ? '' : 'none';
        }
        break;
      case 'del': {
        const objs = this._fc?.getActiveObjects?.() ?? [];
        objs.forEach((o: any) => this._fc.remove(o));
        this._fc?.discardActiveObject();
        this._fc?.requestRenderAll();
        break;
      }
      case 'front': {
        const obj = this._fc?.getActiveObject?.();
        if (obj) {
          this._fc.bringForward(obj);
          this._fc.requestRenderAll();
        }
        break;
      }
      case 'back': {
        const obj = this._fc?.getActiveObject?.();
        if (obj) {
          this._fc.sendBackwards(obj);
          this._fc.requestRenderAll();
        }
        break;
      }
      case 'dup': {
        const obj: any = this._fc?.getActiveObject?.();
        if (!obj?.data?.kind) break;
        obj.clone((c: any) => {
          c.set({ left: (obj.left ?? 0) + 16, top: (obj.top ?? 0) + 16 });
          c.data = {
            id: overlayUuid(),
            kind: obj.data.kind,
            localPoints: obj.data.localPoints?.map((p: any) => ({ ...p })),
          };
          this._fc.add(c);
          this._fc.setActiveObject(c);
          this._fc.requestRenderAll();
        }, ['data']);
        break;
      }
    }
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
    if (!this._stageWrap) return;
    this._stageWrap.innerHTML = '';
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

    const barH = this._bar?.offsetHeight ?? 56;
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
    this._stageWrap.appendChild(canvasEl);

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
      if (obj) this._fc.add(obj);
      else EngineLogger.error(ENGINE_NAME, `Skipped invalid overlay entry (${o?.kind ?? '?'})`);
    }

    this._fc.on('mouse:down', (opt: any) => this._onMouseDown(opt));
    this._fc.on('mouse:move', (opt: any) => this._onMouseMove(opt));
    this._fc.on('mouse:up', () => this._onMouseUp());
    this._fc.on('path:created', (e: any) => this._onPathCreated(e));
    this._fc.on('selection:created', () => this._syncControlsFromSelection());
    this._fc.on('selection:updated', () => this._syncControlsFromSelection());
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
    this._tool = t;
    this._fc.isDrawingMode = t === 'freehand';
    if (t === 'freehand') {
      const fabric = (window as any).fabric;
      if (!this._fc.freeDrawingBrush) {
        this._fc.freeDrawingBrush = new fabric.PencilBrush(this._fc);
      }
      this._fc.freeDrawingBrush.color = this._defaults.stroke;
      this._fc.freeDrawingBrush.width = this._defaults.strokeWidthPx;
    }
    this._fc.selection = t === 'select';
    // With a draw tool active, clicks must start a shape — never pick objects.
    this._fc.skipTargetFind = t !== 'select' && t !== 'freehand';
    this._fc.defaultCursor = t === 'select' ? 'default' : 'crosshair';
    this._bar?.querySelectorAll('[data-tool]').forEach((b: any) => {
      b.classList.toggle('active', b.dataset.tool === t);
    });
  }

  private _onMouseDown(opt: any): void {
    if (!this._fc || this._tool === 'select' || this._tool === 'freehand') return;
    const fabric = (window as any).fabric;
    const p = this._fc.getPointer(opt.e);
    const d = this._defaults;

    if (this._tool === 'text') {
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

    let obj: any = null;
    if (this._tool === 'rect') {
      obj = new fabric.Rect({
        left: p.x,
        top: p.y,
        width: 1,
        height: 1,
        fill: withAlpha(d.fill, d.fillOpacity),
        stroke: d.stroke,
        strokeWidth: d.strokeWidthPx,
        data: { id: overlayUuid(), kind: 'rect' },
      });
    } else if (this._tool === 'ellipse') {
      obj = new fabric.Ellipse({
        left: p.x,
        top: p.y,
        rx: 1,
        ry: 1,
        fill: withAlpha(d.fill, d.fillOpacity),
        stroke: d.stroke,
        strokeWidth: d.strokeWidthPx,
        data: { id: overlayUuid(), kind: 'ellipse' },
      });
    } else if (this._tool === 'line' || this._tool === 'arrow') {
      obj = new fabric.Line([p.x, p.y, p.x, p.y], {
        stroke: d.stroke,
        strokeWidth: d.strokeWidthPx,
        data: { id: overlayUuid(), kind: 'line' },
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
    if (!this._drawing || !this._fc) return;
    const p = this._fc.getPointer(opt.e);
    const { obj, startX, startY } = this._drawing;
    if (this._tool === 'rect') {
      obj.set({
        left: Math.min(startX, p.x),
        top: Math.min(startY, p.y),
        width: Math.abs(p.x - startX),
        height: Math.abs(p.y - startY),
      });
    } else if (this._tool === 'ellipse') {
      obj.set({
        left: Math.min(startX, p.x),
        top: Math.min(startY, p.y),
        rx: Math.abs(p.x - startX) / 2,
        ry: Math.abs(p.y - startY) / 2,
      });
    } else {
      obj.set({ x2: p.x, y2: p.y });
    }
    this._fc.requestRenderAll();
  }

  private _onMouseUp(): void {
    if (!this._drawing || !this._fc) return;
    const { obj } = this._drawing;
    this._drawing = null;

    const isLineKind = this._tool === 'line' || this._tool === 'arrow';
    const degenerate = isLineKind
      ? Math.hypot((obj.x2 ?? 0) - (obj.x1 ?? 0), (obj.y2 ?? 0) - (obj.y1 ?? 0)) < 4
      : obj.getScaledWidth() < 4 && obj.getScaledHeight() < 4;
    if (degenerate) {
      this._fc.remove(obj);
      this._setTool('select');
      return;
    }

    if (this._tool === 'arrow') {
      const p0 = { x: obj.x1, y: obj.y1 };
      const p1 = { x: obj.x2, y: obj.y2 };
      this._fc.remove(obj);
      const grp = makeArrowGroup(p0, p1, this._defaults.stroke, this._defaults.strokeWidthPx);
      this._setTool('select');
      this._fc.add(grp);
      this._fc.setActiveObject(grp);
    } else {
      obj.set({ selectable: true, evented: true });
      obj.setCoords();
      this._setTool('select');
      this._fc.setActiveObject(obj);
    }
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
    const poly = new fabric.Polyline(pts, {
      fill: '',
      stroke: this._defaults.stroke,
      strokeWidth: this._defaults.strokeWidthPx,
      data: { id: overlayUuid(), kind: 'freehand' },
    });
    this._fc.add(poly);
    this._fc.requestRenderAll();
  }

  // ── Style controls ↔ selection ─────────────────────────────────────────────

  private _applyToSelection(prop: string): void {
    const objs: any[] = this._fc?.getActiveObjects?.() ?? [];
    for (const obj of objs) this._applyStyleTo(obj, prop);
    if (objs.length) this._fc.requestRenderAll();
  }

  private _applyStyleTo(obj: any, prop: string): void {
    const d = this._defaults;
    const kind = obj?.data?.kind;
    if (!kind) return;
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
        if (kind === 'rect' || kind === 'ellipse') {
          obj.set('fill', withAlpha(d.fill, d.fillOpacity));
        }
        break;
      case 'stroke':
        if (kind === 'arrow') {
          obj.getObjects?.()?.forEach((ch: any) => {
            if (ch.type === 'line') ch.set({ stroke: d.stroke, strokeWidth: d.strokeWidthPx });
            else ch.set({ fill: d.stroke });
          });
          obj.dirty = true;
        } else if (kind === 'rect' || kind === 'ellipse' || kind === 'line' || kind === 'freehand') {
          obj.set({ stroke: d.stroke, strokeWidth: d.strokeWidthPx });
        }
        break;
    }
  }

  /** Populate toolbar controls from the newly-selected object. */
  private _syncControlsFromSelection(): void {
    const obj: any = this._fc?.getActiveObject?.();
    const kind = obj?.data?.kind;
    if (!kind || !this._bar) return;
    const q = (sel: string) => this._bar!.querySelector(sel) as any;
    const setColor = (sel: string, c: any) => {
      const hex = parseColor(c)?.hex;
      if (hex) q(sel).value = hex.toLowerCase();
    };

    if (kind === 'text') {
      this._defaults.fontFamily = obj.fontFamily || 'Arial';
      this._defaults.fontSizePx = Math.round(obj.fontSize ?? 28);
      this._defaults.bold = obj.fontWeight === 'bold';
      this._defaults.italic = obj.fontStyle === 'italic';
      this._defaults.underline = !!obj.underline;
      this._defaults.align = obj.textAlign === 'center' || obj.textAlign === 'right' ? obj.textAlign : 'left';
      this._defaults.textColor = parseColor(obj.fill)?.hex ?? this._defaults.textColor;
      q('.ms-sledit-font').value = this._defaults.fontFamily;
      q('.ms-sledit-fontsize').value = String(this._defaults.fontSizePx);
      q('.ms-sledit-align').value = this._defaults.align;
      setColor('.ms-sledit-textcolor', obj.fill);
      q('[data-style="bold"]').classList.toggle('active', this._defaults.bold);
      q('[data-style="italic"]').classList.toggle('active', this._defaults.italic);
      q('[data-style="underline"]').classList.toggle('active', this._defaults.underline);
      return;
    }
    if (kind === 'rect' || kind === 'ellipse') {
      const fill = parseColor(obj.fill);
      if (fill) {
        this._defaults.fill = fill.hex;
        this._defaults.fillOpacity = fill.alpha;
        setColor('.ms-sledit-fill', fill.hex);
        q('.ms-sledit-fillop').value = String(Math.round(fill.alpha * 100));
      }
    }
    const strokeSrc = kind === 'arrow' ? obj.getObjects?.()?.[0] : obj;
    const stroke = parseColor(strokeSrc?.stroke);
    if (stroke) {
      this._defaults.stroke = stroke.hex;
      setColor('.ms-sledit-stroke', stroke.hex);
    }
    if (strokeSrc?.strokeWidth) {
      this._defaults.strokeWidthPx = Math.round(strokeSrc.strokeWidth);
      q('.ms-sledit-strokew').value = String(this._defaults.strokeWidthPx);
    }
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

      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        const active: any = this._fc?.getActiveObject?.();
        if (active?.isEditing) {
          active.exitEditing();
          return;
        }
        this.close(false);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !inInput) {
        const active: any = this._fc?.getActiveObject?.();
        if (active?.isEditing) return;
        const objs: any[] = this._fc?.getActiveObjects?.() ?? [];
        if (objs.length) {
          e.stopPropagation();
          e.preventDefault();
          objs.forEach((o) => this._fc.remove(o));
          this._fc.discardActiveObject();
          this._fc.requestRenderAll();
        }
      }
    };
    // Capture phase so Esc/Delete win over app-level shortcut managers.
    document.addEventListener('keydown', this._keyHandler, true);
  }

  // ── Styles ─────────────────────────────────────────────────────────────────

  private _injectStyles(): void {
    if (document.getElementById('ms-sledit-style')) return;
    const style = document.createElement('style');
    style.id = 'ms-sledit-style';
    style.textContent = `
      #msSlideEditor {
        position: fixed; inset: 0; z-index: 9700; background: #0d1117;
        display: flex; flex-direction: column;
        font: 12px/1.4 system-ui, sans-serif; color: #dde3e8;
      }
      .ms-sledit-bar {
        display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
        padding: 8px 10px; background: rgba(18,22,26,0.97);
        border-bottom: 1px solid rgba(255,255,255,0.12);
      }
      .ms-sledit-tools { display: inline-flex; gap: 4px; }
      .ms-sledit-bar button {
        background: rgba(255,255,255,0.08); color: #dde3e8;
        border: 1px solid rgba(255,255,255,0.16); border-radius: 5px;
        padding: 4px 8px; cursor: pointer; font: inherit; white-space: nowrap;
      }
      .ms-sledit-bar button:hover { background: rgba(255,255,255,0.16); }
      .ms-sledit-bar button:disabled { opacity: 0.35; cursor: default; }
      .ms-sledit-bar button:disabled:hover { background: rgba(255,255,255,0.08); }
      .ms-sledit-navcount {
        min-width: 46px; text-align: center; white-space: nowrap;
        color: #8a97a5; font-variant-numeric: tabular-nums;
      }
      .ms-sledit-bar button.active,
      .ms-sledit-bar button.primary { background: #2d6cdf; border-color: #2d6cdf; color: #fff; }
      .ms-sledit-bar button.primary:hover { background: #3f7ceb; }
      .ms-sledit-bar select, .ms-sledit-bar input[type="number"], .ms-sledit-bar input[type="text"] {
        background: rgba(255,255,255,0.06); color: #dde3e8;
        border: 1px solid rgba(255,255,255,0.16); border-radius: 5px;
        padding: 3px 6px; font: inherit;
      }
      .ms-sledit-bar input[type="color"] {
        width: 26px; height: 24px; padding: 0; border: 1px solid rgba(255,255,255,0.16);
        border-radius: 5px; background: none; cursor: pointer;
      }
      .ms-sledit-bar input[type="range"] { width: 70px; }
      .ms-sledit-bar label { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
      .ms-sledit-title { width: 150px; }
      .ms-sledit-fontsize, .ms-sledit-strokew { width: 52px; }
      .ms-sledit-sep { width: 1px; align-self: stretch; background: rgba(255,255,255,0.14); margin: 0 2px; }
      .ms-sledit-spring { flex: 1; }
      .ms-sledit-notes {
        margin: 6px 10px 0; height: 54px; resize: vertical;
        background: rgba(255,255,255,0.05); color: #dde3e8;
        border: 1px solid rgba(255,255,255,0.14); border-radius: 6px;
        padding: 6px 8px; font: inherit;
      }
      .ms-sledit-stagewrap {
        flex: 1; display: flex; align-items: center; justify-content: center;
        overflow: auto; padding: 12px; position: relative;
      }
      .ms-sledit-stagewrap canvas { border-radius: 4px; }
      .ms-sledit-loading { color: #8a97a5; font-size: 14px; }
      .ms-sledit-warn {
        position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
        background: rgba(180,120,20,0.92); color: #fff; padding: 4px 12px;
        border-radius: 6px; z-index: 2; pointer-events: none;
      }
      .ms-sledit-toast {
        position: absolute; left: 50%; bottom: 28px; transform: translateX(-50%);
        max-width: 80%; background: rgba(20,24,30,0.94); color: #dde3e8;
        border: 1px solid rgba(255,255,255,0.16); border-radius: 7px;
        padding: 9px 16px; font-size: 12.5px; text-align: center;
        box-shadow: 0 6px 20px rgba(0,0,0,0.4); z-index: 5; pointer-events: none;
        animation: msSlEditToast 3.5s ease forwards;
      }
      @keyframes msSlEditToast {
        0%   { opacity: 0; transform: translateX(-50%) translateY(8px); }
        8%   { opacity: 1; transform: translateX(-50%) translateY(0); }
        88%  { opacity: 1; }
        100% { opacity: 0; }
      }`;
    document.head.appendChild(style);
  }
}
