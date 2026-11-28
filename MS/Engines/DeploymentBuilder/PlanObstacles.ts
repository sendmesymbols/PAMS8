/**
 * PlanObstacles.ts — PURE. The protective minefields wrapped round each defended locality, and the screen in front of a
 * defence, as the user's trace of a Bn defence draws them (28 Nov 2026): minefield panels hugging the front of every
 * forward Coy and closing its open flank, the depth Coy's flanks closed too, patrol lanes left between the panels; a
 * screen across the front with its unit in the gap.
 *
 * Books:
 * - IC s74 para 17 p 394: obstacles in front and on the flanks of the defensive position; para 18 p 394: the
 *   protective minefield planned by the Bn commander, covered by small arms, patrol lanes and passages for the LPs left
 *   in it; para 19 c p 395: minefields in depth to contain a penetration.
 * - IC s107 para 4 b (1) p 596: protective minefields laid close to the FDLs, depth normally up to 250-300 m
 *   (standoff.protectiveMinefieldDepthM); IC s111 para 5 p 651: about 200 m in front of the infantry localities
 *   (standoff.obstacleInFrontM).
 * - IBB S54 para 4 c pp 284-286 (and IC s73 paras 10-15 pp 377-379): screens laterally in front of the main posn, only as far
 *   forward as necessary to deny the En observation of it and its obstacles, troops from the depth Coys; AMP p 1.2:
 *   1-1.5 km ahead of the FDLs (smallOps.screen.fwdM).
 *
 * Shapes: each panel is a band following the locality's curved front (or its side) as CTRL_PTS of the minefield symbol;
 * DRAW_TYPE 1 draws the smooth closed curve through them, so a panel bends with the posn it protects.
 * Plan metres, a box turned `turn` degrees clockwise (PlanSolve's convention). No ArcGIS, no DOM, no imports.
 */
export interface XY { x: number; y: number }
/** A defended locality: centre, width across its front, depth, turned `turn` degrees clockwise. */
export interface WrapBox { role: string; c: XY; w: number; h: number; turn: number }

const P = (x: number, y: number): XY => ({ x, y });
/** A point (u across, v toward the front) of a box turned `deg` clockwise (PlanSolve.boxPt). */
function boxPt(c: XY, u: number, v: number, deg: number): XY {
  const t = (deg * Math.PI) / 180;
  return P(c.x + u * Math.cos(t) + v * Math.sin(t), c.y - u * Math.sin(t) + v * Math.cos(t));
}
/** A plan point in a box's own frame (u across, v toward its front). */
function local(b: WrapBox, p: XY): XY {
  const t = (b.turn * Math.PI) / 180, dx = p.x - b.c.x, dy = p.y - b.c.y;
  return P(dx * Math.cos(t) - dy * Math.sin(t), dx * Math.sin(t) + dy * Math.cos(t));
}
/**
 * The front edge of a Battle Posn outline (PlanSolve.BP_SHAPE: the middle of the front at 0.5 h, its corners 0.46 w
 * across at 0.42 h): v at u, the same curve carried on past the corners.
 */
export const frontV = (b: WrapBox, u: number) => b.h * (0.5 - 0.08 * (u / (0.46 * b.w)) ** 2);

export interface WrapOpts {
  /** Out from the posn's edge to the panel's near edge (IC s111 para 5 p 651: about 200 m). */
  distM: number;
  /** The panel's depth (IC s107 para 4 b (1) p 596: up to 250-300 m). */
  depthM: number;
  /** The gap left as a patrol lane between panels (IC s74 para 18 a p 394: lanes for patrols and the LPs). */
  laneM: number;
  /** A belt along the front. */
  front: boolean;
  /** The flanks closed: the open (outer) one of a row of posns, both, or none. */
  flanks: 'outer' | 'both' | 'none';
  /** Points along each edge of a panel (more: a smoother bend). */
  edgePts?: number;
}

/** Neighbours side by side in a row (same facing, overlapping in depth): the nearest on each side and the edge gap. */
function neighbours(b: WrapBox, row: WrapBox[]) {
  let left: { g: number } | null = null, right: { g: number } | null = null;
  for (const o of row) {
    if (o === b || o.role === b.role) continue;
    if (Math.abs(((o.turn - b.turn + 540) % 360) - 180) > 5) continue;
    const l = local(b, o.c);
    if (Math.abs(l.y) > (b.h + o.h) / 2) continue;
    const g = Math.abs(l.x) - (b.w + o.w) / 2;
    if (l.x > 0 && (!right || g < right.g)) right = { g };
    if (l.x < 0 && (!left || g < left.g)) left = { g };
  }
  return { left, right };
}

/** One panel: the near edge from `a` to `b` (box-frame points), the far edge back, `k` points a side. */
function band(box: WrapBox, near: (s: number) => XY, out: XY, k: number): XY[] {
  const inner: XY[] = [], outer: XY[] = [];
  for (let i = 0; i < k; i++) {
    const s = i / (k - 1), q = near(s);
    inner.push(boxPt(box.c, q.x, q.y, box.turn));
    outer.push(boxPt(box.c, q.x + out.x, q.y + out.y, box.turn));
  }
  return [...inner, ...outer.reverse()];
}

export interface Panel { pts: XY[]; of: string; part: 'front' | 'flank' }

/**
 * The minefield panels round `targets`, each in its own frame. The front belt runs along the posn's curved front
 * `distM` out, split by a patrol lane at its middle; where a neighbour stands beside it in `row`, the belt runs on to the
 * middle of the gap (less half a lane), so the whole front is closed but for the lanes; an open side is closed by a
 * flank panel from the front belt back to a third of the posn's depth behind its centre (the rear left open for the
 * counter-attack: IC p 457 para 17 a (2), areas left for counter-attack).
 */
export function wrapMinefield(targets: WrapBox[], row: WrapBox[], o: WrapOpts): Panel[] {
  const k = Math.max(3, Math.round(o.edgePts ?? 4));
  const out: Panel[] = [];
  const lane = Math.max(0, o.laneM), d = o.distM, D = o.depthM;
  for (const b of targets) {
    const nb = neighbours(b, row);
    if (o.front) {
      // the belt's ends: on to the middle of a gap beside a neighbour, else to the flank panel's line
      const reach = (n: { g: number } | null) => (n ? Math.max(0, n.g / 2 - lane / 2) : d);
      const uL = -(b.w / 2 + reach(nb.left)), uR = b.w / 2 + reach(nb.right);
      const near = (u0: number, u1: number) => (s: number) => { const u = u0 + (u1 - u0) * s; return P(u, frontV(b, u) + d); };
      // a lane at the middle splits the belt in two panels (a narrow posn keeps one)
      if (lane > 0 && b.w > 4 * lane) {
        out.push({ pts: band(b, near(uL, -lane / 2), P(0, D), k), of: b.role, part: 'front' });
        out.push({ pts: band(b, near(lane / 2, uR), P(0, D), k), of: b.role, part: 'front' });
      } else out.push({ pts: band(b, near(uL, uR), P(0, D), k), of: b.role, part: 'front' });
    }
    for (const side of [-1, 1] as const) {
      const open = side < 0 ? !nb.left : !nb.right;
      if (o.flanks === 'none' || (o.flanks === 'outer' && !open)) continue;
      // from the front belt's near edge (less a lane at the corner) back to a third of the depth behind the centre
      const u = side * (b.w / 2 + d);
      const vF = frontV(b, u) + d - (o.front ? lane : 0), vR = -b.h / 3;
      if (vF - vR < 2 * lane) continue;
      const near = (s: number) => P(u, vF + (vR - vF) * s);
      out.push({ pts: band(b, near, P(side * D, 0), k), of: b.role, part: 'flank' });
    }
  }
  return out;
}

/** How long the panels are along their longer side, metres (the protective minefield's length for the engineers' time). */
export function panelsLengthM(panels: { pts: XY[] }[]): number {
  let m = 0;
  for (const p of panels) {
    const half = Math.floor(p.pts.length / 2);
    for (let i = 1; i < half; i++) m += Math.hypot(p.pts[i].x - p.pts[i - 1].x, p.pts[i].y - p.pts[i - 1].y);
  }
  return m;
}

/**
 * The screen across the front of `fwd` (the forward posns), `aheadM` ahead of their front edge: its ends `overlapM`
 * beyond the outer posns' sides, its centre (the gap that carries the unit) over the middle of the front. Three
 * CTRL_PTS as the Screen symbol takes them (end, centre, end); in the plan's own frame (y toward the threat), so a
 * defence whose posns face the front unturned. Null without forward posns.
 */
export function screenAcross(fwd: WrapBox[], aheadM: number, overlapM: number): { pts: XY[]; centre: XY } | null {
  if (!fwd.length) return null;
  const corners = fwd.flatMap((b) => [boxPt(b.c, -b.w / 2, b.h / 2, b.turn), boxPt(b.c, b.w / 2, b.h / 2, b.turn)]);
  const x0 = Math.min(...corners.map((p) => p.x)) - overlapM, x1 = Math.max(...corners.map((p) => p.x)) + overlapM;
  const y = Math.max(...corners.map((p) => p.y)) + aheadM;
  const cx = fwd.reduce((a, b) => a + b.c.x, 0) / fwd.length;
  return { pts: [P(x0, y), P(cx, y), P(x1, y)], centre: P(cx, y) };
}
