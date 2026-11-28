/**
 * PlanPhase.ts — PURE. The two-phase attack (PlanBuilder_Plan.md §9.2, layout "two-phase"; IBB S39-S42).
 *
 * Phase 1 is the layout as it stands (frontal, right or left flank): A and B Coys from the FUP onto Obj 1, the BOF
 * fixing. The follow-up Coys wait 500-750 m behind them, move up into the FUP when they leave it and stay there until
 * Obj 1 is taken (IBB p204 (7)); then they go round Obj 1's flank, not through the Coys reorganising on it, form up
 * again at FUP 2 and attack Obj 2 from a new direction, onto its flank (IBB p186 h: against his flank or rear, to
 * exploit success and not to redeem failure; p176 c: at once, before he can react). Obj 1 is held as the firm base and
 * fires for phase 2 (p189 para 23); the mortars step up to the FUP (p176 d).
 *
 * - `twoPhaseRecipe`: any Bn Attk layout with Obj 2, FUP 2, SL 2, the phase 2 axis, the follow-up Coys and the
 *   mortars' step-up posn, laid by geometry (no terrain needed);
 * - `layPhase2`: phase 2's control measures for one side round Obj 1;
 * - `findPhase2`: on the ground, Obj 2 (a hostile posn drawn behind Obj 1, else his depth on higher ground, else
 *   straight behind), the side round Obj 1 (FUP 2 hidden from Obj 2, the shorter way, the going, nearer his MSR) and
 *   the follow-up Coys' way round NO-GO.
 *
 * Figures: PlanDoctrine `attack.phase2` (the IBB pages and the E proposals). No ArcGIS, no DOM.
 */
import type { DoctrineSet, Recipe, RecipeSlot } from './PlanRecipes';
import { doctrineAt, resolveRange } from './PlanRecipes';
import type { Check, CheckState, SolveResult, XY } from './PlanSolve';
import { toLocal, toWorld, type FitFrame, type PlanGround } from './PlanFit';
import { simplify, type MsrChoke } from './PlanAttack';
import { phaseLineLabel } from './PlanPhaseLine';

const P = (x: number, y: number): XY => ({ x, y });
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
const centre = (pts: XY[]) => P(pts.reduce((a, p) => a + p.x, 0) / pts.length, pts.reduce((a, p) => a + p.y, 0) / pts.length);
const unit = (v: XY) => { const L = Math.hypot(v.x, v.y) || 1; return P(v.x / L, v.y / L); };
const rot = (v: XY, a: number) => P(v.x * Math.cos(a) - v.y * Math.sin(a), v.x * Math.sin(a) + v.y * Math.cos(a));
const lenOf = (pts: XY[]) => pts.slice(1).reduce((a, p, i) => a + dist(pts[i], p), 0);
const WATER = new Set([4, 5, 20, 21, 22, 46]);
const num = (doc: DoctrineSet, path: string, fb: number) => { const r = resolveRange(doc, doctrineAt(doc, path)); return r ? (r[0] + r[1]) / 2 : fb; };
const rng = (doc: DoctrineSet, path: string, fb: [number, number]): [number, number] => resolveRange(doc, doctrineAt(doc, path)) ?? fb;
const sideWord = (s: 1 | -1) => (s === 1 ? 'right' : 'left');

/** An axis-aligned box in plan metres (an objective). */
export interface Box { c: XY; w: number; h: number }
export const boxOf = (pts: XY[]): Box => {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return { c: P((x0 + x1) / 2, (y0 + y1) / 2), w: x1 - x0, h: y1 - y0 };
};
/** From a point to a box's nearest edge (0 inside). */
export const boxGap = (b: Box, p: XY) => Math.hypot(Math.max(0, Math.abs(p.x - b.c.x) - b.w / 2), Math.max(0, Math.abs(p.y - b.c.y) - b.h / 2));
/** Edge to edge between two boxes. */
export const boxesGap = (a: Box, b: Box) => Math.hypot(Math.max(0, Math.abs(a.c.x - b.c.x) - (a.w + b.w) / 2), Math.max(0, Math.abs(a.c.y - b.c.y) - (a.h + b.h) / 2));
/** From a box's centre to its edge along a unit direction. */
const along = (b: Box, u: XY) => Math.min(Math.abs(u.x) > 1e-9 ? b.w / 2 / Math.abs(u.x) : Infinity, Math.abs(u.y) > 1e-9 ? b.h / 2 / Math.abs(u.y) : Infinity);
/** The least distance from a polyline to a box, every 50 m. */
export const pathGap = (pts: XY[], b: Box) => {
  let m = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], c = pts[i], n = Math.max(1, Math.ceil(dist(a, c) / 50));
    for (let k = 0; k <= n; k++) m = Math.min(m, boxGap(b, P(a.x + ((c.x - a.x) * k) / n, a.y + ((c.y - a.y) * k) / n)));
  }
  return m;
};

// ── phase 2's control measures for one side ──────────────────────────────────────────────────────────────────────
export interface Phase2Lay {
  side: 1 | -1;
  /** How far off the line he faces phase 2 comes onto Obj 2 (opened out when FUP 2 would sit too near Obj 1). */
  offDeg: number;
  fup2: XY;
  /** FUP 2 (a line across the phase 2 axis), SL 2 at its forward edge, the axis into Obj 2, the LOE beyond it. */
  fupPts: XY[]; slPts: XY[]; axis: XY[]; loePts: XY[];
  /** The follow-up Coys' way from the FUP round Obj 1 to FUP 2, straight legs (the ground may bend them). */
  via: XY[];
  /** FUP 2 to Obj 2's and to Obj 1's nearest edge. */
  gap2: number; gap1: number;
}

/**
 * Lay phase 2 round Obj 1 on one side: FUP 2 on a line `offDeg` off the one he faces (from Obj 2 toward Obj 1),
 * 1000-1200 m from Obj 2 (IC s68 para 12 e (1) p 333, a night figure; kept by day as the layout's spacing) and clear of
 * Obj 1, SL 2 at its forward edge (IC s68 para 13 a p 334), the axis from SL 2 to just inside
 * Obj 2, the LOE beyond its far edge along the axis; the follow-up Coys' way from the FUP kept off Obj 1.
 */
export function layPhase2(o1: Box, o2: Box, fup: XY, side: 1 | -1, offDeg: number, doc: DoctrineSet): Phase2Lay {
  const band = rng(doc, 'attack.phase2.fup2FromObj2M', [1000, 1200]);
  const clear = num(doc, 'attack.phase2.clearObj1M', 300);
  const loeBeyond = num(doc, 'attack.loeBeyondObjM', 600);
  const face = unit(P(o1.c.x - o2.c.x, o1.c.y - o2.c.y));
  let deg = offDeg, F = o2.c;
  for (; ; deg += 15) {
    const dir = rot(face, (side * deg * Math.PI) / 180);
    const at = (R: number) => P(o2.c.x + dir.x * R, o2.c.y + dir.y * R);
    // SL 2 (100 m ahead of FUP 2's centre) beyond the last lift: FUP 2 at least band[0] + 150 out
    let R = 100;
    while (R < 5000 && boxGap(o2, at(R)) < band[0] + 150) R += 25;
    // then out until clear of Obj 1 (FUP 2 is 300 m long: its ends too), no further than the band
    while (R < 5000 && boxGap(o1, at(R)) < clear + 150 && boxGap(o2, at(R)) < band[1]) R += 25;
    F = at(R);
    if (boxGap(o1, F) >= clear + 150 || deg >= 120) break;
  }
  const u = unit(P(o2.c.x - F.x, o2.c.y - F.y)), n = P(u.y, -u.x);
  const across = (c: XY, half: number) => [P(c.x - n.x * half, c.y - n.y * half), P(c.x + n.x * half, c.y + n.y * half)];
  const S = P(F.x + u.x * 100, F.y + u.y * 100);
  const near = along(o2, u);
  const head = P(o2.c.x - u.x * Math.max(0, near - 100), o2.c.y - u.y * Math.max(0, near - 100));
  const L = P(o2.c.x + u.x * (near + loeBeyond), o2.c.y + u.y * (near + loeBeyond));
  // the way round: straight if it keeps off Obj 1, else by its flank (and its near corner when the FUP is the other side)
  const flank = P(o1.c.x + side * (o1.w / 2 + clear), o1.c.y);
  const corner = P(o1.c.x + side * (o1.w / 2 + clear), o1.c.y - o1.h / 2 - clear);
  let via = [fup, F];
  if (pathGap(via, o1) < clear) via = [fup, flank, F];
  if (pathGap(via, o1) < clear) via = [fup, corner, flank, F];
  return { side, offDeg: deg, fup2: F, fupPts: across(F, 150), slPts: across(S, 200), axis: [S, head], loePts: across(L, 750), via, gap2: boxGap(o2, F), gap1: boxGap(o1, F) };
}

/**
 * Phase 2 through Obj 1 (the user's traces and the IE solution, 28 Nov 2026): the attack goes on in its direction, from
 * Obj 1 to Obj 2. FUP 2 on Obj 1's far side, `attack.phase2.through.fupInObj1M` inside its far edge (on the firm base,
 * sheltered by it); its start line PH-I, `attack.phaseLine.beyondObjM` beyond that edge; the axis from PH-I to just inside
 * Obj 2; the LOE beyond Obj 2. The follow-up Coys' way: from the FUP behind the assault onto Obj 1 and across it to FUP 2
 * (they wait in the FUP until Obj 1 is taken, IBB p 204 (7)).
 */
export function layThrough(o1: Box, o2: Box, fup: XY, doc: DoctrineSet): Phase2Lay {
  const inside = num(doc, 'attack.phase2.through.fupInObj1M', 150);
  const beyond = num(doc, 'attack.phaseLine.beyondObjM', 200);
  const loeBeyond = num(doc, 'attack.loeBeyondObjM', 600);
  const u = unit(P(o2.c.x - o1.c.x, o2.c.y - o1.c.y)), n = P(u.y, -u.x);
  const across = (c: XY, half: number) => [P(c.x - n.x * half, c.y - n.y * half), P(c.x + n.x * half, c.y + n.y * half)];
  const far1 = along(o1, u), near2 = along(o2, u);
  const F = P(o1.c.x + u.x * (far1 - inside), o1.c.y + u.y * (far1 - inside));
  const S = P(o1.c.x + u.x * (far1 + beyond), o1.c.y + u.y * (far1 + beyond));
  const head = P(o2.c.x - u.x * Math.max(0, near2 - 100), o2.c.y - u.y * Math.max(0, near2 - 100));
  const L = P(o2.c.x + u.x * (near2 + loeBeyond), o2.c.y + u.y * (near2 + loeBeyond));
  // onto Obj 1 where the assault went in (its near edge, toward the FUP), then across it to FUP 2
  const toF = unit(P(fup.x - o1.c.x, fup.y - o1.c.y));
  const entry = P(o1.c.x + toF.x * along(o1, toF), o1.c.y + toF.y * along(o1, toF));
  return { side: 1, offDeg: 0, fup2: F, fupPts: across(F, 150), slPts: across(S, 200), axis: [S, head], loePts: across(L, 750), via: [fup, entry, F], gap2: boxGap(o2, F), gap1: 0 };
}

/**
 * Phase 2's own BOF (the Req of the IE: "BOF for Ph 1 and Ph 2"; Soln Appx-I: 10r for Ph 1, 15r for Ph 2): off the
 * phase 2 axis by `deg` on `side`, its base `attack.bofFromObjM` (the middle) from Obj 2's edge, firing at it; a base line
 * 400 m across, the point it fires toward 300 m in front (the recipe BOF's shape). Plan metres.
 */
export function bofFor(o1: Box, o2: Box, side: 1 | -1, doc: DoctrineSet, deg = 70, gapM?: number): { base: { start: XY; mid: XY; end: XY }; ctrl: XY } {
  const back = unit(P(o1.c.x - o2.c.x, o1.c.y - o2.c.y));
  const dir = rot(back, (side * deg * Math.PI) / 180);
  const gap = gapM ?? num(doc, 'attack.bofFromObjM', 850);
  const R = along(o2, dir) + gap;
  const mid = P(o2.c.x + dir.x * R, o2.c.y + dir.y * R);
  const n = P(dir.y, -dir.x);
  return { base: { start: P(mid.x - n.x * 200, mid.y - n.y * 200), mid, end: P(mid.x + n.x * 200, mid.y + n.y * 200) }, ctrl: P(mid.x - dir.x * 300, mid.y - dir.y * 300) };
}

/** The mortars' step-up posn for phase 2 (IBB p176 d): short of Obj 1, to the side away from the phase 2 way. */
export function morStepUp(o1: Box, side: 1 | -1, doc: DoctrineSet): XY {
  const short = num(doc, 'attack.phase2.morStepUp.shortOfObj1M', 300), across = num(doc, 'attack.phase2.morStepUp.acrossM', 500);
  return P(o1.c.x - side * across, o1.c.y - o1.h / 2 - short);
}

// ── the recipe ───────────────────────────────────────────────────────────────────────────────────────────────────
const fromRecipe = (p: [number, number]): XY => P(p[0], -p[1]);
const toRecipe = (p: XY): [number, number] => [Math.round(p.x), Math.round(-p.y)];

/** The side phase 2 goes by default: a flank attack's own side; frontal, away from the BOF. */
export function defaultSide(r: Recipe): 1 | -1 {
  if (r.layout === 'left-flank') return -1;
  if (r.layout === 'right-flank') return 1;
  const bof = r.slots.find((s) => s.role === 'bof')?.shape;
  // where the BOF sits (its base line), as the tanks read it (PlanTanks), not the point it fires toward
  const base: [number, number][] | undefined = bof?.base;
  const x = base?.length ? base.reduce((a, p) => a + p[0], 0) / base.length : bof?.ctrl?.[0] ?? 0;
  return x > 0 ? -1 : 1;
}

/**
 * Any Bn Attk layout as a two-phase attack: Obj 1 (the objective as it stands), Obj 2 behind it, the follow-up Coys in
 * the reserve's place, FUP 2 / SL 2 / the phase 2 axis round Obj 1 on `side`, the LOE beyond Obj 2, the mortars'
 * step-up posn short of Obj 1 (planned). The BOF is the Spt Coy's weapons. `coys` (else attack.phase2.coys): 2 sends C
 * and D Coys onto Obj 2 and leaves no Bn reserve; 1 sends C Coy and keeps D Coy as the reserve (IBB p186 h(3): commit
 * only what the task needs). The recipe is new (id `-2ph`, or `-2ph1` for one Coy); the one passed in is not changed. A
 * recipe without an objective rect or an FUP is returned as it is.
 */
/** How phase 2 goes in by default (attack.phase2.method, the user's ruling of 28 Nov 2026: through). */
export function defaultMethod(doc: DoctrineSet): 'through' | 'flank' {
  return String(doctrineAt(doc, 'attack.phase2.method') ?? 'through') === 'flank' ? 'flank' : 'through';
}

/** The phase line slots for phases 1..n (PlanPhaseLine lays them from the objectives where they finally stand). */
function phaseLineSlots(n: number): RecipeSlot[] {
  const out: RecipeSlot[] = [];
  for (let k = 1; k <= n; k++) out.push({ role: `ph${k}`, kind: 'line', sym: '25140300', label: phaseLineLabel(k), order: 5, rule: { phaseLine: k } });
  return out;
}

export function twoPhaseRecipe(r: Recipe, doc: DoctrineSet, side?: 1 | -1, coysIn?: 1 | 2, methodIn?: 'through' | 'flank'): Recipe {
  if (r.task !== 'attack' || r.phases === 2) return r;
  const out: Recipe = JSON.parse(JSON.stringify(r));
  const S = (role: string) => out.slots.find((s) => s.role === role);
  const obj = S('obj'), fup = S('fup');
  const rect = obj?.shape?.rect;
  if (!obj || !rect || !fup?.shape?.pts?.length) return r;
  const midOf = (v: unknown, fb: number) => { const x = resolveRange(doc, v); return x ? (x[0] + x[1]) / 2 : fb; };
  const w = midOf(rect.wM, 1500), h = midOf(rect.hM, 700);
  const o1: Box = { c: fromRecipe([rect.acrossM, rect.backM]), w, h };
  const o2: Box = { c: P(o1.c.x, o1.c.y + num(doc, 'attack.phase2.obj2BeyondM', 1500)), w, h };
  const fc = centre(fup.shape.pts.map(fromRecipe));
  const sd = side ?? defaultSide(r);
  const method = methodIn ?? defaultMethod(doc);
  const through = method === 'through';
  const lay = through ? layThrough(o1, o2, fc, doc) : layPhase2(o1, o2, fc, sd, num(doc, 'attack.phase2.offDeg', 60), doc);
  const coys = coysIn ?? (Math.max(1, Math.min(2, Math.round(num(doc, 'attack.phase2.coys', 2)))) as 1 | 2);
  obj.label = 'OBJ 1';
  // the follow-up Coys where the reserve was (IBB p204 (7): 500-750 m behind the assault Coys); with one, D Coy stays
  // there as the reserve beside it
  const res = S('res');
  const resAt = res?.shape?.at ?? toRecipe(P(fc.x, fc.y - 650));
  if (coys >= 2 || !res) out.slots = out.slots.filter((s) => s.role !== 'res');
  else { res.label = 'D Coy'; res.shape = { ...res.shape, at: [resAt[0] + 150, resAt[1]] }; }
  // the BOF is the Spt Coy's weapons (MG, 106 mm RR): every rifle Coy is in the assault, the follow-up or the reserve
  const bofCoy = S('bofCoy');
  if (bofCoy) bofCoy.label = 'Spt Coy';
  const axisW = S('axis')?.shape?.widthM ?? 400;
  const add = (s: RecipeSlot) => out.slots.push(s);
  add({ role: 'obj2', kind: 'area', sym: '25151700', label: 'OBJ 2', order: 1, shape: { rect: { acrossM: Math.round(o2.c.x), backM: Math.round(-o2.c.y), wM: rect.wM, hM: rect.hM } } });
  add({ role: 'fup2', kind: 'area', sym: '25140302', label: 'FUP 2', order: 2, shape: { pts: lay.fupPts.map(toRecipe) }, terrainRule: { unseenFrom: 'threat', notIn: ['noGo', 'water'] } });
  // through: PH-I is phase 2's start line (no SL 2 of its own); round the flank: SL 2 at FUP 2's forward edge
  if (!through) add({ role: 'sl2', kind: 'line', sym: '25140303', label: 'SL 2', order: 2, shape: { pts: lay.slPts.map(toRecipe) } });
  add({ role: 'axis2', kind: 'area', sym: '25151403', label: 'Ph 2', order: 3, shape: { pts: lay.axis.map(toRecipe), widthM: axisW } });
  add({ role: 'fu1', kind: 'point', sym: '10121100', label: 'C Coy', echelon: '15', order: 3, shape: { at: [resAt[0] - 150, resAt[1]] } });
  if (coys >= 2) add({ role: 'fu2', kind: 'point', sym: '10121100', label: 'D Coy', echelon: '15', order: 3, shape: { at: [resAt[0] + 150, resAt[1]] } });
  add({ role: 'mor2', kind: 'point', sym: '15111402', label: '81 mm Mor (Ph 2)', order: 4, planned: true, shape: { at: toRecipe(morStepUp(o1, sd, doc)) } });
  if (through) {
    // phase 2's own BOF on the flank nearer the phase 1 BOF (the Spt Coy steps up the shortest way): the Req's "BOF for Ph 1
    // and Ph 2", the IE solution's 10r and 15r
    const b1 = S('bof')?.shape?.base as [number, number][] | undefined;
    const b1c = b1?.length ? centre(b1.map(fromRecipe)) : P(o1.c.x - sd * 1000, o1.c.y);
    const cands = ([1, -1] as const).map((sg) => ({ sg, b: bofFor(o1, o2, sg, doc) }));
    const pick = cands.sort((a, b) => dist(a.b.base.mid, b1c) - dist(b.b.base.mid, b1c))[0].b;
    add({ role: 'bof2', kind: 'area', sym: '25152100', label: 'BOF (Ph 2)', order: 4, shape: { base: [toRecipe(pick.base.start), toRecipe(pick.base.end)], ctrl: toRecipe(pick.ctrl) }, terrainRule: { sees: 'obj2', prefer: ['highGround'] } });
  }
  // PH-I and PH-II across the attack, beyond each phase's objectives (IC s66 para 8 h p 309; the user's traces)
  for (const s of phaseLineSlots(2)) add(s);
  const loe = S('loe');
  if (loe?.shape) loe.shape.pts = lay.loePts.map(toRecipe);
  out.id = `${r.id}-2ph${coys >= 2 ? '' : '1'}${through ? '' : 'f'}`;
  out.name = `${r.name}, two phases${coys >= 2 ? '' : ' (D Coy res)'}${through ? '' : ', Ph 2 round the flank'}`;
  out.phases = 2;
  out.phase2Side = sd;
  out.ph2Method = method;
  const how = through
    ? `move up behind the assault onto Obj 1, form up on its far side (FUP 2, on the firm base) and cross PH-I, phase 2's start line, onto Obj 2 in the direction of the attack (the user's traces and the IE solution, 28 Nov 2026; IBB p 176 c: at once when Obj 1 falls)`
    : `go round its ${sideWord(sd)} flank to FUP 2 and attack Obj 2 ${lay.offDeg} degrees off the En front (IBB p186)`;
  out.note = `${r.note ?? ''} Two phases (PlanPhase): Obj 2 ${fmtM(o2.c.y - o1.c.y)} behind Obj 1 (attack.phase2.obj2BeyondM, E); the follow-up ${coys >= 2 ? 'C and D Coys (no Bn reserve)' : 'C Coy (D Coy the reserve)'} wait in the FUP until Obj 1 is taken (IBB p204 (7)), ${how}; Obj 1 the firm base (p189 para 23); the mortars step up to 300 m short of Obj 1 (p176 d); PH-I and PH-II across the attack beyond each phase's objectives (IC s66 para 8 h p 309); the LOE beyond Obj 2.`.trim();
  return out;
}

// ── on the ground ────────────────────────────────────────────────────────────────────────────────────────────────
export interface Phase2Find {
  /** Obj 2 moved (plan metres). */
  nudges: Record<string, XY>;
  /** FUP 2, SL 2 and the LOE laid afresh for the side chosen (and phase 2's BOF, its base line). */
  geom: Record<string, { pts: XY[]; base?: { start: XY; mid: XY; end: XY } }>;
  /** The phase 2 axis (PlanFit lays it round NO-GO). */
  paths: Record<string, XY[]>;
  /** The follow-up Coys' way from the FUP round Obj 1 to FUP 2, plan metres. */
  route: XY[];
  side: 1 | -1;
  offDeg: number;
  obj2From: 'marked' | 'enemy' | 'highGround' | 'assumed';
  rows: Check[];
}

/**
 * Phase 2 on the ground. `res` is the attack solved with phase 1's finders; `enemyAt` the hostile units and posns drawn
 * on the map (plan metres); `choke` his MSR behind the objectives. Both sides round Obj 1 are tried (and 15° either way):
 * FUP 2 hidden from Obj 2 first, then the shorter way from the FUP, no NO-GO on the axis, the LOE nearer his MSR.
 */
export function findPhaseN(res: SolveResult, f: FitFrame, g: PlanGround, doc: DoctrineSet, enemyAt: XY[] | null, choke: MsrChoke | null, marked: XY | null = null, n: 2 | 3 = 2): Phase2Find | null {
  const R = n === 2 ? { prev: 'obj', cur: 'obj2', fupPrev: 'fup', fup: 'fup2', sl: 'sl2', axis: 'axis2', mor: 'mor2' } : { prev: 'obj2', cur: 'obj3', fupPrev: 'fup2', fup: 'fup3', sl: 'sl3', axis: 'axis3', mor: 'mor3' };
  const item = (role: string) => res.items.find((i) => i.role === role);
  const obj = item(R.prev), obj2 = item(R.cur), fup = item(R.fupPrev);
  if (!obj || !obj2 || !fup) return null;
  const o1 = boxOf(obj.pts);
  let o2 = boxOf(obj2.pts);
  const F0 = centre(fup.pts);
  const W = (p: XY) => toWorld(f, p);
  const foot = g.going('dismounted');
  const clsAt = (p: XY) => { const w = W(p); return g.cls(w.x, w.y); };
  const bad = (p: XY) => { const c = clsAt(p); return c !== null && (foot.nogo.has(c) || WATER.has(c)); };
  const out: Phase2Find = { nudges: {}, geom: {}, paths: {}, route: [], side: res.recipe.phase2Side ?? 1, offDeg: 60, obj2From: 'assumed', rows: [] };

  // ── Obj 2: a hostile posn drawn behind Obj 1, else his depth on higher ground, else straight behind ────────────────
  const search = rng(doc, 'attack.phase2.obj2SearchM', [900, 2500]);
  const depthDir = unit(P(o2.c.x - o1.c.x, o2.c.y - o1.c.y)), across = P(depthDir.y, -depthDir.x);
  const clearOf1 = (c: XY) => boxesGap(o1, { ...o2, c }) >= 200;
  const known = (enemyAt ?? [])
    .map((p) => ({ p, d: dist(p, o1.c), cos: ((p.x - o1.c.x) * depthDir.x + (p.y - o1.c.y) * depthDir.y) / (dist(p, o1.c) || 1) }))
    .filter((e) => e.d >= search[0] && e.d <= search[1] && e.cos >= Math.SQRT1_2 && clearOf1(e.p))
    .sort((a, b) => dist(a.p, o2.c) - dist(b.p, o2.c));
  let O2 = o2.c, obj2Why = '';
  if (marked && clearOf1(marked)) {
    // the user marked Obj 2 on the map: it stands, whatever is drawn or lies higher
    O2 = marked; out.obj2From = 'marked';
    obj2Why = `where you marked it, ${fmtM(dist(marked, o1.c))} behind Obj ${n - 1}`;
  } else if (known.length) {
    O2 = known[0].p; out.obj2From = 'enemy';
    obj2Why = `on the enemy posn drawn ${fmtM(known[0].d)} behind Obj ${n - 1}`;
  } else {
    const meanE = (c: XY) => {
      const es = [c, P(c.x - o2.w / 3, c.y), P(c.x + o2.w / 3, c.y), P(c.x, c.y - o2.h / 3), P(c.x, c.y + o2.h / 3)].map((p) => { const w = W(p); return g.elev(w.x, w.y); }).filter(Number.isFinite);
      return es.length >= 3 ? es.reduce((a, b) => a + b, 0) / es.length : NaN;
    };
    const e0 = meanE(o2.c), gain = num(doc, 'fit.highGround.gainM', 8);
    let best: { c: XY; e: number } | null = null;
    for (let d = search[0]; d <= Math.min(search[1], 2000); d += 250) for (const a of [-600, -300, 0, 300, 600]) {
      const c = P(o1.c.x + depthDir.x * d + across.x * a, o1.c.y + depthDir.y * d + across.y * a);
      if (!clearOf1(c) || bad(c)) continue;
      const e = meanE(c);
      if (Number.isFinite(e) && (!best || e > best.e)) best = { c, e };
    }
    if (best && Number.isFinite(e0) && best.e - e0 >= gain) {
      O2 = best.c; out.obj2From = 'highGround';
      obj2Why = `on ground ${Math.round(best.e - e0)} m higher, ${fmtM(dist(best.c, o1.c))} behind Obj ${n - 1} (the En depth likely on the high ground, E): confirm by recce`;
    } else obj2Why = `assumed ${fmtM(dist(o1.c, o2.c))} straight behind Obj ${n - 1} (the En depth Coy, attack.phase2.obj2BeyondM, E): draw the En depth posn on the map (a hostile symbol)${n === 2 ? ' or mark Obj 2 on the map' : ''}, and Obj ${n} is laid on it`;
  }
  if (dist(O2, o2.c) > 1) { out.nudges[R.cur] = P(O2.x - o2.c.x, O2.y - o2.c.y); o2 = { ...o2, c: O2 }; }
  // a mark too near the objective before it is not taken: say so, never pass it over in silence
  const markRefused = !!marked && out.obj2From !== 'marked';
  if (markRefused) obj2Why = `your mark is ${fmtM(dist(marked!, o1.c))} from the centre of Obj ${n - 1}: Obj ${n} laid there would come within 200 m of Obj ${n - 1}, so it was not taken; mark it farther behind. Obj ${n} ${obj2Why}`;
  out.rows.push({ name: `Obj ${n}`, st: out.obj2From === 'assumed' || markRefused ? 'warn' : 'pass', reason: obj2Why });

  // ── the side round Obj 1 ──────────────────────────────────────────────────────────────────────────────────────────
  const sight = (to: XY[]) => {
    if (!g.sight) return null;
    const a = W(o2.c);
    const ps = to.map((p) => { const b = W(p); return g.sight!(a.x, a.y, 2, b.x, b.y, 1.7); }).filter((p): p is number => p !== null);
    return ps.length >= 2 ? ps.filter((p) => p >= 0.5).length / ps.length : null;
  };
  const badAlong = (pts: XY[]) => {
    let n = 0;
    for (let i = 1; i < pts.length; i++) { const L = dist(pts[i - 1], pts[i]), k = Math.max(1, Math.ceil(L / 50)); for (let s = 1; s < k; s++) if (bad(P(pts[i - 1].x + ((pts[i].x - pts[i - 1].x) * s) / k, pts[i - 1].y + ((pts[i].y - pts[i - 1].y) * s) / k))) n++; }
    return n;
  };
  // ── through Obj 1 over the phase line (the user's traces, the default): no side to choose ─────────────────────────
  if ((res.recipe.ph2Method ?? defaultMethod(doc)) === 'through') {
    const lay = layThrough(o1, o2, F0, doc);
    out.side = res.recipe.phase2Side ?? 1; out.offDeg = 0;
    out.geom = { [R.fup]: { pts: lay.fupPts }, loe: { pts: lay.loePts } };
    if (item(R.sl)) out.geom[R.sl] = { pts: lay.slPts };
    out.paths = { [R.axis]: lay.axis };
    const mt = item(R.mor);
    if (mt) { const want = morStepUp(o1, out.side, doc); if (dist(want, mt.pts[0]) > 1) out.nudges[R.mor] = P(want.x - mt.pts[0].x, want.y - mt.pts[0].y); }
    // the follow-up Coys' way on foot: behind the assault onto Obj 1, across the firm base to FUP n, each leg round NO-GO
    const legs: XY[] = [lay.via[0]];
    for (let i = 1; i < lay.via.length; i++) {
      const p = g.avenues?.(W(lay.via[i - 1]), W(lay.via[i]), 300, 'dismounted')?.[0]?.path;
      if (p && p.length > 2) legs.push(...p.slice(1, -1).map((q) => toLocal(f, q)));
      legs.push(lay.via[i]);
    }
    out.route = simplify(legs, num(doc, 'attack.routeToleranceM', 75));
    const ph = phaseLineLabel(n - 1);
    const axisBad = badAlong(lay.axis);
    out.rows.push({ name: `Ph ${n} direction`, st: axisBad ? 'warn' : 'pass', reason: `through Obj ${n - 1} (the firm base) and over ${ph}, its start line, onto Obj ${n} in the direction of the attack (the user's traces and the IE solution; IBB p 176 c: the follow-up Coys attack at once when Obj ${n - 1} falls); they wait in the FUP until it is taken (IBB p 204 (7)), so they never pass through Coys the En has halted (p 186 h (1)); ${fmtM(lenOf(out.route))} from ${n === 2 ? 'the FUP' : `FUP ${n - 1}`} to FUP ${n}${axisBad ? `; NO-GO on foot lies on the way to Obj ${n}: the axis is laid round it` : ''}` });
    const seen = sight([lay.fup2, ...lay.fupPts]);
    out.rows.push(seen === null
      ? { name: `FUP ${n} unseen`, st: 'unchecked', reason: g.sight ? `the ground round FUP ${n} is not loaded` : 'no sight data' }
      : { name: `FUP ${n} unseen`, st: seen < 0.5 ? 'pass' : 'warn', reason: seen < 0.5 ? `on Obj ${n - 1}'s far side, likely hidden from Obj ${n} (${Math.round(seen * 100)} % of it seen)` : `${Math.round(seen * 100)} % of FUP ${n} on Obj ${n - 1}'s far side likely seen from Obj ${n}: form up behind the crest of Obj ${n - 1}, by night or under smoke, or neutralise Obj ${n} while they form up` });
    // phase 2's own BOF sited where it sees Obj 2 best, off NO-GO, off the axis 50-90°, near where the recipe put it
    const bi = n === 2 ? item('bof2') : null;
    if (bi?.base && g.sight) {
      let best: { b: ReturnType<typeof bofFor>; cost: number; seen: number; deg: number } | null = null;
      for (const sg of [1, -1] as const) for (const deg of [50, 60, 70, 80, 90]) for (const gap of [700, 850, 1000]) {
        const b = bofFor(o1, o2, sg, doc, deg, gap);
        if ([b.base.start, b.base.mid, b.base.end].filter(bad).length >= 2) continue;
        const sn = sight([b.base.start, b.base.mid, b.base.end]);
        if (sn === null) continue;
        const cost = (1 - sn) * 10 + Math.abs(deg - 70) / 20 + dist(b.base.mid, bi.base.mid) / 1000;
        if (!best || cost < best.cost) best = { b, cost, seen: sn, deg };
      }
      if (best) {
        out.geom.bof2 = { pts: [best.b.ctrl], base: best.b.base };
        out.rows.push({ name: 'BOF (Ph 2)', st: best.seen >= 0.5 ? 'pass' : 'warn', reason: best.seen >= 0.5 ? `sited ${best.deg}° off the phase 2 axis where it likely sees Obj 2 (${Math.round(best.seen * 100)} % of its line in view): the Spt Coy's weapons step up to it once Obj 1 falls (the Req's BOF for Ph 1 and Ph 2)` : `nowhere ${fmtM(700)}-${fmtM(1000)} out on either flank likely sees Obj 2 (${Math.round(best.seen * 100)} % at best): fire it from Obj 1, or site it on the ground` });
      } else out.rows.push({ name: 'BOF (Ph 2)', st: 'unchecked', reason: 'the ground round Obj 2 is not loaded' });
    }
    return out;
  }
  const off = num(doc, 'attack.phase2.offDeg', 60);
  type Cand = { lay: Phase2Lay; cost: number; seen: number | null; wayM: number; axisBad: number; chokeD: number | null };
  const cands: Cand[] = [];
  for (const side of [1, -1] as const) for (const dDeg of [0, -15, 15]) {
    const lay = layPhase2(o1, o2, F0, side, off + dDeg, doc);
    if ([lay.fup2, ...lay.fupPts].filter(bad).length >= 2) continue;
    const seen = sight([lay.fup2, ...lay.fupPts]);
    const wayM = lenOf(lay.via);
    const axisBad = badAlong(lay.axis);
    const chokeD = choke ? dist(centre(lay.loePts), choke.at) : null;
    const cost = (seen ?? 0.5) * 10 + (wayM / 1000) * 2 + Math.abs(lay.offDeg - off) / 15 + Math.min(4, badAlong(lay.via) / 4) + (axisBad ? 4 : 0) + (chokeD !== null ? Math.min(chokeD, 4000) / 1000 : 0);
    cands.push({ lay, cost, seen, wayM, axisBad, chokeD });
  }
  cands.sort((a, b) => a.cost - b.cost);
  const best = cands[0] ?? { lay: layPhase2(o1, o2, F0, out.side, off, doc), cost: 0, seen: null, wayM: 0, axisBad: 0, chokeD: null };
  const lay = best.lay;
  out.side = lay.side; out.offDeg = lay.offDeg;
  out.geom = { [R.fup]: { pts: lay.fupPts }, [R.sl]: { pts: lay.slPts }, loe: { pts: lay.loePts } };
  out.paths = { [R.axis]: lay.axis };
  // the mortars' step-up posn to the side away from the way chosen
  const m2 = item(R.mor);
  if (m2) { const want = morStepUp(o1, lay.side, doc); if (dist(want, m2.pts[0]) > 1) out.nudges[R.mor] = P(want.x - m2.pts[0].x, want.y - m2.pts[0].y); }
  // the follow-up Coys' way on foot, each straight leg laid round NO-GO (it may not come nearer Obj 1 than the leg did)
  const legs: XY[] = [lay.via[0]];
  for (let i = 1; i < lay.via.length; i++) {
    const p = g.avenues?.(W(lay.via[i - 1]), W(lay.via[i]), 300, 'dismounted')?.[0]?.path;
    const mid = p && p.length > 2 ? p.slice(1, -1).map((q) => toLocal(f, q)) : [];
    if (mid.length && pathGap([lay.via[i - 1], ...mid, lay.via[i]], o1) >= num(doc, 'attack.phase2.clearObj1M', 300) - 50) legs.push(...mid);
    legs.push(lay.via[i]);
  }
  out.route = simplify(legs, num(doc, 'attack.routeToleranceM', 75));
  const other = cands.find((c) => c.lay.side !== lay.side);
  const otherWhy = other ? `; the ${sideWord(other.lay.side)} way ${other.seen !== null && best.seen !== null && other.seen > best.seen + 0.05 ? `has FUP ${n} more in view of Obj ${n} (${Math.round(other.seen * 100)} %)` : other.wayM > best.wayM + 200 ? `is longer (${fmtM(other.wayM)})` : other.axisBad > best.axisBad ? 'crosses NO-GO' : other.chokeD !== null && best.chokeD !== null && other.chokeD > best.chokeD + 200 ? 'ends further from the En MSR' : 'scores lower'}` : '; the other way is NO-GO at FUP 2';
  out.rows.push({ name: `Ph ${n} direction`, st: 'pass', reason: `round Obj ${n - 1}'s ${sideWord(lay.side)} flank, keeping ${num(doc, 'attack.phase2.clearObj1M', 300)} m off it, onto Obj ${n} ${lay.offDeg}° off the En front; ${fmtM(lenOf(out.route))} from ${n === 2 ? 'the FUP' : 'FUP 2'} to FUP ${n} (IBB p186: a new direction, not through the Coys on Obj ${n - 1})${otherWhy}` });
  out.rows.push(best.seen === null
    ? { name: `FUP ${n} unseen`, st: 'unchecked', reason: g.sight ? `the ground round FUP ${n} is not loaded` : 'no sight data' }
    : { name: `FUP ${n} unseen`, st: best.seen < 0.5 ? 'pass' : 'warn', reason: best.seen < 0.5 ? `likely hidden from Obj ${n} (${Math.round(best.seen * 100)} % of it seen)` : `${Math.round(best.seen * 100)} % of FUP ${n} likely seen from Obj ${n}: form up by night or under smoke, or neutralise Obj ${n} while they form up` });
  return out;
}

/** The going along a phase 2 axis on foot and for tanks, as a check row (`Ph 2 going`). */

/** Phase 2 on the ground: Obj 2, the side round Obj 1, FUP 2 and SL 2, the follow-up Coys' way (findPhaseN with n = 2). */
export function findPhase2(res: SolveResult, f: FitFrame, g: PlanGround, doc: DoctrineSet, enemyAt: XY[] | null, choke: MsrChoke | null, marked: XY | null = null): Phase2Find | null {
  return findPhaseN(res, f, g, doc, enemyAt, choke, marked, 2);
}

/**
 * A third phase on a two-phase recipe: Obj 3 behind Obj 2 (attack.phase2.obj2BeyondM), FUP 3, SL 3 and the phase 3 axis
 * laid round Obj 2's other flank (PlanPhase.layPhase2 with the side turned), the follow-up: D Coy when C Coy alone took
 * Obj 2 (the reserve commits: tell Bde), else A and B Coys from Obj 1, reorganised there (IBB p 189 para 23: each Obj a
 * firm base for the next). The mortars step up again. The recipe passed in is not changed.
 */
export function threePhaseRecipe(r: Recipe, doc: DoctrineSet): Recipe {
  if (r.task !== 'attack' || r.phases !== 2) return r;
  const out: Recipe = JSON.parse(JSON.stringify(r));
  const S = (role: string) => out.slots.find((s) => s.role === role);
  const obj2 = S('obj2'), fup2 = S('fup2'), axis2 = S('axis2');
  const rect = obj2?.shape?.rect;
  if (!obj2 || !rect || !fup2?.shape?.pts?.length) return r;
  const midOf = (v: unknown, fb: number) => { const x = resolveRange(doc, v); return x ? (x[0] + x[1]) / 2 : fb; };
  const w = midOf(rect.wM, 1500), h = midOf(rect.hM, 700);
  const o2: Box = { c: fromRecipe([rect.acrossM, rect.backM]), w, h };
  const o3: Box = { c: P(o2.c.x, o2.c.y + num(doc, 'attack.phase2.obj2BeyondM', 1500)), w, h };
  const f2 = centre(fup2.shape.pts.map(fromRecipe));
  const sd = (-(r.phase2Side ?? 1)) as 1 | -1;
  const through = (r.ph2Method ?? defaultMethod(doc)) === 'through';
  const lay = through ? layThrough(o2, o3, f2, doc) : layPhase2(o2, o3, f2, sd, num(doc, 'attack.phase2.offDeg', 60), doc);
  const res = S('res');
  const who = res ? 'D Coy' : 'A, B Coys (from Obj 1)';
  if (res) out.slots = out.slots.filter((s) => s.role !== 'res');
  const add = (s: RecipeSlot) => out.slots.push(s);
  add({ role: 'obj3', kind: 'area', sym: '25151700', label: 'OBJ 3', order: 1, shape: { rect: { acrossM: Math.round(o3.c.x), backM: Math.round(-o3.c.y), wM: rect.wM, hM: rect.hM } } });
  add({ role: 'fup3', kind: 'area', sym: '25140302', label: 'FUP 3', order: 2, shape: { pts: lay.fupPts.map(toRecipe) }, terrainRule: { unseenFrom: 'threat', notIn: ['noGo', 'water'] } });
  if (!through) add({ role: 'sl3', kind: 'line', sym: '25140303', label: 'SL 3', order: 2, shape: { pts: lay.slPts.map(toRecipe) } });
  // PH-III beyond Obj 3 (PH-I and PH-II are there already)
  if (!out.slots.some((s) => s.role === 'ph3')) add({ role: 'ph3', kind: 'line', sym: '25140300', label: phaseLineLabel(3), order: 5, rule: { phaseLine: 3 } });
  add({ role: 'axis3', kind: 'area', sym: '25151403', label: 'Ph 3', order: 3, shape: { pts: lay.axis.map(toRecipe), widthM: axis2?.shape?.widthM ?? 400 } });
  add({ role: 'fu3', kind: 'point', sym: '10121100', label: who, echelon: '15', order: 3, shape: { at: toRecipe(P(f2.x + 200, f2.y - 250)) } });
  add({ role: 'mor3', kind: 'point', sym: '15111402', label: '81 mm Mor (Ph 3)', order: 4, planned: true, shape: { at: toRecipe(morStepUp(o2, sd, doc)) } });
  const loe = S('loe');
  if (loe?.shape) loe.shape.pts = lay.loePts.map(toRecipe);
  out.id = `${r.id}-3ph`;
  out.name = `${r.name.replace(', two phases', ', three phases')}`;
  out.phases = 3;
  out.note = `${r.note ?? ''} Phase 3 (PlanPhase): Obj 3 ${fmtM(o3.c.y - o2.c.y)} behind Obj 2 (E), taken by ${who} ${through ? 'through Obj 2 over PH-II' : `round Obj 2's ${sideWord(sd)} flank`} from FUP 3, Obj 2 the firm base (IBB p 189 para 23)${res ? '; no Bn reserve is left: tell Bde (IBB p 186 i)' : ''}; the mortars step up again; the LOE beyond Obj 3.`.trim();
  return out;
}

export function goingRow(name: string, pts: XY[], f: FitFrame, g: PlanGround): Check {
  const foot = g.going('dismounted'), tank = g.going('tracked');
  let n = 0, no = 0, slow = 0, tankNo = 0;
  for (let i = 1; i < pts.length; i++) {
    const L = dist(pts[i - 1], pts[i]), k = Math.max(1, Math.ceil(L / 50));
    for (let s = 0; s < k; s++) {
      const t = (s + 0.5) / k;
      const w = toWorld(f, P(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t));
      const c = g.cls(w.x, w.y);
      if (c === null) continue;
      n++;
      if (foot.nogo.has(c)) no++; else if (foot.caution.has(c)) slow++;
      if (tank.nogo.has(c)) tankNo++;
    }
  }
  const st: CheckState = !n ? 'unchecked' : no ? 'fail' : slow / n > 0.5 ? 'warn' : 'pass';
  return { name, st, reason: !n ? 'no ground data along the phase 2 axis' : no ? 'the phase 2 axis crosses NO-GO on foot: turn it or plan the crossing' : `${Math.round((100 * slow) / n)} % SLOW-GO on foot${pts.length > 2 ? ' (laid round NO-GO on the ground)' : ''}; ${tankNo ? `${Math.round((100 * tankNo) / n)} % NO-GO for tanks` : 'tanks can go with it'}` };
}
