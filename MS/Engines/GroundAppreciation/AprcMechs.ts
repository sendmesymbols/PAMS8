/**
 * AprcMechs.ts
 *
 * The mechanics of the appreciation from the two Aprc books the user gave on 24 Nov 2026: "Understanding Aprc - I"
 * (Maj M Zeeshan Asghar Ch; a Bn-level study guide: planning parameters, 2 up or 3 up, the vis of the en op and its
 * linear model, the tablets, the sketch lists) and "Mechs of Aprc (Attk)" (a Coy Comd's attack appreciation). Pure: no
 * DOM, no map, no bundle; the engine collects the inputs (`AprcMechsIn`).
 *
 *   layoutDef / writeLayoutDef   the def laid by the aim's limitations: FDLs, depth, screens, protective dets, Coys up
 *   analysisDef / courseDef      the course in the book's paragraph and its advs / disadvs under the book's heads
 *   visDef / writeVisDef         the vis of the en op tier by tier and the en reactions / own ctr actions in 3 phases
 *   writeTsDef                   time data with first / last lt and day / ni hrs, essential timings, more / less time
 *   apchTestsAttk                the attack's apchs tested on the book's planning parameters
 *   timeCalcAttk                 the attack's backward / forward calc with the books' figures, the moon, essential timings
 *   writeSketch                  the details to be marked on the sketch (Anx P / Anx Q) against the symbols on the map
 *   writeTsWdr                   the withdrawal's time data, time req and essential timings (OoW Vol III; OoW Vol I p 39)
 *   styleNotes                   the books' writing rules on the planner's words and the drafts
 *
 * Precedence (user, 24 Nov 2026): where a pamphlet prints a figure (IBB, OoW Vol I, the IPB book) it drives the draft
 * and the guide's figure is shown beside it in the basis; a guide's figure drives only where no pamphlet prints one, and
 * then it says so. A Coy's attack takes Mechs of Aprc (Attk), a Bn's or a Bde's Understanding Aprc.
 */

import type { AorDefLine, AorReading, AorSide } from '../GroundGuide/GroundGuideAor';
import { moonState } from '../GroundGuide/GroundGuideOcoka';
import { BACKWARD_EVENTS, MA, UA, para, walk, type AprcBasis, type AprcConfirm, type AprcDoc, type AprcKind, type AprcLimits, type AprcPara, type AprcPatch, type AprcTable } from './AprcModel';
import { BATTLE_PROC_H, attkFirst, clockAt, hplus, lightTimes, type AprcAttkIn, type AprcAttkPlanIn, type AprcCheckIn, type AprcHSumIn, type AprcLight, type AprcSymbolIn, type AprcWritten } from './AprcWrite';
import { BDE_DCB_TEXT, BDE_FRONT, BDE_FRONT_TEXT, BN_FRONT, BN_FRONT_TEXT, BN_OBS_TEXT, GROUND_DEF, GUN_DEPL, QUICK_ATTK, QUICK_TEXT, groundKind, gunUnitFor, mtnAssault, type AprcGroundKind } from './AprcBooks';

const km = (m: number): string => (m / 1000).toFixed(1);
const list = (a: string[], and = 'and'): string => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} ${and} ${a[a.length - 1]}`);
const cap1 = (t: string): string => (t ? t[0].toUpperCase() + t.slice(1) : t);
const rule = (text: string): AprcBasis => ({ kind: 'rule', text });
const input = (text: string): AprcBasis => ({ kind: 'input', text });
const calc = (text: string): AprcBasis => ({ kind: 'calc', text });
const data = (text: string): AprcBasis => ({ kind: 'data', text });
const alpha = (i: number): string => (i < 26 ? String.fromCharCode(97 + i) : alpha(Math.floor(i / 26) - 1) + String.fromCharCode(97 + (i % 26)));
const uniq = (a: Array<string | null | undefined>): string[] => [...new Set(a.filter((x): x is string => !!x))];
/** "1 h 40", "35 min". */
const dur = (min: number): string => {
  const m = Math.round(Math.abs(min));
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h} h${r ? ` ${r}` : ''}` : `${r} min`;
};
const h1 = (x: number): string => (Math.round(x * 10) / 10).toString();

const SIDES: AorSide[] = ['Lt', 'Cen', 'Rt'];
/** The attack reading's sides are the en's (as he faces the attack): own Lt is his Rt. */
const MIRROR: Record<AorSide, AorSide> = { Lt: 'Rt', Cen: 'Cen', Rt: 'Lt' };

// ── D-times ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** "0600 D+1", "0600 hrs D+1", "D-1 1000", "06:00 D Day", "0600" (D Day): minutes from 0000 hrs D Day; null when none of these. */
export function parseDTime(s: string | null | undefined): number | null {
  const t = String(s ?? '').trim();
  if (!t) return null;
  const dm = /\bD\s*([+-])\s*(\d{1,2})\b/i.exec(t);
  const day = dm ? (dm[1] === '-' ? -1 : 1) * Number(dm[2]) : 0;
  const rest = dm ? t.replace(dm[0], ' ') : t;
  const cm = /(?:^|[^\d])([01]?\d|2[0-3]):?([0-5]\d)(?!\d)/.exec(rest);
  if (!cm) return null;
  return day * 1440 + Number(cm[1]) * 60 + Number(cm[2]);
}

/** A D-time as the books write it: "0600 hrs D+1". */
export const dClock = (min: number): string => clockAt(0, min / 60);

const minsOf = (s: string | null): number | null => (s && /^\d{4}$/.test(s) ? Number(s.slice(0, 2)) * 60 + Number(s.slice(2)) : null);

// ── the night of D Day ───────────────────────────────────────────────────────────────────────────────────────────────

export interface AprcNight {
  /** First and last light on D Day, minutes from 0000 hrs D Day (near enough the same the days round it). */
  firstLt: number | null;
  lastLt: number | null;
  /** The night of D Day, last lt D Day to first lt D+1: moonlit spans (the moon 5 degrees up and a quarter lit) and dark ones. */
  spans: Array<{ from: number; to: number; moon: boolean }>;
  /** Lit share of the moon at midnight D / D+1, 0-100, waxing or waning, and its quarter (1st new to half ... 4th half to new). */
  moonPct: number;
  waxing: boolean;
  quarter: 1 | 2 | 3 | 4;
  light: AprcLight;
}

/**
 * The night of D Day at a place: first and last light (the sun 6 degrees down, as `lightTimes`) and, every 10 min from
 * last lt to first lt, moonlit or dark by the OcokaDoctrine rule (the moon 5 degrees up and a quarter lit, after IBB
 * Annex D and p 201). `dDay` "YYYY-MM-DD" in the place's zone; empty takes today there.
 */
export function nightOf(dDay: string | null, lat: number, lon: number, utcOffsetMin: number, now: Date = new Date()): AprcNight {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dDay ?? '').trim());
  const local = new Date(now.getTime() + utcOffsetMin * 60000);
  const [y, mo, d] = m ? [Number(m[1]), Number(m[2]) - 1, Number(m[3])] : [local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()];
  const mid = Date.UTC(y, mo, d) - utcOffsetMin * 60000;
  const light = lightTimes(new Date(mid + 12 * 3600000), lat, lon, utcOffsetMin);
  const firstLt = minsOf(light.firstLight), lastLt = minsOf(light.lastLight);
  const spans: AprcNight['spans'] = [];
  if (firstLt !== null && lastLt !== null) {
    const to = 1440 + firstLt;
    for (let t = lastLt; t < to; t += 10) {
      const ms = moonState(new Date(mid + (t + 5) * 60000), lat, lon);
      const moon = ms.altDeg >= 5 && ms.illum >= 0.25;
      const end = Math.min(t + 10, to);
      const last = spans[spans.length - 1];
      if (last && last.moon === moon) last.to = end;
      else spans.push({ from: t, to: end, moon });
    }
  }
  const i0 = moonState(new Date(mid + 1440 * 60000), lat, lon).illum;
  const i1 = moonState(new Date(mid + 1440 * 60000 + 12 * 3600000), lat, lon).illum;
  const waxing = i1 > i0;
  const quarter = (waxing ? (i0 < 0.5 ? 1 : 2) : i0 >= 0.5 ? 3 : 4) as 1 | 2 | 3 | 4;
  return { firstLt, lastLt, spans, moonPct: Math.round(i0 * 100), waxing, quarter, light };
}

/** Hours of day lt and of ni between two D-times (minutes), first and last lt the same each day. */
export function dayNight(from: number, to: number, firstLt: number, lastLt: number): { day: number; ni: number } {
  let day = 0;
  for (let k = Math.floor(from / 1440) - 1; k <= Math.ceil(to / 1440); k++) {
    const a = Math.max(from, k * 1440 + firstLt), b = Math.min(to, k * 1440 + lastLt);
    if (b > a) day += b - a;
  }
  const all = Math.max(0, to - from);
  return { day: day / 60, ni: (all - day) / 60 };
}

/** The last light at or before a D-time. */
export function lastLtBefore(t: number, lastLt: number): number {
  let c = Math.floor(t / 1440) * 1440 + lastLt;
  if (c > t) c -= 1440;
  return c;
}

// ── the def laid by the aim ──────────────────────────────────────────────────────────────────────────────────────────

export interface AprcCoysUp {
  /** Coys up, as the pamphlet's frontages give it (held down by the aim's "not more than __ Coys"). */
  up: number;
  /** Pls up, the guide's (no pamphlet prints it). */
  plsUp: 2 | 3;
  ext: boolean;
  /** Coys up by the guide's table. */
  guideUp: 2 | 3;
  text: string;
  basis: AprcBasis[];
}

/**
 * 2 up or 3 up from the Bn's FDL frontage. The pamphlet drives: in the plains a Bn normally holds 3,000-5,000 m (IBB S53
 * para 4 c pp 276-277), and wider is an extended frontage (IBB S59; OoW Vol I p 5, pp 82-83), laid two Coys up on 4,500 m
 * or three up on 6,500 m (IBB Annex U App 6 p 481: the extended frontages' annex, not the normal frontage). Along a canal or
 * A tk ditch 24 m or more wide (IBB S60 p 331) three Coys up, up to 4,115 m (S61 p 333; Annex V p 483). Mountains and
 * desert print no Bn figure (MW, DW): IBB's rows are taken and the book's rule said beside them. The guide's table beside
 * it all (Understanding Aprc p 4: up to 6.5 km 2 up / 2 up, 7-10 km 3 up / 2 up, beyond 10.5 km 3 up / 3 up; between its
 * bands the nearer is taken).
 */
export function coysUp(frontM: number, maxCoys: number | null = null, o: { ground?: AprcGroundKind; obstacle?: string | null } = {}): AprcCoysUp {
  const F = BN_FRONT;
  const onObs = !!o.obstacle;
  const pam = onObs ? 3 : frontM <= F.extTwoM ? 2 : 3;
  const ext = frontM > (onObs ? F.obstacleM[1] : F.normalM[1]);
  const g = frontM <= 6750 ? { up: 2 as const, pls: 2 as const, coy: 2500, band: 'up to 6.5 km' } : frontM <= 10250 ? { up: 3 as const, pls: 2 as const, coy: 3000, band: '7-10 km' } : { up: 3 as const, pls: 3 as const, coy: 3500, band: 'beyond 10.5 km' };
  const gap = (frontM > 6500 && frontM < 7000) || (frontM > 10000 && frontM < 10500);
  const up = maxCoys !== null && maxCoys > 0 ? Math.min(pam, maxCoys) : pam;
  const where = onObs
    ? `along ${o.obstacle}, where a Bn three Coys up holds up to 4.1 km`
    : `where a Bn normally holds 3-5 km${frontM > F.normalM[1] ? ' and, on an extended frontage, two Coys up 4.5 km and three up 6.5 km' : ''}`;
  const groundWord = o.ground === 'mountains' ? ' In mountains frontages are comparatively narrow, with large gaps; MW prints no Bn figure, so IBB\'s are taken.' : o.ground === 'desert' ? ' In desert large gaps are accepted, the gr held by fire; DW prints no Bn figure, so IBB\'s are taken.' : '';
  const text =
    `${up} Coys up, Pls ${g.pls} up: the FDLs run ${km(frontM)} km between bdys, ${where}` +
    `${ext ? ': an extended frontage, its gaps covered by mines, fire and ptls' : ''}${up < pam ? `; held to ${up} Coys up by the aim` : ''}.${groundWord} ` +
    `The guide: ${g.band}, ${g.up} up and Pls ${g.pls} up, a Coy front up to ${g.coy.toLocaleString('en-GB')} m${gap ? ' (between its bands: the nearer taken)' : ''}${g.up !== pam ? "; the pamphlet's figure is taken" : ''}. ` +
    'A Pl locality holds 600 m (the guide: 500 m at most, a gap of more than 500 m between Pls an extended frontage).';
  const basis: AprcBasis[] = [
    rule(onObs ? BN_OBS_TEXT : BN_FRONT_TEXT),
    ...(onObs ? [rule(BN_FRONT_TEXT)] : []),
    rule('A Pl locality 600 m (IBB Annex U App 5 p 480); frontages below Bn are not extended (IBB S59 para 6 b p 326)'),
    ...(ext ? [rule('Wide fronts mean gaps, covered by mines, fire and ptls (OoW Vol I p 5); a Bn may deploy three Coys up on an extended frontage, depth always kept (OoW Vol I pp 82-83)')] : []),
    ...(o.ground === 'mountains' ? [rule('In mountains the frontages are comparatively narrow (OoW Vol I p 72); MW prints no Bn frontage')] : o.ground === 'desert' ? [rule('In desert defended localities accepting large gaps (DW p 22), gr held by fire and not by men (GSP-1947 p 172); DW prints no Bn frontage')] : []),
    rule(`Beside it, the guide: Bn AOR up to 6.5 km 2 up / 2 up (a Coy 2,500 m), 7-10 km 3 up / 2 up (3,000 m), beyond 10.5 km 3 up / 3 up (3,500 m); a Pl front 500 m at most (${UA(4)})`),
  ];
  return { up, plsUp: g.pls, ext, guideUp: g.up, text, basis };
}

/**
 * The water line a line of def runs along when it is an obs the def can be laid on: 24 m or more wide (IBB S60 p 331), its
 * width read off the apch that crosses it. Null when it is narrower or its width is not recorded.
 */
export function wideWaterOn(r: AorReading, l: AorDefLine | null): { name: string; widthM: number } | null {
  if (!l?.obstacle) return null;
  let w = 0;
  for (const a of r.apchs) for (const ob of a.obstacles ?? []) if (ob.name === l.obstacle && ob.widthM !== null && ob.widthM > w) w = ob.widthM;
  return w >= BN_FRONT.obstacleMinWidthM ? { name: l.obstacle, widthM: w } : null;
}

/** A Bde's front and depth by the yardstick, or on a DCB (24 m or more of water along the FDLs). */
export function bdeFront(frontM: number, depthGapM: number | null, onObs: string | null): { text: string; basis: AprcBasis[] } {
  const B = BDE_FRONT;
  const [lo, hi] = onObs ? B.dcbM : B.wideM;
  const vs = frontM > hi ? `wider than the ${km(hi)} km` : frontM < lo ? `narrower than the ${km(lo)} km` : `within the ${km(lo)}-${km(hi)} km`;
  const deep = depthGapM !== null ? `; the depth line ${km(depthGapM)} km behind the FDLs, ${depthGapM < B.deepM[0] ? 'short of' : depthGapM > B.deepM[1] ? 'beyond' : 'within'} the 4-6 km yardstick` : '';
  const text = onObs
    ? `The FDLs run ${km(frontM)} km along ${onObs}, ${vs} a Bde may be given on a DCB: all three Bns three up, depth from their own resources${deep}.`
    : `The FDLs run ${km(frontM)} km, ${vs} of the yardstick${deep}.`;
  return { text, basis: onObs ? [rule(BDE_DCB_TEXT), rule(BDE_FRONT_TEXT)] : [rule(BDE_FRONT_TEXT)] };
}

export interface AprcDefLayout {
  fdl: AorDefLine | null;
  depth: AorDefLine | null;
  /** The lines ahead of the FDLs, front first: the protective dets' delay lines. */
  ahead: AorDefLine[];
  /** The line through the MITG, when there is one. */
  strPt: AorDefLine | null;
  /** Km past the border (or the front of the AOR): the FDLs; the depth behind the FDLs; the screens; the protective dets. */
  fdlKm: number | null;
  depthGapKm: number | null;
  screenKm: [number, number] | null;
  detsWhere: string | null;
  coys: AprcCoysUp | null;
  /** Why the FDLs are on their line (the reasons for pri 1). */
  reasons: string[];
  basis: AprcBasis[];
  prompts: string[];
  /** The FDLs or the depth are not on the lines the Gr Scope reading took. */
  moved: boolean;
  border: string;
  /** The sides of the apchs present, Lt to Rt (the lines' BUAs follow this order). */
  sides: AorSide[];
  /** The echelon of the AOR (a formation's addl lines of def are tested on their obs, OoW Vol I p 17). */
  echelon: string;
  /** The ground as the books take it (mountains, desert, plains), from the AOR's country. */
  ground: AprcGroundKind;
  /** The water line along the FDLs when it is 24 m or more wide (IBB S60 p 331): the def laid along an obs. */
  wideObs: { name: string; widthM: number } | null;
  /** A Bde's front and depth against its yardstick (OoW Vol I Annex B; GSP-1947 p 119 on a DCB). */
  bde: { text: string; basis: AprcBasis[] } | null;
}

/** A line's distance past the border along the apchs (the line through the MITG at the nearest apch's). */
const lineDepth = (r: AorReading, l: AorDefLine): number => l.depthM ?? (r.apchs.length ? Math.min(...r.apchs.map((a) => a.pastM)) : Infinity);

/**
 * The def laid by the aim's limitations on the lines of the AOR reading (Understanding Aprc pp 3-4):
 *   no pen beyond a line   the depth on it, the FDLs on a line 3-5 km ahead (OoW Vol I p 17: the line of no pen);
 *   as far fwd as feasible the FDLs on the line 5-8 km past the border (a Bn), the depth 3-5 km behind;
 *   def X at all costs     the depth on X;
 *   neither                the Gr Scope reading's roles stand.
 * The depth line is looked for at the pamphlet's Bn depth (IBB Annex U App 6 p 481), screens 1-1.5 km ahead of the
 * FDLs, the protective dets as the parameter places them.
 */
export function layoutDef(r: AorReading, lim: AprcLimits = {}, echelon = 'Bn'): AprcDefLayout {
  const borderName = r.apchs.find((a) => a.cross)?.cross?.border ?? null;
  const border = borderName ? `the ${borderName}` : 'the front of the AOR';
  const sides = SIDES.filter((s) => r.apchs.some((a) => a.side === s));
  const zM = r.apchs.length ? Math.min(...r.apchs.map((a) => a.pastM)) : null;
  const dOf = (l: AorDefLine): number => l.depthM ?? zM ?? Infinity;
  const strPt = r.lines.find((l) => l.depthM === null) ?? null;
  const ls = r.lines.filter((l) => Number.isFinite(dOf(l))).sort((a, b) => dOf(a) - dOf(b) || String(a.id).localeCompare(String(b.id)));
  /** The line whose value is nearest the band (inside it first); front-most on a tie. */
  const near = (cands: AorDefLine[], val: (l: AorDefLine) => number, band: [number, number]): AorDefLine | null => {
    let best: AorDefLine | null = null, bd = Infinity;
    for (const l of cands) {
      const v = val(l);
      const d = v < band[0] ? band[0] - v : v > band[1] ? v - band[1] : 0;
      if (d < bd - 1e-6) ((bd = d), (best = l));
    }
    return best;
  };
  let fdl = r.lines.find((l) => l.role === 'FDLs') ?? null;
  let depth = r.lines.find((l) => l.role === 'Depth') ?? null;
  const reasons: string[] = [], basis: AprcBasis[] = [], prompts: string[] = [];
  const bnOnly = echelon === 'Bn' ? '' : `; the guide's figures are a Bn's, this AOR a ${echelon}'s`;
  // the line of no pen; with none set, the line of denial the higher comd gave stands for it (the two can be one, OoW Vol I p 18)
  const npId = lim.noPen ?? lim.denial ?? null;
  const npWord = lim.noPen ? 'the line of no pen' : 'the line of denial';
  const noPen = npId ? r.lines.find((l) => l.id === npId) ?? null : null;
  if (npId && !noPen) prompts.push(`Line ${npId} was not read: ${npWord} is not on the trace`);
  const denial = lim.denial ? r.lines.find((l) => l.id === lim.denial) ?? null : null;
  if (lim.denial && lim.noPen && !denial) prompts.push(`Line ${lim.denial} was not read: the line of denial is not on the trace`);
  if (lim.denial) basis.push(rule('The line of denial: fixed by the comd originating the plan and spelt out with the msn, beyond which no pen should be permitted; the subordinate preserves its integrity (OoW Vol I pp 17-18); the line of no pen is kept in view of it, and the two can be one due to terrain (p 18)'));
  if (denial && noPen && noPen !== denial && dOf(noPen) > dOf(denial)) prompts.push(`Line ${noPen.id} (no pen) lies behind Line ${denial.id}, the line of denial given: the line of no pen is selected keeping in view the line of denial (OoW Vol I p 17)`);
  if (noPen) {
    const d0 = dOf(noPen);
    const f = near(ls.filter((l) => dOf(l) < d0 && l !== strPt), (l) => d0 - dOf(l), [3000, 5000]);
    if (f) {
      fdl = f;
      depth = noPen;
      reasons.push(`${npWord} (Line ${noPen.id}) is held in depth, the FDLs ${km(d0 - dOf(f))} km ahead of it`);
    } else {
      fdl = noPen;
      depth = null;
      reasons.push(`no line lies ahead of ${npWord} (Line ${noPen.id}): the FDLs on it`);
    }
    basis.push(
      rule('The line of no pen: the formation comd\'s, kept in view of the line of denial; beyond it no pen is acceptable (OoW Vol I p 17)'),
      rule(`No pen beyond a line: the depth on it, the FDLs on any line 3-5 km ahead, screens 1-1.5 km ahead of the FDLs, protective dets at least 3-4 km ahead of the screens (${UA(3)}${bnOnly})`),
    );
  } else if (lim.fwd) {
    const f = near(ls.filter((l) => l !== strPt), dOf, [5000, 8000]);
    if (f) fdl = f;
    if (fdl) {
      const inBand = dOf(fdl) >= 5000 && dOf(fdl) <= 8000;
      reasons.push(`as far fwd as tac feasible: ${km(dOf(fdl))} km past ${border}${inBand ? ', in the 5-8 km a Bn leaves' : ', the line nearest the 5-8 km a Bn leaves'}`);
    }
    basis.push(rule(`As far fwd as tac feasible: leave the reach of the longest-range wpn in the screens (1-1.5 km ahead of the FDLs) and 1.5 km more; for a Bn the FDLs 5-8 km from the intl border on whichever line is there, the depth on the next line 3-5 km behind, the protective dets 1.5-2 km from the border (${UA(3)}${bnOnly})`));
  }
  if (lim.allCosts) {
    const nm = lim.allCosts.trim().toLowerCase();
    const L = strPt && r.mitg.name.toLowerCase() === nm ? strPt : r.lines.find((l) => l.buas.some((b) => !!b && b.toLowerCase() === nm)) ?? null;
    if (!L) prompts.push(`${lim.allCosts} lies on no line read: put the depth on it (${UA(3)})`);
    else if (fdl && L === fdl) reasons.push(`${lim.allCosts}, to be def at all costs, is on the FDLs: make it a str pt`);
    else {
      depth = L;
      reasons.push(`${lim.allCosts}, to be def at all costs, is held in depth on Line ${L.id}, the FDLs ahead of it`);
    }
    basis.push(rule(`Def of a loc at all costs: the depth on it, the rest sited as for the other parameters (${UA(3)}); a loc held all round in str is a str pt, at most a Pl one (${UA(6)})`));
  }
  if (lim.salient) prompts.push(`A salient is def at its base: the FDLs on the line nearest its base (${UA(4)})`);
  if (lim.penetrated) prompts.push(`The En has pen the defs: the line of max pen is taken as the border and the def laid from it (${UA(4)})`);
  const ground = groundKind(r.country);
  const wideObs = wideWaterOn(r, fdl);
  const coys = fdl && echelon === 'Bn' ? coysUp(fdl.frontM, lim.maxCoys ?? null, { ground, obstacle: wideObs?.name ?? null }) : null;
  // the depth line looked for at the pamphlet's depth: a Bn's normal 2-3 km (IBB p 277), on an extended frontage App 6's
  // (3-4 km two up, 2.5-3 km three up, IBB p 481); a Bde's 4-6 km (OoW Vol I Annex B p 103); else the guide's 3-5 km
  const band: [number, number] = coys ? (!coys.ext ? BN_FRONT.normalDepthM : coys.up <= 2 ? BN_FRONT.extDepthTwoM : BN_FRONT.extDepthThreeM) : echelon === 'Bde' ? BDE_FRONT.deepM : [3000, 5000];
  if (fdl && (!depth || dOf(depth) <= dOf(fdl))) depth = near(ls.filter((l) => dOf(l) > dOf(fdl!)), (l) => dOf(l) - dOf(fdl!), band);
  const ahead = fdl ? ls.filter((l) => dOf(l) < dOf(fdl!) && l !== strPt) : [];
  const fdlKm = fdl && Number.isFinite(dOf(fdl)) ? dOf(fdl) / 1000 : null;
  const depthGapKm = fdl && depth && Number.isFinite(dOf(depth)) ? (dOf(depth) - dOf(fdl)) / 1000 : null;
  const screenKm: [number, number] | null = fdlKm !== null && fdlKm >= 1 ? [Math.max(0, fdlKm - 1.5), fdlKm - 1] : null;
  let detsWhere: string | null = null;
  if (noPen && fdl !== noPen) {
    if (screenKm && screenKm[0] >= 3) detsWhere = `${h1(Math.max(0, screenKm[0] - 4))}-${h1(screenKm[0] - 3)} km past ${border}, 3-4 km ahead of the screens`;
  } else if (lim.fwd) {
    if (screenKm && screenKm[0] > 2) detsWhere = `1.5-2 km past ${border}`;
  } else if (ahead.length) detsWhere = `on ${list(ahead.map((l) => `Line ${l.id}${l.obstacle ? ` (${l.obstacle})` : ''}`))}`;
  if (fdl) {
    if (fdl.obstacle) reasons.push(`it draws str from the gr: along ${fdl.obstacle}`);
    const b = uniq(fdl.buas);
    if (b.length) reasons.push(`${b.length === 1 ? 'a BUA' : 'BUAs'} ${list(b)} astride the apchs${fdl.buas.length && fdl.buas.every(Boolean) ? ', one on every apch' : ''}`);
    if (fdl.lateral) reasons.push('a lateral Rd behind it for mutual sp and the shifting of tps');
    if (detsWhere) reasons.push(`room for the protective dets ahead (${detsWhere})`);
  }
  const moved = !!fdl && (fdl.role !== 'FDLs' || (!!depth && depth.role !== 'Depth' && depth !== strPt));
  const bde = fdl && echelon === 'Bde' ? bdeFront(fdl.frontM, depthGapKm !== null ? depthGapKm * 1000 : null, wideObs?.name ?? null) : null;
  return { fdl, depth, ahead, strPt, fdlKm, depthGapKm, screenKm, detsWhere, coys, reasons, basis, prompts, moved, border, sides, echelon, ground, wideObs, bde };
}

/** The apch sides in pri (the reading's rank) and those a tk can use (a Rd along it and room for the corridor). */
export function apchPri(r: AorReading): { ranked: string[]; tank: string[] } {
  const ranked = [...r.apchs].sort((a, b) => a.rank - b.rank);
  return { ranked: ranked.map((a) => a.side), tank: ranked.filter((a) => a.roadsAlong.length && a.fits).map((a) => a.side) };
}

/** " along X" after a line's name, unless its name already says so ("Along Hakra Branch"). */
const alongOf = (l: AorDefLine): string => (l.obstacle && !/^along\b/i.test(l.name) ? ` along ${l.obstacle}` : '');

const mitgOf = (r: AorReading): string => (r.mitg.name && r.mitg.name !== 'MITG' ? r.mitg.name : 'the MITG');

/** Lines of def and DP 1 as the layout gives them: proposals, each with its book and page. */
export function writeLayoutDef(L: AprcDefLayout, r: AorReading): AprcPatch[] {
  const out: AprcPatch[] = [];
  if (!L.fdl) return out;
  const mitg = mitgOf(r);
  const { ranked, tank } = apchPri(r);
  const roles: string[] = [`Line ${L.fdl.id} (FDLs)`];
  if (L.depth) roles.push(`Line ${L.depth.id} (depth${L.depth === L.strPt ? `, str pt ${mitg}` : ''})`);
  for (const l of L.ahead) roles.push(`Line ${l.id} (protective dets)`);
  if (L.strPt && L.strPt !== L.fdl && L.strPt !== L.depth) roles.push(`Line ${L.strPt.id} (str pt ${mitg})`);
  const why = L.reasons.map((t, i) => `(${alpha(i)}) ${cap1(t)}`).join('; ');
  out.push({
    id: 'gr.ded.lines.pri',
    draft: `Pri of lines of def: ${roles.map((x, i) => `(${i + 1}) ${x}`).join(', ')}.${why ? ` Reasons for Line ${L.fdl.id} as pri 1: ${why}.` : ''}${L.moved ? ' The aim moves the def off the lines the Gr reading took.' : ''}`,
    state: 'judge',
    basis: [...L.basis, calc("Each line's distance past the border along the apchs (the AOR reading; the line through the MITG at the nearest apch's)")],
    prompts: L.prompts,
    src: 'gr',
  });
  const G = L.ground === 'plains' ? null : GROUND_DEF[L.ground];
  const gRules = (G?.rules ?? []).map(rule);
  const fdlsGround = G?.fdls ? ` ${G.fdls}.` : '';
  out.push({
    id: 'gr.ded.dp1.fdls',
    draft: `Line ${L.fdl.id} (${L.fdl.name})${alongOf(L.fdl)}${L.fdlKm !== null ? `, ${h1(L.fdlKm)} km past ${L.border}` : ''}${L.coys ? `: ${L.coys.text}` : L.bde ? `. ${L.bde.text}` : '.'}${fdlsGround}`,
    state: 'judge',
    basis: [calc("From the lines of def and the aim's limitations"), ...(L.coys?.basis ?? []).filter((b) => !(G && /^In (desert|mountains) /.test(b.text))), ...(L.bde?.basis ?? []), ...(L.wideObs ? [data(`${L.wideObs.name}: ${Math.round(L.wideObs.widthM)} m wide where the apchs cross it (the 1:50k map)`)] : []), ...(G ? gRules.slice(0, 1) : [])],
    src: 'gr',
  });
  if (L.depth && L.depthGapKm !== null) {
    const depthRule =
      L.echelon === 'Bde'
        ? rule(`${BDE_FRONT_TEXT}; beside it, the guide's Bn figure: the depth on the next line 3-5 km behind the FDLs (${UA(3)})`)
        : rule(`${BN_FRONT_TEXT}; beside it, the guide: the depth on the next line 3-5 km behind the FDLs (${UA(3)})`);
    out.push({ id: 'gr.ded.dp1.depth', draft: `Line ${L.depth.id} (${L.depth.name}), ${h1(L.depthGapKm)} km behind the FDLs.`, state: 'judge', basis: [depthRule], src: 'gr' });
  }
  out.push(
    L.screenKm
      ? { id: 'gr.ded.dp1.screens', draft: `${h1(L.screenKm[0])}-${h1(L.screenKm[1])} km past ${L.border}, 1-1.5 km ahead of Line ${L.fdl.id}.`, state: 'judge', basis: [rule('A screen is provided in all circumstances (OoW Vol I Annex A p 102)'), rule(`Screens 1-1.5 km ahead of the FDLs (${UA('2-3')})`)], src: 'gr' }
      : { id: 'gr.ded.dp1.screens', draft: null, state: 'yours', basis: [], prompts: [`The FDLs lie less than 1 km past ${L.border}: no room for a screen ahead of them`], src: 'gr' },
  );
  const obs = L.ahead.filter((l) => l.obstacle);
  const desert = L.ground === 'desert';
  out.push({
    id: 'gr.ded.dp1.adv',
    draft: L.detsWhere
      ? `Protective dets ${L.detsWhere}${obs.length && !desert ? `; an adv posn on ${list(obs.map((l) => `${l.obstacle} (Line ${l.id})`), 'or')}, a natural obs, within own arty's reach from the main posn` : ''}${desert && G?.adv ? `; ${G.adv}` : ''}. Never so large as to weaken the main def, and not reinforced.`
      : 'No room for protective dets ahead of the FDLs.',
    state: 'judge',
    basis: [
      rule('The adv posn usually stands on a natural obs, preferably within arty range of the main posn; it opens fire at long range and falls back before the main attk (OoW Vol I p 14)'),
      rule('Protective elms not so large as to weaken the resistance of the main def (OoW Vol I p 13); posns held by covering tps and adv posns will not be reinforced (GSP-1947 p 105 para 10)'),
      ...(desert ? gRules.slice(1, 2) : []),
      rule(`Recce elms 25-100 km out, covering tps 15-25 km, an adv posn 5-10 km, screens 1-1.5 km ahead of the FDLs; on def terrain or an obs they are an adv posn, else covering tps (${UA(2)})`),
    ],
    src: 'gr',
  });
  out.push({
    id: 'gr.ded.dp1.cpen',
    draft: `${ranked[0] ? `On the ${ranked[0]} apch, the most threatened` : 'On the most threatened apch'}: about 1,500 m behind Line ${L.fdl.id}, 1,500 m of front; planned and prepared at the outset.${desert ? ' In desert the res in the C pen mode is less preferred, not ruled out.' : ''}`,
    state: 'judge',
    basis: [
      rule(`A C pen posn: 1,500 m of front on the most threatened apch, 1,500 m behind the FDLs (${UA(14)})`),
      rule('Occupied while the fwd localities are not yet overrun: within a Bn not later than 1.5-2 h after the En H, within a Bde 3 h (IBB p 310)'),
      rule('A number of C pen posns planned and prepared right at the outset (GSP-1947 p 109 para 22); previously prepared C pen posns occupied when a C attk is not possible (OoW Vol I p 52)'),
      ...(desert ? gRules.slice(2, 3) : []),
    ],
    src: 'gr',
  });
  // the res: the guide's is a Bn's (armr, engrs, 2/3 of the depth Coy, never LAT / HAT); a Bde's follows OoW Vol I; the
  // ground's rule (mountains split, desert a third mainly armr) is added where the AOR is such
  const sited = 'Sited by non-involvement, availability, dispersion within the reaction time and the most likely En cap.';
  const resOf =
    L.echelon === 'Bde'
      ? `The Bde res${L.depth ? ` behind Line ${L.depth.id}` : ''}: strong in armr, at least equal to the En in mobility and hitting power. ${sited}`
      : `Armr, Engrs and two thirds of the depth Coy${L.depth ? `, behind Line ${L.depth.id}` : ''}; LAT and HAT never in res. ${sited}`;
  out.push({
    id: 'gr.ded.dp1.res',
    draft: `${resOf}${G?.res ? ` ${G.res}.` : ''}`,
    state: 'judge',
    basis: [
      ...(L.echelon === 'Bde'
        ? [rule('Res strong in armr, at least equal to the En in mobility and hitting power (OoW Vol I pp 18-19); a Div res is an Inf Bde or elms, the Armd Regt or its bulk and the LAT Bn, under the Inf Bde Comd (GSP-1947 s27 para 3 p 122)'), rule(`The guide's res (armr, engrs, 2/3 of the depth Coy, never LAT / HAT) is a Bn's (${UA(6)})`)]
        : [rule(`Res: armr, engrs and 2/3 of the Coy in depth; LAT / HAT do not form part of it (${UA(6)})`)]),
      rule('Res located by non-involvement, availability, dispersion (able to conc within the reaction time) and the most likely En cap; the comd decides point, timing and direction (OoW Vol I pp 19-20)'),
      ...(L.ground === 'mountains' ? gRules.slice(1, 2) : desert ? gRules.slice(2, 3) : []),
    ],
    src: 'gr',
  });
  // A tk weapons densest on the most threatened tk apch, never spread evenly (IBB p 73; OoW Vol I p 26 in bulk; DW p 58)
  const tk = tank.length ? tank : ranked.slice(0, 1);
  const tkMain = tk[0] ?? null, tkRest = tk.slice(1);
  out.push({
    id: 'gr.ded.dp1.armr',
    draft: `Armr: in the protective dets, then in res. LAT: in the protective dets, then on the flk where the attk is expected. HAT: in the protective dets, then in bulk in the FDL gaps on the ${tkMain ? `${tkMain} ` : ''}tk apch, the most threatened${tkRest.length ? `; the ${list(tkRest)} only by what reaches it, never an even spread` : ''}. CAF (Rangers, FC, Mjd): the least threatened posn or depth, not split up. Engrs: mine laying, then with the protective dets, then res or the least threatened flk.`,
    state: 'judge',
    basis: [
      rule(`Emp of addl resources (${UA('5-6')})`),
      rule('Armr is employed concentrated, in the SZ battle and as the main element of the res (OoW Vol I p 21)'),
      rule('A tk wpns distributed for the greatest density at the most vital area, no attempt at an even distribution (IBB p 73); ATGMs used in bulk (OoW Vol I p 26)'),
      ...(desert ? gRules.slice(3, 4) : []),
      rule('Use of armr and ATGM if allotted is a head of the def plan (IBB S54 pp 281-282)'),
    ],
    src: 'gr',
  });
  return out;
}

/**
 * Advs and disadvs of the def as laid, under the book's heads (the Remarks of Understanding Aprc Sec II sheet 10), and the
 * pamphlet rules some of them rest on (`basis`).
 */
export function analysisDef(L: AprcDefLayout, r: AorReading, lim: AprcLimits): { adv: string[]; dis: string[]; basis: AprcBasis[] } {
  const adv: string[] = [], dis: string[] = [], basis: AprcBasis[] = [];
  if (!L.fdl) return { adv, dis, basis };
  const fk = L.fdlKm;
  if (lim.fwd && fk !== null) {
    if (fk >= 5 && fk <= 8) adv.push('Def is as far fwd as tac feasible, as no space is left to the En without fighting (Aim)');
    else if (fk > 8) dis.push(`Def is not as far fwd as tac feasible: ${h1(fk)} km from ${L.border} to Line ${L.fdl.id} given to the En from the outset (Aim)`);
    else dis.push(`FDLs only ${h1(fk)} km past ${L.border}: little room for the protective dets (Aim)`);
  }
  const np = lim.noPen ? r.lines.find((l) => l.id === lim.noPen) ?? null : null;
  if (np) {
    if (L.fdl === np) dis.push(`FDLs based on the line of no pen (Line ${np.id}) (Aim)`);
    else adv.push('The line of no pen is def well, as the FDLs are ahead of it (Aim)');
  }
  const dn = lim.denial ? r.lines.find((l) => l.id === lim.denial) ?? null : null;
  if (dn) {
    if (lineDepth(r, L.fdl) <= lineDepth(r, dn)) adv.push(`The integrity of the line of denial (Line ${dn.id}) is preserved: the def lies on or ahead of it (Aim)`);
    else dis.push(`FDLs behind the line of denial (Line ${dn.id}): its integrity not preserved from the outset (Aim)`);
    basis.push(rule('The line of denial given with the msn: the subordinate preserves its integrity; a threat to it is eliminated with max force (OoW Vol I pp 17-18)'));
  }
  if (lim.allCosts) {
    const nm = lim.allCosts.toLowerCase();
    const held = [L.fdl, L.depth, L.strPt].some((l) => l && (l.buas.some((b) => b && b.toLowerCase() === nm) || (l === L.strPt && r.mitg.name.toLowerCase() === nm)));
    if (held) adv.push(`${lim.allCosts} def eff, the FDLs ahead of it or made a str pt (Aim)`);
  }
  if (lim.attrition || lim.delayH) {
    if (L.ahead.length >= 2) adv.push(`Max attrition: the protective dets fight on successive lines (${L.ahead.map((l) => `Line ${l.id}`).join(', ')}) (Aim)`);
    else if (!L.ahead.length) dis.push('Max attrition difficult: no line ahead of the FDLs for the protective dets (Aim)');
  }
  if (L.fdl.obstacle) adv.push(`Def is based on the line with an eff obs, ${L.fdl.obstacle} (Lines of def)`);
  else {
    dis.push('Def is not based on an eff obs (Lines of def)');
    const deeper = r.lines.find((l) => l !== L.fdl && l.obstacle && (l.depthM ?? Infinity) > (L.fdl!.depthM ?? Infinity));
    if (deeper) dis.push(`A formidable obs, ${deeper.obstacle}, is left in depth (Lines of def)`);
  }
  if (L.detsWhere) adv.push('Sufficient space for the protective dets (Protective dets)');
  else dis.push('No space for protective dets (Protective dets)');
  const open = L.fdl.buas.map((b, i) => (b ? null : L.sides[i] ?? null)).filter((x): x is AorSide => !!x);
  if (L.fdl.buas.length && !open.length) adv.push(`All apchs eff covered: a BUA astride each on Line ${L.fdl.id} (Apchs)`);
  else if (open.length) dis.push(`No BUA astride the ${list(open)} apch on Line ${L.fdl.id}: held by fire and ptls only (Apchs)`);
  // a formation's addl line of def rests on a strong obs (OoW Vol I p 17 para 24 a); a unit's depth posns serve instead (para 24 e)
  if ((L.echelon === 'Bde' || L.echelon === 'Div') && L.depth && L.depth !== L.strPt) {
    if (L.depth.obstacle) adv.push(`The depth line (Line ${L.depth.id}) rests on an obs, ${L.depth.obstacle} (Lines of def)`);
    else dis.push(`The depth line (Line ${L.depth.id}) rests on no strong obs: an addl line of def wants a sufficiently strong natural obs, or the resources for an artificial one (Lines of def)`);
    basis.push(rule("A formation's addl line of def: a sufficiently strong natural obs behind the main posn, or the resources to create one; more than one line far enough apart that the En has to phase his op; at unit level the depth posns serve instead (OoW Vol I p 17 para 24)"));
  }
  if (L.coys?.ext) dis.push('FDLs over-stretched on an extended frontage: more chances of infil (Minor)');
  if (L.depthGapKm !== null && L.depthGapKm < 2) {
    dis.push(`Depth only ${h1(L.depthGapKm)} km behind the FDLs: the En can reach it in one ph (Minor)`);
    basis.push(rule('An En Bde attk goes in at least two phases to a depth of 2,000-3,000 m (IBB S57 para 17 p 312)'));
  }
  return { adv, dis, basis };
}

/**
 * Course A in the book's paragraph (Understanding Aprc p 11): def along the line, FDLs, depth, screens, protective
 * dets, res, C attk objs in pri, C pen posns, the bias of def and of A tk def, the timings. From the plan check's posns
 * when there is one, else a Coy to each BUA astride an apch. What the data cannot give is named for the planner.
 */
export function courseDef(L: AprcDefLayout, r: AorReading, o: { check: AprcCheckIn | null; prepFrom: string | null; readyBy: string | null }): { text: string; missing: string[] } | null {
  if (!L.fdl) return null;
  const { ranked, tank } = apchPri(r);
  const posn = (k: string): string[] => uniq((o.check?.posns ?? []).filter((p) => p.kind === k).map((p) => p.label));
  const fwd = posn('fwd'), dep = posn('depth'), res = posn('res'), cpen = posn('cpen');
  const s: string[] = [], missing: string[] = [];
  const coys = (n: number) => `${n} Coy${n === 1 ? '' : 's'}`;
  s.push(`Def along Line ${L.fdl.id}${alongOf(L.fdl)} (${L.fdl.name}).`);
  const fb = fwd.length ? fwd : uniq(L.fdl.buas);
  // the Coys up the frontage gives (DP 1), when the BUAs on the line are fewer: the rest on the line, not left out
  const more = !fwd.length && L.coys ? Math.max(0, L.coys.up - fb.length) : 0;
  if (fb.length) s.push(`FDLs comprising ${coys(fb.length + more)}, ${fb.length > 1 ? 'a Coy each in area' : 'in area'} ${list(fb)}${more ? ` and ${more === 1 ? 'one' : more} more on Line ${L.fdl.id}` : ''}.`);
  else s.push(`FDLs comprising ${coys(L.coys?.up ?? 3)} on Line ${L.fdl.id}.`);
  const db = dep.length ? dep : L.depth ? uniq(L.depth.buas) : [];
  if (db.length) s.push(`Depth comprising ${coys(db.length)}, ${db.length > 1 ? 'a Coy each in area' : 'in area'} ${list(db)}.`);
  else if (L.depth) s.push(`Depth on Line ${L.depth.id}.`);
  else missing.push('the depth');
  if (L.screenKm) s.push(`Screens ${h1(L.screenKm[0])}-${h1(L.screenKm[1])} km past ${L.border}, ahead of Line ${L.fdl.id}.`);
  if (L.detsWhere) s.push(`Protective dets ${L.detsWhere}.`);
  missing.push("the screens' and protective dets' composn", 'flk protection on the fall back of the covering tps');
  if (res.length) s.push(`Res in area ${list(res)}.`);
  else missing.push('the res: its composn and area');
  // C attk objs: the FDL localities, the most threatened apch's first
  const bySide = new Map<string, string>();
  L.fdl.buas.forEach((b, i) => {
    if (b && L.sides[i]) bySide.set(L.sides[i], b);
  });
  const catk = uniq([...ranked.map((sd) => bySide.get(sd)), ...L.fdl.buas]);
  if (catk.length) s.push(`C attk objs in order of pri: ${list(catk)}.`);
  s.push(cpen.length ? `C pen posns in area ${list(cpen)}.` : `C pen posn on the ${ranked[0] ?? 'most threatened'} apch behind Line ${L.fdl.id}.`);
  if (ranked.length) s.push(`Having bias of def towards the ${list(ranked.slice(0, 2))} apch${ranked.length > 1 ? 's' : ''}${tank.length ? ` and that of A tk def towards the ${list(tank)}` : ''}.`);
  if (o.prepFrom || o.readyBy) s.push(`Commencing prep of def by ${o.prepFrom ?? '__'} and completing def by ${o.readyBy ?? '__'}.`);
  else missing.push('the timings: commencing the prep and completing the def');
  return { text: s.join(' '), missing };
}

// ── the vis of the en op and the reactions (the def) ─────────────────────────────────────────────────────────────────

export interface AprcVisStep {
  ph: 'prep' | 'aslt' | 'catk';
  /** The en's action, "En is likely to ..." (no full stop). */
  en: string;
  own: string;
}

/**
 * The vis of the en op, tier by tier over the def as laid, at the guide's figures (Understanding Aprc pp 9-11; the
 * linear model Sec V pp 5-8): H is when the En crosses the border; the SZ is cleared at 1 km/h; a delay line holds 4 h
 * (6 along an obs or BUAs); the screens 1 h (best to the En; 1-1.5 h); the En probes the rest of the day lt and attks
 * after last lt, not before 2200 hrs and at least 2 h after contact; Ph 1 4 h, Ph 2 2 h, 12 h to recycle before the str
 * pt. Best to the En, worst to own: the earliest times (p 11). The own ctr actions are Anx A's (pp 27-28) for the table.
 */
export function visDef(L: AprcDefLayout, r: AorReading, o: { hMin: number | null; night: AprcNight | null }): { steps: AprcVisStep[]; basis: AprcBasis[]; quick: AprcVisStep | null } | null {
  if (!L.fdl || L.fdlKm === null) return null;
  const T = (t: number): string => (o.hMin !== null ? dClock(o.hMin + t) : hplus(t / 60));
  const { ranked } = apchPri(r);
  const main = ranked[0] ?? 'main';
  const mitg = mitgOf(r);
  const steps: AprcVisStep[] = [];
  steps.push({ ph: 'prep', en: 'En is likely to complete the assy before H', own: 'Bring HF on the En conc and gather max info on the En intentions' });
  steps.push({ ph: 'prep', en: `En is likely to cross ${L.border} ${ranked.length > 1 ? `on a broad front, on the ${list(ranked)} apchs,` : `on the ${main} apch`} at ${T(0)}`, own: 'Subj the En to arty DFs' });
  let t = 0, prev = 0;
  const dl = L.ahead.slice(0, 2);
  dl.forEach((l, i) => {
    const dk = (l.depthM ?? 0) / 1000;
    t += Math.max(0, dk - prev) * 60;
    steps.push({ ph: 'prep', en: `En is likely to contact the protective dets on Line ${l.id} (${l.name}) at ${T(t)}`, own: 'Protective dets open fire at long ranges to force the En to depl and impose delay' });
    const hold = l.obstacle || l.buas.some(Boolean) ? 6 : 4;
    t += hold * 60;
    const next = dl[i + 1];
    steps.push({ ph: 'prep', en: `Having tried to outflk them, failing which by a deliberate attk, En is likely to clear Line ${l.id} and resume the adv at ${T(t)}`, own: `Protective dets impose a delay of ${hold} h${l.obstacle ? ` along ${l.obstacle}` : ''}, then wdr${next ? ` to Line ${next.id}` : ' through the screens'}` });
    prev = dk;
  });
  if (L.screenKm) {
    const sk = (L.screenKm[0] + L.screenKm[1]) / 2;
    t += Math.max(0, sk - prev) * 60;
    steps.push({ ph: 'prep', en: `En is likely to contact the screens ahead of Line ${L.fdl.id} at ${T(t)}`, own: 'Screens engage at long ranges and wdr after a delay of 1-1.5 h' });
    t += 60;
    prev = sk;
  }
  t += Math.max(0, L.fdlKm - prev) * 60;
  const contact = t;
  let byDay: boolean | null = null;
  if (o.hMin !== null && o.night?.firstLt != null && o.night.lastLt != null) {
    const a = (((o.hMin + contact) % 1440) + 1440) % 1440;
    byDay = a >= o.night.firstLt && a < o.night.lastLt;
  }
  steps.push({ ph: 'aslt', en: `Having pushed back the screens, En is likely to contact the FDLs on Line ${L.fdl.id} at ${T(contact)}${byDay === false ? ', re-gp by ni and probe from first lt' : ' and use the remaining day lt hrs for probing and cfm recce'}`, own: 'Engage the En by arty fire; keep eff con of fire, not giving away the def layout' });
  // a quick attk off contact: for the reactions table, beside the guide's model (MIB pp 96-97: a Coy gp 30-60 min, a Bn gp 60-100 min)
  const qc = QUICK_ATTK.mib.Coy, qb = QUICK_ATTK.mib.Bn;
  const quick: AprcVisStep = { ph: 'aslt', en: `En is likely to try a quick attk on contact: a Coy gp ${qc[0]}-${qc[1]} min, a Bn gp ${qb[0]}-${qb[1]} min after it (from ${T(contact + qc[0])}, a Bn gp from ${T(contact + qb[0])})`, own: 'Engage the En FUP and BOF by arty and mor fire; the depth Pls ready for a local C attk' };
  let ta: number | null = null;
  if (o.hMin !== null) {
    const abs = o.hMin + contact + 120;
    let h = Math.floor(abs / 1440) * 1440 + 1320;
    if (h < abs) h += 1440;
    ta = h - o.hMin;
  }
  steps.push({ ph: 'aslt', en: `Having carried out cfm recce, En is likely to attk on the ${main} apch from an FUP short of Line ${L.fdl.id}, armr in CS or fire sp, at ${ta !== null ? T(ta) : 'after last lt, not before 2200 hrs'}`, own: 'On cfm of the dir of attk, re-adj; launch a spoiling attk on the En FUP from the standing ptls; bring arty and mor fire on the En BOF' });
  // the ground's own pattern of the En attk, beside the guide's linear model (MW pp 164-165; DW p 13)
  if (L.ground === 'mountains')
    steps.push({ ph: 'aslt', en: `En is likely to punish selected posts first and attk the feature covering the ${main} apch from multiple dirs, infiltrating to cut off own rft and C attk`, own: 'Link ptls between the posts and early warning on the routes in; reinforce from the less threatened localities; the routes to the posts from the rear secured' });
  if (L.ground === 'desert')
    steps.push({ ph: 'aslt', en: `En is likely to by-pass the localities and outflank the def, his armr round the open flk onto the depth and the adm areas`, own: 'Fight the battle outflanked: the str pts hold, adm self-sufficient; the res, mainly armr, employed early, within 2-6 h' });
  steps.push({ ph: 'aslt', en: `En is likely to breach the FDLs and take two Secs of the fwd Coy on the ${main} apch`, own: 'Call for DF (SOS); the Coy Comd launches a quick C attk by the depth Pl' });
  steps.push({ ph: 'catk', en: 'En is likely to take two Pls of the fwd Coy and widen the breach', own: 'Launch the C attk by the depth Coy (the Bn res)' });
  const p1 = ta !== null ? ta + 240 : null;
  steps.push({ ph: 'catk', en: `En is likely to hold the breach and complete Ph 1 on Line ${L.fdl.id}${p1 !== null ? ` by ${T(p1)}` : ' in about 4 h (6 against a str pt)'}`, own: `Occupy the C pen posn${ta !== null ? ` not later than ${T(ta + 90)} to ${T(ta + 120)}` : ' not later than 1.5-2 h after the En H'}` });
  let end = p1;
  if (L.depth && L.depth !== L.strPt) {
    const p2 = end !== null ? end + 120 : null;
    steps.push({ ph: 'catk', en: `En is likely to launch Ph 2 onto the depth on Line ${L.depth.id} (${L.depth.name})${p2 !== null ? ` and complete it by ${T(p2)}` : ', taking 2-3 h'}`, own: 'Give a tough fight; with the res create the conditions for launching the Bde res' });
    end = p2;
  }
  if (L.strPt) {
    const p3 = end !== null ? end + 720 : null;
    steps.push({ ph: 'catk', en: `After a pause of about 12 h to recycle the tps, En is likely to launch ${L.depth && L.depth !== L.strPt ? 'Ph 3' : 'Ph 2'} onto ${mitg}${p3 !== null ? ` at ${T(p3)}` : ''}, taking 6-8 h`, own: `Hold ${mitg}; cont to engage the En by fire` });
  }
  const basis: AprcBasis[] = [
    rule(`The En dev of op at the guide's figures: the SZ cleared at 1 km/h, a delay line held 4 h (6 along an obs or BUAs), the screens 1-1.5 h, the attk after last lt and not before 2200 hrs, Ph 1 4 h (6 against a str pt), later phases 2-3 h, 12 h to recycle before Ph 3 (${UA('9-11')}; the linear models ${UA('5-8', 'V')}); no pamphlet prints these`),
    rule(`Best to the En, worst to own: the earliest times; "En is likely to", never "En will"; no own response in the Vis (${UA('9, 11')})`),
    rule('Beside the 1 km/h: an Indian Inf Div, augmented, advances 25 km a day against light opposition (KYE 2019 p 216)'),
    rule("Beside the guide's phases: an En Bn's Ph 1 is not yet complete 1.5-2 h after H, a Bde's Ph 1 not over 3 h after H (IBB S57 para 11 p 310); an En Bde attk goes in at least two phases to a depth of 2,000-3,000 m, with time between them for own C attk or C pen (IBB S57 para 17 p 312)"),
    ...(L.ground === 'mountains' ? [rule('In mountains the En is likely to resort to selective punishment of certain posts; multidirectional attks on the important features, supported by infiltration to cut off own rft and C attk (MW pp 164-165); link ptls between the posts, the routes to them secured (MW p 164)')] : []),
    ...(L.ground === 'desert' ? [rule('In desert the defender should be prepared to fight the battle outflanked (DW p 13 para a); the res employed as early as possible, within 2-6 h (DW p 27); str pts adm self-sufficient (DW p 28)')] : []),
    ...(o.hMin !== null ? [input('H: the En crosses the border; the Vis counts from it (the en options count from the Threat marker)')] : []),
    calc("Distances: each line's distance past the border along the apchs (the AOR reading); the screens 1.25 km ahead of the FDLs"),
  ];
  return { steps, basis, quick };
}

/** The Vis of En Op as lettered sub-paras, and the en reactions / own ctr actions table in the 3 phases of the def battle. */
export function writeVisDef(v: { steps: AprcVisStep[]; basis: AprcBasis[]; quick?: AprcVisStep | null }, ipbRows: string[][] = [], planRows: string[][] = []): AprcPatch[] {
  const kids: AprcPara[] = v.steps.map((s, i) => para(`en.vis.${alpha(i)}`, null, { draft: `${s.en}.`, state: 'judge', basis: v.basis }));
  const rows: string[][] = [];
  let n = 0;
  const add = (a: string, b: string): void => void rows.push([`${alpha(n++)}.`, a, b]);
  const head = (t: string): void => void rows.push(['', t, '']);
  const strip = (r: string[]): [string, string] => [String(r[1] ?? ''), String(r[2] ?? '')];
  head('Prep Ph');
  const prep = v.steps.filter((s) => s.ph === 'prep');
  prep.slice(0, 2).forEach((s) => add(`${s.en}.`, `${s.own}.`));
  ipbRows.slice(0, 8).forEach((r) => add(...strip(r)));
  prep.slice(2).forEach((s) => add(`${s.en}.`, `${s.own}.`));
  head('Aslt Ph');
  v.steps.filter((s) => s.ph === 'aslt').forEach((s, i) => {
    add(`${s.en}.`, `${s.own}.`);
    if (i === 0 && v.quick) add(`${v.quick.en}.`, `${v.quick.own}.`);
  });
  head('C Attk Ph');
  v.steps.filter((s) => s.ph === 'catk').forEach((s) => add(`${s.en}.`, `${s.own}.`));
  planRows.slice(0, 8).forEach((r) => add(...strip(r)));
  const basis: AprcBasis[] = [
    rule(`Own ctr actions in the 3 phases of the conduct of the def battle: prep, aslt, C attk (${UA(13)}); the sequence of the guide's Anx A (${UA('27-28')})`),
    rule('The C pen posn occupied before the fwd localities are overrun: within a Bn not later than 1.5-2 h after the En H, within a Bde 3 h (IBB p 310)'),
    ...(v.quick ? [rule(QUICK_TEXT)] : []),
    ...(ipbRows.length ? [rule('The decision support rows: a decision taken while the En is at least 2 hrs from the TAI (IPB book p 30)')] : []),
    ...(planRows.length ? [calc('The what-if of the plan check: the En time along the approach at the IPB rates against each own move')] : []),
    ...v.basis.slice(0, 1),
  ];
  return [
    { id: 'en.vis', draft: '', state: 'judge', basis: v.basis, children: kids, src: 'gr' },
    { id: 'crs.react', draft: '', state: 'judge', table: { head: ['Ser', 'En Reactions', 'Own Ctr Actions'], rows, widths: [0.08, 0.46, 0.46] }, basis, src: 'en' },
  ];
}

// ── time and space (the def) ─────────────────────────────────────────────────────────────────────────────────────────

export interface AprcTsDefIn {
  lim: AprcLimits;
  /** The En H, minutes on D Day, or null. */
  hMin: number | null;
  nowMin: number | null;
  night: AprcNight | null;
  zone: string;
  moveH: number | null;
  prepH: number | null;
  minesH: number | null;
  /** The Time Req's critical path, hours. */
  reqH: number | null;
}

const hhmm = (m: number): string => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}${String((((m % 1440) + 1440) % 1440) % 60).padStart(2, '0')}`;

/**
 * Time Data with first and last lt and the time aval split into day lt and ni hrs, the time the def is to be ready (the
 * aim's, else the last lt before the En attk, Understanding Aprc p 8), the essential timings back from it and the
 * deductions when the time aval is less or more than the time req (Sec II sheet 7; Sec IV pp 7-8).
 */
export function writeTsDef(t: AprcTsDefIn): { patches: AprcPatch[]; readyMin: number | null; prepFromMin: number | null } {
  const out: AprcPatch[] = [];
  const fl = t.night?.firstLt ?? null, ll = t.night?.lastLt ?? null;
  if (t.nowMin !== null) out.push({ id: 'ts.data.time-now', draft: `${dClock(t.nowMin)}.`, state: 'map', basis: [input('Time now, as set on the sheet')], src: 'time' });
  const lightBasis = calc(`The sun 6 degrees below the horizon, worked out from the date and the place; times in ${t.zone}`);
  if (fl !== null) out.push({ id: 'ts.data.first-lt', draft: `${hhmm(fl)} hrs${t.night?.light.date ? ` (${t.night.light.date})` : ''}.`, state: 'gr', basis: [lightBasis], src: 'time' });
  if (ll !== null) out.push({ id: 'ts.data.last-lt', draft: `${hhmm(ll)} hrs${t.night?.light.date ? ` (${t.night.light.date})` : ''}.`, state: 'gr', basis: [lightBasis], src: 'time' });
  let ready = parseDTime(t.lim.by ?? null);
  if (ready !== null) out.push({ id: 'ts.data.time-by-which-def-to-be-ready', draft: `${dClock(ready)}: the aim's limitation.`, state: 'map', basis: [input("The aim's limitation, as set")], src: 'time' });
  else if (t.hMin !== null && ll !== null) {
    ready = lastLtBefore(t.hMin, ll);
    out.push({ id: 'ts.data.time-by-which-def-to-be-ready', draft: `By the last lt before the En attk: ${dClock(ready)} (the En H ${dClock(t.hMin)}).`, state: 'judge', basis: [rule(`No time given for the def to be ready but the En attk's time frame given: def ready by the last lt before it (${UA(8)})`)], src: 'time' });
  }
  if (t.nowMin !== null && ready !== null && ready > t.nowMin && fl !== null && ll !== null) {
    const dn = dayNight(t.nowMin, ready, fl, ll);
    out.push({ id: 'ts.data.total-time-aval', draft: `${h1((ready - t.nowMin) / 60)} h: ${h1(dn.day)} h of day lt and ${h1(dn.ni)} h of ni.`, state: 'judge', basis: [calc('From time now to the time the def is to be ready, split at first and last lt')], src: 'time' });
  }
  let prepFrom: number | null = null;
  if (ready !== null) {
    const main = t.prepH !== null ? ready - t.prepH * 60 : null;
    const move = main !== null ? main - (t.moveH ?? 0) * 60 : null;
    const bp = move !== null ? move - BATTLE_PROC_H * 60 : null;
    prepFrom = main;
    const bits: string[] = [];
    if (bp !== null) bits.push(`battle procedure to start by ${dClock(bp)}`);
    if (move !== null && t.moveH) bits.push(`mov from the conc A to the FDLs by ${dClock(move)}`);
    if (main !== null) bits.push(`prep of the main def from ${dClock(main)}`);
    bits.push(`prep of the screens from ${dClock(ready - 12 * 60)}`);
    if (t.minesH !== null) bits.push(`M fd laying from ${dClock(ready - t.minesH * 60)}`);
    bits.push(`def ready by ${dClock(ready)}`);
    // the first thing that must start: the battle procedure, or the M fd laying when the Engrs need longer
    const mines = t.minesH !== null ? ready - t.minesH * 60 : null;
    const first = [bp !== null ? { at: bp, what: 'the battle procedure' } : null, mines !== null ? { at: mines, what: 'the M fd laying' } : null].filter((x): x is { at: number; what: string } => !!x).sort((x, y) => x.at - y.at)[0] ?? null;
    const tail = t.nowMin !== null && first ? (first.at >= t.nowMin ? ` In time: ${dur(first.at - t.nowMin)} to spare from time now.` : ` Short by ${dur(t.nowMin - first.at)}: ${first.what} should have started at ${dClock(first.at)}; work in parallel, or ask for more time, tps or Engrs.`) : '';
    out.push({
      id: 'ts.ded.dp',
      draft: `Essential timings: ${bits.join('; ')}.${tail}`,
      state: 'judge',
      basis: [rule('A Bn needs at least 36 working hours to prepare its posns; Inf subunits about 12 h (OoW Vol I p 39)'), rule(`Battle procedure 12 h, the screens 12 h: the guide's specimen (${UA(7, 'II', true)})`), calc('Back from the time the def is to be ready')],
      src: 'time',
    });
    if (t.nowMin !== null && t.reqH !== null) {
      const aval = (ready - t.nowMin) / 60;
      const less = aval < t.reqH;
      out.push({
        id: 'ts.ded.common',
        draft: less
          ? `Less time aval (${h1(aval)} h against ${Math.round(t.reqH)} h on the critical path): prep the depth and C pen posns and lay mines round them by day; dig the FDLs, screens and delay lines at once; cut rest and adm and the rehearsals of C attk and C pen; cam and clt, OHP and F of F by day. Pri of work: digging, mining, clearance of F of F, cam and clt, rehearsals. Ask the Bde Comd for addl resources.`
          : `More time aval (${h1(aval)} h against ${Math.round(t.reqH)} h on the critical path): more time to cam and clt, the clearance of F of F and the rehearsals of C attk and C pen; the Coy Comds recce with the CO after a detailed wng O.`,
        state: 'judge',
        basis: [rule(`Less / more time aval, pri of work (${UA('7-8', 'IV')}; ${UA(7, 'II', true)})`), calc('Time aval = time now to def ready; time req = the Time Req critical path')],
        src: 'time',
      });
    }
  }
  return { patches: out, readyMin: ready, prepFromMin: prepFrom };
}

// ── time and space (the withdrawal) ──────────────────────────────────────────────────────────────────────────────────

export interface AprcTsWdrIn {
  lim: AprcLimits;
  nowMin: number | null;
  /** The night of D Day: the wdr is taken to be made on it (last lt D Day to first lt D+1). */
  night: AprcNight | null;
  zone: string;
  echelon: string;
}

/**
 * The new posn's prep by echelon: "A battalion needs a minimum of 36 working hours for preparing positions to meet a
 * full-scale attack ... Infantry subunits can complete their defence in about 12 hours" (OoW Vol I p 39); a Bde's Bns
 * prep at once, 36 h.
 */
export const WDR_PREP_H: Record<string, number> = { Coy: 12, Bn: 36, Bde: 36 };
const WDR_PREP_TEXT: Record<string, string> = {
  Coy: 'Inf subunits complete their def in about 12 hrs (OoW Vol I p 39)',
  Bn: 'A Bn needs at least 36 working hrs to prep its posns to meet a full-scale attk (OoW Vol I p 39)',
  Bde: "A Bn needs at least 36 working hrs to prep its posns to meet a full-scale attk (OoW Vol I p 39); a Bde's Bns prep at once",
};

/**
 * The withdrawal's Time and Space (OoW Vol III pp 9-10 para 6; the timings pp 18-19 paras 16-18): the time data from the
 * aim's limitations and the night of D Day (first lt is D+1's, the end of the ni of the wdr), the Time Req with the new
 * posn's prep (OoW Vol I p 39), the essential timings with their checks (finish before daylight, p 44 para 1; mov to the
 * rear in darkness, p 13 para 10c(2)), the choice of ni or day and the sequence (pp 41, 44). The new posn is to be ready
 * before the tps disengage from the old (p 24 para 1), or once the covering tps have held the En fwd of it for the delay
 * set (p 10 para 6c; p 31 para 9b): its prep starts that many working hrs before.
 */
export function writeTsWdr(t: AprcTsWdrIn): { patches: AprcPatch[]; readyMin: number | null; prepFromMin: number | null } {
  const out: AprcPatch[] = [];
  const L = t.lim;
  const given = input("The aim's limitation, as set");
  const fl = t.night?.firstLt ?? null, ll = t.night?.lastLt ?? null;
  const dawn = fl !== null ? 1440 + fl : null;
  const date = t.night?.light.date ? ` (D Day ${t.night.light.date})` : '';
  const lightBasis = calc(`The sun 6 degrees below the horizon, worked out from the date and the place; times in ${t.zone}`);
  const deny = parseDTime(L.deny ?? null), noMov = parseDTime(L.noMovBefore ?? null), clear = parseDTime(L.clearBy ?? null);
  const byNi = !L.byDay;

  // time data
  if (t.nowMin !== null) out.push({ id: 'ts.data.time-now', draft: `${dClock(t.nowMin)}.`, state: 'map', basis: [input('Time now, as set on the sheet')], src: 'time' });
  if (deny !== null) out.push({ id: 'ts.data.deny', draft: `${dClock(deny)}.`, state: 'map', basis: [given, rule('Laid down by the highest comd controlling the wdr (OoW Vol III p 19 para 17a)')], src: 'time' });
  if (noMov !== null) out.push({ id: 'ts.data.no-mov', draft: `${dClock(noMov)}.`, state: 'map', basis: [given, rule('OoW Vol III p 19 para 17b')], src: 'time' });
  else if (ll !== null && byNi) out.push({ id: 'ts.data.no-mov', draft: `${dClock(ll)}, the last lt.`, state: 'judge', basis: [rule('All mov to the rear except routine tfc during the hrs of darkness (OoW Vol III p 13 para 10c(2))'), lightBasis], src: 'time' });
  if (clear !== null) out.push({ id: 'ts.data.clear', draft: `${L.clearLine ? `${L.clearLine}: ` : ''}${dClock(clear)}.`, state: 'map', basis: [given, rule('OoW Vol III p 19 para 17c')], src: 'time' });
  if (ll !== null) out.push({ id: 'ts.data.last-lt', draft: `${dClock(ll)}${date}.`, state: 'gr', basis: [lightBasis], src: 'time' });
  if (dawn !== null) out.push({ id: 'ts.data.first-lt', draft: `${dClock(dawn)}, the end of the ni of D Day.`, state: 'gr', basis: [lightBasis], src: 'time' });
  if (ll !== null && dawn !== null) out.push({ id: 'ts.data.dark', draft: `${h1((dawn - ll) / 60)} h on the ni of D Day.`, state: 'gr', basis: [lightBasis], src: 'time' });

  // time req: the new posn's prep, the rest no figure printed
  const prepH = WDR_PREP_H[t.echelon] ?? WDR_PREP_H.Bn;
  const prepText = WDR_PREP_TEXT[t.echelon] ?? WDR_PREP_TEXT.Bn;
  out.push({
    id: 'ts.req',
    draft: '',
    state: 'judge',
    table: {
      head: ['S/No', 'Activity', 'Time (hrs)', 'Remarks'],
      rows: [
        ['a.', 'Prep of the new def posn', String(prepH), prepText],
        ['b.', 'Recce of the new posn, by daylight', '', 'No figure printed (OoW Vol III p 20 para 19c)'],
        ['c.', 'Prep of dmls and obs', '', 'No figure printed: considerable time, the planning to start at the earliest (OoW Vol III p 14 para 11b)'],
        ['d.', 'Thinning out to the final abandonment', '', 'No figure printed: timings not tight, each phase allowed to complete (OoW Vol III p 19 para 16)'],
        ['e.', 'Mov back to the new posn', '', 'From the dist on the Gr and the terrain friction (OoW Vol III pp 9-10 para 6)'],
      ],
      widths: [0.08, 0.34, 0.12, 0.46],
    },
    basis: [rule(prepText), rule('The dist between the orig and the new def posn and the time needed to prep the latter calculated carefully (OoW Vol III p 10 para 6b)')],
    src: 'time',
  });

  // essential timings, back from the time the new posn is to be ready
  const ready = deny !== null ? deny + (L.delayH ? L.delayH * 60 : 0) : null;
  const prepFrom = ready !== null ? ready - prepH * 60 : null;
  const bits: string[] = [];
  const notes: string[] = [];
  const firstMov = noMov ?? (byNi ? ll : null);
  if (firstMov !== null) bits.push(`no rearward mov except recce parties before ${dClock(firstMov)}`);
  if (prepFrom !== null && ready !== null) bits.push(`prep of the new def posn to start not later than ${dClock(prepFrom)}, ${prepH} hrs before it is to be ready at ${dClock(ready)}${L.delayH ? ` (the posn denied until ${dClock(deny!)} and the En held fwd of the new posn ${L.delayH} hrs)` : ' (when the tps disengage from the posn)'}`);
  if (deny !== null) bits.push(`posn denied until ${dClock(deny)}, then finally abandoned`);
  if (clear !== null) bits.push(`all tps clear of ${L.clearLine ?? 'the line given'} by ${dClock(clear)}`);
  if (byNi && ll !== null && dawn !== null) {
    const from = Math.max(firstMov ?? ll, ll), to = Math.min(clear ?? dawn, dawn);
    if (to > from) bits.push(`${h1((to - from) / 60)} h of darkness for the mov back, ${dClock(from)} to ${dClock(to)}`);
    const end = clear ?? deny;
    if (end !== null && end > dawn) notes.push(`${clear !== null ? 'All tps clear' : 'The posn abandoned'} at ${dClock(end)}, after first lt (${dClock(dawn)}): a ni wdr is to finish before daylight (OoW Vol III p 44 para 1); else it is a wdr by day, normally avoided (p 40 para 1)`);
    if (deny !== null && deny < ll) notes.push(`The posn abandoned at ${dClock(deny)}, before last lt (${dClock(ll)}): its final abandonment by day`);
    if (noMov !== null && noMov < ll) notes.push(`Rearward mov from ${dClock(noMov)}, before last lt: all mov to the rear except routine tfc in the hrs of darkness (OoW Vol III p 13 para 10c(2))`);
  }
  if (prepFrom !== null && t.nowMin !== null)
    notes.push(prepFrom >= t.nowMin ? `In time: ${dur(prepFrom - t.nowMin)} to spare from time now to start the prep of the new posn` : `Short by ${dur(t.nowMin - prepFrom)}: the prep of the new posn should have started at ${dClock(prepFrom)}; fresh tps, or a larger portion sent back to dig and lay mines (OoW Vol III p 39 para 2), or ask for more time`);
  if (bits.length)
    out.push({
      id: 'ts.ded.timings',
      draft: `Essential timings: ${bits.join('; ')}.${notes.length ? ` ${notes.map((x) => `${x}.`).join(' ')}` : ''}`,
      state: 'judge',
      basis: [
        rule('The time up to which a posn is denied, no rearward mov except recce parties before, all tps clear of a line by: laid down by the highest comd (OoW Vol III p 19 para 17); the final abandonment and thinning out by the subordinate comds (p 19 para 18)'),
        rule('The next posn in the rear ready before the tps disengage from the former (OoW Vol III p 24 para 1); the covering tps delay the En fwd of the new posn for a specified period (p 31 para 9b); the higher comd specifies the delay (p 10 para 6c)'),
        rule(prepText),
        ...(byNi ? [rule('A ni wdr starts so as to finish before daylight (OoW Vol III p 44 para 1); all mov to the rear except routine tfc in the hrs of darkness (p 13 para 10c(2))')] : []),
        calc('The new posn ready at the time the posn is denied till, plus the delay set fwd of the new posn; its prep started that many hrs before'),
      ],
      src: 'time',
    });

  // ni or day, and the sequence (the book's)
  if (ll !== null && dawn !== null && t.night) {
    const n = t.night;
    const span = (x: { from: number; to: number }): string => `${hhmm(x.from)}-${hhmm(x.to)}`;
    const lit = n.spans.filter((x) => x.moon), dark = n.spans.filter((x) => !x.moon);
    const moon = `The moon ${n.moonPct} % lit${lit.length ? `, up ${lit.map(span).join(' and ')} hrs, dark ${dark.length ? `${dark.map(span).join(' and ')} hrs` : 'at no time'}` : ', too low or too thin to light the ni'}.`;
    const ni = `${h1((dawn - ll) / 60)} h of darkness on the ni of D Day, last lt ${dClock(ll)} to first lt ${dClock(dawn)}`;
    out.push({
      id: 'gr.ded.time',
      draft: byNi ? `By ni: ${ni}; the wdr to start so as to finish before first lt. ${moon}` : `By day, as given: normally avoided unless the weather or the Rds favour or need it; air sp at least for the critical stages, smk, deception and fire sp. The ni of D Day: ${ni}. ${moon}`,
      state: 'judge',
      basis: [rule(byNi ? 'A ni wdr usually preferred, for secrecy, surprise and fewer cas; it starts so as to finish before daylight (OoW Vol III pp 43-44 para 1)' : 'A daylight wdr normally avoided unless the weather or the Rds favour or need it (OoW Vol III p 40 para 1); own air, smk, deception and fire sp (pp 42-43 paras 4, 8)'), lightBasis, calc('The moon worked out from the date and the place: moonlight while it is 5 degrees up and a quarter lit (OcokaDoctrine light); what it means for the wdr is yours')],
      src: 'time',
    });
  }
  out.push({
    id: 'plan.exec.seq',
    draft: byNi
      ? `By ni: a. recce parties for the rear posns and the routes back${firstMov !== null ? `, the only rearward mov before ${dClock(firstMov)}` : ''}; b. AD depl at the pts likely to be attacked; c. non-essential vehs, eqpt and tps back; d. tps not in contact; e. all but the rear parties, who hold the posn till the time ordered${deny !== null ? ` (${dClock(deny)})` : ''}; the posn finally abandoned, the last tps with clear routes back.`
      : 'By day: recce parties, AD and the non-essentials back first, as by ni; then the tps in contact go back through own depth posns, the fwd tps not in contact covering them, leap-frogging till a clean break; through the covering tps, else the intmed posns; units straight back into columns without halting, no assy areas.',
    state: 'judge',
    basis: [rule(byNi ? 'The sequence of a ni wdr (OoW Vol III p 44 para 2)' : 'The sequence by day, almost the reverse of the ni wdr except its first three steps (OoW Vol III p 41 para 2)'), ...(firstMov !== null || deny !== null ? [calc('Times from the essential timings above')] : [])],
    src: 'time',
  });
  return { patches: out, readyMin: ready, prepFromMin: prepFrom };
}

// ── the aim ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The aim with its limitations tabulated (Understanding Aprc pp 7-8, 22; Mechs of Aprc (Attk) p 1). Nothing set: nothing written. */
export function writeAim(kind: AprcKind, lim: AprcLimits, o: { place: string; hMin: number | null; lastLt: number | null; turn: string | null; readyDerived: number | null }): AprcPatch[] {
  const kids: AprcPara[] = [];
  const given = input("The aim's limitations, as set in the Aim's panel");
  const kid = (id: string, text: string, state: 'map' | 'judge' = 'map', basis: AprcBasis[] = [given]): void => void kids.push(para(id, null, { draft: text, state, basis }));
  const by = parseDTime(lim.by ?? null);
  if (kind === 'def') {
    if (lim.fwd) kid('aim.fwd', 'Def to be as far fwd as tac feasible.');
    if (lim.noPen) kid('aim.nopen', `No pen beyond Line ${lim.noPen}.`);
    if (lim.denial) kid('aim.denial', `Integrity of Line ${lim.denial}, the line of denial, to be preserved.`, 'map', [given, rule('The line of denial is spelt out when assigning the msn; the subordinate comds are responsible to preserve its integrity (OoW Vol I pp 17-18)')]);
    if (lim.allCosts) kid('aim.allcosts', `${lim.allCosts} to be def at all costs.`);
    if (lim.attrition) kid('aim.attr', 'Cause max attrition / delay onto the En.');
    if (lim.delayH) kid('aim.delay', `Delay the En for ${lim.delayH} hrs.`);
    if (lim.maxCoys) kid('aim.coys', `Not more than ${lim.maxCoys} Coys to be used.`);
    if (by !== null) kid('aim.by', `Def to be ready by ${dClock(by)}.`);
    else if (o.readyDerived !== null && o.hMin !== null) kid('aim.by', `Def to be ready by ${dClock(o.readyDerived)}, the last lt before the En attk.`, 'judge', [rule(`No time given for the def to be ready, the En attk's given: def ready by the last lt before it (${UA(8)})`)]);
  } else if (kind === 'wdr') {
    const deny = parseDTime(lim.deny ?? null), noMov = parseDTime(lim.noMovBefore ?? null), clear = parseDTime(lim.clearBy ?? null);
    const p19 = (x: string): AprcBasis[] => [given, rule(`Laid down by the highest comd controlling the wdr (OoW Vol III p 19 para 17${x})`)];
    if (deny !== null) kid('aim.deny', `Posn to be denied to the En until ${dClock(deny)}.`, 'map', p19('a'));
    if (noMov !== null) kid('aim.nomov', `No rearward mov except recce parties before ${dClock(noMov)}.`, 'map', p19('b'));
    if (clear !== null || lim.clearLine) kid('aim.clear', `All tps to be clear of ${lim.clearLine ?? 'the line given'}${clear !== null ? ` by ${dClock(clear)}` : ''}.`, 'map', p19('c'));
    if (lim.delayH) kid('aim.delay', `Delay the En fwd of the new def posn for ${lim.delayH} hrs.`, 'map', [given, rule('The higher comd normally specifies how much delay is to be imposed and the limits of the area for it (OoW Vol III p 10 para 6c)')]);
    if (lim.byDay) kid('aim.day', 'Wdr to be carried out by day.', 'map', [given, rule('A daylight wdr normally avoided unless the weather or the Rds favour or need it (OoW Vol III p 40 para 1)')]);
  } else {
    if (lim.destr) {
      kid('aim.destr', 'Ensure max destr of the En in the process.');
      kid('aim.wdr', `Prevent the wdr or rft of the En from area ${o.place}${o.turn ? `: block at ${o.turn} before the attk` : ''}.`, 'map', [given, rule(`Cause max destr: block the En routes of wdr before the attk is launched (${UA(22)}); no "be prep" task (${UA(20)})`)]);
    }
    if (by !== null) kid('aim.by', `Area to be captured by ${dClock(by)}.`);
    if (lim.night) kid('aim.ni', 'Attk to be conducted at ni.');
  }
  (lim.other ?? []).forEach((t, i) => kid(`aim.other-${i + 1}`, /[.!?]$/.test(t) ? t : `${t}.`));
  if (kind === 'wdr') {
    // the MITG of a wdr Read is the new def posn; the posn the higher comd gives wins
    const to = lim.newPosn ? `the new def posn at ${lim.newPosn}` : o.place && o.place !== '__' && o.place !== 'MITG' ? `the new def posn at ${o.place}` : 'the new def posn';
    const head = `To wdr to ${to} and occupy it with the min of interference from the En and the min of cas`;
    const basis = [rule('The immediate aim of a wdr: to occupy the new def posn with the min of interference from the En and the min of cas (OoW Vol III p 3 para 7a)'), rule(`The aim starts with "To", its limitations tabulated (${UA('7-8')})`), ...(lim.newPosn ? [given] : [])];
    if (!kids.length) return lim.newPosn ? [{ id: 'aim', draft: `${head}.`, state: 'judge', basis, children: [], src: 'aim' }] : [];
    return [{ id: 'aim', draft: `${head}, with fol limitations:-`, state: 'judge', basis, children: kids, src: 'aim' }];
  }
  if (!kids.length) return [];
  const object = kind === 'def' ? (lim.salient ? `the ${o.place} salient` : 'the given AOR') : `area ${o.place}`;
  return [{ id: 'aim', draft: `To ${kind === 'def' ? 'def' : 'capture'} ${object} with fol limitations:-`, state: 'judge', basis: [rule(`The aim starts with "To", its limitations tabulated; a limitation leaves no practical variant, a msn essential does (${kind === 'def' ? UA('7-8') : UA(22)})`)], children: kids, src: 'aim' }];
}

// ── the attack: the apchs on the book's planning parameters ──────────────────────────────────────────────────────────

export interface AprcApchTests {
  table: AprcTable;
  /** Per own side: what speaks for it and against it. */
  adv: Partial<Record<AorSide, string[]>>;
  dis: Partial<Record<AorSide, string[]>>;
  /** Own sides with the most in their favour. */
  best: AorSide[];
  confirm: string[];
  basis: AprcBasis[];
}

/**
 * Each apch onto the obj tested on Understanding Aprc's planning parameters (pp 16-17): the FUP in own area; a BUA in
 * Ph 1; Ph 1 ending on a distinguishable feature; the MITG in Ph 1; a Pl or more seen near it; room for the force (IPB
 * book p 7, the pamphlet). The reading was taken round the obj from own side: its sides are the en's, its lines his.
 */
export function apchTestsAttk(r: AorReading, o: { fupM: number; echelon: string; enNear: Partial<Record<AorSide, string[]>> }): AprcApchTests | null {
  const present = SIDES.filter((s) => r.apchs.some((a) => a.side === s));
  if (!present.length) return null;
  const own = (['Lt', 'Cen', 'Rt'] as AorSide[]).filter((s) => present.includes(MIRROR[s]));
  const fdl = r.lines.find((l) => l.role === 'FDLs') ?? null;
  const dep = r.lines.find((l) => l.role === 'Depth') ?? null;
  const mitg = r.mitg.name;
  const buaOn = (l: AorDefLine | null, rs: AorSide): string | null => {
    if (!l) return null;
    const i = present.indexOf(rs);
    return i >= 0 ? l.buas[i] ?? null : null;
  };
  const width = o.echelon === 'Div' ? 6000 : o.echelon === 'Bde' ? 3000 : o.echelon === 'Coy' ? 500 : 1500;
  const adv: Partial<Record<AorSide, string[]>> = {}, dis: Partial<Record<AorSide, string[]>> = {};
  const score: Partial<Record<AorSide, number>> = {};
  const rows: string[][] = [
    ['a.', 'FUP in own area'], ['b.', 'BUA in Ph 1'], ['c.', 'Ph 1 ends on a distinguishable feature'], ['d.', 'MITG captured in Ph 1'],
    ['e.', 'A Pl or more of the En seen near it'], ['f.', `Room for the force (${o.echelon}, ${km(width)} km)`],
  ];
  const confirm: string[] = [];
  for (const s of own) {
    const rs = MIRROR[s];
    const a = r.apchs.find((x) => x.side === rs)!;
    const ad: string[] = (adv[s] = []), di: string[] = (dis[s] = []);
    let sc = 0;
    if (!a.cross) rows[0].push('No border on it');
    else if (a.pastM <= o.fupM) {
      rows[0].push(`Yes: ${km(a.pastM)} km past the border, the FUP ${km(o.fupM)} km short on own side`);
      ad.push('FUP in own area');
      sc++;
    } else {
      rows[0].push(`No: the FUP ${km(a.pastM - o.fupM)} km inside the En area`);
      di.push(`FUP in the open, in En terr (${km(a.pastM - o.fupM)} km inside)`);
    }
    const b = buaOn(fdl, rs);
    if (b && b !== mitg) {
      rows[1].push(`Yes: ${b}: not to be adopted if 500 x 500 m or more of pakka houses`);
      di.push(`BUA ${b} in Ph 1`);
      confirm.push(`${b} (the ${s} apch, Ph 1): is it 500 x 500 m or more of pakka houses? If so, do not adopt that apch (${UA(17)}).`);
    } else {
      rows[1].push('None');
      ad.push('BUA avoided in Ph 1');
      sc++;
    }
    const feat = fdl ? fdl.obstacle ?? (fdl.lateral ? 'a lateral Rd' : null) : null;
    if (feat) {
      rows[2].push(`Yes: ${feat}`);
      ad.push(`Ph 1 ends on ${feat}, a distinguishable feature`);
      sc++;
    } else rows[2].push(fdl ? 'No' : '?');
    const first = buaOn(fdl, rs) ?? buaOn(dep, rs);
    if (!first || first === mitg) {
      rows[3].push('Yes: no En locality before it on this apch');
      ad.push('Capturing the MITG in Ph 1');
      sc++;
    } else {
      rows[3].push(`No: ${first} first`);
      di.push(`${first} to be taken before the MITG`);
    }
    const seen = o.enNear[rs] ?? [];
    if (seen.length) {
      rows[4].push(`Yes: ${list(seen.slice(0, 3))}: discard it`);
      di.push(`En seen on it (${list(seen.slice(0, 3))})`);
      sc -= 2;
    } else rows[4].push('None marked');
    if (a.minWidthM >= width) {
      rows[5].push(`Yes: ${km(a.minWidthM)} km at the narrowest`);
      sc++;
    } else {
      rows[5].push(`No: narrows to ${km(a.minWidthM)} km`);
      di.push(`Narrows to ${km(a.minWidthM)} km`);
    }
    score[s] = sc;
  }
  const top = Math.max(...own.map((s) => score[s] ?? 0));
  const basis: AprcBasis[] = [
    rule(`Planning parameters for the choice of apch (${UA('16-17')}): the FUP can be in own area, adopt that apch; a minor force or ptl does not discard an apch, a Pl or more seen on it does; a BUA (500 x 500 m or more of pakka houses) in the first ph, do not adopt it; the initial ph ending on a distinguishable feature (Rly line, Rd, bund), adopt it; the MITG in Ph 1 preferred; a linear En, the most objs in Ph 1; a salient, cut its base`),
    rule('FUP 1,000-1,200 m short of the obj (IBB p 201); beside it, the guide: 1,000-1,500 m (Understanding Aprc p 20)'),
    rule('Mobility corridor widths: a Coy 500 m, a Bn 1.5 km, a Bde 3 km, a Div 6 km (IPB book p 7)'),
    calc("The En's first line: the BUAs astride the apchs on the line a defender of the MITG would hold (the AOR reading); the En seen: unit symbols of a Pl or more within 1 km of the apch"),
  ];
  return {
    table: { head: ['Ser', 'Test', ...own.map((s) => `${s} Apch`)], rows, widths: [0.07, 0.29, ...own.map(() => 0.64 / own.length)] },
    adv,
    dis,
    best: own.filter((s) => (score[s] ?? 0) === top),
    confirm,
    basis,
  };
}

// ── the attack: the time calc ────────────────────────────────────────────────────────────────────────────────────────

/** Minutes of each step, a Coy's (Mechs of Aprc (Attk) p 14 specimen; p 5 phases) and a Bn's (Understanding Aprc pp 21, 24). */
export const ATTK_FIG = {
  coy: { final: 60, unf2: 10, fight2: 30, fight2Hard: 45, sl2: 5, stay2: 5, reorg1: 20, unf1: 10, fight1: 30, fight1Hard: 45, fup1: 10, stay: 5, faa: 90, unf0: 20, rest: 360, recce: 600 },
  bn: { final: 40, unf2: 20, fight2: 60, fight2Hard: 90, sl2: 12, stay2: 5, reorg1: 20, unf1: 15, fight1: 90, fight1Hard: 120, fup1: 28, stay: 5, faa: 120, unf0: 10, rest: 720, recce: 1440 },
};

export interface AprcTimeCalcIn {
  echelon: string;
  /** Own H, minutes on D Day, or null. */
  hMin: number | null;
  /** The msn to be accomplished by (D-time minutes), or null. */
  msnBy: number | null;
  nowMin: number | null;
  hsum: AprcHSumIn | null;
  phases: 1 | 2;
  bunkers: boolean;
  /** The FUP's distance short of the obj (the IPB reading's), m. */
  fupM: number | null;
  night: AprcNight | null;
  /** A quick attk from contact: contact to H by the books (MIB p 89, Annex L; IBB p 133) in place of the deliberate rows. */
  quick?: boolean;
  /** The climb from the SL to the obj, m (mountains): the slant and the climb's time on the assault (MW Annex F pp 311-313). Typed: it wins over `climbRead`. */
  climbM?: number | null;
  /** The climb read off the 30 m elevation through the Ground Guide (in mountains): from the SL, else the FUP, to the obj. */
  climbRead?: AprcClimb | null;
}

/** A climb read off the ground: metres up from `from` to `to` (both in words), `horizM` apart on the map. */
export interface AprcClimb {
  m: number;
  horizM: number;
  from: string;
  to: string;
}

export interface AprcTimeCalc {
  table: AprcTable;
  /** Start of each row, minutes from H (null: not known); H itself as a D-time (null: neither H nor the msn time set). */
  start: Array<number | null>;
  h: number | null;
  /** H at the latest for the msn time, when it is set. */
  hNlt: number | null;
  basis: AprcBasis[];
  /** Advance (negative) or delay in minutes that puts the mov from the FAA, H and Ph 1 in the dark; null: no need or not known. */
  shift: number | null;
  moonText: string | null;
  /** A quick attk: contact to H, minutes; null: a deliberate attk. */
  quickMin: number | null;
  /** The climb on the assault and where it came from (typed in the Limitations box, or read off the ground); null: none. */
  climb: { m: number; by: 'typed' | 'read'; text: string } | null;
}

const durText = (m: number): string => (m >= 120 && m % 60 === 0 ? `${m / 60} hrs` : `${m} mins`);

/**
 * The attack's Time Calc in the book's rows (Mechs of Aprc (Attk) p 14): each step at the plan's figure when Check my
 * plan timed it (the march, the assault, Phase 2), else at the books' figures (a Coy: Mechs p 14; a Bn or Bde:
 * Understanding Aprc pp 21, 24; the assault at 100 m in 3 min, p 20, from the FUP's distance). Backward from the msn time
 * when it is set (H at the latest), forward from H otherwise (Mechs p 13). With the night of D Day, the mov from the FAA,
 * H and Ph 1 are put in the dark if a shift of the whole timetable does it (Understanding Aprc Sec III sheet 7).
 */
export function timeCalcAttk(c: AprcTimeCalcIn): AprcTimeCalc {
  const coy = c.echelon === 'Coy';
  const F = coy ? ATTK_FIG.coy : ATTK_FIG.bn;
  const hs = c.hsum;
  let fup1 = hs?.objMin != null ? Math.round(hs.objMin) : !coy && c.fupM ? Math.round((c.fupM / 100) * 3) : F.fup1;
  // uphill in mountains: the slant and the climb's time on the assault (MW Annex F pp 311-313); a typed climb wins over
  // the one read off the ground, which carries its own map distance for the angle
  const typed = c.climbM && c.climbM > 0 ? c.climbM : null;
  const rd = !typed && c.climbRead && c.climbRead.m > 0 ? c.climbRead : null;
  const mtn = typed ? mtnAssault({ horizM: c.fupM, climbM: typed, baseMin: fup1 }) : rd ? mtnAssault({ horizM: rd.horizM, climbM: rd.m, baseMin: fup1 }) : null;
  if (mtn) fup1 = mtn.min;
  const climb: AprcTimeCalc['climb'] = typed
    ? { m: typed, by: 'typed', text: `${typed} m of climb, as typed in the Limitations box${c.climbRead ? ` (read off the 30 m elevation: ${c.climbRead.m} m from ${c.climbRead.from}, not used)` : ''}` }
    : rd
      ? { m: rd.m, by: 'read', text: `${rd.m} m of climb, read off the 30 m elevation from ${rd.from} to ${rd.to} (${km(rd.horizM)} km apart); a climb typed in the Limitations box overrides it` }
      : null;
  const climbBasis: AprcBasis[] = climb ? [climb.by === 'typed' ? input(`Climb: ${climb.text}`) : data(`Climb: ${climb.text}. Heights: the terrain data's 30 m elevation, through the Ground Guide`)] : [];
  const sl2 = hs?.obj2Min != null && hs?.h2Min != null ? Math.round(hs.obj2Min - hs.h2Min) : F.sl2;
  const faa = hs?.leaveBeforeMin != null ? Math.round(hs.leaveBeforeMin) : F.faa;
  const two = c.phases === 2;
  // a quick attk: contact to H by the books in place of the stay in the FUP, the move, the rest and the battle procedure
  const quickMin = c.quick ? (coy ? QUICK_ATTK.taken.Coy : QUICK_ATTK.taken.Bn) : null;
  const D = QUICK_ATTK.drill;
  const tail: Array<number | null> = quickMin === null ? [F.stay, faa, F.unf0, F.rest, F.recce] : coy ? [-1, -1, -1, -1, quickMin] : [D.fup, D.ordersEnd - D.fup, -1, -1, D.recce - D.ordersEnd];
  // the duration of each row (null: a milestone; -1: not in this plan)
  const d: Array<number | null> = [
    null, F.final, two ? F.unf2 : -1, two ? null : -1, two ? (c.bunkers ? F.fight2Hard : F.fight2) : -1, two ? sl2 : -1, two ? null : -1, two ? F.stay2 : -1, two ? F.reorg1 : -1,
    F.unf1, c.bunkers ? F.fight1Hard : F.fight1, fup1, null, ...tail,
  ];
  const events = BACKWARD_EVENTS.slice();
  if (quickMin !== null) {
    if (coy) events[17] = 'Contact to H: quick aprc, wng O, orders, depl to the FUP';
    else {
      events[14] = 'Mov to the FUP';
      events[17] = 'Recce, planning and orders (from contact)';
    }
  }
  const step = (i: number): number => (d[i] === null || d[i]! < 0 ? 0 : d[i]!);
  const s: Array<number | null> = new Array(18).fill(null);
  s[12] = 0;
  for (let i = 11; i >= 0; i--) s[i] = s[i + 1]! + step(i + 1);
  for (let i = 13; i < 18; i++) s[i] = s[i - 1]! - step(i);
  const hNlt = c.msnBy !== null ? c.msnBy - s[0]! : null;
  const h = c.hMin ?? hNlt;
  // the moon: the mov from the FAA, H and Ph 1 in the dark
  let shift: number | null = null, moonText: string | null = null;
  const n = c.night;
  if (n && n.firstLt !== null && n.lastLt !== null && h !== null) {
    const w0 = h + s[14]!, w1 = h + s[9]!;
    const darkFits = (a: number, b: number): boolean => a >= n.lastLt! && b <= 1440 + n.firstLt! && !n.spans.some((sp) => sp.moon && sp.from < b && sp.to > a);
    // only a timetable that runs into the night of D Day is weighed against it (another night's moon is not read)
    if (w1 > n.lastLt && w0 < 1440 + n.firstLt) {
      // the whole of it in the dark first; else at least H and Ph 1 (from the FUP), the mov by covered routes with smk
      const tries: number[] = [];
      for (let k = 1; k <= 16; k++) tries.push(-30 * k);
      if (c.msnBy === null) for (let k = 1; k <= 16; k++) tries.push(30 * k);
      const find = (a: number, b: number): number | undefined => (darkFits(a, b) ? 0 : tries.find((x) => darkFits(a + x, b + x)));
      const how = (x: number): string => `${x < 0 ? 'adv' : 'delay'} all timings by ${dur(x)}`;
      const full = find(w0, w1);
      if (full === 0) moonText = 'the mov from the FAA, H and Ph 1 fall in the dark';
      else if (full !== undefined) {
        shift = full;
        moonText = `${how(full)} so that the mov from the FAA, H and Ph 1 fall in the dark`;
      } else {
        const core = find(h + s[13]!, w1);
        if (core === 0) moonText = 'H and Ph 1 fall in the dark, the mov from the FAA in the moonlight: by covered routes, with smk';
        else if (core !== undefined) {
          shift = core;
          moonText = `${how(core)} so that H and Ph 1 fall in the dark (the mov from the FAA in the moonlight: by covered routes, with smk)`;
        } else moonText = `no shift of the timetable${c.msnBy !== null ? ' within the msn time' : ''} puts H and Ph 1 in the dark: attk in the moonlight with smk, or at dawn or dusk`;
      }
    }
  }
  const at = (i: number): string => (s[i] === null ? '' : h !== null ? dClock(h + s[i]!) : hplus(s[i]! / 60));
  const rows = events.map((e, i) => {
    const r = [String(i + 1), e, '', ''];
    if (d[i] === -1) return [r[0], e, '-', '-'];
    if (i === 0) r[2] = at(0);
    else if (i === 6) r[2] = at(6);
    else if (i === 12) r[2] = h !== null ? dClock(h) : 'H';
    else if (i === 3) r[3] = at(3);
    else {
      r[2] = durText(step(i));
      r[3] = at(i);
    }
    return r;
  });
  const basis: AprcBasis[] = [
    rule(`The steps and their minutes: ${coy ? "a Coy's, the specimen of Mechs of Aprc (Attk) p 14 (fighting on the obj p 5: Ph 1 45-60 min, Ph 2 30-45 min)" : `a Bn's, Understanding Aprc p 24 (two phases), fighting on the obj Ph 1 1.5 h, Ph 2 1 h, with bunkers 2 h and 1.5 h (${UA(21)}); the unforeseen before the mov ${UA(17, 'IV')}`}; no pamphlet prints them`),
    ...(hs ? [calc("The march, the assault and Phase 2 from the plan's H-hour sum: the march at the day / night rates (IBB p 18), the assault at its pace, the fire lifting at each ring (IC s66 para 7 e (1) pp 304-305)")] : !coy && c.fupM ? [rule(`FUP to obj: ${km(c.fupM)} km at 100 m in 3 min by ni (${UA(20)}; the Plan Builder takes the same; the En rate is 100 m in 4 min, IC s114 para 35 k p 684)`)] : []),
    rule(`Fwd calc when the task is ASP, backward calc for a set time, both for "ASP and not later than" (${MA(13)})`),
    ...(c.msnBy !== null ? [input('The msn time: the aim\'s limitation')] : []),
    ...(c.hMin !== null ? [input('H: the sheet\'s')] : []),
    ...(moonText ? [rule('H in the hrs of darkness, the timings advanced as the quarter of the moon wants (Understanding Aprc Sec III sheet 7); moonlight: the moon 5 degrees up and a quarter lit (OcokaDoctrine light)')] : []),
    ...(quickMin !== null
      ? [
          rule(QUICK_TEXT),
          calc(coy ? `A quick attk by a Coy: contact to H ${quickMin} min, inside both books (MIB 30-60 min, IBB at most 30-45 min); no breakdown printed` : `A quick attk: contact to H ${quickMin} min by the Bn drill of MIB Annex L (recce H-100 to H-35, in the FUP by H-10)${c.echelon === 'Bde' ? '; no Bde figure printed, the Bn\'s taken' : ''}${hs?.leaveBeforeMin != null ? "; the plan's march from the Assy Area not used" : ''}`),
        ]
      : []),
    ...(mtn?.basis ?? []),
    ...climbBasis,
  ];
  return { table: { head: ['Ser', 'Events', 'Time Req', 'Running Time'], rows, widths: [0.08, 0.5, 0.2, 0.22] }, start: s, h, hNlt, basis, shift, moonText, quickMin, climb };
}

/** The moon's words for Timing of Attk: its quarter, when it is up, the dark spans, the part of the ni to attk in. */
export function moonWords(n: AprcNight): string {
  const q = ['1st', '2nd', '3rd', '4th'][n.quarter - 1];
  if (!n.spans.length) return `The moon is in its ${q} qtr (${n.moonPct} % lit).`;
  const lit = n.spans.filter((x) => x.moon), dark = n.spans.filter((x) => !x.moon);
  const span = (x: { from: number; to: number }) => `${hhmm(x.from)}-${hhmm(x.to)}`;
  const part = !lit.length ? 'the whole ni is dark' : !dark.length ? 'no dark hrs: attk with smk, or at dawn or dusk' : dark[0].from === n.spans[0].from && (dark.length === 1 || dark[dark.length - 1].to !== n.spans[n.spans.length - 1].to) ? 'attk in the early part of the ni, reorg in the moonlight' : dark[dark.length - 1].to === n.spans[n.spans.length - 1].to && dark[0].from !== n.spans[0].from ? 'attk in the later part of the ni, after the moon has set' : 'attk in a dark span, reorg before first lt';
  return `The moon is in its ${q} qtr (${n.moonPct} % lit)${lit.length ? `, up ${lit.map(span).join(' and ')} hrs` : ', too low or too thin to light the ni'}; dark ${dark.length ? `${dark.map(span).join(' and ')} hrs` : 'at no time'}: ${part}.`;
}

// ── the sketch: details to be marked (Anx P / Anx Q) ─────────────────────────────────────────────────────────────────

interface SketchItem {
  what: string;
  /** Matched on a symbol's name or label. */
  re?: RegExp;
  /** Own HQ symbols (2525D HQ / TF amplifier) count. */
  hq?: boolean;
  /** By hand / by eye: not told by the symbols. */
  how?: 'hand' | 'eye';
  /** Plan check posn kinds that count. */
  kinds?: string[];
  own?: boolean;
  remark?: string;
}

const SKETCH: Record<AprcKind, SketchItem[]> = {
  def: [
    { what: 'SD aspects: page no, security cl, copy no, ref, main heading; at least three map intersections', how: 'hand' },
    { what: 'Coy locs down to Pl lvl (FDLs and depth): the Pls first, the Coy goose-egg round them', re: /battle pos|infantry|\binf\b/i, own: true, kinds: ['fwd', 'depth'], remark: 'Marked two steps down: a Bn to its Pls; Rds by a loc inside its goose-egg' },
    { what: 'CAF, Mjd and Rangers (in brown)', re: /ranger|mujahid|\bmjd\b|frontier corps|\bcaf\b/i },
    { what: 'A tk wpns (RL, RR, ATGM)', re: /^(?!.*\bmine).*(anti ?tank|atgm|recoilless|rocket launcher|\blat\b|\bhat\b)/i },
    { what: 'Inf hy wpns (60 and 81 mm mor, LMG, MG), their number and cal', re: /mortar|machine gun|\bmor\b/i },
    { what: 'Inter unit / fmn bdys (own in blue, the En in red)', re: /boundar|\bbdry\b/i },
    { what: 'M fds with gaps, composn and number of mines (in full green)', re: /minefield|\bmine\b/i, remark: 'Only the protective M fds' },
    { what: 'LPs and standing ptls', re: /listening post|\bLP\b|\bSP\b|standing p/i },
    { what: 'Screens with composn and timings', re: /screen/i },
    { what: 'Arty OP, Div Arty OP, Mor obsr', re: /obsn post|observation post|\bOP\b|\bobsr\b/i },
    { what: 'Arty DFs (8 a bty), mor DFs (8 a mor tp), DF (SOS)', re: /\bDF\b|\btgt\b|target|grid origin/i },
    { what: 'Bn HQ, Bn Tac HQ', re: /\bHQ\b|headquarter/i, hq: true, own: true, remark: 'Tac HQ with the front Coy on the most likely apch' },
    { what: 'C attk objs (two on the most likely apch, one on the other)', re: /counter attk|c attk/i },
    { what: 'C pen posns (dotted)', re: /c pen/i, kinds: ['cpen'], remark: '1,500 m of front on the most threatened apch, 1,500 m behind the FDLs' },
    { what: 'Res, composn and loc (dotted)', re: /\bres\b|reserve/i, kinds: ['res'] },
    { what: 'Adv posns and protective dets (flashes at Bn lvl)', re: /covering tps|guard|adv(ance)? pos/i },
    { what: 'Delay lines, fall back posns of the SZ elms, BHL, SBPs', re: /delay|battle handover|\bbhol?\b|stay behind/i },
    { what: 'The En FUP (dotted)', re: /\bFUP\b|forming up/i, remark: 'At least 1,000 m from the FDLs' },
    { what: 'Bias of def / A tk def: by the forces, automatics and A tk wpns sited toward it', how: 'eye' },
  ],
  attk: [
    { what: 'SD aspects: page no, security cl, copy no, ref, main heading; map intersections', how: 'hand' },
    { what: 'Conc A and FAA', re: /assy area|assembly|\bFAA\b|\bconc\b/i },
    { what: 'Route to the FUP', how: 'eye' },
    { what: 'FUP, the writing in line with the goose-egg', re: /\bFUP\b|forming up/i },
    { what: 'SL with H hr', re: /start line|\bSL\b/i },
    { what: 'Attk arrows with the force going in', re: /main attk|sp attk|attack|attk/i },
    { what: 'Ph lines with nickname and time of completion', re: /phase line/i },
    { what: 'Reorg plan', how: 'eye' },
    { what: 'BOF with composn, loc and timings', re: /\bBOF\b|support by fire|base of fire/i },
    { what: 'F ech: its route, RV and time at the RV', re: /rendezvous|\bRV\b|f ech/i },
    { what: 'Blocking posn, composn and timings', re: /\bblock\b/i },
    { what: 'Feint activity (a broken line, in the legend)', re: /feint/i },
    { what: 'A tk wpns, DFs and surv elms in the reorg (dotted)', re: /^(?!.*\bmine).*(anti ?tank|atgm|\bDF\b|\btgt\b|obsn post)/i },
    { what: 'Fixation', re: /fixation|\bfix\b/i },
  ],
  // OoW Vol III Annex P p 75 (the conduct of the wdr) and Annex Q p 76 (a Bn's layout)
  wdr: [
    { what: 'SD aspects: page no, security cl, copy no, ref, main heading; map intersections', how: 'hand' },
    { what: 'The orig def posn', re: /battle pos|infantry|\binf\b|\bFDL|\bFEBA\b/i, own: true },
    { what: 'Covering tps, their initial and delay posns', re: /covering|screen|delay/i },
    { what: 'Flk gd (if req)', re: /flank guard|\bflk gd\b/i },
    { what: 'Intmed posns', re: /intermediate|intmed/i },
    { what: 'The new def posn', re: /new def|rear main|new posn/i, remark: 'A planned posn: dashed' },
    { what: 'Routes of wdr, Bn and Coy check pts, RVs, embussing pt', re: /route|check ?p(oin)?t|\bCP\b|rendezvous|\bRV\b|embus|debus/i, remark: 'Annex Q p 76' },
    { what: 'Phase lines, report lines, bounds', re: /phase line|report line|\bbound\b/i },
    { what: 'Inter unit / fmn bdys', re: /boundar|\bbdry\b/i },
    { what: 'Dml sites, the reserve dmls marked', re: /demolition|\bdml\b|crater/i, remark: 'Reserve dmls with gds and firing parties (OoW Vol III p 55)' },
    { what: 'M fds and obs', re: /minefield|\bmine\b|obstacle|wire|ditch/i },
    { what: 'Bomb line', re: /bomb line|\bBL\b|fire support coord|\bFSCL\b/i, remark: 'Annex Q p 76' },
    { what: 'Assy and harbour areas', re: /assy area|assembly|harbour/i },
  ],
};

const SKETCH_RULE: Record<AprcKind, string> = {
  def: `Details to be marked on the sketch, def, in 20 min (Anx P, ${UA('31-32')}; marked two steps down, ${UA(14)})`,
  attk: `Details to be marked on the sketch, attk, in 30 min (Anx Q, ${UA('34-35')})`,
  wdr: 'The conduct of the wdr as OoW Vol III Annex P p 75 lays it out (orig posn, covering tps, flk gd, intmed posns, new def posn); the unit layout as Annex Q p 76 (RVs, check pts, embussing pt, bomb line)',
};

/**
 * The details the book wants on the sketch, each with what of it is on the map (Understanding Aprc pp 31-32 / 34-35;
 * OoW Vol III Annexes P, Q). A def with a line of denial given gets a row for it: the Aprc marks it on its trace.
 */
export function writeSketch(kind: AprcKind, symbols: AprcSymbolIn[], check: AprcCheckIn | null, attkPlan: AprcAttkPlanIn | null, o: { denial?: string | null; lines?: string[] } = {}): AprcPatch[] {
  const items = SKETCH[kind] ?? SKETCH.def;
  const planNames: string[] = attkPlan ? attkPlan.axes.flatMap((a) => [a.fup ? `FUP ${a.fup}` : '', a.sl ? `SL ${a.sl}` : '', a.bof ? `BOF ${a.bof}` : '']).filter(Boolean) : [];
  const rows = items.map((it, i) => {
    const ser = `${alpha(i)}.`;
    if (it.how === 'hand') return [ser, it.what, 'By hand', ''];
    if (it.how === 'eye') return [ser, it.what, 'Check by eye', it.remark ?? ''];
    const hits = symbols.filter((s) => (!it.own || s.side === 'own') && ((it.hq && s.hq) || (!!it.re && (it.re.test(s.name) || it.re.test(s.label)))));
    const plan = uniq((check?.posns ?? []).filter((p) => it.kinds?.includes(p.kind)).map((p) => p.label));
    const extra = it.re ? planNames.filter((x) => it.re!.test(x)) : [];
    const names = uniq([...hits.map((s) => s.label || s.name), ...plan, ...extra]);
    const nTot = hits.length + plan.length + extra.length;
    let on = nTot ? `${nTot}: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ' ...' : ''}` : 'Not marked';
    if (kind === 'def' && i === 1 && hits.length && !hits.some((s) => s.ech === '14')) on += ' (no Pl symbols: marked one step down)';
    return [ser, it.what, on, it.remark ?? ''];
  });
  const missing = rows.filter((r) => r[2] === 'Not marked').length;
  const denial = kind === 'def' && o.denial ? o.denial : null;
  if (denial) rows.push([`${alpha(rows.length)}.`, `Line of denial: Line ${denial}, given by the higher comd with the msn`, (o.lines ?? []).includes(denial) ? `On the trace: Line ${denial}, "Line of Denial"` : `Not on the trace: no Line ${denial} in the reading`, 'Its integrity preserved by the subordinate comds (OoW Vol I pp 17-18)']);
  return [{
    id: 'anx.sketch',
    draft: `${missing ? `${missing} of the details the book wants are not marked on the map.` : 'Every detail the symbols can show is marked on the map.'} The SD aspects go on by hand.`,
    state: 'map',
    table: { head: ['Ser', 'Detail', 'On the map', 'Remarks'], rows, widths: [0.06, 0.44, 0.26, 0.24] },
    basis: [rule(SKETCH_RULE[kind] ?? SKETCH_RULE.def), input(`Symbols on the map, as drawn, and the last plan check${denial ? "; the line of denial, the aim's limitation" : ''}`), calc('A symbol counts when its name or label matches the detail; what symbols cannot show is checked by eye')],
    src: 'map',
  }];
}

// ── the books' writing rules ─────────────────────────────────────────────────────────────────────────────────────────

export interface AprcStyleNote {
  id: string;
  note: string;
}

/**
 * The books' writing rules on the words that will print (the planner's, else the draft): the aim starts with "To"
 * (Understanding Aprc pp 8, 22); in the def, a course does not (p 11), a deduction never opens with "Keeping in view"
 * (p 8), the Vis says "En is likely to", never "En will", and holds no own response (p 9), an adv names the ground (p 12).
 * The guide's own attack specimens open deductions with "Keeping in view": the rule is kept to the def, as the book puts it.
 */
export function styleNotes(doc: AprcDoc): AprcStyleNote[] {
  const out: AprcStyleNote[] = [];
  walk(doc, (p) => {
    const t = (p.mine?.text ?? p.draft ?? '').trim();
    if (!t) return;
    if (p.id === 'aim' && !/^to\b/i.test(t)) out.push({ id: p.id, note: `The aim starts with "To" (${UA(doc.kind === 'attk' ? 22 : 8)})` });
    if (doc.kind !== 'def') return;
    if ((p.id === 'crs.a' || p.id === 'crs.b') && /^to\b/i.test(t)) out.push({ id: p.id, note: `A course does not start with "To": write it as a paragraph (${UA(11)})` });
    if (/\.ded(\.|$)/.test(p.id) && /^keeping in view\b/i.test(t)) out.push({ id: p.id, note: `Never start a deduction with "Keeping in view" (${UA(8)})` });
    if (p.id === 'en.vis' || p.id.startsWith('en.vis.')) {
      if (/\b(en|enemy|he|they)\s+will\b/i.test(t)) out.push({ id: p.id, note: `Write "En is likely to", not "En will" (${UA(9)})` });
      if (/\b(I|we)\s+(must|will|shall|should)\b/i.test(t)) out.push({ id: p.id, note: `No own response in the Vis: it is the En op unfolding (${UA(9)})` });
    }
    if (p.id === 'crs.an.adv' && /\b(def(ence)? on (the )?higher gr(ound)?|(locs?|localities) (are )?mutually s(p|upport)|good depth)\b/i.test(t)) out.push({ id: p.id, note: `Not specific: name the gr ("def on higher gr", "locs mutually sp", "good depth" are to be avoided, ${UA(12)})` });
  });
  return out;
}

// ── all of it ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface AprcMechsIn {
  kind: AprcKind;
  echelon: string;
  reading: AorReading | null;
  limits: AprcLimits;
  /** H as a clock time on D Day ("HH:MM"): the def's En H, the attack's own H. */
  hHour: string | null;
  /** Time now as a D-time ("D-1 1000"). */
  timeNow: string | null;
  night: AprcNight | null;
  zone: string;
  /** The def: the en options' TAI / DP rows and the plan's what-if rows, for the reactions table. */
  ipbRows: string[][];
  planRows: string[][];
  check: AprcCheckIn | null;
  /** The plan check's rows as advs / disadvs ("name: reason"). */
  planAdv: string[];
  planDis: string[];
  time: { moveH: number | null; prepH: number | null; minesH: number | null; reqH: number | null } | null;
  attk: AprcAttkIn | null;
  attkPlan: AprcAttkPlanIn | null;
  hsum: AprcHSumIn | null;
  /** The attack: en units of a Pl or more within 1 km of each apch, by the reading's side. */
  enNear: Partial<Record<AorSide, string[]>>;
  symbols: AprcSymbolIn[];
  /** The attack in mountains: the climb from the SL / FUP to the obj read off the ground (a typed climb wins). */
  climb?: AprcClimb | null;
}

const parseHH = (s: string | null): number | null => {
  const m = /^\s*([01]?\d|2[0-3]):?([0-5]\d)\s*$/.exec(String(s ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Everything the two books add, as patches (each carries the reading it rests on) with their Confirm on Gr items. */
export function writeMechs(m: AprcMechsIn): AprcWritten {
  const patches: AprcPatch[] = [];
  const confirm: AprcConfirm[] = [];
  const r = m.reading;
  const lim = m.limits ?? {};
  const hMin = parseHH(m.hHour);
  const nowMin = parseDTime(m.timeNow);
  const place = r ? mitgOf(r).replace(/^the /, '') : '__';
  const say = (items: string[], suffix: string): string => (items.length ? `${items.map((x) => `${x.replace(/\.$/, '')}`).join('. ')}.${suffix}` : '');
  if (m.kind === 'def') {
    const ts = writeTsDef({ lim, hMin, nowMin, night: m.night, zone: m.zone, moveH: m.time?.moveH ?? null, prepH: m.time?.prepH ?? null, minesH: m.time?.minesH ?? null, reqH: m.time?.reqH ?? null });
    const derived = parseDTime(lim.by ?? null) === null && hMin !== null && m.night?.lastLt != null ? lastLtBefore(hMin, m.night.lastLt) : null;
    patches.push(...writeAim('def', lim, { place, hMin, lastLt: m.night?.lastLt ?? null, turn: null, readyDerived: derived }));
    if (r) {
      const L = layoutDef(r, lim, m.echelon);
      patches.push(...writeLayoutDef(L, r));
      const an = analysisDef(L, r, lim);
      const adv = [...an.adv, ...m.planAdv.map((x) => `${x} (Plan check)`)], dis = [...an.dis, ...m.planDis.map((x) => `${x} (Plan check)`)];
      const src = m.check ? 'plan' : 'gr';
      const anBasis: AprcBasis[] = [rule(`Advs and disadvs under the guide's heads (Aim / planning parameters, lines of def, protective dets, apchs, minor), the limitations turned into advs (${UA('12-13')}; ${UA(10, 'II', true)})`), ...an.basis, ...(m.check ? [calc('From Check my plan: a row that passes is an adv, a row that fails or warns a disadv, each with its reason')] : [])];
      if (adv.length) patches.push({ id: 'crs.an.adv', draft: say(adv, ''), state: 'judge', basis: anBasis, src });
      if (dis.length) patches.push({ id: 'crs.an.dis', draft: say(dis, ''), state: 'judge', basis: anBasis, src });
      const cr = courseDef(L, r, { check: m.check, prepFrom: ts.prepFromMin !== null ? dClock(ts.prepFromMin) : null, readyBy: ts.readyMin !== null ? dClock(ts.readyMin) : null });
      if (cr)
        patches.push({
          id: 'crs.a',
          draft: cr.text,
          state: 'judge',
          basis: [rule(`Course in paragraph form, not starting "To"; all disposns, reactions and timings (${UA(11)})`), ...(m.check ? [input(`The plan on the map, as checked (${m.check.title})`)] : [calc('No plan checked: a Coy to each BUA astride an apch on the FDLs and in depth, a working assumption')])],
          prompts: cr.missing.length ? [`Not drafted: ${list(cr.missing)}`, UA(11)] : [],
          src,
        });
      const v = visDef(L, r, { hMin, night: m.night });
      if (v) patches.push(...writeVisDef(v, m.ipbRows, m.planRows));
    }
    patches.push(...ts.patches);
  } else if (m.kind === 'wdr') {
    patches.push(...writeAim('wdr', lim, { place, hMin, lastLt: m.night?.lastLt ?? null, turn: null, readyDerived: null }));
    patches.push(...writeTsWdr({ lim, nowMin, night: m.night, zone: m.zone, echelon: m.echelon }).patches);
  } else {
    const ech = m.echelon;
    const turn = m.attk?.turn?.label ?? null;
    patches.push(...writeAim('attk', lim, { place: r ? (mitgOf(r) === 'the MITG' ? 'the obj (MITG)' : place) : '__', hMin, lastLt: m.night?.lastLt ?? null, turn, readyDerived: null }));
    if (r) {
      const tests = apchTestsAttk(r, { fupM: m.attk?.fupM ?? 1100, echelon: ech, enNear: m.enNear });
      if (tests) {
        // the book's tests as a sub-para of Pri of Apchs / Dir of Attk: its own draft (the IPB dir of attk) stays
        const best = tests.best.length && tests.best.length < tests.table.head.length - 2 ? ` Most in favour: the ${list(tests.best)} apch.` : '';
        patches.push({
          id: 'gr.ded.apch',
          children: [para('gr.ded.apch.tests', 'Apchs on the Planning Parameters', { draft: `The apchs tested on the book's planning parameters.${best}`, state: 'judge', table: tests.table, basis: tests.basis, prompts: [`A salient: adopt the dir that cuts its base; an earlier success on an apch: exploit it (${UA('16-17')})`] })],
          src: 'gr',
        });
        // the analysis of AP-1's apch: the plan's rows, then the book's tests for its side
        const first = m.attk ? attkFirst(m.attk)?.first ?? null : null;
        const side: AorSide | null = first?.onto === 'left' ? 'Lt' : first?.onto === 'right' ? 'Rt' : first?.onto === 'frontal' ? 'Cen' : tests.best[0] ?? null;
        const adv = [...m.planAdv.map((x) => `${x} (Plan check)`), ...(first && (first.onto === 'left' || first.onto === 'right' || first.onto === 'turn') ? ['Flking attk (Apch)'] : []), ...((side && tests.adv[side]) ?? []).map((x) => `${x} (Apch)`)];
        const dis = [...m.planDis.map((x) => `${x} (Plan check)`), ...(first?.onto === 'frontal' ? ['Most expected dir of attk, inviting str def reactions (Apch)'] : []), ...((side && tests.dis[side]) ?? []).map((x) => `${x} (Apch)`)];
        const basis: AprcBasis[] = [rule(`Advs and disadvs of the attk (${UA(25)}; ${MA(18)}): the maj limitation turned into an adv`), ...tests.basis.slice(0, 1), ...(side ? [calc(`AP-1's apch: the ${side} (${first ? 'the dir of attk read' : 'the most in its favour on the tests'})`)] : [])];
        const src = m.attkPlan ? 'plan' : 'gr';
        if (adv.length) patches.push({ id: 'crs.an.adv', draft: say(adv, ''), state: 'judge', basis, src });
        if (dis.length) patches.push({ id: 'crs.an.dis', draft: say(dis, ''), state: 'judge', basis, src });
        confirm.push(...tests.confirm.map((text) => ({ text, paras: ['gr.ded.apch'] })));
      }
    }
    const axesPh = m.attkPlan?.axes.length ? Math.max(...m.attkPlan.axes.map((a) => a.phase)) : 2;
    const tc = timeCalcAttk({ echelon: ech, hMin, msnBy: parseDTime(lim.by ?? null), nowMin, hsum: m.hsum, phases: axesPh >= 2 ? 2 : 1, bunkers: !!lim.bunkers, fupM: m.attk?.fupM ?? null, night: m.night, quick: !!lim.quick, climbM: lim.climbM ?? null, climbRead: m.climb ?? null });
    // the paragraph says which climb the assault was timed on: typed, or read off the ground
    patches.push({ id: 'ts.calc', draft: tc.climb ? `FUP to Obj uphill: ${tc.climb.text}.` : '', state: 'judge', table: tc.table, basis: tc.basis, src: 'time' });
    const H = tc.h;
    const T = (rel: number): string => (H !== null ? dClock(H + rel) : hplus(rel / 60));
    if (nowMin !== null) patches.push({ id: 'ts.data.now', draft: `${dClock(nowMin)}.`, state: 'map', basis: [input('Time now, as set on the sheet')], src: 'time' });
    const by = parseDTime(lim.by ?? null);
    if (by !== null) patches.push({ id: 'ts.data.by', draft: `${dClock(by)}.`, state: 'map', basis: [input("The aim's limitation, as set")], src: 'time' });
    if (nowMin !== null && by !== null && by > nowMin && m.night?.firstLt != null && m.night.lastLt != null) {
      const dn = dayNight(nowMin, by, m.night.firstLt, m.night.lastLt);
      const b = [calc('From time now to the msn time, split at first and last lt')];
      patches.push({ id: 'ts.data.total', draft: `${h1((by - nowMin) / 60)} hrs.`, state: 'judge', basis: b, src: 'time' }, { id: 'ts.data.ni', draft: `${h1(dn.ni)} hrs.`, state: 'judge', basis: b, src: 'time' }, { id: 'ts.data.day', draft: `${h1(dn.day)} hrs.`, state: 'judge', basis: b, src: 'time' });
    }
    const s = tc.start;
    const shift = tc.shift ?? 0;
    // the DS guns depl before H (IBB p 122, excluding travel): by ni when the attk is at ni or H falls in the dark
    const gu = gunUnitFor(ech);
    const hAbs = H !== null ? (((H + shift) % 1440) + 1440) % 1440 : null;
    const dark = !!lim.night || (hAbs !== null && m.night?.firstLt != null && m.night.lastLt != null && (hAbs >= m.night.lastLt || hAbs < m.night.firstLt));
    const gunMin = gu ? GUN_DEPL.fd[gu][dark ? 'ni' : 'day'] : null;
    const QD = QUICK_ATTK.drill;
    const ess = [
      ...(tc.quickMin !== null
        ? [`Contact not later than ${T(s[17]! + shift)} (a quick attk, contact to H ${tc.quickMin} min)`, ...(ech === 'Coy' ? [] : [`recce ${T(-QD.recce + shift)} to ${T(-QD.recceEnd + shift)}, orders ${T(-QD.orders + shift)} to ${T(-QD.ordersEnd + shift)}, in the FUP by ${T(-QD.fup + shift)}`])]
        : [`Mov from the FAA to the FUP ${T(s[14]! + shift)}`]),
      `H hr ${T(shift)}`,
      ...(axesPh >= 2 ? [`A hr (not later than) ${T(s[6]! + shift)}`] : []),
      `BOF to be estb by ${T(-45 + shift)}`,
      `Blocking posn to be estb by ${T(-20 + shift)}`,
      ...(gu && gunMin !== null ? [`DS fd ${gu} to start its depl not later than ${T(-gunMin + shift)} (${gunMin} min by ${dark ? 'ni' : 'day'}, excluding travel and registration)`] : []),
      `Feint to depict mov from ${T(-30 + shift)}`,
      `Completion ${T(s[0]! + shift)}`,
    ];
    patches.push({
      id: 'ts.ded.timings',
      draft: `${tc.moonText && tc.shift ? `${cap1(tc.moonText)}. ` : ''}${ess.join('; ')}.${tc.hNlt !== null && hMin !== null && hMin > tc.hNlt ? ` H as set is ${dur(hMin - tc.hNlt)} later than the msn time allows (H not later than ${dClock(tc.hNlt)}).` : ''}`,
      state: 'judge',
      basis: [
        rule(`BOF in loc at least by H-45; the blocking posn 15-20 min before H; the feint depicting mov at least 30 min before H (${UA('19-20')})`),
        ...tc.basis.slice(0, 1),
        ...(gu ? [rule(`The DS guns: a fd Bty 20 min by day, 40 by ni, a fd Regt 45 / 90 min, excluding travel; registration 20 min each plus 20 min (IBB p 122 para 5); the arty orders may govern H (IBB p 170 para 5); a ${ech === 'Bde' ? 'Bde\'s DS fd Regt' : `${ech}'s DS fd Bty`} taken`)] : []),
        ...(tc.quickMin !== null ? [rule(QUICK_TEXT)] : []),
        calc('From the Time Calc above'),
      ],
      src: 'time',
    });
    if (nowMin !== null && H !== null) {
      const spare = H + s[17]! - nowMin;
      patches.push(
        spare >= 0
          ? { id: 'ts.ded.more', draft: `${dur(spare)} more than the time req from time now: more time to the recce of the obj area, the coord and rehearsal of the attk fmns, the coord of fire sp with the echs, the stay in the FAA and battle drills.`, state: 'judge', basis: [rule(`In case more time is aval (${MA(15)})`), calc('Time now against the start of recce, planning and orders in the Time Calc')], src: 'time' }
          : { id: 'ts.ded.less', draft: `Short by ${dur(-spare)} from time now: curtail the stay in the FAA, battle drills and procedure and the recce of the obj area; shorten the rest and rehearsal.`, state: 'judge', basis: [rule(`In case less time is aval (${MA(15)})`), calc('Time now against the start of recce, planning and orders in the Time Calc')], src: 'time' },
      );
    }
    if (m.night) {
      const words = moonWords(m.night);
      patches.push({ id: 'gr.ded.c.timing', draft: `${words}${tc.moonText ? ` On the Time Calc: ${tc.moonText}.` : ''}`, state: 'judge', basis: [calc('The moon worked out from the date and the place: moonlight while it is 5 degrees up and a quarter lit (OcokaDoctrine light, after IBB Annex D and p 201)'), rule(`Since the moon is in __ qtr and up till __ hrs, I will attk during the early / later part of the ni (${MA(6)}); H in the hrs of darkness, the timings advanced as the moon wants (Understanding Aprc Sec III sheet 7)`), rule('Day, ni, dawn (the SL crossed at first lt) or dusk, each with its trade-offs (OoW Vol II pp 26-27)')], src: 'time' });
    }
  }
  patches.push(...writeSketch(m.kind, m.symbols, m.check, m.attkPlan, { denial: lim.denial ?? null, lines: r ? r.lines.map((l) => l.id) : [] }));
  return { patches, confirm };
}
