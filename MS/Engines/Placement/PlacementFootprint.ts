/**
 * PlacementFootprint.ts
 *
 * Echelon → ground footprint for the Placement Advisor. A unit is not a point:
 * it holds a frontage (width across its front), a depth (to its rear) and keeps
 * an intergap to the next unit of the same echelon along the front. This module
 * turns a placed echelon symbol into that footprint and measures the gap between
 * two of them. Pure (no view, no DOM), like PlacementSampling, so it is testable
 * in Node and identical in every host.
 *
 * Doctrine table (metres, [min, max]; a bundle's rules.json `echelons` overrides it):
 *
 *   echelon    frontage        depth        intergap
 *   Section     75 – 100       none         100 – 150
 *   Platoon    450 – 600       none         300
 *   Company   1200 – 1500     600 – 800     500
 *   Battalion 3000 – 5000    2800 – 3000   1000 – 1200
 *   Brigade  10000 – 12000   4000 – 6000   3000
 *
 * "None" depth means a line: the footprint is a segment `frontage` long.
 * The footprint is centred on the symbol. All sizes are ground metres and are
 * converted to Web Mercator with the same 1 / cos(latitude) factor as
 * GeoTools.metersToMapUnits (inlined here: this module works in raw Mercator metres).
 */

import { fmtDistance } from './PlacementEvaluator';
import { normaliseSidc } from './PlacementProfiles';
import type { MercShape } from './PlacementSampling';
import type {
  MercXY,
  PlacementFacingMode,
  PlacementFootprintOptions,
  PlacementFootprintSize,
  PlacementSpacing,
  TerrainRules,
} from './PlacementTypes';

type Range = [number, number];

export interface EchelonSpec {
  name: string;
  frontageM: Range;
  depthM: Range;
  gapM: Range;
}

/** 2525D echelon code (SIDC digits 9–10) → footprint. Echelons not listed are judged as a point. */
export const ECHELON_FOOTPRINTS: Readonly<Record<string, EchelonSpec>> = {
  '13': { name: 'Section', frontageM: [75, 100], depthM: [0, 0], gapM: [100, 150] },
  '14': { name: 'Platoon', frontageM: [450, 600], depthM: [0, 0], gapM: [300, 300] },
  '15': { name: 'Company', frontageM: [1200, 1500], depthM: [600, 800], gapM: [500, 500] },
  '16': { name: 'Battalion', frontageM: [3000, 5000], depthM: [2800, 3000], gapM: [1000, 1200] },
  '18': { name: 'Brigade', frontageM: [10000, 12000], depthM: [4000, 6000], gapM: [3000, 3000] },
};

/** Facings tried by `worst4`. A centred rectangle repeats every 180°, so these cover all orientations in 45° steps. */
const WORST_FACINGS = [0, 45, 90, 135];
/** Disc outline resolution. */
const DISC_SEGMENTS = 32;
/** Neighbours that are drawn / listed as conflicts, nearest first. */
const MAX_CONFLICTS = 6;
const EARTH_R = 6378137;

export interface FootprintDims {
  code: string;
  name: string;
  frontageM: number;
  depthM: number;
  /** Minimum intergap (lower end of the range) — a gap below this is a violation. */
  gapM: number;
}

export interface FootprintCandidate {
  shape: MercShape;
  /** Outline in Web Mercator metres: a closed ring, or the 2 end points of a line. */
  ring: MercXY[];
  /** Degrees clockwise from north; null for the disc. */
  facingDeg: number | null;
}

export interface FootprintPlan {
  dims: FootprintDims;
  centre: MercXY;
  facing: PlacementFacingMode;
  /** One candidate for `fixed` / `circle`, four for `worst4`; the advisor keeps the worst result. */
  candidates: FootprintCandidate[];
}

/** Web Mercator metres per ground metre at this Mercator y. */
export function mercPerMetre(my: number): number {
  const lat = 2 * Math.atan(Math.exp(my / EARTH_R)) - Math.PI / 2;
  return 1 / Math.max(Math.cos(lat), 1e-6);
}

function normaliseBearing(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function asRange(v: unknown): Range | null {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return [v, v];
  if (Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(n) && n >= 0)) {
    return [Math.min(v[0], v[1]), Math.max(v[0], v[1])];
  }
  return null;
}

function pick(r: Range, size: PlacementFootprintSize): number {
  return size === 'min' ? r[0] : size === 'max' ? r[1] : (r[0] + r[1]) / 2;
}

/** Land-unit echelon code from a SIDC, or null when the SIDC has none / is not a land unit. */
export function echelonCodeOf(sidc: string | null | undefined): string | null {
  const s = normaliseSidc(sidc);
  // 2525D digits 5–6 symbol set; 9–10 echelon. Only land units (set 10) carry an echelon here.
  if (!s || s.length !== 20 || s.substring(4, 6) !== '10') return null;
  const code = s.substring(8, 10);
  return code === '00' ? null : code;
}

/** Affiliation group of a SIDC (digit 4): neighbours of the other side never crowd you. */
export function sideOf(sidc: string | null | undefined): string {
  const id = normaliseSidc(sidc)?.charAt(3);
  if (id === '2' || id === '3') return 'friend';
  if (id === '5' || id === '6') return 'hostile';
  if (id === '4') return 'neutral';
  return 'unknown';
}

/** Footprint dimensions for an echelon code, honouring the bundle's overrides. Null = judge as a point. */
export function footprintDims(
  code: string,
  size: PlacementFootprintSize,
  rules?: TerrainRules | null,
): FootprintDims | null {
  const base = ECHELON_FOOTPRINTS[code];
  const ov = rules?.echelons?.[code];
  if (!base && !ov) return null;
  const frontage = asRange(ov?.frontageM) ?? base?.frontageM;
  if (!frontage) return null;
  const depth = asRange(ov?.depthM) ?? base?.depthM ?? [0, 0];
  const gap = asRange(ov?.gapM) ?? base?.gapM ?? [0, 0];
  return {
    code,
    name: ov?.name ?? base?.name ?? `Echelon ${code}`,
    frontageM: pick(frontage, size),
    depthM: pick(depth, size),
    gapM: gap[0],
  };
}

/** Outline of one footprint centred on `c`: rectangle / segment across `facingDeg`, or a disc. */
function buildCandidate(c: MercXY, dims: FootprintDims, facingDeg: number | null): FootprintCandidate {
  const k = mercPerMetre(c[1]);
  const f = dims.frontageM * k;
  if (facingDeg === null) {
    const r = f / 2;
    const ring: MercXY[] = [];
    for (let i = 0; i < DISC_SEGMENTS; i++) {
      const a = (i / DISC_SEGMENTS) * 2 * Math.PI;
      ring.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
    }
    return { shape: { kind: 'area', parts: [ring] }, ring, facingDeg };
  }
  const t = (facingDeg * Math.PI) / 180;
  // Unit vectors in Mercator: `front` points the way the unit faces, `across` runs along its frontage.
  const fx = Math.sin(t);
  const fy = Math.cos(t);
  const ax = Math.cos(t);
  const ay = -Math.sin(t);
  const hf = f / 2;
  if (dims.depthM <= 0) {
    const ring: MercXY[] = [
      [c[0] - ax * hf, c[1] - ay * hf],
      [c[0] + ax * hf, c[1] + ay * hf],
    ];
    return { shape: { kind: 'line', parts: [ring] }, ring, facingDeg };
  }
  const hd = (dims.depthM * k) / 2;
  const ring: MercXY[] = [
    [c[0] - ax * hf + fx * hd, c[1] - ay * hf + fy * hd],
    [c[0] + ax * hf + fx * hd, c[1] + ay * hf + fy * hd],
    [c[0] + ax * hf - fx * hd, c[1] + ay * hf - fy * hd],
    [c[0] - ax * hf - fx * hd, c[1] - ay * hf - fy * hd],
  ];
  return { shape: { kind: 'area', parts: [ring] }, ring, facingDeg };
}

/**
 * Footprint plan for a drawn shape, or null when it should be judged as a point:
 * not a lone point, footprints off, not a land-unit echelon, or an echelon with no
 * footprint defined (team, squad, regiment and above).
 */
export function planFootprint(
  shape: MercShape,
  sidc: string | null | undefined,
  rules: TerrainRules | null,
  opts: PlacementFootprintOptions,
): FootprintPlan | null {
  if (!opts.enabled || shape.kind !== 'point' || shape.parts.length !== 1 || shape.parts[0].length !== 1) return null;
  const code = echelonCodeOf(sidc);
  const dims = code ? footprintDims(code, opts.size, rules) : null;
  if (!dims) return null;
  const centre = shape.parts[0][0];
  const facings: Array<number | null> =
    opts.facing === 'circle' ? [null] : opts.facing === 'worst4' ? WORST_FACINGS : [normaliseBearing(opts.bearingDeg)];
  return { dims, centre, facing: opts.facing, candidates: facings.map((f) => buildCandidate(centre, dims, f)) };
}

/**
 * Gap between two same-echelon footprints whose centres are `dxM`, `dyM` apart (ground
 * metres, east / north), for a unit facing `facingDeg`. Both are the same size and facing,
 * so each is an axis-aligned box in the unit's own frame and the gap is the box-to-box
 * distance (0 when they touch or overlap). A depth-0 unit is a segment (`depthM` 0).
 */
function boxGapM(dxM: number, dyM: number, facingDeg: number, frontageM: number, depthM: number): number {
  const t = (facingDeg * Math.PI) / 180;
  const across = dxM * Math.cos(t) - dyM * Math.sin(t);
  const along = dxM * Math.sin(t) + dyM * Math.cos(t);
  return Math.hypot(Math.max(0, Math.abs(across) - frontageM), Math.max(0, Math.abs(along) - depthM));
}

/**
 * Smallest gap between the planned footprint and each same-echelon neighbour, and the
 * facing at which it occurs (null for the disc). `fixed`/`circle` have one orientation;
 * `worst4` takes the tightest of its four.
 */
function gapToNeighbour(plan: FootprintPlan, dxM: number, dyM: number): { gapM: number; facingDeg: number | null } {
  const { frontageM, depthM } = plan.dims;
  let best = { gapM: Infinity, facingDeg: null as number | null };
  for (const cand of plan.candidates) {
    const g =
      cand.facingDeg === null
        ? Math.max(0, Math.hypot(dxM, dyM) - frontageM)
        : boxGapM(dxM, dyM, cand.facingDeg, frontageM, depthM);
    if (g < best.gapM) best = { gapM: g, facingDeg: cand.facingDeg };
  }
  return best;
}

/**
 * Intergap check: is the planned footprint at least `dims.gapM` from every neighbour?
 * `neighbours` are the Mercator positions of same-echelon, same-side symbols already
 * placed. Advisory — the caller decides what to do with it.
 */
export function checkSpacing(plan: FootprintPlan, neighbours: MercXY[]): PlacementSpacing {
  const { dims, centre } = plan;
  const g = 1 / mercPerMetre(centre[1]); // Mercator → ground metres
  // Beyond this centre distance no orientation can bring the footprints within the minimum gap.
  const reachM = Math.hypot(dims.frontageM, dims.depthM) + dims.gapM;

  const found: Array<{ at: MercXY; gapM: number; facingDeg: number | null }> = [];
  let nearest: number | null = null;
  for (const n of neighbours) {
    const dxM = (n[0] - centre[0]) * g;
    const dyM = (n[1] - centre[1]) * g;
    if (Math.abs(dxM) > reachM || Math.abs(dyM) > reachM) continue;
    const r = gapToNeighbour(plan, dxM, dyM);
    if (nearest === null || r.gapM < nearest) nearest = r.gapM;
    if (r.gapM < dims.gapM) found.push({ at: n, ...r });
  }
  found.sort((a, b) => a.gapM - b.gapM);
  const conflicts = found.slice(0, MAX_CONFLICTS).map((c) => ({
    at: c.at,
    gapM: c.gapM,
    ring: buildCandidate(c.at, dims, c.facingDeg).ring,
  }));

  let status: PlacementSpacing['status'] = 'ok';
  let message: string | null = null;
  if (found.length > 0) {
    const worst = found[0].gapM;
    status = worst <= 0 ? 'overlap' : 'tight';
    message =
      status === 'overlap'
        ? `Overlaps a neighbouring ${dims.name} footprint — keep at least ${fmtDistance(dims.gapM)} between them`
        : `Only ${fmtDistance(worst)} from the next ${dims.name} — keep at least ${fmtDistance(dims.gapM)} between them`;
  }
  return { status, minGapM: dims.gapM, nearestGapM: nearest, conflicts, message };
}
