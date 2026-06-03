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
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polygon from '@arcgis/core/geometry/Polygon';
import * as reactiveUtils from '@arcgis/core/core/reactiveUtils';
import RoadNetworkEngine, {
  type RoadNetworkAvailability,
  type RouteData,
  type ServiceAreaData,
  type Trafficability,
  type TrafficabilitySummary,
} from './RoadNetworkEngine';
import EngineLogger from '../../Support/EngineLogger';

const ENGINE_NAME = 'TrafficabilityEngine';

/** Whole-route playback duration target, seconds (a long route still plays in ~this long). */
const PLAY_DURATION_S = 14;

// ─── Types ──────────────────────────────────────────────────────────────────

export type ReachMode = 'serviceArea' | 'route' | 'msr';

interface ServiceBand {
  minutes: number;
  /** Total reachable road length within this band, km (from live geometry). */
  roadKm: number;
  color: [number, number, number];
}

/** One travelled leg used for time/speed playback. */
interface DriveSeg {
  km: number;
  min: number;
  name: string;
  fclass: string;
  speedKmh: number;
  /** True when this leg is a straight-line estimate (no road match) — rendered grey/dashed. */
  estimate?: boolean;
}

/** Time-parameterised drive model: maps elapsed minutes → position / speed / road. */
interface DriveModel {
  path: number[][]; // [lng,lat] vertices of the whole route
  cum: number[]; // cumulative km per vertex
  pathKm: number;
  segs: DriveSeg[]; // ordered legs (live steps, or one synthetic leg when estimated)
  segKm: number; // Σ seg.km (may differ slightly from pathKm — we map by fraction)
  totalMin: number;
  estimate: boolean;
}

interface DriveSample {
  lng: number;
  lat: number;
  elapsedMin: number;
  speedKmh: number;
  name: string;
  fclass: string;
}

interface CalloutEntry {
  el: HTMLElement;
  lng: number;
  lat: number;
}

/** A merged multi-leg route (origin→…→dest) used by Route alternates and MSR. */
interface RouteChain {
  path: number[][];
  segs: DriveSeg[];
  distKm: number;
  timeMin: number;
  traffic: TrafficabilitySummary | null;
  okLegs: number;
  degraded: boolean;
}

/** One candidate route in Route mode (primary + alternates). */
interface RouteOption {
  id: string;
  chain: RouteChain;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class TrafficabilityEngine {
  static readonly ANALYSIS_LAYER_ID = 'trafficability-analysis';
  static readonly MARKER_LAYER_ID = 'trafficability-markers';
  static readonly COMMITTED_LAYER_ID = 'trafficability-committed';

  private _view: MapView | SceneView | null = null;
  private _analysisLayer!: GraphicsLayer;
  private _markerLayer!: GraphicsLayer;
  private _committedLayer!: GraphicsLayer;

  private _origin: Point | null = null;
  private _dest: Point | null = null;
  /** Ordered MSR waypoints (first = Start Point, last = Release Point). */
  private _waypoints: Point[] = [];
  private _mode: ReachMode = 'serviceArea';

  private _panelEl: HTMLDivElement | null = null;
  private _clickHandle: any = null;
  private _placeMode: 'origin' | 'dest' | 'waypoint' | null = null;
  private _running = false;

  /** Time/speed model for the current route or MSR (null in service-area mode). */
  private _driveModel: DriveModel | null = null;

  /** Route mode: the primary + alternate routes, and which one is active. */
  private _routeOptions: RouteOption[] = [];
  private _selectedRoute = 0;

  // Vehicle playback
  private _vehicleGraphic: Graphic | null = null;
  private _animFrame: number | null = null;
  private _animRunning = false;
  private _animStartMs = 0;
  private _animStartElapsedMin = 0;
  private _animRateMinPerSec = 1;

  // Smart callouts
  private _calloutHost: HTMLDivElement | null = null;
  private _callouts: CalloutEntry[] = [];
  private _vehicleCallout: CalloutEntry | null = null;
  private _viewWatchHandle: any = null;

  /** Optional explicit road-network adapter; falls back to the shared one. */
  private _roadNetOverride: RoadNetworkEngine | null = null;
  private _statusUnsub: (() => void) | null = null;

  // Draggable panel state
  private _dragOffsetX = 0;
  private _dragOffsetY = 0;
  private _isDragging = false;

  constructor() {
    this._createLayers();
    this._injectStyles();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  initialize(view: MapView | SceneView): void {
    if (this._view === view) return;
    this._view = view;
    const map = view.map as any;
    if (map && !map.findLayerById(this._analysisLayer.id)) {
      map.addMany([this._committedLayer, this._analysisLayer, this._markerLayer]);
    }
  }

  /** Re-attach on 2D↔3D switch; move the three layers + callout host to the new map. */
  onViewChanged(view: MapView | SceneView): void {
    const oldMap = this._view?.map as any;
    if (oldMap) {
      oldMap.remove(this._analysisLayer);
      oldMap.remove(this._markerLayer);
      oldMap.remove(this._committedLayer);
    }
    this._teardownCalloutHost();
    this._view = view;
    const map = view.map as any;
    if (map) map.addMany([this._committedLayer, this._analysisLayer, this._markerLayer]);
    if (this._panelEl && this._panelEl.style.display !== 'none') {
      this._ensureCalloutHost();
      this._repositionCallouts();
    }
  }

  /**
   * Open the widget. If `graphic` is supplied its location becomes the origin;
   * otherwise the user is prompted to pick an origin on the map.
   * Optionally inject a specific RoadNetworkEngine (else the shared one is used).
   */
  open(graphic?: Graphic | null, view?: MapView | SceneView, roadNet?: RoadNetworkEngine): void {
    if (view) this.initialize(view);
    if (roadNet) this._roadNetOverride = roadNet;

    this._stopDrive();
    this._clearCallouts();
    this._analysisLayer.removeAll();
    this._markerLayer.removeAll();
    this._cancelPlacement();
    this._driveModel = null;
    this._dest = null;
    this._waypoints = [];

    this._origin = graphic ? this._geomToPoint(graphic.geometry) : null;
    if (this._origin) this._waypoints = [this._origin];

    this._showPanel();
    this._ensureCalloutHost();
    this._subscribeRoadStatus();
    this._refreshRoadBadge();

    if (this._origin) {
      this._drawOriginMarker();
      this._setStatus('ready');
    } else {
      this._setStatus('awaiting');
      this._startOriginPlacement();
    }
  }

  close(): void {
    this._hidePanel();
    this._stopDrive();
    this._clearCallouts();
    this._teardownCalloutHost();
    this._analysisLayer.removeAll();
    this._markerLayer.removeAll();
    this._cancelPlacement();
    this._unsubscribeRoadStatus();
    this._origin = null;
    this._dest = null;
    this._waypoints = [];
    this._driveModel = null;
  }

  destroy(): void {
    this.close();
    const map = this._view?.map as any;
    if (map) {
      map.remove(this._analysisLayer);
      map.remove(this._markerLayer);
      map.remove(this._committedLayer);
    }
    this._panelEl?.remove();
    this._panelEl = null;
    this._view = null;
  }

  // ─── Private: Road-network access ───────────────────────────────────────────

  /** Reach the road-network adapter: explicit override, else the shared one. */
  private _roadNet(): RoadNetworkEngine | null {
    return this._roadNetOverride ?? (window as any).symbolEngine?.roadNetworkEngine ?? null;
  }

  private _subscribeRoadStatus(): void {
    this._unsubscribeRoadStatus();
    const rn = this._roadNet();
    if (rn) {
      this._statusUnsub = rn.onStatusChange(() => this._refreshRoadBadge());
      void rn.ensureAvailable();
    }
  }

  private _unsubscribeRoadStatus(): void {
    this._statusUnsub?.();
    this._statusUnsub = null;
  }

  // ─── Private: Layers ────────────────────────────────────────────────────────

  private _createLayers(): void {
    this._analysisLayer = new GraphicsLayer({
      id: TrafficabilityEngine.ANALYSIS_LAYER_ID,
      title: 'Trafficability — Working',
      listMode: 'hide',
    });
    this._markerLayer = new GraphicsLayer({
      id: TrafficabilityEngine.MARKER_LAYER_ID,
      title: 'Trafficability — Markers',
      listMode: 'hide',
    });
    this._committedLayer = new GraphicsLayer({
      id: TrafficabilityEngine.COMMITTED_LAYER_ID,
      title: 'Trafficability — Committed',
      listMode: 'hide',
    });
  }

  // ─── Private: Geodetic helpers ──────────────────────────────────────────────

  private _haversineM(lon1: number, lat1: number, lon2: number, lat2: number): number {
    const R = 6_371_008.8;
    const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180;
    const Δφ = φ2 - φ1, Δλ = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private _destinationPoint(
    lon: number, lat: number, bearingDeg: number, distM: number,
  ): { longitude: number; latitude: number } {
    const R = 6_371_008.8;
    const δ = distM / R;
    const θ = (bearingDeg * Math.PI) / 180;
    const φ1 = (lat * Math.PI) / 180;
    const λ1 = (lon * Math.PI) / 180;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );
    return { longitude: (λ2 * 180) / Math.PI, latitude: (φ2 * 180) / Math.PI };
  }

  /** Geodesic ring of [lng,lat] coords for a circle of radius metres. */
  private _ringCoords(lon: number, lat: number, radiusM: number, sides = 72): number[][] {
    const ring: number[][] = [];
    for (let i = 0; i <= sides; i++) {
      const p = this._destinationPoint(lon, lat, (i / sides) * 360, radiusM);
      ring.push([p.longitude, p.latitude]);
    }
    return ring;
  }

  /** Flatten a GeoJSON Line/MultiLineString into a single [lng,lat][] list. */
  private _flattenGeoJson(geom: any): number[][] {
    if (!geom || !Array.isArray(geom.coordinates)) return [];
    if (geom.type === 'MultiLineString') {
      const out: number[][] = [];
      for (const seg of geom.coordinates) for (const c of seg) out.push([c[0], c[1]]);
      return out;
    }
    return (geom.coordinates as number[][]).map((c) => [c[0], c[1]]);
  }

  /** Total length (km) of a GeoJSON Line/MultiLineString via summed haversine. */
  private _geoJsonLengthKm(geom: any): number {
    const path = this._flattenGeoJson(geom);
    let m = 0;
    for (let i = 1; i < path.length; i++) {
      m += this._haversineM(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
    }
    return m / 1000;
  }

  /** Linear-ish ramp green → amber → orange → red for t in [0,1]. */
  private _rampColor(t: number): [number, number, number] {
    const stops: [number, [number, number, number]][] = [
      [0.0, [40, 200, 110]],
      [0.4, [240, 200, 60]],
      [0.7, [243, 146, 55]],
      [1.0, [214, 69, 65]],
    ];
    const tc = Math.max(0, Math.min(1, t));
    for (let i = 1; i < stops.length; i++) {
      if (tc <= stops[i][0]) {
        const [t0, c0] = stops[i - 1];
        const [t1, c1] = stops[i];
        const f = (tc - t0) / (t1 - t0 || 1);
        return [
          Math.round(c0[0] + (c1[0] - c0[0]) * f),
          Math.round(c0[1] + (c1[1] - c0[1]) * f),
          Math.round(c0[2] + (c1[2] - c0[2]) * f),
        ];
      }
    }
    return stops[stops.length - 1][1];
  }

  private _trafficColor(rating: Trafficability | undefined): string {
    return rating === 'GO' ? '#1D9E75' : rating === 'SLOW-GO' ? '#EF9F27' : rating === 'NO-GO' ? '#E24B4A' : '#888';
  }

  // ─── Private: Symbols ───────────────────────────────────────────────────────

  private _is3D(): boolean {
    return this._view?.type === '3d';
  }

  private _lineSymbol(color: [number, number, number], width: number, opacity = 0.95, dash = false): any {
    return this._is3D()
      ? {
          type: 'line-3d',
          symbolLayers: [{
            type: 'line',
            size: width,
            material: { color: [...color, Math.round(opacity * 255)] },
            pattern: { type: 'style', style: dash ? 'dash' : 'solid' },
            cap: 'round',
            join: 'round',
          }],
        }
      : {
          type: 'simple-line',
          color: [...color, Math.round(opacity * 255)],
          width,
          style: dash ? 'short-dash' : 'solid',
        };
  }

  private _fillSymbol(color: [number, number, number], fillA = 18, outA = 200, outW = 1.4): any {
    return this._is3D()
      ? {
          type: 'polygon-3d',
          symbolLayers: [{
            type: 'fill',
            material: { color: [...color, fillA] },
            outline: { color: [...color, outA], size: outW },
          }],
        }
      : {
          type: 'simple-fill',
          color: [...color, fillA],
          outline: { color: [...color, outA], width: outW },
        };
  }

  private _markerSymbol(style: string, color: [number, number, number], size: number): any {
    return {
      type: 'simple-marker',
      style,
      color: [...color, 235],
      size,
      outline: { color: [255, 255, 255, 225], width: 1.4 },
    };
  }

  private _geomToPoint(geom: any): Point | null {
    if (!geom) return null;
    if (geom.type === 'point') return geom as Point;
    if (geom.centroid) return geom.centroid as Point;
    return null;
  }

  private _drawOriginMarker(): void {
    this._removeMarkers('origin');
    const latInp = this._inp('reach-origin-lat');
    const lonInp = this._inp('reach-origin-lon');
    if (!this._origin) {
      this._setText('#reach-origin-coords', 'Origin: click map (Pick ⊕) or enter a Lat/Lon and press Set');
      if (latInp) latInp.value = '';
      if (lonInp) lonInp.value = '';
      this._updateRunHint();
      return;
    }
    this._markerLayer.add(new Graphic({
      geometry: new Point({
        longitude: this._origin.longitude,
        latitude: this._origin.latitude,
        spatialReference: { wkid: 4326 },
      }),
      symbol: this._markerSymbol('diamond', [52, 192, 174], 13),
      attributes: { type: 'trafficability_origin', markerRole: 'origin' },
    }));
    const oLat = (this._origin.latitude ?? 0).toFixed(5);
    const oLon = (this._origin.longitude ?? 0).toFixed(5);
    this._setText('#reach-origin-coords', `Origin: ${oLat}°N  ${oLon}°E`);
    if (latInp) latInp.value = oLat;
    if (lonInp) lonInp.value = oLon;
    this._updateRunHint();
  }

  private _drawDestMarker(): void {
    this._removeMarkers('dest');
    const latInp = this._inp('reach-dest-lat');
    const lonInp = this._inp('reach-dest-lon');
    if (!this._dest) {
      this._setText('#reach-dest-coords', 'Destination: not set');
      if (latInp) latInp.value = '';
      if (lonInp) lonInp.value = '';
      this._updateRunHint();
      return;
    }
    this._markerLayer.add(new Graphic({
      geometry: new Point({
        longitude: this._dest.longitude,
        latitude: this._dest.latitude,
        spatialReference: { wkid: 4326 },
      }),
      symbol: this._markerSymbol('triangle', [214, 69, 65], 12),
      attributes: { type: 'trafficability_dest', markerRole: 'dest' },
    }));
    const dLat = (this._dest.latitude ?? 0).toFixed(5);
    const dLon = (this._dest.longitude ?? 0).toFixed(5);
    this._setText('#reach-dest-coords', `Destination: ${dLat}°N  ${dLon}°E`);
    if (latInp) latInp.value = dLat;
    if (lonInp) lonInp.value = dLon;
    this._updateRunHint();
  }

  private _drawWaypointMarkers(): void {
    this._removeMarkers('waypoint');
    this._waypoints.forEach((wp, i) => {
      const isFirst = i === 0;
      const isLast = i === this._waypoints.length - 1 && this._waypoints.length > 1;
      const sym = isFirst
        ? this._markerSymbol('diamond', [52, 192, 174], 13)
        : isLast
          ? this._markerSymbol('triangle', [214, 69, 65], 12)
          : this._markerSymbol('circle', [80, 150, 220], 9);
      this._markerLayer.add(new Graphic({
        geometry: new Point({ longitude: wp.longitude, latitude: wp.latitude, spatialReference: { wkid: 4326 } }),
        symbol: sym,
        attributes: { type: 'trafficability_waypoint', markerRole: 'waypoint', index: i },
      }));
    });
    this._renderWaypointList();
  }

  private _removeMarkers(role: string): void {
    this._markerLayer.graphics
      .filter((g: Graphic) => g.attributes?.markerRole === role)
      .forEach((g: Graphic) => this._markerLayer.remove(g));
  }

  /** Read the typed Lat/Lon, returning a WGS84 point or null when out of range. */
  private _pointFromInputs(latId: string, lonId: string): Point | null {
    const lat = Number(this._inp(latId)?.value);
    const lon = Number(this._inp(lonId)?.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return null;
    }
    return new Point({ longitude: lon, latitude: lat, spatialReference: { wkid: 4326 } });
  }

  private _setOriginFromInputs(): void {
    const pt = this._pointFromInputs('reach-origin-lat', 'reach-origin-lon');
    if (!pt) {
      this._setText('#reach-origin-coords', 'Enter a valid Lat/Lon (lat ±90°, lon ±180°)');
      this._setStatus('awaiting');
      return;
    }
    this._cancelPlacement();
    this._origin = pt;
    if (this._mode === 'msr') {
      this._waypoints = [pt];
      this._drawWaypointMarkers();
    }
    this._drawOriginMarker();
    this._setStatus('ready');
  }

  private _setDestFromInputs(): void {
    const pt = this._pointFromInputs('reach-dest-lat', 'reach-dest-lon');
    if (!pt) {
      this._setText('#reach-dest-coords', 'Enter a valid Lat/Lon (lat ±90°, lon ±180°)');
      return;
    }
    this._cancelPlacement();
    this._dest = pt;
    this._drawDestMarker();
    void this._run();
  }

  /** Refresh the Run button tooltip to guide the user toward what is still missing. */
  private _updateRunHint(): void {
    const btn = this._panelEl?.querySelector<HTMLButtonElement>('#reach-run-btn');
    if (!btn) return;
    const place = 'click the map (Pick ⊕) or enter a Lat/Lon and press Set';
    if (this._mode === 'msr') {
      btn.title = this._waypoints.length >= 2
        ? 'Find the Main Supply Route across the placed waypoints'
        : 'Add at least two waypoints — click the map (Add Waypoints ⊕)';
    } else if (this._mode === 'route') {
      btn.title = !this._origin
        ? `Place an origin first — ${place}`
        : !this._dest
          ? `Pick a destination — ${place}`
          : 'Compute the road route from origin to destination';
    } else {
      btn.title = this._origin
        ? 'Compute the drive-time service area from the origin'
        : `Place an origin first — ${place}`;
    }
  }

  // ─── Private: Run (mode dispatch) ───────────────────────────────────────────

  private async _run(): Promise<void> {
    if (this._running) return;
    if (this._mode === 'msr') {
      if (this._waypoints.length < 2) {
        this._setSourceNote('Add at least two waypoints (Start + Release point).');
        this._setStatus('awaiting');
        this._startWaypointPlacement();
        return;
      }
    } else if (!this._origin) {
      this._setStatus('awaiting');
      this._startOriginPlacement();
      return;
    }
    this._running = true;
    this._cancelPlacement();
    this._setWaypointBtn(false);
    this._setRunDisabled(true);
    this._setStatus('computing');
    try {
      if (this._mode === 'serviceArea') await this._runServiceArea();
      else if (this._mode === 'route') await this._runRoute();
      else await this._runMsr();
    } catch (e: any) {
      EngineLogger.error(ENGINE_NAME, `Run failed: ${e?.message ?? e}`);
      this._setStatus('error');
    } finally {
      this._running = false;
      this._setRunDisabled(false);
      this._setCommitDisabled(this._analysisLayer.graphics.length === 0);
    }
  }

  // ─── Private: Service Area ──────────────────────────────────────────────────

  private async _runServiceArea(): Promise<void> {
    if (!this._origin) return;
    this._stopDrive();
    this._hideScrubber();
    this._clearCallouts();
    this._analysisLayer.removeAll();
    this._driveModel = null;

    const maxMin = Number(this._inp('reach-maxmin')?.value ?? 30);
    const bandCount = Math.max(1, Math.min(6, Number(this._inp('reach-bands')?.value ?? 3)));
    const speedKmh = Number(this._inp('reach-speed')?.value ?? 40);

    // Evenly spaced bands: maxMin/n … maxMin (largest last).
    const minutesList: number[] = [];
    for (let i = 1; i <= bandCount; i++) minutesList.push((maxMin / bandCount) * i);

    const rn = this._roadNet();
    if (rn && rn.availability === 'unknown') await rn.ensureAvailable();
    const useLive = !!rn && rn.isAvailable;
    const bands: ServiceBand[] = [];

    if (useLive) {
      // Draw farthest band first so nearer (faster) bands paint on top.
      for (let i = minutesList.length - 1; i >= 0; i--) {
        const minutes = minutesList[i];
        const color = this._rampColor(i / Math.max(1, minutesList.length - 1));
        let res: any;
        try {
          res = await rn!.serviceArea(this._origin, minutes);
        } catch {
          res = { ok: false };
        }
        if (res?.ok) {
          const data = res.data as ServiceAreaData;
          const line = RoadNetworkEngine.toPolyline(data.geometry);
          const roadKm = this._geoJsonLengthKm(data.geometry);
          if (line) {
            this._analysisLayer.add(new Graphic({
              geometry: line,
              symbol: this._lineSymbol(color, 2.4 + i * 0.4, 0.92),
              attributes: { type: 'trafficability_band', minutes, roadKm, source: 'live' },
            }));
          }
          bands.unshift({ minutes, roadKm, color });
        }
      }
    } else {
      // Offline estimate: geodesic range rings at speed × minutes.
      for (let i = 0; i < minutesList.length; i++) {
        const minutes = minutesList[i];
        const color = this._rampColor(i / Math.max(1, minutesList.length - 1));
        const radiusM = (speedKmh * 1000) * (minutes / 60);
        const ring = this._ringCoords(this._origin.longitude ?? 0, this._origin.latitude ?? 0, radiusM);
        this._analysisLayer.add(new Graphic({
          geometry: new Polygon({ rings: [ring], spatialReference: { wkid: 4326 } }),
          symbol: this._fillSymbol(color, 10, 200, 1.4),
          attributes: { type: 'trafficability_ring', minutes, radiusM, source: 'estimate' },
        }));
        bands.push({ minutes, roadKm: 0, color });
      }
    }

    this._drawOriginMarker();

    this._setText('#reach-st-1-val', String(bandCount));
    this._setText('#reach-st-1-lbl', 'Bands');
    this._setText('#reach-st-2-val', `${Math.round(maxMin)}`);
    this._setText('#reach-st-2-lbl', 'Max (min)');
    const outerKm = speedKmh * (maxMin / 60);
    if (useLive) {
      const outer = bands[bands.length - 1];
      this._setText('#reach-st-3-val', outer ? `${outer.roadKm.toFixed(0)}` : '—');
      this._setText('#reach-st-3-lbl', 'Roads km');
    } else {
      this._setText('#reach-st-3-val', `${outerKm.toFixed(1)}`);
      this._setText('#reach-st-3-lbl', 'Reach km*');
    }

    this._renderBandLegend(bands, useLive ? 'live' : 'estimate');
    this._setText('#reach-traffic-note', '');
    this._setText('#reach-steps', '');

    // Smart callout at the origin summarising the reach.
    const headKm = useLive ? (bands[bands.length - 1]?.roadKm ?? 0) : outerKm;
    this._addCallout(
      this._origin.longitude ?? 0, this._origin.latitude ?? 0, '#34C0AE',
      `<div class="reach-co-title">📍 Reach from here</div>
       <div class="reach-co-row"><b>${Math.round(maxMin)} min</b> drive time · ${bandCount} band${bandCount === 1 ? '' : 's'}</div>
       <div class="reach-co-row">${useLive ? `~<b>${headKm.toFixed(0)} km</b> of road reachable` : `~<b>${headKm.toFixed(0)} km</b> radius (estimate)`}</div>`,
    );

    this._setSourceNote(useLive
      ? `Live road network — ${bands.length} band${bands.length === 1 ? '' : 's'} computed. 👍`
      : `Estimate (road service offline) — rings at ${speedKmh} km/h.`);
    this._repositionCallouts();
    this._setStatus(useLive ? 'ready' : 'estimate');
  }

  // ─── Private: Route ─────────────────────────────────────────────────────────

  private async _runRoute(): Promise<void> {
    if (!this._origin) return;
    if (!this._dest) {
      this._setStatus('awaiting');
      this._setSourceNote('Pick a destination to route to.');
      this._startDestPlacement();
      return;
    }
    const origin = this._origin, dest = this._dest;
    this._stopDrive();
    this._clearCallouts();
    this._analysisLayer.removeAll();
    this._driveModel = null;
    this._routeOptions = [];
    this._selectedRoute = 0;

    const speedKmh = Number(this._inp('reach-speed')?.value ?? 40);

    // Primary route. If it can't be routed at all, fall back to a straight-line estimate.
    const primary = await this._routeChain([origin, dest], speedKmh);
    if (primary.okLegs === 0) {
      this._renderStraightLineEstimate(origin, dest, speedKmh);
      return;
    }

    const options: RouteOption[] = [{ id: 'primary', chain: primary }];

    // Alternates: route through perpendicular via points to force distinct corridors.
    const wantAlts = this._panelEl?.querySelector<HTMLInputElement>('#reach-alts')?.checked ?? true;
    if (wantAlts) {
      const vias = this._viaPoints(origin, dest, 2);
      for (const via of vias) {
        if (options.length >= 3) break;
        const alt = await this._routeChain([origin, via, dest], speedKmh);
        if (alt.okLegs === 0) continue;
        // Drop near-duplicates of an existing option (same corridor by distance).
        const dup = options.some((o) => Math.abs(o.chain.distKm - alt.distKm) / Math.max(1, o.chain.distKm) < 0.03);
        if (!dup) options.push({ id: `alt-${options.length}`, chain: alt });
      }
    }

    // Default to the fastest option.
    let best = 0;
    for (let i = 1; i < options.length; i++) {
      if (options[i].chain.timeMin < options[best].chain.timeMin) best = i;
    }
    this._routeOptions = options;
    this._selectedRoute = best;
    this._paintRoutes();
  }

  /** Shared offline fallback for route mode: straight-line great-circle + ETA. */
  private _renderStraightLineEstimate(origin: Point, dest: Point, speedKmh: number, reason?: string): void {
    const oLon = origin.longitude ?? 0, oLat = origin.latitude ?? 0;
    const dLon = dest.longitude ?? 0, dLat = dest.latitude ?? 0;
    const distKm = this._haversineM(oLon, oLat, dLon, dLat) / 1000;
    const etaMin = speedKmh > 0 ? (distKm / speedKmh) * 60 : 0;

    this._analysisLayer.add(new Graphic({
      geometry: { type: 'polyline', paths: [[[oLon, oLat], [dLon, dLat]]], spatialReference: { wkid: 4326 } } as any,
      symbol: this._lineSymbol([52, 140, 220], 3, 0.85, true),
      attributes: { type: 'trafficability_route', source: 'estimate', distanceKm: distKm },
    }));
    this._drawOriginMarker();
    this._drawDestMarker();

    this._setText('#reach-st-1-val', distKm.toFixed(1));
    this._setText('#reach-st-1-lbl', 'Dist km*');
    this._setText('#reach-st-2-val', etaMin.toFixed(0));
    this._setText('#reach-st-2-lbl', 'ETA min*');
    this._setText('#reach-st-3-val', 'EST');
    this._setText('#reach-st-3-lbl', 'Source');
    this._setText('#reach-traffic-note', '');
    this._setText('#reach-steps', '');
    this._setText('#reach-legend', '');
    this._setText('#reach-routes', '');
    this._routeOptions = [];
    this._selectedRoute = 0;

    this._driveModel = this._buildDriveModel(
      [[oLon, oLat], [dLon, dLat]],
      [{ km: distKm, min: etaMin, name: 'Direct (estimate)', fclass: '', speedKmh }],
      true,
    );
    this._showScrubber();

    this._addCallout(oLon, oLat, '#34C0AE', `<div class="reach-co-title">🚩 Start</div>`);
    this._addCallout(dLon, dLat, '#EF9F27',
      `<div class="reach-co-title">🏁 Destination (estimate)</div>
       <div class="reach-co-row">~<b>${distKm.toFixed(1)} km</b> · ~<b>${etaMin.toFixed(0)} min</b> @ ${speedKmh} km/h</div>`);
    this._repositionCallouts();

    const reasonStr = reason ? ` (${reason})` : '';
    this._setSourceNote(`Estimate${reasonStr} — straight line at ${speedKmh} km/h. Bring the road service online for a real route. 🛰`);
    this._setStatus('estimate');
  }

  // ─── Private: MSR finding ───────────────────────────────────────────────────

  private async _runMsr(): Promise<void> {
    if (this._waypoints.length < 2) return;
    this._stopDrive();
    this._clearCallouts();
    this._analysisLayer.removeAll();
    this._driveModel = null;

    const speedKmh = Number(this._inp('reach-speed')?.value ?? 40);

    const chain = await this._routeChain(this._waypoints, speedKmh);
    const { path, segs, traffic, degraded } = chain;
    const liveAny = chain.okLegs > 0;

    // Merged MSR centreline, coloured per-segment by trafficability tier.
    if (path.length >= 2) this._renderTieredPath(path, segs, { type: 'trafficability_msr' });
    this._drawWaypointMarkers();

    const cls = this._msrClassification(traffic, liveAny);
    this._setText('#reach-st-1-val', chain.distKm.toFixed(1));
    this._setText('#reach-st-1-lbl', liveAny ? 'Dist km' : 'Dist km*');
    this._setText('#reach-st-2-val', chain.timeMin.toFixed(0));
    this._setText('#reach-st-2-lbl', liveAny ? 'Time min' : 'ETA min*');
    this._setText('#reach-st-3-val', cls.short);
    this._setText('#reach-st-3-lbl', 'Class');

    this._renderTrafficability(traffic);
    this._renderSegList(segs);
    this._renderTierLegend(segs);
    this._setText('#reach-routes', '');

    // Waypoint callouts: SP / CP-n / RP.
    this._waypoints.forEach((wp, i) => {
      const isFirst = i === 0;
      const isLast = i === this._waypoints.length - 1;
      const label = isFirst ? '🚩 SP — Start Point' : isLast ? '🏁 RP — Release Point' : `🔹 CP-${i} — Checkpoint`;
      this._addCallout(wp.longitude ?? 0, wp.latitude ?? 0, isLast ? '#E24B4A' : isFirst ? '#34C0AE' : '#5092DC',
        `<div class="reach-co-title">${label}</div>`);
    });
    // MSR summary callout near the route midpoint.
    if (path.length) {
      const mid = path[Math.floor(path.length / 2)];
      this._addCallout(mid[0], mid[1], this._trafficColor(traffic?.rating),
        `<div class="reach-co-title">🛣 ${cls.label}</div>
         <div class="reach-co-row"><b>${chain.distKm.toFixed(1)} km</b> · <b>${chain.timeMin.toFixed(0)} min</b>${degraded ? ' · partial' : ''}</div>
         ${traffic ? `<div class="reach-co-chip" style="--c:${this._trafficColor(traffic.rating)}">${traffic.rating}</div>
         <div class="reach-co-row">Bottleneck: ${this._escape(RoadNetworkEngine.classifyClass(traffic.limitingClass).label)} (type ${RoadNetworkEngine.classifyClass(traffic.limitingClass).routeType})</div>` : ''}
         <div class="reach-co-note">${cls.blurb}</div>`);
    }

    // Build playback model.
    this._driveModel = segs.length ? this._buildDriveModel(path, segs, !liveAny || degraded) : null;
    if (this._driveModel) this._showScrubber(); else this._hideScrubber();

    this._repositionCallouts();
    this._setSourceNote(
      liveAny
        ? `${degraded ? 'Partial road MSR' : 'Road MSR'} over ${this._waypoints.length} waypoints. ${cls.blurb}`
        : `Estimate — straight-line MSR at ${speedKmh} km/h.`,
    );
    this._setStatus(liveAny ? 'ready' : 'estimate');
  }

  /** Classify an MSR/ASR from its aggregate trafficability. */
  private _msrClassification(traffic: TrafficabilitySummary | null, live: boolean):
    { short: string; label: string; blurb: string } {
    if (!live || !traffic) {
      return { short: 'EST', label: 'Provisional route', blurb: 'Estimate only — verify against the live road network.' };
    }
    const lim = RoadNetworkEngine.classifyClass(traffic.limitingClass);
    if (traffic.rating === 'GO' && lim.routeType === 'X') {
      return { short: 'MSR', label: 'MSR · All-Weather', blurb: 'Strong main supply route — all-weather throughout. ✅' };
    }
    if (traffic.rating === 'GO') {
      return { short: 'MSR', label: 'MSR · Trafficable', blurb: 'Good main supply route — trafficable for sustained traffic. 👍' };
    }
    if (traffic.rating === 'SLOW-GO') {
      return { short: 'ASR', label: 'ASR · Limited', blurb: 'Alternate supply route — limited / fair-weather sections; plan for slower movement.' };
    }
    return { short: 'NO-GO', label: 'Restricted', blurb: 'Contains NO-GO segments — not recommended for supply traffic without improvement. ⚠' };
  }

  // ─── Private: route chaining & alternates ───────────────────────────────────

  /**
   * Route a chain of points (origin→via…→dest) leg by leg on the road network,
   * merging into one path + ordered leg list + aggregate trafficability. Each
   * failed leg degrades to a straight-line estimate. Shared by Route alternates
   * and MSR finding. Never throws.
   */
  private async _routeChain(points: Point[], speedKmh: number): Promise<RouteChain> {
    const rn = this._roadNet();
    if (rn && rn.availability === 'unknown') await rn.ensureAvailable();

    const path: number[][] = [];
    const segs: DriveSeg[] = [];
    const byClassKm: Record<string, number> = {};
    let okLegs = 0, distKm = 0, timeMin = 0, degraded = false;

    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      let res: any = null;
      if (rn) {
        try { res = await rn.route(a, b); } catch { res = { ok: false }; }
      }
      if (res?.ok && res.data?.geometry) {
        const data = res.data as RouteData;
        const coords = this._flattenGeoJson(data.geometry);
        if (path.length && coords.length) coords.shift(); // drop duplicate join vertex
        path.push(...coords);
        okLegs++;
        distKm += data.distanceKm || 0;
        timeMin += data.travelTimeMin || 0;
        for (const c of data.byClass ?? []) byClassKm[c.fclass] = (byClassKm[c.fclass] || 0) + (c.km || 0);
        for (const s of this._segsFromSteps(data, speedKmh)) segs.push(s);
      } else {
        const aLon = a.longitude ?? 0, aLat = a.latitude ?? 0, bLon = b.longitude ?? 0, bLat = b.latitude ?? 0;
        if (!path.length) path.push([aLon, aLat]);
        path.push([bLon, bLat]);
        const legKm = this._haversineM(aLon, aLat, bLon, bLat) / 1000;
        const legMin = speedKmh > 0 ? (legKm / speedKmh) * 60 : 0;
        distKm += legKm;
        timeMin += legMin;
        segs.push({ km: legKm, min: legMin, name: `Leg ${i + 1} (straight-line estimate)`, fclass: '', speedKmh, estimate: true });
        degraded = true;
      }
    }

    const traffic: TrafficabilitySummary | null = okLegs > 0 && Object.keys(byClassKm).length
      ? RoadNetworkEngine.classifyRoute(Object.entries(byClassKm).map(([fclass, km]) => ({ fclass, km })))
      : null;

    return { path, segs, distKm, timeMin, traffic, okLegs, degraded };
  }

  /** Candidate via points offset perpendicular to the O→D line, alternating sides. */
  private _viaPoints(origin: Point, dest: Point, n: number): Point[] {
    const oLon = origin.longitude ?? 0, oLat = origin.latitude ?? 0;
    const dLon = dest.longitude ?? 0, dLat = dest.latitude ?? 0;
    const midLon = (oLon + dLon) / 2, midLat = (oLat + dLat) / 2;
    const baseKm = this._haversineM(oLon, oLat, dLon, dLat) / 1000;
    const bearing = this._bearing(oLon, oLat, dLon, dLat);
    const mags = [0.22, 0.42, 0.62];
    const out: Point[] = [];
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? 90 : -90;
      const offKm = Math.max(1, Math.min(40, baseKm * mags[Math.floor(i / 2) % mags.length]));
      const v = this._destinationPoint(midLon, midLat, (bearing + side + 360) % 360, offKm * 1000);
      out.push(new Point({ longitude: v.longitude, latitude: v.latitude, spatialReference: { wkid: 4326 } }));
    }
    return out;
  }

  /** Repaint all Route-mode options: selected one tier-coloured + emphasised, others dim. */
  private _paintRoutes(): void {
    const origin = this._origin, dest = this._dest;
    if (!origin || !dest || !this._routeOptions.length) return;
    this._stopDrive();
    this._clearCallouts();
    this._analysisLayer.removeAll();

    const altAccents = ['#B070E0', '#8EC4FF', '#E5A540'];
    const sel = Math.max(0, Math.min(this._selectedRoute, this._routeOptions.length - 1));
    this._selectedRoute = sel;

    // Dim alternates underneath; selected route on top.
    this._routeOptions.forEach((o, i) => {
      if (i !== sel) this._renderDimRoute(o.chain.path, altAccents[i % altAccents.length], { optionId: o.id });
    });
    const selChain = this._routeOptions[sel].chain;
    this._renderTieredPath(selChain.path, selChain.segs, { optionId: this._routeOptions[sel].id });

    this._drawOriginMarker();
    this._drawDestMarker();

    // Callouts: start, selected destination summary, alternate labels.
    this._addCallout(origin.longitude ?? 0, origin.latitude ?? 0, '#34C0AE', `<div class="reach-co-title">🚩 Start</div>`);
    this._addRouteSummaryCallout(dest, selChain.distKm, selChain.timeMin, selChain.traffic);
    this._routeOptions.forEach((o, i) => {
      if (i === sel || o.chain.path.length === 0) return;
      const mid = o.chain.path[Math.floor(o.chain.path.length / 2)];
      const rating = o.chain.traffic?.rating ?? 'EST';
      this._addCallout(mid[0], mid[1], altAccents[i % altAccents.length],
        `<div class="reach-co-title">↪ Alternate ${i}</div>
         <div class="reach-co-row"><b>${o.chain.distKm.toFixed(1)} km</b> · <b>${o.chain.timeMin.toFixed(0)} min</b> · ${rating}</div>`);
    });

    // Stats / breakdown / legend / list for the selected route.
    this._setText('#reach-st-1-val', selChain.distKm.toFixed(1)); this._setText('#reach-st-1-lbl', 'Dist km');
    this._setText('#reach-st-2-val', selChain.timeMin.toFixed(0)); this._setText('#reach-st-2-lbl', 'Time min');
    this._setText('#reach-st-3-val', selChain.traffic?.rating ?? '—'); this._setText('#reach-st-3-lbl', 'Traffic');
    this._renderTrafficability(selChain.traffic);
    this._renderSegList(selChain.segs);
    this._renderTierLegend(selChain.segs);
    this._renderRoutesList();

    this._driveModel = this._buildDriveModel(selChain.path, selChain.segs, selChain.degraded);
    this._showScrubber();
    this._repositionCallouts();

    const altCount = this._routeOptions.length - 1;
    this._setSourceNote(
      `Selected ${sel === 0 ? 'primary (MSR)' : `alternate ${sel} (ASR)`} · ${selChain.distKm.toFixed(1)} km, ${selChain.timeMin.toFixed(0)} min` +
      (altCount > 0 ? ` · ${altCount} alternate${altCount === 1 ? '' : 's'} found — tap a route below to compare. 🚙` : '. Hit ▶ to drive it. 🚙'),
    );
    this._setStatus('ready');
  }

  /** Render the selectable list of route options (primary + alternates). */
  private _renderRoutesList(): void {
    const el = this._panelEl?.querySelector<HTMLElement>('#reach-routes');
    if (!el) return;
    if (this._mode !== 'route' || this._routeOptions.length <= 1) { el.innerHTML = ''; return; }
    const altAccents = ['#5092DC', '#B070E0', '#8EC4FF', '#E5A540'];
    el.innerHTML = this._routeOptions.map((o, i) => {
      const c = o.chain;
      const selCls = i === this._selectedRoute ? ' reach-route-sel' : '';
      const name = i === 0 ? 'Primary · MSR' : `Alternate ${i} · ASR`;
      const rating = c.traffic?.rating ?? 'EST';
      return `<div class="reach-route-row${selCls}" data-idx="${i}">
        <span class="reach-route-swatch" style="background:${altAccents[i % altAccents.length]}"></span>
        <span class="reach-route-name">${name}</span>
        <span class="reach-route-meta">${c.distKm.toFixed(1)}km · ${c.timeMin.toFixed(0)}min · <b style="color:${this._trafficColor(c.traffic?.rating)}">${rating}</b></span>
      </div>`;
    }).join('');
    el.querySelectorAll<HTMLElement>('.reach-route-row').forEach((row) => {
      row.addEventListener('click', () => {
        const idx = Number(row.dataset.idx);
        if (Number.isFinite(idx) && idx !== this._selectedRoute) {
          this._selectedRoute = idx;
          this._paintRoutes();
        }
      });
    });
  }

  /** Draw a path coloured per-segment by GO/SLOW-GO/NO-GO tier, over a dark casing. */
  private _renderTieredPath(path: number[][], segs: DriveSeg[], attrs: any = {}): void {
    if (path.length < 2) return;
    const cum: number[] = [0];
    for (let i = 1; i < path.length; i++) {
      cum[i] = cum[i - 1] + this._haversineM(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]) / 1000;
    }
    const pathKm = cum[cum.length - 1] || 0;
    const segKm = segs.reduce((a, s) => a + (s.km || 0), 0) || pathKm;

    // Dark casing for contrast.
    this._analysisLayer.add(new Graphic({
      geometry: { type: 'polyline', paths: [path], spatialReference: { wkid: 4326 } } as any,
      symbol: this._lineSymbol([14, 20, 26], 8, 0.5),
      attributes: { type: 'trafficability_route_casing', interactive: false, ...attrs },
    }));

    let segStartKm = 0;
    for (const s of segs) {
      const segEndKm = segStartKm + (s.km || 0);
      const startDist = segKm > 0 ? (segStartKm / segKm) * pathKm : 0;
      const endDist = segKm > 0 ? (segEndKm / segKm) * pathKm : pathKm;
      segStartKm = segEndKm;
      const sub = this._pathSlice(path, cum, startDist, endDist);
      if (sub.length < 2) continue;
      const tier = s.estimate ? undefined : RoadNetworkEngine.classifyClass(s.fclass).trafficability;
      const color = this._tierColorRgb(tier);
      this._analysisLayer.add(new Graphic({
        geometry: { type: 'polyline', paths: [sub], spatialReference: { wkid: 4326 } } as any,
        symbol: this._lineSymbol(color, 5, 0.95, !!s.estimate),
        attributes: { type: 'trafficability_route', tier: tier ?? 'EST', fclass: s.fclass, ...attrs },
      }));
    }
  }

  /** Extract the sub-path between two cumulative distances (interpolated endpoints). */
  private _pathSlice(path: number[][], cum: number[], startKm: number, endKm: number): number[][] {
    const pathKm = cum[cum.length - 1] || 0;
    const s = Math.max(0, Math.min(startKm, pathKm));
    const e = Math.max(s, Math.min(endKm, pathKm));
    const interp = (d: number): number[] => {
      if (d <= 0) return path[0];
      if (d >= pathKm) return path[path.length - 1];
      for (let i = 1; i < cum.length; i++) {
        if (cum[i] >= d) {
          const span = cum[i] - cum[i - 1] || 1e-9;
          const f = (d - cum[i - 1]) / span;
          const a = path[i - 1], b = path[i];
          return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        }
      }
      return path[path.length - 1];
    };
    const out: number[][] = [interp(s)];
    for (let i = 0; i < cum.length; i++) {
      if (cum[i] > s && cum[i] < e) out.push(path[i]);
    }
    out.push(interp(e));
    return out;
  }

  /** Thin, dim line for a non-selected alternate route. */
  private _renderDimRoute(path: number[][], accent: string, attrs: any = {}): void {
    if (path.length < 2) return;
    this._analysisLayer.add(new Graphic({
      geometry: { type: 'polyline', paths: [path], spatialReference: { wkid: 4326 } } as any,
      symbol: this._lineSymbol(this._hexToRgb(accent), 2.8, 0.55),
      attributes: { type: 'trafficability_route_alt', interactive: false, ...attrs },
    }));
  }

  /** Per-leg list with a trafficability-tier coloured dot. */
  private _renderSegList(segs: DriveSeg[]): void {
    const el = this._panelEl?.querySelector<HTMLElement>('#reach-steps');
    if (!el) return;
    if (!segs.length) { el.innerHTML = ''; return; }
    const rows = segs.slice(0, 30).map((s) => {
      const tier = s.estimate ? undefined : RoadNetworkEngine.classifyClass(s.fclass).trafficability;
      const c = this._tierColorRgb(tier);
      return `<div class="reach-step">
        <span class="reach-step-dot" style="background:rgb(${c[0]},${c[1]},${c[2]})"></span>
        <span class="reach-step-name">${this._escape(s.name)}</span>
        <span class="reach-step-km">${s.km.toFixed(1)} km</span>
      </div>`;
    }).join('');
    const more = segs.length > 30 ? `<div class="reach-step-more">+${segs.length - 30} more legs…</div>` : '';
    el.innerHTML = rows + more;
  }

  /** Legend of the GO/SLOW-GO/NO-GO tiers present along the route. */
  private _renderTierLegend(segs: DriveSeg[]): void {
    const el = this._panelEl?.querySelector<HTMLElement>('#reach-legend');
    if (!el) return;
    const present = new Set<Trafficability>();
    let hasEstimate = false;
    for (const s of segs) {
      if (s.estimate) hasEstimate = true;
      else present.add(RoadNetworkEngine.classifyClass(s.fclass).trafficability);
    }
    const tiers: Trafficability[] = ['GO', 'SLOW-GO', 'NO-GO'];
    const items = tiers.filter((t) => present.has(t)).map((t) => {
      const c = this._tierColorRgb(t);
      return `<span class="reach-leg-item"><span class="reach-leg-swatch" style="background:rgb(${c[0]},${c[1]},${c[2]})"></span>${t}</span>`;
    });
    if (hasEstimate) items.push(`<span class="reach-leg-item"><span class="reach-leg-swatch" style="background:rgb(150,150,160)"></span>Estimate</span>`);
    el.innerHTML = items.join('');
  }

  // ─── Private: small math/colour helpers ─────────────────────────────────────

  private _bearing(lon1: number, lat1: number, lon2: number, lat2: number): number {
    const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  private _hexToRgb(hex: string): [number, number, number] {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [136, 136, 136];
  }

  private _tierColorRgb(t: Trafficability | undefined): [number, number, number] {
    return t === 'GO' ? [29, 158, 117] : t === 'SLOW-GO' ? [239, 159, 39] : t === 'NO-GO' ? [226, 75, 74] : [150, 150, 160];
  }

  // ─── Private: rendering helpers ─────────────────────────────────────────────

  private _renderTrafficability(traffic: TrafficabilitySummary | null | undefined): void {
    const el = this._panelEl?.querySelector<HTMLElement>('#reach-traffic-note');
    if (!el) return;
    if (!traffic || traffic.classes.length === 0) {
      el.textContent = '';
      return;
    }
    const lim = RoadNetworkEngine.classifyClass(traffic.limitingClass);
    const breakdown = traffic.classes
      .slice(0, 4)
      .map((c) => `${c.info.label} ${c.pct.toFixed(0)}%`)
      .join(' · ');
    el.innerHTML =
      `<span class="reach-co-chip" style="--c:${this._trafficColor(traffic.rating)}">${traffic.rating}</span> ` +
      `limiting: <b>${this._escape(lim.label)}</b> (route type ${lim.routeType}). ${this._escape(breakdown)}`;
  }

  private _renderBandLegend(bands: ServiceBand[], source: 'live' | 'estimate'): void {
    const el = this._panelEl?.querySelector<HTMLElement>('#reach-legend');
    if (!el) return;
    if (!bands.length) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = bands
      .map((b) => {
        const c = b.color;
        const detail = source === 'live' && b.roadKm > 0 ? ` · ${b.roadKm.toFixed(0)} km` : '';
        return `<span class="reach-leg-item">
          <span class="reach-leg-swatch" style="background:rgb(${c[0]},${c[1]},${c[2]})"></span>
          ${Math.round(b.minutes)} min${detail}
        </span>`;
      })
      .join('');
  }

  private _renderWaypointList(): void {
    const el = this._panelEl?.querySelector<HTMLElement>('#reach-wp-list');
    if (!el) return;
    if (!this._waypoints.length) {
      el.innerHTML = '<div class="reach-hint">No waypoints yet — click the map to drop the Start Point.</div>';
      return;
    }
    el.innerHTML = this._waypoints
      .map((wp, i) => {
        const isFirst = i === 0;
        const isLast = i === this._waypoints.length - 1 && this._waypoints.length > 1;
        const tag = isFirst ? 'SP' : isLast ? 'RP' : `CP-${i}`;
        return `<div class="reach-wp">
          <span class="reach-wp-tag">${tag}</span>
          <span class="reach-wp-coords">${(wp.latitude ?? 0).toFixed(4)}, ${(wp.longitude ?? 0).toFixed(4)}</span>
        </div>`;
      })
      .join('');
  }

  // ─── Private: Placement ─────────────────────────────────────────────────────

  private _startOriginPlacement(): void {
    if (!this._view) return;
    this._cancelPlacement();
    this._placeMode = 'origin';
    this._setStatus('placing');
    this._clickHandle = this._view.on('click', async (event: any) => {
      this._cancelPlacement();
      this._origin = await this._pickMapPoint(event);
      if (this._mode === 'msr') this._waypoints = [this._origin];
      this._drawOriginMarker();
      if (this._mode === 'msr') this._drawWaypointMarkers();
      this._setStatus('ready');
    });
  }

  private _startDestPlacement(): void {
    if (!this._view) return;
    this._cancelPlacement();
    this._placeMode = 'dest';
    this._setStatus('placing');
    this._clickHandle = this._view.on('click', async (event: any) => {
      this._cancelPlacement();
      this._dest = await this._pickMapPoint(event);
      this._drawDestMarker();
      void this._run();
    });
  }

  /** MSR: a single click handler that appends a waypoint on every click. */
  private _startWaypointPlacement(): void {
    if (!this._view) return;
    this._cancelPlacement();
    this._placeMode = 'waypoint';
    this._setStatus('placing');
    this._setWaypointBtn(true);
    this._clickHandle = this._view.on('click', async (event: any) => {
      const pt = await this._pickMapPoint(event);
      this._waypoints.push(pt);
      if (this._waypoints.length === 1) this._origin = pt;
      this._drawWaypointMarkers();
      this._drawWaypointPreview();
      this._setStatus('placing');
    });
  }

  private _finishWaypointPlacement(): void {
    this._cancelPlacement();
    this._setWaypointBtn(false);
    if (this._waypoints.length >= 2) void this._run();
    else this._setSourceNote('Add at least two waypoints, then Find MSR.');
  }

  /** Light dashed preview through the current waypoints while still placing. */
  private _drawWaypointPreview(): void {
    this._analysisLayer.graphics
      .filter((g: Graphic) => g.attributes?.type === 'trafficability_wp_preview')
      .forEach((g: Graphic) => this._analysisLayer.remove(g));
    if (this._waypoints.length < 2) return;
    const coords = this._waypoints.map((w) => [w.longitude ?? 0, w.latitude ?? 0]);
    this._analysisLayer.add(new Graphic({
      geometry: { type: 'polyline', paths: [coords], spatialReference: { wkid: 4326 } } as any,
      symbol: this._lineSymbol([150, 170, 200], 1.6, 0.7, true),
      attributes: { type: 'trafficability_wp_preview' },
    }));
  }

  private _setWaypointBtn(active: boolean): void {
    const btn = this._panelEl?.querySelector<HTMLButtonElement>('#reach-add-wp-btn');
    if (btn) btn.textContent = active ? 'Done Adding ✓' : 'Add Waypoints ⊕';
  }

  private _cancelPlacement(): void {
    if (this._clickHandle) {
      this._clickHandle.remove();
      this._clickHandle = null;
    }
    this._placeMode = null;
  }

  private async _pickMapPoint(event: any): Promise<Point> {
    if (!this._view) {
      return new Point({ longitude: 0, latitude: 0, spatialReference: { wkid: 4326 } });
    }
    if (this._view.type === '3d') {
      const hit = await (this._view as any).hitTest(event, { include: [(this._view as any).map.ground] });
      const gp = hit?.ground?.mapPoint ?? event.mapPoint;
      return new Point({ longitude: gp.longitude, latitude: gp.latitude, spatialReference: { wkid: 4326 } });
    }
    return new Point({
      longitude: event.mapPoint.longitude,
      latitude: event.mapPoint.latitude,
      spatialReference: { wkid: 4326 },
    });
  }

  // ─── Private: Smart callouts ────────────────────────────────────────────────

  private _ensureCalloutHost(): void {
    const container = this._view?.container as HTMLElement | undefined;
    if (!container) return;
    if (!this._calloutHost) {
      this._calloutHost = document.createElement('div');
      this._calloutHost.className = 'reach-callout-host';
      container.appendChild(this._calloutHost);
    } else if (this._calloutHost.parentElement !== container) {
      container.appendChild(this._calloutHost);
    }
    if (!this._viewWatchHandle && this._view) {
      // Reposition on any pan / zoom / rotate (extent updates each frame).
      this._viewWatchHandle = reactiveUtils.watch(
        () => (this._view as any)?.extent,
        () => this._repositionCallouts(),
      );
    }
  }

  private _teardownCalloutHost(): void {
    this._viewWatchHandle?.remove?.();
    this._viewWatchHandle = null;
    this._calloutHost?.remove();
    this._calloutHost = null;
  }

  private _addCallout(lng: number, lat: number, accent: string, html: string): void {
    this._ensureCalloutHost();
    if (!this._calloutHost) return;
    const el = document.createElement('div');
    el.className = 'reach-callout';
    el.style.setProperty('--c', accent);
    el.innerHTML = html;
    this._calloutHost.appendChild(el);
    this._callouts.push({ el, lng, lat });
  }

  private _clearCallouts(): void {
    this._callouts.forEach((c) => c.el.remove());
    this._callouts = [];
    this._vehicleCallout?.el.remove();
    this._vehicleCallout = null;
  }

  private _repositionCallouts(): void {
    const view = this._view as any;
    if (!view || !view.ready) return;
    const place = (c: CalloutEntry) => {
      let screen: any = null;
      try {
        screen = view.toScreen(new Point({ longitude: c.lng, latitude: c.lat, spatialReference: { wkid: 4326 } }));
      } catch {
        screen = null;
      }
      if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) {
        c.el.style.display = 'none';
        return;
      }
      c.el.style.display = '';
      c.el.style.left = `${screen.x}px`;
      c.el.style.top = `${screen.y}px`;
    };
    this._callouts.forEach(place);
    if (this._vehicleCallout) place(this._vehicleCallout);
  }

  private _addRouteSummaryCallout(
    dest: Point, distanceKm: number, timeMin: number, traffic: TrafficabilitySummary | null | undefined,
  ): void {
    const chip = traffic
      ? `<div class="reach-co-chip" style="--c:${this._trafficColor(traffic.rating)}">${traffic.rating}</div>`
      : '';
    const lim = traffic ? RoadNetworkEngine.classifyClass(traffic.limitingClass) : null;
    this._addCallout(dest.longitude ?? 0, dest.latitude ?? 0, '#5092DC',
      `<div class="reach-co-title">🏁 Destination</div>
       <div class="reach-co-row"><b>${distanceKm.toFixed(1)} km</b> · <b>${timeMin.toFixed(0)} min</b> by road</div>
       ${chip}
       ${lim ? `<div class="reach-co-row">Bottleneck: ${this._escape(lim.label)} (type ${lim.routeType})</div>` : ''}`);
  }

  // ─── Private: Vehicle playback / scrubber ───────────────────────────────────

  private _segsFromSteps(data: RouteData, fallbackSpeed: number): DriveSeg[] {
    if (data.steps?.length) {
      return data.steps.map((s) => ({
        km: s.km,
        min: s.min,
        name: s.name,
        fclass: s.fclass,
        speedKmh: s.min > 0 ? (s.km / s.min) * 60 : fallbackSpeed,
      }));
    }
    return [{
      km: data.distanceKm,
      min: data.travelTimeMin,
      name: 'Route',
      fclass: '',
      speedKmh: data.travelTimeMin > 0 ? (data.distanceKm / data.travelTimeMin) * 60 : fallbackSpeed,
    }];
  }

  private _buildDriveModel(path: number[][], segs: DriveSeg[], estimate: boolean): DriveModel | null {
    if (path.length < 2 || !segs.length) return null;
    const cum: number[] = [0];
    for (let i = 1; i < path.length; i++) {
      cum[i] = cum[i - 1] + this._haversineM(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]) / 1000;
    }
    const pathKm = cum[cum.length - 1] || 0;
    const segKm = segs.reduce((a, s) => a + (s.km || 0), 0) || pathKm;
    const totalMin = segs.reduce((a, s) => a + (s.min || 0), 0);
    return { path, cum, pathKm, segs, segKm, totalMin, estimate };
  }

  /** Sample position / speed / road at elapsed minutes along the drive model. */
  private _driveSampleAt(elapsedMin: number): DriveSample {
    const m = this._driveModel!;
    const t = Math.max(0, Math.min(elapsedMin, m.totalMin));
    // Find current segment by cumulative time.
    let acc = 0, segKmBefore = 0;
    let seg = m.segs[m.segs.length - 1];
    let tInSeg = seg.min;
    for (const s of m.segs) {
      if (t <= acc + s.min || s === m.segs[m.segs.length - 1]) {
        seg = s;
        tInSeg = t - acc;
        break;
      }
      acc += s.min;
      segKmBefore += s.km;
    }
    const coveredSegKm = segKmBefore + (seg.min > 0 ? Math.min(1, tInSeg / seg.min) : 1) * seg.km;
    const frac = m.segKm > 0 ? coveredSegKm / m.segKm : (m.totalMin > 0 ? t / m.totalMin : 0);
    const pos = this._interpAlong(Math.max(0, Math.min(1, frac)) * m.pathKm);
    return { lng: pos[0], lat: pos[1], elapsedMin: t, speedKmh: seg.speedKmh, name: seg.name, fclass: seg.fclass };
  }

  private _interpAlong(distKm: number): number[] {
    const m = this._driveModel!;
    if (distKm <= 0) return m.path[0];
    if (distKm >= m.pathKm) return m.path[m.path.length - 1];
    for (let i = 1; i < m.cum.length; i++) {
      if (m.cum[i] >= distKm) {
        const span = m.cum[i] - m.cum[i - 1] || 1e-9;
        const f = (distKm - m.cum[i - 1]) / span;
        const a = m.path[i - 1], b = m.path[i];
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      }
    }
    return m.path[m.path.length - 1];
  }

  private _showScrubber(): void {
    const wrap = this._panelEl?.querySelector<HTMLElement>('#reach-scrub-wrap');
    if (wrap) wrap.style.display = this._driveModel ? 'block' : 'none';
    if (!this._driveModel) return;
    this._animRateMinPerSec = this._driveModel.totalMin > 0 ? this._driveModel.totalMin / PLAY_DURATION_S : 1;
    const scrub = this._inp('reach-scrubber');
    if (scrub) scrub.value = '0';
    this._setupVehicleCallout();
    this._seekDrive(0);
  }

  private _hideScrubber(): void {
    const wrap = this._panelEl?.querySelector<HTMLElement>('#reach-scrub-wrap');
    if (wrap) wrap.style.display = 'none';
  }

  private _setupVehicleCallout(): void {
    this._ensureCalloutHost();
    if (!this._calloutHost) return;
    if (!this._vehicleCallout) {
      const el = document.createElement('div');
      el.className = 'reach-callout reach-callout-vehicle';
      el.style.setProperty('--c', '#5092DC');
      this._calloutHost.appendChild(el);
      this._vehicleCallout = { el, lng: 0, lat: 0 };
    }
  }

  private _seekDrive(elapsedMin: number): void {
    if (!this._driveModel) return;
    const s = this._driveSampleAt(elapsedMin);

    // Move (or create) the vehicle graphic.
    this._removeMarkers('vehicle');
    this._vehicleGraphic = new Graphic({
      geometry: new Point({ longitude: s.lng, latitude: s.lat, spatialReference: { wkid: 4326 } }),
      symbol: this._markerSymbol('circle', [80, 150, 220], 11),
      attributes: { type: 'trafficability_vehicle', markerRole: 'vehicle' },
    });
    this._markerLayer.add(this._vehicleGraphic);

    // Readouts.
    this._setText('#reach-scrub-time', `T+ ${this._fmtClock(s.elapsedMin)}`);
    this._setText('#reach-scrub-speed', `${Math.round(s.speedKmh)} km/h`);
    const roadEl = this._panelEl?.querySelector<HTMLElement>('#reach-scrub-road');
    if (roadEl) {
      const info = RoadNetworkEngine.classifyClass(s.fclass);
      const c = info.color;
      roadEl.innerHTML = `<span class="reach-step-dot" style="background:rgb(${c[0]},${c[1]},${c[2]})"></span>${this._escape(s.name)}`;
    }

    // Vehicle callout.
    if (this._vehicleCallout) {
      this._vehicleCallout.lng = s.lng;
      this._vehicleCallout.lat = s.lat;
      this._vehicleCallout.el.innerHTML =
        `<div class="reach-co-title">🚙 T+ ${this._fmtClock(s.elapsedMin)} · ${Math.round(s.speedKmh)} km/h</div>
         <div class="reach-co-row">${this._escape(s.name)}</div>`;
    }
    this._repositionCallouts();

    const scrub = this._inp('reach-scrubber');
    if (scrub && this._driveModel.totalMin > 0) {
      scrub.value = String(Math.round((s.elapsedMin / this._driveModel.totalMin) * 1000));
    }
  }

  private _playDrive(): void {
    if (!this._driveModel) return;
    const playBtn = this._panelEl?.querySelector<HTMLButtonElement>('#reach-play-btn');
    const scrub = this._inp('reach-scrubber');
    this._animRunning = true;
    if (playBtn) playBtn.textContent = '⏸';
    const total = this._driveModel.totalMin;
    this._animStartElapsedMin = scrub ? (Number(scrub.value) / 1000) * total : 0;
    if (this._animStartElapsedMin >= total) this._animStartElapsedMin = 0;
    this._animStartMs = performance.now();

    const step = (now: number) => {
      if (!this._animRunning || !this._driveModel) return;
      const elapsed = this._animStartElapsedMin + ((now - this._animStartMs) / 1000) * this._animRateMinPerSec;
      if (elapsed >= total) {
        this._seekDrive(total);
        this._animRunning = false;
        this._animFrame = null;
        if (playBtn) playBtn.textContent = '▶';
        return;
      }
      this._seekDrive(elapsed);
      this._animFrame = requestAnimationFrame(step);
    };
    this._animFrame = requestAnimationFrame(step);
  }

  private _toggleDrive(): void {
    if (this._animRunning) this._pauseDrive();
    else this._playDrive();
  }

  private _pauseDrive(): void {
    this._animRunning = false;
    if (this._animFrame != null) {
      cancelAnimationFrame(this._animFrame);
      this._animFrame = null;
    }
    const playBtn = this._panelEl?.querySelector<HTMLButtonElement>('#reach-play-btn');
    if (playBtn) playBtn.textContent = '▶';
  }

  private _stopDrive(): void {
    this._pauseDrive();
    this._removeMarkers('vehicle');
    this._vehicleGraphic = null;
    this._vehicleCallout?.el.remove();
    this._vehicleCallout = null;
  }

  private _fmtClock(min: number): string {
    const total = Math.max(0, Math.round(min * 60));
    const mm = Math.floor(total / 60);
    const ss = total % 60;
    return `${mm}:${String(ss).padStart(2, '0')}`;
  }

  // ─── Private: Mode / Commit / Clear ─────────────────────────────────────────

  private _setMode(mode: ReachMode): void {
    if (this._mode === mode) return;
    this._mode = mode;
    this._stopDrive();
    this._hideScrubber();
    this._clearCallouts();
    this._analysisLayer.removeAll();
    this._driveModel = null;
    this._routeOptions = [];
    this._selectedRoute = 0;
    if (mode === 'msr' && this._origin && this._waypoints.length === 0) this._waypoints = [this._origin];
    this._syncModeUI();
    this._clearStats();
    this._setCommitDisabled(true);
    if (mode === 'msr') {
      this._drawWaypointMarkers();
      this._renderWaypointList();
    }
    const ready = mode === 'msr' ? this._waypoints.length >= 1 : !!this._origin;
    this._setStatus(ready ? 'ready' : 'awaiting');
    if (!ready) this._startOriginPlacement();
  }

  private _syncModeUI(): void {
    if (!this._panelEl) return;
    this._panelEl.querySelectorAll<HTMLElement>('.reach-tab').forEach((t) => {
      t.classList.toggle('reach-tab-active', t.dataset.mode === this._mode);
    });
    const show = (sel: string, on: boolean) => {
      const el = this._panelEl!.querySelector<HTMLElement>(sel);
      if (el) el.style.display = on ? '' : 'none';
    };
    show('#reach-sec-servicearea', this._mode === 'serviceArea');
    show('#reach-sec-route', this._mode === 'route');
    show('#reach-sec-msr', this._mode === 'msr');
    const runBtn = this._panelEl.querySelector<HTMLButtonElement>('#reach-run-btn');
    if (runBtn) runBtn.textContent =
      this._mode === 'serviceArea' ? 'Compute Service Area' : this._mode === 'route' ? 'Compute Route' : 'Find MSR';
    this._updateRunHint();
  }

  private _commit(): void {
    if (this._analysisLayer.graphics.length === 0) return;
    const ts = new Date().toISOString();
    const persist = (g: Graphic) => {
      if (!g.geometry) return;
      if (g.attributes?.type === 'trafficability_wp_preview' || g.attributes?.markerRole === 'vehicle') return;
      this._committedLayer.add(new Graphic({
        geometry: g.geometry.clone(),
        symbol: (g as any).symbol?.clone?.() ?? (g as any).symbol,
        attributes: { ...g.attributes, committedAt: ts },
      }));
    };
    this._analysisLayer.graphics.forEach(persist);
    this._markerLayer.graphics.forEach(persist);
    this._setStatus('committed');
    setTimeout(() => this._setStatus(this._origin || this._waypoints.length ? 'ready' : 'awaiting'), 1800);
  }

  private _clear(): void {
    this._stopDrive();
    this._hideScrubber();
    this._clearCallouts();
    this._analysisLayer.removeAll();
    this._markerLayer.removeAll();
    this._cancelPlacement();
    this._setWaypointBtn(false);
    this._origin = null;
    this._dest = null;
    this._waypoints = [];
    this._driveModel = null;
    this._routeOptions = [];
    this._selectedRoute = 0;
    this._clearStats();
    this._drawOriginMarker();
    this._drawDestMarker();
    this._renderWaypointList();
    this._setCommitDisabled(true);
    this._setStatus('awaiting');
    if (this._mode === 'msr') this._startWaypointPlacement();
    else this._startOriginPlacement();
  }

  private _clearStats(): void {
    ['1', '2', '3'].forEach((n) => this._setText(`#reach-st-${n}-val`, '—'));
    this._setText('#reach-traffic-note', '');
    this._setText('#reach-steps', '');
    this._setText('#reach-legend', '');
    this._setText('#reach-routes', '');
    this._setText('#reach-source-note', '');
    if (this._mode === 'serviceArea') {
      this._setText('#reach-st-1-lbl', 'Bands');
      this._setText('#reach-st-2-lbl', 'Max (min)');
      this._setText('#reach-st-3-lbl', 'Roads km');
    } else if (this._mode === 'route') {
      this._setText('#reach-st-1-lbl', 'Dist km');
      this._setText('#reach-st-2-lbl', 'Time min');
      this._setText('#reach-st-3-lbl', 'Traffic');
    } else {
      this._setText('#reach-st-1-lbl', 'Dist km');
      this._setText('#reach-st-2-lbl', 'Time min');
      this._setText('#reach-st-3-lbl', 'Class');
    }
  }

  // ─── Private: Road status badge ─────────────────────────────────────────────

  private _refreshRoadBadge(): void {
    const el = this._panelEl?.querySelector<HTMLElement>('#reach-road-badge');
    if (!el) return;
    const rn = this._roadNet();
    const state: RoadNetworkAvailability = rn ? rn.availability : 'unavailable';
    const map: Record<string, [string, string, string]> = {
      available: ['online', '#1D9E75', rn?.lastHealth ? `Roads online · ${rn.lastHealth.edges.toLocaleString()} edges` : 'Roads online'],
      unavailable: ['offline', '#E24B4A', 'Roads offline — estimates'],
      unknown: ['probing', '#EF9F27', 'Roads: probing…'],
    };
    const [cls, color, label] = map[state] ?? map.unknown;
    el.textContent = label;
    el.style.color = color;
    el.style.borderColor = `${color}66`;
    el.dataset.state = cls;
  }

  // ─── Private: Panel ─────────────────────────────────────────────────────────

  private _showPanel(): void {
    if (!this._panelEl) {
      this._panelEl = document.createElement('div');
      this._panelEl.id = 'trafficability-engine-panel';
      this._panelEl.className = 'reach-panel';
      document.body.appendChild(this._panelEl);
    }
    this._panelEl.innerHTML = this._buildPanelHTML();
    this._panelEl.style.display = 'block';
    this._bindPanelEvents();
    this._makeDraggable();
    this._syncModeUI();
    this._clearStats();
    this._renderWaypointList();
    if (this._origin) {
      this._setText('#reach-origin-coords',
        `Origin: ${(this._origin.latitude ?? 0).toFixed(5)}°N  ${(this._origin.longitude ?? 0).toFixed(5)}°E`);
      const oLat = this._inp('reach-origin-lat');
      const oLon = this._inp('reach-origin-lon');
      if (oLat) oLat.value = (this._origin.latitude ?? 0).toFixed(5);
      if (oLon) oLon.value = (this._origin.longitude ?? 0).toFixed(5);
    } else {
      this._setText('#reach-origin-coords', 'Origin: click map (Pick ⊕) or enter a Lat/Lon and press Set');
    }
    this._setText('#reach-dest-coords', 'Destination: not set');
    this._updateRunHint();
  }

  private _hidePanel(): void {
    if (this._panelEl) this._panelEl.style.display = 'none';
  }

  private _buildPanelHTML(): string {
    return `
      <div class="reach-header" id="reach-drag-handle">
        <span class="reach-header-icon">⤳</span>
        <span class="reach-header-title">Trafficability</span>
        <span class="reach-status-dot" id="reach-status-dot"></span>
        <span class="reach-status-lbl" id="reach-status-lbl">Awaiting origin</span>
        <button class="reach-help-btn" id="reach-help-btn" title="How trafficability analysis works">?</button>
        <button class="reach-minimize-btn" id="reach-minimize-btn" title="Minimize">▼</button>
        <button class="reach-close-btn" id="reach-close-btn" title="Close (keeps graphics)">✕</button>
      </div>

      <div class="reach-help-popover" id="reach-help-popover" hidden>
        <div class="reach-help-head">
          <div>
            <div class="reach-help-kicker">Field Guide</div>
            <div class="reach-help-title">Trafficability, Routes &amp; MSRs</div>
          </div>
          <button class="reach-help-close" id="reach-help-close" title="Close">✕</button>
        </div>
        <div class="reach-help-body">
          <p>Plans movement on the real road network: how far you can get in a given drive time, the best road route between two points, and the strongest main supply route over a chain of waypoints — with a military trafficability read throughout.</p>
          <div class="reach-help-block">
            <h4>Modes</h4>
            <dl>
              <dt>Service Area</dt><dd>Multi-band drive-time isochrones from the origin, coloured near→far.</dd>
              <dt>Route</dt><dd>Shortest-time road path with distance, time, trafficability and leg list.</dd>
              <dt>MSR</dt><dd>Main Supply Route over your waypoints: routed leg-by-leg, classified MSR / ASR, with the bottleneck flagged.</dd>
            </dl>
          </div>
          <div class="reach-help-block">
            <h4>Smart Callouts</h4>
            <p>Colour-coded info cards float on the map at the origin, destination, waypoints and the moving vehicle. They track the map as you pan and zoom.</p>
          </div>
          <div class="reach-help-block">
            <h4>Play the Drive</h4>
            <p>For routes and MSRs, press ▶ to send a vehicle along the path. The readout shows elapsed time, current speed and the road class being travelled, leg by leg.</p>
          </div>
          <div class="reach-help-block">
            <h4>Offline Estimates</h4>
            <p>The road service is optional. When offline, Service Area draws geodesic range rings and Route/MSR fall back to straight-line ETAs. Estimated values are marked with *.</p>
          </div>
        </div>
      </div>

      <div class="reach-body">
        <div class="reach-tabs">
          <button class="reach-tab reach-tab-active" data-mode="serviceArea">Service Area</button>
          <button class="reach-tab" data-mode="route">Route</button>
          <button class="reach-tab" data-mode="msr">MSR</button>
        </div>

        <div class="reach-road-badge-row">
          <span class="reach-road-badge" id="reach-road-badge" data-state="unknown">Roads: probing…</span>
        </div>

        <div class="reach-sec">Origin</div>
        <div class="reach-coords" id="reach-origin-coords">Origin: click map (Pick ⊕) or enter a Lat/Lon and press Set</div>
        <div class="reach-ll-row">
          <div class="reach-ll-field"><span class="reach-label">Lat °</span><input id="reach-origin-lat" class="reach-input" type="number" step="0.00001" min="-90" max="90" placeholder="lat" /></div>
          <div class="reach-ll-field"><span class="reach-label">Lon °</span><input id="reach-origin-lon" class="reach-input" type="number" step="0.00001" min="-180" max="180" placeholder="lon" /></div>
          <button class="reach-btn reach-btn-sm" id="reach-origin-setloc-btn" title="Place the origin at the Lat/Lon entered above">Set</button>
        </div>
        <div class="reach-btn-row">
          <button class="reach-btn reach-btn-sm" id="reach-pick-origin-btn">Pick Origin ⊕</button>
        </div>

        <div id="reach-sec-servicearea">
          <div class="reach-divider"></div>
          <div class="reach-sec">Service Area</div>
          <div class="reach-slider-row">
            <span class="reach-label">Max drive time (min)</span>
            <input id="reach-maxmin" type="range" min="5" max="120" step="5" value="30" class="reach-slider" />
            <span class="reach-slider-val" id="reach-maxmin-val">30</span>
          </div>
          <div class="reach-slider-row">
            <span class="reach-label">Bands</span>
            <input id="reach-bands" type="range" min="1" max="6" step="1" value="3" class="reach-slider" />
            <span class="reach-slider-val" id="reach-bands-val">3</span>
          </div>
        </div>

        <div id="reach-sec-route" style="display:none">
          <div class="reach-divider"></div>
          <div class="reach-sec">Destination</div>
          <div class="reach-coords" id="reach-dest-coords">Destination: not set</div>
          <div class="reach-ll-row">
            <div class="reach-ll-field"><span class="reach-label">Lat °</span><input id="reach-dest-lat" class="reach-input" type="number" step="0.00001" min="-90" max="90" placeholder="lat" /></div>
            <div class="reach-ll-field"><span class="reach-label">Lon °</span><input id="reach-dest-lon" class="reach-input" type="number" step="0.00001" min="-180" max="180" placeholder="lon" /></div>
            <button class="reach-btn reach-btn-sm" id="reach-dest-setloc-btn" title="Place the destination at the Lat/Lon entered above">Set</button>
          </div>
          <div class="reach-btn-row">
            <button class="reach-btn reach-btn-sm" id="reach-pick-dest-btn">Pick Destination ⊕</button>
            <button class="reach-btn reach-btn-sm" id="reach-clear-dest-btn">Clear Dest</button>
          </div>
          <div class="reach-toggle-row">
            <label class="reach-label" for="reach-alts">Find alternate routes</label>
            <input type="checkbox" id="reach-alts" class="reach-check" checked />
          </div>
        </div>

        <div id="reach-sec-msr" style="display:none">
          <div class="reach-divider"></div>
          <div class="reach-sec">Supply Route Waypoints</div>
          <div class="reach-btn-row">
            <button class="reach-btn reach-btn-sm" id="reach-add-wp-btn">Add Waypoints ⊕</button>
            <button class="reach-btn reach-btn-sm" id="reach-clear-wp-btn">Clear WPs</button>
          </div>
          <div class="reach-wp-list" id="reach-wp-list"></div>
        </div>

        <div class="reach-divider"></div>
        <div class="reach-sec">Movement</div>
        <div class="reach-slider-row">
          <span class="reach-label">Assumed speed (km/h)</span>
          <input id="reach-speed" type="range" min="5" max="120" step="5" value="40" class="reach-slider" />
          <span class="reach-slider-val" id="reach-speed-val">40</span>
        </div>
        <div class="reach-hint">Used for offline estimates (rings &amp; ETA).</div>

        <div class="reach-divider"></div>
        <div class="reach-stats">
          <div class="reach-stat"><div class="reach-stat-val" id="reach-st-1-val">—</div><div class="reach-stat-lbl" id="reach-st-1-lbl">Bands</div></div>
          <div class="reach-stat"><div class="reach-stat-val" id="reach-st-2-val">—</div><div class="reach-stat-lbl" id="reach-st-2-lbl">Max (min)</div></div>
          <div class="reach-stat"><div class="reach-stat-val" id="reach-st-3-val">—</div><div class="reach-stat-lbl" id="reach-st-3-lbl">Roads km</div></div>
        </div>

        <div class="reach-legend" id="reach-legend"></div>
        <div class="reach-routes" id="reach-routes"></div>
        <div class="reach-source-note" id="reach-source-note"></div>
        <div class="reach-traffic-note" id="reach-traffic-note"></div>
        <div class="reach-steps" id="reach-steps"></div>

        <div class="reach-scrub-wrap" id="reach-scrub-wrap" style="display:none">
          <div class="reach-divider"></div>
          <div class="reach-sec">Drive Playback</div>
          <div class="reach-scrub-readout">
            <span class="reach-scrub-time" id="reach-scrub-time">T+ 0:00</span>
            <span class="reach-scrub-speed" id="reach-scrub-speed">0 km/h</span>
          </div>
          <div class="reach-scrub-road" id="reach-scrub-road"></div>
          <div class="reach-scrub-controls">
            <button class="reach-btn reach-btn-sm" id="reach-play-btn">▶</button>
            <input id="reach-scrubber" class="reach-slider" type="range" min="0" max="1000" step="1" value="0" />
          </div>
        </div>

        <div class="reach-btn-row reach-btn-row-main">
          <button class="reach-btn" id="reach-clear-btn">Clear</button>
          <button class="reach-btn reach-btn-primary" id="reach-run-btn">Compute Service Area</button>
          <button class="reach-btn" id="reach-commit-btn" disabled>Commit ↗</button>
        </div>
      </div>
    `;
  }

  private _bindPanelEvents(): void {
    if (!this._panelEl) return;
    const p = this._panelEl;

    p.querySelector('#reach-help-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const help = p.querySelector<HTMLElement>('#reach-help-popover');
      if (help) help.hidden = !help.hidden;
    });
    p.querySelector('#reach-help-close')?.addEventListener('click', () => {
      const help = p.querySelector<HTMLElement>('#reach-help-popover');
      if (help) help.hidden = true;
    });

    p.querySelector('#reach-minimize-btn')?.addEventListener('click', () => {
      const body = p.querySelector<HTMLElement>('.reach-body');
      const btn = p.querySelector<HTMLElement>('#reach-minimize-btn');
      if (!body || !btn) return;
      const minimized = body.style.display === 'none';
      body.style.display = minimized ? '' : 'none';
      btn.textContent = minimized ? '▼' : '▶';
    });

    p.querySelector('#reach-close-btn')?.addEventListener('click', () => this.close());

    p.querySelectorAll<HTMLButtonElement>('.reach-tab').forEach((tab) => {
      tab.addEventListener('click', () => this._setMode((tab.dataset.mode as ReachMode) ?? 'serviceArea'));
    });

    const bindSlider = (id: string) => {
      p.querySelector(`#${id}`)?.addEventListener('input', (e) => {
        this._setText(`#${id}-val`, String(Number((e.target as HTMLInputElement).value)));
      });
    };
    bindSlider('reach-maxmin');
    bindSlider('reach-bands');
    bindSlider('reach-speed');

    p.querySelector('#reach-pick-origin-btn')?.addEventListener('click', () => this._startOriginPlacement());
    p.querySelector('#reach-pick-dest-btn')?.addEventListener('click', () => this._startDestPlacement());
    p.querySelector('#reach-origin-setloc-btn')?.addEventListener('click', () => this._setOriginFromInputs());
    p.querySelector('#reach-dest-setloc-btn')?.addEventListener('click', () => this._setDestFromInputs());
    p.querySelectorAll('#reach-origin-lat, #reach-origin-lon').forEach((el) =>
      el.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') this._setOriginFromInputs();
      }),
    );
    p.querySelectorAll('#reach-dest-lat, #reach-dest-lon').forEach((el) =>
      el.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') this._setDestFromInputs();
      }),
    );
    p.querySelector('#reach-clear-dest-btn')?.addEventListener('click', () => {
      this._dest = null;
      this._drawDestMarker();
    });

    // MSR waypoint controls.
    p.querySelector('#reach-add-wp-btn')?.addEventListener('click', () => {
      if (this._placeMode === 'waypoint') this._finishWaypointPlacement();
      else this._startWaypointPlacement();
    });
    p.querySelector('#reach-clear-wp-btn')?.addEventListener('click', () => {
      this._cancelPlacement();
      this._setWaypointBtn(false);
      this._waypoints = [];
      this._origin = null;
      this._removeMarkers('waypoint');
      this._analysisLayer.removeAll();
      this._clearCallouts();
      this._renderWaypointList();
      this._updateRunHint();
      this._setStatus('awaiting');
    });

    // Drive scrubber.
    p.querySelector('#reach-play-btn')?.addEventListener('click', () => this._toggleDrive());
    p.querySelector('#reach-scrubber')?.addEventListener('input', (e) => {
      if (!this._driveModel) return;
      this._pauseDrive();
      const v = Number((e.target as HTMLInputElement).value);
      this._seekDrive((v / 1000) * this._driveModel.totalMin);
    });

    p.querySelector('#reach-run-btn')?.addEventListener('click', () => void this._run());
    p.querySelector('#reach-clear-btn')?.addEventListener('click', () => this._clear());
    p.querySelector('#reach-commit-btn')?.addEventListener('click', () => this._commit());
  }

  private _makeDraggable(): void {
    const handle = this._panelEl?.querySelector<HTMLElement>('#reach-drag-handle');
    if (!handle || !this._panelEl) return;
    handle.addEventListener('mousedown', (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      this._isDragging = true;
      const rect = this._panelEl!.getBoundingClientRect();
      this._dragOffsetX = e.clientX - rect.left;
      this._dragOffsetY = e.clientY - rect.top;
      document.addEventListener('mousemove', this._onDragMove);
      document.addEventListener('mouseup', this._onDragEnd);
    });
  }

  private _onDragMove = (e: MouseEvent): void => {
    if (!this._isDragging || !this._panelEl) return;
    const maxLeft = window.innerWidth - this._panelEl.offsetWidth - 4;
    const maxTop = window.innerHeight - this._panelEl.offsetHeight - 4;
    const left = Math.max(0, Math.min(e.clientX - this._dragOffsetX, maxLeft));
    const top = Math.max(0, Math.min(e.clientY - this._dragOffsetY, maxTop));
    this._panelEl.style.left = `${left}px`;
    this._panelEl.style.top = `${top}px`;
    this._panelEl.style.right = 'auto';
  };

  private _onDragEnd = (): void => {
    this._isDragging = false;
    document.removeEventListener('mousemove', this._onDragMove);
    document.removeEventListener('mouseup', this._onDragEnd);
  };

  // ─── Private: Utilities ─────────────────────────────────────────────────────

  private _setStatus(state: 'awaiting' | 'placing' | 'computing' | 'ready' | 'estimate' | 'committed' | 'error'): void {
    const dotEl = this._panelEl?.querySelector<HTMLElement>('#reach-status-dot');
    const lblEl = this._panelEl?.querySelector<HTMLElement>('#reach-status-lbl');
    const placingLbl =
      this._placeMode === 'dest' ? 'Pick destination…' :
      this._placeMode === 'waypoint' ? 'Click to add waypoints…' : 'Pick origin…';
    const map: Record<string, [string, string]> = {
      awaiting: ['#555', 'Awaiting origin'],
      placing: ['#34C0AE', placingLbl],
      computing: ['#EF9F27', 'Computing…'],
      ready: ['#1D9E75', 'Ready'],
      estimate: ['#EF9F27', 'Estimate (offline)'],
      committed: ['#1D9E75', 'Committed ✓'],
      error: ['#E24B4A', 'Error'],
    };
    const [color, label] = map[state] ?? map.awaiting;
    if (state === 'ready' || state === 'committed') EngineLogger.success(ENGINE_NAME, label);
    else if (state === 'error') EngineLogger.error(ENGINE_NAME, label);
    else EngineLogger.nextStep(ENGINE_NAME, label);
    if (dotEl) {
      dotEl.style.background = color;
      dotEl.style.boxShadow = `0 0 6px ${color}88`;
    }
    if (lblEl) lblEl.textContent = label;
  }

  private _setRunDisabled(disabled: boolean): void {
    const btn = this._panelEl?.querySelector<HTMLButtonElement>('#reach-run-btn');
    if (btn) btn.disabled = disabled;
  }

  private _setCommitDisabled(disabled: boolean): void {
    const btn = this._panelEl?.querySelector<HTMLButtonElement>('#reach-commit-btn');
    if (btn) btn.disabled = disabled;
  }

  private _setSourceNote(msg: string): void {
    this._setText('#reach-source-note', msg);
  }

  private _setText(selector: string, text: string): void {
    const el = this._panelEl?.querySelector<HTMLElement>(selector);
    if (el) el.textContent = text;
  }

  private _inp(id: string): HTMLInputElement | null {
    return this._panelEl?.querySelector<HTMLInputElement>(`#${id}`) ?? null;
  }

  private _escape(s: string): string {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
  }

  // ─── Private: Styles ────────────────────────────────────────────────────────

  private _injectStyles(): void {
    if (document.getElementById('trafficability-engine-styles')) return;
    const style = document.createElement('style');
    style.id = 'trafficability-engine-styles';
    style.textContent = `
      .reach-panel {
        position: fixed;
        top: 60px;
        left: 360px;
        width: 360px;
        background: var(--ms-bg);
        border: 1px solid var(--ms-border);
        border-radius: var(--ms-radius);
        color: var(--ms-text);
        font-family: var(--ms-font);
        font-size: var(--ms-fs);
        z-index: 1100;
        user-select: none;
        box-shadow: var(--ms-shadow);
        display: none;
        animation: reachPanelIn 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      @keyframes reachPanelIn {
        from { opacity: 0; transform: scale(0.94) translateY(-8px); }
        to   { opacity: 1; transform: scale(1) translateY(0); }
      }
      .reach-header {
        display: flex; align-items: center; gap: 7px;
        padding: 9px 10px 8px;
        border-bottom: 1px solid var(--ms-divider);
        background: var(--ms-bg-header);
        border-radius: 5px 5px 0 0;
        cursor: grab;
      }
      .reach-header:active { cursor: grabbing; }
      .reach-header-icon { font-size: var(--ms-fs-lg, 16px); flex-shrink: 0; color: #34C0AE; }
      .reach-header-title {
        font-size: var(--ms-fs-sm); letter-spacing: 0.12em; text-transform: uppercase;
        color: #34C0AE; font-weight: 700; flex: 1;
      }
      .reach-status-dot { width: 7px; height: 7px; border-radius: 50%; background: #555; transition: background 0.3s, box-shadow 0.3s; }
      .reach-status-lbl {
        font-size: var(--ms-fs-xs); letter-spacing: 0.08em; text-transform: uppercase;
        color: var(--ms-text-dim); min-width: 62px;
      }
      .reach-help-btn, .reach-minimize-btn, .reach-close-btn {
        background: none; border: 1px solid transparent; color: var(--ms-text-dim);
        font-size: var(--ms-fs); cursor: pointer; padding: 0 2px; line-height: 1;
        transition: color 0.15s; flex: 0 0 auto;
      }
      .reach-help-btn { width: 17px; height: 17px; border-color: var(--ms-border); border-radius: 50%; color: #34C0AE; font-weight: 700; }
      .reach-help-btn:hover, .reach-minimize-btn:hover, .reach-close-btn:hover { color: var(--ms-text); }
      .reach-help-popover {
        position: absolute; top: 39px; left: 8px; right: 8px; z-index: 1120;
        max-height: min(520px, calc(100vh - 132px)); overflow-y: auto;
        background: var(--ms-bg); border: 1px solid var(--ms-border); border-radius: 4px;
        box-shadow: var(--ms-shadow); color: var(--ms-text);
      }
      .reach-help-popover[hidden] { display: none; }
      .reach-help-head {
        display: flex; justify-content: space-between; gap: 10px;
        padding: 10px 11px 8px; border-bottom: 1px solid var(--ms-divider); background: var(--ms-bg-header);
      }
      .reach-help-kicker { font-size: var(--ms-fs-xs); color: var(--ms-text-label); letter-spacing: 0.09em; text-transform: uppercase; }
      .reach-help-title { margin-top: 2px; font-size: var(--ms-fs-sm); color: #34C0AE; font-weight: 700; }
      .reach-help-close { width: 20px; height: 20px; border: 1px solid var(--ms-border); border-radius: 3px; background: var(--ms-bg-input); color: var(--ms-text-dim); cursor: pointer; }
      .reach-help-close:hover { color: var(--ms-text); }
      .reach-help-body { padding: 10px 11px 12px; font-size: var(--ms-fs); line-height: 1.45; color: var(--ms-text-dim); user-select: text; }
      .reach-help-body p { margin: 0 0 9px; }
      .reach-help-block { margin-top: 10px; }
      .reach-help-block h4 { margin: 0 0 5px; font-size: var(--ms-fs-xs); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ms-text); }
      .reach-help-block dl { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 5px 8px; margin: 0; }
      .reach-help-block dt { color: #34C0AE; font-weight: 700; }
      .reach-help-block dd { margin: 0; }
      .reach-body { padding: 0 0 6px; }
      .reach-tabs { display: flex; gap: 4px; padding: 8px 10px 4px; }
      .reach-tab {
        flex: 1; padding: 6px 4px; font-family: inherit; font-size: var(--ms-fs-xs);
        letter-spacing: 0.05em; text-transform: uppercase; cursor: pointer; border-radius: 3px;
        border: 1px solid var(--ms-border); background: var(--ms-bg-input); color: var(--ms-text-dim); transition: all 0.14s;
      }
      .reach-tab:hover { color: var(--ms-text); }
      .reach-tab-active { border-color: #34C0AE; color: #34C0AE; background: var(--ms-bg-header); font-weight: 700; }
      .reach-road-badge-row { padding: 4px 10px 2px; }
      .reach-road-badge {
        display: inline-block; font-size: var(--ms-fs-xs); letter-spacing: 0.05em;
        padding: 2px 8px; border: 1px solid var(--ms-border); border-radius: 10px; color: var(--ms-text-dim);
      }
      .reach-sec { font-size: var(--ms-fs-xs); letter-spacing: 0.1em; text-transform: uppercase; color: var(--ms-text-label); padding: 9px 12px 4px; }
      .reach-divider { height: 1px; background: linear-gradient(90deg, transparent, var(--ms-divider), transparent); margin: 4px 0; }
      .reach-label { font-size: var(--ms-fs-xs); letter-spacing: 0.07em; text-transform: uppercase; color: var(--ms-text-dim); }
      .reach-hint { font-size: var(--ms-fs-xs); color: var(--ms-text-dim); opacity: 0.85; padding: 2px 12px 4px; font-style: italic; }
      .reach-slider-row { display: flex; align-items: center; gap: 8px; padding: 2px 10px 6px; }
      .reach-slider-row .reach-label { flex: 1; }
      .reach-slider { flex: 2; accent-color: #34C0AE; cursor: pointer; }
      .reach-slider-val { font-size: var(--ms-fs-sm); color: #34C0AE; min-width: 36px; text-align: right; }
      .reach-coords { font-size: var(--ms-fs-xs); color: var(--ms-accent); padding: 1px 12px 5px; letter-spacing: 0.04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .reach-ll-row { display: flex; align-items: flex-end; gap: 6px; padding: 2px 10px 6px; }
      .reach-ll-field { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
      .reach-input {
        background: var(--ms-bg-input); border: 1px solid var(--ms-border); border-radius: 3px;
        color: var(--ms-text); font-family: inherit; font-size: var(--ms-fs); padding: 4px 6px;
        width: 100%; outline: none; transition: border-color 0.15s;
      }
      .reach-input:focus { border-color: var(--ms-accent); }
      .reach-stats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1px; padding: 8px 10px 6px; }
      .reach-stat { display: flex; flex-direction: column; gap: 2px; }
      .reach-stat-val { font-size: var(--ms-fs-sm); font-weight: 700; letter-spacing: 0.03em; color: #34C0AE; }
      .reach-stat-lbl { font-size: var(--ms-fs-xs); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ms-text-dim); }
      .reach-legend { display: flex; flex-wrap: wrap; gap: 8px; padding: 2px 12px 4px; }
      .reach-leg-item { display: inline-flex; align-items: center; gap: 5px; font-size: var(--ms-fs-xs); color: var(--ms-text-dim); }
      .reach-leg-swatch { width: 11px; height: 4px; border-radius: 2px; display: inline-block; }
      .reach-toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 4px 12px 2px; }
      .reach-check { accent-color: #34C0AE; width: 14px; height: 14px; cursor: pointer; }
      .reach-routes { padding: 2px 10px 4px; }
      .reach-routes:empty { display: none; }
      .reach-route-row {
        display: flex; align-items: center; gap: 8px; padding: 5px 8px; margin: 3px 0;
        border: 1px solid var(--ms-border); border-radius: 5px; cursor: pointer;
        background: var(--ms-bg-input); transition: border-color 0.14s, background 0.14s;
      }
      .reach-route-row:hover { background: var(--ms-bg-header); }
      .reach-route-sel { border-color: #34C0AE; background: var(--ms-bg-header); }
      .reach-route-swatch { width: 12px; height: 4px; border-radius: 2px; flex: 0 0 auto; }
      .reach-route-name { font-size: var(--ms-fs-xs); font-weight: 700; color: var(--ms-text); flex: 0 0 auto; }
      .reach-route-meta { font-size: var(--ms-fs-xs); color: var(--ms-text-dim); flex: 1; text-align: right; }
      .reach-source-note { font-size: var(--ms-fs-xs); color: var(--ms-text-dim); padding: 2px 12px; font-style: italic; }
      .reach-source-note:empty { display: none; }
      .reach-traffic-note { font-size: var(--ms-fs-xs); color: var(--ms-text); padding: 4px 12px; line-height: 1.5; }
      .reach-traffic-note:empty { display: none; }
      .reach-wp-list { padding: 2px 12px 4px; max-height: 110px; overflow-y: auto; }
      .reach-wp { display: flex; align-items: center; gap: 8px; padding: 2px 0; font-size: var(--ms-fs-xs); }
      .reach-wp-tag { font-weight: 700; color: #34C0AE; min-width: 30px; }
      .reach-wp-coords { color: var(--ms-text-dim); font-family: var(--ms-font-mono, monospace); }
      .reach-steps { max-height: 150px; overflow-y: auto; padding: 2px 8px 4px 12px; margin: 0 2px; }
      .reach-steps:empty { display: none; }
      .reach-step { display: flex; align-items: center; gap: 7px; padding: 2px 0; font-size: var(--ms-fs-xs); border-bottom: 1px solid var(--ms-divider); }
      .reach-step-dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; display: inline-block; }
      .reach-step-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--ms-text); }
      .reach-step-km { color: var(--ms-text-dim); flex: 0 0 auto; }
      .reach-step-more { font-size: var(--ms-fs-xs); color: var(--ms-text-dim); padding: 4px 0 2px; font-style: italic; }
      .reach-co-chip { display: inline-block; font-size: var(--ms-fs-xs); font-weight: 700; color: #fff; background: var(--c, #888); padding: 1px 7px; border-radius: 9px; letter-spacing: 0.04em; }
      .reach-scrub-wrap { padding: 0; }
      .reach-scrub-readout { display: flex; justify-content: space-between; padding: 2px 12px; }
      .reach-scrub-time { font-size: var(--ms-fs-sm); font-weight: 700; color: #5092DC; font-family: var(--ms-font-mono, monospace); }
      .reach-scrub-speed { font-size: var(--ms-fs-sm); font-weight: 700; color: #34C0AE; }
      .reach-scrub-road { display: flex; align-items: center; gap: 7px; padding: 1px 12px 4px; font-size: var(--ms-fs-xs); color: var(--ms-text); }
      .reach-scrub-controls { display: flex; align-items: center; gap: 8px; padding: 2px 12px 6px; }
      .reach-scrub-controls .reach-slider { flex: 1; }
      .reach-btn-row { display: flex; gap: 6px; padding: 4px 10px; }
      .reach-btn-row-main { padding: 8px 10px 6px; }
      .reach-btn {
        flex: 1; padding: 6px 4px; font-family: inherit; font-size: var(--ms-fs-xs);
        letter-spacing: 0.05em; text-transform: uppercase; cursor: pointer; border-radius: 3px;
        border: 1px solid var(--ms-border); background: var(--ms-bg-input); color: var(--ms-text-dim); transition: all 0.14s;
      }
      .reach-btn:hover { background: var(--ms-bg-header); color: var(--ms-text); }
      .reach-btn:disabled { opacity: 0.3; cursor: not-allowed; }
      .reach-btn-sm { flex: 0 0 auto; padding: 4px 8px; }
      .reach-btn-primary { border-color: #34C0AE; color: #34C0AE; }
      .reach-btn-primary:hover { background: var(--ms-bg-header); color: var(--ms-text); }

      /* ── Smart callouts (anchored to map points) ── */
      .reach-callout-host { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 40; }
      .reach-callout {
        position: absolute; transform: translate(-50%, calc(-100% - 12px));
        min-width: 90px; max-width: 230px; pointer-events: none;
        background: rgba(16, 20, 30, 0.93); color: #e6eefb;
        border: 1px solid var(--c, #34C0AE); border-left: 3px solid var(--c, #34C0AE);
        border-radius: 7px; padding: 6px 9px; font-family: var(--ms-font, sans-serif);
        font-size: 11px; line-height: 1.4; box-shadow: 0 6px 20px rgba(0,0,0,0.45);
        backdrop-filter: blur(6px); white-space: normal;
      }
      .reach-callout::after {
        content: ''; position: absolute; left: 50%; bottom: -7px; transform: translateX(-50%);
        border-left: 7px solid transparent; border-right: 7px solid transparent; border-top: 7px solid var(--c, #34C0AE);
      }
      .reach-callout-vehicle { transform: translate(-50%, calc(-100% - 16px)); z-index: 45; }
      .reach-co-title { font-weight: 700; color: #fff; margin-bottom: 2px; }
      .reach-co-row { color: #cdd9ec; margin: 1px 0; }
      .reach-co-row b { color: #fff; }
      .reach-co-note { color: #aab8cf; font-size: 10px; margin-top: 3px; font-style: italic; }
      .reach-co-chip { margin: 2px 0; }

      @media (max-width: 520px) {
        .reach-panel { left: 14px; right: 14px; top: 56px; width: auto; }
        .reach-stats { grid-template-columns: 1fr; }
      }
    `;
    document.head.appendChild(style);
  }
}

export default TrafficabilityEngine;
