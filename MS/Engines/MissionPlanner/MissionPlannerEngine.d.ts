/**
 * MissionPlannerEngine.ts
 * Unified tactical terrain dashboard for military planners.
 *
 * Orchestrates LocalPeaksEngine, KeyTerrainIdentificationEngine, DeadGroundMapper,
 * PosDefScorerEngine, OpRankerEngine, and OcokaEngine to answer commander-level
 * questions: best defensive positions, concealed approaches, observation
 * dominance, overwatch placement, and anti-armor positions.
 *
 * Public interface aligned with LocalPeaksEngine (initialize / open / openWidget /
 * close / destroy / runAnalysis / runHeadless / clearResults / generateReport).
 */
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Extent from '@arcgis/core/geometry/Extent';
import Polygon from '@arcgis/core/geometry/Polygon';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
export type MissionMode = 'defensive' | 'offensive' | 'recon' | 'route' | 'ambush';
export type UnitType = 'infantry' | 'mechanized' | 'aviation';
export type ObserverSide = 'friendly' | 'enemy';
type CautionLevel = 'info' | 'warn' | 'danger';
export interface MissionCaution {
    level: CautionLevel;
    text: string;
}
export interface MissionTerrainFeature {
    id: number;
    rank: number;
    type: string;
    name: string;
    point: Point;
    mgrs: string;
    elevationM: number;
    prominenceM: number;
    elevationAdvantageM: number;
    viewshedPct: number;
    deadGroundPct: number;
    defensibilityScore: number;
    mobilityInfluenceScore: number;
    corridorControlScore: number;
    ambushScore: number;
    exposureToEnemyPct: number;
    marchTimeMin: number;
    bearingToThreatDeg: number;
    elevationProfile: number[];
    compositeScore: number;
    recommendedUse: string;
    cautions: MissionCaution[];
}
export interface MissionPlannerHeadlessOptions {
    aoi?: Polygon | Extent;
    center?: Point;
    radiusM?: number;
    mode?: MissionMode;
    unit?: UnitType;
    threatBearingDeg?: number;
    observers?: {
        side: ObserverSide;
        point: Point;
    }[];
    maxResults?: number;
}
export declare class MissionPlannerEngine {
    static readonly FEATURE_LAYER_ID = "mission-planner-ranked-features";
    static readonly AO_LAYER_ID = "mission-planner-ao";
    static readonly OBSERVER_LAYER_ID = "mission-planner-observers";
    static readonly CORRIDOR_LAYER_ID = "mission-planner-corridor-influence";
    static readonly LABEL_LAYER_ID = "mission-planner-labels";
    static readonly SNAPSHOT_LAYER_ID = "mission-planner-report-snapshot";
    static readonly FIRES_LAYER_ID = "mission-planner-fires";
    static readonly HOSTILE_OBS_LAYER_ID = "mission-planner-hostile-obs";
    static readonly WITHDRAWAL_LAYER_ID = "mission-planner-withdrawal";
    private _view;
    private _selectedGraphic;
    private _panelEl;
    private _featureLayer;
    private _aoLayer;
    private _observerLayer;
    private _corridorLayer;
    private _labelLayer;
    private _snapshotLayer;
    private _firesLayer;
    private _hostileObsLayer;
    private _withdrawalLayer;
    private _localPeaks;
    private _keyTerrain;
    private _deadGround;
    private _posDef;
    private _opRanker;
    private _ocoka;
    private _observers;
    private _results;
    private _corridors;
    private _hostileObsExtents;
    private _roadEgress;
    private _coaSnapshots;
    private _customAoi;
    private _bufferCenter;
    private _sketch;
    private _bufferPickHandle;
    private _viewWatchHandle;
    private _autoTimer;
    private _running;
    private _isDragging;
    private _dragOffsetX;
    private _dragOffsetY;
    private _threatBearingOverridden;
    private _ctxProvider;
    constructor();
    initialize(view: MapView | SceneView): void;
    onViewChanged(view: MapView | SceneView): void;
    open(graphic?: Graphic, view?: MapView | SceneView): void;
    openWidget(view?: MapView | SceneView): void;
    close(): void;
    destroy(): void;
    runAnalysis(): Promise<void>;
    runHeadless(options?: MissionPlannerHeadlessOptions): Promise<MissionTerrainFeature[]>;
    clearResults(updateUi?: boolean): void;
    generateReport(): string;
    private _ensureSketch;
    private _resolveAoi;
    private _bufferGeometry;
    private _startDraw;
    private _startBufferPick;
    private _cancelBufferPick;
    private _drawBufferAoi;
    private _drawAoi;
    private _styleAoiGraphic;
    private _aoiSymbol;
    private _mergeCandidates;
    private _blankFeature;
    private _scoreCandidate;
    private _corridorInfluence;
    /** Fraction of nearby enemy LOS extents the candidate falls inside (0–100). */
    private _exposureToEnemy;
    private _pointInExtent;
    private _sampleSparkline;
    private _marchTimeMin;
    private _recommendUse;
    private _buildCautions;
    private _nearestFriendlyKm;
    private _drawCorridors;
    private _drawResults;
    private _drawFiresFans;
    /**
     * Lazily reach the shared, OPTIONAL road-network adapter. It is owned by
     * SymbolEngine and only present when the external pgRouting service is wired
     * in; may also be offline. Returns null when absent — callers must degrade.
     */
    private _roadNet;
    private _drawWithdrawal;
    /**
     * If the optional road-network service is reachable, overlay a road-following
     * egress route with drive-time and GO/SLOW-GO/NO-GO trafficability on top of
     * the terrain corridor, and cache the summary for the Mobility tab. Returns
     * quietly when the adapter is absent, disabled, offline, or finds no route —
     * MissionPlanner carries on with the terrain corridor it already drew.
     */
    private _tryRoadEgress;
    private _buildHostileObservation;
    private _activeObservers;
    private _addObserver;
    /** Public helper used by ContextMenuManager pin-from-map provider. */
    pinObserverFromGraphic(graphic: Graphic, side: ObserverSide): void;
    private _currentThreatBearing;
    private _derivedThreatBearing;
    private _updateThreatBearingFromEnemies;
    private _resolveCenter;
    private _ensurePanel;
    private _buildPanelHTML;
    private _bindPanelEvents;
    private _activateTab;
    private _renderObservers;
    private _renderResults;
    private _sparklineSVG;
    private _renderReport;
    /** Mobility-tab readout of the optional road service. Mirrors its availability honestly. */
    private _roadSummaryHtml;
    private _renderForces;
    private _renderCoas;
    private _saveCoa;
    private _syncAutoRun;
    private _detachAutoRun;
    private _maybeAutoRun;
    private _scheduleAutoRun;
    private _setStatus;
    private _setRunDisabled;
    private _registerCtxProvider;
    private _toCsv;
    private _toGeoJson;
    private _exportShapefile;
    private _buildPointShapefile;
    private _writeShapeHeader;
    private _shapeBounds;
    private _buildDbf;
    private _writeAscii;
    private _downloadText;
    private _downloadBlob;
    private _makeDraggable;
    private _onDragMove;
    private _onDragEnd;
    private _el;
    private _num;
    private _checked;
    private _selectValue;
    private _setSelectValue;
    private _injectStyles;
}
export default MissionPlannerEngine;
