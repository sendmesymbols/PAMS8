/**
 * GroundGuideIpb.ts
 *
 * The IPB combined obstacle overlay of the Ground Guide's Extended View (IPB_Plan.md §6.1; the C&SC Quetta IPB book
 * pp 6-12). Every cell of a grid of the bundle's finest tiles is coded GO / SLOW-GO / NO-GO by the BOOK'S criteria only
 * (user decision 1, 2026-11-14: "follow authentic source"), with the criterion that decided it, and:
 *   - NOT ASSESSED where a criterion that applies at the cell cannot be tested from the bundle (water width of a line
 *     feature, tree thickness and spacing) and nothing tested makes the cell NO-GO: never painted as GO;
 *   - NOT CLASSED where the book gives no class (downhill 30 degrees or more; relief over 400 m per km).
 * Criteria (MS/Data/IpbDoctrine.json `coding`): slope (uphill along the direction of movement: NO-GO >= 45 %, SLOW-GO
 * 30-45 %; GO < 30 degrees as written), relief per km (100 / 200 / 400 m), built-up areas wider than 500 m or with no
 * easy bypass (armour), hydrology (wider than the AVLB span, crossings, seasonal water), vegetation (armour, mechanized:
 * not recorded), roads and tracks per km in close country (armour; roads negate vegetation), man-made obstacles (from
 * symbols), and the terrain pamphlets' season rules (Rann June-November, above 2500 m in winter, snow slopes over 35
 * degrees) either in the coding or as notes (`season`). The water table is not in the bundle: not assessed anywhere.
 *
 * Pure: no DOM, no ArcGIS and NO IMPORTS, so tools/ipb-test runs this very file in Node. Worked out only while the
 * Extended View (F) is on, once per area (the caller caches it).
 */

export type IpbMover = 'armour' | 'mech' | 'dismounted';
export type IpbClass = 'go' | 'slow' | 'nogo' | 'na' | 'nc';
/** Cell codes. */
export const IPB = { GO: 0, SLOW: 1, NOGO: 2, NA: 3, NC: 4, NODATA: 255 } as const;
/** Why a cell is coded as it is: the criteria that gave its class, and the flags. */
export const WHY = {
  SLOPE: 1,
  RELIEF: 2,
  BUA: 4,
  WATER: 8,
  VEG: 16,
  ROADS: 32,
  MANMADE: 64,
  SEASON: 128,
  NA_WATER: 256,
  NA_VEG: 512,
  NC_SLOPE: 1024,
  NC_RELIEF: 2048,
  NOTE_SEASON: 4096,
  CROSSING: 8192,
  SEASONAL_WATER: 16384,
} as const;

/** A grid of the bundle's finest tiles (an OcokaGrid fits). */
export interface IpbGrid {
  w: number;
  h: number;
  /** Ground metres per cell. */
  res: number;
  cls: Uint8Array;
  /** Metres; NaN where there is none. */
  elev: Float32Array;
}
/** A man-made obstacle read from a symbol on the map, in grid cells. */
export interface IpbObstacle {
  kind: 'area' | 'line';
  pts: Array<[number, number]>;
}
export interface IpbRules {
  slowUphillPct: number;
  nogoUphillPct: number;
  goDeg: number;
  slopeBaselineM: number;
  reliefSlow: number;
  reliefNogo: number;
  reliefTop: number;
  reliefWindowM: number;
  buaWideM: number;
  buaBypassM: number;
  roadsWindowM: number;
  bankM: number;
  bua: Uint8Array;
  water: Uint8Array;
  seasonal: Uint8Array;
  crossing: Uint8Array;
  veg: Uint8Array;
  hard: Uint8Array;
  track: Uint8Array;
  close: Uint8Array;
  rann: { months: number[]; cls: Uint8Array; box: [number, number, number, number] };
  snow: { aboveM: number; months: number[] };
  snowSlopeDeg: number;
  movers: Record<string, IpbMover>;
  defaultAvlbM: number;
}
export interface IpbArgs {
  grid: IpbGrid;
  rules: IpbRules;
  mover: IpbMover;
  /** Direction of movement, degrees clockwise from north; null = all round (the steepest slope counts as uphill). */
  moveDeg: number | null;
  month: number;
  /** The area's centre, for the Rann box. */
  lonLat: [number, number] | null;
  avlbSpanM: number;
  season: 'coding' | 'notes';
  obstacles?: IpbObstacle[];
  /** Part of the grid to code, [x0, y0, x1, y1) in cells; the whole grid when left out. */
  box?: [number, number, number, number];
}
export interface IpbStats {
  cells: number;
  /** Share of the coded cells, %. */
  pct: Record<IpbClass, number>;
  /** Cells each criterion made SLOW-GO or NO-GO. */
  by: Record<'slope' | 'relief' | 'bua' | 'water' | 'veg' | 'roads' | 'manMade' | 'season', number>;
  naWater: number;
  naVeg: number;
  seasonalWater: number;
  seasonNotes: number;
  crossings: number;
  buaNogo: Array<{ widthM: number; noBypass: boolean; cells: number }>;
  /** Area-level things the bundle cannot tell (always includes the water table). */
  notAssessed: string[];
}
export interface IpbCoding {
  x0: number;
  y0: number;
  w: number;
  h: number;
  res: number;
  mover: IpbMover;
  moveDeg: number | null;
  avlbSpanM: number;
  season: 'coding' | 'notes';
  code: Uint8Array;
  why: Uint16Array;
  /** Slope along the direction of movement, % (uphill +). */
  slope: Float32Array;
  /** Elevation range in the 1 km window, m. */
  relief: Float32Array;
  /** Narrowest width of the water at the cell, m (0: not water). */
  waterW: Uint16Array;
  /** Width of the built-up area the cell belongs to, m (0: not built-up or not judged). */
  buaW: Uint16Array;
  /** Hard-surface roads and tracks per km round the cell (close country, armour), x10. */
  roadH: Uint8Array;
  roadT: Uint8Array;
  stats: IpbStats;
  ms: number;
}

// ── rules ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const lut = (v: unknown): Uint8Array => {
  const t = new Uint8Array(256);
  for (const c of (Array.isArray(v) ? v : []) as number[]) if (c >= 0 && c < 256) t[c] = 1;
  return t;
};
const num = (v: any, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const val = (o: any): any => (o && typeof o === 'object' && 'value' in o ? o.value : o);

/** The coding rules from IpbDoctrine.json (`coding`), with the book's figures as fallbacks. */
export function ipbRulesFrom(doc: any): IpbRules {
  const c = doc?.coding ?? {};
  const s = c.slope ?? {};
  const r = c.relief ?? {};
  const h = c.hydrology ?? {};
  const se = c.season ?? {};
  const mv = c.movers ?? {};
  const movers: Record<string, IpbMover> = {};
  for (const m of ['armour', 'mech', 'dismounted'] as const) for (const p of (mv[m] ?? []) as string[]) movers[p] = m;
  const relSlow = Array.isArray(r.slowMPerKm) ? r.slowMPerKm[0] : 100;
  const relNogo = Array.isArray(r.nogoMPerKm) ? r.nogoMPerKm : [200, 400];
  return {
    slowUphillPct: Array.isArray(s.slowUphillPct) ? s.slowUphillPct[0] : 30,
    nogoUphillPct: num(s.nogoUphillPct, 45),
    goDeg: num(s.goDeg, 30),
    slopeBaselineM: num(val(s.baselineM), 60),
    reliefSlow: num(relSlow, 100),
    reliefNogo: num(relNogo[0], 200),
    reliefTop: num(relNogo[1], 400),
    reliefWindowM: num(val(r.windowM), 1000),
    buaWideM: num(c.bua?.nogoWiderThanM, 500),
    buaBypassM: 500,
    roadsWindowM: 1000,
    bankM: num(val(h.bankHeightM), 1.22),
    bua: lut(val(c.bua?.classes) ?? [3]),
    water: lut(val(h.waterClasses) ?? [4, 6, 7, 20, 21, 22, 46]),
    seasonal: lut(val(h.seasonalClasses) ?? [5]),
    crossing: lut(val(h.crossingClasses) ?? [39, 40, 41, 42, 43, 44, 45]),
    veg: lut(val(c.vegetation?.classes) ?? [1, 29, 30, 31]),
    hard: lut(val(c.roads?.hardClasses) ?? [34, 35, 36, 37]),
    track: lut(val(c.roads?.trackClasses) ?? [38]),
    close: lut(val(c.roads?.closeClasses) ?? [1, 29, 30, 31]),
    rann: {
      months: (se.rann?.months as number[]) ?? [6, 7, 8, 9, 10, 11],
      cls: lut(val(se.rann?.classes) ?? [16, 6]),
      box: (val(se.rann?.box) as [number, number, number, number]) ?? [68.0, 22.8, 71.6, 24.8],
    },
    snow: { aboveM: num(se.snowClosure?.aboveM, 2500), months: (val(se.snowClosure?.months) as number[]) ?? [11, 12, 1, 2, 3, 4] },
    snowSlopeDeg: num(se.snowSlopes?.dangerDeg, 35),
    movers,
    defaultAvlbM: num(val(h.avlbSpanM), 18),
  };
}

/** The book's kind of force for a Ground Guide profile (armoured / mechanized / everything else on foot). */
export function ipbMoverOf(profile: string, rules: IpbRules): IpbMover {
  return rules.movers[profile] ?? 'dismounted';
}

// ── coding ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const D2R = Math.PI / 180;
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Code a grid by the IPB book's criteria. */
export function codeIpb(a: IpbArgs): IpbCoding {
  const t0 = now();
  const g = a.grid;
  const R = a.rules;
  const gw = g.w;
  const gh = g.h;
  const res = g.res;
  const [x0, y0, x1, y1] = a.box ? [Math.max(0, a.box[0]), Math.max(0, a.box[1]), Math.min(gw, a.box[2]), Math.min(gh, a.box[3])] : [0, 0, gw, gh];
  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);
  const n = w * h;
  const code = new Uint8Array(n);
  const why = new Uint16Array(n);
  const slope = new Float32Array(n);
  const relief = new Float32Array(n);
  const waterW = new Uint16Array(n);
  const buaW = new Uint16Array(n);
  const roadH = new Uint8Array(n);
  const roadT = new Uint8Array(n);
  const armour = a.mover === 'armour';
  const vegApplies = a.mover !== 'dismounted';
  const dir = a.moveDeg === null || !Number.isFinite(a.moveDeg) ? null : (((a.moveDeg % 360) + 360) % 360) * D2R;
  const ux = dir === null ? 0 : Math.sin(dir);
  const uy = dir === null ? 0 : -Math.cos(dir);
  const E = g.elev;
  const C = g.cls;
  const eAt = (x: number, y: number): number => (x < 0 || y < 0 || x >= gw || y >= gh ? NaN : E[y * gw + x]);

  // Slope along the movement over the baseline (nearest cells); all round: the steepest slope.
  const b = Math.max(1, Math.round(R.slopeBaselineM / res / 2));
  const ox = Math.round(b * ux);
  const oy = Math.round(b * uy);
  const sDist = 2 * Math.hypot(ox, oy) * res || 1;
  const steepPct = (gx: number, gy: number): number => {
    const ex = (eAt(gx + 1, gy) - eAt(gx - 1, gy)) / (2 * res);
    const ey = (eAt(gx, gy + 1) - eAt(gx, gy - 1)) / (2 * res);
    const m = Math.hypot(ex, ey) * 100;
    return Number.isFinite(m) ? m : NaN;
  };

  // Relief: elevation range in the window, on blocks of about 90 m, sliding min / max.
  const f = Math.max(1, Math.round(90 / res));
  const bw = Math.ceil(gw / f);
  const bh = Math.ceil(gh / f);
  const bmin = new Float32Array(bw * bh).fill(Infinity);
  const bmax = new Float32Array(bw * bh).fill(-Infinity);
  for (let y = 0; y < gh; y++) {
    const by = (y / f) | 0;
    for (let x = 0; x < gw; x++) {
      const e = E[y * gw + x];
      if (e !== e) continue;
      const k = by * bw + ((x / f) | 0);
      if (e < bmin[k]) bmin[k] = e;
      if (e > bmax[k]) bmax[k] = e;
    }
  }
  const rb = Math.max(1, Math.round(R.reliefWindowM / 2 / (f * res)));
  const slide = (src: Float32Array, isMin: boolean): Float32Array => {
    const tmp = new Float32Array(bw * bh);
    const out = new Float32Array(bw * bh);
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) {
        let v = isMin ? Infinity : -Infinity;
        for (let k = Math.max(0, x - rb); k <= Math.min(bw - 1, x + rb); k++) {
          const s = src[y * bw + k];
          v = isMin ? (s < v ? s : v) : s > v ? s : v;
        }
        tmp[y * bw + x] = v;
      }
    for (let x = 0; x < bw; x++)
      for (let y = 0; y < bh; y++) {
        let v = isMin ? Infinity : -Infinity;
        for (let k = Math.max(0, y - rb); k <= Math.min(bh - 1, y + rb); k++) {
          const s = tmp[k * bw + x];
          v = isMin ? (s < v ? s : v) : s > v ? s : v;
        }
        out[y * bw + x] = v;
      }
    return out;
  };
  const wmin = slide(bmin, true);
  const wmax = slide(bmax, false);

  // Built-up areas (armour): 8-connected parts, width square to the movement, easy bypass on either side.
  const buaNogo = new Uint8Array(armour ? gw * gh : 0);
  const buaWidth = new Uint16Array(armour ? gw * gh : 0);
  const buaList: IpbStats['buaNogo'] = [];
  if (armour) {
    const lab = new Int32Array(gw * gh);
    const stack: number[] = [];
    let next = 0;
    const px = dir === null ? 1 : Math.cos(dir);
    const py = dir === null ? 0 : Math.sin(dir);
    const blocking = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= gw || y >= gh) return false;
      const c = C[y * gw + x];
      return R.water[c] === 1 || R.seasonal[c] === 1 || R.bua[c] === 1;
    };
    for (let i = 0; i < gw * gh; i++) {
      if (lab[i] || R.bua[C[i]] !== 1) continue;
      next++;
      const cells: number[] = [];
      stack.length = 0;
      stack.push(i);
      lab[i] = next;
      let minP = Infinity, maxP = -Infinity, minU = Infinity, maxU = -Infinity, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, sx = 0, sy = 0;
      while (stack.length) {
        const j = stack.pop() as number;
        cells.push(j);
        const x = j % gw;
        const y = (j / gw) | 0;
        sx += x;
        sy += y;
        const p = x * px + y * py;
        const u = x * ux + y * uy;
        if (p < minP) minP = p;
        if (p > maxP) maxP = p;
        if (u < minU) minU = u;
        if (u > maxU) maxU = u;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
            const k = yy * gw + xx;
            if (!lab[k] && R.bua[C[k]] === 1) {
              lab[k] = next;
              stack.push(k);
            }
          }
      }
      const widthM = dir === null ? (Math.max(maxX - minX, maxY - minY) + 1) * res : (maxP - minP + 1) * res;
      let nogo = widthM > R.buaWideM;
      let noBypass = false;
      if (!nogo) {
        // The bypass rows: 7 samples along the movement, 250 m beyond each flank.
        const cx = sx / cells.length;
        const cy = sy / cells.length;
        const half = (maxP - minP + 1) / 2 + R.buaBypassM / 2 / res;
        const uLo = dir === null ? -((maxY - minY) / 2) : minU - (cx * ux + cy * uy);
        const uHi = dir === null ? (maxY - minY) / 2 : maxU - (cx * ux + cy * uy);
        const side = (sgn: number): boolean => {
          let blocked = 0;
          for (let k = 0; k < 7; k++) {
            const t = uLo + ((uHi - uLo) * k) / 6;
            const xx = Math.round(cx + px * sgn * half + ux * t);
            const yy = Math.round(cy + py * sgn * half + uy * t);
            if (blocking(xx, yy)) blocked++;
          }
          return blocked >= 5;
        };
        noBypass = side(1) && side(-1);
        nogo = noBypass;
      }
      const wv = Math.min(65535, Math.round(widthM));
      for (const j of cells) {
        buaWidth[j] = wv;
        if (nogo) buaNogo[j] = noBypass ? 2 : 1;
      }
      if (nogo) buaList.push({ widthM: Math.round(widthM), noBypass, cells: cells.length });
    }
  }

  // Roads and tracks per km (armour, close country): summed-area tables over the grid.
  let roadsPerKm: ((x: number, y: number) => [number, number]) | null = null;
  if (vegApplies) {
    const sh = new Uint32Array((gw + 1) * (gh + 1));
    const st = new Uint32Array((gw + 1) * (gh + 1));
    for (let y = 0; y < gh; y++) {
      let rh = 0, rt = 0;
      for (let x = 0; x < gw; x++) {
        const c = C[y * gw + x];
        rh += R.hard[c];
        rt += R.track[c];
        sh[(y + 1) * (gw + 1) + x + 1] = sh[y * (gw + 1) + x + 1] + rh;
        st[(y + 1) * (gw + 1) + x + 1] = st[y * (gw + 1) + x + 1] + rt;
      }
    }
    const rr = Math.max(1, Math.round(R.roadsWindowM / 2 / res));
    roadsPerKm = (x, y) => {
      const xa = Math.max(0, x - rr), ya = Math.max(0, y - rr), xb = Math.min(gw, x + rr + 1), yb = Math.min(gh, y + rr + 1);
      const side = Math.sqrt((xb - xa) * (yb - ya)) * res; // m
      const sum = (t: Uint32Array) => t[yb * (gw + 1) + xb] - t[ya * (gw + 1) + xb] - t[yb * (gw + 1) + xa] + t[ya * (gw + 1) + xa];
      // A road one cell wide and n cells long is n x res metres. Its length in the window over the window's side is the
      // number of roads crossing a 1 km front: the book's "per kilometer" (my reading, IpbDoctrine.json coding.roads.perKm).
      return [(sum(sh) * res) / side, (sum(st) * res) / side];
    };
  }

  // Man-made obstacles from symbols.
  const manMade = new Uint8Array(a.obstacles && a.obstacles.length ? n : 0);
  if (manMade.length) {
    const mark = (x: number, y: number) => {
      const bx = Math.round(x) - x0;
      const by = Math.round(y) - y0;
      if (bx >= 0 && by >= 0 && bx < w && by < h) manMade[by * w + bx] = 1;
    };
    for (const o of a.obstacles as IpbObstacle[]) {
      const p = o.pts;
      if (p.length < 2) continue;
      if (o.kind === 'area' && p.length >= 3) {
        let ax = Infinity, bxx = -Infinity, ay = Infinity, byy = -Infinity;
        for (const q of p) {
          ax = Math.min(ax, q[0]);
          bxx = Math.max(bxx, q[0]);
          ay = Math.min(ay, q[1]);
          byy = Math.max(byy, q[1]);
        }
        for (let y = Math.max(y0, Math.floor(ay)); y <= Math.min(y1 - 1, Math.ceil(byy)); y++)
          for (let x = Math.max(x0, Math.floor(ax)); x <= Math.min(x1 - 1, Math.ceil(bxx)); x++) {
            let inside = false;
            for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
              const [xi, yi] = p[i];
              const [xj, yj] = p[j];
              if (yi > y + 0.5 !== yj > y + 0.5 && x + 0.5 < ((xj - xi) * (y + 0.5 - yi)) / (yj - yi) + xi) inside = !inside;
            }
            if (inside) manMade[(y - y0) * w + (x - x0)] = 1;
          }
      }
      for (let i = 1; i < p.length; i++) {
        const [xa, ya] = p[i - 1];
        const [xb, yb] = p[i];
        const steps = Math.max(1, Math.ceil(Math.hypot(xb - xa, yb - ya) * 2));
        for (let s = 0; s <= steps; s++) {
          const x = xa + ((xb - xa) * s) / steps;
          const y = ya + ((yb - ya) * s) / steps;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) mark(x + dx, y + dy);
        }
      }
    }
  }

  // Season rules (the terrain pamphlets).
  const inRann = !!a.lonLat && a.lonLat[0] >= R.rann.box[0] && a.lonLat[0] <= R.rann.box[2] && a.lonLat[1] >= R.rann.box[1] && a.lonLat[1] <= R.rann.box[3];
  const rannSeason = inRann && R.rann.months.includes(a.month);
  const snowSeason = R.snow.months.includes(a.month);
  const seasonCodes = a.season === 'coding';

  // Water: the narrowest run through the cell over four directions (cap 40 cells).
  const DIRS: Array<[number, number, number]> = [[1, 0, 1], [0, 1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2]];
  const isWet = (c: number) => R.water[c] === 1 || R.seasonal[c] === 1;
  const waterRun = (gx: number, gy: number): number => {
    let best = Infinity;
    for (const [dx, dy, step] of DIRS) {
      let k = 1;
      for (let s = 1; s < 40; s++) {
        const xx = gx + dx * s, yy = gy + dy * s;
        if (xx < 0 || yy < 0 || xx >= gw || yy >= gh || !isWet(C[yy * gw + xx])) break;
        k++;
      }
      for (let s = 1; s < 40; s++) {
        const xx = gx - dx * s, yy = gy - dy * s;
        if (xx < 0 || yy < 0 || xx >= gw || yy >= gh || !isWet(C[yy * gw + xx])) break;
        k++;
      }
      best = Math.min(best, k * step);
    }
    return best; // in cells (diagonals weighted)
  };

  const stats: IpbStats = {
    cells: 0,
    pct: { go: 0, slow: 0, nogo: 0, na: 0, nc: 0 },
    by: { slope: 0, relief: 0, bua: 0, water: 0, veg: 0, roads: 0, manMade: 0, season: 0 },
    naWater: 0,
    naVeg: 0,
    seasonalWater: 0,
    seasonNotes: 0,
    crossings: 0,
    buaNogo: buaList.sort((p, q) => q.widthM - p.widthM).slice(0, 8),
    notAssessed: [],
  };
  const counts = [0, 0, 0, 0, 0];
  let anyWater = false;

  for (let by = 0; by < h; by++) {
    const gy = y0 + by;
    for (let bx = 0; bx < w; bx++) {
      const gx = x0 + bx;
      const gi = gy * gw + gx;
      const i = by * w + bx;
      const c = C[gi];
      if (c === 255) {
        code[i] = IPB.NODATA;
        continue;
      }
      let worst = 0;
      let mask = 0;
      let flags = 0;
      const hit = (r: number, bit: number) => {
        if (r > worst) {
          worst = r;
          mask = bit;
        } else if (r === worst && r > 0) mask |= bit;
      };
      const e = E[gi];
      // 1 Slope
      if (e === e) {
        let s: number;
        if (dir === null) s = steepPct(gx, gy);
        else {
          const ef = eAt(gx + ox, gy + oy);
          const eb = eAt(gx - ox, gy - oy);
          s = ((ef - eb) / sDist) * 100;
        }
        if (s === s) {
          slope[i] = s;
          if (s >= R.nogoUphillPct) hit(2, WHY.SLOPE);
          else if (s >= R.slowUphillPct) hit(1, WHY.SLOPE);
          else if (s < 0 && Math.atan(-s / 100) / D2R >= R.goDeg) flags |= WHY.NC_SLOPE;
        }
        // 2 Relief
        const k = ((gy / f) | 0) * bw + ((gx / f) | 0);
        const rl = wmax[k] - wmin[k];
        if (Number.isFinite(rl)) {
          relief[i] = rl;
          if (rl > R.reliefTop) flags |= WHY.NC_RELIEF;
          else if (rl >= R.reliefNogo) hit(2, WHY.RELIEF);
          else if (rl >= R.reliefSlow) hit(1, WHY.RELIEF);
        }
      }
      // 3 Built-up areas (armour)
      if (armour && R.bua[c] === 1) {
        buaW[i] = buaWidth[gi];
        if (buaNogo[gi]) hit(2, WHY.BUA);
      }
      // 4 Hydrology
      if (R.crossing[c] === 1) {
        hit(1, WHY.WATER);
        flags |= WHY.CROSSING;
        stats.crossings++;
      } else if (R.seasonal[c] === 1) {
        flags |= WHY.NA_WATER | WHY.SEASONAL_WATER;
        stats.seasonalWater++;
        anyWater = true;
      } else if (R.water[c] === 1) {
        anyWater = true;
        const run = waterRun(gx, gy);
        const widthM = run * res;
        waterW[i] = Math.min(65535, Math.round(widthM));
        if (run <= 1.01) flags |= WHY.NA_WATER; // a line feature: no measurable width
        else if (widthM > a.avlbSpanM) hit(2, WHY.WATER);
        else {
          hit(1, WHY.WATER); // spannable by AVLB; bank height not recorded
          flags |= WHY.NA_WATER;
        }
      }
      // 5, 6 Vegetation (armour, mechanized) and roads (armour, close country)
      if (vegApplies && roadsPerKm && (R.veg[c] === 1 || (armour && R.close[c] === 1))) {
        const [ph, pt] = roadsPerKm(gx, gy);
        roadH[i] = Math.min(255, Math.round(ph * 10));
        roadT[i] = Math.min(255, Math.round(pt * 10));
        const roadsSlowOrBetter = ph >= 1 || pt >= 2;
        if (R.veg[c] === 1 && !roadsSlowOrBetter) flags |= WHY.NA_VEG; // tree thickness and spacing not recorded
        if (armour && R.close[c] === 1) {
          if (ph >= 2) hit(0, WHY.ROADS);
          else if (roadsSlowOrBetter) hit(1, WHY.ROADS);
          else hit(2, WHY.ROADS);
        }
      }
      // 7 Man-made obstacles
      if (manMade.length && manMade[i]) hit(2, WHY.MANMADE);
      // 8 Season rules
      let seasonal = false;
      if (rannSeason && R.rann.cls[c] === 1) seasonal = true;
      if (e === e && snowSeason && e > R.snow.aboveM) seasonal = true;
      if (e === e && (c === 8 || (e > 2000 && snowSeason))) {
        const st = steepPct(gx, gy);
        if (st === st && Math.atan(st / 100) / D2R > R.snowSlopeDeg) seasonal = true;
      }
      if (seasonal) {
        if (seasonCodes) hit(2, WHY.SEASON);
        else {
          flags |= WHY.NOTE_SEASON;
          stats.seasonNotes++;
        }
      }
      let out: number = worst;
      if (worst === 0 && flags & (WHY.NA_WATER | WHY.NA_VEG)) out = IPB.NA;
      else if (worst === 0 && flags & (WHY.NC_SLOPE | WHY.NC_RELIEF)) out = IPB.NC;
      code[i] = out;
      why[i] = mask | flags;
      counts[out]++;
      stats.cells++;
      if (worst > 0) {
        if (mask & WHY.SLOPE) stats.by.slope++;
        if (mask & WHY.RELIEF) stats.by.relief++;
        if (mask & WHY.BUA) stats.by.bua++;
        if (mask & WHY.WATER) stats.by.water++;
        if (mask & WHY.ROADS) stats.by.roads++;
        if (mask & WHY.MANMADE) stats.by.manMade++;
        if (mask & WHY.SEASON) stats.by.season++;
      }
      if (flags & WHY.NA_WATER) stats.naWater++;
      if (flags & WHY.NA_VEG) {
        stats.naVeg++;
        stats.by.veg++;
      }
    }
  }
  const tot = stats.cells || 1;
  stats.pct = { go: (100 * counts[0]) / tot, slow: (100 * counts[1]) / tot, nogo: (100 * counts[2]) / tot, na: (100 * counts[3]) / tot, nc: (100 * counts[4]) / tot };
  stats.notAssessed.push('Water table: not in the bundle');
  if (anyWater) stats.notAssessed.push('Water depth, current and bank height: not recorded');
  if (stats.naWater) stats.notAssessed.push('Width of line water features (canals, distributaries, drains, streams): not recorded');
  if (stats.naVeg) stats.notAssessed.push('Tree thickness and spacing: not recorded');
  return { x0, y0, w, h, res, mover: a.mover, moveDeg: a.moveDeg, avlbSpanM: a.avlbSpanM, season: a.season, code, why, slope, relief, waterW, buaW, roadH, roadT, stats, ms: now() - t0 };
}

// ── reasons ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface IpbReason {
  crit: 'slope' | 'relief' | 'bua' | 'water' | 'veg' | 'roads' | 'manMade' | 'season' | 'waterTable';
  cls: IpbClass;
  text: string;
}
const CLS_OF = ['go', 'slow', 'nogo', 'na', 'nc'] as const;
/** The cell's class word. */
export function ipbClassOf(c: number): IpbClass | null {
  return c < 5 ? CLS_OF[c] : null;
}
const r0 = (v: number) => Math.round(v);

/** Why one cell (in the coding's own cells) is coded as it is: every criterion that applies there, with its figure. */
export function ipbReasonsAt(c: IpbCoding, rules: IpbRules, bx: number, by: number): IpbReason[] {
  if (bx < 0 || by < 0 || bx >= c.w || by >= c.h) return [];
  const i = by * c.w + bx;
  if (c.code[i] === IPB.NODATA) return [];
  const y = c.why[i];
  const out: IpbReason[] = [];
  const s = c.slope[i];
  const sDeg = Math.atan(Math.abs(s) / 100) / D2R;
  const along = c.moveDeg === null ? 'steepest slope' : s >= 0 ? 'uphill' : 'downhill';
  if (s >= rules.nogoUphillPct) out.push({ crit: 'slope', cls: 'nogo', text: `Slope ${r0(s)} % ${along}: NO-GO (${rules.nogoUphillPct} % or more, IPB p 10)` });
  else if (s >= rules.slowUphillPct) out.push({ crit: 'slope', cls: 'slow', text: `Slope ${r0(s)} % ${along}: SLOW-GO (${rules.slowUphillPct}-${rules.nogoUphillPct} %, IPB p 10)` });
  else if (y & WHY.NC_SLOPE) out.push({ crit: 'slope', cls: 'nc', text: `Slope ${r0(sDeg)}° downhill: not classed by the book (GO is under ${rules.goDeg}°, p 11)` });
  else out.push({ crit: 'slope', cls: 'go', text: `Slope ${r0(Math.abs(s))} % ${along}: GO (under ${rules.goDeg}°, IPB p 11)` });
  const rl = c.relief[i];
  if (y & WHY.NC_RELIEF) out.push({ crit: 'relief', cls: 'nc', text: `Relief ${r0(rl)} m per km: not classed by the book (over ${rules.reliefTop})` });
  else if (rl >= rules.reliefNogo) out.push({ crit: 'relief', cls: 'nogo', text: `Relief ${r0(rl)} m per km: NO-GO (${rules.reliefNogo}-${rules.reliefTop}, IPB p 10)` });
  else if (rl >= rules.reliefSlow) out.push({ crit: 'relief', cls: 'slow', text: `Relief ${r0(rl)} m per km: SLOW-GO (${rules.reliefSlow}-${rules.reliefNogo}, IPB p 11)` });
  if (c.buaW[i]) out.push({ crit: 'bua', cls: y & WHY.BUA ? 'nogo' : 'go', text: y & WHY.BUA ? (c.buaW[i] > rules.buaWideM ? `BUA ${r0(c.buaW[i])} m wide: NO-GO for armour (over ${rules.buaWideM} m, IPB p 9)` : `BUA ${r0(c.buaW[i])} m wide with no easy bypass on either side: NO-GO for armour (IPB p 9)`) : `BUA ${r0(c.buaW[i])} m wide, bypass on a flank: not NO-GO by the book` });
  if (y & WHY.CROSSING) out.push({ crit: 'water', cls: 'slow', text: 'Crossing (bridge or ford): SLOW-GO; read the load class on the GROTBC card' });
  else if (y & WHY.SEASONAL_WATER) out.push({ crit: 'water', cls: 'na', text: 'Seasonal water: depth not recorded, not assessed' });
  else if (c.waterW[i]) {
    if (y & WHY.WATER && c.code[i] === IPB.NOGO && c.waterW[i] > c.avlbSpanM) out.push({ crit: 'water', cls: 'nogo', text: `Water about ${r0(c.waterW[i])} m wide: NO-GO, wider than the AVLB span (${c.avlbSpanM} m, IPB p 9)` });
    else if (y & WHY.WATER) out.push({ crit: 'water', cls: 'slow', text: `Water about ${r0(c.waterW[i])} m wide: spannable by AVLB, SLOW-GO; bank height not recorded` });
    else out.push({ crit: 'water', cls: 'na', text: 'Water too narrow to measure (a line feature): width not recorded, not assessed' });
  }
  if (y & WHY.NA_VEG) out.push({ crit: 'veg', cls: 'na', text: `Trees: thickness and spacing not recorded, not assessed (${c.mover === 'armour' ? 'NO-GO for armour at 6-8 in, < 20 ft' : 'SLOW-GO for mechanized at "2 -" in, < 20 ft'}, IPB p 10)` });
  if (c.roadH[i] || c.roadT[i] || y & WHY.ROADS) {
    const ph = c.roadH[i] / 10, pt = c.roadT[i] / 10;
    const cls: IpbClass = ph >= 2 ? 'go' : ph >= 1 || pt >= 2 ? 'slow' : 'nogo';
    out.push({ crit: 'roads', cls, text: `Close country, ${ph.toFixed(1)} hard Rds and ${pt.toFixed(1)} Trs per km: ${cls === 'go' ? 'GO' : cls === 'slow' ? 'SLOW-GO' : 'NO-GO'} for armour (IPB pp 10-12)` });
  }
  if (y & WHY.MANMADE) out.push({ crit: 'manMade', cls: 'nogo', text: 'Man-made obstacle on the map: NO-GO (IPB p 10)' });
  if (y & WHY.SEASON) out.push({ crit: 'season', cls: 'nogo', text: 'Season rule (Rann June-November / above 2500 m in winter / snow slope over 35°): NO-GO' });
  if (y & WHY.NOTE_SEASON) out.push({ crit: 'season', cls: 'na', text: 'Season rule applies here (shown as a note, not in the coding)' });
  out.push({ crit: 'waterTable', cls: 'na', text: 'Water table: not in the bundle, not assessed' });
  return out;
}

/** One line for the area: shares and what decided them. */
export function ipbSummaryText(c: IpbCoding): string {
  const p = c.stats.pct;
  const pc = (v: number) => `${v < 1 && v > 0 ? '<1' : Math.round(v)} %`;
  const by = c.stats.by;
  const top = Object.entries(by)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k)
    .join(', ');
  return `IPB coding (${c.mover}): NO-GO ${pc(p.nogo)} · SLOW-GO ${pc(p.slow)} · GO ${pc(p.go)} · not assessed ${pc(p.na)} · not classed ${pc(p.nc)}${top ? ` · mostly ${top}` : ''}`;
}
