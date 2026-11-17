/**
 * GunDeploymentFind.ts
 *
 * The pure gun area finder (user, 2026-11-17: "Gun area finder with crest clearance"). No DOM, no ArcGIS, no I/O and
 * only erasable TypeScript, so Node runs it (tools/sitefinder-test/gun.mjs). Rules and figures come in as `GunRules`
 * (MS/Data/GunDoctrine.json through `gunRulesFrom`), the ground through SiteScan's `SiteProbe`.
 *
 * For a search circle, a target and the front, every lattice point is tried as the centre of a gun area (a Bty or Regt
 * gun area, frontage across the line of fire, depth along it) and read:
 *
 *   Room     the share of the area a gun can stand on (rules.json profile `gun`: canals, marsh, BUA, steep ground out);
 *   Level    the tilt of a plane fitted to the 30 m elevations, against the platform limits;
 *   Firm     the season's soil cone index against the guns' vehicles (towed: heavy wheels; SP: tracks);
 *   Air      concealment from the air (cc) and tree cover;
 *   Access   the nearest road, its load class and whether it is all-weather in the season;
 *   Range    the target against the planning range (and the minimum range of rockets);
 *   Front    the distance behind the front (the own FDL drawn on the map, else the threat place), and how far beyond it
 *            the guns still reach;
 *   Crest    toward the target: the crest's distance and height above the guns (ground + what stands on it), the angle
 *            of site to it in mils, a minimum QE and the nearest range low-angle fire clears it at (an estimate: the
 *            trajectory is a vacuum curve fitted to the weapon's maximum range; work the real one out with the firing
 *            tables);
 *   Avoid    built-up ground and landmarks (bridges, junctions, stations, masts) near the area.
 *
 * The best areas (at least the alternate spacing apart) are returned ranked, each with its rows (value, tone, why) and
 * the fixes for what fails. A verdict never claims more than the data shows: what the bundle cannot read is unknown.
 */

import {
  bearingOf,
  compass,
  goingRule,
  groundDist,
  km,
  lattice,
  metres,
  mils,
  offsetPt,
  pct,
  pickRoad,
  readSite,
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
  refWhere,
  type RefSource,
  type RuleRef,
  type GroundRule,
  type RoadPick,
  type Season,
  type SiteProbe,
  type SiteRead,
  type Tone,
  type XY,
} from '../SiteScan/SiteScan';

// ── rules ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Fig {
  value: number;
  basis: string;
  src: string;
  /** Book, page and words (GunDoctrine.json), with the verifier's result. */
  refs?: any[];
  /** Worked out from book figures: the working. */
  calc?: string;
  /** A decision with no book figure: where it was looked for. */
  searched?: string[];
  /** When it was decided (ISO date). */
  decided?: string;
}

export interface GunAreaSize {
  label: string;
  frontM: Fig;
  depthM: Fig;
}

export interface GunRules {
  areas: Record<'bty' | 'regt', GunAreaSize>;
  /** Alternate positions at least this far from the primary (also the spacing of the ranked list). */
  altMinM: Fig;
  /** Distance of the gun area behind the front, by task: [min, max] metres, or a fraction of the planning range. */
  front: Record<'def' | 'attk', { minM: Fig; maxFrac: Fig; note: string }>;
  /** Planning range as a share of the maximum (when weapons.json gives none). */
  planFrac: Fig;
  level: { okDeg: Fig; maxDeg: Fig };
  room: { okShare: Fig; minShare: Fig };
  firm: { maxSoftShare: Fig };
  air: { goodMean: Fig; poorMean: Fig };
  access: { maxM: Fig; searchM: Fig };
  avoid: { landmarkM: Fig; kinds: string[]; buaShare: Fig };
  crest: { searchM: Fig; minM: Fig; muzzleM: Fig; clearM: Fig; refraction: Fig; steepMils: Fig; highAngleMils: Fig; methodRefs: any[] };
  /** The doctrine's sources by id, for the rule lines. */
  sources: Record<string, RefSource>;
  /** Working thresholds of the checks (GunDoctrine.json checks: proposals with reasons). */
  checks: { minKnownShare: Fig; firmWarnShare: Fig; marginalWeight: Fig; accessFailX: Fig; crestMaxUnknown: Fig };
  scan: { stepM: number; radiusM: number; keep: number; maxSites: number; note: string; frontGateFrac: Fig; minKnownGate: Fig };
  /** How the list is ordered (GunDoctrine.json order). */
  order: { note: string; toneScore: Record<Tone, number>; toneSrc: string; weightsSrc: string; pre: Record<string, number>; preSrc: string };
  weights: Record<string, number>;
}

/** A figure's working (calc), where a decision was looked for (searched) and when it was decided. */
const figExtra = (v: any): { calc?: string; searched?: string[]; decided?: string } => ({
  ...(v?.calc ? { calc: String(v.calc) } : {}),
  ...(Array.isArray(v?.searched) ? { searched: v.searched.map(String) } : {}),
  ...(v?.decided ? { decided: String(v.decided) } : {}),
});

const fig = (v: any, value: number, basis = 'E', src = 'default in GunDeploymentFind.ts'): Fig => {
  if (v && typeof v === 'object' && Number.isFinite(Number(v.value))) return { value: Number(v.value), basis: String(v.basis ?? basis), src: String(v.src ?? src), refs: Array.isArray(v.refs) ? v.refs : undefined, ...figExtra(v) };
  if (Number.isFinite(Number(v)) && v !== null && v !== '') return { value: Number(v), basis, src };
  return { value, basis, src };
};

/** GunDoctrine.json -> rules, every figure kept with its basis and source; missing figures fall back to marked defaults. */
export function gunRulesFrom(doc: any): GunRules {
  const d = doc ?? {};
  const area = (k: 'bty' | 'regt', f: number, dp: number, label: string): GunAreaSize => ({
    label: String(d.areas?.[k]?.label ?? label),
    frontM: fig(d.areas?.[k]?.frontM, f),
    depthM: fig(d.areas?.[k]?.depthM, dp),
  });
  const frontOf = (k: 'def' | 'attk', minM: number, maxFrac: number) => ({
    minM: fig(d.front?.[k]?.minM, minM),
    maxFrac: fig(d.front?.[k]?.maxFrac, maxFrac),
    note: String(d.front?.[k]?.note ?? ''),
  });
  const s = d.scan ?? {};
  return {
    areas: { bty: area('bty', 400, 300, 'Bty gun area'), regt: area('regt', 1500, 800, 'Regt gun area') },
    altMinM: fig(d.altMinM, 400),
    front: { def: frontOf('def', 1500, 0.5), attk: frontOf('attk', 1000, 0.4) },
    planFrac: fig(d.planFrac, 0.9),
    level: { okDeg: fig(d.level?.okDeg, 3), maxDeg: fig(d.level?.maxDeg, 7) },
    room: { okShare: fig(d.room?.okShare, 0.9), minShare: fig(d.room?.minShare, 0.7) },
    firm: { maxSoftShare: fig(d.firm?.maxSoftShare, 0.2) },
    air: { goodMean: fig(d.air?.goodMean, 2), poorMean: fig(d.air?.poorMean, 1) },
    access: { maxM: fig(d.access?.maxM, 500), searchM: fig(d.access?.searchM, 2000) },
    avoid: { landmarkM: fig(d.avoid?.landmarkM, 500), kinds: Array.isArray(d.avoid?.kinds) ? d.avoid.kinds.map(String) : ['20', '21', '50', '159', '166', '60', '78', '79'], buaShare: fig(d.avoid?.buaShare, 0.05) },
    crest: {
      searchM: fig(d.crest?.searchM, 8000),
      minM: fig(d.crest?.minM, 30),
      muzzleM: fig(d.crest?.muzzleM, 2),
      clearM: fig(d.crest?.clearM, 5),
      refraction: fig(d.crest?.refraction, 0.13),
      steepMils: fig(d.crest?.steepMils, 300),
      highAngleMils: fig(d.crest?.highAngleMils, 800),
      methodRefs: Array.isArray(d.crest?.methodRefs) ? d.crest.methodRefs : [],
    },
    sources: refSources(d),
    checks: {
      minKnownShare: fig(d.checks?.minKnownShare, 0.6),
      firmWarnShare: fig(d.checks?.firmWarnShare, 0.1),
      marginalWeight: fig(d.checks?.marginalWeight, 0.5),
      accessFailX: fig(d.checks?.accessFailX, 2),
      crestMaxUnknown: fig(d.checks?.crestMaxUnknown, 0.3),
    },
    scan: {
      stepM: Number(s.stepM) || 100,
      radiusM: Number(s.radiusM) || 4000,
      keep: Number(s.keep) || 60,
      maxSites: Number(s.maxSites) || 6,
      note: String(s.note ?? 'Search: places tried every stepM metres; the best read in full'),
      frontGateFrac: fig(s.frontGateFrac, 0.5),
      minKnownGate: fig(s.minKnownGate, 0.5),
    },
    order: {
      note: String(d.order?.note ?? 'worst check first, then the weighted score, then the finer reading'),
      toneScore: { ok: Number(d.order?.toneScore?.ok ?? 1), warn: Number(d.order?.toneScore?.warn ?? 0.55), unknown: Number(d.order?.toneScore?.unknown ?? 0.4), bad: Number(d.order?.toneScore?.bad ?? 0) },
      toneSrc: String(d.order?.toneScore?.src ?? 'pass 1, needs work 0.55, not read 0.4, fails 0'),
      weightsSrc: String(d.order?.weightsNote?.src ?? 'weights in GunDoctrine.json'),
      pre: { room: 3, levelOk: 2, levelMax: 1, firm: 1.5, concealDiv: 1.5, bua: -2, wet: -3, ...Object.fromEntries(Object.entries(d.order?.pre ?? {}).filter(([, v]) => typeof v === 'number')) } as Record<string, number>,
      preSrc: String(d.order?.pre?.src ?? 'finer reading'),
    },
    weights: { room: 3, level: 2, firm: 2, air: 2, access: 2, range: 2, front: 2, crest: 3, avoid: 1, ...(d.weights ?? {}) },
  };
}

// ── weapons ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface GunWeapon {
  id: string;
  name: string;
  /** weapons.json type: how, gun, mbrl, mortar. */
  type: string;
  maxM: number;
  planM: number;
  minM: number;
  /** Self-propelled: tracked going and soil. */
  sp: boolean;
  page: string;
  /** Howitzers and mortars can fire high angle over a crest that masks low-angle fire. */
  highAngle: boolean;
}

/** Own artillery from ORBAT weapons.json (side own; how, gun, mbrl, 120 mm mortar), with a range. */
export function gunWeapons(weaponsDoc: any, planFrac = 0.9): GunWeapon[] {
  const out: GunWeapon[] = [];
  for (const w of (weaponsDoc?.weapons ?? []) as any[]) {
    if (w?.side !== 'own') continue;
    const t = String(w.type ?? '');
    const arty = t === 'how' || t === 'gun' || t === 'mbrl' || (t === 'mortar' && /arty/i.test(String(w.section ?? '')));
    if (!arty) continue;
    const pr = w.planRangeM ?? {};
    const max = Number(pr.max ?? w.rangeM?.max);
    if (!(max > 0)) continue;
    const name = String(w.name ?? w.id);
    out.push({
      id: String(w.id),
      name,
      type: t,
      maxM: max,
      planM: Number(pr.plan) > 0 ? Number(pr.plan) : Math.round(max * planFrac),
      minM: Number(pr.min) > 0 ? Number(pr.min) : 0,
      sp: /\(SP\)|\bSP\b/.test(name),
      page: String(w.page ?? ''),
      highAngle: t === 'how' || t === 'mortar',
    });
  }
  return out;
}

// ── crest ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What stands on the ground at a point (trees, crops, buildings), metres above the elevation. */
export type StandingFn = (x: number, y: number) => number;

export interface CrestRead {
  /** The crest: ground distance from the guns, height above the muzzle (ground + standing - earth's curve), where. */
  distM: number;
  heightM: number;
  at: XY;
  /** Angle of site to the crest, mils (negative: no crest above the guns). */
  siteMils: number;
  /** Piece-to-crest range, to the nearest 100 m (FM 6-50 ch 6). */
  pcrM: number;
  /** FM 6-50 Angle 1 (site to crest) and Angle 2 (5 m vertical clearance / PCR km), each rounded up to the next mil. */
  a1Mils: number;
  a2Mils: number;
  /** Angle 4, elevation at PCR, as an estimate (vacuum curve fitted to the maximum range); the firing tables give it. */
  a4EstMils: number;
  /** A1 + A2 + A4 (estimate). Angle 3 (comp site) and Angle 5 (2 forks) come from the firing tables and add to it. */
  minQeMils: number;
  /** A1 + A2 over 300 mils: the rapid tables cannot be used (FM 6-50 p 6-2). */
  steep: boolean;
  /** The nearest range low-angle fire clears the crest at (estimate); null when it clears at any range. */
  lowMinRangeM: number | null;
  /** Low-angle fire clears nothing up to the maximum range. */
  masksAll: boolean;
  /** Samples along the line that were unknown (no elevation): the read is partial when this is high. */
  unknownShare: number;
}

const EARTH_R = 6371000;

/** Elevation for range `r` on a vacuum curve fitted to the maximum range (sin 2θ = r / max). */
export function lowAngleElev(r: number, maxM: number): number {
  return 0.5 * Math.asin(Math.min(1, Math.max(0, r / maxM)));
}

/** Height of that curve over the muzzle at ground distance `x`, for elevation `th`. */
export function trajHeight(x: number, th: number, maxM: number): number {
  const c = Math.cos(th);
  return x * Math.tan(th) - (x * x) / (2 * maxM * c * c);
}

/**
 * The crest toward `bearingDeg` from the guns at `gun`: walk the line in `stepM` steps to `toM` and keep the highest
 * angle of site (ground + what stands on it, less the earth's curve with refraction). Then the minimum QE and the
 * nearest range low-angle fire clears it at, both on the fitted vacuum curve (estimates).
 */
export function crestAlong(
  probe: SiteProbe,
  gun: XY,
  bearingDeg: number,
  toM: number,
  maxRangeM: number,
  R: GunRules,
  standing: StandingFn | null,
  stepM = 30,
): CrestRead | null {
  const z0 = probe.elev(gun[0], gun[1]);
  if (!Number.isFinite(z0)) return null;
  const muzzle = z0 + R.crest.muzzleM.value;
  const k = R.crest.refraction.value;
  let best = -Infinity, bestD = 0, bestH = 0, bestAt: XY = gun, unknown = 0, n = 0;
  for (let d = Math.max(stepM, R.crest.minM.value); d <= toM; d += stepM) {
    const p = offsetPt(gun[0], gun[1], bearingDeg, d);
    n++;
    const z = probe.elev(p[0], p[1]);
    if (!Number.isFinite(z)) {
      unknown++;
      continue;
    }
    const h = z + (standing ? standing(p[0], p[1]) : 0) - muzzle - ((1 - k) * d * d) / (2 * EARTH_R);
    const a = Math.atan2(h, d);
    if (a > best) {
      best = a;
      bestD = d;
      bestH = h;
      bestAt = p;
    }
  }
  if (!Number.isFinite(best)) return null;
  const siteMils = mils(best);
  const pcrM = Math.max(100, Math.round(bestD / 100) * 100);
  const a1Mils = Math.ceil(siteMils);
  const a2Mils = Math.ceil(R.crest.clearM.value / (pcrM / 1000));
  const a4EstMils = Math.ceil(mils(lowAngleElev(pcrM, maxRangeM)));
  const need = bestH + R.crest.clearM.value;
  let lowMinRangeM: number | null = null;
  let masksAll = false;
  // Only ground above the muzzle line is a crest. On ground falling away (or flat beyond the earth's curve) the highest
  // angle is still negative and no low-angle trajectory toward a target beyond it comes near it.
  if (best > 0 && need > 0) {
    const clears = (r: number) => trajHeight(bestD, lowAngleElev(r, maxRangeM), maxRangeM) >= need;
    if (!clears(maxRangeM)) masksAll = true;
    else {
      let lo = Math.min(maxRangeM, bestD + 1), hi = maxRangeM;
      if (clears(lo)) hi = lo;
      for (let i = 0; i < 40 && hi - lo > 10; i++) {
        const mid = (lo + hi) / 2;
        if (clears(mid)) hi = mid;
        else lo = mid;
      }
      lowMinRangeM = hi;
    }
  }
  return {
    distM: bestD,
    heightM: bestH,
    at: bestAt,
    siteMils,
    pcrM,
    a1Mils,
    a2Mils,
    a4EstMils,
    minQeMils: a1Mils + a2Mils + a4EstMils,
    steep: a1Mils + a2Mils > R.crest.steepMils.value,
    lowMinRangeM,
    masksAll,
    unknownShare: n ? unknown / n : 1,
  };
}

// ── the front ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The own front: FDL lines drawn on the map, or the threat place (a point) when none is drawn. */
export interface Front {
  kind: 'line' | 'point';
  /** Lines: each a run of points. Point: one run of one point. */
  runs: XY[][];
  label: string;
}

/** Ground distance to the front, and which side of a line the point lies on (+1 / -1; 0 for a point front). */
export function frontDist(p: XY, f: Front): { distM: number; side: number; near: XY } {
  let best = Infinity, side = 0, near: XY = p;
  for (const run of f.runs) {
    if (run.length === 1) {
      const d = groundDist(p, run[0]);
      if (d < best) {
        best = d;
        near = run[0];
        side = 0;
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
        side = Math.sign(dx * (p[1] - a[1]) - dy * (p[0] - a[0])) || 1;
      }
    }
  }
  return { distM: best, side, near };
}

// ── the finder ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type GunUnit = 'bty' | 'regt';
export type GunOp = 'def' | 'attk';

export interface GunTask {
  /** Where to look and how far round it. */
  centre: XY;
  radiusM: number;
  /** Where the fire is wanted (the target area's centre); null = judge without range and crest. */
  target: XY | null;
  /** The own front; null = no front check. */
  front: Front | null;
  weapon: GunWeapon;
  unit: GunUnit;
  op: GunOp;
  season: Season;
  /** Month 1-12, for what stands on the ground (crops). */
  month: number;
  /** The data catalogue of the terrain bundle (SiteScan.dataCatalog(manifest)): what each value was read from. */
  data?: ((key: DataKey, figure: string) => RuleRef) | null;
  /** Where the user's inputs came from ("picked on the map", "the FDL drawn on the map (2 lines)"...). */
  inputs?: { target?: string; front?: string; centre?: string };
  /** Why the month is dry or wet, and the rain threshold (climate.json). */
  seasonWhy?: string;
  wetFromMm?: number;
}

export interface GunRow {
  key: 'room' | 'level' | 'firm' | 'air' | 'access' | 'range' | 'front' | 'crest' | 'avoid';
  label: string;
  value: string;
  tone: Tone;
  why: string;
  fix?: string;
  /** The rules the check applied: book, page and words, or the proposal and why. */
  rules: RuleRef[];
}

export interface GunSite {
  rank: number;
  at: XY;
  axisDeg: number;
  ring: XY[];
  score: number;
  tone: Tone;
  verdict: string;
  rows: GunRow[];
  read: SiteRead;
  crest: CrestRead | null;
  road: RoadPick;
  targetM: number | null;
  frontM: number | null;
  fixes: string[];
  /** Why it stands where it does in the list (chosen, below the one above, ...). */
  why: string[];
}

/** A gate a place failed before it was read in full: what, why, and the rule. */
export interface GateFail {
  gate: 'nogo' | 'range' | 'side' | 'front' | 'room';
  text: string;
  rules: RuleRef[];
}

export interface GunResult {
  sites: GunSite[];
  /** Lattice points tried, and why the others were left out. */
  tried: number;
  rejected: { nogo: number; side: number; range: number; front: number; room: number };
  /** The places left out, by gate, with the rule each gate applies. */
  rejectedWhy: Array<{ gate: GateFail['gate']; count: number; share: number; text: string; rules: RuleRef[] }>;
  /** A read met tiles still loading: run again when they arrive. */
  pending: boolean;
  notes: string[];
  area: GunAreaSize;
  /** How the list is ordered and which places were tried, as references (proposals). */
  orderRules: RuleRef[];
}

/** "Why not here?": a place the user picked, read with the same gates and checks. */
export interface GunWhyNot {
  at: XY;
  /** Gates it fails (a place failing one is never listed). */
  gates: GateFail[];
  /** Its rows, read in full even where a gate failed, so every check can be seen. */
  site: GunSite | null;
  /** Against the first in the list: the checks where it is worse. */
  vsBest: string[];
  verdict: string;
}

const LANDMARK_WORD: Record<string, string> = {
  '20': 'Br', '21': 'Br', '50': 'Rly Stn', '159': 'Rd Junc', '166': 'Rd Junc', '60': 'Tower', '78': 'Mast', '79': 'Tower', '64': 'Fort', '66': 'Cantt',
};

const TONE_RANK: Record<Tone, number> = { ok: 0, warn: 1, unknown: 2, bad: 3 };
const TONE_WORD: Record<Tone, string> = { ok: 'passes', warn: 'needs work', unknown: 'not read', bad: 'fails' };

function toneScore(t: Tone, R?: GunRules): number {
  const ts = R?.order.toneScore;
  return ts ? ts[t] : t === 'ok' ? 1 : t === 'warn' ? 0.55 : t === 'unknown' ? 0.4 : 0;
}

/** The ordering method as references (GunDoctrine.json order and scan): method settings (M), with their reasons. */
export function orderRefs(R: GunRules): RuleRef[] {
  const e = (figure: string, note: string): RuleRef => ({ basis: 'M', book: '', page: '', quote: null, role: 'rule', checked: null, figure, note });
  return [
    e('List order', R.order.note),
    e('Weighted score', `${R.order.toneSrc}; ${R.order.weightsSrc}`),
    e('Finer reading', R.order.preSrc),
    e('Places tried', `${R.scan.note} (every ${R.scan.stepM} m; the best ${R.scan.keep} read in full; at most ${R.scan.maxSites} listed, ${Math.round(R.altMinM.value)} m apart)`),
  ];
}

/** The weapon's range as a rule: the ORBAT entry (weapons.json) and the handbook page it was read from. */
export function weaponRef(W: GunWeapon, sources: Record<string, RefSource>): RuleRef {
  return {
    basis: 'D',
    book: sources.soh2?.short ?? "SO's Hbk 2019, Sec 2 Arty",
    page: W.page,
    quote: `${W.name}: max ${W.maxM} m${W.minM ? `, min ${W.minM} m` : ''}`,
    role: 'rule',
    checked: 'orbat',
    figure: `${W.name} range (ORBAT weapons.json)`,
  };
}

interface Cand {
  at: XY;
  axis: number;
  read: SiteRead;
  pre: number;
  tT: number | null;
  tF: number | null;
}

/**
 * The finder's gates and checks for one task, shared by the search, "Why not here?" and the decision record, so a
 * place is judged the same way whichever asks.
 */
function gunScorer(probe: SiteProbe, rules: any, task: GunTask, R: GunRules, standing: StandingFn | null) {
  const area = R.areas[task.unit];
  const frontM = area.frontM.value, depthM = area.depthM.value;
  const rule: GroundRule = goingRule(rules, 'gun', task.season);
  if (task.weapon.sp) rule.soil = goingRule(rules, 'tracked', task.season).soil;
  const W = task.weapon;
  const S = R.sources;
  const fr = task.front ? R.front[task.op] : null;
  const maxBehindM = fr ? W.planM * fr.maxFrac.value : Infinity;
  let targetSide = 0;
  if (task.front?.kind === 'line' && task.target) targetSide = frontDist(task.target, task.front).side;
  const pctV = (x: number) => `${Math.round(x * 100)}%`;
  const C = R.checks;
  const dat = (key: DataKey, figure: string): RuleRef[] => (task.data ? [task.data(key, figure)] : []);
  const input = (k: 'target' | 'front' | 'centre', figure: string): RuleRef[] => (task.inputs?.[k] ? [{ basis: 'D', book: 'Your input', page: '', quote: task.inputs[k]!, role: 'data' as const, checked: null, figure }] : []);
  const season = task.seasonWhy ? seasonRef(task.data ?? null, task.seasonWhy, task.wetFromMm ?? 100) : [];

  // the rules each gate and check applies
  const refs = {
    area: [...figRefs(area.frontM, `${area.label} frontage ${Math.round(frontM)} m`, S), ...figRefs(area.depthM, `${area.label} depth ${Math.round(depthM)} m`, S)],
    room: [...figRefs(R.room.okShare, `Room: ${pctV(R.room.okShare.value)} usable passes`, S), ...figRefs(R.room.minShare, `Room: under ${pctV(R.room.minShare.value)} usable fails`, S)],
    nogo: [terrainRef(rules, 'gun', 'Gr a gun cannot stand on'), ...dat('class', 'Gr class at the place')],
    known: figRefs(C.minKnownShare, `Not read when the class is known on under ${pctV(C.minKnownShare.value)} of the samples`, S),
    level: [...figRefs(R.level.okDeg, `Level: tilt up to ${R.level.okDeg.value}° passes`, S), ...figRefs(R.level.maxDeg, `Level: over ${R.level.maxDeg.value}° fails`, S), ...dat('elev', 'Heights of the samples (plane fitted)')],
    firm: [
      ...figRefs(R.firm.maxSoftShare, `Firm: over ${pctV(R.firm.maxSoftShare.value)} too soft fails`, S),
      ...figRefs(C.firmWarnShare, `Firm: over ${pctV(C.firmWarnShare.value)} soft needs work`, S),
      ...figRefs(C.marginalWeight, `Marginal soil counts x${C.marginalWeight.value}`, S),
      soilRuleRef(rules, W.sp ? 'tracked' : 'gun', 'Soil strength against the vehicle'),
      ...dat('rci', `Cone index ${task.season === 'wet' ? 'after rain' : 'dry'}`),
      ...season,
    ],
    air: [...figRefs(R.air.goodMean, `Hidden from air: concealment ${R.air.goodMean.value} (fair) or better passes`, S), ...figRefs(R.air.poorMean, `Hidden from air: under ${R.air.poorMean.value} (poor) fails`, S), ...dat('cc', 'Concealment from the air (cc >> 4)'), ...dat('class', 'Tree cover (Gr class)')],
    access: [...figRefs(R.access.maxM, `Access: a Rd within ${R.access.maxM.value} m`, S), ...figRefs(C.accessFailX, `Access: over ${C.accessFailX.value} x the limit fails`, S), ...dat('network', 'Nearest Rd, its load class, all-weather or not')],
    range: [weaponRef(W, S), ...figRefs(R.planFrac, `Planning range = ${pctV(R.planFrac.value)} of max`, S), ...input('target', 'Target place')],
    front: fr
      ? [...figRefs(fr.minM, `At least ${(fr.minM.value / 1000).toFixed(1)} km behind the front`, S), ...figRefs(fr.maxFrac, `At most ${pctV(fr.maxFrac.value)} of the planning range behind the front`, S), ...input('front', 'The front'), ...input('target', 'Target place (its side of the front)')]
      : [],
    frontGate: figRefs(R.scan.frontGateFrac, `Search shortcut: nearer than ${pctV(R.scan.frontGateFrac.value)} of the minimum`, S),
    roomGate: figRefs(R.scan.minKnownGate, `Room gate where the class is known on ${pctV(R.scan.minKnownGate.value)} or more`, S),
    crest: [
      ...figRefs(R.crest.clearM, `Crest: ${R.crest.clearM.value} m vertical clearance (A2)`, S),
      ...figRefs(R.crest.steepMils, `Crest: A1 + A2 over ${R.crest.steepMils.value} mils, compute by hand`, S),
      ...figRefs(R.crest.highAngleMils, `High angle: over ${R.crest.highAngleMils.value} mils elevation`, S),
      ...figRefs({ basis: 'U', src: 'FM 6-50 ch 6: Min QE = the greatest sum of Angles 1-5', refs: R.crest.methodRefs }, 'Min QE method (Angles 1-5)', S),
      { basis: 'M', book: '', page: '', quote: null, role: 'rule' as const, checked: null, figure: 'A4 elevation at PCR', note: 'estimated on a vacuum curve fitted to the maximum range (FM 6-50 takes A4 from the firing tables, which the finder does not hold): the firing tables give the real figure' },
      ...figRefs(C.crestMaxUnknown, `Crest not read when over ${pctV(C.crestMaxUnknown.value)} of the line has no height`, S),
      ...figRefs(R.crest.muzzleM, `Muzzle ${R.crest.muzzleM.value} m above the ground`, S),
      ...figRefs(R.crest.refraction, `Earth's curve with refraction ${R.crest.refraction.value}`, S),
      { basis: 'E', book: '', page: '', quote: null, role: 'rule' as const, checked: null, figure: 'What stands on the crest', note: `trees, tall crops and buildings above the 30 m model, from the Ground Guide's figures (OcokaDoctrine.json surfaceBlockers and cropCalendar, month ${task.month}), marked proposals there and not yet backed by a source; counted where the class is mostly covered (chance 0.3 or more a cell)` },
      ...dat('elev', 'Heights along the line of fire (every 30 m)'),
      ...dat('class', 'Gr class along the line (trees, crops)'),
      ...dat('bld', 'Bldgs along the line'),
      weaponRef(W, S),
      ...input('target', 'Target place (the line of fire)'),
    ],
    avoid: [...figRefs(R.avoid.landmarkM, `Avoid landmarks within ${R.avoid.landmarkM.value} m`, S), ...figRefs(R.avoid.buaShare, `Avoid BUA (over ${pctV(R.avoid.buaShare.value)} of the area)`, S), ...dat('features', 'Brs, junctions, stations, masts, forts near'), ...dat('bld', 'Bldgs on the area'), ...dat('class', 'BUA class on the area')],
    roomData: [...dat('class', 'Gr class of the samples'), ...dat('wet', 'Waterlogged / water on the area')],
  };

  /** The gates in the order the search applies them. */
  const gates = (p: XY): { fails: GateFail[]; tT: number | null; tF: number | null; axis: number } => {
    const fails: GateFail[] = [];
    const c0 = probe.cls(p[0], p[1]);
    if (c0 !== null && rule.nogo[c0]) {
      const lbl = String(rules?.classes?.[String(c0)]?.label ?? `class ${c0}`);
      const why = rules?.profiles?.gun?.why?.[String(c0)];
      fails.push({ gate: 'nogo', text: `The centre is on ${lbl}: NO-GO for guns${why ? ` (${why})` : ''}`, rules: refs.nogo });
    }
    const tT = task.target ? groundDist(p, task.target) : null;
    if (tT !== null && (tT > W.maxM || (W.minM > 0 && tT < W.minM)))
      fails.push({ gate: 'range', text: tT > W.maxM ? `Target ${km(tT)} off: beyond ${W.name}'s ${km(W.maxM)}` : `Target ${km(tT)} off: inside ${W.name}'s minimum ${km(W.minM)}`, rules: refs.range });
    let tF: number | null = null;
    if (task.front && fr) {
      const f = frontDist(p, task.front);
      tF = f.distM;
      if (targetSide && f.side === targetSide) fails.push({ gate: 'side', text: `On the target's side of ${task.front.label}: the guns stand behind the own front`, rules: refs.front });
      else if (tF < fr.minM.value * R.scan.frontGateFrac.value) fails.push({ gate: 'front', text: `Only ${km(tF)} behind ${task.front.label} (under ${pctV(R.scan.frontGateFrac.value)} of the ${km(fr.minM.value)} minimum)`, rules: [...refs.front, ...refs.frontGate] });
    }
    const axis = task.target ? bearingOf(p, task.target) : task.front ? bearingOf(p, frontDist(p, task.front).near) : 0;
    return { fails, tT, tF, axis };
  };

  const read = (p: XY, axis: number) => readSite(probe, p, axis, frontM, depthM, rule, 5, 4);

  const roomFail = (r: SiteRead): GateFail | null =>
    r.known >= r.n * R.scan.minKnownGate.value && 1 - r.nogo < R.room.minShare.value
      ? { gate: 'room', text: `Only ${pctV(1 - r.nogo)} of the ${Math.round(frontM)} x ${Math.round(depthM)} m area is usable (under ${pctV(R.room.minShare.value)})`, rules: [...refs.room, ...refs.area, ...refs.nogo, ...refs.roomGate] }
      : null;

  const P = R.order.pre;
  const pre = (r: SiteRead) =>
    (1 - r.nogo) * P.room +
    (r.tiltDeg === null ? P.levelMax / 2 : r.tiltDeg <= R.level.okDeg.value ? P.levelOk : r.tiltDeg <= R.level.maxDeg.value ? P.levelMax : 0) +
    (1 - r.softNogo) * P.firm +
    (r.concealMean ?? 0) / P.concealDiv +
    r.bua * P.bua +
    r.wetBad * P.wet;

  /** All checks on a candidate, each with its rules. */
  const build = (c: Cand): GunSite => {
    const rows: GunRow[] = [];
    const r = c.read;
    const unknownGround = r.known < r.n * C.minKnownShare.value;
    const room = 1 - r.nogo;
    rows.push({
      key: 'room',
      label: 'Room',
      value: unknownGround ? 'not read' : `${pct(room)} usable of ${Math.round(frontM)} x ${Math.round(depthM)} m`,
      tone: unknownGround ? 'unknown' : room >= R.room.okShare.value && r.wetBad === 0 ? 'ok' : room >= R.room.minShare.value ? 'warn' : 'bad',
      why: unknownGround ? 'the terrain tiles here are not read' : `${area.label} ${Math.round(frontM)} m frontage x ${Math.round(depthM)} m depth; NO-GO for guns: ${pct(r.nogo)}${r.wetBad ? `, under water / waterlogged ${pct(r.wetBad)}` : ''}`,
      fix: room < R.room.okShare.value ? 'Site the guns on the clear part; check the gaps on the ground' : undefined,
      rules: uniqRefs([...refs.area, ...refs.room, ...refs.nogo, ...refs.known, ...refs.roomData]),
    });
    const tilt = r.tiltDeg;
    rows.push({
      key: 'level',
      label: 'Level',
      value: tilt === null ? 'not read' : `${tilt.toFixed(1)}° tilt, ${Math.round(r.reliefM ?? 0)} m relief`,
      tone: tilt === null ? 'unknown' : tilt <= R.level.okDeg.value ? 'ok' : tilt <= R.level.maxDeg.value ? 'warn' : 'bad',
      why: `a plane fitted to the 30 m elevations over the area: under ${R.level.okDeg.value}° passes, over ${R.level.maxDeg.value}° fails`,
      fix: tilt !== null && tilt > R.level.okDeg.value ? 'Level the platforms (engineer effort) or move to flatter ground' : undefined,
      rules: refs.level,
    });
    const soft = r.softNogo + r.softSlow * C.marginalWeight.value;
    rows.push({
      key: 'firm',
      label: task.season === 'wet' ? 'Firm (wet)' : 'Firm (dry)',
      value: r.soilKnown === 0 ? 'not read' : r.softNogo > 0 ? `${pct(r.softNogo)} too soft` : r.softSlow > 0 ? `${pct(r.softSlow)} marginal` : 'firm',
      tone: r.soilKnown === 0 ? 'unknown' : r.softNogo > R.firm.maxSoftShare.value ? 'bad' : soft > C.firmWarnShare.value ? 'warn' : 'ok',
      why: `${task.weapon.sp ? 'tracks (SP)' : 'heavy wheels (towed guns, prime movers)'} on the ${task.season === 'wet' ? 'after-rain' : 'dry'} cone index`,
      fix: r.softNogo > 0 ? 'Prepare platforms / hard standing, or take firmer ground' : undefined,
      rules: refs.firm,
    });
    const cm = r.concealMean;
    rows.push({
      key: 'air',
      label: 'Hidden from air',
      value: cm === null ? 'not read' : `${['none', 'poor', 'fair', 'good'][Math.max(0, Math.min(3, Math.round(cm)))]}${r.trees > 0.1 ? `, trees ${pct(r.trees)}` : ''}`,
      tone: cm === null ? 'unknown' : cm >= R.air.goodMean.value ? 'ok' : cm >= R.air.poorMean.value ? 'warn' : 'bad',
      why: 'concealment from the air on the site (land cover)',
      fix: cm !== null && cm < R.air.goodMean.value ? 'Camouflage nets; site under tree lines; no tracks to the guns' : undefined,
      rules: refs.air,
    });
    const roads = probe.roads(c.at[0], c.at[1], R.access.searchM.value);
    const road = pickRoad(roads, 1);
    const rd = road.road?.distM ?? null;
    const wetFair = task.season === 'wet' && road.road && !road.allWeather;
    rows.push({
      key: 'access',
      label: 'Access',
      value: rd === null ? `no Rd within ${km(R.access.searchM.value)}` : `${metres(rd)} to ${road.label}`,
      tone: rd === null ? 'bad' : rd > R.access.maxM.value * C.accessFailX.value ? 'bad' : rd > R.access.maxM.value || wetFair || road.tier === 0 ? 'warn' : 'ok',
      why: `ammunition vehicles in and out: a Rd within ${metres(R.access.maxM.value)}${road.tier === 0 && road.road ? '; load class not recorded' : ''}${wetFair ? '; fair-weather Rd after rain' : ''}`,
      fix: rd === null || rd > R.access.maxM.value ? 'Recce a track in for the ammunition vehicles' : wetFair ? 'Plan for the track after rain' : undefined,
      rules: uniqRefs([...refs.access, ...(task.season === 'wet' ? season : [])]),
    });
    if (c.tT !== null) {
      const t = c.tT;
      rows.push({
        key: 'range',
        label: 'Range',
        value: `target ${km(t)} (${pct(t / W.maxM)} of max)`,
        tone: t <= W.planM && (W.minM === 0 || t >= W.minM) ? 'ok' : t <= W.maxM ? 'warn' : 'bad',
        why: `${W.name}: planning range ${km(W.planM)}, max ${km(W.maxM)}${W.minM ? `, min ${km(W.minM)}` : ''}`,
        fix: t > W.planM ? 'Move the guns nearer the target' : undefined,
        rules: refs.range,
      });
    }
    if (c.tF !== null && fr) {
      const reach = W.planM - c.tF;
      const tooNear = c.tF < fr.minM.value;
      const tooFar = c.tF > maxBehindM;
      rows.push({
        key: 'front',
        label: 'Behind front',
        value: `${km(c.tF)} behind ${task.front!.label}; reaches ${km(Math.max(0, reach))} beyond`,
        tone: tooNear ? 'bad' : tooFar ? 'warn' : 'ok',
        why: `${task.op === 'def' ? 'defence' : 'attack'}: at least ${km(fr.minM.value)} behind, at most ${pct(fr.maxFrac.value)} of the planning range (${km(maxBehindM)}) so the fire reaches deep${fr.note ? `; ${fr.note}` : ''}`,
        fix: tooNear ? 'Too near the front: move back' : tooFar ? 'Far back: the guns lose reach beyond the front' : undefined,
        rules: refs.front,
      });
    }
    let crest: CrestRead | null = null;
    if (task.target && c.tT !== null) {
      crest = crestAlong(probe, c.at, c.axis, Math.min(c.tT - 100, R.crest.searchM.value), W.maxM, R, standing);
      if (!crest) {
        rows.push({ key: 'crest', label: 'Crest', value: 'not read', tone: 'unknown', why: 'no elevation at the guns', rules: refs.crest });
      } else {
        const masked = crest.masksAll || (crest.lowMinRangeM !== null && c.tT < crest.lowMinRangeM);
        const none = crest.siteMils <= 0;
        const reach = masked
          ? crest.masksAll
            ? 'masks every low-angle range'
            : `low-angle fire clears it only at ${km(crest.lowMinRangeM!)} and beyond; the target is ${km(c.tT)}`
          : crest.lowMinRangeM
            ? `low-angle fire clears it from ${km(crest.lowMinRangeM)} (estimate); the target is ${km(c.tT)}`
            : 'cleared at every range';
        rows.push({
          key: 'crest',
          label: 'Crest',
          value: none ? 'no crest above the guns' : `PCR ${metres(crest.pcrM)} ${compass(c.axis)}, +${Math.round(crest.heightM)} m; A1 ${crest.a1Mils} + A2 ${crest.a2Mils} mils`,
          tone: crest.unknownShare > C.crestMaxUnknown.value ? 'unknown' : masked ? (W.highAngle ? 'warn' : 'bad') : crest.steep ? 'warn' : 'ok',
          why: none
            ? 'the ground toward the target stays below the muzzle'
            : `${reach}. Min QE = A1 ${crest.a1Mils} + A2 ${crest.a2Mils} + A4 ~${crest.a4EstMils} (estimate) = ~${crest.minQeMils} mils, plus A3 comp site and A5 2 forks from the firing tables${crest.steep ? `; A1 + A2 over ${R.crest.steepMils.value} mils: compute by hand, not the rapid tables` : ''}`,
          fix: masked
            ? W.highAngle
              ? `Fire high angle (over ${R.crest.highAngleMils.value} mils), or site the guns further back from the crest`
              : 'Site the guns further back from the crest or on the other side of it'
            : crest.steep
              ? 'Steep crest: work the Min QE out by hand and check it on the ground'
              : undefined,
          rules: refs.crest,
        });
      }
    }
    const lm = probe.features(c.at[0], c.at[1], R.avoid.landmarkM.value, new Set(R.avoid.kinds));
    const words = [...new Set(lm.slice(0, 3).map((f) => `${LANDMARK_WORD[f.kind] ?? f.label} ${metres(f.distM)}`))];
    const buaBad = r.bua > R.avoid.buaShare.value;
    rows.push({
      key: 'avoid',
      label: 'Avoid',
      value: [buaBad ? `BUA ${pct(r.bua)}` : '', ...words].filter(Boolean).join(', ') || 'clear',
      tone: buaBad || lm.length ? 'warn' : 'ok',
      why: `no BUA on the site; no landmark within ${metres(R.avoid.landmarkM.value)} that his observers and aircraft find the guns by`,
      fix: buaBad || lm.length ? 'Shift the guns off the BUA / away from the landmark' : undefined,
      rules: refs.avoid,
    });

    let score = 0, wsum = 0;
    for (const row of rows) {
      const w = R.weights[row.key] ?? 1;
      score += w * toneScore(row.tone, R);
      wsum += w;
    }
    score = wsum ? score / wsum : 0;
    const tone = worstTone(rows.map((x) => x.tone));
    const fails = rows.filter((x) => x.tone === 'bad').map((x) => x.label);
    const verdict = tone === 'ok' ? 'Good gun area' : tone === 'bad' ? `Fails: ${fails.join(', ')}` : tone === 'unknown' ? 'Partly read' : 'Usable, with work';
    return {
      rank: 0,
      at: c.at,
      axisDeg: c.axis,
      ring: rectRing(c.at, c.axis, frontM, depthM),
      score,
      tone,
      verdict,
      rows,
      read: r,
      crest,
      road,
      targetM: c.tT,
      frontM: c.tF,
      fixes: rows.filter((x) => x.fix).map((x) => `${x.label}: ${x.fix}`),
      why: [],
    };
  };

  return { area, frontM, depthM, rule, refs, gates, read, roomFail, pre, build };
}

/** Sites in list order: better tone first, then the higher score. */
function bySiteOrder(a: GunSite, b: GunSite): number {
  return TONE_RANK[a.tone] - TONE_RANK[b.tone] || b.score - a.score;
}

/**
 * Why each site stands where it does: the first is chosen (and what it does better than the second); each other one
 * is below the one above on the checks named, with both values. Where the checks tie, the finer reading that put it
 * lower is named (usable room, tilt, firm ground, concealment).
 */
export function explainOrder(sites: GunSite[], total: number): void {
  const counts = (s: GunSite) => {
    const c: Record<Tone, number> = { ok: 0, warn: 0, unknown: 0, bad: 0 };
    for (const r of s.rows) c[r.tone]++;
    return c;
  };
  const worseRows = (a: GunSite, b: GunSite) =>
    b.rows
      .map((rb) => ({ rb, ra: a.rows.find((x) => x.key === rb.key) }))
      .filter(({ ra, rb }) => ra && TONE_RANK[rb.tone] > TONE_RANK[ra.tone])
      .map(({ ra, rb }) => `${rb.label}: #${b.rank} ${rb.value} (${TONE_WORD[rb.tone]}); #${a.rank} ${ra!.value} (${TONE_WORD[ra!.tone]})`);
  // the finer reading that orders sites with the same results: usable room, tilt, soft Gr, concealment, as shown
  const finer = (a: GunSite, b: GunSite) => {
    const out: string[] = [];
    const ra = pct(1 - a.read.nogo), rb = pct(1 - b.read.nogo);
    if (ra !== rb) out.push(`usable room ${ra} against ${rb}`);
    const ta = (a.read.tiltDeg ?? 0).toFixed(1), tb = (b.read.tiltDeg ?? 0).toFixed(1);
    if (ta !== tb) out.push(`tilt ${ta}° against ${tb}°`);
    const sa = pct(a.read.softNogo), sb = pct(b.read.softNogo);
    if (sa !== sb) out.push(`soft Gr ${sa} against ${sb}`);
    const ca = (a.read.concealMean ?? 0).toFixed(1), cb = (b.read.concealMean ?? 0).toFixed(1);
    if (ca !== cb) out.push(`concealment ${ca} against ${cb}`);
    return out;
  };
  const tie = (a: GunSite, b: GunSite, who: string) => {
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
        s.why.push(better.length ? `Preferred over #2, which ${better.length === 1 ? 'is worse on' : 'is worse on these'}: ${better.join('; ')}.` : `#2: ${tie(s, next, '#1')}`);
      }
      return;
    }
    const above = sites[i - 1];
    const worse = worseRows(above, s);
    s.why = [
      worse.length
        ? `Below #${above.rank}: worse on ${worse.join('; ')}.`
        : tie(above, s, `#${above.rank}`),
      `${s.verdict}; ${tally}.`,
    ];
  });
}

/**
 * Find gun areas. `standing` gives what stands on the ground for the crest (null: bare ground only). The probe's
 * pending state is the caller's to check (SiteBundle.pending()).
 */
export function findGunAreas(probe: SiteProbe, rules: any, task: GunTask, R: GunRules, standing: StandingFn | null = null): GunResult {
  const G = gunScorer(probe, rules, task, R, standing);
  const notes: string[] = [];
  const rejected = { nogo: 0, side: 0, range: 0, front: 0, room: 0 };
  const firstRule: Partial<Record<GateFail['gate'], GateFail>> = {};
  const pts = lattice(task.centre, task.radiusM, R.scan.stepM);
  const cands: Cand[] = [];
  for (const p of pts) {
    const g = G.gates(p);
    if (g.fails.length) {
      const f = g.fails[0];
      rejected[f.gate]++;
      firstRule[f.gate] ??= f;
      continue;
    }
    const read = G.read(p, g.axis);
    const rf = G.roomFail(read);
    if (rf) {
      rejected.room++;
      firstRule.room ??= rf;
      continue;
    }
    cands.push({ at: p, axis: g.axis, read, pre: G.pre(read), tT: g.tT, tF: g.tF });
  }
  cands.sort((a, b) => b.pre - a.pre);
  const top = spreadPick(cands, Math.max(R.scan.stepM * 1.5, Math.min(G.frontM, G.depthM) / 2), R.scan.keep);
  const sites = top.map((c) => G.build(c));
  sites.sort(bySiteOrder);
  const picked = spreadPick(sites, R.altMinM.value, R.scan.maxSites);
  picked.forEach((s, i) => (s.rank = i + 1));
  explainOrder(picked, cands.length);

  const tot = pts.length || 1;
  const GATE_TEXT: Record<GateFail['gate'], string> = {
    nogo: 'the centre is on Gr a gun cannot stand on',
    range: `the target is out of ${task.weapon.name}'s range`,
    side: "on the target's side of the front",
    front: 'too near the front',
    room: `no room for the ${G.area.label}`,
  };
  const rejectedWhy = (Object.keys(rejected) as Array<GateFail['gate']>)
    .filter((k) => rejected[k] > 0)
    .map((k) => ({ gate: k, count: rejected[k], share: rejected[k] / tot, text: `${rejected[k]} of ${pts.length} places: ${GATE_TEXT[k]}${firstRule[k] ? ` (e.g. ${firstRule[k]!.text})` : ''}`, rules: firstRule[k]?.rules ?? [] }))
    .sort((a, b) => b.count - a.count);

  if (!pts.length) notes.push('No search circle.');
  if (!picked.length) notes.push(`No gun area in this circle${rejectedWhy.length ? `: ${rejectedWhy.map((r) => `${pct(r.share)} ${GATE_TEXT[r.gate]}`).join(', ')}` : ''}. Look elsewhere or widen the circle.`);
  if (!task.target) notes.push('No target: range and crest not checked.');
  if (!task.front) notes.push('No front: distance behind the FDL not checked (draw the FDL or mark the threat).');
  return { sites: picked, tried: pts.length, rejected, rejectedWhy, pending: false, notes, area: G.area, orderRules: orderRefs(R) };
}

/** "Why not here?": the place read with the same gates and checks as the search, and set against the first site. */
export function gunWhyNot(probe: SiteProbe, rules: any, task: GunTask, R: GunRules, at: XY, best: GunSite | null, standing: StandingFn | null = null): GunWhyNot {
  const G = gunScorer(probe, rules, task, R, standing);
  const g = G.gates(at);
  const read = G.read(at, g.axis);
  const gates = [...g.fails];
  const rf = G.roomFail(read);
  if (rf) gates.push(rf);
  const site = G.build({ at, axis: g.axis, read, pre: G.pre(read), tT: g.tT, tF: g.tF });
  const vsBest: string[] = [];
  if (best) {
    for (const rb of site.rows) {
      const ra = best.rows.find((x) => x.key === rb.key);
      if (ra && TONE_RANK[rb.tone] > TONE_RANK[ra.tone]) vsBest.push(`${rb.label}: here ${rb.value} (${TONE_WORD[rb.tone]}); #1 ${ra.value} (${TONE_WORD[ra.tone]})`);
    }
  }
  const verdict = gates.length
    ? `Not listed: ${gates.map((x) => x.text).join('; ')}`
    : vsBest.length
      ? `Read in full, but #1 is better on ${vsBest.length} check${vsBest.length === 1 ? '' : 's'}`
      : best && site.score <= best.score
        ? 'Read in full: as good on every check; the list keeps one place per ' + `${Math.round(R.altMinM.value)} m and its finer reading put #1 first`
        : 'Read in full: it passes the gates; the list keeps the best places at least the alternate spacing apart';
  return { at, gates, site, vsBest, verdict };
}

/** Every rule a result cites, numbered once (for the decision record). */
export function citeList(rows: Array<{ rules: RuleRef[] }>): RuleRef[] {
  return uniqRefs(rows.flatMap((r) => r.rules));
}

/** The decision record: every site with its checks and the rules behind them, the order, the places left out. */
export function gunLines(res: GunResult, task: GunTask, grid: (p: XY) => string, dataLine = '', whyNot: GunWhyNot | null = null): string[] {
  const L: string[] = [];
  const all = citeList([{ rules: res.orderRules }, ...res.sites.flatMap((s) => s.rows), ...res.rejectedWhy, ...(whyNot ? [...whyNot.gates, ...(whyNot.site?.rows ?? [])] : [])]);
  const num = (r: RuleRef) => all.indexOf(r) + 1;
  const cites = (rs: RuleRef[]) => {
    const n = [...new Set(uniqRefs(rs).map((r) => all.findIndex((x) => x.figure === r.figure && x.book === r.book && x.page === r.page && x.quote === r.quote && (x.note ?? '') === (r.note ?? '')) + 1))].filter((x) => x > 0);
    return n.length ? ` [${n.join(', ')}]` : '';
  };
  L.push(`GUN DEPLOYMENT - DECISION RECORD: ${task.weapon.name}, ${res.area.label}, ${task.op === 'def' ? 'defence' : 'attack'}, ${task.season === 'wet' ? 'after rain' : 'dry'}`);
  if (task.target) L.push(`Target: ${grid(task.target)}`);
  if (task.front) L.push(`Front: ${task.front.label}`);
  if (dataLine) L.push(`Data: ${dataLine}`);
  L.push(`Order: the worst check first, then the weighted checks, then the finer reading${cites(res.orderRules)}`);
  L.push('');
  for (const s of res.sites) {
    L.push(`${s.rank}. ${grid(s.at)}  ${s.verdict}  (facing ${compass(s.axisDeg)}, ${Math.round(s.axisDeg * 17.778)} mils)`);
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
  all.forEach((r) => L.push(`[${num(r)}] ${refLine(r)}`));
  L.push('');
  L.push('Book words and pages are checked against the PDFs by tools/doctrine-refs/verify.py. Crest figures are estimates from 30 m elevation: confirm the minimum QE with the firing tables and on the ground.');
  return L;
}

export { refWhere };
