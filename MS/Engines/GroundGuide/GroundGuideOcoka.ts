/**
 * GroundGuideOcoka.ts
 *
 * The calculations of the Ground Guide's Extended View (F; built as the OCOKA lens, renamed 2026-11-12): what may be
 * seen from a point (Observation), how far a weapon has a clear field of fire and how much dead ground lies inside its range (Fields of fire), the obstacle in front and whether
 * fire covers it (Obstacles), the highest ground and what overlooks the point (Key terrain), which ways lead out
 * (Avenues), the month's visibility and the light. Cover and concealment come from GroundGuideCover.
 *
 * Pure: no DOM, no ArcGIS and NO IMPORTS, so the test program (tools/ocoka-test) runs this very file in Node. It reads
 * a grid of the bundle's finest tiles laid side by side (`buildGrid`), never the network.
 *
 * How sight is judged (revised 2026-11-10 after the test program):
 *  - A 30 m elevation cannot show towns, crops, bunds or walls, and its own heights are good to about a metre. So a point
 *    is not "seen" or "hidden" but seen with a PROBABILITY: the share of the target that clears the terrain horizon
 *    (soft over +/- `tolM`), times the chance that nothing mapped on the way stands in the line. Buildings come from the
 *    bundle's building layer (density, footprint, height); crops from the month's crop mix; bunds, walls, orchards and
 *    woods from their ground class. Nothing is random: the same point gives the same answer.
 *  - Three figures are reported: what the ground alone allows (the upper bound), what is expected, and what is sure.
 *  - Fields of fire are graded on two things: the clear distance to the first dead ground (the pamphlets' 100 / 200 /
 *    270-500 m) and how much of the weapon's range is covered. Dead ground (the terrain hides it) is told apart from
 *    screened ground (crops, buildings, trees in the line).
 * The cards say "may be seen" and "check on the ground": see MS/Data/OcokaDoctrine.json `policy`.
 */

const D2R = Math.PI / 180;
const R_EARTH = 6371008.8;
const HALF_WORLD_M = 20037508.342789244;

// ── geometry ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Width of the world in pixels at zoom `z`. */
export function worldPx(z: number, ts = 256): number {
  return ts * 2 ** z;
}
export function lonLatToPx(lon: number, lat: number, z: number, ts = 256): [number, number] {
  const n = worldPx(z, ts);
  const s = Math.sin(lat * D2R);
  return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
}
export function pxToLonLat(x: number, y: number, z: number, ts = 256): [number, number] {
  const n = worldPx(z, ts);
  return [(x / n) * 360 - 180, (Math.atan(Math.sinh(Math.PI - (2 * Math.PI * y) / n)) * 180) / Math.PI];
}
/** Web Mercator metres to world pixels at zoom `z`. */
export function mercToPx(mx: number, my: number, z: number, ts = 256): [number, number] {
  const k = worldPx(z, ts) / (2 * HALF_WORLD_M);
  return [(mx + HALF_WORLD_M) * k, (HALF_WORLD_M - my) * k];
}
export function pxToMerc(px: number, py: number, z: number, ts = 256): [number, number] {
  const k = (2 * HALF_WORLD_M) / worldPx(z, ts);
  return [px * k - HALF_WORLD_M, HALF_WORLD_M - py * k];
}
/** Ground metres in one pixel at this latitude and zoom (Web Mercator is conformal: the same both ways). */
export function mPerPx(lat: number, z: number, ts = 256): number {
  return ((2 * HALF_WORLD_M) / worldPx(z, ts)) * Math.cos(lat * D2R);
}
const COMPASS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function compass8(deg: number): string {
  return COMPASS8[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
export function bearingDiff(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

// ── grid ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A decoded tile (tileSize x tileSize bytes), `null` when the bundle has none there, `undefined` while it loads. */
export type TilePeek = (layer: string, x: number, y: number) => Uint8Array | null | undefined;
export interface OcokaLayers {
  cls: string;
  elevHi: string;
  elevLo: string;
  bld: string | null;
}
/** Tiles of one zoom laid side by side as plain arrays, so a ray is array reads only. */
export interface OcokaGrid {
  z: number;
  ts: number;
  tx0: number;
  ty0: number;
  nx: number;
  ny: number;
  w: number;
  h: number;
  /** World pixel of the grid's top-left corner. */
  px0: number;
  py0: number;
  /** Ground metres per pixel (at the latitude the grid was built for). */
  res: number;
  /** Metres; NaN where the bundle has no elevation. */
  elev: Float32Array;
  cls: Uint8Array;
  /** Building layer (density | size << 3 | height << 6), or null when the bundle has none. */
  bld: Uint8Array | null;
  /** A tile of it was still loading when it was built: build it again when tiles arrive. */
  pending: boolean;
}

export function buildGrid(peek: TilePeek, L: OcokaLayers, z: number, ts: number, lat: number, cx: number, cy: number, radiusPx: number): OcokaGrid {
  const tx0 = Math.floor((cx - radiusPx) / ts);
  const tx1 = Math.floor((cx + radiusPx) / ts);
  const ty0 = Math.floor((cy - radiusPx) / ts);
  const ty1 = Math.floor((cy + radiusPx) / ts);
  const nx = tx1 - tx0 + 1;
  const ny = ty1 - ty0 + 1;
  const w = nx * ts;
  const h = ny * ts;
  let pending = false;
  const lay = (layer: string, fill: number): Uint8Array => {
    const out = new Uint8Array(w * h);
    if (fill) out.fill(fill);
    for (let ty = 0; ty < ny; ty++)
      for (let tx = 0; tx < nx; tx++) {
        const t = peek(layer, tx0 + tx, ty0 + ty);
        if (t === undefined) pending = true;
        if (!t) continue;
        for (let row = 0; row < ts; row++) out.set(t.subarray(row * ts, row * ts + ts), (ty * ts + row) * w + tx * ts);
      }
    return out;
  };
  const hi = lay(L.elevHi, 255);
  const lo = lay(L.elevLo, 0);
  const elev = new Float32Array(w * h);
  for (let i = 0; i < elev.length; i++) elev[i] = hi[i] === 255 ? NaN : hi[i] * 256 + lo[i] - 500;
  return { z, ts, tx0, ty0, nx, ny, w, h, px0: tx0 * ts, py0: ty0 * ts, res: mPerPx(lat, z, ts), elev, cls: lay(L.cls, 255), bld: L.bld ? lay(L.bld, 0) : null, pending };
}

/** True when a circle of `radiusPx` round the world pixel lies inside the grid. */
export function gridHolds(g: OcokaGrid, cx: number, cy: number, radiusPx: number): boolean {
  return cx - radiusPx >= g.px0 && cy - radiusPx >= g.py0 && cx + radiusPx < g.px0 + g.w && cy + radiusPx < g.py0 + g.h;
}

function bilinear(a: Float32Array, w: number, h: number, x: number, y: number): number {
  const x0 = Math.floor(x - 0.5);
  const y0 = Math.floor(y - 0.5);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) return NaN;
  const fx = x - 0.5 - x0;
  const fy = y - 0.5 - y0;
  const i = y0 * w + x0;
  return (a[i] * (1 - fx) + a[i + 1] * fx) * (1 - fy) + (a[i + w] * (1 - fx) + a[i + w + 1] * fx) * fy;
}
/** Elevation at a grid position (pixels), metres; NaN where there is none. */
export function elevAt(g: OcokaGrid, x: number, y: number): number {
  return bilinear(g.elev, g.w, g.h, x, y);
}

// ── tables ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A mover's NO-GO and SLOW-GO ground classes (a compiled Ground Guide profile fits). */
export interface Going {
  nogo: Uint8Array;
  caution: Uint8Array;
}

/**
 * What stands in a line of sight that the elevation cannot show, per ground class and per building-layer value
 * (OcokaDoctrine.json `surfaceBlockers`). `q` is the chance that one cell of it blocks a line through it, `own` the
 * chance that a man standing in the cell is hidden by it (under a canopy he is not; in a tall crop he is), `h` its
 * height above the elevation model.
 */
export interface SightTables {
  h: Float32Array;
  q: Float32Array;
  own: Float32Array;
  /** By building layer value & 63 (density | size << 3). */
  bldQ: Float32Array;
  bldOwn: Float32Array;
  /** By building height class (value >> 6). */
  bldH: Float32Array;
  /** 1 for a class that stands in for buildings only when the bundle has no building layer (built-up area). */
  noBld: Uint8Array;
}

/** Share of cropland whose crop is tall (1.5 m or more) / tall enough to hide a crouching man, in the month. */
export function cropShares(doctrine: any, month: number): { tall: number; hides: number } {
  let tall = 0;
  let hides = 0;
  for (const c of (doctrine?.cropCalendar?.crops ?? []) as any[]) {
    const s = Number(c.share) || 0;
    if (c.tall?.includes(month)) tall += s;
    if (c.hides?.includes(month)) hides += s;
  }
  return { tall: Math.min(1, tall), hides: Math.min(1, hides) };
}

export function sightTables(doctrine: any, month: number, resM: number): SightTables {
  const t: SightTables = { h: new Float32Array(256), q: new Float32Array(256), own: new Float32Array(256), bldQ: new Float32Array(64), bldOwn: new Float32Array(64), bldH: new Float32Array(4), noBld: new Uint8Array(256) };
  const sb = doctrine?.surfaceBlockers ?? {};
  const crop = cropShares(doctrine, month).tall;
  for (const row of (sb.rows ?? []) as any[]) {
    const h = Number(row.aboveDsmM) || 0;
    const share = row.share === 'crop' ? crop : Number(row.share) || 0;
    if (!(h > 0) || !(share > 0)) continue;
    const grain = Math.max(resM, Number(row.grainM) || resM);
    // A patch `grain` metres across is crossed in grain / res cells: the chance per cell that gives `share` per patch.
    const q = 1 - Math.pow(1 - Math.min(0.999, share), resM / grain);
    for (const c of String(row.class).split(',').map((x) => parseInt(x.trim(), 10))) {
      if (!Number.isFinite(c) || c < 0 || c > 255) continue;
      t.h[c] = h;
      t.q[c] = q;
      t.own[c] = row.ownShare === undefined ? share : Math.max(0, Math.min(1, Number(row.ownShare) || 0));
      if (row.withoutBuildingLayer) t.noBld[c] = 1;
    }
  }
  const b = sb.built ?? {};
  const dens: number[] = b.densityPerKm2 ?? [0, 15, 60, 200, 600, 2000, 4500, 4500];
  const width: number[] = b.widthBySizeM ?? [8, 5, 8, 13, 25, 40, 40, 40];
  const hgt: number[] = b.aboveDsmByHeightM ?? [2.5, 3, 5, 8];
  for (let v = 1; v < 64; v++) {
    const n = (dens[v & 7] ?? 0) / 1e6; // buildings per square metre
    const wd = width[v >> 3] ?? 8;
    // Buildings scattered at density n, each wd wide: a line of length res meets one with chance 1 - exp(-n wd res).
    t.bldQ[v] = n > 0 ? 1 - Math.exp(-n * wd * resM) : 0;
    t.bldOwn[v] = Math.min(0.9, n * wd * wd);
  }
  for (let i = 0; i < 4; i++) t.bldH[i] = hgt[i] ?? 3;
  return t;
}

// ── sight ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Range bands for the fields-of-fire picture: how much of each band is seen. */
export interface SightBands {
  /** Ascending edges in metres, e.g. [0, 100, 300, 600, 1000, 2000]; the last band is open-ended. */
  edges: number[];
  all: Float64Array;
  seen: Float64Array;
  terr: Float64Array;
}
export function newBands(edges: number[]): SightBands {
  return { edges, all: new Float64Array(edges.length), seen: new Float64Array(edges.length), terr: new Float64Array(edges.length) };
}

export interface SightOpts {
  /** Eye height above the ground at the point, metres. */
  eyeM: number;
  /** Height of what is looked for: a standing man 1.7 m, a vehicle 2.4 m. */
  targetM: number;
  radiusM: number;
  /** Distance up to which dead and screened ground is summed (the weapon's effective range). */
  effM: number;
  /** Elevation tolerance: a target `tolM` clear of the terrain horizon is surely seen, `tolM` below it surely hidden. Default 1 m. */
  tolM?: number;
  /** Coefficient of refraction. Default 0.13. */
  k?: number;
  /** What the elevation cannot show; null judges on the ground alone. */
  tables: SightTables | null;
  going?: Going | null;
  /** Step between samples in pixels. Default 1. */
  stepPx?: number;
  bands?: SightBands | null;
  /** n rays x steps bytes: the chance each sample is seen, 0-250 (255 = no data), for a picture. */
  trace?: Uint8Array;
  /** As `trace`, for the ground alone. */
  traceTerrain?: Uint8Array;
}

export interface SightRays {
  n: number;
  bearing: Float32Array;
  radiusM: number;
  steps: number;
  /** Distance to the first dead or screened ground (two samples running with less than an even chance), metres. */
  clear: Float32Array;
  /** Farthest sample with an even chance or better of being seen, metres. */
  reach: Float32Array;
  /** Sums weighted by distance (a sample stands for more ground the farther out it is). */
  wAll: Float32Array;
  wSeen: Float32Array;
  wTerr: Float32Array;
  wSure: Float32Array;
  /** Inside `effM`: all ground, ground the terrain hides (dead), ground the terrain shows but something screens. */
  eAll: Float32Array;
  eDead: Float32Array;
  eScr: Float32Array;
  /** First NO-GO ground on the ray: distance (radius when none), class, the chance it is seen from the point. */
  nogoM: Float32Array;
  nogoClass: Uint8Array;
  nogoP: Float32Array;
  cautionM: Float32Array;
  cautionClass: Uint8Array;
  /** Highest ground the terrain lets the point see, above the point, and where. */
  rise: Float32Array;
  riseM: Float32Array;
  /** 1 when ground 15 m or more above the eye, beyond 300 m, looks down on the point along this ray. */
  high: Uint8Array;
  /** Where the ray's last terrain horizon is (the ground that hides what lies behind it), and where the chance that
   *  nothing on the ground blocks the line first fell under an even one (0: it never did); metres. */
  hzM: Float32Array;
  scrM: Float32Array;
  /** Ground height at the point. */
  elev0: number;
  /** The chance that the point's own cell screens its view (it stands in woods, a town, a tall crop). */
  ownScreen: number;
  samples: number;
}

/** Evenly spaced bearings (degrees clockwise from north) over a sector, or the full circle when `sectorDeg` is 360 or more. */
export function bearingsFor(stepDeg: number, centreDeg = 0, sectorDeg = 360): Float32Array {
  if (sectorDeg >= 360) {
    const n = Math.max(4, Math.round(360 / stepDeg));
    return Float32Array.from({ length: n }, (_, i) => (i * 360) / n);
  }
  const n = Math.max(2, Math.round(sectorDeg / stepDeg) + 1);
  return Float32Array.from({ length: n }, (_, i) => (((centreDeg - sectorDeg / 2 + (i * sectorDeg) / (n - 1)) % 360) + 360) % 360);
}
/** Angle between rays that keeps them no more than one pixel apart at `radiusM`. */
export function fineStep(radiusM: number, res: number): number {
  return Math.min(5, Math.max(0.25, (res / radiusM) * (180 / Math.PI)));
}

export function analyseSight(g: OcokaGrid, ox: number, oy: number, bearings: Float32Array, o: SightOpts): SightRays {
  const n = bearings.length;
  const { w, h, elev, cls, res } = g;
  const bld = g.bld;
  const T = o.tables;
  const stepPx = o.stepPx ?? 1;
  const step = res * stepPx;
  const steps = Math.max(1, Math.floor(o.radiusM / step));
  const tol = o.tolM ?? 1;
  const kc = (1 - (o.k ?? 0.13)) / (2 * R_EARTH);
  const going = o.going ?? null;
  const B = o.bands ?? null;
  const R: SightRays = {
    n, bearing: bearings, radiusM: o.radiusM, steps,
    clear: new Float32Array(n), reach: new Float32Array(n), wAll: new Float32Array(n), wSeen: new Float32Array(n), wTerr: new Float32Array(n), wSure: new Float32Array(n),
    eAll: new Float32Array(n), eDead: new Float32Array(n), eScr: new Float32Array(n),
    nogoM: new Float32Array(n), nogoClass: new Uint8Array(n), nogoP: new Float32Array(n), cautionM: new Float32Array(n), cautionClass: new Uint8Array(n),
    rise: new Float32Array(n), riseM: new Float32Array(n), high: new Uint8Array(n), hzM: new Float32Array(n), scrM: new Float32Array(n), elev0: NaN, ownScreen: 0, samples: 0,
  };
  const h0 = bilinear(elev, w, h, ox, oy);
  R.elev0 = h0;
  const eyeAbs = h0 + o.eyeM;
  // The point's own cell: standing in woods, a town or a tall crop, the view is screened before it starts.
  let s0 = 1;
  const oi = Math.floor(oy) * w + Math.floor(ox);
  if (T && h0 === h0 && oi >= 0 && oi < cls.length) {
    const c0 = cls[oi];
    if (T.h[c0] >= o.eyeM * 0.9 && !(bld && T.noBld[c0])) s0 *= 1 - T.own[c0];
    const v0 = bld ? bld[oi] : 0;
    if (v0 && T.bldH[v0 >> 6] >= o.eyeM * 0.9) s0 *= 1 - T.bldOwn[v0 & 63];
  }
  R.ownScreen = 1 - s0;
  let samples = 0;
  for (let r = 0; r < n; r++) {
    const b = bearings[r] * D2R;
    const dx = Math.sin(b) * stepPx;
    const dy = -Math.cos(b) * stepPx;
    let hT = -Infinity; // terrain horizon (slope)
    let hB = -Infinity; // highest blocker top so far (slope)
    let S = s0; // chance that no blocker so far stands in the line
    let clear = -1, lastGood = 0, low = 0, reach = 0, dEnd = 0;
    let wAll = 0, wSeen = 0, wTerr = 0, wSure = 0, eAll = 0, eDead = 0, eScr = 0;
    let nogoM = -1, nogoClass = 0, nogoP = 0, cautM = -1, cautClass = 0;
    let rise = -Infinity, riseM = 0, high = 0, hzD = 0, scrD = s0 < 0.5 ? step : 0;
    let bi = 0;
    let pix = Math.floor(ox), piy = Math.floor(oy);
    let s = 1;
    for (; s <= steps; s++) {
      const d = s * step;
      const x = ox + dx * s;
      const y = oy + dy * s;
      const ix = x | 0;
      const iy = y | 0;
      if (x < 0 || y < 0 || ix >= w || iy >= h) break;
      const ground = bilinear(elev, w, h, x, y);
      if (ground !== ground) break;
      const i = iy * w + ix;
      const c = cls[i];
      let hb = 0, q = 0, own = 0;
      if (T) {
        if (!(bld && T.noBld[c])) {
          hb = T.h[c];
          q = T.q[c];
          own = T.own[c];
        }
        const v = bld ? bld[i] : 0;
        if (v) {
          const qb = T.bldQ[v & 63];
          if (qb > 0) {
            const hbb = T.bldH[v >> 6];
            q = q + qb - q * qb;
            own = Math.max(own, T.bldOwn[v & 63]);
            if (hbb > hb) hb = hbb;
          }
        }
      }
      const base = ground - eyeAbs - d * d * kc;
      const tSlope = (base + o.targetM) / d;
      // Terrain: how much of the target clears the horizon set by the nearer ground, soft over the elevation's tolerance.
      const margin = hT === -Infinity ? o.targetM : (tSlope - hT) * d;
      const pT = margin >= tol ? 1 : margin <= -tol ? 0 : (margin + tol) / (2 * tol);
      // What the elevation cannot show: above every blocker top the target is clear of them; below, it is seen only if
      // none of them stands in the line. A target standing inside a tall patch is hidden with the patch's share.
      let pB = tSlope >= hB ? 1 : S;
      if (own > 0 && hb >= o.targetM * 0.75) pB *= 1 - own;
      const P = pT * pB;
      samples++;
      dEnd = d;
      wAll += d;
      wSeen += d * P;
      wTerr += d * pT;
      if (P >= 0.8) wSure += d;
      if (P >= 0.5) {
        reach = d;
        if (low < 2) low = 0;
        if (clear < 0) lastGood = d;
      } else if (clear < 0 && ++low >= 2) clear = lastGood;
      if (d <= o.effM) {
        eAll += d;
        eDead += d * (1 - pT);
        eScr += d * pT * (1 - pB);
      }
      if (B) {
        while (bi + 1 < B.edges.length && d >= B.edges[bi + 1]) bi++;
        B.all[bi] += d;
        B.seen[bi] += d * P;
        B.terr[bi] += d * pT;
      }
      if (pT >= 0.5) {
        const up = ground - h0;
        if (up > rise) {
          rise = up;
          riseM = d;
        }
        if (d >= 300 && ground - eyeAbs >= 15) high = 1;
      }
      if (going && nogoM < 0) {
        let hit = going.nogo[c] ? c : 0;
        // A line one pixel wide running diagonally (a canal) lets a ray slip between its cells: both corner cells then count.
        if (!hit && ix !== pix && iy !== piy) {
          const a = cls[piy * w + ix];
          const e = cls[iy * w + pix];
          if (going.nogo[a] && going.nogo[e]) hit = a;
        }
        if (hit) {
          nogoM = d;
          nogoClass = hit;
          nogoP = P;
        } else if (cautM < 0 && going.caution[c]) {
          cautM = d;
          cautClass = c;
        }
      }
      pix = ix;
      piy = iy;
      if (o.trace) o.trace[r * steps + s - 1] = Math.round(P * 250);
      if (o.traceTerrain) o.traceTerrain[r * steps + s - 1] = Math.round(pT * 250);
      // What this sample does to the lines behind it.
      const sl = base / d;
      if (sl > hT) {
        hT = sl;
        hzD = d;
      }
      if (q > 0 && hb > 0) {
        const sb = (base + hb) / d;
        if (sb > hT) {
          S *= 1 - q;
          if (scrD === 0 && S < 0.5) scrD = d;
          if (sb > hB) hB = sb;
        }
      }
    }
    if (o.trace) for (let k2 = s; k2 <= steps; k2++) o.trace[r * steps + k2 - 1] = 255;
    if (o.traceTerrain) for (let k2 = s; k2 <= steps; k2++) o.traceTerrain[r * steps + k2 - 1] = 255;
    R.clear[r] = clear >= 0 ? clear : low > 0 ? lastGood : dEnd;
    R.reach[r] = reach;
    R.wAll[r] = wAll;
    R.wSeen[r] = wSeen;
    R.wTerr[r] = wTerr;
    R.wSure[r] = wSure;
    R.eAll[r] = eAll;
    R.eDead[r] = eDead;
    R.eScr[r] = eScr;
    R.nogoM[r] = nogoM < 0 ? o.radiusM : nogoM;
    R.nogoClass[r] = nogoClass;
    R.nogoP[r] = nogoP;
    R.cautionM[r] = cautM < 0 ? o.radiusM : cautM;
    R.cautionClass[r] = cautClass;
    R.rise[r] = rise === -Infinity ? 0 : rise;
    R.riseM[r] = riseM;
    R.high[r] = high;
    R.hzM[r] = hzD;
    R.scrM[r] = scrD;
  }
  R.samples = samples;
  return R;
}

/**
 * The chance that a target at one place is seen from the point (and on the ground alone), with its distance and bearing
 * and, when it is probably not seen, how far along the line the sight is lost: the ground that hides it, or the first
 * thing on the ground likely to screen it.
 */
export function sightTo(g: OcokaGrid, ox: number, oy: number, tx: number, ty: number, o: SightOpts): { p: number; pTerrain: number; distM: number; bearingDeg: number; blockAtM: number | null } | null {
  const ddx = tx - ox;
  const ddy = ty - oy;
  const distM = Math.hypot(ddx, ddy) * g.res;
  if (!(distM >= g.res)) return null;
  const bearingDeg = ((Math.atan2(ddx, -ddy) / D2R) + 360) % 360;
  const steps = Math.max(1, Math.floor((distM + 0.001) / g.res));
  const trace = new Uint8Array(steps);
  const traceTerrain = new Uint8Array(steps);
  const R = analyseSight(g, ox, oy, Float32Array.from([bearingDeg]), { ...o, radiusM: steps * g.res + 0.001, stepPx: 1, bands: null, going: null, trace, traceTerrain });
  const p = trace[steps - 1];
  if (p === 255) return null;
  const pT = traceTerrain[steps - 1];
  const blockAtM = p >= 125 ? null : pT < 125 ? Math.min(R.hzM[0], distM) : R.scrM[0] > 0 ? Math.min(R.scrM[0], distM) : null;
  return { p: p / 250, pTerrain: pT / 250, distM, bearingDeg, blockAtM };
}

// ── summaries ────────────────────────────────────────────────────────────────────────────────────────────────────────

function pct(a: number[], p: number): number {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
}

export type Country = 'open' | 'close' | 'veryClose';
export interface OcokaObservation {
  /** Share of the ground within the radius that is expected to be seen, %. */
  seenPct: number;
  /** What the ground alone allows (nothing on it): the upper bound, %. */
  terrainPct: number;
  /** Ground seen with a chance of 80 % or more, %. */
  surePct: number;
  /** How far the view reaches, median over all directions, metres (the radius when it reaches the edge). */
  reachMedianM: number;
  /** Distance to the first dead or screened ground, median over all directions, metres. */
  clearMedianM: number;
  /** By the pamphlets' limits on field of fire and observation: close 400-500 m or less, very close 100-200 m or less. */
  country: Country;
  /** The highest ground in view above the point (15 m or more), or null. */
  overlook: { riseM: number; distM: number; bearingDeg: number } | null;
  /** Share of the directions from which higher ground looks down on the point, %. */
  overlookArcPct: number;
  /** The chance that the point's own ground cover screens its view, %. */
  ownScreenPct: number;
}
export function observationOf(r: SightRays): OcokaObservation {
  let all = 0, seen = 0, terr = 0, sure = 0, hi = 0;
  const clears: number[] = [];
  const reaches: number[] = [];
  let best = -Infinity, bi = -1;
  for (let i = 0; i < r.n; i++) {
    all += r.wAll[i];
    seen += r.wSeen[i];
    terr += r.wTerr[i];
    sure += r.wSure[i];
    hi += r.high[i];
    clears.push(r.clear[i]);
    reaches.push(r.reach[i]);
    if (r.rise[i] > best) {
      best = r.rise[i];
      bi = i;
    }
  }
  const rm = pct(reaches, 50);
  return {
    seenPct: all ? (100 * seen) / all : 0,
    terrainPct: all ? (100 * terr) / all : 0,
    surePct: all ? (100 * sure) / all : 0,
    reachMedianM: rm,
    clearMedianM: pct(clears, 50),
    country: rm <= 200 ? 'veryClose' : rm <= 500 ? 'close' : 'open',
    overlook: bi >= 0 && best >= 15 ? { riseM: best, distM: r.riseM[bi], bearingDeg: r.bearing[bi] } : null,
    overlookArcPct: r.n ? (100 * hi) / r.n : 0,
    ownScreenPct: 100 * r.ownScreen,
  };
}

export type FireGrade = 'good' | 'marginal' | 'poor';
export interface FireRule {
  good: { clearM: number; seenPct: number };
  marginal: { clearM: number; seenPct: number };
  primaryTaskM: number;
}
export const DEFAULT_FIRE_RULE: FireRule = { good: { clearM: 270, seenPct: 50 }, marginal: { clearM: 100, seenPct: 20 }, primaryTaskM: 200 };

export interface OcokaFire {
  grade: FireGrade;
  /** What holds the grade down: the clear distance, the coverage of the range, or neither. */
  limitedBy: 'clear' | 'coverage' | null;
  /** Clear distance to the first dead or screened ground toward the threat: median, worst fifth, best, metres. */
  clearMedianM: number;
  clearP20M: number;
  clearMaxM: number;
  /** Share of the arc with 200 m / 270 m or more of clear ground, %. */
  ge200Pct: number;
  ge270Pct: number;
  /** The median clear distance meets the minimum for a subunit's primary task (200 m). */
  primaryOk: boolean;
  /** Of the ground inside the weapon's effective range: expected seen, dead (terrain) and screened (crops, buildings, trees), %. */
  seenPct: number;
  deadPct: number;
  screenedPct: number;
  /** The clear distance as a share of the weapon's effective range, %. */
  usesPctOfEff: number;
  /** Expected seen share by range band, % (null where the band lies beyond the rays). */
  bands: Array<{ fromM: number; toM: number | null; seenPct: number | null; terrainPct: number | null }>;
}
export function fireOf(r: SightRays, effM: number, bands: SightBands | null, rule: FireRule = DEFAULT_FIRE_RULE): OcokaFire {
  const clears: number[] = [];
  let all = 0, dead = 0, scr = 0;
  for (let i = 0; i < r.n; i++) {
    clears.push(Math.min(r.clear[i], effM));
    all += r.eAll[i];
    dead += r.eDead[i];
    scr += r.eScr[i];
  }
  const med = pct(clears, 50);
  const deadPct = all ? (100 * dead) / all : 0;
  const screenedPct = all ? (100 * scr) / all : 0;
  const seenPct = Math.max(0, 100 - deadPct - screenedPct);
  // A short weapon cannot have more clear ground than its range: the clear-distance bar is the lower of the two.
  const need = (m: number) => Math.min(m, effM * 0.9);
  const byClear: FireGrade = med >= need(rule.good.clearM) ? 'good' : med >= need(rule.marginal.clearM) ? 'marginal' : 'poor';
  const byCover: FireGrade = seenPct >= rule.good.seenPct ? 'good' : seenPct >= rule.marginal.seenPct ? 'marginal' : 'poor';
  const rank = { good: 2, marginal: 1, poor: 0 } as const;
  const grade = rank[byClear] <= rank[byCover] ? byClear : byCover;
  const out: OcokaFire['bands'] = [];
  if (bands)
    for (let i = 0; i < bands.edges.length; i++) {
      const a = bands.all[i];
      out.push({ fromM: bands.edges[i], toM: bands.edges[i + 1] ?? null, seenPct: a > 0 ? (100 * bands.seen[i]) / a : null, terrainPct: a > 0 ? (100 * bands.terr[i]) / a : null });
    }
  return {
    grade,
    limitedBy: grade === 'good' ? null : rank[byClear] < rank[byCover] ? 'clear' : rank[byCover] < rank[byClear] ? 'coverage' : rank[byClear] === 2 ? null : 'clear',
    clearMedianM: med,
    clearP20M: pct(clears, 20),
    clearMaxM: clears.length ? Math.max(...clears) : NaN,
    ge200Pct: clears.length ? (100 * clears.filter((c) => c >= Math.min(200, effM * 0.9)).length) / clears.length : 0,
    ge270Pct: clears.length ? (100 * clears.filter((c) => c >= Math.min(270, effM * 0.9)).length) / clears.length : 0,
    primaryOk: med >= need(rule.primaryTaskM),
    seenPct,
    deadPct,
    screenedPct,
    usesPctOfEff: effM > 0 ? Math.min(100, (100 * med) / effM) : 0,
    bands: out,
  };
}

export interface OcokaObstacleFront {
  /** Nearest NO-GO ground toward the threat: distance (null when none within the rays), class, the chance it is seen. */
  nogoM: number | null;
  nogoClass: number;
  seenP: number;
  /** It lies inside the weapon's effective range. */
  inRange: boolean;
  /** Inside range and seen with an even chance or better: an obstacle covered by fire. */
  covered: boolean;
  /** Share of the arc that meets NO-GO ground inside the weapon's range / anywhere on the rays, %. */
  blockedInRangePct: number;
  acrossPct: number;
  cautionM: number | null;
  cautionClass: number;
}
export function obstacleFrontOf(r: SightRays, effM: number): OcokaObstacleFront {
  let best = Infinity, bc = 0, bp = 0, cb = Infinity, cc = 0, inR = 0, across = 0;
  for (let i = 0; i < r.n; i++) {
    const m = r.nogoM[i];
    if (r.nogoClass[i]) {
      across++;
      if (m <= effM) inR++;
      if (m < best) {
        best = m;
        bc = r.nogoClass[i];
        bp = r.nogoP[i];
      }
    }
    if (r.cautionClass[i] && r.cautionM[i] < cb) {
      cb = r.cautionM[i];
      cc = r.cautionClass[i];
    }
  }
  const found = best !== Infinity;
  return {
    nogoM: found ? best : null,
    nogoClass: bc,
    seenP: found ? bp : 0,
    inRange: found && best <= effM,
    covered: found && best <= effM && bp >= 0.5,
    blockedInRangePct: r.n ? (100 * inR) / r.n : 0,
    acrossPct: r.n ? (100 * across) / r.n : 0,
    cautionM: cb === Infinity ? null : cb,
    cautionClass: cc,
  };
}

// ── avenues ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type WayState = 'go' | 'slow' | 'nogo';
export interface OcokaWays {
  sectors: number;
  /** Per sector, north first, clockwise: the best of three straight lines out to `radiusM`. */
  state: WayState[];
  /** How far the best line goes before NO-GO ground, metres (the radius when it goes all the way). */
  distM: Float32Array;
  /** The class that stops it (0 when it is not stopped). */
  stopClass: Uint8Array;
  go: number;
  slow: number;
  blocked: number;
  radiusM: number;
}
/** Straight ways out: per sector the best of three lines; GO, SLOW-GO (half the way or more is SLOW-GO ground) or stopped by NO-GO. */
export function waysOut(g: OcokaGrid, ox: number, oy: number, going: Going, radiusM: number, sectors = 24): OcokaWays {
  const { w, h, cls, res } = g;
  const steps = Math.max(1, Math.floor(radiusM / res));
  const out: OcokaWays = { sectors, state: [], distM: new Float32Array(sectors), stopClass: new Uint8Array(sectors), go: 0, slow: 0, blocked: 0, radiusM };
  const width = 360 / sectors;
  for (let k = 0; k < sectors; k++) {
    let bestD = -1, bestC = 0, bestSlow = 1;
    for (const off of [0, -width / 3, width / 3]) {
      const b = (k * width + off) * D2R;
      const dx = Math.sin(b);
      const dy = -Math.cos(b);
      let d = radiusM, c0 = 0, slow = 0, n = 0;
      let pix = Math.floor(ox), piy = Math.floor(oy);
      for (let s = 1; s <= steps; s++) {
        const x = ox + dx * s;
        const y = oy + dy * s;
        const ix = x | 0;
        const iy = y | 0;
        if (x < 0 || y < 0 || ix >= w || iy >= h) break;
        const c = cls[iy * w + ix];
        let hit = going.nogo[c] ? c : 0;
        if (!hit && ix !== pix && iy !== piy) {
          const a = cls[piy * w + ix];
          const e = cls[iy * w + pix];
          if (going.nogo[a] && going.nogo[e]) hit = a;
        }
        if (hit) {
          d = s * res;
          c0 = hit;
          break;
        }
        n++;
        if (going.caution[c]) slow++;
        pix = ix;
        piy = iy;
      }
      const share = n ? slow / n : 0;
      if (d > bestD || (d === bestD && share < bestSlow)) {
        bestD = d;
        bestC = c0;
        bestSlow = share;
      }
    }
    const state: WayState = bestC ? 'nogo' : bestSlow >= 0.5 ? 'slow' : 'go';
    out.state.push(state);
    out.distM[k] = bestD;
    out.stopClass[k] = bestC;
    if (state === 'go') out.go++;
    else if (state === 'slow') out.slow++;
    else out.blocked++;
  }
  return out;
}

export interface OcokaReach {
  /** Per 15 degree sector, north first: the farthest ground reached without crossing NO-GO by a route no longer than 1.5 times the direct one, metres. */
  directM: Float32Array;
  /** As above by any route inside the radius, however long. */
  anyM: Float32Array;
  /** Share of the circle reached directly, %. */
  reachPct: number;
}
/** Flood the ground round the point, stopping at NO-GO (4-connected, so a canal one pixel wide holds). */
export function goReach(g: OcokaGrid, ox: number, oy: number, going: Going, radiusM: number): OcokaReach {
  const { w, h, cls, res } = g;
  const cx = Math.floor(ox), cy = Math.floor(oy);
  const rp = Math.floor(radiusM / res);
  const depth = new Uint16Array(w * h);
  const q = new Int32Array(Math.min(w * h, (2 * rp + 1) * (2 * rp + 1)));
  const directM = new Float32Array(24), anyM = new Float32Array(24);
  if (cx < 0 || cy < 0 || cx >= w || cy >= h || going.nogo[cls[cy * w + cx]]) return { directM, anyM, reachPct: 0 };
  let qh = 0, qt = 0, direct = 0;
  q[qt++] = cy * w + cx;
  depth[cy * w + cx] = 1;
  const rp2 = rp * rp;
  while (qh < qt) {
    const i = q[qh++];
    const x = i % w, y = (i - x) / w;
    const ddx = x - cx, ddy = y - cy;
    const d = Math.sqrt(ddx * ddx + ddy * ddy) * res;
    const bi = Math.floor((((Math.atan2(ddx, -ddy) / D2R) + 360) % 360) / 15) % 24;
    if (d > anyM[bi]) anyM[bi] = d;
    if (depth[i] - 1 <= 1.5 * (Math.abs(ddx) + Math.abs(ddy)) + 6) {
      direct++;
      if (d > directM[bi]) directM[bi] = d;
    }
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (depth[j]) continue;
      const ex = nx - cx, ey = ny - cy;
      if (ex * ex + ey * ey > rp2) continue;
      if (going.nogo[cls[j]]) {
        depth[j] = 65535;
        continue;
      }
      depth[j] = Math.min(65534, depth[i] + 1);
      if (qt < q.length) q[qt++] = j;
    }
  }
  return { directM, anyM, reachPct: (100 * direct) / (Math.PI * rp * rp) };
}

// ── key terrain ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The highest ground within `radiusM` against the point: metres the point stands above it (negative: below), and where it is. */
export function dominanceOf(g: OcokaGrid, ox: number, oy: number, radiusM: number): { aboveMaxM: number; maxM: number; distM: number; bearingDeg: number } {
  const rp = Math.floor(radiusM / g.res);
  const cx = Math.floor(ox), cy = Math.floor(oy);
  let mx = -Infinity, bx = cx, by = cy;
  for (let y = Math.max(0, cy - rp); y <= Math.min(g.h - 1, cy + rp); y++)
    for (let x = Math.max(0, cx - rp); x <= Math.min(g.w - 1, cx + rp); x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > rp * rp) continue;
      const e = g.elev[y * g.w + x];
      if (e > mx) {
        mx = e;
        bx = x;
        by = y;
      }
    }
  const e0 = bilinear(g.elev, g.w, g.h, ox, oy);
  return { aboveMaxM: e0 - mx, maxM: mx, distM: Math.hypot(bx - cx, by - cy) * g.res, bearingDeg: ((Math.atan2(bx - cx, -(by - cy)) / D2R) + 360) % 360 };
}

// ── map products: the fan, avenues, a better position ────────────────────────────────────────────────────────────────

/** A stretch of one ray that is all seen (0), dead ground (1: the terrain hides it) or screened (2: something on the ground does). */
export interface SightRun {
  ray: number;
  fromM: number;
  toM: number;
  state: 0 | 1 | 2;
}
/** The rays of a traced sight reading cut into runs, out to `maxM`: what a fire fan shades. */
export function sightRuns(trace: Uint8Array, traceTerrain: Uint8Array, rays: number, steps: number, stepM: number, maxM = Infinity): SightRun[] {
  const out: SightRun[] = [];
  const last = Math.min(steps, Math.floor(maxM / stepM));
  for (let r = 0; r < rays; r++) {
    let state = -1;
    let from = 0;
    for (let s = 1; s <= last + 1; s++) {
      const p = s <= last ? trace[r * steps + s - 1] : 255;
      const st = p === 255 ? -1 : p >= 125 ? 0 : traceTerrain[r * steps + s - 1] >= 125 ? 2 : 1;
      if (st === state) continue;
      const edge = s === 1 ? 0 : (s - 0.5) * stepM;
      if (state >= 0) out.push({ ray: r, fromM: from, toM: Math.min(edge, maxM), state: state as 0 | 1 | 2 });
      state = st;
      from = edge;
      if (st < 0) break;
    }
  }
  return out;
}

export interface AvenueOpts {
  going: Going;
  /** Width the formation needs, metres: ground narrower than this between NO-GO costs more and is reported as a chokepoint. */
  frontageM: number;
  /** A metre of SLOW-GO ground counts as this many metres of GO (default 3). */
  slowCost?: number;
  /** Extra cost of ground narrower than the frontage, at its tightest (default 4). */
  tightCost?: number;
  /** Cells to avoid (1): each costs `avoidCost` times more (default 3), for a second avenue away from the first. */
  avoid?: Uint8Array | null;
  avoidCost?: number;
}
export interface AvenueChoke {
  /** Grid pixel of the tightest cell. */
  x: number;
  y: number;
  /** Width of passable ground there, metres. */
  widthM: number;
  /** The class of the cell itself (a bridge or ford reads as its own class) and of the NO-GO ground that squeezes it. */
  cellClass: number;
  nogoClass: number;
  /** Distance along the avenue from its start (the threat's end), metres. */
  atM: number;
}
export interface Avenue {
  reached: boolean;
  /** Grid pixels [x0, y0, x1, y1, ...] from the start to the goal. */
  path: Float32Array;
  lengthM: number;
  /** Length counted with SLOW-GO and tight ground weighted: what the search minimised. */
  cost: number;
  /** Share of its length on GO ground, %. */
  goPct: number;
  /** The narrowest passable width along it, metres (capped at 2 km), and whether the formation fits everywhere. */
  minWidthM: number;
  fits: boolean;
  chokes: AvenueChoke[];
}

/**
 * The least-cost way over the ground from a start (the threat) to a goal (the position): NO-GO is never crossed, SLOW-GO
 * costs more, and ground narrower than the formation's frontage costs more still, so the way found is the one a
 * formation of that width would take. Where it must narrow (a bridge, a gap between canals), that is a chokepoint.
 * A* over 8 neighbours inside a box round the two points; the width at a cell is twice its distance to the nearest NO-GO.
 */
export function findAvenue(g: OcokaGrid, sx: number, sy: number, tx: number, ty: number, o: AvenueOpts): Avenue {
  const none: Avenue = { reached: false, path: new Float32Array(0), lengthM: 0, cost: 0, goPct: 0, minWidthM: 0, fits: false, chokes: [] };
  const { w, h, cls, res } = g;
  const going = o.going;
  // The box searched: the two points with a margin of 40 % of their distance (1.5 km at least), inside the grid.
  const span = Math.hypot(tx - sx, ty - sy);
  const pad = Math.max(1500 / res, span * 0.4);
  const x0 = Math.max(0, Math.floor(Math.min(sx, tx) - pad)), x1 = Math.min(w - 1, Math.ceil(Math.max(sx, tx) + pad));
  const y0 = Math.max(0, Math.floor(Math.min(sy, ty) - pad)), y1 = Math.min(h - 1, Math.ceil(Math.max(sy, ty) + pad));
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  if (bw < 3 || bh < 3) return none;
  const N = bw * bh;
  // Distance to the nearest NO-GO cell (3-4 chamfer, in thirds of a pixel) and which cell it is.
  const BIG = 1 << 28;
  const dt = new Int32Array(N).fill(BIG);
  const src = new Int32Array(N).fill(-1);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const gi = (y + y0) * w + x + x0;
      if (going.nogo[cls[gi]] || cls[gi] === 255) {
        dt[y * bw + x] = 0;
        src[y * bw + x] = gi;
      }
    }
  const relax = (i: number, j: number, c: number): void => {
    if (dt[j] + c < dt[i]) {
      dt[i] = dt[j] + c;
      src[i] = src[j];
    }
  };
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const i = y * bw + x;
      if (x > 0) relax(i, i - 1, 3);
      if (y > 0) {
        relax(i, i - bw, 3);
        if (x > 0) relax(i, i - bw - 1, 4);
        if (x < bw - 1) relax(i, i - bw + 1, 4);
      }
    }
  for (let y = bh - 1; y >= 0; y--)
    for (let x = bw - 1; x >= 0; x--) {
      const i = y * bw + x;
      if (x < bw - 1) relax(i, i + 1, 3);
      if (y < bh - 1) {
        relax(i, i + bw, 3);
        if (x < bw - 1) relax(i, i + bw + 1, 4);
        if (x > 0) relax(i, i + bw - 1, 4);
      }
    }
  const clearM = (i: number): number => Math.min(1000, (dt[i] / 3) * res);
  // Start and goal on passable ground: the nearest passable cell within 4 pixels.
  const snap = (px: number, py: number): number => {
    const cx = Math.floor(px) - x0, cy = Math.floor(py) - y0;
    let best = -1, bd = 1e9;
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= bw || y >= bh || dt[y * bw + x] === 0) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = y * bw + x;
        }
      }
    return best;
  };
  const start = snap(sx, sy), goal = snap(tx, ty);
  if (start < 0 || goal < 0) return none;
  const slowCost = o.slowCost ?? 3;
  const tightCost = o.tightCost ?? 4;
  const half = Math.max(res, o.frontageM / 2);
  const avoid = o.avoid ?? null;
  const avoidCost = o.avoidCost ?? 3;
  const cellCost = (i: number): number => {
    const gi = (Math.floor(i / bw) + y0) * w + (i % bw) + x0;
    let m = going.caution[cls[gi]] ? slowCost : 1;
    const c = clearM(i);
    if (c < half) m *= 1 + tightCost * (1 - c / half);
    if (avoid && avoid[gi]) m *= avoidCost;
    return m;
  };
  const gCost = new Float32Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const gx = goal % bw, gy = Math.floor(goal / bw);
  // Binary heap of cell indices keyed by f = g + straight-line distance to the goal.
  const heap: number[] = [];
  const fKey = new Float32Array(N);
  const push = (i: number, f: number): void => {
    fKey[i] = f;
    let k = heap.length;
    heap.push(i);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (fKey[heap[p]] <= f) break;
      heap[k] = heap[p];
      k = p;
    }
    heap[k] = i;
  };
  const pop = (): number => {
    const top = heap[0];
    const lastI = heap.pop()!;
    if (heap.length) {
      const f = fKey[lastI];
      let k = 0;
      const n = heap.length;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && fKey[heap[c + 1]] < fKey[heap[c]]) c++;
        if (fKey[heap[c]] >= f) break;
        heap[k] = heap[c];
        k = c;
      }
      heap[k] = lastI;
    }
    return top;
  };
  gCost[start] = 0;
  push(start, 0);
  const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
  let found = false;
  while (heap.length) {
    const i = pop();
    if (closed[i]) continue;
    closed[i] = 1;
    if (i === goal) {
      found = true;
      break;
    }
    const x = i % bw, y = Math.floor(i / bw);
    const ci = cellCost(i);
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k], ny = y + DY[k];
      if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
      const j = ny * bw + nx;
      if (closed[j] || dt[j] === 0) continue;
      // No cutting between two NO-GO cells that touch at a corner (a canal one pixel wide running diagonally).
      if (k >= 4 && dt[y * bw + nx] === 0 && dt[ny * bw + x] === 0) continue;
      const step = (k < 4 ? 1 : Math.SQRT2) * res * 0.5 * (ci + cellCost(j));
      const ng = gCost[i] + step;
      if (ng < gCost[j]) {
        gCost[j] = ng;
        prev[j] = i;
        push(j, ng + Math.hypot(nx - gx, ny - gy) * res);
      }
    }
  }
  if (!found) return none;
  const cells: number[] = [];
  for (let i = goal; i >= 0; i = prev[i]) cells.push(i);
  cells.reverse();
  const path = new Float32Array(cells.length * 2);
  let lengthM = 0, goM = 0, minW = Infinity;
  const atM: number[] = [];
  cells.forEach((i, k) => {
    const x = i % bw, y = Math.floor(i / bw);
    path[k * 2] = x + x0 + 0.5;
    path[k * 2 + 1] = y + y0 + 0.5;
    if (k > 0) {
      const p = cells[k - 1];
      const d = Math.hypot(x - (p % bw), y - Math.floor(p / bw)) * res;
      lengthM += d;
      if (!going.caution[cls[(y + y0) * w + x + x0]]) goM += d;
    }
    atM.push(lengthM);
    minW = Math.min(minW, 2 * clearM(i));
  });
  // Chokepoints: stretches narrower than the frontage, each reported at its tightest cell (the ends of the avenue,
  // where the points themselves may sit against NO-GO, are left out).
  const chokes: AvenueChoke[] = [];
  let run: { k: number; w: number } | null = null;
  const edge = Math.max(2, Math.round(150 / res));
  const flush = (): void => {
    if (!run) return;
    const i = cells[run.k];
    const x = (i % bw) + x0, y = Math.floor(i / bw) + y0;
    chokes.push({ x: x + 0.5, y: y + 0.5, widthM: run.w, cellClass: cls[y * w + x], nogoClass: src[i] >= 0 ? cls[src[i]] : 0, atM: atM[run.k] });
    run = null;
  };
  for (let k = edge; k < cells.length - edge; k++) {
    const wd = 2 * clearM(cells[k]);
    if (wd < o.frontageM) {
      if (!run || wd < run.w) run = { k, w: wd };
    } else flush();
  }
  flush();
  chokes.sort((a, b) => a.widthM - b.widthM);
  return { reached: true, path, lengthM, cost: gCost[goal], goPct: lengthM > 0 ? (100 * goM) / lengthM : 100, minWidthM: Math.min(2000, minW), fits: chokes.length === 0, chokes: chokes.slice(0, 4) };
}

/** A mask of the cells within `widthPx` of an avenue, for `AvenueOpts.avoid` when looking for a second one. */
export function avenueMask(g: OcokaGrid, a: Avenue, widthPx: number): Uint8Array {
  const m = new Uint8Array(g.w * g.h);
  const r = Math.max(1, Math.round(widthPx));
  for (let k = 0; k < a.path.length; k += 2) {
    const cx = Math.floor(a.path[k]), cy = Math.floor(a.path[k + 1]);
    for (let y = Math.max(0, cy - r); y <= Math.min(g.h - 1, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(g.w - 1, cx + r); x++) m[y * g.w + x] = 1;
  }
  return m;
}
/** Share of avenue `a` that runs inside a mask (0 to 1): how much a second avenue repeats the first. */
export function avenueOverlap(g: OcokaGrid, a: Avenue, mask: Uint8Array): number {
  let n = 0, hit = 0;
  for (let k = 0; k < a.path.length; k += 2) {
    n++;
    if (mask[Math.floor(a.path[k + 1]) * g.w + Math.floor(a.path[k])]) hit++;
  }
  return n ? hit / n : 0;
}

export interface BetterOpts extends SightOpts {
  /** The threat's bearing and arc, degrees. */
  threatDeg: number;
  sectorDeg: number;
  /** How far to look for a better position, metres, and the ring distances and bearings tried. */
  searchM: number;
  rule?: FireRule;
  /** Ground that may be offered: not NO-GO; SLOW-GO only when `allowSlow`. */
  allowSlow?: boolean;
}
export interface BetterPosition {
  /** Grid pixel of the better position. */
  x: number;
  y: number;
  distanceM: number;
  bearingDeg: number;
  /** Fields of fire there and here, judged the same way. */
  fire: OcokaFire;
  here: OcokaFire;
  /** How much higher it stands than the point, metres. */
  higherM: number;
}
const FIRE_RANK = { good: 2, marginal: 1, poor: 0 } as const;
function fireScore(f: OcokaFire, distanceM: number): number {
  return FIRE_RANK[f.grade] * 1000 + f.seenPct * 6 + Math.min(f.clearMedianM, 500) / 4 - distanceM / 15;
}
/**
 * The position within `searchM` with the best fields of fire toward the threat for the same weapon, when it is clearly
 * better than the point's own: a better grade, or 15 points more of the range seen. Rings of candidates (12 bearings
 * every 60 m) are judged on a coarse fan, the best one again on a fine one. Null when the point is as good as any.
 */
export function betterPosition(g: OcokaGrid, ox: number, oy: number, o: BetterOpts): BetterPosition | null {
  const going = o.going ?? null;
  const fan = (x: number, y: number, fine: boolean): OcokaFire | null => {
    if (elevAt(g, x, y) !== elevAt(g, x, y)) return null;
    const radiusM = Math.max(o.effM, 600);
    const b = bearingsFor(fine ? fineStep(radiusM, g.res) : 3, o.threatDeg, o.sectorDeg);
    return fireOf(analyseSight(g, x, y, o.sectorDeg >= 360 ? bearingsFor(fine ? 2 : 6) : b, { ...o, radiusM, going: null, bands: null, trace: undefined, traceTerrain: undefined }), o.effM, null, o.rule ?? DEFAULT_FIRE_RULE);
  };
  const here = fan(ox, oy, false);
  if (!here) return null;
  let best: { x: number; y: number; d: number; b: number; s: number } | null = null;
  const base = fireScore(here, 0);
  for (let d = 60; d <= o.searchM + 1; d += 60) {
    const dp = d / g.res;
    for (let k = 0; k < 12; k++) {
      const b = k * 30;
      const x = ox + Math.sin(b * D2R) * dp, y = oy - Math.cos(b * D2R) * dp;
      const ix = Math.floor(x), iy = Math.floor(y);
      if (ix < 1 || iy < 1 || ix >= g.w - 1 || iy >= g.h - 1) continue;
      const c = g.cls[iy * g.w + ix];
      if (c === 255 || (going && (going.nogo[c] || (!o.allowSlow && going.caution[c])))) continue;
      const f = fan(x, y, false);
      if (!f) continue;
      const s = fireScore(f, d);
      if (s > base + 60 && (!best || s > best.s)) best = { x, y, d, b, s };
    }
  }
  if (!best) return null;
  const fine = fan(best.x, best.y, true);
  const hereFine = fan(ox, oy, true);
  if (!fine || !hereFine) return null;
  if (!(FIRE_RANK[fine.grade] > FIRE_RANK[hereFine.grade] || fine.seenPct >= hereFine.seenPct + 15)) return null;
  return { x: best.x, y: best.y, distanceM: best.d, bearingDeg: best.b, fire: fine, here: hereFine, higherM: elevAt(g, best.x, best.y) - elevAt(g, ox, oy) };
}

// ── weapon ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export type WeaponChannel = 'dir' | 'at' | 'ind' | 'ad';
export interface OcokaWeapon {
  /** The channel fields of fire are judged on: direct fire at troops or armour; `ind` / `ad` weapons need no line of sight of their own. */
  channel: WeaponChannel | null;
  minM: number;
  effM: number;
  maxM: number;
  /** What it fires at, for the height looked for: a standing man or a vehicle. */
  targetM: number;
  target: 'man' | 'vehicle';
  /** Basis of the figure (D doctrine, C catalogue, T typical, E estimate) and where it comes from. */
  basis: string | null;
  source: string | null;
  nv: { moon?: number; star?: number; ti?: number } | null;
  /** False when the symbol carries no range and the default (small arms) stands in. */
  fromSymbol: boolean;
}
/** The fields-of-fire weapon for a symbol's `Rng` (MS/Data/Symbols.json), or the default small arms when it has none. */
export function weaponOf(rng: any, fallback: { effM: number; maxM: number } = { effM: 300, maxM: 500 }): OcokaWeapon {
  const arr = (v: any): [number, number, number] | null => (Array.isArray(v) && v.length >= 3 && v.every((x) => Number.isFinite(x)) ? (v as [number, number, number]) : null);
  const dir = arr(rng?.dir), at = arr(rng?.at), ind = arr(rng?.ind), ad = arr(rng?.ad);
  const meta = { basis: typeof rng?.b === 'string' ? rng.b : null, source: typeof rng?.s === 'string' ? rng.s : null, nv: rng?.nv && typeof rng.nv === 'object' ? rng.nv : null };
  const use = (channel: WeaponChannel, v: [number, number, number], vehicle: boolean): OcokaWeapon => ({ channel, minM: v[0], effM: v[1], maxM: v[2], targetM: vehicle ? 2.4 : 1.7, target: vehicle ? 'vehicle' : 'man', ...meta, fromSymbol: true });
  const dOk = dir && dir[1] > 0, aOk = at && at[1] > 0;
  if (aOk && (!dOk || at![1] >= dir![1])) return use('at', at!, true);
  if (dOk) return use('dir', dir!, false);
  if (ind && ind[1] > 0) return use('ind', ind, false);
  if (ad && ad[1] > 0) return use('ad', ad, false);
  return { channel: 'dir', minM: 0, effM: fallback.effM, maxM: fallback.maxM, targetM: 1.7, target: 'man', basis: null, source: null, nv: null, fromSymbol: false };
}

// ── visibility by month (NOAA GSOD grid in the bundle) ───────────────────────────────────────────────────────────────

export interface VisibilityGrid {
  head: any;
  data: Int16Array;
  ids: string[];
}
export function parseVisibility(head: any, bin: ArrayBuffer): VisibilityGrid {
  return { head, data: new Int16Array(bin), ids: (head.layers as any[]).map((l) => l.id) };
}
export interface VisibilityReading {
  /** Share of the month's days with fog / a view of 3 km or less without fog or rain (haze, dust, smoke) / a view under 2 km, %. */
  fogPct: number | null;
  hazePct: number | null;
  lt2kmPct: number | null;
  meanViewKm: number | null;
  /** Distance to the nearest station behind the figures, km: over 100 km they are a guess. */
  stationKm: number | null;
}
export function visibilityAt(v: VisibilityGrid, lon: number, lat: number, month: number): VisibilityReading {
  const { rows, cols, bounds, cell, nodata } = v.head;
  const c = Math.floor((lon - bounds[0]) / cell);
  const r = Math.floor((bounds[3] - lat) / cell);
  const mm = String(month).padStart(2, '0');
  const get = (id: string, scale: number): number | null => {
    const li = v.ids.indexOf(id);
    if (li < 0 || c < 0 || r < 0 || c >= cols || r >= rows) return null;
    const x = v.data[li * rows * cols + r * cols + c];
    return x === (nodata ?? -32768) ? null : x / scale;
  };
  return { fogPct: get(`fog_${mm}`, 1), hazePct: get(`haze_${mm}`, 1), lt2kmPct: get(`lt2km_${mm}`, 1), meanViewKm: get(`vis_mean_${mm}`, 10), stationKm: get('dist', 1) };
}

/** A night sight's reach on an ordinary day of the month, a haze day and a fog day (OcokaDoctrine.json `visibilityRules`). */
export function nvdReach(deviceM: number, thermal: boolean, doctrine: any, meanViewKm: number | null): { deviceM: number; ordinaryM: number; hazeDayM: number; fogDayM: number } {
  const a = doctrine?.visibilityRules?.assumedView ?? { fogDayKm: 0.5, hazeDayKm: 2 };
  const cap = (viewKm: number, fog: boolean) => (thermal ? (fog ? Math.min(deviceM, 500 * viewKm) : deviceM) : Math.min(deviceM, 500 * viewKm));
  return { deviceM, ordinaryM: cap(meanViewKm ?? 5, false), hazeDayM: cap(a.hazeDayKm, false), fogDayM: cap(a.fogDayKm, true) };
}

// ── light (sun and moon from date, time and place) ───────────────────────────────────────────────────────────────────

function jdOf(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}
function altitudeOf(raDeg: number, decDeg: number, jd: number, lat: number, lon: number): number {
  const T = (jd - 2451545) / 36525;
  const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T - (T * T * T) / 38710000;
  const H = (gmst + lon - raDeg) * D2R;
  return Math.asin(Math.sin(lat * D2R) * Math.sin(decDeg * D2R) + Math.cos(lat * D2R) * Math.cos(decDeg * D2R) * Math.cos(H)) / D2R;
}
function sunPos(jd: number): { lambda: number; ra: number; dec: number; eps: number } {
  const T = (jd - 2451545) / 36525;
  const L0 = 280.46646 + T * (36000.76983 + T * 0.0003032);
  const M = (357.52911 + T * (35999.05029 - 0.0001537 * T)) * D2R;
  const C = Math.sin(M) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M) * (0.019993 - 0.000101 * T) + Math.sin(3 * M) * 0.000289;
  const omega = (125.04 - 1934.136 * T) * D2R;
  const lambda = (L0 + C - 0.00569 - 0.00478 * Math.sin(omega)) * D2R;
  const eps = (23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(omega)) * D2R;
  return { lambda: ((lambda / D2R) % 360 + 360) % 360, ra: Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / D2R, dec: Math.asin(Math.sin(eps) * Math.sin(lambda)) / D2R, eps: eps / D2R };
}
export function sunAltitude(date: Date, lat: number, lon: number): number {
  const jd = jdOf(date);
  const s = sunPos(jd);
  return altitudeOf(s.ra, s.dec, jd, lat, lon);
}
export function moonState(date: Date, lat: number, lon: number): { altDeg: number; illum: number } {
  const jd = jdOf(date);
  const T = (jd - 2451545) / 36525;
  const D = 297.8501921 + 445267.1114034 * T, M = 357.5291092 + 35999.0502909 * T, Mp = 134.9633964 + 477198.8675055 * T;
  const F = 93.272095 + 483202.0175233 * T, Lp = 218.3164477 + 481267.88123421 * T;
  const s = (x: number) => Math.sin(x * D2R), c = (x: number) => Math.cos(x * D2R);
  const lonM = Lp + 6.288774 * s(Mp) + 1.274027 * s(2 * D - Mp) + 0.658314 * s(2 * D) + 0.213618 * s(2 * Mp) - 0.185116 * s(M) - 0.114332 * s(2 * F)
    + 0.058793 * s(2 * D - 2 * Mp) + 0.057066 * s(2 * D - M - Mp) + 0.053322 * s(2 * D + Mp) + 0.045758 * s(2 * D - M) - 0.040923 * s(M - Mp) - 0.03472 * s(D) - 0.030383 * s(M + Mp);
  const latM = 5.128122 * s(F) + 0.280602 * s(Mp + F) + 0.277693 * s(Mp - F) + 0.173237 * s(2 * D - F) + 0.055413 * s(2 * D - Mp + F) + 0.046271 * s(2 * D - Mp - F) + 0.032573 * s(2 * D + F);
  const distKm = 385000.56 - 20905.355 * c(Mp) - 3699.111 * c(2 * D - Mp) - 2955.968 * c(2 * D) - 569.925 * c(2 * Mp) + 48.888 * c(M) - 3.149 * c(2 * F);
  const sun = sunPos(jd);
  const lam = lonM * D2R, bet = latM * D2R, eps = sun.eps * D2R;
  const ra = Math.atan2(Math.sin(lam) * Math.cos(eps) - Math.tan(bet) * Math.sin(eps), Math.cos(lam)) / D2R;
  const dec = Math.asin(Math.sin(bet) * Math.cos(eps) + Math.cos(bet) * Math.sin(eps) * Math.sin(lam)) / D2R;
  let alt = altitudeOf(ra, dec, jd, lat, lon);
  alt -= (Math.asin(6378.14 / distKm) / D2R) * Math.cos(alt * D2R); // parallax: the moon is near enough to shift by about a degree
  const psi = Math.acos(Math.cos(bet) * Math.cos(lam - sun.lambda * D2R));
  const i = Math.atan2(149597870.7 * Math.sin(psi), distKm - 149597870.7 * Math.cos(psi));
  return { altDeg: alt, illum: (1 + Math.cos(i)) / 2 };
}
export type LightLevel = 'day' | 'twilight' | 'moonlight' | 'starlight';
export interface LightReading {
  level: LightLevel;
  sunAltDeg: number;
  moonAltDeg: number;
  /** Lit share of the moon's disc, 0-1. */
  moonIllum: number;
}
/** Day, twilight, moonlight (the moon 5 degrees up or more and a quarter lit) or starlight (OcokaDoctrine.json `light`). */
export function lightAt(date: Date, lat: number, lon: number): LightReading {
  const sun = sunAltitude(date, lat, lon);
  const moon = moonState(date, lat, lon);
  const level: LightLevel = sun >= -0.833 ? 'day' : sun >= -12 ? 'twilight' : moon.altDeg >= 5 && moon.illum >= 0.25 ? 'moonlight' : 'starlight';
  return { level, sunAltDeg: sun, moonAltDeg: moon.altDeg, moonIllum: moon.illum };
}
/**
 * The night of a date at a place: the share of the dark hours (sun 12 degrees or more below the horizon) with moonlight,
 * and the moon's lit share at local midnight. `date` is any time on the evening the night starts.
 */
export function nightOf(date: Date, lat: number, lon: number): { moonlitShare: number; moonIllum: number; level: 'moonlight' | 'starlight' } {
  // Local solar midnight after the given instant: the next time the place's mean solar time passes 24 h.
  const dayMs = 86400000;
  const solarNoonUtc = Math.floor((date.getTime() + (lon / 360) * dayMs) / dayMs) * dayMs + dayMs / 2 - (lon / 360) * dayMs;
  const midnight = solarNoonUtc + dayMs / 2;
  let dark = 0, lit = 0;
  for (let hh = -7; hh <= 7; hh += 0.5) {
    const l = lightAt(new Date(midnight + hh * 3600000), lat, lon);
    if (l.level === 'moonlight' || l.level === 'starlight') {
      dark++;
      if (l.level === 'moonlight') lit++;
    }
  }
  const share = dark ? lit / dark : 0;
  return { moonlitShare: share, moonIllum: moonState(new Date(midnight), lat, lon).illum, level: share >= 0.5 ? 'moonlight' : 'starlight' };
}
