/**
 * PlanCrossing.ts — PURE. Phase 7 of the Intelligent Deployment (PlanBuilder_Plan.md 9.3): an assault across a water
 * obstacle and the bridgehead, laid over the Movement Guide's Water engine (MovementGuideWater.readWater / readReach);
 * nothing there is rewritten.
 *
 *   The obstacle   the canal or river under the click: its type (IBB Annex P), width, depth, current, banks, the
 *                  crossings on it; the whole plan re-laid along it (x along the water, y across it from the bund),
 *                  so its fronts, phase lines and bridgehead follow the obstacle's bends.
 *   Bridge site    the narrowest, lowest-banked place with the best tracks in and out within `bridgeSearchM` of the
 *                  planned site; an existing bridge there is said.
 *   Observed fire  the ground on the far side that sees the crossing places (IBB S46 para 24 c p240: his posns that
 *                  overlook the obstacle and direct his artillery onto them are the secondary objectives); the
 *                  Bridgehead Line reaches out to take it, up to its doctrinal depth; what stays beyond is said.
 *   Times          boats, rafts, bridges and lanes from IBB Annex Q (pp 467-468) by day, moonlight or dark night;
 *                  the drift entry 2 x the width upstream (IC s70 para 4e p358); the night they must fit into.
 *
 * Plan metres as PlanSolve: x along the obstacle (right facing the far bank), y across it (+ toward the far bank),
 * 0 = its centre line; the fit adds the far crest distance to y > 0 and the home crest distance to y < 0, so the
 * recipes measure depths from the bund. The pivot (H, the click) never moves. World: Web Mercator. Without the ground
 * the solver's geometry stands and every ground row is grey (safety first). A Fail stays honest, with why and fix.
 *
 * Erasable TypeScript only: Node 24 runs this file as it is (tools/planbuilder-test/crossing.mjs).
 */
import { engrBridge, engrRafts, tamBreach } from './PlanEngr';
import { artyRows } from './PlanArty';
import { adRows } from './PlanAD';
import type { DoctrineSet, Recipe } from './PlanRecipes';
import { doctrineAt, resolveRange } from './PlanRecipes';
import type { Check, PlanItem, SolveResult, XY } from './PlanSolve';
import { solveRecipe, crossingGeometryRows } from './PlanSolve';
import type { FitFrame, FitLayoutInput, FitResult, FittedLayout, PlanGround } from './PlanFit';
import { bearingOf, compass8, groundDist, offsetPt, type MercXY } from '../MovementGuide/MovementGuideScan';
import { readReach, readWater, worst, SRC_WORD, type Fig, type WaterProbe, type WaterReading, type WaterRules } from '../MovementGuide/MovementGuideWater';

export type Light = 'day' | 'moon' | 'dark';
const LIGHT_I: Record<Light, number> = { day: 0, moon: 1, dark: 2 };
const LIGHT_WORD: Record<Light, string> = { day: 'by day', moon: 'by moonlight', dark: 'on a dark night' };

/** The reader the crossing reads: the Movement Guide's (PlanGroundProbe.mov()), with the movers' going. */
export type CrossProbe = WaterProbe & { going(profile: string): { nogo: ReadonlySet<number>; caution: ReadonlySet<number> }; classLabel(c: number): string };

/** What the map products draw (Web Mercator). */
export interface CrossingReading {
  obstacle: { name: string | null; typeLabel: string; annex: number | null; widthM: number | null; line: MercXY[] };
  /** Far-side ground that sees a crossing place or the bridge; `inside` the bridgehead (taken) or beyond it. */
  observers: { x: number; y: number; depthM: number; sees: number; inside: boolean }[];
  /** Where each wave enters the water for the drift (2 x the width upstream), when the flow is known. */
  entries: { x: number; y: number; label: string }[];
  /** Bridges, fords and ferries on the obstacle near the plan. */
  crossings: { x: number; y: number; label: string }[];
  bridges: { x: number; y: number; movedM: number; why: string }[];
  /** The assault crossing places where the bank search put them. */
  places: { x: number; y: number; movedM: number; why: string }[];
  /** The Bridgehead Line as laid (after it reached out for his observers). */
  bh: MercXY[] | null;
  /** The timeline, minutes after H. */
  times: { label: string; atMin: number }[];
}

/** A crossing as drawn on the map, by role (Web Mercator): Check my plan reads it as it is, no siting search. */
export type CrossDrawn = Record<string, { pts: MercXY[]; base?: { start: MercXY; mid: MercXY; end: MercXY } }>;
interface Ctx { recipe: Recipe; doc: DoctrineSet; frame: FitFrame; mov: CrossProbe; WR: WaterRules; inp: FitLayoutInput; base: SolveResult; ground: PlanGround; drawn?: CrossDrawn | null }
interface Read { geom: Record<string, { pts: XY[]; base?: { start: XY; mid: XY; end: XY } }>; rows: Check[]; confirm: string[]; score: number; reading: CrossingReading | null; pending: boolean; data: string }

// ── small helpers ───────────────────────────────────────────────────────────────────────────────────────────────────
const D2R = Math.PI / 180;
const kOf = (y: number) => 1 / Math.cos(2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2);
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
export const hRel = (min: number) => { const m = Math.round(min); const s = m < 0 ? '-' : '+'; const a = Math.abs(m); return `H${s}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`; };
const fig = (doc: DoctrineSet, path: string, fb: [number, number]): [number, number] => resolveRange(doc, doctrineAt(doc, path)) ?? fb;
const one = (doc: DoctrineSet, path: string, fb: number) => fig(doc, path, [fb, fb])[0];
const figWord = (f: Fig, unit: string) => (f.src === 'none' ? 'not recorded' : `${f.lo !== null && f.hi !== null && f.lo !== f.hi ? `${f.lo}-${f.hi}` : (f.v ?? f.lo ?? f.hi)} ${unit} (${SRC_WORD[f.src]})`);

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
function chainOf(path: MercXY[], q: MercXY): number {
  let best = Infinity, at = 0, acc = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1], L = groundDist(a, b);
    const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * vx + (q[1] - a[1]) * vy) / L2)) : 0;
    const d = groundDist(q, [a[0] + vx * t, a[1] + vy * t]);
    if (d < best) { best = d; at = acc + t * L; }
    acc += L;
  }
  return at;
}

/**
 * The obstacle as a frame: a point at chainage `s` along it (beyond its ends straight on), its bearing there, and the
 * world point `n` metres across it toward the far side (negative: toward the home side).
 */
export class ObstacleFrame {
  path: MercXY[];
  s0: number;
  sx: 1 | -1;
  homeSign: 1 | -1;
  private cum: number[];
  constructor(path: MercXY[], section: MercXY, axisDeg: number, homeSign: 1 | -1) {
    // the path runs the way the obstacle's direction points at the section
    const c0 = chainOf(path, section);
    const p0 = ObstacleFrame.at(path, ObstacleFrame.cumOf(path), Math.max(0, c0 - 20)).p, p1 = ObstacleFrame.at(path, ObstacleFrame.cumOf(path), c0 + 20).p;
    const off = Math.abs(((bearingOf(p0, p1) - axisDeg + 540) % 360) - 180);
    this.path = off > 90 ? path.slice().reverse() : path;
    this.cum = ObstacleFrame.cumOf(this.path);
    this.s0 = chainOf(this.path, section);
    this.homeSign = homeSign;
    // facing the far bank, right is the obstacle's direction when home lies right of it (PlanSolve x right)
    this.sx = homeSign === 1 ? 1 : -1;
  }
  static cumOf(p: MercXY[]): number[] {
    const c = [0];
    for (let i = 1; i < p.length; i++) c.push(c[i - 1] + groundDist(p[i - 1], p[i]));
    return c;
  }
  static at(p: MercXY[], cum: number[], s: number): { p: MercXY; brg: number } {
    if (p.length < 2) return { p: p[0], brg: 0 };
    const total = cum[cum.length - 1];
    if (s <= 0) { const b = bearingOf(p[0], p[1]); return { p: offsetPt(p[0][0], p[0][1], b + 180, -s), brg: b }; }
    if (s >= total) { const b = bearingOf(p[p.length - 2], p[p.length - 1]); return { p: offsetPt(p[p.length - 1][0], p[p.length - 1][1], b, s - total), brg: b }; }
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const a = p[i - 1], b = p[i], L = cum[i] - cum[i - 1], t = L > 0 ? (s - cum[i - 1]) / L : 0;
    return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], brg: bearingOf(a, b) };
  }
  /** Plan x (along, right facing the far bank) and n (across from the centre line, + far) to the world. */
  world(x: number, n: number): MercXY {
    const s = this.s0 + this.sx * x;
    const a = ObstacleFrame.at(this.path, this.cum, s - 15), b = ObstacleFrame.at(this.path, this.cum, s + 15);
    const mid = ObstacleFrame.at(this.path, this.cum, s);
    const brg = bearingOf(a.p, b.p);
    return n === 0 ? mid.p : offsetPt(mid.p[0], mid.p[1], brg - 90 * this.homeSign, n);
  }
  /** A world point to plan x (along) and n (across from the centre line, + far): the inverse of `world`. */
  local(w: MercXY): { x: number; n: number } {
    const sc = chainOf(this.path, w);
    const x = (sc - this.s0) * this.sx;
    const P = ObstacleFrame.at(this.path, this.cum, sc).p;
    const d = groundDist(P, w);
    return { x, n: d < 0.01 ? 0 : d * Math.cos((bearingOf(P, w) - this.farDeg(x)) * D2R) };
  }
  /** The bearing toward the far side at plan x. */
  farDeg(x: number): number {
    const s = this.s0 + this.sx * x;
    return bearingOf(ObstacleFrame.at(this.path, this.cum, s - 15).p, ObstacleFrame.at(this.path, this.cum, s + 15).p) - 90 * this.homeSign;
  }
}

/** Points every `stepM` along a polyline (its own points kept); `closed` adds the closing edge. */
function densify(pts: XY[], stepM: number, closed: boolean): XY[] {
  const out: XY[] = [];
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const L = Math.hypot(b.x - a.x, b.y - a.y), k = Math.max(1, Math.ceil(L / stepM));
    for (let j = 0; j < k; j++) out.push({ x: a.x + ((b.x - a.x) * j) / k, y: a.y + ((b.y - a.y) * j) / k });
  }
  if (!closed) out.push({ ...pts[n - 1] });
  return out;
}

// ── the ground's reading ─────────────────────────────────────────────────────────────────────────────────────────────

function readCrossing(c: Ctx): Read {
  const { recipe, doc, frame, mov, WR, inp, base } = c;
  const month = inp.month ?? 1;
  const light: Light = inp.light ?? ((doctrineAt(doc, 'crossing.light') as Light) || 'dark');
  const li = LIGHT_I[light];
  const dr = c.drawn ?? null;
  // drawn (Check my plan): H as drawn (else the first crossing place), aimed at the far-side objectives as drawn
  const drFirstXp = dr ? Object.keys(dr).find((r2) => /^xp/.test(r2) && dr[r2].base) : undefined;
  const click: MercXY = dr?.xTgt?.pts[0] ?? (drFirstXp ? dr![drFirstXp].base!.mid : [frame.anchor.x, frame.anchor.y]);
  const farPts = dr ? ['obj1', 'obj2', 'ph1', 'bh', 'ph2', 'ph1a'].flatMap((r2) => dr[r2]?.pts ?? []) : [];
  const aimDeg = farPts.length ? bearingOf(click, [farPts.reduce((a2, q) => a2 + q[0], 0) / farPts.length, farPts.reduce((a2, q) => a2 + q[1], 0) / farPts.length]) : ((frame.bearing / D2R) % 360 + 360) % 360;
  const farHint = offsetPt(click[0], click[1], aimDeg, 1500), homeHint = offsetPt(click[0], click[1], aimDeg + 180, 800);
  const opts = { purpose: 'cross' as const, month, threat: farHint, homeHint, snapM: 400 };
  mov.takePending?.();
  const r = readWater(mov, WR, click, opts);
  const rows: Check[] = [];
  const confirm: string[] = [];
  const range = (v: unknown) => resolveRange(doc, v);
  const num = (v: unknown, fb = 0) => { const q = resolveRange(doc, v); return q ? (q[0] + q[1]) / 2 : fb; };
  if (!r && mov.takePending?.()) {
    // tiles still on their way: not known yet, never a fail (safety first: grey until read)
    rows.push({ name: 'Obstacle', st: 'unchecked', reason: 'the ground at the click is still loading: rest the mouse there and it is read' });
    rows.push(...crossingGeometryRows(base.items, recipe, doc, range, num, 0, light));
    return { geom: {}, rows, confirm, score: 0, reading: null, pending: true, data: '' };
  }
  if (!r) {
    rows.push({ name: 'Obstacle', st: 'fail', reason: 'no canal, river or water within 400 m of the click: laid square to the aim, on open ground',
      detail: { head: 'No water obstacle at the click', why: 'The bundle shows no canal, river, drain or water within 400 m of H (a channel too small for 30 m pixels may be missing).', whyShort: 'no water near the click', fix: ['Click on the obstacle where the first wave is to enter the water', 'A channel missing from the map: recce it, and lay the crossing by hand'] } });
    rows.push(...crossingGeometryRows(base.items, recipe, doc, range, num, 0, light));
    return { geom: {}, rows, confirm, score: 0, reading: null, pending: !!mov.takePending?.(), data: '' };
  }
  const wHi = worst(r.width, 'hi') ?? 30;
  const homeEdge = Math.max(r.home.crestM ?? 0, wHi / 2), farEdge = Math.max(r.far.crestM ?? 0, wHi / 2);
  // the obstacle along the plan's whole front (and its bridgehead), chained along the sheet line where there is one
  const xs = base.items.flatMap((i) => [...i.pts, ...(i.base ? [i.base.start, i.base.end] : [])].map((p) => p.x));
  const halfX = dr ? Math.max(...Object.values(dr).flatMap((g) => [...g.pts, ...(g.base ? [g.base.start, g.base.end] : [])]).map((q) => groundDist(click, q))) + 600 : Math.max(Math.abs(Math.min(...xs)), Math.abs(Math.max(...xs))) + 600;
  const a = offsetPt(r.at[0], r.at[1], r.axisDeg + 180, halfX), b = offsetPt(r.at[0], r.at[1], r.axisDeg, halfX);
  const reach = readReach(mov, WR, a, b, opts);
  const path = reach && reach.path.length >= 2 ? reach.path : r.line && r.line.length >= 2 ? r.line : [a, b];
  const O = new ObstacleFrame(path, r.at, r.axisDeg, r.homeSign);
  // y from the bund: an item wholly on one side measures its y = 0 from that bank's crest; one across (a crossing, an
  // axis) keeps y = 0 on the centre line
  const nOf = (y: number, side = 0) => (y > 0 || (y === 0 && side > 0) ? y + farEdge : y < 0 || (y === 0 && side < 0) ? y - homeEdge : 0);
  const sideOf = (it: PlanItem) => { const ys = [...it.pts, ...(it.base ? [it.base.start, it.base.end] : [])].map((p) => p.y); return ys.every((y) => y >= 0) ? 1 : ys.every((y) => y <= 0) ? -1 : 0; };
  const W = (p: XY, side = 0): MercXY => O.world(p.x, nOf(p.y, side));
  // drawn: each drawn symbol into plan x (along) and y (from its bank's crest), so the same rows read it
  const yOf = (n: number) => (n > farEdge * 0.5 ? n - farEdge : n < -homeEdge * 0.5 ? n + homeEdge : 0);
  const toPlan = (w: MercXY): XY => { const q = O.local(w); return { x: q.x, y: yOf(q.n) }; };
  const items: PlanItem[] = dr
    ? base.items.filter((it) => dr[it.role]).map((it) => { const g = dr[it.role]; return { ...it, pts: g.pts.map(toPlan), base: g.base ? { start: toPlan(g.base.start), mid: toPlan(g.base.mid), end: toPlan(g.base.end) } : it.base }; })
    : base.items;

  // every item re-laid along the obstacle (lines and areas follow its bends)
  const geom: Read['geom'] = {};
  for (const it of dr ? [] : items) {
    if (it.id === base.pivotId) continue;
    const bend = (it.geo === 'Line' || it.geo === 'Area') && !it.base && it.key !== '25140302' && it.pts.length >= 2;
    const pts = bend ? densify(it.pts, 150, it.geo === 'Area' && it.key !== '25140300' && it.key !== '25141400') : it.pts;
    const side = sideOf(it);
    geom[it.role] = { pts: pts.map((p) => toL(frame, W(p, side))) };
    if (it.base) geom[it.role].base = { start: toL(frame, W(it.base.start, side)), mid: toL(frame, W(it.base.mid, side)), end: toL(frame, W(it.base.end, side)) };
    // a gun area moved by G (the Gun Deployment finder's site): the move laid over the re-laid area
    const mv = /^gunArea\d*$/.test(it.role) ? inp.manual?.[it.role] : undefined;
    if (mv) geom[it.role].pts = geom[it.role].pts.map((q) => ({ x: q.x + mv.x, y: q.y + mv.y }));
  }

  // ── the bridge site: the narrowest, lowest-banked place with tracks in and out near the planned one ──
  const tracked = mov.going('tracked');
  // tracks from the bank out to `nTo`: the NO-GO share, and the longest NO-GO strip within 400 m of the bank (a marsh
  // or ditch the approach cannot go round)
  const going = (x: number, nFrom: number, nTo: number) => {
    let bad = 0, n = 0, run = 0, runMax = 0;
    const dir = Math.sign(nTo - nFrom);
    for (let q = nFrom; dir * (nTo - q) >= 0; q += 20 * dir) {
      const w = O.world(x, q), k = mov.cls(w[0], w[1]);
      n++;
      const no = k !== null && tracked.nogo.has(k);
      if (no) bad++;
      run = no ? run + 20 : 0;
      if (Math.abs(q - nFrom) <= 400) runMax = Math.max(runMax, run);
    }
    return { share: n ? bad / n : 0, run: runMax };
  };
  const search = dr ? 0 : one(doc, 'crossing.bridgeSearchM', 400);
  const bridges: CrossingReading['bridges'] = [];
  const bridgeRows: string[] = [];
  let worstApproach = 0, worstStrip = 0;
  // the gap the bridge and the rafts work across: the chosen bridge site's width (the widest when there are several)
  let bridgeW: number | null = null;
  for (const it of items.filter((i) => i.key === '25271400')) {
    const x0 = it.base ? it.base.mid.x : it.pts[0].x;
    type Cand = { x: number; w: number; banks: number; marsh: number; nogo: number; strip: number; score: number; exist: string | null };
    const cands: Cand[] = [];
    for (let dx = -search; dx <= search + 0.1; dx += 100) {
      const x = x0 + dx, p = O.world(x, 0);
      const rw = readWater(mov, WR, p, { ...opts, threat: O.world(x, 1500), homeHint: O.world(x, -800), snapM: 150 });
      if (!rw) continue;
      const w = worst(rw.width, 'hi') ?? wHi;
      const banks = (worst(rw.home.aboveWater, 'hi') ?? 3) + (worst(rw.far.aboveWater, 'hi') ?? 3);
      const he = Math.max(rw.home.crestM ?? 0, w / 2), fe = Math.max(rw.far.crestM ?? 0, w / 2);
      const gh = going(x, -he - 20, -he - 800), gf = going(x, fe + 20, fe + 800);
      const nogo = Math.max(gh.share, gf.share), strip = Math.max(gh.run, gf.run);
      const ex = rw.crossings.find((q) => /bridge/.test(q.kind) && groundDist([q.x, q.y], p) <= 150);
      const score = 100 - w * 0.5 - banks * 4 - (rw.home.marshM + rw.far.marshM) / 10 - nogo * 60 - strip / 5 + (ex?.tankable ? 40 : ex ? 15 : 0);
      cands.push({ x, w, banks, marsh: rw.home.marshM + rw.far.marshM, nogo, strip, score, exist: ex ? `${ex.label}${ex.name ? ` ${ex.name}` : ''}${ex.load ? ` (${ex.load})` : ''}` : null });
    }
    const here = cands.find((q) => Math.abs(q.x - x0) < 1) ?? cands[Math.floor(cands.length / 2)];
    const best = cands.reduce((p, q) => (q.score > p.score + 5 ? q : p), here ?? cands[0]);
    if (!best) continue;
    const moved = Math.abs(best.x - x0);
    const w = best.w, he = Math.max(homeEdge, w / 2), fe = Math.max(farEdge, w / 2);
    // its base along the home bank, its far end on the far bank (the 2525D Bridge's bracket across the gap)
    if (!dr) geom[it.role] = { pts: [toL(frame, O.world(best.x, 30 + fe))], base: { start: toL(frame, O.world(best.x - 12, -30 - he)), mid: toL(frame, O.world(best.x, -30 - he)), end: toL(frame, O.world(best.x + 12, -30 - he)) } };
    const at = O.world(best.x, 0);
    const why = `${Math.round(w)} m wide, banks ${Math.round(best.banks)} m together above the water, ${Math.round(best.nogo * 100)} % NO-GO for tracks within 800 m${best.strip >= 60 ? `, a NO-GO strip ${Math.round(best.strip)} m wide by the bank` : ''}${best.marsh ? `, ${Math.round(best.marsh)} m of marsh` : ''}${best.exist ? `; on the ${best.exist}` : ''}`;
    bridges.push({ x: at[0], y: at[1], movedM: moved, why });
    bridgeW = Math.max(bridgeW ?? 0, w);
    bridgeRows.push(moved >= 100 ? `${it.label || 'the bridge'} moved ${fmtM(moved)} ${compass8(bearingOf(O.world(x0, 0), at))} to ${why} (here: ${here ? `${Math.round(here.w)} m, ${Math.round(here.nogo * 100)} % NO-GO` : 'not read'})` : `${why}`);
    worstApproach = Math.max(worstApproach, best.nogo);
    worstStrip = Math.max(worstStrip, best.strip);
  }

  // ── the crossing places: each to the best boat site within `placeSearchM` (on its Coy's front): narrower water, a
  // lower far bank to scale, no marsh to wade; kept 100 m from the others ──
  const placeSearch = dr ? 0 : one(doc, 'crossing.placeSearchM', 150);
  const places: CrossingReading['places'] = [];
  const placeX: Record<string, number> = {};
  const placeRows: string[] = [];
  for (const it of items.filter((i) => i.key === '25271300')) {
    const x0 = it.base ? it.base.mid.x : it.pts[0].x;
    type P = { x: number; w: number; far: number; marsh: number; score: number };
    const cands: P[] = [];
    for (let dx = -placeSearch; dx <= placeSearch + 0.1; dx += 50) {
      const x = x0 + dx;
      if (Object.values(placeX).some((o) => Math.abs(o - x) < 100)) continue;
      const rw = readWater(mov, WR, O.world(x, 0), { ...opts, threat: O.world(x, 1500), homeHint: O.world(x, -800), snapM: 150 });
      if (!rw) continue;
      const w = worst(rw.width, 'hi') ?? wHi, far = worst(rw.far.aboveWater, 'hi') ?? 3, marsh = rw.home.marshM + rw.far.marshM;
      cands.push({ x, w, far, marsh, score: 100 - w * 0.6 - far * 6 - marsh / 10 });
    }
    const here = cands.find((q) => Math.abs(q.x - x0) < 1) ?? cands[Math.floor(cands.length / 2)];
    const best = cands.reduce((p, q) => (q.score > p.score + 5 ? q : p), here ?? cands[0]);
    if (!best) continue;
    placeX[it.role] = best.x;
    const he = Math.max(homeEdge, best.w / 2), fe = Math.max(farEdge, best.w / 2);
    // the 2525D Assault Crossing: its base along the home bank, its far end on the far bank
    if (!dr) geom[it.role] = { pts: [toL(frame, O.world(best.x, 30 + fe))], base: { start: toL(frame, O.world(best.x - 15, -30 - he)), mid: toL(frame, O.world(best.x, -30 - he)), end: toL(frame, O.world(best.x + 15, -30 - he)) } };
    const at = O.world(best.x, 0), moved = Math.abs(best.x - x0);
    const why = `${Math.round(best.w)} m of water, far bank ${best.far} m above it${best.marsh ? `, ${Math.round(best.marsh)} m of marsh` : ''}`;
    places.push({ x: at[0], y: at[1], movedM: moved, why });
    placeRows.push(moved >= 50 ? `moved ${fmtM(moved)} ${compass8(bearingOf(O.world(x0, 0), at))}: ${why} (here: ${here ? `${Math.round(here.w)} m, far bank ${here.far} m${here.marsh ? `, marsh ${Math.round(here.marsh)} m` : ''}` : 'not read'})` : why);
  }

  // each lane through his minefield (withMinefield) follows its crossing place along the bank
  for (const it of dr ? [] : items.filter((i) => i.role.startsWith('lane') && i.base)) {
    const role = `${it.role[4].toLowerCase()}${it.role.slice(5)}`, x = placeX[role];
    if (x === undefined) continue;
    const dx = x - it.base!.mid.x, mv = (q: XY): XY => ({ x: q.x + dx, y: q.y });
    geom[it.role] = { pts: it.pts.map((q) => toL(frame, W(mv(q), -1))), base: { start: toL(frame, W(mv(it.base!.start), -1)), mid: toL(frame, W(mv(it.base!.mid), -1)), end: toL(frame, W(mv(it.base!.end), -1)) } };
  }

  // ── his observers: far-side ground that sees the crossing places or the bridge ──
  const eye = one(doc, 'crossing.observe.eyeM', 2), tall = one(doc, 'crossing.observe.targetM', 1);
  const maxM = one(doc, 'crossing.observe.maxM', 3000), stepM = one(doc, 'crossing.observe.stepM', 250);
  const targets: { x: number; w: MercXY; label: string }[] = [];
  for (const it of items.filter((i) => i.key === '25271300' || i.key === '25271400')) {
    const g = geom[it.role];
    const x = placeX[it.role] ?? (it.base ? it.base.mid.x : it.pts[0].x);
    // the bridge where the site search put it (the middle of its bracket), a crossing place on the water
    const mid = it.key === '25271400' && g?.base ? (() => { const m = toW(frame, g.base!.mid), f = toW(frame, g.pts[0]); return [(m[0] + f[0]) / 2, (m[1] + f[1]) / 2] as MercXY; })() : O.world(x, 0);
    targets.push({ x, w: mid, label: it.key === '25271400' ? 'the bridge' : 'a crossing place' });
  }
  const xsI = dr ? items.flatMap((i) => [...i.pts, ...(i.base ? [i.base.start, i.base.end] : [])].map((p) => p.x)) : xs;
  const xMin = Math.min(...xsI) - 500, xMax = Math.max(...xsI) + 500;
  const obs: { x: number; d: number; w: MercXY; sees: number }[] = [];
  let unknown = 0, reads = 0;
  for (let x = xMin; x <= xMax; x += stepM) for (let d = stepM; d <= maxM; d += stepM) {
    const w = O.world(x, farEdge + d);
    let sees = 0;
    for (const t of targets) { const s = mov.sight(w[0], w[1], eye, t.w[0], t.w[1], tall); reads++; if (s === null) unknown++; else if (s >= 0.5) sees++; }
    if (sees) obs.push({ x, d, w, sees });
  }
  // the Bridgehead Line reaches out to take them, up to its doctrinal depth (IBB S46 paras 20-23)
  const bhItem = items.find((i) => i.role === 'bh');
  const four = recipe.layout === 'four-bn';
  const maxDepth = recipe.echelon === '21' ? one(doc, 'crossing.bridgehead.divDepthM', 6000) : four ? one(doc, 'crossing.bridgehead.bdeFourBnDepthM', 2500) : fig(doc, 'crossing.bridgehead.bdePh2DepthM', [1500, 1800])[1];
  let bhWorld: MercXY[] | null = null;
  let depthAt: (x: number) => number = () => 0;
  let bhDepths: number[] = [];
  if (bhItem) {
    const bx = bhItem.pts.map((p) => p.x), x0 = Math.min(...bx), x1 = Math.max(...bx), d0 = Math.max(...bhItem.pts.map((p) => p.y));
    const cols: number[] = [];
    for (let x = x0; x <= x1 + 0.1; x += 125) cols.push(x);
    let dep = dr
      // drawn: the line's own depth at each point along it (the deepest of its points within 200 m)
      ? cols.map((x) => Math.max(0, ...bhItem.pts.filter((p) => Math.abs(p.x - x) <= 200).map((p) => p.y)))
      : cols.map((x) => {
        let d = d0;
        for (const o of obs) if (Math.abs(o.x - x) <= 200 && o.d > d && o.d < maxDepth) d = Math.max(d, Math.min(maxDepth, o.d + 150));
        return d;
      });
    if (!dr) dep = dep.map((d, i) => Math.max(d, ((dep[i - 1] ?? d) + (dep[i + 1] ?? d)) / 2));
    bhDepths = dep;
    depthAt = (x: number) => (x < x0 || x > x1 ? 0 : dep[Math.max(0, Math.min(dep.length - 1, Math.round((x - x0) / 125)))]);
    const ring: XY[] = [{ x: x0, y: 12 }, ...cols.map((x, i) => ({ x, y: dep[i] })), { x: x1, y: 12 }];
    bhWorld = dr ? dr.bh.pts : [O.world(x0, 12 + farEdge), ...cols.map((x, i) => O.world(x, dep[i] + farEdge)), O.world(x1, 12 + farEdge)];
    geom.bh = { pts: ring.map((p) => toL(frame, O.world(p.x, p.y + farEdge))) };
  } else {
    // a battalion: its bridgehead is OBJ 2 (the break-in, 600 m deep)
    const o2 = items.find((i) => i.role === 'obj2');
    if (o2) { const ox = o2.pts.map((p) => p.x), d = Math.max(...o2.pts.map((p) => p.y)); depthAt = (x) => (x >= Math.min(...ox) && x <= Math.max(...ox) ? d : 0); }
  }
  const observers = obs.map((o) => ({ x: o.w[0], y: o.w[1], depthM: o.d, sees: o.sees, inside: o.d <= depthAt(o.x) }));
  const beyond = obs.filter((o) => o.d > depthAt(o.x));
  // outside the bridgehead: in front of it (deeper than its line) or on its flanks (wider than it)
  const o2x = items.find((i) => i.role === 'obj2');
  const ext = bhItem ?? o2x;
  const bhX = ext ? [Math.min(...ext.pts.map((p) => p.x)), Math.max(...ext.pts.map((p) => p.x))] : [0, 0];
  const onFlank = beyond.filter((o) => o.x < bhX[0] || o.x > bhX[1]), inFront = beyond.filter((o) => o.x >= bhX[0] && o.x <= bhX[1]);
  const pendingSight = unknown > reads / 3;

  // ── rows: the obstacle ──
  const nm = r.name ? `${r.name} (${r.typeLabel}${r.annex ? `, Annex P ${r.annex}` : ''})` : `${r.typeLabel}${r.annex ? ` (Annex P ${r.annex})` : ''}`;
  rows.push({ name: 'Obstacle', st: r.width.src === 'none' ? 'warn' : 'pass', reason: `${nm}: ${figWord(r.width, 'm')} wide, ${figWord(r.depth, 'm')} deep, current ${figWord(r.current, 'm/s')}${r.bed ? `, bed ${r.bed}` : ''}; home bank ${figWord(r.home.aboveWater, 'm')} above the water, far bank ${figWord(r.far.aboveWater, 'm')}`,
    detail: r.width.src === 'none' ? { head: 'Width not recorded', why: 'The times below take the bigger end of the type\'s width (safety first).', fix: ['Recce the width, depth and current at the crossing places'] } : undefined });
  const farH = worst(r.far.aboveWater, 'hi');
  const highM = one(doc, 'crossing.highFarBankM', 1.5);
  if (farH !== null && farH >= highM) rows.push({ name: 'Far bank', st: 'warn', reason: `${farH} m above the water: a high far bank`, detail: { head: `High far bank, ${farH} m`, why: 'Steep and slippery: the assault climbs it under fire from the bunkers on it.', whyShort: 'steep bank under fire', fix: ['Bamboo pole ladders and grapnels with each assault section; dead ground picked on the far bank (IC s70 para 4f p358)', 'Bunkers cleared from the rear; RL and the home bank\'s fire on the loopholes (IC s70 para 4g p359; IBB S47)'] } });
  if (r.season.wet) rows.push({ name: 'Season', st: 'warn', reason: r.season.text, detail: { head: 'Wet season', why: r.season.text, fix: ['Recce the width and current again before the night', 'Rafts and boats for a wider gap'] } });

  // ── rows: crossing means and times (IBB Annex Q) ──
  const times: CrossingReading['times'] = [];
  const boatMen = one(doc, 'crossing.boat.men', 12), trip30 = one(doc, 'crossing.boat.roundTripMinPer30m', 10);
  const tripMin = trip30 * Math.max(1, wHi / 30);
  const boatsPerBn = one(doc, 'crossing.boatsPerBn', 16), coyMen = one(doc, 'crossing.coyMen', 96), hqMen = one(doc, 'crossing.bnHqMen', 60);
  const perWave = boatsPerBn * boatMen;
  if (recipe.echelon !== '21') {
    const bnMen = 4 * coyMen + hqMen;
    const waves = Math.ceil(bnMen / perWave), assaultWaves = Math.ceil((2 * coyMen) / perWave);
    const lastIn = (waves - 1) * tripMin;
    times.push({ label: 'A, B Coys enter the water', atMin: 0 }, { label: 'C Coy (2nd wave)', atMin: assaultWaves * tripMin }, { label: 'Bn across', atMin: lastIn + tripMin / 2 });
    const ic = one(doc, 'crossing.waveGapMin', 20);
    rows.push({ name: 'Boats', st: assaultWaves === 1 ? 'pass' : 'warn', reason: `${boatsPerBn} M2 assault boats a leading Bn, 12 men each, ${Math.round(tripMin)} min a round trip over ${Math.round(wHi)} m (Annex Q para 3 p467: 10 min per 30 m): A and B Coys ${assaultWaves === 1 ? 'in one wave at H' : `in ${assaultWaves} waves`}, C Coy ${hRel(assaultWaves * tripMin)} (IC s71 para 12: H+${ic}), the Bn across ${hRel(lastIn + tripMin / 2)}${recipe.echelon === '18' ? '; the third Bn by the boats after them, or the bridge' : ''}`,
      detail: assaultWaves === 1 ? undefined : { head: `The assault Coys need ${assaultWaves} waves`, why: `${2 * coyMen} men in the two assault Coys against ${perWave} a wave (${boatsPerBn} boats).`, fix: ['More boats from the division\'s 48 (Annex Q para 1)', 'Assault on a narrower front: one Coy up'] } });
    const raft = (doctrineAt(doc, 'crossing.rafts.list') as any[] | undefined)?.[0];
    if (raft) {
      const ready = raft.buildMin[li];
      times.push({ label: `${raft.label} ready (RRs, jeeps)`, atMin: ready });
      rows.push({ name: 'Rafts', st: 'pass', reason: `${raft.label} (${raft.load}, built by ${raft.by}) ready ${hRel(ready)} ${LIGHT_WORD[light]}, ${Math.round(raft.tripMin * Math.max(1, wHi / 30))} min a round trip: the RRs, ammunition, FOO and the CO's vehicles first (IC s71 para 18 p366; Annex Q para 3)` });
    }
  }
  const brList = (doctrineAt(doc, 'crossing.bridges.list') as any[] | undefined) ?? [];
  const gapW = bridgeW ?? wHi;
  const seat = one(doc, 'crossing.bridges.seatsM', 10), need = gapW + seat;
  const holder = recipe.echelon === '21' ? 'armdDiv' : 'infDiv';
  const bridgeTime = (b: any) => { const sp = (b.spans as any[]).find((q) => q.m >= need); return sp ? { span: sp.m, h: sp.h[li] as number, pls: sp.pls as number } : null; };
  const m2 = brList.find((b) => b.cls === 9), hp = brList.find((b) => b.cls === 50);
  const lanes = fig(doc, 'crossing.lanesH', [3, 3.5]);
  const layerMax = one(doc, 'crossing.bridgeLayerMaxM', 24);
  if (m2) {
    const t = bridgeTime(m2), held = m2.heldM?.[holder] ?? 84;
    if (!t) rows.push({ name: 'Bridge', st: 'fail', reason: `${Math.round(need)} m to span: longer than any M2 span in Annex Q (195 m)`, detail: { head: `${Math.round(need)} m: no M2 bridge spans it`, why: 'The gap is wider than the bridging equipment Annex Q lists.', fix: ['Rafts and ferries only (Class 50 OBM raft for tanks)', 'Corps engineers\' hollow plate bridge (252 m) or track-way', 'Cross where it is narrower'] } });
    else {
      times.push({ label: `${m2.label} open`, atMin: t.h * 60 });
      const short = t.span > held;
      rows.push({ name: 'Bridge', st: short ? 'warn' : 'pass', reason: `${m2.label}: ${Math.round(need)} m to span (the ${Math.round(gapW)} m gap at the bridge site and its seats) takes the ${t.span} m set, ${t.pls} engineer Pls, ${t.h} h ${LIGHT_WORD[light]}: open about ${hRel(t.h * 60)} if the engineers start at H (IBB Fig 21: as soon as possible after H; the lanes needed by H+${lanes[0]}-${lanes[1]}); ${gapW <= layerMax ? `${Math.round(gapW)} m: bridge-layer tanks can span it in a rush` : `over ${layerMax} m (80 ft): too wide for bridge-layer tanks (IBB S47 para 5 p242)`}`,
        detail: short ? { head: `${t.span} m set needed, the division holds ${held} m`, why: 'Annex Q para 1: an Inf or Armd Div holds 84 m of M2 bridge.', fix: ['Corps engineers\' bridging', 'Rafts until the bridge is up', 'Cross where it is narrower (Bridge site)'] } : undefined });
    }
  }
  if (hp) {
    const held = hp.heldM?.[holder] ?? 0, t = bridgeTime(hp);
    const cl50 = (doctrineAt(doc, 'crossing.rafts.list') as any[] | undefined)?.find((q) => /Class 50/.test(q.label));
    const sqn = one(doc, 'crossing.sqnTanks', 14);
    if (t && held >= t.span) {
      times.push({ label: 'Tanks across (Cl 50 bridge)', atMin: t.h * 60 });
      rows.push({ name: 'Tanks across', st: 'pass', reason: `${hp.label}, ${t.span} m set held by the ${holder === 'armdDiv' ? 'armoured division' : 'division'} (Annex Q para 1): ${t.h} h ${LIGHT_WORD[light]}, tanks across from about ${hRel(t.h * 60)}` });
    } else if (cl50) {
      const trip = cl50.tripMin * Math.max(1, gapW / 30), first = cl50.buildMin[li] + trip / 2, all = cl50.buildMin[li] + sqn * trip;
      times.push({ label: 'First tank across (Cl 50 raft)', atMin: first }, { label: 'A tank Sqn across', atMin: all });
      rows.push({ name: 'Tanks across', st: 'warn', reason: `no Class 50 bridge with ${holder === 'infDiv' ? 'an infantry division' : 'the division'} (Annex Q para 1): ${cl50.label}, built ${cl50.buildMin[li]} min ${LIGHT_WORD[light]}, ${Math.round(trip)} min a round trip: the first tank ${hRel(first)}, a Sqn of ${sqn} ${hRel(all)}`,
        detail: { head: `Tanks by raft: a Sqn by ${hRel(all)}`, items: [`${cl50.label}: one tank a trip, ${Math.round(trip)} min round over ${Math.round(wHi)} m`, `${hp.label}: the armoured division holds ${hp.heldM?.armdDiv ?? 84} m, Corps ${hp.heldM?.corps ?? 252} m (Annex Q para 1)`], why: 'The bridgehead holds his counter-attack without tanks until they are across (IC s71 para 17: AT weapons across early, mines laid on arrival).', whyShort: 'no Class 50 bridge held', fix: ['The armoured division\'s or Corps\' hollow plate bridge', 'AT mines and RRs across with the assault (IC s71 para 17 p366)', 'More rafts'] } });
    }
  }
  // the engineers grouped to the crossing (ORBAT): their own bridging across the gap (SO's Hbk pp 427-432)
  const eg = recipe.engr;
  if (eg) {
    const b = engrBridge(eg, need, li, eg.kinds);
    if (b) { rows.push(b.row); if (b.openH !== null && b.label) times.push({ label: b.label, atMin: Math.round(b.openH * 60) }); }
    // its ribbon bays as rafts for the tanks until the bridge is open (p 430-431)
    const rf = engrRafts(eg, wHi, li, eg.kinds, one(doc, 'crossing.sqnTanks', 14));
    if (rf) { rows.push(rf.row); if (rf.firstMin !== null) times.push({ label: `First tank across (ribbon raft, ${eg.name})`, atMin: rf.firstMin }); }
  }
  // the night: bridgehead and induction in one night, break-out at first light (OoW II s14); night assault (IBB S46 para 18)
  // the vehicle lanes through his minefield, begun at H (breachRow: Annex Q para 4), go on the timeline the night is held to
  const mfSlot = recipe.slots.find((s) => s.role === 'enMf');
  if (mfSlot?.shape?.rect && recipe.slots.some((s) => s.sym === '25340200')) {
    const hrs = (doctrineAt(doc, 'crossing.breach.hours') as any) ?? { none: [4, 5, 6] };
    const n = Math.ceil(Number(mfSlot.shape.rect.hM) / one(doc, 'crossing.breach.laneM', 108));
    times.push({ label: 'Vehicle lanes through his minefield (begun at H)', atMin: hrs.none[li] * 60 + (n - 1) * 100 });
    // the engineers' TAMs: one a lane, a lane to each assault crossing place (SO's Hbk p 451)
    const lanes = Math.max(1, items.filter((i) => i.key === '25271300').length);
    const tb = eg ? tamBreach(eg, lanes, Number(mfSlot.shape.rect.hM), hrs.none[li]) : null;
    if (tb) { rows.push(tb.row); times.push({ label: `Lanes by TAM (${eg!.name})`, atMin: Math.round(tb.h * 60) }); }
  }
  const nightH = one(doc, 'crossing.nightH', 10);
  const lastMin = Math.max(0, ...times.map((t) => t.atMin));
  if (times.length) rows.push({ name: 'Night', st: light === 'day' ? 'warn' : lastMin <= (nightH - 1) * 60 ? 'pass' : 'warn', reason: `the last of these ${hRel(lastMin)} of a ${nightH} h night (E): ${light === 'day' ? 'a crossing by day: the far bank sees every boat (IBB S46 para 18 p237: night assault preferable)' : lastMin <= (nightH - 1) * 60 ? 'room to induct and form up before first light (OoW II s14)' : 'too late to be ready by first light'}`,
    detail: light !== 'day' && lastMin <= (nightH - 1) * 60 ? undefined : { head: light === 'day' ? 'A crossing by day' : `Not done by first light (${hRel(lastMin)})`, why: light === 'day' ? 'Night assault allows the base of fire, artillery and engineers to close up without observed fire (IBB S46 para 18 p237).' : 'The bridgehead and the induction ideally in one night, the break-out at first light (OoW II s14).', fix: light === 'day' ? ['Set the light to Moonlight or Dark'] : ['H earlier (soon after last light)', 'Cross where it is narrower (a shorter bridge)', 'More bridging or rafts'] } });
  // drift: enter upstream twice the width (IC s70 para 4e p358) where the water flows
  const entries: CrossingReading['entries'] = [];
  const still = ['lake', 'atDitch', 'defenceDrain', 'doubleDitch'].includes(r.type);
  const k2 = one(doc, 'crossing.driftTimesWidth', 2);
  if (!still) {
    // flowing the way the obstacle is drawn (downstream): upstream is against it
    const up = r.flow === 'downstream' ? -1 : r.flow === 'upstream' ? 1 : 0;
    for (const it of items.filter((i) => i.key === '25271300')) {
      const x = placeX[it.role] ?? (it.base ? it.base.mid.x : it.pts[0].x);
      if (up) { const w = O.world(x + O.sx * up * k2 * wHi, -homeEdge); entries.push({ x: w[0], y: w[1], label: 'Entry' }); }
    }
    rows.push({ name: 'Drift', st: up ? 'pass' : 'warn', reason: up ? `enter the water ${Math.round(k2 * wHi)} m upstream of each crossing place, ${k2} times the width (IC s70 para 4e p358): marked` : `which way it flows is not recorded: enter about ${Math.round(k2 * wHi)} m (twice the width) upstream of each crossing place (IC s70 para 4e p358)`,
      detail: up ? undefined : { head: 'Flow not recorded', why: 'The sheet line is not known to be drawn downstream here.', fix: ['Recce the current and its direction at each crossing place'] } });
  }
  // the breach: his minefield in front of a defended obstacle (IBB S47 para 6; Annex Q para 4)
  const mf = fig(doc, 'crossing.enemyMinefieldM', [900, 1000]), laneM = one(doc, 'crossing.breach.laneM', 108);
  const breachH = (doctrineAt(doc, 'crossing.breach.hours') as any)?.none?.[li] ?? 6;
  confirm.push(`His minefield (IBB S47 para 6: ${mf[0]}-${mf[1]} m deep): one engineer Pl a ${laneM} m of lane, ${breachH} h ${LIGHT_WORD[light]} (Annex Q para 4): lanes begun before H`);

  // ── rows: the ground ──
  rows.push(...crossingGeometryRows(items, recipe, doc, range, num, 0, light));
  // the artillery behind it (PlanArty.withArty): its reach on the plan as laid along the obstacle (or as drawn), its
  // gun areas' ground where laid
  const laid = dr ? items : items.map((it) => (geom[it.role] ? { ...it, pts: geom[it.role].pts } : it));
  // distances behind the water in the obstacle's frame (as drawn: already its y from the crest)
  const backOf = dr ? (p: XY) => -p.y : (p: XY) => -O.local(toW(frame, p)).n;
  if (recipe.arty) rows.push(...artyRows(laid, recipe, null, dr ? null : frame, dr ? null : c.ground, backOf));
  // AD over its bridges, gun areas, HQ and Assy areas (PlanAD)
  if (recipe.ad) rows.push(...adRows(laid, recipe));
  const bhRow = rows.find((x) => x.name === 'Bridgehead');
  if (bhRow && bhItem && bhDepths.length) {
    const d0 = Math.max(...bhItem.pts.map((p) => p.y)), dMax = Math.max(...bhDepths);
    if (dMax > d0 + 1) bhRow.reason += `; reaches out to ${fmtM(dMax)} where his observers stand (up to ${fmtM(maxDepth)})`;
  }
  if (placeRows.length) rows.push({ name: 'Crossing places', st: 'pass', reason: placeRows.map((r, i) => `${i + 1}: ${r}`).join('; ') });
  if (bridgeRows.length) rows.push({ name: 'Bridge site', st: 'pass', reason: bridgeRows.join('; ') });
  if (bridges.length) rows.push(worstApproach <= 0.2 && worstStrip < 60 ? { name: 'Approaches and exits', st: 'pass', reason: `tracks to the water and beyond the far bank: ${Math.round(worstApproach * 100)} % NO-GO within 800 m` }
    : { name: 'Approaches and exits', st: 'warn', reason: `${worstStrip >= 60 ? `a NO-GO strip ${Math.round(worstStrip)} m wide by the bank, ` : ''}${Math.round(worstApproach * 100)} % NO-GO for tracks within 800 m of the bridge site`, detail: { head: 'Tracks in or out blocked', why: 'Marsh, water or close country beside the bridge site: vehicles bog or queue under his fire.', fix: ['Track-way or matting to the bridge (Corps engineers: 891 m, Annex Q para 1)', 'Another bridge site with firm going'] } });
  const near = r.crossings.filter((q) => groundDist([q.x, q.y], r.at) <= 5000).slice(0, 4);
  if (near.length) rows.push({ name: 'Crossings near', st: 'pass', reason: near.map((q) => `${q.label}${q.name ? ` ${q.name}` : ''}${q.load ? ` (${q.load})` : ''} ${fmtM(q.distM)} ${q.dir}`).join('; ') + ': a party to seize a bridge intact, or his to blow' });
  const seenAssy: string[] = [];
  const crest = Array.from({ length: Math.max(2, Math.round((xMax - xMin) / 500)) }, (_, i) => O.world(xMin + i * 500, farEdge + 50));
  for (const it of items.filter((i) => /^assy|^vwa/.test(i.role))) {
    const cx = it.pts.reduce((a2, p) => a2 + p.x, 0) / it.pts.length, cy = it.pts.reduce((a2, p) => a2 + p.y, 0) / it.pts.length;
    const w = W({ x: cx, y: cy });
    if (crest.some((o) => (mov.sight(o[0], o[1], eye, w[0], w[1], 3) ?? 0) >= 0.5)) seenAssy.push(it.label || it.role);
  }
  rows.push(seenAssy.length ? { name: 'Assy areas', st: 'warn', reason: `the far bank may see ${seenAssy.join(', ')}`, detail: { head: `${seenAssy.join(', ')}: seen from the far bank`, why: 'Open ground on the home side faces his bank: troops and boats gathering there are found before H.', fix: ['Move them back into cover (trees, villages, dead ground)', 'Occupy them by night only; the boats come forward at the last moment (boat off-loading point, IC s71 para 7 d)'] } }
    : { name: 'Assy areas', st: 'pass', reason: 'hidden from the far bank' });
  if (pendingSight) rows.push({ name: 'Observed fire', st: 'unchecked', reason: 'the ground on the far side is still loading' });
  else if (!obs.length) rows.push({ name: 'Observed fire', st: 'pass', reason: `no ground within ${fmtM(maxM)} of the far bank sees the crossing places (banks or folds hide them: a chance on 30 m elevation)` });
  else {
    const take = obs.length - beyond.length;
    const near2 = beyond.length ? Math.min(...beyond.map((o) => o.d)) : 0, far2 = beyond.length ? Math.max(...beyond.map((o) => o.d)) : 0;
    rows.push(!beyond.length ? { name: 'Observed fire', st: 'pass', reason: `${obs.length} places on the far side see the crossing places: all inside the bridgehead, taken as its objectives (IBB S46 para 24 c p240)` }
      : { name: 'Observed fire', st: 'warn', reason: `${obs.length} places on the far side see the crossing places: ${take} inside the bridgehead, ${inFront.length} in front of it, ${onFlank.length} on its flanks (${fmtM(near2)}-${fmtM(far2)} from the bund)`,
        detail: { head: `${beyond.length} observers outside the bridgehead`, items: [`${take} taken inside it`, ...(inFront.length ? [`${inFront.length} in front, deeper than the BH line`] : []), ...(onFlank.length ? [`${onFlank.length} on the flanks, wider than the bridgehead`] : []), `${fmtM(near2)} to ${fmtM(far2)} from the far bund`], why: 'His posns there overlook the obstacle and direct his artillery onto the crossing places (IBB S46 para 24 c p240).', whyShort: 'his OPs overlook the crossings', fix: [...(recipe.echelon === '18' && !four && inFront.some((o) => o.d <= 2500) ? ['Four battalions: the brigade phase reaches 2.5 km (IBB S46 para 23 p239; Compare)'] : []), ...(onFlank.length ? ['Smoke and fire on the flanks; widen the bridgehead as it expands sideways (IBB S46 para 22)'] : []), 'Smoke and counter-battery fire on them from H', 'Cross where the far side cannot see (another site, Bridge site search)'] } });
  }
  for (const x of r.recce.slice(0, 6)) confirm.push(x);
  if (bridges.some((b2) => /on the Bridge|on the bridge/i.test(b2.why))) confirm.push('The existing bridge: its class and whether he has prepared it for demolition; a party to seize it intact');

  const fails = rows.filter((x) => x.st === 'fail').length, warns = rows.filter((x) => x.st === 'warn').length;
  const score = Math.max(0, Math.min(100, Math.round(100 - 25 * fails - 6 * warns - beyond.length * 0.5)));
  const lineOut = path.filter((p) => Math.abs(chainOf(O.path, p) - O.s0) <= halfX + 200);
  return {
    geom, rows, confirm, score, pending: !!mov.takePending?.() || r.pending || pendingSight, data: '',
    reading: {
      obstacle: { name: r.name, typeLabel: r.typeLabel, annex: r.annex, widthM: worst(r.width, 'hi'), line: lineOut.length >= 2 ? lineOut : path },
      observers, entries,
      crossings: near.map((q) => ({ x: q.x, y: q.y, label: `${q.label}${q.name ? ` ${q.name}` : ''}` })),
      bridges, places, bh: bhWorld, times: times.sort((p, q) => p.atMin - q.atMin),
    },
  };
}

// ── a defence on a canal (the mirror of the crossing) ───────────────────────────────────────────────────────────────

export interface CanalPrep {
  /** Plan-metre moves of the posns' seeds, so the defence engine lays them along the canal. */
  nudges: Record<string, XY>;
  /** Shape slots (mask posns, minefields, wire) laid along it. */
  geom: Record<string, { pts: XY[] }>;
  rows: Check[];
  confirm: string[];
  reading: CrossingReading | null;
  pending: boolean;
}

/**
 * A canal defence (recipe layout `canal`: IC s85 pp 449-458, IBB S57 Fig 34) laid along the canal the click is on: the
 * posns' seeds moved (nudges) and the shape slots re-laid so their distance from the water is the recipe's, measured
 * from each bank's crest; the defence engine (PlanFit) then fits and checks it as any defence (his approaches cross
 * the canal only at its bridges and fords). Adds the canal's rows: the obstacle, which bank is higher (the bulk on the
 * higher bank, or the far bank if equal: IC s85 para 10 b), bridges in the sector, marsh, its value against bridge-layer
 * tanks. Null without the Movement Guide reader or the water rules.
 */
export function canalPrep(inp: FitLayoutInput): CanalPrep | null {
  const { recipe, ctx, ground } = inp;
  const doc = ctx.doc;
  const mov = (ground.mov?.() ?? null) as CrossProbe | null;
  const WR = (inp.waterRules ?? null) as WaterRules | null;
  if (!mov || !WR) return null;
  const base = solveRecipe(recipe, ctx, { ...inp.opts, geom: undefined });
  const pivot = base.items.find((i) => i.id === base.pivotId);
  if (!pivot) return null;
  const k = kOf(inp.anchor.y);
  const frame: FitFrame = { anchor: inp.anchor, bearing: inp.bearing, k, pivot: pivot.pts[0] };
  const yC = pivot.pts[0].y, xC = pivot.pts[0].x;
  const click: MercXY = [inp.anchor.x, inp.anchor.y];
  const aimDeg = ((inp.bearing / D2R) % 360 + 360) % 360;
  const farHint: MercXY = inp.threat ? [inp.threat.x, inp.threat.y] : offsetPt(click[0], click[1], aimDeg, 1500);
  const homeHint = offsetPt(click[0], click[1], aimDeg + 180, 800);
  const opts = { purpose: 'hold' as const, month: inp.month ?? 1, threat: farHint, homeHint, snapM: 400 };
  mov.takePending?.();
  const r = readWater(mov, WR, click, opts);
  if (!r) {
    const pend = !!mov.takePending?.();
    return { nudges: {}, geom: {}, confirm: [], reading: null, pending: pend,
      rows: [pend ? { name: 'Canal', st: 'unchecked', reason: 'the ground at the click is still loading: rest the mouse there and it is read' }
        : { name: 'Canal', st: 'fail', reason: 'no canal or water within 400 m of the click: laid square to the aim, the canal not read', detail: { head: 'No canal at the click', why: 'The canal layout is laid along the obstacle the click is on; the bundle shows none within 400 m.', fix: ['Click on the canal in front of the Bn\'s centre', 'Take another layout (two up, three up) where there is no obstacle'] } }] };
  }
  const wv = r.width.v ?? worst(r.width, 'lo') ?? 60;
  const NOMINAL = 45;
  const homeEdge = Math.max(r.home.crestM ?? 0, wv / 2), farEdge = Math.max(r.far.crestM ?? 0, wv / 2);
  const xsAll = base.items.flatMap((i) => i.pts.map((p) => p.x - xC));
  const halfX = Math.max(Math.abs(Math.min(...xsAll)), Math.abs(Math.max(...xsAll))) + 600;
  const a = offsetPt(r.at[0], r.at[1], r.axisDeg + 180, halfX), b = offsetPt(r.at[0], r.at[1], r.axisDeg, halfX);
  const reach = readReach(mov, WR, a, b, opts);
  const path = reach && reach.path.length >= 2 ? reach.path : r.line && r.line.length >= 2 ? r.line : [a, b];
  const O = new ObstacleFrame(path, r.at, r.axisDeg, r.homeSign);
  // plan (x, y) to the world: y from the canal's centre (yC), the recipe's crest at 45 m moved to each bank's own
  const Wm = (p: XY): MercXY => { const n = p.y - yC; return O.world(p.x - xC, n < 0 ? n - (homeEdge - NOMINAL) : n > 0 ? n + (farEdge - NOMINAL) : 0); };
  const nudges: Record<string, XY> = {};
  for (const s of recipe.slots) {
    if (!s.seed) continue;
    const c: XY = { x: s.seed.acrossM, y: -s.seed.backM };
    const t = toL(frame, Wm(c));
    nudges[s.role] = { x: t.x - c.x, y: t.y - c.y };
  }
  const geom: CanalPrep['geom'] = {};
  for (const s of recipe.slots.filter((q) => q.shape && q.role !== recipe.pivot)) {
    const it = base.items.find((i) => i.role === s.role);
    if (!it) continue;
    const bend = (it.geo === 'Line' || it.geo === 'Area') && it.pts.length >= 2;
    const pts = bend ? densify(it.pts, 150, it.geo === 'Area' && !/^25290/.test(it.key)) : it.pts;
    geom[s.role] = { pts: pts.map((p) => toL(frame, Wm(p))) };
  }

  // rows: the canal (IC s85)
  const rows: Check[] = [];
  const confirm: string[] = [];
  const nm = r.name ? `${r.name} (${r.typeLabel}${r.annex ? `, Annex P ${r.annex}` : ''})` : `${r.typeLabel}${r.annex ? ` (Annex P ${r.annex})` : ''}`;
  rows.push({ name: 'Canal', st: r.width.src === 'none' ? 'warn' : 'pass', reason: `${nm}: ${figWord(r.width, 'm')} wide, ${figWord(r.depth, 'm')} deep; home bank ${figWord(r.home.aboveLand, 'm')} above the land, his bank ${figWord(r.far.aboveLand, 'm')}${r.shape ? `; ${r.shape === 'sunk' ? 'in-cut (a link canal, IC s85 para 3 a)' : r.shape === 'raised' ? 'in-filled (an irrigation canal, para 3 b)' : 'level'}` : ''}` });
  // which bank is higher: only a difference beyond both figures' ranges counts (estimates carry their error)
  const hLo = worst(r.home.aboveLand, 'lo'), hHi = worst(r.home.aboveLand, 'hi'), fLo = worst(r.far.aboveLand, 'lo'), fHi = worst(r.far.aboveLand, 'hi');
  const hl = r.home.aboveLand.v ?? hLo, fh = r.far.aboveLand.v ?? fHi;
  if (hLo === null || fHi === null || hl === null || fh === null) rows.push({ name: 'Higher bank', st: 'unchecked', reason: 'the bank heights are not recorded here: which bank is higher decides where the bulk goes (IC s85 para 10 b)' });
  else if (fLo !== null && hHi !== null && fLo > hHi + 0.5) rows.push({ name: 'Higher bank', st: 'warn', reason: `his bank ${figWord(r.far.aboveLand, 'm')} above the land, ours ${figWord(r.home.aboveLand, 'm')}: his is higher`, detail: { head: 'His bank is higher', why: 'Fire from the lower bank plunges and observation over his side is restricted (IC s85 para 3 d (7) p452); the bulk goes on the higher bank (para 10 b).', whyShort: 'plunging fire, observation restricted', fix: ['Raise the home bank 1-2 m astride his approaches (IC s85 para 3 c)', 'Site forward elements on his bank, their fall back planned (para 10 b)', 'OPs on his bank and on high ground behind'] } });
  else if (!(hLo > fHi + 0.5)) rows.push({ name: 'Higher bank', st: 'warn', reason: `banks equal within what the data tells (ours ${figWord(r.home.aboveLand, 'm')}, his ${figWord(r.far.aboveLand, 'm')} above the land): IC s85 para 10 b puts the bulk on the far bank when they are equal`, detail: { head: 'Banks of equal height', why: 'With equal banks observation to the front and flanks is restricted (para 3 d (7)); the pamphlet puts the bulk on the far bank (para 10 b).', fix: ['The commander decides forward, behind or astride (para 10 b): forward Coys on the far bank, falling back behind the canal', 'Raise the home bank 1-2 m astride his approaches (para 3 c)'] } });
  else rows.push({ name: 'Higher bank', st: 'pass', reason: `ours ${hl} m above the land, his ${fh} m: the bulk on the higher (home) bank (IC s85 para 10 b)` });
  const halfFront = Math.max(...base.items.filter((i) => recipe.slots.find((s) => s.role === i.role)?.kind === 'fwd').flatMap((i) => i.pts.map((p) => Math.abs(p.x - xC))), 1000) + 500;
  const inSector = r.crossings.filter((q) => Math.abs(q.alongM) <= halfFront);
  for (const q of inSector) confirm.push(`${q.label}${q.name ? ` ${q.name}` : ''}${q.load ? ` (${q.load})` : ''}, ${fmtM(q.distM)} ${q.dir}: a strong point on it or prepared for demolition; the guard and the order to blow`);
  rows.push(inSector.length ? { name: 'Bridges in sector', st: 'warn', reason: `${inSector.length} on the canal in front of the Bn: ${inSector.slice(0, 3).map((q) => `${q.label}${q.name ? ` ${q.name}` : ''}${q.load ? ` (${q.load})` : ''} ${fmtM(q.distM)} ${q.dir}`).join('; ')}`, detail: { head: `${inSector.length} crossings in the sector`, items: inSector.slice(0, 5).map((q) => `${q.label}${q.name ? ` ${q.name}` : ''}${q.load ? ` ${q.load}` : ''}: ${fmtM(q.distM)} ${q.dir}`), why: 'His approaches cross the canal here first (IC s85 para 3 d (9): Class 9/12 on tracks, 40/70 on main roads).', fix: ['A strong point on each, sited to cover it by fire', 'Each prepared for demolition, with its guard and the order to blow', 'Mines on his side of each (para 17 a)'] } }
    : { name: 'Bridges in sector', st: 'pass', reason: 'no bridge or ford on the canal in front of the Bn (his approaches must make their own crossing)' });
  const marshFar = r.far.marshM, marshHome = r.home.marshM;
  if (marshFar + marshHome > 0) rows.push({ name: 'Marsh', st: marshHome > marshFar ? 'warn' : 'pass', reason: `${Math.round(marshFar)} m of marsh on his side, ${Math.round(marshHome)} m on ours (IC s85 para 3 d (6): marshy approaches and exits)${marshHome > marshFar ? ': it hampers our own counter-attack routes more than his' : ': his approaches and exits bog'}` });
  const layer = one(doc, 'crossing.bridgeLayerMaxM', 24), wLo = worst(r.width, 'lo');
  if (wLo !== null) rows.push(wLo > layer ? { name: 'Obstacle value', st: 'pass', reason: `${Math.round(wLo)} m: wider than bridge-layer tanks span in a rush (${layer} m, IBB S47 para 5 p242; ditches of 24 m or more are effective AT obstacles: IC s85 para 4 l)` }
    : { name: 'Obstacle value', st: 'warn', reason: `${Math.round(wLo)} m: bridge-layer tanks can span it in a rush (${layer} m)`, detail: { head: `Only ${Math.round(wLo)} m wide`, why: 'Narrower than the gap his bridge-layer tanks close (IBB S47 para 5 p242).', fix: ['Widen or deepen it; mines on his side and in it', 'AT weapons sited to cover it (IC s85 para 16)'] } });
  confirm.push('Liaison with the Irrigation Department before digging into the banks (IC s85 para 18 a)', 'The forward elements\' fall back across the canal: routes and timings (IC s85 para 10 b)');
  const lineOut = path.filter((p) => Math.abs(chainOf(O.path, p) - O.s0) <= halfX + 200);
  return {
    nudges, geom, rows, confirm, pending: r.pending || !!mov.takePending?.(),
    reading: { obstacle: { name: r.name, typeLabel: r.typeLabel, annex: r.annex, widthM: worst(r.width, 'hi'), line: lineOut.length >= 2 ? lineOut : path }, observers: [], entries: [], crossings: inSector.map((q) => ({ x: q.x, y: q.y, label: `${q.label}${q.name ? ` ${q.name}` : ''}` })), bridges: [], places: [], bh: null, times: [] },
  };
}

// ── his minefield ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The recipe with his minefield assumed in front of the obstacle (IBB S47 para 6 p243: 900-1000 m of mixed mines,
 * wire by the water; IC s70 para 2 p355): everything on the home side behind the water line drawn back behind it (the
 * FUPs are short of the minefield, the assault goes through it in file: IC s70 para 4b p356), his minefield and wire
 * (hostile), and a Breach lane through it to each assault crossing place (IBB Annex Q para 4: a 108 x 7.2 m lane an
 * engineer platoon). Its id gains `-mf`; the recipe passed in is not changed.
 */
export function withMinefield(r: Recipe, doc: DoctrineSet): Recipe {
  const mf = fig(doc, 'crossing.enemyMinefieldM', [900, 1000]);
  const D = Math.round((mf[0] + mf[1]) / 2), shift = D + 60;
  const back = (b: number) => (b > 40 ? b + shift : b);
  const sh = (p: [number, number]): [number, number] => [p[0], back(p[1])];
  const slots = r.slots.map((s) => {
    if (!s.shape) return s;
    const x = JSON.parse(JSON.stringify(s));
    const S = x.shape;
    if (S.at) S.at = sh(S.at);
    if (S.pts) S.pts = S.pts.map(sh);
    if (S.base) S.base = S.base.map(sh);
    if (S.ctrl) S.ctrl = sh(S.ctrl);
    if (S.rect) S.rect.backM = back(S.rect.backM);
    return x;
  });
  const sl = r.slots.find((s) => s.role === 'sl')?.shape?.pts ?? [[-500, 12], [500, 12]];
  const x0 = Math.min(...sl.map((p) => p[0])), x1 = Math.max(...sl.map((p) => p[0]));
  slots.push(
    { role: 'enMf', kind: 'obstacle', sym: '25270706', label: 'En MF', order: 1, hostile: true, shape: { rect: { acrossM: (x0 + x1) / 2, backM: 45 + D / 2, wM: x1 - x0 + 400, hM: D } } },
    { role: 'enWire', kind: 'obstacle', sym: '25290307', label: '', order: 1, hostile: true, shape: { pts: [[x0 - 200, 38], [x1 + 200, 38]] } },
  );
  for (const s of r.slots.filter((q) => q.sym === '25271300' && q.shape?.base)) {
    const x = (s.shape!.base![0][0] + s.shape!.base![1][0]) / 2;
    slots.push({ role: `lane${s.role[0].toUpperCase()}${s.role.slice(1)}`, kind: 'line', sym: '25340200', label: '', order: 2, shape: { base: [[x - 15, 45 + D + 20], [x + 15, 45 + D + 20]], ctrl: [x, 45] } });
  }
  return { ...r, id: `${r.id}-mf`, name: `${r.name}, his minefield`, slots, note: `${r.note ?? ''} His minefield assumed (IBB S47 para 6 p243: ${mf[0]}-${mf[1]} m deep, wire by the water): the home side drawn back behind it, a Breach lane through it to each assault crossing place (Annex Q para 4).` };
}

// ── one layout fitted at one spot ────────────────────────────────────────────────────────────────────────────────────

/**
 * A crossing fitted where it rests (PlanFit.fitLayout hands it over): the click is H on the water, the aim points at the
 * far bank. Without the Movement Guide reader or the water rules the geometry stands, its ground rows grey.
 */
export function fitCrossing(inp: FitLayoutInput): FittedLayout | null {
  const { recipe, ctx, ground } = inp;
  const k = kOf(inp.anchor.y);
  const base = solveRecipe(recipe, ctx, inp.opts);
  const pivot = base.items.find((i) => i.id === base.pivotId);
  if (!pivot) return null;
  const frame: FitFrame = { anchor: inp.anchor, bearing: inp.bearing, k, pivot: pivot.pts[0] };
  inp.begin?.();
  const mov = (ground.mov?.() ?? null) as CrossProbe | null;
  const WR = (inp.waterRules ?? null) as WaterRules | null;
  const read = mov && WR ? readCrossing({ recipe, doc: ctx.doc, frame, mov, WR, inp, base, ground }) : null;
  const raw = read && Object.keys(read.geom).length ? solveRecipe(recipe, ctx, { ...inp.opts, geom: read.geom }) : base;
  const rows = read ? read.rows : base.rows;
  const fails = rows.filter((r) => r.st === 'fail').length, warns = rows.filter((r) => r.st === 'warn').length;
  const fit: FitResult = {
    nudges: {}, slides: [], killingGr: null, slots: {}, rows, approaches: [],
    score: read ? read.score : 0, fails, warns,
    pending: (read?.pending ?? false) || ground.pending(), data: ground.dataLine(),
    from: null, fromAssumed: true, crossing: read?.reading ?? undefined,
  };
  const res: SolveResult = {
    ...raw, mode: read ? 'terrain' : 'geometry', rows, slots: [],
    confirm: read ? [...read.confirm, ...base.confirm.filter((x) => !read.confirm.includes(x))] : base.confirm,
    assumptions: read ? [`Fitted to the ground: ${fit.data}.`, 'The home bank is secure: the water line is the start line (IBB S46 para 8 f p234).', `Times from IBB Annex Q ${LIGHT_WORD[inp.light ?? 'dark']}; engineers start at H.`] : base.assumptions,
  };
  return { recipe, res, raw, fit, frame, anchor: inp.anchor, bearing: inp.bearing, manual: {}, terrain: null, enemy: null, unit: null };
}

/** Check my plan for a crossing built here: the plan as drawn read with the same rows (no site search, no reach-out). */
export interface CrossCheck { rows: Check[]; confirm: string[]; crossing?: CrossingReading; pending: boolean; read: string[]; missing: string[] }
export function checkCrossing(inp: FitLayoutInput, drawn: CrossDrawn): CrossCheck | null {
  const { recipe, ctx, ground } = inp;
  const base = solveRecipe(recipe, ctx, inp.opts);
  const pivot = base.items.find((i) => i.id === base.pivotId);
  if (!pivot) return null;
  const frame: FitFrame = { anchor: inp.anchor, bearing: inp.bearing, k: kOf(inp.anchor.y), pivot: pivot.pts[0] };
  inp.begin?.();
  const mov = (ground.mov?.() ?? null) as CrossProbe | null;
  const WR = (inp.waterRules ?? null) as WaterRules | null;
  if (!mov || !WR) return null;
  const read = readCrossing({ recipe, doc: ctx.doc, frame, mov, WR, inp, base, ground, drawn });
  const names = (r: string) => recipe.slots.find((s) => s.role === r)?.label || r;
  const need = ['xTgt', ...recipe.slots.filter((s) => s.sym === '25271300' || s.sym === '25271400' || s.role === 'bh' || s.role === 'obj2' || s.role === 'ph1').map((s) => s.role)];
  return { rows: read.rows, confirm: read.confirm, crossing: read.reading ?? undefined, pending: read.pending || ground.pending(), read: Object.keys(drawn).map(names), missing: need.filter((r) => !drawn[r]).map(names) };
}

/** For the Node checks. */
export const _test = { readCrossing, densify, chainOf };
export type { WaterReading, PlanItem };
