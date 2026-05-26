import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import GraphicsLayerManager from "../../Managers/GraphicsLayerManager";
import { DeclutterEngine } from "./DeclutterEngine";
/**
 * Aggregates nearby symbols into count badges to keep dense scenes readable.
 *
 * Algorithm: greedy pass over priority-sorted index entries. For each
 * unprocessed entry, take its on-screen neighbours within radiusPx that
 * share the same identity group; if the count meets minClusterSize, they
 * become a cluster and their graphics are hidden, replaced by a single
 * badge in the CLUSTER layer.
 *
 * Performance discipline:
 *   - Single pass over the index, O(N * k) where k = local density
 *   - No work above maxZoom (clusters disabled when the scene is sparse)
 *   - Graphics already hidden by echelon/zoom rules are skipped
 *   - Reuses the cluster layer (removeAll → re-add) rather than creating
 *     and destroying a layer per solve
 */
export declare class ClusterEngine {
    private _getView;
    private _layerManager;
    private _declutter;
    private _enabled;
    /** Graphics currently hidden by clustering, mapped to their pre-hide state. */
    private _hiddenMembers;
    private _clustersActive;
    /** Member IDs the user clicked to expand — skipped from re-clustering until they click elsewhere or zoom. */
    private _pinnedExpanded;
    private _clickHandle;
    constructor(viewProvider: () => MapView | SceneView, layerManager: GraphicsLayerManager, declutter: DeclutterEngine);
    enable(): void;
    disable(): void;
    refresh(): void;
    onViewChanged(_view: MapView | SceneView): void;
    /**
     * Click-to-expand: clicking a cluster badge pins its members so they
     * stay visible at their true positions until the user clicks elsewhere
     * or the view zooms. Clicking blank map unpins everything.
     */
    private _wireClickHandler;
    private _solve;
    /** True when every cluster member has the same echelon code. */
    private _allShareEchelon;
    /**
     * Tiny "×N" indicator placed NE of the seed symbol. Used when promote
     * mode is on and all members share echelon — the seed conveys the unit
     * type, the count conveys how many.
     */
    private _makeSeedCountBadge;
    private _computeClusters;
    private _makeBadge;
    private _groupOf;
    private _restoreAllHidden;
    private _findGraphicById;
    private _fadeInIfInactive;
    private _fadeOutIfActive;
    private _animateOpacity;
    private _cfg;
}
export default ClusterEngine;
