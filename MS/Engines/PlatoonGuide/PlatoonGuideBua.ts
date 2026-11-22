/**
 * PlatoonGuideBua.ts
 *
 * The bundle's settlements (settlements.geojson: built-up patches with their people, 2026-11-22) as a compact store the
 * Platoon Guide reads round a point: the BUA's outline where the file has one (about 1,700 towns and cities), else its
 * point and the circle of its built-up area (about 105,000 villages and hamlets). Pure: no DOM, no ArcGIS; the probe
 * builds it in a worker (PlatoonGuideBuaWorker) so the 42 MB file never stalls the map, Node tests build it directly.
 */

import type { PlBuaArea } from './PlatoonGuideRead';

const EARTH_R = 6378137;
const ORIGIN = Math.PI * EARTH_R;
const CELL = 4000; // Mercator metres per index cell

/** What the worker hands back: typed arrays (transferable) and the names. */
export interface BuaStore {
  n: number;
  /** Per settlement: its point (Web Mercator), the radius of a circle of its built-up area (ground m), people. */
  x: Float64Array;
  y: Float64Array;
  radiusM: Float32Array;
  pop: Float64Array;
  /** Index into `classes` (size class: metropolitan ... hamlet). */
  cls: Uint8Array;
  classes: Array<{ key: string; label: string }>;
  names: Array<string | null>;
  /** Outline rings: settlement i owns rings ringOf[i] .. ringOf[i + 1] - 1; ring k is xy[2 * ringAt[k]] .. [2 * ringAt[k + 1]). */
  ringOf: Int32Array;
  ringAt: Int32Array;
  xy: Float64Array;
}

const toX = (lng: number) => (lng * ORIGIN) / 180;
const toY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360)) * EARTH_R;

/** "KOT ADDU" -> "Kot Addu"; mixed case kept. */
function tidy(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  return s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (_m, a: string, c: string) => a + c.toUpperCase()) : s;
}

/** Build the store from the parsed settlements.geojson. */
export function buildBuaStore(gj: any): BuaStore {
  const feats: any[] = Array.isArray(gj?.features) ? gj.features : [];
  const n = feats.length;
  const x = new Float64Array(n), y = new Float64Array(n), pop = new Float64Array(n);
  const radiusM = new Float32Array(n);
  const cls = new Uint8Array(n);
  const names: Array<string | null> = new Array(n);
  const classes: Array<{ key: string; label: string }> = [];
  const classIdx = new Map<string, number>();
  const ringOf = new Int32Array(n + 1);
  const ringAtList: number[] = [0];
  const xyList: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = feats[i];
    const p = f?.properties ?? {};
    const g = f?.geometry;
    let lng = Number(p.lon), lat = Number(p.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      if (g?.type === 'Point') [lng, lat] = g.coordinates;
    }
    x[i] = toX(lng);
    y[i] = toY(lat);
    pop[i] = Number.isFinite(Number(p.pop)) ? Number(p.pop) : NaN;
    const km2 = Number(p.km2);
    radiusM[i] = Number.isFinite(km2) && km2 > 0 ? Math.sqrt(km2 / Math.PI) * 1000 : 0;
    const key = String(p.class ?? '');
    let c = classIdx.get(key);
    if (c === undefined) {
      c = classes.length;
      classes.push({ key, label: String(p.label ?? key) });
      classIdx.set(key, c);
    }
    cls[i] = c;
    names[i] = tidy(p.name);
    ringOf[i] = ringAtList.length - 1;
    const polys: number[][][][] = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys)
      for (const ring of poly) {
        if (!Array.isArray(ring) || ring.length < 3) continue;
        for (const q of ring) xyList.push(toX(q[0]), toY(q[1]));
        ringAtList.push(xyList.length / 2);
      }
  }
  ringOf[n] = ringAtList.length - 1;
  return { n, x, y, radiusM, pop, cls, classes, names, ringOf, ringAt: Int32Array.from(ringAtList), xy: Float64Array.from(xyList) };
}

/** The buffers a worker transfers. */
export function buaTransfer(s: BuaStore): ArrayBuffer[] {
  return [s.x.buffer, s.y.buffer, s.radiusM.buffer, s.pop.buffer, s.cls.buffer, s.ringOf.buffer, s.ringAt.buffer, s.xy.buffer] as ArrayBuffer[];
}

/** A spatial index on the store (Mercator cells): every settlement in each cell its outline or circle touches. */
export class BuaIndex {
  private readonly _cells = new Map<string, number[]>();
  readonly store: BuaStore;

  constructor(store: BuaStore) {
    this.store = store;
    const s = store;
    for (let i = 0; i < s.n; i++) {
      let x0: number, y0: number, x1: number, y1: number;
      if (s.ringOf[i + 1] > s.ringOf[i]) {
        x0 = y0 = Infinity;
        x1 = y1 = -Infinity;
        for (let k = s.ringAt[s.ringOf[i]]; k < s.ringAt[s.ringOf[i + 1]]; k++) {
          x0 = Math.min(x0, s.xy[2 * k]);
          x1 = Math.max(x1, s.xy[2 * k]);
          y0 = Math.min(y0, s.xy[2 * k + 1]);
          y1 = Math.max(y1, s.xy[2 * k + 1]);
        }
      } else {
        // Ground metres to Mercator at the place's latitude.
        const r = s.radiusM[i] / Math.max(0.05, Math.cos(2 * Math.atan(Math.exp(s.y[i] / EARTH_R)) - Math.PI / 2));
        x0 = s.x[i] - r;
        x1 = s.x[i] + r;
        y0 = s.y[i] - r;
        y1 = s.y[i] + r;
      }
      if (!Number.isFinite(x0)) continue;
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
        for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
          const key = `${cx}|${cy}`;
          let a = this._cells.get(key);
          if (!a) this._cells.set(key, (a = []));
          a.push(i);
        }
    }
  }

  /** Settlements whose outline or circle comes within `radiusM` (ground) of a point, as the engine reads them. */
  near(x: number, y: number, radiusM: number, scale: number): PlBuaArea[] {
    const s = this.store;
    const r = radiusM / Math.max(0.05, scale);
    const seen = new Set<number>();
    const out: PlBuaArea[] = [];
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
      for (let cy = Math.floor((y - r) / CELL); cy <= Math.floor((y + r) / CELL); cy++)
        for (const i of this._cells.get(`${cx}|${cy}`) ?? []) {
          if (seen.has(i)) continue;
          seen.add(i);
          const rings: Float64Array[] = [];
          for (let k = s.ringOf[i]; k < s.ringOf[i + 1]; k++) rings.push(s.xy.subarray(2 * s.ringAt[k], 2 * s.ringAt[k + 1]));
          const c = s.classes[s.cls[i]];
          out.push({ name: s.names[i], label: c?.label ?? 'BUA', cls: c?.key ?? '', pop: Number.isFinite(s.pop[i]) ? s.pop[i] : null, x: s.x[i], y: s.y[i], rings: rings.length ? rings : null, radiusM: s.radiusM[i] });
        }
    return out;
  }
}
