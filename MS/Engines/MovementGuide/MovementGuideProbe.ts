/**
 * MovementGuideProbe.ts
 *
 * The terrain bundle for the Movement Guide: loads manifest.json + rules.json from `bundleUrl` and answers the pure
 * engine's reads (MovementGuideScan `MovProbe`) from tiles already in memory, never waiting. A tile that is still
 * on its way reads as unknown, sets the pending flag, and `onChange` fires when it arrives so the caller scans again.
 *
 * It reuses the Ground Guide's readers as they are (tile cache and worker, features, road network, population, the
 * OCOKA sight engine) with instances of its own, so the Movement Guide works whether the Ground Guide is on or off.
 * Nothing here is created until `configure()` is called, and `configure()` is only called while the Movement Guide is
 * switched on (claude_rules.md: a switched-off feature never looks for the bundle).
 */

import { HttpPngTileSource, TerrainTileCache, mercatorToTilePixel, type TileSource } from '../GroundGuide/TerrainTileCache';
import { WorkerTileSource } from '../GroundGuide/WorkerTileSource';
import { GroundGuideFeatures, tidyName } from '../GroundGuide/GroundGuideFeatures';
import { GroundGuideRoads } from '../GroundGuide/GroundGuideRoads';
import { GroundGuidePopulation } from '../GroundGuide/GroundGuidePopulation';
import { buildGrid, mPerPx, sightTables, sightTo, type OcokaGrid, type SightTables } from '../GroundGuide/GroundGuideOcoka';
import { OCOKA_DOCTRINE } from '../GroundGuide/GroundGuideOcokaRead';
import type { TerrainManifest, TerrainRules } from '../GroundGuide/GroundGuideTypes';
import type { GoingSets, MercXY, MovProbe, NearFeature, NearLine, NearRoad } from './MovementGuideScan';
import { latOfY, mercToLngLat, scaleAt } from './MovementGuideScan';

const EARTH_R = 6378137;
const ORIGIN = Math.PI * EARTH_R;
/** Feature tiles are z10 (about 35 km across); each is cut into BUCKETS² cells for quick lookups. */
const BUCKETS = 32;

interface IndexedTile {
  size: number;
  minx: number;
  maxy: number;
  pts: Array<{ key: string; x: number; y: number; a: Record<string, unknown> }>;
  /** Point indices per bucket. */
  pb: Int32Array[];
  lines: Array<{ key: string; xy: Float64Array; a: Record<string, unknown> }>;
  /** Line indices per bucket (a line is listed in every bucket its bounding box touches). */
  lb: Int32Array[];
}

export interface BundleBorder {
  kind: string;
  xy: Float64Array;
  box: [number, number, number, number];
}

export class MovementGuideProbe implements MovProbe {
  private _manifest: TerrainManifest | null = null;
  private _rules: TerrainRules | null = null;
  private _source: TileSource | null = null;
  private _cache: TerrainTileCache | null = null;
  private _features: GroundGuideFeatures | null = null;
  private _roads: GroundGuideRoads | null = null;
  private _population: GroundGuidePopulation | null = null;
  private _borders: BundleBorder[] | null = null;
  private _index = new Map<string, IndexedTile>();
  private _grids = new Map<string, { g: OcokaGrid; tick: number }>();
  private _tables: { key: string; t: SightTables } | null = null;
  private _pending = false;
  /** Readers that open in the background: until they settle, "nothing found" may only mean "not loaded yet". */
  private _roadsOpening = false;
  private _popState: 'none' | 'loading' | 'ready' | 'failed' = 'none';
  private _bordersLoading = false;
  private _token = 0;
  private _z = 12;
  private _ts = 256;
  private _layers = { cls: 'class', hi: 'elev_hi', lo: 'elev_lo', bld: 'bld' as string | null };
  /** Bumped whenever data arrives: a scan that met loading data is run again for a new tick. */
  tick = 0;
  resM = 30;

  constructor(private readonly _onChange: () => void) {}

  get ready(): boolean {
    return this._manifest !== null;
  }
  get manifest(): TerrainManifest | null {
    return this._manifest;
  }
  get rules(): TerrainRules | null {
    return this._rules;
  }
  /** The bundle's borders (empty while `bordersLoading`). */
  get borders(): BundleBorder[] {
    return this._borders ?? [];
  }
  get bordersLoading(): boolean {
    return this._bordersLoading;
  }

  /** Load the bundle. Resolves true when it is usable; false (and nothing kept) when it is not there. */
  async configure(base: string, opts: { cacheTiles: number; useWorker: boolean }): Promise<boolean> {
    const token = ++this._token;
    this.dispose();
    if (!base) return false;
    const [mr, rr] = await Promise.all([fetch(`${base}/manifest.json`), fetch(`${base}/rules.json`)]);
    if (!mr.ok || !rr.ok) throw new Error(`HTTP ${mr.status} / ${rr.status}`);
    const isJson = (r: Response) => (r.headers.get('content-type') ?? '').includes('json');
    // A host with an SPA fallback answers a missing file with index.html: that is "no bundle", not a broken one.
    if (!isJson(mr) || !isJson(rr)) throw new Error('no terrain bundle at this address');
    const manifest = (await mr.json()) as TerrainManifest;
    const rules = (await rr.json()) as TerrainRules;
    if (token !== this._token) return false;
    if (!manifest?.layers || !rules?.classes) throw new Error('not a terrain bundle (manifest or rules incomplete)');
    this._manifest = manifest;
    this._rules = rules;
    this._ts = manifest.tileSize ?? 256;
    this._z = (manifest as any).zoom?.max ?? 12;
    const L = manifest.layers as Record<string, string>;
    this._layers = { cls: L.class ?? 'class', hi: L.elev_hi ?? 'elev_hi', lo: L.elev_lo ?? 'elev_lo', bld: L.bld ?? null };
    const version = (manifest as any).built ?? (manifest as any).pipelineVersion ?? '';
    this._source = opts.useWorker && typeof Worker !== 'undefined' ? new WorkerTileSource(base, this._ts, version) : new HttpPngTileSource(base, this._ts, version);
    this._cache = new TerrainTileCache(this._source, opts.cacheTiles, () => this._changed(true));
    const g = (manifest as any).grotbc ?? {};
    this._features = g.features ? new GroundGuideFeatures(base, g.features, rules, () => this._changed(false)) : null;
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
    if (bf) {
      this._bordersLoading = true;
      void this._loadBorders(`${base}/${bf}`, token);
    }
    return true;
  }

  /** Release everything (tiles, worker, readers). */
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
    this._index.clear();
    this._grids.clear();
    this._manifest = null;
    this._rules = null;
  }

  destroy(): void {
    this._token++;
    this.dispose();
  }

  /** A mover's NO-GO / SLOW-GO classes from rules.json (`profiles`). */
  going(profile: string): GoingSets {
    const p = (this._rules as any)?.profiles?.[profile] ?? {};
    return { nogo: new Set<number>(p.nogo ?? []), caution: new Set<number>(p.caution ?? []) };
  }
  classLabel(c: number): string {
    return (this._rules as any)?.classes?.[String(c)]?.label ?? `Class ${c}`;
  }
  /** The bundle's data date for the report ("2026-11-11 build; land cover 2021, roads 2026-10-28"). */
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

  /** Point the flood fill's step at a latitude. */
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
    if (!tiles) this._index.clear(); // feature tiles arrived: indexes are rebuilt from them on demand
    this._onChange();
  }

  // ── rasters ────────────────────────────────────────────────────────────────────────────────────────────────────────

  private _px(layer: string | null, x: number, y: number): number | null | undefined {
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
    return v ?? 0;
  }

  // ── sight ──────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Tiles round the origin's tile (3 x 3 of the finest zoom: about 25 km), laid out once per data tick. */
  private _gridFor(x: number, y: number): OcokaGrid | null {
    if (!this._cache) return null;
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
    const g = buildGrid(peek, { cls: this._layers.cls, elevHi: this._layers.hi, elevLo: this._layers.lo, bld: this._layers.bld }, this._z, this._ts, lat, cx, cy, this._ts);
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

  sight(ox: number, oy: number, eyeM: number, tx: number, ty: number, targetM: number): number | null {
    return this.sight2(ox, oy, eyeM, tx, ty, targetM)?.p ?? null;
  }

  /** Both chances (the Platoon Guide's `PlProbe` read): with what stands on the ground, and the ground alone. */
  sight2(ox: number, oy: number, eyeM: number, tx: number, ty: number, targetM: number): { p: number; pTerrain: number } | null {
    const g = this._gridFor(ox, oy);
    if (!g) return null;
    const world = (2 * ORIGIN) / (this._ts * 2 ** this._z);
    const gx = (x: number) => (x + ORIGIN) / world - g.px0;
    const gy = (y: number) => (ORIGIN - y) / world - g.py0;
    const ax = gx(ox), ay = gy(oy), bx = gx(tx), by = gy(ty);
    if (ax < 1 || ay < 1 || bx < 1 || by < 1 || ax >= g.w - 1 || ay >= g.h - 1 || bx >= g.w - 1 || by >= g.h - 1) return null;
    const r = sightTo(g, ax, ay, bx, by, { eyeM, targetM, radiusM: 0, effM: 0, tolM: 1, tables: this._tablesFor(g.res) });
    return r ? { p: r.p, pTerrain: r.pTerrain } : null;
  }

  /** A GROTBC raster byte (the Platoon Guide's `PlProbe` read); null when not known. */
  raster(layer: 'cc' | 'wet' | 'landform' | 'hut' | 'distHls' | 'terrain', x: number, y: number): number | null {
    const L = (this._manifest?.layers ?? {}) as Record<string, string>;
    const name = layer === 'distHls' ? (L.dist ? L.dist.replace('{profile}', 'hls') : 'dist_hls') : (L[layer] ?? layer);
    const v = this._px(name, x, y);
    return v === undefined || v === null ? null : v;
  }

  // ── points and lines ───────────────────────────────────────────────────────────────────────────────────────────────

  private _tileOf(x: number, y: number): { tx: number; ty: number; size: number } {
    const size = (2 * ORIGIN) / 1024; // z10
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
    while (this._index.size > 24) this._index.delete(this._index.keys().next().value as string);
    return t;
  }

  /** The z10 tiles and, in each, the buckets a circle touches. */
  private _visit(x: number, y: number, radiusM: number, fn: (t: IndexedTile, bucket: number) => void): void {
    const r = radiusM / scaleAt(y);
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
    const s = scaleAt(y);
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

  people(x: number, y: number): number | null {
    const p = this._population;
    if (!p) return null;
    if (!p.ready) {
      if (this._popState === 'loading') this._pending = true;
      return null;
    }
    const h = p.header!;
    const [lng, lat] = mercToLngLat(x, y);
    const [w, , , n] = h.bounds;
    return p.cellDensity(Math.floor((n - lat) / h.cell), Math.floor((lng - w) / h.cell));
  }

  /** People round a point by age group (for the cordon), scaled to `people`. */
  agesFor(at: MercXY, radiusKm: number, people: number): { males15_49: number; under15: number; over65: number } | null {
    const p = this._population;
    if (!p?.ready) return null;
    const [lng, lat] = mercToLngLat(at[0], at[1]);
    const r = p.around(lng, lat, Math.max(0.5, radiusKm));
    if (!r?.ages || !(r.people > 0)) return null;
    const k = people / r.people;
    return { males15_49: Math.round(r.ages.males15_49 * k), under15: Math.round(r.ages.under15 * k), over65: Math.round(r.ages.over65 * k) };
  }

  private async _loadBorders(url: string, token: number): Promise<void> {
    try {
      const r = await fetch(url);
      if (!r.ok) return;
      const gj = await r.json();
      if (token !== this._token) return;
      const out: BundleBorder[] = [];
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
    } catch {
      this._borders = [];
    } finally {
      if (token === this._token) {
        this._bordersLoading = false;
        this._changed(false);
      }
    }
  }
}
