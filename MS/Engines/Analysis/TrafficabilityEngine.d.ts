/**
 * TrafficabilityEngine.ts
 * The go-to widget for trafficability, reachability, and road-network route
 * planning. A draggable panel (styled after TrajectoryEngine) that sits on top
 * of the optional external pgRouting service exposed by {@link RoadNetworkEngine}.
 *
 * Three modes share one panel:
 *   • Service Area — multi-band drive-time isochrones from an origin. Each band
 *     renders the road network reachable within N minutes, coloured near→far.
 *   • Route — the shortest-time road-following path between an origin and a
 *     destination, with distance, travel time, a military trafficability
 *     rating (GO / SLOW-GO / NO-GO) and turn-by-turn legs.
 *   • MSR — Main Supply Route finding across a chain of waypoints. Routes each
 *     leg on roads, merges them, classifies the result as an MSR / ASR and
 *     flags the trafficability bottleneck.
 *
 * EXPRESSIVE OUTPUT:
 *   • Smart callouts — floating, colour-coded info cards anchored to map points
 *     (origin / destination / waypoints / the live vehicle). They track the map
 *     as it pans and zoom via `view.toScreen`.
 *   • Play scrubber — animates a vehicle along a route/MSR, reading out elapsed
 *     time, current speed and the road class it is travelling, leg by leg.
 *
 * GRACEFUL DEGRADATION (core contract):
 *   The road service is optional and intermittent. This widget NEVER blocks:
 *     • Service Area, offline → geodesic range rings (assumed speed × minutes).
 *     • Route / MSR, offline → straight-line great-circle legs with speed-based
 *       ETA. Estimated values are flagged with *.
 *   A live status badge reflects RoadNetworkEngine availability and flips
 *   without polling via its `onStatusChange` listener.
 *
 * Rendering uses the widget's OWN GraphicsLayers (not the shared RoadNetwork
 * overlay) so band colouring, markers, the vehicle, and committing are all
 * under the widget's control — it only consumes `route()` / `serviceArea()`.
 *
 * Layers:
 *   trafficability-analysis   — live working layer (cleared on every run)
 *   trafficability-markers    — origin / destination / waypoint / vehicle markers
 *   trafficability-committed  — persisted results after "Commit"
 */
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import Graphic from '@arcgis/core/Graphic';
import RoadNetworkEngine from './RoadNetworkEngine';
export type ReachMode = 'serviceArea' | 'route' | 'msr';
export declare class TrafficabilityEngine {
    static readonly ANALYSIS_LAYER_ID = "trafficability-analysis";
    static readonly MARKER_LAYER_ID = "trafficability-markers";
    static readonly COMMITTED_LAYER_ID = "trafficability-committed";
    private _view;
    private _analysisLayer;
    private _markerLayer;
    private _committedLayer;
    private _origin;
    private _dest;
    /** Ordered MSR waypoints (first = Start Point, last = Release Point). */
    private _waypoints;
    private _mode;
    private _panelEl;
    private _clickHandle;
    private _placeMode;
    private _running;
    /** Time/speed model for the current route or MSR (null in service-area mode). */
    private _driveModel;
    /** Route mode: the primary + alternate routes, and which one is active. */
    private _routeOptions;
    private _selectedRoute;
    private _vehicleGraphic;
    private _animFrame;
    private _animRunning;
    private _animStartMs;
    private _animStartElapsedMin;
    private _animRateMinPerSec;
    private _calloutHost;
    private _callouts;
    private _vehicleCallout;
    private _viewWatchHandle;
    /** Optional explicit road-network adapter; falls back to the shared one. */
    private _roadNetOverride;
    private _statusUnsub;
    private _dragOffsetX;
    private _dragOffsetY;
    private _isDragging;
    constructor();
    initialize(view: MapView | SceneView): void;
    /** Re-attach on 2D↔3D switch; move the three layers + callout host to the new map. */
    onViewChanged(view: MapView | SceneView): void;
    /**
     * Open the widget. If `graphic` is supplied its location becomes the origin;
     * otherwise the user is prompted to pick an origin on the map.
     * Optionally inject a specific RoadNetworkEngine (else the shared one is used).
     */
    open(graphic?: Graphic | null, view?: MapView | SceneView, roadNet?: RoadNetworkEngine): void;
    close(): void;
    destroy(): void;
    /** Reach the road-network adapter: explicit override, else the shared one. */
    private _roadNet;
    private _subscribeRoadStatus;
    private _unsubscribeRoadStatus;
    private _createLayers;
    private _haversineM;
    private _destinationPoint;
    /** Geodesic ring of [lng,lat] coords for a circle of radius metres. */
    private _ringCoords;
    /** Flatten a GeoJSON Line/MultiLineString into a single [lng,lat][] list. */
    private _flattenGeoJson;
    /** Total length (km) of a GeoJSON Line/MultiLineString via summed haversine. */
    private _geoJsonLengthKm;
    /** Linear-ish ramp green → amber → orange → red for t in [0,1]. */
    private _rampColor;
    private _trafficColor;
    private _is3D;
    private _lineSymbol;
    private _fillSymbol;
    private _markerSymbol;
    private _geomToPoint;
    private _drawOriginMarker;
    private _drawDestMarker;
    private _drawWaypointMarkers;
    private _removeMarkers;
    private _run;
    private _runServiceArea;
    private _runRoute;
    /** Shared offline fallback for route mode: straight-line great-circle + ETA. */
    private _renderStraightLineEstimate;
    private _runMsr;
    /** Classify an MSR/ASR from its aggregate trafficability. */
    private _msrClassification;
    /**
     * Route a chain of points (origin→via…→dest) leg by leg on the road network,
     * merging into one path + ordered leg list + aggregate trafficability. Each
     * failed leg degrades to a straight-line estimate. Shared by Route alternates
     * and MSR finding. Never throws.
     */
    private _routeChain;
    /** Candidate via points offset perpendicular to the O→D line, alternating sides. */
    private _viaPoints;
    /** Repaint all Route-mode options: selected one tier-coloured + emphasised, others dim. */
    private _paintRoutes;
    /** Render the selectable list of route options (primary + alternates). */
    private _renderRoutesList;
    /** Draw a path coloured per-segment by GO/SLOW-GO/NO-GO tier, over a dark casing. */
    private _renderTieredPath;
    /** Extract the sub-path between two cumulative distances (interpolated endpoints). */
    private _pathSlice;
    /** Thin, dim line for a non-selected alternate route. */
    private _renderDimRoute;
    /** Per-leg list with a trafficability-tier coloured dot. */
    private _renderSegList;
    /** Legend of the GO/SLOW-GO/NO-GO tiers present along the route. */
    private _renderTierLegend;
    private _bearing;
    private _hexToRgb;
    private _tierColorRgb;
    private _renderTrafficability;
    private _renderBandLegend;
    private _renderWaypointList;
    private _startOriginPlacement;
    private _startDestPlacement;
    /** MSR: a single click handler that appends a waypoint on every click. */
    private _startWaypointPlacement;
    private _finishWaypointPlacement;
    /** Light dashed preview through the current waypoints while still placing. */
    private _drawWaypointPreview;
    private _setWaypointBtn;
    private _cancelPlacement;
    private _pickMapPoint;
    private _ensureCalloutHost;
    private _teardownCalloutHost;
    private _addCallout;
    private _clearCallouts;
    private _repositionCallouts;
    private _addRouteSummaryCallout;
    private _segsFromSteps;
    private _buildDriveModel;
    /** Sample position / speed / road at elapsed minutes along the drive model. */
    private _driveSampleAt;
    private _interpAlong;
    private _showScrubber;
    private _hideScrubber;
    private _setupVehicleCallout;
    private _seekDrive;
    private _playDrive;
    private _toggleDrive;
    private _pauseDrive;
    private _stopDrive;
    private _fmtClock;
    private _setMode;
    private _syncModeUI;
    private _commit;
    private _clear;
    private _clearStats;
    private _refreshRoadBadge;
    private _showPanel;
    private _hidePanel;
    private _buildPanelHTML;
    private _bindPanelEvents;
    private _makeDraggable;
    private _onDragMove;
    private _onDragEnd;
    private _setStatus;
    private _setRunDisabled;
    private _setCommitDisabled;
    private _setSourceNote;
    private _setText;
    private _inp;
    private _escape;
    private _injectStyles;
}
export default TrafficabilityEngine;
