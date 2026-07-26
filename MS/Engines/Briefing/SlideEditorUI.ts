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

import type { ArrowHead, Slide } from './BriefingTypes';
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
  | 'image'
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
  /** Arrow terminators, per end. */
  arrowStart: ArrowHead;
  arrowEnd: ArrowHead;
  /** Line only — closed path (a polygon), which is what allows a fill. */
  closed: boolean;
}

/**
 * Terminator picker options, in menu order. Each label leads with a glyph that
 * shows solid vs hollow, which keeps the text short enough to read in full
 * inside the properties island — "Triangle (outline)" was being clipped.
 */
export const ARROW_HEAD_OPTIONS: Array<{ value: ArrowHead; label: string }> = [
  { value: 'none', label: '─ None' },
  { value: 'arrow', label: '⌄ Arrow' },
  { value: 'triangle', label: '▶ Triangle' },
  { value: 'triangleOutline', label: '▷ Triangle' },
  { value: 'bar', label: '┃ Bar' },
  { value: 'circle', label: '● Circle' },
  { value: 'circleOutline', label: '○ Circle' },
  { value: 'diamond', label: '◆ Diamond' },
  { value: 'diamondOutline', label: '◇ Diamond' },
];

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
  | 'highlightWidthPx'
  | 'arrowType'
  | 'arrowStart'
  | 'arrowEnd'
  | 'closed';

/** What the properties island is currently editing. */
export interface PanelContext {
  /** `labeled` = a shape (or arrow) selected together with its bound text label. */
  kind:
    | 'none'
    | 'text'
    | 'box'
    | 'linework'
    | 'line'
    | 'image'
    | 'highlight'
    | 'arrow'
    | 'labeled'
    | 'labeledLine'
    | 'labeledArrow'
    | 'mixed';
  /** Layers/actions rows only make sense on a live selection. */
  hasSelection: boolean;
  /** Selected object count — gates Arrange (align needs 2, distribute needs 3). */
  count: number;
  /** A closed line is the only linework that can take a fill, so it gates those rows. */
  closed: boolean;
  /** True when every selected object is locked (drives the lock button's state). */
  locked: boolean;
}

/** Everything the right-click menu needs to decide which entries to enable. */
export interface ContextMenuState {
  count: number;
  locked: boolean;
  canGroup: boolean;
  canUngroup: boolean;
  canPaste: boolean;
  canPasteStyles: boolean;
  /** The menu was opened on a vertex handle of a linework object with a point to spare. */
  canDeletePoint: boolean;
}

export interface EditorUIHost {
  defaults: StyleDefaults;
  onToolSelected(t: Tool): void;
  /**
   * save | cancel | notes | prevSlide | nextSlide | present | help | toolLock |
   * front | forward | backward | back | dup | del |
   * group | ungroup | lock | flipH | flipV |
   * copy | cut | paste | copyStyles | pasteStyles | selectAll |
   * alignLeft | alignCenterH | alignRight | alignTop | alignCenterV |
   * alignBottom | distributeH | distributeV
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
  { tool: 'arrow', letter: 'a', num: '5', title: 'Arrow — click points, double-click or Enter to finish' },
  { tool: 'freehand', letter: 'p', num: '7', title: 'Freehand ink' },
  { tool: 'highlighter', letter: 'h', title: 'Highlighter — wide translucent marker' },
  { tool: 'text', letter: 't', num: '8', title: 'Text (click on slide)' },
  { tool: 'image', letter: 'i', num: '9', title: 'Image — pick a file, or paste / drop one on the slide' },
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
  arrowSharp: svg('<path d="M4.5 19.5L18.5 5.5M18.5 5.5h-6.2M18.5 5.5v6.2"/>'),
  arrowCurved: svg('<path d="M4.5 19.5C4.5 10 9 5 18.5 5.5M18.5 5.5h-6.2M18.5 5.5v6.2"/>'),
  arrowElbow: svg('<path d="M4.5 19.5V9.5h14V5.5M18.5 5.5h-6.2M18.5 5.5v6.2"/>'),
  freehand: svg('<path d="M4 17.5c2-6.5 4.8-8.4 6-6.4s-2.2 7.3.8 7.3 4-9.4 7.2-9.4"/>'),
  highlighter: svg('<path d="M13.6 4.4l6 6-7.6 7.6H8l-2-2z"/><path d="M4 20.5h8"/>'),
  text: svg('<path d="M5.5 5.5h13M12 5.5v13"/>'),
  image: svg('<rect x="3.5" y="5" width="17" height="14" rx="1.8"/><circle cx="8.6" cy="10" r="1.6"/><path d="M4 16.5l4.6-4.2 3.4 3 3-2.6 5 4.3"/>'),
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
  group: svg('<rect x="3.5" y="3.5" width="9" height="9" rx="1.4"/><rect x="11.5" y="11.5" width="9" height="9" rx="1.4"/>'),
  ungroup: svg('<rect x="3.5" y="3.5" width="8" height="8" rx="1.4" stroke-dasharray="2.6 2"/><rect x="12.5" y="12.5" width="8" height="8" rx="1.4" stroke-dasharray="2.6 2"/>'),
  lock: svg('<rect x="5" y="10.5" width="14" height="9.5" rx="1.8"/><path d="M8.2 10.5V8a3.8 3.8 0 017.6 0v2.5"/>'),
  unlock: svg('<rect x="5" y="10.5" width="14" height="9.5" rx="1.8"/><path d="M8.2 10.5V8a3.8 3.8 0 017.1-1.8"/>'),
  flipH: svg('<path d="M12 3v18" stroke-dasharray="2.6 2.4"/><path d="M9 6.5L4 12l5 5.5zM15 6.5L20 12l-5 5.5z"/>'),
  flipV: svg('<path d="M3 12h18" stroke-dasharray="2.6 2.4"/><path d="M6.5 9L12 4l5.5 5zM6.5 15L12 20l5.5-5z"/>'),
  objAlignLeft: svg('<path d="M3.5 3.5v17"/><rect x="6.5" y="6" width="12" height="4.4" rx="1"/><rect x="6.5" y="13.6" width="8" height="4.4" rx="1"/>'),
  objAlignCenterH: svg('<path d="M12 3.5v17"/><rect x="4" y="6" width="16" height="4.4" rx="1"/><rect x="8" y="13.6" width="8" height="4.4" rx="1"/>'),
  objAlignRight: svg('<path d="M20.5 3.5v17"/><rect x="5.5" y="6" width="12" height="4.4" rx="1"/><rect x="9.5" y="13.6" width="8" height="4.4" rx="1"/>'),
  objAlignTop: svg('<path d="M3.5 3.5h17"/><rect x="6" y="6.5" width="4.4" height="12" rx="1"/><rect x="13.6" y="6.5" width="4.4" height="8" rx="1"/>'),
  objAlignCenterV: svg('<path d="M3.5 12h17"/><rect x="6" y="4" width="4.4" height="16" rx="1"/><rect x="13.6" y="8" width="4.4" height="8" rx="1"/>'),
  objAlignBottom: svg('<path d="M3.5 20.5h17"/><rect x="6" y="5.5" width="4.4" height="12" rx="1"/><rect x="13.6" y="9.5" width="4.4" height="8" rx="1"/>'),
  distributeH: svg('<path d="M3.5 3.5v17M20.5 3.5v17"/><rect x="10.4" y="7" width="3.2" height="10" rx="1"/>'),
  distributeV: svg('<path d="M3.5 3.5h17M3.5 20.5h17"/><rect x="7" y="10.4" width="10" height="3.2" rx="1"/>'),
  polygon: svg('<path d="M12 3.5l8.2 6-3.1 9.6H6.9L3.8 9.5z"/>'),
  toolLock: svg('<rect x="5" y="10.5" width="14" height="9.5" rx="1.8"/><path d="M8.2 10.5V8a3.8 3.8 0 017.6 0v2.5"/>'),
  help: svg('<circle cx="12" cy="12" r="8.8"/><path d="M9.6 9.4a2.5 2.5 0 114.3 1.8c-.9.8-1.9 1.3-1.9 2.6"/><circle cx="12" cy="17.2" r="0.9" fill="currentColor" stroke="none"/>'),
};

/** Right-click menu layout — `sep` rows render a divider. */
interface CtxItem {
  act?: string;
  label?: string;
  icon?: string;
  hint?: string;
  sep?: true;
  /** Minimum selected-object count for this row to be enabled. */
  min?: number;
  /** Extra state flag that must also be true. */
  needs?: 'canGroup' | 'canUngroup' | 'canPaste' | 'canPasteStyles' | 'canDeletePoint';
  /** Omit the row entirely when unavailable, instead of greying it out. */
  hideWhenOff?: true;
}

const CTX_ITEMS: CtxItem[] = [
  // Only meaningful when the menu was opened right on a vertex, so it comes and
  // goes rather than sitting greyed at the top of every menu.
  { act: 'deletePoint', label: 'Delete point', needs: 'canDeletePoint', hideWhenOff: true },
  { sep: true },
  { act: 'cut', label: 'Cut', hint: 'Ctrl+X', min: 1 },
  { act: 'copy', label: 'Copy', hint: 'Ctrl+C', min: 1 },
  { act: 'paste', label: 'Paste', hint: 'Ctrl+V', needs: 'canPaste' },
  { sep: true },
  { act: 'copyStyles', label: 'Copy styles', hint: 'Ctrl+Alt+C', min: 1 },
  { act: 'pasteStyles', label: 'Paste styles', hint: 'Ctrl+Alt+V', needs: 'canPasteStyles', min: 1 },
  { sep: true },
  { act: 'group', label: 'Group', hint: 'Ctrl+G', needs: 'canGroup' },
  { act: 'ungroup', label: 'Ungroup', hint: 'Ctrl+Shift+G', needs: 'canUngroup' },
  { sep: true },
  { act: 'flipH', label: 'Flip horizontal', hint: 'Shift+H', min: 1 },
  { act: 'flipV', label: 'Flip vertical', hint: 'Shift+V', min: 1 },
  { sep: true },
  { act: 'front', label: 'Bring to front', hint: 'Ctrl+Shift+]', min: 1 },
  { act: 'forward', label: 'Bring forward', hint: 'Ctrl+]', min: 1 },
  { act: 'backward', label: 'Send backward', hint: 'Ctrl+[', min: 1 },
  { act: 'back', label: 'Send to back', hint: 'Ctrl+Shift+[', min: 1 },
  { sep: true },
  { act: 'lock', label: 'Lock', hint: 'Ctrl+Shift+L', min: 1 },
  { act: 'dup', label: 'Duplicate', hint: 'Ctrl+D', min: 1 },
  { act: 'del', label: 'Delete', hint: 'Del', min: 1 },
  { sep: true },
  { act: 'selectAll', label: 'Select all', hint: 'Ctrl+A' },
];

/** Non-tool shortcuts, for the ? cheatsheet. */
const HELP_GROUPS: Array<{ title: string; rows: Array<[string, string]> }> = [
  {
    title: 'Editing',
    rows: [
      ['Cut / copy / paste', 'Ctrl+X / C / V'],
      ['Duplicate', 'Ctrl+D  ·  Alt+drag'],
      ['Delete', 'Del'],
      ['Select all', 'Ctrl+A'],
      ['Undo / redo', 'Ctrl+Z / Ctrl+Y'],
      ['Copy / paste styles', 'Ctrl+Alt+C / V'],
      ['Nudge (10 px)', 'Arrows (Shift+Arrows)'],
    ],
  },
  {
    title: 'Objects',
    rows: [
      ['Group / ungroup', 'Ctrl+G / Ctrl+Shift+G'],
      ['Lock / unlock', 'Ctrl+Shift+L'],
      ['Flip horizontal / vertical', 'Shift+H / Shift+V'],
      ['Forward / backward', 'Ctrl+] / Ctrl+['],
      ['To front / to back', 'Ctrl+Shift+] / Ctrl+Shift+['],
      ['Keep tool armed', 'Q'],
    ],
  },
  {
    title: 'Canvas',
    rows: [
      ['Zoom', 'Ctrl+wheel · Ctrl+± · Ctrl+0'],
      ['Pan', 'Space+drag · middle-drag'],
      ['Proportional resize', 'Shift+drag a corner'],
      ['Rotate snaps to 15°', 'near each multiple'],
      ['Label a shape or arrow', 'Double-click it'],
      ['Finish an arrow', 'Enter or double-click'],
      ['Move a point', 'drag a square handle'],
      ['Insert a point', 'drag a round dot'],
      ['Delete a point', 'right-click it'],
      ['Context menu', 'Right-click'],
      ['Shortcuts', '?'],
      ['Back out / close', 'Esc'],
    ],
  },
];

const SECTIONS_BY_CONTEXT: Record<PanelContext['kind'], string[]> = {
  none: [],
  text: ['text', 'opacity'],
  box: ['stroke', 'fill', 'fillop', 'width', 'dash', 'opacity'],
  // freehand ink — no shape control, its points are already sampled.
  linework: ['stroke', 'width', 'dash', 'opacity'],
  // A line is an arrow without terminators, so it shares the shape control.
  // Fill rows are added by showPanel only when the line is closed.
  line: ['stroke', 'width', 'dash', 'arrowtype', 'closepath', 'opacity'],
  // A picture has no stroke or fill of its own — only opacity, plus the
  // layers/actions rows every selection gets.
  image: ['opacity'],
  highlight: ['stroke', 'width', 'opacity'],
  arrow: ['stroke', 'width', 'dash', 'arrowtype', 'arrowheads', 'opacity'],
  // A labelled shape edits the shape and its text from one island — style
  // changes route per-object by kind, so fill hits the shape and font the text.
  labeled: ['stroke', 'fill', 'fillop', 'width', 'dash', 'text', 'opacity'],
  labeledLine: ['stroke', 'width', 'dash', 'arrowtype', 'closepath', 'text', 'opacity'],
  labeledArrow: ['stroke', 'width', 'dash', 'arrowtype', 'arrowheads', 'text', 'opacity'],
  mixed: ['stroke', 'width', 'dash', 'opacity'],
};

export default class SlideEditorUI {
  private _host: EditorUIHost;
  private _stage: HTMLElement | null = null;
  private _bar: HTMLElement | null = null;
  private _panel: HTMLElement | null = null;
  private _ctxMenu: HTMLElement | null = null;
  private _ctxDismiss: ((e: MouseEvent) => void) | null = null;
  private _help: HTMLElement | null = null;
  private _ctx: PanelContext = {
    kind: 'none',
    hasSelection: false,
    count: 0,
    locked: false,
    closed: false,
  };

  public titleInput: HTMLInputElement | null = null;
  public notesArea: HTMLTextAreaElement | null = null;
  private _notesBar: HTMLElement | null = null;
  public transitionSelect: HTMLSelectElement | null = null;
  public stageWrap: HTMLElement | null = null;

  constructor(host: EditorUIHost) {
    this._host = host;
  }

  public get bar(): HTMLElement | null {
    return this._bar;
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  public build(stage: HTMLElement, slide: Slide): void {
    this._stage = stage;
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

    const headOptions = ARROW_HEAD_OPTIONS.map(
      (o) => `<option value="${o.value}">${o.label}</option>`,
    ).join('');

    stage.innerHTML = `
      <div class="ms-sledit-bar">
        <span class="ms-sledit-tools">${toolButtons}<span class="ms-sledit-sep"></span><button data-act="toolLock" title="Keep the active shape tool armed after each draw — Q">${ICONS.toolLock}<kbd>Q</kbd></button></span>
        <span class="ms-sledit-spring"></span>
        <span class="ms-sledit-sep"></span>
        <button data-act="zoomOut" title="Zoom out (Ctrl+−)">−</button>
        <button data-act="zoomReset" class="ms-sledit-zoom" title="Reset zoom to 100% (Ctrl+0)">100%</button>
        <button data-act="zoomIn" title="Zoom in (Ctrl++)">+</button>
        <span class="ms-sledit-sep"></span>
        <button data-act="help" class="ms-sledit-iconbtn" title="Keyboard shortcuts (?)">${ICONS.help}</button>
        <input type="text" class="ms-sledit-title" placeholder="Slide title" title="Slide title (saved with the slide)">
        <button data-act="notes" class="ms-sledit-iconbtn" title="Toggle speaker notes">${ICONS.notes}</button>
        <select class="ms-sledit-transition" title="Transition played entering this slide from another slide-view slide.">
          <option value="">Cut</option>
          <option value="fade">Fade</option>
          <option value="pushLeft">Push Left</option>
          <option value="pushRight">Push Right</option>
          <option value="wipe">Wipe</option>
        </select>
        <span class="ms-sledit-sep"></span>
        <button data-act="prevSlide" title="Save this slide and edit the previous one">◀</button>
        <span class="ms-sledit-navcount">– / –</span>
        <button data-act="nextSlide" title="Save this slide and edit the next one">▶</button>
        <span class="ms-sledit-sep"></span>
        <button data-act="present" title="Save this slide and start the slide show from here (Esc exits)">⛶ Slideshow</button>
        <button data-act="save" title="Save annotations, title and notes to the slide">Save &amp; Close</button>
        <button data-act="cancel" title="Discard changes">Cancel</button>
      </div>
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
          <div class="ms-sledit-sec" data-sec="arrowtype">
            <div class="ms-sledit-seclabel">Arrow type</div>
            <!-- Label swaps to "Line type" on a line — see showPanel. -->
            <div class="ms-sledit-row">
              <button data-arrowtype="sharp" title="Sharp">${ICONS.arrowSharp}</button>
              <button data-arrowtype="curved" title="Curved">${ICONS.arrowCurved}</button>
              <button data-arrowtype="elbow" title="Elbow">${ICONS.arrowElbow}</button>
            </div>
          </div>
          <div class="ms-sledit-sec" data-sec="closepath">
            <div class="ms-sledit-seclabel">Path</div>
            <div class="ms-sledit-row">
              <button data-style="closed" class="ms-sledit-closedbtn" title="Close the path into a fillable polygon">${ICONS.polygon}</button>
              <span class="ms-sledit-mini">Closed polygon</span>
            </div>
          </div>
          <div class="ms-sledit-sec" data-sec="arrowheads">
            <div class="ms-sledit-seclabel">Arrowheads</div>
            <div class="ms-sledit-row">
              <span class="ms-sledit-mini">Start</span>
              <select class="ms-sledit-arrowstart" title="Terminator at the arrow's first point">${headOptions}</select>
            </div>
            <div class="ms-sledit-row">
              <span class="ms-sledit-mini">End</span>
              <select class="ms-sledit-arrowend" title="Terminator at the arrow's last point">${headOptions}</select>
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
            <!-- Six 30px buttons plus a separator do not fit the island's
                 184px of content width, so the split is explicit rather than
                 left to flex-wrap: weight and colour here, alignment below. -->
            <div class="ms-sledit-row">
              <button data-style="bold" title="Bold"><b>B</b></button>
              <button data-style="italic" title="Italic"><i>I</i></button>
              <button data-style="underline" title="Underline"><u>U</u></button>
              <span class="ms-sledit-minisep"></span>
              <input type="color" class="ms-sledit-textcolor" title="Text color">
            </div>
            <div class="ms-sledit-row">
              <button data-align="left" title="Align left">${ICONS.alignLeft}</button>
              <button data-align="center" title="Align center">${ICONS.alignCenter}</button>
              <button data-align="right" title="Align right">${ICONS.alignRight}</button>
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
          <div class="ms-sledit-sec" data-sec="arrange">
            <div class="ms-sledit-seclabel">Arrange</div>
            <div class="ms-sledit-row">
              <button data-act="alignLeft" data-need="2" title="Align left edges">${ICONS.objAlignLeft}</button>
              <button data-act="alignCenterH" data-need="2" title="Align horizontal centers">${ICONS.objAlignCenterH}</button>
              <button data-act="alignRight" data-need="2" title="Align right edges">${ICONS.objAlignRight}</button>
              <button data-act="distributeH" data-need="3" title="Distribute horizontally">${ICONS.distributeH}</button>
            </div>
            <div class="ms-sledit-row">
              <button data-act="alignTop" data-need="2" title="Align top edges">${ICONS.objAlignTop}</button>
              <button data-act="alignCenterV" data-need="2" title="Align vertical centers">${ICONS.objAlignCenterV}</button>
              <button data-act="alignBottom" data-need="2" title="Align bottom edges">${ICONS.objAlignBottom}</button>
              <button data-act="distributeV" data-need="3" title="Distribute vertically">${ICONS.distributeV}</button>
            </div>
          </div>
          <div class="ms-sledit-sec" data-sec="actions">
            <div class="ms-sledit-seclabel">Actions</div>
            <div class="ms-sledit-row">
              <button data-act="group" data-need="2" title="Group (Ctrl+G)">${ICONS.group}</button>
              <button data-act="ungroup" title="Ungroup (Ctrl+Shift+G)">${ICONS.ungroup}</button>
              <button data-act="flipH" title="Flip horizontal (Shift+H)">${ICONS.flipH}</button>
              <button data-act="flipV" title="Flip vertical (Shift+V)">${ICONS.flipV}</button>
            </div>
            <div class="ms-sledit-row">
              <button data-act="lock" class="ms-sledit-lockbtn" title="Lock / unlock (Ctrl+Shift+L)">${ICONS.lock}</button>
              <button data-act="dup" title="Duplicate (Ctrl+D)">${ICONS.dup}</button>
              <button data-act="del" title="Delete (Del)">${ICONS.del}</button>
            </div>
          </div>
        </div>
      </div>
      <div class="ms-sledit-notesbar" style="display:none">
        <div class="ms-sledit-noteshead">${ICONS.notes}<span>Speaker notes</span></div>
        <textarea class="ms-sledit-notes" placeholder="Notes for the presenter — not shown to the audience…"></textarea>
      </div>`;

    this._bar = stage.querySelector('.ms-sledit-bar') as HTMLElement;
    this._panel = stage.querySelector('.ms-sledit-panel') as HTMLElement;
    this.stageWrap = stage.querySelector('.ms-sledit-stagewrap') as HTMLElement;
    this.titleInput = stage.querySelector('.ms-sledit-title') as HTMLInputElement;
    this._notesBar = stage.querySelector('.ms-sledit-notesbar') as HTMLElement;
    this.notesArea = stage.querySelector('.ms-sledit-notes') as HTMLTextAreaElement;
    this.transitionSelect = stage.querySelector('.ms-sledit-transition') as HTMLSelectElement;
    this.titleInput.value = slide.title ?? '';
    this.syncNotes(slide);
    this.syncTransitionControl(slide);

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
        '[data-color],[data-width],[data-dash],[data-arrowtype],[data-style],[data-align],[data-act]',
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
      } else if (el.dataset.arrowtype) {
        d().arrowType = el.dataset.arrowtype as StyleDefaults['arrowType'];
        this._host.onStyleChanged('arrowType');
      } else if (el.dataset.style) {
        // Every data-style control is a boolean toggle in StyleDefaults.
        const key = el.dataset.style as 'bold' | 'italic' | 'underline' | 'closed';
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
    bind('.ms-sledit-arrowstart', 'change', (el) => {
      d().arrowStart = el.value as ArrowHead;
      this._host.onStyleChanged('arrowStart');
    });
    bind('.ms-sledit-arrowend', 'change', (el) => {
      d().arrowEnd = el.value as ArrowHead;
      this._host.onStyleChanged('arrowEnd');
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
    if (!this._notesBar) return;
    const opening = this._notesBar.style.display === 'none';
    this._notesBar.style.display = opening ? '' : 'none';
    if (opening) this.notesArea?.focus();
  }

  /**
   * Sync the notes textarea to `slide` — value always, and force the drawer
   * open when the slide already has saved notes (never force-closes, so a
   * drawer the user opened by hand stays open across navigation). Called on
   * initial build and on every slide navigation within an open editor session.
   */
  public syncNotes(slide: Slide): void {
    if (this.notesArea) this.notesArea.value = slide.notes ?? '';
    if (slide.notes && this._notesBar) this._notesBar.style.display = '';
  }

  /**
   * Sync the transition select to `slide` — value, and disabled/tooltip
   * based on whether it's screen-only (transitions only apply between two
   * screen-only slides; see BriefingEngine._isScreenOnly). Called on initial
   * build and on every slide navigation within an open editor session.
   */
  public syncTransitionControl(slide: Slide): void {
    if (!this.transitionSelect) return;
    const screenOnly = !slide.view?.extent && !slide.view?.camera;
    this.transitionSelect.value = slide.slideTransition ?? '';
    this.transitionSelect.disabled = !screenOnly;
    this.transitionSelect.title = screenOnly
      ? 'Transition played entering this slide from another slide-view slide.'
      : 'Only applies between slide-view slides — no live map.';
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
    let firstShown = true;
    panel.querySelectorAll('.ms-sledit-sec').forEach((el: any) => {
      const name = el.dataset.sec as string;
      const visible =
        secs.includes(name) ||
        ((name === 'layers' || name === 'actions') && ctx.hasSelection) ||
        (name === 'arrange' && ctx.count > 1) ||
        // An open line can't show a fill it would ignore.
        ((name === 'fill' || name === 'fillop') &&
          ctx.closed &&
          (ctx.kind === 'line' || ctx.kind === 'labeledLine'));
      el.style.display = visible ? '' : 'none';
      // Rule above every section except the first one actually on screen. A CSS
      // adjacent-sibling selector can't express this: a display:none section
      // still matches as a sibling, so the first visible section would inherit
      // a stray divider from whatever is hidden above it.
      el.classList.toggle('ms-sledit-sec-divided', visible && !firstShown);
      if (visible) firstShown = false;
    });
    // The shape control is shared by arrows and lines — name it for whichever
    // is selected rather than always saying "Arrow type".
    const shapeLabel = panel.querySelector(
      '.ms-sledit-sec[data-sec="arrowtype"] .ms-sledit-seclabel',
    );
    if (shapeLabel) {
      shapeLabel.textContent =
        ctx.kind === 'line' || ctx.kind === 'labeledLine' ? 'Line type' : 'Arrow type';
    }
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
    panel.querySelectorAll('[data-arrowtype]').forEach((el: any) => {
      el.classList.toggle('active', el.dataset.arrowtype === d.arrowType);
    });
    q('.ms-sledit-op').value = String(Math.round(d.opacity * 100));

    q('.ms-sledit-arrowstart').value = d.arrowStart;
    q('.ms-sledit-arrowend').value = d.arrowEnd;
    q('.ms-sledit-font').value = d.fontFamily;
    q('.ms-sledit-fontsize').value = String(d.fontSizePx);
    q('.ms-sledit-textcolor').value = d.textColor;
    q('[data-style="bold"]').classList.toggle('active', d.bold);
    q('[data-style="italic"]').classList.toggle('active', d.italic);
    q('[data-style="underline"]').classList.toggle('active', d.underline);
    q('[data-style="closed"]').classList.toggle('active', d.closed);
    panel.querySelectorAll('[data-align]').forEach((el: any) => {
      el.classList.toggle('active', el.dataset.align === d.align);
    });

    // Align / distribute / group need a minimum selection count to mean anything.
    panel.querySelectorAll('[data-need]').forEach((el: any) => {
      el.disabled = this._ctx.count < Number(el.dataset.need);
    });
    const lockBtn = q('.ms-sledit-lockbtn');
    if (lockBtn) {
      lockBtn.classList.toggle('active', this._ctx.locked);
      lockBtn.innerHTML = this._ctx.locked ? ICONS.unlock : ICONS.lock;
      lockBtn.title = this._ctx.locked ? 'Unlock (Ctrl+Shift+L)' : 'Lock (Ctrl+Shift+L)';
    }
  }

  /** Show the current canvas zoom in the tool strip. */
  public setZoom(zoom: number): void {
    const el = this._bar?.querySelector('.ms-sledit-zoom');
    if (el) el.textContent = `${Math.round(zoom * 100)}%`;
  }

  /** Reflect the Q tool-lock toggle in the tool strip. */
  public setToolLock(on: boolean): void {
    const btn = this._bar?.querySelector('[data-act="toolLock"]') as HTMLElement | null;
    btn?.classList.toggle('active', on);
  }

  // ── Right-click menu ───────────────────────────────────────────────────────

  public showContextMenu(clientX: number, clientY: number, state: ContextMenuState): void {
    this.hideContextMenu();
    const stage = this._stage;
    if (!stage) return;

    const enabledOf = (it: CtxItem) =>
      state.count >= (it.min ?? 0) && (!it.needs || !!state[it.needs]);
    // Drop hidden rows first, then any separator left leading, trailing or
    // doubled up by that removal.
    const rows = CTX_ITEMS.filter((it) => it.sep || !it.hideWhenOff || enabledOf(it)).filter(
      (it, i, arr) =>
        !it.sep || (i > 0 && i < arr.length - 1 && !arr[i - 1].sep && !arr[i + 1].sep),
    );

    const menu = document.createElement('div');
    menu.className = 'ms-sledit-ctx';
    menu.innerHTML = rows
      .map((it) => {
        if (it.sep) return '<div class="ms-sledit-ctxsep"></div>';
        const label = it.act === 'lock' && state.locked ? 'Unlock' : it.label;
        return `<button data-act="${it.act}"${
          enabledOf(it) ? '' : ' disabled'
        }><span>${label}</span><kbd>${it.hint ?? ''}</kbd></button>`;
      })
      .join('');
    stage.appendChild(menu);
    this._ctxMenu = menu;

    // Keep the menu inside the viewport (it's fixed-positioned to the stage).
    const r = stage.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const left = Math.min(clientX - r.left, Math.max(0, r.width - mw - 4));
    const top = Math.min(clientY - r.top, Math.max(0, r.height - mh - 4));
    menu.style.left = `${Math.max(4, left)}px`;
    menu.style.top = `${Math.max(4, top)}px`;

    menu.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!btn || btn.disabled) return;
      this.hideContextMenu();
      this._host.onAction(btn.dataset.act!);
    });
    // A mousedown anywhere else dismisses. Capture phase so it lands before
    // fabric's canvas handlers change the selection under the menu — which
    // also means it runs before the menu's own listeners, so clicks inside
    // have to be excluded here or the button would be gone before its click.
    this._ctxDismiss = (ev: MouseEvent) => {
      if (menu.contains(ev.target as Node)) return;
      this.hideContextMenu();
    };
    document.addEventListener('mousedown', this._ctxDismiss, true);
  }

  public hideContextMenu(): void {
    if (this._ctxDismiss) {
      document.removeEventListener('mousedown', this._ctxDismiss, true);
      this._ctxDismiss = null;
    }
    this._ctxMenu?.remove();
    this._ctxMenu = null;
  }

  public get contextMenuOpen(): boolean {
    return !!this._ctxMenu;
  }

  // ── Shortcut cheatsheet ────────────────────────────────────────────────────

  public get helpOpen(): boolean {
    return !!this._help;
  }

  public toggleHelp(): void {
    if (this._help) {
      this.closeHelp();
      return;
    }
    const stage = this._stage;
    if (!stage) return;
    const toolRows = TOOL_DEFS.map((d) => {
      const keys = [d.letter.toUpperCase(), d.num].filter(Boolean).join(' or ');
      // Tool titles read "Name — explanation"; the cheatsheet only wants the name.
      return `<tr><td>${d.title.split('—')[0].trim()}</td><td><kbd>${keys}</kbd></td></tr>`;
    }).join('');
    const groups = HELP_GROUPS.map(
      (g) => `<section><h4>${g.title}</h4><table>${g.rows
        .map(([label, keys]) => `<tr><td>${label}</td><td><kbd>${keys}</kbd></td></tr>`)
        .join('')}</table></section>`,
    ).join('');
    const help = document.createElement('div');
    help.className = 'ms-sledit-help';
    help.innerHTML = `
      <div class="ms-sledit-helpbox">
        <header>Keyboard shortcuts<button data-close title="Close (Esc)">✕</button></header>
        <div class="ms-sledit-helpcols">
          <section><h4>Tools</h4><table>${toolRows}</table></section>
          ${groups}
        </div>
      </div>`;
    help.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      // Click the backdrop or the ✕ to dismiss; clicks inside the box pass through.
      if (t === help || t.hasAttribute('data-close')) this.closeHelp();
    });
    stage.appendChild(help);
    this._help = help;
  }

  public closeHelp(): void {
    this._help?.remove();
    this._help = null;
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
      .ms-sledit-transition { width: 104px; }
      .ms-sledit-transition:disabled { opacity: 0.4; cursor: not-allowed; }
      .ms-sledit-sep { width: 1px; align-self: stretch; background: rgba(255,255,255,0.14); margin: 0 3px; }
      .ms-sledit-spring { flex: 1; }
      .ms-sledit-notesbar {
        display: flex; flex-direction: column; gap: 6px; flex-shrink: 0;
        background: rgba(18,22,26,0.97); padding: 8px 10px 10px;
        border-top: 1px solid rgba(255,255,255,0.12);
      }
      .ms-sledit-noteshead {
        display: flex; align-items: center; gap: 6px;
        font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em;
        text-transform: uppercase; color: #8a97a5;
      }
      .ms-sledit-noteshead svg { width: 14px; height: 14px; }
      .ms-sledit-notes {
        height: 64px; min-height: 40px; max-height: 40vh; resize: vertical;
        background: rgba(255,255,255,0.05); color: #dde3e8;
        border: 1px solid rgba(255,255,255,0.14); border-radius: 6px;
        padding: 8px 10px; font: inherit; line-height: 1.5;
      }
      .ms-sledit-notes:focus { outline: none; border-color: #2d6cdf; background: rgba(255,255,255,0.07); }
      .ms-sledit-notes::placeholder { color: #6b7580; }
      .ms-sledit-stagewrap {
        flex: 1; display: flex; align-items: center; justify-content: center;
        overflow: auto; padding: 12px; position: relative;
      }
      .ms-sledit-stagewrap canvas { border-radius: 4px; }
      .ms-sledit-loading { color: #8a97a5; font-size: 14px; }

      .ms-sledit-panel {
        position: absolute; left: 14px; top: 14px; z-index: 6; width: 204px;
        display: flex; flex-direction: column; gap: 9px;
        background: rgba(24,29,35,0.97); border: 1px solid rgba(255,255,255,0.14);
        border-radius: 10px; padding: 10px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.45);
        max-height: calc(100% - 28px); overflow-y: auto;
      }
      /* One vertical rhythm for every section: the section owns the gap between
         its label and its rows, so a multi-row section (text, align, actions)
         no longer has its rows touching. Hidden sections are display:none, so
         the panel's own flex gap already skips them — section separation must
         NOT come from adjacent-sibling borders, which would leave a stray rule
         above whichever section happens to be first-visible. */
      .ms-sledit-sec { display: flex; flex-direction: column; gap: 5px; }
      /* Applied by showPanel, not by a sibling selector — see the note there.
         The panel's own 9px gap sits above the rule and this padding below it,
         so the divider lands centred between two sections. */
      .ms-sledit-sec-divided {
        border-top: 1px solid rgba(255,255,255,0.09); padding-top: 9px;
      }
      .ms-sledit-seclabel {
        font-size: 10px; font-weight: 600; letter-spacing: 0.05em;
        text-transform: uppercase; color: #8a97a5;
      }
      .ms-sledit-row {
        display: flex; align-items: center; gap: 5px; flex-wrap: wrap; row-gap: 5px;
      }
      /* Presets on the left, the exact value on the right — two readable groups
         instead of one undifferentiated strip. */
      .ms-sledit-row .ms-sledit-strokew { margin-left: auto; }
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
      .ms-sledit-panel button:disabled { opacity: 0.32; cursor: default; }
      .ms-sledit-panel button:disabled:hover { background: rgba(255,255,255,0.07); }
      .ms-sledit-panel button svg { width: 17px; height: 17px; display: block; }
      /* Same height as the buttons, so every control in a row lines up. */
      .ms-sledit-panel select, .ms-sledit-panel input[type="number"] {
        background: rgba(255,255,255,0.06); color: #dde3e8;
        border: 1px solid rgba(255,255,255,0.16); border-radius: 6px;
        height: 28px; padding: 0 6px; font: inherit;
      }
      .ms-sledit-panel select { flex: 1; min-width: 0; cursor: pointer; }
      .ms-sledit-panel select:hover { background: rgba(255,255,255,0.11); }
      .ms-sledit-panel select:focus,
      .ms-sledit-panel input[type="number"]:focus {
        outline: none; border-color: #2d6cdf;
      }
      /* The native dropdown list is OS-painted — without this it opens white
         against the dark island. */
      .ms-sledit-panel option { background: #181d23; color: #dde3e8; }
      /* Arrowhead pickers: fixed-width labels so both selects line up, and no
         wrapping, so each select keeps the whole row's remaining width. */
      .ms-sledit-sec[data-sec="arrowheads"] .ms-sledit-row { flex-wrap: nowrap; }
      .ms-sledit-sec[data-sec="arrowheads"] .ms-sledit-mini {
        flex: 0 0 28px; text-align: right;
      }
      .ms-sledit-panel input[type="number"] { width: 54px; text-align: center; }
      .ms-sledit-panel input[type="range"] { width: 100%; margin: 0; }
      .ms-sledit-swatches {
        display: flex; align-items: center; gap: 5px; flex-wrap: wrap; row-gap: 5px;
      }
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

      .ms-sledit-ctx {
        position: absolute; z-index: 20; min-width: 194px; padding: 4px;
        background: rgba(24,29,35,0.98); border: 1px solid rgba(255,255,255,0.16);
        border-radius: 8px; box-shadow: 0 12px 34px rgba(0,0,0,0.5);
      }
      .ms-sledit-ctx button {
        display: flex; align-items: center; justify-content: space-between; gap: 14px;
        width: 100%; padding: 5px 8px; background: none; border: 0; border-radius: 5px;
        color: #dde3e8; font: inherit; text-align: left; cursor: pointer;
      }
      .ms-sledit-ctx button:hover:not(:disabled) { background: #2d6cdf; color: #fff; }
      .ms-sledit-ctx button:disabled { opacity: 0.34; cursor: default; }
      .ms-sledit-ctx kbd {
        font: inherit; font-size: 10.5px; color: #8a97a5; white-space: nowrap;
      }
      .ms-sledit-ctx button:hover:not(:disabled) kbd { color: rgba(255,255,255,0.75); }
      .ms-sledit-ctxsep { height: 1px; background: rgba(255,255,255,0.12); margin: 4px 6px; }

      .ms-sledit-help {
        position: absolute; inset: 0; z-index: 30; display: flex;
        align-items: center; justify-content: center; padding: 24px;
        background: rgba(6,9,12,0.62);
      }
      .ms-sledit-helpbox {
        max-height: 100%; overflow-y: auto; width: min(780px, 100%);
        background: rgba(20,25,31,0.99); border: 1px solid rgba(255,255,255,0.16);
        border-radius: 12px; box-shadow: 0 18px 50px rgba(0,0,0,0.55);
      }
      .ms-sledit-helpbox header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 11px 14px; border-bottom: 1px solid rgba(255,255,255,0.12);
        font-size: 13px; font-weight: 600;
      }
      .ms-sledit-helpbox header button {
        background: none; border: 0; color: #8a97a5; font: inherit;
        font-size: 14px; cursor: pointer; padding: 0 4px;
      }
      .ms-sledit-helpbox header button:hover { color: #dde3e8; }
      .ms-sledit-helpcols {
        display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
        gap: 6px 22px; padding: 14px;
      }
      .ms-sledit-helpcols h4 {
        margin: 0 0 6px; font-size: 10.5px; font-weight: 600; letter-spacing: 0.05em;
        text-transform: uppercase; color: #8a97a5;
      }
      .ms-sledit-helpcols table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
      .ms-sledit-helpcols td { padding: 2.5px 0; vertical-align: top; }
      .ms-sledit-helpcols td:last-child { text-align: right; white-space: nowrap; }
      .ms-sledit-helpcols kbd {
        font: inherit; font-size: 10.5px; color: #9fb2c8;
        background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.13);
        border-radius: 4px; padding: 1px 5px;
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
