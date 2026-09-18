/**
 * RoadNetworkEngine.ts
 * Adapter for an ArcGIS Server **Network Analyst** service (NAServer) published
 * from a Pakistan-wide osm2po road network. Gives the rest of PAMS8 real
 * road-following routing and drive-time service areas on an actual network
 * dataset, instead of the straight-line / great-circle approximations the other
 * engines use today.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * DESIGN CONTRACT — this backend is OPTIONAL and INTERMITTENT.
 * ──────────────────────────────────────────────────────────────────────────
 * ArcGIS Server may or may not be reachable.
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
 * The engine is UI-agnostic: it returns GeoJSON-shaped geometry plus static
 * helpers to turn a result into an ArcGIS polyline/Graphic, so headless callers
 * (CorridorEngine, MissionPlannerEngine, MeasurementEngine) and panel callers
 * share one path. Everything it hands out is EPSG:4326.
 *
 * ── Backend surface consumed ──────────────────────────────────────────────
 *   GET  <naServerUrl>?f=json                      → capability probe: which
 *                                                    Route / Service Area layers exist
 *   POST <naServerUrl>/<routeLayer>/solve          → route geometry, totals, directions
 *   POST <naServerUrl>/<saLayer>/solveServiceArea  → drive-time lines (only if published)
 *   POST <roadsLayerUrl>/<id>/query                → road-class enrichment (see below)
 *
 * ── Why the extra road-class query ────────────────────────────────────────
 * A Network Analyst solve returns geometry, totals and turn-by-turn directions
 * — but NOT the class of each road traversed, which is exactly what military
 * trafficability (GO / SLOW-GO / NO-GO, MSR vs ASR) is built on. So after a
 * solve we sample the route at a fixed spacing, ask the source roads layer for
 * edges within a few metres of those samples in ONE request, and attribute each
 * sample to its nearest edge's class. That yields both the per-class distance
 * breakdown and a class per direction step. It is best-effort: if it fails the
 * route still returns, just without trafficability.
 *
 * NOTE: ArcGIS REST reports failures as HTTP 200 with an `{ error: {...} }`
 * body, so HTTP status alone is not enough — see `_esri()`.
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
  | 'unsupported' //the service does not publish this capability (e.g. no Service Area layer)
  | 'timeout' //    request aborted after timeoutMs
  | 'network' //    fetch rejected (CORS, DNS, refused, offline)
  | 'bad-request' //bad/insufficient coordinates, or an ArcGIS parameter error
  | 'no-route' //   no nearby network element, or no path between the stops
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

/**
 * osm2po `CLAZZ` integer → the OSM `fclass` names keyed by ROAD_CLASS_INFO.
 * The network dataset behind the NAServer was built by osm2po, which encodes the
 * original `highway=*` tag as this integer. Translating back to the tag name is
 * what lets every existing consumer keep calling `classifyClass(fclass)` with no
 * change at all. Values confirmed against the published `pkroads` layer.
 */
export const OSM2PO_CLAZZ_TO_FCLASS: Record<number, string> = {
  11: 'motorway',
  12: 'motorway_link',
  13: 'trunk',
  14: 'trunk_link',
  15: 'primary',
  16: 'primary_link',
  21: 'secondary',
  22: 'secondary_link',
  31: 'tertiary',
  32: 'tertiary_link',
  41: 'residential',
  42: 'unclassified', // osm2po "road" — an unclassified carriageway
  43: 'unclassified',
  51: 'service',
  63: 'track',
  71: 'track',
  81: 'path',
  91: 'path',
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

/**
 * An area the solver must avoid (or grudgingly cross), handed to the Network
 * Analyst service as a polygon barrier. Unlike a via-point nudge, a `restrict`
 * barrier is enforced by the solver itself: every road inside is removed from
 * the graph, so the route physically cannot pass through — and if no way around
 * exists, the solve honestly reports no route instead of quietly cutting
 * through the threat.
 */
export interface RouteBarrier {
  /** Polygon rings in lng/lat (EPSG:4326), outer ring first, first point repeated last. */
  rings: number[][][];
  /** Optional label, surfaced in solver messages. */
  name?: string;
  /**
   * `restrict` (default) makes the area impassable. `slow` keeps it passable but
   * multiplies the cost of roads inside by `costFactor` — the right choice for
   * "observed but not denied" ground, where a detour may still beat driving around.
   */
  type?: 'restrict' | 'slow';
  /** Cost multiplier for `slow` barriers (e.g. 5 = crossing costs five times as much). */
  costFactor?: number;
}

/** Per-call solver options. */
export interface RouteOptions {
  /** Areas to avoid. Ignored when empty. */
  barriers?: RouteBarrier[];
}

export interface HealthData {
  /** Edge count when known. The NAServer exposes no cheap count, so this is 0. */
  edges: number;
  /** Service description reported by the NAServer. */
  name: string;
  /** Route layer discovered on the service. */
  routeLayer: string;
  /** Service Area layer discovered on the service, or '' when none is published. */
  serviceAreaLayer: string;
}

interface GeoJsonLineGeometry {
  type: 'LineString' | 'MultiLineString';
  coordinates: number[][] | number[][][];
}

export interface RoadNetworkConfig {
  /**
   * Base URL of the Network Analyst service, WITHOUT a trailing layer name —
   * e.g. `/roadnet/arcgis/rest/services/RoadNetwork/NAServer`. A same-origin
   * path assumes a reverse proxy (the Vite `/roadnet` proxy in dev). A direct
   * cross-origin URL additionally needs CORS allowed on ArcGIS Server and a
   * certificate the browser trusts.
   */
  naServerUrl: string;
  /** Route layer name on the NAServer. Auto-corrected from the capability probe. */
  routeLayer: string;
  /**
   * Service Area layer name. Empty means "auto-detect"; if the service
   * publishes none, `serviceArea()` resolves to `unsupported` and callers
   * degrade to their own range-ring estimates.
   */
  serviceAreaLayer: string;
  /** MapServer/FeatureServer holding the source roads, for display + class enrichment. */
  roadsLayerUrl: string;
  /** Sublayer id of the routable roads within `roadsLayerUrl`. */
  roadsSublayerId: number;
  /** Cost attribute to minimise. `Cost` is travel time; `Kilometers` is distance. */
  impedanceAttribute: string;
  /** Units of `impedanceAttribute` — needed to convert service-area breaks. */
  impedanceUnits: 'hours' | 'minutes' | 'seconds' | 'kilometers' | 'meters';
  /** Cost attribute accumulated alongside the impedance so we always get distance. */
  distanceAttribute: string;
  /** Integer road-class field on the roads layer (osm2po `CLAZZ`). */
  classFieldName: string;
  /** Run the road-class enrichment query after each solve (drives trafficability). */
  classifyRoutes: boolean;
  /** Max samples taken along a route for enrichment. Higher = finer, slower. */
  classifySamples: number;
  /** Search radius, in metres, from a sample to a candidate road edge. */
  classifyToleranceM: number;
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
  naServerUrl: '/roadnet/arcgis/rest/services/RoadNetwork/NAServer',
  routeLayer: 'Route',
  serviceAreaLayer: '',
  roadsLayerUrl: '/roadnet/arcgis/rest/services/RoadNetwork/MapServer',
  roadsSublayerId: 11,
  impedanceAttribute: 'Cost',
  impedanceUnits: 'hours',
  distanceAttribute: 'Kilometers',
  classFieldName: 'CLAZZ',
  classifyRoutes: true,
  classifySamples: 120,
  classifyToleranceM: 25,
  // Tactical-scale solves (tens of km) come back in well under a second, but
  // the network dataset is built with `useHierarchy: false`, so a cross-country
  // leg makes the solver walk the whole 2.5M-edge graph and can take tens of
  // seconds. This is the ceiling before we give up and let the caller fall back
  // to a straight-line estimate.
  timeoutMs: 30000,
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
  /** Areas the route must avoid — forwarded to the solver (routes only). */
  barriers?: RouteBarrier[];
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
      (clean.naServerUrl !== undefined && clean.naServerUrl !== this._cfg.naServerUrl) ||
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
        // The NAServer root doubles as the capability probe: it lists which
        // analysis layers were published, so we learn the Route layer's name and
        // whether service areas are available at all.
        const res = await this._esri<any>(this._cfg.naServerUrl, {}, 'GET');
        if (res.ok) {
          const routeLayers: string[] = Array.isArray(res.data?.routeLayers) ? res.data.routeLayers : [];
          const saLayers: string[] = Array.isArray(res.data?.serviceAreaLayers)
            ? res.data.serviceAreaLayers
            : [];
          if (!routeLayers.length) {
            last = {
              ok: false,
              reason: 'unsupported',
              error: 'Network Analyst service publishes no Route layer',
            };
            break;
          }
          // Trust the service over the configured names, but honour an explicit
          // choice when it actually exists there.
          const routeLayer = routeLayers.includes(this._cfg.routeLayer)
            ? this._cfg.routeLayer
            : routeLayers[0];
          const serviceAreaLayer =
            this._cfg.serviceAreaLayer && saLayers.includes(this._cfg.serviceAreaLayer)
              ? this._cfg.serviceAreaLayer
              : (saLayers[0] ?? '');
          this._cfg = { ...this._cfg, routeLayer, serviceAreaLayer };
          const data: HealthData = {
            edges: 0,
            name: String(res.data?.serviceDescription ?? '').trim() || 'Network Analyst',
            routeLayer,
            serviceAreaLayer,
          };
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

  /** True once a probe has found a Service Area layer on the service. */
  get supportsServiceArea(): boolean {
    return !!this._cfg.serviceAreaLayer;
  }

  // ── Core operations ──────────────────────────────────────────────────────

  /**
   * Shortest-TIME route between two points along the real road network.
   * Resolves the points to lng/lat, gates on availability, and returns a
   * `RoadResult`. Callers degrade to straight-line on `ok === false`.
   */
  async route(from: PointLike, to: PointLike, opts: RouteOptions = {}): Promise<RoadResult<RouteData>> {
    const a = this._toLngLat(from);
    const b = this._toLngLat(to);
    if (!a || !b) {
      return { ok: false, reason: 'bad-input', error: 'Could not resolve start/end to lng/lat' };
    }
    const gate = await this._gate();
    if (gate) return gate;

    const barriers = RoadNetworkEngine._barrierFeatureSet(opts.barriers);

    // A stop sitting inside a restriction barrier can never be routed from, and
    // the solver only reports "No solution found" — useless to a planner. Catch
    // it here and name the real problem, without spending a round trip.
    const restricted = (opts.barriers ?? []).filter((bar) => (bar.type ?? 'restrict') === 'restrict');
    const startIn = restricted.find((bar) => RoadNetworkEngine._pointInRings(a.lng, a.lat, bar.rings));
    const destIn = restricted.find((bar) => RoadNetworkEngine._pointInRings(b.lng, b.lat, bar.rings));
    if (startIn || destIn) {
      const which = startIn && destIn ? 'Both stops are' : startIn ? 'Start point is' : 'Destination is';
      const named = (startIn ?? destIn)!.name ?? 'barrier';
      return {
        ok: false,
        reason: 'no-route',
        error: `${which} inside restricted area "${named}" — no route can start or end there`,
      };
    }

    const res = await this._esri<any>(`${this._cfg.naServerUrl}/${this._cfg.routeLayer}/solve`, {
      stops: JSON.stringify(RoadNetworkEngine._pointFeatureSet([a, b])),
      ...(barriers ? { polygonBarriers: JSON.stringify(barriers) } : {}),
      returnRoutes: 'true',
      returnDirections: 'true',
      returnStops: 'false',
      returnBarriers: 'false',
      returnPolygonBarriers: 'false',
      returnPolylineBarriers: 'false',
      directionsLengthUnits: 'esriNAUKilometers',
      impedanceAttributeName: this._cfg.impedanceAttribute,
      accumulateAttributeNames: this._cfg.distanceAttribute,
      outputLines: 'esriNAOutputLineTrueShape',
      ignoreInvalidLocations: 'true',
      outSR: '4326',
    });
    if (!res.ok) {
      // ArcGIS returns a plain 400 for "there is no path", which is a routing
      // OUTCOME, not a malformed request — and with barriers in play it is the
      // expected answer for an objective that is sealed off. Re-classify it so
      // callers can tell "blocked" from "the request was wrong".
      const noSolution = /no solution|no route from location|unable to find|no path/i.test(res.error ?? '');
      const out: RoadResult<RouteData> = noSolution
        ? {
            ok: false,
            reason: 'no-route',
            error: barriers
              ? 'No route between these points that avoids the restricted areas'
              : 'No route found between these points',
            status: res.status,
          }
        : res;
      this._maybeMarkDown(out.reason);
      EngineLogger.error(ENGINE_NAME, `Route failed (${out.reason}): ${out.error}`);
      return out;
    }

    const solved = RoadNetworkEngine._readSolve(res.data);
    if (!solved) {
      // With restriction barriers in play, "no route" is usually a real finding
      // — the objective is sealed off — not a malfunction. Say which it is.
      return {
        ok: false,
        reason: 'no-route',
        error: barriers
          ? 'No route between these points that avoids the restricted areas'
          : 'Solver returned no route between these points',
      };
    }
    const { attrs, geometry, steps, totalTimeMin } = solved;

    // Distance: the accumulated Kilometers attribute, else the summed steps
    // (also kilometres, per directionsLengthUnits above).
    const distanceKm =
      Number(attrs[`Total_${this._cfg.distanceAttribute}`]) || steps.reduce((s, x) => s + x.km, 0);
    // Time: the directions summary is already minutes. Total_<impedance> is in
    // the impedance's own units, so it only gets converted as a fallback.
    const travelTimeMin =
      Number.isFinite(totalTimeMin) && totalTimeMin > 0
        ? totalTimeMin
        : this._toMinutes(Number(attrs[`Total_${this._cfg.impedanceAttribute}`]) || 0);

    // Best-effort trafficability enrichment — mutates `steps` in place with a
    // per-step fclass and never fails the route.
    const byClass = this._cfg.classifyRoutes
      ? await this._classifyAlongRoute(geometry, steps, distanceKm)
      : [];

    const data: RouteData = {
      distanceKm,
      travelTimeMin,
      byClass,
      trafficability: RoadNetworkEngine.classifyRoute(byClass),
      steps,
      geometry,
    };
    EngineLogger.success(
      ENGINE_NAME,
      `Route: ${data.distanceKm.toFixed(1)} km, ${data.travelTimeMin.toFixed(0)} min, ${data.steps.length} legs`,
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

    // The service may publish no Service Area layer at all. Say so plainly, so
    // callers label their output "estimate" rather than "backend down" — and so
    // the feature lights up by itself the day one IS published.
    if (!this._cfg.serviceAreaLayer) {
      return {
        ok: false,
        reason: 'unsupported',
        error: 'Network Analyst service publishes no Service Area layer',
      };
    }

    const res = await this._esri<any>(
      `${this._cfg.naServerUrl}/${this._cfg.serviceAreaLayer}/solveServiceArea`,
      {
        facilities: JSON.stringify(RoadNetworkEngine._pointFeatureSet([o])),
        defaultBreaks: String(this._fromMinutes(m)),
        impedanceAttributeName: this._cfg.impedanceAttribute,
        travelDirection: 'esriNATravelDirectionFromFacility',
        // Ask for LINES, not polygons: every caller treats service-area geometry
        // as a set of road centrelines (toPolyline / flatten-coords).
        returnFacilities: 'false',
        returnPolygons: 'false',
        returnPolylines: 'true',
        outputLines: 'esriNAOutputLineTrueShape',
        splitLinesAtBreaks: 'false',
        outSR: '4326',
      },
    );
    if (!res.ok) {
      this._maybeMarkDown(res.reason);
      EngineLogger.error(ENGINE_NAME, `Service area failed (${res.reason}): ${res.error}`);
      return res;
    }
    const paths: number[][][] = [];
    for (const f of res.data?.saPolylines?.features ?? []) {
      for (const p of f?.geometry?.paths ?? []) paths.push(p);
    }
    const geometry: GeoJsonLineGeometry | null = paths.length
      ? { type: 'MultiLineString', coordinates: paths }
      : null;
    EngineLogger.success(ENGINE_NAME, `Service area ${m} min computed`);
    return { ok: true, data: { minutes: m, geometry } };
  }

  // ── Optional reference roads layer (display/snapping) ────────────────────

  /**
   * Add the source roads as a reference layer. Best-effort: an unreachable or
   * failed service is logged and swallowed — never throws.
   *
   * Server-rendered (MapImageLayer), NOT a FeatureLayer: the network is ~2.5M
   * edges, far past what is sane to stream to the client for a backdrop.
   */
  async showRoadsLayer(): Promise<boolean> {
    if (!this._view) return false;
    if (this._roadsLayer) return true;
    try {
      const { default: MapImageLayer } = await import('@arcgis/core/layers/MapImageLayer');
      const layer = new MapImageLayer({
        id: RoadNetworkEngine.ROADS_LAYER_ID,
        url: this._cfg.roadsLayerUrl,
        title: 'Road network (reference)',
        listMode: 'hide',
        opacity: 0.7,
        // Only the routable roads sublayer — the service also carries the
        // solver's own Stops/Barriers/Routes scratch layers.
        sublayers: [{ id: this._cfg.roadsSublayerId, visible: true }],
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
    const res = await this.route(from, to, { barriers: opts.barriers });
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
      const detail = info
        ? ` (${info.name}${info.serviceAreaLayer ? '' : ', no service-area layer'})`
        : '';
      EngineLogger.success(ENGINE_NAME, `Road network online${detail}`);
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
   * The single fetch path to ArcGIS REST: timeout via AbortController,
   * status→reason mapping, JSON parse guard. Always resolves to a RoadResult —
   * never throws.
   *
   * Solve payloads (a stops feature set, a 3000-vertex route geometry) blow past
   * URL length limits, so everything but the capability probe goes out as a POST
   * form body.
   *
   * The trap: ArcGIS REST answers a *failed* request with **HTTP 200** and an
   * `{ error: { code, message, details } }` body. Checking `resp.ok` alone would
   * read those as successes and hand callers a result with no geometry, so the
   * body is inspected before anything else.
   */
  private async _esri<T>(
    url: string,
    params: Record<string, string> = {},
    method: 'GET' | 'POST' = 'POST',
  ): Promise<RoadResult<T>> {
    const form = new URLSearchParams({ ...params, f: 'json' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._cfg.timeoutMs);
    let resp: Response;
    try {
      resp = await fetch(method === 'GET' ? `${url}?${form.toString()}` : url, {
        method,
        signal: controller.signal,
        headers:
          method === 'GET'
            ? { Accept: 'application/json' }
            : {
                Accept: 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
              },
        body: method === 'GET' ? undefined : form.toString(),
      });
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
      const msg = body?.error?.message || `HTTP ${resp.status}`;
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

    // HTTP 200 + an error envelope — the ArcGIS way of reporting failure.
    if (body?.error) {
      const code = Number(body.error.code) || 0;
      const detail = Array.isArray(body.error.details) ? body.error.details.join('; ') : '';
      const msg = [body.error.message, detail].filter(Boolean).join(' — ') || `ArcGIS error ${code}`;
      const reason: RoadFailureReason =
        code === 400 ? 'bad-request' : code === 404 ? 'no-route' : code >= 500 ? 'server' : 'server';
      return { ok: false, reason, error: msg, status: code };
    }
    return { ok: true, data: body as T };
  }

  // ── Solve-response mapping ───────────────────────────────────────────────

  /**
   * Build the polygon-barrier feature set, or null when there is nothing to
   * avoid (so the parameter is omitted entirely rather than sent empty).
   *
   * Field names come from the service's own `PolygonBarriers` class: the
   * scaled-cost multipliers are `Attr_<costAttribute>` — here `Attr_Cost` and
   * `Attr_Kilometers` — NOT the `ScaledTimeFactor` / `ScaledDistanceFactor`
   * spelling used by ArcGIS Online's routing service. Sending the wrong names
   * fails silently: the barrier is accepted and then ignored.
   */
  private static _barrierFeatureSet(barriers: RouteBarrier[] | undefined): any | null {
    const list = (barriers ?? []).filter((b) => b?.rings?.length);
    if (!list.length) return null;
    return {
      type: 'features',
      features: list.map((b, i) => {
        const scaled = b.type === 'slow';
        const factor = scaled ? Math.max(1, Number(b.costFactor) || 5) : 1;
        return {
          geometry: { rings: b.rings, spatialReference: { wkid: 4326 } },
          attributes: {
            Name: b.name ?? `Barrier ${i + 1}`,
            // 0 = restriction (impassable), 1 = scaled cost.
            BarrierType: scaled ? 1 : 0,
            Attr_Cost: factor,
            Attr_Kilometers: factor,
          },
        };
      }),
    };
  }

  /**
   * A geodesic circle as barrier rings — the shape threat bubbles actually are.
   * Ground-true (not a planar circle in degrees), so the barrier matches the
   * ring drawn on the map at any latitude.
   */
  static circleBarrier(
    lng: number,
    lat: number,
    radiusKm: number,
    opts: Omit<RouteBarrier, 'rings'> & { sides?: number } = {},
  ): RouteBarrier {
    const { sides = 48, ...rest } = opts;
    const R = 6371.0088;
    const d = radiusKm / R;
    const lat1 = (lat * Math.PI) / 180;
    const lng1 = (lng * Math.PI) / 180;
    const ring: number[][] = [];
    for (let i = 0; i <= sides; i++) {
      const brg = (2 * Math.PI * i) / sides;
      const la = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
      const lo =
        lng1 +
        Math.atan2(
          Math.sin(brg) * Math.sin(d) * Math.cos(lat1),
          Math.cos(d) - Math.sin(lat1) * Math.sin(la),
        );
      ring.push([(lo * 180) / Math.PI, (la * 180) / Math.PI]);
    }
    return { ...rest, rings: [ring] };
  }

  /**
   * Ray-casting point-in-polygon over a barrier's rings, in lng/lat. Planar is
   * fine here: barriers are a few km across, and this only decides whether a
   * stop sits inside one.
   */
  private static _pointInRings(lng: number, lat: number, rings: number[][][]): boolean {
    let inside = false;
    for (const ring of rings ?? []) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
    }
    return inside;
  }

  /** Build the `{type:'features'}` feature set the solver wants for stops/facilities. */
  private static _pointFeatureSet(pts: { lng: number; lat: number }[]): any {
    return {
      type: 'features',
      features: pts.map((p, i) => ({
        geometry: { x: p.lng, y: p.lat, spatialReference: { wkid: 4326 } },
        attributes: { Name: `Location ${i + 1}` },
      })),
    };
  }

  /**
   * Normalise a solve response into geometry + attributes + steps.
   *
   * ArcGIS has shipped two shapes for this: older servers (and this 10.8.1 one)
   * return top-level `routes` / `directions`, newer ones nest everything under
   * `routeResults`. Both are accepted so the adapter survives a server upgrade.
   */
  private static _readSolve(body: any): {
    attrs: Record<string, any>;
    geometry: GeoJsonLineGeometry;
    steps: RouteStep[];
    totalTimeMin: number;
  } | null {
    const nested = body?.routeResults?.[0];
    const routeFeature = nested?.route ?? body?.routes?.features?.[0];
    const paths: number[][][] = routeFeature?.geometry?.paths ?? [];
    if (!paths.length) return null;

    const directions = nested?.directions ?? body?.directions?.[0];
    const steps: RouteStep[] = (directions?.features ?? [])
      .map((f: any) => {
        const a = f?.attributes ?? {};
        return {
          // `text` is the maneuver phrasing, which carries the street name —
          // the closest thing the solver gives us to the old per-road step name.
          name: String(a.text ?? '').trim() || '(unnamed road)',
          fclass: '', // filled in by the class enrichment pass, when it runs
          km: Number(a.length) || 0,
          min: Number(a.time) || 0,
        };
      })
      // Drop the zero-length "Start at" / "Finish at" bookends.
      .filter((s: RouteStep) => s.km > 0 || s.min > 0);

    return {
      attrs: routeFeature?.attributes ?? {},
      // ArcGIS `paths` are already [[[lng,lat],…],…] — i.e. GeoJSON
      // MultiLineString coordinates — so every downstream consumer of the old
      // GeoJSON contract keeps working untouched.
      geometry: { type: 'MultiLineString', coordinates: paths },
      steps,
      totalTimeMin: Number(directions?.summary?.totalTime) || 0,
    };
  }

  /** Impedance value (in `impedanceUnits`) → minutes. */
  private _toMinutes(v: number): number {
    switch (this._cfg.impedanceUnits) {
      case 'hours':
        return v * 60;
      case 'seconds':
        return v / 60;
      case 'minutes':
        return v;
      default:
        return 0; // a distance impedance carries no time information
    }
  }

  /** Minutes → a break value in `impedanceUnits`. */
  private _fromMinutes(min: number): number {
    switch (this._cfg.impedanceUnits) {
      case 'hours':
        return min / 60;
      case 'seconds':
        return min * 60;
      default:
        return min;
    }
  }

  // ── Road-class enrichment (trafficability) ───────────────────────────────

  /**
   * Recover the per-class distance breakdown a Network Analyst solve does not
   * give us, and stamp each direction step with the class it runs on.
   *
   * Sample the route at even spacing → ask the roads layer, in ONE request, for
   * every edge within `classifyToleranceM` of any sample → attribute each sample
   * to its nearest edge. Each sample then stands for `spacing` km of that class.
   *
   * Best-effort by contract: any failure returns `[]` and the caller still gets
   * a perfectly good route, just with no trafficability rating.
   */
  private async _classifyAlongRoute(
    geometry: GeoJsonLineGeometry,
    steps: RouteStep[],
    distanceKm: number,
  ): Promise<RouteClassBreakdown[]> {
    try {
      const coords = RoadNetworkEngine._flatten(geometry);
      if (coords.length < 2 || distanceKm <= 0) return [];

      // Sample count scales with length but stays bounded: one sample per ~2 km,
      // never fewer than 12 (short urban hops) nor more than the configured cap.
      const n = Math.max(12, Math.min(this._cfg.classifySamples, Math.round(distanceKm / 2)));
      const samples = RoadNetworkEngine._sampleAlong(coords, n);
      if (samples.length < 2) return [];

      const res = await this._esri<any>(
        `${this._cfg.roadsLayerUrl}/${this._cfg.roadsSublayerId}/query`,
        {
          geometry: JSON.stringify({
            points: samples.map((s) => [s.lng, s.lat]),
            spatialReference: { wkid: 4326 },
          }),
          geometryType: 'esriGeometryMultipoint',
          inSR: '4326',
          spatialRel: 'esriSpatialRelIntersects',
          distance: String(this._cfg.classifyToleranceM),
          units: 'esriSRUnit_Meter',
          outFields: this._cfg.classFieldName,
          returnGeometry: 'true',
          outSR: '4326',
          resultRecordCount: '2000',
        },
      );
      if (!res.ok) {
        EngineLogger.nextStep(ENGINE_NAME, `Road classes unavailable (${res.reason}) — route has no trafficability`);
        return [];
      }
      const edges: { fclass: string; paths: number[][][] }[] = [];
      for (const f of res.data?.features ?? []) {
        const clazz = Number(f?.attributes?.[this._cfg.classFieldName]);
        const paths = f?.geometry?.paths;
        if (!Array.isArray(paths) || !paths.length) continue;
        edges.push({ fclass: OSM2PO_CLAZZ_TO_FCLASS[clazz] ?? '', paths });
      }
      if (!edges.length) return [];

      // Nearest edge per sample. Bounded work: samples ≤ cap, edges ≤ 2000.
      // Each sample stands for an equal share of the route, so the shares sum
      // back to exactly `distanceKm` — dividing by the number of INTERVALS
      // instead would inflate the total by a factor of n/(n-1).
      const spacingKm = distanceKm / samples.length;
      const kmByClass: Record<string, number> = {};
      const sampleClass: string[] = [];
      for (const s of samples) {
        let bestD = Infinity;
        let bestClass = '';
        for (const e of edges) {
          for (const path of e.paths) {
            for (let i = 0; i < path.length - 1; i++) {
              const d = RoadNetworkEngine._distToSegSq(s, path[i], path[i + 1]);
              if (d < bestD) {
                bestD = d;
                bestClass = e.fclass;
              }
            }
          }
        }
        sampleClass.push(bestClass);
        if (bestClass) kmByClass[bestClass] = (kmByClass[bestClass] ?? 0) + spacingKm;
      }

      // Stamp each direction step with the class dominating its span of the
      // route, so tier-coloured rendering and choke detection light up.
      RoadNetworkEngine._assignStepClasses(steps, samples, sampleClass);

      return Object.entries(kmByClass)
        .map(([fclass, km]) => ({ fclass, km }))
        .sort((a, b) => b.km - a.km);
    } catch (e: any) {
      EngineLogger.nextStep(ENGINE_NAME, `Road-class enrichment skipped: ${e?.message ?? e}`);
      return [];
    }
  }

  /** Give each step the class carrying most of its distance along the route. */
  private static _assignStepClasses(
    steps: RouteStep[],
    samples: { lng: number; lat: number; alongKm: number }[],
    sampleClass: string[],
  ): void {
    let cursorKm = 0;
    for (const step of steps) {
      const from = cursorKm;
      const to = cursorKm + step.km;
      cursorKm = to;
      const tally: Record<string, number> = {};
      for (let i = 0; i < samples.length; i++) {
        const a = samples[i].alongKm;
        if (a < from || a > to) continue;
        const c = sampleClass[i];
        if (c) tally[c] = (tally[c] ?? 0) + 1;
      }
      let best = '';
      let bestN = 0;
      for (const [c, k] of Object.entries(tally)) {
        if (k > bestN) {
          bestN = k;
          best = c;
        }
      }
      // A step shorter than the sample spacing may catch none — fall back to the
      // class of the nearest sample so no step is left unclassified.
      if (!best && samples.length) {
        const mid = (from + to) / 2;
        let bestIdx = 0;
        let bestGap = Infinity;
        for (let i = 0; i < samples.length; i++) {
          const gap = Math.abs(samples[i].alongKm - mid);
          if (gap < bestGap) {
            bestGap = gap;
            bestIdx = i;
          }
        }
        best = sampleClass[bestIdx] ?? '';
      }
      step.fclass = best;
    }
  }

  /** GeoJSON line/multiline → a flat [lng,lat] list. */
  private static _flatten(geometry: GeoJsonLineGeometry): number[][] {
    if (geometry.type === 'MultiLineString') {
      const out: number[][] = [];
      for (const part of geometry.coordinates as number[][][]) out.push(...part);
      return out;
    }
    return geometry.coordinates as number[][];
  }

  /** `n` evenly spaced points along a coordinate list, each tagged with its along-route km. */
  private static _sampleAlong(
    coords: number[][],
    n: number,
  ): { lng: number; lat: number; alongKm: number }[] {
    const segM: number[] = [];
    let totalM = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const d = RoadNetworkEngine._haversineM(coords[i], coords[i + 1]);
      segM.push(d);
      totalM += d;
    }
    if (totalM <= 0) return [];
    const stepM = totalM / (n - 1);
    const out: { lng: number; lat: number; alongKm: number }[] = [];
    let acc = 0;
    let target = 0;
    for (let i = 0; i < coords.length - 1 && out.length < n; i++) {
      const d = segM[i];
      while (target <= acc + d && out.length < n) {
        const t = d > 0 ? (target - acc) / d : 0;
        out.push({
          lng: coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t,
          lat: coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t,
          alongKm: target / 1000,
        });
        target += stepM;
      }
      acc += d;
    }
    return out;
  }

  private static _haversineM(a: number[], b: number[]): number {
    const R = 6371000;
    const p = Math.PI / 180;
    const dLat = (b[1] - a[1]) * p;
    const dLng = (b[0] - a[0]) * p;
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a[1] * p) * Math.cos(b[1] * p) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /**
   * Squared point→segment distance in degrees, with longitude scaled by
   * cos(latitude). Only ever compared against other distances at the same
   * latitude, so the unit never matters — this just has to rank correctly, and
   * it avoids a projection round-trip per sample/edge pair.
   */
  private static _distToSegSq(p: { lng: number; lat: number }, a: number[], b: number[]): number {
    const kx = Math.cos((p.lat * Math.PI) / 180);
    const ax = (a[0] - p.lng) * kx;
    const ay = a[1] - p.lat;
    const bx = (b[0] - p.lng) * kx;
    const by = b[1] - p.lat;
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len));
    const x = ax + dx * t;
    const y = ay + dy * t;
    return x * x + y * y;
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
