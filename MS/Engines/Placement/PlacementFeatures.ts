/**
 * PlacementFeatures.ts
 *
 * Reads the terrain bundle's point features (bundle v2 `features/{z}/{x}/{y}.json`, written by the pipeline's
 * grotbc.py and ground.py) for the Placement Advisor. Today it answers one question: which Important Tactical
 * Ground (ITG) candidates lie near a point. A candidate is any point the pipeline marked with `it` (1 candidate,
 * 2 strong candidate: check as MITG) and `ig` (the reason letters, explained in rules.json `grotbc.itg.reasons`).
 * ITG / MITG belong to G (Ground) in GROTBC; the bundle only names candidates, the user designates.
 *
 * Same rules as the tile cache: the hot path (`candidatesNear`) reads tiles already in memory and never waits;
 * `request` fetches what is missing in the background and calls `onChange` when a tile arrives.
 */

import { mercatorToLngLat } from './TerrainTileCache';
import type { MercXY, PlacementGroundCandidate, PlacementPopulationPlace, TerrainManifest, TerrainRules } from './PlacementTypes';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** Feature kind keys of named places (B): city, district HQ, town, important village, village. */
const PLACE_KINDS = new Set(['city', 'district_hq', 'town', 'village_imp', 'village']);
const EARTH_R = 6378137;
/** Tiles kept in memory (a z10 tile is ~30 km across, so this is a few hundred km of map). */
const MAX_TILES = 48;

type FeatureMeta = NonNullable<NonNullable<TerrainManifest['grotbc']>['features']>;

/** One point of a feature tile, in Web Mercator metres. */
interface FeaturePoint {
  kind: number;
  x: number;
  y: number;
  a: Record<string, unknown> | null;
}

interface KindDef {
  key: string;
  label: string;
}

/** A road line of a feature tile (kind `road`), Web Mercator metres as x0, y0, x1, y1, ... */
interface FeatureRoad {
  xy: Float64Array;
  a: Record<string, unknown>;
}

/** A road near a point: its attributes (n, r, t, c, k, m, w, cn, x; see features/index.json) and the nearest spot on it. */
export interface FeatureRoadHit {
  attrs: Record<string, unknown>;
  distanceM: number;
  bearingDeg: number;
  compass: string;
  at: MercXY;
}

/** Ground distance (m) and bearing (degrees from north) between two Web Mercator points. */
function groundDelta(from: MercXY, to: MercXY): { distanceM: number; bearingDeg: number } {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const lat = 2 * Math.atan(Math.exp(((from[1] + to[1]) / 2) / EARTH_R)) - Math.PI / 2;
  return {
    distanceM: Math.hypot(dx, dy) * Math.cos(lat),
    bearingDeg: ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360,
  };
}

/** The nearest point of a polyline (x0, y0, x1, y1, ...) to `p`, in Web Mercator metres; null for an empty line. */
function nearestOnLine(p: MercXY, xy: Float64Array): MercXY | null {
  let best: MercXY | null = null;
  let bestD = Infinity;
  for (let i = 0; i + 3 < xy.length; i += 2) {
    const ax = xy[i];
    const ay = xy[i + 1];
    const dx = xy[i + 2] - ax;
    const dy = xy[i + 3] - ay;
    const len = dx * dx + dy * dy;
    const t = len > 0 ? Math.min(1, Math.max(0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len)) : 0;
    const qx = ax + t * dx;
    const qy = ay + t * dy;
    const d = (qx - p[0]) ** 2 + (qy - p[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = [qx, qy];
    }
  }
  return best;
}

export class PlacementFeatures {
  private _tiles = new Map<string, FeaturePoint[] | null>();
  /** Road lines per tile (T, the road line on the card); kept in step with `_tiles`. */
  private _roads = new Map<string, FeatureRoad[]>();
  private _pending = new Map<string, Promise<void>>();
  private _kinds: Record<string, KindDef> = {};
  private _index: Promise<void> | null = null;
  private _size: number;
  private _destroyed = false;

  constructor(
    private _base: string,
    private _meta: FeatureMeta,
    private _rules: TerrainRules | null,
    private _onChange: () => void,
  ) {
    this._size = (2 * Math.PI * EARTH_R) / 2 ** _meta.z;
  }

  /** Reason letters → the rule owner's label ("H" → "Highest ground around"). */
  reasonLabel(letter: string): string {
    return this._rules?.grotbc?.itg?.reasons?.[letter]?.label ?? letter;
  }

  /** Fetch the tiles within `radiusM` of a point that are not in memory yet. True when all are already there. */
  request(at: MercXY, radiusM: number): boolean {
    let ready = true;
    for (const [x, y] of this._tilesAround(at, radiusM)) {
      const key = `${x}/${y}`;
      if (this._tiles.has(key)) {
        const pts = this._tiles.get(key)!;
        this._tiles.delete(key); // most recently used goes last
        this._tiles.set(key, pts);
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
    await Promise.all([...this._pending.values()]);
  }

  /**
   * ITG candidates within `radiusM` of a point, strongest first and then nearest. Reads only tiles in memory:
   * `pending` is true when a tile it needs is still on its way.
   */
  candidatesNear(at: MercXY, radiusM: number, max: number, minLevel: 1 | 2 = 1): { list: PlacementGroundCandidate[]; pending: boolean } {
    const pending = !this.request(at, radiusM);
    const found: PlacementGroundCandidate[] = [];
    for (const [x, y] of this._tilesAround(at, radiusM)) {
      const pts = this._tiles.get(`${x}/${y}`);
      if (!pts) continue;
      for (const p of pts) {
        const level = p.a?.it;
        if (level !== 1 && level !== 2) continue;
        if (level < minLevel) continue;
        const { distanceM, bearingDeg } = groundDelta(at, [p.x, p.y]);
        if (distanceM > radiusM) continue;
        found.push(this._candidate(p, level, distanceM, bearingDeg));
      }
    }
    found.sort((a, b) => b.level - a.level || a.distanceM - b.distanceM);
    return { list: found.slice(0, max), pending };
  }

  /**
   * Named places (city, district HQ, town, important village, village) within `radiusM` of a point, nearest first,
   * with the WorldPop people nearest each (`wp`, else the official `p`). Reads only tiles in memory, like
   * `candidatesNear`.
   */
  placesNear(at: MercXY, radiusM: number, max = 30): { list: PlacementPopulationPlace[]; pending: boolean } {
    const pending = !this.request(at, radiusM);
    const found: PlacementPopulationPlace[] = [];
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
    for (const [x, y] of this._tilesAround(at, radiusM)) {
      const pts = this._tiles.get(`${x}/${y}`);
      if (!pts) continue;
      for (const p of pts) {
        const k = this._kinds[String(p.kind)];
        if (!k || !PLACE_KINDS.has(k.key)) continue;
        const name = str(p.a?.n);
        if (!name) continue;
        const { distanceM, bearingDeg } = groundDelta(at, [p.x, p.y]);
        if (distanceM > radiusM) continue;
        const a = p.a ?? {};
        found.push({
          // The NCGDB writes many names in capitals: "KHARIAN" reads better as "Kharian".
          name: name === name.toUpperCase() ? name.toLowerCase().replace(/(^|[\s(-])(\p{L})/gu, (_m, s: string, c: string) => s + c.toUpperCase()) : name,
          kind: k.key,
          kindLabel: k.label,
          people: num(a.wp) ?? num(a.p),
          province: str(a.pv),
          district: str(a.d),
          tehsil: str(a.h),
          distanceM,
          bearingDeg,
          compass: COMPASS[Math.round(bearingDeg / 45) % 8],
          lngLat: mercatorToLngLat(p.x, p.y),
        });
      }
    }
    found.sort((a, b) => a.distanceM - b.distanceM);
    return { list: found.slice(0, max), pending };
  }

  /**
   * Roads within `radiusM` of a point, nearest first, one entry per road (the NCGDB splits a road into many
   * segments; they are merged by number, name, type and load code). Reads only tiles in memory, like
   * `candidatesNear`.
   */
  roadsNear(at: MercXY, radiusM: number): { list: FeatureRoadHit[]; pending: boolean } {
    const pending = !this.request(at, radiusM);
    const best = new Map<string, FeatureRoadHit>();
    for (const [x, y] of this._tilesAround(at, radiusM)) {
      const key = `${x}/${y}`;
      if (!this._tiles.has(key)) continue;
      for (const r of this._roads.get(key) ?? []) {
        const near = nearestOnLine(at, r.xy);
        if (!near) continue;
        const { distanceM, bearingDeg } = groundDelta(at, near);
        if (distanceM > radiusM) continue;
        const a = r.a;
        const id = `${a.r ?? ''}|${a.n ?? ''}|${a.t ?? ''}|${a.c ?? ''}`;
        const prev = best.get(id);
        if (prev && prev.distanceM <= distanceM) continue;
        best.set(id, { attrs: a, distanceM, bearingDeg, compass: COMPASS[Math.round(bearingDeg / 45) % 8], at: near });
      }
    }
    return { list: [...best.values()].sort((p, q) => p.distanceM - q.distanceM), pending };
  }

  clear(): void {
    this._tiles.clear();
    this._roads.clear();
    this._pending.clear();
  }

  destroy(): void {
    this._destroyed = true;
    this.clear();
  }

  private _candidate(p: FeaturePoint, level: 1 | 2, distanceM: number, bearingDeg: number): PlacementGroundCandidate {
    const a = p.a ?? {};
    const k = this._kinds[String(p.kind)];
    const reasons = String(a.ig ?? '').split('').filter(Boolean);
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    // The NCGDB names many bridges just "Bridge": a name that only repeats the kind is no name.
    const raw = typeof a.n === 'string' ? a.n.trim() : '';
    const name = raw && raw.toLowerCase() !== (k?.label ?? '').toLowerCase() ? raw : null;
    return {
      kind: k?.key ?? String(p.kind),
      kindLabel: k?.label ?? 'Feature',
      name,
      level,
      reasons,
      reasonLabels: reasons.map((r) => this.reasonLabel(r)),
      elevationM: num(a.e),
      at: [p.x, p.y],
      lngLat: mercatorToLngLat(p.x, p.y),
      distanceM,
      bearingDeg,
      compass: COMPASS[Math.round(bearingDeg / 45) % 8],
      attributes: { ...a },
    };
  }

  private _tilesAround(at: MercXY, radiusM: number): Array<[number, number]> {
    const lat = 2 * Math.atan(Math.exp(at[1] / EARTH_R)) - Math.PI / 2;
    const r = radiusM / Math.max(Math.cos(lat), 0.2); // ground metres → Mercator metres
    const o = Math.PI * EARTH_R;
    const n = 2 ** this._meta.z;
    const tx = (x: number) => Math.min(n - 1, Math.max(0, Math.floor((x + o) / this._size)));
    const ty = (y: number) => Math.min(n - 1, Math.max(0, Math.floor((o - y) / this._size)));
    const out: Array<[number, number]> = [];
    for (let x = tx(at[0] - r); x <= tx(at[0] + r); x++) {
      for (let y = ty(at[1] + r); y <= ty(at[1] - r); y++) out.push([x, y]);
    }
    return out;
  }

  private _loadIndex(): Promise<void> {
    if (!this._index) {
      this._index = fetch(`${this._base}/${this._meta.index}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((idx) => {
          if (idx?.kinds) this._kinds = idx.kinds;
        })
        .catch(() => {
          this._index = null; // try again with the next tile
        });
    }
    return this._index;
  }

  private async _load(x: number, y: number, key: string): Promise<void> {
    const url = `${this._base}/${this._meta.path.replace('{z}', String(this._meta.z)).replace('{x}', String(x)).replace('{y}', String(y))}`;
    try {
      await this._loadIndex();
      const resp = await fetch(url);
      // 404: the pipeline writes no tile where there are no features, so it is an empty tile, not an error.
      const pts = resp.ok ? this._decode(await resp.json(), x, y) : resp.status === 404 ? [] : undefined;
      if (this._destroyed) return;
      if (pts !== undefined) {
        this._tiles.set(key, pts);
        while (this._tiles.size > MAX_TILES) {
          const old = this._tiles.keys().next().value as string;
          this._tiles.delete(old);
          this._roads.delete(old);
        }
      }
    } catch {
      /* network error: left out, so the next request tries again */
    } finally {
      this._pending.delete(key);
      if (!this._destroyed) this._onChange();
    }
  }

  private _decode(obj: any, tx: number, ty: number): FeaturePoint[] {
    const q = obj?.q ?? this._meta.quant;
    const o = Math.PI * EARTH_R;
    const minx = -o + tx * this._size;
    const maxy = o - ty * this._size;
    const out: FeaturePoint[] = [];
    for (const p of obj?.p ?? []) {
      if (!Array.isArray(p) || p.length < 3) continue;
      out.push({ kind: p[0], x: minx + (p[1] / q) * this._size, y: maxy - (p[2] / q) * this._size, a: p[3] ?? null });
    }
    // Road lines (`l`, kind `road`) for the T road line; other line kinds are not read yet.
    const roads: FeatureRoad[] = [];
    for (const l of obj?.l ?? []) {
      if (!Array.isArray(l) || !Array.isArray(l[1]) || l[1].length < 4 || this._kinds[String(l[0])]?.key !== 'road') continue;
      const c = l[1] as number[];
      const xy = new Float64Array(c.length - (c.length % 2));
      for (let i = 0; i < xy.length; i += 2) {
        xy[i] = minx + (c[i] / q) * this._size;
        xy[i + 1] = maxy - (c[i + 1] / q) * this._size;
      }
      roads.push({ xy, a: (l[2] as Record<string, unknown>) ?? {} });
    }
    this._roads.set(`${tx}/${ty}`, roads);
    return out;
  }
}
