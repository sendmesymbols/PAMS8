/**
 * SlideEditorUI.ts
 *
 * Excalidraw-style chrome for the SlideEditor: a slim top tool strip (tools
 * with shortcut corner badges + slide navigation + save) and a floating
 * contextual properties island over the canvas (stroke/fill swatches, stroke
 * width & dash presets, text styling, opacity, layering, actions).
 *
 * Pure DOM/CSS — owns building, event wiring and value sync; all editing
 * semantics stay in SlideEditor (the `EditorUIHost`). The UI writes changed
 * values into `host.defaults` and then notifies `host.onStyleChanged(prop)`,
 * mirroring how the previous single-bar implementation worked.
 */

import type { Slide } from './BriefingTypes';
import type { ArrowType } from './OverlayFabric';

export type Tool =
  | 'select'
  | 'lasso'
  | 'rect'
  | 'diamond'
  | 'ellipse'
  | 'triangle'
  | 'star'
  | 'callout'
  | 'line'
  | 'arrow'
  | 'freehand'
  | 'highlighter'
  | 'text'
  | 'eraser'
  | 'laser';

export interface StyleDefaults {
  fontFamily: string;
  fontSizePx: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: 'left' | 'center' | 'right';
  textColor: string;
  /** null = no fill. */
  fill: string | null;
  fillOpacity: number;
  stroke: string;
  strokeWidthPx: number;
  strokeDash: 'solid' | 'dashed' | 'dotted';
  /** Whole-object opacity 0..1. */
  opacity: number;
  /** Highlighter keeps its own width slot — marker vs pen are different tools. */
  highlightWidthPx: number;
  /** Arrow tool only. */
  arrowType: ArrowType;
}

export type StyleProp =
  | 'fontFamily'
  | 'fontSizePx'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'align'
  | 'textColor'
  | 'fill'
  | 'fillOpacity'
  | 'stroke'
  | 'strokeWidthPx'
  | 'strokeDash'
  | 'opacity'
  | 'highlightWidthPx';

/** What the properties island is currently editing. */
export interface PanelContext {
  kind: 'none' | 'text' | 'box' | 'linework' | 'highlight' | 'mixed';
  /** Layers/actions rows only make sense on a live selection. */
  hasSelection: boolean;
}

export interface EditorUIHost {
  defaults: StyleDefaults;
  onToolSelected(t: Tool): void;
  /**
   * save | cancel | notes | prevSlide | nextSlide | present |
   * front | forward | backward | back | dup | del
   */
  onAction(act: string): void;
  /** host.defaults[prop] was already updated — apply to selection + commit. */
  onStyleChanged(prop: StyleProp): void;
}

export interface ToolDef {
  tool: Tool;
  /** Plain-key shortcut (lowercase). */
  letter: string;
  /** Excalidraw numeric alias, where one exists. */
  num?: string;
  title: string;
  /** True = a separator is rendered before this tool. */
  startsGroup?: boolean;
}

export const TOOL_DEFS: ToolDef[] = [
  { tool: 'select', letter: 'v', num: '1', title: 'Select — move / resize / rotate' },
  { tool: 'lasso', letter: 's', title: 'Lasso — draw around objects to select them' },
  { tool: 'rect', letter: 'r', num: '2', title: 'Rectangle (drag)', startsGroup: true },
  { tool: 'diamond', letter: 'd', num: '3', title: 'Diamond (drag)' },
  { tool: 'ellipse', letter: 'o', num: '4', title: 'Ellipse (drag)' },
  { tool: 'triangle', letter: 'y', title: 'Triangle (drag)' },
  { tool: 'star', letter: 'x', title: 'Star (drag)' },
  { tool: 'callout', letter: 'c', title: 'Callout — drag bubble, then type its text' },
  { tool: 'line', letter: 'l', num: '6', title: 'Line (drag)', startsGroup: true },
  { tool: 'arrow', letter: 'a', num: '5', title: 'Arrow (drag)' },
  { tool: 'freehand', letter: 'p', num: '7', title: 'Freehand ink' },
  { tool: 'highlighter', letter: 'h', title: 'Highlighter — wide translucent marker' },
  { tool: 'text', letter: 't', num: '8', title: 'Text (click on slide)' },
  { tool: 'eraser', letter: 'e', num: '0', title: 'Eraser — drag over objects to delete', startsGroup: true },
  { tool: 'laser', letter: 'k', title: 'Laser pointer — fading trail, never saved' },
];

const STROKE_SWATCHES = ['#ffffff', '#1e1e1e', '#ff3b30', '#ffd166', '#2f9e44', '#339af0', '#f08c00'];
const FILL_SWATCHES = ['#ffd166', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99', '#ff3b30', '#1e1e1e'];

// ── Inline SVG icons (no dependency) ─────────────────────────────────────────

const svg = (inner: string, filled = false): string =>
  `<svg viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="${
    filled ? 'none' : 'currentColor'
  }" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const ICONS: Record<string, string> = {
  select: svg('<path d="M6 3l12 11-6.2.6 3.2 5.8-2.6 1.3-3-6.1L6 19z"/>', true),
  lasso: svg('<ellipse cx="12" cy="10" rx="8" ry="5.6" stroke-dasharray="3 2.4"/><path d="M7.5 14.8c-1.6 1.8-1.2 3.6.8 4.8"/>'),
  rect: svg('<rect x="4" y="5.5" width="16" height="13" rx="1.6"/>'),
  diamond: svg('<path d="M12 3.2l8.8 8.8-8.8 8.8L3.2 12z"/>'),
  ellipse: svg('<ellipse cx="12" cy="12" rx="8.8" ry="6.8"/>'),
  triangle: svg('<path d="M12 4.4l8.8 15.2H3.2z"/>'),
  star: svg('<path d="M12 3.4l2.5 5.4 5.9.7-4.4 4 1.2 5.9L12 16.5l-5.2 2.9 1.2-5.9-4.4-4 5.9-.7z"/>'),
  callout: svg('<path d="M4 5h16v10h-9l-4 4v-4H4z"/>'),
  line: svg('<path d="M4.5 19.5L19.5 4.5"/>'),
  arrow: svg('<path d="M4.5 19.5L18.5 5.5M18.5 5.5h-6.2M18.5 5.5v6.2"/>'),
  freehand: svg('<path d="M4 17.5c2-6.5 4.8-8.4 6-6.4s-2.2 7.3.8 7.3 4-9.4 7.2-9.4"/>'),
  highlighter: svg('<path d="M13.6 4.4l6 6-7.6 7.6H8l-2-2z"/><path d="M4 20.5h8"/>'),
  text: svg('<path d="M5.5 5.5h13M12 5.5v13"/>'),
  eraser: svg('<path d="M8 19.5l-4.1-4.1a1.8 1.8 0 010-2.6l7.9-7.9a1.8 1.8 0 012.6 0l5.2 5.2a1.8 1.8 0 010 2.6l-6.8 6.8H8z"/><path d="M8.6 10.7l5.7 5.7"/>'),
  laser: svg(
    '<circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/>' +
      '<path d="M12 4v2.6M12 17.4V20M4 12h2.6M17.4 12H20M6.6 6.6l1.8 1.8M15.6 15.6l1.8 1.8M17.4 6.6l-1.8 1.8M8.4 15.6l-1.8 1.8"/>',
  ),
  notes: svg('<path d="M5 4h14v13l-4 3H5z"/><path d="M8.5 9h7M8.5 12.5h5"/>'),
  layerBack: svg('<path d="M12 3.5v11M12 14.5l-4-4M12 14.5l4-4"/><path d="M5 20.5h14"/>'),
  layerBackward: svg('<path d="M12 5v14M12 19l-4.5-4.5M12 19l4.5-4.5"/>'),
  layerForward: svg('<path d="M12 19V5M12 5l-4.5 4.5M12 5l4.5 4.5"/>'),
  layerFront: svg('<path d="M12 20.5v-11M12 9.5l-4 4M12 9.5l4 4"/><path d="M5 3.5h14"/>'),
  dup: svg('<rect x="8" y="8" width="12" height="12" rx="1.6"/><path d="M16 4H5.6A1.6 1.6 0 004 5.6V16"/>'),
  del: svg('<path d="M4.5 6.5h15M9.5 6.5v-2h5v2M6.5 6.5l1 13.5h9l1-13.5M10 10v6.5M14 10v6.5"/>'),
  dashSolid: svg('<path d="M3.5 12h17" stroke-width="2.2"/>'),
  dashDashed: svg('<path d="M3.5 12h17" stroke-width="2.2" stroke-dasharray="5 3.4"/>'),
  dashDotted: svg('<path d="M3.5 12h17" stroke-width="2.4" stroke-dasharray="0.5 4.4"/>'),
  wThin: svg('<path d="M4 12h16" stroke-width="1.2"/>'),
  wMed: svg('<path d="M4 12h16" stroke-width="2.6"/>'),
  wThick: svg('<path d="M4 12h16" stroke-width="4.4"/>'),
  alignLeft: svg('<path d="M4.5 6h15M4.5 10.5h9M4.5 15h13M4.5 19.5h7"/>'),
  alignCenter: svg('<path d="M4.5 6h15M7.5 10.5h9M5.5 15h13M8.5 19.5h7"/>'),
  alignRight: svg('<path d="M4.5 6h15M10.5 10.5h9M6.5 15h13M12.5 19.5h7"/>'),
  noFill: svg('<rect x="4.5" y="4.5" width="15" height="15" rx="2"/><path d="M6 18L18 6"/>'),
};

const SECTIONS_BY_CONTEXT: Record<PanelContext['kind'], string[]> = {
  none: [],
  text: ['text', 'opacity'],
  box: ['stroke', 'fill', 'fillop', 'width', 'dash', 'opacity'],
  linework: ['stroke', 'width', 'dash', 'opacity'],
  highlight: ['stroke', 'width', 'opacity'],
  mixed: ['stroke', 'width', 'dash', 'opacity'],
};

export default class SlideEditorUI {
  private _host: EditorUIHost;
  private _bar: HTMLElement | null = null;
  private _panel: HTMLElement | null = null;
  private _ctx: PanelContext = { kind: 'none', hasSelection: false };

  public titleInput: HTMLInputElement | null = null;
  public notesArea: HTMLTextAreaElement | null = null;
  public stageWrap: HTMLElement | null = null;

  constructor(host: EditorUIHost) {
    this._host = host;
  }

  public get bar(): HTMLElement | null {
    return this._bar;
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  public build(stage: HTMLElement, slide: Slide): void {
    this._injectStyles();

    const toolButtons = TOOL_DEFS.map((d) => {
      const sep = d.startsGroup ? '<span class="ms-sledit-sep"></span>' : '';
      const badge = (d.letter || d.num || '').toUpperCase();
      return `${sep}<button data-tool="${d.tool}" title="${d.title} — ${badge}${
        d.num ? ` or ${d.num}` : ''
      }">${ICONS[d.tool]}<kbd>${badge}</kbd></button>`;
    }).join('');

    const swatchRow = (slot: 'stroke' | 'fill', colors: string[]): string => {
      const none =
        slot === 'fill'
          ? `<button class="ms-sledit-sw none" data-slot="fill" data-color="" title="No fill">${ICONS.noFill}</button>`
          : '';
      const btns = colors
        .map(
          (c) =>
            `<button class="ms-sledit-sw" data-slot="${slot}" data-color="${c}" style="--sw:${c}" title="${c}"></button>`,
        )
        .join('');
      return `<div class="ms-sledit-swatches">${none}${btns}<input type="color" class="ms-sledit-custom" data-slot="${slot}" title="Custom color"></div>`;
    };

    stage.innerHTML = `
      <div class="ms-sledit-bar">
        <span class="ms-sledit-tools">${toolButtons}</span>
        <span class="ms-sledit-spring"></span>
        <input type="text" class="ms-sledit-title" placeholder="Slide title" title="Slide title (saved with the slide)">
        <button data-act="notes" class="ms-sledit-iconbtn" title="Toggle speaker notes">${ICONS.notes}</button>
        <span class="ms-sledit-sep"></span>
        <button data-act="prevSlide" title="Save this slide and edit the previous one">◀</button>
        <span class="ms-sledit-navcount">– / –</span>
        <button data-act="nextSlide" title="Save this slide and edit the next one">▶</button>
        <button data-act="present" title="Save this slide and start the slide show from here (Esc exits)">⛶ Slideshow</button>
        <button data-act="save" class="primary" title="Save annotations, title and notes to the slide">Save &amp; Close</button>
        <button data-act="cancel" title="Discard changes">Cancel</button>
      </div>
      <textarea class="ms-sledit-notes" placeholder="Speaker notes…" style="display:none"></textarea>
      <div class="ms-sledit-stagewrap">
        <span class="ms-sledit-loading">Preparing slide…</span>
        <div class="ms-sledit-panel" style="display:none">
          <div class="ms-sledit-sec" data-sec="stroke">
            <div class="ms-sledit-seclabel">Stroke</div>
            ${swatchRow('stroke', STROKE_SWATCHES)}
          </div>
          <div class="ms-sledit-sec" data-sec="fill">
            <div class="ms-sledit-seclabel">Fill</div>
            ${swatchRow('fill', FILL_SWATCHES)}
          </div>
          <div class="ms-sledit-sec" data-sec="fillop">
            <div class="ms-sledit-seclabel">Fill opacity</div>
            <input type="range" class="ms-sledit-fillop" min="0" max="100" step="5">
          </div>
          <div class="ms-sledit-sec" data-sec="width">
            <div class="ms-sledit-seclabel">Stroke width</div>
            <div class="ms-sledit-row">
              <button data-width="2" title="Thin">${ICONS.wThin}</button>
              <button data-width="4" title="Medium">${ICONS.wMed}</button>
              <button data-width="8" title="Thick">${ICONS.wThick}</button>
              <input type="number" class="ms-sledit-strokew" min="1" max="64" step="1" title="Width (px)">
            </div>
          </div>
          <div class="ms-sledit-sec" data-sec="dash">
            <div class="ms-sledit-seclabel">Stroke style</div>
            <div class="ms-sledit-row">
              <button data-dash="solid" title="Solid">${ICONS.dashSolid}</button>
              <button data-dash="dashed" title="Dashed">${ICONS.dashDashed}</button>
              <button data-dash="dotted" title="Dotted">${ICONS.dashDotted}</button>
            </div>
          </div>
          <div class="ms-sledit-sec" data-sec="text">
            <div class="ms-sledit-seclabel">Text</div>
            <div class="ms-sledit-row">
              <select class="ms-sledit-font" title="Font family">
                <option>Arial</option><option>Calibri</option><option>Courier New</option>
                <option>Georgia</option><option>Impact</option><option>Tahoma</option>
                <option>Times New Roman</option><option>Verdana</option>
              </select>
              <input type="number" class="ms-sledit-fontsize" min="8" max="120" step="1" title="Font size (px)">
            </div>
            <div class="ms-sledit-row">
              <button data-style="bold" title="Bold"><b>B</b></button>
              <button data-style="italic" title="Italic"><i>I</i></button>
              <button data-style="underline" title="Underline"><u>U</u></button>
              <span class="ms-sledit-minisep"></span>
              <button data-align="left" title="Align left">${ICONS.alignLeft}</button>
              <button data-align="center" title="Align center">${ICONS.alignCenter}</button>
              <button data-align="right" title="Align right">${ICONS.alignRight}</button>
            </div>
            <div class="ms-sledit-row">
              <span class="ms-sledit-mini">Color</span>
              <input type="color" class="ms-sledit-textcolor" title="Text color">
            </div>
          </div>
          <div class="ms-sledit-sec" data-sec="opacity">
            <div class="ms-sledit-seclabel">Opacity</div>
            <input type="range" class="ms-sledit-op" min="10" max="100" step="5">
          </div>
          <div class="ms-sledit-sec" data-sec="layers">
            <div class="ms-sledit-seclabel">Layers</div>
            <div class="ms-sledit-row">
              <button data-act="back" title="Send to back (Ctrl+Shift+[)">${ICONS.layerBack}</button>
              <button data-act="backward" title="Send backward (Ctrl+[)">${ICONS.layerBackward}</button>
              <button data-act="forward" title="Bring forward (Ctrl+])">${ICONS.layerForward}</button>
              <button data-act="front" title="Bring to front (Ctrl+Shift+])">${ICONS.layerFront}</button>
            </div>
          </div>
          <div class="ms-sledit-sec" data-sec="actions">
            <div class="ms-sledit-seclabel">Actions</div>
            <div class="ms-sledit-row">
              <button data-act="dup" title="Duplicate (Ctrl+D)">${ICONS.dup}</button>
              <button data-act="del" title="Delete (Del)">${ICONS.del}</button>
            </div>
          </div>
        </div>
      </div>`;

    this._bar = stage.querySelector('.ms-sledit-bar') as HTMLElement;
    this._panel = stage.querySelector('.ms-sledit-panel') as HTMLElement;
    this.stageWrap = stage.querySelector('.ms-sledit-stagewrap') as HTMLElement;
    this.titleInput = stage.querySelector('.ms-sledit-title') as HTMLInputElement;
    this.notesArea = stage.querySelector('.ms-sledit-notes') as HTMLTextAreaElement;
    this.titleInput.value = slide.title ?? '';
    this.notesArea.value = slide.notes ?? '';
    if (slide.notes) this.notesArea.style.display = '';

    this._wireBar();
    this._wirePanel();
    this.refreshPanelValues();
  }

  /**
   * The canvas replaces stageWrap's content on every slide load — the panel
   * lives inside stageWrap so it overlays the canvas, so re-attach it after.
   */
  public remountPanel(): void {
    if (this._panel && this.stageWrap && !this.stageWrap.contains(this._panel)) {
      this.stageWrap.appendChild(this._panel);
    }
  }

  // ── Event wiring ───────────────────────────────────────────────────────────

  private _wireBar(): void {
    this._bar?.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-tool],[data-act]') as HTMLElement | null;
      if (!el) return;
      if (el.dataset.tool) this._host.onToolSelected(el.dataset.tool as Tool);
      else this._host.onAction(el.dataset.act!);
    });
  }

  private _wirePanel(): void {
    const panel = this._panel;
    if (!panel) return;
    const d = () => this._host.defaults;

    panel.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest(
        '[data-color],[data-width],[data-dash],[data-style],[data-align],[data-act]',
      ) as HTMLElement | null;
      if (!el) return;
      if (el.dataset.act) {
        this._host.onAction(el.dataset.act);
        return;
      }
      if (el.dataset.color != null) {
        const slot = el.dataset.slot as 'stroke' | 'fill';
        if (slot === 'fill') {
          d().fill = el.dataset.color === '' ? null : el.dataset.color;
          this._host.onStyleChanged('fill');
        } else {
          d().stroke = el.dataset.color;
          this._host.onStyleChanged('stroke');
        }
      } else if (el.dataset.width) {
        const w = Number(el.dataset.width);
        if (this._ctx.kind === 'highlight') {
          d().highlightWidthPx = w * 5;
          this._host.onStyleChanged('highlightWidthPx');
        } else {
          d().strokeWidthPx = w;
          this._host.onStyleChanged('strokeWidthPx');
        }
      } else if (el.dataset.dash) {
        d().strokeDash = el.dataset.dash as StyleDefaults['strokeDash'];
        this._host.onStyleChanged('strokeDash');
      } else if (el.dataset.style) {
        const key = el.dataset.style as 'bold' | 'italic' | 'underline';
        d()[key] = !d()[key];
        this._host.onStyleChanged(key);
      } else if (el.dataset.align) {
        d().align = el.dataset.align as StyleDefaults['align'];
        this._host.onStyleChanged('align');
      }
      this.refreshPanelValues();
    });

    const bind = (sel: string, ev: string, fn: (el: any) => void) => {
      const el = panel.querySelector(sel) as any;
      el?.addEventListener(ev, () => fn(el));
    };
    bind('input.ms-sledit-custom[data-slot="stroke"]', 'input', (el) => {
      d().stroke = el.value;
      this._host.onStyleChanged('stroke');
      this.refreshPanelValues();
    });
    bind('input.ms-sledit-custom[data-slot="fill"]', 'input', (el) => {
      d().fill = el.value;
      this._host.onStyleChanged('fill');
      this.refreshPanelValues();
    });
    bind('.ms-sledit-fillop', 'input', (el) => {
      d().fillOpacity = Math.max(0, Math.min(1, Number(el.value) / 100));
      this._host.onStyleChanged('fillOpacity');
    });
    bind('.ms-sledit-strokew', 'change', (el) => {
      const w = Math.max(1, Math.min(64, Number(el.value) || 3));
      if (this._ctx.kind === 'highlight') {
        d().highlightWidthPx = w;
        this._host.onStyleChanged('highlightWidthPx');
      } else {
        d().strokeWidthPx = w;
        this._host.onStyleChanged('strokeWidthPx');
      }
      this.refreshPanelValues();
    });
    bind('.ms-sledit-op', 'input', (el) => {
      d().opacity = Math.max(0.1, Math.min(1, Number(el.value) / 100));
      this._host.onStyleChanged('opacity');
    });
    bind('.ms-sledit-font', 'change', (el) => {
      d().fontFamily = el.value;
      this._host.onStyleChanged('fontFamily');
    });
    bind('.ms-sledit-fontsize', 'change', (el) => {
      d().fontSizePx = Math.max(6, Number(el.value) || 28);
      this._host.onStyleChanged('fontSizePx');
    });
    bind('.ms-sledit-textcolor', 'input', (el) => {
      d().textColor = el.value;
      this._host.onStyleChanged('textColor');
    });
  }

  // ── State sync ─────────────────────────────────────────────────────────────

  public setActiveTool(t: Tool): void {
    this._bar?.querySelectorAll('[data-tool]').forEach((b: any) => {
      b.classList.toggle('active', b.dataset.tool === t);
    });
  }

  public updateNav(index: number, count: number): void {
    if (!this._bar) return;
    const counter = this._bar.querySelector('.ms-sledit-navcount');
    if (counter) counter.textContent = `${index + 1} / ${count}`;
    const prev = this._bar.querySelector('[data-act="prevSlide"]') as HTMLButtonElement | null;
    const next = this._bar.querySelector('[data-act="nextSlide"]') as HTMLButtonElement | null;
    if (prev) prev.disabled = index <= 0;
    if (next) next.disabled = index >= count - 1;
  }

  public toggleNotes(): void {
    if (!this.notesArea) return;
    this.notesArea.style.display = this.notesArea.style.display === 'none' ? '' : 'none';
  }

  /** Show/hide the island and its sections for the given context. */
  public showPanel(ctx: PanelContext): void {
    this._ctx = ctx;
    const panel = this._panel;
    if (!panel) return;
    const secs = SECTIONS_BY_CONTEXT[ctx.kind];
    if (!secs.length) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = '';
    panel.querySelectorAll('.ms-sledit-sec').forEach((el: any) => {
      const name = el.dataset.sec as string;
      const visible =
        secs.includes(name) || ((name === 'layers' || name === 'actions') && ctx.hasSelection);
      el.style.display = visible ? '' : 'none';
    });
    this.refreshPanelValues();
  }

  /** Pull current values out of host.defaults into every panel control. */
  public refreshPanelValues(): void {
    const panel = this._panel;
    if (!panel) return;
    const d = this._host.defaults;
    const q = (sel: string) => panel.querySelector(sel) as any;

    panel.querySelectorAll('.ms-sledit-sw').forEach((el: any) => {
      const slot = el.dataset.slot;
      const current = slot === 'fill' ? d.fill ?? '' : d.stroke;
      el.classList.toggle(
        'active',
        (el.dataset.color || '').toLowerCase() === (current || '').toLowerCase(),
      );
    });
    const strokeCustom = q('input.ms-sledit-custom[data-slot="stroke"]');
    if (strokeCustom) strokeCustom.value = d.stroke;
    const fillCustom = q('input.ms-sledit-custom[data-slot="fill"]');
    if (fillCustom && d.fill) fillCustom.value = d.fill;

    q('.ms-sledit-fillop').value = String(Math.round(d.fillOpacity * 100));
    const widthPx = this._ctx.kind === 'highlight' ? d.highlightWidthPx : d.strokeWidthPx;
    q('.ms-sledit-strokew').value = String(widthPx);
    panel.querySelectorAll('[data-width]').forEach((el: any) => {
      const preset = Number(el.dataset.width);
      el.classList.toggle(
        'active',
        this._ctx.kind === 'highlight' ? preset * 5 === widthPx : preset === widthPx,
      );
    });
    panel.querySelectorAll('[data-dash]').forEach((el: any) => {
      el.classList.toggle('active', el.dataset.dash === d.strokeDash);
    });
    q('.ms-sledit-op').value = String(Math.round(d.opacity * 100));

    q('.ms-sledit-font').value = d.fontFamily;
    q('.ms-sledit-fontsize').value = String(d.fontSizePx);
    q('.ms-sledit-textcolor').value = d.textColor;
    q('[data-style="bold"]').classList.toggle('active', d.bold);
    q('[data-style="italic"]').classList.toggle('active', d.italic);
    q('[data-style="underline"]').classList.toggle('active', d.underline);
    panel.querySelectorAll('[data-align]').forEach((el: any) => {
      el.classList.toggle('active', el.dataset.align === d.align);
    });
  }

  // ── Styles ─────────────────────────────────────────────────────────────────

  private _injectStyles(): void {
    const existing = document.getElementById('ms-sledit-style');
    if (existing) existing.remove(); // always inject the latest chrome styles
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
        padding: 6px 10px; background: rgba(18,22,26,0.97);
        border-bottom: 1px solid rgba(255,255,255,0.12);
      }
      .ms-sledit-tools { display: inline-flex; align-items: center; gap: 3px; }
      .ms-sledit-bar button {
        background: rgba(255,255,255,0.08); color: #dde3e8;
        border: 1px solid rgba(255,255,255,0.16); border-radius: 6px;
        padding: 4px 8px; cursor: pointer; font: inherit; white-space: nowrap;
      }
      .ms-sledit-bar button:hover { background: rgba(255,255,255,0.16); }
      .ms-sledit-bar button:disabled { opacity: 0.35; cursor: default; }
      .ms-sledit-bar button:disabled:hover { background: rgba(255,255,255,0.08); }
      .ms-sledit-tools button {
        position: relative; width: 36px; height: 34px; padding: 0;
        display: inline-flex; align-items: center; justify-content: center;
        border-color: transparent; background: transparent;
      }
      .ms-sledit-tools button:hover { background: rgba(255,255,255,0.10); }
      .ms-sledit-tools button svg { width: 19px; height: 19px; display: block; }
      .ms-sledit-tools button kbd {
        position: absolute; right: 3px; bottom: 1px;
        font-family: inherit; font-size: 8px; color: #7d8894; pointer-events: none;
      }
      .ms-sledit-bar button.active, .ms-sledit-bar button.primary {
        background: #2d6cdf; border-color: #2d6cdf; color: #fff;
      }
      .ms-sledit-tools button.active { background: rgba(45,108,223,0.85); }
      .ms-sledit-tools button.active kbd { color: rgba(255,255,255,0.8); }
      .ms-sledit-bar button.primary:hover { background: #3f7ceb; }
      .ms-sledit-iconbtn svg { width: 17px; height: 17px; display: block; }
      .ms-sledit-navcount {
        min-width: 46px; text-align: center; white-space: nowrap;
        color: #8a97a5; font-variant-numeric: tabular-nums;
      }
      .ms-sledit-bar select, .ms-sledit-bar input[type="number"], .ms-sledit-bar input[type="text"] {
        background: rgba(255,255,255,0.06); color: #dde3e8;
        border: 1px solid rgba(255,255,255,0.16); border-radius: 5px;
        padding: 3px 6px; font: inherit;
      }
      .ms-sledit-title { width: 170px; }
      .ms-sledit-sep { width: 1px; align-self: stretch; background: rgba(255,255,255,0.14); margin: 0 3px; }
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

      .ms-sledit-panel {
        position: absolute; left: 14px; top: 14px; z-index: 6; width: 204px;
        display: flex; flex-direction: column; gap: 10px;
        background: rgba(24,29,35,0.97); border: 1px solid rgba(255,255,255,0.14);
        border-radius: 10px; padding: 10px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.45);
        max-height: calc(100% - 28px); overflow-y: auto;
      }
      .ms-sledit-seclabel { font-size: 10.5px; color: #8a97a5; margin-bottom: 5px; }
      .ms-sledit-row { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
      .ms-sledit-mini { font-size: 11px; color: #aab4be; }
      .ms-sledit-minisep { width: 1px; height: 18px; background: rgba(255,255,255,0.14); margin: 0 2px; }
      .ms-sledit-panel button {
        background: rgba(255,255,255,0.07); color: #dde3e8;
        border: 1px solid rgba(255,255,255,0.14); border-radius: 6px;
        width: 30px; height: 28px; padding: 0; cursor: pointer; font: inherit;
        display: inline-flex; align-items: center; justify-content: center;
      }
      .ms-sledit-panel button:hover { background: rgba(255,255,255,0.15); }
      .ms-sledit-panel button.active { background: #2d6cdf; border-color: #2d6cdf; color: #fff; }
      .ms-sledit-panel button svg { width: 17px; height: 17px; display: block; }
      .ms-sledit-panel select, .ms-sledit-panel input[type="number"] {
        background: rgba(255,255,255,0.06); color: #dde3e8;
        border: 1px solid rgba(255,255,255,0.16); border-radius: 5px;
        padding: 3px 5px; font: inherit;
      }
      .ms-sledit-panel select { flex: 1; min-width: 0; }
      .ms-sledit-panel input[type="number"] { width: 52px; }
      .ms-sledit-panel input[type="range"] { width: 100%; }
      .ms-sledit-swatches { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
      .ms-sledit-sw {
        width: 22px !important; height: 22px !important; border-radius: 5px !important;
        background: var(--sw) !important; border: 1px solid rgba(255,255,255,0.25) !important;
      }
      .ms-sledit-sw.active { outline: 2px solid #2d6cdf; outline-offset: 1px; }
      .ms-sledit-sw.none { background: rgba(255,255,255,0.05) !important; color: #8a97a5; }
      .ms-sledit-sw.none svg { width: 15px; height: 15px; }
      .ms-sledit-panel input[type="color"], .ms-sledit-custom {
        width: 22px; height: 22px; padding: 0; border: 1px solid rgba(255,255,255,0.25);
        border-radius: 5px; background: none; cursor: pointer;
      }

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
