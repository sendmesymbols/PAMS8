/**
 * PlanShape.ts — PURE. A Battle Posn's outline bent to the ground (user, 15 Nov 2026), its size and shape kept as the
 * annex draws it (user, 27 Nov 2026: turning and stretching posns round features "messes up the whole layout"): each
 * point of the curve moves in or out by up to a quarter of the posn's half-size, out over higher ground and in off
 * obstacles (NO-GO on foot, water, built-up areas), and never into another posn's curve. The echelon segment (the
 * first and last points of BP_SHAPE, the rear side) stays. An ITG is taken by moving the whole posn (PlanFit), not by
 * stretching its curve.
 *
 * Plan metres: x across the front (right +), y toward the enemy. Box metres: (u, v) before the posn's own turn.
 * Erasable TypeScript only: Node runs this file as it is (tools/planbuilder-test/shape.mjs).
 */
import { BP_SHAPE } from './PlanSolve';

export interface XY { x: number; y: number }
export interface ShapeBox { role: string; c: XY; w: number; h: number; turn: number }

export interface ShapeGround {
  /** World point of a plan point. */
  toWorld(p: XY): XY;
  cls(x: number, y: number): number | null;
  elev(x: number, y: number): number;
  /** Ground classes the curve keeps off: water, NO-GO on foot, built-up areas. */
  water: ReadonlySet<number>;
  nogo: ReadonlySet<number>;
  bua: ReadonlySet<number>;
}

export interface ShapeParams {
  /** The scales a point of the curve may take, and the height a tenth of the way is worth. */
  scales: [number, number];
  perTenthM: number;
  /** How far a point of the curve keeps from another posn's curve. */
  clearM: number;
}

const P = (x: number, y: number): XY => ({ x, y });
const rad = (d: number) => (d * Math.PI) / 180;
/** A box-frame point to plan metres (the posn's own turn, clockwise), as PlanSolve.boxPt. */
export const boxPt = (b: ShapeBox, u: number, v: number): XY => {
  const t = rad(b.turn);
  return P(b.c.x + u * Math.cos(t) + v * Math.sin(t), b.c.y - u * Math.sin(t) + v * Math.cos(t));
};
/** Distance from a plan point to a box (0 inside); a box turned 90 / 270 swaps its sides. */
export const boxDist = (b: ShapeBox, p: XY): number => {
  const sw = b.turn % 180 === 90, hw = (sw ? b.h : b.w) / 2, hh = (sw ? b.w : b.h) / 2;
  return Math.hypot(Math.max(0, Math.abs(p.x - b.c.x) - hw), Math.max(0, Math.abs(p.y - b.c.y) - hh));
};
export const insidePoly = (poly: XY[], p: XY): boolean => {
  let k = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) k = !k;
  }
  return k;
};
const segDist = (p: XY, a: XY, b: XY): number => {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};
/** Distance from a point to a closed curve's edge, negative inside it. */
export const polyDist = (poly: XY[], p: XY): number => {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, segDist(p, poly[j], poly[i]));
  return insidePoly(poly, p) ? -d : d;
};
/** A posn's curve in plan metres (its outline as box fractions, or BP_SHAPE). */
export const curveOf = (b: ShapeBox, outline: [number, number][] | null = null): XY[] => (outline ?? BP_SHAPE).map(([u, v]) => boxPt(b, u * b.w, v * b.h));

/**
 * Bend one posn's curve. `others`: the other posns' curves as they stand (plan metres): a point never comes nearer
 * one than `clearM`, nor inside it. Null when the curve stays as drawn.
 */
export function shapePosn(b: ShapeBox, others: XY[][], g: ShapeGround, pr: ShapeParams): [number, number][] | null {
  const at = (u: number, v: number) => g.toWorld(boxPt(b, u, v));
  const blocked = (u: number, v: number) => {
    const p = boxPt(b, u, v);
    if (others.some((c) => polyDist(c, p) < pr.clearM)) return true;
    const w = g.toWorld(p), c = g.cls(w.x, w.y);
    return c !== null && (g.water.has(c) || g.nogo.has(c) || g.bua.has(c));
  };
  // the posn's mean height (5 x 3 samples)
  let es = 0, en = 0;
  for (const u of [-0.4, -0.2, 0, 0.2, 0.4]) for (const v of [-0.3, 0, 0.3]) { const w = at(u * b.w, v * b.h), e = g.elev(w.x, w.y); if (Number.isFinite(e)) { es += e; en++; } }
  const e0 = en ? es / en : NaN;
  const scales = [1, 0.88, 1.12, pr.scales[0], pr.scales[1]];
  let changed = false;
  const out = BP_SHAPE.map(([u, v], i): [number, number] => {
    if (i === 0 || i === BP_SHAPE.length - 1) return [u, v];
    let bestS = 1, bestScore = -Infinity;
    for (const s of scales) {
      if (blocked(s * u * b.w, s * v * b.h)) continue;
      const w = at(s * u * b.w, s * v * b.h), e = g.elev(w.x, w.y);
      const score = (Number.isFinite(e) && Number.isFinite(e0) ? Math.max(-15, Math.min(15, e - e0)) : 0) - pr.perTenthM * 10 * Math.abs(s - 1);
      if (score > bestScore) { bestScore = score; bestS = s; }
    }
    if (!Number.isFinite(bestScore)) bestS = pr.scales[0];   // every spot blocked: in as far as it goes
    if (bestS !== 1) changed = true;
    return [u * bestS, v * bestS];
  });
  return changed ? out : null;
}
