/**
 * GroundGuideAor.ts
 *
 * The AOR scale of the Gr Scope rail (user, 2026-11-11, from ground-guide-aor-options.html; Shift+V switches the rail
 * between Spot and AOR). It reads an area of ops (a Coy's, Bn's or Bde's) as the "Gr and Weather" factor of a defence
 * appreciation, in the headings of Material/AprDf.pdf and the marking of Material/Vs72.docx:
 *  - the approaches the threat may use, from its side of the AOR to the MITG, ranked (shortest past the border, least
 *    friction first), each with what AprDf asks of an approach (definition, length, capacity, Tfc, obstacles, cover,
 *    mutual support, deployment areas, direction keeping, significance);
 *  - the lines of def that cut across them, lettered W, X, Y front to rear, and Z through the MITG, with a role each
 *    (screen, FDLs, depth, strong point) and the frontage between the bdys;
 *  - the bridges on the approaches to prepare for demolition, the MSR and the laterals between approaches;
 *  - the going as NO-GO and SLOW-GO only (natural and artificial told apart), and the country it is.
 * It is a plan to check on the ground, not a fact: what the bundle cannot know is left for `confirm` in the view.
 *
 * Pure: no DOM and no ArcGIS. It reads a class grid of the bundle (built here from tiles the guide hands it) and the
 * feature lines and points the guide gathers, all in Web Mercator; it works in ground metres east / north of the MITG.
 * The search for an approach is the Extended View's own (`findAvenue`: NO-GO never crossed, SLOW-GO dearer, ground
 * narrower than the corridor dearer still).
 */

import { findAvenue, mercToPx, pxToMerc, type Going, type OcokaGrid, type TilePeek } from './GroundGuideOcoka';

export type AorXY = [number, number];
export type AorSide = 'Lt' | 'Cen' | 'Rt';
export type AorRole = 'Screen' | 'FDLs' | 'Depth' | 'Str Pt' | '';
export type AorCountry = 'Canal plains' | 'Plains' | 'Riverine' | 'Desert' | 'Mountains' | 'Built-up';
/** Where the AOR's outline came from. `echelon`: a frame of the echelon's size facing the threat. */
export type AorSource = 'boundaries' | 'box' | 'echelon';

/** Per ground class (256 entries): how the AOR reads it. */
export interface AorClassTables {
  /** 1 natural NO-GO area, 2 artificial NO-GO area, 3 natural SLOW-GO area, 4 artificial SLOW-GO area, 9 a line (left out of the hatching), 0 else. */
  kind: Uint8Array;
  /** Downsampling priority: a crossing (bridge, ford) 4 > NO-GO 3 > SLOW-GO 2 > anything else 1 > no data 0. */
  rank: Uint8Array;
  /** 1 built-up, 2 trees / orchards / forest. */
  cover: Uint8Array;
  /** Country groups: 1 slope / escarpment, 2 desert, 3 water / wetland / river bed, 4 built-up, 5 canal / irrigated, 6 cropland. */
  country: Uint8Array;
}

export interface AorGrid {
  /** The grid findAvenue reads (class only; `elev` is empty). */
  g: OcokaGrid;
  /** World pixels (at zoom `z`) per grid cell. */
  f: number;
  z: number;
  ts: number;
  /** World pixel (at `z`) of the grid's top-left corner. */
  wx0: number;
  wy0: number;
}

/**
 * The class grid over a box of world pixels at zoom `z`, `f` tile pixels to a cell. A cell takes the class of highest
 * `rank` among its pixels, so a canal one pixel wide stays a line (NO-GO beats GO) and a bridge over it stays a gap in
 * it (a crossing beats NO-GO). `pending` is set while a tile is still on its way.
 */
export function buildAorGrid(peek: TilePeek, layer: string, z: number, ts: number, lat: number, x0: number, y0: number, x1: number, y1: number, f: number, rank: Uint8Array): AorGrid {
  const wx0 = Math.floor(x0 / f) * f;
  const wy0 = Math.floor(y0 / f) * f;
  const w = Math.max(3, Math.ceil((x1 - wx0) / f));
  const h = Math.max(3, Math.ceil((y1 - wy0) / f));
  const cls = new Uint8Array(w * h).fill(255);
  const best = new Uint8Array(w * h);
  let pending = false;
  const n = 2 ** z;
  const tx0 = Math.floor(wx0 / ts), ty0 = Math.floor(wy0 / ts);
  const tx1 = Math.floor((wx0 + w * f - 1) / ts), ty1 = Math.floor((wy0 + h * f - 1) / ts);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (tx < 0 || ty < 0 || tx >= n || ty >= n) continue;
      const t = peek(layer, tx, ty);
      if (t === undefined) pending = true;
      if (!t) continue;
      for (let row = 0; row < ts; row++) {
        const gy = Math.floor((ty * ts + row - wy0) / f);
        if (gy < 0 || gy >= h) continue;
        for (let col = 0; col < ts; col++) {
          const gx = Math.floor((tx * ts + col - wx0) / f);
          if (gx < 0 || gx >= w) continue;
          const c = t[row * ts + col];
          const r = c === 255 ? 0 : rank[c] || 1;
          const i = gy * w + gx;
          if (r > best[i]) {
            best[i] = r;
            cls[i] = c;
          }
        }
      }
    }
  }
  const res = ((2 * 20037508.342789244) / (ts * n)) * Math.cos((lat * Math.PI) / 180) * f;
  const g: OcokaGrid = { z, ts, tx0, ty0, nx: tx1 - tx0 + 1, ny: ty1 - ty0 + 1, w, h, px0: wx0 / f, py0: wy0 / f, res, elev: new Float32Array(0), cls, bld: null, pending };
  return { g, f, z, ts, wx0, wy0 };
}

// ── input / output ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface AorPlace {
  name: string;
  at: AorXY;
  people: number;
}
export interface AorLine {
  name: string | null;
  /** Feature kind: road, canal, river, railway, ridgeline. */
  key: string;
  xy: Float64Array;
  a: Record<string, unknown>;
}

export interface AorInput {
  grid: AorGrid;
  going: Going;
  tables: AorClassTables;
  /** The outline of the AOR, Web Mercator (a ring; closing it is not needed). */
  outline: AorXY[];
  source: AorSource;
  /** Bearing from the MITG toward the threat, degrees clockwise from north: the approaches come from that side. */
  faceDeg: number;
  mitg: { at: AorXY; name: string | null };
  /** Where each approach starts, Web Mercator, left to right as the defender faces the threat. */
  origins: Array<{ side: AorSide; at: AorXY }>;
  /** True when the starts are assumed (a lead forward of the AOR), not a threat place the user set. */
  originsAssumed: boolean;
  /** Width a corridor for the threat force needs, metres. */
  corridorM: number;
  /** The frontage the FDLs are tested against. */
  frontLimit: { m: number; label: string };
  borders: Array<{ name: string; xy: Float64Array }>;
  places: AorPlace[];
  lines: AorLine[];
  bridges: Array<{ at: AorXY; classed: boolean }>;
  itg: Array<{ at: AorXY; reason: string }>;
}

export interface AorApproach {
  side: AorSide;
  rank: number;
  /** Where it starts: the nearest named place, or null; `across`: beyond the border. */
  from: string | null;
  fromAcross: boolean;
  fromOffsetM: number;
  /** Ground metres east / north of the MITG, simplified. */
  path: AorXY[];
  lengthM: number;
  /** Length on the home side of the border (or inside the AOR when there is no border on it). */
  pastM: number;
  cross: { at: AorXY; border: string; near: string | null; nearM: number; dir: string } | null;
  through: Array<{ name: string; people: number; atM: number }>;
  obstacles: Array<{ name: string; type: string; widthM: number | null; at: AorXY; atM: number; bridge: AorXY | null; bridgeM: number | null }>;
  roadsAlong: Array<{ name: string | null; cls: string | null; km: number }>;
  /** Shares of a 1 km band round it. */
  band: { bua: number; trees: number; go: number };
  /** The narrowest ground between NO-GO areas along it (lines such as canals are crossings, not narrowings), metres, capped at 20 km. */
  minWidthM: number;
  /** The threat's corridor fits all along it. */
  fits: boolean;
  goPct: number;
  /** What it was ranked on (lower first). */
  score: number;
}

export interface AorDefLine {
  id: 'W' | 'X' | 'Y' | 'Z';
  role: AorRole;
  /** "Wagha – Saidanial": the BUAs at its ends. */
  name: string;
  /** Its two ends at the outline, ground metres. */
  cut: [AorXY, AorXY];
  frontM: number;
  /** The BUA astride each approach (left to right), or null where there is none within 800 m. */
  buas: Array<string | null>;
  /** A water line or ridge across the approaches near the cut. */
  obstacle: string | null;
  lateral: boolean;
  /** Metres behind the border (or the AOR's front) on the approaches, null for Z. */
  depthM: number | null;
}

export interface AorReading {
  /** The frame: ground metres are (merc - centre) / k. */
  centre: AorXY;
  k: number;
  faceDeg: number;
  source: AorSource;
  outline: AorXY[];
  mitg: { at: AorXY; name: string };
  originsAssumed: boolean;
  corridorM: number;
  frontLimit: { m: number; label: string };
  country: AorCountry;
  apchs: AorApproach[];
  lines: AorDefLine[];
  laterals: Array<{ a: AorSide; b: AorSide; n: number }>;
  msr: { name: string | null; cls: string | null; distM: number } | null;
  thruRoad: { name: string | null; cls: string | null } | null;
  dml: Array<{ side: AorSide; water: string; at: AorXY; bridgeM: number }>;
  going: { goPct: number; slowPct: number; nogoPct: number; buaPct: number; nogoInAor: number; nogoOut: Array<{ name: string | null; km2: number }> };
  bridges: { inAor: number; classed: number };
  /** NO-GO / SLOW-GO cells for the map: `rows[r]` is runs "k n" (k 0 none, 1-4 as `AorClassTables.kind`), cell `cellM` square from `x0`, `y0` (top-left, ground metres). */
  hatch: { cellM: number; x0: number; y0: number; nx: number; ny: number; rows: string[] };
  /** Lines for the map, ground metres. */
  map: {
    water: Array<{ name: string | null; river: boolean; p: AorXY[] }>;
    roads: Array<{ msr: boolean; p: AorXY[] }>;
    borders: Array<{ name: string; p: AorXY[] }>;
    places: Array<{ name: string; at: AorXY; people: number; across: boolean }>;
    itg: AorXY[];
  };
  pending: boolean;
  ms: number;
  /** Time per stage, ms (cells, apchs, lines, rest). */
  msParts: Record<string, number>;
}

// ── geometry in ground metres ───────────────────────────────────────────────────────────────────────────────────────

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const comp = (dx: number, dy: number): string => COMPASS[Math.round((((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360) / 45) % 8];

function plen(P: AorXY[]): number {
  let s = 0;
  for (let i = 1; i < P.length; i++) s += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
  return s;
}
function distSeg(p: AorXY, a: AorXY, b: AorXY): { d: number; t: number } {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return { d: Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]), t };
}
/** Distance from a point to a polyline, and how far along the polyline its foot is. */
function nearOn(p: AorXY, P: AorXY[]): { d: number; atM: number } {
  let best = Infinity, at = 0, acc = 0;
  for (let i = 0; i + 1 < P.length; i++) {
    const L = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
    const r = distSeg(p, P[i], P[i + 1]);
    if (r.d < best) {
      best = r.d;
      at = acc + r.t * L;
    }
    acc += L;
  }
  return { d: best, atM: at };
}
function segX(p1: AorXY, p2: AorXY, q1: AorXY, q2: AorXY): { at: AorXY; t: number } | null {
  const d = (p2[0] - p1[0]) * (q2[1] - q1[1]) - (p2[1] - p1[1]) * (q2[0] - q1[0]);
  if (d === 0) return null;
  const t = ((q1[0] - p1[0]) * (q2[1] - q1[1]) - (q1[1] - p1[1]) * (q2[0] - q1[0])) / d;
  const u = ((q1[0] - p1[0]) * (p2[1] - p1[1]) - (q1[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { at: [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])], t } : null;
}
/** Where polyline P crosses polyline Q: the points and how far along P each is. */
function crossings(P: AorXY[], Q: AorXY[]): Array<{ at: AorXY; atM: number }> {
  const out: Array<{ at: AorXY; atM: number }> = [];
  let acc = 0;
  for (let i = 0; i + 1 < P.length; i++) {
    const L = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
    for (let j = 0; j + 1 < Q.length; j++) {
      const x = segX(P[i], P[i + 1], Q[j], Q[j + 1]);
      if (x) out.push({ at: x.at, atM: acc + x.t * L });
    }
    acc += L;
  }
  return out.sort((a, b) => a.atM - b.atM);
}
function pointAt(P: AorXY[], s: number): AorXY {
  let acc = 0;
  for (let i = 0; i + 1 < P.length; i++) {
    const L = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
    if (acc + L >= s) {
      const t = L ? (s - acc) / L : 0;
      return [P[i][0] + t * (P[i + 1][0] - P[i][0]), P[i][1] + t * (P[i + 1][1] - P[i][1])];
    }
    acc += L;
  }
  return P[P.length - 1];
}
function inside(p: AorXY, ring: AorXY[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
/** The straight line through `p` along `dir` (unit), cut by the ring: the inside stretch that holds `p`, else the longest. */
function clipLine(p: AorXY, dir: AorXY, ring: AorXY[]): [AorXY, AorXY] | null {
  const ts: number[] = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const d = dir[0] * ey - dir[1] * ex;
    if (Math.abs(d) < 1e-9) continue;
    const t = ((a[0] - p[0]) * ey - (a[1] - p[1]) * ex) / d;
    const u = ((a[0] - p[0]) * dir[1] - (a[1] - p[1]) * dir[0]) / d;
    if (u >= 0 && u <= 1) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  let best: [number, number] | null = null;
  for (let i = 0; i + 1 < ts.length; i += 2) {
    const s: [number, number] = [ts[i], ts[i + 1]];
    if (s[0] <= 0 && s[1] >= 0) {
      best = s;
      break;
    }
    if (!best || s[1] - s[0] > best[1] - best[0]) best = s;
  }
  if (!best || best[1] - best[0] < 50) return null;
  return [
    [p[0] + dir[0] * best[0], p[1] + dir[1] * best[0]],
    [p[0] + dir[0] * best[1], p[1] + dir[1] * best[1]],
  ];
}
type Box = [number, number, number, number];
function boxOf(P: AorXY[], pad: number): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of P) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}
function overlaps(a: Box, b: Box): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}
function simplify(P: AorXY[], tol: number): AorXY[] {
  if (P.length < 3) return P.slice();
  const keep = new Uint8Array(P.length);
  keep[0] = keep[P.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, P.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let md = 0, mk = -1;
    for (let k = i + 1; k < j; k++) {
      const d = distSeg(P[k], P[i], P[j]).d;
      if (d > md) {
        md = d;
        mk = k;
      }
    }
    if (mk >= 0 && md > tol) {
      keep[mk] = 1;
      stack.push([i, mk], [mk, j]);
    }
  }
  return P.filter((_, k) => keep[k]);
}

// ── the reading ─────────────────────────────────────────────────────────────────────────────────────────────────────

const SIDES: AorSide[] = ['Lt', 'Cen', 'Rt'];
const METALLED = /metalled|main_road|motorway|highway/;

function roadClass(c: unknown): number {
  const m = /(\d+)/.exec(String(c ?? ''));
  return m ? Number(m[1]) : 0;
}

export function readAor(inp: AorInput): AorReading {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const t0 = now();
  const lap: Record<string, number> = {};
  let tLap = t0;
  const mark = (k: string) => {
    const t = now();
    lap[k] = Math.round(t - tLap);
    tLap = t;
  };
  const { grid, tables } = inp;
  const g = grid.g;
  const centre = inp.mitg.at;
  const k = Math.cosh(centre[1] / 6378137); // Web Mercator metres per ground metre here
  const L = (m: AorXY): AorXY => [(m[0] - centre[0]) / k, (m[1] - centre[1]) / k];
  const Lxy = (xy: Float64Array): AorXY[] => {
    const out: AorXY[] = [];
    for (let i = 0; i + 1 < xy.length; i += 2) out.push([(xy[i] - centre[0]) / k, (xy[i + 1] - centre[1]) / k]);
    return out;
  };
  // Ground metres <-> grid cells.
  const toCell = (p: AorXY): AorXY => {
    const [wx, wy] = mercToPx(centre[0] + p[0] * k, centre[1] + p[1] * k, grid.z, grid.ts);
    return [(wx - grid.wx0) / grid.f, (wy - grid.wy0) / grid.f];
  };
  const fromCell = (cx: number, cy: number): AorXY => L(pxToMerc(grid.wx0 + cx * grid.f, grid.wy0 + cy * grid.f, grid.z, grid.ts) as AorXY);
  const res = g.res;

  const th = (inp.faceDeg * Math.PI) / 180;
  const FWD: AorXY = [Math.sin(th), Math.cos(th)]; // toward the threat
  const RIGHT: AorXY = [Math.cos(th), -Math.sin(th)];
  const u = (p: AorXY) => p[0] * FWD[0] + p[1] * FWD[1];

  const ring = inp.outline.map(L);
  const borders = inp.borders.map((b) => ({ name: b.name, p: Lxy(b.xy) }));
  const mitgL: AorXY = [0, 0];
  // A place is across when the way from it to the MITG crosses a border.
  const across = (p: AorXY): boolean => borders.some((b) => crossings([p, mitgL], b.p).length > 0);
  const places = inp.places.map((p) => {
    const at = L(p.at);
    return { name: p.name, at, people: p.people, across: across(at) };
  });
  const home = places.filter((p) => !p.across);
  const nearestPlace = (p: AorXY, list: typeof places, minPeople: number, within: number) => {
    let best: (typeof places)[number] | null = null, bd = within;
    for (const q of list) {
      if (q.people < minPeople) continue;
      const d = Math.hypot(q.at[0] - p[0], q.at[1] - p[1]);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    return best ? { place: best, d: bd } : null;
  };
  const mitgName = inp.mitg.name ?? nearestPlace(mitgL, home, 0, 1500)?.place.name ?? 'MITG';

  const lines = inp.lines.map((l) => {
    const p = Lxy(l.xy);
    return { ...l, p, box: boxOf(p, 0) };
  });
  const waterLines = lines.filter((l) => (l.key === 'canal' || l.key === 'river') && l.p.length > 1);
  const ridgeLines = lines.filter((l) => l.key === 'ridgeline' && l.p.length > 1);
  const roads = lines.filter((l) => l.key === 'road' && l.p.length > 1);
  const bridges = inp.bridges.map((b) => ({ at: L(b.at), classed: b.classed }));

  // ── cells inside the AOR, and the home side of its front ──
  const W = g.w, H = g.h;
  const inAor = new Uint8Array(W * H);
  // Web Mercator is separable: a cell's ground x depends on its column only, its y on its row only.
  const colX = new Float64Array(W), rowY = new Float64Array(H);
  for (let x = 0; x < W; x++) colX[x] = fromCell(x + 0.5, 0.5)[0];
  for (let y = 0; y < H; y++) rowY[y] = fromCell(0.5, y + 0.5)[1];
  const cellAt = (i: number): AorXY => [colX[i % W], rowY[Math.floor(i / W)]];
  let uFront = -Infinity;
  for (const p of ring) uFront = Math.max(uFront, u(p));
  // Inside the ring, row by row (even-odd crossings).
  for (let y = 0; y < H; y++) {
    const py = rowY[y];
    const xs: number[] = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if (a[1] > py !== b[1] > py) xs.push(((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0]);
    }
    xs.sort((p, q) => p - q);
    for (let x = 0, k2 = 0; x < W; x++) {
      while (k2 < xs.length && xs[k2] <= colX[x]) k2++;
      if (k2 % 2 === 1) inAor[y * W + x] = 1;
    }
  }
  const avoidBase = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!inAor[i] && colX[x] * FWD[0] + rowY[y] * FWD[1] < uFront) avoidBase[i] = 1; // home side, outside the bdys
    }

  mark('cells');
  // ── width between NO-GO areas ──
  // A corridor's capacity is the gap between NO-GO areas (a lake, a river bed, a marsh) big enough to matter to the force
  // (a square a quarter of its corridor wide: 0.25 km2 for a Bde); canals and
  // streams are lines crossed at bridges and fords (listed as obstacles), not a narrowing of the corridor.
  const areaSeed = new Uint8Array(W * H);
  {
    const minCells = Math.max(1, Math.round(((inp.corridorM / 4) ** 2) / (res * res))); // Bde (2 km): 0.25 km2
    const seen = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const kd = tables.kind[g.cls[i]];
      if (seen[i] || (kd !== 1 && kd !== 2)) continue;
      const comp: number[] = [i];
      seen[i] = 1;
      for (let qi = 0; qi < comp.length; qi++) {
        const j = comp[qi], x = j % W, y = Math.floor(j / W);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const jj = yy * W + xx, kk = tables.kind[g.cls[jj]];
          if (!seen[jj] && (kk === 1 || kk === 2)) {
            seen[jj] = 1;
            comp.push(jj);
          }
        }
      }
      if (comp.length >= minCells) for (const j of comp) areaSeed[j] = 1;
    }
  }
  /** The gap across the approach at a cell, both ways to the nearest NO-GO area (or 10 km), metres. */
  const gapAt = (cx: number, cy: number, ux: number, uy: number): number => {
    const maxSteps = Math.ceil(10000 / res);
    let total = 0;
    for (const sgn of [1, -1]) {
      let d = maxSteps;
      for (let st = 1; st <= maxSteps; st++) {
        const x = Math.floor(cx + sgn * ux * st), y = Math.floor(cy + sgn * uy * st);
        if (x < 0 || y < 0 || x >= W || y >= H) break;
        if (areaSeed[y * W + x]) {
          d = st;
          break;
        }
      }
      total += d * res;
    }
    return Math.min(20000, total);
  };

  // ── approaches ──
  const goalC = toCell(mitgL);
  const taken = new Uint8Array(W * H);
  const apchs: AorApproach[] = [];
  for (const o of inp.origins) {
    const sL = L(o.at);
    const sC = toCell(sL);
    const avoid = avoidBase.slice();
    if (apchs.length) {
      let spread = 0;
      for (const q of inp.origins) for (const q2 of inp.origins) spread = Math.max(spread, Math.hypot(q.at[0] - q2.at[0], q.at[1] - q2.at[1]) / k);
      const apartM = Math.min(1500, Math.max(400, spread / 6));
      const r = Math.max(1, Math.round(apartM / res));
      const keepOut = 5000;
      for (let i = 0; i < W * H; i++) {
        if (!taken[i]) continue;
        const cx = i % W, cy = Math.floor(i / W);
        for (let yy = Math.max(0, cy - r); yy <= Math.min(H - 1, cy + r); yy++)
          for (let xx = Math.max(0, cx - r); xx <= Math.min(W - 1, cx + r); xx++) {
            const j = yy * W + xx;
            const q = cellAt(j);
            if (Math.hypot(q[0], q[1]) > keepOut) avoid[j] = 1;
          }
      }
    }
    const a = findAvenue(g, sC[0], sC[1], goalC[0], goalC[1], { going: inp.going, frontageM: inp.corridorM, avoid, avoidCost: 3 });
    if (!a.reached) continue;
    const raw: AorXY[] = [];
    for (let i = 0; i + 1 < a.path.length; i += 2) {
      raw.push(fromCell(a.path[i], a.path[i + 1]));
      taken[Math.floor(a.path[i + 1]) * W + Math.floor(a.path[i])] = 1;
    }
    const path = simplify(raw, res * 1.5);
    const lengthM = plen(path);
    let widthM = 20000;
    {
      // Across the approach every ~250 m (its direction over a few cells), leaving out the first and last km.
      const edge = Math.max(2, Math.round(1000 / res));
      const nCells = a.path.length / 2;
      const step = Math.max(1, Math.round(250 / res));
      const span = Math.max(2, Math.round(300 / res));
      for (let q = edge; q < nCells - edge; q += step) {
        const q0 = Math.max(0, q - span), q1 = Math.min(nCells - 1, q + span);
        const dx = a.path[q1 * 2] - a.path[q0 * 2], dy = a.path[q1 * 2 + 1] - a.path[q0 * 2 + 1];
        const L = Math.hypot(dx, dy) || 1;
        widthM = Math.min(widthM, gapAt(a.path[q * 2], a.path[q * 2 + 1], -dy / L, dx / L));
      }
    }
    // Where it crosses a border, and what it is near there.
    let cross: AorApproach['cross'] = null;
    let entryM = 0;
    for (const b of borders) {
      const xs = crossings(path, b.p);
      if (!xs.length) continue;
      const last = xs[xs.length - 1];
      if (!cross || last.atM > entryM) {
        entryM = last.atM;
        const n = nearestPlace(last.at, home, 200, 6000);
        cross = { at: last.at, border: b.name, near: n?.place.name ?? null, nearM: n?.d ?? 0, dir: n ? comp(last.at[0] - n.place.at[0], last.at[1] - n.place.at[1]) : '' };
      }
    }
    if (!cross) {
      // No border on it: measured from where it enters the AOR.
      const xs = crossings(path, [...ring, ring[0]]);
      entryM = xs.length ? xs[0].atM : 0;
    }
    const start = nearestPlace(sL, places, 0, 3000);
    // Places it passes through.
    const thr: AorApproach['through'] = [];
    for (const p of home) {
      if (p.people < 300 || p.name === mitgName) continue;
      const n = nearOn(p.at, path);
      if (n.d < 450) thr.push({ name: p.name, people: p.people, atM: n.atM });
    }
    thr.sort((x, y) => x.atM - y.atM);
    const seen = new Set<string>();
    const through = thr.filter((t) => (seen.has(t.name) ? false : (seen.add(t.name), true)));
    // Water across it, with the nearest bridge.
    const obs: AorApproach['obstacles'] = [];
    for (const wl of waterLines) {
      for (const x of crossings(path, wl.p)) {
        let bb: AorXY | null = null, bd = Infinity;
        for (const b of bridges) {
          const d = Math.hypot(b.at[0] - x.at[0], b.at[1] - x.at[1]);
          if (d < bd) {
            bd = d;
            bb = b.at;
          }
        }
        const wv = Number(wl.a.w);
        obs.push({ name: wl.name ?? (wl.key === 'river' ? 'Stream' : 'Canal'), type: String(wl.a.t ?? (wl.key === 'river' ? 'Nala' : 'Canal')), widthM: Number.isFinite(wv) && wv > 0 ? wv : null, at: x.at, atM: x.atM, bridge: bd <= 1000 ? bb : null, bridgeM: bd <= 1000 ? bd : null });
      }
    }
    obs.sort((x, y) => x.atM - y.atM);
    const obstacles = obs.filter((o2, i) => !(i > 0 && obs[i - 1].name === o2.name && o2.atM - obs[i - 1].atM < 300));
    // Roads along it.
    const along = new Map<string, { name: string | null; cls: string | null; m: number }>();
    const pb = boxOf(path, 150);
    for (const r of roads) {
      if (!overlaps(r.box, pb)) continue;
      for (let i = 0; i + 1 < r.p.length; i++) {
        const m: AorXY = [(r.p[i][0] + r.p[i + 1][0]) / 2, (r.p[i][1] + r.p[i + 1][1]) / 2];
        if (nearOn(m, path).d >= 150) continue;
        const key = `${r.name ?? ''}|${r.a.c ?? ''}`;
        const e = along.get(key) ?? { name: r.name, cls: (r.a.c as string) ?? null, m: 0 };
        e.m += Math.hypot(r.p[i + 1][0] - r.p[i][0], r.p[i + 1][1] - r.p[i][1]);
        along.set(key, e);
      }
    }
    const roadsAlong = [...along.values()].filter((e) => e.m > 800).sort((x, y) => y.m - x.m).slice(0, 4).map((e) => ({ name: e.name, cls: e.cls, km: Math.round(e.m / 100) / 10 }));
    // A 1 km band round it.
    const band = new Uint8Array(W * H);
    const r5 = Math.max(1, Math.round(500 / res));
    for (let i = 0; i + 1 < a.path.length; i += 2) {
      const cx = Math.floor(a.path[i]), cy = Math.floor(a.path[i + 1]);
      for (let yy = Math.max(0, cy - r5); yy <= Math.min(H - 1, cy + r5); yy++) for (let xx = Math.max(0, cx - r5); xx <= Math.min(W - 1, cx + r5); xx++) band[yy * W + xx] = 1;
    }
    let nb = 0, nBua = 0, nTree = 0, nGo = 0;
    for (let i = 0; i < W * H; i++) {
      if (!band[i]) continue;
      const c = g.cls[i];
      if (c === 255) continue;
      nb++;
      if (tables.cover[c] === 1) nBua++;
      else if (tables.cover[c] === 2) nTree++;
      if (!inp.going.nogo[c] && !inp.going.caution[c]) nGo++;
    }
    apchs.push({
      side: o.side,
      rank: 0,
      from: start?.place.name ?? null,
      fromAcross: start ? start.place.across : !!cross,
      fromOffsetM: start?.d ?? 0,
      path,
      lengthM,
      pastM: Math.max(0, lengthM - entryM),
      cross,
      through,
      obstacles,
      roadsAlong,
      band: { bua: nb ? nBua / nb : 0, trees: nb ? nTree / nb : 0, go: nb ? nGo / nb : 0 },
      minWidthM: widthM,
      fits: widthM >= inp.corridorM,
      goPct: a.goPct,
      score: 0,
    });
  }
  mark('apchs');
  for (const a of apchs) a.score = a.pastM / 1000 + a.through.length * 0.3 + a.obstacles.length * 2 + (1 - a.band.go) * 10;
  [...apchs].sort((x, y) => x.score - y.score).forEach((a, i) => (a.rank = i + 1));

  // ── laterals: metalled roads of class 30 and up that touch two approaches ──
  const latN = new Map<string, number>();
  for (const r of roads) {
    if (!METALLED.test(String(r.a.t ?? '')) || roadClass(r.a.c) < 30) continue;
    const step = Math.max(1, Math.floor(r.p.length / 10));
    const sample = r.p.filter((_, i) => i % step === 0).concat([r.p[r.p.length - 1]]);
    const hit = apchs.filter((a) => overlaps(r.box, boxOf(a.path, 250)) && sample.some((p) => nearOn(p, a.path).d < 250)).map((a) => a.side);
    for (let i = 0; i < hit.length; i++)
      for (let j = i + 1; j < hit.length; j++) {
        const key = [hit[i], hit[j]].sort((x, y) => SIDES.indexOf(x) - SIDES.indexOf(y)).join('-');
        latN.set(key, (latN.get(key) ?? 0) + 1);
      }
  }
  const laterals = [...latN.entries()].map(([key, n]) => ({ a: key.split('-')[0] as AorSide, b: key.split('-')[1] as AorSide, n })).sort((x, y) => y.n - x.n);

  // ── lines of def ──
  const PERP: AorXY = RIGHT;
  const defLines: AorDefLine[] = [];
  if (apchs.length >= 2) {
    const ordered = [...apchs].sort((x, y) => SIDES.indexOf(x.side) - SIDES.indexOf(y.side));
    const entry = ordered.map((a) => a.lengthM - a.pastM);
    const dmax = Math.min(...ordered.map((a) => a.pastM)) - 2500;
    type Cand = { d: number; pts: AorXY[]; buas: Array<{ name: string; d: number; people: number } | null>; obstacle: string | null; lateral: boolean; score: number };
    const cands: Cand[] = [];
    const xings = ordered.map((a) => {
      const pb = boxOf(a.path, 0);
      const out: Array<{ name: string; atM: number }> = [];
      for (const ol of [...waterLines, ...ridgeLines]) {
        if (!overlaps(ol.box, pb)) continue;
        for (const x of crossings(a.path, ol.p)) out.push({ name: ol.name ?? (ol.key === 'ridgeline' ? 'Ridge' : 'Water ch'), atM: x.atM });
      }
      return out;
    });
    const metalled = roads.filter((r) => METALLED.test(String(r.a.t ?? '')));
    for (let d = 1000; d <= dmax; d += 250) {
      const pts = ordered.map((a, i) => pointAt(a.path, entry[i] + d));
      const buas = pts.map((p) => {
        const n = nearestPlace(p, home, 300, 800);
        return n ? { name: n.place.name, d: n.d, people: n.place.people } : null;
      });
      if (buas.filter(Boolean).length < 2) continue;
      let bscore = 0;
      for (const b of buas) if (b) bscore += (b.d <= 400 ? 1 : 0.5) * (b.people >= 1000 ? 1 : 0.6);
      // A water line or ridge crossing two or more approaches within 500 m of the cut.
      const hits = new Map<string, number>();
      ordered.forEach((_a, i) => {
        const seenN = new Set<string>();
        for (const x of xings[i]) {
          if (seenN.has(x.name) || Math.abs(x.atM - (entry[i] + d)) >= 500) continue;
          seenN.add(x.name);
          hits.set(x.name, (hits.get(x.name) ?? 0) + 1);
        }
      });
      let obstacle: string | null = null, on = 0;
      for (const [nm, n] of hits) if (n > on) ((obstacle = nm), (on = n));
      if (on < 2) obstacle = null;
      let lateral = false;
      const cb = boxOf(pts, 400);
      for (const r of metalled) {
        if (!overlaps(r.box, cb)) continue;
        if (pts.filter((p) => nearOn(p, r.p).d < 400).length >= 2) {
          lateral = true;
          break;
        }
      }
      const fwd = Math.max(0, 1 - d / 14000);
      cands.push({ d, pts, buas, obstacle, lateral, score: bscore + (obstacle ? on * 1.4 : 0) + (lateral ? 0.8 : 0) + fwd * 0.6 });
    }
    cands.sort((x, y) => y.score - x.score);
    const picked: Cand[] = [];
    for (const c of cands) {
      if (c.score < 1.4) continue;
      if (picked.every((p) => Math.abs(p.d - c.d) >= 1800)) picked.push(c);
      if (picked.length === 3) break;
    }
    picked.sort((x, y) => x.d - y.d);
    const ids: Array<'W' | 'X' | 'Y'> = ['W', 'X', 'Y'];
    picked.forEach((c, i) => {
      const cx = c.pts.reduce((s, p) => s + p[0], 0) / c.pts.length, cy = c.pts.reduce((s, p) => s + p[1], 0) / c.pts.length;
      const cut = clipLine([cx, cy], PERP, ring);
      if (!cut) return;
      const named = c.buas.filter(Boolean) as Array<{ name: string }>;
      defLines.push({
        id: ids[i],
        role: '',
        name: c.obstacle ? `Along ${c.obstacle}` : named.length >= 2 ? `${named[0].name} – ${named[named.length - 1].name}` : (named[0]?.name ?? ''),
        cut,
        frontM: Math.hypot(cut[1][0] - cut[0][0], cut[1][1] - cut[0][1]),
        buas: c.buas.map((b) => b?.name ?? null),
        obstacle: c.obstacle,
        lateral: c.lateral,
        depthM: c.d,
      });
    });
  }
  // Z: through the MITG, square to the axis.
  const zc = clipLine(mitgL, PERP, ring);
  if (zc) {
    const far = Math.hypot(zc[0][0], zc[0][1]) > Math.hypot(zc[1][0], zc[1][1]) ? zc[0] : zc[1];
    let end: string | null = null, ed = Infinity;
    for (const p of home) {
      if (p.people < 300 || p.name === mitgName) continue;
      const n = distSeg(p.at, mitgL, far);
      if (n.d < 700) {
        const s = n.d + 0.3 * Math.hypot(p.at[0] - far[0], p.at[1] - far[1]);
        if (s < ed) ((ed = s), (end = p.name));
      }
    }
    defLines.push({ id: 'Z', role: 'Str Pt', name: end ? `${mitgName} – ${end}` : mitgName, cut: zc, frontM: Math.hypot(zc[1][0] - zc[0][0], zc[1][1] - zc[0][1]), buas: [mitgName, end], obstacle: null, lateral: false, depthM: null });
  }
  // Roles: FDLs on the first line with a BUA (or an obstacle) on every approach, a screen in front, depth 2 km or more behind.
  const fronts = defLines.filter((l) => l.id !== 'Z');
  const fdl = fronts.find((l) => !!l.obstacle || l.buas.every(Boolean)) ?? fronts[0];
  if (fdl) {
    fdl.role = 'FDLs';
    const depth = fronts.find((l) => l !== fdl && (l.depthM ?? 0) >= (fdl.depthM ?? 0) + 2000);
    if (depth) depth.role = 'Depth';
    const screen = fronts.find((l) => (l.depthM ?? 0) < (fdl.depthM ?? 0));
    if (screen) screen.role = 'Screen';
  }

  mark('lines');
  // ── MITG facts ──
  let msr: AorReading['msr'] = null, thru: AorReading['thruRoad'] = null, thruD = 150;
  for (const r of roads) {
    const d = nearOn(mitgL, r.p).d;
    if (r.a.m && d < 1500 && (!msr || d < msr.distM)) msr = { name: r.name, cls: (r.a.c as string) ?? null, distM: d };
    if (d < thruD && r.name) ((thruD = d), (thru = { name: r.name, cls: (r.a.c as string) ?? null }));
  }

  // ── demolition: a bridge within 1 km of where an approach crosses water ──
  const dml: AorReading['dml'] = [];
  for (const a of apchs) for (const o of a.obstacles) if (o.bridge && o.bridgeM !== null) dml.push({ side: a.side, water: o.name, at: o.bridge, bridgeM: o.bridgeM });

  // ── going and country over the AOR ──
  let nIn = 0, nGo = 0, nSlow = 0, nNogo = 0, nBua = 0;
  const grp = new Float64Array(8);
  for (let i = 0; i < W * H; i++) {
    if (!inAor[i]) continue;
    const c = g.cls[i];
    if (c === 255) continue;
    nIn++;
    if (inp.going.nogo[c]) nNogo++;
    else if (inp.going.caution[c]) nSlow++;
    else nGo++;
    if (tables.cover[c] === 1) nBua++;
    grp[tables.country[c]]++;
  }
  const sh = (i: number) => (nIn ? grp[i] / nIn : 0);
  const country: AorCountry =
    sh(1) > 0.15 ? 'Mountains' : sh(2) > 0.3 ? 'Desert' : sh(3) > 0.15 ? 'Riverine' : sh(4) > 0.35 ? 'Built-up' : sh(5) + sh(6) > 0.5 && sh(5) > 0.005 ? 'Canal plains' : 'Plains';
  // NO-GO patches (areas, not lines) of 0.2 km2 and more.
  const seenB = new Uint8Array(W * H);
  const cellKm2 = (res * res) / 1e6;
  let nogoIn = 0;
  const nogoOut: Array<{ name: string | null; km2: number }> = [];
  for (let i = 0; i < W * H; i++) {
    const kd = tables.kind[g.cls[i]];
    if (seenB[i] || (kd !== 1 && kd !== 2)) continue;
    const q = [i];
    seenB[i] = 1;
    let n = 0, sx = 0, sy = 0, inn = 0;
    while (q.length) {
      const j = q.pop()!;
      n++;
      const x = j % W, y = Math.floor(j / W);
      sx += x;
      sy += y;
      if (inAor[j]) inn++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const jj = yy * W + xx;
        const kk = tables.kind[g.cls[jj]];
        if (!seenB[jj] && (kk === 1 || kk === 2)) {
          seenB[jj] = 1;
          q.push(jj);
        }
      }
    }
    if (n * cellKm2 < 0.2) continue;
    if (inn > n / 2) nogoIn++;
    else {
      const c = fromCell(sx / n + 0.5, sy / n + 0.5);
      let nm: string | null = null, nd = 1200;
      for (const wl of waterLines) {
        const d = nearOn(c, wl.p).d - (wl.key === 'river' ? 200 : 0); // a river names its own bed before a canal beside it
        if (d < nd && wl.name) ((nd = d), (nm = wl.name));
      }
      const same = nogoOut.find((o) => o.name === nm && nm !== null);
      if (same) same.km2 += n * cellKm2;
      else nogoOut.push({ name: nm, km2: n * cellKm2 });
    }
  }
  nogoOut.sort((a, b) => b.km2 - a.km2);

  // ── hatching for the map ──
  const hf = Math.max(1, Math.ceil(Math.max(W, H) / 180));
  const nx = Math.ceil(W / hf), ny = Math.ceil(H / hf);
  const rows: string[] = [];
  for (let ry = 0; ry < ny; ry++) {
    const runs: string[] = [];
    let prev = -1, run = 0;
    for (let rx = 0; rx < nx; rx++) {
      const cnt = [0, 0, 0, 0, 0];
      let all = 0;
      for (let y = ry * hf; y < Math.min(H, (ry + 1) * hf); y++)
        for (let x = rx * hf; x < Math.min(W, (rx + 1) * hf); x++) {
          all++;
          const kd = tables.kind[g.cls[y * W + x]];
          if (kd >= 1 && kd <= 4) cnt[kd]++;
        }
      let kBest = 0;
      for (let kk = 1; kk <= 4; kk++) if (cnt[kk] > cnt[kBest] || (kBest === 0 && cnt[kk] > 0)) kBest = kk;
      const v = kBest && cnt[kBest] / Math.max(1, all) >= 0.4 ? kBest : 0;
      if (v === prev) run++;
      else {
        if (prev >= 0) runs.push(`${prev} ${run}`);
        prev = v;
        run = 1;
      }
    }
    runs.push(`${prev} ${run}`);
    rows.push(runs.join(','));
  }
  const tl = fromCell(0, 0);
  const hatch = { cellM: res * hf, x0: tl[0], y0: tl[1], nx, ny, rows };

  // ── for the map: lines and places in reach ──
  let reach = 0;
  for (const p of ring) reach = Math.max(reach, Math.hypot(p[0], p[1]));
  for (const a of apchs) for (const p of a.path) reach = Math.max(reach, Math.hypot(p[0], p[1]));
  reach += 2000;
  const near = (P: AorXY[]) => P.some((p) => Math.hypot(p[0], p[1]) < reach);
  const map: AorReading['map'] = {
    water: waterLines.filter((l) => near(l.p)).map((l) => ({ name: l.name, river: l.key === 'river', p: simplify(l.p, 25) })),
    roads: roads.filter((r) => (r.a.m || (METALLED.test(String(r.a.t ?? '')) && roadClass(r.a.c) >= 30)) && near(r.p)).map((r) => ({ msr: !!r.a.m, p: simplify(r.p, 25) })),
    borders: borders.filter((b) => near(b.p)).map((b) => ({ name: b.name, p: simplify(b.p, 30) })),
    places: places.filter((p) => Math.hypot(p.at[0], p.at[1]) < reach && (p.people >= 300 || p.across)),
    itg: inp.itg.map((t) => L(t.at)).filter((p) => Math.hypot(p[0], p[1]) < reach),
  };
  // Bridges in the AOR, and how many of them carry a load class.
  let bIn = 0, bCl = 0;
  for (const b of bridges) if (inside(b.at, ring)) ((bIn++), b.classed && bCl++);

  mark('rest');
  const t1 = now();
  return {
    centre,
    k,
    faceDeg: inp.faceDeg,
    source: inp.source,
    outline: ring,
    mitg: { at: mitgL, name: mitgName },
    originsAssumed: inp.originsAssumed,
    corridorM: inp.corridorM,
    frontLimit: inp.frontLimit,
    country,
    apchs,
    lines: defLines,
    laterals,
    msr,
    thruRoad: thru,
    dml,
    going: { goPct: nIn ? (100 * nGo) / nIn : 0, slowPct: nIn ? (100 * nSlow) / nIn : 0, nogoPct: nIn ? (100 * nNogo) / nIn : 0, buaPct: nIn ? (100 * nBua) / nIn : 0, nogoInAor: nogoIn, nogoOut: nogoOut.slice(0, 3) },
    bridges: { inAor: bIn, classed: bCl },
    hatch,
    map,
    pending: g.pending,
    ms: Math.round(t1 - t0),
    msParts: lap,
  };
}

/** A short key of a reading's inputs, for "same AOR, same answer". */
export function aorInputKey(i: Pick<AorInput, 'outline' | 'faceDeg' | 'mitg' | 'origins' | 'corridorM' | 'source'>): string {
  const r = (v: number) => Math.round(v / 50);
  return [i.source, Math.round(i.faceDeg), r(i.mitg.at[0]), r(i.mitg.at[1]), i.corridorM, ...i.outline.flatMap((p) => [r(p[0]), r(p[1])]), ...i.origins.flatMap((o) => [r(o.at[0]), r(o.at[1])])].join('|');
}
