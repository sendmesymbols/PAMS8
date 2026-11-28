/**
 * AprcBooks.ts
 *
 * Figures and heads for the Aprc from the doctrine books the user gave on 24 Nov 2026 (Doctrine_Review.md, the
 * GroundAppreciation rows R69-R93), each with its book and printed page. Pure: no DOM, no map, no bundle.
 *
 *   GUN_DEPL / gunUnitFor     gun deployment times, excluding travel (IBB p 122 para 5; p 154 at ni without daylight recce)
 *   QUICK_ATTK                contact to H of a quick attk (MIB pp 89, 96-97, Annex L pp 347-348; IBB p 133)
 *   MW_SLANT / slantFactor    the uphill assault in mountains: slant and climb (MW Annex F pp 311-313)
 *   mtnAssault
 *   MW_LIFT / liftDraft       mules and porters (MW pp 142, 145-146; Annex H / J pp 322-325, 330-331)
 *   LSF_CAS / casGroupsOf     casualties a day from the ORBAT strength (lsf pp 47-51, Annex K p 80, Annex L pp 81-82)
 *   casEstimate
 *   readHeads                 heads a Read adds where they apply: the dismounting area (a mounted unit), mules and porters
 *                             (mountains), the cas estimate (the ORBAT read)
 *
 * Doctrine as written: where a book prints no figure the text says so; where two books differ both are kept with pages.
 */

import { find, para, type AprcBasis, type AprcDoc, type AprcKind, type AprcPara, type AprcPatch, type AprcSrc } from './AprcModel';

const rule = (text: string): AprcBasis => ({ kind: 'rule', text });
const data = (text: string): AprcBasis => ({ kind: 'data', text });
const calc = (text: string): AprcBasis => ({ kind: 'calc', text });
const n0 = (x: number): string => Math.round(x).toLocaleString('en-GB');

// ── guns (R69) ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Deployment timings excluding the travelling time, minutes (IBB p 122 para 5). */
export const GUN_DEPL = {
  fd: { Bty: { day: 20, ni: 40 }, Regt: { day: 45, ni: 90 } },
  med: { Bty: { day: 30, ni: 60 }, Regt: { day: 60, ni: 120 } },
  /** "twenty minutes per successive registration plus twenty minutes for other preparations and reserve" (para 5 a). */
  regEachMin: 20,
  regPlusMin: 20,
  /** At ni, survey carried fwd without prior daylight recce, preparations off the map: hours (IBB p 154 para i (3)). */
  niNoRecceH: { Bty: [2, 2], Regt: [4, 5], 'Div Arty': [12, 14] } as Record<string, [number, number]>,
  /** Div Arty survey done at ni checked by day: at least 3 h (IBB p 154 para i (4)). */
  svyCheckH: 3,
};

/** The words for the basis and the Time Req: every figure with its page. */
export const GUN_DEPL_TEXT =
  'Excluding travel: a fd Bty 20 min by day and 40 by ni, a fd Regt 45 / 90 min, a med Bty 30 min / 1 h, a med Regt 1 / 2 h; registration 20 min each plus 20 min (IBB p 122 para 5). At ni without daylight recce: a Bty 2 h, a Regt 4-5 h, Div Arty 12-14 h, its ni survey checked by day in 3 h or more (IBB p 154)';

/** The DS guns of an echelon: a Coy's and a Bn's fire plan is the DS fd Bty's (IBB p 170; Mechs of Aprc (Attk) p 13), a Bde's the DS fd Regt's. */
export const gunUnitFor = (echelon: string): 'Bty' | 'Regt' | null => (echelon === 'Bde' ? 'Regt' : echelon === 'Bn' || echelon === 'Coy' ? 'Bty' : null);

// ── the quick attk (R70, R82) ────────────────────────────────────────────────────────────────────────────────────────

/** Contact to H of a quick attk, minutes. */
export const QUICK_ATTK = {
  /** "As a guide the following timings from contact to H hour should be possible" (MIB p 89 para 31 c; the same, pp 96-97 para 4 a). */
  mib: { Coy: [30, 60], Bn: [60, 100] } as Record<string, [number, number]>,
  /** "a company may take maximum from 30-45 minutes and a battalion from 1-2 hours" in an encounter battle (IBB p 133 para 2 j). */
  ibb: { Coy: [30, 45], Bn: [60, 120] } as Record<string, [number, number]>,
  /** The Bn quick attk drill (MIB Annex L pp 347-348), minutes before H: begin recce, finish recce, orders, end orders, in the FUP. */
  drill: { recce: 100, recceEnd: 60, orders: 50, ordersEnd: 35, fup: 10 },
  /** Taken: a Coy 45 min (inside MIB's 30-60 and IBB's at most 30-45), a Bn 100 min (MIB Annex L; inside IBB's 1-2 h). No Bde figure is printed. */
  taken: { Coy: 45, Bn: 100 } as Record<string, number>,
};

export const QUICK_TEXT =
  'Contact to H of a quick attk: a Coy gp 30-60 min, a Bn gp 60-100 min (MIB p 89; pp 96-97); in an encounter a Coy at most 30-45 min, a Bn 1-2 h (IBB p 133); the Bn drill: recce from H-100 to H-60, orders H-50 to H-35, in the FUP by H-10 (MIB Annex L pp 347-348)';

// ── the uphill assault in mountains (R85) ────────────────────────────────────────────────────────────────────────────

/**
 * The slant range of 100 m of horizontal distance by the angle of slope (MW Annex F p 313, its factor table; the
 * 65 degree row as its slant column prints it, 237 m).
 */
export const MW_SLANT: Array<[number, number]> = [[30, 1.16], [35, 1.22], [40, 1.31], [45, 1.41], [50, 1.56], [55, 1.74], [60, 2.0], [65, 2.37], [70, 2.93]];
/** "Add extra time for the uphill climb at the rate of one hour for every 350 metres" (MW Annex F p 313). */
export const MW_CLIMB_M_PER_H = 350;

/**
 * The slant factor for an angle of slope: the table's row at or next above the angle (the longer slant, so the covering
 * fire is not short); below 30 degrees the table prints no factor (the horizontal distance), above 70 its last row.
 */
export function slantFactor(deg: number): { factor: number; row: number | null; note: string } {
  if (!(deg >= MW_SLANT[0][0])) return { factor: 1, row: null, note: `${Math.round(deg)} degrees: below the table's 30 degrees, no factor printed (the map distance)` };
  const r = MW_SLANT.find(([d]) => d >= deg - 1e-9) ?? MW_SLANT[MW_SLANT.length - 1];
  const beyond = deg > MW_SLANT[MW_SLANT.length - 1][0];
  return { factor: r[1], row: r[0], note: `${Math.round(deg)} degrees: ${beyond ? 'beyond the table, its last row' : r[0] === Math.round(deg) ? 'the' : 'the next'} row ${r[0]} degrees, ${r[1].toFixed(2)}` };
}

/**
 * The FUP / SL to the obj uphill (MW Annex F pp 311-313): the time on the map distance times the slant factor of the
 * angle (the climb over the map distance), plus 1 h for every 350 m of climb. `horizM` null: the angle is not known,
 * only the climb's time is added.
 */
export function mtnAssault(o: { horizM: number | null; climbM: number; baseMin: number }): { min: number; factor: number; deg: number | null; addMin: number; text: string; basis: AprcBasis[] } {
  const deg = o.horizM && o.horizM > 0 ? (Math.atan(o.climbM / o.horizM) * 180) / Math.PI : null;
  const sf = deg !== null ? slantFactor(deg) : { factor: 1, row: null, note: 'the angle not known (no map distance)' };
  const addMin = Math.round((60 * o.climbM) / MW_CLIMB_M_PER_H);
  const min = Math.round(o.baseMin * sf.factor) + addMin;
  const text = `${o.climbM} m of climb${o.horizM ? ` over ${(o.horizM / 1000).toFixed(1)} km` : ''}: ${sf.note}; ${addMin} min for the climb`;
  return {
    min, factor: sf.factor, deg, addMin, text,
    basis: [rule('Uphill: the slant range = the map distance x the factor of the angle of slope (30 degrees 1.16, 45 degrees 1.41, 60 degrees 2.00, 70 degrees 2.93), and extra time for the climb at one hour for every 350 m (MW Annex F pp 311-313); the safe distances unchanged (p 311)'), calc(`The assault's time on the map distance x ${sf.factor.toFixed(2)}, plus ${addMin} min (${text})`)],
  };
}

// ── mules and porters (R86, R88) ─────────────────────────────────────────────────────────────────────────────────────

/** Mountain lift (MW). */
export const MW_LIFT = {
  /** Build-up for an attk and maint after capture, a Bn: vehs / mules / porters (MW p 145 para 11; its rows below). */
  bn: { veh: 16, mules: 582, porters: 1164 },
  bnRows: [['1st line reserve (amn)', 4, 154, 308], ['2nd line (amn)', 4, 154, 308], ['5 days GS reserve (amn)', 4, 154, 308], ["a day's rations", 1, 23, 46], ["3 days' reserve rations", 2, 67, 134], ['daily maint', 1, 30, 60]] as Array<[string, number, number, number]>,
  /** "A brigade (three battalions) would thus require 1746 mules or 3492 porters and a division ... 5238 mules or 10476 porters" (MW p 146 para 12). */
  bde: { mules: 1746, porters: 3492 },
  div: { mules: 5238, porters: 10476 },
  /** A Bn's F ech stores, approximately (MW p 142 para 4). */
  fEchBn: { mules: 364, porters: 728 },
  /** Pri 1, a rifle Coy's F ech stores: App 2 to Annex H p 324 (mules), App 1 to Annex J p 330 (porters). */
  pri1Coy: { mules: 24, porters: 62 },
  /** Pri 2, a Bn's F ech stores: App 3 to Annex H p 325 (mules), App 2 to Annex J p 331 (porters). */
  pri2Bn: { mules: 69, porters: 180 },
  /** Emergency pack rations till link up: "a delay of 48-72 hours" (MW p 145 para 10). */
  packH: [48, 72],
  /**
   * A Bn in def ops: 158 mules a week for rations, 123 mules a lift of amn replenishment (MW Annex H App pp 322-323). The
   * amn table prints 123 as its total, but its rows add to 101: the book differs with itself, and its printed total is kept.
   */
  defRationsWk: 158,
  defAmnLift: 123,
  defAmnRowsSum: 101,
};

/** Mules and Porters under Adm and Log in mountains: the book's figures for the echelon read. */
export function liftDraft(kind: AprcKind, echelon: string): AprcPatch {
  const L = MW_LIFT;
  const by = 'All movs in the hrs of darkness';
  let draft: string;
  const basis: AprcBasis[] = [];
  if (kind === 'attk') {
    const fEch = `F ech stores: pri 1 the rifle Coys' (${L.pri1Coy.mules} mules or ${L.pri1Coy.porters} porters a Coy), carried at once after the attk; pri 2 the rest (${L.pri2Bn.mules} mules or ${L.pri2Bn.porters} porters a Bn)`;
    if (echelon === 'Coy') draft = `${fEch}. Emergency pack rations till link up, up to ${L.packH[0]}-${L.packH[1]} h. ${by}.`;
    else {
      const head = echelon === 'Bde' ? `Build-up and maint after capture: ${n0(L.bde.mules)} mules or ${n0(L.bde.porters)} porters for the Bde (a Bn ${L.bn.veh} vehs, ${L.bn.mules} mules or ${n0(L.bn.porters)} porters)` : `Build-up and maint after capture: ${L.bn.veh} vehs, ${L.bn.mules} mules or ${n0(L.bn.porters)} porters (${L.bnRows.map(([w, , m]) => `${w} ${m}`).join(', ')} mules)`;
      draft = `${head}. A Bn's F ech stores about ${L.fEchBn.mules} mules or ${L.fEchBn.porters} porters: ${fEch.replace(/^F ech stores: /, '')}. Emergency pack rations till link up, up to ${L.packH[0]}-${L.packH[1]} h. ${by}.`;
    }
    basis.push(
      rule(`A Bn's build-up and maint: ${L.bn.veh} vehs, ${L.bn.mules} mules or ${L.bn.porters} porters (MW p 145 para 11); a Bde ${L.bde.mules} / ${L.bde.porters}, a Div ${L.div.mules} / ${L.div.porters}, all movs in the hrs of darkness (MW p 146 para 12)`),
      rule(`A Bn's F ech stores approximately ${L.fEchBn.mules} mules or ${L.fEchBn.porters} porters, pri 1 the rifle Coys' (MW p 142 para 4); load tables: pri 1 a Coy ${L.pri1Coy.mules} mules (p 324) or ${L.pri1Coy.porters} porters (p 330), pri 2 a Bn ${L.pri2Bn.mules} mules (p 325) or ${L.pri2Bn.porters} porters (p 331)`),
      rule('Emergency pack rations till link up, a delay of 48-72 h (MW p 145 para 10)'),
    );
  } else {
    draft = `Maint in def: ${L.defRationsWk} mules a week for rations and ${L.defAmnLift} mules a lift of amn replenishment, a Bn's${echelon === 'Bn' ? '' : `; a ${echelon}'s not printed${echelon === 'Bde' ? ` (three Bns: ${3 * L.defRationsWk} and ${3 * L.defAmnLift}, by sum)` : ''}`}. ${by}.`;
    basis.push(rule(`Inf Bn in def ops: rations ${L.defRationsWk} mules a week, amn ${L.defAmnLift} mules a lift of replenishment (MW Annex H App pp 322-323); the amn table's rows add to ${L.defAmnRowsSum}, its printed total ${L.defAmnLift} is kept (the book differs with itself)`), rule('Movs in the hrs of darkness (MW p 146)'));
    if (echelon === 'Bde') basis.push(calc("A Bde's taken as three Bns', a sum; no Bde figure printed"));
  }
  return { id: 'plan.adm.lift', draft, state: 'judge', basis, src: 'gr' };
}

// ── the five books re-read for the Aprc (Aprc_Review.md, 28 Nov 2026) ───────────────────────────────────────────────
// GSP-1947 Inf Div in Battle ("GSP-1947"), IBB, OoW Vol I / II, Mountain Warfare (MW), Desert Warfare (DW); printed pages,
// each checked in the PDF.

/** The ground as the books take it: mountains and desert have books of their own; the rest is the plains'. */
export type AprcGroundKind = 'plains' | 'desert' | 'mountains';
export const groundKind = (country: string | null | undefined): AprcGroundKind => (country === 'Mountains' ? 'mountains' : country === 'Desert' ? 'desert' : 'plains');

/** A Bn's frontage in def (IBB). */
export const BN_FRONT = {
  /** "in the plains of Punjab a battalion will normally occupy a frontage of 3000-5000 metres"; depth "upto 2000-3000 metres" (IBB S53 para 4 c pp 276-277). */
  normalM: [3000, 5000] as [number, number],
  normalDepthM: [2000, 3000] as [number, number],
  /** Extended frontages (IBB Annex U App 6 p 481): two Coys up 4,500 m and 3-4 km deep, three up 6,500 m and 2.5-3 km deep. */
  extTwoM: 4500,
  extThreeM: 6500,
  extDepthTwoM: [3000, 4000] as [number, number],
  extDepthThreeM: [2500, 3000] as [number, number],
  /** Along a canal or A tk ditch, three Coys up "upto 4115 metres (4500 yards)" (IBB S61 p 333; Annex V p 483, 2750-4115 m). */
  obstacleM: [2750, 4115] as [number, number],
  /** A ditch "24 metres (80 feet)" wide is an eff A tk obs (IBB S60 p 331): the water line the def is laid along. */
  obstacleMinWidthM: 24,
};

/** A Bde in def: 10-12 km wide and 4-6 km deep, "only a yardstick" (OoW Vol I Annex B p 103); on a DCB up to 8000-10000 m (GSP-1947 s26 para 5 p 119), all three Bns three up (pp 120-121). */
export const BDE_FRONT = { wideM: [10000, 12000] as [number, number], deepM: [4000, 6000] as [number, number], dcbM: [8000, 10000] as [number, number] };

export const BN_FRONT_TEXT = 'In the plains a Bn normally holds 3,000-5,000 m of front, up to 2,000-3,000 m deep (IBB S53 para 4 c pp 276-277); on an extended frontage two Coys up 4,500 m (3-4 km deep), three up 6,500 m (2.5-3 km deep) (IBB Annex U App 6 p 481)';
export const BN_OBS_TEXT = 'Along a canal or A tk ditch (24 m or more wide, IBB S60 p 331): three Coys up, up to 4,115 m (4,500 yds) (IBB S61 p 333; Annex V p 483)';
export const BDE_FRONT_TEXT = 'A Bde 10-12 km wide and 4-6 km deep: only a yardstick, not to be followed rigidly (OoW Vol I Annex B p 103)';
export const BDE_DCB_TEXT = 'A Bde on a DCB up to 8,000-10,000 m by the terrain and the second line tps allotted (GSP-1947 s26 para 5 p 119); normally all three Bns three up, depth from their own resources (pp 120-121)';

/** The ground's own rules for the def's DP heads (mountains, desert), each with its book and page. */
export const GROUND_DEF: Record<Exclude<AprcGroundKind, 'plains'>, { fdls: string; adv: string; res: string; atk: string; rules: string[] }> = {
  mountains: {
    fdls: 'In mountains: hold the dominating features astride the main axis and on its flks, block the valleys; Pl posts, the gaps covered by mines and fire, the M fds thickest in the valleys and foothills; features the En cannot afford to by-pass, reverse slopes occupied',
    adv: '',
    res: 'In mountains: split, each part close to its valley and able to launch at once; a res upwards of Bn lvl from one central loc is of little value; kept as far fwd as possible',
    atk: '',
    rules: [
      'In mountains: deny the main axis by occupying the dominating features astride it and on its flks (MW p 147); protective M fds and wire thickest in the valleys / foothills (MW p 150); the def based on features the En cannot afford to by-pass (GSP-1947 p 175); reverse slopes occupied (GSP-1947 p 176); frontages comparatively narrow (OoW Vol I p 72)',
      'In mountains: little value in a res upwards of Bn lvl from one central loc (MW p 169); the res split, positioned to launch at once or conc (GSP-1947 p 176); frontages comparatively narrow, the res as far fwd as possible (OoW Vol I p 72)',
    ],
  },
  desert: {
    fdls: 'In desert: deny the vital gr only, a number of defended localities accepting large gaps, held by fire, not by men; str pts at the comm centres and ITG, adm self-sufficient',
    adv: 'In desert covering tps rather than an adv posn, more screens and stay-behind parties; the covering tps move by ni and canalise the En into a killing gr',
    res: 'In desert: one third or more of the force, mainly armr, kept down to Bde, employed within 2-6 h; the C pen mode less preferred',
    atk: 'In desert ATGMs concentrated on the most threatened tk apch, no dissipation',
    rules: [
      'In desert: defended localities accepting large gaps (DW p 22); hold gr by fire and not by men (GSP-1947 p 172); mech res down to Bde (DW p 23); str pts adm self-sufficient (DW p 28)',
      'In desert: covering tps preferred to adv posns; stay-behind parties (OoW Vol I p 71); all moves of the covering tps at ni, the En canalised into a killing gr (DW pp 24-25)',
      'In desert: one-third or more of the force earmarked as res, mainly armr, retained down to Bde (DW p 26); employed within 2-6 h; tac res in C pen mode less preferred, not ruled out (DW p 27)',
      'In desert: concentrate the ATGMs on the most threatened tk apch, avoid dissipation (DW p 58)',
    ],
  },
};

// ── casualties (R91) ─────────────────────────────────────────────────────────────────────────────────────────────────

export type CasArm = 'AC' | 'SIB' | 'MIB' | 'LAT / HAT' | 'Arty' | 'Engrs' | 'AD' | 'Sigs' | 'Svcs';
export type CasIntensity = 'intense' | 'moderate' | 'low';

/** Battle cas, % a day, by arm and intensity: Offrs, JCOs, Sldrs (lsf pp 50-51, as printed). */
export const LSF_CAS: Record<CasArm, Record<CasIntensity, [number, number, number]>> = {
  AC: { intense: [2.3, 2.5, 2.0], moderate: [1.1, 1.2, 0.7], low: [0.2, 0.2, 0.1] },
  SIB: { intense: [2.9, 3.1, 2.4], moderate: [1.3, 1.2, 0.8], low: [0.6, 0.6, 0.2] },
  MIB: { intense: [2.5, 2.5, 1.8], moderate: [1.0, 0.9, 0.6], low: [0.2, 0.2, 0.1] },
  'LAT / HAT': { intense: [2.2, 2.4, 1.6], moderate: [1.2, 0.8, 0.6], low: [0.3, 0.3, 0.2] },
  Arty: { intense: [2.2, 0.5, 1.5], moderate: [0.7, 0.6, 0.7], low: [0.1, 0.1, 0.07] },
  Engrs: { intense: [1.8, 2.0, 0.6], moderate: [0.6, 0.6, 0.4], low: [0.1, 0.2, 0.1] },
  AD: { intense: [1.7, 1.8, 1.0], moderate: [0.4, 0.4, 0.3], low: [0.2, 0.4, 0.4] },
  Sigs: { intense: [0.6, 0.5, 0.3], moderate: [0.4, 0.3, 0.2], low: [0.2, 0.15, 0.07] },
  Svcs: { intense: [0.4, 0.4, 0.3], moderate: [0.3, 0.3, 0.2], low: [0.2, 0.13, 0.07] },
};
/** "The daily admission to medical units of sick and injured is calculated at 0.10% of the total force" (lsf p 50). */
export const LSF_SICK_PCT = 0.1;
/** An ADS evacuates 75 cas in 24 h; an FTC does 25 major ops a day, 50 beds (lsf pp 48-49); a Med Bn (D type) clears 375 (Annex K p 80). */
export const LSF_MED = { adsDay: 75, ftcOpsDay: 25, ftcBeds: 50, medBnDay: 375 };

export interface AprcCasGroup {
  arm: CasArm;
  offr: number;
  jco: number;
  sldr: number;
}

/** The lsf row for an ORBAT unit: by its arm and type. Avn, log and the rest take the Svcs row. */
export function casArmOf(u: { id?: string; arm?: string; subtype?: string; name?: string } | null | undefined): CasArm {
  const t = `${u?.id ?? ''} ${u?.subtype ?? ''} ${u?.name ?? ''}`.toLowerCase();
  switch (u?.arm) {
    case 'armr':
      return 'AC';
    case 'inf':
      return /\b(lat|hat)\b|atgm|\batk\b/.test(t) ? 'LAT / HAT' : /mech|abib|\bapc\b/.test(t) ? 'MIB' : 'SIB';
    case 'arty':
      return 'Arty';
    case 'engr':
      return 'Engrs';
    case 'ad':
      return 'AD';
    case 'sig':
      return 'Sigs';
    default:
      return 'Svcs';
  }
}

/**
 * Officers, JCOs and soldiers of an ORBAT unit by lsf row: the unit's own printed strength by rank, else its children's
 * (by `unit` id, times their count), as the ORBAT's strength total is summed. Its SW and attached counted with the
 * soldiers. Units with neither are named in `missing`.
 */
export function casGroupsOf(list: any[], id: string, count = 1): { groups: AprcCasGroup[]; missing: string[] } {
  const acc = new Map<CasArm, AprcCasGroup>();
  const missing: string[] = [];
  const byId = (x: string | null | undefined) => (x ? list.find((u) => u?.id === x) ?? null : null);
  const go = (u: any, mult: number, depth: number, label: string): void => {
    if (!u || depth > 6) {
      missing.push(label);
      return;
    }
    const s = u.strength;
    const num = (v: any): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
    if (s && [s.offr, s.jco, s.sldr].some((v) => Number.isFinite(Number(v)) && Number(v) > 0)) {
      const arm = casArmOf(u);
      const g = acc.get(arm) ?? { arm, offr: 0, jco: 0, sldr: 0 };
      g.offr += num(s.offr) * mult;
      g.jco += num(s.jco) * mult;
      g.sldr += (num(s.sldr) + num(s.sw) + num(s.att)) * mult;
      acc.set(arm, g);
      return;
    }
    if (!u.children?.length) {
      missing.push(String(u.name ?? u.id ?? label));
      return;
    }
    for (const c of u.children) go(byId(c.unit), mult * (Number(c.count) || 1), depth + 1, String(c.role ?? c.unit ?? '?'));
  };
  go(byId(id), count, 0, id);
  return { groups: [...acc.values()], missing: [...new Set(missing)] };
}

/** The battle cas a day of the groups at an intensity. */
export function battleCas(groups: AprcCasGroup[], at: CasIntensity): number {
  return groups.reduce((a, g) => {
    const r = LSF_CAS[g.arm][at];
    return a + (g.offr * r[0] + g.jco * r[1] + g.sldr * r[2]) / 100;
  }, 0);
}

/**
 * Cas Estimate under Adm and Log: battle cas a day at each intensity by the lsf rates for each arm and rank, the sick
 * and injured at 0.10 % of the force, against the ADS (75 a day), the FTC and the Med Bn; the evac standard. A planning
 * figure for the medical plan, a proposal.
 */
export function casEstimate(c: { groups: AprcCasGroup[]; missing: string[]; src: string; assumed?: string | null }): AprcPatch | null {
  const total = c.groups.reduce((a, g) => a + g.offr + g.jco + g.sldr, 0);
  if (!(total > 0)) return null;
  const sick = (total * LSF_SICK_PCT) / 100;
  const word: Record<CasIntensity, string> = { intense: 'Intense', moderate: 'Moderate', low: 'Low' };
  const rows = (['intense', 'moderate', 'low'] as CasIntensity[]).map((k) => {
    const b = battleCas(c.groups, k);
    const all = b + sick;
    return [word[k], n0(b), n0(sick), n0(all), String(Math.max(1, Math.ceil(all / LSF_MED.adsDay)))];
  });
  const arms = c.groups.map((g) => `${g.arm} ${n0(g.offr + g.jco + g.sldr)}`).join(', ');
  const draft =
    `${n0(total)} all ranks (${arms}): a day of intense fighting about ${rows[0][1]} battle cas and ${rows[0][2]} sick and injured, ${rows[0][3]} in all, ${rows[0][4]} ADS at 75 a day; moderate ${rows[1][3]}, low ${rows[2][3]}. ` +
    `An FTC does ${LSF_MED.ftcOpsDay} major ops a day; a Med Bn (D type) clears ${LSF_MED.medBnDay}. Evac by CAP, RAP, ADS, FTC: never more than 4 h without expert treatment, surgery within 12 h.` +
    (c.missing.length ? ` Not counted (ranks not printed): ${c.missing.slice(0, 4).join(', ')}${c.missing.length > 4 ? ` and ${c.missing.length - 4} more` : ''}.` : '');
  return {
    id: 'plan.adm.cas',
    draft,
    state: 'judge',
    table: { head: ['Intensity', 'Battle cas a day', 'Sick and injured a day', 'Total a day', 'ADS (75 a day)'], rows, widths: [0.2, 0.2, 0.22, 0.18, 0.2] },
    basis: [
      data(`ORBAT strength by rank: ${c.src}${c.assumed ? ` (${c.assumed})` : ''}`),
      rule('Battle cas, % a day, by arm (AC, SIB, MIB, LAT / HAT, Arty, Engrs, AD, Sigs, Svcs), intensity and rank (lsf pp 50-51)'),
      rule('Sick and injured: 0.10 % of the total force a day (lsf p 50)'),
      rule('An ADS evacuates 75 cas in 24 h; an FTC does 25 major ops a day and holds 50 (lsf pp 48-49); a Med Bn (D type), 5 ADS and 2 FTC, clears 375 (lsf p 48, Annex K p 80)'),
      rule('Never more than 4 h without expert treatment; surgery never delayed more than 12 h (lsf p 47); the chain CAP, RAP, ADS, FTC, base hospital (Annex L pp 81-82)'),
      calc("Each arm's Offrs, JCOs and Sldrs at its rate, summed; the ORBAT's SW and attached counted with the Sldrs; avn, log and other arms at the Svcs row; ADS = the day's total / 75, rounded up"),
    ],
    src: 'orbat',
  };
}

// ── heads a Read adds (R81, R86, R91) ────────────────────────────────────────────────────────────────────────────────

/** AP-1's Dismounting Area for mech inf (MIB pp 90, 120-123). */
export const dismountPara = (): AprcPara =>
  para('gr.ded.ap1.dis', 'Dismounting Area', {
    prompts: [
      'Four choices: well short of the obj (out of SA and short range A tk wpn range), short of it, on it, or ahead of it (MIB pp 120-122)',
      'Short of the obj: easily recognised, defiladed from dir fire, within assaulting range of and square to the obj, out of hand-thrown grenade range and outside the safety limits of own sp fire; likely adjusted by the En as DF tgts (MIB p 121)',
      'On the obj: speed and shock, tks and inf arrive together, the APCs vulnerable to short range A tk wpns; ahead of it only when the En is relatively weak in A tk wpns (MIB pp 121-122)',
      'Remain mounted as long as tac sound; the res kept mounted till committed; the empty APCs: stay, wdr, fire in sp or follow (MIB p 123)',
      'The quick aprc lists possible FUPs and dismounting areas (MIB p 90)',
    ],
  });

const LIFT_PROMPTS = [
  'A Bn: build-up and maint after capture 16 vehs, 582 mules or 1,164 porters; a Bde 1,746 mules or 3,492 porters, a Div 5,238 / 10,476; all movs in the hrs of darkness (MW pp 145-146)',
  "F ech stores of a Bn about 364 mules or 728 porters: pri 1 the rifle Coys' (24 mules or 62 porters a Coy), pri 2 the rest (69 mules or 180 porters) (MW p 142; pp 324-325, 330-331)",
  'Emergency pack rations till link up, a delay of 48-72 h (MW p 145); in def a Bn 158 mules a week for rations, 123 a lift of amn (MW pp 322-323)',
];
const CAS_PROMPTS = [
  'Battle cas % a day by arm and intensity (lsf pp 50-51); sick and injured 0.10 % of the force a day (lsf p 50)',
  'An ADS 75 cas a day; an FTC 25 major ops a day; a Med Bn (D type) 375 a day (lsf pp 48-49, Annex K p 80)',
];

export interface AprcHeadsIn {
  /** Own unit mounted in APCs (a MIB, a mech Coy): the Dismounting Area in AP-1 (the attack). */
  mounted: boolean;
  /** The AOR reads as mountains: Mules and Porters under Adm and Log. */
  mountains: boolean;
  /** The ORBAT was read: the Cas Estimate under Adm and Log. */
  orbat: boolean;
}

/**
 * Add the heads that apply to a newly read document (in place; ids of those added). A head the earlier sheet of the same
 * kind held with the planner's words, typed cells or an acceptance, or drafted from a reading not taken this time, stays,
 * so nothing of his is lost when the condition is not read again.
 */
export function readHeads(doc: AprcDoc, o: AprcHeadsIn, prev: AprcDoc | null = null, unread: Iterable<AprcSrc> = []): string[] {
  const un = new Set(unread);
  const was = prev && prev.kind === doc.kind ? prev : null;
  const held = (id: string): boolean => {
    const p = was ? find(was, id) : null;
    return !!p && (!!p.mine || !!p.cells || !!p.accepted || !!p.addRows || (!!p.src && un.has(p.src)));
  };
  const added: string[] = [];
  const add = (parentId: string, after: string | null, p: AprcPara): void => {
    const parent = find(doc, parentId);
    if (!parent || find(doc, p.id)) return;
    const i = after ? parent.children.findIndex((c) => c.id === after) : -1;
    if (i >= 0) parent.children.splice(i + 1, 0, p);
    else parent.children.push(p);
    added.push(p.id);
  };
  if (doc.kind === 'attk' && (o.mounted || held('gr.ded.ap1.dis'))) add('gr.ded.ap1.depl', 'gr.ded.ap1.fup', dismountPara());
  if (o.mountains || held('plan.adm.lift')) add('plan.adm', null, para('plan.adm.lift', 'Mules and Porters', { prompts: LIFT_PROMPTS }));
  if (o.orbat || held('plan.adm.cas')) add('plan.adm', null, para('plan.adm.cas', 'Cas Estimate', { prompts: CAS_PROMPTS }));
  return added;
}
