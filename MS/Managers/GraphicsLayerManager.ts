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
let _glmViewSeq = 0;
class GraphicsLayerManager {
    private static instances: Map<string, GraphicsLayerManager> = new Map();
    private layers: Map<string, GraphicsLayer> = new Map();
    private view: MapView | SceneView;
    private viewId: string;

    private constructor(view: MapView | SceneView, viewId: string) {
        this.view = view;
        this.viewId = viewId;
    }

    // Factory method that returns the existing instance or creates a new one.
    public static getInstance(view: MapView | SceneView): GraphicsLayerManager {
        // Key by type + container id. Fall back to a stable per-view id (cached on
        // the view) rather than "unknown"/Date.now(), so two container-less views of
        // the same type can't collide onto one manager, and getInstance() and the
        // constructor agree on the same key.
        let containerId = view.container?.id;
        if (!containerId) {
            containerId = (view as any).__glmViewId
                || ((view as any).__glmViewId = `view-${++_glmViewSeq}`);
        }
        const viewId = `${view.type}-${containerId}`;

        const cached = this.instances.get(viewId);
        // Rebuild if the view was destroyed and recreated in the same container,
        // so we never return layers bound to a dead view.
        if (cached && cached.view === view) return cached;

        const mgr = new GraphicsLayerManager(view, viewId);
        this.instances.set(viewId, mgr);
        return mgr;
    }

    public initializeLayers(): void {
        // Initialize standard layers
        this.getOrCreateLayer(LAYER_NAMES.TACT);
        this.getOrCreateLayer(LAYER_NAMES.TACT_PT);
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
