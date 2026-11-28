/**
 * PlanCtps.ts — PURE. The covering troops (C Tps) battle in the SZ at BG and Cbt Gp level, from the C&SC handout
 * "Concept and Conduct of SZ Battle" (SZB, 2010; SZB_Review.md N1). Recipes `bg-ctps-two-up` / `-three-up` /
 * `-narrow` (BG options 1-3, p 17 para 28 b) and `cbtgp-ctps-opt1` / `-opt2` / `-opt3` (Cbt Gp options 1-3, pp 16-17
 * para 28 a); their rows reach the build, the fit and Check my plan through PlanMountain.layoutRows.
 *
 * Rows: Frontage (Cbt Gp 60-70 km, BG 20-25 km, p 13 para 24), CAT frontage (8-10 km, 6-8 km within a DL, pp 13, 17),
 * Option (the layout's own option and its weakness), Mask posn (p 17 para 28 c (4)), Killing ground (ahead and astride,
 * p 13 para 25 e), Behind mines (p 14 para 26 a), Delaying lines (p 10 para 20 b; Figs 2-3), Delay (the En's shallow
 * manoeuvre round a DL in 3 h, a deep one in 6 h, p 19 para 31, against the delay ordered), Fall-back routes (pp 20-21
 * para 32 l), BHOL and passage (pp 21-22 para 35, Fig 4), and the support to confirm: arty, AD, engrs (pp 24-25), night
 * (p 21 para 33), security (p 23 para 36). Texts say En / Own.
 *
 * Plan metres: y toward the En (the solver's frame).
 */
import type { DoctrineSet, Recipe } from './PlanRecipes';
import { doctrineAt, resolveRange } from './PlanRecipes';
import type { Check, XY } from './PlanSolve';

type Item = { role: string; label?: string; pts: XY[] };

export const CTPS_LAYOUTS = ['ctps-two-up', 'ctps-three-up', 'ctps-narrow', 'ctps-cbtgp-1', 'ctps-cbtgp-2', 'ctps-cbtgp-3'] as const;
export const isCtpsLayout = (layout: string | undefined | null): boolean => (CTPS_LAYOUTS as readonly string[]).includes(layout ?? '');

const SZB = 'SZ Battle (C&SC)';
const rng = (doc: DoctrineSet, path: string, fb: [number, number]): [number, number] => resolveRange(doc, doctrineAt(doc, path)) ?? fb;
const one = (doc: DoctrineSet, path: string, fb: number): number => { const r = resolveRange(doc, doctrineAt(doc, path)); return r ? (r[0] + r[1]) / 2 : fb; };
const km = (m: number): string => `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km`;
const ext = (pts: XY[]) => ({ x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) });
const mid = (pts: XY[]): XY => { const e = ext(pts); return { x: (e.x0 + e.x1) / 2, y: (e.y0 + e.y1) / 2 }; };

const OPTION: Record<string, { st: Check['st']; reason: string; detail?: Check['detail'] }> = {
  'ctps-two-up': { st: 'pass', reason: `BG option 1, preferable: more than one approach for the BG, two CATs in front and one in depth cover the axes and stay balanced against unforeseen and outflanking manoeuvres (${SZB} p 17 para 28 b (1)); the same BG fights back on each DL to the BHOL (successive, pp 14-15, Fig 2)` },
  'ctps-three-up': { st: 'warn', reason: `BG option 2: all three CATs up to guard a wider sector; the DL is vulnerable to penetration and outflanking (${SZB} p 17 para 28 b (2))`, detail: { head: 'Three CATs up: no depth on the DL', why: 'With every CAT forward the DL has no depth: the En penetrates or outflanks it (SZ Battle p 17 para 28 b (2)); successive DLs also lack depth and leave wider gaps (p 15).', fix: ['Each CAT keeps some teams (Pl / Tp) in depth with be prepared tasks (p 17 para 28 b (2))', 'On contact the CATs side step and shift laterally to deter outflanking (p 18 para 28 c (6))', 'Ask for a fourth team or narrow the sector, then take option 1 (two up, one in depth)'] } },
  'ctps-narrow': { st: 'pass', reason: `BG option 3: a narrow sector, two CATs on successive lines and the third in reserve (${SZB} p 17 para 28 b (3)); the forward CAT falls back through the one behind, which takes over the fight` },
  'ctps-cbtgp-1': { st: 'pass', reason: `Cbt Gp option 1: the heavy BG on the most likely approach of the En main armour threat, the second against the En secondary effort, the third in reserve for other eventualities or to reinforce (${SZB} p 16 para 28 a (1))` },
  'ctps-cbtgp-2': { st: 'pass', reason: `Cbt Gp option 2: one strong BG covers the entire front on DLs on the likely approaches to inflict cas and delay, the second concentrated for manoeuvre and destruction, the third against the En enveloping or outflanking the DL (${SZB} p 17 para 28 a (2))` },
  'ctps-cbtgp-3': { st: 'warn', reason: `Cbt Gp option 3: the HAT gp on the first DL, the tank heavy gp in rear to move to any threatened flank; the softer vehicles of the HAT are vulnerable to En arty and air attack (${SZB} p 17 para 28 a (3))`, detail: { head: 'HAT forward: soft vehicles exposed', why: 'The HAT gp on DL 1 is the flexible option, but its soft vehicles are vulnerable to the En arty and air (SZ Battle p 17 para 28 a (3)); the En fights under air superiority or a favourable air situation with AHs (p 25 para 39).', fix: ['AD over the mech elements on the DLs, the most preferred employment (p 25 para 39 a)', 'Prepared tank posns and cover for the HAT vehicles (engrs, p 25 para 40 c)', 'Tank troops cover the withdrawal of the HAT and LAT elements to the next DL (p 18 para 28 c (9))'] } },
};

/**
 * Main-defence rows that do not apply to the C Tps battle, dropped for its layouts: a Bn's frontage (the C Tps plan has
 * its own Frontage, SZB p 13), a Bn's depth and its MGs' mutual support, the main approach held by one posn (in the SZ the
 * En is drawn into a KG between the CATs, p 13 para 25 e), and a continuous protective minefield in time (the mines go on
 * the thrust lines along the DLs, p 25 para 40 a).
 */
const NOT_CTPS = new Set(['Depth', 'Mutual support', 'Approach responsibility', 'Mines in time']);
export function ctpsOverride<T extends { name: string; reason: string }>(rows: T[], recipe: { layout?: string } | null | undefined): T[] {
  if (!isCtpsLayout(recipe?.layout)) return rows;
  return rows.filter((r) => !NOT_CTPS.has(r.name) && !(r.name === 'Frontage' && !r.reason.includes(SZB)));
}

/** The C Tps plan's rows (none for any other recipe). `delayH`: the delay the higher Comd orders (Recipe.wdrDelayH), else null. */
export function ctpsRows(items: Item[], recipe: Recipe, doc: DoctrineSet): Check[] {
  if (!isCtpsLayout(recipe.layout)) return [];
  const rows: Check[] = [];
  const slot = (role: string) => recipe.slots.find((s) => s.role === role);
  const posns = items.filter((i) => ['fwd', 'depth', 'res'].includes(slot(i.role)?.kind ?? '') && i.pts.length >= 3);
  const fwd = posns.filter((i) => slot(i.role)?.kind === 'fwd');
  if (!fwd.length) return rows;
  const cbtGp = recipe.echelon === '18';
  const fe = ext(fwd.flatMap((i) => i.pts));
  const front = fe.y1;
  // Frontage: the sector the plan holds, the DLs' span (SZB p 13 para 24)
  const dls = items.filter((i) => /^dl\d$/.test(i.role) && i.pts.length >= 2).sort((a, b) => ext(b.pts).y1 - ext(a.pts).y1);
  const width = dls.length ? Math.max(...dls.map((d) => { const e = ext(d.pts); return e.x1 - e.x0; })) : fe.x1 - fe.x0;
  const band = cbtGp ? rng(doc, 'securityZone.ctps.cbtGpFrontageM', [60000, 70000]) : rng(doc, 'securityZone.ctps.bgFrontageM', [20000, 25000]);
  // option 3 is a narrow sector by name (p 17 para 28 b (3)): narrower than the band passes
  const narrow = recipe.layout === 'ctps-narrow' && width < band[0];
  const inBand = narrow || (width >= band[0] * 0.9 && width <= band[1] * 1.1);
  rows.push({ name: 'Frontage', st: inBand ? 'pass' : 'warn', m: width, reason: `the sector ${km(width)} wide: a ${cbtGp ? 'Cbt Gp' : 'BG'} may be deployed on ${km(band[0])}-${km(band[1])}, varying with the type of terrain (${SZB} p 13 para 24)${narrow ? '; a narrow sector, the case of option 3 (p 17 para 28 b (3))' : inBand ? '' : '; outside it by more than a tenth: check the troops to ground ratio, invariably unfavourable to the defender in the SZ (p 27 para 41 h)'}` });
  // CAT frontage (a BG plan): 8-10 km, 6-8 km within a DL
  if (!cbtGp) {
    const cat = rng(doc, 'securityZone.ctps.catFrontageM', [8000, 10000]), within = rng(doc, 'securityZone.ctps.catWithinDlM', [6000, 8000]);
    const ws = fwd.map((i) => ({ l: i.label ?? i.role, w: ext(i.pts).x1 - ext(i.pts).x0 }));
    const bad = ws.filter((x) => x.w < within[0] - 1 || x.w > cat[1] + 1);
    rows.push({ name: 'CAT frontage', st: bad.length ? 'warn' : 'pass', reason: `${ws.map((x) => `${x.l} ${km(x.w)}`).join(', ')}: a CAT 8-10 km (${SZB} p 13 para 24 c), each ${km(within[0])}-${km(within[1])} within a DL (p 17 para 28 c (1)); a tk tp / HAT pl on 1200-1500 m with 600-700 m between tanks / weapons, 500-1000 m between tps / pls, or as the ground allows (paras 28 c (2)-(3))` });
  }
  // the option this layout takes
  const opt = OPTION[recipe.layout];
  if (opt) rows.push({ name: 'Option', st: opt.st, reason: opt.reason, ...(opt.detail ? { detail: opt.detail } : {}) });
  // a mask posn ahead of DL 1 (a BG plan)
  if (!cbtGp) {
    const mask = items.find((i) => i.role === 'mask' && i.pts.length);
    const ahead = mask ? mask.pts[0].y - front : null;
    rows.push(mask && ahead !== null && ahead > 0
      ? { name: 'Mask posn', st: 'pass', m: ahead, reason: `${mask.label ?? 'a mask posn'} ${km(ahead)} ahead of DL 1: one tk tp with or without HAT elements in a mask posn ahead of the DL (${SZB} p 17 para 28 c (4)); it ambushes the En leading Sqn gp, gains the information and joins the CAT on the DL, in depth or reserve (p 19 para 32 c)` }
      : { name: 'Mask posn', st: 'warn', reason: `no mask posn ahead of DL 1: one tk tp with or without HAT elements should be kept in a mask posn ahead of the DL (${SZB} p 17 para 28 c (4))` });
  }
  // killing ground: ahead and astride, within the forward posns' reach (p 13 para 25 e)
  const kgs = items.filter((i) => /^kg\d$/.test(i.role) && i.pts.length >= 3);
  if (!kgs.length) rows.push({ name: 'Killing ground', st: 'warn', reason: `no KG marked: KGs are selected in each sector along each DL, not occupied by own troops, the En drawn into them and destroyed by the coordinated fire of integral weapons, AHs and counter-attack (${SZB} p 5 para 9 j, p 13 para 25)` });
  else {
    const xs = fwd.map((i) => mid(i.pts).x).sort((a, b) => a - b);
    const words = kgs.map((k) => {
      const c = mid(k.pts);
      const astride = fwd.length >= 2 ? c.x > xs[0] && c.x < xs[xs.length - 1] : true;
      const near = c.y - front < 4000 && c.y > front - 4000;
      return { k, ok: astride && near, txt: `${k.label ?? k.role} ${astride ? (fwd.length >= 2 ? 'astride, between the posns' : 'ahead of the posn') : 'not between the posns'}, ${c.y >= front ? `${km(c.y - front)} ahead of` : `${km(front - c.y)} behind`} DL 1` };
    });
    rows.push({ name: 'Killing ground', st: words.every((w) => w.ok) ? 'pass' : 'warn', reason: `${words.map((w) => w.txt).join('; ')}: battle posns ahead and astride each KG lure the En before destroying the En (${SZB} p 13 para 25 e); the forward CAT draws the En into it and all CATs with the reserve inflict max cas on the En trapped there (p 18 para 28 c (7)-(8)); in the desert round the dhars, open flat ground ringed by dominating dunes (p 13 para 25 c); the delaying posn ambushes at 1200-1500 m (p 12 para 22 b) or 800-1200 m (p 26 para 41 d)` });
  }
  // battle posns behind a minefield (p 14 para 26 a); luring with mines (p 18 para 30 b (2))
  const mf = items.filter((i) => /^mf[A-Z]$/.test(i.role) && i.pts.length >= 3);
  const covered = fwd.filter((p) => { const e = ext(p.pts); return mf.some((m) => { const me = ext(m.pts); return me.x1 > e.x0 && me.x0 < e.x1 && me.y0 >= e.y1 - 1; }); });
  rows.push({ name: 'Behind mines', st: covered.length === fwd.length ? 'pass' : 'warn', reason: `${covered.length} of ${fwd.length} forward posns behind a minefield: battle posns rest preferably behind a minefield and along / on a ridge line, dominating, with clear fields of fire, flank observation, depth and good fall-back routes (${SZB} p 14 para 26); minefields laid so that the En, trying to bypass them, is lured into the KG (p 18 para 30 b (2)), on the major thrust lines along the DLs, covering the gaps (p 25 para 40 a)` });
  // the DLs (p 10 para 20 b), their spacing; the En's manoeuvre round a DL (p 19 para 31)
  const ys = dls.map((d) => ext(d.pts).y1);
  const hops = ys.slice(1).map((y, i) => ys[i] - y);
  const sh = one(doc, 'securityZone.ctps.enShallowH', 3), dp = one(doc, 'securityZone.ctps.enDeepH', 6);
  rows.push({ name: 'Delaying lines', st: dls.length >= 2 ? 'pass' : 'warn', m: dls.length, reason: `${dls.length} DL${dls.length === 1 ? '' : 's'}${hops.length ? `, ${hops.map(km).join(' and ')} apart` : ''}: the C Tps achieve their mission by occupying a series of DLs, their number and the delay related to the mission, the ground, the En and own situation (${SZB} pp 10-11 para 20 b); the En's shallow manoeuvre round a DL 10-15 km deep in ${sh} h, a deep one by a second Cbt Gp 20-25 km in ${dp} h, failing which penetration (p 19 para 31); the En bypasses and manoeuvres wide and deep to neutralise more than one DL (p 26 para 41 c)` });
  // the delay: each DL held until a shallow (3 h) or deep (6 h) manoeuvre turns it, against the delay ordered
  const nDl = dls.length;
  const ordered = recipe.wdrDelayH ?? null;
  const lo = nDl * sh, hi = nDl * dp;
  if (ordered) rows.push({ name: 'Delay', st: lo >= ordered ? 'pass' : 'warn', m: lo, reason: `${nDl} DL${nDl === 1 ? '' : 's'} give about ${lo}-${hi} h if each holds until a shallow (${sh} h) or a deep (${dp} h) manoeuvre turns it (${SZB} p 19 para 31; best to the En: ${lo} h), against ${ordered} h ordered; mostly only the time is given, e.g. "delay the en for 48 hrs inflicting 30% cas" (p 26 para 41 f)`, ...(lo >= ordered ? {} : { detail: { head: `${lo} h at the En's fastest against ${ordered} h ordered`, why: 'Each DL buys only the time the En needs to turn it; a shallow manoeuvre takes about 3 h (SZ Battle p 19).', fix: ['More DLs in the depth the SZ gives, or alternate DLs with a second BG so each line is held stronger and longer (pp 15-16)', 'Secure the flanks of each DL (screens, patrols, a Div flank force, p 23 para 36 b) so only a deep manoeuvre turns it', 'Mines and obstacles on the thrust lines and the bypasses (p 25 para 40 a); side step and shift laterally on contact (p 18 para 28 c (6))'] } }) });
  else rows.push({ name: 'Delay', st: 'unchecked', m: lo, reason: `${nDl} DL${nDl === 1 ? '' : 's'} give about ${lo}-${hi} h if each holds until a shallow (${sh} h) or a deep (${dp} h) manoeuvre turns it (${SZB} p 19 para 31): set the delay the higher Comd orders (the Delay chips) to judge it; the mission is a delay for a time, attrition, or a given % of cas, while remaining a viable force (p 4 para 8; pp 26-27 para 41 f-g)` });
  // fall-back routes (pp 20-21 para 32 l)
  const rts = items.filter((i) => /^rt[A-Z]$/.test(i.role) && i.pts.length >= 2);
  const fed = fwd.filter((p) => { const e = ext(p.pts); return rts.some((r) => { const a = r.pts[0]; return a.x >= e.x0 - 500 && a.x <= e.x1 + 500 && Math.abs(a.y - (e.y0 + e.y1) / 2) < (e.y1 - e.y0) + 1000; }); });
  rows.push({ name: 'Fall-back routes', st: fed.length === fwd.length ? 'pass' : 'warn', reason: `${fed.length} of ${fwd.length} forward posns with a route back to the next DL: the routes should give cover from the En fire and concealment from the En observation, lead direct to the next posn, have good going and minefield gaps (${SZB} pp 20-21 para 32 l); no element moves to the rear without specific orders (p 21 para 34 b); tank troops cover the withdrawal of the HAT and LAT elements (p 18 para 28 c (9))` });
  // the BHOL and the passage (pp 21-22 para 35, Fig 4)
  const bhol = items.find((i) => i.role === 'bhol' && i.pts.length >= 2);
  const pps = items.filter((i) => /^pp[A-Z]$/.test(i.role) && i.pts.length);
  const rv = items.find((i) => i.role === 'rv' && i.pts.length);
  rows.push({ name: 'BHOL and passage', st: bhol && pps.length && rv ? 'pass' : 'warn', reason: `${bhol ? 'the BHOL behind the last DL' : 'no BHOL'}, ${pps.length} passage point${pps.length === 1 ? '' : 's'}, ${rv ? 'an RV behind' : 'no RV'}: the BHOL is the C Tps rear boundary, forward enough to let them get into column, close enough for the holding unit to help their final delay and passage (${SZB} p 5 para 9 h); at the junction point the liaison parties meet, passage points manned, lanes marked and guides posted, the C Tps take bounds to the BHOL under the holding formation's screens, in column with guns toward the En, to the RV and then the concentration area (pp 21-22 para 35, Fig 4); in the desert they may keep supporting the main defences rather than hand over at the BHOL (p 22)` });
  // the support to confirm: arty, AD, engrs (pp 24-25), night (p 21), security (p 23)
  const lifts = rng(doc, 'securityZone.ctps.ammoLifts', [2, 2.5]);
  rows.push({ name: 'Arty, AD and engrs', st: 'unchecked', reason: `confirm: the arty deployed well forward with the affiliated BGs, 2/3 of its range toward own area of responsibility, wider frontages near the forward DL and compact near the BHOL, SP med / hy for close support, long-range towed med for depth (${SZB} p 24 para 38 a-d); ammunition ${lifts[0]}-${lifts[1]} second line lifts, dumped on gun posns along each DL (p 25 para 38 f); AD first over the mech elements on the DLs, then the fall back, the gun posns and the HQ (p 25 para 39); engrs lay mines on the thrust lines along the DLs, anti-trawl / tank ditches if time, tank and stay-behind posns, water, laterals (p 25 para 40)` });
  rows.push({ name: 'Night and security', st: 'unchecked', reason: `confirm: by night the CAT frontages reduced and the gaps covered by surveillance, infantry protecting the tanks and patrolling as tank hunting parties, the HAT's night vision for observation (${SZB} p 21 para 33); screens at CAT level, flank security by all round observation and patrols, a dedicated force at Div level for the C Tps flanks; rear and flank security on the fall back (p 23 para 36); stay-behind parties (p 27 para 41 j)` });
  return rows;
}
