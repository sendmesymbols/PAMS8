/**
 * PlanRevSlope -- a reverse slope defence laid on the ground (IC s78 pp 429-431; IBB s69 pp 357-359).
 *
 * The rule as written: the posns sit on the part of the feature masked by a crest from En direct fire and ground
 * observation; a successful reverse slope defence depends on control of the crest by fire or by occupation; the forward
 * platoons are within effective small arms range of the crest (IC p 430 b); observation and protective elements (two men
 * to a rifle section, from the depth platoon) on or just forward of the topographical crest (p 430 a); the depth platoon
 * on the crest of the next high ground to the rear within supporting range (p 430 b); anti-tank weapons in the depth
 * platoon area (p 431 b); final protective fires along the crest, or nearer the FDLs when these are as much as 500 m
 * behind it (p 431 d).
 *
 * Pure: plan metres (x across, y toward the enemy) through the FitFrame onto the ground (PlanGround: 30 m elevation,
 * going, sight). The finder reads the crest in front of the forward posns, moves the whole plan so the FDL lies behind
 * it within MG range, puts the OPs and the FPF on the crest and the depth posn on the next high ground to the rear, and
 * judges each step in a row. Without elevation the crest is not found and the rows say so (never pass).
 */
import type { DoctrineSet } from './PlanRecipes';
import { doctrineAt, resolveRange } from './PlanRecipes';
import type { Check, SolveResult, XY } from './PlanSolve';
import type { FitFrame, PlanGround } from './PlanFit';
import { toWorld } from './PlanFit';

export interface RevSlopeFind {
  /** Plan-metre moves by role: the whole plan back behind the crest; the depth posn onto the next high ground. */
  nudges: Record<string, XY>;
  /** The crest line, the OPs on it and the FPF targets, laid afresh (plan metres). */
  geom: Record<string, { pts: XY[]; label?: string }>;
  rows: Check[];
  confirm: string[];
  /** The crest in plan metres (left to right), or null when none is found. */
  crest: XY[] | null;
  /** How far the FDL (the forward posns' front edge) ends up behind the crest, m; null without a crest. */
  fdlBehindM: number | null;
  /** Elevation gained from the forward posns to the crest, m. */
  crestRiseM: number | null;
}

const P = (x: number, y: number): XY => ({ x, y });
const num = (doc: DoctrineSet, path: string, fb: number) => { const r = resolveRange(doc, doctrineAt(doc, path)); return r ? (r[0] + r[1]) / 2 : fb; };
const rng = (doc: DoctrineSet, path: string, fb: [number, number]) => resolveRange(doc, doctrineAt(doc, path)) ?? fb;
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
const ext = (pts: XY[]) => ({ x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) });
const centre = (pts: XY[]): XY => P(pts.reduce((a, p) => a + p.x, 0) / pts.length, pts.reduce((a, p) => a + p.y, 0) / pts.length);

/** The elevation along a plan-metre line x = const from y0 to y1 (step m), world through the frame; NaN where unknown. */
function profile(f: FitFrame, g: PlanGround, x: number, y0: number, y1: number, step: number): { y: number; e: number }[] {
  const out: { y: number; e: number }[] = [];
  const dir = y1 >= y0 ? 1 : -1;
  for (let y = y0; dir > 0 ? y <= y1 : y >= y1; y += dir * step) { const w = toWorld(f, P(x, y)); out.push({ y, e: g.elev(w.x, w.y) }); }
  return out;
}

/**
 * The topographical crest ahead on one profile: the highest point at least `gain` above the start whose ground falls
 * by `gain` or more within `fall` m beyond it (the far slope). Null when the ground does not rise and fall.
 */
export function crestOnProfile(prof: { y: number; e: number }[], gain: number, fall: number): { y: number; e: number; rise: number } | null {
  const known = prof.filter((p) => Number.isFinite(p.e));
  if (known.length < 5) return null;
  const e0 = known[0].e;
  let best: { y: number; e: number; rise: number } | null = null;
  for (let i = 1; i < known.length; i++) {
    const p = known[i];
    if (p.e - e0 < gain) continue;
    const beyond = known.filter((q) => q.y > p.y && q.y <= p.y + fall);
    if (!beyond.length || Math.min(...beyond.map((q) => q.e)) > p.e - gain) continue;
    if (!best || p.e > best.e) best = { y: p.y, e: p.e, rise: p.e - e0 };
  }
  return best;
}

/** The nearest local high point behind (y decreasing) that stands `gain` above the start, or null. */
function highGroundBehind(prof: { y: number; e: number }[], gain: number): { y: number; e: number; rise: number } | null {
  const known = prof.filter((p) => Number.isFinite(p.e));
  if (known.length < 5) return null;
  const e0 = known[0].e;
  for (let i = 1; i + 1 < known.length; i++) {
    const p = known[i];
    if (p.e - e0 >= gain && p.e >= known[i - 1].e && p.e >= known[i + 1].e) return { y: p.y, e: p.e, rise: p.e - e0 };
  }
  return null;
}

export function findReverseSlope(res: SolveResult, f: FitFrame, g: PlanGround, doc: DoctrineSet): RevSlopeFind {
  const out: RevSlopeFind = { nudges: {}, geom: {}, rows: [], confirm: [], crest: null, fdlBehindM: null, crestRiseM: null };
  const kindOf = (role: string) => res.recipe.slots.find((s) => s.role === role)?.kind;
  const fwd = res.items.filter((i) => kindOf(i.role) === 'fwd' && i.pts.length >= 3);
  const depth = res.items.filter((i) => (kindOf(i.role) === 'depth' || kindOf(i.role) === 'res') && i.pts.length >= 3);
  if (!fwd.length) return out;
  const step = num(doc, 'revSlope.sampleStepM', 30), ahead = num(doc, 'revSlope.crestSearchAheadM', 1500), gain = num(doc, 'revSlope.crestGainM', 8), fall = num(doc, 'revSlope.farSlopeM', 300);
  const behind = rng(doc, 'revSlope.behindCrestM', [150, 457]), fdlWarn = num(doc, 'revSlope.fdlBehindCrestWarnM', 500);
  const boxes = fwd.map((i) => ({ it: i, e: ext(i.pts), c: centre(i.pts) }));
  const front = Math.max(...boxes.map((b) => b.e.y1));
  const probe = (x: number) => profile(f, g, x, front - 100, front + ahead, step);
  const noData = boxes.every((b) => probe(b.c.x).filter((p) => Number.isFinite(p.e)).length < 5);
  if (noData) {
    out.rows.push({ name: 'Crest', st: 'unchecked', reason: 'no elevation here: the crest in front cannot be read (a reverse slope needs one)' });
    return out;
  }
  // the crest ahead at each posn's centre line and at the plan's edges
  const xs = [Math.min(...boxes.map((b) => b.e.x0)), ...boxes.map((b) => b.c.x), Math.max(...boxes.map((b) => b.e.x1))];
  const crests = xs.map((x) => ({ x, c: crestOnProfile(probe(x), gain, fall) }));
  const found = crests.filter((c) => c.c);
  if (found.length < 2 || !boxes.some((b) => crests.find((c) => c.x === b.c.x)?.c)) {
    out.rows.push({ name: 'Crest', st: 'fail', reason: `no crest within ${fmtM(ahead)} in front of the forward posns (ground rising ${gain} m and falling beyond it)`,
      detail: { head: 'No crest in front', why: 'A reverse slope defence is organised on the part of a feature masked by a crest from En direct fire and ground observation (IC s78 para 1 p 429); flat ground has none.', fix: ['Take a forward-slope layout (two up) here', 'Move the plan behind a ridge, bund or dune line'] } });
    return out;
  }
  const yCrest = found.reduce((a, c) => a + c.c!.y, 0) / found.length;
  const rise = found.reduce((a, c) => a + c.c!.rise, 0) / found.length;
  out.crest = crests.map((c) => P(c.x, c.c ? c.c.y : yCrest));
  out.crestRiseM = Math.round(rise);
  // the whole plan moves so the FDL lies behind the crest, as near as the band allows (within MG range: IC p 430 b)
  const want = Math.min(behind[1], Math.max(behind[0], yCrest - front));
  const dy = (yCrest - want) - front;
  if (Math.abs(dy) > 10) for (const it of res.items) if (!/^(crest|crestOp|fpf|lp|stdPtl|dfTgt)/.test(it.role)) out.nudges[it.role] = P(0, dy);
  const fdlBehind = yCrest - (front + dy);
  out.fdlBehindM = Math.round(fdlBehind);
  const mg = behind[1];
  out.rows.push({ name: 'Crest', st: 'pass', reason: `a crest ${fmtM(yCrest - front - dy)} in front, ${Math.round(rise)} m above the forward posns (30 m elevation)` });
  out.rows.push(fdlBehind <= mg + 1 && fdlBehind >= behind[0] - 1
    ? { name: 'Behind the crest', st: 'pass', reason: `the FDL ${fmtM(fdlBehind)} behind the crest: within effective small arms range of it (${fmtM(mg)}, MG1A3) (IC s78 para 3 b p 430)` }
    : { name: 'Behind the crest', st: 'warn', reason: `the FDL ${fmtM(fdlBehind)} behind the crest; the forward platoons must be within effective small arms range of it (${fmtM(mg)}) (IC s78 para 3 b p 430)`,
      detail: { head: `FDL ${fmtM(fdlBehind)} behind the crest`, why: fdlBehind > mg ? 'Beyond MG range the crest cannot be swept by fire from the posns: the En takes it and attacks downhill (IC s78 para 2 b).' : 'Too close to the crest the posns are seen over it.', fix: fdlBehind > mg ? ['Move the posns up toward the crest', 'Hold the crest by occupation at night (IBB s69 para 3 a (2) p 358)'] : ['Move the posns back down the slope'] } });
  // fields of fire on a reverse slope run from the FDL to the crest: the short range is the price of being hidden
  // (IC s78 para 2 b: the restricted range of direct fire weapons), the ground beyond is watched and fired on by OPs and DF
  out.rows.push(fdlBehind <= mg + 1
    ? { name: 'Fields of fire', st: 'pass', reason: `a reverse slope: ${fmtM(fdlBehind)} from the FDL to the crest, swept by the MG arcs as the En crosses it (IC s78 para 4 a p 431); the ground beyond the crest is the price of being hidden (para 2 b: restricted range of direct fire weapons), watched by the OPs on the crest and under DF on the forward slope` }
    : { name: 'Fields of fire', st: 'warn', reason: `a reverse slope: ${fmtM(fdlBehind)} from the FDL to the crest, beyond effective small arms range (${fmtM(mg)}): the crest cannot be swept (IC s78 para 3 b p 430)`,
      detail: { head: `${fmtM(fdlBehind)} to the crest`, why: 'The fields of fire on a reverse slope end at the crest; beyond MG range the En crosses it unhit and attacks downhill.', fix: ['Move the posns up toward the crest', 'Hold the crest by occupation at night (IBB s69 para 3 a (2) p 358)'] } });
  if (fdlBehind > fdlWarn) out.rows.push({ name: 'FPF', st: 'warn', reason: `the FDL is ${fmtM(fdlBehind)} behind the crest: with as much as ${fmtM(fdlWarn)} the FPF goes nearer the FDLs than the crest, targets on both sides of it (IC s78 para 4 d p 431)` });
  else out.rows.push({ name: 'FPF', st: 'pass', reason: 'final protective fires along the topographical crest, to deny it to the En (IC s78 para 4 d p 431)' });
  // hidden from the En side: seen from 1500 m beyond the crest at the En observer's eye
  if (g.sight) {
    const hisEye = num(doc, 'revSlope.hisEyeM', 2), tall = num(doc, 'revSlope.posnTallM', 1.7), maxSeen = num(doc, 'revSlope.seenMaxPct', 20);
    let n = 0, seen = 0, unknown = 0;
    for (const b of boxes) {
      const from = toWorld(f, P(b.c.x, yCrest + ahead));
      for (const p of [P(b.c.x, b.c.y + dy), P(b.e.x0 + 50, b.c.y + dy), P(b.e.x1 - 50, b.c.y + dy)]) {
        const w = toWorld(f, p); const v = g.sight(from.x, from.y, hisEye, w.x, w.y, tall);
        if (v === null) unknown++; else { n++; if (v >= 0.5) seen++; }
      }
    }
    const pct = n ? Math.round((100 * seen) / n) : 0;
    out.rows.push(!n || unknown > n ? { name: 'Hidden from the En side', st: 'unchecked', reason: 'the ground beyond the crest is still loading' }
      : { name: 'Hidden from the En side', st: pct <= maxSeen ? 'pass' : 'warn', reason: `${pct} % of the forward posns seen from ${fmtM(ahead)} beyond the crest (wants ${maxSeen} % or less)`,
        detail: pct <= maxSeen ? undefined : { head: `${pct} % seen over the crest`, why: 'The crest does not mask these posns from En ground observation and direct fire: the reverse slope gives little here.', fix: ['Move the posns further down the reverse slope', 'A different feature: the crest must be higher than the posns by more'] } });
  }
  // the depth posn on the next high ground to the rear
  for (const d of depth) {
    const c = centre(d.pts);
    const back = profile(f, g, c.x, c.y + dy, c.y + dy - num(doc, 'revSlope.depthSearchBackM', 1200), step);
    const hg = highGroundBehind(back, gain);
    if (hg) {
      out.nudges[d.role] = P(0, (out.nudges[d.role]?.y ?? 0) + (hg.y - (c.y + dy)));
      out.rows.push({ name: `${d.label} on high ground`, st: 'pass', reason: `moved ${fmtM(Math.abs(hg.y - (c.y + dy)))} back onto the next high ground, ${Math.round(hg.rise)} m higher: the depth posn there supports the forward platoons and sites the anti-tank weapons (IC s78 paras 3 b, 4 b pp 430-431)` });
    } else out.rows.push({ name: `${d.label} on high ground`, st: 'warn', reason: `no high ground within ${fmtM(num(doc, 'revSlope.depthSearchBackM', 1200))} behind for the depth posn (IC s78 para 3 b p 430: desirable on the crest of the next high ground to the rear)` });
  }
  // the crest line, the OPs and the FPF targets on it
  const left = Math.min(...boxes.map((b) => b.e.x0)), right = Math.max(...boxes.map((b) => b.e.x1));
  out.geom.crest = { pts: out.crest.filter((p) => p.x >= left - 1 && p.x <= right + 1) };
  if (out.geom.crest.pts.length < 2) out.geom.crest = { pts: [P(left, yCrest), P(right, yCrest)] };
  boxes.forEach((b, i) => {
    const cy = crests.find((c) => c.x === b.c.x)?.c?.y ?? yCrest;
    out.geom[`crestOp${i + 1}`] = { pts: [P(b.c.x, cy + 20)], label: 'OP' };
    out.geom[`fpf${i + 1}`] = { pts: [P(b.c.x, fdlBehind > fdlWarn ? b.c.y + dy + (b.e.y1 - b.e.y0) / 2 + 150 : cy)] };
  });
  out.rows.push({ name: 'Crest held', st: 'pass', reason: `${boxes.length} OP${boxes.length > 1 ? 's' : ''} on the crest by day (two men to a section, from the depth platoon, with the FOO); the crest occupied in strength by night (IC s78 para 3 a p 430; IBB s69 para 3 a p 358)` });
  out.confirm.push('The crest: OPs and protective patrols by day with the FOO / MFC; held in strength by infantry at night (IBB s69 para 3 a p 358)', 'Dummy posns on the forward slope for deception (IC s78 para 2 a)', 'Anti-tank weapons in the depth posn area with fields of fire onto the crest (IC s78 para 4 b p 431)', 'MG arcs between the FDLs and the crest, surprise fire as the En crosses it (IC s78 para 4 a p 431)');
  return out;
}
