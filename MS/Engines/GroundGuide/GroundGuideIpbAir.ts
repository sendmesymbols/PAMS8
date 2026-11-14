/**
 * GroundGuideIpbAir.ts
 *
 * Air avenues of approach, LZ / DZ and AD sites over the IPB area read (IPB s2 para 1 pp 5-6, Fig 1 p 8; IPB_Plan.md
 * §6.4; Phase 6). Pure: no DOM, no view, no I/O (it runs in Node: `node tools/ipb-test/air.mjs`). Figures from
 * `IpbDoctrine.json air` (the book's factors D; flight heights, landing point sizes, slope and approach ratio T; the
 * cost weights E).
 *
 *   - **Air avenues**: least-cost low-level ways on a 150 m grid from the start edge of the area to the LZs (else the
 *     objective). A cell costs its length, more where the other side may see an aircraft at the top of the flight band
 *     (`analyseSight` fans from its Posns: never understated), near vertical obstructions (masts, wind towers, chimneys,
 *     overhead tanks), across power lines, over built-up ground and where the elevation is missing; less in a valley
 *     (defilade) and along a river, canal, railway or main road lying parallel to the flight (navigation). Two or three
 *     ways that do not share most of their length, ranked by cost, each with its reasons.
 *   - **LZ / DZ**: squares of ground a helicopter can land on (the landing points for the LZ class laid in a square, one
 *     point diameter apart), slope within the limit (4 degrees in mountains, MW p 256), the 10 : 1 approach clear in at
 *     least one direction, existing helipads and airfields first; ranked by concealment from the other side, nearness to
 *     the objective, slope and approaches. For the enemy's LZs behind own FDLs, the OP over each (OoW I p 63).
 *   - **AD sites**: ground within the AD weapon's range of the air avenues, scored for long-range (down the avenue),
 *     flank (beside it) and bottom (below where it crosses a crest) shots, on a terrain line of sight to an aircraft at
 *     the bottom of the band (AD coverage never overstated).
 *   - **Flight profile** of each avenue: the ground, the highest obstacle beside it, the stretch the other side may see.
 */

import { analyseSight, bearingsFor, fineStep, sightTo, type OcokaGrid, type SightTables } from './GroundGuideOcoka';
import { simplifyLine } from './GroundGuideIpbCorridors';

export type AirBand = 'noe' | 'contour' | 'low';

export interface AirRules {
  bands: Record<AirBand, { label: string; minM: number; maxM: number }>;
  lpSizeM: Record<number, number>;
  slopeOkDeg: number;
  slopeCautionDeg: number;
  mtnOkDeg: number;
  mtnReliefM: number;
  approachRatio: number;
  dzW: number;
  dzL: number;
  land: Uint8Array;
  caution: Uint8Array;
  cautionWhy: Record<number, string>;
  water: Uint8Array;
  dzClearShare: number;
  /** Height above the ground of what stands on each class (trees, buildings, power line corridors), metres. */
  classH: Float32Array;
  pointH: Record<string, number>;
  lineH: Record<string, number>;
  nearM: number;
  existingKinds: string[];
  adRangeM: number;
  longDeg: number;
  flankDeg: [number, number];
  flankWithin: number;
  longBeyond: number;
  bottomBelowM: number;
  opWithinM: number;
  cost: {
    cellM: number;
    seen: number;
    obstruction: number;
    wire: number;
    bua: number;
    noData: number;
    valley: number;
    parallel: number;
    valleyDepthM: number;
    parallelDeg: number;
    observerReachM: number;
    landedM: number;
    alternates: number;
    detour: number;
    overlap: number;
  };
}

const num = (v: unknown, d: number): number => (Number.isFinite(Number(v)) ? Number(v) : d);
const flags = (list: unknown, d: number[]): Uint8Array => {
  const out = new Uint8Array(256);
  for (const c of (Array.isArray(list) ? list : d) as unknown[]) {
    const n = Number(c);
    if (Number.isInteger(n) && n >= 0 && n < 256) out[n] = 1;
  }
  return out;
};

/** The rules from `IpbDoctrine.json` (defaults where a figure is missing). */
export function airRulesFrom(doc: any): AirRules {
  const A = doc?.air ?? {};
  const band = (k: AirBand, lab: string, lo: number, hi: number) => ({ label: String(A.bands?.[k]?.label ?? lab), minM: num(A.bands?.[k]?.minM, lo), maxM: num(A.bands?.[k]?.maxM, hi) });
  const lp: Record<number, number> = {};
  const sz = A.landingPoints?.sizeM ?? { 1: 25, 2: 35, 3: 50, 4: 80, 5: 100, 6: 125 };
  for (const [k, v] of Object.entries(sz)) lp[Number(k)] = num(v, 80);
  const classH = new Float32Array(256);
  for (const [k, v] of Object.entries(A.obstructions?.classes ?? { 1: 12, 29: 10, 30: 10, 31: 15, 3: 8, 33: 20, 48: 20, 24: 3 })) {
    const c = Number(k);
    if (c >= 0 && c < 256) classH[c] = num(v, 0);
  }
  const why: Record<number, string> = {};
  for (const [k, v] of Object.entries(A.clear?.cautionClasses?.why ?? {})) why[Number(k)] = String(v);
  const hyd = doc?.coding?.hydrology ?? {};
  const water = [...(hyd.waterClasses?.value ?? [4, 6, 7, 20, 21, 22, 46]), ...(hyd.seasonalClasses?.value ?? [5])];
  const C = A.cost ?? {};
  const R = A.ad?.rules ?? {};
  return {
    bands: { noe: band('noe', 'NOE', 0, 8), contour: band('contour', 'Contour', 8, 24), low: band('low', 'Low level', 24, 61) },
    lpSizeM: lp,
    slopeOkDeg: num(A.slope?.okDeg, 7),
    slopeCautionDeg: num(A.slope?.cautionDeg, 15),
    mtnOkDeg: num(A.slope?.mountains?.okDeg, 4),
    mtnReliefM: 200,
    approachRatio: num(A.approach?.ratio, 10),
    dzW: num(A.dz?.widthM, 550),
    dzL: num(A.dz?.lengthM, 550),
    land: flags(A.clear?.landClasses, [0, 2, 12, 16, 17, 18, 23, 38]),
    caution: flags(A.clear?.cautionClasses?.value, [8, 13, 15, 19]),
    cautionWhy: why,
    water: flags(water, [4, 5, 6, 7, 20, 21, 22, 46]),
    dzClearShare: num(A.clear?.clearShare?.value, 0.9),
    classH,
    pointH: { mast: 40, wind_tower: 30, chimney: 40, tank_overhead: 20, watch_tower: 15, ...(A.obstructions?.points ?? {}) },
    lineH: { power_line: 20, ...(A.obstructions?.lines ?? {}) },
    nearM: num(A.obstructions?.nearM?.value, 300),
    existingKinds: Array.isArray(A.existing?.kinds) ? A.existing.kinds.map(String) : ['helipad', 'airfield', 'air_base', 'landing_strip', 'airport', 'landing_ground', 'runway', 'road_runway'],
    adRangeM: num(A.ad?.rangeM, 5000),
    longDeg: num(R.longDeg, 30),
    flankDeg: Array.isArray(R.flankDeg) ? [num(R.flankDeg[0], 60), num(R.flankDeg[1], 120)] : [60, 120],
    flankWithin: num(R.flankWithinFrac, 0.6),
    longBeyond: num(R.longBeyondFrac, 0.4),
    bottomBelowM: num(R.bottomBelowM, 20),
    opWithinM: num(A.heliborne?.opWithinM?.value, 3000),
    cost: {
      cellM: num(C.cellM, 150),
      seen: num(C.seen, 4),
      obstruction: num(C.obstruction, 2),
      wire: num(C.wire, 2),
      bua: num(C.bua, 1),
      noData: num(C.noData, 1),
      valley: num(C.valley, 0.85),
      parallel: num(C.parallel, 0.85),
      valleyDepthM: num(C.valleyDepthM, 15),
      parallelDeg: num(C.parallelDeg, 30),
      observerReachM: num(C.observerReachM, 6000),
      landedM: num(C.landedM, 4),
      alternates: num(C.alternates, 3),
      detour: num(C.detour, 1.6),
      overlap: num(C.overlap, 0.6),
    },
  };
}

/** The other side's eyes (grid pixels). */
export interface AirObserver {
  x: number;
  y: number;
  eyeM: number;
  /** How far it watches for aircraft, metres (capped at `cost.observerReachM`). */
  reachM: number;
  label: string;
}
/** A vertical obstruction (grid pixels); `heightM` null takes the kind's assumed height. */
export interface AirObstruction {
  x: number;
  y: number;
  kind: string;
  label: string;
  heightM: number | null;
}
/** A line feature (grid pixels): navigation along it (river, canal, railway, road) or a hazard (power line). */
export interface AirLine {
  kind: string;
  name: string | null;
  pts: Array<[number, number]>;
}
/** An existing helipad, airfield, landing ground or road runway (grid pixels). */
export interface AirExisting {
  x: number;
  y: number;
  kind: string;
  label: string;
  name: string | null;
}

export interface AirArgs {
  grid: OcokaGrid;
  rules: AirRules;
  /** The area read: the middle of its start edge (grid pixels), the direction of flight, its length and width. */
  frame: { sx: number; sy: number; axisDeg: number; lengthM: number; widthM: number };
  band: AirBand;
  /** Landing point size class 1-6 and the number of points in one LZ. */
  lzClass: number;
  lzPoints: number;
  observers: AirObserver[];
  obstructions: AirObstruction[];
  lines: AirLine[];
  existing: AirExisting[];
  /** Where LZ / DZ are looked for: distance along the area from its start edge, metres. */
  lzZone: { fromM: number; toM: number };
  /** Where AD sites are looked for (the side that defends against the air avenues), along the area; default all of it. */
  adZone?: { fromM: number; toM: number };
  /** The objective (grid pixels), or null. */
  objective: { x: number; y: number } | null;
  tables: SightTables | null;
  /** The LZs are the enemy's (behind own FDLs): find an OP over each. */
  enemyLz: boolean;
  maxLz?: number;
  maxDz?: number;
  maxAd?: number;
  /** Also work the DZ and AD sites out (default true). */
  dz?: boolean;
  ad?: boolean;
}

export interface AirLz {
  id: string;
  kind: 'lz' | 'dz';
  /** Centre, grid pixels; size of the square (an LZ: points laid one diameter apart), metres. */
  x: number;
  y: number;
  sideM: number;
  lengthM: number;
  points: number;
  slopeDeg: number;
  mountain: boolean;
  /** Slope over the limit but within the caution figure, or ground to land on with care. */
  caution: string[];
  /** Chance the other side sees it, 0-1 (0.5 or more in view, 0.2 may be; null: no other side's eyes in the area). */
  seenP: number | null;
  distObjM: number | null;
  /** Bearings (degrees) of the approach directions clear by 10 : 1. */
  approaches: number[];
  existing: string | null;
  alongM: number;
  score: number;
  rank: number;
  why: string;
  /** For the enemy's LZ: an OP over it (grid pixels), or null when none found. */
  op?: { x: number; y: number; distM: number; riseM: number } | null;
}
export interface AirProfilePt {
  alongM: number;
  groundM: number;
  /** The highest obstacle beside the way here: ground + its height. */
  topM: number;
  seen: boolean;
  crest: boolean;
}
export interface AirRoute {
  id: string;
  rank: number;
  /** Centre line, grid pixels, from the start edge to the LZ (or objective). */
  pts: Array<[number, number]>;
  to: string;
  lengthM: number;
  seenPct: number;
  valleyPct: number;
  parallelPct: number;
  buaPct: number;
  follows: Array<{ kind: string; name: string | null; lengthM: number }>;
  wires: number;
  obstructionsNear: Array<{ kind: string; label: string; heightM: number }>;
  cost: number;
  why: string;
  profile: AirProfilePt[];
}
export interface AirAdSite {
  id: string;
  x: number;
  y: number;
  seenM: number;
  longM: number;
  flankM: number;
  bottom: number;
  kinds: Array<'long' | 'flank' | 'bottom'>;
  routes: string[];
  score: number;
  rank: number;
  why: string;
}
export interface AirResult {
  band: AirBand;
  bandM: [number, number];
  lzSideM: number;
  /** Landing points per LZ used (1 when no LZ for the points asked for fits: single landing points). */
  lzPoints: number;
  routes: AirRoute[];
  lzs: AirLz[];
  dzs: AirLz[];
  ad: AirAdSite[];
  observers: number;
  notes: string[];
  ms: number;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const D2R = Math.PI / 180;
const EARTH_K = 6371000 / (1 - 0.13); // refraction-corrected earth radius

/** A binary min-heap of cell indices keyed by cost. */
class Heap {
  private k: Float64Array;
  private v: Int32Array;
  n = 0;
  constructor(cap: number) {
    this.k = new Float64Array(cap);
    this.v = new Int32Array(cap);
  }
  push(key: number, val: number): void {
    if (this.n >= this.k.length) {
      const k2 = new Float64Array(this.k.length * 2), v2 = new Int32Array(this.v.length * 2);
      k2.set(this.k);
      v2.set(this.v);
      this.k = k2;
      this.v = v2;
    }
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= key) break;
      this.k[i] = this.k[p];
      this.v[i] = this.v[p];
      i = p;
    }
    this.k[i] = key;
    this.v[i] = val;
  }
  pop(): [number, number] {
    const rk = this.k[0], rv = this.v[0];
    const lk = this.k[--this.n], lv = this.v[this.n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.n) break;
      if (c + 1 < this.n && this.k[c + 1] < this.k[c]) c++;
      if (this.k[c] >= lk) break;
      this.k[i] = this.k[c];
      this.v[i] = this.v[c];
      i = c;
    }
    this.k[i] = lk;
    this.v[i] = lv;
    return [rk, rv];
  }
}

/** Corner-cutting smoothing that keeps both ends. */
function chaikin(pts: Array<[number, number]>, iters: number): Array<[number, number]> {
  let p = pts;
  for (let it = 0; it < iters && p.length > 2; it++) {
    const q: Array<[number, number]> = [p[0]];
    for (let i = 0; i + 1 < p.length; i++) {
      const [ax, ay] = p[i], [bx, by] = p[i + 1];
      q.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

/** Terrain line of sight with obstacle heights (trees, buildings, masts as solid): true when nothing rises above the line. */
function losClear(g: OcokaGrid, H: Uint8Array, ax: number, ay: number, eyeM: number, bx: number, by: number, tgtM: number): boolean {
  const dx = bx - ax, dy = by - ay;
  const n = Math.ceil(Math.hypot(dx, dy));
  if (n < 2) return true;
  const w = g.w;
  const ia = Math.floor(ay) * w + Math.floor(ax), ib = Math.floor(by) * w + Math.floor(bx);
  const e0 = g.elev[ia], e1 = g.elev[ib];
  if (!(e0 === e0) || !(e1 === e1)) return false;
  const z0 = e0 + eyeM, z1 = e1 + tgtM;
  const D = n * g.res;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = Math.floor(ax + dx * t), y = Math.floor(ay + dy * t);
    const k = y * w + x;
    const e = g.elev[k];
    if (!(e === e)) continue;
    const d = t * D;
    if (e + H[k] + (d * (D - d)) / (2 * EARTH_K) > z0 + (z1 - z0) * t + 0.5) return false;
  }
  return true;
}

/** Air avenues, LZ / DZ, AD sites and flight profiles over the area read. */
export function airIpb(a: AirArgs): AirResult {
  const t0 = now();
  const g = a.grid, R = a.rules, C = R.cost;
  const { w, h, res } = g;
  const notes: string[] = [];
  const band = R.bands[a.band] ?? R.bands.contour;
  const lpD = R.lpSizeM[a.lzClass] ?? R.lpSizeM[4] ?? 80;
  const pts = Math.max(1, Math.round(a.lzPoints));
  const perSide = Math.ceil(Math.sqrt(pts));
  const lzSideM = perSide * lpD;
  const fr = a.frame;
  const ax = Math.sin(fr.axisDeg * D2R), ay = -Math.cos(fr.axisDeg * D2R); // along, grid pixels (y down)
  const rx = -ay, ry = ax; // right of the flight
  const alongOf = (x: number, y: number): number => ((x - fr.sx) * ax + (y - fr.sy) * ay) * res;
  const acrossOf = (x: number, y: number): number => ((x - fr.sx) * rx + (y - fr.sy) * ry) * res;
  const inFrame = (x: number, y: number, padM = 0): boolean => {
    const al = alongOf(x, y), ac = acrossOf(x, y);
    return al >= -padM && al <= fr.lengthM + padM && Math.abs(ac) <= fr.widthM / 2 + padM;
  };
  const inGrid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h;

  // ── obstacle heights per fine cell (classes, point obstructions, power lines) ──
  const H = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) H[i] = Math.min(255, R.classH[g.cls[i]] | 0);
  const obs = a.obstructions.map((o) => ({ ...o, heightM: o.heightM ?? R.pointH[o.kind] ?? 20 }));
  for (const o of obs) {
    const x0 = Math.floor(o.x), y0 = Math.floor(o.y);
    for (let v = -1; v <= 1; v++)
      for (let u = -1; u <= 1; u++) {
        const x = x0 + u, y = y0 + v;
        if (inGrid(x, y)) H[y * w + x] = Math.max(H[y * w + x], Math.min(255, Math.round(o.heightM)));
      }
  }
  const wires = a.lines.filter((l) => R.lineH[l.kind] !== undefined);
  for (const l of wires) {
    const hh = Math.min(255, Math.round(R.lineH[l.kind]));
    for (let i = 1; i < l.pts.length; i++) {
      const [x0, y0] = l.pts[i - 1], [x1, y1] = l.pts[i];
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2) + 1;
      for (let s = 0; s <= n; s++) {
        const x = Math.floor(x0 + ((x1 - x0) * s) / n), y = Math.floor(y0 + ((y1 - y0) * s) / n);
        if (inGrid(x, y)) H[y * w + x] = Math.max(H[y * w + x], hh);
      }
    }
  }

  // ── coarse grid over the area's bounding box ──
  const cs = C.cellM / res; // fine pixels per coarse cell
  const corners = [
    [0, -fr.widthM / 2],
    [0, fr.widthM / 2],
    [fr.lengthM, fr.widthM / 2],
    [fr.lengthM, -fr.widthM / 2],
  ].map(([al, ac]) => [fr.sx + (ax * al + rx * ac) / res, fr.sy + (ay * al + ry * ac) / res]);
  const X0 = Math.min(...corners.map((c) => c[0])), Y0 = Math.min(...corners.map((c) => c[1]));
  const W = Math.max(2, Math.ceil((Math.max(...corners.map((c) => c[0])) - X0) / cs) + 1);
  const Hc = Math.max(2, Math.ceil((Math.max(...corners.map((c) => c[1])) - Y0) / cs) + 1);
  const N = W * Hc;
  const cxOf = (i: number): number => X0 + ((i % W) + 0.5) * cs;
  const cyOf = (i: number): number => Y0 + (Math.floor(i / W) + 0.5) * cs;
  const cellOf = (x: number, y: number): number => {
    const i = Math.floor((x - X0) / cs), j = Math.floor((y - Y0) / cs);
    return i < 0 || j < 0 || i >= W || j >= Hc ? -1 : j * W + i;
  };
  const inside = new Uint8Array(N);
  const elevC = new Float32Array(N).fill(NaN);
  const buaC = new Float32Array(N);
  const noData = new Uint8Array(N);
  const wireC = new Uint8Array(N);
  const nearObs = new Uint8Array(N);
  const parC = new Uint8Array(N);
  const valley = new Uint8Array(N);
  const followC = new Map<number, number[]>(); // cell -> parallel line indices
  for (let i = 0; i < N; i++) {
    const cx = cxOf(i), cy = cyOf(i);
    if (inFrame(cx, cy)) inside[i] = 1;
    let s = 0, n = 0, b = 0, all = 0, wr = 0;
    const xa = Math.max(0, Math.floor(cx - cs / 2)), xb = Math.min(w - 1, Math.ceil(cx + cs / 2) - 1);
    const ya = Math.max(0, Math.floor(cy - cs / 2)), yb = Math.min(h - 1, Math.ceil(cy + cs / 2) - 1);
    for (let y = ya; y <= yb; y++)
      for (let x = xa; x <= xb; x++) {
        const k = y * w + x;
        all++;
        const e = g.elev[k];
        if (e === e) ((s += e), n++);
        const c = g.cls[k];
        if (c === 3) b++;
        if (c === 33 || c === 48) wr++;
      }
    if (n) elevC[i] = s / n;
    if (!all || n < all / 2) noData[i] = 1;
    buaC[i] = all ? b / all : 0;
    if (wr) wireC[i] = 1;
  }
  // Valleys: lower than the ground 1 km round by the depth figure.
  const rr = Math.max(2, Math.round(1000 / C.cellM));
  for (let j = 0; j < Hc; j++)
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const e = elevC[k];
      if (!(e === e)) continue;
      let s = 0, n = 0;
      for (let d = 0; d < 8; d++) {
        const u = Math.round(Math.cos((d * Math.PI) / 4) * rr), v = Math.round(Math.sin((d * Math.PI) / 4) * rr);
        const ii = i + u, jj = j + v;
        if (ii < 0 || jj < 0 || ii >= W || jj >= Hc) continue;
        const e2 = elevC[jj * W + ii];
        if (e2 === e2) ((s += e2), n++);
      }
      if (n >= 4 && e < s / n - C.valleyDepthM) valley[k] = 1;
    }
  // Lines: parallel navigation features, wires.
  const cosPar = Math.cos(C.parallelDeg * D2R);
  a.lines.forEach((l, li) => {
    const wire = R.lineH[l.kind] !== undefined;
    for (let i = 1; i < l.pts.length; i++) {
      const [x0, y0] = l.pts[i - 1], [x1, y1] = l.pts[i];
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (!len) continue;
      const par = Math.abs(((x1 - x0) * ax + (y1 - y0) * ay) / len) >= cosPar;
      const n = Math.ceil(len / (cs / 2)) + 1;
      for (let s = 0; s <= n; s++) {
        const k = cellOf(x0 + ((x1 - x0) * s) / n, y0 + ((y1 - y0) * s) / n);
        if (k < 0) continue;
        if (wire) wireC[k] = 1;
        else if (par) {
          parC[k] = 1;
          const f = followC.get(k);
          if (!f) followC.set(k, [li]);
          else if (!f.includes(li)) f.push(li);
        }
      }
    }
  });
  const nr = Math.max(1, Math.round(R.nearM / C.cellM));
  for (const o of obs) {
    const k = cellOf(o.x, o.y);
    if (k < 0) continue;
    const i0 = k % W, j0 = Math.floor(k / W);
    for (let v = -nr; v <= nr; v++)
      for (let u = -nr; u <= nr; u++) {
        if (u * u + v * v > nr * nr) continue;
        const i = i0 + u, j = j0 + v;
        if (i >= 0 && j >= 0 && i < W && j < Hc) nearObs[j * W + i] = 1;
      }
  }

  // ── exposure: the chance the other side sees an aircraft at the top of the band (never understated) ──
  const expo = new Float32Array(N); // 1 - prod(1 - p)
  const eyes = a.observers.filter((o) => inGrid(Math.floor(o.x), Math.floor(o.y)) && inFrame(o.x, o.y, Math.min(o.reachM, C.observerReachM)));
  if (eyes.length) {
    const miss = new Float32Array(N).fill(1);
    for (const o of eyes) {
      const radiusM = Math.min(C.observerReachM, Math.max(500, o.reachM));
      const stepDeg = Math.max(0.5, fineStep(radiusM, res));
      const bearings = bearingsFor(stepDeg);
      const steps = Math.max(1, Math.floor(radiusM / res));
      const trace = new Uint8Array(bearings.length * steps);
      analyseSight(g, o.x, o.y, bearings, { eyeM: o.eyeM, targetM: band.maxM, tolM: 1, tables: a.tables, going: null, effM: radiusM, radiusM: steps * res + 0.001, trace });
      const real = 360 / bearings.length;
      for (let k = 0; k < N; k++) {
        if (!inside[k]) continue;
        const dx = cxOf(k) - o.x, dy = cyOf(k) - o.y;
        const s = Math.round(Math.hypot(dx, dy));
        if (s < 1 || s > steps) continue;
        const r = Math.round(((Math.atan2(dx, -dy) / D2R + 360) % 360) / real) % bearings.length;
        const p = trace[r * steps + s - 1];
        if (p !== 255) miss[k] *= 1 - p / 250;
      }
    }
    for (let k = 0; k < N; k++) expo[k] = 1 - miss[k];
  } else notes.push("No other side's Posns in reach of the area: concealment from ground observation not judged; the air avenues follow valleys and features only.");

  // ── cost field and least-cost ways ──
  const cost = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    if (!inside[k]) {
      cost[k] = Infinity;
      continue;
    }
    const base = 1 + C.seen * expo[k] + (nearObs[k] ? C.obstruction : 0) + (wireC[k] ? C.wire : 0) + C.bua * buaC[k] + (noData[k] ? C.noData : 0);
    cost[k] = base * (valley[k] ? C.valley : 1) * (parC[k] ? C.parallel : 1);
  }
  const sources: number[] = [];
  for (let k = 0; k < N; k++) if (inside[k] && alongOf(cxOf(k), cyOf(k)) <= C.cellM) sources.push(k);
  const field = (cst: Float32Array): { dist: Float64Array; prev: Int32Array } => {
    const dist = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const heap = new Heap(Math.max(64, sources.length * 4));
    for (const s of sources) {
      dist[s] = 0;
      heap.push(0, s);
    }
    while (heap.n) {
      const [d, k] = heap.pop();
      if (d > dist[k]) continue;
      const i = k % W, j = Math.floor(k / W);
      for (let v = -1; v <= 1; v++)
        for (let u = -1; u <= 1; u++) {
          if (!u && !v) continue;
          const ii = i + u, jj = j + v;
          if (ii < 0 || jj < 0 || ii >= W || jj >= Hc) continue;
          const q = jj * W + ii;
          const c2 = cst[q];
          if (c2 === Infinity) continue;
          const nd = d + ((cst[k] + c2) / 2) * (u && v ? Math.SQRT2 : 1);
          if (nd < dist[q]) {
            dist[q] = nd;
            prev[q] = k;
            heap.push(nd, q);
          }
        }
    }
    return { dist, prev };
  };
  const nearestInside = (x: number, y: number): number => {
    let k = cellOf(x, y);
    if (k >= 0 && inside[k]) return k;
    let best = -1, bd = Infinity;
    for (let q = 0; q < N; q++) {
      if (!inside[q]) continue;
      const d = (cxOf(q) - x) ** 2 + (cyOf(q) - y) ** 2;
      if (d < bd) ((bd = d), (best = q));
    }
    return best;
  };

  // ── fine slope, flags and LZ / DZ squares ──
  const slopeAt = (x: number, y: number): number => {
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return NaN;
    const e = g.elev;
    const dzx = (e[y * w + x + 1] - e[y * w + x - 1]) / (2 * res);
    const dzy = (e[(y + 1) * w + x] - e[(y - 1) * w + x]) / (2 * res);
    return Math.atan(Math.hypot(dzx, dzy)) / D2R;
  };
  const reliefAt = (x: number, y: number): number => {
    let lo = Infinity, hi = -Infinity;
    for (const rM of [0, 500, 1000])
      for (let d = 0; d < (rM ? 12 : 1); d++) {
        const xx = Math.floor(x + (Math.cos((d * Math.PI) / 6) * rM) / res), yy = Math.floor(y + (Math.sin((d * Math.PI) / 6) * rM) / res);
        if (!inGrid(xx, yy)) continue;
        const e = g.elev[yy * w + xx];
        if (e === e) ((lo = Math.min(lo, e)), (hi = Math.max(hi, e)));
      }
    return hi >= lo ? hi - lo : 0;
  };
  const objective = a.objective;
  const distObj = (x: number, y: number): number | null => (objective ? Math.hypot(x - objective.x, y - objective.y) * res : null);
  // Zone box (grid pixels).
  const zc = [
    [a.lzZone.fromM, -fr.widthM / 2],
    [a.lzZone.fromM, fr.widthM / 2],
    [a.lzZone.toM, fr.widthM / 2],
    [a.lzZone.toM, -fr.widthM / 2],
  ].map(([al, ac]) => [fr.sx + (ax * al + rx * ac) / res, fr.sy + (ay * al + ry * ac) / res]);
  const zx0 = Math.max(1, Math.floor(Math.min(...zc.map((c) => c[0])))), zx1 = Math.min(w - 2, Math.ceil(Math.max(...zc.map((c) => c[0]))));
  const zy0 = Math.max(1, Math.floor(Math.min(...zc.map((c) => c[1])))), zy1 = Math.min(h - 2, Math.ceil(Math.max(...zc.map((c) => c[1]))));
  const zw = Math.max(0, zx1 - zx0 + 1), zh = Math.max(0, zy1 - zy0 + 1);
  // Summed-area tables: blocked, water, caution cells.
  const sat = (test: (c: number, k: number) => boolean): Int32Array => {
    const s = new Int32Array((zw + 1) * (zh + 1));
    for (let y = 0; y < zh; y++) {
      let row = 0;
      for (let x = 0; x < zw; x++) {
        const k = (zy0 + y) * w + zx0 + x;
        if (test(g.cls[k], k)) row++;
        s[(y + 1) * (zw + 1) + x + 1] = s[y * (zw + 1) + x + 1] + row;
      }
    }
    return s;
  };
  const sum = (s: Int32Array, x0: number, y0: number, x1: number, y1: number): number => {
    // inclusive grid-pixel box, clipped to the zone
    const a0 = Math.max(0, x0 - zx0), b0 = Math.max(0, y0 - zy0), a1 = Math.min(zw - 1, x1 - zx0), b1 = Math.min(zh - 1, y1 - zy0);
    if (a1 < a0 || b1 < b0) return 0;
    const W1 = zw + 1;
    return s[(b1 + 1) * W1 + a1 + 1] - s[b0 * W1 + a1 + 1] - s[(b1 + 1) * W1 + a0] + s[b0 * W1 + a0];
  };
  const S_block = zw && zh ? sat((c, k) => (!R.land[c] && !R.caution[c]) || !(g.elev[k] === g.elev[k])) : new Int32Array(1);
  const S_water = zw && zh ? sat((c) => !!R.water[c]) : new Int32Array(1);
  const S_caut = zw && zh ? sat((c) => !!R.caution[c]) : new Int32Array(1);
  const existing = a.existing.filter((e) => inGrid(Math.floor(e.x), Math.floor(e.y)));
  const dirs8 = [0, 45, 90, 135, 180, 225, 270, 315];
  // Directions clear by 10 : 1 from a square (centre and half-extents in grid pixels). The distance to an obstacle is
  // read every half pixel from the square's edge and taken half a pixel short (never overstating the clearance).
  const approachesOf = (cx: number, cy: number, halfW: number, halfL: number): number[] => {
    const out: number[] = [];
    let maxH = 0;
    for (const v of Object.values(R.pointH)) maxH = Math.max(maxH, v);
    for (const v of R.classH) maxH = Math.max(maxH, v);
    const reach = (maxH * R.approachRatio) / res;
    for (const b of dirs8) {
      const dx = Math.sin(b * D2R), dy = -Math.cos(b * D2R);
      const px = -dy, py = dx;
      const edge = Math.abs(dx) * halfW + Math.abs(dy) * halfL; // half-extent of the square along the direction (roughly)
      let clear = true;
      for (const off of [-1, 0, 1]) {
        const ox = cx + px * off * halfW * 0.9, oy = cy + py * off * halfW * 0.9;
        for (let t = 0.5; t <= reach + 1 && clear; t += 0.5) {
          const x = Math.floor(ox + dx * (edge + t)), y = Math.floor(oy + dy * (edge + t));
          if (!inGrid(x, y)) break;
          const hh = H[y * w + x];
          if (hh && (t - 0.5) * res < hh * R.approachRatio) clear = false;
        }
        if (!clear) break;
      }
      if (clear) out.push(b);
    }
    return out;
  };
  interface Cand { x: number; y: number; slope: number; mountain: boolean; caution: string[]; approaches: number[]; existing: string | null; pre: number; along: number }
  const squares = (kind: 'lz' | 'dz', sideM: number, lengthM: number): Cand[] => {
    if (!zw || !zh) return [];
    const nW = Math.max(1, Math.ceil(sideM / res)), nL = Math.max(1, Math.ceil(lengthM / res));
    const step = Math.max(1, Math.floor(Math.min(nW, nL) / 2));
    const out: Cand[] = [];
    const inZone = (cx: number, cy: number): boolean => {
      const al = alongOf(cx, cy);
      return al >= a.lzZone.fromM && al <= a.lzZone.toM && Math.abs(acrossOf(cx, cy)) <= fr.widthM / 2;
    };
    // Judge one square (top-left x, y in grid pixels); an existing site is never dropped, only cautioned.
    const judge = (x: number, y: number, ex: AirExisting | null): Cand | null => {
      const cx = ex ? ex.x : x + nW / 2, cy = ex ? ex.y : y + nL / 2;
      const all = nW * nL;
      const blocked = sum(S_block, x, y, x + nW - 1, y + nL - 1);
      if (!ex && (kind === 'lz' ? blocked > 0 : blocked > all * (1 - R.dzClearShare) || sum(S_water, x, y, x + nW - 1, y + nL - 1) > 0)) return null;
      // Slope: the 90th percentile of the cells.
      const sl: number[] = [];
      for (let v = 0; v < nL; v++) for (let u = 0; u < nW; u++) sl.push(slopeAt(x + u, y + v));
      const ok = sl.filter((q) => q === q).sort((p, q) => p - q);
      if (!ok.length && !ex) return null;
      const s90 = ok.length ? ok[Math.min(ok.length - 1, Math.floor(ok.length * 0.9))] : 0;
      if (s90 > R.slopeCautionDeg && !ex) return null;
      const mountain = reliefAt(cx, cy) >= R.mtnReliefM;
      const okDeg = mountain ? R.mtnOkDeg : R.slopeOkDeg;
      const caution: string[] = [];
      if (s90 > okDeg) caution.push(`slope ${s90.toFixed(0)}° (over ${okDeg}°${mountain ? ' in mountains, MW p 256' : ''}): land upslope, check on the ground`);
      const nc = sum(S_caut, x, y, x + nW - 1, y + nL - 1);
      if (nc) {
        const seen = new Set<number>();
        for (let v = 0; v < nL; v++)
          for (let u = 0; u < nW; u++) {
            const xx = x + u, yy = y + v;
            if (!inGrid(xx, yy)) continue;
            const c = g.cls[yy * w + xx];
            if (R.caution[c]) seen.add(c);
          }
        for (const c of seen) caution.push(R.cautionWhy[c] ?? `class ${c}`);
      }
      if (ex) caution.push(blocked > 0 ? 'existing site: the bundle shows obstacles on it, check it on the ground' : 'existing site: its size and state not recorded, check it');
      const app = approachesOf(cx, cy, nW / 2, nL / 2);
      if (!app.length && !ex) return null; // no approach clear by 10 : 1
      const opp = app.some((b) => app.includes((b + 180) % 360));
      const d = distObj(cx, cy);
      // A slope over the limit ranks below every LZ within it (safety first: land where no care is needed).
      const pre = 2 * Math.max(0, (R.slopeCautionDeg - s90) / R.slopeCautionDeg) + 2 * (app.length / 8) + (opp ? 1 : 0) + (d === null ? 0 : 3 * (1 - Math.min(1, d / 8000))) - 2 * (nc / all) - (s90 > okDeg ? 4 : 0) + (ex ? 6 : 0);
      return { x: cx, y: cy, slope: s90, mountain, caution, approaches: app, existing: ex ? `${ex.label}${ex.name ? ` ${ex.name}` : ''}` : null, pre, along: alongOf(cx, cy) };
    };
    for (let y = zy0; y + nL <= zy1; y += step)
      for (let x = zx0; x + nW <= zx1; x += step) {
        if (!inZone(x + nW / 2, y + nL / 2)) continue;
        const c = judge(x, y, null);
        if (c) out.push(c);
      }
    // Existing helipads, airfields, landing grounds and road runways in the zone first (IPB_Plan §6.4), placed on the site.
    if (kind === 'lz')
      for (const e of existing) {
        if (!inZone(e.x, e.y)) continue;
        const c = judge(Math.floor(e.x - nW / 2), Math.floor(e.y - nL / 2), e);
        if (c) out.push(c);
      }
    return out;
  };
  const shortlist = (cands: Cand[], sepM: number, max: number): Cand[] => {
    const out: Cand[] = [];
    for (const c of cands.sort((p, q) => q.pre - p.pre)) {
      if (out.some((o) => Math.hypot(o.x - c.x, o.y - c.y) * res < sepM)) continue;
      out.push(c);
      if (out.length >= max) break;
    }
    return out;
  };
  // The chance the other side sees a square's middle (something `tgtM` tall): the Extended View's sight, crops, trees and
  // buildings as a chance (never trees as solid walls, which would overstate concealment). Null: no eyes to judge by.
  const seenP = (x: number, y: number, tgtM: number): number | null => {
    const near = eyes.filter((o) => Math.hypot(o.x - x, o.y - y) * res <= Math.min(C.observerReachM, Math.max(500, o.reachM)));
    if (!near.length) return eyes.length ? 0 : null;
    let miss = 1;
    for (const o of near) {
      const r = sightTo(g, o.x, o.y, x, y, { eyeM: o.eyeM, targetM: tgtM, tolM: 1, tables: a.tables, going: null, effM: 0, radiusM: 0 });
      if (r) miss *= 1 - r.p;
    }
    return Math.round((1 - miss) * 100) / 100;
  };
  const finish = (kind: 'lz' | 'dz', cands: Cand[], sideM: number, lengthM: number, max: number, points = pts): AirLz[] => {
    const list = shortlist(cands, kind === 'lz' ? 1200 : 1500, 40).map((c) => {
      const sp = seenP(c.x, c.y, kind === 'lz' ? C.landedM : 1.7);
      return { c, sp, score: c.pre + (sp === null ? 0 : 4 * (1 - sp)) };
    });
    list.sort((p, q) => q.score - p.score);
    return list.slice(0, max).map((e, i) => {
      const c = e.c;
      const d = distObj(c.x, c.y);
      const bits: string[] = [];
      if (c.existing) bits.push(c.existing);
      bits.push(`slope ${c.slope.toFixed(0)}°`);
      bits.push(e.sp === null ? 'concealment not judged' : e.sp >= 0.5 ? 'in view of the other side' : e.sp >= 0.2 ? 'may be seen by the other side' : 'hidden from the other side');
      if (d !== null) bits.push(`${(d / 1000).toFixed(1)} km from the Obj`);
      bits.push(c.approaches.length ? `${c.approaches.length} of 8 approaches clear` : 'no clear approach by 10 : 1');
      return {
        id: `${kind === 'lz' ? 'LZ' : 'DZ'} ${i + 1}`,
        kind,
        x: c.x,
        y: c.y,
        sideM,
        lengthM,
        points: kind === 'lz' ? points : 0,
        slopeDeg: c.slope,
        mountain: c.mountain,
        caution: c.caution,
        seenP: e.sp,
        distObjM: d,
        approaches: c.approaches,
        existing: c.existing,
        alongM: c.along,
        score: Math.round(e.score * 10) / 10,
        rank: i + 1,
        why: bits.join(' · '),
      };
    });
  };
  let lzPts = pts, lzSide = lzSideM;
  let lzs = finish('lz', squares('lz', lzSide, lzSide), lzSide, lzSide, a.maxLz ?? 5);
  if (!lzs.length && pts > 1) {
    // No room for all the points: single landing points (in mountains helipads are single, MW p 256).
    const one = finish('lz', squares('lz', lpD, lpD), lpD, lpD, a.maxLz ?? 5, 1);
    if (one.length) {
      lzs = one;
      lzPts = 1;
      lzSide = lpD;
      notes.push(`No LZ for ${pts} landing points of ${lpD} m in the zone: single landing points shown (one helicopter each; helipads in mountains are single, MW p 256).`);
    }
  }
  const dzs = a.dz === false ? [] : finish('dz', squares('dz', R.dzW, R.dzL), R.dzW, R.dzL, a.maxDz ?? 3);
  if (!lzs.length) notes.push(`No LZ for ${pts > 1 ? `${pts} landing points or one` : 'one landing point'} of ${lpD} m (size ${a.lzClass}) in the zone: clear ground, slope and approaches all fail.`);

  // OPs over the enemy's LZs: the highest ground within reach that sees it.
  if (a.enemyLz)
    for (const z of lzs) {
      const r = R.opWithinM / res;
      const st = Math.max(1, Math.round(150 / res));
      const cand: Array<{ x: number; y: number; e: number }> = [];
      for (let v = -r; v <= r; v += st)
        for (let u = -r; u <= r; u += st) {
          if (u * u + v * v > r * r || u * u + v * v < (300 / res) ** 2) continue;
          const x = Math.floor(z.x + u), y = Math.floor(z.y + v);
          if (!inGrid(x, y)) continue;
          const k = y * w + x;
          const e = g.elev[k];
          if (!(e === e) || R.water[g.cls[k]]) continue;
          cand.push({ x, y, e });
        }
      cand.sort((p, q) => q.e - p.e);
      const ez = g.elev[Math.floor(z.y) * w + Math.floor(z.x)];
      let op: AirLz['op'] = null;
      for (const c of cand.slice(0, 80)) {
        if (losClear(g, H, c.x + 0.5, c.y + 0.5, 1.6, z.x, z.y, C.landedM)) {
          op = { x: c.x + 0.5, y: c.y + 0.5, distM: Math.round(Math.hypot(c.x - z.x, c.y - z.y) * res), riseM: Math.round(c.e - (ez === ez ? ez : c.e)) };
          break;
        }
      }
      z.op = op;
    }

  // ── air avenues to the LZs (else the objective, else the far end) ──
  const targets: Array<{ x: number; y: number; to: string }> = lzs.slice(0, 3).map((z) => ({ x: z.x, y: z.y, to: z.id }));
  if (!targets.length) {
    if (objective && inFrame(objective.x, objective.y)) targets.push({ x: objective.x, y: objective.y, to: 'Obj' });
    else targets.push({ x: fr.sx + (ax * (fr.lengthM - C.cellM)) / res, y: fr.sy + (ay * (fr.lengthM - C.cellM)) / res, to: 'far end' });
  }
  const base = field(cost);
  const pathTo = (f: { prev: Int32Array; dist: Float64Array }, k: number): number[] => {
    const p: number[] = [];
    for (let q = k, guard = 0; q >= 0 && guard < N; q = f.prev[q], guard++) p.push(q);
    return p.reverse();
  };
  const realCost = (p: number[]): number => {
    let s = 0;
    for (let i = 1; i < p.length; i++) {
      const a0 = p[i - 1], b0 = p[i];
      const diag = a0 % W !== b0 % W && Math.floor(a0 / W) !== Math.floor(b0 / W);
      s += ((cost[a0] + cost[b0]) / 2) * (diag ? Math.SQRT2 : 1);
    }
    return s;
  };
  const near = new Uint8Array(N); // within 500 m of a way kept
  const wide = new Uint8Array(N); // within 1 km
  const mark = (p: number[]): void => {
    const r5 = Math.max(1, Math.round(500 / C.cellM)), r10 = Math.max(2, Math.round(1000 / C.cellM));
    for (const k of p) {
      const i0 = k % W, j0 = Math.floor(k / W);
      for (let v = -r10; v <= r10; v++)
        for (let u = -r10; u <= r10; u++) {
          const i = i0 + u, j = j0 + v;
          if (i < 0 || j < 0 || i >= W || j >= Hc) continue;
          const d2 = u * u + v * v;
          if (d2 <= r10 * r10) wide[j * W + i] = 1;
          if (d2 <= r5 * r5) near[j * W + i] = 1;
        }
    }
  };
  const overlapOf = (p: number[]): number => (p.length ? p.filter((k) => near[k]).length / p.length : 0);
  const ways: Array<{ path: number[]; to: { x: number; y: number; to: string }; cost: number; ti: number }> = [];
  let bestCost = Infinity;
  for (const [ti, t] of targets.entries()) {
    const k = nearestInside(t.x, t.y);
    if (k < 0 || !Number.isFinite(base.dist[k])) continue;
    let p = pathTo(base, k);
    if (ways.length && overlapOf(p) > C.overlap) {
      const pen = new Float32Array(N);
      for (let q = 0; q < N; q++) pen[q] = cost[q] === Infinity ? Infinity : cost[q] * (1 + 3 * wide[q]);
      const f2 = field(pen);
      if (!Number.isFinite(f2.dist[k])) continue;
      p = pathTo(f2, k);
      if (overlapOf(p) > C.overlap) continue;
    }
    const rc = realCost(p);
    if (ways.length && rc > C.detour * bestCost) continue;
    bestCost = Math.min(bestCost, rc);
    ways.push({ path: p, to: t, cost: rc, ti });
    mark(p);
  }
  // Alternates to the first target while fewer than the figure.
  const first = targets[0];
  for (let guard = 0; ways.length && ways.length < Math.min(3, C.alternates) && guard < 3; guard++) {
    const k = nearestInside(first.x, first.y);
    const pen = new Float32Array(N);
    for (let q = 0; q < N; q++) pen[q] = cost[q] === Infinity ? Infinity : cost[q] * (1 + 3 * wide[q]);
    const f2 = field(pen);
    if (k < 0 || !Number.isFinite(f2.dist[k])) break;
    const p = pathTo(f2, k);
    const rc = realCost(p);
    if (overlapOf(p) > C.overlap || rc > C.detour * bestCost) break;
    ways.push({ path: p, to: first, cost: rc, ti: 0 });
    mark(p);
  }
  // By cost; a way to a better LZ goes first when within 5 % a rank.
  ways.sort((p, q) => p.cost * (1 + 0.05 * p.ti) - q.cost * (1 + 0.05 * q.ti));

  const lineName = (li: number): { kind: string; name: string | null } => ({ kind: a.lines[li].kind, name: a.lines[li].name });
  const routes: AirRoute[] = ways.map((wy, i) => {
    const p = wy.path;
    let len = 0, seen = 0, vall = 0, par = 0, bua = 0, wireN = 0;
    const fol = new Map<string, { kind: string; name: string | null; lengthM: number }>();
    for (let s = 0; s < p.length; s++) {
      const k = p[s];
      const step = s ? (p[s - 1] % W !== k % W && Math.floor(p[s - 1] / W) !== Math.floor(k / W) ? Math.SQRT2 : 1) * C.cellM : C.cellM / 2;
      len += step;
      if (expo[k] >= 0.5) seen += step;
      if (valley[k]) vall += step;
      if (parC[k]) par += step;
      bua += buaC[k] * step;
      if (wireC[k] && (!s || !wireC[p[s - 1]])) wireN++;
      for (const li of followC.get(k) ?? []) {
        const ln = lineName(li);
        const key = `${ln.kind}|${ln.name ?? ''}`;
        const f = fol.get(key);
        if (f) f.lengthM += step;
        else fol.set(key, { ...ln, lengthM: step });
      }
    }
    const coarse: Array<[number, number]> = p.map((k) => [cxOf(k), cyOf(k)]);
    coarse.push([wy.to.x, wy.to.y]);
    const line = chaikin(simplifyLine(coarse, cs * 0.75), 2);
    const near2: AirRoute['obstructionsNear'] = [];
    for (const o of obs) {
      let bd = Infinity;
      for (const [x, y] of line) bd = Math.min(bd, Math.hypot(x - o.x, y - o.y) * res);
      if (bd <= R.nearM) near2.push({ kind: o.kind, label: o.label, heightM: o.heightM });
    }
    // Profile every 150 m along the smoothed line.
    const prof: AirProfilePt[] = [];
    let along = 0;
    const stepPx = 150 / res;
    let carry = 0;
    for (let s = 1; s < line.length; s++) {
      const [x0, y0] = line[s - 1], [x1, y1] = line[s];
      const L = Math.hypot(x1 - x0, y1 - y0);
      for (let t = carry; t < L; t += stepPx) {
        const x = x0 + ((x1 - x0) * t) / L, y = y0 + ((y1 - y0) * t) / L;
        const xi = Math.floor(x), yi = Math.floor(y);
        if (!inGrid(xi, yi)) continue;
        const e = g.elev[yi * w + xi];
        let top = 0;
        for (let v = -2; v <= 2; v++)
          for (let u = -2; u <= 2; u++) {
            const xx = xi + u, yy = yi + v;
            if (inGrid(xx, yy)) top = Math.max(top, H[yy * w + xx]);
          }
        const k = cellOf(x, y);
        prof.push({ alongM: Math.round(along + t * res), groundM: e === e ? Math.round(e) : NaN, topM: e === e ? Math.round(e + top) : NaN, seen: k >= 0 && expo[k] >= 0.5, crest: false });
      }
      carry = (((carry - L) % stepPx) + stepPx) % stepPx;
      along += L * res;
    }
    // Crests: higher than the way 600 m either side and 15 m over the lowest within 1 km.
    const n6 = Math.round(600 / 150), n10 = Math.round(1000 / 150);
    for (let s = 0; s < prof.length; s++) {
      const e = prof[s].groundM;
      if (!(e === e)) continue;
      let hi = true, lo = e;
      for (let d = -n10; d <= n10; d++) {
        const q = prof[s + d];
        if (!q || !(q.groundM === q.groundM)) continue;
        if (Math.abs(d) <= n6 && d && q.groundM > e) hi = false;
        lo = Math.min(lo, q.groundM);
      }
      prof[s].crest = hi && e - lo >= 15;
    }
    const follows = [...fol.values()].filter((f) => f.lengthM >= 1000).sort((p2, q2) => q2.lengthM - p2.lengthM);
    const bits: string[] = [`${(len / 1000).toFixed(1)} km`, eyes.length ? `${Math.round((100 * seen) / Math.max(1, len))} % in view` : 'concealment not judged'];
    if (follows.length) bits.push(`along ${follows.slice(0, 2).map((f) => `${f.name ?? f.kind.replace(/_/g, ' ')} ${(f.lengthM / 1000).toFixed(1)} km`).join(', ')}`);
    if (vall >= 0.15 * len) bits.push(`valleys ${Math.round((100 * vall) / len)} %`);
    if (wireN) bits.push(`${wireN} power line${wireN > 1 ? 's' : ''} crossed`);
    if (near2.length) bits.push(`${near2.length} obstruction${near2.length > 1 ? 's' : ''} within ${R.nearM} m`);
    if (bua >= 0.1 * len) bits.push(`over BUA ${Math.round((100 * bua) / len)} %`);
    return {
      id: String(i + 1),
      rank: i + 1,
      pts: line,
      to: wy.to.to,
      lengthM: Math.round(len),
      seenPct: eyes.length ? (100 * seen) / Math.max(1, len) : 0,
      valleyPct: (100 * vall) / Math.max(1, len),
      parallelPct: (100 * par) / Math.max(1, len),
      buaPct: (100 * bua) / Math.max(1, len),
      follows,
      wires: wireN,
      obstructionsNear: near2,
      cost: Math.round(wy.cost * 10) / 10,
      why: bits.join(' · '),
      profile: prof,
    };
  });
  if (!routes.length) notes.push('No air avenue found: the area read has no open way from its start edge.');

  // ── AD sites against the air avenues ──
  const ad: AirAdSite[] = [];
  if (a.ad !== false && routes.length) {
    const tgt = Math.max(5, band.minM);
    const sampStep = 400 / res;
    const S: Array<{ x: number; y: number; dx: number; dy: number; e: number; crest: boolean; route: string }> = [];
    for (const r of routes) {
      const line = r.pts;
      let carry = 0;
      const startN = S.length;
      for (let s = 1; s < line.length; s++) {
        const [x0, y0] = line[s - 1], [x1, y1] = line[s];
        const L = Math.hypot(x1 - x0, y1 - y0);
        if (!L) continue;
        for (let t = carry; t < L; t += sampStep) {
          const x = x0 + ((x1 - x0) * t) / L, y = y0 + ((y1 - y0) * t) / L;
          const xi = Math.floor(x), yi = Math.floor(y);
          if (!inGrid(xi, yi)) continue;
          S.push({ x, y, dx: (x1 - x0) / L, dy: (y1 - y0) / L, e: g.elev[yi * w + xi], crest: false, route: r.id });
        }
        carry = (((carry - L) % sampStep) + sampStep) % sampStep;
      }
      // Crests along this avenue: higher than the samples 800 m either side and 15 m over the lowest within 1.2 km.
      for (let s = startN; s < S.length; s++) {
        const q = S[s];
        const e = q.e;
        if (!(e === e)) continue;
        let hi = true, lo = e;
        for (let d = -3; d <= 3; d++) {
          const o = S[s + d];
          if (!o || o.route !== q.route || !(o.e === o.e)) continue;
          if (Math.abs(d) <= 2 && d && o.e > e) hi = false;
          lo = Math.min(lo, o.e);
        }
        q.crest = hi && e - lo >= 15;
      }
    }
    const rng = R.adRangeM / res;
    const st = Math.max(1, Math.round(500 / res));
    const cosLong = Math.cos(R.longDeg * D2R);
    const cosF0 = Math.cos(R.flankDeg[0] * D2R), cosF1 = Math.cos(R.flankDeg[1] * D2R);
    const cands: AirAdSite[] = [];
    const bx0 = Math.max(1, Math.floor(Math.min(...corners.map((c) => c[0])))), bx1 = Math.min(w - 2, Math.ceil(Math.max(...corners.map((c) => c[0]))));
    const by0 = Math.max(1, Math.floor(Math.min(...corners.map((c) => c[1])))), by1 = Math.min(h - 2, Math.ceil(Math.max(...corners.map((c) => c[1]))));
    for (let y = by0; y <= by1; y += st)
      for (let x = bx0; x <= bx1; x += st) {
        const cx = x + 0.5, cy = y + 0.5;
        if (!inFrame(cx, cy)) continue;
        if (a.adZone) {
          const al = alongOf(cx, cy);
          if (al < a.adZone.fromM || al > a.adZone.toM) continue;
        }
        const k = y * w + x;
        const e0 = g.elev[k];
        if (!(e0 === e0) || R.water[g.cls[k]]) continue;
        let seenN = 0, longN = 0, flankN = 0, bottom = 0;
        const rs = new Set<string>();
        for (const q of S) {
          const ddx = cx - q.x, ddy = cy - q.y;
          const d = Math.hypot(ddx, ddy);
          if (d > rng || d < 1) continue;
          if (!losClear(g, H, cx, cy, 2, q.x, q.y, tgt)) continue;
          seenN++;
          rs.add(q.route);
          const c = (ddx * q.dx + ddy * q.dy) / d; // cos of the angle between the flight and the line to the site
          if (c >= cosLong && d * res >= R.longBeyond * R.adRangeM) longN++;
          if (c <= cosF0 && c >= cosF1 && d * res <= R.flankWithin * R.adRangeM) flankN++;
          if (q.crest && q.e === q.e && e0 <= q.e - R.bottomBelowM) bottom++;
        }
        if (!seenN) continue;
        const sm = seenN * 400, lm = longN * 400, fm = flankN * 400;
        const kinds: AirAdSite['kinds'] = [];
        if (lm >= 800) kinds.push('long');
        if (fm >= 800) kinds.push('flank');
        if (bottom) kinds.push('bottom');
        cands.push({ id: '', x: cx, y: cy, seenM: sm, longM: lm, flankM: fm, bottom, kinds, routes: [...rs].sort(), score: sm / 1000 + (0.5 * lm) / 1000 + (0.5 * fm) / 1000 + 1.5 * bottom, rank: 0, why: '' });
      }
    cands.sort((p, q) => q.score - p.score);
    for (const c of cands) {
      if (ad.some((o) => Math.hypot(o.x - c.x, o.y - c.y) * res < 1500)) continue;
      ad.push(c);
      if (ad.length >= (a.maxAd ?? 4)) break;
    }
    ad.forEach((s, i) => {
      s.id = `AD ${i + 1}`;
      s.rank = i + 1;
      s.score = Math.round(s.score * 10) / 10;
      const bits = [`sees ${(s.seenM / 1000).toFixed(1)} km of Air Apch ${s.routes.join(', ')}`];
      if (s.kinds.includes('long')) bits.push(`long-range ${(s.longM / 1000).toFixed(1)} km`);
      if (s.kinds.includes('flank')) bits.push(`flank ${(s.flankM / 1000).toFixed(1)} km`);
      if (s.kinds.includes('bottom')) bits.push(`bottom shot at ${s.bottom} crest${s.bottom > 1 ? 's' : ''}`);
      s.why = bits.join(' · ');
    });
  }
  notes.push('Air space control measures on the map (ROZ, gun-target lines) are not read yet.');
  return { band: a.band, bandM: [band.minM, band.maxM], lzSideM: lzSide, lzPoints: lzPts, routes, lzs, dzs, ad, observers: eyes.length, notes, ms: Math.round(now() - t0) };
}
