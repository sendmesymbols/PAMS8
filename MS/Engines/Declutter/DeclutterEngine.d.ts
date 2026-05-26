import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import GraphicsLayerManager from "../../Managers/GraphicsLayerManager";
import { SpatialIndex } from "./SpatialIndex";
type AnnotMode = "off" | "zoom" | "minscale" | "density";
/**
 * Context passed to every solve step. Read-only from the step's perspective:
 * the step may toggle graphic visibility or push aggregate graphics into a
 * separate layer, but it must not mutate the index.
 */
export interface SolveContext {
    view: MapView | SceneView;
    index: SpatialIndex;
    zoom: number;
    zoomInt: number;
}
export type SolveStep = (ctx: SolveContext) => void;
/** Stats dispatched after every solve pass for the perf HUD. */
export interface SolveStats {
    solveMs: number;
    indexSize: number;
    perStepMs: Record<string, number>;
    zoom: number;
    timestamp: number;
}
export interface DeclutterOptions {
    enabled?: boolean;
    annotations?: {
        mode?: AnnotMode;
        zoomThreshold?: number;
        densityMinPx?: number;
        fadeMs?: number;
    };
    symbols?: {
        hideBelow?: boolean;
        zoomThreshold?: number;
        echelonBased?: boolean;
        fadeMs?: number;
    };
}
export declare class DeclutterEngine {
    private _getView;
    private _layerManager;
    private _zoomWatcher;
    private _stationaryWatcher;
    private _graphicsWatchers;
    private _enabled;
    private _fadeHandles;
    private _lastZoomInt;
    private _lastAnnotMode;
    private _dirtyLayers;
    private _dirtyTimer;
    private _spatialIndex;
    private _solveSteps;
    private _solveTimer;
    constructor(viewProvider: () => MapView | SceneView, layerManager: GraphicsLayerManager);
    enable(): void;
    disable(): void;
    /** Re-read settings and re-apply declutter at the current zoom level. */
    refresh(): void;
    /** Call when the map view switches between 2D and 3D. */
    onViewChanged(newView: MapView | SceneView): void;
    destroy(): void;
    /**
     * Register a named solve step. Calling twice with the same name replaces
     * the previous step. Steps run in insertion order on each solve pass.
     */
    registerSolveStep(name: string, step: SolveStep): void;
    unregisterSolveStep(name: string): void;
    /** External trigger — engines call this after mutating their own state. */
    requestSolve(): void;
    /** Read-only access for solve steps that need richer queries between passes. */
    get spatialIndex(): SpatialIndex;
    private _attachZoomWatcher;
    /** Pan-aware re-evaluation: density mode needs to re-bin on pan. */
    private _attachStationaryWatcher;
    /**
     * Watch each symbol layer's graphics collection so newly added graphics
     * inherit current declutter rules without waiting for the next zoom change.
     */
    private _attachGraphicsWatchers;
    /** Coalesce bursts of graphic adds into a single re-solve pass. */
    private _scheduleDirtyFlush;
    private _flushDirtyLayers;
    /** Debounced trigger — coalesces zoom + pan + add bursts. */
    private _scheduleSolve;
    private _runSolve;
    private _onZoomChange;
    private _applyAnnotations;
    /** Undo side-effects left by `prevMode` so the next mode starts clean. */
    private _cleanupAnnotMode;
    private _annotZoomThreshold;
    private _annotMinScale;
    private _annotDensity;
    private _annotOff;
    private _applySymbols;
    /** Build the list of visible echelon codes at a given integer zoom. */
    private _visibleEchelonsForZoom;
    /**
     * Show/hide symbols based on their echelon and the ZoomLvlEchelon map.
     * Echelon "00" (no echelon assigned) is always treated as visible.
     * Single-pass: collects desired state and only flashes if at least one
     * graphic actually changes.
     */
    private _applyEchelon;
    /** Delegates to the shared echelon parser in ./echelon. */
    private _getEchelon;
    /** After echelon visibility is applied, hide annotations for hidden parent symbols. */
    private _syncAnnotationsToSymbolVisibility;
    /**
     * Fade symbol layers in/out at the hideBelow zoom threshold.
     * Checks both visible AND opacity so a stale fade (opacity=0, visible=true)
     * doesn't cause a no-op when the layer should be showing.
     */
    private _symbolZoomHide;
    private _reset;
    /**
     * Smoothly animate a GraphicsLayer's opacity from `from` to `to` over `ms` milliseconds.
     * Uses an ease-in-out curve. Cancels any previous animation on the same layer.
     */
    private _fadeLayer;
    /**
     * Flash-update a layer: fade out → run updateFn → fade back in.
     * This gives a smooth "scene refresh" effect when bulk symbol visibility changes.
     */
    private _flashLayer;
}
export default DeclutterEngine;
