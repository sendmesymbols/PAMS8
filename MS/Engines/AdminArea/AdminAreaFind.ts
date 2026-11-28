/**
 * AdminAreaFind.ts
 *
 * The pure admin area finder (user, 2026-11-17: "Admin area / echelon finder (B Echelon, dumps, ammunition and medical
 * sites)"). No DOM, no ArcGIS, no I/O and only erasable TypeScript, so Node runs it (tools/sitefinder-test/admin.mjs).
 * Rules and figures come in as `AdminRules` (MS/Data/AdminDoctrine.json through `adminRulesFrom`), the ground through
 * SiteScan's `SiteProbe`.
 *
 * For a kind of admin area (Unit Ech, BAA, DAA, RP, AP, ADS), a search circle, the threat place and the month, every
 * lattice point is tried as the centre of the area (its size from the doctrine, facing the threat) and read:
 *
 *   Beyond   distance from the threat place against the enemy gun the kind must be clear of (field / medium / mortar,
 *            from ORBAT weapons.json), less where his guns stand behind it (0 unless the user knows better);
 *   Behind   (DAA) distance behind the own front against the figure for the operation (Def 48, Adv 15-20, Wdr 33 km);
 *   Firm     the month's soil cone index against wheels (hard standing);
 *   Wet      ground under water, waterlogged, or (in a wet month) flood-prone / riverbed;
 *   Room     the share of the area wheels can use (room to disperse);
 *   Air      concealment from the air (cc) and tree cover;
 *   Road     the nearest road of the class wanted, all-weather in the month, and the area off the main road;
 *   Avoid    bridges and road junctions near the area, built-up ground on it;
 *   Water / Buildings   for the kinds that need them (DAA, ADS, Ech): the nearest water point, the nearest pucca
 *            building (BHU, RHC, hospital, school, rest house);
 *   People   people per km² on the area.
 *
 * On mountain ground (the site finders' test, SiteScan.mountainGround: the ground within 5 km rises 400 m or more) the
 * MW checks are added (MW s25 para 3 pp 264-265): Slides (no slope steep enough to slide above the area, p 281), Part
 * way up the slope (not the valley floor where the nullahs flood, p 9, nor the top, p 264), Helipad Gr (a helipad or
 * airfield recorded, or a level patch of 4° or less, within reach, p 265 / p 256), Rock / gravel (p 265), Water for
 * every kind (p 264; p 266), Downwind (the slope the area stands on against the month's usual wind from the bundle's
 * wind grid: the downwind side of the hills, p 264), and the room row cites p 265. Defensible ground is named in the
 * notes to confirm on the ground: the bundle does not read it.
 *
 * The best areas are returned ranked (at least an area's size apart), each with its rows (value, tone, why) and fixes.
 */

import {
  bearingOf,
  compass,
  goingRule,
  groundDist,
  km,
  lattice,
  metres,
  mountainGround,
  desertGround,
  offsetPt,
  pct,
  pickRoad,
  readSite,
  reliefAround,
  areaSamples,
  rectRing,
  spreadPick,
  worstTone,
  figRefs,
  refSources,
  terrainRef,
  soilRuleRef,
  seasonRef,
  type DataKey,
  uniqRefs,
  refLine,
  type RefSource,
  type RuleRef,
  type RoadPick,
  type Season,
  type SiteProbe,
  type SiteRead,
  type Tone,
  type XY,
} from '../SiteScan/SiteScan';

/** The Slides row reads the slope above an admin area every 30 m, the elevation grid's own cell. */
const SLIDE_STEP_M = 30;

export interface Fig {
  value: number;
  basis: string;
  src: string;
  /** Book, page and words (AdminDoctrine.json), with the verifier's result. */
  refs?: any[];
  /** Worked out from book figures: the working. */
  calc?: string;
  /** A decision with no book figure: where it was looked for. */
  searched?: string[];
  /** When it was decided (ISO date). */
  decided?: string;
}

export type AdminKind = 'ech' | 'baa' | 'daa' | 'rp' | 'ap' | 'ads';
export const ADMIN_KINDS: AdminKind[] = ['ech', 'baa', 'daa', 'rp', 'ap', 'ads'];
export type AdminOp = 'def' | 'adv' | 'wdr';
export type GunClass = 'field' | 'medium' | 'mortar';

export interface AdminKindRule {
  label: string;
  short: string;
  frontM: Fig;
  depthM: Fig;
  radiusM: number;
  beyond: { value: GunClass; basis: string; src: string; refs?: any[]; calc?: string; searched?: string[]; decided?: string };
  /** Book words about the kind itself (where it sits, who controls it). */
  refs: any[];
  behind: { def: Fig; adv: Fig; wdr: Fig; tol: Fig; turnRoundM: Fig } | null;
  needs: string[];
  symbol: { key: string; desig: string; point: boolean; note: string };
  note: string;
}

export interface AdminRules {
  vehPerKm2: Fig;
  kinds: Record<AdminKind, AdminKindRule>;
  enemy: { field: { id: string; src: string; refs?: any[] }; medium: { id: string; src: string; refs?: any[] }; mortar: { id: string; src: string; refs?: any[] }; gunDepthM: Fig };
  sources: Record<string, RefSource>;
  ground: { firmProfile: string; maxSoftShare: Fig; maxWetShare: Fig; maxFloodShare: Fig; maxNogoShare: Fig; maxTiltDeg: Fig };
  air: { goodMean: Fig; poorMean: Fig };
  road: { minTier: Fig; maxM: Fig; offMainM: Fig; searchM: Fig };
  avoid: { landmarkM: Fig; kinds: string[]; buaShare: Fig };
  needs: { waterM: Fig; waterKinds: string[]; buildingsM: Fig; buildingKinds: string[]; evacM: Fig };
  weights: Record<string, number>;
  /** Working thresholds of the checks (AdminDoctrine.json checks: proposals with reasons). */
  checks: { minKnownShare: Fig; firmWarnShare: Fig; marginalWeight: Fig; roadFailX: Fig; peopleWarnKm2: Fig; mainRoadSrc: string };
  scan: { keep: number; maxSites: number; note: string; gunGateFrac: Fig; roomGateX: Fig; wetGateX: Fig; minKnownGate: Fig };
  order: { note: string; toneScore: Record<Tone, number>; toneSrc: string; weightsSrc: string; pre: Record<string, number>; preSrc: string };
  /** Mountain ground (AdminDoctrine.json mountains; MW s25 para 3 pp 264-265). */
  mountains: AdminMtnRules;
  /** Desert ground (AdminDoctrine.json desert; DW s24 pp 79-83). */
  desert: AdminDesRules;
}

/** Desert ground (AdminDoctrine.json desert): the test, and the book rules the Forward / Water rows and the note cite. */
export interface AdminDesRules {
  detectClasses: number[];
  detectShare: Fig;
  detectWithinM: Fig;
  forward: BookRule;
  water: BookRule;
  stocks: BookRule;
}

/** A book rule with no figure of its own (its refs), as AdminDoctrine.json holds it. */
export interface BookRule { basis: string; src: string; refs?: any[] }

export interface AdminMtnRules {
  /** The mountain test (as GunDoctrine mountains.bySection and the Plan Builder's Auto ground). */
  detectRiseM: Fig;
  detectWithinM: Fig;
  /** Slides: a slope above the area steeper than slideDeg fails; steeper than freshSnowDeg warns where and when snow lies. */
  slideDeg: Fig;
  freshSnowDeg: Fig;
  snowAboveM: Fig;
  snowMonths: { value: number[]; basis: string; src: string; searched?: string[]; decided?: string };
  slideReachM: Fig;
  /** Part way up: the place's height between the lowest and highest ground within partWayWithinM. */
  partWayWithinM: Fig;
  partWayLow: Fig;
  partWayHigh: Fig;
  partWayMinReliefM: Fig;
  /** Helipad ground within helipadM: a recorded helipad / airfield, or a patch helipadSideM across at helipadDeg or less. */
  helipadM: Fig;
  helipadDeg: Fig;
  helipadSideM: Fig;
  helipadKinds: string[];
  /** Rock / gravel: the share of the area on these classes. */
  rockClasses: number[];
  rockShare: Fig;
  /**
   * Downwind: the downwind side of the hills (MW p 264): the slope the area stands on faces within leeDeg of where the
   * month's usual wind goes; under aspectMinDeg the ground is level (no side to judge); under windSteadyMin the wind is
   * variable (no downwind side).
   */
  downwind: BookRule;
  leeDeg: Fig;
  aspectMinDeg: Fig;
  windSteadyMin: Fig;
  /** Book rules cited by rows that have no figure of their own. */
  water: BookRule;
  room: BookRule;
  confirm: BookRule;
  floods: BookRule;
  helipadWork: BookRule;
  stocks: BookRule;
}

const bookRule = (v: any, src: string): BookRule => ({ basis: String(v?.basis ?? 'E'), src: String(v?.src ?? src), refs: Array.isArray(v?.refs) ? v.refs : undefined });

function mtnRulesFrom(m: any): AdminMtnRules {
  const sm = m?.snowMonths;
  return {
    detectRiseM: fig(m?.detectRiseM, 400, 'M'),
    detectWithinM: fig(m?.detectWithinM, 5000, 'M'),
    slideDeg: fig(m?.slideDeg, 35, 'R'),
    freshSnowDeg: fig(m?.freshSnowDeg, 25, 'R'),
    snowAboveM: fig(m?.snowAboveM, 2000, 'R'),
    snowMonths: { value: Array.isArray(sm?.value) ? sm.value.map(Number) : [11, 12, 1, 2, 3, 4], basis: String(sm?.basis ?? 'E'), src: String(sm?.src ?? ''), ...figExtra(sm) },
    slideReachM: fig(m?.slideReachM, 500),
    partWayWithinM: fig(m?.partWayWithinM, 1500),
    partWayLow: fig(m?.partWayLow, 0.15, 'M'),
    partWayHigh: fig(m?.partWayHigh, 0.85, 'M'),
    partWayMinReliefM: fig(m?.partWayMinReliefM, 100, 'M'),
    helipadM: fig(m?.helipadM, 3000),
    helipadDeg: fig(m?.helipadDeg, 4, 'R'),
    helipadSideM: fig(m?.helipadSideM, 80),
    helipadKinds: Array.isArray(m?.helipadKinds) ? m.helipadKinds.map(String) : ['40', '41', '42', '43', '44', '45', '46', '47'],
    rockClasses: Array.isArray(m?.rockClasses) ? m.rockClasses.map(Number) : [15],
    rockShare: fig(m?.rockShare, 0.3, 'M'),
    downwind: bookRule(m?.downwind, 'MW p 264: the downwind side of hills'),
    leeDeg: fig(m?.leeDeg, 90, 'M'),
    aspectMinDeg: fig(m?.aspectMinDeg, 3, 'M'),
    windSteadyMin: fig(m?.windSteadyMin, 0.3, 'M'),
    water: bookRule(m?.water, 'MW p 264: proximity to a stream or lake for water'),
    room: bookRule(m?.room, 'MW p 265: an area of sufficient size to allow proper dispersion'),
    confirm: bookRule(m?.confirm, 'MW p 264: the downwind side of hills; terrain which lends itself to defence'),
    floods: bookRule(m?.floods, 'MW p 9: flash floods in nullahs'),
    helipadWork: bookRule(m?.helipadWork, 'MW p 248: engineers build air strips and helipads'),
    stocks: bookRule(m?.stocks, 'MW p 265: stocks distributed to each sector'),
  };
}

/** A figure's working (calc), where a decision was looked for (searched) and when it was decided. */
const figExtra = (v: any): { calc?: string; searched?: string[]; decided?: string } => ({
  ...(v?.calc ? { calc: String(v.calc) } : {}),
  ...(Array.isArray(v?.searched) ? { searched: v.searched.map(String) } : {}),
  ...(v?.decided ? { decided: String(v.decided) } : {}),
});

const fig = (v: any, value: number, basis = 'E', src = 'default in AdminAreaFind.ts'): Fig => {
  if (v && typeof v === 'object' && Number.isFinite(Number(v.value))) return { value: Number(v.value), basis: String(v.basis ?? basis), src: String(v.src ?? src), refs: Array.isArray(v.refs) ? v.refs : undefined, ...figExtra(v) };
  return { value, basis, src };
};

const KIND_DEFAULT: Record<AdminKind, { label: string; short: string; f: number; d: number; r: number; beyond: GunClass; key: string; point: boolean }> = {
  ech: { label: 'Unit Ech', short: 'Ech', f: 400, d: 400, r: 3000, beyond: 'field', key: '25310500', point: false },
  baa: { label: 'Bde Admin Area (BAA)', short: 'BAA', f: 2500, d: 2500, r: 6000, beyond: 'medium', key: '25310600', point: false },
  daa: { label: 'Div Admin Area (DAA)', short: 'DAA', f: 4000, d: 4500, r: 10000, beyond: 'medium', key: '25310700', point: false },
  rp: { label: 'Replenishment Point (RP)', short: 'RP', f: 2000, d: 2000, r: 6000, beyond: 'medium', key: '25321711', point: true },
  ap: { label: 'Amn / Sup / POL Pt', short: 'AP', f: 1000, d: 1000, r: 4000, beyond: 'medium', key: '25321711', point: true },
  ads: { label: 'ADS (Med)', short: 'ADS', f: 300, d: 300, r: 3000, beyond: 'field', key: '10110214', point: false },
};

/** AdminDoctrine.json -> rules; missing figures fall back to marked defaults (basis E). */
export function adminRulesFrom(doc: any): AdminRules {
  const d = doc ?? {};
  const kinds = {} as Record<AdminKind, AdminKindRule>;
  for (const k of ADMIN_KINDS) {
    const src = d.kinds?.[k] ?? {};
    const def = KIND_DEFAULT[k];
    const b = src.behindM;
    kinds[k] = {
      label: String(src.label ?? def.label),
      short: String(src.short ?? def.short),
      frontM: fig(src.frontM, def.f),
      depthM: fig(src.depthM, def.d),
      radiusM: Number(src.radiusM) || def.r,
      beyond: {
        value: (['field', 'medium', 'mortar'].includes(src.beyond?.value) ? src.beyond.value : def.beyond) as GunClass,
        basis: String(src.beyond?.basis ?? 'E'),
        src: String(src.beyond?.src ?? ''),
        refs: Array.isArray(src.beyond?.refs) ? src.beyond.refs : undefined,
        ...figExtra(src.beyond),
      },
      refs: Array.isArray(src.refs) ? src.refs : [],
      behind: b ? { def: fig(b.def, 48000), adv: fig(b.adv, 17500), wdr: fig(b.wdr, 33000), tol: fig(b.tol, 0.25), turnRoundM: fig(b.turnRoundM, 48000) } : null,
      needs: Array.isArray(src.needs) ? src.needs.map(String) : [],
      symbol: { key: String(src.symbol?.key ?? def.key), desig: String(src.symbol?.desig ?? def.short), point: !!(src.symbol?.point ?? def.point), note: String(src.symbol?.note ?? '') },
      note: String(src.note ?? ''),
    };
  }
  const e = d.enemy ?? {};
  const g = d.ground ?? {};
  return {
    vehPerKm2: fig(d.density?.vehPerKm2, 50),
    kinds,
    enemy: {
      field: { id: String(e.field?.id ?? 'en-105-mm-ifg-lfg'), src: String(e.field?.src ?? ''), refs: e.field?.refs },
      medium: { id: String(e.medium?.id ?? 'en-130-mm-m-46'), src: String(e.medium?.src ?? ''), refs: e.medium?.refs },
      mortar: { id: String(e.mortar?.id ?? ''), src: String(e.mortar?.src ?? ''), refs: e.mortar?.refs },
      gunDepthM: fig(e.gunDepthM, 0),
    },
    ground: {
      firmProfile: String(g.firmProfile ?? 'wheeled'),
      maxSoftShare: fig(g.maxSoftShare, 0.2),
      maxWetShare: fig(g.maxWetShare, 0.05),
      maxFloodShare: fig(g.maxFloodShare, 0.25),
      maxNogoShare: fig(g.maxNogoShare, 0.3),
      maxTiltDeg: fig(g.maxTiltDeg, 7),
    },
    air: { goodMean: fig(d.air?.goodMean, 2), poorMean: fig(d.air?.poorMean, 1) },
    road: { minTier: fig(d.road?.minTier, 2), maxM: fig(d.road?.maxM, 1000), offMainM: fig(d.road?.offMainM, 150), searchM: fig(d.road?.searchM, 3000) },
    avoid: { landmarkM: fig(d.avoid?.landmarkM, 500), kinds: Array.isArray(d.avoid?.kinds) ? d.avoid.kinds.map(String) : ['20', '21', '159', '166', '50'], buaShare: fig(d.avoid?.buaShare, 0.15) },
    needs: {
      waterM: fig(d.needs?.waterM, 2000),
      waterKinds: Array.isArray(d.needs?.waterKinds) ? d.needs.waterKinds.map(String) : ['1', '2', '3', '4', '5', '7', '8', '9', '155'],
      buildingsM: fig(d.needs?.buildingsM, 2000),
      buildingKinds: Array.isArray(d.needs?.buildingKinds) ? d.needs.buildingKinds.map(String) : ['70', '71', '72', '147', '75'],
      evacM: fig(d.needs?.evacM, 500),
    },
    sources: refSources(d),
    checks: {
      minKnownShare: fig(d.checks?.minKnownShare, 0.6),
      firmWarnShare: fig(d.checks?.firmWarnShare, 0.1),
      marginalWeight: fig(d.checks?.marginalWeight, 0.5),
      roadFailX: fig(d.checks?.roadFailX, 2),
      peopleWarnKm2: fig(d.checks?.peopleWarnKm2, 1500),
      mainRoadSrc: String(d.checks?.mainRoad?.src ?? 'an MSR or a motorway, trunk or primary road'),
    },
    scan: {
      keep: Number(d.scan?.keep) || 50,
      maxSites: Number(d.scan?.maxSites) || 5,
      note: String(d.scan?.note ?? 'Search: places tried every third of the area\'s side'),
      gunGateFrac: fig(d.scan?.gunGateFrac, 0.8),
      roomGateX: fig(d.scan?.roomGateX, 1.5),
      wetGateX: fig(d.scan?.wetGateX, 3),
      minKnownGate: fig(d.scan?.minKnownGate, 0.5),
    },
    order: {
      note: String(d.order?.note ?? 'worst check first, then the weighted score, then the finer reading'),
      toneScore: { ok: Number(d.order?.toneScore?.ok ?? 1), warn: Number(d.order?.toneScore?.warn ?? 0.55), unknown: Number(d.order?.toneScore?.unknown ?? 0.4), bad: Number(d.order?.toneScore?.bad ?? 0) },
      toneSrc: String(d.order?.toneScore?.src ?? 'pass 1, needs work 0.55, not read 0.4, fails 0'),
      weightsSrc: String(d.order?.weightsNote?.src ?? 'weights in AdminDoctrine.json'),
      pre: { room: 2, firm: 2, wet: -4, floodWet: -2, floodDry: -0.5, concealDiv: 1.5, bua: -1, ...Object.fromEntries(Object.entries(d.order?.pre ?? {}).filter(([, v]) => typeof v === 'number')) } as Record<string, number>,
      preSrc: String(d.order?.pre?.src ?? 'finer reading'),
    },
    weights: { beyond: 3, behind: 2, firm: 2, wet: 3, room: 2, air: 2, road: 2, avoid: 1, water: 1, buildings: 1, people: 1, slides: 3, partway: 1, helipad: 1, rock: 1, downwind: 1, ...(d.weights ?? {}) },
    mountains: mtnRulesFrom(d.mountains),
    desert: desRulesFrom(d.desert),
  };
}

function desRulesFrom(m: any): AdminDesRules {
  const cl = m?.detectClasses?.value;
  return {
    detectClasses: Array.isArray(cl) ? cl.map(Number) : [12, 13, 14, 16],
    detectShare: fig(m?.detectShare, 0.5, 'M'),
    detectWithinM: fig(m?.detectWithinM, 3000, 'M'),
    forward: bookRule(m?.forward, 'DW p 82: administrative areas as far forward as possible to reduce turn around distances'),
    water: bookRule(m?.water, 'DW p 80: sweet water only in tobas and the green belt'),
    stocks: bookRule(m?.stocks, 'DW p 82: mobile APs to the forward Bdes, petrol points well forward'),
  };
}

// ── enemy guns ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface EnemyGun {
  id: string;
  name: string;
  type: string;
  rangeM: number;
  page: string;
  cls: GunClass | 'rocket';
}

const FIELD_CAL = /\b(75|76|105|122)\b/;

/** Enemy guns, mortars and rockets from ORBAT weapons.json (side en), each with its longest printed range. */
export function enemyGuns(weaponsDoc: any): EnemyGun[] {
  const out: EnemyGun[] = [];
  for (const w of (weaponsDoc?.weapons ?? []) as any[]) {
    if (w?.side !== 'en') continue;
    const t = String(w.type ?? '');
    if (!['how', 'gun', 'sp-gun', 'mortar', 'mbrl'].includes(t)) continue;
    const pr = w.planRangeM ?? {};
    const r = Number(pr.max ?? pr.plan ?? pr.eff ?? w.rangeM?.max);
    if (!(r > 0)) continue;
    const name = String(w.name ?? w.id);
    const cls: EnemyGun['cls'] = t === 'mortar' ? 'mortar' : t === 'mbrl' ? 'rocket' : FIELD_CAL.test(name) && !/\b130\b|\b155\b/.test(name) ? 'field' : 'medium';
    out.push({ id: String(w.id), name, type: t, rangeM: r, page: String(w.page ?? ''), cls });
  }
  return out.sort((a, b) => a.rangeM - b.rangeM);
}

/** The gun a kind must be clear of: the doctrine's pick by id, else the longest of its class. */
export function gunFor(guns: EnemyGun[], cls: GunClass, R: AdminRules, pickId?: string | null): EnemyGun | null {
  if (pickId) {
    const g = guns.find((x) => x.id === pickId);
    if (g) return g;
  }
  const id = R.enemy[cls]?.id;
  const byId = id ? guns.find((x) => x.id === id) : null;
  if (byId) return byId;
  const of = guns.filter((x) => x.cls === cls);
  return of.length ? of[of.length - 1] : null;
}

// ── the finder ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface AdminTask {
  kind: AdminKind;
  centre: XY;
  radiusM: number;
  /** The enemy's place (the threat marker / a clicked point / his FDL); null = no threat check. */
  threat: XY[] | null;
  /** The own front (FDL lines, or the threat place when none is drawn); null = no "behind" check. */
  front: { runs: XY[][]; label: string } | null;
  gun: EnemyGun | null;
  /** Where his guns stand behind the threat place (m). */
  gunDepthM: number;
  op: AdminOp;
  season: Season;
  /** Area size override (vehicles at the doctrine density); null = the kind's figure. */
  vehicles: number | null;
  /** The data catalogue of the terrain bundle (SiteScan.dataCatalog(manifest)). */
  data?: ((key: DataKey, figure: string) => RuleRef) | null;
  /** Where the user's inputs came from. */
  inputs?: { threat?: string; front?: string; gun?: string };
  seasonWhy?: string;
  wetFromMm?: number;
  /** 1-12: the month (snow on the slopes above in the winter months); undefined = any month (safety first). */
  month?: number;
  /** Mountain ground: true / false as known (the Plan Builder's ground), undefined / null = read at the centre. */
  mountain?: boolean | null;
  /** Desert ground: true / false as known, undefined / null = read at the centre (SiteScan.desertGround). */
  desert?: boolean | null;
}

export interface AdminRow {
  key: string;
  label: string;
  value: string;
  tone: Tone;
  why: string;
  fix?: string;
  /** The rules the check applied: book, page and words, or the proposal and why. */
  rules: RuleRef[];
}

export interface AdminSite {
  rank: number;
  at: XY;
  axisDeg: number;
  ring: XY[];
  score: number;
  tone: Tone;
  verdict: string;
  rows: AdminRow[];
  read: SiteRead;
  road: RoadPick;
  threatM: number | null;
  frontM: number | null;
  fixes: string[];
  /** Why it stands where it does in the list. */
  why: string[];
}

export interface AdminGateFail {
  gate: 'nogo' | 'gun' | 'room' | 'wet';
  text: string;
  rules: RuleRef[];
}

export interface AdminResult {
  sites: AdminSite[];
  tried: number;
  rejected: { nogo: number; gun: number; room: number; wet: number };
  /** The places left out, by gate, with the rule each gate applies. */
  rejectedWhy: Array<{ gate: AdminGateFail['gate']; count: number; share: number; text: string; rules: RuleRef[] }>;
  notes: string[];
  frontM: number;
  depthM: number;
  rule: AdminKindRule;
  /** Book words about the kind (where it sits, who controls it). */
  kindRefs: RuleRef[];
  /** How the list is ordered and which places were tried (proposals). */
  orderRules: RuleRef[];
  /** Mountain ground: the MW checks were added (MW s25 para 3 pp 264-265). */
  mountain: boolean;
  /** Desert ground read at the centre (or as given): the Forward / Water rows and the desert note were added. */
  desert: boolean;
}

export interface AdminWhyNot {
  at: XY;
  gates: AdminGateFail[];
  site: AdminSite | null;
  vsBest: string[];
  verdict: string;
}

const TONE_RANK: Record<Tone, number> = { ok: 0, warn: 1, unknown: 2, bad: 3 };
const TONE_WORD: Record<Tone, string> = { ok: 'passes', warn: 'needs work', unknown: 'not read', bad: 'fails' };

function toneScore(t: Tone, R?: AdminRules): number {
  const ts = R?.order.toneScore;
  return ts ? ts[t] : t === 'ok' ? 1 : t === 'warn' ? 0.55 : t === 'unknown' ? 0.4 : 0;
}

/** The ordering method as references (AdminDoctrine.json order and scan): method settings (M), with their reasons. */
export function adminOrderRefs(R: AdminRules): RuleRef[] {
  const e = (figure: string, note: string): RuleRef => ({ basis: 'M', book: '', page: '', quote: null, role: 'rule', checked: null, figure, note });
  return [e('List order', R.order.note), e('Weighted score', `${R.order.toneSrc}; ${R.order.weightsSrc}`), e('Finer reading', R.order.preSrc), e('Places tried', `${R.scan.note} (the best ${R.scan.keep} read in full; at most ${R.scan.maxSites} listed)`)];
}

function nearestDist(p: XY, runs: XY[][]): { d: number; near: XY } {
  let best = Infinity, near: XY = p;
  for (const run of runs) {
    if (run.length === 1) {
      const d = groundDist(p, run[0]);
      if (d < best) {
        best = d;
        near = run[0];
      }
      continue;
    }
    for (let i = 0; i + 1 < run.length; i++) {
      const a = run[i], b = run[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L2 = dx * dx + dy * dy;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
      const q: XY = [a[0] + t * dx, a[1] + t * dy];
      const d = groundDist(p, q);
      if (d < best) {
        best = d;
        near = q;
      }
    }
  }
  return { d: best, near };
}

/** Area size for the task: the kind's figure, or `vehicles` at the doctrine density (square). */
export function adminSize(task: AdminTask, R: AdminRules): { frontM: number; depthM: number } {
  const k = R.kinds[task.kind];
  if (task.vehicles && task.vehicles > 0) {
    const side = Math.sqrt((task.vehicles / R.vehPerKm2.value) * 1e6);
    return { frontM: Math.round(side / 50) * 50 || 50, depthM: Math.round(side / 50) * 50 || 50 };
  }
  return { frontM: k.frontM.value, depthM: k.depthM.value };
}

/** The enemy gun as a rule: the ORBAT entry (weapons.json) and the threat section's page. */
export function enemyGunRef(g: EnemyGun, sources: Record<string, RefSource>): RuleRef {
  return { basis: 'D', book: sources.soh13?.short ?? "SO's Hbk 2019, Sec 13 Threat", page: g.page, quote: `${g.name}: ${g.rangeM} m`, role: 'rule', checked: 'orbat', figure: `${g.name} range (ORBAT weapons.json)` };
}

interface AdminCand {
  at: XY;
  axis: number;
  read: SiteRead;
  pre: number;
  tM: number | null;
  fM: number | null;
}

/** The gates and checks for one task, shared by the search, "Why not here?" and the decision record. */
function adminScorer(probe: SiteProbe, rules: any, task: AdminTask, R: AdminRules) {
  const K = R.kinds[task.kind];
  const S = R.sources;
  const { frontM, depthM } = adminSize(task, R);
  const rule = goingRule(rules, R.ground.firmProfile, task.season);
  const reach = task.gun ? task.gun.rangeM - Math.max(0, task.gunDepthM) : null;
  const nS = (m: number) => Math.max(4, Math.min(8, Math.round(m / 150)));
  const pctV = (x: number) => `${Math.round(x * 100)}%`;
  const C = R.checks;
  const dat = (key: DataKey, figure: string): RuleRef[] => (task.data ? [task.data(key, figure)] : []);
  const input = (k: 'threat' | 'front' | 'gun', figure: string): RuleRef[] => (task.inputs?.[k] ? [{ basis: 'D', book: 'Your input', page: '', quote: task.inputs[k]!, role: 'data' as const, checked: null, figure }] : []);
  const season = task.seasonWhy ? seasonRef(task.data ?? null, task.seasonWhy, task.wetFromMm ?? 100) : [];
  const sized = task.vehicles && task.vehicles > 0;
  const refs = {
    size: sized
      ? figRefs(R.vehPerKm2, `${task.vehicles} veh at ${R.vehPerKm2.value} per km² = ${Math.round(frontM)} x ${Math.round(depthM)} m`, S)
      : [...figRefs(K.frontM, `${K.short} ${Math.round(frontM)} m wide`, S), ...figRefs(K.depthM, `${K.short} ${Math.round(depthM)} m deep`, S)],
    nogo: [terrainRef(rules, R.ground.firmProfile, 'Gr wheels cannot use'), ...dat('class', 'Gr class at the place')],
    known: figRefs(C.minKnownShare, `Not read when the class is known on under ${pctV(C.minKnownShare.value)} of the samples`, S),
    beyond: [
      ...figRefs(K.beyond, `${K.short} clear of the en ${K.beyond.value} guns`, S),
      ...(task.gun ? [enemyGunRef(task.gun, S)] : []),
      ...figRefs(R.enemy[K.beyond.value as 'field' | 'medium' | 'mortar'], `En ${K.beyond.value} gun chosen`, S).filter((r) => r.book),
      ...figRefs(R.enemy.gunDepthM, `His guns ${Math.round(task.gunDepthM / 100) / 10} km behind the threat place`, S),
      ...input('threat', 'Threat place'),
      ...input('gun', 'En gun chosen'),
    ],
    gunGate: figRefs(R.scan.gunGateFrac, `Search shortcut: nearer than ${pctV(R.scan.gunGateFrac.value)} of his reach`, S),
    behind: K.behind ? [...figRefs(K.behind[task.op], `${K.short} ${Math.round(K.behind[task.op].value / 1000)} km behind (${task.op})`, S), ...figRefs(K.behind.turnRoundM, `Within 1st line turn-round ${Math.round(K.behind.turnRoundM.value / 1000)} km`, S), ...figRefs(K.behind.tol, `Within ${pctV(K.behind.tol.value)} of the figure counts as on it`, S), ...input('front', 'The front')] : [],
    firm: [
      ...figRefs(R.ground.maxSoftShare, `Over ${pctV(R.ground.maxSoftShare.value)} too soft fails`, S),
      ...figRefs(C.firmWarnShare, `Over ${pctV(C.firmWarnShare.value)} soft needs work`, S),
      ...figRefs(C.marginalWeight, `Marginal soil counts x${C.marginalWeight.value}`, S),
      soilRuleRef(rules, R.ground.firmProfile, 'Soil strength against wheels'),
      ...dat('rci', `Cone index ${task.season === 'wet' ? 'after rain' : 'dry'}`),
      ...season,
    ],
    wet: [...figRefs(R.ground.maxWetShare, `Over ${pctV(R.ground.maxWetShare.value)} under water / waterlogged fails`, S), ...figRefs(R.ground.maxFloodShare, `Flood-prone over ${pctV(R.ground.maxFloodShare.value)} fails in a wet month`, S), ...dat('wet', 'Wet Gr codes (water, waterlogged, seasonal water, riverbed, flood-prone)'), ...season],
    wetGate: figRefs(R.scan.wetGateX, `Search shortcut: ${R.scan.wetGateX.value} x the waterlogged limit`, S),
    room: [...figRefs(R.ground.maxNogoShare, `Room: over ${pctV(R.ground.maxNogoShare.value)} NO-GO for wheels warns`, S), ...figRefs(R.ground.maxTiltDeg, `Tilt over ${R.ground.maxTiltDeg.value}° warns`, S), ...dat('elev', 'Heights of the samples (tilt)')],
    roomGate: [...figRefs(R.scan.roomGateX, `Search shortcut: ${R.scan.roomGateX.value} x the NO-GO limit`, S), ...figRefs(R.scan.minKnownGate, `Gates apply where the data is known on ${pctV(R.scan.minKnownGate.value)} or more`, S)],
    air: [...figRefs(R.air.goodMean, `Hidden from air: ${R.air.goodMean.value} (fair) or better passes`, S), ...figRefs(R.air.poorMean, `Under ${R.air.poorMean.value} (poor) fails`, S), ...dat('cc', 'Concealment from the air (cc >> 4)'), ...dat('class', 'Tree cover (Gr class)')],
    road: [
      ...figRefs(R.road.minTier, `Rd class ${R.road.minTier.value >= 3 ? '60' : R.road.minTier.value >= 2 ? '50' : ''}+`, S),
      ...figRefs(R.road.maxM, `A Rd within ${R.road.maxM.value} m`, S),
      ...figRefs(C.roadFailX, `Over ${C.roadFailX.value} x the limit fails`, S),
      ...figRefs(R.road.offMainM, `Centre ${R.road.offMainM.value} m or more off a main Rd`, S),
      { basis: 'M', book: '', page: '', quote: null, role: 'rule' as const, checked: null, figure: 'What a main Rd is', note: C.mainRoadSrc },
      ...dat('network', 'Rds near: class, load class, all-weather, MSR'),
    ],
    avoid: [...figRefs(R.avoid.landmarkM, `Brs and Rd junctions within ${R.avoid.landmarkM.value} m`, S), ...figRefs(R.avoid.buaShare, `BUA over ${pctV(R.avoid.buaShare.value)} of the area`, S), ...dat('features', 'Brs, junctions, stations near'), ...dat('bld', 'Bldgs on the area'), ...dat('class', 'BUA class on the area')],
    water: [...figRefs(R.needs.waterM, `A water point within ${(R.needs.waterM.value / 1000).toFixed(0)} km`, S), ...dat('features', 'Water points (wells, tube wells, springs, tanks)')],
    buildings: [...figRefs(R.needs.buildingsM, `A pucca bldg within ${(R.needs.buildingsM.value / 1000).toFixed(0)} km`, S), ...dat('features', 'Hospitals, BHUs, dispensaries, schools, rest houses')],
    evac: [...figRefs(R.needs.evacM, `An all-weather Rd within ${R.needs.evacM.value} m`, S), ...dat('network', 'All-weather Rds near')],
    people: [...figRefs(C.peopleWarnKm2, `Over ${C.peopleWarnKm2.value.toLocaleString('en-US')} per km² needs work`, S), ...dat('population', 'People per km² (estimate, not a census)')],
    kind: figRefs({ basis: 'R', src: K.note, refs: K.refs }, `${K.short}: where it sits`, S).filter((r) => r.book),
  };

  const gates = (p: XY): { fails: AdminGateFail[]; tM: number | null; axis: number } => {
    const fails: AdminGateFail[] = [];
    const c0 = probe.cls(p[0], p[1]);
    if (c0 !== null && rule.nogo[c0]) fails.push({ gate: 'nogo', text: `The centre is on ${String(rules?.classes?.[String(c0)]?.label ?? `class ${c0}`)}: NO-GO for wheels`, rules: refs.nogo });
    let tM: number | null = null;
    let axis = 0;
    if (task.threat?.length) {
      const t = nearestDist(p, [task.threat]);
      tM = t.d;
      axis = bearingOf(p, t.near);
      if (reach !== null && tM < reach * R.scan.gunGateFrac.value) fails.push({ gate: 'gun', text: `${km(tM)} from the threat: well inside ${task.gun!.name}'s reach of ${km(reach)}`, rules: [...refs.beyond, ...refs.gunGate] });
    }
    return { fails, tM, axis };
  };
  const read = (p: XY, axis: number) => readSite(probe, p, axis, frontM, depthM, rule, nS(frontM), nS(depthM));
  const readFails = (r: SiteRead): AdminGateFail[] => {
    const out: AdminGateFail[] = [];
    const G = R.scan.minKnownGate.value;
    if (r.known >= r.n * G && r.nogo > R.ground.maxNogoShare.value * R.scan.roomGateX.value) out.push({ gate: 'room', text: `${pct(r.nogo)} of the area is NO-GO for wheels (${R.scan.roomGateX.value} x the ${pctV(R.ground.maxNogoShare.value)} limit)`, rules: [...refs.room, ...refs.size, ...refs.nogo, ...refs.roomGate] });
    if (r.wetKnown >= r.n * G && r.wetBad > R.ground.maxWetShare.value * R.scan.wetGateX.value) out.push({ gate: 'wet', text: `${pct(r.wetBad)} of the area is under water or waterlogged (${R.scan.wetGateX.value} x the ${pctV(R.ground.maxWetShare.value)} limit)`, rules: [...refs.wet, ...refs.wetGate] });
    return out;
  };
  const P = R.order.pre;
  const pre = (r: SiteRead) => (1 - r.nogo) * P.room + (1 - r.softNogo) * P.firm + r.wetBad * P.wet + r.floodProne * (task.season === 'wet' ? P.floodWet : P.floodDry) + (r.concealMean ?? 0) / P.concealDiv + r.bua * P.bua;
  // ── mountain ground (MW s25 para 3 pp 264-265): the test as the gun finder's (SiteScan.mountainGround) ─────────────
  const M = R.mountains;
  const mtn = task.mountain ?? mountainGround(probe, task.centre, M.detectRiseM.value, M.detectWithinM.value) ?? false;
  // ── desert ground (DW s24 pp 79-83): the Plan Builder's Auto desert test (SiteScan.desertGround) ─────────────────────
  const D = R.desert;
  const des = !mtn && (task.desert ?? desertGround(probe, task.centre, D.detectClasses, D.detectShare.value, D.detectWithinM.value) ?? false);
  const dRefs = {
    forward: [...figRefs(D.forward, 'As far forward as possible within easy turn-round (desert)', S), ...figRefs(D.detectShare, `Desert: ${pctV(D.detectShare.value)} of the ground within ${km(D.detectWithinM.value, 0)} bare, sand, dunes or salt pan`, S)],
    water: figRefs(D.water, 'Sweet water only in tobas and the green belt; water points open round the clock (desert)', S),
  };
  const snowy = (e0: number) => e0 >= M.snowAboveM.value && (task.month === undefined || M.snowMonths.value.includes(task.month));
  const mRefs = {
    slides: [
      ...figRefs(M.slideDeg, `A slope over ${M.slideDeg.value}° above the area fails`, S),
      ...figRefs(M.freshSnowDeg, `Over ${M.freshSnowDeg.value}° warns where snow lies`, S),
      ...figRefs(M.snowAboveM, `Snow lies above ${M.snowAboveM.value} m`, S),
      ...figRefs(M.snowMonths, `Snow months ${M.snowMonths.value.join(', ')}`, S),
      ...figRefs(M.slideReachM, `Slopes read ${M.slideReachM.value} m beyond the area`, S),
      ...figRefs(M.confirm, 'Part way up the slope, free of danger from slides', S),
      ...dat('elev', 'Heights round the area (slope above it)'),
    ],
    partway: [
      ...figRefs(M.partWayWithinM, `Lowest and highest Gr within ${km(M.partWayWithinM.value)}`, S),
      ...figRefs(M.partWayLow, `Under ${pctV(M.partWayLow.value)} of the way up: the valley floor`, S),
      ...figRefs(M.partWayHigh, `Over ${pctV(M.partWayHigh.value)} of the way up: the top`, S),
      ...figRefs(M.partWayMinReliefM, `Under ${M.partWayMinReliefM.value} m of relief: level, not judged`, S),
      ...figRefs(M.confirm, 'Part way up the slope', S),
      ...figRefs(M.floods, 'Flash floods in nullahs', S),
      ...dat('elev', 'Heights round the place'),
    ],
    helipad: [
      ...figRefs(M.helipadM, `Helipad Gr within ${km(M.helipadM.value)}`, S),
      ...figRefs(M.helipadDeg, `A helipad ${M.helipadDeg.value}° or less`, S),
      ...figRefs(M.helipadSideM, `A landing point ${M.helipadSideM.value} m across`, S),
      ...figRefs(M.confirm, 'Near terrain for an all season airstrip / helipads', S),
      ...figRefs(M.helipadWork, 'Engineers build helipads', S),
      ...dat('features', 'Helipads, airfields, landing grounds recorded'),
      ...dat('elev', 'Heights (slope of the patch)'),
    ],
    rock: [...figRefs(M.rockShare, `Rock / stony Gr on ${pctV(M.rockShare.value)} or more of the area`, S), ...figRefs(M.confirm, 'Good soil conditions (rock, or gravel)', S), ...dat('class', 'Rocky Gr / scree / stony waste class')],
    water: figRefs(M.water, 'Water: a stream or lake near; seldom on the heights', S),
    room: figRefs(M.room, 'Room to disperse', S),
    downwind: [
      ...figRefs(M.downwind, 'The downwind side of hills', S),
      ...figRefs(M.leeDeg, `The slope faces within ${M.leeDeg.value}° of where the wind goes`, S),
      ...figRefs(M.aspectMinDeg, `Under ${M.aspectMinDeg.value}° of slope: level, no side to judge`, S),
      ...figRefs(M.windSteadyMin, `Steadiness under ${M.windSteadyMin.value}: the wind variable`, S),
      ...dat('wind', "The month's usual wind (a normal, not a forecast)"),
      ...dat('elev', 'Heights round the place (the way its slope faces)'),
    ],
  };
  /**
   * The steepest slope above the area, ground rising outward from it and standing above it, read every 30 m: the
   * elevation grid's own cell (at 60 m a pitch of 30-60 m was halved into two gentle steps and missed).
   */
  const slideRead = (p: XY): { deg: number; distM: number; brg: number; e0: number } | null => {
    const e0 = probe.elev(p[0], p[1]);
    if (!Number.isFinite(e0)) return null;
    const reach = M.slideReachM.value + Math.hypot(frontM, depthM) / 2;
    const step = SLIDE_STEP_M;
    let worst = { deg: 0, distM: 0, brg: 0 }, known = 0;
    for (let b = 0; b < 16; b++) {
      const brg = b * 22.5;
      let prev = e0;
      for (let d = step; d <= reach + 1e-6; d += step) {
        const q = offsetPt(p[0], p[1], brg, d);
        const e = probe.elev(q[0], q[1]);
        if (!Number.isFinite(e)) { prev = NaN; continue; }
        known++;
        if (Number.isFinite(prev) && e > prev && e > e0) {
          const deg = (Math.atan2(e - prev, step) * 180) / Math.PI;
          if (deg > worst.deg) worst = { deg, distM: d, brg };
        }
        prev = e;
      }
    }
    return known ? { ...worst, e0 } : null;
  };
  /** Where the place stands between the lowest and highest ground round it (0 the floor, 1 the top). */
  const partRead = (p: XY): { f: number; reliefM: number; minM: number; maxM: number } | null => {
    const e0 = probe.elev(p[0], p[1]);
    const rel = reliefAround(probe, p, M.partWayWithinM.value);
    if (!Number.isFinite(e0) || !rel) return null;
    const relief = rel.maxM - rel.minM;
    return { f: relief > 0 ? (e0 - rel.minM) / relief : 0.5, reliefM: relief, minM: rel.minM, maxM: rel.maxM };
  };
  /** The way the ground at a place faces (the downslope bearing, degrees true) and its slope, from heights 60 m round it. */
  const aspectRead = (p: XY): { aspect: number; deg: number } | null => {
    const h = 60, e = (b: number) => { const q = offsetPt(p[0], p[1], b, h); return probe.elev(q[0], q[1]); };
    const n = e(0), ea = e(90), so = e(180), w = e(270);
    if (![n, ea, so, w].every(Number.isFinite)) return null;
    // the gradient points uphill: east and north components of the rise; the slope faces the other way
    const gx = (ea - w) / (2 * h), gy = (n - so) / (2 * h);
    const grad = Math.hypot(gx, gy);
    return { aspect: grad > 0 ? ((Math.atan2(-gx, -gy) * 180) / Math.PI + 360) % 360 : 0, deg: (Math.atan(grad) * 180) / Math.PI };
  };
  /** A recorded helipad / airfield within reach, else the nearest level patch (rings 150 m apart, 24 bearings). */
  const heliRead = (p: XY): { rec: { label: string; name: string | null; distM: number; brg: number } | null; patch: { distM: number; deg: number; brg: number } | null; known: boolean } => {
    const f = probe.features(p[0], p[1], M.helipadM.value, new Set(M.helipadKinds))[0];
    if (f) return { rec: { label: f.label, name: f.name, distM: f.distM, brg: bearingOf(p, [f.x, f.y]) }, patch: null, known: true };
    const half = M.helipadSideM.value / 2, tanD = Math.tan((M.helipadDeg.value * Math.PI) / 180);
    let known = false;
    for (let r = 0; r <= M.helipadM.value + 1e-6; r += 150) {
      const nb = r ? 24 : 1;
      for (let b = 0; b < nb; b++) {
        const c: XY = r ? offsetPt(p[0], p[1], b * 15, r) : p;
        const es = [c, offsetPt(c[0], c[1], 0, half), offsetPt(c[0], c[1], 90, half), offsetPt(c[0], c[1], 180, half), offsetPt(c[0], c[1], 270, half)].map((q) => probe.elev(q[0], q[1]));
        if (es.some((e) => !Number.isFinite(e))) continue;
        known = true;
        const g = Math.hypot((es[1] - es[3]) / (2 * half), (es[2] - es[4]) / (2 * half));
        const cl = probe.cls(c[0], c[1]);
        if (g <= tanD && !(cl !== null && rule.nogo[cl])) return { rec: null, patch: { distM: r, deg: (Math.atan(g) * 180) / Math.PI, brg: b * 15 }, known };
      }
    }
    return { rec: null, patch: null, known };
  };
  /** The share of the area on rocky / stony ground (rules.json class), of the samples whose class is known. */
  const rockRead = (ring: XY[]): { share: number; known: number } => {
    const pts = areaSamples(ring, 60, 200);
    let k = 0, rock = 0;
    for (const q of pts) {
      const cl = probe.cls(q.x, q.y);
      if (cl === null) continue;
      k++;
      if (M.rockClasses.includes(cl)) rock++;
    }
    return { share: k ? rock / k : 0, known: k };
  };
  const wantWater = K.needs.includes('water') || mtn || des;
  const wantBld = K.needs.includes('buildings');
  const wantEvac = K.needs.includes('evacRoad');

  const build = (c: AdminCand): AdminSite => {
    const r = c.read;
    const rows: AdminRow[] = [];
    if (c.tM !== null && task.gun && reach !== null) {
      const margin = c.tM - reach;
      rows.push({
        key: 'beyond',
        label: `Beyond en ${K.beyond.value}`,
        value: `${km(c.tM)} from the threat; ${task.gun.name} reaches ${km(reach)}`,
        tone: margin >= 0 ? 'ok' : 'bad',
        why: `${K.short} clear of en ${K.beyond.value} guns; ${task.gun.name} ${km(task.gun.rangeM)}${task.gunDepthM > 0 ? `, his guns ${km(task.gunDepthM)} behind the threat place` : ', measured as if his guns stood at the threat place'}`,
        fix: margin < 0 ? `Move ${km(-margin)} further back` : undefined,
        rules: uniqRefs(refs.beyond),
      });
    }
    if (K.behind && c.fM !== null) {
      const want = K.behind[task.op];
      const tol = K.behind.tol.value;
      const off = (c.fM - want.value) / want.value;
      rows.push({
        key: 'behind',
        label: 'Behind front',
        value: `${km(c.fM)} behind ${task.front!.label}; ${task.op === 'def' ? 'defence' : task.op === 'adv' ? 'advance' : 'withdrawal'} wants ${km(want.value, 0)}`,
        tone: Math.abs(off) <= tol ? 'ok' : 'warn',
        why: `within ${pctV(tol)} of the figure counts as on it; within 1st line turn-round of forward units ${km(K.behind.turnRoundM.value, 0)}`,
        fix: off > tol ? "Far back: forward units' 1st line turn-round grows" : off < -tol ? 'Near the front for this operation' : undefined,
        rules: refs.behind,
      });
      // the desert: as far forward as possible, within easy turn-round of the field formations (DW s24 paras 7 h, 8 a p 82):
      // an area behind the operation's figure warns there, beyond the en gun the Beyond row still holds it back
      if (des) rows.push({
        key: 'forward',
        label: 'Forward (desert)',
        value: off <= 0 ? `${km(c.fM)} behind, at or forward of the ${km(want.value, 0)} figure` : `${km(c.fM - want.value)} behind the ${km(want.value, 0)} figure`,
        tone: off <= 0 ? 'ok' : 'warn',
        why: 'in the desert administrative areas are sited as far forward as possible to reduce the turn-round, within easy turn-round of the field formations, and protected: vehicle endurance falls in low gear (DW s24 paras 7 h, 8 a p 82)',
        fix: off > 0 ? 'Forward toward the figure, still clear of the en guns (Beyond row); protect it (AD, local defence)' : undefined,
        rules: uniqRefs([...refs.behind, ...dRefs.forward]),
      });
    }
    const unknownGround = r.known < r.n * C.minKnownShare.value;
    rows.push({
      key: 'firm',
      label: task.season === 'wet' ? 'Firm (wet)' : 'Firm (dry)',
      value: r.soilKnown === 0 ? 'not read' : r.softNogo > 0 ? `${pct(r.softNogo)} too soft for wheels` : r.softSlow > 0 ? `${pct(r.softSlow)} marginal` : 'firm',
      tone: r.soilKnown === 0 ? 'unknown' : r.softNogo > R.ground.maxSoftShare.value ? 'bad' : r.softNogo + r.softSlow * C.marginalWeight.value > C.firmWarnShare.value ? 'warn' : 'ok',
      why: `hard standing for loaded vehicles on the ${task.season === 'wet' ? 'after-rain' : 'dry'} cone index`,
      fix: r.softNogo > 0 ? 'Keep vehicles on the hard parts and the Rds; lay hard standing' : undefined,
      rules: refs.firm,
    });
    const floodBad = task.season === 'wet' && r.floodProne > R.ground.maxFloodShare.value;
    rows.push({
      key: 'wet',
      label: 'Flood / drainage',
      value: r.wetKnown === 0 ? 'not read' : r.wetBad > 0 ? `${pct(r.wetBad)} under water / waterlogged` : r.floodProne > 0 ? `${pct(r.floodProne)} flood-prone / riverbed` : 'dry Gr',
      tone: r.wetKnown === 0 ? 'unknown' : r.wetBad > R.ground.maxWetShare.value || floodBad ? 'bad' : r.floodProne > 0 || r.wetBad > 0 ? 'warn' : 'ok',
      why: `drainage and water table; flood-prone Gr fails in a wet month over ${pctV(R.ground.maxFloodShare.value)}`,
      fix: r.wetBad > 0 || floodBad ? 'Higher, drained Gr: off the riverbed and the flood plain' : undefined,
      rules: refs.wet,
    });
    rows.push({
      key: 'room',
      label: 'Room',
      value: unknownGround ? 'not read' : `${pct(1 - r.nogo)} usable of ${metres(frontM)} x ${metres(depthM)}${r.tiltDeg !== null ? `, ${r.tiltDeg.toFixed(1)}° tilt` : ''}`,
      tone: unknownGround ? 'unknown' : r.nogo > R.ground.maxNogoShare.value || (r.tiltDeg ?? 0) > R.ground.maxTiltDeg.value ? 'warn' : 'ok',
      why: `room to disperse at ${R.vehPerKm2.value} veh per km²: ${K.label} ${metres(frontM)} x ${metres(depthM)}`,
      fix: r.nogo > R.ground.maxNogoShare.value ? 'Split the area or take the next site' : undefined,
      rules: uniqRefs([...refs.size, ...figRefs(R.vehPerKm2, `${R.vehPerKm2.value} veh per km² (dispersion)`, S), ...refs.room, ...refs.nogo, ...refs.known, ...(mtn ? mRefs.room : [])]),
    });
    const cm = r.concealMean;
    rows.push({
      key: 'air',
      label: 'Hidden from air',
      value: cm === null ? 'not read' : `${['none', 'poor', 'fair', 'good'][Math.max(0, Math.min(3, Math.round(cm)))]}${r.trees > 0.1 ? `, trees ${pct(r.trees)}` : ''}`,
      tone: cm === null ? 'unknown' : cm >= R.air.goodMean.value ? 'ok' : cm >= R.air.poorMean.value ? 'warn' : 'bad',
      why: 'concealment from the air over the area (land cover)',
      fix: cm !== null && cm < R.air.goodMean.value ? 'Disperse under tree lines and orchards; camouflage; no new tracks' : undefined,
      rules: refs.air,
    });
    const roads = probe.roads(c.at[0], c.at[1], R.road.searchM.value);
    const road = pickRoad(roads, R.road.minTier.value);
    const rd = road.road?.distM ?? null;
    const tierOk = road.tier >= R.road.minTier.value;
    const wetFair = task.season === 'wet' && road.road && !road.allWeather;
    const onMain = roads.some((x) => (x.attrs.m || ['motorway', 'trunk', 'primary'].includes(String(x.attrs.t))) && x.distM < R.road.offMainM.value);
    rows.push({
      key: 'road',
      label: 'Rd',
      value: rd === null ? `no Rd within ${km(R.road.searchM.value)}` : `${metres(rd)} to ${road.label}${road.msr ? ' (MSR)' : ''}`,
      tone: rd === null || rd > R.road.maxM.value * C.roadFailX.value ? 'bad' : rd > R.road.maxM.value || !tierOk || wetFair || onMain ? 'warn' : 'ok',
      why: `a class ${R.road.minTier.value >= 3 ? '60' : R.road.minTier.value >= 2 ? '50' : ''}+ all-weather Rd within ${metres(R.road.maxM.value)}; off the main Rd${road.tier === 0 && road.road ? '; load class not recorded' : ''}${onMain ? '; the area sits on a main Rd' : ''}`,
      fix: rd === null || rd > R.road.maxM.value ? 'Recce a Rd in' : !tierOk ? 'Check the Brs on the way in' : onMain ? 'Shift the area off the main Rd; site IN and OUT' : wetFair ? 'Fair-weather Rd: plan another way in after rain' : undefined,
      rules: refs.road,
    });
    const lm = probe.features(c.at[0], c.at[1], R.avoid.landmarkM.value, new Set(R.avoid.kinds));
    const buaBad = r.bua > R.avoid.buaShare.value;
    const lmWords = [...new Set(lm.slice(0, 3).map((f) => `${f.label} ${metres(f.distM)}`))];
    rows.push({
      key: 'avoid',
      label: 'Avoid',
      value: [buaBad ? `BUA ${pct(r.bua)}` : '', ...lmWords].filter(Boolean).join(', ') || 'clear',
      tone: buaBad || lm.length ? 'warn' : 'ok',
      why: `Brs and Rd junctions are air targets (${metres(R.avoid.landmarkM.value)}); a BUA brings civilians`,
      fix: buaBad || lm.length ? 'Shift the area away from the Br / junction / BUA' : undefined,
      rules: refs.avoid,
    });
    if (mtn) {
      // Slides (MW p 264 para 3 c: free of danger from slides; p 281: most dangerous over 35°, deep new snow over 25°)
      const sl = slideRead(c.at);
      const snow = sl ? snowy(sl.e0) : false;
      const slBad = !!sl && sl.deg > M.slideDeg.value, slWarn = !!sl && !slBad && sl.deg > M.freshSnowDeg.value && snow;
      rows.push({
        key: 'slides',
        label: 'Slides',
        value: !sl ? 'not read' : sl.deg > M.freshSnowDeg.value ? `slope ${Math.round(sl.deg)}° above it, ${metres(sl.distM)} ${compass(sl.brg)}` : `nothing over ${M.freshSnowDeg.value}° above it`,
        tone: !sl ? 'unknown' : slBad ? 'bad' : slWarn ? 'warn' : 'ok',
        why: `free of danger from slides (MW p 264); snow slides are most dangerous on slopes over ${M.slideDeg.value}°, and deep new snow slides on slopes over ${M.freshSnowDeg.value}° for 2-3 days after a fall (p 281); read every ${SLIDE_STEP_M} m on the 30 m elevation grid, so a pitch shorter than a cell is not seen${sl && sl.deg > M.freshSnowDeg.value && !slBad ? (snow ? `; at ${Math.round(sl.e0)} m snow lies here in the winter months` : '; below the snow, or out of the snow months: a warning only after a fall') : ''}`,
        fix: slBad ? 'Away from the foot of the steep slope: a spur or a gentler hillside, the area clear of the run-out' : slWarn ? 'Watch the slope after a snowfall: keep the area clear for 2-3 days, or site it away from the slope' : undefined,
        rules: uniqRefs(mRefs.slides),
      });
      // Part way up the slope (p 264), not the valley floor where the nullahs flood (p 9), nor the top
      const pw = partRead(c.at);
      const level = !!pw && pw.reliefM < M.partWayMinReliefM.value;
      const low = !!pw && !level && pw.f < M.partWayLow.value, high = !!pw && !level && pw.f > M.partWayHigh.value;
      rows.push({
        key: 'partway',
        label: 'Part way up',
        value: !pw ? 'not read' : level ? `level Gr (${Math.round(pw.reliefM)} m of relief within ${km(M.partWayWithinM.value)})` : `${pct(pw.f)} of the way up (${Math.round(pw.minM)}-${Math.round(pw.maxM)} m within ${km(M.partWayWithinM.value)})`,
        tone: !pw ? 'unknown' : low || high ? 'warn' : 'ok',
        why: low ? 'on the valley floor: flash floods run in the nullahs (MW p 9); the book wants part way up the slope (p 264)' : high ? 'on the top: the book wants the downwind side of the hill and part way up the slope (p 264)' : 'part way up the slope, on the downwind side of the hill (MW p 264)',
        fix: low ? 'Up the side of the valley, clear of the nullah bed and its flood line' : high ? 'Down the downwind side, part way up the slope' : undefined,
        rules: uniqRefs(mRefs.partway),
      });
      // Downwind side of the hill (p 264): the slope it stands on against the month's usual wind (the wind grid)
      const asp = aspectRead(c.at);
      const wind = task.month !== undefined && probe.windAt ? probe.windAt(c.at[0], c.at[1], task.month) : null;
      const flat = !!asp && asp.deg < M.aspectMinDeg.value;
      const varWind = !!wind && (wind.fromDeg === null || wind.steady < M.windSteadyMin.value);
      const goes = wind && wind.fromDeg !== null ? (wind.fromDeg + 180) % 360 : null;
      const off = asp && goes !== null ? Math.abs((((asp.aspect - goes) % 360) + 540) % 360 - 180) : null;
      const lee = off !== null && off <= M.leeDeg.value;
      const turnTxt = wind && wind.dayFromDeg !== null && wind.nightFromDeg !== null && Math.abs((((wind.dayFromDeg - wind.nightFromDeg) % 360) + 540) % 360 - 180) >= 90 ? `; it turns: by day from ${compass(wind.dayFromDeg)}, by night from ${compass(wind.nightFromDeg)} (valley winds)` : '';
      rows.push({
        key: 'downwind',
        label: 'Downwind',
        value: task.month === undefined ? 'no month given' : !asp ? 'not read' : !wind ? 'no wind grid read' : flat ? `level Gr (${asp.deg.toFixed(0)}°)` : varWind ? `wind variable; slope faces ${compass(asp.aspect)}` : `slope faces ${compass(asp.aspect)}, wind from ${compass(wind.fromDeg!)}`,
        tone: task.month === undefined || !asp || !wind || flat || varWind ? 'unknown' : lee ? 'ok' : 'warn',
        why: `the downwind side of hills (MW p 264): the slope the area stands on faces within ${M.leeDeg.value}° of where the month's usual wind goes${wind && !varWind && wind.fromDeg !== null ? ` (the wind from ${compass(wind.fromDeg)}, steadiness ${wind.steady.toFixed(2)}${turnTxt})` : varWind ? ` (in this month the wind here has no steady direction, steadiness ${wind!.steady.toFixed(2)} under ${M.windSteadyMin.value}: confirm on the ground)` : ''}; the usual wind is a ${wind?.dataDate ?? '1990-2019'} normal, not a forecast${task.month === undefined ? '; give the month to read it' : ''}`,
        fix: !lee && off !== null && !flat && !varWind && goes !== null ? `To the far side of the hill from the wind: the slope facing ${compass(goes)}` : undefined,
        rules: uniqRefs(mRefs.downwind),
      });
      // Rock or gravel (p 265)
      const rk = rockRead(rectRing(c.at, c.axis, frontM, depthM));
      const firmOk = r.soilKnown > 0 && r.softNogo === 0 && r.softSlow * C.marginalWeight.value <= C.firmWarnShare.value;
      rows.push({
        key: 'rock',
        label: 'Rock / gravel',
        value: !rk.known ? 'not read' : rk.share >= M.rockShare.value ? `rocky / stony Gr ${pct(rk.share)}` : `rocky Gr ${pct(rk.share)}${firmOk ? '; firm soil on the cone index' : ''}`,
        tone: !rk.known && r.soilKnown === 0 ? 'unknown' : rk.share >= M.rockShare.value || firmOk ? 'ok' : 'warn',
        why: 'good soil conditions: rock or gravel (MW p 265); firm soil on the cone index stands in for it',
        fix: rk.share < M.rockShare.value && !firmOk ? 'Hard standing: rock or gravel patches, or lay it' : undefined,
        rules: uniqRefs([...mRefs.rock, ...refs.firm]),
      });
      // Helipad Gr within reach (p 265 para 3 g; helipads 4° or less, p 256)
      const hl = heliRead(c.at);
      rows.push({
        key: 'helipad',
        label: 'Helipad Gr',
        value: hl.rec ? `${hl.rec.label}${hl.rec.name ? ` ${hl.rec.name}` : ''} ${metres(hl.rec.distM)} ${compass(hl.rec.brg)}` : hl.patch ? `level patch ${hl.patch.deg.toFixed(0)}° ${hl.patch.distM ? `${metres(hl.patch.distM)} ${compass(hl.patch.brg)}` : 'on the area'}` : hl.known ? `no patch of ${M.helipadDeg.value}° or less within ${km(M.helipadM.value)}` : 'not read',
        tone: hl.rec || hl.patch ? 'ok' : hl.known ? 'warn' : 'unknown',
        why: `near terrain for an all season airstrip / helipads (MW p 265); a helipad ${M.helipadDeg.value}° or less, a landing point ${M.helipadSideM.value} m across${hl.patch ? ': the patch read from the 30 m elevation, confirm it on the ground' : ''}`,
        fix: !hl.rec && !hl.patch && hl.known ? 'Engineers build a helipad (MW p 248), or take a site nearer level ground' : undefined,
        rules: uniqRefs(mRefs.helipad),
      });
    }
    if (wantWater) {
      const w = probe.features(c.at[0], c.at[1], R.needs.waterM.value, new Set(R.needs.waterKinds))[0] ?? null;
      rows.push({
        key: 'water',
        label: 'Water',
        value: w ? `${w.label} ${metres(w.distM)} ${compass(bearingOf(c.at, [w.x, w.y]))}` : `none recorded within ${km(R.needs.waterM.value)}`,
        tone: w ? 'ok' : 'warn',
        why: `a water point within ${km(R.needs.waterM.value)}${mtn ? '; in mountains near a stream or lake (MW p 264), water being seldom found on the heights (p 266)' : des ? '; in the desert sweet water is found only in the tobas and the green belt, the wells low-yield and brackish (DW pp 66, 80); water points kept open round the clock (p 86)' : ''}`,
        fix: w ? undefined : mtn ? 'Near a stream or lake; water by mule or porter to the heights' : des ? 'Water by bowser from the green belt, storage at the source and at the area (DW p 80); recce the tobas and tube wells' : 'Plan water by bowser; recce wells',
        rules: mtn ? uniqRefs([...refs.water, ...mRefs.water]) : des ? uniqRefs([...refs.water, ...dRefs.water]) : refs.water,
      });
    }
    if (wantBld) {
      const b = probe.features(c.at[0], c.at[1], R.needs.buildingsM.value, new Set(R.needs.buildingKinds))[0] ?? null;
      rows.push({
        key: 'buildings',
        label: 'Pucca bldg',
        value: b ? `${b.label}${b.name ? ` ${b.name}` : ''} ${metres(b.distM)}` : `none recorded within ${km(R.needs.buildingsM.value)}`,
        tone: b ? 'ok' : 'warn',
        why: task.kind === 'ads' ? 'ADS preferably in a pucca bldg: BHU, RHC, school' : 'covered accommodation, power, water and storage',
        fix: b ? undefined : 'Tentage; recce bldgs',
        rules: refs.buildings,
      });
    }
    if (wantEvac) {
      const aw = roads.find((x) => x.attrs.aw);
      rows.push({
        key: 'evac',
        label: 'Evac Rd',
        value: aw ? `all-weather Rd ${metres(aw.distM)}` : 'no all-weather Rd near',
        tone: aw && aw.distM <= R.needs.evacM.value ? 'ok' : 'warn',
        why: `near evacuation routes: an all-weather Rd within ${metres(R.needs.evacM.value)}`,
        rules: refs.evac,
      });
    }
    if (r.peopleKm2 !== null) {
      const p = Math.round(r.peopleKm2);
      rows.push({ key: 'people', label: 'People', value: `${p.toLocaleString('en-US')} per km²`, tone: p > C.peopleWarnKm2.value ? 'warn' : 'ok', why: 'WorldPop 2026 estimate on the area: civilians, movement and security', rules: refs.people });
    }
    let score = 0, wsum = 0;
    for (const row of rows) {
      const w = R.weights[row.key] ?? 1;
      score += w * toneScore(row.tone, R);
      wsum += w;
    }
    score = wsum ? score / wsum : 0;
    const tone = worstTone(rows.map((x) => x.tone));
    const fails = rows.filter((x) => x.tone === 'bad').map((x) => x.label);
    const verdict = tone === 'ok' ? `Good ${K.short} site` : tone === 'bad' ? `Fails: ${fails.join(', ')}` : tone === 'unknown' ? 'Partly read' : 'Usable, with work';
    return { rank: 0, at: c.at, axisDeg: c.axis, ring: rectRing(c.at, c.axis, frontM, depthM), score, tone, verdict, rows, read: r, road, threatM: c.tM, frontM: c.fM, fixes: rows.filter((x) => x.fix).map((x) => `${x.label}: ${x.fix}`), why: [] };
  };

  return { K, frontM, depthM, refs, gates, read, readFails, pre, build, reach, mtn, mRefs, des };
}

/** Why each site stands where it does (as GunDeploymentFind.explainOrder). */
export function explainAdminOrder(sites: AdminSite[], total: number): void {
  const counts = (s: AdminSite) => {
    const c: Record<Tone, number> = { ok: 0, warn: 0, unknown: 0, bad: 0 };
    for (const r of s.rows) c[r.tone]++;
    return c;
  };
  const worseRows = (a: AdminSite, b: AdminSite) =>
    b.rows
      .map((rb) => ({ rb, ra: a.rows.find((x) => x.key === rb.key) }))
      .filter(({ ra, rb }) => ra && TONE_RANK[rb.tone] > TONE_RANK[ra.tone])
      .map(({ ra, rb }) => `${rb.label}: #${b.rank} ${rb.value} (${TONE_WORD[rb.tone]}); #${a.rank} ${ra!.value} (${TONE_WORD[ra!.tone]})`);
  // the finer reading that orders sites with the same results, as shown
  const finer = (a: AdminSite, b: AdminSite) => {
    const out: string[] = [];
    const pairs: Array<[string, string, string]> = [
      ['usable room', pct(1 - a.read.nogo), pct(1 - b.read.nogo)],
      ['soft Gr', pct(a.read.softNogo), pct(b.read.softNogo)],
      ['wet / flood-prone Gr', pct(a.read.wetBad + a.read.floodProne), pct(b.read.wetBad + b.read.floodProne)],
      ['concealment', (a.read.concealMean ?? 0).toFixed(1), (b.read.concealMean ?? 0).toFixed(1)],
      ['BUA', pct(a.read.bua), pct(b.read.bua)],
    ];
    for (const [k, x, y] of pairs) if (x !== y) out.push(`${k} ${x} against ${y}`);
    return out;
  };
  const tie = (a: AdminSite, b: AdminSite, who: string) => {
    const f = finer(a, b);
    return f.length
      ? `Same result as ${who} on every check; the finer readings differ only slightly (${who} first: ${f.join(', ')}). Treat them as equal choices.`
      : `Same result as ${who} on every check and the same readings: equal choices, listed nearer the search centre first.`;
  };
  sites.forEach((s, i) => {
    const c = counts(s);
    const tally = `${c.ok} of ${s.rows.length} checks pass${c.warn ? `, ${c.warn} need work` : ''}${c.bad ? `, ${c.bad} fail` : ''}${c.unknown ? `, ${c.unknown} not read` : ''}`;
    if (i === 0) {
      s.why = [`Chosen: first of ${total} places read in full. ${s.verdict}; ${tally}.`];
      const next = sites[1];
      if (next) {
        const better = worseRows(s, next);
        s.why.push(better.length ? `Preferred over #2, which is worse on: ${better.join('; ')}.` : `#2: ${tie(s, next, '#1')}`);
      }
      return;
    }
    const above = sites[i - 1];
    const worse = worseRows(above, s);
    s.why = [worse.length ? `Below #${above.rank}: worse on ${worse.join('; ')}.` : tie(above, s, `#${above.rank}`), `${s.verdict}; ${tally}.`];
  });
}

export function findAdminSites(probe: SiteProbe, rules: any, task: AdminTask, R: AdminRules): AdminResult {
  const A = adminScorer(probe, rules, task, R);
  const K = A.K;
  const { frontM, depthM } = A;
  const notes: string[] = [];
  const rejected = { nogo: 0, gun: 0, room: 0, wet: 0 };
  const firstFail: Partial<Record<AdminGateFail['gate'], AdminGateFail>> = {};
  const step = Math.max(100, Math.min(frontM, depthM) / 3);
  const pts = lattice(task.centre, task.radiusM, step);
  const cands: AdminCand[] = [];
  for (const p of pts) {
    const g = A.gates(p);
    if (g.fails.length) {
      const f = g.fails[0];
      rejected[f.gate]++;
      firstFail[f.gate] ??= f;
      continue;
    }
    const fM = task.front ? nearestDist(p, task.front.runs).d : null;
    const read = A.read(p, g.axis);
    const rf = A.readFails(read);
    if (rf.length) {
      rejected[rf[0].gate]++;
      firstFail[rf[0].gate] ??= rf[0];
      continue;
    }
    cands.push({ at: p, axis: g.axis, read, pre: A.pre(read), tM: g.tM, fM });
  }
  cands.sort((a, b) => b.pre - a.pre);
  const top = spreadPick(cands, Math.max(step, Math.min(frontM, depthM) / 2), R.scan.keep);
  const sites = top.map((c) => A.build(c));
  sites.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || b.score - a.score);
  const picked = spreadPick(sites, Math.max(frontM, depthM), R.scan.maxSites);
  picked.forEach((s, i) => (s.rank = i + 1));
  explainAdminOrder(picked, cands.length);
  const tot = pts.length || 1;
  const GATE_TEXT: Record<AdminGateFail['gate'], string> = {
    gun: `within reach of ${task.gun?.name ?? 'his guns'}`,
    nogo: 'the centre is on Gr wheels cannot use',
    room: 'without room',
    wet: 'wet Gr',
  };
  const rejectedWhy = (Object.keys(rejected) as Array<AdminGateFail['gate']>)
    .filter((k) => rejected[k] > 0)
    .map((k) => ({ gate: k, count: rejected[k], share: rejected[k] / tot, text: `${rejected[k]} of ${pts.length} places: ${GATE_TEXT[k]}${firstFail[k] ? ` (e.g. ${firstFail[k]!.text})` : ''}`, rules: firstFail[k]?.rules ?? [] }))
    .sort((a, b) => b.count - a.count);
  if (!picked.length) notes.push(`No ${K.short} site in this circle${rejectedWhy.length ? `: ${rejectedWhy.map((r) => `${pct(r.share)} ${GATE_TEXT[r.gate]}`).join(', ')}` : ''}. Look further back or widen the circle.`);
  if (!task.threat?.length) notes.push('No threat place: distance from his guns not checked (mark the threat or pick it on the map).');
  if (A.mtn) notes.unshift(mountainNote(R));
  if (A.des) notes.unshift(desertNote());
  return { sites: picked, tried: pts.length, rejected, rejectedWhy, notes, frontM, depthM, rule: K, kindRefs: A.refs.kind, orderRules: adminOrderRefs(R), mountain: A.mtn, desert: A.des };
}

/** What desert ground adds (DW s24 pp 79-83, s26 p 86), and what to confirm. */
export function desertNote(): string {
  return 'Desert ground (half the ground within 3 km bare, sand, dunes or salt pan): the checks for admin areas in the desert are added: Forward, as far forward as possible within easy turn-round of the field formations, and protected (DW s24 paras 7 h, 8 a p 82), and the Water row for every kind (sweet water only in the tobas and the green belt, p 80; water points open round the clock, p 86). Plan mobile ammunition points down to the forward Bdes, petrol points well forward and supply points within the turn-round of first line transport (para 8 b-d p 82); avoid frequent moves of the administrative echelons (para 8 e p 83); allow the lift of mines and defence stores (para 7 g p 82). The AD covers the critical logistic installations after the reserves and HQs (DW s18 para 5 p 63).';
}

/** What mountain ground adds, and what the bundle cannot read (MW s24-25 pp 263-265). */
export function mountainNote(R: AdminRules): string {
  const M = R.mountains;
  return `Mountain ground (within ${km(M.detectWithinM.value, 0)} the ground rises ${M.detectRiseM.value} m or more): the checks for admin areas in mountains are added: slides, part way up the slope, the downwind side of the hill (the month's usual wind), rock or gravel, helipad Gr and water (MW s25 para 3 pp 264-265). Confirm on the ground terrain that lends itself to defence (para 3 d): the terrain data does not read it. Where the sectors give no mutual support, stocks go to each sector with mobile log elements (para 4 p 265); from the road head animal transport takes over, portering the last resort (s24 para 12 pp 263-264).`;
}

/** "Why not here?": the place read with the same gates and checks as the search, set against the first site. */
export function adminWhyNot(probe: SiteProbe, rules: any, task: AdminTask, R: AdminRules, at: XY, best: AdminSite | null): AdminWhyNot {
  const A = adminScorer(probe, rules, task, R);
  const g = A.gates(at);
  const read = A.read(at, g.axis);
  const gates = [...g.fails, ...A.readFails(read)];
  const fM = task.front ? nearestDist(at, task.front.runs).d : null;
  const site = A.build({ at, axis: g.axis, read, pre: A.pre(read), tM: g.tM, fM });
  const vsBest: string[] = [];
  if (best)
    for (const rb of site.rows) {
      const ra = best.rows.find((x) => x.key === rb.key);
      if (ra && TONE_RANK[rb.tone] > TONE_RANK[ra.tone]) vsBest.push(`${rb.label}: here ${rb.value} (${TONE_WORD[rb.tone]}); #1 ${ra.value} (${TONE_WORD[ra.tone]})`);
    }
  const verdict = gates.length
    ? `Not listed: ${gates.map((x) => x.text).join('; ')}`
    : vsBest.length
      ? `Read in full, but #1 is better on ${vsBest.length} check${vsBest.length === 1 ? '' : 's'}`
      : 'Read in full: it passes the gates; the list keeps the best places an area apart';
  return { at, gates, site, vsBest, verdict };
}

/** The decision record: every site with its checks and the rules behind them, the order, the places left out. */
export function adminLines(res: AdminResult, task: AdminTask, grid: (p: XY) => string, dataLine = '', whyNot: AdminWhyNot | null = null): string[] {
  const L: string[] = [];
  const all = uniqRefs([...res.orderRules, ...res.sites.flatMap((s) => s.rows.flatMap((r) => r.rules)), ...res.rejectedWhy.flatMap((r) => r.rules), ...res.kindRefs, ...(whyNot ? [...whyNot.gates.flatMap((g) => g.rules), ...(whyNot.site?.rows.flatMap((r) => r.rules) ?? [])] : [])]);
  const cites = (rs: RuleRef[]) => {
    const n = [...new Set(uniqRefs(rs).map((r) => all.findIndex((x) => x.figure === r.figure && x.book === r.book && x.page === r.page && x.quote === r.quote && (x.note ?? '') === (r.note ?? '')) + 1))].filter((x) => x > 0);
    return n.length ? ` [${n.join(', ')}]` : '';
  };
  L.push(`ADMIN AREA - DECISION RECORD: ${res.rule.label}, ${metres(res.frontM)} x ${metres(res.depthM)}, ${task.season === 'wet' ? 'wet month' : 'dry month'}${task.gun ? `, clear of ${task.gun.name}` : ''}`);
  if (dataLine) L.push(`Data: ${dataLine}`);
  if (res.kindRefs.length) L.push(`${res.rule.short}: ${res.rule.note}${cites(res.kindRefs)}`);
  L.push(`Order: the worst check first, then the weighted checks, then the finer reading${cites(res.orderRules)}`);
  L.push('');
  for (const s of res.sites) {
    L.push(`${s.rank}. ${grid(s.at)}  ${s.verdict}`);
    for (const w of s.why) L.push(`   Why: ${w}`);
    for (const r of s.rows) L.push(`   ${r.label}: ${r.value}${r.tone === 'ok' ? '' : ` [${r.tone === 'bad' ? 'FAIL' : r.tone === 'warn' ? 'check' : 'not read'}]`}${cites(r.rules)}`);
    if (s.fixes.length) L.push(`   Fix: ${s.fixes.join('; ')}`);
  }
  if (res.rejectedWhy.length) {
    L.push('');
    L.push('Places left out (not read in full):');
    for (const r of res.rejectedWhy) L.push(`- ${r.text}${cites(r.rules)}`);
  }
  if (whyNot) {
    L.push('');
    L.push(`Why not ${grid(whyNot.at)}? ${whyNot.verdict}`);
    for (const g of whyNot.gates) L.push(`- ${g.text}${cites(g.rules)}`);
    for (const v of whyNot.vsBest) L.push(`- ${v}`);
  }
  for (const n of res.notes) L.push(n);
  L.push('');
  L.push('Rules and data cited (R Pakistani book, U US doctrine, E proposal: no book rule, T terrain data rule, D data: ORBAT, terrain bundle layers with their sources and dates, your inputs):');
  all.forEach((r, i) => L.push(`[${i + 1}] ${refLine(r)}`));
  L.push('');
  L.push('Book words and pages are checked against the PDFs by tools/doctrine-refs/verify.py. Sites come from 30 m terrain data and estimates: recce them on the ground.');
  return L;
}
