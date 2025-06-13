import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";

// Export LAYER_NAMES directly
export const LAYER_NAMES = {
    FORCE: "ForceSymbolsLayer",
    TACT_PT: "TacticalPointSymbolsLayer",
    TACT: "TacticalSymbolsLayer",
    SKETCH: "SketchLayer"
};

// Singleton pattern to ensure layers are created only once per view
class GraphicsLayerManager {
    private static instances: Map<string, GraphicsLayerManager> = new Map();
    private layers: Map<string, GraphicsLayer> = new Map();
    private view: MapView | SceneView;
    private viewId: string;

    private constructor(view: MapView | SceneView) {
        this.view = view;
        // Create a unique identifier for the view based on its type and container id
        this.viewId = `${view.type}-${view.container?.id || Date.now()}`;
    }

    // Factory method that returns the existing instance or creates a new one
    public static getInstance(view: MapView | SceneView): GraphicsLayerManager {
        // Generate view identifier based on type and other properties
        const viewType = view.type; // '2d' or '3d'
        const containerId = view.container?.id || "unknown";
        const viewId = `${viewType}-${containerId}`;

        if (!this.instances.has(viewId)) {
            this.instances.set(viewId, new GraphicsLayerManager(view));
        }

        return this.instances.get(viewId)!;
    }

    public initializeLayers(): void {
        // Initialize standard layers
        this.getOrCreateLayer(LAYER_NAMES.TACT);
        this.getOrCreateLayer(LAYER_NAMES.TACT_PT);
        this.getOrCreateLayer(LAYER_NAMES.TACT);

        // Log layers to verify creation
        console.log("Available layers:", this.listLayers());
    }

    public getOrCreateLayer(layerName: string): GraphicsLayer {
        if (this.layers.has(layerName)) {
            return this.layers.get(layerName)!;
        }

        const layer = new GraphicsLayer({
            id: layerName,
            // Add elevation info for 3D views
            elevationInfo: this.view.type === "3d"
                ? { mode: "relative-to-ground", offset: 10 }
                : undefined
        });

        this.view.map.add(layer);
        this.layers.set(layerName, layer);
        console.log(`Created new layer: ${layerName} for view: ${this.viewId}`);
        return layer;
    }

    public getLayer(layerName: string): GraphicsLayer | undefined {
        return this.layers.get(layerName);
    }

    public listLayers(): string[] {
        return Array.from(this.layers.keys());
    }
}

// Default export for the class
export default GraphicsLayerManager;
