/**
 * PlatoonGuideProbe.ts
 *
 * The terrain bundle for the Platoon Guide: loads manifest.json + rules.json from `bundleUrl` and answers the pure
 * engine's reads (PlatoonGuideRead `PlProbe`, which extends the Movement Guide's `MovProbe`) from tiles already in
 * memory, never waiting. A tile still on its way reads as unknown and sets the pending flag; `onChange` fires when it
 * arrives so the caller reads again.
 *
 * It follows MovementGuideProbe (same readers: tile cache and worker, features, road network, population, the OCOKA
 * sight engine) and adds the GROTBC rasters the card needs (cc, wet, landform, hut, terrain, dist_hls), the two-part
 * sight (with and without crops, trees and buildings), the map sheets and the month's visibility. Its own instances,
 * so the Platoon Guide works with the Ground Guide and the Movement Guide on or off. Nothing is created until
 * `configure()`, and `configure()` is only called while the Platoon Guide is switched on (claude_rules.md).
 */

import { HttpPngTileSource, TerrainTileCache, mercatorToTilePixel, type TileSource } from '../GroundGuide/TerrainTileCache';
import { WorkerTileSource } from '../GroundGuide/WorkerTileSource';
import { GroundGuideFeatures, tidyName } from '../GroundGuide/GroundGuideFeatures';
import { GroundGuideRoads } from '../GroundGuide/GroundGuideRoads';
import { GroundGuidePopulation } from '../GroundGuide/GroundGuidePopulation';
import { buildGrid, mPerPx, parseVisibility, sightTables, sightTo, visibilityAt, type OcokaGrid, type SightTables, type VisibilityGrid, type VisibilityReading } from '../GroundGuide/GroundGuideOcoka';
import { OCOKA_DOCTRINE } from '../GroundGuide/GroundGuideOcokaRead';
import type { TerrainManifest, TerrainRules } from '../GroundGuide/GroundGuideTypes';
import type { GoingSets, NearFeature, NearLine, NearRoad } from '../MovementGuide/MovementGuideScan';
import type { MercXY, PlCodebooks, PlLayer, PlPeopleGrid, PlPeopleIn, PlProbe } from './PlatoonGuideRead';
import { plLngLat, plScale, type PlBuaArea } from './PlatoonGuideRead';
import { PlSideMap } from './PlatoonGuideSide';
import { BuaIndex, buildBuaStore, type BuaStore } from './PlatoonGuideBua';
import BuaWorker from './PlatoonGuideBuaWorker.ts?worker&inline';

const EARTH_R = 6378137;
const ORIGIN = Math.PI * EARTH_R;
const BUCKETS = 32;
const D2R = Math.PI / 180;

/** The 1:50k sheets' grid (sheets.json `grid`): Lambert zones with their origins, and the line between zone I and IIa. */
interface SheetGrid {
  name?: string;
  zones: Array<{ id: string; lat0: number; lon0: number }>;
  boundary?: number[][];
}

/** The latitude of the zone line at a longitude (sheets.json `grid.boundary`, lon / lat pairs), null off its ends. */
function zoneLineLat(b: number[][] | undefined, lon: number): number | null {
  for (let i = 0; b && i + 1 < b.length; i++) {
    const [x0, y0] = b[i];
    const [x1, y1] = b[i + 1];
    if ((lon >= x0 && lon <= x1) || (lon >= x1 && lon <= x0)) return x1 === x0 ? y0 : y0 + ((lon - x0) / (x1 - x0)) * (y1 - y0);
  }
  return null;
}

interface IndexedTile {
  size: number;
  minx: number;
  maxy: number;
  pts: Array<{ key: string; x: number; y: number; a: Record<string, unknown> }>;
  pb: Int32Array[];
  lines: Array<{ key: string; xy: Float64Array; a: Record<string, unknown> }>;
  lb: Int32Array[];
}

export interface PlBorder {
  kind: string;
  xy: Float64Array;
  box: [number, number, number, number];
}

function latOfY(y: number): number {
  return 2 * Math.atan(Math.exp(y / EARTH_R)) - Math.PI / 2;
}

export class PlatoonGuideProbe implements PlProbe {
  private _manifest: TerrainManifest | null = null;
  private _rules: TerrainRules | null = null;
  private _source: TileSource | null = null;
  private _cache: TerrainTileCache | null = null;
  private _features: GroundGuideFeatures | null = null;
  private _roads: GroundGuideRoads | null = null;
  private _population: GroundGuidePopulation | null = null;
  private _borders: PlBorder[] | null = null;
  private _sheets: Array<[string, number, number, number, number]> | null = null;
  private _sheetGrid: SheetGrid | null = null;
  private _sheetsLoading = false;
  private _side: PlSideMap | null = null;
  private _sideState: 'none' | 'loading' | 'ready' = 'none';
  private _sideCache = new Map<string, 'own' | 'other' | null>();
  private _sideRules: { own: string; kinds: ReadonlySet<string> | null; nearLineM: number; onLineM: number } = { own: 'Pakistan', kinds: null, nearLineM: 1000, onLineM: 100 };
  /** The feature tiles' zoom (manifest grotbc.features.z). */
  private _featZ = 10;
  /** The settlements (BUA outlines and areas), built in a worker. */
  private _bua: BuaIndex | null = null;
  private _buaState: 'none' | 'loading' | 'ready' = 'none';
  private _buaWorker: Worker | null = null;
  private _vis: VisibilityGrid | null = null;
  private _index = new Map<string, IndexedTile>();
  private _grids = new Map<string, { g: OcokaGrid; tick: number }>();
  private _tables: { key: string; t: SightTables } | null = null;
  private _pending = false;
  private _roadsOpening = false;
  private _popState: 'none' | 'loading' | 'ready' | 'failed' = 'none';
  private _token = 0;
  private _z = 12;
  private _ts = 256;
  private _layers: Record<string, string | null> = {};
  tick = 0;
  resM = 30;
  /** Metres per unit of the dist_* layers (manifest distScaleM). */
  distScaleM = 10;

  constructor(private readonly _onChange: () => void) {}

  /** Who is own and which boundary lines part the sides (PlatoonDoctrine.json `side`, MovementDoctrine exposure.borderKinds).
   *  Set before `configure()`. */
  setSideRules(r: { ownCountry?: string; nearLineM?: number; onLineM?: number }, kinds: readonly string[] | null): void {
    this._sideRules = {
      own: r.ownCountry || 'Pakistan',
      kinds: kinds && kinds.length ? new Set(kinds) : null,
      nearLineM: Number(r.nearLineM) || 1000,
      onLineM: Number(r.onLineM) || 100,
    };
  }

  get ready(): boolean {
    return this._manifest !== null;
  }
  get manifest(): TerrainManifest | null {
    return this._manifest;
  }
  get rules(): TerrainRules | null {
    return this._rules;
  }
  get borders(): PlBorder[] {
    return this._borders ?? [];
  }

  async configure(base: string, opts: { cacheTiles: number; useWorker: boolean }): Promise<boolean> {
    const token = ++this._token;
    this.dispose();
    if (!base) return false;
    const [mr, rr] = await Promise.all([fetch(`${base}/manifest.json`), fetch(`${base}/rules.json`)]);
    if (!mr.ok || !rr.ok) throw new Error(`HTTP ${mr.status} / ${rr.status}`);
    const isJson = (r: Response) => (r.headers.get('content-type') ?? '').includes('json');
    if (!isJson(mr) || !isJson(rr)) throw new Error('no terrain bundle at this address');
    const manifest = (await mr.json()) as TerrainManifest;
    const rules = (await rr.json()) as TerrainRules;
    if (token !== this._token) return false;
    if (!manifest?.layers || !rules?.classes) throw new Error('not a terrain bundle (manifest or rules incomplete)');
    this._manifest = manifest;
    this._rules = rules;
    this._ts = manifest.tileSize ?? 256;
    this._z = (manifest as any).zoom?.max ?? 12;
    this.distScaleM = Number((manifest as any).distScaleM) || 10;
    const L = manifest.layers as Record<string, string>;
    const profiles: string[] = ((manifest as any).profiles ?? []) as string[];
    const dist = typeof L.dist === 'string' ? L.dist : 'dist_{profile}';
    this._layers = {
      cls: L.class ?? 'class',
      hi: L.elev_hi ?? null,
      lo: L.elev_lo ?? null,
      bld: L.bld ?? null,
      cc: L.cc ?? null,
      wet: L.wet ?? null,
      landform: L.landform ?? null,
      hut: L.hut ?? null,
      terrain: L.terrain ?? null,
      route: L.route ?? null,
      bank: L.bank ?? null,
      distHls: profiles.includes('hls') ? dist.replace('{profile}', 'hls') : null,
    };
    const version = (manifest as any).built ?? (manifest as any).pipelineVersion ?? '';
    this._source = opts.useWorker && typeof Worker !== 'undefined' ? new WorkerTileSource(base, this._ts, version) : new HttpPngTileSource(base, this._ts, version);
    this._cache = new TerrainTileCache(this._source, opts.cacheTiles, () => this._changed(true));
    const g = (manifest as any).grotbc ?? {};
    this._features = g.features ? new GroundGuideFeatures(base, g.features, rules, () => this._changed(false)) : null;
    this._featZ = Number.isInteger(g.features?.z) ? g.features.z : 10;
    if (typeof g.network?.index === 'string') {
      this._roadsOpening = true;
      void GroundGuideRoads.open(base, g.network.index, () => this._changed(false))
        .catch(() => null)
        .then((r) => {
          if (token !== this._token) {
            r?.destroy();
            return;
          }
          this._roads = r;
          this._roadsOpening = false;
          this._changed(false);
        });
    }
    if (g.population) {
      const pop = new GroundGuidePopulation(base, g.population, () => this._changed(false));
      this._population = pop;
      this._popState = 'loading';
      void pop.load().then((ok) => {
        if (token !== this._token) return;
        this._popState = ok ? 'ready' : 'failed';
        this._changed(false);
      });
    }
    const bf = typeof g.boundaries === 'string' ? g.boundaries : typeof g.boundaries?.path === 'string' ? g.boundaries.path : null;
    const bordersJson = bf ? this._loadBorders(`${base}/${bf}`, token) : Promise.resolve(null);
    // The country areas (admin.geojson `country`) with the boundary lines say which side of the LoC / border a place is
    // on: the other side's posts and hospitals are never offered as help. Missing: nothing filtered, the reading says so.
    const af = typeof g.admin === 'string' ? g.admin : typeof g.admin?.path === 'string' ? g.admin.path : null;
    if (af) {
      this._sideState = 'loading';
      void this._loadSide(`${base}/${af}`, bordersJson, token);
    }
    if (typeof g.sheets === 'string') void this._loadSheets(`${base}/${g.sheets}`, token);
    const sf = typeof g.settlements?.geojson === 'string' ? g.settlements.geojson : null;
    if (sf) {
      this._buaState = 'loading';
      this._loadBua(new URL(`${base}/${sf}`, location.href).href, token);
    }
    if (g.visibility?.index && g.visibility?.data) void this._loadVisibility(`${base}/${g.visibility.index}`, `${base}/${g.visibility.data}`, token);
    return true;
  }

  dispose(): void {
    this._cache?.clear();
    this._cache = null;
    this._source?.dispose?.();
    this._source = null;
    this._features?.destroy();
    this._features = null;
    this._roads?.destroy();
    this._roads = null;
    this._population?.destroy();
    this._population = null;
    this._borders = null;
    this._sheets = null;
    this._sheetGrid = null;
    this._sheetsLoading = false;
    this._buaWorker?.terminate();
    this._buaWorker = null;
    this._bua = null;
    this._buaState = 'none';
    this._side = null;
    this._sideState = 'none';
    this._sideCache.clear();
    this._vis = null;
    this._index.clear();
    this._grids.clear();
    this._manifest = null;
    this._rules = null;
  }

  destroy(): void {
    this._token++;
    this.dispose();
  }

  going(profile: string): GoingSets {
    const p = (this._rules as any)?.profiles?.[profile] ?? {};
    return { nogo: new Set<number>(p.nogo ?? []), caution: new Set<number>(p.caution ?? []) };
  }
  classLabel(c: number): string {
    return (this._rules as any)?.classes?.[String(c)]?.label ?? `Class ${c}`;
  }
  codebooks(): PlCodebooks {
    const gr = (this._rules as any)?.grotbc ?? {};
    const g = gr.layers ?? {};
    return { wet: g.wet, landform: g.landform, bldDensity: g.bld?.density, bldSize: g.bld?.size, ccLevels: g.cc?.levels, routeTypes: g.route?.types, routeTiers: g.route?.tiers, banks: gr.banks };
  }
  /** The bundle's data date for the card ("bundle 2026-11-11, land cover 2022-10 (v200), roads 2026-10-28, people ..."). */
  dataLine(): string {
    const m = this._manifest as any;
    if (!m) return '';
    const src = new Map<string, string>();
    for (const s of m.sources ?? []) if (s?.id) src.set(s.id, String(s.dataDate ?? s.released ?? ''));
    const parts = [`bundle ${String(m.built ?? '').slice(0, 10)}`];
    if (src.get('worldcover')) parts.push(`land cover ${src.get('worldcover')}`);
    if (src.get('osm_pakistan')) parts.push(`roads ${src.get('osm_pakistan')}`);
    if (src.get('worldpop')) parts.push(`people ${src.get('worldpop')}`);
    return parts.join(', ');
  }

  focus(y: number): void {
    this.resM = mPerPx(latOfY(y) / (Math.PI / 180), this._z, this._ts);
  }

  takePending(): boolean {
    const p = this._pending;
    this._pending = false;
    return p;
  }

  private _changed(tiles: boolean): void {
    this.tick++;
    if (!tiles) this._index.clear();
    this._onChange();
  }

  // ── rasters ────────────────────────────────────────────────────────────────────────────────────────────────────────

  private _px(layer: string | null | undefined, x: number, y: number): number | null | undefined {
    if (!layer || !this._cache) return null;
    const t = mercatorToTilePixel(x, y, this._z, this._ts);
    const d = this._cache.peek(layer, this._z, t.tx, t.ty);
    if (d === undefined) {
      this._pending = true;
      return undefined;
    }
    if (d === null) return null;
    return d[t.py * this._ts + t.px];
  }

  cls(x: number, y: number): number | null {
    const v = this._px(this._layers.cls, x, y);
    return v === undefined || v === null || v === 255 ? null : v;
  }
  elev(x: number, y: number): number {
    const hi = this._px(this._layers.hi, x, y);
    if (hi === undefined || hi === null || hi === 255) return NaN;
    const lo = this._px(this._layers.lo, x, y);
    if (lo === undefined || lo === null) return NaN;
    return hi * 256 + lo - 500;
  }
  bld(x: number, y: number): number {
    const v = this._px(this._layers.bld, x, y);
    return v === undefined || v === null || v === 255 ? 0 : v;
  }
  raster(layer: PlLayer, x: number, y: number): number | null {
    const v = this._px(this._layers[layer], x, y);
    // 255 is no data in every GROTBC layer (dist_*: 255 = no data, 254 = at or beyond the cap).
    return v === undefined || v === null || v === 255 ? null : v;
  }

  // ── sight ──────────────────────────────────────────────────────────────────────────────────────────────────────────

  private _gridFor(x: number, y: number): OcokaGrid | null {
    if (!this._cache || !this._layers.hi || !this._layers.lo) return null;
    const t = mercatorToTilePixel(x, y, this._z, this._ts);
    const key = `${t.tx}|${t.ty}`;
    const hit = this._grids.get(key);
    if (hit && (!hit.g.pending || hit.tick === this.tick)) {
      if (hit.g.pending) this._pending = true;
      this._grids.delete(key);
      this._grids.set(key, hit);
      return hit.g;
    }
    const cache = this._cache;
    const peek = (layer: string, tx: number, ty: number) => cache.peek(layer, this._z, tx, ty);
    const cx = t.tx * this._ts + this._ts / 2;
    const cy = t.ty * this._ts + this._ts / 2;
    const lat = latOfY(y) / (Math.PI / 180);
    const g = buildGrid(peek, { cls: this._layers.cls!, elevHi: this._layers.hi, elevLo: this._layers.lo, bld: this._layers.bld }, this._z, this._ts, lat, cx, cy, this._ts);
    if (g.pending) this._pending = true;
    this._grids.set(key, { g, tick: this.tick });
    while (this._grids.size > 6) this._grids.delete(this._grids.keys().next().value as string);
    return g;
  }

  private _tablesFor(res: number): SightTables {
    const month = new Date().getMonth() + 1;
    const key = `${month}|${res.toFixed(1)}`;
    if (this._tables?.key !== key) this._tables = { key, t: sightTables(OCOKA_DOCTRINE, month, res) };
    return this._tables.t;
  }

  sight2(ox: number, oy: number, eyeM: number, tx: number, ty: number, targetM: number): { p: number; pTerrain: number } | null {
    // The grid round the observer's tile reaches one tile past it (about 4 km at z13); a further target (a resection
    // landmark at 5 km) is read on the grid round the midpoint's tile, which holds both ends up to about 8 km apart.
    let r = this._sightOn(this._gridFor(ox, oy), ox, oy, eyeM, tx, ty, targetM);
    if (r === undefined) r = this._sightOn(this._gridFor((ox + tx) / 2, (oy + ty) / 2), ox, oy, eyeM, tx, ty, targetM);
    return r ?? null;
  }
  /** Sight on one grid; undefined when an end lies outside it. */
  private _sightOn(g: OcokaGrid | null, ox: number, oy: number, eyeM: number, tx: number, ty: number, targetM: number): { p: number; pTerrain: number } | null | undefined {
    if (!g) return null;
    const world = (2 * ORIGIN) / (this._ts * 2 ** this._z);
    const gx = (x: number) => (x + ORIGIN) / world - g.px0;
    const gy = (y: number) => (ORIGIN - y) / world - g.py0;
    const ax = gx(ox), ay = gy(oy), bx = gx(tx), by = gy(ty);
    if (ax < 1 || ay < 1 || bx < 1 || by < 1 || ax >= g.w - 1 || ay >= g.h - 1 || bx >= g.w - 1 || by >= g.h - 1) return undefined;
    const r = sightTo(g, ax, ay, bx, by, { eyeM, targetM, radiusM: 0, effM: 0, tolM: 1, tables: this._tablesFor(g.res) });
    return r ? { p: r.p, pTerrain: r.pTerrain } : null;
  }

  // ── built-up areas ─────────────────────────────────────────────────────────────────────────────────────────────────

  /** BUAs (settlements.geojson) whose outline or circle comes within `radiusM`; empty while loading (pending) or without. */
  buaAreas(x: number, y: number, radiusM: number): PlBuaArea[] {
    if (this._buaState === 'loading') this._pending = true;
    return this._bua ? this._bua.near(x, y, radiusM, plScale(y)) : [];
  }

  /** Fetch and parse settlements.geojson in a worker (42 MB, mostly attributes); on the main thread when workers fail. */
  private _loadBua(url: string, token: number): void {
    const done = (store: BuaStore | null) => {
      if (token !== this._token) return;
      this._buaWorker?.terminate();
      this._buaWorker = null;
      this._bua = store && store.n ? new BuaIndex(store) : null;
      this._buaState = this._bua ? 'ready' : 'none';
      this._changed(false);
    };
    const onMain = async () => {
      try {
        const r = await fetch(url);
        done(r.ok ? buildBuaStore(await r.json()) : null);
      } catch {
        done(null);
      }
    };
    if (typeof Worker === 'undefined') {
      void onMain();
      return;
    }
    try {
      const w = new BuaWorker({ name: 'ms-platoon-bua' });
      this._buaWorker = w;
      w.onmessage = (e: MessageEvent) => done(e.data?.store ? (e.data.store as BuaStore) : null);
      w.onerror = () => {
        w.terminate();
        if (this._buaWorker !== w) return;
        this._buaWorker = null;
        void onMain();
      };
      w.postMessage({ url });
    } catch {
      void onMain();
    }
  }

  // ── side of the LoC / border, grid ─────────────────────────────────────────────────────────────────────────────────

  sideState(): 'none' | 'loading' | 'ready' {
    return this._sideState;
  }
  side(x: number, y: number): 'own' | 'other' | null {
    if (this._sideState !== 'ready' || !this._side) {
      if (this._sideState === 'loading') this._pending = true;
      return null;
    }
    const key = `${Math.round(x / 5)}|${Math.round(y / 5)}`;
    const hit = this._sideCache.get(key);
    if (hit !== undefined) return hit;
    const [lng, lat] = plLngLat([x, y]);
    const s = this._side.side(lng, lat);
    this._sideCache.set(key, s);
    if (this._sideCache.size > 20000) this._sideCache.delete(this._sideCache.keys().next().value as string);
    return s;
  }
  /** The 1:50k sheets' grid (the Indian grid, Lambert conformal conic, one parallel): grid north lies sin(lat0) x (lon -
   *  lon0) east of true north. Only on a sheet; elsewhere null (the engine falls back to UTM). */
  gridConvergence(x: number, y: number): { deg: number; name: string } | null {
    if (this._sheetsLoading) this._pending = true;
    const g = this._sheetGrid;
    if (!g?.zones?.length || !this.sheetAt([x, y])) return null;
    const [lng, lat] = plLngLat([x, y]);
    const bl = zoneLineLat(g.boundary, lng);
    const id = bl === null ? (lat >= 28.5 ? 'I' : 'IIa') : lat >= bl ? 'I' : 'IIa';
    const z = g.zones.find((q) => q.id === id) ?? g.zones[0];
    if (!Number.isFinite(z.lat0) || !Number.isFinite(z.lon0)) return null;
    return { deg: Math.sin(z.lat0 * D2R) * (lng - z.lon0), name: `Indian grid zone ${z.id}` };
  }
  sight(ox: number, oy: number, eyeM: number, tx: number, ty: number, targetM: number): number | null {
    return this.sight2(ox, oy, eyeM, tx, ty, targetM)?.p ?? null;
  }

  // ── points and lines ───────────────────────────────────────────────────────────────────────────────────────────────

  private _tileOf(x: number, y: number): { tx: number; ty: number; size: number } {
    const size = (2 * ORIGIN) / 2 ** this._featZ; // the feature tiles' own zoom: the index is one feature tile
    return { tx: Math.floor((x + ORIGIN) / size), ty: Math.floor((ORIGIN - y) / size), size };
  }

  private _indexed(tx: number, ty: number, size: number): IndexedTile | null {
    const key = `${tx}/${ty}`;
    const hit = this._index.get(key);
    if (hit) return hit;
    const f = this._features;
    if (!f) return null;
    const cx = -ORIGIN + (tx + 0.5) * size;
    const cy = ORIGIN - (ty + 0.5) * size;
    const scene = f.sceneNear([cx, cy], 1);
    if (scene.pending) {
      this._pending = true;
      return null;
    }
    const minx = -ORIGIN + tx * size;
    const maxy = ORIGIN - ty * size;
    const cell = size / BUCKETS;
    const bucketOf = (x: number, y: number) => Math.min(BUCKETS - 1, Math.max(0, Math.floor((x - minx) / cell))) + BUCKETS * Math.min(BUCKETS - 1, Math.max(0, Math.floor((maxy - y) / cell)));
    const pl: number[][] = Array.from({ length: BUCKETS * BUCKETS }, () => []);
    scene.points.forEach((p, i) => pl[bucketOf(p.x, p.y)].push(i));
    const ll: number[][] = Array.from({ length: BUCKETS * BUCKETS }, () => []);
    scene.lines.forEach((l, i) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let k = 0; k + 1 < l.xy.length; k += 2) {
        x0 = Math.min(x0, l.xy[k]);
        x1 = Math.max(x1, l.xy[k]);
        y0 = Math.min(y0, l.xy[k + 1]);
        y1 = Math.max(y1, l.xy[k + 1]);
      }
      const c0 = Math.max(0, Math.floor((x0 - minx) / cell)), c1 = Math.min(BUCKETS - 1, Math.floor((x1 - minx) / cell));
      const r0 = Math.max(0, Math.floor((maxy - y1) / cell)), r1 = Math.min(BUCKETS - 1, Math.floor((maxy - y0) / cell));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) ll[r * BUCKETS + c].push(i);
    });
    const t: IndexedTile = { size, minx, maxy, pts: scene.points, pb: pl.map((a) => Int32Array.from(a)), lines: scene.lines, lb: ll.map((a) => Int32Array.from(a)) };
    this._index.set(key, t);
    while (this._index.size > 40) this._index.delete(this._index.keys().next().value as string);
    return t;
  }

  private _visit(x: number, y: number, radiusM: number, fn: (t: IndexedTile, bucket: number) => void): void {
    const r = radiusM / plScale(y);
    const a = this._tileOf(x - r, y + r);
    const b = this._tileOf(x + r, y - r);
    for (let tx = a.tx; tx <= b.tx; tx++)
      for (let ty = a.ty; ty <= b.ty; ty++) {
        const t = this._indexed(tx, ty, a.size);
        if (!t) continue;
        const cell = t.size / BUCKETS;
        const c0 = Math.max(0, Math.floor((x - r - t.minx) / cell)), c1 = Math.min(BUCKETS - 1, Math.floor((x + r - t.minx) / cell));
        const r0 = Math.max(0, Math.floor((t.maxy - (y + r)) / cell)), r1 = Math.min(BUCKETS - 1, Math.floor((t.maxy - (y - r)) / cell));
        for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) fn(t, rr * BUCKETS + cc);
      }
  }

  features(x: number, y: number, radiusM: number, kinds: ReadonlySet<string>): NearFeature[] {
    const out: NearFeature[] = [];
    const s = plScale(y);
    this._visit(x, y, radiusM, (t, b) => {
      for (const i of t.pb[b]) {
        const p = t.pts[i];
        if (!kinds.has(p.key)) continue;
        const d = Math.hypot(p.x - x, p.y - y) * s;
        if (d > radiusM) continue;
        const label = this._features?.kindLabel(p.key) ?? p.key;
        out.push({ kind: p.key, label, name: tidyName(p.a.n, label), x: p.x, y: p.y, distM: d, attrs: p.a });
      }
    });
    return out.sort((a, b) => a.distM - b.distM);
  }

  lines(x: number, y: number, radiusM: number, kinds: ReadonlySet<string>): NearLine[] {
    const seen = new Set<object>();
    const out: NearLine[] = [];
    this._visit(x, y, radiusM, (t, b) => {
      for (const i of t.lb[b]) {
        const l = t.lines[i];
        if (!kinds.has(l.key) || seen.has(l)) continue;
        seen.add(l);
        out.push({ kind: l.key, xy: l.xy, attrs: l.a });
      }
    });
    return out;
  }

  roads(x: number, y: number, radiusM: number): NearRoad[] {
    const r = this._roads;
    if (!r) {
      if (this._roadsOpening) this._pending = true;
      return [];
    }
    const { list, pending } = r.roadsNear([x, y], radiusM);
    if (pending) this._pending = true;
    return list.map((h) => ({ distM: h.distanceM, x: h.at[0], y: h.at[1], attrs: h.attrs }));
  }

  /** Road and track lines from the road network (minor roads and tracks included) within reach; empty without one. */
  roadLines(x: number, y: number, radiusM: number): NearLine[] {
    const r = this._roads;
    if (!r) {
      if (this._roadsOpening) this._pending = true;
      return [];
    }
    const { list, pending } = r.edgesNear([x, y], radiusM);
    if (pending) this._pending = true;
    return list.map((e) => ({ kind: 'road', xy: e.xy, attrs: e.attrs }));
  }

  people(x: number, y: number): number | null {
    const p = this._population;
    if (!p) return null;
    if (!p.ready) {
      if (this._popState === 'loading') this._pending = true;
      return null;
    }
    const h = p.header!;
    const [lng, lat] = plLngLat([x, y]);
    const [w, , , n] = h.bounds;
    return p.cellDensity(Math.floor((n - lat) / h.cell), Math.floor((lng - w) / h.cell));
  }

  /** People round the point for the card: rings to 2 km and the age split (WorldPop estimates). */
  peopleAround(at: MercXY): PlPeopleIn | null {
    const p = this._population;
    if (!p) return null;
    if (!p.ready) return this._popState === 'loading' ? { perKm2At: null, rings: [], ages: null, pending: true } : null;
    const [lng, lat] = plLngLat(at);
    const r = p.around(lng, lat, 2);
    if (!r) return null;
    // The grid and the rings are counted from the centre of the point's cell: say where the point sits in it, and the
    // cell's true size each way (30" cells are about 0.93 km N-S by 0.77 km E-W at 33.6°N), so the picture draws them right.
    let grid: PlPeopleGrid | null = r.grid ?? null;
    const h = p.header;
    if (grid && h) {
      const [w, , , n] = h.bounds;
      const r0 = Math.floor((n - lat) / h.cell), c0 = Math.floor((lng - w) / h.cell);
      const kx = 111.32 * Math.cos(lat * D2R) * h.cell, ky = 110.574 * h.cell;
      const offsetKm: [number, number] = [((lng - (w + (c0 + 0.5) * h.cell)) / h.cell) * kx, ((lat - (n - (r0 + 0.5) * h.cell)) / h.cell) * ky];
      grid = { ...grid, cellKmX: kx, cellKmY: ky, offsetKm };
    }
    return { perKm2At: this.people(at[0], at[1]), rings: r.rings.filter((x) => x.km <= 3), ages: r.ages, sectors: r.sectors ?? null, grid, bands: r.bands ?? null, pending: false };
  }

  /** The 1:50k sheet the point falls on. */
  sheetAt(at: MercXY): string | null {
    if (!this._sheets) return null;
    const [lng, lat] = plLngLat(at);
    for (const s of this._sheets) if (lng >= s[1] && lng < s[3] && lat >= s[2] && lat < s[4]) return s[0];
    return null;
  }

  /** The month's visibility at the point (NOAA station days), or null. */
  visibility(at: MercXY, month: number): VisibilityReading | null {
    if (!this._vis) return null;
    const [lng, lat] = plLngLat(at);
    return visibilityAt(this._vis, lng, lat, month);
  }

  /** Load the boundary lines; resolves the parsed file (the side test reads it too), or null. */
  private async _loadBorders(url: string, token: number): Promise<any | null> {
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      const gj = await r.json();
      if (token !== this._token) return null;
      const out: PlBorder[] = [];
      for (const f of gj?.features ?? []) {
        const kind = String(f?.properties?.kind ?? '');
        const geom = f?.geometry;
        const parts: number[][][] = geom?.type === 'LineString' ? [geom.coordinates] : geom?.type === 'MultiLineString' ? geom.coordinates : [];
        for (const part of parts) {
          const xy = new Float64Array(part.length * 2);
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          part.forEach(([lng, lat], i) => {
            const x = (lng * ORIGIN) / 180;
            const y = Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360)) * EARTH_R;
            xy[2 * i] = x;
            xy[2 * i + 1] = y;
            x0 = Math.min(x0, x);
            x1 = Math.max(x1, x);
            y0 = Math.min(y0, y);
            y1 = Math.max(y1, y);
          });
          out.push({ kind, xy, box: [x0, y0, x1, y1] });
        }
      }
      this._borders = out;
      this._changed(false);
      return gj;
    } catch {
      this._borders = [];
      return null;
    }
  }

  /** The country areas and the side lines, once both are in (the lines may be missing: the areas alone decide then). */
  private async _loadSide(url: string, borders: Promise<any | null>, token: number): Promise<void> {
    let map: PlSideMap | null = null;
    try {
      const r = await fetch(url);
      if (r.ok) {
        const admin = await r.json();
        const lines = await borders;
        if (token !== this._token) return;
        const S = this._sideRules;
        map = PlSideMap.from(admin, lines, { own: S.own, kinds: S.kinds, nearLineM: S.nearLineM, onLineM: S.onLineM });
      }
    } catch {
      map = null;
    }
    if (token !== this._token) return;
    this._side = map;
    this._sideState = map ? 'ready' : 'none';
    this._sideCache.clear();
    this._changed(false);
  }

  private async _loadSheets(url: string, token: number): Promise<void> {
    this._sheetsLoading = true;
    try {
      const r = await fetch(url);
      if (!r.ok) return;
      const j = await r.json();
      if (token !== this._token) return;
      this._sheets = Array.isArray(j?.['50k']) ? j['50k'] : null;
      this._sheetGrid = Array.isArray(j?.grid?.zones) && j.grid.zones.length ? (j.grid as SheetGrid) : null;
      this._changed(false);
    } catch {
      this._sheets = null;
    } finally {
      if (token === this._token) this._sheetsLoading = false;
    }
  }

  private async _loadVisibility(indexUrl: string, dataUrl: string, token: number): Promise<void> {
    try {
      const [hr, br] = await Promise.all([fetch(indexUrl), fetch(dataUrl)]);
      if (!hr.ok || !br.ok) return;
      const head = await hr.json();
      const bin = await br.arrayBuffer();
      if (token !== this._token) return;
      this._vis = parseVisibility(head, bin);
      this._changed(false);
    } catch {
      this._vis = null;
    }
  }
}
