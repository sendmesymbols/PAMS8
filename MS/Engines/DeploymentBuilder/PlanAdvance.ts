/**
 * PlanAdvance.ts — PURE. An advance to contact: an Armd Bde leading an Armd Div's advance (OoW Vol II s4 pp 9-11,
 * Fig 2 p 9; PlanDoctrine `advance`). The recipe lays the echelons along the axis from the SP (the click; the aim is
 * the direction of advance): covering troops ahead, flank guards out, the Advance Guard (Van Gd, Main Gd), the Main
 * Body behind.
 *
 * - geometry rows: how far each echelon stands from the head against Fig 2 (read off a highlighted scan: uncertain);
 * - on the ground: the axis routed for tracks over the bundle's going (PlanGround.avenues), its share on roads and
 *   their classes, the going along it (NO-GO share and longest stretch), each water feature it crosses and how (the
 *   bundle's bridge classes: tanks need Cl 60), bounds laid on the water ahead and report lines on the lateral roads
 *   and railways (IC s58 paras 4, 6 pp 242-243), and the flank guards' ground;
 * - Check my plan reads the same rows off the drawn symbols (the axis, bounds and report lines as drawn).
 *
 * No ArcGIS, no DOM, so Node can test it.
 */
import type { DoctrineSet, Recipe } from './PlanRecipes';
import { doctrineAt, resolveRange } from './PlanRecipes';
import type { Check, CheckState, PlanItem, XY } from './PlanSolve';
import { solveRecipe } from './PlanSolve';
import { detectTerrain, toLocal, toWorld, type FitFrame, type FitLayoutInput, type FitResult, type FittedLayout, type PlanGround } from './PlanFit';
import type { OrbatSet } from './PlanOrbat';
import type { TerrainSpec } from './PlanContext';
import { mkPath, type LngLat } from '../MovePlanner/MoveGeo';
import { clearAt, densityFor, dueAt, roadRulesFrom, simulate, speedFor, type MvRoadRules, type MvSerialIn } from '../MovePlanner/MoveRoad';
import { atLocal, clockFrom, LightBook, todayIn } from '../MovePlanner/MoveTime';
import { mercToLngLat } from '../MovementGuide/MovementGuideScan';

type MercXY = [number, number];
export type AdvDrawn = Record<string, { pts: MercXY[] }>;
/** A bound (bd) or report line (rl) as drawn, where it meets the axis. */
export type DrawnLine = { label: string; s: number; kind?: 'bd' | 'rl' };

const kOf = (y: number) => 1 / Math.cos(2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2);
const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
const fmtM = (m: number) => (Math.abs(m) >= 1000 ? km(m) : `${Math.round(m / 10) * 10} m`);
const SRC = 'OoW Vol II Fig 2 p 9, read from the page text under the highlights';

/** The figures, PlanDoctrine.advance. */
export function advanceFigures(doc: DoctrineSet) {
  const r = (p: string, fb: [number, number]) => resolveRange(doc, doctrineAt(doc, `advance.${p}`)) ?? fb;
  return {
    ctps: r('ctpsAheadM', [4000, 8000]),
    van: r('vanGdM', [3500, 3500])[0],
    main: r('mainGdM', [3000, 3000])[0],
    flank: r('flankOutM', [15000, 20000]),
    body: r('mainBodyBackM', [6500, 6500])[0],
    bodyDepth: r('mainBodyDepthM', [6000, 6000])[0],
    nogoWarn: r('axisNogoWarn', [0.1, 0.1])[0],
    run: r('axisNogoRunM', [200, 500]),
    detour: r('axisDetourWarn', [1.5, 1.5])[0],
    rlApart: r('rlApartM', [1000, 1000])[0],
    haShort: r('haShortOfRlM', [1000, 1000])[0],
    haSize: r('haSizeM', [600, 400]) as [number, number],
    // a Bn group as the Adv Gd (IBB pp 133-150, Fig 12; MIB pp 81-84)
    bnVan: r('bn.vanDepthM', [500, 600]),
    bnLink: r('bn.linkGpsM', [800, 900]),
    bnLinkMin: r('bn.linkGpsMin', [40, 65]),
    bnMainMin: r('bn.mainGdBehindVanMinM', [300, 400]),
    // IC beside IBB: by day the leading Coy strung up to 1100-1400 m, the Bn up to 3-5 km (s61 para 7 p 261); by night
    // the vanguard about 450 m, the main guard not less than 400-450 m behind it (s64 para 6 b, c p 280)
    bnVanDay: r('bn.vanDepthDayM', [1100, 1400]),
    bnSpreadDay: r('bn.bnSpreadDayM', [3000, 5000]),
    bnVanNightIc: r('bn.vanDepthNightIcM', [450, 450])[0],
    bnMainIc: r('bn.mainGdBehindVanIcM', [400, 450]),
    lateralMax: r('rlLateralMaxM', [120, 120])[0],
    bnClear: r('bn.flankClearM', [800, 800])[0],
    bnFollow: r('bn.followUpPlM', [100, 300]),
    closeShare: r('bn.closeShare', [0.1, 0.4]),
    // halting areas scored on the ground (IBB p 160; OoW Vol II p 12)
    haCover: r('haScore.coverShareWant', [0.3, 0.3])[0],
    haRoom: r('haScore.roomShareMin', [0.8, 0.8])[0],
    haEntry: r('haScore.entryRoadM', [300, 300])[0],
    haShift: r('haScore.shiftM', [500, 500])[0],
    // an Armd Div on a broad front with two Bdes (OoW Vol II pp 52-53)
    divApart: r('div.axesApartM', [3000, 8000]),
    followUp: r('followUpBdeBackM', [8000, 8000])[0],
    // an Inf Div on one axis (GSP 1947 s18 pp 76-80, Annex H p 203)
    idivCtps: r('infDiv.ctpsAheadM', [16000, 24000]),
    idivLdgPlMin: r('infDiv.ldgPlAheadMin', [20, 30]),
    idivHar: r('infDiv.harApartM', [24000, 32000]),
    idivFlank: r('infDiv.flankOutM', [3000, 8000]),
    footGo: resolveRange(doc, doctrineAt(doc, 'moves.footKmh.go'))?.[0] ?? 4,
  };
}

/** Which advance the items are: an Inf Div on one axis (its harbour areas), a Bn group as the Adv Gd (it has a Bn HQ), an Armd Div on two axes, or the Armd Bde of Fig 2. */
export function advanceKind(items: { role: string }[]): 'bn' | 'div' | 'bde' | 'idiv' {
  if (items.some((i) => i.role === 'har1')) return 'idiv';
  if (items.some((i) => i.role === 'axisL' || i.role === 'axisR')) return 'div';
  if (items.some((i) => i.role === 'bnHq')) return 'bn';
  return 'bde';
}

const centre = (pts: XY[]): XY => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });

/**
 * The echelons' distances from the head (plan metres, y in the direction of advance): covering troops ahead, the Van
 * Gd and Main Gd within the Advance Guard, the Main Body back, the flank guards out. Warn outside Fig 2's figures (the
 * single figures with a quarter either way, E).
 */
export function advanceRows(items: { role: string; pts: XY[] }[], doc: DoctrineSet, hAt: string = 'first'): Check[] {
  const kind = advanceKind(items);
  if (kind === 'bn') return bnAdvanceRows(items, doc, hAt);
  if (kind === 'div') return divAdvanceRows(items, doc);
  if (kind === 'idiv') return infDivAdvanceRows(items, doc, null);
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
    rows.push({ name: 'Main Body', st: near(d, F.body) ? 'pass' : 'warn', reason: `its head ${fmtM(d)} behind the Van Gd's; Fig 2: straight behind the Advance Guard (${km(F.van)} + ${km(F.main)} = ${km(F.body)}), ${km(F.bodyDepth)} deep (${SRC}). Not committed against minor opposition (s4 para 4)` });
  }
  const fl = ['flankL', 'flankR'].map(at).filter((p): p is XY => !!p);
  if (fl.length) {
    const outs = fl.map((p) => Math.abs(p.x - head.x));
    rows.push({ name: 'Flank guards', st: fl.length === 2 && outs.every((o) => o >= F.flank[0] - 1 && o <= F.flank[1] + 1) ? 'pass' : 'warn', reason: `${outs.map(fmtM).join(' and ')} out from the axis${fl.length < 2 ? ' (one flank only)' : ''}; Fig 2: ${km(F.flank[0])}-${km(F.flank[1])} for the Armd Div (the Div's flank guards: no Bde figure is printed; ${SRC})` });
  }
  return rows;
}

/**
 * A Bn group as the Adv Gd of a Bde's advance (recipe bn-advance-one-up): the vanguard a Coy group with tanks, a Sec of
 * the Bn mortars, the assault pioneers and the ATGM Pl (IBB S33 para 3 p 138; MIB p 82 e, g, h); Bn HQ one bound behind
 * the rear troops of the vanguard (MIB p 81 b); the main guard behind it: by night at least 300-400 m (IBB p 149 d (4)),
 * Fig 12 drawing the vanguard 500-600 m deep and link groups over 800-900 m (40-65 min) to the main guard (p 150); by day
 * the gaps are worked in time, not space (IBB p 138 para 4); by day the flanks cleared at least 800 m either side of the
 * axis (IBB p 133). Plan metres, y in the direction of advance; the SP is the head of the vanguard.
 */
export function bnAdvanceRows(items: { role: string; pts: XY[] }[], doc: DoctrineSet, hAt: string = 'first'): Check[] {
  const F = advanceFigures(doc);
  const at = (role: string) => { const i = items.find((x) => x.role === role && x.pts.length); return i ? centre(i.pts) : null; };
  const head = at('sp');
  if (!head) return [];
  const back = (p: XY) => head.y - p.y;
  const night = hAt === 'last';
  const rows: Check[] = [];
  const van = at('vanGd'), tk = at('vanTk'), hq = at('bnHq'), mor = at('mor'), atgm = at('atgm'), main = at('mainGd');
  const vanMid = (F.bnVan[0] + F.bnVan[1]) / 2;
  // the vanguard's point is its centre: its tail half its depth behind it
  const tail = van ? back(van) + vanMid / 2 : vanMid;
  if (van) {
    // by night Fig 12's depth (IBB p 150); by day IC's: the leading Coy strung on the road up to 1100-1400 m in open
    // country with good visibility (IC s61 para 7 p 261), its head at the SP and its point (the symbol) its centre
    const dayDepth = 2 * back(van);
    const ok = back(van) >= 0 && (night ? back(van) <= vanMid : dayDepth <= F.bnVanDay[1] + 1);
    rows.push({
      name: 'Vanguard', st: ok ? 'pass' : 'warn',
      reason: `a Coy group with a Sec of the Bn mortars, an assault pioneer Sec, the ATGM Pl, tanks and the FOO if allotted (IBB S33 para 3 p 138), its tail about ${fmtM(night ? tail : dayDepth)} behind its head at the SP${night
        ? `; by night ${fmtM(F.bnVan[0])}-${fmtM(F.bnVan[1])} deep (IBB Fig 12 p 150), the night formation; IC has the point Sec to the vanguard's tail only ${fmtM(F.bnVanNightIc)} or so (s64 para 6 b p 280): the books differ, Fig 12 drawn`
        : `; by day its gaps are reckoned in time, not space, by the speed, the En and the country, so that nothing drifts into action unaware or piecemeal (IBB p 138 para 4; IC s61 para 6 p 261); in open country with good visibility the leading Coy may be strung on the road as long as ${fmtM(F.bnVanDay[0])}-${fmtM(F.bnVanDay[1])} (IC s61 para 7 p 261; Fig 12's ${F.bnVan[0]}-${F.bnVan[1]} m is the night formation); scouts 75-150 m ahead of the point Sec, the point Sec 150 / 200 m ahead of the Pl R Gp (IC s61 para 5 p 259)`}${ok ? '' : night ? ': it stands outside the vanguard\'s depth' : `: longer than the ${fmtM(F.bnVanDay[1])} the leading Coy strings out to by day`}`,
      ...(ok ? {} : { detail: { head: back(van) < 0 ? 'The vanguard is ahead of the SP' : night ? `Vanguard ${fmtM(tail)} deep by night` : `Vanguard ${fmtM(dayDepth)} long by day`, why: back(van) < 0 ? 'The SP is the head of the vanguard.' : night ? 'By night the distances close up: no man out of sight of his neighbour (IC s64 para 6 b p 280); Fig 12 draws the vanguard 500-600 m (IBB p 150).' : 'Strung out further, the leading Coy cannot support its point Pl or close in when it meets the En (IC s61 paras 6-7 p 261).', fix: [night ? `Close the vanguard to ${fmtM(F.bnVan[0])}-${fmtM(F.bnVan[1])} (Fig 12)` : `Close the vanguard to ${fmtM(F.bnVanDay[1])} or less`] } }),
    });
  }
  // the main guard's head: the first of Bn HQ, the mortars and the main guard behind the vanguard's tail
  const behind = [hq, mor, main].filter((p): p is XY => !!p).map(back).filter((d) => d > tail - 1);
  if (main) {
    const gap = behind.length ? Math.min(...behind) - tail : back(main) - tail;
    const inLink = gap >= F.bnLink[0] - 1 && gap <= F.bnLink[1] + 1;
    // by night the books differ: IBB at least 300-400 m (p 149), IC not less than 400-450 m (s64 para 6 c p 280): safety
    // first, it warns under IC's 400 m
    const nightMin = Math.max(F.bnMainMin[0], F.bnMainIc[0]);
    const st: CheckState = gap <= 0 ? 'warn' : night && gap < nightMin ? 'warn' : 'pass';
    rows.push({
      name: 'Main Gd', st,
      reason: night
        ? `its head ${fmtM(gap)} behind the vanguard's tail: by night at least ${F.bnMainMin[0]}-${F.bnMainMin[1]} m, so it is not within the effective range of the En small arms on contact (IBB p 149 para 4 d (4)); IC: not less than ${F.bnMainIc[0]}-${F.bnMainIc[1]} m (s64 para 6 c p 280): the books differ, warned under ${nightMin} m (safety first); Fig 12 draws the gap ${F.bnLink[0]}-${F.bnLink[1]} m filled by link groups, ${F.bnLinkMin[0]}-${F.bnLinkMin[1]} min (IBB p 150)${inLink ? '' : `: here ${gap < F.bnLink[0] ? 'shorter' : 'longer'}`}; connecting files from a Coy of the main guard, their number by the visibility (p 149 d (5))`
        : `its head ${fmtM(gap)} behind the vanguard's tail: by day the gap is set in time by the speed, the En and the country (IBB p 138 para 4); the follow-up Coys on foot in Secs along the road, a Pl about every ${F.bnFollow[0]}-${F.bnFollow[1]} m (p 139 para 9 b)`,
      ...(st === 'warn' ? { detail: { head: gap <= 0 ? 'The main guard is not behind the vanguard' : `Main guard ${fmtM(gap)} behind the vanguard by night`, why: gap <= 0 ? 'The vanguard leads; the main guard follows it.' : 'Closer, the main guard comes under the En small arms when the vanguard meets the En (IBB p 149 d (4); IC s64 para 6 c p 280).', fix: [`Hold the main guard ${Math.max(F.bnMainMin[1], F.bnMainIc[1])} m or more behind the vanguard by night (IC p 280); Fig 12 has ${F.bnLink[0]}-${F.bnLink[1]} m with link groups`] } } : {}),
    });
    // by day the Bn's length on the road (IC s61 para 7 p 261: up to 3-5 km in open country with good visibility)
    if (!night) {
      const d = back(main);
      rows.push({ name: 'Bn spread', st: d <= F.bnSpreadDay[1] + 1 ? 'pass' : 'warn', reason: `the main guard ${fmtM(d)} behind the SP: by day in open country with good visibility the Bn may be spread over ${km(F.bnSpreadDay[0])}-${km(F.bnSpreadDay[1])} at most (IC s61 para 7 p 261); the rear elements close in when the forward elements meet the En, still out of his direct fire (para 7)${d <= F.bnSpreadDay[1] + 1 ? '' : ': strung out further, the rear cannot support the front in time'}` });
    }
  }
  if (hq) {
    const d = back(hq), ok = d >= tail - 1 && (!main || d <= back(main) + 1);
    rows.push({ name: 'Bn HQ', st: ok ? 'pass' : 'warn', reason: `${fmtM(d)} behind the SP: one bound behind the rear troops of the vanguard; with two vanguards, behind the one that gives the best control (MIB p 81 para 22 b); ${night ? 'by night the Adv Gd R Gp and O Gp at the head of the main guard (IBB Fig 12 p 150)' : 'commanders well forward to react quickly (MIB p 81 a)'}${ok ? '' : ': here not between the vanguard and the main guard'}` });
  }
  if (tk) {
    const ok = back(tk) <= tail + 1;
    rows.push({ name: 'Tanks', st: ok ? 'pass' : 'warn', reason: `${ok ? 'in the vanguard' : `${fmtM(back(tk))} back, behind the vanguard`}: tanks always in the vanguard, by day and by night (MIB p 82 para 22 e); never infantry carried on the leading tanks (IBB p 139 para 7); ${night ? 'by night the advance on the main axis is mainly by infantry, the tanks joining by first light (IBB p 149 c (3))' : 'who leads, tanks or infantry, by the country (MIB p 82 f; read with the ground)'}` });
  }
  if (mor || atgm) {
    const ok = (!mor || !main || back(mor) <= back(main) + 1) && (!atgm || !main || back(atgm) <= back(main) + 1);
    rows.push({ name: 'Mortars, ATGM, RR', st: ok ? 'pass' : 'warn', reason: `${mor ? `the Mor Pl ${fmtM(back(mor))}` : ''}${mor && atgm ? ', ' : ''}${atgm ? `the ATGM ${fmtM(back(atgm))}` : ''} behind the SP: the mortar platoon well forward in the order of march to support the vanguard; the ATGM Pl and the RRs well forward, detachments interspersed in the column and with the flank security (MIB p 82 para 22 g, h); by night a Sec of 81 mm with the vanguard, the Pl less it at the head of the main guard (IBB Fig 12 p 150)${ok ? '' : ': here behind the main guard'}` });
  }
  rows.push(night
    ? { name: 'Flank clearance', st: 'pass', reason: 'by night the point Pl searches both flanks to the greatest distance it can see, the follow-up Pls of the vanguard one flank each (IBB p 149 para 4 d (1), (3)); flank guards picket the lines of approach rather than move parallel to the axis (p 149 c (2); IC s64 para 16 b p 284); villages and woods close to the axis searched, those away from it bypassed, the leading troops not bypassing opposition by night (IC s64 para 15 p 284); a flanking move on meeting the En at Coy level on a dark night, at Bn level only in moonlight or under illumination (IC s64 para 11 p 283); by night the point Sec spread 100 m on a dark night, 140 m on a moonlit one (IC s64 para 20 b (1) p 286)' }
    : { name: 'Flank clearance', st: 'pass', reason: `by day in open country the Bn clears at least ${fmtM(F.bnClear)} either side of the axis (IBB S32 para 2 i (1) p 133): the axis band laid ${fmtM(2 * F.bnClear)} wide; the vanguard well dispersed either side of the road against small arms fire from the flanks (p 139 para 9 a); a point Pl that cannot clear the En deploys into a fire base about 450-550 m wide for the Coy's attack (IC s63 para 15 p 276)` });
  return rows;
}

/** The x of a polyline (plan metres) at height y: interpolated, else its nearer end. */
function xAtY(path: XY[], y: number): number {
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1];
    if ((a.y - y) * (b.y - y) <= 0 && a.y !== b.y) return a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
  }
  const near = path.reduce((p, q) => (Math.abs(q.y - y) < Math.abs(p.y - y) ? q : p), path[0]);
  return near.x;
}

/**
 * An Armd Div on a broad front with two Bdes (recipe div-advance-two-bde): two axes, each Bde with two Regt groups up or
 * one (OoW Vol II pp 52-53), the axes apart (`div.axesApartM`, E), the covering troops ahead and the Div's flank guards
 * out against Fig 2, a follow-up Bde behind; in the desert a very wide front, multiple axes, combat groups (DW pp 35, 55).
 */
export function divAdvanceRows(items: { role: string; pts: XY[] }[], doc: DoctrineSet): Check[] {
  const F = advanceFigures(doc);
  const at = (role: string) => { const i = items.find((x) => x.role === role && x.pts.length); return i ? centre(i.pts) : null; };
  const path = (role: string) => items.find((x) => x.role === role && x.pts.length >= 2)?.pts ?? null;
  const sp = at('sp');
  if (!sp) return [];
  const rows: Check[] = [];
  const up = (side: 'L' | 'R') => items.filter((i) => new RegExp(`^rg${side}\\d$`).test(i.role) && i.pts.length).length;
  const nL = up('L'), nR = up('R');
  rows.push({ name: 'Broad front', st: 'pass', reason: `two Bdes up on two axes${nL || nR ? `, the Lt Bde with ${nL || 'no'} Regt group${nL === 1 ? '' : 's'} up, the Rt with ${nR || 'no'}` : ''}: after the break-out the Armd Div preferably advances on a broad front with two Bdes, each with two Regt groups up or one, by the En, the ground and the task (OoW Vol II pp 52-53); in the desert on a very wide front, on multiple axes, by combat groups, keeping the means to concentrate (DW pp 35, 55)` });
  const aL = path('axisL'), aR = path('axisR');
  if (aL && aR) {
    const ys = [sp.y, Math.max(...aL.map((p) => p.y), ...aR.map((p) => p.y))];
    const gaps = ys.map((y) => Math.abs(xAtY(aR, y) - xAtY(aL, y)));
    const lo = Math.min(...gaps), hi = Math.max(...gaps);
    const ok = lo >= F.divApart[0] - 1 && hi <= F.divApart[1] + 1;
    rows.push({ name: 'Axes apart', st: ok ? 'pass' : 'warn', reason: `${fmtM(gaps[0])} apart at the SP, ${fmtM(gaps[1])} at the heads: wanted ${km(F.divApart[0])}-${km(F.divApart[1])} (E: no figure printed; at least enough that one blocked route or one En posn does not stop both, at most the width of the bridgehead broken out of, within supporting distance)`, ...(ok ? {} : { detail: { head: lo < F.divApart[0] ? `Axes only ${fmtM(lo)} apart` : `Axes ${fmtM(hi)} apart`, why: lo < F.divApart[0] ? 'So close, one En posn or one blocked crossing stops both Bdes, and the front is not broad (OoW Vol II p 52).' : 'So far apart, the Bdes are out of supporting distance of each other (MIB p 84: parallel columns within supporting distance).', fix: [`Lay the axes ${km(F.divApart[0])}-${km(F.divApart[1])} apart`] } }) });
  }
  const cts = (['ctpsL', 'ctpsR'] as const).map(at).filter((p): p is XY => !!p);
  if (cts.length) {
    const ds = cts.map((p) => p.y - sp.y);
    rows.push({ name: 'Covering troops', st: ds.every((d) => d >= F.ctps[0] - 1 && d <= F.ctps[1] + 1) ? 'pass' : 'warn', reason: `${ds.map(fmtM).join(' and ')} ahead of the SP line, one screen on each axis; Fig 2: ${km(F.ctps[0])}-${km(F.ctps[1])} (${SRC})` });
  }
  const fl = (['flankL', 'flankR'] as const).map((r) => ({ r, p: at(r) })).filter((x): x is { r: 'flankL' | 'flankR'; p: XY } => !!x.p);
  if (fl.length && aL && aR) {
    const outs = fl.map(({ r, p }) => Math.abs(p.x - xAtY(r === 'flankL' ? aL : aR, p.y)));
    rows.push({ name: 'Flank guards', st: outs.every((o) => o >= F.flank[0] - 1 && o <= F.flank[1] + 1) ? 'pass' : 'warn', reason: `${outs.map(fmtM).join(' and ')} out from the outer axes; Fig 2: ${km(F.flank[0])}-${km(F.flank[1])} for the Armd Div (${SRC}); security of the manoeuvre rests on air defence and flank protection (OoW Vol II p 12 e; DW p 35)` });
  }
  const res = at('res'), heads = items.filter((i) => /^(rg[LR]\d|bde[LR])$/.test(i.role) && i.pts.length).map((i) => centre(i.pts).y);
  if (res && heads.length) {
    const d = Math.min(...heads) - res.y;
    rows.push({ name: 'Follow-up Bde', st: d >= F.followUp * 0.75 && d <= F.followUp * 1.25 ? 'pass' : 'warn', reason: `${fmtM(d)} behind the rearmost of the leading Bdes; Fig 2's note has the follow-up Bde about ${km(F.followUp)} behind the leading Bde (${SRC}; the first figure of the note is under the highlight, so the reading is uncertain): the Follow-in-Zone infantry clears and holds what the armour bypasses (OoW Vol II p 53)` });
  }
  return rows;
}

const GSP = 'GSP 1947 Inf Div in Battle';
const ANX_H = `${GSP} Annex H p 203, read from the scanned diagram`;

/**
 * An Inf Div's advance to contact on one axis (recipe div-advance-inf; GSP 1947 s18 pp 76-80, Annex H p 203): the
 * covering troops (mobile troops, flank guards), the Advance Guard of the leading Bde (Van Gd with the leading Pl(s)
 * ahead of it, Main Gd, the artillery in the gap between them), the leading Bde's main body in its harbour area, the Div
 * Tac HQ well forward in the main body, the follow-up Bde Gps in harbour areas 15-20 miles apart, the DAA at the rear.
 * `country`: the ground kind where it rests (null: not read; the Country row is grey).
 */
export function infDivAdvanceRows(items: { role: string; pts: XY[] }[], doc: DoctrineSet, country: string | null): Check[] {
  const F = advanceFigures(doc);
  const at = (role: string) => { const i = items.find((x) => x.role === role && x.pts.length); return i ? centre(i.pts) : null; };
  const sp = at('sp');
  if (!sp) return [];
  const rows: Check[] = [];
  const need: [string, string][] = [['ctps', 'mobile troops'], ['flankL', 'a flank guard'], ['vanGd', 'the Van Gd'], ['mainGd', 'the Main Gd'], ['har1', "the leading Bde's main body"], ['har2', 'the follow-up Bde Gps']];
  const miss = need.filter(([r]) => !at(r)).map(([, w]) => w);
  rows.push({ name: 'Grouping', st: miss.length ? 'warn' : 'pass', reason: `${miss.length ? `missing ${miss.join(', ')}: ` : ''}covering troops (mobile troops, flank guards), the Advance Guard (Van Gd, Main Gd) found by the leading Bde, the leading Bde less its Advance Guard and the Div less the leading Bde (follow-up Bdes, artillery and other arms) as the main body (${GSP} s18 para 9 p 78; Annex H p 203)` });
  rows.push(country === null
    ? { name: 'Country', st: 'unchecked', reason: `the ground decides: in open country the Inf Div, lacking mobility, is not suitable to advance unless made mobile; in restricted or mountainous country it advances effectively (${GSP} s18 para 3 p 76); place it with the terrain data to read the ground` }
    : country === 'mountains'
      ? { name: 'Country', st: 'pass', reason: `mountains: in restricted terrain or mountainous country the Inf Div can undertake an advance effectively (${GSP} s18 para 3 p 76)` }
      : { name: 'Country', st: 'warn', reason: `${country === 'desert' ? 'desert' : country === 'obstacle' ? 'open country with water obstacles' : 'open country'}: due to lack of mobility the Inf Div is not suitable to advance here unless made mobile, given MT or mechanised forces such as an Armd or Mech Bde (${GSP} s18 para 3 p 76); its mobility must be at par with the En's, if not greater (para 6 p 77)`, detail: { head: 'An Inf Div advancing in open country', why: 'On foot the Inf Div cannot keep constant pressure on a mobile En; the book allows it only made mobile (s18 paras 3, 6 pp 76-77).', fix: ['Make it mobile: MT from Corps and an Armd or Mech Bde under command (p 76 para 3), additional transport and mechanised elements for cross-country movement (p 77 para 6)', 'Or advance with the Armd Div (Div Advance, two Bdes)'] } });
  const ct = at('ctps');
  if (ct) {
    const d = ct.y - sp.y, ok = d >= F.idivCtps[0] - 1 && d <= F.idivCtps[1] + 1;
    rows.push({ name: 'Covering troops', st: ok ? 'pass' : 'warn', m: d, reason: `the mobile troops ${fmtM(d)} ahead of the Van Gd: approx 1 h or 10-15 miles (${km(F.idivCtps[0])}-${km(F.idivCtps[1])}) by the nature of the terrain, the range of comms, the En air and dispositions (${ANX_H}); tactically self-contained, under Div control at considerable distance in front, mobility at least the En's (s18 para 10 a-b p 79)` });
  }
  const lp = at('ldgPl'), v = at('vanGd'), m = at('mainGd'), ar = at('arty');
  if (lp) {
    const d = lp.y - sp.y, min = (d / 1000) * (60 / F.footGo), ok = min >= F.idivLdgPlMin[0] - 1 && min <= F.idivLdgPlMin[1] + 1;
    rows.push({ name: 'Leading Pl', st: ok ? 'pass' : 'warn', m: d, reason: `${fmtM(d)} ahead of the Van Gd, about ${Math.round(min)} min at ${F.footGo} km/h on foot (IPB p 18): 20-30 min or the time required to deal with minor opposition; only the leading Pl(s) move deployed (${ANX_H})` });
  }
  if (v && m) rows.push({ name: 'Main Gd', st: m.y < v.y ? 'pass' : 'warn', reason: `${fmtM(v.y - m.y)} behind the Van Gd: its elements move tactically astride the axis but not deployed, far enough back that the Advance Guard does not get prematurely involved in the Van Gd's battle; the Van Gd less the leading Pl(s) moves tactically astride the axis, not deployed (${ANX_H}; the time printed for this gap is not legible in the scan)` });
  if (v && m) rows.push(ar && ar.y < v.y && ar.y > m.y
    ? { name: 'Arty with Adv Gd', st: 'pass', reason: `in the gap between the Van Gd and the Main Gd at first; then its batteries leapfrog, ensuring continuous support to the leading elements (${ANX_H}); the artillery less that under the Adv Gd regulates its move by the pace of the Adv Gd (ibid.)` }
    : { name: 'Arty with Adv Gd', st: 'warn', reason: `${ar ? 'not' : 'no artillery'} in the gap between the Van Gd and the Main Gd: it initially moves there, then its batteries leapfrog, ensuring continuous support to the leading elements (${ANX_H})` });
  const h1 = at('har1'), h2 = at('har2'), hn = at('harNext');
  if (h1 && (h2 || hn)) {
    const gaps = [h2 ? h2.y - h1.y : null, hn ? h1.y - hn.y : null].filter((g): g is number => g !== null).map((g) => -g);
    const ok = gaps.every((g) => g >= F.idivHar[0] - 1 && g <= F.idivHar[1] + 1);
    rows.push({ name: 'Harbour areas', st: ok ? 'pass' : 'warn', reason: `${gaps.map(fmtM).join(' and ')} apart: harbour areas for the Bde Gps and other Div elements selected by the Div, normally 15-20 miles (${km(F.idivHar[0])}-${km(F.idivHar[1])}) apart; units and formations moved forward from one harbour area to the next when given a clear run (${ANX_H}); chosen for the time gap behind the Adv Gd, terrain friction, the air threat and cover (s18 para 12 p 80)` });
  }
  const tac = at('divTac');
  if (tac && m) rows.push({ name: 'Div Tac HQ', st: tac.y < m.y && (!h2 || tac.y > h2.y) ? 'pass' : 'warn', reason: `${fmtM(sp.y - tac.y)} behind the Van Gd's head: the Div Tac HQ moves well forward in the main body; control by the axis, bounds, report lines, control points, objectives and fire co-ordination measures (${GSP} s18 para 14 p 80)` });
  const daa = at('daa');
  if (daa && h1) {
    const d = h1.y - daa.y;
    rows.push({ name: 'DAA', st: d <= 48000 ? 'pass' : 'warn', m: d, limitM: 48000, limitSrc: 'lsf p 27', reason: `${fmtM(d)} behind the leading Bde's main body: its place and move dictated by the turn-round distance between the leading Bde's B Ech and the DAA / RPs, moved as little as the tactical plan and logistic support allow (${ANX_H}); first line turns round within 48 km of the RP, second line within 64 km (lsf p 27, Annex F p 72)${d > 48000 ? ': an RP forward near the leading Bde (lsf pp 4-5)' : ''}` });
  }
  const fl = (['flankL', 'flankR'] as const).map(at).filter((p): p is XY => !!p);
  if (fl.length) {
    const outs = fl.map((p) => Math.abs(p.x - sp.x)), ok = fl.length === 2 && outs.every((o) => o >= F.idivFlank[0] - 1 && o <= F.idivFlank[1] + 1);
    rows.push({ name: 'Flank guards', st: ok ? 'pass' : 'warn', reason: `${outs.map(fmtM).join(' and ')} out from the axis${fl.length < 2 ? ' (one flank only)' : ''}: they watch the exposed flanks and give early warning, moving on a route parallel to the main axis or picketing the lines of approach; the LAT elements or the Corps recce regiment suit them (${GSP} s18 para 10 c p 79: no distance printed; ${km(F.idivFlank[0])}-${km(F.idivFlank[1])} is a decision, E)` });
  }
  return rows;
}

// ── the axis on the ground ────────────────────────────────────────────────────────────────────────────────────────

/** Water the axis crosses (rules.json classes): permanent water, seasonal water, canal, distributary, drain, stream. */
const WET = new Set([4, 5, 20, 21, 22, 46]);
/** The water a bound is set on: permanent water, canal, distributary, perennial stream (not drains). */
const RL_WATER = new Set([4, 20, 21, 46]);
/** How the axis crosses (rules.json crossing classes), for tracks: its word and verdict. */
const CROSSING: Record<number, { word: string; st: CheckState }> = {
  39: { word: 'a Cl 60+ bridge', st: 'pass' },
  40: { word: 'a Cl 50-59 bridge (the Al-Zarrar crosses; the Al-Khalid and T-80UD need Cl 60)', st: 'warn' },
  41: { word: 'a bridge below Cl 50 (no tank crosses)', st: 'fail' },
  42: { word: 'a bridge of unrecorded class (recce it before the tanks)', st: 'warn' },
  43: { word: 'a railway bridge', st: 'fail' },
  44: { word: 'a foot bridge', st: 'fail' },
  45: { word: 'a ford / ferry', st: 'warn' },
};
const ROAD: Record<number, string> = { 34: 'Cl 60+', 35: 'Cl 50-59', 36: 'below Cl 50', 37: 'class not recorded', 38: 'unmetalled' };
const worse = (a: CheckState, b: CheckState): CheckState => (['pass', 'unchecked', 'warn', 'fail'].indexOf(b) > ['pass', 'unchecked', 'warn', 'fail'].indexOf(a) ? b : a);

/** Points every `step` metres along a polyline (plan metres), with their distance along it. */
function walk(path: XY[], step: number): { p: XY; s: number; dir: XY }[] {
  const out: { p: XY; s: number; dir: XY }[] = [];
  let s0 = 0, next = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1], L = Math.hypot(b.x - a.x, b.y - a.y);
    if (!L) continue;
    const dir = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
    // evenly spaced along the whole line, across the bends
    for (; next <= s0 + L; next += step) { const t = next - s0; out.push({ p: { x: a.x + dir.x * t, y: a.y + dir.y * t }, s: next, dir }); }
    s0 += L;
  }
  return out;
}

/** A polyline simplified to within `tolM` of itself (Douglas-Peucker), for the axis arrow's control points. */
function simplify(path: XY[], tolM: number): XY[] {
  if (path.length <= 2) return path;
  const a = path[0], b = path[path.length - 1], L = Math.hypot(b.x - a.x, b.y - a.y);
  let far = 0, at = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const p = path[i];
    const d = L ? Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / L : Math.hypot(p.x - a.x, p.y - a.y);
    if (d > far) { far = d; at = i; }
  }
  if (far <= tolM) return [a, b];
  return [...simplify(path.slice(0, at + 1), tolM).slice(0, -1), ...simplify(path.slice(at), tolM)];
}

/** The point of a polyline nearest `p`: the leg it is on (`i` its start), the point, its distance along the line. */
function project(path: XY[], p: XY): { i: number; q: XY; s: number } {
  let best = { i: 0, q: path[0], s: 0 }, bd = Infinity, s0 = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy, L = Math.sqrt(L2);
    const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
    const q = { x: a.x + dx * t, y: a.y + dy * t }, d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < bd) { bd = d; best = { i, q, s: s0 + t * L }; }
    s0 += L;
  }
  return best;
}

const lenOf = (path: XY[]) => path.reduce((s, p, i) => (i ? s + Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y) : 0), 0);

/** The axis as laid: the Main Body through the SP to the covering troops (plan metres), and how far along it the SP is. */
export interface AdvAxis { path: XY[]; spAt: number; routed: boolean; pending: boolean; drawn?: boolean; legs?: { rear: boolean; fwd: boolean } }

/**
 * The axis on the ground: the least-cost way for tracks over the bundle's going (PlanGround.avenues: NO-GO avoided,
 * SLOW-GO dear), from the Main Body to the SP and from the SP to the covering troops; straight where no way is found
 * (outside the bundle's grid, or still loading). It is not a road route: the Move Planner's is.
 */
export function routeAxis(items: { role: string; pts: XY[] }[], f: FitFrame, g: PlanGround, o: { rear?: string; aheadM?: number } = {}): AdvAxis {
  const at = (role: string) => { const i = items.find((x) => x.role === role && x.pts.length); return i ? centre(i.pts) : null; };
  // the rear end: the Main Body (Fig 2), or for a Bn Adv Gd its main guard; ahead: the C Tps, else `aheadM` past the SP
  const sp = at('sp')!, ct = at('ctps') ?? { x: sp.x, y: sp.y + (o.aheadM ?? 6000) }, mb = at(o.rear ?? 'mainBody') ?? { x: sp.x, y: sp.y - 8000 };
  let pending = false;
  const leg = (a: XY, b: XY): { pts: XY[]; routed: boolean } => {
    if (!g.avenues) return { pts: [a, b], routed: false };
    const A = toWorld(f, a), B = toWorld(f, b);
    const r = g.avenues(A, B, 400, 'tracked');
    if (r === null) { pending = pending || g.pending(); return { pts: [a, b], routed: false }; }
    const p = r[0]?.path;
    if (!p || p.length < 2) return { pts: [a, b], routed: false };
    const loc = p.map((w) => toLocal(f, w));
    // from `a` to `b`, whichever way the reader gave it
    if (Math.hypot(loc[0].x - a.x, loc[0].y - a.y) > Math.hypot(loc[loc.length - 1].x - a.x, loc[loc.length - 1].y - a.y)) loc.reverse();
    return { pts: [a, ...loc.slice(1, -1), b], routed: true };
  };
  const rear = leg(mb, sp), fwd = leg(sp, ct);
  return { path: [...rear.pts, ...fwd.pts.slice(1)], spAt: lenOf(rear.pts), routed: rear.routed && fwd.routed, pending, legs: { rear: rear.routed, fwd: fwd.routed } };
}

/** The water features the axis crosses, in order: where along it, the water, how it is crossed. */
export interface AxisCrossing { s: number; at: XY; dir: XY; water: number | null; how: number | null; lengthM: number }
/** A road or railway stretch the axis is on: where along it, its class (28 railway when any of it is), its length. */
export interface AxisLateral { s: number; at: XY; dir: XY; cls: number; lengthM: number }
/** Roads, railways and level crossings (rules.json): a short stretch of them on the axis is a lateral it crosses. */
const LATERAL = new Set([28, 34, 35, 36, 37, 38, 50]);

/** Read the classes along the axis: the NO-GO run, the road share, the water crossed (one feature per wet stretch). */
function readAxis(axis: AdvAxis, f: FitFrame, g: PlanGround) {
  const STEP = 20;
  const tracked = g.going('tracked');
  const pts = walk(axis.path, STEP);
  let n = 0, bad = 0, run = 0, worst = 0, worstAt = 0;
  const roads = new Map<number, number>();
  const xs: AxisCrossing[] = [];
  let cur: AxisCrossing | null = null, gap = 0;
  // roads and railways the axis is on, stretch by stretch (a short one is a lateral it crosses: a report line)
  const lat: AxisLateral[] = [];
  let lc: AxisLateral | null = null, lgap = 0;
  for (const q of pts) {
    const w = toWorld(f, q.p);
    const c = g.cls(w.x, w.y);
    if (c === null) continue;
    if (LATERAL.has(c)) {
      if (!lc) { lc = { s: q.s, at: q.p, dir: q.dir, cls: c, lengthM: 0 }; lat.push(lc); }
      lc.lengthM = q.s - lc.s + STEP;
      if (c === 28) lc.cls = 28;
      lgap = 0;
    } else if (lc && (lgap += STEP) >= 40) lc = null;
    n++;
    const no = tracked.nogo.has(c);
    if (no) bad++;
    run = no ? run + STEP : 0;
    if (run > worst) { worst = run; worstAt = q.s - run / 2 - axis.spAt; }
    if (ROAD[c]) roads.set(c, (roads.get(c) ?? 0) + STEP);
    // a wet stretch or a crossing on it, joined across gaps under 60 m
    const wet = WET.has(c), how = CROSSING[c] ? c : null;
    if (wet || how !== null) {
      if (!cur) { cur = { s: q.s, at: q.p, dir: q.dir, water: wet ? c : null, how, lengthM: 0 }; xs.push(cur); }
      cur.lengthM = q.s - cur.s + STEP;
      if (wet && (cur.water === null || RL_WATER.has(c))) cur.water = c;
      if (how !== null && (cur.how === null || CROSSING[how].st !== 'pass')) cur.how = how;
      gap = 0;
    } else if (cur && (gap += STEP) >= 60) cur = null;
  }
  // water read with no crossing on the line: the line may pass just beside the bridge (a drawn axis, a raster cell):
  // a crossing within 60 m either side is taken as the one used
  for (const x of xs) {
    if (x.water === null || x.how !== null) continue;
    const mid = { x: x.at.x + x.dir.x * (x.lengthM / 2), y: x.at.y + x.dir.y * (x.lengthM / 2) }, n2 = { x: -x.dir.y, y: x.dir.x };
    for (let d = 20; d <= 60 && x.how === null; d += 20) for (const sgn of [1, -1]) {
      const w = toWorld(f, { x: mid.x + n2.x * d * sgn, y: mid.y + n2.y * d * sgn });
      const c = g.cls(w.x, w.y);
      if (c !== null && CROSSING[c] && c !== 50) { x.how = c; break; }
    }
  }
  // a bridge read along its deck shows no water: the water it spans is beside it, up to 150 m either side
  for (const x of xs) {
    if (x.water !== null || x.how === null || x.how === 50) continue;
    const mid = { x: x.at.x + x.dir.x * (x.lengthM / 2), y: x.at.y + x.dir.y * (x.lengthM / 2) }, n2 = { x: -x.dir.y, y: x.dir.x };
    for (let d = 30; d <= 150 && x.water === null; d += 30) for (const sgn of [1, -1]) {
      const w = toWorld(f, { x: mid.x + n2.x * d * sgn, y: mid.y + n2.y * d * sgn });
      const c = g.cls(w.x, w.y);
      if (c !== null && WET.has(c)) { x.water = c; break; }
    }
  }
  const steps = pts.length;
  return { n, steps, bad, worst, worstAt, roads, xs: xs.filter((x) => x.water !== null || (x.how !== null && x.how !== 50)), lat };
}

/**
 * The going and the water crossed along one axis as read: "Going on the <name>" (NO-GO share and longest stretch) and
 * "Crossings on the <name>" (each water feature and how it is crossed for tracks). `name` is 'axis' for a single axis,
 * 'Lt axis' / 'Rt axis' for a Div's two.
 */
function axisReadRows(R: ReturnType<typeof readAxis>, ax: AdvAxis, g: PlanGround, F: ReturnType<typeof advanceFigures>, name: string): Check[] {
  const rows: Check[] = [];
  const total = lenOf(ax.path);
  const where = (s: number) => (s >= ax.spAt ? `${fmtM(s - ax.spAt)} ahead of the SP` : `${fmtM(ax.spAt - s)} behind the SP`);
  const share = R.bad / R.n;
  const gst: CheckState = R.worst > F.run[1] ? 'fail' : R.worst > F.run[0] || share > F.nogoWarn ? 'warn' : 'pass';
  rows.push({ name: `Going on the ${name}`, st: gst, reason: `${Math.round(share * 100)} % of the ${km(total)} is NO-GO for tracks (the bundle's tracked going, 20 m steps); the longest NO-GO stretch ${fmtM(R.worst)}${R.worst ? ` ${R.worstAt >= 0 ? `${fmtM(R.worstAt)} ahead of` : `${fmtM(-R.worstAt)} behind`} the SP` : ''} (warn over ${F.run[0]} m or ${Math.round(F.nogoWarn * 100)} %, fail over ${F.run[1]} m: E)${gst === 'pass' ? '' : ': a bridge or a detour there, or another axis; the mobile troops to seize the crossing ahead (s4 para 2)'}` });
  if (!R.xs.length) rows.push({ name: `Crossings on the ${name}`, st: 'pass', reason: `the ${name} crosses no water the bundle shows` });
  else {
    let st: CheckState = 'pass';
    const parts = R.xs.map((x) => {
      const water = x.water !== null ? g.label(x.water) : x.how !== null && x.how <= 44 ? 'water under a bridge' : 'water';
      const h = x.how !== null ? CROSSING[x.how] : null;
      const s1: CheckState = h ? h.st : 'fail';
      st = worse(st, s1);
      return `${water} ${where(x.s)}: ${h ? h.word : `no bridge on the ${name} (${fmtM(x.lengthM)} of it): bridge it, or the ${name} to a bridge`}`;
    });
    rows.push({ name: `Crossings on the ${name}`, st, reason: `${R.xs.length} water feature${R.xs.length > 1 ? 's' : ''}: ${parts.join('; ')}. Tanks need Cl 60 (rules.json; Al-Khalid about 48 t); the mobile troops seize the bridges ahead (s4 para 2)` });
  }
  return rows;
}

/**
 * On the ground, along the axis as laid (routed for tracks where the bundle allows): Axis route (its length against the
 * straight line, the share on roads and their classes), Going on the axis (NO-GO share and longest stretch), Crossings
 * on the axis (each water feature, how it is crossed: a Cl 60+ bridge passes, Cl 50-59 or unrecorded warns, below Cl 50
 * or none fails), Bounds (on the water features ahead of the SP: a tactical feature where the troops halt, IC s58 para 4
 * p 242) and Report lines (on the lateral roads and railways: no tactical significance, para 6 p 243), each at least
 * `rlApartM` apart, up to four, and the flank guards' ground. The lines laid (bd1.., rl1..) are returned for the map;
 * `lines` are the bounds (the halting areas stand short of them), `rlLines` the report lines.
 */
export function advanceGroundRows(items: { role: string; pts: XY[] }[], f: FitFrame, g: PlanGround, doc: DoctrineSet, axis: AdvAxis | null = null, drawnRls: DrawnLine[] | null = null, rlApartM: number | null = null, night = false): { rows: Check[]; rls: Record<string, { pts: XY[]; label: string }>; lines: { label: string; s: number }[]; rlLines: { label: string; s: number }[] } {
  const F = advanceFigures(doc);
  const at = (role: string) => { const i = items.find((x) => x.role === role && x.pts.length); return i ? centre(i.pts) : null; };
  const head = at('sp');
  const rls: Record<string, { pts: XY[]; label: string }> = {};
  if (!head) return { rows: [], rls, lines: [], rlLines: [] };
  const ax: AdvAxis = axis ?? (() => {
    const ct = at('ctps') ?? { x: head.x, y: head.y + (F.ctps[0] + F.ctps[1]) / 2 }, mb = at('mainBody') ?? { x: head.x, y: head.y - F.body };
    return { path: [mb, head, ct], spAt: Math.hypot(head.x - mb.x, head.y - mb.y), routed: false, pending: false };
  })();
  const R = readAxis(ax, f, g);
  const rows: Check[] = [];
  const total = lenOf(ax.path);
  const where = (s: number) => (s >= ax.spAt ? `${fmtM(s - ax.spAt)} ahead of the SP` : `${fmtM(ax.spAt - s)} behind the SP`);
  if (R.n < R.steps / 2) {
    rows.push({ name: 'Going on the axis', st: 'unchecked', reason: 'the ground along the axis is not loaded yet' });
    return { rows, rls, lines: [], rlLines: [] };
  }
  // the route
  const straight = Math.hypot(ax.path[ax.path.length - 1].x - ax.path[0].x, ax.path[ax.path.length - 1].y - ax.path[0].y);
  const onRoad = [...R.roads.values()].reduce((s, v) => s + v, 0);
  const roadTxt = R.roads.size ? `; ${Math.round((onRoad / total) * 100)} % on roads (${[...R.roads.entries()].sort((a, b) => b[1] - a[1]).map(([c, m]) => `${ROAD[c]} ${fmtM(m)}`).join(', ')})` : '; none of it on a road';
  // one leg routed, the other not: say which leg is straight
  const oneLeg = !ax.routed && ax.legs && ax.legs.rear !== ax.legs.fwd ? (ax.legs.rear ? 'from the SP to the C Tps' : 'from the Main Body to the SP') : '';
  rows.push(ax.routed
    ? { name: 'Axis route', st: total > straight * F.detour + 1 ? 'warn' : 'pass', reason: `${ax.drawn ? 'the axis as drawn (no way searched: its going and crossings read along it)' : 'the least-cost way for tracks over the bundle\'s going (NO-GO avoided, SLOW-GO dear)'}, the Main Body through the SP to the C Tps: ${km(total)} against ${km(straight)} straight (${(total / straight).toFixed(2)} times; warn over ${F.detour}, E)${roadTxt}. Not a road route: the march table and the roads' classes are the Move Planner's` }
    : { name: 'Axis route', st: 'unchecked', reason: `${ax.pending ? 'the ground for the route is still loading' : `no way for tracks found${oneLeg ? ` ${oneLeg}` : ''} in the bundle's grid (about 25 km across)${R.xs.some((x) => x.how === null) ? ', with water across the axis and no bridge on it (Crossings on the axis): bridge it, or another axis' : ''}`}: ${oneLeg ? 'that leg read on the straight line, the other along its way' : 'the straight line read instead'}${roadTxt}` });
  rows.push(...axisReadRows(R, ax, g, F, 'axis'));
  // bounds on the water ahead of the SP: a tactical feature of importance, the troops halt and secure it before passing
  // through (IC s58 para 4 p 242); report lines on the lateral roads and railways: no tactical significance, the units
  // report but do not halt (para 6 p 243). Laid, or read as drawn (Check my plan)
  const RL_MAX = 4, apart = rlApartM ?? F.rlApart;
  const SRC_CM = 'bounds and report lines are control measures of the advance (OoW Vol II s4 para 8 p 11)';
  const nightTxt = night ? '; by night bounds and report lines at shorter intervals (IC s64 para 6 g (3) p 281; IBB p 148): no figure, set RL apart shorter' : '';
  let lines: { label: string; s: number }[];
  let rlLines: { label: string; s: number }[];
  // drawn lines with no axis drawn are measured from the SP (checkAdvance): on the fallback axis the SP lies spAt in
  const asDrawn = (k: 'bd' | 'rl') => (drawnRls ?? []).filter((l) => (l.kind ?? 'rl') === k).map((l) => (axis ? l : { ...l, s: l.s + ax.spAt }));
  if (drawnRls) { lines = asDrawn('bd'); rlLines = asDrawn('rl'); }
  else {
    lines = [];
    rlLines = [];
    // the water ahead, at least `apart` between them; within that, the bigger obstacle wins (a canal or river over a
    // stream, a stream over a distributary, water over a bridge alone); of the same kind, the wider on the axis
    const RANK: Record<number, number> = { 4: 4, 20: 4, 46: 3, 21: 2 };
    const rank = (x: AxisCrossing) => (x.water !== null ? RANK[x.water] ?? 1 : 1);
    const bigger = (x: AxisCrossing, y: AxisCrossing) => rank(x) > rank(y) || (rank(x) === rank(y) && x.lengthM > y.lengthM);
    const pick: AxisCrossing[] = [];
    for (const x of R.xs) {
      if (!(x.water !== null ? RL_WATER.has(x.water) : x.how !== null && x.how >= 39 && x.how <= 43) || x.s <= ax.spAt + 300) continue;
      const last = pick[pick.length - 1];
      if (last && x.s - last.s < apart) { if (bigger(x, last)) pick[pick.length - 1] = x; continue; }
      if (pick.length < RL_MAX) pick.push(x);
    }
    const across = (at: XY, dir: XY) => { const half = 750, n = { x: -dir.y, y: dir.x }; return [{ x: at.x - n.x * half, y: at.y - n.y * half }, { x: at.x + n.x * half, y: at.y + n.y * half }]; };
    pick.forEach((x, k) => {
      const i = k + 1;
      const name = x.water !== null ? g.label(x.water).replace(/ \/.*$/, '') : 'bridge';
      rls[`bd${i}`] = { pts: across(x.at, x.dir), label: `Bd ${i} ${name}` };
      lines.push({ label: `Bd ${i} (${name})`, s: x.s });
    });
    // the lateral roads and railways ahead: stretches of them on the axis no longer than `rlLateralMaxM` (longer, the axis
    // runs along the road), not within 300 m of a bound, at least `apart` between them; a railway over a road
    const latPick: AxisLateral[] = [];
    for (const x of R.lat) {
      if (x.lengthM > F.lateralMax || x.s <= ax.spAt + 300 || lines.some((l) => Math.abs(l.s - x.s) < 300)) continue;
      const last = latPick[latPick.length - 1];
      if (last && x.s - last.s < apart) { if (x.cls === 28 && last.cls !== 28) latPick[latPick.length - 1] = x; continue; }
      if (latPick.length < RL_MAX) latPick.push(x);
    }
    latPick.forEach((x, k) => {
      const i = k + 1, name = x.cls === 28 ? 'railway' : x.cls === 50 ? 'level crossing' : 'road';
      rls[`rl${i}`] = { pts: across(x.at, x.dir), label: `RL ${i} ${name}` };
      rlLines.push({ label: `RL ${i} (${name})`, s: x.s });
    });
  }
  // one row per kind: where each lies, the stretches between them, the spacing (as drawn: checked against it)
  const kindRow = (name: string, ls: { label: string; s: number }[], what: string, none: Check): Check => {
    if (!ls.length) return none;
    const sorted = [...ls].sort((a, b) => a.s - b.s);
    const short = (l: { label: string }) => l.label.replace(/ \(.*$/, '');
    const legs = sorted.map((l, i) => `${i ? short(sorted[i - 1]) : 'SP'} to ${short(l)} ${fmtM(l.s - (i ? sorted[i - 1].s : ax.spAt))}`);
    const close = drawnRls ? sorted.slice(1).map((l, i) => ({ a: sorted[i], b: l, d: l.s - sorted[i].s })).filter((p) => p.d < apart * 0.95) : [];
    const how = drawnRls
      ? `read as drawn, at least ${km(apart)} apart wanted: ${rlApartM ? 'as set' : 'the default, E'}${close.length ? `; ${close.map((p) => `${p.a.label} to ${p.b.label} only ${fmtM(p.d)}`).join(', ')}` : ''}`
      : `${what}, at least ${km(apart)} apart: ${rlApartM ? 'as set' : 'the default, E'}`;
    return { name, st: close.length ? 'warn' : 'pass', reason: `${sorted.map((l) => `${l.label} ${where(l.s)}`).join('; ')} (${how}; ${SRC_CM})${nightTxt}. ${name === 'Bounds' ? 'Bounds' : 'Between them'}: ${legs.join(', ')}` };
  };
  rows.push(kindRow('Bounds', lines, 'on the water across the axis: a bound is a tactical feature of importance; the troops halt there and secure it before passing through, the point Pl approaching it secured (IC s58 para 4 p 242)',
    { name: 'Bounds', st: 'unchecked', reason: `${drawnRls ? 'no bound drawn' : 'no canal, distributary or stream crosses the axis ahead of the SP'}: set bounds by eye on the tactical features across the axis, a feature of importance on the map and on the ground where the troops halt and secure it (IC s58 para 4 p 242; ${SRC_CM})${nightTxt}` }));
  rows.push(kindRow('Report lines', rlLines, 'on the lateral roads and railways across the axis: a line of no tactical significance on which the units report but do not halt (IC s58 para 6 p 243)',
    { name: 'Report lines', st: 'unchecked', reason: `${drawnRls ? 'no report line drawn' : 'no lateral road or railway crosses the axis ahead of the SP'}: set report lines by eye on a lateral road or railway, a line of no tactical significance on which the units report but do not halt (IC s58 para 6 p 243; ${SRC_CM})` }));
  // the flank guards
  const tracked = g.going('tracked');
  const fl = (['flankL', 'flankR'] as const).map((r) => ({ r, p: at(r) })).filter((x): x is { r: 'flankL' | 'flankR'; p: XY } => !!x.p);
  if (fl.length) {
    const read = fl.map(({ r, p }) => { const w = toWorld(f, p); const c = g.cls(w.x, w.y); return { side: r === 'flankL' ? 'left' : 'right', c, no: c !== null && tracked.nogo.has(c), slow: c !== null && tracked.caution.has(c) }; });
    const known = read.filter((x) => x.c !== null);
    rows.push(!known.length ? { name: 'Flank guards\' ground', st: 'unchecked', reason: 'their ground is not loaded yet' }
      : { name: 'Flank guards\' ground', st: known.some((x) => x.no) ? 'warn' : 'pass', reason: known.map((x) => `the ${x.side} flank guard on ${g.label(x.c!)}${x.no ? ' (NO-GO for tracks)' : x.slow ? ' (SLOW-GO for tracks)' : ''}`).join('; ') });
  }
  return { rows, rls, lines, rlLines };
}

// ── the march: timings and halting areas (the Move Planner's road engine) ───────────────────────────────────────────

/** A serial of the advance: its name and vehicles, and what was counted. */
export interface MarchSerial { name: string; vehicles: number; known: string }
/** What the advance's march is worked from (Recipe.march): the serials from the ORBAT, the Move Planner's road rules. */
export interface AdvMarch { serials: MarchSerial[]; rules: MvRoadRules; src: string }

/**
 * The serials from the ORBAT: the Advance Guard an Armr Regt group (the Armr Regt's vehicles, p 115-117), the Main
 * Body the IABG less that Regt (its units' vehicle totals; those the ORBAT gives none for are named, not counted).
 * The road rules are MoveDoctrine `road` (speeds with tanks, density, halts). Null without the IABG or the Regt.
 */
export function marchFromOrbat(o: OrbatSet, moveDoc: any): AdvMarch | null {
  const find = (id: string | undefined) => (id ? o.own.find((u) => u.id === id) ?? null : null);
  const vehs = (u: any) => Number((u?.vehicles ?? []).find((v: any) => /^Total/i.test(String(v.name)))?.count) || 0;
  const regt = find('armr-regt'), bde = find('armr-iabg');
  const rv = vehs(regt);
  if (!regt || !bde || !rv) return null;
  let body = 0;
  const known: string[] = [], unknown: string[] = [];
  for (const c of bde.children ?? []) {
    const n = (Number(c.count) || 1) - (c.unit === 'armr-regt' ? 1 : 0);
    if (n <= 0) continue;
    const v = vehs(find(c.unit));
    if (v) { body += v * n; known.push(`${n > 1 ? `${n} ` : ''}${c.role} ${v * n}`); } else unknown.push(String(c.role));
  }
  return {
    serials: [
      { name: 'Adv Gd (Armr Regt gp)', vehicles: rv, known: `the Armr Regt's ${rv} vehicles (p ${regt.page})` },
      { name: 'Main Body', vehicles: body, known: `${known.join(', ')}; not counted, no vehicle total in the ORBAT: ${unknown.join(', ')}` },
    ],
    rules: roadRulesFrom(moveDoc),
    src: `SO's Hbk 2019 p ${bde.page} (IABG: 3 Armr Regts as printed, two held on the ground), MoveDoctrine road (R)`,
  };
}

/** The point and direction at distance `s` along a polyline. */
function pointAt(path: XY[], s: number): { p: XY; dir: XY } {
  let s0 = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1], L = Math.hypot(b.x - a.x, b.y - a.y);
    if (!L) continue;
    if (s <= s0 + L || i === path.length - 2) { const t = Math.max(0, Math.min(1, (s - s0) / L)); return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, dir: { x: (b.x - a.x) / L, y: (b.y - a.y) / L } }; }
    s0 += L;
  }
  return { p: path[0], dir: { x: 0, y: 1 } };
}

/** The polyline from distance `s0` to its end. */
function from(path: XY[], s0: number): XY[] {
  const out: XY[] = [pointAt(path, s0).p];
  let s = 0;
  for (let i = 0; i + 1 < path.length; i++) { s += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y); if (s > s0 + 1) out.push(path[i + 1]); }
  return out;
}

const hPlus = (min: number) => `H${min < 0 ? '-' : '+'}${Math.floor(Math.abs(min) / 60)}:${String(Math.round(Math.abs(min) % 60)).padStart(2, '0')}`;

/**
 * Halting areas for the Main Body (harbour areas chosen by the time gap between echelons, with space, cover and
 * concealment: OoW Vol II s4 p 12): one 1 km short of each bound (the troops halt at bounds, IC s58 para 4 p 242), beside the axis on its right so the axis stays clear (`advance.haShortOfRlM`, `haSizeM`: the user's).
 */
export function haltingAreas(axis: AdvAxis, lines: { label: string; s: number }[], shortM = 1000, size: [number, number] = [600, 400]): Record<string, { pts: XY[]; label: string }> {
  const out: Record<string, { pts: XY[]; label: string }> = {};
  [...lines].sort((a, b) => a.s - b.s).slice(0, 4).forEach((l, i) => {
    const { p, dir } = pointAt(axis.path, Math.max(0, l.s - shortM));
    const n = { x: dir.y, y: -dir.x }, c = { x: p.x + n.x * (size[1] / 2 + 300), y: p.y + n.y * (size[1] / 2 + 300) };
    const corner = (u: number, v: number) => ({ x: c.x + dir.x * u + n.x * v, y: c.y + dir.y * u + n.y * v });
    const hu = size[0] / 2, hv = size[1] / 2;
    out[`ha${i + 1}`] = { pts: [corner(-hu, -hv), corner(hu, -hv), corner(hu, hv), corner(-hu, hv)], label: `HA ${i + 1}` };
  });
  return out;
}

/** Classes that conceal a halting force from the air: tree cover, walled orchard, orchard, forest (rules.json). */
const CONCEAL = new Set([1, 29, 30, 31]);
/** Close country for who leads the vanguard (MIB p 82 f): trees, built-up area, orchards, forest. */
const CLOSE = new Set([1, 3, 29, 30, 31]);
/** Roads and tracks a halting force can enter and leave by (rules.json road classes). */
const ROADS_IN = new Set([34, 35, 36, 37, 38]);

/** A halting area as sited on the ground: its side of the axis, how far it was moved along it, and what was read in it. */
export interface HaSite { role: string; label: string; pts: XY[]; side: 'right' | 'left'; shiftM: number; cover: number | null; room: number | null; entry: 'axis' | 'road' | null }

/**
 * The Main Body's halting areas sited on the ground: for each bound the area `haShortOfRlM` short of it is tried
 * on the right of the axis, then on the left (Fig 2 draws HAR-1 right, HAR-2 left), and `haScore.shiftM` forward and
 * back along it (never onto the bound); the one kept has the most natural cover (trees, orchards, forest) up to
 * `coverShareWant`, the most firm ground for tracks up to `roomShareMin`, and an entry: the ground between it and the
 * axis passable for tracks, or a road or track within `entryRoadM` (IBB S35 para 11 a p 160; OoW Vol II p 12). Row
 * "Halting areas" names each with its side, cover, room and entry; it warns where one falls short.
 */
export function siteHaltingAreas(axis: AdvAxis, lines: { label: string; s: number }[], f: FitFrame, g: PlanGround, doc: DoctrineSet): { areas: Record<string, { pts: XY[]; label: string }>; sites: HaSite[]; row: Check | null } {
  const F = advanceFigures(doc);
  const tracked = g.going('tracked');
  const firm = (c: number) => !tracked.nogo.has(c) && !WET.has(c);
  const cls = (p: XY) => { const w = toWorld(f, p); return g.cls(w.x, w.y); };
  const [len, wid] = F.haSize, hu = len / 2, hv = wid / 2;
  const sites: HaSite[] = [];
  const areas: Record<string, { pts: XY[]; label: string }> = {};
  [...lines].sort((a, b) => a.s - b.s).slice(0, 4).forEach((l, i) => {
    let best: (HaSite & { score: number; known: boolean }) | null = null;
    for (const side of [1, -1] as const) {
      for (const sh of [0, -F.haShift, F.haShift]) {
        const s0 = Math.max(0, l.s - F.haShort + sh);
        if (s0 > l.s - 200) continue;
        const { p, dir } = pointAt(axis.path, s0);
        const n = side > 0 ? { x: dir.y, y: -dir.x } : { x: -dir.y, y: dir.x };
        const c = { x: p.x + n.x * (hv + 300), y: p.y + n.y * (hv + 300) };
        const at = (u: number, v: number) => ({ x: c.x + dir.x * u + n.x * v, y: c.y + dir.y * u + n.y * v });
        let k = 0, cov = 0, room = 0, unknown = 0;
        for (let u = -hu; u <= hu + 1; u += 50) for (let v = -hv; v <= hv + 1; v += 50) {
          const q = cls(at(u, v));
          if (q === null) { unknown++; continue; }
          k++; if (CONCEAL.has(q)) cov++; if (firm(q)) room++;
        }
        const known = k > unknown;
        // entry: the 300 m between the axis and the area passable on one of three lines, else a road or track near it
        let entry: HaSite['entry'] = null;
        for (const u of [-hu / 2, 0, hu / 2]) {
          let ok = true, seen = 0;
          for (let t = 0; t <= 300; t += 30) { const q = cls({ x: p.x + dir.x * u + n.x * t, y: p.y + dir.y * u + n.y * t }); if (q === null) continue; seen++; if (!firm(q)) { ok = false; break; } }
          if (ok && seen) { entry = 'axis'; break; }
        }
        if (!entry) {
          for (let u = -hu - F.haEntry; u <= hu + F.haEntry && !entry; u += 60) for (let v = -hv - F.haEntry; v <= hv + F.haEntry; v += 60) { const q = cls(at(u, v)); if (q !== null && ROADS_IN.has(q)) { entry = 'road'; break; } }
        }
        const cover = k ? cov / k : null, rm = k ? room / k : null;
        const score = known ? 40 * Math.min(1, (cover ?? 0) / F.haCover) + 40 * Math.min(1, (rm ?? 0) / F.haRoom) + (entry ? 20 : 0) : -1;
        // the right side and no shift first: a later candidate must do strictly better
        if (!best || score > best.score + 1e-6) best = { role: `ha${i + 1}`, label: `HA ${i + 1}`, pts: [at(-hu, -hv), at(hu, -hv), at(hu, hv), at(-hu, hv)], side: side > 0 ? 'right' : 'left', shiftM: sh, cover, room: rm, entry, score, known };
      }
    }
    if (!best) return;
    const { score: _s, known: _k, ...site } = best;
    sites.push(site);
    areas[site.role] = { pts: site.pts, label: site.label };
  });
  if (!sites.length) return { areas, sites, row: null };
  const read = sites.filter((s) => s.cover !== null);
  if (!read.length) return { areas, sites, row: { name: 'Halting areas', st: 'unchecked', reason: `${sites.map((s) => s.label).join(', ')} laid ${fmtM(F.haShort)} short of the bounds: their ground is not loaded yet` } };
  const short = read.filter((s) => (s.cover ?? 0) < F.haCover || (s.room ?? 0) < F.haRoom || !s.entry);
  const pct = (v: number | null) => `${Math.round((v ?? 0) * 100)} %`;
  const parts = sites.map((s) => `${s.label} ${s.side} of the axis${s.shiftM ? `, ${fmtM(Math.abs(s.shiftM))} ${s.shiftM < 0 ? 'back' : 'forward'}` : ''}: ${s.cover === null ? 'not loaded' : `${pct(s.cover)} under trees or orchards, ${pct(s.room)} firm for tracks, entry ${s.entry === 'axis' ? 'from the axis' : s.entry === 'road' ? `by a road or track within ${fmtM(F.haEntry)}` : 'none found'}`}`);
  return {
    areas, sites,
    row: {
      name: 'Halting areas', st: short.length ? 'warn' : 'pass',
      reason: `${parts.join('; ')}. For the Main Body, about ${fmtM(F.haShort)} short of each bound (the troops halt there, IC s58 para 4 p 242), the best of the right and left of the axis and ${fmtM(F.haShift)} up or back (${F.haSize[0]} x ${F.haSize[1]} m): close to the axis, natural cover to conceal the force at once, easy entry and exit, all-round defence, room to disperse (IBB S35 para 11 a p 160); space, cover, concealment and protection from air and ground (OoW Vol II p 12); wanted ${pct(F.haCover)} under cover and ${pct(F.haRoom)} firm (E)`,
      ...(short.length ? { detail: { head: `${short.length} of ${sites.length} halting area${sites.length > 1 ? 's' : ''} short of a harbour's needs`, items: short.map((s) => `${s.label}: ${[(s.cover ?? 0) < F.haCover ? `${pct(s.cover)} under cover` : '', (s.room ?? 0) < F.haRoom ? `only ${pct(s.room)} firm` : '', !s.entry ? 'no entry found' : ''].filter(Boolean).join(', ')}`), why: 'A harbour wants natural cover so the force conceals itself at once with the least effort, easy entry and exit, and room to disperse (IBB p 160 para 11 a); without them the Main Body is seen and caught bunched (OoW Vol II p 12).', fix: ['Move it to the nearest wood or orchard beside the axis', 'Halt short of the report line where the axis passes cover', 'Without cover: dispersion, camouflage at once, AD deployed on arrival (IBB p 160 b (1) (a))'] } } : {}),
    },
  };
}

/**
 * Who leads a Bn Adv Gd's vanguard, read from the country (MIB p 82 para 22 f): the band `bn.flankClearM` either side of
 * the axis over the first 2 km ahead of the SP; trees, orchards, forest and built-up area over `bn.closeShare`'s larger
 * share is close country (dismounted infantry lead), over its smaller mixed (tanks lead, infantry close at hand), else
 * open (tanks lead, the infantry one bound behind); the NO-GO in the band named for the flank clearance.
 */
export function bnGroundRows(axis: AdvAxis, f: FitFrame, g: PlanGround, doc: DoctrineSet): Check[] {
  const F = advanceFigures(doc);
  const tracked = g.going('tracked');
  let n = 0, close = 0, nogo = 0;
  for (const q of walk(axis.path, 100)) {
    if (q.s < axis.spAt || q.s > axis.spAt + 2000) continue;
    const nr = { x: -q.dir.y, y: q.dir.x };
    for (let d = -F.bnClear; d <= F.bnClear + 1; d += 100) {
      const w = toWorld(f, { x: q.p.x + nr.x * d, y: q.p.y + nr.y * d });
      const c = g.cls(w.x, w.y);
      if (c === null) continue;
      n++; if (CLOSE.has(c)) close++; if (tracked.nogo.has(c)) nogo++;
    }
  }
  if (n < 20) return [{ name: 'Who leads', st: 'unchecked', reason: 'the ground ahead of the SP is not loaded yet' }];
  const share = close / n, ng = nogo / n;
  const country = share >= F.closeShare[1] ? 'close' : share >= F.closeShare[0] ? 'mixed' : 'open';
  const lead = country === 'close' ? 'close country: when contact is imminent dismounted infantry lead, the tanks behind them unless a calculated risk is taken (MIB p 82 para 22 f (1)); against emplaced AT weapons, in BUA and broken ground the infantry and engineers lead the assault too (MIB p 117)'
    : country === 'mixed' ? 'mixed country of copses and orchards: tanks lead with the infantry close at hand for the En who engages them at close range from cover; Tp / Pl groups (MIB p 82 f (2))'
      : 'open country: tanks lead, the infantry one bound behind (MIB p 82 f (3))';
  return [{ name: 'Who leads', st: 'pass', reason: `${Math.round(share * 100)} % of the band ${fmtM(F.bnClear)} either side of the axis over the first 2 km is trees, orchards or built-up area (mixed over ${Math.round(F.closeShare[0] * 100)} %, close over ${Math.round(F.closeShare[1] * 100)} %, E): ${lead}${ng > 0.05 ? `; ${Math.round(ng * 100)} % of the band NO-GO for tracks, cleared on foot` : ''}` }];
}

/**
 * The march along the axis by the Move Planner's road engine (MoveRoad.simulate): the Adv Gd's head at the SP at H, the
 * Main Body's head `mainBodyBackM` behind it, both moving at H (first light today at the SP, civil twilight: an advance
 * to contact by day, E), at the speeds for columns with tanks on good roads, the road density, the halts of the road
 * rules. March row: each serial's column length and time past a point, when its head reaches the SP, each bound and report line
 * and the C Tps' line, its halts; warns when the Adv Gd's column is longer than the gap to the Main Body's head (the
 * Main Body closes on it) or a serial runs on past last light.
 */
/**
 * What the books add to an advance: by night manageable distances, the covering troops and Adv Gd strengthened with
 * infantry and ATGM, the flank guards stronger, the artillery forward (OOW2 s5 pp 13-14; desert night distances reduced,
 * p 68); and the maintenance range: first line turns round within 48 km, second line within 64 km of the RP (lsf p 27,
 * Annex F p 72); beyond a day's turn-round an RP is set up forward (lsf pp 4-5).
 */
export function advanceBookRows(lines: { label: string; s: number }[], hAt: string, kind: 'bn' | 'div' | 'bde' | 'idiv' = 'bde'): Check[] {
  const rows: Check[] = [];
  const bnNight = kind === 'bn' ? '; at Bn level bounds and report lines at shorter intervals than by day, steadiness in probing rather than speed (IBB p 148 para 4 b (1), (2); IC s64 para 6 g (3), (4) p 281); a separate Adv Gd for each route (p 149 c (5)); the harbour, GPO and engineer recce parties well forward with the Adv Gd (p 149 c (4))' : '';
  if (hAt === 'last') rows.push({ name: 'By night', st: 'pass', reason: `a night advance: keep the distances manageable; strengthen the covering troops and the Adv Gd with infantry and ATGM, the flank guards too; the artillery relatively forward (OOW2 s5 pp 13-14); in the desert the night distances are reduced (OOW2 p 68)${bnNight}` });
  const far = lines.length ? Math.max(...lines.map((l) => l.s)) : 0;
  const beyond = far > 48000 ? ': beyond a day of turn-round the RP steps forward, set up near the leading Bde (lsf pp 4-5)' : '';
  if (far > 0) rows.push({ name: 'Maintenance', st: far <= 48000 ? 'pass' : 'warn', reason: `the last bound ${(far / 1000).toFixed(1)} km from the SP: first line turns round within 48 km and second line within 64 km of the RP (lsf p 27, Annex F p 72)${beyond}` });
  return rows;
}

export function advanceMarch(axis: AdvAxis, lines: { label: string; s: number }[], f: FitFrame, doc: DoctrineSet, march: AdvMarch, hAt: 'first' | 'last' | 'now' = 'first', nowMs: number = Date.now()): Check {
  const F = advanceFigures(doc), R = march.rules;
  const [vd, vn] = speedFor('good', true, R);
  const dens = densityFor('road', R);
  const ll = (p: XY): LngLat => { const w = toWorld(f, p); return mercToLngLat(w.x, w.y); };
  const spLL = ll(pointAt(axis.path, axis.spAt).p);
  const clock = clockFrom(todayIn());
  const light = new LightBook(clock, 'civil');
  // H: first light or last light today at the SP (civil twilight), or now
  const today = light.day(0, spLL[1], spLL[0]);
  const lit = hAt === 'last' ? today.last : today.first;
  const H = hAt === 'now' ? nowMs : Number.isFinite(lit) ? lit : atLocal(clock, 0, hAt === 'last' ? 1110 : 360);
  const dayAtH = light.isDay(H + 60000, spLL[1], spLL[0]);
  const total = lenOf(axis.path);
  let st: CheckState = 'pass';
  const notes: string[] = [];
  const parts = march.serials.map((s, i) => {
    const back = i === 0 ? 0 : F.body;
    const s0 = Math.max(0, axis.spAt - back);
    const pts = [...(axis.spAt - s0 > 1 ? [{ name: 'SP', s: axis.spAt - s0 }] : []), ...lines.map((l) => ({ name: l.label.replace(/ \(.*$/, ''), s: l.s - s0 })).filter((q) => q.s > 1)];
    const ser: MvSerialIn = {
      id: `adv${i}`, name: s.name, vehicles: s.vehicles, speedDay: vd, speedNi: vn, densDay: dens.day, densNi: dens.night,
      path: mkPath(from(axis.path, s0).map(ll)), startMs: H, window: { kind: 'both' },
      halts: { mode: 'running', runMin: R.shortRunMin, haltMin: R.shortHaltMin, longEvery: R.longEvery, longMin: R.longHaltMin, clockFirstAtMin: R.clockFirstAtMin, clockEveryMin: R.clockEveryMin },
      densityHalt: false, points: pts,
    };
    const run = simulate(ser, light, R);
    const at = (q: number) => hPlus((dueAt(run, q) - H) / 60000);
    const halts = run.stops.filter((x) => x.kind === 'SH' || x.kind === 'LH');
    if (run.segs.some((g) => g.mode === 'move' && g.day !== dayAtH)) { st = 'warn'; notes.push(`${s.name} runs on past ${dayAtH ? 'last' : 'first'} light`); }
    if (i === 0 && run.lenDayM > F.body) { st = 'warn'; notes.push(`the Adv Gd as one road column (${km(run.lenDayM)} at the road density) is longer than the ${km(F.body)} to the Main Body's head: the Main Body closes on it (hold it back, move by bounds, or the Adv Gd deployed off the road, which takes less depth)`); }
    return `${s.name}: ${s.vehicles} vehicles (${s.known}), ${km(run.lenDayM)} long by day, ${run.tppDay} min past a point; its head ${pts.map((q) => `at ${q.name} ${at(q.s)}`).join(', ')}${pts.length ? ', ' : ''}at the C Tps' line ${at(run.lengthM)}, its tail clear of it ${hPlus((clearAt(run, run.lengthM) - H) / 60000)}${halts.length ? `; ${halts.length} halt${halts.length > 1 ? 's' : ''} (${halts.map((x) => x.kind).join(', ')})` : ''}`;
  });
  return {
    name: 'March', st,
    reason: `H: the Adv Gd's head at the SP ${hAt === 'now' ? 'now (as set)' : hAt === 'last' ? 'at last light today there (civil twilight, as set: a night advance)' : 'at first light today there (civil twilight: an advance by day, the default)'}; the Main Body's head ${km(F.body)} back, both moving at H; ${vd} km/h by day, ${vn} by night (columns with tanks on good roads), ${dens.day} vehicles a km by day, ${dens.night} by night, halts ${R.shortHaltMin} min after each ${R.shortRunMin} min running (MoveDoctrine road, R); the axis ${km(total)}. ${parts.join('. ')}${notes.length ? `. ${notes.join('; ')}` : ''}. ${march.src}. The road state and a march table to the ground's roads: the Move Planner`,
  };
}

/** An advance fitted where it rests (PlanFit.fitLayout hands it over): the click is the SP, the aim the axis. */
/**
 * The advance in the desert (DW s11 pp 35-37, s15 para 4 p 55): on a very wide front, by combat groups, on multiple axes
 * to exploit weak points and disperse the En reactions, the force able to concentrate; armour in the mobile troops and
 * advance guards outflanking opposition, the infantry clearing it after; flank protection and AD; by night cross-country
 * on unexpected routes, best against a weakly held posn. A Bde on one axis warns (p 55: a very wide front); a Div on
 * two axes and a Bn on its Bde's axis carry it as a note.
 */
export function desertAdvanceRow(kind: 'bn' | 'div' | 'bde'): Check {
  const rules = 'armour in the mobile troops and advance guards outflanks the opposition, the infantry clears it after (DW p 55 para 4 b); flank guards and AD secure the manoeuvre (p 35 para 1 e); by night cross-country on unexpected routes, best against a weakly held posn (p 37 para 8); camel-borne or long-range patrols on the going astride the axes (p 36 para 3)';
  if (kind === 'bde') return {
    name: 'Desert', st: 'warn',
    reason: `one axis: in the desert the advance goes on a very wide front, by combat groups, on multiple axes to exploit the En weak points and disperse the En reactions (DW s11 paras 1 a, 2 p 35; s15 para 4 p 55); ${rules}`,
    detail: { head: 'One axis in the desert', why: 'Vast spaces, the air threat, lack of cover and of obstacles dictate an advance on a very wide front based on combat groups, contacting the En on a wide front to exploit flanks and weak spots (DW s15 para 4 p 55).', fix: ['Advance two Regt groups up on two axes (OoW Vol II pp 52-53), within supporting distance', 'Or the Armd Div two Bdes up (Div Advance)'] },
  };
  return { name: 'Desert', st: 'pass', reason: `${kind === 'div' ? 'two Bdes on two axes: the very wide front and multiple axes of the desert (DW pp 35, 55)' : 'the Bn on its Bde\'s axis, the formation on a very wide front by combat groups (DW pp 35, 55)'}; ${rules}` };
}

/** The ground for an advance: as set in the tab, else read where it rests (PlanFit.detectTerrain); null unknown. The card's Ground row shows it. */
export function advanceGroundSpec(inp: FitLayoutInput, frame: FitFrame, res: ReturnType<typeof solveRecipe>): TerrainSpec | null {
  if (inp.terrain && inp.terrain !== 'auto') return { kind: inp.terrain, source: 'user' };
  return detectTerrain(inp.ground, frame, res, inp.recipe, inp.ctx.doc);
}

export function fitAdvance(inp: FitLayoutInput): FittedLayout | null {
  const { recipe, ctx, ground } = inp;
  const base = solveRecipe(recipe, ctx, inp.opts);
  const pivot = base.items.find((i) => i.id === base.pivotId);
  if (!pivot) return null;
  const frame: FitFrame = { anchor: inp.anchor, bearing: inp.bearing, k: kOf(inp.anchor.y), pivot: pivot.pts[0] };
  inp.begin?.();
  const kind = advanceKind(base.items);
  if (kind === 'div') {
    const fd = fitDivAdvance(inp, base, frame);
    if (fd) fd.terrain = advanceGroundSpec(inp, frame, base);
    if (fd && fd.terrain?.kind === 'desert') {
      const dr = desertAdvanceRow('div');
      fd.res.rows.push(dr);
      if (fd.fit.rows !== fd.res.rows) fd.fit.rows.push(dr);
    }
    return fd;
  }
  const hAt = recipe.advance?.hAt ?? 'first';
  // a Bn Adv Gd: the axis from its main guard through the SP to 6 km ahead (it has no C Tps of its own)
  // an Inf Div: from the leading Bde's harbour area through the SP to its mobile troops
  const axis = routeAxis(base.items, frame, ground, kind === 'bn' ? { rear: 'mainGd', aheadM: 6000 } : kind === 'idiv' ? { rear: 'har1' } : {});
  const gr = advanceGroundRows(base.items, frame, ground, ctx.doc, axis, null, recipe.advance?.rlApartM ?? null, hAt === 'last');
  // the axis arrow along the route, a little past the C Tps; the bounds on the water, the report lines on the lateral roads and railways
  const p = axis.path, a = p[p.length - 2], b = p[p.length - 1], L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  // simplified within 25 m, so the arrow as drawn reads as the route did; its head 300 m past the C Tps
  const arrow = simplify([...p, { x: b.x + ((b.x - a.x) / L) * 300, y: b.y + ((b.y - a.y) / L) * 300 }], 25);
  // the Main Body's halting areas short of the bounds, sited on the ground (IBB p 160; OoW Vol II p 12); the march
  // timed along the axis (Recipe.march, the ORBAT's)
  // (an Inf Div's harbour areas are the Div's own, laid by the recipe: GSP Annex H p 203)
  const ha = kind === 'idiv' ? { areas: {}, sites: [], row: null } : siteHaltingAreas(axis, gr.lines, frame, ground, ctx.doc);
  const raw = solveRecipe(recipe, ctx, { ...inp.opts, paths: { ...(inp.opts.paths ?? {}), axis: arrow }, geom: { ...(inp.opts.geom ?? {}), ...gr.rls, ...ha.areas } });
  // the march from the ORBAT is the IABG's; an Inf Div's is the Move Planner's
  const marchRow = recipe.march && kind !== 'idiv' && !axis.pending ? advanceMarch(axis, [...gr.lines, ...gr.rlLines].sort((a, b) => a.s - b.s), frame, ctx.doc, recipe.march, hAt) : null;
  const gs = advanceGroundSpec(inp, frame, raw), gk = gs?.kind ?? null;
  const rows = [...(kind === 'idiv' ? infDivAdvanceRows(raw.items, ctx.doc, gk) : advanceRows(raw.items, ctx.doc, hAt)), ...gr.rows, ...(kind === 'bn' ? bnGroundRows(axis, frame, ground, ctx.doc) : []), ...(ha.row ? [ha.row] : []), ...(marchRow ? [marchRow] : []), ...advanceBookRows(gr.lines, hAt, kind)];
  if (kind !== 'idiv' && gk === 'desert') rows.push(desertAdvanceRow(kind));
  const fails = rows.filter((r) => r.st === 'fail').length, warns = rows.filter((r) => r.st === 'warn').length;
  const fit: FitResult = {
    nudges: {}, slides: [], killingGr: null, slots: {}, rows, approaches: [],
    score: Math.max(0, 100 - 25 * fails - 8 * warns), fails, warns,
    pending: axis.pending || ground.pending(), data: ground.dataLine(), from: null, fromAssumed: true,
  };
  const res = { ...raw, mode: 'terrain' as const, rows, slots: [], assumptions: [`Fitted to the ground: ${fit.data}.`, axis.routed ? 'The axis is the least-cost way for tracks over the bundle\'s going, not a road route (the Move Planner\'s).' : 'The axis is straight from the SP: no way for tracks was found in the bundle\'s grid.', kind === 'idiv' ? 'Annex H\'s figures are read from the scanned diagram (GSP 1947 p 203).' : 'Fig 2\'s figures are read from the page text under the scan\'s highlights.'] };
  return { recipe, res, raw, fit, frame, anchor: inp.anchor, bearing: inp.bearing, manual: {}, terrain: gs, enemy: null, unit: null };
}

/** A Div's two axes (axisL, axisR) from their tails to their heads: routed for tracks over the bundle's going, or as drawn. */
function divAxes(items: { role: string; pts: XY[] }[], f: FitFrame, g: PlanGround, asDrawn = false): { role: 'axisL' | 'axisR'; name: string; axis: AdvAxis }[] {
  const out: { role: 'axisL' | 'axisR'; name: string; axis: AdvAxis }[] = [];
  const spI = items.find((i) => i.role === 'sp' && i.pts.length);
  const sp = spI ? centre(spI.pts) : { x: 0, y: 0 };
  for (const [role, name] of [['axisL', 'Lt axis'], ['axisR', 'Rt axis']] as const) {
    const it = items.find((i) => i.role === role && i.pts.length >= 2);
    if (!it) continue;
    // from the tail (behind) to the head (ahead), whichever way the points run
    const pts0 = it.pts[0].y <= it.pts[it.pts.length - 1].y ? it.pts : [...it.pts].reverse();
    let pts = pts0, routed = asDrawn, pending = false;
    if (!asDrawn && g.avenues) {
      const t = pts0[0], h = pts0[pts0.length - 1];
      const r = g.avenues(toWorld(f, t), toWorld(f, h), 400, 'tracked');
      if (r === null) pending = g.pending();
      else if (r[0]?.path && r[0].path.length >= 2) {
        const loc = r[0].path.map((w) => toLocal(f, w));
        if (Math.hypot(loc[0].x - t.x, loc[0].y - t.y) > Math.hypot(loc[loc.length - 1].x - t.x, loc[loc.length - 1].y - t.y)) loc.reverse();
        pts = [t, ...loc.slice(1, -1), h]; routed = true;
      }
    }
    out.push({ role, name, axis: { path: pts, spAt: project(pts, { x: xAtY(pts, sp.y), y: sp.y }).s, routed, pending, drawn: asDrawn } });
  }
  return out;
}

/** The rows of a Div's axes: the going and the water crossed on each (as "Going on the Lt axis" ...). */
function divAxisRows(axes: ReturnType<typeof divAxes>, f: FitFrame, g: PlanGround, F: ReturnType<typeof advanceFigures>): Check[] {
  const rows: Check[] = [];
  for (const a of axes) {
    const R = readAxis(a.axis, f, g);
    if (R.n < R.steps / 2) rows.push({ name: `Going on the ${a.name}`, st: 'unchecked', reason: a.axis.pending ? 'the ground along it is still loading' : 'the ground along it is not loaded yet' });
    else rows.push(...axisReadRows(R, a.axis, g, F, a.name));
  }
  return rows;
}

/**
 * An Armd Div on two axes fitted where it rests (recipe div-advance-two-bde): each Bde's axis routed for tracks from its
 * tail to its head and read for its going and water crossings; the bounds, report lines, halting areas and march are each
 * Bde's own, built with the Armd Bde advance on its axis.
 */
function fitDivAdvance(inp: FitLayoutInput, base: ReturnType<typeof solveRecipe>, frame: FitFrame): FittedLayout {
  const { recipe, ctx, ground } = inp;
  const F = advanceFigures(ctx.doc);
  const axes = divAxes(base.items, frame, ground);
  const paths: Record<string, XY[]> = {};
  for (const a of axes) paths[a.role] = simplify(a.axis.path, 25);
  const raw = solveRecipe(recipe, ctx, { ...inp.opts, paths: { ...(inp.opts.paths ?? {}), ...paths } });
  const rows = [...divAdvanceRows(raw.items, ctx.doc), ...divAxisRows(axes, frame, ground, F),
    { name: 'Bounds', st: 'unchecked' as const, reason: 'each Bde\'s own bounds (on the water: IC s58 para 4 p 242) and report lines (on lateral roads and railways: para 6 p 243) on its axis, with its halting areas and march: build the Armd Bde Advance to Contact on each axis (bounds and report lines are control measures of the advance: OoW Vol II s4 para 8 p 11)' },
    ...advanceBookRows([], recipe.advance?.hAt ?? 'first', 'div')];
  const fails = rows.filter((r) => r.st === 'fail').length, warns = rows.filter((r) => r.st === 'warn').length;
  const pending = axes.some((a) => a.axis.pending) || ground.pending();
  const fit: FitResult = { nudges: {}, slides: [], killingGr: null, slots: {}, rows, approaches: [], score: Math.max(0, 100 - 25 * fails - 8 * warns), fails, warns, pending, data: ground.dataLine(), from: null, fromAssumed: true };
  const res = { ...raw, mode: 'terrain' as const, rows, slots: [], assumptions: [`Fitted to the ground: ${fit.data}.`, axes.every((a) => a.axis.routed) ? 'Each axis is the least-cost way for tracks over the bundle\'s going, not a road route (the Move Planner\'s).' : 'An axis is straight where no way for tracks was found in the bundle\'s grid.', 'The two axes\' spacing has no printed figure: it is a decision (E).'] };
  return { recipe, res, raw, fit, frame, anchor: inp.anchor, bearing: inp.bearing, manual: {}, terrain: null, enemy: null, unit: null };
}

/** Check my plan for an advance built here: the drawn symbols, the axis as drawn (else from the SP toward the C Tps). */
export function checkAdvance(inp: FitLayoutInput, drawn: AdvDrawn): { rows: Check[]; confirm: string[]; pending: boolean; read: string[]; missing: string[] } | null {
  const { recipe, ctx, ground } = inp;
  const base = solveRecipe(recipe, ctx, inp.opts);
  const pivot = base.items.find((i) => i.id === base.pivotId);
  const sp = drawn.sp?.pts[0], ct = drawn.ctps?.pts[0], van = drawn.vanGd?.pts[0];
  if (!pivot || !sp) return null;
  const kind = advanceKind(base.items);
  const names = (r: string) => recipe.slots.find((s) => s.role === r)?.label || r;
  if (kind === 'div') {
    // the direction of advance: from the SP toward the covering troops' mid point, else as given
    const cs = (['ctpsL', 'ctpsR'] as const).map((r) => drawn[r]?.pts[0]).filter((q): q is MercXY => !!q);
    const mid = cs.length ? [cs.reduce((s, q) => s + q[0], 0) / cs.length, cs.reduce((s, q) => s + q[1], 0) / cs.length] : null;
    const brg = mid ? Math.atan2(mid[0] - sp[0], mid[1] - sp[1]) : inp.bearing;
    const fr: FitFrame = { anchor: { x: sp[0], y: sp[1] }, bearing: brg, k: kOf(sp[1]), pivot: pivot.pts[0] };
    inp.begin?.();
    const items: PlanItem[] = base.items.filter((it) => drawn[it.role]).map((it) => ({ ...it, pts: drawn[it.role].pts.map((q) => toLocal(fr, { x: q[0], y: q[1] })) }));
    const rows = [...divAdvanceRows(items, ctx.doc), ...divAxisRows(divAxes(items, fr, ground, true), fr, ground, advanceFigures(ctx.doc))];
    const need = ['sp', 'axisL', 'axisR', 'ctpsL', 'ctpsR', 'flankL', 'flankR'];
    return { rows, confirm: ['Each Bde\'s bounds, report lines, halting areas and march on its axis', 'The Follow-in-Zone infantry for the positions the armour bypasses (OoW Vol II p 53)'], pending: ground.pending(), read: Object.keys(drawn).map(names), missing: need.filter((r) => !drawn[r]).map(names) };
  }
  // the direction of advance: from the SP toward the covering troops, else from the Van Gd to the SP
  const bearing = ct ? Math.atan2(ct[0] - sp[0], ct[1] - sp[1]) : van ? Math.atan2(sp[0] - van[0], sp[1] - van[1]) : inp.bearing;
  const frame: FitFrame = { anchor: { x: sp[0], y: sp[1] }, bearing, k: kOf(sp[1]), pivot: pivot.pts[0] };
  inp.begin?.();
  const loc = (q: MercXY) => toLocal(frame, { x: q[0], y: q[1] });
  const items: PlanItem[] = base.items.filter((it) => drawn[it.role]).map((it) => ({ ...it, pts: drawn[it.role].pts.map(loc) }));
  // the axis as drawn: its points from the tail (the Main Body's end) toward the head, through the point nearest the SP
  let axis: AdvAxis | null = null;
  const ap = drawn.axis?.pts.map(loc);
  const head = items.find((i) => i.role === 'sp')!.pts[0];
  if (ap && ap.length >= 2) {
    let pts = ap[0].y > ap[ap.length - 1].y ? [...ap].reverse() : ap;
    // read up to the covering troops, not past the arrow's head
    const ctp = items.find((i) => i.role === 'ctps');
    if (ctp) { const q = project(pts, centre(ctp.pts)); pts = [...pts.slice(0, q.i + 1), q.q]; }
    axis = { path: pts, spAt: project(pts, head).s, routed: true, pending: false, drawn: true };
  }
  // each drawn bound and report line where it meets the axis, measured along it
  const rlDrawn: DrawnLine[] = Object.keys(drawn).filter((r) => /^(bd|rl)\d$/.test(r)).map((r) => {
    const c = centre(drawn[r].pts.map(loc)), kind = r.slice(0, 2) as 'bd' | 'rl';
    return { label: `${kind === 'bd' ? 'Bd' : 'RL'} ${r.slice(2)}`, s: axis ? project(axis.path, c).s : c.y - head.y, kind };
  });
  const hAt = recipe.advance?.hAt ?? 'first';
  const gr = advanceGroundRows(items, frame, ground, ctx.doc, axis, rlDrawn.length ? rlDrawn : null, recipe.advance?.rlApartM ?? null, hAt === 'last');
  // a Bn Adv Gd: who leads read along the axis as drawn, else from its main guard through the SP to 6 km ahead
  const bnAxis = kind === 'bn' ? axis ?? (() => { const mg = items.find((i) => i.role === 'mainGd')?.pts[0] ?? { x: head.x, y: head.y - 1500 }; return { path: [mg, head, { x: head.x, y: head.y + 6000 }], spAt: Math.hypot(head.x - mg.x, head.y - mg.y), routed: false, pending: false }; })() : null;
  const rows = [...advanceRows(items, ctx.doc, hAt), ...gr.rows, ...(bnAxis ? bnGroundRows(bnAxis, frame, ground, ctx.doc) : [])];
  const need = kind === 'bn' ? ['sp', 'vanGd', 'vanTk', 'bnHq', 'mor', 'mainGd'] : kind === 'idiv' ? ['sp', 'ctps', 'ldgPl', 'vanGd', 'arty', 'mainGd', 'har1', 'divTac', 'har2', 'daa', 'flankL', 'flankR'] : ['sp', 'ctps', 'vanGd', 'mainGd', 'mainBody', 'flankL', 'flankR'];
  return { rows, confirm: kind === 'idiv' ? ['The march on the roads (the march table, the roads\' and bridges\' classes): the Move Planner', 'The harbour areas reconnoitred and allotted by the Div staff, the traffic control plan with the provost reinforced (GSP s18 paras 12-13 p 80)', 'Who leads: tanks when the terrain favours, no A tk obstacles are known and the En has armour, the tanks between the range of the direct-firing weapons and the range of comms from the leading Pl (GSP Annex H p 203)'] : ['The march on the roads (the march table, the roads\' and bridges\' classes): the Move Planner', 'Halting areas along the axis'], pending: ground.pending(), read: Object.keys(drawn).map(names), missing: need.filter((r) => !drawn[r]).map(names) };
}


/** Recipe roles of an advance, for the tab. */
export const isAdvance = (r: Recipe | undefined | null) => r?.task === 'advance';
