import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Extent from '@arcgis/core/geometry/Extent';
export type FeatureType = 'dominant_ground' | 'ridge' | 'saddle' | 're_entrant' | 'spur';
export interface FeatureCandidate {
    r: number;
    c: number;
    type: FeatureType;
    typeScore: number;
    elev: number;
    prom: number;
    lap: number;
    plan: number;
    prof: number;
}
export interface RankedFeature extends FeatureCandidate {
    lon: number;
    lat: number;
    viewshedRaw: number;
    viewshedPct: number;
    viewshedNorm: number;
    compositeScore: number;
    rank: number;
    depth?: number;
    ridgeBearing?: number;
    /** Set when the feature sits on the reachable road network (controls a movement avenue). */
    controlsRoute?: boolean;
}
export type KeyTerrainFeature = RankedFeature;
export interface KeyTerrainHeadlessOptions {
    center?: Point | {
        longitude: number;
        latitude: number;
    };
    extent?: Extent;
    radiusM?: number;
    cellM?: number;
    maxFeatures?: number;
    sensitivity?: number;
    wantHills?: boolean;
    wantSaddles?: boolean;
    wantReents?: boolean;
    wantSpurs?: boolean;
}
export declare class KeyTerrainIdentificationEngine {
    static readonly MARKER_LAYER_ID = "key-terrain-markers";
    static readonly CENTER_LAYER_ID = "key-terrain-center";
    private _view;
    private _markerLayer;
    private _centerLayer;
    private _curvatureLayer;
    private _viewshedLayer;
    private _controlPanelEl;
    private _listPanelEl;
    private _clickHandle;
    private _running;
    private _centreSet;
    private _picking;
    private _hintTimer;
    private _dragOffsetX;
    private _dragOffsetY;
    private _isDragging;
    private _subDragCleanup;
    private _overlayState;
    constructor();
    initialize(view: MapView | SceneView): void;
    open(graphic?: Graphic | null, view?: MapView | SceneView): void;
    close(): void;
    destroy(): void;
    runHeadless(options?: KeyTerrainHeadlessOptions): Promise<KeyTerrainFeature[]>;
    private _createLayers;
    private _ensurePanels;
    private _bindPanelEvents;
    private _showPanels;
    private _hidePanels;
    private _bindMapClick;
    private _unbindMapClick;
    private _runAnalysis;
    private _sampleGrid;
    private _gaussianSmooth;
    private _computeCurvature;
    private _computeProminence;
    private _detectFeatures;
    private _scoreViewsheds;
    private _scoreFeatures;
    private _buildCurvatureHeatmap;
    private _buildFeatureMarkers;
    private _buildTopViewshedGraphic;
    /** Lazily reach the shared (optional) road-network adapter — may be absent. */
    private _roadNet;
    /** Flatten a GeoJSON Line/MultiLineString into a single [lng,lat][] list. */
    private _flattenLineCoords;
    private _haversineM;
    /**
     * Opportunistically promote terrain that controls movement. Pulls a drive-time
     * service area from the AO centre off the optional road service and boosts the
     * composite score of passes / avenues / dominant ground / ridges that sit on
     * the reachable road network — terrain that commands a road is more "key".
     * Re-sorts and re-ranks when anything was boosted.
     *
     * Fully degradable: a missing/down service is a no-op and the pure-terrain
     * ranking stands. Never throws.
     */
    private _enrichFeaturesWithRoads;
    private _renderFeatureList;
    private _estimateRidgeBearing;
    private _syncOverlayVisibility;
    /** Current value of the overlay-opacity slider (falls back to the default). */
    private _currentOpacity;
    /** Apply the slider opacity to every overlay layer live (no rebuild needed). */
    private _applyOverlayOpacity;
    private _clearResults;
    private _clearAll;
    private _setAnalysisCentreMarker;
    private _makeDraggable;
    private _onDragMove;
    private _onDragEnd;
    private _makeSubDraggable;
    /** Enter "pick a centre on the map" mode — highlight the button and flash a hint. */
    private _beginPicking;
    /** Leave picking mode — restore the button label and clear the hint. */
    private _endPicking;
    /**
     * Show a transient tip in the panel's hint slot. `isError` styles it as a
     * warning; `autoHideMs` (default 4000) auto-clears it — pass 0 to keep it
     * visible until the next call, or pass a tiny value to hide immediately.
     */
    private _flashHint;
    private _setStatus;
    private _setProgress;
    private _tick;
    private _el;
    private _input;
    private _select;
    private _setText;
}
export default KeyTerrainIdentificationEngine;
