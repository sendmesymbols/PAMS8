import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import GraphicsLayerManager from "../../Managers/GraphicsLayerManager";
export interface DeclutterOptions {
    enabled?: boolean;
    annotations?: {
        mode?: "off" | "zoom" | "minscale" | "density";
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
    private _enabled;
    private _fadeHandles;
    private _lastZoomInt;
    constructor(viewProvider: () => MapView | SceneView, layerManager: GraphicsLayerManager);
    enable(): void;
    disable(): void;
    /** Re-read settings and re-apply declutter at the current zoom level. */
    refresh(): void;
    /** Call when the map view switches between 2D and 3D. */
    onViewChanged(newView: MapView | SceneView): void;
    destroy(): void;
    private _attachZoomWatcher;
    private _onZoomChange;
    private _applyAnnotations;
    private _annotZoomThreshold;
    private _annotMinScale;
    private _annotDensity;
    private _annotOff;
    private _applySymbols;
    /**
     * Show/hide symbols based on their echelon and the ZoomLvlEchelon map.
     * Echelon "00" (no echelon assigned) is always treated as visible.
     */
    private _applyEchelon;
    /** Extract 2-char echelon code from a graphic's attributes. */
    private _getEchelon;
    /** After echelon visibility is applied, hide annotations for hidden parent symbols. */
    private _syncAnnotationsToSymbolVisibility;
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
