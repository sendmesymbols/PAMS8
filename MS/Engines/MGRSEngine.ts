/**
 * MGRSEngine.ts
 * On-demand MGRS grid overlay for ArcGIS 2D and 3D views.
 *
 * GZD boundaries use pure lat/lon math (Norwegian + Svalbard exceptions included).
 * 100 km / 10 km sub-grids use compact Transverse Mercator (UTM) math — no
 * external library dependency.
 *
 * Singleton — MGRSEngine.getInstance().
 */

import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import Polyline from '@arcgis/core/geometry/Polyline';
import Point from '@arcgis/core/geometry/Point';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import TextSymbol from '@arcgis/core/symbols/TextSymbol';
import Font from '@arcgis/core/symbols/Font';
import Color from '@arcgis/core/Color';
import * as reactiveUtils from '@arcgis/core/core/reactiveUtils';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import SpatialReference from '@arcgis/core/geometry/SpatialReference';
import EngineLogger from '../Support/EngineLogger';

// ── MGRS encoding (no external dependency) ─────────────────────────────────────

const UTM_LETTERS = 'CDEFGHJKLMNPQRSTUVWX';

function _utmZoneLetter(lat: number, lon: number): string {
  const zone = Math.floor((lon + 180) / 6) + 1;
  const latBand = Math.floor((lat + 80) / 8);
  const band = UTM_LETTERS[latBand] || 'X';
  let zoneLetter = band;
  if (zone >= 3 && zone <= 4 && band === 'V') zoneLetter = 'V';
  if (zone >= 31 && zone <= 37 && band === 'X') zoneLetter = 'X';
  return `${zone}${zoneLetter}`;
}

function _formatMGRSLabel(lat: number, lon: number, intervalM: number): string {
  const zone = Math.floor((lon + 180) / 6) + 1;
  const latBand = Math.floor((lat + 80) / 8);
  const band = UTM_LETTERS[latBand] || 'X';
  const zoneLetter = `${zone}${band}`;

  const zoneOrigin = (zone - 1) * 6 - 180 + 3;
  const isSouth = lat < 0;
  const utm = latLonToUTM(lat, lon, zone);
  const e = utm.e - 100000 * Math.floor(utm.e / 100000);
  const n = utm.n - (isSouth ? 10000000 : 0);
  const e100k = Math.floor(e / 100000);
  const n100k = Math.floor(n / 100000);

  if (intervalM <= 100) {
    const eVal = Math.floor((e % 100000) / intervalM);
    const nVal = Math.floor((n % 100000) / intervalM);
    return `${zoneLetter} ${e100k}${n100k} ${String(eVal).padStart(4, '0')} ${String(nVal).padStart(4, '0')}`;
  } else if (intervalM <= 1000) {
    const eVal = Math.floor((e % 100000) / intervalM);
    const nVal = Math.floor((n % 100000) / intervalM);
    return `${zoneLetter} ${e100k}${n100k} ${String(eVal).padStart(3, '0')}${String(nVal).padStart(3, '0')}`;
  } else if (intervalM <= 10000) {
    const eVal = Math.floor((e % 100000) / intervalM);
    const nVal = Math.floor((n % 100000) / intervalM);
    return `${zoneLetter} ${e100k}${n100k} ${String(eVal).padStart(2, '0')}${String(nVal).padStart(2, '0')}`;
  } else {
    return `${zoneLetter} ${e100k}${n100k}`;
  }
}

// ── Public option types ────────────────────────────────────────────────────────

export interface MGRSEngineOptions {
  showGZD?: boolean;
  show100K?: boolean;
  show10K?: boolean;
  show1K?: boolean;
  show100M?: boolean;
  autoZoom?: boolean;

  gzdColor?: [number, number, number];
  gzdOpacity?: number;
  gzdWidth?: number;

  hundredKColor?: [number, number, number];
  hundredKOpacity?: number;
  hundredKWidth?: number;

  tenKColor?: [number, number, number];
  tenKOpacity?: number;
  tenKWidth?: number;

  oneKColor?: [number, number, number];
  oneKOpacity?: number;
  oneKWidth?: number;

  hundredMColor?: [number, number, number];
  hundredMOpacity?: number;
  hundredMWidth?: number;

  showLabels?: boolean;
  labelSize?: number;
  labelColor?: [number, number, number];
  labelOpacity?: number;
}

// ── GZD tables ─────────────────────────────────────────────────────────────────

const BAND_LETTERS = ['C','D','E','F','G','H','J','K','L','M','N','P','Q','R','S','T','U','V','W','X'];

const BAND_SOUTH: Record<string, number> = {
  C:-80, D:-72, E:-64, F:-56, G:-48, H:-40, J:-32, K:-24, L:-16, M:-8,
  N:0,   P:8,   Q:16,  R:24,  S:32,  T:40,  U:48,  V:56,  W:64,  X:72,
};
const BAND_NORTH: Record<string, number> = {
  C:-72, D:-64, E:-56, F:-48, G:-40, H:-32, J:-24, K:-16, L:-8,  M:0,
  N:8,   P:16,  Q:24,  R:32,  S:40,  T:48,  U:56,  V:64,  W:72,  X:84,
};

const WGS84_SR = new SpatialReference({ wkid: 4326 });
const REBUILD_DEBOUNCE_MS = 200;

const ZOOM_100K = 6;
const ZOOM_10K  = 9;
const ZOOM_1K   = 12;
const ZOOM_100M = 14;

// ── Compact UTM ↔ WGS-84 math ─────────────────────────────────────────────────
// Transverse Mercator (Karney 2011, accuracy < 1 mm across all UTM zones)

const _a  = 6378137.0;              // WGS-84 semi-major axis
const _f  = 1 / 298.257223563;     // flattening
const _k0 = 0.9996;                 // UTM scale factor
const _e2 = 2 * _f - _f * _f;       // first eccentricity squared
const _ep2 = _e2 / (1 - _e2);       // second eccentricity squared
const _e = Math.sqrt(_e2);

/** WGS-84 lat/lon → UTM {easting, northing} for a given zone number. */
function latLonToUTM(latDeg: number, lonDeg: number, zone: number): { e: number; n: number } {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const lon0 = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);

  const N  = _a / Math.sqrt(1 - _e2 * Math.sin(lat) ** 2);
  const T  = Math.tan(lat) ** 2;
  const C  = _ep2 * Math.cos(lat) ** 2;
  const A  = Math.cos(lat) * (lon - lon0);
  const M  = _a * (
    (1 - _e2 / 4 - 3 * _e2 ** 2 / 64 - 5 * _e2 ** 3 / 256) * lat
    - (3 * _e2 / 8 + 3 * _e2 ** 2 / 32 + 45 * _e2 ** 3 / 1024) * Math.sin(2 * lat)
    + (15 * _e2 ** 2 / 256 + 45 * _e2 ** 3 / 1024) * Math.sin(4 * lat)
    - (35 * _e2 ** 3 / 3072) * Math.sin(6 * lat)
  );

  const easting = _k0 * N * (
    A + (1 - T + C) * A ** 3 / 6
    + (5 - 18 * T + T ** 2 + 72 * C - 58 * _ep2) * A ** 5 / 120
  ) + 500000;

  const northingRaw = _k0 * (
    M + N * Math.tan(lat) * (
      A ** 2 / 2
      + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24
      + (61 - 58 * T + T ** 2 + 600 * C - 330 * _ep2) * A ** 6 / 720
    )
  );
  const northing = latDeg < 0 ? northingRaw + 10000000 : northingRaw;

  return { e: easting, n: northing };
}

/** UTM → WGS-84 lat/lon (degrees). */
function utmToLatLon(zone: number, southern: boolean, easting: number, northing: number): { lat: number; lon: number } {
  const x = easting - 500000;
  const y = southern ? northing - 10000000 : northing;

  const M = y / _k0;
  const mu = M / (_a * (1 - _e2 / 4 - 3 * _e2 ** 2 / 64 - 5 * _e2 ** 3 / 256));

  const e1 = (1 - Math.sqrt(1 - _e2)) / (1 + Math.sqrt(1 - _e2));
  const phi1 = mu
    + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
    + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);

  const N1  = _a / Math.sqrt(1 - _e2 * Math.sin(phi1) ** 2);
  const T1  = Math.tan(phi1) ** 2;
  const C1  = _ep2 * Math.cos(phi1) ** 2;
  const R1  = _a * (1 - _e2) / Math.pow(1 - _e2 * Math.sin(phi1) ** 2, 1.5);
  const D   = x / (N1 * _k0);

  const lat = phi1 - (N1 * Math.tan(phi1) / R1) * (
    D ** 2 / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * _ep2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * _ep2 - 3 * C1 ** 2) * D ** 6 / 720
  );

  const lon0rad = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
  const lon = lon0rad + (
    D
    - (1 + 2 * T1 + C1) * D ** 3 / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * _ep2 + 24 * T1 ** 2) * D ** 5 / 120
  ) / Math.cos(phi1);

  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}

/** Compute the UTM northing range (south, north) for a given lat band in a UTM zone. */
function bandNorthingRange(letter: string, zone: number): { south: number; north: number; isSouth: boolean } {
  const latS = BAND_SOUTH[letter];
  const latN = BAND_NORTH[letter];
  const isSouth = latN <= 0;
  const ns = latLonToUTM(latS, (zone - 1) * 6 - 180 + 3, zone).n;
  const nn = latLonToUTM(latN === 84 ? 83.99 : latN, (zone - 1) * 6 - 180 + 3, zone).n;
  return { south: Math.min(ns, nn), north: Math.max(ns, nn), isSouth };
}

// ── Engine ─────────────────────────────────────────────────────────────────────

export default class MGRSEngine {
  private static _instance: MGRSEngine | null = null;

  private _view: MapView | SceneView | null = null;
  private _layer: GraphicsLayer | null = null;
  private _enabled = false;
  private _active = false;
  private _handles: Array<{ remove(): void }> = [];
  private _rebuildTimer: ReturnType<typeof setTimeout> | null = null;

  private _opts: Required<MGRSEngineOptions> = {
    showGZD:         true,
    show100K:        true,
    show10K:         false,
    show1K:          false,
    show100M:        false,
    autoZoom:        true,
    gzdColor:        [255, 200, 50],
    gzdOpacity:      0.85,
    gzdWidth:        1.5,
    hundredKColor:   [255, 200, 50],
    hundredKOpacity: 0.55,
    hundredKWidth:   0.8,
    tenKColor:       [255, 200, 50],
    tenKOpacity:     0.35,
    tenKWidth:       0.5,
    oneKColor:       [255, 200, 50],
    oneKOpacity:     0.25,
    oneKWidth:       0.35,
    hundredMColor:   [255, 200, 50],
    hundredMOpacity: 0.2,
    hundredMWidth:   0.3,
    showLabels:      true,
    labelSize:       11,
    labelColor:      [255, 255, 255],
    labelOpacity:    0.9,
  };

  private constructor() {}

  static getInstance(): MGRSEngine {
    if (!MGRSEngine._instance) MGRSEngine._instance = new MGRSEngine();
    return MGRSEngine._instance;
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  start(view: MapView | SceneView): void {
    if (this._active) return;
    this._view = view;
    this._layer = new GraphicsLayer({ id: 'MGRSGridLayer', listMode: 'hide', elevationInfo: { mode: 'on-the-ground' } as any });
    view.map.add(this._layer);
    this._active = true;
    this._setupWatcher();
    EngineLogger.success('MGRSEngine', 'started');
  }

  enable(): void {
    if (!this._active || this._enabled) return;
    this._enabled = true;
    this._scheduleRebuild();
    EngineLogger.success('MGRSEngine', 'enabled');
  }

  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    this._layer?.removeAll();
    EngineLogger.nextStep('MGRSEngine', 'disabled');
  }

  toggle(): boolean {
    this._enabled ? this.disable() : this.enable();
    return this._enabled;
  }

  setOptions(opts: Partial<MGRSEngineOptions>): void {
    // Only assign defined values to avoid overwriting defaults with undefined
    for (const key in opts) {
      if ((opts as any)[key] !== undefined) {
        (this._opts as any)[key] = (opts as any)[key];
      }
    }
    if (this._enabled) this._scheduleRebuild();
  }

  refresh(): void {
    if (this._enabled) this._rebuild();
  }

  onViewChanged(newView: MapView | SceneView): void {
    this._clearHandles();
    if (this._rebuildTimer !== null) { clearTimeout(this._rebuildTimer); this._rebuildTimer = null; }
    this._layer?.removeAll();
    if (this._view?.map && this._layer) this._view.map.remove(this._layer);
    this._layer = null;
    this._view = null;
    this._active = false;
    this.start(newView);
    if (this._enabled) this._scheduleRebuild();
  }

  destroy(): void {
    this._clearHandles();
    if (this._rebuildTimer !== null) { clearTimeout(this._rebuildTimer); this._rebuildTimer = null; }
    this._layer?.removeAll();
    if (this._view?.map && this._layer) this._view.map.remove(this._layer);
    this._layer = null;
    this._view = null;
    this._active = false;
    this._enabled = false;
    MGRSEngine._instance = null;
    EngineLogger.nextStep('MGRSEngine', 'destroyed');
  }

  get isEnabled(): boolean { return this._enabled; }
  get isActive():  boolean { return this._active;  }

  // ── Watcher ───────────────────────────────────────────────────────────────────

  private _setupWatcher(): void {
    if (!this._view) return;
    const h = reactiveUtils.watch(
      () => (this._view as any)?.stationary,
      (stationary: boolean) => { if (stationary && this._enabled) this._scheduleRebuild(); },
      { initial: true }
    );
    this._handles.push(h);
  }

  private _scheduleRebuild(): void {
    if (this._rebuildTimer !== null) clearTimeout(this._rebuildTimer);
    this._rebuildTimer = setTimeout(() => { this._rebuildTimer = null; this._rebuild(); }, REBUILD_DEBOUNCE_MS);
  }

  // ── Rebuild ───────────────────────────────────────────────────────────────────

  private _rebuild(): void {
    if (!this._view || !this._layer || !this._enabled) return;
    const extent = this._view.extent;
    if (!extent) return;

    const sr = this._view.spatialReference;
    const isWebMerc = sr?.wkid === 102100 || sr?.wkid === 3857;
    const zoom = (this._view as any).zoom ?? 5;

    if (isWebMerc) {
      const ext4326 = webMercatorUtils.webMercatorToGeographic(extent) as any;
      if (ext4326) this._rebuildWGS84(ext4326.xmin, ext4326.ymin, ext4326.xmax, ext4326.ymax, zoom);
    } else {
      this._rebuildWGS84(extent.xmin, extent.ymin, extent.xmax, extent.ymax, zoom);
    }
  }

  private _rebuildWGS84(west: number, south: number, east: number, north: number, zoom: number): void {
    if (!this._layer) return;

    const clampS = Math.max(south, -80);
    const clampN = Math.min(north,  84);
    if (clampS >= clampN) { this._layer.removeAll(); return; }

    const o = this._opts;
    const show100K = o.show100K && (!o.autoZoom || zoom >= ZOOM_100K);
    const show10K  = o.show10K  && (!o.autoZoom || zoom >= ZOOM_10K);
    const show1K   = o.show1K   && (!o.autoZoom || zoom >= ZOOM_1K);
    const show100M = o.show100M && (!o.autoZoom || zoom >= ZOOM_100M);

    const graphics: Graphic[] = [];

    if (o.showGZD) {
      graphics.push(...this._buildGZDLines(west, clampS, east, clampN));
      if (o.showLabels) graphics.push(...this._buildGZDLabels(west, clampS, east, clampN));
    }

    if (show100M || show1K || show10K || show100K) {
      const interval = show100M ? 100 : (show1K ? 1000 : (show10K ? 10000 : 100000));
      const color = show100M
        ? o.hundredMColor
        : (show1K ? o.oneKColor : (show10K ? o.tenKColor : o.hundredKColor));
      const opacity = show100M
        ? o.hundredMOpacity
        : (show1K ? o.oneKOpacity : (show10K ? o.tenKOpacity : o.hundredKOpacity));
      const width = show100M
        ? o.hundredMWidth
        : (show1K ? o.oneKWidth : (show10K ? o.tenKWidth : o.hundredKWidth));
      graphics.push(...this._buildSubGridLines(west, clampS, east, clampN, interval, color, opacity, width));
      if (o.showLabels) {
        graphics.push(...this._buildSubGridLabels(west, clampS, east, clampN, interval));
      }
    }

    this._layer.removeAll();
    this._layer.addMany(graphics);
    EngineLogger.log('MGRSEngine', 'info', `Rebuilt WGS84 grid with ${graphics.length} graphics.`);
  }

  // ── GZD — pure math ─────────────────────────────────────────────────────────

  private _buildGZDLines(west: number, south: number, east: number, north: number): Graphic[] {
    const graphics: Graphic[] = [];
    const sym = this._lineSym(this._opts.gzdColor, this._opts.gzdOpacity, this._opts.gzdWidth);

    // Horizontal lines (latitude band edges -80 to 84)
    for (const letter of BAND_LETTERS) {
      const lat = BAND_SOUTH[letter];
      if (lat < south - 0.01 || lat > north + 0.01) continue;
      const w = Math.max(west, -180), e = Math.min(east, 180);
      if (w < e) {
        if (e - w > 170) {
          graphics.push(this._lineGraphic([[w, lat], [(w+e)/2, lat], [e, lat]], sym));
        } else {
          graphics.push(this._lineGraphic([[w, lat], [e, lat]], sym));
        }
      }
    }
    if (84 > south - 0.01 && 84 < north + 12) {
      const w = Math.max(west, -180), e = Math.min(east, 180);
      if (w < e) {
        if (e - w > 170) {
          graphics.push(this._lineGraphic([[w, 84], [(w+e)/2, 84], [e, 84]], sym));
        } else {
          graphics.push(this._lineGraphic([[w, 84], [e, 84]], sym));
        }
      }
    }

    // Vertical lines (zone meridians)
    for (let zone = 1; zone <= 60; zone++) {
      const lon = -180 + (zone - 1) * 6;
      if (lon < west - 0.01 || lon > east + 0.01) continue;

      const segs: Array<[number, number]> = [];

      if (lon === 6) {
        // Omit in band V (56–64) and band X (72–84)
        segs.push([-80, 56]); segs.push([64, 72]);
      } else if (lon >= 12 && lon <= 36 && lon % 6 === 0) {
        // Omit in band X only
        segs.push([-80, 72]);
      } else {
        segs.push([-80, 84]);
      }

      for (const [sS, sN] of segs) {
        const ds = Math.max(sS, south), dn = Math.min(sN, north);
        if (ds < dn) graphics.push(this._lineGraphic([[lon, ds], [lon, dn]], sym));
      }
    }

    // Norwegian exception: 3°E only in band V (56–64°N)
    if (3 >= west - 0.01 && 3 <= east + 0.01) {
      const ds = Math.max(56, south), dn = Math.min(64, north);
      if (ds < dn) graphics.push(this._lineGraphic([[3, ds], [3, dn]], sym));
    }

    // Standard zone 32 meridian (6°E) - omit in band V (Norwegian) and band X (Svalbard)
    if (6 >= west - 0.01 && 6 <= east + 0.01) {
      const segs: Array<[number, number]> = [];
      segs.push([-80, 56]); // Below band V
      segs.push([64, 72]);  // Band X (Svalbard gap)
      // Band V (56-64) is omitted - Norwegian exception uses 3°E instead
      for (const [sS, sN] of segs) {
        const ds = Math.max(sS, south), dn = Math.min(sN, north);
        if (ds < dn) graphics.push(this._lineGraphic([[6, ds], [6, dn]], sym));
      }
    }

    // Svalbard special meridians: 9°E, 21°E, 33°E in band X (72–84°N)
    for (const lon of [9, 21, 33]) {
      if (lon < west - 0.01 || lon > east + 0.01) continue;
      const ds = Math.max(72, south), dn = Math.min(84, north);
      if (ds < dn) graphics.push(this._lineGraphic([[lon, ds], [lon, dn]], sym));
    }

    return graphics;
  }

  private _buildGZDLabels(west: number, south: number, east: number, north: number): Graphic[] {
    const graphics: Graphic[] = [];
    const sym = this._textSym(this._opts.labelColor, this._opts.labelOpacity, this._opts.labelSize);

    for (const letter of BAND_LETTERS) {
      const bS = BAND_SOUTH[letter], bN = BAND_NORTH[letter];
      if (bN <= south || bS >= north) continue;
      const midLat = Math.max(south, Math.min(north, (bS + bN) / 2));

      for (let zone = 1; zone <= 60; zone++) {
        let cellW = -180 + (zone - 1) * 6;
        let cellE = cellW + 6;

        if (letter === 'V') {
          if      (zone === 31) { cellW = 0; cellE = 3;  }
          else if (zone === 32) { cellW = 3; cellE = 12; }
        }
        if (letter === 'X') {
          if (zone === 32 || zone === 34 || zone === 36) continue;
          if      (zone === 31) { cellW = 0;  cellE = 9;  }
          else if (zone === 33) { cellW = 9;  cellE = 21; }
          else if (zone === 35) { cellW = 21; cellE = 33; }
          else if (zone === 37) { cellW = 33; cellE = 42; }
        }

        if (cellE <= west || cellW >= east) continue;
        const midLon = Math.max(west, Math.min(east, (cellW + cellE) / 2));
        graphics.push(this._textGraphic(midLon, midLat, `${zone}${letter}`, sym));
      }
    }
    return graphics;
  }

  // ── Sub-grid lines via UTM math ───────────────────────────────────────────────

  private _buildSubGridLines(
    west: number, south: number, east: number, north: number,
    intervalM: number,
    color: [number, number, number], opacity: number, width: number,
  ): Graphic[] {
    const graphics: Graphic[] = [];
    const sym = this._lineSym(color, opacity, width);
    const STEP = 5; // number of intermediate points per line segment for curvature

    for (const letter of BAND_LETTERS) {
      const bS = BAND_SOUTH[letter], bN = BAND_NORTH[letter];
      if (bN <= south || bS >= north) continue;
      const isSouth = bN <= 0;

      for (let zone = 1; zone <= 60; zone++) {
        if (letter === 'X' && (zone === 32 || zone === 34 || zone === 36)) continue;

        // Approximate zone lon extent (use wider pad for Svalbard)
        const stdW = -180 + (zone - 1) * 6;
        const stdE = stdW + 6;
        const pad  = letter === 'X' ? 9 : 0.5;
        if (stdE + pad < west || stdW - pad > east) continue;

        try {
          // Find UTM extent for this band×zone using its corners
          const corners = [
            latLonToUTM(Math.max(bS, -80), stdW + 0.01, zone),
            latLonToUTM(Math.max(bS, -80), stdE - 0.01, zone),
            latLonToUTM(Math.min(bN,  83.99), stdW + 0.01, zone),
            latLonToUTM(Math.min(bN,  83.99), stdE - 0.01, zone),
          ];
          const eMin = Math.floor(Math.min(...corners.map(c => c.e)) / intervalM) * intervalM;
          const eMax = Math.ceil (Math.max(...corners.map(c => c.e)) / intervalM) * intervalM;
          const nMin = Math.floor(Math.min(...corners.map(c => c.n)) / intervalM) * intervalM;
          const nMax = Math.ceil (Math.max(...corners.map(c => c.n)) / intervalM) * intervalM;

          // Vertical lines (constant easting) — draw from south to north edge of band
          for (let e = eMin + intervalM; e < eMax; e += intervalM) {
            const pts: [number, number][] = [];
            for (let s = 0; s <= STEP; s++) {
              const nVal = nMin + (nMax - nMin) * (s / STEP);
              const p = utmToLatLon(zone, isSouth, e, nVal);
              if (p.lat < south - 0.01 || p.lat > north + 0.01) continue;
              pts.push([p.lon, p.lat]);
            }
            if (pts.length >= 2) graphics.push(this._lineGraphic(pts, sym));
          }

          // Horizontal lines (constant northing) — draw from west to east edge of band
          for (let n = nMin + intervalM; n < nMax; n += intervalM) {
            const pts: [number, number][] = [];
            for (let s = 0; s <= STEP; s++) {
              const eVal = eMin + (eMax - eMin) * (s / STEP);
              const p = utmToLatLon(zone, isSouth, eVal, n);
              if (p.lon < west - 0.01 || p.lon > east + 0.01) continue;
              pts.push([p.lon, p.lat]);
            }
            if (pts.length >= 2) graphics.push(this._lineGraphic(pts, sym));
          }
        } catch {
          // Skip any zone that throws (e.g., poles or projection singularity)
        }
      }
    }
    return graphics;
  }

  private _buildSubGridLabels(
    west: number, south: number, east: number, north: number,
    intervalM: number,
  ): Graphic[] {
    const graphics: Graphic[] = [];
    const baseSize = this._opts.labelSize;
    const labelSize =
      intervalM <= 100 ? Math.max(8, baseSize - 4) :
      intervalM <= 1000 ? Math.max(8, baseSize - 3) :
      intervalM <= 10000 ? Math.max(9, baseSize - 2) :
      Math.max(10, baseSize - 1);
    const sym = this._textSym(this._opts.labelColor, this._opts.labelOpacity, labelSize);

    // Keep label count bounded; sample cells if too dense.
    const targetMaxLabels = intervalM <= 100 ? 120 : 180;

    for (const letter of BAND_LETTERS) {
      const bS = BAND_SOUTH[letter], bN = BAND_NORTH[letter];
      if (bN <= south || bS >= north) continue;
      const isSouth = bN <= 0;

      for (let zone = 1; zone <= 60; zone++) {
        if (letter === 'X' && (zone === 32 || zone === 34 || zone === 36)) continue;

        const stdW = -180 + (zone - 1) * 6;
        const stdE = stdW + 6;
        const pad  = letter === 'X' ? 9 : 0.5;
        if (stdE + pad < west || stdW - pad > east) continue;

        try {
          const corners = [
            latLonToUTM(Math.max(bS, -80), stdW + 0.01, zone),
            latLonToUTM(Math.max(bS, -80), stdE - 0.01, zone),
            latLonToUTM(Math.min(bN,  83.99), stdW + 0.01, zone),
            latLonToUTM(Math.min(bN,  83.99), stdE - 0.01, zone),
          ];
          const eMin = Math.floor(Math.min(...corners.map(c => c.e)) / intervalM) * intervalM;
          const eMax = Math.ceil (Math.max(...corners.map(c => c.e)) / intervalM) * intervalM;
          const nMin = Math.floor(Math.min(...corners.map(c => c.n)) / intervalM) * intervalM;
          const nMax = Math.ceil (Math.max(...corners.map(c => c.n)) / intervalM) * intervalM;

          const eCount = Math.max(1, Math.floor((eMax - eMin) / intervalM));
          const nCount = Math.max(1, Math.floor((nMax - nMin) / intervalM));
          const totalCells = eCount * nCount;
          const stride = Math.max(1, Math.ceil(Math.sqrt(totalCells / targetMaxLabels)));

          for (let e = eMin + intervalM; e < eMax; e += intervalM * stride) {
            for (let n = nMin + intervalM; n < nMax; n += intervalM * stride) {
              const center = utmToLatLon(zone, isSouth, e + intervalM * 0.5, n + intervalM * 0.5);
              if (
                center.lon < west || center.lon > east ||
                center.lat < south || center.lat > north
              ) continue;
              graphics.push(this._textGraphic(center.lon, center.lat, this._formatSubGridLabel(e, n, intervalM, center.lon, center.lat), sym));
            }
          }
        } catch {
          // skip invalid zone segments
        }
      }
    }

    return graphics;
  }

  private _formatSubGridLabel(easting: number, northing: number, intervalM: number, lon: number, lat: number): string {
    return _formatMGRSLabel(lat, lon, intervalM);
  }

  // ── Graphic factories ──────────────────────────────────────────────────────

  private _lineGraphic(coords: [number, number][], sym: SimpleLineSymbol): Graphic {
    return new Graphic({
      geometry: new Polyline({ paths: [coords], spatialReference: WGS84_SR }),
      symbol: sym,
    });
  }

  private _textGraphic(lon: number, lat: number, text: string, sym: TextSymbol): Graphic {
    const symbolWithText = sym.clone();
    symbolWithText.text = text;
    return new Graphic({
      geometry: new Point({ longitude: lon, latitude: lat, spatialReference: WGS84_SR }),
      symbol: symbolWithText,
    });
  }

  private _lineSym(rgb: [number, number, number], opacity: number, width: number): SimpleLineSymbol {
    return new SimpleLineSymbol({ color: new Color([rgb[0], rgb[1], rgb[2], opacity]), width, style: 'solid' });
  }

  private _textSym(rgb: [number, number, number], opacity: number, size: number): TextSymbol {
    return new TextSymbol({
      color: new Color([rgb[0], rgb[1], rgb[2], opacity]),
      font: new Font({ size, family: 'Arial', weight: 'bold' }),
      haloColor: new Color([0, 0, 0, 0.7]),
      haloSize: '1.5px',
    });
  }

  private _clearHandles(): void {
    for (const h of this._handles) h.remove();
    this._handles = [];
  }
}
