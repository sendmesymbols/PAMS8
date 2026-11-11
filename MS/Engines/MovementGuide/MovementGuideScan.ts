/**
 * MovementGuideScan.ts
 *
 * The Movement Guide's pure engine: what a route, a cordon or an infiltration lane meets on the ground, read from
 * the terrain bundle through a `MovProbe` the caller supplies. No runtime imports, no DOM, no ArcGIS, so Node runs it
 * as it is (`node tools/movement-test/run.mjs`) and the browser runs the same code.
 *
 * Everything is in Web Mercator metres (x east, y north); distances on the ground are Mercator metres times the
 * cosine of the latitude. The rules and figures come from MS/Data/MovementDoctrine.json (a mix of roadmap rules from
 * the pamphlets and marked proposals); `rulesFrom` fills in a default for anything the file leaves out.
 *
 * What it gives (safety of the move only; march tables, packets and timings are on hold):
 *  - `RouteScanner.scan`: stations every 50 m along the route, each read once per segment (cached), and the dangers
 *    on it merged into stretches: vulnerable points, likely ambush sites, likely mine / IED spots, places the enemy
 *    can block the road, no way off the road, ground or rooftops that overlook it, built-up stretches, sensitive sites,
 *    natural hazards, ground the threat may see, the border within reach.
 *  - `planPickets`: piquets that dominate the road (both sides, or the fewest that cover it), with the gaps left.
 *  - `checkPosts`, `clearanceOrder`, `casevacFor`: junctions that cannot be bypassed, which stretches to clear first,
 *    the nearest hospital and landing site.
 *  - `cordonPlan` / `buaRingAround`: troops for a cordon round a drawn area or the built-up area at a point.
 *  - `laneCheck`: an infiltration lane against one night's march, roads, obstacles, villages and the threat's view.
 */

export type MercXY = [number, number];

const EARTH_R = 6378137;
const D2R = Math.PI / 180;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

// ── geometry ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function latOfY(y: number): number {
  return 2 * Math.atan(Math.exp(y / EARTH_R)) - Math.PI / 2;
}
/** Ground metres per Web Mercator metre at a northing. */
export function scaleAt(y: number): number {
  return Math.max(0.05, Math.cos(latOfY(y)));
}
export function groundDist(a: MercXY, b: MercXY): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]) * scaleAt((a[1] + b[1]) / 2);
}
export function bearingOf(a: MercXY, b: MercXY): number {
  return ((Math.atan2(b[0] - a[0], b[1] - a[1]) / D2R) + 360) % 360;
}
export function offsetPt(x: number, y: number, bearingDeg: number, distM: number): MercXY {
  const s = scaleAt(y);
  return [x + (Math.sin(bearingDeg * D2R) * distM) / s, y + (Math.cos(bearingDeg * D2R) * distM) / s];
}
export function compass8(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
export function mercToLngLat(x: number, y: number): [number, number] {
  return [(x * 180) / (Math.PI * EARTH_R), latOfY(y) / D2R];
}
export function lngLatToMerc(lng: number, lat: number): MercXY {
  const c = Math.max(-85.05112878, Math.min(85.05112878, lat));
  return [(lng * Math.PI * EARTH_R) / 180, Math.log(Math.tan(Math.PI / 4 + (c * D2R) / 2)) * EARTH_R];
}
function angDiff(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}
/** Ground distance from a point to a polyline (x0, y0, x1, y1, ...). */
export function distToLine(p: MercXY, xy: ArrayLike<number>): number {
  let best = Infinity;
  for (let i = 0; i + 3 < xy.length; i += 2) {
    const ax = xy[i], ay = xy[i + 1];
    const dx = xy[i + 2] - ax, dy = xy[i + 3] - ay;
    const len = dx * dx + dy * dy;
    const t = len > 0 ? Math.min(1, Math.max(0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len)) : 0;
    const d = (ax + t * dx - p[0]) ** 2 + (ay + t * dy - p[1]) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best) * scaleAt(p[1]);
}
export function pointInRing(p: MercXY, ring: MercXY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Where two segments cross, or null. */
function segCross(a: MercXY, b: MercXY, c: MercXY, d: MercXY): MercXY | null {
  const r0 = b[0] - a[0], r1 = b[1] - a[1];
  const s0 = d[0] - c[0], s1 = d[1] - c[1];
  const den = r0 * s1 - r1 * s0;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * s1 - (c[1] - a[1]) * s0) / den;
  const u = ((c[0] - a[0]) * r1 - (c[1] - a[1]) * r0) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a[0] + t * r0, a[1] + t * r1];
}
export function convexHull(pts: MercXY[]): MercXY[] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: MercXY, a: MercXY, b: MercXY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: MercXY[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: MercXY[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
function centroidOf(ring: MercXY[]): MercXY {
  let x = 0, y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / Math.max(1, ring.length), y / Math.max(1, ring.length)];
}
/** Each vertex of a (convex) ring pushed `distM` away from the centroid. */
export function growRing(ring: MercXY[], distM: number): MercXY[] {
  const c = centroidOf(ring);
  return ring.map((p) => {
    const d = groundDist(c, p);
    if (d < 1) return offsetPt(p[0], p[1], 0, distM);
    return offsetPt(p[0], p[1], bearingOf(c, p), distM);
  });
}
export function ringLength(ring: MercXY[]): number {
  let L = 0;
  for (let i = 0; i < ring.length; i++) L += groundDist(ring[i], ring[(i + 1) % ring.length]);
  return L;
}
export function ringAreaKm2(ring: MercXY[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  const s = scaleAt(centroidOf(ring)[1]);
  return (Math.abs(a / 2) * s * s) / 1e6;
}

// ── probe and rules ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface NearFeature {
  kind: string;
  label: string;
  name: string | null;
  x: number;
  y: number;
  distM: number;
  attrs: Record<string, unknown>;
}
export interface NearRoad {
  distM: number;
  x: number;
  y: number;
  attrs: Record<string, unknown>;
}
export interface NearLine {
  kind: string;
  xy: ArrayLike<number>;
  attrs: Record<string, unknown>;
}
/**
 * The terrain bundle as the engine sees it. Every read is synchronous and must not wait: a tile that is still on its
 * way reads as unknown (null / NaN / empty), and the caller scans again when it arrives.
 */
export interface MovProbe {
  /** Ground class (rules.json `classes`) at a point; null when not known. */
  cls(x: number, y: number): number | null;
  /** Elevation, metres; NaN when not known. */
  elev(x: number, y: number): number;
  /** Building layer value (density | size << 3 | height << 6); 0 = none or not known. */
  bld(x: number, y: number): number;
  /** The chance (0-1) that a target `targetM` tall at t is seen from an eye `eyeM` above o; null when not known. */
  sight(ox: number, oy: number, eyeM: number, tx: number, ty: number, targetM: number): number | null;
  features(x: number, y: number, radiusM: number, kinds: ReadonlySet<string>): NearFeature[];
  roads(x: number, y: number, radiusM: number): NearRoad[];
  lines(x: number, y: number, radiusM: number, kinds: ReadonlySet<string>): NearLine[];
  /** People per km² at a point; null when not known. */
  people(x: number, y: number): number | null;
  /** Ground metres per pixel of the finest tiles (the flood fill's step). */
  resM: number;
  /**
   * True when a read since the last call met data still loading (and clears the flag). Optional: a probe without it
   * is taken as always complete.
   */
  takePending?(): boolean;
}

/** A mover's NO-GO and SLOW-GO ground classes. */
export interface GoingSets {
  nogo: ReadonlySet<number>;
  caution: ReadonlySet<number>;
}

export type Rules = Record<string, any>;
/** The doctrine file with every value it leaves out filled in from the defaults below. */
export function rulesFrom(doc: unknown): Rules {
  const d: Rules = (doc && typeof doc === 'object' ? doc : {}) as Rules;
  const out: Rules = {};
  for (const [k, v] of Object.entries(DEFAULT_RULES)) out[k] = { ...v, ...(d[k] ?? {}) };
  return out;
}
const DEFAULT_RULES: Rules = {
  scan: { stationM: 50, liveStationM: 75, maxStations: 1200, sideOffsetsM: [15, 30, 60, 100], bendDeg: 35, bendWindowM: 100, crestRiseM: 3, crestWindowM: 150, gradientPct: 8, gradientWindowM: 100, roadClasses: [34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 50], junctionRadiusM: 40, junctionKinds: ['main_junction', 'road_junction'] },
  vp: { radiusM: 40, kinds: ['culvert', 'bridge', 'bridge_iron', 'foot_bridge', 'ford', 'ferry', 'boat_bridge', 'tunnel', 'viaduct', 'aqueduct', 'siphon'], classes: { 24: 'Embankment', 26: 'Cutting', 39: 'Bridge', 40: 'Bridge', 41: 'Bridge', 42: 'Bridge', 43: 'Rly bridge', 45: 'Ford / ferry', 50: 'Level crossing' } },
  ambush: { coverFromM: 30, coverToM: 300, coverClasses: [1, 3, 15, 17, 24, 25, 26, 27, 29, 30, 31, 32, 47, 49], riseM: 10, villageKm: 1, reinforcementKinds: ['cantonment', 'police_station', 'fort', 'post', 'border_post'], reinforcementKm: 3, minScore: 50, kzM: 150, followM: 300, meetingM: 800, stopM: 100, fireOffsetMaxM: 120 },
  mine: { minScore: 40 },
  block: { bypassM: 100, approachM: 800, turnM: 150, minApartM: 400, obstacleClasses: [4, 5, 6, 9, 20, 21, 22, 24, 27, 28, 31, 49], positionOffsetsM: [150, 300, 500], minSeesPct: 30 },
  convoy: { vehicles: 30, packetSize: 8, gapMin: 5, vehGapM: 100, speedDayKmh: 40, speedNightKmh: 16, boundKm: 12, haltEveryMin: 120, haltMin: 15 },
  patrol: { marginM: 800, maxCells: 300, villageM: 300, villageKinds: ['town', 'village_imp', 'village', 'city', 'district_hq'], slowCost: 1.8, roadCost: 3, villageCost: 6, woodEdgeCost: 2.5, skylineM: 120, skylineRiseM: 8, skylineCost: 3, threatKm: 5, threatEyeM: 3, seenCost: 6, separateM: 150, separateCost: 8, endFreeM: 120 },
  infil: { bandM: 1500, maxCells: 260, slowCost: 1.8, roadVillageCost: 4, postKinds: ['post', 'border_post', 'watch_tower', 'fort', 'bunker'], rangeM: 1500, sampleM: 60, eyeM: 3, seenCost: 12, lanes: 3, separateM: 400, separateCost: 10, postEveryM: 500, postOffsetsM: [200, 600], heightKinds: ['peak', 'hill', 'knoll', 'trig_station'], maxCandidates: 160, maxPosts: 12 },
  overlook: { riseM: 15, offsetsM: [150, 300, 500, 800], skewDeg: [0, 35, -35], eyeM: 1.6, targetM: 2.4, seenP: 0.5, everyM: 100 },
  rooftops: { heightClassMin: 2, densityMin: 3, radiusM: 60 },
  bua: { classes: [3], densityMin: 4, villageRadiusM: 500, placeKinds: ['city', 'district_hq', 'town', 'village_imp', 'village'] },
  sensitive: { radiusM: 150, kinds: ['mosque', 'eidgah', 'school', 'hospital', 'bhu', 'dispensary', 'tomb', 'temple', 'church', 'market', 'bus_stand', 'graveyard_pt', 'rail_station', 'stadium'] },
  natural: { floodClasses: { 5: 'Seasonal water / flood zone', 17: 'Dry riverbed / nullah (flash floods)', 46: 'Perennial stream', 45: 'Ford' }, roadRadiusM: 40 },
  exposure: { threatKm: 5, threatEyeM: 3, everyM: 150, borderNearKm: 5, borderFarKm: 20, borderKinds: [] },
  picket: { rangeM: 600, searchM: 800, menPer: 30, eyeM: 1.6, postEyeM: 3, targetM: 2.4, seenP: 0.5, flatOffsetM: 150, flatEveryM: 400, gapM: 200, minCoverM: 300, roofEyeM: 8, roofOffsetM: 25, roofEveryM: 200, candidateKinds: ['peak', 'hill', 'knoll', 'trig_station', 'spot_height', 'plateau', 'watch_tower', 'post', 'fort'], maxCandidates: 400 },
  checkPost: { menPer: 10, bypassM: 200, max: 8 },
  cordon: { menPer100m: 15, rooftopPer100m: 5, perSideRoad: 3, sectionMen: 10, roadBlockMen: 10, outerRingM: 500, standoffM: 50, urbanShare: 0.3, searchKm: 3, fallbackRadiusM: 300, crossingMergeM: 60, escapeClasses: [17, 47, 46, 1, 31] },
  hides: { radiusKm: 3, kinds: ['cave', 'deserted_site', 'forest_name', 'broken_ground', 'stony_waste', 'mine', 'mine_shaft', 'quarry', 'camp'], max: 12 },
  casevac: { radiusKm: 40, hospitals: ['hospital', 'bhu', 'dispensary'], hls: ['helipad', 'airfield', 'air_base', 'landing_strip', 'landing_ground', 'airport'] },
  lane: { nightKmHills: 15, nightKmMax: 24, hillsReliefM: 300 },
};

// ── stations ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type SideState = 'go' | 'slow' | 'nogo' | 'unknown';

/** What one station reads for itself (cached per segment). */
export interface StationRead {
  x: number;
  y: number;
  elev: number;
  cls: number | null;
  onRoad: boolean;
  left: SideState;
  right: SideState;
  /** The class that blocks each side, when it is NO-GO. */
  leftWhy: number | null;
  rightWhy: number | null;
  /** Cover a man could fire from within the ambush band, per side: distance and class. */
  coverL: { distM: number; cls: number } | null;
  coverR: { distM: number; cls: number } | null;
  /** Highest ground above the road within the ambush band, per side (m). */
  riseL: number;
  riseR: number;
  bld: number;
  bua: boolean;
  rooftops: boolean;
  people: number | null;
  vp: { label: string; name: string | null; kind: string } | null;
  junction: boolean;
  sensitive: Array<{ label: string; name: string | null; distM: number; kind: string }>;
  natural: string | null;
  fairWeather: boolean;
  places: Array<{ name: string | null; kind: string; distM: number }>;
  reinforcementKm: number | null;
}

export interface Overlook {
  x: number;
  y: number;
  riseM: number;
  distM: number;
  side: 'L' | 'R';
  p: number;
}

export interface Station extends StationRead {
  i: number;
  chainM: number;
  bearing: number;
  turnDeg: number;
  crest: boolean;
  gradePct: number;
  overlook: Overlook | null;
  exposedP: number | null;
  border: { km: number; kind: string } | null;
}

export type HazardKind =
  | 'vp'
  | 'ambush'
  | 'mine'
  | 'block'
  | 'noExit'
  | 'overlooked'
  | 'rooftops'
  | 'bua'
  | 'sensitive'
  | 'natural'
  | 'exposed'
  | 'border'
  | 'slow';

export const HAZARD_LABEL: Record<HazardKind, string> = {
  vp: 'Vulnerable Pt',
  ambush: 'Likely Ambush Site',
  mine: 'Likely Mine / IED Spot',
  block: 'En can Block Rd',
  noExit: 'No Way off Rd',
  overlooked: 'Overlooked by High Gr',
  rooftops: 'Overlooked by Rooftops',
  bua: 'Through BUA',
  sensitive: 'Sensitive Site',
  natural: 'Natural Hazard',
  exposed: 'Threat may see Rd',
  border: 'Border within Reach',
  slow: 'Vehicles Slow',
};
/** Hazards a road-opening party can clear or picket (the clearance order lists only these). */
export const CLEARABLE: ReadonlySet<HazardKind> = new Set<HazardKind>(['vp', 'ambush', 'mine', 'block', 'noExit', 'overlooked', 'rooftops']);

export interface Hazard {
  kind: HazardKind;
  score: number;
  why: string;
}

export interface Stretch {
  kind: HazardKind;
  label: string;
  fromM: number;
  toM: number;
  score: number;
  why: string;
  /** The station of the highest score. */
  x: number;
  y: number;
  chainM: number;
  stations: number;
}

export interface RouteReading {
  lengthM: number;
  stationM: number;
  stations: Station[];
  stretches: Stretch[];
  counts: Partial<Record<HazardKind, number>>;
  buaM: number;
  offRoadM: number;
  /** People within 500 m of the route (WorldPop estimate, density times a 1 km corridor). */
  peopleNear: number | null;
  maxPerKm2: number | null;
  placesPassed: Array<{ name: string | null; kind: string; chainM: number }>;
  risk: 'low' | 'medium' | 'high';
  maxScore: number;
  /** Sight-based dangers (overlook, threat, border) were read. */
  sightDone: boolean;
  /** Some reads hit data still loading. */
  pending: boolean;
  /** The route was longer than `maxStations` stations allow; stations were spaced wider. */
  coarse: boolean;
}

export interface ScanOpts {
  going: GoingSets;
  /** Run the sight-based reads (overlooking ground, the threat's view). Leave off on the live path. */
  sight: boolean;
  /** Station spacing, metres; default `scan.stationM`. */
  stationM?: number;
  threat?: MercXY | null;
  borders?: Array<{ kind: string; xy: ArrayLike<number>; box: [number, number, number, number] }>;
}

// ── station reads ────────────────────────────────────────────────────────────────────────────────────────────────────

function sideState(c: number | null, g: GoingSets): SideState {
  if (c === null) return 'unknown';
  if (g.nogo.has(c)) return 'nogo';
  if (g.caution.has(c)) return 'slow';
  return 'go';
}

/** Kind sets built once per rules object. */
interface KindSets {
  road: Set<number>;
  vpKinds: Set<string>;
  junction: Set<string>;
  sensitive: Set<string>;
  places: Set<string>;
  reinforce: Set<string>;
  cover: Set<number>;
  bua: Set<number>;
  near: Set<string>;
}
const kindCache = new WeakMap<Rules, KindSets>();
function kindsOf(R: Rules): KindSets {
  let k = kindCache.get(R);
  if (k) return k;
  const vpKinds = new Set<string>(R.vp.kinds);
  const junction = new Set<string>(R.scan.junctionKinds);
  const sensitive = new Set<string>(R.sensitive.kinds);
  const places = new Set<string>(R.bua.placeKinds);
  const reinforce = new Set<string>(R.ambush.reinforcementKinds);
  k = {
    road: new Set<number>(R.scan.roadClasses),
    vpKinds,
    junction,
    sensitive,
    places,
    reinforce,
    cover: new Set<number>(R.ambush.coverClasses),
    bua: new Set<number>(R.bua.classes),
    near: new Set<string>([...vpKinds, ...junction, ...sensitive]),
  };
  kindCache.set(R, k);
  return k;
}

const FAIR_WORDS = /fair|jeep|kacha|unmetal|track/i;

/** One station's own reads: the ground under and beside it, what stands near it. */
export function readStation(x: number, y: number, bearing: number, probe: MovProbe, R: Rules, going: GoingSets): StationRead {
  const K = kindsOf(R);
  const cls = probe.cls(x, y);
  const elev = probe.elev(x, y);
  const onRoad = cls !== null && K.road.has(cls);
  // Each side: the first offset off the road itself decides whether a vehicle can leave it there.
  const side = (sign: number): { state: SideState; why: number | null; cover: { distM: number; cls: number } | null; rise: number } => {
    let state: SideState = 'unknown';
    let why: number | null = null;
    for (const d of R.scan.sideOffsetsM as number[]) {
      const [sx, sy] = offsetPt(x, y, bearing + 90 * sign, d);
      const c = probe.cls(sx, sy);
      if (c !== null && K.road.has(c) && d < 60) continue; // still the road or its bridge
      state = sideState(c, going);
      why = state === 'nogo' ? c : null;
      break;
    }
    let cover: { distM: number; cls: number } | null = null;
    let rise = 0;
    for (const d of [R.ambush.coverFromM, 60, 100, 150, 220, R.ambush.coverToM] as number[]) {
      if (d < R.ambush.coverFromM || d > R.ambush.coverToM) continue;
      const [sx, sy] = offsetPt(x, y, bearing + 90 * sign, d);
      const c = probe.cls(sx, sy);
      if (!cover && c !== null && K.cover.has(c)) cover = { distM: d, cls: c };
      const e = probe.elev(sx, sy);
      if (e === e && elev === elev) rise = Math.max(rise, e - elev);
    }
    return { state, why, cover, rise };
  };
  const L = side(-1);
  const Rr = side(1);

  const bld = probe.bld(x, y);
  const dens = bld & 7;
  // Rooftops: tall buildings, close together, at the road or within `radiusM` either side of it.
  const tall = (b: number) => b >> 6 >= R.rooftops.heightClassMin && (b & 7) >= R.rooftops.densityMin;
  let rooftops = tall(bld);
  for (const s of [-1, 1]) {
    if (rooftops) break;
    const [sx, sy] = offsetPt(x, y, bearing + 90 * s, R.rooftops.radiusM);
    rooftops = tall(probe.bld(sx, sy));
  }
  const bua = (cls !== null && K.bua.has(cls)) || dens >= R.bua.densityMin;

  // Points near the road: crossings, junctions, sensitive sites (one query, the widest radius).
  const nearR = Math.max(R.vp.radiusM, R.scan.junctionRadiusM, R.sensitive.radiusM);
  const near = probe.features(x, y, nearR, K.near);
  let vp: StationRead['vp'] = null;
  let junction = false;
  const sensitive: StationRead['sensitive'] = [];
  for (const f of near) {
    if (!vp && K.vpKinds.has(f.kind) && f.distM <= R.vp.radiusM) vp = { label: f.label, name: f.name, kind: f.kind };
    if (K.junction.has(f.kind) && f.distM <= R.scan.junctionRadiusM) junction = true;
    if (K.sensitive.has(f.kind) && f.distM <= R.sensitive.radiusM) sensitive.push({ label: f.label, name: f.name, distM: f.distM, kind: f.kind });
  }
  if (!vp && cls !== null) {
    const lab = (R.vp.classes as Record<string, string>)[String(cls)];
    if (lab) vp = { label: lab, name: null, kind: `class${cls}` };
  }
  // A cutting or a high embankment beside the road (it blocks a side) is a vulnerable point too.
  for (const c of [L.why, Rr.why]) {
    if (!vp && (c === 26 || c === 24)) vp = { label: (R.vp.classes as Record<string, string>)[String(c)] ?? 'Cutting', name: null, kind: `class${c}` };
  }
  // Two named roads meeting within the junction radius is a junction too.
  const roads = probe.roads(x, y, R.scan.junctionRadiusM);
  if (roads.length >= 2) junction = true;
  let fairWeather = false;
  let natural: string | null = null;
  for (const r of roads.slice(0, 2)) {
    if (r.attrs.aw === false) fairWeather = true;
  }
  const flood = cls !== null ? (R.natural.floodClasses as Record<string, string>)[String(cls)] : undefined;
  if (flood) natural = flood;
  if (!natural) {
    for (const l of probe.lines(x, y, R.natural.roadRadiusM, ROAD_LINE)) {
      const a = l.attrs;
      if (typeof a.sl === 'number' && a.sl > 0) natural = `Landslide sites on this Rd (${a.sl})`;
      else if (typeof a.x === 'string' && a.x.trim()) natural = `Closed ${a.x.trim()} (as recorded)`;
      else if (typeof a.cn === 'string' && FAIR_WORDS.test(a.cn)) fairWeather = true;
      if (natural) break;
    }
  }

  const pl = probe.features(x, y, R.bua.villageRadiusM, K.places);
  const places = pl.map((p) => ({ name: p.name, kind: p.kind, distM: p.distM }));
  let reinforcementKm: number | null = null;
  const rf = probe.features(x, y, R.ambush.reinforcementKm * 1000, K.reinforce);
  if (rf.length) reinforcementKm = Math.min(...rf.map((f) => f.distM)) / 1000;

  return {
    x,
    y,
    elev,
    cls,
    onRoad,
    left: L.state,
    right: Rr.state,
    leftWhy: L.why,
    rightWhy: Rr.why,
    coverL: L.cover,
    coverR: Rr.cover,
    riseL: L.rise,
    riseR: Rr.rise,
    bld,
    bua,
    rooftops,
    people: probe.people(x, y),
    vp,
    junction,
    sensitive: sensitive.sort((a, b) => a.distM - b.distM),
    natural,
    fairWeather,
    places,
    reinforcementKm,
  };
}
const ROAD_LINE: ReadonlySet<string> = new Set(['road']);

/** Points every `stepM` along a polyline, with chainage and the bearing of the leg each lies on. */
export function densify(path: MercXY[], stepM: number): Array<{ x: number; y: number; chainM: number; bearing: number; seg: number; t: number }> {
  const out: Array<{ x: number; y: number; chainM: number; bearing: number; seg: number; t: number }> = [];
  let chain = 0;
  for (let s = 0; s + 1 < path.length; s++) {
    const a = path[s];
    const b = path[s + 1];
    const L = groundDist(a, b);
    if (!(L > 0.5)) continue;
    const brg = bearingOf(a, b);
    const n = Math.max(1, Math.ceil(L / stepM));
    // The first point of a leg is the last of the leg before it (only the route's own start is taken at k = 0).
    for (let k = out.length ? 1 : 0; k <= n; k++) {
      const t = k / n;
      out.push({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, chainM: chain + L * t, bearing: brg, seg: s, t });
    }
    chain += L;
  }
  if (!out.length && path.length) out.push({ x: path[0][0], y: path[0][1], chainM: 0, bearing: 0, seg: 0, t: 0 });
  return out;
}

// ── route scan ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Scans routes, keeping each segment's station reads so a route drawn leg by leg only reads the leg that changed.
 * `tick` (the caller's data counter) invalidates reads that met data still loading.
 */
export class RouteScanner {
  private _segs = new Map<string, { reads: StationRead[]; tick: number; complete: boolean }>();
  private _sight = new Map<string, { o: Overlook | null; e: number | null; tick: number; complete: boolean }>();

  rules: Rules;
  // A plain field, not a parameter property: Node's type stripping runs this file and does not rewrite those.
  constructor(rules: Rules) {
    this.rules = rules;
  }

  clear(): void {
    this._segs.clear();
    this._sight.clear();
  }

  scan(path: MercXY[], probe: MovProbe, o: ScanOpts, tick = 0): RouteReading {
    const R = this.rules;
    let lengthM = 0;
    for (let i = 0; i + 1 < path.length; i++) lengthM += groundDist(path[i], path[i + 1]);
    let stepM = o.stationM ?? R.scan.stationM;
    let coarse = false;
    if (lengthM / stepM > R.scan.maxStations) {
      stepM = Math.ceil(lengthM / R.scan.maxStations);
      coarse = true;
    }
    const pts = densify(path, stepM);
    let pending = false;
    // Station reads per segment (a segment's key is its two ends and the step).
    const reads: StationRead[] = new Array(pts.length);
    const goingKey = `${[...o.going.nogo].join(',')}`;
    let segStart = 0;
    while (segStart < pts.length) {
      const s = pts[segStart].seg;
      let segEnd = segStart;
      while (segEnd + 1 < pts.length && pts[segEnd + 1].seg === s) segEnd++;
      const a = path[s];
      const b = path[s + 1] ?? path[s];
      const key = `${a[0].toFixed(1)}|${a[1].toFixed(1)}|${b[0].toFixed(1)}|${b[1].toFixed(1)}|${stepM}|${segStart === 0 ? 0 : 1}|${goingKey}`;
      const hit = this._segs.get(key);
      if (hit && hit.reads.length === segEnd - segStart + 1 && (hit.complete || hit.tick === tick)) {
        for (let k = 0; k < hit.reads.length; k++) reads[segStart + k] = hit.reads[k];
        if (!hit.complete) pending = true;
      } else {
        const list: StationRead[] = [];
        probe.takePending?.();
        for (let k = segStart; k <= segEnd; k++) {
          const r = readStation(pts[k].x, pts[k].y, pts[k].bearing, probe, R, o.going);
          list.push(r);
          reads[k] = r;
        }
        const complete = !(probe.takePending?.() ?? false);
        if (!complete) pending = true;
        this._segs.set(key, { reads: list, tick, complete });
        if (this._segs.size > 400) this._segs.delete(this._segs.keys().next().value as string);
      }
      segStart = segEnd + 1;
    }

    const stations: Station[] = reads.map((r, i) => ({
      ...r,
      i,
      chainM: pts[i].chainM,
      bearing: pts[i].bearing,
      turnDeg: 0,
      crest: false,
      gradePct: 0,
      overlook: null,
      exposedP: null,
      border: null,
    }));
    context(stations, stepM, R);
    if (o.sight) pending = this._sightReads(stations, stepM, probe, o, tick) || pending;

    const hz = stations.map((st) => hazardsAt(st, stations, stepM, R));
    const stretches = mergeStretches(stations, hz, stepM);
    const counts: Partial<Record<HazardKind, number>> = {};
    for (const s of stretches) counts[s.kind] = (counts[s.kind] ?? 0) + 1;
    let buaM = 0;
    let offRoadM = 0;
    let people = 0;
    let peopleKnown = false;
    let maxPer: number | null = null;
    const placesPassed: RouteReading['placesPassed'] = [];
    const seen = new Set<string>();
    for (const st of stations) {
      if (st.bua) buaM += stepM;
      if (st.cls !== null && !st.onRoad) offRoadM += stepM;
      if (st.people !== null) {
        peopleKnown = true;
        people += st.people * (stepM / 1000) * 1; // a 1 km wide corridor
        maxPer = maxPer === null ? st.people : Math.max(maxPer, st.people);
      }
      for (const p of st.places) {
        const k = `${p.kind}|${p.name}`;
        if (seen.has(k)) continue;
        seen.add(k);
        placesPassed.push({ name: p.name, kind: p.kind, chainM: st.chainM });
      }
    }
    const maxScore = stretches.reduce((m, s) => Math.max(m, s.score), 0);
    return {
      lengthM,
      stationM: stepM,
      stations,
      stretches,
      counts,
      buaM: Math.min(buaM, lengthM),
      offRoadM: Math.min(offRoadM, lengthM),
      peopleNear: peopleKnown ? Math.round(people) : null,
      maxPerKm2: maxPer,
      placesPassed,
      risk: maxScore >= 70 ? 'high' : maxScore >= 50 ? 'medium' : 'low',
      maxScore,
      sightDone: o.sight,
      pending,
      coarse,
    };
  }

  /** Overlooking ground, the threat's view and the border, every few stations; true when some read was not ready. */
  private _sightReads(stations: Station[], stepM: number, probe: MovProbe, o: ScanOpts, tick: number): boolean {
    const R = this.rules;
    const ov = R.overlook;
    const ex = R.exposure;
    let pending = false;
    const everyOv = Math.max(1, Math.round(ov.everyM / stepM));
    const everyEx = Math.max(1, Math.round(ex.everyM / stepM));
    const threat = o.threat ?? null;
    const tkey = threat ? `${threat[0].toFixed(0)}|${threat[1].toFixed(0)}` : '-';
    for (const st of stations) {
      const doOv = st.i % everyOv === 0;
      const doEx = threat && st.i % everyEx === 0;
      if (!doOv && !doEx) continue;
      const key = `${st.x.toFixed(1)}|${st.y.toFixed(1)}|${st.bearing.toFixed(0)}|${tkey}`;
      const hit = this._sight.get(key);
      if (hit && (hit.complete || hit.tick === tick)) {
        st.overlook = hit.o;
        st.exposedP = hit.e;
        if (!hit.complete) pending = true;
        continue;
      }
      let complete = true;
      probe.takePending?.();
      let best: Overlook | null = null;
      // The station's own height not read yet: nothing can be judged, so this is not a finished read.
      if (doOv && st.elev !== st.elev) complete = false;
      if (doOv && st.elev === st.elev) {
        for (const sign of [-1, 1]) {
          for (const d of ov.offsetsM as number[]) {
            for (const sk of ov.skewDeg as number[]) {
              const [px, py] = offsetPt(st.x, st.y, st.bearing + 90 * sign + sk * sign, d);
              const e = probe.elev(px, py);
              if (e !== e) {
                complete = false;
                continue;
              }
              const rise = e - st.elev;
              if (rise < ov.riseM || (best && rise <= best.riseM)) continue;
              const p = probe.sight(px, py, ov.eyeM, st.x, st.y, ov.targetM);
              if (p === null) {
                complete = false;
                continue;
              }
              if (p >= ov.seenP) best = { x: px, y: py, riseM: rise, distM: d, side: sign < 0 ? 'L' : 'R', p };
            }
          }
        }
      }
      let e: number | null = null;
      if (doEx && threat) {
        const dM = groundDist(threat, [st.x, st.y]);
        if (dM <= ex.threatKm * 1000) {
          e = probe.sight(threat[0], threat[1], ex.threatEyeM, st.x, st.y, ov.targetM);
          if (e === null) complete = false;
        }
      }
      if (probe.takePending?.()) complete = false;
      if (!complete) pending = true;
      st.overlook = best;
      st.exposedP = e;
      this._sight.set(key, { o: best, e, tick, complete });
      if (this._sight.size > 6000) this._sight.delete(this._sight.keys().next().value as string);
    }
    // Spread the sparse reads to the stations between, so stretches join up.
    let lastOv: Overlook | null = null;
    let lastOvAt = -1e9;
    let lastEx: number | null = null;
    let lastExAt = -1e9;
    for (const st of stations) {
      if (st.i % everyOv === 0) {
        lastOv = st.overlook;
        lastOvAt = st.i;
      } else if (st.i - lastOvAt < everyOv) st.overlook = lastOv;
      if (threat) {
        if (st.i % everyEx === 0) {
          lastEx = st.exposedP;
          lastExAt = st.i;
        } else if (st.i - lastExAt < everyEx) st.exposedP = lastEx;
      }
    }
    if (o.borders && o.borders.length) {
      const farM = ex.borderFarKm * 1000;
      const every = Math.max(1, Math.round(1000 / stepM));
      let last: Station['border'] = null;
      for (const st of stations) {
        if (st.i % every !== 0) {
          st.border = last;
          continue;
        }
        let best: Station['border'] = null;
        const s = scaleAt(st.y);
        const pad = farM / s;
        for (const b of o.borders) {
          if (st.x < b.box[0] - pad || st.x > b.box[2] + pad || st.y < b.box[1] - pad || st.y > b.box[3] + pad) continue;
          const d = distToLine([st.x, st.y], b.xy);
          if (d <= farM && (!best || d / 1000 < best.km)) best = { km: d / 1000, kind: b.kind };
        }
        st.border = best;
        last = best;
      }
    }
    return pending;
  }
}

/** Turns, crests and gradients: read from the stations around each one. */
function context(st: Station[], stepM: number, R: Rules): void {
  const wB = Math.max(1, Math.round(R.scan.bendWindowM / stepM));
  const wC = Math.max(1, Math.round(R.scan.crestWindowM / stepM));
  const wG = Math.max(1, Math.round(R.scan.gradientWindowM / stepM));
  for (let i = 0; i < st.length; i++) {
    const a = st[Math.max(0, i - wB)];
    const b = st[i];
    const c = st[Math.min(st.length - 1, i + wB)];
    if (a !== b && c !== b) {
      const b1 = bearingOf([a.x, a.y], [b.x, b.y]);
      const b2 = bearingOf([b.x, b.y], [c.x, c.y]);
      b.turnDeg = angDiff(b1, b2);
    }
    const e = b.elev;
    if (e === e && i - wC >= 0 && i + wC < st.length) {
      let isTop = true;
      let dropA = 0;
      let dropB = 0;
      for (let k = 1; k <= wC; k++) {
        const ea = st[i - k].elev;
        const eb = st[i + k].elev;
        if (ea !== ea || eb !== eb || ea > e || eb > e) {
          isTop = false;
          break;
        }
        dropA = Math.max(dropA, e - ea);
        dropB = Math.max(dropB, e - eb);
      }
      b.crest = isTop && dropA >= R.scan.crestRiseM && dropB >= R.scan.crestRiseM;
    }
    const g0 = st[Math.max(0, i - wG)];
    const g1 = st[Math.min(st.length - 1, i + wG)];
    const run = g1.chainM - g0.chainM;
    if (run > 0 && g0.elev === g0.elev && g1.elev === g1.elev) b.gradePct = (100 * Math.abs(g1.elev - g0.elev)) / run;
  }
}

function sideWords(st: StationRead, label: (c: number) => string): string {
  const w: string[] = [];
  if (st.left === 'nogo' && st.leftWhy !== null) w.push(`${label(st.leftWhy)} L`);
  if (st.right === 'nogo' && st.rightWhy !== null) w.push(`${label(st.rightWhy)} R`);
  return w.join(', ');
}
/** Short class words for the reasons (the engine has no rules.json; the caller can replace this). */
export const CLASS_WORD: Record<number, string> = {
  1: 'Trees', 3: 'BUA', 4: 'Water', 5: 'Flood zone', 6: 'Marsh', 9: 'Steep slope', 10: 'Slope', 11: 'Restricted area', 14: 'Dunes', 15: 'Rocky Gr', 17: 'Nullah',
  20: 'Canal', 21: 'Minor canal', 22: 'Drain', 23: 'Watercourses', 24: 'Embankment', 25: 'Bund', 26: 'Cutting', 27: 'Cliff', 28: 'Railway', 29: 'Walled orchard',
  30: 'Orchard', 31: 'Forest', 32: 'Graveyard', 43: 'Rly bridge', 44: 'Foot bridge', 46: 'Stream', 47: 'Dry nullah', 49: 'Wall / fence',
};
function word(c: number): string {
  return CLASS_WORD[c] ?? `Class ${c}`;
}

/** The dangers at one station, each with a score 0-100 and its reason. */
export function hazardsAt(st: Station, all: Station[], stepM: number, R: Rules): Hazard[] {
  const out: Hazard[] = [];
  const noExit = st.left === 'nogo' && st.right === 'nogo';
  const oneSide = st.left === 'nogo' || st.right === 'nogo';
  const near = (m: number, f: (s: Station) => boolean): boolean => {
    const w = Math.max(1, Math.round(m / stepM));
    for (let k = Math.max(0, st.i - w); k <= Math.min(all.length - 1, st.i + w); k++) if (f(all[k])) return true;
    return false;
  };
  const bend = st.turnDeg >= R.scan.bendDeg;

  if (st.vp) {
    const k = st.vp.kind;
    const score = k === 'tunnel' ? 80 : /bridge|viaduct|class39|class4[0-3]/.test(k) ? 70 : k === 'culvert' ? 55 : /ford|ferry|class45/.test(k) ? 60 : k === 'class26' ? 65 : 50;
    out.push({ kind: 'vp', score, why: st.vp.name ? `${st.vp.label} (${st.vp.name})` : st.vp.label });
  }
  if (noExit) out.push({ kind: 'noExit', score: 60, why: `No way off the Rd: ${sideWords(st, word)}` });

  // Ambush: the vehicle cannot leave the road, a man can fire from cover beside it.
  const coverSide = st.coverL || st.coverR;
  const rise = Math.max(st.riseL, st.riseR);
  if ((noExit || oneSide) && (coverSide || rise >= R.ambush.riseM)) {
    let s = noExit ? 35 : 20;
    const why: string[] = [noExit ? 'Cannot leave the Rd' : `Cannot leave the Rd ${st.left === 'nogo' ? 'L' : 'R'}`];
    if (coverSide) {
      s += 20;
      why.push(`cover ${coverSide.distM} m (${word(coverSide.cls)})`);
    }
    if (rise >= R.ambush.riseM) {
      s += 15;
      why.push(`Gr ${Math.round(rise)} m above`);
    }
    if (near(200, (x) => x.turnDeg >= R.scan.bendDeg || x.crest)) {
      s += 15;
      why.push('bend / crest hides it from the vehicles behind');
    }
    const village = st.places.some((p) => p.distM <= R.ambush.villageKm * 1000);
    if (!village) s += 10;
    if (st.reinforcementKm === null) {
      s += 5;
      why.push(`no post within ${R.ambush.reinforcementKm} km`);
    }
    if (s >= R.ambush.minScore) out.push({ kind: 'ambush', score: Math.min(100, s), why: why.join(', ') });
  }

  // Likely mine / IED: crossroads, turning places, places where vehicles slow.
  {
    let s = 0;
    const why: string[] = [];
    if (st.junction) {
      s += 40;
      why.push('junction');
    }
    if (st.vp?.kind === 'culvert') {
      s += 30;
      why.push('culvert');
    } else if (st.vp && /bridge|class39|class4[0-2]/.test(st.vp.kind)) {
      s += 20;
      why.push('bridge approach');
    }
    if (bend) {
      s += 25;
      why.push(`bend ${Math.round(st.turnDeg)}°`);
    }
    if (st.cls === 50) {
      s += 25;
      why.push('level crossing');
    }
    if (st.gradePct >= R.scan.gradientPct) {
      s += 15;
      why.push(`climb ${Math.round(st.gradePct)} %`);
    }
    if (st.bua) {
      s += 10;
      why.push('BUA');
    }
    if (s >= R.mine.minScore) out.push({ kind: 'mine', score: Math.min(100, s), why: `Vehicles slow: ${why.join(', ')}` });
  }

  // The enemy can block it: round a bend or over a crest, no bypass.
  if ((bend || st.crest) && near(R.block.bypassM, (x) => x.left === 'nogo' && x.right === 'nogo')) {
    out.push({ kind: 'block', score: 65, why: `${bend ? 'Round a bend' : 'Over a crest'}, no bypass` });
  }

  if (st.overlook) {
    const o = st.overlook;
    out.push({ kind: 'overlooked', score: Math.min(80, 40 + Math.round(o.riseM / 2)), why: `Gr ${Math.round(o.riseM)} m above, ${o.distM} m ${o.side}, may see the Rd` });
  }
  if (st.rooftops) out.push({ kind: 'rooftops', score: 45, why: 'Buildings beside the Rd' });
  if (st.bua) {
    const p = st.places[0];
    out.push({ kind: 'bua', score: Math.min(60, 30 + 5 * (st.bld & 7)), why: p?.name ? `BUA (${p.name})` : 'BUA' });
  }
  if (st.sensitive.length) {
    const s = st.sensitive[0];
    out.push({ kind: 'sensitive', score: 30, why: `${s.label}${s.name ? ` (${s.name})` : ''} ${Math.round(s.distM)} m` });
  }
  if (st.natural) out.push({ kind: 'natural', score: /slide/i.test(st.natural) ? 55 : 40, why: st.natural });
  else if (st.fairWeather) out.push({ kind: 'natural', score: 25, why: 'Fair-weather Rd: mud after rain' });
  if (st.exposedP !== null && st.exposedP >= 0.5) out.push({ kind: 'exposed', score: 70, why: `Threat may see the Rd (${Math.round(st.exposedP * 100)} %)` });
  if (st.border) {
    const near5 = st.border.km <= R.exposure.borderNearKm;
    out.push({ kind: 'border', score: near5 ? 60 : 35, why: `${st.border.kind} ${st.border.km.toFixed(1)} km` });
  }
  if (st.gradePct >= R.scan.gradientPct && !out.some((h) => h.kind === 'mine')) out.push({ kind: 'slow', score: 25, why: `Climb ${Math.round(st.gradePct)} %` });
  return out;
}

function mergeStretches(st: Station[], hz: Hazard[][], stepM: number): Stretch[] {
  const open = new Map<HazardKind, Stretch & { last: number }>();
  const out: Stretch[] = [];
  const close = (k: HazardKind) => {
    const s = open.get(k);
    if (!s) return;
    open.delete(k);
    const { last, ...rest } = s;
    void last;
    out.push(rest);
  };
  for (let i = 0; i < st.length; i++) {
    const here = new Set<HazardKind>();
    for (const h of hz[i]) {
      here.add(h.kind);
      const s = open.get(h.kind);
      if (s && i - s.last <= 2) {
        s.toM = st[i].chainM;
        s.last = i;
        s.stations++;
        if (h.score > s.score) {
          s.score = h.score;
          s.why = h.why;
          s.x = st[i].x;
          s.y = st[i].y;
          s.chainM = st[i].chainM;
        }
      } else {
        if (s) close(h.kind);
        open.set(h.kind, { kind: h.kind, label: HAZARD_LABEL[h.kind], fromM: st[i].chainM, toM: st[i].chainM, score: h.score, why: h.why, x: st[i].x, y: st[i].y, chainM: st[i].chainM, stations: 1, last: i });
      }
    }
    for (const [k, s] of [...open]) if (!here.has(k) && i - s.last > 2) close(k);
  }
  for (const k of [...open.keys()]) close(k);
  // A point danger still spans half a station either side.
  for (const s of out) {
    s.fromM = Math.max(0, s.fromM - stepM / 2);
    s.toM = s.toM + stepM / 2;
  }
  return out.sort((a, b) => a.fromM - b.fromM || b.score - a.score);
}

// ── route protection ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface Picket {
  x: number;
  y: number;
  side: 'L' | 'R';
  chainM: number;
  offsetM: number;
  riseM: number;
  eyeM: number;
  source: 'high' | 'feature' | 'post' | 'rooftop';
  name: string | null;
  coversFromM: number;
  coversToM: number;
  covered: number;
}
export interface PicketPlan {
  mode: 'bothSides' | 'fewest';
  pickets: Picket[];
  men: number;
  coveragePct: number;
  gaps: Array<{ fromM: number; toM: number }>;
  rangeM: number;
  pending: boolean;
}

interface Cand {
  x: number;
  y: number;
  side: 'L' | 'R';
  near: number;
  offsetM: number;
  riseM: number;
  eyeM: number;
  source: Picket['source'];
  name: string | null;
  cov: number[];
}

/**
 * Piquets that dominate the road. `bothSides` (route picketing plan): each side is covered on its own, spaced so
 * fire covers the ground between; `fewest` (piqueting): the fewest posts that between them see the whole road.
 * Greedy set cover over candidates: ground that overlooks the road, named heights near it, and posts on flat ground.
 */
export function planPickets(r: RouteReading, probe: MovProbe, R: Rules, mode: 'bothSides' | 'fewest', foot: GoingSets): PicketPlan {
  const P = R.picket;
  const st = r.stations;
  const every = Math.max(1, Math.round(100 / r.stationM));
  const idx = st.filter((s) => s.i % every === 0 || s.i === st.length - 1);
  // "Still loading" comes from the probe; a read that is unknown for good (no data there) is just skipped.
  probe.takePending?.();
  const cands: Cand[] = [];
  const nearestStation = (x: number, y: number): { s: Station; d: number; side: 'L' | 'R' } => {
    let best = idx[0];
    let bd = Infinity;
    for (const s of idx) {
      const d = groundDist([x, y], [s.x, s.y]);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    const rel = ((bearingOf([best.x, best.y], [x, y]) - best.bearing + 360) % 360);
    return { s: best, d: bd, side: rel > 180 ? 'L' : 'R' };
  };
  const push = (x: number, y: number, source: Picket['source'], eyeM: number, name: string | null) => {
    if (cands.length >= P.maxCandidates) return;
    const c = probe.cls(x, y);
    if (c === null) return;
    if (foot.nogo.has(c)) return; // in a canal, a river, a cliff
    const e = probe.elev(x, y);
    if (e !== e) return;
    const n = nearestStation(x, y);
    if (n.d > P.searchM) return;
    for (const q of cands) if (groundDist([q.x, q.y], [x, y]) < 60) return;
    cands.push({ x, y, side: n.side, near: n.s.i, offsetM: Math.round(n.d), riseM: e - (n.s.elev === n.s.elev ? n.s.elev : e), eyeM, source, name, cov: [] });
  };
  for (const s of st) if (s.overlook) push(s.overlook.x, s.overlook.y, 'high', P.eyeM, null);
  const kinds = new Set<string>(P.candidateKinds);
  const stepQ = Math.max(1, Math.round(500 / r.stationM));
  for (let i = 0; i < st.length; i += stepQ) {
    for (const f of probe.features(st[i].x, st[i].y, P.searchM, kinds)) push(f.x, f.y, 'feature', /tower|post|fort/.test(f.kind) ? P.postEyeM : P.eyeM, f.name ?? f.label);
  }
  const stepF = Math.max(1, Math.round(P.flatEveryM / r.stationM));
  for (let i = 0; i < st.length; i += stepF) {
    for (const sign of [-1, 1]) {
      const [x, y] = offsetPt(st[i].x, st[i].y, st[i].bearing + 90 * sign, P.flatOffsetM);
      push(x, y, 'post', P.postEyeM, null);
    }
  }
  // In a built-up stretch a post on the ground sees one street: a rooftop beside the road sees along it.
  const stepB = Math.max(1, Math.round(P.roofEveryM / r.stationM));
  for (let i = 0; i < st.length; i += stepB) {
    if (!st[i].bua && !st[i].rooftops) continue;
    for (const sign of [-1, 1]) {
      const [x, y] = offsetPt(st[i].x, st[i].y, st[i].bearing + 90 * sign, P.roofOffsetM);
      push(x, y, 'rooftop', P.roofEyeM, null);
    }
  }
  // What each candidate sees of the road within range.
  for (const c of cands) {
    for (const s of idx) {
      if (Math.abs(s.i - c.near) * r.stationM > P.rangeM * 1.6) continue;
      if (groundDist([c.x, c.y], [s.x, s.y]) > P.rangeM) continue;
      const p = probe.sight(c.x, c.y, c.eyeM, s.x, s.y, P.targetM);
      if (p !== null && p >= P.seenP) c.cov.push(s.i);
    }
  }
  const pending = probe.takePending?.() ?? false;
  const chosen: Cand[] = [];
  const minGain = Math.max(2, Math.round(P.minCoverM / Math.max(1, every * r.stationM)));
  // Among equal gains: ground that already showed it overlooks the road, then the higher.
  const pref = (c: Cand) => (c.source === 'high' ? 1 : 0) + c.riseM / 100;
  const pick = (pool: Cand[]) => {
    const need = new Set(idx.map((s) => s.i));
    for (;;) {
      let best: Cand | null = null;
      let gain = 0;
      for (const c of pool) {
        if (chosen.includes(c)) continue;
        let g = 0;
        for (const i of c.cov) if (need.has(i)) g++;
        if (g > gain || (g === gain && g > 0 && best && pref(c) > pref(best))) {
          best = c;
          gain = g;
        }
      }
      // A platoon is not spent on a post that sees less than `minCoverM` of the road: that is a gap for patrols.
      if (!best || gain < minGain) break;
      chosen.push(best);
      for (const i of best.cov) need.delete(i);
      if (!need.size) break;
    }
  };
  if (mode === 'bothSides') {
    pick(cands.filter((c) => c.side === 'L'));
    pick(cands.filter((c) => c.side === 'R'));
  } else pick(cands);

  const covered = new Set<number>();
  for (const c of chosen) for (const i of c.cov) covered.add(i);
  const gaps: PicketPlan['gaps'] = [];
  let g0: number | null = null;
  for (const s of idx) {
    if (!covered.has(s.i)) {
      if (g0 === null) g0 = s.chainM;
    } else if (g0 !== null) {
      if (s.chainM - g0 >= P.gapM) gaps.push({ fromM: g0, toM: s.chainM });
      g0 = null;
    }
  }
  if (g0 !== null && r.lengthM - g0 >= P.gapM) gaps.push({ fromM: g0, toM: r.lengthM });
  const pickets: Picket[] = chosen
    .map((c) => {
      const ch = c.cov.map((i) => st[i].chainM);
      return {
        x: c.x,
        y: c.y,
        side: c.side,
        chainM: st[c.near].chainM,
        offsetM: c.offsetM,
        riseM: Math.round(c.riseM),
        eyeM: c.eyeM,
        source: c.source,
        name: c.name,
        coversFromM: ch.length ? Math.min(...ch) : st[c.near].chainM,
        coversToM: ch.length ? Math.max(...ch) : st[c.near].chainM,
        covered: c.cov.length,
      };
    })
    .sort((a, b) => a.chainM - b.chainM);
  return {
    mode,
    pickets,
    men: pickets.length * P.menPer,
    coveragePct: idx.length ? Math.round((100 * covered.size) / idx.length) : 0,
    gaps,
    rangeM: P.rangeM,
    pending,
  };
}

export interface CheckPost {
  x: number;
  y: number;
  chainM: number;
  why: string;
  men: number;
}
/** Junctions (and bridges) on the route that cannot be bypassed: NO-GO both sides of the road close by. */
export function checkPosts(r: RouteReading, R: Rules): CheckPost[] {
  const C = R.checkPost;
  const st = r.stations;
  const w = Math.max(1, Math.round(C.bypassM / r.stationM));
  const out: CheckPost[] = [];
  for (const s of st) {
    const isBridge = !!s.vp && /bridge|class39|class4[0-2]/.test(s.vp.kind);
    if (!s.junction && !isBridge) continue;
    let blocked = 0;
    for (let k = Math.max(0, s.i - w); k <= Math.min(st.length - 1, s.i + w); k++) if (st[k].left === 'nogo' && st[k].right === 'nogo') blocked++;
    if (!blocked && !isBridge) continue;
    if (out.some((o) => Math.abs(o.chainM - s.chainM) < C.bypassM * 2)) continue;
    out.push({ x: s.x, y: s.y, chainM: s.chainM, why: isBridge ? `Bridge${s.vp?.name ? ` (${s.vp.name})` : ''}: the only crossing here` : 'Junction with NO-GO flanks: cannot be bypassed', men: C.menPer });
    if (out.length >= C.max) break;
  }
  return out;
}

/** Stretches a road-opening party clears first: the clearable dangers, worst first. */
export function clearanceOrder(r: RouteReading, max = 10): Stretch[] {
  return r.stretches
    .filter((s) => CLEARABLE.has(s.kind) && s.score >= 50)
    .sort((a, b) => b.score - a.score || a.fromM - b.fromM)
    .slice(0, max);
}

export interface Casevac {
  at: MercXY;
  hospital: NearFeature | null;
  hls: NearFeature | null;
}
/** The nearest hospital and landing site (straight line) from each point. */
export function casevacFor(points: MercXY[], probe: MovProbe, R: Rules): Casevac[] {
  const C = R.casevac;
  const H = new Set<string>(C.hospitals);
  const L = new Set<string>(C.hls);
  return points.map((p) => {
    const h = probe.features(p[0], p[1], C.radiusKm * 1000, H);
    const l = probe.features(p[0], p[1], C.radiusKm * 1000, L);
    const first = (a: NearFeature[]) => (a.length ? a.reduce((m, f) => (f.distM < m.distM ? f : m)) : null);
    return { at: p, hospital: first(h), hls: first(l) };
  });
}

// ── cordon ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CordonReading {
  ring: MercXY[];
  outer: MercXY[];
  derived: 'drawn' | 'bua' | 'circle';
  perimeterM: number;
  areaKm2: number;
  urban: boolean;
  buaSharePct: number;
  rooftopM: number;
  sideRoads: MercXY[];
  exits: MercXY[];
  escapes: Array<{ x: number; y: number; why: string }>;
  inner: { men: number; perimeterMen: number; rooftopMen: number; sideRoadMen: number; sections: number };
  outerCordon: { roadBlocks: number; men: number };
  totalMen: number;
  people: number | null;
  sensitive: NearFeature[];
  hides: NearFeature[];
  pending: boolean;
}

/** The built-up area at (or within 300 m of) a point, as a ring with a stand-off; null when there is none. */
export function buaRingAround(at: MercXY, probe: MovProbe, R: Rules): { ring: MercXY[]; pending: boolean } | null {
  const C = R.cordon;
  const res = Math.max(10, probe.resM);
  const s = scaleAt(at[1]);
  const stepMerc = res / s;
  const K = kindsOf(R);
  probe.takePending?.();
  // Built-up: the land-cover class, or buildings dense enough to be a town (density class 5: about 2,000 a km²).
  // Scattered farm houses (classes 3-4) are not: in the Punjab they join every village into one spread.
  const built = (x: number, y: number): boolean => {
    const c = probe.cls(x, y);
    if (c !== null && K.bua.has(c)) return true;
    const b = probe.bld(x, y);
    return (b & 7) >= 5;
  };
  // Nearest built-up cell within 300 m.
  let seed: [number, number] | null = null;
  const maxR = Math.ceil(300 / res);
  outer: for (let r = 0; r <= maxR; r++) {
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (built(at[0] + dx * stepMerc, at[1] + dy * stepMerc)) {
          seed = [dx, dy];
          break outer;
        }
      }
  }
  if (!seed) return probe.takePending?.() ? { ring: [], pending: true } : null;
  const lim = Math.ceil((C.searchKm * 1000) / res);
  const seen = new Set<string>();
  const q: Array<[number, number]> = [seed];
  seen.add(`${seed[0]}|${seed[1]}`);
  const pts: MercXY[] = [];
  // 8-connected, plus a straight jump of two cells so a street or a one-cell gap does not split a town (a wider
  // jump joins neighbouring villages into one).
  const nb: Array<[number, number]> = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1], [-2, 0], [2, 0], [0, -2], [0, 2]];
  while (q.length && pts.length < 60000) {
    const [cx, cy] = q.pop()!;
    pts.push([at[0] + cx * stepMerc, at[1] + cy * stepMerc]);
    for (const [dx, dy] of nb) {
      const nx = cx + dx, ny = cy + dy;
      if (Math.abs(nx) > lim || Math.abs(ny) > lim) continue;
      const k = `${nx}|${ny}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (built(at[0] + nx * stepMerc, at[1] + ny * stepMerc)) q.push([nx, ny]);
    }
  }
  if (pts.length < 3) return probe.takePending?.() ? { ring: [], pending: true } : null;
  const hull = convexHull(pts);
  return { ring: growRing(hull, C.standoffM + res / 2), pending: probe.takePending?.() ?? false };
}

export function circleRing(at: MercXY, radiusM: number, n = 36): MercXY[] {
  const out: MercXY[] = [];
  for (let i = 0; i < n; i++) out.push(offsetPt(at[0], at[1], (i * 360) / n, radiusM));
  return out;
}

/** Where lines cross a ring, merged within `mergeM`. */
function crossings(ring: MercXY[], lines: NearLine[], mergeM: number): MercXY[] {
  const out: MercXY[] = [];
  for (const l of lines) {
    const xy = l.xy;
    for (let i = 0; i + 3 < xy.length; i += 2) {
      const a: MercXY = [xy[i], xy[i + 1]];
      const b: MercXY = [xy[i + 2], xy[i + 3]];
      for (let k = 0; k < ring.length; k++) {
        const p = segCross(a, b, ring[k], ring[(k + 1) % ring.length]);
        if (p && !out.some((q) => groundDist(p, q) < mergeM)) out.push(p);
      }
    }
  }
  return out;
}

/**
 * Troops for a cordon round `ring` (rules: 15 men per 100 m facing inward, +5 per 100 m where there are rooftops,
 * +2-3 per side road; road blocks on every exit; in the country, sections on the escape routes only).
 */
export function cordonPlan(ring: MercXY[], derived: CordonReading['derived'], probe: MovProbe, R: Rules): CordonReading {
  const C = R.cordon;
  const K = kindsOf(R);
  probe.takePending?.();
  const perimeterM = ringLength(ring);
  const areaKm2 = ringAreaKm2(ring);
  const c = centroidOf(ring);
  let reach = 0;
  for (const p of ring) reach = Math.max(reach, groundDist(c, p));

  // Walk the ring every 25 m: rooftops, built-up share, escape ground.
  const step = 25;
  let samples = 0;
  let roof = 0;
  let builtN = 0;
  const escapes: CordonReading['escapes'] = [];
  const esc = new Set<number>(C.escapeClasses);
  let inEsc = false;
  // The cordon line stands off the houses, so the built-up share and the rooftops are read just inside it (where
  // the outer houses are); the escape ground is read on the line itself.
  const inward = C.standoffM + 25;
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k];
    const b = ring[(k + 1) % ring.length];
    const L = groundDist(a, b);
    const n = Math.max(1, Math.round(L / step));
    for (let j = 0; j < n; j++) {
      const x = a[0] + ((b[0] - a[0]) * j) / n;
      const y = a[1] + ((b[1] - a[1]) * j) / n;
      samples++;
      const dc = groundDist([x, y], c);
      const [ix, iy] = dc > inward ? offsetPt(x, y, bearingOf([x, y], c), inward) : c;
      const ci = probe.cls(ix, iy);
      const bv = probe.bld(ix, iy);
      const isBuilt = (ci !== null && K.bua.has(ci)) || (bv & 7) >= 3;
      if (isBuilt) builtN++;
      if (isBuilt && (bv >> 6 >= 1 || (bv & 7) >= 3)) roof++;
      const cl = probe.cls(x, y);
      const e = cl !== null && esc.has(cl);
      if (e && !inEsc) escapes.push({ x, y, why: word(cl!) });
      inEsc = e;
    }
  }
  const buaShare = samples ? builtN / samples : 0;
  const urban = buaShare >= C.urbanShare;
  const rooftopM = samples ? (roof / samples) * perimeterM : 0;

  const roadKinds = new Set(['road']);
  const lines = probe.lines(c[0], c[1], reach + C.outerRingM + 200, roadKinds);
  const sideRoads = crossings(ring, lines, C.crossingMergeM);
  const outer = growRing(convexHull(ring), C.outerRingM);
  const exits = crossings(outer, lines, C.crossingMergeM);
  for (const p of sideRoads) escapes.push({ x: p[0], y: p[1], why: 'Rd / Tr' });

  let perimeterMen = 0, rooftopMen = 0, sideRoadMen = 0, sections = 0;
  if (urban) {
    perimeterMen = Math.ceil((perimeterM / 100) * C.menPer100m);
    rooftopMen = Math.ceil((rooftopM / 100) * C.rooftopPer100m);
    sideRoadMen = sideRoads.length * C.perSideRoad;
  } else {
    sections = escapes.length;
  }
  const innerMen = urban ? perimeterMen + rooftopMen + sideRoadMen : sections * C.sectionMen;
  const roadBlocks = exits.length;
  const outerMen = roadBlocks * C.roadBlockMen;

  // People inside: the density grid sampled every 100 m (coarser for a big area).
  let people: number | null = null;
  {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const p of ring) {
      minx = Math.min(minx, p[0]);
      miny = Math.min(miny, p[1]);
      maxx = Math.max(maxx, p[0]);
      maxy = Math.max(maxy, p[1]);
    }
    const s = scaleAt(c[1]);
    let cell = 100;
    while ((((maxx - minx) * s) / cell) * (((maxy - miny) * s) / cell) > 40000) cell *= 2;
    const stepM = cell / s;
    let sum = 0;
    let known = false;
    for (let x = minx + stepM / 2; x < maxx; x += stepM)
      for (let y = miny + stepM / 2; y < maxy; y += stepM) {
        if (!pointInRing([x, y], ring)) continue;
        const d = probe.people(x, y);
        if (d === null) continue;
        known = true;
        sum += d * (cell / 1000) ** 2;
      }
    people = known ? Math.round(sum) : null;
  }
  const sensitive = probe
    .features(c[0], c[1], reach + 200, K.sensitive)
    .filter((f) => pointInRing([f.x, f.y], ring) || distToRing([f.x, f.y], ring) <= 200)
    .sort((a, b) => a.distM - b.distM);
  const hides = probe
    .features(c[0], c[1], R.hides.radiusKm * 1000 + reach, new Set<string>(R.hides.kinds))
    .sort((a, b) => a.distM - b.distM)
    .slice(0, R.hides.max);
  const pending = probe.takePending?.() ?? false;
  return {
    ring,
    outer,
    derived,
    perimeterM,
    areaKm2,
    urban,
    buaSharePct: Math.round(buaShare * 100),
    rooftopM,
    sideRoads,
    exits,
    escapes: urban ? [] : escapes,
    inner: { men: innerMen, perimeterMen, rooftopMen, sideRoadMen, sections },
    outerCordon: { roadBlocks, men: outerMen },
    totalMen: innerMen + outerMen,
    people,
    sensitive,
    hides,
    pending,
  };
}
function distToRing(p: MercXY, ring: MercXY[]): number {
  const xy: number[] = [];
  for (const q of ring) xy.push(q[0], q[1]);
  xy.push(ring[0][0], ring[0][1]);
  return distToLine(p, xy);
}

// ── infiltration lane ────────────────────────────────────────────────────────────────────────────────────────────────

export interface LaneReading {
  lengthKm: number;
  hills: boolean;
  limitKm: number;
  withinNight: boolean;
  offRoadPct: number;
  obstacles: Array<{ chainM: number; why: string; x: number; y: number }>;
  villages: Array<{ name: string | null; chainM: number }>;
  skylineM: number;
  seenPct: number | null;
  reliefM: number;
}
/** An infiltration lane (read with the foot mover): one night's march, off roads, obstacles, villages, skylines, the threat's view. */
export function laneCheck(r: RouteReading, R: Rules, foot: GoingSets): LaneReading {
  const L = R.lane;
  let lo = Infinity, hi = -Infinity;
  let onRoad = 0;
  let sky = 0;
  let seen = 0;
  let seenN = 0;
  const obstacles: LaneReading['obstacles'] = [];
  let inObs = false;
  for (const s of r.stations) {
    if (s.elev === s.elev) {
      lo = Math.min(lo, s.elev);
      hi = Math.max(hi, s.elev);
    }
    if (s.onRoad) onRoad++;
    if (s.crest) sky += r.stationM;
    if (s.exposedP !== null) {
      seenN++;
      if (s.exposedP >= 0.5) seen++;
    }
    const ob = s.cls !== null && foot.nogo.has(s.cls);
    if (ob && !inObs) obstacles.push({ chainM: s.chainM, why: word(s.cls!), x: s.x, y: s.y });
    inObs = ob;
  }
  const reliefM = hi > lo ? hi - lo : 0;
  const hills = reliefM >= L.hillsReliefM;
  const limitKm = hills ? L.nightKmHills : L.nightKmMax;
  const lengthKm = r.lengthM / 1000;
  return {
    lengthKm,
    hills,
    limitKm,
    withinNight: lengthKm <= limitKm,
    offRoadPct: r.stations.length ? Math.round(100 - (100 * onRoad) / r.stations.length) : 0,
    obstacles,
    villages: r.placesPassed.map((p) => ({ name: p.name, chainM: p.chainM })),
    skylineM: sky,
    seenPct: seenN ? Math.round((100 * seen) / seenN) : null,
    reliefM: Math.round(reliefM),
  };
}
