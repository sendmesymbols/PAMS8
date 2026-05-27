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
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Point from '@arcgis/core/geometry/Point';
import Polyline from '@arcgis/core/geometry/Polyline';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils';
import EngineLogger from '../../Support/EngineLogger';

const ENGINE_NAME = 'RoadNetworkEngine';

/** Broadcast on `document` whenever availability transitions. */
export const ROAD_NETWORK_STATUS_EVENT = 'road-network:status';

// ──────────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────────

export type RoadNetworkAvailability = 'unknown' | 'available' | 'unavailable';

/** Why a request did not return data — lets callers tailor the degraded path. */
export type RoadFailureReason =
  | 'disabled' //   engine turned off in settings
  | 'unavailable' // health probe says backend is down
  | 'timeout' //    request aborted after timeoutMs
  | 'network' //    fetch rejected (CORS, DNS, refused, offline)
  | 'bad-request' //400 — bad/insufficient coordinates
  | 'no-route' //   404 — no nearby vertex or no path between points
  | 'server' //     5xx
  | 'parse' //      response was not the JSON/GeoJSON we expected
  | 'bad-input'; // caller passed a point we could not resolve to lng/lat

export type RoadResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: RoadFailureReason; error: string; status?: number };

/** A point this engine can route from/to: lng/lat object, [lng,lat], ArcGIS Point, or a Graphic. */
export type PointLike =
  | Point
  | Graphic
  | { longitude: number; latitude: number }
  | { x: number; y: number; spatialReference?: any }
  | [number, number];

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

// ── Road classification → military trafficability ─────────────────────────
// Roads matter to manoeuvre planning by their class: a column's speed, the
// heaviest vehicle that can pass, and all-weather usability all key off it.
// We map OSM `fclass` to a GO / SLOW-GO / NO-GO tier plus a NATO-style
// route-type hint (X = all-weather, Y = limited all-weather, Z = fair-weather).

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
export const ROAD_CLASS_INFO: Record<string, RoadClassInfo> = {
  motorway: { label: 'Motorway', trafficability: 'GO', routeType: 'X', rank: 1, color: [214, 69, 65] },
  motorway_link: { label: 'Motorway link', trafficability: 'GO', routeType: 'X', rank: 1, color: [214, 69, 65] },
  trunk: { label: 'Trunk', trafficability: 'GO', routeType: 'X', rank: 2, color: [243, 146, 55] },
  trunk_link: { label: 'Trunk link', trafficability: 'GO', routeType: 'X', rank: 2, color: [243, 146, 55] },
  primary: { label: 'Primary', trafficability: 'GO', routeType: 'Y', rank: 3, color: [250, 198, 80] },
  primary_link: { label: 'Primary link', trafficability: 'GO', routeType: 'Y', rank: 3, color: [250, 198, 80] },
  secondary: { label: 'Secondary', trafficability: 'SLOW-GO', routeType: 'Y', rank: 4, color: [180, 180, 90] },
  secondary_link: { label: 'Secondary link', trafficability: 'SLOW-GO', routeType: 'Y', rank: 4, color: [180, 180, 90] },
  tertiary: { label: 'Tertiary', trafficability: 'SLOW-GO', routeType: 'Z', rank: 5, color: [150, 150, 150] },
  tertiary_link: { label: 'Tertiary link', trafficability: 'SLOW-GO', routeType: 'Z', rank: 5, color: [150, 150, 150] },
  unclassified: { label: 'Unclassified', trafficability: 'SLOW-GO', routeType: 'Z', rank: 6, color: [130, 130, 130] },
  residential: { label: 'Residential', trafficability: 'SLOW-GO', routeType: 'Z', rank: 6, color: [130, 130, 130] },
  service: { label: 'Service', trafficability: 'SLOW-GO', routeType: 'Z', rank: 7, color: [120, 120, 120] },
  track: { label: 'Track', trafficability: 'NO-GO', routeType: 'Z', rank: 8, color: [120, 90, 60] },
  path: { label: 'Path', trafficability: 'NO-GO', routeType: 'Z', rank: 9, color: [120, 90, 60] },
};

export const DEFAULT_ROAD_CLASS_INFO: RoadClassInfo = {
  label: 'Unknown',
  trafficability: 'SLOW-GO',
  routeType: 'Z',
  rank: 6,
  color: [130, 130, 130],
};

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

export const DEFAULT_ROAD_NETWORK_CONFIG: RoadNetworkConfig = {
  apiBaseUrl: '/api',
  dataBaseUrl: '/data',
  timeoutMs: 8000,
  availabilityTtlMs: 30_000,
  healthRetries: 1,
  enabled: true,
};

type StatusListener = (state: RoadNetworkAvailability, info: HealthData | null) => void;

// ──────────────────────────────────────────────────────────────────────────
// Engine
// ──────────────────────────────────────────────────────────────────────────

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
  static readonly ROADS_LAYER_ID = 'road-network-roads';
  static readonly OVERLAY_LAYER_ID = 'road-network-overlays';

  private _view: MapView | SceneView | null = null;
  private _cfg: RoadNetworkConfig;

  private _availability: RoadNetworkAvailability = 'unknown';
  private _lastHealth: HealthData | null = null;
  private _lastProbeAt = 0;
  /** De-dupes concurrent health probes into one in-flight request. */
  private _healthInFlight: Promise<RoadResult<HealthData>> | null = null;

  private _statusListeners = new Set<StatusListener>();
  private _roadsLayer: any = null;
  private _overlayLayer: GraphicsLayer | null = null;

  constructor(config: Partial<RoadNetworkConfig> = {}) {
    this._cfg = { ...DEFAULT_ROAD_NETWORK_CONFIG, ...RoadNetworkEngine._defined(config) };
  }

  /** Drop undefined keys so a partial settings object can't clobber defaults with `undefined`. */
  private static _defined<T extends object>(o: T): Partial<T> {
    return Object.fromEntries(
      Object.entries(o).filter(([, v]) => v !== undefined),
    ) as Partial<T>;
  }

  // ── Lifecycle (registry-compatible) ──────────────────────────────────────

  /** Store the view. Does NOT probe the backend — probing is lazy. */
  initialize(view: MapView | SceneView): void {
    this._view = view;
  }

  /** Re-attach on 2D↔3D switch; move the roads + overlay layers to the new map. */
  onViewChanged(view: MapView | SceneView): void {
    const wasShowing = !!this._roadsLayer;
    if (wasShowing) this.hideRoadsLayer();
    // GraphicsLayer keeps its graphics; just move it between maps.
    const overlay = this._overlayLayer;
    if (overlay) this._view?.map?.remove(overlay);
    this._view = view;
    if (wasShowing) void this.showRoadsLayer();
    if (overlay) this._view?.map?.add(overlay);
  }

  destroy(): void {
    this.hideRoadsLayer();
    this.clearOverlays();
    if (this._overlayLayer && this._view?.map) {
      try {
        this._view.map.remove(this._overlayLayer);
      } catch {
        /* view may already be torn down */
      }
    }
    this._overlayLayer = null;
    this._statusListeners.clear();
    this._healthInFlight = null;
    this._view = null;
  }

  // ── Config & status ──────────────────────────────────────────────────────

  get config(): Readonly<RoadNetworkConfig> {
    return this._cfg;
  }

  /** Last known availability (may be stale — call `ensureAvailable()` to refresh). */
  get availability(): RoadNetworkAvailability {
    return this._availability;
  }

  /** Convenience: last known state is 'available'. */
  get isAvailable(): boolean {
    return this._availability === 'available';
  }

  /** Last successful health payload (e.g. edge count), or null if never/again down. */
  get lastHealth(): HealthData | null {
    return this._lastHealth;
  }

  /** Patch config at runtime (e.g. from settingsChanged). A URL change forces a re-probe. */
  updateConfig(patch: Partial<RoadNetworkConfig>): void {
    const clean = RoadNetworkEngine._defined(patch);
    const urlChanged =
      (clean.apiBaseUrl !== undefined && clean.apiBaseUrl !== this._cfg.apiBaseUrl) ||
      (clean.enabled !== undefined && clean.enabled !== this._cfg.enabled);
    this._cfg = { ...this._cfg, ...clean };
    if (urlChanged) {
      this._lastProbeAt = 0; // invalidate cache
      if (!this._cfg.enabled) this._setStatus('unavailable', null);
    }
  }

  /** Subscribe to availability transitions. Returns an unsubscribe fn. */
  onStatusChange(listener: StatusListener): () => void {
    this._statusListeners.add(listener);
    return () => this._statusListeners.delete(listener);
  }

  // ── Availability probing ─────────────────────────────────────────────────

  /**
   * Probe `/health`, honouring the TTL cache. `force` ignores the cache.
   * Never throws; updates and returns the cached availability state.
   */
  async ensureAvailable(force = false): Promise<boolean> {
    if (!this._cfg.enabled) {
      this._setStatus('unavailable', null);
      return false;
    }
    const fresh = Date.now() - this._lastProbeAt < this._cfg.availabilityTtlMs;
    if (!force && fresh && this._availability !== 'unknown') {
      return this._availability === 'available';
    }
    const res = await this.health();
    return res.ok;
  }

  /** Direct health check (de-duplicated, retried). Updates availability state. */
  async health(): Promise<RoadResult<HealthData>> {
    if (!this._cfg.enabled) {
      return { ok: false, reason: 'disabled', error: 'Road network engine is disabled' };
    }
    if (this._healthInFlight) return this._healthInFlight;

    this._healthInFlight = (async () => {
      let last: RoadResult<HealthData> = {
        ok: false,
        reason: 'network',
        error: 'health probe not attempted',
      };
      for (let attempt = 0; attempt <= this._cfg.healthRetries; attempt++) {
        const res = await this._request<any>('/health');
        if (res.ok) {
          const edges = Number(res.data?.edges) || 0;
          const data: HealthData = { edges };
          this._lastProbeAt = Date.now();
          this._setStatus('available', data);
          return { ok: true, data } as RoadResult<HealthData>;
        }
        last = res;
        // Only retry transient classes.
        if (res.reason !== 'network' && res.reason !== 'timeout') break;
      }
      this._lastProbeAt = Date.now();
      this._setStatus('unavailable', null);
      return last;
    })();

    try {
      return await this._healthInFlight;
    } finally {
      this._healthInFlight = null;
    }
  }

  // ── Core operations ──────────────────────────────────────────────────────

  /**
   * Shortest-TIME route between two points along the real road network.
   * Resolves the points to lng/lat, gates on availability, and returns a
   * `RoadResult`. Callers degrade to straight-line on `ok === false`.
   */
  async route(from: PointLike, to: PointLike): Promise<RoadResult<RouteData>> {
    const a = this._toLngLat(from);
    const b = this._toLngLat(to);
    if (!a || !b) {
      return { ok: false, reason: 'bad-input', error: 'Could not resolve start/end to lng/lat' };
    }
    const gate = await this._gate();
    if (gate) return gate;

    const qs = `fromLng=${a.lng}&fromLat=${a.lat}&toLng=${b.lng}&toLat=${b.lat}`;
    const res = await this._request<any>(`/route?${qs}`);
    if (!res.ok) {
      this._maybeMarkDown(res.reason);
      EngineLogger.error(ENGINE_NAME, `Route failed (${res.reason}): ${res.error}`);
      return res;
    }

    const f = res.data;
    const geom = f?.geometry;
    if (!geom || !Array.isArray(geom.coordinates)) {
      return { ok: false, reason: 'parse', error: 'Route response missing geometry' };
    }
    const p = f.properties || {};
    const byClass: RouteClassBreakdown[] = Array.isArray(p.by_class)
      ? p.by_class.map((c: any) => ({ fclass: String(c.fclass ?? ''), km: Number(c.km) || 0 }))
      : [];
    const data: RouteData = {
      distanceKm: Number(p.distance_km) || 0,
      travelTimeMin: Number(p.travel_time_min) || 0,
      byClass,
      trafficability: RoadNetworkEngine.classifyRoute(byClass),
      steps: Array.isArray(p.steps)
        ? p.steps.map((s: any) => ({
            name: String(s.name ?? '(unnamed road)'),
            fclass: String(s.fclass ?? ''),
            km: Number(s.km) || 0,
            min: Number(s.min) || 0,
          }))
        : [],
      geometry: geom as GeoJsonLineGeometry,
    };
    EngineLogger.success(
      ENGINE_NAME,
      `Route: ${data.distanceKm} km, ${data.travelTimeMin} min, ${data.steps.length} legs`,
    );
    return { ok: true, data };
  }

  /**
   * Drive-time service area (isochrone) — the road network reachable from a
   * point within `minutes`. Returns geometry (or null geometry if nothing is
   * reachable, which is still `ok`).
   */
  async serviceArea(origin: PointLike, minutes: number): Promise<RoadResult<ServiceAreaData>> {
    const o = this._toLngLat(origin);
    if (!o) return { ok: false, reason: 'bad-input', error: 'Could not resolve origin to lng/lat' };
    const m = Number(minutes);
    if (!Number.isFinite(m) || m <= 0) {
      return { ok: false, reason: 'bad-input', error: 'minutes must be a positive number' };
    }
    const gate = await this._gate();
    if (gate) return gate;

    const res = await this._request<any>(`/service-area?lng=${o.lng}&lat=${o.lat}&minutes=${m}`);
    if (!res.ok) {
      this._maybeMarkDown(res.reason);
      EngineLogger.error(ENGINE_NAME, `Service area failed (${res.reason}): ${res.error}`);
      return res;
    }
    const geom = res.data?.geometry ?? null;
    EngineLogger.success(ENGINE_NAME, `Service area ${m} min computed`);
    return { ok: true, data: { minutes: m, geometry: geom as GeoJsonLineGeometry | null } };
  }

  // ── Optional reference roads layer (display/snapping) ────────────────────

  /**
   * Load the display roads GeoJSON as a reference layer. Best-effort: a missing
   * file or failed load is logged and swallowed — never throws.
   */
  async showRoadsLayer(): Promise<boolean> {
    if (!this._view) return false;
    if (this._roadsLayer) return true;
    try {
      const { default: GeoJSONLayer } = await import('@arcgis/core/layers/GeoJSONLayer');
      const layer = new GeoJSONLayer({
        id: RoadNetworkEngine.ROADS_LAYER_ID,
        url: `${this._cfg.dataBaseUrl}/roads.geojson`,
        title: 'Road network (reference)',
        listMode: 'hide',
        renderer: {
          type: 'simple',
          symbol: { type: 'simple-line', color: [120, 120, 120, 0.7], width: 0.8 },
        } as any,
      });
      this._roadsLayer = layer;
      this._view.map.add(layer);
      // Surface load failures without throwing.
      layer.load().catch((e: any) => {
        EngineLogger.error(ENGINE_NAME, `Roads layer failed to load: ${e?.message ?? e}`);
        this.hideRoadsLayer();
      });
      return true;
    } catch (e: any) {
      EngineLogger.error(ENGINE_NAME, `Could not create roads layer: ${e?.message ?? e}`);
      return false;
    }
  }

  hideRoadsLayer(): void {
    if (this._roadsLayer && this._view?.map) {
      try {
        this._view.map.remove(this._roadsLayer);
      } catch {
        /* view may already be torn down */
      }
    }
    this._roadsLayer = null;
  }

  // ── Result overlays (route / service area) ───────────────────────────────

  /**
   * Compute AND render a route between two points. Resolves to the same
   * `RoadResult` as `route()`, so callers still get the summary/steps and can
   * branch on `ok` — rendering is a side-effect that only happens on success.
   */
  async drawRoute(from: PointLike, to: PointLike, opts: DrawOptions = {}): Promise<RoadResult<RouteData>> {
    const res = await this.route(from, to);
    if (!res.ok) return res;
    const layer = this._ensureOverlayLayer();
    if (!layer) return res; // no view to render into — data still returned
    if (opts.clearPrevious !== false) this.clearOverlays();

    const line = RoadNetworkEngine.toPolyline(res.data.geometry);
    if (line) {
      layer.add(
        new Graphic({
          geometry: line,
          symbol: {
            type: 'simple-line',
            color: opts.color ?? [0, 121, 193],
            width: opts.width ?? 4,
          } as any,
          attributes: { roadnet: 'route', kind: 'route' },
        }),
      );
    }
    if (opts.markers !== false) {
      const a = this._toLngLat(from);
      const b = this._toLngLat(to);
      if (a) layer.add(this._marker(a, [40, 170, 90]));
      if (b) layer.add(this._marker(b, [214, 69, 65]));
    }
    return res;
  }

  /**
   * Compute AND render a drive-time service area (isochrone). Returns the same
   * `RoadResult` as `serviceArea()`.
   */
  async drawServiceArea(
    origin: PointLike,
    minutes: number,
    opts: DrawOptions = {},
  ): Promise<RoadResult<ServiceAreaData>> {
    const res = await this.serviceArea(origin, minutes);
    if (!res.ok) return res;
    const layer = this._ensureOverlayLayer();
    if (!layer) return res;
    if (opts.clearPrevious !== false) this.clearOverlays();

    const line = RoadNetworkEngine.toPolyline(res.data.geometry);
    if (line) {
      layer.add(
        new Graphic({
          geometry: line,
          symbol: {
            type: 'simple-line',
            color: opts.color ?? [120, 60, 200],
            width: opts.width ?? 1.6,
          } as any,
          attributes: { roadnet: 'service-area', kind: 'service-area', minutes: res.data.minutes },
        }),
      );
    }
    if (opts.markers !== false) {
      const o = this._toLngLat(origin);
      if (o) layer.add(this._marker(o, [120, 60, 200]));
    }
    return res;
  }

  /** Remove all rendered route/service-area overlays (keeps the reference roads layer). */
  clearOverlays(): void {
    this._overlayLayer?.removeAll();
  }

  private _ensureOverlayLayer(): GraphicsLayer | null {
    if (!this._view) return null;
    if (!this._overlayLayer) {
      this._overlayLayer = new GraphicsLayer({
        id: RoadNetworkEngine.OVERLAY_LAYER_ID,
        title: 'Road network results',
        listMode: 'hide',
      });
      this._view.map.add(this._overlayLayer);
    }
    return this._overlayLayer;
  }

  private _marker(p: { lng: number; lat: number }, color: [number, number, number]): Graphic {
    return new Graphic({
      geometry: new Point({ longitude: p.lng, latitude: p.lat, spatialReference: { wkid: 4326 } as any }),
      symbol: {
        type: 'simple-marker',
        color,
        size: 9,
        outline: { color: [255, 255, 255], width: 1.5 },
      } as any,
      attributes: { roadnet: 'marker' },
    });
  }

  // ── Static classification helpers (trafficability) ───────────────────────

  /** Trafficability info for a single OSM road class (falls back to a SLOW-GO default). */
  static classifyClass(fclass: string): RoadClassInfo {
    return ROAD_CLASS_INFO[fclass] ?? DEFAULT_ROAD_CLASS_INFO;
  }

  /**
   * Summarise the military trafficability of a route from its per-class
   * distance breakdown. The overall rating is the worst tier present — a route
   * is only as trafficable as its weakest segment — and the limiting class is
   * the most restrictive road it traverses (the planning bottleneck).
   */
  static classifyRoute(byClass: RouteClassBreakdown[]): TrafficabilitySummary {
    const tierKm: Record<Trafficability, number> = { GO: 0, 'SLOW-GO': 0, 'NO-GO': 0 };
    let totalKm = 0;
    let limiting = { fclass: '', rank: -1 };
    let dominant = { fclass: '', km: -1 };

    for (const c of byClass) {
      const info = RoadNetworkEngine.classifyClass(c.fclass);
      totalKm += c.km;
      tierKm[info.trafficability] += c.km;
      if (info.rank > limiting.rank) limiting = { fclass: c.fclass, rank: info.rank };
      if (c.km > dominant.km) dominant = { fclass: c.fclass, km: c.km };
    }

    const classes: TrafficabilityClassBreakdown[] = byClass
      .map((c) => ({
        ...c,
        info: RoadNetworkEngine.classifyClass(c.fclass),
        pct: totalKm > 0 ? (c.km / totalKm) * 100 : 0,
      }))
      .sort((a, b) => b.km - a.km);

    const rating: Trafficability =
      tierKm['NO-GO'] > 0 ? 'NO-GO' : tierKm['SLOW-GO'] > 0 ? 'SLOW-GO' : 'GO';

    return { rating, limitingClass: limiting.fclass, dominantClass: dominant.fclass, totalKm, tierKm, classes };
  }

  // ── Static geometry helpers (GeoJSON → ArcGIS) ───────────────────────────

  /** GeoJSON Line/MultiLineString (EPSG:4326) → ArcGIS Polyline. Returns null on bad input. */
  static toPolyline(geometry: GeoJsonLineGeometry | null | undefined): Polyline | null {
    if (!geometry || !Array.isArray(geometry.coordinates)) return null;
    const paths =
      geometry.type === 'MultiLineString'
        ? (geometry.coordinates as number[][][])
        : [geometry.coordinates as number[][]];
    return new Polyline({ paths: paths as any, spatialReference: { wkid: 4326 } as any });
  }

  /** Convenience: wrap a route's geometry in a ready-to-add Graphic. */
  static toRouteGraphic(data: RouteData, symbol?: any): Graphic | null {
    const geom = RoadNetworkEngine.toPolyline(data.geometry);
    if (!geom) return null;
    return new Graphic({
      geometry: geom,
      symbol: symbol ?? { type: 'simple-line', color: [0, 121, 193], width: 4 },
      attributes: {
        roadnet: true,
        distance_km: data.distanceKm,
        travel_time_min: data.travelTimeMin,
      },
    });
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /**
   * Pre-flight gate shared by route/serviceArea: if disabled or the backend is
   * known/probed-down, return a failure result; otherwise null (proceed).
   */
  private async _gate(): Promise<RoadResult<never> | null> {
    if (!this._cfg.enabled) {
      return { ok: false, reason: 'disabled', error: 'Road network engine is disabled' };
    }
    const up = await this.ensureAvailable();
    if (!up) {
      return {
        ok: false,
        reason: 'unavailable',
        error: 'Road network service is unavailable',
      };
    }
    return null;
  }

  /** A failed op on what we thought was an up backend may mean it just went down. */
  private _maybeMarkDown(reason: RoadFailureReason): void {
    if (reason === 'network' || reason === 'timeout' || reason === 'server') {
      this._lastProbeAt = 0; // force a fresh probe next time
      this._setStatus('unavailable', null);
    }
  }

  private _setStatus(state: RoadNetworkAvailability, info: HealthData | null): void {
    this._lastHealth = info;
    if (state === this._availability) return;
    this._availability = state;
    if (state === 'available') {
      EngineLogger.success(ENGINE_NAME, `Road network online${info ? ` (${info.edges} edges)` : ''}`);
    } else if (state === 'unavailable') {
      EngineLogger.nextStep(ENGINE_NAME, 'Road network offline — features degrade to straight-line');
    }
    this._statusListeners.forEach((l) => {
      try {
        l(state, info);
      } catch {
        /* listener errors must not break the engine */
      }
    });
    try {
      document.dispatchEvent(
        new CustomEvent(ROAD_NETWORK_STATUS_EVENT, {
          detail: { state, info },
          bubbles: true,
        }),
      );
    } catch {
      /* non-DOM context */
    }
  }

  /**
   * The single fetch path: timeout via AbortController, status→reason mapping,
   * JSON parse guard. Always resolves to a RoadResult — never throws.
   */
  private async _request<T>(path: string): Promise<RoadResult<T>> {
    const url = `${this._cfg.apiBaseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._cfg.timeoutMs);
    let resp: Response;
    try {
      resp = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    } catch (e: any) {
      clearTimeout(timer);
      if (e?.name === 'AbortError') {
        return { ok: false, reason: 'timeout', error: `Timed out after ${this._cfg.timeoutMs} ms` };
      }
      return { ok: false, reason: 'network', error: e?.message ?? 'Network request failed' };
    }
    clearTimeout(timer);

    let body: any = null;
    try {
      body = await resp.json();
    } catch {
      if (resp.ok) return { ok: false, reason: 'parse', error: 'Response was not valid JSON' };
    }

    if (!resp.ok) {
      const msg = body?.error || `HTTP ${resp.status}`;
      const reason: RoadFailureReason =
        resp.status === 400
          ? 'bad-request'
          : resp.status === 404
            ? 'no-route'
            : resp.status >= 500
              ? 'server'
              : 'network';
      return { ok: false, reason, error: msg, status: resp.status };
    }
    return { ok: true, data: body as T };
  }

  /** Normalise any PointLike to plain {lng,lat} in EPSG:4326, or null if impossible. */
  private _toLngLat(p: PointLike): { lng: number; lat: number } | null {
    if (!p) return null;

    // Graphic → its geometry
    if (p instanceof Graphic || (p as any).geometry) {
      return this._toLngLat((p as any).geometry);
    }

    // [lng, lat]
    if (Array.isArray(p)) {
      const [lng, lat] = p;
      return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
    }

    const anyP = p as any;

    // ArcGIS Point or anything exposing longitude/latitude (auto-filled for geographic/web-mercator)
    if (Number.isFinite(anyP.longitude) && Number.isFinite(anyP.latitude)) {
      return { lng: anyP.longitude, lat: anyP.latitude };
    }

    // Projected x/y → try to convert from web mercator; else assume already lng/lat (wkid 4326)
    if (Number.isFinite(anyP.x) && Number.isFinite(anyP.y)) {
      const sr = anyP.spatialReference;
      if (sr && (sr.isWebMercator || sr.wkid === 3857 || sr.wkid === 102100)) {
        try {
          const geo = webMercatorUtils.webMercatorToGeographic(
            new Point({ x: anyP.x, y: anyP.y, spatialReference: sr }),
          ) as Point;
          if (geo && Number.isFinite(geo.x) && Number.isFinite(geo.y)) {
            return { lng: geo.x, lat: geo.y };
          }
        } catch {
          /* fall through */
        }
      }
      if (!sr || sr.wkid === 4326) return { lng: anyP.x, lat: anyP.y };
    }

    return null;
  }
}
