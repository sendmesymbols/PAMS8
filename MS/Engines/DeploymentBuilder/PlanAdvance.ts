/**
 * PlanAdvance.ts — PURE. An advance to contact: an Armd Bde leading an Armd Div's advance (OoW Vol II s4 pp 9-11,
 * Fig 2 p 9; PlanDoctrine `advance`). The recipe lays the echelons along the axis from the SP (the click; the aim is
 * the direction of advance): covering troops ahead, flank guards out, the Advance Guard (Van Gd, Main Gd), the Main
 * Body behind.
 *
 * - geometry rows: how far each echelon stands from the head against Fig 2 (read off a highlighted scan: uncertain);
 * - on the ground: the going for tracks along the axis (its NO-GO share and longest NO-GO stretch) and the flank
 *   guards' ground;
 * - Check my plan reads the same rows off the drawn symbols, the axis taken from the SP toward the covering troops.
 *
 * No ArcGIS, no DOM, so Node can test it.
 */
import type { DoctrineSet, Recipe } from './PlanRecipes';
import { doctrineAt, resolveRange } from './PlanRecipes';
import type { Check, CheckState, PlanItem, XY } from './PlanSolve';
import { solveRecipe } from './PlanSolve';
import { toLocal, toWorld, type FitFrame, type FitLayoutInput, type FitResult, type FittedLayout, type PlanGround } from './PlanFit';

type MercXY = [number, number];
export type AdvDrawn = Record<string, { pts: MercXY[] }>;

const kOf = (y: number) => 1 / Math.cos(2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2);
const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
const fmtM = (m: number) => (Math.abs(m) >= 1000 ? km(m) : `${Math.round(m / 10) * 10} m`);
const SRC = 'OoW Vol II Fig 2 p 9, read off a highlighted scan: uncertain';

/** The figures, PlanDoctrine.advance. */
export function advanceFigures(doc: DoctrineSet) {
  const r = (p: string, fb: [number, number]) => resolveRange(doc, doctrineAt(doc, `advance.${p}`)) ?? fb;
  return {
    ctps: r('ctpsAheadM', [4000, 8000]),
    van: r('vanGdM', [3500, 3500])[0],
    main: r('mainGdM', [3000, 3000])[0],
    flank: r('flankOutM', [6000, 6000])[0],
    body: r('mainBodyBackM', [8000, 8000])[0],
    nogoWarn: r('axisNogoWarn', [0.1, 0.1])[0],
    run: r('axisNogoRunM', [200, 500]),
  };
}

const centre = (pts: XY[]): XY => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });

/**
 * The echelons' distances from the head (plan metres, y in the direction of advance): covering troops ahead, the Van
 * Gd and Main Gd within the Advance Guard, the Main Body back, the flank guards out. Warn outside Fig 2's figures (the
 * single figures with a quarter either way, E).
 */
export function advanceRows(items: { role: string; pts: XY[] }[], doc: DoctrineSet): Check[] {
  const F = advanceFigures(doc);
  const at = (role: string) => { const i = items.find((x) => x.role === role && x.pts.length); return i ? centre(i.pts) : null; };
  const head = at('sp');
  if (!head) return [];
  const rows: Check[] = [];
  const near = (v: number, want: number) => v >= want * 0.75 && v <= want * 1.25;
  const ct = at('ctps');
  if (ct) {
    const d = ct.y - head.y;
    rows.push({ name: 'Covering troops', st: d >= F.ctps[0] - 1 && d <= F.ctps[1] + 1 ? 'pass' : 'warn', reason: `${fmtM(d)} ahead of the Van Gd's head; Fig 2: ${km(F.ctps[0])}-${km(F.ctps[1])} (${SRC}). Mobile troops: the Recce Regt and / or a LAT Bn, to recce and seize bridges and defiles ahead (s4 para 2)` });
  }
  const v = at('vanGd'), m = at('mainGd');
  if (v || m) {
    const dv = v ? head.y - v.y : null, dm = m ? head.y - m.y : null;
    const ok = (dv === null || (dv >= 0 && dv <= F.van * 1.2)) && (dm === null || (dm >= F.van * 0.8 && dm <= (F.van + F.main) * 1.2));
    rows.push({ name: 'Advance Guard', st: ok ? 'pass' : 'warn', reason: `an Armr Regt group (s4 para 3b): ${dv !== null ? `the Van Gd ${fmtM(dv)} behind the head` : 'no Van Gd'}${dm !== null ? `, the Main Gd ${fmtM(dm)}` : ''}; Fig 2: the Van Gd about ${km(F.van)} deep, the Main Gd about ${km(F.main)} behind it (${SRC})` });
  }
  const b = at('mainBody');
  if (b) {
    const d = head.y - b.y;
    rows.push({ name: 'Main Body', st: near(d, F.body) ? 'pass' : 'warn', reason: `${fmtM(d)} behind the head; Fig 2: about ${km(F.body)} (15-20 km for the Armd Div; ${SRC}). Not committed against minor opposition (s4 para 4)` });
  }
  const fl = ['flankL', 'flankR'].map(at).filter((p): p is XY => !!p);
  if (fl.length) {
    const outs = fl.map((p) => Math.abs(p.x - head.x));
    rows.push({ name: 'Flank guards', st: fl.length === 2 && outs.every((o) => near(o, F.flank)) ? 'pass' : 'warn', reason: `${outs.map(fmtM).join(' and ')} out from the axis${fl.length < 2 ? ' (one flank only)' : ''}; Fig 2: about ${km(F.flank)} (${SRC})` });
  }
  return rows;
}

/**
 * On the ground: the going for tracks along the axis, from the Main Body to the covering troops in 20 m steps (the
 * NO-GO share and the longest NO-GO stretch: a canal, marsh, built-up ground), and the flank guards' ground.
 */
export function advanceGroundRows(items: { role: string; pts: XY[] }[], f: FitFrame, g: PlanGround, doc: DoctrineSet): Check[] {
  const F = advanceFigures(doc);
  const at = (role: string) => { const i = items.find((x) => x.role === role && x.pts.length); return i ? centre(i.pts) : null; };
  const head = at('sp');
  if (!head) return [];
  const front = at('ctps')?.y ?? head.y + (F.ctps[0] + F.ctps[1]) / 2, rear = at('mainBody')?.y ?? head.y - F.body;
  const tracked = g.going('tracked');
  // 20 m steps: a canal or drain 30-80 m wide is not stepped over
  const STEP = 20;
  let n = 0, bad = 0, run = 0, worst = 0, worstAt = 0;
  for (let y = rear; y <= front + 1; y += STEP) {
    const w = toWorld(f, { x: head.x, y });
    const c = g.cls(w.x, w.y);
    if (c === null) continue;
    n++;
    const no = tracked.nogo.has(c);
    if (no) bad++;
    run = no ? run + STEP : 0;
    // where the stretch's middle is, from the head
    if (run > worst) { worst = run; worstAt = y - run / 2 - head.y; }
  }
  const steps = Math.floor((front - rear) / STEP) + 1;
  const rows: Check[] = [];
  if (n < steps / 2) rows.push({ name: 'Going on the axis', st: 'unchecked', reason: 'the ground along the axis is not loaded yet' });
  else {
    const share = bad / n;
    const st: CheckState = worst > F.run[1] ? 'fail' : worst > F.run[0] || share > F.nogoWarn ? 'warn' : 'pass';
    rows.push({ name: 'Going on the axis', st, reason: `${Math.round(share * 100)} % of the ${km(front - rear)} from the Main Body to the covering troops is NO-GO for tracks (the bundle's tracked going, 20 m steps); the longest NO-GO stretch ${fmtM(worst)}${worst ? ` ${worstAt >= 0 ? `${fmtM(worstAt)} ahead of` : `${fmtM(-worstAt)} behind`} the head` : ''} (warn over ${F.run[0]} m or ${Math.round(F.nogoWarn * 100)} %, fail over ${F.run[1]} m: E)${st === 'pass' ? '' : ': the axis needs a bridge or a detour there, or another axis; the mobile troops to seize the crossing ahead (s4 para 2)'}` });
  }
  const fl = (['flankL', 'flankR'] as const).map((r) => ({ r, p: at(r) })).filter((x): x is { r: 'flankL' | 'flankR'; p: XY } => !!x.p);
  if (fl.length) {
    const read = fl.map(({ r, p }) => { const w = toWorld(f, p); const c = g.cls(w.x, w.y); return { side: r === 'flankL' ? 'left' : 'right', c, no: c !== null && tracked.nogo.has(c), slow: c !== null && tracked.caution.has(c) }; });
    const known = read.filter((x) => x.c !== null);
    rows.push(!known.length ? { name: 'Flank guards\' ground', st: 'unchecked', reason: 'their ground is not loaded yet' }
      : { name: 'Flank guards\' ground', st: known.some((x) => x.no) ? 'warn' : 'pass', reason: known.map((x) => `the ${x.side} flank guard on ${g.label(x.c!)}${x.no ? ' (NO-GO for tracks)' : x.slow ? ' (SLOW-GO for tracks)' : ''}`).join('; ') });
  }
  return rows;
}

/** An advance fitted where it rests (PlanFit.fitLayout hands it over): the click is the SP, the aim the axis. */
export function fitAdvance(inp: FitLayoutInput): FittedLayout | null {
  const { recipe, ctx, ground } = inp;
  const base = solveRecipe(recipe, ctx, inp.opts);
  const pivot = base.items.find((i) => i.id === base.pivotId);
  if (!pivot) return null;
  const frame: FitFrame = { anchor: inp.anchor, bearing: inp.bearing, k: kOf(inp.anchor.y), pivot: pivot.pts[0] };
  inp.begin?.();
  const rows = [...advanceRows(base.items, ctx.doc), ...advanceGroundRows(base.items, frame, ground, ctx.doc)];
  const fails = rows.filter((r) => r.st === 'fail').length, warns = rows.filter((r) => r.st === 'warn').length;
  const fit: FitResult = {
    nudges: {}, slides: [], killingGr: null, slots: {}, rows, approaches: [],
    score: Math.max(0, 100 - 25 * fails - 8 * warns), fails, warns,
    pending: ground.pending(), data: ground.dataLine(), from: null, fromAssumed: true,
  };
  const res = { ...base, mode: 'terrain' as const, rows, slots: [], assumptions: [`Fitted to the ground: ${fit.data}.`, 'The axis is straight from the SP: the advance\'s route on the roads is the Move Planner\'s.', 'Fig 2\'s figures are read off a highlighted scan (uncertain).'] };
  return { recipe, res, raw: base, fit, frame, anchor: inp.anchor, bearing: inp.bearing, manual: {}, terrain: null, enemy: null, unit: null };
}

/** Check my plan for an advance built here: the drawn symbols, the axis from the SP toward the covering troops. */
export function checkAdvance(inp: FitLayoutInput, drawn: AdvDrawn): { rows: Check[]; confirm: string[]; pending: boolean; read: string[]; missing: string[] } | null {
  const { recipe, ctx, ground } = inp;
  const base = solveRecipe(recipe, ctx, inp.opts);
  const pivot = base.items.find((i) => i.id === base.pivotId);
  const sp = drawn.sp?.pts[0], ct = drawn.ctps?.pts[0], van = drawn.vanGd?.pts[0];
  if (!pivot || !sp) return null;
  // the direction of advance: from the SP toward the covering troops, else from the Van Gd to the SP
  const bearing = ct ? Math.atan2(ct[0] - sp[0], ct[1] - sp[1]) : van ? Math.atan2(sp[0] - van[0], sp[1] - van[1]) : inp.bearing;
  const frame: FitFrame = { anchor: { x: sp[0], y: sp[1] }, bearing, k: kOf(sp[1]), pivot: pivot.pts[0] };
  inp.begin?.();
  const items: PlanItem[] = base.items.filter((it) => drawn[it.role]).map((it) => ({ ...it, pts: drawn[it.role].pts.map((q) => toLocal(frame, { x: q[0], y: q[1] })) }));
  const rows = [...advanceRows(items, ctx.doc), ...advanceGroundRows(items, frame, ground, ctx.doc)];
  const names = (r: string) => recipe.slots.find((s) => s.role === r)?.label || r;
  const need = ['sp', 'ctps', 'vanGd', 'mainGd', 'mainBody', 'flankL', 'flankR'];
  return { rows, confirm: ['The route on the ground (roads, bridges and their classes): the Move Planner', 'Bounds, report lines and halting areas for the axis'], pending: ground.pending(), read: Object.keys(drawn).map(names), missing: need.filter((r) => !drawn[r]).map(names) };
}

/** Recipe roles of an advance, for the tab. */
export const isAdvance = (r: Recipe | undefined | null) => r?.task === 'advance';
