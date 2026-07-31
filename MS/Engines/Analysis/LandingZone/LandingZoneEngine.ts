import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import MediaLayer from '@arcgis/core/layers/MediaLayer';
import ExtentAndRotationGeoreference from '@arcgis/core/layers/support/ExtentAndRotationGeoreference';
import ImageElement from '@arcgis/core/layers/support/ImageElement';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Extent from '@arcgis/core/geometry/Extent';
import Polygon from '@arcgis/core/geometry/Polygon';
import * as geometryEngine from '@arcgis/core/geometry/geometryEngine';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils';
import EngineLogger from '../../../Support/EngineLogger';

/**
 * LandingZoneEngine
 * ─────────────────
 * Evaluates the suitability of a helicopter Landing Zone / Pickup Zone / Drop
 * Zone (LZ/PZ/DZ). Mirrors the PosDefScorerEngine lifecycle and self-hosted
 * panel pattern (initialize / open / openWidget / close / destroy + draggable
 * HTML panels appended to document.body).
 *
 * Two input modes:
 *   • "zone"   — score a drawn LZ/PZ/DZ polygon (opened from context menu).
 *   • "search" — click a point and search a radius for the best touchdown spots.
 *
 * Map output:
 *   • Suitability heatmap (MediaLayer raster: green→amber→red by slope).
 *   • Touchdown-point markers with rotor-clearance spacing rings.
 *   • Approach / departure corridor fans (obstacle-clear lanes).
 *   • Obstacle callouts (peaks penetrating the approach glide surface).
 *
 * Reuses the LocalPeaksEngine headless peak detector and the
 * PosDefScorerEngine.scorePoint headless API where available.
 */

const WGS84 = { wkid: 4326 } as any;
const ENGINE_NAME = 'LandingZoneEngine';
const EARTH_R = 6_371_008.8;
const M_PER_DEG = 111_320;

type FactorId = 'slope' | 'size' | 'obstacle' | 'approach' | 'conceal' | 'defend';

interface FactorDef {
  id: FactorId;
  label: string;
  icon: string;
  color: string;
}

interface GradeDef {
  min: number;
  grade: string;
  label: string;
  color: string;
}

interface Touchdown {
  longitude: number;
  latitude: number;
  slopeDeg: number;
}

interface ObstacleHit {
  longitude: number;
  latitude: number;
  height: number;
  penetrates: boolean;
  bearing: number;
  distM: number;
}

interface AnalysisResult {
  scores: Record<FactorId, number>;
  composite: number;
  center: Point;
  extent: Extent;
  touchdowns: Touchdown[];
  obstacles: ObstacleHit[];
  flatFraction: number;
  capacity: number;
  approachClear: boolean;
  departureClear: boolean;
}

const FACTORS: FactorDef[] = [
  { id: 'slope', label: 'Surface slope', icon: 'SLP', color: '#1D9E75' },
  { id: 'size', label: 'Size / capacity', icon: 'CAP', color: '#378ADD' },
  { id: 'obstacle', label: 'Obstacles', icon: 'OBS', color: '#EF9F27' },
  { id: 'approach', label: 'Approach lanes', icon: 'APR', color: '#B428DC' },
  { id: 'conceal', label: 'Concealment', icon: 'CCL', color: '#78C840' },
  { id: 'defend', label: 'Defensibility', icon: 'DEF', color: '#DC3C30' },
];

const GRADE: GradeDef[] = [
  { min: 70, grade: 'GO', label: 'Suitable', color: '#1D9E75' },
  { min: 45, grade: 'CAUTION', label: 'Marginal', color: '#EF9F27' },
  { min: 0, grade: 'NO-GO', label: 'Unsuitable', color: '#DC3C30' },
];

// Helicopter landing diameters (m) — touchdown + rotor clearance footprint.
const AIRCRAFT: Record<string, { label: string; clearanceM: number }> = {
  light: { label: 'Light (OH-58 / H125)', clearanceM: 35 },
  utility: { label: 'Utility (UH-60)', clearanceM: 50 },
  cargo: { label: 'Cargo (CH-47)', clearanceM: 80 },
  heavy: { label: 'Heavy (CH-53)', clearanceM: 100 },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getGrade(score: number): GradeDef {
  return GRADE.find((g) => score >= g.min) ?? GRADE[GRADE.length - 1];
}

function destPt(lon: number, lat: number, brg: number, dist: number): { longitude: number; latitude: number } {
  const d = dist / EARTH_R;
  const b = (brg * Math.PI) / 180;
  const p1 = (lat * Math.PI) / 180;
  const l1 = (lon * Math.PI) / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { longitude: (l2 * 180) / Math.PI, latitude: (p2 * 180) / Math.PI };
}

function geoDist(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

function bearingDeg(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const cosLat = Math.cos((lat1 * Math.PI) / 180);
  return ((Math.atan2((lon2 - lon1) * cosLat, lat2 - lat1) * 180) / Math.PI + 360) % 360;
}

function polygonCentroid(geom: any): Point | null {
  if (!geom) return null;
  if (geom.type === 'point') return geom as Point;
  if (geom.centroid) return geom.centroid as Point;
  if (geom.extent?.center) return geom.extent.center as Point;
  return null;
}

export class LandingZoneEngine {
  static readonly MARKER_LAYER_ID = 'lz-touchdown-markers';
  static readonly CORRIDOR_LAYER_ID = 'lz-approach-corridors';
  static readonly OBSTACLE_LAYER_ID = 'lz-obstacle-callouts';
  static readonly ZONE_LAYER_ID = 'lz-zone-outline';

  private _view: MapView | SceneView | null = null;
  private _markerLayer!: GraphicsLayer;
  private _corridorLayer!: GraphicsLayer;
  private _obstacleLayer!: GraphicsLayer;
  private _zoneLayer!: GraphicsLayer;
  private _mediaLayers: MediaLayer[] = [];

  private _outPanelEl: HTMLDivElement | null = null;
  private _ctrlPanelEl: HTMLDivElement | null = null;
  private _hintEl: HTMLDivElement | null = null;
  private _clickHandle: any = null;
  private _draggableBound: WeakSet<HTMLElement> = new WeakSet();

  private _mode: 'zone' | 'search' = 'search';
  private _zonePolygon: Polygon | null = null;
  private _running = false;

  constructor() {
    this._createLayers();
  }

  initialize(view: MapView | SceneView): void {
    if (this._view === view) return;
    this._unbindMapClick();
    this._view = view;
    const map = view.map as any;
    if (map && !map.findLayerById(this._zoneLayer.id)) {
      map.addMany([this._zoneLayer, this._markerLayer, this._corridorLayer, this._obstacleLayer]);
    }
    if (this._ctrlPanelEl && this._ctrlPanelEl.style.display !== 'none' && this._mode === 'search') {
      this._bindMapClick();
    }
  }

  /** Open from context menu against a drawn LZ/PZ/DZ polygon and score it. */
  open(graphic: Graphic, view: MapView | SceneView): void {
    this.initialize(view);
    this._ensurePanels();
    this._showPanels();
    const geom = graphic?.geometry as any;
    if (geom && (geom.type === 'polygon' || geom.rings)) {
      this._mode = 'zone';
      this._zonePolygon = this._toGeographicPolygon(geom);
      this._syncModeUI();
      const c = polygonCentroid(geom);
      if (c) {
        const center = new Point({ longitude: c.longitude ?? c.x, latitude: c.latitude ?? c.y, spatialReference: WGS84 });
        void this._run(center);
      }
    } else {
      this._mode = 'search';
      this._syncModeUI();
      this._bindMapClick();
    }
  }

  /** Open standalone — defaults to click-to-search mode. */
  openWidget(view?: MapView | SceneView): void {
    if (view) this.initialize(view);
    if (!this._view) return;
    this._ensurePanels();
    this._showPanels();
    if (this._mode === 'search') this._bindMapClick();
  }

  close(): void {
    this._hidePanels();
    this._unbindMapClick();
  }

  destroy(): void {
    this.close();
    this._clearAll();
    const map = this._view?.map as any;
    if (map) {
      [this._zoneLayer, this._markerLayer, this._corridorLayer, this._obstacleLayer, ...this._mediaLayers]
        .forEach((layer) => { try { map.remove(layer); } catch {} });
    }
    this._outPanelEl?.remove();
    this._ctrlPanelEl?.remove();
    this._hintEl?.remove();
    this._outPanelEl = null;
    this._ctrlPanelEl = null;
    this._hintEl = null;
    this._view = null;
  }

  // ─── Layers ────────────────────────────────────────────────────────────────

  private _createLayers(): void {
    const opt = (id: string, title: string) =>
      new GraphicsLayer({ id, title, elevationInfo: { mode: 'on-the-ground' } as any });
    this._zoneLayer = opt(LandingZoneEngine.ZONE_LAYER_ID, 'Landing Zone - Zone');
    this._markerLayer = opt(LandingZoneEngine.MARKER_LAYER_ID, 'Landing Zone - Touchdowns');
    this._corridorLayer = opt(LandingZoneEngine.CORRIDOR_LAYER_ID, 'Landing Zone - Approach Corridors');
    this._obstacleLayer = opt(LandingZoneEngine.OBSTACLE_LAYER_ID, 'Landing Zone - Obstacles');
  }

  // ─── Analysis ────────────────────────────────────────────────────────────────

  private async _run(center: Point): Promise<void> {
    if (this._running || !this._view) return;
    this._running = true;
    this._button('lz-btn-run')?.setAttribute('disabled', 'true');
    this._clearOverlays();

    const maxSlope = this._num('lz-inp-slope', 7);
    const acType = this._select('lz-inp-aircraft', 'utility');
    const acCount = this._num('lz-inp-count', 2);
    const approachBrg = this._num('lz-inp-approach', 0);
    const threatBrg = this._num('lz-inp-threat', 180);
    const searchRadius = this._num('lz-inp-radius', 600);
    const showHeat = this._checked('lz-opt-heat', true);
    const showSpots = this._checked('lz-opt-spots', true);
    const showCorr = this._checked('lz-opt-corridor', true);
    const showObs = this._checked('lz-opt-obstacle', true);

    this._setStatus('running', 'Sampling terrain...');
    this._setProgress(0.1, 'Building elevation sampler');

    try {
      const result = await this._analyze(center, {
        maxSlope, acType, acCount, approachBrg, threatBrg, searchRadius,
      });

      this._setProgress(0.6, 'Rendering overlays');
      if (showHeat) await this._drawHeatmap(center, result, maxSlope);
      this._drawZoneOutline(result);
      if (showSpots) this._drawTouchdowns(result, acType);
      if (showCorr) this._drawCorridors(center, result, approachBrg);
      if (showObs) this._drawObstacles(result);

      this._setProgress(0.95, 'Scoring');
      this._updateScoreUI(result);
      this._setProgress(1, `Done — ${getGrade(result.composite).grade}`);
      this._setStatus('done', `Scored — ${result.composite}/100`);
      this._goToPoint(center);
      this._button('lz-btn-run')?.removeAttribute('disabled');
    } catch (err) {
      console.warn('[LandingZoneEngine] analysis failed', err);
      this._setStatus('ready', 'Analysis failed');
      this._setProgress(0, 'Unable to complete LZ analysis');
    } finally {
      this._running = false;
    }
  }

  private async _analyze(
    center: Point,
    p: { maxSlope: number; acType: string; acCount: number; approachBrg: number; threatBrg: number; searchRadius: number },
  ): Promise<AnalysisResult> {
    if (!this._view) throw new Error('No active view');
    const cLon = center.longitude ?? center.x;
    const cLat = center.latitude ?? center.y;
    const cosLat = Math.max(0.1, Math.cos((cLat * Math.PI) / 180));

    // Define the analysis extent: zone bbox (zone mode) or search circle (search mode).
    let extent: Extent;
    let inZone: (lon: number, lat: number) => boolean;
    if (this._mode === 'zone' && this._zonePolygon) {
      const poly = this._zonePolygon;
      const e = poly.extent;
      if (!e) throw new Error('Zone polygon has no extent');
      extent = new Extent({
        xmin: e.xmin, ymin: e.ymin, xmax: e.xmax, ymax: e.ymax,
        spatialReference: WGS84,
      });
      inZone = (lon, lat) => {
        try { return poly.contains(new Point({ longitude: lon, latitude: lat, spatialReference: WGS84 })); }
        catch { return true; }
      };
    } else {
      const padDeg = (p.searchRadius * 1.05) / M_PER_DEG;
      extent = new Extent({
        xmin: cLon - padDeg / cosLat,
        ymin: cLat - padDeg,
        xmax: cLon + padDeg / cosLat,
        ymax: cLat + padDeg,
        spatialReference: WGS84,
      });
      inZone = (lon, lat) => geoDist(cLon, cLat, lon, lat) <= p.searchRadius;
    }

    const sampler = await (this._view.map as any).ground.createElevationSampler(extent);
    // Reused scratch Point — getZ is synchronous, so one shared point is safe.
    const zPt = new Point({ longitude: 0, latitude: 0, spatialReference: WGS84 });
    const getZ = (lon: number, lat: number): number => {
      try {
        zPt.longitude = lon;
        zPt.latitude = lat;
        const r = sampler.queryElevation(zPt);
        return Number.isFinite(r?.z) ? r.z : 0;
      } catch { return 0; }
    };

    // Slope grid over the extent (~40 m cells, capped at 64×64).
    const widthM = (extent.xmax - extent.xmin) * M_PER_DEG * cosLat;
    const heightM = (extent.ymax - extent.ymin) * M_PER_DEG;
    const cols = clamp(Math.round(widthM / 40), 8, 64);
    const rows = clamp(Math.round(heightM / 40), 8, 64);
    const dLon = (extent.xmax - extent.xmin) / cols;
    const dLat = (extent.ymax - extent.ymin) / rows;
    const cellM = Math.max(widthM / cols, heightM / rows);

    // Build elevation grid (padded by 1 cell for neighbour slope).
    const elev = new Float32Array((cols + 1) * (rows + 1));
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const lon = extent.xmin + c * dLon;
        const lat = extent.ymax - r * dLat;
        elev[r * (cols + 1) + c] = getZ(lon, lat);
      }
    }
    const slopeAt = (c: number, r: number): number => {
      const z = elev[r * (cols + 1) + c];
      const zr = elev[r * (cols + 1) + (c + 1)];
      const zd = elev[(r + 1) * (cols + 1) + c];
      const dzx = Math.abs(zr - z);
      const dzy = Math.abs(zd - z);
      return (Math.atan2(Math.max(dzx, dzy), cellM) * 180) / Math.PI;
    };

    // Flat-cell collection + flat-fraction (inside zone only).
    const flat: Touchdown[] = [];
    let inCount = 0;
    let flatCount = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lon = extent.xmin + (c + 0.5) * dLon;
        const lat = extent.ymax - (r + 0.5) * dLat;
        if (!inZone(lon, lat)) continue;
        inCount++;
        const slope = slopeAt(c, r);
        if (slope <= p.maxSlope) {
          flatCount++;
          flat.push({ longitude: lon, latitude: lat, slopeDeg: slope });
        }
      }
    }
    const flatFraction = inCount > 0 ? flatCount / inCount : 0;

    // Touchdown placement: greedily pick flattest cells spaced ≥ clearance apart.
    const clearance = AIRCRAFT[p.acType]?.clearanceM ?? 50;
    const sorted = [...flat].sort((a, b) => a.slopeDeg - b.slopeDeg);
    const touchdowns: Touchdown[] = [];
    for (const cand of sorted) {
      if (touchdowns.length >= p.acCount) break;
      const ok = touchdowns.every(
        (t) => geoDist(t.longitude, t.latitude, cand.longitude, cand.latitude) >= clearance,
      );
      if (ok) touchdowns.push(cand);
    }
    const capacity = touchdowns.length;

    // Obstacles via the LocalPeaks headless detector (best-effort; degrades to []).
    const obstacles: ObstacleHit[] = [];
    try {
      const peaksEngine = (window as any).symbolEngine?.localPeaksEngine;
      if (peaksEngine?.runHeadless) {
        const peaks = await peaksEngine.runHeadless({
          aoi: extent,
          mode: 'peaks',
          cellSizeM: 60,
          prominenceM: 8,
          maxResults: 20,
        });
        const lzZ = getZ(cLon, cLat);
        const glideAngle = Math.atan(1 / 10) * 180 / Math.PI; // ~5.7° standard approach gradient
        for (const pk of peaks as any[]) {
          const d = geoDist(cLon, cLat, pk.longitude, pk.latitude);
          if (d > (this._mode === 'search' ? p.searchRadius * 1.6 : cellM * cols)) continue;
          const height = pk.elevation - lzZ;
          if (height < 5) continue;
          const brg = bearingDeg(cLon, cLat, pk.longitude, pk.latitude);
          // Penetrates if it rises above the glide surface along an approach lane.
          const glideHeight = d * Math.tan((glideAngle * Math.PI) / 180);
          const nearLane =
            this._angleClose(brg, p.approachBrg, 25) || this._angleClose(brg, (p.approachBrg + 180) % 360, 25);
          const penetrates = nearLane && height > glideHeight;
          obstacles.push({ longitude: pk.longitude, latitude: pk.latitude, height, penetrates, bearing: brg, distM: d });
        }
      }
    } catch { /* peaks unavailable */ }

    // Approach / departure corridor clearance (no penetrating obstacle in lane).
    const approachClear = !obstacles.some((o) => o.penetrates && this._angleClose(o.bearing, p.approachBrg, 25));
    const departureClear = !obstacles.some((o) => o.penetrates && this._angleClose(o.bearing, (p.approachBrg + 180) % 360, 25));

    // Concealment + defensibility via PosDef headless scorePoint (best-effort).
    let concealScore = 10;
    let defendScore = 10;
    try {
      const posDef = (window as any).symbolEngine?.posDefScorerEngine;
      if (posDef?.scorePoint) {
        const summary = await posDef.scorePoint(center, { threatBearingDeg: p.threatBrg, obsRadius: 2000 });
        concealScore = clamp(summary.scores?.cfv ?? 10, 0, 20);
        defendScore = clamp(Math.round((summary.composite ?? 50) / 5), 0, 20);
      }
    } catch { /* posdef unavailable */ }

    // Factor scores (0–20).
    const slopeScore = Math.round(clamp(flatFraction * 20, 0, 20));
    const sizeScore = Math.round(clamp((capacity / Math.max(1, p.acCount)) * 20, 0, 20));
    const penetrating = obstacles.filter((o) => o.penetrates).length;
    const obstacleScore = Math.round(clamp(20 - penetrating * 6, 0, 20));
    const approachScore = (approachClear ? 10 : 0) + (departureClear ? 10 : 0);

    const scores: Record<FactorId, number> = {
      slope: slopeScore,
      size: sizeScore,
      obstacle: obstacleScore,
      approach: approachScore,
      conceal: concealScore,
      defend: defendScore,
    };
    const composite = this._composite(scores);

    return { scores, composite, center, extent, touchdowns, obstacles, flatFraction, capacity, approachClear, departureClear };
  }

  private _composite(scores: Record<FactorId, number>): number {
    // Slope, size and approach dominate go/no-go; concealment & defensibility refine.
    const w: Record<FactorId, number> = { slope: 5, size: 4, obstacle: 4, approach: 4, conceal: 2, defend: 2 };
    const wT = Object.values(w).reduce((s, v) => s + v, 0);
    return Math.round(FACTORS.reduce((s, f) => s + (scores[f.id] ?? 0) * (w[f.id] / 20), 0) / wT * 100);
  }

  private _angleClose(a: number, b: number, tol: number): boolean {
    return Math.abs(((a - b + 540) % 360) - 180) <= tol;
  }

  /** Normalise a drawn polygon (often Web Mercator) to WGS84 geographic. */
  private _toGeographicPolygon(geom: any): Polygon {
    try {
      if (geom?.spatialReference?.isWebMercator) {
        return webMercatorUtils.webMercatorToGeographic(geom) as Polygon;
      }
    } catch { /* fall through */ }
    return geom as Polygon;
  }

  // ─── Rendering ────────────────────────────────────────────────────────────────

  private async _drawHeatmap(center: Point, result: AnalysisResult, maxSlope: number): Promise<void> {
    if (!this._view) return;
    const extent = result.extent;
    const cLon = center.longitude ?? center.x;
    const cLat = center.latitude ?? center.y;
    const cosLat = Math.cos((cLat * Math.PI) / 180);
    const cols = 96;
    const rows = 96;
    const dLon = (extent.xmax - extent.xmin) / cols;
    const dLat = (extent.ymax - extent.ymin) / rows;
    let sampler: any = null;
    try { sampler = await (this._view.map as any).ground.createElevationSampler(extent); } catch { /* */ }
    const getZ = (lon: number, lat: number): number => {
      try { const r = sampler?.queryElevation(new Point({ longitude: lon, latitude: lat, spatialReference: WGS84 })); return Number.isFinite(r?.z) ? r.z : 0; } catch { return 0; }
    };
    const cellM = Math.max(20, ((extent.xmax - extent.xmin) * M_PER_DEG * cosLat) / cols);
    const poly = this._mode === 'zone' ? this._zonePolygon : null;
    const radius = this._num('lz-inp-radius', 600);

    const canvas = document.createElement('canvas');
    canvas.width = cols; canvas.height = rows;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(cols, rows);
    for (let r = 0; r < rows; r++) {
      if (r % 16 === 0) await this._tick();
      for (let c = 0; c < cols; c++) {
        const lon = extent.xmin + (c + 0.5) * dLon;
        const lat = extent.ymax - (r + 0.5) * dLat;
        const inside = poly
          ? (() => { try { return poly.contains(new Point({ longitude: lon, latitude: lat, spatialReference: WGS84 })); } catch { return false; } })()
          : geoDist(cLon, cLat, lon, lat) <= radius;
        if (!inside) continue;
        const z = getZ(lon, lat);
        const zr = getZ(lon + dLon, lat);
        const zd = getZ(lon, lat - dLat);
        const slope = (Math.atan2(Math.max(Math.abs(zr - z), Math.abs(zd - z)), cellM) * 180) / Math.PI;
        const px = (r * cols + c) * 4;
        let rgb: [number, number, number];
        if (slope <= maxSlope) rgb = [29, 158, 117];
        else if (slope <= maxSlope * 1.8) rgb = [239, 159, 39];
        else rgb = [200, 50, 40];
        img.data[px] = rgb[0]; img.data[px + 1] = rgb[1]; img.data[px + 2] = rgb[2]; img.data[px + 3] = 120;
      }
    }
    ctx.putImageData(img, 0, 0);
    const ml = new MediaLayer({
      source: [new ImageElement({ image: canvas.toDataURL('image/png'), georeference: new ExtentAndRotationGeoreference({ extent }) })],
      title: 'Landing Zone - Suitability',
    });
    (this._view.map as any).add(ml, 0);
    this._mediaLayers.push(ml);
  }

  private _drawZoneOutline(result: AnalysisResult): void {
    if (this._mode === 'zone' && this._zonePolygon) {
      this._zoneLayer.add(new Graphic({
        geometry: this._zonePolygon,
        symbol: { type: 'simple-fill', color: [0, 0, 0, 0], outline: { color: [255, 255, 255, 200], width: 1.5, style: 'dash' } } as any,
        attributes: { type: 'lz_zone' },
      }));
    } else {
      const radius = this._num('lz-inp-radius', 600);
      const circle = geometryEngine.geodesicBuffer(result.center, radius, 'meters') as any;
      if (circle) {
        this._zoneLayer.add(new Graphic({
          geometry: circle,
          symbol: { type: 'simple-fill', color: [0, 0, 0, 0], outline: { color: [255, 255, 255, 180], width: 1.2, style: 'dash' } } as any,
          attributes: { type: 'lz_search' },
        }));
      }
    }
    this._zoneLayer.add(new Graphic({
      geometry: result.center,
      symbol: { type: 'simple-marker', style: 'x', color: [255, 255, 255, 230], size: 12, outline: { color: [0, 0, 0, 160], width: 1 } } as any,
      attributes: { type: 'lz_center' },
    }));
  }

  private _drawTouchdowns(result: AnalysisResult, acType: string): void {
    const clearance = AIRCRAFT[acType]?.clearanceM ?? 50;
    result.touchdowns.forEach((t, i) => {
      const pt = new Point({ longitude: t.longitude, latitude: t.latitude, spatialReference: WGS84 });
      const ring = geometryEngine.geodesicBuffer(pt, clearance / 2, 'meters') as any;
      if (ring) {
        this._markerLayer.add(new Graphic({
          geometry: ring,
          symbol: { type: 'simple-fill', color: [29, 158, 117, 40], outline: { color: [29, 158, 117, 200], width: 1.4 } } as any,
          attributes: { type: 'lz_clearance' },
        }));
      }
      this._markerLayer.add(new Graphic({
        geometry: pt,
        symbol: { type: 'simple-marker', style: 'circle', color: [29, 158, 117, 230], size: 9, outline: { color: [255, 255, 255, 220], width: 1.4 } } as any,
        attributes: { type: `Touchdown ${i + 1}`, label: `Slope ${t.slopeDeg.toFixed(1)}°` },
      }));
      this._markerLayer.add(new Graphic({
        geometry: pt,
        symbol: this._textSymbol(`H${i + 1}`, '#1D9E75', 16),
        attributes: { type: 'lz_td_label' },
      }));
    });
  }

  private _drawCorridors(center: Point, result: AnalysisResult, approachBrg: number): void {
    const cLon = center.longitude ?? center.x;
    const cLat = center.latitude ?? center.y;
    const len = this._mode === 'search' ? this._num('lz-inp-radius', 600) * 2.2 : 900;
    const half = 14; // half-angle of the corridor fan
    const make = (brg: number, clear: boolean, label: string) => {
      const ring: number[][] = [[cLon, cLat]];
      for (let a = -half; a <= half; a += 2) {
        const p = destPt(cLon, cLat, (brg + a + 360) % 360, len);
        ring.push([p.longitude, p.latitude]);
      }
      ring.push([cLon, cLat]);
      const poly = new Polygon({ rings: [ring], spatialReference: WGS84 });
      const rgb = clear ? [55, 138, 221] : [200, 50, 40];
      this._corridorLayer.add(new Graphic({
        geometry: poly,
        symbol: { type: 'simple-fill', color: [...rgb, 38], outline: { color: [...rgb, 170], width: 1.2, style: clear ? 'solid' : 'dash' } } as any,
        attributes: { type: label, label: clear ? 'Clear lane' : 'Obstructed lane' },
      }));
      const tip = destPt(cLon, cLat, brg, len);
      this._corridorLayer.add(new Graphic({
        geometry: new Point({ longitude: tip.longitude, latitude: tip.latitude, spatialReference: WGS84 }),
        symbol: this._textSymbol(label === 'Approach corridor' ? 'APPR' : 'DEPT', clear ? '#378ADD' : '#DC3C30', 0),
        attributes: { type: 'lz_corridor_label' },
      }));
    };
    make(approachBrg, result.approachClear, 'Approach corridor');
    make((approachBrg + 180) % 360, result.departureClear, 'Departure corridor');
  }

  private _drawObstacles(result: AnalysisResult): void {
    result.obstacles.forEach((o) => {
      const pt = new Point({ longitude: o.longitude, latitude: o.latitude, spatialReference: WGS84 });
      const rgb = o.penetrates ? [220, 50, 40] : [239, 159, 39];
      this._obstacleLayer.add(new Graphic({
        geometry: pt,
        symbol: { type: 'simple-marker', style: 'triangle', color: [...rgb, 230], size: 11, outline: { color: [0, 0, 0, 170], width: 1 } } as any,
        attributes: { type: o.penetrates ? 'Obstacle (penetrates approach)' : 'Obstacle', label: `+${Math.round(o.height)} m` },
      }));
      this._obstacleLayer.add(new Graphic({
        geometry: pt,
        symbol: this._textSymbol(`+${Math.round(o.height)}m`, o.penetrates ? '#DC3C30' : '#EF9F27', 14),
        attributes: { type: 'lz_obstacle_label' },
      }));
    });
  }

  // ─── Panels ────────────────────────────────────────────────────────────────

  private _ensurePanels(): void {
    if (!this._outPanelEl) {
      this._outPanelEl = document.createElement('div');
      this._outPanelEl.id = 'lz-left-panel';
      this._outPanelEl.className = 'ms-panel ms-theme-ops-dark';
      this._outPanelEl.style.cssText = 'position: absolute; top: 14px; left: 14px; width: 400px; z-index: 1098; max-height: calc(100vh - 28px); display: none; flex-direction: column;';
      this._outPanelEl.innerHTML = this._outPanelHtml();
      document.body.appendChild(this._outPanelEl);
    }
    if (!this._ctrlPanelEl) {
      this._ctrlPanelEl = document.createElement('div');
      this._ctrlPanelEl.id = 'lz-right-panel';
      this._ctrlPanelEl.className = 'ms-panel ms-theme-ops-dark';
      this._ctrlPanelEl.style.cssText = 'position: absolute; top: 14px; right: 14px; width: 300px; z-index: 1098; max-height: calc(100vh - 28px); overflow-y: auto; display: none;';
      this._ctrlPanelEl.innerHTML = this._ctrlPanelHtml();
      document.body.appendChild(this._ctrlPanelEl);
      this._bindPanelEvents();
    }
    if (!this._hintEl) {
      this._hintEl = document.createElement('div');
      this._hintEl.id = 'lz-hint';
      this._hintEl.style.cssText = 'position: absolute; bottom: 55px; left: 50%; transform: translateX(-50%); z-index: 1098; display: none; font-family: monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; padding: 8px 22px; border-radius: 6px; pointer-events: none; background: rgba(20, 24, 32, 0.94); color: var(--ms-text, #dce8f5); border: 1px solid var(--ms-border, rgba(90, 130, 200, 0.35));';
      this._hintEl.textContent = 'Click map to search for landing spots';
      document.body.appendChild(this._hintEl);
    }
    this._makePanelDraggable(this._outPanelEl);
    this._makePanelDraggable(this._ctrlPanelEl);
    this._syncModeUI();
  }

  private _outPanelHtml(): string {
    return `
      <div class="ms-header"><div class="ms-header-title">Landing Zone</div></div>
      <div class="ms-body" style="display: flex; flex-direction: column; overflow-y: auto;">
        <div style="padding: 14px 16px; border-bottom: var(--ms-divider); font-size: 14px; color: var(--ms-text-dim);" id="lz-sub">Click map or score a drawn zone</div>
        <div style="display: flex; align-items: center; gap: 20px; padding: 18px; border-bottom: var(--ms-divider);">
          <div style="position: relative; width: 130px; height: 130px; flex-shrink: 0;">
            <svg width="130" height="130" viewBox="0 0 90 90">
              <circle cx="45" cy="45" r="38" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="7"></circle>
              <circle id="lz-arc" cx="45" cy="45" r="38" fill="none" stroke="var(--ms-accent)" stroke-width="7" stroke-dasharray="0 239" stroke-linecap="round" transform="rotate(-90 45 45)"></circle>
            </svg>
            <div id="lz-num" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 40px; font-weight: 800; color: var(--ms-accent);">-</div>
          </div>
          <div style="flex: 1;">
            <div id="lz-grade" style="font-size: 26px; font-weight: 800; color: var(--ms-accent); margin-bottom: 6px;">-</div>
            <div id="lz-desc" style="font-size: 13px; color: var(--ms-text-dim); line-height: 1.5;">Place or select a zone to assess.</div>
          </div>
        </div>
        <div id="lz-factors" style="overflow-y: auto; flex: 1; padding: 14px 16px;">
          <div style="padding: 20px 12px; font-size: 13px; color: var(--ms-text-dim); text-align: center;">Factor scores appear after analysis.</div>
        </div>
        <div id="lz-obstacle-list" style="display: none; border-top: var(--ms-divider); max-height: 130px; overflow-y: auto;">
          <div style="font-size: 8.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ms-text-dim); padding: 6px 12px 3px;">Obstacles</div>
          <div id="lz-obstacle-rows"></div>
        </div>
      </div>
    `;
  }

  private _ctrlPanelHtml(): string {
    return `
      <div class="ms-header">
        <div class="ms-header-title">Landing Zone</div>
        <button class="ms-btn" id="lz-close-btn" title="Close" style="padding: 4px 8px; font-size: var(--ms-fs-xs);">✕</button>
      </div>
      <div class="ms-body" style="display: flex; flex-direction: column; overflow-y: auto;">
        <div style="padding: 8px 12px; font-size: var(--ms-fs-xs); letter-spacing: 0.07em; text-transform: uppercase; color: var(--ms-text-dim);" id="lz-status">Ready</div>
        <div class="ms-section-title">Mode</div>
        <div style="display: flex; gap: 6px; padding: 0 12px 8px;">
          <button class="ms-btn" id="lz-mode-search" style="flex: 1;">Click-to-search</button>
          <button class="ms-btn" id="lz-mode-zone" style="flex: 1;">Score drawn zone</button>
        </div>
        <div class="ms-section-title">Aircraft</div>
        <div class="ms-grid">
          <div class="ms-field"><label class="ms-label">Type</label><select id="lz-inp-aircraft" class="ms-select">
            <option value="light">Light</option><option value="utility" selected>Utility</option><option value="cargo">Cargo</option><option value="heavy">Heavy</option>
          </select></div>
          <div class="ms-field"><label class="ms-label">Count</label><input id="lz-inp-count" type="number" value="2" min="1" max="20" step="1" class="ms-input"></div>
        </div>
        <div class="ms-section-title">Terrain &amp; geometry</div>
        ${this._sliderRow('Max slope (deg)', 'slope', 2, 15, 1, 7, '°')}
        ${this._sliderRow('Approach bearing (deg)', 'approach', 0, 359, 5, 0, '°')}
        ${this._sliderRow('Threat axis (deg)', 'threat', 0, 359, 5, 180, '°')}
        <div id="lz-radius-row">${this._sliderRow('Search radius (m)', 'radius', 200, 2000, 50, 600)}</div>
        <div class="ms-section-title">Overlays</div>
        ${this._toggleRow('Suitability heatmap', 'heat', true)}
        ${this._toggleRow('Touchdown spots', 'spots', true)}
        ${this._toggleRow('Approach corridors', 'corridor', true)}
        ${this._toggleRow('Obstacle callouts', 'obstacle', true)}
        <div class="ms-divider" style="margin: 4px 0;"></div>
        <div style="padding: 0 12px 9px;"><div style="height: 4px; background: var(--ms-bg-subtle); border-radius: 2px; overflow: hidden;"><div id="lz-prog-fill" style="height: 100%; background: linear-gradient(to right, var(--ms-accent), #378ADD); width: 0%; transition: width 0.12s;"></div></div><div id="lz-prog-label" style="font-size: var(--ms-fs-xs); color: var(--ms-text-dim); margin-top: 4px;">-</div></div>
        <div style="display: flex; gap: 6px; padding: 9px 12px;">
          <button class="ms-btn" id="lz-btn-clear" style="flex: 1;">Clear</button>
          <button class="ms-btn ms-btn-primary" id="lz-btn-run" style="flex: 1;">Analyze</button>
        </div>
      </div>
    `;
  }

  private _sliderRow(label: string, id: string, min: number, max: number, step: number, value: number, suffix = ''): string {
    return `<div style="display: flex; align-items: center; gap: 8px; padding: 0 12px 8px;"><label style="font-size: var(--ms-fs-xs); letter-spacing: 0.07em; text-transform: uppercase; color: var(--ms-text-dim); flex: 1.8;" class="ms-label">${label}</label><input id="lz-inp-${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" style="flex: 2; accent-color: var(--ms-accent); cursor: pointer;"><div id="lz-${id}-v" style="font-size: var(--ms-fs-xs); color: var(--ms-accent); min-width: 38px; text-align: right;">${value}${suffix}</div></div>`;
  }

  private _toggleRow(label: string, id: string, checked: boolean): string {
    return `<div style="display: flex; align-items: center; justify-content: space-between; padding: 5px 12px;"><label style="font-size: var(--ms-fs-xs); letter-spacing: 0.07em; text-transform: uppercase; color: var(--ms-text-dim); cursor: pointer;" class="ms-label">${label}</label><input id="lz-opt-${id}" type="checkbox"${checked ? ' checked' : ''} style="accent-color: var(--ms-accent); width: 13px; height: 13px; cursor: pointer;"></div>`;
  }

  private _bindPanelEvents(): void {
    const p = this._ctrlPanelEl;
    if (!p) return;
    [['slope', '°'], ['approach', '°'], ['threat', '°'], ['radius', '']].forEach(([id, suffix]) => {
      this._input(`lz-inp-${id}`)?.addEventListener('input', () => this._setText(`lz-${id}-v`, `${this._input(`lz-inp-${id}`)?.value ?? ''}${suffix}`));
    });
    p.querySelector('#lz-close-btn')?.addEventListener('click', () => this.close());
    p.querySelector('#lz-mode-search')?.addEventListener('click', () => { this._mode = 'search'; this._zonePolygon = null; this._syncModeUI(); this._bindMapClick(); });
    p.querySelector('#lz-mode-zone')?.addEventListener('click', () => { this._mode = 'zone'; this._syncModeUI(); this._unbindMapClick(); });
    p.querySelector('#lz-btn-run')?.addEventListener('click', () => {
      if (this._mode === 'zone' && this._zonePolygon) {
        const c = polygonCentroid(this._zonePolygon);
        if (c) void this._run(new Point({ longitude: c.longitude ?? c.x, latitude: c.latitude ?? c.y, spatialReference: WGS84 }));
      } else {
        this._setStatus('ready', 'Click the map to choose a search centre');
      }
    });
    p.querySelector('#lz-btn-clear')?.addEventListener('click', () => this._clearAll());
  }

  private _syncModeUI(): void {
    const search = this._button('lz-mode-search');
    const zone = this._button('lz-mode-zone');
    if (search) search.style.background = this._mode === 'search' ? 'rgba(55,138,221,0.18)' : '';
    if (zone) zone.style.background = this._mode === 'zone' ? 'rgba(55,138,221,0.18)' : '';
    const radiusRow = this._el('lz-radius-row');
    if (radiusRow) radiusRow.style.display = this._mode === 'search' ? 'block' : 'none';
    if (this._hintEl) {
      this._hintEl.textContent = this._mode === 'search'
        ? 'Click map to search for landing spots'
        : 'Adjust parameters, then Analyze the drawn zone';
    }
  }

  private _bindMapClick(): void {
    if (!this._view || this._clickHandle) return;
    this._clickHandle = this._view.on('click', async (event: any) => {
      if (this._running || !this._view || this._mode !== 'search') return;
      const mp = event.mapPoint as Point | null;
      if (!mp) return;
      const pt = new Point({ longitude: mp.longitude ?? mp.x, latitude: mp.latitude ?? mp.y, spatialReference: WGS84 });
      await this._run(pt);
    });
  }

  private _unbindMapClick(): void {
    this._clickHandle?.remove?.();
    this._clickHandle = null;
  }

  // ─── Output UI ────────────────────────────────────────────────────────────────

  private _updateScoreUI(result: AnalysisResult): void {
    const g = getGrade(result.composite);
    const arc = this._el('lz-arc') as SVGCircleElement | null;
    const circ = 2 * Math.PI * 38;
    if (arc) {
      arc.style.strokeDasharray = `${(result.composite / 100) * circ} ${circ}`;
      arc.style.stroke = g.color;
    }
    this._setText('lz-num', String(result.composite));
    this._setStyle('lz-num', 'color', g.color);
    this._setText('lz-grade', g.grade);
    this._setStyle('lz-grade', 'color', g.color);
    this._setText('lz-sub', `${g.label} — ${result.capacity} touchdown${result.capacity === 1 ? '' : 's'}`);
    this._setText('lz-desc', this._description(result));

    const wrap = this._el('lz-factors');
    if (wrap) {
      wrap.innerHTML = '';
      FACTORS.forEach((f) => {
        const s = result.scores[f.id] ?? 0;
        const row = document.createElement('div');
        row.style.cssText = 'display: grid; grid-template-columns: 40px 1fr 50px; align-items: center; gap: 10px; margin-bottom: 12px;';
        row.innerHTML = `<div style="font-size: 16px; text-align: center; color: var(--ms-text-dim);">${f.icon}</div><div style="display: flex; flex-direction: column; gap: 4px;"><div style="font-size: 14px; font-weight: 600; color: var(--ms-text);">${f.label}</div><div style="height: 6px; background: var(--ms-bg-subtle); border-radius: 3px;"><div style="height: 100%; border-radius: 3px; transition: width 0.5s; width: ${(s / 20) * 100}%; background: ${f.color};"></div></div></div><div style="font-size: 22px; font-weight: 800; text-align: right; color: ${f.color};">${s}</div>`;
        wrap.appendChild(row);
      });
    }
    this._renderObstacleList(result.obstacles);
  }

  private _renderObstacleList(obstacles: ObstacleHit[]): void {
    const wrap = this._el('lz-obstacle-list');
    const rows = this._el('lz-obstacle-rows');
    if (!wrap || !rows) return;
    if (!obstacles.length) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'block';
    rows.innerHTML = '';
    obstacles
      .slice()
      .sort((a, b) => Number(b.penetrates) - Number(a.penetrates) || b.height - a.height)
      .slice(0, 12)
      .forEach((o) => {
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const dir = dirs[Math.round(o.bearing / 45) % 8];
        const color = o.penetrates ? '#DC3C30' : '#EF9F27';
        const row = document.createElement('div');
        row.style.cssText = 'display: flex; align-items: center; gap: 7px; padding: 4px 12px;';
        row.innerHTML = `<div style="width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: ${color};"></div><div style="flex: 1; font-size: 11px; color: var(--ms-text-dim);">+${Math.round(o.height)} m · ${dir} · ${Math.round(o.distM)} m</div><div style="font-size: 10px; font-weight: 700; color: ${color};">${o.penetrates ? 'PEN' : 'clr'}</div>`;
        rows.appendChild(row);
      });
  }

  private _description(result: AnalysisResult): string {
    const pen = result.obstacles.filter((o) => o.penetrates).length;
    if (result.composite >= 70) return `Suitable LZ. ${result.capacity} aircraft fit; approaches ${result.approachClear && result.departureClear ? 'clear' : 'partially obstructed'}.`;
    if (result.composite >= 45) {
      const issues: string[] = [];
      if (result.flatFraction < 0.5) issues.push('limited flat surface');
      if (pen) issues.push(`${pen} obstacle${pen === 1 ? '' : 's'} in approach`);
      if (!result.approachClear || !result.departureClear) issues.push('obstructed lane');
      return `Marginal — ${issues.join(', ') || 'review factors'}. Use with caution.`;
    }
    return `Unsuitable — ${result.flatFraction < 0.3 ? 'too steep/broken' : 'insufficient capacity or blocked approaches'}. Seek an alternate site.`;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private _clearAll(): void {
    [this._zoneLayer, this._markerLayer, this._corridorLayer, this._obstacleLayer].forEach((l) => l.removeAll());
    this._clearOverlays();
    this._setText('lz-sub', 'Click map or score a drawn zone');
    this._setText('lz-num', '-');
    this._setText('lz-grade', '-');
    this._setText('lz-desc', 'Place or select a zone to assess.');
    const arc = this._el('lz-arc') as SVGCircleElement | null;
    if (arc) arc.style.strokeDasharray = '0 239';
    const factors = this._el('lz-factors');
    if (factors) factors.innerHTML = '<div style="padding: 20px 12px; font-size: 13px; color: var(--ms-text-dim); text-align: center;">Factor scores appear after analysis.</div>';
    const obs = this._el('lz-obstacle-list');
    if (obs) obs.style.display = 'none';
    this._setProgress(0, '-');
    this._setStatus('ready', 'Ready');
  }

  private _clearOverlays(): void {
    const map = this._view?.map as any;
    this._mediaLayers.forEach((l) => { try { map?.remove(l); } catch {} });
    this._mediaLayers = [];
    [this._zoneLayer, this._markerLayer, this._corridorLayer, this._obstacleLayer].forEach((l) => l.removeAll());
  }

  private _goToPoint(pt: Point): void {
    const target = this._view?.type === '3d'
      ? { center: [pt.longitude, pt.latitude], zoom: 15, tilt: 60 }
      : { center: [pt.longitude, pt.latitude], zoom: 15 };
    void this._view?.goTo(target as any, { duration: 800 }).catch(() => {});
  }

  private _showPanels(): void {
    if (this._outPanelEl) this._outPanelEl.style.display = 'flex';
    if (this._ctrlPanelEl) this._ctrlPanelEl.style.display = 'block';
    if (this._hintEl) this._hintEl.style.display = 'block';
  }

  private _hidePanels(): void {
    if (this._outPanelEl) this._outPanelEl.style.display = 'none';
    if (this._ctrlPanelEl) this._ctrlPanelEl.style.display = 'none';
    if (this._hintEl) this._hintEl.style.display = 'none';
  }

  private _makePanelDraggable(panel: HTMLDivElement | null): void {
    if (!panel) return;
    const handle = panel.querySelector('.ms-header') as HTMLElement | null;
    if (!handle || this._draggableBound.has(panel)) return;
    this._draggableBound.add(panel);
    handle.style.cursor = 'grab';
    handle.style.userSelect = 'none';
    let ox = 0; let oy = 0;

    // The document-level handlers live only for the duration of a drag — the
    // same pattern the other analysis engines use. Registering them once and
    // leaving them there ran a handler on every mousemove for the life of the
    // page, and pinned `panel` in their closures so it could never be collected.
    const onMove = (e: MouseEvent) => {
      const maxLeft = window.innerWidth - panel.offsetWidth - 4;
      const maxTop = window.innerHeight - panel.offsetHeight - 4;
      panel.style.left = Math.max(0, Math.min(e.clientX - ox, maxLeft)) + 'px';
      panel.style.top = Math.max(0, Math.min(e.clientY - oy, maxTop)) + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      handle.style.cursor = 'grab'; document.body.style.userSelect = '';
    };

    handle.addEventListener('mousedown', (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button, input, select')) return;
      const rect = panel.getBoundingClientRect();
      panel.style.left = rect.left + 'px'; panel.style.top = rect.top + 'px';
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
      ox = e.clientX - rect.left; oy = e.clientY - rect.top;
      handle.style.cursor = 'grabbing'; document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
  }

  private _textSymbol(text: string, color: string, yoffset: number): any {
    return { type: 'text', text, color, haloColor: [0, 0, 0, 190], haloSize: 2, font: { family: 'Courier New', size: 10, weight: 'bold' }, yoffset, horizontalAlignment: 'center' };
  }

  private _setStatus(s: 'ready' | 'running' | 'done', t: string): void {
    const el = this._el('lz-status');
    if (s === 'done') EngineLogger.success(ENGINE_NAME, t);
    else EngineLogger.nextStep(ENGINE_NAME, t);
    if (el) {
      el.textContent = t;
      el.style.color = s === 'running' ? '#EF9F27' : 'var(--ms-accent)';
    }
  }

  private _setProgress(f: number, label: string): void {
    const fill = this._el('lz-prog-fill');
    if (fill) fill.style.width = `${Math.round(clamp(f, 0, 1) * 100)}%`;
    this._setText('lz-prog-label', label);
  }

  private _tick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  private _el(id: string): HTMLElement | null { return document.getElementById(id); }
  private _input(id: string): HTMLInputElement | null { return this._el(id) as HTMLInputElement | null; }
  private _button(id: string): HTMLButtonElement | null { return this._el(id) as HTMLButtonElement | null; }
  private _num(id: string, fallback: number): number {
    const value = Number(this._input(id)?.value ?? fallback);
    return Number.isFinite(value) ? value : fallback;
  }
  private _select(id: string, fallback: string): string {
    return (this._el(id) as HTMLSelectElement | null)?.value ?? fallback;
  }
  private _checked(id: string, fallback: boolean): boolean {
    const el = this._el(id) as HTMLInputElement | null;
    return el ? el.checked : fallback;
  }
  private _setText(id: string, value: string): void {
    const el = this._el(id);
    if (el) el.textContent = value;
  }
  private _setStyle(id: string, prop: keyof CSSStyleDeclaration, value: string): void {
    const el = this._el(id);
    if (el) (el.style as any)[prop] = value;
  }
}

export default LandingZoneEngine;
