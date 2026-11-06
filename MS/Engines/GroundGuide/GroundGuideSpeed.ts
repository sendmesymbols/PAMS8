/**
 * GroundGuideSpeed.ts
 *
 * T in GROTBC, Speed: how fast the symbol's unit or vehicle moves here, cross-country and on the nearest road it can
 * use, by day and by night, dry and after rain. Pure logic: no DOM, no ArcGIS. The card draws it with
 * GroundGuideSpeedView; the tables are MS/Data/MovementSpeeds.json (a STARTING PROPOSAL for the rule owner to
 * correct), which a bundle's rules.json `grotbc.speed` or a host's `setSpeedTables()` may override key by key.
 *
 * Who moves ("mover", a key of the tables):
 *   1. a hand-picked mover (`groundGuide.speed.mover`), else the unit type picked with P for this draw;
 *   2. the SIDC's mobility amplifier (positions 9-10 of a land equipment SIDC: 31 wheeled limited cross-country,
 *      32 wheeled cross-country, 33 tracked, 34 wheeled and tracked (as wheeled), 35 towed, 37 pack animals,
 *      41 over snow, 52 amphibious);
 *   3. the catalogue's `Mover` (MS/Data/Symbols.json, beside `VehCat` A / B / C on vehicle symbols);
 *   4. the Ground Guide profile (dismounted -> foot, tracked -> A tracked, wheeled -> B truck, ...).
 *
 * Speed at a point = the mover's table speed on that kind of ground (day or night) x the going there for the season
 * (GO 1, SLOW-GO `slowGo`, NO-GO 0) x after rain `afterRain` x the slope (Tobler's walking formula for foot and pack
 * animals, a factor per slope band for vehicles) x the height above sea level (foot, pack). Never faster than the
 * table: Tobler's speed-up on a gentle descent is not used.
 */

import DEFAULT_TABLES from '../../Data/MovementSpeeds.json';
import type { FeatureRoadHit } from './GroundGuideFeatures';
import type { GoingSeason, GoingStep, GroundGuideProfile, MercXY } from './GroundGuideTypes';

export type SpeedLight = 'day' | 'night';
export type SpeedRoadMode = 'convoy' | 'single';
export type SpeedLoad = 'combat' | 'none';
/**
 * How the card shows speed: `off`; `line` (S1) the speed now in large type, up / down a slope, the road and the time
 * to reach it; `grid` (S2) day / night x dry / after rain; `rose` (S3) minutes to cover the range in eight directions;
 * `modes` (S4) foot / B / A side by side; `road` (S5) a strip from here to the road, cross-country then on the road.
 */
export type SpeedCardStyle = 'off' | 'line' | 'grid' | 'rose' | 'modes' | 'road';
export const SPEED_CARD_STYLES: readonly SpeedCardStyle[] = ['off', 'line', 'grid', 'rose', 'modes', 'road'];

export interface GroundGuideSpeedOptions {
  /** Work out speed at all (card, Brief, `speedAround`). */
  enabled: boolean;
  card: SpeedCardStyle;
  /** Day, or night (blackout / night vision): the tables hold both. */
  light: SpeedLight;
  /** Road speed as a column on the move (convoy march rates) or as one vehicle alone. */
  road: SpeedRoadMode;
  /** Foot: the day's march with or without combat load (the speed itself is the table's). */
  load: SpeedLoad;
  /** `auto` (from the symbol) or a mover key of the tables. */
  mover: string;
  /** A Day / Night switch on the Legend. */
  legend: boolean;
}


// ── tables ────────────────────────────────────────────────────────────────

/** [day, night] km/h. */
export type DayNight = [number, number];

export interface SpeedSlopeRule {
  /** `tobler`: exp(-a |grade + b|) over flat ground's, capped at 1; `a` may be [day, night]. `bands`: one factor per band. */
  model: 'tobler' | 'bands';
  a?: number | [number, number];
  b?: number;
  /** `bands`: factors for the bands the tables' `slopeBandsDeg` split (Level, Gentle, Sloping, Moderate, Steep). */
  factors?: number[];
}

export interface SpeedMover {
  label: string;
  short: string;
  /** Vehicle category: A combat vehicle, B general purpose, C engineer plant (null for foot and animals). */
  cat: 'A' | 'B' | 'C' | null;
  /** Whose going (GO / SLOW-GO / NO-GO) applies: a Ground Guide profile. */
  profile: string;
  /** km/h [day, night] on GO ground, dry, level, by ground key (`open` is the fallback). */
  ground: Record<string, DayNight>;
  /** x on SLOW-GO ground. */
  slowGo: number;
  /** x after rain, on top of what rain does to the going. */
  afterRain: number;
  slope: SpeedSlopeRule;
  /** Height above sea level (foot, pack): x `factor` from `fromM` up, steps in order. */
  altitude?: Array<{ fromM: number; factor: number }>;
  /** One vehicle alone on a road: km/h [day, night] by road key. */
  road: Record<string, DayNight>;
  /** Which column (convoy) rule its road march follows. */
  column: string;
  /** x on a fair-weather road after rain. */
  fairAfterRain: number;
  /** A day's march (foot, pack): km in 24 h [low, high] by ground for the day (plain / desert / mountain). */
  dayKm?: Record<string, { combat: [number, number]; none?: [number, number] }>;
  note?: string;
}

export interface SpeedColumn {
  label: string;
  /** Column speed, km/h [day, night]: never faster than the road allows one vehicle. */
  speed: DayNight;
  /** Halts: `forMin` every `everyMin` of driving (for the rate in km in the hour). */
  halt: { everyMin: number; forMin: number };
  note?: string;
}

export interface SpeedTables {
  version: number;
  status: string;
  updated: string;
  /** Ground keys: label and the bundle classes (class layer codes) they cover. */
  grounds: Record<string, { label: string; classes: number[] }>;
  /**
   * Road keys: label and the road types (network / NCGDB `t`) they cover, by regular expression; `ref` matches the
   * road number first (N-5 is a highway wherever OSM classes a stretch of it lower). A mover with no speed for a
   * ground key (`hill`, `road`) goes at its `open` speed: the slope and the going still apply.
   */
  roads: Record<string, { label: string; match: string; ref?: string }>;
  /** Upper ends of the slope bands, degrees: [3, 7, 15, 30] -> Level < 3, Gentle < 7, Sloping < 15, Moderate < 30, Steep. */
  slopeBandsDeg: number[];
  slopeBandLabels: string[];
  movers: Record<string, SpeedMover>;
  columns: Record<string, SpeedColumn>;
  /** Mover for a Ground Guide profile, when neither the SIDC nor the catalogue names one. */
  byProfile: Record<string, string>;
  /** Mover for a SIDC mobility amplifier (positions 9-10 of a land equipment SIDC). */
  byMobility: Record<string, string>;
  sources: Array<{ name: string; released?: string; dataDate?: string; url?: string; used: string }>;
  /** What is still missing from the tables, in words. */
  gaps?: string;
}

export const BUILTIN_SPEED_TABLES = DEFAULT_TABLES as unknown as SpeedTables;

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Deep merge of plain objects (arrays and values replace). Used for the bundle's and the host's overrides. */
export function mergeTables<T>(base: T, patch: unknown): T {
  if (!isObj(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isObj(v) && isObj(out[k]) ? mergeTables(out[k], v) : v;
  }
  return out as T;
}

// ── who moves ─────────────────────────────────────────────────────────────

export type MoverSource = 'setting' | 'hand' | 'sidc' | 'catalog' | 'profile';

/** The mobility amplifier of a land equipment SIDC (positions 9-10), or null. */
export function mobilityOf(sidc: string | null | undefined): string | null {
  const s = sidc ? String(sidc).replace(/\s+/g, '') : '';
  if (s.length < 16 || !/^\d+$/.test(s)) return null;
  const amp = s.substring(8, 10);
  return s.substring(4, 6) === '15' && /^(3[1-7]|4[12]|5[12])$/.test(amp) ? amp : null;
}

/** Catalogue key of a SIDC (symbol set + entity, as Symbols.json is keyed). */
export function catalogKey(sidc: string | null | undefined): string | null {
  const s = sidc ? String(sidc).replace(/\s+/g, '') : '';
  return s.length >= 16 && /^\d+$/.test(s) ? s.substring(4, 6) + s.substring(10, 16) : null;
}

/**
 * Resolve the mover. `catalog` looks a catalogue key up (Symbols.json `Mover`); `hand` is a unit type chosen with
 * P for this draw. Null when the profile does not move on the ground (air, sea, rail, exempt).
 */
export function resolveMover(
  t: SpeedTables,
  sidc: string | null | undefined,
  profile: GroundGuideProfile,
  opts: { setting?: string; hand?: boolean; catalog?: (key: string) => string | null | undefined },
): { key: string; from: MoverSource } | null {
  const ok = (k: string | null | undefined): k is string => !!k && !!t.movers[k];
  if (opts.setting && opts.setting !== 'auto' && ok(opts.setting)) return { key: opts.setting, from: 'setting' };
  const fromProfile = t.byProfile[profile];
  if (opts.hand) return ok(fromProfile) ? { key: fromProfile, from: 'hand' } : null;
  const mob = mobilityOf(sidc);
  if (mob && ok(t.byMobility[mob])) return { key: t.byMobility[mob], from: 'sidc' };
  const key = catalogKey(sidc);
  const cat = key && opts.catalog ? opts.catalog(key) : null;
  if (ok(cat)) return { key: cat, from: 'catalog' };
  return ok(fromProfile) ? { key: fromProfile, from: 'profile' } : null;
}

// ── the arithmetic ────────────────────────────────────────────────────────

const LIGHT_I: Record<SpeedLight, 0 | 1> = { day: 0, night: 1 };

/** Ground key of a class code (`open` when the tables do not list it), and null for water the mover cannot be on. */
export function groundOf(t: SpeedTables, cls: number | null | undefined): string | null {
  if (cls === null || cls === undefined || cls === 255) return null;
  for (const [k, g] of Object.entries(t.grounds)) if (g.classes.includes(cls)) return k;
  return 'open';
}

export function slopeBand(t: SpeedTables, deg: number): number {
  const b = t.slopeBandsDeg;
  let i = 0;
  while (i < b.length && Math.abs(deg) >= b[i]) i++;
  return i;
}

/**
 * Slope factor for a mover. `grade` is rise over run along the way (uphill positive); with no direction, pass the
 * steepest grade and the caller asks for both signs. Never above 1.
 */
export function slopeFactor(t: SpeedTables, m: SpeedMover, grade: number, light: SpeedLight): number {
  const r = m.slope;
  if (r.model === 'tobler') {
    const a = Array.isArray(r.a) ? r.a[LIGHT_I[light]] : r.a ?? 3.5;
    const b = r.b ?? 0.05;
    return Math.min(1, Math.exp(-a * Math.abs(grade + b)) / Math.exp(-a * b));
  }
  const f = r.factors ?? [];
  const deg = (Math.atan(Math.abs(grade)) * 180) / Math.PI;
  const v = f[slopeBand(t, deg)];
  return typeof v === 'number' ? v : 1;
}

export function altitudeFactor(m: SpeedMover, elevM: number | null): number {
  if (!m.altitude || elevM === null) return 1;
  let f = 1;
  for (const s of m.altitude) if (elevM >= s.fromM) f = s.factor;
  return f;
}

/** Cross-country km/h on one spot: ground, going, season, light, slope (`grade`), height. 0 on NO-GO. */
export function spotKmh(
  t: SpeedTables,
  m: SpeedMover,
  p: { ground: string | null; step: GoingStep | null; season: GoingSeason; light: SpeedLight; grade: number; elevM: number | null },
): number | null {
  if (p.ground === null || p.step === null) return null;
  if (p.step === 'nogo') return 0;
  const g = m.ground[p.ground] ?? m.ground.open;
  if (!g) return null;
  let v = g[LIGHT_I[p.light]];
  if (p.step === 'slow') v *= m.slowGo;
  if (p.season === 'wet') v *= m.afterRain;
  v *= slopeFactor(t, m, p.grade, p.light);
  v *= altitudeFactor(m, p.elevM);
  return Math.max(0, v);
}

/** Road key of a road hit (network `t` = OSM class, NCGDB `t` = its road type). */
export function roadOf(t: SpeedTables, attrs: Record<string, unknown>): string {
  const type = String(attrs.t ?? '').toLowerCase();
  const ref = typeof attrs.r === 'string' ? attrs.r.trim() : '';
  if (ref) {
    for (const [k, r] of Object.entries(t.roads)) {
      try {
        if (r.ref && new RegExp(r.ref, 'i').test(ref)) return k;
      } catch {
        /* a bad pattern in an override: skip it */
      }
    }
  }
  for (const [k, r] of Object.entries(t.roads)) {
    try {
      if (new RegExp(r.match, 'i').test(type)) return k;
    } catch {
      /* a bad pattern in an override: skip it */
    }
  }
  return 'minor';
}

function allWeather(a: Record<string, unknown>): boolean {
  if (typeof a.aw === 'boolean') return a.aw;
  const c = typeof a.c === 'string' ? a.c : '';
  if (/^\d+F/i.test(c)) return false;
  if (/^\d+A/i.test(c)) return true;
  return !/unmetal|shingl|track|cart|path|earth/.test(String(a.t ?? '').toLowerCase());
}

/** The road the mover would use, nearest first: tankable for tracks (A / C tracked), all-weather first after rain. */
export function pickSpeedRoad(m: SpeedMover, list: FeatureRoadHit[], wet: boolean): FeatureRoadHit | null {
  if (!list.length) return null;
  const msrFirst = (l: FeatureRoadHit[]) => {
    const first = l[0];
    const msr = l.find((h) => h.attrs.m);
    return msr && first && msr.distanceM <= first.distanceM * 1.5 ? msr : first ?? null;
  };
  if (m.profile === 'tracked' || m.profile === 'amphibious') {
    const tank = list.filter((h) => h.attrs.k === 3);
    return msrFirst(tank) ?? msrFirst(list);
  }
  if (m.profile === 'dismounted' || m.profile === 'pack') return list[0];
  if (wet) {
    const aw = list.filter((h) => allWeather(h.attrs));
    if (aw.length && aw[0].distanceM <= list[0].distanceM * 2) return msrFirst(aw);
  }
  return msrFirst(list);
}

/** km/h on a road: one vehicle alone, or the column's (never above the one vehicle's), and the rate in km in the hour. */
export function roadKmh(
  t: SpeedTables,
  m: SpeedMover,
  roadKey: string,
  p: { light: SpeedLight; season: GoingSeason; allWeather: boolean; mode: SpeedRoadMode },
): { kmh: number; rateKmih: number | null; column: string | null } | null {
  const single = m.road[roadKey] ?? m.road.minor;
  if (!single) return null;
  let v = single[LIGHT_I[p.light]];
  if (!v) return { kmh: 0, rateKmih: null, column: null };
  if (p.season === 'wet' && !p.allWeather) v *= m.fairAfterRain;
  if (p.mode === 'single') return { kmh: v, rateKmih: null, column: null };
  const col = t.columns[m.column];
  if (!col) return { kmh: v, rateKmih: null, column: null };
  const kmh = Math.min(v, col.speed[LIGHT_I[p.light]]);
  const share = col.halt.everyMin > 0 ? col.halt.everyMin / (col.halt.everyMin + col.halt.forMin) : 1;
  return { kmh, rateKmih: kmh * share, column: col.label };
}

/** Ground for the day's march: plain, desert or mountain (bundle terrain type, else the ground and the slope). */
export function dayGround(terrainCode: number | null, ground: string | null, slopeDeg: number | null): 'plain' | 'desert' | 'mountain' {
  if (terrainCode === 7 || terrainCode === 2) return 'mountain';
  if (terrainCode === 6) return 'desert';
  if (terrainCode === null || terrainCode === undefined) {
    if (slopeDeg !== null && slopeDeg >= 15) return 'mountain';
    if (ground === 'sand' || ground === 'dunes' || ground === 'desert') return 'desert';
  }
  return 'plain';
}

// ── a reading at a point ──────────────────────────────────────────────────

export interface SpeedDirection {
  bearingDeg: number;
  compass: string;
  /** Minutes to cover the range this way; null when the way is blocked first. */
  minutes: number | null;
  /** Ground distance covered before the first NO-GO (the range when open). */
  reachM: number;
  /** Average km/h over the distance covered (0 when blocked at once). */
  kmh: number;
  blockedBy: string | null;
}

export interface GroundGuideSpeed {
  mover: string;
  label: string;
  short: string;
  cat: 'A' | 'B' | 'C' | null;
  from: MoverSource;
  profile: string;
  light: SpeedLight;
  season: GoingSeason;
  roadMode: SpeedRoadMode;
  load: SpeedLoad;
  card: SpeedCardStyle;
  ground: { key: string; label: string } | null;
  /** Slope at the point (degrees) and its band. */
  slopeDeg: number | null;
  slopeBand: string | null;
  elevM: number | null;
  /** The going for the mover at the point. */
  going: { dry: GoingStep; wet: GoingStep } | null;
  /** km/h cross-country now (light and season as set); up and down the slope for foot and pack on 3 deg or more. */
  kmh: number | null;
  up: number | null;
  down: number | null;
  /** Day / night x dry / after rain at the point (level, or uphill on a slope for foot and pack). */
  grid: { dryDay: number | null; dryNight: number | null; wetDay: number | null; wetNight: number | null };
  /** Foot / B / A (and the mover, when it is another), km/h now. */
  modes: Array<{ mover: string; short: string; cat: 'A' | 'B' | 'C' | null; kmh: number | null; active: boolean }>;
  road: {
    shield: string;
    name: string | null;
    key: string;
    label: string;
    msr: boolean;
    allWeather: boolean;
    distanceM: number;
    compass: string;
    bearingDeg: number;
    kmh: number;
    rateKmih: number | null;
    column: string | null;
    /** Minutes to reach it cross-country in a straight line at the speed here; null when the ground here is NO-GO. */
    reachMin: number | null;
  } | null;
  /** Searched this far for a road, m (for "none within"). */
  roadRadiusM: number;
  rays: SpeedDirection[] | null;
  rangeM: number;
  /** A day's march (foot, pack), km. */
  dayKm: { ground: 'plain' | 'desert' | 'mountain'; lo: number; hi: number; load: SpeedLoad } | null;
  /** STARTING PROPOSAL note and the table date. */
  basis: string;
  pending: boolean;
}

export const COMPASS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

type Read = (layer: string, mx: number, my: number) => number | null | undefined;

export interface SpeedArgs {
  tables: SpeedTables;
  mover: { key: string; from: MoverSource };
  opts: GroundGuideSpeedOptions;
  season: GoingSeason;
  at: MercXY;
  cosLat: number;
  /** Ground metres per pixel at the read zoom. */
  pxM: number;
  read: Read;
  layers: { cls: string; elevHi: string | null; elevLo: string | null; terrain: string | null };
  /** The going for a profile at a spot and season (pixelGoing with the guide's rain rule); null without data. */
  goingAt: (profile: string, x: number, y: number, season: GoingSeason) => { step: GoingStep; why: string | null } | null;
  roads: { list: FeatureRoadHit[]; pending: boolean } | null;
  roadRadiusM: number;
  /** Look round the point in eight directions (the rose, the Brief). */
  rays: boolean;
  rangeM: number;
  pending: () => boolean;
}

function elevAt(read: Read, L: SpeedArgs['layers'], x: number, y: number): number | null | undefined {
  if (!L.elevHi || !L.elevLo) return null;
  const hi = read(L.elevHi, x, y);
  const lo = read(L.elevLo, x, y);
  if (hi === undefined || lo === undefined) return undefined;
  if (hi === null || lo === null || hi === 255) return null;
  return hi * 256 + lo - 500;
}

/** Steepest grade at a point from a 3 x 3 gradient `d` ground metres apart. */
function gradeAt(read: Read, L: SpeedArgs['layers'], at: MercXY, dM: number, cosLat: number): number | null {
  const d = dM / cosLat;
  const e = [elevAt(read, L, at[0] + d, at[1]), elevAt(read, L, at[0] - d, at[1]), elevAt(read, L, at[0], at[1] + d), elevAt(read, L, at[0], at[1] - d)];
  if (!e.every((v) => typeof v === 'number')) return null;
  const [ee, w, n, s] = e as number[];
  return Math.hypot((ee - w) / (2 * dM), (n - s) / (2 * dM));
}

function round1(v: number | null): number | null {
  return v === null ? null : v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
}

export function readSpeed(a: SpeedArgs): GroundGuideSpeed | null {
  const t = a.tables;
  const m = t.movers[a.mover.key];
  if (!m) return null;
  const { read, at, layers: L } = a;
  const o = a.opts;
  const cls = read(L.cls, at[0], at[1]);
  const ground = groundOf(t, cls);
  const e0 = elevAt(read, L, at[0], at[1]);
  const elevM = typeof e0 === 'number' ? e0 : null;
  // Slope over two pixels each way: one pixel apart reads the DEM's noise as slope.
  const grade = gradeAt(read, L, at, Math.max(30, 2 * a.pxM), a.cosLat);
  const slopeDeg = grade === null ? null : (Math.atan(grade) * 180) / Math.PI;
  const tobler = m.slope.model === 'tobler';
  const gDry = a.goingAt(m.profile, at[0], at[1], 'dry');
  const gWet = a.goingAt(m.profile, at[0], at[1], 'wet');
  const step = (s: GoingSeason) => (s === 'wet' ? gWet : gDry)?.step ?? null;
  const steep = slopeDeg !== null && slopeDeg >= 3;
  // Vehicles: the band of the steepest slope (bands take the steepness, not the direction). Foot and pack: uphill,
  // the slower way, from 3 deg (below that the DEM's noise would only shave a tenth off the table).
  const gradeFor = (mm: SpeedMover) => (mm.slope.model === 'tobler' ? (steep ? grade ?? 0 : 0) : grade ?? 0);
  const g0 = gradeFor(m);
  const spot = (season: GoingSeason, light: SpeedLight, gr: number) => spotKmh(t, m, { ground, step: step(season), season, light, grade: gr, elevM });

  const kmhNow = round1(spot(a.season, o.light, g0));
  const sloped = tobler && steep;
  const up = sloped ? kmhNow : null;
  const down = sloped ? round1(spot(a.season, o.light, -g0)) : null;
  const grid = {
    dryDay: round1(spot('dry', 'day', g0)),
    dryNight: round1(spot('dry', 'night', g0)),
    wetDay: round1(spot('wet', 'day', g0)),
    wetNight: round1(spot('wet', 'night', g0)),
  };

  // Foot / B truck / A tracked side by side (and the mover, when it is another).
  const modeKeys = ['foot', 'b_truck', 'a_tracked'].filter((k) => t.movers[k]);
  if (!modeKeys.includes(a.mover.key)) modeKeys.push(a.mover.key);
  const modes = modeKeys.map((k) => {
    const mm = t.movers[k];
    const st = a.goingAt(mm.profile, at[0], at[1], a.season)?.step ?? null;
    return {
      mover: k,
      short: mm.short,
      cat: mm.cat,
      kmh: round1(spotKmh(t, mm, { ground, step: st, season: a.season, light: o.light, grade: gradeFor(mm), elevM })),
      active: k === a.mover.key,
    };
  });

  // The road: the nearest the mover would use, its speed for the column or one vehicle, and the time to reach it.
  let road: GroundGuideSpeed['road'] = null;
  const hit = a.roads ? pickSpeedRoad(m, a.roads.list, a.season === 'wet') : null;
  if (hit) {
    const key = roadOf(t, hit.attrs);
    const aw = allWeather(hit.attrs);
    const rs = roadKmh(t, m, key, { light: o.light, season: a.season, allWeather: aw, mode: o.road });
    if (rs) {
      const n = typeof hit.attrs.n === 'string' ? hit.attrs.n.trim() : '';
      const r = typeof hit.attrs.r === 'string' ? hit.attrs.r.trim() : '';
      const xc = spot(a.season, o.light, 0);
      road = {
        shield: r || (aw ? 'Road' : 'Track'),
        name: n && n !== r ? n : null,
        key,
        label: t.roads[key]?.label ?? key,
        msr: !!hit.attrs.m,
        allWeather: aw,
        distanceM: hit.distanceM,
        compass: hit.compass,
        bearingDeg: hit.bearingDeg,
        kmh: round1(rs.kmh) ?? 0,
        rateKmih: round1(rs.rateKmih),
        column: rs.column,
        reachMin: hit.distanceM < 15 ? 0 : xc && xc > 0 ? Math.max(1, Math.round((hit.distanceM / 1000 / xc) * 60)) : null,
      };
    }
  }

  // Eight directions: minutes to cover the range, slope taken along the way.
  let rays: SpeedDirection[] | null = null;
  if (a.rays) {
    rays = [];
    const stepG = Math.max(2 * a.pxM, a.rangeM / 40);
    const n = Math.max(4, Math.ceil(a.rangeM / stepG));
    const dG = a.rangeM / n;
    const dM = dG / a.cosLat;
    for (let i = 0; i < 8; i++) {
      const b = (i * 45 * Math.PI) / 180;
      const dx = Math.sin(b);
      const dy = Math.cos(b);
      let minutes = 0;
      let reach = a.rangeM;
      let blockedBy: string | null = null;
      let prevE = elevM;
      let counted = 0;
      for (let k = 1; k <= n; k++) {
        const x = at[0] + dx * (k - 0.5) * dM;
        const y = at[1] + dy * (k - 0.5) * dM;
        const ex = at[0] + dx * k * dM;
        const ey = at[1] + dy * k * dM;
        const gs = a.goingAt(m.profile, x, y, a.season);
        const c = read(L.cls, x, y);
        const e1 = elevAt(read, L, ex, ey);
        const eNow = typeof e1 === 'number' ? e1 : null;
        const gr = prevE !== null && eNow !== null ? (eNow - prevE) / dG : 0;
        prevE = eNow ?? prevE;
        if (!gs) continue; // no data here (or still loading): skip the step
        const v = spotKmh(t, m, { ground: groundOf(t, c), step: gs.step, season: a.season, light: o.light, grade: tobler ? gr : Math.abs(gr), elevM: eNow });
        if (v === null) continue;
        if (v <= 0) {
          reach = (k - 1) * dG;
          blockedBy = gs.why;
          break;
        }
        minutes += (dG / 1000 / v) * 60;
        counted++;
      }
      // Steps with no data count at the mean of the rest, so a gap does not look fast.
      const covered = counted ? (minutes / counted) * Math.round(reach / dG) : 0;
      const kmh = covered > 0 ? reach / 1000 / (covered / 60) : 0;
      rays.push({ bearingDeg: i * 45, compass: COMPASS8[i], minutes: blockedBy ? null : Math.round(covered), reachM: reach, kmh: round1(kmh) ?? 0, blockedBy });
    }
  }

  // A day's march: foot and pack animals.
  let dayKm: GroundGuideSpeed['dayKm'] = null;
  if (m.dayKm) {
    const tc = L.terrain ? read(L.terrain, at[0], at[1]) : null;
    const dg = dayGround(typeof tc === 'number' && tc > 0 && tc !== 255 ? tc : null, ground, slopeDeg);
    const row = m.dayKm[dg];
    const pair = row ? (o.load === 'none' && row.none ? row.none : row.combat) : null;
    if (pair) dayKm = { ground: dg, lo: pair[0], hi: pair[1], load: row?.none ? o.load : 'combat' };
  }

  const bandI = slopeDeg !== null ? slopeBand(t, slopeDeg) : null;
  return {
    mover: a.mover.key,
    label: m.label,
    short: m.short,
    cat: m.cat,
    from: a.mover.from,
    profile: m.profile,
    light: o.light,
    season: a.season,
    roadMode: o.road,
    load: o.load,
    card: o.card,
    ground: ground ? { key: ground, label: t.grounds[ground]?.label ?? ground } : null,
    slopeDeg: slopeDeg === null ? null : Math.round(slopeDeg * 10) / 10,
    slopeBand: bandI !== null ? t.slopeBandLabels[bandI] ?? null : null,
    elevM,
    going: gDry && gWet ? { dry: gDry.step, wet: gWet.step } : null,
    kmh: kmhNow,
    up,
    down,
    grid,
    modes,
    road,
    roadRadiusM: a.roadRadiusM,
    rays,
    rangeM: a.rangeM,
    dayKm,
    basis: `${t.status} (tables of ${t.updated})`,
    pending: a.pending() || !!a.roads?.pending,
  };
}

/** Minutes as "9 min" / "1 h 20 min". */
export function fmtMinutes(min: number): string {
  if (min < 60) return `${Math.max(0, Math.round(min))} min`;
  const h = Math.floor(min / 60);
  const r = Math.round(min - h * 60);
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function fmtKmh(v: number | null): string {
  return v === null ? '?' : `${v} km/h`;
}

/** For the badge's refresh key. */
export function speedKey(s: GroundGuideSpeed | null | undefined): string {
  if (!s) return '';
  const g = s.grid;
  return [
    s.mover, s.light, s.season, s.roadMode, s.load, s.card, s.kmh, s.up, s.down, g.dryDay, g.dryNight, g.wetDay, g.wetNight,
    s.road ? `${s.road.shield}${Math.round(s.road.distanceM / 25)}${s.road.kmh}${s.road.reachMin}` : '',
    s.rays?.map((r) => `${r.minutes ?? 'x'}${Math.round(r.reachM / 50)}`).join(',') ?? '',
    s.modes.map((x) => x.kmh).join(','), s.dayKm ? `${s.dayKm.lo}-${s.dayKm.hi}` : '', s.pending ? 1 : 0,
  ].join(';');
}

/** Copy as Text lines (the Brief and `speedText`). */
export function speedText(s: GroundGuideSpeed): string[] {
  const when = `${s.season === 'wet' ? 'after rain' : 'dry'}, ${s.light}`;
  const out = [`Speed (${s.label}${s.cat ? `, ${s.cat} vehicle` : ''}): ${fmtKmh(s.kmh)} cross-country, ${when}`];
  if (s.up !== null && s.down !== null) out.push(`  Up the slope ${fmtKmh(s.up)}, down ${fmtKmh(s.down)} (slope ${s.slopeDeg} deg)`);
  else if (s.slopeDeg !== null) out.push(`  Slope ${s.slopeDeg} deg (${s.slopeBand ?? ''})`);
  if (s.ground) out.push(`  Ground: ${s.ground.label}${s.going ? `; going dry ${s.going.dry.toUpperCase()}, after rain ${s.going.wet.toUpperCase()}` : ''}`);
  const g = s.grid;
  out.push(`  Day ${fmtKmh(g.dryDay)} dry / ${fmtKmh(g.wetDay)} after rain; night ${fmtKmh(g.dryNight)} dry / ${fmtKmh(g.wetNight)} after rain`);
  if (s.road) {
    const r = s.road;
    const reach = r.reachMin === null ? 'no cross-country way from here' : r.reachMin === 0 ? 'on it' : `${fmtMinutes(r.reachMin)} to reach`;
    const how = s.roadMode === 'convoy' ? `${r.column ?? 'column'} ${r.kmh} km/h${r.rateKmih !== null ? `, ${r.rateKmih} km in the hour` : ''}` : `${r.kmh} km/h alone`;
    out.push(`  Road: ${r.msr ? 'MSR ' : ''}${r.shield}${r.name ? ` (${r.name})` : ''}, ${r.label}, ${Math.round(r.distanceM)} m ${r.compass}: ${reach}, then ${how}`);
  } else out.push(`  Road: none the mover can use within ${Math.round(s.roadRadiusM / 100) / 10} km`);
  if (s.rays) {
    const open = s.rays.filter((r) => r.minutes !== null).sort((p, q) => p.minutes! - q.minutes!);
    if (open.length) out.push(`  To ${Math.round(s.rangeM / 100) / 10} km: fastest ${open[0].compass} ${fmtMinutes(open[0].minutes!)}, slowest ${open[open.length - 1].compass} ${fmtMinutes(open[open.length - 1].minutes!)}`);
    const shut = s.rays.filter((r) => r.minutes === null).map((r) => r.compass);
    if (shut.length) out.push(`  Blocked: ${shut.join(', ')}`);
  }
  if (s.dayKm) out.push(`  A day's march (${s.dayKm.ground}, ${s.dayKm.load === 'none' ? 'without' : 'with'} combat load): ${s.dayKm.lo}-${s.dayKm.hi} km in 24 h`);
  out.push(`  ${s.basis}`);
  return out;
}
