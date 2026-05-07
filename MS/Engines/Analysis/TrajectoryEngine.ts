/**
 * TrajectoryEngine.ts
 * Ballistic projectile trajectory analysis engine.
 *
 * Integrated with ContextMenuManager via linkTrajectoryEngine().
 * Right-clicking any military symbol → Analysis → Projectile Trajectory
 * opens this panel with the symbol's location as the firing point.
 *
 * Uses three private GraphicsLayers:
 *   trajectory-analysis   — live working layer (cleared on every redraw)
 *   trajectory-observer   — fire/target markers
 *   trajectory-committed  — persisted results after "Commit"
 */

import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polygon from '@arcgis/core/geometry/Polygon';
import Polyline from '@arcgis/core/geometry/Polyline';
import * as geometryEngine from '@arcgis/core/geometry/geometryEngine';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProjectilePreset {
  label: string;
  massKg: number;
  diamM: number;
  Cd: number;
  muzzleVelocity: number;
  optimalAngle: number;
  maxAngle: number;
  cepM: number;
  color: [number, number, number];
  accentHex: string;
  icon: string;
}

interface TrajectoryPoint {
  east: number;
  north: number;
  up: number;
  t: number;
  altMSL: number;
  vU: number;
}

interface TrajectoryResult {
  pts: TrajectoryPoint[];
  apogeeIdx: number;
  termIdx: number;
  impact: { lon: number; lat: number; z: number } | null;
  tof: number;
  maxAlt: number;
  range: number;
}

interface TrajectoryPanelOverride {
  launchAngle?: number;
  muzzleVel?: number;
  azimuth?: number;
  obsHeight?: number;
  windSpeed?: number;
  windBearing?: number;
  usePhases?: boolean;
  showCEP?: boolean;
  useCoriolis?: boolean;
}

// ─── Projectile Presets ───────────────────────────────────────────────────────

export const PROJECTILE_PRESETS: Record<string, ProjectilePreset> = {
  mortar_60mm: {
    label: 'Mortar 60 mm',
    massKg: 1.33,
    diamM: 0.060,
    Cd: 0.295,
    muzzleVelocity: 250,
    optimalAngle: 45,
    maxAngle: 85,
    cepM: 30,
    color: [186, 117, 23],
    accentHex: '#BA7517',
    icon: '💣',
  },
  mortar_81mm: {
    label: 'Mortar 81 mm',
    massKg: 4.1,
    diamM: 0.081,
    Cd: 0.285,
    muzzleVelocity: 293,
    optimalAngle: 45,
    maxAngle: 85,
    cepM: 35,
    color: [186, 117, 23],
    accentHex: '#BA7517',
    icon: '💣',
  },
  mortar_120mm: {
    label: 'Mortar 120 mm',
    massKg: 13.3,
    diamM: 0.120,
    Cd: 0.28,
    muzzleVelocity: 320,
    optimalAngle: 45,
    maxAngle: 85,
    cepM: 40,
    color: [186, 117, 23],
    accentHex: '#BA7517',
    icon: '💣',
  },
  artillery_105: {
    label: 'Artillery 105 mm',
    massKg: 15.0,
    diamM: 0.105,
    Cd: 0.30,
    muzzleVelocity: 472,
    optimalAngle: 35,
    maxAngle: 65,
    cepM: 50,
    color: [220, 90, 48],
    accentHex: '#dc5a30',
    icon: '🔺',
  },
  artillery_155: {
    label: 'Artillery 155 mm',
    massKg: 43.5,
    diamM: 0.155,
    Cd: 0.28,
    muzzleVelocity: 827,
    optimalAngle: 30,
    maxAngle: 65,
    cepM: 70,
    color: [220, 90, 48],
    accentHex: '#dc5a30',
    icon: '🔺',
  },
  atgm: {
    label: 'ATGM',
    massKg: 11.5,
    diamM: 0.115,
    Cd: 0.42,
    muzzleVelocity: 185,
    optimalAngle: 5,
    maxAngle: 20,
    cepM: 1,
    color: [55, 138, 221],
    accentHex: '#378ADD',
    icon: '🚀',
  },
  rpg7: {
    label: 'RPG-7',
    massKg: 2.25,
    diamM: 0.085,
    Cd: 0.50,
    muzzleVelocity: 115,
    optimalAngle: 0,
    maxAngle: 12,
    cepM: 12,
    color: [220, 90, 48],
    accentHex: '#dc5a30',
    icon: '🚀',
  },
  drone_loiter: {
    label: 'Loitering munition',
    massKg: 5.5,
    diamM: 0.12,
    Cd: 0.80,
    muzzleVelocity: 50,
    optimalAngle: 5,
    maxAngle: 15,
    cepM: 3,
    color: [55, 138, 221],
    accentHex: '#378ADD',
    icon: '🛩️',
  },
};

// ─── Physical Constants ───────────────────────────────────────────────────────

const G = 9.80665;
const RHO_SL = 1.225;
const EARTH_OMEGA = 7.2921e-5;

// ─── Engine ───────────────────────────────────────────────────────────────────

export class TrajectoryEngine {

  static readonly ANALYSIS_LAYER_ID  = 'trajectory-analysis';
  static readonly OBSERVER_LAYER_ID  = 'trajectory-observer';
  static readonly COMMITTED_LAYER_ID = 'trajectory-committed';

  private _view: MapView | SceneView | null = null;
  private _analysisLayer!: GraphicsLayer;
  private _observerLayer!: GraphicsLayer;
  private _committedLayer!: GraphicsLayer;

  private _firePoint: Point | null = null;
  private _targetPoint: Point | null = null;
  private _panelEl: HTMLDivElement | null = null;
  private _clickHandle: any = null;
  private _placeMode: 'fire' | 'target' = 'fire';
  private _currentTrajectory: TrajectoryResult | null = null;

  // Animation state
  private _animFrame: number | null = null;
  private _animRunning = false;
  private _animGraphic: Graphic | null = null;

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
      map.addMany([this._committedLayer, this._analysisLayer, this._observerLayer]);
    }
  }

  /** Called by ContextMenuManager when "Projectile Trajectory" is clicked. */
  open(graphic: Graphic, view: MapView | SceneView): void {
    this.initialize(view);
    const attrs = graphic.attributes ?? {};

    // ── Re-edit mode: graphic is a previously committed trajectory ────────────
    if (attrs.type === 'trajectory_arc' && attrs.committedAt != null) {
      this._analysisLayer.removeAll();
      this._observerLayer.removeAll();

      if (attrs.fireLon != null && attrs.fireLat != null) {
        this._firePoint = new Point({
          longitude: attrs.fireLon,
          latitude: attrs.fireLat,
          z: attrs.fireZ ?? 0,
          spatialReference: { wkid: 4326 },
        });
      }

      const override: TrajectoryPanelOverride = {
        launchAngle:  attrs.launchAngle  ?? undefined,
        muzzleVel:    attrs.muzzleVel    ?? undefined,
        azimuth:      attrs.azimuth      ?? undefined,
        windSpeed:    attrs.windSpeed    ?? undefined,
        windBearing:  attrs.windBearing  ?? undefined,
        usePhases:    attrs.usePhases    ?? undefined,
        showCEP:      attrs.showCEP      ?? undefined,
        useCoriolis:  attrs.useCoriolis  ?? undefined,
      };
      const presetKey: string = attrs.presetKey ?? 'mortar_81mm';

      this._showPanel(presetKey, override);
      if (this._firePoint) {
        this._drawFireMarker();
        this._redraw();
      }
      return;
    }

    // ── Resume mode: panel was minimised (hidden) with working state intact ───
    if (this._panelEl && this._firePoint && this._panelEl.style.display === 'none') {
      this._panelEl.style.display = 'block';
      return;
    }

    // ── Normal mode: new fire point from graphic geometry ─────────────────────
    const geom = graphic.geometry;
    if (geom?.type === 'point') {
      this._firePoint = geom as Point;
    } else if ((geom as any)?.centroid) {
      this._firePoint = (geom as any).centroid as Point;
    } else {
      this._firePoint = null;
    }

    this._targetPoint = null;
    this._placeMode = 'fire';
    const detectedPreset = this._detectPresetType(graphic);
    this._showPanel(detectedPreset);

    if (this._firePoint) {
      this._drawFireMarker();
      this._setStatus('placing');
      this._startTargetPlacement();
    } else {
      this._setStatus('awaiting');
      this._startFirePlacement();
    }
  }

  close(): void {
    this._hidePanel();
    this._analysisLayer.removeAll();
    this._observerLayer.removeAll();
    this._cancelPlacement();
    this._stopAnimation();
    this._firePoint = null;
    this._targetPoint = null;
    this._currentTrajectory = null;
  }

  destroy(): void {
    this.close();
    const map = this._view?.map as any;
    if (map) {
      map.remove(this._analysisLayer);
      map.remove(this._committedLayer);
      map.remove(this._observerLayer);
    }
    this._panelEl?.remove();
    this._panelEl = null;
    this._view = null;
  }

  // ─── Private: Layers ────────────────────────────────────────────────────────

  private _createLayers(): void {
    this._analysisLayer = new GraphicsLayer({
      id: TrajectoryEngine.ANALYSIS_LAYER_ID,
      title: 'Trajectory — Working',
      elevationInfo: { mode: 'absolute-height' } as any,
    });
    this._observerLayer = new GraphicsLayer({
      id: TrajectoryEngine.OBSERVER_LAYER_ID,
      title: 'Trajectory — Markers',
      elevationInfo: { mode: 'absolute-height' } as any,
    });
    this._committedLayer = new GraphicsLayer({
      id: TrajectoryEngine.COMMITTED_LAYER_ID,
      title: 'Trajectory — Committed',
      elevationInfo: { mode: 'absolute-height' } as any,
    });
  }

  // ─── Private: Geodetic Helpers ──────────────────────────────────────────────

  private _destinationPoint(
    lon: number, lat: number, bearingDeg: number, distM: number
  ): { longitude: number; latitude: number } {
    const R = 6_371_008.8;
    const δ = distM / R;
    const θ = (bearingDeg * Math.PI) / 180;
    const φ1 = (lat * Math.PI) / 180;
    const λ1 = (lon * Math.PI) / 180;
    const φ2 = Math.asin(
      Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
    );
    const λ2 = λ1 + Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
    );
    return { longitude: (λ2 * 180) / Math.PI, latitude: (φ2 * 180) / Math.PI };
  }

  private _bearing(lon1: number, lat1: number, lon2: number, lat2: number): number {
    const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  private _haversineM(lon1: number, lat1: number, lon2: number, lat2: number): number {
    const R = 6_371_008.8;
    const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180;
    const Δφ = φ2 - φ1, Δλ = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private _enuToGeo(
    oLon: number, oLat: number, oZ: number, e: number, n: number, u: number
  ): { lon: number; lat: number; z: number } {
    const dist = Math.sqrt(e * e + n * n);
    if (dist < 1e-9) return { lon: oLon, lat: oLat, z: oZ + u };
    const brg = (Math.atan2(e, n) * 180) / Math.PI;
    const { longitude, latitude } = this._destinationPoint(oLon, oLat, brg, dist);
    return { lon: longitude, lat: latitude, z: oZ + u };
  }

  // ─── Private: Physics ───────────────────────────────────────────────────────

  private _airDensity(altMSL: number): number {
    const T = 288.15 - 0.0065 * Math.min(Math.max(0, altMSL), 11000);
    return RHO_SL * Math.pow(T / 288.15, 4.256);
  }

  private _integrate(params: {
    presetKey: string;
    originLon: number;
    originLat: number;
    originElevM: number;
    bearingDeg: number;
    launchAngleDeg: number;
    windSpeedMs: number;
    windBearingDeg: number;
    targetElevM: number;
    useCoriolis: boolean;
  }): TrajectoryResult | null {
    const p = PROJECTILE_PRESETS[params.presetKey];
    if (!p) return null;

    const azR = (params.bearingDeg * Math.PI) / 180;
    const elR = (params.launchAngleDeg * Math.PI) / 180;
    const vH = p.muzzleVelocity * Math.cos(elR);
    let vE = vH * Math.sin(azR);
    let vN = vH * Math.cos(azR);
    let vU = p.muzzleVelocity * Math.sin(elR);

    const wazR = (params.windBearingDeg * Math.PI) / 180;
    const wE = params.windSpeedMs * Math.sin(wazR);
    const wN = params.windSpeedMs * Math.cos(wazR);

    const fCor = params.useCoriolis
      ? 2 * EARTH_OMEGA * Math.sin((params.originLat * Math.PI) / 180)
      : 0;

    const dt = 0.05;
    const maxT = 400;
    let east = 0, north = 0, up = 0, t = 0;
    let prevVU = vU;
    let apogeeIdx = 0, termIdx = 0;
    const pts: TrajectoryPoint[] = [];

    while (t < maxT) {
      const altMSL = params.originElevM + up;
      if (t > 0.1 && altMSL <= params.targetElevM) break;

      pts.push({ east, north, up, t, altMSL, vU });

      if (prevVU > 0 && vU <= 0) apogeeIdx = pts.length - 1;

      const relE = vE - wE;
      const relN = vN - wN;
      const relSpd = Math.sqrt(relE ** 2 + relN ** 2 + vU ** 2) || 1e-9;
      const A = Math.PI * (p.diamM / 2) ** 2;
      const da = (0.5 * this._airDensity(Math.max(0, altMSL)) * p.Cd * A * relSpd ** 2) / p.massKg;

      prevVU = vU;
      vE += (-(da * relE / relSpd) + fCor * vN) * dt;
      vN += (-(da * relN / relSpd) - fCor * vE) * dt;
      vU += (-(da * vU / relSpd) - G) * dt;

      east += vE * dt;
      north += vN * dt;
      up += vU * dt;
      t += dt;
    }

    for (let i = apogeeIdx; i < pts.length; i++) {
      if (Math.abs(pts[i].vU) >= 0.25 * p.muzzleVelocity) {
        termIdx = i;
        break;
      }
    }

    const last = pts[pts.length - 1];
    const impact = last
      ? this._enuToGeo(params.originLon, params.originLat, params.originElevM, last.east, last.north, 0)
      : null;
    const maxAlt = Math.max(...pts.map(pt => pt.altMSL));

    return {
      pts,
      apogeeIdx,
      termIdx,
      impact,
      tof: last?.t ?? 0,
      maxAlt,
      range: Math.sqrt((last?.east ?? 0) ** 2 + (last?.north ?? 0) ** 2),
    };
  }

  private _solveLaunchAngle(
    presetKey: string,
    rangeM: number,
    params: {
      originLon: number;
      originLat: number;
      originElevM: number;
      targetElevM: number;
      windSpeedMs: number;
      windBearingDeg: number;
      useCoriolis: boolean;
    }
  ): number {
    const p = PROJECTILE_PRESETS[presetKey];
    if (!p) return 45;

    const isHigh = p.optimalAngle >= 45;
    let lo = isHigh ? 45.1 : 1;
    let hi = isHigh ? p.maxAngle - 0.1 : 44.9;

    const achieved = (ang: number): number => {
      const r = this._integrate({
        presetKey,
        originLon: params.originLon,
        originLat: params.originLat,
        originElevM: params.originElevM,
        bearingDeg: 0,
        launchAngleDeg: ang,
        windSpeedMs: params.windSpeedMs,
        windBearingDeg: params.windBearingDeg,
        targetElevM: params.targetElevM,
        useCoriolis: params.useCoriolis,
      });
      return r ? r.range : 0;
    };

    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      const ach = achieved(mid);
      if (ach < rangeM) {
        isHigh ? (hi = mid) : (lo = mid);
      } else {
        isHigh ? (lo = mid) : (hi = mid);
      }
    }

    return Math.min(p.maxAngle, Math.max(0, (lo + hi) / 2));
  }
