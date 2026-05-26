import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import { priorityOf } from "./PriorityResolver";

export interface IndexEntry {
  graphic: Graphic;
  id: string;
  /** Screen-space x in CSS pixels. */
  x: number;
  /** Screen-space y in CSS pixels. */
  y: number;
  /** Cached priority score (filled on rebuild). */
  priority: number;
  /** Source layer id (for layer-scoped queries). */
  layerId: string;
}

/**
 * Screen-space grid hash with cached screen positions.
 *
 * Why screen space:
 *   Clutter is a viewport problem, not a geographic one. Two symbols 50 m
 *   apart at zoom 4 share a pixel; the same pair at zoom 18 are nowhere
 *   near each other. Doing the math in pixels means one consistent
 *   threshold across all zooms.
 *
 * Performance shape:
 *   - rebuild is O(N), single pass, one view.toScreen per graphic
 *   - within(x,y,r) scans the (2r/cell + 1)² buckets that intersect the
 *     query disc, then filters exact distance — typically O(k) where k is
 *     the local density, not N
 *   - bucketOf(x,y) is O(1)
 *
 * Lifecycle:
 *   The index is rebuilt per solve pass. Persistent indexing would require
 *   listening to every graphic move/add and re-bucketing — that costs more
 *   than rebuilding once when the view goes stationary.
 */
export class SpatialIndex {
  private buckets = new Map<string, IndexEntry[]>();
  private byId = new Map<string, IndexEntry>();
  private cellSize: number;
  private _viewFingerprint = "";

  constructor(cellSize: number = 64) {
    this.cellSize = cellSize;
  }

  /** Single-pass rebuild from any iterable of (layerId, graphics) pairs. */
  rebuild(
    sources: Iterable<{ layerId: string; graphics: Iterable<Graphic> }>,
    view: MapView | SceneView,
  ): void {
    this.clear();
    this._viewFingerprint = SpatialIndex.fingerprint(view);
    const now = Date.now();

    for (const { layerId, graphics } of sources) {
      for (const g of graphics) {
        const id = String(g.attributes?.id ?? "");
        if (!id) continue;

        const geom = g.geometry as Point | null;
        if (!geom) continue;

        let screenPt: { x: number; y: number } | null | undefined;
        try {
          screenPt = view.toScreen(geom);
        } catch {
          continue;
        }
        if (!screenPt) continue;

        const entry: IndexEntry = {
          graphic: g,
          id,
          x: screenPt.x,
          y: screenPt.y,
          priority: priorityOf(g, now),
          layerId,
        };

        this._insert(entry);
        this.byId.set(id, entry);
      }
    }
  }

  /**
   * Entries within `radiusPx` of (x,y), filtered to exact Euclidean distance.
   * Scans only the buckets that overlap the query disc.
   */
  within(x: number, y: number, radiusPx: number): IndexEntry[] {
    const r2 = radiusPx * radiusPx;
    const minCx = Math.floor((x - radiusPx) / this.cellSize);
    const maxCx = Math.floor((x + radiusPx) / this.cellSize);
    const minCy = Math.floor((y - radiusPx) / this.cellSize);
    const maxCy = Math.floor((y + radiusPx) / this.cellSize);
    const out: IndexEntry[] = [];

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.buckets.get(`${cx},${cy}`);
        if (!bucket) continue;
        for (const e of bucket) {
          const dx = e.x - x;
          const dy = e.y - y;
          if (dx * dx + dy * dy <= r2) out.push(e);
        }
      }
    }
    return out;
  }

  /** Single bucket only — fastest primitive for cluster-by-cell. */
  bucketOf(x: number, y: number): IndexEntry[] {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    return this.buckets.get(`${cx},${cy}`) ?? [];
  }

  /** Iterate every populated bucket. Useful for clustering algorithms. */
  bucketEntries(): IterableIterator<[string, IndexEntry[]]> {
    return this.buckets.entries();
  }

  getById(id: string): IndexEntry | undefined {
    return this.byId.get(id);
  }

  /** True if the view has moved/zoomed since the last rebuild. */
  isStale(view: MapView | SceneView): boolean {
    return SpatialIndex.fingerprint(view) !== this._viewFingerprint;
  }

  clear(): void {
    this.buckets.clear();
    this.byId.clear();
    this._viewFingerprint = "";
  }

  get size(): number { return this.byId.size; }
  get cellSizePx(): number { return this.cellSize; }

  private _insert(entry: IndexEntry): void {
    const cx = Math.floor(entry.x / this.cellSize);
    const cy = Math.floor(entry.y / this.cellSize);
    const key = `${cx},${cy}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = [];
      this.buckets.set(key, bucket);
    }
    bucket.push(entry);
  }

  /** Compact view-state hash used to detect rebuild necessity. */
  private static fingerprint(view: MapView | SceneView): string {
    const ext = view.extent;
    if (!ext) return "";
    return `${view.zoom?.toFixed(2)}|${ext.xmin.toFixed(1)}|${ext.ymin.toFixed(1)}|${ext.xmax.toFixed(1)}|${ext.ymax.toFixed(1)}`;
  }
}
