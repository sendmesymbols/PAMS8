/**
 * GroundGuideRoads.ts
 *
 * The roads the card's T road line names, read from the terrain bundle's routing network (`network/gg/10/x/y.bin`,
 * written by the pipeline's network.py `write_gg_roads`). They are the same edges, load classes, MSR and tankable
 * flags GeoCore routes on and the map's roads layer draws, so the card, a route and the map name the same road the
 * same way. Residential, service and path edges are left out unless they are an MSR, tankable or load-classed.
 *
 * Same rules as GroundGuideFeatures: the hot path (`roadsNear`, every mouse move) reads only tiles in memory and
 * never waits; `request` fetches what is missing in the background and calls `onChange` when a tile arrives. A tile
 * is a few typed-array views over one binary file, so loading costs no parsing; a bounding box per edge keeps the
 * search to the few edges near the cursor.
 *
 * Answers in the shape GroundGuideFeatures.roadsNear does (attributes n, r, t, c, k, m, plus aw, x, e, src), so
 * `pickRoad` reads either source.
 */

import type { FeatureRoadHit } from './GroundGuideFeatures';
import type { MercXY } from './GroundGuideTypes';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const EARTH_R = 6378137;
const ORIGIN = Math.PI * EARTH_R;
/** Tiles kept in memory: the largest is ~2 MB (Karachi), most are well under 100 kB. */
const MAX_TILES = 24;

/** network.json flag bits (network.py FLAG_BITS). */
const F_MSR = 1 << 1;
const F_FAIR = 1 << 3;
const F_TANKABLE = 1 << 5;

/** OSM road classes (network.py CLAZZ). */
const CLAZZ: Record<number, string> = {
  11: 'motorway', 12: 'motorway link', 13: 'trunk', 14: 'trunk link', 15: 'primary', 16: 'primary link',
  21: 'secondary', 22: 'secondary link', 31: 'tertiary', 32: 'tertiary link', 41: 'residential', 42: 'road',
  43: 'unclassified', 51: 'service', 63: 'track', 71: 'track', 81: 'path', 91: 'path',
};
/** Classes that are fair-weather whatever the flags say: tracks and paths. */
const UNMETALLED = new Set([63, 71, 81, 91]);

/** network.json `groundGuide`. */
export interface GroundGuideRoadsMeta {
  tiles: string;
  z: number;
  format: string;
  quant: number;
}

interface RoadTile {
  n: number;
  edge: Uint32Array;
  name: Uint32Array;
  rno: Uint32Array;
  start: Uint32Array;
  flags: Uint16Array;
  clazz: Uint8Array;
  load: Uint8Array;
  xing: Uint8Array;
  /** Web Mercator x, y of every point. */
  xy: Float64Array;
  /** minx, miny, maxx, maxy per edge. */
  box: Float64Array;
}

export class GroundGuideRoads {
  private _tiles = new Map<string, RoadTile | null>();
  private _pending = new Map<string, Promise<void>>();
  private _names: string[] | null = null;
  private _namesLoad: Promise<void> | null = null;
  private _size: number;
  private _destroyed = false;

  /**
   * The network the bundle ships for the card, or null when it has none (a bundle built before it): the caller then
   * keeps the NCGDB road lines.
   */
  static async open(base: string, networkIndex: string, onChange: () => void): Promise<GroundGuideRoads | null> {
    try {
      const r = await fetch(`${base}/${networkIndex}`);
      if (!r.ok) return null;
      const j = await r.json();
      const gg = j?.groundGuide as GroundGuideRoadsMeta | undefined;
      if (!gg || gg.format !== 'GGR1' || !Number.isFinite(gg.z)) return null;
      const dir = networkIndex.replace(/[^/]*$/, ''); // network/network.json -> network/
      return new GroundGuideRoads(`${base}/${dir}`, gg, String(j.dataVersion ?? ''), onChange);
    } catch {
      return null;
    }
  }

  private constructor(
    private _base: string,
    private _meta: GroundGuideRoadsMeta,
    /** The routing network's version: the same as GeoCore's when the two match. */
    readonly dataVersion: string,
    private _onChange: () => void,
  ) {
    this._size = (2 * ORIGIN) / 2 ** _meta.z;
  }

  /** Fetch the tiles within `radiusM` of a point that are not in memory yet. True when all are already there. */
  request(at: MercXY, radiusM: number): boolean {
    let ready = this._names !== null;
    if (!this._names) this._loadNames();
    for (const [x, y] of this._tilesAround(at, radiusM)) {
      const key = `${x}/${y}`;
      if (this._tiles.has(key)) {
        const t = this._tiles.get(key)!;
        this._tiles.delete(key); // most recently used goes last
        this._tiles.set(key, t);
        continue;
      }
      ready = false;
      if (!this._pending.has(key)) this._pending.set(key, this._load(x, y, key));
    }
    return ready;
  }

  /** As `request`, resolving once the tiles have arrived (or failed). */
  async whenReady(at: MercXY, radiusM: number): Promise<void> {
    this.request(at, radiusM);
    await Promise.all([...this._pending.values(), this._namesLoad]);
  }

  /**
   * Roads within `radiusM` of a point, nearest first, one entry per road (a road is many edges: one per stretch
   * between junctions; they are merged by number, name, class and load class). Reads only tiles in memory.
   */
  roadsNear(at: MercXY, radiusM: number): { list: FeatureRoadHit[]; pending: boolean } {
    const pending = !this.request(at, radiusM);
    const lat = 2 * Math.atan(Math.exp(at[1] / EARTH_R)) - Math.PI / 2;
    const cos = Math.max(Math.cos(lat), 0.2);
    const r = radiusM / cos; // ground metres -> Web Mercator metres
    const best = new Map<string, FeatureRoadHit>();
    const names = this._names ?? [];
    for (const [x, y] of this._tilesAround(at, radiusM)) {
      const t = this._tiles.get(`${x}/${y}`);
      if (!t) continue;
      const { box, xy, start } = t;
      for (let i = 0; i < t.n; i++) {
        const b = i * 4;
        if (box[b] > at[0] + r || box[b + 2] < at[0] - r || box[b + 1] > at[1] + r || box[b + 3] < at[1] - r) continue;
        // Nearest point of the edge.
        let bx = 0, by = 0, bd = Infinity;
        for (let p = start[i]; p + 1 < start[i + 1]; p++) {
          const ax = xy[2 * p], ay = xy[2 * p + 1];
          const dx = xy[2 * p + 2] - ax, dy = xy[2 * p + 3] - ay;
          const len = dx * dx + dy * dy;
          const u = len > 0 ? Math.min(1, Math.max(0, ((at[0] - ax) * dx + (at[1] - ay) * dy) / len)) : 0;
          const qx = ax + u * dx, qy = ay + u * dy;
          const d = (qx - at[0]) ** 2 + (qy - at[1]) ** 2;
          if (d < bd) { bd = d; bx = qx; by = qy; }
        }
        if (bd === Infinity) continue;
        const distanceM = Math.sqrt(bd) * cos;
        if (distanceM > radiusM) continue;
        const clazz = t.clazz[i], load = t.load[i], f = t.flags[i];
        const name = names[t.name[i]] ?? '';
        const rno = names[t.rno[i]] ?? '';
        const id = `${rno}|${name}|${clazz}|${load}`;
        const prev = best.get(id);
        if (prev && prev.distanceM <= distanceM) continue;
        const bearingDeg = ((Math.atan2(bx - at[0], by - at[1]) * 180) / Math.PI + 360) % 360;
        best.set(id, {
          attrs: {
            n: name || undefined,
            r: rno || undefined,
            t: CLAZZ[clazz] ?? 'road',
            c: load ? String(load) : undefined,
            aw: !(f & F_FAIR) && !UNMETALLED.has(clazz),
            k: f & F_TANKABLE ? 3 : load >= 50 ? 2 : load > 0 ? 1 : 0,
            m: f & F_MSR ? 1 : 0,
            x: t.xing[i],
            e: t.edge[i],
            src: 'network',
          },
          distanceM,
          bearingDeg,
          compass: COMPASS[Math.round(bearingDeg / 45) % 8],
          at: [bx, by],
        });
      }
    }
    return { list: [...best.values()].sort((p, q) => p.distanceM - q.distanceM), pending };
  }

  destroy(): void {
    this._destroyed = true;
    this._tiles.clear();
    this._pending.clear();
  }

  private _tilesAround(at: MercXY, radiusM: number): Array<[number, number]> {
    const lat = 2 * Math.atan(Math.exp(at[1] / EARTH_R)) - Math.PI / 2;
    // Edges are filed in the tile of their middle and may reach half a tile out, so look one step wider.
    const r = radiusM / Math.max(Math.cos(lat), 0.2) + this._size / 2;
    const n = 2 ** this._meta.z;
    const tx = (x: number) => Math.min(n - 1, Math.max(0, Math.floor((x + ORIGIN) / this._size)));
    const ty = (y: number) => Math.min(n - 1, Math.max(0, Math.floor((ORIGIN - y) / this._size)));
    const out: Array<[number, number]> = [];
    for (let x = tx(at[0] - r); x <= tx(at[0] + r); x++) {
      for (let y = ty(at[1] + r); y <= ty(at[1] - r); y++) out.push([x, y]);
    }
    return out;
  }

  private _loadNames(): void {
    if (this._namesLoad) return;
    this._namesLoad = fetch(`${this._base}names.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((n) => {
        if (this._destroyed) return;
        this._names = Array.isArray(n) ? n : [];
        this._onChange();
      })
      .catch(() => {
        this._namesLoad = null; // try again with the next request
      });
  }

  private async _load(x: number, y: number, key: string): Promise<void> {
    const url = `${this._base}${this._meta.tiles.replace('{z}', String(this._meta.z)).replace('{x}', String(x)).replace('{y}', String(y))}`;
    try {
      const resp = await fetch(url);
      // 404: no road in the tile.
      const tile = resp.ok ? this._decode(await resp.arrayBuffer(), x, y) : resp.status === 404 ? null : undefined;
      if (this._destroyed) return;
      if (tile !== undefined) {
        this._tiles.set(key, tile);
        while (this._tiles.size > MAX_TILES) this._tiles.delete(this._tiles.keys().next().value as string);
      }
    } catch {
      /* network error: left out, so the next request tries again */
    } finally {
      this._pending.delete(key);
      if (!this._destroyed) this._onChange();
    }
  }

  /** One GGR1 tile (layout in network.py write_gg_roads). */
  private _decode(buf: ArrayBuffer, tx: number, ty: number): RoadTile | null {
    if (buf.byteLength < 12) return null;
    const head = new Uint8Array(buf, 0, 4);
    if (String.fromCharCode(head[0], head[1], head[2], head[3]) !== 'GGR1') return null;
    const [n, npts] = new Uint32Array(buf, 4, 2);
    let o = 12;
    const u32 = (len: number) => { const a = new Uint32Array(buf, o, len); o += len * 4; return a; };
    const u16 = (len: number) => { const a = new Uint16Array(buf, o, len); o += len * 2; return a; };
    const u8 = (len: number) => { const a = new Uint8Array(buf, o, len); o += len; return a; };
    const edge = u32(n), name = u32(n), rno = u32(n), start = u32(n + 1);
    const flags = u16(n), q = u16(npts * 2);
    const clazz = u8(n), load = u8(n), xing = u8(n);
    const span = 2 * this._size;
    const ox = -ORIGIN + tx * this._size - this._size / 2;
    const oy = ORIGIN - ty * this._size + this._size / 2;
    const k = span / (this._meta.quant || 65535);
    const xy = new Float64Array(npts * 2);
    for (let i = 0; i < npts; i++) {
      xy[2 * i] = ox + q[2 * i] * k;
      xy[2 * i + 1] = oy - q[2 * i + 1] * k;
    }
    const box = new Float64Array(n * 4);
    for (let i = 0; i < n; i++) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let p = start[i]; p < start[i + 1]; p++) {
        const x = xy[2 * p], y = xy[2 * p + 1];
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      box.set([x0, y0, x1, y1], i * 4);
    }
    return { n, edge, name, rno, start, flags, clazz, load, xing, xy, box };
  }
}
