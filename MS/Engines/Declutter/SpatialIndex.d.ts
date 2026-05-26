import Graphic from "@arcgis/core/Graphic";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
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
export declare class SpatialIndex {
    private buckets;
    private byId;
    private cellSize;
    private _viewFingerprint;
    constructor(cellSize?: number);
    /** Single-pass rebuild from any iterable of (layerId, graphics) pairs. */
    rebuild(sources: Iterable<{
        layerId: string;
        graphics: Iterable<Graphic>;
    }>, view: MapView | SceneView): void;
    /**
     * Entries within `radiusPx` of (x,y), filtered to exact Euclidean distance.
     * Scans only the buckets that overlap the query disc.
     */
    within(x: number, y: number, radiusPx: number): IndexEntry[];
    /** Single bucket only — fastest primitive for cluster-by-cell. */
    bucketOf(x: number, y: number): IndexEntry[];
    /** Iterate every populated bucket. Useful for clustering algorithms. */
    bucketEntries(): IterableIterator<[string, IndexEntry[]]>;
    getById(id: string): IndexEntry | undefined;
    /** True if the view has moved/zoomed since the last rebuild. */
    isStale(view: MapView | SceneView): boolean;
    clear(): void;
    get size(): number;
    get cellSizePx(): number;
    private _insert;
    /** Compact view-state hash used to detect rebuild necessity. */
    private static fingerprint;
}
