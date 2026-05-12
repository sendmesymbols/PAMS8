/**
 * WeaponEffectEngine.ts
 * Weapon Engagement Zone (WEZ) analysis engine.
 *
 * Integrated with ContextMenuManager via linkWeaponEffectEngine().
 * Right-clicking any military symbol → Analysis → Weapon Engagement Zone
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
    icon: '🔫',
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
    icon: '💣',
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
    icon: '🔺',
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
    icon: '🚀',
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
    icon: '🛡️',
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

  /** Called by ContextMenuManager when "Weapon Engagement Zone" is clicked. */
  open(graphic: Graphic, view: MapView | SceneView): void {
    this.initialize(view);
    const attrs = graphic.attributes ?? {};

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
    const geom = graphic.geometry;
    if (geom?.type === 'point') {
      this._observerPoint = geom as Point;
    } else if ((geom as any)?.centroid) {
      this._observerPoint = (geom as any).centroid as Point;
    } else {
      this._observerPoint = null;
    }

    const detectedWeapon = this._detectWeaponType(graphic);
    this._showPanel(detectedWeapon);

    if (this._observerPoint) {
      this._drawObserver();
      this._redraw();
    }
  }

  close(): void {
    this._hidePanel();
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
    this._panelEl = null;
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

    const extrudeHeightM = Math.min(
      maxRangeM * Math.tan((elevMaxDeg * Math.PI) / 180),
      50_000
    );

    return { zone, minRing, maxRing, extrudeHeightM, preset };
  }

  // ─── Private: Symbols ───────────────────────────────────────────────────────

  private _is3D(): boolean {
    return this._view?.type === '3d';
  }

  /** Returns fill alpha (0-255) from the panel's fill-opacity slider. */
  private _getFillAlpha(): number {
    const pct = Number(this._inp('wez-fill-opacity')?.value ?? 22);
    return Math.round((pct / 100) * 255);
  }

  private _wezZoneSymbol(color: [number, number, number], extrudeM: number): any {
    const [r, g, b] = color;
    const alpha = this._getFillAlpha();
    if (this._is3D()) {
      const layers: any[] = [{
        type: 'fill',
        material: { color: [r, g, b, alpha] },
        outline: { color: [r, g, b, 210], size: 1.8 },
      }];
      if (extrudeM > 0 && this._panelEl) {
        const extrudeCheck = this._panelEl.querySelector<HTMLInputElement>('#wez-opt-extrude');
        if (extrudeCheck?.checked) {
          layers.push({
            type: 'extrude',
            material: { color: [r, g, b, Math.round(alpha * 0.55)] },
            edges: { type: 'solid', color: [r, g, b, 60], size: 0.5 },
            size: extrudeM,
          });
        }
      }
      return { type: 'polygon-3d', symbolLayers: layers } as any;
    }
    return {
      type: 'simple-fill',
      color: [r, g, b, alpha],
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
    if (zone) {
      this._analysisLayer.add(new Graphic({
        geometry: zone,
        symbol: this._wezZoneSymbol(preset.color, extrudeHeightM),
        attributes: {
          type: 'wez_zone', weaponType: this._weaponKey(), minRangeM: minR,
          maxRangeM: maxR, azimuthCenterDeg: azC, azimuthSpreadDeg: azSp,
          elevMaxDeg: elevMax, extrudeHeightM,
          fillOpacity: Number(this._inp('wez-fill-opacity')?.value ?? 22),
        },
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

    const coordsEl = this._panelEl?.querySelector<HTMLElement>('#wez-coords');
    if (coordsEl) {
      const lat = this._observerPoint.latitude ?? 0;
      const lon = this._observerPoint.longitude ?? 0;
      coordsEl.textContent = `Observer: ${lat.toFixed(5)}°N  ${lon.toFixed(5)}°E`;
    }
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

      const sampler = await (view as any).createElevationSampler(extent, { noDataValue: 0 });
      const obsZ = (sampler.queryElevation(this._observerPoint)?.z ?? 0) + 2;
      const NUM_RAYS = 72;
      const STEP_M   = Math.max(25, maxR / 200);
      const numSteps = Math.ceil(maxR / STEP_M);
      const maskedIndices: number[] = [];

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
          const samplePt = new Point({ longitude, latitude, spatialReference: { wkid: 4326 } });
          const terrainZ = sampler.queryElevation(samplePt)?.z ?? 0;
          const slope = Math.atan2(terrainZ - obsZ, dist);

          if (slope >= maxSlope) {
            maxSlope = slope;
          } else if (maxSlope > 0.017) {
            blocked = true;
            break;
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

    return `
      <div class="wez-header" id="wez-drag-handle">
        <span class="wez-header-icon">${preset.icon}</span>
        <span class="wez-header-title">WEZ Analysis${isEdit ? ' — Re-edit' : ''}</span>
        <span class="wez-status-dot" id="wez-status-dot"></span>
        <span class="wez-status-lbl" id="wez-status-lbl">${isEdit ? 'Restored' : 'Awaiting'}</span>
        <button class="wez-minimize-btn" id="wez-minimize-btn" title="Minimize">▼</button>
        <button class="wez-close-btn" id="wez-close-btn" title="Close (keeps graphics)">✕</button>
      </div>

      <div class="wez-body">

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

    // Reposition
    p.querySelector('#wez-reposition-btn')?.addEventListener('click', () => this._startReposition());

    // Clear
    p.querySelector('#wez-clear-btn')?.addEventListener('click', () => {
      this._analysisLayer.removeAll();
      this._observerLayer.removeAll();
      this._observerPoint = null;
      const coordsEl = p.querySelector<HTMLElement>('#wez-coords');
      if (coordsEl) coordsEl.textContent = 'Observer: click map to place';
      const commitBtn = p.querySelector<HTMLButtonElement>('#wez-commit-btn');
      if (commitBtn) commitBtn.disabled = true;
      this._setStatus('awaiting');
    });

    // Commit
    p.querySelector('#wez-commit-btn')?.addEventListener('click', () => this._commit());
  }

  private _startReposition(): void {
    if (!this._view) return;
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
    this._panelEl.style.left = `${Math.max(0, x)}px`;
    this._panelEl.style.top  = `${Math.max(0, y)}px`;
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
        width: 282px;
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
        min-width: 50px;
      }
      .wez-minimize-btn, .wez-close-btn {
        background: none;
        border: none;
        color: var(--ms-text-dim);
        font-size: var(--ms-fs-sm);
        cursor: pointer;
        padding: 0 2px;
        line-height: 1;
        transition: color 0.15s;
        flex-shrink: 0;
      }
      .wez-minimize-btn:hover, .wez-close-btn:hover { color: var(--ms-text); }

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
        font-size: var(--ms-fs-xs);
        color: var(--ms-accent);
        padding: 2px 12px 6px;
        letter-spacing: 0.04em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

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
