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

export type OverlayKind = 'text' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'freehand';

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
  /** line/arrow: [start, end]; freehand: sampled polyline. Normalized. */
  points?: Array<{ x: number; y: number }>;
  /** '#RRGGBB'; absent = no fill. */
  fill?: string;
  /** 0..1, default 1. */
  fillOpacity?: number;
  /** '#RRGGBB'. */
  stroke?: string;
  /** Fraction of view height. */
  strokeWidth?: number;
  /** Whole-object opacity 0..1, default 1. */
  opacity?: number;
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
  /** goTo duration entering this slide (ms). */
  transitionMs: number;
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
