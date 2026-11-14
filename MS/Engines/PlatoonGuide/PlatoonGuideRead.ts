/**
 * PlatoonGuideRead.ts
 *
 * The Platoon Guide's pure engine: what a section, platoon or company commander needs at one point and in the bubble
 * round it, read from the terrain bundle through a `PlProbe` the caller supplies (OCOKA_Roadmap.md ch. 8, "Field
 * soldier"; user, 2026-11-11). No runtime imports, no DOM, no ArcGIS, so Node runs it as it is
 * (`node tools/platoon-test/run.mjs`) and the browser runs the same code.
 *
 * Seven groups, each answering one question at the point:
 *   1 here    where am I and what is under my feet: the going, cover, water, the way out, landing site, hospital, KM stone
 *   2 see     what I see and what I cannot (dead / screened ground), who looks down on me, a range card, a resection
 *   3 danger  likely mine / IED and ambush sites on the roads round me, covered approaches to me, hazard areas, border
 *   4 people  people round me, the nearest built-up area, buildings here, sensitive sites, crowd points
 *   5 help    the nearest friendly post or police, supply, relay ground, radio shadow
 *   6 stop    where to halt: a patrol base / harbour and an OP site within the bubble
 *   7 patrol  a patrol route card for a line: legs, bearings, paces, time, dead and exposed stretches (`patrolCard`)
 *
 * The dangers on roads come from the Movement Guide's route scan, injected as `scanRoad` so the rules
 * (MovementDoctrine.json) live in one place and this file keeps no runtime import. Everything is in Web Mercator metres;
 * ground distances are Mercator metres times the cosine of the latitude. Every reading carries what to check on the
 * ground: the output is a plan plus a recce list, not a replacement for recce.
 */

import type { GoingSets, MovProbe, NearFeature, NearLine, RouteReading, Stretch } from '../MovementGuide/MovementGuideScan';

export type MercXY = [number, number];
export type PlEchelon = 'team' | 'section' | 'platoon' | 'company' | 'default';
export type PlEye = 'prone' | 'kneeling' | 'standing' | 'rooftop';
export type PlLayer = 'cc' | 'wet' | 'landform' | 'hut' | 'distHls' | 'terrain';
export type PlGoing = 'go' | 'slow' | 'nogo' | 'unknown';

/** The bundle as this engine reads it: the Movement Guide's probe plus the GROTBC rasters and a two-part sight. */
export interface PlProbe extends MovProbe {
  /** Raw byte of a GROTBC layer at a point; null when not known (no data, or still loading: see takePending). */
  raster(layer: PlLayer, x: number, y: number): number | null;
  /** Both chances a target is seen: `p` with crops, trees and buildings, `pTerrain` with the ground alone. */
  sight2(ox: number, oy: number, eyeM: number, tx: number, ty: number, targetM: number): { p: number; pTerrain: number } | null;
  /**
   * Optional: every road and track line within reach from the road network (minor roads and tracks included). When a
   * probe has it and it finds lines, the danger scan walks these instead of the map's own road lines.
   */
  roadLines?(x: number, y: number, radiusM: number): NearLine[];
}

export type Rules = Record<string, any>;

/** The doctrine file with every value it leaves out filled in from the defaults below. */
export function plRulesFrom(doc: unknown): Rules {
  const d: Rules = (doc && typeof doc === 'object' ? doc : {}) as Rules;
  const out: Rules = {};
  for (const [k, v] of Object.entries(DEFAULTS)) out[k] = { ...v, ...(d[k] ?? {}) };
  return out;
}
const DEFAULTS: Rules = {
  bubble: { radiusM: { team: 300, section: 500, platoon: 1000, company: 2000, default: 1000 }, sightMaxM: 1500, sightStepM: 50, sightBearings: 36, eyeM: { prone: 0.5, kneeling: 1, standing: 1.6, rooftop: 6 }, manM: 1.7, seenP: 0.5 },
  here: { coverSearchM: 600, coverStepM: 30, coverBearings: 16, wayOutM: 300, wayOutStepM: 15, roadSearchM: 5000 },
  water: { radiusKm: 5, perennial: ['well_lined', 'well_unlined', 'well', 'spring', 'karez', 'tank_perennial', 'hand_pump', 'tank_overhead'], powered: ['tube_well'], seasonal: ['tank_seasonal'], lineKinds: ['river', 'canal'], brackishKm: 2, noteKind: 'note_water' },
  hls: { recordedKm: 40, recorded: ['helipad', 'landing_strip', 'landing_ground', 'airfield', 'air_base', 'airport', 'road_runway'], clearM: 40, searchM: 2000, wireM: 500, wireKinds: ['mast', 'wind_tower', 'telecom_booster', 'chimney'], wireLines: ['power_line'] },
  medical: { radiusKm: 60, kinds: { hospital: 'Hospital', bhu: 'Basic health unit', dispensary: 'Dispensary' }, roadFactor: 1.4, roadKmh: 40 },
  where: { kmStoneKm: 3, kmKinds: ['km_road', 'km_rail', 'km_canal'], placeKm: 10, placeKinds: ['city', 'district_hq', 'town', 'village_imp', 'village', 'locality'] },
  see: { deadNearM: 300, overlookRiseM: 5, overlookMaxM: 800, overlookStepM: 100, rooftopsM: 300, rooftopHeightMin: 2, rooftopDensityMin: 3, refKinds: ['watch_tower', 'mast', 'tomb', 'peak', 'hill', 'trig_station', 'bridge'], refTallM: 5, refMinM: 100, refMax: 6, rangeRingsM: [100, 200, 300, 500, 800], resectionKinds: ['trig_station', 'peak', 'hill', 'mast', 'watch_tower'], resectionMinM: 300, resectionMaxM: 5000, resectionMinAngleDeg: 30 },
  danger: { roadKmMax: 30, kinds: ['mine', 'ambush', 'vp', 'block', 'overlooked', 'rooftops'], minScore: 40, maxPerKind: 6, mergeM: 150, approachM: 150, approachClasses: [17, 47, 46, 24, 25], hazardKm: 2, hazardKinds: ['firing_range', 'mine_shaft', 'deserted_site', 'cave'], lineHazardM: 200, lineHazardKinds: ['power_line', 'pipeline'], borderKm: 20, borderNearKm: 5, monsoonMonths: [6, 7, 8, 9] },
  people: { sensitiveKinds: ['mosque', 'school', 'hospital', 'tomb', 'graveyard_pt'], crowdKinds: ['market', 'bus_stand', 'rail_station'], listMax: 6, buaKm: 10, buaKinds: ['city', 'district_hq', 'town', 'village_imp', 'village'] },
  help: { radiusKm: 30, kinds: ['post', 'fort', 'border_post', 'cantonment', 'police_station'], supplyKinds: ['petrol_pump', 'rest_house'], relayKm: 3, valleyRiseM: 100 },
  stop: { gridM: 100, minConcealment: 2, villageM: 1000, roadM: 300, waterKm: 2, waysOutMin: 2, maxCandidates: 600, opCandidates: 12, opRadiusM: 1000, opRiseM: 5 },
  patrol: { pacesPer100m: 120, boundM: 650, fmpM: 450, legFeatureM: 150, legFeatureKinds: ['bridge', 'tomb', 'mosque', 'peak', 'hill'], stationM: 50, classGround: {}, roadClasses: [34, 35, 36, 37, 38] },
};

// ── geometry ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const EARTH_R = 6378137;
const D2R = Math.PI / 180;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function latOfY(y: number): number {
  return 2 * Math.atan(Math.exp(y / EARTH_R)) - Math.PI / 2;
}
export function plScale(y: number): number {
  return Math.max(0.05, Math.cos(latOfY(y)));
}
export function plDist(a: MercXY, b: MercXY): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]) * plScale((a[1] + b[1]) / 2);
}
export function plBearing(a: MercXY, b: MercXY): number {
  return ((Math.atan2(b[0] - a[0], b[1] - a[1]) / D2R) + 360) % 360;
}
export function plOffset(p: MercXY, bearingDeg: number, distM: number): MercXY {
  const s = plScale(p[1]);
  return [p[0] + (Math.sin(bearingDeg * D2R) * distM) / s, p[1] + (Math.cos(bearingDeg * D2R) * distM) / s];
}
export function plCompass(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
export function plLngLat(p: MercXY): [number, number] {
  return [(p[0] * 180) / (Math.PI * EARTH_R), latOfY(p[1]) / D2R];
}
function distToXY(p: MercXY, xy: ArrayLike<number>): { d: number; at: MercXY } {
  let best = Infinity;
  let at: MercXY = [p[0], p[1]];
  for (let i = 0; i + 3 < xy.length; i += 2) {
    const ax = xy[i], ay = xy[i + 1];
    const dx = xy[i + 2] - ax, dy = xy[i + 3] - ay;
    const len = dx * dx + dy * dy;
    const t = len > 0 ? Math.min(1, Math.max(0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len)) : 0;
    const qx = ax + t * dx, qy = ay + t * dy;
    const d = (qx - p[0]) ** 2 + (qy - p[1]) ** 2;
    if (d < best) {
      best = d;
      at = [qx, qy];
    }
  }
  if (xy.length === 2) {
    at = [xy[0], xy[1]];
    best = (xy[0] - p[0]) ** 2 + (xy[1] - p[1]) ** 2;
  }
  return { d: Math.sqrt(best) * plScale(p[1]), at };
}
function angGap(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

// ── shapes ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A place on the map the card names: what it is, where, how far and which way from the point. */
export interface PlSpot {
  kind: string;
  label: string;
  name: string | null;
  x: number;
  y: number;
  distM: number;
  bearingDeg: number;
  dir: string;
  why?: string;
  score?: number;
  attrs?: Record<string, unknown>;
}

function spotAt(from: MercXY, x: number, y: number, kind: string, label: string, name: string | null = null, extra: Partial<PlSpot> = {}): PlSpot {
  const b = plBearing(from, [x, y]);
  return { kind, label, name, x, y, distM: plDist(from, [x, y]), bearingDeg: b, dir: plCompass(b), ...extra };
}
function spotOf(from: MercXY, f: NearFeature, extra: Partial<PlSpot> = {}): PlSpot {
  return spotAt(from, f.x, f.y, f.kind, f.label, f.name, { attrs: f.attrs, ...extra });
}

export interface PlCodebooks {
  wet?: Record<string, string>;
  landform?: Record<string, string>;
  bldDensity?: Record<string, string>;
  bldSize?: Record<string, string>;
  ccLevels?: Record<string, string>;
}

/** The Movement Guide's route scan, bound to a probe and a mover by the caller; `threat` adds the threat's view. */
export type ScanFn = (path: MercXY[], sight: boolean, threat?: MercXY | null) => RouteReading;

/** People round the point, from the population grid (the browser side reads it; WorldPop estimates, not a census). */
export interface PlPeopleIn {
  perKm2At: number | null;
  rings: Array<{ km: number; people: number }>;
  ages: { males15_49: number; under15: number; over65: number } | null;
  /** People within 2 km by direction, N NE E SE S SW W NW. */
  sectors?: number[] | null;
  /** People per km² on a square grid centred on the point's cell (north row first; -1 = no data). */
  grid?: PlPeopleGrid | null;
  /** People per km² by distance band out to 10 km. */
  bands?: Array<{ fromKm: number; toKm: number; perKm2: number }> | null;
  pending?: boolean;
}

export interface PlPeopleGrid {
  size: number;
  cellKm: number;
  perKm2: number[];
}

export interface PlContext {
  at: MercXY;
  echelon: PlEchelon;
  eye: PlEye;
  month: number;
  foot: GoingSets;
  veh: GoingSets;
  classLabel: (c: number) => string;
  codebooks?: PlCodebooks;
  threat?: MercXY | null;
  borders?: Array<{ kind: string; xy: ArrayLike<number>; box: [number, number, number, number] }>;
  /** The Movement Guide's route scan on a road (wheeled), or on a patrol route (foot); injected. */
  scanRoad?: ScanFn;
  people?: PlPeopleIn | null;
  /** Run the costly groups (sight, dangers on roads, where to stop). Off on the live path (every mouse move). */
  full: boolean;
}

export interface PlHere {
  cls: number | null;
  clsLabel: string;
  going: { foot: PlGoing; veh: PlGoing; afterRain: string | null };
  cover: { cover: number | null; concealment: number | null };
  betterCover: PlSpot | null;
  betterConcealment: PlSpot | null;
  water: { nearest: PlSpot | null; perennial: PlSpot | null; line: PlSpot | null; brackish: PlSpot | null; count: number };
  waysOut: { dirs: Array<{ dir: string; bearingDeg: number; foot: PlGoing; veh: PlGoing }>; road: PlSpot | null };
  hls: { recorded: PlSpot | null; ground: PlSpot | null; wires: PlSpot[] };
  medical: { hospital: PlSpot | null; bhu: PlSpot | null; dispensary: PlSpot | null; driveMin: number | null };
  where: { lngLat: [number, number]; km: PlSpot | null; place: PlSpot | null; district: string | null; tehsil: string | null };
}

export interface PlRay {
  bearingDeg: number;
  /** One state per step out from the point: 0 unknown, 1 seen, 2 screened (crops, trees, buildings), 3 dead ground. */
  states: Uint8Array;
}
export interface PlSee {
  eyeM: number;
  radiusM: number;
  stepM: number;
  rays: PlRay[];
  pct: { seen: number; screened: number; dead: number };
  near: { seen: number; screened: number; dead: number };
  deadNear: PlSpot | null;
  /** Directions where dead or screened ground reaches within `danger.approachM` of the point. */
  approachDirs: string[];
  overlook: PlSpot[];
  rooftops: PlSpot | null;
  skyline: boolean;
  refs: PlSpot[];
  resection: PlSpot[];
}

export interface PlDanger {
  spots: PlSpot[];
  counts: Record<string, number>;
  roadKm: number;
  /** Ground that gives a covered approach to the point (nullah, bund, orchard, wall ...). */
  approaches: PlSpot[];
  hazards: PlSpot[];
  border: { km: number; kind: string } | null;
  natural: string[];
  /** Some reads met data still loading. */
  pending: boolean;
}

export interface PlPeople {
  perKm2: number | null;
  within500: number | null;
  rings: Array<{ km: number; people: number }>;
  ages: { males15_49: number; under15: number; over65: number } | null;
  bua: PlSpot | null;
  bld: { density: string; size: string; tall: boolean } | null;
  huts: { perKm2: number; temporary: boolean } | null;
  sensitive: { counts: Array<{ label: string; n: number }>; nearest: PlSpot[] };
  crowd: PlSpot[];
  /** People within 2 km by direction (N first), when the population grid is loaded. */
  sectors: number[] | null;
  grid: PlPeopleGrid | null;
  bands: Array<{ fromKm: number; toKm: number; perKm2: number }> | null;
}

export interface PlHelp {
  friends: PlSpot[];
  supply: PlSpot[];
  relay: PlSpot | null;
  radioShadow: boolean;
}

/** A patrol base site that passed every test, with its facts as numbers (for the Stop tab's pictures). */
export interface PlStopSite {
  x: number;
  y: number;
  distM: number;
  bearingDeg: number;
  dir: string;
  score: number;
  /** Concealment and cover, 0 none .. 3 good. */
  conceal: number;
  cover: number;
  /** Ways out on foot, of eight, and which (N first). */
  ways: number;
  waysDirs: boolean[];
  waterM: number;
  /** The nearest BUA within reach (null: none within the BUA test's distance and the bubble). */
  buaM: number | null;
}

export interface PlStop {
  harbour: PlSpot | null;
  /** Why the harbour site is the best one found, and what it could not check. */
  harbourWhy: string[];
  op: PlSpot | null;
  /** Why the OP site was chosen, or why none was. */
  opWhy: string;
  /** The tests every site went through, in order, each with the sites it ruled out (a site counts once: the first test
   *  it failed). */
  tests: Array<{ key: string; label: string; out: number }>;
  /** Sites read on the grid, and how many passed every test. */
  checked: number;
  passed: number;
  /** The grid read: each site as [metres east, metres north of the point, index of the first test failed or -1 passed]. */
  grid: { stepM: number; cells: Array<[number, number, number]> };
  /** The best sites at least 250 m apart, best first (the first is the harbour). */
  sites: PlStopSite[];
  /** The OP: the share of the ground it sees in each of 24 directions (15° apart, N first) out to 1 km. */
  opView: number[] | null;
  /** The OP's height above the bubble's mean height, m; with no OP, the highest ground's. */
  opRiseM: number | null;
  /** The rule figures the tests used (PlatoonDoctrine.json stop). */
  rules: { villageM: number; roadM: number; waterKm: number; opRiseM: number };
}

export interface PlReading {
  at: MercXY;
  lngLat: [number, number];
  echelon: PlEchelon;
  radiusM: number;
  eye: PlEye;
  month: number;
  here: PlHere;
  see: PlSee | null;
  danger: PlDanger | null;
  people: PlPeople;
  help: PlHelp;
  stop: PlStop | null;
  checks: string[];
  gaps: string[];
  full: boolean;
  pending: boolean;
}

// ── reading ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function going(c: number | null, g: GoingSets): PlGoing {
  if (c === null) return 'unknown';
  if (g.nogo.has(c)) return 'nogo';
  if (g.caution.has(c)) return 'slow';
  return 'go';
}

function nearestOf(list: NearFeature[]): NearFeature | null {
  let best: NearFeature | null = null;
  for (const f of list) if (!best || f.distM < best.distM) best = f;
  return best;
}

/** Search outward (radii, then bearings) for the first point that passes `ok`. */
function ringSearch(at: MercXY, stepM: number, maxM: number, bearings: number, ok: (p: MercXY) => boolean): { p: MercXY; distM: number; bearingDeg: number } | null {
  for (let r = stepM; r <= maxM + 1e-6; r += stepM) {
    for (let i = 0; i < bearings; i++) {
      const b = (360 * i) / bearings;
      const p = plOffset(at, b, r);
      if (ok(p)) return { p, distM: r, bearingDeg: b };
    }
  }
  return null;
}

/** Features within a growing radius: a short search first, so a far one never waits for tiles it does not need. */
function nearestGrowing(probe: PlProbe, at: MercXY, radiiM: number[], kinds: ReadonlySet<string>): NearFeature | null {
  for (const r of radiiM) {
    const f = nearestOf(probe.features(at[0], at[1], r, kinds));
    if (f) return f;
  }
  return null;
}

/** Read the point. `ctx.full` adds the costly groups (sight, dangers on roads, where to stop). */
export function readPoint(probe: PlProbe, R: Rules, ctx: PlContext): PlReading {
  probe.takePending?.();
  const at = ctx.at;
  const radiusM = R.bubble.radiusM[ctx.echelon] ?? R.bubble.radiusM.default ?? 1000;
  const here = readHere(probe, R, ctx);
  const people = readPeople(probe, R, ctx, radiusM);
  const help = readHelp(probe, R, ctx);
  let see: PlSee | null = null;
  let danger: PlDanger | null = null;
  let stop: PlStop | null = null;
  // The route scan takes the probe's pending flag for itself: take ours before each scan.
  let pending = (probe.takePending?.() ?? false) || ctx.people?.pending === true;
  if (ctx.full) {
    see = readSee(probe, R, ctx, radiusM);
    pending = (probe.takePending?.() ?? false) || pending;
    danger = readDanger(probe, R, ctx, radiusM, see);
    pending = danger.pending || pending;
    stop = readStop(probe, R, ctx, radiusM);
    const relay = readRelay(probe, R, ctx);
    help.relay = relay.relay;
    help.radioShadow = relay.shadow;
  }
  pending = (probe.takePending?.() ?? false) || pending;
  const reading: PlReading = {
    at,
    lngLat: plLngLat(at),
    echelon: ctx.echelon,
    radiusM,
    eye: ctx.eye,
    month: ctx.month,
    here,
    see,
    danger,
    people,
    help,
    stop,
    checks: [],
    gaps: [],
    full: ctx.full,
    pending,
  };
  reading.checks = checksFor(reading);
  reading.gaps = gapsFor(reading);
  return reading;
}

// ── 1 here ───────────────────────────────────────────────────────────────────────────────────────────────────────────

function readHere(probe: PlProbe, R: Rules, ctx: PlContext): PlHere {
  const at = ctx.at;
  const H = R.here;
  const cls = probe.cls(at[0], at[1]);
  const wet = probe.raster('wet', at[0], at[1]);
  const wetLabel = wet !== null && wet > 0 ? ctx.codebooks?.wet?.[String(wet)] ?? `Wet ${wet}` : null;
  let afterRain: string | null = null;
  if (wetLabel) afterRain = `${wetLabel}: vehicles SLOW-GO or NO-GO after rain`;
  else if (cls === 17 || cls === 47) afterRain = 'Dry nullah: flash floods after rain';
  const cc = probe.raster('cc', at[0], at[1]);
  const cover = cc === null ? null : cc & 15;
  const concealment = cc === null ? null : cc >> 4;
  const ccOf = (p: MercXY) => probe.raster('cc', p[0], p[1]);
  const coverNeed = Math.max(2, (cover ?? 0) + 1);
  const concealNeed = Math.max(2, (concealment ?? 0) + 1);
  const bc = coverNeed > 3 ? null : ringSearch(at, H.coverStepM, H.coverSearchM, H.coverBearings, (p) => {
    const v = ccOf(p);
    return v !== null && (v & 15) >= coverNeed;
  });
  const bh = concealNeed > 3 ? null : ringSearch(at, H.coverStepM, H.coverSearchM, H.coverBearings, (p) => {
    const v = ccOf(p);
    return v !== null && v >> 4 >= concealNeed;
  });
  const lvl = (n: number) => ctx.codebooks?.ccLevels?.[String(n)] ?? ['None', 'Poor', 'Fair', 'Good'][n] ?? String(n);
  const betterCover = bc ? spotAt(at, bc.p[0], bc.p[1], 'cover', `${lvl((ccOf(bc.p) ?? 0) & 15)} cover`) : null;
  const betterConcealment = bh ? spotAt(at, bh.p[0], bh.p[1], 'concealment', `${lvl((ccOf(bh.p) ?? 0) >> 4)} concealment`) : null;

  // Water: the nearest of any kind, the nearest that does not need power or a season, a river or canal, brackish notes.
  const W = R.water;
  const perennial = new Set<string>(W.perennial);
  const anyWater = new Set<string>([...W.perennial, ...W.powered, ...W.seasonal]);
  const wr = W.radiusKm * 1000;
  const waters = probe.features(at[0], at[1], wr, anyWater);
  const nearW = waters[0] ?? null;
  const perW = waters.find((f) => perennial.has(f.kind)) ?? null;
  const tagWater = (f: NearFeature): string =>
    W.powered.includes(f.kind) ? 'needs power' : W.seasonal.includes(f.kind) ? 'seasonal' : 'no power needed';
  let line: PlSpot | null = null;
  for (const l of probe.lines(at[0], at[1], Math.min(wr, 3000), new Set<string>(W.lineKinds))) {
    const d = distToXY(at, l.xy);
    if (d.d <= Math.min(wr, 3000) && (!line || d.d < line.distM)) {
      const nm = typeof l.attrs.n === 'string' ? l.attrs.n : null;
      line = spotAt(at, d.at[0], d.at[1], l.kind, l.kind === 'canal' ? 'Canal' : 'River', nm, { why: 'flowing water: may be closed or dry in some months' });
    }
  }
  const notes = probe.features(at[0], at[1], W.brackishKm * 1000, new Set<string>([W.noteKind])).filter((f) => /brack|salt|saline/i.test(String(f.attrs.n ?? '')));
  const water = {
    nearest: nearW ? spotOf(at, nearW, { why: tagWater(nearW) }) : null,
    perennial: perW && perW !== nearW ? spotOf(at, perW, { why: tagWater(perW) }) : null,
    line,
    brackish: notes[0] ? spotOf(at, notes[0], { label: 'Map note', why: String(notes[0].attrs.n ?? 'Brackish') }) : null,
    count: waters.length,
  };

  // The way out: eight directions, walked out to `wayOutM`; the worst ground met decides.
  const dirs: PlHere['waysOut']['dirs'] = [];
  for (let i = 0; i < 8; i++) {
    const b = i * 45;
    let f: PlGoing = 'go', v: PlGoing = 'go';
    let known = false;
    for (let r = H.wayOutStepM; r <= H.wayOutM + 1e-6; r += H.wayOutStepM) {
      const p = plOffset(at, b, r);
      const c = probe.cls(p[0], p[1]);
      if (c === null) continue;
      known = true;
      const gf = going(c, ctx.foot), gv = going(c, ctx.veh);
      if (gf === 'nogo' || (gf === 'slow' && f === 'go')) f = gf;
      if (gv === 'nogo' || (gv === 'slow' && v === 'go')) v = gv;
    }
    dirs.push({ dir: COMPASS[i], bearingDeg: b, foot: known ? f : 'unknown', veh: known ? v : 'unknown' });
  }
  // The nearest road or track: the road network (main roads) and the map's own road lines (minor roads and tracks too).
  let road: PlSpot | null = null;
  for (const rr of [500, 2000, H.roadSearchM]) {
    const roads = probe.roads(at[0], at[1], rr);
    if (roads.length) {
      const r0 = roads.reduce((m, r) => (r.distM < m.distM ? r : m));
      road = spotAt(at, r0.x, r0.y, 'road', roadWord(r0.attrs), roadName(r0.attrs), { attrs: r0.attrs });
      break;
    }
  }
  for (const l of probe.lines(at[0], at[1], Math.min(road?.distM ?? 3000, 3000), new Set<string>(['road']))) {
    const d = distToXY(at, l.xy);
    if (!road || d.d < road.distM) road = spotAt(at, d.at[0], d.at[1], 'road', roadWord(l.attrs), roadName(l.attrs), { attrs: l.attrs });
  }

  // Landing site: one recorded, and the nearest clear ground for a helicopter (the hls profile's distance to NO-GO).
  const HL = R.hls;
  const rec = nearestGrowing(probe, at, [5000, 15000, HL.recordedKm * 1000], new Set<string>(HL.recorded));
  const clearPx = (p: MercXY) => {
    const v = probe.raster('distHls', p[0], p[1]);
    return v !== null && v < 255 && v * 10 >= HL.clearM;
  };
  const gr = clearPx(at) ? { p: at, distM: 0, bearingDeg: 0 } : ringSearch(at, 50, HL.searchM, 16, clearPx);
  const ground = gr ? spotAt(at, gr.p[0], gr.p[1], 'hls_ground', 'Clear Gr for a helicopter', null, { why: `${HL.clearM} m clear of NO-GO for a landing (hls)` }) : null;
  const wires: PlSpot[] = [];
  if (ground) {
    for (const f of probe.features(ground.x, ground.y, HL.wireM, new Set<string>(HL.wireKinds))) wires.push(spotOf([ground.x, ground.y], f));
    for (const l of probe.lines(ground.x, ground.y, HL.wireM, new Set<string>(HL.wireLines))) {
      const d = distToXY([ground.x, ground.y], l.xy);
      if (d.d <= HL.wireM) {
        const kv = typeof l.attrs.v === 'number' ? ` ${l.attrs.v} kV` : '';
        wires.push(spotAt([ground.x, ground.y], d.at[0], d.at[1], l.kind, `Power line${kv}`));
      }
    }
    wires.sort((a, b) => a.distM - b.distM);
  }
  const hls = { recorded: rec ? spotOf(at, rec) : null, ground, wires: wires.slice(0, 4) };

  // Medical: hospital, basic health unit, dispensary.
  const M = R.medical;
  const med = (k: string) => {
    const f = nearestGrowing(probe, at, [10000, 30000, M.radiusKm * 1000], new Set<string>([k]));
    return f ? spotOf(at, f, { label: M.kinds[k] ?? f.label }) : null;
  };
  const hospital = med('hospital');
  const medical = {
    hospital,
    bhu: med('bhu'),
    dispensary: med('dispensary'),
    driveMin: hospital ? Math.round(((hospital.distM / 1000) * M.roadFactor * 60) / M.roadKmh) : null,
  };

  // Where am I: the KM stone, the nearest named place, district and tehsil.
  const WH = R.where;
  const km = probe.features(at[0], at[1], WH.kmStoneKm * 1000, new Set<string>(WH.kmKinds))[0] ?? null;
  let kmSpot: PlSpot | null = null;
  if (km) {
    const n = km.attrs.n;
    const kindWord = km.kind === 'km_rail' ? 'Rly KM' : km.kind === 'km_canal' ? 'Canal KM' : 'KM';
    // The road it stands on: the map's road lines first (they carry the names), else the road network.
    let rd: string | null = null;
    if (km.kind === 'km_road') {
      let best = 150;
      for (const l of probe.lines(km.x, km.y, 150, new Set<string>(['road']))) {
        const d = distToXY([km.x, km.y], l.xy).d;
        if (d < best && roadName(l.attrs)) {
          best = d;
          rd = roadName(l.attrs);
        }
      }
      if (!rd) {
        const onRoad = probe.roads(km.x, km.y, 150)[0];
        rd = onRoad ? roadName(onRoad.attrs) : null;
      }
    }
    // A stone without a recorded number still marks the road: the number is read off the stone itself.
    const numbered = typeof n === 'number' || (typeof n === 'string' && n.trim() !== '');
    kmSpot = spotOf(at, km, { label: numbered ? `${kindWord} ${n}` : km.kind === 'km_road' ? 'KM stone' : `${kindWord} stone`, name: rd });
  }
  const places = probe.features(at[0], at[1], WH.placeKm * 1000, new Set<string>(WH.placeKinds)).filter((f) => f.name);
  const place = places[0] ?? null;
  const withAdmin = places.find((f) => f.attrs.d || f.attrs.h) ?? place;
  return {
    cls,
    clsLabel: cls === null ? 'Not known' : ctx.classLabel(cls),
    going: { foot: going(cls, ctx.foot), veh: going(cls, ctx.veh), afterRain },
    cover: { cover, concealment },
    betterCover,
    betterConcealment,
    water,
    waysOut: { dirs, road },
    hls,
    medical,
    where: {
      lngLat: plLngLat(at),
      km: kmSpot,
      place: place ? spotOf(at, place) : null,
      district: withAdmin && typeof withAdmin.attrs.d === 'string' ? withAdmin.attrs.d : null,
      tehsil: withAdmin && typeof withAdmin.attrs.h === 'string' ? withAdmin.attrs.h : null,
    },
  };
}

function roadName(a: Record<string, unknown>): string | null {
  const r = a.r ?? a.rno;
  const n = a.n ?? a.name;
  if (typeof r === 'string' && r.trim()) return r.trim();
  if (typeof n === 'string' && n.trim()) return n.trim();
  return null;
}
function roadWord(a: Record<string, unknown>): string {
  const t = String(a.t ?? a.type ?? '');
  if (/track|unmetal|kacha|jeep/i.test(t)) return 'Tr';
  return 'Rd';
}

// ── 2 see ────────────────────────────────────────────────────────────────────────────────────────────────────────────

function readSee(probe: PlProbe, R: Rules, ctx: PlContext, radiusM: number): PlSee {
  const B = R.bubble;
  const S = R.see;
  const at = ctx.at;
  const eyeM = B.eyeM[ctx.eye] ?? 1.6;
  const reach = Math.min(radiusM, B.sightMaxM);
  const stepM = B.sightStepM;
  const steps = Math.max(1, Math.round(reach / stepM));
  const nb = B.sightBearings;
  const rays: PlRay[] = [];
  const tally = { seen: 0, screened: 0, dead: 0, n: 0 };
  const near = { seen: 0, screened: 0, dead: 0, n: 0 };
  let deadNear: PlSpot | null = null;
  const approach = new Set<string>();
  for (let i = 0; i < nb; i++) {
    const b = (360 * i) / nb;
    const states = new Uint8Array(steps);
    for (let k = 0; k < steps; k++) {
      const r = (k + 1) * stepM;
      const p = plOffset(at, b, r);
      const s = probe.sight2(at[0], at[1], eyeM, p[0], p[1], B.manM);
      let st = 0;
      if (s) st = s.p >= B.seenP ? 1 : s.pTerrain >= B.seenP ? 2 : 3;
      states[k] = st;
      if (!st) continue;
      tally.n++;
      if (st === 1) tally.seen++;
      else if (st === 2) tally.screened++;
      else tally.dead++;
      if (r <= S.deadNearM) {
        near.n++;
        if (st === 1) near.seen++;
        else if (st === 2) near.screened++;
        else near.dead++;
      }
      if (st === 3 && r <= S.deadNearM && (!deadNear || r < deadNear.distM)) deadNear = spotAt(at, p[0], p[1], 'dead', 'Dead Gr', null, { why: 'a man there is hidden from you by the ground' });
      if (st >= 2 && r <= R.danger.approachM) approach.add(plCompass(b));
    }
    rays.push({ bearingDeg: b, states });
  }
  const pct = (t: { seen: number; screened: number; dead: number; n: number }) =>
    t.n ? { seen: Math.round((100 * t.seen) / t.n), screened: Math.round((100 * t.screened) / t.n), dead: Math.round((100 * t.dead) / t.n) } : { seen: 0, screened: 0, dead: 0 };

  // Who looks down on me: higher ground within reach that sees a man here.
  const myElev = probe.elev(at[0], at[1]);
  const over: PlSpot[] = [];
  if (Number.isFinite(myElev)) {
    for (let r = S.overlookStepM; r <= S.overlookMaxM + 1e-6; r += S.overlookStepM) {
      for (let i = 0; i < 16; i++) {
        const b = i * 22.5;
        const p = plOffset(at, b, r);
        const e = probe.elev(p[0], p[1]);
        if (!Number.isFinite(e) || e - myElev < S.overlookRiseM) continue;
        const s = probe.sight(p[0], p[1], 1.6, at[0], at[1], eyeM);
        if (s === null || s < B.seenP) continue;
        over.push(spotAt(at, p[0], p[1], 'overlook', 'Overlooking Gr', null, { why: `${Math.round(e - myElev)} m above you, may see you`, score: (e - myElev) * (1 - r / (S.overlookMaxM * 1.5)) }));
      }
    }
  }
  over.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const overlook: PlSpot[] = [];
  for (const o of over) {
    if (overlook.length >= 4) break;
    if (overlook.every((k) => angGap(k.bearingDeg, o.bearingDeg) >= 40)) overlook.push(o);
  }

  // Rooftops: tall, close-packed buildings within reach.
  const rf = ringSearch(at, 30, S.rooftopsM, 16, (p) => {
    const v = probe.bld(p[0], p[1]);
    return (v & 7) >= S.rooftopDensityMin && v >> 6 >= S.rooftopHeightMin;
  });
  const rooftops = rf ? spotAt(at, rf.p[0], rf.p[1], 'rooftops', 'Rooftops', null, { why: 'tall, close-packed buildings: firers on the roofs may see you' }) : null;
  const lf = probe.raster('landform', at[0], at[1]);
  const skyline = lf === 6;

  // Range card: seen landmarks, one per 60 degree sector, nearest first in each.
  const refCands = probe.features(at[0], at[1], reach, new Set<string>(S.refKinds)).filter((f) => f.distM >= S.refMinM);
  const bySector = new Map<number, PlSpot>();
  for (const f of refCands) {
    const b = plBearing(at, [f.x, f.y]);
    const sec = Math.floor(b / 60);
    const cur = bySector.get(sec);
    if (cur && (cur.name || !f.name) && cur.distM <= f.distM) continue;
    const s = probe.sight(at[0], at[1], eyeM, f.x, f.y, S.refTallM);
    if (s === null || s < B.seenP) continue;
    bySector.set(sec, spotOf(at, f, { why: 'in view: reference point' }));
  }
  const refs = [...bySector.values()].sort((a, b) => a.bearingDeg - b.bearingDeg).slice(0, S.refMax);

  // Resection: three fixed, seen landmarks spread round the horizon.
  const rc = probe
    .features(at[0], at[1], S.resectionMaxM, new Set<string>(S.resectionKinds))
    .filter((f) => f.distM >= S.resectionMinM)
    .slice(0, 40)
    .filter((f) => (probe.sight(at[0], at[1], eyeM, f.x, f.y, S.refTallM) ?? 0) >= B.seenP)
    .slice(0, 15)
    .map((f) => spotOf(at, f, { why: 'fixed and in view: take its bearing' }));
  let best: PlSpot[] = [];
  let bestScore = -1;
  for (let i = 0; i < rc.length; i++)
    for (let j = i + 1; j < rc.length; j++)
      for (let k = j + 1; k < rc.length; k++) {
        const t = [rc[i], rc[j], rc[k]];
        const gaps = [angGap(t[0].bearingDeg, t[1].bearingDeg), angGap(t[1].bearingDeg, t[2].bearingDeg), angGap(t[0].bearingDeg, t[2].bearingDeg)];
        const minGap = Math.min(...gaps);
        if (minGap < S.resectionMinAngleDeg) continue;
        if (minGap > bestScore) {
          bestScore = minGap;
          best = t;
        }
      }
  return {
    eyeM,
    radiusM: reach,
    stepM,
    rays,
    pct: pct(tally),
    near: pct(near),
    deadNear,
    approachDirs: COMPASS.filter((d) => approach.has(d)),
    overlook,
    rooftops,
    skyline,
    refs,
    resection: best.sort((a, b) => a.bearingDeg - b.bearingDeg),
  };
}

// ── 3 danger ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The roads and tracks inside the bubble, cut into runs that stay inside it. */
export function roadRunsIn(probe: PlProbe, at: MercXY, radiusM: number, maxKm: number): MercXY[][] {
  const runs: Array<{ path: MercXY[]; d: number; len: number }> = [];
  const r2 = radiusM;
  // The road network (minor roads and tracks too) when the probe has it; the map's own road lines otherwise.
  const net = probe.roadLines?.(at[0], at[1], radiusM) ?? [];
  const source = net.length ? net : probe.lines(at[0], at[1], radiusM, new Set<string>(['road']));
  for (const l of source) {
    let cur: MercXY[] = [];
    const flush = () => {
      if (cur.length >= 2) {
        let len = 0;
        let d = Infinity;
        for (let i = 0; i < cur.length; i++) {
          d = Math.min(d, plDist(at, cur[i]));
          if (i) len += plDist(cur[i - 1], cur[i]);
        }
        if (len >= 60) runs.push({ path: cur, d, len });
      }
      cur = [];
    };
    for (let i = 0; i + 3 < l.xy.length; i += 2) {
      const a: MercXY = [l.xy[i], l.xy[i + 1]];
      const b: MercXY = [l.xy[i + 2], l.xy[i + 3]];
      const L = plDist(a, b);
      const n = Math.max(1, Math.ceil(L / 50));
      for (let k = i === 0 ? 0 : 1; k <= n; k++) {
        const t = k / n;
        const p: MercXY = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        if (plDist(at, p) <= r2) cur.push(p);
        else flush();
      }
    }
    flush();
  }
  runs.sort((a, b) => a.d - b.d);
  const out: MercXY[][] = [];
  let km = 0;
  for (const r of runs) {
    if (km + r.len / 1000 > maxKm) break;
    km += r.len / 1000;
    out.push(r.path);
  }
  return out;
}

function readDanger(probe: PlProbe, R: Rules, ctx: PlContext, radiusM: number, see: PlSee | null): PlDanger {
  const D = R.danger;
  const at = ctx.at;
  const kinds = new Set<string>(D.kinds);
  const spots: PlSpot[] = [];
  let roadKm = 0;
  let pending = false;
  if (ctx.scanRoad) {
    const runs = roadRunsIn(probe, at, radiusM, D.roadKmMax);
    pending = probe.takePending?.() ?? false;
    for (const p of runs) for (let i = 1; i < p.length; i++) roadKm += plDist(p[i - 1], p[i]) / 1000;
    const sight = roadKm <= 8;
    const found: Stretch[] = [];
    for (const p of runs) {
      const r = ctx.scanRoad(p, sight, ctx.threat ?? null);
      if (r.pending) pending = true;
      for (const s of r.stretches) if (kinds.has(s.kind) && s.score >= D.minScore) found.push(s);
    }
    found.sort((a, b) => b.score - a.score);
    for (const s of found) {
      const dup = spots.find((o) => o.kind === s.kind && plDist([o.x, o.y], [s.x, s.y]) < D.mergeM);
      if (dup) continue;
      if (spots.filter((o) => o.kind === s.kind).length >= D.maxPerKind) continue;
      spots.push(spotAt(at, s.x, s.y, s.kind, s.label, null, { why: s.why, score: s.score }));
    }
  }
  const counts: Record<string, number> = {};
  for (const s of spots) counts[s.kind] = (counts[s.kind] ?? 0) + 1;

  // Covered approaches: nullahs, bunds, orchards, walls ... within reach of the point.
  const ac = new Set<number>(D.approachClasses);
  const approaches: PlSpot[] = [];
  for (let i = 0; i < 16; i++) {
    const b = i * 22.5;
    for (let r = 30; r <= Math.min(radiusM, 600) + 1e-6; r += 30) {
      const p = plOffset(at, b, r);
      const c = probe.cls(p[0], p[1]);
      if (c !== null && ac.has(c)) {
        if (!approaches.some((o) => o.kind === `cls${c}` && angGap(o.bearingDeg, b) < 50)) approaches.push(spotAt(at, p[0], p[1], `cls${c}`, ctx.classLabel(c), null, { why: 'may hide a man moving towards you' }));
        break;
      }
    }
  }
  approaches.sort((a, b) => a.distM - b.distM);
  if (see) for (const s of approaches) if (!see.approachDirs.includes(s.dir) && s.distM <= D.approachM) see.approachDirs.push(s.dir);

  // Hazard areas and lines.
  const hazards: PlSpot[] = probe.features(at[0], at[1], D.hazardKm * 1000, new Set<string>(D.hazardKinds)).slice(0, 8).map((f) => spotOf(at, f));
  for (const l of probe.lines(at[0], at[1], D.lineHazardM, new Set<string>(D.lineHazardKinds))) {
    const d = distToXY(at, l.xy);
    if (d.d <= D.lineHazardM) hazards.push(spotAt(at, d.at[0], d.at[1], l.kind, l.kind === 'pipeline' ? 'Pipeline' : 'Power line', null, { why: l.kind === 'pipeline' ? 'do not dig or fire on it' : 'wire hazard for helicopters' }));
  }
  hazards.sort((a, b) => a.distM - b.distM);

  let border: PlDanger['border'] = null;
  if (ctx.borders?.length) {
    const s = plScale(at[1]);
    const reach = (D.borderKm * 1000) / s;
    for (const b of ctx.borders) {
      if (at[0] < b.box[0] - reach || at[0] > b.box[2] + reach || at[1] < b.box[1] - reach || at[1] > b.box[3] + reach) continue;
      const km = distToXY(at, b.xy).d / 1000;
      if (km <= D.borderKm && (!border || km < border.km)) border = { km, kind: b.kind };
    }
  }

  const natural: string[] = [];
  const cls = probe.cls(at[0], at[1]);
  const wet = probe.raster('wet', at[0], at[1]);
  const monsoon = (D.monsoonMonths as number[]).includes(ctx.month);
  if (cls === 17 || cls === 47) natural.push(monsoon ? 'In a nullah in the monsoon: flash floods come without warning' : 'In a nullah: flash floods after rain');
  if (wet !== null && wet > 0) natural.push(`${ctx.codebooks?.wet?.[String(wet)] ?? 'Wet ground'}${monsoon ? ' in the monsoon' : ''}: may flood`);
  if (cls === 9 || cls === 27) natural.push('Steep or broken ground: falls and rockfall');
  if (cls === 8) natural.push('Snow / ice: cold injury, avalanche and crevasses');
  pending = (probe.takePending?.() ?? false) || pending;
  return { spots, counts, roadKm, approaches: approaches.slice(0, 6), hazards: hazards.slice(0, 8), border, natural, pending };
}

// ── 4 people ─────────────────────────────────────────────────────────────────────────────────────────────────────────

function readPeople(probe: PlProbe, R: Rules, ctx: PlContext, radiusM: number): PlPeople {
  const P = R.people;
  const at = ctx.at;
  const pin = ctx.people ?? null;
  const perKm2 = pin?.perKm2At ?? probe.people(at[0], at[1]);
  const within500 = perKm2 === null ? null : Math.round(perKm2 * Math.PI * 0.25);
  const buaF = probe.features(at[0], at[1], P.buaKm * 1000, new Set<string>(P.buaKinds)).find((f) => f.name) ?? null;
  let bua: PlSpot | null = null;
  if (buaF) {
    const wp = buaF.attrs.wp ?? buaF.attrs.p;
    bua = spotOf(at, buaF, { why: typeof wp === 'number' ? `about ${Math.round(wp).toLocaleString('en-GB')} people` : undefined });
  }
  const bv = probe.bld(at[0], at[1]);
  const dens = bv & 7;
  const size = (bv >> 3) & 7;
  const bld = dens > 0
    ? { density: ctx.codebooks?.bldDensity?.[String(dens)] ?? `Density ${dens}`, size: ctx.codebooks?.bldSize?.[String(size)] ?? (size ? `Size ${size}` : 'Not known'), tall: bv >> 6 >= 2 }
    : null;
  const hv = probe.raster('hut', at[0], at[1]);
  const huts = hv !== null && hv > 0 ? { perKm2: hv & 127, temporary: (hv & 128) !== 0 } : null;
  const sens = probe.features(at[0], at[1], radiusM, new Set<string>(P.sensitiveKinds));
  const byLabel = new Map<string, number>();
  for (const f of sens) byLabel.set(f.label, (byLabel.get(f.label) ?? 0) + 1);
  const crowd = probe.features(at[0], at[1], radiusM, new Set<string>(P.crowdKinds)).slice(0, P.listMax).map((f) => spotOf(at, f));
  return {
    perKm2,
    within500,
    rings: pin?.rings ?? [],
    ages: pin?.ages ?? null,
    bua,
    bld,
    huts,
    sensitive: {
      counts: [...byLabel.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n),
      nearest: sens.slice(0, P.listMax).map((f) => spotOf(at, f)),
    },
    crowd,
    sectors: pin?.sectors && pin.sectors.length === 8 ? pin.sectors : null,
    grid: pin?.grid ?? null,
    bands: pin?.bands ?? null,
  };
}

// ── 5 help ───────────────────────────────────────────────────────────────────────────────────────────────────────────

function readHelp(probe: PlProbe, R: Rules, ctx: PlContext): PlHelp {
  const HP = R.help;
  const at = ctx.at;
  const friends: PlSpot[] = [];
  for (const k of HP.kinds as string[]) {
    const f = nearestGrowing(probe, at, [5000, 15000, HP.radiusKm * 1000], new Set<string>([k]));
    if (f) friends.push(spotOf(at, f));
  }
  friends.sort((a, b) => a.distM - b.distM);
  const supply: PlSpot[] = [];
  for (const k of HP.supplyKinds as string[]) {
    const f = nearestGrowing(probe, at, [5000, 15000], new Set<string>([k]));
    if (f) supply.push(spotOf(at, f));
  }
  return { friends, supply, relay: null, radioShadow: false };
}

/** High ground within reach that sees the point (for a relay or rebroadcast), and whether the point sits in a hole. */
function readRelay(probe: PlProbe, R: Rules, ctx: PlContext): { relay: PlSpot | null; shadow: boolean } {
  const HP = R.help;
  const at = ctx.at;
  const me = probe.elev(at[0], at[1]);
  if (!Number.isFinite(me)) return { relay: null, shadow: false };
  const cands: Array<{ p: MercXY; e: number }> = [];
  let maxNear = me;
  for (let r = 250; r <= HP.relayKm * 1000 + 1e-6; r += 250) {
    for (let i = 0; i < 16; i++) {
      const p = plOffset(at, i * 22.5, r);
      const e = probe.elev(p[0], p[1]);
      if (!Number.isFinite(e)) continue;
      if (r <= 2000) maxNear = Math.max(maxNear, e);
      if (e > me + 10) cands.push({ p, e });
    }
  }
  cands.sort((a, b) => b.e - a.e);
  let relay: PlSpot | null = null;
  for (const c of cands.slice(0, 20)) {
    const s = probe.sight(c.p[0], c.p[1], 3, at[0], at[1], 2);
    if (s !== null && s >= 0.5) {
      relay = spotAt(at, c.p[0], c.p[1], 'relay', 'Relay / OP Gr', null, { why: `${Math.round(c.e - me)} m above you, line of sight to you` });
      break;
    }
  }
  const lf = probe.raster('landform', at[0], at[1]);
  const shadow = maxNear - me >= HP.valleyRiseM && (lf === 1 || lf === 2 || lf === 3);
  return { relay, shadow };
}

// ── 6 stop ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A distance in rule words (300 m, 1 km). */
const mWord = (m: number): string => (m >= 1000 ? `${+(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

function readStop(probe: PlProbe, R: Rules, ctx: PlContext, radiusM: number): PlStop {
  const S = R.stop;
  const at = ctx.at;
  const s = plScale(at[1]);
  // The grid spacing: the rule's 100 m, opened out when the bubble holds more sites than the cap, so the whole bubble is
  // read (a company's 2 km bubble at 100 m is ~1,250 sites; scanning row by row to the cap left its north half unread).
  const step = Math.max(S.gridM, Math.ceil((radiusM * Math.sqrt(Math.PI / Math.max(50, S.maxCandidates))) / 10) * 10);
  const monsoon = (R.danger.monsoonMonths as number[]).includes(ctx.month);
  const W = R.water;
  const waters = probe.features(at[0], at[1], radiusM + S.waterKm * 1000, new Set<string>([...W.perennial, ...W.powered, ...W.seasonal]));
  const villages = probe.features(at[0], at[1], radiusM + S.villageM, new Set<string>(R.people.buaKinds));
  const roadCls = new Set<number>(R.patrol.roadClasses);
  // The tests in the order they run; a site is ruled out by the first it fails.
  const tests: Array<{ key: string; label: string; out: number }> = [
    { key: 'nogo', label: 'NO-GO Gr', out: 0 },
    { key: 'road', label: 'on a Rd / Tr', out: 0 },
    { key: 'bua', label: 'in a BUA', out: 0 },
    { key: 'conceal', label: 'concealment below fair', out: 0 },
    { key: 'flood', label: 'flood Gr', out: 0 },
    { key: 'crest', label: 'on a crest', out: 0 },
    { key: 'nearBua', label: `BUA within ${mWord(S.villageM)}`, out: 0 },
    { key: 'nearRd', label: `Rd / Tr within ${mWord(S.roadM)}`, out: 0 },
    { key: 'ways', label: 'one way out', out: 0 },
    { key: 'water', label: `no water within ${S.waterKm} km`, out: 0 },
  ];
  const T = Object.fromEntries(tests.map((t, i) => [t.key, i])) as Record<string, number>;
  const cells: Array<[number, number, number]> = [];
  const passed: PlStopSite[] = [];
  let n = 0;
  const half = Math.floor(radiusM / step);
  for (let iy = -half; iy <= half && n < S.maxCandidates; iy++) {
    for (let ix = -half; ix <= half && n < S.maxCandidates; ix++) {
      const dx = ix * step, dy = iy * step;
      const p: MercXY = [at[0] + dx / s, at[1] + dy / s];
      if (plDist(at, p) > radiusM) continue;
      n++;
      const fail = (k: string): void => {
        tests[T[k]].out++;
        cells.push([dx, dy, T[k]]);
      };
      const c = probe.cls(p[0], p[1]);
      if (c === null || ctx.foot.nogo.has(c)) {
        fail('nogo');
        continue;
      }
      if (roadCls.has(c)) {
        fail('road');
        continue;
      }
      if (c === 3) {
        fail('bua');
        continue;
      }
      const cc = probe.raster('cc', p[0], p[1]);
      if (cc === null || cc >> 4 < S.minConcealment) {
        fail('conceal');
        continue;
      }
      const wet = probe.raster('wet', p[0], p[1]);
      if ((wet !== null && wet > 0 && (monsoon || wet >= 3)) || (monsoon && (c === 17 || c === 47))) {
        fail('flood');
        continue;
      }
      if (probe.raster('landform', p[0], p[1]) === 6) {
        fail('crest');
        continue;
      }
      let buaM = Infinity;
      for (const v of villages) buaM = Math.min(buaM, plDist(p, [v.x, v.y]));
      if (buaM < S.villageM) {
        fail('nearBua');
        continue;
      }
      if (probe.roads(p[0], p[1], S.roadM).length) {
        fail('nearRd');
        continue;
      }
      const waysDirs: boolean[] = [];
      for (let k = 0; k < 8; k++) {
        let ok = true;
        for (let r = 50; r <= 150; r += 50) {
          const q = plOffset(p, k * 45, r);
          const qc = probe.cls(q[0], q[1]);
          if (qc === null || ctx.foot.nogo.has(qc)) {
            ok = false;
            break;
          }
        }
        waysDirs.push(ok);
      }
      const ways = waysDirs.filter(Boolean).length;
      if (ways < S.waysOutMin) {
        fail('ways');
        continue;
      }
      let wd = Infinity;
      for (const w of waters) wd = Math.min(wd, plDist(p, [w.x, w.y]));
      if (wd > S.waterKm * 1000) {
        fail('water');
        continue;
      }
      cells.push([dx, dy, -1]);
      const score = (cc >> 4) * 20 + (cc & 15) * 10 + Math.min(ways, 4) * 5 - wd / 200 - plDist(at, p) / 200;
      const b = plBearing(at, p);
      passed.push({ x: p[0], y: p[1], distM: plDist(at, p), bearingDeg: b, dir: plCompass(b), score, conceal: cc >> 4, cover: cc & 15, ways, waysDirs, waterM: wd, buaM: Number.isFinite(buaM) ? buaM : null });
    }
  }
  passed.sort((a, b) => b.score - a.score);
  // The best sites, each at least 250 m from a better one (alternatives a commander can walk to, not the same field).
  const sites: PlStopSite[] = [];
  for (const q of passed) {
    if (sites.length >= 4) break;
    if (sites.every((o) => plDist([o.x, o.y], [q.x, q.y]) >= 250)) sites.push(q);
  }
  const best = sites[0] ?? null;
  const LV = ['no', 'poor', 'fair', 'good'];
  const bestWhy = best
    ? [
        `${LV[best.conceal]} concealment, ${LV[best.cover]} cover`,
        `${best.ways} ways out on foot`,
        `water ${Math.round(best.waterM)} m`,
        `no BUA within ${S.villageM} m, no Rd / Tr within ${S.roadM} m`,
      ]
    : [];
  const harbour = best ? spotAt(at, best.x, best.y, 'harbour', 'Patrol base / harbour', null, { score: best.score, why: bestWhy.join('; ') }) : null;

  // OP: the highest ground in reach with the widest view.
  const tops: Array<{ p: MercXY; e: number }> = [];
  const opR = Math.min(S.opRadiusM, radiusM);
  for (let iy = -opR; iy <= opR; iy += 100) {
    for (let ix = -opR; ix <= opR; ix += 100) {
      if (Math.hypot(ix, iy) > opR) continue;
      const p: MercXY = [at[0] + ix / s, at[1] + iy / s];
      const e = probe.elev(p[0], p[1]);
      if (Number.isFinite(e)) tops.push({ p, e });
    }
  }
  tops.sort((a, b) => b.e - a.e);
  // Only ground that stands `opRiseM` above the bubble's mean height: on flat ground an "OP" sees no further than the
  // men round it, so none is proposed (a tower or a roof is the answer there, and the card says so).
  let mean = 0;
  for (const t of tops) mean += t.e;
  mean = tops.length ? mean / tops.length : 0;
  const picks: Array<{ p: MercXY; e: number }> = [];
  for (const t of tops) {
    if (picks.length >= S.opCandidates || t.e - mean < (S.opRiseM ?? 5)) break;
    const c = probe.cls(t.p[0], t.p[1]);
    if (c === null || ctx.foot.nogo.has(c)) continue;
    if (picks.every((q) => plDist(q.p, t.p) >= 200)) picks.push(t);
  }
  let op: PlSpot | null = null;
  let opScore = -Infinity;
  let opView: number[] | null = null;
  let opRiseM: number | null = null;
  for (const t of picks) {
    let seen = 0, all = 0;
    const view: number[] = [];
    for (let i = 0; i < 24; i++) {
      let ds = 0, da = 0;
      for (let r = 100; r <= 1000; r += 150) {
        const q = plOffset(t.p, i * 15, r);
        const v = probe.sight(t.p[0], t.p[1], 1.6, q[0], q[1], R.bubble.manM);
        if (v === null) continue;
        da++;
        if (v >= R.bubble.seenP) ds++;
      }
      all += da;
      seen += ds;
      view.push(da ? ds / da : 0);
    }
    const pctSeen = all ? Math.round((100 * seen) / all) : 0;
    const score = pctSeen + 0.5 * (t.e - mean);
    if (score > opScore) {
      opScore = score;
      const up = Math.round(t.e - mean);
      opView = view;
      opRiseM = up;
      op = spotAt(at, t.p[0], t.p[1], 'op', 'OP site', null, { why: `sees about ${pctSeen}% of the ground within 1 km${up > 0 ? `, ${up} m above the Gr round it` : ''}`, score: pctSeen });
    }
  }
  return {
    harbour,
    harbourWhy: best
      ? [...bestWhy, 'not overlooked: check on the ground']
      : [
          'No site in the bubble meets every test: widen the search or relax a test on the ground',
          `Ruled out most by: ${[...tests].filter((t) => t.out > 0).sort((a, b) => b.out - a.out).slice(0, 3).map((t) => `${t.label} (${Math.round((100 * t.out) / Math.max(1, n))}%)`).join(', ') || 'no data'}`,
        ],
    op,
    opWhy: op ? op.why ?? '' : `No Gr ${S.opRiseM ?? 5} m above the rest within ${Math.round(opR)} m: an OP here needs a tower, a roof or a tree`,
    tests,
    checked: n,
    passed: passed.length,
    grid: { stepM: step, cells },
    sites,
    opView,
    // With no OP: how far the highest ground stands above the rest (short of the rise an OP needs).
    opRiseM: op ? opRiseM : tops.length ? Math.round(tops[0].e - mean) : null,
    rules: { villageM: S.villageM, roadM: S.roadM, waterKm: S.waterKm, opRiseM: S.opRiseM ?? 5 },
  };
}

// ── checks and gaps ──────────────────────────────────────────────────────────────────────────────────────────────────

function checksFor(r: PlReading): string[] {
  const out: string[] = [];
  if (r.here.water.nearest || r.here.water.perennial) out.push('Water as recorded on the 1:50k map: check it is there, flowing and fit to drink');
  if (r.here.water.brackish) out.push('Brackish water is noted nearby: test before drinking');
  if (r.here.hls.ground) out.push('Landing site: walk it for slope, loose debris, wires and approach paths');
  if (r.here.medical.hospital) out.push('Hospital as recorded: confirm it is open and what it can treat; drive time is an estimate');
  if (r.see) out.push('Dead and screened ground come from 30 m elevation, the month\'s crops and building density: walk the ground in front');
  if (r.danger?.spots.length) out.push('Likely mine / IED and ambush sites: search them before you pass; the list is ground pattern only');
  if (r.stop?.harbour) out.push('Patrol base: confirm it is not overlooked and has no tracks through it');
  if (r.here.going.afterRain) out.push('Going after rain: test the ground before vehicles leave the road');
  return out;
}

function gapsFor(r: PlReading): string[] {
  const out: string[] = [];
  if (r.danger) out.push('No incident history in the data: mine / IED and ambush sites are where the ground suits them, not intelligence');
  out.push('Schools, markets and bus stands are thinly recorded: "none recorded" is not "none"');
  if (r.see) out.push('A wall, a bund under 30 m wide or a single building may not show in the 30 m elevation');
  return out;
}

// ── 7 patrol route card ──────────────────────────────────────────────────────────────────────────────────────────────

export interface PlFootSpeeds {
  /** Ground key -> [day, night] km/h (MovementSpeeds.json movers.foot.ground). */
  ground: Record<string, [number, number]>;
  /** On a road or track, [day, night] km/h. */
  road: [number, number];
  /** Tobler steepness (MovementSpeeds.json movers.foot.slope); 0 = slope ignored. */
  toblerA: number;
  toblerB: number;
}

export interface PlLeg {
  i: number;
  from: MercXY;
  to: MercXY;
  bearingDeg: number;
  distM: number;
  paces: number;
  minDay: number;
  minNight: number;
  climbM: number;
  endFeature: PlSpot | null;
}

export interface PlStretch {
  fromM: number;
  toM: number;
  why: string;
  x: number;
  y: number;
}

export interface PatrolCard {
  lengthM: number;
  legs: PlLeg[];
  minDay: number;
  minNight: number;
  bounds: Array<{ x: number; y: number; chainM: number }>;
  fmp: { x: number; y: number; chainM: number } | null;
  /** Hidden from the threat (needs a threat place). */
  dead: PlStretch[];
  exposed: PlStretch[];
  skyline: PlStretch[];
  obstacles: Array<{ chainM: number; label: string; x: number; y: number }>;
  villages: Array<{ name: string | null; chainM: number }>;
  dangers: Stretch[];
  /** The route back runs along the route out. */
  sameWayBack: boolean;
  threatKnown: boolean;
  checks: string[];
  pending: boolean;
}

function mergeRuns(flags: boolean[], chain: number[], pts: MercXY[], why: string, minM: number): PlStretch[] {
  const out: PlStretch[] = [];
  let i = 0;
  while (i < flags.length) {
    if (!flags[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < flags.length && flags[j + 1]) j++;
    const fromM = chain[i], toM = chain[j];
    if (toM - fromM >= minM || i === j) {
      const mid = Math.floor((i + j) / 2);
      out.push({ fromM, toM, why, x: pts[mid][0], y: pts[mid][1] });
    }
    i = j + 1;
  }
  return out;
}

/**
 * The patrol route card for a line (a patrol route drawn or selected): legs with bearing, distance, paces and time by
 * day and night, the feature each leg ends on, bounds and the final meeting point, stretches hidden from the threat,
 * exposed stretches and skylines, obstacles crossed and villages passed, and the Movement Guide's dangers on foot.
 */
export function patrolCard(probe: PlProbe, R: Rules, path: MercXY[], ctx: { foot: GoingSets; speeds: PlFootSpeeds; threat?: MercXY | null; classLabel: (c: number) => string; scanRoad?: ScanFn }): PatrolCard {
  probe.takePending?.();
  const P = R.patrol;
  const roadCls = new Set<number>(P.roadClasses);
  const legs: PlLeg[] = [];
  let chain = 0;
  let minDay = 0, minNight = 0;
  const featKinds = new Set<string>(P.legFeatureKinds);
  const pts: MercXY[] = [];
  const chainAt: number[] = [];
  const obstacles: PatrolCard['obstacles'] = [];
  let lastObs = -Infinity;
  for (let s = 0; s + 1 < path.length; s++) {
    const a = path[s], b = path[s + 1];
    const L = plDist(a, b);
    if (!(L > 0.5)) continue;
    const brg = plBearing(a, b);
    const n = Math.max(1, Math.ceil(L / P.stationM));
    let tDay = 0, tNight = 0, climb = 0;
    let prevE = probe.elev(a[0], a[1]);
    for (let k = 1; k <= n; k++) {
      const t0 = (k - 1) / n, t1 = k / n;
      const p: MercXY = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
      const mid: MercXY = [a[0] + (b[0] - a[0]) * ((t0 + t1) / 2), a[1] + (b[1] - a[1]) * ((t0 + t1) / 2)];
      const segM = L / n;
      const c = probe.cls(mid[0], mid[1]);
      let sp: [number, number];
      if (c !== null && roadCls.has(c)) sp = ctx.speeds.road;
      else {
        const g = c === null ? 'open' : P.classGround[String(c)] ?? 'open';
        sp = ctx.speeds.ground[g] ?? ctx.speeds.ground.open ?? [4, 3];
      }
      // Obstacles: look every 10 m, so a canal or drain narrower than a station is not stepped over.
      const sub = Math.max(1, Math.ceil(segM / 10));
      for (let q = 0; q <= sub; q++) {
        const tq = t0 + ((t1 - t0) * q) / sub;
        const pq: MercXY = [a[0] + (b[0] - a[0]) * tq, a[1] + (b[1] - a[1]) * tq];
        const cq = probe.cls(pq[0], pq[1]);
        if (cq === null || !ctx.foot.nogo.has(cq)) continue;
        sp = ctx.speeds.ground.crossing ?? [1, 0.5];
        const cm = chain + L * tq;
        if (cm - lastObs > 150) {
          obstacles.push({ chainM: cm, label: ctx.classLabel(cq), x: pq[0], y: pq[1] });
          lastObs = cm;
        }
        break;
      }
      const e = probe.elev(p[0], p[1]);
      let f = 1;
      if (Number.isFinite(e) && Number.isFinite(prevE) && ctx.speeds.toblerA > 0) {
        const slope = (e - prevE) / segM;
        f = Math.exp(-ctx.speeds.toblerA * Math.abs(slope + ctx.speeds.toblerB)) / Math.exp(-ctx.speeds.toblerA * ctx.speeds.toblerB);
        if (e > prevE) climb += e - prevE;
      }
      if (Number.isFinite(e)) prevE = e;
      const kmh = (x: number) => Math.max(0.3, x * f);
      tDay += (segM / 1000 / kmh(sp[0])) * 60;
      tNight += (segM / 1000 / kmh(sp[1])) * 60;
      pts.push(p);
      chainAt.push(chain + L * t1);
    }
    const ends = probe.features(b[0], b[1], P.legFeatureM, featKinds);
    const end = ends.find((f) => f.name) ?? ends[0] ?? null;
    legs.push({
      i: legs.length + 1,
      from: a,
      to: b,
      bearingDeg: brg,
      distM: L,
      paces: Math.round((L / 100) * P.pacesPer100m),
      minDay: Math.round(tDay),
      minNight: Math.round(tNight),
      climbM: Math.round(climb),
      endFeature: end ? spotOf(b, end) : null,
    });
    chain += L;
    minDay += tDay;
    minNight += tNight;
  }
  const bounds: PatrolCard['bounds'] = [];
  for (let c = P.boundM; c < chain - 100; c += P.boundM) {
    const i = chainAt.findIndex((v) => v >= c);
    if (i >= 0) bounds.push({ x: pts[i][0], y: pts[i][1], chainM: c });
  }
  let fmp: PatrolCard['fmp'] = null;
  if (chain > P.fmpM + 100) {
    const want = chain - P.fmpM;
    const i = chainAt.findIndex((v) => v >= want);
    if (i >= 0) fmp = { x: pts[i][0], y: pts[i][1], chainM: want };
  }

  // Sight: hidden from the threat, overlooked, skylines; then the Movement Guide's dangers on foot.
  let dead: PlStretch[] = [];
  let exposed: PlStretch[] = [];
  let skyline: PlStretch[] = [];
  let dangers: Stretch[] = [];
  let villages: PatrolCard['villages'] = [];
  let pending = probe.takePending?.() ?? false;
  if (ctx.scanRoad && path.length >= 2) {
    const r = ctx.scanRoad(path, true, ctx.threat ?? null);
    if (r.pending) pending = true;
    const st = r.stations;
    const ch = st.map((s) => s.chainM);
    const xy = st.map((s) => [s.x, s.y] as MercXY);
    if (ctx.threat) {
      dead = mergeRuns(st.map((s) => s.exposedP !== null && s.exposedP < 0.3), ch, xy, 'hidden from the threat', 100);
      exposed = mergeRuns(st.map((s) => (s.exposedP !== null && s.exposedP >= 0.5) || !!s.overlook), ch, xy, 'the threat or high Gr may see you', 50);
    } else exposed = mergeRuns(st.map((s) => !!s.overlook), ch, xy, 'high Gr may see you', 50);
    skyline = mergeRuns(st.map((s) => s.crest), ch, xy, 'on a crest: you show on the skyline', 0);
    dangers = r.stretches.filter((s) => s.score >= 40 && ['vp', 'ambush', 'mine', 'overlooked', 'rooftops', 'bua', 'sensitive', 'natural', 'border'].includes(s.kind));
    villages = r.placesPassed.map((p) => ({ name: p.name, chainM: p.chainM }));
  } else {
    // Without the scan: skylines from the landform layer only.
    skyline = mergeRuns(pts.map((p) => probe.raster('landform', p[0], p[1]) === 6), chainAt, pts, 'on a crest: you show on the skyline', 0);
  }

  // Same way back: the second half runs within 100 m of the first.
  let sameWayBack = false;
  if (pts.length >= 8) {
    const half = Math.floor(pts.length / 2);
    let close = 0;
    for (let i = half; i < pts.length; i++) {
      let near = false;
      for (let j = 0; j < half && !near; j++) if (plDist(pts[i], pts[j]) < 100) near = true;
      if (near) close++;
    }
    sameWayBack = close / (pts.length - half) >= 0.6;
  }
  const checks = [
    'Check each leg\'s end feature can be recognised at night',
    'Bearings are grid: apply the magnetic variation for the compass',
    'Times are from the infantry marching table and the slope: adjust for load and the men',
  ];
  if (sameWayBack) checks.unshift('The route back runs along the route out: choose another way back');
  if (!ctx.threat) checks.push('No threat place set: dead and exposed stretches toward the enemy are not worked out');
  return {
    lengthM: chain,
    legs,
    minDay: Math.round(minDay),
    minNight: Math.round(minNight),
    bounds,
    fmp,
    dead,
    exposed,
    skyline,
    obstacles,
    villages,
    dangers,
    sameWayBack,
    threatKnown: !!ctx.threat,
    checks,
    pending: (probe.takePending?.() ?? false) || pending,
  };
}
