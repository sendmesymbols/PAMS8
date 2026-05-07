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
        targetElevM,
        windSpeedMs,
        windBearingDeg,
        useCoriolis,
      });
      if (angleEl) angleEl.value = solvedAngle.toFixed(1);
      if (azEl) azEl.value = String(Math.round(solvedAzimuth));
      this._setText('#traj-angle-val', `${solvedAngle.toFixed(1)}°`);
    }

    const tempPresetKey = '__traj_tmp__';
    (PROJECTILE_PRESETS as Record<string, ProjectilePreset>)[tempPresetKey] = {
      ...preset,
      muzzleVelocity,
    };

    const result = this._integrate({
      presetKey: tempPresetKey,
      originLon: this._firePoint.longitude ?? 0,
      originLat: this._firePoint.latitude ?? 0,
      originElevM,
      bearingDeg: solvedAzimuth,
      launchAngleDeg: solvedAngle,
      windSpeedMs,
      windBearingDeg,
      targetElevM,
      useCoriolis,
    });

    delete (PROJECTILE_PRESETS as Record<string, ProjectilePreset>)[tempPresetKey];

    if (!result || result.pts.length === 0) {
      this._setStatus('error');
      return;
    }

    this._currentTrajectory = result;
    this._analysisLayer.removeAll();
    this._stopAnimation(false);

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
      const symbol = this._view?.type === '3d'
        ? {
            type: 'line-3d',
            symbolLayers: [{
              type: 'line',
              size,
              material: { color: [...color, Math.round(opacity * 255)] },
              pattern: { type: 'style', style },
              cap: 'round',
              join: 'round',
            }],
          } as any
        : {
            type: 'simple-line',
            color: [...color, Math.round(opacity * 255)],
            width: Math.max(1, Math.round(size)),
            style: style === 'dash' ? 'short-dash' : 'solid',
          } as any;

      this._analysisLayer.add(new Graphic({
        geometry: new Polyline({ hasZ: true, paths: [coords], spatialReference: { wkid: 4326 } }),
        symbol,
        attributes: { type },
      }));
    };

    if (usePhases) {
      const a = Math.max(0, Math.min(result.apogeeIdx, result.pts.length - 1));
      const t = Math.max(a, Math.min(result.termIdx, result.pts.length - 1));
      addPath(result.pts.slice(0, a + 1), [29, 158, 117], 'solid', 2.8, 0.92, 'trajectory_phase');
      addPath(result.pts.slice(a, t + 1), preset.color, 'solid', 2.6, 0.88, 'trajectory_phase');
      addPath(result.pts.slice(t), [220, 90, 48], 'dash', 2.2, 0.62, 'trajectory_phase');
    } else {
      addPath(result.pts, preset.color, 'solid', 2.7, 0.9, 'trajectory_arc');
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
        symbol: this._is3D()
          ? {
              type: 'point-3d',
              symbolLayers: [{
                type: 'object',
                resource: { primitive: 'cone' },
                material: { color: [239, 159, 39, 220] },
                width: 45,
                height: 45,
                depth: 45,
              }],
              verticalOffset: { screenLength: 22, maxWorldLength: 400, minWorldLength: 4 },
            } as any
          : {
              type: 'simple-marker',
              style: 'triangle',
              color: [239, 159, 39, 220],
              size: 10,
              outline: { color: [255, 240, 220, 220], width: 1.2 },
            } as any,
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
        symbol: this._is3D()
          ? {
              type: 'point-3d',
              symbolLayers: [{
                type: 'object',
                resource: { primitive: 'sphere' },
                material: { color: [220, 90, 48, 225] },
                width: 52,
                height: 52,
                depth: 52,
              }],
              verticalOffset: { screenLength: 20, maxWorldLength: 360, minWorldLength: 4 },
            } as any
          : {
              type: 'simple-marker',
              style: 'circle',
              color: [220, 90, 48, 225],
              size: 9,
              outline: { color: [255, 220, 220, 220], width: 1.2 },
            } as any,
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
      symbol: this._is3D()
        ? {
            type: 'point-3d',
            symbolLayers: [{
              type: 'object',
              resource: { primitive: 'diamond' },
              material: { color: [...preset.color, 235] },
              width: 56,
              height: 56,
              depth: 56,
            }],
            verticalOffset: { screenLength: 28, maxWorldLength: 450, minWorldLength: 4 },
          } as any
        : {
            type: 'simple-marker',
            style: 'diamond',
            color: [...preset.color, 235],
            size: 12,
            outline: { color: [255, 255, 255, 220], width: 1.2 },
          } as any,
      attributes: { type: 'trajectory_fire', markerRole: 'fire' },
    }));

    this._setText(
      '#traj-fire-coords',
      `Fire: ${(this._firePoint.latitude ?? 0).toFixed(5)}°N  ${(this._firePoint.longitude ?? 0).toFixed(5)}°E`
    );
  }

  private _drawTargetMarker(): void {
    this._observerLayer.graphics
      .filter((g: Graphic) => g.attributes?.markerRole === 'target')
      .forEach((g: Graphic) => this._observerLayer.remove(g));

    if (!this._targetPoint) {
      this._setText('#traj-target-coords', 'Target: not set');
      return;
    }

    this._observerLayer.add(new Graphic({
      geometry: new Point({
        longitude: this._targetPoint.longitude,
        latitude: this._targetPoint.latitude,
        z: (this._targetPoint.z ?? 0) + 1,
        spatialReference: { wkid: 4326 },
      }),
      symbol: this._is3D()
        ? {
            type: 'point-3d',
            symbolLayers: [{
              type: 'object',
              resource: { primitive: 'cone' },
              material: { color: [220, 90, 48, 235] },
              width: 56,
              height: 80,
              depth: 56,
            }],
            verticalOffset: { screenLength: 28, maxWorldLength: 450, minWorldLength: 4 },
          } as any
        : {
            type: 'simple-marker',
            style: 'triangle',
            color: [220, 90, 48, 235],
            size: 12,
            outline: { color: [255, 240, 230, 220], width: 1.2 },
          } as any,
      attributes: { type: 'trajectory_target', markerRole: 'target' },
    }));

    this._setText(
      '#traj-target-coords',
      `Target: ${(this._targetPoint.latitude ?? 0).toFixed(5)}°N  ${(this._targetPoint.longitude ?? 0).toFixed(5)}°E`
    );
  }

  // ─── Private: Placement ─────────────────────────────────────────────────────

  private _startFirePlacement(): void {
    if (!this._view) return;
    this._cancelPlacement();
    this._placeMode = 'fire';
    this._setStatus('placing');
    this._clickHandle = this._view.on('click', async (event: any) => {
      this._cancelPlacement();
      const pt = await this._pickMapPoint(event);
      this._firePoint = pt;
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
    this._setStatus('placing');
    this._clickHandle = this._view.on('click', async (event: any) => {
      this._cancelPlacement();
      const pt = await this._pickMapPoint(event);
      this._targetPoint = pt;
      this._drawTargetMarker();
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

  private _cancelPlacement(): void {
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

    scrubWrap.style.display = 'flex';
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
      symbol: this._is3D()
        ? {
            type: 'point-3d',
            symbolLayers: [{
              type: 'object',
              resource: { primitive: 'sphere' },
              material: { color: [...preset.color, 242] },
              width: 34,
              height: 34,
              depth: 34,
            }],
          } as any
        : {
            type: 'simple-marker',
            style: 'circle',
            color: [...preset.color, 242],
            size: 8,
            outline: { color: [255, 255, 255, 200], width: 1.2 },
          } as any,
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
    let idx = Number(scrub.value);
    const total = this._currentTrajectory.pts.length;

    const step = () => {
      if (!this._animRunning || idx >= total) {
        this._animRunning = false;
        playBtn.textContent = '▶';
        this._animFrame = null;
        return;
      }
      this._seekAnimation(idx++);
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
      this._panelEl.className = 'traj-panel';
      document.body.appendChild(this._panelEl);
    }

    const preset = PROJECTILE_PRESETS[defaultPreset] ?? PROJECTILE_PRESETS.mortar_81mm;
    this._panelEl.style.setProperty('--traj-accent', preset.accentHex);
    this._panelEl.innerHTML = this._buildPanelHTML(defaultPreset, preset, override);
    this._panelEl.style.display = 'block';
    this._bindPanelEvents();
    this._makeDraggable();
    this._setText('#traj-fire-coords', this._firePoint
      ? `Fire: ${(this._firePoint.latitude ?? 0).toFixed(5)}°N  ${(this._firePoint.longitude ?? 0).toFixed(5)}°E`
      : 'Fire: click map to place');
    this._setText('#traj-target-coords', this._targetPoint
      ? `Target: ${(this._targetPoint.latitude ?? 0).toFixed(5)}°N  ${(this._targetPoint.longitude ?? 0).toFixed(5)}°E`
      : 'Target: not set');
  }

  private _hidePanel(): void {
    if (this._panelEl) this._panelEl.style.display = 'none';
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
      <div class="traj-header" id="traj-drag-handle">
        <span class="traj-header-icon">📈</span>
        <span class="traj-header-title">Trajectory Analysis${isEdit ? ' — Re-edit' : ''}</span>
        <span class="traj-status-dot" id="traj-status-dot"></span>
        <span class="traj-status-lbl" id="traj-status-lbl">${isEdit ? 'Restored' : 'Awaiting fire point'}</span>
        <button class="traj-close-btn" id="traj-close-btn" title="Minimise (keeps working graphics)">–</button>
      </div>

      <div class="traj-body">
        <div class="traj-sec">Projectile</div>
        <div class="traj-field-full">
          <select id="traj-preset" class="traj-select">${options}</select>
        </div>

        <div class="traj-divider"></div>
        <div class="traj-sec">Launch</div>
        <div class="traj-slider-row">
          <span class="traj-label">Launch angle (°)</span>
          <input id="traj-angle" type="range" min="0" max="89" step="0.5" value="${launchAngle}" class="traj-slider" />
          <span class="traj-slider-val" id="traj-angle-val">${Number(launchAngle).toFixed(1)}°</span>
        </div>
        <div class="traj-slider-row">
          <span class="traj-label">Muzzle vel (m/s)</span>
          <input id="traj-vel" type="range" min="20" max="1200" step="1" value="${muzzleVel}" class="traj-slider" />
          <span class="traj-slider-val" id="traj-vel-val">${Math.round(muzzleVel)}</span>
        </div>
        <div class="traj-grid">
          <div class="traj-field">
            <div class="traj-label">Azimuth (°)</div>
            <input id="traj-azimuth" class="traj-input" type="number" min="0" max="359" step="1" value="${Math.round(azimuth)}" />
          </div>
          <div class="traj-field">
            <div class="traj-label">Obs height (m)</div>
            <input id="traj-obsht" class="traj-input" type="number" min="0" max="100" step="0.5" value="${obsHeight}" />
          </div>
        </div>

        <div class="traj-divider"></div>
        <div class="traj-sec">Wind</div>
        <div class="traj-slider-row">
          <span class="traj-label">Speed (m/s)</span>
          <input id="traj-wind-spd" type="range" min="0" max="40" step="0.5" value="${windSpeed}" class="traj-slider" />
          <span class="traj-slider-val" id="traj-wind-spd-val">${Number(windSpeed).toFixed(1)}</span>
        </div>
        <div class="traj-slider-row">
          <span class="traj-label">From bearing (°)</span>
          <input id="traj-wind-brg" type="range" min="0" max="359" step="1" value="${Math.round(windBearing)}" class="traj-slider" />
          <span class="traj-slider-val" id="traj-wind-brg-val">${Math.round(windBearing)}°</span>
        </div>

        <div class="traj-divider"></div>
        <div class="traj-sec">Placement</div>
        <div class="traj-grid">
          <div class="traj-field">
            <button class="traj-btn traj-btn-sm" id="traj-pick-fire-btn">Pick Fire ⊕</button>
          </div>
          <div class="traj-field">
            <button class="traj-btn traj-btn-sm" id="traj-pick-target-btn">Pick Target ⊕</button>
          </div>
        </div>
        <div class="traj-grid">
          <div class="traj-field">
            <button class="traj-btn traj-btn-sm" id="traj-clear-target-btn">Clear Target</button>
          </div>
          <div class="traj-field"></div>
        </div>
        <div class="traj-coords" id="traj-fire-coords">Fire: click map to place</div>
        <div class="traj-coords" id="traj-target-coords">Target: not set</div>

        <div class="traj-divider"></div>
        <div class="traj-sec">Display</div>
        <div class="traj-toggle-row">
          <label class="traj-label">Phase colouring</label>
          <input id="traj-opt-phases" type="checkbox" class="traj-check"${usePhases ? ' checked' : ''} />
        </div>
        <div class="traj-toggle-row">
          <label class="traj-label">Show CEP ring</label>
          <input id="traj-opt-cep" type="checkbox" class="traj-check"${showCEP ? ' checked' : ''} />
        </div>
        <div class="traj-toggle-row">
          <label class="traj-label">Coriolis effect</label>
          <input id="traj-opt-coriolis" type="checkbox" class="traj-check"${useCoriolis ? ' checked' : ''} />
        </div>
        <div class="traj-toggle-row">
          <label class="traj-label">Auto-solve angle to target</label>
          <input id="traj-opt-autosolve" type="checkbox" class="traj-check" />
        </div>

        <div class="traj-divider"></div>
        <div class="traj-stats">
          <div class="traj-stat"><div class="traj-stat-val" id="traj-st-range">—</div><div class="traj-stat-lbl">Range (m)</div></div>
          <div class="traj-stat"><div class="traj-stat-val" id="traj-st-tof">—</div><div class="traj-stat-lbl">TOF (s)</div></div>
          <div class="traj-stat"><div class="traj-stat-val" id="traj-st-alt">—</div><div class="traj-stat-lbl">Apex (m)</div></div>
        </div>

        <div class="traj-legend">
          <span class="traj-leg-launch">Launch</span>
          <span class="traj-leg-flight">Flight</span>
          <span class="traj-leg-terminal">Terminal</span>
          <span class="traj-leg-apogee">Apogee</span>
          <span class="traj-leg-impact">Impact / CEP</span>
        </div>

        <div class="traj-btn-row">
          <button class="traj-btn" id="traj-clear-btn">Clear</button>
          <button class="traj-btn" id="traj-animate-btn" disabled>Animate ▶</button>
          <button class="traj-btn traj-btn-primary" id="traj-commit-btn" ${isEdit ? '' : 'disabled'}>Commit ↗</button>
        </div>

        <div class="traj-scrub-wrap" id="traj-scrub-wrap" style="display:none">
          <span class="traj-label">T+</span>
          <input id="traj-scrubber" class="traj-slider" type="range" min="0" max="0" value="0" step="1" />
          <span id="traj-scrub-time" class="traj-slider-val">0.00 s</span>
          <button class="traj-btn traj-btn-sm" id="traj-play-btn">▶</button>
        </div>
      </div>
    `;
  }

  private _bindPanelEvents(): void {
    if (!this._panelEl) return;
    const p = this._panelEl;

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
      if (scrubWrap) scrubWrap.style.display = 'none';
      this._setText('#traj-fire-coords', 'Fire: click map to place');
      this._setText('#traj-target-coords', 'Target: not set');
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
    this._panelEl.style.left = `${Math.max(0, e.clientX - this._dragOffsetX)}px`;
    this._panelEl.style.top = `${Math.max(0, e.clientY - this._dragOffsetY)}px`;
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

  // ─── Private: Styles ────────────────────────────────────────────────────────

  private _injectStyles(): void {
    if (document.getElementById('trajectory-engine-styles')) return;
    const style = document.createElement('style');
    style.id = 'trajectory-engine-styles';
    style.textContent = `
      .traj-panel {
        position: fixed;
        top: 60px;
        left: 602px;
        width: 292px;
        background: rgba(16, 18, 24, 0.97);
        border: 1px solid color-mix(in srgb, var(--traj-accent, #BA7517) 42%, transparent);
        border-radius: 6px;
        color: #b8c5d8;
        font-family: 'SF Mono', 'Consolas', 'Courier New', monospace;
        font-size: 11px;
        z-index: 1100;
        user-select: none;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.65), inset 0 0 0 1px rgba(255, 255, 255, 0.04);
        display: none;
        animation: trajPanelIn 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      @keyframes trajPanelIn {
        from { opacity: 0; transform: scale(0.94) translateY(-8px); }
        to   { opacity: 1; transform: scale(1) translateY(0); }
      }
      .traj-header {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 9px 10px 8px;
        border-bottom: 1px solid rgba(255,255,255,0.07);
        background: rgba(255,255,255,0.04);
        border-radius: 5px 5px 0 0;
        cursor: grab;
      }
      .traj-header:active { cursor: grabbing; }
      .traj-header-icon { font-size: 15px; flex-shrink: 0; }
      .traj-header-title {
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--traj-accent, #BA7517);
        font-weight: 700;
        flex: 1;
      }
      .traj-status-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #555;
        transition: background 0.3s, box-shadow 0.3s;
      }
      .traj-status-lbl {
        font-size: 8.5px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #5a6a80;
        min-width: 62px;
      }
      .traj-close-btn {
        background: none;
        border: none;
        color: #4a5a78;
        font-size: 13px;
        cursor: pointer;
        padding: 0 2px;
        line-height: 1;
      }
      .traj-close-btn:hover { color: #c0c8e0; }
      .traj-body { padding: 0 0 6px; }
      .traj-sec {
        font-size: 8.5px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: #3a5070;
        padding: 9px 12px 4px;
      }
      .traj-divider {
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.07), transparent);
        margin: 4px 0;
      }
      .traj-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 7px;
        padding: 0 10px 8px;
      }
      .traj-field { display: flex; flex-direction: column; gap: 3px; }
      .traj-field-full { padding: 0 10px 8px; }
      .traj-label {
        font-size: 8.5px;
        letter-spacing: 0.07em;
        text-transform: uppercase;
        color: #5a7090;
      }
      .traj-input, .traj-select {
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 3px;
        color: #c0cce0;
        font-family: inherit;
        font-size: 11px;
        padding: 5px 7px;
        width: 100%;
        outline: none;
        transition: border-color 0.15s;
      }
      .traj-input:focus, .traj-select:focus { border-color: var(--traj-accent, #BA7517); }
      .traj-select option { background: #12141a; }
      .traj-slider-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 2px 10px 6px;
      }
      .traj-slider-row .traj-label { flex: 1; }
      .traj-slider {
        flex: 2;
        accent-color: var(--traj-accent, #BA7517);
        cursor: pointer;
      }
      .traj-slider-val {
        font-size: 10px;
        color: var(--traj-accent, #BA7517);
        min-width: 40px;
        text-align: right;
      }
      .traj-toggle-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 12px;
      }
      .traj-check {
        accent-color: var(--traj-accent, #BA7517);
        width: 13px;
        height: 13px;
        cursor: pointer;
      }
      .traj-coords {
        font-size: 9px;
        color: #378ADD;
        padding: 1px 12px 5px;
        letter-spacing: 0.04em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .traj-stats {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 1px;
        padding: 8px 10px 6px;
      }
      .traj-legend {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        padding: 0 10px 8px;
      }
      .traj-legend span {
        font-size: 8px;
        letter-spacing: 0.07em;
        text-transform: uppercase;
      }
      .traj-leg-launch { color: #1D9E75; }
      .traj-leg-flight { color: #BA7517; }
      .traj-leg-terminal { color: #DC5A30; }
      .traj-leg-apogee { color: #EF9F27; }
      .traj-leg-impact { color: #E24B4A; }
      .traj-stat { display: flex; flex-direction: column; gap: 2px; }
      .traj-stat-val {
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.03em;
        color: var(--traj-accent, #BA7517);
      }
      .traj-stat-lbl {
        font-size: 8.5px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #506078;
      }
      .traj-btn-row {
        display: flex;
        gap: 6px;
        padding: 6px 10px 4px;
      }
      .traj-btn {
        flex: 1;
        padding: 6px 4px;
        font-family: inherit;
        font-size: 9.5px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        cursor: pointer;
        border-radius: 3px;
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(255,255,255,0.04);
        color: #8a9ab8;
        transition: all 0.14s;
      }
      .traj-btn:hover { background: rgba(255,255,255,0.1); color: #d0daf0; }
      .traj-btn:disabled { opacity: 0.3; cursor: not-allowed; }
      .traj-btn-primary {
        border-color: var(--traj-accent, #BA7517);
        color: var(--traj-accent, #BA7517);
        background: rgba(186,117,23,0.1);
      }
      .traj-btn-primary:hover { background: rgba(186,117,23,0.22); color: #fff; }
      .traj-btn-sm {
        flex: 0 0 auto;
        padding: 4px 8px;
        font-size: 9px;
      }
      .traj-scrub-wrap {
        display: none;
        align-items: center;
        gap: 8px;
        padding: 6px 10px 4px;
      }
    `;
    document.head.appendChild(style);
  }
}

export default TrajectoryEngine;
