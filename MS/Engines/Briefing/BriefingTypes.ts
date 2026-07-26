/**
 * BriefingTypes.ts
 *
 * Data model for the Briefing / Present-mode engine. Slides reference
 * graphics by their stable `graphic.attributes.id` (assigned in
 * SymbolEngine.drawSymEnd and round-tripped by SerializationEngine), so a
 * briefing survives save/load of the underlying plan.
 */

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
 * Present-mode transition played entering a screen-only ("slide view") slide
 * from another screen-only slide. Map-based slides never use this — their
 * view.goTo() pan/zoom is the transition.
 */
export type SlideTransitionType = 'fade' | 'pushLeft' | 'pushRight' | 'wipe';

export type OverlayKind =
  | 'text'
  | 'image'
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'triangle'
  | 'star'
  | 'callout'
  | 'line'
  | 'arrow'
  | 'freehand'
  | 'highlight';

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
   * Mirrored geometry, box kinds and images — point-based kinds mirror their
   * `points` instead, and text is never mirrored. On boxes it shows only on the
   * asymmetric shapes (triangle, callout). Maps to PPTX xfrm flipH / flipV.
   */
  flipX?: boolean;
  flipY?: boolean;
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
  align?: 'left' | 'center' | 'right';
  textColor?: string;
  /**
   * text only — the overlay id of the shape or arrow this text labels. The
   * label stays an independent overlay (fabric 4.5 cannot edit text inside a
   * Group), so present mode and the PPTX exporter need no special case; the
   * slide editor is what keeps the pair selected, moved and deleted together.
   * Dangling links are dropped on load.
   */
  labelOf?: string;
}

export interface BuildStep {
  /** → graphic.attributes.id */
  graphicId: string;
  effect: BuildEffect;
  /** Offset from slide-enter (steps share one clock, so they can overlap). */
  delayMs: number;
  /** 0 for instant 'appear'. */
  durationMs: number;
  /** flyIn only: map-units offset the graphic starts at, animating to 0,0. */
  flyFrom?: { dx: number; dy: number };
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
  /** Ordered staged-reveal steps. */
  builds?: BuildStep[];
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
   * 4 = slides may be screen-only (imported PPTX: no extent/camera);
   * 3 = full-res backgroundDataUrl fallback; 2 = overlays; 1–4 accepted on import.
   */
  version: 1 | 2 | 3 | 4;
  slides: Slide[];
}
