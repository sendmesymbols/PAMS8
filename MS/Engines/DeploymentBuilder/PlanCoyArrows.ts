/**
 * PlanCoyArrows.ts — PURE. A Bn attack's arrows drawn a Coy each, as the user's traces and the IE solution draw a
 * two-up attack (28 Nov 2026: Appx-I, Ph 1 onto 23r and Gandhi Kot, an arrow and a Coy each): each phase's two assault
 * Coys get their own Main Attack arrow (MS/Symbols/MainAttack.ts), side by side inside the Bn's assault frontage at the
 * tail (IBB S47 para 17 a p 248: two Coys up, 450-650 m), each ending on its own part of the objective.
 *
 * How the symbol is used: CTRL_PTS are the arrow's centre line, three or more points, so MainAttack draws its curved
 * arrow (a Bezier through the left and right offsets, narrowing to the head) and the arrow turns where the Bn axis turns
 * (the fit lays the axis round NO-GO); BASE_LN_PTS, a line across the tail, sets the arrow's width on the ground
 * (GeoTools.tailFactorFromBaseLine gives the TAIL_FACTOR that draws it); HEAD_RATIO the head's length as a share of the
 * arrow's. The Bn axis stays the plan's reference (the H-hour sum, the going, Check my plan read it): it is kept and not
 * drawn.
 *
 * Figures: PlanDoctrine `attack.coyArrows` (the IBB row; the drawing settings M). No ArcGIS, no DOM, no imports but the
 * recipe helpers.
 */
import type { DoctrineSet } from './PlanRecipes';
import { doctrineAt, resolveRange } from './PlanRecipes';

export interface XY { x: number; y: number }
interface Item { role: string; label: string; pts: XY[]; base?: { start: XY; mid: XY; end: XY } }
export interface CoyArrow { role: string; of: string; label: string; pts: XY[]; base: { start: XY; mid: XY; end: XY }; headRatio: number }

const P = (x: number, y: number): XY => ({ x, y });
const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
const num = (doc: DoctrineSet, path: string, fb: number) => { const r = resolveRange(doc, doctrineAt(doc, path)); return r ? (r[0] + r[1]) / 2 : fb; };

/** Each phase: its Bn axis, its objective and the Coys that assault in it. */
const PHASES = [
  { axis: 'axis', obj: 'obj', units: ['asltL', 'asltR'] },
  { axis: 'axis2', obj: 'obj2', units: ['fu1', 'fu2'] },
  { axis: 'axis3', obj: 'obj3', units: ['fu3'] },
];

/** "A, B Coys (from Obj 1)" → ["A Coy", "B Coy"]; "C Coy" → ["C Coy"]. */
export function coysOf(label: string): string[] {
  const m = /^([A-Z])\s*,\s*([A-Z])\s+Coys?\b/.exec(label.trim());
  return m ? [`${m[1]} Coy`, `${m[2]} Coy`] : [label.trim()];
}

/** The centre line resampled to at least `k` points (a straight axis gets a middle point, so MainAttack draws its curve). */
function resample(pts: XY[], k: number): XY[] {
  if (pts.length >= k) return pts.map((p) => ({ ...p }));
  const L = pts.slice(1).reduce((a, p, i) => a + dist(pts[i], p), 0) || 1;
  const out: XY[] = [];
  for (let j = 0; j < k; j++) {
    let left = (L * j) / (k - 1);
    for (let i = 1; i < pts.length; i++) {
      const d = dist(pts[i - 1], pts[i]);
      if (left <= d + 1e-9 || i === pts.length - 1) { const t = d ? Math.min(1, left / d) : 0; out.push(P(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t)); break; }
      left -= d;
    }
  }
  return out;
}

/** The unit right-hand normal at each vertex (facing along the line), averaged over the legs either side. */
function normals(pts: XY[]): XY[] {
  return pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const L = dist(a, b) || 1;
    return P((b.y - a.y) / L, -(b.x - a.x) / L);
  });
}

/** The objective's width across a direction (its points projected on the normal). */
function widthAcross(obj: XY[], n: XY): number {
  const s = obj.map((p) => p.x * n.x + p.y * n.y);
  return Math.max(...s) - Math.min(...s);
}

/**
 * The Coy arrows of every phase that two Coys assault: for each, the Bn axis offset to its side, a quarter of the Bn's
 * assault frontage out at the tail (the two arrows side by side, `attack.coyArrows.gapShare` of it between them), opening
 * to `attack.coyArrows.headSpread` of the objective's width either side at the head (each Coy onto its own part of it),
 * easing out along the axis so the arrows run together from the SL and fan out onto the objective. A phase one Coy
 * assaults keeps its Bn axis drawn. `of` names the axis an arrow stands for.
 */
export function coyArrowsFor(items: Item[], doc: DoctrineSet): CoyArrow[] {
  const at = (role: string) => items.find((i) => i.role === role);
  const gapShare = num(doc, 'attack.coyArrows.gapShare', 0.15);
  const headSpread = num(doc, 'attack.coyArrows.headSpread', 0.25);
  const headRatio = num(doc, 'attack.coyArrows.headRatio', 0.18);
  const out: CoyArrow[] = [];
  for (const ph of PHASES) {
    const ax = at(ph.axis), ob = at(ph.obj);
    if (!ax || !ob || ax.pts.length < 2) continue;
    const labels = ph.units.flatMap((r) => { const u = at(r); return u ? coysOf(u.label).map((l) => ({ l, at: u.pts[0] })) : []; });
    if (labels.length !== 2) continue;
    const path = resample(ax.pts, 3);
    const n = normals(path);
    const L = path.slice(1).reduce((a, p, i) => a + dist(path[i], p), 0) || 1;
    const W = ax.base ? dist(ax.base.start, ax.base.end) : num(doc, 'attack.coyArrows.bnFrontageM', 450);
    const w = (W / 2) * (1 - gapShare);
    // opened no more than `attack.coyArrows.maxFanDeg` off the axis, so a short arrow (phase 2 from PH-I) stays nearly
    // parallel to its neighbour, as the traces draw them
    const fan = Math.tan((num(doc, 'attack.coyArrows.maxFanDeg', 15) * Math.PI) / 180) * L;
    const a0 = W / 4, aH = Math.max(a0, Math.min(a0 + fan, widthAcross(ob.pts, n[n.length - 1]) * headSpread));
    // which Coy on which side: where its unit stands across the axis (left of it, as seen facing the En, goes left);
    // both on one side, or on the axis: the first named on the left
    const side = labels.map((c) => (c.at.x - path[0].x) * n[0].x + (c.at.y - path[0].y) * n[0].y);
    const leftFirst = side[0] <= side[1] + 1;
    const order = leftFirst ? [[labels[0], -1], [labels[1], 1]] as const : [[labels[1], -1], [labels[0], 1]] as const;
    let s = 0;
    const tAt = path.map((p, i) => { if (i) s += dist(path[i - 1], p); return s / L; });
    for (const [c, sg] of order) {
      const pts = path.map((p, i) => { const off = sg * (a0 + (aH - a0) * tAt[i] * tAt[i]); return P(p.x + n[i].x * off, p.y + n[i].y * off); });
      const t0 = pts[0], nt = n[0];
      const base = { start: P(t0.x - nt.x * (w / 2), t0.y - nt.y * (w / 2)), mid: t0, end: P(t0.x + nt.x * (w / 2), t0.y + nt.y * (w / 2)) };
      out.push({ role: `${ph.axis}${sg < 0 ? 'L' : 'R'}`, of: ph.axis, label: c.l, pts, base, headRatio });
    }
  }
  return out;
}
