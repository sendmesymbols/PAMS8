/**
 * PlatoonGuideSide.ts
 *
 * Which side of the LoC or an international border a place is on, so the Platoon Guide never offers the other side's
 * posts, police stations, cantonments, hospitals or airfields as help (review 2026-11-22: the bundle's frame holds
 * Indian and IIOJ&K features, e.g. a cantonment "SRINAGAR, 15 Corps", BSF border posts round Jammu and Ferozepur).
 * Pure: no DOM, no ArcGIS. The probe feeds it the bundle's admin.geojson `country` areas and boundaries.geojson lines;
 * Node tests feed it the same files.
 *
 * Away from a line the country areas decide (they follow the lines to about 0.2 km). Near one (`nearLineM`) the line
 * decides: each stretch of it knows the country on its left and on its right (the areas read `voteKm` out on each side,
 * by majority over `window` stretches either way, so a tight bend or a stretch where the area strays from the line does
 * not flip it), and the place takes the country of the side it is on. A place within `onLineM` of the line is not known,
 * so it is never offered as own (checked against the bundle: 99.8 % of LoC stretches part own from other 100 m out).
 *
 * The areas are the official map's: Siachen reads as Pakistan's side (the map's line, not the AGPL).
 */

type Ring = number[][];

interface Area {
  name: string;
  box: [number, number, number, number];
  /** Edges as x0, y0, x1, y1 (lng / lat), and per latitude band the edges that span it. */
  edges: Float64Array;
  bands: Map<number, Int32Array>;
}

interface SideLine {
  kind: string;
  /** lng, lat pairs. */
  xy: Float64Array;
  /** Per stretch (segment), the area index on its left / right (-1: none). */
  left: Int16Array;
  right: Int16Array;
}

const BAND = 0.05; // degrees of latitude per band of the area index
const CELL = 0.02; // degrees per cell of the line index (about 2 km)
const KM_LAT = 110.574;
const KM_LON = 111.32;

export interface PlSideOptions {
  /** The own country's name as admin.geojson writes it ("Pakistan"). */
  own: string;
  /** Boundary kinds that are a side line (the LoC, the LAC, international borders); null: every kind but internal ones. */
  kinds?: ReadonlySet<string> | null;
  /** Within this many ground metres of a line, the line decides the side. */
  nearLineM?: number;
  /** Within this many ground metres of a line a place is on it: its side is not known (where the line zig-zags and the
   *  data's own lines disagree), so it is never offered as own. */
  onLineM?: number;
  /** Where the areas are read on each side of a stretch, km. */
  voteKm?: number[];
  /** Stretches either way that vote with it. */
  window?: number;
}

/** True for a boundary kind that is a side line when no list is given: not province, corps, "political" or planning lines. */
function defaultKind(kind: string, props: any): boolean {
  const k = kind.toLowerCase();
  return !!kind && !k.startsWith('province') && !k.startsWith('corps') && !k.startsWith('political') && !/\bkm line\b/.test(k) && !props?.sensitive;
}

export class PlSideMap {
  private readonly _areas: Area[];
  private readonly _lines: SideLine[];
  private readonly _cells = new Map<string, number[]>();
  private readonly _own: string;
  private readonly _nearKm: number;
  private readonly _onKm: number;

  private constructor(areas: Area[], lines: Array<{ kind: string; xy: Float64Array }>, o: PlSideOptions) {
    this._areas = areas;
    this._own = o.own;
    this._nearKm = (o.nearLineM ?? 1000) / 1000;
    this._onKm = Math.min(this._nearKm, (o.onLineM ?? 100) / 1000);
    const vote = o.voteKm ?? [0.5, 1.0];
    const win = o.window ?? 6;
    this._lines = lines.map((l) => this._label(l, vote, win));
    // Line index: each stretch in every cell its box touches.
    this._lines.forEach((l, li) => {
      for (let i = 0; i + 3 < l.xy.length; i += 2) {
        const x0 = Math.min(l.xy[i], l.xy[i + 2]), x1 = Math.max(l.xy[i], l.xy[i + 2]);
        const y0 = Math.min(l.xy[i + 1], l.xy[i + 3]), y1 = Math.max(l.xy[i + 1], l.xy[i + 3]);
        for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
          for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
            const key = `${cx}|${cy}`;
            let a = this._cells.get(key);
            if (!a) this._cells.set(key, (a = []));
            a.push(li * 1048576 + i / 2);
          }
      }
    });
  }

  /**
   * Build from the parsed admin.geojson (its `country` areas) and boundaries.geojson (its lines); null when the admin
   * file has no country areas or the own country is not among them.
   */
  static from(admin: any, boundaries: any | null, o: PlSideOptions): PlSideMap | null {
    const areas: Area[] = [];
    for (const f of admin?.features ?? []) {
      if (f?.properties?.layer !== 'country') continue;
      const name = typeof f.properties.name === 'string' ? f.properties.name.trim() : '';
      const g = f.geometry;
      const polys: Ring[][] = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
      if (!name || !polys.length) continue;
      areas.push(areaOf(name, polys.flat()));
    }
    if (!areas.some((a) => a.name === o.own)) return null;
    const lines: Array<{ kind: string; xy: Float64Array }> = [];
    for (const f of boundaries?.features ?? []) {
      const kind = typeof f?.properties?.kind === 'string' ? f.properties.kind : '';
      if (!(o.kinds ? o.kinds.has(kind) : defaultKind(kind, f?.properties))) continue;
      const g = f.geometry;
      const parts: number[][][] = g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : [];
      for (const p of parts) {
        if (!Array.isArray(p) || p.length < 2) continue;
        const xy = new Float64Array(p.length * 2);
        p.forEach((q, i) => {
          xy[2 * i] = q[0];
          xy[2 * i + 1] = q[1];
        });
        lines.push({ kind, xy });
      }
    }
    return new PlSideMap(areas, lines, o);
  }

  /** The country area at a point (lng, lat), or null outside every area. */
  countryAt(lng: number, lat: number): string | null {
    const i = this._areaAt(lng, lat);
    return i < 0 ? null : this._areas[i].name;
  }

  /** The side a place is on: 'own', 'other', or null (on the line itself, or outside every area). */
  side(lng: number, lat: number): 'own' | 'other' | null {
    const near = this._nearLine(lng, lat);
    let area: number;
    if (near) {
      if (near.onLine) return null;
      area = near.area >= 0 ? near.area : this._areaAt(lng, lat);
    } else area = this._areaAt(lng, lat);
    if (area < 0) return null;
    return this._areas[area].name === this._own ? 'own' : 'other';
  }

  // ── inside ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  private _areaAt(x: number, y: number): number {
    for (let a = 0; a < this._areas.length; a++) {
      const A = this._areas[a];
      if (x < A.box[0] || x > A.box[2] || y < A.box[1] || y > A.box[3]) continue;
      const list = A.bands.get(Math.floor(y / BAND));
      if (!list) continue;
      let inside = false;
      const e = A.edges;
      for (const k of list) {
        const x0 = e[4 * k], y0 = e[4 * k + 1], x1 = e[4 * k + 2], y1 = e[4 * k + 3];
        if (y0 > y !== y1 > y && x < ((x1 - x0) * (y - y0)) / (y1 - y0) + x0) inside = !inside;
      }
      if (inside) return a;
    }
    return -1;
  }

  /** Label a line's stretches with the areas on their left and right. */
  private _label(l: { kind: string; xy: Float64Array }, voteKm: number[], win: number): SideLine {
    const n = Math.max(0, l.xy.length / 2 - 1);
    const rawL: number[][] = [];
    const rawR: number[][] = [];
    for (let i = 0; i < n; i++) {
      const x0 = l.xy[2 * i], y0 = l.xy[2 * i + 1], x1 = l.xy[2 * i + 2], y1 = l.xy[2 * i + 3];
      const my = (y0 + y1) / 2;
      const kx = KM_LON * Math.cos((my * Math.PI) / 180);
      const dx = (x1 - x0) * kx, dy = (y1 - y0) * KM_LAT;
      const L = Math.hypot(dx, dy);
      const vl: number[] = [], vr: number[] = [];
      if (L > 1e-6) {
        const nx = -dy / L, ny = dx / L; // left normal, km frame
        const mx = (x0 + x1) / 2;
        for (const off of voteKm) {
          vl.push(this._areaAt(mx + (nx * off) / kx, my + (ny * off) / KM_LAT));
          vr.push(this._areaAt(mx - (nx * off) / kx, my - (ny * off) / KM_LAT));
        }
      }
      rawL.push(vl);
      rawR.push(vr);
    }
    const mode = (raw: number[][], i: number): number => {
      const count = new Map<number, number>();
      for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j++) for (const v of raw[j]) if (v >= 0) count.set(v, (count.get(v) ?? 0) + 1);
      let best = -1, bestN = 0;
      for (const [v, c] of count) if (c > bestN) [best, bestN] = [v, c];
      return best;
    };
    const left = new Int16Array(n), right = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      left[i] = mode(rawL, i);
      right[i] = mode(rawR, i);
      // Both sides the same area: the line does not part two areas here (the areas stray); leave it to them.
      if (left[i] === right[i]) left[i] = right[i] = -1;
    }
    return { kind: l.kind, xy: l.xy, left, right };
  }

  /** The nearest side-line stretch within `nearLineM`: the area on the place's side of it, or onLine. */
  private _nearLine(x: number, y: number): { area: number; onLine: boolean } | null {
    if (!this._lines.length) return null;
    const kx = KM_LON * Math.cos((y * Math.PI) / 180);
    const rx = this._nearKm / kx, ry = this._nearKm / KM_LAT;
    let best = Infinity, bl = -1, bs = -1, bt = 0;
    const seen = new Set<number>();
    for (let cx = Math.floor((x - rx) / CELL); cx <= Math.floor((x + rx) / CELL); cx++)
      for (let cy = Math.floor((y - ry) / CELL); cy <= Math.floor((y + ry) / CELL); cy++)
        for (const code of this._cells.get(`${cx}|${cy}`) ?? []) {
          if (seen.has(code)) continue;
          seen.add(code);
          const li = Math.floor(code / 1048576), si = code % 1048576;
          const xy = this._lines[li].xy;
          const ax = (xy[2 * si] - x) * kx, ay = (xy[2 * si + 1] - y) * KM_LAT;
          const dx = (xy[2 * si + 2] - xy[2 * si]) * kx, dy = (xy[2 * si + 3] - xy[2 * si + 1]) * KM_LAT;
          const L = dx * dx + dy * dy;
          const t = L > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / L)) : 0;
          const d = Math.hypot(ax + t * dx, ay + t * dy);
          if (d < best) [best, bl, bs, bt] = [d, li, si, t];
        }
    if (bl < 0 || best > this._nearKm) return null;
    if (best < this._onKm) return { area: -1, onLine: true };
    const line = this._lines[bl];
    const xy = line.xy;
    const nSeg = line.left.length;
    // The side: the stretch's left normal, or at a corner the sum of both stretches' normals (so a place inside a bend
    // is never put on the wrong side by the stretch it happens to be nearest).
    const normal = (s: number): [number, number] => {
      const dx = (xy[2 * s + 2] - xy[2 * s]) * kx, dy = (xy[2 * s + 3] - xy[2 * s + 1]) * KM_LAT;
      const L = Math.hypot(dx, dy) || 1;
      return [-dy / L, dx / L];
    };
    let [nx, ny] = normal(bs);
    if (bt <= 0 && bs > 0) {
      const p = normal(bs - 1);
      [nx, ny] = [nx + p[0], ny + p[1]];
    } else if (bt >= 1 && bs + 1 < nSeg) {
      const q = normal(bs + 1);
      [nx, ny] = [nx + q[0], ny + q[1]];
    }
    const ax = (xy[2 * bs] - x) * kx, ay = (xy[2 * bs + 1] - y) * KM_LAT;
    const dx = (xy[2 * bs + 2] - xy[2 * bs]) * kx, dy = (xy[2 * bs + 3] - xy[2 * bs + 1]) * KM_LAT;
    // v: the nearest point, km from the place; the place seen from it is -v, on the left when that points along the normal.
    const vx = ax + bt * dx;
    const vy = ay + bt * dy;
    const onLeft = -vx * nx + -vy * ny > 0;
    const area = onLeft ? line.left[bs] : line.right[bs];
    return { area, onLine: false };
  }
}

function areaOf(name: string, rings: Ring[]): Area {
  let n = 0;
  for (const r of rings) n += Math.max(0, r.length - (sameEnds(r) ? 1 : 0));
  const edges = new Float64Array(n * 4);
  const bands = new Map<number, number[]>();
  let k = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) {
    const m = r.length - (sameEnds(r) ? 1 : 0);
    for (let i = 0; i < m; i++) {
      const a = r[i], b = r[(i + 1) % m];
      edges.set([a[0], a[1], b[0], b[1]], 4 * k);
      x0 = Math.min(x0, a[0]);
      x1 = Math.max(x1, a[0]);
      y0 = Math.min(y0, a[1]);
      y1 = Math.max(y1, a[1]);
      for (let bnd = Math.floor(Math.min(a[1], b[1]) / BAND); bnd <= Math.floor(Math.max(a[1], b[1]) / BAND); bnd++) {
        let list = bands.get(bnd);
        if (!list) bands.set(bnd, (list = []));
        list.push(k);
      }
      k++;
    }
  }
  const packed = new Map<number, Int32Array>();
  for (const [b, list] of bands) packed.set(b, Int32Array.from(list));
  return { name, box: [x0, y0, x1, y1], edges, bands: packed };
}

function sameEnds(r: Ring): boolean {
  return r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1];
}
