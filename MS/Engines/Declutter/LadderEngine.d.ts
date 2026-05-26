import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import GraphicsLayerManager from "../../Managers/GraphicsLayerManager";
import { DeclutterEngine } from "./DeclutterEngine";
/**
 * "Laddering" declutter strategy.
 *
 * Within a screen-pixel detection radius (thresholdPx), nearby same-
 * identity symbols are gathered into a vertical stack — "rungs"
 * connected by a thin line (the "spine") down to the geographic
 * centroid. Visually it reads like flags hoisted on a halyard.
 *
 * Composition:
 *   - Activates above minZoom (default 14) just like MarkerDisperser.
 *   - When LadderEngine claims a graphic it tags __ladderRung.
 *     MarkerDisperser skips any graphic with that attribute, so the
 *     two engines never fight over the same stack — ladder wins.
 *   - Cluster badges (__isCluster) and non-Point graphics are skipped.
 *   - Already-dispersed graphics (with __dspOrigX cached) still have a
 *     valid logical position so ladder reads it correctly.
 *
 * Ordering: rungs are sorted by `priorityOf` descending, so the
 * highest-echelon symbol always lands on the top rung.
 */
export declare class LadderEngine {
    private _layerManager;
    private _declutter;
    private _enabled;
    /** id → graphic, for symbols currently on a rung. */
    private _laddered;
    /**
     * Original elevationInfo.mode of each layer we mutated when entering
     * altitude mode. Stored so disable() can restore exactly.
     */
    private _origElevationModes;
    constructor(_viewProvider: () => MapView | SceneView, layerManager: GraphicsLayerManager, declutter: DeclutterEngine);
    enable(): void;
    disable(): void;
    refresh(): void;
    onViewChanged(_view: MapView | SceneView): void;
    private _solve;
    /** Map standard identity char → simple group key (mirrors ClusterEngine taxonomy). */
    private _identityGroupKey;
    /** Partition a stack into per-identity subgroups. */
    private _splitByIdentity;
    private _restoreAll;
    /** Restore a single graphic to its cached origin and strip all ladder attrs. */
    private _restoreOne;
    /** If `id` is currently laddered, restore and forget it. */
    private _restoreIfTracked;
    private _clearLadderLayer;
    /**
     * Switch the LADDER + symbol layers' elevationInfo so that z values on
     * graphics are honoured in altitude mode. When `enable=false` (or the
     * setting toggles back off), restore the original modes (typically
     * "on-the-ground") so other engines / non-laddered symbols behave as
     * before.
     */
    private _applyLayerElevationMode;
    private _cfg;
}
export default LadderEngine;
