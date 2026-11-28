/**
 * PlanFit.ts — PURE. The terrain fit of a laid-out recipe (PlanBuilder_Plan.md Phase 2): where the plan lands on the
 * ground, slide posns out of NO-GO, read the ground, fields of fire, dead ground, the flanks and what overlooks the
 * posns, find the enemy approaches and whether each is under fire, put the killing ground on the main one, and score
 * the layout so Auto can rank a family. No ArcGIS, no DOM, no fetch: the ground comes through `PlanGround`
 * (PlanGroundProbe.ts over the terrain bundle in the browser; a synthetic ground in tools/planbuilder-test/fit.mjs).
 *
 * Safety first (user decision): a rule the ground cannot answer stays "unchecked" (grey), never pass; sight is a
 * chance (30 m elevation plus what stands on it); every reason says what to confirm on the ground.
 *
 * Frames. Plan metres: x across (right +), y toward the enemy (front +), as PlanSolve. World: Web Mercator. The
 * Deployment Mgr lays the plan with the pivot (the HQ) on the anchor, turned `bearing` clockwise from north, scaled by
 * `k` Mercator units per ground metre (1 / cos latitude); `toWorld` / `toLocal` do the same.
 */
import type { DoctrineSet, Recipe } from './PlanRecipes';
import { doctrineAt, resolveRange, frontageRow, SMALL_TASKS, isCanalLayout } from './PlanRecipes';
import type { Check, CheckState, SlotResult, SolveResult, SolveCtx, SolveOptions, XY } from './PlanSolve';
import { plSpots, solveRecipe } from './PlanSolve';
import { shapePosn, curveOf, type ShapeGround, type ShapeParams } from './PlanShape';
import { atgmPairs, type UnitBrief } from './PlanOrbat';
import { attackBreach, attackFactors, attackTimes, atOnObj, counterAttack, findAttackSpots, findMsrChoke, hSumRow, nightBrief, nightRow, phase2Row, phase3Row, type AttackFind, type CounterApch, type Factor, type HSum, type MsrChoke, type NightBrief } from './PlanAttack';
import { findPhase2, goingRow, type Phase2Find, findPhaseN } from './PlanPhase';
import { addTankTimes, defTankRows, findTankSpots, type TankFind, type TankMode, tankFupVsEnAtgm } from './PlanTanks';
import { artyRows } from './PlanArty';
import { attackFrontRows, fdlCurve, frontEdges, frontLocal, frontRows, frontValid, nearestOnFront, rayAhead, readFront, shapeToFront, standDist, type EnFront, type FrontEdges, type FrontShape, type LocalFront } from './PlanEnFront';
import { adDefileRows, adMountainRows, adRows } from './PlanAD';
import type { ForceSides } from './PlanContext';
import { fitSmallOp, type Mover, type SmallProbe, type SmallReading } from './PlanSmallOps';
import { canalPrep, fitCrossing, type CrossingReading, type Light } from './PlanCrossing';
import { fitAdvance } from './PlanAdvance';
import { fitWithdrawal, type WithdrawalFind } from './PlanWithdrawal';
import { findReverseSlope, type RevSlopeFind } from './PlanRevSlope';
import type { PlFootSpeeds } from '../PlatoonGuide/PlatoonGuideRead';
import { layoutRows, rearAreaRow } from './PlanMountain';
import { footKmh, approachCarries, applyContext, groundNotes, echelonLabel, enemyCorridorM, enemyFupM, enemyProfile, levelOf, type EnemySpec, type TerrainKind, type TerrainSpec } from './PlanContext';

export interface GroundAvenue {
  /** World points from the enemy toward the plan. */
  path: XY[];
  lengthM: number;
  goPct: number;
  minWidthM: number;
  chokes: { at: XY; widthM: number; label: string }[];
}

/** What the fit reads from the ground. Everything returns null / NaN when not known (no data, or still loading). */
export interface PlanGround {
  /** Ground class (rules.json `classes`) at a world point. */
  cls(x: number, y: number): number | null;
  /** Elevation, metres; NaN when not known. */
  elev(x: number, y: number): number;
  /** NO-GO / SLOW-GO classes for a mover (rules.json `profiles`). */
  going(profile: 'dismounted' | 'tracked' | 'gun'): { nogo: ReadonlySet<number>; caution: ReadonlySet<number> };
  label(c: number): string;
  /** Chance (0-1) that an eye `eyeM` above (ox, oy) sees something `targetM` tall at (tx, ty); null when not known. */
  sight?(ox: number, oy: number, eyeM: number, tx: number, ty: number, targetM: number): number | null;
  /** Least-cost ways for the mover from `from` to `to`, chokes narrower than `frontageM` (best first, at most three). */
  avenues?(from: XY, to: XY, frontageM: number, profile?: 'dismounted' | 'tracked'): GroundAvenue[] | null;
  /** The Movement Guide's bundle reader, for the ambush, patrol and recce (PlanSmallOps); null when not there. */
  mov?(): SmallProbe | null;
  /** True while tiles the reads needed are still on their way. */
  pending(): boolean;
  /** The data's dates for the report. */
  dataLine(): string;
}

export interface FitFrame {
  /** World point the pivot lands on. */
  anchor: XY;
  /** Radians clockwise from north the plan's front points. */
  bearing: number;
  /** Mercator units per ground metre at the anchor (1 / cos latitude). */
  k: number;
  /** The pivot (the HQ, or the target on the objective) in plan metres. */
  pivot: XY;
}

export interface FitApproach {
  id: string;
  main: boolean;
  path: XY[];
  lengthM: number;
  goPct: number;
  minWidthM: number;
  chokes: { at: XY; widthM: number; label: string }[];
  /** Roles of the posns that have it under direct fire. */
  coveredBy: string[];
  /** The largest enemy echelon it carries (its corridors fit its narrowest stretch); null: not known. */
  carries?: string | null;
  /** It carries the enemy's echelon: his main effort can come this way. */
  full?: boolean;
}

export interface FitResult {
  /** Plan-metre moves out of NO-GO, by role (fed back to the solver). */
  nudges: Record<string, XY>;
  /** Moves out of NO-GO, and up to higher ground nearby (`why: 'high'`, with the rise). */
  slides: { role: string; label: string; distM: number; why?: 'nogo' | 'high'; riseM?: number }[];
  /** Each posn's outline shaped to the ground (BP_SHAPE box fractions), by role: fed back to the solver. */
  outlines?: Record<string, [number, number][]>;
  /** The ITG drawn on the map (Vital / Imp Gr): the posn moved whole to take it in, or why it was not, by role. */
  itg?: Record<string, { label: string; distM: number | null; why?: string }>;
  /** An attack's axis laid on the ground (plan metres), when it has to bend round NO-GO. */
  paths?: Record<string, XY[]>;
  /** ATGM launchers beyond the recipe's pair, from the unit's ORBAT, sited on the tank approaches (plan metres). */
  atExtras?: { role: string; key: string; label: string; at: XY }[];
  /** An attack's reading (PlanAttack): the H-hour sum, his MSR choke, the weighed factors, the night march, the route. */
  attack?: { hSum: HSum | null; choke: MsrChoke | null; factors: Factor[]; night: NightBrief | null; route: XY[] | null; finder: Check[];
    /** A two-phase attack: the follow-up Coys' way to FUP 2, the side round Obj 1, where Obj 2 came from. */
    phase2?: { route: XY[]; side: 1 | -1; offDeg: number; obj2From: Phase2Find['obj2From'] };
    /** A three-phase attack: the phase 3 Coys' way round Obj 2 to FUP 3. */
    phase3?: { route: XY[]; side: 1 | -1; offDeg: number };
    /** His counter-attack ways in onto the last objective, for the reorganisation (PlanAttack.counterAttack). */
    counter?: { apchs: CounterApch[]; mover: 'tracked' | 'dismounted' };
    /** Tanks with the attack (PlanTanks): the Sqn's way to its fire posns (fire sp) and his fields of fire. */
    tanks?: { mode: TankMode; route: XY[] | null; fieldM: number | null } };
  /** An ambush, patrol or recce (PlanSmallOps): what the map products draw. */
  small?: SmallReading;
  /** A crossing (PlanCrossing): the obstacle, his observers, the drift entries, the bridges, the timeline. */
  crossing?: CrossingReading;
  /** A withdrawal (PlanWithdrawal): the routes back, the programme from last light, the rows' reading. */
  withdrawal?: Pick<WithdrawalFind, 'paths' | 'times' | 'routes' | 'confirm'>;
  /** A reverse slope defence (PlanRevSlope): the crest found (plan metres), how far the FDL lies behind it. */
  revSlope?: Pick<RevSlopeFind, 'crest' | 'fdlBehindM' | 'crestRiseM'>;
  /** Plan-metre centre of the killing ground, when the main approach gives one. */
  killingGr: XY | null;
  slots: Record<string, Check[]>;
  rows: Check[];
  approaches: FitApproach[];
  /** 0-100 (PlanDoctrine.scoreWeights); fails and warns counted for the ranking. */
  score: number;
  fails: number;
  warns: number;
  pending: boolean;
  data: string;
  /** The enemy's start: the threat marker, or assumed along the front. */
  from: XY | null;
  fromAssumed: boolean;
  /** When the start is assumed: how far in front of the FDL it was put (m). */
  fromAssumedM?: number;
  /** The enemy's likely (or drawn) FUP on the main approach, plan metres. */
  enFup?: XY | null;
  /** The En front / area marked (PlanEnFront): each forward posn's stand-off straight ahead, plan metres, for the map. */
  standLinks?: { role: string; label: string; from: XY; to: XY; dM: number }[];
  /** The En front: posns turned to face their part of it (deg clockwise, by role), forward Coys' Pl posts moved along
   *  their facing (plSpots order), and the FDL laid along it (plan metres, by the FEBA slot's role). Fed to the solver. */
  turns?: Record<string, number>;
  plShift?: Record<string, number[]>;
  frontPaths?: Record<string, XY[]>;
}

// ── frames ───────────────────────────────────────────────────────────────────────────────────────────────────────
export function toWorld(f: FitFrame, p: XY): XY {
  const lx = (p.x - f.pivot.x) * f.k, ly = (p.y - f.pivot.y) * f.k;
  const c = Math.cos(f.bearing), s = Math.sin(f.bearing);
  return { x: f.anchor.x + lx * c + ly * s, y: f.anchor.y - lx * s + ly * c };
}
export function toLocal(f: FitFrame, w: XY): XY {
  const dx = (w.x - f.anchor.x) / f.k, dy = (w.y - f.anchor.y) / f.k;
  const c = Math.cos(f.bearing), s = Math.sin(f.bearing);
  return { x: f.pivot.x + dx * c - dy * s, y: f.pivot.y + dx * s + dy * c };
}
const P = (x: number, y: number): XY => ({ x, y });
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
const WATER = new Set([4, 5, 20, 21, 22, 46]);
const BUA = new Set([3]);

interface Box { role: string; label: string; kind: string; c: XY; w: number; h: number; turn: number; /** Turned on top of `turn` to face an En front (PlanEnFront), deg clockwise. */ face?: number }
const turned = (b: Box) => b.turn % 180 === 90;
const overlap = (a: Box, b: Box, pad: number) => {
  const aw = turned(a) ? a.h : a.w, ah = turned(a) ? a.w : a.h, bw = turned(b) ? b.h : b.w, bh = turned(b) ? b.w : b.h;
  return Math.abs(a.c.x - b.c.x) < (aw + bw) / 2 + pad && Math.abs(a.c.y - b.c.y) < (ah + bh) / 2 + pad;
};
/** Distance (plan metres) from a point to a posn's box; 0 inside it. */
const boxDist = (b: Box, p: XY) => {
  const hw = (turned(b) ? b.h : b.w) / 2, hh = (turned(b) ? b.w : b.h) / 2;
  return Math.hypot(Math.max(0, Math.abs(p.x - b.c.x) - hw), Math.max(0, Math.abs(p.y - b.c.y) - hh));
};
/** A point (u across, v toward the posn's front) of a box, in plan metres. */
const boxPt = (b: Box, u: number, v: number): XY => {
  const t = (b.turn * Math.PI) / 180;
  return P(b.c.x + u * Math.cos(t) + v * Math.sin(t), b.c.y - u * Math.sin(t) + v * Math.cos(t));
};

/** Ground under a posn: 5 x 3 samples. */
/** `hi`: the mean of its five highest samples, the high ground it holds (a knoll inside a 1.5 km posn counts). */
interface GroundRead { known: number; nogo: number; slow: number; water: number; bua: number; centreNogo: boolean; top: number | null; elev: number; hi: number }
function readGround(g: PlanGround, f: FitFrame, b: Box, going: { nogo: ReadonlySet<number>; caution: ReadonlySet<number> }): GroundRead {
  const r: GroundRead = { known: 0, nogo: 0, slow: 0, water: 0, bua: 0, centreNogo: false, top: null, elev: NaN, hi: NaN };
  const count = new Map<number, number>();
  const all: number[] = [];
  let es = 0, en = 0;
  for (const u of [-0.4, -0.2, 0, 0.2, 0.4]) for (const v of [-0.35, 0, 0.35]) {
    const w = toWorld(f, boxPt(b, u * b.w, v * b.h));
    const c = g.cls(w.x, w.y);
    const e = g.elev(w.x, w.y);
    if (Number.isFinite(e)) { es += e; en++; all.push(e); }
    if (c === null) continue;
    r.known++;
    count.set(c, (count.get(c) ?? 0) + 1);
    if (going.nogo.has(c)) { r.nogo++; if (u === 0 && v === 0) r.centreNogo = true; }
    else if (going.caution.has(c)) r.slow++;
    if (WATER.has(c)) r.water++;
    if (BUA.has(c)) r.bua++;
  }
  let best = -1;
  for (const [c, n] of count) if (n > best) { best = n; r.top = c; }
  r.elev = en ? es / en : NaN;
  if (all.length >= 5) { all.sort((a, b) => b - a); r.hi = (all[0] + all[1] + all[2] + all[3] + all[4]) / 5; }
  return r;
}
/**
 * The fit's thresholds, read from PlanDoctrine.json `fit.*` (the figures the code always used are the fallbacks, basis E
 * until the doctrine file cites them): set at the start of each fit.
 */
const TH = { nogoFail: 0.3, nogoWarn: 0.1, buaWarn: 0.3, fofWantM: 270, fofMinCoyM: 100, overlookM: 10, killBand: [400, 1000] as [number, number], killBandCoy: [300, 500] as [number, number], chokeM: 300, deadWarnPct: 40, mgReachM: 457, fupSnapM: 400 };
function readThresholds(doc: DoctrineSet): void {
  const one = (p: string, fb: number) => { const r = resolveRange(doc, doctrineAt(doc, p)); return r ? (r[0] + r[1]) / 2 : fb; };
  const two = (p: string, fb: [number, number]) => resolveRange(doc, doctrineAt(doc, p)) ?? fb;
  TH.nogoFail = one('fit.ground.nogoFailShare', 0.3); TH.nogoWarn = one('fit.ground.nogoWarnShare', 0.1); TH.buaWarn = one('fit.ground.buaWarnShare', 0.3);
  TH.fofWantM = one('fit.fieldOfFire.wantM', 270); TH.overlookM = one('fit.overlookedM', 10);
  TH.killBand = two('fit.killingGr.aheadM', [400, 1000]); TH.chokeM = one('fit.killingGr.chokeM', 300);
  // a Coy or Pl plan: IC's figures (fields of fire 100 m minimum, s72 para 6 b p 372; killing range 300 m, Pl field of
  // fire up to 400 m, s77 para 2 p 425; LMGs open at the 500 m line, s76 para 11 e p 417)
  TH.fofMinCoyM = one('fieldOfFire.minimumCoyM', 100); TH.killBandCoy = two('fit.killingGr.aheadCoyM', [300, 500]);
  TH.deadWarnPct = one('fit.deadGroundWarnPct', 40); TH.mgReachM = one('fit.mgReachM', 457); TH.fupSnapM = one('fit.enFupSnapM', 400);
}

function groundCheck(g: PlanGround, gr: GroundRead, kind: string, buaMin: number | null = null): Check {
  if (!gr.known) return { name: 'Ground', st: 'unchecked', reason: 'no ground data here' };
  const share = (n: number) => Math.round((100 * n) / gr.known);
  const top = gr.top !== null ? g.label(gr.top) : 'unknown';
  if (gr.centreNogo || gr.nogo / gr.known > TH.nogoFail) return { name: 'Ground', st: 'fail', reason: `${share(gr.nogo)} % NO-GO on foot (${top}): move it` };
  if (gr.nogo / gr.known > TH.nogoWarn) return { name: 'Ground', st: 'warn', reason: `${share(gr.nogo)} % NO-GO on foot at its edge (${top})` };
  // the BUA layout (buaMin set, bua.buaShareMin): the locality held in the buildings; mostly outside them it is larger
  // than the BUA there can hold (IC s52 para 1 c p 203); built-up ground is what it wants, never a warning
  if (buaMin !== null && ['fwd', 'round', 'depth', 'res'].includes(kind)) {
    if (gr.bua / gr.known < buaMin) return { name: 'Ground', st: 'warn', reason: `only ${share(gr.bua)} % built-up (${top}): the locality reaches outside the BUA, larger than the built-up area here can hold; a locality in a BUA is of a limited size, in the buildings (IC s52 para 1 c p 203; ${Math.round(buaMin * 100)} % built-up wanted, E): draw it on the blocks of the main route in` };
    return { name: 'Ground', st: 'pass', reason: `${share(gr.bua)} % built-up: the locality in the buildings, fields of fire about 50-100 m (IC s52 para 4 a (3) p 204)` };
  }
  if (gr.bua / gr.known > TH.buaWarn && (kind === 'fwd' || kind === 'round')) return { name: 'Ground', st: 'warn', reason: `${share(gr.bua)} % built-up: short fields of fire (about 50-100 m in a BUA, IC s52 para 4 a (3) p 204), but cover; a locality in a built-up area is of a limited size (IC s52 para 1 c p 203: no figure printed; the 100 m a Pl of IC s55 para 17 a p 229 is the attack's), so the posn's frontage shrinks: hold the edge that covers the approach` };
  if (gr.slow / gr.known > 0.5) return { name: 'Ground', st: 'warn', reason: `${share(gr.slow)} % SLOW-GO on foot (${top})` };
  return { name: 'Ground', st: 'pass', reason: `mostly ${top}` };
}
/**
 * The BUA defence's field of fire at a posn (IC s52 para 4 a (3) p 204: a building for defence 'should have a clear field
 * of fire and observation (approximately from 50 to 100 metres)'): the clear distance on five rays across its front in
 * 25 m steps to the upper figure, the median; under the lower figure it warns (the bundle reads buildings as a density,
 * not walls: confirm). Stands in for the open-ground check (IBB p 279's 200 m) on the BUA layout only.
 */
function buaFofCheck(sight: (a: XY, b: XY) => number | null, front: XY, turn: number, want: [number, number]): Check {
  const clear: number[] = [];
  for (const da of [-30, -15, 0, 15, 30]) {
    const a = ((turn + da) * Math.PI) / 180;
    let reach = 0, ok = true;
    for (let d = 25; d <= want[1] + 1; d += 25) {
      const p = sight(front, P(front.x + d * Math.sin(a), front.y + d * Math.cos(a)));
      if (p === null) { ok = false; break; }
      if (p < 0.5) break;
      reach = d;
    }
    if (ok) clear.push(reach);
  }
  if (clear.length < 3) return { name: 'Fd of fire', st: 'unchecked', reason: 'the ground in front is not loaded' };
  clear.sort((x, y) => x - y);
  const med = clear[Math.floor(clear.length / 2)];
  const st: CheckState = med >= want[0] ? 'pass' : 'warn';
  return { name: 'Fd of fire', st, reason: `about ${med >= want[1] ? `${want[1]} m or more` : `${med} m`} clear across its front: in a BUA a building for defence should have a clear field of fire and observation of approximately ${want[0]}-${want[1]} m (IC s52 para 4 a (3) p 204), not the 200 m of open ground (IBB p 279)${st === 'warn' ? ': the En can get close under cover, and such a building may have to be rejected (IC s52 para 2 p 204); the bundle reads buildings as a density, not walls: confirm on the ground' : ''}` };
}

/** The BUA defence's Fields of fire plan row, on IC's 50-100 m (replaces the open-ground row in place). */
function buaFofRow(rows: Check[], fof: Check[], want: [number, number]): void {
  const r = rows.find((x) => x.name === 'Fields of fire');
  if (!r || r.st === 'unchecked' || !fof.length) return;
  r.st = fof.some((c) => c.st === 'fail') ? 'fail' : fof.some((c) => c.st === 'warn') ? 'warn' : 'pass';
  r.reason = `${fof.filter((c) => c.st === 'pass').length} of ${fof.length} forward localities clear ${want[0]} m or more: about ${want[0]}-${want[1]} m in a BUA (IC s52 para 4 a (3) p 204); fighting is largely at close quarter, mutual support between posts difficult, hence localities of a limited size (IC s52 para 1 c p 203)`;
}

const spotCost = (gr: GroundRead) => (gr.known ? (gr.centreNogo ? 2 : 0) + gr.nogo / gr.known * 3 + gr.slow / gr.known * 0.5 : 5);

// ── the fit ──────────────────────────────────────────────────────────────────────────────────────────────────────
export interface FitInput {
  res: SolveResult;
  recipe: Recipe;
  doc: DoctrineSet;
  frame: FitFrame;
  ground: PlanGround;
  /** The enemy's start (world), or null: assumed along the front. */
  threat?: XY | null;
  /** Approaches already found for this anchor and threat (they do not depend on the layout), or drawn en axes. */
  approaches?: GroundAvenue[] | null;
  /** Who attacks (PlanContext): his approaches use his going and are sized to his corridors; his FUP. */
  enemy?: EnemySpec | null;
  /** The kind of ground: desert flanks, the obstacle tie-in, heights in the mountains. */
  terrain?: TerrainSpec | null;
  /** Check my plan: read the posns where they are drawn, never slide them. */
  checkOnly?: boolean;
  /** Rows a layout's own reader writes in place of the fit's (a reverse slope's Fields of fire): the score reads these first. */
  rowsOver?: Check[];
  /** A drawn enemy FUP (world), used instead of the likely one. */
  enFup?: XY | null;
  /** ITG the user designated on the map (Vital Gr / Imp Gr symbols, world): a posn beside one takes it inside its outline. */
  itgAt?: { at: XY; label: string }[] | null;
  /** The En front line or area marked (world, PlanEnFront): the plan follows its curvature, its rows read against it. */
  front?: EnFront | null;
}

/**
 * The layout as the annex draws it holds through a move (user, 27 Nov 2026: posns turned and stretched round the ground
 * "messes up the whole layout"): the gaps between the forward posns within the row, the forward posns still in front of
 * the depth ones, a depth posn still behind the posn it backs, the depth within the row. Reads `boxes` as they are when
 * called (the gaps, depth and x places it keeps are those at creation). `overlapPad`: also refuse a move onto another posn.
 */
export function layoutGuard(boxes: Box[], recipe: Recipe, doc: DoctrineSet, overlapPad: number | null = null): (b: Box, cand: Box) => string | null {
  const sub = recipe.subRow ? frontageRow(doc, recipe.subRow) : null;
  const rowF = recipe.frontageRow ? frontageRow(doc, recipe.frontageRow) : null;
  const dRow = rowF ?? (recipe.depthRow ? frontageRow(doc, recipe.depthRow) : null);
  const depthBand = dRow?.depthM != null ? resolveRange(doc, dRow.depthM) : null;
  const isFwd = (x: Box) => x.kind === 'fwd' && x.turn === 0, isBack = (x: Box) => x.kind === 'depth' || x.kind === 'res';
  const gapsOf = (list: Box[]) => { const fw = list.filter(isFwd).sort((a, z) => a.c.x - z.c.x); return fw.slice(1).map((x, i) => x.c.x - x.w / 2 - (fw[i].c.x + fw[i].w / 2)); };
  const depthOf = (list: Box[]) => { const fw = list.filter(isFwd), dp = list.filter(isBack); return fw.length && dp.length ? Math.max(...fw.map((x) => x.c.y + x.h / 2)) - Math.min(...dp.map((x) => x.c.y - x.h / 2)) : null; };
  const gap0 = gapsOf(boxes), depth0 = depthOf(boxes), x0: Record<string, number> = Object.fromEntries(boxes.map((x) => [x.role, x.c.x]));
  const gapMax = Math.max(sub?.gapM != null ? sub.gapM * 1.1 : 0, ...gap0.map((v) => v + 50));
  return (b: Box, cand: Box): string | null => {
    if (overlapPad !== null && boxes.some((o) => o !== b && o.role !== b.role && overlap(cand, o, overlapPad))) return 'it would run into the next posn';
    const list = boxes.map((x) => (x === b ? cand : x));
    const gaps = gapsOf(list);
    const wide = gaps.findIndex((v) => v > gapMax + 1);
    if (wide >= 0) return `it would open a gap of ${fmtM(gaps[wide])} between the forward posns (the row gives ${fmtM(sub?.gapM ?? gapMax)})`;
    const fw = list.filter(isFwd), dp = list.filter(isBack);
    if (fw.length && dp.length && Math.min(...fw.map((x) => x.c.y - x.h / 2)) < Math.max(...dp.map((x) => x.c.y + x.h / 2)) - 1) return 'it would bring a depth posn up level with the forward posns';
    if (isBack(b) && Math.abs(cand.c.x - x0[b.role]) > b.w / 2) return 'it would move it out from behind the posn it backs';
    const d = depthOf(list);
    if (d !== null && depthBand && depth0 !== null) {
      const off = (v: number) => Math.max(0, depthBand[0] - v, v - depthBand[1]);
      if (off(d) > off(depth0) + 1) return `it would make the depth ${fmtM(d)} (the row gives ${fmtM(depthBand[0])}-${fmtM(depthBand[1])})`;
    }
    return null;
  };
}

/** The En front's own figures (PlanDoctrine fit.enFront.*: E decisions, M settings). */
function frontFigures(doc: DoctrineSet, bn: boolean) {
  const num = (path: string, fb: number) => { const r = resolveRange(doc, doctrineAt(doc, path)); return r ? (r[0] + r[1]) / 2 : fb; };
  return {
    maxMoveM: num(bn ? 'fit.enFront.moveM.bn' : 'fit.enFront.moveM.coy', bn ? 600 : 300),
    minMoveM: num('fit.enFront.minMoveM', 25),
    bulgeM: num(bn ? 'fit.enFront.salientM.bn' : 'fit.enFront.salientM.coy', bn ? 400 : 200),
    spreadWarnM: num(bn ? 'fit.enFront.spreadWarnM.bn' : 'fit.enFront.spreadWarnM.coy', bn ? 300 : 150),
    turnMaxDeg: num('fit.enFront.turnMaxDeg', 45),
    edgeBendM: num(bn ? 'fit.enFront.edgeBendM.bn' : 'fit.enFront.edgeBendM.coy', bn ? 350 : 125),
  };
}

/** What the En front lays on a plan once its posns are where they end: front edges, Pl posts, the FDL, the turns. */
interface FrontLaid { edges: FrontEdges; turns: Record<string, number>; plShift: Record<string, number[]>; paths: Record<string, XY[]> }
function layFront(boxes: Box[], lf: LocalFront, refM: number, recipe: Recipe, doc: DoctrineSet, fg: ReturnType<typeof frontFigures>, base: Record<string, [number, number][]>): FrontLaid {
  const pls = Object.fromEntries(recipe.slots.filter((s) => s.kind === 'fwd' && s.echelon === '15').map((s) => [s.role, plSpots(doc, s.pls)]));
  const edges = frontEdges(boxes, lf, refM, fg, base, pls);
  const turns = Object.fromEntries(boxes.filter((b) => b.face).map((b) => [b.role, b.face!]));
  // the FEBA laid through the forward posns' front edges (recipe rule joins ... edge front): along the En front
  const fdlRole = recipe.slots.find((s) => s.sym === '25140400' && (s.rule as any)?.joins && (s.rule as any)?.edge !== 'outer')?.role;
  const curve = fdlRole ? fdlCurve(lf, boxes, refM) : [];
  return { edges, turns, plShift: edges.plShift, paths: fdlRole && curve.length >= 2 ? { [fdlRole]: curve } : {} };
}

/** From each forward posn's front edge to the nearest point of the En front, for the map (plan metres). */
function standLinksOf(boxes: Box[], lf: LocalFront, edges: Record<string, XY[]>): NonNullable<FitResult['standLinks']> {
  const near = (p: XY): XY => {
    let best = p, bd = Infinity;
    const pts = lf.pts, n = pts.length, segN = lf.closed ? n : n - 1;
    for (let i = 0; i < segN; i++) {
      const a = pts[i], z = pts[(i + 1) % n];
      const dx = z.x - a.x, dy = z.y - a.y, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
      const q = P(a.x + t * dx, a.y + t * dy), d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  };
  return boxes.filter((b) => b.kind === 'fwd' && b.turn % 180 === 0).flatMap((b) => {
    const edge = edges[b.role] ?? [P(b.c.x - 0.3 * b.w, b.c.y + b.h / 2), P(b.c.x, b.c.y + b.h / 2), P(b.c.x + 0.3 * b.w, b.c.y + b.h / 2)];
    let from: XY | null = null, d = Infinity;
    for (const p of edge) { const v = standDist(lf, p); if (v > 0 && v < d) { d = v; from = p; } }
    return from ? [{ role: b.role, label: b.label, from, to: near(from), dM: Math.round(d) }] : [];
  });
}

/**
 * The plan shaped to the En front with no terrain (geometry mode): the same moves fitPlan makes (forward posns straight
 * forward or back to keep the stand-off as placed, the posns behind them with them, the layout held), and its rows.
 */
export interface FrontNudges {
  nudges: Record<string, XY>; turns: Record<string, number>; plShift: Record<string, number[]>;
  outlines: Record<string, [number, number][]>; paths: Record<string, XY[]>; rows: Check[]; shape: FrontShape | null;
}
export function frontNudges(res: SolveResult, recipe: Recipe, doc: DoctrineSet, frame: FitFrame, front: EnFront | null): FrontNudges {
  const none: FrontNudges = { nudges: {}, turns: {}, plShift: {}, outlines: {}, paths: {}, rows: [], shape: null };
  if (!frontValid(front) || recipe.task !== 'defence') return none;
  const bn = (levelOf(recipe.echelon) ?? 2) >= 2;
  const fg = frontFigures(doc, bn);
  const boxes: Box[] = res.slots.map((s) => ({ role: s.role, label: s.label, kind: s.kind, c: { ...s.centre }, w: s.wM, h: s.hM, turn: s.turnDeg }));
  const lf = frontLocal(front, frame);
  const shape = shapeToFront(boxes, lf, fg, layoutGuard(boxes, recipe, doc, 50));
  const laid = shape.refM !== null ? layFront(boxes, lf, shape.refM, recipe, doc, fg, {}) : null;
  const rows = frontRows(readFront(lf, boxes, fg.bulgeM, laid?.edges.edges ?? {}), front.kind, shape, fg.spreadWarnM, laid?.edges ?? null);
  return { nudges: shape.nudges, turns: laid?.turns ?? {}, plShift: laid?.plShift ?? {}, outlines: laid?.edges.outlines ?? {}, paths: laid?.paths ?? {}, rows, shape };
}

/** The En front's rows on a plan read as drawn (Check my plan without the terrain): nothing moved. */
export function frontCheckRows(res: SolveResult, recipe: Recipe, doc: DoctrineSet, frame: FitFrame, front: EnFront | null): Check[] {
  if (!frontValid(front)) return [];
  const fg = frontFigures(doc, (levelOf(recipe.echelon) ?? 2) >= 2);
  const boxes: Box[] = res.slots.map((s) => ({ role: s.role, label: s.label, kind: s.kind, c: { ...s.centre }, w: s.wM, h: s.hM, turn: s.turnDeg }));
  return frontRows(readFront(frontLocal(front, frame), boxes, fg.bulgeM), front.kind, null, fg.spreadWarnM);
}

/** The attack's rows against a marked En area / front: own control measures outside it, the Obj on it (world items). */
export function attackFront(res: SolveResult, frame: FitFrame, front: EnFront | null): Check[] {
  if (!frontValid(front)) return [];
  const items = res.items.filter((i) => i.pts?.length).map((i) => ({ role: i.role, label: i.label ?? i.role, world: i.pts.map((p) => toWorld(frame, p)) }));
  return attackFrontRows(front, items, 500);
}

export function fitPlan(inp: FitInput): FitResult {
  readThresholds(inp.doc);
  if (inp.recipe.task === 'attack') return fitAttack(inp);
  const { res, recipe, doc, frame: f, ground: g } = inp;
  const num = (path: string, fb: number) => { const r = resolveRange(doc, doctrineAt(doc, path)); return r ? (r[0] + r[1]) / 2 : fb; };
  const foot = g.going('dismounted'), tank = g.going('tracked');
  // a Bn plan or bigger (a Bde plan's posns are Bn localities): Bn weapons' reach, the enemy's start further out
  const bn = (levelOf(recipe.echelon) ?? 2) >= 2;
  const slideMax = num(bn ? 'fit.slideMaxM.bn' : 'fit.slideMaxM.coy', bn ? 700 : 400);
  const en = inp.enemy ?? null;
  const kindT: TerrainKind = inp.terrain?.kind ?? 'plains';
  const kindOf = (role: string) => recipe.slots.find((s) => s.role === role)?.kind ?? '';
  const boxes: Box[] = res.slots.map((s) => ({ role: s.role, label: s.label, kind: s.kind, c: { ...s.centre }, w: s.wM, h: s.hM, turn: s.turnDeg }));
  const out: FitResult = { nudges: {}, slides: [], killingGr: null, slots: {}, rows: [], approaches: [], score: 0, fails: 0, warns: 0, pending: false, data: g.dataLine(), from: null, fromAssumed: false };

  // 0. the En front or area marked (PlanEnFront; user, 27 Nov 2026): the plan follows its curvature, each forward posn
  // moved whole straight forward or back to stand as far from it as the plan's axis does where it was put, the posns
  // behind it with it, the layout held; read as drawn in Check my plan
  const front = frontValid(inp.front) && recipe.task === 'defence' ? inp.front : null;
  const fg = frontFigures(doc, bn);
  let frontShape: FrontShape | null = null;
  // where each posn started: every move below changes its centre, and the nudges are worked out from here at the end
  const start: Record<string, XY> = Object.fromEntries(boxes.map((x) => [x.role, { ...x.c }]));
  if (front && !inp.checkOnly) frontShape = shapeToFront(boxes, frontLocal(front, f), fg, layoutGuard(boxes, recipe, doc, 50));

  // 1. slide posns out of NO-GO (nearest spot whose ground does not fail, clear of the other posns)
  for (const b of inp.checkOnly ? [] : boxes) {
    const here = readGround(g, f, b, foot);
    if (groundCheck(g, here, b.kind).st !== 'fail') continue;
    let best: { c: XY; cost: number; d: number } | null = null;
    for (let r = 100; r <= slideMax && !best; r += 100) {
      for (let k = 0; k < 12; k++) {
        const a = (k * Math.PI) / 6;
        const cand: Box = { ...b, c: P(b.c.x + r * Math.cos(a), b.c.y + r * Math.sin(a)) };
        if (boxes.some((o) => o !== b && overlap(cand, o, 50))) continue;
        const gr = readGround(g, f, cand, foot);
        if (groundCheck(g, gr, b.kind).st === 'fail') continue;
        const cost = spotCost(gr);
        if (!best || cost < best.cost) best = { c: cand.c, cost, d: r };
      }
    }
    if (best) {
      out.nudges[b.role] = P(best.c.x - b.c.x, best.c.y - b.c.y);
      out.slides.push({ role: b.role, label: b.label, distM: best.d, why: 'nogo' });
      b.c = best.c;
    }
  }

  // the layout as the annex draws it holds through a move (user, 27 Nov 2026: posns turned and stretched round the
  // ground "messes up the whole layout"): the gaps between the forward posns within the row, the forward posns still
  // in front of the depth ones, a depth posn still behind the posn it backs, the depth within the row
  const layoutBreak = layoutGuard(boxes, recipe, doc);
  const orig: Record<string, XY> = Object.fromEntries(boxes.map((x) => [x.role, { ...x.c }]));

  // 1a. the ITG the user drew on the map (Vital / Imp Gr): the posn nearest it moves whole until the ITG lies inside
  // it, its size and shape kept; a move that breaks the layout is not made, and the row says why (user, 27 Nov 2026)
  out.itg = {};
  if (!inp.checkOnly && inp.itgAt?.length) {
    const reach = num(bn ? 'fit.itg.reachM.bn' : 'fit.itg.reachM.coy', bn ? 400 : 200), margin = num('fit.itg.marginM', 100);
    for (const t of inp.itgAt) {
      const p = toLocal(f, t.at);
      const owner = [...boxes].sort((a, z) => boxDist(a, p) - boxDist(z, p))[0];
      if (!owner || out.itg[owner.role]) continue;
      const d = boxDist(owner, p);
      if (d > reach) continue;
      // the shift that brings the ITG inside the box, `margin` in from its edge (in the box's own frame, then turned back)
      const tr = (owner.turn * Math.PI) / 180, dx = p.x - owner.c.x, dy = p.y - owner.c.y;
      const u = dx * Math.cos(tr) - dy * Math.sin(tr), v = dx * Math.sin(tr) + dy * Math.cos(tr);
      const hw = Math.max(0, owner.w / 2 - margin), hh = Math.max(0, owner.h / 2 - margin);
      const du = u > hw ? u - hw : u < -hw ? u + hw : 0, dv = v > hh ? v - hh : v < -hh ? v + hh : 0;
      if (!du && !dv) { out.itg[owner.role] = { label: t.label, distM: 0 }; continue; }
      const cand: Box = { ...owner, c: P(owner.c.x + du * Math.cos(tr) + dv * Math.sin(tr), owner.c.y - du * Math.sin(tr) + dv * Math.cos(tr)) };
      const shift = Math.hypot(du, dv);
      const why = boxes.some((o) => o !== owner && overlap(cand, o, 50)) ? 'it would run into the next posn'
        : groundCheck(g, readGround(g, f, cand, foot), owner.kind).st === 'fail' ? 'the ground there fails (NO-GO, water or a built-up area)'
        : layoutBreak(owner, cand);
      if (why) { out.itg[owner.role] = { label: t.label, distM: null, why }; continue; }
      owner.c = cand.c;
      out.nudges[owner.role] = P(owner.c.x - orig[owner.role].x, owner.c.y - orig[owner.role].y);
      out.itg[owner.role] = { label: t.label, distM: Math.round(shift) };
    }
  }

  // 1b. up to the higher ground nearby (user: a posn sits near the top of a plateau or on higher ground): a posn not
  // slid out of NO-GO moves a short way when the ground there stands clearly higher on average (E figures); the layout
  // holds (as the ITG move)
  const hiGain = num('fit.highGround.gainM', 8), hiMove = num(bn ? 'fit.highGround.moveM.bn' : 'fit.highGround.moveM.coy', bn ? 400 : 200);
  for (const b of inp.checkOnly ? [] : boxes) {
    if (out.nudges[b.role]) continue;
    const here = readGround(g, f, b, foot);
    if (!Number.isFinite(here.hi) || groundCheck(g, here, b.kind).st === 'fail') continue;
    let best: { c: XY; score: number; d: number; rise: number } | null = null;
    for (let r = 100; r <= hiMove; r += 100) {
      for (let k = 0; k < 8; k++) {
        // with an En front marked a forward posn keeps its stand-off: it moves up to higher ground along the front only
        if (front && b.kind === 'fwd' && k % 4 !== 0) continue;
        const a = (k * Math.PI) / 4;
        const cand: Box = { ...b, c: P(b.c.x + r * Math.cos(a), b.c.y + r * Math.sin(a)) };
        if (boxes.some((o) => o !== b && overlap(cand, o, 50)) || layoutBreak(b, cand)) continue;
        const gr = readGround(g, f, cand, foot);
        if (!Number.isFinite(gr.hi) || groundCheck(g, gr, b.kind).st !== 'pass') continue;
        const rise = gr.hi - here.hi;
        const score = rise - r / 100;   // a metre of height is worth 100 m of move (E)
        if (rise >= hiGain && (!best || score > best.score)) best = { c: cand.c, score, d: r, rise };
      }
    }
    if (best) {
      out.nudges[b.role] = P(best.c.x - b.c.x, best.c.y - b.c.y);
      out.slides.push({ role: b.role, label: b.label, distM: best.d, why: 'high', riseM: Math.round(best.rise) });
      b.c = best.c;
    }
  }
  // every move made (the En front, NO-GO, the ITG, high ground) as one nudge from where the posn started
  for (const b of boxes) {
    const s0 = start[b.role];
    if (s0 && (Math.abs(b.c.x - s0.x) > 0.01 || Math.abs(b.c.y - s0.y) > 0.01)) out.nudges[b.role] = P(b.c.x - s0.x, b.c.y - s0.y);
  }

  // 1c. each posn's outline bent to the ground (PlanShape): a point of the curve moves in or out by up to a quarter of
  // the posn's half-size, out over higher ground and in off obstacles (NO-GO, water, built-up areas), never into another
  // posn's curve; size and shape as the annex draws them; the echelon segment (the rear side) stays (user, 15 and 27
  // Nov 2026; E figures)
  out.outlines = {};
  if (!inp.checkOnly) {
    const sc = resolveRange(doc, doctrineAt(doc, 'fit.outline.scales')) ?? [0.75, 1.25];
    const pr: ShapeParams = { scales: [sc[0], sc[1]], perTenthM: num('fit.outline.perTenthM', 4), clearM: num('fit.outline.clearM', 40) };
    const sg: ShapeGround = { toWorld: (p) => toWorld(f, p), cls: (x, y) => g.cls(x, y), elev: (x, y) => g.elev(x, y), water: WATER, nogo: foot.nogo, bua: BUA };
    const curves = new Map(boxes.map((x) => [x.role, curveOf(x)]));
    for (const b of boxes) {
      const shape = shapePosn(b, boxes.filter((o) => o !== b).map((o) => curves.get(o.role)!), sg, pr);
      if (shape) { out.outlines[b.role] = shape; curves.set(b.role, curveOf(b, shape)); }
    }
  }
  // 1d. the En front: each forward posn's front edge on its curve (the rear side from the ground's outline), the forward
  // Coys' Pl posts with it, the FDL along it, the turns (user, 27 Nov 2026)
  let frontLaid: FrontLaid | null = null;
  if (front && frontShape?.refM != null) {
    frontLaid = layFront(boxes, frontLocal(front, f), frontShape.refM, recipe, doc, fg, out.outlines);
    Object.assign(out.outlines, frontLaid.edges.outlines);
    out.turns = frontLaid.turns;
    out.plShift = frontLaid.plShift;
    out.frontPaths = frontLaid.paths;
  }

  // 2. posn by posn: ground, fields of fire, what overlooks it
  const eye = 1.7, tgt = 1.7;
  const sight = g.sight ? (a: XY, b: XY, e = eye, t = tgt) => { const wa = toWorld(f, a), wb = toWorld(f, b); return g.sight!(wa.x, wa.y, e, wb.x, wb.y, t); } : null;
  const fofMin = num('fieldOfFire.minimumM', 200); // IBB p279 (PlanDoctrine.fieldOfFire.minimumM once added)
  let deadShare: number[] = [];
  let overlooked: string[] = [];
  // the BUA defence's own guard (IC s52): the localities in the buildings, fields of fire about 50-100 m
  const buaDef = recipe.layout === 'bua' && recipe.task === 'defence';
  const buaFof: [number, number] = resolveRange(doc, doctrineAt(doc, 'bua.fofM')) ?? [50, 100];
  const buaMin = buaDef ? num('bua.buaShareMin', 0.5) : null;
  for (const b of boxes) {
    const checks: Check[] = [];
    const gr = readGround(g, f, b, foot);
    const gc = groundCheck(g, gr, b.kind, buaMin);
    const slid = out.slides.find((s) => s.role === b.role);
    const it = out.itg?.[b.role];
    if (slid && gc.st !== 'fail' && !(it && it.distM)) gc.reason += slid.why === 'high' ? `; moved ${fmtM(slid.distM)} up to ground ${slid.riseM} m higher, confirm on the ground` : `; slid ${fmtM(slid.distM)} out of NO-GO, confirm on the ground`;
    if (it) gc.reason += it.distM === null ? `; ${it.label} not taken in: ${it.why}, so it stays as the annex lays it` : it.distM ? `; moved ${fmtM(it.distM)} to take in ${it.label}` : `; holds ${it.label}`;
    if (out.outlines?.[b.role]) gc.reason += '; its outline follows the ground, off obstacles';
    checks.push(gc);
    const isFront = b.kind === 'fwd' || b.kind === 'round';
    if (isFront) {
      if (sight) {
        // clear distance along five rays across the posn's front, the median of them (IBB p279: 200 m minimum; IC s72: 270-500 m wanted)
        const front = boxPt(b, 0, b.h / 2);
        const clear: number[] = [];
        let known = 0;
        for (const da of [-30, -15, 0, 15, 30]) {
          const a = ((b.turn + da) * Math.PI) / 180;
          let reach = 0;
          let ok = true;
          for (const d of [100, 200, 270, 350, 500]) {
            const p = sight(front, P(front.x + d * Math.sin(a), front.y + d * Math.cos(a)));
            if (p === null) { ok = false; break; }
            if (p < 0.5) break;
            reach = d;
          }
          if (ok) { known++; clear.push(reach); }
        }
        if (known >= 3) {
          clear.sort((x, y) => x - y);
          const med = clear[Math.floor(clear.length / 2)];
          // a Coy or Pl plan: IC's 100 m minimum acceptable (s72 para 6 b p 372) beside IBB's 200 m (p 279): the books
          // differ, so 100-199 m warns there, never fails (a Bn plan and up keeps IBB's)
          const coyPl = !bn && Number.isFinite(TH.fofMinCoyM) && TH.fofMinCoyM < fofMin;
          const st: CheckState = med >= TH.fofWantM ? 'pass' : med >= fofMin ? 'warn' : coyPl && med >= TH.fofMinCoyM ? 'warn' : 'fail';
          checks.push({ name: 'Fd of fire', st, reason: `about ${med >= 500 ? '500 m or more' : fmtM(med)} clear across its front (${coyPl ? `IC s72 para 6 b p 372: ${TH.fofMinCoyM} m minimum acceptable, 270-500 m desirable; IBB p279 asks ${fofMin} m` : `IBB p279: ${fofMin} m minimum; IC s72 para 6 b p 372: 270-500 m wanted`})` });
          if (buaDef) checks[checks.length - 1] = buaFofCheck(sight, front, b.turn, buaFof);
          // dead ground 300-1200 m out
          let seen = 0, n = 0;
          for (const da of [-25, 0, 25]) for (const d of [300, 700, 1200]) {
            const a = ((b.turn + da) * Math.PI) / 180;
            const p = sight(front, P(front.x + d * Math.sin(a), front.y + d * Math.cos(a)));
            if (p === null) continue;
            n++; if (p >= 0.5) seen++;
          }
          if (n) deadShare.push(1 - seen / n);
        } else checks.push({ name: 'Fd of fire', st: 'unchecked', reason: 'the ground in front is not loaded' });
      } else checks.push({ name: 'Fd of fire', st: 'unchecked', reason: 'no sight data in the bundle' });
      // overlooked: ground 500-1500 m in front higher than the posn
      if (Number.isFinite(gr.elev)) {
        let hi = -Infinity;
        for (const d of [500, 1000, 1500]) for (const da of [-20, 0, 20]) {
          const a = ((b.turn + da) * Math.PI) / 180;
          const fp = boxPt(b, 0, b.h / 2);
          const w = toWorld(f, P(fp.x + d * Math.sin(a), fp.y + d * Math.cos(a)));
          const e = g.elev(w.x, w.y);
          if (Number.isFinite(e)) hi = Math.max(hi, e);
        }
        if (Number.isFinite(hi) && hi - gr.elev >= TH.overlookM) { overlooked.push(b.label); checks.push({ name: 'Overlooked', st: 'warn', reason: `ground in front is ${Math.round(hi - gr.elev)} m higher` }); }
      }
    }
    out.slots[b.role] = checks;
  }

  // 3. approaches: from the threat (or assumed out along the front) to the plan
  const fwdBoxes = boxes.filter((b) => b.kind === 'fwd' || b.kind === 'round');
  const frontY = fwdBoxes.length ? Math.max(...fwdBoxes.map((b) => b.c.y + (turned(b) ? b.w : b.h) / 2)) : 0;
  // where the enemy is heading: the middle of the FDL (all round: the plan's middle). The same point however the plan
  // is read (built, or drawn and checked again), so the approaches found are the same
  const fdl = boxes.filter((b) => b.kind === 'fwd');
  const fdlX = fdl.length && !boxes.some((b) => b.kind === 'round') ? (Math.min(...fdl.map((b) => b.c.x - (turned(b) ? b.h : b.w) / 2)) + Math.max(...fdl.map((b) => b.c.x + (turned(b) ? b.h : b.w) / 2))) / 2 : null;
  const centre = fdlX !== null ? toWorld(f, P(fdlX, frontY)) : toWorld(f, P(0, 0));
  let from = inp.threat ?? null;
  // with no point marked, the En front: straight ahead of the FDL's middle, else its nearest point
  if (!from && front) {
    const ahead = rayAhead(frontLocal(front, f), fdlX ?? 0, frontY);
    from = ahead !== null && ahead > 0 ? toWorld(f, P(fdlX ?? 0, frontY + ahead)) : nearestOnFront(front, toWorld(f, P(fdlX ?? 0, frontY))).at;
  }
  if (!from) {
    const startM = num(bn ? 'fit.assumedStartM.bn' : 'fit.assumedStartM.coy', bn ? 5000 : 3000);
    from = toWorld(f, P(fdlX ?? 0, frontY + startM)); out.fromAssumed = true; out.fromAssumedM = startM;
  }
  out.from = from;
  // the enemy's approaches: his own going (Inf on foot, Mech / Armd tracked), chokes narrower than his corridors
  const profile = en ? enemyProfile(doc, en.type) : 'tracked';
  const corridor = en ? enemyCorridorM(doc, en.echelon) : num('alt.spacingM.coy', 500);
  const avs = inp.approaches !== undefined ? inp.approaches : g.avenues ? g.avenues(from, centre, corridor, profile) : null;
  const reach = bn ? num('attack.bofRangeMaxM', 1189) : TH.mgReachM;
  const moverWord = profile === 'dismounted' ? 'foot' : 'tracked';
  const narrowOf = (a: { chokes: { widthM: number }[]; minWidthM: number }) => (a.chokes.length ? Math.min(...a.chokes.map((c) => c.widthM)) : null);
  if (avs === null) out.rows.push({ name: 'Approaches covered', st: 'unchecked', reason: g.avenues ? 'the ground between is not loaded yet' : 'no road / going grid in the bundle' });
  // none found is not proof none exist (the search box, a start on NO-GO): grey, never a Pass
  else if (!avs.length) out.rows.push({ name: 'Approaches covered', st: 'unchecked', reason: `no ${moverWord} approach found from ${out.fromAssumed ? 'the front' : 'the threat'} to the plan: confirm the ground is NO-GO ${profile === 'dismounted' ? 'on foot' : 'for tanks'}` });
  else {
    avs.slice(0, 3).forEach((a, i) => {
      // posns that have the approach under direct fire inside 2 km of the plan
      // judged where the enemy closes: the stretch from the FDL out to 1.5 km in front of it
      const near = a.path.filter((p) => { const l = toLocal(f, p); return l.y >= frontY - 200 && l.y <= frontY + 1500; });
      // reach from the nearest edge of the posn: its weapons are spread across its frontage, not stacked at its centre
      const coveredBy = fwdBoxes.filter((b) => near.some((p) => boxDist(b, toLocal(f, p)) <= reach)).map((b) => b.role);
      // capacity (OOW1 s5 para 22 a p 16: guard each approach in strength by its capacity): its narrowest choke against his corridors
      const narrowest = narrowOf(a);
      const carries = !en ? null : narrowest === null ? en.echelon : approachCarries(doc, narrowest);
      const full = !en || (carries !== null && (levelOf(carries) ?? 0) >= (levelOf(en.echelon) ?? 0));
      out.approaches.push({ id: `A${i + 1}`, main: false, path: a.path, lengthM: a.lengthM, goPct: a.goPct, minWidthM: a.minWidthM, chokes: a.chokes, coveredBy, carries, full });
    });
    // the main approach: the first (least cost) that carries the enemy's echelon; else the first
    (out.approaches.find((a) => a.full) ?? out.approaches[0]).main = true;
    // an approach that carries his main effort must be under fire; a narrower one wants a screen at least
    const unc = out.approaches.filter((a) => !a.coveredBy.length);
    const st: CheckState = unc.some((a) => a.main || (en && a.full)) ? 'fail' : unc.length ? 'warn' : 'pass';
    const lab = (r: string) => boxes.find((b) => b.role === r)?.label ?? r;
    const cap = (a: FitApproach) => (!en ? '' : a.full ? `, takes an en ${echelonLabel(doc, en.echelon)}` : a.carries ? `, narrow: an en ${echelonLabel(doc, a.carries)} at most` : ', narrower than a Coy corridor (single file through a gap)');
    out.rows.push({ name: 'Approaches covered', st, reason: out.approaches.map((a) => `${a.id}${a.main ? ' (main)' : ''} ${a.coveredBy.length ? `under fire from ${a.coveredBy.map(lab).join(', ')}` : `NOT under direct fire within ${fmtM(reach)}`}${cap(a)}, ${Math.round(a.goPct)} % GO, narrowest ${fmtM(narrowOf(a) ?? a.minWidthM)}`).join('; ') + (en ? ` (${moverWord} going; an en ${echelonLabel(doc, en.echelon)} attacks on ${fmtM(corridor)} corridors, IPB p 7)` : '') + (out.fromAssumed ? ' (enemy start assumed along the front)' : '') });
    if (en && !out.approaches.some((a) => a.full)) out.rows.push({ name: 'Approach capacity', st: 'pass', reason: `no approach here is ${fmtM(corridor)} wide at its narrowest: an en ${echelonLabel(doc, en.echelon)} must come on a narrower front or file through the chokepoints, where fire and obstacles hurt the En most` });
    // killing ground: on the main approach, 400-1000 m ahead of the FDL (a Coy / Pl plan: IC's 300-500 m), inside the forward posns' reach
    const kb = bn ? TH.killBand : TH.killBandCoy;
    const main = out.approaches.find((a) => a.main) ?? out.approaches[0];
    let best: { p: XY; score: number } | null = null;
    for (const w of main.path) {
      const l = toLocal(f, w);
      const ahead = l.y - frontY;
      if (ahead < kb[0] || ahead > kb[1]) continue;
      const inRange = fwdBoxes.filter((b) => boxDist(b, l) <= reach).length;
      if (!inRange) continue;
      const choke = main.chokes.some((c) => Math.hypot(c.at.x - w.x, c.at.y - w.y) / f.k < TH.chokeM) ? 1 : 0;
      const sc = inRange + choke * 2;
      if (!best || sc > best.score) best = { p: l, score: sc };
    }
    out.killingGr = best?.p ?? null;
  }

  // 3b. the main approach the responsibility of one forward posn: "responsibility of defending an approach is not divided
  // between two platoons" (IC s74 para 4 a (1) p 382; between two Coys, MIB p 171 para 23 c). Where it comes in is read
  // 150-600 m in front of the FDL (the path's last stretch bends to the FDL's middle, the point it is searched to; M).
  // The layout stays as the annex draws it: the row warns and says how far a shift of the whole plan takes it in
  {
    const fwOnly = boxes.filter((b) => b.kind === 'fwd');
    if (fwOnly.length >= 2 && !boxes.some((b) => b.kind === 'round')) {
      const hw = (b: Box) => (turned(b) ? b.h : b.w) / 2;
      const fw = fwOnly.map((b) => ({ b, x0: b.c.x - hw(b), x1: b.c.x + hw(b) })).sort((a, b) => a.x0 - b.x0);
      const mainR = out.approaches.find((a) => a.main) ?? null;
      const NAME = 'Approach responsibility', RULE = 'IC s74 para 4 a (1) p 382; MIB p 171 para 23 c';
      if (!mainR) out.rows.push({ name: NAME, st: 'unchecked', reason: 'needs the approaches: no main approach read here' });
      else {
        const loc = mainR.path.map((w) => toLocal(f, w));
        const band = loc.filter((l) => l.y >= frontY + 150 && l.y <= frontY + 600);
        const beyond = loc.filter((l) => l.y > frontY + 150).sort((a, b) => a.y - b.y)[0];
        const x = band.length ? band.reduce((a, l) => a + l.x, 0) / band.length : beyond ? beyond.x : null;
        const frontW = fw[fw.length - 1].x1 - fw[0].x0;
        if (x === null) out.rows.push({ name: NAME, st: 'unchecked', reason: `${mainR.id} does not run 150-600 m in front of the FDL here: judge on the ground which posn holds it` });
        // open ground: the approach as wide as the whole front is no one line to give a posn (its path only runs to the
        // FDL's middle because that is where it was searched to)
        else if (mainR.minWidthM >= frontW) out.rows.push({ name: NAME, st: 'unchecked', reason: `${mainR.id} (main) is ${fmtM(mainR.minWidthM)} wide at its narrowest, wider than the ${fmtM(frontW)} front: no one line to give a posn; on the ground, give each approach into the area to one posn (${RULE})` });
        else {
          const inside = fw.find((p) => x >= p.x0 && x <= p.x1);
          let gapAt = -1;
          for (let i = 1; i < fw.length; i++) if (x > fw[i - 1].x1 && x < fw[i].x0) gapAt = i;
          if (inside) out.rows.push({ name: NAME, st: 'pass', reason: `${mainR.id} (main) comes in on ${inside.b.label}'s front: one posn holds it (${RULE})` });
          else if (gapAt < 0) {
            const lt = x < fw[0].x0, p = lt ? fw[0] : fw[fw.length - 1];
            out.rows.push({ name: NAME, st: 'pass', reason: `${mainR.id} (main) comes in beyond the ${lt ? 'Lt' : 'Rt'} flank, ${fmtM(Math.abs(x - (lt ? p.x0 : p.x1)))} out: ${p.b.label} is responsible for it (${RULE})` });
          } else {
            const a = fw[gapAt - 1], b = fw[gapAt];
            const toA = x - a.x1, toB = b.x0 - x, inM = 100;
            out.rows.push({
              name: NAME, st: 'warn',
              reason: `${mainR.id} (main) comes in through the gap between ${a.b.label} and ${b.b.label} (${fmtM(toA)} from ${a.b.label}, ${fmtM(toB)} from ${b.b.label}): the responsibility for defending it is divided between two posns (${RULE})`,
              detail: {
                head: `${mainR.id} on the gap between ${a.b.label} and ${b.b.label}`,
                why: 'An approach split between two posns is held by neither: each covers it at the edge of its arcs, and the En meets the seam between them (IC s74 para 4 a (1) p 382).',
                fix: [
                  `Shift the whole plan ${fmtM(toA + inM)} Rt so the approach lies inside ${a.b.label}'s frontage, or ${fmtM(toB + inM)} Lt for ${b.b.label}'s (the layout stays as drawn)`,
                  `Or name ${toA <= toB ? a.b.label : b.b.label} responsible for it: its arcs, the mines and a DF on the approach, the other posn in support`,
                ],
              },
            });
          }
        }
      }
    }
  }

  // the enemy's FUP: drawn, or the likely one on the main approach at his FUP distance (IBB p201 inf, p214 tanks)
  const mainA = out.approaches.find((a) => a.main) ?? null;
  if (en || inp.enFup) {
    const band = en ? enemyFupM(doc, en.type) : [1000, 1200];
    let fp: XY | null = inp.enFup ? toLocal(f, inp.enFup) : null;
    if (!fp && mainA) {
      const want = (band[0] + band[1]) / 2;
      let bd = Infinity;
      for (const w of mainA.path) { const l = toLocal(f, w); const d = Math.abs(l.y - frontY - want); if (d < bd) { bd = d; fp = l; } }
      if (bd > TH.fupSnapM) fp = null;
    }
    out.enFup = fp;
    const what = inp.enFup ? 'The drawn en FUP' : `The likely en FUP on ${mainA?.id ?? 'the main approach'}`;
    if (!fp) out.rows.push({ name: 'En FUP', st: 'unchecked', reason: mainA ? `the main approach does not run ${fmtM(band[0])}-${fmtM(band[1])} out from the FDL here: find the En FUP on the ground` : 'needs the approaches' });
    else if (!sight) out.rows.push({ name: 'En FUP', st: 'unchecked', reason: 'no sight data in the bundle' });
    else {
      const seenBy = fwdBoxes.filter((b) => { const p = sight(boxPt(b, 0, b.h / 2), fp!, 2, 2); return p !== null && p >= 0.5; }).map((b) => b.label);
      const known = fwdBoxes.some((b) => sight(boxPt(b, 0, b.h / 2), fp!, 2, 2) !== null);
      const out_ = Math.max(0, fp.y - frontY);
      const why = en && !inp.enFup ? ` (${en.type === 'inf' ? 'infantry FUP 1000-1200 m, IBB p201' : 'tank FUP 2500-3000 m, IBB p214'})` : '';
      out.rows.push(!known
        ? { name: 'En FUP', st: 'unchecked', reason: 'the ground between is not loaded' }
        : seenBy.length
          ? { name: 'En FUP', st: 'pass', reason: `${what}, about ${fmtM(out_)} out${why}, is likely in view from ${seenBy.join(', ')}: an OP on it and a DF target` }
          : { name: 'En FUP', st: 'warn', reason: `${what}, about ${fmtM(out_)} out${why}, is likely dead ground to the forward posns: watch it with an OP, LP or standing patrol and put a DF target on it` });
    }
  }

  // 4. plan rows: flanks, fields of fire / dead ground, exposure
  // a plan with any posn turned off the front (all round: 90 / 180 / 270, or 120 / 240) has no flanks
  if (fwdBoxes.length && boxes.every((b) => ((b.turn % 360) + 360) % 360 === 0)) {
    const left = Math.min(...fwdBoxes.map((b) => b.c.x - b.w / 2)), right = Math.max(...fwdBoxes.map((b) => b.c.x + b.w / 2));
    const side = (x0: number, dir: number) => {
      // every 50 m out to 1 km, so a canal or drain 60 m wide is not stepped over
      for (let d = 50; d <= 1000; d += 50) for (const y of [frontY - 200, frontY]) {
        const w = toWorld(f, P(x0 + dir * d, y));
        const c = g.cls(w.x, w.y);
        if (c !== null && tank.nogo.has(c)) return g.label(c);
      }
      return null;
    };
    const l = side(left, -1), r = side(right, 1);
    const desert = kindT === 'desert';
    out.rows.push({ name: 'Flanks', st: l && r && !desert ? 'pass' : 'warn', reason: `Lt ${l ? `rests on ${l}` : 'open to tanks'}; Rt ${r ? `rests on ${r}` : 'open to tanks'}${l && r ? '' : ': cover the open flank with mines, fire and a patrol'}${desert ? '. In the desert the tank threat comes from any direction, the rear too (OOW1 pp 68-69): all-round defence, mines round the posns' : ''}` });
  } else out.rows.push({ name: 'Flanks', st: 'unchecked', reason: 'all round: no flanks' });
  const fof = Object.values(out.slots).flatMap((c) => c.filter((x) => x.name === 'Fd of fire'));
  if (fof.length && fof.every((c) => c.st !== 'unchecked')) {
    const worst = fof.some((c) => c.st === 'fail') ? 'fail' : fof.some((c) => c.st === 'warn') ? 'warn' : 'pass';
    const dead = deadShare.length ? Math.round((100 * deadShare.reduce((a, b) => a + b, 0)) / deadShare.length) : null;
    out.rows.push({ name: 'Fields of fire', st: worst === 'pass' && dead !== null && dead > TH.deadWarnPct ? 'warn' : worst, reason: `${fof.filter((c) => c.st === 'pass').length} of ${fof.length} forward posns clear ${fmtM(TH.fofWantM)} or more${dead !== null ? `; about ${dead} % of the ground 300-1200 m out is dead ground: cover it with DF and patrols` : ''}` });
  } else out.rows.push({ name: 'Fields of fire', st: 'unchecked', reason: 'the ground in front is not loaded' });
  // the BUA defence: its plan row on IC's 50-100 m, no dead-ground warning (fighting at close quarter, IC s52 para 1 c)
  if (buaDef) buaFofRow(out.rows, fof, buaFof);
  out.rows.push(overlooked.length
    ? { name: 'Exposure', st: 'warn', reason: `${overlooked.join(', ')} overlooked from the front` }
    : { name: 'Exposure', st: fwdBoxes.some((b) => Number.isFinite(readGround(g, f, b, foot).elev)) ? 'pass' : 'unchecked', reason: 'not overlooked from 0.5-1.5 km in front (30 m elevation: ditches and bunds do not show)' });
  // on an obstacle: each forward posn has it under its MGs (IBB Annex V App 9: three up on the higher bank)
  if (kindT === 'obstacle' && fwdBoxes.length) {
    const cls = new Set<number>(((doctrineAt(doc, 'terrain.detect.obstacle.classes') as number[]) ?? [20, 21, 22, 24, 25]));
    // a Coy / Pl plan: IC's band (100 m minimum field of fire, s72 para 6 b p 372; the LMGs' 500 m line, s76 para 11 e p 417)
    const band = (!bn ? resolveRange(doc, doctrineAt(doc, 'checkBands.fieldOfFireToObstacleCoyM')) : null) ?? resolveRange(doc, doctrineAt(doc, 'terrain.kinds.obstacle.tieInM')) ?? [250, 700];
    const far: string[] = [], none: string[] = [], at: string[] = [];
    let known = false;
    for (const b of fwdBoxes) {
      let best = Infinity, top: number | null = null;
      for (const u of [-0.3, 0, 0.3]) {
        const fp = boxPt(b, u * b.w, b.h / 2);
        for (let d = 0; d <= 1500; d += 50) {
          const a = (b.turn * Math.PI) / 180;
          const w = toWorld(f, P(fp.x + d * Math.sin(a), fp.y + d * Math.cos(a)));
          const c = g.cls(w.x, w.y);
          if (c === null) continue;
          known = true;
          if (cls.has(c)) { if (d < best) { best = d; top = c; } break; }
        }
      }
      if (!Number.isFinite(best)) none.push(b.label);
      else if (best > band[1]) far.push(`${b.label} ${fmtM(best)}`);
      else at.push(`${b.label} ${fmtM(best)}${top !== null ? ` (${g.label(top)})` : ''}`);
    }
    out.rows.push(!known ? { name: 'Obstacle tie-in', st: 'unchecked', reason: 'the ground in front is not loaded' }
      : far.length || none.length ? { name: 'Obstacle tie-in', st: 'warn', reason: `${[...far.map((x) => `${x} back from the obstacle`), ...none.map((x) => `${x}: no obstacle within 1.5 km in front`)].join('; ')}: beyond the posn's MGs (${fmtM(band[1])}, ${bn ? 'E' : 'the LMGs\' 500 m line, IC s76 para 11 e p 417'}); move up to the home bank or hold it with a mask posn (IBB Annex V App 9)` }
      : { name: 'Obstacle tie-in', st: 'pass', reason: `the obstacle under the forward posns' fire: ${at.join(', ')}` });
  }
  // in the mountains: the forward posns dominate the main approach (MW s12 para 2 p 147)
  if (kindT === 'mountain' && fwdBoxes.length) {
    const want = num('terrain.kinds.mountain.holdHeights.aboveApchM', 30);
    const main = out.approaches.find((a) => a.main);
    if (!main) out.rows.push({ name: 'Dominates the approach', st: 'unchecked', reason: 'needs the approaches' });
    else {
      const low: string[] = [], high: string[] = [];
      const angs: { label: string; dh: number; dM: number; deg: number }[] = [];
      let known = false;
      for (const b of fwdBoxes) {
        const e0 = readGround(g, f, b, foot).elev;
        let bd = Infinity, eAp = NaN, lp: XY | null = null;
        for (const w of main.path) { const l = toLocal(f, w); const d = boxDist(b, l); if (l.y > b.c.y && d < bd && d <= 2000) { bd = d; eAp = g.elev(w.x, w.y); lp = l; } }
        if (!Number.isFinite(e0) || !Number.isFinite(eAp)) continue;
        known = true;
        (e0 - eAp >= want ? high : low).push(`${b.label} ${Math.round(e0 - eAp)} m`);
        // the angle the posn's weapons fire down (+) or up (-) onto the approach: from the middle of its front edge, where
        // the forward weapons stand, its height read there, to the approach point (at least 50 m); Pl, Coy and Bn plans
        // only (in a Bde or Div plan the posns are formations, their weapons in the Coy posns judged in the Bn plans)
        if (lp && ['14', '15', '16'].includes(recipe.echelon)) {
          const fp = boxPt(b, 0, b.h / 2), wf = toWorld(f, fp), eF = g.elev(wf.x, wf.y);
          const e1 = Number.isFinite(eF) ? eF : e0, dM = Math.max(50, Math.hypot(fp.x - lp.x, fp.y - lp.y));
          angs.push({ label: b.label, dh: e1 - eAp, dM, deg: (Math.atan2(e1 - eAp, dM) * 180) / Math.PI });
        }
      }
      out.rows.push(!known ? { name: 'Dominates the approach', st: 'unchecked', reason: 'no elevation along the main approach in front' }
        : low.length ? { name: 'Dominates the approach', st: 'warn', reason: `${low.join(', ')} above ${main.id} where it passes in front (wants ${want} m or more, E): hold the dominating features astride and on the flanks of the axis (MW s12 para 2 p 147)` }
        : { name: 'Dominates the approach', st: 'pass', reason: `${high.join(', ')} above ${main.id} where it passes in front (MW s12 para 2 p 147)` });
      // uphill / downhill fire (MW s18): a MG on its mount elevates 6 deg and depresses 8.5 deg, the 75 mm RR elevates
      // 30 deg and depresses 5 deg (p 221); sited on heights the RR has a pronounced dead arc downhill (p 224), so it goes
      // in the foothills on the lower spurs and ridges of the approaches (p 225)
      if (angs.length) {
        const wa = (k: string, fb: number) => num(`terrain.kinds.mountain.weaponAngles.${k}`, fb);
        const mgDep = wa('mgDepressDeg', 8.5), mgElev = wa('mgElevateDeg', 6), rrDep = wa('rrDepressDeg', 5), rrElev = wa('rrElevateDeg', 30);
        const bad: string[] = [], ok: string[] = [];
        for (const a of angs) {
          const at = `${a.label} ${a.deg >= 0 ? `${a.deg.toFixed(1)}° down` : `${(-a.deg).toFixed(1)}° up`} onto ${main.id} (${Math.round(Math.abs(a.dh))} m in ${fmtM(a.dM)})`;
          if (a.deg > mgDep) bad.push(`${at}: beyond the MG's ${mgDep}° and the RR's ${rrDep}° depression`);
          else if (a.deg > rrDep) bad.push(`${at}: beyond the RR's ${rrDep}° depression (its dead arc)`);
          else if (-a.deg > rrElev) bad.push(`${at}: beyond the MG's ${mgElev}° and the RR's ${rrElev}° elevation`);
          else if (-a.deg > mgElev) bad.push(`${at}: beyond the MG's ${mgElev}° elevation on its mount`);
          else ok.push(at);
        }
        const rule = `a MG on its mount elevates ${mgElev}° and depresses ${mgDep}°, the 75 mm RR elevates ${rrElev}° and depresses ${rrDep}° (MW s18 p 221)`;
        out.rows.push(bad.length ? {
          name: 'Weapon angles', st: 'warn',
          reason: `${bad.join('; ')}${ok.length ? `; ${ok.join(', ')} within the limits` : ''}: ${rule}`,
          detail: {
            head: `${bad.length} posn${bad.length === 1 ? '' : 's'} fire${bad.length === 1 ? 's' : ''} beyond the weapons' angles onto ${main.id}`,
            why: `Sited on heights the RR has a very pronounced dead arc firing downhill, its depression being ${rrDep}° only (MW p 224); ${rule}. Uphill and downhill the rounds strike high, and beyond 200 m on slopes steeper than 25° the range must be corrected (pp 215, 225).`,
            fix: ['Site the RRs in the foothills on the lower spurs and ridges of the approach (MW p 225)', 'Fire the RR or RL from the shoulder for the steep shots, not beyond 400 m (MW p 223)', 'Lower the MG mount\'s front leg, sandbags on the rear legs (MW p 224), or use the AA mount uphill (p 222)', 'Range cards with the angle and the range for each target (MW p 225)'],
          },
        } : { name: 'Weapon angles', st: 'pass', reason: `${ok.join(', ')}: within the weapons' angles; ${rule}; range cards carry the angle and the range (p 225)` });
      }
    }
  }
  if (recipe.slots.some((s) => s.role === 'killingGr')) {
    out.rows.push(out.killingGr
      ? { name: 'Killing Gr', st: 'pass', reason: `on the main approach ${(bn ? TH.killBand : TH.killBandCoy).join('-')} m in front, inside the forward posns' reach` }
      : { name: 'Killing Gr', st: out.approaches.length ? 'warn' : 'unchecked', reason: out.approaches.length ? `no stretch of the main approach ${(bn ? TH.killBand : TH.killBandCoy).join('-')} m out is in reach: site it on the ground` : 'needs the approaches' });
  }

  // 4b. the En front or area marked: what it is against the plan, each forward posn's stand-off, what moved to keep it
  if (front) {
    const lf = frontLocal(front, f);
    const edges = frontLaid?.edges.edges ?? {};
    out.rows.push(...frontRows(readFront(lf, boxes, fg.bulgeM, edges), front.kind, frontShape, fg.spreadWarnM, frontLaid?.edges ?? null));
    // from the nearest point of each forward posn's front edge to the En front: the stand-off the row reads
    out.standLinks = standLinksOf(boxes, lf, edges);
  }

  // 5. score (PlanDoctrine.scoreWeights): pass 1, warn 0.5, fail 0, unchecked 0.5
  out.pending = g.pending();
  const all = [...out.rows, ...Object.values(out.slots).flat()];
  out.fails = all.filter((c) => c.st === 'fail').length;
  out.warns = all.filter((c) => c.st === 'warn').length;
  const W = (doctrineAt(doc, 'scoreWeights') ?? {}) as Record<string, number>;
  const v = (st?: CheckState) => (st === 'pass' ? 1 : st === 'fail' ? 0 : 0.5);
  const row = (n: string) => [...(inp.rowsOver ?? []), ...out.rows, ...res.rows].find((r) => r.name === n)?.st;   // a layout's own reader, then the fit's answer
  const groundAvg = boxes.length ? boxes.reduce((a, b) => a + v(out.slots[b.role]?.[0]?.st), 0) / boxes.length : 0.5;
  out.score = Math.round(100 * (
    (W.approaches ?? 0.25) * v(row('Approaches covered')) +
    // a layout with no reserve is not scored as if its reserve were in time
    (W.depth ?? 0.2) * (v(row('Depth')) + v(row('Reserve reach') ?? (recipe.slots.some((x) => x.kind === 'res') ? 'pass' : 'warn'))) / 2 +
    (W.obstacle ?? 0.15) * (v(row('Fields of fire')) + groundAvg) / 2 +
    (W.gaps ?? 0.15) * v(row('Gaps')) +
    (W.flanks ?? 0.1) * v(row('Flanks')) +
    (W.exposure ?? 0.1) * v(row('Exposure')) +
    (W.alternates ?? 0.05) * v(row('Alternates') ?? 'pass')));
  void kindOf;
  return out;
}

/** Linear features a start line can be laid on: roads, tracks, bunds, embankments, railways, nullahs, canals. */
const LINEAR = new Set([20, 21, 22, 24, 25, 28, 34, 35, 36, 37, 38, 46, 47]);

/** The attack: is the FUP hidden from the objective, the going along the axis, the SL on a linear feature, the BOF's view. */
function fitAttack(inp: FitInput): FitResult {
  const { res, frame: f, ground: g } = inp;
  const out: FitResult = { nudges: {}, slides: [], killingGr: null, slots: {}, rows: [], approaches: [], score: 0, fails: 0, warns: 0, pending: false, data: g.dataLine(), from: null, fromAssumed: false };
  const it = (role: string) => res.items.find((i) => i.role === role);
  const centreOf = (pts: XY[]) => P(pts.reduce((a, p) => a + p.x, 0) / pts.length, pts.reduce((a, p) => a + p.y, 0) / pts.length);
  const W = (p: XY) => toWorld(f, p);
  const obj = it('obj'), fup = it('fup'), sl = it('sl'), axis = it('axis'), bof = it('bof');
  const oc = obj ? centreOf(obj.pts) : null;
  const sightP = (a: XY, b: XY, e: number, t: number) => { if (!g.sight) return null; const wa = W(a), wb = W(b); return g.sight(wa.x, wa.y, e, wb.x, wb.y, t); };
  // FUP hidden from the objective (an observer on the Obj, 2 m up, looking for men 1.7 m tall)
  if (oc && fup && g.sight) {
    const fc = centreOf(fup.pts);
    const pts = [fc, ...fup.pts];
    const ps = pts.map((p) => sightP(oc, p, 2, 1.7)).filter((p): p is number => p !== null);
    out.rows.push(ps.length >= 2
      ? (() => { const seen = ps.filter((p) => p >= 0.5).length; return { name: 'FUP unseen', st: seen ? 'warn' as CheckState : 'pass' as CheckState, reason: seen ? `${seen} of ${ps.length} points of the FUP likely seen from the Obj: move it into dead ground or screen it` : 'likely hidden from the Obj (30 m elevation and what stands on it: confirm by recce)' }; })()
      : { name: 'FUP unseen', st: 'unchecked', reason: 'the ground between is not loaded' });
  } else out.rows.push({ name: 'FUP unseen', st: 'unchecked', reason: 'no sight data' });
  // going from the SL to the Obj on foot and for tanks
  if (axis) {
    // along the axis as drawn (a curve round NO-GO when the fit laid it on the ground), every 50 m
    const foot = g.going('dismounted'), tank = g.going('tracked');
    let n = 0, footNo = 0, tankNo = 0, slow = 0, goM = 0, slowM = 0, climb = 0, lastE = NaN;
    const seen = new Map<number, number>();
    for (let i = 1; i < axis.pts.length; i++) {
      const a = axis.pts[i - 1], b = axis.pts[i];
      const L = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(1, Math.ceil(L / 50));
      for (let s = 0; s < steps; s++) {
        const t = (s + 0.5) / steps;
        const w = W(P(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
        const e = g.elev(w.x, w.y);
        if (Number.isFinite(e)) { if (Number.isFinite(lastE) && e > lastE) climb += e - lastE; lastE = e; }
        const c = g.cls(w.x, w.y);
        if (c === null) { goM += L / steps; continue; }
        n++;
        if (foot.nogo.has(c)) { footNo++; seen.set(c, (seen.get(c) ?? 0) + 1); }
        else if (foot.caution.has(c)) { slow++; slowM += L / steps; }
        else goM += L / steps;
        if (tank.nogo.has(c)) tankNo++;
      }
    }
    const worst = [...seen.entries()].sort((x, y) => y[1] - x[1])[0];
    const curved = axis.pts.length > 2 ? ' (laid round NO-GO on the ground)' : '';
    out.rows.push(!n ? { name: 'Approach going', st: 'unchecked', reason: 'no ground data along the axis' }
      : footNo ? { name: 'Approach going', st: 'fail', reason: `the axis crosses NO-GO on foot (${g.label(worst[0])}): turn it or plan the crossing` }
      : { name: 'Approach going', st: slow / n > 0.5 ? 'warn' : 'pass', reason: `${Math.round((100 * slow) / n)} % SLOW-GO on foot${curved}; ${tankNo ? `${Math.round((100 * tankNo) / n)} % NO-GO for tanks: infantry-heavy` : 'tanks can go with it'}` });
    // the pace along the axis is the H-hour sum's (PlanAttack.attackTimes: the assault slowed over SLOW-GO)
    void goM; void slowM; void climb;
  }
  // the SL on a linear feature (IBB: a linear feature square to the axis)
  if (sl) {
    const a = sl.pts[0], b = sl.pts[sl.pts.length - 1];
    let n = 0, hit = 0;
    const kinds = new Map<number, number>();
    for (let t = 0; t <= 1.0001; t += 0.125) {
      const p = P(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      let any = false, known = false;
      for (const dy of [-50, -25, 0, 25, 50]) {
        const w = W(P(p.x, p.y + dy));
        const c = g.cls(w.x, w.y);
        if (c === null) continue;
        known = true;
        if (LINEAR.has(c)) { any = true; kinds.set(c, (kinds.get(c) ?? 0) + 1); }
      }
      if (known) { n++; if (any) hit++; }
    }
    const top = [...kinds.entries()].sort((x, y) => y[1] - x[1])[0];
    out.rows.push(!n ? { name: 'SL a linear feature', st: 'unchecked', reason: 'no ground data along the SL' }
      : hit / n >= 0.6 ? { name: 'SL a linear feature', st: 'pass', reason: `${Math.round((100 * hit) / n)} % of it along ${g.label(top[0])}` }
      : { name: 'SL a linear feature', st: 'warn', reason: `no linear feature along most of it (${Math.round((100 * hit) / n)} %): mark it with tape, or slide it to one` });
  }
  // the BOF sees the objective
  if (bof && obj && g.sight) {
    const bp = bof.pts[0];
    const ps = [oc!, ...obj.pts].map((p) => sightP(bp, p, 2, 1.7)).filter((p): p is number => p !== null);
    const seen = ps.filter((p) => p >= 0.5).length;
    out.rows.push(ps.length >= 3
      ? { name: 'BOF sees the Obj', st: seen / ps.length >= 0.6 ? 'pass' : seen ? 'warn' : 'fail', reason: `${seen} of ${ps.length} points of the Obj likely in view from the BOF` }
      : { name: 'BOF sees the Obj', st: 'unchecked', reason: 'the ground between is not loaded' });
  }
  out.pending = g.pending();
  out.fails = out.rows.filter((r) => r.st === 'fail').length;
  out.warns = out.rows.filter((r) => r.st === 'warn').length;
  const v = (st: CheckState) => (st === 'pass' ? 1 : st === 'fail' ? 0 : 0.5);
  const all = [...res.rows.filter((r) => r.st !== 'unchecked'), ...out.rows];
  out.score = all.length ? Math.round((100 * all.reduce((a, r) => a + v(r.st), 0)) / all.length) : 0;
  return out;
}

/**
 * The kind of ground round the plan (PlanDoctrine `terrain.detect`, E): mountains when the ground within 5 km rises
 * 400 m or more; an obstacle when a canal, distributary, drain, embankment or bund lies in front of half the front
 * inside 1.5 km of the FDL; desert when half the ground within 3 km is bare, sand, dunes or salt pan; else plains.
 * Null when the ground is not loaded.
 */
export function detectTerrain(g: PlanGround, f: FitFrame, res: SolveResult, recipe: Recipe, doc: DoctrineSet): TerrainSpec | null {
  const at = (p: string) => (doctrineAt(doc, p) ?? {}) as any;
  const off = (dx: number, dy: number) => toWorld(f, P(f.pivot.x + dx, f.pivot.y + dy));
  // mountains
  const mt = at('terrain.detect.mountain');
  const within = Number(mt.withinM) || 5000, rise = Number(mt.riseM) || 400;
  let lo = Infinity, hi = -Infinity, ne = 0;
  for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) {
    const w = off((i / 4) * within, (j / 4) * within);
    const e = g.elev(w.x, w.y);
    if (!Number.isFinite(e)) continue;
    ne++; lo = Math.min(lo, e); hi = Math.max(hi, e);
  }
  if (ne >= 20 && hi - lo >= rise) return { kind: 'mountain', source: 'auto', why: `the ground within ${fmtM(within)} rises ${Math.round(hi - lo)} m` };
  // an obstacle in front
  const ob = at('terrain.detect.obstacle');
  const obCls = new Set<number>(ob.classes ?? [20, 21, 22, 24, 25]);
  const kindOf = (role: string) => recipe.slots.find((s) => s.role === role)?.kind ?? '';
  const fwd = res.slots.filter((s) => kindOf(s.role) === 'fwd' && s.turnDeg === 0);
  let known = 0;
  if (fwd.length) {
    const x0 = Math.min(...fwd.map((s) => s.centre.x - s.wM / 2)), x1 = Math.max(...fwd.map((s) => s.centre.x + s.wM / 2));
    const frontY = Math.max(...fwd.map((s) => s.centre.y + s.hM / 2));
    const reach = Number(ob.withinM) || 1500;
    let hits = 0, lines = 0;
    const kinds = new Map<number, number>();
    for (let i = 0; i <= 8; i++) {
      const x = x0 + ((x1 - x0) * i) / 8;
      let k = false, hit = false;
      for (let d = 0; d <= reach && !hit; d += 50) {
        const w = toWorld(f, P(x, frontY + d));
        const c = g.cls(w.x, w.y);
        if (c === null) continue;
        k = true;
        if (obCls.has(c)) { hit = true; kinds.set(c, (kinds.get(c) ?? 0) + 1); }
      }
      if (k) { lines++; if (hit) hits++; }
    }
    known += lines;
    if (lines >= 5 && hits / lines >= (Number(ob.share) || 0.5)) {
      const top = [...kinds.entries()].sort((a, b) => b[1] - a[1])[0];
      return { kind: 'obstacle', source: 'auto', why: `${top ? g.label(top[0]) : 'an obstacle'} in front of ${hits} of ${lines} points along the front, inside ${fmtM(reach)}` };
    }
  }
  // desert
  const de = at('terrain.detect.desert');
  const deCls = new Set<number>(de.classes ?? [12, 13, 14, 16]);
  const dw = Number(de.withinM) || 3000;
  let n = 0, sand = 0;
  for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) {
    const w = off((i / 4) * dw, (j / 4) * dw);
    const c = g.cls(w.x, w.y);
    if (c === null) continue;
    n++; if (deCls.has(c)) sand++;
  }
  known += n;
  if (n >= 20 && sand / n >= (Number(de.share) || 0.5)) return { kind: 'desert', source: 'auto', why: `${Math.round((100 * sand) / n)} % of the ground within ${fmtM(dw)} is bare, sand or dunes` };
  // no class sample read yet (elevation alone cannot tell plains from an obstacle or desert): not known, never a Pass
  if (!known) return null;
  const mtw = at('terrain.detect.mountain');
  return { kind: 'plains', source: 'auto', why: `no mountain relief (${Number(mtw.riseM) || 400} m rise within ${fmtM(Number(mtw.withinM) || 5000)}), obstacle in front or desert found round it` };
}

/**
 * The checks the Check step shows: the geometry rows from the solver with the ground rows it could not answer
 * replaced by the fit's, and each posn's ground rows replaced the same way.
 */
export function mergeChecks(res: SolveResult, fit: FitResult): { rows: Check[]; slots: SlotResult[] } {
  const fitNames = new Set(fit.rows.map((r) => r.name));
  const rows = [...res.rows.filter((r) => !(r.st === 'unchecked' && fitNames.has(r.name))), ...fit.rows.filter((r) => !res.rows.some((x) => x.name === r.name && x.st !== 'unchecked'))];
  const slots = res.slots.map((s) => {
    const fc = fit.slots[s.role] ?? [];
    const names = new Set(fc.map((c) => c.name));
    const checks = [...fc, ...s.checks.filter((c) => !names.has(c.name))];
    const st: CheckState = checks.some((c) => c.st === 'fail') ? 'fail' : checks.some((c) => c.st === 'warn') ? 'warn' : checks.some((c) => c.st === 'unchecked') ? 'unchecked' : 'pass';
    return { ...s, checks, st };
  });
  return { rows, slots };
}

/**
 * Auto's order (PlanBuilder_Plan.md 7.4): fewest fails, then fewest warnings, then the higher weighted score; a tie
 * goes to the layout listed first in the family (the safer, doctrinal default).
 */
export function rankFits<T extends { fit: FitResult; recipe?: Recipe; res?: { frontageM: number } }>(list: T[], opts: { holdM?: number | null } = {}): T[] {
  // an attack (user, 14 Nov 2026): frontal only if unavoidable, so a feasible flank (no fail) comes before it whatever
  // its warnings; then the weighed factors (the score already counts the warnings' weight)
  const frontal = (x: T) => (x.recipe?.task === 'attack' && x.recipe.layout === 'frontal' ? 1 : 0);
  const attack = (x: T) => x.recipe?.task === 'attack';
  const out = list.map((x, i) => ({ x, i })).sort((a, b) => a.x.fit.fails - b.x.fit.fails
    || (attack(a.x) && attack(b.x) ? frontal(a.x) - frontal(b.x) || b.x.fit.score - a.x.fit.score : a.x.fit.warns - b.x.fit.warns || b.x.fit.score - a.x.fit.score)
    || a.i - b.i).map((e) => e.x);
  // a Coy defence: two up, one in depth, normally; three up only "if the frontages are over extended" (IC s74 para 11 p
  // 391), so three up ranks after the family's two up, unless two up fails more, or the frontage to hold (opts.holdM,
  // when the caller knows it) is wider than two up's
  const coyDef = (x: T, lay: string) => x.recipe?.task === 'defence' && x.recipe.echelon === '15' && x.recipe.layout === lay;
  for (let guard = 0; guard < out.length; guard++) {
    const i3 = out.findIndex((x) => coyDef(x, 'three-up'));
    if (i3 < 0) break;
    const fam = out[i3].recipe!.family;
    const i2 = out.findIndex((x, j) => j > i3 && coyDef(x, 'two-up') && x.recipe!.family === fam);
    if (i2 < 0) break;
    const two = out[i2];
    const overExtended = opts.holdM != null && two.res?.frontageM != null && opts.holdM > two.res.frontageM + 1;
    if (two.fit.fails > out[i3].fit.fails || overExtended) break;
    out.splice(i2, 1);
    out.splice(i3, 0, two);
  }
  return out;
}

/** The score card's rows, in the order Compare shows them, and how each is read from the merged checks. */
export const SCORE_ROWS: { key: string; label: string; rows: string[] }[] = [
  { key: 'approaches', label: 'Approaches covered', rows: ['Approaches covered'] },
  { key: 'depth', label: 'Depth and reserve', rows: ['Depth', 'Reserve reach'] },
  { key: 'obstacle', label: 'Fields of fire, ground', rows: ['Fields of fire'] },
  { key: 'gaps', label: 'Gaps', rows: ['Gaps', 'Mutual support'] },
  { key: 'flanks', label: 'Flanks', rows: ['Flanks'] },
  { key: 'exposure', label: 'Exposure', rows: ['Exposure'] },
  { key: 'alternates', label: 'Alternates', rows: ['Alternates'] },
];

/** The worst state among a score-card row's checks (unchecked counts below pass, above warn). */
export function scoreRowState(rows: Check[], names: string[]): CheckState | null {
  const hit = rows.filter((r) => names.includes(r.name));
  if (!hit.length) return null;
  const order: CheckState[] = ['fail', 'warn', 'unchecked', 'pass'];
  return order.find((s) => hit.some((r) => r.st === s)) ?? null;
}

// ── one layout fitted at one spot (the Build tab and the Node checks run the same steps) ───────────────────────────

export interface FittedLayout {
  recipe: Recipe;
  /** Solved with the slides, its checks merged with the fit's (mode 'terrain'): what Check and Copy as Text show. */
  res: SolveResult;
  /** Solved with the slides, the solver's own checks: what becomes the plan document. */
  raw: SolveResult;
  fit: FitResult;
  frame: FitFrame;
  /** Where the plan's pivot lands (Web Mercator) and the bearing the Mgr turns it by. */
  anchor: XY;
  bearing: number;
  /** The user's own moves (J), plan metres by role, laid under the fit's slides. */
  manual: Record<string, XY>;
  /** The kind of ground it was fitted for (set, read off the bundle, or assumed) and who attacks it. */
  terrain: TerrainSpec | null;
  /** What the bundle reads the ground as where it rests, also when the user set the kind (for the dock's "detected"). */
  detected?: TerrainSpec | null;
  enemy: EnemySpec | null;
  /** The unit (ORBAT) the plan is laid for; null when the ORBAT is not loaded. */
  unit: UnitBrief | null;
}

export interface FitLayoutInput {
  recipe: Recipe;
  ctx: SolveCtx;
  opts: SolveOptions;
  ground: PlanGround;
  anchor: XY;
  /** As the Mgr turns the plan document (an attack's document is turned half round: its front is the other way). */
  bearing: number;
  threat?: XY | null;
  manual?: Record<string, XY>;
  /** Called before the reads (the browser probe resets its pending flag). */
  begin?: () => void;
  /** Who attacks (null: no enemy rows; the tab passes the user's choice or the doctrinal default). */
  enemy?: EnemySpec | null;
  /** The kind of ground: set by the user, or 'auto' (read off the bundle where the plan rests). */
  terrain?: TerrainKind | 'auto' | null;
  /** The unit from the ORBAT (its ATGM pairs, RR reach, APCs); the caller also passes its ranges in ctx.doc. */
  unit?: UnitBrief | null;
  /** Both sides' strengths from the ORBAT, for the force ratio. */
  force?: ForceSides;
  /** An attack by night (Night March rates and chart). */
  night?: boolean;
  /** A two-phase attack: Obj 2 marked by the user on the map (Web Mercator); it is taken before any posn drawn or high ground. */
  obj2At?: XY | null;
  /** Tanks with an attack: the longest En ATGM range (m) from the En unit's weapons (ORBAT) and its source; null: the doctrine's 3 km. */
  enAtgmM?: number | null;
  enAtgmSrc?: string | null;
  /** A withdrawal: the reach of the En field artillery (m) and its source, from the ORBAT when it is loaded. */
  enFieldArtyM?: number | null;
  enFieldArtySrc?: string | null;
  /** NightMarchDoctrine rules (nmRulesFrom), for the night attack's march chart. */
  nmRules?: Record<string, any> | null;
  /** Hostile units and posns drawn on the map (Web Mercator): a two-phase attack lays Obj 2 on one behind Obj 1. */
  enemyAt?: XY[] | null;
  /** The En front line or area marked in the tab (Web Mercator, PlanEnFront): a defence follows its curvature; an
   *  attack's assembly, FUP, SL and BOF are checked to lie outside it. */
  front?: EnFront | null;
  /** ITG designated on the map (Vital Gr / Imp Gr, Web Mercator): the posns beside them take them inside their outlines. */
  itgAt?: { at: XY; label: string }[] | null;
  /** Ambush, patrol, recce (PlanSmallOps): the aim point (a patrol's Obj, a recce's NAI), Web Mercator. */
  cursor?: XY | null;
  /** MovementDoctrine rules (rulesFrom) and PlatoonDoctrine rules (plRulesFrom); the foot speeds (MovementSpeeds.json). */
  movRules?: Record<string, any> | null;
  plRules?: Record<string, any> | null;
  speeds?: PlFootSpeeds | null;
  /** An ambush's target: wheeled (the default), tracked or on foot. */
  mover?: Mover;
  /** The grid-magnetic angle (deg, E +) for a patrol's route card (planBuilder.gmaDeg); null: grid and mils only. */
  gmaDeg?: number | null;
  /** A crossing (PlanCrossing): the Movement Guide's water rules (waterRulesFrom), the light (Annex Q column), the month. */
  waterRules?: Record<string, any> | null;
  light?: Light;
  month?: number;
}

export const addNudges = (a: Record<string, XY> = {}, b: Record<string, XY> = {}) => {
  const out: Record<string, XY> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = out[k] ? { x: out[k].x + v.x, y: out[k].y + v.y } : { ...v };
  return out;
};

/**
 * An attack's axis on the ground: the way on foot from its tail to its head round NO-GO (`findAvenue`, dismounted).
 * Only a way that bends more than 100 m off the straight line is used; a few points along it become the arrow's
 * CTRL_PTS (the symbol draws the curve through them), its ends pinned to the axis.
 */
function axisOnGround(res: SolveResult, f: FitFrame, g: PlanGround, role = 'axis', profile: 'dismounted' | 'tracked' = 'dismounted'): Record<string, XY[]> | undefined {
  const ax = res.items.find((i) => i.role === role);
  if (!ax || ax.pts.length < 2 || !g.avenues) return undefined;
  const t = ax.pts[0], h = ax.pts[ax.pts.length - 1];
  const w = ax.base ? Math.hypot(ax.base.start.x - ax.base.end.x, ax.base.start.y - ax.base.end.y) : 400;
  const p = g.avenues(toWorld(f, t), toWorld(f, h), Math.min(500, w), profile)?.[0]?.path;
  if (!p || p.length < 3) return undefined;
  const loc = p.map((q) => toLocal(f, q));
  const L = Math.hypot(h.x - t.x, h.y - t.y) || 1;
  const dev = Math.max(...loc.map((q) => Math.abs(((q.x - t.x) * (h.y - t.y) - (q.y - t.y) * (h.x - t.x)) / L)));
  if (dev < 100) return undefined;
  const n = Math.min(7, Math.max(3, Math.round(loc.length / 6)));
  const pts = Array.from({ length: n }, (_, i) => ({ ...loc[Math.round((i * (loc.length - 1)) / (n - 1))] }));
  pts[0] = { ...t }; pts[n - 1] = { ...h };
  return { [role]: pts };
}

/** Solve, fit, and solve again with the fit's slides and killing ground. Null when the recipe has no pivot. */
export function fitLayout(inp: FitLayoutInput): FittedLayout | null {
  readThresholds(inp.ctx.doc);
  // ambush, patrol, recce: laid over the Movement / Platoon Guide engines (PlanSmallOps)
  if (SMALL_TASKS.includes(inp.recipe.task)) return fitSmallOp(inp);
  // a crossing: re-laid along the obstacle over the Movement Guide's Water engine (PlanCrossing)
  if (inp.recipe.task === 'crossing') return fitCrossing(inp);
  // an advance to contact: the echelons along the axis, the going for tracks on it (PlanAdvance)
  if (inp.recipe.task === 'advance') return fitAdvance(inp);
  // a withdrawal: the routes back, the embussing points, the intermediate posn against the En guns (PlanWithdrawal)
  if (inp.recipe.task === 'withdrawal') return fitWithdrawal(inp);
  // a canal defence: laid along the canal first (PlanCrossing.canalPrep: the posns' seeds moved, the shapes re-laid),
  // then fitted and checked as any defence; the canal's own rows join the defence's
  const canal = isCanalLayout(inp.recipe.layout) ? canalPrep(inp) : null;
  if (canal && Object.keys(canal.geom).length) inp = { ...inp, opts: { ...inp.opts, geom: { ...(inp.opts.geom ?? {}), ...canal.geom } } };
  const { recipe, ctx, ground } = inp;
  const manualJ = inp.manual ?? {};
  const manual = canal ? addNudges(canal.nudges, manualJ) : manualJ;
  const base = solveRecipe(recipe, ctx, { ...inp.opts, nudges: manual });
  const pivotItem = base.items.find((i) => i.id === base.pivotId);
  if (!pivotItem) return null;
  const frame: FitFrame = {
    anchor: inp.anchor,
    bearing: inp.bearing + (recipe.task === 'attack' ? Math.PI : 0),
    k: 1 / Math.cos(2 * Math.atan(Math.exp(inp.anchor.y / 6378137)) - Math.PI / 2),
    pivot: pivotItem.pts[0],
  };
  inp.begin?.();
  // an attack's axis laid on the ground: round NO-GO on foot from its tail to the Obj, a curve through CTRL_PTS
  // an attack: the finders first (FUP, SL, BOF, Assy Area on the ground), then the axis from the SL laid round NO-GO
  // by night the FUP band and the SL at the FUP forward edge (IC s68 paras 12 e (1), 13 a pp 333-334); by day neither
  const find: AttackFind | null = recipe.task === 'attack' ? findAttackSpots(base, frame, ground, ctx.doc, !!inp.night) : null;
  let paths: Record<string, XY[]> | undefined;
  let fitBase = base;
  let ph2: Phase2Find | null = null;
  let ph3: Phase2Find | null = null;
  let tk: TankFind | null = null;
  if (find) {
    const o2 = { ...inp.opts, nudges: addNudges(manual, find.nudges), geom: find.geom, paths: find.axis ? { axis: find.axis } : undefined };
    const b2 = solveRecipe(recipe, ctx, o2);
    paths = axisOnGround(b2, frame, ground) ?? o2.paths;
    fitBase = solveRecipe(recipe, ctx, { ...o2, paths });
    // a second phase (PlanPhase): Obj 2, the side round Obj 1, FUP 2, SL 2, the phase 2 axis, the follow-up Coys' way
    if ((recipe.phases ?? 1) >= 2) {
      const enemyAt = (inp.enemyAt ?? []).map((w) => toLocal(frame, w));
      const chokeP = findMsrChoke(fitBase, frame, ground, ctx.doc);
      ph2 = findPhase2(fitBase, frame, ground, ctx.doc, enemyAt, chokeP, inp.obj2At ? toLocal(frame, inp.obj2At) : null);
      if (ph2) {
        find.nudges = addNudges(find.nudges, ph2.nudges);
        find.geom = { ...find.geom, ...ph2.geom };
        find.rows.push(...ph2.rows);
        const o3 = { ...o2, nudges: addNudges(manual, find.nudges), geom: find.geom, paths: { ...paths, ...ph2.paths } };
        const b3 = solveRecipe(recipe, ctx, o3);
        paths = { ...o3.paths, ...(axisOnGround(b3, frame, ground, 'axis2') ?? {}) };
        fitBase = solveRecipe(recipe, ctx, { ...o3, paths });
        // a third phase (PlanPhase.findPhaseN): Obj 3, FUP 3 round Obj 2's other flank, the phase 3 axis
        if (recipe.phases === 3) {
          ph3 = findPhaseN(fitBase, frame, ground, ctx.doc, enemyAt, chokeP, null, 3);
          if (ph3) {
            find.nudges = addNudges(find.nudges, ph3.nudges);
            find.geom = { ...find.geom, ...ph3.geom };
            find.rows.push(...ph3.rows);
            const o3b = { ...o3, nudges: addNudges(manual, find.nudges), geom: find.geom, paths: { ...paths, ...ph3.paths } };
            const b3b = solveRecipe(recipe, ctx, o3b);
            paths = { ...o3b.paths, ...(axisOnGround(b3b, frame, ground, 'axis3') ?? {}) };
            fitBase = solveRecipe(recipe, ctx, { ...o3b, paths });
          }
        }
      }
    }
    // tanks (PlanTanks): FUP (Tks) on the ground, the fire posns following the BOF, the tanks' axis round NO-GO on tracks
    if (recipe.tanks) {
      tk = findTankSpots(fitBase, frame, ground, ctx.doc, recipe.tanks);
      if (tk) {
        find.nudges = addNudges(find.nudges, tk.nudges);
        find.rows.push(...tk.rows);
        const vs = tankFupVsEnAtgm(solveRecipe(recipe, ctx, { ...inp.opts, nudges: addNudges(manual, find.nudges), geom: find.geom, paths }), ctx.doc, inp.enAtgmM ?? null, inp.enAtgmSrc ?? null);
        if (vs) find.rows.push(vs);
        const o4 = { ...inp.opts, nudges: addNudges(manual, find.nudges), geom: find.geom, paths };
        const b4 = solveRecipe(recipe, ctx, o4);
        paths = { ...(paths ?? {}), ...(axisOnGround(b4, frame, ground, 'tkAxis', 'tracked') ?? {}) };
        fitBase = solveRecipe(recipe, ctx, { ...o4, paths });
      }
    }
  }
  // a reverse slope defence (PlanRevSlope): the crest in front read, the plan moved behind it, OPs and FPF on the crest
  const rs: RevSlopeFind | null = recipe.layout === 'rev-slope' ? findReverseSlope(base, frame, ground, ctx.doc) : null;
  if (rs && (Object.keys(rs.nudges).length || Object.keys(rs.geom).length)) fitBase = solveRecipe(recipe, ctx, { ...inp.opts, nudges: addNudges(manual, rs.nudges), geom: { ...(inp.opts.geom ?? {}), ...rs.geom } });
  // what the bundle reads here, also when the user set the kind (the dock says both)
  const detected = detectTerrain(ground, frame, base, recipe, ctx.doc);
  const terrain: TerrainSpec = inp.terrain && inp.terrain !== 'auto'
    ? { kind: inp.terrain, source: 'user' }
    : detected ?? { kind: 'plains', source: 'assumed', why: 'the ground round it is not loaded yet' };
  // the default enemy in the mountains is infantry (MW p 2 para 6: only the infantry can occupy the vital high ground; armour confined to roads and tracks, p 238); one the user set is kept
  const mtnType = doctrineAt(ctx.doc, 'terrain.kinds.mountain.enemyType');
  const enemy: EnemySpec | null = inp.enemy && inp.enemy.source === 'default' && terrain.kind === 'mountain' && recipe.task !== 'attack' && typeof mtnType === 'string'
    ? { ...inp.enemy, type: mtnType as EnemySpec['type'] }
    : inp.enemy ?? null;
  const fit = fitPlan({ res: fitBase, recipe, doc: ctx.doc, frame, ground, threat: recipe.task === 'attack' ? null : inp.threat ?? null, enemy: recipe.task === 'attack' ? null : enemy, terrain, rowsOver: rs?.rows, itgAt: inp.itgAt ?? null, front: recipe.task === 'attack' ? null : inp.front ?? null });
  // an attack's axes, and the FDL laid along an En front
  fit.paths = paths || fit.frontPaths ? { ...(paths ?? {}), ...(fit.frontPaths ?? {}) } : undefined;
  if (find) fit.nudges = addNudges(fit.nudges, find.nudges);
  if (rs) { fit.nudges = addNudges(fit.nudges, rs.nudges); fit.revSlope = { crest: rs.crest, fdlBehindM: rs.fdlBehindM, crestRiseM: rs.crestRiseM }; }
  const unit = inp.unit ?? null;
  // the reserve's pace on foot: the ground's in desert and mountains (IBB p 18, MW p 81), else cpen.footKmPerH (as Check my plan)
  const reserveKmh = terrain.kind === 'desert' || terrain.kind === 'mountain' ? footKmh(ctx.doc, terrain.kind).go : undefined;
  const solveOpts = { ...inp.opts, nudges: addNudges(manual, fit.nudges), placed: fit.killingGr ? { killingGr: fit.killingGr } : undefined, outlines: fit.outlines, turns: fit.turns, plShift: fit.plShift, paths: fit.paths, mountedReserve: !!unit?.mounted, reserveKmh, geom: find?.geom ?? (rs ? { ...(inp.opts.geom ?? {}), ...rs.geom } : inp.opts.geom) };
  let raw = solveRecipe(recipe, ctx, solveOpts);
  // the unit's other ATGM pairs (ORBAT) on the tank approaches: uncovered ones first, then the main one (density)
  fit.atExtras = recipe.task === 'attack' ? [] : atgmExtras(raw, recipe, unit, fit.approaches, frame, ctx.doc);
  if (fit.atExtras.length) raw = solveRecipe(recipe, ctx, { ...solveOpts, extraPoints: fit.atExtras });
  fit.pending = fit.pending || ground.pending();
  const merged = mergeChecks(raw, fit);
  merged.rows = applyContext(merged.rows, ctx.doc, recipe.echelon, recipe.task, raw.frontageM, recipe.slots.filter((s) => s.kind === 'fwd').length, enemy, terrain, inp.force, recipe.task === 'attack' ? !!inp.night : null);
  // an attack against a marked En area / front: own control measures outside it, the Obj on it
  if (recipe.task === 'attack') merged.rows.push(...attackFront(raw, frame, inp.front ?? null));
  const at = recipe.task === 'attack' ? null : atCoverRow(raw, recipe, unit, fit.approaches, frame, ctx.doc, enemy);
  if (at) merged.rows.push(at);
  // tank Sqns grouped to a defence: their leaguers on the ground
  if (recipe.defTanks) merged.rows.push(...defTankRows(raw.items, recipe, frame, ground, ctx.doc, fit.from ?? null));
  // the artillery's gun area: its reach (his FUP for his type in defence) and its ground
  if (recipe.arty) merged.rows.push(...artyRows(raw.items, recipe, recipe.task === 'attack' ? null : enemyFupM(ctx.doc, enemy?.type ?? 'mech')[0], frame, ground));
  // AD over its vulnerable points (PlanAD)
  if (recipe.ad) merged.rows.push(...adRows(raw.items, recipe, terrain.kind));
  // in the mountains: each fire unit on a dominating feature over the canalized run-ins (MW p 247)
  if (recipe.ad && terrain.kind === 'mountain') merged.rows.push(...adMountainRows(raw.items, recipe, (p) => toWorld(frame, p), (x, y) => ground.elev(x, y), ctx.doc));
  // a defence on mountain ground: its rear area against infiltration (MW s21 pp 232-238)
  if (terrain.kind === 'mountain' && recipe.task === 'defence') { const ra = rearAreaRow(raw.items); if (ra) merged.rows.push(ra); }
  if (canal) { merged.rows.push(...canal.rows); fit.crossing = canal.reading ?? undefined; fit.pending = fit.pending || canal.pending; }
  // the reverse slope's rows replace the solver's grey ones of the same name; its confirm list joins
  if (rs) { const fresh = new Set(rs.rows.map((r) => r.name)); merged.rows = merged.rows.filter((r) => !fresh.has(r.name)); merged.rows.push(...rs.rows); raw.confirm = [...raw.confirm, ...rs.confirm.filter((c) => !raw.confirm.includes(c))]; }
  // an attack: the finders' rows, the H-hour sum, his MSR choke, the night march, the factors that score it
  if (find) {
    const route = find.route;
    // in the mountains: AD over the defiles on the route to the FUP (MW p 247)
    if (recipe.ad && terrain.kind === 'mountain' && find.routeChokes?.length) merged.rows.push(...adDefileRows(raw.items, recipe, find.routeChokes));
    const h = attackTimes(raw, frame, ground, ctx.doc, terrain.kind, !!inp.night, route, ph2?.route ?? null, ph3?.route ?? null);
    const choke = findMsrChoke(raw, frame, ground, ctx.doc);
    // tanks in the H-hour sum (before its row is written) and their rows, in place of the solver's unread ones
    const tkRows = h && recipe.tanks ? addTankTimes(h, raw, frame, ground, ctx.doc, !!inp.night, recipe.tanks, tk?.route ?? null) : [];
    const fresh = new Set([...find.rows, ...tkRows].map((r) => r.name));
    // the ground's reading replaces the geometry's row of the same name (Who leads unread, Tank FUP by distance only)
    merged.rows = merged.rows.filter((r) => !fresh.has(r.name));
    merged.rows.push(...find.rows, ...tkRows);
    const ax2 = raw.items.find((i) => i.role === 'axis2');
    if (ph2 && ax2) merged.rows.push(goingRow('Ph 2 going', ax2.pts, frame, ground));
    const ax3 = raw.items.find((i) => i.role === 'axis3');
    if (ph3 && ax3) merged.rows.push(goingRow('Ph 3 going', ax3.pts, frame, ground));
    if (h) merged.rows.push(hSumRow(h, ctx.doc));
    // his minefield in front of the Obj: the breach before H
    const brR = recipe.enMfAtk ? attackBreach(recipe as any, ctx.doc, !!inp.night, undefined, terrain.kind)?.row : null;
    if (brR) merged.rows.push(brR);
    const p2r = h ? phase2Row(h, ctx.doc) : null;
    if (p2r) merged.rows.push(p2r);
    const p3r = h ? phase3Row(h, ctx.doc) : null;
    if (p3r) merged.rows.push(p3r);
    // the reorganisation: his counter-attack ways in onto the last objective, in place of the solver's unread row
    const ca = counterAttack(raw, frame, ground, ctx.doc, enemy?.type ?? null);
    if (ca) { merged.rows = merged.rows.filter((r) => r.name !== 'Approaches covered'); merged.rows.push(ca.row); }
    // the unit's ATGMs (its own and any AT Coys grouped to it) onto the last objective, a pair facing each way in
    const ao = ca && unit?.atgm.length ? atOnObj(ca, raw, unit.atgm, ctx.doc, ATGM_KEY) : null;
    if (ao) {
      merged.rows.push(ao.row);
      if (ao.pts.length) { fit.atExtras = ao.pts; raw = solveRecipe(recipe, ctx, { ...solveOpts, extraPoints: ao.pts }); }
    }
    const obj = raw.items.find((i) => i.role === 'obj');
    const nb = inp.night && inp.nmRules && route && obj ? nightBrief(route, P(obj.pts.reduce((a, p) => a + p.x, 0) / obj.pts.length, obj.pts.reduce((a, p) => a + p.y, 0) / obj.pts.length), frame, terrain.kind, inp.nmRules, ground.mov?.() ?? null) : null;
    if (nb) merged.rows.push(nightRow(nb));
    const af = attackFactors(recipe.layout, merged.rows, raw, frame, ground, h, choke, route, ctx.doc);
    fit.attack = { hSum: h, choke, factors: af.factors, night: nb, route, finder: find.rows, phase2: ph2 ? { route: ph2.route, side: ph2.side, offDeg: ph2.offDeg, obj2From: ph2.obj2From } : undefined, phase3: ph3 ? { route: ph3.route, side: ph3.side, offDeg: ph3.offDeg } : undefined, counter: ca ? { apchs: ca.apchs, mover: ca.mover } : undefined, tanks: recipe.tanks ? { mode: recipe.tanks, route: tk?.route ?? null, fieldM: tk?.fieldM ?? null } : undefined };
    fit.score = af.score;
  }
  // a mountain layout's own rows (MW, PlanMountain), on the fitted posns
  // the strong points and the Obj read on the elevation (MW s12 para 9 p 152; s7 para 3 p 78)
  const elevAt = (p: XY) => { const w = toWorld(frame, p); return ground.elev(w.x, w.y); };
  for (const r of layoutRows(raw.items, recipe, ctx.doc, elevAt)) { const i = merged.rows.findIndex((m) => m.name === r.name); if (i >= 0) merged.rows[i] = r; else merged.rows.push(r); }
  // what the ground's books add to the rows (mountains, desert, night: PlanContext.groundNotes)
  merged.rows = groundNotes(merged.rows, ctx.doc, terrain.kind, recipe.task, recipe.echelon, recipe.task === 'attack' ? !!inp.night : null);
  // Auto ranks on every check the plan shows, the geometry ones (frontage, depth, gaps) as well as the ground's
  const all = [...merged.rows, ...merged.slots.flatMap((s) => s.checks)];
  fit.fails = all.filter((c) => c.st === 'fail').length;
  fit.warns = all.filter((c) => c.st === 'warn').length;
  const res: SolveResult = { ...raw, mode: 'terrain', rows: merged.rows, slots: merged.slots, confirm: canal ? [...raw.confirm, ...canal.confirm] : raw.confirm, assumptions: [...raw.assumptions.filter((a) => !/terrain was not read/.test(a)), `Fitted to the ground: ${fit.data}.`] };
  return { recipe, res, raw, fit, frame, anchor: inp.anchor, bearing: inp.bearing, manual: manualJ, terrain, detected, enemy, unit };
}

// ── the unit's AT weapons (ORBAT) ──────────────────────────────────────────────────────────────────────────────────
const ATGM_KEY = '15111200';
const isAtgmItem = (r: string) => r === 'atgm' || r.startsWith('atgmX');
const fwdFront = (res: SolveResult, recipe: Recipe) => {
  const fwd = res.slots.filter((s) => recipe.slots.find((x) => x.role === s.role)?.kind === 'fwd' && s.turnDeg === 0);
  return fwd.length ? { y: Math.max(...fwd.map((s) => s.centre.y + s.hM / 2)), x0: Math.min(...fwd.map((s) => s.centre.x - s.wM / 2)), x1: Math.max(...fwd.map((s) => s.centre.x + s.wM / 2)), fwd } : null;
};
const atgmRangeOf = (doc: DoctrineSet, unit: UnitBrief | null) => unit?.atgm.find((a) => a.rangeM)?.rangeM ?? (resolveRange(doc, doctrineAt(doc, 'atFramework.atgmRangeM'))?.[0] ?? 3000);

/**
 * ATGM pairs beyond the recipe's, from the unit's launchers (ORBAT: a Std Inf Bn's 4 BS = 2 pairs): each to a tank
 * approach where it closes on the FDL, 500-600 m behind the forward edge in the depth localities (IBB S54 para 20 a
 * p 295: behind the 106/75 RRs, giving depth to the short-range AT; atFramework.atgmBehindRrM), the two launchers 450 m
 * apart across it (IBB 400-500 m);
 * an approach the posted ATGMs do not reach first, then every pair left on the main one: concentrated on the most
 * threatened tank approach, not dissipated (DW s16 para 4 b-c p 58; IBB S17 para 12 p 73: densest at the most vital
 * area, never spread evenly; OOW1 pp 25, 44: AT density on the main tank approaches). Only without approaches (or when
 * the main one does not reach the FDL), on the flanks of the FDL. Plan metres.
 */
export function atgmExtras(res: SolveResult, recipe: Recipe, unit: UnitBrief | null, approaches: FitApproach[] | null, f: FitFrame | null, doc: DoctrineSet): { role: string; key: string; label: string; at: XY }[] {
  const have = res.items.filter((i) => isAtgmItem(i.role)).length;
  const extra = atgmPairs(unit) - Math.floor(have / 2);
  const fr = fwdFront(res, recipe);
  if (!unit || extra <= 0 || !fr) return [];
  const range = atgmRangeOf(doc, unit);
  const spacing = resolveRange(doc, doctrineAt(doc, 'atFramework.atgmDetSpacingM'));
  const half = spacing ? (spacing[0] + spacing[1]) / 4 : 225;
  const br = resolveRange(doc, doctrineAt(doc, 'atFramework.atgmBehindRrM')), behindRr = br ? (br[0] + br[1]) / 2 : 550;
  const posted = res.items.filter((i) => isAtgmItem(i.role)).map((i) => i.pts[0]);
  const sites: { x: number; why: string }[] = [];
  if (approaches && approaches.length && f) {
    const crossX = (a: FitApproach) => {
      let best: XY | null = null, bd = Infinity;
      for (const w of a.path) { const l = toLocal(f, w); const d = Math.abs(l.y - fr.y); if (d < bd) { bd = d; best = l; } }
      return best && bd < 600 ? best.x : null;
    };
    const covered = (a: FitApproach) => a.path.some((w) => { const l = toLocal(f, w); return l.y >= fr.y - 200 && l.y <= fr.y + range && posted.some((p) => Math.hypot(p.x - l.x, p.y - l.y) <= range); });
    // every approach in ATGM reach first, then the rest concentrated on the main approach (was: one more to the main, one
    // to each other approach, the rest to the open flanks: spread evenly, which DW p 58 and IBB p 73 rule out)
    const unc = approaches.filter((a) => !covered(a));
    const mainA = approaches.find((a) => a.main) ?? approaches[0];
    const order = [...unc];
    while (order.length < unc.length + extra) order.push(mainA);
    for (const a of order) { const x = crossX(a); if (x !== null) sites.push({ x, why: a.id }); if (sites.length >= extra) break; }
  }
  // no approaches (or too few): the open flanks of the FDL, left then right
  for (let i = 0; sites.length < extra && i < Math.max(4, extra); i++) sites.push({ x: i % 2 === 0 ? fr.x0 + 300 : fr.x1 - 300, why: i % 2 === 0 ? 'Lt flank' : 'Rt flank' });
  const out: { role: string; key: string; label: string; at: XY }[] = [];
  // pairs that land on the same place (an AT Coy's six on one approach) fan out along the front, 3 pairs' width apart (E)
  const step = half * 3, seen: number[] = [];
  sites.slice(0, extra).forEach((s, k) => {
    const y = fr.y - behindRr;
    const n = seen.filter((x) => Math.abs(x - s.x) < 1).length;
    seen.push(s.x);
    const x = n === 0 ? s.x : s.x + (n % 2 ? 1 : -1) * Math.ceil(n / 2) * step;
    out.push({ role: `atgmX${k + 1}`, key: ATGM_KEY, label: 'BS', at: P(x - half, y) });
    out.push({ role: `atgmX${k + 1}`, key: ATGM_KEY, label: 'BS', at: P(x + half, y) });
  });
  return out;
}

/**
 * AT cover on the tank approaches (an enemy with tanks: Mech / Armd): each approach, from the FDL out to the ATGM's
 * reach, under ATGM fire (any launcher within its range), or only the forward Coys' 106 mm RR, or nothing.
 */
export function atCoverRow(res: SolveResult, recipe: Recipe, unit: UnitBrief | null, approaches: FitApproach[] | null, f: FitFrame | null, doc: DoctrineSet, en: EnemySpec | null): Check | null {
  if (!en || en.type === 'inf') return null;
  const fr = fwdFront(res, recipe);
  if (!fr) return null;
  const atgm = atgmRangeOf(doc, unit);
  // the forward Coys' RR: the unit's (ORBAT); a unit with none printed gets none, not the doctrine's
  const rr = unit ? unit.rr.find((r) => r.rangeM)?.rangeM ?? 0 : (resolveRange(doc, doctrineAt(doc, 'attack.bofRangeMaxM'))?.[0] ?? 1189);
  const pairs = atgmPairs(unit), nRr = unit ? unit.rr.reduce((a, w) => a + w.count, 0) : 0;
  const held = unit ? `; the ${unit.name} holds ${unit.atgm.reduce((a, w) => a + w.count, 0)} ATGM (${pairs} pair${pairs === 1 ? '' : 's'})${nRr ? ` and ${nRr} x 106 mm RR` : ', no RR printed'} (ORBAT)` : '';
  if (!approaches || !f) return { name: 'AT cover', st: 'unchecked', reason: `needs the tank approaches (terrain data)${held}` };
  if (!approaches.length) return { name: 'AT cover', st: 'pass', reason: `no tank approach found${held}` };
  const posts = res.items.filter((i) => isAtgmItem(i.role)).map((i) => i.pts[0]);
  const parts: string[] = [];
  let worst: CheckState = 'pass';
  const counts: { a: FitApproach; n: number }[] = [];
  for (const a of approaches) {
    const near = a.path.map((w) => toLocal(f, w)).filter((l) => l.y >= fr.y - 200 && l.y <= fr.y + atgm);
    const byAtgm = posts.filter((p) => near.some((l) => Math.hypot(p.x - l.x, p.y - l.y) <= atgm)).length;
    counts.push({ a, n: byAtgm });
    const byRr = !rr ? [] : fr.fwd.filter((s) => near.some((l) => Math.hypot(Math.max(0, Math.abs(l.x - s.centre.x) - s.wM / 2), Math.max(0, Math.abs(l.y - s.centre.y) - s.hM / 2)) <= rr)).map((s) => s.label);
    if (byAtgm) parts.push(`${a.id}${a.main ? ' (main)' : ''}: ${byAtgm} ATGM${byRr.length ? ` + RR of ${byRr.join(', ')}` : ''}`);
    else if (byRr.length) { parts.push(`${a.id}${a.main ? ' (main)' : ''}: RR of ${byRr.join(', ')} only (${rr} m)`); if (worst === 'pass') worst = 'warn'; }
    else { parts.push(`${a.id}${a.main ? ' (main)' : ''}: no AT weapon in reach`); worst = a.main || a.full ? 'fail' : worst === 'pass' ? 'warn' : worst; }
  }
  // the books' AT rules beside the reach: more AT weapons than the expected tanks, densest at the vital area, few in the
  // FDLs in the plains (some in the desert), tank-hunting parties at the hull-down sites (IBB S17 p 73, S54 pp 294-295)
  const rules = '. The AT weapons should be more than the expected number of En tanks, without denuding the main defences (IBB p 294 para 18): count them against the threat; densest at the most vital area, never spread evenly (IBB p 73 para 12); in the Punjab plains few in the FDLs, in the desert some (p 73 para 13); ATGM 500-600 m behind the RR in the depth localities (p 295); tank-hunting parties at the hull-down sites (p 294 para 19)';
  // the main approach the densest: the ATGMs concentrated on the most threatened tank approach, not spread evenly
  // (DW s16 para 4 b-c p 58; IBB S17 para 12 p 73); measured as the launchers in reach of each approach
  const main = counts.find((c) => c.a.main);
  const denser = main ? counts.filter((c) => c !== main && c.n > main.n) : [];
  if (main && denser.length && main.n > 0 && worst === 'pass') {
    return {
      name: 'AT cover', st: 'warn',
      reason: `${parts.join('; ')}: ${denser.map((c) => c.a.id).join(', ')} has more ATGM in reach than the main approach ${main.a.id} (DW p 58: concentrate on the most threatened approach; IBB p 73: densest at the most vital area) (ATGM ${(atgm / 1000).toFixed(1)} km${rr ? `, RR ${rr} m` : ''})${held}${rules}`,
      detail: { head: `Main approach ${main.a.id} not the densest`, why: 'The ATGMs should be able to concentrate on the most threatened tank approach and not be dissipated (DW s16 para 4 b-c p 58); AT weapons densest at the most vital area, never spread evenly (IBB S17 para 12 p 73).', items: counts.map((c) => `${c.a.id}${c.a.main ? ' (main)' : ''}: ${c.n} ATGM in reach`), fix: [`Move pairs from ${denser.map((c) => c.a.id).join(', ')} to cover ${main.a.id}`, 'Keep alternate posns on the other approaches so the ATGMs can switch to them'] },
    };
  }
  return { name: 'AT cover', st: worst, reason: `${parts.join('; ')} (ATGM ${(atgm / 1000).toFixed(1)} km${rr ? `, RR ${rr} m` : ""})${held}${rules}` };
}

/**
 * J: the posn that does worst here (fail, then warn; one J has not moved yet), moved to the best spot round it.
 * Spots are tried on rings of 100 m up to 1.5 x the slide limit, eight ways each, the whole plan fitted again for each;
 * the spot kept is the one with the fewest fails and warnings for that posn, then the plan's best score. Null when no
 * posn can be improved.
 */
export function nextBestSpot(inp: FitLayoutInput, current: FittedLayout, skip: ReadonlySet<string> = new Set(), refit: (i: FitLayoutInput) => FittedLayout | null = fitLayout): { role: string; label: string; move: XY; distM: number; to: FittedLayout } | null {
  const rank: Record<CheckState, number> = { fail: 0, warn: 1, unchecked: 2, pass: 3 };
  const slots = current.res.slots.filter((s) => !skip.has(s.role) && (s.st === 'fail' || s.st === 'warn')).sort((a, b) => rank[a.st] - rank[b.st]);
  // the fit's own slide limit (Bn and above, else Coy), 1.5 times
  const bn = (levelOf(inp.recipe.echelon) ?? 2) >= 2;
  const sl = resolveRange(inp.ctx.doc, doctrineAt(inp.ctx.doc, bn ? 'fit.slideMaxM.bn' : 'fit.slideMaxM.coy'));
  const lim = (sl ? (sl[0] + sl[1]) / 2 : bn ? 700 : 400) * 1.5;
  const posnBad = (f: FittedLayout, role: string) => {
    const s = f.res.slots.find((x) => x.role === role);
    return s ? s.checks.filter((c) => c.st === 'fail').length * 10 + s.checks.filter((c) => c.st === 'warn').length : 99;
  };
  for (const s of slots) {
    const here = posnBad(current, s.role);
    let best: { move: XY; d: number; f: FittedLayout; bad: number } | null = null;
    for (let r = 100; r <= lim; r += 100) {
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        const move = { x: r * Math.cos(a), y: r * Math.sin(a) };
        const manual = addNudges(current.manual, { [s.role]: move });
        const f = refit({ ...inp, manual });
        if (!f) continue;
        const bad = posnBad(f, s.role);
        // the posn must do better, and the plan as a whole must rank better (a move that helps one posn by pushing
        // another into NO-GO, or that only shuffles the trouble, is not offered)
        const planBetter = f.fit.fails < current.fit.fails || (f.fit.fails === current.fit.fails && (f.fit.warns < current.fit.warns || (f.fit.warns === current.fit.warns && f.fit.score > current.fit.score)));
        if (bad >= here || !planBetter) continue;
        if (!best || bad < best.bad || (bad === best.bad && f.fit.score > best.f.fit.score)) best = { move, d: r, f, bad };
      }
      if (best && best.bad === 0) break;
    }
    if (best) return { role: s.role, label: s.label, move: best.move, distM: best.d, to: best.f };
  }
  return null;
}
