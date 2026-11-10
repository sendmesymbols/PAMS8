/**
 * GroundGuideScopeScene.ts
 *
 * What the Gr Scope rail draws, worked out from the terrain bundle round one spot (user, 2026-11-08: a side rail
 * docked at the edge of the map, shown and hidden with V, the map its highlight: range rings, the frontage for the
 * echelon, and a bird's-eye view of the GROTBC things nearby without crowding it).
 *
 * Pure: no DOM, no view, no I/O. The guide hands it a tile reader and the bundle's features; it returns
 *   - the going grid (the guide's own NO-GO / SLOW-GO / Marginal classing for the mode) and the cover grid (built-up,
 *     trees, nullah), SCOPE_N x SCOPE_N cells, row 0 to the north, sampled wide enough to fill the map when it turns
 *     with a rotated view;
 *   - the lines (roads by class, railways, canals, rivers, ridgelines, power lines) and points (hills, towns and
 *     villages, bridges, stations, junctions, spot heights, ITG candidates) in ground metres east / north of the spot,
 *     already thinned for the echelon: the wider the echelon, the less is drawn.
 */

import type { CompiledProfile } from './GroundGuideEvaluator';
import type { MercXY, TerrainRules, TerrainSample } from './GroundGuideTypes';

/** Cells along each side of the grids. */
export const SCOPE_N = 96;

/** Going codes in `ScopeScene.going`. */
export const GOING_NONE = 0;
export const GOING_GO = 1;
export const GOING_MARG = 2;
export const GOING_SLOW = 3;
export const GOING_NOGO = 4;

/** Cover codes in `ScopeScene.over`. */
export const OVER_NONE = 0;
export const OVER_BUA = 1;
export const OVER_TREES = 2;
export const OVER_NULLAH = 3;

/** How far the map reaches round the spot, its range rings and scale bar, and how much it draws (0 closest .. 4 widest). */
export interface ScopeLevel {
  lv: 0 | 1 | 2 | 3 | 4;
  radiusM: number;
  rings: number[];
  barM: number;
}

const LEVELS: readonly ScopeLevel[] = [
  { lv: 0, radiusM: 240, rings: [50, 100, 200], barM: 50 },
  { lv: 1, radiusM: 720, rings: [100, 300, 600], barM: 200 },
  { lv: 2, radiusM: 1500, rings: [250, 500, 1000], barM: 500 },
  { lv: 3, radiusM: 3600, rings: [1000, 2000, 3000], barM: 1000 },
  { lv: 4, radiusM: 10000, rings: [3000, 6000, 9000], barM: 2000 },
];
/** 2525D echelon code (Section, Pl, Coy, Bn, Bde) to its level. Anything else reads like a Coy. */
const LEVEL_OF_ECHELON: Readonly<Record<string, number>> = { '13': 0, '14': 1, '15': 2, '16': 3, '18': 4 };

/**
 * The level for an echelon code (null: a point with no frontage, or the map centre), widened when the shape being
 * judged reaches `needM` ground metres from the spot (a line or area): the first level that holds it, past the
 * widest a multiple of it. With `fit`, a spot without an echelon gets the closest level that holds `needM` (the
 * weapon's fan in the OCOKA lens) instead of the Coy's.
 */
export function scopeLevel(code: string | null, needM = 0, fit = false): ScopeLevel {
  // `fit` (the OCOKA lens, a spot with no echelon): the closest level that still holds `needM`, never the Section's.
  const none = fit && needM > 0 ? Math.max(1, LEVELS.findIndex((x) => x.radiusM >= needM)) : 2;
  const l = LEVELS[code !== null && code in LEVEL_OF_ECHELON ? LEVEL_OF_ECHELON[code] : none];
  if (!(needM > l.radiusM)) return l;
  const holds = LEVELS.find((x) => x.radiusM >= needM);
  if (holds) return holds;
  const f = Math.ceil(needM / LEVELS[4].radiusM);
  return { lv: 4, radiusM: 10000 * f, rings: [3000 * f, 6000 * f, 9000 * f], barM: 2000 * f };
}

/** Class code (0-255) to a cover code, from the class names in rules.json (any bundle that names its classes alike). */
export function overCodes(rules: TerrainRules | null): Uint8Array {
  const out = new Uint8Array(256);
  for (const [code, def] of Object.entries(rules?.classes ?? {})) {
    const c = Number(code);
    if (!(c >= 0 && c < 256)) continue;
    const name = String((def as { name?: string }).name ?? '');
    const kind = String((def as { kind?: string }).kind ?? '');
    if (name === 'built_up' || name === 'graveyard') out[c] = OVER_BUA;
    else if (kind === 'vegetation' || name === 'walled_orchard') out[c] = OVER_TREES;
    else if (name === 'dry_riverbed' || name === 'nullah_dry') out[c] = OVER_NULLAH;
  }
  return out;
}

/** One feature point of the bundle, Web Mercator metres, with its kind key (features/index.json) and attributes. */
export interface ScopeRawPoint {
  key: string;
  x: number;
  y: number;
  a: Record<string, unknown>;
}

/** One feature line of the bundle, Web Mercator metres as x0, y0, x1, y1, ... */
export interface ScopeRawLine {
  key: string;
  xy: Float64Array;
  a: Record<string, unknown>;
}

export type ScopeLineKind = 'msr' | 'all' | 'fair' | 'minor' | 'track' | 'rail' | 'canal' | 'river' | 'ridge' | 'power';

export interface ScopeLine {
  kind: ScopeLineKind;
  /** Ground metres east / north of the spot, as x0, y0, x1, y1, ... */
  pts: Float64Array;
  a: Record<string, unknown>;
}

export interface ScopePoint {
  key: string;
  /** Ground metres east / north of the spot; distance (m) and bearing (degrees from north) from it. */
  x: number;
  y: number;
  d: number;
  b: number;
  a: Record<string, unknown>;
}

export interface ScopeScene {
  level: ScopeLevel;
  /** Ground metres the grids reach each way from the spot (the map's radius, more when the map is turned). */
  half: number;
  going: Uint8Array;
  over: Uint8Array;
  /** Cells with no terrain data (outside the bundle or a tile still on its way). */
  unknown: number;
  lines: ScopeLine[];
  hills: ScopePoint[];
  towns: ScopePoint[];
  bridges: ScopePoint[];
  stations: ScopePoint[];
  junctions: ScopePoint[];
  heights: ScopePoint[];
  /** ITG candidates drawn (strong first, then nearest; at most `ITG_MAX`) and how many there are in all. */
  itg: ScopePoint[];
  itgAll: number;
}

export interface ScopeSceneInput {
  centre: MercXY;
  level: ScopeLevel;
  /** Where north points on screen, degrees clockwise from up (the grids are sampled to fill the turned map). */
  northDeg: number;
  /** The class and distance to NO-GO at a Web Mercator point for the mode; a null class when not known. */
  read: (mx: number, my: number) => TerrainSample;
  /** The mode's rules; null when the symbol is not terrain-bound (the going is then left unjudged). */
  profile: CompiledProfile | null;
  /** Distance to NO-GO under which ground is Marginal, metres. */
  nearM: number;
  overOf: Uint8Array;
  points: readonly ScopeRawPoint[];
  lines: readonly ScopeRawLine[];
}

/** Town and village marks by kind: radius on the map (px at 397 px) and rank (0 the biggest). */
export const TOWN_KINDS: Readonly<Record<string, { r: number; rank: number }>> = {
  city: { r: 6.5, rank: 0 },
  district_hq: { r: 5.5, rank: 1 },
  town: { r: 5, rank: 2 },
  village_imp: { r: 3.6, rank: 3 },
  village: { r: 2.4, rank: 4 },
};
const HILL_KINDS = new Set(['mountain', 'peak', 'hill', 'knoll', 'plateau']);
const LINE_KINDS: Readonly<Record<string, ScopeLineKind>> = { railway: 'rail', canal: 'canal', river: 'river', ridgeline: 'ridge', power_line: 'power' };
/** ITG diamonds drawn at most (the legend gives the full count). */
export const ITG_MAX = 6;
/** The same place recorded twice (two sources) is drawn once when the names match within this far, metres. */
const TWIN_M = 1500;

/** A road's class on the rail: MSR, all-weather, fair-weather, minor or track (features/index.json road attributes). */
export function roadKind(a: Record<string, unknown>): ScopeLineKind {
  const t = String(a.t ?? '');
  const c = String(a.c ?? '');
  if (a.m) return 'msr';
  if (/track|cart|unmetal|path|foot|shingl/.test(t)) return 'track';
  if (/F/.test(c)) return 'fair';
  if (/A/.test(c) || Number(a.k) >= 2 || /highway|main_road|motorway/.test(t)) return 'all';
  return 'minor';
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** People recorded for a place: the official count, else the WorldPop estimate; 0 when neither. */
export function people(p: { a: Record<string, unknown> }): number {
  return num(p.a.p) || num(p.a.wp);
}

/** Ground metres the grids must reach so the map, turned by `northDeg`, is filled to its corners. */
export function scopeHalf(radiusM: number, northDeg: number): number {
  const t = (northDeg * Math.PI) / 180;
  return radiusM * (Math.abs(Math.cos(t)) + Math.abs(Math.sin(t)));
}

export function buildScopeScene(inp: ScopeSceneInput): ScopeScene {
  const { centre, level, profile } = inp;
  const lv = level.lv;
  const R = level.radiusM;
  const half = scopeHalf(R, inp.northDeg);
  const lat = 2 * Math.atan(Math.exp(centre[1] / 6378137)) - Math.PI / 2;
  const k = 1 / Math.max(Math.cos(lat), 1e-6); // Web Mercator metres per ground metre here

  // Going and cover grids, cell centres, row 0 to the north.
  const N = SCOPE_N;
  const step = (2 * half) / N;
  const going = new Uint8Array(N * N);
  const over = new Uint8Array(N * N);
  let unknown = 0;
  for (let j = 0; j < N; j++) {
    const my = centre[1] + ((N - 1) / 2 - j) * step * k;
    for (let i = 0; i < N; i++) {
      const mx = centre[0] + (i - (N - 1) / 2) * step * k;
      const s = inp.read(mx, my);
      const c = s.classCode;
      const o = j * N + i;
      if (c === null || c === 255) {
        unknown++;
        continue;
      }
      over[o] = inp.overOf[c];
      if (!profile) going[o] = GOING_GO;
      else if (profile.nogo[c]) going[o] = GOING_NOGO;
      else if (profile.caution[c]) going[o] = GOING_SLOW;
      else going[o] = s.distanceM !== null && s.distanceM < inp.nearM ? GOING_MARG : GOING_GO;
    }
  }

  const local = (x: number, y: number): [number, number] => [(x - centre[0]) / k, (y - centre[1]) / k];
  const reach = half * 1.1;

  // Lines: those that reach the map, thinned for the echelon (Bde: MSR and all-weather roads only; Bn: no tracks).
  const lines: ScopeLine[] = [];
  for (const l of inp.lines) {
    const kind = l.key === 'road' ? roadKind(l.a) : LINE_KINDS[l.key];
    if (!kind) continue;
    if (l.key === 'road' && ((lv >= 4 && kind !== 'msr' && kind !== 'all') || (lv === 3 && kind === 'track'))) continue;
    const pts = new Float64Array(l.xy.length);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i + 1 < l.xy.length; i += 2) {
      const [x, y] = local(l.xy[i], l.xy[i + 1]);
      pts[i] = x;
      pts[i + 1] = y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (x1 < -reach || x0 > reach || y1 < -reach || y0 > reach) continue;
    lines.push({ kind, pts, a: l.a });
  }

  const scene: ScopeScene = { level, half, going, over, unknown, lines, hills: [], towns: [], bridges: [], stations: [], junctions: [], heights: [], itg: [], itgAll: 0 };
  const itg: ScopePoint[] = [];
  const twinOf = (list: ScopePoint[], p: ScopePoint, same: (q: ScopePoint) => boolean) =>
    list.find((q) => same(q) && Math.hypot(q.x - p.x, q.y - p.y) < TWIN_M);
  for (const raw of inp.points) {
    const [x, y] = local(raw.x, raw.y);
    if (Math.abs(x) > half || Math.abs(y) > half) continue;
    const a = raw.a ?? {};
    const p: ScopePoint = { key: raw.key, x, y, d: Math.hypot(x, y), b: ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360, a };
    const hill = HILL_KINDS.has(raw.key);
    const town = TOWN_KINDS[raw.key];
    if (hill) {
      // Close in every hill; wider out only the named ones and the ITG candidates. One mark per hill (two sources).
      if (lv < 3 || a.it || a.n) {
        const twin = twinOf(scene.hills, p, (q) => num(q.a.e) === num(a.e) && String(q.a.n ?? '') === String(a.n ?? ''));
        if (!twin) scene.hills.push(p);
      }
    } else if (town) {
      // Villages only close in. The same place recorded twice keeps the larger record.
      if (lv < 3 || town.rank <= 3) {
        const twin = a.n ? twinOf(scene.towns, p, (q) => q.a.n === a.n) : undefined;
        const rank = (q: ScopePoint) => TOWN_KINDS[q.key]?.rank ?? 9;
        if (!twin) scene.towns.push(p);
        else if (people(p) > people(twin) || rank(p) < rank(twin)) Object.assign(twin, p, { key: rank(p) < rank(twin) ? p.key : twin.key });
      }
    } else if (raw.key === 'bridge' || raw.key === 'bridge_iron') {
      if (lv <= 2) scene.bridges.push(p);
    } else if (raw.key === 'rail_station') scene.stations.push(p);
    else if (raw.key === 'main_junction') {
      if (lv >= 3) scene.junctions.push(p);
    } else if (raw.key === 'spot_height') {
      if (lv <= 1) scene.heights.push(p);
    }
    const it = num(a.it);
    if (it >= 1 && (hill || lv <= 2 || it >= 2)) itg.push(p);
  }
  scene.itgAll = itg.length;
  scene.itg = itg.sort((p, q) => num(q.a.it) - num(p.a.it) || p.d - q.d).slice(0, ITG_MAX);
  return scene;
}

/** Share of the cells (0-1) with this code. */
export function gridShare(grid: Uint8Array, code: number): number {
  let n = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i] === code) n++;
  return n / grid.length;
}
