/**
 * PlanInfil -- the attack by infiltration (recipe bn-attk-infiltration, layout `infiltration`): IBB S45 pp 221-230 and
 * DW s12 para 19 p 48. Pure: the rows read the plan's items (plan metres, y toward the enemy negative as the attack
 * recipes lay them) and the doctrine (PlanDoctrine infiltration). Through PlanMountain.layoutRows (build, fit, Check my
 * plan), beside the attack's own rows (FUP, assault frontage, H hour...).
 *
 * Rows: Lanes (two for a Bn, IBB p 225; several routes to the RV, DW p 48), Through the En FDL (each lane crosses it),
 * Gap shoulders (secured by the leading troops, IBB p 228), RV and firm base (beyond the En FDL, near the Obj, away from
 * the En DF, alternative routes to the FUP: IBB p 227, DW p 48), Link-up (24-36 h, IBB p 223; seize and hold, DW p 48) and
 * Fire support (within the Div artillery, IBB p 222; medium guns, DW p 48).
 */
import type { DoctrineSet, Recipe } from './PlanRecipes';
import { doctrineAt, resolveRange } from './PlanRecipes';
import type { Check, XY } from './PlanSolve';

type Item = { role: string; label?: string; pts: XY[] };
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
const centre = (pts: XY[]): XY => ({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length });
const num = (doc: DoctrineSet, path: string, fb: number) => { const r = resolveRange(doc, doctrineAt(doc, path)); return r ? r[1] : fb; };

/** The rows of an attack by infiltration; [] for any other recipe. */
export function infilRows(items: Item[], recipe: Recipe, doc: DoctrineSet): Check[] {
  if (recipe.layout !== 'infiltration') return [];
  const rows: Check[] = [];
  const get = (r: string) => items.find((i) => i.role === r && i.pts.length);
  const lanes = items.filter((i) => /^lane/.test(i.role) && i.pts.length >= 2);
  const fdl = get('enFdl'), obj = get('obj'), rv = get('rv'), fb = get('firmBase');
  const objC = obj ? centre(obj.pts) : null;
  // which way is the enemy: the Obj lies beyond the En FDL from the lanes' start
  const fdlY = fdl ? fdl.pts.reduce((a, p) => a + p.y, 0) / fdl.pts.length : null;
  const toward = objC && fdlY !== null ? Math.sign(objC.y - fdlY) || -1 : -1;
  const beyond = (p: XY) => fdlY !== null && (p.y - fdlY) * toward > 0;

  // the lanes: a Bn in two (or one), each through the En FDL from own side
  rows.push(lanes.length >= 2
    ? { name: 'Lanes', st: 'pass', reason: `${lanes.length} lanes: a Bn infiltrates in two lanes, two Coys and a Mor section in each half, or in one (IBB S45 para 14 p 225); several routes to the RV avoiding the En posns (DW s12 para 19 a p 48); used in echelons, the leading groups first (para 15 p 226)` }
    : { name: 'Lanes', st: 'warn', reason: `${lanes.length} lane: the RV wants multiple routes leading to it (DW s12 para 19 a p 48); a Bn may go through one lane (IBB S45 para 14 b p 225), but a blocked lane then stops the whole force (para 20 p 227)`, detail: { head: 'One lane', why: 'An RV / firm base with multiple routes leading to it (DW p 48); a lane found blocked leaves only splitting into smaller groups or going back (IBB p 227).', fix: ['A second lane through another gap', 'Recce patrols to find the gaps, guides from earlier patrols (IBB p 226)'] } });
  if (fdlY !== null && lanes.length) {
    const through = lanes.filter((l) => !beyond(l.pts[0]) && beyond(l.pts[l.pts.length - 1]));
    rows.push(through.length === lanes.length
      ? { name: 'Through the En FDL', st: 'pass', reason: `every lane crosses the En FDL from own side to beyond it; the lanes through the En minefields cleared on the preceding nights, which may take 2-3 nights, or the existing gaps in the En posns used (IBB S45 para 25 p 228)` }
      : { name: 'Through the En FDL', st: 'warn', reason: `${lanes.length - through.length} lane${lanes.length - through.length > 1 ? 's do' : ' does'} not cross the En FDL: an infiltration goes through gaps in the En posns (IBB S45 paras 13-14 p 225)` });
    // the shoulders of the gaps secured by the leading troops before the infiltration starts (para 23 p 228)
    const sh = items.filter((i) => /^sh/.test(i.role) && i.pts.length);
    const crossAt = lanes.map((l) => { for (let k = 1; k < l.pts.length; k++) { const a = l.pts[k - 1], b = l.pts[k]; if ((a.y - fdlY) * (b.y - fdlY) <= 0 && a.y !== b.y) { const t = (fdlY - a.y) / (b.y - a.y); return { x: a.x + t * (b.x - a.x), y: fdlY }; } } return null; }).filter((p): p is XY => !!p);
    const reachM = num(doc, 'infiltration.shoulderWithinM', 1000);
    const guarded = crossAt.filter((c) => sh.some((s) => Math.hypot(s.pts[0].x - c.x, s.pts[0].y - c.y) <= reachM)).length;
    rows.push(crossAt.length && guarded === crossAt.length
      ? { name: 'Gap shoulders', st: 'pass', reason: `the shoulders of each gap held by the leading troops (within ${fmtM(reachM)} of where each lane crosses), staying till the last man is through: once the En detects it, its first reaction is to seal the gaps (IBB S45 para 23 p 228)` }
      : { name: 'Gap shoulders', st: 'warn', reason: `${crossAt.length - guarded} of ${crossAt.length} gaps with no troops on their shoulders: the leading troops secure them before the infiltration starts and stay till the last man is through (IBB S45 para 23 p 228)` });
  }
  // the RV and firm base: beyond the En FDL, near the Obj, away from the En DF, alternative routes to the FUP
  if (rv && objC) {
    const r = centre(rv.pts), d = Math.hypot(r.x - objC.x, r.y - objC.y);
    const nearM = num(doc, 'infiltration.rvNearObjM', 3000);
    const ok = (fdlY === null || beyond(r)) && d <= nearM;
    rows.push({
      name: 'RV and firm base', st: ok ? 'pass' : 'warn',
      reason: `the RV ${fmtM(d)} from the Obj${fdlY !== null ? (beyond(r) ? ', beyond the En FDL' : ', short of the En FDL') : ''}${fb ? `, the firm base ${fmtM(Math.hypot(centre(fb.pts).x - objC.x, centre(fb.pts).y - objC.y))} from it` : ', no firm base'}: an RV / firm base in the vicinity of the Obj, multiple routes leading to it, avoiding the En posns (DW s12 para 19 a p 48); away from likely DF, protected, avoiding places hemmed in by obstacles; the firm base with the features dominating it held, alternative routes to the FUP and an alternative firm base (IBB S45 para 21 p 227)${ok ? '' : `: within ${fmtM(nearM)} of the Obj and beyond the En FDL (E)`}`,
      ...(ok ? {} : { detail: { head: 'RV not near the Obj', why: 'The infiltrating groups navigate to an RV / firm base in the vicinity of the objective (DW p 48 a), beyond the En posns.', fix: [`Bring the RV within ${fmtM(nearM)} of the Obj, beyond the En FDL`, 'An alternative RV and firm base (IBB p 227)'] } }),
    });
  }
  rows.push({ name: 'Link-up', st: 'pass', reason: 'link-up within 24-36 h of the launching, the administrative cover to sustain the force for that period with it, air supply planned if it runs longer (IBB S45 para 10 p 223); the Obj seized and held till the link-up (DW s12 para 19 d p 48); a plan to exfiltrate if it does not come (IBB para 28 f p 230); an alternative Obj given (para 5 p 222)' });
  rows.push({ name: 'Fire support', st: 'pass', reason: 'within the Div artillery\'s range, timed programmes fixed from the assembly area, most targets on call (IBB S45 para 7 p 222); medium guns, air cover and air supply where available (DW s12 para 19 c p 48); fire before the start to neutralise the En surveillance, during the move to drown the noise and deceive (IBB para 19 p 227)' });
  return rows;
}
