import Graphic from "@arcgis/core/Graphic";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
export interface LayerEffectsOptions {
    enabled: boolean;
    /** ArcGIS CSS-filter effect string for the FORCE layer (UEI symbols) */
    forceEffect: string;
    /** ArcGIS CSS-filter effect string for the TACT_PT layer */
    tactPtEffect: string;
    /** ArcGIS CSS-filter effect string for the TACT layer */
    tactEffect: string;
}
export interface CoverageRingsOptions {
    enabled: boolean;
    /** Buffer radius in kilometres around each point symbol */
    radiusKm: number;
    /** Highlight contested zones where friendly and enemy rings overlap */
    showOverlap: boolean;
    friendlyColor: number[];
    enemyColor: number[];
    overlapColor: number[];
    fillOpacity: number;
    outlineWidth: number;
}
export interface ForceRatioGridOptions {
    enabled: boolean;
    /** Approximate grid cell side-length in kilometres */
    cellSizeKm: number;
    /** Fill colour when friendly dominates (>= 1.5:1 ratio) */
    favorableColor: number[];
    /** Fill colour when forces are roughly equal */
    parityColor: number[];
    /** Fill colour when enemy dominates (>= 1.5:1 ratio) */
    unfavorableColor: number[];
    fillOpacity: number;
}
export interface ConvexHullOptions {
    enabled: boolean;
    friendlyFillColor: number[];
    enemyFillColor: number[];
    fillOpacity: number;
    outlineWidth: number;
}
export interface VisualizationOptions {
    layerEffects: LayerEffectsOptions;
    coverageRings: CoverageRingsOptions;
    forceRatioGrid: ForceRatioGridOptions;
    convexHull: ConvexHullOptions;
}
export declare class VisualizationEngine {
    private static _instance;
    private _view;
    private _layerManager;
    private _vizLayer;
    private _options;
    private _watchers;
    private _refreshTimer;
    private _enabled;
    private constructor();
    static getInstance(): VisualizationEngine;
    start(view: MapView | SceneView): void;
    enable(): void;
    disable(): void;
    get isEnabled(): boolean;
    toggle(): boolean;
    onViewChanged(view: MapView | SceneView): void;
    setOptions(options: Partial<VisualizationOptions>): void;
    private _setupVizLayer;
    private _setupWatchers;
    private _clearWatchers;
    private _scheduleRefresh;
    private _refresh;
    private _applyLayerEffects;
    private _clearLayerEffects;
    private _computeCoverageRings;
    private _computeForceRatioGrid;
    private _ratioColor;
    private _lerpColor;
    private _computeConvexHull;
    /**
     * Draw time-distance threat projection rings centred on the given graphic.
     * Each entry in timeHoursIntervals produces a concentric circle whose radius
     * equals speedKmh × hours.  Outermost ring is drawn first (largest, behind).
     */
    showThreatFan(graphic: Graphic, speedKmh: number, timeHoursIntervals: number[]): void;
    /** Remove all threat-fan overlays */
    clearThreatFan(): void;
    private _clearVizLayer;
    private _getPointGraphics;
    private _getIdentity;
}
export default VisualizationEngine;
