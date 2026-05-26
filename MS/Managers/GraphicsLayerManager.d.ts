import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
export declare const LAYER_NAMES: {
    FORCE: string;
    TACT_PT: string;
    TACT: string;
    SKETCH: string;
    ANNOTATION_LAYER: string;
    CLUSTER: string;
    LEADER_LINE: string;
    LADDER: string;
};
/**
 * Legacy layer id retained for backwards compatibility with the milsymbol.js
 * pipeline that adds 3-D unit/equipment graphics outside the standard
 * LAYER_NAMES set.  Lookups by id (e.g. context menu, selection, proximity)
 * must include this id alongside the modern symbol layers.
 */
export declare const LEGACY_MIL_SYMBOLS_LAYER_ID = "milSymbols";
/**
 * Canonical list of every layer id that holds drawable map symbols.
 * Use this anywhere code needs to scope an operation across "every symbol
 * layer" (selection, proximity, context menu, drawing-cue overlays, etc.).
 * The order is significant — context menu / selection lookups iterate in
 * priority order with FORCE first so unit symbols take precedence over
 * tactical graphics.
 */
export declare const SYMBOL_LAYER_IDS: readonly string[];
declare class GraphicsLayerManager {
    private static instances;
    private layers;
    private view;
    private viewId;
    private constructor();
    static getInstance(view: MapView | SceneView): GraphicsLayerManager;
    initializeLayers(): void;
    getSymbolLayer(): GraphicsLayer;
    getOrCreateLayer(layerName: string): GraphicsLayer;
    getLayer(layerName: string): GraphicsLayer | undefined;
    listLayers(): string[];
}
export default GraphicsLayerManager;
