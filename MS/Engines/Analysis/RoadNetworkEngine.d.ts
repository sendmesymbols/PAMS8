/**
 * RoadNetworkEngine.ts
 * Adapter for an EXTERNAL pgRouting road-network service (PostGIS + pgRouting,
 * see D:\Roads\Network\webgis). Gives the rest of PAMS8 real road-following
 * routing and drive-time service areas on an actual graph, instead of the
 * straight-line / great-circle approximations the other engines use today.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * DESIGN CONTRACT — this backend is OPTIONAL and INTERMITTENT.
 * ──────────────────────────────────────────────────────────────────────────
 * The road service is a separate Docker stack that may or may not be running.
 * It must NEVER be a show-stopper for PAMS8:
 *   • No method throws. Every call resolves to a discriminated `RoadResult`
 *     ({ ok:true, data } | { ok:false, reason, error }).
 *   • Availability is probed lazily, cached with a TTL, and de-duplicated so a
 *     dead backend costs at most one short, aborted request per TTL window.
 *   • Callers are expected to: if available → use it; if not → show the error,
 *     degrade to their own (straight-line) behaviour, and carry on.
 *   • Status changes are broadcast (EngineLogger + a `road-network:status`
 *     CustomEvent) so widgets can flip a badge without polling.
 *
 * The engine is UI-agnostic: it returns raw GeoJSON plus static helpers to turn
 * a result into an ArcGIS polyline/Graphic, so headless callers (CorridorEngine,
 * MissionPlannerEngine, MeasurementEngine) and panel callers share one path.
 *
 * Backend API surface consumed (the only endpoints that exist):
 *   GET /health                                  → { ok, edges }
 *   GET /route?fromLng&fromLat&toLng&toLat       → Feature(MultiLineString) + props
 *   GET /service-area?lng&lat&minutes            → Feature(MultiLineString|null)
 * All responses are EPSG:4326 GeoJSON.
 */
import type MapView from '@arcgis/core/views/MapView';
import type SceneView from '@arcgis/core/views/SceneView';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polyline from '@arcgis/core/geometry/Polyline';
/** Broadcast on `document` whenever availability transitions. */
export declare const ROAD_NETWORK_STATUS_EVENT = "road-network:status";
export type RoadNetworkAvailability = 'unknown' | 'available' | 'unavailable';
/** Why a request did not return data — lets callers tailor the degraded path. */
export type RoadFailureReason = 'disabled' | 'unavailable' | 'timeout' | 'network' | 'bad-request' | 'no-route' | 'server' | 'parse' | 'bad-input';
export type RoadResult<T> = {
    ok: true;
    data: T;
} | {
    ok: false;
    reason: RoadFailureReason;
    error: string;
    status?: number;
};
/** A point this engine can route from/to: lng/lat object, [lng,lat], ArcGIS Point, or a Graphic. */
export type PointLike = Point | Graphic | {
    longitude: number;
    latitude: number;
} | {
    x: number;
    y: number;
    spatialReference?: any;
} | [number, number];
export interface RouteStep {
    name: string;
    fclass: string;
    km: number;
    min: number;
}
export interface RouteClassBreakdown {
    fclass: string;
    km: number;
}
export type Trafficability = 'GO' | 'SLOW-GO' | 'NO-GO';
export interface RoadClassInfo {
    label: string;
    trafficability: Trafficability;
    /** NATO-style route classification: X all-weather, Y limited, Z fair-weather. */
    routeType: 'X' | 'Y' | 'Z';
    /** Severity rank — higher = more restrictive; used to find the limiting class. */
    rank: number;
    color: [number, number, number];
}
/** Trafficability by OSM fclass. Unknown classes fall back to DEFAULT_ROAD_CLASS_INFO. */
export declare const ROAD_CLASS_INFO: Record<string, RoadClassInfo>;
export declare const DEFAULT_ROAD_CLASS_INFO: RoadClassInfo;
export interface TrafficabilityClassBreakdown extends RouteClassBreakdown {
    info: RoadClassInfo;
    /** Share of total route distance, 0–100. */
    pct: number;
}
export interface TrafficabilitySummary {
    /** Worst tier present along the route (the route is only as good as its weakest link). */
    rating: Trafficability;
    /** Most restrictive class encountered — the trafficability bottleneck. */
    limitingClass: string;
    /** Class carrying the most distance. */
    dominantClass: string;
    totalKm: number;
    /** Km per trafficability tier. */
    tierKm: Record<Trafficability, number>;
    /** Enriched, distance-sorted class breakdown. */
    classes: TrafficabilityClassBreakdown[];
}
export interface RouteData {
    distanceKm: number;
    travelTimeMin: number;
    byClass: RouteClassBreakdown[];
    /** Military trafficability assessment derived from the road-class breakdown. */
    trafficability: TrafficabilitySummary;
    steps: RouteStep[];
    /** Raw GeoJSON geometry (MultiLineString, EPSG:4326). */
    geometry: GeoJsonLineGeometry;
}
export interface ServiceAreaData {
    minutes: number;
    /** Reachable road network as GeoJSON (MultiLineString/LineString, EPSG:4326), or null if none. */
    geometry: GeoJsonLineGeometry | null;
}
export interface HealthData {
    edges: number;
}
interface GeoJsonLineGeometry {
    type: 'LineString' | 'MultiLineString';
    coordinates: number[][] | number[][][];
}
export interface RoadNetworkConfig {
    /**
     * Base URL of the routing API. Default `/api` assumes a same-origin reverse
     * proxy (Vite dev proxy or shared nginx). For a direct cross-origin call set
     * e.g. `http://localhost:8080/api` AND enable CORS on the Express service.
     */
    apiBaseUrl: string;
    /** Base URL serving the display GeoJSON (roads/admin). Default `/data`. */
    dataBaseUrl: string;
    /** Per-request timeout in ms. */
    timeoutMs: number;
    /** How long a health result is trusted before re-probing. */
    availabilityTtlMs: number;
    /** Retry attempts for the health probe only (transient network blips). */
    healthRetries: number;
    /** Master enable flag (wired to settings). When false, every call short-circuits to `disabled`. */
    enabled: boolean;
}
export declare const DEFAULT_ROAD_NETWORK_CONFIG: RoadNetworkConfig;
type StatusListener = (state: RoadNetworkAvailability, info: HealthData | null) => void;
/** Styling overrides for rendered overlays (route / service area). */
export interface DrawOptions {
    /** Clear previously drawn overlays of the same kind first (default true). */
    clearPrevious?: boolean;
    color?: [number, number, number] | [number, number, number, number];
    width?: number;
    /** Drop start/end (route) or origin (service area) markers (default true). */
    markers?: boolean;
}
export default class RoadNetworkEngine {
    static readonly ROADS_LAYER_ID = "road-network-roads";
    static readonly OVERLAY_LAYER_ID = "road-network-overlays";
    private _view;
    private _cfg;
    private _availability;
    private _lastHealth;
    private _lastProbeAt;
    /** De-dupes concurrent health probes into one in-flight request. */
    private _healthInFlight;
    private _statusListeners;
    private _roadsLayer;
    private _overlayLayer;
    constructor(config?: Partial<RoadNetworkConfig>);
    /** Drop undefined keys so a partial settings object can't clobber defaults with `undefined`. */
    private static _defined;
    /** Store the view. Does NOT probe the backend — probing is lazy. */
    initialize(view: MapView | SceneView): void;
    /** Re-attach on 2D↔3D switch; move the roads + overlay layers to the new map. */
    onViewChanged(view: MapView | SceneView): void;
    destroy(): void;
    get config(): Readonly<RoadNetworkConfig>;
    /** Last known availability (may be stale — call `ensureAvailable()` to refresh). */
    get availability(): RoadNetworkAvailability;
    /** Convenience: last known state is 'available'. */
    get isAvailable(): boolean;
    /** Last successful health payload (e.g. edge count), or null if never/again down. */
    get lastHealth(): HealthData | null;
    /** Patch config at runtime (e.g. from settingsChanged). A URL change forces a re-probe. */
    updateConfig(patch: Partial<RoadNetworkConfig>): void;
    /** Subscribe to availability transitions. Returns an unsubscribe fn. */
    onStatusChange(listener: StatusListener): () => void;
    /**
     * Probe `/health`, honouring the TTL cache. `force` ignores the cache.
     * Never throws; updates and returns the cached availability state.
     */
    ensureAvailable(force?: boolean): Promise<boolean>;
    /** Direct health check (de-duplicated, retried). Updates availability state. */
    health(): Promise<RoadResult<HealthData>>;
    /**
     * Shortest-TIME route between two points along the real road network.
     * Resolves the points to lng/lat, gates on availability, and returns a
     * `RoadResult`. Callers degrade to straight-line on `ok === false`.
     */
    route(from: PointLike, to: PointLike): Promise<RoadResult<RouteData>>;
    /**
     * Drive-time service area (isochrone) — the road network reachable from a
     * point within `minutes`. Returns geometry (or null geometry if nothing is
     * reachable, which is still `ok`).
     */
    serviceArea(origin: PointLike, minutes: number): Promise<RoadResult<ServiceAreaData>>;
    /**
     * Load the display roads GeoJSON as a reference layer. Best-effort: a missing
     * file or failed load is logged and swallowed — never throws.
     */
    showRoadsLayer(): Promise<boolean>;
    hideRoadsLayer(): void;
    /**
     * Compute AND render a route between two points. Resolves to the same
     * `RoadResult` as `route()`, so callers still get the summary/steps and can
     * branch on `ok` — rendering is a side-effect that only happens on success.
     */
    drawRoute(from: PointLike, to: PointLike, opts?: DrawOptions): Promise<RoadResult<RouteData>>;
    /**
     * Compute AND render a drive-time service area (isochrone). Returns the same
     * `RoadResult` as `serviceArea()`.
     */
    drawServiceArea(origin: PointLike, minutes: number, opts?: DrawOptions): Promise<RoadResult<ServiceAreaData>>;
    /** Remove all rendered route/service-area overlays (keeps the reference roads layer). */
    clearOverlays(): void;
    private _ensureOverlayLayer;
    private _marker;
    /** Trafficability info for a single OSM road class (falls back to a SLOW-GO default). */
    static classifyClass(fclass: string): RoadClassInfo;
    /**
     * Summarise the military trafficability of a route from its per-class
     * distance breakdown. The overall rating is the worst tier present — a route
     * is only as trafficable as its weakest segment — and the limiting class is
     * the most restrictive road it traverses (the planning bottleneck).
     */
    static classifyRoute(byClass: RouteClassBreakdown[]): TrafficabilitySummary;
    /** GeoJSON Line/MultiLineString (EPSG:4326) → ArcGIS Polyline. Returns null on bad input. */
    static toPolyline(geometry: GeoJsonLineGeometry | null | undefined): Polyline | null;
    /** Convenience: wrap a route's geometry in a ready-to-add Graphic. */
    static toRouteGraphic(data: RouteData, symbol?: any): Graphic | null;
    /**
     * Pre-flight gate shared by route/serviceArea: if disabled or the backend is
     * known/probed-down, return a failure result; otherwise null (proceed).
     */
    private _gate;
    /** A failed op on what we thought was an up backend may mean it just went down. */
    private _maybeMarkDown;
    private _setStatus;
    /**
     * The single fetch path: timeout via AbortController, status→reason mapping,
     * JSON parse guard. Always resolves to a RoadResult — never throws.
     */
    private _request;
    /** Normalise any PointLike to plain {lng,lat} in EPSG:4326, or null if impossible. */
    private _toLngLat;
}
export {};
