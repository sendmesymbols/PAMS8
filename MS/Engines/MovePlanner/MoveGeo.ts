/**
 * MoveGeo.ts
 *
 * Route geometry for the Move Planner, in longitude / latitude with great-circle metres. Pure.
 *
 *   path      a route as points with their running distance (chainage) from the SP.
 *   meets     where two routes cross or share road: a crossing point, the start ("join") and end ("leave") of a stretch
 *             both use in the same direction, and stretches used head-on ("meet"). The old DI code took the first vertex of
 *             a shared stretch and never saw two routes crossing at a junction; this finds both, at the true point.
 */

export type LngLat = [number, number];

export interface MvPath {
  pts: LngLat[];
  /** Running distance (m) at each point. */
  cum: number[];
  length: number;
}

const R_EARTH = 6371008.8;
const D2R = Math.PI / 180;

export function havM(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * D2R, dLng = (b[0] - a[0]) * D2R;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearingDeg(a: LngLat, b: LngLat): number {
  const y = Math.sin((b[0] - a[0]) * D2R) * Math.cos(b[1] * D2R);
  const x = Math.cos(a[1] * D2R) * Math.sin(b[1] * D2R) - Math.sin(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.cos((b[0] - a[0]) * D2R);
  return ((Math.atan2(y, x) / D2R) % 360 + 360) % 360;
}

export function mkPath(pts: LngLat[]): MvPath {
  const clean: LngLat[] = [];
  for (const p of pts ?? []) {
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const q: LngLat = [p[0], p[1]];
    const last = clean[clean.length - 1];
    if (last && last[0] === q[0] && last[1] === q[1]) continue;
    clean.push(q);
  }
  const cum = [0];
  for (let i = 1; i < clean.length; i++) cum.push(cum[i - 1] + havM(clean[i - 1], clean[i]));
  return { pts: clean, cum, length: cum[cum.length - 1] ?? 0 };
}

function segIndex(p: MvPath, s: number): number {
  let lo = 0, hi = p.cum.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (p.cum[m] <= s) lo = m;
    else hi = m;
  }
  return lo;
}

/** The point `s` metres along the path (clamped to its ends). */
export function pointAtS(p: MvPath, s: number): LngLat {
  if (!p.pts.length) return [0, 0];
  if (s <= 0 || p.pts.length === 1) return p.pts[0];
  if (s >= p.length) return p.pts[p.pts.length - 1];
  const i = segIndex(p, s);
  const a = p.pts[i], b = p.pts[i + 1];
  const d = p.cum[i + 1] - p.cum[i];
  const f = d > 0 ? (s - p.cum[i]) / d : 0;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

/** The path between two chainages, s0 < s1 (both clamped). */
export function slicePath(p: MvPath, s0: number, s1: number): LngLat[] {
  const a = Math.max(0, Math.min(p.length, s0)), b = Math.max(0, Math.min(p.length, s1));
  if (b <= a || p.pts.length < 2) return [pointAtS(p, a)];
  const out: LngLat[] = [pointAtS(p, a)];
  for (let i = segIndex(p, a) + 1; i < p.pts.length && p.cum[i] < b; i++) out.push(p.pts[i]);
  out.push(pointAtS(p, b));
  return out;
}

// ── local plane for one comparison ───────────────────────────────────────────────────────────────────────────────────

interface Plane {
  lat0: number;
  lng0: number;
  kx: number;
  ky: number;
}
function planeFor(lat0: number, lng0: number): Plane {
  return { lat0, lng0, kx: R_EARTH * D2R * Math.cos(lat0 * D2R), ky: R_EARTH * D2R };
}
function toXY(pl: Plane, p: LngLat): [number, number] {
  return [(p[0] - pl.lng0) * pl.kx, (p[1] - pl.lat0) * pl.ky];
}
function toLL(pl: Plane, x: number, y: number): LngLat {
  return [pl.lng0 + x / pl.kx, pl.lat0 + y / pl.ky];
}

/** Nearest point of the path to `q`: its chainage and the distance (m). */
export function projectS(p: MvPath, q: LngLat): { s: number; d: number } {
  if (p.pts.length < 2) return { s: 0, d: p.pts.length ? havM(p.pts[0], q) : Infinity };
  const pl = planeFor(q[1], q[0]);
  let best = { s: 0, d: Infinity };
  for (let i = 0; i < p.pts.length - 1; i++) {
    const a = toXY(pl, p.pts[i]), b = toXY(pl, p.pts[i + 1]);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy;
    const f = L2 > 0 ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / L2)) : 0;
    const x = a[0] + dx * f, y = a[1] + dy * f;
    const d = Math.hypot(x, y);
    if (d < best.d) best = { s: p.cum[i] + (p.cum[i + 1] - p.cum[i]) * f, d };
  }
  return best;
}

export function bboxOf(p: MvPath): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of p.pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

// ── where two routes meet ────────────────────────────────────────────────────────────────────────────────────────────

/** cross: routes cross; join / leave: start and end of road used in the same direction; follow: a check point along
 *  that road (a faster column catching up); meet: road used head-on. */
export type MvMeetKind = 'cross' | 'join' | 'leave' | 'follow' | 'meet';

export interface MvMeet {
  kind: MvMeetKind;
  sA: number;
  sB: number;
  at: LngLat;
  /** For join / leave / meet: the shared stretch on A (m). */
  fromA?: number;
  toA?: number;
}

interface SegGrid {
  cell: number;
  map: Map<string, number[]>;
  xy: [number, number][];
}

function gridOf(xy: [number, number][], cell: number): SegGrid {
  const map = new Map<string, number[]>();
  for (let i = 0; i < xy.length - 1; i++) {
    const [ax, ay] = xy[i], [bx, by] = xy[i + 1];
    const cx0 = Math.floor(Math.min(ax, bx) / cell), cx1 = Math.floor(Math.max(ax, bx) / cell);
    const cy0 = Math.floor(Math.min(ay, by) / cell), cy1 = Math.floor(Math.max(ay, by) / cell);
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cy = cy0; cy <= cy1; cy++) {
        const k = `${cx},${cy}`;
        const l = map.get(k);
        if (l) l.push(i);
        else map.set(k, [i]);
      }
  }
  return { cell, map, xy };
}

function nearSeg(g: SegGrid, x: number, y: number, cum: number[]): { d: number; s: number } {
  const cx = Math.floor(x / g.cell), cy = Math.floor(y / g.cell);
  let best = { d: Infinity, s: 0 };
  const seen = new Set<number>();
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++) {
      const l = g.map.get(`${cx + i},${cy + j}`);
      if (!l) continue;
      for (const k of l) {
        if (seen.has(k)) continue;
        seen.add(k);
        const [ax, ay] = g.xy[k], [bx, by] = g.xy[k + 1];
        const dx = bx - ax, dy = by - ay;
        const L2 = dx * dx + dy * dy;
        const f = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0;
        const d = Math.hypot(ax + dx * f - x, ay + dy * f - y);
        if (d < best.d) best = { d, s: cum[k] + (cum[k + 1] - cum[k]) * f };
      }
    }
  return best;
}

/**
 * Where routes A and B meet, ordered along A. A crossing at a junction gives one `cross`; road both use in the same
 * direction gives a `join` where B comes onto it and a `leave` where they part; road used head-on gives a `meet` at
 * the start of the stretch on A. `tolM` is how close counts as the same road.
 */
export function meetPoints(a: MvPath, b: MvPath, tolM = 40, stepM = 60): MvMeet[] {
  if (a.pts.length < 2 || b.pts.length < 2) return [];
  const ba = bboxOf(a), bb = bboxOf(b);
  const padLat = (tolM * 2) / (R_EARTH * D2R);
  const padLng = padLat / Math.max(0.2, Math.cos(((ba[1] + ba[3]) / 2) * D2R));
  if (ba[0] - padLng > bb[2] || bb[0] - padLng > ba[2] || ba[1] - padLat > bb[3] || bb[1] - padLat > ba[3]) return [];
  const pl = planeFor((Math.max(ba[1], bb[1]) + Math.min(ba[3], bb[3])) / 2, (Math.max(ba[0], bb[0]) + Math.min(ba[2], bb[2])) / 2);
  const xa = a.pts.map((p) => toXY(pl, p));
  const xb = b.pts.map((p) => toXY(pl, p));
  const cell = Math.max(250, tolM * 6);
  const gb = gridOf(xb, cell);

  // 1. Shared stretches: walk A in steps and mark where B is within the tolerance.
  interface Sample {
    s: number;
    near: boolean;
    sB: number;
  }
  const samples: Sample[] = [];
  for (let i = 0; i < xa.length - 1; i++) {
    const seg = a.cum[i + 1] - a.cum[i];
    const n = Math.max(1, Math.ceil(seg / stepM));
    for (let k = 0; k < n; k++) {
      const f = k / n;
      const x = xa[i][0] + (xa[i + 1][0] - xa[i][0]) * f, y = xa[i][1] + (xa[i + 1][1] - xa[i][1]) * f;
      const nb = nearSeg(gb, x, y, b.cum);
      samples.push({ s: a.cum[i] + seg * f, near: nb.d <= tolM, sB: nb.s });
    }
  }
  {
    const x = xa[xa.length - 1], nb = nearSeg(gb, x[0], x[1], b.cum);
    samples.push({ s: a.length, near: nb.d <= tolM, sB: nb.s });
  }
  const out: MvMeet[] = [];
  const runs: { i0: number; i1: number }[] = [];
  for (let i = 0; i < samples.length; i++) {
    if (!samples[i].near) continue;
    let j = i;
    while (j + 1 < samples.length && samples[j + 1].near) j++;
    runs.push({ i0: i, i1: j });
    i = j;
  }
  const shared: [number, number][] = [];
  for (const r of runs) {
    const s0 = samples[r.i0], s1 = samples[r.i1];
    const lenA = s1.s - s0.s;
    if (lenA < stepM * 2.5) continue; // a touch: the crossing test below finds it
    const dirB = s1.sB - s0.sB;
    shared.push([s0.s - tolM, s1.s + tolM]);
    const at0 = pointAtS(a, s0.s), at1 = pointAtS(a, s1.s);
    if (dirB >= 0) {
      out.push({ kind: 'join', sA: s0.s, sB: s0.sB, at: at0, fromA: s0.s, toA: s1.s });
      out.push({ kind: 'leave', sA: s1.s, sB: s1.sB, at: at1, fromA: s0.s, toA: s1.s });
    } else {
      out.push({ kind: 'meet', sA: s0.s, sB: s0.sB, at: at0, fromA: s0.s, toA: s1.s });
    }
  }

  // 2. Crossings: segment against segment, outside the shared stretches.
  const ga = gridOf(xa, cell);
  const seenX: [number, number][] = [];
  for (const [key, la] of ga.map) {
    const lb = gb.map.get(key);
    if (!lb) continue;
    for (const i of la)
      for (const j of lb) {
        const [p1x, p1y] = xa[i], [p2x, p2y] = xa[i + 1], [q1x, q1y] = xb[j], [q2x, q2y] = xb[j + 1];
        const rx = p2x - p1x, ry = p2y - p1y, sx = q2x - q1x, sy = q2y - q1y;
        const den = rx * sy - ry * sx;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((q1x - p1x) * sy - (q1y - p1y) * sx) / den;
        const u = ((q1x - p1x) * ry - (q1y - p1y) * rx) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const sA = a.cum[i] + (a.cum[i + 1] - a.cum[i]) * t;
        const sB = b.cum[j] + (b.cum[j + 1] - b.cum[j]) * u;
        if (shared.some(([x0, x1]) => sA >= x0 && sA <= x1)) continue;
        if (seenX.some(([x, y]) => Math.abs(x - sA) < tolM && Math.abs(y - sB) < tolM)) continue;
        seenX.push([sA, sB]);
        out.push({ kind: 'cross', sA, sB, at: toLL(pl, p1x + rx * t, p1y + ry * t) });
      }
  }
  // 3. Routes that only touch end to end or start at the same place: a touch within the tolerance at an end.
  for (const r of runs) {
    const s0 = samples[r.i0], s1 = samples[r.i1];
    if (s1.s - s0.s >= stepM * 2.5) continue;
    const mid = samples[(r.i0 + r.i1) >> 1];
    if (seenX.some(([x]) => Math.abs(x - mid.s) < tolM * 3)) continue;
    seenX.push([mid.s, mid.sB]);
    out.push({ kind: 'cross', sA: mid.s, sB: mid.sB, at: pointAtS(a, mid.s) });
  }
  return out.sort((p, q) => p.sA - q.sA);
}
