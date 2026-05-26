import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import GraphicsLayerManager from "../../Managers/GraphicsLayerManager";
import { DeclutterEngine } from "./DeclutterEngine";
/**
 * Equivalent of ArcGIS's "Disperse Markers" tool.
 *
 * Problem solved: at high zoom, symbols at near-identical coordinates
 * (e.g. multiple units at the same fortification) sit exactly on top of
 * each other and the user can only see the topmost. Clustering aggregates
 * away the detail; disperse fans the stack so every member is visible
 * at its slightly-offset position while the user still knows they
 * share a location.
 *
 * Algorithm:
 *   1. Read each visible point symbol's *logical* position (origX/Y if
 *      previously dispersed, else current geometry) — this makes the pass
 *      idempotent: re-running on already-dispersed symbols still computes
 *      the same stack centroid.
 *   2. Greedy stack detection in screen space (within thresholdPx).
 *   3. For each stack ≥ 2 members, distribute around the centroid on a
 *      circle of radiusPx. Sort by id for stable ordering across solves.
 *   4. Restore any symbol that was dispersed last solve but is no longer
 *      part of a stack.
 *
 * Composition:
 *   - Inactive below minZoom (clustering owns that range).
 *   - Skips graphics with visible=false (so cluster-hidden members are
 *     ignored).
 *   - Skips non-Point geometries (lines/areas don't disperse).
 *   - Skips cluster badges (__isCluster attribute).
 */
export declare class MarkerDisperser {
    private _layerManager;
    private _declutter;
    private _enabled;
    /** Graphic id → graphic, for symbols currently dispersed. */
    private _dispersed;
    constructor(_viewProvider: () => MapView | SceneView, layerManager: GraphicsLayerManager, declutter: DeclutterEngine);
    enable(): void;
    disable(): void;
    refresh(): void;
    onViewChanged(_view: MapView | SceneView): void;
    private _solve;
    private _restoreAll;
    private _restoreOne;
    private _cfg;
}
export default MarkerDisperser;
