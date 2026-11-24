/**
 * PlanSolve.ts — PURE. Lays a recipe out in plan metres and checks it: the Deployment Mgr's Build tab, geometry mode
 * (PlanBuilder_Plan.md Phase 1). No ArcGIS, no DOM: Node runs it (tools/planbuilder-test/solve.mjs).
 *
 * Plan metres: x across the front (right +), y toward the enemy (front +), origin the plan's centre (defence) or the
 * FUP (attack). Recipes write [acrossM, backM], so y = -backM. The Deployment Mgr turns the plan to the bearing the
 * user aims it at and scales it for the latitude, as it does for a sample plan.
 *
 * Without the terrain every ground rule is "unchecked" (grey, never green: safety first), and a slot placed only by
 * the terrain (a killing ground on the approach's chokepoint) is left out and listed.
 *
 * Erasable TypeScript only: Node 24 runs this file as it is.
 */
import type { DoctrineSet, Recipe } from './PlanRecipes';
import { doctrineAt, resolveRange, slotSizeM, frontageRow, FOOTPRINT_KINDS, SMALL_TASKS } from './PlanRecipes';
import { withdrawalGeometryRows } from './PlanWithdrawal';

export type CheckState = 'pass' | 'warn' | 'fail' | 'unchecked';
/** A check laid out for the reader (the cursor card, the Check step, Copy as Text): what was measured, why, what fixes it. */
export interface CheckDetail {
  /** A short headline in place of the reason ("0 of 1 moves in time"). */
  head: string;
  /** One line per thing measured (a move: who, where, the two times). */
  items?: string[];
  /** The cause, in a sentence or two. */
  why?: string;
  /** What would put it right, the most direct first. */
  fix?: string[];
  /** The cursor card's short forms: an item a line ("A Coy → alt (shelled): 22 vs 7 min") and a one-line why. */
  short?: string[];
  whyShort?: string;
}
/** `word`: the verdict's own word where the generic one misleads (a move the enemy beats reads "Too late", not "Fail"). */
export interface Check {
  name: string; st: CheckState; reason: string; detail?: CheckDetail; word?: string;
  /** What was measured and its limit, for a row the ground or the light may judge again (PlanContext.applyContext). */
  m?: number; limitM?: number; limitSrc?: string;
}

/** A check as indented text lines under its row (Copy as Text): its items, why and fixes. */
export function detailLines(c: Check, indent = '      '): string[] {
  const d = c.detail;
  if (!d) return [];
  const L = (d.items ?? []).map((x) => `${indent}- ${x}`);
  if (d.why && c.st !== 'pass') L.push(`${indent}Why: ${d.why}`);
  if (d.fix?.length && c.st !== 'pass') { L.push(`${indent}Fix:`); for (const f of d.fix) L.push(`${indent}  - ${f}`); }
  return L;
}
export interface XY { x: number; y: number }

export interface PlanItem {
  /** Plan-document symbol id: `pb-<role>-<n>`. */
  id: string;
  role: string;
  /** Symbols.json catalog key (8 digits). */
  key: string;
  geo: 'Area' | 'Line' | 'Point' | 'FPoint';
  name: string;
  label: string;
  higher?: string;
  /** 2525D echelon code of the unit or the posn ('14' Pl, '15' Coy). */
  echelon?: string;
  hq?: boolean;
  /** His (SIDC identity 6, hostile): his assumed minefield and wire in front of a water obstacle. */
  hostile?: boolean;
  /** Planned status (SIDC digit 7 = 1): drawn dashed. Alternates. */
  planned?: boolean;
  /** Created hidden (alternates, when the setting says so). */
  hidden?: boolean;
  pts: XY[];
  drawType?: number;
  /** BOF base line, or an axis arrow's base line across its tail (sets its width). */
  base?: { start: XY; mid: XY; end: XY };
  /** Fields copied onto the symbol's draw essentials (HEAD_RATIO, BK_LN_DIST_RATIO ...). */
  extra?: Record<string, unknown>;
}

export interface SlotResult {
  role: string; label: string; kind: string; centre: XY; wM: number; hM: number; turnDeg: number;
  checks: Check[]; st: CheckState;
}

export interface SolveOptions {
  /** Bn localities only, or the Pl posns inside each Coy too. */
  detail?: 'coy' | 'pl';
  alternates?: 'visible' | 'hidden' | 'none';
  /** The terrain fit's moves (PlanFit): plan metres added to a posn's seed, by role. */
  nudges?: Record<string, XY>;
  /** Where the terrain fit put a slot only the ground places (a killing ground): its centre in plan metres, by role. */
  placed?: Record<string, XY>;
  /** Planned posns the what-if adds (PlanWhatIf: supplementary posns, the C Pen posn), drawn dashed like the alternates. */
  extraPosns?: { role: string; key: string; label: string; centre: XY; w: number; h: number; turnDeg: number }[];
  /** A posn's outline shaped to the ground by the fit: BP_SHAPE points as box fractions, by role. */
  outlines?: Record<string, [number, number][]>;
  /** A line's points laid on the ground by the fit (an attack axis round NO-GO: a curve through CTRL_PTS), by role. */
  paths?: Record<string, XY[]>;
  /** Points the fit adds from the ORBAT (ATGM pairs beyond the recipe's, sited on the tank approaches). */
  extraPoints?: { role: string; key: string; label: string; at: XY }[];
  /** The unit has APCs (ORBAT): its reserve moves mounted, at the vehicle rates. */
  mountedReserve?: boolean;
  /** The reserve's pace on foot for this ground (desert / mountains); else cpen.footKmPerH. */
  reserveKmh?: number;
  /** A shape slot laid afresh by the fit (plan metres): its points and base line (a BOF re-sited round the objective). */
  geom?: Record<string, { pts: XY[]; base?: { start: XY; mid: XY; end: XY }; label?: string }>;
}

export interface SolveResult {
  recipe: Recipe;
  /** 'terrain' once PlanFit's checks have been merged in (PlanBuildTab). */
  mode: 'geometry' | 'terrain';
  items: PlanItem[];
  slots: SlotResult[];
  rows: Check[];
  /** Slots left out because only the terrain places them. */
  dropped: { role: string; label: string; why: string }[];
  frontageM: number;
  depthM: number;
  confirm: string[];
  assumptions: string[];
  /** Item the map click lands on (the HQ, or the target on the objective). */
  pivotId: string | null;
  alternates: { of: string; ofLabel: string; label: string; centre: XY; min: number }[];
}

export interface SolveCtx {
  doc: DoctrineSet;
  /** Symbols.json */
  symbols: Record<string, any>;
}

// ── small geometry ───────────────────────────────────────────────────────────────────────────────────────────────
const P = (x: number, y: number): XY => ({ x, y });
const mid = (r: [number, number]) => (r[0] + r[1]) / 2;
const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
/** A point (u across, v toward the front) of a box centred on c, turned `deg` clockwise. */
function boxPt(c: XY, u: number, v: number, deg: number): XY {
  const t = (deg * Math.PI) / 180;
  return P(c.x + u * Math.cos(t) + v * Math.sin(t), c.y - u * Math.sin(t) + v * Math.cos(t));
}
const fromRecipe = (p: [number, number]): XY => P(p[0], -p[1]);
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);

interface Box { role: string; c: XY; w: number; h: number; turn: number }
const boxOverlap = (a: Box, b: Box, pad = 0) => {
  const aw = a.turn % 180 === 90 ? a.h : a.w, ah = a.turn % 180 === 90 ? a.w : a.h;
  const bw = b.turn % 180 === 90 ? b.h : b.w, bh = b.turn % 180 === 90 ? b.w : b.h;
  return Math.abs(a.c.x - b.c.x) < (aw + bw) / 2 + pad && Math.abs(a.c.y - b.c.y) < (ah + bh) / 2 + pad;
};

/**
 * Battle Posn control points (u across, v toward the front, as fractions of the box): a curve round the posn; the
 * segment from the last point back to the first carries the echelon mark (Shapes.createPolylineByLine), and it sits on
 * the REAR side, away from the enemy (user, 15 Nov 2026, with a sketch; both drawn samples do the same). The fit may
 * reshape the curve to the ground (PlanFit `outlines`): a posn follows its high ground and keeps off NO-GO.
 */
export const BP_SHAPE: [number, number][] = [[0.2, -0.5], [0.5, -0.3], [0.46, 0.42], [0, 0.5], [-0.46, 0.42], [-0.5, -0.3], [-0.2, -0.5]];
function battlePosnPts(c: XY, w: number, h: number, turn: number, shape: [number, number][] = BP_SHAPE): XY[] {
  return shape.map(([u, v]) => boxPt(c, u * w, v * h, turn));
}

// ── solve ────────────────────────────────────────────────────────────────────────────────────────────────────────
export function solveRecipe(recipe: Recipe, ctx: SolveCtx, opts: SolveOptions = {}): SolveResult {
  const doc = ctx.doc;
  const num = (v: unknown, fallback = 0) => { const r = resolveRange(doc, v); return r ? mid(r) : fallback; };
  const range = (v: unknown): [number, number] | null => resolveRange(doc, v);
  const items: PlanItem[] = [];
  const counter = new Map<string, number>();
  const nextId = (role: string) => { const n = (counter.get(role) ?? 0) + 1; counter.set(role, n); return `pb-${role}-${n}`; };
  const meta = (key: string) => ctx.symbols[key] ?? null;
  const add = (role: string, key: string, label: string, pts: XY[], more: Partial<PlanItem> = {}): PlanItem | null => {
    const m = meta(key);
    if (!m) return null;
    const it: PlanItem = { id: nextId(role), role, key, geo: m.SymGeoType, name: m.Name ?? '', label, pts, ...more };
    items.push(it);
    return it;
  };
  const dropped: SolveResult['dropped'] = [];
  const isAttack = recipe.task === 'attack';
  // ambush, patrol, recce: laid by shapes here, read and checked by PlanSmallOps over the Movement / Platoon Guides
  const isSmall = SMALL_TASKS.includes(recipe.task);

  // 1. posns that hold ground, at their seeds
  const boxes: Box[] = [];
  const slots: SlotResult[] = [];
  const bySlot = new Map<string, Box>();
  for (const s of recipe.slots) {
    if (!FOOTPRINT_KINDS.includes(s.kind) || !s.seed) continue;
    const z = slotSizeM(doc, s);
    if (!z) continue;
    const turn = ((s.turnDeg ?? 0) % 360 + 360) % 360;
    // slotSizeM already swaps for a 90 / 270 turn; keep the unturned box for drawing
    const w = turn % 180 === 90 ? z.hM : z.wM, h = turn % 180 === 90 ? z.wM : z.hM;
    const seed = fromRecipe([s.seed.acrossM, s.seed.backM]);
    const nudge = opts.nudges?.[s.role];
    const b: Box = { role: s.role, c: nudge ? P(seed.x + nudge.x, seed.y + nudge.y) : seed, w, h, turn };
    boxes.push(b); bySlot.set(s.role, b);
    // a posn taken up when ordered (a canal defence's counter penetration posns) is drawn planned (dashed)
    add(s.role, s.sym, s.label ?? '', battlePosnPts(b.c, w, h, turn, opts.outlines?.[s.role]), { echelon: s.echelon, drawType: 1, extra: { FACE_GAP: 5 }, planned: s.planned || undefined });
    // the unit in its posn: a Pl, Coy or (a Bde's posns) a Bn
    if (s.echelon === '14' || s.echelon === '15' || s.echelon === '16') add(`${s.role}Unit`, '10121100', s.label ?? '', [b.c], { echelon: s.echelon });
    // the Pl posns inside a Coy locality: two up, one back (Pl 600 x 250 m in a 1500 x 700 m Coy, IBB Annex U App 5)
    if (opts.detail === 'pl' && s.echelon === '15') {
      const coyLetter = (s.label ?? '').split(' ')[0];
      [[-0.3, 0.22, '1'], [0.3, 0.22, '2'], [0, -0.22, '3']].forEach(([u, v, n]) => {
        add(`${s.role}Pl`, s.sym, String(n), battlePosnPts(boxPt(b.c, (u as number) * w, (v as number) * h, turn), 0.4 * w, 0.36 * h, turn),
          { echelon: '14', higher: `${coyLetter} Coy`, drawType: 1, extra: { FACE_GAP: 5 } });
      });
    }
    slots.push({ role: s.role, label: s.label ?? s.role, kind: s.kind, centre: b.c, wM: w, hM: h, turnDeg: turn, checks: [], st: 'unchecked' });
  }

  const fwdBoxes = (names: unknown): Box[] => (Array.isArray(names) ? names : [names]).map((n) => bySlot.get(String(n))).filter((b): b is Box => !!b);
  const front = (b: Box) => b.c.y + b.h / 2;                       // front edge (unturned boxes)
  const freeSpot = (want: XY, w = 120, h = 120): XY => {           // nudge a point clear of every posn
    const probe = (p: XY) => !boxes.some((b) => boxOverlap({ role: '', c: p, w, h, turn: 0 }, b, 40));
    if (probe(want)) return want;
    for (let r = 200; r <= 2000; r += 200) for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1], [0, 1], [1, -1], [-1, -1]]) {
      const p = P(want.x + dx * r, want.y + dy * r);
      if (probe(p)) return p;
    }
    return want;
  };

  // 2. the other slots, by their rules or shapes
  let pivotId: string | null = null;
  let tgtN = 0;
  for (const s of recipe.slots) {
    if (FOOTPRINT_KINDS.includes(s.kind)) continue;
    if (s.terrainOnly) {
      // a line only the ground places (an advance's report line at a canal): laid by the fit, with its own label
      const tg = opts.geom?.[s.role];
      if (tg?.pts.length) { add(s.role, s.sym, tg.label ?? s.label ?? '', tg.pts.map((p) => ({ ...p })), { drawType: s.drawType ?? 1 }); continue; }
      const at = opts.placed?.[s.role];
      if (at) {
        // placed by the terrain fit (a killing ground on the main approach): 400 x 300 m round that point (E)
        add(s.role, s.sym, s.label ?? '', [P(at.x - 200, at.y + 150), P(at.x + 200, at.y + 150), P(at.x + 200, at.y - 150), P(at.x - 200, at.y - 150)], { drawType: 2 });
      } else dropped.push({ role: s.role, label: s.label ?? s.role, why: 'placed only on the ground (needs terrain data)' });
      continue;
    }
    const r = (s.rule ?? {}) as Record<string, any>;
    const label = s.label ?? '';
    if (s.shape) {
      const sh = s.shape;
      // the fit's moves for a shape slot (the attack finders: FUP, SL, Assy Area and the units that go with them)
      const nd = opts.nudges?.[s.role];
      const mv = (p: XY): XY => (nd ? P(p.x + nd.x, p.y + nd.y) : p);
      const gm = opts.geom?.[s.role];
      if (gm && gm.pts.length) {
        // laid afresh by the fit (a BOF re-sited round the objective, facing it; an ambush's groups on the road read)
        const it = add(s.role, s.sym, label, gm.pts.map((p) => ({ ...p })), { base: gm.base, extra: sh.base ? { BK_LN_DIST_RATIO: 5, BK_LN_ANGL_RATIO: 5, FRNT_LN_ANGL_RATIO: 5 } : undefined, drawType: sh.rect ? s.drawType ?? 2 : sh.pts && !sh.widthM ? s.drawType ?? 1 : undefined, echelon: sh.at ? s.echelon : undefined, planned: s.planned || undefined });
        if (it && sh.at && (recipe.pivot ? s.role === recipe.pivot : s.role === 'objTgt')) pivotId = it.id;
      } else if (sh.rect) {
        const c = mv(fromRecipe([sh.rect.acrossM, sh.rect.backM])), w = num(sh.rect.wM), h = num(sh.rect.hM);
        add(s.role, s.sym, label, [P(c.x - w / 2, c.y + h / 2), P(c.x + w / 2, c.y + h / 2), P(c.x + w / 2, c.y - h / 2), P(c.x - w / 2, c.y - h / 2)], { drawType: s.drawType ?? 2 });
      } else if (sh.base && sh.ctrl) {
        const a = mv(fromRecipe(sh.base[0])), b = mv(fromRecipe(sh.base[1]));
        add(s.role, s.sym, label, [mv(fromRecipe(sh.ctrl))], { base: { start: a, mid: P((a.x + b.x) / 2, (a.y + b.y) / 2), end: b }, extra: { BK_LN_DIST_RATIO: 5, BK_LN_ANGL_RATIO: 5, FRNT_LN_ANGL_RATIO: 5 } });
      } else if (sh.pts) {
        // the fit may lay it on the ground (a curve round NO-GO); its base line then sits square to its first leg
        const pts = opts.paths?.[s.role]?.length ? opts.paths[s.role].map((p) => ({ ...p })) : sh.pts.map(fromRecipe).map(mv);
        const more: Partial<PlanItem> = { drawType: s.drawType ?? 1 };
        if (sh.widthM != null) {
          // an axis arrow: base line square to the axis across its tail sets the width (MainAttack BASE_LN_PTS)
          const w = num(sh.widthM), t = pts[0], n = pts[1];
          const ax = Math.atan2(n.y - t.y, n.x - t.x) + Math.PI / 2;
          more.base = { start: P(t.x + (w / 2) * Math.cos(ax), t.y + (w / 2) * Math.sin(ax)), mid: t, end: P(t.x - (w / 2) * Math.cos(ax), t.y - (w / 2) * Math.sin(ax)) };
          more.extra = { HEAD_RATIO: '0.15', TAIL_FACTOR: '0.16' };
        }
        add(s.role, s.sym, label, pts, more);
      } else if (sh.at) {
        const it = add(s.role, s.sym, label, [mv(fromRecipe(sh.at))], { echelon: s.echelon, hq: s.role === 'hq', planned: s.planned || undefined });
        // the click lands on the recipe's pivot (an ambush's KZ, a patrol's SP), else the target on the Obj or the HQ
        if (it && (recipe.pivot ? s.role === recipe.pivot : s.role === 'objTgt' || (s.role === 'hq' && !pivotId))) pivotId = it.id;
      }
      if (s.hostile) for (const it of items) if (it.role === s.role) it.hostile = true;
      continue;
    }
    // defence rules
    if (r.joins) {
      const bs = fwdBoxes(r.joins);
      if (r.edge === 'outer') {
        // all round: through the outward face of every posn, round the plan
        const pts = bs.map((b) => boxPt(b.c, 0, b.h / 2, b.turn)).sort((p, q) => Math.atan2(p.y, p.x) - Math.atan2(q.y, q.x));
        if (pts.length >= 3) add(s.role, s.sym, label, [...pts, pts[0]], { drawType: 2 });
      } else {
        const pts = [...bs].sort((a, b) => a.c.x - b.c.x).flatMap((b) => [P(b.c.x - b.w / 2, front(b)), P(b.c.x + b.w / 2, front(b))]);
        if (pts.length >= 2) add(s.role, s.sym, label, pts, { drawType: 1 });
      }
      continue;
    }
    if (r.inFrontOf) {
      const bs = fwdBoxes(r.inFrontOf);
      const d = num(r.distM, 40);
      if (r.depthM != null) {
        // one belt across the front of all of them (protective minefield)
        const depth = range(r.depthM)?.[0] ?? 250;
        const x0 = Math.min(...bs.map((b) => b.c.x - b.w / 2)), x1 = Math.max(...bs.map((b) => b.c.x + b.w / 2));
        const y0 = Math.max(...bs.map(front)) + d;
        if (bs.length) add(s.role, s.sym, label, [P(x0, y0), P(x1, y0), P(x1, y0 + depth), P(x0, y0 + depth)], { drawType: 2 });
      } else {
        for (const b of bs) add(s.role, s.sym, label, [boxPt(b.c, -0.4 * b.w, b.h / 2 + d, b.turn), boxPt(b.c, 0.4 * b.w, b.h / 2 + d, b.turn)], { drawType: 1 });
      }
      continue;
    }
    if (r.perSlot) {
      const d = num(r.ahead, 350);
      // a weapon's alternative (rrAlt: planned, named ...Alt) follows the alternates setting as the posns' alternates do
      const isAlt = !!s.planned && /Alt$/.test(s.role);
      if (isAlt && opts.alternates === 'none') continue;
      for (const b of fwdBoxes(r.perSlot)) add(s.role, s.sym, label, [boxPt(b.c, 0, b.h / 2 + d, b.turn)], { planned: s.planned || undefined, hidden: (isAlt && opts.alternates === 'hidden') || undefined });
      continue;
    }
    if (r.coversGap) {
      const bs = fwdBoxes(r.coversGap).sort((a, b) => a.c.x - b.c.x);
      const apart = range(r.distM)?.[0] ?? 400;
      const n = Math.max(1, Math.round(num(s.count, 2)));
      const spots: XY[] = [];
      for (let i = 1; i < bs.length && spots.length < n; i++) {
        const gx = (bs[i - 1].c.x + bs[i - 1].w / 2 + bs[i].c.x - bs[i].w / 2) / 2, gy = (bs[i - 1].c.y + bs[i].c.y) / 2;
        spots.push(P(gx - apart / 2, gy), P(gx + apart / 2, gy));
      }
      if (!spots.length && bs[0]) spots.push(P(bs[0].c.x - bs[0].w / 2 - 250, bs[0].c.y), P(bs[0].c.x + bs[0].w / 2 + 250, bs[0].c.y));
      spots.slice(0, n).forEach((p) => add(s.role, s.sym, label, [p]));
      continue;
    }
    if (r.centre) { add(s.role, s.sym, label, [freeSpot(P(0, 0))]); continue; }
    if (r.behind) {
      const bs = fwdBoxes(r.behind);
      const rear = Math.min(...boxes.map((b) => b.c.y - b.h / 2));
      const x = bs.length ? bs.reduce((a, b) => a + b.c.x, 0) / bs.length : 0;
      add(s.role, s.sym, label, [freeSpot(P(x + 300, (Math.min(...bs.map((b) => b.c.y - b.h / 2)) + rear) / 2))]);
      continue;
    }
    if (r.ahead != null && r.of) {
      const bs = fwdBoxes(r.of).sort((a, b) => a.c.x - b.c.x);
      if (!bs.length) continue;
      const near = range(r.ahead)?.[0] ?? 550;
      const fy = Math.max(...bs.map(front));
      if (s.count == null && s.role !== 'dfTgt') {          // one point ahead of the middle (standing patrol)
        add(s.role, s.sym, label, [P(bs.reduce((a, b) => a + b.c.x, 0) / bs.length, fy + num(r.ahead))]);
        continue;
      }
      // DF targets: close (the safe minimum ahead of each posn and each gap), then depth, flanks and the likely FUP
      const want = range(s.count)?.[1] ?? bs.length;
      const x0 = bs[0].c.x - bs[0].w / 2, x1 = bs[bs.length - 1].c.x + bs[bs.length - 1].w / 2, span = x1 - x0;
      const cands: XY[] = [];
      for (const b of bs) cands.push(P(b.c.x, front(b) + near));
      for (let i = 1; i < bs.length; i++) cands.push(P((bs[i - 1].c.x + bs[i].c.x) / 2, fy + near));
      for (const b of bs) cands.push(P(b.c.x, fy + 1500));
      cands.push(P(x0 - 500, fy + 800), P(x1 + 500, fy + 800), P(x0 + span * 0.25, fy + 2500), P(x1 - span * 0.25, fy + 2500));
      cands.slice(0, Math.max(1, Math.min(want, cands.length))).forEach((p) => add(s.role, s.sym, `T${++tgtN}`, [p]));
      continue;
    }
    dropped.push({ role: s.role, label: label || s.role, why: 'no geometry rule places it without the terrain' });
  }

  // 3. the HQ (the click lands on it) for a defence
  if (!isAttack && boxes.length) {
    const ech = recipe.echelon;
    // central, between the forward posns and the ones behind them, so the click lands on the middle of the plan
    const kindOf = (b: Box) => recipe.slots.find((s) => s.role === b.role)?.kind;
    const fwd = boxes.filter((b) => kindOf(b) === 'fwd' && b.turn === 0);
    const back = boxes.filter((b) => kindOf(b) === 'depth' || kindOf(b) === 'res');
    const midX = fwd.length ? fwd.reduce((a, b) => a + b.c.x, 0) / fwd.length : 0;
    const fwdRear = fwd.length ? Math.min(...fwd.map((b) => b.c.y - b.h / 2)) : 0;
    const backFront = back.length ? Math.max(...back.filter((b) => b.c.y < fwdRear).map((b) => b.c.y + b.h / 2), fwdRear - 600) : fwdRear - 600;
    const want = fwd.length ? P(midX, (fwdRear + backFront) / 2) : P(0, 0);
    const hq = add('hq', '10121100', ({ '21': 'Div HQ', '18': 'Bde HQ', '16': 'Bn HQ' } as Record<string, string>)[ech] ?? 'Coy HQ', [freeSpot(want, 150, 150)], { echelon: ech, hq: true });
    // the click lands on the HQ unless the recipe names its own pivot (a canal defence: a point on the canal)
    if (hq && !recipe.pivot) pivotId = hq.id;
  }

  // 4. alternates: behind (or beside) each named posn, clear of every posn, planned status
  const alts: SolveResult['alternates'] = [];
  if (opts.alternates !== 'none') {
    for (const a of recipe.alternates ?? []) {
      const b = bySlot.get(a.of);
      if (!b) continue;
      const sp = range(a.spacing) ?? [500, 1000];
      const w = b.w * 0.7, h = b.h * 0.7;
      const tries: [number, number][] = [[0, -1], [-0.7, -0.7], [0.7, -0.7], [-1, 0], [1, 0]];
      let placed: Box | null = null;
      for (const step of [sp[0], (sp[0] + sp[1]) / 2, sp[1]]) {
        for (const [du, dv] of tries) {
          const c = boxPt(b.c, du * step, dv * step, b.turn);
          const cand: Box = { role: `alt-${a.of}`, c, w, h, turn: b.turn };
          if (!boxes.some((o) => boxOverlap(cand, o, 50))) { placed = cand; break; }
        }
        if (placed) break;
      }
      if (!placed) continue;
      boxes.push(placed);
      const letter = (recipe.slots.find((s) => s.role === a.of)?.label ?? a.of).split(' ')[0];
      const echelon = recipe.slots.find((s) => s.role === a.of)?.echelon;
      add('alt', recipe.slots.find((s) => s.role === a.of)?.sym ?? '25151200', `Alt ${letter}`, battlePosnPts(placed.c, w, h, placed.turn),
        { echelon, planned: true, hidden: opts.alternates === 'hidden', drawType: 1, extra: { FACE_GAP: 5 } });
      // the same move the what-if times on the ground (PlanWhatIf.routeOnFoot, shelled): on foot at the GO rate (IPB p 18),
      // half as long again under shelling, + the time to settle; here on open ground, straight
      const perKm = (60 / num(doctrineAt(doc, 'moves.footKmh.go'), 4)) * num(doctrineAt(doc, 'moves.underFireFactor'), 1.5);
      alts.push({ of: a.of, ofLabel: recipe.slots.find((s) => s.role === a.of)?.label ?? a.of, label: `Alt ${letter}`, centre: placed.c, min: Math.round((dist(b.c, placed.c) / 1000) * perKm + num(doctrineAt(doc, 'cpen.settleMin'), 5)) });
    }
  }

  // 4a. points the fit adds from the ORBAT (ATGM pairs beyond the recipe's, on the tank approaches)
  for (const e of opts.extraPoints ?? []) add(e.role, e.key, e.label, [e.at]);

  // 4b. the what-if's posns (supplementary, C Pen): planned, hidden or shown with the alternates
  if (opts.alternates !== 'none') {
    for (const e of opts.extraPosns ?? []) {
      add(e.role, e.key, e.label, battlePosnPts(e.centre, e.w, e.h, e.turnDeg), { planned: true, hidden: opts.alternates === 'hidden', drawType: 1, extra: { FACE_GAP: 5 } });
    }
  }

  // 5. checks
  const rows: Check[] = [];
  const conf: string[] = [];
  const fp = boxes.filter((b) => !b.role.startsWith('alt-'));
  const ext = (list: XY[]) => ({ x0: Math.min(...list.map((p) => p.x)), x1: Math.max(...list.map((p) => p.x)), y0: Math.min(...list.map((p) => p.y)), y1: Math.max(...list.map((p) => p.y)) });
  const allPts = items.filter((i) => !i.planned).flatMap((i) => i.pts);
  let frontageM = 0, depthM = 0;
  const NT = 'needs terrain data';

  if (isSmall) {
    const e = ext(allPts.length ? allPts : [P(0, 0)]);
    frontageM = e.x1 - e.x0; depthM = e.y1 - e.y0;
    // geometry only: what the spacing settles; the ground's checks grey (PlanSmallOps reads them with the terrain)
    const at = (role: string) => items.find((i) => i.role === role);
    const ctr = (it: PlanItem) => P(it.pts.reduce((a, p) => a + p.x, 0) / it.pts.length, it.pts.reduce((a, p) => a + p.y, 0) / it.pts.length);
    const band = (path: string, fb: [number, number]) => range(doctrineAt(doc, path)) ?? fb;
    const grey = (list: [string, string][]) => { for (const [n, why] of list) rows.push({ name: n, st: 'unchecked', reason: `${NT}: ${why}` }); };
    if (recipe.task === 'ambush') {
      const kz = at('kz'), fg = at('ambGp'), rv = at('rv');
      if (kz) rows.push({ name: 'KZ', st: 'pass', reason: `${fmtM(ext(kz.pts).y1 - ext(kz.pts).y0)} along the Rd (E: the length of a Pl's fire)` });
      if (fg && rv) {
        const d = dist(fg.pts[0], rv.pts[0]), b = band('smallOps.ambush.rvM', [750, 900]);
        rows.push({ name: 'RV', st: d >= b[0] - 50 && d <= b[1] + 50 ? 'pass' : 'warn', reason: `${fmtM(d)} back from the fire group (wants ${b[0]}-${b[1]} m, R)` });
      }
      grey([['Target held', 'NO-GO beside the Rd: the En vehicles cannot leave the KZ'], ['Hidden from behind', 'a bend or crest hides the KZ from the En vehicles 300 m behind'], ['KZ in view', 'the fire group sees the whole KZ from cover'], ['Withdrawal', 'covered ground back to the RV'], ['Reinforcements', 'no post or police within 3 km'], ['Village', 'no village within 1 km']]);
      conf.push('The KZ: a stretch the En vehicles cannot leave (a defile, cutting, embankment or canal beside the Rd)');
      conf.push('The fire group: in cover, sees the whole KZ; arcs fixed (a V: the two legs never fire into each other)');
      conf.push('Stop groups: each sees the Rd beyond its end of the KZ; the signal to open fire');
      conf.push('The withdrawal to the RV: covered, walked by day');
    } else if (recipe.task === 'patrol') {
      const obj = at('obj'), frv = at('frv');
      if (obj && frv) {
        const d = dist(ctr(obj), frv.pts[0]), b = band('smallOps.patrol.frvM', [400, 500]);
        rows.push({ name: 'FRV', st: d >= b[0] - 1 && d <= b[1] + 1 ? 'pass' : 'warn', reason: `${fmtM(d)} short of the Obj (wants ${b[0]}-${b[1]} m, R)` });
      }
      rows.push({ name: 'Route in', st: 'pass', reason: 'a different way back from the way out (R)' });
      grey([['Routes', 'round NO-GO, away from roads, villages, wood edges and skylines'], ['Seen', 'the share of the route the enemy may see'], ['Bounds', 'check points on features recognisable at night, 550-750 m apart'], ['Time', 'legs timed by day and night on the ground they cross']]);
      conf.push('Routes out and in on the map and the air photo: legs that end on features recognisable at night');
      conf.push('The FRV: hidden from the Obj, 400-500 m short of it');
      conf.push('Bounds and check points: 550-750 m apart; the paces counted (120 = 100 m)');
    } else {
      const nai = at('nai'), ops = items.filter((i) => /^op\d$/.test(i.role));
      if (nai && ops.length) {
        const c = ctr(nai), b = band('smallOps.recce.opBandM', [600, 2500]);
        const far = ops.map((o) => dist(o.pts[0], c));
        rows.push({ name: 'OP range', st: far.every((d) => d >= b[0] - 1 && d <= b[1] + 1) ? 'pass' : 'warn', reason: `${far.map(fmtM).join(', ')} from the NAI's centre (wants ${fmtM(b[0])}-${fmtM(b[1])}, E)` });
        let apart = Infinity;
        for (let i = 0; i < ops.length; i++) for (let j = i + 1; j < ops.length; j++) apart = Math.min(apart, dist(ops[i].pts[0], ops[j].pts[0]));
        const want = num(doctrineAt(doc, 'smallOps.recce.opsApartM'), 300);
        if (ops.length > 1) rows.push({ name: 'OPs apart', st: apart >= want ? 'pass' : 'warn', reason: `${fmtM(apart)} at the closest (wants ${want} m, E: one shell, one OP)` });
      }
      grey([['NAI seen', 'how much of the NAI the OPs see between them'], ['OP ground', 'high ground and cover at each OP'], ['Routes hidden', 'the routes to the OPs in dead ground']]);
      conf.push('Each OP: sees the NAI by day and with NVD by night');
      conf.push('The routes to the OPs: in dead ground, walked');
      conf.push('Relief, comms back to the base, what to report and when');
    }
  } else if (recipe.task === 'crossing') {
    const e = ext(allPts.length ? allPts : [P(0, 0)]);
    frontageM = e.x1 - e.x0; depthM = e.y1 - e.y0;
    rows.push(...crossingGeometryRows(items, recipe, doc, range, num));
    for (const [n, why] of [['Obstacle', 'its type (IBB Annex P), width, depth, current and banks'], ['Crossing means', 'boats, rafts and the bridge timed on its width (IBB Annex Q)'], ['Observed fire', 'the ground on the far side that sees the crossing places (IBB S46 para 24 p240)'], ['Bridge site', 'the narrowest, lowest-banked place near the planned site, tracks in and out'], ['Approaches and exits', 'the going for tanks to the water and beyond the far bank']] as const) rows.push({ name: n, st: 'unchecked', reason: `${NT}: ${why}` });
    // IC s71 para 5 p362 / IBB S46 para 6: what the recce must find
    conf.push('The En defences and mines on both sides of the obstacle', 'The obstacle: width, depth, current and bed; banks, their height and slope; islands, fords, weirs and sand banks',
      'Subsidiary obstacles, ditches or fences', 'Approaches to and exits from the water for wheels and tracks', 'Crossing places for boats and rafts; the bridge site', 'Concentration area out of the En artillery range (IC s71 para 7 a)');
  } else if (recipe.task === 'advance') {
    // an advance to contact: its own rows (PlanAdvance.advanceRows); the ground ones grey until it is fitted
    const e = ext(allPts.length ? allPts : [P(0, 0)]);
    frontageM = e.x1 - e.x0; depthM = e.y1 - e.y0;
    for (const [n, why] of [['Going on the axis', 'the going for tracks along the axis, from the Main Body to the covering troops'], ['Flank guards\' ground', 'the ground the flank guards stand on']] as const) rows.push({ name: n, st: 'unchecked', reason: `${NT}: ${why}` });
    conf.push('The route on the ground: roads, bridges and their classes (the Move Planner)', 'Bounds, report lines and halting areas along the axis');
  } else if (recipe.task === 'withdrawal') {
    // the old posn's frontage and depth; the control points, embussing points, intermediate posn and artillery by the
    // figures (PlanWithdrawal); the ground's rows grey until the terrain fit reads them
    const fpPts = fp.flatMap((b) => [boxPt(b.c, -b.w / 2, -b.h / 2, b.turn), boxPt(b.c, b.w / 2, b.h / 2, b.turn)]);
    const e = ext(fpPts.length ? fpPts : allPts);
    frontageM = e.x1 - e.x0; depthM = e.y1 - e.y0;
    const wd = withdrawalGeometryRows(items, recipe, doc);
    rows.push(...wd.rows);
    for (const [n, why] of wd.grey ?? [['Routes hidden', 'the routes back in the En view from the threat marker or the En FUP'], ['Behind an obstacle', 'water between the old posn and the intermediate posn']]) rows.push({ name: n, st: 'unchecked', reason: `${NT}: ${why}` });
    conf.push(...wd.confirm);
  } else if (!isAttack) {
    const fpPts = fp.flatMap((b) => [boxPt(b.c, -b.w / 2, -b.h / 2, b.turn), boxPt(b.c, b.w / 2, b.h / 2, b.turn)]);
    const e = ext(fpPts.length ? fpPts : allPts);
    frontageM = e.x1 - e.x0; depthM = e.y1 - e.y0;
    if (recipe.layout === 'canal') {
      // on a canal the frontage is what the forward posns hold on the obstacle; the counter penetration posns (taken up
      // when ordered) are not; the depth from the forward posns' front edge back to the rear of the depth posns
      const kindOf2 = (role: string) => recipe.slots.find((s) => s.role === role)?.kind;
      const fw = fp.filter((b) => kindOf2(b.role) === 'fwd'), dp = fp.filter((b) => kindOf2(b.role) === 'depth' || kindOf2(b.role) === 'res');
      if (fw.length) frontageM = Math.max(...fw.map((b) => b.c.x + b.w / 2)) - Math.min(...fw.map((b) => b.c.x - b.w / 2));
      if (fw.length && dp.length) depthM = Math.max(...fw.map((b) => b.c.y + b.h / 2)) - Math.min(...dp.map((b) => b.c.y - b.h / 2));
    }
    const row = recipe.frontageRow ? frontageRow(doc, recipe.frontageRow) : null;
    const dRow = row ?? (recipe.depthRow ? frontageRow(doc, recipe.depthRow) : null);
    const fr = row ? range(row.frontageM) : null;
    const canal = recipe.layout === 'canal';
    // a canal defence: its frontage and depth from IBB S61 p 333 with Annex V p 483 / App 8 p 484 (PlanDoctrine.canal)
    if (canal) {
      const maxF = num(doctrineAt(doc, 'canal.bnThreeUpMaxM'), 4115), dep = resolveRange(doc, doctrineAt(doc, 'canal.depthM')) ?? [1830, 2750];
      rows.push({ name: 'Frontage', st: frontageM <= maxF + 1 ? 'pass' : 'fail', reason: `${fmtM(frontageM)} held on the obstacle; a Bn three Coys up may cover up to ${fmtM(maxF)} (IBB S61 para 6 p 333, Annex V p 483; IC s85 para 11 p 455 prints 5 km)` });
      rows.push({ name: 'Depth', st: depthM >= dep[0] - 1 ? 'pass' : 'warn', reason: `${fmtM(depthM)} from the obstacle back; Annex V draws ${fmtM(dep[0])}-${fmtM(dep[1])}: greater depth than normal, retained at Bn level at all costs (IBB S61 para 7 p 333)` });
    } else rows.push(fr
      ? { name: 'Frontage', st: frontageM <= fr[1] + 1 ? 'pass' : 'fail', reason: `${fmtM(frontageM)} held; the row allows ${fmtM(fr[1])} (${recipe.frontageRow})` }
      : { name: 'Frontage', st: 'warn', reason: `${fmtM(frontageM)}; no doctrine row for this layout (E)` });
    const dr = dRow?.depthM != null ? range(dRow.depthM) : null;
    if (!canal) rows.push(dr
      ? { name: 'Depth', st: depthM >= dr[0] - 1 && depthM <= dr[1] + 1 ? 'pass' : 'warn', reason: `${fmtM(depthM)}; the row gives ${fmtM(dr[0])}-${fmtM(dr[1])} (${dRow.unit})` }
      : { name: 'Depth', st: 'warn', reason: `${fmtM(depthM)}; no doctrine depth for this layout (E)` });
    const kindOf = (role: string) => recipe.slots.find((s) => s.role === role)?.kind;
    const fwd = fp.filter((b) => kindOf(b.role) === 'fwd' && b.turn === 0).sort((a, b) => a.c.x - b.c.x);
    const sub = recipe.subRow ? frontageRow(doc, recipe.subRow) : null;
    let gmax = 0;
    for (let i = 1; i < fwd.length; i++) gmax = Math.max(gmax, fwd[i].c.x - fwd[i].w / 2 - (fwd[i - 1].c.x + fwd[i - 1].w / 2));
    if (fwd.length > 1) {
      rows.push(sub?.gapM != null
        ? { name: 'Gaps', st: gmax <= sub.gapM * 1.1 + 1 ? 'pass' : 'warn', reason: `widest ${fmtM(gmax)}; the row gives ${fmtM(sub.gapM)}. Close it with mines, fire and patrols` }
        : { name: 'Gaps', st: 'pass', reason: `widest ${fmtM(gmax)} (no gap printed for this row)` });
      const ms = num(doctrineAt(doc, 'checkBands.mutualSupportGapMaxM'), 914);
      // a formation's gaps are covered by fire heavier than MGs: a Bde's by its Bns' 81 mm mortars from both sides, a
      // Div's by its artillery and the depth Bde (no book gap figure for either: E); a Bn's and Coy's by the MGs
      if (recipe.echelon === '18') {
        const mor = num(doctrineAt(doc, 'attack.morRangeM'), 3749);
        rows.push({ name: 'Mutual support', st: gmax <= mor ? 'pass' : 'warn', reason: `widest gap between Bns ${fmtM(gmax)}; the Bns' 81 mm mortars on both sides reach ${fmtM(mor)} (ORBAT), MGs only ${fmtM(ms)}: the gap is covered by mortar fire, mines and patrols (E: no book figure for a gap between Bns)` });
      } else if (recipe.echelon === '21') rows.push({ name: 'Mutual support', st: 'unchecked', reason: `widest gap between Bdes ${fmtM(gmax)}: covered by the Div artillery, mines, patrols and the depth Bde, not by the Bdes' own weapons; the guns' reach is not measured here (site the gun areas on each Bde plan)` });
      else rows.push({ name: 'Mutual support', st: gmax <= ms ? 'pass' : 'warn', reason: `widest gap ${fmtM(gmax)}; both neighbours' MGs sweep up to ${fmtM(ms)} (E)` });
    } else rows.push({ name: 'Gaps', st: 'pass', reason: 'one posn forward' });
    const away = fp.filter((b) => kindOf(b.role) === 'round' && b.c.y < -1);
    rows.push({ name: 'Facing the threat', st: away.length ? 'warn' : 'pass', reason: away.length ? `${away.length} posn${away.length > 1 ? 's face' : ' faces'} away from the threat (all round)` : 'the forward posns face the threat' });
    // reserve to the C Pen posns behind the forward posns
    const resSlot = recipe.slots.find((s) => s.kind === 'res');
    const res = resSlot && bySlot.get(resSlot.role);
    if (res && fwd.length) {
      const back = num(doctrineAt(doc, recipe.echelon === '16' ? 'cpen.behindFwdM.bn' : recipe.echelon === '18' || recipe.echelon === '21' ? 'cpen.behindFwdM.bde' : 'cpen.behindFwdM.coy'), 400);
      const far = Math.max(...fwd.map((b) => dist(res.c, P(b.c.x, b.c.y - b.h / 2 - back))));
      const mountedRes = !!opts.mountedReserve || resSlot?.mounted === true;
      const kmh = mountedRes ? num(doctrineAt(doc, 'moves.tankKmh.go'), 24) : opts.reserveKmh ?? num(doctrineAt(doc, 'cpen.footKmPerH'), 5), settle = num(doctrineAt(doc, 'cpen.settleMin'), 5);
      const min = Math.round((far / 1000) * (60 / kmh) + settle);
      // the reserve's time: a Coy's local counter-attack within 30 min, a Bn's within an hour (IBB S56 para 24 c p 306), a Bde
      // and Div reserve as early as possible within 2-6 h, the check at 2 h (DW pp 26-27) (PlanDoctrine check.reserveMin)
      const want = num(doctrineAt(doc, `check.reserveMin.${recipe.echelon}`), recipe.echelon === '15' ? 30 : recipe.echelon === '16' ? 60 : 120);
      const wantSrc = recipe.echelon === '15' ? ', IBB p 306: a Coy\'s within 30 min' : recipe.echelon === '16' ? ', IBB p 306: the Bn counter-attack within an hour' : recipe.echelon === '18' || recipe.echelon === '21' ? `, ${recipe.echelon === '18' ? 'Bde' : 'Div'} Res as early as possible within 2-6 h (DW pp 26-27)` : '';
      // a Bde reserve with no mobile elements takes a C Pen / reinforcing role, not counter-attack (OOW1 s19 p 83)
      const bdeFoot = recipe.echelon === '18' && !mountedRes ? '; a Bde reserve on foot takes a C Pen or reinforcing role rather than a counter-attack (OOW1 p 83)' : '';
      rows.push({ name: 'Reserve reach', st: min <= want ? 'pass' : 'warn', reason: `${resSlot!.label} to the C Pen posns in ${min} min ${mountedRes ? (resSlot?.mounted && !opts.mountedReserve ? 'on tracks (IPB p 18 vehicle rate)' : 'mounted (the unit\'s APCs, ORBAT; IPB p 18 vehicle rate)') : 'on foot'}, straight line (wants ${want} min${wantSrc})${bdeFoot}` });
      conf.push(`${resSlot!.label}: walk the routes to the C Pen posns and time them`);
    }
    // a formation's reserve share: its reserve slots against its manoeuvre units (measured, judged on the ground by
    // PlanContext.groundNotes: in the desert one third or more, DW p 26)
    if (recipe.echelon === '18' || recipe.echelon === '21') {
      const man = recipe.slots.filter((s) => ['fwd', 'depth', 'res', 'round'].includes(s.kind));
      const resN = man.filter((s) => s.kind === 'res').length;
      if (man.length) {
        const share = resN / man.length;
        rows.push({ name: 'Reserve share', st: 'pass', m: share, limitM: 1 / 3, limitSrc: 'DW p 26', reason: `${resN} of the ${man.length} ${recipe.echelon === '21' ? 'Bdes' : 'Bns'} in reserve (${Math.round(share * 100)} %)${resN ? ` (${man.filter((s) => s.kind === 'res').map((s) => s.label ?? s.role).join(', ')})` : ''}: the reserve to deal with a penetration, located by non-involvement, availability and the most likely En threat (OoW Vol I pp 19-20)` });
      }
    }
    const nFwd = recipe.slots.filter((s) => s.kind === 'fwd').length;
    if (opts.alternates !== 'none') rows.push({ name: 'Alternates', st: alts.length >= Math.min(nFwd, (recipe.alternates ?? []).length) ? 'pass' : 'warn', reason: `${alts.length} placed, clear of the other posns${alts.length ? `; moves ${alts.map((a) => `${a.label} ${a.min} min`).join(', ')}` : ''}` });
    // the Mor Pl as a whole from one posn, split in two sections only if the Bn front cannot be covered from it; on a wide
    // front the sections go into the Coy localities (IBB S13 para 3 p 54, S14 para 10 p 61)
    const morIt = items.find((i) => i.role === 'mor' && i.pts.length);
    if (morIt && fwd.length && (recipe.echelon === '16' || recipe.echelon === '17')) {
      const ahead = num(doctrineAt(doc, 'df.closeMinFromFdlM.mortar'), 550), rMax = num(doctrineAt(doc, 'attack.morRangeM'), 3749);
      const m0 = morIt.pts[0];
      // the DF points `ahead` in front of each forward posn's corners (y toward the enemy: the front edge is c.y + h / 2)
      const far = Math.max(...fwd.flatMap((b) => [boxPt(b.c, -b.w / 2, b.h / 2 + ahead, b.turn), boxPt(b.c, b.w / 2, b.h / 2 + ahead, b.turn)]).map((q) => dist(m0, q)));
      rows.push(far <= rMax
        ? { name: 'Mortars', st: 'pass', reason: `the Mor Pl as a whole: from one posn it reaches ${fmtM(ahead)} in front of every forward posn, ${fmtM(far)} at most of its ${fmtM(rMax)} (ORBAT); employed as a whole, split only if the Bn front cannot be covered from one posn (IBB S13 para 3 p 54)` }
        : { name: 'Mortars', st: 'warn', reason: `from one posn the Mor Pl reaches ${fmtM(rMax)} (ORBAT), the farthest DF ${fmtM(ahead)} in front of the forward posns is ${fmtM(far)} away: the Bn front cannot be covered from one posn (IBB S13 para 3 p 54)`,
          detail: { head: `Mortars short of the flanks by ${fmtM(far - rMax)}`, why: 'The Mor Pl is split in two sections only when the whole Bn frontage cannot be covered from one position (IBB p 54).', fix: ['Split it into two sections, deployed in the Coy localities to cover the whole frontage (IBB S14 para 10 p 61)', 'Or site the Pl further forward, nearer the centre of the front'] } });
    }
    // the RRs: a section of two in each rifle Coy, eight in the Bn; the defence built round them and the MGs, sited first;
    // by day as close to the infantry as safety permits, by night inside the localities; at least one alternative for every
    // rifle, a weapon team's spacing back, with a covered approach between (IBB S8 pp 38-42; IC p 367)
    const rrs = items.filter((i) => i.role === 'rr' && i.pts.length), rrAlts = items.filter((i) => i.role === 'rrAlt' && i.pts.length);
    if (rrs.length && (recipe.echelon === '16' || recipe.echelon === '15')) {
      const inBox = (p: XY, b: Box) => { const t = (b.turn * Math.PI) / 180, dx = p.x - b.c.x, dy = p.y - b.c.y; const u = dx * Math.cos(t) - dy * Math.sin(t), v = dx * Math.sin(t) + dy * Math.cos(t); return Math.abs(u) <= b.w / 2 + 1 && Math.abs(v) <= b.h / 2 + 1; };
      const held = fp.filter((b) => ['fwd', 'round'].includes(recipe.slots.find((s) => s.role === b.role)?.kind ?? ''));
      const out = rrs.filter((r) => !held.some((b) => inBox(r.pts[0], b))).length;
      const sp = range(doctrineAt(doc, 'alt.spacingM.secPl')) ?? [200, 300];
      const paired = rrs.filter((r) => rrAlts.some((a) => { const d = dist(r.pts[0], a.pts[0]); return d >= sp[0] - 25 && d <= sp[1] + 25; })).length;
      const perCoy = num(doctrineAt(doc, 'atFramework.rr.perCoy'), 2), perBn = num(doctrineAt(doc, 'atFramework.rr.perBn'), 8), dir = num(doctrineAt(doc, 'atFramework.rr.directM'), 2000);
      // with no alternates drawn (the setting) the alternatives are left to the plan: said, not judged
      const altsOn = opts.alternates !== 'none';
      const ok = !out && (!altsOn || paired === rrs.length);
      rows.push({ name: 'RR', st: ok ? 'pass' : 'warn', reason: `${rrs.length} RR detachment${rrs.length > 1 ? 's' : ''} in the forward localities (a section of ${perCoy} in each rifle Coy, ${perBn} in the Bn: IBB S8 para 4 p 38, S9 para 1 p 42; ${fmtM(dir)} direct); the defence is built round the RRs and MGs, sited first; by day as close to the infantry as safety permits, by night inside the localities (IBB S8 para 2 e p 41); ${altsOn ? `${paired} of ${rrs.length} with an alternative ${sp[0]}-${sp[1]} m back` : `alternates not drawn (as set): an alternative for every rifle ${sp[0]}-${sp[1]} m away`} covering the same area of fire, a covered approach between (IBB S8 para 2 g p 41; IC p 367)${out ? `; ${out} outside a forward locality` : ''}`,
        ...(ok ? {} : { detail: { head: `${out ? `${out} RR outside the localities` : ''}${out && paired < rrs.length ? '; ' : ''}${paired < rrs.length ? `${rrs.length - paired} RR without an alternative` : ''}`, why: 'Left outside the localities at night the RR is open to infiltrating parties; without an alternative it is lost once its flash gives it away (IBB p 41).', fix: ['Site each RR inside its Coy locality, toward the tank approach', `An alternative ${sp[0]}-${sp[1]} m away for every rifle, covering the same area, with a covered approach to it`] } }) });
    }
    for (const [n, why] of [['Approaches covered', 'the enemy approaches come from the ground'], ['Fields of fire', 'fields of fire and dead ground in front'], ['Flanks', 'whether each flank rests on an obstacle'], ['Exposure', 'what overlooks the posns'], ['Killing Gr', 'the killing ground sits on the approach\'s chokepoint']] as const) {
      if (n === 'Killing Gr' && !dropped.some((d) => d.role === 'killingGr')) continue;
      rows.push({ name: n, st: 'unchecked', reason: `${NT}: ${why}` });
    }
    for (const b of fp) {
      const sr = slots.find((x) => x.role === b.role);
      if (!sr) continue;
      sr.checks.push({ name: 'Ground', st: 'unchecked', reason: `${NT}: going, cover, NO-GO and water at the posn` });
      if (kindOf(b.role) === 'fwd' || kindOf(b.role) === 'round') sr.checks.push({ name: 'Fd of fire', st: 'unchecked', reason: `${NT}: 200 m minimum, 270-500 m wanted (IBB p279, IC s72)` });
      if (b.role === res?.role) { const r0 = rows.find((x) => x.name === 'Reserve reach'); if (r0) sr.checks.push({ ...r0 }); }
      // safety first: a posn whose ground was not checked never reads Pass, whatever else passed
      sr.st = sr.checks.some((c) => c.st === 'fail') ? 'fail' : sr.checks.some((c) => c.st === 'warn') ? 'warn' : sr.checks.some((c) => c.st === 'unchecked') ? 'unchecked' : 'pass';
      conf.push(`${sr.label}: the ground, fields of fire and dead ground in front`);
    }
    if (alts.length) conf.push(`Alternates ${alts.map((a) => a.label).join(', ')}: dug, routes walked, times checked`);
    conf.push('The enemy approaches, and that each is covered by fire');
  } else {
    // attack
    const at = (role: string) => items.find((i) => i.role === role);
    const obj = at('obj'), fup = at('fup'), axis = at('axis'), bof = at('bof'), mor = at('mor'), loe = at('loe'), res = at('res');
    const e = ext(allPts); frontageM = e.x1 - e.x0; depthM = e.y1 - e.y0;
    // the form of attack (user, 14 Nov 2026): frontal only if unavoidable; a flank, the BOF fixing his front
    const form = recipe.layout === 'frontal' ? 'frontal' : /flank/.test(recipe.layout) ? 'flank' : null;
    if (form) rows.push(form === 'frontal'
      ? { name: 'Form of attack', st: 'warn', reason: `${String(doctrineAt(doc, 'attack.form.frontal') ?? 'frontal: only if unavoidable')} (MW p 79)` }
      : { name: 'Form of attack', st: 'pass', reason: `${recipe.layout.replace('-', ' ')}: ${String(doctrineAt(doc, 'attack.form.flank') ?? 'flanking')} (OOW2 s6)` });
    if (obj && fup) {
      const oe = ext(obj.pts), fe = ext(fup.pts);
      // from the FUP's nearest point to the objective's near edge (the FUP may lie on a flank)
      const toBox = (p: XY) => Math.hypot(Math.max(0, oe.x0 - p.x, p.x - oe.x1), Math.max(0, oe.y0 - p.y, p.y - oe.y1));
      const gap = Math.min(...[...fup.pts, P((fe.x0 + fe.x1) / 2, (fe.y0 + fe.y1) / 2)].map(toBox));
      const want = range(doctrineAt(doc, 'attack.fupFromObjM')) ?? [1000, 1200];
      rows.push({ name: 'FUP from the Obj', st: gap >= want[0] && gap <= want[1] ? 'pass' : 'warn', reason: `${fmtM(gap)} to the near edge; IBB p201 wants ${fmtM(want[0])}-${fmtM(want[1])} (tanks ${fmtM(range(doctrineAt(doc, 'attack.tankFupFromObjM'))?.[0] ?? 2500)}+)`, m: gap, limitM: want[0] });
    }
    if (axis?.base) {
      const w = dist(axis.base.start, axis.base.end);
      const row = frontageRow(doc, recipe.assaultRow ?? String(doctrineAt(doc, 'attack.assaultRow') ?? ''));
      const fr = row ? range(row.frontageM) : null;
      rows.push({ name: 'Assault frontage', st: fr && w <= fr[1] + 1 ? 'pass' : 'warn', reason: `${fmtM(w)} wide; ${row ? `${row.unit}: ${fmtM(fr![1])} (${row.src})` : 'no row'}`, m: w, limitM: fr ? fr[1] : undefined, limitSrc: row ? `${row.unit}: ${row.src}` : undefined });
    }
    if (bof && obj && axis) {
      const oc = P((ext(obj.pts).x0 + ext(obj.pts).x1) / 2, (ext(obj.pts).y0 + ext(obj.pts).y1) / 2);
      const bp = bof.pts[0];
      const ae = axis.pts[axis.pts.length - 1];
      const axDir = Math.atan2(ae.y - axis.pts[0].y, ae.x - axis.pts[0].x);
      const bofDir = Math.atan2(oc.y - bp.y, oc.x - bp.x);
      let off = Math.abs(((bofDir - axDir) * 180) / Math.PI) % 360; if (off > 180) off = 360 - off;
      const minDeg = num(doctrineAt(doc, 'attack.bofFlankMinDeg'), 30);
      rows.push({ name: 'BOF on a flank', st: off >= minDeg ? 'pass' : 'warn', reason: `fires ${Math.round(off)}° off the axis of the assault (wants ${minDeg}° or more, E)` });
      const rMax = num(doctrineAt(doc, 'attack.bofRangeMaxM'), 1189);
      const d = dist(bp, oc);
      rows.push({ name: 'BOF range', st: d <= rMax ? 'pass' : 'warn', reason: `${fmtM(d)} to the Obj centre; 106 mm RR reaches ${fmtM(rMax)} (ORBAT)` });
      conf.push('BOF: sees the whole Obj, higher than the assault (needs terrain data)');
    }
    // two phases: the mortars step up to the FUP after phase 1 (IBB p176 d) and reach the LOE beyond Obj 2 from there
    const mor2 = at('mor2');
    const morAt = mor2 ?? mor;
    if (morAt && (loe ?? obj)) {
      const far = Math.max(...(loe ?? obj)!.pts.map((p) => dist(morAt.pts[0], p)));
      const rMax = num(doctrineAt(doc, 'attack.morRangeM'), 3749);
      rows.push({ name: 'Mortars reach the LOE', st: far <= rMax ? 'pass' : 'warn', reason: `${fmtM(far)} to the far end of the ${loe ? 'LOE' : 'Obj'}${mor2 ? ' from their step-up posn short of Obj 1, taken up after phase 1 (IBB p176 d)' : ''}; 81 mm reaches ${fmtM(rMax)} (ORBAT)` });
    }
    rows.push({ name: 'Fire lift', st: 'pass', reason: `fire covers the assault to ${num(doctrineAt(doc, 'fireLiftM.bnMor'), 275)} m (Bn mortars), ${num(doctrineAt(doc, 'fireLiftM.field'), 180)} m (field) from the Obj (IC s66 p305); the last stretch is crossed on the assault's own fire` });
    if (res && obj) {
      const d = dist(res.pts[0], P((ext(obj.pts).x0 + ext(obj.pts).x1) / 2, ext(obj.pts).y0));
      const kmh = num(doctrineAt(doc, 'cpen.footKmPerH'), 5);
      const min = Math.round((d / 1000) * (60 / kmh) + num(doctrineAt(doc, 'cpen.settleMin'), 5));
      const want = num(doctrineAt(doc, 'attack.reserveToObjMin'), 60);
      rows.push({ name: 'Reserve reach', st: min <= want ? 'pass' : 'warn', reason: `${res.label} to the Obj in ${min} min on foot, straight line (wants ${want} min, E)` });
    }
    // two phases (PlanPhase): Obj 2 behind Obj 1, the follow-up Coys round Obj 1 to FUP 2, Obj 1 the firm base
    const obj2 = at('obj2'), fup2 = at('fup2'), axis2 = at('axis2');
    const fus = items.filter((i) => i.role === 'fu1' || i.role === 'fu2');
    if (obj && obj2 && fup2 && axis2) {
      const e1 = ext(obj.pts), e2 = ext(obj2.pts);
      const gapTo = (e: typeof e1, p: XY) => Math.hypot(Math.max(0, e.x0 - p.x, p.x - e.x1), Math.max(0, e.y0 - p.y, p.y - e.y1));
      const c1 = P((e1.x0 + e1.x1) / 2, (e1.y0 + e1.y1) / 2), c2 = P((e2.x0 + e2.x1) / 2, (e2.y0 + e2.y1) / 2);
      const F2 = P(fup2.pts.reduce((a, p) => a + p.x, 0) / fup2.pts.length, fup2.pts.reduce((a, p) => a + p.y, 0) / fup2.pts.length);
      const aslt = items.filter((i) => i.role === 'asltL' || i.role === 'asltR').map((i) => i.label).join(', ');
      const side = F2.x >= c1.x ? 'right' : 'left';
      rows.push({ name: 'Phases', st: 'pass', reason: `Ph 1 ${aslt || 'the assault Coys'} onto Obj 1; Ph 2 ${fus.map((i) => i.label).join(', ') || 'the follow-up Coys'} from FUP 2 round Obj 1's ${side} flank onto Obj 2, from a new direction (IBB p178: objectives and phases; p186: against the En flank, not through the Coys on Obj 1)${res ? `; ${res.label} the Bn reserve (p186 h(3): commit only what the task needs)` : ''}` });
      const band = range(doctrineAt(doc, 'attack.phase2.fup2FromObj2M')) ?? [600, 1200];
      const g2 = gapTo(e2, F2);
      rows.push({ name: 'FUP 2 from Obj 2', st: g2 >= band[0] - 1 && g2 <= band[1] + 1 ? 'pass' : 'warn', reason: `${fmtM(g2)} to Obj 2's near edge (wants ${fmtM(band[0])}-${fmtM(band[1])}, E: beyond the last fire lift, no further out than the FUP)` });
      const clear = num(doctrineAt(doc, 'attack.phase2.clearObj1M'), 300);
      const g1 = Math.min(...[F2, ...fup2.pts].map((p) => gapTo(e1, p)));
      rows.push({ name: 'FUP 2 clear of Obj 1', st: g1 >= clear - 1 ? 'pass' : 'warn', reason: `${fmtM(g1)} off Obj 1 (wants ${clear} m: the follow-up Coys do not pass through the Coys reorganising on it, IBB p186)` });
      // Obj 1, held as the firm base (IBB p189 para 23), fires for phase 2: in reach of Obj 2 and across its axis
      const reach = num(doctrineAt(doc, 'attack.bofRangeMaxM'), 1189);
      const d12 = Math.hypot(Math.max(0, e2.x0 - e1.x1, e1.x0 - e2.x1), Math.max(0, e2.y0 - e1.y1, e1.y0 - e2.y1));
      const a2 = axis2.pts[axis2.pts.length - 1], a1 = axis2.pts[Math.max(0, axis2.pts.length - 2)];
      let off = Math.abs(((Math.atan2(c2.y - c1.y, c2.x - c1.x) - Math.atan2(a2.y - a1.y, a2.x - a1.x)) * 180) / Math.PI) % 360; if (off > 180) off = 360 - off;
      const minDeg = num(doctrineAt(doc, 'attack.bofFlankMinDeg'), 30);
      rows.push({ name: 'Ph 2 fire base', st: d12 <= reach && off >= minDeg ? 'pass' : 'warn', reason: `Obj 1, held as the firm base (IBB p189 para 23), ${fmtM(d12)} from Obj 2 (106 mm RR reaches ${fmtM(reach)}), firing ${Math.round(off)}° across the phase 2 axis (wants ${minDeg}° or more)` });
      conf.push('Obj 2: the En depth posn where the plan puts it (by recce or air photo)');
      conf.push('The follow-up Coys\' way round Obj 1 to FUP 2, walked or seen');
    }
    // tanks (PlanTanks): FUP (Tks) out of his ATGMs' reach, their role; who leads needs his fields of fire (the ground)
    const tkFup = at('tkFup');
    if (obj && tkFup) {
      const e1 = ext(obj.pts);
      const gapTo = (p: XY) => Math.hypot(Math.max(0, e1.x0 - p.x, p.x - e1.x1), Math.max(0, e1.y0 - p.y, p.y - e1.y1));
      const c = P(tkFup.pts.reduce((a, p) => a + p.x, 0) / tkFup.pts.length, tkFup.pts.reduce((a, p) => a + p.y, 0) / tkFup.pts.length);
      const g = Math.min(gapTo(c), ...tkFup.pts.map(gapTo));
      const band = range(doctrineAt(doc, 'attack.tankFupFromObjM')) ?? [2500, 3000];
      rows.push({ name: 'Tank FUP', st: g >= band[0] - 1 && g <= band[1] + 1 ? 'pass' : 'warn', reason: `${fmtM(g)} from the Obj's near edge; IBB p214 wants ${fmtM(band[0])}-${fmtM(band[1])}: out of the En ATGMs' reach (1.5-3.5 km), no common FUP with the infantry` });
      rows.push({ name: 'Tanks', st: 'pass', reason: recipe.tanks === 'close'
        ? 'Close sp (armour heavy): A Sqn less a troop from FUP (Tks) on its own axis converging on the Obj, reaching the infantry\'s assault line with them and rushing the Obj (IBB pp 186-187); a troop covering by observed fire from the BOF\'s flank (p188 c)'
        : 'Fire sp (infantry heavy): A Sqn from FUP (Tks) to fire posns by the BOF, there as the infantry come as close to the Obj, shooting them on (IBB p214 option a)' });
      rows.push({ name: 'Who leads', st: 'unchecked', reason: `${NT}: the En fields of fire along the approach (IBB S35 pp 145-146: open, the tanks; 400-500 m or less, the infantry; 100-200 m, a troop at most)` });
      conf.push('FUP (Tks): out of the En ATGMs\' reach and hidden, tracks in and out (recce)');
    }
    if (!res && fus.length) {
      const bofCoy = at('bofCoy');
      // with tanks: the Sqn, its part in phase 1 done, rallies behind Obj 1 as the Bn's reserve for phase 2 and his
      // counter-attack (IC s105 para 21 b: tanks help break up his counter-attack in the reorganization; E)
      const tk = recipe.tanks ? (recipe.tankSqn ? `the tank Sqn (${recipe.tankSqn.tanks} tanks)` : 'the tank Sqn') : null;
      rows.push(tk
        ? { name: 'Reserve', st: 'pass', reason: `no infantry reserve: the assault Coys on Obj 1, ${fus.map((i) => i.label).join(', ')} on Obj 2${bofCoy ? `, ${bofCoy.label} at the BOF` : ''}; ${tk}, its part in phase 1 done, rallies behind Obj 1 as the Bn's reserve for phase 2 and against the En counter-attack (IC s105 para 21 b; E): tell Bde all the same (IBB p186 i)` }
        : { name: 'Reserve', st: 'warn', reason: `no Bn reserve: the assault Coys on Obj 1, ${fus.map((i) => i.label).join(', ')} on Obj 2${bofCoy ? `, ${bofCoy.label} at the BOF` : ''}: tell Bde (IBB p186 i); Obj 1 holds as the firm base against the En counter-attack (p189 para 23)${recipe.task === 'attack' ? '; or take tanks (Tanks row): the Sqn becomes the reserve after phase 1' : ''}` });
    }
    for (const [n, why] of [['FUP unseen', 'the FUP hidden from the enemy'], ['SL a linear feature', 'a linear feature square to the axis, not behind an obstacle'], ['Approach going', 'the going from the SL to the Obj, dry and wet'], ['Approaches covered', 'the enemy\'s counter-attack approaches onto the Obj']] as const) {
      rows.push({ name: n, st: 'unchecked', reason: `${NT}: ${why}` });
      conf.push(`${n}: ${why}`);
    }
  }
  for (const d of dropped) conf.push(`${d.label}: ${d.why}`);

  const assumptions = isSmall ? [
    'Laid by the rule\'s spacing on open, flat ground: the terrain was not read.',
    recipe.task === 'ambush' ? 'The road runs straight along the aim; the En comes from where the plan is aimed.'
      : recipe.task === 'patrol' ? 'The Obj is where the plan is aimed (the second click); straight routes out and in.'
        : 'The NAI is where the plan is aimed (the second click); the OPs on the own side of it.',
  ] : recipe.task === 'advance' ? [
    'Laid by OoW Vol II Fig 2 spacing (read off a highlighted scan: uncertain) on open, flat ground: the terrain was not read.',
    'The axis runs straight from the SP (the click) in the direction of advance (the aim).',
  ] : recipe.task === 'crossing' ? [
    'Laid by IBB S46 spacing on open, flat ground: the terrain was not read.',
    'The obstacle runs straight across the click, square to the aim; the far bank is where the plan is aimed.',
    'The home bank is secure: the water line is the start line (IBB S46 para 8 f p234).',
  ] : [
    'Laid by doctrinal spacing on open, flat ground: the terrain was not read.',
    isAttack ? 'The objective is ahead, where the plan is aimed.' : 'The threat is ahead, where the plan is aimed.',
    'Ranges from the ORBAT (SO\'s Hbk 2019); frontages from IBB Annex U / IC s113.',
  ];
  return { recipe, mode: 'geometry', items, slots, rows, dropped, frontageM, depthM, confirm: conf, assumptions, pivotId, alternates: alts };
}

/**
 * A crossing laid by its shapes (geometry only, or re-laid along the obstacle by PlanCrossing): the break-in fronts and
 * gaps, phase 1 and the bridgehead against IBB S46 (pp 237-239). Plan metres: y across the obstacle from its centre
 * line (the fit adds the crest distances), so depths here are from the water; PlanCrossing measures them from the bund.
 */
export function crossingGeometryRows(items: PlanItem[], recipe: Recipe, doc: DoctrineSet, range: (v: unknown) => [number, number] | null, num: (v: unknown, fb?: number) => number, farEdgeM = 0, light: 'day' | 'moon' | 'dark' = 'dark'): Check[] {
  const rows: Check[] = [];
  const at = (role: string) => items.find((i) => i.role === role);
  const xs = (it: PlanItem) => it.pts.map((p) => p.x), ys = (it: PlanItem) => it.pts.map((p) => p.y);
  const widthOf = (it: PlanItem) => Math.max(...xs(it)) - Math.min(...xs(it));
  const depthOf = (it: PlanItem) => Math.max(...ys(it)) - farEdgeM;
  const band = (path: string, fb: [number, number]) => range(doctrineAt(doc, path)) ?? fb;
  const inBand = (v: number, b: [number, number], tol = 0.05) => v >= b[0] * (1 - tol) && v <= b[1] * (1 + tol);
  const B = 'crossing.bridgehead.';
  const ech = recipe.echelon;
  if (ech === '16') {
    const fa = at('fupA'), fb = at('fupB'), o1 = at('obj1'), o2 = at('obj2');
    if (fa && fb) {
      const coy = num(doctrineAt(doc, `${B}coyBundM`), 300), front = Math.max(...xs(fb)) - Math.min(...xs(fa)), bf = band(`${B}bnFrontM`, [500, 800]);
      rows.push({ name: 'Fronts', st: inBand(front, bf) ? 'pass' : 'warn', reason: `A and B Coys on ${fmtM(widthOf(fa))} and ${fmtM(widthOf(fb))} of the bund (IC s70 para 4c p358: about ${coy} m each); the Bn front ${fmtM(front)} (IBB S46 para 22 p239: ${bf[0]}-${bf[1]} m)` });
    }
    if (o1) rows.push({ name: 'Phase 1', st: 'pass', reason: `OBJ 1 the bund and ${fmtM(depthOf(o1))} beyond it: the posns that put aimed small arms fire onto the crossing places (IBB S46 para 24 b p240)` });
    if (o2) {
      const d = num(doctrineAt(doc, `${B}bnBreakInDepthM`), 600), w = band(`${B}bnPh2WidthM`, [800, 900]);
      rows.push({ name: 'Bridgehead', st: inBand(depthOf(o2), [d, d], 0.1) ? 'pass' : 'warn', reason: `OBJ 2 ${fmtM(depthOf(o2))} deep, ${fmtM(widthOf(o2))} wide: the break-in to ${d} m deep (IBB S46 para 22 p239; ${w[0]}-${w[1]} m wide for one Bn alone, E)` });
    }
  } else if (ech === '18') {
    const f1 = at('fup1'), f2 = at('fup2'), ph1 = at('ph1'), bh = at('bh');
    if (f1 && f2) {
      const bf = band(`${B}bnFrontM`, [500, 800]), bg = band(`${B}bnGapM`, [500, 600]);
      const gap = Math.min(...xs(f2)) - Math.max(...xs(f1));
      const ok = inBand(widthOf(f1), bf) && inBand(widthOf(f2), bf) && inBand(gap, bg);
      rows.push({ name: 'Fronts', st: ok ? 'pass' : 'warn', reason: `the leading Bns on ${fmtM(widthOf(f1))} and ${fmtM(widthOf(f2))}, ${fmtM(gap)} apart (IBB S46 para 22 p239: ${bf[0]}-${bf[1]} m each, ${bg[0]}-${bg[1]} m between)` });
    }
    if (ph1) {
      const bw = band(`${B}bdePh1WidthM`, [1800, 2000]), bd = band(`${B}bdePh1DepthM`, [300, 600]);
      rows.push({ name: 'Phase 1', st: inBand(widthOf(ph1), bw) && inBand(depthOf(ph1), bd) ? 'pass' : 'warn', reason: `PL 1 ${fmtM(depthOf(ph1))} beyond the bund on ${fmtM(widthOf(ph1))} (IBB S46 para 20 p238: ${bd[0]}-${bd[1]} m on ${fmtM(bw[0])}-${fmtM(bw[1])})` });
    }
    if (bh) {
      const four = recipe.layout === 'four-bn';
      const bw = band(`${B}bdePh2WidthM`, [3500, 4000]), bd: [number, number] = four ? [num(doctrineAt(doc, `${B}bdeFourBnDepthM`), 2500) * 0.9, num(doctrineAt(doc, `${B}bdeFourBnDepthM`), 2500)] : band(`${B}bdePh2DepthM`, [1500, 1800]);
      rows.push({ name: 'Bridgehead', st: inBand(widthOf(bh), bw) && inBand(depthOf(bh), bd, 0.1) ? 'pass' : 'warn', reason: `BH ${fmtM(widthOf(bh))} wide, ${fmtM(depthOf(bh))} deep (IBB S46 paras 20-21 p238: ${fmtM(bw[0])}-${fmtM(bw[1])} by ${four ? 'about 2.5 km with four Bns, para 23 p239' : `${fmtM(bd[0])}-${fmtM(bd[1])}`})` });
    }
  } else {
    // a division: two break-in brigades, the armoured division's bridgehead
    const ph2 = at('ph2'), bh = at('bh');
    if (ph2) {
      const bw = band(`${B}twoBdeWidthM`, [7000, 8000]), bd = band(`${B}twoBdeDepthM`, [1500, 1800]);
      rows.push({ name: 'Break-in', st: inBand(widthOf(ph2), bw) && inBand(depthOf(ph2), bd) ? 'pass' : 'warn', reason: `PL 2 ${fmtM(widthOf(ph2))} by ${fmtM(depthOf(ph2))}: two Bdes on completion of the break-in (IBB S46 para 21 p238: ${fmtM(bw[0])}-${fmtM(bw[1])} by ${fmtM(bd[0])}-${fmtM(bd[1])})` });
    }
    if (bh) {
      const w = widthOf(bh), d = depthOf(bh), km2 = (w * d) / 1e6, need = num(doctrineAt(doc, `${B}divAreaKm2`), 48);
      rows.push({ name: 'Bridgehead', st: km2 >= need * 0.95 ? 'pass' : 'warn', reason: `BH ${fmtM(w)} by ${fmtM(d)}, about ${Math.round(km2)} km2 (IBB S46 para 17 p237: an armoured division group needs about ${need} km2, 8 x 6 km)` });
    }
  }
  // his minefield (PlanCrossing.withMinefield): the lanes through it, timed from Annex Q
  const br = breachRow(recipe, doc, light);
  if (br) rows.push(br);
  return rows;
}

/**
 * The lanes through his assumed minefield (PlanCrossing.withMinefield): IBB Annex Q para 4 p468: one engineer platoon a
 * 108 m of depth, 4 / 5 / 6 h (day / moonlight / dark) for a 108 x 7.2 m lane without viper, 3 / 4 / 4 with baby viper;
 * the next platoon committed every 100 min (40 with viper). A lane of N platoons takes the first's time plus (N - 1)
 * of those steps (my reading of para 4 c, E). The vehicle lanes are needed by H+3-3.5 h (IBB S46 Fig 21 p239).
 */
export function breachRow(recipe: Recipe, doc: DoctrineSet, light: 'day' | 'moon' | 'dark' = 'dark'): Check | null {
  const lanes = recipe.slots.filter((s) => s.sym === '25340200').length;
  const mfSlot = recipe.slots.find((s) => s.role === 'enMf');
  if (!lanes || !mfSlot?.shape?.rect) return null;
  const D = Number(mfSlot.shape.rect.hM) || 950;
  const li = light === 'day' ? 0 : light === 'moon' ? 1 : 2;
  const laneM = Number((doctrineAt(doc, 'crossing.breach.laneM') as number) ?? 108) || 108;
  const hrs = (doctrineAt(doc, 'crossing.breach.hours') as any) ?? { none: [4, 5, 6], viper: [3, 4, 4] };
  const n = Math.ceil(D / laneM);
  const total = hrs.none[li] * 60 + (n - 1) * 100, viper = hrs.viper[li] * 60 + (n - 1) * 40;
  const need = (resolveRange(doc, doctrineAt(doc, 'crossing.lanesH')) ?? [3, 3.5])[1] * 60;
  const hh = (m: number) => `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}`;
  const word = light === 'day' ? 'by day' : light === 'moon' ? 'by moonlight' : 'on a dark night';
  const reason = `${lanes} lane${lanes > 1 ? 's' : ''} through the En minefield ${D} m deep (IBB S47 para 6): ${n} engineer Pls a lane, one a 108 m (Annex Q para 4); ${hrs.none[li]} h for the first ${word}, the next Pl every 100 min: a lane in about ${hh(total)} (baby viper ${hh(viper)}); the vehicle lanes are needed by H+${need / 60} h (IBB Fig 21)`;
  return total <= need ? { name: 'Breach', st: 'pass', reason }
    : { name: 'Breach', st: 'warn', reason, detail: { head: `A lane takes ${hh(total)}`, items: [`${n} Pls in turn, ${hrs.none[li]} h the first, the next every 100 min (my reading of Annex Q para 4 c, E)`, `with baby viper ${hh(viper)}`], why: 'Each 108 m of the En minefield takes an engineer platoon hours, the next only 100 min behind: 900-1000 m of mines does not go in one night with the bridge as well (IBB S47 para 9 c).', whyShort: `${n} Pls a lane, ${hh(total)}`, fix: ['Breach before H, covertly, from the night before', 'Baby viper: the next Pl every 40 min (Annex Q para 4)', 'Trawl tanks: 910 m in about 3.5 h in trials (Annex Q para 5)', 'The assault goes through in file on foot (IC s70 para 4b p356); vehicle lanes after'] } };
}

// ── to a Plan document (what the Deployment Mgr places) ──────────────────────────────────────────────────────────
const R_EARTH = 6378137;
/** Plan metres laid round lon/lat 0,0 (where Web Mercator metres are ground metres); the Deployment Mgr scales the
 *  plan for the latitude it lands at, as it does for an exercise template. */
function ptRaw(p: XY) {
  return { type: 'point', x: (p.x / R_EARTH) * (180 / Math.PI), y: (2 * Math.atan(Math.exp(p.y / R_EARTH)) - Math.PI / 2) * (180 / Math.PI), sp: 'WGS1SP' };
}

/** SIDC for an item: friend (3), the catalog key's symbol set and entity, planned status, HQ and echelon. */
export function sidcFor(it: PlanItem): string {
  const set = it.key.slice(0, 2), entity = it.key.slice(2);
  const status = it.planned ? '1' : '0';
  const hq = it.hq ? '2' : '0';
  const ech = it.echelon && (set === '10' || set === '25') ? it.echelon : '00';
  return `100${it.hostile ? '6' : '3'}${set}${status}${hq}${ech}${entity}0000`;
}

export interface PlanDocOut {
  doc: any;
  /** Symbol ids to create hidden. */
  hidden: string[];
  /** Symbol id → recipe role (`pb.role` on the graphic). */
  roles: Record<string, string>;
  pivotId: string | null;
}

/**
 * The plan as a Plan document (poObj.plnOrdrOverlay[].plnOrdrSymbolSet[]), one overlay for the plan and one for the
 * alternates. `planSymbol` and `planOverlay` are Plan.createSymbol / Plan.createOverlay (passed in so this file stays
 * free of imports the Node checks cannot load). `aimAtOwnSide` turns the plan half round (an attack: click the objective,
 * then aim toward the own side).
 */
export function toPlanDocument(
  res: SolveResult,
  planSymbol: (planId: number, overlayId: string, id: string, drawEss: Record<string, unknown>) => any,
  planOverlay: (planId: number, overlayId: string, name: string, seq: number, symbols: any[]) => any,
  planId = Date.now(),
  opts: { aimAtOwnSide?: boolean; labelSize?: number } = {},
): PlanDocOut {
  // An attack is aimed from the objective back toward the own side: turn the plan half round so the aiming click
  // (the Deployment Mgr points the plan's top at it) falls on the side the attack comes from.
  const pt = opts.aimAtOwnSide ? (p: XY) => ptRaw(P(-p.x, -p.y)) : ptRaw;
  const main: any[] = [], alt: any[] = [];
  const hidden: string[] = [], roles: Record<string, string> = {};
  for (const it of res.items) {
    const sidc = sidcFor(it);
    const de: Record<string, unknown> = {
      SYM_GEO_TYPE: it.geo, SID: it.key.slice(2), SYM_NAME: it.name, SIDC: sidc, opacity: 1,
      // the designation labels (A Coy, T1, FUP) at the size the Build tab asks for (planBuilder.labelSize)
      labelOptions: opts.labelSize ? { textSize: opts.labelSize } : {},
    };
    if (it.geo === 'FPoint') {
      de.OPTIONS = { ANGLE: 0, size: 25, additionalInformation: '', higherFormation: it.higher ?? '', hfid: '', ph: '', sl: '', atkl: '', staffComments: '', uniqueDesignation: it.label, uniqueDesignationID: '', GEOM: pt(it.pts[0]) };
      de.GEOM = pt(it.pts[0]);
      de.AMPLIFIER = {};
      de.UEI = '1';
    } else {
      de.AMPLIFIER = { UNIQUE_DESIG: it.label || ' ', UNIQUE_DESIG_ID: '', HIGHER_FORM: it.higher ?? '', hfid: '', STAFF_COM: '', ADDL_INFO: '', MULTI_LINE_LABEL_TEXT: '', MULTI_LINE_LABEL_COLOR: '#000000', MULTI_LINE_LABEL_ALIGN: 'center' };
      if (it.geo === 'Point') { de.GEOM = pt(it.pts[0]); de.SIZE = 25; de.ANGLE = 0; }
      else {
        de.CTRL_PTS = it.pts.map(pt);
        if (it.drawType != null) de.DRAW_TYPE = it.drawType;
        if (it.echelon && it.geo === 'Area') de.ECHELON = it.echelon;
        if (it.base) de.BASE_LN_PTS = { startPt: pt(it.base.start), midPt: pt(it.base.mid), endPt: pt(it.base.end) };
      }
    }
    Object.assign(de, it.extra ?? {});
    const sym = planSymbol(planId, it.planned ? 'pb-alternates' : 'pb-plan', it.id, de);
    (it.planned ? alt : main).push(sym);
    roles[it.id] = it.role;
    if (it.hidden) hidden.push(it.id);
  }
  const overlays = [planOverlay(planId, 'pb-plan', res.recipe.name, 1, main)];
  if (alt.length) overlays.push(planOverlay(planId, 'pb-alternates', `${res.recipe.name}: alternates`, 2, alt));
  return { doc: { poObj: { plnOrdrOverlay: overlays }, pamsOrigin: { x: 0, y: 0 } }, hidden, roles, pivotId: res.pivotId };
}

// ── Copy as Text ─────────────────────────────────────────────────────────────────────────────────────────────────
const WORD: Record<CheckState, string> = { pass: 'Pass', warn: 'Warn', fail: 'Fail', unchecked: 'Not checked' };
export function planText(res: SolveResult, unitLine = '', triggers: string[] | null = null): string {
  const r = res.recipe;
  const L: string[] = [];
  L.push(`${r.name.toUpperCase()} (baseline, ${res.mode === 'terrain' ? 'fitted to the ground where it was placed: confirm on the ground' : 'GEOMETRY ONLY: ground not checked'})`);
  if (unitLine) L.push(unitLine);
  L.push(SMALL_TASKS.includes(r.task) ? `Spread ${fmtM(res.frontageM)} across, ${fmtM(res.depthM)} along.` : `Frontage ${fmtM(res.frontageM)}, depth ${fmtM(res.depthM)}.`);
  L.push('');
  const units = res.items.filter((i) => i.geo === 'FPoint' || (i.geo === 'Area' && /^(fwd|depth|res|round|north|east|south|west|front|rtRear|ltRear|fwd[LCR]|depth[LR])$/.test(i.role)));
  if (res.slots.length) {
    L.push('POSNS');
    for (const s of res.slots) L.push(`  ${s.label.padEnd(8)} ${(r.slots.find((x) => x.role === s.role)?.kind ?? '').padEnd(6)} ${WORD[s.st]}`);
  } else if (units.length) {
    L.push('ELEMENTS');
    for (const u of res.items.filter((i) => i.geo === 'FPoint')) L.push(`  ${u.label}`);
  }
  L.push('');
  L.push('CHECKS');
  for (const c of res.rows) { L.push(`  ${c.name.padEnd(20)} ${(c.word ?? WORD[c.st]).padEnd(11)} ${c.reason}`); L.push(...detailLines(c)); }
  if (triggers && triggers.length) {
    L.push('');
    L.push(({ attack: 'H-HOUR SUM, FIRE LIFTS, NIGHT MARCH AND WEIGHED FACTORS', ambush: 'THE SITE (what scored) AND BETTER SITES ALONG THE RD', patrol: 'ROUTE CARD (out and in)', recce: 'OPS', crossing: 'TIMELINE FROM H (IBB Annex Q), THE BRIDGE SITE, HIS OBSERVERS' } as Record<string, string>)[r.task] ?? "TRIGGERS (who moves, route, own time against the enemy's)");
    for (const t of triggers) L.push(t);
  } else if (res.alternates.length) {
    L.push('');
    L.push('TRIGGERS');
    for (const a of res.alternates) L.push(`  Heavy shelling on ${a.ofLabel}: ${a.ofLabel} -> ${a.label}, ${a.min} min`);
  }
  if (res.dropped.length) {
    L.push('');
    L.push('NOT PLACED');
    for (const d of res.dropped) L.push(`  ${d.label}: ${d.why}`);
  }
  L.push('');
  L.push('CONFIRM ON THE GROUND');
  for (const c of res.confirm) L.push(`  - ${c}`);
  L.push('');
  L.push('ASSUMED');
  for (const a of res.assumptions) L.push(`  - ${a}`);
  return L.join('\n');
}
