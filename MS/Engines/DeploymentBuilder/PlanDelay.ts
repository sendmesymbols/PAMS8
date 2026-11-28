/**
 * PlanDelay -- two layouts of the withdrawal family (PlanWithdrawal) that the books treat apart from the night withdrawal:
 *
 * The delaying action (layout `delay`; MIB s28 pp 231-246; OOW3 s6 pp 28-35): a force trades space for time, inflicting
 * maximum destruction and avoiding decisive engagement (OOW3 p 28). The Bn delays on successive posns, its normal method
 * on the wide frontages of a delay (MIB p 233); on each posn all Coys forward, a small reserve that checks penetrations and
 * covers the rearward move, the gaps covered by patrols, OPs and LPs (MIB pp 238-239); successive posns far enough apart
 * that the En must regroup and redeploy his close support weapons, more in open ground (MIB pp 237-238); the echelons behind
 * the next delaying posn (MIB p 239); phase lines with a stated time (MIB p 238); the higher Comd says how long the En is to
 * be held forward of a line (OOW3 p 29).
 *
 * The withdrawal by day (layout `by-day`; OOW3 s8 pp 40-43; MIB s27 para 16 p 223): normally avoided unless the weather
 * favours it or the roads demand it, never lightly under En air superiority (OOW3 pp 15, 40); the sequence reversed: the
 * forward Coys go back through the depth Coys, which cover them, leap-frogging until a clean break; no assembly areas, the
 * units straight back into columns (OOW3 p 41; MIB p 223); air cover, smoke, deception, fire support, passage lanes,
 * contact points and phase lines (OOW3 pp 42-43).
 *
 * Pure: plan metres, y back along the aim (the way of withdrawal), the enemy at -y.
 */
import type { DoctrineSet, Recipe } from './PlanRecipes';
import { doctrineAt, resolveRange } from './PlanRecipes';
import type { Check, XY } from './PlanSolve';

const P = (x: number, y: number): XY => ({ x, y });
const num = (doc: DoctrineSet, path: string, fb: number) => { const r = resolveRange(doc, doctrineAt(doc, path)); return r ? (r[0] + r[1]) / 2 : fb; };
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
const rect = (c: XY, w: number, h: number): XY[] => [P(c.x - w / 2, c.y + h / 2), P(c.x + w / 2, c.y + h / 2), P(c.x + w / 2, c.y - h / 2), P(c.x - w / 2, c.y - h / 2)];
type Item = { role: string; label?: string; pts: XY[] };

/** A slot's rect size from the recipe (doctrine refs resolved), else the fallback. */
function sizeOf(doc: DoctrineSet, recipe: Recipe, role: string, fw: number, fh: number): [number, number] {
  const r = (recipe.slots.find((s) => s.role === role)?.shape as any)?.rect;
  const w = r ? resolveRange(doc, r.wM) : null, h = r ? resolveRange(doc, r.hM) : null;
  return [w ? (w[0] + w[1]) / 2 : fw, h ? (h[0] + h[1]) / 2 : fh];
}

/**
 * The delay at the aim: the last delaying posn (DP 3) at the aimed distance, DP 2 half way, the echelons behind DP 2
 * (MIB p 239 d) and a phase line on DP 2's front edge. Without an aim the posns stand one spacing apart (withdrawal.delay).
 */
export function delayGeom(recipe: Recipe, doc: DoctrineSet, aimM: number | null): Record<string, { pts: XY[] }> {
  const s = num(doc, 'withdrawal.delay.spacingM', 4200);
  const d = Math.max(3000, aimM ?? num(doc, 'withdrawal.delay.defaultAimM', 2 * s + 1500));
  const g: Record<string, { pts: XY[] }> = {};
  const [w2, h2] = sizeOf(doc, recipe, 'dp2', 6000, 1500);
  const [w3, h3] = sizeOf(doc, recipe, 'dp3', 6000, 1500);
  const y3 = d, y2 = d / 2;
  if (recipe.slots.some((x) => x.role === 'dp2')) g.dp2 = { pts: rect(P(0, y2), w2, h2) };
  if (recipe.slots.some((x) => x.role === 'dp3')) g.dp3 = { pts: rect(P(0, y3), w3, h3) };
  if (recipe.slots.some((x) => x.role === 'ech')) { const [we, he] = sizeOf(doc, recipe, 'ech', 400, 400); g.ech = { pts: rect(P(0, y2 + h2 / 2 + num(doc, 'withdrawal.delay.echBehindM', 1000) + he / 2), we, he) }; }
  if (recipe.slots.some((x) => x.role === 'pl2')) g.pl2 = { pts: [P(-w2 / 2 - 500, y2 - h2 / 2), P(w2 / 2 + 500, y2 - h2 / 2)] };
  // each Coy's route back: from its posn (the route's first point in the recipe) square back to DP 2's front edge
  for (const s2 of recipe.slots) {
    const pts = (s2.shape as any)?.pts as [number, number][] | undefined;
    if (!/^rt[A-Z]$/.test(s2.role) || !pts?.length) continue;
    const a = P(pts[0][0], -pts[0][1]);
    g[s2.role] = { pts: [a, P(a.x, y2 - h2 / 2)] };
  }
  return g;
}

/**
 * The delay read on the ground: long range observation from each delaying posn toward the En (MIB p 237 b (1)) and water
 * in front of it (b (3)). `sight(from, to)` is the chance a 2 m target is seen from 2 m (null: not read), `cls` the class.
 */
export function delayGroundRows(items: Item[], recipe: Recipe, doc: DoctrineSet, sight: ((a: XY, b: XY) => number | null) | null, cls: (p: XY) => number | null, water: Set<number>): Check[] {
  const rows: Check[] = [];
  const kindOf = (role: string) => recipe.slots.find((x) => x.role === role)?.kind;
  const fwd = items.filter((i) => kindOf(i.role) === 'fwd' && i.pts.length >= 3);
  if (!fwd.length) return rows;
  const xs = (pts: XY[]) => pts.map((p) => p.x);
  const dps: { label: string; x0: number; x1: number; y: number }[] = [
    { label: 'DP 1', x0: Math.min(...fwd.flatMap((i) => xs(i.pts))), x1: Math.max(...fwd.flatMap((i) => xs(i.pts))), y: Math.min(...fwd.flatMap((i) => i.pts.map((p) => p.y))) },
    ...['dp2', 'dp3'].map((r) => items.find((i) => i.role === r && i.pts.length >= 3)).filter((x): x is Item => !!x)
      .map((x) => ({ label: x.label ?? x.role, x0: Math.min(...xs(x.pts)), x1: Math.max(...xs(x.pts)), y: Math.min(...x.pts.map((p) => p.y)) })),
  ];
  const viewM = num(doc, 'withdrawal.delay.viewM', 3000), viewPct = num(doc, 'withdrawal.delay.viewPct', 50);
  if (sight) {
    const parts: string[] = [];
    let low = 0, unread = 0;
    for (const d of dps) {
      let n = 0, seen = 0;
      for (const fx of [0.2, 0.5, 0.8]) {
        const from = P(d.x0 + (d.x1 - d.x0) * fx, d.y);
        for (let r = 500; r <= viewM; r += 250) { const v = sight(from, P(from.x, d.y - r)); if (v === null) unread++; else { n++; if (v >= 0.5) seen++; } }
      }
      if (!n) continue;
      const pct = Math.round((100 * seen) / n);
      if (pct < viewPct) low++;
      parts.push(`${d.label} ${pct} %`);
    }
    rows.push(!parts.length ? { name: 'Long range obsn', st: 'unchecked', reason: unread ? 'the ground in front is still loading' : 'no sight read' }
      : { name: 'Long range obsn', st: low ? 'warn' : 'pass', reason: `${parts.join(', ')} of the ground 0.5-${fmtM(viewM)} in front seen (wants ${viewPct} %, E): a delaying posn wants long range observation and fire so the En is engaged and made to deploy from the maximum ranges (MIB p 237 b (1); OOW3 p 29 para 4)`,
        detail: low ? { head: `${low} delaying posn${low > 1 ? 's' : ''} with a short view`, why: 'The delay works by making the En deploy early and often; a posn that sees little in front is attacked before it has imposed any delay (OOW3 p 29 paras 3-4).', fix: ['Move it onto the next lateral ridge across the En axis (MIB p 237 b (4))', 'OPs forward of it to see what it cannot'] } : undefined });
  }
  // water across the front, within the view: an obstacle to the front (MIB p 237 b (3))
  const words: string[] = [];
  let none = 0, known = 0;
  for (const d of dps) {
    let at: number | null = null, any = false;
    for (const fx of [0.2, 0.5, 0.8]) {
      const x = d.x0 + (d.x1 - d.x0) * fx;
      for (let r = 0; r <= viewM; r += 15) { const k = cls(P(x, d.y - r)); if (k === null) continue; any = true; if (water.has(k)) { if (at === null || r < at) at = r; break; } }
    }
    if (!any) continue;
    known++;
    if (at === null) none++;
    words.push(at === null ? `${d.label}: none within ${fmtM(viewM)}` : `${d.label}: water ${fmtM(at)} in front`);
  }
  if (known) rows.push({ name: 'Obstacles in front', st: none ? 'warn' : 'pass', reason: `${words.join('; ')}: a delaying posn wants obstacles to its front and flanks (MIB p 237 b (3)); natural and artificial obstacles add to the delaying power (OOW3 p 29 para 4)${none ? '; mines and demolitions where the ground gives none' : ''}` });
  return rows;
}

/** The delay's rows: the posns' spacing, all Coys forward, the gaps, the reserve, the echelons, the time. */
export function delayRows(items: Item[], recipe: Recipe, doc: DoctrineSet): { rows: Check[]; confirm: string[] } {
  const rows: Check[] = [];
  const kindOf = (role: string) => recipe.slots.find((x) => x.role === role)?.kind;
  const fwd = items.filter((i) => kindOf(i.role) === 'fwd' && i.pts.length >= 3);
  const item = (role: string) => items.find((i) => i.role === role && i.pts.length);
  if (!fwd.length) return { rows, confirm: [] };
  const front = (pts: XY[]) => Math.min(...pts.map((p) => p.y)), rear = (pts: XY[]) => Math.max(...pts.map((p) => p.y));
  const frontY = Math.min(...fwd.map((i) => front(i.pts)));
  const s = num(doc, 'withdrawal.delay.spacingM', 4200);
  const src = 'the En 81 mm Mor, ORBAT weapons.json en-81-mm-mor';
  // successive posns: far enough apart that the En must regroup and redeploy his close support weapons (MIB pp 237-238)
  const dps = [['DP 1 (the Coys)', frontY], ...['dp2', 'dp3'].map((r) => item(r)).filter((x): x is Item => !!x).map((x) => [x.label ?? x.role, front(x.pts)] as [string, number])] as [string, number][];
  const hops = dps.slice(1).map(([lab, y], i) => ({ from: dps[i][0], to: lab, m: y - dps[i][1] }));
  if (hops.length) {
    const short = hops.filter((h) => h.m < s - 1);
    rows.push(short.length
      ? { name: 'Delay posns', st: 'warn', reason: `${hops.map((h) => `${h.from} to ${h.to} ${fmtM(h.m)}`).join('; ')}: ${short.length > 1 ? 'hops' : 'a hop'} under ${fmtM(s)} (${src}): the En need not redeploy his close support weapons (MIB pp 237-238)`,
        detail: { head: `${short.length} hop${short.length > 1 ? 's' : ''} short of ${fmtM(s)}`, why: 'Successive delaying posns should be far enough apart to force the En to regroup and redeploy his close support weapons; open ground needs more than close (MIB s28 para 12 c pp 237-238).', fix: [`Put the next posn ${fmtM(s)} or more back (the aim sets the last one)`, 'In close country a shorter hop may serve: say why'] } }
      : { name: 'Delay posns', st: 'pass', reason: `${hops.map((h) => `${h.from} to ${h.to} ${fmtM(h.m)}`).join('; ')}: each hop forces the En to regroup and redeploy his close support weapons (${fmtM(s)}: ${src}; MIB pp 237-238; more in open ground)` });
  }
  // all Coys forward, a small reserve (MIB p 238 para 13 a)
  const res = items.filter((i) => kindOf(i.role) === 'res' && i.pts.length >= 3), depth = items.filter((i) => kindOf(i.role) === 'depth' && i.pts.length >= 3);
  const xs = fwd.flatMap((i) => i.pts.map((p) => p.x));
  const width = Math.max(...xs) - Math.min(...xs);
  rows.push({ name: 'Coys forward', st: fwd.length >= 3 && depth.length === 0 && res.length <= 1 ? 'pass' : 'warn', reason: `${fwd.length} Coys forward on ${fmtM(width)}, ${res.length} in reserve${depth.length ? `, ${depth.length} in depth` : ''}: on the wide frontage of a delay the Bn deploys all Coys forward with a small reserve, a shallow posn (MIB s28 para 13 a-b pp 238-239)` });
  // the gaps: patrols, OPs and LPs (MIB p 239 para 13 a)
  const ops = items.filter((i) => /^op/i.test(i.role) && i.pts.length);
  rows.push({ name: 'Gaps covered', st: ops.length >= fwd.length - 1 ? 'pass' : 'warn', reason: `${ops.length} OP / patrol point${ops.length === 1 ? '' : 's'} for ${Math.max(0, fwd.length - 1)} gap${fwd.length - 1 === 1 ? '' : 's'} between the Coys: the gaps are covered by patrols, OPs, LPs and fire (MIB p 239)` });
  // the reserve: checks penetrations, covers the rearward move; an assembly area or a C Pen posn by its mobility (MIB p 239 c)
  if (res.length) rows.push({ name: 'Reserve', st: 'pass', reason: `${res[0].label ?? 'the reserve'}: placed to check penetrations and to cover the rearward move of the forward elements; in an assembly area or a C Pen posn by its mobility, the width of the posn, the going and the flanks (MIB p 239 c)` });
  // the echelons behind the next delaying posn (MIB p 239 d)
  const ech = item('ech'), dp2 = item('dp2');
  if (ech && dp2) {
    const behind = front(ech.pts) - rear(dp2.pts);
    rows.push({ name: 'Echelons', st: behind >= 0 ? 'pass' : 'warn', reason: `${fmtM(Math.abs(behind))} ${behind >= 0 ? 'behind' : 'in front of'} ${dp2.label ?? 'DP 2'}: vehicles not needed on the delaying posn, the echelons among them, stay to the rear of the next delaying posn (MIB p 239 d)` });
  }
  // how long: the higher Comd's to say (OOW3 p 29 para 6 a); phase lines with a stated time (MIB p 238 d)
  rows.push({ name: 'Delay time', st: 'unchecked', reason: 'how long the En is to be delayed forward of a line or posn is the higher Comd\'s to specify (OOW3 s6 para 6 a p 29); phase lines with a stated time express it (MIB p 238 d): set the time each DP holds' });
  return {
    rows,
    confirm: [
      'Each delaying posn: long range observation and fire, cover and concealment, covered routes back, obstacles to the front and flanks, a lateral ridge across the En axis, a road network (MIB p 237 b)',
      'Each successive posn reconnoitred in detail by the troops who will occupy it (MIB p 238 f)',
      'Thinning out continuous, troops placed to cover the thinning out of the rest (OOW3 p 29 para 5); no withdrawal from the original posn without the higher Comd\'s order (OOW3 p 31 para 9 a)',
      'The demolition plan worked out with the delaying troops\' action in advance: fired early, few routes are left and the troops may be cut off; fired late, the firing parties are hard to withdraw (OOW3 p 32 para 15); the Bn Comd well forward (MIB p 239 e)',
      'Boundaries of each Coy extended through the next delaying posn; each likely approach given to a Coy (MIB p 239 f-g)',
    ],
  };
}

/**
 * The withdrawal by day: the rows that differ from a night withdrawal. The sequence reversed (the forward Coys back through
 * the depth Coys, which cover them: MIB p 223; OOW3 p 41); the rear parties' and the covering Pl's night tasks become the
 * depth Coys' cover; the night programme from last light gives way to the day sequence (no figures printed).
 */
export function byDayRows(items: Item[] = [], recipe?: Recipe): { rows: Check[]; confirm: string[] } {
  const kindOf = (role: string) => recipe?.slots.find((x) => x.role === role)?.kind;
  const depth = items.filter((i) => (kindOf(i.role) === 'depth' || kindOf(i.role) === 'res') && i.pts.length >= 3);
  const fresh = items.filter((i) => /^fresh[A-Z]$/.test(i.role) && i.pts.length >= 3);
  const lanes = items.filter((i) => /^pp[A-Z]$/.test(i.role) && i.pts.length);
  const extra: Check[] = [];
  if (depth.length && fresh.length) {
    const rearDepth = Math.max(...depth.flatMap((i) => i.pts.map((p) => p.y)));
    const short = fresh.filter((i) => Math.min(...i.pts.map((p) => p.y)) < rearDepth - 1);
    extra.push({ name: 'Leap-frog', st: short.length ? 'warn' : 'pass', reason: `${short.length ? `${short.map((i) => i.label ?? i.role).join(', ')} not wholly behind the depth Coys` : `${fresh.map((i) => i.label ?? i.role).join(', ')} behind the depth Coys`}:the forward Coys move back through the depth Coys and take up fresh posns to their rear; where the distances are too great, the Coys fire and manoeuvre within their own resources; repeated until contact is broken (MIB s27 para 16 b pp 223-224)` });
  }
  if (recipe) extra.push({ name: 'Passage lanes', st: lanes.length ? 'pass' : 'warn', reason: lanes.length ? `${lanes.length} passage point${lanes.length > 1 ? 's' : ''} through the depth Coys: passage lanes and contact points laid down so that the forward elements do not upset the deployment in the rear; phase lines show when responsibility passes (OOW3 s8 para 7 p 43)` : 'no passage points: passage lanes and contact points must be laid down so the forward elements do not upset the deployment in the rear (OOW3 s8 para 7 p 43)' });
  return {
    rows: [
      ...extra,
      { name: 'By day', st: 'warn', reason: 'a daylight withdrawal is normally avoided unless the weather favours it or the roads necessitate it: the En sees it from the outset, engages from longer ranges and his air is more effective (OOW3 s8 para 1 p 40, para 5 p 42); never lightly under En air superiority (OOW3 p 15)',
        detail: { head: 'A withdrawal by day', why: 'Disengagement is difficult and a clean break needs the ground and adequate fire support (OOW3 p 42 para 5 d-e).', fix: ['Local air superiority or direct air support for the critical stages (OOW3 p 42 para 4)', 'Smoke, deception and fire support; passage lanes, contact points and phase lines where responsibility passes (OOW3 p 43 paras 7-8)', 'By night instead if the weather and roads allow: secrecy, surprise, fewer casualties (OOW3 s9 para 1 pp 43-44)'] } },
      { name: 'Sequence', st: 'pass', reason: 'reversed from the night: recce parties back, AD deployed at the points likely to be attacked by the En air, and non-essential vehicles, equipment and men out first, as by night (OOW3 s8 para 2 a p 41: sub-paras a-c of the night sequence, s9 para 2 p 44); the forward Coys move back through the depth Coys, which cover them, and take up fresh posns to their rear, leap-frogging until a clean break; tanks remain until last except in very close country; no assembly areas: the units move straight back, form columns and keep moving (MIB s27 para 16 pp 223-224; OOW3 s8 para 2 p 41)' },
      { name: 'Covering', st: 'pass', reason: 'the depth Coys cover the forward Coys\' withdrawal, then withdraw in turn covered by those now behind them (MIB p 223; OOW3 p 41 para 2 a)' },
    ],
    confirm: [
      'Lateral boundaries, passage lanes and contact points laid down; phase lines where the responsibility passes (OOW3 p 43 para 7)',
      'Air: local air superiority or direct air support arranged beforehand for the critical stages (OOW3 p 42 para 4)',
    ],
  };
}
