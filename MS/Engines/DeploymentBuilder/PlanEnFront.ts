/**
 * PlanEnFront.ts
 *
 * The enemy marked as more than a point (user, 27 Nov 2026): a **front line** or an **area** with its ins and outs
 * (salients, re-entrants, knolls), beside or instead of the point threat. Pure: no ArcGIS, no DOM (runs in Node:
 * `node tools/planbuilder-test/enfront.mjs`).
 *
 *   - World points are Web Mercator; plan points are plan metres in the fit's frame (+y toward the enemy).
 *   - **Facing** (`faceBearing`): the plan turns square to the part of his front nearest it, the directions to his front
 *     weighted by 1 / d² over a window as wide as the plan, so a curve or a salient opposite the plan turns it.
 *   - **Shaped to the front** (`shapeToFront`): each forward posn moves whole, straight forward or back, so its front edge
 *     stands as far from his front as the plan's axis does where the user put it; the posns behind it go with it. Size
 *     and shape stay as the annex draws them (user, 27 Nov 2026: posns are never turned or stretched); a move is made
 *     only when the layout holds (the caller's guard, PlanFit's layout test), else it is halved once, else held and why.
 *   - **Reading** (`readFront`): his frontage across ours, his depth (an area), whether he comes level with our FDL on a
 *     flank, his salients toward us (MW p 126 para 3 b) and our plan in a salient of his line (MW p 126 para 3 c).
 */

import type { Check, CheckState, XY } from './PlanSolve';

export type EnFrontKind = 'line' | 'area';
export interface EnFront {
  kind: EnFrontKind;
  /** Web Mercator; an area's ring is closed implicitly (the last point need not repeat the first). */
  pts: XY[];
}

/** A posn's box in plan metres (PlanFit's Box). */
export interface FrontBox { role: string; label: string; kind: string; c: XY; w: number; h: number; turn: number; /** Turned on top of `turn` to face the En front (deg clockwise). */ face?: number }

/** The plan's frame (PlanFit's FitFrame). */
export interface FrontFrame { anchor: XY; bearing: number; k: number; pivot: XY }

const R = 6378137;
/** Web Mercator units per ground metre at a Mercator y. */
export const kAt = (y: number): number => 1 / Math.cos(2 * Math.atan(Math.exp(y / R)) - Math.PI / 2);
const P = (x: number, y: number): XY => ({ x, y });
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);

export function frontValid(f: EnFront | null | undefined): f is EnFront {
  return !!f && Array.isArray(f.pts) && f.pts.length >= (f.kind === 'area' ? 3 : 2) && f.pts.every((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y));
}

/** Segments of the front (an area's ring closed). */
function segs(pts: XY[], closed: boolean): [XY, XY][] {
  const out: [XY, XY][] = [];
  for (let i = 0; i + 1 < pts.length; i++) out.push([pts[i], pts[i + 1]]);
  if (closed && pts.length > 2) out.push([pts[pts.length - 1], pts[0]]);
  return out;
}

/** Point in a ring (even-odd). */
export function inRing(pts: XY[], p: XY): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function nearestOnSeg(a: XY, b: XY, p: XY): XY {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
  return P(a.x + t * dx, a.y + t * dy);
}

/** The nearest point of his front (world) and how far it is in metres; inside an area: distance 0, `inside`. */
export function nearestOnFront(f: EnFront, p: XY): { at: XY; dM: number; inside: boolean } {
  let best: XY = f.pts[0], bd = Infinity;
  for (const [a, b] of segs(f.pts, f.kind === 'area')) {
    const q = nearestOnSeg(a, b, p);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bd) { bd = d; best = q; }
  }
  const inside = f.kind === 'area' && inRing(f.pts, p);
  return { at: best, dM: inside ? 0 : bd / kAt(p.y), inside };
}

/** Points along the front every `stepM` (world), its vertices kept. */
export function sampleFront(f: EnFront, stepM: number): XY[] {
  const out: XY[] = [];
  for (const [a, b] of segs(f.pts, f.kind === 'area')) {
    const k = kAt((a.y + b.y) / 2);
    const lenM = Math.hypot(b.x - a.x, b.y - a.y) / k;
    const n = Math.max(1, Math.ceil(lenM / Math.max(1, stepM)));
    for (let i = 0; i < n; i++) out.push(P(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n));
  }
  if (f.kind === 'line') out.push({ ...f.pts[f.pts.length - 1] });
  return out;
}

/** Length of the front in metres (an area: its perimeter). */
export function frontLengthM(f: EnFront): number {
  return segs(f.pts, f.kind === 'area').reduce((s, [a, b]) => s + Math.hypot(b.x - a.x, b.y - a.y) / kAt((a.y + b.y) / 2), 0);
}

/** A point standing for the front: a line's middle along its length, an area's vertex centroid. */
export function frontPoint(f: EnFront): XY {
  if (f.kind === 'area') return P(f.pts.reduce((s, p) => s + p.x, 0) / f.pts.length, f.pts.reduce((s, p) => s + p.y, 0) / f.pts.length);
  const L = frontLengthM(f);
  let run = 0;
  for (const [a, b] of segs(f.pts, false)) {
    const l = Math.hypot(b.x - a.x, b.y - a.y) / kAt((a.y + b.y) / 2);
    if (run + l >= L / 2 && l > 0) { const t = (L / 2 - run) / l; return P(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t); }
    run += l;
  }
  return { ...f.pts[0] };
}

/**
 * The bearing (radians clockwise from north) the plan at `anchor` faces his front: the unit directions to points of his
 * front within `windowM` of the nearest one, weighted 1 / d² (a curve or a salient opposite the plan turns it toward
 * them). Null: inside his area, or nothing to face.
 */
export function faceBearing(f: EnFront, anchor: XY, windowM: number): number | null {
  if (!frontValid(f)) return null;
  if (f.kind === 'area' && inRing(f.pts, anchor)) return null;
  const k = kAt(anchor.y);
  const pts = sampleFront(f, Math.max(25, windowM / 40));
  const d = pts.map((p) => Math.hypot(p.x - anchor.x, p.y - anchor.y) / k);
  const dmin = Math.min(...d);
  let sx = 0, sy = 0;
  for (let i = 0; i < pts.length; i++) {
    if (d[i] > dmin + windowM) continue;
    const w = 1 / Math.max(50, d[i]) ** 2;
    sx += ((pts[i].x - anchor.x) / k / Math.max(1e-6, d[i])) * w;
    sy += ((pts[i].y - anchor.y) / k / Math.max(1e-6, d[i])) * w;
  }
  if (!sx && !sy) return null;
  return Math.atan2(sx, sy);
}

/** A point 5 km out along faceBearing (what the Deployment Mgr turns a plan toward), or null. */
export function facePoint(f: EnFront, anchor: XY, windowM: number): XY | null {
  const b = faceBearing(f, anchor, windowM);
  if (b === null) return null;
  const r = 5000 * kAt(anchor.y);
  return P(anchor.x + r * Math.sin(b), anchor.y + r * Math.cos(b));
}

/** Douglas-Peucker in metres, then thinned to at most `maxPts` (kept on graphics as pbMeta). */
export function simplifyFront(f: EnFront, tolM = 15, maxPts = 200): EnFront {
  const k = kAt(f.pts.reduce((s, p) => s + p.y, 0) / f.pts.length);
  const tol = tolM * k;
  const dp = (pts: XY[]): XY[] => {
    if (pts.length < 3) return pts.slice();
    const a = pts[0], b = pts[pts.length - 1];
    let idx = -1, dm = -1;
    for (let i = 1; i < pts.length - 1; i++) {
      const q = nearestOnSeg(a, b, pts[i]);
      const d = Math.hypot(q.x - pts[i].x, q.y - pts[i].y);
      if (d > dm) { dm = d; idx = i; }
    }
    if (dm <= tol) return [a, b];
    const l = dp(pts.slice(0, idx + 1)), r = dp(pts.slice(idx));
    return [...l.slice(0, -1), ...r];
  };
  let pts = f.kind === 'area' ? dp([...f.pts, f.pts[0]]).slice(0, -1) : dp(f.pts);
  if (f.kind === 'area' && pts.length < 3) pts = f.pts.slice(0, 3);
  while (pts.length > maxPts) pts = pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1);
  return { kind: f.kind, pts: pts.map((p) => P(p.x, p.y)) };
}

// ── the front in the plan's frame ─────────────────────────────────────────────────────────────────────────────────
function toLocal(fr: FrontFrame, w: XY): XY {
  const dx = (w.x - fr.anchor.x) / fr.k, dy = (w.y - fr.anchor.y) / fr.k;
  const c = Math.cos(fr.bearing), s = Math.sin(fr.bearing);
  return P(fr.pivot.x + dx * c - dy * s, fr.pivot.y + dx * s + dy * c);
}

export interface LocalFront { pts: XY[]; closed: boolean }
export function frontLocal(f: EnFront, fr: FrontFrame): LocalFront {
  return { pts: f.pts.map((p) => toLocal(fr, p)), closed: f.kind === 'area' };
}

/**
 * Straight ahead (+y) from (x, y0) to his front, metres; inside an area the distance back (-y) to its edge, negative.
 * Null: the ray passes beside his front (beyond its end).
 */
export function rayAhead(lf: LocalFront, x: number, y0: number): number | null {
  const cross: number[] = [];
  for (const [a, b] of segs(lf.pts, lf.closed)) {
    if ((a.x > x) === (b.x > x) || a.x === b.x) continue;
    const t = (x - a.x) / (b.x - a.x);
    cross.push(a.y + t * (b.y - a.y) - y0);
  }
  if (!cross.length) return null;
  const inside = lf.closed && inRing(lf.pts, P(x, y0));
  if (inside) { const back = cross.filter((d) => d <= 0); return back.length ? Math.max(...back) : 0; }
  const ahead = cross.filter((d) => d >= 0);
  return ahead.length ? Math.min(...ahead) : null;
}

const isFwd = (b: FrontBox) => b.kind === 'fwd' && b.turn % 180 === 0;
const isBack = (b: FrontBox) => b.kind === 'depth' || b.kind === 'res';
const front = (b: FrontBox) => b.c.y + (b.turn % 180 === 90 ? b.w : b.h) / 2;
const halfW = (b: FrontBox) => (b.turn % 180 === 90 ? b.h : b.w) / 2;
const rad = (d: number) => (d * Math.PI) / 180;

/** A point (u across, v toward the front, metres) of a box, turned by its recipe turn and its face turn. */
export function boxPtF(b: FrontBox, u: number, v: number): XY {
  const t = rad(b.turn + (b.face ?? 0));
  return P(b.c.x + u * Math.cos(t) + v * Math.sin(t), b.c.y - u * Math.sin(t) + v * Math.cos(t));
}

/**
 * Beyond the En front: inside an area, or past a line (the line crosses the way straight back toward the own side, -y,
 * an odd number of times).
 */
export function beyondFront(lf: LocalFront, p: XY): boolean {
  if (lf.closed) return inRing(lf.pts, p);
  let n = 0;
  for (const [a, b] of segs(lf.pts, false)) {
    if ((a.x > p.x) === (b.x > p.x) || a.x === b.x) continue;
    if (a.y + ((p.x - a.x) / (b.x - a.x)) * (b.y - a.y) < p.y) n++;
  }
  return n % 2 === 1;
}

/** Shortest distance from a point to the En front, metres; negative beyond it (inside his area, past his line). */
export function standDist(lf: LocalFront, p: XY): number {
  let best = Infinity;
  for (const [a, b] of segs(lf.pts, lf.closed)) {
    const q = nearestOnSeg(a, b, p);
    best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y));
  }
  return beyondFront(lf, p) ? -best : best;
}

/** The Battle Posn's front side as the annex draws it (BP_SHAPE: 0.42 at the corners, 0.5 in the middle). */
const FRONT_U = [0.46, 0.31, 0.15, 0, -0.15, -0.31, -0.46];
const frontV = (u: number) => 0.5 - 0.08 * (u / 0.46) ** 2;

/** A posn's front edge in plan metres: its own bent edge when given, else the annex's front side. */
function edgeOf(b: FrontBox, edge?: XY[] | null): XY[] {
  if (edge?.length) return edge;
  const w = 2 * halfW(b), h = front(b) * 2 - b.c.y * 2;
  return FRONT_U.map((u) => boxPtF(b, u * w, frontV(u) * h));
}

/** The nearest the En front comes to a posn's front edge (m; negative: across it), and whether it lies in his area. */
function standOf(lf: LocalFront, b: FrontBox, edge?: XY[] | null): { dM: number; inside: boolean } {
  const ds = edgeOf(b, edge).map((p) => standDist(lf, p));
  const dM = Math.min(...ds);
  return { dM, inside: dM < 0 || beyondFront(lf, b.c) };
}

/**
 * The turn (degrees clockwise, within ±maxDeg) that sets a posn square to its own part of the En front: the directions
 * from the middle of its front edge to the En front within its frontage of the nearest point, weighted 1 / d².
 */
function faceAngle(lf: LocalFront, b: FrontBox, maxDeg: number): number {
  const w = 2 * halfW(b);
  const p = boxPtF({ ...b, face: 0 }, 0, front(b) - b.c.y);
  if (beyondFront(lf, p)) return 0;
  const pts: XY[] = [];
  for (const [a, z] of segs(lf.pts, lf.closed)) {
    const n = Math.max(1, Math.ceil(Math.hypot(z.x - a.x, z.y - a.y) / 40));
    for (let i = 0; i <= n; i++) pts.push(P(a.x + ((z.x - a.x) * i) / n, a.y + ((z.y - a.y) * i) / n));
  }
  const d = pts.map((q) => Math.hypot(q.x - p.x, q.y - p.y));
  const dmin = Math.min(...d);
  let sx = 0, sy = 0;
  for (let i = 0; i < pts.length; i++) {
    if (d[i] > dmin + Math.max(600, w)) continue;
    const wt = 1 / Math.max(50, d[i]) ** 2;
    sx += ((pts[i].x - p.x) / Math.max(1e-6, d[i])) * wt;
    sy += ((pts[i].y - p.y) / Math.max(1e-6, d[i])) * wt;
  }
  if (!sx && !sy) return 0;
  // the front points +y at turn 0; a turn clockwise brings it toward +x
  const deg = (Math.atan2(sx, sy) * 180) / Math.PI - b.turn;
  return Math.max(-maxDeg, Math.min(maxDeg, deg));
}

/** Two turned boxes closer than `pad` (separating axes on their corners). */
function overlapTurned(a: FrontBox, b: FrontBox, pad: number): boolean {
  const corners = (x: FrontBox) => { const hw = x.w / 2 + pad / 2, hh = x.h / 2 + pad / 2; return [boxPtF(x, -hw, -hh), boxPtF(x, hw, -hh), boxPtF(x, hw, hh), boxPtF(x, -hw, hh)]; };
  const ca = corners(a), cb = corners(b);
  for (const poly of [ca, cb]) {
    for (let i = 0; i < 4; i++) {
      const p = poly[i], q = poly[(i + 1) % 4];
      const nx = -(q.y - p.y), ny = q.x - p.x;
      const proj = (c: XY[]) => c.map((v) => v.x * nx + v.y * ny);
      const pa = proj(ca), pb = proj(cb);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
  }
  return true;
}

export interface FrontShape {
  /** Plan-metre moves by role (fed to the solver with the fit's other nudges). */
  nudges: Record<string, XY>;
  /** The stand-off the plan is laid at: the middle of the forward posns' stand-offs where the user placed it, metres. */
  refM: number | null;
  moved: { role: string; label: string; byM: number }[];
  held: { role: string; label: string; wantM: number; why: string }[];
  /** Posns turned to face their own part of the En front (degrees clockwise), by role. */
  turned: { role: string; label: string; deg: number; why?: string }[];
}

export interface ShapeOpts {
  /** Most a posn moves to keep the stand-off (PlanDoctrine fit.enFront.moveM). */
  maxMoveM: number;
  /** Smaller differences are left alone (PlanDoctrine fit.enFront.minMoveM). */
  minMoveM: number;
  /** Most a posn turns to face its part of the En front (PlanDoctrine fit.enFront.turnMaxDeg). */
  turnMaxDeg: number;
  /** Most a front edge or a Pl post bends forward or back to follow the En front (PlanDoctrine fit.enFront.edgeBendM). */
  edgeBendM: number;
}

/**
 * The plan laid against the En front (user, 27 Nov 2026: "do 1 to 4 and turn the posns too"): the stand-off is the
 * middle of the forward posns' stand-offs where the user placed it; each forward posn turns to face its own part of the
 * En front (within ±turnMaxDeg, never onto another posn) and moves whole straight forward or back so its front edge
 * stands that far from it; the posns behind it move and turn with it, central depth posns by the forward posns' mean.
 * `guard(b, cand)` is PlanFit's layout test: a move it refuses is halved once, else held. Mutates `boxes` (centres and
 * `face`) as PlanFit's other moves do; frontEdges then bends each front edge onto the En front's curve.
 */
export function shapeToFront(boxes: FrontBox[], lf: LocalFront, o: ShapeOpts, guard: (b: FrontBox, cand: FrontBox) => string | null): FrontShape {
  const out: FrontShape = { nudges: {}, refM: null, moved: [], held: [], turned: [] };
  const fwd = boxes.filter(isFwd);
  if (!fwd.length || boxes.some((b) => b.kind === 'round')) return out;
  const known = fwd.map((b) => standOf(lf, b).dM).sort((a, z) => a - z);
  const mid = known.length / 2;
  const ref = known.length % 2 ? known[Math.floor(mid)] : (known[mid - 1] + known[mid]) / 2;
  // across his line already: nothing sensible to keep; the rows say so
  if (!(ref > 0)) return out;
  out.refM = ref;
  const orig = new Map(boxes.map((b) => [b.role, { ...b.c }]));
  const backs = boxes.filter(isBack);
  const owner = new Map<FrontBox, FrontBox>();
  for (const d of backs) {
    const f = fwd.filter((x) => Math.abs(d.c.x - x.c.x) <= halfW(x)).sort((a, z) => Math.abs(d.c.x - a.c.x) - Math.abs(d.c.x - z.c.x))[0];
    if (f) owner.set(d, f);
  }
  const clear = (b: FrontBox, face: number) => !boxes.some((x) => x !== b && overlapTurned({ ...b, face }, x, 50));
  /** Move a group by s along y, back boxes first when going back; all or nothing. */
  const moveGroup = (group: FrontBox[], s: number): string | null => {
    const order = s < 0 ? [...group].reverse() : group;
    const done: [FrontBox, XY][] = [];
    for (const b of order) {
      const cand: FrontBox = { ...b, c: P(b.c.x, b.c.y + s) };
      const why = guard(b, cand) ?? (boxes.some((x) => x !== b && !group.includes(x) && overlapTurned(cand, x, 50)) ? 'it would run into the next posn' : null);
      if (why) { for (const [x, c] of done.reverse()) x.c = c; return why; }
      done.push([b, { ...b.c }]);
      b.c = cand.c;
    }
    return null;
  };
  const shifts: number[] = [];
  for (const b of fwd) {
    const group = [b, ...backs.filter((x) => owner.get(x) === b)];
    // 1. face its own part of the En front, the posns behind it with it (half the turn, else none, when it would touch a neighbour)
    const want = faceAngle(lf, b, o.turnMaxDeg);
    let face = 0;
    if (Math.abs(want) >= 2) {
      for (const f of [want, want / 2]) if (group.every((x) => clear(x, f))) { face = f; break; }
      if (face) out.turned.push({ role: b.role, label: b.label, deg: Math.round(face), why: Math.abs(face) < Math.abs(want) - 0.5 ? `half the ${Math.round(Math.abs(want))}° it needs: a full turn would touch the next posn` : undefined });
      else out.turned.push({ role: b.role, label: b.label, deg: 0, why: `not turned the ${Math.round(Math.abs(want))}° it needs: it would touch the next posn` });
    }
    for (const x of group) x.face = face;
    // 2. straight forward or back to the stand-off (worked out again on the turned edge)
    let s = 0;
    for (let k = 0; k < 4; k++) s += standOf(lf, { ...b, c: P(b.c.x, b.c.y + s) }).dM - ref;
    if (Math.abs(s) < o.minMoveM) { shifts.push(0); continue; }
    const sc = Math.max(-o.maxMoveM, Math.min(o.maxMoveM, s));
    let why = moveGroup(group, sc);
    let got = why ? 0 : sc;
    if (why && Math.abs(sc / 2) >= o.minMoveM) { const w2 = moveGroup(group, sc / 2); if (!w2) { got = sc / 2; why = null; } }
    if (got) { shifts.push(got); out.moved.push({ role: b.role, label: b.label, byM: Math.round(got) }); }
    if (why || Math.abs(got) < Math.abs(s) - 1) out.held.push({ role: b.role, label: b.label, wantM: Math.round(s), why: why ?? `moved ${fmtM(Math.abs(got))} of ${fmtM(Math.abs(s))}: the most a posn moves to keep the stand-off` });
  }
  // depth posns behind no forward posn (a central reserve) follow the forward posns' mean
  const mean = shifts.length ? shifts.reduce((a, z) => a + z, 0) / shifts.length : 0;
  const central = backs.filter((x) => !owner.has(x));
  if (central.length && Math.abs(mean) >= o.minMoveM) {
    for (const b of central) {
      const why = moveGroup([b], mean);
      if (!why) out.moved.push({ role: b.role, label: b.label, byM: Math.round(mean) });
    }
  }
  for (const b of boxes) {
    const o0 = orig.get(b.role)!;
    if (b.c.x !== o0.x || b.c.y !== o0.y) out.nudges[b.role] = P(b.c.x - o0.x, b.c.y - o0.y);
  }
  return out;
}

export interface FrontEdges {
  /** Each forward posn's outline (box fractions, BP_SHAPE's rear and sides, its front side on the En front's curve). */
  outlines: Record<string, [number, number][]>;
  /** The same front edges in plan metres (the rows read the stand-off off them). */
  edges: Record<string, XY[]>;
  /** A forward Coy's Pl posts moved along its facing (metres, plSpots order). */
  plShift: Record<string, number[]>;
  /** How far each front edge bends (the most of its points), and where the bend reached its limit. */
  bent: { role: string; label: string; maxM: number; short: boolean }[];
}

/**
 * Each forward posn's front edge laid on the En front's curve `refM` from it (seven points across, each moved along the
 * posn's facing, within ±edgeBendM and never behind the posn's middle), its rear side and echelon mark kept as `base`
 * (the ground's outline, else the annex's); a forward Coy's forward Pl posts moved the same way so each keeps its inset
 * behind the Coy's front edge (`pls`: plSpots by role).
 */
export function frontEdges(boxes: FrontBox[], lf: LocalFront, refM: number, o: ShapeOpts, base: Record<string, [number, number][]> = {}, pls: Record<string, [number, number, string, number, number][]> = {}): FrontEdges {
  const out: FrontEdges = { outlines: {}, edges: {}, plShift: {}, bent: [] };
  const toRef = (b: FrontBox, u: number, v: number, extra = 0, lim: [number, number] = [-o.edgeBendM, o.edgeBendM]) => {
    let t = 0;
    for (let k = 0; k < 5; k++) t = Math.max(lim[0], Math.min(lim[1], t + standDist(lf, boxPtF(b, u, v + t)) - (refM + extra)));
    return t;
  };
  for (const b of boxes.filter(isFwd)) {
    const w = 2 * halfW(b), h = 2 * (front(b) - b.c.y);
    const bs = base[b.role]?.length === 7 ? base[b.role] : null;
    const rear: [number, number][] = bs ? [bs[0], bs[1]] : [[0.2, -0.5], [0.5, -0.3]];
    const rearL: [number, number][] = bs ? [bs[5], bs[6]] : [[-0.5, -0.3], [-0.2, -0.5]];
    let maxT = 0, short = false;
    const fr: [number, number][] = FRONT_U.map((u) => {
      const v0 = frontV(u) * h;
      const t = toRef(b, u * w, v0, 0, [Math.max(-o.edgeBendM, -v0), o.edgeBendM]);
      maxT = Math.max(maxT, Math.abs(t));
      if (Math.abs(standDist(lf, boxPtF(b, u * w, v0 + t)) - refM) > 25) short = true;
      return [u, (v0 + t) / h];
    });
    out.outlines[b.role] = [...rear, ...fr, ...rearL];
    out.edges[b.role] = fr.map(([u, v]) => boxPtF(b, u * w, v * h));
    if (maxT >= o.minMoveM) out.bent.push({ role: b.role, label: b.label, maxM: Math.round(maxT), short });
    const spots = pls[b.role];
    if (spots?.length) {
      out.plShift[b.role] = spots.map(([u, v, , , fh]) => {
        const fv = v + fh / 2;
        if (fv <= 0) return 0;   // the Pl in depth moves with its Coy only
        return Math.round(toRef(b, u * w, fv * h, (0.5 - fv) * h));
      });
    }
  }
  return out;
}

/**
 * The FDL laid `refM` from the En front across the forward posns' frontage, every bend, knoll, salient and re-entrant
 * of it (plan metres, every ~25-60 m, thinned to 8 m); where the En front is not ahead (beyond its end) the line keeps
 * the forward posns' front.
 */
export function fdlCurve(lf: LocalFront, boxes: FrontBox[], refM: number): XY[] {
  const fwd = boxes.filter(isFwd);
  if (!fwd.length) return [];
  const x0 = Math.min(...fwd.map((b) => b.c.x - halfW(b))), x1 = Math.max(...fwd.map((b) => b.c.x + halfW(b)));
  const frontY = Math.max(...fwd.map(front));
  const step = Math.max(25, (x1 - x0) / 80);
  const pts: XY[] = [];
  for (let x = x0; x <= x1 + 0.5; x += step) {
    if (rayAhead(lf, x, frontY - 3 * refM) === null) { pts.push(P(x, frontY)); continue; }
    let y = frontY;
    for (let k = 0; k < 8; k++) y += standDist(lf, P(x, y)) - refM;
    pts.push(P(x, y));
  }
  // thinned (Douglas-Peucker, 8 m) so the FEBA carries tens of points, not hundreds
  const dp = (a: XY[]): XY[] => {
    if (a.length < 3) return a.slice();
    let idx = -1, dm = -1;
    for (let i = 1; i < a.length - 1; i++) { const q = nearestOnSeg(a[0], a[a.length - 1], a[i]); const d = Math.hypot(q.x - a[i].x, q.y - a[i].y); if (d > dm) { dm = d; idx = i; } }
    if (dm <= 8) return [a[0], a[a.length - 1]];
    return [...dp(a.slice(0, idx + 1)).slice(0, -1), ...dp(a.slice(idx))];
  };
  return dp(pts);
}

export interface FrontReading {
  /** His front across ours (m) within a window of the plan's frontage either side, and whether it covers ours. */
  acrossM: number;
  coversLt: boolean;
  coversRt: boolean;
  /** An area's depth opposite the plan (m); null for a line. */
  depthM: number | null;
  /** He comes level with or behind the FDL beside a flank, and how far out from that flank (m). */
  flankLt: number | null;
  flankRt: number | null;
  /** His salients toward us (bulges) and re-entrants, opposite which posn. */
  salients: { x: number; outM: number; opposite: string | null }[];
  reentrants: { x: number; backM: number; opposite: string | null }[];
  /** Each forward posn's stand-off now (m; null: his front is not ahead of it), inside his area. */
  stand: { role: string; label: string; dM: number | null; inside: boolean }[];
  /** Any posn (forward or not) inside his area or across his line. */
  inside: string[];
}

/**
 * His front as it lies against the plan: across, depth, flanks, salients and re-entrants, stand-offs. `bulgeM` is the
 * smallest bulge read as a salient (PlanDoctrine fit.enFront.salientM).
 */
export function readFront(lf: LocalFront, boxes: FrontBox[], bulgeM: number, edges: Record<string, XY[]> = {}): FrontReading {
  const posns = boxes.filter((b) => ['fwd', 'depth', 'res', 'round', 'cpen'].includes(b.kind));
  const fwd = posns.filter((b) => b.kind === 'fwd' || b.kind === 'round');
  const use = fwd.length ? fwd : posns;
  const x0 = use.length ? Math.min(...use.map((b) => b.c.x - halfW(b))) : -500;
  const x1 = use.length ? Math.max(...use.map((b) => b.c.x + halfW(b))) : 500;
  const W = Math.max(200, x1 - x0);
  const frontY = use.length ? Math.max(...use.map(front)) : 0;
  const rearY = posns.length ? Math.min(...posns.map((b) => b.c.y - (b.turn % 180 === 90 ? b.w : b.h) / 2)) : frontY - 500;
  // densified in plan metres
  const pts: XY[] = [];
  const step = Math.max(20, W / 60);
  for (const [a, b] of segs(lf.pts, lf.closed)) {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let i = 0; i < n; i++) pts.push(P(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n));
  }
  if (!lf.closed && lf.pts.length) pts.push({ ...lf.pts[lf.pts.length - 1] });
  const wx0 = x0 - W, wx1 = x1 + W;
  const facing = pts.filter((p) => p.x >= wx0 && p.x <= wx1 && p.y >= rearY);
  const across = facing.length ? Math.min(wx1, Math.max(...facing.map((p) => p.x))) - Math.max(wx0, Math.min(...facing.map((p) => p.x))) : 0;
  const coversLt = facing.some((p) => p.x <= x0), coversRt = facing.some((p) => p.x >= x1);
  // his depth straight ahead of the plan (an area)
  let depthM: number | null = null;
  if (lf.closed) {
    const opp = pts.filter((p) => p.x >= x0 && p.x <= x1);
    if (opp.length) depthM = Math.max(...opp.map((p) => p.y)) - Math.min(...opp.map((p) => p.y));
  }
  // level with or behind the FDL beside a flank (within one frontage out)
  // level with the flank posn's own front edge (posns that follow the En front stand at different depths)
  const flankFront = (side: -1 | 1) => { const b = [...use].sort((a, z) => (side < 0 ? a.c.x - z.c.x : z.c.x - a.c.x))[0]; return b ? front(b) : frontY; };
  const flank = (side: -1 | 1): number | null => {
    const fy = flankFront(side);
    const near = pts.filter((p) => (side < 0 ? p.x < x0 && p.x >= x0 - W : p.x > x1 && p.x <= x1 + W) && p.y <= fy);
    if (!near.length) return null;
    return Math.round(Math.min(...near.map((p) => (side < 0 ? x0 - p.x : p.x - x1))));
  };
  // the nearest edge in bins across the window: bulges above the line through its ends are salients toward us
  const bins = 24;
  const prof: { x: number; y: number }[] = [];
  for (let i = 0; i < bins; i++) {
    const a = wx0 + ((wx1 - wx0) * i) / bins, z = wx0 + ((wx1 - wx0) * (i + 1)) / bins;
    const inBin = facing.filter((p) => p.x >= a && p.x < z);
    if (inBin.length) prof.push({ x: (a + z) / 2, y: Math.min(...inBin.map((p) => p.y)) });
  }
  const salients: FrontReading['salients'] = [], reentrants: FrontReading['reentrants'] = [];
  if (prof.length >= 5) {
    const ys = prof.map((p) => p.y).sort((a, z) => a - z);
    const base = ys[Math.floor(ys.length / 2)];
    const nearestPosn = (x: number) => (fwd.length ? [...fwd].sort((a, z) => Math.abs(a.c.x - x) - Math.abs(z.c.x - x))[0] : null);
    const opp = (x: number) => { const n = nearestPosn(x); return n && Math.abs(n.c.x - x) <= halfW(n) + W / 4 ? n.label : null; };
    // runs of bins beyond the bulge, each its extreme
    // a run that reaches either end of the window is a step in his line (it stays nearer, or further), not a bulge
    // with both sides falling back: only runs with his line back at the base on both sides count
    const runs = (test: (p: { x: number; y: number }) => boolean) => {
      const out: { x: number; y: number }[][] = [];
      let cur: { x: number; y: number }[] = [];
      prof.forEach((p, i) => {
        if (test(p)) cur.push(p);
        else { if (cur.length && prof.indexOf(cur[0]) > 0) out.push(cur); cur = []; }
        if (i === prof.length - 1) cur = [];
      });
      return out;
    };
    for (const r of runs((p) => base - p.y >= bulgeM)) {
      const tip = r.reduce((a, z) => (z.y < a.y ? z : a));
      // opposite the plan only: his front coming round beside a flank is the flank's reading, not a salient
      if (tip.x < x0 - W / 2 || tip.x > x1 + W / 2) continue;
      salients.push({ x: tip.x, outM: Math.round(base - tip.y), opposite: opp(tip.x) });
    }
    for (const r of runs((p) => p.y - base >= bulgeM)) {
      const deep = r.reduce((a, z) => (z.y > a.y ? z : a));
      if (deep.x < x0 - W / 2 || deep.x > x1 + W / 2) continue;
      reentrants.push({ x: deep.x, backM: Math.round(deep.y - base), opposite: opp(deep.x) });
    }
  }
  const stand = fwd.map((b) => { const s = standOf(lf, b, edges[b.role]); return { role: b.role, label: b.label, dM: Math.round(s.dM), inside: s.inside }; });
  const inside = posns.filter((b) => {
    if (lf.closed) {
      for (const u of [-0.4, 0, 0.4]) for (const v of [-0.4, 0, 0.4]) if (inRing(lf.pts, P(b.c.x + u * 2 * halfW(b), b.c.y + v * (front(b) - b.c.y) * 2))) return true;
      return false;
    }
    // a line through the posn's box
    const hw = halfW(b), hh = front(b) - b.c.y;
    return segs(lf.pts, false).some(([a, z]) => segCrossesBox(a, z, b.c, hw, hh));
  }).map((b) => b.label);
  return { acrossM: Math.round(Math.max(0, across)), coversLt, coversRt, depthM: depthM === null ? null : Math.round(depthM), flankLt: flank(-1), flankRt: flank(1), salients, reentrants, stand, inside };
}

function segCrossesBox(a: XY, b: XY, c: XY, hw: number, hh: number): boolean {
  const inB = (p: XY) => Math.abs(p.x - c.x) <= hw && Math.abs(p.y - c.y) <= hh;
  if (inB(a) || inB(b)) return true;
  const corners = [P(c.x - hw, c.y - hh), P(c.x + hw, c.y - hh), P(c.x + hw, c.y + hh), P(c.x - hw, c.y + hh)];
  const cross = (p: XY, q: XY, r: XY, s: XY) => {
    const d = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
    if (!d) return false;
    const t = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / d;
    const u = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / d;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  };
  for (let i = 0; i < 4; i++) if (cross(a, b, corners[i], corners[(i + 1) % 4])) return true;
  return false;
}

/**
 * The En front's rows: "En front" (what he is against the plan) and "Stand-off" (each forward posn from his front, what
 * moved to keep it). `shape` is the fit's move (null in Check my plan: read as drawn). `kind` names his mark.
 */
export function frontRows(rd: FrontReading, kind: EnFrontKind, shape: FrontShape | null, spreadWarnM: number, edges: FrontEdges | null = null): Check[] {
  const rows: Check[] = [];
  const what = kind === 'area' ? 'En area' : 'En front line';
  // En front: across, depth, flanks, salients
  const parts: string[] = [`${what} ${fmtM(rd.acrossM)} across the plan's front${rd.depthM !== null ? `, ${fmtM(rd.depthM)} deep opposite it` : ''}`];
  if (!rd.coversLt || !rd.coversRt) parts.push(`it ends short of the ${!rd.coversLt && !rd.coversRt ? 'Lt and Rt flanks' : !rd.coversLt ? 'Lt flank' : 'Rt flank'}: no En front opposite it`);
  let st: CheckState = 'pass';
  const wraps: string[] = [];
  if (rd.flankLt !== null) wraps.push(`Lt (${fmtM(rd.flankLt)} out)`);
  if (rd.flankRt !== null) wraps.push(`Rt (${fmtM(rd.flankRt)} out)`);
  if (wraps.length === 2) { st = 'warn'; parts.push(`it comes level with the FDL beside both flanks, ${wraps.join(' and ')}: the plan sits in a salient of the En front, where the defender cannot place enough strength at any one point (MW p 126 para 3 c); a reverse slope posn is one way to avoid a dangerous salient (IBB S69 p 357 para 1 d)`); }
  else if (wraps.length) { st = 'warn'; parts.push(`it comes level with the FDL beside the ${wraps[0]} flank: a threat from that flank too; mines, fire and a patrol on it`); }
  for (const s of rd.salients) { st = 'warn'; parts.push(`an En salient ${fmtM(s.outM)} out of the En line${s.opposite ? ` opposite ${s.opposite}` : ''}: a salient commonly radiates threats on multiple axes (MW p 126 para 3 b), so ${s.opposite ?? 'the posn opposite'} covers more than one approach`); }
  for (const r of rd.reentrants) parts.push(`the En front draws back ${fmtM(r.backM)}${r.opposite ? ` opposite ${r.opposite}` : ''} (a re-entrant)`);
  rows.push({ name: 'En front', st, reason: parts.join('; ') });
  // Stand-off
  if (rd.inside.length) {
    rows.push({ name: 'Stand-off', st: 'fail', reason: `${rd.inside.join(', ')} ${rd.inside.length > 1 ? 'lie' : 'lies'} ${kind === 'area' ? 'inside the En area' : 'across the En front line'}: place the plan on the own side of it` });
    return rows;
  }
  const known = rd.stand.filter((s) => s.dM !== null);
  if (!known.length) { rows.push({ name: 'Stand-off', st: 'unchecked', reason: `the ${what} is not ahead of the forward posns: turn the plan to face it` }); return rows; }
  const ds = known.map((s) => s.dM!);
  const spread = Math.max(...ds) - Math.min(...ds);
  const list = rd.stand.map((s) => `${s.label} ${s.dM === null ? 'none ahead' : fmtM(s.dM)}`).join(', ');
  const moved = shape?.moved.filter((m) => rd.stand.some((s) => s.role === m.role)) ?? [];
  const held = shape?.held ?? [];
  const turnWord = (d: number) => `${Math.abs(d)}° ${d > 0 ? 'Rt' : 'Lt'}`;
  const turned = shape?.turned ?? [];
  const parts2: string[] = [];
  if (shape?.refM != null) parts2.push(`laid at ${fmtM(shape.refM)}, the middle of where the forward posns stood as placed`);
  if (turned.length) parts2.push(turned.map((t) => (t.deg ? `${t.label} turned ${turnWord(t.deg)} to face its part of the En front${t.why ? ` (${t.why})` : ''}` : `${t.label} ${t.why}`)).join(', '));
  if (moved.length) parts2.push(`${moved.map((m) => `${m.label} ${m.byM > 0 ? 'forward' : 'back'} ${fmtM(Math.abs(m.byM))}`).join(', ')}, whole, size and shape as the annex draws them`);
  if (edges?.bent.length) parts2.push(`front edges bent onto the En front's curve (${edges.bent.map((b) => `${b.label} up to ${fmtM(b.maxM)}${b.short ? ', short of it where it bends further' : ''}`).join(', ')}), the FDL along it`);
  if (held.length) parts2.push(held.map((h) => `${h.label} not moved ${fmtM(Math.abs(h.wantM))} ${h.wantM > 0 ? 'forward' : 'back'}: ${h.why}`).join('; '));
  const how = shape ? parts2.join('; ') : 'read as drawn';
  rows.push({
    name: 'Stand-off',
    st: spread > spreadWarnM ? 'warn' : 'pass',
    reason: `forward posns' front edges from the ${what} at the nearest: ${list}${how ? ` (${how})` : ''}${spread > spreadWarnM ? `; ${fmtM(spread)} between the nearest and the farthest: the nearer posn meets the En first and the line is uneven, move it or accept it` : ''}`,
  });
  return rows;
}

/** An attack against a marked En area: the own control measures outside it, the Obj on or in it. */
export function attackFrontRows(f: EnFront, items: { role: string; label: string; world: XY[] }[], nearM: number): Check[] {
  if (!frontValid(f)) return [];
  const own = ['assy', 'fup', 'sl', 'bof', 'tkFup', 'fup2', 'sl2'];
  const inside: string[] = [];
  for (const it of items) {
    if (!own.includes(it.role)) continue;
    const hit = f.kind === 'area' ? it.world.some((p) => inRing(f.pts, p)) : false;
    if (hit) inside.push(it.label || it.role);
  }
  const obj = items.find((i) => i.role === 'obj');
  const rows: Check[] = [];
  if (f.kind === 'area') rows.push(inside.length
    ? { name: 'En area', st: 'fail', reason: `${inside.join(', ')} inside the En area marked: the assembly, FUP, SL and BOF are on the own side of the En front` }
    : { name: 'En area', st: 'pass', reason: 'the assembly area, FUP, SL and BOF lie outside the En area marked' });
  if (obj) {
    const c = P(obj.world.reduce((s, p) => s + p.x, 0) / obj.world.length, obj.world.reduce((s, p) => s + p.y, 0) / obj.world.length);
    const n = nearestOnFront(f, c);
    if (!n.inside && n.dM > nearM) rows.push({ name: 'Obj on the En', st: 'warn', reason: `the Obj lies ${fmtM(n.dM)} from the ${f.kind === 'area' ? 'En area' : 'En front line'} marked: is it the En posn to be taken?` });
  }
  return rows;
}
