/**
 * AoiCheckRead.ts
 *
 * The pure part of the AOI check (user, 2026-11-17: "Let users check an area before planning: bundle coverage, missing
 * tiles, available layers and profiles, data build date, and source/licence notes. Highlight gaps on the map and say
 * which readings they affect"). No DOM, no I/O and only erasable TypeScript (tools/sitefinder-test/aoi.mjs).
 *
 * From the terrain bundle's manifest: the layers (with their sources and what each feeds), the movers (profiles), the
 * build stamps, the sources with dates and licences; tile maths for an AOI (which tiles, at which zoom, keeping the
 * count bounded); the share of the AOI inside the bundle's frame and inside each grid's bounds; and the report that
 * turns tile tallies into gaps and the readings they affect. Never shows the source name "NCGDB" (user, 7 Nov 2026):
 * it is "1:50k map".
 */

export type XY = [number, number];
/** Web Mercator box [x0, y0, x1, y1]. */
export type Box = [number, number, number, number];

const R = 6378137;
const ORIGIN = Math.PI * R;

export interface AoiLayer {
  /** Manifest key (class, elev_hi, cc...) or dist:<profile>. */
  key: string;
  /** Tile folder. */
  tileLayer: string;
  label: string;
  /** Readings that need it. */
  uses: string;
  sources: string[];
  /** Pixel value that means no data (null: none, e.g. elev_lo). */
  nodata: number | null;
  /** Core layers: a gap there blanks every reading. */
  core: boolean;
}

/** What each layer feeds (Ground Guide, Mov / Pl Guide, Gun Depl, Admin Area, X-Section, Compare, Plan Builder). */
export const LAYER_USES: Record<string, { label: string; uses: string; core?: boolean }> = {
  class: { label: 'Gr class', uses: 'Going / NO-GO for every mover, obstacles and crossings, room for a posn, IPB coding', core: true },
  elev_hi: { label: 'Height (high byte)', uses: 'Heights: slope, tilt, crest clearance, line of sight, dead Gr, military crest, X-Section', core: true },
  elev_lo: { label: 'Height (low byte)', uses: 'Heights (with the high byte)', core: true },
  cc: { label: 'Cover / concealment', uses: 'C of GROTBC: hidden from air, cover from fire' },
  wet: { label: 'Wet Gr', uses: 'Wet and flood-prone Gr, going after rain, admin sites flood check' },
  soil: { label: 'Soil', uses: 'Soil type for the going after rain' },
  rci_dry: { label: 'Soil strength (dry)', uses: 'Firm Gr when dry (soil going, Gun Depl / Admin Area firm)' },
  rci_wet: { label: 'Soil strength (wet)', uses: 'Firm Gr after rain' },
  bld: { label: 'Bldgs', uses: 'BUA, sight through BUA, people on a site' },
  route: { label: 'Rd class', uses: 'Rd class and MSR at a point' },
  landform: { label: 'Landform', uses: 'Crest / valley words, ITG reading' },
  terrain: { label: 'Terrain type', uses: 'Terrain type (plain, hilly, desert...), march speeds' },
  hut: { label: 'Huts', uses: 'Temporary huts (B)' },
  bank: { label: 'Banks', uses: 'River and canal bank heights (crossings, canal defence)' },
};

/** Grids and tile sets beyond the raster layers. */
export const EXTRA_USES: Record<string, string> = {
  features: 'Water points, Brs, places, landmarks, ITG candidates (G R O B W)',
  network: 'Rds, routes, access to a site, Rd density',
  population: 'People round a point or on a site',
  climate: "The month's rain (dry / after rain), weather",
  visibility: "The month's visibility (sight range)",
};

/** A source's name for the user: never "NCGDB" (user, 7 Nov 2026). */
export function sourceName(id: string, name: string): string {
  if (id === 'ncgdb') return '1:50k map (Survey of Pakistan)';
  return String(name ?? id).replace(/NCGDB[^,;)]*/g, '1:50k map').replace(/â€”/g, '-');
}

/** The raster layers to check, from the manifest: its layers, and one distance layer per mover. */
export function aoiLayers(manifest: any, rules: any): AoiLayer[] {
  const L = (manifest?.layers ?? {}) as Record<string, string>;
  const g = manifest?.grotbc?.layers ?? {};
  const ls = manifest?.layerSources ?? {};
  const out: AoiLayer[] = [];
  for (const [key, folder] of Object.entries(L)) {
    if (key === 'dist') continue;
    const u = LAYER_USES[key] ?? { label: key, uses: key };
    const sources: string[] = g[key]?.sources ?? ls[key] ?? (key.startsWith('elev') ? ['glo30'] : []);
    out.push({ key, tileLayer: String(folder), label: u.label, uses: u.uses, sources, nodata: key === 'elev_lo' ? null : 255, core: !!u.core });
  }
  const tpl = L.dist;
  if (tpl) {
    for (const p of (manifest?.profiles ?? []) as string[]) {
      const label = String(rules?.profiles?.[p]?.label ?? p);
      out.push({ key: `dist:${p}`, tileLayer: tpl.replace('{profile}', p), label: `Dist to NO-GO: ${label}`, uses: `Near / caution and clear Gr for ${label} (Ground Guide verdict)`, sources: ls.dist ?? [], nodata: 255, core: false });
    }
  }
  return out;
}

// ── tile maths ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function lngLatToMerc(lng: number, lat: number): XY {
  const c = Math.max(-85.05112878, Math.min(85.05112878, lat));
  return [(lng * ORIGIN) / 180, Math.log(Math.tan(Math.PI / 4 + (c * Math.PI) / 360)) * R];
}
export function mercToLngLat(x: number, y: number): XY {
  return [(x * 180) / ORIGIN, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI)];
}

export function boxOf(ring: XY[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of ring) {
    x0 = Math.min(x0, p[0]);
    x1 = Math.max(x1, p[0]);
    y0 = Math.min(y0, p[1]);
    y1 = Math.max(y1, p[1]);
  }
  return [x0, y0, x1, y1];
}

/** Tiles (x, y at zoom z, y down from the north) covering a box. */
export function tileRange(b: Box, z: number): { tx0: number; tx1: number; ty0: number; ty1: number; n: number } {
  const size = (2 * ORIGIN) / 2 ** z;
  const tx0 = Math.floor((b[0] + ORIGIN) / size), tx1 = Math.floor((b[2] + ORIGIN) / size);
  const ty0 = Math.floor((ORIGIN - b[3]) / size), ty1 = Math.floor((ORIGIN - b[1]) / size);
  return { tx0, tx1, ty0, ty1, n: (tx1 - tx0 + 1) * (ty1 - ty0 + 1) };
}

/** A tile's box, Web Mercator. */
export function tileBox(tx: number, ty: number, z: number): Box {
  const size = (2 * ORIGIN) / 2 ** z;
  return [-ORIGIN + tx * size, ORIGIN - (ty + 1) * size, -ORIGIN + (tx + 1) * size, ORIGIN - ty * size];
}

/** The finest zoom (zMin..zMax) at which a box needs at most `maxTiles` tiles per layer. */
export function pickZoom(b: Box, zMin: number, zMax: number, maxTiles: number): number {
  for (let z = zMax; z > zMin; z--) if (tileRange(b, z).n <= maxTiles) return z;
  return zMin;
}

/** Point in a ring (even-odd). */
export function inRing(p: XY, ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], c = ring[j];
    if (a[1] > p[1] !== c[1] > p[1] && p[0] < ((c[0] - a[0]) * (p[1] - a[1])) / (c[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Share of the AOI (a ring) inside a lng / lat box [w, s, e, n], from a grid of about `n`² points. */
export function shareInside(ring: XY[], lngLatBox: [number, number, number, number] | null | undefined, n = 40): number | null {
  if (!lngLatBox || lngLatBox.length !== 4) return null;
  const b = boxOf(ring);
  let tot = 0, inn = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const p: XY = [b[0] + ((i + 0.5) / n) * (b[2] - b[0]), b[1] + ((j + 0.5) / n) * (b[3] - b[1])];
      if (!inRing(p, ring)) continue;
      tot++;
      const [lng, lat] = mercToLngLat(p[0], p[1]);
      if (lng >= lngLatBox[0] && lng <= lngLatBox[2] && lat >= lngLatBox[1] && lat <= lngLatBox[3]) inn++;
    }
  return tot ? inn / tot : null;
}

/** Ground area of a ring, km². */
export function ringKm2(ring: XY[]): number {
  if (ring.length < 3) return 0;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  const lat = mercToLngLat(0, ring.reduce((t, p) => t + p[1], 0) / ring.length)[1];
  const s = Math.cos((lat * Math.PI) / 180);
  return (Math.abs(a / 2) * s * s) / 1e6;
}

/**
 * Share of a tile's pixels inside the AOI that hold no data. Every `step`-th pixel is tested. Returns the pixels
 * counted (inside the AOI) and those with no data.
 */
export function nodataInTile(data: Uint8Array, tx: number, ty: number, z: number, ts: number, ring: XY[], nodata: number, step = 4): { inside: number; empty: number } {
  const b = tileBox(tx, ty, z);
  const px = (b[2] - b[0]) / ts;
  let inside = 0, empty = 0;
  for (let r = step / 2; r < ts; r += step)
    for (let c = step / 2; c < ts; c += step) {
      const p: XY = [b[0] + (c + 0.5) * px, b[3] - (r + 0.5) * px];
      if (!inRing(p, ring)) continue;
      inside++;
      if (data[Math.floor(r) * ts + Math.floor(c)] === nodata) empty++;
    }
  return { inside, empty };
}

// ── the report ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface LayerTally {
  layer: AoiLayer;
  z: number;
  total: number;
  loaded: number;
  missing: number;
  failed: number;
  pending: number;
  /** Tiles missing (404) or failed. */
  gapTiles: Array<{ tx: number; ty: number; failed: boolean }>;
  /** Pixels inside the AOI sampled in loaded tiles, and those with no data. */
  inside: number;
  empty: number;
}

export interface ExtraTally {
  key: string;
  uses: string;
  /** Share of the AOI covered (null: not checked / not in the bundle). */
  share: number | null;
  note: string;
}

export interface AoiReport {
  areaKm2: number;
  /** Share of the AOI inside the bundle's frame. */
  inFrame: number | null;
  layers: LayerTally[];
  extras: ExtraTally[];
  /** Readings affected, worst first. */
  affected: Array<{ what: string; layers: string[]; share: number; core: boolean }>;
  /** Layers with no gap in the AOI. */
  complete: number;
  verdict: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; text: string };
  pending: boolean;
}

/**
 * How the check judges (nothing hidden): each line a working threshold or the data it reads. The thresholds are
 * proposals (E), not doctrine.
 */
export const AOI_JUDGED: string[] = [
  "[data] Tiles: every raster layer named in the bundle manifest and each mover's distance layer, fetched tile by tile over the AOI (a 404 = no cover, an error = failed); in present tiles every 8th pixel inside the AOI is tested for no data (value 255).",
  '[data] Feature and Rd tiles (z10): a tile is written only where something is recorded, so an absent one may mean an empty place, not a gap.',
  '[data] Population, climate and visibility grids: their own bounds (population.json, climate.json, visibility.json) against the AOI.',
  "[data] Frame: the share of the AOI inside the bundle manifest's bounds.",
  '[E] Zoom: the finest zoom that keeps a layer under the "most tiles per layer" setting (48); coarser than z12 is said in the panel.',
  '[E] A layer gap under 0.5 % of the AOI is not counted; a grid covering 99.5 % or more counts as full.',
  '[E] Verdict bad: the AOI is outside the data, or the Gr class or the heights are missing over 50 % of it. Warn: any other gap. OK: no gap.',
  "[E] Readings affected: each layer's gap is listed against the readings that use it (AoiCheckRead.ts LAYER_USES), the Gr class and heights first.",
];

/** Share of the AOI a layer cannot answer for: missing / failed tiles plus no-data pixels in loaded tiles. */
export function gapShare(t: LayerTally): number {
  if (!t.total) return 0;
  const gapTiles = (t.missing + t.failed) / t.total;
  const inLoaded = t.inside ? t.empty / t.inside : 0;
  return Math.min(1, gapTiles + (t.loaded / t.total) * inLoaded);
}

export function buildReport(ring: XY[], manifest: any, layers: LayerTally[], extras: ExtraTally[]): AoiReport {
  const areaKm2 = ringKm2(ring);
  const inFrame = shareInside(ring, manifest?.bounds);
  const pending = layers.some((t) => t.pending > 0);
  // one line per reading: the movers' distance layers as one, the two height bytes as one
  const groups = new Map<string, { what: string; layers: string[]; share: number; core: boolean; n: number }>();
  for (const t of layers) {
    const s = gapShare(t);
    if (s < 0.005) continue;
    const k = t.layer.key.startsWith('dist:') ? 'dist' : t.layer.key === 'elev_lo' ? 'elev_hi' : t.layer.key;
    const what = k === 'dist' ? 'Near / caution and clear Gr for the movers (Ground Guide verdict)' : k === 'elev_hi' ? (LAYER_USES.elev_hi?.uses ?? t.layer.uses) : t.layer.uses;
    const g = groups.get(k) ?? { what, layers: [], share: 0, core: false, n: 0 };
    g.n++;
    g.share = Math.max(g.share, s);
    g.core = g.core || t.layer.core;
    if (k !== 'dist') g.layers.push(t.layer.label);
    groups.set(k, g);
  }
  const affected: AoiReport['affected'] = [...groups.entries()].map(([k, g]) => ({ what: g.what, layers: k === 'dist' ? [`${g.n} mover${g.n === 1 ? '' : 's'}`] : g.layers, share: g.share, core: g.core }));
  for (const e of extras) if (e.share !== null && e.share < 0.995) affected.push({ what: e.uses, layers: [e.key], share: 1 - e.share, core: false });
  affected.sort((a, b) => Number(b.core) - Number(a.core) || b.share - a.share);
  const complete = layers.filter((t) => gapShare(t) < 0.005 && t.pending === 0).length;
  const coreGap = Math.max(0, ...layers.filter((t) => t.layer.core).map(gapShare));
  let verdict: AoiReport['verdict'];
  if (pending) verdict = { tone: 'unknown', text: 'Checking the tiles…' };
  else if (inFrame !== null && inFrame < 0.005) verdict = { tone: 'bad', text: 'The AOI is outside the terrain data' };
  else if (coreGap >= 0.5) verdict = { tone: 'bad', text: `No Gr class or heights over ${Math.round(coreGap * 100)}% of the AOI: readings there are blank` };
  else if (coreGap > 0.005 || affected.length) verdict = { tone: 'warn', text: `Gaps: ${affected.length} reading${affected.length === 1 ? '' : 's'} partly blank (worst ${Math.round((affected[0]?.share ?? 0) * 100)}%)` };
  else verdict = { tone: 'ok', text: `Full cover: ${complete} of ${layers.length} layers and every grid read over the AOI` };
  return { areaKm2, inFrame, layers, extras, affected, complete, verdict, pending };
}
