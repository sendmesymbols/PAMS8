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
import { toLocal, toWorld } from './PlanFit';
import { delayGeom, delayRows, delayGroundRows, byDayRows } from './PlanDelay';
import { isFmnWithdrawal, fmnWdrGeom, fmnWdrRows, hopRow } from './PlanWithdrawalFmn';

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
export const hhmm = (min: number) => `${String(Math.floor(((min % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}${String(Math.round(((min % 60) + 60) % 60)).padStart(2, '0')}`;

/** Geometry at the aim: the new main posn at the aimed distance (the second click), the intermediate posn in between. */
export function withdrawalGeom(recipe: Recipe, doc: DoctrineSet, aimM: number | null): Record<string, { pts: XY[] }> {
  if (recipe.layout === 'delay') return delayGeom(recipe, doc, aimM);
  return withPassage(isFmnWithdrawal(recipe) ? fmnWdrGeom(recipe, doc, aimM) : bnWdrGeom(recipe, doc, aimM), recipe);
}

/**
 * The passage through the intermediate posn (OOW3 s10 para 2 c p 48: more than one gap and lane): the passage points
 * (ppI1, ppI2 ...) spread along its front edge, the contact point (ctI) at the middle of it.
 */
function withPassage(g: Record<string, { pts: XY[] }>, recipe: Recipe): Record<string, { pts: XY[] }> {
  const ip = g.intPosn?.pts;
  if (!ip?.length) return g;
  const x0 = Math.min(...ip.map((p) => p.x)), x1 = Math.max(...ip.map((p) => p.x)), yF = Math.min(...ip.map((p) => p.y));
  const pps = recipe.slots.filter((s) => /^ppI\d$/.test(s.role));
  pps.forEach((s, i) => { g[s.role] = { pts: [P(x0 + ((x1 - x0) * (i + 1)) / (pps.length + 1), yF)] }; });
  if (recipe.slots.some((s) => s.role === 'ctI')) g.ctI = { pts: [P((x0 + x1) / 2, yF)] };
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
  if (items.some((i) => i.role === 'intPosn' && i.pts.length)) {
    const pps = items.filter((i) => /^ppI\d$/.test(i.role) && i.pts.length), ct = items.some((i) => i.role === 'ctI' && i.pts.length);
    rows.push({ name: 'Passage', st: pps.length >= 2 && ct ? 'pass' : 'warn', reason: `${pps.length} passage lane${pps.length === 1 ? '' : 's'}${ct ? ' and a contact point' : ', no contact point'} through the intermediate posn: there should be more than one gap and lane through the troops being passed through, recce of them by all commanders, the control measures (report lines, routes, check points, RVs) used to the full (OOW3 s10 para 2 c, h pp 48-49); responsibility passes at a set place or time` });
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

export function findWithdrawal(res: SolveResult, f: FitFrame, g: PlanGround, doc: DoctrineSet, opts: { enFieldArtyM?: number | null; enFieldArtySrc?: string | null; threat?: XY | null; terrain?: 'plains' | 'obstacle' | 'desert' | 'mountain' } = {}): WithdrawalFind {
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

  // ── the intermediate posn: beyond En field artillery, behind an obstacle if there is one (IBB p 373; IC pp 481-482) ──
  const ip = item('intPosn');
  if (ip && ip.pts.length >= 3) {
    const c = centre(ip.pts);
    const back = c.y - frontY;
    const arty = opts.enFieldArtyM ?? num(doc, 'withdrawal.intermediateMinM', 17200);
    const artySrc = opts.enFieldArtySrc ?? 'the En 105 mm IFG, 17.2 km (ORBAT weapons.json en-105-mm-ifg-lfg)';
    out.rows.push(back >= arty - 1
      ? { name: 'Intermediate posn', st: 'pass', reason: `${fmtM(back)} behind the old posn: the En must move En field artillery (${artySrc}) before the En can range it (IBB s74 para 4 e p 373; IC s91 para 3 b p 481)` }
      : { name: 'Intermediate posn', st: 'warn', reason: `${fmtM(back)} behind the old posn: inside the reach of En field artillery (${artySrc}); IBB s74 para 4 e p 373 and IC s91 para 3 b p 481 want the En to at least move En guns first`,
        detail: { head: `Intermediate posn ${fmtM(back)} back, En guns reach ${fmtM(arty)}`, why: 'The En guns in their present areas range it: no delay is forced on the En while the En attacks it.', fix: [`Put it ${fmtM(arty)} or more back`, 'Or make it a delaying posn for the covering troops only'] } });
    // an obstacle between: water across the way, from the old posn to the intermediate posn
    // the class grid sampled every 15 m (a canal or drain is one or two 30 m cells) on three lines across the posn's width,
    // then the mapped canals and rivers (the 1:50k lines) crossing the way back: the nearest to the intermediate posn counts
    const ipW = Math.max(...ip.pts.map((p) => p.x)) - Math.min(...ip.pts.map((p) => p.x));
    let water: number | null = null;
    for (const dx of [0, -ipW / 3, ipW / 3]) {
      for (let y = c.y - 400; y > frontY + 300; y -= 15) { const k = clsAt(P(c.x + dx, y)); if (k !== null && WATER.has(k)) { if (water === null || y > water) water = y; break; } }
    }
    let named: { y: number; name: string; wM: number | null } | null = null;
    const mov = (g.mov?.() ?? null) as unknown as { lines?: (x: number, y: number, r: number, kinds: Set<string>) => { kind: string; xy: [number, number][]; attrs?: Record<string, unknown> }[] } | null;
    if (mov?.lines) {
      const a = P(c.x, frontY + 300), b = P(c.x, c.y - 400);
      const mid = W(P(c.x, (a.y + b.y) / 2));
      const len = (b.y - a.y) * f.k;
      for (const l of mov.lines(mid.x, mid.y, len / 2 + 200, new Set(['canal', 'river'])) ?? []) {
        const pts = l.xy.map((q) => toLocal(f, { x: q[0], y: q[1] }));
        for (let i = 1; i < pts.length; i++) {
          const p0 = pts[i - 1], p1 = pts[i];
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
    const known = clsAt(P(c.x, (frontY + c.y) / 2)) !== null;
    const obstY = named && (water === null || named.y >= water - 200) ? named.y : water;
    const obstWord = named && obstY === named.y ? `${named.name}${named.wM ? ` (${Math.round(named.wM)} m wide)` : ''}` : 'water';
    out.rows.push(!known ? { name: 'Behind an obstacle', st: 'unchecked', reason: 'the ground between is still loading' }
      : obstY !== null ? { name: 'Behind an obstacle', st: 'pass', reason: `${obstWord} ${fmtM(c.y - obstY)} in front of the intermediate posn (IC s91 para 3 e p 482: behind a natural obstacle, if available)` }
        : { name: 'Behind an obstacle', st: 'warn', reason: 'no water between the old posn and the intermediate posn (IC s91 para 3 e p 482: behind a natural obstacle, if available)', detail: { head: 'No obstacle in front of it', why: 'Without an obstacle the En closes on the intermediate posn without pause; it is held by a Coy group with less depth than a normal posn (IBB p 373 d).', fix: ['Move it behind the nearest canal, river or ditch', 'Demolitions and mines in front of it: engineer tasks in a withdrawal (IC s93 para 3 b p 489)'] } });
    // its view to the front and its flanks (OOW3 s6 para 16 b-c p 33: obstacles in front and on the flanks; high ground
    // with good observation and long fields of fire); the view read as a delaying posn's is (withdrawal.delay.viewM / viewPct)
    const x0 = Math.min(...ip.pts.map((p) => p.x)), x1 = Math.max(...ip.pts.map((p) => p.x)), yF = Math.min(...ip.pts.map((p) => p.y)), yR = Math.max(...ip.pts.map((p) => p.y));
    if (g.sight) {
      const viewM = num(doc, 'withdrawal.delay.viewM', 3000), viewPct = num(doc, 'withdrawal.delay.viewPct', 50);
      let n = 0, seen = 0;
      for (const fx of [0.2, 0.5, 0.8]) { const a = W(P(x0 + (x1 - x0) * fx, yF)); for (let r = 500; r <= viewM; r += 250) { const b = W(P(x0 + (x1 - x0) * fx, yF - r)); const v = g.sight(a.x, a.y, 2, b.x, b.y, 2); if (v !== null) { n++; if (v >= 0.5) seen++; } } }
      const pct = n ? Math.round((100 * seen) / n) : null;
      out.rows.push(pct === null ? { name: 'Int posn view', st: 'unchecked', reason: 'the ground in front of the intermediate posn is still loading' }
        : { name: 'Int posn view', st: pct >= viewPct ? 'pass' : 'warn', reason: `${pct} % of the ground 0.5-${fmtM(viewM)} in front of the intermediate posn seen from it (wants ${viewPct} %, E): high ground with good observation and long fields of fire; a series of parallel ridges across the En advance (OOW3 s6 para 16 a, c p 33)` });
    }
    const tank = g.going('tracked').nogo;
    const blocks = (k: number | null) => k !== null && (WATER.has(k) || tank.has(k));
    const side = (sx: number) => { let known = false; for (let dx = 30; dx <= x1 - x0; dx += 30) for (let y = yF; y <= yR; y += 60) { const k = clsAt(P(sx < 0 ? x0 - dx : x1 + dx, y)); if (k !== null) known = true; if (blocks(k)) return 'yes'; } return known ? 'no' : 'unknown'; };
    const L = side(-1), R = side(1);
    out.rows.push(L === 'unknown' && R === 'unknown' ? { name: 'Int posn flanks', st: 'unchecked', reason: 'the ground beside the intermediate posn is still loading' }
      : { name: 'Int posn flanks', st: L === 'yes' && R === 'yes' ? 'pass' : 'warn', reason: `left flank ${L === 'yes' ? 'on water or tank NO-GO' : 'open'}, right flank ${R === 'yes' ? 'on water or tank NO-GO' : 'open'} within its own width: rivers, canals, unfordable streams, marshy areas and mines in front and on the flanks; adequate frontage so the En cannot overrun it by a quick outflanking (OOW3 s6 paras 16 b, 22 pp 33-34)${L === 'yes' && R === 'yes' ? '' : '; mines, or a flank guard, on the open flank'}` });
    // a formation's second intermediate posn: again beyond the En field artillery (OOW3 p 33 para 16); the new main posn from the last
    const ip2 = item('intPosn2');
    const last = ip2 && ip2.pts.length >= 3 ? ip2 : ip;
    if (last !== ip) out.rows.push(hopRow('Second int posn', ip.label ?? 'Int Posn 1', last.label ?? 'Int Posn 2', Math.min(...last.pts.map((p) => p.y)) - Math.max(...ip.pts.map((p) => p.y)), arty, artySrc));
    const nm = item('newMain');
    if (nm && nm.pts.length >= 3) {
      const gap = Math.min(...nm.pts.map((p) => p.y)) - Math.max(...last.pts.map((p) => p.y));
      out.rows.push(newMainRow(doc, centre(nm.pts).y - frontY, gap, arty, artySrc));
    }
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
      ? { name: 'Desert', st: 'pass', reason: 'in the desert the covering troops fight from successive delaying posns or leap-frog back from alternate posns, deflecting the En from his axis or canalising him into a killing ground (DW s7 para 9 b p 25); armour based, mounted: no move back on foot for any distance (DW s9 pp 32-33)' }
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
  if (recipe.layout === 'delay') return { ...delayRows(items, recipe, doc), grey: [['Routes hidden', 'the routes back to DP 2 in the En view from the threat marker'], ['Long range obsn', 'the ground in front of each delaying posn seen from it (MIB p 237)'], ['Obstacles in front', 'water across the front of each delaying posn (MIB p 237)']] };
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
  if (recipe.layout === 'by-day') { const d = byDayRows(items, recipe); return { rows: [...rows, ...d.rows], confirm: d.confirm }; }
  const rps = items.filter((i) => /^rp[A-Z]$/.test(i.role));
  if (isFmnWithdrawal(recipe)) {
    const sub = recipe.echelon === '21' ? 'Bdes' : 'Bns';
    rows.push({ name: 'Rear parties', st: rps.length >= fwd.length ? 'pass' : 'warn', reason: `${rps.length} for ${fwd.length} forward ${sub}: each leaves a portion in contact to protect the withdrawal (OOW3 s9 para 5 p 45), covering the approaches to the posns (p 27)` });
    const fr = fmnWdrRows(items, recipe, doc);
    return { rows: [...rows, ...fr.rows], confirm: fr.confirm, grey: [['Routes hidden', 'the routes back in the En view from the threat marker'], ['Behind an obstacle', 'water between the old posn and Int Posn 1']] };
  }
  rows.push({ name: 'Rear parties', st: rps.length >= fwd.length ? 'pass' : 'warn', reason: `${rps.length} for ${fwd.length} forward Coys: a platoon from each with part of the weapon section (IC s92 para 13 p 488)` });
  if (item('covPl')) rows.push({ name: 'Covering Pl', st: 'pass', reason: 'a platoon of the depth Coys covers the Bn embussing point (IBB s75 para 11 d p 379; IC s92 para 11 p 487)' });
  const rr = rearPartyRvRow(items, doc, null).row;
  if (rr) rows.push(rr);
  const prog = (doctrineAt(doc, 'withdrawal.programmeMin') as Record<string, number>) ?? { echelons: 15, controlPoints: 105, depthWithdraw: 135, rearPartyIn: 165, denial: 180 };
  const thin = num(doc, 'withdrawal.thinOutBeforeDenialMin', 10);
  rows.push({ name: 'Timings', st: 'pass', reason: `from last light: echelons L+${prog.echelons} min (no rearward move before it except the recce parties, IC s90 para 15 a (2) p 478), control points manned L+${prog.controlPoints}, depth Coys out L+${prog.depthWithdraw}, rear parties in L+${prog.rearPartyIn}, thinning out L+${prog.denial - thin} (a few minutes before denial, IC s90 para 15 b (1) p 479; ${thin} min, E), denial L+${prog.denial} (IBB s75 para 11 pp 379-380, a guide; the march to the EPs is read with the terrain); a part of the mortars stays with the rear parties to the end (IC s92 paras 1, 13 pp 484, 488; IBB p 380 withdraws them at denial: the books differ)` });
  return { rows, confirm: ['Routes back walked by day; Coy RVs and the Bn checkpoint recognisable at night (IC s91 para 5 b p 483)', 'Normal activity and harassing fire kept up to the last; the line left intact to the end (IC s91 paras 7-9 p 483)', 'Demolitions and mines in front of the intermediate posn, the abandoned posns booby trapped (engineer tasks: IC s93 para 3 b, e p 489)'] };
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
  const read = known ? findWithdrawal(base, frame, ground, ctx.doc, { enFieldArtyM: inp.enFieldArtyM ?? null, enFieldArtySrc: inp.enFieldArtySrc ?? null, threat: inp.threat ?? null, terrain: inp.terrain && inp.terrain !== 'auto' ? inp.terrain : 'plains' }) : null;
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
  return { recipe, res, raw, fit, frame, anchor: inp.anchor, bearing: inp.bearing, manual: {}, terrain: null, enemy: null, unit: null };
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
  const read = findWithdrawal(base, f, ground, ctx.doc, { enFieldArtyM: inp.enFieldArtyM ?? null, enFieldArtySrc: inp.enFieldArtySrc ?? null, threat: inp.threat ?? null, terrain: inp.terrain && inp.terrain !== 'auto' ? inp.terrain : 'plains' });
  const need = recipe.layout === 'delay' ? ['hq', 'fwdL', 'fwdR', 'res', 'dp2', 'dp3']
    : recipe.layout === 'by-day' ? ['hq', 'fwdL', 'fwdR', 'depth', 'res', 'freshA', 'freshB', 'ppA', 'ppB', 'intPosn', 'newMain']
      : isFmnWithdrawal(recipe) ? ['hq', 'fwdL', 'fwdR', 'res', 'intPosn', 'intPosn2', 'newMain']
      : ['hq', 'fwdL', 'fwdR', 'rvA', 'rvB', 'bnRv', 'epA', 'epB', 'rvRp', 'epRp', 'intPosn', 'newMain'];
  const names = (r: string) => recipe.slots.find((s) => s.role === r)?.label || r;
  return { rows: read.rows, confirm: read.confirm, reading: { paths: read.paths, times: read.times, routes: read.routes, confirm: read.confirm }, pending: ground.pending(), read: [...new Set(Object.keys(drawn).map(names))], missing: need.filter((r) => !drawn[r]).map(names) };
}
