import Graphic from "@arcgis/core/Graphic";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import type { DeclutterEngine } from "../Declutter/DeclutterEngine";
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
    neutralFillColor: number[];
    fillOpacity: number;
    outlineWidth: number;
}
export interface RenderOptions {
    /** Use ArcGIS SceneView high quality profile in 3D */
    highQuality3D: boolean;
    /** Disable 3D direct shadows and ambient occlusion */
    disableSceneShadows: boolean;
    /** Use high quality SceneView atmosphere rendering in 3D */
    highAtmosphereQuality: boolean;
    /** @deprecated legacy "lift everything" flag — superseded by the three per-kind toggles below. */
    liftSymbolsFromGround?: boolean;
    /** Lift force/UEI point symbols above terrain */
    liftForcePoints: boolean;
    /** Lift tactical point symbols above terrain */
    liftTacticalPoints: boolean;
    /** Lift tactical line/area graphics above terrain */
    liftLinesAreas: boolean;
    /** Elevation offset (metres) used when a lift flag is enabled */
    symbolElevationOffset: number;
    /** Draw vertical drop lines from lifted force points down to terrain (3D only) */
    forcePointDropLines: boolean;
    dropLineColor: number[];
    dropLineWidth: number;
    dropLineOpacity: number;
}
export interface ExtrudedFootprintsOptions {
    enabled: boolean;
    /** Extrude polygon (area) graphics into 3D blocks */
    extrudePolygons: boolean;
    /** Block height in metres for extruded polygons */
    polygonHeightM: number;
    /** Show solid edges on extruded polygons */
    polygonShowEdges: boolean;
    /** Extrude polyline graphics into vertical walls */
    extrudeLines: boolean;
    /** Wall height in metres for extruded lines */
    lineWallHeightM: number;
    /** Wall thickness in metres (PathSymbol3DLayer width) */
    lineWallThicknessM: number;
    /** Fill opacity for extruded faces (0–1) */
    fillOpacity: number;
    /** Source for the extrusion colour */
    colorMode: "identity" | "inherit" | "single";
    /** Used when colorMode === "single" */
    singleColor: number[];
    /** Edge colour for SolidEdges3D */
    edgeColor: number[];
}
/**
 * "Aggregate" mode: when the view zooms out past the threshold (where
 * DeclutterEngine typically hides individual symbols), automatically surface
 * analytical summaries (hull / grid) so the user still sees force disposition
 * instead of an empty map. User-toggled overlays are unaffected; this only
 * adds overlays on top.
 */
export interface AggregateOptions {
    enabled: boolean;
    /** Auto-show analytical summary when view zoom is below this level */
    zoomBelow: number;
    /** Include convex hull in the aggregate view */
    showHull: boolean;
    /** Include force-ratio grid in the aggregate view */
    showGrid: boolean;
}
export interface VisualizationOptions {
    render: RenderOptions;
    layerEffects: LayerEffectsOptions;
    coverageRings: CoverageRingsOptions;
    forceRatioGrid: ForceRatioGridOptions;
    convexHull: ConvexHullOptions;
    extrudedFootprints: ExtrudedFootprintsOptions;
    aggregate: AggregateOptions;
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
    private _declutter;
    private static readonly DECLUTTER_STEP_NAME;
    /** The SceneView that render settings target. Captured on first applyRenderSettings. */
    private _renderSceneView;
    /** SceneView defaults captured before any user overrides — used to revert. */
    private _initialSceneRenderState;
    /** Watcher that rebuilds drop lines whenever the FORCE layer's graphic count changes. */
    private _dropLineWatcher;
    private constructor();
    static getInstance(): VisualizationEngine;
    start(view: MapView | SceneView): void;
    enable(): void;
    disable(): void;
    get isEnabled(): boolean;
    toggle(): boolean;
    onViewChanged(view: MapView | SceneView): void;
    /** Force a refresh of all enabled overlays. Useful for external engines (e.g. EditEngine) after bulk geometry mutations. */
    refresh(): void;
    /**
     * Hook into DeclutterEngine's solve pipeline so analytical overlays refresh
     * in sync with declutter passes. Pure refresh trigger — no behavior change
     * beyond what aggregate mode already provides through the zoom watcher.
     * Call disconnectDeclutter() before swapping declutter instances.
     */
    connectDeclutter(declutter: DeclutterEngine): void;
    disconnectDeclutter(): void;
    setOptions(options: Partial<VisualizationOptions>): void;
    /**
     * Apply render settings (lift, drop lines, scene quality, shadows,
     * atmosphere) to the given SceneView. Safe to call before `start()` or
     * `enable()` — render settings are independent of overlay state. The
     * sceneView is cached so subsequent `setOptions({ render })` calls re-apply
     * automatically.
     *
     * `settings` may be either a partial RenderOptions object or the full
     * settings tree (with a `visualization.render` path) — both shapes are
     * accepted for compatibility with how `Settings.json` is structured.
     */
    applyRenderSettings(sceneView: SceneView, settings?: any): void;
    private _setupVizLayer;
    private _setupWatchers;
    private _clearWatchers;
    private _scheduleRefresh;
    private _refresh;
    /** True when aggregate mode is active for the current view zoom. */
    private _isInAggregateMode;
    private _applyLayerEffects;
    private _clearLayerEffects;
    private _computeCoverageRings;
    private _computeForceRatioGrid;
    private _ratioColor;
    private _lerpColor;
    private _computeConvexHull;
    private _computeExtrudedFootprints;
    /**
     * Draw time-distance threat projection rings centred on the given graphic.
     * Each entry in timeHoursIntervals produces a concentric circle whose radius
     * equals speedKmh × hours.  Outermost ring is drawn first (largest, behind).
     */
    showThreatFan(graphic: Graphic, speedKmh: number, timeHoursIntervals: number[]): void;
    /** Remove all threat-fan overlays */
    clearThreatFan(): void;
    private _captureInitialSceneRenderState;
    private _applyRenderSettings;
    /**
     * Move stray graphics back to the symbol layer that matches their
     * drawEssentials kind. Without this, symbols added before render settings
     * existed could end up on the wrong layer and resist elevation changes.
     */
    private _normalizeSymbolLayerMembership;
    private _getRenderLayerIdForGraphic;
    private _applySymbolElevationSettings;
    private _applyLayerElevation;
    private _getOrCreateDropLineLayer;
    private _rebuildForcePointDropLines;
    private _applyForcePointDropLines;
    private _clearVizLayer;
    private _getPointGraphics;
    /**
     * Filter graphics to those overlapping the current view extent, padded 1.5×
     * so symbols just off-screen still contribute (e.g. coverage rings reaching in).
     * Falls back to the full list if extent is unavailable or the SRs disagree.
     */
    private _filterByExtent;
    private _getIdentity;
}
export default VisualizationEngine;
