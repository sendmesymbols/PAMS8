/**
 * PlanDcb.ts — PURE. A Bde defending a ditch cum bund (recipe `bde-def-dcb`, layout `ditch` at echelon 18), from GSP 1947
 * Infantry Division in Battle s26 pp 118-121:
 * - Three up: normally all three Bns up on the obstacle, the depth given from within their own resources (para 8 b
 *   pp 120-121). So the Bde's depth is its Bns' own (a Bn along an AT ditch 1850-2757 m, IBB Annex V App 9 p 485), not
 *   the plains Bde's 4-6 km (OoW Vol I Annexes B-D): the solver's Depth row is judged again on that.
 * - Gaps covered: by artillery fire, automatics, AT fire, mines and patrols (para 8 c p 121): mines in each gap.
 * - Contingency posns: prepared in depth astride his major axes, the frontages being extended (para 8 f p 121).
 * - Protective elements: surveillance and protective elements ahead of the obstacle if the terrain and space permit
 *   (para 6 p 120).
 * - Reserves: the strong mobile reserves for counter-penetration and counter-attack are the Div's (para 6 p 120; para
 *   8 g p 121); he assaults at two or three points in one night, two at most (para 8 d-e p 121).
 *
 * Pure: plan metres, y toward the enemy (the solver's frame).
 */
import type { DoctrineSet, Recipe } from './PlanRecipes';
import { frontageRow, resolveRange } from './PlanRecipes';
import type { Check, PlanItem } from './PlanSolve';

const G = 'GSP 1947 Inf Div in Battle';
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
const ext = (pts: { x: number; y: number }[]) => ({ x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) });

/** A Bde on a DCB: true for the layout this module judges. */
export const isBdeDcb = (r: Recipe) => r.task === 'defence' && r.layout === 'ditch' && r.echelon === '18';

/**
 * The Bde DCB's rows: the Depth row judged again (in place) and the DCB's own rows added. `rows` is changed and returned
 * with the confirmations to add; any other plan comes back untouched.
 */
export function dcbRows(items: PlanItem[], recipe: Recipe, doc: DoctrineSet, rows: Check[]): { rows: Check[]; confirm: string[] } {
  if (!isBdeDcb(recipe)) return { rows, confirm: [] };
  const confirm: string[] = [];
  const kindOf = (role: string) => recipe.slots.find((s) => s.role === role)?.kind;
  const at = (role: string) => items.find((i) => i.role === role && i.pts.length);
  const fwd = items.filter((i) => kindOf(i.role) === 'fwd' && i.pts.length >= 3);
  const deep = items.filter((i) => ['depth', 'res'].includes(kindOf(i.role) ?? '') && i.pts.length >= 3);

  // the depth: the Bns' own (para 8 b), judged on the Bn along an AT ditch row
  const dRow = recipe.depthRow ? frontageRow(doc, recipe.depthRow) : null;
  const band = dRow ? resolveRange(doc, dRow.depthM) : null;
  const bnDepth = fwd.length ? Math.min(...fwd.map((b) => { const e = ext(b.pts); return e.y1 - e.y0; })) : 0;
  const depth: Check = band
    ? { name: 'Depth', st: bnDepth >= band[0] - 1 ? 'pass' : 'warn', m: bnDepth, limitM: band[0], limitSrc: `${dRow!.unit}: ${dRow!.src}`, reason: `${fmtM(bnDepth)}, each Bn's own: on a ditch cum bund all three Bns are up and the depth is given from within their own resources (${G} s26 para 8 b pp 120-121); a Bn along an AT ditch ${fmtM(band[0])}-${fmtM(band[1])} deep (${dRow!.src}); the plains Bde's 4-6 km (OoW Vol I Annexes B-D) is not the DCB's` }
    : { name: 'Depth', st: 'unchecked', reason: 'no Bn depth row for an AT ditch' };
  const i = rows.findIndex((r) => r.name === 'Depth');
  if (i >= 0) rows[i] = depth; else rows.push(depth);

  // three up, no depth Bn (para 8 b)
  rows.push(fwd.length >= 3 && !deep.length
    ? { name: 'Three up on the DCB', st: 'pass', reason: `all ${fwd.length} Bns up on the obstacle, the depth from within their own resources (${G} s26 para 8 b pp 120-121); a Bde may be assigned up to 8000-10000 m depending on the terrain and the second line troops allotted (para 5 p 119)` }
    : { name: 'Three up on the DCB', st: 'warn', reason: `${fwd.length} Bns up${deep.length ? ` and ${deep.length} in depth` : ''}: on a DCB normally all three Bns are deployed three up, the depth from their own resources (${G} s26 para 8 b pp 120-121)`, detail: { head: 'Not three up on the DCB', fix: ['All three Bns on the obstacle, each with its own depth Coy', 'Second line troops for the less threatened stretch (para 5 p 119)'] } });

  // the gaps between the Bns: covered by fire, mines and patrols (para 8 c)
  const sorted = [...fwd].sort((a, b) => ext(a.pts).x0 - ext(b.pts).x0);
  const gaps: { x0: number; x1: number }[] = [];
  for (let k = 0; k + 1 < sorted.length; k++) gaps.push({ x0: ext(sorted[k].pts).x1, x1: ext(sorted[k + 1].pts).x0 });
  const mines = items.filter((i) => kindOf(i.role) === 'obstacle' && /^mfGap/.test(i.role));
  const mined = gaps.filter((g) => mines.some((m) => { const e = ext(m.pts); return e.x1 >= g.x0 - 50 && e.x0 <= g.x1 + 50; })).length;
  rows.push({ name: 'Gaps covered', st: mined === gaps.length ? 'pass' : 'warn', reason: `${mined} of the ${gaps.length} gaps between the Bns mined; each covered by artillery fire, automatics, AT fire, mines and patrols (${G} s26 para 8 c p 121)` });
  confirm.push('The patrols and the DF and AT fire that cover each gap between the Bns');

  // contingency posns in depth (para 8 f)
  const cps = items.filter((i) => kindOf(i.role) === 'cpen' && i.pts.length);
  const rear = fwd.length ? Math.min(...fwd.map((b) => ext(b.pts).y0)) : 0;
  const behind = cps.filter((c) => ext(c.pts).y1 <= rear + 1).length;
  rows.push({ name: 'Contingency posns', st: cps.length && behind === cps.length ? 'pass' : 'warn', reason: `${cps.length} prepared contingency posn${cps.length === 1 ? '' : 's'} in depth (${behind} behind the Bns), astride his major axes because of the extended frontage (${G} s26 para 8 f p 121); he assaults a DCB at two or three points, aiming to finish in one night, two at most (para 8 d-e)` });
  confirm.push('The contingency posns astride his major axes on the ground, prepared and their occupants named');

  // protective elements ahead of the obstacle (para 6)
  const scr = at('scr'), ditch = at('xTgt');
  const ahead = scr && ditch ? Math.max(...scr.pts.map((p) => p.y)) - ditch.pts[0].y : 0;
  rows.push(scr
    ? { name: 'Protective elements', st: 'pass', m: ahead, reason: `a screen ${fmtM(ahead)} ahead of the ditch: surveillance and protective elements ahead of the obstacle to gain information, impose delay and cause attrition before he contacts the DCB, if the terrain and space permit (${G} s26 para 6 p 120); DCBs lie 1-6 km from the border (para 1 p 118)` }
    : { name: 'Protective elements', st: 'warn', reason: `none ahead of the ditch: if the terrain and space permit, surveillance and protective elements are sited ahead of the obstacle (${G} s26 para 6 p 120)` });

  // reserves: the Div's (para 6; para 8 g)
  rows.push({ name: 'Reserves', st: 'pass', reason: `no Bde reserve Bn: the depth is the Bns' own (para 8 b); the strong mobile reserves of infantry and armour for counter-penetration and counter-attack are the Div's (${G} s26 para 6 p 120, para 8 g p 121)` });
  confirm.push('The Div reserve\'s counter-penetration and counter-attack tasks in this Bde\'s sector');
  return { rows, confirm };
}
