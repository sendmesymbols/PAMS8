/**
 * PlanAttack.ts — PURE. The attack in depth (PlanBuilder_Plan.md Phase 6, §9.2):
 *
 * - finders on the ground: the FUP swung round the objective into dead ground (IBB p173: not observed, 1000-1200 m,
 *   p201), the start line on a linear feature square to the axis with nothing between it and the objective (never
 *   behind an obstacle), the BOF sited off the axis where it sees the objective best and stands higher (§9.2), the
 *   Assy Area 1-5 miles back, unobserved, with a road for entry and exit (IBB p173); the route on foot from the Assy
 *   Area to the FUP round NO-GO;
 * - the H-hour sum: the approach march (day / night rates, IBB p 18, + a spare), forming up, the FUP to the SL, the
 *   assault at its pace, the fire lifting as it closes (IC s66 p305: 450 / 360 / 275 / 180 m), the objective and the
 *   LOE; times back from H;
 * - his MSR behind the objective (a bridge on a metalled road first) and how near each layout's LOE comes to it (the
 *   user: a flanking attack that chokes his MSR is encouraged);
 * - left against right (frontal for reference): weighed factors, each with its reason (PlanDoctrine attack.compareWeights);
 * - by night, the Night March chart from the Assy Area to the FUP (NightMarchRead: legs, bearings, paces, timings back
 *   from H, his night-sight and thermal rings).
 *
 * No ArcGIS, no DOM: the ground through PlanFit's `PlanGround`. What the ground cannot answer stays "unchecked".
 */
import type { DoctrineSet, Recipe } from './PlanRecipes';
import { tamBreach, type EngrType } from './PlanEngr';
import { doctrineAt, resolveRange } from './PlanRecipes';
import type { Check, CheckState, SolveResult, XY } from './PlanSolve';
import { toLocal, toWorld, type FitFrame, type PlanGround } from './PlanFit';
import { footKmh, type TerrainKind } from './PlanContext';
import { nightMarchChart, type NightMarchChart, type Rules as NmRules } from '../NightMarch/NightMarchRead';

const P = (x: number, y: number): XY => ({ x, y });
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
const centre = (pts: XY[]) => P(pts.reduce((a, p) => a + p.x, 0) / pts.length, pts.reduce((a, p) => a + p.y, 0) / pts.length);
const ext = (pts: XY[]) => ({ x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) });
const WATER = new Set([4, 5, 20, 21, 22, 46]);
const LINEAR = new Set([20, 21, 22, 24, 25, 28, 34, 35, 36, 37, 38, 46, 47]);
const ROADS = new Set([34, 35, 36, 37, 38]);
const hm = (min: number) => { const a = Math.abs(Math.round(min)); return `${Math.floor(a / 60)} h ${String(a % 60).padStart(2, '0')}`; };
export const hRelText = (min: number) => (Math.round(min) === 0 ? 'H' : min < 0 ? `H-${hm(min)}` : `H+${Math.round(min)} min`);

export interface AttackFind {
  /** Plan-metre moves by role (the FUP and the units laid from it, the SL, the Assy Area, the BOF's Coy). */
  nudges: Record<string, XY>;
  /** Slots laid afresh: the BOF re-sited round the objective, facing it. */
  geom: Record<string, { pts: XY[]; base?: { start: XY; mid: XY; end: XY } }>;
  /** The axis from the SL to just inside the objective's near edge (PlanFit bends it round NO-GO). */
  axis: XY[] | null;
  /** The route on foot from the Assy Area to the FUP, plan metres; null when it is not found (straight then). */
  route: XY[] | null;
  rows: Check[];
}

const num = (doc: DoctrineSet, path: string, fb: number) => { const r = resolveRange(doc, doctrineAt(doc, path)); return r ? (r[0] + r[1]) / 2 : fb; };

/** The extent of an axis-aligned box along a unit direction from its centre. */
const extentAlong = (b: ReturnType<typeof ext>, u: XY) => Math.min(Math.abs(u.x) > 1e-9 ? (b.x1 - b.x0) / 2 / Math.abs(u.x) : Infinity, Math.abs(u.y) > 1e-9 ? (b.y1 - b.y0) / 2 / Math.abs(u.y) : Infinity);

/**
 * The finders. `res` is the recipe solved with the user's own moves only; the frame is the attack's (y toward the
 * objective). Every move is kept small and said; without sight data a place stays where the recipe put it.
 */
/**
 * The fire lifts the assault is covered to (IC s66 p305: from the objective, 120 mm mortars 450 m, medium 360, the Bn's
 * mortars 275, field 180). Without artillery on the plan, every ring (the safe side); with it (PlanArty), the Bn's
 * mortars and the ring of the plan's own guns: a Fd or Mtn Regt / Bty the field ring, a Med or Hy one the medium ring.
 */
export function liftRings(res: { recipe: { arty?: { name: string; weapon: { name: string } } } }, doc: DoctrineSet): [string, number][] {
  const lift = (doctrineAt(doc, 'fireLiftM') ?? {}) as Record<string, number>;
  const all: [string, number][] = [['120 mm Mor', lift.mor120 ?? 450], ['Med', lift.medium ?? 360], ['Bn Mor', lift.bnMor ?? 275], ['Fd', lift.field ?? 180]];
  const a = res.recipe.arty;
  if (!a) return all;
  const med = /(med|hy)|155|130|8 in/i.test(`${a.name} ${a.weapon.name}`);
  return [['Bn Mor', lift.bnMor ?? 275], med ? [a.name, lift.medium ?? 360] : [a.name, lift.field ?? 180]];
}

export function findAttackSpots(res: SolveResult, f: FitFrame, g: PlanGround, doc: DoctrineSet): AttackFind {
  const out: AttackFind = { nudges: {}, geom: {}, axis: null, route: null, rows: [] };
  const item = (role: string) => res.items.find((i) => i.role === role);
  const obj = item('obj'), fup = item('fup'), sl = item('sl'), bof = item('bof'), assy = item('assy');
  if (!obj || !fup) return out;
  const W = (p: XY) => toWorld(f, p);
  const foot = g.going('dismounted');
  const bad = (p: XY) => { const w = W(p); const c = g.cls(w.x, w.y); return c !== null && (foot.nogo.has(c) || WATER.has(c)); };
  const sightFrac = (from: XY, eye: number, to: XY[], tgt: number): number | null => {
    if (!g.sight) return null;
    const a = W(from);
    const ps = to.map((p) => { const b = W(p); return g.sight!(a.x, a.y, eye, b.x, b.y, tgt); }).filter((p): p is number => p !== null);
    return ps.length >= Math.min(3, to.length) ? ps.filter((p) => p >= 0.5).length / ps.length : null;
  };
  const ob = ext(obj.pts), O = centre(obj.pts);
  const objPts = [O, P(ob.x0, ob.y0), P(ob.x1, ob.y0), P(ob.x0, ob.y1), P(ob.x1, ob.y1), P(O.x, ob.y0), P(O.x, ob.y1), P(ob.x0, O.y), P(ob.x1, O.y)];
  const move = (roles: string[], d: XY) => { for (const r of roles) if (res.items.some((i) => i.role === r)) out.nudges[r] = P((out.nudges[r]?.x ?? 0) + d.x, (out.nudges[r]?.y ?? 0) + d.y); };

  // ── the FUP: swung round the objective (and 100 m in or out) into ground hidden from it, off NO-GO ────────────────
  const F0 = centre(fup.pts);
  const v0 = P(F0.x - O.x, F0.y - O.y), R0 = Math.hypot(v0.x, v0.y), a0 = Math.atan2(v0.x, v0.y);
  const sw = num(doc, 'attack.fupSearchDeg', 20);
  let best: { F: XY; cost: number; seen: number | null; dA: number; dR: number } | null = null;
  const band = resolveRange(doc, doctrineAt(doc, 'attack.fupFromObjM')) ?? [1000, 1200];
  const gapOf = (pts: XY[]) => Math.min(...pts.map((p) => Math.hypot(Math.max(0, ob.x0 - p.x, p.x - ob.x1), Math.max(0, ob.y0 - p.y, p.y - ob.y1))));
  for (const dAdeg of [0, -5, 5, -10, 10, -15, 15, -20, 20].filter((d) => Math.abs(d) <= sw)) for (const dR of [0, -100, 100]) {
    const a = a0 + (dAdeg * Math.PI) / 180;
    let R = R0 + dR, F = P(O.x + R * Math.sin(a), O.y + R * Math.cos(a));
    let pts = [F, ...fup.pts.map((p) => P(p.x + F.x - F0.x, p.y + F.y - F0.y))];
    // swinging round the objective's corner brings the FUP nearer its edge: keep it 1000-1200 m off (IBB p201)
    const gap0 = gapOf(pts);
    if (gap0 < band[0]) { R += band[0] - gap0 + 1; F = P(O.x + R * Math.sin(a), O.y + R * Math.cos(a)); pts = [F, ...fup.pts.map((p) => P(p.x + F.x - F0.x, p.y + F.y - F0.y))]; }
    if (gapOf(pts) > band[1] + 50) continue;
    const nogo = pts.filter(bad).length;
    if (nogo >= 2) continue;
    const seen = sightFrac(O, 2, pts, 1.7);
    const cost = (seen ?? 0.5) * 10 + Math.abs(dAdeg) / 10 + Math.abs(dR) / 200 + nogo * 3;
    if (!best || cost < best.cost) best = { F, cost, seen, dA: dAdeg, dR };
  }
  const F1 = best ? best.F : F0;
  if (!best || best.seen === null) out.rows.push({ name: 'FUP finder', st: 'unchecked', reason: g.sight ? 'the ground round the FUP is not loaded' : 'no sight data in the bundle: the FUP stays where the recipe put it' });
  else {
    const d = P(F1.x - F0.x, F1.y - F0.y);
    if (dist(F1, F0) > 1) move(['fup', 'asltL', 'asltR', 'res', 'hq', 'fu1', 'fu2'], d);
    out.rows.push(best.seen < 0.5
      ? { name: 'FUP finder', st: 'pass', reason: `${dist(F1, F0) > 1 ? `moved ${fmtM(dist(F1, F0))} (${best.dA ? `${Math.abs(best.dA)}° ${best.dA > 0 ? 'clockwise' : 'anti-clockwise'} round the Obj` : ''}${best.dA && best.dR ? ', ' : ''}${best.dR ? `${Math.abs(best.dR)} m ${best.dR > 0 ? 'further out' : 'nearer'}` : ''}) ` : ''}into ground likely hidden from the Obj (${Math.round(best.seen * 5)} of 5 points seen); IBB p173: not observed` }
      : { name: 'FUP finder', st: 'warn', reason: `no ground within ${sw}° and 100 m of it is hidden from the Obj (${Math.round(best.seen * 100)} % seen at best): form up by night or under smoke` });
  }

  // ── the start line: a linear feature square to the axis, nothing between it and the objective ────────────────────
  const u = (() => { const d = dist(O, F1) || 1; return P((O.x - F1.x) / d, (O.y - F1.y) / d); })();
  const wv = P(u.y, -u.x);
  const near = extentAlong(ob, u);
  const toEdge = (S: XY) => dist(S, O) - near;
  const clearAhead = (S: XY) => { const L = toEdge(S); for (let t = 50; t < L; t += 50) if (bad(P(S.x + u.x * t, S.y + u.y * t))) return false; return true; };
  const linearAcross = (S: XY) => {
    let known = 0, hit = 0;
    for (let k = -4; k <= 4; k++) {
      let kk = false, h = false;
      for (const along of [-12, 0, 12]) {
        const p = P(S.x + wv.x * k * 75 + u.x * along, S.y + wv.y * k * 75 + u.y * along);
        const w = W(p); const c = g.cls(w.x, w.y);
        if (c === null) continue;
        kk = true; if (LINEAR.has(c)) h = true;
      }
      if (kk) { known++; if (h) hit++; }
    }
    return known >= 5 ? hit / known : null;
  };
  const S0 = sl ? centre(sl.pts) : P(F1.x + u.x * 200, F1.y + u.y * 200);
  // the SL beyond the furthest fire lift (IC s66 p305), with room to spare: the assault crosses it under covering fire
  // the furthest lift of the fire the plan has (all of them without its own artillery)
  const liftMax = Math.max(...liftRings(res, doc).map(([, r]) => r));
  const slMinM = liftMax + num(doc, 'attack.slBeyondLiftM', 150);
  let S: XY | null = null, cover = 0, anyKnown = false;
  for (let t = 200; toEdge(P(F1.x + u.x * t, F1.y + u.y * t)) >= slMinM; t += 25) {
    const p = P(F1.x + u.x * t, F1.y + u.y * t);
    const c = linearAcross(p);
    if (c === null) continue;
    anyKnown = true;
    if (c >= 0.6 && clearAhead(p)) { S = p; cover = c; break; }
  }
  const Sfin = S ?? P(F1.x + u.x * 200, F1.y + u.y * 200);
  if (sl) move(['sl'], P(Sfin.x - S0.x, Sfin.y - S0.y));
  out.rows.push(S ? { name: 'SL finder', st: 'pass', reason: `on a linear feature ${fmtM(dist(Sfin, F1))} ahead of the FUP centre, ${fmtM(toEdge(Sfin))} from the Obj (${Math.round(cover * 100)} % of it across the axis), nothing NO-GO between it and the Obj (IBB p173: never behind an obstacle), beyond the last fire lift (${Math.round(liftMax)} m)` }
    : !anyKnown ? { name: 'SL finder', st: 'unchecked', reason: 'the ground between the FUP and the Obj is not loaded' }
    : { name: 'SL finder', st: 'warn', reason: 'no linear feature square to the axis with a clear run to the Obj: the SL 200 m ahead of the FUP, mark it with tape' });
  out.axis = [Sfin, P(O.x - u.x * (near - 100), O.y - u.y * (near - 100))];

  // ── the BOF: off the axis (40-100°), 600-1100 m from the objective, where it sees most of it and stands higher ─────
  if (bof) {
    const back = Math.atan2(F1.x - O.x, F1.y - O.y);
    const rr = resolveRange(doc, doctrineAt(doc, 'attack.bofFromObjM')) ?? [600, 1100];
    const reach = num(doc, 'attack.bofRangeMaxM', 1189);
    const eO = (() => { const w = W(O); return g.elev(w.x, w.y); })();
    const segDist = (p: XY) => { const L = dist(F1, O) || 1; const t = Math.max(0, Math.min(1, ((p.x - F1.x) * (O.x - F1.x) + (p.y - F1.y) * (O.y - F1.y)) / (L * L))); return dist(p, P(F1.x + t * (O.x - F1.x), F1.y + t * (O.y - F1.y))); };
    let bb: { p: XY; score: number; view: number; rise: number; off: number } | null = null;
    // outside the objective's edge by bofOutsideObjM: a wide Obj puts the nearer rings inside it
    const outside = num(doc, 'attack.bofOutsideObjM', 300);
    for (const r of [rr[0], (rr[0] + rr[1]) / 2, rr[1], rr[1] + 250]) for (const offDeg of [40, 55, 70, 85, 100]) for (const sgn of [1, -1]) {
      const a = back + sgn * (offDeg * Math.PI) / 180;
      const p = P(O.x + r * Math.sin(a), O.y + r * Math.cos(a));
      if (bad(p) || segDist(p) < 250) continue;
      const boxD = Math.hypot(Math.max(0, ob.x0 - p.x, p.x - ob.x1), Math.max(0, ob.y0 - p.y, p.y - ob.y1));
      if (boxD > reach || boxD < outside) continue;
      const view = sightFrac(p, 2.5, objPts, 1.7);
      if (view === null) continue;
      const w = W(p); const e = g.elev(w.x, w.y);
      const rise = Number.isFinite(e) && Number.isFinite(eO) ? e - eO : 0;
      const score = view * 10 + Math.max(-2, Math.min(3, rise / 10)) - Math.abs(r - 850) / 500;
      if (!bb || score > bb.score) bb = { p, score, view, rise, off: offDeg };
    }
    if (!bb) out.rows.push({ name: 'BOF siter', st: 'unchecked', reason: g.sight ? 'the ground round the Obj is not loaded' : 'no sight data: the BOF stays where the recipe put it' });
    else {
      const p = bb.p, d = dist(p, O) || 1, to = P((O.x - p.x) / d, (O.y - p.y) / d), side = P(to.y, -to.x);
      const baseL = bof.base ? dist(bof.base.start, bof.base.end) : 400;
      out.geom.bof = { pts: [P(p.x + to.x * 300, p.y + to.y * 300)], base: { start: P(p.x - side.x * baseL / 2, p.y - side.y * baseL / 2), mid: p, end: P(p.x + side.x * baseL / 2, p.y + side.y * baseL / 2) } };
      const bc = item('bofCoy');
      if (bc) move(['bofCoy'], P(p.x - bc.pts[0].x, p.y - bc.pts[0].y));
      out.rows.push({ name: 'BOF siter', st: bb.view >= 0.6 ? 'pass' : bb.view > 0 ? 'warn' : 'fail', reason: `sited ${fmtM(dist(p, O))} from the Obj, ${bb.off}° off the axis, ${Math.round(bb.rise)} m ${bb.rise >= 0 ? 'higher' : 'lower'}, ${Math.round(bb.view * 9)} of 9 points of the Obj likely in view (§9.2: higher than and to the flank of the assault, seeing the whole Obj)${bb.view < 0.6 ? ': confirm a better fire position by recce' : ''}` });
    }
  }

  // ── the Assy Area: 1-5 miles back, hidden from the objective, a road for entry and exit, off NO-GO ───────────────
  if (assy) {
    const A0 = centre(assy.pts);
    const back = Math.atan2(F1.x - O.x, F1.y - O.y);
    const band = resolveRange(doc, doctrineAt(doc, 'attack.assyFromObjM')) ?? [1600, 8000];
    const access = num(doc, 'attack.assyAccessM', 300);
    let ba: { A: XY; cost: number; seen: number | null; road: boolean; dd: number } | null = null;
    for (const dd of [2500, 3500, 4500, 5500, 7000].filter((x) => x >= band[0] && x <= band[1])) for (const offDeg of [0, -15, 15, -30, 30]) {
      const a = back + (offDeg * Math.PI) / 180;
      const A = P(O.x + dd * Math.sin(a), O.y + dd * Math.cos(a));
      const cells = [A, P(A.x - 300, A.y), P(A.x + 300, A.y), P(A.x, A.y - 200), P(A.x, A.y + 200)];
      const nb = cells.filter(bad).length;
      if (nb >= 2) continue;
      const seen = sightFrac(O, 5, cells, 3);
      let road = false;
      for (let k = 0; k < 8 && !road; k++) for (let r = 0; r <= access; r += 50) {
        const w = W(P(A.x + r * Math.cos((k * Math.PI) / 4), A.y + r * Math.sin((k * Math.PI) / 4)));
        const c = g.cls(w.x, w.y);
        if (c !== null && ROADS.has(c)) { road = true; break; }
      }
      // outside his thermal sights (NightMarchDoctrine 4 km) where hidden ground allows
      const cost = (seen ?? 0.5) * 10 + (road ? 0 : 3) + nb * 4 + dd / 4000 + (dd < num(doc, 'attack.assyPreferM', 4000) ? 2 : 0);
      if (!ba || cost < ba.cost) ba = { A, cost, seen, road, dd };
    }
    if (!ba || ba.seen === null) out.rows.push({ name: 'Assy finder', st: 'unchecked', reason: g.sight ? 'the ground behind is not loaded' : 'no sight data: the Assy Area stays where the recipe put it' });
    else {
      move(['assy'], P(ba.A.x - A0.x, ba.A.y - A0.y));
      const st: CheckState = ba.seen < 0.5 && ba.road ? 'pass' : 'warn';
      out.rows.push({ name: 'Assy finder', st, reason: `${fmtM(ba.dd)} from the Obj (IBB p173: 1-5 miles), ${ba.seen < 0.5 ? 'likely hidden from it' : `${Math.round(ba.seen * 100)} % likely seen from it: disperse and camouflage`}, ${ba.road ? `a road within ${access} m for entry and exit` : 'no road within reach: plan the vehicles\' entry and exit'}` });
    }
    // the route on foot from the Assy Area to the FUP, round NO-GO
    const Afin = P(A0.x + (out.nudges.assy?.x ?? 0), A0.y + (out.nudges.assy?.y ?? 0));
    const av = g.avenues?.(W(Afin), W(F1), 300, 'dismounted');
    const path = av?.[0]?.path;
    out.route = simplify(path && path.length >= 2 ? [Afin, ...path.slice(1, -1).map((w) => toLocal(f, w)), F1] : [Afin, F1], num(doc, 'attack.routeToleranceM', 75));
  }
  return out;
}

/** Douglas-Peucker: the fewest legs within `tol` metres of the route (a night march is marched leg by leg on a bearing). */
export function simplify(pts: XY[], tol: number): XY[] {
  if (pts.length <= 2) return pts;
  const a = pts[0], b = pts[pts.length - 1], L = dist(a, b) || 1;
  let worst = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i].x - a.x) * (b.y - a.y) - (pts[i].y - a.y) * (b.x - a.x)) / L;
    if (d > worst) { worst = d; at = i; }
  }
  return worst <= tol ? [a, b] : [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)];
}

// ── the H-hour sum ─────────────────────────────────────────────────────────────────────────────────────────────────
export interface HStep { label: string; distM: number; min: number; /** Minutes from H at its start (negative before H). */ at: number }
export interface HSum {
  steps: HStep[];
  lifts: { label: string; rM: number; at: number }[];
  /** Minutes before H to leave the Assy Area. */
  leaveBeforeH: number;
  objAt: number;
  loeAt: number | null;
  night: boolean;
  /** The approach march's ground (null when it was walked as open ground). */
  slowPct: number | null;
  /** The assault's pace, minutes a 100 m, slowed by the SLOW-GO share of the axis. */
  paceMinPer100m: number;
  assaultSlowPct: number;
  /** A two-phase attack: Obj 1 taken, the follow-up Coys' move to FUP 2, H2 (crossing SL 2), Obj 2. */
  phase2?: Phase2Times;
  /** Tanks with the attack (PlanTanks.addTankTimes): minutes from H they leave FUP (Tks), reach the assault line or fire posns, and are on the Obj (close sp). */
  tanks?: { mode: string; leaveAt: number; atAt: number; onObjAt: number | null; lengthM: number };
}

export interface Phase2Times {
  /** Minutes from H: Obj 1 taken (through it: the success signal), H2 (crossing SL 2), on Obj 2. */
  obj1At: number; h2At: number; obj2At: number;
  /** From Obj 1 taken to H2: the time he has to react (IBB p176 c). */
  gapMin: number;
  marchM: number; marchMin: number;
  lifts: { label: string; rM: number; at: number }[];
  paceMinPer100m: number;
}

/** Walk a plan-metre polyline: metres on GO and SLOW-GO on foot (unknown counted GO), metres climbed. */
function walk(pts: XY[], f: FitFrame, g: PlanGround) {
  const foot = g.going('dismounted');
  let goM = 0, slowM = 0, climb = 0, lastE = NaN, known = 0, n = 0;
  for (let i = 1; i < pts.length; i++) {
    const L = dist(pts[i - 1], pts[i]), steps = Math.max(1, Math.ceil(L / 50));
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps;
      const w = toWorld(f, P(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t));
      const c = g.cls(w.x, w.y), e = g.elev(w.x, w.y);
      if (Number.isFinite(e)) { if (Number.isFinite(lastE) && e > lastE) climb += e - lastE; lastE = e; }
      n++;
      if (c !== null) known++;
      if (c !== null && foot.caution.has(c)) slowM += L / steps; else goM += L / steps;
    }
  }
  return { goM, slowM, climb, known: n ? known / n : 0 };
}

/** Along an axis from its tail to the objective's near edge (the part of it outside the box). */
function assaultDist(ax: XY[], ob: ReturnType<typeof ext>): number {
  const toEdge = (p: XY) => Math.hypot(Math.max(0, ob.x0 - p.x, p.x - ob.x1), Math.max(0, ob.y0 - p.y, p.y - ob.y1));
  let D = 0;
  for (let i = 1; i < ax.length; i++) {
    const a = ax[i - 1], b = ax[i], L = dist(a, b);
    if (toEdge(b) > 0) { D += L; continue; }
    // the part of this leg outside the objective
    let lo = 0, hi = 1;
    for (let k = 0; k < 20; k++) { const m = (lo + hi) / 2; if (toEdge(P(a.x + (b.x - a.x) * m, a.y + (b.y - a.y) * m)) > 0) lo = m; else hi = m; }
    D += L * lo;
    break;
  }
  return D;
}
/** A route cut where it first comes within `m` of a box (the follow-up Coys' waiting place); [null, route] when never. */
function splitAtGap(route: XY[], ob: ReturnType<typeof ext>, m: number): [XY[] | null, XY[]] {
  const gap = (p: XY) => Math.hypot(Math.max(0, ob.x0 - p.x, p.x - ob.x1), Math.max(0, ob.y0 - p.y, p.y - ob.y1));
  if (gap(route[0]) <= m) return [null, route];
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i], k = Math.max(1, Math.ceil(dist(a, b) / 25));
    for (let s = 1; s <= k; s++) {
      const p = P(a.x + ((b.x - a.x) * s) / k, a.y + ((b.y - a.y) * s) / k);
      if (gap(p) <= m) return [[...route.slice(0, i), p], [p, ...route.slice(i)]];
    }
  }
  return [null, route];
}
const dirOf = (ax: XY[]) => { const e = ax[ax.length - 1], s = ax[Math.max(0, ax.length - 2)], d = dist(e, s) || 1; return P((e.x - s.x) / d, (e.y - s.y) / d); };

/**
 * The H-hour sum for a solved attack: leave the Assy Area, march to the FUP (day or night rates for the ground, IBB
 * p 18, + the spare), form up, FUP to the SL (H = crossing the SL), the assault at its pace, the fire lifting at each
 * ring, the objective, the LOE.
 */
export function attackTimes(res: SolveResult, f: FitFrame | null, g: PlanGround | null, doc: DoctrineSet, kind: TerrainKind, night: boolean, route: XY[] | null, route2: XY[] | null = null): HSum | null {
  const item = (role: string) => res.items.find((i) => i.role === role);
  const obj = item('obj'), fup = item('fup'), sl = item('sl'), axis = item('axis'), loe = item('loe'), assy = item('assy');
  if (!obj || !fup || !axis) return null;
  const day = footKmh(doc, kind);
  const go = night ? num(doc, `attack.nightFootKmh.${kind}`, num(doc, 'attack.nightFootKmh.plains', 3)) : day.go;
  const slow = go * (day.slow / day.go);
  const spare = num(doc, 'attack.spareFactor', 0.15);
  const pace = num(doc, 'attack.assaultMinPer100m', 4);
  const climbPer = kind === 'mountain' ? num(doc, 'terrain.kinds.mountain.ascentMinPer300m', 45) / 300 : 0;
  const leg = (pts: XY[]) => {
    if (f && g) { const w = walk(pts, f, g); return { m: w.goM + w.slowM, min: ((w.goM / 1000) / go + (w.slowM / 1000) / slow) * 60 + w.climb * climbPer, slowPct: w.goM + w.slowM ? (100 * w.slowM) / (w.goM + w.slowM) : 0, known: w.known }; }
    const m = pts.slice(1).reduce((a, p, i) => a + dist(pts[i], p), 0);
    return { m, min: (m / 1000 / go) * 60, slowPct: null as number | null, known: 0 };
  };
  const F = centre(fup.pts), S = sl ? centre(sl.pts) : axis.pts[0], O = centre(obj.pts), ob = ext(obj.pts);
  const A = assy ? centre(assy.pts) : null;
  const l1 = A ? leg(route && route.length >= 2 ? route : [A, F]) : null;
  const l1min = l1 ? Math.round(l1.min * (1 + spare)) : 0;
  const fupMin = Math.round(num(doc, 'attack.fupMin', 30));
  const l2 = leg([F, S]);
  // the assault from the SL to the objective's near edge, along the axis as laid
  const ax = axis.pts;
  const D = assaultDist(ax, ob);
  const depth = 2 * extentAlong(ob, dirOf(ax));
  // the ground slows the assault: its SLOW-GO share along the axis at the day ratio of SLOW-GO to GO
  const paceOn = (pts: XY[]) => {
    const w = f && g ? walk(pts, f, g) : null;
    const share = w && w.goM + w.slowM > 0 ? w.slowM / (w.goM + w.slowM) : 0;
    return { share, pace: pace * (1 - share + share * (day.go / day.slow)) };
  };
  const { share: slowShare, pace: paceEff } = paceOn(ax);
  const rings = liftRings(res, doc);
  const atD = (m: number) => Math.round((Math.max(0, m) / 100) * paceEff);
  const steps: HStep[] = [];
  const before = l1min + fupMin + Math.round(l2.min);
  if (l1 && A) steps.push({ label: `Assy Area to the FUP${night ? ' (night)' : ''}`, distM: Math.round(l1.m), min: l1min, at: -before });
  steps.push({ label: 'Form up', distM: 0, min: fupMin, at: -before + l1min });
  steps.push({ label: 'FUP to the SL', distM: Math.round(l2.m), min: Math.round(l2.min), at: -Math.round(l2.min) });
  // a two-phase attack (PlanPhase): Obj 1, then the follow-up Coys round it onto Obj 2; the LOE beyond Obj 2
  const obj2 = item('obj2'), axis2 = item('axis2'), fup2 = item('fup2'), sl2 = item('sl2');
  const two = !!(obj2 && axis2 && fup2);
  steps.push({ label: two ? 'Assault: SL to Obj 1' : 'Assault: SL to the Obj', distM: Math.round(D), min: atD(D), at: 0 });
  steps.push({ label: two ? 'Through Obj 1' : 'Through the Obj', distM: Math.round(depth), min: atD(depth), at: atD(D) });
  let phase2: Phase2Times | undefined;
  let loeAt: number | null = null;
  if (obj2 && axis2 && fup2) {
    // the follow-up Coys stay in the FUP until Obj 1 is taken (IBB p204 (7)), then go round it to FUP 2
    const t1 = atD(D + depth);
    const F2 = centre(fup2.pts), S2 = sl2 ? centre(sl2.pts) : axis2.pts[0];
    const way = route2 && route2.length >= 2 ? route2 : [F, F2];
    // 'behind' (IBB p186 h(2)): they follow the assault from H and wait 500-750 m short of Obj 1 on their way
    const waitAt = String(doctrineAt(doc, 'attack.phase2.waitAt') ?? 'fup');
    const [pre, post] = waitAt === 'behind' ? splitAtGap(way, ob, num(doc, 'attack.phase2.followUpBehindM', 625)) : [null, way];
    const l0 = pre ? leg(pre) : null;
    const m0 = l0 ? Math.round(l0.min * (1 + spare)) : 0;
    const go2 = Math.max(t1, m0);
    const l3 = leg(post);
    const m2 = Math.round(l3.min * (1 + spare));
    const fm2 = Math.round(num(doc, 'attack.phase2.fupMin', 15));
    const l4 = leg([F2, S2]);
    const h2 = go2 + m2 + fm2 + Math.round(l4.min);
    const ob2 = ext(obj2.pts), D2 = assaultDist(axis2.pts, ob2), depth2 = 2 * extentAlong(ob2, dirOf(axis2.pts));
    const p2 = paceOn(axis2.pts).pace;
    const at2 = (m: number) => h2 + Math.round((Math.max(0, m) / 100) * p2);
    if (l0) steps.push({ label: 'Follow-up Coys close up behind the assault', distM: Math.round(l0.m), min: m0, at: 0 });
    steps.push({ label: `Follow-up Coys: ${l0 ? 'on' : 'FUP'} to FUP 2${night ? ' (night)' : ''}`, distM: Math.round(l3.m), min: m2, at: go2 });
    steps.push({ label: 'Form up at FUP 2', distM: 0, min: fm2, at: go2 + m2 });
    steps.push({ label: 'FUP 2 to SL 2', distM: Math.round(l4.m), min: Math.round(l4.min), at: go2 + m2 + fm2 });
    steps.push({ label: 'Assault: SL 2 to Obj 2 (H2)', distM: Math.round(D2), min: at2(D2) - h2, at: h2 });
    steps.push({ label: 'Through Obj 2', distM: Math.round(depth2), min: at2(D2 + depth2) - at2(D2), at: at2(D2) });
    const loeDist2 = loe ? Math.max(0, dist(centre(obj2.pts), centre(loe.pts)) - depth2 / 2) : null;
    if (loeDist2 !== null) {
      steps.push({ label: 'On to the LOE', distM: Math.round(loeDist2), min: at2(D2 + depth2 + loeDist2) - at2(D2 + depth2), at: at2(D2 + depth2) });
      loeAt = at2(D2 + depth2 + loeDist2);
    }
    phase2 = { obj1At: t1, h2At: h2, obj2At: at2(D2), gapMin: h2 - t1, marchM: Math.round(l3.m), marchMin: m2, lifts: rings.map(([label, r]) => ({ label, rM: r, at: at2(D2 - r) })), paceMinPer100m: Math.round(p2 * 10) / 10 };
  } else {
    const loeDist = loe ? Math.max(0, dist(O, centre(loe.pts)) - depth / 2) : null;
    if (loeDist !== null) {
      steps.push({ label: 'On to the LOE', distM: Math.round(loeDist), min: atD(loeDist), at: atD(D + depth) });
      loeAt = atD(D + depth + loeDist);
    }
  }
  const br = res.recipe.enMfAtk ? attackBreach(res.recipe, doc, night) : null;
  if (br) steps.unshift({ label: `Engineers begin the lanes through his minefield (${br.by})`, distM: 0, min: Math.round(br.h * 60), at: -Math.round(br.h * 60) });
  steps.sort((a, b) => a.at - b.at);
  return {
    steps, lifts: rings.map(([label, r]) => ({ label, rM: r, at: atD(D - r) })),
    leaveBeforeH: before, objAt: atD(D), loeAt, night, slowPct: l1?.slowPct ?? null,
    paceMinPer100m: Math.round(paceEff * 10) / 10, assaultSlowPct: Math.round(slowShare * 100), phase2,
  };
}

// ── his minefield in front of the objective ────────────────────────────────────────────────────────────────────────────

/**
 * The recipe with his protective minefield in front of the Obj (IC s111.5: about 200 m in front of his localities; IC
 * s107: 250-300 m deep), across the axis where it enters the Obj, 600 m wide, hostile, with a Breach lane through it for
 * each assault Coy (2, 120 m apart). Its id gains `-amf`; the recipe passed in is not changed.
 */
export function withAttackMinefield(r: Recipe, doc: DoctrineSet): Recipe {
  if (r.task !== 'attack' || r.enMfAtk) return r;
  const obj = r.slots.find((s) => s.role === 'obj')?.shape?.rect, axis = r.slots.find((s) => s.role === 'axis')?.shape?.pts;
  if (!obj || !axis || axis.length < 2) return r;
  const mid = (v: unknown, fb: number) => { const x = resolveRange(doc, v); return x ? (x[0] + x[1]) / 2 : fb; };
  const off = mid(doctrineAt(doc, 'standoff.obstacleInFrontM'), 200), Dm = Math.round(mid(doctrineAt(doc, 'standoff.protectiveMinefieldDepthM'), 275));
  const w = mid(obj.wM, 1500), h = mid(obj.hM, 700);
  const inObj = (p: [number, number]) => Math.abs(p[0] - obj.acrossM) <= w / 2 && Math.abs(p[1] - obj.backM) <= h / 2;
  const H = axis[axis.length - 1], T = axis[axis.length - 2];
  const L = Math.hypot(H[0] - T[0], H[1] - T[1]) || 1, u: [number, number] = [(H[0] - T[0]) / L, (H[1] - T[1]) / L], n: [number, number] = [-u[1], u[0]];
  let E: [number, number] = [H[0], H[1]];
  for (let t = 0; t <= 4000 && inObj(E); t += 1) E = [H[0] - u[0] * t, H[1] - u[1] * t];
  const c: [number, number] = [E[0] - u[0] * (off + Dm / 2), E[1] - u[1] * (off + Dm / 2)];
  const at = (a: number, b: number): [number, number] => [Math.round(c[0] + n[0] * a + u[0] * b), Math.round(c[1] + n[1] * a + u[1] * b)];
  const W = 600;
  const out: Recipe = JSON.parse(JSON.stringify(r));
  out.slots.push({ role: 'enMfA', kind: 'obstacle', sym: '25270706', label: 'En MF', order: 1, hostile: true, shape: { pts: [at(-W / 2, -Dm / 2), at(W / 2, -Dm / 2), at(W / 2, Dm / 2), at(-W / 2, Dm / 2)] } });
  for (const [k, a] of [['L', -60], ['R', 60]] as const) out.slots.push({ role: `laneAtk${k}`, kind: 'line', sym: '25340200', label: '', order: 2, shape: { base: [at(a - 15, -Dm / 2 - 20), at(a + 15, -Dm / 2 - 20)], ctrl: at(a, Dm / 2 + 20) } });
  out.id = `${r.id}-amf`;
  out.name = `${r.name}, his minefield`;
  out.enMfAtk = { depthM: Dm, lanes: 2 };
  out.note = `${r.note ?? ''} His protective minefield ${Dm} m deep about ${Math.round(off)} m in front of the Obj (IC s111.5, s107), a lane for each assault Coy (PlanAttack.withAttackMinefield).`.trim();
  return out;
}

/** SO's Hbk p 450 (Hand Breaching): the first printed depth (yards) at or over the minefield's, its Pls and hours by light. */
function handBreachTable(engrData: any[] | undefined, depthM: number): { yds: number; pls: number; h: [number, number, number] } | null {
  const t = (engrData ?? []).find((x: any) => /M Fd Breaching - Hand Breaching/i.test(String(x?.title)));
  const yd = depthM / 0.9144;
  const r = t?.rows?.find((x: any) => Number(x['Depth (Yds)']) >= yd);
  if (!r) return null;
  const hm = (hh: unknown, mm: unknown) => Number(hh) + (Number(String(mm).replace(/^9(?=7\.5)/, '0')) || 0) / 60;
  const frac = String(r['Engrs Pl (s)']).replace(' 1/2', '.5');
  return { yds: Number(r['Depth (Yds)']), pls: Number(frac) || 1, h: [hm(r['Day Hrs'], r['Day Mins']), hm(r['Moon lt Hrs'], r['Moon lt Mins']), hm(r['Dark ni Hrs'], r['Dark ni Mins'])] };
}

/**
 * The breach of his minefield before H: by hand (IBB Annex Q para 4: an engineer Pl a 108 m of lane, 4 / 6 h by day /
 * dark night; SO's Hbk p 450 by depth) with the engineers grouped (their Pls: lanes at once, or one after the other),
 * or by TAM (p 451). The quickest way the plan has, its hours and a row; without engineers grouped, the Pls it needs.
 */
export function attackBreach(r: Recipe & { engr?: EngrType & { engrData?: any[] } }, doc: DoctrineSet, night: boolean, engrData?: any[]): { h: number; by: string; row: Check } | null {
  const mf = r.enMfAtk;
  if (!mf) return null;
  const li = night ? 2 : 0;
  const laneM = num(doc, 'crossing.breach.laneM', 108);
  const hrs = (doctrineAt(doc, 'crossing.breach.hours') as any)?.none ?? [4, 5, 6];
  const plsLane = Math.ceil(mf.depthM / laneM), need = plsLane * mf.lanes;
  const e = r.engr ?? null;
  const tbl = handBreachTable(engrData ?? (e as any)?.engrData, mf.depthM);
  const handOne = hrs[li] as number;
  const rounds = e && e.pls ? Math.ceil(need / e.pls) : null;
  const handH = rounds ? handOne * rounds : handOne;
  const tam = e ? tamBreach(e, mf.lanes, mf.depthM, handOne) : null;
  const useTam = !!tam && tam.h < handH && e!.tam >= mf.lanes;
  const h = useTam ? tam!.h : handH;
  const by = useTam ? 'TAM' : 'by hand';
  const book = tbl ? `; SO's Hbk p 450 for ${tbl.yds} yd: ${tbl.pls} Pl${tbl.pls > 1 ? 's' : ''} a lane, ${Math.floor(tbl.h[li])} h ${Math.round((tbl.h[li] % 1) * 60)} min` : '';
  const st: CheckState = !e ? 'warn' : useTam || (e.pls >= need) ? 'pass' : 'warn';
  const head = `his minefield ${mf.depthM} m deep, ${mf.lanes} lanes (one an assault Coy): ${plsLane} engineer Pls a lane, ${handOne} h ${night ? 'by dark night' : 'by day'} (IBB Annex Q para 4)${book}`;
  const who = !e ? `: ${need} engineer Pls needed: group engineers (Engrs row)`
    : useTam ? `; the ${e.name}'s TAMs: about ${Math.round(tam!.h * 60)} min a lane, begun that long before H`
    : e.pls >= need ? `; the ${e.name}'s ${e.pls} Pls do the lanes at once: begun ${handH} h before H`
    : e.pls ? `; the ${e.name} has ${e.pls} Pls for ${need}: the lanes in ${rounds} turns, ${handH} h: begun that long before H, or more engineers` : `; the ${e.name} has no engineer Pls that breach: more engineers`;
  return { h, by: e ? `${e.name}, ${by}` : 'engineers to be grouped', row: { name: 'Breach', st, reason: head + who } };
}

/** Phase 2's timing as a check row: H2 against the time he has to react after Obj 1 falls (IBB p176 c). */
export function phase2Row(h: HSum, doc: DoctrineSet): Check | null {
  const p = h.phase2;
  if (!p) return null;
  const max = num(doc, 'attack.phase2.maxGapMin', 60);
  const slow = p.gapMin > max ? ': he has time to counter-attack or man his depth (IBB p176 c); bring them forward close behind the assault (p186 h(2); attack.phase2.waitAt behind), or shorten their way' : '';
  return {
    name: 'Ph 2 timing', st: p.gapMin <= max ? 'pass' : 'warn',
    reason: `Obj 1 taken ${hRelText(p.obj1At)}; the follow-up Coys' move to FUP 2 ${fmtM(p.marchM)} in ${p.marchMin} min, form up, H2 ${hRelText(p.h2At)}: ${p.gapMin} min after Obj 1 falls (wants ${max} min or less, E)${slow}; on Obj 2 ${hRelText(p.obj2At)}`,
  };
}

/** The night march from the Assy Area to the FUP as a check row. */
export function nightRow(nb: NightBrief): Check {
  const sights = [nb.thermalAtM !== null ? `inside his thermal sights (4 km) ${fmtM(nb.thermalAtM)} from the Assy Area` : null, nb.nightAtM !== null ? `his night sights (1.2 km) ${fmtM(nb.nightAtM)} from it` : null].filter(Boolean);
  return {
    name: 'Night march', st: nb.checks.length || nb.nightAtM !== null ? 'warn' : 'pass',
    reason: `Assy Area to the FUP: ${nb.legs.length} leg${nb.legs.length === 1 ? '' : 's'}, ${fmtM(nb.lengthM)}, ${nb.paces} paces, leave ${hRelText(-nb.leaveBeforeH)} (Night March chart)${sights.length ? `; ${sights.join(', ')}` : ''}${nb.checks.length ? `; ${nb.checks.join('; ')}` : ''}`,
  };
}

/** The H-hour sum as a check row. */
export function hSumRow(h: HSum, doc: DoctrineSet): Check {
  const base = num(doc, 'attack.assaultMinPer100m', 4);
  const pace = h.paceMinPer100m;
  return {
    name: 'H-hour sum', st: 'pass',
    reason: `leave the Assy Area ${hRelText(-h.leaveBeforeH)}${h.night ? ' (night rates, IBB p 18)' : ''}; ${h.steps.filter((s) => s.distM).map((s) => `${s.label.toLowerCase()} ${fmtM(s.distM)} ${s.min} min`).join(', ')}; fire lifts ${h.lifts.map((l) => `${l.rM} m ${hRelText(l.at)}`).join(', ')} (IC s66 p305); on ${h.phase2 ? 'Obj 1' : 'the Obj'} ${hRelText(h.objAt)}${h.phase2 ? `; H2 ${hRelText(h.phase2.h2At)}, fire lifts on Obj 2 ${h.phase2.lifts.map((l) => `${l.rM} m ${hRelText(l.at)}`).join(', ')}, on Obj 2 ${hRelText(h.phase2.obj2At)}` : ''}${h.loeAt !== null ? `, the LOE ${hRelText(h.loeAt)}` : ''} (assault ${pace} min a 100 m${pace > base ? `, slowed by ${h.assaultSlowPct} % SLOW-GO on the axis` : ''}, E)`,
  };
}

// ── his MSR behind the objective ───────────────────────────────────────────────────────────────────────────────────
export interface MsrChoke { at: XY; kind: 'bridge' | 'road'; label: string }

/** A bridge on his MSR behind the objective (else a metalled road), 300 m to 3 km beyond it; plan metres. */
export function findMsrChoke(res: SolveResult, f: FitFrame, g: PlanGround, doc: DoctrineSet): MsrChoke | null {
  // behind the last objective: Obj 2 in a two-phase attack
  const obj = res.items.find((i) => i.role === 'obj2') ?? res.items.find((i) => i.role === 'obj');
  if (!obj) return null;
  const ob = ext(obj.pts), O = centre(obj.pts);
  const beyond = resolveRange(doc, doctrineAt(doc, 'attack.msrChoke.beyondM')) ?? [300, 3000];
  const across = num(doc, 'attack.msrChoke.acrossM', 2500);
  const bridges = new Set<number>((doctrineAt(doc, 'attack.msrChoke.bridgeClasses') as number[]) ?? [39, 40, 41, 42, 43]);
  const roads = new Set<number>((doctrineAt(doc, 'attack.msrChoke.roadClasses') as number[]) ?? [34, 35, 36, 37]);
  let bb: MsrChoke | null = null, bd = Infinity, rb: MsrChoke | null = null, rd = Infinity, known = 0;
  // every 30 m (a bridge is a cell or two of the 30 m grid: a coarser step misses it as the plan turns)
  const step = Math.max(10, num(doc, 'attack.msrChoke.stepM', 30));
  for (let y = ob.y1 + beyond[0]; y <= ob.y1 + beyond[1]; y += step) for (let x = O.x - across; x <= O.x + across; x += step) {
    const w = toWorld(f, P(x, y)); const c = g.cls(w.x, w.y);
    if (c === null) continue;
    known++;
    const d = dist(P(x, y), O);
    if (bridges.has(c) && d < bd) { bd = d; bb = { at: P(x, y), kind: 'bridge', label: g.label(c) }; }
    else if (roads.has(c) && d < rd) { rd = d; rb = { at: P(x, y), kind: 'road', label: g.label(c) }; }
  }
  if (!known) return null;
  return bb ?? rb;
}

// ── his counter-attack onto the objective (reorganisation) ─────────────────────────────────────────────────────────
export interface CounterApch {
  /** Plan metres, from his depth to the objective. */
  path: XY[];
  lengthM: number;
  /** The compass word it comes from, seen from the objective (in the plan frame: plan +y is the enemy's side). */
  from: string;
  /** Share of its last stretch (400-1200 m out) likely in view from the objective; null when not read. */
  seenPct: number | null;
  /** The nearest dead ground to the objective along it, metres from its edge; null when none in the last stretch. */
  deadAtM: number | null;
  /** The DF target on it (plan metres), 600 m out. */
  df: XY | null;
}
export interface CounterRead { apchs: CounterApch[]; mover: 'tracked' | 'dismounted'; row: Check }

const WORDS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** Plan metres to a compass word (the frame's bearing turns plan +y to the ground's). */
const compassOf = (f: FitFrame, from: XY, to: XY) => {
  const a = Math.atan2(to.x - from.x, to.y - from.y) + f.bearing;
  const deg = (((a * 180) / Math.PI) % 360 + 360) % 360;
  return WORDS[Math.round(deg / 45) % 8];
};

/**
 * His counter-attack onto the last objective, for the reorganisation (IBB p189 paras 22-23: the objective organised at
 * once against counter-attack, AT weapons and DF ready; p191: covering likely enemy tank approaches). From his depth
 * (`attack.counter.fromM` beyond the objective, straight behind and 45° either way in the plan frame, where his front
 * faces the own side) the least-cost way in for his mover (tracked for armour or mech, on foot for infantry); each is
 * judged by how much of its last stretch the objective sees (an observer 2 m up on its edge). Ways that join before the
 * last 600 m are one approach. Null without avenues.
 */
export function counterAttack(res: SolveResult, f: FitFrame, g: PlanGround, doc: DoctrineSet, enemyType: string | null): CounterRead | null {
  if (!g.avenues) return null;
  const obj = res.items.find((i) => i.role === 'obj2') ?? res.items.find((i) => i.role === 'obj');
  if (!obj) return null;
  const ob = ext(obj.pts), O = centre(obj.pts);
  const label = obj.label || 'the Obj';
  const mover: 'tracked' | 'dismounted' = enemyType === 'inf' ? 'dismounted' : 'tracked';
  const from = num(doc, 'attack.counter.fromM', 4000), width = num(doc, 'attack.counter.widthM', 500);
  const near = resolveRange(doc, doctrineAt(doc, 'attack.counter.lastStretchM')) ?? [400, 1200];
  const dfAt = num(doc, 'attack.counter.dfOutM', 600);
  const W = (p: XY) => toWorld(f, p);
  const gapOf = (p: XY) => Math.hypot(Math.max(0, ob.x0 - p.x, p.x - ob.x1), Math.max(0, ob.y0 - p.y, p.y - ob.y1));
  const apchs: CounterApch[] = [];
  for (const deg of [0, -45, 45]) {
    const a = (deg * Math.PI) / 180;
    const S = P(O.x + from * Math.sin(a), O.y + from * Math.cos(a));
    const p = g.avenues(W(S), W(O), width, mover)?.[0]?.path;
    if (!p || p.length < 2) continue;
    // every 25 m, so the DF point and the sight samples do not depend on how the way was cut into legs
    const raw = p.map((q) => toLocal(f, q)), path: XY[] = [raw[0]];
    for (let i = 1; i < raw.length; i++) { const k = Math.max(1, Math.ceil(dist(raw[i - 1], raw[i]) / 25)); for (let s = 1; s <= k; s++) path.push(P(raw[i - 1].x + ((raw[i].x - raw[i - 1].x) * s) / k, raw[i - 1].y + ((raw[i].y - raw[i - 1].y) * s) / k)); }
    // the same way in as one already found (they join before the last 600 m)
    const at = (m: number) => { let best: XY | null = null, bd = Infinity; for (const q of path) { const d = Math.abs(gapOf(q) - m); if (d < bd) { bd = d; best = q; } } return best; };
    const entry = at(dfAt);
    if (!entry || apchs.some((x) => x.df && dist(x.df, entry) < 300)) continue;
    // what the objective sees of its last stretch: from its edge nearest each point, 2 m up, a man 1.7 m or a hull 2.3 m
    // dead ground: a run of unseen samples 100 m or longer (deadRunM, E) is where he closes unseen
    const runMin = num(doc, 'attack.counter.deadRunM', 100);
    let n = 0, seen = 0, deadAt: number | null = null, run = 0, runNear = Infinity;
    const endRun = () => { if (run * 25 >= runMin && (deadAt === null || runNear < deadAt)) deadAt = runNear; run = 0; runNear = Infinity; };
    if (g.sight) for (const q of path) {
      const d = gapOf(q);
      if (d < near[0] || d > near[1]) { endRun(); continue; }
      const e = P(Math.max(ob.x0, Math.min(ob.x1, q.x)), Math.max(ob.y0, Math.min(ob.y1, q.y)));
      const we = W(e), wq = W(q);
      const v = g.sight(we.x, we.y, 2, wq.x, wq.y, mover === 'tracked' ? 2.3 : 1.7);
      if (v === null) { endRun(); continue; }
      n++;
      if (v >= 0.5) { seen++; endRun(); } else { run++; runNear = Math.min(runNear, d); }
    }
    endRun();
    apchs.push({ path, lengthM: Math.round(path.slice(1).reduce((s, q, i) => s + dist(path[i], q), 0)), from: compassOf(f, O, S), seenPct: n ? Math.round((100 * seen) / n) : null, deadAtM: deadAt === null ? null : Math.round(deadAt), df: entry });
  }
  if (!apchs.length) return { apchs, mover, row: { name: 'Approaches covered', st: 'unchecked', reason: `no way in for his ${mover === 'tracked' ? 'armour' : 'infantry'} found from his depth onto ${label} (the ground round it is not loaded)` } };
  const read = apchs.filter((x) => x.seenPct !== null);
  const blind = read.filter((x) => x.deadAtM !== null);
  const st: CheckState = !read.length ? 'unchecked' : blind.length ? 'warn' : 'pass';
  const each = apchs.map((x) => `from the ${x.from} (${fmtM(x.lengthM)})${x.seenPct === null ? '' : `, ${x.seenPct} % of its last ${fmtM(near[1])} in view`}${x.deadAtM !== null ? `, dead ground ${fmtM(x.deadAtM)} out: an LP and DF there` : ''}`);
  return {
    apchs, mover,
    row: { name: 'Approaches covered', st, reason: `his counter-attack (${mover === 'tracked' ? 'armour' : 'on foot'}) onto ${label}: ${apchs.length} way${apchs.length === 1 ? '' : 's'} in, ${each.join('; ')}; a DF target on each ${fmtM(dfAt)} out and the AT weapons sited to cover them as it is reorganised (IBB p189 paras 22-23, p191)` },
  };
}

// ── left against right ─────────────────────────────────────────────────────────────────────────────────────────────
export interface Factor { key: string; label: string; w: number; v: number; reason: string }
const stV = (st: CheckState | undefined) => (st === 'pass' ? 1 : st === 'warn' ? 0.5 : st === 'fail' ? 0 : 0.5);

/**
 * The weighed factors for one attack layout (PlanDoctrine attack.compareWeights, E): the form (flank over frontal), how
 * near its LOE comes to his MSR choke, the going, the FUP hidden, the approach hidden from the objective, the BOF's view,
 * the SL, the time from the Assy Area. Each value 0-1 with its reason; the weighted sum 0-100 is the layout's score.
 */
export function attackFactors(layout: string, rows: Check[], res: SolveResult, f: FitFrame | null, g: PlanGround | null, h: HSum | null, choke: MsrChoke | null, route: XY[] | null, doc: DoctrineSet): { factors: Factor[]; score: number } {
  const Wt = (doctrineAt(doc, 'attack.compareWeights') ?? {}) as Record<string, number>;
  const row = (n: string) => rows.find((r) => r.name === n);
  const fs: Factor[] = [];
  const frontal = layout === 'frontal';
  fs.push({ key: 'form', label: 'Form of attack', w: Wt.form ?? 0.15, v: frontal ? 0 : 1, reason: frontal ? 'frontal: dangerous, small chance of success' : 'onto his flank, the BOF fixing his front' });
  const loe = res.items.find((i) => i.role === 'loe');
  if (choke && loe) {
    const d = Math.min(...loe.pts.map((p) => dist(p, choke.at)), dist(centre(loe.pts), choke.at));
    fs.push({ key: 'msrChoke', label: 'Chokes his MSR', w: Wt.msrChoke ?? 0.2, v: d <= 1000 ? 1 : d <= 2500 ? 0.5 : 0, reason: `the LOE ${fmtM(d)} from the ${choke.kind === 'bridge' ? 'bridge' : 'road'} behind the Obj (${choke.label})` });
  } else fs.push({ key: 'msrChoke', label: 'Chokes his MSR', w: Wt.msrChoke ?? 0.2, v: 0.5, reason: g ? 'no bridge or metalled road found 0.3-3 km behind the Obj' : 'needs terrain data' });
  fs.push({ key: 'going', label: 'Going', w: Wt.going ?? 0.1, v: stV(row('Approach going')?.st), reason: row('Approach going')?.reason ?? 'not read' });
  fs.push({ key: 'fupHidden', label: 'FUP hidden', w: Wt.fupHidden ?? 0.15, v: stV(row('FUP unseen')?.st), reason: row('FUP unseen')?.reason ?? 'not read' });
  // the approach (Assy Area to the SL) hidden from the objective
  let hid: number | null = null;
  const obj = res.items.find((i) => i.role === 'obj');
  if (f && g?.sight && obj && route && route.length >= 2) {
    const O = toWorld(f, centre(obj.pts));
    let n = 0, seen = 0;
    for (let i = 1; i < route.length; i++) {
      const L = dist(route[i - 1], route[i]), k = Math.max(1, Math.ceil(L / 250));
      for (let s = 0; s <= k; s++) {
        const p = toWorld(f, P(route[i - 1].x + ((route[i].x - route[i - 1].x) * s) / k, route[i - 1].y + ((route[i].y - route[i - 1].y) * s) / k));
        const v = g.sight(O.x, O.y, 3, p.x, p.y, 1.7);
        if (v === null) continue;
        n++; if (v >= 0.5) seen++;
      }
    }
    hid = n ? 1 - seen / n : null;
  }
  fs.push({ key: 'approachHidden', label: 'Approach hidden', w: Wt.approachHidden ?? 0.15, v: hid ?? 0.5, reason: hid === null ? 'not read' : `${Math.round(hid * 100)} % of the route from the Assy Area likely hidden from the Obj` });
  fs.push({ key: 'bofView', label: 'BOF sees the Obj', w: Wt.bofView ?? 0.1, v: stV(row('BOF sees the Obj')?.st), reason: row('BOF sees the Obj')?.reason ?? 'not read' });
  fs.push({ key: 'sl', label: 'SL on a feature', w: Wt.sl ?? 0.05, v: stV(row('SL a linear feature')?.st), reason: row('SL a linear feature')?.reason ?? 'not read' });
  if (h?.phase2) {
    const max = num(doc, 'attack.phase2.maxGapMin', 60);
    const fu = row('FUP 2 unseen');
    const gapV = h.phase2.gapMin <= max ? 1 : Math.max(0, 1 - (h.phase2.gapMin - max) / 60);
    const fuWord = !fu ? 'not read' : fu.st === 'pass' ? 'hidden from Obj 2' : fu.st === 'warn' ? 'in view of Obj 2' : 'not read';
    fs.push({ key: 'phase2', label: 'Phase 2', w: Wt.phase2 ?? 0.1, v: (stV(fu?.st) + gapV) / 2, reason: `FUP 2 ${fuWord}; H2 ${h.phase2.gapMin} min after Obj 1 falls` });
  }
  const tMin = h?.leaveBeforeH ?? null;
  fs.push({ key: 'time', label: 'Time from the Assy Area', w: Wt.time ?? 0.1, v: tMin === null ? 0.5 : Math.max(0, Math.min(1, 1 - (tMin - 60) / 240)), reason: tMin === null ? 'not worked out' : `leave ${hRelText(-tMin)}` });
  const wsum = fs.reduce((a, x) => a + x.w, 0) || 1;
  return { factors: fs, score: Math.round((100 * fs.reduce((a, x) => a + x.w * x.v, 0)) / wsum) };
}

// ── by night: the Night March chart from the Assy Area to the FUP ──────────────────────────────────────────────────
export interface NightBrief {
  legs: { i: number; bearingDeg: number; distM: number; paces: number; min: number; sight: string }[];
  leaveBeforeH: number;
  marchMin: number;
  /** Metres from the Assy Area where the route comes inside his thermal / night sights; null: never. */
  thermalAtM: number | null;
  nightAtM: number | null;
  checks: string[];
  lengthM: number;
  paces: number;
}

export function nightBrief(route: XY[], objective: XY, f: FitFrame, kind: TerrainKind, R: NmRules): NightBrief | null {
  if (route.length < 2) return null;
  // the Night March engine's points are [x, y] Web Mercator
  const tw = (p: XY): [number, number] => { const w = toWorld(f, p); return [w.x, w.y]; };
  const path = route.map(tw);
  const chart: NightMarchChart = nightMarchChart({ path, objective: tw(objective), echelon: 'battalion', gmaDeg: null, hHourMin: null, terrainKind: kind === 'obstacle' ? 'plains' : kind }, R);
  return {
    legs: chart.legs.map((l) => ({ i: l.i, bearingDeg: Math.round(l.bearingDeg), distM: Math.round(l.distM), paces: l.paces, min: l.minNight, sight: l.sight })),
    leaveBeforeH: chart.timing.leaveBeforeH, marchMin: chart.timing.marchMin,
    thermalAtM: chart.sights?.thermal.enterAtM ?? null, nightAtM: chart.sights?.night.enterAtM ?? null,
    checks: chart.checks.filter((c) => c.tone !== 'ok').slice(0, 4).map((c) => c.text),
    lengthM: Math.round(chart.lengthM), paces: chart.paces,
  };
}
