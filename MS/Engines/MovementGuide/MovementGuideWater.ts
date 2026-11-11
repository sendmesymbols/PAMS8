/**
 * MovementGuideWater.ts
 *
 * The water obstacle classifier (OCOKA_Roadmap.md ch. 1: "Water obstacle classifier: the ten obstacle types in IBB
 * Annex P, with home bank vs far bank height"). Pure: no DOM, no ArcGIS; reads the terrain bundle through the
 * Movement Guide's probe, so `node tools/movement-test/water.mjs` runs it on synthetic ground.
 *
 * How it finds the obstacle at a point:
 *   1. Snap: the nearest canal or river line of the bundle's features within `snapM` (name, type, width, depth, bank
 *      heights from the sheet), else the nearest water pixel of the class layer (canal, distributary, drain, water,
 *      stream), whose run gives the obstacle's direction. A placed obstacle symbol (AT Ditch, DCB) is used as it is.
 *   2. Cross-section: a line square to the obstacle, sampled every 10 m for height, class and the wet layer: the water's
 *      edges, each bank's crest (highest point within 150 m of the edge), the land behind (median 200-400 m out), bank
 *      height above the land and above the water, raised (in-filled) or sunk (in-cut), the marsh strip, the bunds.
 *   3. Home or far bank: away from the threat marker when one is set, else the side the user clicked; Swap turns it.
 *   4. Type (IBB Annex P 1-10): the sheet's canal type and name (Link, Feeder, Drain, Disty / Minor), a second canal
 *      close and parallel (twin), the river's name or a dam / barrage / headworks on it (dammed), else the class.
 *      Anti-tank ditch, defence drain and double ditch are not in the bundle: they come from the symbol or the user.
 *   5. Figures, each with its source (Sheet / Sheet reach / Map class / Est. 30 m / IBB typical / Unknown). An unknown
 *      figure is taken at the end that does not flatter the user (safety-first): crossing it, the obstacle is taken
 *      as the bigger; holding it, as the smaller. Every unknown goes on the recce list.
 *   6. The tank, wheels and foot check (gap over 2.5 m, step over 0.9 m, a 24 m ditch, wading depths), the crossings
 *      on the obstacle (bridge class, ford / ferry months), the season (monsoon), the river reach notes.
 *
 * Bank sides from the sheet: right / left are kept by the pipeline (`bl`, `br`, 2026-11-11) but the lines are not all
 * drawn downstream (2:1 in the bundle), so a sheet bank is put on a side only when the 30 m heights along the line show
 * which way it flows; otherwise it is "one bank X m, the other Y m, side not recorded".
 */

import { bearingOf, compass8, distToLine, groundDist, offsetPt, type MercXY, type MovProbe, type NearFeature, type NearLine } from './MovementGuideScan';

// ── types ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type WaterTypeId =
  | 'dammedRiver'
  | 'undammedRiver'
  | 'irrigationCanal'
  | 'distributary'
  | 'linkCanal'
  | 'feederCanal'
  | 'twinCanal'
  | 'drain'
  | 'atDitch'
  | 'defenceDrain'
  | 'doubleDitch'
  | 'stream'
  | 'nala'
  | 'lake';
export const WATER_TYPE_IDS: WaterTypeId[] = ['dammedRiver', 'undammedRiver', 'irrigationCanal', 'distributary', 'linkCanal', 'feederCanal', 'twinCanal', 'drain', 'atDitch', 'defenceDrain', 'doubleDitch', 'stream', 'nala', 'lake'];

export interface WaterProbe extends MovProbe {
  /** The wet layer (0 normal, 1 flood-prone, 2 seasonal water, 3 riverbed, 4 waterlogged, 5 permanent water). */
  raster?(layer: 'wet', x: number, y: number): number | null;
  classLabel?(c: number): string;
}

/** Where a figure comes from. */
export type FigSrc = 'sheet' | 'reach' | 'map' | 'est' | 'symbol' | 'pamphlet' | 'none';
export const SRC_WORD: Record<FigSrc, string> = {
  sheet: 'Sheet',
  reach: 'Sheet reach',
  map: 'Map class',
  est: 'Est. 30 m',
  symbol: 'Symbol',
  pamphlet: 'IBB typical',
  none: 'Unknown',
};
/** A figure: a value or a range, and its source. */
export interface Fig {
  v: number | null;
  lo: number | null;
  hi: number | null;
  src: FigSrc;
  note?: string;
}
const NONE: Fig = { v: null, lo: null, hi: null, src: 'none' };
const fig = (v: number, src: FigSrc, note?: string): Fig => ({ v, lo: v, hi: v, src, note });
const rng = (r: [number | null, number | null] | number[] | null | undefined, src: FigSrc, note?: string): Fig => {
  if (!r) return NONE;
  const lo = r[0] ?? null;
  const hi = r[1] ?? null;
  const v = lo !== null && hi !== null ? (lo + hi) / 2 : (lo ?? hi);
  return v === null ? NONE : { v, lo, hi, src, note };
};
/** The end of a figure that does not flatter: 'hi' takes the bigger, 'lo' the smaller; null when unknown. */
export function worst(f: Fig, end: 'hi' | 'lo'): number | null {
  if (f.src === 'none') return null;
  return end === 'hi' ? (f.hi ?? f.v ?? f.lo) : (f.lo ?? f.v ?? f.hi);
}

export interface Bank {
  /** Crest above the land behind it. */
  aboveLand: Fig;
  /** Crest above the water (the step out of it). */
  aboveWater: Fig;
  /** Crest distance from the obstacle's centre line, m. */
  crestM: number | null;
  /** Marsh / waterlogged ground beside this bank within 400 m, m across. */
  marshM: number;
  /** A bund or embankment recorded on this bank (map class). */
  bund: string | null;
  /** Compass direction from the water to this bank. */
  dir: string;
}

export type Going = 'go' | 'slow' | 'nogo';
export interface Verdict {
  v: Going;
  why: string;
}

export interface WaterCrossing {
  kind: string;
  label: string;
  name: string | null;
  x: number;
  y: number;
  distM: number;
  dir: string;
  /** Signed distance along the obstacle from the section (+ the way the obstacle's direction points), m. */
  alongM: number;
  /** "Class 60+ (tankable)" etc. from the map class at the crossing; null when not a bridge. */
  load: string | null;
  tankable: boolean | null;
  months: string | null;
  inUseNow: boolean | null;
  boats: string | null;
  status: string | null;
}

export interface Section {
  /** Distances across (m; negative = left of the obstacle's direction), heights (NaN = unknown), classes. */
  d: number[];
  z: number[];
  c: Array<number | null>;
  /** The water's edges (m across), null when the class layer shows no water here. */
  edges: [number, number] | null;
  waterZ: number | null;
  /** Bank crests: [d, z] left and right. */
  crests: [[number, number] | null, [number, number] | null];
  land: [number | null, number | null];
}

export interface WaterReading {
  pending: boolean;
  click: MercXY;
  /** The section's centre on the obstacle. */
  at: MercXY;
  /** The obstacle drawn for ~1.5 km either side of the section (null when only the class layer showed it). */
  line: MercXY[] | null;
  source: 'canal' | 'river' | 'class' | 'symbol';
  name: string | null;
  type: WaterTypeId;
  annex: number | null;
  typeLabel: string;
  typeWhy: string[];
  typeSrc: string;
  /** The type's characteristics from the pamphlet (season first). */
  season: { month: number; wet: boolean; text: string };
  notes: string[];
  /** Bearing of the obstacle's direction at the section. */
  axisDeg: number;
  /** +1 = home is right of the obstacle's direction, -1 = left. */
  homeSign: 1 | -1;
  homeWhy: string;
  homeGuessed: boolean;
  width: Fig;
  depth: Fig;
  current: Fig;
  bed: string | null;
  home: Bank;
  far: Bank;
  /** Sheet bank heights whose side is not known ("one bank 2 m, the other 3 m"). */
  sheetBanks: { a: number | null; b: number | null } | null;
  shape: 'raised' | 'sunk' | 'level' | null;
  flow: 'downstream' | 'upstream' | 'unknown';
  twinWith: string | null;
  verdict: { tanks: Verdict; wheels: Verdict; foot: Verdict };
  crossings: WaterCrossing[];
  reach: Record<string, unknown> | null;
  section: Section;
  recce: string[];
  purpose: 'cross' | 'hold';
}

export interface WaterOpts {
  purpose: 'cross' | 'hold';
  month: number;
  type?: WaterTypeId | 'auto';
  threat?: MercXY | null;
  /** A point on the home side (the click; the axis start). */
  homeHint?: MercXY | null;
  flipHome?: boolean;
  /** A placed obstacle symbol: its line, and the type it stands for. */
  line?: { pts: MercXY[]; type?: WaterTypeId | null; name?: string | null } | null;
  snapM?: number;
  crossingsKm?: number;
}

export type WaterRules = Record<string, any>;

const DEFAULTS: WaterRules = {
  types: {},
  dammedRivers: { names: [] },
  damSearchKm: 25,
  damKinds: ['dam', 'barrage', 'headworks'],
  monsoonMonths: [7, 8, 9],
  lineKinds: ['canal', 'river'],
  waterClasses: [4, 5, 20, 21, 22, 46],
  dryBedClasses: [17, 47],
  marshClasses: [6],
  bundClasses: { '24': { label: 'Embankment over 2 m', minM: 2 }, '25': { label: 'Bund 1-2 m', minM: 1 } },
  crossingKinds: ['bridge', 'bridge_iron', 'foot_bridge', 'boat_bridge', 'viaduct', 'ferry', 'ford', 'culvert', 'aqueduct'],
  crossingOnLineM: 80,
  reachKinds: ['river_reach'],
  twinApartM: 400,
  twinAngleDeg: 25,
  section: { stepM: 10, halfMinM: 300, halfMaxM: 1500, crestWithinM: 150, groundFromM: 200, groundToM: 400, raisedM: 1, sunkM: 1.5, marshWithinM: 400 },
  snapM: 500,
  crossingsKm: 5,
  reachStepM: 500,
  reachMaxStations: 40,
  tank: { gapM: 2.5, stepM: 0.9, fullDitchM: 24 },
  ford: { tankDepthM: 1.2, wheeledDepthM: 0.6, footDepthM: 1.0, footCurrentMs: 1.5 },
};

/** The doctrine's `water` block with every value it leaves out filled in. */
export function waterRulesFrom(doc: unknown): WaterRules {
  const w = ((doc as any)?.water ?? {}) as WaterRules;
  const out: WaterRules = { ...DEFAULTS, ...w };
  out.section = { ...DEFAULTS.section, ...(w.section ?? {}) };
  out.tank = { ...DEFAULTS.tank, ...(w.tank ?? {}) };
  out.ford = { ...DEFAULTS.ford, ...(w.ford ?? {}) };
  return out;
}

export function typeDef(R: WaterRules, t: WaterTypeId): any {
  return R.types?.[t] ?? { label: t, annex: null, notes: [] };
}

/** The obstacle type a placed symbol stands for (Symbols.json key = SIDC symbol set + entity). */
export function typeOfSymbolKey(key: string): WaterTypeId | null {
  if (key === '25290203') return 'atDitch'; // AT Ditch reinforced with AT mines
  if (key === '25290201' || key === '25290202') return 'defenceDrain'; // DCB (ditch cum bund), DCB filled with water
  return null;
}

// ── geometry helpers ───────────────────────────────────────────────────────────────────────────────────────────────────

interface OnLine {
  at: MercXY;
  distM: number;
  /** Bearing of the segment the point lies on, in the line's drawn direction. */
  bearing: number;
  seg: number;
  t: number;
}
function nearestOn(p: MercXY, xy: ArrayLike<number>): OnLine | null {
  let best: OnLine | null = null;
  let bd = Infinity;
  for (let i = 0; i + 3 < xy.length; i += 2) {
    const ax = xy[i], ay = xy[i + 1];
    const dx = xy[i + 2] - ax, dy = xy[i + 3] - ay;
    const len = dx * dx + dy * dy;
    const t = len > 0 ? Math.min(1, Math.max(0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len)) : 0;
    const q: MercXY = [ax + t * dx, ay + t * dy];
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
    if (d < bd) {
      bd = d;
      best = { at: q, distM: 0, bearing: len > 0 ? bearingOf([ax, ay], [xy[i + 2], xy[i + 3]]) : 0, seg: i / 2, t };
    }
  }
  if (best) best.distM = groundDist(p, best.at);
  return best;
}
function toPts(xy: ArrayLike<number>): MercXY[] {
  const out: MercXY[] = [];
  for (let i = 0; i + 1 < xy.length; i += 2) out.push([xy[i], xy[i + 1]]);
  return out;
}
function flat(pts: MercXY[]): number[] {
  return pts.flatMap((p) => [p[0], p[1]]);
}
function lineLength(xy: ArrayLike<number>): number {
  let L = 0;
  for (let i = 0; i + 3 < xy.length; i += 2) L += groundDist([xy[i], xy[i + 1]], [xy[i + 2], xy[i + 3]]);
  return L;
}
/** The vertices of a line within `radiusM` of a point (and the segment ends that leave it), for drawing. */
function clipNear(pts: MercXY[], at: MercXY, radiusM: number): MercXY[] {
  const keep = pts.map((p) => groundDist(p, at) <= radiusM);
  const out: MercXY[] = [];
  pts.forEach((p, i) => {
    if (keep[i] || keep[i - 1] || keep[i + 1]) out.push(p);
  });
  return out.length >= 2 ? out : pts.slice(0, 2);
}
const angDiff180 = (a: number, b: number) => {
  const d = Math.abs(((a - b) % 180 + 180) % 180);
  return Math.min(d, 180 - d);
};
const median = (v: number[]): number | null => {
  const a = v.filter(Number.isFinite).sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : null;
};
const r1 = (v: number) => Math.round(v * 10) / 10;
/** How much bank 30 m ground can miss (a crest a few metres wide): the top end of a height read from it. */
const EST_MISS_M = 2;
const halfUp = (v: number) => Math.round(v * 2) / 2;
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** "Oct-Apr" / "Nov to Mar" / "May-Sep" against a month (1-12); null when the sheet's words do not parse. */
export function inUse(months: string | null, month: number): boolean | null {
  if (!months) return null;
  const m = months.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b\W*(?:-|to|–)\W*\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);
  if (!m) return null;
  const a = MONTHS.indexOf(m[1]) + 1;
  const b = MONTHS.indexOf(m[2]) + 1;
  return a <= b ? month >= a && month <= b : month >= a || month <= b;
}

// ── 1. snap ────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Snap {
  at: MercXY;
  axisDeg: number;
  line: NearLine | null;
  /** The obstacle's points for drawing (the snapped line, or the symbol's). */
  pts: MercXY[] | null;
  source: WaterReading['source'];
  distM: number;
}

function isWater(R: WaterRules, c: number | null, w: number | null): boolean {
  return (c !== null && (R.waterClasses as number[]).includes(c)) || w === 5;
}

/** The nearest water pixel within `radiusM` (rings of 15 m), and the run's direction from the water round it. */
function snapRaster(probe: WaterProbe, R: WaterRules, p: MercXY, radiusM: number): { at: MercXY; axisDeg: number; distM: number } | null {
  const wet = (q: MercXY) => isWater(R, probe.cls(q[0], q[1]), probe.raster?.('wet', q[0], q[1]) ?? null);
  let hit: MercXY | null = wet(p) ? p : null;
  let hitD = 0;
  for (let r = 15; !hit && r <= radiusM; r += 15) {
    const n = Math.max(12, Math.round((2 * Math.PI * r) / 20));
    for (let k = 0; k < n; k++) {
      const q = offsetPt(p[0], p[1], (360 * k) / n, r);
      if (wet(q)) {
        hit = q;
        hitD = r;
        break;
      }
    }
  }
  if (!hit) return null;
  // Direction: the principal axis of the water pixels within 150 m (a 15 m grid).
  const xs: number[] = [];
  const ys: number[] = [];
  for (let e = -150; e <= 150; e += 15)
    for (let n = -150; n <= 150; n += 15) {
      if (e * e + n * n > 150 * 150) continue;
      const q = offsetPt(hit[0], hit[1], 90, e);
      const q2 = offsetPt(q[0], q[1], 0, n);
      if (wet(q2)) {
        xs.push(e);
        ys.push(n);
      }
    }
  let axisDeg = 0;
  if (xs.length >= 3) {
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < xs.length; i++) {
      sxx += (xs[i] - mx) ** 2;
      syy += (ys[i] - my) ** 2;
      sxy += (xs[i] - mx) * (ys[i] - my);
    }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy); // angle of the principal axis from east, radians
    axisDeg = ((90 - (th * 180) / Math.PI) % 360 + 360) % 360;
  }
  return { at: hit, axisDeg, distM: hitD };
}

function snap(probe: WaterProbe, R: WaterRules, p: MercXY, opts: WaterOpts): Snap | null {
  if (opts.line && opts.line.pts.length >= 2) {
    const xy = flat(opts.line.pts);
    const o = nearestOn(p, xy)!;
    return { at: o.at, axisDeg: o.bearing, line: null, pts: opts.line.pts, source: 'symbol', distM: o.distM };
  }
  const radius = opts.snapM ?? R.snapM;
  const kinds = new Set<string>(R.lineKinds);
  let best: { l: NearLine; o: OnLine } | null = null;
  for (const l of probe.lines(p[0], p[1], radius, kinds)) {
    const o = nearestOn(p, l.xy);
    if (o && o.distM <= radius && (!best || o.distM < best.o.distM)) best = { l, o };
  }
  const ras = snapRaster(probe, R, p, best ? Math.min(radius, best.o.distM) : radius);
  // Water on the class layer much nearer than any line: an obstacle the sheet does not draw here, unless the line runs
  // through the same water (a wide river clicked away from its centre line; its bed and flood zone count as its water).
  const sameWater = (a: MercXY, b: MercXY) => {
    const L = groundDist(a, b);
    const n = Math.max(1, Math.ceil(L / 15));
    let wet = 0;
    for (let i = 0; i <= n; i++) {
      const q: MercXY = [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n];
      const c = probe.cls(q[0], q[1]);
      const w = probe.raster?.('wet', q[0], q[1]) ?? null;
      if (isWater(R, c, w) || (c !== null && (R.dryBedClasses as number[]).includes(c)) || w === 2 || w === 3) wet++;
    }
    return wet >= 0.8 * (n + 1);
  };
  if (ras && (!best || (ras.distM + 100 < best.o.distM && !sameWater(ras.at, best.o.at)))) return { at: ras.at, axisDeg: ras.axisDeg, line: null, pts: null, source: 'class', distM: ras.distM };
  if (best) return { at: best.o.at, axisDeg: best.o.bearing, line: best.l, pts: toPts(best.l.xy), source: best.l.kind === 'canal' ? 'canal' : 'river', distM: best.o.distM };
  return null;
}

// ── 2. cross-section ───────────────────────────────────────────────────────────────────────────────────────────────────

interface Sampled {
  sec: Section;
  at: MercXY;
  /** Water run across (samples), wet values per sample. */
  w: Array<number | null>;
  stepM: number;
}

function sample(probe: WaterProbe, R: WaterRules, at: MercXY, axisDeg: number, widthGuessM: number): Sampled {
  const S = R.section;
  const step = S.stepM;
  let half = Math.max(S.halfMinM, Math.min(S.halfMaxM, 3 * widthGuessM + S.groundToM));
  const normal = axisDeg + 90;
  const read = (centre: MercXY) => {
    const d: number[] = [];
    const z: number[] = [];
    const c: Array<number | null> = [];
    const w: Array<number | null> = [];
    for (let k = -half; k <= half + 1e-6; k += step) {
      const q = offsetPt(centre[0], centre[1], normal, k);
      d.push(k);
      z.push(probe.elev(q[0], q[1]));
      c.push(probe.cls(q[0], q[1]));
      w.push(probe.raster?.('wet', q[0], q[1]) ?? null);
    }
    return { d, z, c, w };
  };
  let { d, z, c, w } = read(at);
  const water = (i: number) => isWater(R, c[i], w[i]);
  const mid = Math.round(half / step);
  // The run of water nearest the centre (within 45 m), one dry sample allowed inside it.
  let i0 = -1;
  for (let k = 0; k <= Math.round(45 / step) && i0 < 0; k++) {
    if (water(mid + k)) i0 = mid + k;
    else if (water(mid - k)) i0 = mid - k;
  }
  let edges: [number, number] | null = null;
  if (i0 >= 0) {
    let a = i0, b = i0;
    while (a - 1 >= 0 && (water(a - 1) || (a - 2 >= 0 && water(a - 2)))) a -= water(a - 1) ? 1 : 2;
    while (b + 1 < d.length && (water(b + 1) || (b + 2 < d.length && water(b + 2)))) b += water(b + 1) ? 1 : 2;
    edges = [d[a] - step / 2, d[b] + step / 2];
    // Centre the section on the water and read again so both banks get the same reach; a wide river widens the
    // section so the land behind each bank is still read.
    const shift = (edges[0] + edges[1]) / 2;
    const need = Math.min(S.halfMaxM, Math.ceil(((edges[1] - edges[0]) / 2 + S.groundToM + 2 * step) / step) * step);
    if (Math.abs(shift) >= step || need > half) {
      at = offsetPt(at[0], at[1], normal, shift);
      half = Math.max(half, need);
      ({ d, z, c, w } = read(at));
      edges = [edges[0] - shift, edges[1] - shift];
    }
  }
  const midNow = Math.round(half / step);
  const inWater = edges ? d.map((k, i) => (k >= edges![0] && k <= edges![1] ? z[i] : NaN)) : [z[midNow]];
  const waterZ = median(inWater);
  const crests: Section['crests'] = [null, null];
  const land: Section['land'] = [null, null];
  const e = edges ?? [-Math.max(5, widthGuessM / 2), Math.max(5, widthGuessM / 2)];
  for (const side of [0, 1] as const) {
    const sgn = side === 0 ? -1 : 1;
    const edge = Math.abs(e[side]);
    let best = -1;
    const ground: number[] = [];
    for (let i = 0; i < d.length; i++) {
      const k = d[i];
      if (Math.sign(k) !== sgn) continue;
      const a = Math.abs(k);
      if (a >= edge && a <= edge + S.crestWithinM && Number.isFinite(z[i]) && (best < 0 || z[i] > z[best])) best = i;
      if (a >= edge + S.groundFromM && a <= edge + S.groundToM) ground.push(z[i]);
    }
    crests[side] = best >= 0 ? [d[best], z[best]] : null;
    land[side] = median(ground);
  }
  return { sec: { d, z, c, edges, waterZ, crests, land }, at, w, stepM: step };
}

function bankOf(R: WaterRules, s: Sampled, side: 0 | 1, axisDeg: number): Bank {
  const S = R.section;
  const sec = s.sec;
  const sgn = side === 0 ? -1 : 1;
  const crest = sec.crests[side];
  const landZ = sec.land[side];
  const edge = sec.edges ? Math.abs(sec.edges[side]) : 5;
  let marsh = 0;
  let bund = '';
  let bundMin = 0;
  for (let i = 0; i < sec.d.length; i++) {
    const k = sec.d[i];
    if (Math.sign(k) !== sgn) continue;
    const a = Math.abs(k);
    if (a < edge || a > edge + S.marshWithinM) continue;
    const c = sec.c[i];
    if ((c !== null && (R.marshClasses as number[]).includes(c)) || s.w[i] === 4) marsh += s.stepM;
    const b = c !== null ? R.bundClasses?.[String(c)] : null;
    if (b && a <= edge + S.crestWithinM && b.minM > bundMin) {
      bund = String(b.label);
      bundMin = Number(b.minM);
    }
  }
  let aboveLand: Fig = NONE;
  let aboveWater: Fig = NONE;
  // 30 m ground smooths a bank a few metres wide away: the estimate's top end allows for one it cannot see.
  const est = (v: number): Fig => ({ v, lo: v, hi: v + EST_MISS_M, src: 'est', note: `+${EST_MISS_M} m for a bank 30 m ground can miss` });
  if (crest && landZ !== null) aboveLand = est(halfUp(Math.max(0, crest[1] - landZ)));
  if (crest && sec.waterZ !== null) aboveWater = est(halfUp(Math.max(0, crest[1] - sec.waterZ)));
  if (bundMin > 0 && (aboveLand.v === null || aboveLand.v < bundMin)) aboveLand = { v: bundMin, lo: bundMin, hi: aboveLand.v !== null ? Math.max(aboveLand.v, bundMin) : null, src: 'map', note: bund };
  return { aboveLand, aboveWater, crestM: crest ? Math.abs(crest[0]) : null, marshM: marsh, bund: bund || null, dir: compass8(axisDeg + 90 * sgn) };
}

// ── 3-4. type ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function classify(probe: WaterProbe, R: WaterRules, sn: Snap, s: Sampled, opts: WaterOpts): { type: WaterTypeId; why: string[]; src: string; twin: string | null } {
  const why: string[] = [];
  if (opts.type && opts.type !== 'auto') return { type: opts.type, why: ['set on the card'], src: 'You', twin: null };
  if (sn.source === 'symbol' && opts.line?.type) return { type: opts.line.type, why: ['the placed symbol'], src: 'Symbol', twin: null };
  const a = sn.line?.attrs ?? {};
  const name = str(a.n) ?? '';
  const t = (str(a.t) ?? '').toLowerCase();
  const cAt = probe.cls(sn.at[0], sn.at[1]);
  if (sn.source === 'canal') {
    // A second canal close and parallel: a twin canal.
    let twin: string | null = null;
    for (const l of probe.lines(sn.at[0], sn.at[1], R.twinApartM, new Set(['canal']))) {
      if (l === sn.line || (str(l.attrs.n) && str(l.attrs.n) === str(a.n))) continue;
      const o = nearestOn(sn.at, l.xy);
      if (o && o.distM <= R.twinApartM && o.distM > 15 && angDiff180(o.bearing, sn.axisDeg) <= R.twinAngleDeg) {
        twin = str(l.attrs.n) ?? 'an unnamed canal';
        break;
      }
    }
    if (/\bdrain\b/i.test(name) || t === 'drain') return { type: 'drain', why: [`the sheet names it a drain${name ? ` (${name})` : ''}`], src: 'Sheet', twin };
    if (twin && t !== 'disty' && t !== 'minor') return { type: 'twinCanal', why: [`${name || 'this canal'} runs within ${R.twinApartM} m of ${twin}, parallel`], src: 'Sheet', twin };
    if (/\blink\b/i.test(name)) return { type: 'linkCanal', why: [`named a link canal (${name})`], src: 'Sheet', twin };
    if (/\bfeeder\b/i.test(name)) return { type: 'feederCanal', why: [`named a feeder (${name})`], src: 'Sheet', twin };
    if (t === 'disty' || t === 'minor' || /\b(disty|distributary|minor)\b/i.test(name)) return { type: 'distributary', why: [`the sheet records a ${t === 'minor' ? 'minor' : 'distributary'}`], src: 'Sheet', twin };
    why.push(t === 'maincanal' ? 'the sheet records a main canal' : 'the sheet records a canal');
    if (t === 'canaldisused') why.push('marked disused: may be dry');
    return { type: 'irrigationCanal', why, src: 'Sheet', twin };
  }
  if (sn.source === 'river') {
    if (/nala|stream|nawar|lake/.test(t)) {
      const ty: WaterTypeId = /lake|nawar/.test(t) ? 'lake' : cAt === 17 || cAt === 47 ? 'nala' : /stream/.test(t) || cAt === 46 ? 'stream' : 'nala';
      return { type: ty, why: [`the sheet records a ${t}`], src: 'Sheet', twin: null };
    }
    const names = ((R.dammedRivers?.names ?? []) as string[]).map((x) => x.toLowerCase());
    const low = name.toLowerCase();
    const listed = names.find((x) => low && new RegExp(`\\b${x}\\b`).test(low));
    if (listed) return { type: 'dammedRiver', why: [`${name}: its flow is held by dams or barrages`], src: 'List', twin: null };
    const dams = probe.features(sn.at[0], sn.at[1], R.damSearchKm * 1000, new Set<string>(R.damKinds));
    const onIt = dams.find((f) => {
      const rv = (str(f.attrs.rv) ?? '').toLowerCase();
      return (low && rv && (rv.includes(low) || low.includes(rv))) || (sn.line && distToLine([f.x, f.y], sn.line.xy) <= 500);
    });
    if (onIt) return { type: 'dammedRiver', why: [`${onIt.label}${onIt.name ? ` ${onIt.name}` : ''} on it, ${Math.round(onIt.distM / 1000)} km away`], src: 'Sheet', twin: null };
    return { type: 'undammedRiver', why: [name ? `${name}: no dam, barrage or headworks recorded on it` : 'no dam, barrage or headworks recorded on it'], src: 'Sheet', twin: null };
  }
  // The class layer only.
  const run = s.sec.edges ? s.sec.edges[1] - s.sec.edges[0] : 0;
  const lake = probe.features(sn.at[0], sn.at[1], 1500, new Set(['lake']))[0];
  switch (cAt) {
    case 20:
      return { type: 'irrigationCanal', why: ['the class layer shows a canal (no sheet line here)'], src: 'Map class', twin: null };
    case 21:
      return { type: 'distributary', why: ['the class layer shows a distributary / minor'], src: 'Map class', twin: null };
    case 22:
      return { type: 'drain', why: ['the class layer shows a drain'], src: 'Map class', twin: null };
    case 46:
      return { type: 'stream', why: ['the class layer shows a perennial stream'], src: 'Map class', twin: null };
    case 17:
    case 47:
      return { type: 'nala', why: ['the class layer shows a dry riverbed / nullah'], src: 'Map class', twin: null };
    default:
      if (lake) return { type: 'lake', why: [`${lake.name ?? 'a lake'} recorded here`], src: 'Sheet', twin: null };
      return { type: run >= 150 ? 'undammedRiver' : 'stream', why: [`water on the class layer, ${Math.round(run)} m across, no sheet line`], src: 'Map class', twin: null };
  }
}

// ── 6. going ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Is there water in it this month? Dammed rivers and drains run low in the dry season; ditches hold stagnant water. */
function waterIn(type: WaterTypeId, wet: boolean): 'full' | 'low' | 'stagnant' | 'dry' {
  if (type === 'dammedRiver') return wet ? 'full' : 'low';
  if (type === 'drain') return wet ? 'full' : 'dry';
  if (type === 'nala') return wet ? 'full' : 'dry';
  if (type === 'atDitch' || type === 'doubleDitch') return 'stagnant';
  return 'full';
}

function verdicts(R: WaterRules, r: Omit<WaterReading, 'verdict' | 'recce' | 'pending'>): WaterReading['verdict'] {
  const T = R.tank;
  const F = R.ford;
  const cross = r.purpose === 'cross';
  // Crossing it: the exit is the far bank, the obstacle the bigger end of each figure. Holding it: the enemy's exit is
  // the home bank and each figure the smaller end (never overstate the obstacle's value).
  const end: 'hi' | 'lo' = cross ? 'hi' : 'lo';
  const exit = cross ? r.far : r.home;
  const width = worst(r.width, end);
  const depth = worst(r.depth, end);
  const step = Math.max(worst(exit.aboveWater, end) ?? -1, worst(exit.aboveLand, end) ?? -1);
  const stepKnown = step >= 0;
  const water = waterIn(r.type, r.season.wet);
  const marsh = Math.max(r.home.marshM, r.far.marshM);
  const tankBridge = r.crossings.some((c) => c.tankable === true);
  const at = tankBridge ? ' except at a class 60 bridge' : ' except at a bridge (none known class 60 within reach)';
  const out: WaterReading['verdict'] = { tanks: { v: 'go', why: '' }, wheels: { v: 'go', why: '' }, foot: { v: 'go', why: '' } };
  if (r.type === 'lake') {
    const v: Verdict = { v: 'nogo', why: 'standing water: go round' };
    return { tanks: v, wheels: v, foot: v };
  }
  // Tanks.
  if (water === 'full' || water === 'stagnant') {
    if (depth === null) out.tanks = cross ? { v: 'nogo', why: `water of unknown depth${at}` } : { v: 'slow', why: 'depth not known: do not count on it stopping tanks' };
    else if (depth > F.tankDepthM) out.tanks = { v: 'nogo', why: `${r1(depth)} m deep (wading ${F.tankDepthM} m)${at}` };
    else if (stepKnown && step > T.stepM) out.tanks = { v: 'nogo', why: `${r1(step)} m step out (tanks climb ${T.stepM} m)${at}` };
    else if (!stepKnown && cross) out.tanks = { v: 'nogo', why: `bank height not known (tanks climb ${T.stepM} m)${at}` };
    else out.tanks = { v: 'slow', why: `${r1(depth)} m deep, wadeable: find a firm low bank` };
  } else if (water === 'low') {
    // A dammed river in the dry season (IBB Annex P 1): crossable at most places.
    out.tanks = { v: 'slow', why: 'water belt negligible this month: crossable at most places; check the bed and the exits' };
  } else {
    // Dry: a gap; the step out is the bank or the channel's depth, whichever is more.
    const stepDry = Math.max(step, depth ?? -1);
    const gap = width === null || width > T.gapM;
    if (cross) {
      if (gap && (stepDry < 0 || stepDry > T.stepM))
        out.tanks = { v: 'nogo', why: stepDry < 0 ? 'dry, but its depth and banks are not known: take it as a step tanks cannot climb' : `dry, but a ${r1(stepDry)} m step out of a ${width !== null ? `${Math.round(width)} m` : ''} gap (tanks climb ${T.stepM} m): find a ramp or a low bank` };
      else out.tanks = { v: 'slow', why: 'dry this month: cross where the banks are low' };
    } else {
      // Holding it: only a measured figure (not a pamphlet range or a 30 m estimate) may say it stops tanks.
      const measured = (f: Fig) => f.src === 'sheet' || f.src === 'reach';
      const firm = width !== null && width >= T.fullDitchM && (measured(exit.aboveWater) || measured(r.depth)) && stepDry > T.stepM;
      out.tanks = firm ? { v: 'nogo', why: `${Math.round(width!)} m gap, ${r1(stepDry)} m step: a full obstacle even when dry` } : { v: 'slow', why: 'dry this month: do not count on it stopping tanks' };
    }
  }
  if (marsh >= 60 && out.tanks.v === 'go') out.tanks = { v: 'slow', why: `${Math.round(marsh)} m of marsh beside it` };
  // Wheels.
  if (water === 'full' || water === 'stagnant') {
    out.wheels = depth !== null && depth <= F.wheeledDepthM && (!stepKnown || step <= 0.5) ? { v: 'slow', why: `${r1(depth)} m deep: wade at a ford` } : { v: 'nogo', why: `bridge or ferry only${depth !== null ? ` (${r1(depth)} m deep)` : ''}` };
  } else if (water === 'low') {
    out.wheels = { v: 'nogo', why: 'sandy bed and a low water belt: a bridge, or a ford found by recce' };
  } else {
    out.wheels = stepKnown && step <= 0.5 ? { v: 'slow', why: 'dry: cross at a ramp or a low bank' } : { v: 'nogo', why: 'dry, but banks too steep for wheels: a ramp, cut or bridge' };
  }
  // Foot.
  const cur = worst(r.current, end);
  if (water === 'full') {
    if (depth !== null && depth <= F.footDepthM && (cur === null || cur <= F.footCurrentMs)) out.foot = { v: 'slow', why: `wade (${r1(depth)} m${cur !== null ? `, ${cur} m/s` : ''})` };
    else out.foot = { v: cross ? 'nogo' : 'slow', why: depth === null ? 'depth not known: boats, a bridge or a recce for a ford' : `${r1(depth)} m deep: boats or a bridge${cur !== null && cur > F.footCurrentMs ? `, current ${cur} m/s` : ''}` };
  } else out.foot = { v: 'slow', why: water === 'stagnant' ? 'boggy bed: duckboards or ladders' : 'climb the banks' };
  if (r.type === 'atDitch' || r.type === 'defenceDrain' || r.type === 'doubleDitch') out.tanks = { v: 'nogo', why: `${typeLabelShort(r.type)}: built to stop tanks${at}` };
  return out;
}
const typeLabelShort = (t: WaterTypeId) => (t === 'atDitch' ? 'anti-tank ditch' : t === 'defenceDrain' ? 'defence drain' : t === 'doubleDitch' ? 'double ditch' : t);

// ── 6. crossings ───────────────────────────────────────────────────────────────────────────────────────────────────────

function crossingsOn(probe: WaterProbe, R: WaterRules, sn: Snap, at: MercXY, axisDeg: number, month: number, km: number): WaterCrossing[] {
  const kinds = new Set<string>(R.crossingKinds);
  const near = probe.features(at[0], at[1], km * 1000, kinds);
  // The obstacle's lines: the snapped one and its pieces of the same name round it.
  const lines: Array<ArrayLike<number>> = [];
  if (sn.pts) lines.push(flat(sn.pts));
  const nm = str(sn.line?.attrs.n);
  if (sn.line && nm) for (const l of probe.lines(at[0], at[1], km * 1000, new Set([sn.line.kind]))) if (l !== sn.line && str(l.attrs.n) === nm) lines.push(l.xy);
  // Class layer only: the obstacle's run through the section, 2 km each way, stands in for its line (a crossing
  // further off may be on another channel).
  let within = km * 1000;
  if (!lines.length) {
    lines.push(flat([offsetPt(at[0], at[1], axisDeg + 180, 2000), offsetPt(at[0], at[1], axisDeg, 2000)]));
    within = Math.min(within, 2000);
  }
  const on = (f: NearFeature) => f.distM <= within && lines.some((xy) => distToLine([f.x, f.y], xy) <= R.crossingOnLineM);
  const LOAD: Record<number, [string, boolean | null]> = { 39: ['Class 60+ (tankable)', true], 40: ['Class 50-59', false], 41: ['Below class 50', false], 42: ['Class not recorded', null], 43: ['Rly bridge', null], 44: ['Foot bridge', false] };
  const out: WaterCrossing[] = [];
  for (const f of near) {
    if (!on(f)) continue;
    let load: string | null = null;
    let tankable: boolean | null = null;
    if (/bridge|viaduct/.test(f.kind)) {
      for (const r of [0, 15, 30]) {
        if (load) break;
        for (let b = 0; b < 360; b += r ? 45 : 360) {
          const q = offsetPt(f.x, f.y, b, r);
          const c = probe.cls(q[0], q[1]);
          if (c !== null && LOAD[c]) {
            [load, tankable] = LOAD[c];
            break;
          }
        }
      }
      if (f.kind === 'foot_bridge') [load, tankable] = ['Foot bridge', false];
      if (!load) [load, tankable] = ['Class not recorded', null];
    }
    const months = str(f.attrs.su);
    const along = groundDist(at, [f.x, f.y]) * Math.cos(((bearingOf(at, [f.x, f.y]) - axisDeg) * Math.PI) / 180);
    out.push({
      kind: f.kind,
      label: f.label,
      name: f.name,
      x: f.x,
      y: f.y,
      distM: f.distM,
      dir: compass8(bearingOf(at, [f.x, f.y])),
      alongM: Math.round(along),
      load,
      tankable,
      months,
      inUseNow: inUse(months, month),
      boats: str(f.attrs.bo),
      status: str(f.attrs.bs),
    });
  }
  // One crossing recorded twice (the sheet's symbol and its label, or OpenStreetMap): the same family within 40 m is
  // one, keeping the record that says most (a name, a known class, months).
  const family = (k: string) => (/bridge|viaduct/.test(k) ? 'bridge' : k);
  const says = (c: WaterCrossing) => (c.name ? 1 : 0) + (c.tankable !== null ? 2 : 0) + (c.months ? 1 : 0) + (c.boats ? 1 : 0);
  const merged: WaterCrossing[] = [];
  for (const c of out.sort((a, b) => a.distM - b.distM)) {
    const i = merged.findIndex((m) => family(m.kind) === family(c.kind) && groundDist([m.x, m.y], [c.x, c.y]) <= 40);
    if (i < 0) merged.push(c);
    else if (says(c) > says(merged[i])) merged[i] = c;
  }
  // Bridges, fords and ferries before culverts and aqueducts; nearest first within each.
  const rank = (k: string) => (k === 'culvert' || k === 'aqueduct' ? 1 : 0);
  return merged.sort((a, b) => rank(a.kind) - rank(b.kind) || a.distM - b.distM).slice(0, 14);
}

// ── the reading ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Classify the water obstacle nearest a point. Null when there is no water within `snapM`. */
export function readWater(probe: WaterProbe, R: WaterRules, click: MercXY, opts: WaterOpts): WaterReading | null {
  probe.takePending?.();
  const sn = snap(probe, R, click, opts);
  // Nothing found: the probe's pending flag is left set, so the caller can tell "no water" from "still loading".
  if (!sn) return null;
  const a = sn.line?.attrs ?? {};
  const sheetW = num(a.w);
  const s = sample(probe, R, sn.at, sn.axisDeg, sheetW ?? 30);
  const at = s.at;
  const cl = classify(probe, R, sn, s, opts);
  const def = typeDef(R, cl.type);
  const month = Math.max(1, Math.min(12, Math.round(opts.month || 1)));
  const wetSeason = ((R.monsoonMonths ?? []) as number[]).includes(month);

  // The river reach notes nearest (bed, depth, current, wet span) on the same river.
  let reach: Record<string, unknown> | null = null;
  if (sn.source === 'river' || sn.source === 'class') {
    const rr = probe.features(at[0], at[1], 5000, new Set<string>(R.reachKinds));
    const nm = (str(a.n) ?? '').toLowerCase();
    const same = rr.find((f) => nm && (f.name ?? '').toLowerCase().includes(nm)) ?? rr.find((f) => f.distM <= 2000) ?? null;
    reach = same ? { ...same.attrs, distM: Math.round(same.distM) } : null;
  }

  // Width, depth, current.
  const run = s.sec.edges ? s.sec.edges[1] - s.sec.edges[0] : null;
  let width: Fig = NONE;
  if (sheetW) width = fig(sheetW, 'sheet');
  else if (reach && num(reach.ws)) width = fig(num(reach.ws)!, 'reach', 'wet span');
  else if (reach && num(reach.w)) width = fig(num(reach.w)!, 'reach');
  else if (run !== null && run >= 3 * s.stepM) width = { v: Math.round(run), lo: Math.max(0, Math.round(run - 30)), hi: Math.round(run + 30), src: 'est', note: '±30 m' };
  else if (def.widthM) width = rng(def.widthM, 'pamphlet');
  else if (def.wetSpanM) width = rng(def.wetSpanM, 'pamphlet', 'wet span');
  let depth: Fig = NONE;
  if (num(a.dp)) depth = fig(num(a.dp)!, 'sheet');
  else if (reach && (num(reach.dp) || num(reach.dm))) depth = num(reach.dp) && num(reach.dm) ? { v: num(reach.dp), lo: num(reach.dp), hi: num(reach.dm), src: 'reach', note: 'mean to max' } : fig((num(reach.dp) ?? num(reach.dm))!, 'reach');
  else if (def.depthM) depth = rng(def.depthM, 'pamphlet');
  const current: Fig = reach && num(reach.cu) ? fig(num(reach.cu)!, 'reach') : NONE;
  const bed = reach ? str(reach.s) : null;

  // Which way it flows (sheet bank sides need it): the line's ends at least 3 m apart in height over 3 km.
  let flow: WaterReading['flow'] = 'unknown';
  if (sn.line && lineLength(sn.line.xy) >= 3000) {
    const xy = sn.line.xy;
    const z0 = probe.elev(xy[0], xy[1]);
    const z1 = probe.elev(xy[xy.length - 2], xy[xy.length - 1]);
    if (Number.isFinite(z0) && Number.isFinite(z1) && Math.abs(z0 - z1) >= 3) flow = z0 > z1 ? 'downstream' : 'upstream';
  }

  // Home side.
  const nrm = sn.axisDeg + 90;
  const sideOf = (q: MercXY) => {
    const d = groundDist(at, q);
    return d * Math.cos(((bearingOf(at, q) - nrm) * Math.PI) / 180);
  };
  let homeSign: 1 | -1 = 1;
  let homeWhy = '';
  let guessed = false;
  const hint = opts.homeHint ?? click;
  if (opts.threat) {
    homeSign = sideOf(opts.threat) >= 0 ? -1 : 1;
    homeWhy = 'away from the threat marker';
  } else if (Math.abs(sideOf(hint)) >= 3 + (run ?? 0) / 2) {
    homeSign = sideOf(hint) >= 0 ? 1 : -1;
    homeWhy = opts.homeHint ? 'the start of the axis' : 'the side you clicked';
  } else {
    guessed = true;
    homeWhy = 'not set: click on your own bank, or Swap';
  }
  if (opts.flipHome) {
    homeSign = homeSign === 1 ? -1 : 1;
    homeWhy += ' (swapped)';
  }
  const left = bankOf(R, s, 0, sn.axisDeg);
  const right = bankOf(R, s, 1, sn.axisDeg);
  let home = homeSign === 1 ? right : left;
  let far = homeSign === 1 ? left : right;

  // Sheet bank heights: on a side when the flow is known, else as a pair.
  let sheetBanks: WaterReading['sheetBanks'] = null;
  const bl = num(a.bl), br = num(a.br), bmax = num(a.b);
  if ((bl || br) && flow !== 'unknown') {
    // The hydrological right bank lies to the right looking downstream.
    const rightBank = flow === 'downstream' ? br : bl;
    const leftBank = flow === 'downstream' ? bl : br;
    const onHome = homeSign === 1 ? rightBank : leftBank;
    const onFar = homeSign === 1 ? leftBank : rightBank;
    if (onHome) home = { ...home, aboveWater: fig(onHome, 'sheet', 'bank height as recorded') };
    if (onFar) far = { ...far, aboveWater: fig(onFar, 'sheet', 'bank height as recorded') };
  } else if (bl || br || bmax) {
    sheetBanks = bl || br ? { a: bl, b: br } : { a: bmax, b: null };
    // Side not known: each bank lies between the lower and the higher the sheet gives; with one figure only, it is
    // the higher bank and the other is not known (the 30 m estimate, when there is one, is the low end).
    const vals = [bl, br, bmax].filter((v): v is number => v !== null);
    const hi = Math.max(...vals);
    const both = !!(bl && br);
    const pair = (b: Bank): Bank => {
      if (b.aboveWater.src !== 'est' && b.aboveWater.src !== 'none') return b;
      const lo = both ? Math.min(bl!, br!) : (b.aboveWater.v ?? null);
      return { ...b, aboveWater: { v: hi, lo: lo !== null ? Math.min(lo, hi) : null, hi, src: 'sheet', note: both ? 'side not recorded' : 'the higher bank; side not recorded' } };
    };
    home = pair(home);
    far = pair(far);
  }
  // Ditches: the pamphlet's home bank (spoil) and far bank (ground level) when nothing better is known; 30 m ground
  // misses a spoil bank a few metres wide, so a lower estimate gives way to the pamphlet's figure.
  const ditchSrc: FigSrc = cl.src === 'Symbol' ? 'symbol' : 'pamphlet';
  const weak = (f: Fig, lo: number) => f.src === 'none' || (f.src === 'est' && (f.v ?? 0) < lo);
  if (def.homeBankM && weak(home.aboveLand, def.homeBankM[0])) home = { ...home, aboveLand: rng(def.homeBankM, ditchSrc) };
  if (def.farBankM && far.aboveLand.src === 'none') far = { ...far, aboveLand: rng(def.farBankM, ditchSrc) };

  // The water's level against the land: raised (in-filled) or sunk (in-cut).
  let shape: WaterReading['shape'] = null;
  const lands = s.sec.land.filter((v): v is number => v !== null);
  if (s.sec.waterZ !== null && lands.length) {
    const dz = s.sec.waterZ - lands.reduce((p, q) => p + q, 0) / lands.length;
    shape = dz >= R.section.raisedM ? 'raised' : dz <= -R.section.sunkM ? 'sunk' : 'level';
  }

  // A culvert is a crossing only of a small channel; on a canal or river it is a drainage work under it.
  const small = (worst(width, 'lo') ?? 0) < 15 || ['drain', 'distributary', 'nala', 'stream'].includes(cl.type);
  const crossings = crossingsOn(probe, R, sn, at, sn.axisDeg, month, opts.crossingsKm ?? R.crossingsKm).filter((q) => small || q.kind !== 'culvert');
  const notes = [...((def.notes ?? []) as string[])];
  if (cl.twin) notes.unshift(`Twin with ${cl.twin}.`);
  if (shape === 'raised') notes.push('The water stands above the land (in-filled): a breach floods the ground.');
  if (shape === 'sunk') notes.push('The water lies below the land (in-cut): the exit is the climb.');
  const base: Omit<WaterReading, 'verdict' | 'recce' | 'pending'> = {
    click,
    at,
    line: sn.pts ? clipNear(sn.pts, at, 1500) : null,
    source: sn.source,
    name: str(a.n) ?? opts.line?.name ?? null,
    type: cl.type,
    annex: def.annex ?? null,
    typeLabel: def.label ?? cl.type,
    typeWhy: cl.why,
    typeSrc: cl.src,
    season: { month, wet: wetSeason, text: (wetSeason ? def.wet : def.dry) ?? '' },
    notes,
    axisDeg: sn.axisDeg,
    homeSign,
    homeWhy,
    homeGuessed: guessed,
    width,
    depth,
    current,
    bed,
    home,
    far,
    sheetBanks,
    shape,
    flow,
    twinWith: cl.twin,
    crossings,
    reach,
    section: s.sec,
    purpose: opts.purpose,
  };
  const verdict = verdicts(R, base);
  const recce = recceList(base);
  const pending = !!probe.takePending?.() || s.sec.z.some((z) => !Number.isFinite(z));
  return { ...base, verdict, recce, pending };
}

function recceList(r: Omit<WaterReading, 'verdict' | 'recce' | 'pending'>): string[] {
  const L: string[] = [];
  const unk = (f: Fig) => f.src === 'none' || f.src === 'pamphlet' || f.src === 'est';
  if (unk(r.width)) L.push('Width at the site (tape or range-finder).');
  if (unk(r.depth)) L.push('Depth and the bed (firm, sand, mud): wade or sound it.');
  if (r.current.src === 'none' && r.type !== 'atDitch' && r.type !== 'nala') L.push('Current (m/s): time a float over 10 m.');
  if (unk(r.far.aboveWater) || unk(r.far.aboveLand)) L.push('Far bank: height, slope and soil at the exit.');
  if (unk(r.home.aboveWater) || unk(r.home.aboveLand)) L.push('Home bank: height and slope, the launch and the approach.');
  if (r.homeGuessed) L.push('Which bank is home: click on your own bank or press Swap.');
  if (r.home.marshM || r.far.marshM) L.push('Marsh beside the banks: the approaches and exits for vehicles.');
  for (const c of r.crossings) {
    if (c.load === 'Class not recorded') L.push(`${c.label}${c.name ? ` ${c.name}` : ''} ${(c.distM / 1000).toFixed(1)} km ${c.dir}: its load class.`);
    if ((c.kind === 'ford' || c.kind === 'ferry') && c.inUseNow === null) L.push(`${c.label}${c.name ? ` ${c.name}` : ''}: is it in use this month?`);
    if (L.length > 12) break;
  }
  if (r.type === 'dammedRiver') L.push('Water released from the dams: ask the irrigation department for the flow on the day.');
  L.push('Banks and widths here are read from 30 m ground: confirm on the ground before any plan relies on them.');
  return L;
}

/** A quick read under the cursor: the obstacle's type, name and width (no section, no crossings). */
export function quickWater(probe: WaterProbe, R: WaterRules, p: MercXY, radiusM = 150): { type: WaterTypeId; label: string; annex: number | null; name: string | null; width: Fig; distM: number } | null {
  const sn = snap(probe, R, p, { purpose: 'cross', month: 1, snapM: radiusM });
  if (!sn) return null;
  const s: Sampled = { sec: { d: [], z: [], c: [], edges: null, waterZ: null, crests: [null, null], land: [null, null] }, at: sn.at, w: [], stepM: 10 };
  const cl = classify(probe, R, sn, s, { purpose: 'cross', month: 1 });
  const def = typeDef(R, cl.type);
  const w = num(sn.line?.attrs.w);
  return { type: cl.type, label: def.label ?? cl.type, annex: def.annex ?? null, name: str(sn.line?.attrs.n), width: w ? fig(w, 'sheet') : def.widthM ? rng(def.widthM, 'pamphlet') : NONE, distM: sn.distM };
}

// ── along an axis: every obstacle the line crosses ─────────────────────────────────────────────────────────────────────

export interface AxisReading {
  pending: boolean;
  lengthM: number;
  obstacles: Array<{ chainM: number; reading: WaterReading }>;
}

/** Every water obstacle an axis crosses, in order from its start; home is the start's side of each. */
export function readAxis(probe: WaterProbe, R: WaterRules, pts: MercXY[], opts: WaterOpts, max = 12): AxisReading {
  probe.takePending?.();
  const hits: Array<{ chainM: number; at: MercXY }> = [];
  let chain = 0;
  const kinds = new Set<string>(R.lineKinds);
  let prevWater = false;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = groundDist(a, b);
    // Sheet lines crossing this leg.
    const mid: MercXY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    for (const l of probe.lines(mid[0], mid[1], L / 2 + 50, kinds)) {
      const xy = l.xy;
      for (let k = 0; k + 3 < xy.length; k += 2) {
        const p = segX(a, b, [xy[k], xy[k + 1]], [xy[k + 2], xy[k + 3]]);
        if (p) hits.push({ chainM: chain + groundDist(a, p), at: p });
      }
    }
    // Water on the class layer the sheet does not draw.
    for (let d = 0; d <= L; d += 15) {
      const q: MercXY = [a[0] + ((b[0] - a[0]) * d) / Math.max(1, L), a[1] + ((b[1] - a[1]) * d) / Math.max(1, L)];
      const w = isWater(R, probe.cls(q[0], q[1]), probe.raster?.('wet', q[0], q[1]) ?? null);
      if (w && !prevWater) hits.push({ chainM: chain + d, at: q });
      prevWater = w;
    }
    chain += L;
  }
  hits.sort((p, q) => p.chainM - q.chainM);
  const merged: typeof hits = [];
  for (const h of hits) if (!merged.length || h.chainM - merged[merged.length - 1].chainM > 150) merged.push(h);
  const obstacles: AxisReading['obstacles'] = [];
  let pending = !!probe.takePending?.();
  for (const h of merged.slice(0, max)) {
    const r = readWater(probe, R, h.at, { ...opts, homeHint: pts[0], snapM: 120 });
    if (!r) continue;
    // The same obstacle met twice (a line and its water): keep the first.
    if (obstacles.some((o) => groundDist(o.reading.at, r.at) < 100)) continue;
    pending = pending || r.pending;
    obstacles.push({ chainM: Math.round(h.chainM), reading: r });
  }
  return { pending, lengthM: Math.round(chain), obstacles };
}

function segX(a: MercXY, b: MercXY, c: MercXY, d: MercXY): MercXY | null {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + t * r[0], a[1] + t * r[1]] : null;
}

// ── along the obstacle: a strip between two points ─────────────────────────────────────────────────────────────────────

export interface ReachStation {
  n: number;
  alongM: number;
  at: MercXY;
  widthM: number | null;
  homeM: number | null;
  farM: number | null;
  marsh: boolean;
  crossing: string | null;
}
export interface ReachReading {
  pending: boolean;
  lengthM: number;
  stations: ReachStation[];
  /** The narrowest station and the one with the lowest far bank (the likely crossing / breach sites). */
  narrowest: number | null;
  lowestFar: number | null;
  path: MercXY[];
}

/** Stations every `reachStepM` along the obstacle between the sections nearest `a` and `b`. */
export function readReach(probe: WaterProbe, R: WaterRules, a: MercXY, b: MercXY, opts: WaterOpts): ReachReading | null {
  probe.takePending?.();
  const sa = snap(probe, R, a, opts);
  if (!sa) return null;
  // The obstacle's path: the snapped line chained with its neighbours of the same name; else the straight a-b.
  let path: MercXY[] = sa.pts ? [...sa.pts] : [sa.at, b];
  if (sa.line) path = chainLine(probe, sa.line, groundDist(a, b) + 2000);
  const xy = flat(path);
  const oa = nearestOn(a, xy)!;
  const ob = nearestOn(b, xy)!;
  // Chainage of a point on the path.
  const chainOf = (o: OnLine) => {
    let c = 0;
    for (let i = 0; i < o.seg; i++) c += groundDist(path[i], path[i + 1]);
    return c + groundDist(path[o.seg], o.at);
  };
  const ca = chainOf(oa), cb = chainOf(ob);
  const lo = Math.min(ca, cb), hi = Math.max(ca, cb);
  const step = R.reachStepM;
  const n = Math.min(R.reachMaxStations, Math.max(2, Math.floor((hi - lo) / step) + 1));
  const dStep = n > 1 ? (hi - lo) / (n - 1) : 0;
  const at = (c: number): { p: MercXY; brg: number } => {
    let acc = 0;
    for (let i = 0; i + 1 < path.length; i++) {
      const L = groundDist(path[i], path[i + 1]);
      if (acc + L >= c || i + 2 === path.length) {
        const t = L > 0 ? Math.max(0, Math.min(1, (c - acc) / L)) : 0;
        return { p: [path[i][0] + t * (path[i + 1][0] - path[i][0]), path[i][1] + t * (path[i + 1][1] - path[i][1])], brg: bearingOf(path[i], path[i + 1]) };
      }
      acc += L;
    }
    return { p: path[0], brg: 0 };
  };
  const first = readWater(probe, R, a, opts);
  const homeSign = first?.homeSign ?? 1;
  const crossings = first?.crossings ?? [];
  const stations: ReachStation[] = [];
  const sheetW = num(sa.line?.attrs.w);
  for (let i = 0; i < n; i++) {
    const c = lo + i * dStep;
    const { p, brg } = at(c);
    const s = sample(probe, R, p, brg, sheetW ?? 30);
    const left = bankOf(R, s, 0, brg);
    const right = bankOf(R, s, 1, brg);
    const homeB = homeSign === 1 ? right : left;
    const farB = homeSign === 1 ? left : right;
    const near = crossings.find((q) => groundDist([q.x, q.y], s.at) <= Math.max(150, dStep / 2));
    stations.push({
      n: i + 1,
      alongM: Math.round(c - lo),
      at: s.at,
      widthM: sheetW ?? (s.sec.edges ? Math.round(s.sec.edges[1] - s.sec.edges[0]) : null),
      homeM: homeB.aboveWater.v ?? homeB.aboveLand.v,
      farM: farB.aboveWater.v ?? farB.aboveLand.v,
      marsh: homeB.marshM + farB.marshM >= 60,
      crossing: near ? `${near.label}${near.name ? ` ${near.name}` : ''}` : null,
    });
  }
  // The lowest station, only when the stations differ (a constant sheet width marks nothing).
  const pick = (f: (s: ReachStation) => number | null): number | null => {
    let best = -1;
    let bv = Infinity;
    let top = -Infinity;
    for (let i = 0; i < stations.length; i++) {
      const v = f(stations[i]);
      if (v === null) continue;
      top = Math.max(top, v);
      if (v < bv) {
        bv = v;
        best = i;
      }
    }
    return best >= 0 && top - bv >= 0.5 ? best : null;
  };
  const p0 = at(lo).p;
  const p1 = at(hi).p;
  const sub: MercXY[] = [p0, ...path.filter((q) => {
    const o = nearestOn(q, xy)!;
    const c = chainOf(o);
    return c > lo && c < hi;
  }), p1];
  return { pending: !!probe.takePending?.() || !!first?.pending, lengthM: Math.round(hi - lo), stations, narrowest: pick((s) => s.widthM), lowestFar: pick((s) => s.farM), path: sub };
}

/** The line joined end to end with its pieces of the same name (the bundle cuts lines at its tiles). */
function chainLine(probe: WaterProbe, l: NearLine, reachM: number): MercXY[] {
  let pts = toPts(l.xy);
  const nm = str(l.attrs.n);
  if (!nm) return pts;
  const used = new Set<object>([l]);
  for (let round = 0; round < 8; round++) {
    let grew = false;
    for (const end of [0, 1] as const) {
      const e = end === 0 ? pts[0] : pts[pts.length - 1];
      for (const o of probe.lines(e[0], e[1], 100, new Set([l.kind]))) {
        if (used.has(o) || str(o.attrs.n) !== nm) continue;
        const op = toPts(o.xy);
        const s0 = groundDist(e, op[0]), s1 = groundDist(e, op[op.length - 1]);
        if (Math.min(s0, s1) > 60) continue;
        used.add(o);
        const piece = (end === 1) === (s0 <= s1) ? op : op.slice().reverse();
        pts = end === 1 ? [...pts, ...piece] : [...piece, ...pts];
        grew = true;
        break;
      }
    }
    if (!grew || lineLength(flat(pts)) > reachM * 2) break;
  }
  return pts;
}
