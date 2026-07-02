/**
 * DrawSeam.ts
 *
 * A tiny shared seam for interactive symbol drawing. Drawable line/area symbols
 * historically read the committed / candidate point inline:
 *
 *     const mapPoint = this.view.toMap(event);
 *     if (!mapPoint) return;
 *     const point = new Point({ x: mapPoint.x, y: mapPoint.y,
 *                               spatialReference: this.view.spatialReference });
 *
 * They now route that through `DrawSeam.resolvePoint(view, event)` instead. By
 * default this is a BEHAVIOUR-NEUTRAL drop-in (same Point, or null off-map). But
 * an optional resolver can be registered — by the premium stylus layer — to
 * snap / angle-lock / length-lock the point so the actually-committed vertex
 * lands on the resolved target (not just a cursor hint).
 *
 * Design notes:
 *  - Single global resolver: only ONE interactive draw is ever live at a time,
 *    and the premium layer registers on draw-start and clears on draw-end, so the
 *    resolver is present only during a premium-capture draw.
 *  - Resolver failures NEVER break drawing: any throw falls back to the raw point.
 *  - No ArcGIS view coupling beyond toMap + spatialReference.
 */

import Point from '@arcgis/core/geometry/Point';
import type MapView from '@arcgis/core/views/MapView';
import type SceneView from '@arcgis/core/views/SceneView';

type View = MapView | SceneView;

/** Maps a raw drawing point to a resolved (snapped / locked) one. */
export type DrawPointResolver = (view: View, raw: Point) => Point;

let _resolver: DrawPointResolver | null = null;

export default class DrawSeam {
  /** Register the active draw-point resolver (premium layer). */
  static setResolver(fn: DrawPointResolver | null): void {
    _resolver = fn;
  }

  /** Remove any registered resolver — back to plain raw points. */
  static clearResolver(): void {
    _resolver = null;
  }

  /** True when a resolver is active (a premium-capture draw is live). */
  static get hasResolver(): boolean {
    return _resolver !== null;
  }

  /**
   * Drop-in for `view.toMap(event)` + Point construction at symbol draw sites.
   * Returns null when the event is off-map (callers already guard with an early
   * return). Applies the registered resolver when present.
   */
  static resolvePoint(view: View, event: any): Point | null {
    const mp = (view as any).toMap(event);
    if (!mp) return null;
    const raw = new Point({ x: mp.x, y: mp.y, spatialReference: view.spatialReference });
    if (!_resolver) return raw;
    try {
      return _resolver(view, raw) || raw;
    } catch {
      return raw; // a resolver bug must never break drawing
    }
  }
}
