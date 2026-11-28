/**
 * PlanRelief.ts — PURE. Two plans from GSP 1947 Infantry Division in Battle that hand a sector from one formation to
 * another:
 * - a relief in line (recipe `bde-relief`, layout `relief`; s29 pp 134-140): the Bde in defence relieved by an incoming
 *   Bde. Rows: Relief time (a Bde Gp at least 48 h, para 4 p 134), Relief routes (each posn reached from an Assy area by
 *   its route, guides at an RV; para 5 f p 137), Order of relief (by stages, rear to front or front to rear, para 5 d
 *   p 136), Command change (as late as possible, normally when more than half is relieved, the forward Bns; para 5 e
 *   pp 136-137), Artillery (relieved last, para 5 k p 138), By night (paras 5 c, g, h pp 135-137).
 * - a passage of lines (recipe `bde-passage`, layout `passage`; s20 pp 93-96): an incoming Bde attacks through a Bde in
 *   contact. Rows: Lanes (one per assault Bn through the own minefield, cleared and marked by the holding formation, para 10
 *   c p 96), Passage points (with guides, para 4 e p 94), Assy area (no forward assembly area, para 8 p 95), Handover
 *   (responsibility passes at or before the attack, para 6 pp 94-95), Fire from the holding formation (its indirect fire,
 *   para 7 a p 95).
 *
 * Pure: plan metres, y toward the enemy (the solver's frame).
 */
import type { DoctrineSet, Recipe } from './PlanRecipes';
import { doctrineAt, resolveRange } from './PlanRecipes';
import type { Check, PlanItem } from './PlanSolve';

const G = 'GSP 1947 Inf Div in Battle';
const ext = (pts: { x: number; y: number }[]) => ({ x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) });
const num = (doc: DoctrineSet, path: string, fb: number) => { const r = resolveRange(doc, doctrineAt(doc, path)); return r ? r[0] : fb; };

export interface HandoverRows { rows: Check[]; confirm: string[] }

/** The relief in line's rows; empty for any other plan. */
export function reliefRows(items: PlanItem[], recipe: Recipe, doc: DoctrineSet): HandoverRows {
  if (recipe.layout !== 'relief') return { rows: [], confirm: [] };
  const kindOf = (role: string) => recipe.slots.find((s) => s.role === role)?.kind;
  const posns = items.filter((i) => ['fwd', 'depth', 'res'].includes(kindOf(i.role) ?? '') && i.pts.length >= 3);
  const fwd = posns.filter((i) => kindOf(i.role) === 'fwd');
  const routes = items.filter((i) => /^rt[A-Z]$/.test(i.role) && i.pts.length >= 2);
  const rvs = items.filter((i) => /^rv[A-Z]$/.test(i.role));
  const assys = items.filter((i) => /^assy[A-Z]$/.test(i.role));
  const hrs = num(doc, 'relief.bdeGpMinH', 48);
  const rows: Check[] = [];
  rows.push({ name: 'Relief time', st: 'pass', m: hrs, reason: `a Bde Gp needs at least ${hrs} h for the proper planning and conduct of a relief; the warning order gives the time to begin and finish, the hours of night and whether in one night or more, the priorities on the routes, the advance parties and the order of relief (${G} s29 para 4 pp 134-135)` });
  // each posn reached: a route ending in it (or at its guides RV) from an Assy area
  const reach = (p: PlanItem) => { const e = ext(p.pts); return routes.some((r) => { const end = r.pts[r.pts.length - 1]; return end.x >= e.x0 - 300 && end.x <= e.x1 + 300 && end.y >= e.y0 - 600 && end.y <= e.y1 + 600; }); };
  const reached = posns.filter(reach).length;
  rows.push({ name: 'Relief routes', st: reached === posns.length && assys.length >= posns.length && rvs.length >= posns.length ? 'pass' : 'warn', reason: `${reached} of the ${posns.length} posns reached by a relief route from an Assy area (${assys.length}), ${rvs.length} guides RVs: recce by day of the existing defence and obstacles, the relief routes, the assembly areas, the debussing and turn-round area and the admin installations (${G} s29 para 5 f p 137); the relieved unit's guides and liaison personnel stay with the incoming unit (para 5 a p 135)` });
  rows.push({ name: 'Order of relief', st: 'pass', reason: `by stages, rear to front or front to rear (${G} s29 para 5 d p 136), in one night or more (para 6 p 140); the routes are numbered in the order laid (E), to be set by the two Comds when it is not laid down from above (para 5 b p 135)` });
  const share = posns.length ? fwd.length / posns.length : 0;
  rows.push({ name: 'Command change', st: share > 0.5 ? 'pass' : 'warn', m: share, limitM: 0.5, limitSrc: `${G} s29 para 5 e p 137`, reason: `when the ${fwd.length} forward Bns are relieved (${fwd.length} of ${posns.length}, ${Math.round(share * 100)} %): command changes as late as possible, once the incoming Comd has line and radio, normally when more than half is relieved, the forward Bns of a Bde relieved; not a clock hour (${G} s29 para 5 e (3) pp 136-137); until then the outgoing Comd commands the incoming units relieved, after it the incoming the outgoing units still in posn (para 5 e (1)-(2))` });
  rows.push({ name: 'Artillery', st: 'pass', reason: `relieved last: the relieved artillery stays in posn until the units in the forward defensive area are relieved, the support guaranteed throughout; over more than one night the relieving artillery may move a Bty forward on the first night; its observers join the outgoing units early; the incoming units see the DF adjusted or at least on the ground (${G} s29 para 5 k pp 138-139)` });
  rows.push({ name: 'By night', st: 'pass', reason: `moves normally in the hours of darkness under traffic control, secrecy kept by normal activity carried on; day or night weighed on the En night surveillance, the urgency, the length of the night and the air situation (${G} s29 para 5 c, g, h pp 135-137)` });
  return {
    rows,
    confirm: [
      'Advance parties (Bde / unit Comds with signal officers) briefed on the defensive plan, fire support, obstacles, counter-attack and C Pen tasks, patrolling, routine, logistics and the En habits (GSP s29 para 5 a p 135)',
      'A joint HQ (or a staff cell) for the relief; radio sets and operators of the outgoing Bde left behind until the relief is complete (GSP s29 para 5 e, m pp 136-139)',
      'Admin taken over: maintenance, supplies, water, POL, ammunition, defence stores, medical, repair and recovery (GSP s29 para 5 l p 139)',
    ],
  };
}

/** The passage of lines' rows; empty for any other plan. */
export function passageRows(items: PlanItem[], recipe: Recipe): HandoverRows {
  if (recipe.layout !== 'passage') return { rows: [], confirm: [] };
  const at = (role: string) => items.find((i) => i.role === role && i.pts.length);
  const rows: Check[] = [];
  const aslt = items.filter((i) => /^aslt[LR]$/.test(i.role));
  const lanes = items.filter((i) => /^lane[LR]$/.test(i.role));
  const mf = at('mfOwn');
  rows.push({ name: 'Lanes', st: mf && lanes.length >= Math.max(1, aslt.length) ? 'pass' : 'warn', reason: `${lanes.length} lane${lanes.length === 1 ? '' : 's'} through the own minefield for ${aslt.length} assault Bn${aslt.length === 1 ? '' : 's'}: cleared and marked by the formation in posn, its liaison officers at the gaps and defiles to check each unit through (${G} s20 para 10 c p 96); the troops in contact help with breaching, guides and fire (para 7 a p 95)` });
  const pps = items.filter((i) => /^pp[LR]$/.test(i.role));
  rows.push({ name: 'Passage points', st: pps.length >= lanes.length && lanes.length > 0 ? 'pass' : 'warn', reason: `${pps.length} passage point${pps.length === 1 ? '' : 's'} with guides from the holding formation at the home end of the lanes; the areas for the passage and the guides agreed at the planning conference (${G} s20 para 4 e p 94); the passing formation has priority on the routes, traffic control the holding formation's until the zone passes (para 5 p 94)` });
  // no forward assembly area: the Assy behind the holding posns (para 8 p 95)
  const assy = at('assy'), holds = items.filter((i) => /^hold[LR]$/.test(i.role) && i.pts.length >= 3);
  const holdRear = holds.length ? Math.min(...holds.map((h) => ext(h.pts).y0)) : null;
  const assyFront = assy ? ext(assy.pts).y1 : null;
  rows.push(holdRear === null || assyFront === null
    ? { name: 'Assy area', st: 'unchecked', reason: 'no holding posns or Assy area drawn' }
    : { name: 'Assy area', st: assyFront <= holdRear + 1 ? 'pass' : 'warn', reason: `the passing Bde's Assy area ${assyFront <= holdRear + 1 ? 'behind' : 'inside'} the holding Bns: it moves by night from its rear posns, timed to attack at the right time without moving into a forward assembly area, to cut the time of the greatest concentration forward (${G} s20 para 8 p 95); if the holding formation thins its reserves, the move back comes before the concentration forward (pp 95-96)` });
  rows.push({ name: 'Handover', st: at('bhol') ? 'pass' : 'warn', reason: `${at('bhol') ? 'the Battle Handover Line along the holding FDL: ' : 'no handover line drawn: '}the time or the circumstances when responsibility for the zone passes are agreed by the two Comds, normally at or before the time of attack, earlier if the higher HQ directs; the incoming Comd then takes operational control of the holding elements in contact (${G} s20 para 6 pp 94-95)` });
  rows.push({ name: 'Holding fire', st: 'pass', reason: `the holding formation supports the passage until its fires are masked (para 1 p 93); normally only its indirect fire, for the problems of control (${G} s20 para 7 a p 95); its admin support: traffic control, water points, casualties and PW, civilians (para 7 b)` });
  return {
    rows,
    confirm: [
      'The incoming Bde Tac HQ beside the holding Bde HQ for the planning; intelligence, plans and communication layouts exchanged; recce by the passing units (GSP s20 paras 3-4 pp 93-94)',
      'Armour passing through: each unit within the boundaries of one infantry unit; refuelling areas, their routes, fire support and admin support co-ordinated (GSP s20 paras 9-10 p 96)',
    ],
  };
}
