import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import GraphicsLayerManager from "../../Managers/GraphicsLayerManager";
import { DeclutterEngine } from "./DeclutterEngine";
/**
 * Maplex-style label placer.
 *
 * Strategy per Maplex: each label tries a chain of candidate positions
 * around its anchor and takes the first one that doesn't collide with
 * already-placed labels. If none fit, the first candidate is forced
 * (overlap accepted) — abbreviation/shrink chains are deliberately out of
 * scope for this MVP.
 *
 * Performance:
 *   - O(N · k) where k is the average grid neighbourhood size; not O(N²)
 *   - Hard cap at `maxToPlace`; over-budget labels are hidden lowest first
 *   - Estimated text bbox (no DOM measurement) → constant per label
 *   - Solve runs only on stationary (already debounced by DeclutterEngine)
 *
 * Labels store their original anchor in attributes so disable / view-change
 * can restore them perfectly without losing data.
 */
export declare class LabelPlacer {
    private _layerManager;
    private _declutter;
    private _enabled;
    constructor(_viewProvider: () => MapView | SceneView, layerManager: GraphicsLayerManager, declutter: DeclutterEngine);
    enable(): void;
    disable(): void;
    refresh(): void;
    onViewChanged(_view: MapView | SceneView): void;
    private _solve;
    /**
     * Returns the label's original anchor in map coords. On first call,
     * captures the current geometry into attributes so subsequent solves
     * (which may have moved the geometry) can still find it.
     */
    private _getAnchorMapCoords;
    /** Reset all annotations to their original anchor positions and text. */
    private _restoreAllAnchors;
    private _cfg;
}
export default LabelPlacer;
