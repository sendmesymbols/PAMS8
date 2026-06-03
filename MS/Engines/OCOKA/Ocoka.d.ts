/**
 * Ocoka.ts
 * OCOKA terrain-analysis widget focused on Avenues of Approach.
 */
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import { type TrafficabilitySummary } from '../Analysis/RoadNetworkEngine';
export type ForceType = 'dismount' | 'wheeled' | 'tracked' | 'mixed';
export interface OcokaPoint {
    longitude: number;
    latitude: number;
    elevationM?: number;
}
export interface OcokaWeights {
    width: number;
    mask: number;
    traf: number;
    obs: number;
    cc: number;
    obs2: number;
}
export interface OcokaHeadlessOptions {
    center?: OcokaPoint | Point;
    radiusM?: number;
    cellM?: number;
    maxCorridors?: number;
    slopeThresholdDeg?: number;
    force?: ForceType;
    weights?: Partial<OcokaWeights>;
}
interface OcokaScores {
    width: number;
    mask: number;
    traf: number;
    obs: number;
    cc: number;
    obst: number;
}
export interface OcokaCorridor {
    id: string;
    rank: number;
    seed: OcokaPoint;
    path: OcokaPoint[];
    chokePts: OcokaPoint[];
    widthM: number;
    lengthM: number;
    bearingDeg: number;
    composite: number;
    scores: OcokaScores;
    note: string;
    /** True when the corridor centreline was replaced by a real road route. */
    viaRoad?: boolean;
    /** Road-following distance (km), present only when viaRoad. */
    roadDistanceKm?: number;
    /** Road-following drive time (min), present only when viaRoad. */
    roadTimeMin?: number;
    /** Military trafficability of the routed approach, present only when viaRoad. */
    trafficability?: TrafficabilitySummary | null;
}
export declare class OcokaEngine {
    static readonly CORRIDOR_LAYER_ID = "ocoka-corridors";
    static readonly WIDTH_LAYER_ID = "ocoka-widths";
    static readonly CHOKE_LAYER_ID = "ocoka-chokepoints";
    static readonly LABEL_LAYER_ID = "ocoka-labels";
    static readonly AO_LAYER_ID = "ocoka-ao";
    static readonly HEAT_LAYER_ID = "ocoka-slope-heatmap";
    private _view;
    private _corridorLayer;
    private _widthLayer;
    private _chokeLayer;
    private _labelLayer;
    private _aoLayer;
    private _heatLayer;
    private _controlPanelEl;
    private _listPanelEl;
    private _hintEl;
    private _legendEl;
    private _clickHandle;
    private _running;
    private _pickMode;
    private _tooltipEl;
    private _tooltipTimer;
    private _isDragging;
    private _dragOffsetX;
    private _dragOffsetY;
    private _subDragCleanup;
    constructor();
    initialize(view: MapView | SceneView): void;
    open(graphic?: Graphic | null, view?: MapView | SceneView): void;
    runHeadless(options?: OcokaHeadlessOptions): Promise<OcokaCorridor[]>;
    close(): void;
    destroy(): void;
    private _createLayers;
    private _ensurePanels;
    private _weightControl;
    private _scoreKey;
    private _legendItem;
    private _bindPanelEvents;
    private _showPanels;
    private _hidePanels;
    private _bindMapClick;
    private _unbindMapClick;
    private _runAnalysis;
    private _readOptions;
    /** Weighted composite of the six OCOKA factor scores. */
    private _composite;
    /** Lazily reach the shared (optional) road-network adapter — may be absent. */
    private _roadNet;
    /** Flatten a GeoJSON Line/MultiLineString into a single [lng,lat][] list. */
    private _flattenLineCoords;
    /**
     * Opportunistically replace each synthetic corridor centreline with a real
     * road route from its perimeter entry to the AO centre, and re-derive the
     * trafficability score from the actual road classes traversed.
     *
     * Fully degradable: if the optional road service is absent or down, this is a
     * no-op and the synthetic corridors stand. A single failed route leaves that
     * corridor untouched while the rest still enrich. Never throws.
     */
    private _enrichCorridorsWithRoads;
    private _extractCorridors;
    private _drawCorridors;
    private _buildCorridorPolygon;
    private _drawSlopeOverlay;
    private _setAnalysisArea;
    private _renderRankedList;
    private _clearAll;
    private _clearResults;
    private _bearing;
    private _setStatus;
    private _setProgress;
    private _setRunDisabled;
    private _makeDraggable;
    private _onDragMove;
    private _onDragEnd;
    private _makeSubDraggable;
    private _el;
    private _input;
    private _num;
    private _checked;
    private _selectValue;
    private _setInputValue;
    private _setText;
    private _setHint;
    /** True when both lat and lon inputs hold a finite coordinate. */
    private _hasValidLocation;
    /** Enter "pick on map" mode — highlights the button and prompts the user. */
    private _beginPickMode;
    private _endPickMode;
    /** Show a transient tooltip bubble anchored under the Pick button. */
    private _flashTooltip;
    private _hideTooltip;
    private _tick;
}
export default OcokaEngine;
