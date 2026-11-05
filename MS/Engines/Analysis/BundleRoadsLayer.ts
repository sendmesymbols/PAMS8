/**
 * BundleRoadsLayer.ts
 * Draws the terrain bundle's road network (`<bundle>/network/tiles/10/x/y.json`): the SAME edges, attributes and
 * dataVersion the GeoCore routing server solves on, so a road has the same class on the map as in a route.
 *
 * Headless-safe and best-effort: a missing bundle or tile is logged and skipped, never thrown. Only the z10 tiles in
 * view are fetched (LRU-cached), and road classes are thinned by zoom so a country view is not millions of lines.
 *
 * Styling (military first): main supply route red and widest; recorded load class 60+ (tankable) orange; a recorded
 * class below 60 yellow; no recorded class grey, dashed on main roads so "class not recorded" is visible.
 */

import Graphic from '@arcgis/core/Graphic';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Polyline from '@arcgis/core/geometry/Polyline';
import * as reactiveUtils from '@arcgis/core/core/reactiveUtils';
import type MapView from '@arcgis/core/views/MapView';
import type SceneView from '@arcgis/core/views/SceneView';

const ENGINE_NAME = 'BundleRoadsLayer';
const ORIGIN = 20037508.342789244;
const TILE_Z = 10;
const MAX_TILES = 48;

/** Flag bits of a network edge (network.json edge.flagBits). */
export const ROAD_FLAGS = {
  oneway: 1 << 0,
  msr: 1 << 1,
  defence: 1 << 2,
  fairWeather: 1 << 3,
  matched: 1 << 4,
  tankable: 1 << 5,
  loadUnknown: 1 << 6,
  closedSeasonally: 1 << 7,
  landslide: 1 << 8,
  narrow: 1 << 9,
  transporter: 1 << 10,
  limited: 1 << 11,
} as const;

const CROSSING: Record<number, string> = {
  1: 'Bridge class 60+',
  2: 'Bridge class 50–59',
  3: 'Bridge below class 50',
  4: 'Bridge, class not recorded',
  5: 'Ford / ferry',
  6: 'Foot bridge',
  7: 'Railway bridge',
};

const CLAZZ: Record<number, string> = {
  11: 'Motorway', 12: 'Motorway link', 13: 'Trunk', 14: 'Trunk link', 15: 'Primary', 16: 'Primary link',
  21: 'Secondary', 22: 'Secondary link', 31: 'Tertiary', 32: 'Tertiary link', 41: 'Residential', 42: 'Road',
  43: 'Unclassified', 51: 'Service', 63: 'Track', 71: 'Track', 81: 'Path', 91: 'Path',
};

/** One drawn edge, as a tile line carries it. */
export interface BundleRoad {
  edge: number;
  clazz: number;
  flags: number;
  load: number;
  xing: number;
  name: string;
  roadNo: string;
}

export interface BundleRoadsOptions {
  /** Base URL of the terrain bundle (the folder holding manifest.json). */
  bundleUrl: string;
  layerId?: string;
}

interface TileData {
  key: string;
  graphics: Graphic[];
  raw: any[];
  minx: number;
  maxy: number;
  size: number;
  q: number;
}

export default class BundleRoadsLayer {
  private _view: MapView | SceneView | null = null;
  private _layer: GraphicsLayer | null = null;
  private _names: string[] | null = null;
  private _cache = new Map<string, TileData>(); // insertion order = LRU
  private _missing = new Set<string>();
  private _watch: { remove(): void } | null = null;
  private _drawnZoomBand = -1;
  private _gen = 0;
  dataVersion = '';

  constructor(private readonly _opts: BundleRoadsOptions) {}

  get layer(): GraphicsLayer | null {
    return this._layer;
  }

  /** True when the bundle has a road network to draw. */
  async available(): Promise<boolean> {
    try {
      const r = await fetch(`${this._base()}/network/network.json`);
      if (!r.ok) return false;
      const j = await r.json();
      this.dataVersion = String(j?.dataVersion ?? '');
      return j?.format === 'pams-road-network';
    } catch {
      return false;
    }
  }

  async show(view: MapView | SceneView): Promise<boolean> {
    this._view = view;
    if (!(await this.available())) {
      console.warn(`[${ENGINE_NAME}] No road network in the terrain bundle at ${this._base()}`);
      return false;
    }
    if (!this._names) {
      try {
        const r = await fetch(`${this._base()}/network/names.json`);
        this._names = r.ok ? await r.json() : [];
      } catch {
        this._names = [];
      }
    }
    if (!this._layer) {
      this._layer = new GraphicsLayer({ id: this._opts.layerId ?? 'bundle-roads', title: 'Roads (terrain bundle)', listMode: 'show' });
      view.map?.add(this._layer, 0);
    }
    this._watch?.remove();
    this._watch = reactiveUtils.when(
      () => view.stationary,
      () => void this._refresh(),
      { initial: true },
    );
    return true;
  }

  hide(): void {
    this._watch?.remove();
    this._watch = null;
    if (this._layer && this._view?.map) {
      try {
        this._view.map.remove(this._layer);
      } catch {
        /* view torn down */
      }
    }
    this._layer?.destroy();
    this._layer = null;
    this._cache.clear();
    this._drawnZoomBand = -1;
  }

  /** The road under or nearest a map point within `tolM` metres, from the tiles already loaded. */
  roadAt(x: number, y: number, tolM = 30): BundleRoad | null {
    let best: { d: number; road: BundleRoad } | null = null;
    for (const t of this._cache.values()) {
      for (const ln of t.raw) {
        const xy: number[] = ln[7];
        for (let i = 0; i + 3 < xy.length; i += 2) {
          const ax = t.minx + (xy[i] / t.q) * t.size;
          const ay = t.maxy - (xy[i + 1] / t.q) * t.size;
          const bx = t.minx + (xy[i + 2] / t.q) * t.size;
          const by = t.maxy - (xy[i + 3] / t.q) * t.size;
          const d = BundleRoadsLayer._segDist(x, y, ax, ay, bx, by);
          if (d <= tolM && (!best || d < best.d)) best = { d, road: this._road(ln) };
        }
      }
    }
    return best?.road ?? null;
  }

  /** Words for a road's class, MSR and crossing, for a popup or the card. */
  static describe(r: BundleRoad): string {
    const parts = [CLAZZ[r.clazz] ?? 'Road'];
    if (r.flags & ROAD_FLAGS.msr) parts.push('MSR');
    parts.push(r.load ? `Class ${r.load}` : 'Class Not Recorded');
    if (r.flags & ROAD_FLAGS.tankable) parts.push('Tankable');
    if (r.xing && CROSSING[r.xing]) parts.push(CROSSING[r.xing]);
    if (r.flags & ROAD_FLAGS.closedSeasonally) parts.push('Closed Seasonally (Where Recorded)');
    return parts.join(' · ');
  }

  // ── internals ────────────────────────────────────────────────────────────

  private _base(): string {
    return this._opts.bundleUrl.replace(/\/+$/, '');
  }

  /** Smallest class drawn at a zoom (bigger code = minor road). */
  private static _maxClazz(zoom: number): number {
    if (zoom < 9) return 0;
    if (zoom < 11) return 16; // motorway, trunk, primary
    if (zoom < 12) return 22; // + secondary
    if (zoom < 14) return 43; // + tertiary, unclassified (residential / service at 14+)
    return 99;
  }

  private static _zoomBand(zoom: number): number {
    return BundleRoadsLayer._maxClazz(zoom);
  }

  private async _refresh(): Promise<void> {
    const view = this._view;
    const layer = this._layer;
    if (!view || !layer || !view.extent) return;
    const gen = ++this._gen;
    const zoom = (view as any).zoom ?? 0;
    const maxClazz = BundleRoadsLayer._maxClazz(zoom);
    if (maxClazz === 0) {
      layer.removeAll();
      this._drawnZoomBand = 0;
      return;
    }
    const ext = view.extent;
    const toMerc = (x: number, y: number) => {
      const wkid = ext.spatialReference?.wkid;
      if (wkid === 102100 || wkid === 3857 || ext.spatialReference?.isWebMercator) return [x, y];
      const lon = x;
      const lat = Math.max(-85.05, Math.min(85.05, y));
      return [
        (lon * Math.PI * 6378137) / 180,
        Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 6378137,
      ];
    };
    const [x0, y0] = toMerc(ext.xmin, ext.ymin);
    const [x1, y1] = toMerc(ext.xmax, ext.ymax);
    const size = (2 * ORIGIN) / 2 ** TILE_Z;
    const tx0 = Math.floor((x0 + ORIGIN) / size), tx1 = Math.floor((x1 + ORIGIN) / size);
    const ty0 = Math.floor((ORIGIN - y1) / size), ty1 = Math.floor((ORIGIN - y0) / size);
    if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > MAX_TILES) {
      layer.removeAll();
      return; // too far out: the zoom thinning above should prevent this
    }
    const want: string[] = [];
    for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) want.push(`${tx}/${ty}`);
    await Promise.all(want.map((k) => this._load(k, size)));
    if (gen !== this._gen || !this._layer) return;
    const band = BundleRoadsLayer._zoomBand(zoom);
    const graphics: Graphic[] = [];
    for (const k of want) {
      const t = this._cache.get(k);
      if (!t) continue;
      if (this._drawnZoomBand !== band || !t.graphics.length) t.graphics = this._build(t, maxClazz);
      graphics.push(...t.graphics);
    }
    this._drawnZoomBand = band;
    layer.removeAll();
    layer.addMany(graphics);
  }

  private async _load(key: string, size: number): Promise<void> {
    if (this._cache.has(key)) {
      const t = this._cache.get(key)!;
      this._cache.delete(key);
      this._cache.set(key, t);
      return;
    }
    if (this._missing.has(key)) return;
    try {
      const r = await fetch(`${this._base()}/network/tiles/${TILE_Z}/${key}.json`);
      if (!r.ok) {
        this._missing.add(key);
        return;
      }
      const j = await r.json();
      const [tx, ty] = key.split('/').map(Number);
      this._cache.set(key, {
        key, graphics: [], raw: j.l ?? [], q: j.q ?? 4096, size,
        minx: -ORIGIN + tx * size, maxy: ORIGIN - ty * size,
      });
      while (this._cache.size > MAX_TILES) {
        const oldest = this._cache.keys().next().value as string;
        this._cache.delete(oldest);
      }
    } catch (e) {
      console.warn(`[${ENGINE_NAME}] Road tile ${key} failed: ${(e as Error).message}`);
      this._missing.add(key);
    }
  }

  private _road(ln: any[]): BundleRoad {
    const names = this._names ?? [];
    return { edge: ln[0], clazz: ln[1], flags: ln[2], load: ln[3], xing: ln[4], name: names[ln[5]] ?? '', roadNo: names[ln[6]] ?? '' };
  }

  private _build(t: TileData, maxClazz: number): Graphic[] {
    const out: Graphic[] = [];
    for (const ln of t.raw) {
      const clazz: number = ln[1];
      if (clazz > maxClazz) continue;
      const xy: number[] = ln[7];
      const path: number[][] = [];
      for (let i = 0; i + 1 < xy.length; i += 2) {
        path.push([t.minx + (xy[i] / t.q) * t.size, t.maxy - (xy[i + 1] / t.q) * t.size]);
      }
      if (path.length < 2) continue;
      const road = this._road(ln);
      out.push(new Graphic({
        geometry: new Polyline({ paths: [path], spatialReference: { wkid: 102100 } }),
        symbol: BundleRoadsLayer._symbol(road) as any,
        attributes: {
          edge: road.edge, name: road.name, roadNo: road.roadNo, loadClass: road.load || null,
          description: BundleRoadsLayer.describe(road),
        },
        popupTemplate: { title: road.roadNo || road.name || 'Road', content: '{description}' } as any,
      }));
    }
    return out;
  }

  private static _symbol(r: BundleRoad): object {
    const major = r.clazz <= 16;
    if (r.flags & ROAD_FLAGS.msr) return { type: 'simple-line', color: [214, 69, 65, 0.95], width: major ? 3 : 2.25 };
    if (r.flags & ROAD_FLAGS.tankable) return { type: 'simple-line', color: [243, 146, 55, 0.95], width: major ? 2.5 : 1.75 };
    if (r.load) return { type: 'simple-line', color: [250, 198, 80, 0.9], width: major ? 2 : 1.5 };
    if (r.clazz <= 32) return { type: 'simple-line', color: [170, 170, 170, 0.9], width: major ? 2 : 1.25, style: 'dash' };
    return { type: 'simple-line', color: [140, 140, 140, 0.7], width: 0.75 };
  }

  private static _segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax, dy = by - ay;
    const L = dx * dx + dy * dy;
    let t = L > 0 ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    const ex = ax + t * dx - px, ey = ay + t * dy - py;
    return Math.sqrt(ex * ex + ey * ey) * Math.cos(Math.atan(Math.sinh(py / 6378137))); // Web Mercator -> ground metres
  }
}
