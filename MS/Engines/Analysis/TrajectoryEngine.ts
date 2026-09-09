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
import EngineLogger from '../../Support/EngineLogger';
import { bindDisclosures } from '../../Support/Disclosure';

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
    icon: 'BMB',
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
    icon: 'BMB',
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
    icon: 'BMB',
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
    icon: 'AT',
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
    icon: 'AT',
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
    icon: 'RKT',
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
    icon: 'RKT',
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
    icon: 'AIR',
  },

  // ── Pakistan ─────────────────────────────────────────────────────────────────

  baktar_shikan: {
    label: 'Baktar Shikan ATGM (PK)',
    massKg: 11.3,
    diamM: 0.120,
    Cd: 0.43,
    muzzleVelocity: 160,
    optimalAngle: 0,
    maxAngle: 12,
    cepM: 2,
    color: [50, 140, 70],
    accentHex: '#328C46',
    icon: 'RKT',
  },
  nasr_srbm: {
    label: 'NASR Hatf-IX SRBM (PK)',
    massKg: 200,
    diamM: 0.290,
    Cd: 0.22,
    muzzleVelocity: 760,
    optimalAngle: 35,
    maxAngle: 50,
    cepM: 150,
    color: [50, 140, 70],
    accentHex: '#328C46',
    icon: 'RKT',
  },
  grad_bm21: {
    label: 'BM-21 Grad 122 mm (PK)',
    massKg: 66.4,
    diamM: 0.122,
    Cd: 0.27,
    muzzleVelocity: 690,
    optimalAngle: 45,
    maxAngle: 55,
    cepM: 160,
    color: [50, 140, 70],
    accentHex: '#328C46',
    icon: 'RKT',
  },
  fatah1_mlrs: {
    label: 'Fatah-1 MLRS 250 mm (PK)',
    massKg: 200,
    diamM: 0.250,
    Cd: 0.24,
    muzzleVelocity: 980,
    optimalAngle: 35,
    maxAngle: 50,
    cepM: 100,
    color: [50, 140, 70],
    accentHex: '#328C46',
    icon: 'RKT',
  },

  // ── India ─────────────────────────────────────────────────────────────────────

  nag_atgm: {
    label: 'Nag ATGM (IN)',
    massKg: 42,
    diamM: 0.160,
    Cd: 0.36,
    muzzleVelocity: 230,
    optimalAngle: 0,
    maxAngle: 15,
    cepM: 1,
    color: [220, 110, 30],
    accentHex: '#DC6E1E',
    icon: 'RKT',
  },
  pinaka_mk1: {
    label: 'Pinaka Mk-I 214 mm (IN)',
    massKg: 100,
    diamM: 0.214,
    Cd: 0.26,
    muzzleVelocity: 820,
    optimalAngle: 45,
    maxAngle: 55,
    cepM: 100,
    color: [220, 110, 30],
    accentHex: '#DC6E1E',
    icon: 'RKT',
  },
  bofors_fh77: {
    label: 'Bofors FH-77B 155 mm (IN)',
    massKg: 43.5,
    diamM: 0.155,
    Cd: 0.27,
    muzzleVelocity: 864,
    optimalAngle: 30,
    maxAngle: 65,
    cepM: 45,
    color: [220, 110, 30],
    accentHex: '#DC6E1E',
    icon: 'AT',
  },
  prahaar_srbm: {
    label: 'Prahaar SRBM (IN)',
    massKg: 280,
    diamM: 0.420,
    Cd: 0.21,
    muzzleVelocity: 1150,
    optimalAngle: 30,
    maxAngle: 45,
    cepM: 80,
    color: [220, 110, 30],
    accentHex: '#DC6E1E',
    icon: 'RKT',
  },
};

// ─── Physical Constants ───────────────────────────────────────────────────────

const G = 9.80665;
const RHO_SL = 1.225;
const EARTH_OMEGA = 7.2921e-5;
const ENGINE_NAME = 'TrajectoryEngine';

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
  private _animStartMs = 0;
  private _animStartIdx = 0;
  private _animPlaybackRate = 1.5;

  // Draggable panel state
  private _dragOffsetX = 0;
  private _dragOffsetY = 0;
  private _isDragging = false;

  // Transient "pick a location" tooltip state
  private _tooltipEl: HTMLDivElement | null = null;
  private _tooltipTimer: number | null = null;

  constructor() {
    this._createLayers();
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
  open(graphic?: Graphic | null, view?: MapView | SceneView): void {
    if (view) this.initialize(view);
    const attrs = graphic?.attributes ?? {};

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
      if (attrs.targetLon != null && attrs.targetLat != null) {
        this._targetPoint = new Point({
          longitude: attrs.targetLon,
          latitude: attrs.targetLat,
          z: attrs.targetZ ?? 0,
          spatialReference: { wkid: 4326 },
        });
      } else {
        this._targetPoint = null;
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
        this._drawTargetMarker();
        this._redraw();
      }
      return;
    }

    // ── Normal mode: new fire point from graphic geometry ─────────────────────
    this._analysisLayer.removeAll();
    this._observerLayer.removeAll();
    this._stopAnimation();
    this._currentTrajectory = null;
    const geom = graphic?.geometry;
    if (geom?.type === 'point') {
      this._firePoint = geom as Point;
    } else if ((geom as any)?.centroid) {
      this._firePoint = (geom as any).centroid as Point;
    } else {
      this._firePoint = null;
    }

    this._targetPoint = null;
    this._placeMode = 'fire';
    const detectedPreset = graphic ? this._detectPresetType(graphic) : 'mortar_81mm';
    this._showPanel(detectedPreset);

    if (this._firePoint) {
      this._drawFireMarker();
      this._setStatus('placing');
      this._startTargetPlacement();
    } else {
      // Opened with no symbol — let the user place the fire point on the map.
      this._setStatus('awaiting');
      this._startFirePlacement();
    }
  }

  close(): void {
    this._hidePanel();
    this._hideTooltip();
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
    this._tooltipEl?.remove();
    this._panelEl = null;
    this._tooltipEl = null;
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
    muzzleVelocity?: number;
    windSpeedMs: number;
    windBearingDeg: number;
    targetElevM: number;
    useCoriolis: boolean;
  }): TrajectoryResult | null {
    const p = PROJECTILE_PRESETS[params.presetKey];
    if (!p) return null;
    const muzzleVelocity = params.muzzleVelocity ?? p.muzzleVelocity;

    const azR = (params.bearingDeg * Math.PI) / 180;
    const elR = (params.launchAngleDeg * Math.PI) / 180;
    const vH = muzzleVelocity * Math.cos(elR);
    let vE = vH * Math.sin(azR);
    let vN = vH * Math.cos(azR);
    let vU = muzzleVelocity * Math.sin(elR);

    // UI wind bearing is meteorological "from" bearing, while ENU velocity is "toward".
    const wazR = (((params.windBearingDeg + 180) % 360) * Math.PI) / 180;
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
      const vE0 = vE;
      vE += (-(da * relE / relSpd) + fCor * vN) * dt;
      vN += (-(da * relN / relSpd) - fCor * vE0) * dt;
      vU += (-(da * vU / relSpd) - G) * dt;

      east += vE * dt;
      north += vN * dt;
      up += vU * dt;
      t += dt;
    }

    // Default terminal phase = the final ~25% of the post-apogee descent, so a
    // flat / direct-fire trajectory (whose descent speed never reaches 25% of
    // muzzle velocity) still renders a non-empty terminal segment instead of
    // collapsing to a single discarded point.
    const postApogee = pts.length - 1 - apogeeIdx;
    termIdx = postApogee > 0
      ? pts.length - 1 - Math.max(1, Math.floor(postApogee * 0.25))
      : pts.length - 1;
    for (let i = apogeeIdx + 1; i < pts.length; i++) {
      if (Math.abs(pts[i].vU) >= 0.25 * muzzleVelocity) {
        termIdx = i;
        break;
      }
    }

    const last = pts[pts.length - 1];
    const impactPoint = last ? this._interpolateImpactPoint(pts, params.targetElevM) : null;
    const impact = impactPoint
      ? this._enuToGeo(
          params.originLon,
          params.originLat,
          params.originElevM,
          impactPoint.east,
          impactPoint.north,
          impactPoint.up
        )
      : null;
    const maxAlt = Math.max(...pts.map(pt => pt.altMSL));

    return {
      pts,
      apogeeIdx,
      termIdx,
      impact,
      tof: impactPoint?.t ?? last?.t ?? 0,
      maxAlt,
      range: Math.sqrt((impactPoint?.east ?? last?.east ?? 0) ** 2 + (impactPoint?.north ?? last?.north ?? 0) ** 2),
    };
  }

  private _interpolateImpactPoint(pts: TrajectoryPoint[], targetElevM: number): TrajectoryPoint | null {
    if (pts.length === 0) return null;
    const targetUp = targetElevM - pts[0].altMSL;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      if (prev.up >= targetUp && curr.up <= targetUp) {
        const span = prev.up - curr.up || 1e-9;
        const f = Math.max(0, Math.min(1, (prev.up - targetUp) / span));
        return {
          east: prev.east + (curr.east - prev.east) * f,
          north: prev.north + (curr.north - prev.north) * f,
          up: targetUp,
          t: prev.t + (curr.t - prev.t) * f,
          altMSL: targetElevM,
          vU: prev.vU + (curr.vU - prev.vU) * f,
        };
      }
    }
    return pts[pts.length - 1];
  }

  private _solveLaunchAngle(
    presetKey: string,
    rangeM: number,
    params: {
      originLon: number;
      originLat: number;
      originElevM: number;
      bearingDeg: number;
      muzzleVelocity: number;
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
        bearingDeg: params.bearingDeg,
        launchAngleDeg: ang,
        muzzleVelocity: params.muzzleVelocity,
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

  private _buildCEP(impactLon: number, impactLat: number, cepM: number, sides = 48): number[][] {
    const ring: number[][] = [];
    for (let i = 0; i <= sides; i++) {
      const bearing = (i / sides) * 360;
      const p = this._destinationPoint(impactLon, impactLat, bearing, cepM);
      ring.push([p.longitude, p.latitude]);
    }
    return ring;
  }

  // ─── Private: Main redraw ───────────────────────────────────────────────────

  private _redraw(): void {
    if (!this._firePoint || !this._panelEl) return;

    const presetKey = this._presetKey();
    const preset = PROJECTILE_PRESETS[presetKey] ?? PROJECTILE_PRESETS.mortar_81mm;
    const angleEl = this._inp('traj-angle');
    const velEl = this._inp('traj-vel');
    const azEl = this._inp('traj-azimuth');
    const obsEl = this._inp('traj-obsht');
    const wSpdEl = this._inp('traj-wind-spd');
    const wBrgEl = this._inp('traj-wind-brg');
    const usePhasesEl = this._panelEl.querySelector<HTMLInputElement>('#traj-opt-phases');
    const showCepEl = this._panelEl.querySelector<HTMLInputElement>('#traj-opt-cep');
    const useCorEl = this._panelEl.querySelector<HTMLInputElement>('#traj-opt-coriolis');
    const autoSolveEl = this._panelEl.querySelector<HTMLInputElement>('#traj-opt-autosolve');

    const launchAngleDeg = Number(angleEl?.value ?? preset.optimalAngle);
    const muzzleVelocity = Number(velEl?.value ?? preset.muzzleVelocity);
    const azimuthDeg = Number(azEl?.value ?? 0);
    const obsHtM = Number(obsEl?.value ?? 0);
    const windSpeedMs = Number(wSpdEl?.value ?? 0);
    const windBearingDeg = Number(wBrgEl?.value ?? 270);
    const usePhases = usePhasesEl?.checked ?? true;
    const showCEP = showCepEl?.checked ?? true;
    const useCoriolis = useCorEl?.checked ?? true;
    const autoSolve = autoSolveEl?.checked ?? false;

    this._setStatus('computing');

    const originElevM = (this._firePoint.z ?? 0) + obsHtM;
    const targetElevM = this._targetPoint?.z ?? (this._firePoint.z ?? 0);
    let solvedAngle = launchAngleDeg;
    let solvedAzimuth = azimuthDeg;

    if (autoSolve && this._targetPoint) {
      const rangeM = this._haversineM(
        this._firePoint.longitude ?? 0,
        this._firePoint.latitude ?? 0,
        this._targetPoint.longitude ?? 0,
        this._targetPoint.latitude ?? 0
      );
      solvedAzimuth = this._bearing(
        this._firePoint.longitude ?? 0,
        this._firePoint.latitude ?? 0,
        this._targetPoint.longitude ?? 0,
        this._targetPoint.latitude ?? 0
      );
      solvedAngle = this._solveLaunchAngle(presetKey, rangeM, {
        originLon: this._firePoint.longitude ?? 0,
        originLat: this._firePoint.latitude ?? 0,
        originElevM,
        bearingDeg: solvedAzimuth,
        muzzleVelocity,
        targetElevM,
        windSpeedMs,
        windBearingDeg,
        useCoriolis,
      });
      if (angleEl) angleEl.value = solvedAngle.toFixed(1);
      if (azEl) azEl.value = String(Math.round(solvedAzimuth));
      this._setText('#traj-angle-val', `${solvedAngle.toFixed(1)}°`);
    }

    const result = this._integrate({
      presetKey,
      originLon: this._firePoint.longitude ?? 0,
      originLat: this._firePoint.latitude ?? 0,
      originElevM,
      bearingDeg: solvedAzimuth,
      launchAngleDeg: solvedAngle,
      muzzleVelocity,
      windSpeedMs,
      windBearingDeg,
      targetElevM,
      useCoriolis,
    });

    if (!result || result.pts.length === 0) {
      this._setStatus('error');
      return;
    }

    this._currentTrajectory = result;
    this._analysisLayer.removeAll();
    this._stopAnimation(true);

    const toGeo = (pt: TrajectoryPoint): [number, number, number] => {
      const g = this._enuToGeo(
        this._firePoint?.longitude ?? 0,
        this._firePoint?.latitude ?? 0,
        originElevM,
        pt.east,
        pt.north,
        pt.up
      );
      return [g.lon, g.lat, g.z];
    };

    const addPath = (
      points: TrajectoryPoint[],
      color: [number, number, number],
      style: 'solid' | 'dash',
      size = 2.4,
      opacity = 0.9,
      type = 'trajectory_arc'
    ): void => {
      if (points.length < 2) return;
      const coords = points.map(toGeo);
      const haloSymbol = this._view?.type === '3d'
        ? {
            type: 'line-3d',
            symbolLayers: [{
              type: 'line',
              size: size + 5.5,
              material: { color: [12, 18, 22, Math.round(opacity * 115)] },
              pattern: { type: 'style', style },
              cap: 'round',
              join: 'round',
            }],
          } as any
        : {
            type: 'simple-line',
            color: [12, 18, 22, Math.round(opacity * 120)],
            width: Math.max(3, Math.round(size + 4)),
            style: style === 'dash' ? 'short-dash' : 'solid',
          } as any;
      const symbol = this._view?.type === '3d'
        ? {
            type: 'line-3d',
            symbolLayers: [{
              type: 'line',
              size: size + 0.4,
              material: { color: [...color, Math.round(opacity * 255)] },
              pattern: { type: 'style', style },
              cap: 'round',
              join: 'round',
            }],
          } as any
        : {
            type: 'simple-line',
            color: [...color, Math.round(opacity * 255)],
            width: Math.max(2, Math.round(size + 1)),
            style: style === 'dash' ? 'short-dash' : 'solid',
          } as any;

      this._analysisLayer.add(new Graphic({
        geometry: new Polyline({ hasZ: true, paths: [coords], spatialReference: { wkid: 4326 } }),
        symbol: haloSymbol,
        attributes: { type: `${type}_halo`, interactive: false },
      }));
      this._analysisLayer.add(new Graphic({
        geometry: new Polyline({ hasZ: true, paths: [coords], spatialReference: { wkid: 4326 } }),
        symbol,
        attributes: { type },
      }));
    };

    if (usePhases) {
      const a = Math.max(0, Math.min(result.apogeeIdx, result.pts.length - 1));
      const t = Math.max(a, Math.min(result.termIdx, result.pts.length - 1));
      addPath(result.pts.slice(0, a + 1), [29, 158, 117], 'solid', 2.8, 0.92, 'trajectory_phase_launch');
      addPath(result.pts.slice(a, t + 1), [239, 159, 39], 'solid', 2.6, 0.88, 'trajectory_phase_flight');
      addPath(result.pts.slice(t), [220, 90, 48], 'dash', 2.2, 0.62, 'trajectory_phase_terminal');
    } else {
      addPath(result.pts, [239, 159, 39], 'solid', 2.7, 0.9, 'trajectory_arc');
    }

    const ap = result.pts[result.apogeeIdx];
    if (ap) {
      const g = this._enuToGeo(
        this._firePoint.longitude ?? 0,
        this._firePoint.latitude ?? 0,
        originElevM,
        ap.east,
        ap.north,
        ap.up
      );
      this._analysisLayer.add(new Graphic({
        geometry: new Point({ longitude: g.lon, latitude: g.lat, z: g.z, spatialReference: { wkid: 4326 } }),
        symbol: this._apogeeSymbol(),
        attributes: { type: 'trajectory_apogee' },
      }));
    }

    if (result.impact) {
      this._analysisLayer.add(new Graphic({
        geometry: new Point({
          longitude: result.impact.lon,
          latitude: result.impact.lat,
          z: targetElevM,
          spatialReference: { wkid: 4326 },
        }),
        symbol: this._impactSymbol(),
        attributes: { type: 'trajectory_impact' },
      }));
    }

    if (showCEP && result.impact) {
      const ring = this._buildCEP(result.impact.lon, result.impact.lat, preset.cepM);
      this._analysisLayer.add(new Graphic({
        geometry: new Polygon({ rings: [ring], spatialReference: { wkid: 4326 } }),
        symbol: this._is3D()
          ? {
              type: 'polygon-3d',
              symbolLayers: [{
                type: 'fill',
                material: { color: [preset.color[0], preset.color[1], preset.color[2], 45] },
                outline: { color: [preset.color[0], preset.color[1], preset.color[2], 185], size: 1.2 },
              }],
            } as any
          : {
              type: 'simple-fill',
              color: [preset.color[0], preset.color[1], preset.color[2], 30],
              outline: { color: [preset.color[0], preset.color[1], preset.color[2], 180], width: 1.2 },
            } as any,
        attributes: { type: 'trajectory_cep', cepM: preset.cepM },
      }));
    }

    this._setText('#traj-st-range', Math.round(result.range).toLocaleString());
    this._setText('#traj-st-tof', result.tof.toFixed(1));
    this._setText('#traj-st-alt', Math.round(result.maxAlt).toLocaleString());

    this._setResultsVisible(true);
    const commitBtn = this._panelEl.querySelector<HTMLButtonElement>('#traj-commit-btn');
    const animBtn = this._panelEl.querySelector<HTMLButtonElement>('#traj-animate-btn');
    if (commitBtn) commitBtn.disabled = false;
    if (animBtn) animBtn.disabled = false;
    this._setStatus('ready');
  }

  // ─── Private: Drawing helpers ───────────────────────────────────────────────

  private _is3D(): boolean {
    return this._view?.type === '3d';
  }

  private _apogeeSymbol(): any {
    return {
      type: 'simple-marker',
      style: 'triangle',
      color: [239, 159, 39, 220],
      size: 10,
      outline: { color: [255, 240, 220, 220], width: 1.2 },
    } as any;
  }

  private _impactSymbol(): any {
    return {
      type: 'simple-marker',
      style: 'circle',
      color: [220, 90, 48, 225],
      size: 9,
      outline: { color: [255, 220, 220, 220], width: 1.2 },
    } as any;
  }

  private _fireSymbol(color: [number, number, number]): any {
    return {
      type: 'simple-marker',
      style: 'diamond',
      color: [...color, 235],
      size: 12,
      outline: { color: [255, 255, 255, 220], width: 1.2 },
    } as any;
  }

  private _targetSymbol(): any {
    return {
      type: 'simple-marker',
      style: 'triangle',
      color: [220, 90, 48, 235],
      size: 12,
      outline: { color: [255, 240, 230, 220], width: 1.2 },
    } as any;
  }

  private _projectileSymbol(color: [number, number, number]): any {
    return {
      type: 'simple-marker',
      style: 'circle',
      color: [...color, 242],
      size: 8,
      outline: { color: [255, 255, 255, 200], width: 1.2 },
    } as any;
  }

  private _drawFireMarker(): void {
    if (!this._firePoint) return;
    this._observerLayer.graphics
      .filter((g: Graphic) => g.attributes?.markerRole === 'fire')
      .forEach((g: Graphic) => this._observerLayer.remove(g));

    const preset = this._currentPreset();
    this._observerLayer.add(new Graphic({
      geometry: new Point({
        longitude: this._firePoint.longitude,
        latitude: this._firePoint.latitude,
        z: (this._firePoint.z ?? 0) + 1,
        spatialReference: { wkid: 4326 },
      }),
      symbol: this._fireSymbol(preset.color),
      attributes: { type: 'trajectory_fire', markerRole: 'fire' },
    }));

    this._setText(
      '#traj-fire-coords',
      `Fire  ${(this._firePoint.latitude ?? 0).toFixed(5)}°N  ${(this._firePoint.longitude ?? 0).toFixed(5)}°E`
    );
  }

  private _drawTargetMarker(): void {
    this._observerLayer.graphics
      .filter((g: Graphic) => g.attributes?.markerRole === 'target')
      .forEach((g: Graphic) => this._observerLayer.remove(g));

    if (!this._targetPoint) {
      this._setText('#traj-target-coords', 'No target set');
      this._syncPlacementUI();
      return;
    }

    this._observerLayer.add(new Graphic({
      geometry: new Point({
        longitude: this._targetPoint.longitude,
        latitude: this._targetPoint.latitude,
        z: (this._targetPoint.z ?? 0) + 1,
        spatialReference: { wkid: 4326 },
      }),
      symbol: this._targetSymbol(),
      attributes: { type: 'trajectory_target', markerRole: 'target' },
    }));

    this._setText(
      '#traj-target-coords',
      `Target  ${(this._targetPoint.latitude ?? 0).toFixed(5)}°N  ${(this._targetPoint.longitude ?? 0).toFixed(5)}°E`
    );
  }

  // ─── Private: Placement ─────────────────────────────────────────────────────

  private _startFirePlacement(): void {
    if (!this._view) return;
    this._cancelPlacement();
    this._placeMode = 'fire';
    this._setPickArmed('fire');
    this._flashPickTooltip('Click the map to place the fire point.');
    this._setStatus('placing');
    this._clickHandle = this._view.on('click', async (event: any) => {
      this._cancelPlacement();
      const pt = await this._pickMapPoint(event);
      this._firePoint = pt;
      this._hideTooltip();
      this._drawFireMarker();
      this._setStatus('placing');
      this._startTargetPlacement();
      if (this._targetPoint) this._redraw();
    });
  }

  private _startTargetPlacement(): void {
    if (!this._view || !this._firePoint) return;
    this._cancelPlacement();
    this._placeMode = 'target';
    this._setPickArmed('target');
    this._flashPickTooltip('Click the map to place the target.', 'traj-pick-target-btn');
    this._setStatus('placing');
    this._clickHandle = this._view.on('click', async (event: any) => {
      this._cancelPlacement();
      const pt = await this._pickMapPoint(event);
      this._targetPoint = pt;
      this._drawTargetMarker();
      this._syncPlacementUI();
      const brg = this._bearing(
        this._firePoint?.longitude ?? 0,
        this._firePoint?.latitude ?? 0,
        pt.longitude ?? 0,
        pt.latitude ?? 0
      );
      const az = this._inp('traj-azimuth');
      if (az) az.value = String(Math.round(brg));
      this._redraw();
    });
  }

  /** Pulse whichever placement button is waiting on a map click. */
  private _setPickArmed(mode: 'fire' | 'target' | null): void {
    const p = this._panelEl;
    if (!p) return;
    p.querySelector('#traj-pick-fire-btn')?.classList.toggle('ms-armed', mode === 'fire');
    p.querySelector('#traj-pick-target-btn')?.classList.toggle('ms-armed', mode === 'target');
  }

  /** "Clear target" only exists once a target does. */
  private _syncPlacementUI(): void {
    const el = this._panelEl?.querySelector<HTMLElement>('#traj-target-actions');
    if (el) el.hidden = !this._targetPoint;
  }

  /** Stats, animation and the scrubber only apply once an arc has been solved. */
  private _setResultsVisible(visible: boolean): void {
    const el = this._panelEl?.querySelector<HTMLElement>('#traj-results');
    if (el) el.hidden = !visible;
  }

  private _cancelPlacement(): void {
    this._setPickArmed(null);
    if (this._clickHandle) {
      this._clickHandle.remove();
      this._clickHandle = null;
    }
  }

  private async _pickMapPoint(event: any): Promise<Point> {
    if (!this._view) {
      return new Point({ longitude: 0, latitude: 0, spatialReference: { wkid: 4326 } });
    }
    if (this._view.type === '3d') {
      const hit = await (this._view as any).hitTest(event, { include: [(this._view as any).map.ground] });
      const gp = hit?.ground?.mapPoint ?? event.mapPoint;
      return new Point({
        longitude: gp.longitude,
        latitude: gp.latitude,
        z: gp.z ?? 0,
        spatialReference: { wkid: 4326 },
      });
    }
    return new Point({
      longitude: event.mapPoint.longitude,
      latitude: event.mapPoint.latitude,
      z: event.mapPoint.z ?? 0,
      spatialReference: { wkid: 4326 },
    });
  }

  // ─── Private: Animation ─────────────────────────────────────────────────────

  private _startAnimation(): void {
    if (!this._currentTrajectory || !this._firePoint || !this._panelEl) return;

    const scrubWrap = this._panelEl.querySelector<HTMLElement>('#traj-scrub-wrap');
    const scrub = this._inp('traj-scrubber');
    const playBtn = this._panelEl.querySelector<HTMLButtonElement>('#traj-play-btn');
    if (!scrubWrap || !scrub || !playBtn) return;

    scrubWrap.hidden = false;
    scrub.max = String(Math.max(0, this._currentTrajectory.pts.length - 1));
    scrub.value = '0';
    this._setupAnimGraphic();
    this._seekAnimation(0);
    this._playAnimation();
  }

  private _setupAnimGraphic(): void {
    if (!this._firePoint) return;
    if (this._animGraphic) this._observerLayer.remove(this._animGraphic);
    const preset = this._currentPreset();
    this._animGraphic = new Graphic({
      geometry: new Point({
        longitude: this._firePoint.longitude,
        latitude: this._firePoint.latitude,
        z: (this._firePoint.z ?? 0) + 1,
        spatialReference: { wkid: 4326 },
      }),
      symbol: this._projectileSymbol(preset.color),
      attributes: { type: 'trajectory_projectile' },
    });
    this._observerLayer.add(this._animGraphic);
  }

  private _seekAnimation(frameIdx: number): void {
    if (!this._animGraphic || !this._currentTrajectory || !this._firePoint || !this._panelEl) return;
    const idx = Math.max(0, Math.min(frameIdx, this._currentTrajectory.pts.length - 1));
    const pt = this._currentTrajectory.pts[idx];
    const obsHtM = Number(this._inp('traj-obsht')?.value ?? 0);
    const g = this._enuToGeo(
      this._firePoint.longitude ?? 0,
      this._firePoint.latitude ?? 0,
      (this._firePoint.z ?? 0) + obsHtM,
      pt.east,
      pt.north,
      pt.up
    );
    this._animGraphic.geometry = new Point({
      longitude: g.lon,
      latitude: g.lat,
      z: g.z,
      spatialReference: { wkid: 4326 },
    });
    this._setText('#traj-scrub-time', `${pt.t.toFixed(2)} s`);
    const scrub = this._inp('traj-scrubber');
    if (scrub) scrub.value = String(idx);
  }

  private _playAnimation(): void {
    if (!this._currentTrajectory || !this._panelEl) return;
    const scrub = this._inp('traj-scrubber');
    const playBtn = this._panelEl.querySelector<HTMLButtonElement>('#traj-play-btn');
    if (!scrub || !playBtn) return;

    this._animRunning = true;
    playBtn.textContent = '■';
    this._animStartIdx = Number(scrub.value);
    this._animStartMs = performance.now();
    const total = this._currentTrajectory.pts.length;

    const step = (now: number) => {
      const elapsedS = ((now - this._animStartMs) / 1000) * this._animPlaybackRate;
      const baseT = this._currentTrajectory?.pts[this._animStartIdx]?.t ?? 0;
      const targetT = baseT + elapsedS;
      let idx = this._animStartIdx;
      while (idx < total - 1 && (this._currentTrajectory?.pts[idx]?.t ?? 0) < targetT) idx++;

      if (!this._animRunning || idx >= total - 1) {
        this._seekAnimation(total - 1);
        this._animRunning = false;
        playBtn.textContent = '▶';
        this._animFrame = null;
        return;
      }
      this._seekAnimation(idx);
      this._animFrame = requestAnimationFrame(step);
    };
    this._animFrame = requestAnimationFrame(step);
  }

  private _toggleAnimation(): void {
    if (!this._panelEl) return;
    const playBtn = this._panelEl.querySelector<HTMLButtonElement>('#traj-play-btn');
    if (!playBtn) return;

    if (this._animRunning) {
      this._stopAnimation(false);
      playBtn.textContent = '▶';
    } else {
      this._playAnimation();
    }
  }

  private _stopAnimation(removeGraphic = true): void {
    this._animRunning = false;
    if (this._animFrame != null) {
      cancelAnimationFrame(this._animFrame);
      this._animFrame = null;
    }
    if (removeGraphic && this._animGraphic) {
      this._observerLayer.remove(this._animGraphic);
      this._animGraphic = null;
    }
  }

  // ─── Private: Commit ────────────────────────────────────────────────────────

  private _commit(): void {
    if (!this._firePoint || this._analysisLayer.graphics.length === 0) return;
    const ts = new Date().toISOString();
    const attrsBase = {
      committedAt: ts,
      presetKey: this._presetKey(),
      launchAngle: Number(this._inp('traj-angle')?.value ?? 45),
      muzzleVel: Number(this._inp('traj-vel')?.value ?? this._currentPreset().muzzleVelocity),
      azimuth: Number(this._inp('traj-azimuth')?.value ?? 0),
      windSpeed: Number(this._inp('traj-wind-spd')?.value ?? 0),
      windBearing: Number(this._inp('traj-wind-brg')?.value ?? 270),
      usePhases: this._panelEl?.querySelector<HTMLInputElement>('#traj-opt-phases')?.checked ?? true,
      showCEP: this._panelEl?.querySelector<HTMLInputElement>('#traj-opt-cep')?.checked ?? true,
      useCoriolis: this._panelEl?.querySelector<HTMLInputElement>('#traj-opt-coriolis')?.checked ?? true,
      fireLon: this._firePoint.longitude ?? 0,
      fireLat: this._firePoint.latitude ?? 0,
      fireZ: this._firePoint.z ?? 0,
      targetLon: this._targetPoint?.longitude,
      targetLat: this._targetPoint?.latitude,
      targetZ: this._targetPoint?.z,
    };

    this._analysisLayer.graphics.forEach((g: Graphic) => {
      if (!g.geometry) return;
      this._committedLayer.add(new Graphic({
        geometry: g.geometry.clone(),
        symbol: (g as any).symbol?.clone(),
        attributes: { ...g.attributes, ...attrsBase },
      }));
    });

    this._setStatus('committed');
    setTimeout(() => this._setStatus('ready'), 2000);
  }

  // ─── Private: Panel ─────────────────────────────────────────────────────────

  private _showPanel(defaultPreset = 'mortar_81mm', override?: TrajectoryPanelOverride): void {
    if (!this._panelEl) {
      this._panelEl = document.createElement('div');
      this._panelEl.id = 'trajectory-engine-panel';
      this._panelEl.className = 'ms-panel ms-theme-ops-dark';
      this._panelEl.setAttribute('data-engine', 'trajectory');
      this._panelEl.style.top = '62px';
      this._panelEl.style.right = '12px';
      this._panelEl.style.width = '392px';
      document.body.appendChild(this._panelEl);
    }

    const preset = PROJECTILE_PRESETS[defaultPreset] ?? PROJECTILE_PRESETS.mortar_81mm;
    this._panelEl.style.setProperty('--traj-accent', preset.accentHex);
    // The re-edit path needs the override values written into the markup, so
    // the panel is rebuilt rather than reused.
    this._panelEl.innerHTML = this._buildPanelHTML(defaultPreset, preset, override);
    this._panelEl.classList.add('ms-visible');
    this._bindPanelEvents();
    this._makeDraggable();
    this._setText('#traj-fire-coords', this._firePoint
      ? `Fire  ${(this._firePoint.latitude ?? 0).toFixed(5)}°N  ${(this._firePoint.longitude ?? 0).toFixed(5)}°E`
      : 'No fire point placed');
    this._setText('#traj-target-coords', this._targetPoint
      ? `Target  ${(this._targetPoint.latitude ?? 0).toFixed(5)}°N  ${(this._targetPoint.longitude ?? 0).toFixed(5)}°E`
      : 'No target set');
    this._syncPlacementUI();
    this._setResultsVisible(!!this._currentTrajectory);
  }

  private _hidePanel(): void {
    this._panelEl?.classList.remove('ms-visible');
  }

  private _buildPanelHTML(
    presetKey: string,
    preset: ProjectilePreset,
    override?: TrajectoryPanelOverride
  ): string {
    const isEdit = override != null;
    const v = override ?? {};
    const launchAngle = v.launchAngle ?? preset.optimalAngle;
    const muzzleVel = v.muzzleVel ?? preset.muzzleVelocity;
    const azimuth = v.azimuth ?? 0;
    const obsHeight = v.obsHeight ?? 0;
    const windSpeed = v.windSpeed ?? 5;
    const windBearing = v.windBearing ?? 270;
    const usePhases = v.usePhases ?? true;
    const showCEP = v.showCEP ?? true;
    const useCoriolis = v.useCoriolis ?? true;

    const options = Object.entries(PROJECTILE_PRESETS)
      .map(([k, p]) => `<option value="${k}"${k === presetKey ? ' selected' : ''}>${p.icon} ${p.label}</option>`)
      .join('');

    return `
      <div class="ms-header" id="traj-drag-handle">
        <span class="ms-header-icon" id="traj-header-icon">↗</span>
        <span class="ms-header-title">Trajectory Analysis${isEdit ? ' — Re-edit' : ''}</span>
        <span class="ms-status-dot" id="traj-status-dot"></span>
        <span class="ms-status-lbl" id="traj-status-lbl">${isEdit ? 'Restored' : 'Awaiting fire point'}</span>
        <button class="ms-header-btn ms-btn-round" id="traj-help-btn" title="How trajectory analysis works">?</button>
        <button class="ms-header-btn ms-btn-round" id="traj-minimize-btn" title="Minimize">▼</button>
        <button class="ms-header-btn ms-btn-round" id="traj-close-btn" title="Close (keeps graphics)">✕</button>
      </div>

      <div class="ms-help-popover" id="traj-help-popover" hidden>
        <div class="ms-help-head">
          <div>
            <div class="ms-help-kicker">Field Guide</div>
            <div class="ms-help-title">Trajectory Analysis</div>
          </div>
          <button class="ms-help-close" id="traj-help-close" title="Close">✕</button>
        </div>
        <div class="ms-help-body">
          <div class="ms-help-answers">
            <div class="ms-help-answers-kicker">Answers</div>
            <div class="ms-help-answers-q">Where will this round actually land?</div>
          </div>
          <p>Simulates projectile flight from a fire point using launch geometry, drag, wind, and optional Coriolis correction. It can also animate the path and estimate impact statistics.</p>
          <div class="ms-help-block">
            <h4>How It Works</h4>
            <ol>
              <li>Press <strong>Pick fire point</strong> and click the map, then optionally pick a target.</li>
              <li>Choose the projectile. Its preset loads mass, drag, muzzle velocity and reference CEP.</li>
              <li>The arc redraws as you change anything, so there is no separate run step.</li>
              <li>Animate the flight, then commit to bake the arc onto the committed layer.</li>
            </ol>
          </div>
          <div class="ms-help-block">
            <h4>Phenomenon</h4>
            <p>The engine numerically integrates projectile motion in small time steps. Gravity pulls the round down, drag reduces speed, wind shifts the path, and Coriolis can add long-range lateral bias. The result is a flight path rather than a simple straight line or parabola guess.</p>
          </div>
          <div class="ms-help-block">
            <h4>Parameters</h4>
            <dl>
              <dt>Projectile</dt><dd>Loads ballistic defaults such as mass, drag coefficient, muzzle velocity, and CEP for the selected round or weapon.</dd>
              <dt>Angle</dt><dd>Launch elevation above the horizon; this strongly affects range and apogee.</dd>
              <dt>Velocity</dt><dd>Initial muzzle or departure speed used by the integrator.</dd>
              <dt>Azimuth</dt><dd>Firing bearing when solving manually or when no target point is set.</dd>
              <dt>Obs ht</dt><dd>Launch point height above local ground or symbol elevation.</dd>
              <dt>Wind speed</dt><dd>Wind magnitude applied during flight.</dd>
              <dt>Wind brg</dt><dd>Meteorological from-bearing, meaning the direction the wind comes from.</dd>
              <dt>Phases</dt><dd>Colors launch, cruise, and terminal portions of the path separately.</dd>
              <dt>CEP</dt><dd>Shows an approximate impact dispersion circle around the solved impact point.</dd>
              <dt>Coriolis</dt><dd>Adds Earth-rotation correction, most noticeable on longer flights.</dd>
              <dt>Auto-solve</dt><dd>When a target exists, keeps recomputing as inputs change so the firing solution stays current.</dd>
            </dl>
          </div>
        </div>
      </div>

      <div class="ms-body">
        <!-- Default view: place fire and target, choose the projectile, commit.
             The arc redraws live, so launch geometry, wind and the display
             toggles all live in the collapsed Advanced disclosure. -->
        <div class="ms-section-title">Fire &amp; target</div>
        <div class="ms-btn-row">
          <button class="ms-btn primary" id="traj-pick-fire-btn" title="Click, then click the map to place the fire point">📍 Fire point</button>
          <button class="ms-btn primary" id="traj-pick-target-btn" title="Click, then click the map to place the target">🎯 Target</button>
        </div>
        <div class="ms-coords" id="traj-fire-coords">No fire point placed</div>
        <div class="ms-coords" id="traj-target-coords">No target set</div>
        <div class="ms-btn-row" id="traj-target-actions" hidden>
          <button class="ms-btn" id="traj-clear-target-btn">Clear target</button>
        </div>

        <div class="ms-grid full">
          <div class="ms-field">
            <label class="ms-label" for="traj-preset">Projectile</label>
            <select id="traj-preset" class="ms-select">${options}</select>
          </div>
        </div>

        <div class="ms-btn-row">
          <button class="ms-btn ms-cta" id="traj-commit-btn" ${isEdit ? '' : 'disabled'}>Commit ↗</button>
        </div>

        <div id="traj-results" hidden>
          <div class="traj-stats">
            <div class="traj-stat"><div class="traj-stat-val" id="traj-st-range">—</div><div class="traj-stat-lbl">Range (m)</div></div>
            <div class="traj-stat"><div class="traj-stat-val" id="traj-st-tof">—</div><div class="traj-stat-lbl">TOF (s)</div></div>
            <div class="traj-stat"><div class="traj-stat-val" id="traj-st-alt">—</div><div class="traj-stat-lbl">Apex (m)</div></div>
          </div>
          <div class="ms-btn-row">
            <button class="ms-btn" id="traj-animate-btn" disabled>Animate ▶</button>
            <button class="ms-btn danger" id="traj-clear-btn">Clear</button>
          </div>
          <div class="traj-scrub-wrap" id="traj-scrub-wrap" hidden>
            <span class="ms-slider-label">T+</span>
            <input id="traj-scrubber" type="range" min="0" max="0" value="0" step="1" />
            <span id="traj-scrub-time" class="ms-slider-value">0.00 s</span>
            <button class="ms-btn" id="traj-play-btn" style="flex:0 0 auto;">▶</button>
          </div>
        </div>

        <div class="ms-disclosure" data-open="false">
          <button class="ms-disclosure-head" type="button" id="traj-adv-toggle" aria-expanded="false" aria-controls="traj-adv-body">
            <span class="ms-disclosure-chevron" aria-hidden="true">▶</span>
            <span class="ms-disclosure-title">Advanced</span>
            <span class="ms-disclosure-meta">Launch geometry, wind, display</span>
          </button>
          <div class="ms-disclosure-body" id="traj-adv-body" hidden>
            <div class="ms-section-title">Launch</div>
            <div class="ms-slider-row">
              <div class="ms-slider-label">Launch angle (°)</div>
              <input id="traj-angle" type="range" min="0" max="89" step="0.5" value="${launchAngle}" />
              <div class="ms-slider-value" id="traj-angle-val">${Number(launchAngle).toFixed(1)}°</div>
            </div>
            <div class="ms-slider-row">
              <div class="ms-slider-label">Muzzle vel (m/s)</div>
              <input id="traj-vel" type="range" min="20" max="1200" step="1" value="${muzzleVel}" />
              <div class="ms-slider-value" id="traj-vel-val">${Math.round(muzzleVel)}</div>
            </div>
            <div class="ms-grid">
              <div class="ms-field">
                <label class="ms-label" for="traj-azimuth">Azimuth (°)</label>
                <input id="traj-azimuth" class="ms-input" type="number" min="0" max="359" step="1" value="${Math.round(azimuth)}" />
              </div>
              <div class="ms-field">
                <label class="ms-label" for="traj-obsht">Obs height (m)</label>
                <input id="traj-obsht" class="ms-input" type="number" min="0" max="100" step="0.5" value="${obsHeight}" />
              </div>
            </div>

            <div class="ms-section-title">Wind</div>
            <div class="ms-slider-row">
              <div class="ms-slider-label">Speed (m/s)</div>
              <input id="traj-wind-spd" type="range" min="0" max="40" step="0.5" value="${windSpeed}" />
              <div class="ms-slider-value" id="traj-wind-spd-val">${Number(windSpeed).toFixed(1)}</div>
            </div>
            <div class="ms-slider-row">
              <div class="ms-slider-label">From bearing (°)</div>
              <input id="traj-wind-brg" type="range" min="0" max="359" step="1" value="${Math.round(windBearing)}" />
              <div class="ms-slider-value" id="traj-wind-brg-val">${Math.round(windBearing)}°</div>
            </div>

            <div class="ms-section-title">Display</div>
            <div class="ms-toggle-row">
              <label for="traj-opt-phases">Phase colouring</label>
              <input id="traj-opt-phases" type="checkbox" class="ms-input"${usePhases ? ' checked' : ''} />
            </div>
            <div class="ms-toggle-row">
              <label for="traj-opt-cep">Show CEP ring</label>
              <input id="traj-opt-cep" type="checkbox" class="ms-input"${showCEP ? ' checked' : ''} />
            </div>
            <div class="ms-toggle-row">
              <label for="traj-opt-coriolis">Coriolis effect</label>
              <input id="traj-opt-coriolis" type="checkbox" class="ms-input"${useCoriolis ? ' checked' : ''} />
            </div>
            <div class="ms-toggle-row">
              <label for="traj-opt-autosolve">Auto-solve angle to target</label>
              <input id="traj-opt-autosolve" type="checkbox" class="ms-input" checked />
            </div>
          </div>
        </div>

        <div class="ms-disclosure" data-open="false">
          <button class="ms-disclosure-head" type="button" id="traj-legend-toggle" aria-expanded="false" aria-controls="traj-legend-body">
            <span class="ms-disclosure-chevron" aria-hidden="true">▶</span>
            <span class="ms-disclosure-title">Legend</span>
            <span class="ms-disclosure-meta">What the arc colours mean</span>
          </button>
          <div class="ms-disclosure-body" id="traj-legend-body" hidden>
            <div class="traj-legend">
              <span class="traj-leg-launch">Launch</span>
              <span class="traj-leg-flight">Flight</span>
              <span class="traj-leg-terminal">Terminal</span>
              <span class="traj-leg-apogee">Apogee</span>
              <span class="traj-leg-impact">Impact / CEP</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private _bindPanelEvents(): void {
    if (!this._panelEl) return;
    const p = this._panelEl;

    p.querySelector('#traj-help-btn')?.addEventListener('click', (event) => {
      event.stopPropagation();
      const help = p.querySelector<HTMLElement>('#traj-help-popover');
      if (help) help.hidden = !help.hidden;
    });
    p.querySelector('#traj-help-close')?.addEventListener('click', () => {
      const help = p.querySelector<HTMLElement>('#traj-help-popover');
      if (help) help.hidden = true;
    });

    p.querySelector('#traj-minimize-btn')?.addEventListener('click', () => {
      const body = p.querySelector<HTMLElement>('.ms-body');
      const btn  = p.querySelector<HTMLElement>('#traj-minimize-btn');
      if (!body || !btn) return;
      const minimized = body.classList.toggle('ms-minimized');
      btn.textContent = minimized ? '▶' : '▼';
      btn.title = minimized ? 'Restore' : 'Minimize';
    });

    p.querySelector('#traj-close-btn')?.addEventListener('click', () => {
      this._hidePanel();
      this._cancelPlacement();
      this._stopAnimation(false);
    });

    p.querySelector('#traj-preset')?.addEventListener('change', () => {
      const preset = this._currentPreset();
      this._setInputVal('traj-angle', preset.optimalAngle);
      this._setInputVal('traj-vel', preset.muzzleVelocity);
      this._setText('#traj-angle-val', `${preset.optimalAngle.toFixed(1)}°`);
      this._setText('#traj-vel-val', String(Math.round(preset.muzzleVelocity)));
      p.style.setProperty('--traj-accent', preset.accentHex);
      const headerIcon = p.querySelector<HTMLElement>('#traj-header-icon');
      if (headerIcon) headerIcon.textContent = preset.icon;
      if (this._firePoint) this._redraw();
    });

    p.querySelector('#traj-angle')?.addEventListener('input', (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      this._setText('#traj-angle-val', `${v.toFixed(1)}°`);
      if (this._firePoint) this._redraw();
    });
    p.querySelector('#traj-vel')?.addEventListener('input', (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      this._setText('#traj-vel-val', String(Math.round(v)));
      if (this._firePoint) this._redraw();
    });
    p.querySelector('#traj-wind-spd')?.addEventListener('input', (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      this._setText('#traj-wind-spd-val', v.toFixed(1));
      if (this._firePoint) this._redraw();
    });
    p.querySelector('#traj-wind-brg')?.addEventListener('input', (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      this._setText('#traj-wind-brg-val', `${Math.round(v)}°`);
      if (this._firePoint) this._redraw();
    });

    ['traj-azimuth', 'traj-obsht', 'traj-opt-phases', 'traj-opt-cep', 'traj-opt-coriolis', 'traj-opt-autosolve']
      .forEach(id => p.querySelector(`#${id}`)?.addEventListener('change', () => {
        if (this._firePoint) this._redraw();
      }));

    p.querySelector('#traj-pick-fire-btn')?.addEventListener('click', () => this._startFirePlacement());
    p.querySelector('#traj-pick-target-btn')?.addEventListener('click', () => this._startTargetPlacement());

    p.querySelector('#traj-clear-target-btn')?.addEventListener('click', () => {
      this._targetPoint = null;
      this._drawTargetMarker();
      this._syncPlacementUI();
      if (this._firePoint) this._redraw();
    });

    p.querySelector('#traj-clear-btn')?.addEventListener('click', () => {
      this._analysisLayer.removeAll();
      this._observerLayer.removeAll();
      this._cancelPlacement();
      this._stopAnimation();
      this._firePoint = null;
      this._targetPoint = null;
      this._currentTrajectory = null;
      this._setText('#traj-st-range', '—');
      this._setText('#traj-st-tof', '—');
      this._setText('#traj-st-alt', '—');
      const commitBtn = p.querySelector<HTMLButtonElement>('#traj-commit-btn');
      const animBtn = p.querySelector<HTMLButtonElement>('#traj-animate-btn');
      if (commitBtn) commitBtn.disabled = true;
      if (animBtn) animBtn.disabled = true;
      const scrubWrap = p.querySelector<HTMLElement>('#traj-scrub-wrap');
      if (scrubWrap) scrubWrap.hidden = true;
      this._setText('#traj-fire-coords', 'No fire point placed');
      this._setText('#traj-target-coords', 'No target set');
      this._setResultsVisible(false);
      this._syncPlacementUI();
      this._setStatus('awaiting');
      this._startFirePlacement();
    });

    p.querySelector('#traj-commit-btn')?.addEventListener('click', () => this._commit());
    p.querySelector('#traj-animate-btn')?.addEventListener('click', () => this._startAnimation());
    p.querySelector('#traj-play-btn')?.addEventListener('click', () => this._toggleAnimation());
    p.querySelector('#traj-scrubber')?.addEventListener('input', (e) => {
      this._stopAnimation(false);
      this._seekAnimation(Number((e.target as HTMLInputElement).value));
      const play = p.querySelector<HTMLButtonElement>('#traj-play-btn');
      if (play) play.textContent = '▶';
    });

    bindDisclosures(p);
  }

  private _makeDraggable(): void {
    const handle = this._panelEl?.querySelector<HTMLElement>('#traj-drag-handle');
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

  private _setStatus(state: 'awaiting' | 'placing' | 'computing' | 'ready' | 'committed' | 'error'): void {
    const dotEl = this._panelEl?.querySelector<HTMLElement>('#traj-status-dot');
    const statusTextMap: Record<typeof state, string> = { awaiting: 'Awaiting fire point', placing: this._placeMode === 'target' ? 'Pick target point' : 'Pick fire point', computing: 'Computing', ready: 'Ready', committed: 'Committed', error: 'Error' };
    const message = statusTextMap[state];
    if (state === 'ready' || state === 'committed') EngineLogger.success(ENGINE_NAME, message);
    else if (state === 'error') EngineLogger.error(ENGINE_NAME, message);
    else EngineLogger.nextStep(ENGINE_NAME, message);
    const lblEl = this._panelEl?.querySelector<HTMLElement>('#traj-status-lbl');
    if (!dotEl || !lblEl) return;
    const map: Record<string, [string, string]> = {
      awaiting: ['#555', 'Awaiting fire point'],
      placing: ['#378ADD', this._placeMode === 'target' ? 'Pick target point…' : 'Pick fire point…'],
      computing: ['#EF9F27', 'Computing…'],
      ready: ['#1D9E75', 'Ready'],
      committed: ['#1D9E75', 'Committed ✓'],
      error: ['#E24B4A', 'Error'],
    };
    const [color, label] = map[state] ?? map.awaiting;
    dotEl.style.background = color;
    dotEl.style.boxShadow = `0 0 6px ${color}88`;
    lblEl.textContent = label;
  }

  private _setText(selector: string, text: string): void {
    const el = this._panelEl?.querySelector<HTMLElement>(selector);
    if (el) el.textContent = text;
  }

  /** Show a transient tooltip bubble anchored under the "Pick Fire ⊕" button. */
  private _flashPickTooltip(message: string, anchorId = 'traj-pick-fire-btn'): void {
    const anchor = this._panelEl?.querySelector<HTMLElement>(`#${anchorId}`);
    if (!anchor) return;
    if (!this._tooltipEl) {
      const tip = document.createElement('div');
      tip.style.cssText =
        'position:fixed;z-index:1200;background:var(--ms-bg-header,#1e2434);color:var(--ms-text,#fff);' +
        'border:1px solid var(--ms-accent,#378ADD);border-radius:5px;padding:7px 10px;font-size:11px;line-height:1.4;' +
        'max-width:240px;box-shadow:var(--ms-shadow,0 6px 20px rgba(0,0,0,.45));pointer-events:none;opacity:0;transition:opacity .18s;';
      document.body.appendChild(tip);
      this._tooltipEl = tip;
    }
    const tip = this._tooltipEl;
    tip.textContent = message;
    const rect = anchor.getBoundingClientRect();
    tip.style.left = `${Math.max(8, rect.left)}px`;
    tip.style.top = `${rect.bottom + 8}px`;
    void tip.offsetWidth; // force reflow so the transition replays
    tip.style.opacity = '1';
    anchor.animate?.(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }],
      { duration: 360 },
    );
    if (this._tooltipTimer) window.clearTimeout(this._tooltipTimer);
    this._tooltipTimer = window.setTimeout(() => this._hideTooltip(), 4000);
  }

  private _hideTooltip(): void {
    if (this._tooltipTimer) {
      window.clearTimeout(this._tooltipTimer);
      this._tooltipTimer = null;
    }
    if (this._tooltipEl) this._tooltipEl.style.opacity = '0';
  }

  private _inp(id: string): HTMLInputElement | null {
    return this._panelEl?.querySelector<HTMLInputElement>(`#${id}`) ?? null;
  }

  private _setInputVal(id: string, value: number): void {
    const el = this._inp(id);
    if (el) el.value = String(value);
  }

  private _currentPreset(): ProjectilePreset {
    return PROJECTILE_PRESETS[this._presetKey()] ?? PROJECTILE_PRESETS.mortar_81mm;
  }

  private _presetKey(): string {
    return this._panelEl?.querySelector<HTMLSelectElement>('#traj-preset')?.value ?? 'mortar_81mm';
  }

  private _detectPresetType(graphic: Graphic): string {
    const attrs = graphic.attributes ?? {};
    const sidc = (attrs.sidc ?? attrs.SIDC ?? '').toString().toUpperCase();
    const t = (attrs.graphicType ?? attrs.type ?? '').toString().toLowerCase();

    if (sidc.includes('MORTAR') || t.includes('mortar')) return 'mortar_81mm';
    if (sidc.includes('ARTILLERY') || t.includes('artillery')) return 'artillery_155';
    if (sidc.includes('ATGM') || t.includes('atgm')) return 'atgm';
    if (sidc.includes('RPG') || t.includes('rpg')) return 'rpg7';
    if (sidc.includes('DRONE') || t.includes('drone') || t.includes('uav')) return 'drone_loiter';
    return 'mortar_81mm';
  }

}

export default TrajectoryEngine;

