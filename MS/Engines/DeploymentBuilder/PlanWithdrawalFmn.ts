/**
 * PlanWithdrawalFmn -- a Bde or Div withdrawal laid on the OoW Vol III Annex P pattern (p 75): the original posn with its
 * rear parties, covering troops delaying in front of each intermediate posn, a flank guard if required, two intermediate
 * posns, the new defensive posn with the primary demolition belt across its front.
 *
 * The rules as written (OOW3 2006): withdraw on several axes when parallel routes exist, the routes converging from the
 * outer flanks protected (s2 para 5 a p 8); intermediate posns so far apart that the En must re-deploy before attacking the
 * next one (s6 para 16 p 33), their number set by the delay, the distance, the ground, the En and the troops (para 17
 * p 33), each held by a complete formation or unit under one Comd (para 18 p 34), more fire in front and less depth
 * (para 22 p 34); a flank guard on the threatened flank (para 24 p 34); a Bde the lowest level for reserves (s7 para 5
 * p 40); Div covering troops an Armd Regt or its subunits with artillery, engineers, LAT and mot infantry, held forward to
 * the time Corps sets (s6 para 12 p 32); the primary demolition belt continuous across the new posn's front (s12 para 5 a
 * p 56). The hop from each posn to the next is also read against the En field artillery (IBB s74 para 4 e p 373), as the
 * Bn withdrawal does.
 *
 * Pure: plan metres, y back along the aim (the way of withdrawal), the En at -y.
 */
import type { DoctrineSet, Recipe } from './PlanRecipes';
import { doctrineAt, resolveRange } from './PlanRecipes';
import type { Check, XY } from './PlanSolve';

const P = (x: number, y: number): XY => ({ x, y });
const num = (doc: DoctrineSet, path: string, fb: number) => { const r = resolveRange(doc, doctrineAt(doc, path)); return r ? (r[0] + r[1]) / 2 : fb; };
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
const rect = (c: XY, w: number, h: number): XY[] => [P(c.x - w / 2, c.y + h / 2), P(c.x + w / 2, c.y + h / 2), P(c.x + w / 2, c.y - h / 2), P(c.x - w / 2, c.y - h / 2)];
const top = (pts: XY[]) => Math.min(...pts.map((p) => p.y)), bottom = (pts: XY[]) => Math.max(...pts.map((p) => p.y));
const width = (pts: XY[]) => Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
type Item = { role: string; label?: string; pts: XY[] };

/** A formation withdrawal: the recipe carries a second intermediate posn. */
export const isFmnWithdrawal = (recipe: Recipe) => recipe.slots.some((s) => s.role === 'intPosn2');

function sizeOf(doc: DoctrineSet, recipe: Recipe, role: string, fw: number, fh: number): [number, number] {
  const r = (recipe.slots.find((s) => s.role === role)?.shape as any)?.rect;
  const w = r ? resolveRange(doc, r.wM) : null, h = r ? resolveRange(doc, r.hM) : null;
  return [w ? (w[0] + w[1]) / 2 : fw, h ? (h[0] + h[1]) / 2 : fh];
}

/**
 * Annex P at the aim: the new posn at the aimed distance; the intermediate posns each beyond the En field artillery of the
 * one before where the space allows (else spread evenly); covering troops half way between; the flank guard on the left
 * beside the first covering troops; the primary demolition belt across the new posn's front at the obstacle standoff.
 * Without an aim the new posn stands where every hop clears the En guns.
 */
export function fmnWdrGeom(recipe: Recipe, doc: DoctrineSet, aimM: number | null): Record<string, { pts: XY[] }> {
  const want = num(doc, 'withdrawal.intermediateMinM', 17200);
  const [wN, hN] = sizeOf(doc, recipe, 'newMain', 10000, 5000);
  const [w1, h1] = sizeOf(doc, recipe, 'intPosn', 4500, 2000);
  const [w2, h2] = sizeOf(doc, recipe, 'intPosn2', 4500, 2000);
  const full = want + h1 / 2 + want + h2 + want + hN / 2;
  const d = Math.max(9000, aimM ?? full);
  const y1 = Math.min(want, d / 3);
  const y2 = Math.min(y1 + h1 / 2 + want + h2 / 2, y1 + (d - y1) / 2);
  const g: Record<string, { pts: XY[] }> = {
    newMain: { pts: rect(P(0, d), wN, hN) },
    intPosn: { pts: rect(P(0, y1), w1, h1) },
    intPosn2: { pts: rect(P(0, y2), w2, h2) },
  };
  const has = (r: string) => recipe.slots.some((s) => s.role === r);
  const [wc, hc] = sizeOf(doc, recipe, 'cov1', w1, 1500);
  if (has('cov1')) g.cov1 = { pts: rect(P(0, y1 / 2), wc, hc) };
  if (has('cov2')) g.cov2 = { pts: rect(P(0, (y1 + y2) / 2), wc, hc) };
  if (has('cov3')) g.cov3 = { pts: rect(P(0, (y2 + d) / 2), wc, hc) };
  if (has('flankG')) { const [wf, hf] = sizeOf(doc, recipe, 'flankG', 2000, 3000); g.flankG = { pts: rect(P(-(Math.max(wN, wc) / 2 + wf / 2 + 1000), y1 / 2), wf, hf) }; }
  if (has('dmlBelt')) { const y = d - hN / 2 - num(doc, 'standoff.obstacleInFrontM', 200); g.dmlBelt = { pts: [P(-wN / 2, y), P(wN / 2, y)] }; }
  return g;
}

/** The hop from one posn to the next against the En field artillery (OOW3 p 33 para 16; IBB p 373). */
export function hopRow(name: string, from: string, to: string, gap: number, arty: number, artySrc: string): Check {
  return gap >= arty - 1
    ? { name, st: 'pass', reason: `${fmtM(gap)} from ${from} to ${to}: the En must re-deploy his field artillery (${artySrc}) before attacking it (OOW3 s6 para 16 p 33; IBB s74 para 4 e p 373)` }
    : { name, st: 'warn', reason: `${fmtM(gap)} from ${from} to ${to}: inside the reach of the En field artillery (${artySrc}) sited against ${from} (OOW3 s6 para 16 p 33: so far apart as to compel the En to re-deploy)`,
      detail: { head: `${to} ${fmtM(gap)} beyond ${from}`, why: 'The En guns that support the attack on one posn range the next without moving: the hop gains no delay from them.', fix: [`Site ${to} ${fmtM(arty)} or more beyond ${from}`, 'Fewer intermediate posns, each further apart, where the troops are short (OOW3 p 33 para 17)', 'Where the space is not there, say so in the plan'] } };
}

/** The formation's own rows: the posns' depth, the covering troops, the flank guard, the axes, the reserve, the demolition belt. */
export function fmnWdrRows(items: Item[], recipe: Recipe, doc: DoctrineSet): { rows: Check[]; confirm: string[] } {
  const rows: Check[] = [];
  const kindOf = (role: string) => recipe.slots.find((s) => s.role === role)?.kind;
  const item = (role: string) => items.find((i) => i.role === role && i.pts.length);
  const div = recipe.echelon === '21';
  const holder = div ? 'a Bde' : 'a Bn';
  const ips = ['intPosn', 'intPosn2'].map(item).filter((x): x is Item => !!x && x.pts.length >= 3);
  const nm = item('newMain');
  // held by a complete formation or unit; more fire in front and less depth than a main posn (OOW3 paras 18, 22 p 34)
  if (ips.length && nm && nm.pts.length >= 3) {
    const dN = bottom(nm.pts) - top(nm.pts);
    const deep = ips.filter((i) => bottom(i.pts) - top(i.pts) >= dN - 1);
    rows.push({ name: 'Int posns held', st: deep.length ? 'warn' : 'pass', reason: `${ips.map((i) => `${i.label ?? i.role} ${fmtM(width(i.pts))} x ${fmtM(bottom(i.pts) - top(i.pts))}`).join('; ')}, each for ${holder} under one Comd, a complete ${div ? 'formation' : 'unit'} not broken up (OOW3 s6 para 18 p 34); greater fire in front, less depth than the new posn's ${fmtM(dN)} to economise, adequate frontage against a quick outflanking, some reserve for counter penetration (para 22 p 34)${deep.length ? `: ${deep.map((i) => i.label ?? i.role).join(', ')} as deep as the main posn` : ''}` });
  }
  // covering troops in front of each intermediate posn and of the new posn (Annex P p 75; p 32)
  const covs = items.filter((i) => /^cov\d$/.test(i.role) && i.pts.length);
  rows.push({ name: 'Covering tps', st: covs.length >= ips.length ? 'pass' : 'warn', reason: `${covs.length} covering troops posn${covs.length === 1 ? '' : 's'} for ${ips.length} intermediate posn${ips.length === 1 ? '' : 's'}: covering troops delay the En forward of each posn, deceive him on the new FDLs, force him to deploy early and give warning (OOW3 s6 para 9 b p 31, Annex P p 75)${div ? '; Div covering troops an Armd Regt or its subunits with artillery, engineers, LAT and mot infantry, held forward to the time Corps sets (s6 para 12 p 32)' : ''}` });
  // the flank guard: on the threatened flank, if required (p 34 para 24)
  const fg = item('flankG');
  rows.push(fg ? { name: 'Flank guard', st: 'pass', reason: `${fg.label ?? 'the flank guard'}: protects the withdrawing force from the threatened flank, on a parallel route or on ground dominating the approaches from it; its strength by the threat (OOW3 s6 para 24 p 34). Drawn on the left: move it to the flank the En threatens` }
    : { name: 'Flank guard', st: 'unchecked', reason: 'none drawn: a flank guard where a flank is threatened (OOW3 s6 para 24 p 34)' });
  // several axes, apart (p 8 para 5 a); routes that merge share one column and one air target
  const rts = items.filter((i) => /^rt[A-Z]$/.test(i.role) && i.pts.length >= 2);
  if (rts.length) {
    const mergeM = num(doc, 'withdrawal.formation.axesMergeM', 200);
    const segD = (p: XY, a: XY, b: XY) => { const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy; const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0; return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); };
    const closest = (A: XY[], B: XY[]) => { let m = Infinity; for (const [U, W] of [[A, B], [B, A]]) for (let i = 1; i < U.length; i++) for (let s = 0; s <= 20; s++) { const p = P(U[i - 1].x + ((U[i].x - U[i - 1].x) * s) / 20, U[i - 1].y + ((U[i].y - U[i - 1].y) * s) / 20); for (let j = 1; j < W.length; j++) m = Math.min(m, segD(p, W[j - 1], W[j])); } return m; };
    const merged: string[] = [];
    let apart = Infinity;
    for (let i = 0; i < rts.length; i++) for (let j = i + 1; j < rts.length; j++) { const m = closest(rts[i].pts, rts[j].pts); apart = Math.min(apart, m); if (m < mergeM) merged.push(`${rts[i].label || `Route ${rts[i].role.slice(2)}`} and ${rts[j].label || `Route ${rts[j].role.slice(2)}`}`); }
    rows.push(rts.length < 2 ? { name: 'Axes', st: 'warn', reason: 'one route back: when parallel routes are available it is usually better to withdraw on several axes to avoid congestion, delays and targets for the En air (OOW3 s2 para 5 a p 8)' }
      : merged.length ? { name: 'Axes', st: 'warn', reason: `${merged.join('; ')} come within ${mergeM} m: one column, one target for the En air (OOW3 s2 para 5 a p 8)`,
        detail: { head: `${merged.length} pair${merged.length > 1 ? 's' : ''} of routes merge`, why: 'Routes that merge bring the columns together where the En air and artillery can catch both; the routes converging on the axes from the outer flanks must be protected (OOW3 p 8).', fix: ['Keep each formation on its own axis to the clear line', 'Where they must meet, a traffic control post, AD and a time for each to pass (OOW3 p 62 para 7)'] } }
        : { name: 'Axes', st: 'pass', reason: `${rts.length} axes back, ${fmtM(apart)} apart at the closest: withdraw on several axes to avoid congestion, delays and targets for the En air; the routes converging on them from the outer flanks protected (OOW3 s2 para 5 a p 8)` });
  }
  // the reserve: a Bde the lowest level for one (s7 para 5 p 40)
  const res = items.find((i) => kindOf(i.role) === 'res' && i.pts.length >= 3);
  rows.push(res ? { name: 'Reserve', st: 'pass', reason: `${res.label ?? 'the reserve'}: a Bde is the minimum level for reserves; used to counter-attack, to reinforce the rear parties or to disengage them, and highly mobile (OOW3 s7 paras 4-5 p 40); counter-attacks with limited objectives (s6 para 23 p 35)` }
    : { name: 'Reserve', st: 'warn', reason: 'no reserve: the withdrawing force needs hard-hitting reserves; at least the least committed troops prepared for the planned tasks (OOW3 s7 paras 4-5 p 40)' });
  // the primary demolition belt continuous across the new posn's front (s12 para 5 a p 56)
  const belt = item('dmlBelt');
  if (nm && nm.pts.length >= 3) {
    const wN = width(nm.pts);
    const covered = belt ? width(belt.pts) : 0;
    rows.push(!belt ? { name: 'Dml belt', st: 'warn', reason: 'no primary demolition belt drawn: continuous across the front of the new defensive posn, covered by its weapons (OOW3 s12 para 5 a p 56)' }
      : { name: 'Dml belt', st: covered >= wN - 1 ? 'pass' : 'warn', reason: `${fmtM(covered)} across a front of ${fmtM(wN)}: the primary demolition belt is continuous across the front, sited as part of the new defensive posn with weapons covering every likely crossing place; gaps in a natural obstacle filled with mines or ditches; chosen by the highest tactical Comd (OOW3 s12 para 5 a p 56)` });
  }
  return {
    rows,
    confirm: [
      `${div ? 'Div' : 'Bde'} OO timings (OOW3 Annex A pp 72-73): the posn denied until __; no rearward move but recce parties before __${div ? '' : '; thinning out may begin at __; finally abandoned by __'}; rear parties to cross the clear line by __; all troops clear of it by __`,
      'Artillery: attached to the subordinate formations on a wide front; FOOs with the reserves from the start; fire for the covering troops, intermediate posns, rearguards and flank guards; demolitions and obstacles covered by fire; ammunition dumped at successive posns (OOW3 p 62 paras 5-8)',
      'AD for the HQs, the gun areas and the defiles (OOW3 p 62 para 7)',
      'Subsidiary demolition belts in front of or behind the intermediate posns to help the covering troops make a clean break; road denial bands across the front, several miles deep (OOW3 s12 para 5 b-c pp 56-57)',
      'Stay behind parties, mobile, with ATGM and artillery support: raids and ambushes on the En echelons (OOW3 s6 para 27 p 36)',
      'Passage through the intermediate posns: more than one gap and lane, contact points, passage points, a time of passage (OOW3 s10 p 48)',
    ],
  };
}
