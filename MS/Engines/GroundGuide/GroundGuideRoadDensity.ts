/**
 * GroundGuideRoadDensity.ts
 *
 * Road network density round a point (GROTBC R, Road Connectivity): kilometres of road and track per km² inside a
 * circle, all-weather and fair-weather, MSR and tankable kilometres, and the ways out (where roads leave the circle,
 * by direction). Summed by GroundGuideRoads.densityAround from the bundle's routing network (`network/gg`), the same
 * edges the T road line names and GeoCore routes on. Pure: no DOM, no fetching.
 *
 * What is counted: motorways to tertiary roads, unclassified roads and tracks, plus any residential, service or path
 * edge that is an MSR, tankable or load-classed (network.py GG_SKIP_CLAZZ). Town streets are left out, so a town reads
 * as its through roads, not its street grid.
 *
 * Bands (a proposal, taken from the bundle on 5 Nov 2026: 1,500 points in 5 km circles over the tiles that hold any
 * road; median 0.15, 75th percentile 0.57, 90th 1.17, 99th 2.95 km/km²). rules.json `grotbc.roadDensity.bands`
 * overrides them when the bundle ships it.
 *
 * Safety first (docs/15): the band the card leads with is the all-weather one when it is lower than the band for
 * every road, since tracks and fair-weather roads may not carry traffic after rain; both figures are shown.
 */

import type { RoadDensityTotals } from './GroundGuideRoads';

const COMPASS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export type RoadDensityBandKey = 'none' | 'sparse' | 'moderate' | 'dense' | 'veryDense';

export interface RoadDensityBand {
  key: RoadDensityBandKey;
  label: string;
  /** Lower bound, km of road per km² (the band runs to the next band's bound). */
  fromKmPerKm2: number;
  /** What the band means for movement. */
  note: string;
}

/** The default bands, lowest first. */
export const ROAD_DENSITY_BANDS: readonly RoadDensityBand[] = [
  { key: 'none', label: 'No Rds', fromKmPerKm2: 0, note: 'No road or track in the circle: cross-country only.' },
  { key: 'sparse', label: 'Sparse', fromKmPerKm2: 0.001, note: 'Few roads: movement is canalised and each road is a likely chokepoint.' },
  { key: 'moderate', label: 'Moderate', fromKmPerKm2: 0.25, note: 'Some choice of route; alternatives are limited.' },
  { key: 'dense', label: 'Dense', fromKmPerKm2: 0.75, note: 'Good choice of routes: room to disperse and switch axes.' },
  { key: 'veryDense', label: 'Very Dense', fromKmPerKm2: 1.5, note: 'Built-up road grid: many routes, but channelled and slow through streets.' },
];

/** Crossings of the circle closer than this along it count as one way out (a road weaving along the edge). */
const EXIT_MERGE_M = 250;

export interface RoadDensityExit {
  bearingDeg: number;
  compass: string;
  allWeather: boolean;
  msr: boolean;
  tankable: boolean;
}

export interface RoadDensityReading {
  radiusM: number;
  areaKm2: number;
  totalKm: number;
  allWeatherKm: number;
  fairKm: number;
  msrKm: number;
  tankableKm: number;
  /** km of road per km², every road and track counted. */
  density: number;
  /** km of all-weather road per km² (what is left after rain). */
  allWeatherDensity: number;
  band: RoadDensityBand;
  allWeatherBand: RoadDensityBand;
  /** The band the card leads with: the lower of the two (safety first). */
  lead: RoadDensityBand;
  /** True when `lead` is the all-weather band (it is lower). */
  leadIsAllWeather: boolean;
  exits: RoadDensityExit[];
  /** The directions with a way out, clockwise from N, each once. */
  exitDirs: string[];
  /** The directions with an all-weather way out. */
  allWeatherExitDirs: string[];
  /** Tiles were still loading: the figures may rise. */
  pending: boolean;
  /** The bands in force, lowest first (defaults or rules.json). */
  bands: RoadDensityBand[];
}

/** rules.json `grotbc.roadDensity` (optional). */
export interface RoadDensityRules {
  bands?: Array<Partial<RoadDensityBand> & { key: RoadDensityBandKey; fromKmPerKm2: number }>;
}

/** The bands in force: the defaults with any rules.json override merged in by key. */
export function roadDensityBands(rules?: RoadDensityRules | null): RoadDensityBand[] {
  const out = ROAD_DENSITY_BANDS.map((b) => ({ ...b }));
  for (const o of rules?.bands ?? []) {
    const b = out.find((x) => x.key === o.key);
    if (b && Number.isFinite(o.fromKmPerKm2)) Object.assign(b, { ...o, fromKmPerKm2: Number(o.fromKmPerKm2) });
  }
  return out.sort((a, b) => a.fromKmPerKm2 - b.fromKmPerKm2);
}

export function bandOf(density: number, bands: readonly RoadDensityBand[] = ROAD_DENSITY_BANDS): RoadDensityBand {
  if (!(density > 0)) return bands.find((b) => b.key === 'none') ?? bands[0];
  let pick = bands[0];
  for (const b of bands) if (b.key !== 'none' && density >= b.fromKmPerKm2) pick = b;
  return pick.key === 'none' ? bands.find((b) => b.key === 'sparse') ?? pick : pick;
}

function compassOf(deg: number): string {
  return COMPASS8[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** Merge crossings that are close along the circle into one way out (the best road of the group speaks for it). */
function mergeExits(raw: RoadDensityTotals['exits'], radiusM: number): RoadDensityExit[] {
  if (!raw.length) return [];
  const s = [...raw].sort((a, b) => a.bearingDeg - b.bearingDeg);
  const gapDeg = (EXIT_MERGE_M / (2 * Math.PI * radiusM)) * 360;
  const groups: Array<typeof s> = [];
  for (const e of s) {
    const g = groups[groups.length - 1];
    if (g && e.bearingDeg - g[g.length - 1].bearingDeg <= gapDeg) g.push(e);
    else groups.push([e]);
  }
  // The circle closes: the last group may run on into the first.
  if (groups.length > 1) {
    const first = groups[0], last = groups[groups.length - 1];
    if (first[0].bearingDeg + 360 - last[last.length - 1].bearingDeg <= gapDeg) {
      groups[0] = [...last, ...first];
      groups.pop();
    }
  }
  return groups.map((g) => {
    // Mean bearing on the circle.
    const sx = g.reduce((a, e) => a + Math.sin((e.bearingDeg * Math.PI) / 180), 0);
    const cy = g.reduce((a, e) => a + Math.cos((e.bearingDeg * Math.PI) / 180), 0);
    const bearingDeg = ((Math.atan2(sx, cy) * 180) / Math.PI + 360) % 360;
    return {
      bearingDeg,
      compass: compassOf(bearingDeg),
      allWeather: g.some((e) => e.allWeather),
      msr: g.some((e) => e.msr),
      tankable: g.some((e) => e.tankable),
    };
  }).sort((a, b) => a.bearingDeg - b.bearingDeg);
}

function dirsOf(exits: RoadDensityExit[]): string[] {
  const seen = new Set(exits.map((e) => e.compass));
  return COMPASS8.filter((c) => seen.has(c));
}

/** Turn GroundGuideRoads.densityAround sums into a reading. */
export function roadDensityReading(t: RoadDensityTotals, pending: boolean, rules?: RoadDensityRules | null): RoadDensityReading {
  const bands = roadDensityBands(rules);
  const areaKm2 = Math.PI * (t.radiusM / 1000) ** 2;
  const density = t.totalKm / areaKm2;
  const allWeatherDensity = t.allWeatherKm / areaKm2;
  const band = bandOf(density, bands);
  const allWeatherBand = bandOf(allWeatherDensity, bands);
  const rank = (b: RoadDensityBand) => bands.indexOf(b);
  const leadIsAllWeather = rank(allWeatherBand) < rank(band);
  const exits = mergeExits(t.exits, t.radiusM);
  return {
    radiusM: t.radiusM,
    areaKm2,
    totalKm: t.totalKm,
    allWeatherKm: t.allWeatherKm,
    fairKm: t.fairKm,
    msrKm: t.msrKm,
    tankableKm: t.tankableKm,
    density,
    allWeatherDensity,
    band,
    allWeatherBand,
    lead: leadIsAllWeather ? allWeatherBand : band,
    leadIsAllWeather,
    exits,
    exitDirs: dirsOf(exits),
    allWeatherExitDirs: dirsOf(exits.filter((e) => e.allWeather)),
    pending,
    bands,
  };
}

/** 0.62 -> "0.62", 1.234 -> "1.2", 0.004 -> "under 0.01". */
export function fmtDensity(d: number): string {
  if (d <= 0) return '0';
  if (d < 0.01) return 'under 0.01';
  return d < 1 ? d.toFixed(2) : d.toFixed(1);
}

function fmtKm(km: number): string {
  return km < 10 ? km.toFixed(1) : String(Math.round(km));
}

/** "2 km" / "500 m". */
export function fmtRadius(m: number): string {
  return m >= 1000 ? `${Math.round((m / 1000) * 10) / 10} km` : `${Math.round(m)} m`;
}

/** True when the all-weather density reads differently from the total (tracks or fair-weather roads make the gap). */
export function awDiffers(d: RoadDensityReading): boolean {
  return fmtDensity(d.allWeatherDensity) !== fmtDensity(d.density);
}

/** The one-line headline: "Moderate · 0.62 km/km² in 5 km (all-weather 0.41)". */
export function roadDensityHeadline(d: RoadDensityReading): string {
  if (d.band.key === 'none') return `No Rds or Trs within ${fmtRadius(d.radiusM)}`;
  // Safety first: lead with the after-rain band and its own figure when tracks lift the total a band.
  if (d.leadIsAllWeather) {
    return `${d.allWeatherBand.label} after rain · ${fmtDensity(d.allWeatherDensity)} km/km² all-weather within ${fmtRadius(d.radiusM)} (${d.band.label} with Trs, ${fmtDensity(d.density)})`;
  }
  const aw = awDiffers(d) ? ` (all-weather ${fmtDensity(d.allWeatherDensity)})` : '';
  return `${d.band.label} · ${fmtDensity(d.density)} km/km² within ${fmtRadius(d.radiusM)}${aw}`;
}

/** The route classification: "14 km all-weather · 6 km tracks · MSR 4.2 km · tankable 3.1 km". */
export function roadDensityMakeUp(d: RoadDensityReading): string | null {
  if (d.band.key === 'none') return null;
  return [
    `${fmtKm(d.allWeatherKm)} km all-weather`,
    d.fairKm > 0.05 ? `${fmtKm(d.fairKm)} km Trs / fair-weather` : null,
    d.msrKm > 0.05 ? `MSR ${fmtKm(d.msrKm)} km` : 'no MSR',
    d.tankableKm > 0.05 ? `tankable ${fmtKm(d.tankableKm)} km` : null,
  ].filter(Boolean).join(' · ');
}

/** Ways out: "6 ways out: N, NE, E, S, W (all-weather N, E)". */
export function roadDensityExitsText(d: RoadDensityReading): string | null {
  if (d.band.key === 'none' && !d.exits.length) return null;
  const n = d.exits.length;
  if (!n) return 'No Rd leaves the circle';
  const aw = d.allWeatherExitDirs.length;
  const awText = aw === d.exitDirs.length && d.exits.every((e) => e.allWeather) ? ' (all all-weather)' : aw ? ` (all-weather ${d.allWeatherExitDirs.join(', ')})` : ' (none all-weather)';
  return `${n} way${n === 1 ? '' : 's'} out: ${d.exitDirs.join(', ')}${awText}`;
}

/** What the lead band means, with the after-rain caveat when it is the all-weather band. */
export function roadDensityNote(d: RoadDensityReading): string {
  return d.leadIsAllWeather ? `After rain: ${d.lead.label.toLowerCase()}. ${d.lead.note}` : d.lead.note;
}

/** Plain-text lines (Copy as Text, hosts). */
export function roadDensityText(d: RoadDensityReading): string[] {
  return [
    `Density: ${roadDensityHeadline(d)}`,
    ...[roadDensityMakeUp(d), roadDensityExitsText(d)].filter((x): x is string => !!x).map((x) => `  ${x}`),
    `  ${roadDensityNote(d)}`,
  ];
}

/** Re-render key for the card. */
export function roadDensityKey(d: RoadDensityReading | null | undefined): string {
  if (!d) return '';
  return `${Math.round(d.density * 100)}:${Math.round(d.allWeatherDensity * 100)}:${Math.round(d.msrKm)}:${d.exits.length}:${d.exitDirs.join('')}:${d.pending ? 'p' : ''}`;
}
