/**
 * FlightEngine.ts
 * UAV flight planning and visualization analysis engine.
 *
 * Integrated with ContextMenuManager via linkFlightEngine().
 * Right-clicking any military symbol -> Analysis -> UAV Flight Analysis
 * opens this panel with the symbol's location as launch/current UAV origin.
 *
 * Uses private GraphicsLayers:
 *   flight-route      - working route, waypoints, ETA labels
 *   flight-coverage   - endurance, sensor, and weapon envelopes
 *   flight-vehicle    - animated/current UAV marker
 *   flight-committed  - persisted flight plans after "Commit"
 */

import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polyline from '@arcgis/core/geometry/Polyline';
import Polygon from '@arcgis/core/geometry/Polygon';
import * as geometryEngine from '@arcgis/core/geometry/geometryEngine';
import EngineLogger from '../../Support/EngineLogger';
import { bindDisclosures } from '../../Support/Disclosure';

export interface FlightPreset {
  label: string;
  role: string;
  speedKmh: number;
  enduranceMin: number;
  altitudeM: number;
  sensorRangeM: number;
  sensorFovDeg: number;
  armed: boolean;
  weaponRangeM: number;
  color: [number, number, number];
  accentHex: string;
}

interface FlightPoint {
  longitude: number;
  latitude: number;
  altitudeM?: number;
}

interface FlightSegment {
  from: FlightPoint;
  to: FlightPoint;
  distanceM: number;
  bearingDeg: number;
  etaStartMin: number;
  etaEndMin: number;
}

interface FlightPlanMetrics {
  distanceM: number;
  durationMin: number;
  returnDistanceM: number;
  returnDurationMin: number;
  totalWithReturnMin: number;
  remainingMin: number;
  segments: FlightSegment[];
}

interface FlightPanelValues {
  presetKey: string;
  speedKmh: number;
  enduranceMin: number;
  altitudeM: number;
  sensorRangeM: number;
  sensorFovDeg: number;
  weaponRangeM: number;
  armed: boolean;
  showCoverage: boolean;
  showWeapon: boolean;
  showEndurance: boolean;
  showTrail: boolean;
  timelineMin: number;
}

export const UAV_PRESETS: Record<string, FlightPreset> = {
  quadcopter: {
    label: 'Quadcopter ISR',
    role: 'Short-range urban overwatch',
    speedKmh: 45,
    enduranceMin: 35,
    altitudeM: 120,
    sensorRangeM: 900,
    sensorFovDeg: 70,
    armed: false,
    weaponRangeM: 0,
    color: [58, 174, 170],
    accentHex: '#3AAEAA',
  },
  fixed_wing: {
    label: 'Small Fixed-Wing',
    role: 'Route reconnaissance',
    speedKmh: 95,
    enduranceMin: 150,
    altitudeM: 900,
    sensorRangeM: 2800,
    sensorFovDeg: 48,
    armed: false,
    weaponRangeM: 0,
    color: [72, 137, 214],
    accentHex: '#4889D6',
  },
  male_isr: {
    label: 'MALE ISR UAV',
    role: 'Persistent area surveillance',
    speedKmh: 180,
    enduranceMin: 900,
    altitudeM: 4500,
    sensorRangeM: 8500,
    sensorFovDeg: 35,
    armed: false,
    weaponRangeM: 0,
    color: [126, 156, 92],
    accentHex: '#7E9C5C',
  },
  armed_uav: {
    label: 'Armed UAV',
    role: 'Reconnaissance plus standoff engagement',
    speedKmh: 155,
    enduranceMin: 600,
    altitudeM: 3500,
    sensorRangeM: 6500,
    sensorFovDeg: 42,
    armed: true,
    weaponRangeM: 8000,
    color: [217, 112, 58],
    accentHex: '#D9703A',
  },
  relay: {
    label: 'Comms Relay Orbit',
    role: 'Airborne relay and link extension',
    speedKmh: 75,
    enduranceMin: 240,
    altitudeM: 1400,
    sensorRangeM: 2200,
    sensorFovDeg: 360,
    armed: false,
    weaponRangeM: 0,
    color: [170, 136, 210],
    accentHex: '#AA88D2',
  },
};

const WGS84 = { wkid: 4326 } as any;
const ENGINE_NAME = 'FlightEngine';
const EARTH_RADIUS_M = 6_371_008.8;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toRad(value: number): number {
  return (value * Math.PI) / 180;
}

function toDeg(value: number): number {
  return (value * 180) / Math.PI;
}

function normalizeBearing(value: number): number {
  return ((value % 360) + 360) % 360;
}

function readPoint(point: Point, fallbackAltitudeM = 0): FlightPoint {
  return {
    longitude: point.longitude ?? point.x,
    latitude: point.latitude ?? point.y,
    altitudeM: (point.z ?? fallbackAltitudeM) || fallbackAltitudeM,
  };
}

function makePoint(fp: FlightPoint, altitudeM = fp.altitudeM ?? 0): Point {
  return new Point({
    longitude: fp.longitude,
    latitude: fp.latitude,
    z: altitudeM,
    spatialReference: WGS84,
  });
}

function makeSurfacePoint(fp: FlightPoint): Point {
  return new Point({
    longitude: fp.longitude,
    latitude: fp.latitude,
    spatialReference: WGS84,
  });
}

function destinationPoint(
  origin: FlightPoint,
  bearingDeg: number,
  distanceM: number,
): FlightPoint {
  const angularDistance = distanceM / EARTH_RADIUS_M;
  const bearing = toRad(bearingDeg);
  const lat1 = toRad(origin.latitude);
  const lon1 = toRad(origin.longitude);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    longitude: toDeg(lon2),
    latitude: toDeg(lat2),
    altitudeM: origin.altitudeM,
  };
}

function distanceM(a: FlightPoint, b: FlightPoint): number {
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function bearingDeg(a: FlightPoint, b: FlightPoint): number {
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return normalizeBearing(toDeg(Math.atan2(y, x)));
}

function interpolatePoint(a: FlightPoint, b: FlightPoint, fraction: number): FlightPoint {
  const f = clamp(fraction, 0, 1);
  return {
    longitude: a.longitude + (b.longitude - a.longitude) * f,
    latitude: a.latitude + (b.latitude - a.latitude) * f,
    altitudeM: (a.altitudeM ?? 0) + ((b.altitudeM ?? 0) - (a.altitudeM ?? 0)) * f,
  };
}

function formatDistance(meters: number): string {
  if (meters >= 10_000) return `${(meters / 1000).toFixed(0)} km`;
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes)) return 'n/a';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

export class FlightEngine {
  static readonly ROUTE_LAYER_ID = 'flight-route';
  static readonly COVERAGE_LAYER_ID = 'flight-coverage';
  static readonly VEHICLE_LAYER_ID = 'flight-vehicle';
  static readonly COMMITTED_LAYER_ID = 'flight-committed';

  private _view: MapView | SceneView | null = null;
  private _routeLayer!: GraphicsLayer;
  private _coverageLayer!: GraphicsLayer;
  private _vehicleLayer!: GraphicsLayer;
  private _committedLayer!: GraphicsLayer;

  private _panelEl: HTMLDivElement | null = null;
  private _pickHandle: any = null;
  private _animationId: number | null = null;
  private _animationStartedAt = 0;
  private _animationDurationMs = 12_000;
  private _waypoints: FlightPoint[] = [];
  private _presetKey = 'fixed_wing';
  private _pendingValues: Partial<FlightPanelValues> | null = null;
  private _routeRenderKey = '';

  private _dragOffsetX = 0;
  private _dragOffsetY = 0;
  private _isDragging = false;

  private _animVehicleGraphic: Graphic | null = null;
  private _animLabelGraphic: Graphic | null = null;
  private _animWarningGraphic: Graphic | null = null;
  private _animProgressGraphic: Graphic | null = null;
  private _animTetherGraphic: Graphic | null = null;
  private _animSensorGraphic: Graphic | null = null;
  private _animWeaponGraphic: Graphic | null = null;

  constructor() {
    this._createLayers();
  }

  initialize(view: MapView | SceneView): void {
    if (this._view === view) return;
    this._view = view;
    const map = view.map as any;
    if (map && !map.findLayerById(this._routeLayer.id)) {
      map.addMany([
        this._committedLayer,
        this._coverageLayer,
        this._routeLayer,
        this._vehicleLayer,
      ]);
    }
  }

  open(graphic: Graphic, view: MapView | SceneView): void {
    this.initialize(view);
    this._stopAnimation();
    this._cancelPick();

    const attrs = graphic.attributes ?? {};
    if (attrs.type === 'flight_plan' && attrs.flightPlanJson) {
      this._loadCommittedPlan(attrs.flightPlanJson);
      this._showPanel(true);
      this._redraw();
      return;
    }

    const geom = graphic.geometry;
    let origin: Point | null = null;
    if (geom?.type === 'point') origin = geom as Point;
    else if ((geom as any)?.centroid) origin = (geom as any).centroid as Point;

    if (origin) {
      const start = readPoint(origin, this._values().altitudeM);
      this._waypoints = [start];
    }

    this._showPanel();
    this._redraw();
  }

  close(): void {
    this._hidePanel();
    this._routeLayer.removeAll();
    this._coverageLayer.removeAll();
    this._vehicleLayer.removeAll();
    this._routeRenderKey = '';
    this._waypoints = [];
    this._stopAnimation();
    this._cancelPick();
  }

  destroy(): void {
    this.close();
    const map = this._view?.map as any;
    if (map) {
      map.remove(this._routeLayer);
      map.remove(this._coverageLayer);
      map.remove(this._vehicleLayer);
      map.remove(this._committedLayer);
    }
    this._panelEl?.remove();
    this._panelEl = null;
    this._view = null;
  }

  private _createLayers(): void {
    this._routeLayer = new GraphicsLayer({
      id: FlightEngine.ROUTE_LAYER_ID,
      title: 'Flight Analysis - Route',
    });
    this._coverageLayer = new GraphicsLayer({
      id: FlightEngine.COVERAGE_LAYER_ID,
      title: 'Flight Analysis - Coverage',
      elevationInfo: { mode: 'on-the-ground' } as any,
    });
    this._vehicleLayer = new GraphicsLayer({
      id: FlightEngine.VEHICLE_LAYER_ID,
      title: 'Flight Analysis - UAV',
    });
    this._committedLayer = new GraphicsLayer({
      id: FlightEngine.COMMITTED_LAYER_ID,
      title: 'Flight Analysis - Committed',
    });
  }

  private _is3D(): boolean {
    return this._view?.type === '3d';
  }

  private _flightElevationInfo(offsetM: number): any {
    return this._is3D()
      ? { mode: 'relative-to-ground', offset: Math.max(0, offsetM) }
      : undefined;
  }

  private _values(): FlightPanelValues {
    const preset = UAV_PRESETS[this._presetKey] ?? UAV_PRESETS.fixed_wing;
    return {
      presetKey: this._selectValue('flight-preset', this._presetKey),
      speedKmh: this._num('flight-speed', preset.speedKmh),
      enduranceMin: this._num('flight-endurance', preset.enduranceMin),
      altitudeM: this._num('flight-altitude', preset.altitudeM),
      sensorRangeM: this._num('flight-sensor-range', preset.sensorRangeM),
      sensorFovDeg: this._num('flight-sensor-fov', preset.sensorFovDeg),
      weaponRangeM: this._num('flight-weapon-range', preset.weaponRangeM),
      armed: this._checked('flight-armed', preset.armed),
      showCoverage: this._checked('flight-show-coverage', true),
      showWeapon: this._checked('flight-show-weapon', preset.armed),
      showEndurance: this._checked('flight-show-endurance', true),
      showTrail: this._checked('flight-show-trail', true),
      timelineMin: this._num('flight-timeline', 0),
    };
  }

  private _computeMetrics(values: FlightPanelValues): FlightPlanMetrics {
    const speedMpm = Math.max(1, (values.speedKmh * 1000) / 60);
    const segments: FlightSegment[] = [];
    let distanceTotal = 0;
    let eta = 0;

    for (let i = 0; i < this._waypoints.length - 1; i++) {
      const from = this._waypoints[i];
      const to = this._waypoints[i + 1];
      const d = distanceM(from, to);
      const dur = d / speedMpm;
      segments.push({
        from,
        to,
        distanceM: d,
        bearingDeg: bearingDeg(from, to),
        etaStartMin: eta,
        etaEndMin: eta + dur,
      });
      distanceTotal += d;
      eta += dur;
    }

    const returnDistance =
      this._waypoints.length > 1
        ? distanceM(this._waypoints[this._waypoints.length - 1], this._waypoints[0])
        : 0;
    const returnDuration = returnDistance / speedMpm;
    const totalWithReturn = eta + returnDuration;

    return {
      distanceM: distanceTotal,
      durationMin: eta,
      returnDistanceM: returnDistance,
      returnDurationMin: returnDuration,
      totalWithReturnMin: totalWithReturn,
      remainingMin: values.enduranceMin - totalWithReturn,
      segments,
    };
  }

  private _positionAt(minutes: number, metrics: FlightPlanMetrics): { point: FlightPoint; bearingDeg: number } | null {
    if (!this._waypoints.length) return null;
    if (!metrics.segments.length) return { point: this._waypoints[0], bearingDeg: 0 };

    const t = clamp(minutes, 0, metrics.durationMin);
    const active = metrics.segments.find((seg) => t <= seg.etaEndMin) ?? metrics.segments[metrics.segments.length - 1];
    const span = Math.max(0.001, active.etaEndMin - active.etaStartMin);
    const fraction = (t - active.etaStartMin) / span;
    return {
      point: interpolatePoint(active.from, active.to, fraction),
      bearingDeg: active.bearingDeg,
    };
  }

  private _redraw(): void {
    if (!this._view) return;
    this._stopAnimation();
    const values = this._values();
    this._presetKey = values.presetKey;
    const preset = UAV_PRESETS[values.presetKey] ?? UAV_PRESETS.fixed_wing;
    const metrics = this._computeMetrics(values);

    this._coverageLayer.removeAll();
    this._vehicleLayer.removeAll();

    if (!this._waypoints.length) {
      this._routeLayer.removeAll();
      this._routeRenderKey = '';
      this._setStatus('Right-click a symbol or add a waypoint to start a flight plan.', 'warn');
      this._syncPanel(metrics, values);
      return;
    }

    const routeRenderKey = JSON.stringify({
      waypoints: this._waypoints,
      presetKey: values.presetKey,
      altitudeM: values.altitudeM,
      speedKmh: values.speedKmh,
    });
    if (routeRenderKey !== this._routeRenderKey) {
      this._routeLayer.removeAll();
      this._drawRoute(values, preset, metrics);
      this._routeRenderKey = routeRenderKey;
    }

    if (values.showEndurance) this._drawEndurance(values, preset);
    if (values.showTrail) this._drawSurveillanceTrail(values, preset, metrics);

    const current = this._positionAt(values.timelineMin, metrics);
    if (current) {
      if (values.showCoverage) this._drawSensorFootprint(current.point, current.bearingDeg, values, preset);
      if (values.armed && values.showWeapon && values.weaponRangeM > 0) {
        this._drawWeaponEnvelope(current.point, values, preset);
      }
      this._drawVehicle(current.point, current.bearingDeg, values, preset, metrics);
    }

    this._syncPanel(metrics, values);
  }

  private _drawRoute(values: FlightPanelValues, preset: FlightPreset, metrics: FlightPlanMetrics): void {
    if (this._waypoints.length > 1) {
      const path = this._waypoints.map((p) => [p.longitude, p.latitude]);
      const route = new Polyline({
        paths: [path],
        spatialReference: WGS84,
      });

      this._routeLayer.add(new Graphic({
        geometry: route,
        symbol: this._routeSymbol(preset),
        elevationInfo: this._flightElevationInfo(values.altitudeM),
        attributes: { type: 'flight_route_working' },
      } as any));
    }

    metrics.segments.forEach((seg, i) => {
      const mid = interpolatePoint(seg.from, seg.to, 0.5);
      this._routeLayer.add(new Graphic({
        geometry: this._is3D() ? makeSurfacePoint(mid) : makePoint(mid, mid.altitudeM ?? values.altitudeM),
        symbol: this._textSymbol(
          `L${i + 1} ${formatDistance(seg.distanceM)} / ${formatMinutes(seg.etaEndMin)}`,
          preset.accentHex,
          -18,
        ),
        elevationInfo: this._flightElevationInfo(mid.altitudeM ?? values.altitudeM),
        attributes: { type: 'flight_leg_label' },
      } as any));
    });

    this._waypoints.forEach((wp, i) => {
      const isLaunch = i === 0;
      const eta = i === 0 ? 0 : (metrics.segments[i - 1]?.etaEndMin ?? 0);
      this._routeLayer.add(new Graphic({
        geometry: this._is3D() ? makeSurfacePoint(wp) : makePoint(wp, wp.altitudeM ?? values.altitudeM),
        symbol: this._waypointSymbol(isLaunch, preset),
        elevationInfo: this._flightElevationInfo(wp.altitudeM ?? values.altitudeM),
        attributes: { type: 'flight_waypoint', index: i },
      } as any));
      this._routeLayer.add(new Graphic({
        geometry: this._is3D() ? makeSurfacePoint(wp) : makePoint(wp, wp.altitudeM ?? values.altitudeM),
        symbol: this._textSymbol(
          `${isLaunch ? 'LAUNCH' : `WP${i}`}  T+${formatMinutes(eta)}`,
          '#E8EDF2',
          16,
        ),
        elevationInfo: this._flightElevationInfo((wp.altitudeM ?? values.altitudeM) + 10),
        attributes: { type: 'flight_waypoint_label', index: i },
      } as any));
    });
  }

  private _drawAltitudeTether(point: FlightPoint, values: FlightPanelValues, preset: FlightPreset): void {
    if (!this._is3D()) return;
    const tether = new Polyline({
      paths: [[
        [point.longitude, point.latitude, 0],
        [point.longitude, point.latitude, values.altitudeM],
      ]],
      spatialReference: WGS84,
    });
    this._vehicleLayer.add(new Graphic({
      geometry: tether,
      symbol: this._is3D()
        ? {
            type: 'line-3d',
            symbolLayers: [{
              type: 'line',
              size: 1.4,
              material: { color: [...preset.color, 0.55] },
              pattern: { type: 'style', style: 'dash' },
              cap: 'round',
            }],
          } as any
        : {
            type: 'simple-line',
            color: [...preset.color, 0.48],
            width: 1.2,
            style: 'dot',
          } as any,
      attributes: { type: 'flight_altitude_tether' },
    } as any));
  }

  private _drawEndurance(values: FlightPanelValues, preset: FlightPreset): void {
    if (!this._waypoints[0]) return;
    const radiusM = (values.speedKmh * 1000 * values.enduranceMin) / 60;
    const returnRadiusM = radiusM / 2;
    const start = makeSurfacePoint(this._waypoints[0]);
    const maxRaw = geometryEngine.geodesicBuffer(start, radiusM, 'meters');
    const returnRaw = geometryEngine.geodesicBuffer(start, returnRadiusM, 'meters');
    const max = Array.isArray(maxRaw) ? maxRaw[0] : maxRaw;
    const ret = Array.isArray(returnRaw) ? returnRaw[0] : returnRaw;

    if (max) {
      this._coverageLayer.add(new Graphic({
        geometry: max as Polygon,
        symbol: {
          type: 'simple-fill',
          color: [58, 112, 98, 0.12],
          outline: { color: [242, 204, 108, 0.78], width: 1.9, style: 'dash' },
        } as any,
        attributes: { type: 'flight_endurance_max' },
      }));
    }
    if (ret) {
      this._coverageLayer.add(new Graphic({
        geometry: ret as Polygon,
        symbol: {
          type: 'simple-fill',
          color: [242, 204, 108, 0.10],
          outline: { color: [242, 204, 108, 0.92], width: 2.2 },
        } as any,
        attributes: { type: 'flight_return_boundary' },
      }));
    }
  }

  private _drawSurveillanceTrail(
    values: FlightPanelValues,
    preset: FlightPreset,
    metrics: FlightPlanMetrics,
  ): void {
    if (!metrics.segments.length || values.sensorRangeM <= 0) return;
    const samples = Math.min(28, Math.max(8, Math.ceil(metrics.distanceM / Math.max(1000, values.sensorRangeM))));
    for (let i = 0; i <= samples; i++) {
      const t = (metrics.durationMin * i) / samples;
      const pos = this._positionAt(t, metrics);
      if (!pos) continue;
      const raw = geometryEngine.geodesicBuffer(makeSurfacePoint(pos.point), values.sensorRangeM, 'meters');
      const geom = Array.isArray(raw) ? raw[0] : raw;
      if (!geom) continue;
      this._coverageLayer.add(new Graphic({
        geometry: geom as Polygon,
        symbol: {
          type: 'simple-fill',
          color: [...preset.color, 0.025],
          outline: { color: [...preset.color, 0.08], width: 0.6 },
        } as any,
        attributes: { type: 'flight_sensor_trail', sample: i },
      }));
    }
  }

  private _drawSensorFootprint(
    point: FlightPoint,
    headingDeg: number,
    values: FlightPanelValues,
    preset: FlightPreset,
  ): void {
    if (values.sensorRangeM <= 0) return;
    const geom =
      values.sensorFovDeg >= 355
        ? this._circle(point, values.sensorRangeM)
        : this._sector(point, headingDeg, values.sensorFovDeg, values.sensorRangeM);
    if (!geom) return;

    this._coverageLayer.add(new Graphic({
      geometry: geom,
      symbol: {
        type: 'simple-fill',
        color: [...preset.color, 0.18],
        outline: { color: [...preset.color, 0.85], width: 1.7 },
      } as any,
      attributes: { type: 'flight_sensor_footprint' },
    }));
  }

  private _drawWeaponEnvelope(
    point: FlightPoint,
    values: FlightPanelValues,
    preset: FlightPreset,
  ): void {
    const geom = this._circle(point, values.weaponRangeM);
    if (!geom) return;
    this._coverageLayer.add(new Graphic({
      geometry: geom,
      symbol: {
        type: 'simple-fill',
        color: [192, 72, 64, 0.10],
        outline: { color: [192, 72, 64, 0.84], width: 1.8, style: 'dash' },
      } as any,
      attributes: { type: 'flight_weapon_envelope' },
    }));
  }

  private _drawVehicle(
    point: FlightPoint,
    headingDeg: number,
    values: FlightPanelValues,
    preset: FlightPreset,
    metrics: FlightPlanMetrics,
  ): void {
    const remaining = Math.max(0, values.enduranceMin - values.timelineMin);
    this._drawProgressSegment(point, values, preset, metrics);
    this._drawAltitudeTether(point, values, preset);
    this._vehicleLayer.add(new Graphic({
      geometry: this._is3D() ? makeSurfacePoint(point) : makePoint(point, point.altitudeM ?? values.altitudeM),
      symbol: this._vehicleSymbol(headingDeg, preset),
      elevationInfo: this._flightElevationInfo(point.altitudeM ?? values.altitudeM),
      attributes: { type: 'flight_uav_position', timelineMin: values.timelineMin },
    } as any));
    this._vehicleLayer.add(new Graphic({
      geometry: this._is3D() ? makeSurfacePoint(point) : makePoint(point, point.altitudeM ?? values.altitudeM),
      symbol: this._textSymbol(
        `UAV T+${formatMinutes(values.timelineMin)}  ${Math.round(values.altitudeM)}m AGL  ${formatMinutes(remaining)} fuel`,
        '#F1F4EA',
        -24,
      ),
      elevationInfo: this._flightElevationInfo((point.altitudeM ?? values.altitudeM) + 18),
      attributes: { type: 'flight_uav_label' },
    } as any));

    if (metrics.remainingMin < 0) {
      this._vehicleLayer.add(new Graphic({
        geometry: this._is3D() ? makeSurfacePoint(point) : makePoint(point, point.altitudeM ?? values.altitudeM),
        symbol: this._textSymbol('ENDURANCE RISK', '#F2A45F', -44),
        elevationInfo: this._flightElevationInfo((point.altitudeM ?? values.altitudeM) + 30),
        attributes: { type: 'flight_warning_label' },
      } as any));
    }
  }

  private _drawProgressSegment(
    point: FlightPoint,
    values: FlightPanelValues,
    preset: FlightPreset,
    metrics: FlightPlanMetrics,
  ): void {
    if (!this._waypoints.length) return;
    const path: number[][] = [[this._waypoints[0].longitude, this._waypoints[0].latitude]];
    const timeline = clamp(values.timelineMin, 0, metrics.durationMin);
    metrics.segments.forEach((seg) => {
      if (timeline >= seg.etaEndMin) {
        path.push([seg.to.longitude, seg.to.latitude]);
        return;
      }
      if (timeline > seg.etaStartMin) {
        path.push([point.longitude, point.latitude]);
      }
    });
    if (path.length < 2) return;

    const progress = new Polyline({
      paths: [path],
      spatialReference: WGS84,
    });
    this._vehicleLayer.add(new Graphic({
      geometry: progress,
      symbol: this._progressRouteSymbol(preset),
      elevationInfo: this._flightElevationInfo(values.altitudeM + 4),
      attributes: { type: 'flight_progress_route' },
    } as any));
  }

  private _routeSymbol(preset: FlightPreset): any {
    if (this._is3D()) {
      return {
        type: 'line-3d',
        symbolLayers: [{
          type: 'line',
          size: 3.2,
          material: { color: [...preset.color, 0.95] },
          cap: 'round',
          join: 'round',
        }],
      };
    }
    return {
      type: 'simple-line',
      color: [...preset.color, 0.95],
      width: 3,
      style: 'solid',
    };
  }

  private _waypointSymbol(isLaunch: boolean, preset: FlightPreset): any {
    if (this._is3D()) {
      return {
        type: 'point-3d',
        symbolLayers: [{
          type: 'object',
          resource: { primitive: isLaunch ? 'diamond' : 'sphere' },
          material: { color: isLaunch ? [242, 204, 108, 0.98] : [...preset.color, 0.95] },
          width: isLaunch ? 54 : 40,
          height: isLaunch ? 54 : 40,
          depth: isLaunch ? 54 : 40,
        }],
      };
    }
    return {
      type: 'simple-marker',
      style: isLaunch ? 'diamond' : 'circle',
      color: isLaunch ? [242, 204, 108, 0.95] : [...preset.color, 0.92],
      outline: { color: [18, 24, 30, 0.95], width: 1.5 },
      size: isLaunch ? 13 : 10,
    };
  }

  private _vehicleSymbol(headingDeg: number, preset: FlightPreset): any {
    if (this._is3D()) {
      return {
        type: 'point-3d',
        symbolLayers: [{
          type: 'object',
          resource: { primitive: 'sphere' },
          material: { color: [...preset.color, 0.98] },
          width: 56,
          height: 56,
          depth: 56,
        }],
        verticalOffset: { screenLength: 18, maxWorldLength: 420, minWorldLength: 10 },
        callout: {
          type: 'line',
          color: [255, 255, 255, 0.7],
          size: 1.4,
          border: { color: [18, 24, 30, 0.75] },
        },
      };
    }
    return {
      type: 'simple-marker',
      style: 'triangle',
      color: [...preset.color, 0.98],
      angle: headingDeg,
      size: 18,
      outline: { color: [238, 241, 236, 0.95], width: 1.4 },
    };
  }

  private _progressRouteSymbol(preset: FlightPreset): any {
    if (this._is3D()) {
      return {
        type: 'line-3d',
        symbolLayers: [
          {
            type: 'line',
            size: 6,
            material: { color: [255, 255, 255, 0.46] },
            cap: 'round',
            join: 'round',
          },
          {
            type: 'line',
            size: 3.1,
            material: { color: [...preset.color, 1] },
            cap: 'round',
            join: 'round',
          },
        ],
      };
    }
    return {
      type: 'simple-line',
      color: [...preset.color, 1],
      width: 4.2,
      style: 'solid',
    };
  }

  private _circle(point: FlightPoint, radiusM: number): Polygon | null {
    const raw = geometryEngine.geodesicBuffer(makeSurfacePoint(point), radiusM, 'meters');
    return (Array.isArray(raw) ? raw[0] : raw) as Polygon | null;
  }

  private _sector(
    point: FlightPoint,
    headingDeg: number,
    fovDeg: number,
    rangeM: number,
  ): Polygon {
    const half = fovDeg / 2;
    const steps = Math.max(10, Math.ceil(fovDeg / 5));
    const ring: number[][] = [[point.longitude, point.latitude]];
    for (let i = 0; i <= steps; i++) {
      const bearing = headingDeg - half + (fovDeg * i) / steps;
      const p = destinationPoint(point, bearing, rangeM);
      ring.push([p.longitude, p.latitude]);
    }
    ring.push([point.longitude, point.latitude]);
    return new Polygon({
      rings: [ring],
      spatialReference: WGS84,
    });
  }

  private _showPanel(isEdit = false): void {
    if (!this._panelEl) {
      this._panelEl = document.createElement('div');
      this._panelEl.id = 'flight-engine-panel';
      this._panelEl.className = 'ms-panel ms-theme-ops-dark';
      this._panelEl.setAttribute('data-engine', 'flight');
      this._panelEl.style.top = '62px';
      this._panelEl.style.right = '12px';
      this._panelEl.style.width = '392px';
      document.body.appendChild(this._panelEl);
    }
    const preset = UAV_PRESETS[this._presetKey] ?? UAV_PRESETS.fixed_wing;
    this._panelEl.style.setProperty('--flight-accent', preset.accentHex);
    // The re-edit path repopulates from the committed plan, so the panel is
    // rebuilt rather than reused.
    this._panelEl.innerHTML = this._buildPanelHTML(isEdit);
    this._panelEl.classList.add('ms-visible');
    this._bindPanelEvents();
    this._applyPendingValues();
    this._makeDraggable();
    this._syncResultsVisible();
  }

  private _hidePanel(): void {
    this._panelEl?.classList.remove('ms-visible');
  }

  /**
   * Collapse the body and keep the header. This was byte-identical to
   * _hidePanel, so the minimize button made the whole panel vanish exactly
   * like Close, with no way back short of reopening the tool.
   */
  private _minimizePanel(): void {
    const body = this._panelEl?.querySelector<HTMLElement>('.ms-body');
    const btn = this._el('flight-min-btn');
    if (!body || !btn) return;
    const minimized = body.classList.toggle('ms-minimized');
    btn.textContent = minimized ? '\u25B6' : '\u25BC';
    btn.title = minimized ? 'Restore' : 'Minimize';
  }

  private _buildPanelHTML(isEdit: boolean): string {
    const preset = UAV_PRESETS[this._presetKey] ?? UAV_PRESETS.fixed_wing;
    const presetOptions = Object.entries(UAV_PRESETS)
      .map(([key, p]) => `<option value="${key}" ${key === this._presetKey ? 'selected' : ''}>${p.label}</option>`)
      .join('');

    return `
      <div class="ms-header" id="flight-drag-handle">
        <span class="ms-header-icon">UAV</span>
        <span class="ms-header-title">Flight Analysis${isEdit ? ' — Re-edit' : ''}</span>
        <span class="ms-status-dot" id="flight-status-dot"></span>
        <span class="ms-status-lbl" id="flight-status-lbl">${isEdit ? 'Restored' : 'Awaiting'}</span>
        <button class="ms-header-btn ms-btn-round" id="flight-help-btn" title="How flight analysis works">?</button>
        <button class="ms-header-btn ms-btn-round" id="flight-min-btn" title="Minimize">▼</button>
        <button class="ms-header-btn ms-btn-round" id="flight-close-btn" title="Close and clear working graphics">✕</button>
      </div>

      <div class="ms-help-popover" id="flight-help-popover" hidden>
        <div class="ms-help-head">
          <div>
            <div class="ms-help-kicker">Field Guide</div>
            <div class="ms-help-title">UAV Flight Analysis</div>
          </div>
          <button class="ms-help-close" id="flight-help-close" title="Close">✕</button>
        </div>
        <div class="ms-help-body">
          <div class="ms-help-answers">
            <div class="ms-help-answers-kicker">Answers</div>
            <div class="ms-help-answers-q">Can this UAV fly the route, and what will it see?</div>
          </div>
          <p>Plans a UAV mission from a launch or current position. The engine models the UAV route, computes leg distance and ETA, projects sensor coverage along the path, and visualises altitude-above-ground (AGL) and weapon envelope where relevant.</p>
          <div class="ms-help-block">
            <h4>What it analyses</h4>
            <ol>
              <li><b>Route geometry</b> — waypoints, leg lengths, turn points, total track distance, and return reserve from the active endurance budget.</li>
              <li><b>AGL altitude</b> — flight altitude above mean sea level is checked against terrain along the route; segments below the configured AGL clearance are flagged as risk.</li>
              <li><b>Sensor footprint</b> — for each waypoint and the interpolated path, a swath polygon is built from sensor range and FOV (and gimbal heading) to show what the payload sees.</li>
              <li><b>Weapon envelope</b> (if armed) — uses weapon range to overlay the engagement reach forward of the platform.</li>
            </ol>
          </div>
          <div class="ms-help-block">
            <h4>Setting waypoints</h4>
            <ol>
              <li>Choose a platform preset, or tune speed, altitude, endurance and payload under Advanced.</li>
              <li>Press <strong>Add waypoint</strong> and click the map — each waypoint extends the leg and re-runs distance, ETA and coverage.</li>
              <li>Scrub or animate the timeline to preview platform position, sensor cone and coverage at any time-of-mission.</li>
              <li>Commit the plan when the route is ready to persist as a map overlay.</li>
            </ol>
          </div>
          <div class="ms-help-block">
            <h4>How parameters change the analysis</h4>
            <ol>
              <li><b>Speed &amp; endurance</b> control reachable range and ETA per leg — the return-reserve metric warns when the route exceeds the safe round-trip budget.</li>
              <li><b>Altitude (AGL)</b> changes terrain clearance checks and the projected sensor footprint size — lower AGL = tighter swath, higher AGL = broader but lower-resolution coverage.</li>
              <li><b>Sensor range &amp; FOV</b> directly scale the coverage polygon — narrow FOV / long range produces a slim corridor; wide FOV / short range produces a broad fan.</li>
              <li><b>Armed + weapon range</b> draws the engagement envelope and is included in the risk/reach summary.</li>
            </ol>
          </div>
        </div>
      </div>

      <div class="ms-body">
        <!-- Default view: pick a platform, lay down waypoints, commit. The
             performance numbers, display toggles and the timeline all live in
             the collapsed disclosures below. -->
        <div class="ms-status" id="flight-status">Plan route, sensor coverage, endurance, and timing.</div>

        <div class="ms-section-title">Platform</div>
        <div class="ms-grid full">
          <div class="ms-field">
            <label class="ms-label" for="flight-preset">UAV type</label>
            <select id="flight-preset" class="ms-select">${presetOptions}</select>
          </div>
        </div>
        <div class="flight-role" id="flight-role">${preset.role}</div>

        <div class="ms-section-title">Route</div>
        <div class="ms-btn-row">
          <button class="ms-btn primary" id="flight-add-wp-btn" title="Click, then click the map to append a waypoint">📍 Add waypoint</button>
        </div>

        <div class="ms-btn-row">
          <button class="ms-btn ms-cta" id="flight-commit-btn">Commit ↗</button>
        </div>

        <div id="flight-results" hidden>
          <div class="flight-metrics">
            <div>
              <span>Route</span>
              <strong id="flight-metric-route">0 km</strong>
            </div>
            <div>
              <span>ETA</span>
              <strong id="flight-metric-eta">0 min</strong>
            </div>
            <div>
              <span>RTB</span>
              <strong id="flight-metric-reserve">0 min</strong>
            </div>
            <div>
              <span>WP</span>
              <strong id="flight-metric-wp">0</strong>
            </div>
          </div>
          <div class="ms-btn-row">
            <button class="ms-btn" id="flight-animate-btn">Animate ▶</button>
            <button class="ms-btn" id="flight-stop-btn">Stop</button>
            <button class="ms-btn danger" id="flight-clear-btn">Clear route</button>
          </div>
          <div class="ms-slider-row">
            <div class="ms-slider-label">Mission time</div>
            <input id="flight-timeline" type="range" min="0" max="1" step="0.1" value="0">
            <div class="ms-slider-value" id="flight-timeline-readout">T+0 min</div>
          </div>
        </div>

        <div class="ms-disclosure" data-open="false">
          <button class="ms-disclosure-head" type="button" id="flight-adv-toggle" aria-expanded="false" aria-controls="flight-adv-body">
            <span class="ms-disclosure-chevron" aria-hidden="true">▶</span>
            <span class="ms-disclosure-title">Advanced</span>
            <span class="ms-disclosure-meta">Performance, payload, display</span>
          </button>
          <div class="ms-disclosure-body" id="flight-adv-body" hidden>
            <div class="ms-section-title">Mission performance</div>
            <div class="ms-grid">
              <div class="ms-field"><label class="ms-label" for="flight-speed">Speed km/h</label><input id="flight-speed" class="ms-input" type="number" min="1" max="800" step="5" value="${preset.speedKmh}"></div>
              <div class="ms-field"><label class="ms-label" for="flight-endurance">Endurance min</label><input id="flight-endurance" class="ms-input" type="number" min="1" max="2400" step="5" value="${preset.enduranceMin}"></div>
              <div class="ms-field"><label class="ms-label" for="flight-altitude">Altitude m</label><input id="flight-altitude" class="ms-input" type="number" min="0" max="20000" step="50" value="${preset.altitudeM}"></div>
              <div class="ms-field"><label class="ms-label" for="flight-sensor-range">Sensor range m</label><input id="flight-sensor-range" class="ms-input" type="number" min="0" max="50000" step="100" value="${preset.sensorRangeM}"></div>
              <div class="ms-field"><label class="ms-label" for="flight-sensor-fov">Sensor FOV deg</label><input id="flight-sensor-fov" class="ms-input" type="number" min="5" max="360" step="5" value="${preset.sensorFovDeg}"></div>
              <div class="ms-field"><label class="ms-label" for="flight-weapon-range">Weapon range m</label><input id="flight-weapon-range" class="ms-input" type="number" min="0" max="80000" step="100" value="${preset.weaponRangeM}"></div>
            </div>

            <div class="ms-section-title">Display options</div>
            <div class="ms-toggle-row">
              <label for="flight-armed">Armed</label>
              <input id="flight-armed" type="checkbox" class="ms-input" ${preset.armed ? 'checked' : ''}>
            </div>
            <div class="ms-toggle-row">
              <label for="flight-show-coverage">Sensor footprint</label>
              <input id="flight-show-coverage" type="checkbox" class="ms-input" checked>
            </div>
            <div class="ms-toggle-row">
              <label for="flight-show-weapon">Weapon envelope</label>
              <input id="flight-show-weapon" type="checkbox" class="ms-input" ${preset.armed ? 'checked' : ''}>
            </div>
            <div class="ms-toggle-row">
              <label for="flight-show-endurance">Endurance boundary</label>
              <input id="flight-show-endurance" type="checkbox" class="ms-input" checked>
            </div>
            <div class="ms-toggle-row">
              <label for="flight-show-trail">Coverage trail</label>
              <input id="flight-show-trail" type="checkbox" class="ms-input" checked>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private _bindPanelEvents(): void {
    const ids = [
      'flight-speed',
      'flight-endurance',
      'flight-altitude',
      'flight-sensor-range',
      'flight-sensor-fov',
      'flight-weapon-range',
      'flight-armed',
      'flight-show-coverage',
      'flight-show-weapon',
      'flight-show-endurance',
      'flight-show-trail',
      'flight-timeline',
    ];
    ids.forEach((id) => this._el(id)?.addEventListener('input', () => this._redraw()));

    this._el('flight-preset')?.addEventListener('change', () => {
      const key = this._selectValue('flight-preset', this._presetKey);
      this._presetKey = key;
      const preset = UAV_PRESETS[key] ?? UAV_PRESETS.fixed_wing;
      this._setVal('flight-speed', preset.speedKmh);
      this._setVal('flight-endurance', preset.enduranceMin);
      this._setVal('flight-altitude', preset.altitudeM);
      this._setVal('flight-sensor-range', preset.sensorRangeM);
      this._setVal('flight-sensor-fov', preset.sensorFovDeg);
      this._setVal('flight-weapon-range', preset.weaponRangeM);
      this._setChecked('flight-armed', preset.armed);
      this._setChecked('flight-show-weapon', preset.armed);
      this._panelEl?.style.setProperty('--flight-accent', preset.accentHex);
      const role = this._el('flight-role');
      if (role) role.textContent = preset.role;
      this._redraw();
    });

    this._el('flight-add-wp-btn')?.addEventListener('click', () => this._startPick());
    bindDisclosures(this._panelEl);
    this._el('flight-clear-btn')?.addEventListener('click', () => {
      this._waypoints = this._waypoints.slice(0, 1);
      this._stopAnimation();
      this._redraw();
      this._syncResultsVisible();
    });
    this._el('flight-animate-btn')?.addEventListener('click', () => this._startAnimation());
    this._el('flight-stop-btn')?.addEventListener('click', () => this._stopAnimation());
    this._el('flight-commit-btn')?.addEventListener('click', () => this._commit());
    this._el('flight-min-btn')?.addEventListener('click', () => this._minimizePanel());
    this._el('flight-close-btn')?.addEventListener('click', () => this.close());
    this._el('flight-help-btn')?.addEventListener('click', (event) => {
      event.stopPropagation();
      const help = this._el('flight-help-popover') as HTMLElement | null;
      if (help) help.hidden = !help.hidden;
    });
    this._el('flight-help-close')?.addEventListener('click', () => {
      const help = this._el('flight-help-popover') as HTMLElement | null;
      if (help) help.hidden = true;
    });
  }

  /** Pulse the waypoint button while the engine is waiting on a map click. */
  private _setPickArmed(armed: boolean): void {
    this._el('flight-add-wp-btn')?.classList.toggle('ms-armed', armed);
  }

  /**
   * The metrics, playback controls and timeline only mean something once a
   * route exists; a single launch waypoint is not yet a route.
   */
  private _syncResultsVisible(): void {
    const el = this._el('flight-results');
    if (el) el.hidden = this._waypoints.length < 2;
  }

  private _startPick(): void {
    if (!this._view) return;
    this._cancelPick();
    this._setPickArmed(true);
    this._setStatus('Click the map to append the next waypoint.', 'pick');
    this._pickHandle = this._view.on('click', (event: any) => {
      event.stopPropagation?.();
      const point = event.mapPoint as Point;
      if (point) {
        const values = this._values();
        this._waypoints.push(readPoint(point, values.altitudeM));
        this._cancelPick();
        this._redraw();
      }
    });
  }

  private _cancelPick(): void {
    this._pickHandle?.remove?.();
    this._pickHandle = null;
    this._setPickArmed(false);
  }

  private _startAnimation(): void {
    if (this._waypoints.length < 2) {
      this._setStatus('Add at least 2 waypoints to start animation.', 'warn');
      return;
    }
    const metrics = this._computeMetrics(this._values());
    if (!metrics.durationMin) return;
    this._stopAnimation();
    this._setVal('flight-timeline', 0);
    this._redraw();
    this._captureAnimGraphics();
    this._animationStartedAt = performance.now();
    this._animationDurationMs = clamp(metrics.durationMin * 300, 7000, 25000);

    const tick = () => {
      const elapsed = performance.now() - this._animationStartedAt;
      const fraction = clamp(elapsed / this._animationDurationMs, 0, 1);
      const tickValues = this._values();
      const tickMetrics = this._computeMetrics(tickValues);
      const timelineMin = tickMetrics.durationMin * fraction;
      const current = this._positionAt(timelineMin, tickMetrics);
      if (current) {
        this._updateAnimFrame(current.point, current.bearingDeg, tickValues, tickMetrics);
      }
      this._setVal('flight-timeline', timelineMin);
      this._syncPanel(tickMetrics, tickValues);
      if (fraction < 1) {
        this._animationId = requestAnimationFrame(tick);
      } else {
        this._animationId = null;
      }
    };
    this._animationId = requestAnimationFrame(tick);
  }

  private _captureAnimGraphics(): void {
    this._releaseAnimGraphics();
    const byType = (layer: GraphicsLayer, type: string) => {
      const arr = layer.graphics.filter((g: Graphic) => g.attributes?.type === type).toArray();
      return arr.length > 0 ? arr[0] : null;
    };
    this._animVehicleGraphic = byType(this._vehicleLayer, 'flight_uav_position');
    this._animLabelGraphic = byType(this._vehicleLayer, 'flight_uav_label');
    this._animWarningGraphic = byType(this._vehicleLayer, 'flight_warning_label');
    this._animProgressGraphic = byType(this._vehicleLayer, 'flight_progress_route');
    this._animTetherGraphic = byType(this._vehicleLayer, 'flight_altitude_tether');
    this._animSensorGraphic = byType(this._coverageLayer, 'flight_sensor_footprint');
    this._animWeaponGraphic = byType(this._coverageLayer, 'flight_weapon_envelope');
  }

  private _releaseAnimGraphics(): void {
    this._animVehicleGraphic = null;
    this._animLabelGraphic = null;
    this._animWarningGraphic = null;
    this._animProgressGraphic = null;
    this._animTetherGraphic = null;
    this._animSensorGraphic = null;
    this._animWeaponGraphic = null;
  }

  private _updateAnimFrame(
    point: FlightPoint,
    bearingDeg: number,
    values: FlightPanelValues,
    metrics: FlightPlanMetrics,
  ): void {
    const preset = UAV_PRESETS[values.presetKey] ?? UAV_PRESETS.fixed_wing;
    const remaining = Math.max(0, values.enduranceMin - values.timelineMin);
    const vehicleGeom = this._is3D()
      ? makeSurfacePoint(point)
      : makePoint(point, point.altitudeM ?? values.altitudeM);

    const pointGeom = (altOffset = 0) =>
      this._is3D()
        ? makeSurfacePoint(point)
        : makePoint(point, (point.altitudeM ?? values.altitudeM) + altOffset);

    const elevInfo = (altOffset = 0) =>
      this._flightElevationInfo((point.altitudeM ?? values.altitudeM) + altOffset);

    if (this._animVehicleGraphic) {
      this._animVehicleGraphic.geometry = vehicleGeom;
      (this._animVehicleGraphic as any).symbol = this._vehicleSymbol(bearingDeg, preset);
    }

    if (this._animLabelGraphic) {
      this._animLabelGraphic.geometry = vehicleGeom;
      (this._animLabelGraphic as any).symbol = this._textSymbol(
        `UAV T+${formatMinutes(values.timelineMin)}  ${Math.round(values.altitudeM)}m AGL  ${formatMinutes(remaining)} fuel`,
        '#F1F4EA',
        -24,
      );
    }

    const showWarning = metrics.remainingMin < 0;
    if (showWarning && !this._animWarningGraphic) {
      this._animWarningGraphic = new Graphic({
        geometry: pointGeom(),
        symbol: this._textSymbol('ENDURANCE RISK', '#F2A45F', -44),
        elevationInfo: elevInfo(30),
        attributes: { type: 'flight_warning_label' },
      } as any);
      this._vehicleLayer.add(this._animWarningGraphic);
    } else if (showWarning && this._animWarningGraphic) {
      this._animWarningGraphic.geometry = vehicleGeom;
    } else if (!showWarning && this._animWarningGraphic) {
      this._vehicleLayer.remove(this._animWarningGraphic);
      this._animWarningGraphic = null;
    }

    const progressPath = this._computeProgressPath(point, values, metrics);
    if (progressPath && this._animProgressGraphic) {
      this._animProgressGraphic.geometry = progressPath;
    } else if (progressPath && !this._animProgressGraphic) {
      this._animProgressGraphic = new Graphic({
        geometry: progressPath,
        symbol: this._progressRouteSymbol(preset),
        elevationInfo: elevInfo(values.altitudeM + 4),
        attributes: { type: 'flight_progress_route' },
      } as any);
      this._vehicleLayer.add(this._animProgressGraphic);
    } else if (!progressPath && this._animProgressGraphic) {
      this._vehicleLayer.remove(this._animProgressGraphic);
      this._animProgressGraphic = null;
    }

    if (this._is3D()) {
      const tetherPath = new Polyline({
        paths: [[
          [point.longitude, point.latitude, 0],
          [point.longitude, point.latitude, values.altitudeM],
        ]],
        spatialReference: WGS84,
      });
      if (this._animTetherGraphic) {
        this._animTetherGraphic.geometry = tetherPath;
      } else {
        this._animTetherGraphic = new Graphic({
          geometry: tetherPath,
          symbol: {
            type: 'line-3d',
            symbolLayers: [{
              type: 'line', size: 1.4,
              material: { color: [...preset.color, 0.55] },
              pattern: { type: 'style', style: 'dash' },
              cap: 'round',
            }],
          } as any,
          attributes: { type: 'flight_altitude_tether' },
        } as any);
        this._vehicleLayer.add(this._animTetherGraphic);
      }
    } else if (this._animTetherGraphic) {
      this._vehicleLayer.remove(this._animTetherGraphic);
      this._animTetherGraphic = null;
    }

    if (values.showCoverage && values.sensorRangeM > 0) {
      const sensorGeom = values.sensorFovDeg >= 355
        ? this._circle(point, values.sensorRangeM)
        : this._sector(point, bearingDeg, values.sensorFovDeg, values.sensorRangeM);
      if (sensorGeom) {
        if (this._animSensorGraphic) {
          this._animSensorGraphic.geometry = sensorGeom;
        } else {
          this._animSensorGraphic = new Graphic({
            geometry: sensorGeom,
            symbol: {
              type: 'simple-fill',
              color: [...preset.color, 0.18],
              outline: { color: [...preset.color, 0.85], width: 1.7 },
            } as any,
            attributes: { type: 'flight_sensor_footprint' },
          });
          this._coverageLayer.add(this._animSensorGraphic);
        }
      }
    } else if (this._animSensorGraphic) {
      this._coverageLayer.remove(this._animSensorGraphic);
      this._animSensorGraphic = null;
    }

    if (values.armed && values.showWeapon && values.weaponRangeM > 0) {
      const weaponGeom = this._circle(point, values.weaponRangeM);
      if (weaponGeom) {
        if (this._animWeaponGraphic) {
          this._animWeaponGraphic.geometry = weaponGeom;
        } else {
          this._animWeaponGraphic = new Graphic({
            geometry: weaponGeom,
            symbol: {
              type: 'simple-fill',
              color: [192, 72, 64, 0.10],
              outline: { color: [192, 72, 64, 0.84], width: 1.8, style: 'dash' },
            } as any,
            attributes: { type: 'flight_weapon_envelope' },
          });
          this._coverageLayer.add(this._animWeaponGraphic);
        }
      }
    } else if (this._animWeaponGraphic) {
      this._coverageLayer.remove(this._animWeaponGraphic);
      this._animWeaponGraphic = null;
    }
  }

  private _computeProgressPath(
    point: FlightPoint,
    values: FlightPanelValues,
    metrics: FlightPlanMetrics,
  ): Polyline | null {
    if (!this._waypoints.length) return null;
    const path: number[][] = [[this._waypoints[0].longitude, this._waypoints[0].latitude]];
    const timeline = clamp(values.timelineMin, 0, metrics.durationMin);
    metrics.segments.forEach((seg) => {
      if (timeline >= seg.etaEndMin) {
        path.push([seg.to.longitude, seg.to.latitude]);
        return;
      }
      if (timeline > seg.etaStartMin) {
        path.push([point.longitude, point.latitude]);
      }
    });
    if (path.length < 2) return null;
    return new Polyline({ paths: [path], spatialReference: WGS84 });
  }

  private _stopAnimation(): void {
    if (this._animationId != null) {
      cancelAnimationFrame(this._animationId);
      this._animationId = null;
    }
    this._releaseAnimGraphics();
  }

  private _commit(): void {
    if (!this._waypoints.length) return;
    const values = this._values();
    const metrics = this._computeMetrics(values);
    const planJson = JSON.stringify({ waypoints: this._waypoints, values });
    const committedAt = Date.now();

    [
      ...this._coverageLayer.graphics.toArray(),
      ...this._routeLayer.graphics.toArray(),
      ...this._vehicleLayer.graphics.toArray(),
    ].forEach((g) => {
      this._committedLayer.add(new Graphic({
        geometry: g.geometry?.clone?.() ?? g.geometry,
        symbol: (g.symbol as any)?.clone?.() ?? g.symbol,
        attributes: {
          ...(g.attributes ?? {}),
          type: 'flight_plan',
          committedAt,
          flightPlanJson: planJson,
          routeDistanceM: metrics.distanceM,
          durationMin: metrics.durationMin,
          totalWithReturnMin: metrics.totalWithReturnMin,
          remainingMin: metrics.remainingMin,
        },
        popupTemplate: {
          title: 'UAV Flight Plan',
          content: `Route ${formatDistance(metrics.distanceM)}<br>Mission ETA ${formatMinutes(metrics.durationMin)}<br>RTB reserve ${formatMinutes(metrics.remainingMin)}`,
        } as any,
      }));
    });

    this._setStatus('Flight plan committed to the map.', 'ok');
  }

  private _loadCommittedPlan(json: string): void {
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed.waypoints)) {
        this._waypoints = parsed.waypoints;
      }
      if (parsed.values?.presetKey && UAV_PRESETS[parsed.values.presetKey]) {
        this._presetKey = parsed.values.presetKey;
      }
      this._pendingValues = parsed.values ?? null;
    } catch {
      this._setStatus('Could not load committed flight plan.', 'warn');
    }
  }

  private _applyPendingValues(): void {
    if (!this._pendingValues) return;
    const values = this._pendingValues;
    if (values.presetKey && UAV_PRESETS[values.presetKey]) {
      const presetSelect = this._el('flight-preset') as HTMLSelectElement | null;
      if (presetSelect) presetSelect.value = values.presetKey;
    }
    if (values.speedKmh != null) this._setVal('flight-speed', values.speedKmh);
    if (values.enduranceMin != null) this._setVal('flight-endurance', values.enduranceMin);
    if (values.altitudeM != null) this._setVal('flight-altitude', values.altitudeM);
    if (values.sensorRangeM != null) this._setVal('flight-sensor-range', values.sensorRangeM);
    if (values.sensorFovDeg != null) this._setVal('flight-sensor-fov', values.sensorFovDeg);
    if (values.weaponRangeM != null) this._setVal('flight-weapon-range', values.weaponRangeM);
    if (values.armed != null) this._setChecked('flight-armed', values.armed);
    if (values.showCoverage != null) this._setChecked('flight-show-coverage', values.showCoverage);
    if (values.showWeapon != null) this._setChecked('flight-show-weapon', values.showWeapon);
    if (values.showEndurance != null) this._setChecked('flight-show-endurance', values.showEndurance);
    if (values.showTrail != null) this._setChecked('flight-show-trail', values.showTrail);
    if (values.timelineMin != null) this._setVal('flight-timeline', values.timelineMin);
    this._pendingValues = null;
  }

  private _syncPanel(metrics: FlightPlanMetrics, values: FlightPanelValues): void {
    this._syncResultsVisible();
    const timeline = this._el('flight-timeline') as HTMLInputElement | null;
    if (timeline) {
      timeline.max = String(Math.max(1, metrics.durationMin));
      timeline.value = String(clamp(values.timelineMin, 0, Math.max(1, metrics.durationMin)));
    }
    const readout = this._el('flight-timeline-readout');
    if (readout) readout.textContent = `T+${formatMinutes(values.timelineMin)}`;
    const route = this._el('flight-metric-route');
    if (route) route.textContent = formatDistance(metrics.distanceM);
    const eta = this._el('flight-metric-eta');
    if (eta) eta.textContent = formatMinutes(metrics.durationMin);
    const reserve = this._el('flight-metric-reserve');
    if (reserve) {
      reserve.textContent = formatMinutes(metrics.remainingMin);
      reserve.className = metrics.remainingMin < 0 ? 'flight-risk' : 'flight-ok';
    }
    const wp = this._el('flight-metric-wp');
    if (wp) wp.textContent = String(this._waypoints.length);

    if (this._waypoints.length > 1) {
      const status =
        metrics.remainingMin < 0
          ? `Endurance exceeded by ${formatMinutes(Math.abs(metrics.remainingMin))}. Reduce route or use a longer-endurance UAV.`
          : `Feasible with ${formatMinutes(metrics.remainingMin)} reserve after return-to-base.`;
      this._setStatus(status, metrics.remainingMin < 0 ? 'warn' : 'ok');
    }
  }

  private _makeDraggable(): void {
    if (!this._panelEl) return;
    const header = this._panelEl.querySelector('#flight-drag-handle') as HTMLElement | null;
    if (!header) return;
    header.onmousedown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      this._isDragging = true;
      const rect = this._panelEl!.getBoundingClientRect();
      this._dragOffsetX = e.clientX - rect.left;
      this._dragOffsetY = e.clientY - rect.top;
      document.addEventListener('mousemove', this._onDragMove);
      document.addEventListener('mouseup', this._onDragEnd);
    };
  }

  private _onDragMove = (e: MouseEvent): void => {
    if (!this._isDragging || !this._panelEl) return;
    this._panelEl.style.left = `${clamp(e.clientX - this._dragOffsetX, 8, window.innerWidth - 396)}px`;
    this._panelEl.style.top = `${clamp(e.clientY - this._dragOffsetY, 8, window.innerHeight - 120)}px`;
    this._panelEl.style.right = 'auto';
  };

  private _onDragEnd = (): void => {
    this._isDragging = false;
    document.removeEventListener('mousemove', this._onDragMove);
    document.removeEventListener('mouseup', this._onDragEnd);
  };

  private _textSymbol(text: string, color: string, yoffset: number): any {
    return {
      type: 'text',
      text,
      color,
      haloColor: [18, 24, 30, 0.95],
      haloSize: 1.4,
      font: { size: 10, family: 'Aptos, Segoe UI, sans-serif', weight: 'bold' },
      yoffset,
    };
  }

  private _setStatus(message: string, tone: 'ok' | 'warn' | 'pick' = 'ok'): void {
    const el = this._el('flight-status');
    if (tone === 'ok') EngineLogger.success(ENGINE_NAME, message);
    else if (tone === 'warn') EngineLogger.error(ENGINE_NAME, message);
    else EngineLogger.nextStep(ENGINE_NAME, message);
    if (el) {
      el.textContent = message;
      // .ms-status ships running / warning / success variants.
      const cls = tone === 'ok' ? 'success' : tone === 'warn' ? 'warning' : 'running';
      el.className = `ms-status ${cls}`;
    }
    const dotEl = this._el('flight-status-dot');
    const lblEl = this._el('flight-status-lbl');
    if (!dotEl || !lblEl) return;
    const map: Record<string, [string, string]> = {
      ok: ['#1D9E75', 'Ready'],
      warn: ['#E24B4A', 'Risk'],
      pick: ['#378ADD', 'Click map'],
    };
    const [color, label] = map[tone] ?? map.ok;
    dotEl.style.background = color;
    dotEl.style.boxShadow = `0 0 6px ${color}88`;
    lblEl.textContent = label;
  }

  private _el(id: string): HTMLElement | null {
    return this._panelEl?.querySelector(`#${id}`) ?? null;
  }

  private _num(id: string, fallback: number): number {
    const el = this._el(id) as HTMLInputElement | null;
    const value = el ? Number(el.value) : fallback;
    return Number.isFinite(value) ? value : fallback;
  }

  private _checked(id: string, fallback: boolean): boolean {
    const el = this._el(id) as HTMLInputElement | null;
    return el ? el.checked : fallback;
  }

  private _selectValue(id: string, fallback: string): string {
    const el = this._el(id) as HTMLSelectElement | null;
    return el?.value || fallback;
  }

  private _setVal(id: string, value: number): void {
    const el = this._el(id) as HTMLInputElement | null;
    if (el) el.value = String(value);
  }

  private _setChecked(id: string, checked: boolean): void {
    const el = this._el(id) as HTMLInputElement | null;
    if (el) el.checked = checked;
  }

}

export default FlightEngine;

