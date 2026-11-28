/**
 * PlanWithdrawal -- a Bn withdrawal by night laid on the ground (IC s90-93 pp 472-490; IBB s72-76 pp 366-386).
 *
 * The frame of a withdrawal recipe points the way the Bn goes: y is the direction of withdrawal (the aim), the enemy lies
 * at -y, the old posn round the pivot (the Bn HQ). The rules as written: control points (Coy and Bn checkpoints and RVs,
 * the embussing point) on the routes back (IC s92 paras 7-8 pp 486-487); Coy embussing points about 1500-2000 m behind the
 * old posn on the Coy routes where parallel routes allow, else one Bn embussing point behind the Bn RV (IBB s75 para 20
 * p 383); a platoon of the depth Coys covers the Bn embussing point (IBB p 379); rear parties, a platoon from each
 * forward Coy with part of the weapons, stay to the time of abandonment (IC s92 paras 13-14 p 488), with their own RV and a
 * separate embussing point near it, well forward (IC s92 para 8 c p 487, para 14 p 488); the intermediate posn,
 * held by a Coy group, far enough back that the En must at least move En field artillery before the En can range the next posn,
 * behind a natural obstacle if available (IBB s74 para 4 e p 373; IC s91 para 3 b, e pp 481-482); part of the artillery
 * repositioned 5000-6000 m back before the posn is abandoned (IBB s76 para 5 p 385); the programme from last light to the
 * time of denial (IBB s75 para 11 pp 379-380), with the thinning out a few minutes before the time of denial and the time
 * before which no rearward move may take place (IC s90 para 15 pp 478-479).
 *
 * Pure: plan metres through the FitFrame onto the ground (PlanGround). Geometry only lays the control points by the
 * figures; on the ground the routes go round NO-GO on foot, the embussing points slide onto a track, the intermediate
 * posn is judged against En guns and the obstacles between, and the routes are read for En view.
 */
import type { DoctrineSet, Recipe } from './PlanRecipes';
import { doctrineAt, resolveRange } from './PlanRecipes';
import type { Check, SolveResult, XY } from './PlanSolve';
import { solveRecipe } from './PlanSolve';
import type { FitFrame, FitLayoutInput, FitResult, FittedLayout, PlanGround } from './PlanFit';
import { detectTerrain, toLocal, toWorld } from './PlanFit';
import { delayGeom, delayRows, delayGroundRows, byDayRows } from './PlanDelay';
import { isFmnWithdrawal, fmnWdrGeom, fmnWdrRows, hopRow, timeSpaceRow } from './PlanWithdrawalFmn';
import { clockFrom, dateOf, durText, hhmm as clockHHMM, LightBook, todayIn } from '../MovePlanner/MoveTime';
import { mercToLngLat } from '../MovementGuide/MovementGuideScan';

export interface WithdrawalFind {
  nudges: Record<string, XY>;
  geom: Record<string, { pts: XY[]; label?: string }>;
  /** The routes back on the ground (plan metres), by role. */
  paths: Record<string, XY[]>;
  rows: Check[];
  confirm: string[];
  /** The programme: minutes from last light (L); `denial` is the time the posn is denied to. */
  times: { label: string; atMin: number; src: string }[];
  /** Each route's length and night march time. */
  routes: { role: string; label: string; lengthM: number; min: number; seenPct: number | null; by?: 'day' | 'night' }[];
}

const P = (x: number, y: number): XY => ({ x, y });
const num = (doc: DoctrineSet, path: string, fb: number) => { const r = resolveRange(doc, doctrineAt(doc, path)); return r ? (r[0] + r[1]) / 2 : fb; };
const rng = (doc: DoctrineSet, path: string, fb: [number, number]) => resolveRange(doc, doctrineAt(doc, path)) ?? fb;
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);

/**
 * The desert withdrawal (DW s9 pp 32-33): no withdrawal on foot for any distance, transport to lift all the men; as many
 * routes as possible, cross-country too; a clean break to the next main posn, no running fight; covering troops and flank
 * guards armour based. The longest walk from a posn to its embussing point (the routes back) is judged against
 * withdrawal.desertWalkMaxM (E: the Coy RV distance, IBB p 381; DW prints no distance).
 */
function desertWdrRow(routes: { label: string; lengthM: number }[], doc: DoctrineSet, intPosn: boolean): Check {
  const lim = rng(doc, 'withdrawal.desertWalkMaxM', [457, 457])[1];
  const base = `transport to lift all the men, on as many routes as possible including cross-country (${routes.length} route${routes.length === 1 ? '' : 's'} back laid); ${intPosn ? 'a clean break to the next main posn where a stand can be made, no running fight: an intermediate posn only on a feature with delay potential (DW p 32 paras 1-2)' : 'a clean break to the next main posn where a stand can be made (DW p 32 para 1)'}; covering troops and flank guards armour based with APC infantry, ATGM / LAT, RR and MGs, FOOs from the medium Regts (DW pp 32-33 paras 3-4)`;
  if (!routes.length) return { name: 'Desert', st: 'unchecked', reason: `in the desert no withdrawal on foot for any distance: no route back laid to measure the walk to the vehicles; ${base}` };
  const longest = routes.reduce((m, r) => (r.lengthM > m.lengthM ? r : m), routes[0]);
  if (longest.lengthM <= lim + 1) return { name: 'Desert', st: 'pass', reason: `the longest walk to the vehicles ${fmtM(longest.lengthM)} (${longest.label}), within ${fmtM(lim)}: in the desert no withdrawal on foot for any distance (DW s9 para 1 p 32); ${base}` };
  return {
    name: 'Desert', st: 'warn',
    reason: `${longest.label} walks ${fmtM(longest.lengthM)} to its embussing point: in the desert the withdrawing unit cannot be expected to withdraw any distance on foot, and if made to, mobile En troops cut it off (DW s9 para 1 p 32); ${base}`,
    detail: {
      head: `A ${fmtM(longest.lengthM)} walk back in the desert`,
      why: 'The withdrawing unit cannot be expected to withdraw any distance on foot and if made to do so, will be quickly cut off by mobile enemy troops: adequate transport to lift all personnel (DW s9 para 1 p 32). IBB\'s Coy embussing points 1500-2000 m back (s75 para 20 a p 383) are not for the desert: the books differ.',
      items: routes.filter((r) => r.lengthM > lim + 1).map((r) => `${r.label}: ${fmtM(r.lengthM)} on foot`),
      fix: [`Bring the transport forward to the Coy RVs, within ${fmtM(lim)} of the posns (IBB s75 para 14 a p 381), and embus there`, 'Mounted covering troops (armour, APC infantry) to hold the En off the embussing (DW p 32 para 3)'],
    },
  };
}
const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
const centre = (pts: XY[]): XY => P(pts.reduce((a, p) => a + p.x, 0) / pts.length, pts.reduce((a, p) => a + p.y, 0) / pts.length);
const lenOf = (pts: XY[]) => { let L = 0; for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]); return L; };
const WATER = new Set([4, 5, 20, 21, 22, 46]);
const ROADS = new Set([34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 50]);
/** The crossing classes (rules.json): a route over one of these crosses water there (as PlanAdvance reads an axis). */
const CROSSING_WORD: Record<number, string> = { 39: 'a Cl 60+ bridge', 40: 'a Cl 50-59 bridge', 41: 'a bridge below Cl 50', 42: 'a bridge of unrecorded class', 43: 'a railway bridge', 44: 'a foot bridge', 45: 'a ford / ferry' };
/** Roads and the railway (rules.json 34-38, 50): one over water marks a crossing the grid does not class as a bridge. */
const ROAD_OVER = new Set([34, 35, 36, 37, 38, 50]);
export const hhmm = (min: number) => `${String(Math.floor(((min % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}${String(Math.round(((min % 60) + 60) % 60)).padStart(2, '0')}`;

/** Geometry at the aim: the new main posn at the aimed distance (the second click), the intermediate posn in between. */
export function withdrawalGeom(recipe: Recipe, doc: DoctrineSet, aimM: number | null): Record<string, { pts: XY[] }> {
  if (recipe.layout === 'delay') return delayGeom(recipe, doc, aimM);
  return withPassage(isFmnWithdrawal(recipe) ? fmnWdrGeom(recipe, doc, aimM) : bnWdrGeom(recipe, doc, aimM), recipe);
}

/**
 * The posns the withdrawing troops pass back through, with the tag of their passage points (ppI1, ppII1, ppN1 ...) and
 * contact point (ctI, ctII, ctN): the intermediate posns, and the new posn through which the covering troops come back
 * last (OOW3 s10 para 1 p 47; Annex P p 75). The Bn plan carries them at its intermediate posn only.
 */
const PASSED: [role: string, tag: string, word: string][] = [['intPosn', 'I', 'the intermediate posn'], ['intPosn2', 'II', 'Int Posn 2'], ['newMain', 'N', 'the new posn']];

/**
 * The passage through each posn passed through (OOW3 s10 para 2 c p 48: more than one gap and lane): the passage points
 * spread along its front edge, the contact point at the middle of it.
 */
function withPassage(g: Record<string, { pts: XY[] }>, recipe: Recipe): Record<string, { pts: XY[] }> {
  for (const [role, tag] of PASSED) {
    const ip = g[role]?.pts;
    if (!ip?.length) continue;
    const x0 = Math.min(...ip.map((p) => p.x)), x1 = Math.max(...ip.map((p) => p.x)), yF = Math.min(...ip.map((p) => p.y));
    const pps = recipe.slots.filter((s) => new RegExp(`^pp${tag}\\d$`).test(s.role));
    pps.forEach((s, i) => { g[s.role] = { pts: [P(x0 + ((x1 - x0) * (i + 1)) / (pps.length + 1), yF)] }; });
    if (recipe.slots.some((s) => s.role === `ct${tag}`)) g[`ct${tag}`] = { pts: [P((x0 + x1) / 2, yF)] };
  }
  return g;
}

function bnWdrGeom(recipe: Recipe, doc: DoctrineSet, aimM: number | null): Record<string, { pts: XY[] }> {
  const g: Record<string, { pts: XY[] }> = {};
  const nm = recipe.slots.find((s) => s.role === 'newMain'), ip = recipe.slots.find((s) => s.role === 'intPosn');
  const d = Math.max(3000, aimM ?? num(doc, 'withdrawal.defaultNewMainM', 25000));
  const rect = (c: XY, w: number, h: number) => [P(c.x - w / 2, c.y + h / 2), P(c.x + w / 2, c.y + h / 2), P(c.x + w / 2, c.y - h / 2), P(c.x - w / 2, c.y - h / 2)];
  const sz = (s: typeof nm, fw: number, fh: number): [number, number] => { const r = s?.shape?.rect; const w = r ? resolveRange(doc, r.wM) : null, h = r ? resolveRange(doc, r.hM) : null; return [w ? (w[0] + w[1]) / 2 : fw, h ? (h[0] + h[1]) / 2 : fh]; };
  if (nm) { const [w, h] = sz(nm, 4500, 3000); g.newMain = { pts: rect(P(0, d), w, h) }; }
  if (ip) {
    const [w, h] = sz(ip, 1500, 700);
    const want = num(doc, 'withdrawal.intermediateMinM', 17200);
    const y = Math.min(want, Math.max(3000, d - 3000));
    g.intPosn = { pts: rect(P(0, y), w, h) };
  }
  return g;
}

/**
 * The new main posn against the intermediate posn: the clean break (cleanBreakMinM, E) is the floor; the hop itself must
 * also force the En to move his field artillery before he can range the next position (IBB s74 para 4 e (2) p 373, s73
 * para 5 b (7) p 369: every rearward hop; IC s91 para 3 b p 481: "sufficiently far apart to force the enemy to move his
 * artillery"), "depending on the type of ground and the space available" (p 373).
 */
export function newMainRow(doc: DoctrineSet, backM: number, gap: number, arty: number, artySrc: string): Check {
  const clean = num(doc, 'withdrawal.cleanBreakMinM', 2000);
  const head = `${fmtM(backM)} behind the old posn, ${fmtM(gap)} beyond the intermediate posn`;
  const keep = 'no posn is abandoned until the next is organised and at least partially manned (IBB s74 para 21 p 378)';
  if (gap < clean) return { name: 'New main posn', st: 'warn', reason: `${head} (wants ${fmtM(clean)} for a clean break, E); ${keep}` };
  if (gap >= arty - 1) return { name: 'New main posn', st: 'pass', reason: `${head}: the En must move the field artillery again (${artySrc}) before ranging it (IBB p 373, p 369; IC s91 para 3 b p 481); ${keep}` };
  return {
    name: 'New main posn', st: 'warn', reason: `${head}: inside the reach of En field artillery (${artySrc}) sited to engage the intermediate posn; IBB p 373 wants each posn far enough from the next that the En must move the guns first, space allowing; ${keep}`,
    detail: { head: `Hop of ${fmtM(gap)} against En guns of ${fmtM(arty)}`, why: 'The En guns that support the attack on the intermediate posn can range the new main posn without moving: the hop gains no delay from them (IBB s73 para 5 b (7) p 369).', fix: [`Site the new main posn ${fmtM(arty)} or more beyond the intermediate posn`, 'Or hold a second intermediate posn between them (OOW3 Annex P draws two)', 'Where the space is not there (IBB p 373: depending on the ground and the space available), say so in the plan'] },
  };
}

/**
 * The control measures (R208-R210): a Coy check point behind each forward Coy on its way to the Coy RV (OOW3 Annex Q
 * p 76; IBB s75 para 14 b p 381: where the Pl routes converge if the route is long); the bomb line across the front at the
 * Bn check point (Annex Q p 76), closer to own troops in a withdrawal (OOW3 p 67), its "all clear by" an essential timing
 * (p 19 para 17 c); more than one passage lane through the intermediate posn, with a contact point (OOW3 s10 para 2 c p 48).
 */
export function controlRows(items: { role: string; label?: string; pts: XY[] }[], recipe: Recipe): Check[] {
  const rows: Check[] = [];
  const kindOf = (role: string) => recipe.slots.find((s) => s.role === role)?.kind;
  const fwd = items.filter((i) => kindOf(i.role) === 'fwd' && i.pts.length >= 3);
  const rvs = items.filter((i) => /^rv[A-Z]$/.test(i.role) && i.pts.length);
  const cps = items.filter((i) => /^cp[A-Z]$/.test(i.role) && i.pts.length);
  if (fwd.length && rvs.length) {
    const parts: string[] = [];
    let miss = 0;
    for (const c of fwd) {
      const coy = c.label ?? '';
      const rv = rvs.find((r) => (r.label ?? '').replace(/\s*RV$/, '').trim() === coy);
      if (!rv) continue;
      const rear = Math.max(...c.pts.map((p) => p.y)), cp = cps.find((x) => (x.label ?? '').startsWith(coy));
      const between = cp && cp.pts[0].y >= rear - 1 && cp.pts[0].y <= rv.pts[0].y + 1;
      if (!between) miss++;
      parts.push(`${coy}: ${between ? 'a check pt between the Coy and its RV' : cp ? 'its check pt not between the Coy and its RV' : 'no Coy check pt'}`);
    }
    if (parts.length) rows.push({ name: 'Check points', st: miss ? 'unchecked' : 'pass', reason: `${parts.join('; ')}: OOW3 Annex Q (p 76) draws a Coy check pt behind the Coy, then the Coy RV, the Bn check pt and the Bn RV; IBB s75 para 14 b p 381 wants a Coy check pt where the Pl routes converge if the route is long` });
  }
  const bl = items.find((i) => i.role === 'bl' && i.pts.length);
  rows.push(bl ? { name: 'Bomb line', st: 'pass', reason: 'the BL across the front (OOW3 Annex Q p 76 draws it at the Bn check pt): in a withdrawal it lies closer to own troops and is shifted more often (OOW3 p 67); the time all troops are clear of it is an essential timing, so the artillery and air know when to engage the abandoned posns (OOW3 s2 para 17 c p 19)' }
    : { name: 'Bomb line', st: 'warn', reason: 'no BL drawn: successive bomb lines are laid down in orders, closer to own troops in a withdrawal (OOW3 p 67); all troops clear of the line by a set time (p 19 para 17 c)' });
  // each posn passed through (PASSED): the intermediate posns, and the new posn where the recipe lays a passage there
  const through = PASSED.filter(([role, tag]) => items.some((i) => i.role === role && i.pts.length) && (role !== 'newMain' || recipe.slots.some((s) => s.role === `ct${tag}` || new RegExp(`^pp${tag}\\d$`).test(s.role))));
  const tally = through.map(([, tag, word]) => ({ word, pps: items.filter((i) => new RegExp(`^pp${tag}\\d$`).test(i.role) && i.pts.length).length, ct: items.some((i) => i.role === `ct${tag}` && i.pts.length) }));
  const rule = 'there should be more than one gap and lane through the troops being passed through, recce of them by all commanders, the control measures (report lines, routes, check points, RVs) used to the full (OOW3 s10 para 2 c, h pp 48-49); responsibility passes at a set place or time';
  if (tally.length === 1) {
    const { pps, ct, word } = tally[0];
    rows.push({ name: 'Passage', st: pps >= 2 && ct ? 'pass' : 'warn', reason: `${pps} passage lane${pps === 1 ? '' : 's'}${ct ? ' and a contact point' : ', no contact point'} through ${word}: ${rule}` });
  } else if (tally.length) {
    const short = tally.filter((t) => t.pps < 2 || !t.ct);
    rows.push({ name: 'Passage', st: short.length ? 'warn' : 'pass', reason: `${tally.map((t) => `${t.word}: ${t.pps} lane${t.pps === 1 ? '' : 's'}${t.ct ? ' and a contact point' : ', no contact point'}`).join('; ')}: the rear parties and covering troops withdraw through the FDLs of the force at each intermediate posn and the new main posn, the covering troops last (OOW3 s10 para 1 p 47; Annex P p 75); ${rule}; primary and alternate lanes, assembly areas at both ends, passage, contact, release and control points, a time of passage (para 3 f pp 50-51)` });
  }
  return rows;
}

/**
 * Each Coy RV behind its Coy: "probably 200 to 500 yards in rear" (IBB s75 para 14 a p 381), measured from the Coy posn's
 * rear edge (`withdrawal.coyRvBehindM`, 183-457 m). The RV and the posn are paired by their labels (A Coy RV, A Coy).
 */
export function coyRvRow(items: { role: string; label?: string; pts: XY[] }[], doc: DoctrineSet): Check | null {
  const band = rng(doc, 'withdrawal.coyRvBehindM', [183, 457]);
  const rvs = items.filter((i) => /^rv[A-Z]$/.test(i.role) && i.pts.length);
  const parts: string[] = [];
  let bad = 0;
  for (const rv of rvs) {
    const coy = (rv.label ?? '').replace(/\s*RV$/, '').trim();
    const posn = items.find((i) => i.label === coy && i.pts.length >= 3);
    if (!posn) continue;
    const d = rv.pts[0].y - Math.max(...posn.pts.map((p) => p.y));
    const ok = d >= band[0] - 25 && d <= band[1] + 25;
    if (!ok) bad++;
    parts.push(`${rv.label} ${fmtM(Math.max(0, d))} behind ${coy}${ok ? '' : d < band[0] ? ' (close)' : ' (far)'}`);
  }
  if (!parts.length) return null;
  return {
    name: 'Coy RVs', st: bad ? 'warn' : 'pass', reason: `${parts.join('; ')}: a Coy RV probably 200-500 yd (${fmtM(band[0])}-${fmtM(band[1])}) in rear, where the Coy forms up for the move to the Bn RV; a Coy checkpoint where Pl routes converge if the route is long (IBB s75 para 14 a-b p 381)`,
    detail: bad ? { head: `${bad} Coy RV${bad > 1 ? 's' : ''} outside 200-500 yd`, why: 'Too close, the RV is under the fire that falls on the posn; too far, the Coy is strung out on the way to it at night (IBB p 381).', fix: [`Move it ${fmtM(band[0])}-${fmtM(band[1])} behind the Coy posn, on its route back`] } : undefined,
  };
}

/**
 * The rear parties' own RV and embussing point (IC s92 para 8 c p 487: "A separate embussing point is established for the
 * rear parties near their own RV"; para 14 p 488: their checkpoints / RVs and embussing point "should be well forward"):
 * both drawn, the EP within `withdrawal.rpEpNearM` (E) of the RV, and ahead of (nearer the old posn than) the Bn and Coy
 * EPs. `onGround` slides the EP onto a track where one is near (null: geometry only); returns the row and the EP's nudge.
 * Null row when the plan has no rear parties.
 */
export function rearPartyRvRow(items: { role: string; label?: string; pts: XY[] }[], doc: DoctrineSet, onGround: ((at: XY) => { at: XY; onTrack: boolean } | null) | null): { row: Check | null; nudge: XY | null } {
  const rps = items.filter((i) => /^rp[A-Z]$/.test(i.role) && i.pts.length);
  if (!rps.length) return { row: null, nudge: null };
  const rv = items.find((i) => i.role === 'rvRp' && i.pts.length), ep0 = items.find((i) => i.role === 'epRp' && i.pts.length);
  const rule = 'a separate embussing point for the rear parties near their own RV (IC s92 para 8 c p 487), well forward (para 14 p 488): they leave last, at the time of final abandonment, and are not to march back past the main body';
  if (!rv || !ep0) {
    const what = !rv && !ep0 ? 'no rear party RV or EP' : !rv ? 'no rear party RV' : 'no rear party EP';
    return { row: { name: 'Rear party RV / EP', st: 'warn', reason: `${what}: ${rule}`, detail: { head: what, why: 'The rear parties leave last, under pressure; without their own RV and vehicles well forward they march the whole way back after the main body has gone (IC s92 para 14 p 488).', fix: ['Mark a rear party RV behind the rear parties, on their way back', 'A separate embussing point near it, with vehicles waiting (IC s92 para 8 c p 487)'] } }, nudge: null };
  }
  const read = onGround ? onGround(ep0.pts[0]) : null;
  const ep = read ? read.at : ep0.pts[0];
  const nudge = read && (read.at.x !== ep0.pts[0].x || read.at.y !== ep0.pts[0].y) ? P(read.at.x - ep0.pts[0].x, read.at.y - ep0.pts[0].y) : null;
  const near = num(doc, 'withdrawal.rpEpNearM', 300);
  const d = dist(rv.pts[0], ep);
  // y grows toward the rear: "well forward" = nearer the old posn than every other embussing point
  const others = items.filter((i) => (/^ep[A-Z]$/.test(i.role) || i.role === 'epBn') && i.pts.length);
  const ahead = others.every((o) => ep.y < o.pts[0].y - 1);
  const behindRps = Math.max(...rps.map((r) => r.pts[0].y));
  const back = ep.y - behindRps;
  const track = read ? (read.onTrack ? ', on a track' : `, no track within ${fmtM(num(doc, 'withdrawal.epRoadM', 300))}`) : '';
  const ok = d <= near + 25 && ahead && back > 0 && (!read || read.onTrack);
  const parts = `the rear party EP ${fmtM(d)} from their RV (near: ${fmtM(near)} or less, E)${track}, ${fmtM(Math.max(0, back))} behind the rear parties, ${ahead ? 'ahead of' : 'not ahead of'} the Coy and Bn EPs`;
  return {
    row: { name: 'Rear party RV / EP', st: ok ? 'pass' : 'warn', reason: `${parts}: ${rule}`, detail: ok ? undefined : { head: 'Rear party EP not near their RV and well forward', why: 'The rear parties hold to the time of final abandonment; their vehicles must wait near their RV, well forward, so they break clean without a march past the Bn EP (IC s92 paras 8 c, 14 pp 487-488).', fix: [`Move the EP within ${fmtM(near)} of the rear party RV`, 'Keep it ahead of the Bn and Coy EPs, behind the rear parties', ...(read && !read.onTrack ? ['Recce a track for the vehicles the map does not show'] : [])] } },
    nudge,
  };
}

export function findWithdrawal(res: SolveResult, f: FitFrame, g: PlanGround, doc: DoctrineSet, opts: { enFieldArtyM?: number | null; enFieldArtySrc?: string | null; threat?: XY | null; terrain?: 'plains' | 'obstacle' | 'desert' | 'mountain'; date?: string; enemy?: string | null } = {}): WithdrawalFind {
  const out: WithdrawalFind = { nudges: {}, geom: {}, paths: {}, rows: [], confirm: [], times: [], routes: [] };
  const item = (role: string) => res.items.find((i) => i.role === role);
  const kindOf = (role: string) => res.recipe.slots.find((s) => s.role === role)?.kind;
  const fwd = res.items.filter((i) => kindOf(i.role) === 'fwd' && i.pts.length >= 3);
  if (!fwd.length) return out;
  const W = (p: XY) => toWorld(f, p);
  const clsAt = (p: XY) => { const w = W(p); return g.cls(w.x, w.y); };
  // a delay (PlanDelay) and a withdrawal by day move by day and leave the night's rear parties, covering Pl and programme out
  const delay = res.recipe.layout === 'delay', byDay = res.recipe.layout === 'by-day', day = delay || byDay;
  // the old posn's front (toward the enemy, -y) and the En observer: the threat marker, else 1500 m in front of it
  const frontY = Math.min(...fwd.flatMap((i) => i.pts.map((p) => p.y)));
  const enObs = opts.threat ? toLocal(f, opts.threat) : P(0, frontY - num(doc, 'withdrawal.hisStandoffM', 1500));

  // ── embussing points: 1500-2000 m behind the old posn on the Coy routes (IBB p 383), on a track where one is near ──
  const epBand = rng(doc, 'withdrawal.embussingBehindM', [1500, 2000]);
  const eps = res.items.filter((i) => /^ep[A-Z]$/.test(i.role));
  const epRoadM = num(doc, 'withdrawal.epRoadM', 300);
  const epWords: string[] = [];
  let epOnTrack = 0, epOff = 0;
  /** The nearest track within reach of a place (plan metres), or null. */
  const trackNear = (at: XY): XY | null => {
    let best: XY | null = null, bd = Infinity;
    for (let dx = -epRoadM; dx <= epRoadM; dx += 30) for (let dy = -epRoadM; dy <= epRoadM; dy += 30) {
      const q = P(at.x + dx, at.y + dy), k = clsAt(q);
      if (k !== null && ROADS.has(k)) { const d = Math.hypot(dx, dy); if (d < bd) { bd = d; best = q; } }
    }
    return best;
  };
  for (const ep of eps) {
    const coy = fwd.find((c) => c.label && ep.label?.endsWith(c.label.split(' ')[0])) ?? fwd[eps.indexOf(ep)] ?? fwd[0];
    const behind = ep.pts[0].y - centre(coy.pts).y;
    let at = ep.pts[0];
    const k0 = clsAt(at);
    if (k0 !== null && !ROADS.has(k0)) {
      // the nearest track within reach, keeping the distance behind the posn inside the band
      const best = trackNear(at);
      if (best) { out.nudges[ep.role] = P(best.x - at.x, best.y - at.y); at = best; epOnTrack++; }
      else epOff++;
    } else if (k0 !== null) epOnTrack++;
    epWords.push(`${ep.label ?? ep.role} ${fmtM(behind)} behind ${coy.label ?? 'the Coy'}${k0 === null ? '' : ROADS.has(clsAt(at) ?? -1) ? ', on a track' : `, no track within ${fmtM(epRoadM)}`}`);
    if (behind < epBand[0] - 50 || behind > epBand[1] + 50) out.rows.push({ name: 'Embussing points', st: 'warn', reason: `${ep.label} ${fmtM(behind)} behind the old posn; IBB s75 para 20 p 383 wants ${fmtM(epBand[0])}-${fmtM(epBand[1])} on the Coy routes` });
  }
  if (eps.length) out.rows.push(epOff && !epOnTrack
    ? { name: 'Embussing points', st: 'warn', reason: `${epWords.join('; ')}: no track for the vehicles`, detail: { head: 'No track at the Coy embussing points', why: 'Coy embussing points save marching time only where parallel routes let the vehicles come up (IBB p 383 a; IC s92 para 8 c p 487); with none, one Bn embussing point at or behind the Bn RV (IBB p 383 b; IC p 486: normally one for a Bn).', fix: ['Use the Bn embussing point (EP) behind the Bn RV and bring the Bn RV well forward', 'Recce a track the map does not show'] } }
    : { name: 'Embussing points', st: 'pass', reason: `${epWords.join('; ')} (IBB s75 para 20 p 383: 1500-2000 m behind the old position on the Coy routes; IC s92 para 8 c pp 486-487 makes one Bn embussing point the normal case, more than one well in the rear on the Coy routes only where the Coys are spread out and parallel routes allow: the books differ on which is normal)` });

  // ── routes back on foot: Coy -> Coy RV -> embussing point, round NO-GO; En view along them ──────────────────────
  const night = day ? num(doc, 'moves.footKmh.go', 4) : num(doc, `attack.nightFootKmh.${opts.terrain ?? 'plains'}`, 3);
  const byWord = day ? 'by day' : 'by night', rateSrc = day ? 'IPB p 18 by day' : 'IBB p 18';
  const seenPctMax = num(doc, 'withdrawal.routeSeenPct', 30);
  const rts = res.items.filter((i) => /^rt[A-Z]$/.test(i.role) && i.pts.length >= 2);
  let seenAll = 0, seenN = 0, unknown = 0;
  for (const rt of rts) {
    const pts = rt.pts.map((p, i) => { const ep = eps.find((e) => e.role === `ep${rt.role.slice(2)}`); return i === rt.pts.length - 1 && ep && out.nudges[ep.role] ? P(p.x + out.nudges[ep.role].x, p.y + out.nudges[ep.role].y) : p; });
    const legs: XY[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const av = g.avenues?.(W(pts[i - 1]), W(pts[i]), 100, 'dismounted')?.[0]?.path;
      if (av && av.length > 2) legs.push(...av.slice(1, -1).map((w) => toLocal(f, w)));
      legs.push(pts[i]);
    }
    out.paths[rt.role] = legs;
    const L = lenOf(legs);
    let n = 0, seen = 0;
    if (g.sight) {
      const o = W(enObs);
      for (let d = 0; d <= L; d += 100) {
        let acc = 0, q = legs[0];
        for (let i = 1; i < legs.length; i++) { const s = dist(legs[i - 1], legs[i]); if (acc + s >= d) { const t = (d - acc) / (s || 1); q = P(legs[i - 1].x + (legs[i].x - legs[i - 1].x) * t, legs[i - 1].y + (legs[i].y - legs[i - 1].y) * t); break; } acc += s; q = legs[i]; }
        const w = W(q); const v = g.sight(o.x, o.y, 2, w.x, w.y, 1.7);
        if (v === null) unknown++; else { n++; if (v >= 0.5) seen++; }
      }
    }
    const pct = n ? Math.round((100 * seen) / n) : null;
    if (pct !== null) { seenAll += seen; seenN += n; }
    out.routes.push({ role: rt.role, label: rt.label || `Route ${rt.role.slice(2)}`, lengthM: Math.round(L), min: Math.round((L / 1000 / night) * 60), seenPct: pct, by: day ? 'day' : 'night' });
  }
  if (rts.length) {
    const pct = seenN ? Math.round((100 * seenAll) / seenN) : null;
    out.rows.push(pct === null ? { name: 'Routes hidden', st: 'unchecked', reason: g.sight ? (unknown ? 'the ground along the routes is still loading' : 'no sight read') : 'no sight data' }
      : { name: 'Routes hidden', st: pct <= seenPctMax ? 'pass' : 'warn', reason: `${pct} % of the routes back in En view from ${opts.threat ? 'the threat marker' : `${fmtM(num(doc, 'withdrawal.hisStandoffM', 1500))} in front`} (wants ${seenPctMax} % or less)`,
        detail: pct <= seenPctMax ? undefined : { head: `${pct} % of the routes seen`, why: 'A clean break needs covered routes back (IC s92 para 3 p 484; IBB p 367: good covered lines of withdrawal); open ground the En sees invites fire on the thinning-out.', fix: day ? ['Bend the routes into dead ground (a nullah, the far side of a bund)', 'Smoke and fire support over the open stretches (OOW3 p 43 para 8)', 'Covered and concealed routes of withdrawal are a test of the posn itself (MIB p 237 b (2))'] : ['Bend the routes into dead ground (a nullah, the far side of a bund)', 'Withdraw after last light; harassing fire to cover the noise', 'Rear parties hold until the companies are clear'] } });
    out.rows.push({ name: 'Routes', st: 'pass', reason: out.routes.map((r) => `${r.label} ${fmtM(r.lengthM)}, ${r.min} min ${byWord}`).join('; ') + ` (${night} km/h, ${rateSrc})` });
  }

  // ── defiles and bridges on the routes back (OOW3 pp 12, 28, 44, 46, 55, 62-64) ─────────────────────────────────────
  // each crossing of water on a route as laid on the ground: a bridge, a ford or ferry (the bundle's crossing classes), or
  // water the route runs straight through with no crossing on the map; crossings of different routes close together are
  // one defile they share (withdrawal.defileSharedM, a method setting)
  if (rts.length) {
    const xs: { route: string; s: number; at: XY; word: string; wet: boolean }[] = [];
    let readN = 0;
    // water counts where it stops the troops on foot (rules.json dismounted NO-GO: permanent water, canals); a drain,
    // distributary or stream is waded (caution), not a defile
    const footNogo = g.going('dismounted').nogo;
    // a crossing class within two cells, else a road or railway over the water there (the grid paints the road over its
    // bridge): a crossing whose bridge class is not recorded
    const crossingNear = (q: XY): string | null => {
      let road = false;
      for (let dx = -60; dx <= 60; dx += 30) for (let dy = -60; dy <= 60; dy += 30) { const k = clsAt(P(q.x + dx, q.y + dy)); if (k === null) continue; if (CROSSING_WORD[k] !== undefined) return CROSSING_WORD[k]; if (ROAD_OVER.has(k)) road = true; }
      return road ? 'a road crossing, its bridge class not recorded (recce it)' : null;
    };
    for (const rt of rts) {
      const legs = out.paths[rt.role] ?? rt.pts;
      const label = rt.label || `Route ${rt.role.slice(2)}`;
      let s0 = 0, inRun = false;
      for (let i = 1; i < legs.length; i++) {
        const a = legs[i - 1], b = legs[i], Lg = dist(a, b);
        for (let t = 0; t < Lg; t += 15) {
          const q = P(a.x + ((b.x - a.x) * t) / Lg, a.y + ((b.y - a.y) * t) / Lg), k = clsAt(q);
          if (k !== null) readN++;
          const noGoWater = (c: number | null) => c !== null && WATER.has(c) && footNogo.has(c);
          let hit = k !== null && (CROSSING_WORD[k] !== undefined || noGoWater(k));
          // a road or railway over the water: water on both sides of the route there (up and down the canal), not on one
          // side only as a bank road has
          let roadX = false;
          if (!hit && k !== null && ROAD_OVER.has(k)) {
            const nx = -(b.y - a.y) / Lg, ny = (b.x - a.x) / Lg;
            if (noGoWater(clsAt(P(q.x + nx * 30, q.y + ny * 30))) && noGoWater(clsAt(P(q.x - nx * 30, q.y - ny * 30)))) { hit = true; roadX = true; }
          }
          // a routed path's straight legs may clip the water beside the bridge it uses: a crossing within two cells counts
          const near = hit && !roadX && CROSSING_WORD[k!] === undefined ? crossingNear(q) : null;
          const word = hit ? CROSSING_WORD[k!] ?? (roadX ? 'a road crossing, its bridge class not recorded (recce it)' : near) ?? null : null;
          if (hit && !inRun) xs.push({ route: label, s: s0 + t, at: q, word: word ?? 'a canal or permanent water with no crossing on the map', wet: word === null });
          else if (hit && word && xs[xs.length - 1].wet) { xs[xs.length - 1].word = word; xs[xs.length - 1].wet = false; }
          inRun = hit;
        }
        s0 += Lg;
      }
    }
    const sharedM = num(doc, 'withdrawal.defileSharedM', 500);
    const names = [...new Set(rts.map((rt) => rt.label || `Route ${rt.role.slice(2)}`))];
    // a place every route crosses within sharedM of: one defile for the whole withdrawal
    const shared = names.length >= 2 ? xs.find((x) => names.every((nm) => xs.some((y) => y.route === nm && dist(y.at, x.at) <= sharedM))) ?? null : null;
    const wet = xs.filter((x) => x.wet);
    const list = names.map((nm) => { const mine = xs.filter((x) => x.route === nm); return mine.length ? `${nm}: ${mine.map((x) => `${x.word} at ${fmtM(x.s)}`).join(', ')}` : `${nm}: none`; }).join('; ');
    const rule = 'AD, AT and a security detachment at each defile and bridge on the routes back (OOW3 s2 para 9 p 12, s5 para 8 p 28), the AD deployed at the points likely to be attacked by air before the move starts (s9 para 2 b p 44); the bridges reserve demolitions, specifically controlled, with guards and firing parties, covered by the artillery, fired after the last troops are over (s12 paras 2-3 p 55, p 62 para 8, p 64 para 10 b)';
    out.rows.push(!readN ? { name: 'Defiles on routes', st: 'unchecked', reason: 'the ground along the routes is still loading' }
      : shared ? { name: 'Defiles on routes', st: 'warn', reason: `every route back crosses ${shared.word} within ${fmtM(sharedM)} of one place (${list}): one defile for the whole withdrawal, a target for the En air and for En airborne or heliborne troops sent to seize defiles and bridges (OOW3 s9 para 6 p 46); ${rule}`,
        detail: { head: 'One crossing for every route back', why: 'If the En air or a heliborne party closes that one crossing, nothing gets back: the routes should not converge on it (OOW3 p 8 para 5 a: several axes; p 46 para 6).', fix: ['A second crossing for one of the routes (recce a ford or a bridge the map does not show)', 'Protect it: AD, a security detachment and a mobile reserve close to it (OOW3 p 46 para 7)', 'Engineer bridging or ferries ready to replace it if the En destroys it (OOW3 p 63 para 9 b)'] } }
        : wet.length ? { name: 'Defiles on routes', st: 'warn', reason: `${wet.map((x) => `${x.route} crosses a canal or permanent water with no crossing on the map at ${fmtM(x.s)}`).join('; ')} (${list}): recce a crossing or move the route; ${rule}`,
          detail: { head: `${wet.length} route${wet.length > 1 ? 's' : ''} across water without a crossing`, why: 'The route as laid crosses water the map shows no bridge, ford or ferry on: the troops cannot get back that way at night.', fix: ['Move the route to the nearest bridge or ford', 'Engineers to bridge it or a ferry before the move (OOW3 p 63 para 9 b)'] } }
          : xs.length ? { name: 'Defiles on routes', st: 'pass', reason: `${list}: ${rule}` }
            : { name: 'Defiles on routes', st: 'pass', reason: `no water crossed on the ${names.length} route${names.length > 1 ? 's' : ''} back; AD and a security detachment still at the defiles and bottlenecks on the way (OOW3 pp 12, 28)` });
  }

  // ── the month's weather: may it let a withdrawal be made by day (OOW3 s2 para 5 b p 9) ──────────────────────────────
  // the bundle's NOAA GSOD visibility for the month at the old posn: fog, haze / dust, a view under 2 km
  if (!delay && g.visibility) {
    const date = opts.date ?? todayIn();
    const month = Number(date.slice(5, 7)) || 1;
    const here = W(P(0, frontY));
    const v = g.visibility(here.x, here.y, month);
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1];
    if (!v || (v.fogPct === null && v.hazePct === null && v.lt2kmPct === null)) {
      out.rows.push({ name: 'Weather', st: 'unchecked', reason: g.pending() ? 'the month\'s visibility is still loading' : 'no visibility figures for this place (the bundle\'s NOAA GSOD grid)' });
    } else {
      const poor = Math.min(100, Math.round(Math.max(v.lt2kmPct ?? 0, (v.fogPct ?? 0) + (v.hazePct ?? 0))));
      const far = v.stationKm !== null && v.stationKm > 100 ? `; the nearest station ${Math.round(v.stationKm)} km off, a guess` : '';
      const pc = (x: number | null) => (x === null ? '?' : `${Math.round(x)} %`);
      const figs = `${MON} at the old posn: fog on ${pc(v.fogPct)} of the days, haze or dust ${pc(v.hazePct)}, a view under 2 km ${pc(v.lt2kmPct)}${v.meanViewKm !== null ? `, mean view ${v.meanViewKm.toFixed(1)} km` : ''} (NOAA GSOD${far})`;
      const rule = 'adverse weather is on the whole more favourable to the withdrawing force, impeding the En\'s mobility and the En air; though a withdrawal is generally by night, heavy rain, mist, fog, dust storms and thick haze may let it be made by day as well (OOW3 s2 para 5 b p 9); rain is not read here';
      const minPct = num(doc, 'withdrawal.dayWeatherMinPct', 25);
      if (byDay) out.rows.push(poor >= minPct
        ? { name: 'Weather', st: 'pass', m: poor, reason: `${figs}: about ${poor} % of the days hide a daylight withdrawal (wants ${minPct} %, E): wait for such a day; ${rule}` }
        : { name: 'Weather', st: 'warn', m: poor, reason: `${figs}: about ${poor} % of the days hide a daylight withdrawal (wants ${minPct} %, E): on most days the En sees it from the outset and engages from long range (OOW3 s8 para 5 p 42); ${rule}`,
          detail: { head: `Poor visibility on only ${poor} % of ${MON}'s days`, why: 'A daylight withdrawal is avoided unless the weather favours it or the roads necessitate it (OOW3 s8 para 1 p 40); this month seldom gives the cover.', fix: ['Withdraw by night (OOW3 s9 pp 43-47)', 'Smoke over the open stretches and the crossing places (OOW3 p 43 para 8)', 'Own air for the critical stages (OOW3 p 42 para 4)'] } });
      else out.rows.push({ name: 'Weather', st: 'pass', m: poor, reason: `${figs}: fog or haze on about ${poor} % of the days also covers a night withdrawal, and on such a day one by day becomes possible; ${rule}` });
    }
  }

  // ── a formation: the civil population and the HQ by the main artery (OOW3 s15-16 pp 68-70; s14 para 16 p 65) ─────
  if (isFmnWithdrawal(res.recipe)) {
    const probe = g.mov?.() ?? null;
    const nmC = item('newMain');
    // people in the zone the force withdraws through: the width of the old posn and the new, from the old FDL to the new
    // posn's front, sampled every 2 km on the population grid (WorldPop 2026, people per km2: an estimate, not a census)
    let people = 0, popRead = 0, zoneW = 0, zoneD = 0;
    if (probe && nmC && nmC.pts.length >= 3) {
      const xs = [...fwd.flatMap((i) => i.pts.map((p) => p.x)), ...nmC.pts.map((p) => p.x)];
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y1 = Math.min(...nmC.pts.map((p) => p.y));
      zoneW = x1 - x0; zoneD = y1 - frontY;
      const step = 2000;
      for (let x = x0 + step / 2; x < x1; x += step) for (let y = frontY + step / 2; y < y1; y += step) {
        const w = W(P(x, y)); const dn = probe.people(w.x, w.y);
        if (dn !== null && Number.isFinite(dn)) { people += dn * (step / 1000) * (step / 1000); popRead++; }
      }
    }
    // built-up areas the troops' routes pass through (class 3), a run longer than withdrawal.buaRunM
    const runM = num(doc, 'withdrawal.buaRunM', 150);
    const towns: { route: string; s: number; m: number }[] = [];
    let clsRead = 0;
    for (const rt of rts) {
      const legs = out.paths[rt.role] ?? rt.pts;
      const label = rt.label || `Route ${rt.role.slice(2)}`;
      let s0 = 0, start: number | null = null, s = 0;
      for (let i = 1; i < legs.length; i++) {
        const a = legs[i - 1], b = legs[i], Lg = dist(a, b);
        for (let t = 0; t < Lg; t += 30) {
          s = s0 + t;
          const k = clsAt(P(a.x + ((b.x - a.x) * t) / Lg, a.y + ((b.y - a.y) * t) / Lg));
          if (k !== null) clsRead++;
          if (k === 3) { if (start === null) start = s; } else if (start !== null) { if (s - start >= runM) towns.push({ route: label, s: start, m: s - start }); start = null; }
        }
        s0 += Lg;
      }
      if (start !== null && s - start >= runM) towns.push({ route: label, s: start, m: s - start });
    }
    const rule = 'the civil population may block the roads with refugees, the En\'s fifth column active among them and the En air adding to it (OOW3 s16 para 1 p 69); if the evacuation is decided, roads are allotted to the civil authorities and the troops\' roads kept clear, cross-country routes developed for the troops (p 70 para 4; s15 para 2 d p 68); precautionary instructions to the people issued well ahead (p 70 para 3); strong measures only by the highest level controlling the withdrawal (p 70 para 4)';
    const popWord = popRead ? `about ${Math.round(people / 1000) * 1000 >= 1000 ? `${(Math.round(people / 1000) * 1000).toLocaleString('en-US')}` : Math.round(people)} people live in the ${fmtM(zoneW)} x ${fmtM(zoneD)} the force withdraws through (WorldPop 2026, an estimate, not a census)` : null;
    if (!popRead && !clsRead) out.rows.push({ name: 'Civil population', st: 'unchecked', reason: g.pending() ? 'the population grid and the ground along the routes are still loading' : 'no population grid or ground read here' });
    else out.rows.push(towns.length
      ? { name: 'Civil population', st: 'warn', reason: `${popWord ? `${popWord}; ` : ''}${towns.map((x) => `${x.route} runs ${fmtM(x.m)} through a built-up area at ${fmtM(x.s)}`).join('; ')}: ${rule}`,
        detail: { head: `${towns.length} route${towns.length > 1 ? 's' : ''} back through built-up areas`, why: 'A town on the route back fills with refugees and stops the columns at night; the En air finds them there (OOW3 s16 para 1 p 69).', fix: ['Bend the route round the town on a cross-country track (OOW3 s15 para 2 d p 68)', 'Allot the road through the town to the civil authorities and keep the troops off it (OOW3 p 70 para 4)', 'Traffic control posts and provost at the town (OOW3 s2 para 14 h p 17)'] } }
      : { name: 'Civil population', st: 'pass', reason: `${popWord ? `${popWord}; ` : ''}no route back runs through a built-up area${clsRead ? '' : ' (the ground along them not read)'}: ${rule}` });

    // the HQ by the main artery or an existing signal centre (s14 para 16 p 65)
    const hq = item('hq');
    if (hq && hq.pts.length) {
      const at = hq.pts[0], lim = num(doc, 'withdrawal.hqArteryM', 1000), look = 3000;
      const MAIN = new Set([34, 35, 36, 37]);
      let best: { d: number; k: number } | null = null, known = false;
      for (let dx = -look; dx <= look; dx += 60) for (let dy = -look; dy <= look; dy += 60) {
        const dd = Math.hypot(dx, dy); if (dd > look || (best && dd >= best.d)) continue;
        const k = clsAt(P(at.x + dx, at.y + dy)); if (k !== null) known = true;
        if (k !== null && MAIN.has(k)) best = { d: dd, k };
      }
      const w = W(at);
      const comms = probe ? probe.features(w.x, w.y, look, new Set(['post_office', 'telephone_exchange', 'wireless_station']))[0] ?? null : null;
      const commsWord = comms ? `; ${comms.label}${comms.name ? ` (${comms.name})` : ''} ${fmtM(comms.distM)} off` : '';
      const ruleHq = 'withdrawing formations locate their HQs as close as possible to the main artery or the existing signal communication centres, to save signal resources and time; HQs are often split, control on one posn and recce on another (OOW3 s14 para 16 p 65)';
      const ok = (best && best.d <= lim) || (comms && comms.distM <= lim);
      out.rows.push(!known ? { name: 'HQ by the artery', st: 'unchecked', reason: 'the ground round the HQ is still loading' }
        : ok ? { name: 'HQ by the artery', st: 'pass', reason: `${hq.label || 'the HQ'}${best ? ` ${fmtM(best.d)} from a ${g.label(best.k).toLowerCase()}` : ''}${commsWord} (within ${fmtM(lim)}, E): ${ruleHq}` }
          : { name: 'HQ by the artery', st: 'warn', reason: `${hq.label || 'the HQ'}: ${best ? `the nearest metalled road ${fmtM(best.d)} off` : `no metalled road within ${fmtM(look)}`}${commsWord} (wants ${fmtM(lim)}, E): ${ruleHq}`,
            detail: { head: best ? `HQ ${fmtM(best.d)} from the main road` : 'HQ off the road net', why: 'Away from the artery the signals are stretched by the withdrawal itself; a split HQ on the main road keeps control (OOW3 p 65 para 16).', fix: ['Site the HQ (or its main part) on the main artery the routes back use', 'Or beside a telephone exchange or post office: an existing signal centre', 'Line laid back along the artery before the move (OOW3 p 65 para 14)'] } });
    }
  }

  // ── a posn on the ground: water across the way in front of it, its view and its flanks (OOW3 s6 para 16 p 33) ──────
  /**
   * Water across the way in front of a posn, between fromY (just inside it) and toY (the posn before, or the old posn's
   * front): the class grid sampled every 15 m (a canal or drain is one or two 30 m cells) on three lines across the posn's
   * width, then the mapped canals and rivers crossing the way (a river, or a canal recorded 10 m wide or more): the one
   * nearest the posn counts.
   */
  const waterAcross = (pts: XY[], fromY: number, toY: number): { known: boolean; y: number | null; word: string } => {
    const c = centre(pts);
    const pw = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
    let water: number | null = null;
    for (const dx of [0, -pw / 3, pw / 3]) {
      for (let y = fromY; y > toY + 300; y -= 15) { const k = clsAt(P(c.x + dx, y)); if (k !== null && WATER.has(k)) { if (water === null || y > water) water = y; break; } }
    }
    let named: { y: number; name: string; wM: number | null } | null = null;
    const mov = (g.mov?.() ?? null) as unknown as { lines?: (x: number, y: number, r: number, kinds: Set<string>) => { kind: string; xy: [number, number][]; attrs?: Record<string, unknown> }[] } | null;
    if (mov?.lines) {
      const a = P(c.x, toY + 300), b = P(c.x, fromY);
      const mid = W(P(c.x, (a.y + b.y) / 2));
      const len = (b.y - a.y) * f.k;
      for (const l of mov.lines(mid.x, mid.y, len / 2 + 200, new Set(['canal', 'river'])) ?? []) {
        const lp = l.xy.map((q) => toLocal(f, { x: q[0], y: q[1] }));
        for (let i = 1; i < lp.length; i++) {
          const p0 = lp[i - 1], p1 = lp[i];
          if ((p0.x - c.x) * (p1.x - c.x) > 0 || p0.x === p1.x) continue;
          const y = p0.y + ((c.x - p0.x) / (p1.x - p0.x)) * (p1.y - p0.y);
          if (y <= a.y || y >= b.y) continue;
          const wRaw = Number(l.attrs?.w);
          const wM = Number.isFinite(wRaw) && wRaw > 0 ? wRaw : null;
          // a mapped line counts when it is a river, or a canal recorded 10 m wide or more (a narrower or unrecorded one only by the class grid)
          if (l.kind !== 'river' && (wM === null || wM < 10)) continue;
          if (!named || y > named.y) named = { y, name: String(l.attrs?.n ?? (l.kind === 'river' ? 'a river' : 'a canal')), wM };
        }
      }
    }
    const known = clsAt(P(c.x, (toY + fromY) / 2)) !== null;
    const nm0 = named as { y: number; name: string; wM: number | null } | null;
    const y = nm0 && (water === null || nm0.y >= water - 200) ? nm0.y : water;
    const word = nm0 && y === nm0.y ? `${nm0.name}${nm0.wM ? ` (${Math.round(nm0.wM)} m wide)` : ''}` : 'water';
    return { known, y, word };
  };
  /** The view to a posn's front (OOW3 s6 para 16 a, c p 33), read as a delaying posn's is, and how far its front stands above the ground in front. */
  const viewRow = (pts: XY[], name: string, what: string): void => {
    if (!g.sight) return;
    const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x)), yF = Math.min(...pts.map((p) => p.y));
    const viewM = num(doc, 'withdrawal.delay.viewM', 3000), viewPct = num(doc, 'withdrawal.delay.viewPct', 50);
    let n = 0, seen = 0;
    for (const fx of [0.2, 0.5, 0.8]) { const a = W(P(x0 + (x1 - x0) * fx, yF)); for (let r = 500; r <= viewM; r += 250) { const b = W(P(x0 + (x1 - x0) * fx, yF - r)); const v = g.sight(a.x, a.y, 2, b.x, b.y, 2); if (v !== null) { n++; if (v >= 0.5) seen++; } } }
    const pct = n ? Math.round((100 * seen) / n) : null;
    // a ridge across the En advance (para 16 a): the front edge against the ground 1-2 km in front, on the 30 m elevation
    const zAt = (dy0: number, dy1: number) => { const v: number[] = []; for (const fx of [0.2, 0.5, 0.8]) for (let dy = dy0; dy <= dy1; dy += 500) { const w = W(P(x0 + (x1 - x0) * fx, yF - dy)); const z = g.elev(w.x, w.y); if (Number.isFinite(z)) v.push(z); } return v.length ? v.reduce((s, z) => s + z, 0) / v.length : null; };
    const zF = zAt(0, 0), zA = zAt(1000, 2000);
    const rise = zF !== null && zA !== null ? Math.round(zF - zA) : null;
    const riseWord = rise === null ? '' : `; its front ${rise >= 0 ? `${rise} m above` : `${-rise} m below`} the ground 1-2 km in front (30 m elevation)`;
    out.rows.push(pct === null ? { name, st: 'unchecked', reason: `the ground in front of ${what} is still loading` }
      : { name, st: pct >= viewPct ? 'pass' : 'warn', reason: `${pct} % of the ground 0.5-${fmtM(viewM)} in front of ${what} seen from it (wants ${viewPct} %, E)${riseWord}: high ground with good observation and long fields of fire; a series of parallel ridges across the En advance (OOW3 s6 para 16 a, c p 33)` });
  };
  /** Its flanks on water or tank NO-GO within its own width (OOW3 s6 paras 16 b, 22 pp 33-34). */
  const flankRow = (pts: XY[], name: string, what: string): void => {
    const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x)), yF = Math.min(...pts.map((p) => p.y)), yR = Math.max(...pts.map((p) => p.y));
    const tank = g.going('tracked').nogo;
    const blocks = (k: number | null) => k !== null && (WATER.has(k) || tank.has(k));
    const side = (sx: number) => { let known = false; for (let dx = 30; dx <= x1 - x0; dx += 30) for (let y = yF; y <= yR; y += 60) { const k = clsAt(P(sx < 0 ? x0 - dx : x1 + dx, y)); if (k !== null) known = true; if (blocks(k)) return 'yes'; } return known ? 'no' : 'unknown'; };
    const Ls = side(-1), Rs = side(1);
    out.rows.push(Ls === 'unknown' && Rs === 'unknown' ? { name, st: 'unchecked', reason: `the ground beside ${what} is still loading` }
      : { name, st: Ls === 'yes' && Rs === 'yes' ? 'pass' : 'warn', reason: `left flank ${Ls === 'yes' ? 'on water or tank NO-GO' : 'open'}, right flank ${Rs === 'yes' ? 'on water or tank NO-GO' : 'open'} within its own width: rivers, canals, unfordable streams, marshy areas and mines in front and on the flanks; adequate frontage so the En cannot overrun it by a quick outflanking (OOW3 s6 paras 16 b, 22 pp 33-34)${Ls === 'yes' && Rs === 'yes' ? '' : '; mines, or a flank guard, on the open flank'}` });
  };
  const rearOf = (pts: XY[]) => Math.max(...pts.map((p) => p.y));

  // ── the intermediate posn: beyond En field artillery, behind an obstacle if there is one (IBB p 373; IC pp 481-482) ──
  const ip = item('intPosn');
  const arty = opts.enFieldArtyM ?? num(doc, 'withdrawal.intermediateMinM', 17200);
  const artySrc = opts.enFieldArtySrc ?? 'the En 105 mm IFG, 17.2 km (ORBAT weapons.json en-105-mm-ifg-lfg)';
  if (ip && ip.pts.length >= 3) {
    const c = centre(ip.pts);
    const back = c.y - frontY;
    out.rows.push(back >= arty - 1
      ? { name: 'Intermediate posn', st: 'pass', reason: `${fmtM(back)} behind the old posn: the En must move En field artillery (${artySrc}) before the En can range it (IBB s74 para 4 e p 373; IC s91 para 3 b p 481)` }
      : { name: 'Intermediate posn', st: 'warn', reason: `${fmtM(back)} behind the old posn: inside the reach of En field artillery (${artySrc}); IBB s74 para 4 e p 373 and IC s91 para 3 b p 481 want the En to at least move En guns first`,
        detail: { head: `Intermediate posn ${fmtM(back)} back, En guns reach ${fmtM(arty)}`, why: 'The En guns in their present areas range it: no delay is forced on the En while the En attacks it.', fix: [`Put it ${fmtM(arty)} or more back`, 'Or make it a delaying posn for the covering troops only'] } });
    // an obstacle between: water across the way, from the old posn to the intermediate posn
    const wa = waterAcross(ip.pts, c.y - 400, frontY);
    out.rows.push(!wa.known ? { name: 'Behind an obstacle', st: 'unchecked', reason: 'the ground between is still loading' }
      : wa.y !== null ? { name: 'Behind an obstacle', st: 'pass', reason: `${wa.word} ${fmtM(c.y - wa.y)} in front of the intermediate posn (IC s91 para 3 e p 482: behind a natural obstacle, if available)` }
        : { name: 'Behind an obstacle', st: 'warn', reason: 'no water between the old posn and the intermediate posn (IC s91 para 3 e p 482: behind a natural obstacle, if available)', detail: { head: 'No obstacle in front of it', why: 'Without an obstacle the En closes on the intermediate posn without pause; it is held by a Coy group with less depth than a normal posn (IBB p 373 d).', fix: ['Move it behind the nearest canal, river or ditch', 'Demolitions and mines in front of it: engineer tasks in a withdrawal (IC s93 para 3 b p 489)'] } });
    // its view to the front and its flanks (OOW3 s6 para 16 b-c p 33: obstacles in front and on the flanks; high ground
    // with good observation and long fields of fire); the view read as a delaying posn's is (withdrawal.delay.viewM / viewPct)
    viewRow(ip.pts, 'Int posn view', 'the intermediate posn');
    flankRow(ip.pts, 'Int posn flanks', 'the intermediate posn');
    // a formation's second intermediate posn: again beyond the En field artillery (OOW3 p 33 para 16), read on the ground
    // as the first is (para 16 b-c is for every intermediate posn); the new main posn from the last
    const ip2 = item('intPosn2');
    const last = ip2 && ip2.pts.length >= 3 ? ip2 : ip;
    if (last !== ip) {
      out.rows.push(hopRow('Second int posn', ip.label ?? 'Int Posn 1', last.label ?? 'Int Posn 2', Math.min(...last.pts.map((p) => p.y)) - rearOf(ip.pts), arty, artySrc));
      const c2 = centre(last.pts), w2 = waterAcross(last.pts, c2.y - 400, rearOf(ip.pts));
      out.rows.push(!w2.known ? { name: 'Int posn 2 obstacle', st: 'unchecked', reason: 'the ground between Int Posn 1 and Int Posn 2 is still loading' }
        : w2.y !== null ? { name: 'Int posn 2 obstacle', st: 'pass', reason: `${w2.word} ${fmtM(c2.y - w2.y)} in front of Int Posn 2: rivers, canals, unfordable streams, marshy areas and mines in front (OOW3 s6 para 16 b p 33); a subsidiary demolition belt in front of it helps the covering troops make a clean break (s12 para 5 b p 56)` }
          : { name: 'Int posn 2 obstacle', st: 'warn', reason: 'no water between Int Posn 1 and Int Posn 2: intermediate posns are naturally strong, with rivers, canals, unfordable streams, marshy areas and mines in front and on the flanks (OOW3 s6 para 16 b p 33)', detail: { head: 'No obstacle in front of Int Posn 2', why: 'Held with less depth and the fewest troops (OOW3 p 34 para 22), an intermediate posn needs the ground to stop the En: without it the En closes on it without pause.', fix: ['Site it behind the nearest canal, river or ditch across the way', 'A subsidiary demolition belt and mines in front of it (OOW3 s12 para 5 b p 56)'] } });
      viewRow(last.pts, 'Int posn 2 view', 'Int Posn 2');
      flankRow(last.pts, 'Int posn 2 flanks', 'Int Posn 2');
    }
    const nm = item('newMain');
    if (nm && nm.pts.length >= 3) {
      const gap = Math.min(...nm.pts.map((p) => p.y)) - rearOf(last.pts);
      out.rows.push(newMainRow(doc, centre(nm.pts).y - frontY, gap, arty, artySrc));
    }
  }
  // the new posn of a formation: a river or canal in front for the primary demolition belt (OOW3 s12 paras 1, 5 a pp 54-56)
  const nmP = item('newMain');
  if (nmP && nmP.pts.length >= 3 && res.recipe.slots.some((s) => s.role === 'dmlBelt')) {
    const before = ['intPosn', 'intPosn2'].map(item).filter((i): i is NonNullable<typeof i> => !!i && i.pts.length >= 3);
    const topN = Math.min(...nmP.pts.map((p) => p.y));
    const within = num(doc, 'withdrawal.beltWaterWithinM', 1500);
    const toY = Math.max(before.length ? Math.max(...before.map((i) => rearOf(i.pts))) : frontY, topN - within - 300);
    const wn = waterAcross(nmP.pts, topN + 200, toY);
    out.rows.push(!wn.known ? { name: 'New posn obstacle', st: 'unchecked', reason: 'the ground in front of the new posn is still loading' }
      : wn.y !== null ? { name: 'New posn obstacle', st: 'pass', reason: `${wn.word} ${wn.y <= topN ? `${fmtM(topN - wn.y)} in front of` : 'along'} the new posn's front: the primary demolition belt on it, every means of crossing destroyed (bridges, fords, ferries), potential crossing places cratered and the gaps filled with mines or ditches, covered by the new posn's weapons (OOW3 s12 paras 1, 5 a pp 54-56)` }
        : { name: 'New posn obstacle', st: 'warn', reason: `no river or canal within ${fmtM(within)} of the new posn's front: the primary demolition belt is sited on a natural obstacle (OOW3 s12 para 1 pp 54-55); without one it must be made across the whole front by mines and ditches (para 5 a p 56), the main engineer effort on the new posn (p 63 para 9 c)`,
          detail: { head: 'No natural obstacle in front of the new posn', why: 'A demolition belt on a river or canal forces the En to halt and organise an assault crossing before going on (OOW3 p 54); on open ground the belt is all engineer work.', fix: ['Where the higher Comd\'s area allows, the new posn behind the nearest river or canal (OOW3 p 39 para 1: the higher Comd lays it down)', 'Mines and ditches across the front, the likely crossing places first, more engineers to the new posn (OOW3 p 63)'] } });
  }

  // ── artillery repositioned 5000-6000 m back before the posn is abandoned (IBB p 385) ─────────────────────────────
  const an = item('artyNew');
  if (an) {
    const band = rng(doc, 'withdrawal.artyRepositionM', [5000, 6000]);
    // 5000-6000 m back from the old gun area, taken at the Bn's rear (the reserve) when no gun area is on the plan
    const rear = res.items.filter((i) => kindOf(i.role) === 'res' || kindOf(i.role) === 'depth');
    const from = rear.length ? Math.max(...rear.map((i) => centre(i.pts).y)) : frontY;
    const back = centre(an.pts).y - from;
    out.rows.push({ name: 'Artillery', st: back >= band[0] - 50 && back <= band[1] + 50 ? 'pass' : 'warn', reason: `part of the artillery repositioned ${fmtM(back)} back from the old gun area (taken at the Bn's rear) to cover the last troops out (IBB s76 para 5 p 385: ${fmtM(band[0])}-${fmtM(band[1])}); the rest stays and increases its activity (para 6)` });
  }

  // ── rear parties and the covering platoon ───────────────────────────────────────────────────────────────────────
  if (!delay) out.rows.push(...controlRows(res.items, res.recipe));
  if (delay || byDay) {
    const r2 = delay ? delayRows(res.items, res.recipe, doc) : byDayRows(res.items, res.recipe);
    out.rows.push(...r2.rows);
    if (delay) out.rows.push(...delayGroundRows(res.items, res.recipe, doc, g.sight ? (a, b) => { const p = W(a), q = W(b); return g.sight!(p.x, p.y, 2, q.x, q.y, 2); } : null, clsAt, WATER));
    if (opts.terrain === 'desert') out.rows.push(delay
      ? { name: 'Desert', st: 'pass', reason: 'in the desert the covering troops fight from successive delaying posns or leap-frog back from alternate posns, deflecting the En from the En axis or canalising the En into a killing ground (DW s7 para 9 b p 25); armour based, mounted: no move back on foot for any distance (DW s9 pp 32-33)' }
      : desertWdrRow(out.routes, doc, !!item('intPosn')));
    out.confirm.push(...r2.confirm);
    if (byDay) out.confirm.push('Bridges on the routes back: reserve demolitions, specifically controlled, with demolition guards and firing parties, fired only after the last troops are over, covered by the artillery (OOW3 pp 55, 63-64); AD, AT and a security detachment at the defiles and bridges on the routes back (OOW3 pp 12, 28)', 'The intermediate posn: a complete Coy group under one commander, AT weapons and some armour if available (IBB s74 para 4 b-c p 373)');
    return out;
  }
  const rv = coyRvRow(res.items, doc);
  if (rv) out.rows.push(rv);
  const rps = res.items.filter((i) => /^rp[A-Z]$/.test(i.role));
  const fmn = isFmnWithdrawal(res.recipe), sub = res.recipe.echelon === '21' ? 'Bdes' : 'Bns';
  out.rows.push(fmn
    ? { name: 'Rear parties', st: rps.length >= fwd.length ? 'pass' : 'warn', reason: `${rps.length} rear part${rps.length === 1 ? 'y' : 'ies'} for ${fwd.length} forward ${sub}: the formations and units in contact leave a portion to remain in contact, deny the En knowledge of the withdrawal and protect it (OOW3 s9 para 5 p 45), holding till the prescribed time (p 44 para 2 e); they must cover the different approaches to the posns (p 27)` }
    : { name: 'Rear parties', st: rps.length >= fwd.length ? 'pass' : 'warn', reason: `${rps.length} rear part${rps.length === 1 ? 'y' : 'ies'} for ${fwd.length} forward Coys: a platoon from each with part of the weapon section, under one commander, holding to the time of abandonment (IC s92 paras 13-14 p 488)` });
  if (item('covPl')) out.rows.push({ name: 'Covering Pl', st: 'pass', reason: 'a platoon of the depth Coys covers the Bn embussing point and withdraws after the Bn has embussed (IBB s75 para 11 d, g pp 379-380); the depth Coys send troops back early to protect the Bn RV / embussing points, withdrawing after these close (IC s92 para 11 p 487)' });
  // the rear parties' own RV and embussing point, well forward (IC s92 para 8 c p 487, para 14 p 488)
  if (!fmn) {
    const rr = rearPartyRvRow(res.items, doc, (at) => {
      const k0 = clsAt(at);
      if (k0 === null) return null;
      if (ROADS.has(k0)) return { at, onTrack: true };
      const best = trackNear(at);
      return best ? { at: best, onTrack: true } : { at, onTrack: false };
    });
    if (rr.nudge) out.nudges.epRp = rr.nudge;
    if (rr.row) out.rows.push(rr.row);
  }
  // the En approaches onto the old posn: each must meet a rear party's weapons where it reaches the front (OOW3 p 27)
  if (rps.length && g.avenues) {
    const reach = num(doc, 'withdrawal.rearPartyReachM', 457);
    const posns = res.items.filter((i) => ['fwd', 'depth', 'res'].includes(kindOf(i.role) ?? '') && i.pts.length >= 3);
    const mid = centre(posns.flatMap((i) => i.pts));
    const avs = g.avenues(W(enObs), W(mid), 500, 'dismounted') ?? [];
    const words: string[] = [];
    let open = 0;
    avs.slice(0, 3).forEach((av, n) => {
      const pts = av.path.map((w) => toLocal(f, w));
      // where the approach reaches the old posn's front line
      let at: XY | null = null;
      for (let i = 1; i < pts.length && !at; i++) if ((pts[i - 1].y - frontY) * (pts[i].y - frontY) <= 0 && pts[i].y !== pts[i - 1].y) { const t = (frontY - pts[i - 1].y) / (pts[i].y - pts[i - 1].y); at = P(pts[i - 1].x + t * (pts[i].x - pts[i - 1].x), frontY); }
      if (!at) return;
      const d = Math.min(...rps.map((r) => dist(r.pts[0], at!)));
      if (d > reach) open++;
      words.push(`approach ${n + 1} reaches the front ${d <= reach ? `${fmtM(d)} from a rear party` : `${fmtM(d)} from the nearest rear party, beyond its ${fmtM(reach)}`}`);
    });
    if (words.length) out.rows.push({ name: 'Rear parties per apch', st: open ? 'warn' : 'pass', reason: `${words.join('; ')}: rear parties must cover the different approaches that lead to the posns (OOW3 s5 p 27); a rear party's reach taken as its MG 1A3, ${fmtM(reach)} (ORBAT)`,
      detail: open ? { head: `${open} approach${open > 1 ? 'es' : ''} past the rear parties' reach`, why: 'An approach no rear party covers lets the En close on the posn unseen and learn of the withdrawal before the time of abandonment (OOW3 p 27; IC s92 para 13 p 488).', fix: ['Site a rear party over that approach (its weapons sited on it)', 'An extra Pl from a forward Coy where the approaches outnumber the Coys'] } : undefined });
  }
  if (fmn) { const fr = fmnWdrRows(res.items, res.recipe, doc); out.rows.push(...fr.rows); out.confirm.push(...fr.confirm); }
  // time and space: the depth at the En's contested rate against the delay ordered or the new posn's prep (OOW3 pp 9-10)
  const tsr = timeSpaceRow(res.items, res.recipe, doc, { enemy: opts.enemy ?? null, terrain: opts.terrain ?? null });
  if (tsr) out.rows.push(tsr);

  // ── the programme from last light (IBB s75 para 11 pp 379-380, the book's guide) ─────────────────────────────────
  const prog = (doctrineAt(doc, 'withdrawal.programmeMin') as Record<string, number>) ?? { echelons: 15, controlPoints: 105, depthWithdraw: 135, rearPartyIn: 165, denial: 180 };
  const src = 'IBB s75 para 11 pp 379-380';
  const T = (label: string, atMin: number) => out.times.push({ label, atMin, src });
  const thin = num(doc, 'withdrawal.thinOutBeforeDenialMin', 10);
  T('Last light', 0);
  T('Recce parties to the new main posn (by day, before)', -600);
  // the essential timing before which no rearward move may take place, except by the recce parties (IC s90 para 15 a (2)
  // p 478): the first rearward move of the programme, the echelons and the non-essential stores after last light
  out.times.push({ label: 'No rearward move before this, except by the recce parties: an essential timing the Comd lays down (IC s90 para 15 a (2) p 478)', atMin: prog.echelons, src: 'IC s90 para 15 a (2) p 478' });
  T('AD deployed at the points likely to be attacked by En air: the defiles and bridges on the routes back (OOW3 p 44 para 2 b; p 28)', Math.max(0, prog.echelons - 15));
  T('A and B echelons withdraw in small packets; non-essential stores and personnel soon after last light (IC s92 para 9 p 487)', prog.echelons);
  T('Checkpoints, RVs and embussing points manned; a Pl of the depth Coys covers the Bn EP', prog.controlPoints);
  T('Depth Coys and Bn HQ (less the CP) withdraw; rear parties take over from the forward Coys', prog.depthWithdraw);
  T('Rear parties in position', prog.rearPartyIn);
  // thinning out: normally a few minutes before the time of denial; the depth Pl and Coy HQ (less the Coy Comd, his set and
  // runner) of each forward Coy leave first, at it (IC s90 para 15 b (1) p 479; s92 para 12 p 488)
  out.times.push({ label: `Forward Coys thin out: the depth Pl and Coy HQ less the Coy Comd, set and runner leave (IC s90 para 15 b (1) p 479: normally a few minutes before the time of denial; s92 para 12 p 488; ${thin} min taken, E)`, atMin: prog.denial - thin, src: 'IC s90 para 15 b (1) p 479; s92 para 12 p 488' });
  // the mortars: IBB withdraws the Bn mortars with the CP at the time of denial (s75 para 11 g p 380); IC keeps them able to
  // fire until the last possible moment and supporting the rear parties till the last minute (s92 paras 1, 13 pp 484, 488):
  // the books differ, so a part of the mortars stays with the rear parties to the time of final abandonment
  T('Time of denial: Bn Comd hands over to the rear party Comd; CP and the Bn mortars less a part withdraw (IBB p 380), the part kept answering calls for fire for the rear parties till the last minute (IC s92 paras 1, 13 pp 484, 488); forward Pls less the rear parties begin to withdraw (IC s92 para 12 p 488)', prog.denial);
  const longest = Math.max(0, ...out.routes.map((r) => r.min));
  if (longest) T('Forward Coys clear of their embussing points', prog.denial + longest);
  if (item('bl')) T('All troops clear of the BL (OOW3 p 19 para 17 c: so the artillery and air may engage)', prog.denial + longest);
  T('Rear parties thin out (MIB p 223: about 30 min before the time of final abandonment)', prog.denial + longest);
  T('Rear parties leave at the time of final abandonment (laid down by Bde; IC s90 para 15 b (2) p 479), with the mortars kept for them, to their own RV and embussing point well forward (IC s92 paras 8 c, 14 pp 487-488); the covering Pl withdraws after the Bn has embussed', prog.denial + longest + 30);
  out.rows.push({ name: 'Timings', st: 'pass', reason: `${fmn ? `each forward ${sub.slice(0, -1)}'s programme in the pattern of a Bn's, ` : ''}the programme from last light: echelons L+${prog.echelons} min, control points manned L+${prog.controlPoints}, depth Coys out L+${prog.depthWithdraw}, rear parties in L+${prog.rearPartyIn}, denial L+${prog.denial}${longest ? `; the forward Coys clear their EPs L+${prog.denial + longest}` : ''} (${src}: a guide; Bde lays down the denial time, the no-move-before time and the clear-line time, s74 para 17 p 377; IC s90 para 15 pp 478-479 the same essential timings); no rearward move before L+${prog.echelons} except by the recce parties (IC p 478); thinning out L+${prog.denial - thin}, a few minutes before the time of denial (IC p 479; ${thin} min, E); a part of the mortars stays with the rear parties to the end (IC s92 paras 1, 13; IBB p 380 withdraws them with the CP at denial: the books differ)` });
  // ── before daylight: tonight's darkness at the posn against the programme (OOW3 s9 para 1 p 44) ─────────────────
  // the programme runs from last light to the rear parties leaving at the time of final abandonment, then their drive to
  // the next posn back at the night rate of vehicles blacked out (moves.vehNightKmh, IPB p 18); light from the Move
  // Planner's LightBook (civil twilight) at the old posn, tonight unless a date is given
  {
    const here = W(P(0, frontY));
    const [lng, lat] = mercToLngLat(here.x, here.y);
    const date = opts.date ?? todayIn();
    const clock = clockFrom(date);
    const light = new LightBook(clock, 'civil');
    // tonight: last light on the day, then the next first light after it
    const d0 = light.day(0, lat, lng);
    const d1 = { first: Number.isFinite(d0.last) ? light.nextChange(d0.last + 60000, lat, lng) : NaN };
    if (Number.isFinite(d0.last) && Number.isFinite(d1.first) && d1.first > d0.last) {
      const darkMin = (d1.first - d0.last) / 60000;
      const rpOut = prog.denial + longest + 30;
      const next = [item('intPosn'), item('newMain')].find((i) => i && i.pts.length >= 3);
      const hop = next ? Math.max(0, centre(next.pts).y - frontY) : 0;
      const veh = num(doc, 'moves.vehNightKmh', 8);
      const drive = (hop / 1000 / veh) * 60;
      const end = rpOut + drive;
      const what = `the rear parties leave at L+${Math.round(rpOut)} min (the time of final abandonment)${next ? `, then ${fmtM(hop)} to ${next.label ?? 'the next posn'} at ${veh} km/h by night, blacked out (IPB p 18): in at L+${Math.round(end)}` : ''}`;
      const night = `tonight (${dateOf(clock, d0.last)}) at the old posn last light ${clockHHMM(clock, d0.last)}, first light ${clockHHMM(clock, d1.first)} (civil twilight, PKT): ${durText(darkMin)} of darkness`;
      const rule = 'a night withdrawal starts at such a time as to finish before daylight, the hours of darkness used to the full for the main body\'s move (OOW3 s9 para 1 pp 43-44)';
      out.rows.push(end <= darkMin
        ? { name: 'Before daylight', st: 'pass', m: Math.round(end), reason: `${what}; ${night}, ${durText(darkMin - end)} to spare: ${rule}` }
        : { name: 'Before daylight', st: 'warn', m: Math.round(end), reason: `${what}; ${night}: ${durText(end - darkMin)} past first light; ${rule}`,
          detail: { head: `${durText(end - darkMin)} past first light`, why: 'The last troops still moving at first light are seen by the En ground and air; a daylight withdrawal is not undertaken against En air superiority (OOW3 p 15 para 12, p 44 para 1).', fix: ['Over two nights, one posn abandoned each night (OOW3 Annex A p 71: the withdrawal carried out over ___ nights)', 'The vehicles forward to the Coy RVs to cut the walk (IBB s75 para 20 p 383)', 'A nearer next posn for the rear parties, still beyond the En field artillery (OOW3 p 33 para 16)'] } });
    }
  }
  if (opts.terrain === 'desert') out.rows.push(desertWdrRow(out.routes, doc, !!item('intPosn')));
  if (opts.terrain === 'mountain') out.rows.push({ name: 'By day?', st: 'pass', reason: 'difficult ground (bog, thickly wooded areas and hills) may make a daylight withdrawal the only practical means (OOW3 s2 pp 8-9); not one under the En air superiority (OOW3 p 15)' });
  out.confirm.push('Routes back walked by day by the Coy / Pl Comds and memorised; Coy RVs and the Bn checkpoint recognisable at night (IC s91 para 5 b p 483)', 'Normal activity, wireless traffic and harassing fire kept up to the last (IC s91 paras 7-9 p 483); the line left intact to the end', 'Non-essential stores and personnel out soon after last light under the CQMH (IC s91 para 6 p 483)', 'Demolitions and mines (engineers), the abandoned posns booby trapped (IC s93 para 3 b, e p 489); bridges to prepare', 'The intermediate posn: a complete Coy group under one commander, AT weapons and some armour if available (IBB s74 para 4 b-c p 373)', 'Bridges on the routes back: reserve demolitions, specifically controlled, with demolition guards and firing parties, fired only after the last troops are over, covered by the artillery (OOW3 pp 55, 63-64); AD, AT and a security detachment at the defiles and bridges on the routes back (OOW3 pp 12, 28)', 'The withdrawal finishes before daylight: the hours of darkness used for the main body\'s move (OOW3 p 44 para 1)', 'Routes converging on the axes of withdrawal from the outer flanks protected; which routes to block and which to keep open (OOW3 s2 para 5 a p 8)', 'With tanks or APCs: the mech elements leave together; by night the tanks first against an infantry threat, last against armour; ATGM first against infantry, second last against armour; mortars until the posn is abandoned; MGs last (MIB pp 225-228); mounted, only RVs, no checkpoints (MIB pp 225, 230-231)', 'MGs forward as long as possible; some AT guns in position until shortly before it is abandoned; the FOO with the Coys (IC s92 para 1 p 484)');
  return out;
}

// ── geometry rows (PlanSolve) and the fitted layout (PlanFit) ────────────────────────────────────────────────────────

/** The rows the figures alone settle: embussing points, the intermediate posn's distance, the artillery, the rear parties. */
export function withdrawalGeometryRows(items: { role: string; label: string; pts: XY[] }[], recipe: Recipe, doc: DoctrineSet): { rows: Check[]; confirm: string[]; grey?: [string, string][] } {
  const rows: Check[] = [];
  const kindOf = (role: string) => recipe.slots.find((s) => s.role === role)?.kind;
  const fwd = items.filter((i) => kindOf(i.role) === 'fwd' && i.pts.length >= 3);
  const item = (role: string) => items.find((i) => i.role === role);
  if (!fwd.length) return { rows, confirm: [] };
  if (recipe.layout === 'delay') return { ...delayRows(items, recipe, doc), grey: [['Routes hidden', 'the routes back to DP 2 in the En view from the threat marker'], ['Long range obsn', 'the ground in front of each delaying posn seen from it (MIB p 237)'], ['Obstacles in front', 'water across the front of each delaying posn (MIB p 237)'], ['Defiles on routes', 'water crossed on the routes back and whether every route shares one crossing (OOW3 pp 12, 46)']] };
  const frontY = Math.min(...fwd.flatMap((i) => i.pts.map((p) => p.y)));
  const band = rng(doc, 'withdrawal.embussingBehindM', [1500, 2000]);
  const eps = items.filter((i) => /^ep[A-Z]$/.test(i.role));
  const behinds = eps.map((ep) => { const coy = fwd.find((c) => ep.label?.endsWith((c.label ?? '').split(' ')[0])) ?? fwd[eps.indexOf(ep)] ?? fwd[0]; return { ep, m: ep.pts[0].y - centre(coy.pts).y }; });
  if (behinds.length) rows.push({ name: 'Embussing points', st: behinds.every((b) => b.m >= band[0] - 50 && b.m <= band[1] + 50) ? 'pass' : 'warn', reason: `${behinds.map((b) => `${b.ep.label} ${fmtM(b.m)}`).join(', ')} behind the Coys (IBB s75 para 20 p 383: ${fmtM(band[0])}-${fmtM(band[1])} on the Coy routes; on a track: read with the terrain)` });
  const rvRow = coyRvRow(items, doc);
  if (rvRow) rows.push(rvRow);
  rows.push(...controlRows(items, recipe));
  const ip = item('intPosn');
  if (ip) {
    const back = centre(ip.pts).y - frontY, want = num(doc, 'withdrawal.intermediateMinM', 17200);
    rows.push({ name: 'Intermediate posn', st: back >= want - 1 ? 'pass' : 'warn', reason: `${fmtM(back)} behind the old posn: the En must move the field artillery (105 mm IFG ${fmtM(want)}, ORBAT) before ranging it (IBB s74 para 4 e p 373); held by a Coy group (IBB p 381)` });
    const ip2 = item('intPosn2'), last = ip2 ?? ip, src = `105 mm IFG ${fmtM(want)}, ORBAT`;
    if (ip2) rows.push(hopRow('Second int posn', ip.label || 'Int Posn 1', ip2.label || 'Int Posn 2', Math.min(...ip2.pts.map((p) => p.y)) - Math.max(...ip.pts.map((p) => p.y)), want, src));
    const nm = item('newMain');
    if (nm) { const gap = Math.min(...nm.pts.map((p) => p.y)) - Math.max(...last.pts.map((p) => p.y)); rows.push(newMainRow(doc, centre(nm.pts).y - frontY, gap, want, src)); }
  }
  const an = item('artyNew');
  if (an) {
    const b2 = rng(doc, 'withdrawal.artyRepositionM', [5000, 6000]);
    const rear = items.filter((i) => kindOf(i.role) === 'res' || kindOf(i.role) === 'depth');
    const from = rear.length ? Math.max(...rear.map((i) => centre(i.pts).y)) : frontY;
    const back = centre(an.pts).y - from;
    rows.push({ name: 'Artillery', st: back >= b2[0] - 50 && back <= b2[1] + 50 ? 'pass' : 'warn', reason: `part of the artillery repositioned ${fmtM(back)} back from the old gun area (taken at the Bn rear) (IBB s76 para 5 p 385: ${fmtM(b2[0])}-${fmtM(b2[1])})` });
  }
  if (recipe.layout === 'by-day') { const d = byDayRows(items, recipe); return { rows: [...rows, ...d.rows], confirm: d.confirm, grey: [['Routes hidden', 'the routes back in the En view from the threat marker'], ['Behind an obstacle', 'water between the old posn and the intermediate posn'], ['Defiles on routes', 'water crossed on the routes back and whether every route shares one crossing (OOW3 pp 12, 46)'], ['Weather', 'the month\'s fog, haze and dust days at the old posn (OOW3 p 9)']] }; }
  const rps = items.filter((i) => /^rp[A-Z]$/.test(i.role));
  if (isFmnWithdrawal(recipe)) {
    const sub = recipe.echelon === '21' ? 'Bdes' : 'Bns';
    rows.push({ name: 'Rear parties', st: rps.length >= fwd.length ? 'pass' : 'warn', reason: `${rps.length} for ${fwd.length} forward ${sub}: each leaves a portion in contact to protect the withdrawal (OOW3 s9 para 5 p 45), covering the approaches to the posns (p 27)` });
    const fr = fmnWdrRows(items, recipe, doc);
    const ts = timeSpaceRow(items, recipe, doc);
    if (ts) fr.rows.push(ts);
    const has = (r: string) => recipe.slots.some((s) => s.role === r);
    const grey: [string, string][] = [['Routes hidden', 'the routes back in the En view from the threat marker']];
    if (has('intPosn')) grey.push(['Behind an obstacle', 'water between the old posn and Int Posn 1']);
    if (has('intPosn2')) grey.push(['Int posn 2 obstacle', 'water between Int Posn 1 and Int Posn 2 (OOW3 p 33)']);
    if (has('newMain') && has('dmlBelt')) grey.push(['New posn obstacle', 'a river or canal in front of the new posn for the primary demolition belt (OOW3 pp 54-56)']);
    grey.push(['Weather', 'the month\'s fog, haze and dust days at the old posn (OOW3 p 9)'], ['Civil population', 'people in the zone withdrawn through and the routes through built-up areas (OOW3 pp 68-70)'], ['HQ by the artery', 'a metalled road or a signal centre near the HQ (OOW3 p 65)']);
    grey.push(['Defiles on routes', 'water crossed on the routes back and whether every route shares one crossing (OOW3 pp 12, 46)'], ['Before daylight', 'tonight\'s darkness at the posn against the programme and the drive back (OOW3 p 44)']);
    return { rows: [...rows, ...fr.rows], confirm: fr.confirm, grey };
  }
  rows.push({ name: 'Rear parties', st: rps.length >= fwd.length ? 'pass' : 'warn', reason: `${rps.length} for ${fwd.length} forward Coys: a platoon from each with part of the weapon section (IC s92 para 13 p 488)` });
  const tsBn = timeSpaceRow(items, recipe, doc);
  if (tsBn) rows.push(tsBn);
  if (item('covPl')) rows.push({ name: 'Covering Pl', st: 'pass', reason: 'a platoon of the depth Coys covers the Bn embussing point (IBB s75 para 11 d p 379; IC s92 para 11 p 487)' });
  const rr = rearPartyRvRow(items, doc, null).row;
  if (rr) rows.push(rr);
  const prog = (doctrineAt(doc, 'withdrawal.programmeMin') as Record<string, number>) ?? { echelons: 15, controlPoints: 105, depthWithdraw: 135, rearPartyIn: 165, denial: 180 };
  const thin = num(doc, 'withdrawal.thinOutBeforeDenialMin', 10);
  rows.push({ name: 'Timings', st: 'pass', reason: `from last light: echelons L+${prog.echelons} min (no rearward move before it except the recce parties, IC s90 para 15 a (2) p 478), control points manned L+${prog.controlPoints}, depth Coys out L+${prog.depthWithdraw}, rear parties in L+${prog.rearPartyIn}, thinning out L+${prog.denial - thin} (a few minutes before denial, IC s90 para 15 b (1) p 479; ${thin} min, E), denial L+${prog.denial} (IBB s75 para 11 pp 379-380, a guide; the march to the EPs is read with the terrain); a part of the mortars stays with the rear parties to the end (IC s92 paras 1, 13 pp 484, 488; IBB p 380 withdraws them at denial: the books differ)` });
  return { grey: [['Routes hidden', 'the routes back in the En view from the threat marker or the En FUP'], ['Behind an obstacle', 'water between the old posn and the intermediate posn'], ['Weather', 'the month\'s fog, haze and dust days at the old posn (OOW3 p 9)'], ['Defiles on routes', 'water crossed on the routes back and whether every route shares one crossing (OOW3 pp 12, 46)'], ['Before daylight', 'tonight\'s darkness at the posn against the programme and the drive back (OOW3 p 44)']], rows, confirm: ['Routes back walked by day; Coy RVs and the Bn checkpoint recognisable at night (IC s91 para 5 b p 483)', 'Normal activity and harassing fire kept up to the last; the line left intact to the end (IC s91 paras 7-9 p 483)', 'Demolitions and mines in front of the intermediate posn, the abandoned posns booby trapped (engineer tasks: IC s93 para 3 b, e p 489)'] };
}

/**
 * A withdrawal fitted where it rests (PlanFit.fitLayout hands these over): the aim stretches the new main posn, the
 * click is the old posn's HQ. Without the ground the geometry stands, its ground rows grey.
 */
export function fitWithdrawal(inp: FitLayoutInput): FittedLayout | null {
  const { recipe, ctx, ground } = inp;
  const k = 1 / Math.cos(2 * Math.atan(Math.exp(inp.anchor.y / 6378137)) - Math.PI / 2);
  const aimM = inp.cursor ? Math.hypot(inp.cursor.x - inp.anchor.x, inp.cursor.y - inp.anchor.y) / k : null;
  const geom0 = withdrawalGeom(recipe, ctx.doc, aimM && aimM > 500 ? aimM : null);
  const opts = { ...inp.opts, geom: { ...geom0, ...(inp.opts.geom ?? {}) } };
  const base = solveRecipe(recipe, ctx, opts);
  const pivotItem = base.items.find((i) => i.id === base.pivotId);
  if (!pivotItem) return null;
  const frame: FitFrame = { anchor: inp.anchor, bearing: inp.bearing, k, pivot: pivotItem.pts[0] };
  inp.begin?.();
  const known = ground.cls(inp.anchor.x, inp.anchor.y) !== null || Number.isFinite(ground.elev(inp.anchor.x, inp.anchor.y));
  const read = known ? findWithdrawal(base, frame, ground, ctx.doc, { enFieldArtyM: inp.enFieldArtyM ?? null, enFieldArtySrc: inp.enFieldArtySrc ?? null, threat: inp.threat ?? null, terrain: inp.terrain && inp.terrain !== 'auto' ? inp.terrain : 'plains', enemy: inp.enemy?.type ?? null }) : null;
  const raw = read ? solveRecipe(recipe, ctx, { ...opts, nudges: { ...(inp.opts.nudges ?? {}), ...read.nudges }, geom: { ...opts.geom, ...read.geom }, paths: read.paths }) : base;
  // the ground's rows replace the geometry's of the same name; a delay has no intermediate posn to stand behind an obstacle
  const fresh = new Set((read?.rows ?? []).map((r) => r.name));
  if (recipe.layout === 'delay') fresh.add('Behind an obstacle');
  const rows0 = read ? [...base.rows.filter((r) => !fresh.has(r.name)), ...read.rows] : base.rows;
  const rows = recipe.layout === 'delay' ? rows0.filter((r) => r.name !== 'Behind an obstacle') : rows0;
  const fails = rows.filter((r) => r.st === 'fail').length, warns = rows.filter((r) => r.st === 'warn').length;
  const fit: FitResult = {
    nudges: read?.nudges ?? {}, slides: [], killingGr: null, slots: {}, rows, approaches: [],
    score: Math.max(0, 100 - 25 * fails - 6 * warns), fails, warns,
    pending: ground.pending(), data: ground.dataLine(), from: inp.threat ?? null, fromAssumed: !inp.threat,
    paths: read?.paths,
    withdrawal: read ? { paths: read.paths, times: read.times, routes: read.routes, confirm: read.confirm } : undefined,
  };
  const res: SolveResult = {
    ...raw, mode: read ? 'terrain' : 'geometry', rows, slots: [],
    confirm: read ? [...read.confirm, ...base.confirm.filter((x) => !read.confirm.includes(x))] : base.confirm,
    assumptions: read ? [`Fitted to the ground: ${fit.data}.`, ...(inp.threat ? [] : ['No threat marked: the En observer is taken 1.5 km in front of the old posn.'])] : base.assumptions,
  };
  // the ground it was read on, for the card's Ground row
  const terrain = inp.terrain && inp.terrain !== 'auto' ? { kind: inp.terrain, source: 'user' as const } : known ? detectTerrain(ground, frame, raw, recipe, ctx.doc) : null;
  return { recipe, res, raw, fit, frame, anchor: inp.anchor, bearing: inp.bearing, manual: {}, terrain, enemy: null, unit: null };
}

// ── Check my plan: a withdrawal built here, read as drawn ───────────────────────────────────────────────────────────

/** Check my plan for a withdrawal built here: its symbols by role, as drawn (nothing moved), read with the build's rows. */
export interface WithdrawalCheck { rows: Check[]; confirm: string[]; reading: Pick<WithdrawalFind, 'paths' | 'times' | 'routes' | 'confirm'>; pending: boolean; read: string[]; missing: string[] }
export function checkWithdrawal(inp: FitLayoutInput, drawn: Record<string, { pts: [number, number][] }>): WithdrawalCheck | null {
  const { recipe, ctx, ground } = inp;
  const hq = drawn.hq?.pts[0], nm = (drawn.newMain ?? drawn.dp3 ?? drawn.dp2)?.pts, ip = drawn.intPosn?.pts;
  if (!hq) return null;
  // the frame: the HQ is the pivot, the plan faces the new main posn (the way of withdrawal), else the intermediate posn, else the bearing given
  const ctrW = (pts: [number, number][]) => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length] as [number, number];
  const aim = nm?.length ? ctrW(nm) : ip?.length ? ctrW(ip) : null;
  const bearing = aim ? Math.atan2(aim[0] - hq[0], aim[1] - hq[1]) : inp.bearing;
  const k = 1 / Math.cos(2 * Math.atan(Math.exp(hq[1] / 6378137)) - Math.PI / 2);
  const f: FitFrame = { anchor: { x: hq[0], y: hq[1] }, bearing, k, pivot: P(0, 0) };
  const items: SolveResult['items'] = [];
  for (const s of recipe.slots) {
    const d = drawn[s.role];
    if (!d?.pts.length) continue;
    items.push({ id: `chk-${s.role}`, role: s.role, key: s.sym, label: s.label ?? s.role, pts: d.pts.map((q) => toLocal(f, { x: q[0], y: q[1] })), geo: s.kind === 'point' ? 'Point' : s.kind === 'line' ? 'Line' : 'Area' } as SolveResult['items'][number]);
  }
  const base = { recipe, items } as SolveResult;
  inp.begin?.();
  const read = findWithdrawal(base, f, ground, ctx.doc, { enFieldArtyM: inp.enFieldArtyM ?? null, enFieldArtySrc: inp.enFieldArtySrc ?? null, threat: inp.threat ?? null, terrain: inp.terrain && inp.terrain !== 'auto' ? inp.terrain : 'plains', enemy: inp.enemy?.type ?? null });
  const need = recipe.layout === 'delay' ? ['hq', 'fwdL', 'fwdR', 'res', 'dp2', 'dp3']
    : recipe.layout === 'by-day' ? ['hq', 'fwdL', 'fwdR', 'depth', 'res', 'freshA', 'freshB', 'ppA', 'ppB', 'intPosn', 'newMain']
      : isFmnWithdrawal(recipe) ? ['hq', 'fwdL', 'fwdR', ...['res', 'resNew', 'intPosn', 'intPosn2'].filter((r) => recipe.slots.some((s) => s.role === r)), 'newMain']
      : ['hq', 'fwdL', 'fwdR', 'rvA', 'rvB', 'bnRv', 'epA', 'epB', 'rvRp', 'epRp', 'intPosn', 'newMain'];
  const names = (r: string) => recipe.slots.find((s) => s.role === r)?.label || r;
  return { rows: read.rows, confirm: read.confirm, reading: { paths: read.paths, times: read.times, routes: read.routes, confirm: read.confirm }, pending: ground.pending(), read: [...new Set(Object.keys(drawn).map(names))], missing: need.filter((r) => !drawn[r]).map(names) };
}
