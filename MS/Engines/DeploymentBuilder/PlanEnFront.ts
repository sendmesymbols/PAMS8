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
export interface FrontBox { role: string; label: string; kind: string; c: XY; w: number; h: number; turn: number }

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

/** How far ahead his front stands from a posn's front edge, the nearest of five rays across it; null: none hits. */
function standOf(lf: LocalFront, b: FrontBox): { dM: number | null; inside: boolean } {
  let best: number | null = null, inside = false;
  for (const u of [-0.4, -0.2, 0, 0.2, 0.4]) {
    const d = rayAhead(lf, b.c.x + u * 2 * halfW(b), front(b));
    if (d === null) continue;
    if (d < 0) inside = true;
    if (best === null || d < best) best = d;
  }
  // a posn whose centre lies in his area is inside it whatever its front edge says
  if (lf.closed && inRing(lf.pts, b.c)) inside = true;
  return { dM: best, inside };
}

export interface FrontShape {
  /** Plan-metre moves by role (fed to the solver with the fit's other nudges). */
  nudges: Record<string, XY>;
  /** The stand-off kept: from the FDL at the plan's axis (where the user put it), metres; null: not read. */
  refM: number | null;
  moved: { role: string; label: string; byM: number }[];
  held: { role: string; label: string; wantM: number; why: string }[];
}

export interface ShapeOpts {
  /** Most a posn moves to keep the stand-off (PlanDoctrine fit.enFront.moveM). */
  maxMoveM: number;
  /** Smaller differences are left alone (PlanDoctrine fit.enFront.minMoveM). */
  minMoveM: number;
}

/**
 * Each forward posn moves straight forward or back so its front edge stands `refM` from his front (the stand-off at
 * the plan's axis, as the user put it), the posns behind it with it; central depth posns by the forward posns' mean.
 * `guard(b, cand)` is PlanFit's layout test (overlap, gaps, depth): a step it refuses is halved once, else held.
 * Mutates `boxes` (their centres) as PlanFit's other moves do.
 */
export function shapeToFront(boxes: FrontBox[], lf: LocalFront, pivot: XY, o: ShapeOpts, guard: (b: FrontBox, cand: FrontBox) => string | null): FrontShape {
  const out: FrontShape = { nudges: {}, refM: null, moved: [], held: [] };
  const fwd = boxes.filter(isFwd);
  if (!fwd.length || boxes.some((b) => b.kind === 'round')) return out;
  const frontY = Math.max(...fwd.map(front));
  const stands = fwd.map((b) => ({ b, d: standOf(lf, b).dM }));
  const known = stands.filter((s) => s.d !== null).map((s) => s.d!) .sort((a, z) => a - z);
  if (!known.length) return out;
  let ref = rayAhead(lf, pivot.x, frontY);
  if (ref === null || ref < 0) ref = known[Math.floor(known.length / 2)];
  out.refM = ref;
  const orig = new Map(boxes.map((b) => [b.role, { ...b.c }]));
  const backs = boxes.filter(isBack);
  const owner = new Map<FrontBox, FrontBox>();
  for (const d of backs) {
    const f = fwd.filter((x) => Math.abs(d.c.x - x.c.x) <= halfW(x)).sort((a, z) => Math.abs(d.c.x - a.c.x) - Math.abs(d.c.x - z.c.x))[0];
    if (f) owner.set(d, f);
  }
  /** Move a group by s along y, back boxes first when going back; all or nothing. */
  const moveGroup = (group: FrontBox[], s: number): string | null => {
    const order = s < 0 ? [...group].reverse() : group;
    const done: [FrontBox, XY][] = [];
    for (const b of order) {
      const cand: FrontBox = { ...b, c: P(b.c.x, b.c.y + s) };
      const why = guard(b, cand);
      if (why) { for (const [x, c] of done.reverse()) x.c = c; return why; }
      done.push([b, { ...b.c }]);
      b.c = cand.c;
    }
    return null;
  };
  const shifts: number[] = [];
  for (const { b, d } of stands) {
    if (d === null) continue;
    const want = d - ref;
    if (Math.abs(want) < o.minMoveM) { shifts.push(0); continue; }
    const s = Math.max(-o.maxMoveM, Math.min(o.maxMoveM, want));
    const group = [b, ...backs.filter((x) => owner.get(x) === b)];
    let why = moveGroup(group, s);
    let got = why ? 0 : s;
    if (why && Math.abs(s / 2) >= o.minMoveM) { const w2 = moveGroup(group, s / 2); if (!w2) { got = s / 2; why = null; } }
    if (got) { shifts.push(got); out.moved.push({ role: b.role, label: b.label, byM: Math.round(got) }); }
    if (why || Math.abs(got) < Math.abs(want) - 1) out.held.push({ role: b.role, label: b.label, wantM: Math.round(want), why: why ?? `moved ${fmtM(Math.abs(got))} of ${fmtM(Math.abs(want))}: the most a posn moves to keep the stand-off` });
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
export function readFront(lf: LocalFront, boxes: FrontBox[], bulgeM: number): FrontReading {
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
  const flank = (side: -1 | 1): number | null => {
    const near = pts.filter((p) => (side < 0 ? p.x < x0 && p.x >= x0 - W : p.x > x1 && p.x <= x1 + W) && p.y <= frontY);
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
  const stand = fwd.map((b) => { const s = standOf(lf, b); return { role: b.role, label: b.label, dM: s.dM === null ? null : Math.round(s.dM), inside: s.inside }; });
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
export function frontRows(rd: FrontReading, kind: EnFrontKind, shape: FrontShape | null, spreadWarnM: number): Check[] {
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
  const how = shape
    ? `${shape.refM !== null ? `kept at ${fmtM(shape.refM)} as placed (the axis)` : ''}${moved.length ? `; ${moved.map((m) => `${m.label} ${m.byM > 0 ? 'forward' : 'back'} ${fmtM(Math.abs(m.byM))}`).join(', ')} to follow the En front, size and shape as the annex draws them` : ''}${held.length ? `; ${held.map((h) => `${h.label} not moved ${fmtM(Math.abs(h.wantM))} ${h.wantM > 0 ? 'forward' : 'back'}: ${h.why}`).join('; ')}` : ''}`
    : 'read as drawn';
  rows.push({
    name: 'Stand-off',
    st: spread > spreadWarnM ? 'warn' : 'pass',
    reason: `forward posns from the ${what} straight ahead: ${list}${how ? ` (${how.replace(/^; /, '')})` : ''}${spread > spreadWarnM ? `; ${fmtM(spread)} between the nearest and the farthest: the nearer posn meets the En first and the line is uneven, move it or accept it` : ''}`,
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
