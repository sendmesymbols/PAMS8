/**
 * WeaponEffectEngine.ts
 * Weapon Effect Zone analysis engine.
 *
 * Integrated with ContextMenuManager via linkWeaponEffectEngine().
 * Right-clicking any military symbol → Analysis → Weapon Effect Zone
 * opens this panel with the symbol's location as the observer origin.
 *
 * Uses three private GraphicsLayers:
 *   wez-analysis   — live working layer (cleared on every redraw)
 *   wez-observer   — observer marker
 *   wez-committed  — persisted results after "Commit"
 */

import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polygon from '@arcgis/core/geometry/Polygon';
import Polyline from '@arcgis/core/geometry/Polyline';
import * as geometryEngine from '@arcgis/core/geometry/geometryEngine';
import Mesh from '@arcgis/core/geometry/Mesh';
import { ElevationUtils } from '../../Support/Elevation/ElevationUtils';
import EngineLogger from '../../Support/EngineLogger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WeaponPreset {
  label: string;
  minRangeM: number;
  maxRangeM: number;
  azimuthSpreadDeg: number;
  elevMinDeg: number;
  elevMaxDeg: number;
  extrudeHeightFactor: number;
  color: [number, number, number];
  accentHex: string;
  icon: string;
}

interface WEZParams {
  observerPoint: Point;
  minRangeM: number;
  maxRangeM: number;
  azimuthCenterDeg: number;
  azimuthSpreadDeg: number;
  elevMaxDeg: number;
}

interface WEZPanelOverride {
  minRange?: number;
  maxRange?: number;
  azimuth?: number;
  spread?: number;
  elevMin?: number;
  elevMax?: number;
  obsHeight?: number;
  fillOpacity?: number;
}

interface WEZResult {
  zone: Polygon | null;
  minRing: Polygon | null;
  maxRing: Polygon | null;
  extrudeHeightM: number;
  preset: WeaponPreset;
}

// ─── Weapon Presets ───────────────────────────────────────────────────────────

export const WEAPON_PRESETS: Record<string, WeaponPreset> = {
  direct_fire: {
    label: 'Direct Fire',
    minRangeM: 50,
    maxRangeM: 3000,
    azimuthSpreadDeg: 90,
    elevMinDeg: -5,
    elevMaxDeg: 10,
    extrudeHeightFactor: 0.05,
    color: [220, 90, 48],
    accentHex: '#dc5a30',
    icon: 'GUN',
  },
  mortar: {
    label: 'Mortar',
    minRangeM: 70,
    maxRangeM: 5600,
    azimuthSpreadDeg: 360,
    elevMinDeg: 45,
    elevMaxDeg: 85,
    extrudeHeightFactor: 2.75,
    color: [239, 159, 39],
    accentHex: '#EF9F27',
    icon: 'BMB',
  },
  artillery: {
    label: 'Artillery 155mm',
    minRangeM: 3000,
    maxRangeM: 30000,
    azimuthSpreadDeg: 180,
    elevMinDeg: 15,
    elevMaxDeg: 65,
    extrudeHeightFactor: 1.43,
    color: [186, 117, 23],
    accentHex: '#BA7517',
    icon: 'AT',
  },
  atgm: {
    label: 'ATGM',
    minRangeM: 75,
    maxRangeM: 5500,
    azimuthSpreadDeg: 60,
    elevMinDeg: -10,
    elevMaxDeg: 20,
    extrudeHeightFactor: 0.18,
    color: [220, 90, 48],
    accentHex: '#dc5a30',
    icon: 'RKT',
  },
  anti_air: {
    label: 'Anti-Air',
    minRangeM: 200,
    maxRangeM: 8000,
    azimuthSpreadDeg: 360,
    elevMinDeg: 15,
    elevMaxDeg: 90,
    extrudeHeightFactor: 9.5,
    color: [55, 138, 221],
    accentHex: '#378ADD',
    icon: 'DEF',
  },
  anti_armor: {
    label: 'Anti-Armor',
    minRangeM: 100,
    maxRangeM: 4000,
    azimuthSpreadDeg: 120,
    elevMinDeg: -5,
    elevMaxDeg: 15,
    extrudeHeightFactor: 0.1,
    color: [226, 75, 74],
    accentHex: '#E24B4A',
    icon: '⚔️',
  },
};
const ENGINE_NAME = 'WeaponEffectEngine';

// ─── Engine ───────────────────────────────────────────────────────────────────

export class WeaponEffectEngine {

  static readonly ANALYSIS_LAYER_ID  = 'wez-analysis';
  static readonly COMMITTED_LAYER_ID = 'wez-committed';
  static readonly OBSERVER_LAYER_ID  = 'wez-observer';

  private _view: MapView | SceneView | null = null;
  private _analysisLayer!: GraphicsLayer;
  private _committedLayer!: GraphicsLayer;
  private _observerLayer!: GraphicsLayer;

  private _observerPoint: Point | null = null;
  private _panelEl: HTMLDivElement | null = null;
  private _repositionHandle: any = null;

  // Draggable panel state
  private _dragOffsetX = 0;
  private _dragOffsetY = 0;
  private _isDragging = false;

  // Transient "pick a location" tooltip state
  private _tooltipEl: HTMLDivElement | null = null;
  private _tooltipTimer: number | null = null;

  constructor() {
    this._createLayers();
    this._injectStyles();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  initialize(view: MapView | SceneView): void {
    if (this._view === view) return;
    this._view = view;
    // Ensure layers are on this view's map
    const map = view.map as any;
    if (map && !map.findLayerById(this._analysisLayer.id)) {
      map.addMany([this._committedLayer, this._analysisLayer, this._observerLayer]);
    }
  }

  /** Called by ContextMenuManager when "Weapon Effect Zone" is clicked. */
  open(graphic?: Graphic | null, view?: MapView | SceneView): void {
    if (view) this.initialize(view);
    const attrs = graphic?.attributes ?? {};

    // ── Re-edit mode: graphic is a previously committed WEZ zone ──────────────
    if (attrs.type === 'wez_zone' && attrs.committedAt != null) {
      this._analysisLayer.removeAll();
      this._observerLayer.removeAll();

      if (attrs.observerLon != null && attrs.observerLat != null) {
        this._observerPoint = new Point({
          longitude: attrs.observerLon,
          latitude: attrs.observerLat,
          spatialReference: { wkid: 4326 },
        });
      }

      const override: WEZPanelOverride = {
        minRange:    attrs.minRangeM        ?? undefined,
        maxRange:    attrs.maxRangeM        ?? undefined,
        azimuth:     attrs.azimuthCenterDeg ?? undefined,
        spread:      attrs.azimuthSpreadDeg ?? undefined,
        elevMax:     attrs.elevMaxDeg       ?? undefined,
        fillOpacity: attrs.fillOpacity      ?? undefined,
      };
      const weaponKey: string = attrs.weaponType ?? 'mortar';

      this._showPanel(weaponKey, override);
      if (this._observerPoint) {
        this._drawObserver();
        this._redraw();
      }
      return;
    }

    // ── Resume mode: panel was minimised (hidden) with working state intact ───
    if (this._panelEl && this._observerPoint &&
        this._panelEl.style.display === 'none') {
      this._panelEl.style.display = 'block';
      return;
    }

    // ── Normal mode: new observer from graphic geometry ───────────────────────
    const geom = graphic?.geometry;
    if (geom?.type === 'point') {
      this._observerPoint = geom as Point;
    } else if ((geom as any)?.centroid) {
      this._observerPoint = (geom as any).centroid as Point;
    } else {
      this._observerPoint = null;
    }

    const detectedWeapon = graphic ? this._detectWeaponType(graphic) : 'mortar';
    this._showPanel(detectedWeapon);

    if (this._observerPoint) {
      this._drawObserver();
      this._redraw();
    } else {
      // Opened with no symbol — let the user place the observer on the map.
      this._setStatus('awaiting');
      this._startReposition();
      //this._flashPickTooltip('No symbol — type a Lat/Lon and press Go, or click the map to place the firing point.');
    }
  }

  close(): void {
    this._hidePanel();
    this._hideTooltip();
    this._analysisLayer.removeAll();
    this._observerLayer.removeAll();
    this._cancelReposition();
    this._observerPoint = null;
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
      id: WeaponEffectEngine.ANALYSIS_LAYER_ID,
      title: 'WEZ — Working',
      elevationInfo: { mode: 'on-the-ground' } as any,
    });
    this._committedLayer = new GraphicsLayer({
      id: WeaponEffectEngine.COMMITTED_LAYER_ID,
      title: 'WEZ — Committed',
      elevationInfo: { mode: 'on-the-ground' } as any,
    });
    this._observerLayer = new GraphicsLayer({
      id: WeaponEffectEngine.OBSERVER_LAYER_ID,
      title: 'WEZ — Observer',
      elevationInfo: { mode: 'on-the-ground' } as any,
    });
  }

  // ─── Private: Geometry ──────────────────────────────────────────────────────

  private _destinationPoint(
    lon: number, lat: number, bearingDeg: number, distanceM: number
  ): { longitude: number; latitude: number } {
    const R = 6_371_008.8;
    const δ = distanceM / R;
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

  private _buildAzimuthWedge(
    origin: Point, azimuthCenterDeg: number, azimuthSpreadDeg: number, radiusM: number
  ): Polygon {
    const steps = Math.max(3, Math.ceil(Math.abs(azimuthSpreadDeg)));
    const oLon = origin.longitude ?? 0;
    const oLat = origin.latitude ?? 0;
    const ring: number[][] = [[oLon, oLat]];
    for (let i = 0; i <= steps; i++) {
      const bearing = (azimuthCenterDeg - azimuthSpreadDeg / 2) + (i / steps) * azimuthSpreadDeg;
      const pt = this._destinationPoint(oLon, oLat, bearing, radiusM);
      ring.push([pt.longitude, pt.latitude]);
    }
    ring.push([oLon, oLat]);
    return new Polygon({ rings: [ring], spatialReference: { wkid: 4326 } });
  }

  private _computeWEZ(params: WEZParams): WEZResult {
    const { observerPoint, minRangeM, maxRangeM, azimuthCenterDeg, azimuthSpreadDeg, elevMaxDeg } = params;
    const preset = this._currentPreset();

    const minRingRaw = geometryEngine.geodesicBuffer(observerPoint, minRangeM, 'meters');
    const maxRingRaw = geometryEngine.geodesicBuffer(observerPoint, maxRangeM, 'meters');

    const minRing = Array.isArray(minRingRaw) ? minRingRaw[0] as Polygon : minRingRaw as Polygon;
    const maxRing = Array.isArray(maxRingRaw) ? maxRingRaw[0] as Polygon : maxRingRaw as Polygon;

    if (!maxRing) return { zone: null, minRing: null, maxRing: null, extrudeHeightM: 0, preset };

    const wedge = this._buildAzimuthWedge(observerPoint, azimuthCenterDeg, azimuthSpreadDeg, maxRangeM * 1.02);
    const clipped = azimuthSpreadDeg >= 360
      ? maxRing
      : (geometryEngine.intersect(maxRing, wedge) as Polygon | null) ?? maxRing;

    const zone = (minRangeM > 0 && minRing)
      ? (geometryEngine.difference(clipped, minRing) as Polygon | null)
      : clipped;

    // Clamp non-negative: depressed-elevation weapons (negative elevMax) would
    // otherwise produce a negative extrude height that gets persisted into the
    // graphic attributes (meaningless in 2D, bad data for any downstream consumer).
    const extrudeHeightM = Math.max(
      0,
      Math.min(maxRangeM * Math.tan((elevMaxDeg * Math.PI) / 180), 50_000)
    );

    return { zone, minRing, maxRing, extrudeHeightM, preset };
  }

  // ─── Private: Symbols ───────────────────────────────────────────────────────

  private _is3D(): boolean {
    return this._view?.type === '3d';
  }

  /** Returns fill alpha (0-1) from the panel's fill-opacity slider. */
  private _getFillAlpha(): number {
    const pct = Number(this._inp('wez-fill-opacity')?.value ?? 22);
    return Math.max(0, Math.min(1, pct / 100));
  }

  private _wezZoneSymbol(color: [number, number, number], extrudeM: number): any {
    const [r, g, b] = color;
    const alpha = this._getFillAlpha();
    const alphaI = Math.round(alpha * 255);
    if (this._is3D()) {
      const layers: any[] = [{
        type: 'fill',
        material: { color: [r, g, b, alphaI] },
        outline: { color: [r, g, b, 210], size: 1.8 },
      }];
      if (extrudeM > 0 && this._panelEl) {
        const extrudeCheck = this._panelEl.querySelector<HTMLInputElement>('#wez-opt-extrude');
        if (extrudeCheck?.checked) {
          layers.push({
            type: 'extrude',
            material: { color: [r, g, b, Math.round(alphaI * 0.55)] },
            edges: { type: 'solid', color: [r, g, b, 60], size: 0.5 },
            size: extrudeM,
          });
        }
      }
      return { type: 'polygon-3d', symbolLayers: layers } as any;
    }
    return {
      type: 'simple-fill',
      color: [r, g, b, alphaI],
      outline: { color: [r, g, b, 220], width: 1.8 },
    } as any;
  }

  private _deadZoneSymbol(): any {
    if (this._is3D()) {
      return {
        type: 'polygon-3d',
        symbolLayers: [{
          type: 'fill',
          material: { color: [30, 30, 40, 100] },
          outline: { color: [130, 130, 140, 140], size: 1 },
        }],
      } as any;
    }
    return {
      type: 'simple-fill',
      color: [30, 30, 40, 80],
      outline: { color: [130, 130, 140, 160], width: 1 },
    } as any;
  }

  private _maskedSectorSymbol(): any {
    if (this._is3D()) {
      return {
        type: 'polygon-3d',
        symbolLayers: [{
          type: 'fill',
          material: { color: [50, 50, 60, 110] },
          outline: { color: [100, 100, 110, 120], size: 0.8 },
        }],
      } as any;
    }
    return {
      type: 'simple-fill',
      color: [50, 50, 60, 90],
      outline: { color: [100, 100, 110, 130], width: 0.8, style: 'dash' },
    } as any;
  }

  private _rangeRingSymbol(color: [number, number, number], opacity: number): any {
    const [r, g, b] = color;
    if (this._is3D()) {
      return {
        type: 'polygon-3d',
        symbolLayers: [{
          type: 'fill',
          material: { color: [r, g, b, 0] },
          outline: { color: [r, g, b, Math.round(opacity * 255)], size: 0.8 },
        }],
      } as any;
    }
    return {
      type: 'simple-fill',
      color: [r, g, b, 0],
      outline: { color: [r, g, b, Math.round(opacity * 255)], width: 0.8, style: 'short-dash' },
    } as any;
  }

  // ─── Private: Dome Mesh ─────────────────────────────────────────────────────

  /**
   * Builds a geodesic spherical-shell sector mesh representing the 3D weapon
   * engagement envelope. Replaces the flat polygon + extrude approach in 3D.
   *
   * Shape: a sector of a spherical shell bounded by:
   *   • azimuth  : azimuthCenterDeg ± azimuthSpreadDeg/2
   *   • elevation: elevMinDeg → elevMaxDeg
   *   • range    : minRangeM  → maxRangeM  (hollow shell; or solid cone if min=0)
   *
   * Vertex positions are computed geodesically via _destinationPoint(), so the
   * mesh is accurate at any scale. Vertex colours provide an elevation gradient.
   */
  private _buildWEZDomeMesh(
    observerPoint: Point,
    minRangeM: number,
    maxRangeM: number,
    azimuthCenterDeg: number,
    azimuthSpreadDeg: number,
    elevMinDeg: number,
    elevMaxDeg: number,
    color: [number, number, number],
    alpha: number
  ): any | null {
    if (maxRangeM <= 0 || elevMaxDeg <= elevMinDeg) return null;

    const is360   = azimuthSpreadDeg >= 360;
    const azSpan  = is360 ? 360 : azimuthSpreadDeg;
    const azStart = azimuthCenterDeg - azSpan / 2;
    const oLon    = observerPoint.longitude ?? 0;
    const oLat    = observerPoint.latitude  ?? 0;
    const oZ      = (observerPoint as any).z ?? 0;
    const [r, g, b] = color;
    const ai255   = Math.round(alpha * 255);

    // ~5° resolution, clamped to sensible min steps
    const AZ_STEPS = is360
      ? Math.max(36, Math.ceil(360 / 5))
      : Math.max(6,  Math.ceil(azSpan / 5));
    const EL_STEPS = Math.max(4, Math.ceil((elevMaxDeg - elevMinDeg) / 5));

    const pos: number[] = [];  // flat [lon, lat, z, …]
    const clr: number[] = [];  // flat [r, g, b, a, …]
    const tri: number[] = [];  // triangle vertex-index triplets
    let vi = 0;

    const pushVert = (lon: number, lat: number, z: number,
                      vr: number, vg: number, vb: number, va: number): number => {
      pos.push(lon, lat, z);
      clr.push(
        Math.min(255, Math.max(0, Math.round(vr))),
        Math.min(255, Math.max(0, Math.round(vg))),
        Math.min(255, Math.max(0, Math.round(vb))),
        Math.min(255, Math.max(0, Math.round(va)))
      );
      return vi++;
    };

    // Build a [EL_STEPS+1][colCount] grid of vertex indices for a spherical
    // shell at `rangeM`. `dimFactor` scales both brightness and alpha.
    const buildShell = (rangeM: number, dimFactor: number): number[][] => {
      const colCount = is360 ? AZ_STEPS : AZ_STEPS + 1;
      const grid: number[][] = [];
      for (let ei = 0; ei <= EL_STEPS; ei++) {
        const el     = elevMinDeg + (ei / EL_STEPS) * (elevMaxDeg - elevMinDeg);
        const elRad  = (el * Math.PI) / 180;
        const hDist  = rangeM * Math.cos(elRad);   // horizontal ground distance
        const vH     = rangeM * Math.sin(elRad);   // height above observer
        const bright = (0.55 + 0.45 * (ei / EL_STEPS)) * dimFactor;
        const row: number[] = [];
        for (let ai = 0; ai < colCount; ai++) {
          const az = azStart + (ai / AZ_STEPS) * azSpan;
          const { longitude, latitude } =
            this._destinationPoint(oLon, oLat, az, Math.max(1, Math.abs(hDist)));
          row.push(pushVert(
            longitude, latitude, oZ + vH,
            r * bright, g * bright, b * bright,
            Math.round(ai255 * dimFactor)
          ));
        }
        grid.push(row);
      }
      return grid;
    };

    // Tessellate a shell grid into two triangles per quad.
    const tessellate = (grid: number[][], flip: boolean) => {
      for (let ei = 0; ei < EL_STEPS; ei++) {
        for (let ai = 0; ai < AZ_STEPS; ai++) {
          const nai = is360 ? (ai + 1) % AZ_STEPS : ai + 1;
          const tl = grid[ei][ai],    tr = grid[ei][nai];
          const bl = grid[ei + 1][ai], br = grid[ei + 1][nai];
          flip
            ? tri.push(tl, bl, tr,  tr, bl, br)
            : tri.push(tl, tr, bl,  tr, br, bl);
        }
      }
    };

    // Outer and optional inner shells
    const outer = buildShell(maxRangeM, 1.0);
    tessellate(outer, false);
    const inner = minRangeM > 0 ? buildShell(minRangeM, 0.55) : null;
    if (inner) tessellate(inner, true);

    // Top annular cap (at elevMaxDeg) — only needed when inner shell exists.
    // When inner = null and elevMaxDeg < 90° the top ring stays open (a
    // correct representation of a direct-fire or flat-trajectory envelope).
    const topO = outer[EL_STEPS];
    const topI = inner?.[EL_STEPS] ?? null;
    if (topI) {
      for (let ai = 0; ai < AZ_STEPS; ai++) {
        const nai = is360 ? (ai + 1) % AZ_STEPS : ai + 1;
        tri.push(topO[ai], topO[nai], topI[ai],
                 topI[ai], topO[nai], topI[nai]);
      }
    }

    // Bottom cap (at elevMinDeg) — fan to observer, or annular ring.
    const botO = outer[0];
    const botI = inner?.[0] ?? null;
    const obsVert = pushVert(oLon, oLat, oZ, r, g, b, Math.round(ai255 * 0.8));
    for (let ai = 0; ai < AZ_STEPS; ai++) {
      const nai = is360 ? (ai + 1) % AZ_STEPS : ai + 1;
      if (botI) {
        tri.push(botO[ai], botI[ai], botO[nai],
                 botI[ai], botI[nai], botO[nai]);
      } else {
        tri.push(botO[ai], obsVert, botO[nai]);
      }
    }
    if (botI) {
      for (let ai = 0; ai < AZ_STEPS; ai++) {
        const nai = is360 ? (ai + 1) % AZ_STEPS : ai + 1;
        tri.push(botI[ai], botI[nai], obsVert);
      }
    }

    // Side caps for non-360° wedge (left face at azStart, right face at azEnd).
    if (!is360) {
      const addCap = (outerCol: number[], innerCol: number[] | null, flip: boolean) => {
        const apex = pushVert(oLon, oLat, oZ, r, g, b, Math.round(ai255 * 0.7));
        if (innerCol) {
          for (let ei = 0; ei < EL_STEPS; ei++) {
            flip
              ? tri.push(outerCol[ei], outerCol[ei + 1], innerCol[ei],
                         innerCol[ei], outerCol[ei + 1], innerCol[ei + 1])
              : tri.push(outerCol[ei], innerCol[ei], outerCol[ei + 1],
                         innerCol[ei], innerCol[ei + 1], outerCol[ei + 1]);
          }
        } else {
          for (let ei = 0; ei < EL_STEPS; ei++) {
            flip
              ? tri.push(outerCol[ei], outerCol[ei + 1], apex)
              : tri.push(outerCol[ei], apex, outerCol[ei + 1]);
          }
        }
      };
      const last = AZ_STEPS; // AZ_STEPS+1 columns for sector → last index = AZ_STEPS
      addCap(outer.map(row => row[0]),    inner?.map(row => row[0])    ?? null, false);
      addCap(outer.map(row => row[last]), inner?.map(row => row[last]) ?? null, true);
    }

    if (!pos.length || !tri.length) return null;

    return new (Mesh as any)({
      vertexAttributes: {
        position: new Float64Array(pos),
        color:    new Uint8Array(clr),
      },
      components: [{
        faces:    new Uint32Array(tri),
        material: { colorMixMode: 'replace' },
      }],
      spatialReference: { wkid: 4326 },
    });
  }

  private _azimuthLineSymbol(color: [number, number, number]): any {
    const [r, g, b] = color;
    if (this._is3D()) {
      return {
        type: 'line-3d',
        symbolLayers: [{
          type: 'line',
          material: { color: [r, g, b, 160] },
          size: 1.5,
          cap: 'round',
        }],
      } as any;
    }
    return {
      type: 'simple-line',
      color: [r, g, b, 160],
      width: 1.5,
      style: 'short-dash',
    } as any;
  }

  private _observerSymbol(color: [number, number, number]): any {
    const [r, g, b] = color;
    if (this._is3D()) {
      return {
        type: 'point-3d',
        symbolLayers: [{
          type: 'object',
          resource: { primitive: 'sphere' },
          material: { color: [r, g, b, 230] },
          width: 80, height: 80, depth: 80,
        }],
        verticalOffset: { screenLength: 28, maxWorldLength: 500, minWorldLength: 4 },
      } as any;
    }
    return {
      type: 'simple-marker',
      style: 'cross',
      color: [r, g, b, 220],
      size: 14,
      outline: { color: [255, 255, 255, 180], width: 1.5 },
    } as any;
  }

  private _rangeLabelSymbol(text: string, color: [number, number, number]): any {
    const [r, g, b] = color;
    return {
      type: 'text',
      text,
      color: [r, g, b, 200],
      haloColor: [0, 0, 0, 180],
      haloSize: 1.5,
      font: { size: 9, family: 'Courier New', weight: 'bold' },
    } as any;
  }

  // ─── Private: Redraw ────────────────────────────────────────────────────────

  private _redraw(): void {
    if (!this._observerPoint || !this._panelEl) return;

    const minR    = Math.max(0, Number(this._inp('wez-minrange')?.value ?? 0));
    const maxR    = Math.max(minR + 1, Number(this._inp('wez-maxrange')?.value ?? 1000));
    const azC     = Number(this._inp('wez-azimuth')?.value ?? 0);
    const azSp    = Math.min(360, Math.max(10, Number(this._inp('wez-spread')?.value ?? 360)));
    const elevMin = Number(this._inp('wez-elevmin')?.value ?? 0);
    const elevMax = Number(this._inp('wez-elevmax')?.value ?? 45);
    const showDead  = (this._panelEl.querySelector<HTMLInputElement>('#wez-opt-deadzone'))?.checked ?? true;
    const showRings = (this._panelEl.querySelector<HTMLInputElement>('#wez-opt-rings'))?.checked ?? true;

    this._setStatus('computing');

    const result = this._computeWEZ({
      observerPoint:    this._observerPoint,
      minRangeM:        minR,
      maxRangeM:        maxR,
      azimuthCenterDeg: azC,
      azimuthSpreadDeg: azSp,
      elevMaxDeg:       elevMax,
    });

    this._analysisLayer.removeAll();

    const { zone, minRing, extrudeHeightM, preset } = result;

    // ── Main WEZ zone ──
    const zoneAttrs = {
      type: 'wez_zone', weaponType: this._weaponKey(), minRangeM: minR,
      maxRangeM: maxR, azimuthCenterDeg: azC, azimuthSpreadDeg: azSp,
      elevMaxDeg: elevMax, extrudeHeightM,
      fillOpacity: Number(this._inp('wez-fill-opacity')?.value ?? 22),
    };

    if (this._is3D()) {
      // 3D: geodesic dome mesh — accurate spherical-shell sector
      const domeMesh = this._buildWEZDomeMesh(
        this._observerPoint, minR, maxR, azC, azSp, elevMin, elevMax,
        preset.color, this._getFillAlpha()
      );
      if (domeMesh) {
        this._analysisLayer.add(new Graphic({
          geometry: domeMesh,
          symbol: {
            type: 'mesh-3d',
            symbolLayers: [{
              type: 'fill',
              material: { colorMixMode: 'replace' },
              edges: { type: 'sketch', color: [preset.color[0], preset.color[1], preset.color[2], 80], size: 0.8 },
            }],
          } as any,
          attributes: zoneAttrs,
        }));
      }
    } else if (zone) {
      // 2D: flat filled polygon (extrude not applicable in MapView)
      this._analysisLayer.add(new Graphic({
        geometry: zone,
        symbol: this._wezZoneSymbol(preset.color, extrudeHeightM),
        attributes: zoneAttrs,
      }));
    }

    // ── Dead zone ──
    if (showDead && minR > 0 && minRing) {
      this._analysisLayer.add(new Graphic({
        geometry: minRing,
        symbol: this._deadZoneSymbol(),
        attributes: { type: 'wez_dead_zone' },
      }));
    }

    // ── Range rings + labels ──
    if (showRings) {
      const ringDefs: { r: number; opacity: number; label: string }[] = [
        { r: minR,                        opacity: 0.5, label: minR > 0 ? `${this._fmtDist(minR)} MIN` : '' },
        { r: (minR + maxR) / 2,           opacity: 0.3, label: `${this._fmtDist((minR + maxR) / 2)}` },
        { r: maxR,                        opacity: 0.6, label: `${this._fmtDist(maxR)} MAX` },
      ];

      ringDefs.forEach(({ r, opacity, label }) => {
        if (r <= 0) return;
        const ringRaw = geometryEngine.geodesicBuffer(this._observerPoint!, r, 'meters');
        const ring = Array.isArray(ringRaw) ? ringRaw[0] : ringRaw;
        if (!ring) return;

        this._analysisLayer.add(new Graphic({
          geometry: ring as Polygon,
          symbol: this._rangeRingSymbol(preset.color, opacity),
          attributes: { type: 'wez_ring' },
        }));

        if (label) {
          const obsLon2 = this._observerPoint?.longitude ?? 0;
          const obsLat2 = this._observerPoint?.latitude ?? 0;
          const labelPt = this._destinationPoint(obsLon2, obsLat2, azC, r);
          this._analysisLayer.add(new Graphic({
            geometry: new Point({ longitude: labelPt.longitude, latitude: labelPt.latitude, spatialReference: { wkid: 4326 } }),
            symbol: this._rangeLabelSymbol(label, preset.color),
            attributes: { type: 'wez_label' },
          }));
        }
      });
    }

    // ── Azimuth center line ──
    if (azSp < 360) {
      const obsLon = this._observerPoint.longitude ?? 0;
      const obsLat = this._observerPoint.latitude ?? 0;
      const far = this._destinationPoint(obsLon, obsLat, azC, maxR);
      this._analysisLayer.add(new Graphic({
        geometry: new Polyline({
          paths: [[[obsLon, obsLat], [far.longitude, far.latitude]]],
          spatialReference: { wkid: 4326 },
        }),
        symbol: this._azimuthLineSymbol(preset.color),
        attributes: { type: 'wez_az_line' },
      }));
    }

    this._setStatus('ready');
    const commitBtn = this._panelEl?.querySelector<HTMLButtonElement>('#wez-commit-btn');
    if (commitBtn) commitBtn.disabled = false;
  }

  private _drawObserver(): void {
    if (!this._observerPoint) return;
    const preset = this._currentPreset();
    this._observerLayer.removeAll();
    this._observerLayer.add(new Graphic({
      geometry: this._observerPoint,
      symbol: this._observerSymbol(preset.color),
      attributes: { type: 'wez_observer' },
    }));

    const lat = this._observerPoint.latitude ?? 0;
    const lon = this._observerPoint.longitude ?? 0;
    const coordsEl = this._panelEl?.querySelector<HTMLElement>('#wez-coords');
    if (coordsEl) {
      coordsEl.textContent = `Observer: ${lat.toFixed(5)}°N  ${lon.toFixed(5)}°E`;
    }
    // Keep the top Lat/Lon bar in sync with the current firing point.
    const latInp = this._inp('wez-lat');
    const lonInp = this._inp('wez-lon');
    if (latInp) latInp.value = lat.toFixed(5);
    if (lonInp) lonInp.value = lon.toFixed(5);
  }

  // ─── Private: Terrain masking ────────────────────────────────────────────────

  private async _runTerrainMask(): Promise<void> {
    if (!this._observerPoint || this._view?.type !== '3d') return;
    const view = this._view as SceneView;

    this._setStatus('computing');
    const terrainBtn = this._panelEl?.querySelector<HTMLButtonElement>('#wez-terrain-btn');
    if (terrainBtn) terrainBtn.disabled = true;

    try {
      const maxR = Math.max(1, Number(this._inp('wez-maxrange')?.value ?? 5000));
      const extentGeom = geometryEngine.geodesicBuffer(this._observerPoint, maxR, 'meters');
      const extent = Array.isArray(extentGeom) ? extentGeom[0]?.extent : (extentGeom as Polygon | null)?.extent;
      if (!extent) return;

      const sampler = await ElevationUtils.createSampler(view, extent, { noDataValue: 0 });
      const obsZ = ElevationUtils.queryPointElevation(sampler, this._observerPoint) + 2;
      const NUM_RAYS = 72;
      const STEP_M   = Math.max(25, maxR / 200);
      const numSteps = Math.ceil(maxR / STEP_M);
      const maskedIndices: number[] = [];

      // Reused scratch Point for the ray-march samples — avoids one Point per step.
      const samplePt = new Point({ longitude: 0, latitude: 0, spatialReference: { wkid: 4326 } });

      for (let ray = 0; ray < NUM_RAYS; ray++) {
        const bearing = (ray / NUM_RAYS) * 360;
        let maxSlope = -Infinity;
        let blocked = false;

        for (let s = 1; s <= numSteps; s++) {
          const dist = s * STEP_M;
          const { longitude, latitude } = this._destinationPoint(
            this._observerPoint?.longitude ?? 0,
            this._observerPoint?.latitude ?? 0,
            bearing, dist
          );
          samplePt.longitude = longitude;
          samplePt.latitude = latitude;
          const terrainZ = ElevationUtils.queryPointElevation(sampler, samplePt);
          const slope = Math.atan2(terrainZ - obsZ, dist);

          // Line-of-sight horizon test: maintain the maximum elevation angle
          // (slope to the observer) seen so far. A sample is hidden only if its
          // own elevation angle is below the running horizon; a sample that
          // rises above the horizon is visible and raises it. Non-monotonic
          // (undulating) terrain must NOT abort the ray on the first dip — keep
          // sampling so the horizon can rise past higher ground further out.
          if (slope >= maxSlope) {
            maxSlope = slope;
            blocked = false;
          } else {
            blocked = true;
          }
        }
        if (blocked) maskedIndices.push(ray);
      }

      const degPerRay = 360 / NUM_RAYS;
      const ranges: { s: number; e: number }[] = [];
      if (maskedIndices.length) {
        const sorted = [...maskedIndices].sort((a, b) => a - b);
        let rS = sorted[0], rE = sorted[0];
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i] === rE + 1) { rE = sorted[i]; }
          else {
            ranges.push({ s: rS * degPerRay, e: (rE + 1) * degPerRay });
            rS = rE = sorted[i];
          }
        }
        ranges.push({ s: rS * degPerRay, e: (rE + 1) * degPerRay });
      }

      const staleGraphics = this._analysisLayer.graphics
        .filter((g: Graphic) => g.attributes?.type === 'wez_masked_sector');
      staleGraphics.forEach((g: Graphic) => this._analysisLayer.remove(g));

      ranges.forEach(({ s, e }) => {
        const spread = e - s;
        const center = s + spread / 2;
        const wedge = this._buildAzimuthWedge(this._observerPoint!, center, spread, maxR);
        this._analysisLayer.add(new Graphic({
          geometry: wedge,
          symbol: this._maskedSectorSymbol(),
          attributes: { type: 'wez_masked_sector' },
        }));
      });

      this._setStatus('ready');
    } catch (err) {
      console.error('[WeaponEffectEngine] Terrain mask error:', err);
      this._setStatus('error');
    } finally {
      if (terrainBtn) terrainBtn.disabled = false;
    }
  }

  // ─── Private: Panel ─────────────────────────────────────────────────────────

  private _showPanel(defaultWeapon = 'mortar', override?: WEZPanelOverride): void {
    if (!this._panelEl) {
      this._panelEl = document.createElement('div');
      this._panelEl.id = 'wez-engine-panel';
      this._panelEl.className = 'wez-panel';
      document.body.appendChild(this._panelEl);
    }

    const preset = WEAPON_PRESETS[defaultWeapon] ?? WEAPON_PRESETS.mortar;
    this._panelEl.style.setProperty('--wez-accent', preset.accentHex);
    this._panelEl.innerHTML = this._buildPanelHTML(defaultWeapon, preset, override);
    this._panelEl.style.display = 'block';

    this._bindPanelEvents();
    this._makeDraggable();
    this._syncTerrainBtn();
  }

  private _hidePanel(): void {
    if (this._panelEl) this._panelEl.style.display = 'none';
  }

  /** Collapse panel body, keep graphics alive. */
  private _minimizePanel(): void {
    if (!this._panelEl) return;
    const body = this._panelEl.querySelector<HTMLElement>('.wez-body');
    const btn  = this._panelEl.querySelector<HTMLElement>('#wez-minimize-btn');
    if (!body || !btn) return;
    const minimized = body.style.display === 'none';
    body.style.display = minimized ? '' : 'none';
    btn.textContent = minimized ? '▼' : '▶';
  }

  private _buildPanelHTML(weaponKey: string, preset: WeaponPreset, override?: WEZPanelOverride): string {
    const weaponOptions = Object.entries(WEAPON_PRESETS)
      .map(([k, p]) => `<option value="${k}"${k === weaponKey ? ' selected' : ''}>${p.icon} ${p.label}</option>`)
      .join('');

    const v = override ?? {};
    const minR    = v.minRange    ?? preset.minRangeM;
    const maxR    = v.maxRange    ?? preset.maxRangeM;
    const az      = v.azimuth     ?? 0;
    const spread  = v.spread      ?? preset.azimuthSpreadDeg;
    const elevMin = v.elevMin     ?? preset.elevMinDeg;
    const elevMax = v.elevMax     ?? preset.elevMaxDeg;
    const obsH    = v.obsHeight   ?? 2;
    const fo      = v.fillOpacity ?? 22;      // percent, 0-100
    const isEdit  = override != null;
    const obsLat  = this._observerPoint ? (this._observerPoint.latitude ?? 0).toFixed(5) : '';
    const obsLon  = this._observerPoint ? (this._observerPoint.longitude ?? 0).toFixed(5) : '';

    return `
      <div class="wez-header" id="wez-drag-handle">
        <span class="wez-header-icon">${preset.icon}</span>
        <span class="wez-header-title">Weapon Effect Zone${isEdit ? ' — Re-edit' : ''}</span>
        <span class="wez-status-dot" id="wez-status-dot"></span>
        <span class="wez-status-lbl" id="wez-status-lbl">${isEdit ? 'Restored' : 'Awaiting'}</span>
        <button class="wez-help-btn" id="wez-help-btn" title="How WEZ analysis works">?</button>
        <button class="wez-minimize-btn" id="wez-minimize-btn" title="Minimize">▼</button>
        <button class="wez-close-btn" id="wez-close-btn" title="Close (keeps graphics)">✕</button>
      </div>

      <div class="wez-help-popover" id="wez-help-popover" hidden>
        <div class="wez-help-head">
          <div>
            <div class="wez-help-kicker">Field Guide</div>
            <div class="wez-help-title">Weapon Effect Zone</div>
          </div>
          <button class="wez-help-close" id="wez-help-close" title="Close">✕</button>
        </div>
        <div class="wez-help-body">
          <div style="background:rgba(239,159,39,0.08);border-left:3px solid rgba(239,159,39,0.6);padding:7px 10px;border-radius:3px;margin-bottom:10px">
            <div style="font-size:var(--ms-fs-xs);letter-spacing:.08em;text-transform:uppercase;color:rgba(239,159,39,0.7);margin-bottom:3px">Answers</div>
            <div style="font-style:italic;color:var(--ms-text)">Where can this weapon reach from here?</div>
          </div>
          <p>Models the engagement sector a weapon system can cover from its firing position — a directional wedge clipped by minimum range, maximum range, traverse limits, and elevation envelope.</p>
          <p style="font-size:var(--ms-fs-xs);color:var(--ms-text-dim);border-top:1px solid var(--ms-divider);padding-top:7px;margin-top:2px">Use <strong style="color:var(--ms-text)">Weapon Effect</strong> to analyse what happens when the round lands at a point inside this zone.</p>
          <div class="wez-help-block">
            <h4>How It Works</h4>
            <ol>
              <li>Choose a weapon preset to load typical engagement values.</li>
              <li>Set or reposition the observer or firing point.</li>
              <li>Shape the zone with min/max range, azimuth center, and spread.</li>
              <li>Use elevation limits and optional terrain masking to show where the weapon can realistically engage.</li>
            </ol>
          </div>
          <div class="wez-help-block">
            <h4>Phenomenon</h4>
            <p>A WEZ is not just distance. It is the space a weapon can cover after applying dead space near the launcher, traverse limits left and right, and vertical firing limits for direct-fire, indirect-fire, or anti-air profiles.</p>
          </div>
          <div class="wez-help-block">
            <h4>Parameters</h4>
            <dl>
              <dt>Weapon</dt><dd>Loads preset defaults such as range band, spread, elevation limits, and display color for a weapon family.</dd>
              <dt>Min range</dt><dd>Inner safety or arming distance; this becomes the dead zone when greater than zero.</dd>
              <dt>Max range</dt><dd>Outer engagement reach of the weapon.</dd>
              <dt>Azimuth</dt><dd>Center bearing of the sector.</dd>
              <dt>Spread</dt><dd>Total left-right engagement width in degrees; 360 makes an all-around zone.</dd>
              <dt>Elev min/max</dt><dd>Vertical firing envelope that helps distinguish flat-fire from high-angle systems.</dd>
              <dt>Obs height</dt><dd>Raises the firing point above local ground, which matters when masking against terrain.</dd>
              <dt>Extrude</dt><dd>Shows the zone with depth in 3D so the vertical envelope reads more clearly.</dd>
              <dt>Deadzone</dt><dd>Displays the interior non-engagement area created by minimum range.</dd>
              <dt>Rings</dt><dd>Adds min/max reference arcs and radial guides.</dd>
              <dt>Opacity</dt><dd>Controls fill density without changing the underlying geometry.</dd>
              <dt>Terrain</dt><dd>Runs a masking pass in 3D to subtract terrain-shadowed portions from the raw sector.</dd>
            </dl>
          </div>
          <div class="wez-help-block">
            <h4>Reading the result</h4>
            <ul>
              <li>Filled wedge = engagement zone (cleared of dead space).</li>
              <li>Dashed circles = min/max range refs.</li>
              <li>Grey wedges (3D only) = terrain-masked sectors after Run Mask.</li>
            </ul>
          </div>
        </div>
      </div>

      <div class="wez-body">

        <div class="wez-sec">Firing Location</div>
        <div class="wez-locbar">
          <div class="wez-loc-field">
            <span class="wez-loc-lbl">Lat</span>
            <input id="wez-lat" class="wez-loc-input" type="number" value="${obsLat}" placeholder="—" step="0.00001" min="-90" max="90" />
          </div>
          <div class="wez-loc-field">
            <span class="wez-loc-lbl">Lon</span>
            <input id="wez-lon" class="wez-loc-input" type="number" value="${obsLon}" placeholder="—" step="0.00001" min="-180" max="180" />
          </div>
          <button class="wez-btn wez-btn-sm wez-btn-primary" id="wez-loc-go" title="Place the firing point at these coordinates">Go</button>
          <button class="wez-btn wez-btn-sm" id="wez-loc-pick" title="Click the map to place the firing point">Pick ⊕</button>
        </div>

        <div class="wez-sec">Weapon System</div>
        <div class="wez-field-full">
          <select id="wez-weapon" class="wez-select">${weaponOptions}</select>
        </div>

        <div class="wez-divider"></div>
        <div class="wez-sec">Engagement Ranges</div>
        <div class="wez-grid">
          <div class="wez-field">
            <div class="wez-label">Min range (m)</div>
            <input id="wez-minrange" class="wez-input" type="number" value="${minR}" min="0" step="50" />
          </div>
          <div class="wez-field">
            <div class="wez-label">Max range (m)</div>
            <input id="wez-maxrange" class="wez-input" type="number" value="${maxR}" min="100" step="100" />
          </div>
        </div>

        <div class="wez-sec">Azimuth</div>
        <div class="wez-slider-row">
          <span class="wez-label">Centre (°)</span>
          <input id="wez-azimuth" type="range" min="0" max="359" value="${az}" step="1" class="wez-slider" />
          <span class="wez-slider-val" id="wez-az-val">${String(az).padStart(3,'0')}°</span>
        </div>
        <div class="wez-slider-row">
          <span class="wez-label">Spread (°)</span>
          <input id="wez-spread" type="range" min="10" max="360" value="${spread}" step="5" class="wez-slider" />
          <span class="wez-slider-val" id="wez-sp-val">${spread}°</span>
        </div>

        <div class="wez-sec">Elevation Envelope</div>
        <div class="wez-grid">
          <div class="wez-field">
            <div class="wez-label">Min elev (°)</div>
            <input id="wez-elevmin" class="wez-input" type="number" value="${elevMin}" min="-30" max="89" step="1" />
          </div>
          <div class="wez-field">
            <div class="wez-label">Max elev (°)</div>
            <input id="wez-elevmax" class="wez-input" type="number" value="${elevMax}" min="-5" max="90" step="1" />
          </div>
        </div>

        <div class="wez-divider"></div>
        <div class="wez-sec">Observer</div>
        <div class="wez-grid">
          <div class="wez-field">
            <div class="wez-label">Height (m)</div>
            <input id="wez-obsheight" class="wez-input" type="number" value="${obsH}" min="0" max="100" step="0.5" />
          </div>
          <div class="wez-field wez-field-btn">
            <div class="wez-label">Reposition</div>
            <button class="wez-btn wez-btn-sm" id="wez-reposition-btn">Pick ⊕</button>
          </div>
        </div>
        <div class="wez-coords" id="wez-coords">${
          this._observerPoint
            ? `Observer: ${(this._observerPoint.latitude ?? 0).toFixed(5)}°N  ${(this._observerPoint.longitude ?? 0).toFixed(5)}°E`
            : 'Observer: click map to place'
        }</div>

        <div class="wez-divider"></div>
        <div class="wez-sec">Display Options</div>
        <div class="wez-toggle-row">
          <label class="wez-label">Extrude 3D volume</label>
          <input id="wez-opt-extrude" type="checkbox" class="wez-check" checked />
        </div>
        <div class="wez-toggle-row">
          <label class="wez-label">Show dead zone</label>
          <input id="wez-opt-deadzone" type="checkbox" class="wez-check" checked />
        </div>
        <div class="wez-toggle-row">
          <label class="wez-label">Show range rings</label>
          <input id="wez-opt-rings" type="checkbox" class="wez-check" checked />
        </div>
        <div class="wez-slider-row">
          <span class="wez-label">Fill opacity</span>
          <input id="wez-fill-opacity" type="range" min="0" max="100" value="${fo}" step="5" class="wez-slider" />
          <span class="wez-slider-val" id="wez-fo-val">${fo}%</span>
        </div>
        <div class="wez-toggle-row" id="wez-terrain-row" style="display:none">
          <label class="wez-label">Terrain masking (3D)</label>
          <button class="wez-btn wez-btn-sm wez-btn-terrain" id="wez-terrain-btn" disabled>Run Mask</button>
        </div>

        <div class="wez-divider"></div>
        <div class="wez-btn-row">
          <button class="wez-btn" id="wez-clear-btn">Clear</button>
          <button class="wez-btn wez-btn-primary" id="wez-commit-btn" ${isEdit ? '' : 'disabled'}>Commit ↗</button>
        </div>

      </div>
    `;
  }

  private _bindPanelEvents(): void {
    if (!this._panelEl) return;
    const p = this._panelEl;

    p.querySelector('#wez-help-btn')?.addEventListener('click', (event) => {
      event.stopPropagation();
      const help = p.querySelector<HTMLElement>('#wez-help-popover');
      if (help) help.hidden = !help.hidden;
    });
    p.querySelector('#wez-help-close')?.addEventListener('click', () => {
      const help = p.querySelector<HTMLElement>('#wez-help-popover');
      if (help) help.hidden = true;
    });

    p.querySelector('#wez-minimize-btn')?.addEventListener('click', () => this._minimizePanel());
    p.querySelector('#wez-close-btn')?.addEventListener('click', () => {
      this._hidePanel();
      this._cancelReposition();
    });

    // Weapon preset change → snap all fields
    p.querySelector('#wez-weapon')?.addEventListener('change', () => {
      const preset = this._currentPreset();
      this._setInputVal('wez-minrange', preset.minRangeM);
      this._setInputVal('wez-maxrange', preset.maxRangeM);
      this._setInputVal('wez-spread',   preset.azimuthSpreadDeg);
      this._setInputVal('wez-elevmin',  preset.elevMinDeg);
      this._setInputVal('wez-elevmax',  preset.elevMaxDeg);
      (p.querySelector('#wez-sp-val') as HTMLElement).textContent = preset.azimuthSpreadDeg + '°';
      // Update accent color
      p.style.setProperty('--wez-accent', preset.accentHex);
      const headerIcon = p.querySelector<HTMLElement>('.wez-header-icon');
      if (headerIcon) headerIcon.textContent = preset.icon;
      this._redraw();
    });

    // Azimuth slider
    p.querySelector('#wez-azimuth')?.addEventListener('input', (e) => {
      const v = (e.target as HTMLInputElement).value;
      (p.querySelector('#wez-az-val') as HTMLElement).textContent = String(v).padStart(3, '0') + '°';
      this._redraw();
    });

    // Spread slider
    p.querySelector('#wez-spread')?.addEventListener('input', (e) => {
      const v = (e.target as HTMLInputElement).value;
      (p.querySelector('#wez-sp-val') as HTMLElement).textContent = v + '°';
      this._redraw();
    });

    // All numeric inputs
    ['wez-minrange','wez-maxrange','wez-elevmin','wez-elevmax','wez-obsheight']
      .forEach(id => p.querySelector(`#${id}`)?.addEventListener('change', () => this._redraw()));

    // Option toggles
    ['wez-opt-extrude','wez-opt-deadzone','wez-opt-rings']
      .forEach(id => p.querySelector(`#${id}`)?.addEventListener('change', () => this._redraw()));

    // Fill opacity slider
    p.querySelector('#wez-fill-opacity')?.addEventListener('input', (e) => {
      const v = (e.target as HTMLInputElement).value;
      (p.querySelector('#wez-fo-val') as HTMLElement).textContent = v + '%';
      this._redraw();
    });

    // Terrain mask button
    p.querySelector('#wez-terrain-btn')?.addEventListener('click', () => this._runTerrainMask());

    // Reposition (Observer section) + top location bar Pick
    p.querySelector('#wez-reposition-btn')?.addEventListener('click', () => this._startReposition());
    p.querySelector('#wez-loc-pick')?.addEventListener('click', () => this._startReposition());

    // Manual Lat/Lon entry — "Go" places the firing point at typed coordinates.
    p.querySelector('#wez-loc-go')?.addEventListener('click', () => this._applyManualLocation());
    ['wez-lat', 'wez-lon'].forEach(id => p.querySelector(`#${id}`)?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') this._applyManualLocation();
    }));

    // Clear
    p.querySelector('#wez-clear-btn')?.addEventListener('click', () => {
      this._analysisLayer.removeAll();
      this._observerLayer.removeAll();
      this._observerPoint = null;
      const coordsEl = p.querySelector<HTMLElement>('#wez-coords');
      if (coordsEl) coordsEl.textContent = 'Observer: click map to place';
      const latInp = this._inp('wez-lat');
      const lonInp = this._inp('wez-lon');
      if (latInp) latInp.value = '';
      if (lonInp) lonInp.value = '';
      const commitBtn = p.querySelector<HTMLButtonElement>('#wez-commit-btn');
      if (commitBtn) commitBtn.disabled = true;
      this._setStatus('awaiting');
    });

    // Commit
    p.querySelector('#wez-commit-btn')?.addEventListener('click', () => this._commit());
  }

  /** Place the firing point from the panel's Lat/Lon inputs. */
  private _applyManualLocation(): void {
    const latRaw = this._inp('wez-lat')?.value ?? '';
    const lonRaw = this._inp('wez-lon')?.value ?? '';
    if (latRaw.trim() === '' || lonRaw.trim() === '') {
      this._flashPickTooltip('Enter both Lat and Lon, or use "Pick ⊕" to click the map.');
      return;
    }
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      this._flashPickTooltip('Invalid coordinates — Lat must be -90…90 and Lon -180…180.');
      return;
    }

    this._cancelReposition();
    this._observerPoint = new Point({ longitude: lon, latitude: lat, spatialReference: { wkid: 4326 } });
    this._hideTooltip();
    this._drawObserver();
    this._redraw();

    const tBtn = this._panelEl?.querySelector<HTMLButtonElement>('#wez-terrain-btn');
    if (tBtn) tBtn.disabled = false;

    if (this._view) {
      void this._view.goTo({ target: this._observerPoint, zoom: this._is3D() ? undefined : 13 } as any).catch(() => {});
    }
  }

  private _startReposition(): void {
    if (!this._view) return;
    // Tear down any prior reposition arming first, so pressing Pick twice (or
    // opening with no symbol then Pick) doesn't leave multiple live click handlers
    // that each fire and re-run a full redraw on the next map click.
    this._cancelReposition();
    const coordsEl = this._panelEl?.querySelector<HTMLElement>('#wez-coords');
    if (coordsEl) coordsEl.textContent = '⊕  Click map to place observer…';
    this._setStatus('picking');

    this._repositionHandle = this._view.on('click', async (event: any) => {
      this._cancelReposition();

      let pt: Point;
      if (this._is3D()) {
        const hit = await (this._view as any).hitTest(event, { include: [(this._view as any).map.ground] });
        const groundPt = hit?.ground?.mapPoint ?? event.mapPoint;
        pt = new Point({
          longitude: groundPt.longitude,
          latitude: groundPt.latitude,
          z: (groundPt.z ?? 0) + Number(this._inp('wez-obsheight')?.value ?? 2),
          spatialReference: { wkid: 4326 },
        });
      } else {
        pt = new Point({
          longitude: event.mapPoint.longitude,
          latitude: event.mapPoint.latitude,
          spatialReference: { wkid: 4326 },
        });
      }

      this._observerPoint = pt;
      this._hideTooltip();
      this._drawObserver();
      this._redraw();

      const tBtn = this._panelEl?.querySelector<HTMLButtonElement>('#wez-terrain-btn');
      if (tBtn) tBtn.disabled = false;
    });
  }

  private _cancelReposition(): void {
    if (this._repositionHandle) {
      this._repositionHandle.remove();
      this._repositionHandle = null;
    }
  }

  private _commit(): void {
    if (!this._observerPoint || this._analysisLayer.graphics.length === 0) return;
    const ts = new Date().toISOString();
    this._analysisLayer.graphics.forEach((g: Graphic) => {
      if (!g.geometry) return;
      this._committedLayer.add(new Graphic({
        geometry: g.geometry.clone(),
        symbol:   (g as any).symbol?.clone(),
        attributes: {
          ...g.attributes,
          committedAt:  ts,
          observerLon:  this._observerPoint?.longitude ?? 0,
          observerLat:  this._observerPoint?.latitude ?? 0,
        },
      }));
    });
    this._observerLayer.graphics.forEach((g: Graphic) => {
      if (!g.geometry) return;
      this._committedLayer.add(new Graphic({
        geometry: g.geometry.clone(),
        symbol:   (g as any).symbol?.clone(),
        attributes: { ...g.attributes, committedAt: ts },
      }));
    });

    const prev = (this._panelEl?.querySelector('#wez-status-lbl') as HTMLElement)?.textContent;
    this._setStatus('committed');
    setTimeout(() => {
      if (prev) {
        const lbl = this._panelEl?.querySelector<HTMLElement>('#wez-status-lbl');
        if (lbl) lbl.textContent = prev;
      }
      this._setStatus('ready');
    }, 2000);
  }

  private _makeDraggable(): void {
    const handle = this._panelEl?.querySelector<HTMLElement>('#wez-drag-handle');
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
    const x = e.clientX - this._dragOffsetX;
    const y = e.clientY - this._dragOffsetY;
    this._panelEl.style.left = `${Math.min(window.innerWidth - 396, Math.max(0, x))}px`;
    this._panelEl.style.top  = `${Math.min(window.innerHeight - 120, Math.max(0, y))}px`;
    this._panelEl.style.right = 'auto';
  };

  private _onDragEnd = (): void => {
    this._isDragging = false;
    document.removeEventListener('mousemove', this._onDragMove);
    document.removeEventListener('mouseup', this._onDragEnd);
  };

  // ─── Private: Helpers ───────────────────────────────────────────────────────

  private _setStatus(state: 'awaiting' | 'picking' | 'computing' | 'ready' | 'committed' | 'error'): void {
    const dotEl = this._panelEl?.querySelector<HTMLElement>('#wez-status-dot');
    const statusTextMap: Record<typeof state, string> = { awaiting: 'Awaiting observer', picking: 'Click map', computing: 'Computing', ready: 'Ready', committed: 'Committed', error: 'Error' };
    const message = statusTextMap[state];
    if (state === 'ready' || state === 'committed') EngineLogger.success(ENGINE_NAME, message);
    else if (state === 'error') EngineLogger.error(ENGINE_NAME, message);
    else EngineLogger.nextStep(ENGINE_NAME, message);
    const lblEl = this._panelEl?.querySelector<HTMLElement>('#wez-status-lbl');
    if (!dotEl || !lblEl) return;
    const map: Record<string, [string, string]> = {
      awaiting:  ['#555',    'Awaiting observer'],
      picking:   ['#378ADD', 'Click map…'],
      computing: ['#EF9F27', 'Computing…'],
      ready:     ['#1D9E75', 'Ready'],
      committed: ['#1D9E75', 'Committed ✓'],
      error:     ['#E24B4A', 'Error'],
    };
    const [color, label] = map[state] ?? map.awaiting;
    dotEl.style.background = color;
    dotEl.style.boxShadow = `0 0 6px ${color}88`;
    lblEl.textContent = label;
  }

  private _syncTerrainBtn(): void {
    const terrainRow = this._panelEl?.querySelector<HTMLElement>('#wez-terrain-row');
    if (terrainRow) terrainRow.style.display = this._is3D() ? 'flex' : 'none';
  }

  /** Show a transient tooltip bubble anchored under the "Pick ⊕" button. */
  private _flashPickTooltip(message: string): void {
    const anchor = this._panelEl?.querySelector<HTMLElement>('#wez-reposition-btn');
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
    tip.style.left = `${Math.max(8, rect.right - 240)}px`;
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

  private _currentPreset(): WeaponPreset {
    const key = this._weaponKey();
    return WEAPON_PRESETS[key] ?? WEAPON_PRESETS.mortar;
  }

  private _weaponKey(): string {
    return (this._panelEl?.querySelector<HTMLSelectElement>('#wez-weapon'))?.value ?? 'mortar';
  }

  private _inp(id: string): HTMLInputElement | null {
    return this._panelEl?.querySelector<HTMLInputElement>(`#${id}`) ?? null;
  }

  private _setInputVal(id: string, value: number): void {
    const el = this._inp(id);
    if (el) el.value = String(value);
  }

  private _fmtDist(m: number): string {
    return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`;
  }

  private _detectWeaponType(graphic: Graphic): string {
    const attrs = graphic.attributes ?? {};
    const sidc: string = (attrs.sidc ?? attrs.SIDC ?? '').toString().toUpperCase();
    if (sidc.includes('ANTI_AIR') || sidc.includes('AA')) return 'anti_air';
    const type: string = (attrs.graphicType ?? attrs.weaponType ?? '').toString().toLowerCase();
    if (type.includes('mortar'))    return 'mortar';
    if (type.includes('artillery')) return 'artillery';
    if (type.includes('atgm'))      return 'atgm';
    if (type.includes('anti_air'))  return 'anti_air';
    if (type.includes('anti_armor'))return 'anti_armor';
    if (type.includes('direct'))    return 'direct_fire';
    return 'mortar';
  }

  // ─── Private: Styles ────────────────────────────────────────────────────────

  private _injectStyles(): void {
    if (document.getElementById('wez-engine-styles')) return;
    const style = document.createElement('style');
    style.id = 'wez-engine-styles';
    style.textContent = `
      .wez-panel {
        position: fixed;
        top: 60px;
        left: 14px;
        width: 380px;
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
        animation: wezPanelIn 0.18s cubic-bezier(0.34,1.56,0.64,1);
      }
      @keyframes wezPanelIn {
        from { opacity:0; transform: scale(0.94) translateY(-8px); }
        to   { opacity:1; transform: scale(1) translateY(0); }
      }
      .wez-header {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 9px 10px 8px;
        border-bottom: 1px solid var(--ms-divider);
        background: var(--ms-bg-header);
        border-radius: 5px 5px 0 0;
        cursor: grab;
      }
      .wez-header:active { cursor: grabbing; }
      .wez-header-icon { font-size: 15px; flex-shrink: 0; }
      .wez-header-title {
        font-size: var(--ms-fs-sm);
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ms-warning);
        font-weight: 700;
        flex: 1;
      }
      .wez-status-dot {
        width: 7px; height: 7px;
        border-radius: 50%;
        background: #555;
        flex-shrink: 0;
        transition: background 0.3s, box-shadow 0.3s;
      }
      .wez-status-lbl {
        font-size: var(--ms-fs-xs);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ms-text-dim);
        min-width: 60px;
      }
      .wez-help-btn, .wez-minimize-btn, .wez-close-btn {
        background: none;
        border: 1px solid transparent;
        color: var(--ms-text-dim);
        font-size: 12px;
        cursor: pointer;
        padding: 0 2px;
        line-height: 1;
        transition: color 0.15s;
        flex: 0 0 auto;
      }
      .wez-help-btn {
        width: 17px;
        height: 17px;
        border-color: var(--ms-border);
        border-radius: 50%;
        color: var(--ms-success);
        font-weight: 700;
      }
      .wez-help-btn:hover, .wez-minimize-btn:hover, .wez-close-btn:hover { color: var(--ms-text); }
      .wez-help-popover {
        position: absolute;
        top: 39px;
        left: 8px;
        right: 8px;
        z-index: 1120;
        max-height: min(520px, calc(100vh - 132px));
        overflow-y: auto;
        background: var(--ms-bg);
        border: 1px solid var(--ms-border);
        border-radius: 4px;
        box-shadow: var(--ms-shadow);
        color: var(--ms-text);
      }
      .wez-help-popover[hidden] { display: none; }
      .wez-help-head {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 11px 8px;
        border-bottom: 1px solid var(--ms-divider);
        background: var(--ms-bg-header);
      }
      .wez-help-kicker {
        font-size: var(--ms-fs-xs);
        color: var(--ms-text-label);
        letter-spacing: 0.09em;
        text-transform: uppercase;
      }
      .wez-help-title {
        margin-top: 2px;
        font-size: 13px;
        color: var(--ms-success);
        font-weight: 700;
      }
      .wez-help-close {
        width: 20px;
        height: 20px;
        border: 1px solid var(--ms-border);
        border-radius: 3px;
        background: var(--ms-bg-input);
        color: var(--ms-text-dim);
        cursor: pointer;
      }
      .wez-help-close:hover { color: var(--ms-text); }
      .wez-help-body {
        padding: 10px 11px 12px;
        font-size: var(--ms-fs);
        line-height: 1.45;
        color: var(--ms-text-dim);
        user-select: text;
      }
      .wez-help-body p { margin: 0 0 9px; }
      .wez-help-block { margin-top: 10px; }
      .wez-help-block h4 {
        margin: 0 0 5px;
        font-size: var(--ms-fs-xs);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ms-text);
      }
      .wez-help-block ol, .wez-help-block ul { margin: 0; padding-left: 17px; }
      .wez-help-block li { margin: 3px 0; }
      .wez-help-block dl {
        display: grid;
        grid-template-columns: 72px minmax(0, 1fr);
        gap: 5px 8px;
        margin: 0;
      }
      .wez-help-block dt { color: var(--ms-success); font-weight: 700; }
      .wez-help-block dd { margin: 0; }

      .wez-body { padding: 0 0 6px; }

      .wez-sec {
        font-size: var(--ms-fs-xs);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--ms-text-label);
        padding: 9px 12px 4px;
      }
      .wez-divider {
        height: 1px;
        background: linear-gradient(90deg, transparent, var(--ms-divider), transparent);
        margin: 4px 0;
      }
      .wez-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 7px;
        padding: 0 10px 8px;
      }
      .wez-field { display: flex; flex-direction: column; gap: 3px; }
      .wez-field-full { padding: 0 10px 8px; }
      .wez-field-btn { justify-content: flex-end; }
      .wez-label {
        font-size: var(--ms-fs-xs);
        letter-spacing: 0.07em;
        text-transform: uppercase;
        color: var(--ms-text-dim);
      }
      .wez-input, .wez-select {
        background: var(--ms-bg-input);
        border: 1px solid var(--ms-border);
        border-radius: 3px;
        color: var(--ms-text);
        font-family: inherit;
        font-size: var(--ms-fs);
        padding: 5px 7px;
        width: 100%;
        outline: none;
        transition: border-color 0.15s;
      }
      .wez-input:focus, .wez-select:focus { border-color: var(--ms-accent); }
      .wez-select option { background: var(--ms-bg); }

      .wez-slider-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 2px 10px 6px;
      }
      .wez-slider-row .wez-label { flex: 1; }
      .wez-slider {
        flex: 2;
        accent-color: var(--ms-warning);
        cursor: pointer;
      }
      .wez-slider-val {
        font-size: var(--ms-fs-sm);
        color: var(--ms-warning);
        min-width: 34px;
        text-align: right;
      }

      .wez-toggle-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 12px;
      }
      .wez-check {
        accent-color: var(--ms-warning);
        width: 13px; height: 13px;
        cursor: pointer;
      }

      .wez-coords {
        font-size: var(--ms-fs);
        color: var(--ms-accent);
        padding: 2px 12px 6px;
        letter-spacing: 0.04em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .wez-locbar {
        display: flex;
        align-items: flex-end;
        gap: 6px;
        padding: 2px 10px 8px;
      }
      .wez-loc-field {
        display: flex;
        flex-direction: column;
        gap: 3px;
        flex: 1;
        min-width: 0;
      }
      .wez-loc-lbl {
        font-size: var(--ms-fs-xs);
        letter-spacing: 0.07em;
        text-transform: uppercase;
        color: var(--ms-text-dim);
      }
      .wez-loc-input {
        background: var(--ms-bg-input);
        border: 1px solid var(--ms-border);
        border-radius: 3px;
        color: var(--ms-text);
        font-family: var(--ms-font-mono);
        font-size: var(--ms-fs);
        padding: 5px 6px;
        width: 100%;
        outline: none;
        transition: border-color 0.15s;
      }
      .wez-loc-input:focus { border-color: var(--ms-accent); }
      .wez-locbar .wez-btn-sm { align-self: stretch; }

      .wez-btn-row {
        display: flex;
        gap: 6px;
        padding: 8px 10px 4px;
      }
      .wez-btn {
        flex: 1;
        padding: 6px 4px;
        font-family: inherit;
        font-size: var(--ms-fs-xs);
        letter-spacing: 0.05em;
        text-transform: uppercase;
        cursor: pointer;
        border-radius: 3px;
        border: 1px solid var(--ms-border);
        background: var(--ms-bg-input);
        color: var(--ms-text-dim);
        transition: all 0.14s;
      }
      .wez-btn:hover { background: var(--ms-bg-header); color: var(--ms-text); }
      .wez-btn:disabled { opacity: 0.3; cursor: not-allowed; }
      .wez-btn-primary {
        border-color: var(--ms-warning);
        color: var(--ms-warning);
        background: var(--ms-bg-input);
      }
      .wez-btn-primary:hover { background: var(--ms-bg-header); color: var(--ms-text); }
      .wez-btn-sm { flex: 0 0 auto; padding: 4px 8px; font-size: var(--ms-fs-xs); }
      .wez-btn-terrain {
        border-color: var(--ms-accent);
        color: var(--ms-accent);
        background: var(--ms-bg-input);
      }
      .wez-btn-terrain:hover { background: var(--ms-bg-header); color: var(--ms-text); }
    `;
    document.head.appendChild(style);
  }
}

export default WeaponEffectEngine;

