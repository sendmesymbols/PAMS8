/**
 * MovementGuidePlans.ts
 *
 * The plans behind the Movement Guide cards, worked out from the route scan (MovementGuideScan) and the terrain
 * bundle (`MovProbe`). Pure: no DOM, no ArcGIS. Node runs it with tools/movement-test (its resolve hook adds the .ts).
 *
 *   cordonSectors      a cordon split into platoon sectors, rooftop and side-road posts, road blocks
 *   picketTimings      when each picket can be up (along the road, then the climb)
 *   convoyPlan         packets, start and release times, bounds of 10-15 km ending at safe halts, what to clear
 *   likelyMineSites    the mine / IED spots on a route, ranked, with culverts and crossings listed
 *   planPatrol         a route out and a different route back between two points, avoiding wood edges, villages,
 *                      tracks and skylines (and the threat's view): A* over a cost grid
 *   ambushSites        sites along an enemy route, scored, each with a line / L / V layout and a meeting point
 *   roadBlockSites     where a road block or a tank ambush holds: round a bend or over a crest, no bypass,
 *                      tied to an obstacle, with flanking positions that see the approach
 *   infiltrationLanes  lanes through the ground the posts on a line do not see, and the posts that close them
 *
 * Every figure comes from MS/Data/MovementDoctrine.json (R = roadmap rule from the pamphlets, E = proposal).
 */

import {
  bearingOf,
  CLASS_WORD,
  compass8,
  densify,
  distToLine,
  groundDist,
  offsetPt,
  ringLength,
  scaleAt,
  type CordonReading,
  type GoingSets,
  type MercXY,
  type MovProbe,
  type NearFeature,
  type Picket,
  type RouteReading,
  type Rules,
  type Station,
  type Stretch,
} from './MovementGuideScan';

const word = (c: number | null): string => (c === null ? 'Gr' : CLASS_WORD[c] ?? `Class ${c}`);

// ── cordon sectors ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface CordonSector {
  n: number;
  /** "1 Pl A Coy" */
  label: string;
  fromM: number;
  toM: number;
  /** The sector's post: on the cordon line at the sector's middle, facing in. */
  x: number;
  y: number;
  facingDeg: number;
  men: number;
  rooftop: boolean;
}
export interface CordonPost {
  kind: 'rooftop' | 'sideRoad' | 'roadBlock' | 'escape';
  x: number;
  y: number;
  men: number;
  label: string;
}
export interface CordonLayout {
  sectors: CordonSector[];
  posts: CordonPost[];
  platoons: number;
  companies: number;
  sectorM: number;
  totalMen: number;
}

/** A point `m` metres round a ring from its first vertex, and the bearing of the edge there. */
function alongRing(ring: MercXY[], m: number): { p: MercXY; bearing: number } {
  let left = m;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const L = groundDist(a, b);
    if (left <= L || i === ring.length - 1) {
      const t = L > 0 ? Math.min(1, left / L) : 0;
      return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], bearing: bearingOf(a, b) };
    }
    left -= L;
  }
  return { p: ring[0], bearing: 0 };
}
function centroid(ring: MercXY[]): MercXY {
  let x = 0, y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

/**
 * The cordon split into platoon sectors (a platoon holds `plMen / menPer100m x 100` m of the line: 200 m at 15 per
 * 100 m), companies of three platoons, a rooftop section where the line meets buildings, a post where each side road
 * crosses it, and a road block on every exit of the outer ring. In the country, a section on each escape route only.
 */
export function cordonSectors(c: CordonReading, R: Rules, plMen = 30): CordonLayout {
  const C = R.cordon;
  const posts: CordonPost[] = [];
  const sectors: CordonSector[] = [];
  const ctr = centroid(c.ring);
  const coys = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let sectorM = 0;
  if (c.urban) {
    sectorM = Math.max(50, (plMen / C.menPer100m) * 100);
    const n = Math.max(1, Math.ceil(c.perimeterM / sectorM));
    const len = c.perimeterM / n;
    for (let i = 0; i < n; i++) {
      const mid = alongRing(c.ring, (i + 0.5) * len);
      sectors.push({
        n: i + 1,
        // Companies A, B, C ... then numbered once the letters run out (a cordon round a large town).
        label: `${(i % 3) + 1} Pl ${coys[Math.floor(i / 3)] ? `${coys[Math.floor(i / 3)]} Coy` : `Coy ${Math.floor(i / 3) + 1}`}`,
        fromM: i * len,
        toM: (i + 1) * len,
        x: mid.p[0],
        y: mid.p[1],
        facingDeg: Math.round(bearingOf(mid.p, ctr)),
        men: Math.round((len / 100) * C.menPer100m),
        rooftop: false,
      });
    }
    // Rooftop sections where the line meets buildings, one per sector that has them (the share is spread evenly).
    const roofSecs = Math.min(sectors.length, Math.round((c.rooftopM / Math.max(1, c.perimeterM)) * sectors.length));
    for (let k = 0; k < roofSecs; k++) {
      const s = sectors[Math.floor((k * sectors.length) / Math.max(1, roofSecs))];
      s.rooftop = true;
      const p = offsetPt(s.x, s.y, s.facingDeg, 40);
      posts.push({ kind: 'rooftop', x: p[0], y: p[1], men: Math.round((len / 100) * C.rooftopPer100m), label: `Roof ${s.label}` });
    }
    c.sideRoads.forEach((p, i) => posts.push({ kind: 'sideRoad', x: p[0], y: p[1], men: C.perSideRoad, label: `Side Rd ${i + 1}` }));
  } else {
    c.escapes.forEach((e, i) => posts.push({ kind: 'escape', x: e.x, y: e.y, men: C.sectionMen, label: `Sec ${i + 1}: ${e.why}` }));
  }
  c.exits.forEach((p, i) => posts.push({ kind: 'roadBlock', x: p[0], y: p[1], men: C.roadBlockMen, label: `RB ${i + 1}` }));
  const platoons = c.urban ? sectors.length : Math.ceil(c.escapes.length / 3);
  return {
    sectors,
    posts,
    platoons,
    companies: Math.max(1, Math.ceil(platoons / 3)),
    sectorM,
    totalMen: c.totalMen,
  };
}

// ── picket timings ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface PicketTiming {
  i: number;
  /** Minutes from the start to reach the foot of the picket along the road, then to climb to it. */
  roadMin: number;
  climbMin: number;
  upByMin: number;
}
/** Tobler's hiking speed (km/h) on a slope (rise / run), scaled so flat ground gives `flatKmh`. */
export function toblerKmh(flatKmh: number, slope: number, a = 3.5, b = 0.05): number {
  const f = Math.exp(-a * Math.abs(slope + b)) / Math.exp(-a * b);
  return Math.max(0.3, flatKmh * f);
}
/**
 * When each picket can be up if the picketing party moves along the road at `roadKmh` (default the foot column's
 * night speed) and climbs at Tobler's speed. A picket is put up before the force reaches its stretch.
 */
export function picketTimings(pickets: Picket[], o: { roadKmh: number; footKmh: number }): PicketTiming[] {
  return pickets.map((p, i) => {
    const roadMin = (p.chainM / 1000 / Math.max(0.5, o.roadKmh)) * 60;
    const slope = p.offsetM > 0 ? p.riseM / p.offsetM : 0;
    const climbMin = (p.offsetM / 1000 / toblerKmh(o.footKmh, slope)) * 60;
    return { i, roadMin: Math.round(roadMin), climbMin: Math.round(climbMin), upByMin: Math.round(roadMin + climbMin) };
  });
}

// ── convoy ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ConvoyOpts {
  vehicles: number;
  packetSize: number;
  gapMin: number;
  vehGapM: number;
  speedKmh: number;
  boundKm: number;
  startMin: number;
  haltEveryMin: number;
  haltMin: number;
}
export interface ConvoyPacket {
  n: number;
  vehicles: number;
  spMin: number;
  rpMin: number;
  passMin: number;
}
export interface ConvoyBound {
  n: number;
  fromM: number;
  toM: number;
  x: number;
  y: number;
  /** Clearable dangers inside it, worst first: the road opening party clears these before the first packet. */
  clear: Stretch[];
  /** Why the bound ends where it does. */
  haltWhy: string;
  firstInMin: number;
  lastOutMin: number;
}
export interface ConvoyPlan {
  packets: ConvoyPacket[];
  bounds: ConvoyBound[];
  lengthM: number;
  runMin: number;
  halts: number;
  /** From the first packet leaving the start point to the last clearing the release point. */
  totalMin: number;
  sp: MercXY;
  rp: MercXY;
  speedKmh: number;
}
const CLEAR = new Set(['vp', 'ambush', 'mine', 'block', 'noExit', 'overlooked', 'rooftops']);

/** Is this station a safe place to halt a convoy: on the road, no danger scoring 50 or more within 300 m, not built-up, a way off the road. */
function safeHalt(st: Station, r: RouteReading): boolean {
  if (st.bua || (st.left === 'nogo' && st.right === 'nogo')) return false;
  return !r.stretches.some((s) => s.score >= 50 && CLEAR.has(s.kind) && st.chainM >= s.fromM - 300 && st.chainM <= s.toM + 300);
}

export function convoyPlan(r: RouteReading, o: ConvoyOpts): ConvoyPlan {
  const st = r.stations;
  const n = Math.max(1, Math.ceil(o.vehicles / Math.max(1, o.packetSize)));
  const speedMpm = (o.speedKmh * 1000) / 60;
  const runMin0 = r.lengthM / speedMpm;
  const halts = o.haltEveryMin > 0 ? Math.floor(runMin0 / o.haltEveryMin) : 0;
  const runMin = runMin0 + halts * o.haltMin;
  const packets: ConvoyPacket[] = [];
  let t = o.startMin;
  for (let k = 0; k < n; k++) {
    const veh = Math.min(o.packetSize, o.vehicles - k * o.packetSize);
    const passMin = ((veh - 1) * o.vehGapM) / speedMpm;
    packets.push({ n: k + 1, vehicles: veh, spMin: Math.round(t), rpMin: Math.round(t + runMin + passMin), passMin: Math.round(passMin * 10) / 10 });
    t += passMin + o.gapMin;
  }
  // Bounds: about every `boundKm`, ending at the nearest safe halt within 2 km of the mark.
  const bounds: ConvoyBound[] = [];
  let from = 0;
  const step = o.boundKm * 1000;
  while (from < r.lengthM - 1) {
    const target = from + step;
    let end = r.lengthM;
    let x = st[st.length - 1].x, y = st[st.length - 1].y;
    let why = 'release point';
    if (target < r.lengthM - step * 0.3) {
      let best: Station | null = null;
      for (const s of st) {
        if (Math.abs(s.chainM - target) > 2000 || s.chainM <= from + step * 0.5) continue;
        if (!safeHalt(s, r)) continue;
        if (!best || Math.abs(s.chainM - target) < Math.abs(best.chainM - target)) best = s;
      }
      const s = best ?? st.reduce((m, q) => (Math.abs(q.chainM - target) < Math.abs(m.chainM - target) ? q : m));
      end = s.chainM;
      x = s.x;
      y = s.y;
      why = best ? 'safe halt: no danger within 300 m, not built-up, a way off the Rd' : 'no safe halt within 2 km: halt here only when cleared';
    }
    const clear = r.stretches.filter((s) => CLEAR.has(s.kind) && s.score >= 50 && s.toM > from && s.fromM < end).sort((a, b) => b.score - a.score);
    const toTime = (m: number) => {
      const run = m / speedMpm;
      return run + (o.haltEveryMin > 0 ? Math.floor(run / o.haltEveryMin) * o.haltMin : 0);
    };
    bounds.push({
      n: bounds.length + 1,
      fromM: from,
      toM: end,
      x,
      y,
      clear,
      haltWhy: why,
      firstInMin: Math.round(o.startMin + toTime(from)),
      lastOutMin: Math.round(packets[packets.length - 1].spMin + packets[packets.length - 1].passMin + toTime(end)),
    });
    if (end >= r.lengthM - 1) break;
    from = end;
  }
  return {
    packets,
    bounds,
    lengthM: r.lengthM,
    runMin: Math.round(runMin),
    halts,
    totalMin: Math.round(packets[packets.length - 1].rpMin - o.startMin),
    sp: [st[0].x, st[0].y],
    rp: [st[st.length - 1].x, st[st.length - 1].y],
    speedKmh: o.speedKmh,
  };
}

// ── likely mine sites ────────────────────────────────────────────────────────────────────────────────────────────────

export interface MineSite {
  rank: number;
  chainM: number;
  x: number;
  y: number;
  score: number;
  why: string;
  kind: 'mine' | 'culvert' | 'crossing';
}
/** Likely mine / IED sites: the route's mine stretches, plus every culvert and crossing on it, worst first. */
export function likelyMineSites(r: RouteReading, minScore: number): MineSite[] {
  const out: MineSite[] = [];
  for (const s of r.stretches) {
    if (s.kind === 'mine' && s.score >= minScore) out.push({ rank: 0, chainM: s.chainM, x: s.x, y: s.y, score: s.score, why: s.why, kind: 'mine' });
    if (s.kind === 'vp') {
      const culvert = /culvert/i.test(s.why);
      const crossing = /bridge|ford|ferry|crossing/i.test(s.why);
      if ((culvert || crossing) && !out.some((m) => Math.abs(m.chainM - s.chainM) < 60)) out.push({ rank: 0, chainM: s.chainM, x: s.x, y: s.y, score: Math.max(minScore, culvert ? 55 : 45), why: culvert ? `Culvert: a charge goes in under the Rd` : `${s.why}: vehicles slow and bunch`, kind: culvert ? 'culvert' : 'crossing' });
    }
  }
  out.sort((a, b) => b.score - a.score || a.chainM - b.chainM);
  out.forEach((m, i) => (m.rank = i + 1));
  return out;
}

// ── cost grid and A* ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface CostGrid {
  /** Web Mercator of cell (0, 0)'s centre and the cell size in Mercator metres. */
  x0: number;
  y0: number;
  step: number;
  cellM: number;
  w: number;
  h: number;
  cost: Float32Array;
}
export function gridFor(a: MercXY, b: MercXY, marginM: number, maxCells = 320): { x0: number; y0: number; step: number; cellM: number; w: number; h: number } {
  const s = scaleAt((a[1] + b[1]) / 2);
  const m = marginM / s;
  const minx = Math.min(a[0], b[0]) - m, maxx = Math.max(a[0], b[0]) + m;
  const miny = Math.min(a[1], b[1]) - m, maxy = Math.max(a[1], b[1]) + m;
  let cellM = 30;
  while (Math.max(((maxx - minx) * s) / cellM, ((maxy - miny) * s) / cellM) > maxCells) cellM *= 1.25;
  const step = cellM / s;
  const w = Math.ceil((maxx - minx) / step) + 1;
  const h = Math.ceil((maxy - miny) / step) + 1;
  return { x0: minx, y0: maxy, step, cellM, w, h };
}
export const cellXY = (g: { x0: number; y0: number; step: number }, i: number, j: number): MercXY => [g.x0 + i * g.step, g.y0 - j * g.step];
export const xyCell = (g: { x0: number; y0: number; step: number; w: number; h: number }, p: MercXY): [number, number] => [
  Math.max(0, Math.min(g.w - 1, Math.round((p[0] - g.x0) / g.step))),
  Math.max(0, Math.min(g.h - 1, Math.round((g.y0 - p[1]) / g.step))),
];

/** Cheapest 8-connected path between cells (several starts / goals allowed); null when there is none. */
export function astar(g: CostGrid, starts: number[], goals: Set<number>, extra?: Float32Array | null): number[] | null {
  const N = g.w * g.h;
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  // Heuristic: the cheapest cell cost times the straight distance to the nearest goal (goal set may be large: use its box).
  let gx0 = Infinity, gx1 = -Infinity, gy0 = Infinity, gy1 = -Infinity;
  for (const k of goals) {
    const x = k % g.w, y = (k / g.w) | 0;
    gx0 = Math.min(gx0, x);
    gx1 = Math.max(gx1, x);
    gy0 = Math.min(gy0, y);
    gy1 = Math.max(gy1, y);
  }
  const hOf = (k: number) => {
    const x = k % g.w, y = (k / g.w) | 0;
    const dx = Math.max(0, gx0 - x, x - gx1), dy = Math.max(0, gy0 - y, y - gy1);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  // Binary heap of [f, k].
  const hk: number[] = [];
  const hf: number[] = [];
  const push = (f: number, k: number) => {
    hk.push(k);
    hf.push(f);
    let i = hk.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hf[p] <= hf[i]) break;
      [hf[p], hf[i]] = [hf[i], hf[p]];
      [hk[p], hk[i]] = [hk[i], hk[p]];
      i = p;
    }
  };
  const pop = (): number => {
    const top = hk[0];
    const lk = hk.pop()!, lf = hf.pop()!;
    if (hk.length) {
      hk[0] = lk;
      hf[0] = lf;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < hk.length && hf[l] < hf[m]) m = l;
        if (r < hk.length && hf[r] < hf[m]) m = r;
        if (m === i) break;
        [hf[m], hf[i]] = [hf[i], hf[m]];
        [hk[m], hk[i]] = [hk[i], hk[m]];
        i = m;
      }
    }
    return top;
  };
  for (const s of starts) {
    if (!(g.cost[s] < Infinity)) continue;
    dist[s] = 0;
    push(hOf(s), s);
  }
  const DX = [1, -1, 0, 0, 1, 1, -1, -1];
  const DY = [0, 0, 1, -1, 1, -1, 1, -1];
  const done = new Uint8Array(N);
  while (hk.length) {
    const k = pop();
    if (done[k]) continue;
    done[k] = 1;
    if (goals.has(k)) {
      const path: number[] = [];
      for (let c = k; c !== -1; c = prev[c]) path.push(c);
      return path.reverse();
    }
    const x = k % g.w, y = (k / g.w) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = x + DX[d], ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      const nk = ny * g.w + nx;
      const c = (g.cost[k] + g.cost[nk]) / 2 + (extra ? extra[nk] : 0);
      if (!(c < Infinity)) continue;
      const nd = dist[k] + c * (d < 4 ? 1 : Math.SQRT2);
      if (nd < dist[nk]) {
        dist[nk] = nd;
        prev[nk] = k;
        push(nd + hOf(nk), nk);
      }
    }
  }
  return null;
}
/** Cells to Mercator points, thinned to the corners (a cell path has a vertex at every step). */
function cellsToPath(g: CostGrid, cells: number[]): MercXY[] {
  const pts = cells.map((k) => cellXY(g, k % g.w, (k / g.w) | 0));
  if (pts.length <= 2) return pts;
  // Douglas-Peucker at one cell.
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const tol = g.step * 1.0;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1, wd = 0;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const L = Math.hypot(bx - ax, by - ay) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
      if (d > wd) {
        wd = d;
        worst = i;
      }
    }
    if (worst > 0 && wd > tol) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// ── patrol ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PatrolOpts {
  foot: GoingSets;
  avoidRoads: boolean;
  avoidVillages: boolean;
  avoidWoodEdges: boolean;
  avoidSkylines: boolean;
  threat: MercXY | null;
  /** Keep the route back this far from the route out (metres); 0 = same way allowed. */
  separateM: number;
}
export interface PatrolRoutes {
  out: MercXY[] | null;
  back: MercXY[] | null;
  cellM: number;
  /** Share of the route out that met each thing it avoids (it could not go round). */
  met: { roads: number; villages: number; woodEdges: number; skylines: number; seen: number };
  pending: boolean;
}
const WOOD = new Set([1, 29, 30, 31]);
const ROADS = new Set([34, 35, 36, 37, 38]);

/**
 * A patrol's route out from `start` to `objective` and a different route back. Costs (MovementDoctrine `patrol`):
 * NO-GO on foot is closed; SLOW-GO costs more; roads and tracks, villages and built-up ground, wood edges, skylines
 * and ground the threat may see cost extra (doctrine: night routes avoid wood edges, villages, tracks and skylines;
 * the route out differs from the route in).
 */
export function planPatrol(probe: MovProbe, R: Rules, start: MercXY, objective: MercXY, o: PatrolOpts): PatrolRoutes {
  const P = R.patrol;
  probe.takePending?.();
  const dist = groundDist(start, objective);
  const G = gridFor(start, objective, Math.max(P.marginM, dist * 0.3), P.maxCells);
  const N = G.w * G.h;
  const cls = new Int16Array(N);
  const elev = new Float32Array(N);
  for (let j = 0; j < G.h; j++)
    for (let i = 0; i < G.w; i++) {
      const [x, y] = cellXY(G, i, j);
      const c = probe.cls(x, y);
      cls[j * G.w + i] = c === null ? -1 : c;
      elev[j * G.w + i] = probe.elev(x, y);
    }
  // Places (villages and towns) as discs.
  const village = new Uint8Array(N);
  if (o.avoidVillages) {
    const mid: MercXY = [(start[0] + objective[0]) / 2, (start[1] + objective[1]) / 2];
    const rr = (Math.max(G.w, G.h) * G.cellM) / 1.4;
    const rad = Math.ceil(P.villageM / G.cellM);
    for (const f of probe.features(mid[0], mid[1], rr, new Set<string>(P.villageKinds))) {
      const [ci, cj] = xyCell(G, [f.x, f.y]);
      for (let dj = -rad; dj <= rad; dj++)
        for (let di = -rad; di <= rad; di++) {
          const ii = ci + di, jj = cj + dj;
          if (ii < 0 || jj < 0 || ii >= G.w || jj >= G.h || di * di + dj * dj > rad * rad) continue;
          village[jj * G.w + ii] = 1;
        }
    }
  }
  const cost = new Float32Array(N);
  const flag = { roads: new Uint8Array(N), woods: new Uint8Array(N), sky: new Uint8Array(N), seen: new Uint8Array(N) };
  const rSky = Math.max(1, Math.round(P.skylineM / G.cellM));
  for (let j = 0; j < G.h; j++)
    for (let i = 0; i < G.w; i++) {
      const k = j * G.w + i;
      const c = cls[k];
      if (c >= 0 && o.foot.nogo.has(c)) {
        cost[k] = Infinity;
        continue;
      }
      let v = 1;
      if (c >= 0 && o.foot.caution.has(c)) v *= P.slowCost;
      if (o.avoidRoads && c >= 0 && ROADS.has(c)) {
        v *= P.roadCost;
        flag.roads[k] = 1;
      }
      if (o.avoidVillages && (village[k] || c === 3)) v *= P.villageCost;
      if (o.avoidWoodEdges && c >= 0) {
        // An edge: wood beside open ground, either way round.
        const inWood = WOOD.has(c);
        let edge = false;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= G.w || jj >= G.h) continue;
          const c2 = cls[jj * G.w + ii];
          if (c2 >= 0 && WOOD.has(c2) !== inWood) edge = true;
        }
        if (edge) {
          v *= P.woodEdgeCost;
          flag.woods[k] = 1;
        }
      }
      if (o.avoidSkylines && elev[k] === elev[k]) {
        // A skyline: the highest ground in its neighbourhood, standing above it by `skylineRiseM`.
        let top = true;
        let lowest = elev[k];
        for (let dj = -rSky; dj <= rSky && top; dj += rSky)
          for (let di = -rSky; di <= rSky; di += rSky) {
            if (!di && !dj) continue;
            const ii = i + di, jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= G.w || jj >= G.h) continue;
            const e2 = elev[jj * G.w + ii];
            if (e2 === e2) {
              if (e2 > elev[k]) {
                top = false;
                break;
              }
              lowest = Math.min(lowest, e2);
            }
          }
        if (top && elev[k] - lowest >= P.skylineRiseM) {
          v *= P.skylineCost;
          flag.sky[k] = 1;
        }
      }
      cost[k] = v;
    }
  if (o.threat) {
    for (let j = 0; j < G.h; j++)
      for (let i = 0; i < G.w; i++) {
        const k = j * G.w + i;
        if (!(cost[k] < Infinity)) continue;
        const p = cellXY(G, i, j);
        if (groundDist(o.threat, p) > P.threatKm * 1000) continue;
        const s = probe.sight(o.threat[0], o.threat[1], P.threatEyeM, p[0], p[1], 1.7);
        if (s !== null && s >= 0.5) {
          cost[k] *= P.seenCost;
          flag.seen[k] = 1;
        }
      }
  }
  const g: CostGrid = { ...G, cost };
  const s0 = xyCell(G, start);
  const s1 = xyCell(G, objective);
  const sk = s0[1] * G.w + s0[0], ok = s1[1] * G.w + s1[0];
  // Start and objective stay open even when they sit on ground the costs avoid.
  if (!(cost[sk] < Infinity)) cost[sk] = P.slowCost;
  if (!(cost[ok] < Infinity)) cost[ok] = P.slowCost;
  const outCells = astar(g, [sk], new Set([ok]));
  let backCells: number[] | null = null;
  if (outCells && o.separateM > 0) {
    const extra = new Float32Array(N);
    const rad = Math.max(1, Math.round(o.separateM / G.cellM));
    for (const k of outCells) {
      const ci = k % G.w, cj = (k / G.w) | 0;
      for (let dj = -rad; dj <= rad; dj++)
        for (let di = -rad; di <= rad; di++) {
          const ii = ci + di, jj = cj + dj;
          if (ii < 0 || jj < 0 || ii >= G.w || jj >= G.h || di * di + dj * dj > rad * rad) continue;
          extra[jj * G.w + ii] = P.separateCost;
        }
    }
    // Leave the ends free: both routes must touch the start and the objective.
    const free = Math.max(2, Math.round(P.endFreeM / G.cellM));
    for (const c of [sk, ok]) {
      const ci = c % G.w, cj = (c / G.w) | 0;
      for (let dj = -free; dj <= free; dj++)
        for (let di = -free; di <= free; di++) {
          const ii = ci + di, jj = cj + dj;
          if (ii >= 0 && jj >= 0 && ii < G.w && jj < G.h) extra[jj * G.w + ii] = 0;
        }
    }
    backCells = astar(g, [ok], new Set([sk]), extra);
  } else if (outCells) backCells = outCells.slice().reverse();
  const share = (cells: number[] | null, f: Uint8Array) => (cells && cells.length ? Math.round((100 * cells.filter((k) => f[k]).length) / cells.length) : 0);
  const out = outCells ? cellsToPath(g, outCells) : null;
  if (out) {
    out[0] = start;
    out[out.length - 1] = objective;
  }
  const back = backCells ? cellsToPath(g, backCells) : null;
  if (back) {
    back[0] = objective;
    back[back.length - 1] = start;
  }
  return {
    out,
    back,
    cellM: Math.round(G.cellM),
    met: { roads: share(outCells, flag.roads), villages: share(outCells, village), woodEdges: share(outCells, flag.woods), skylines: share(outCells, flag.sky), seen: share(outCells, flag.seen) },
    pending: probe.takePending?.() ?? false,
  };
}

// ── ambush ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export type AmbushShape = 'line' | 'L' | 'V';
export interface AmbushLayout {
  shape: AmbushShape;
  side: 'L' | 'R';
  /** Killing zone along the road (its two ends) and the fire group's line beside it. */
  kz: [MercXY, MercXY];
  fireLine: [MercXY, MercXY];
  stops: MercXY[];
  /** Where the L's short arm or the V's second arm lies. */
  arm: [MercXY, MercXY] | null;
  meeting: MercXY;
  meetingM: number;
  withdrawalCoverPct: number;
}
export interface AmbushSite {
  rank: number;
  chainM: number;
  x: number;
  y: number;
  score: number;
  parts: Array<{ what: string; ok: boolean; pts: number }>;
  layout: AmbushLayout;
}

function stationAt(st: Station[], m: number): Station {
  let lo = 0, hi = st.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (st[mid].chainM < m) lo = mid + 1;
    else hi = mid;
  }
  return st[Math.max(0, Math.min(st.length - 1, lo))];
}

/**
 * Ambush sites along an enemy route, scored on the rule (defile or bend, target hidden from the vehicles behind,
 * covered withdrawal, away from reinforcements, no village near) and each given a layout: line along a straight
 * stretch, L at a bend, V where high ground stands on both sides; stop groups beyond each end of the killing zone;
 * a meeting point 750-900 m back along a covered withdrawal.
 */
export function ambushSites(r: RouteReading, probe: MovProbe, R: Rules, foot: GoingSets, max = 6): AmbushSite[] {
  const A = R.ambush;
  const st = r.stations;
  const cover = new Set<number>(A.coverClasses);
  const cands: Station[] = [];
  for (const s of r.stretches) if (s.kind === 'ambush') cands.push(stationAt(st, s.chainM));
  const out: AmbushSite[] = [];
  for (const c of cands) {
    if (out.some((o) => Math.abs(o.chainM - c.chainM) < A.kzM * 2)) continue;
    const parts: AmbushSite['parts'] = [];
    const noExit = c.left === 'nogo' && c.right === 'nogo';
    parts.push({ what: noExit ? 'Defile: the target cannot leave the Rd' : 'Target cannot leave the Rd on one side', ok: true, pts: noExit ? 25 : 15 });
    const bend = st.some((q) => Math.abs(q.chainM - c.chainM) <= 200 && (q.turnDeg >= R.scan.bendDeg || q.crest));
    // Hidden from the vehicles behind: a man in the killing zone is not seen from 300 m back along the road.
    const back = stationAt(st, Math.max(0, c.chainM - A.followM));
    const seenBack = back !== c ? probe.sight(back.x, back.y, 2.4, c.x, c.y, 2.4) : null;
    const hidden = bend || (seenBack !== null && seenBack < 0.5);
    parts.push({ what: hidden ? `Hidden from the vehicles ${A.followM} m behind${bend ? ' (bend / crest)' : ''}` : `Seen from ${A.followM} m back: the column behind sees the ambush`, ok: hidden, pts: hidden ? 20 : 0 });
    const side: 'L' | 'R' = c.coverR && (!c.coverL || c.riseR >= c.riseL) ? 'R' : c.coverL ? 'L' : c.riseR >= c.riseL ? 'R' : 'L';
    const sign = side === 'L' ? -1 : 1;
    const coverAt = (side === 'L' ? c.coverL : c.coverR) ?? { distM: A.coverFromM * 2, cls: -1 };
    // The withdrawal: from the fire position away from the road, how much of it is in cover.
    let cov = 0, n = 0;
    let meeting: MercXY = offsetPt(c.x, c.y, c.bearing + 90 * sign, A.meetingM);
    let meetingM = A.meetingM;
    for (const turn of [0, 25, -25, 50, -50]) {
      let ok = true;
      cov = 0;
      n = 0;
      for (let d = coverAt.distM; d <= A.meetingM; d += 50) {
        const p = offsetPt(c.x, c.y, c.bearing + 90 * sign + turn * sign, d);
        const k = probe.cls(p[0], p[1]);
        n++;
        if (k !== null && foot.nogo.has(k)) {
          ok = false;
          break;
        }
        if (k !== null && cover.has(k)) cov++;
      }
      if (ok) {
        meeting = offsetPt(c.x, c.y, c.bearing + 90 * sign + turn * sign, A.meetingM);
        meetingM = A.meetingM;
        break;
      }
    }
    const covPct = n ? Math.round((100 * cov) / n) : 0;
    parts.push({ what: `Withdrawal ${covPct} % in cover`, ok: covPct >= 30, pts: Math.round(covPct / 5) });
    const reinforce = c.reinforcementKm;
    parts.push({ what: reinforce === null ? `No post or Police within ${A.reinforcementKm} km` : `Post / Police ${reinforce.toFixed(1)} km`, ok: reinforce === null, pts: reinforce === null ? 15 : 0 });
    const village = c.places.some((p) => p.distM <= A.villageKm * 1000);
    parts.push({ what: village ? 'Village within 1 km' : 'No village within 1 km', ok: !village, pts: village ? 0 : 10 });
    const coverPts = c.coverL || c.coverR ? 10 : 0;
    parts.push({ what: coverPts ? `Cover ${coverAt.distM} m from the Rd (${word(coverAt.cls)})` : `High Gr ${Math.round(Math.max(c.riseL, c.riseR))} m above`, ok: true, pts: coverPts || 5 });
    const score = Math.min(100, parts.reduce((s, p) => s + p.pts, 0));
    const shape: AmbushShape = c.riseL >= A.riseM && c.riseR >= A.riseM ? 'V' : bend ? 'L' : 'line';
    const a = stationAt(st, Math.max(0, c.chainM - A.kzM / 2));
    const b = stationAt(st, Math.min(r.lengthM, c.chainM + A.kzM / 2));
    const off = Math.max(A.coverFromM, Math.min(coverAt.distM, A.fireOffsetMaxM));
    const fa = offsetPt(a.x, a.y, a.bearing + 90 * sign, off);
    const fb = offsetPt(b.x, b.y, b.bearing + 90 * sign, off);
    const sA = stationAt(st, Math.max(0, a.chainM - A.stopM));
    const sB = stationAt(st, Math.min(r.lengthM, b.chainM + A.stopM));
    const stops: MercXY[] = [offsetPt(sA.x, sA.y, sA.bearing + 90 * sign, A.coverFromM), offsetPt(sB.x, sB.y, sB.bearing + 90 * sign, A.coverFromM)];
    let arm: [MercXY, MercXY] | null = null;
    if (shape === 'L') arm = [offsetPt(b.x, b.y, b.bearing + 90 * sign, off), offsetPt(b.x, b.y, b.bearing, A.kzM / 3)];
    if (shape === 'V') arm = [offsetPt(a.x, a.y, a.bearing - 90 * sign, off), offsetPt(b.x, b.y, b.bearing - 90 * sign, off)];
    out.push({
      rank: 0,
      chainM: c.chainM,
      x: c.x,
      y: c.y,
      score,
      parts,
      layout: { shape, side, kz: [[a.x, a.y], [b.x, b.y]], fireLine: [fa, fb], stops, arm, meeting, meetingM, withdrawalCoverPct: covPct },
    });
  }
  out.sort((p, q) => q.score - p.score || p.chainM - q.chainM);
  out.forEach((s, i) => (s.rank = i + 1));
  return out.slice(0, max);
}

// ── road block / tank ambush ─────────────────────────────────────────────────────────────────────────────────────────

export interface BlockSite {
  rank: number;
  chainM: number;
  x: number;
  y: number;
  score: number;
  parts: Array<{ what: string; ok: boolean; pts: number }>;
  /** Positions that see the approach (anti-tank / tank ambush), with what share of the approach each sees. */
  positions: Array<{ x: number; y: number; side: 'L' | 'R'; offM: number; seesPct: number; riseM: number }>;
  approachFromM: number;
}

/**
 * Where a road block or a tank ambush holds (rule: round a bend or over a crest, no bypass, no room to turn, tied to
 * natural obstacles), with up to two flanking positions that see the approach from `approachM` back.
 */
export function roadBlockSites(r: RouteReading, probe: MovProbe, R: Rules, foot: GoingSets, max = 6): BlockSite[] {
  const B = R.block;
  const st = r.stations;
  const out: BlockSite[] = [];
  const obstacleWhy = new Set<number>(B.obstacleClasses);
  for (const s of st) {
    const noExit = s.left === 'nogo' && s.right === 'nogo';
    if (!noExit) continue;
    if (out.some((o) => Math.abs(o.chainM - s.chainM) < B.minApartM)) continue;
    const bend = st.some((q) => Math.abs(q.chainM - s.chainM) <= B.bypassM && q.turnDeg >= R.scan.bendDeg);
    const crest = st.some((q) => Math.abs(q.chainM - s.chainM) <= B.bypassM && q.crest);
    const parts: BlockSite['parts'] = [];
    // Approach hidden: the block is not seen from `approachM` back.
    const back = stationAt(st, Math.max(0, s.chainM - B.approachM));
    const seen = back !== s ? probe.sight(back.x, back.y, 2.4, s.x, s.y, 2.4) : null;
    const hiddenApproach = bend || crest || (seen !== null && seen < 0.5);
    if (!hiddenApproach && !bend && !crest) continue;
    parts.push({ what: bend ? 'Round a bend' : crest ? 'Over a crest' : 'Out of sight from the approach', ok: true, pts: 25 });
    // No room to turn: NO-GO both sides for `turnM` before the block.
    let run = 0;
    for (const q of st) if (q.chainM <= s.chainM && q.chainM >= s.chainM - B.turnM && q.left === 'nogo' && q.right === 'nogo') run += r.stationM;
    const noTurn = run >= B.turnM * 0.6;
    parts.push({ what: noTurn ? `No room to turn for ${Math.round(run)} m` : `Room to turn within ${B.turnM} m`, ok: noTurn, pts: noTurn ? 25 : 5 });
    const tied = [s.leftWhy, s.rightWhy].filter((c): c is number => c !== null && obstacleWhy.has(c));
    parts.push({ what: tied.length ? `Tied to ${tied.map(word).join(' and ')}` : 'NO-GO both sides', ok: true, pts: tied.length ? 25 : 15 });
    parts.push({ what: 'No bypass within 100 m', ok: true, pts: 15 });
    // Flanking positions that see the approach.
    const approach = st.filter((q) => q.chainM >= s.chainM - B.approachM && q.chainM < s.chainM - 50).filter((_, i) => i % 2 === 0);
    const positions: BlockSite['positions'] = [];
    for (const sign of [-1, 1]) {
      let best: BlockSite['positions'][number] | null = null;
      for (const d of B.positionOffsetsM as number[]) {
        for (const along of [0, -150, 150]) {
          const base = stationAt(st, Math.max(0, Math.min(r.lengthM, s.chainM + along)));
          const p = offsetPt(base.x, base.y, base.bearing + 90 * sign, d);
          const k = probe.cls(p[0], p[1]);
          if (k === null || foot.nogo.has(k)) continue;
          const e = probe.elev(p[0], p[1]);
          let seen = 0;
          for (const q of approach) {
            const v = probe.sight(p[0], p[1], 2.4, q.x, q.y, 2.4);
            if (v !== null && v >= 0.5) seen++;
          }
          const pct = approach.length ? Math.round((100 * seen) / approach.length) : 0;
          if (!best || pct > best.seesPct) best = { x: p[0], y: p[1], side: sign < 0 ? 'L' : 'R', offM: d, seesPct: pct, riseM: e === e && s.elev === s.elev ? Math.round(e - s.elev) : 0 };
        }
      }
      if (best && best.seesPct >= B.minSeesPct) positions.push(best);
    }
    parts.push({ what: positions.length ? `${positions.length} flanking position${positions.length > 1 ? 's' : ''} see the approach` : 'No flanking position sees the approach', ok: positions.length > 0, pts: positions.length ? 10 : 0 });
    const score = Math.min(100, parts.reduce((a, p) => a + p.pts, 0));
    out.push({ rank: 0, chainM: s.chainM, x: s.x, y: s.y, score, parts, positions, approachFromM: Math.max(0, s.chainM - B.approachM) });
  }
  out.sort((p, q) => q.score - p.score || p.chainM - q.chainM);
  out.forEach((s, i) => (s.rank = i + 1));
  return out.slice(0, max);
}

// ── infiltration ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface InfilLane {
  n: number;
  path: MercXY[];
  lengthM: number;
  seenPct: number;
  crossM: number;
  where: string;
}
export interface InfilPost {
  n: number;
  x: number;
  y: number;
  name: string | null;
  source: 'existing' | 'new';
  coversPct: number;
}
export interface InfilReading {
  lanes: InfilLane[];
  posts: InfilPost[];
  existing: NearFeature[];
  seenPct: number;
  afterPct: number;
  cellM: number;
  pending: boolean;
}

/**
 * Lanes through a band either side of `line` (a border, LoC or own line) that the existing posts do not see, from the
 * enemy side (`enemySide` -1 left of the line's direction, +1 right) to the own side; then the fewest new posts that
 * see the lanes and the line (anti-infiltration posts).
 */
export function infiltrationLanes(probe: MovProbe, R: Rules, line: MercXY[], enemySide: -1 | 1, foot: GoingSets, extraPosts: MercXY[] = []): InfilReading {
  const I = R.infil;
  probe.takePending?.();
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of line) {
    minx = Math.min(minx, p[0]);
    miny = Math.min(miny, p[1]);
    maxx = Math.max(maxx, p[0]);
    maxy = Math.max(maxy, p[1]);
  }
  const G0 = gridFor([minx, miny], [maxx, maxy], I.bandM + 200, I.maxCells);
  const N = G0.w * G0.h;
  const xy: number[] = [];
  for (const p of line) xy.push(p[0], p[1]);
  // Which side of the line each cell is on, and how far.
  const side = new Int8Array(N);
  const inBand = new Uint8Array(N);
  const cost = new Float32Array(N).fill(Infinity);
  for (let j = 0; j < G0.h; j++)
    for (let i = 0; i < G0.w; i++) {
      const k = j * G0.w + i;
      const p = cellXY(G0, i, j);
      const d = distToLine(p, xy);
      if (d > I.bandM) continue;
      // Side: the sign of the cross product with the nearest segment. The band is a strip either side of the line,
      // not round its ends: beyond an end both sides meet, and a "lane" would just step round the end.
      let best = Infinity, sgn = 0, beyond = false;
      for (let s = 0; s + 1 < line.length; s++) {
        const a = line[s], b = line[s + 1];
        const dd = distToLine(p, [a[0], a[1], b[0], b[1]]);
        if (dd < best) {
          best = dd;
          const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
          sgn = cr > 0 ? -1 : 1; // left of the direction of travel = -1
          const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
          const tt = L2 > 0 ? ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / L2 : 0;
          beyond = (s === 0 && tt < 0) || (s === line.length - 2 && tt > 1);
        }
      }
      if (beyond) continue;
      inBand[k] = 1;
      side[k] = sgn;
      const c = probe.cls(p[0], p[1]);
      cost[k] = c !== null && foot.nogo.has(c) ? Infinity : c !== null && foot.caution.has(c) ? I.slowCost : 1;
      if (c === 3 || (c !== null && c >= 34 && c <= 38)) cost[k] *= I.roadVillageCost;
    }
  // Observers: the posts already on the ground near the line, and any the user added.
  const mid: MercXY = [(minx + maxx) / 2, (miny + maxy) / 2];
  const reach = Math.max(groundDist([minx, miny], [maxx, maxy]) / 2 + I.bandM, 1000);
  const existing = probe.features(mid[0], mid[1], reach, new Set<string>(I.postKinds)).filter((f) => distToLine([f.x, f.y], xy) <= I.bandM + I.rangeM);
  const observers: MercXY[] = [...existing.map((f) => [f.x, f.y] as MercXY), ...extraPosts];
  const seen = new Uint8Array(N);
  const step = Math.max(1, Math.round(I.sampleM / G0.cellM));
  const seeFrom = (o: MercXY, mark: Uint8Array | null, counter?: Set<number>) => {
    for (let j = 0; j < G0.h; j += step)
      for (let i = 0; i < G0.w; i += step) {
        const k = j * G0.w + i;
        if (!inBand[k]) continue;
        const p = cellXY(G0, i, j);
        if (groundDist(o, p) > I.rangeM) continue;
        const v = probe.sight(o[0], o[1], I.eyeM, p[0], p[1], 1.7);
        if (v === null || v < 0.5) continue;
        for (let dj = 0; dj < step; dj++)
          for (let di = 0; di < step; di++) {
            const kk = (j + dj) * G0.w + (i + di);
            if (j + dj < G0.h && i + di < G0.w) {
              if (mark) mark[kk] = 1;
              counter?.add(kk);
            }
          }
      }
  };
  for (const o of observers) seeFrom(o, seen);
  let bandN = 0, seenN = 0;
  for (let k = 0; k < N; k++)
    if (inBand[k]) {
      bandN++;
      if (seen[k]) seenN++;
    }
  // Lanes: from the band's enemy edge to its own edge, the cheapest way with seen ground costly.
  const laneCost = new Float32Array(N);
  for (let k = 0; k < N; k++) laneCost[k] = inBand[k] ? cost[k] * (seen[k] ? I.seenCost : 1) : Infinity;
  const g: CostGrid = { ...G0, cost: laneCost };
  const edgeM = I.bandM - G0.cellM * 1.5;
  const starts: number[] = [];
  const goals = new Set<number>();
  for (let j = 0; j < G0.h; j++)
    for (let i = 0; i < G0.w; i++) {
      const k = j * G0.w + i;
      if (!inBand[k]) continue;
      const d = distToLine(cellXY(G0, i, j), xy);
      if (d < edgeM) continue;
      if (side[k] === enemySide) starts.push(k);
      else goals.add(k);
    }
  const lanes: InfilLane[] = [];
  const extra = new Float32Array(N);
  for (let n = 0; n < I.lanes && starts.length && goals.size; n++) {
    const cells = astar(g, starts, goals, extra);
    if (!cells) break;
    const path = cellsToPath(g, cells);
    let L = 0;
    for (let i = 0; i + 1 < path.length; i++) L += groundDist(path[i], path[i + 1]);
    const seenPct = Math.round((100 * cells.filter((k) => seen[k]).length) / cells.length);
    // Where it crosses the line.
    let crossM = 0;
    const cross = cells.find((k, i) => i > 0 && side[k] !== side[cells[i - 1]]);
    if (cross !== undefined) {
      const p = cellXY(G0, cross % G0.w, (cross / G0.w) | 0);
      let acc = 0;
      let bestD = Infinity;
      for (let s = 0; s + 1 < line.length; s++) {
        const a = line[s], b = line[s + 1];
        const segL = groundDist(a, b);
        const d = distToLine(p, [a[0], a[1], b[0], b[1]]);
        if (d < bestD) {
          bestD = d;
          crossM = acc + Math.min(segL, groundDist(a, p));
        }
        acc += segL;
      }
    }
    lanes.push({ n: n + 1, path, lengthM: L, seenPct, crossM, where: `${(crossM / 1000).toFixed(1)} km along the line` });
    // The next lane keeps away from this one.
    const rad = Math.max(1, Math.round(I.separateM / G0.cellM));
    for (const k of cells) {
      const ci = k % G0.w, cj = (k / G0.w) | 0;
      for (let dj = -rad; dj <= rad; dj++)
        for (let di = -rad; di <= rad; di++) {
          const ii = ci + di, jj = cj + dj;
          if (ii >= 0 && jj >= 0 && ii < G0.w && jj < G0.h) extra[jj * G0.w + ii] = I.separateCost;
        }
    }
  }
  // Anti-infiltration posts: greedy cover of the lanes' cells (and the line's) from candidates on the own side.
  const want = new Set<number>();
  for (const l of lanes) for (const p of densify(l.path, G0.cellM)) {
    const [i, j] = xyCell(G0, [p.x, p.y]);
    want.add(j * G0.w + i);
  }
  const cands: Array<{ p: MercXY; name: string | null; cov: Set<number> }> = [];
  const own = -enemySide as -1 | 1;
  for (const s of densify(line, I.postEveryM)) {
    for (const d of I.postOffsetsM as number[]) {
      const p = offsetPt(s.x, s.y, s.bearing + 90 * own, d);
      const c = probe.cls(p[0], p[1]);
      if (c === null || foot.nogo.has(c)) continue;
      cands.push({ p, name: null, cov: new Set() });
    }
  }
  for (const f of probe.features(mid[0], mid[1], reach, new Set<string>(I.heightKinds))) {
    if (distToLine([f.x, f.y], xy) > I.bandM) continue;
    cands.push({ p: [f.x, f.y], name: f.name ?? f.label, cov: new Set() });
  }
  for (const c of cands.slice(0, I.maxCandidates)) {
    for (const k of want) {
      const p = cellXY(G0, k % G0.w, (k / G0.w) | 0);
      if (groundDist(c.p, p) > I.rangeM) continue;
      const v = probe.sight(c.p[0], c.p[1], I.eyeM, p[0], p[1], 1.7);
      if (v !== null && v >= 0.5) c.cov.add(k);
    }
  }
  const posts: InfilPost[] = existing.slice(0, 20).map((f, i) => ({ n: i + 1, x: f.x, y: f.y, name: f.name ?? f.label, source: 'existing' as const, coversPct: 0 }));
  const need = new Set(want);
  for (const k of [...need]) if (seen[k]) need.delete(k);
  const chosen: typeof cands = [];
  while (need.size && chosen.length < I.maxPosts) {
    let best: (typeof cands)[number] | null = null;
    let gain = 0;
    for (const c of cands) {
      if (chosen.includes(c)) continue;
      let gN = 0;
      for (const k of c.cov) if (need.has(k)) gN++;
      if (gN > gain) {
        gain = gN;
        best = c;
      }
    }
    if (!best || gain < 2) break;
    chosen.push(best);
    for (const k of best.cov) need.delete(k);
  }
  chosen.forEach((c) => posts.push({ n: posts.length + 1, x: c.p[0], y: c.p[1], name: c.name, source: 'new', coversPct: want.size ? Math.round((100 * c.cov.size) / want.size) : 0 }));
  const afterPct = want.size ? Math.round((100 * (want.size - need.size)) / want.size) : 100;
  return {
    lanes,
    posts,
    existing,
    seenPct: bandN ? Math.round((100 * seenN) / bandN) : 0,
    afterPct,
    cellM: Math.round(G0.cellM),
    pending: probe.takePending?.() ?? false,
  };
}

/** Length of a ring or path in metres (re-exported for the cards). */
export { ringLength, compass8 };
