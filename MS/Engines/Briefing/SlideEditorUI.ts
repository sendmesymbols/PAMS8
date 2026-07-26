/**
 * SlideEditorUI.ts
 *
 * PowerPoint-style three-pane chrome for the SlideEditor, modelled on
 * bento/slides (MIT, © 2026 The Bento authors — https://bento.page):
 *
 *   topbar                      brand · title · undo/redo · tools · save
 *   ├── rail        (left)      slide thumbnails, drag to reorder, ＋ New slide
 *   ├── canvas wrap (centre)    the fabric stage, with the zoom + Slideshow
 *   │                           pills parked in its bottom-right corner and the
 *   │                           speaker-notes drawer folded away beneath it
 *   └── props       (right)     collapsible sections — the slide's own
 *                               properties when nothing is selected, the
 *                               contextual style sections when something is
 *
 * Both side rails drag-resize (widths persisted), collapse to nothing via
 * their chevron or `[` / `]`, and the centre keeps whatever is left. The
 * geometry, spacing and interaction model are bento's; the palette is ours,
 * read straight off the `--ms-*` custom properties ThemeManager publishes on
 * :root, so the editor wears Ops Dark / Night Vision with the rest of the app.
 *
 * Pure DOM/CSS — owns building, event wiring and value sync; all editing
 * semantics stay in SlideEditor (the `EditorUIHost`). The UI writes changed
 * values into `host.defaults` and then notifies `host.onStyleChanged(prop)`.
 */

import type { ArrowHead, Slide } from './BriefingTypes';
import { DEFAULT_TEXT_COLOR, type ArrowType } from './OverlayFabric';
import { BUILTIN_LAYOUTS, LAYOUT_INK_DIM } from './SlideLayouts';
import {
  AFFILIATIONS,
  AMPLIFIER_GROUPS,
  ECHELONS,
  HQ_TF_DUMMY,
  STATUSES,
  type SidcOption,
} from './MilSymFactory';

export type Tool =
  | 'select'
  | 'lasso'
  | 'rect'
  | 'diamond'
  | 'ellipse'
  | 'triangle'
  | 'star'
  | 'callout'
  | 'blockArrow'
  | 'blockArrowDouble'
  | 'chevron'
  | 'line'
  | 'arrow'
  | 'tacArrow'
  | 'freehand'
  | 'highlighter'
  | 'text'
  | 'image'
  | 'milsym'
  | 'table'
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
  /** Text only — one-level list marker. null = not a list. */
  listStyle: 'bullet' | 'number' | null;
  /** Table only — style row 0 as a header. */
  headerRow: boolean;
  /** Table only — the header row's fill. */
  headerFill: string;
  /** Block arrows — head length as a fraction of the box. */
  blockHeadRatio: number;
  /** Tactical arrows — body thickness in px. */
  tacWidthPx: number;
  /** Tactical arrows — head length as a fraction of the spine. */
  tacHeadRatio: number;
  /** Tactical arrows — narrow the body toward the tail. */
  taper: boolean;
  /** Military symbols — SIDC slots the style bar owns (see MilSymFactory). */
  symAffiliation: string;
  symStatus: string;
  symEchelon: string;
  symHqTfDummy: string;
  /** Military symbols — on-slide height in px. */
  symSizePx: number;
  /** Military symbols — milsymbol text amplifiers, edited in their own dialog. */
  symOptions: Record<string, string>;
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
  | 'closed'
  | 'listStyle'
  | 'headerRow'
  | 'headerFill'
  /** Shared by the block arrows and the tactical arrow; routed by panel context. */
  | 'headRatio'
  | 'tacWidthPx'
  | 'taper'
  | 'symAffiliation'
  | 'symStatus'
  | 'symEchelon'
  | 'symHqTfDummy'
  | 'symSizePx'
  | 'symOptions';

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
    | 'table'
    | 'highlight'
    | 'arrow'
    | 'blockarrow'
    | 'tacarrow'
    | 'milsym'
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

/**
 * What the left rail needs from the briefing to render and act. Optional as a
 * whole: an embedder that has no slide list simply gets no rail, and the
 * editor's ◀ / ▶ navigation still works.
 */
export interface RailHost {
  slides(): Array<{ title: string; thumb?: string }>;
  current(): number;
  /** Save the open slide and edit slide `index` instead. */
  go(index: number): void;
  move(from: number, to: number): void;
  duplicate(index: number): void;
  remove(index: number): void;
  /** Append a slide seeded from a built-in layout, then open it. */
  add(layoutId: string): void;
}

export interface EditorUIHost {
  defaults: StyleDefaults;
  onToolSelected(t: Tool): void;
  /**
   * save | cancel | notes | prevSlide | nextSlide | present | presentFromStart |
   * help | toolLock | undo | redo |
   * front | forward | backward | back | dup | del |
   * group | ungroup | lock | flipH | flipV |
   * copy | cut | paste | copyStyles | pasteStyles | selectAll |
   * alignLeft | alignCenterH | alignRight | alignTop | alignCenterV |
   * alignBottom | distributeH | distributeV |
   * tableRowAdd | tableRowDel | tableColAdd | tableColDel |
   * zoomIn | zoomOut | zoomReset | amplifiers
   */
  onAction(act: string): void;
  /** host.defaults[prop] was already updated — apply to selection + commit. */
  onStyleChanged(prop: StyleProp): void;
  /** Slide rail data + operations. Absent = no rail. */
  rail?: RailHost;
  /**
   * A side rail was collapsed, expanded or resized, so the stage box changed
   * size. SlideEditor refits the canvas. Optional — the editor also runs a
   * ResizeObserver, this is just the immediate path.
   */
  onLayoutChanged?(): void;
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
  { tool: 'blockArrow', letter: 'b', title: 'Block arrow (drag) — exports as a native PowerPoint arrow', startsGroup: true },
  { tool: 'blockArrowDouble', letter: 'w', title: 'Double-headed block arrow (drag)' },
  { tool: 'chevron', letter: 'u', title: 'Chevron (drag)' },
  { tool: 'line', letter: 'l', num: '6', title: 'Line (drag)', startsGroup: true },
  { tool: 'arrow', letter: 'a', num: '5', title: 'Arrow — click points, double-click or Enter to finish' },
  { tool: 'tacArrow', letter: 'f', title: 'Attack arrow — click points along the axis, double-click or Enter to finish. Arrowheads ▸ Start adds a second head' },
  { tool: 'freehand', letter: 'p', num: '7', title: 'Freehand ink' },
  { tool: 'highlighter', letter: 'h', title: 'Highlighter — wide translucent marker' },
  { tool: 'text', letter: 't', num: '8', title: 'Text (click on slide)' },
  { tool: 'image', letter: 'i', num: '9', title: 'Image — pick a file, or paste / drop one on the slide' },
  { tool: 'milsym', letter: 'm', title: 'Military symbol — search or browse MIL-STD-2525D, then click to place' },
  { tool: 'table', letter: 'g', title: 'Table — drag a grid, or click for 3×3. Double-click a cell to type; Tab moves on' },
  { tool: 'eraser', letter: 'e', num: '0', title: 'Eraser — drag over objects to delete', startsGroup: true },
  { tool: 'laser', letter: 'k', title: 'Laser pointer — fading trail, never saved' },
];

const STROKE_SWATCHES = ['#ffffff', '#1e1e1e', '#ff3b30', '#ffd166', '#2f9e44', '#339af0', '#f08c00'];
const FILL_SWATCHES = ['#ffd166', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99', '#ff3b30', '#1e1e1e'];
/**
 * Text ink. Leads with the background-agnostic default, then the two extremes —
 * a slide's background is unknown, so reaching white (for dark imagery) or near
 * black (for a blank slide) has to be one click, not a trip to the OS picker.
 */
const TEXT_SWATCHES = [
  DEFAULT_TEXT_COLOR,
  '#ffffff',
  '#1e1e1e',
  '#ff3b30',
  '#ffd166',
  '#2f9e44',
  '#339af0',
];

/** Side-rail widths — bento's own defaults and bounds, in px. */
const RAIL_DEFAULTS = { left: 188, right: 236 } as const;
const RAIL_BOUNDS = { left: [110, 400], right: [190, 520] } as const;
const RAIL_WIDTH_KEY = 'ms-sledit-rails';
const RAIL_COLLAPSE_KEY = 'ms-sledit-rails-collapsed';
const SECTION_COLLAPSE_KEY = 'ms-sledit-sections';

// ── Inline SVG icons (no dependency) ─────────────────────────────────────────

/** Amplifier values are user text going straight into an attribute. */
const escapeAttr = (v: string): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

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
  blockArrow: svg('<path d="M3 9.5h9V5.5l8 6.5-8 6.5v-4H3z"/>'),
  blockArrowDouble: svg('<path d="M8 9.5h8V5.5l5 6.5-5 6.5v-4H8v4l-5-6.5L8 5.5z"/>'),
  chevron: svg('<path d="M3 4.5h11l6 7.5-6 7.5H3l6-7.5z"/>'),
  tacArrow: svg('<path d="M3 16.5c5-1 8.5-4.5 10.5-8.5l-3-1.2 8-2.3-1.2 8-2.6-2.2c-2.6 5-6.6 8.4-11.7 9.6z"/>', true),
  milsym: svg('<path d="M3.5 7.5h17v9h-17z"/><path d="M7 11.2l2.6 2.6M9.6 11.2L7 13.8M14 11h3.2"/>'),
  taper: svg('<path d="M3 10.5h17M3 13.5h17" stroke-dasharray="0"/><path d="M3 10.5L20 12 3 13.5"/>'),
  table: svg('<rect x="3.5" y="5" width="17" height="14" rx="1.4"/><path d="M3.5 9.6h17M3.5 14.3h17M9.2 5v14M14.8 5v14"/>'),
  bulletList: svg('<circle cx="5" cy="7" r="1.5" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="5" cy="17" r="1.5" fill="currentColor" stroke="none"/><path d="M9.5 7h11M9.5 12h11M9.5 17h11"/>'),
  numberList: svg('<path d="M9.5 7h11M9.5 12h11M9.5 17h11"/><text x="2.4" y="8.6" font-size="6.4" fill="currentColor" stroke="none">1</text><text x="2.4" y="13.8" font-size="6.4" fill="currentColor" stroke="none">2</text><text x="2.4" y="19" font-size="6.4" fill="currentColor" stroke="none">3</text>'),
  rowAdd: svg('<rect x="3.5" y="4.5" width="17" height="6" rx="1.2"/><path d="M3.5 15.5h10M8.5 20.5v-10" stroke-dasharray="0"/><path d="M16 18h5M18.5 15.5v5"/>'),
  rowDel: svg('<rect x="3.5" y="4.5" width="17" height="6" rx="1.2"/><path d="M3.5 15.5h10M8.5 20.5v-10"/><path d="M16 18h5"/>'),
  colAdd: svg('<rect x="4.5" y="3.5" width="6" height="17" rx="1.2"/><path d="M15.5 3.5v10M20.5 8.5h-10"/><path d="M18 16v5M15.5 18.5h5"/>'),
  colDel: svg('<rect x="4.5" y="3.5" width="6" height="17" rx="1.2"/><path d="M15.5 3.5v10M20.5 8.5h-10"/><path d="M15.5 18.5h5"/>'),
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
  undo: svg('<path d="M4 9.5h9.5a5.5 5.5 0 010 11H7"/><path d="M8 5L3.5 9.5 8 14"/>'),
  redo: svg('<path d="M20 9.5h-9.5a5.5 5.5 0 000 11H17"/><path d="M16 5l4.5 4.5L16 14"/>'),
  plus: svg('<path d="M12 5.5v13M5.5 12h13"/>'),
  slideshow: svg('<rect x="3" y="4.5" width="18" height="12.5" rx="1.8"/><path d="M8.5 20.5h7"/><path d="M10.6 8.8l4.6 2.6-4.6 2.6z" fill="currentColor" stroke="none"/>'),
};

/**
 * The editor's own mark, echoing bento's stacked-tiles lockup but in our
 * palette — one wide tile over two stacked ones, i.e. "a slide and its parts".
 */
const BRAND_MARK =
  `<svg class="ms-sledit-mark" viewBox="0 0 32 32" width="17" height="17" aria-hidden="true">` +
  `<rect width="32" height="32" rx="7" fill="var(--ms-accent, #64b4ff)" opacity="0.16"/>` +
  `<rect x="5" y="5" width="7" height="22" rx="2.5" fill="var(--ms-accent, #64b4ff)" opacity="0.75"/>` +
  `<rect x="14" y="5" width="13" height="10" rx="2.5" fill="var(--ms-accent, #64b4ff)"/>` +
  `<rect x="14" y="17" width="13" height="10" rx="2.5" fill="currentColor" opacity="0.45"/>` +
  `</svg>`;

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
      ['Edit a table cell', 'Double-click the cell'],
      ['Next / previous cell', 'Tab · Shift+Tab'],
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
  text: ['text', 'list', 'opacity'],
  box: ['stroke', 'fill', 'fillop', 'width', 'dash', 'opacity'],
  // A block arrow is a box shape with one extra proportion: how much of the
  // box the head takes. That value is also what PPTX carries as its adjustment.
  blockarrow: ['stroke', 'fill', 'fillop', 'width', 'dash', 'headratio', 'opacity'],
  // A filled attack arrow: the body is geometry (its own width + taper), the
  // heads reuse the arrow terminator slots, and fill/stroke paint the outline.
  tacarrow: [
    'stroke',
    'fill',
    'fillop',
    'width',
    'dash',
    'arrowtype',
    'arrowheads',
    'tacbody',
    'headratio',
    'opacity',
  ],
  // A symbol has no stroke or fill of its own — its look comes out of the SIDC.
  milsym: ['milsym', 'amplifiers', 'opacity'],
  // A table shares the text and fill/stroke rows — those drive its cell font,
  // body fill and gridlines — plus its own row/column and header controls.
  // No 'list': the model has no per-cell bullets.
  table: ['table', 'text', 'fill', 'fillop', 'stroke', 'width', 'dash', 'opacity'],
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
  private _rail: HTMLElement | null = null;
  private _railThumbs: HTMLElement | null = null;
  private _props: HTMLElement | null = null;
  private _corner: HTMLElement | null = null;
  private _layoutPicker: HTMLElement | null = null;
  private _layoutDismiss: ((e: PointerEvent) => void) | null = null;
  /** Rail drag-reorder: index being dragged, null when idle. */
  private _railDrag: number | null = null;
  private _panelW: { left: number; right: number } = {
    left: RAIL_DEFAULTS.left,
    right: RAIL_DEFAULTS.right,
  };
  private _panel: HTMLElement | null = null;
  private _ctxMenu: HTMLElement | null = null;
  private _ctxDismiss: ((e: MouseEvent) => void) | null = null;
  private _help: HTMLElement | null = null;
  private _amps: HTMLElement | null = null;
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

    const swatchRow = (slot: 'stroke' | 'fill' | 'text', colors: string[]): string => {
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
      // The text slot's custom picker doubles as the one refreshPanelValues
      // syncs, so it carries the legacy `.ms-sledit-textcolor` hook too.
      const customClass = slot === 'text' ? 'ms-sledit-custom ms-sledit-textcolor' : 'ms-sledit-custom';
      return `<div class="ms-sledit-swatches">${none}${btns}<input type="color" class="${customClass}" data-slot="${slot}" title="Custom color"></div>`;
    };

    const headOptions = ARROW_HEAD_OPTIONS.map(
      (o) => `<option value="${o.value}">${o.label}</option>`,
    ).join('');
    const sidcOptions = (list: SidcOption[]): string =>
      list.map((o) => `<option value="${o.value}">${o.label}</option>`).join('');
    const affiliationOptions = sidcOptions(AFFILIATIONS);
    const statusOptions = sidcOptions(STATUSES);
    const echelonOptions = sidcOptions(ECHELONS);
    const hqOptions = sidcOptions(HQ_TF_DUMMY);

    stage.innerHTML = `
      <div class="ms-sledit-topbar">
        <span class="ms-sledit-brand">${BRAND_MARK}<b><i>Editor</i></b></span>
        <input type="text" class="ms-sledit-title" placeholder="Slide title" title="Slide title (saved with the slide)">
        <span class="ms-sledit-group">
          <button data-act="undo" class="ms-sledit-iconbtn" title="Undo (Ctrl+Z)">${ICONS.undo}</button>
          <button data-act="redo" class="ms-sledit-iconbtn" title="Redo (Ctrl+Y)">${ICONS.redo}</button>
        </span>
        <span class="ms-sledit-tools">${toolButtons}<span class="ms-sledit-sep"></span><button data-act="toolLock" title="Keep the active shape tool armed after each draw — Q">${ICONS.toolLock}<kbd>Q</kbd></button></span>
        <span class="ms-sledit-group ms-sledit-topright">
          <select class="ms-sledit-transition" title="Transition played entering this slide from another slide-view slide.">
            <option value="">Cut</option>
            <option value="fade">Fade</option>
            <option value="pushLeft">Push Left</option>
            <option value="pushRight">Push Right</option>
            <option value="wipe">Wipe</option>
          </select>
          <button data-act="notes" class="ms-sledit-iconbtn" title="Toggle speaker notes — opens a drawer under the slide">${ICONS.notes}</button>
          <button data-act="help" class="ms-sledit-iconbtn" title="Keyboard shortcuts (?)">${ICONS.help}</button>
          <button data-act="save" class="primary" title="Save annotations, title and notes to the slide">Save &amp; Close</button>
          <button data-act="cancel" title="Discard changes">Cancel</button>
        </span>
      </div>
      <div class="ms-sledit-main">
        <aside class="ms-sledit-rail">
          <div class="ms-sledit-railthumbs"></div>
          <button class="ms-sledit-addslide" title="New slide from a layout">${ICONS.plus}<span>New slide</span></button>
        </aside>
        <div class="ms-sledit-resizer" data-side="left" title="Drag to resize · double-click to reset">
          <button class="ms-sledit-paneltoggle" data-side="left" type="button">‹</button>
        </div>
        <div class="ms-sledit-canvaswrap">
          <!-- stagearea holds the canvas and the floating corner pills; the
               notes drawer is its flex sibling, so opening it takes height from
               the stage (which the ResizeObserver turns into a refit) instead of
               covering the slide. -->
          <div class="ms-sledit-stagearea">
            <div class="ms-sledit-stagewrap">
              <span class="ms-sledit-loading">Preparing slide…</span>
            </div>
            <div class="ms-sledit-cornerbr">
              <div class="ms-sledit-zoombar">
                <button data-act="zoomOut" title="Zoom out (Ctrl+−)">−</button>
                <button data-act="zoomReset" class="ms-sledit-zoom" title="Reset zoom to 100% (Ctrl+0)">100%</button>
                <button data-act="zoomIn" title="Zoom in (Ctrl++)">+</button>
              </div>
              <div class="ms-sledit-presentpill">
                <button data-act="present" class="ms-sledit-pillmain" title="Save this slide and start the slide show from here (Esc exits)">${ICONS.slideshow}<span>Slideshow</span></button>
                <button class="ms-sledit-pillcaret" type="button" title="More ways to present">▴</button>
                <div class="ms-sledit-pillmenu">
                  <button data-act="present">Present from this slide</button>
                  <button data-act="presentFromStart">Present from the start</button>
                </div>
              </div>
            </div>
          </div>
          <div class="ms-sledit-notesbar" style="display:none">
            <div class="ms-sledit-noteshead">
              ${ICONS.notes}<span>Speaker notes</span>
              <span class="ms-sledit-spring"></span>
              <button data-act="notes" class="ms-sledit-noteshide" type="button" title="Hide speaker notes">✕</button>
            </div>
            <textarea class="ms-sledit-notes" placeholder="Notes for the presenter — not shown to the audience…"></textarea>
          </div>
        </div>
        <div class="ms-sledit-resizer" data-side="right" title="Drag to resize · double-click to reset">
          <button class="ms-sledit-paneltoggle" data-side="right" type="button">›</button>
        </div>
        <aside class="ms-sledit-props">
          <div class="ms-sledit-slidesecs">
            <div class="ms-sledit-sec" data-sec="slide">
              <div class="ms-sledit-seclabel">Slide</div>
              <div class="ms-sledit-row ms-sledit-navrow">
                <button data-act="prevSlide" title="Save this slide and edit the previous one">◀</button>
                <span class="ms-sledit-navcount">– / –</span>
                <button data-act="nextSlide" title="Save this slide and edit the next one">▶</button>
              </div>
            </div>
          </div>
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
          <div class="ms-sledit-sec" data-sec="headratio">
            <div class="ms-sledit-seclabel">Head size</div>
            <input type="range" class="ms-sledit-headratio" min="5" max="200" step="5" title="Head length — a block arrow measures it against its height (PowerPoint's own scale), a tactical arrow against its spine">
          </div>
          <div class="ms-sledit-sec" data-sec="tacbody">
            <div class="ms-sledit-seclabel">Body</div>
            <div class="ms-sledit-row">
              <input type="number" class="ms-sledit-tacwidth" min="4" max="240" step="2" title="Body thickness (px)">
              <button data-style="taper" title="Taper the body toward the tail">${ICONS.taper}</button>
            </div>
          </div>
          <div class="ms-sledit-sec" data-sec="milsym">
            <div class="ms-sledit-seclabel">Symbol</div>
            <div class="ms-sledit-row">
              <select class="ms-sledit-symaff" title="Standard identity — recolours the frame">${affiliationOptions}</select>
            </div>
            <div class="ms-sledit-row">
              <select class="ms-sledit-symstatus" title="Present or planned (dashed frame)">${statusOptions}</select>
            </div>
            <div class="ms-sledit-row">
              <select class="ms-sledit-symech" title="Echelon">${echelonOptions}</select>
            </div>
            <div class="ms-sledit-row">
              <select class="ms-sledit-symhq" title="Headquarters / task force / dummy">${hqOptions}</select>
            </div>
            <div class="ms-sledit-row">
              <span class="ms-sledit-mini">Size</span>
              <input type="number" class="ms-sledit-symsize" min="12" max="600" step="4" title="Symbol height (px)">
            </div>
          </div>
          <div class="ms-sledit-sec" data-sec="amplifiers">
            <div class="ms-sledit-row">
              <button data-act="amplifiers" class="ms-sledit-wide" title="Edit the symbol's text amplifiers — unique designation, higher formation, DTG…">Amplifiers…</button>
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
                 left to flex-wrap: weight here, alignment below, and ink on its
                 own swatch row (the same markup stroke and fill use). -->
            <div class="ms-sledit-row">
              <button data-style="bold" title="Bold"><b>B</b></button>
              <button data-style="italic" title="Italic"><i>I</i></button>
              <button data-style="underline" title="Underline"><u>U</u></button>
            </div>
            <div class="ms-sledit-row">
              <button data-align="left" title="Align left">${ICONS.alignLeft}</button>
              <button data-align="center" title="Align center">${ICONS.alignCenter}</button>
              <button data-align="right" title="Align right">${ICONS.alignRight}</button>
            </div>
            ${swatchRow('text', TEXT_SWATCHES)}
          </div>
          <div class="ms-sledit-sec" data-sec="list">
            <div class="ms-sledit-seclabel">List</div>
            <div class="ms-sledit-row">
              <button data-list="bullet" title="Bulleted list — every line becomes an item. Exports as a real PowerPoint list">${ICONS.bulletList}</button>
              <button data-list="number" title="Numbered list — renumbers itself as you edit. Exports as a real PowerPoint list">${ICONS.numberList}</button>
            </div>
          </div>
          <div class="ms-sledit-sec" data-sec="table">
            <div class="ms-sledit-seclabel">Table</div>
            <div class="ms-sledit-row">
              <button data-act="tableRowAdd" title="Add a row at the bottom">${ICONS.rowAdd}</button>
              <button data-act="tableRowDel" title="Remove the last row">${ICONS.rowDel}</button>
              <button data-act="tableColAdd" title="Add a column on the right">${ICONS.colAdd}</button>
              <button data-act="tableColDel" title="Remove the last column">${ICONS.colDel}</button>
            </div>
            <div class="ms-sledit-row">
              <button data-style="headerRow" title="Style the first row as a header">H</button>
              <span class="ms-sledit-mini">Header row</span>
              <input type="color" class="ms-sledit-headerfill" title="Header row fill">
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
        </aside>
      </div>`;

    this._bar = stage.querySelector('.ms-sledit-topbar') as HTMLElement;
    this._rail = stage.querySelector('.ms-sledit-rail') as HTMLElement;
    this._railThumbs = stage.querySelector('.ms-sledit-railthumbs') as HTMLElement;
    this._props = stage.querySelector('.ms-sledit-props') as HTMLElement;
    this._corner = stage.querySelector('.ms-sledit-cornerbr') as HTMLElement;
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
    this._wireShell();
    this._restorePanelWidths();
    this._restoreCollapsedSections();
    this.refreshRail();
    this.refreshPanelValues();
  }

  /**
   * Kept for the canvas rebuild path in SlideEditor: the properties panel used
   * to live inside stageWrap (overlaying the canvas), so wiping stageWrap
   * detached it. It is docked in the right rail now and survives on its own —
   * this only re-homes it if something ever tears it out.
   */
  public remountPanel(): void {
    if (this._panel && this._props && !this._props.contains(this._panel)) {
      this._props.appendChild(this._panel);
    }
  }

  // ── Event wiring ───────────────────────────────────────────────────────────

  private _wireBar(): void {
    const dispatch = (e: Event) => {
      const el = (e.target as HTMLElement).closest('[data-tool],[data-act]') as HTMLElement | null;
      if (!el) return;
      if (el.dataset.tool) this._host.onToolSelected(el.dataset.tool as Tool);
      else this._host.onAction(el.dataset.act!);
    };
    // Four non-overlapping containers, so no click is ever dispatched twice.
    // The properties rail keeps its own richer handler (_wirePanel), and the
    // slide-level sections sit outside `.ms-sledit-panel`, hence the third; the
    // notes drawer lives in the canvas column, so its ✕ needs the fourth.
    this._bar?.addEventListener('click', dispatch);
    this._corner?.addEventListener('click', dispatch);
    this._props
      ?.querySelector('.ms-sledit-slidesecs')
      ?.addEventListener('click', dispatch as EventListener);
    this._notesBar
      ?.querySelector('.ms-sledit-noteshead')
      ?.addEventListener('click', dispatch as EventListener);
  }

  // ── Shell: rails, resizers, section collapse, layout picker ────────────────

  private _wireShell(): void {
    const stage = this._stage;
    if (!stage) return;

    // Collapsible section headers. Every section — the panel's contextual ones
    // and the slide-level ones — is built from the same seclabel + rows shape,
    // so one delegated handler makes all of them collapsible with no per-
    // section markup at all.
    stage.addEventListener('click', (e) => {
      const label = (e.target as HTMLElement).closest('.ms-sledit-seclabel') as HTMLElement | null;
      if (!label) return;
      const sec = label.closest('.ms-sledit-sec') as HTMLElement | null;
      if (!sec) return;
      sec.classList.toggle('collapsed');
      this._persistCollapsedSections();
    });

    for (const handle of Array.from(
      stage.querySelectorAll('.ms-sledit-resizer'),
    ) as HTMLElement[]) {
      this._wireResizer(handle, handle.dataset.side as 'left' | 'right');
    }

    // The Slideshow pill's caret menu. Click-away is bound to the STAGE, not
    // to document: the stage is full-screen so there is no "outside" to miss,
    // and the listener dies with it instead of outliving every editor session.
    const pill = stage.querySelector('.ms-sledit-presentpill') as HTMLElement | null;
    pill?.querySelector('.ms-sledit-pillcaret')?.addEventListener('click', (e) => {
      e.stopPropagation();
      pill.classList.toggle('open');
    });
    stage.addEventListener(
      'pointerdown',
      (e) => {
        if (pill && !pill.contains(e.target as Node)) pill.classList.remove('open');
      },
      true,
    );

    stage
      .querySelector('.ms-sledit-addslide')
      ?.addEventListener('click', (e) => this._openLayoutPicker(e.currentTarget as HTMLElement));
  }

  private _wireResizer(handle: HTMLElement, side: 'left' | 'right'): void {
    const panelOf = () => (side === 'left' ? this._rail : this._props);
    const toggle = handle.querySelector('.ms-sledit-paneltoggle') as HTMLElement | null;

    toggle?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.toggleSideRail(side);
    });

    handle.addEventListener('mousedown', (down) => {
      if (down.target === toggle) return; // the chevron is a click, not a drag
      const panel = panelOf();
      if (!panel || panel.classList.contains('collapsed')) return;
      down.preventDefault();
      const startX = down.clientX;
      const startW = this._panelW[side];
      const [min, max] = RAIL_BOUNDS[side];
      document.body.classList.add('ms-sledit-resizing');
      const move = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        this._panelW[side] = Math.min(max, Math.max(min, startW + (side === 'left' ? dx : -dx)));
        this._applyPanelWidths();
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        document.body.classList.remove('ms-sledit-resizing');
        this._persistPanelWidths();
        // A narrower rail renders narrower thumbnails.
        if (side === 'left') this.refreshRail();
        this._host.onLayoutChanged?.();
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });

    handle.addEventListener('dblclick', () => {
      this._panelW[side] = RAIL_DEFAULTS[side];
      this._applyPanelWidths();
      this._persistPanelWidths();
      this._host.onLayoutChanged?.();
    });
  }

  /** Collapse / expand a side rail — the chevron, and `[` / `]`. */
  public toggleSideRail(side: 'left' | 'right'): void {
    const panel = side === 'left' ? this._rail : this._props;
    if (!panel) return;
    panel.classList.toggle('collapsed');
    this._updateRailChevrons();
    this._persistPanelWidths();
    this._host.onLayoutChanged?.();
  }

  private _updateRailChevrons(): void {
    for (const side of ['left', 'right'] as const) {
      const panel = side === 'left' ? this._rail : this._props;
      const btn = this._stage?.querySelector(
        `.ms-sledit-paneltoggle[data-side="${side}"]`,
      ) as HTMLElement | null;
      if (!panel || !btn) continue;
      const collapsed = panel.classList.contains('collapsed');
      // The chevron points where clicking will move the boundary.
      btn.textContent = side === 'left' ? (collapsed ? '›' : '‹') : collapsed ? '‹' : '›';
      const what = side === 'left' ? 'slide list ([)' : 'properties (])';
      btn.title = `${collapsed ? 'Show' : 'Hide'} ${what}`;
    }
  }

  private _applyPanelWidths(): void {
    this._rail?.style.setProperty('--railw', `${this._panelW.left}px`);
    this._props?.style.setProperty('--railw', `${this._panelW.right}px`);
  }

  private _persistPanelWidths(): void {
    try {
      localStorage.setItem(RAIL_WIDTH_KEY, JSON.stringify(this._panelW));
      localStorage.setItem(
        RAIL_COLLAPSE_KEY,
        JSON.stringify({
          left: !!this._rail?.classList.contains('collapsed'),
          right: !!this._props?.classList.contains('collapsed'),
        }),
      );
    } catch {
      /* storage disabled — widths just don't persist */
    }
  }

  private _restorePanelWidths(): void {
    try {
      const saved = JSON.parse(localStorage.getItem(RAIL_WIDTH_KEY) ?? '{}');
      for (const side of ['left', 'right'] as const) {
        const [min, max] = RAIL_BOUNDS[side];
        if (typeof saved[side] === 'number') {
          this._panelW[side] = Math.min(max, Math.max(min, saved[side]));
        }
      }
      const col = JSON.parse(localStorage.getItem(RAIL_COLLAPSE_KEY) ?? '{}');
      if (col.left) this._rail?.classList.add('collapsed');
      if (col.right) this._props?.classList.add('collapsed');
    } catch {
      /* corrupt storage — keep the defaults */
    }
    // A narrow window starts with both rails out of the way, so the canvas is
    // what you see; the chevrons and [ / ] bring them back.
    if (window.innerWidth < 900) {
      this._rail?.classList.add('collapsed');
      this._props?.classList.add('collapsed');
    }
    this._applyPanelWidths();
    this._updateRailChevrons();
  }

  private _persistCollapsedSections(): void {
    const closed = Array.from(
      this._stage?.querySelectorAll('.ms-sledit-sec.collapsed') ?? [],
    ).map((el) => (el as HTMLElement).dataset.sec ?? '');
    try {
      localStorage.setItem(SECTION_COLLAPSE_KEY, JSON.stringify(closed.filter(Boolean)));
    } catch {
      /* storage disabled */
    }
  }

  private _restoreCollapsedSections(): void {
    let closed: string[] = [];
    try {
      const raw = JSON.parse(localStorage.getItem(SECTION_COLLAPSE_KEY) ?? '[]');
      if (Array.isArray(raw)) closed = raw;
    } catch {
      /* corrupt storage — everything starts open */
    }
    for (const name of closed) {
      this._stage
        ?.querySelector(`.ms-sledit-sec[data-sec="${CSS.escape(name)}"]`)
        ?.classList.add('collapsed');
    }
  }

  // ── Slide rail ─────────────────────────────────────────────────────────────

  /** Rebuild the thumbnail strip from the host's slide list. */
  public refreshRail(): void {
    const rail = this._host.rail;
    const box = this._railThumbs;
    if (!box) return;
    if (!rail) {
      this._rail?.classList.add('ms-sledit-rail-off');
      return;
    }
    const slides = rail.slides();
    const current = rail.current();
    const scroll = box.scrollTop;
    box.innerHTML = slides
      .map((s, i) => {
        const label = this._escape(s.title || `Slide ${i + 1}`);
        const face = s.thumb
          ? `<img src="${s.thumb}" alt="">`
          : `<span class="ms-sledit-thumbblank">${label}</span>`;
        return `<div class="ms-sledit-thumb${
          i === current ? ' active' : ''
        }" data-i="${i}" draggable="true" title="${label}">
            <span class="ms-sledit-thumbnum">${i + 1}</span>
            <span class="ms-sledit-thumbtools">
              <button data-rail="dup" data-i="${i}" title="Duplicate this slide">⧉</button>
              <button data-rail="del" data-i="${i}" title="Delete this slide">✕</button>
            </span>
            ${face}
          </div>`;
      })
      .join('');
    box.scrollTop = scroll;
    this._wireRailTiles();
  }

  private _wireRailTiles(): void {
    const box = this._railThumbs;
    const rail = this._host.rail;
    if (!box || !rail) return;

    box.onclick = (e) => {
      const tool = (e.target as HTMLElement).closest('[data-rail]') as HTMLElement | null;
      if (tool) {
        e.stopPropagation();
        const i = Number(tool.dataset.i);
        if (tool.dataset.rail === 'dup') rail.duplicate(i);
        else rail.remove(i);
        return;
      }
      const tile = (e.target as HTMLElement).closest('.ms-sledit-thumb') as HTMLElement | null;
      if (tile) rail.go(Number(tile.dataset.i));
    };

    // Drag-reorder, mirroring the slide sorter's own drop-marker behaviour.
    box.ondragstart = (e) => {
      const tile = (e.target as HTMLElement).closest('.ms-sledit-thumb') as HTMLElement | null;
      if (!tile) return;
      this._railDrag = Number(tile.dataset.i);
      e.dataTransfer?.setData('text/plain', String(this._railDrag));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    };
    box.ondragover = (e) => {
      if (this._railDrag === null) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const tile = (e.target as HTMLElement).closest('.ms-sledit-thumb') as HTMLElement | null;
      this._clearRailMarkers();
      if (!tile) return;
      tile.classList.add(this._dropsBefore(e, tile) ? 'drop-before' : 'drop-after');
    };
    box.ondragleave = () => this._clearRailMarkers();
    box.ondrop = (e) => {
      e.preventDefault();
      const from = this._railDrag;
      this._railDrag = null;
      this._clearRailMarkers();
      if (from === null) return;
      const tile = (e.target as HTMLElement).closest('.ms-sledit-thumb') as HTMLElement | null;
      if (!tile) return;
      const over = Number(tile.dataset.i);
      let to = this._dropsBefore(e, tile) ? over : over + 1;
      if (to > from) to -= 1;
      if (to !== from) rail.move(from, to);
    };
    box.ondragend = () => {
      this._railDrag = null;
      this._clearRailMarkers();
    };
  }

  private _dropsBefore(e: DragEvent, tile: HTMLElement): boolean {
    const r = tile.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2;
  }

  private _clearRailMarkers(): void {
    this._railThumbs
      ?.querySelectorAll('.drop-before, .drop-after')
      .forEach((el) => el.classList.remove('drop-before', 'drop-after'));
  }

  // ── New-slide layout picker ────────────────────────────────────────────────

  private _openLayoutPicker(anchor: HTMLElement): void {
    if (this._layoutPicker) {
      this._closeLayoutPicker();
      return;
    }
    const rail = this._host.rail;
    if (!rail) return;

    const pick = document.createElement('div');
    pick.className = 'ms-sledit-layouts';
    pick.innerHTML =
      `<div class="ms-sledit-layoutshead">Built-in</div>
       <div class="ms-sledit-layoutgrid">` +
      BUILTIN_LAYOUTS.map(
        (l) =>
          `<button data-layout="${l.id}" title="New slide — ${this._escape(l.name)}">
             <span class="ms-sledit-layoutpv">${l.preview}</span>
             <span class="ms-sledit-layoutname">${this._escape(l.name)}</span>
           </button>`,
      ).join('') +
      `</div>`;

    // Opens upward from the rail's bottom button, clamped on-screen.
    const r = anchor.getBoundingClientRect();
    pick.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 380))}px`;
    pick.style.bottom = `${Math.max(8, window.innerHeight - r.top + 8)}px`;
    // Inside the stage, not on document.body — closing the editor removes the
    // stage, and with it any picker still open.
    this._stage?.appendChild(pick);
    this._layoutPicker = pick;

    pick.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-layout]') as HTMLElement | null;
      if (!btn) return;
      const id = btn.dataset.layout!;
      this._closeLayoutPicker();
      rail.add(id);
    });

    this._layoutDismiss = (ev: PointerEvent) => {
      if (!pick.contains(ev.target as Node) && ev.target !== anchor) this._closeLayoutPicker();
    };
    setTimeout(() => document.addEventListener('pointerdown', this._layoutDismiss!, true));
  }

  private _closeLayoutPicker(): void {
    if (this._layoutDismiss) {
      document.removeEventListener('pointerdown', this._layoutDismiss, true);
      this._layoutDismiss = null;
    }
    this._layoutPicker?.remove();
    this._layoutPicker = null;
  }

  private _escape(s: string): string {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private _wirePanel(): void {
    const panel = this._panel;
    if (!panel) return;
    const d = () => this._host.defaults;

    panel.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest(
        '[data-color],[data-width],[data-dash],[data-arrowtype],[data-style],[data-align],[data-list],[data-act]',
      ) as HTMLElement | null;
      if (!el) return;
      if (el.dataset.act) {
        this._host.onAction(el.dataset.act);
        return;
      }
      if (el.dataset.color != null) {
        const slot = el.dataset.slot as 'stroke' | 'fill' | 'text';
        if (slot === 'fill') {
          d().fill = el.dataset.color === '' ? null : el.dataset.color;
          this._host.onStyleChanged('fill');
        } else if (slot === 'text') {
          d().textColor = el.dataset.color as string;
          this._host.onStyleChanged('textColor');
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
        const key = el.dataset.style as
          | 'bold'
          | 'italic'
          | 'underline'
          | 'closed'
          | 'headerRow'
          | 'taper';
        d()[key] = !d()[key];
        this._host.onStyleChanged(key);
      } else if (el.dataset.list) {
        // Mutually exclusive, and each button also turns its own style off.
        const want = el.dataset.list as 'bullet' | 'number';
        d().listStyle = d().listStyle === want ? null : want;
        this._host.onStyleChanged('listStyle');
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
      this.refreshPanelValues();
    });
    bind('.ms-sledit-headerfill', 'input', (el) => {
      d().headerFill = el.value;
      this._host.onStyleChanged('headerFill');
    });
    bind('.ms-sledit-arrowstart', 'change', (el) => {
      d().arrowStart = el.value as ArrowHead;
      this._host.onStyleChanged('arrowStart');
    });
    bind('.ms-sledit-arrowend', 'change', (el) => {
      d().arrowEnd = el.value as ArrowHead;
      this._host.onStyleChanged('arrowEnd');
    });
    // One slider, two meanings — a block arrow's head is a fraction of its box,
    // a tactical arrow's a fraction of its spine, and the two contexts are
    // mutually exclusive. Same routing the stroke-width control already does
    // for the highlighter.
    bind('.ms-sledit-headratio', 'input', (el) => {
      // Two scales behind one slider: a tactical arrow's head is a fraction of
      // its spine (≤ 0.6 stays an arrow rather than a triangle), a block
      // arrow's is a multiple of its height, exactly as OOXML measures it.
      const tac = this._ctx.kind === 'tacarrow';
      const ratio = Math.max(0.05, Math.min(tac ? 0.6 : 2, Number(el.value) / 100));
      if (tac) d().tacHeadRatio = ratio;
      else d().blockHeadRatio = ratio;
      this._host.onStyleChanged('headRatio');
    });
    bind('.ms-sledit-tacwidth', 'change', (el) => {
      d().tacWidthPx = Math.max(4, Math.min(240, Number(el.value) || 24));
      this._host.onStyleChanged('tacWidthPx');
      this.refreshPanelValues();
    });
    bind('.ms-sledit-symaff', 'change', (el) => {
      d().symAffiliation = el.value;
      this._host.onStyleChanged('symAffiliation');
    });
    bind('.ms-sledit-symstatus', 'change', (el) => {
      d().symStatus = el.value;
      this._host.onStyleChanged('symStatus');
    });
    bind('.ms-sledit-symech', 'change', (el) => {
      d().symEchelon = el.value;
      this._host.onStyleChanged('symEchelon');
    });
    bind('.ms-sledit-symhq', 'change', (el) => {
      d().symHqTfDummy = el.value;
      this._host.onStyleChanged('symHqTfDummy');
    });
    bind('.ms-sledit-symsize', 'change', (el) => {
      d().symSizePx = Math.max(12, Math.min(600, Number(el.value) || 64));
      this._host.onStyleChanged('symSizePx');
      this.refreshPanelValues();
    });
  }

  // ── Amplifier dialog ───────────────────────────────────────────────────────

  /**
   * The 22 milsymbol text amplifiers, grouped. Too many fields for the
   * properties island, so they get their own small floating dialog; edits apply
   * live (the symbol re-renders as you type) and Close is the only exit.
   */
  public toggleAmplifierDialog(): void {
    if (this._amps) {
      this.hideAmplifierDialog();
      return;
    }
    const stage = this._stage;
    if (!stage) return;
    const d = this._host.defaults;
    const groups = AMPLIFIER_GROUPS.map(
      (g) => `
        <div class="ms-sledit-ampgroup">
          <div class="ms-sledit-amplabel">${g.label}</div>
          ${g.fields
            .map(
              (f) => `<label class="ms-sledit-amprow"><span>${f.label}</span>
                <input type="text" data-amp="${f.key}" value="${escapeAttr(
                  d.symOptions?.[f.key] ?? '',
                )}"></label>`,
            )
            .join('')}
        </div>`,
    ).join('');

    const el = document.createElement('div');
    el.className = 'ms-sledit-amps';
    el.innerHTML = `
      <div class="ms-sledit-ampshead">
        <span>Amplifiers</span>
        <button data-close="1" title="Close">✕</button>
      </div>
      <div class="ms-sledit-ampsbody">${groups}</div>`;
    stage.appendChild(el);
    this._amps = el;

    el.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      const key = input?.dataset?.amp;
      if (!key) return;
      this._host.defaults.symOptions = { ...this._host.defaults.symOptions, [key]: input.value };
      this._host.onStyleChanged('symOptions');
    });
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-close]')) this.hideAmplifierDialog();
    });
  }

  public hideAmplifierDialog(): void {
    this._amps?.remove();
    this._amps = null;
  }

  /** Re-fill the dialog's inputs after the selection changed under it. */
  public syncAmplifierDialog(): void {
    if (!this._amps) return;
    const opts = this._host.defaults.symOptions ?? {};
    this._amps.querySelectorAll('input[data-amp]').forEach((el: any) => {
      el.value = opts[el.dataset.amp] ?? '';
    });
  }

  // ── State sync ─────────────────────────────────────────────────────────────

  public setActiveTool(t: Tool): void {
    this._bar?.querySelectorAll('[data-tool]').forEach((b: any) => {
      b.classList.toggle('active', b.dataset.tool === t);
    });
  }

  public updateNav(index: number, count: number): void {
    const stage = this._stage;
    if (!stage) return;
    const counter = stage.querySelector('.ms-sledit-navcount');
    if (counter) counter.textContent = `${index + 1} / ${count}`;
    const prev = stage.querySelector('[data-act="prevSlide"]') as HTMLButtonElement | null;
    const next = stage.querySelector('[data-act="nextSlide"]') as HTMLButtonElement | null;
    if (prev) prev.disabled = index <= 0;
    if (next) next.disabled = index >= count - 1;
    this.refreshRail();
  }

  /**
   * Show/hide the notes drawer under the slide. Closed is the resting state —
   * notes are a presenter aid, not something worth a permanent slice of the
   * window — so it is display:none rather than a collapsed section, and the
   * caller refits the stage afterwards (see SlideEditor's 'notes' action).
   */
  public toggleNotes(): void {
    if (!this._notesBar) return;
    this._setNotesOpen(this._notesBar.style.display === 'none');
    if (this._notesBar.style.display !== 'none') this.notesArea?.focus();
  }

  /** Drawer visibility + the top bar button's pressed look, kept in step. */
  private _setNotesOpen(open: boolean): void {
    if (!this._notesBar) return;
    this._notesBar.style.display = open ? '' : 'none';
    const btn = this._bar?.querySelector('[data-act="notes"]');
    btn?.classList.toggle('active', open);
  }

  /**
   * Sync the notes textarea to `slide` — value always, and open the drawer when
   * the slide already has saved notes (never force-closes, so a drawer the user
   * opened by hand stays open across navigation). Called on initial build and
   * on every slide navigation.
   */
  public syncNotes(slide: Slide): void {
    if (this.notesArea) this.notesArea.value = slide.notes ?? '';
    if (slide.notes) this._setNotesOpen(true);
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
    // A tactical arrow's heads are on/off, not shaped — the terminator kind is
    // ignored, so say what the control actually does here.
    const headsLabel = panel.querySelector(
      '.ms-sledit-sec[data-sec="arrowheads"] .ms-sledit-seclabel',
    );
    if (headsLabel) {
      headsLabel.textContent = ctx.kind === 'tacarrow' ? 'Heads (None = no head)' : 'Arrowheads';
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
      const current = slot === 'fill' ? d.fill ?? '' : slot === 'text' ? d.textColor : d.stroke;
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
    q('[data-style="headerRow"]').classList.toggle('active', d.headerRow);
    q('[data-style="taper"]')?.classList.toggle('active', d.taper);
    const tacCtx = this._ctx.kind === 'tacarrow';
    const headRatio = tacCtx ? d.tacHeadRatio : d.blockHeadRatio;
    const headRatioEl = q('.ms-sledit-headratio');
    if (headRatioEl) {
      // Range follows the meaning — see the slider's handler in _wirePanel.
      headRatioEl.max = tacCtx ? '60' : '200';
      headRatioEl.value = String(Math.round(headRatio * 100));
    }
    const tacWidthEl = q('.ms-sledit-tacwidth');
    if (tacWidthEl) tacWidthEl.value = String(Math.round(d.tacWidthPx));
    const symAff = q('.ms-sledit-symaff');
    if (symAff) symAff.value = d.symAffiliation;
    const symStatus = q('.ms-sledit-symstatus');
    if (symStatus) symStatus.value = d.symStatus;
    const symEch = q('.ms-sledit-symech');
    if (symEch) symEch.value = d.symEchelon;
    const symHq = q('.ms-sledit-symhq');
    if (symHq) symHq.value = d.symHqTfDummy;
    const symSize = q('.ms-sledit-symsize');
    if (symSize) symSize.value = String(Math.round(d.symSizePx));
    this.syncAmplifierDialog();
    const headerFill = q('.ms-sledit-headerfill');
    if (headerFill) headerFill.value = d.headerFill;
    panel.querySelectorAll('[data-list]').forEach((el: any) => {
      el.classList.toggle('active', el.dataset.list === d.listStyle);
    });
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

  /** Show the current canvas zoom in the corner pill. */
  public setZoom(zoom: number): void {
    const el = this._stage?.querySelector('.ms-sledit-zoom');
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
      /* ————— token bridge —————
         Geometry and interaction model are bento/slides'; the palette is ours.
         ThemeManager publishes --ms-* on :root, so switching Ops Dark / Night
         Vision retints the editor with the rest of the app. The base stays an
         opaque #0d1117 on purpose: --ms-bg is translucent by design (app panels
         float over the map) and a full-screen editor showing the map through
         itself is noise, not depth. */
      #msSlideEditor {
        --sl-surface: rgba(20, 25, 32, 0.98);
        --sl-tint: var(--ms-bg-header, rgba(40, 80, 140, 0.10));
        --sl-input: var(--ms-bg-input, rgba(255, 255, 255, 0.05));
        --sl-line: var(--ms-border, rgba(255, 255, 255, 0.14));
        --sl-line-soft: rgba(255, 255, 255, 0.08);
        --sl-text: var(--ms-text, #dde3e8);
        --sl-dim: var(--ms-text-dim, #8a97a5);
        --sl-accent: var(--ms-accent, #64b4ff);
        --sl-radius: var(--ms-radius, 9px);

        position: fixed; inset: 0; z-index: 9700; background: #0d1117;
        display: flex; flex-direction: column;
        font: 12px/1.4 var(--ms-menu-font, system-ui, sans-serif);
        color: var(--sl-text);
      }

      /* ————— topbar ————— */

      .ms-sledit-topbar {
        display: flex; align-items: center; gap: 8px; flex: none;
        padding: 7px 12px; background: var(--sl-surface);
        background-image: linear-gradient(var(--sl-tint), var(--sl-tint));
        border-bottom: 1px solid var(--sl-line);
        z-index: 20;
      }
      .ms-sledit-brand {
        display: inline-flex; align-items: center; gap: 7px; flex: none;
        font-size: 13px; white-space: nowrap; letter-spacing: 0.01em;
        color: var(--sl-text);
      }
      .ms-sledit-brand b { font-weight: 650; }
      .ms-sledit-brand i { font-style: normal; font-weight: 400; color: var(--sl-dim); }
      .ms-sledit-mark { display: block; }
      .ms-sledit-group { display: inline-flex; align-items: center; gap: 5px; flex: none; }
      /* Insert tools take the middle; save/cancel are pinned to the corner. */
      .ms-sledit-tools {
        display: inline-flex; align-items: center; gap: 3px;
        flex: 1 1 auto; min-width: 0; overflow-x: auto; scrollbar-width: none;
      }
      .ms-sledit-tools::-webkit-scrollbar { display: none; }
      .ms-sledit-topright { margin-left: auto; }

      .ms-sledit-topbar button {
        background: var(--sl-input); color: var(--sl-text);
        border: 1px solid var(--sl-line); border-radius: 7px;
        padding: 5px 9px; cursor: pointer; font: inherit; white-space: nowrap;
      }
      .ms-sledit-topbar button:hover { background: rgba(255,255,255,0.14); }
      .ms-sledit-topbar button:disabled { opacity: 0.35; cursor: default; }
      .ms-sledit-topbar button:disabled:hover { background: var(--sl-input); }
      .ms-sledit-tools button {
        position: relative; width: 34px; height: 32px; padding: 0;
        display: inline-flex; align-items: center; justify-content: center;
        border-color: transparent; background: transparent; flex: none;
      }
      .ms-sledit-tools button:hover { background: rgba(255,255,255,0.10); }
      .ms-sledit-tools button svg { width: 19px; height: 19px; display: block; }
      .ms-sledit-tools button kbd {
        position: absolute; right: 3px; bottom: 1px;
        font-family: inherit; font-size: 8px; color: var(--sl-dim); pointer-events: none;
      }
      .ms-sledit-topbar button.active, .ms-sledit-topbar button.primary {
        background: var(--sl-accent); border-color: var(--sl-accent); color: #08121c;
        font-weight: 600;
      }
      .ms-sledit-tools button.active { color: #08121c; }
      .ms-sledit-tools button.active kbd { color: rgba(0,0,0,0.55); }
      .ms-sledit-topbar button.primary:hover { filter: brightness(1.12); }
      .ms-sledit-iconbtn { width: 32px; height: 32px; padding: 0 !important; display: inline-flex; align-items: center; justify-content: center; }
      .ms-sledit-iconbtn svg { width: 17px; height: 17px; display: block; }
      .ms-sledit-topbar input[type="text"] {
        background: var(--sl-input); color: var(--sl-text);
        border: 1px solid transparent; border-radius: 7px;
        padding: 5px 8px; font: inherit; width: 200px; flex: none;
        height: 30px; box-sizing: border-box;
      }
      .ms-sledit-topbar input[type="text"]:hover { border-color: var(--sl-line); }
      .ms-sledit-topbar input[type="text"]:focus {
        outline: none; border-color: var(--sl-accent); background: rgba(255,255,255,0.09);
      }
      .ms-sledit-sep { width: 1px; align-self: stretch; background: var(--sl-line); margin: 0 3px; flex: none; }
      /* The transition combo rides in the top bar rather than owning a row in
         the properties rail — it is a per-slide setting you set once. */
      .ms-sledit-topbar select {
        background: var(--sl-input); color: var(--sl-text);
        border: 1px solid var(--sl-line); border-radius: 7px;
        padding: 4px 6px; font: inherit; height: 30px; box-sizing: border-box;
        cursor: pointer; flex: none;
      }
      .ms-sledit-topbar select:hover { background: rgba(255,255,255,0.14); }
      .ms-sledit-topbar select:focus { outline: none; border-color: var(--sl-accent); }
      /* The native dropdown list is OS-painted — without this it opens white. */
      .ms-sledit-topbar option { background: var(--sl-surface); color: var(--sl-text); }
      .ms-sledit-transition { width: 104px; }
      .ms-sledit-transition:disabled { opacity: 0.4; cursor: not-allowed; }

      /* ————— main layout ————— */

      .ms-sledit-main { flex: 1; display: flex; min-height: 0; }

      .ms-sledit-rail, .ms-sledit-props {
        width: var(--railw, 188px); flex: none; overflow-y: auto;
        background: var(--sl-surface);
        background-image: linear-gradient(var(--sl-tint), var(--sl-tint));
        scrollbar-width: thin;
      }
      .ms-sledit-rail {
        border-right: 1px solid var(--sl-line);
        display: flex; flex-direction: column; gap: 10px; padding: 12px;
      }
      .ms-sledit-props {
        width: var(--railw, 236px);
        border-left: 1px solid var(--sl-line); padding: 12px 14px 20px;
      }
      /* Collapsed rails keep their border as a hairline seam — the chevron on
         the resizer stays reachable because the resizer is a sibling. */
      .ms-sledit-rail.collapsed, .ms-sledit-props.collapsed {
        width: 0; padding-left: 0; padding-right: 0; overflow: hidden;
      }
      .ms-sledit-rail-off { display: none; }

      /* ————— resizer + collapse chevron ————— */

      .ms-sledit-resizer {
        position: relative; flex: none; width: 5px; cursor: col-resize;
        background: transparent;
      }
      .ms-sledit-resizer:hover { background: rgba(100,180,255,0.18); }
      body.ms-sledit-resizing { cursor: col-resize; user-select: none; }
      .ms-sledit-paneltoggle {
        position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
        width: 15px; height: 40px; padding: 0; cursor: pointer; z-index: 6;
        display: flex; align-items: center; justify-content: center;
        background: var(--sl-surface); color: var(--sl-dim);
        border: 1px solid var(--sl-line); border-radius: 5px;
        font: inherit; font-size: 11px; line-height: 1;
        opacity: 0; transition: opacity 0.14s ease;
      }
      .ms-sledit-main:hover .ms-sledit-paneltoggle { opacity: 1; }
      .ms-sledit-paneltoggle:hover { color: var(--sl-text); border-color: var(--sl-accent); }

      /* ————— slide rail ————— */

      .ms-sledit-railthumbs {
        display: flex; flex-direction: column; align-items: center; gap: 9px;
        flex: 1; min-height: 0;
      }
      .ms-sledit-thumb {
        position: relative; width: 100%; border: 2px solid var(--sl-line);
        border-radius: 8px; overflow: hidden; cursor: pointer; flex: none;
        background: #0f141b; aspect-ratio: 16 / 9;
      }
      .ms-sledit-thumb:hover { border-color: rgba(255,255,255,0.3); }
      .ms-sledit-thumb.active { border-color: var(--sl-accent); }
      /* pointer-events off so the tile owns every click AND every drag — a bare
         <img> is natively draggable and would start its own image drag instead
         of the tile's reorder. */
      .ms-sledit-thumb img {
        width: 100%; height: 100%; object-fit: cover; display: block;
        pointer-events: none; -webkit-user-drag: none;
      }
      .ms-sledit-thumbblank {
        display: flex; align-items: center; justify-content: center;
        width: 100%; height: 100%; padding: 6px; text-align: center;
        font-size: 10.5px; color: var(--sl-dim); overflow: hidden;
      }
      .ms-sledit-thumbnum {
        position: absolute; top: 4px; left: 4px; z-index: 2;
        font-size: 10px; font-weight: 600; color: var(--sl-text);
        background: rgba(8,12,18,0.78); border-radius: 4px; padding: 1px 5px;
        font-variant-numeric: tabular-nums;
      }
      .ms-sledit-thumbtools {
        position: absolute; right: 4px; top: 4px; z-index: 2; display: none; gap: 2px;
      }
      .ms-sledit-thumb:hover .ms-sledit-thumbtools { display: flex; }
      .ms-sledit-thumbtools button {
        width: 19px; height: 19px; padding: 0; cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center;
        background: rgba(8,12,18,0.85); color: var(--sl-text);
        border: 1px solid var(--sl-line); border-radius: 4px;
        font: inherit; font-size: 10px; line-height: 1;
      }
      .ms-sledit-thumbtools button:hover { background: var(--sl-accent); color: #08121c; }
      /* Drop markers, drawn as an edge rather than a moving placeholder — the
         same read as the slide sorter's insertion line. */
      .ms-sledit-thumb.drop-before { box-shadow: 0 -3px 0 0 var(--sl-accent); }
      .ms-sledit-thumb.drop-after { box-shadow: 0 3px 0 0 var(--sl-accent); }

      .ms-sledit-addslide {
        display: flex; align-items: center; justify-content: center; gap: 6px;
        width: 100%; flex: none; padding: 8px; cursor: pointer;
        background: transparent; color: var(--sl-dim); font: inherit;
        border: 1.5px dashed var(--sl-line); border-radius: 8px;
      }
      .ms-sledit-addslide:hover { color: var(--sl-text); border-color: var(--sl-accent); }
      .ms-sledit-addslide svg { width: 15px; height: 15px; display: block; }

      /* ————— canvas ————— */

      .ms-sledit-canvaswrap {
        flex: 1; min-width: 0; overflow: hidden;
        display: flex; flex-direction: column;
        background:
          radial-gradient(circle at 1px 1px, rgba(255,255,255,0.055) 1px, transparent 0) 0 0 / 22px 22px,
          #0d1117;
      }
      /* Takes whatever height the notes drawer leaves. The stage and the corner
         pills both position against this, so neither can end up under a drawer. */
      .ms-sledit-stagearea { flex: 1; min-height: 0; position: relative; }
      .ms-sledit-stagewrap {
        position: absolute; inset: 0;
        display: flex; align-items: center; justify-content: center;
        overflow: auto; padding: 12px;
        /* Reserve the gutter: a scrollbar appearing mid-refit would shrink the
           client box, which is exactly the measurement _computeFitSize reads. */
        scrollbar-gutter: stable both-edges;
      }
      .ms-sledit-stagewrap canvas {
        border-radius: 3px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.4);
      }
      .ms-sledit-loading { color: var(--sl-dim); font-size: 14px; }

      /* ————— speaker-notes drawer ————— */

      .ms-sledit-notesbar {
        flex: none; display: flex; flex-direction: column; gap: 6px;
        padding: 8px 12px 10px; background: var(--sl-surface);
        background-image: linear-gradient(var(--sl-tint), var(--sl-tint));
        border-top: 1px solid var(--sl-line);
      }
      .ms-sledit-noteshead {
        display: flex; align-items: center; gap: 6px;
        font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em;
        text-transform: uppercase; color: var(--sl-dim);
      }
      .ms-sledit-noteshead svg { width: 14px; height: 14px; }
      .ms-sledit-spring { flex: 1; }
      .ms-sledit-noteshide {
        border: 0; background: transparent; color: var(--sl-dim);
        cursor: pointer; font: inherit; padding: 0 2px; line-height: 1;
      }
      .ms-sledit-noteshide:hover { color: var(--sl-text); }
      .ms-sledit-notes {
        width: 100%; box-sizing: border-box;
        height: 84px; min-height: 44px; max-height: 40vh; resize: vertical;
        background: var(--sl-input); color: var(--sl-text);
        border: 1px solid var(--sl-line); border-radius: 7px;
        padding: 8px 9px; font: inherit; line-height: 1.5;
      }

      /* ————— bottom-right pills: zoom + slideshow ————— */

      .ms-sledit-cornerbr {
        position: absolute; right: 14px; bottom: 14px; z-index: 8;
        display: flex; align-items: center; gap: 8px;
      }
      .ms-sledit-zoombar, .ms-sledit-presentpill {
        display: flex; align-items: center; gap: 1px;
        background: var(--sl-surface); border: 1px solid var(--sl-line);
        border-radius: 999px; padding: 3px;
        box-shadow: 0 6px 20px rgba(0,0,0,0.42);
      }
      .ms-sledit-cornerbr button {
        background: transparent; color: var(--sl-text); border: 0;
        border-radius: 999px; padding: 5px 10px; cursor: pointer;
        font: inherit; white-space: nowrap;
        display: inline-flex; align-items: center; gap: 6px;
      }
      .ms-sledit-cornerbr button:hover { background: rgba(255,255,255,0.12); }
      .ms-sledit-cornerbr svg { width: 15px; height: 15px; display: block; }
      .ms-sledit-zoom { min-width: 50px; justify-content: center; color: var(--sl-dim) !important; font-variant-numeric: tabular-nums; }
      .ms-sledit-presentpill { position: relative; }
      .ms-sledit-pillmain { font-weight: 600; }
      .ms-sledit-pillcaret { padding: 5px 7px !important; color: var(--sl-dim) !important; font-size: 10px; }
      .ms-sledit-pillmenu {
        display: none; position: absolute; right: 0; bottom: calc(100% + 7px);
        min-width: 196px; padding: 4px; flex-direction: column; gap: 1px;
        background: var(--sl-surface); border: 1px solid var(--sl-line);
        border-radius: var(--sl-radius); box-shadow: 0 12px 34px rgba(0,0,0,0.5);
      }
      .ms-sledit-presentpill.open .ms-sledit-pillmenu { display: flex; }
      .ms-sledit-pillmenu button { justify-content: flex-start; width: 100%; border-radius: 6px; }

      /* ————— new-slide layout picker ————— */

      .ms-sledit-layouts {
        position: fixed; z-index: 40; width: 360px; padding: 12px;
        background: var(--sl-surface); border: 1px solid var(--sl-line);
        border-radius: var(--sl-radius); box-shadow: 0 16px 44px rgba(0,0,0,0.55);
      }
      .ms-sledit-layoutshead {
        font-size: 10px; font-weight: 700; letter-spacing: 0.08em;
        text-transform: uppercase; color: var(--sl-dim); margin-bottom: 9px;
      }
      .ms-sledit-layoutgrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; }
      .ms-sledit-layoutgrid button {
        display: flex; flex-direction: column; gap: 5px; padding: 0; cursor: pointer;
        background: none; border: 0; font: inherit; color: var(--sl-dim);
      }
      .ms-sledit-layoutpv {
        display: block; border: 1px solid var(--sl-line); border-radius: 6px;
        overflow: hidden; background: #12181f;
      }
      .ms-sledit-layoutpv svg { display: block; width: 100%; height: auto; aspect-ratio: 100 / 56; }
      .ms-sledit-layoutgrid button:hover .ms-sledit-layoutpv { border-color: var(--sl-accent); }
      .ms-sledit-layoutgrid button:hover { color: var(--sl-text); }
      .ms-sledit-layoutname { font-size: 11px; text-align: center; }
      /* Preview swatches mirror what the layout produces — see SlideLayouts.pv. */
      .pv-paper { fill: #ffffff; }
      .pv-accent { fill: var(--sl-accent); }
      .pv-ink { fill: ${DEFAULT_TEXT_COLOR}; }
      .pv-dim { fill: ${LAYOUT_INK_DIM}; }
      .pv-scrim { fill: rgba(13,17,23,0.86); }
      .pv-inkscrim { fill: rgba(255,255,255,0.9); }

      /* ————— properties rail ————— */

      .ms-sledit-slidesecs, .ms-sledit-panel {
        display: flex; flex-direction: column; gap: 14px;
      }
      .ms-sledit-slidesecs { margin-bottom: 14px; }
      .ms-sledit-navrow { justify-content: space-between; }
      .ms-sledit-notes:focus { outline: none; border-color: var(--sl-accent); background: rgba(255,255,255,0.08); }
      .ms-sledit-notes::placeholder { color: var(--sl-dim); }
      .ms-sledit-navcount {
        min-width: 46px; text-align: center; white-space: nowrap;
        color: var(--sl-dim); font-variant-numeric: tabular-nums;
      }

      /* Collapsible sections: the label is the handle, everything after it is
         the body. No per-section wrapper markup — see _wireShell. */
      .ms-sledit-seclabel { cursor: pointer; user-select: none; }
      .ms-sledit-seclabel::after {
        content: '▾'; float: right; font-size: 9px; color: var(--sl-dim);
        transition: transform 0.14s ease; transform-origin: center;
      }
      .ms-sledit-sec.collapsed > .ms-sledit-seclabel::after { content: '▸'; }
      .ms-sledit-sec.collapsed > *:not(.ms-sledit-seclabel) { display: none; }

      .ms-sledit-panel { padding: 0; }
      /* One vertical rhythm for every section: the section owns the gap between
         its label and its rows, so a multi-row section (text, align, actions)
         no longer has its rows touching. Hidden sections are display:none, so
         the rail's own flex gap already skips them — section separation must
         NOT come from adjacent-sibling borders, which would leave a stray rule
         above whichever section happens to be first-visible. */
      .ms-sledit-sec { display: flex; flex-direction: column; gap: 6px; }
      /* Applied by showPanel, not by a sibling selector — see the note there.
         The rail's own gap sits above the rule and this padding below it, so
         the divider lands centred between two sections. */
      .ms-sledit-sec-divided {
        border-top: 1px solid var(--sl-line-soft); padding-top: 13px;
      }
      .ms-sledit-seclabel {
        font-size: 10px; font-weight: 700; letter-spacing: 0.07em;
        text-transform: uppercase; color: var(--sl-dim);
      }
      .ms-sledit-row {
        display: flex; align-items: center; gap: 5px; flex-wrap: wrap; row-gap: 5px;
      }
      /* Presets on the left, the exact value on the right — two readable groups
         instead of one undifferentiated strip. */
      .ms-sledit-row .ms-sledit-strokew { margin-left: auto; }
      .ms-sledit-mini { font-size: 11px; color: var(--sl-text); opacity: 0.78; }
      /* Scoped to the whole rail, not just .ms-sledit-panel: the slide-level
         navigation section above it uses the same row markup and must not fall
         back to unstyled native controls. */
      .ms-sledit-props button {
        background: var(--sl-input); color: var(--sl-text);
        border: 1px solid var(--sl-line); border-radius: 6px;
        width: 30px; height: 28px; padding: 0; cursor: pointer; font: inherit;
        display: inline-flex; align-items: center; justify-content: center;
      }
      .ms-sledit-props button:hover { background: rgba(255,255,255,0.15); }
      .ms-sledit-props button.active {
        background: var(--sl-accent); border-color: var(--sl-accent); color: #08121c;
      }
      .ms-sledit-props button:disabled { opacity: 0.32; cursor: default; }
      .ms-sledit-props button:disabled:hover { background: var(--sl-input); }
      .ms-sledit-props button svg { width: 17px; height: 17px; display: block; }
      /* Same height as the buttons, so every control in a row lines up. */
      .ms-sledit-props select, .ms-sledit-props input[type="number"] {
        background: var(--sl-input); color: var(--sl-text);
        border: 1px solid var(--sl-line); border-radius: 6px;
        height: 28px; padding: 0 6px; font: inherit; box-sizing: border-box;
      }
      /* A select left with its native chrome reads as unstyled against the dark
         rail — the OS paints the drop button and ignores the surrounding theme.
         Drop the native appearance and draw our own chevron. */
      .ms-sledit-props select {
        flex: 1; min-width: 0; cursor: pointer;
        appearance: none; -webkit-appearance: none; padding-right: 20px;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='7' viewBox='0 0 10 7'%3E%3Cpath d='M1 1.5l4 4 4-4' fill='none' stroke='%238a97a5' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
        background-repeat: no-repeat; background-position: right 6px center;
      }
      .ms-sledit-props select:hover:not(:disabled) { background-color: rgba(255,255,255,0.11); }
      .ms-sledit-props select:focus,
      .ms-sledit-props input[type="number"]:focus {
        outline: none; border-color: var(--sl-accent);
      }
      /* The native dropdown list is OS-painted — without this it opens white
         against the dark rail. */
      .ms-sledit-props option { background: #181d23; color: #dde3e8; }
      /* Arrowhead pickers: fixed-width labels so both selects line up, and no
         wrapping, so each select keeps the whole row's remaining width. */
      .ms-sledit-sec[data-sec="arrowheads"] .ms-sledit-row { flex-wrap: nowrap; }
      .ms-sledit-sec[data-sec="arrowheads"] .ms-sledit-mini {
        flex: 0 0 28px; text-align: right;
      }
      .ms-sledit-props input[type="number"] { width: 54px; text-align: center; }
      .ms-sledit-props input[type="range"] { width: 100%; margin: 0; }
      /* The symbol selects carry long labels ("Company / Battery / Troop") and
         are one per row, so they take the rail's full content width. */
      .ms-sledit-sec[data-sec="milsym"] .ms-sledit-row { flex-wrap: nowrap; }
      .ms-sledit-sec[data-sec="milsym"] select { width: 100%; }
      .ms-sledit-wide { width: 100% !important; }

      /* Amplifier dialog — floats over the canvas. Centred rather than parked
         beside the properties rail, so it stays fully visible whatever width
         the rails have been dragged to (or whether they are collapsed). */
      .ms-sledit-amps {
        position: absolute; z-index: 30; top: 58px; left: 50%;
        transform: translateX(-50%); width: 278px;
        max-height: calc(100% - 96px); display: flex; flex-direction: column;
        background: var(--sl-surface); border: 1px solid var(--sl-line);
        border-radius: var(--sl-radius); box-shadow: 0 12px 34px rgba(0,0,0,0.5);
      }
      .ms-sledit-ampshead {
        display: flex; align-items: center; justify-content: space-between;
        padding: 7px 9px; border-bottom: 1px solid rgba(255,255,255,0.12);
        font-weight: 600; letter-spacing: 0.02em;
      }
      .ms-sledit-ampshead button {
        background: none; border: none; color: #8a97a5; cursor: pointer;
        font: inherit; padding: 0 2px;
      }
      .ms-sledit-ampshead button:hover { color: #dde3e8; }
      .ms-sledit-ampsbody { overflow: auto; padding: 8px 9px 10px; }
      .ms-sledit-amplabel {
        font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
        color: #7d8894; margin: 6px 0 4px;
      }
      .ms-sledit-amprow {
        display: flex; align-items: center; gap: 6px; margin-bottom: 4px;
      }
      .ms-sledit-amprow span { flex: 0 0 104px; font-size: 11px; color: #aab4be; }
      .ms-sledit-amprow input {
        flex: 1; min-width: 0; background: rgba(255,255,255,0.06); color: #dde3e8;
        border: 1px solid rgba(255,255,255,0.16); border-radius: 5px;
        padding: 3px 6px; font: inherit; height: 24px; box-sizing: border-box;
      }
      .ms-sledit-amprow input:focus { outline: none; border-color: #2d6cdf; }
      .ms-sledit-swatches {
        display: flex; align-items: center; gap: 5px; flex-wrap: wrap; row-gap: 5px;
      }
      .ms-sledit-sw {
        width: 22px !important; height: 22px !important; border-radius: 5px !important;
        background: var(--sw) !important; border: 1px solid rgba(255,255,255,0.25) !important;
      }
      .ms-sledit-sw.active { outline: 2px solid var(--sl-accent); outline-offset: 1px; }
      .ms-sledit-sw.none { background: rgba(255,255,255,0.05) !important; color: var(--sl-dim); }
      .ms-sledit-sw.none svg { width: 15px; height: 15px; }
      .ms-sledit-props input[type="color"], .ms-sledit-custom {
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

      /* Below the topbar, not under it — the banner is a child of the stage,
         which now starts with a 46px-tall bar. */
      .ms-sledit-warn {
        position: absolute; top: 56px; left: 50%; transform: translateX(-50%);
        background: rgba(180,120,20,0.92); color: #fff; padding: 4px 12px;
        border-radius: 6px; z-index: 12; pointer-events: none;
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
