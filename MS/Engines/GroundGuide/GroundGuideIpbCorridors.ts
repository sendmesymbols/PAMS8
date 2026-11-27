/**
 * GroundGuideIpbCorridors.ts
 *
 * Mobility corridors and avenues of approach (IPB_Plan.md §6.2; C&SC IPB book pp 7, 12, 16; ATP 2-01.3 Table 4-2) from
 * the book's coding of an area (GroundGuideIpb.ts). Pure: no DOM, no view, no I/O, no imports beyond the coding's
 * types, so the same module runs in the browser and in Node (`node tools/ipb-test/corridors.mjs`).
 *
 * The area read is a frame laid along the direction of movement (the threat's side to the own side for enemy
 * approaches, the other way for own ones), sampled every 30 m (60 m for a Div HQ). In it:
 *   1. Obstacles are the book's NO-GO, SLOW-GO, not classed and not assessed ground (water lines whose width is not
 *      recorded and crossings are crossed, they do not narrow a corridor, as on the AOR scale). Patches too small to
 *      shape a corridor of this width (under a quarter of the width squared, joined across one sample) are left out:
 *      a corridor is relatively free of obstacles, not empty of them.
 *   2. Free width at a sample: the run of ground free of the obstacles kept, across the axis (the corridor's width).
 *   3. The way a force would go: one least-cost field from the start edge (GO 1, SLOW-GO and not assessed at the book's
 *      day rates for the mover: GO km/h over SLOW-GO km/h, IPB p 18, vehicles 24 / 16 = 1.5, foot 4 / 2.4 = 1.67; 3
 *      without the rates; NO-GO never crossed, ground nearer an obstacle than half a corridor width dearer). The frame's end edge is cut into strips
 *      (two spacings wide) and the cheapest way back from each strip is traced: in open ground they run straight and
 *      apart; where the ground canalises they meet at the same gaps and bridges, and a way that repeats another is one
 *      avenue, not two. A way that cannot reach the end edge stops where it was stopped (an avenue may end abruptly).
 *   4. Mobility corridors are counted along each way: how many corridor widths fit side by side in its free width
 *      (two levels down: Coy 500 m for a Bde HQ, Bn 1.5 km for a Div HQ). An avenue holds at least two corridors side by
 *      side (book p 12: a viable avenue contains two or more) over most of its length; a way that holds one is a lone
 *      corridor, not an avenue; less, no corridor. Where it holds less than one (a gap, a bridge, SLOW-GO) is a narrows,
 *      its width measured there. The corridors of an avenue are drawn side by side inside it.
 *   5. Crossover: where corridor-free ground joins two neighbouring avenues across, the deepest such stretch.
 *   6. Avenues are ranked on the going until the proforma (Phase 4): cost, how far through the area they run, GO share,
 *      room (corridors side by side), narrows (proposal, basis E). Lettered A, B, C by rank; corridors A1, A2 left to
 *      right as the mover sees.
 *   7. Approaches onto an objective (`objective`; user, 2026-11-14: "it does not need to end up on symbol, every symbol
 *      have echelon and each echelon have frontage"): the book's avenues run through the whole area regardless of
 *      objectives, so they pass the position. With an objective (its frontage x depth box, facing the start edge), a
 *      second field is laid from where the mover sets out (a place, else the start edge) with the objective and the ground
 *      round it out to almost the FUP distance kept out, and three ways are traced: frontal (to an FUP that far in front
 *      of the front edge), left and right flank (to an FUP that far off each flank, level with the objective's middle),
 *      each then a straight assault to the middle of that edge (IBB p 201: FUP not less than 1,000-1,200 m from the
 *      objective, out of night-sight range; p 203: 1,000 to 1,200 m in plains, less in broken ground and BUAs; pp 173-174:
 *      start line at right angles to the line of advance), the axes converging on it. Flanks rank above frontal (user: frontal attack is dangerous, a
 *      flanking attack is encouraged; OoW Vol II s6). Their distances run along the way from where it sets out.
 *      With `objective.turn` (a choke on the MSR behind the objective: a bridge, a defile, a junction), a fourth, turning
 *      approach goes round the objective, out of its ground (up to twice the FUP distance clear), to that choke to block
 *      the MSR (OoW Vol II s6: a turning movement threatens a significant objective in the defender's rear; user: a
 *      flanking attack that chokes the en MSR is encouraged). It ranks first when the way round is as good going as the
 *      flanks' (its bonus falls with its cost against the cheapest approach); dearer going ranks it with the flanks.
 *   8. Review fixes (23 Nov 2026): with the elevation (`elev`) the slope is judged along each way's own heading, not the
 *      frame axis (a cell the coding classed for slope alone is passable; an edge climbing the book's SLOW-GO figure is
 *      dearer as SLOW-GO ground is, the NO-GO figure impassable; a stretch of a way climbing so is a 'steep' narrows); the free
 *      width is measured square to the way, not along the sample row (a gap oblique to the axis read wider than it is);
 *      the strips are as wide as an avenue can be (two corridors and the spacing between), not two spacings, so a Div
 *      frame can show more than three avenues; two ways through the same narrows are one avenue; with the book's rates
 *      (`rates`) the day time along each avenue is in the rank (8 points an hour over the fastest) and its reasons.
 */

import { IPB, WHY, type IpbCoding } from './GroundGuideIpb';

export interface IpbFrame {
  /** Centre of the start edge, coding cells (x right, y down, the coding's own box). */
  sx: number;
  sy: number;
  /** Direction of movement, grid bearing in degrees (0 up / north, 90 right / east). */
  axisDeg: number;
  /** Along the axis and across it, metres. */
  lengthM: number;
  widthM: number;
}

export interface IpbCorridorArgs {
  coding: IpbCoding;
  frame: IpbFrame;
  /** The corridor width of the level read (book p 12, ATP T4-2): Coy 500 m for a Bde HQ, Bn 1.5 km for a Div HQ. */
  mcWidthM: number;
  /** The farthest apart two corridors of one avenue may be: 2 km for a Bde HQ, 6 km for a Div HQ. */
  spacingM: number;
  /** The threat's arc, degrees (kept for the record; the ways follow the ground). */
  sectorDeg: number;
  /** Strips cut across the end edge (default the frame's width over two spacings, 1 to 6). */
  strips?: number;
  /**
   * The objective the approaches end on: the middle of its box along and across the axis (metres from the start edge's
   * middle; across positive to the right of the movement), its frontage (across) and depth (along), and the FUP
   * distance. `from`: where the mover sets out (a frontage across the axis at a place), else the whole start edge.
   */
  objective?: {
    alongM: number;
    acrossM: number;
    frontageM: number;
    depthM: number;
    fupM: number;
    from?: { alongM: number; acrossM: number; halfWidthM: number } | null;
    /** A choke on the MSR behind the objective (along / across as above): the turning approach blocks it. */
    turn?: { alongM: number; acrossM: number } | null;
  };
  /**
   * The elevation under the coding (the grid it was coded from: the coding's x0 / y0 offsets apply) and the book's
   * uphill figures (IPB p 10: SLOW-GO 30-45 %, NO-GO 45 % or more). With it the slope is judged along each way's own
   * heading; without it the coding's slope along the frame axis stands.
   */
  elev?: { data: Float32Array; w: number; h: number; slowPct: number; nogoPct: number } | null;
  /**
   * The book's day rates for the mover, km/h on GO and on SLOW-GO (IPB p 18): the time along each avenue, in the rank,
   * and SLOW-GO's weight in the least-cost field (GO km/h over SLOW-GO km/h; user, 24 Nov 2026: follow the book rates).
   * Without them SLOW-GO weighs 3 (the vehicles' night ratio, 24 / 8).
   */
  rates?: { goKmh: number; slowKmh: number } | null;
}

/**
 * Which way an approach comes onto the objective: square on its front, onto its left or right flank as the mover sees,
 * or turning round it to a choke on the MSR behind it.
 */
export type IpbOntoKind = 'frontal' | 'left' | 'right' | 'turn';

/** A crossing (bridge, ford), a SLOW-GO stretch, a gap narrower than a corridor, or a climb at the book's SLOW-GO figure or worse along the way. */
export type IpbNarrowsKind = 'crossing' | 'slow' | 'narrow' | 'steep';
export interface IpbNarrows {
  /** Coding cells. */
  x: number;
  y: number;
  /** From the frame's start edge, metres. */
  alongM: number;
  /** Width of the way through, metres. */
  widthM: number;
  kind: IpbNarrowsKind;
  /** A 'steep' narrows: the climb along the way, %. */
  slopePct?: number;
  /** The avenue (or lone corridor) it is on. */
  on: string;
}

export interface IpbMc {
  id: string;
  /** The avenue it belongs to, or null for a lone corridor. */
  aa: string | null;
  /** Centre line, coding cells [x0, y0, x1, y1, ...], in the direction of movement. */
  line: Float32Array;
}

export interface IpbAa {
  id: string;
  rank: number;
  /** False: a lone corridor (one corridor wide most of the way), not an avenue. */
  viable: boolean;
  mcs: string[];
  /** Room for three or more corridors side by side over most of its length. */
  open: boolean;
  /** Centre line, coding cells, smoothed, in the direction of movement. */
  line: Float32Array;
  /** Free width across at each point, metres (capped), and the distance from the start edge. */
  widthM: Float32Array;
  alongM: Float32Array;
  startM: number;
  endM: number;
  lengthM: number;
  /** It stops short of the end edge (stopped by NO-GO with no way on). */
  stopped: boolean;
  /** How much of the frame's length it runs, %. */
  coverPct: number;
  /** Share of its length with two corridors side by side, and with one, %. */
  twoPct: number;
  onePct: number;
  /** Share of GO in its band, %. */
  goPct: number;
  /** Share of its length climbing at the book's SLOW-GO figure or worse along the way, % (0 without the elevation). */
  steepPct: number;
  /** Hours along it at the book's day rates (GO / SLOW-GO km/h for the mover); null without the rates. */
  hoursDay: number | null;
  /** The width to draw it at the back, metres: its corridors side by side (two, three when open, one when lone). */
  drawWidthM: number;
  /** Median free width, and the narrowest outside the narrows, metres. */
  medianWidthM: number;
  minWidthM: number;
  narrows: IpbNarrows[];
  waterLines: number;
  /** Ranking (higher is better going for the user of the avenue) and its reasons. */
  score: number;
  why: string[];
  /** Mean place across the frame, metres (negative: left of the movement). */
  sideM: number;
  /** Set on an approach onto the objective: which way it comes on, its FUP and where it meets the objective (coding cells). */
  onto?: IpbOntoKind;
  fup?: [number, number];
  hit?: [number, number];
  /** The assault from the FUP to the objective's edge, metres, and how much of it is NO-GO, %. */
  assaultM?: number;
  assaultNogoPct?: number;
}

export interface IpbCrossover {
  id: string;
  a: string;
  b: string;
  /** Coding cells. */
  from: [number, number];
  to: [number, number];
  alongM: number;
  /** How deep (along the axis) the two stay joined by free ground, metres. */
  depthM: number;
}

export interface IpbCorridors {
  /** Avenues (viable first, by rank), then lone corridors. */
  aas: IpbAa[];
  mcs: IpbMc[];
  crossovers: IpbCrossover[];
  mcWidthM: number;
  spacingM: number;
  stepM: number;
  /** The frame's corners, coding cells: start-left, start-right, end-right, end-left. */
  corners: Array<[number, number]>;
  /** Short facts for the cards ("No way through the area for this mover"). */
  notes: string[];
  /** Why each strip's way was kept or left out (for the Engine Log and the checks). */
  ways: string[];
  /** Approaches onto the objective (best first), empty without one; the objective's corners (coding cells) and notes. */
  onto: IpbAa[];
  objective: Array<[number, number]> | null;
  ontoNotes: string[];
  ms: number;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// Sample kinds.
const K_GO = 1;
const K_LINE = 2; // water line, width not recorded
const K_CROSS = 3; // bridge or ford
const K_SLOW = 4; // SLOW-GO or not classed
const K_NOGO = 5;
const K_NA = 6; // not assessed (not a line)
const K_NONE = 7; // outside the coding / no data

/** The corridors and avenues in a frame of a coded area. */
export function findCorridors(a: IpbCorridorArgs): IpbCorridors {
  const t0 = now();
  const c = a.coding;
  const res = c.res;
  const mcW = Math.max(res * 2, a.mcWidthM);
  const f = mcW >= 1200 ? 2 : 1; // a Div HQ's 1.5 km corridors: 60 m samples
  const s = res * f;
  const fr = a.frame;
  const NM = Math.max(1, Math.round(Math.max(mcW, 300) / s));
  const NR = Math.max(3, Math.round(fr.lengthM / s));
  const NCf = Math.max(3, Math.round(fr.widthM / s));
  const NC = NCf + 2 * NM;
  const N = NR * NC;
  const th = (fr.axisDeg * Math.PI) / 180;
  const Fx = Math.sin(th), Fy = -Math.cos(th);
  const Rx = Math.cos(th), Ry = Math.sin(th);
  const halfW = fr.widthM / 2;
  // A point (along a, across q metres) -> coding cell; sample (i, j) is its centre.
  const at = (aM: number, qM: number): [number, number] => [fr.sx + (aM * Fx + qM * Rx) / res, fr.sy + (aM * Fy + qM * Ry) / res];
  const toCell = (i: number, j: number): [number, number] => at((i + 0.5) * s, (j - NM + 0.5) * s - halfW);
  const corners: Array<[number, number]> = [at(0, -halfW), at(0, halfW), at(fr.lengthM, halfW), at(fr.lengthM, -halfW)];

  // 1. Sample the coding (with 60 m samples: a crossing in the block wins, then any NO-GO, then half SLOW-GO).
  const kind = new Uint8Array(N);
  const lineCell = Math.max(1.5 * res, 45);
  const EL = a.elev ?? null;
  // The coding's reasons for a class (its flags apart): a cell classed for slope alone is passable when the elevation is
  // given, the slope being judged along each way's own heading instead (the book's uphill is along the movement).
  const REASONS = WHY.SLOPE | WHY.RELIEF | WHY.BUA | WHY.WATER | WHY.VEG | WHY.ROADS | WHY.MANMADE | WHY.SEASON;
  const cellKind = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= c.w || y >= c.h) return K_NONE;
    const q = y * c.w + x;
    const code = c.code[q], why = c.why[q];
    if (code === IPB.NODATA) return K_NONE;
    if (why & WHY.CROSSING) return K_CROSS;
    if (code === IPB.GO) return K_GO;
    if (EL && (why & REASONS) === WHY.SLOPE && code !== IPB.NA) return K_GO;
    if (code === IPB.NOGO) return K_NOGO;
    if (code === IPB.NA) return why & WHY.NA_WATER && !(why & WHY.SEASONAL_WATER) && c.waterW[q] <= lineCell ? K_LINE : K_NA;
    return K_SLOW;
  };
  for (let i = 0; i < NR; i++)
    for (let j = 0; j < NC; j++) {
      if (f === 1) {
        const [x, y] = toCell(i, j);
        kind[i * NC + j] = cellKind(Math.floor(x), Math.floor(y));
        continue;
      }
      let cross = 0, nogo = 0, slow = 0, na = 0, line = 0, none = 0;
      for (let u = 0; u < f; u++)
        for (let v = 0; v < f; v++) {
          const [x, y] = at((i * f + u + 0.5) * res, ((j - NM) * f + v + 0.5) * res - halfW);
          const k = cellKind(Math.floor(x), Math.floor(y));
          if (k === K_CROSS) cross++;
          else if (k === K_NOGO) nogo++;
          else if (k === K_SLOW) slow++;
          else if (k === K_NA) na++;
          else if (k === K_LINE) line++;
          else if (k === K_NONE) none++;
        }
      const half = (f * f) / 2;
      kind[i * NC + j] = cross ? K_CROSS : none >= half ? K_NONE : nogo ? K_NOGO : slow >= half ? K_SLOW : na >= half ? K_NA : line ? K_LINE : K_GO;
    }
  const restricts = (k: number): boolean => k !== K_GO && k !== K_LINE && k !== K_CROSS;
  const passes = (k: number): boolean => k !== K_NOGO && k !== K_NONE;
  // The elevation at each sample (the mean of its fine cells), for the slope along the way.
  const ez = new Float32Array(N).fill(NaN);
  if (EL) {
    const eAt = (x: number, y: number): number => {
      const gx = x + c.x0, gy = y + c.y0;
      return gx < 0 || gy < 0 || gx >= EL.w || gy >= EL.h ? NaN : EL.data[gy * EL.w + gx];
    };
    for (let i = 0; i < NR; i++)
      for (let j = 0; j < NC; j++) {
        let t = 0, m = 0;
        for (let u = 0; u < f; u++)
          for (let v = 0; v < f; v++) {
            const [x, y] = at((i * f + u + 0.5) * res, ((j - NM) * f + v + 0.5) * res - halfW);
            const e = eAt(Math.floor(x), Math.floor(y));
            if (e === e) ((t += e), m++);
          }
        if (m) ez[i * NC + j] = t / m;
      }
  }
  const slowPct = EL?.slowPct ?? 30, nogoPct = EL?.nogoPct ?? 45;
  /**
   * The climb from sample q0 to its neighbour q1 along the way, % (NaN without the elevation). A diagonal step is judged
   * by the worst of its two components as well: a slope is not cheated by zigzagging up it (a 45 % slope taken at
   * 45 degrees would read 32 %).
   */
  const rise = (qa: number, qb: number, d: number): number => {
    const ea = ez[qa], eb = ez[qb];
    return ea === ea && eb === eb && d > 0 ? ((eb - ea) / d) * 100 : NaN;
  };
  const climbPct = (q0: number, q1: number): number => {
    const i0 = (q0 / NC) | 0, i1 = (q1 / NC) | 0, j0 = q0 - i0 * NC, j1 = q1 - i1 * NC;
    const di = i1 - i0, dj = j1 - j0;
    const direct = rise(q0, q1, Math.hypot(di, dj) * s);
    if (!di || !dj) return direct;
    const qa = i1 * NC + j0, qb = i0 * NC + j1;
    let worst = direct;
    for (const v of [rise(q0, qa, s), rise(qa, q1, s), rise(q0, qb, s), rise(qb, q1, s)]) if (v === v && !(v <= worst)) worst = v;
    return worst;
  };

  // 2. Obstacles kept: restricting patches (joined across one sample) at least a quarter of the corridor width squared.
  const block = new Uint8Array(N);
  {
    const seen = new Uint8Array(N);
    const minArea = Math.max(4, Math.round((mcW / 2) ** 2 / (s * s)));
    const stack: number[] = [];
    const members: number[] = [];
    for (let q0 = 0; q0 < N; q0++) {
      if (seen[q0] || !restricts(kind[q0])) continue;
      seen[q0] = 1;
      stack.push(q0);
      members.length = 0;
      let none = false;
      while (stack.length) {
        const q = stack.pop()!;
        members.push(q);
        if (kind[q] === K_NONE) none = true;
        const i = (q / NC) | 0, j = q - i * NC;
        for (let di = -2; di <= 2; di++) {
          const ii = i + di;
          if (ii < 0 || ii >= NR) continue;
          for (let dj = -2; dj <= 2; dj++) {
            const jj = j + dj;
            if (jj < 0 || jj >= NC) continue;
            const qq = ii * NC + jj;
            if (seen[qq] || !restricts(kind[qq])) continue;
            seen[qq] = 1;
            stack.push(qq);
          }
        }
      }
      if (none || members.length >= minArea) for (const q of members) block[q] = 1;
    }
  }

  // 3. Free runs across each row: the run each sample lies in (-1 on an obstacle kept) and its width in samples.
  const runOf = new Int32Array(N).fill(-1);
  const runW = new Uint16Array(N);
  let runCount = 0;
  for (let i = 0; i < NR; i++) {
    let j = 0;
    while (j < NC) {
      if (block[i * NC + j]) {
        j++;
        continue;
      }
      let e = j;
      while (e + 1 < NC && !block[i * NC + e + 1]) e++;
      const id = runCount++;
      for (let k = j; k <= e; k++) {
        runOf[i * NC + k] = id;
        runW[i * NC + k] = Math.min(65535, e - j + 1);
      }
      j = e + 1;
    }
  }
  // Distance to the nearest obstacle kept (3-4 chamfer, thirds of a sample), for the cost of tight ground.
  const dt = new Int32Array(N);
  const BIG = 1 << 28;
  for (let q = 0; q < N; q++) dt[q] = block[q] ? 0 : BIG;
  for (let i = 0; i < NR; i++)
    for (let j = 0; j < NC; j++) {
      const q = i * NC + j;
      let v = dt[q];
      if (!v) continue;
      if (j > 0) v = Math.min(v, dt[q - 1] + 3);
      if (i > 0) {
        v = Math.min(v, dt[q - NC] + 3);
        if (j > 0) v = Math.min(v, dt[q - NC - 1] + 4);
        if (j < NC - 1) v = Math.min(v, dt[q - NC + 1] + 4);
      }
      dt[q] = v;
    }
  for (let i = NR - 1; i >= 0; i--)
    for (let j = NC - 1; j >= 0; j--) {
      const q = i * NC + j;
      let v = dt[q];
      if (!v) continue;
      if (j < NC - 1) v = Math.min(v, dt[q + 1] + 3);
      if (i < NR - 1) {
        v = Math.min(v, dt[q + NC] + 3);
        if (j < NC - 1) v = Math.min(v, dt[q + NC + 1] + 4);
        if (j > 0) v = Math.min(v, dt[q + NC - 1] + 4);
      }
      dt[q] = v;
    }

  // 4. Cost and one least-cost field from the start edge. SLOW-GO (and not assessed ground, taken as SLOW-GO) weighs what
  // the book's day rates make it: the time to cross it against GO (vehicles 1.5, foot 1.67); 3 without the rates.
  const halfMc = mcW / 2;
  const slowW = a.rates && a.rates.slowKmh > 0 && a.rates.goKmh > 0 ? Math.max(1, a.rates.goKmh / a.rates.slowKmh) : 3;
  const cost = new Float32Array(N);
  for (let q = 0; q < N; q++) {
    const k = kind[q];
    if (!passes(k)) {
      cost[q] = Infinity;
      continue;
    }
    let m = k === K_SLOW || k === K_NA ? slowW : 1;
    const clear = (dt[q] * s) / 3;
    if (clear < halfMc) m *= 1 + 2 * (1 - clear / halfMc);
    cost[q] = m;
  }
  /**
   * One least-cost field over `cst` from the `src` samples (8 neighbours, never slipping between two NO-GO corners).
   * `until`: stop once all of these samples are settled (the rest of the field is not needed).
   */
  const field = (cst: Float32Array, src: number[], until?: number[]): { G: Float32Array; P: Int32Array } => {
    const G = new Float32Array(N).fill(Infinity);
    const P = new Int32Array(N).fill(-1);
    const heap: number[] = [];
    const key = new Float32Array(N);
    const push = (q: number, g: number): void => {
      key[q] = g;
      let k = heap.length;
      heap.push(q);
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (key[heap[p]] <= g) break;
        heap[k] = heap[p];
        k = p;
      }
      heap[k] = q;
    };
    const pop = (): number => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        const g = key[last];
        let k = 0;
        const n = heap.length;
        for (;;) {
          let ch = 2 * k + 1;
          if (ch >= n) break;
          if (ch + 1 < n && key[heap[ch + 1]] < key[heap[ch]]) ch++;
          if (key[heap[ch]] >= g) break;
          heap[k] = heap[ch];
          k = ch;
        }
        heap[k] = last;
      }
      return top;
    };
    for (const q of src) {
      if (cst[q] === Infinity) continue;
      G[q] = 0;
      push(q, 0);
    }
    const done = new Uint8Array(N);
    const DI = [0, 0, 1, -1, 1, 1, -1, -1], DJ = [1, -1, 0, 0, 1, -1, 1, -1];
    const want = until ? new Set(until.filter((q) => cst[q] !== Infinity)) : null;
    while (heap.length) {
      const q = pop();
      if (done[q]) continue;
      done[q] = 1;
      if (want && want.delete(q) && !want.size) break;
      const i = (q / NC) | 0, j = q - i * NC;
      const cq = cst[q];
      for (let k = 0; k < 8; k++) {
        const ii = i + DI[k], jj = j + DJ[k];
        if (ii < 0 || jj < 0 || ii >= NR || jj >= NC) continue;
        const qq = ii * NC + jj;
        if (done[qq] || cst[qq] === Infinity) continue;
        if (k >= 4 && cst[i * NC + jj] === Infinity && cst[ii * NC + j] === Infinity) continue; // no slipping between two NO-GO corners
        // The slope along this edge (the book's uphill is along the movement): a climb at the NO-GO figure is not
        // crossed, at the SLOW-GO figure as dear as SLOW-GO ground is.
        let em = 1;
        if (EL) {
          const cl = climbPct(q, qq);
          if (cl >= nogoPct) continue;
          if (cl >= slowPct) em = slowW;
        }
        const g = G[q] + (k < 4 ? 1 : Math.SQRT2) * s * 0.5 * (cq + cst[qq]) * em;
        if (g < G[qq]) {
          G[qq] = g;
          P[qq] = q;
          push(qq, g);
        }
      }
    }
    return { G, P };
  };
  const startRow: number[] = [];
  for (let j = 0; j < NC; j++) startRow.push(j);
  const { G, P } = field(cost, startRow);

  // 5. The cheapest way back from each strip of the end edge (or from the farthest row reached in the strip). A strip is
  // as wide as an avenue can be at most: two corridors side by side and the spacing between them (p 12), so a 30 km Div
  // frame holds four Bde avenues, a 14 km Bde frame five Bn ones (at most eight).
  const K = Math.max(1, Math.min(8, a.strips ?? Math.ceil(fr.widthM / (a.spacingM + 2 * mcW))));
  // Ways within half the spacing of one kept for most of their length are corridors of the same avenue (p 12); so are
  // two ways through the same narrows (one bridge is one avenue, whatever the ways do before and after it).
  const dil = Math.max(1, Math.round(Math.max(halfMc, a.spacingM / 2) / s));
  const taken = new Uint8Array(N);
  const takenTight = new Uint8Array(N);
  const tightAt = (q: number): boolean => !block[q] && runW[q] * s < mcW;
  interface Way { cells: number[]; g: number; stopped: boolean }
  const ways: Way[] = [];
  const cands: Way[] = [];
  for (let k = 0; k < K; k++) {
    const c0 = NM + Math.floor((k * NCf) / K), c1 = NM + Math.floor(((k + 1) * NCf) / K);
    const mid = (c0 + c1 - 1) / 2;
    let end = -1, stopped = false;
    for (let i = NR - 1; i >= 0 && end < 0; i--) {
      // The cheapest end in the strip; where costs are all but equal (open ground), the one nearest its middle.
      let best = Infinity;
      for (let j = c0; j < c1; j++) {
        const q = i * NC + j;
        if (G[q] === Infinity) continue;
        const v = G[q] + Math.abs(j - mid) * s * 0.3;
        if (v < best) ((best = v), (end = q));
      }
      if (end >= 0 && i < NR - 1) stopped = true;
    }
    if (end < 0) continue;
    const cells: number[] = [];
    for (let q = end; q >= 0; q = P[q]) cells.push(q);
    cells.reverse();
    if (cells.length >= 2) cands.push({ cells, g: G[end], stopped });
  }
  // The cheapest first; a way that mostly repeats one already kept is the same avenue.
  const wayNotes: string[] = [];
  const sideKm = (w: Way): string => (((w.cells.reduce((t, q) => t + (q % NC), 0) / w.cells.length - NM + 0.5) * s - halfW) / 1000).toFixed(1);
  cands.sort((p, q) => p.g / p.cells.length - q.g / q.cells.length);
  for (const w of cands) {
    let rep = 0, shared = 0;
    for (const q of w.cells) {
      if (taken[q]) rep++;
      if (takenTight[q] && tightAt(q)) shared++;
    }
    if (rep / w.cells.length >= 0.6) {
      wayNotes.push(`way at ${sideKm(w)} km: repeats one kept (${Math.round((100 * rep) / w.cells.length)} %)`);
      continue;
    }
    if (shared >= 2) {
      wayNotes.push(`way at ${sideKm(w)} km: through the same narrows as one kept`);
      continue;
    }
    ways.push(w);
    for (const q of w.cells) {
      const i = (q / NC) | 0, j = q - i * NC;
      const tq = tightAt(q);
      for (let di = -dil; di <= dil; di++)
        for (let dj = -dil; dj <= dil; dj++) {
          const ii = i + di, jj = j + dj;
          if (ii >= 0 && jj >= 0 && ii < NR && jj < NC) {
            taken[ii * NC + jj] = 1;
            if (tq) takenTight[ii * NC + jj] = 1;
          }
        }
    }
  }

  // 6. Along each way: corridors side by side, narrows, measures.
  const SM = Math.max(3, Math.round((1.5 * mcW) / s)); // smoothing half-window, samples
  const smooth = (vals: number[], r: number): number[] => {
    const out = new Array<number>(vals.length);
    let t = 0, m = 0, lo = 0, hi = -1;
    for (let k = 0; k < vals.length; k++) {
      const a0 = Math.max(0, k - r), a1 = Math.min(vals.length - 1, k + r);
      while (hi < a1) ((t += vals[++hi]), m++);
      while (lo < a0) ((t -= vals[lo++]), m--);
      out[k] = t / m;
    }
    return out;
  };
  const lineLen = (pts: Array<[number, number]>): number => {
    let L = 0;
    for (let k = 1; k < pts.length; k++) L += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]) * res;
    return L;
  };
  const passAt = (i: number, j: number): boolean => j >= 0 && j < NC && passes(kind[i * NC + j]);
  /** The run of ground that passes round column j of row i: its width and what it is. */
  const passRun = (i: number, j: number): { widthM: number; kind: IpbNarrowsKind } => {
    let l = j, r = j;
    if (kind[i * NC + j] === K_CROSS) {
      // A crossing: the bridge or ford itself, across the row.
      while (l - 1 >= 0 && kind[i * NC + l - 1] === K_CROSS) l--;
      while (r + 1 < NC && kind[i * NC + r + 1] === K_CROSS) r++;
      return { widthM: (r - l + 1) * s, kind: 'crossing' };
    }
    while (l - 1 >= 0 && passAt(i, l - 1) && block[i * NC + l - 1] === block[i * NC + j]) l--;
    while (r + 1 < NC && passAt(i, r + 1) && block[i * NC + r + 1] === block[i * NC + j]) r++;
    let cross = 0, slow = 0, go = 0;
    for (let k = l; k <= r; k++) {
      const v = kind[i * NC + k];
      if (v === K_CROSS) cross++;
      else if (v === K_SLOW || v === K_NA) slow++;
      else go++;
    }
    return { widthM: (r - l + 1) * s, kind: cross ? 'crossing' : slow > go ? 'slow' : 'narrow' };
  };
  const capM = Math.max(4 * mcW, 3 * a.spacingM);
  const capS = Math.ceil(capM / s);
  /**
   * The free width square to the way at sample (i, j) with heading (hi, hj), samples: the run of ground free of the
   * obstacles kept, walked out both ways along the perpendicular. Along the axis it is the sample row's run.
   */
  const perpWidth = (i: number, j: number, hi: number, hj: number): number => {
    const q = i * NC + j;
    if (block[q]) return 0;
    if (Math.abs(hj) < 0.17) return runW[q]; // within 10 degrees of the axis: the row's run
    const pi = -hj, pj = hi;
    let n = 1;
    for (const sg of [1, -1])
      for (let t = 1; t <= capS; t++) {
        const ii = Math.round(i + sg * pi * t), jj = Math.round(j + sg * pj * t);
        if (ii < 0 || jj < 0 || ii >= NR || jj >= NC || block[ii * NC + jj]) break;
        n++;
      }
    return n;
  };
  const fmtH = (h: number): string => {
    const m = Math.max(1, Math.round(h * 60));
    return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
  };
  interface Draft { w: Way; ii: number[]; jj: number[]; js: number[]; widthM: number[]; fit: number[]; twoPct: number; onePct: number; goPct: number; steepPct: number; hours: number | null; medW: number; minW: number; narrows: Array<{ i: number; j: number; k: number; widthM: number; kind: IpbNarrowsKind; slopePct?: number }>; lines: number; cover: number; sideJ: number; viable: boolean; open: boolean; score: number; why: string[]; medFit: number; tight: number }
  const drafts: Draft[] = [];
  const notes: string[] = [];
  /** Along a way: corridors side by side, narrows, measures. `keep`: kept even when narrower than a corridor (an approach). */
  const measure = (w: Way, keep: boolean): Draft | null => {
    const ii = w.cells.map((q) => (q / NC) | 0);
    const jj = w.cells.map((q, k) => q - ii[k] * NC);
    const n = w.cells.length;
    // The way's heading at each sample (over two samples either side) and the free width square to it.
    const widthM = w.cells.map((_, k) => {
      const k0 = Math.max(0, k - 2), k1 = Math.min(n - 1, k + 2);
      let hi = ii[k1] - ii[k0], hj = jj[k1] - jj[k0];
      const L = Math.hypot(hi, hj) || 1;
      hi /= L;
      hj /= L;
      return perpWidth(ii[k], jj[k], hi, hj) * s;
    });
    const fit = widthM.map((v) => Math.min(3, Math.floor(v / mcW)));
    // The climb along the way at each sample (the worse of its steps either side), %; NaN without the elevation.
    const climb = w.cells.map((_, k) => {
      if (!EL || n < 2) return NaN;
      const a0 = k > 0 ? climbPct(w.cells[k - 1], w.cells[k]) : NaN, a1 = k < n - 1 ? climbPct(w.cells[k], w.cells[k + 1]) : NaN;
      return a0 === a0 && a1 === a1 ? Math.max(a0, a1) : a0 === a0 ? a0 : a1;
    });
    const steepAt = (k: number): boolean => climb[k] >= slowPct;
    const twoPct = (100 * fit.filter((v) => v >= 2).length) / n;
    const onePct = (100 * fit.filter((v) => v >= 1).length) / n;
    const viable = twoPct >= 60;
    if (!keep) wayNotes.push(`way at ${sideKm(w)} km: two side by side ${Math.round(twoPct)} %, one ${Math.round(onePct)} %${w.stopped ? ', stopped' : ''}${!viable && onePct < 60 ? ': no corridor' : viable ? ': avenue' : ': lone corridor'}`);
    if (!viable && onePct < 60 && !keep) return null; // narrower than a corridor most of the way: no corridor here
    // Narrows: stretches where less than one corridor fits, at their narrowest.
    const narrows: Draft['narrows'] = [];
    let run: { k: number; w: number } | null = null;
    const flush = (): void => {
      if (!run) return;
      const q = w.cells[run.k];
      const pr = block[q] || kind[q] === K_CROSS ? passRun(ii[run.k], jj[run.k]) : { widthM: widthM[run.k], kind: 'narrow' as IpbNarrowsKind };
      narrows.push({ i: ii[run.k], j: jj[run.k], k: run.k, widthM: Math.max(s, pr.widthM), kind: kind[q] === K_CROSS ? 'crossing' : pr.kind });
      run = null;
    };
    // Stretches less than a corridor width apart are one narrows (reported at the narrowest; a crossing wins).
    const joinRows = Math.max(2, Math.round(mcW / s));
    let good = 0;
    for (let k = 0; k < n; k++) {
      if (fit[k] < 1) {
        const q = w.cells[k];
        const wd = block[q] ? passRun(ii[k], jj[k]).widthM : widthM[k];
        const cross = kind[q] === K_CROSS;
        if (!run || (cross && kind[w.cells[run.k]] !== K_CROSS) || (wd < run.w && !(kind[w.cells[run.k]] === K_CROSS && !cross))) run = { k, w: wd };
        good = 0;
      } else if (run && ++good >= joinRows) {
        flush();
        good = 0;
      }
    }
    flush();
    // Steep stretches: climbs at the book's SLOW-GO figure or worse along the way, each at its steepest.
    {
      let st: { k: number; cl: number; last: number } | null = null;
      const end = (): void => {
        if (!st) return;
        narrows.push({ i: ii[st.k], j: jj[st.k], k: st.k, widthM: Math.max(s, widthM[st.k]), kind: 'steep', slopePct: Math.round(st.cl) });
        st = null;
      };
      for (let k = 0; k < n; k++) {
        if (steepAt(k)) {
          if (st && k - st.last > joinRows) end();
          if (!st) st = { k, cl: climb[k], last: k };
          else if (climb[k] > st.cl) ((st.k = k), (st.cl = climb[k]));
          st.last = k;
        }
      }
      end();
    }
    const steepN = climb.filter((v) => v >= slowPct).length;
    const steepPct = (100 * steepN) / n;
    // The time along it at the book's day rates: SLOW-GO where the ground is SLOW-GO or not assessed, or climbing so.
    let hours: number | null = null;
    if (a.rates) {
      let h = 0;
      for (let k = 1; k < n; k++) {
        const kk = kind[w.cells[k]];
        const slow = kk === K_SLOW || kk === K_NA || steepAt(k);
        h += (Math.hypot(ii[k] - ii[k - 1], jj[k] - jj[k - 1]) * s) / 1000 / Math.max(0.1, slow ? a.rates.slowKmh : a.rates.goKmh);
      }
      hours = h;
    }
    // Water lines crossed.
    let lines = 0, prev = false;
    for (const q of w.cells) {
      const on = kind[q] === K_LINE;
      if (on && !prev) lines++;
      prev = on;
    }
    // GO share in a band one or two corridors wide round the way.
    const band = Math.max(1, Math.round(((viable ? 2 : 1) * mcW) / 2 / s));
    let go = 0, all = 0;
    for (let k = 0; k < n; k++)
      for (let d = -band; d <= band; d++) {
        const j = jj[k] + d;
        if (j < 0 || j >= NC) continue;
        const v = kind[ii[k] * NC + j];
        if (v === K_NONE) continue;
        all++;
        if (v === K_GO || v === K_LINE || v === K_CROSS) go++;
      }
    const goPct = all ? (100 * go) / all : 0;
    const sorted = widthM.slice().sort((p, q) => p - q);
    const medW = Math.min(capM, sorted[Math.floor(sorted.length / 2)]);
    const wide = widthM.filter((_, k) => fit[k] >= 1);
    const minW = wide.length ? Math.min(...wide) : 0;
    const cover = Math.min(1, ((ii[n - 1] - ii[0]) * s) / fr.lengthM);
    const js = smooth(jj, SM);
    const sideJ = jj.reduce((t, v) => t + v, 0) / n;
    const medFit = fit.slice().sort((p, q) => p - q)[Math.floor(n / 2)];
    const tight = narrows.filter((q) => q.widthM < halfMc).length;
    const d: Draft = { w, ii, jj, js, widthM, fit, twoPct, onePct, goPct, steepPct, hours, medW, minW, narrows, lines, cover, sideJ, viable, open: medFit >= 3, score: 0, why: [], medFit, tight };
    d.score = 15 * cover + 0.3 * goPct - 0.3 * steepPct + 6 * medFit - 5 * narrows.length - 6 * tight - (w.stopped ? 10 : 0);
    d.why = [
      w.stopped ? `stops after ${Math.round(cover * 100)} % of the area` : 'runs the whole area',
      viable ? (medFit >= 3 ? 'room for 3+ corridors' : '2 corridors side by side') : '1 corridor: lone',
      `${Math.round(goPct)} % GO`,
      ...(steepPct >= 1 ? [`climbs ${slowPct} %+ for ${Math.round(steepPct)} % of the way`] : []),
      narrows.length ? `${narrows.length} narrows` : 'no narrows',
    ];
    return d;
  };
  /** The time at the book's rates into the score and the reasons: 8 points an hour over the fastest of the set. */
  const timeRank = (set: Draft[]): void => {
    const hs = set.map((d) => d.hours).filter((h): h is number => h !== null);
    if (!hs.length) return;
    const hMin = Math.min(...hs);
    for (const d of set) {
      if (d.hours === null) continue;
      d.score -= 8 * (d.hours - hMin);
      d.why.push(`${fmtH(d.hours)} at the book's day rates`);
    }
  };
  for (const w of ways) {
    const d = measure(w, false);
    if (d) drafts.push(d);
  }
  // The cheaper way also counts: a share of the score from its cost against the cheapest.
  const gMin = Math.min(...drafts.map((d) => d.w.g / Math.max(1, d.w.cells.length)));
  for (const d of drafts) d.score += 25 * (gMin / Math.max(1e-6, d.w.g / Math.max(1, d.w.cells.length)));
  timeRank(drafts);
  drafts.sort((p, q) => (p.viable === q.viable ? q.score - p.score : p.viable ? -1 : 1));

  // 7. Letters, corridors side by side inside each avenue, and the output.
  const LET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const aas: IpbAa[] = [];
  const mcs: IpbMc[] = [];
  drafts.forEach((d, r) => {
    const id = LET[r] ?? `Z${r}`;
    const cells = d.js.map((j, k) => toCell(d.ii[k], j));
    const line = new Float32Array(cells.length * 2);
    cells.forEach((p, k) => ((line[k * 2] = p[0]), (line[k * 2 + 1] = p[1])));
    // Corridors: two (one for a lone corridor) side by side, a corridor width apart, kept inside the free run.
    const nMc = d.viable ? 2 : 1;
    const ids: string[] = [];
    for (let m = 0; m < nMc; m++) {
      const off = nMc === 1 ? 0 : (m - 0.5) * 1.2 * (mcW / s);
      const ojs = d.js.map((j, k) => {
        const q = d.w.cells[k];
        const rid = runOf[q];
        if (rid < 0 || nMc === 1) return j;
        let l = d.jj[k], rr = d.jj[k];
        while (l - 1 >= 0 && runOf[d.ii[k] * NC + l - 1] === rid) l--;
        while (rr + 1 < NC && runOf[d.ii[k] * NC + rr + 1] === rid) rr++;
        const lo = l + halfMc / s, hi = rr - halfMc / s;
        return lo > hi ? (l + rr) / 2 : Math.min(hi, Math.max(lo, j + off));
      });
      const sm = smooth(ojs, SM);
      const mc = sm.map((j, k) => toCell(d.ii[k], j));
      const ml = new Float32Array(mc.length * 2);
      mc.forEach((p, k) => ((ml[k * 2] = p[0]), (ml[k * 2 + 1] = p[1])));
      const mid = `${id}${m + 1}`;
      ids.push(mid);
      mcs.push({ id: mid, aa: d.viable ? id : null, line: ml });
    }
    const narrows = d.narrows.map((q) => {
      const [x, y] = toCell(q.i, q.j);
      return { x, y, alongM: (q.i + 0.5) * s, widthM: q.widthM, kind: q.kind, ...(q.slopePct !== undefined ? { slopePct: q.slopePct } : {}), on: id };
    }).sort((p, q) => p.widthM - q.widthM);
    const n = d.ii.length;
    aas.push({
      id,
      rank: r + 1,
      viable: d.viable,
      mcs: ids,
      open: d.open,
      line,
      widthM: Float32Array.from(d.widthM.map((v) => Math.min(capM, v))),
      alongM: Float32Array.from(d.ii.map((i) => (i + 0.5) * s)),
      startM: (d.ii[0] + 0.5) * s,
      endM: (d.ii[n - 1] + 0.5) * s,
      lengthM: lineLen(cells),
      stopped: d.w.stopped,
      coverPct: Math.round(d.cover * 100),
      twoPct: d.twoPct,
      onePct: d.onePct,
      goPct: d.goPct,
      steepPct: d.steepPct,
      hoursDay: d.hours,
      drawWidthM: mcW * (d.viable ? (d.open ? 3 : 2.2) : 1),
      medianWidthM: d.medW,
      minWidthM: d.minW,
      narrows,
      waterLines: d.lines,
      score: d.score,
      why: d.why,
      sideM: (d.sideJ - NM + 0.5) * s - halfW,
    });
  });

  // 8. Crossovers: neighbouring avenues joined across by one free run, the deepest such stretch.
  const crossovers: IpbCrossover[] = [];
  const order = drafts.map((d, r) => ({ d, id: aas[r].id, viable: d.viable })).filter((x) => x.viable).sort((p, q) => p.d.sideJ - q.d.sideJ);
  for (let k = 0; k + 1 < order.length; k++) {
    const A = order[k].d, B = order[k + 1].d;
    const rowA = new Map<number, number>(), rowB = new Map<number, number>();
    A.ii.forEach((i, q) => rowA.set(i, A.jj[q]));
    B.ii.forEach((i, q) => rowB.set(i, B.jj[q]));
    let runLen = 0, best = 0, bestEnd = -1, both = 0, joined = 0;
    for (let i = 0; i < NR; i++) {
      const ja = rowA.get(i), jb = rowB.get(i);
      if (ja !== undefined && jb !== undefined) both++;
      const ok = ja !== undefined && jb !== undefined && Math.abs(jb - ja) >= 2 && runOf[i * NC + ja] >= 0 && runOf[i * NC + ja] === runOf[i * NC + jb];
      if (ok) joined++;
      runLen = ok ? runLen + 1 : 0;
      if (runLen > best) ((best = runLen), (bestEnd = i));
    }
    // Joined by free ground nearly all the way: one open area, not two avenues with a crossover between them.
    if (best * s >= mcW && joined < 0.7 * both) {
      const i = bestEnd - Math.floor(best / 2);
      crossovers.push({ id: `X${crossovers.length + 1}`, a: order[k].id, b: order[k + 1].id, from: toCell(i, rowA.get(i)!), to: toCell(i, rowB.get(i)!), alongM: (i + 0.5) * s, depthM: best * s });
    }
  }

  // 9. Approaches onto the objective (see the header, step 7).
  const onto: IpbAa[] = [];
  const ontoNotes: string[] = [];
  let objective: Array<[number, number]> | null = null;
  if (a.objective) {
    const o = a.objective;
    const W2 = Math.max(0, o.frontageM) / 2, D2 = Math.max(0, o.depthM) / 2;
    const fupM = Math.max(s * 2, o.fupM);
    objective = [at(o.alongM - D2, o.acrossM - W2), at(o.alongM - D2, o.acrossM + W2), at(o.alongM + D2, o.acrossM + W2), at(o.alongM + D2, o.acrossM - W2)];
    const rowOf = (aM: number): number => Math.round(aM / s - 0.5);
    const colOf = (qM: number): number => Math.round((qM + halfW) / s - 0.5 + NM);
    const inGrid = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < NR && j < NC;
    // The objective and the ground round it out to almost the FUP distance are kept out of the approach (the assault
    // from the FUP is the only way in), so a flank approach swings wide instead of skirting the front.
    const keepM = 0.85 * fupM;
    const cost2 = cost.slice();
    const ki0 = rowOf(o.alongM - D2 - keepM), ki1 = rowOf(o.alongM + D2 + keepM);
    const kj0 = colOf(o.acrossM - W2 - keepM), kj1 = colOf(o.acrossM + W2 + keepM);
    for (let i = Math.max(0, ki0); i <= Math.min(NR - 1, ki1); i++) for (let j = Math.max(0, kj0); j <= Math.min(NC - 1, kj1); j++) cost2[i * NC + j] = Infinity;
    const src: number[] = [];
    if (o.from) {
      const fi = rowOf(o.from.alongM);
      const fj0 = colOf(o.from.acrossM - o.from.halfWidthM), fj1 = colOf(o.from.acrossM + o.from.halfWidthM);
      for (let i = fi - 1; i <= fi + 1; i++) for (let j = Math.min(fj0, fj1); j <= Math.max(fj0, fj1); j++) if (inGrid(i, j) && cost2[i * NC + j] !== Infinity) src.push(i * NC + j);
    }
    if (!src.length) {
      if (o.from) ontoNotes.push('The start lies in the ground kept clear round the Obj: approaches read from the far edge of the area');
      for (let j = 0; j < NC; j++) if (cost2[j] !== Infinity) src.push(j);
    }
    // The last row the mover starts on: a flank's own-side band never begins at or before it (else a start within the
    // band in line with the Obj has every source cell blocked and the flank is reported impossible on open ground).
    let srcLastRow = -1;
    for (const q of src) srcLastRow = Math.max(srcLastRow, Math.floor(q / NC));
    const word: Record<IpbOntoKind, string> = { frontal: 'Frontal', left: 'Left flank', right: 'Right flank', turn: 'Turning' };
    // A flank approach keeps to its own side for the last stretch before the objective (at least 3 km, twice the FUP
    // distance): out of the objective's front, the way an envelopment goes round (OoW Vol II s6). Before that it may
    // share the best ground with the others. A mover starting nearer than that keeps to its side from the row after its
    // start (it moves out to its side on its start row).
    const sideM = Math.min(mcW / 2, fupM / 2);
    const bandM = Math.max(3000, 2 * fupM);
    const sided = (kind: 'left' | 'right'): Float32Array => {
      const c3 = cost2.slice();
      const i0 = Math.max(0, rowOf(o.alongM - D2 - bandM), srcLastRow + 1), i1 = Math.min(NR - 1, rowOf(o.alongM + D2 + keepM));
      const jEdge = kind === 'left' ? colOf(o.acrossM - W2 - sideM) : colOf(o.acrossM + W2 + sideM);
      for (let i = i0; i <= i1; i++)
        for (let j = 0; j < NC; j++) if (kind === 'left' ? j > jEdge : j < jEdge) c3[i * NC + j] = Infinity;
      return c3;
    };
    const targets: Array<{ kind: IpbOntoKind; fup: [number, number]; hit: [number, number] }> = [
      { kind: 'frontal', fup: [o.alongM - D2 - fupM, o.acrossM], hit: [o.alongM - D2, o.acrossM] },
      { kind: 'left', fup: [o.alongM, o.acrossM - W2 - fupM], hit: [o.alongM, o.acrossM - W2] },
      { kind: 'right', fup: [o.alongM, o.acrossM + W2 + fupM], hit: [o.alongM, o.acrossM + W2] },
    ];
    // The turning approach: round the objective, clear of its ground, to the MSR choke behind it.
    let turnCost: Float32Array | null = null;
    if (o.turn) {
      const da = Math.max(0, Math.abs(o.turn.alongM - o.alongM) - D2), dq = Math.max(0, Math.abs(o.turn.acrossM - o.acrossM) - W2);
      const clearM = Math.min(2 * fupM, Math.hypot(da, dq) - mcW);
      if (!inGrid(rowOf(o.turn.alongM), colOf(o.turn.acrossM))) ontoNotes.push('Turning: the MSR choke lies outside the area read');
      else if (clearM < 300) ontoNotes.push('Turning: the MSR choke lies too close to the Obj to go round to it');
      else {
        turnCost = cost.slice();
        const c = Math.max(keepM, clearM);
        const ti0 = rowOf(o.alongM - D2 - c), ti1 = rowOf(o.alongM + D2 + c), tj0 = colOf(o.acrossM - W2 - c), tj1 = colOf(o.acrossM + W2 + c);
        for (let i = Math.max(0, ti0); i <= Math.min(NR - 1, ti1); i++) for (let j = Math.max(0, tj0); j <= Math.min(NC - 1, tj1); j++) turnCost[i * NC + j] = Infinity;
        targets.push({ kind: 'turn', fup: [o.turn.alongM, o.turn.acrossM], hit: [o.turn.alongM, o.turn.acrossM] });
      }
    }
    interface OntoDraft { d: Draft; t: (typeof targets)[number]; fupQ: number; fupK: number; hitQ: number; assaultM: number; nogoPct: number; g: number; ratio: number }
    const ods: OntoDraft[] = [];
    for (const t of targets) {
      const fi = rowOf(t.fup[0]), fj = colOf(t.fup[1]);
      const turning = t.kind === 'turn';
      // The FUP: the reachable sample nearest the place, within half the FUP distance (moving it costs); for the turning
      // approach the choke itself, within half a corridor.
      const rr = Math.max(1, Math.round((turning ? mcW / 2 : 0.5 * fupM) / s));
      const win: number[] = [];
      for (let di = -rr; di <= rr; di++) for (let dj = -rr; dj <= rr; dj++) if (inGrid(fi + di, fj + dj) && di * di + dj * dj <= rr * rr) win.push((fi + di) * NC + fj + dj);
      const { G: G2, P: P2 } = field(turning ? turnCost! : t.kind === 'frontal' ? cost2 : sided(t.kind as 'left' | 'right'), src, win);
      let best = -1, bv = Infinity;
      for (let di = -rr; di <= rr; di++)
        for (let dj = -rr; dj <= rr; dj++) {
          const i = fi + di, j = fj + dj;
          if (!inGrid(i, j) || di * di + dj * dj > rr * rr) continue;
          const q = i * NC + j;
          if (G2[q] === Infinity) continue;
          const v = G2[q] + Math.hypot(di, dj) * s * 6;
          if (v < bv) ((bv = v), (best = q));
        }
      if (best < 0) {
        ontoNotes.push(`${word[t.kind]}: ${turning ? 'no way round the Obj to the MSR choke' : inGrid(fi, fj) ? `no way to an FUP ${Math.round(fupM)} m short` : 'no room for its FUP in the area read'}`);
        continue;
      }
      const cells: number[] = [];
      for (let q = best; q >= 0; q = P2[q]) cells.push(q);
      cells.reverse();
      const fupK = cells.length - 1;
      if (turning) {
        // No assault: the way ends astride the MSR at the choke.
        if (cells.length < 2) continue;
        const d = measure({ cells, g: G2[best], stopped: false }, true);
        if (d) ods.push({ d, t, fupQ: best, fupK, hitQ: best, assaultM: 0, nogoPct: 0, g: G2[best], ratio: 1 });
        continue;
      }
      // The assault: straight from the FUP to the middle of the objective's edge.
      const bi = (best / NC) | 0, bj = best - bi * NC;
      const hi = Math.min(NR - 1, Math.max(0, rowOf(t.hit[0]))), hj = Math.min(NC - 1, Math.max(0, colOf(t.hit[1])));
      const steps = Math.max(Math.abs(hi - bi), Math.abs(hj - bj));
      let nogo = 0;
      for (let k = 1; k <= steps; k++) {
        const q = Math.round(bi + ((hi - bi) * k) / steps) * NC + Math.round(bj + ((hj - bj) * k) / steps);
        if (q !== cells[cells.length - 1]) cells.push(q);
        if (!passes(kind[q])) nogo++;
      }
      if (cells.length < 2) continue;
      const d = measure({ cells, g: G2[best], stopped: false }, true);
      if (!d) continue;
      ods.push({ d, t, fupQ: best, fupK, hitQ: hi * NC + hj, assaultM: Math.hypot(hi - bi, hj - bj) * s, nogoPct: steps ? (100 * nogo) / steps : 0, g: G2[best], ratio: 1 });
    }
    // Ranked on the going and the cost; a flank above the frontal one (user: frontal is dangerous, flanking encouraged);
    // the turning approach first only while the way round is as good going as the flanks' (its bonus 15-30 by its cost
    // against the cheapest approach), else it ranks with them.
    const gm = Math.min(...ods.map((x) => x.g / Math.max(1, x.d.w.cells.length)));
    for (const x of ods) {
      const d = x.d;
      x.ratio = gm / Math.max(1e-6, x.g / Math.max(1, d.w.cells.length));
      const kindPts = x.t.kind === 'frontal' ? -25 : x.t.kind === 'turn' ? 15 + 15 * x.ratio : 15;
      d.score = 0.3 * d.goPct - 0.3 * d.steepPct + 6 * d.medFit - 5 * d.narrows.length - 6 * d.tight + 25 * x.ratio + kindPts - (x.nogoPct > 30 ? 10 : 0);
    }
    timeRank(ods.map((x) => x.d));
    ods.sort((p, q) => q.d.score - p.d.score);
    const SMo = Math.max(2, Math.round((0.6 * mcW) / s));
    ods.forEach((x, r) => {
      const d = x.d;
      const n = d.ii.length;
      // The way to the FUP smoothed both ways (an approach turns), its ends kept where they are; the assault stays straight.
      const fk = Math.min(n - 1, x.fupK);
      const si = [...smooth(d.ii.slice(0, fk + 1), SMo), ...d.ii.slice(fk + 1)];
      const sj = [...smooth(d.jj.slice(0, fk + 1), SMo), ...d.jj.slice(fk + 1)];
      si[0] = d.ii[0];
      sj[0] = d.jj[0];
      si[fk] = d.ii[fk];
      sj[fk] = d.jj[fk];
      const pts = si.map((i, k) => toCell(i, sj[k]));
      const cum = [0];
      for (let k = 1; k < n; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]) * res);
      const line = new Float32Array(n * 2);
      pts.forEach((pt, k) => ((line[k * 2] = pt[0]), (line[k * 2 + 1] = pt[1])));
      const id = LET[r] ?? `Z${r}`;
      const fq = x.fupQ, fiq = (fq / NC) | 0;
      const hiq = (x.hitQ / NC) | 0;
      onto.push({
        id,
        rank: r + 1,
        viable: true,
        mcs: [],
        open: d.open,
        line,
        widthM: Float32Array.from(d.widthM.map((v) => Math.min(capM, v))),
        alongM: Float32Array.from(cum),
        startM: 0,
        endM: cum[n - 1],
        lengthM: cum[n - 1],
        stopped: false,
        coverPct: 100,
        twoPct: d.twoPct,
        onePct: d.onePct,
        goPct: d.goPct,
        steepPct: d.steepPct,
        hoursDay: d.hours,
        drawWidthM: mcW * (d.viable ? 2.2 : 1),
        medianWidthM: d.medW,
        minWidthM: d.minW,
        narrows: d.narrows
          .map((q) => {
            const [nx, ny] = toCell(q.i, q.j);
            return { x: nx, y: ny, alongM: cum[q.k] ?? 0, widthM: q.widthM, kind: q.kind, ...(q.slopePct !== undefined ? { slopePct: q.slopePct } : {}), on: id };
          })
          .sort((p, q) => p.widthM - q.widthM),
        waterLines: d.lines,
        score: d.score,
        why: [
          d.viable ? (d.medFit >= 3 ? 'room for 3+ corridors' : '2 corridors side by side') : d.onePct >= 60 ? '1 corridor: tight' : 'narrower than a corridor',
          `${Math.round(d.goPct)} % GO`,
          ...(d.steepPct >= 1 ? [`climbs ${slowPct} %+ for ${Math.round(d.steepPct)} % of the way`] : []),
          d.narrows.length ? `${d.narrows.length} narrows` : 'no narrows',
          ...(x.t.kind === 'turn' ? ['round the Obj to block its MSR', x.ratio >= 0.8 ? 'the way round as good going as the flanks: first' : 'the way round dearer going: ranked with the flanks'] : [`FUP ${Math.round(fupM)} m short`]),
          ...(x.nogoPct > 0 ? [`assault ${Math.round(x.nogoPct)} % NO-GO`] : []),
          ...(d.hours !== null ? [`${fmtH(d.hours)} at the book's day rates`] : []),
        ],
        sideM: (d.sideJ - NM + 0.5) * s - halfW,
        onto: x.t.kind,
        fup: x.t.kind === 'turn' ? undefined : toCell(fiq, fq - fiq * NC),
        hit: toCell(hiq, x.hitQ - hiq * NC),
        assaultM: x.assaultM,
        assaultNogoPct: x.nogoPct,
      });
    });
    if (!onto.length) ontoNotes.push('No approach onto the Obj for this mover');
  }

  if (!ways.length) notes.push('No way through the area for this mover');
  else if (!aas.length) notes.push(`No corridor ${Math.round(mcW)} m wide runs through the area`);
  else if (!aas.some((x) => x.viable)) notes.push('Lone corridors only: none holds two corridors side by side');
  return { aas, mcs, crossovers, mcWidthM: mcW, spacingM: a.spacingM, stepM: s, corners, notes, ways: wayNotes, onto, objective, ontoNotes, ms: now() - t0 };
}

/** How wide the head is against the neck (MainAttack's barbs stand well out from the shaft). */
const HEAD_WIDEN = 1.9;
/** Head length against the head's half-width: about 2.5 gives a head about as long as it is wide (a 22 degree point). */
const HEAD_LONG = 2.5;

/**
 * The share of an arrow's length its head takes, so the head keeps its shape whatever the arrow's length (user,
 * 2026-11-14: "the arrow head is stretched and looks ugly"): a fixed 15 % (MainAttack.ts's HEAD_RATIO default) gives a
 * long arrow a needle of a head. Head length = HEAD_LONG x head half-width, head half-width = HEAD_WIDEN x the shaft's
 * half-width at the neck (tail x (head length + total / 2.4)), solved for the head length; kept between 2.5 % and 15 %.
 * Pass it as HEAD_RATIO to the MS MainAttack / SupportingAttack / AvenueOfApchs symbols so they match.
 */
export function arrowHeadFrac(tail: number): number {
  const k = HEAD_LONG * HEAD_WIDEN * tail;
  const frac = k < 0.95 ? k / 2.4 / (1 - k) : 0.15;
  return Math.min(0.15, Math.max(0.025, frac));
}

/**
 * The tail factor (MainAttack.ts TAIL_FACTOR) for an avenue's arrow: its corridors side by side at the back (`widthM`),
 * but never thinner than 8 % of its length (a long thin arrow and its head cannot be read on the map), nor wider than
 * 1.2 spacings (neighbouring avenues must not overlap). The corridors inside it are drawn at their own width.
 */
export function arrowTail(lengthM: number, widthM: number, spacingM: number): number {
  const back = Math.max(widthM, Math.min(0.08 * lengthM, 1.2 * spacingM));
  return Math.min(0.12, back / (2 * Math.max(1, lengthM + lengthM / 2.4)));
}

/** Chaikin corner cutting (ends kept): a polyline with rounded bends, as MainAttack.ts's Bezier gives. */
function rounded(pts: Array<[number, number]>, times = 3): Array<[number, number]> {
  let p = pts;
  for (let t = 0; t < times && p.length > 2; t++) {
    const out: Array<[number, number]> = [p[0]];
    for (let i = 0; i + 1 < p.length; i++) {
      const [ax, ay] = p[i], [bx, by] = p[i + 1];
      if (i > 0) out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by]);
      if (i + 1 < p.length - 1) out.push([0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

/**
 * The outline of an open-back attack arrow along a centre line (the MS MainAttack / SupportingAttack shape,
 * MainAttack.ts `createComplexArrow`): half-width = tail x (length still to go + total / 2.4), so the back is widest; the
 * head's length from `arrowHeadFrac` (in proportion to its width, not a fixed share of the length). The centre line's
 * bends are rounded first. Points in any planar units; returns the fill ring (closed), the stroke (left side, head, right
 * side: the back left open) and, for a main attack, the inner line in the head.
 */
export function attackArrow(pts0: Array<[number, number]>, tail: number, main: boolean, headFrac = arrowHeadFrac(tail)): { fill: Array<[number, number]>; stroke: Array<[number, number]>; inner: Array<[number, number]> } {
  if (pts0.length < 2) return { fill: [], stroke: [], inner: [] };
  const pts = rounded(pts0);
  const n = pts.length;
  const cum = [0];
  for (let k = 1; k < n; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  const total = cum[n - 1] || 1;
  // The neck: exactly the head's length back from the tip, along the line.
  const headAt = total * (1 - headFrac);
  let jn = 0;
  while (jn + 1 < n && cum[jn + 1] <= headAt) jn++;
  const seg = cum[Math.min(n - 1, jn + 1)] - cum[jn] || 1;
  const t = Math.min(1, Math.max(0, (headAt - cum[jn]) / seg));
  const nb = pts[Math.min(n - 1, jn + 1)];
  const neckPt: [number, number] = [pts[jn][0] + (nb[0] - pts[jn][0]) * t, pts[jn][1] + (nb[1] - pts[jn][1]) * t];
  const body = [...pts.slice(0, jn + 1), neckPt];
  const bodyCum = [...cum.slice(0, jn + 1), headAt];
  const Lf: Array<[number, number]> = [], Rt: Array<[number, number]> = [];
  body.forEach((p, k) => {
    const a = body[Math.max(0, k - 1)], b = body[Math.min(body.length - 1, k + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    const hw = tail * (total - bodyCum[k] + total / 2.4);
    Lf.push([p[0] - dy * hw, p[1] + dx * hw]);
    Rt.push([p[0] + dy * hw, p[1] - dx * hw]);
  });
  const tip = pts[n - 1];
  const neck = neckPt;
  let dx = tip[0] - neck[0], dy = tip[1] - neck[1];
  const d = Math.hypot(dx, dy) || 1;
  dx /= d;
  dy /= d;
  const hw = tail * (total - headAt + total / 2.4) * HEAD_WIDEN;
  const hl: [number, number] = [neck[0] - dy * hw, neck[1] + dx * hw];
  const hr: [number, number] = [neck[0] + dy * hw, neck[1] - dx * hw];
  const stroke: Array<[number, number]> = [...Lf, hl, tip, hr, ...Rt.slice().reverse()];
  const fill = [...stroke, Lf[0]];
  let inner: Array<[number, number]> = [];
  if (main) {
    const iw = hw * 0.55;
    inner = [[neck[0] - dy * iw, neck[1] + dx * iw], [neck[0] + dx * d * 0.55, neck[1] + dy * d * 0.55], [neck[0] + dy * iw, neck[1] - dx * iw]];
  }
  return { fill, stroke, inner };
}

/** Douglas-Peucker on a polyline of [x, y]: fewer points for drawing, within `tol` of the original. */
export function simplifyLine(pts: Array<[number, number]>, tol: number): Array<[number, number]> {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const L = Math.hypot(bx - ax, by - ay) || 1;
    let far = -1, fd = tol;
    for (let k = a + 1; k < b; k++) {
      const d = Math.abs((bx - ax) * (ay - pts[k][1]) - (ax - pts[k][0]) * (by - ay)) / L;
      if (d > fd) ((fd = d), (far = k));
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

// ── mountain approaches (MW s7 para 4 a p 78) ────────────────────────────────────────────────────────────────────────

/**
 * How an approach runs in mountains, read across it from the elevation: along a valley floor, a nullah, a ridge line,
 * or a side slope (MW s7 para 4 a p 78: river / valley, nullah and ridge-line approaches).
 */
export type MtnApchKind = 'valley' | 'nullah' | 'ridge' | 'slope';
/** The reading's settings (IpbDoctrine.json `mountainApproach.read`, basis E). */
export interface MtnApchRules {
  /** Samples along the approach, metres apart. */
  stepM: number;
  /** Steps across it, metres, out to `reachM` each side. */
  crossStepM: number;
  reachM: number;
  /** A floor is looked for this far out each side (a broad valley's sides may stand farther than `reachM`); a fall
   *  beyond `reachM` does not make a ridge. */
  floorReachM: number;
  /** A side rises (or falls) where it first stands this much above (below) the way, metres. */
  riseM: number;
  /** A floor whose two rises are this far apart or less is a nullah; wider, a valley. */
  nullahMaxM: number;
  /** The share of samples a type needs to name the approach; less, it is 'mixed'. */
  majority: number;
}
export interface MtnApch {
  /** The type of `majority` of its samples, else 'mixed'. */
  kind: MtnApchKind | 'mixed';
  /** The two most common types, most common first (the second null when one type holds every sample). */
  top: [MtnApchKind, MtnApchKind | null];
  /** Share of the samples of each type, %. */
  shares: Record<MtnApchKind, number>;
  /** Median width of the floor where it runs on one (valley or nullah), metres; null when it never does. */
  floorM: number | null;
  samples: number;
}

export const MTN_APCH_DEFAULTS: MtnApchRules = { stepM: 100, crossStepM: 100, reachM: 1500, floorReachM: 5000, riseM: 30, nullahMaxM: 500, majority: 0.5 };

/** The reading's settings from IpbDoctrine.json (`mountainApproach.read`), the defaults for any missing. */
export function mtnApchRulesFrom(doc: any): MtnApchRules {
  const r = doc?.mountainApproach?.read ?? {};
  const pos = (v: unknown, fb: number): number => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fb);
  const D = MTN_APCH_DEFAULTS;
  return { stepM: pos(r.stepM, D.stepM), crossStepM: pos(r.crossStepM, D.crossStepM), reachM: pos(r.reachM, D.reachM), floorReachM: Math.max(pos(r.floorReachM, D.floorReachM), pos(r.reachM, D.reachM)), riseM: pos(r.riseM, D.riseM), nullahMaxM: pos(r.nullahMaxM, D.nullahMaxM), majority: pos(r.majority, D.majority) };
}

/**
 * The type of an approach in mountains from the elevation across it (MW s7 para 4 a p 78). Every `stepM` along its line
 * the ground is read square to the way, both sides, `crossStepM` at a time out to `reachM`: a side 'rises' where it first
 * stands `riseM` above the way, 'falls' where it first stands `riseM` below (the first met counts), else neither; past
 * `reachM`, out to `floorReachM`, only a rise counts (a broad valley floor), a fall there leaving the side neither. Both
 * sides rise: a floor, a nullah when the two rises are `nullahMaxM` apart or less, else a valley; both fall: a ridge
 * line; anything else a side slope. The approach takes the type of `majority` of its samples, else 'mixed'.
 * `line`: grid cells [x0, y0, x1, y1, ...] in the direction of movement; `elevAt(x, y)`: the height at a grid cell
 * (NaN off the grid or without data); `resM`: metres a cell. Null when the line is too short or has no heights.
 */
export function mountainApproach(line: ArrayLike<number>, elevAt: (x: number, y: number) => number, resM: number, R: MtnApchRules = MTN_APCH_DEFAULTS): MtnApch | null {
  const n = Math.floor(line.length / 2);
  if (n < 2 || !(resM > 0)) return null;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(line[2 * i] - line[2 * i - 2], line[2 * i + 1] - line[2 * i - 1]) * resM);
  const total = cum[n - 1];
  if (!(total > 0)) return null;
  const counts: Record<MtnApchKind, number> = { valley: 0, nullah: 0, ridge: 0, slope: 0 };
  const floors: number[] = [];
  let samples = 0;
  const steps = Math.max(1, Math.round(total / R.stepM));
  let i = 1;
  for (let k = 0; k < steps; k++) {
    const d = ((k + 0.5) * total) / steps;
    while (i < n - 1 && cum[i] < d) i++;
    const x0 = line[2 * i - 2], y0 = line[2 * i - 1], x1 = line[2 * i], y1 = line[2 * i + 1];
    const L = cum[i] - cum[i - 1];
    const hl = Math.hypot(x1 - x0, y1 - y0);
    if (!(L > 0) || !(hl > 0)) continue;
    const t = Math.max(0, Math.min(1, (d - cum[i - 1]) / L));
    const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
    const ax = -(y1 - y0) / hl, ay = (x1 - x0) / hl;
    const e0 = elevAt(px, py);
    if (!(e0 === e0)) continue;
    // out to `reachM` the first rise or fall counts; beyond it, out to `floorReachM`, only a rise (the far side of a
    // broad valley floor), a fall there leaving the side 'none'
    const side = (sg: number): { what: 'up' | 'down' | 'none'; atM: number } => {
      for (let q = R.crossStepM; q <= R.floorReachM + 1e-6; q += R.crossStepM) {
        const c = q / resM;
        const e = elevAt(px + sg * ax * c, py + sg * ay * c);
        if (!(e === e)) return { what: 'none', atM: q };
        if (e - e0 >= R.riseM) return { what: 'up', atM: q };
        if (e0 - e >= R.riseM) return q <= R.reachM + 1e-6 ? { what: 'down', atM: q } : { what: 'none', atM: q };
      }
      return { what: 'none', atM: R.floorReachM };
    };
    const l = side(1), r = side(-1);
    let kind: MtnApchKind;
    if (l.what === 'up' && r.what === 'up') {
      const w = l.atM + r.atM;
      floors.push(w);
      kind = w <= R.nullahMaxM ? 'nullah' : 'valley';
    } else if (l.what === 'down' && r.what === 'down') kind = 'ridge';
    else kind = 'slope';
    counts[kind]++;
    samples++;
  }
  if (!samples) return null;
  const order = (Object.keys(counts) as MtnApchKind[]).sort((a, b) => counts[b] - counts[a]);
  const shares = { valley: 0, nullah: 0, ridge: 0, slope: 0 } as Record<MtnApchKind, number>;
  for (const k of order) shares[k] = Math.round((100 * counts[k]) / samples);
  floors.sort((a, b) => a - b);
  const floorM = floors.length ? floors[floors.length >> 1] : null;
  // A floor that is a valley in places and a nullah in others is still a floor: typed by its median width.
  const kind: MtnApchKind | 'mixed' =
    counts[order[0]] / samples >= R.majority ? order[0]
    : floorM !== null && (counts.valley + counts.nullah) / samples >= R.majority ? (floorM <= R.nullahMaxM ? 'nullah' : 'valley')
    : 'mixed';
  return { kind, top: [order[0], counts[order[1]] ? order[1] : null], shares, floorM, samples };
}

/**
 * The difficult approach of two or more read (MW p 79: normally lightly held; IpbDoctrine `mountainApproach.hardest`,
 * E): the most hours along it at the book's day rates when every one has them, else the least GO. Null for fewer than two.
 */
export function mtnHardestIndex(items: ReadonlyArray<{ hoursDay?: number | null; goPct: number }>): { index: number; byHours: boolean } | null {
  if (items.length < 2) return null;
  const byHours = items.every((a) => typeof a.hoursDay === 'number' && Number.isFinite(a.hoursDay));
  let index = 0;
  for (let i = 1; i < items.length; i++) {
    const a = items[i], w = items[index];
    if (byHours ? (a.hoursDay as number) > (w.hoursDay as number) : a.goPct < w.goPct) index = i;
  }
  return { index, byHours };
}
