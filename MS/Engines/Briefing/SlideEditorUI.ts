/**
 * SlideEditorUI.ts
 *
 * PowerPoint-style three-pane chrome for the SlideEditor, modelled on
 * bento/slides (MIT, © 2026 The Bento authors — https://bento.page):
 *
 *   topbar                      brand · title · undo/redo · tools · save
 *   ├── rail        (left)      slide thumbnails, drag to reorder, ＋ New slide
 *   ├── canvas wrap (centre)    the fabric stage, with the slide-nav, zoom and
 *   │                           Slideshow pills parked in its bottom-right
 *   │                           corner and the speaker-notes drawer folded away
 *   │                           beneath it
 *   └── props       (right)     collapsible sections — the slide's own review
 *                               comments when nothing is selected, the
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

import type {
  ArrowHead,
  OverlayBlend,
  Slide,
  SlideComment,
  SlideTransitionType,
} from './BriefingTypes';
import { DEFAULT_TEXT_COLOR, type ArrowType } from './OverlayFabric';
import { SAFE_FONTS } from './OverlayStyle';
import { BUILTIN_LAYOUTS, LAYOUT_INK_DIM } from './SlideLayouts';
import { openCount } from './SlideCommentUtils';
import { LinkBadgeLayer } from './SlideLinkBadges';
import SlideChromeLayer from './SlideChromeLayer';
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
  align: 'left' | 'center' | 'right' | 'justify';
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
  /**
   * Effects. The shadow is held in editor pixels (like strokeWidthPx) and
   * normalizes on the way into the model; `shadowPreset` is a UI convenience
   * that names a known X/Y/blur triple, and reads 'custom' for anything else.
   */
  shadowPreset: ShadowPreset;
  shadowXPx: number;
  shadowYPx: number;
  shadowBlurPx: number;
  /** '#RRGGBB' plus a separate 0..1 alpha — a colour input has no alpha channel. */
  shadowColor: string;
  shadowOpacity: number;
  /** Canvas composite mode; 'normal' clears it. */
  blend: 'normal' | OverlayBlend;
  /** Images only — gaussian blur, 0..100 in the UI (see SlideOverlay.blur). */
  blurPct: number;
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
  | 'shadowPreset'
  | 'shadowXPx'
  | 'shadowYPx'
  | 'shadowBlurPx'
  | 'shadowColor'
  | 'shadowOpacity'
  | 'blend'
  | 'blurPct'
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
  /** At least one selected object carries a link — gates the Remove-link row. */
  hasLink: boolean;
}

/**
 * What the left rail needs from the briefing to render and act. Optional as a
 * whole: an embedder that has no slide list simply gets no rail, and the
 * editor's ◀ / ▶ navigation still works.
 */
export interface RailHost {
  slides(): Array<{
    title: string;
    thumb?: string;
    openComments?: number;
    /** Set = the tile carries a transition badge. Absent = an instant cut. */
    slideTransition?: SlideTransitionType;
    /** Set = skipped in playback; the tile renders dimmed and struck through. */
    hidden?: boolean;
  }>;
  current(): number;
  /** Save the open slide and edit slide `index` instead. */
  go(index: number): void;
  move(from: number, to: number): void;
  duplicate(index: number): void;
  remove(index: number): void;
  /** Flip slide `index` between hidden and shown — PowerPoint's "Hide Slide". */
  toggleHidden(index: number): void;
  /** Append a slide seeded from a built-in layout, then open it. */
  add(layoutId: string): void;
}

/** One object's frame, in slide pixels / degrees — see EditorUIHost.getGeometry. */
export interface ObjectGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
  /**
   * The height is computed, not set — a text box grows with its content. The H
   * field still reports it (useful) but is disabled, because typing there would
   * do nothing.
   */
  lockH?: boolean;
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
  /**
   * The selected object's frame in slide pixels, or null when the selection
   * isn't exactly one object. Unlike every other control in the rail this reads
   * the OBJECT rather than the style defaults, because a position is not a
   * style — there is nothing sensible to carry to the next thing you draw.
   */
  getGeometry?(): ObjectGeometry | null;
  /** Apply the fields present in `patch` to the selected object + commit. */
  setGeometry?(patch: Partial<ObjectGeometry>): void;
  /** Slide rail data + operations. Absent = no rail. */
  rail?: RailHost;
  /**
   * A side rail was collapsed, expanded or resized, so the stage box changed
   * size. SlideEditor refits the canvas. Optional — the editor also runs a
   * ResizeObserver, this is just the immediate path.
   */
  onLayoutChanged?(): void;
  /** The open slide's threads — the Comments section's default scope. */
  comments(): readonly SlideComment[];
  /** Every thread in the briefing, for the "All slides" scope. */
  allComments(): Array<{ slideIndex: number; comment: SlideComment }>;
  /** Navigate to a thread — same slide opens it, another slide loads first. */
  goToComment(slideIndex: number, commentId: string): void;
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

/**
 * Named shadows, in editor pixels — the four bento offers, which cover the range
 * from "lift it off the map slightly" to "float it". `glow` is the odd one out:
 * no offset, warm colour, so a symbol or callout reads against dark imagery.
 * Anything not matching a preset reads as 'custom' in the panel.
 */
export interface ShadowSpec {
  x: number;
  y: number;
  blur: number;
  color: string;
  opacity: number;
}

export const SHADOW_PRESETS: Record<'subtle' | 'soft' | 'elevated' | 'glow', ShadowSpec> = {
  subtle: { x: 0, y: 2, blur: 10, color: '#0a101c', opacity: 0.25 },
  soft: { x: 0, y: 10, blur: 28, color: '#0a101c', opacity: 0.32 },
  elevated: { x: 0, y: 24, blur: 56, color: '#080c16', opacity: 0.45 },
  glow: { x: 0, y: 0, blur: 40, color: '#ffeed6', opacity: 0.55 },
};

export type ShadowPreset = 'none' | 'custom' | keyof typeof SHADOW_PRESETS;

/** Composite modes the Effects section offers; 'normal' clears the field. */
const BLEND_OPTIONS = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'difference',
  'exclusion',
] as const;

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
  alignJustify: svg('<path d="M4.5 6h15M4.5 10.5h15M4.5 15h15M4.5 19.5h9"/>'),
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
  comment: svg('<path d="M4 5h16v10.5H11l-4.5 3.5v-3.5H4z"/><path d="M8 8.6h8M8 11.6h5"/>'),
  /**
   * Floppy disk — Save & close. A disk rather than a checkmark: a tick reads as
   * "confirm this dialog", and this button WRITES the slide.
   */
  save: svg('<path d="M4.8 4h10.4L20 8.8V20H4.8z"/><path d="M8.6 4v5.2h6.8V4"/><rect x="8" y="13.4" width="8" height="6.6"/>'),
  /** X — Cancel. */
  close: svg('<path d="M6.4 6.4l11.2 11.2M17.6 6.4L6.4 17.6"/>'),
  /** Arrow up out of a tray — export the deck to PowerPoint. */
  exportDeck: svg('<path d="M12 3.6v9.8"/><path d="M8.5 7.1L12 3.6l3.5 3.5"/><path d="M4.8 14.6v3.2c0 1.2 1 2.2 2.2 2.2h10c1.2 0 2.2-1 2.2-2.2v-3.2"/>'),
  /** Arrow down into a tray — the mirror of exportDeck, so the pair reads as one. */
  importDeck: svg('<path d="M12 13.4V3.6"/><path d="M8.5 9.9L12 13.4l3.5-3.5"/><path d="M4.8 14.6v3.2c0 1.2 1 2.2 2.2 2.2h10c1.2 0 2.2-1 2.2-2.2v-3.2"/>'),
  /** Column chart — the insert-chart action. */
  chart: svg('<path d="M4 20V4"/><path d="M4 20h16"/><rect x="7" y="12" width="3" height="5"/><rect x="12" y="8.5" width="3" height="8.5"/><rect x="17" y="14" width="3" height="3"/>'),
  /** A slide with a banner strip top and bottom — deck setup. */
  deck: svg('<rect x="3" y="4.5" width="18" height="15" rx="1.6"/><path d="M3 8.2h18M3 15.8h18"/>'),
  /**
   * The same page, with the two strips FILLED — the header/footer visibility
   * toggle. Reads as "the bands are what this button is about", where the deck
   * icon reads as "the page's settings".
   */
  chrome: svg(
    '<rect x="3" y="4.5" width="18" height="15" rx="1.6"/>' +
      '<path d="M3 6.6h18M3 17.4h18" stroke-width="3.4"/>',
  ),
  help: svg('<circle cx="12" cy="12" r="8.8"/><path d="M9.6 9.4a2.5 2.5 0 114.3 1.8c-.9.8-1.9 1.3-1.9 2.6"/><circle cx="12" cy="17.2" r="0.9" fill="currentColor" stroke="none"/>'),
  undo: svg('<path d="M4 9.5h9.5a5.5 5.5 0 010 11H7"/><path d="M8 5L3.5 9.5 8 14"/>'),
  redo: svg('<path d="M20 9.5h-9.5a5.5 5.5 0 000 11H17"/><path d="M16 5l4.5 4.5L16 14"/>'),
  plus: svg('<path d="M12 5.5v13M5.5 12h13"/>'),
  slideshow: svg('<rect x="3" y="4.5" width="18" height="12.5" rx="1.8"/><path d="M8.5 20.5h7"/><path d="M10.6 8.8l4.6 2.6-4.6 2.6z" fill="currentColor" stroke="none"/>'),
};

/**
 * Rail-thumbnail transition badges, keyed by SlideTransitionType. Each glyph has
 * to survive being drawn at 13px in a tile corner, so they lean on one strong
 * gesture apiece — dissolving pair, direction of travel, hard wiping edge —
 * rather than detail. The label is what the tooltip says.
 */
const TRANSITION_BADGES: Record<SlideTransitionType, { icon: string; label: string }> = {
  fade: {
    label: 'Fade',
    icon: svg(
      '<rect x="2.5" y="6" width="12" height="12" rx="1.6" opacity="0.4"/>' +
        '<rect x="9.5" y="6" width="12" height="12" rx="1.6"/>',
    ),
  },
  pushLeft: {
    label: 'Push Left',
    icon: svg('<path d="M3.5 4.5v15"/><path d="M20.5 12H8.5M13.5 6.5L8 12l5.5 5.5"/>'),
  },
  pushRight: {
    label: 'Push Right',
    icon: svg('<path d="M20.5 4.5v15"/><path d="M3.5 12h12M10.5 6.5L16 12l-5.5 5.5"/>'),
  },
  wipe: {
    label: 'Wipe',
    icon: svg(
      '<rect x="3" y="5.5" width="18" height="13" rx="1.6"/>' +
        '<path d="M4 6.5h7.5v11H4z" fill="currentColor" stroke="none"/>',
    ),
  },
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
  /**
   * Extra state flag that must also be true — any boolean field of
   * ContextMenuState. Derived rather than listed, so adding a flag to the state
   * makes it usable here without a second edit (and can't go stale).
   */
  needs?: {
    [K in keyof ContextMenuState]: ContextMenuState[K] extends boolean ? K : never;
  }[keyof ContextMenuState];
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
  { act: 'link', label: 'Link…', min: 1 },
  {
    act: 'followLink',
    label: 'Go to link target',
    hint: 'Ctrl+click',
    needs: 'hasLink',
    hideWhenOff: true,
    min: 1,
  },
  { act: 'unlink', label: 'Remove link', needs: 'hasLink', hideWhenOff: true, min: 1 },
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
      ['Comment — click an annotation, a spot, or off the slide for the whole slide', 'N · Ctrl+Alt+M'],
      ['Link an object to a slide — right-click → Link…, or the 🔗 badge', '—'],
      ['Go to a link target', 'Ctrl+click the object'],
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

/**
 * Which property ROWS each selection kind offers, in the order the markup
 * declares them. Names match `data-row` on the rows themselves — several rows
 * may share one name (all of Typography is `text`), and a section disappears
 * once none of its rows survive. `ops` / `layers` / `actions` / `geo` /
 * `arrange` are selection-driven instead and handled in showPanel.
 */
const ROWS_BY_CONTEXT: Record<PanelContext['kind'], string[]> = {
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

/**
 * What the panel calls the current selection. Names the thing the user clicked,
 * the way bento's element panel leads with "Text" / "Shape" / "Table" — a
 * multi-selection overrides this with its count.
 */
const SELECTION_LABELS: Partial<Record<PanelContext['kind'], string>> = {
  text: 'Text',
  box: 'Shape',
  blockarrow: 'Block arrow',
  tacarrow: 'Tactical arrow',
  milsym: 'Military symbol',
  table: 'Table',
  linework: 'Freehand',
  line: 'Line',
  image: 'Picture',
  highlight: 'Highlight',
  arrow: 'Arrow',
  labeled: 'Shape + label',
  labeledLine: 'Line + label',
  labeledArrow: 'Arrow + label',
  mixed: 'Mixed selection',
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
  /** Go-to-slide field + the "/ n" beside it, and the values they last showed. */
  private _navNum: HTMLInputElement | null = null;
  private _navTotal: HTMLElement | null = null;
  private _navIndex = 0;
  private _navCount = 0;

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

    // ── Property-row grammar (ported from bento/slides' panels.ts) ───────────
    //
    // Every control sits in a row that names it: label on the left, control on
    // the right in a fixed column. `data-row` is the visibility key — showPanel
    // hides rows, and a section hides itself once none of its rows are left, so
    // one section can serve several kinds without going empty. Several rows may
    // share a key (all five Typography rows are `text`).
    const prow = (row: string, label: string, control: string, tip = ''): string =>
      `<label class="ms-sledit-prow" data-row="${row}"${
        tip ? ` title="${this._escape(tip)}"` : ''
      }><span>${label}</span>${control}</label>`;
    /** Icon clusters keep their own row — a <label> would fire the first button. */
    const irow = (row: string, label: string, buttons: string, tip = ''): string =>
      `<div class="ms-sledit-prow" data-row="${row}"${
        tip ? ` title="${this._escape(tip)}"` : ''
      }><span>${label}</span><span class="ms-sledit-iconset">${buttons}</span></div>`;
    /**
     * Row for a control that needs the rail's full width — a swatch strip is too
     * wide to sit beside its name, so the name goes above it instead of being
     * dropped. `cap` omitted = the control speaks for itself (the ops icons).
     */
    const wrow = (row: string, body: string, cap = ''): string =>
      `<div class="ms-sledit-wrow${cap ? ' ms-sledit-caprow' : ''}" data-row="${row}">${
        cap ? `<span class="ms-sledit-rowcap">${cap}</span>` : ''
      }${body}</div>`;
    const mini = (cls: string, label: string, tip: string): string =>
      `<label class="ms-sledit-mini2"><span>${label}</span>` +
      `<input type="number" class="${cls}" step="1" title="${this._escape(tip)}"></label>`;

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
        <input type="text" class="ms-sledit-title" placeholder="Slide title" title="Slide title (saved with the slide)">
        <span class="ms-sledit-group">
          <button data-act="undo" class="ms-sledit-iconbtn" title="Undo (Ctrl+Z)">${ICONS.undo}</button>
          <button data-act="redo" class="ms-sledit-iconbtn" title="Redo (Ctrl+Y)">${ICONS.redo}</button>
        </span>
        <span class="ms-sledit-tools">${toolButtons}<span class="ms-sledit-sep"></span><button data-act="toolLock" title="Keep the active shape tool armed after each draw — Q">${ICONS.toolLock}<kbd>Q</kbd></button></span>
        <!-- Order: things that act on THIS SLIDE (insert, comment, notes,
             transition) → commit it (Save) → things that act on the WHOLE DECK
             (Import / Export, with Deck setup alongside since it configures
             what Export produces) → leave (Close) → help, pinned last. -->
        <span class="ms-sledit-group ms-sledit-topright">
          <button data-act="insertChart" class="ms-sledit-iconbtn" title="Insert a chart — type the data in, or build it from the last Position Defensibility / OP Ranker result. Exports as a real, editable PowerPoint chart." aria-label="Insert chart">${ICONS.chart}</button>
          <button data-act="comment" class="ms-sledit-iconbtn" title="Comment (N or Ctrl+Alt+M) — click an annotation, a spot on the slide, or off the slide for the whole slide" aria-label="Comment">${ICONS.comment}</button>
          <button data-act="notes" class="ms-sledit-iconbtn" title="Toggle speaker notes — opens a drawer under the slide" aria-label="Speaker notes">${ICONS.notes}</button>
          <select class="ms-sledit-transition" title="Transition played entering this slide from another slide-view slide.">
            <option value="">Cut</option>
            <option value="fade">Fade</option>
            <option value="pushLeft">Push Left</option>
            <option value="pushRight">Push Right</option>
            <option value="wipe">Wipe</option>
          </select>
          <button data-act="save" class="ms-sledit-iconbtn primary" title="Save &amp; close — writes annotations, title and notes to the slide" aria-label="Save and close">${ICONS.save}</button>
          <span class="ms-sledit-sep"></span>
          <button data-act="deckSetup" class="ms-sledit-iconbtn" title="Deck setup — slide size, header &amp; footer, classification banner, page numbers, theme fonts, document properties, and this slide's section." aria-label="Deck setup">${ICONS.deck}</button>
          <button data-act="chromeToggle" class="ms-sledit-iconbtn active" title="Show the deck's header, footer and classification strips (view only — hiding them changes nothing about the export)" aria-label="Toggle header and footer strips" aria-pressed="true">${ICONS.chrome}</button>
          <button data-act="importDeck" class="ms-sledit-iconbtn" title="Import a PowerPoint (.pptx) — its slides are appended to this briefing as editable slides. Saves this slide first." aria-label="Import PowerPoint">${ICONS.importDeck}</button>
          <button data-act="exportDeck" class="ms-sledit-iconbtn" title="Export the whole briefing as a PowerPoint (.pptx) — saves this slide first. Uses the current Deck setup." aria-label="Export to PowerPoint">${ICONS.exportDeck}</button>
          <span class="ms-sledit-sep"></span>
          <button data-act="cancel" class="ms-sledit-iconbtn" title="Cancel — discard changes and close" aria-label="Cancel">${ICONS.close}</button>
          <button data-act="help" class="ms-sledit-iconbtn" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">${ICONS.help}</button>
        </span>
      </div>
      <div class="ms-sledit-main">
        <aside class="ms-sledit-rail">
          <div class="ms-sledit-railthumbs"></div>
          <button class="ms-sledit-addslide" title="New slide from a layout">${ICONS.plus}<span>New slide</span></button>
        </aside>
        <div class="ms-sledit-resizer" data-side="left" title="Drag to resize · double-click to reset">
          <button class="ms-sledit-paneltoggle" data-side="left" type="button"></button>
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
              <!-- Slide navigation sits with the zoom and Slideshow pills rather
                   than in the properties rail: it acts on the canvas, and the
                   rail can be collapsed away entirely. -->
              <div class="ms-sledit-navbar">
                <button data-act="prevSlide" title="Save this slide and edit the previous one">◀</button>
                <span class="ms-sledit-navcount">
                  <input type="text" class="ms-sledit-navnum" inputmode="numeric" autocomplete="off"
                         spellcheck="false" aria-label="Slide number" value="–"
                         title="Go to slide — type a number and press Enter">
                  <span class="ms-sledit-navtotal">/ –</span>
                </span>
                <button data-act="nextSlide" title="Save this slide and edit the next one">▶</button>
              </div>
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
          <button class="ms-sledit-paneltoggle" data-side="right" type="button"></button>
        </div>
        <aside class="ms-sledit-props">
          <div class="ms-sledit-slidesecs">
            <div class="ms-sledit-sec" data-sec="comments">
              <div class="ms-sledit-seclabel">Comments</div>
              <label class="ms-sledit-prow" data-row="cmtscope" title="List comments from every slide, not just this one">
                <span>All slides</span>
                <input type="checkbox" class="ms-sledit-cmtall">
              </label>
              <div class="ms-sledit-cmtlist"></div>
            </div>
          </div>
          <div class="ms-sledit-panel" style="display:none">
            <!-- What is selected, and the two things you do to it most. The
                 label is rewritten per selection by showPanel. -->
            <div class="ms-sledit-sec" data-sec="selection">
              <div class="ms-sledit-seclabel"><span class="ms-sledit-selname">Selection</span></div>
              ${wrow(
                'ops',
                `<span class="ms-sledit-iconset">
                  <button data-act="dup" title="Duplicate (Ctrl+D)">${ICONS.dup}</button>
                  <button data-act="del" title="Delete (Del)">${ICONS.del}</button>
                  <button data-act="lock" class="ms-sledit-lockbtn" title="Lock / unlock (Ctrl+Shift+L)">${ICONS.lock}</button>
                </span>`,
              )}
            </div>
            <div class="ms-sledit-sec" data-sec="fillstroke">
              <div class="ms-sledit-seclabel">Fill &amp; stroke</div>
              ${wrow('fill', swatchRow('fill', FILL_SWATCHES), 'Fill')}
              ${prow(
                'fillop',
                'Fill opacity',
                '<input type="range" class="ms-sledit-fillop" min="0" max="100" step="5">',
              )}
              ${wrow('stroke', swatchRow('stroke', STROKE_SWATCHES), 'Stroke')}
              ${irow(
                'width',
                'Stroke width',
                `<button data-width="2" title="Thin">${ICONS.wThin}</button>
                 <button data-width="4" title="Medium">${ICONS.wMed}</button>
                 <button data-width="8" title="Thick">${ICONS.wThick}</button>
                 <input type="number" class="ms-sledit-strokew" min="1" max="64" step="1" title="Width (px)">`,
              )}
              ${irow(
                'dash',
                'Line style',
                `<button data-dash="solid" title="Solid">${ICONS.dashSolid}</button>
                 <button data-dash="dashed" title="Dashed">${ICONS.dashDashed}</button>
                 <button data-dash="dotted" title="Dotted">${ICONS.dashDotted}</button>`,
              )}
            </div>
            <div class="ms-sledit-sec" data-sec="typography">
              <div class="ms-sledit-seclabel">Typography</div>
              ${prow(
                'text',
                'Font',
                // Shared with the deck's theme fonts — one curated,
                // PowerPoint-safe list rather than two that can drift.
                `<select class="ms-sledit-font" title="Font family — these ship with Office on Windows and macOS, so an exported deck renders as authored">
                  ${SAFE_FONTS.map((f) => `<option>${f}</option>`).join('')}
                </select>`,
              )}
              ${prow(
                'text',
                'Size (px)',
                '<input type="number" class="ms-sledit-fontsize" min="8" max="120" step="1" title="Font size (px)">',
              )}
              ${irow(
                'text',
                'Weight',
                `<button data-style="bold" title="Bold"><b>B</b></button>
                 <button data-style="italic" title="Italic"><i>I</i></button>
                 <button data-style="underline" title="Underline"><u>U</u></button>`,
              )}
              ${irow(
                'text',
                'Align',
                `<button data-align="left" title="Align left">${ICONS.alignLeft}</button>
                 <button data-align="center" title="Align center">${ICONS.alignCenter}</button>
                 <button data-align="right" title="Align right">${ICONS.alignRight}</button>
                 <button data-align="justify" title="Justify — stretch every line but the last to the box width">${ICONS.alignJustify}</button>`,
              )}
              ${wrow('text', swatchRow('text', TEXT_SWATCHES), 'Color')}
              ${irow(
                'list',
                'List',
                `<button data-list="bullet" title="Bulleted list — every line becomes an item. Exports as a real PowerPoint list">${ICONS.bulletList}</button>
                 <button data-list="number" title="Numbered list — renumbers itself as you edit. Exports as a real PowerPoint list">${ICONS.numberList}</button>`,
              )}
            </div>
            <div class="ms-sledit-sec" data-sec="linearrow">
              <div class="ms-sledit-seclabel">Line &amp; arrow</div>
              <!-- The "Arrow type" label becomes "Line type" on a line — see showPanel. -->
              ${irow(
                'arrowtype',
                'Arrow type',
                `<button data-arrowtype="sharp" title="Sharp">${ICONS.arrowSharp}</button>
                 <button data-arrowtype="curved" title="Curved">${ICONS.arrowCurved}</button>
                 <button data-arrowtype="elbow" title="Elbow">${ICONS.arrowElbow}</button>`,
              )}
              ${prow(
                'arrowheads',
                'Start',
                `<select class="ms-sledit-arrowstart" title="Terminator at the arrow's first point">${headOptions}</select>`,
              )}
              ${prow(
                'arrowheads',
                'End',
                `<select class="ms-sledit-arrowend" title="Terminator at the arrow's last point">${headOptions}</select>`,
              )}
              ${prow(
                'headratio',
                'Head size',
                '<input type="range" class="ms-sledit-headratio" min="5" max="200" step="5">',
                "Head length — a block arrow measures it against its height (PowerPoint's own scale), a tactical arrow against its spine",
              )}
              ${irow(
                'tacbody',
                'Body',
                `<input type="number" class="ms-sledit-tacwidth" min="4" max="240" step="2" title="Body thickness (px)">
                 <button data-style="taper" title="Taper the body toward the tail">${ICONS.taper}</button>`,
              )}
              ${irow(
                'closepath',
                'Path',
                `<button data-style="closed" class="ms-sledit-closedbtn" title="Close the path into a fillable polygon">${ICONS.polygon}</button>`,
                'Closed paths take a fill; open ones ignore it',
              )}
            </div>
            <div class="ms-sledit-sec" data-sec="symbol">
              <div class="ms-sledit-seclabel">Symbol</div>
              ${prow(
                'milsym',
                'Identity',
                `<select class="ms-sledit-symaff" title="Standard identity — recolours the frame">${affiliationOptions}</select>`,
              )}
              ${prow(
                'milsym',
                'Status',
                `<select class="ms-sledit-symstatus" title="Present or planned (dashed frame)">${statusOptions}</select>`,
              )}
              ${prow(
                'milsym',
                'Echelon',
                `<select class="ms-sledit-symech" title="Echelon">${echelonOptions}</select>`,
              )}
              ${prow(
                'milsym',
                'HQ / TF',
                `<select class="ms-sledit-symhq" title="Headquarters / task force / dummy">${hqOptions}</select>`,
              )}
              ${prow(
                'milsym',
                'Size (px)',
                '<input type="number" class="ms-sledit-symsize" min="12" max="600" step="4" title="Symbol height (px)">',
              )}
              ${wrow(
                'amplifiers',
                `<button data-act="amplifiers" class="ms-sledit-wide" title="Edit the symbol's text amplifiers — unique designation, higher formation, DTG…">Amplifiers…</button>`,
              )}
            </div>
            <div class="ms-sledit-sec" data-sec="table">
              <div class="ms-sledit-seclabel">Table</div>
              ${irow(
                'table',
                'Rows / cols',
                `<button data-act="tableRowAdd" title="Add a row at the bottom">${ICONS.rowAdd}</button>
                 <button data-act="tableRowDel" title="Remove the last row">${ICONS.rowDel}</button>
                 <button data-act="tableColAdd" title="Add a column on the right">${ICONS.colAdd}</button>
                 <button data-act="tableColDel" title="Remove the last column">${ICONS.colDel}</button>`,
              )}
              ${irow(
                'table',
                'Header row',
                `<button data-style="headerRow" title="Style the first row as a header">H</button>
                 <input type="color" class="ms-sledit-headerfill" title="Header row fill">`,
              )}
              ${irow(
                'table',
                'Merge',
                `<button data-act="tableMergeRow" title="Merge the whole first row into one cell — a spanning title bar">Row</button>
                 <button data-act="tableMergeCol" title="Merge the whole first column into one cell">Col</button>
                 <button data-act="tableUnmerge" title="Split every merged cell back into single cells">Split</button>`,
              )}
              ${irow(
                'table',
                'Auto-page',
                `<button data-act="tableAutoPage" title="Let this table continue onto new slides when it overflows (PowerPoint auto-paging). Ignored on decks that use slide links, because paging would repoint them.">Flow</button>`,
              )}
            </div>
            <!-- Geometry is the one section that reads the OBJECT, not the style
                 defaults: host.getGeometry()/setGeometry() talk to the canvas. -->
            <div class="ms-sledit-sec" data-sec="geometry">
              <div class="ms-sledit-seclabel">Position &amp; size</div>
              <div class="ms-sledit-grid2" data-row="geo">
                ${mini('ms-sledit-geo-x', 'X', 'Left edge, in slide pixels')}
                ${mini('ms-sledit-geo-y', 'Y', 'Top edge, in slide pixels')}
                ${mini('ms-sledit-geo-w', 'W', 'Width, in slide pixels')}
                ${mini('ms-sledit-geo-h', 'H', 'Height, in slide pixels')}
              </div>
              ${prow(
                'geo',
                'Angle',
                '<input type="number" class="ms-sledit-geo-a" step="1" title="Rotation, in degrees">',
              )}
              ${prow(
                'opacity',
                'Opacity',
                '<input type="range" class="ms-sledit-op" min="10" max="100" step="5">',
              )}
            </div>
            <div class="ms-sledit-sec" data-sec="effects">
              <div class="ms-sledit-seclabel">Effects</div>
              ${prow(
                'shadow',
                'Shadow',
                `<select class="ms-sledit-shadow" title="Drop shadow preset">${[
                  'none',
                  ...Object.keys(SHADOW_PRESETS),
                  'custom',
                ]
                  .map(
                    (k) =>
                      `<option value="${k}">${k[0].toUpperCase()}${k.slice(1)}</option>`,
                  )
                  .join('')}</select>`,
              )}
              <!-- Concrete values, always shown: editing one turns a preset into
                   'custom' on the next refresh, which is exactly bento's rule. -->
              <div class="ms-sledit-grid2" data-row="shadowvals">
                ${mini('ms-sledit-shx', 'X', 'Shadow offset X (px)')}
                ${mini('ms-sledit-shy', 'Y', 'Shadow offset Y (px)')}
              </div>
              ${irow(
                'shadowvals',
                'Blur',
                `<input type="number" class="ms-sledit-shblur" min="0" max="200" step="1" title="Shadow blur (px)">
                 <input type="color" class="ms-sledit-shcolor" title="Shadow color">
                 <input type="number" class="ms-sledit-shop" min="0" max="100" step="5" title="Shadow opacity (%)">`,
              )}
              ${prow(
                'blur',
                'Image blur',
                '<input type="range" class="ms-sledit-blur" min="0" max="100" step="5" title="Gaussian blur — pictures only">',
              )}
              ${prow(
                'blend',
                'Blend',
                `<select class="ms-sledit-blend" title="Composite mode. Drawn in the editor and in present mode; a native PowerPoint shape cannot carry it, so the export drops it.">${BLEND_OPTIONS.map(
                  (b) => `<option value="${b}">${b[0].toUpperCase()}${b.slice(1)}</option>`,
                ).join('')}</select>`,
              )}
            </div>
            <!-- Where a click on this object goes in present mode. The chip is a
                 read-only summary that opens the dialog; ✕ clears the link. -->
            <div class="ms-sledit-sec" data-sec="link">
              <div class="ms-sledit-seclabel">Link</div>
              ${irow(
                'link',
                'Click',
                `<button class="ms-sledit-linkchip" data-act="link" title="Choose the slide this object jumps to when clicked in present mode">No link</button>
                 <button class="ms-sledit-linkclear" data-act="unlink" title="Remove link">✕</button>`,
              )}
            </div>
            <div class="ms-sledit-sec" data-sec="arrange">
              <div class="ms-sledit-seclabel">Arrange</div>
              ${irow(
                'arrange',
                'Align',
                `<button data-act="alignLeft" data-need="2" title="Align left edges">${ICONS.objAlignLeft}</button>
                 <button data-act="alignCenterH" data-need="2" title="Align horizontal centers">${ICONS.objAlignCenterH}</button>
                 <button data-act="alignRight" data-need="2" title="Align right edges">${ICONS.objAlignRight}</button>
                 <button data-act="alignTop" data-need="2" title="Align top edges">${ICONS.objAlignTop}</button>
                 <button data-act="alignCenterV" data-need="2" title="Align vertical centers">${ICONS.objAlignCenterV}</button>
                 <button data-act="alignBottom" data-need="2" title="Align bottom edges">${ICONS.objAlignBottom}</button>`,
              )}
              ${irow(
                'arrange',
                'Space',
                `<button data-act="distributeH" data-need="3" title="Distribute horizontally">${ICONS.distributeH}</button>
                 <button data-act="distributeV" data-need="3" title="Distribute vertically">${ICONS.distributeV}</button>`,
              )}
              ${irow(
                'layers',
                'Order',
                `<button data-act="back" title="Send to back (Ctrl+Shift+[)">${ICONS.layerBack}</button>
                 <button data-act="backward" title="Send backward (Ctrl+[)">${ICONS.layerBackward}</button>
                 <button data-act="forward" title="Bring forward (Ctrl+])">${ICONS.layerForward}</button>
                 <button data-act="front" title="Bring to front (Ctrl+Shift+])">${ICONS.layerFront}</button>`,
              )}
              ${irow(
                'actions',
                'Group',
                `<button data-act="group" data-need="2" title="Group (Ctrl+G)">${ICONS.group}</button>
                 <button data-act="ungroup" title="Ungroup (Ctrl+Shift+G)">${ICONS.ungroup}</button>
                 <button data-act="flipH" title="Flip horizontal (Shift+H)">${ICONS.flipH}</button>
                 <button data-act="flipV" title="Flip vertical (Shift+V)">${ICONS.flipV}</button>`,
              )}
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
    this._navNum = stage.querySelector('.ms-sledit-navnum') as HTMLInputElement;
    this._navTotal = stage.querySelector('.ms-sledit-navtotal') as HTMLElement;
    const cmtAll = stage.querySelector('.ms-sledit-cmtall') as HTMLInputElement | null;
    if (cmtAll) cmtAll.onchange = () => this.refreshComments();
    this.titleInput = stage.querySelector('.ms-sledit-title') as HTMLInputElement;
    this._notesBar = stage.querySelector('.ms-sledit-notesbar') as HTMLElement;
    this.notesArea = stage.querySelector('.ms-sledit-notes') as HTMLTextAreaElement;
    this.transitionSelect = stage.querySelector('.ms-sledit-transition') as HTMLSelectElement;
    // The open tile's transition badge reads this control, so it has to redraw
    // as soon as the choice changes rather than waiting for the save.
    this.transitionSelect.onchange = () => this.refreshRail();
    this.titleInput.value = slide.title ?? '';
    this.syncNotes(slide);
    this.syncTransitionControl(slide);

    this._wireBar();
    this._wireNavCount();
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

  /**
   * The counter doubles as a go-to-slide field. Enter is the only thing that
   * commits — Escape and losing focus put the current number back — because
   * navigating saves the open slide, which is too much to hand to a stray click
   * somewhere else in the chrome. Out-of-range entries clamp to the deck.
   */
  private _wireNavCount(): void {
    const el = this._navNum;
    if (!el) return;
    const rail = this._host.rail;
    if (!rail) {
      // No slide list to jump around in — the arrows still work, so leave the
      // number as the readout it was.
      el.readOnly = true;
      el.tabIndex = -1;
      el.title = 'Slide number';
      return;
    }
    const revert = () => {
      el.value = this._navCount ? String(this._navIndex + 1) : '–';
    };
    el.onfocus = () => el.select();
    el.onblur = revert;
    el.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const n = parseInt(el.value, 10);
        // Blur first: it reverts the field, so a rejected or clamped entry is
        // never left sitting there, and updateNav repaints it after the jump.
        el.blur();
        if (!this._navCount || !Number.isFinite(n)) return;
        const to = Math.min(Math.max(n, 1), this._navCount) - 1;
        if (to !== this._navIndex) rail.go(to);
      } else if (e.key === 'Escape') {
        // The stage's own Escape handler does the blur (see SlideEditor's key
        // ladder); this just drops the typed text before focus leaves.
        revert();
      }
    };
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
      // The chevron points where clicking will move the boundary. A data-dir
      // rather than textContent: the button's marks are pseudo-elements, and
      // writing text into it would sit a stray glyph between them.
      btn.dataset.dir =
        side === 'left' ? (collapsed ? 'right' : 'left') : collapsed ? 'left' : 'right';
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
        // Every tile but the open one reads its count from `slides()` — the
        // persisted copy BriefingEngine holds. The open slide's threads live
        // in the editor's unsaved working array instead (host.comments()):
        // resolving/adding/deleting a thread only reaches the persisted list
        // on the next save, so reading `s.openComments` for the current tile
        // would show a stale count until then.
        const open = i === current ? openCount(this._host.comments()) : s.openComments;
        const badge = open
          ? `<span class="ms-sledit-thumbcmt" title="${open} open comment(s)">${open}</span>`
          : '';
        // Same reasoning as the comment count: the open slide's transition is
        // whatever the top-bar combo says, which only reaches the slide on save.
        const trans = i === current ? this._pickedTransition() : s.slideTransition;
        const tb = trans ? TRANSITION_BADGES[trans] : undefined;
        const transBadge = tb
          ? `<span class="ms-sledit-thumbtrans" title="Transition in: ${tb.label}">${tb.icon}</span>`
          : '';
        return `<div class="ms-sledit-thumb${i === current ? ' active' : ''}${
          s.hidden ? ' ms-hidden-slide' : ''
        }" data-i="${i}" draggable="true" title="${label}${
          s.hidden ? ' — hidden, skipped in playback' : ''
        }">
            <span class="ms-sledit-thumbnum">${i + 1}</span>
            ${badge}
            ${transBadge}
            <span class="ms-sledit-thumbtools">
              <button data-rail="hide" data-i="${i}" title="${
                s.hidden ? 'Hidden — click to show in playback' : 'Hide this slide from playback'
              }">${s.hidden ? '🚫' : '👁'}</button>
              <button data-rail="dup" data-i="${i}" title="Duplicate this slide">⧉</button>
              <button data-rail="del" data-i="${i}" title="Delete this slide">✕</button>
            </span>
            ${face}
          </div>`;
      })
      .join('');
    box.scrollTop = scroll;
    // Holding the scroll position means the tile you just navigated to can be
    // off-screen in a long deck, so pull it back — 'nearest' is a no-op when it
    // is already visible, which keeps the strip still during comment refreshes.
    (box.children[current] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
    this._wireRailTiles();
  }

  /**
   * The transition the open slide will be saved with: the top-bar combo's own
   * value, since it only reaches the slide on save. Disabled means a map-view
   * slide, whose stored value never plays (see syncTransitionControl) — no badge
   * for those, matching what BriefingEngine reports for the other tiles.
   */
  private _pickedTransition(): SlideTransitionType | undefined {
    const sel = this.transitionSelect;
    if (!sel || sel.disabled) return undefined;
    return (sel.value || undefined) as SlideTransitionType | undefined;
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
        else if (tool.dataset.rail === 'hide') rail.toggleHidden(i);
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

  // ── Comments ───────────────────────────────────────────────────────────────

  /** Redraw the Comments review section for the current scope. */
  public refreshComments(): void {
    const box = this._stage?.querySelector('.ms-sledit-cmtlist') as HTMLElement | null;
    if (!box) return;
    const all = (this._stage?.querySelector('.ms-sledit-cmtall') as HTMLInputElement)?.checked;
    const rows = all
      ? this._host.allComments()
      : this._host.comments().map((comment) => ({ slideIndex: -1, comment }));
    if (!rows.length) {
      box.innerHTML = `<div class="ms-sledit-cmtempty">No comments${
        all ? '' : ' on this slide'
      } yet — press N and click.</div>`;
      return;
    }
    box.innerHTML = rows
      .map(({ slideIndex, comment: c }) => {
        const replies = c.replies?.length ?? 0;
        const where = c.overlayId ? 'annotation' : typeof c.x === 'number' ? 'point' : 'slide';
        return (
          `<button class="ms-sledit-cmtrow${c.resolved ? ' resolved' : ''}"` +
          ` data-cmt-id="${this._escape(c.id)}" data-cmt-slide="${slideIndex}">` +
          `<span class="ms-sledit-cmtrowhead"><b>${this._escape(c.author)}</b>` +
          `<i>${all && slideIndex >= 0 ? `slide ${slideIndex + 1} · ` : ''}${where}` +
          `${replies ? ` · ${replies} repl${replies === 1 ? 'y' : 'ies'}` : ''}</i></span>` +
          `<span class="ms-sledit-cmtrowtext">${this._escape(c.text.slice(0, 120))}</span>` +
          '</button>'
        );
      })
      .join('');
    box.onclick = (e) => {
      const row = (e.target as HTMLElement).closest('[data-cmt-id]') as HTMLElement | null;
      if (!row) return;
      this._host.goToComment(Number(row.dataset.cmtSlide), row.dataset.cmtId!);
    };
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
    // ── Effects ──────────────────────────────────────────────────────────────
    bind('.ms-sledit-shadow', 'change', (el) => {
      const preset = el.value as ShadowPreset;
      d().shadowPreset = preset;
      // Picking a named shadow stamps its numbers, so the value fields below
      // always describe what is actually drawn. 'none' and 'custom' name no
      // numbers of their own, so they keep whatever is there.
      const p = preset === 'none' || preset === 'custom' ? undefined : SHADOW_PRESETS[preset];
      if (p) {
        d().shadowXPx = p.x;
        d().shadowYPx = p.y;
        d().shadowBlurPx = p.blur;
        d().shadowColor = p.color;
        d().shadowOpacity = p.opacity;
      }
      this._host.onStyleChanged('shadowPreset');
      this.refreshPanelValues();
    });
    const shadowNum = (sel: string, key: 'shadowXPx' | 'shadowYPx' | 'shadowBlurPx') =>
      bind(sel, 'change', (el) => {
        const v = parseFloat(el.value);
        if (!Number.isFinite(v)) return this.refreshPanelValues();
        d()[key] = key === 'shadowBlurPx' ? Math.max(0, v) : v;
        d().shadowPreset = 'custom';
        this._host.onStyleChanged(key);
        this.refreshPanelValues();
      });
    shadowNum('.ms-sledit-shx', 'shadowXPx');
    shadowNum('.ms-sledit-shy', 'shadowYPx');
    shadowNum('.ms-sledit-shblur', 'shadowBlurPx');
    bind('.ms-sledit-shcolor', 'input', (el) => {
      d().shadowColor = el.value;
      d().shadowPreset = 'custom';
      this._host.onStyleChanged('shadowColor');
    });
    bind('.ms-sledit-shop', 'change', (el) => {
      const v = parseFloat(el.value);
      if (!Number.isFinite(v)) return this.refreshPanelValues();
      d().shadowOpacity = Math.min(1, Math.max(0, v / 100));
      d().shadowPreset = 'custom';
      this._host.onStyleChanged('shadowOpacity');
      this.refreshPanelValues();
    });
    bind('.ms-sledit-blur', 'input', (el) => {
      d().blurPct = Math.max(0, Math.min(100, Number(el.value) || 0));
      this._host.onStyleChanged('blurPct');
    });
    bind('.ms-sledit-blend', 'change', (el) => {
      d().blend = el.value as StyleDefaults['blend'];
      this._host.onStyleChanged('blend');
    });

    // Geometry commits on `change` (blur / Enter / stepper), never on `input` —
    // rewriting the frame per keystroke would fight a half-typed number and
    // stack one undo entry per digit.
    const geoField = (sel: string, key: keyof ObjectGeometry, min?: number) =>
      bind(sel, 'change', (el) => {
        const v = parseFloat(el.value);
        if (!Number.isFinite(v)) return this.refreshGeometry(); // put the old value back
        this._host.setGeometry?.({ [key]: min == null ? v : Math.max(min, v) });
        this.refreshGeometry();
      });
    geoField('.ms-sledit-geo-x', 'x');
    geoField('.ms-sledit-geo-y', 'y');
    geoField('.ms-sledit-geo-w', 'w', 1);
    geoField('.ms-sledit-geo-h', 'h', 1);
    geoField('.ms-sledit-geo-a', 'angle');
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
    this._navIndex = index;
    this._navCount = count;
    if (this._navNum) this._navNum.value = String(index + 1);
    if (this._navTotal) this._navTotal.textContent = `/ ${count}`;
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

  /**
   * Show/hide the island for the given context. Visibility is decided per ROW
   * (`data-row`), then each section shows itself only if it still has a visible
   * row — that is what lets one "Fill & stroke" group serve a box, a table and
   * an open line without ever standing there empty.
   */
  public showPanel(ctx: PanelContext): void {
    this._ctx = ctx;
    const panel = this._panel;
    if (!panel) return;
    const rows = ROWS_BY_CONTEXT[ctx.kind];
    if (!rows.length) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = '';
    panel.querySelectorAll('[data-row]').forEach((el: any) => {
      const name = el.dataset.row as string;
      const visible =
        rows.includes(name) ||
        ((name === 'ops' || name === 'layers' || name === 'actions') && ctx.hasSelection) ||
        // A link belongs to an object, so it is offered on a selection only —
        // never as a tool default, which would have nothing to attach to.
        (name === 'link' && ctx.hasSelection) ||
        // Effects are offered on a SELECTION only, never on tool defaults: an
        // object is created without them, so an armed-tool shadow would sit
        // there looking set and do nothing. Every kind can carry them, so they
        // stay out of ROWS_BY_CONTEXT. Blur is a fabric image filter — there is
        // no vector equivalent, hence the extra kind test.
        ((name === 'shadow' || name === 'shadowvals' || name === 'blend') && ctx.hasSelection) ||
        (name === 'blur' && ctx.hasSelection && ctx.kind === 'image') ||
        // Geometry is single-object: a multi-selection has no one frame to show.
        (name === 'geo' && ctx.count === 1) ||
        (name === 'arrange' && ctx.count > 1) ||
        // An open line can't show a fill it would ignore.
        ((name === 'fill' || name === 'fillop') &&
          ctx.closed &&
          (ctx.kind === 'line' || ctx.kind === 'labeledLine'));
      el.style.display = visible ? '' : 'none';
    });
    let firstShown = true;
    panel.querySelectorAll('.ms-sledit-sec').forEach((sec: any) => {
      const visible = Array.from(sec.querySelectorAll('[data-row]')).some(
        (r: any) => r.style.display !== 'none',
      );
      sec.style.display = visible ? '' : 'none';
      // Rule above every section except the first one actually on screen. A CSS
      // adjacent-sibling selector can't express this: a display:none section
      // still matches as a sibling, so the first visible section would inherit
      // a stray divider from whatever is hidden above it.
      sec.classList.toggle('ms-sledit-sec-divided', visible && !firstShown);
      if (visible) firstShown = false;
    });
    const selName = panel.querySelector('.ms-sledit-selname');
    if (selName) {
      selName.textContent =
        ctx.count > 1 ? `${ctx.count} elements` : SELECTION_LABELS[ctx.kind] ?? 'Selection';
    }
    // Geometry and opacity share a section, but a multi-selection shows only the
    // opacity row — so the header says what is actually under it.
    const geoLabel = panel.querySelector('.ms-sledit-sec[data-sec="geometry"] .ms-sledit-seclabel');
    if (geoLabel) geoLabel.textContent = ctx.count === 1 ? 'Position & size' : 'Opacity';
    // The shape control is shared by arrows and lines — name it for whichever
    // is selected rather than always saying "Arrow type".
    const shapeLabel = panel.querySelector('[data-row="arrowtype"] > span');
    if (shapeLabel) {
      shapeLabel.textContent =
        ctx.kind === 'line' || ctx.kind === 'labeledLine' ? 'Line type' : 'Arrow type';
    }
    // A tactical arrow's heads are on/off, not shaped — the terminator kind is
    // ignored, so say what the control actually does here.
    panel.querySelectorAll('[data-row="arrowheads"]').forEach((el: any) => {
      el.title =
        ctx.kind === 'tacarrow'
          ? 'Tactical arrows draw a fixed head — only None (no head) differs here'
          : 'Terminator drawn at this end of the arrow';
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
    const shadowSel = q('.ms-sledit-shadow');
    if (shadowSel) shadowSel.value = d.shadowPreset;
    const shx = q('.ms-sledit-shx');
    if (shx) shx.value = String(Math.round(d.shadowXPx));
    const shy = q('.ms-sledit-shy');
    if (shy) shy.value = String(Math.round(d.shadowYPx));
    const shblur = q('.ms-sledit-shblur');
    if (shblur) shblur.value = String(Math.round(d.shadowBlurPx));
    const shcolor = q('.ms-sledit-shcolor');
    if (shcolor) shcolor.value = d.shadowColor;
    const shop = q('.ms-sledit-shop');
    if (shop) shop.value = String(Math.round(d.shadowOpacity * 100));
    const blurEl = q('.ms-sledit-blur');
    if (blurEl) blurEl.value = String(Math.round(d.blurPct));
    const blendEl = q('.ms-sledit-blend');
    if (blendEl) blendEl.value = d.blend;
    // The concrete shadow numbers only appear once there is a shadow to
    // describe — same as bento, and it keeps the section quiet by default. Runs
    // after showPanel's row pass (it calls this last), so this decision wins.
    const showVals = this._ctx.hasSelection && d.shadowPreset !== 'none';
    panel.querySelectorAll('[data-row="shadowvals"]').forEach((el: any) => {
      el.style.display = showVals ? '' : 'none';
    });
    this.refreshGeometry();
  }

  /**
   * Push the selected object's frame into the Position & size fields. Separate
   * from refreshPanelValues so the canvas can call it on every drag/scale/rotate
   * without re-syncing forty style controls — and it skips a field the user is
   * currently typing in, which would otherwise fight the caret.
   */
  public refreshGeometry(): void {
    const panel = this._panel;
    if (!panel) return;
    const geo = this._host.getGeometry?.() ?? null;
    const active = document.activeElement;
    const put = (sel: string, v: number | undefined) => {
      const el = panel.querySelector(sel) as HTMLInputElement | null;
      if (!el || el === active) return;
      el.value = v == null ? '' : String(Math.round(v * 10) / 10);
      el.disabled = v == null;
    };
    put('.ms-sledit-geo-x', geo?.x);
    put('.ms-sledit-geo-y', geo?.y);
    put('.ms-sledit-geo-w', geo?.w);
    put('.ms-sledit-geo-h', geo?.h);
    put('.ms-sledit-geo-a', geo?.angle);
    const hField = panel.querySelector('.ms-sledit-geo-h') as HTMLInputElement | null;
    if (hField && geo?.lockH) {
      hField.disabled = true;
      hField.title = 'Height follows the text — type into the box, or drag a corner';
    } else if (hField) {
      hField.title = 'Height, in slide pixels';
    }
  }

  /**
   * Put the selection's link into the panel's chip row. `label` is what
   * SlideLinks.linkLabel produced (or a mixed-selection note); `linked` gates
   * the ✕. Called on every selection change and after the dialog applies, the
   * same way refreshGeometry keeps the frame fields honest.
   */
  public setLinkChip(label: string, linked: boolean): void {
    const panel = this._panel;
    if (!panel) return;
    const chip = panel.querySelector('.ms-sledit-linkchip') as HTMLElement | null;
    const clear = panel.querySelector('.ms-sledit-linkclear') as HTMLButtonElement | null;
    if (chip) {
      chip.textContent = label;
      // Deliberately NOT `.active`: that class means "toggled on" in this panel
      // and fills the button with the accent colour, which a value chip must not
      // inherit (its text then sits light-on-light).
      chip.classList.toggle('linked', linked);
    }
    if (clear) clear.disabled = !linked;
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

  /**
   * Reflect the header/footer strip visibility toggle. `aria-pressed` as well as
   * a class: it is a two-state control, and the class alone says nothing to a
   * screen reader.
   */
  public setChromeVisible(on: boolean): void {
    const btn = this._bar?.querySelector('[data-act="chromeToggle"]') as HTMLElement | null;
    btn?.classList.toggle('active', on);
    btn?.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  /** Reflect the 💬 comment tool's armed state in the topbar. */
  public setCommentMode(on: boolean): void {
    const btn = this._bar?.querySelector('[data-act="comment"]') as HTMLElement | null;
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
        --sl-text: var(--ms-text, #dde3e8);
        --sl-dim: var(--ms-text-dim, #8a97a5);
        --sl-accent: var(--ms-accent, #64b4ff);
        --sl-radius: var(--ms-radius, 9px);
        /* Collapse marks, drawn as masks painted in currentColor rather than as
           text: the ▾ / ‹ glyphs sat a pixel off-centre and moved with whatever
           font --ms-menu-font resolves to. Both rest pointing DOWN — rotation is
           what aims them, so one token serves the section headers and the rails. */
        --sl-chev: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="black" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>');
        --sl-grip: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 17"><circle cx="1.5" cy="1.5" r="1.5"/><circle cx="1.5" cy="8.5" r="1.5"/><circle cx="1.5" cy="15.5" r="1.5"/></svg>');

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
        width: var(--railw, 188px); flex: none;
        background: var(--sl-surface);
        background-image: linear-gradient(var(--sl-tint), var(--sl-tint));
      }
      .ms-sledit-rail {
        border-right: 1px solid var(--sl-line);
        display: flex; flex-direction: column; gap: 10px; padding: 12px;
        /* The rail itself never scrolls — the thumbnail strip inside it does.
           Scrolling the whole column would carry ＋ New slide off the bottom
           (and, since the strip overflows visibly, bury it under the tiles). */
        overflow: hidden;
      }
      .ms-sledit-props {
        width: var(--railw, 236px); overflow-y: auto;
        border-left: 1px solid var(--sl-line); padding: 12px 14px 20px;
      }
      /* Both scrollers wear a slim overlay-style bar instead of the platform's
         wide light slab, which reads as a seam beside 188px of thumbnails. The
         WebKit thumb is a pill inset by a transparent border; Firefox gets the
         two-value scrollbar-color. Either way it only really shows on hover. */
      .ms-sledit-railthumbs, .ms-sledit-props {
        scrollbar-width: thin;
        scrollbar-color: rgba(255,255,255,0.14) transparent;
      }
      .ms-sledit-railthumbs:hover, .ms-sledit-props:hover {
        scrollbar-color: rgba(255,255,255,0.3) transparent;
      }
      .ms-sledit-railthumbs::-webkit-scrollbar,
      .ms-sledit-props::-webkit-scrollbar { width: 9px; background: transparent; }
      .ms-sledit-railthumbs::-webkit-scrollbar-track,
      .ms-sledit-props::-webkit-scrollbar-track { background: transparent; }
      .ms-sledit-railthumbs::-webkit-scrollbar-thumb,
      .ms-sledit-props::-webkit-scrollbar-thumb {
        background: rgba(255,255,255,0.16);
        border: 2px solid transparent; background-clip: content-box;
        border-radius: 999px;
      }
      .ms-sledit-railthumbs:hover::-webkit-scrollbar-thumb,
      .ms-sledit-props:hover::-webkit-scrollbar-thumb {
        background: rgba(255,255,255,0.3); background-clip: content-box;
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
        width: 15px; height: 44px; padding: 0; cursor: pointer; z-index: 6;
        display: flex; align-items: center; justify-content: center;
        background: var(--sl-surface); color: var(--sl-dim);
        border: 1px solid var(--sl-line); border-radius: 5px;
        font: inherit; line-height: 1;
        opacity: 0; transition: opacity 0.14s ease;
      }
      .ms-sledit-main:hover .ms-sledit-paneltoggle { opacity: 1; }
      .ms-sledit-paneltoggle:hover { color: var(--sl-text); border-color: var(--sl-accent); }
      /* Grip dots at rest, chevron once you're on it: the seam is a col-resize
         handle as much as a collapse button, and a lone chevron advertised only
         the click. The two marks are stacked and cross-faded so neither reflows
         the other — hence position: absolute rather than a swap. ::after is the
         shared down chevron; data-dir aims it where the boundary will move. */
      .ms-sledit-paneltoggle::before,
      .ms-sledit-paneltoggle::after {
        content: ''; position: absolute; background: currentColor;
        -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
        -webkit-mask-position: center; mask-position: center;
        -webkit-mask-size: contain; mask-size: contain;
        transition: opacity 0.14s ease;
      }
      .ms-sledit-paneltoggle::before {
        width: 3px; height: 17px;
        -webkit-mask-image: var(--sl-grip); mask-image: var(--sl-grip);
      }
      .ms-sledit-paneltoggle::after {
        width: 11px; height: 11px; opacity: 0;
        -webkit-mask-image: var(--sl-chev); mask-image: var(--sl-chev);
      }
      .ms-sledit-paneltoggle[data-dir="left"]::after { transform: rotate(90deg); }
      .ms-sledit-paneltoggle[data-dir="right"]::after { transform: rotate(-90deg); }
      .ms-sledit-paneltoggle:hover::before { opacity: 0; }
      .ms-sledit-paneltoggle:hover::after { opacity: 1; }

      /* ————— slide rail ————— */

      .ms-sledit-railthumbs {
        display: flex; flex-direction: column; align-items: center; gap: 9px;
        flex: 1; min-height: 0;
        /* Takes the height the ＋ New slide button leaves and scrolls its own
           overflow, so the button stays put however long the deck gets. The 2px
           keeps the tiles' active border off the scrollbar pill. */
        overflow-y: auto; overflow-x: hidden; padding-right: 2px;
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
      /* Bottom-right — the last free corner (number top-left, tools top-right,
         comment count bottom-left). Unlike those it keeps pointer events, so
         hovering names the transition; a <span> is not natively draggable, so
         the tile still owns the click and the reorder drag. */
      .ms-sledit-thumbtrans {
        position: absolute; bottom: 4px; right: 4px; z-index: 3;
        width: 17px; height: 17px; border-radius: 4px;
        display: flex; align-items: center; justify-content: center;
        background: rgba(8,12,18,0.78); color: var(--sl-text);
      }
      .ms-sledit-thumbtrans svg { width: 12px; height: 12px; display: block; }
      .ms-sledit-thumb.active .ms-sledit-thumbtrans { color: var(--sl-accent); }
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
      /* Hidden slide (PowerPoint's "Hide Slide"): scrim over the thumbnail only —
         z-index 1 keeps it under the number/tools/transition badges (2, 2, 3), so
         they stay legible and clickable. Struck-through number, as in the sorter.
         Its own 🚫 toggle stays out without hover, or a dimmed tile in a long rail
         gives no clue why. */
      .ms-sledit-thumb.ms-hidden-slide::before {
        content: ''; position: absolute; inset: 0; z-index: 1;
        background: rgba(8,12,18,0.66); pointer-events: none;
      }
      .ms-sledit-thumb.ms-hidden-slide:hover::before { background: rgba(8,12,18,0.32); }
      .ms-sledit-thumb.ms-hidden-slide .ms-sledit-thumbnum {
        text-decoration: line-through; color: var(--sl-dim);
      }
      .ms-sledit-thumb.ms-hidden-slide .ms-sledit-thumbtools { display: flex; }
      .ms-sledit-thumb.ms-hidden-slide .ms-sledit-thumbtools button[data-rail="dup"],
      .ms-sledit-thumb.ms-hidden-slide .ms-sledit-thumbtools button[data-rail="del"] {
        display: none;
      }
      .ms-sledit-thumb.ms-hidden-slide:hover .ms-sledit-thumbtools button { display: inline-flex; }
      /* Drop markers, drawn as an edge rather than a moving placeholder — the
         same read as the slide sorter's insertion line. Red rather than
         --sl-accent so the landing spot never gets lost among the (blue)
         active-tile border and hover states already on screen. */
      .ms-sledit-thumb.drop-before { box-shadow: 0 -3px 0 0 #ff3b30, 0 -3px 10px 0 rgba(255,59,48,0.6); }
      .ms-sledit-thumb.drop-after { box-shadow: 0 3px 0 0 #ff3b30, 0 3px 10px 0 rgba(255,59,48,0.6); }

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

      /* review comments — markers over the canvas, popover panels on body */
      .ms-sledit-thumbcmt {
        position: absolute;
        /* Bottom-left: top-left is the slide number, top-right is the
           hover-revealed duplicate/delete pair (~40px wide) — bottom-left is
           the only corner of .ms-sledit-thumb nothing else claims. Pure
           indicator, so pointer-events is off too — it must never be able to
           steal a click from a control a future layout change tucks under it. */
        bottom: 4px; left: 4px;
        min-width: 15px; height: 15px;
        padding: 0 3px;
        border-radius: 999px;
        background: var(--sl-accent);
        color: #10161d;
        font: 700 9.5px/15px inherit;
        text-align: center;
        z-index: 3;
        pointer-events: none;
      }
      ${LinkBadgeLayer.styles()}
      ${SlideChromeLayer.styles()}
      /* The strips are chrome, not content — dim them slightly while authoring
         so the eye stays on the slide, and let the toggle turn them off. */
      .ms-sledit-stagewrap .ms-chrome-layer { opacity: 0.94; }
      .ms-sledit-cmtlayer { position: absolute; overflow: hidden; pointer-events: none; z-index: 12; }
      .ms-sledit-cmtmarker {
        position: absolute;
        pointer-events: auto;
        width: 19px; height: 19px;
        border: none;
        border-radius: 50% 50% 50% 3px;
        background: var(--sl-accent);
        color: #10161d;
        font: 700 10px/19px inherit;
        text-align: center;
        padding: 0;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(3,7,12,0.45);
      }
      .ms-sledit-cmtmarker.resolved { opacity: 0.35; }
      .ms-sledit-cmtmarker:hover { transform: scale(1.15); }
      @keyframes ms-sledit-cmtpop {
        0% { transform: scale(0.3); }
        55% { transform: scale(1.35); }
        100% { transform: scale(1); }
      }
      .ms-sledit-cmtmarker.fresh { animation: ms-sledit-cmtpop 0.45s ease-out; }
      .ms-sledit-cmtpop {
        position: fixed;
        z-index: 10050;
        width: 300px;
        background: var(--sl-surface);
        border: 1px solid var(--sl-line);
        border-radius: 10px;
        box-shadow: 0 18px 44px rgba(2,5,10,0.55);
        padding: 11px 13px;
        color: var(--sl-text);
        font: 12.5px/1.45 inherit;
      }
      .ms-sledit-cmthead {
        display: flex; justify-content: space-between; align-items: baseline; gap: 8px;
        font-size: 10px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.07em; color: var(--sl-dim); margin-bottom: 8px;
      }
      .ms-sledit-cmtme {
        border: none; background: none; padding: 0; cursor: pointer;
        font: 600 10px/1.4 inherit; color: var(--sl-dim); white-space: nowrap;
      }
      .ms-sledit-cmtme:hover { color: var(--sl-text); }
      .ms-sledit-cmtentries {
        max-height: 220px; overflow-y: auto;
        display: flex; flex-direction: column; gap: 8px;
      }
      .ms-sledit-cmtentry b { font-size: 12px; }
      .ms-sledit-cmttime { font-size: 10.5px; color: var(--sl-dim); margin-left: 5px; }
      .ms-sledit-cmtentry p { margin: 2px 0 0; font-size: 12.5px; white-space: pre-wrap; }
      .ms-sledit-cmtname, .ms-sledit-cmttext, .ms-sledit-cmtreply {
        width: 100%; box-sizing: border-box; margin-top: 8px;
        font: inherit; font-size: 12.5px;
        background: var(--sl-input); color: var(--sl-text);
        border: 1px solid var(--sl-line); border-radius: 7px; padding: 6px 8px;
      }
      .ms-sledit-cmttext, .ms-sledit-cmtreply { resize: vertical; }
      .ms-sledit-cmtname:focus, .ms-sledit-cmttext:focus, .ms-sledit-cmtreply:focus {
        outline: none; border-color: var(--sl-accent);
      }
      .ms-sledit-cmtfoot { display: flex; gap: 6px; margin-top: 8px; }
      .ms-sledit-cmtfoot button {
        flex: 1; justify-content: center; padding: 5px 6px; font-size: 11.5px;
        background: var(--sl-input); color: var(--sl-text);
        border: 1px solid var(--sl-line); border-radius: 7px; cursor: pointer;
      }
      .ms-sledit-cmtfoot button:hover { background: rgba(255,255,255,0.12); }
      .ms-sledit-cmtfoot button.primary {
        background: var(--sl-accent); border-color: var(--sl-accent); color: #10161d; font-weight: 600;
      }
      .ms-sledit-cmtarmed .ms-sledit-canvaswrap,
      .ms-sledit-cmtarmed .ms-sledit-canvaswrap canvas { cursor: crosshair !important; }
      .ms-sledit-cmthl { position: absolute; pointer-events: none; z-index: 13; }
      .ms-sledit-cmthl.element {
        border: 2px dashed var(--sl-accent);
        border-radius: 5px;
        background: rgba(255,209,102,0.10);
      }
      .ms-sledit-cmthl.slide {
        border: 2px dashed var(--sl-accent);
        border-radius: 7px;
        background: rgba(255,209,102,0.05);
      }
      .ms-sledit-cmthl.pin {
        width: 0; height: 0;
        font: 600 10px/1 ui-monospace, Consolas, monospace;
        color: var(--sl-accent);
        white-space: nowrap;
        padding-left: 12px; padding-top: 2px;
      }
      .ms-sledit-cmthl.pin::before {
        content: '';
        position: absolute;
        left: -5px; top: -5px;
        width: 10px; height: 10px;
        border-radius: 50%;
        border: 2.5px solid var(--sl-accent);
        background: rgba(255,255,255,0.7);
      }
      .ms-sledit-cmtchip {
        position: absolute;
        z-index: 14;
        pointer-events: none;
        background: var(--sl-accent);
        color: #10161d;
        font: 700 10px/1 inherit;
        padding: 5px 9px;
        border-radius: 999px;
        white-space: nowrap;
        box-shadow: 0 2px 8px rgba(3,7,12,0.45);
      }
      .ms-sledit-cmtempty { font-size: 11px; color: var(--sl-dim); padding: 4px 2px 6px; }
      .ms-sledit-cmtlist { display: flex; flex-direction: column; gap: 4px; }
      .ms-sledit-cmtrow {
        display: flex; flex-direction: column; gap: 2px;
        text-align: left; width: 100%;
        background: var(--sl-input); color: var(--sl-text);
        border: 1px solid var(--sl-line); border-radius: 7px;
        padding: 5px 7px; cursor: pointer; font: inherit;
      }
      .ms-sledit-cmtrow:hover { border-color: var(--sl-accent); }
      .ms-sledit-cmtrow.resolved { opacity: 0.45; }
      .ms-sledit-cmtrowhead { display: flex; gap: 6px; align-items: baseline; }
      .ms-sledit-cmtrowhead b { font-size: 11.5px; }
      .ms-sledit-cmtrowhead i { font-size: 10px; font-style: normal; color: var(--sl-dim); }
      .ms-sledit-cmtrowtext {
        font-size: 11.5px; color: var(--sl-dim);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
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
      .ms-sledit-navbar, .ms-sledit-zoombar, .ms-sledit-presentpill {
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
      /* The first/last slide disables one arrow — it has to look spent, and stop
         answering the hover, or the pill reads as broken rather than at its end. */
      .ms-sledit-cornerbr button:disabled { opacity: 0.32; cursor: default; }
      .ms-sledit-cornerbr button:disabled:hover { background: transparent; }
      .ms-sledit-cornerbr svg { width: 15px; height: 15px; display: block; }
      .ms-sledit-zoom { min-width: 50px; justify-content: center; color: var(--sl-dim) !important; font-variant-numeric: tabular-nums; }
      /* "3 / 12", where the 3 is typeable. Carries its own padding to sit on the
         same rhythm as the arrows either side of it, and the total wears the zoom
         readout's dim ink so the editable half is the one that draws the eye. */
      .ms-sledit-navcount {
        display: inline-flex; align-items: center; gap: 3px;
        padding: 0 3px; white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .ms-sledit-navtotal { color: var(--sl-dim); }
      /* Reads as part of the readout at rest — no box until you hover or focus
         it, which is also the only cue needed that it takes typing. */
      .ms-sledit-navnum {
        width: 26px; padding: 2px 0; text-align: center;
        font: inherit; font-variant-numeric: tabular-nums;
        background: transparent; color: var(--sl-text);
        border: 1px solid transparent; border-radius: 5px;
      }
      .ms-sledit-navnum:hover { border-color: var(--sl-line); }
      .ms-sledit-navnum:focus {
        outline: none; border-color: var(--sl-accent); background: var(--sl-input);
      }
      .ms-sledit-navnum:read-only {
        color: var(--sl-dim); border-color: transparent; cursor: default;
      }
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
      .ms-sledit-notes:focus { outline: none; border-color: var(--sl-accent); background: rgba(255,255,255,0.08); }
      .ms-sledit-notes::placeholder { color: var(--sl-dim); }

      /* Collapsible sections: the whole label row is the handle — accent tick,
         chevron, then the name. Everything after the label is the body; no
         per-section wrapper markup — see _wireShell. Both marks are
         pseudo-elements on purpose: showPanel rewrites some labels with
         textContent, which would wipe a real child element. That leaves ::after
         generated last, so both are pulled ahead of the name with negative
         order — the label's own text is an anonymous flex item, which cannot be
         ordered and therefore always sits at 0. */
      .ms-sledit-seclabel {
        display: flex; align-items: center; gap: 8px;
        cursor: pointer; user-select: none;
        font-size: 10px; font-weight: 700; letter-spacing: 0.07em;
        text-transform: uppercase; color: var(--sl-dim);
        transition: color 0.14s ease;
      }
      .ms-sledit-seclabel:hover { color: var(--sl-text); }
      /* Accent tick: what turns a dim uppercase line into a section heading. */
      .ms-sledit-seclabel::before {
        content: ''; order: -2; flex: none;
        width: 3px; height: 11px; border-radius: 2px;
        background: var(--sl-accent); opacity: 0.5;
        transition: opacity 0.14s ease;
      }
      .ms-sledit-seclabel:hover::before { opacity: 1; }
      /* The open/close mark leads the name, disclosure-triangle fashion, so the
         eye meets the state before the label — and so the whole family of
         collapsing surfaces (this, the symbol picker's tree) reads the same. It
         carries no chip: painted in currentColor it brightens with the label on
         hover, which is the same signal the chip's fill was buying. */
      .ms-sledit-seclabel::after {
        content: ''; order: -1; flex: none; width: 11px; height: 11px;
        background: currentColor;
        -webkit-mask-image: var(--sl-chev); mask-image: var(--sl-chev);
        -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
        -webkit-mask-position: center; mask-position: center;
        -webkit-mask-size: contain; mask-size: contain;
        transition: transform 0.16s ease;
      }
      /* Rotated rather than swapped for '▸': the turn is what reads as opening
         and closing, and a swapped character cannot animate. */
      .ms-sledit-sec.collapsed > .ms-sledit-seclabel::after { transform: rotate(-90deg); }
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
         The rail's own gap sits above the seam and this padding below it, so the
         divider lands centred between two sections. */
      .ms-sledit-sec-divided { position: relative; padding-top: 15px; }
      /* A seam between two groups rather than a table rule: it carries its
         weight in the middle and fades out at both ends. Absolutely positioned
         so it stays out of the section's flex flow — and out of the collapsed
         rule above, which only hides real children, so a closed section keeps
         its divider. */
      .ms-sledit-sec-divided::before {
        content: ''; position: absolute; left: 0; right: 0; top: 0; height: 1px;
        background: linear-gradient(
          90deg, transparent, var(--sl-line) 20%, var(--sl-line) 80%, transparent
        );
      }
      .ms-sledit-mini { font-size: 11px; color: var(--sl-text); opacity: 0.78; }
      /* Scoped to the whole rail, not just .ms-sledit-panel: the slide-level
         sections above it (Comments) sit outside the panel and must not fall
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
      .ms-sledit-props input[type="number"] { width: 54px; text-align: center; }
      .ms-sledit-props input[type="range"] { width: 100%; margin: 0; }
      .ms-sledit-wide { width: 100% !important; }

      /* ————— property rows (bento's grammar: name left, control right) —————
         Declared after the plain control styling above so the fixed control
         column wins on source order, not on selector arithmetic. */

      .ms-sledit-props .ms-sledit-prow {
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px; min-height: 28px;
      }
      .ms-sledit-props .ms-sledit-prow > span:first-child {
        flex: none; font-size: 11.5px; color: var(--sl-text); opacity: 0.82;
      }
      /* One control column, so every row's right edge lines up down the rail.
         Sections with long option text widen it rather than truncate. */
      .ms-sledit-props .ms-sledit-prow > select,
      .ms-sledit-props .ms-sledit-prow > input,
      .ms-sledit-props .ms-sledit-prow > .ms-sledit-iconset {
        flex: none; width: var(--prow-ctl, 120px); min-width: 0; box-sizing: border-box;
      }
      .ms-sledit-props .ms-sledit-sec[data-sec="symbol"] { --prow-ctl: 138px; }
      /* Align packs six buttons into one set, so that section trades label room
         for control room and uses a smaller button. */
      .ms-sledit-props .ms-sledit-sec[data-sec="arrange"] { --prow-ctl: 170px; }
      .ms-sledit-props .ms-sledit-sec[data-sec="arrange"] .ms-sledit-iconset > button {
        width: 24px; height: 25px;
      }
      .ms-sledit-props .ms-sledit-sec[data-sec="arrange"] .ms-sledit-iconset > button svg {
        width: 15px; height: 15px;
      }
      /* The link chip is a text summary, not an icon: it takes the row's spare
         width and reads left-aligned, with the ✕ pinned beside it. */
      .ms-sledit-props .ms-sledit-sec[data-sec="link"] { --prow-ctl: 156px; }
      .ms-sledit-props .ms-sledit-linkchip {
        flex: 1; width: auto !important; min-width: 0; height: 26px;
        text-align: left; padding: 0 7px; overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap;
      }
      /* A linked chip reads as "there is a value here", not as a pressed toggle:
         accent ink on a faint accent wash, keeping the dark panel background so
         the text stays legible (~8:1). */
      .ms-sledit-props .ms-sledit-linkchip.linked {
        color: #9dc0ff;
        border-color: rgba(45,108,223,0.7);
        background: rgba(45,108,223,0.14);
      }
      .ms-sledit-props .ms-sledit-linkchip.linked:hover {
        background: rgba(45,108,223,0.24);
      }
      .ms-sledit-props .ms-sledit-linkclear { flex: none; }
      .ms-sledit-props .ms-sledit-prow > input[type="number"] { text-align: left; }
      .ms-sledit-props .ms-sledit-prow > .ms-sledit-iconset {
        display: flex; align-items: center; justify-content: flex-end; gap: 3px;
        flex-wrap: wrap; row-gap: 3px;
      }
      /* Six buttons in one set (Align) need to be tighter than the rail's
         default 30px button box. */
      .ms-sledit-props .ms-sledit-iconset > button { width: 27px; height: 26px; }
      .ms-sledit-props .ms-sledit-iconset > input[type="number"] { width: 42px; text-align: center; }
      .ms-sledit-props .ms-sledit-iconset > input[type="color"] { width: 32px; padding: 1px 2px; }
      /* Rows whose control needs the rail's full width and already reads as its
         own label: swatch strips, the Amplifiers button, the ops icons. */
      .ms-sledit-wrow { display: flex; }
      .ms-sledit-wrow > * { flex: 1; min-width: 0; }
      /* Captioned variant: name above, full-width control below. */
      .ms-sledit-caprow { flex-direction: column; gap: 5px; }
      .ms-sledit-rowcap {
        flex: none; font-size: 11.5px; color: var(--sl-text); opacity: 0.82;
      }
      .ms-sledit-props .ms-sledit-wrow > .ms-sledit-iconset { display: flex; gap: 4px; }
      .ms-sledit-props .ms-sledit-wrow > .ms-sledit-iconset > button { flex: 1; width: auto; }
      /* Geometry: two columns of labelled numbers — bento's ed-grid2. */
      .ms-sledit-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
      .ms-sledit-mini2 { display: flex; align-items: center; gap: 6px; min-width: 0; }
      .ms-sledit-mini2 > span {
        flex: none; min-width: 30px; font-size: 11px; color: var(--sl-dim);
      }
      .ms-sledit-props .ms-sledit-mini2 > input {
        flex: 1; width: auto; min-width: 0; text-align: left;
      }
      .ms-sledit-props .ms-sledit-mini2 > input:disabled { opacity: 0.4; }

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
