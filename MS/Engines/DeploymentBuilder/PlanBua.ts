/**
 * PlanBua -- the BUA attack and defence (IBB S49 pp 264-269, S58 pp 319-325) and the MIB Gp's fixing force in a mobile
 * defence (MIB s23 pp 156-181, Annex P pp 357-359): the rows each layout's geometry settles, with book and page.
 * PlanMountain.layoutRows dispatches here.
 *
 * Pure: plan metres; the En side read from the plan itself.
 */
import type { DoctrineSet, Recipe } from './PlanRecipes';
import { doctrineAt, resolveRange } from './PlanRecipes';
import type { Check, XY } from './PlanSolve';

type Item = { role: string; label?: string; pts: XY[] };
const P = (x: number, y: number): XY => ({ x, y });
const num = (doc: DoctrineSet, path: string, fb: number) => { const r = resolveRange(doc, doctrineAt(doc, path)); return r ? (r[0] + r[1]) / 2 : fb; };
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
const centre = (pts: XY[]): XY => P(pts.reduce((a, p) => a + p.x, 0) / pts.length, pts.reduce((a, p) => a + p.y, 0) / pts.length);
const spread = (v: number[]) => (v.length ? Math.max(...v) - Math.min(...v) : 0);

/**
 * The BUA attack: foothold, progress, reduction; from a flank soon after dusk; the Pls up (two a Coy) no wider than 100 m
 * each (IBB S49; IC s55 para 17 a p 229); a rear / cut-off element (IC s55 paras 16, 18 a; s57 para 12 b (1)).
 */
export function buaAttackRows(items: Item[], recipe: Recipe, doc: DoctrineSet): Check[] {
  const rows: Check[] = [];
  const at = (role: string) => items.find((i) => i.role === role && i.pts.length);
  const obj = at('obj'), fup = at('fup');
  if (!obj) return rows;
  const o = centre(obj.pts);
  // the frontal direction runs from the own side to the Obj along the plan's y; the axis from the FUP
  if (fup) {
    const f = centre(fup.pts);
    const off = (Math.atan2(Math.abs(o.x - f.x), Math.abs(o.y - f.y)) * 180) / Math.PI, min = num(doc, 'bua.flankMinDeg', 45);
    rows.push({ name: 'From a flank', st: off >= min ? 'pass' : 'warn', reason: `the assault comes in ${Math.round(off)} deg off the frontal line (wants ${min} deg or more, M): BUA posns dominate the killing areas to their front and the frontal assault proves costly: the attack is launched from the flanks or rear, by night (IBB S49 para 6 p 266); once the buildings on the periphery, especially on the flanks, are taken, the posn as a whole becomes untenable (para 11 p 267)` });
  }
  // the foothold's frontage over the Pls up (IBB S49 para 15 p 268; IC s55 para 17 a p 229): each assaulting Coy has
  // two Pls up (its slot's `pls: 'three-up'` three), the third its reserve (bua.plsUpPerCoy, E)
  const aslt = items.filter((i) => /^aslt/.test(i.role));
  const upDef = num(doc, 'bua.plsUpPerCoy', 2);
  const upOf = (role: string) => (recipe.slots.find((s) => s.role === role)?.pls === 'three-up' ? 3 : upDef);
  const pls = aslt.reduce((n, i) => n + upOf(i.role), 0), xs = obj.pts.map((p) => p.x), wide = spread(xs), per = pls ? wide / pls : 0, plMax = num(doc, 'bua.plFrontageMaxM', 100);
  if (pls) rows.push({
    name: 'Pl frontage', st: per <= plMax + 1 ? 'pass' : 'warn',
    reason: `the foothold ${fmtM(wide)} wide for ${pls} Pls up (${aslt.length} Coy${aslt.length === 1 ? '' : 's'}, ${aslt.map((i) => upOf(i.role)).join(' + ')} Pls up, the rest each Coy's reserve: E): ${Math.round(per)} m a Pl; a Pl frontage should never exceed ${plMax} m and if possible the width of one house: each Pl attacks a house with three groups, one to clear it, one a firm base, one a reserve (IC s55 para 17 a p 229; IBB S49 para 15 pp 267-268); against stiff opposition at least a Pl on each side of a street (IC s54 para 8 p 224)`,
    ...(per <= plMax + 1 ? {} : { detail: { head: `${Math.round(per)} m a Pl in the foothold`, why: 'Wider, a Pl cannot keep its three groups (clear, firm base, reserve) on one house; the attack in a BUA is a series of independent Pl operations (IC s55 para 17 a p 229).', fix: [`Narrow the foothold to ${fmtM(pls * plMax)}`, 'Or put more Pls up (a third Coy), keeping a reserve at every level (IBB S49 para 2 e p 265)'] } }),
  });
  // a rear / cut-off element (IC s55 paras 16, 18 a pp 229-230; s57 para 12 b (1) p 241)
  const rear = items.find((i) => /^(cutOff|rear)/.test(i.role) && i.pts.length);
  rows.push(rear
    ? { name: 'Rear / cut-off', st: 'pass', reason: `${rear.label ?? 'a party'} to the rear: the village threatened from more than one direction, one flank and rear attack together, a fighting patrol (Pl / Sec) infiltrated to the rear to fire into the posn during the attack (IC s55 para 16 p 229); in position on the En main line of retreat before the clearing begins, unseen and clear of the buildings (s55 para 18 a p 230); tanks, if any, isolate the BUA and cut the routes of withdrawal (IC s57 para 12 b (1) p 241)` }
    : { name: 'Rear / cut-off', st: 'warn', reason: 'nothing to the rear of the BUA: one flank and rear attack is feasible and a patrol infiltrated to the rear pays greater dividends (IC s55 para 16 p 229); tanks isolate the BUA and cut the routes of withdrawal (IC s57 para 12 b (1) p 241)', detail: { head: 'No rear or cut-off element', why: 'Threatened from one direction only, the En holds the village or slips away along the line of retreat (IC s55 paras 16, 18 a pp 229-230).', fix: ['A fighting patrol (Pl / Sec) infiltrated to the rear, firing into the posn during the attack', 'An ambush party on the En main line of retreat, in position before the clearing begins', 'Tanks to isolate the BUA and cut the routes of withdrawal'] } });
  // the three phases: the foothold (the Obj), then systematic progress by bounds (the PLs beyond it)
  const ahead = (p: XY) => (fup ? (p.x - centre(fup.pts).x) * (o.x - centre(fup.pts).x) + (p.y - centre(fup.pts).y) * (o.y - centre(fup.pts).y) : p.y);
  const pls2 = items.filter((i) => /^pl\d$/.test(i.role) && i.pts.length && ahead(centre(i.pts)) > ahead(o));
  rows.push({ name: 'Phases', st: pls2.length ? 'pass' : 'warn', reason: `the foothold (the Obj)${pls2.length ? `, then ${pls2.length} bound${pls2.length > 1 ? 's' : ''} for systematic progress` : ', no bounds beyond it'}: an attack in a BUA goes in three phases: a foothold, systematic progress within the area, reduction of individual centres of resistance; sub-sectors divided by lanes and streets, objectives limited (IBB S49 paras 2 c, 3 p 265)` });
  if (at('bof')) rows.push({ name: 'Heavy weapons', st: 'pass', reason: `${at('bof')!.label ?? 'the heavy weapons'}: sited close to the minefields to neutralise the En weapons on the periphery before the lanes are made; lanes made secretly the same night or the night before (IBB S49 paras 7-10 pp 266-267)` });
  rows.push({ name: 'Reserves', st: items.some((i) => /^res/.test(i.role) && i.pts.length) ? 'pass' : 'warn', reason: 'the unpredictability of the operation and heavy casualties make adequate reserves necessary at all levels (IBB S49 para 2 e p 265)' });
  rows.push({ name: 'Soon after dusk', st: 'unchecked', reason: 'launched soon after dusk, so the lanes are made and the F echelon joins the Coys on the Obj in the night; the foothold by night unless inevitable, on a wide frontage to deceive (IBB S49 paras 4 b-c, 8 pp 265-266; IC s55 paras 7-8 p 227: aimed at the flanks and rear, launched as soon as possible after last light): set Night in the Task step' });
  rows.push({ name: 'Time in the BUA', st: 'unchecked', reason: 'no time is worked out here: in a town progress may be as little as a few hundred metres in 24 hours (IC s51 para 4 k p 199); a village is a sharp engagement of relatively short duration (IC s55 para 4 a p 226); short bounds and limited objectives, a fresh plan for each bound (IC s54 para 8 p 223): time the phases by the BUA\'s size and its buildings' });
  return rows;
}

/**
 * The BUA defence by localities: limited size (IC s52 para 1 c p 203: warns past bua.localityMaxM; without `doc` its
 * value 500 m), a screen on the outer perimeter, strong points in depth, barricades, a mobile reserve (IBB S58), AT on the
 * edge (IC s57).
 */
export function buaDefRows(items: Item[], recipe: Recipe, doc: DoctrineSet | null = null): Check[] {
  const rows: Check[] = [];
  const slot = (role: string) => recipe.slots.find((s) => s.role === role);
  const loc = items.filter((i) => ['fwd', 'depth', 'res'].includes(slot(i.role)?.kind ?? '') && i.pts.length >= 3);
  const fwd = loc.filter((i) => slot(i.role)?.kind === 'fwd');
  if (!fwd.length) return rows;
  const back = loc.filter((i) => slot(i.role)?.kind !== 'fwd');
  const en = back.length && centre(fwd.flatMap((i) => i.pts)).y < centre(back.flatMap((i) => i.pts)).y ? -1 : 1;
  const ahead = (p: XY) => en * p.y;
  const size = (i: Item) => `${fmtM(spread(i.pts.map((p) => p.x)))} x ${fmtM(spread(i.pts.map((p) => p.y)))}`;
  // a locality larger than its sub-unit can hold in a BUA: the longest side past bua.localityMaxM (E: "limited size", no
  // figure printed; IC s52 para 1 c p 203, s82 para 1 b p 440)
  const maxM = doc ? num(doc, 'bua.localityMaxM', 500) : 500;
  const side = (i: Item) => Math.max(spread(i.pts.map((p) => p.x)), spread(i.pts.map((p) => p.y)));
  const big = loc.filter((i) => side(i) > maxM + 1);
  rows.push({
    name: 'Localities', st: big.length ? 'warn' : 'pass',
    reason: `${loc.map((i) => `${i.label ?? i.role} ${size(i)}`).join('; ')}: a defence by a number of localities of limited size, each held by a sub-unit, self-supporting and well stocked; infiltration between them accepted to isolate and destroy the attack (IBB S58 paras 1 b, 3 f pp 319-321; IC s82 para 1 b pp 439-440); the locality of a limited size since fighting is at close quarter and mutual support between posts difficult (IC s52 para 1 c p 203), mutual support only within a Sec or between the Secs of a Pl (IC s51 para 5 a (3) p 200), fields of fire about 50-100 m (IC s52 para 4 a (3) p 204); no size printed: ${fmtM(maxM)} on the longest side at most (E); in a large town, the main routes in and the key points (IBB para 3 f p 321)${big.length ? `: ${big.map((i) => i.label ?? i.role).join(', ')} larger than a sub-unit can hold in a BUA` : ''}`,
    ...(big.length ? { detail: { head: `${big.length} localit${big.length === 1 ? 'y' : 'ies'} larger than ${fmtM(maxM)}`, items: big.map((i) => `${i.label ?? i.role}: ${size(i)}`), why: 'In a BUA fields of fire are about 50-100 m and the Pls support only each other, so a wide locality leaves its Pls out of support and gaps the En walks through (IC s51 para 5 a (3) p 200; s52 para 1 c p 203).', fix: [`Hold each locality ${fmtM(maxM)} or less across: the blocks on the main route in`, 'Add a locality rather than stretch one; accept infiltration between them (IC s82 para 1 b p 440)'] } } : {}),
  });
  const scr = items.find((i) => /^scr/.test(i.role) && i.pts.length);
  const fr = Math.max(...fwd.flatMap((i) => i.pts.map(ahead)));
  rows.push({ name: 'Screen', st: scr && Math.max(...scr.pts.map(ahead)) > fr ? 'pass' : 'warn', reason: scr ? `${scr.label ?? 'the screen'} ${fmtM(Math.max(...scr.pts.map(ahead)) - fr)} in front of the localities: small mobile detachments on the outer perimeter deceive the En as to the main posns and contest his first footholds; their routes back and the degree of resistance laid down (IBB S58 para 3 c pp 320-321)` : 'no screen in front of the localities (IBB S58 para 3 c p 320)' });
  const sps = items.filter((i) => /^sp/.test(i.role) && i.pts.length);
  const lines = new Set(sps.map((i) => Math.round(ahead(centre(i.pts)) / 250)));
  rows.push({ name: 'Strong points', st: sps.length >= fwd.length && lines.size >= 2 ? 'pass' : 'warn', reason: `${sps.length} strong point${sps.length === 1 ? '' : 's'} at ${lines.size} depth${lines.size === 1 ? '' : 's'}: strongly built large buildings in each locality made strong points, the hard core of the defence, firing on the main approaches; mutually supporting and in depth, else the En isolates and deals with each in detail (IBB S58 para 3 g pp 321-322)` });
  const br = items.filter((i) => /^br/.test(i.role) && i.pts.length);
  rows.push({ name: 'Barricades', st: br.length ? 'pass' : 'warn', reason: `${br.length} barricade${br.length === 1 ? '' : 's'} on the main streets: the main streets and open spaces blocked by barricades, wire and mines covered by fire from the strong points (IBB S58 para 3 g p 321)` });
  const res = loc.find((i) => slot(i.role)?.kind === 'res');
  rows.push(res ? { name: 'Reserve', st: 'pass', reason: `${res.label ?? 'the reserve'}: a mobile reserve at all levels, to cut off a penetration or restore a locality, its routes mouse-holed through the blocks (IBB S58 para 3 h p 322); reinforcing a locality is often better than a counter-attack in a BUA; tanks restricted, so mainly infantry (paras 12-13 p 324)` }
    : { name: 'Reserve', st: 'warn', reason: 'no reserve: a mobile reserve at all levels is essential (IBB S58 paras 1 b, 3 h pp 319, 322)' });
  // AT on the edge (IC s57 paras 4 b-d, 12 a pp 238-240): the plan draws no RR or tank, so a thing to confirm
  const at = items.filter((i) => /^(rr|at|tk)/i.test(i.role) && i.pts.length);
  rows.push({ name: 'AT on the edge', st: at.length ? 'pass' : 'unchecked', reason: `${at.length ? `${at.map((i) => i.label ?? i.role).join(', ')}: ` : 'not drawn: confirm '}the RRs on the periphery of the BUA covering all tankable approaches, RR and RL on the street crossings, the flanks covered (IC s57 para 4 b-d p 238); tanks in small groups, a Tp with a Coy, on the edge in mutually supporting posns with concealed routes back, over-watching the barricades on the periphery and in depth (IC s57 para 12 a p 240)` });
  return rows;
}

/**
 * An Armd Bde's mobile defence (recipe bde-def-mobile): MIB Annex P paras 2, 6 pp 357-358 (an MIB Gp and an Armd Regt Gp
 * fix, an Armd Regt Gp in reserve / depth; check him left and right, force him into the centre, contain him from each
 * flank, destroy him by the deliberate counter-attack); DW s7 para 4 b (2) p 22 (a portion fixes, the bulk of the
 * mechanised force attacks and destroys). Killing zone between the fixing groups; the counter-attack force mounted, in
 * depth behind it, timed to it against the Bde reserve's 2 h (check.reserveMin.18; DW p 27); the split as the books say.
 */
export function mobileRows(items: Item[], recipe: Recipe, doc: DoctrineSet): Check[] {
  const rows: Check[] = [];
  const slot = (role: string) => recipe.slots.find((s) => s.role === role);
  const fix = items.filter((i) => slot(i.role)?.kind === 'fwd' && i.pts.length >= 3);
  if (fix.length < 2) return rows;
  const res = items.find((i) => slot(i.role)?.kind === 'res' && i.pts.length >= 3);
  const kz = items.find((i) => /^kz/.test(i.role) && i.pts.length);
  const en = res && centre(fix.flatMap((i) => i.pts)).y < centre(res.pts).y ? -1 : 1;
  const ahead = (p: XY) => en * p.y;
  if (kz) {
    const k = centre(kz.pts), xs = fix.map((i) => centre(i.pts).x).sort((a, b) => a - b);
    const between = k.x > xs[0] && k.x < xs[xs.length - 1];
    rows.push({ name: 'Killing zone', st: between ? 'pass' : 'warn', reason: `${kz.label ?? 'the killing zone'} ${between ? 'between' : 'not between'} the fixing groups: the Bde checks him on its left and right, forces him into the centre and contains him there from each flank (MIB Annex P para 6 pp 357-358); the minefields channel his armour into it (DW p 23 para 5 d)` });
  } else rows.push({ name: 'Killing zone', st: 'warn', reason: 'no killing zone marked: the fixing groups force him into a pre-selected killing zone where the counter-attack force destroys him (MIB Annex P para 6; DW p 23 para 5 d)' });
  if (res) {
    const mounted = slot(res.role)?.mounted === true;
    const kmh = mounted ? num(doc, 'moves.tankKmh.go', 24) : num(doc, 'cpen.footKmPerH', 5);
    const c = centre(res.pts), t = kz ? centre(kz.pts) : centre(fix.flatMap((i) => i.pts));
    const min = Math.round((Math.hypot(c.x - t.x, c.y - t.y) / 1000) * (60 / kmh) + num(doc, 'cpen.settleMin', 5));
    const want = num(doc, 'check.reserveMin.18', 120);
    const behind = !kz || ahead(c) < ahead(centre(kz.pts));
    const st = mounted && behind && min <= want ? 'pass' : 'warn';
    rows.push({ name: 'Counter-attack force', st, reason: `${res.label ?? 'the reserve'}: ${mounted ? 'mounted' : 'on foot'}, ${behind ? 'in depth behind' : 'not behind'} the killing zone, ${min} min to it at ${kmh} km/h (wants ${want} min: a Bde reserve as early as possible within 2-6 h, DW p 27): the deliberate counter-attack force that destroys him once his advance is held (MIB Annex P paras 2, 6)` });
  } else rows.push({ name: 'Counter-attack force', st: 'fail', reason: 'no counter-attack force: a mobile defence destroys him by counter-attack, the fixing force only checks and contains (DW p 22 para 4 b (2); MIB Annex P para 6)' });
  rows.push({ name: 'Fixing and striking', st: 'pass', reason: `${fix.length} groups fix, ${res ? 'one' : 'none'} counter-attacks: MIB Annex P para 2 puts an MIB Gp and an Armd Regt Gp in the fixing role and an Armd Regt Gp in reserve / depth; DW p 22 has a portion fix and the bulk of the mechanised force attack: the books differ, the Bde Comd's call` });
  return rows;
}

/** The MIB Gp's fixing force in a mobile defence (MIB s23, Annex P). */
export function fixingRows(items: Item[], recipe: Recipe, doc: DoctrineSet): Check[] {
  const rows: Check[] = [];
  const slot = (role: string) => recipe.slots.find((s) => s.role === role);
  const fwd = items.filter((i) => slot(i.role)?.kind === 'fwd' && i.pts.length >= 3);
  if (!fwd.length) return rows;
  const res = items.find((i) => slot(i.role)?.kind === 'res' && i.pts.length >= 3);
  const en = res && centre(fwd.flatMap((i) => i.pts)).y < centre(res.pts).y ? -1 : 1;
  const ahead = (p: XY) => en * p.y;
  // strong points Pl to Coy, all round, in depth (p 158 b (1), p 170 para 21)
  const sps = [...fwd, ...items.filter((i) => /^sp/.test(i.role) && i.pts.length >= 3)];
  const lines = new Set(sps.map((i) => Math.round(ahead(centre(i.pts)) / 500)));
  rows.push({ name: 'Strong points', st: lines.size >= 2 ? 'pass' : 'warn', reason: `${sps.length} strong points at ${lines.size} depth${lines.size === 1 ? '' : 's'}: the fixing force organises strong points (Pl to Coy) in depth with all round defence on the likely approaches, each with its own mobile screen; each group fights from successive posns to the last line, against which the En is finally fixed (MIB s23 para 8 b p 158; para 21 p 170)` });
  // the killing zone between the groups (Annex P p 358: check him left and right and force him into the centre)
  const kz = items.find((i) => /^kz/.test(i.role) && i.pts.length);
  if (kz && fwd.length >= 2) {
    const k = centre(kz.pts), xs = fwd.map((i) => centre(i.pts).x).sort((a, b) => a - b);
    rows.push({ name: 'Killing zone', st: k.x > xs[0] && k.x < xs[xs.length - 1] ? 'pass' : 'warn', reason: `${kz.label ?? 'the killing zone'} ${k.x > xs[0] && k.x < xs[xs.length - 1] ? 'between' : 'not between'} the Coy groups: the strong points split and canalise the En into pre-selected killing zones, his infantry separated from his armour (MIB p 158 b); the Bde checks him left and right and forces him into the centre (Annex P para 6 p 358)` });
  }
  rows.push({ name: 'APCs in locality', st: 'pass', reason: 'the forward elements dismount and occupy the strong points; the APCs with driver and gunner stay in the locality, their weapons in the defensive fire and ready to move the troops to secondary or alternative posns or for delaying actions (MIB para 22 b p 170)' });
  rows.push(res && slot(res.role)?.mounted ? { name: 'Counter-attack', st: 'pass', reason: `${res.label ?? 'the reserve'}: mounted, held behind the forward groups for the immediate counter-attack on the En flank (Annex P paras 9 c, 11 c p 359); the focal point the destruction of En armour (p 158 b (6)); the reserve's tasks p 172 para 24` }
    : { name: 'Counter-attack', st: 'warn', reason: 'no mounted reserve: the fixing force keeps armour for the immediate counter-attack (Annex P p 359); the bulk of the armour finally destroys the En (p 157 para 1 d)' });
  // the area against Annex P's example (6 x 10 km)
  const all = items.filter((i) => i.pts.length >= 3 && ['fwd', 'depth', 'res'].includes(slot(i.role)?.kind ?? '') || /^(sp|kz|scr)/.test(i.role));
  const w = spread(all.flatMap((i) => i.pts.map((p) => p.x))), d = spread(all.flatMap((i) => i.pts.map(ahead)));
  const aw = num(doc, 'mobileDefence.areaWM', 6000), ad = num(doc, 'mobileDefence.areaDM', 10000);
  rows.push({ name: 'Gp area', st: w <= aw + 1 && d <= ad + 1 ? 'pass' : 'warn', reason: `${fmtM(w)} wide, ${fmtM(d)} deep: the MIB Gp (Bn less two Coys, a tank Sqn, an SP field Bty) in Annex P holds about ${fmtM(aw)} wide and ${fmtM(ad)} deep in open country (MIB Annex P paras 3-4 p 357)` });
  rows.push({ name: 'Prerequisites', st: 'unchecked', reason: 'a mobile defence wants depth to draw the En into killing zones, ground and air that allow free movement, mobility to match his, too little time or ground for an area defence, and balanced all arms groups (MIB s23 para 2 p 157): confirm' });
  return rows;
}
