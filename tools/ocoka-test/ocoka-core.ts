/**
 * ocoka-core.ts  --  TEST PROGRAM for the OCOKA lens of the Ground Guide (not part of the library build).
 *
 * Pure functions, no DOM, no ArcGIS, no imports, so it runs in Node 24 (type stripping) and in the browser page.
 * It reads the terrain bundle's z12 tiles (8-bit grayscale PNG, layer/z/x/y.png) and answers the OCOKA questions for
 * one observer point: what can be seen (observation), how far a weapon has a clear field of fire, the dead ground in
 * front, the obstacles in front and whether fire covers them, which way the going leads out (avenues), what the cover
 * is, how the month's visibility and the light affect night vision.
 *
 * The aim of the program is to find out whether this works well enough, and how fast, before any lens UI is built.
 */

// ---------------------------------------------------------------------------------------------------------------- geometry
export const Z = 12;
export const TS = 256;
export const N_WORLD = TS * 2 ** Z;
const EQ_M_PER_PX = 40075016.686 / N_WORLD;
const R_EARTH = 6371008.8;
const D2R = Math.PI / 180;

export function lonLatToPx(lon: number, lat: number): [number, number] {
  const x = ((lon + 180) / 360) * N_WORLD;
  const s = Math.sin(lat * D2R);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * N_WORLD;
  return [x, y];
}
export function pxToLonLat(x: number, y: number): [number, number] {
  const lon = (x / N_WORLD) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / N_WORLD;
  return [lon, (Math.atan(Math.sinh(n)) * 180) / Math.PI];
}
/** Ground metres in one map pixel at this latitude (Web Mercator is conformal: the same both ways). */
export function mPerPx(lat: number): number {
  return EQ_M_PER_PX * Math.cos(lat * D2R);
}

// ---------------------------------------------------------------------------------------------------------------- mosaic
/** Returns the 256 x 256 bytes of one tile, or null when the bundle has none there. */
export type TileSource = (layer: string, x: number, y: number) => Promise<Uint8Array | null>;

export interface Mosaic {
  tx0: number;
  ty0: number;
  nx: number;
  ny: number;
  w: number;
  h: number;
  /** world pixel of the mosaic's top-left corner */
  px0: number;
  py0: number;
  lat: number;
  /** ground metres per pixel */
  res: number;
  layers: Record<string, Uint8Array>;
  /** metres, NaN where the bundle has no elevation */
  elev: Float32Array;
}

export async function loadMosaic(src: TileSource, lon: number, lat: number, radiusM: number, layers: string[]): Promise<Mosaic> {
  const res = mPerPx(lat);
  const [cx, cy] = lonLatToPx(lon, lat);
  const r = radiusM / res + 2;
  const tx0 = Math.floor((cx - r) / TS);
  const tx1 = Math.floor((cx + r) / TS);
  const ty0 = Math.floor((cy - r) / TS);
  const ty1 = Math.floor((cy + r) / TS);
  const nx = tx1 - tx0 + 1;
  const ny = ty1 - ty0 + 1;
  const w = nx * TS;
  const h = ny * TS;
  const want = Array.from(new Set([...layers, 'elev_hi', 'elev_lo']));
  const out: Record<string, Uint8Array> = {};
  for (const l of want) out[l] = new Uint8Array(w * h).fill(l === 'elev_hi' ? 255 : 0);
  const jobs: Promise<void>[] = [];
  for (const l of want)
    for (let ty = 0; ty < ny; ty++)
      for (let tx = 0; tx < nx; tx++)
        jobs.push(
          src(l, tx0 + tx, ty0 + ty).then((t) => {
            if (!t) return;
            const dst = out[l];
            for (let row = 0; row < TS; row++) dst.set(t.subarray(row * TS, row * TS + TS), (ty * TS + row) * w + tx * TS);
          }),
        );
  await Promise.all(jobs);
  const elev = new Float32Array(w * h);
  const hi = out['elev_hi'];
  const lo = out['elev_lo'];
  for (let i = 0; i < elev.length; i++) elev[i] = hi[i] === 255 ? NaN : hi[i] * 256 + lo[i] - 500;
  return { tx0, ty0, nx, ny, w, h, px0: tx0 * TS, py0: ty0 * TS, lat, res, layers: out, elev };
}

/** Pixel position of a lon / lat inside the mosaic. */
export function mosaicXY(m: Mosaic, lon: number, lat: number): [number, number] {
  const [x, y] = lonLatToPx(lon, lat);
  return [x - m.px0, y - m.py0];
}

function bilinear(a: Float32Array, w: number, h: number, x: number, y: number): number {
  const x0 = Math.floor(x - 0.5);
  const y0 = Math.floor(y - 0.5);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) return NaN;
  const fx = x - 0.5 - x0;
  const fy = y - 0.5 - y0;
  const i = y0 * w + x0;
  const a00 = a[i], a10 = a[i + 1], a01 = a[i + w], a11 = a[i + w + 1];
  return (a00 * (1 - fx) + a10 * fx) * (1 - fy) + (a01 * (1 - fx) + a11 * fx) * fy;
}

// ---------------------------------------------------------------------------------------------------------------- tables
export interface Going {
  nogo: Uint8Array;
  caution: Uint8Array;
}
/** First-order going for a mover from its class lists in rules.json (the bundle's profile: nogo / caution class codes). */
export function goingTable(rules: any, profile: string): Going {
  const p = rules.profiles[profile];
  const nogo = new Uint8Array(256);
  const caution = new Uint8Array(256);
  for (const c of p?.nogo ?? []) nogo[c] = 1;
  for (const c of p?.caution ?? []) caution[c] = 1;
  return { nogo, caution };
}

export type BlockerMode = 'none' | 'min' | 'mid' | 'max';
export interface Blockers {
  /** blocker height per class (m) */
  h: Float32Array;
  /** share of the cells of the class that carry it (0..1); the cell decides by a fixed hash so the ground is patchy but repeatable */
  p: Float32Array;
  /** share of built-up cells by building density class, used for class 3 when the bld tile is loaded */
  bldP: Float32Array;
  /** patch size as a shift in pixels: 0 = every cell decides alone, 2 = patches of 4 x 4 cells (about 130 m: a field) */
  gs: Uint8Array;
}
/** Share of cropland that is tall (1.5 m or more) in the month, from the crop mix in OcokaDoctrine.json. */
export function cropTallShare(doctrine: any, month: number): number {
  return (doctrine.cropCalendar.crops as any[]).reduce((s, c) => s + (c.tall.includes(month) ? c.share : 0), 0);
}
/**
 * What a 30 m elevation cannot show (OcokaDoctrine.json surfaceBlockers): bunds, walls, orchards, woods, towns, tall crops.
 * 'none' is the bare DEM (the upper bound of what is seen), 'max' the tallest listed height (the lower bound), 'mid' the middle of the
 * two heights (the central case), 'min' the lowest listed height.
 */
export function blockerTable(doctrine: any, mode: BlockerMode, month: number): Blockers {
  const t: Blockers = { h: new Float32Array(256), p: new Float32Array(256), bldP: Float32Array.from(doctrine.surfaceBlockers.builtShareByDensity), gs: new Uint8Array(256) };
  if (mode === 'none') return t;
  for (const row of doctrine.surfaceBlockers.rows) {
    const classes = String(row.class).split(',').map((x: string) => parseInt(x.trim(), 10));
    const hgt = mode === 'min' ? row.heightM[0] : mode === 'mid' ? (row.heightM[0] + row.heightM[1]) / 2 : row.heightM[1];
    const share = row.share === 'crop' ? cropTallShare(doctrine, month) : row.share === 'bld' ? 0.5 : row.share;
    const grain = Math.max(1, row.grainPx ?? 1);
    for (const c of classes) if (Number.isFinite(c)) { t.h[c] = Math.max(0, hgt); t.p[c] = hgt > 0 ? share : 0; t.gs[c] = Math.round(Math.log2(grain)); }
  }
  return t;
}
function cellHash(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------------------------------------------- rays
export interface RayOpts {
  eyeM: number;
  /** height of the target whose visibility is asked: a standing man 1.7 m, a prone man 0.4 m, a tank 2.4 m */
  targetM: number;
  radiusM: number;
  /** a feature must rise this much above the line of sight to block it (DEM noise floor) */
  noiseM: number;
  /** coefficient of refraction (0.13 is the usual value) */
  k: number;
  blk: Blockers;
  going?: Going | null;
  /** distance up to which dead ground is counted (the weapon's effective range) */
  effM: number;
  /** a blocker this high or more hides a target standing in its own cell (woods, built-up) */
  hidesInsideM?: number;
  /** step between samples in pixels (default 1; 0.5 samples every half pixel: slower, closer to the truth) */
  stepPx?: number;
  /** when given (n rays x steps bytes) each sample's visibility is written to it: 1 seen, 0 hidden, 2 no data (cross-check only) */
  trace?: Uint8Array;
}

export interface RayResults {
  n: number;
  bearing: Float32Array;
  /** distance to the last visible sample before the first hidden one (radius when none is hidden) */
  clear: Float32Array;
  /** distance to the farthest visible sample (how far the view reaches) */
  reach: Float32Array;
  /** sum of d for visible samples and for all samples: area-weighted share seen */
  wVis: Float32Array;
  wAll: Float32Array;
  /** samples hidden / all samples within effM */
  hidEff: Int32Array;
  allEff: Int32Array;
  nogoM: Float32Array;
  nogoClass: Uint8Array;
  /** 1 when the sample at the first NO-GO is visible (an obstacle covered by fire) */
  nogoSeen: Uint8Array;
  cautionM: Float32Array;
  cautionClass: Uint8Array;
  /** highest visible ground above the observer, and where */
  rise: Float32Array;
  riseM: Float32Array;
  elev0: number;
  samples: number;
}

export function allocRays(n: number): Omit<RayResults, 'n' | 'bearing' | 'elev0' | 'samples'> {
  return {
    clear: new Float32Array(n), reach: new Float32Array(n), wVis: new Float32Array(n), wAll: new Float32Array(n), hidEff: new Int32Array(n), allEff: new Int32Array(n),
    nogoM: new Float32Array(n), nogoClass: new Uint8Array(n), nogoSeen: new Uint8Array(n), cautionM: new Float32Array(n),
    cautionClass: new Uint8Array(n), rise: new Float32Array(n), riseM: new Float32Array(n),
  };
}

/** Evenly spaced bearings (degrees, clockwise from north) covering a sector, or the full circle when sectorDeg >= 360. */
export function bearingsFor(stepDeg: number, centreDeg = 0, sectorDeg = 360): Float32Array {
  if (sectorDeg >= 360) {
    const n = Math.round(360 / stepDeg);
    return Float32Array.from({ length: n }, (_, i) => (i * 360) / n);
  }
  const n = Math.max(1, Math.round(sectorDeg / stepDeg) + 1);
  return Float32Array.from({ length: n }, (_, i) => (((centreDeg - sectorDeg / 2 + (i * sectorDeg) / Math.max(1, n - 1)) % 360) + 360) % 360);
}

/** Ray step for a given radius so that rays are never farther apart than one pixel at the far end of a stepDeg fan. */
export function raysFor(radiusM: number, res: number): number {
  return Math.min(5, Math.max(0.25, (res / radiusM) * (180 / Math.PI)));
}

export function analyseRays(m: Mosaic, ox: number, oy: number, bearings: Float32Array, o: RayOpts): RayResults {
  const n = bearings.length;
  const R = allocRays(n);
  const cls = m.layers['class'];
  const { w, h, elev, res } = m;
  const h0 = bilinear(elev, w, h, ox, oy);
  const eyeAbs = h0 + o.eyeM;
  const kc = (1 - o.k) / (2 * R_EARTH);
  const stepPx = o.stepPx ?? 1;
  const step = res * stepPx;
  const steps = Math.floor(o.radiusM / step);
  const blk = o.blk;
  const bld = m.layers['bld'] ?? null;
  const g = o.going ?? null;
  const hidesIn = o.hidesInsideM ?? 3;
  let samples = 0;
  for (let r = 0; r < n; r++) {
    const b = bearings[r] * D2R;
    const dx = Math.sin(b);
    const dy = -Math.cos(b);
    let maxSlope = -Infinity;
    let clear = -1;
    let reach = 0;
    let wVis = 0, wAll = 0, hidEff = 0, allEff = 0;
    let nogoM = Infinity, nogoClass = 0, nogoSeen = 0, cautM = Infinity, cautClass = 0;
    let rise = -Infinity, riseM = 0;
    for (let s = 1; s <= steps; s++) {
      const d = s * step;
      const x = ox + dx * s * stepPx;
      const y = oy + dy * s * stepPx;
      const ix = x | 0;
      const iy = y | 0;
      if (ix < 0 || iy < 0 || ix >= w || iy >= h) break;
      const ground = bilinear(elev, w, h, x, y);
      if (ground !== ground) {
        if (o.trace) o.trace[r * steps + s - 1] = 2;
        break; // no data
      }
      const c = cls[iy * w + ix];
      let hb = 0;
      const pc = blk.p[c];
      if (pc > 0) {
        const share = c === 3 && bld ? blk.bldP[bld[iy * w + ix] & 7] : pc;
        const gs = blk.gs[c];
        if (share >= 1 || cellHash(ix >> gs, iy >> gs) < share) hb = blk.h[c];
      }
      const drop = d * d * kc;
      const inside = hb >= hidesIn;
      // a target of height targetM standing here is seen when it is not below the line of sight set by everything nearer
      const vis = !inside && (ground + o.targetM - eyeAbs - drop) / d >= maxSlope;
      samples++;
      if (o.trace) o.trace[r * steps + s - 1] = vis ? 1 : 0;
      wAll += d;
      if (vis) {
        reach = d;
        wVis += d;
        const up = ground - h0;
        if (up > rise) {
          rise = up;
          riseM = d;
        }
      } else if (clear < 0) clear = d - step;
      if (d <= o.effM) {
        allEff++;
        if (!vis) hidEff++;
      }
      if (g) {
        if (g.nogo[c] && nogoM === Infinity) {
          nogoM = d;
          nogoClass = c;
          nogoSeen = vis ? 1 : 0;
        } else if (g.caution[c] && cautM === Infinity) {
          cautM = d;
          cautClass = c;
        }
      }
      // what this sample does to the sight lines behind it: it must rise noiseM above the line to count
      const slope = (ground + hb - o.noiseM - eyeAbs - drop) / d;
      if (slope > maxSlope) maxSlope = slope;
    }
    R.clear[r] = clear < 0 ? o.radiusM : Math.max(0, clear);
    R.reach[r] = reach;
    R.wVis[r] = wVis;
    R.wAll[r] = wAll;
    R.hidEff[r] = hidEff;
    R.allEff[r] = allEff;
    R.nogoM[r] = nogoM === Infinity ? o.radiusM : nogoM;
    R.nogoClass[r] = nogoClass;
    R.nogoSeen[r] = nogoSeen;
    R.cautionM[r] = cautM === Infinity ? o.radiusM : cautM;
    R.cautionClass[r] = cautClass;
    R.rise[r] = rise === -Infinity ? 0 : rise;
    R.riseM[r] = riseM;
  }
  return { n, bearing: bearings, ...R, elev0: h0, samples };
}

// ---------------------------------------------------------------------------------------------------------------- summaries
export interface Sector {
  centreDeg: number;
  halfDeg: number;
}
function inSector(b: number, s: Sector): boolean {
  let d = Math.abs(((b - s.centreDeg + 540) % 360) - 180);
  return d <= s.halfDeg + 1e-6;
}
function pct(a: number[], p: number): number {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
}

export interface Observation {
  /** share of the ground within the radius that may be seen (area weighted) */
  seenPct: number;
  /** median clear distance all round (m): to the first dead ground */
  clearMedianM: number;
  /** median reach all round (m): how far the view goes */
  reachMedianM: number;
  /** country class by the pamphlets' limits: open / close (400-500 m or less) / very close (100-200 m or less) */
  country: 'open' | 'close' | 'veryClose';
  /** highest ground in view above the observer, and the bearing and distance of it */
  overlook: { riseM: number; distM: number; bearingDeg: number } | null;
}
export function observationOf(r: RayResults): Observation {
  let v = 0, a = 0;
  const clears: number[] = [];
  const reaches: number[] = [];
  let best = -Infinity, bi = -1;
  for (let i = 0; i < r.n; i++) {
    v += r.wVis[i];
    a += r.wAll[i];
    clears.push(r.clear[i]);
    reaches.push(r.reach[i]);
    if (r.rise[i] > best) {
      best = r.rise[i];
      bi = i;
    }
  }
  const med = pct(clears, 50);
  const rm = pct(reaches, 50);
  return {
    seenPct: a ? (100 * v) / a : 0,
    clearMedianM: med,
    reachMedianM: rm,
    country: rm <= 200 ? 'veryClose' : rm <= 500 ? 'close' : 'open',
    overlook: bi >= 0 && best >= 15 ? { riseM: best, distM: r.riseM[bi], bearingDeg: r.bearing[bi] } : null,
  };
}

export interface FieldOfFire {
  /** clear distance toward the threat: 20th percentile, median and best in the sector (m) */
  p20M: number;
  medianM: number;
  maxM: number;
  /** share of rays in the sector with at least 200 m / 270 m clear */
  ge200Pct: number;
  ge270Pct: number;
  grade: 'good' | 'marginal' | 'poor';
  /** share of the ground inside the weapon's effective range that is dead ground (hidden from the observer) */
  deadPct: number;
  /** the rest: share of the ground inside the weapon's effective range that is seen */
  seenEffPct: number;
  /** how much of the weapon's effective range the clear sight uses */
  usesPctOfEff: number;
}
export function fieldOfFireOf(r: RayResults, sec: Sector, effM: number): FieldOfFire {
  const clears: number[] = [];
  let hid = 0, all = 0;
  for (let i = 0; i < r.n; i++) {
    if (!inSector(r.bearing[i], sec)) continue;
    clears.push(r.clear[i]);
    hid += r.hidEff[i];
    all += r.allEff[i];
  }
  const p20 = pct(clears, 20);
  const med = pct(clears, 50);
  return {
    p20M: p20, medianM: med, maxM: clears.length ? Math.max(...clears) : NaN,
    ge200Pct: clears.length ? (100 * clears.filter((c) => c >= 200).length) / clears.length : 0,
    ge270Pct: clears.length ? (100 * clears.filter((c) => c >= 270).length) / clears.length : 0,
    grade: med >= 270 ? 'good' : med >= 100 ? 'marginal' : 'poor',
    deadPct: all ? (100 * hid) / all : 0,
    seenEffPct: all ? 100 - (100 * hid) / all : 0,
    usesPctOfEff: effM > 0 ? Math.min(100, (100 * med) / effM) : 0,
  };
}

export interface ObstacleFront {
  /** nearest NO-GO class in the sector (m), its class code, and whether it is seen from the position (covered by fire) */
  nogoM: number;
  nogoClass: number;
  covered: boolean;
  cautionM: number;
  cautionClass: number;
  /** share of rays in the sector that meet a NO-GO inside effM */
  blockedPct: number;
}
export function obstacleFrontOf(r: RayResults, sec: Sector, effM: number): ObstacleFront {
  let best = Infinity, bc = 0, seen = false, cb = Infinity, cc = 0, blocked = 0, n = 0;
  for (let i = 0; i < r.n; i++) {
    if (!inSector(r.bearing[i], sec)) continue;
    n++;
    if (r.nogoM[i] <= effM) blocked++;
    if (r.nogoM[i] < best) {
      best = r.nogoM[i];
      bc = r.nogoClass[i];
      seen = r.nogoSeen[i] === 1;
    }
    if (r.cautionM[i] < cb) {
      cb = r.cautionM[i];
      cc = r.cautionClass[i];
    }
  }
  return { nogoM: best, nogoClass: bc, covered: seen && best <= effM, cautionM: cb, cautionClass: cc, blockedPct: n ? (100 * blocked) / n : 0 };
}

// ---------------------------------------------------------------------------------------------------------------- avenues
export interface GoReach {
  /** furthest DIRECT reach per 15 degree sector (m), north first: a cell counts when its path from the observer is at most
   *  1.5 times the Manhattan distance (plus a small allowance), so a canal crossed only at a bridge far away does not count */
  sectorM: Float32Array;
  /** furthest reach by any path, however long */
  sectorAnyM: Float32Array;
  /** share of the circle's area within the radius that can be reached directly */
  reachPct: number;
  /** sectors that lead out directly to at least 'outM' */
  waysOut: number;
  cells: number;
}
/** Flood the NO-GO barriers (4-connected, so a one-pixel canal holds) and report how far each direction leads. */
export function goReach(m: Mosaic, ox: number, oy: number, going: Going, radiusM: number, outM: number): GoReach {
  const { w, h, res } = m;
  const cls = m.layers['class'];
  const cx = Math.round(ox - 0.5), cy = Math.round(oy - 0.5);
  const rp = Math.floor(radiusM / res);
  const depth = new Uint16Array(w * h);
  const q = new Int32Array(Math.min(w * h, (2 * rp + 1) * (2 * rp + 1)));
  let qh = 0, qt = 0;
  const sec = new Float32Array(24), secAny = new Float32Array(24);
  let direct = 0;
  if (going.nogo[cls[cy * w + cx]]) return { sectorM: sec, sectorAnyM: secAny, reachPct: 0, waysOut: 0, cells: 0 };
  q[qt++] = cy * w + cx;
  depth[cy * w + cx] = 1;
  const rp2 = rp * rp;
  while (qh < qt) {
    const i = q[qh++];
    const x = i % w, y = (i - x) / w;
    const ddx = x - cx, ddy = y - cy;
    const d = Math.sqrt(ddx * ddx + ddy * ddy) * res;
    const bi = Math.floor((((Math.atan2(ddx, -ddy) * 180) / Math.PI + 360) % 360) / 15) % 24;
    if (d > secAny[bi]) secAny[bi] = d;
    if (depth[i] - 1 <= 1.5 * (Math.abs(ddx) + Math.abs(ddy)) + 6) {
      direct++;
      if (d > sec[bi]) sec[bi] = d;
    }
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (depth[j]) continue;
      const ex = nx - cx, ey = ny - cy;
      if (ex * ex + ey * ey > rp2) continue;
      if (going.nogo[cls[j]]) { depth[j] = 65535; continue; }
      depth[j] = Math.min(65534, depth[i] + 1);
      if (qt < q.length) q[qt++] = j;
    }
  }
  let ways = 0;
  for (let i = 0; i < 24; i++) if (sec[i] >= outM) ways++;
  return { sectorM: sec, sectorAnyM: secAny, reachPct: (100 * direct) / (Math.PI * rp * rp), waysOut: ways, cells: direct };
}

// ---------------------------------------------------------------------------------------------------------------- dominance
/** Is the observer on the highest ground within radiusM (the ITG reason H)? Returns metres above the highest cell (negative: below it). */
export function dominanceOf(m: Mosaic, ox: number, oy: number, radiusM: number): { aboveMaxM: number; maxM: number } {
  const rp = Math.floor(radiusM / m.res);
  const cx = Math.round(ox), cy = Math.round(oy);
  let mx = -Infinity;
  for (let y = Math.max(0, cy - rp); y <= Math.min(m.h - 1, cy + rp); y++)
    for (let x = Math.max(0, cx - rp); x <= Math.min(m.w - 1, cx + rp); x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > rp * rp) continue;
      const e = m.elev[y * m.w + x];
      if (e > mx) mx = e;
    }
  const e0 = bilinear(m.elev, m.w, m.h, ox, oy);
  return { aboveMaxM: e0 - mx, maxM: mx };
}

// ---------------------------------------------------------------------------------------------------------------- cover
export interface Cover {
  classCode: number;
  className: string;
  /** direct fire, indirect fire, ground observation, aerial observation: 0 none 1 poor 2 fair 3 good */
  split: [number, number, number, number];
  /** the bundle's own area cover / concealment levels at the point (cc layer) */
  cc: { concealment: number; cover: number };
  /** concealment from the month's crop calendar: cropland can only be lowered, never raised */
  note: string | null;
}
export function coverAt(m: Mosaic, ox: number, oy: number, rules: any, doctrine: any, month: number): Cover {
  const i = Math.floor(oy) * m.w + Math.floor(ox);
  const c = m.layers['class'][i];
  const v = m.layers['cc'][i];
  const split = (rules.grotbc.coverSplit.byClass[String(c)] ?? [0, 0, 0, 0]).slice() as [number, number, number, number];
  let note: string | null = null;
  if (c === 2 || c === 23) {
    const hides = doctrine.cropCalendar.crops.some((cr: any) => cr.hides.includes(month));
    if (!hides) {
      split[2] = 0;
      split[3] = 0;
      note = 'no crop is tall enough to hide a man this month: concealment lowered to none';
    }
  }
  return { classCode: c, className: rules.classes[String(c)]?.label ?? `class ${c}`, split, cc: { concealment: v >> 4, cover: v & 15 }, note };
}

// ---------------------------------------------------------------------------------------------------------------- visibility grid
export interface VisGrid {
  head: any;
  data: Int16Array;
  ids: string[];
}
export function parseVisibility(head: any, bin: ArrayBuffer): VisGrid {
  return { head, data: new Int16Array(bin), ids: head.layers.map((l: any) => l.id) };
}
export interface VisReading {
  fogPct: number | null;
  hazePct: number | null;
  lt2kmPct: number | null;
  meanViewKm: number | null;
  stationKm: number | null;
}
export function visibilityAt(v: VisGrid, lon: number, lat: number, month: number): VisReading {
  const { rows, cols, bounds, cell } = v.head;
  const c = Math.floor((lon - bounds[0]) / cell);
  const r = Math.floor((bounds[3] - lat) / cell);
  const mm = String(month).padStart(2, '0');
  const get = (id: string, scale: number) => {
    const li = v.ids.indexOf(id);
    if (li < 0 || c < 0 || r < 0 || c >= cols || r >= rows) return null;
    const x = v.data[li * rows * cols + r * cols + c];
    return x === -32768 ? null : x / scale;
  };
  return { fogPct: get(`fog_${mm}`, 1), hazePct: get(`haze_${mm}`, 1), lt2kmPct: get(`lt2km_${mm}`, 1), meanViewKm: get(`vis_mean_${mm}`, 10), stationKm: get('dist', 1) };
}

export interface NvdReading {
  deviceM: number;
  ordinaryM: number;
  fogDayM: number;
  hazeDayM: number;
}
/** Night-vision reach on an ordinary day, a haze day and a fog day (OcokaDoctrine.json visibilityRules.nvdCap). */
export function nvdReach(deviceM: number, thermal: boolean, doctrine: any, meanViewKm: number | null): NvdReading {
  const a = doctrine.visibilityRules.assumedView;
  const cap = (viewKm: number, fog: boolean) => (thermal ? (fog ? Math.min(deviceM, 0.5 * viewKm * 1000) : deviceM) : Math.min(deviceM, 0.5 * viewKm * 1000));
  return { deviceM, ordinaryM: cap(meanViewKm ?? 5, false), hazeDayM: cap(a.hazeDayKm, false), fogDayM: cap(a.fogDayKm, true) };
}

// ---------------------------------------------------------------------------------------------------------------- sun and moon
function rad(d: number): number { return d * D2R; }
function jdOf(date: Date): number { return date.getTime() / 86400000 + 2440587.5; }
function altAz(raDeg: number, decDeg: number, jd: number, lat: number, lon: number): number {
  const T = (jd - 2451545) / 36525;
  const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T - (T * T * T) / 38710000;
  const H = rad(gmst + lon - raDeg);
  return Math.asin(Math.sin(rad(lat)) * Math.sin(rad(decDeg)) + Math.cos(rad(lat)) * Math.cos(rad(decDeg)) * Math.cos(H)) / D2R;
}
interface Sun { lambda: number; ra: number; dec: number; eps: number; }
function sunPos(jd: number): Sun {
  const T = (jd - 2451545) / 36525;
  const L0 = 280.46646 + T * (36000.76983 + T * 0.0003032);
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const C = Math.sin(rad(M)) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(rad(2 * M)) * (0.019993 - 0.000101 * T) + Math.sin(rad(3 * M)) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(rad(omega));
  const ra = Math.atan2(Math.cos(rad(eps)) * Math.sin(rad(lambda)), Math.cos(rad(lambda))) / D2R;
  const dec = Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda))) / D2R;
  return { lambda: ((lambda % 360) + 360) % 360, ra, dec, eps };
}
export function sunAltitude(date: Date, lat: number, lon: number): number {
  const jd = jdOf(date);
  const s = sunPos(jd);
  const alt = altAz(s.ra, s.dec, jd, lat, lon);
  return alt;
}
export function moonState(date: Date, lat: number, lon: number): { altDeg: number; illum: number } {
  const jd = jdOf(date);
  const T = (jd - 2451545) / 36525;
  const D = 297.8501921 + 445267.1114034 * T, M = 357.5291092 + 35999.0502909 * T, Mp = 134.9633964 + 477198.8675055 * T;
  const F = 93.272095 + 483202.0175233 * T, Lp = 218.3164477 + 481267.88123421 * T;
  const s = (x: number) => Math.sin(rad(x)), c = (x: number) => Math.cos(rad(x));
  const lon_ = Lp + 6.288774 * s(Mp) + 1.274027 * s(2 * D - Mp) + 0.658314 * s(2 * D) + 0.213618 * s(2 * Mp) - 0.185116 * s(M) - 0.114332 * s(2 * F)
    + 0.058793 * s(2 * D - 2 * Mp) + 0.057066 * s(2 * D - M - Mp) + 0.053322 * s(2 * D + Mp) + 0.045758 * s(2 * D - M) - 0.040923 * s(M - Mp)
    - 0.03472 * s(D) - 0.030383 * s(M + Mp);
  const lat_ = 5.128122 * s(F) + 0.280602 * s(Mp + F) + 0.277693 * s(Mp - F) + 0.173237 * s(2 * D - F) + 0.055413 * s(2 * D - Mp + F)
    + 0.046271 * s(2 * D - Mp - F) + 0.032573 * s(2 * D + F);
  const distKm = 385000.56 - 20905.355 * c(Mp) - 3699.111 * c(2 * D - Mp) - 2955.968 * c(2 * D) - 569.925 * c(2 * Mp) + 48.888 * c(M) - 3.149 * c(2 * F);
  const sun = sunPos(jd);
  const eps = sun.eps;
  const lam = rad(lon_), bet = rad(lat_);
  const ra = Math.atan2(Math.sin(lam) * Math.cos(rad(eps)) - Math.tan(bet) * Math.sin(rad(eps)), Math.cos(lam)) / D2R;
  const dec = Math.asin(Math.sin(bet) * Math.cos(rad(eps)) + Math.cos(bet) * Math.sin(rad(eps)) * Math.sin(lam)) / D2R;
  let alt = altAz(ra, dec, jd, lat, lon);
  const par = Math.asin(6378.14 / distKm) / D2R; // horizontal parallax: the moon is near enough to move by about a degree
  alt -= par * Math.cos(rad(alt));
  const psi = Math.acos(Math.cos(bet) * Math.cos(lam - rad(sun.lambda)));
  const i = Math.atan2(149597870.7 * Math.sin(psi), distKm - 149597870.7 * Math.cos(psi));
  return { altDeg: alt, illum: (1 + Math.cos(i)) / 2 };
}
export type Light = 'day' | 'twilight' | 'moonlight' | 'starlight';
/** Light level by OcokaDoctrine.json light: day, twilight, moonlight (moon up 5 degrees or more and a quarter lit), starlight. */
export function lightAt(date: Date, lat: number, lon: number): { level: Light; sunAltDeg: number; moonAltDeg: number; moonIllum: number } {
  const sun = sunAltitude(date, lat, lon);
  const moon = moonState(date, lat, lon);
  const level: Light = sun >= -0.833 ? 'day' : sun >= -12 ? 'twilight' : moon.altDeg >= 5 && moon.illum >= 0.25 ? 'moonlight' : 'starlight';
  return { level, sunAltDeg: sun, moonAltDeg: moon.altDeg, moonIllum: moon.illum };
}
