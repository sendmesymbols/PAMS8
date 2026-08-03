/**
 * BriefingTypes.ts
 *
 * Data model for the Briefing / Present-mode engine. Slides reference
 * graphics by their stable `graphic.attributes.id` (assigned in
 * SymbolEngine.drawSymEnd and round-tripped by SerializationEngine), so a
 * briefing survives save/load of the underlying plan.
 */

import type { ChartSpec } from './ChartFactory';
import type { DeckChrome } from './SlideChrome';

export type { ChartSpec };
export type { DeckChrome, SlideNumberFormat } from './SlideChrome';

export type ViewKind = '2d' | '3d';

export interface CapturedViewState {
  /**
   * JSON of view.extent (2D). Present when captured in a MapView.
   * Screen-only slides (imported from PPTX) carry NEITHER extent nor camera —
   * playback leaves the map untouched and backgroundDataUrl is the slide.
   */
  extent?: any;
  /** JSON of view.camera (3D). Present when captured in a SceneView. */
  camera?: any;
  /** The view.type at capture time — drives which of extent/camera to prefer. */
  capturedIn: ViewKind;
  /** 2D only. */
  rotation?: number;
}

export type BuildEffect = 'appear' | 'fade' | 'flyIn' | 'drawOn';

/**
 * When a build step fires, in a slide whose `buildMode` is 'click'. Mirrors
 * PowerPoint's On Click / With Previous / After Previous.
 *
 * - `click`      — opens a new click group: nothing happens until the briefer advances.
 * - `withPrev`   — joins the current group, starting at the group's own clock zero
 *                  (+ its `delayMs`), so it plays alongside the step before it.
 * - `afterPrev`  — joins the current group, starting where the previous step ENDS
 *                  (+ its `delayMs`), so it plays in sequence off one click.
 *
 * Absent = `click`. Ignored entirely while `buildMode` is 'auto'.
 */
export type BuildTrigger = 'click' | 'withPrev' | 'afterPrev';

/**
 * How a slide's build steps are driven in present mode.
 *
 * - `auto`  — every step is scheduled at its absolute `delayMs` from slide-enter,
 *             on one shared clock. The original (and default) behaviour.
 * - `click` — steps are grouped by their `trigger` and each group waits for the
 *             briefer to advance. Space / → / click reveal the next group; only
 *             once every group is out does advancing move to the next slide.
 */
export type SlideBuildMode = 'auto' | 'click';

/**
 * Present-mode transition played entering a screen-only ("slide view") slide
 * from another screen-only slide. Map-based slides never use this — their
 * view.goTo() pan/zoom is the transition.
 */
export type SlideTransitionType = 'fade' | 'pushLeft' | 'pushRight' | 'wipe';

export type OverlayKind =
  | 'text'
  | 'image'
  | 'table'
  | 'rect'
  | 'ellipse'
  | 'diamond'
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
  | 'highlight'
  | 'milsym'
  | 'chart';

/**
 * An arrow terminator. Filled variants paint solid in the stroke colour;
 * `*Outline` variants are hollow. `arrow` is the open two-barb V, `bar` a
 * perpendicular tick ("terminates here").
 */
export type ArrowHead =
  | 'none'
  | 'arrow'
  | 'triangle'
  | 'triangleOutline'
  | 'bar'
  | 'circle'
  | 'circleOutline'
  | 'diamond'
  | 'diamondOutline';

/**
 * A relative navigation target — PowerPoint's `ppaction://hlinkshowjump?jump=…`
 * family. Stated relatively rather than as a slide id so a nav button keeps
 * meaning "next" after the briefing is reordered in the sorter.
 *
 * `lastViewed` returns to wherever the briefer came from (PowerPoint's
 * `lastslideviewed`); `endShow` leaves present mode.
 */
export type LinkJump = 'next' | 'prev' | 'first' | 'last' | 'lastViewed' | 'endShow';

/**
 * A click target on an annotation — PowerPoint's "link on this shape", stored
 * at object level rather than per text run, and emitted as a real
 * `a:hlinkClick` on the shape's `p:cNvPr`.
 *
 * Exactly one of `slideId` / `jump` is set; an OverlayLink with neither is
 * meaningless and is dropped on load. A fixed target is held as a `Slide.id`
 * and never as an index, so reordering slides cannot silently repoint a link —
 * and an id naming a slide that no longer exists is pruned on load, the same
 * rule `SlideOverlay.labelOf` and `SlideComment.overlayId` follow.
 */
export interface OverlayLink {
  /** → Slide.id. Mutually exclusive with `jump` and `url`. */
  slideId?: string;
  /** Relative navigation. Mutually exclusive with `slideId` and `url`. */
  jump?: LinkJump;
  /**
   * External target — an http(s) or mailto URL. Mutually exclusive with the
   * two above; `normalizeLink` enforces that and fixes the precedence.
   *
   * Round-trips as PowerPoint's own external hyperlink (an `a:hlinkClick` with
   * an `r:id` to a `Relationship` of type `.../hyperlink` and
   * `TargetMode="External"`), so a link to a plan file, an intel record or a
   * map service survives the trip in both directions.
   */
  url?: string;
  /**
   * Hover text. Round-trips to and from the PPTX `a:hlinkClick/@tooltip`;
   * absent = the editor shows the resolved target name instead.
   */
  tooltip?: string;
}

/**
 * One merged region of a table: the anchor cell at (r, c) covers a
 * `rowspan` × `colspan` block. Absent span = 1, so `{r, c}` alone is a no-op.
 */
export interface TableMerge {
  r: number;
  c: number;
  rowspan?: number;
  colspan?: number;
}

/**
 * A drop shadow. `x`/`y`/`blur` are fractions of view height (see
 * SlideOverlay.shadow); `color` is any CSS colour and normally carries alpha.
 */
export interface OverlayShadow {
  x: number;
  y: number;
  blur: number;
  color: string;
}

/**
 * Composite modes offered for `SlideOverlay.blend` — the canvas
 * globalCompositeOperation values that read as "blend modes" to a user. 'normal'
 * is the absence of the field, never a stored value.
 */
export type OverlayBlend =
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'difference'
  | 'exclusion';

/**
 * Box-geometry kinds persist identically (bbox + rotation + fill/stroke) and
 * regenerate their vertices from the bbox on load. Shared by OverlayFabric
 * and the slide editor's style plumbing.
 */
export const BOX_OVERLAY_KINDS = [
  'rect',
  'ellipse',
  'diamond',
  'triangle',
  'star',
  'callout',
  'blockArrow',
  'blockArrowDouble',
  'chevron',
] as const;

/**
 * A PowerPoint-like annotation added in the slide editor. All coordinates are
 * normalized [0..1] against the slide's view rect (top-left origin), so the
 * same numbers place the object on the editor canvas (× canvas px) and inside
 * the PPTX contain-fit rectangle (× fit inches). strokeWidth / fontSize
 * normalize to view HEIGHT (px = f × canvasH; pptx pt = f × fit.h × 72).
 */
export interface SlideOverlay {
  id: string;
  kind: OverlayKind;
  /** Normalized bounding box. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees clockwise about the box center — text/rect/ellipse only. */
  rotation?: number;
  /** line / arrow: 2+ points (bend points in between); freehand: sampled polyline. Normalized. */
  points?: Array<{ x: number; y: number }>;
  /** '#RRGGBB'; absent = no fill. */
  fill?: string;
  /** 0..1, default 1. */
  fillOpacity?: number;
  /** '#RRGGBB'. */
  stroke?: string;
  /** Fraction of view height. */
  strokeWidth?: number;
  /** Stroke dash pattern; absent = solid. */
  strokeDash?: 'dashed' | 'dotted';
  /** arrow only. Absent = 'sharp' (today's straight 2-point look). */
  arrowType?: 'sharp' | 'curved' | 'elbow';
  /**
   * line only — the same vocabulary as arrowType, kept as its own field so a
   * line's persisted shape never reads as an arrow's. Absent = 'sharp'.
   */
  lineType?: 'sharp' | 'curved' | 'elbow';
  /**
   * line only. Closes the path back to its first point and lets it take a
   * fill — i.e. a polygon, Excalidraw's `ExcalidrawLineElement.polygon`.
   * Absent = open. `fill` / `fillOpacity` are only honoured when this is set.
   */
  closed?: boolean;
  /**
   * arrow only. Absent = 'triangle' — the single filled head every arrow had
   * before per-end terminators existed, so old slides keep their look.
   */
  arrowEnd?: ArrowHead;
  /** arrow only. Absent = 'none'. */
  arrowStart?: ArrowHead;
  /**
   * tacArrow only — body thickness as a fraction of view height. The filled
   * outline is generated by offsetting the `points` spine by ±width/2, so this
   * is the arrow's waist, not a stroke weight. Absent = 0.05.
   */
  width?: number;
  /**
   * Head length. tacArrow: a fraction of the spine's length (absent = 0.15,
   * matching the map-side FreehandMainAttackArrow default). Block-arrow box
   * kinds: a fraction of the bounding box along the arrow's axis
   * (absent = 0.45), and the value PPTX carries as the shape's adjustment.
   */
  headRatio?: number;
  /**
   * tacArrow only — the body narrows toward the tail, giving the classic
   * main-attack silhouette. Absent = a constant-width body.
   */
  taper?: boolean;
  /**
   * milsym only — the full 20-character 2525D SIDC. This is the single source
   * of truth for what is drawn: the marker is re-rendered from it at whatever
   * size is needed, which is why a milsym overlay stores no `src`.
   */
  sidc?: string;
  /**
   * milsym only — the Symbols.json catalogue key (`symbolSet` + `entity`, e.g.
   * '01110104'). Kept alongside the SIDC for the display name and for
   * re-opening the picker on the entry this symbol came from.
   */
  symKey?: string;
  /**
   * milsym only — milsymbol text amplifiers (uniqueDesignation, higherFormation,
   * dtg, speed, …): the fields listed in UEISymbol's AMPLIFIER_FIELDS. Empty
   * values are dropped on save, so an unamplified symbol persists nothing here.
   */
  symOptions?: Record<string, string>;
  /**
   * chart only — the whole chart model (type, series, axis titles, colours).
   * Persisted instead of a bitmap for the same reason `sidc` is: the editor
   * re-renders it to a canvas at any size, and PptxExporter hands this exact
   * model to `addChart()` so PowerPoint receives a real, editable chart rather
   * than a picture of one. See ChartFactory.
   */
  chart?: ChartSpec;
  /**
   * table only — merged cell regions. Each entry says the cell at (r, c) spans
   * `rowspan` × `colspan`; the cells it covers are not drawn and carry no text.
   * Overlapping or out-of-range entries are discarded by `normalizeMerges`,
   * so a hand-edited document cannot produce an unrenderable grid.
   *
   * Maps to OOXML `gridSpan` / `rowSpan` (+ the `hMerge` / `vMerge` flags on
   * the covered cells), so a merged ORBAT or synch-matrix table survives the
   * PPTX round-trip in both directions.
   */
  merges?: TableMerge[];
  /**
   * table only — let a table that overflows its slide continue onto new ones
   * (PowerPoint's own table auto-paging). Off by default: an overlay table is
   * a box the author sized, so flowing is opt-in per table.
   */
  autoPage?: boolean;
  /**
   * Accessible description, emitted as the PPTX shape/picture `descr`. Only
   * meaningful on things a screen reader cannot read otherwise — pictures and
   * shapes; text carries its own. milsym overlays generate one from their SIDC
   * when this is absent (see PptxExporter._milSymAltText).
   */
  altText?: string;
  /**
   * Corner radius for `rect`, as a fraction of the box's SHORTER side (0..0.5).
   * Renders as fabric's rx/ry and exports as the `roundRect` shape's
   * `rectRadius`. Absent = square corners.
   */
  cornerRadius?: number;
  /**
   * text only — line height as a multiple of the font size (e.g. 1.5). Maps to
   * fabric's `lineHeight` and to PPTX `lineSpacingMultiple`. Absent = 1.
   */
  lineSpacing?: number;
  /**
   * text only — extra letter spacing in points. Maps to fabric's `charSpacing`
   * (which is in 1/1000 em) and to PPTX `charSpacing`. Absent = 0.
   */
  charSpacing?: number;
  /** Whole-object opacity 0..1, default 1. */
  opacity?: number;
  /**
   * Soft group membership. Members share one id and are selected / moved /
   * deleted / copied as a unit in the editor, but stay independent objects —
   * there is no nested transform, so persistence and PPTX emit are per-object
   * exactly as for ungrouped overlays.
   */
  groupId?: string;
  /** Editor lock — still selectable (so it can be unlocked) but not movable, resizable, restylable or erasable. */
  locked?: boolean;
  /**
   * Click target. Any overlay kind may carry one: clicking inside its box in
   * present mode navigates instead of advancing. Absent = not clickable, which
   * is every overlay authored before links existed. See OverlayLink.
   *
   * A fill-less, stroke-less `rect` carrying only a link is the invisible
   * hotspot the PPTX importer uses for links it finds on elements that have no
   * overlay of their own (pictures, which are flattened into the background).
   */
  link?: OverlayLink;
  /**
   * Mirrored geometry, box kinds and images — point-based kinds mirror their
   * `points` instead, and text is never mirrored. On boxes it shows only on the
   * asymmetric shapes (triangle, callout). Maps to PPTX xfrm flipH / flipV.
   */
  flipX?: boolean;
  flipY?: boolean;
  /**
   * Drop shadow. Offsets and blur are fractions of view height, like
   * `strokeWidth` and `fontSize`, so a shadow keeps its proportion at any canvas
   * size. `color` carries its own alpha (rgba()), because a shadow is nearly
   * always partly transparent. Absent = no shadow. Exports natively to PPTX.
   */
  shadow?: OverlayShadow;
  /**
   * Canvas composite mode; absent = 'normal'. Draws in the editor, in present
   * mode and in any rasterized export. PowerPoint shapes have no equivalent, so
   * a NATIVE pptx emit cannot carry it — the exporter logs what was dropped.
   */
  blend?: OverlayBlend;
  /**
   * image only — gaussian blur as a fraction of the image's own size (fabric's
   * Blur filter scale, so 0.1 is already strong). Absent = sharp. Like `blend`,
   * it is a canvas effect with no native pptx representation.
   */
  blur?: number;
  /**
   * image only — the picture itself, as a data URL. Self-contained like
   * `backgroundDataUrl`, so a briefing stays portable; decoding is cached and
   * pre-warmed by OverlayFabric.preloadOverlayImages before any render.
   */
  src?: string;
  // text only:
  text?: string;
  fontFamily?: string;
  /** Fraction of view height. */
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: 'left' | 'center' | 'right' | 'justify';
  textColor?: string;
  /**
   * text only — turns the box into a one-level list: every line becomes an
   * item. The persisted `text` stays CLEAN (no marker characters); markers are
   * synthesized when the fabric object is built and stripped again on
   * read-back, so toggling the style off restores the original text exactly.
   * Exports as a real PowerPoint list (`bullet: true` / `{ type: 'number' }`),
   * not as literal '•' characters. Absent = not a list.
   */
  listStyle?: 'bullet' | 'number' | 'alpha';
  // table only:
  /**
   * Row-major cell text. Always rectangular once normalized — the loader pads
   * short rows and truncates long ones to `rows[0].length`. Cells carry no
   * per-cell style: the whole table shares one font, one gridline stroke and
   * one body fill (plus the header row's own fill), which is exactly what maps
   * onto pptxgenjs `addTable`.
   */
  rows?: string[][];
  /** Fractions of `w`, summing to 1. Absent = equal columns. */
  colWidths?: number[];
  /** Fractions of `h`, summing to 1. Absent = equal rows. */
  rowHeights?: number[];
  /** Gives `rows[0]` its own fill and bold text. */
  headerRow?: boolean;
  /** '#RRGGBB' — only meaningful with `headerRow`. */
  headerFill?: string;
  /**
   * text only — the overlay id of the shape or arrow this text labels. The
   * label stays an independent overlay (fabric 4.5 cannot edit text inside a
   * Group), so present mode and the PPTX exporter need no special case; the
   * slide editor is what keeps the pair selected, moved and deleted together.
   * Dangling links are dropped on load.
   */
  labelOf?: string;
}

/** One authored message: the thread opener, or a reply. */
export interface SlideCommentEntry {
  id: string;
  author: string;
  text: string;
  /** ISO datetime. */
  at: string;
}

/**
 * The semantic type of a comment thread. A plain `comment` is the historical
 * default — every thread authored before typed comments existed reads as one.
 * The other kinds are notes with a job:
 *   - decision   — a call that was made; may carry `final`
 *   - task       — an action item; may carry `assignee` + `dueAt`
 *   - question   — an open ask; may point to the reply that answered it
 *                  via `answerCommentId`
 *   - risk       — a hazard; may carry `severity`
 *   - assumption — a working belief; may be marked `validated`
 *   - issue      — a defect / problem to fix
 *
 * The kind drives the composer's extra fields, the badge glyph on the slide,
 * the filter chips in the right rail, and the [KIND · …] prefix the PPTX
 * exporter writes so PowerPoint users see the type inline.
 */
export type CommentKind =
  | 'comment'
  | 'decision'
  | 'task'
  | 'question'
  | 'risk'
  | 'assumption'
  | 'issue';

/** Severity levels for `risk` comments. */
export type CommentSeverity = 'low' | 'medium' | 'high' | 'critical';

/** Every kind other than the default. Used for filter chips and prefix parsing. */
export const TYPED_COMMENT_KINDS: readonly CommentKind[] = [
  'decision',
  'task',
  'question',
  'risk',
  'assumption',
  'issue',
];

/**
 * A review comment thread. Editor-only: never drawn in present mode, in
 * thumbnails or in any rasterized export — but saved with the slide so it
 * travels with the briefing, and emitted as a real PowerPoint comment by
 * PptxExporter.
 *
 * Anchors, in the order they are checked: `overlayId` (pinned to an
 * annotation), then `x`/`y` (a spot on the slide), then neither (the slide as a
 * whole). Coordinates are normalized [0..1] like SlideOverlay's, so a thread
 * stays put when the editor canvas is resized and maps straight into the PPTX
 * contain-fit rectangle.
 *
 * `kind` promotes a thread into a typed marker — a Decision, Task, Question,
 * Risk, Assumption or Issue. Extra fields apply only to the kinds that carry
 * them; every field is optional so an older briefing without a kind reads
 * exactly as before (`kind` absent = 'comment').
 */
export interface SlideComment extends SlideCommentEntry {
  /**
   * The overlay this thread is pinned to (`SlideOverlay.id`). Dangling ids are
   * dropped on load, so deleting an annotation turns its threads into
   * slide-level ones rather than orphaning them.
   */
  overlayId?: string;
  /** Normalized point anchor. Used when there is no `overlayId`. */
  x?: number;
  y?: number;
  resolved?: boolean;
  replies?: SlideCommentEntry[];
  /** Absent = 'comment' (plain review note). */
  kind?: CommentKind;
  /** task only — who owns it (free text; typically a display name). */
  assignee?: string;
  /** task only — ISO date string (YYYY-MM-DD) or full ISO datetime. */
  dueAt?: string;
  /** task only — 'open' when unresolved; 'resolved' mirrors `resolved`. */
  taskStatus?: 'open' | 'resolved';
  /** risk only. */
  severity?: CommentSeverity;
  /**
   * question only — the id of the reply entry (from `replies`) that answered
   * this question. Set by the author; the UI shows "answered" when present.
   */
  answerCommentId?: string;
  /** decision only — a locked-in call vs. a provisional one. */
  final?: boolean;
  /** assumption only — whether the assumption has been validated. */
  validated?: boolean;
}

export interface BuildStep {
  /** → graphic.attributes.id */
  graphicId: string;
  effect: BuildEffect;
  /**
   * In 'auto' mode: offset from slide-enter (steps share one clock, so they can
   * overlap). In 'click' mode: offset from this step's own group start, which
   * `trigger` defines — see BuildTrigger.
   */
  delayMs: number;
  /** 0 for instant 'appear'. */
  durationMs: number;
  /** flyIn only: map-units offset the graphic starts at, animating to 0,0. */
  flyFrom?: { dx: number; dy: number };
  /** Absent = 'click'. Only consulted when the slide's buildMode is 'click'. */
  trigger?: BuildTrigger;
}

export interface Slide {
  /** Engine-generated UUID. */
  id: string;
  title: string;
  /** Speaker notes — reused by the PPTX exporter's addNotes(). */
  notes?: string;
  view: CapturedViewState;
  /** LAYER_NAMES value (+ 'milSymbols') → visible. */
  visibleLayers: Record<string, boolean>;
  /** Optional per-graphic overrides by attributes.id (exceptions only). */
  graphicVisibility?: Record<string, boolean>;
  /**
   * Skipped during playback — PowerPoint's "Hide Slide". The slide stays in the
   * deck, keeps its number, and is still reachable by clicking its tile or
   * typing its number: only the STEPPING paths (advance / back / Home / End /
   * autoplay, and nextSlide / prevSlide outside present mode) pass it over.
   * Exports as a real hidden PowerPoint slide (`<p:sld show="0">`) and imports
   * back from one. Absent = visible.
   */
  hidden?: boolean;
  /**
   * Leave this slide's headers, footers, classification banner and slide number
   * off — the per-slide escape hatch from the deck's chrome (see DeckChrome).
   * A full-bleed map or an imported title slide wants the whole page.
   *
   * The slide keeps its NUMBER either way; only the furniture is suppressed. It
   * suppresses the reserved insets too, so the slide's content fills the page
   * in the editor, in present mode and in the exported .pptx alike. Absent =
   * the deck's chrome applies.
   */
  noChrome?: boolean;
  /**
   * PowerPoint slide section this slide belongs to. Consecutive slides sharing
   * a title form one section; the exporter declares each in first-appearance
   * order via `addSection()` and tags slides with `addSlide({ sectionTitle })`,
   * giving the recipient PowerPoint's section navigator on a long deck.
   *
   * Maps naturally onto the five-paragraph OPORD (Situation / Mission /
   * Execution / Sustainment / Command & Signal) or onto briefing phases.
   * Absent = the slide is not in any section.
   */
  section?: string;
  /** Ordered staged-reveal steps. */
  builds?: BuildStep[];
  /**
   * Absent = 'auto' — the original timer-driven behaviour, so every briefing
   * authored before step-through existed plays back unchanged. See SlideBuildMode.
   */
  buildMode?: SlideBuildMode;
  /** goTo duration entering this slide (ms). Also reused as the slideTransition duration. */
  transitionMs: number;
  /**
   * Present-mode transition played when both this slide and the one before it
   * are screen-only. Absent = the existing instant cut. See SlideTransitionType.
   */
  slideTransition?: SlideTransitionType;
  /** Lazy; absent when the screenshot path is unavailable (3D-headless). */
  thumbnailDataUrl?: string;
  /** PowerPoint-like annotations added in the slide editor (normalized coords). */
  overlays?: SlideOverlay[];
  /** Review comment threads — editor-only, never rendered. See SlideComment. */
  comments?: SlideComment[];
  /**
   * Lazy full-resolution capture-time screenshot. Falls back into the slide
   * editor's background when the live map's symbol graphics are missing —
   * e.g. this briefing was imported without also loading the plan/session
   * its graphic ids point into. Absent when the screenshot path was
   * unavailable at capture time (3D-headless) — same caveat as thumbnailDataUrl.
   */
  backgroundDataUrl?: string;
}

export interface BriefingDocument {
  /**
   * 12 = typed comments (kind + assignee/dueAt/severity/answerCommentId/
   * final/validated); 11 = deck chrome (headers/footers/classification/slide
   * numbers) + per-slide noChrome; 10 = hidden slides; 9 = overlay links
   * (slide-to-slide hyperlinks); 8 = per-slide buildMode + per-step build
   * triggers; 7 = review comments; 6 = milsym overlays + block/tactical arrows;
   * 5 = table overlays + text listStyle; 4 = slides may be screen-only
   * (imported PPTX: no extent/camera); 3 = full-res backgroundDataUrl fallback;
   * 2 = overlays; 1–12 accepted on import. Every added field is optional, so
   * newer documents degrade in older code rather than failing to load.
   */
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  slides: Slide[];
  /**
   * Deck-level headers, footers, classification banners and slide numbering.
   * Absent = the chrome falls back to the `exportTools.*` settings, which is
   * where it lived before it was part of the document — so a briefing saved by
   * an older build keeps exporting exactly the chrome it always did. See
   * SlideChrome.resolveChrome.
   */
  chrome?: DeckChrome;
}
