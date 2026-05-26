import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";

// Export LAYER_NAMES directly
export const LAYER_NAMES = {
    FORCE: "ForceSymbolsLayer",
    TACT_PT: "TacticalPointSymbolsLayer",
    TACT: "TacticalSymbolsLayer",
    SKETCH: "SketchLayer",
    ANNOTATION_LAYER: "AnnotationLayer",
    CLUSTER: "ClusterBadgeLayer",
    LEADER_LINE: "LeaderLineLayer",
    LADDER: "LadderLineLayer",
};

/**
 * Legacy layer id retained for backwards compatibility with the milsymbol.js
 * pipeline that adds 3-D unit/equipment graphics outside the standard
 * LAYER_NAMES set.  Lookups by id (e.g. context menu, selection, proximity)
 * must include this id alongside the modern symbol layers.
 */
export const LEGACY_MIL_SYMBOLS_LAYER_ID = "milSymbols";

/**
 * Canonical list of every layer id that holds drawable map symbols.
 * Use this anywhere code needs to scope an operation across "every symbol
 * layer" (selection, proximity, context menu, drawing-cue overlays, etc.).
 * The order is significant — context menu / selection lookups iterate in
 * priority order with FORCE first so unit symbols take precedence over
 * tactical graphics.
 */
export const SYMBOL_LAYER_IDS: readonly string[] = [
    LAYER_NAMES.FORCE,
    LAYER_NAMES.TACT_PT,
    LAYER_NAMES.TACT,
    LEGACY_MIL_SYMBOLS_LAYER_ID,
];

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
        this.getOrCreateLayer(LAYER_NAMES.FORCE);
        this.getOrCreateLayer(LAYER_NAMES.ANNOTATION_LAYER);

        // Log layers to verify creation
        console.log("Available layers:", this.listLayers());
    }

    public getSymbolLayer(): GraphicsLayer {
        return this.getOrCreateLayer(LAYER_NAMES.FORCE);
    }



    public getOrCreateLayer(layerName: string): GraphicsLayer {
        if (this.layers.has(layerName)) {
            return this.layers.get(layerName)!;
        }

        // Reuse an existing map layer so graphics survive view switches
        const existing = this.view.map.findLayerById(layerName) as GraphicsLayer | null;
        if (existing) {
            this.layers.set(layerName, existing);
            return existing;
        }

        const layer = new GraphicsLayer({
            id: layerName,
            elevationInfo: { mode: "on-the-ground"}
        });

        this.view.map.add(layer);
        this.layers.set(layerName, layer);
        console.log(`Created new layer: ${layerName} for view: ${this.viewId}`);
        return layer;
    }

    public getLayer(layerName: string): GraphicsLayer | undefined {
        const cached = this.layers.get(layerName);
        if (cached) return cached;

        // Allow engines to target layers that were created outside this manager
        // (for example legacy / external layers already present on the map).
        const existing = this.view.map.findLayerById(layerName) as GraphicsLayer | null;
        if (existing) {
            this.layers.set(layerName, existing);
            return existing;
        }

        return undefined;
    }

    public listLayers(): string[] {
        return Array.from(this.layers.keys());
    }
}

// Default export for the class
export default GraphicsLayerManager;
