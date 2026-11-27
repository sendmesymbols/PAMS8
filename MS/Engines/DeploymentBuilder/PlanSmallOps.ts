/**
 * PlanSmallOps.ts — PURE. Phase 8 of the Intelligent Deployment (PlanBuilder_Plan.md 9.4): an ambush, a patrol and a
 * recce, laid over the engines the Movement Guide and the Platoon Guide already run. Nothing is rewritten:
 *
 *   Ambush  the road under the click read up toward where he comes from (RouteScanner), the spot scored and laid out
 *           line / L / V (MovementGuidePlans.ambushSiteAt), better sites along the road (ambushSites), the KZ in view
 *           from the fire group, each stop's view up and down the road, the RV 750-900 m back.
 *   Patrol  the routes out and in (MovementGuidePlans.planPatrol) and the patrol card on each
 *           (PlatoonGuideRead.patrolCard: legs, bounds, FRV, times by day and night, stretches seen and hidden,
 *           villages, dangers on the way).
 *   Recce   OPs on the own side of the NAI where they see most of it between them (high ground, cover), the routes to
 *           them in dead ground (planPatrol with the NAI as the threat).
 *
 * Plan metres as PlanSolve: x across (right +), y toward where the plan is aimed (his approach, the Obj, the NAI). The
 * pivot (the KZ centre, the SP) lands on the click and never moves. World: Web Mercator. Without the ground the solver's
 * geometry stands and every ground row stays grey (safety first, as the rest of the Plan Builder). A Fail stays honest
 * and says why and what fixes it (CheckDetail).
 *
 * Erasable TypeScript only: Node 24 runs this file as it is (tools/planbuilder-test/smallops.mjs).
 */
import type { DoctrineSet, Recipe } from './PlanRecipes';
import { doctrineAt, resolveRange } from './PlanRecipes';
import type { Check, CheckDetail, SolveCtx, SolveOptions, SolveResult, XY } from './PlanSolve';
import { solveRecipe } from './PlanSolve';
import type { FitFrame, FitLayoutInput, FitResult, FittedLayout } from './PlanFit';
import { detectTerrain } from './PlanFit';
import { RouteScanner, bearingOf, distToLine, groundDist, offsetPt, pointInRing, type GoingSets, type MercXY, type NearLine, type RouteReading, type Rules, type Station } from '../MovementGuide/MovementGuideScan';
import { ambushSiteAt, ambushSites, planPatrol, stationAtChain, type AmbushShape, type AmbushSite } from '../MovementGuide/MovementGuidePlans';
import { patrolCard, plRulesFrom, type PatrolCard, type PlFootSpeeds, type PlProbe } from '../PlatoonGuide/PlatoonGuideRead';
import { nightMarchChart } from '../NightMarch/NightMarchRead';

/** The bundle reader the small ops read: the Movement Guide's (PlanGroundProbe hands it over), with the movers' going. */
export interface SmallProbe extends PlProbe {
  going(profile: string): GoingSets;
  classLabel(c: number): string;
}
export type Mover = 'wheeled' | 'tracked' | 'dismounted';

/** What the map products draw (Web Mercator). */
export interface SmallReading {
  task: 'ambush' | 'patrol' | 'recce';
  /** Recce laid as a screen (IC s73): posts in front of the main posn, the ground he would watch it from. */
  screen?: boolean;
  /** Area ambush (IC s44 para 11 b p 152): the outlying ambushes on his ways in and out along the Rd. */
  outlying?: { x: number; y: number; label: string; alongM: number; score: number; seenPct: number }[];
  /** Ambush: the road read, from where he comes to beyond the KZ; the site; better sites along it; the KZ points seen. */
  road?: MercXY[] | null;
  site?: { score: number; shape: AmbushShape; groundShape: AmbushShape; exits: 'both' | 'one' | 'none'; parts: AmbushSite['parts'] } | null;
  better?: { x: number; y: number; score: number; alongM: number; shape: AmbushShape }[];
  kzPts?: { x: number; y: number; seen: boolean }[];
  /** Patrol: the routes out and in, stretches the threat may see / hidden from it, what lies on the way. */
  out?: MercXY[] | null;
  back?: MercXY[] | null;
  exposed?: MercXY[][];
  dead?: MercXY[][];
  marks?: { x: number; y: number; label: string }[];
  /**
   * Patrol: the Night March chart on the route out (SP to the Obj: NightMarchRead, the same engine as the Night March
   * tool and the attack's march): legs with grid bearings, paces and night minutes, the march time, the stretches inside
   * the En night and thermal sights, the chart's cautions. Read only when the Night March rules are given.
   */
  night?: { legs: { i: number; bearingDeg: number; gridDeg: number; distM: number; paces: number; min: number; sight: string }[]; grid: string; lengthM: number; paces: number; marchMin: number; moveMin: number; thermalAtM: number | null; nightAtM: number | null; checks: string[] };
  /** Patrol: the route card, leg by leg (out and back), for the Check step and Copy as Text. `bearingDeg` is true (the
   *  line drawn); `gridDeg` is the grid bearing in `grid` (the 1:50k sheets' grid, else UTM), and mils and magnetic
   *  (grid - GMA) are worked from it. */
  legs?: { way: 'Out' | 'In'; i: number; bearingDeg: number; gridDeg: number; magDeg: number | null; mils: number; distM: number; paces: number; minDay: number; minNight: number; feature: string | null }[];
  /** The grid the route card's bearings are in ("Indian grid zone I", else "UTM zone 43"). */
  grid?: string;
  /** Recce: each OP and what it sees of the NAI (`by`: the OPs that see a point), the routes to them. */
  ops?: { x: number; y: number; label: string; seenPct: number; riseM: number; cover: boolean }[];
  naiPts?: { x: number; y: number; by: number[] }[];
  routes?: (MercXY[] | null)[];
}

interface SmallRead {
  geom: Record<string, { pts: XY[] }>;
  extra: { role: string; key: string; label: string; at: XY }[];
  rows: Check[];
  confirm: string[];
  score: number;
  small: SmallReading;
  pending: boolean;
}

// ── small helpers ───────────────────────────────────────────────────────────────────────────────────────────────────
const D2R = Math.PI / 180;
const kOf = (y: number) => 1 / Math.cos(2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2);
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
/** A bearing as 0-359 (a negative one, west of north, turned round). */
const deg360 = (d: number) => ((Math.round(d) % 360) + 360) % 360;
const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}` : `${Math.round(m)} min`);
const ctr = (pts: XY[]): XY => ({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length });
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

function toW(f: FitFrame, p: XY): MercXY {
  const lx = (p.x - f.pivot.x) * f.k, ly = (p.y - f.pivot.y) * f.k;
  const c = Math.cos(f.bearing), s = Math.sin(f.bearing);
  return [f.anchor.x + lx * c + ly * s, f.anchor.y - lx * s + ly * c];
}
function toL(f: FitFrame, w: MercXY): XY {
  const dx = (w[0] - f.anchor.x) / f.k, dy = (w[1] - f.anchor.y) / f.k;
  const c = Math.cos(f.bearing), s = Math.sin(f.bearing);
  return { x: dx * c - dy * s + f.pivot.x, y: dx * s + dy * c + f.pivot.y };
}

/** A doctrine figure as a range (a single value is [v, v]), else the fallback. */
function fig(doc: DoctrineSet, path: string, fb: [number, number]): [number, number] {
  return resolveRange(doc, doctrineAt(doc, path)) ?? fb;
}
const one = (doc: DoctrineSet, path: string, fb: number) => fig(doc, path, [fb, fb])[0];

export function pathLen(p: MercXY[]): number {
  let L = 0;
  for (let i = 1; i < p.length; i++) L += groundDist(p[i - 1], p[i]);
  return L;
}
/** The point `m` ground metres along a path (clamped to its ends). */
export function along(p: MercXY[], m: number): MercXY {
  if (m <= 0 || p.length < 2) return p[0];
  let acc = 0;
  for (let i = 1; i < p.length; i++) {
    const d = groundDist(p[i - 1], p[i]);
    if (acc + d >= m) {
      const t = d > 0 ? (m - acc) / d : 0;
      return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t];
    }
    acc += d;
  }
  return p[p.length - 1];
}
/** The part of a path between two chainages. */
function cut(p: MercXY[], from: number, to: number): MercXY[] {
  const out: MercXY[] = [along(p, from)];
  const push = (q: MercXY) => { if (groundDist(out[out.length - 1], q) > 0.5) out.push(q); };
  let acc = 0;
  for (let i = 1; i < p.length; i++) {
    acc += groundDist(p[i - 1], p[i]);
    if (acc > from && acc < to) push(p[i]);
  }
  push(along(p, to));
  return out;
}
/** Douglas-Peucker in ground metres, then thinned to at most `max` points (the symbol draws through them). */
export function simplifyPath(p: MercXY[], tolM: number, max = 24): MercXY[] {
  if (p.length <= 2) return p.slice();
  const keep = new Uint8Array(p.length);
  keep[0] = keep[p.length - 1] = 1;
  const stack: [number, number][] = [[0, p.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1, wd = 0;
    for (let i = a + 1; i < b; i++) {
      const d = distToLine(p[i], [p[a][0], p[a][1], p[b][0], p[b][1]]);
      if (d > wd) { wd = d; worst = i; }
    }
    if (worst > 0 && wd > tolM) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  let out = p.filter((_, i) => keep[i]);
  if (out.length > max) {
    const n = max;
    out = Array.from({ length: n }, (_, i) => out[Math.round((i * (out.length - 1)) / (n - 1))]);
  }
  return out;
}

// ── the road under the click ────────────────────────────────────────────────────────────────────────────────────────

export interface RoadRead {
  /** From `upM` toward where he comes from, through the click's point on the road, to `downM` beyond. */
  path: MercXY[];
  /** Chainage of the click's point on the road along `path`. */
  chainM: number;
  /** The click's distance from the road. */
  snapM: number;
  at: MercXY;
  name: string | null;
}

/**
 * The road or track nearest the click (within `snapM`), walked both ways from the click's foot on it, joining the
 * pieces the tiles cut it into (ends within 30 m, the straightest on). The way whose first 150 m heads nearest the
 * aim is up the road (where he comes from). Null when no road is that near.
 */
export function roadAround(probe: { lines(x: number, y: number, r: number, kinds: ReadonlySet<string>): NearLine[] }, click: MercXY, aimDeg: number, upM: number, downM: number, snapM: number): RoadRead | null {
  const lines = probe.lines(click[0], click[1], Math.max(upM, downM) + 300, new Set(['road']));
  const pieces = lines.map((l) => {
    const pts: MercXY[] = [];
    for (let i = 0; i + 1 < l.xy.length; i += 2) pts.push([l.xy[i], l.xy[i + 1]]);
    return { pts, name: (l.attrs?.n as string) ?? (l.attrs?.name as string) ?? null };
  }).filter((p) => p.pts.length >= 2);
  let best = -1, bd = Infinity, seg = 0;
  pieces.forEach((pc, k) => {
    for (let i = 0; i + 1 < pc.pts.length; i++) {
      const d = distToLine(click, [pc.pts[i][0], pc.pts[i][1], pc.pts[i + 1][0], pc.pts[i + 1][1]]);
      if (d < bd) { bd = d; best = k; seg = i; }
    }
  });
  if (best < 0 || bd > snapM) return null;
  const pc = pieces[best].pts;
  const a = pc[seg], b = pc[seg + 1];
  const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((click[0] - a[0]) * vx + (click[1] - a[1]) * vy) / L2)) : 0;
  const q: MercXY = [a[0] + vx * t, a[1] + vy * t];
  const JOIN = 30;
  const walk = (dir: 1 | -1, want: number): MercXY[] => {
    const out: MercXY[] = [];
    const used = new Set<number>([best]);
    let cur = q, acc = 0, pts = pc, i = dir > 0 ? seg + 1 : seg, d = dir as number;
    while (acc < want) {
      if (i < 0 || i >= pts.length) {
        // the end of this piece: carry on along the piece that starts within 30 m of it, the straightest
        const head = out.length ? bearingOf(out.length > 1 ? out[out.length - 2] : q, cur) : bearingOf(q, cur);
        let nk = -1, nRev = false, nTurn = 999;
        for (let k = 0; k < pieces.length; k++) {
          if (used.has(k)) continue;
          for (const rev of [false, true]) {
            const o = pieces[k].pts, s0 = rev ? o[o.length - 1] : o[0], s1 = rev ? o[o.length - 2] : o[1];
            if (groundDist(s0, cur) > JOIN) continue;
            const turn = Math.abs(((bearingOf(s0, s1) - head + 540) % 360) - 180);
            if (turn < nTurn) { nTurn = turn; nk = k; nRev = rev; }
          }
        }
        if (nk < 0 || nTurn > 100) break;
        used.add(nk);
        pts = nRev ? pieces[nk].pts.slice().reverse() : pieces[nk].pts;
        i = 1; d = 1;
        continue;
      }
      const p = pts[i], step = groundDist(cur, p);
      if (acc + step >= want) {
        const f = step > 0 ? (want - acc) / step : 0;
        out.push([cur[0] + (p[0] - cur[0]) * f, cur[1] + (p[1] - cur[1]) * f]);
        acc = want;
        break;
      }
      if (step > 0.5) out.push(p);
      acc += step; cur = p; i += d;
    }
    return out;
  };
  const fwd = walk(1, Math.max(upM, downM)), bwd = walk(-1, Math.max(upM, downM));
  const headOf = (w: MercXY[]) => (w.length ? bearingOf(q, along([q, ...w], 150)) : NaN);
  const off = (h: number) => (Number.isNaN(h) ? 999 : Math.abs(((h - aimDeg + 540) % 360) - 180));
  const fwdUp = off(headOf(fwd)) <= off(headOf(bwd));
  const upW = fwdUp ? fwd : bwd, downW = fwdUp ? bwd : fwd;
  const upRev = (upW.length ? cut([q, ...upW], 0, upM).slice(1) : []).reverse();
  const down = downW.length ? cut([q, ...downW], 0, downM).slice(1) : [];
  const path: MercXY[] = [...upRev, q, ...down];
  return { path, chainM: pathLen([...upRev, q]), snapM: bd, at: q, name: pieces[best].name };
}

// ── the solver's geometry stretched to the aim (patrol, recce) ───────────────────────────────────────────────────────

/** Plan-metre geometry for the aimed distance: the patrol's Obj and routes, the recce's NAI, OPs and routes. */
function aimGeom(recipe: Recipe, doc: DoctrineSet, aimM: number | null): Record<string, { pts: XY[] }> {
  const g: Record<string, { pts: XY[] }> = {};
  if (recipe.task === 'patrol') {
    const d = Math.max(200, aimM ?? one(doc, 'smallOps.patrol.defaultObjM', 3000));
    const h = one(doc, 'smallOps.patrol.objSizeM', 300) / 2;
    const frv = fig(doc, 'smallOps.patrol.frvM', [400, 500]);
    const fy = Math.max(d * 0.4, d - (frv[0] + frv[1]) / 2);
    g.obj = { pts: [{ x: -h, y: d + h }, { x: h, y: d + h }, { x: h, y: d - h }, { x: -h, y: d - h }] };
    g.frv = { pts: [{ x: 0, y: fy }] };
    g.out = { pts: [{ x: 0, y: 0 }, { x: d * 0.04, y: fy * 0.5 }, { x: 0, y: d - h }] };
    g.in = { pts: [{ x: -h * 0.6, y: d - h }, { x: -d * 0.1, y: d * 0.5 }, { x: -30, y: 30 }] };
  } else if (recipe.task === 'recce' && recipe.layout === 'screen') {
    // the ground in front (where he would watch the main posn from) at the aim, the posts between it and the main posn
    const d = Math.max(800, aimM ?? one(doc, 'smallOps.screen.defaultWatchM', 2000));
    const front = one(doc, 'smallOps.screen.frontM', 3000), deep = one(doc, 'smallOps.screen.watchDepthM', 1000);
    const fwd = fig(doc, 'smallOps.screen.fwdM', [300, 1500]);
    g.nai = { pts: [{ x: -front / 2, y: d + deep / 2 }, { x: front / 2, y: d + deep / 2 }, { x: front / 2, y: d - deep / 2 }, { x: -front / 2, y: d - deep / 2 }] };
    const py = Math.max(fwd[0], Math.min(fwd[1], (d - deep / 2) * 0.6));
    const ops = recipe.slots.filter((x) => /^op\d$/.test(x.role)).map((x) => x.role);
    const xs = ops.map((_, i) => (ops.length === 1 ? 0 : -front / 3 + (i * (2 * front)) / 3 / (ops.length - 1)));
    ops.forEach((role, i) => {
      const at = { x: xs[i], y: py };
      g[role] = { pts: [at] };
      const rt = `rt${role.slice(2)}`;
      if (recipe.slots.some((x) => x.role === rt)) g[rt] = { pts: [{ x: at.x, y: at.y - 40 }, { x: at.x * 0.5, y: py * 0.5 }, { x: 0, y: 40 }] };
    });
    if (ops.length >= 2 && recipe.slots.some((x) => x.role === 'scr')) g.scr = { pts: [{ x: xs[0], y: py }, { x: 0, y: py * 0.5 }, { x: xs[xs.length - 1], y: py }] };
  } else if (recipe.task === 'recce') {
    const d = Math.max(900, aimM ?? one(doc, 'smallOps.recce.defaultAreaM', 2500));
    const [w, h] = fig(doc, 'smallOps.recce.naiM', [1000, 700]);
    g.nai = { pts: [{ x: -w / 2, y: d + h / 2 }, { x: w / 2, y: d + h / 2 }, { x: w / 2, y: d - h / 2 }, { x: -w / 2, y: d - h / 2 }] };
    const s = Math.min(1500, Math.max(600, d * 0.5));
    const ops = recipe.slots.filter((x) => /^op\d$/.test(x.role)).map((x) => x.role);
    const xs = ops.length === 3 ? [-800, 0, 800] : ops.length === 2 ? [-500, 500] : [0];
    ops.forEach((role, i) => {
      const at = { x: xs[i] ?? 0, y: d - s - (ops.length === 3 && i === 1 ? 150 : 0) };
      g[role] = { pts: [at] };
      const rt = `rt${role.slice(2)}`;
      if (recipe.slots.some((x) => x.role === rt)) g[rt] = { pts: [{ x: at.x * 0.04, y: 40 }, { x: at.x * 0.96, y: at.y - 40 }] };
    });
  }
  return g;
}

/** Geometry only (no ground): the recipe laid as the solver lays it, the patrol's Obj and the recce's NAI at the aimed distance. */
export function solveSmall(recipe: Recipe, ctx: SolveCtx, opts: SolveOptions = {}, aimM: number | null = null): SolveResult {
  const geom = aimGeom(recipe, ctx.doc, aimM);
  return solveRecipe(recipe, ctx, { ...opts, geom: { ...geom, ...(opts.geom ?? {}) } });
}

// ── ambush ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const MOVER_WORD: Record<Mover, string> = { wheeled: 'the En vehicles', tracked: 'the En tanks', dismounted: 'the En on foot' };
const SHAPE_WORD: Record<AmbushShape, string> = { line: 'line', L: 'L', V: 'V' };
const SHAPE_WHY: Record<AmbushShape, string> = { line: 'a straight stretch without high ground on both sides', L: 'a bend or crest within 200 m', V: 'high ground on both sides of the Rd' };
/** "a line", "an L", "a V". */
const A_SHAPE = (s: AmbushShape) => (s === 'L' ? 'an L' : `a ${SHAPE_WORD[s]}`);
/**
 * The layout suits the ground: the ground's own, or an L on a straight stretch (IC s44 para 18 b p 158: the L "can be
 * deployed on a strait stretch of a road or track or a sharp bend").
 */
const SHAPE_FITS = (shape: AmbushShape, gs: AmbushShape) => shape === gs || (shape === 'L' && gs === 'line');

/** A plan as drawn on the map, by role (Web Mercator): Check my plan reads it as it is, no siting search. */
export type Drawn = Record<string, { pts: MercXY[]; base?: { start: MercXY; mid: MercXY; end: MercXY } }>;
interface Ctx { recipe: Recipe; doc: DoctrineSet; frame: FitFrame; mov: SmallProbe; R: Rules; inp: FitLayoutInput; base: SolveResult; drawn?: Drawn | null }
const ctrW = (pts: MercXY[]): MercXY => [pts.reduce((a, q) => a + q[0], 0) / pts.length, pts.reduce((a, q) => a + q[1], 0) / pts.length];

/**
 * An ambush layout as drawn (Check my plan): the fire line from the Ambush arc's ends (else the Fire Gp), the stops, the
 * RV, the second leg, which side of the road the fire group lies, how far back the RV is and how much of the way to it
 * is in cover; what is not drawn is taken from the engine's own layout for the spot.
 */
function drawnAmbush(dr: Drawn, eng: AmbushSite['layout'], st: Station, path: MercXY[], mov: SmallProbe, R: Rules, foot: GoingSets): AmbushSite['layout'] {
  const flat = path.flat();
  const fireLine: [MercXY, MercXY] = dr.amb?.pts.length && dr.amb.pts.length >= 2 ? [dr.amb.pts[0], dr.amb.pts[1]] : dr.ambGp?.pts[0] ? [dr.ambGp.pts[0], dr.ambGp.pts[0]] : eng.fireLine;
  const fm: MercXY = [(fireLine[0][0] + fireLine[1][0]) / 2, (fireLine[0][1] + fireLine[1][1]) / 2];
  // the side: left or right of the road's direction at the KZ
  const ahead = offsetPt(st.x, st.y, st.bearing, 50);
  const cross = (ahead[0] - st.x) * (fm[1] - st.y) - (ahead[1] - st.y) * (fm[0] - st.x);
  const meeting = dr.rv?.pts[0] ?? eng.meeting;
  const cover = new Set<number>(R.ambush.coverClasses);
  let cov = 0, n = 0;
  const L = groundDist(fm, meeting);
  for (let d = 30; d <= L; d += 50) {
    const q = along([fm, meeting], d), k = mov.cls(q[0], q[1]);
    n++;
    if (k !== null && cover.has(k) && !foot.nogo.has(k)) cov++;
  }
  return {
    ...eng, side: cross > 0 ? 'L' : 'R', fireLine,
    stops: [dr.stop1?.pts[0] ?? eng.stops[0], dr.stop2?.pts[0] ?? eng.stops[1]],
    arm: dr.amb2?.pts.length && dr.amb2.pts.length >= 2 ? [dr.amb2.pts[0], dr.amb2.pts[1]] : null,
    meeting, meetingM: Math.round(distToLine(meeting, flat)), withdrawalCoverPct: n ? Math.round((100 * cov) / n) : 0,
  };
}

function readAmbush(c: Ctx): SmallRead {
  const { recipe, doc, frame, mov, inp } = c;
  const dr = c.drawn ?? null;
  const mover: Mover = inp.mover ?? 'wheeled';
  // By day or by night (IC s44 paras 16-17 p 157): by night closer together, fire at point blank range; by day dispersed,
  // fire opened at longer ranges. The fire line's band from the Rd follows (smallOps.ambush.fireOffsetNightM / DayM, E).
  const night = !!inp.night;
  const offB = fig(doc, night ? 'smallOps.ambush.fireOffsetNightM' : 'smallOps.ambush.fireOffsetDayM', night ? [30, 120] : [30, 250]);
  // A tank ambush (IC s46 para 9 p 172): the whole column comes into the site before it is sprung: a longer KZ (E).
  const tankKz = mover === 'tracked' ? one(doc, 'smallOps.ambush.tankKzM', 400) : null;
  const R: Rules = { ...c.R, ambush: { ...c.R.ambush, coverFromM: Math.min(c.R.ambush.coverFromM, offB[0]), fireOffsetMaxM: offB[1], ...(tankKz ? { kzM: tankKz } : {}) } };
  const A = R.ambush;
  const shape: AmbushShape = recipe.layout === 'l' ? 'L' : recipe.layout === 'v' ? 'V' : 'line';
  // drawn (Check my plan): the KZ where it is drawn, he comes from Stop 1's side; built: the click and the aim
  const click: MercXY = dr?.kzTgt?.pts[0] ?? (dr?.kz?.pts.length ? ctrW(dr.kz.pts) : [frame.anchor.x, frame.anchor.y]);
  const aimDeg = dr?.stop1?.pts[0] ? bearingOf(click, dr.stop1.pts[0]) : ((frame.bearing / D2R) % 360 + 360) % 360;
  const onRoadM = one(doc, 'smallOps.ambush.onRoadM', 50), snapM = one(doc, 'smallOps.ambush.snapM', 300);
  // an area ambush reads the Rd far enough each way for its outlying ambushes (IC s44 para 11 b p 152)
  const area = recipe.layout === 'area';
  const outReach = area ? fig(doc, 'smallOps.ambush.outlyingM', [400, 1200])[1] + 300 : 0;
  const upM = Math.max(outReach, one(doc, 'smallOps.ambush.upM', 1500)), downM = Math.max(outReach, one(doc, 'smallOps.ambush.downM', 800));
  const rd = roadAround(mov, click, aimDeg, upM, downM, snapM);
  const path: MercXY[] = rd?.path ?? [offsetPt(click[0], click[1], aimDeg, upM), click, offsetPt(click[0], click[1], aimDeg + 180, downM)];
  const chain = rd?.chainM ?? upM;
  const going = mov.going(mover), foot = mov.going('dismounted');
  mov.takePending?.();
  const r: RouteReading = new RouteScanner(R).scan(path, mov, { going, sight: true, threat: null });
  const st = stationAtChain(r, chain);
  const site = ambushSiteAt(r, st, mov, R, foot, shape);
  const L = dr ? drawnAmbush(dr, site.layout, st, path, mov, R, foot) : site.layout;
  const kz0 = Math.max(0, site.chainM - A.kzM / 2), kz1 = Math.min(r.lengthM, site.chainM + A.kzM / 2);
  const kzC: MercXY = along(path, site.chainM);

  // the KZ along the road: the road and its verges, short of the fire line (up to 40 m either side, E)
  const fireOff = Math.min(distToLine(L.fireLine[0], path.flat()), distToLine(L.fireLine[1], path.flat()));
  const halfW = Math.max(12, Math.min(40, fireOff * 0.6));
  const sides: MercXY[] = [], other: MercXY[] = [];
  for (let m = kz0; m <= kz1 + 0.1; m += Math.max(10, (kz1 - kz0) / 6)) {
    const p = along(path, m), h = bearingOf(along(path, Math.max(0, m - 10)), along(path, Math.min(r.lengthM, m + 10)));
    sides.push(offsetPt(p[0], p[1], h - 90, halfW)); other.push(offsetPt(p[0], p[1], h + 90, halfW));
  }
  const kzPoly = [...sides, ...other.reverse()];
  // the fire line's arc bowed away from the road, its arrow into the KZ; the group behind it
  const arcOf = (a: MercXY, b: MercXY, bowM: number, from: MercXY): MercXY[] => {
    const m: MercXY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return [a, b, offsetPt(m[0], m[1], bearingOf(from, m), bowM), kzC];
  };
  const fm: MercXY = [(L.fireLine[0][0] + L.fireLine[1][0]) / 2, (L.fireLine[0][1] + L.fireLine[1][1]) / 2];
  const awayFire = bearingOf(kzC, fm);
  const geomW: Record<string, MercXY[]> = {
    kz: kzPoly,
    amb: arcOf(L.fireLine[0], L.fireLine[1], 30, kzC),
    ambGp: [offsetPt(fm[0], fm[1], awayFire, 55)],
    stop1: [L.stops[0]],
    stop2: [L.stops[1]],
    rv: [L.meeting],
  };
  geomW.wdr = [offsetPt(fm[0], fm[1], awayFire, 80), [(fm[0] + L.meeting[0]) / 2, (fm[1] + L.meeting[1]) / 2], offsetPt(L.meeting[0], L.meeting[1], bearingOf(L.meeting, fm), 25)];
  // The reserve, sited on the same side of the position as the RV (IC s44 para 8 c p 149), near the comd (para 15 b (4)
  // p 156): back along the way to the RV, a little away from the En end. The covering group with the automatic weapons
  // (para 15 b (3) p 156; the V's "third portion" covering the withdrawal, para 18 c p 158): back from the fire line toward
  // the RV, toward the En end where the reaction comes from. Distances E (smallOps.ambush.reserveBackM / coverGpBackM).
  const upDeg = bearingOf(kzC, along(path, kz0));
  const resBack = one(doc, 'smallOps.ambush.reserveBackM', 250), covBack = one(doc, 'smallOps.ambush.coverGpBackM', 150);
  const onWdr = (m: number): MercXY => along([fm, L.meeting], Math.min(m, Math.max(0, groundDist(fm, L.meeting) - 50)));
  const resP = onWdr(resBack), covP = onWdr(covBack);
  geomW.res = [offsetPt(resP[0], resP[1], upDeg + 180, 40)];
  geomW.cov = [offsetPt(covP[0], covP[1], upDeg, 60)];
  const resAt: MercXY | null = dr ? dr.res?.pts[0] ?? null : geomW.res[0];
  const covAt: MercXY | null = dr ? dr.cov?.pts[0] ?? null : geomW.cov[0];
  if (L.arm && recipe.slots.some((s) => s.role === 'amb2')) {
    const am: MercXY = [(L.arm[0][0] + L.arm[1][0]) / 2, (L.arm[0][1] + L.arm[1][1]) / 2];
    geomW.amb2 = arcOf(L.arm[0], L.arm[1], shape === 'L' ? 22 : 30, kzC);
    geomW.amb2Gp = [offsetPt(am[0], am[1], bearingOf(kzC, am), shape === 'L' ? 40 : 55)];
  }
  const geom: Record<string, { pts: XY[] }> = {};
  for (const [k, v] of Object.entries(geomW)) geom[k] = { pts: v.map((w) => toL(frame, w)) };

  // the KZ in view from the fire line (and the second leg), kneeling in cover, a vehicle the target
  const eye = one(doc, 'smallOps.ambush.fireEyeM', 1), tall = one(doc, 'smallOps.ambush.vehicleM', 2.4);
  const eyes: MercXY[] = [L.fireLine[0], fm, L.fireLine[1], ...(L.arm ?? [])];
  const kzPts: SmallReading['kzPts'] = [];
  let unknown = 0;
  for (let m = kz0; m <= kz1 + 0.1; m += 25) {
    const p = along(path, m);
    let best: number | null = null;
    for (const e of eyes) { const s = mov.sight(e[0], e[1], eye, p[0], p[1], tall); if (s !== null) best = Math.max(best ?? 0, s); }
    if (best === null) unknown++;
    kzPts.push({ x: p[0], y: p[1], seen: (best ?? 0) >= 0.5 });
  }
  const seenN = kzPts.filter((p) => p.seen).length, kzShare = kzPts.length ? seenN / kzPts.length : 0;
  // each stop sees the road beyond its end of the KZ (200 m on)
  const stopSees = [[L.stops[0], Math.max(0, kz0 - A.stopM - 200)], [L.stops[1], Math.min(r.lengthM, kz1 + A.stopM + 200)]].map(([s, m]) => {
    const p = along(path, m as number), q = s as MercXY;
    return (mov.sight(q[0], q[1], eye, p[0], p[1], tall) ?? 0) >= 0.5;
  });
  const better = ambushSites(r, mov, R, foot, 6)
    .filter((s) => Math.abs(s.chainM - site.chainM) >= 200 && s.score >= site.score + one(doc, 'smallOps.ambush.betterBy', 10))
    .sort((p, q) => q.score - p.score)
    .slice(0, 2)
    .map((s) => ({ x: s.x, y: s.y, score: s.score, alongM: Math.round(s.chainM - site.chainM), shape: s.layout.shape }));
  // an area ambush (IC s44 para 11 b p 152, Fig 16): the central site and an outlying ambush on his way in (up the Rd) and his way out
  // (down it), each a point ambush of its own at the best site in the band (drawn: where it is drawn)
  const outlying: { up: boolean; label: string; site: AmbushSite; seenPct: number; found: boolean }[] = [];
  if (area) {
    const [oMin, oMax] = fig(doc, 'smallOps.ambush.outlyingM', [400, 1200]);
    const oKz = one(doc, 'smallOps.ambush.outlyingKzM', 80);
    const sites = ambushSites(r, mov, R, foot, 12);
    const chainNear = (p: MercXY) => { let best = 0, bd = Infinity; for (let m = 0; m <= r.lengthM; m += 10) { const d = groundDist(along(path, m), p); if (d < bd) { bd = d; best = m; } } return best; };
    for (const up of [true, false]) {
      const role = up ? 'out1' : 'out2';
      const drawnAt = dr?.[`${role}Gp`]?.pts[0] ?? (dr?.[role]?.pts.length ? ctrW(dr[role].pts) : null);
      let s2: AmbushSite | null = null, found = true;
      if (dr) { if (!drawnAt) continue; s2 = ambushSiteAt(r, stationAtChain(r, chainNear(drawnAt)), mov, R, foot, 'line'); }
      else {
        const band = sites.filter((q) => { const off = up ? kz0 - q.chainM : q.chainM - kz1; return off >= oMin && off <= oMax; }).sort((p2, q) => q.score - p2.score);
        s2 = band[0] ?? null;
        if (!s2) {
          // no site scores in the band: the middle of it, read as it is
          const m = up ? kz0 - (oMin + oMax) / 2 : kz1 + (oMin + oMax) / 2;
          if (m < 0 || m > r.lengthM) continue;
          s2 = ambushSiteAt(r, stationAtChain(r, m), mov, R, foot, 'line');
          found = false;
        }
      }
      const fl = s2.layout.fireLine, fmid: MercXY = [(fl[0][0] + fl[1][0]) / 2, (fl[0][1] + fl[1][1]) / 2];
      let n2 = 0, hit = 0;
      for (let m = Math.max(0, s2.chainM - oKz / 2); m <= Math.min(r.lengthM, s2.chainM + oKz / 2) + 0.1; m += 20) { const q = along(path, m); n2++; if ((mov.sight(fmid[0], fmid[1], eye, q[0], q[1], tall) ?? 0) >= 0.5) hit++; }
      outlying.push({ up, label: recipe.slots.find((x) => x.role === `${role}Gp`)?.label || (up ? 'Outlying 1' : 'Outlying 2'), site: s2, seenPct: n2 ? Math.round((100 * hit) / n2) : 0, found });
    }
    for (const o of outlying) {
      const role = o.up ? 'out1' : 'out2';
      const fl = o.site.layout.fireLine, c2 = along(path, o.site.chainM);
      const fmid: MercXY = [(fl[0][0] + fl[1][0]) / 2, (fl[0][1] + fl[1][1]) / 2];
      if (recipe.slots.some((x) => x.role === role)) geom[role] = { pts: [fl[0], fl[1], offsetPt(fmid[0], fmid[1], bearingOf(c2, fmid), 20), c2].map((w) => toL(frame, w)) };
      if (recipe.slots.some((x) => x.role === `${role}Gp`)) geom[`${role}Gp`] = { pts: [toL(frame, offsetPt(fmid[0], fmid[1], bearingOf(c2, fmid), 45))] };
    }
  }
  const pending = r.pending || !!mov.takePending?.() || unknown > kzPts.length / 2;

  // rows
  const rows: Check[] = [];
  const word = (c2: number | null) => (c2 === null ? 'NO-GO' : mov.classLabel(c2));
  const upWord = (m: number) => `${fmtM(Math.abs(m))} ${m < 0 ? 'up the Rd (toward the En)' : 'down the Rd'}`;
  const betterFix = better[0] ? [`A site ${upWord(better[0].alongM)} scores ${better[0].score} (here ${site.score}): J while placing moves the KZ to it (the blue ring; Shift+J back)`] : [];
  if (!rd) {
    rows.push({ name: 'Road', st: 'fail', reason: `no Rd or track within ${snapM} m of the click: laid across country along the aim`,
      detail: { head: `No Rd or track within ${snapM} m`, why: 'An ambush on vehicles needs the road they use; the bundle has none near the click (a track may be missing from the map).', whyShort: 'no Rd near the click', fix: ['Click on the road or track the En will use', 'A track missing from the map: recce it and lay the ambush by hand'] } });
  } else {
    const cls = st.cls !== null ? mov.classLabel(st.cls) : 'Rd';
    rows.push({ name: 'Road', st: rd.snapM <= onRoadM ? 'pass' : 'warn', reason: `KZ on ${rd.name ? `${rd.name} (${cls})` : `the ${cls}`}${rd.snapM > onRoadM ? `, ${fmtM(rd.snapM)} from the click` : ''}; read ${fmtM(chain)} toward the En and ${fmtM(r.lengthM - chain)} beyond` });
  }
  const mw = MOVER_WORD[mover];
  if (site.exits === 'both') rows.push({ name: 'Target held', st: 'pass', reason: `defile: ${mw} cannot leave the Rd (${word(st.leftWhy)} L, ${word(st.rightWhy)} R)` });
  else if (site.exits === 'one') {
    const shut = st.left === 'nogo' ? 'L' : 'R', why = st.left === 'nogo' ? st.leftWhy : st.rightWhy;
    rows.push({ name: 'Target held', st: 'pass', reason: `${mw} cannot leave the Rd on the ${shut} (${word(why)}); the ${shut === 'L' ? 'R' : 'L'} is open: a stop or mines there` });
  } else {
    rows.push({ name: 'Target held', st: 'warn', reason: `${mw} can leave the Rd on both sides`,
      detail: { head: `${mw[0].toUpperCase()}${mw.slice(1)} can leave the Rd both sides`, why: `No NO-GO for ${mw} beside the Rd here: they drive off the KZ and out of the fire.`, whyShort: 'no NO-GO beside the Rd', fix: [...betterFix, 'Move the KZ to a stretch with a canal, embankment, cutting or close country beside the Rd', 'Block the open sides with mines or obstacles, covered by the stops'] } });
  }
  const hid = site.parts[1];
  rows.push(hid?.ok ? { name: 'Hidden from behind', st: 'pass', reason: hid.what }
    : { name: 'Hidden from behind', st: 'warn', reason: hid?.what ?? `seen from ${A.followM} m back`,
      detail: { head: `Seen from ${A.followM} m back`, why: 'The vehicles behind the KZ see the ambush spring and can stop, deploy or go round.', whyShort: 'the En column behind sees it', fix: [...betterFix, 'Site the KZ just past a bend or over a crest', 'Stop 1 cuts off the vehicles behind (a mine or an obstacle on the Rd)'] } });
  const coverAt = L.side === 'L' ? st.coverL : st.coverR, rise = Math.max(st.riseL, st.riseR);
  if (dr) {
    // drawn: how far back from the road the fire line lies (the Day / Night band: smallOps.ambush.fireOffsetNightM / DayM, E)
    const off2 = Math.round(Math.min(distToLine(L.fireLine[0], path.flat()), distToLine(L.fireLine[1], path.flat())));
    if (off2 < A.coverFromM || off2 > A.fireOffsetMaxM) rows.push({ name: 'Fire line', st: 'warn', reason: `drawn ${off2} m from the Rd (cover is looked for ${A.coverFromM}-${A.fireOffsetMaxM} m out)`, detail: { head: `Fire line ${off2} m from the Rd`, why: off2 < A.coverFromM ? 'On the verge: the group is in the vehicles\' own fire and blast.' : 'Too far back: the fire spreads and the KZ is not swept.', fix: [`Site it ${A.coverFromM}-${A.fireOffsetMaxM} m from the Rd, in cover`] } });
    else rows.push({ name: 'Fire line', st: 'pass', reason: `drawn ${off2} m from the Rd (${A.coverFromM}-${A.fireOffsetMaxM} m)` });
  }
  rows.push(coverAt ? { name: 'Fire posn', st: 'pass', reason: `the ${L.side === 'L' ? 'L' : 'R'} side: cover ${coverAt.distM} m from the Rd (${mov.classLabel(coverAt.cls)})` }
    : rise >= A.riseM ? { name: 'Fire posn', st: 'pass', reason: `ground ${Math.round(rise)} m above the Rd beside it` }
      : { name: 'Fire posn', st: 'warn', reason: 'no cover or high ground beside the Rd on either side', detail: { head: 'No cover beside the Rd', why: 'The fire group lies in the open beside the KZ: seen as it springs and shot back at.', whyShort: 'no cover beside the Rd', fix: [...betterFix, 'Dig in, or use a ditch, bund or crop the map does not show (recce)', 'Move the KZ to a stretch with trees, a bund or a nullah beside it'] } });
  const [kzFail, kzWarn] = fig(doc, 'smallOps.ambush.kzSeen', [0.5, 0.8]);
  const kzPct = Math.round(kzShare * 100);
  rows.push(pending && unknown > kzPts.length / 2 ? { name: 'KZ in view', st: 'unchecked', reason: 'the ground is still loading' }
    : { name: 'KZ in view', st: kzShare >= kzWarn ? 'pass' : kzShare >= kzFail ? 'warn' : 'fail', reason: `the fire group sees ${kzPct} % of the KZ (${seenN} of ${kzPts.length} points)`,
      detail: kzShare >= kzWarn ? undefined : { head: `${kzPct} % of the KZ in view`, items: [`${seenN} of ${kzPts.length} points along the KZ seen from the fire line (eye ${eye} m, a ${tall} m vehicle)`], why: 'Folds, crops or buildings between the fire line and the Rd (30 m elevation plus what stands on it: a chance, not a fact).', whyShort: 'folds or crops in the way', fix: [`Move the fire line closer to the Rd (${offB[0]}-${offB[1]} m)`, 'Site it on higher ground beside the Rd', 'Shorten the KZ to what the fire group sees'] } });
  const blind = ['Stop 1', 'Stop 2'].filter((_, i) => !stopSees[i]);
  rows.push({ name: 'Stops', st: blind.length ? 'warn' : 'pass', reason: blind.length ? `${blind.join(' and ')} may not see the Rd 200 m beyond its end of the KZ` : `both see the Rd 200 m beyond their ends of the KZ (${A.stopM} m out)`,
    detail: blind.length ? { head: `${blind.join(', ')}: Rd not in view`, why: 'A stop that cannot see the Rd beyond the KZ gives no warning and cannot cut off the vehicles that escape.', fix: ['Move the stop up a rise or to a bend where it sees along the Rd', 'A mine or obstacle on the Rd at its end'] } : undefined });
  const wc = L.withdrawalCoverPct;
  rows.push({ name: 'Withdrawal', st: wc >= 30 ? 'pass' : 'warn', reason: `${wc} % in cover to the RV (wants 30 % or more, E)`,
    detail: wc >= 30 ? undefined : { head: `Withdrawal ${wc} % in cover`, why: 'The groups break contact across open ground to the RV: the survivors and the vehicles behind can shoot them.', fix: ['Withdraw along a nullah, tree line or bund (walk it by day)', 'Smoke, and a covering group firing as the fire group breaks'] } });
  const rvB = fig(doc, 'smallOps.ambush.rvM', [750, 900]);
  rows.push({ name: 'RV', st: L.meetingM >= rvB[0] - 1 && L.meetingM <= rvB[1] + 1 ? 'pass' : 'warn', reason: `${fmtM(L.meetingM)} back from the Rd, ${compass(bearingOf(kzC, L.meeting))} (wants ${rvB[0]}-${rvB[1]} m, R)` });
  // the reserve on the RV side of the Rd (IC s44 para 8 c p 149)
  const roadSide = (p: MercXY) => { const ah = offsetPt(st.x, st.y, st.bearing, 50); return Math.sign((ah[0] - st.x) * (p[1] - st.y) - (ah[1] - st.y) * (p[0] - st.x)); };
  if (!resAt) rows.push({ name: 'Reserve', st: 'warn', reason: 'no reserve drawn (IC s44 para 8 c p 149: a reserve must be detailed)', detail: { head: 'No reserve', why: 'A reserve, able to act on its own initiative, takes on what the parties cannot and covers the move back to the RV (IC s44 paras 8 c, 14 pp 149, 153).', fix: ['Draw a few men as the reserve on the same side of the position as the RV, near the comd'] } });
  else {
    const same = roadSide(resAt) === roadSide(L.meeting);
    rows.push(same ? { name: 'Reserve', st: 'pass', reason: `on the RV side of the Rd, ${fmtM(groundDist(resAt, fm))} back from the fire line (IC s44 para 8 c p 149)` }
      : { name: 'Reserve', st: 'warn', reason: 'across the Rd from the RV', detail: { head: 'Reserve on the far side of the Rd', why: 'The reserve is initially sited on the same side of the ambush position as the RV used on withdrawal (IC s44 para 8 c p 149): across the Rd it cannot cover the move back.', fix: ['Move the reserve to the RV side, within reach of the comd'] } });
  }
  // the covering group: fire on the KZ and on a reacting En after the parties withdraw (IC s44 para 15 b (3) p 156)
  const covWord = shape === 'V' ? 'the third portion covering the withdrawal (IC s44 para 18 c p 158)' : 'covers the withdrawal and a reacting En (IC s44 para 15 b (3) p 156)';
  if (!covAt) rows.push({ name: 'Cov Gp', st: 'warn', reason: `no covering group drawn (${shape === 'V' ? 'IC s44 para 18 c p 158: a third portion covers the withdrawal' : 'IC s44 para 15 b (3) p 156'})`, detail: { head: 'No covering group', why: 'With the parties withdrawing, nothing holds off the En who react: the clean break becomes a running fight (IC s44 para 15 b (3) p 156).', fix: ['Draw a covering group with the MGs back from the fire line, seeing the KZ'] } });
  else {
    let n2 = 0, hit = 0, unk = 0;
    for (const q of kzPts) { n2++; const s = mov.sight(covAt[0], covAt[1], eye, q.x, q.y, tall); if (s === null) unk++; else if (s >= 0.5) hit++; }
    const pct = n2 ? Math.round((100 * hit) / n2) : 0;
    rows.push(unk > n2 / 2 ? { name: 'Cov Gp', st: 'unchecked', reason: 'the ground is still loading' }
      : pct >= 50 ? { name: 'Cov Gp', st: 'pass', reason: `${fmtM(groundDist(covAt, fm))} back from the fire line, sees ${pct} % of the KZ: ${covWord}` }
        : { name: 'Cov Gp', st: 'warn', reason: `sees ${pct} % of the KZ from ${fmtM(groundDist(covAt, fm))} back`, detail: { head: `Cov Gp sees ${pct} % of the KZ`, why: 'The covering group takes on the En in the target area and the En reacting after the parties withdraw (IC s44 para 15 b (3) p 156); it cannot do that without the KZ in view.', fix: ['Move it up a rise or nearer the fire line where it sees the KZ', 'Site the MGs on a flank where they fire along the KZ'] } });
  }
  // by day or by night (IC s44 paras 10 a, 16-17 pp 150, 157)
  rows.push(night ? { name: 'Day / Night', st: 'pass', reason: `by night: fire line ${offB[0]}-${offB[1]} m from the Rd, fire at point blank range (IC s44 para 17 a p 157; band E); the site occupied by night (para 10 a p 150)` }
    : wc >= 30 ? { name: 'Day / Night', st: 'pass', reason: `by day: fire opened at longer ranges, the fire line up to ${offB[1]} m from the Rd (IC s44 para 16 b p 157; band E); occupied in small parties by a covered approach (${wc} % in cover from the RV: para 10 a p 150)` }
      : { name: 'Day / Night', st: 'warn', reason: `by day with no covered approach: ${wc} % in cover from the RV`, detail: { head: 'Occupied by day without a covered approach', why: 'It is better to occupy the site at night; by day only in small parties by a good covered approach, and without one day occupation should be ruled out (IC s44 para 10 a p 150).', fix: ['Occupy by night (Time: Night)', 'Find a covered approach (a nullah, tree line or bund) and go in small parties'] } });
  if (tankKz) rows.push({ name: 'Tank ambush', st: 'pass', reason: `KZ ${fmtM(A.kzM)} so the whole column is in it before it is sprung (IC s46 para 9 p 172; length E); Stop 2 the covering group (AT weapons, AT mines to block the leading tanks), the fire group the killing group (AT weapons, the comd), Stop 1 the cut-off group (AT and small arms) (IC s46 para 9 a p 172)` });
  const reinf = st.reinforcementKm;
  /** His QRF's time to the KZ from a post `km` away (smallOps.ambush.qrfKmh / qrfTurnOutMin; 30 km/h and 5 min: E). */
  const qrfMin = (km: number) => Math.round((km / one(doc, 'smallOps.ambush.qrfKmh', 30)) * 60 + one(doc, 'smallOps.ambush.qrfTurnOutMin', 5));
  rows.push(reinf === null ? { name: 'Reinforcements', st: 'pass', reason: `no post or Police within ${A.reinforcementKm} km` }
    : { name: 'Reinforcements', st: 'warn', reason: `a post or Police ${reinf.toFixed(1)} km away`, detail: { head: `Post / Police ${reinf.toFixed(1)} km away`, why: `The En quick reaction force can be on the KZ in about ${qrfMin(reinf)} min (${one(doc, 'smallOps.ambush.qrfKmh', 30)} km/h and ${one(doc, 'smallOps.ambush.qrfTurnOutMin', 5)} min to turn out: E).`, whyShort: `QRF in ~${qrfMin(reinf)} min`, fix: ['Keep the action short: spring, kill, go', 'A stop on the En road in from the post', ...betterFix] } });
  const villages = st.places.filter((p) => p.distM <= A.villageKm * 1000);
  rows.push(villages.length ? { name: 'Village', st: 'warn', reason: `${villages.map((v) => v.name ?? 'a village').slice(0, 2).join(', ')} within ${A.villageKm} km`, detail: { head: `${villages.map((v) => v.name ?? 'a village').slice(0, 2).join(', ')} within ${A.villageKm} km`, why: 'People round the KZ: warning to the En before it springs, and civilians in the arcs.', fix: ['Fix the arcs clear of the village', 'Move the KZ further from it', ...betterFix] } }
    : { name: 'Village', st: 'pass', reason: `no village within ${A.villageKm} km` });
  const gs = site.groundShape;
  const fitsGround = SHAPE_FITS(shape, gs);
  rows.push(gs === shape ? { name: 'Layout', st: 'pass', reason: `${SHAPE_WORD[shape]}: the ground suits it (${SHAPE_WHY[gs]})` }
    : fitsGround ? { name: 'Layout', st: 'pass', reason: `L on a straight stretch: the L can be laid on a straight stretch of a road or track or at a sharp bend (IC s44 para 18 b p 158)` }
      : { name: 'Layout', st: 'warn', reason: `the ground suits ${A_SHAPE(gs)} here (${SHAPE_WHY[gs]})`, detail: { head: `The ground suits ${A_SHAPE(gs)}`, why: `${SHAPE_WHY[gs][0].toUpperCase()}${SHAPE_WHY[gs].slice(1)}.`, fix: [`Take the ${SHAPE_WORD[gs]} layout (Auto or Compare)`] } });
  const minScore = A.minScore;
  rows.push({ name: 'Site', st: site.score >= minScore ? 'pass' : site.score >= minScore - 15 ? 'warn' : 'fail', reason: `scores ${site.score} (the Movement Guide's rule; ${minScore} or more makes a likely site)`,
    detail: { head: `Site ${site.score} / 100`, items: site.parts.map((p) => `${p.ok ? '+' : '-'} ${p.what} (${p.pts})`), why: site.score >= minScore ? undefined : 'The things that make an ambush work are missing here (the minus lines).', fix: site.score >= minScore ? undefined : [...betterFix, 'Walk the Rd for a defile or a bend with cover beside it'] } });
  if (better[0]) rows.push({ name: 'Better site', st: 'warn', reason: `${upWord(better[0].alongM)}: scores ${better[0].score} (here ${site.score})`, detail: { head: `Better site ${upWord(better[0].alongM)}`, why: 'A stretch of the same Rd meets more of the rule.', fix: ['J while placing moves the KZ to the blue ring and fits it there (Shift+J back)', 'Or right-click, then click the KZ at the ring'] } });
  else rows.push({ name: 'Better site', st: 'pass', reason: `none better on the ${fmtM(r.lengthM)} of Rd read` });
  if (area) {
    const minScore = one(doc, 'smallOps.ambush.outlyingMinScore', 40), seenWarn = one(doc, 'smallOps.ambush.outlyingSeenPct', 60);
    const want = dr ? outlying.length : 2;
    const items = outlying.map((o) => `${o.label}: ${upWord(o.site.chainM - site.chainM)}, site ${o.site.score} / 100, sees ${o.seenPct} % of its stretch${o.found ? '' : ' (no likely site in its band: laid at the middle of it)'}`);
    const weak = outlying.filter((o) => o.site.score < minScore || o.seenPct < seenWarn || !o.found);
    const missing = !dr ? (['up', 'down'] as const).filter((w) => !outlying.some((o) => o.up === (w === 'up'))) : [];
    rows.push(missing.length ? { name: 'Outlying', st: 'warn', reason: `no Rd read ${missing.map((w) => (w === 'up' ? 'up toward the En' : 'down beyond the KZ')).join(' or ')} for an outlying ambush`, detail: { head: 'An outlying ambush not sited', items, why: 'The area ambush closes each way in and out of the central site (IC s44 para 11 b p 152); the Rd read stops short.', fix: ['Lay it by hand on that way in or out', 'Click the central KZ nearer the middle of the stretch'] } }
      : !want ? { name: 'Outlying', st: 'unchecked', reason: 'no outlying ambush drawn' }
        : { name: 'Outlying', st: weak.length ? 'warn' : 'pass', reason: items.join('; '),
          detail: weak.length ? { head: `${weak.map((o) => o.label).join(', ')}: a weak site`, items, why: 'Each outlying ambush is a point ambush of its own (IC s44 para 11 b p 152): it wants the same defile or bend, cover and the stretch in view.', fix: ['Move it along its band to a better stretch (walk the Rd)', 'Mines or an obstacle to hold the En at it', 'Side tracks into the area: an outlying ambush on each (recce)'] } : undefined });
  }

  const confirm = [
    `The KZ (${SHAPE_WORD[shape]}): walk it; ${mw} cannot leave it; the fire group sees all of it from cover`,
    'Stops: each sees the Rd beyond its end; the signal to spring and to withdraw',
    `The withdrawal to the RV (${fmtM(L.meetingM)} back): covered, walked by day`,
    'The reserve on the RV side, in comms with the comd; the Cov Gp\'s fire for the withdrawal (a time bracket agreed) (IC s44 para 15 b (3)-(4) p 156)',
    night ? 'By night: fire for a set period, then the task finished with bayonets or knives; no noise or light (IC s44 para 17 b-c p 157)'
      : 'By day: men well dispersed and hidden from the air, perfect stillness; supporting fire directed by observation (IC s44 para 16 p 157)',
    'If the ambush lasts 24 hours or more: an admin area, defendable, out of earshot of the main posn, with lanes in for a silent approach and water near; often at the RV (IC s44 para 8 e pp 149-150)',
    ...(shape === 'V' ? ['V: arcs fixed so the two halves never fire into each other; the Cov Gp (the third portion) covers the assault groups\' withdrawal (IC s44 para 18 c p 158)'] : []),
    ...(tankKz ? ['Tank ambush: the site out of view of the En observers, on the route the tanks are known to take; AT mines with the covering group to stop the leading tanks (IC s46 para 9 pp 172-173)'] : []),
    ...(area ? ['Area ambush: every way into and out of the central site found on the ground (tracks the map misses), one outlying ambush on each; the Pl Comd at the central KZ until it is sprung (IC s44 para 11 b p 152)'] : []),
    ...(villages.length ? ['The village: no civilians in the arcs'] : []),
  ];
  const score = Math.max(0, Math.min(100, site.score - (fitsGround ? 0 : one(doc, 'smallOps.ambush.shapePenalty', 10)) - (rd ? 0 : 40) - (kzShare < kzFail ? 15 : 0)));
  return {
    geom, extra: [], rows, confirm, score, pending,
    small: { task: 'ambush', road: path, site: { score: site.score, shape, groundShape: gs, exits: site.exits, parts: site.parts }, better, kzPts,
      ...(area ? { outlying: outlying.map((o) => { const fl = o.site.layout.fireLine; return { x: (fl[0][0] + fl[1][0]) / 2, y: (fl[0][1] + fl[1][1]) / 2, label: o.label, alongM: Math.round(o.site.chainM - site.chainM), score: o.site.score, seenPct: o.seenPct }; }) } : {}) },
  };
}

// ── patrol ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The share of one path's points lying within `m` of another path. */
function sharedShare(a: MercXY[], b: MercXY[], m: number): number {
  if (a.length < 2 || b.length < 2) return 0;
  const flat = b.flat();
  const L = pathLen(a);
  let n = 0, hit = 0;
  for (let d = 0; d <= L; d += 50) { n++; if (distToLine(along(a, d), flat) <= m) hit++; }
  return n ? hit / n : 0;
}
const stretchLen = (list: { fromM: number; toM: number }[]) => list.reduce((s, x) => s + Math.max(0, x.toM - x.fromM), 0);

/**
 * A route's interior leg ends pulled onto the nearest feature recognisable at night (PlatoonDoctrine patrol.legFeatureKinds:
 * a bridge, tomb, mosque, junction, hill ...) within `legFeatureM`, when both legs to it stay off NO-GO on foot (legs end on
 * features recognisable at night: OCOKA_Roadmap ch 6, R). The start and the Obj stay where they are.
 */
export function snapLegEnds(p: MercXY[], mov: { features: SmallProbe['features']; cls: SmallProbe['cls'] }, plR: Rules, foot: GoingSets): MercXY[] {
  const P = plR.patrol ?? {};
  const kinds = new Set<string>(P.legFeatureKinds ?? []), within = P.legFeatureM ?? 150;
  if (!kinds.size || p.length < 3) return p;
  const out = p.slice();
  const clear = (a: MercXY, b: MercXY) => { const L = groundDist(a, b); for (let d = 0; d <= L; d += 30) { const q = along([a, b], d), k = mov.cls(q[0], q[1]); if (k !== null && foot.nogo.has(k)) return false; } return true; };
  const used = new Set<string>();
  for (let i = 1; i + 1 < out.length; i++) {
    const near = mov.features(out[i][0], out[i][1], within, kinds).filter((f) => !used.has(`${Math.round(f.x)}|${Math.round(f.y)}`)).sort((a, b) => a.distM - b.distM);
    for (const f of near) {
      const q: MercXY = [f.x, f.y];
      if (clear(out[i - 1], q) && clear(q, out[i + 1])) { out[i] = q; used.add(`${Math.round(f.x)}|${Math.round(f.y)}`); break; }
    }
  }
  return out;
}

function readPatrol(c: Ctx): SmallRead {
  const { doc, frame, mov, R, inp, base } = c;
  const dr = c.drawn ?? null;
  const start: MercXY = dr?.sp?.pts[0] ?? [frame.anchor.x, frame.anchor.y];
  const objIt = base.items.find((i) => i.role === 'obj');
  const objC = dr?.obj?.pts.length ? ctrW(dr.obj.pts) : objIt ? toW(frame, ctr(objIt.pts)) : toW(frame, { x: 0, y: one(doc, 'smallOps.patrol.defaultObjM', 3000) });
  const threat: MercXY = inp.threat ? [inp.threat.x, inp.threat.y] : objC;
  const foot = mov.going('dismounted');
  const night = !!inp.night;
  const Rp = { ...R, patrol: { ...R.patrol, maxCells: one(doc, 'smallOps.patrol.maxCells', 260) } };
  // drawn (Check my plan): the routes as drawn; built: the Movement Guide's least-cost ways
  const routes = dr ? { out: dr.out?.pts && dr.out.pts.length >= 2 ? dr.out.pts : null, back: dr.in?.pts && dr.in.pts.length >= 2 ? dr.in.pts : null, pending: false }
    : planPatrol(mov, Rp, start, objC, { foot, avoidRoads: true, avoidVillages: true, avoidWoodEdges: night, avoidSkylines: true, threat, separateM: R.patrol.separateM });
  const scanner = new RouteScanner(R);
  const speeds: PlFootSpeeds = inp.speeds ?? { ground: { open: [4, 3] }, road: [4, 3], toblerA: 3.5, toblerB: 0.05 };
  const pc = (p: MercXY[]) => patrolCard(mov, inp.plRules ?? plRulesFrom(null), p, { foot, speeds, threat, classLabel: (k) => mov.classLabel(k), scanRoad: (path, sight, th) => scanner.scan(path, mov, { going: foot, sight, threat: th ?? null }) });
  // the routes as legs a patrol can walk by night: the grid's cell steps straightened (60 m off at most, 11 legs)
  // built: the leg ends pulled onto a feature recognisable at night within legFeatureM where the legs stay off NO-GO
  const onFeatures = (p: MercXY[]) => snapLegEnds(p, mov, inp.plRules ?? plRulesFrom(null), foot);
  const outP = routes.out ? (dr ? routes.out : onFeatures(simplifyPath(routes.out, 60, 12))) : null, backP = routes.back ? (dr ? routes.back : onFeatures(simplifyPath(routes.back, 60, 12))) : null;
  const out: PatrolCard | null = outP ? pc(outP) : null;
  const back: PatrolCard | null = backP ? pc(backP) : null;
  const pending = routes.pending || !!out?.pending || !!back?.pending;

  const geom: Record<string, { pts: XY[] }> = {};
  const extra: SmallRead['extra'] = [];
  if (outP) geom.out = { pts: outP.map((w) => toL(frame, w)) };
  if (backP) geom.in = { pts: backP.map((w) => toL(frame, w)) };
  if (out?.fmp) geom.frv = { pts: [toL(frame, [out.fmp.x, out.fmp.y])] };
  (out?.bounds ?? []).forEach((b, i) => extra.push({ role: 'bound', key: '25130300', label: String(i + 1), at: toL(frame, [b.x, b.y]) }));

  const rows: Check[] = [];
  const confirm: string[] = [];
  if (!routes.out || !out) {
    if (dr) rows.push({ name: 'Route out', st: 'unchecked', reason: 'no route out drawn (an arrow from the SP to the Obj)' });
    else rows.push({ name: 'Route out', st: 'fail', reason: 'no way on foot from the SP to the Obj round NO-GO', detail: { head: 'No route on foot', why: 'NO-GO on foot (water, marsh, cliffs) closes every way between the SP and the Obj on the bundle\'s ground.', whyShort: 'NO-GO all round', fix: ['Move the SP, or aim at the Obj from another side', 'Cross at a bridge or ford: recce it, and lay the route by hand'] } });
  } else {
    const straight = groundDist(start, objC), ratio = out.lengthM / Math.max(1, straight);
    const rOut = `${fmtM(out.lengthM)} in ${out.legs.length} legs (${ratio.toFixed(1)} times the ${fmtM(straight)} straight): ${fmtMin(out.minDay)} by day, ${fmtMin(out.minNight)} by night`;
    rows.push(ratio <= 2 ? { name: 'Route out', st: 'pass', reason: rOut }
      : { name: 'Route out', st: 'warn', reason: rOut, detail: { head: `${ratio.toFixed(1)} times the straight line`, items: [`${fmtM(out.lengthM)} on foot against ${fmtM(straight)} straight`], why: 'The way goes round what a patrol avoids: villages, roads and tracks, skylines, NO-GO and ground the Obj may see.', whyShort: 'round villages, roads, what the En sees', fix: ['Accept a Rd or village crossing by night, in one bound (move the SP)', 'Aim at the Obj from another side', 'A nearer SP, or a lying-up place on the way'] } });
    const featured = out.legs.filter((l) => l.endFeature).length;
    const boundB = fig(doc, 'smallOps.patrol.boundM', [550, 750]);
    // the route's own spacing (IC s40 para 23 p 116: bounds 550-750 m apart): the legs, and the check points the card lays
    // along the way out (from the SP, between them, and on to the Obj)
    const legM = out.legs.map((l) => l.distM);
    const cps = [0, ...out.bounds.map((b) => b.chainM), out.lengthM];
    const gaps = cps.slice(1).map((m, i) => m - cps[i]).filter((g) => g > 1);
    const span = (xs: number[]) => (xs.length ? (Math.round(Math.min(...xs)) === Math.round(Math.max(...xs)) ? fmtM(Math.min(...xs)) : `${fmtM(Math.min(...xs))}-${fmtM(Math.max(...xs))}`) : '-');
    const wide = gaps.filter((g) => g > boundB[1] + 50).length;
    const legsOk = out.legs.length <= 1 || featured * 2 >= out.legs.length;
    rows.push({ name: 'Bounds', st: legsOk && !wide ? 'pass' : 'warn',
      reason: `${out.bounds.length} check points ${span(gaps)} apart, legs of ${span(legM)} (IC s40 para 23 p 116: ${boundB[0]}-${boundB[1]} m between bounds); ${featured} of ${out.legs.length} legs end on a feature recognisable at night`,
      detail: legsOk && !wide ? undefined : { head: !legsOk ? `${featured} of ${out.legs.length} legs end on a feature` : `${wide} stretch${wide > 1 ? 'es' : ''} longer than ${boundB[1]} m between bounds`, why: !legsOk ? 'Legs that end in open ground are hard to find at night: the patrol counts paces and drifts. Bounds are features easily recognisable at night (IC s40 para 23 p 116).' : `Bounds should be ${boundB[0]}-${boundB[1]} m apart (IC s40 para 23 p 116): a longer stretch is walked on the compass alone.`, fix: ['Bend the route to end legs on a bridge, tomb, mosque, junction or hill (the card lists those near)', 'Mark the check points on the air photo before the patrol'] } });
  }
  if (out && routes.back && back) {
    const same = sharedShare(backP!, outP!, Math.max(60, R.patrol.separateM / 2));
    rows.push(same > 0.5 ? { name: 'Route in', st: 'warn', reason: `${Math.round(same * 100)} % of the way back runs along the way out`, detail: { head: 'Back the way it went', why: 'The ground leaves no other way; the En can lay an ambush on the route the patrol used.', fix: ['Aim at the Obj from a little to one side: another way may open', 'Come back by day, or by another SP'] } }
      : { name: 'Route in', st: 'pass', reason: `a different way back: ${fmtM(back.lengthM)}, ${fmtMin(back.minNight)} by night (${Math.round(same * 100)} % along the way out)` });
  } else if (out) rows.push({ name: 'Route in', st: 'warn', reason: 'no second way back found: back the way it went' });
  if (out) {
    const frvB = fig(doc, 'smallOps.patrol.frvM', [400, 500]);
    // the FRV: as drawn (Check my plan) or 450 m short along the route
    const frvAt: MercXY | null = dr ? dr.frv?.pts[0] ?? null : out.fmp ? [out.fmp.x, out.fmp.y] : null;
    // as drawn: along the drawn route out from the FRV to its end (as the build measures it), else straight to the Obj
    const alongOut = (at: MercXY): number | null => {
      if (!outP || outP.length < 2) return null;
      let bi = 0, bd = Infinity;
      outP.forEach((q, i) => { const d = groundDist(q, at); if (d < bd) { bd = d; bi = i; } });
      if (bd > 200) return null;
      let m = 0;
      for (let i = bi + 1; i < outP.length; i++) m += groundDist(outP[i - 1], outP[i]);
      return m;
    };
    const frvM = frvAt ? (dr ? alongOut(frvAt) ?? groundDist(frvAt, objC) : out.lengthM - out.fmp!.chainM) : 0;
    const frvIn = frvM >= frvB[0] - 1 && frvM <= frvB[1] + 1;
    if (!frvAt) rows.push({ name: 'FRV', st: 'warn', reason: dr ? 'no FRV drawn short of the Obj' : `the route is too short for an FRV ${frvB[0]}-${frvB[1]} m short of the Obj` });
    else {
      const s = mov.sight(objC[0], objC[1], R.patrol.threatEyeM, frvAt[0], frvAt[1], 1.7);
      rows.push(s === null ? { name: 'FRV', st: 'unchecked', reason: `${fmtM(frvM)} short of the Obj (IC s41 para 9 p 132: ${frvB[0]}-${frvB[1]} m); its view from the Obj not read (ground loading)` }
        : s < 0.5 ? { name: 'FRV', st: frvIn ? 'pass' : 'warn', reason: `${fmtM(frvM)} short of the Obj (IC s41 para 9 p 132: ${frvB[0]}-${frvB[1]} m), hidden from it` }
          : { name: 'FRV', st: 'warn', reason: `${fmtM(frvM)} short of the Obj, but the Obj may see it`, detail: { head: 'FRV seen from the Obj', why: 'The patrol waits and regroups at the FRV: seen from the Obj, it is found before the task starts.', fix: ['Move the FRV into dead ground short of the Obj (the green stretches)', 'Approach the Obj from another side'] } });
    }
    const len = Math.max(1, out.lengthM), seenM = stretchLen(out.exposed), seenPct = Math.round((100 * seenM) / len);
    const [sw, sf] = fig(doc, 'smallOps.patrol.seenPct', [20, 50]);
    const tName = inp.threat ? 'the threat' : 'the Obj';
    rows.push({ name: 'Seen', st: seenPct >= sf ? 'fail' : seenPct >= sw ? 'warn' : 'pass', reason: `${seenPct} % of the way out ${tName} or high Gr may see (${fmtM(seenM)}); ${Math.round((100 * stretchLen(out.dead)) / len)} % hidden from ${tName}`,
      detail: seenPct < sw ? undefined : { head: `${seenPct} % of the way out in view`, items: out.exposed.slice(0, 4).map((x) => `km ${(x.fromM / 1000).toFixed(1)}-${(x.toM / 1000).toFixed(1)}: ${x.why}`), why: `Open ground facing ${tName}: nothing on the way to hide the patrol${night ? '' : ' (by day)'}.`, whyShort: `open ground facing ${tName}`, fix: ['Cross the open stretches by night, in bounds, one group covering', 'Aim from another side to find dead ground (the green stretches)', 'Mark the threat place: the route then avoids its view'] } });
    const vs = [...out.villages, ...(back?.villages ?? [])];
    rows.push(vs.length ? { name: 'Villages', st: 'warn', reason: `passes ${[...new Set(vs.map((v) => v.name ?? 'a village'))].slice(0, 3).join(', ')}`, detail: { head: 'Villages on the way', why: 'Dogs and people give the patrol away; the route could not go round.', fix: ['Pass downwind, wide, at the dead hours', 'Move the SP or the Obj aim to open a way round'] } }
      : { name: 'Villages', st: 'pass', reason: 'no village on the way out or in' });
    rows.push(out.skyline.length ? { name: 'Skylines', st: 'warn', reason: `${out.skyline.length} crest${out.skyline.length > 1 ? 's' : ''} crossed on the way out: the patrol shows on the skyline`, detail: { head: 'Crests crossed', items: out.skyline.slice(0, 3).map((x) => `km ${(x.fromM / 1000).toFixed(1)}`), fix: ['Cross below the crest (the military crest), one at a time'] } }
      : { name: 'Skylines', st: 'pass', reason: 'no crest crossed on the way out' });
    const dg = out.dangers.slice(0, 4);
    rows.push(dg.length ? { name: 'Dangers', st: 'warn', reason: `${out.dangers.length} on the way out: ${dg.map((d) => `${d.label} km ${(d.chainM / 1000).toFixed(1)}`).join(', ')}`, detail: { head: `${out.dangers.length} dangers on the way out`, items: dg.map((d) => `km ${(d.chainM / 1000).toFixed(1)}: ${d.label} (${d.why})`), fix: ['Cross Rds, tracks and VPs at a bound, one group covering', 'Recce each on the air photo'] } }
      : { name: 'Dangers', st: 'pass', reason: 'no Rd, VP or likely ambush on the way out' });
    if (out.obstacles.length) rows.push({ name: 'Obstacles', st: 'warn', reason: `${out.obstacles.length} to cross: ${out.obstacles.slice(0, 3).map((o) => `${o.label} km ${(o.chainM / 1000).toFixed(1)}`).join(', ')}`, detail: { head: 'Obstacles to cross', fix: ['Recce each crossing (depth, banks, current)', 'A crossing drill and a rope'] } });
    // at the Obj: an hour or more, then the Obj again from another direction (IC s41 paras 10-11 pp 132-133): counted twice
    const taskOne = one(doc, 'smallOps.patrol.taskMin', 60), rounds = one(doc, 'smallOps.patrol.taskRounds', 2), nightH = one(doc, 'smallOps.patrol.nightH', 10);
    const task = taskOne * rounds;
    const total = out.minNight + (back?.minNight ?? out.minNight) + task;
    rows.push({ name: 'Time', st: total <= nightH * 60 ? 'pass' : 'warn', reason: `by night: out ${fmtMin(out.minNight)}, ${fmtMin(task)} at the Obj, back ${fmtMin(back?.minNight ?? out.minNight)}: ${fmtMin(total)} of a ${nightH} h night (E); at the Obj ${fmtMin(taskOne)} or more${rounds > 1 ? ', then again from another direction' : ''} (IC s41 para 10 p 132)`,
      detail: total <= nightH * 60 ? undefined : { head: `${fmtMin(total)}: longer than the night`, why: 'The patrol is caught in the open at first light.', fix: ['A nearer SP or a lying-up place on the way', 'Out one night, back the next'] } });
    for (const x of out.checks.slice(0, 3)) confirm.push(x);
  }
  confirm.push(
    'The FRV: hidden from the Obj; the check points on the air photo',
    'Paces counted (120 = 100 m), each leg measured from the map to the nearest 50 paces, bearings set for each leg (IC s40 para 23 p 116)',
    'At each bound the RV 100-200 m off it (the En may use the same bound); the compass reset there for the next leg (IC s40 para 23 p 116)',
    night ? 'By night: off corners and edges of woods, villages, tracks, hedges and deep defiles; open ground rather than cover; below the crest on slopes (IC s40 para 24 p 116; hedges and defiles are not on the map: walk it)'
      : 'By day: concealment first, every bit of cover used (IC s40 para 25 p 116)',
    'Planning time: four daylight hours at least for even a simple recce patrol, longer for more (IC s40 para 12 p 111)',
  );
  // the Night March chart on the way out (NightMarchRead): the same legs the Night March tool would give the patrol
  let nightChart: SmallReading['night'] | undefined;
  if (inp.nmRules && outP && outP.length >= 2 && !dr) {
    try {
      const kind = inp.terrain && inp.terrain !== 'auto' ? inp.terrain : 'plains';
      const ch = nightMarchChart({ path: outP, objective: outP[outP.length - 1], echelon: 'platoon', gmaDeg: inp.gmaDeg ?? null, hHourMin: null, terrainKind: kind === 'obstacle' ? 'plains' : kind, probe: mov as unknown as PlProbe, patrolRules: inp.plRules ?? plRulesFrom(null), foot, speeds, classLabel: (k) => mov.classLabel(k) }, inp.nmRules);
      nightChart = { legs: ch.legs.map((l) => ({ i: l.i, bearingDeg: deg360(l.bearingDeg), gridDeg: deg360(l.gridDeg), distM: Math.round(l.distM), paces: l.paces, min: l.minNight, sight: l.sight })), grid: ch.grid.name, lengthM: Math.round(ch.lengthM), paces: ch.paces, marchMin: ch.timing.marchMin, moveMin: ch.timing.moveMin, thermalAtM: ch.sights?.thermal.enterAtM ?? null, nightAtM: ch.sights?.night.enterAtM ?? null, checks: ch.checks.filter((c) => c.tone !== 'ok').slice(0, 4).map((c) => c.text) };
    } catch { nightChart = undefined; }
  }
  const marks: SmallReading['marks'] = [];
  for (const d of out?.dangers ?? []) marks.push({ x: d.x, y: d.y, label: d.label });
  for (const o of out?.obstacles ?? []) marks.push({ x: o.x, y: o.y, label: o.label });
  const segs = (list: { fromM: number; toM: number }[]) => (outP ? list.map((x) => cut(outP, x.fromM, x.toM)) : []);
  const fails = rows.filter((x) => x.st === 'fail').length, warns = rows.filter((x) => x.st === 'warn').length;
  return {
    geom, extra, rows, confirm, pending, score: Math.max(0, 100 - 25 * fails - 6 * warns),
    small: {
      task: 'patrol', out: outP, back: backP, exposed: out ? segs(out.exposed) : [], dead: out ? segs(out.dead) : [], marks,
      legs: ([['Out', out], ['In', back]] as const).flatMap(([way, cd]) => (cd?.legs ?? []).map((l) => ({ way, i: l.i, bearingDeg: deg360(l.bearingDeg), gridDeg: deg360(l.gridDeg), magDeg: inp.gmaDeg === null || inp.gmaDeg === undefined || !Number.isFinite(inp.gmaDeg) ? null : Math.round(((l.gridDeg - inp.gmaDeg) % 360 + 360) % 360) % 360, mils: Math.round((deg360(l.gridDeg) * 6400) / 360) % 6400, distM: Math.round(l.distM), paces: l.paces, minDay: Math.round(l.minDay), minNight: Math.round(l.minNight), feature: l.endFeature ? (l.endFeature.name ? `${l.endFeature.label} ${l.endFeature.name}` : l.endFeature.label) : null }))),
      grid: out?.grid ?? back?.grid,
      night: nightChart,
    },
  };
}

// ── recce ────────────────────────────────────────────────────────────────────────────────────────────────────────────

function readRecce(c: Ctx): SmallRead {
  const { recipe, doc, frame, mov, R, base } = c;
  const dr = c.drawn ?? null;
  const sp: MercXY = dr?.sp?.pts[0] ?? [frame.anchor.x, frame.anchor.y];
  const naiIt = base.items.find((i) => i.role === 'nai');
  if (!naiIt && !dr?.nai) return { geom: {}, extra: [], rows: [], confirm: [], score: 0, small: { task: 'recce' }, pending: false };
  const samples: MercXY[] = [];
  let naiC: MercXY;
  if (dr?.nai && dr.nai.pts.length >= 3) {
    // the NAI as drawn: a grid over its outline, the points inside it
    const ring = dr.nai.pts;
    naiC = ctrW(ring);
    const xs2 = ring.map((q) => q[0]), ys2 = ring.map((q) => q[1]);
    for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) {
      const q: MercXY = [Math.min(...xs2) + ((i + 0.5) / 6) * (Math.max(...xs2) - Math.min(...xs2)), Math.min(...ys2) + ((j + 0.5) / 6) * (Math.max(...ys2) - Math.min(...ys2))];
      if (pointInRing(q, ring)) samples.push(q);
    }
    if (!samples.length) samples.push(naiC);
  } else {
    naiC = toW(frame, ctr(naiIt!.pts));
    const e = { x0: Math.min(...naiIt!.pts.map((p) => p.x)), x1: Math.max(...naiIt!.pts.map((p) => p.x)), y0: Math.min(...naiIt!.pts.map((p) => p.y)), y1: Math.max(...naiIt!.pts.map((p) => p.y)) };
    // the NAI sampled: 5 across x 4 deep
    for (let j = 0; j < 4; j++) for (let i = 0; i < 5; i++) samples.push(toW(frame, { x: e.x0 + ((i + 0.5) / 5) * (e.x1 - e.x0), y: e.y0 + ((j + 0.5) / 4) * (e.y1 - e.y0) }));
  }
  const naiElev = samples.map((s) => mov.elev(s[0], s[1])).filter((v) => v === v);
  const naiMean = naiElev.length ? naiElev.reduce((a, v) => a + v, 0) / naiElev.length : NaN;
  const band = fig(doc, 'smallOps.recce.opBandM', [600, 2500]), bestB = fig(doc, 'smallOps.recce.opBestM', [1000, 2000]);
  const spread = one(doc, 'smallOps.recce.opSpreadDeg', 60), stepM = one(doc, 'smallOps.recce.opStepM', 150), stepDeg = one(doc, 'smallOps.recce.opStepDeg', 10);
  const eye = one(doc, 'smallOps.recce.opEyeM', 1), tall = one(doc, 'smallOps.recce.targetM', 2.4), apartM = one(doc, 'smallOps.recce.opsApartM', 300);
  const foot = mov.going('dismounted');
  const coverCls = new Set<number>(R.ambush.coverClasses);
  const backDeg = bearingOf(naiC, sp);
  const toSp = groundDist(naiC, sp);
  type Cand = { p: MercXY; seen: boolean[]; pct: number; rise: number; cover: boolean; score: number; name: string | null };
  const cands: Cand[] = [];
  let unknown = 0, reads = 0, noCls = 0;
  mov.takePending?.();
  const consider = (p: MercXY, name: string | null, asDrawn = false) => {
    const k = mov.cls(p[0], p[1]);
    if (!asDrawn && k === null) { noCls++; return; }
    if (!asDrawn && k !== null && foot.nogo.has(k)) return;
    const d = groundDist(naiC, p);
    if (!asDrawn && (d < band[0] || d > band[1] || d > toSp + 300)) return;
    const seen = samples.map((s) => { const v = mov.sight(p[0], p[1], eye, s[0], s[1], tall); reads++; if (v === null) unknown++; return (v ?? 0) >= 0.5; });
    const pct = seen.filter(Boolean).length / samples.length;
    const el = mov.elev(p[0], p[1]);
    const rise = el === el && naiMean === naiMean ? el - naiMean : 0;
    const cover = k !== null && coverCls.has(k);
    const score = 60 * pct + Math.max(0, Math.min(15, rise / 2)) + (cover ? 10 : 0) + (d >= bestB[0] && d <= bestB[1] ? 15 : 5);
    cands.push({ p, seen, pct, rise, cover, score, name });
  };
  const drawnOps = dr ? Object.keys(dr).filter((r2) => /^op\d$/.test(r2)).sort().map((r2) => dr[r2].pts[0]) : [];
  if (dr) for (const p of drawnOps) consider(p, null, true);
  else {
    for (let d = band[0]; d <= band[1]; d += stepM) for (let a = -spread; a <= spread + 0.1; a += stepDeg) consider(offsetPt(naiC[0], naiC[1], backDeg + a, d), null);
    const kinds = new Set<string>((doctrineAt(doc, 'smallOps.recce.opKinds') as string[] | undefined) ?? ['peak', 'hill', 'knoll', 'trig_station', 'watch_tower']);
    for (const f of mov.features(naiC[0], naiC[1], band[1], kinds)) {
      const off = Math.abs(((bearingOf(naiC, [f.x, f.y]) - backDeg + 540) % 360) - 180);
      if (off <= spread + 10) consider([f.x, f.y], f.name ?? f.label);
    }
  }
  // greedy: the best, then each next for what it adds to the view, at least `apartM` from the others (drawn: all of them)
  const n = dr ? cands.length : recipe.slots.filter((s) => /^op\d$/.test(s.role)).length || 2;
  const chosen: Cand[] = [];
  const union = new Array(samples.length).fill(false);
  if (dr) for (const cd of cands) { chosen.push(cd); cd.seen.forEach((s2, k) => { if (s2) union[k] = true; }); }
  for (let i = 0; i < n && !dr; i++) {
    let pick: Cand | null = null, ps = -Infinity;
    for (const cd of cands) {
      if (chosen.includes(cd) || chosen.some((o) => groundDist(o.p, cd.p) < apartM)) continue;
      const adds = cd.seen.filter((s, k) => s && !union[k]).length / samples.length;
      const sc = chosen.length ? 70 * adds + 0.3 * cd.score : cd.score;
      if (sc > ps) { ps = sc; pick = cd; }
    }
    if (!pick) break;
    chosen.push(pick);
    pick.seen.forEach((s, k) => { if (s) union[k] = true; });
  }
  // routes to the OPs in dead ground: planPatrol with the NAI as the threat, on a smaller grid
  const Rr = { ...R, patrol: { ...R.patrol, maxCells: Math.min(160, one(doc, 'smallOps.patrol.maxCells', 260)) } };
  // drawn: each OP's route as drawn, the share the NAI may see read along it; built: the least-cost way in dead ground
  const seenAlong = (pts: MercXY[]) => { const L = pathLen(pts); let n2 = 0, hit = 0; for (let d = 0; d <= L; d += 50) { const q = along(pts, d); n2++; if ((mov.sight(naiC[0], naiC[1], R.patrol.threatEyeM, q[0], q[1], 1.7) ?? 0) >= 0.5) hit++; } return n2 ? Math.round((100 * hit) / n2) : 0; };
  const routes = dr
    ? chosen.map((_, i) => { const rt = dr[`rt${i + 1}`]?.pts; return rt && rt.length >= 2 ? { out: rt, back: null, cellM: 0, met: { roads: 0, villages: 0, woodEdges: 0, skylines: 0, seen: seenAlong(rt) }, pending: false } : { out: null, back: null, cellM: 0, met: { roads: 0, villages: 0, woodEdges: 0, skylines: 0, seen: 0 }, pending: false }; })
    : chosen.map((o) => planPatrol(mov, Rr, sp, o.p, { foot, avoidRoads: true, avoidVillages: true, avoidWoodEdges: false, avoidSkylines: true, threat: naiC, separateM: 0 }));
  const speeds: PlFootSpeeds = c.inp.speeds ?? { ground: { open: [4, 3] }, road: [4, 3], toblerA: 3.5, toblerB: 0.05 };
  const cards = routes.map((rt) => (rt.out ? patrolCard(mov, c.inp.plRules ?? plRulesFrom(null), rt.out, { foot, speeds, threat: naiC, classLabel: (k) => mov.classLabel(k) }) : null));
  const pending = unknown > reads / 3 || routes.some((r) => r.pending) || !!mov.takePending?.();

  const geom: Record<string, { pts: XY[] }> = {};
  chosen.forEach((o, i) => {
    geom[`op${i + 1}`] = { pts: [toL(frame, o.p)] };
    const rt = routes[i].out;
    if (rt && recipe.slots.some((s) => s.role === `rt${i + 1}`)) geom[`rt${i + 1}`] = { pts: simplifyPath(rt, 25, 16).map((w) => toL(frame, w)) };
  });
  const rows: Check[] = [];
  const [sFail, sWarn] = fig(doc, 'smallOps.recce.seenPct', [40, 70]);
  const uPct = Math.round((100 * union.filter(Boolean).length) / samples.length);
  const opWord = (o: Cand, i: number) => `OP ${i + 1}: ${fmtM(groundDist(naiC, o.p))} ${compass(bearingOf(naiC, o.p))} of the NAI${o.name ? ` (${o.name})` : ''}, sees ${Math.round(o.pct * 100)} %, ${Math.abs(o.rise) < 1 ? 'level with' : o.rise > 0 ? `${Math.round(o.rise)} m above` : `${Math.round(-o.rise)} m below`} it${o.cover ? ', in cover' : ', in the open'}`;
  const opsLoading = !dr && chosen.length < n && noCls > 0 && (pending || !!mov.takePending?.());
  if (!dr && chosen.length < n) rows.push(opsLoading ? { name: 'OPs sited', st: 'unchecked', reason: `${chosen.length} of ${n} OPs sited so far: the ground is still loading` } : { name: 'OPs sited', st: 'fail', reason: `${chosen.length} of ${n} OPs found on the own side ${fmtM(band[0])}-${fmtM(band[1])} from the NAI`, detail: { head: `${chosen.length} of ${n} OPs sited`, why: 'NO-GO or the SP too near the NAI leaves no ground for them in the band.', fix: ['Aim at the NAI from further back', 'Take the two-OP layout'] } });
  rows.push(pending && unknown > reads / 2 ? { name: 'NAI seen', st: 'unchecked', reason: 'the ground is still loading' }
    : { name: 'NAI seen', st: uPct >= sWarn ? 'pass' : uPct >= sFail ? 'warn' : 'fail', reason: `the OPs see ${uPct} % of the NAI between them (wants ${sWarn} %, E)`,
      detail: { head: `${uPct} % of the NAI in view`, items: chosen.map(opWord), why: uPct >= sWarn ? undefined : 'Folds, trees or buildings between the own side and the NAI hide parts of it (30 m elevation plus what stands on it: a chance).', whyShort: uPct >= sWarn ? undefined : 'folds, trees or buildings in the way', fix: uPct >= sWarn ? undefined : [...(n < 3 ? ['Take three OPs: one more direction'] : []), 'An OP on a rooftop, tower or tree: a higher eye sees over crops and walls', 'A standing patrol or LP in the dead ground (the red dots)', 'UAV or air over the parts not seen'] } });
  const blind = chosen.map((o, i) => ({ o, i })).filter(({ o }) => o.pct < 0.1);
  if (blind.length && !(pending && unknown > reads / 2)) rows.push({ name: 'OP view', st: 'warn', reason: `${blind.map(({ i }) => `OP ${i + 1}`).join(', ')} ${blind.length > 1 ? 'see' : 'sees'} almost none of the NAI`,
    detail: { head: `${blind.map(({ i }) => `OP ${i + 1}`).join(', ')}: NAI not in view`, why: 'No ground on the own side in the band sees past what stands between: the best left was taken, and it adds nothing.', fix: ['An OP on a rooftop, tower or tree: a higher eye', 'Take fewer OPs and a standing patrol forward', 'Aim at the NAI from another side'] } });
  const open = chosen.map((o, i) => ({ o, i })).filter(({ o }) => !o.cover && o.rise < 5);
  if (chosen.length) rows.push({ name: 'OP ground', st: open.length ? 'warn' : 'pass', reason: open.length ? `${open.map(({ i }) => `OP ${i + 1}`).join(', ')} on open flat ground: seen as much as it sees` : 'each OP on high ground or in cover',
    detail: open.length ? { head: 'OPs in the open', why: 'An OP with no cover and no height is found as soon as it moves.', fix: ['Dig it in, or use a bund, ruin or hedge the map does not show', 'Move it up to higher ground nearby'] } : undefined });
  let apart = Infinity;
  for (let i = 0; i < chosen.length; i++) for (let j = i + 1; j < chosen.length; j++) apart = Math.min(apart, groundDist(chosen[i].p, chosen[j].p));
  if (chosen.length > 1) rows.push({ name: 'OPs apart', st: apart >= apartM ? 'pass' : 'warn', reason: `${fmtM(apart)} at the closest (wants ${apartM} m, E: one shell, one OP)` });
  const routeSeen = one(doc, 'smallOps.recce.routeSeenPct', 30);
  const noRoute = routes.map((r, i) => (r.out ? -1 : i)).filter((i) => i >= 0);
  const seenRt = routes.map((r, i) => ({ i, seen: r.met.seen })).filter((x) => routes[x.i].out && x.seen > routeSeen);
  if (chosen.length) rows.push(noRoute.length ? { name: 'Routes hidden', st: dr ? 'unchecked' : 'fail', reason: dr ? `no route drawn to ${noRoute.map((i) => `OP ${i + 1}`).join(', ')}` : `no route on foot to ${noRoute.map((i) => `OP ${i + 1}`).join(', ')}`, detail: { head: 'No route to an OP', why: 'NO-GO on foot between the SP and the OP.', fix: ['Move the SP', 'Take another layout'] } }
    : seenRt.length ? { name: 'Routes hidden', st: 'warn', reason: `${seenRt.map((x) => `OP ${x.i + 1} ${x.seen} %`).join(', ')} of the route the NAI may see (wants ${routeSeen} % or less, E)`, detail: { head: 'Routes in view of the NAI', why: 'Open ground between the SP and the OP faces the NAI.', fix: ['Move in by night and leave before first light', 'Bend the route into the dead ground'] } }
      : { name: 'Routes hidden', st: 'pass', reason: `each route ${routeSeen} % or less in view of the NAI` });
  const ratios = cards.map((cd, i) => (cd ? cd.lengthM / Math.max(1, groundDist(sp, chosen[i].p)) : 0));
  const times = cards.map((cd, i) => (cd ? `OP ${i + 1} ${fmtM(cd.lengthM)} (${ratios[i].toFixed(1)} times straight), ${fmtMin(cd.minNight)} by night` : null)).filter(Boolean);
  const long = ratios.map((x, i) => ({ x, i })).filter((r) => r.x > 2.5);
  if (times.length) rows.push(long.length ? { name: 'Time', st: 'warn', reason: times.join('; '), detail: { head: `${long.map((r) => `OP ${r.i + 1}`).join(', ')}: a long way round`, items: times as string[], why: 'The route keeps to ground the NAI cannot see, and that ground lies well off the straight line.', whyShort: 'keeps to dead ground', fix: ['Go the shorter way by night (move in before first light)', 'A nearer SP on that flank'] } }
    : { name: 'Time', st: 'pass', reason: times.join('; ') });
  const confirm = [
    ...chosen.map((_, i) => `OP ${i + 1}: the view to the NAI by day and with NVD by night; a way in and out unseen`),
    'Relief of the OPs, comms back to the SP, what to report and when',
    'Planning time: four daylight hours at least for even a simple recce patrol (IC s40 para 12 p 111)',
  ];
  const fails = rows.filter((x) => x.st === 'fail').length, warns = rows.filter((x) => x.st === 'warn').length;
  return {
    geom, extra: [], rows, confirm, pending, score: Math.max(0, Math.min(100, Math.round(0.7 * uPct + 30 - 15 * fails - 5 * warns))),
    small: {
      task: 'recce',
      ops: chosen.map((o, i) => ({ x: o.p[0], y: o.p[1], label: `OP ${i + 1}`, seenPct: Math.round(o.pct * 100), riseM: Math.round(o.rise), cover: o.cover })),
      naiPts: samples.map((s, k) => ({ x: s[0], y: s[1], by: chosen.map((o, i) => (o.seen[k] ? i : -1)).filter((i) => i >= 0) })),
      routes: routes.map((r) => r.out),
    },
  };
}

// ── screen (IC s73 paras 10-18 pp 377-380) ───────────────────────────────────────────────────────────────────────────────────────

/**
 * A Coy screen in front of the main posn (IC s73 paras 10-18 pp 377-380, R; figures E in PlanDoctrine smallOps.screen): Pl posts laid
 * laterally with intervals on the ground he would watch the main posn from, only as far forward as is necessary, on
 * defensible ground with clear observation and a covered route back. The click is the RV in the main posn the screen
 * withdraws to; the aim is the ground in front. Read like the recce: the ground in front sampled, kept to the points that see
 * the main posn (30 m elevation plus what stands on it: a chance), the posts picked for what each adds to that view.
 */
function readScreen(c: Ctx): SmallRead {
  const { recipe, doc, frame, mov, R, base } = c;
  const dr = c.drawn ?? null;
  const rv: MercXY = dr?.rv?.pts[0] ?? [frame.anchor.x, frame.anchor.y];
  const naiIt = base.items.find((i) => i.role === 'nai');
  if (!naiIt && !dr?.nai) return { geom: {}, extra: [], rows: [], confirm: [], score: 0, small: { task: 'recce', screen: true }, pending: false };
  const ring: MercXY[] = dr?.nai && dr.nai.pts.length >= 3 ? dr.nai.pts : naiIt!.pts.map((p) => toW(frame, p));
  const naiC = ctrW(ring);
  const aimDeg = bearingOf(rv, naiC);
  const front = one(doc, 'smallOps.screen.frontM', 3000);
  const fwd = fig(doc, 'smallOps.screen.fwdM', [1000, 1500]);
  const nearM = Math.min(fwd[0], one(doc, 'smallOps.screen.nearestM', 400));
  const apartM = one(doc, 'smallOps.screen.postsApartM', 400), stepM = one(doc, 'smallOps.screen.stepM', 200);
  // a Recce Sqn's AFV Tps see from the commander's cupola, not a trench (smallOps.screen.tankEyeM, E)
  const eye = recipe.screenBy ? recipe.screenBy.eyeM : one(doc, 'smallOps.screen.postEyeM', 1), hisEye = one(doc, 'smallOps.screen.hisEyeM', 2), tall = one(doc, 'smallOps.screen.mainTallM', 2);
  const foot = mov.going('dismounted');
  const coverCls = new Set<number>(R.ambush.coverClasses);
  mov.takePending?.();
  // the ground in front: a grid over it; the main posn: three points across its front
  const xs2 = ring.map((q) => q[0]), ys2 = ring.map((q) => q[1]);
  const all: MercXY[] = [];
  for (let j = 0; j < 6; j++) for (let i = 0; i < 8; i++) {
    const q: MercXY = [Math.min(...xs2) + ((i + 0.5) / 8) * (Math.max(...xs2) - Math.min(...xs2)), Math.min(...ys2) + ((j + 0.5) / 6) * (Math.max(...ys2) - Math.min(...ys2))];
    if (pointInRing(q, ring)) all.push(q);
  }
  if (!all.length) all.push(naiC);
  const mainPts: MercXY[] = [offsetPt(rv[0], rv[1], aimDeg - 90, front / 3), rv, offsetPt(rv[0], rv[1], aimDeg + 90, front / 3)];
  let unknown = 0, reads = 0;
  const sees = (a: MercXY, ae: number, b: MercXY, bt: number) => { const v = mov.sight(a[0], a[1], ae, b[0], b[1], bt); reads++; if (v === null) unknown++; return (v ?? 0) >= 0.5; };
  // the points of the ground in front that see the main posn: where he would watch it from (none: all of it, early warning)
  const overlook = all.filter((s) => mainPts.some((m) => sees(s, hisEye, m, tall)));
  const samples = overlook.length ? overlook : all;
  const el = samples.map((s) => mov.elev(s[0], s[1])).filter((v) => v === v);
  const mean = el.length ? el.reduce((a, v) => a + v, 0) / el.length : NaN;
  // across (signed, right of the aim +) and forward of the RV
  const across = (p: MercXY) => { const d = groundDist(rv, p), b = ((bearingOf(rv, p) - aimDeg) * Math.PI) / 180; return d * Math.sin(b); };
  const ahead = (p: MercXY) => { const d = groundDist(rv, p), b = ((bearingOf(rv, p) - aimDeg) * Math.PI) / 180; return d * Math.cos(b); };
  type Cand = { p: MercXY; seen: boolean[]; pct: number; rise: number; cover: boolean; score: number; name: string | null };
  const cands: Cand[] = [];
  let noCls = 0;
  const consider = (p: MercXY, name: string | null, asDrawn = false) => {
    const k = mov.cls(p[0], p[1]);
    if (!asDrawn && k === null) { noCls++; return; }
    if (!asDrawn && k !== null && foot.nogo.has(k)) return;
    const f = ahead(p);
    // the search reaches in to nearM (the books differ: AMP p 1.2 puts screens 1-1.5 km out, IC s73 paras 10-11 p 377 only
    // as far forward as is necessary, a knoll about 600 m out its example): nearer ground is kept, and warned below
    if (!asDrawn && (f < nearM || f > fwd[1] || Math.abs(across(p)) > front / 2)) return;
    const seen = samples.map((s) => sees(p, eye, s, tall));
    const pct = seen.filter(Boolean).length / samples.length;
    const e = mov.elev(p[0], p[1]);
    const rise = e === e && mean === mean ? e - mean : 0;
    const cover = k !== null && coverCls.has(k);
    // as far forward as is necessary and no further (IC s73 para 10 p 377): within the AMP band the nearer of two equal
    // posts scores more; nearer than the band no bonus (it wins on its view alone)
    const near = f < fwd[0] ? 0 : one(doc, 'smallOps.screen.nearPts', 25) * Math.max(0, Math.min(1, 1 - (f - fwd[0]) / Math.max(1, fwd[1] - fwd[0])));
    cands.push({ p, seen, pct, rise, cover, score: 60 * pct + Math.max(0, Math.min(15, rise / 2)) + (cover ? 10 : 0) + near, name });
  };
  const drawnPosts = dr ? Object.keys(dr).filter((r2) => /^op\d$/.test(r2)).sort().map((r2) => dr[r2].pts[0]) : [];
  if (dr) for (const p of drawnPosts) consider(p, null, true);
  else {
    for (let d = nearM; d <= fwd[1] + 0.1; d += stepM) for (let l = -front / 2; l <= front / 2 + 0.1; l += stepM) {
      const m = offsetPt(rv[0], rv[1], aimDeg, d);
      consider(offsetPt(m[0], m[1], aimDeg + 90, l), null);
    }
    const kinds = new Set<string>((doctrineAt(doc, 'smallOps.screen.postKinds') as string[] | undefined) ?? ['peak', 'hill', 'knoll', 'trig_station', 'watch_tower']);
    for (const f of mov.features(rv[0], rv[1], fwd[1] + front / 2, kinds)) consider([f.x, f.y], f.name ?? f.label);
  }
  const n = dr ? cands.length : recipe.slots.filter((s) => /^op\d$/.test(s.role)).length || 3;
  const chosen: Cand[] = [];
  const union = new Array(samples.length).fill(false);
  if (dr) for (const cd of cands) { chosen.push(cd); cd.seen.forEach((s2, k) => { if (s2) union[k] = true; }); }
  for (let i = 0; i < n && !dr; i++) {
    let pick: Cand | null = null, ps = -Infinity;
    for (const cd of cands) {
      if (chosen.includes(cd) || chosen.some((o) => groundDist(o.p, cd.p) < apartM)) continue;
      const adds = cd.seen.filter((s, k) => s && !union[k]).length / samples.length;
      // laterally with intervals (IC s73 para 10 p 377): a post across the front from the others scores more
      const gap = chosen.length ? Math.min(...chosen.map((o) => Math.abs(across(o.p) - across(cd.p)))) : 0;
      // the view first (clear observation and a covered route back: IC s73 para 16 p 379); then the post's own score; then the spread across the front
      const sc = chosen.length ? 100 * adds + 0.3 * cd.score + 10 * Math.min(1, gap / (front / Math.max(1, n))) : cd.score;
      if (sc > ps) { ps = sc; pick = cd; }
    }
    if (!pick) break;
    chosen.push(pick);
    pick.seen.forEach((s, k) => { if (s) union[k] = true; });
  }
  // left to right across the front: 1, 2, 3 Pl
  chosen.sort((a, b) => across(a.p) - across(b.p));
  // the way back to the RV, covered from the ground in front (IC s73 paras 16, 18 pp 379-380)
  const Rr = { ...R, patrol: { ...R.patrol, maxCells: Math.min(160, one(doc, 'smallOps.patrol.maxCells', 260)) } };
  const seenAlong = (pts: MercXY[]) => { const L = pathLen(pts); let n2 = 0, hit = 0; for (let d = 0; d <= L; d += 50) { const q = along(pts, d); n2++; if ((mov.sight(naiC[0], naiC[1], R.patrol.threatEyeM, q[0], q[1], 1.7) ?? 0) >= 0.5) hit++; } return n2 ? Math.round((100 * hit) / n2) : 0; };
  const routes = dr
    ? chosen.map((_, i) => { const rt = dr[`rt${i + 1}`]?.pts; return rt && rt.length >= 2 ? { out: rt, back: null, cellM: 0, met: { roads: 0, villages: 0, woodEdges: 0, skylines: 0, seen: seenAlong(rt) }, pending: false } : { out: null, back: null, cellM: 0, met: { roads: 0, villages: 0, woodEdges: 0, skylines: 0, seen: 0 }, pending: false }; })
    : chosen.map((o) => planPatrol(mov, Rr, o.p, rv, { foot, avoidRoads: false, avoidVillages: true, avoidWoodEdges: false, avoidSkylines: true, threat: naiC, separateM: 0 }));
  const speeds: PlFootSpeeds = c.inp.speeds ?? { ground: { open: [4, 3] }, road: [4, 3], toblerA: 3.5, toblerB: 0.05 };
  const cards = routes.map((rt) => (rt.out ? patrolCard(mov, c.inp.plRules ?? plRulesFrom(null), rt.out, { foot, speeds, threat: naiC, classLabel: (k) => mov.classLabel(k) }) : null));
  const pending = unknown > reads / 3 || routes.some((r) => r.pending) || !!mov.takePending?.();
  const loading = (pending && unknown > reads / 2) || (!dr && chosen.length < n && noCls > 0 && (pending || !!mov.takePending?.()));

  const geom: Record<string, { pts: XY[] }> = {};
  const label = (i: number) => recipe.slots.find((s) => s.role === `op${i + 1}`)?.label || `Post ${i + 1}`;
  chosen.forEach((o, i) => {
    geom[`op${i + 1}`] = { pts: [toL(frame, o.p)] };
    const rt = routes[i].out;
    if (rt && recipe.slots.some((s) => s.role === `rt${i + 1}`)) geom[`rt${i + 1}`] = { pts: simplifyPath(rt, 25, 16).map((w) => toL(frame, w)) };
  });
  // the Screen symbol: its arms from behind the posts out to the outer two
  if (chosen.length >= 2 && recipe.slots.some((s) => s.role === 'scr')) {
    const near = Math.min(...chosen.map((o) => ahead(o.p)));
    const mid = offsetPt(rv[0], rv[1], aimDeg, Math.max(50, near * 0.5));
    geom.scr = { pts: [chosen[0].p, mid, chosen[chosen.length - 1].p].map((w) => toL(frame, w)) };
  }

  const rows: Check[] = [];
  const [sFail, sWarn] = fig(doc, 'smallOps.screen.seenPct', [40, 70]);
  const uPct = Math.round((100 * union.filter(Boolean).length) / samples.length);
  const postWord = (o: Cand, i: number) => `${label(i)}: ${fmtM(ahead(o.p))} forward, ${fmtM(Math.abs(across(o.p)))} ${across(o.p) < 0 ? 'left' : 'right'}${o.name ? ` (${o.name})` : ''}, sees ${Math.round(o.pct * 100)} %, ${Math.abs(o.rise) < 1 ? 'level with' : o.rise > 0 ? `${Math.round(o.rise)} m above` : `${Math.round(-o.rise)} m below`} the ground in front${o.cover ? ', in cover' : ', in the open'}`;
  if (!dr && chosen.length < n) rows.push(loading ? { name: 'Posts sited', st: 'unchecked', reason: `${chosen.length} of ${n} posts sited so far: the ground is still loading` } : { name: 'Posts sited', st: 'fail', reason: `${chosen.length} of ${n} posts found ${fmtM(fwd[0])}-${fmtM(fwd[1])} forward across ${fmtM(front)}`, detail: { head: `${chosen.length} of ${n} posts sited`, why: 'NO-GO on foot fills the ground in front of the main posn.', fix: ['Aim the screen at another stretch of the front', 'Fewer posts: a Pl screen'] } });
  rows.push(loading ? { name: 'En viewpoints', st: 'unchecked', reason: 'the ground is still loading' }
    : overlook.length ? { name: 'En viewpoints', st: 'pass', reason: `${overlook.length} of ${all.length} points of the ground in front see the main posn: the screen watches those` }
      : { name: 'En viewpoints', st: 'warn', reason: 'none of the ground in front sees the main posn (30 m elevation): the screen gives early warning only', detail: { head: 'No ground in front sees the main posn', why: 'Folds or what stands on the ground hide the main posn from the area aimed at; the screen still warns and delays.', fix: ['Aim at the ground nearer the main posn', 'Walk it: the map misses walls, crops and trees'] } });
  rows.push(loading ? { name: 'Ground in front seen', st: 'unchecked', reason: 'the ground is still loading' }
    : { name: 'Ground in front seen', st: uPct >= sWarn ? 'pass' : uPct >= sFail ? 'warn' : 'fail', reason: `the posts see ${uPct} % of ${overlook.length ? 'the ground the En would watch you from' : 'the ground in front'} (wants ${sWarn} %, E)`,
      detail: { head: `${uPct} % in view`, items: chosen.map(postWord), why: uPct >= sWarn ? undefined : 'Folds, trees or buildings hide parts of it from the posts (a chance on 30 m elevation).', whyShort: uPct >= sWarn ? undefined : 'folds, trees or buildings in the way', fix: uPct >= sWarn ? undefined : ['A post on higher ground or a rooftop', 'A standing patrol or LP in the ground not seen (the red dots)', 'Mines in front and on the flanks of the screen (IC s73 para 15 p 379)'] } });
  const anyPost = chosen.length > 0;
  const far = chosen.map((o, i) => ({ o, i, f: ahead(o.p) })).filter((x) => x.f > fwd[1] + 50);
  const near = chosen.map((o, i) => ({ o, i, f: ahead(o.p) })).filter((x) => x.f < fwd[0] - 50);
  if (anyPost) rows.push(far.length ? { name: 'Posts forward', st: 'warn', reason: `${far.map((x) => `${label(x.i)} ${fmtM(x.f)}`).join(', ')} forward (AMP p 1.2: ${fmtM(fwd[0])}-${fmtM(fwd[1])})`, detail: { head: 'Further forward than needed', why: 'A screen goes only as far forward from the main posn as is necessary to deny the En observation and recce of it (IC s73 para 10 p 377); AMP p 1.2 puts screens 1-1.5 km ahead of the FDLs. Further out it is cut off and its way back is long.', fix: ['Pull the post back to ground nearer the main posn', 'A standing patrol out there instead'] } }
    : near.length ? { name: 'Posts forward', st: 'warn', reason: `${near.map((x) => `${label(x.i)} ${fmtM(x.f)}`).join(', ')} forward: nearer than AMP p 1.2 (${fmtM(fwd[0])}-${fmtM(fwd[1])}); IC s73 para 11 p 377 has a screen on a knoll about 600 m out (books differ)`, detail: { head: 'Nearer than AMP p 1.2: the books differ', items: near.map((x) => `${label(x.i)}: ${fmtM(x.f)} forward`), why: 'AMP p 1.2: "Put screens 1 - 1.5 kms ahead of FDLs". IC s73 para 10 p 377: screens only as far forward from the main posns as is necessary to deny the En observation and recce of them; para 11 p 377 gives an isolated knoll about 600 m from the FDLs, held by a reinforced Pl with minefields, as an example. This post was kept because it watches the ground the En would see the main posn from.', fix: ['Keep it where it denies the En that ground, strengthened with mines (IC s73 paras 11, 15 pp 377, 379)', `Or push it out to ${fmtM(fwd[0])}-${fmtM(fwd[1])} (AMP p 1.2)`] } }
      : { name: 'Posts forward', st: 'pass', reason: chosen.length ? `${chosen.map((o, i) => `${label(i)} ${fmtM(ahead(o.p))}`).join(', ')} forward (AMP p 1.2: ${fmtM(fwd[0])}-${fmtM(fwd[1])}; IC s73 para 10 p 377: no further than needed)` : 'no posts' });
  if (chosen.length > 1) {
    const span = across(chosen[chosen.length - 1].p) - across(chosen[0].p);
    let apart = Infinity;
    for (let i = 0; i < chosen.length; i++) for (let j = i + 1; j < chosen.length; j++) apart = Math.min(apart, groundDist(chosen[i].p, chosen[j].p));
    const bunched = span < front * one(doc, 'smallOps.screen.spanShare', 0.4);
    rows.push({ name: 'Laterally', st: bunched || apart < apartM ? 'warn' : 'pass', reason: `the posts span ${fmtM(span)} of the ${fmtM(front)} front, ${fmtM(apart)} apart at the closest (wants ${apartM} m, E)`,
      detail: bunched || apart < apartM ? { head: bunched ? 'Posts bunched' : 'Posts close', why: bunched ? 'Screens are laid laterally with intervals (IC s73 para 10 p 377): bunched posts leave an approach unwatched.' : 'One shell or one burst finds two posts.', fix: ['Spread them across the front', 'Sections are not split to stretch the screen (IC s73 para 16 p 379): take more posts instead'] } : undefined });
  }
  const open = chosen.map((o, i) => ({ o, i })).filter(({ o }) => !o.cover && o.rise < 5);
  if (anyPost) rows.push({ name: 'Post ground', st: open.length ? 'warn' : 'pass', reason: open.length ? `${open.map(({ i }) => label(i)).join(', ')} on open flat ground` : 'each post on high ground or in cover (defensible: IC s73 para 10 p 377)',
    detail: open.length ? { head: 'Posts in the open', why: 'A screen is sited on defensible ground (IC s73 para 10 p 377); open flat ground is found and pinned.', fix: ['Dig it in with alternative fire trenches (IC s73 para 16 p 379)', 'Move it up onto higher ground nearby'] } : undefined });
  const routeSeen = one(doc, 'smallOps.screen.routeSeenPct', 30);
  const noRoute = routes.map((r, i) => (r.out ? -1 : i)).filter((i) => i >= 0);
  const seenRt = routes.map((r, i) => ({ i, seen: r.met.seen })).filter((x) => routes[x.i].out && x.seen > routeSeen);
  if (anyPost) rows.push(noRoute.length ? { name: 'Withdrawal', st: dr ? 'unchecked' : 'fail', reason: dr ? `no way back drawn from ${noRoute.map((i) => label(i)).join(', ')}` : `no way back on foot from ${noRoute.map((i) => label(i)).join(', ')}`, detail: { head: 'No way back', why: 'NO-GO on foot between the post and the main posn.', fix: ['Move the post', 'Move the RV'] } }
    : seenRt.length ? { name: 'Withdrawal', st: 'warn', reason: `${seenRt.map((x) => `${label(x.i)} ${x.seen} %`).join(', ')} of the way back in the En's view (wants ${routeSeen} % or less, E)`, detail: { head: 'Way back in view', why: 'The withdrawal is along a covered route (IC s73 para 18 p 380); open ground facing the En on the way back costs the screen as it leaves.', fix: ['Bend the way back into the dead ground', 'Smoke and covering fire from the main posn for the withdrawal', 'Withdraw by night'] } }
      : { name: 'Withdrawal', st: 'pass', reason: `each way back ${routeSeen} % or less in the En's view (covered: IC s73 para 18 p 380)` });
  const times = cards.map((cd, i) => (cd ? `${label(i)} ${fmtM(cd.lengthM)}, ${fmtMin(cd.minDay)} by day / ${fmtMin(cd.minNight)} by night` : null)).filter(Boolean) as string[];
  if (times.length) rows.push({ name: 'Time back', st: 'pass', reason: times.join('; ') });
  const confirm = [
    ...chosen.map((_, i) => `${label(i)}: the view to the front by day and with NVD by night; alternative fire trenches to switch fire (IC s73 para 16 p 379); a way back unseen`),
    'Withdrawal only on the order of the commander who ordered the screen; comms lost: on 50 % casualties or when the time to stay is up (IC s73 para 18 p 380)',
    'Mines in front and on the flanks of the screen, if time and mines allow (IC s73 para 15 p 379)',
    'Arty / mortar observer and comms with the screen (IC s73 para 14 p 378); sections not split (IC s73 para 16 p 379)',
  ];
  const fails = rows.filter((x) => x.st === 'fail').length, warns = rows.filter((x) => x.st === 'warn').length;
  return {
    geom, extra: [], rows, confirm, pending, score: Math.max(0, Math.min(100, Math.round(0.7 * uPct + 30 - 15 * fails - 5 * warns))),
    small: {
      task: 'recce', screen: true,
      ops: chosen.map((o, i) => ({ x: o.p[0], y: o.p[1], label: label(i), seenPct: Math.round(o.pct * 100), riseM: Math.round(o.rise), cover: o.cover })),
      naiPts: samples.map((s, k) => ({ x: s[0], y: s[1], by: chosen.map((o, i) => (o.seen[k] ? i : -1)).filter((i) => i >= 0) })),
      routes: routes.map((r) => r.out),
    },
  };
}

// ── one layout fitted at one spot ────────────────────────────────────────────────────────────────────────────────────

/**
 * An ambush, patrol or recce fitted where it rests (PlanFit.fitLayout hands these over). The aim (the cursor, a
 * patrol's Obj or a recce's NAI) stretches the plan; the click is its pivot and never moves. Without the ground (no
 * Movement Guide reader or rules) the geometry stands, its ground rows grey.
 */
/**
 * A minor operation in the desert (DW s8 para 2 pp 28-30): the wider gaps ease infiltration; hideouts for small groups;
 * targets farther off limit what goes on foot, so wheels or mechanised transport move and place the troops, helicopters
 * insert and extricate; by night, the critical phases at least; direction keeping; the FOO and FAC with the party;
 * self-sufficient. When the patrol's Time row already runs past the night, the row warns with those fixes.
 */
export function desertMinorOpRow(rows: Check[]): Check {
  const rules = 'hideouts for the small groups (DW p 29 b); by night, the critical phases at least (p 29 f); direction keeping (p 29 d); the FOO and FAC go with the party (p 29 h); self-sufficient administratively (p 29 j); wider gaps ease infiltration (p 28 a)';
  const long = rows.find((r) => r.name === 'Time' && r.st === 'warn');
  if (!long) return { name: 'Desert', st: 'pass', reason: `${rules}; targets farther off limit operations on foot: wheels or helicopters where it is far (DW pp 29-30)` };
  return {
    name: 'Desert', st: 'warn',
    reason: `longer than the night on foot: in the desert targets lie farther off, which limits the range and scope of operations on foot (DW s8 para 2 c p 29); ${rules}`,
    detail: { head: 'Too far on foot for the desert', why: 'Targets for minor operations are normally at greater distances in the desert, limiting what is done on foot; the open ground and early detection favour darkness (DW s8 para 2 c, f p 29).', fix: ['Wheels or mechanised transport to move and place the party (DW p 30 k)', 'Helicopters to insert and extricate it (p 29 e)', 'A hideout on the way, out one night and back the next (p 29 b)'] },
  };
}

export function fitSmallOp(inp: FitLayoutInput): FittedLayout | null {
  const { recipe, ctx, ground } = inp;
  const k = kOf(inp.anchor.y);
  const aimM = inp.cursor ? Math.hypot(inp.cursor.x - inp.anchor.x, inp.cursor.y - inp.anchor.y) / k : null;
  const base = solveSmall(recipe, ctx, inp.opts, aimM && aimM > 50 ? aimM : null);
  const pivotItem = base.items.find((i) => i.id === base.pivotId);
  if (!pivotItem) return null;
  const frame: FitFrame = { anchor: inp.anchor, bearing: inp.bearing, k, pivot: pivotItem.pts[0] };
  inp.begin?.();
  const mov = (ground.mov?.() ?? null) as SmallProbe | null;
  const R = inp.movRules ?? null;
  const c: Ctx | null = mov && R ? { recipe, doc: ctx.doc, frame, mov, R, inp, base } : null;
  const read = c ? (recipe.task === 'ambush' ? readAmbush(c) : recipe.task === 'patrol' ? readPatrol(c) : recipe.layout === 'screen' ? readScreen(c) : readRecce(c)) : null;
  const aimGeomNow = aimGeom(recipe, ctx.doc, aimM && aimM > 50 ? aimM : null);
  const raw = read ? solveRecipe(recipe, ctx, { ...inp.opts, geom: { ...aimGeomNow, ...read.geom }, extraPoints: read.extra }) : base;
  const rows = read ? [...read.rows] : base.rows;
  // the desert (DW s8 pp 28-30): the ground read where it rests, unless set in the tab
  if (read && (recipe.task === 'patrol' || recipe.task === 'ambush' || recipe.task === 'recce')) {
    const kindT = inp.terrain && inp.terrain !== 'auto' ? inp.terrain : detectTerrain(ground, frame, raw, recipe, ctx.doc)?.kind ?? null;
    if (kindT === 'desert') rows.push(desertMinorOpRow(rows));
  }
  const fails = rows.filter((r) => r.st === 'fail').length, warns = rows.filter((r) => r.st === 'warn').length;
  const fit: FitResult = {
    nudges: {}, slides: [], killingGr: null, slots: {}, rows, approaches: [],
    score: read ? read.score : 0, fails, warns,
    pending: (read?.pending ?? false) || ground.pending(), data: ground.dataLine(),
    from: inp.threat ?? null, fromAssumed: !inp.threat, small: read?.small,
  };
  const res: SolveResult = {
    ...raw, mode: read ? 'terrain' : 'geometry', rows, slots: [],
    confirm: read ? [...read.confirm, ...base.confirm.filter((x) => !read.confirm.includes(x))] : base.confirm,
    assumptions: read ? [`Fitted to the ground: ${fit.data}.`, ...(recipe.task === 'patrol' && !inp.threat ? ['No threat marked: the Obj is taken as where the En watches from.'] : [])] : base.assumptions,
  };
  return { recipe, res, raw, fit, frame, anchor: inp.anchor, bearing: inp.bearing, manual: {}, terrain: null, enemy: null, unit: null };
}

/** Check my plan for an ambush, patrol or recce built here: the plan as drawn read with the same rows (no search). */
export interface SmallCheck { rows: Check[]; confirm: string[]; small?: SmallReading; pending: boolean; read: string[]; missing: string[] }
export function checkSmallOp(inp: FitLayoutInput, drawn: Drawn): SmallCheck | null {
  const { recipe, ctx, ground } = inp;
  const mov = (ground.mov?.() ?? null) as SmallProbe | null;
  const R = inp.movRules ?? null;
  if (!mov || !R) return null;
  const base = solveSmall(recipe, ctx, inp.opts, null);
  const pivotItem = base.items.find((i) => i.id === base.pivotId);
  if (!pivotItem) return null;
  const frame: FitFrame = { anchor: inp.anchor, bearing: inp.bearing, k: kOf(inp.anchor.y), pivot: pivotItem.pts[0] };
  inp.begin?.();
  const c: Ctx = { recipe, doc: ctx.doc, frame, mov, R, inp, base, drawn };
  const read = recipe.task === 'ambush' ? readAmbush(c) : recipe.task === 'patrol' ? readPatrol(c) : recipe.layout === 'screen' ? readScreen(c) : readRecce(c);
  const need = recipe.task === 'ambush' ? ['kz', 'amb', 'stop1', 'stop2', 'rv', ...(recipe.slots.some((s) => s.role === 'res') ? ['res'] : []), ...(recipe.slots.some((s) => s.role === 'cov') ? ['cov'] : []), ...(recipe.layout === 'area' ? ['out1', 'out2'] : [])] : recipe.task === 'patrol' ? ['sp', 'obj', 'frv', 'out', 'in'] : recipe.layout === 'screen' ? ['rv', 'nai', 'op1', 'op2'] : ['sp', 'nai', 'op1'];
  // a slot with no label of its own (a fire line, a route) is named by its group's, or by what it is
  const PLAIN: Record<string, string> = { wdr: 'Wdr route', kzTgt: 'KZ centre', out: 'Route out', in: 'Route in', scr: 'Screen' };
  const names = (r: string) => recipe.slots.find((s) => s.role === r)?.label || (recipe.slots.find((s) => s.role === `${r}Gp`)?.label ? `${recipe.slots.find((s) => s.role === `${r}Gp`)!.label} fire line` : '') || PLAIN[r] || (/^rt\d$/.test(r) ? `Route to ${recipe.slots.find((s) => s.role === `op${r.slice(2)}`)?.label ?? r}` : r);
  return { rows: read.rows, confirm: read.confirm, small: read.small, pending: read.pending || ground.pending(), read: [...new Set(Object.keys(drawn).map(names))], missing: need.filter((r) => !drawn[r]).map(names) };
}

/** For the Node checks: the readers on their own. */
export const _test = { readAmbush, readPatrol, readRecce, aimGeom, sharedShare };
export type { CheckDetail, Station };

/**
 * A Coy screen held by a Recce Sqn (armr.json p 109: SHQ, 3 AFV Tps of 3 tanks, 2 Rifle Tps in APCs): the three posts
 * are its AFV Tps (tank symbols), seeing from the commander's cupola (smallOps.screen.tankEyeM, E), the Rifle Tps the
 * depth and the covered ways back. New recipe (`-rcs`); the one passed in is not changed.
 */
export function withRecceScreen(r: Recipe, doc: DoctrineSet, sqn: { name: string; tanks: number; afvTps: number; rifleTps: number; apcs: number; src: string }): Recipe {
  if (r.task !== 'recce' || r.layout !== 'screen' || r.screenBy) return r;
  const out: Recipe = JSON.parse(JSON.stringify(r));
  let i = 0;
  for (const sl of out.slots.filter((x) => /^op\d$/.test(x.role))) { i++; sl.label = `${i} Tp`; sl.sym = '10120500'; }
  const eyeM = one(doc, 'smallOps.screen.tankEyeM', 2.5);
  out.id = `${r.id}-rcs`;
  out.name = `${r.name} by a Recce Sqn`;
  out.screenBy = { name: sqn.name, posts: 'AFV Tps', eyeM, text: `${sqn.name}: ${sqn.tanks} tanks (${sqn.afvTps} AFV Tps the posts, eye ${eyeM} m from the cupola, E), ${sqn.rifleTps} Rifle Tps in ${sqn.apcs} APCs for depth and the ways back (${sqn.src})` };
  return out;
}
