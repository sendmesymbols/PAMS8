import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
export declare const LAYER_NAMES: {
    FORCE: string;
    TACT_PT: string;
    TACT: string;
    SKETCH: string;
    ANNOTATION_LAYER: string;
};
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
