/**
 * SiteScan.ts
 *
 * The pure ground reader the two site finders share (Gun Deployment, Admin Area). No DOM, no ArcGIS, no I/O and only
 * erasable TypeScript, so Node runs it on a synthetic probe (tools/sitefinder-test). A site is an oriented rectangle,
 * frontage across its axis and depth along it, laid on the terrain bundle's 30 m grids through a `SiteProbe`;
 * `readSite` samples it and returns the facts the finders score:
 *
 *   going     the mover's NO-GO / SLOW-GO classes (rules.json profiles) at each sample;
 *   soil      the cone index of the season (rci_dry / rci_wet) against the vehicle's (rules.json soilStrength);
 *   wet       the wet layer (flood-prone, seasonal water, riverbed, waterlogged, water);
 *   air       concealment from the air (cc >> 4: 0 none .. 3 good) and the share under trees;
 *   level     a plane fitted to the samples' elevations: the tilt of the site in degrees, and its relief;
 *   built-up  BUA class and the building layer; people per km² from the population grid.
 *
 * What the bundle cannot say stays unknown, never good (safety first: a site read half from missing tiles is not
 * "clear"). Coordinates are Web Mercator metres; distances on the ground are corrected by cos(latitude).
 */

import { bearingOf, groundDist, latOfY, lngLatToMerc, mercToLngLat, offsetPt, scaleAt } from '../MovementGuide/MovementGuideScan';

export { bearingOf, groundDist, latOfY, lngLatToMerc, mercToLngLat, offsetPt, scaleAt };

export type XY = [number, number];
export type Season = 'dry' | 'wet';
export type Tone = 'ok' | 'warn' | 'bad' | 'unknown';

export interface SiteRoad {
  distM: number;
  x: number;
  y: number;
  /** GroundGuideRoads attrs: t class name, c load class, aw all-weather, k tier (3 tankable, 2 class 50+, 1 below, 0 not recorded), m MSR, n name, r road no. */
  attrs: Record<string, unknown>;
}

export interface SiteFeature {
  kind: string;
  label: string;
  name: string | null;
  x: number;
  y: number;
  distM: number;
  attrs: Record<string, unknown>;
}

/** What a finder reads from the terrain bundle (SiteProbe.ts in the browser, a synthetic grid in the tests). */
export interface SiteProbe {
  /** Ground class (rules.json classes), null when unknown. */
  cls(x: number, y: number): number | null;
  /** Elevation in metres, NaN when unknown. */
  elev(x: number, y: number): number;
  /** A manifest layer's byte (`cc`, `wet`, `soil`, `rci_dry`, `rci_wet`, `bld`, `landform`, `terrain`); null when unknown. */
  layer(key: string, x: number, y: number): number | null;
  /** Roads within a radius, nearest first. */
  roads(x: number, y: number, radiusM: number): SiteRoad[];
  /** Point features of the given kinds within a radius, nearest first. */
  features(x: number, y: number, radiusM: number, kinds: ReadonlySet<string>): SiteFeature[];
  /** People per km² at the point (population grid), null when unknown. */
  people(x: number, y: number): number | null;
  /**
   * Chance (0-1) that an eye `eyeM` above the ground at (ox, oy) sees a target `targetM` above the ground at (tx, ty),
   * from the 30 m elevation plus what stands on the ground (the OCOKA sight engine). Null when it cannot be read (no
   * data, or the two are too far apart for one sight grid). Optional: finders that need no sight leave it out.
   */
  sight?(ox: number, oy: number, eyeM: number, tx: number, ty: number, targetM: number): number | null;
}

/** The mover's going and soil rule (built once per scan). */
export interface GroundRule {
  /** 256 flags: NO-GO classes for the mover. */
  nogo: Uint8Array;
  /** 256 flags: SLOW-GO classes for the mover. */
  caution: Uint8Array;
  /** Vehicle cone index [1 pass, 50 passes] on fine and on coarse soil; null = not judged on soil. */
  soil: { fine: [number, number]; coarse: [number, number] } | null;
  season: Season;
}

export function goingRule(rules: any, profile: string, season: Season): GroundRule {
  const p = rules?.profiles?.[profile] ?? {};
  const nogo = new Uint8Array(256);
  const caution = new Uint8Array(256);
  for (const c of p.nogo ?? []) if (c >= 0 && c < 256) nogo[c] = 1;
  for (const c of p.caution ?? []) if (c >= 0 && c < 256) caution[c] = 1;
  const ss = rules?.grotbc?.soilStrength;
  const vk = ss?.byProfile?.[profile];
  const v = vk ? ss?.vehicles?.[vk] : null;
  const soil = v && Array.isArray(v.fine) && Array.isArray(v.coarse) ? { fine: [v.fine[0], v.fine[1]] as [number, number], coarse: [v.coarse[0], v.coarse[1]] as [number, number] } : null;
  return { nogo, caution, soil, season };
}

/** Ground classes that carry trees over the site (cover from the air). rules.json classes 1, 29, 30, 31. */
export const TREE_CLASSES: ReadonlySet<number> = new Set([1, 29, 30, 31]);
/** Built-up area class. */
export const BUA_CLASS = 3;

// ── geometry ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The four corners of an oriented rectangle: frontage across `axisDeg`, depth along it, centred on `c`. */
export function rectRing(c: XY, axisDeg: number, frontM: number, depthM: number): XY[] {
  const f = frontM / 2, d = depthM / 2;
  const across = axisDeg + 90;
  const at = (a: number, b: number): XY => {
    const p = offsetPt(c[0], c[1], axisDeg, a);
    return offsetPt(p[0], p[1], across, b);
  };
  return [at(d, -f), at(d, f), at(-d, f), at(-d, -f)];
}

/** Lattice points within `radiusM` of `c`, `stepM` apart on the ground, nearest the centre first. */
export function lattice(c: XY, radiusM: number, stepM: number): XY[] {
  const s = scaleAt(c[1]);
  const n = Math.ceil(radiusM / stepM);
  const out: Array<{ p: XY; d: number }> = [];
  for (let i = -n; i <= n; i++)
    for (let j = -n; j <= n; j++) {
      const dx = i * stepM, dy = j * stepM;
      const d = Math.hypot(dx, dy);
      if (d > radiusM) continue;
      out.push({ p: [c[0] + dx / s, c[1] + dy / s], d });
    }
  return out.sort((a, b) => a.d - b.d).map((o) => o.p);
}

/** Keep the best candidates (already sorted best first) at least `minM` apart, up to `max`. */
export function spreadPick<T extends { at: XY }>(sorted: T[], minM: number, max: number): T[] {
  const out: T[] = [];
  for (const c of sorted) {
    if (out.length >= max) break;
    if (out.every((o) => groundDist(o.at, c.at) >= minM)) out.push(c);
  }
  return out;
}

/** Angle in NATO mils (6400 to the circle). */
export function mils(rad: number): number {
  return (rad * 3200) / Math.PI;
}

// ── reading a site ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface SiteRead {
  /** Samples laid and samples whose class is known. */
  n: number;
  known: number;
  /** Shares of the known samples (0-1). */
  nogo: number;
  caution: number;
  /** Soil too soft for the vehicle in the season (NO-GO) / marginal (SLOW-GO); soilKnown = samples with a cone index. */
  softNogo: number;
  softSlow: number;
  soilKnown: number;
  /** Wet layer: under water or waterlogged now (codes 4, 5; 2 and 3 in the wet season) / flood-prone or riverbed (1, 3). */
  wetBad: number;
  floodProne: number;
  wetKnown: number;
  /** Concealment from the air: mean level 0-3 and the share at fair or better; under trees. */
  concealMean: number | null;
  /** Cover from fire (cc & 15: 0 none .. 3 good), mean over the samples. */
  coverMean: number | null;
  concealGood: number;
  trees: number;
  /** Built-up: BUA class or a building in the cell. */
  bua: number;
  /** Plane fitted to the elevations: tilt in degrees, relief (max - min) in metres, mean height. */
  tiltDeg: number | null;
  reliefM: number | null;
  elevM: number | null;
  /** Mean people per km² over the samples, null when unknown. */
  peopleKm2: number | null;
  /** The commonest classes on the site, most first. */
  classes: Array<{ cls: number; share: number }>;
}

/**
 * Sample an oriented site: `nF` across the frontage by `nD` along the depth (at least 2 each). The rule is the mover's
 * going and soil in the season.
 */
export function readSite(probe: SiteProbe, c: XY, axisDeg: number, frontM: number, depthM: number, rule: GroundRule, nF = 5, nD = 4): SiteRead {
  const across = axisDeg + 90;
  const pts: Array<{ x: number; y: number; u: number; v: number }> = [];
  for (let i = 0; i < nF; i++) {
    const u = nF > 1 ? (i / (nF - 1) - 0.5) * frontM * 0.9 : 0;
    for (let j = 0; j < nD; j++) {
      const v = nD > 1 ? (j / (nD - 1) - 0.5) * depthM * 0.9 : 0;
      const p = offsetPt(c[0], c[1], axisDeg, v);
      const q = offsetPt(p[0], p[1], across, u);
      pts.push({ x: q[0], y: q[1], u, v });
    }
  }
  return readSamples(probe, pts, rule);
}

/**
 * Sample any area (a ring of Web Mercator points) on a grid about `stepM` apart, at most `maxSamples` (the grid widens to
 * keep under it). A ring of fewer than 3 points reads nothing.
 */
export function readArea(probe: SiteProbe, ring: XY[], rule: GroundRule, stepM = 60, maxSamples = 400): SiteRead {
  const pts = areaSamples(ring, stepM, maxSamples);
  return readSamples(probe, pts, rule);
}

/** Grid points inside a ring, with local ground metres (u east, v north) from its centre for the plane fit. */
export function areaSamples(ring: XY[], stepM = 60, maxSamples = 400): Array<{ x: number; y: number; u: number; v: number }> {
  if (ring.length < 3) return [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of ring) {
    x0 = Math.min(x0, p[0]);
    x1 = Math.max(x1, p[0]);
    y0 = Math.min(y0, p[1]);
    y1 = Math.max(y1, p[1]);
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const s = scaleAt(cy);
  const wM = (x1 - x0) * s, hM = (y1 - y0) * s;
  let step = Math.max(10, stepM);
  while ((wM / step + 1) * (hM / step + 1) > maxSamples * 1.6) step *= 1.25;
  const out: Array<{ x: number; y: number; u: number; v: number }> = [];
  for (let v = -hM / 2 + step / 2; v <= hM / 2; v += step)
    for (let u = -wM / 2 + step / 2; u <= wM / 2; u += step) {
      const p: XY = [cx + u / s, cy + v / s];
      if (inRing(p, ring)) out.push({ x: p[0], y: p[1], u, v });
    }
  if (!out.length) out.push({ x: cx, y: cy, u: 0, v: 0 });
  return out.slice(0, maxSamples);
}

/** Point in a ring (even-odd). */
export function inRing(p: XY, ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Read a set of sample points (u, v: local ground metres, for the plane fit). */
export function readSamples(probe: SiteProbe, pts: Array<{ x: number; y: number; u: number; v: number }>, rule: GroundRule): SiteRead {
  let known = 0, nogo = 0, caution = 0, softNogo = 0, softSlow = 0, soilKnown = 0, wetBad = 0, floodProne = 0, wetKnown = 0;
  let cSum = 0, cN = 0, cGood = 0, trees = 0, bua = 0, pSum = 0, pN = 0, covSum = 0;
  const counts = new Map<number, number>();
  const zs: Array<{ u: number; v: number; z: number }> = [];
  const rciKey = rule.season === 'wet' ? 'rci_wet' : 'rci_dry';
  for (const s of pts) {
    const k = probe.cls(s.x, s.y);
    if (k !== null && k !== 255) {
      known++;
      counts.set(k, (counts.get(k) ?? 0) + 1);
      if (rule.nogo[k]) nogo++;
      else if (rule.caution[k]) caution++;
      if (TREE_CLASSES.has(k)) trees++;
      if (k === BUA_CLASS) bua++;
      else {
        const b = probe.layer('bld', s.x, s.y);
        if (b !== null && b !== 255 && (b & 7) > 0) bua++;
      }
    }
    if (rule.soil) {
      const r = probe.layer(rciKey, s.x, s.y);
      if (r !== null && r !== 255) {
        soilKnown++;
        const ci = r & 127, coarse = (r & 128) !== 0;
        const [v1, v50] = coarse ? rule.soil.coarse : rule.soil.fine;
        if (ci < v1) softNogo++;
        else if (ci < v50) softSlow++;
      }
    }
    const w = probe.layer('wet', s.x, s.y);
    if (w !== null && w !== 255) {
      wetKnown++;
      if (w === 4 || w === 5 || (rule.season === 'wet' && (w === 2 || w === 3))) wetBad++;
      else if (w === 1 || w === 3 || w === 2) floodProne++;
    }
    const cc = probe.layer('cc', s.x, s.y);
    if (cc !== null && cc !== 255) {
      const lvl = cc >> 4;
      cSum += lvl;
      covSum += cc & 15;
      cN++;
      if (lvl >= 2) cGood++;
    }
    const z = probe.elev(s.x, s.y);
    if (Number.isFinite(z)) zs.push({ u: s.u, v: s.v, z });
    const pp = probe.people(s.x, s.y);
    if (pp !== null && Number.isFinite(pp)) {
      pSum += pp;
      pN++;
    }
  }
  const sh = (a: number, b: number) => (b > 0 ? a / b : 0);
  const fit = planeTilt(zs);
  return {
    n: pts.length,
    known,
    nogo: sh(nogo, known),
    caution: sh(caution, known),
    softNogo: sh(softNogo, soilKnown),
    softSlow: sh(softSlow, soilKnown),
    soilKnown,
    wetBad: sh(wetBad, wetKnown),
    floodProne: sh(floodProne, wetKnown),
    wetKnown,
    concealMean: cN ? cSum / cN : null,
    coverMean: cN ? covSum / cN : null,
    concealGood: sh(cGood, cN),
    trees: sh(trees, known),
    bua: sh(bua, known),
    tiltDeg: fit?.tiltDeg ?? null,
    reliefM: fit?.reliefM ?? null,
    elevM: fit?.meanM ?? null,
    peopleKm2: pN ? pSum / pN : null,
    classes: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([cls, k]) => ({ cls, share: sh(k, known) })),
  };
}

/** Least-squares plane z = a + b u + c v over the samples: its tilt in degrees, the relief and the mean height. */
export function planeTilt(zs: Array<{ u: number; v: number; z: number }>): { tiltDeg: number; reliefM: number; meanM: number } | null {
  const n = zs.length;
  if (n < 4) return null;
  let su = 0, sv = 0, sz = 0;
  for (const p of zs) {
    su += p.u;
    sv += p.v;
    sz += p.z;
  }
  const mu = su / n, mv = sv / n, mz = sz / n;
  let suu = 0, svv = 0, suv = 0, suz = 0, svz = 0, lo = Infinity, hi = -Infinity;
  for (const p of zs) {
    const du = p.u - mu, dv = p.v - mv, dz = p.z - mz;
    suu += du * du;
    svv += dv * dv;
    suv += du * dv;
    suz += du * dz;
    svz += dv * dz;
    lo = Math.min(lo, p.z);
    hi = Math.max(hi, p.z);
  }
  const det = suu * svv - suv * suv;
  if (!(Math.abs(det) > 1e-9)) return { tiltDeg: 0, reliefM: hi - lo, meanM: mz };
  const b = (suz * svv - svz * suv) / det;
  const c = (svz * suu - suz * suv) / det;
  return { tiltDeg: (Math.atan(Math.hypot(b, c)) * 180) / Math.PI, reliefM: hi - lo, meanM: mz };
}

// ── season ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The ground state for a month at a place: wet when the month's rain normal reaches `wetFromMm` (climate grid,
 * WorldClim), else by the fallback months (monsoon Jul-Sep) when there is no climate data. Also says why.
 */
export function seasonFor(month: number, precMm: number[] | null, wetFromMm: number, fallbackWet: number[]): { season: Season; why: string } {
  const m = Math.min(12, Math.max(1, Math.round(month)));
  const name = MONTHS[m - 1];
  if (precMm && precMm.length === 12) {
    const p = Math.round(precMm[m - 1]);
    return p >= wetFromMm
      ? { season: 'wet', why: `${name}: ${p} mm of rain in the month (wet from ${wetFromMm} mm)` }
      : { season: 'dry', why: `${name}: ${p} mm of rain in the month (wet from ${wetFromMm} mm)` };
  }
  const wet = fallbackWet.includes(m);
  return { season: wet ? 'wet' : 'dry', why: `${name}: ${wet ? 'a monsoon month' : 'not a monsoon month'} (no climate data here)` };
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── roads ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RoadPick {
  road: SiteRoad | null;
  /** Load class tier of the road (3 tankable / 60+, 2 class 50+, 1 below 50, 0 not recorded). */
  tier: number;
  allWeather: boolean;
  msr: boolean;
  label: string;
}

/** The nearest road that meets `minTier` (or the nearest of any kind when none does), with a short label. */
export function pickRoad(roads: SiteRoad[], minTier: number): RoadPick {
  const good = roads.find((r) => Number(r.attrs.k ?? 0) >= minTier);
  const r = good ?? roads[0] ?? null;
  if (!r) return { road: null, tier: 0, allWeather: false, msr: false, label: 'no Rd' };
  const a = r.attrs;
  const tier = Number(a.k ?? 0);
  const name = String(a.r ?? a.n ?? '') || String(a.t ?? 'Rd');
  const cls = a.c ? `cl ${a.c}` : tier === 0 ? 'cl not recorded' : '';
  return { road: r, tier, allWeather: !!a.aw, msr: !!a.m, label: [name, cls, a.aw ? '' : 'fair weather'].filter(Boolean).join(', ') };
}

// ── rules: book, page and words ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The rule behind a figure, for the "why": the book (short name), the printed page and the words quoted, with the
 * result of checking them against the book (tools/doctrine-refs/verify.py). Basis: R Pakistani book, U US doctrine,
 * E a decision or proposal (no book figure found: the note says why, `searched` where it was looked for, and any book
 * words it rests on follow as 'context'), M a method setting of the finder (how it searches or reads the data, not a
 * military rule), S a published civil standard (UN Degree of Urbanisation), T the terrain data's own rule (rules.json),
 * D data (the ORBAT, the bundle's layers, your inputs).
 */
export interface RuleRef {
  basis: string;
  book: string;
  page: string;
  quote: string | null;
  /** 'rule': the figure comes from it; 'context': book words a proposal rests on; 'data': the data a value was read from. */
  role: 'rule' | 'context' | 'data';
  /** 'ok' quote found on the cited page; 'page?' found on another page; 'unchecked' online only; null not checkable. */
  checked: string | null;
  /** The figure it stands for, with its value ("Planning range = 90 % of max"). */
  figure: string;
  /** For a proposal: why the figure was chosen. */
  note?: string;
  /** A figure worked out from book figures: the working ("8 veh + 7 tlr at 50 veh per map sq = ..."). */
  calc?: string;
  /** A decision with no book figure: the books and publications it was looked for in. */
  searched?: string;
  /** A decision taken for the tool (ISO date), on the user's instruction to decide where no book gives a figure. */
  decided?: string;
}

/** The kind of backing in words: "Decision, no book figure" / "Method setting" / "Proposal, no book rule" / "R". */
export function basisLabel(r: Pick<RuleRef, 'basis' | 'decided'>): string {
  if (r.basis === 'E') return r.decided ? 'Decision, no book figure' : 'Proposal, no book rule';
  if (r.basis === 'M') return 'Method setting, not a military rule';
  if (r.basis === 'S') return 'Published civil standard';
  return r.basis;
}

export interface RefSource {
  short: string;
  url?: string;
}

/** Sources of a doctrine document by id. */
export function refSources(doc: any): Record<string, RefSource> {
  const out: Record<string, RefSource> = {};
  for (const s of (doc?.sources ?? []) as any[]) if (s?.id) out[s.id] = { short: String(s.short ?? s.name ?? s.id), url: s.url ?? s.location };
  return out;
}

/** The rules behind a doctrine figure ({ value, basis, src, refs }): its book rules, or the proposal and its context. */
export function figRefs(
  fig: { basis?: string; src?: string; refs?: any[]; calc?: string; searched?: string[] | string; decided?: string } | null | undefined,
  figure: string,
  sources: Record<string, RefSource>,
): RuleRef[] {
  if (!fig) return [];
  const basis = String(fig.basis ?? 'E');
  const refs = Array.isArray(fig.refs) ? fig.refs : [];
  const out: RuleRef[] = [];
  const rules = refs.filter((r) => (r?.role ?? 'rule') === 'rule');
  const searched = Array.isArray(fig.searched) ? fig.searched.join('; ') : fig.searched ? String(fig.searched) : undefined;
  if (!rules.length)
    out.push({ basis, book: '', page: '', quote: null, role: 'rule', checked: null, figure, note: String(fig.src ?? ''), searched, decided: fig.decided ? String(fig.decided) : undefined });
  let first = true;
  for (const r of refs) {
    const role = (r?.role ?? 'rule') === 'context' ? 'context' : 'rule';
    const calc = role === 'rule' && first && fig.calc ? String(fig.calc) : undefined;
    if (role === 'rule') first = false;
    out.push({
      calc,
      basis: role === 'rule' ? basis : 'E',
      book: sources[r.book]?.short ?? String(r.book ?? ''),
      page: String(r.page ?? ''),
      quote: r.quote ?? null,
      role,
      checked: r.checked?.status ?? null,
      figure,
    });
  }
  return out;
}

/** The terrain data's own rule for a mover (rules.json profile): NO-GO / SLOW-GO by ground class. */
export function terrainRef(rules: any, profile: string, figure: string): RuleRef {
  const p = rules?.profiles?.[profile] ?? {};
  const label = String(p.label ?? profile);
  const names = (codes: number[]) => codes.map((c) => String(rules?.classes?.[String(c)]?.label ?? c)).slice(0, 8).join(', ');
  return {
    basis: 'T',
    book: `Terrain rules (rules.json ${rules?.version ?? ''}, profile "${label}")`.replace('  ', ' '),
    page: '',
    quote: `NO-GO: ${names(p.nogo ?? [])}${(p.nogo ?? []).length > 8 ? '…' : ''}`,
    role: 'rule',
    checked: null,
    figure,
    note: 'the terrain pipeline\'s rule (tools/terrain-pipeline/rules.yaml): which ground classes stop this mover',
  };
}

/** The soil rule (rules.json soilStrength): cone index against the vehicle's. Method US practice; numbers a proposal. */
export function soilRuleRef(rules: any, profile: string, figure: string): RuleRef {
  const vk = rules?.grotbc?.soilStrength?.byProfile?.[profile];
  const v = vk ? rules?.grotbc?.soilStrength?.vehicles?.[vk] : null;
  return {
    basis: 'T',
    book: `Terrain rules (rules.json ${rules?.version ?? ''}, soilStrength)`.replace('  ', ' '),
    page: '',
    quote: v ? `${v.label}: cone index ${v.fine[0]} (one pass) / ${v.fine[1]} (a column) on fine soil, ${v.coarse[0]} / ${v.coarse[1]} on sand` : null,
    role: 'rule',
    checked: null,
    figure,
    note: 'method: US terrain-analysis practice (WES / NRMM cone index, USCS soil groups); the vehicle figures are a STARTING PROPOSAL in rules.yaml, to be replaced by the vehicles\' own (EME / trials)',
  };
}

// ── data: what a value was read from ────────────────────────────────────────────────────────────────────────────────

export type DataKey = 'class' | 'elev' | 'cc' | 'wet' | 'soil' | 'rci' | 'bld' | 'features' | 'network' | 'population' | 'climate' | 'visibility' | 'landform' | 'terrain';

const DATA_NAME: Record<DataKey, string> = {
  class: 'Gr class layer',
  elev: 'Height (30 m elevation)',
  cc: 'Cover / concealment layer',
  wet: 'Wet Gr layer',
  soil: 'Soil layer',
  rci: 'Soil strength layers (dry / after rain)',
  bld: 'Bldgs layer',
  features: 'Point features (places, water, Brs, landmarks)',
  network: 'Rd network',
  population: 'Population grid',
  climate: 'Climate grid (monthly rain)',
  visibility: 'Visibility grid',
  landform: 'Landform layer',
  terrain: 'Terrain type layer',
};

/** A source's name for the user: never "NCGDB" (user, 7 Nov 2026): the 1:50k map. */
export function sourceName(id: string, name: string): string {
  if (id === 'ncgdb') return '1:50k map (Survey of Pakistan)';
  if (id.startsWith('kmz_')) return 'Formation KMZ overlay';
  return String(name ?? id).replace(/NCGDB[^,;)]*/g, '1:50k map').replace(/â€”/g, '-').replace(/\s+\(.*$/, '');
}

/** "2021", "1984-2021", "2026-10-28": the first date in a source's data date, else ''. */
export function shortDate(s: unknown): string {
  // the year a list marks as used ("2000, ..., 2020 (2020 used)"), else a full date, a year range, a year (a range like
  // 1984-2021 must not be read as 1984-20)
  const t = String(s ?? '');
  const used = /(\d{4})\s+used/.exec(t)?.[1];
  if (used) return used;
  return (/\d{4}-\d{2}-\d{2}|\d{4}\s*-\s*\d{4}|\d{4}/.exec(t)?.[0] ?? '').replace(/\s+/g, '');
}

/**
 * The data catalogue of a terrain bundle (its manifest): for a layer or grid, the sources it was built from with their
 * dates, as a 'data' reference. Pure: the caller hands the manifest it loaded.
 */
export function dataCatalog(manifest: any): (key: DataKey, figure: string) => RuleRef {
  const src = new Map<string, any>();
  for (const s of (manifest?.sources ?? []) as any[]) if (s?.id) src.set(s.id, s);
  const g = manifest?.grotbc ?? {};
  const ids = (key: DataKey): string[] => {
    switch (key) {
      case 'class':
        return manifest?.layerSources?.class ?? [];
      case 'elev':
        return g.layers?.elev_hi?.sources ?? ['glo30'];
      case 'rci':
        return g.layers?.rci_dry?.sources ?? [];
      case 'features':
      case 'network':
      case 'population':
      case 'climate':
      case 'visibility':
        return g[key]?.sources ?? [];
      default:
        return g.layers?.[key]?.sources ?? [];
    }
  };
  const built = String(manifest?.built ?? '').slice(0, 10);
  return (key, figure) => {
    const list = ids(key).map((id) => {
      const s = src.get(id);
      const d = shortDate(s?.dataDate);
      return s ? `${sourceName(id, s.name)}${d ? ` (${d})` : ''}${s.restricted ? ' [restricted]' : ''}` : id;
    });
    return {
      basis: 'D',
      book: `${DATA_NAME[key]}${built ? ` - terrain bundle built ${built}` : ''}`,
      page: '',
      quote: list.length ? list.join('; ') : null,
      role: 'data',
      checked: null,
      figure,
    };
  };
}

/** A user input as a reference ("Target: picked on the map", "Front: the FDL drawn on the map"). */
export function inputRef(figure: string, how: string): RuleRef {
  return { basis: 'D', book: 'Your input', page: '', quote: how, role: 'data', checked: null, figure };
}

/** The month's ground state as a reference: the climate grid's rain and the threshold it is judged by. */
export function seasonRef(cat: ((key: DataKey, figure: string) => RuleRef) | null, why: string, wetFromMm: number): RuleRef[] {
  const out: RuleRef[] = [
    { basis: 'T', book: 'Climate grid threshold (climate.json thresholds.wetFromMm)', page: '', quote: `a month is wet from ${wetFromMm} mm of rain`, role: 'rule', checked: null, figure: 'Dry or after rain', note: why },
  ];
  if (cat) out.push(cat('climate', `The month's rain: ${why}`));
  return out;
}

/** One list without repeats (same figure, book, page and words). */
export function uniqRefs(list: RuleRef[]): RuleRef[] {
  const seen = new Set<string>();
  return list.filter((r) => {
    const k = `${r.figure}|${r.book}|${r.page}|${r.quote}|${r.note ?? ''}|${r.calc ?? ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** "SO's Hbk 2019, Sec 2 Arty p 212" / "Proposal (E)" / "Terrain rules (...)". */
export function refWhere(r: RuleRef): string {
  if (!r.book) return r.basis === 'E' || r.basis === 'M' ? `${basisLabel(r)} (${r.basis})` : `${r.basis}: ${r.note ?? ''}`;
  return `${r.book}${r.page ? ` p ${r.page}` : ''}`;
}

/** A line for text output: [basis] where: "words" (checked). */
export function refLine(r: RuleRef): string {
  const chk = r.checked === 'ok' ? ' (checked in the book)' : r.checked === 'page?' ? ' (words found, page to confirm)' : r.checked === 'unchecked' ? ' (online source, not checked here)' : '';
  if (!r.book)
    return `[${r.basis}] ${r.figure}: ${r.basis === 'E' || r.basis === 'M' ? basisLabel(r).toLowerCase() : ''}${r.note ? ` - ${r.note}` : ''}${r.searched ? `. Looked for in: ${r.searched}` : ''}${r.decided ? ` (decided ${r.decided})` : ''}`;
  const tag = r.role === 'context' ? 'context' : r.role === 'data' ? 'data' : r.basis;
  return `[${tag}] ${r.figure}: ${refWhere(r)}${r.quote ? (r.role === 'data' ? `: ${r.quote}` : ` "${r.quote}"`) : ''}${chk}${r.calc ? `; worked out: ${r.calc}` : ''}${r.note && r.role !== 'data' ? ` - ${r.note}` : ''}`;
}

// ── words ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
export function km(m: number, dp = 1): string {
  return `${(m / 1000).toFixed(dp)} km`;
}
export function metres(m: number): string {
  return m >= 1000 ? km(m, m >= 10000 ? 0 : 1) : `${Math.round(m / 10) * 10} m`;
}
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function compass(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
/** The worst of a set of tones (bad > unknown > warn > ok). */
export function worstTone(tones: Tone[]): Tone {
  const rank: Record<Tone, number> = { ok: 0, warn: 1, unknown: 2, bad: 3 };
  return tones.reduce<Tone>((w, t) => (rank[t] > rank[w] ? t : w), 'ok');
}
