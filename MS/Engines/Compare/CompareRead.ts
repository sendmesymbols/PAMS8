/**
 * CompareRead.ts
 *
 * The pure comparison (user, 2026-11-17: "Compare candidate positions or corridors ... against the same mover, season,
 * and assumptions. Show the specific differences ... with a clear explanation of how each result was calculated"). No
 * DOM, no ArcGIS, no I/O and only erasable TypeScript (tools/sitefinder-test/compare.mjs).
 *
 * Up to four alternatives, each a corridor (a line, read by SiteLine.profileLine) or a position (an area, or a point
 * read as a circle, read by SiteScan.readArea), all under one set of assumptions: the mover (rules.json profile), the
 * month (dry / after rain), the threat's place and eye height. Each row says how it was worked out; the best value in
 * a row is marked; the differences are written out as sentences. Rows where "better" has no meaning (bridges, area)
 * are shown but never ranked. No overall score: the user weighs the rows.
 */

import { areaSamples, goingRule, groundDist, pickRoad, readArea, type Season, type SiteProbe, type SiteRead, type Tone, type XY } from '../SiteScan/SiteScan';
import { fmtM, profileLine, steepFor, type LineProfile } from '../SiteScan/SiteLine';

export type AltKind = 'line' | 'area';

export interface Alt {
  /** Letter A-D. */
  id: string;
  kind: AltKind;
  pts: XY[];
  name: string;
}

export interface CompareAssumptions {
  mover: string;
  moverLabel: string;
  season: Season;
  seasonWhy: string;
  /** The threat's place (null: not read) and eye height; the height of what it looks for. */
  threat: XY | null;
  eyeM: number;
  targetM: number;
  /** Bundle data line for the "how" notes. */
  dataLine: string;
  /** The data a row reads, named with its sources and dates (SiteScan.dataCatalog); none without the bundle. */
  dataText?: (key: string) => string;
  /** Where the alternatives came from ("drawn on the map", "the selected symbols"). */
  inputText?: string;
}

export interface CompareCell {
  value: string;
  num: number | null;
  tone?: Tone;
}

export interface CompareRow {
  key: string;
  label: string;
  kind: AltKind;
  /** 'low' / 'high' is better; null: shown, not ranked. */
  better: 'low' | 'high' | null;
  cells: Record<string, CompareCell | null>;
  /** Letters with the best value (ties included); empty when not ranked or only one value. */
  best: string[];
  worst: string[];
  /** How the row was worked out. */
  how: string;
  /** Smallest difference that counts as a difference (in the row's own unit). */
  minDiff: number;
}

export interface CompareResult {
  rows: CompareRow[];
  diffs: string[];
  /** Rows each alternative is best on (ranked rows of its own kind only). */
  tally: Record<string, { best: number; of: number }>;
  lines: Record<string, LineProfile>;
  areas: Record<string, SiteRead & { areaKm2: number; seenShare: number | null; seenRead: number; roadM: number | null; roadLabel: string }>;
  notes: string[];
}

const pctS = (x: number) => `${Math.round(x * 100)}%`;
const LEVEL = ['none', 'poor', 'fair', 'good'];

/** Area of a ring in km² (ground, cos-latitude corrected). */
export function ringAreaKm2(ring: XY[]): number {
  if (ring.length < 3) return 0;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  const lat = ring.reduce((t, p) => t + p[1], 0) / ring.length;
  const s = Math.cos(2 * Math.atan(Math.exp(lat / 6378137)) - Math.PI / 2);
  return (Math.abs(a / 2) * s * s) / 1e6;
}

/** A circle ring round a point, `radiusM` on the ground. */
export function circleRing(c: XY, radiusM: number, n = 36): XY[] {
  const s = Math.cos(2 * Math.atan(Math.exp(c[1] / 6378137)) - Math.PI / 2);
  const out: XY[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    out.push([c[0] + (Math.sin(a) * radiusM) / s, c[1] + (Math.cos(a) * radiusM) / s]);
  }
  return out;
}

/** A row's smallest real difference in words: "15 m", "10 points", "1 crossing"... */
function diffWords(row: CompareRow): string {
  const d = row.minDiff;
  if (d < 1 && ['seen', 'usable', 'firm', 'wet', 'gap'].includes(row.key)) return `${Math.round(d * 100)} points`;
  switch (row.key) {
    case 'steep':
      return `${d} %`;
    case 'tilt':
      return `${d}°`;
    case 'air':
    case 'cover':
      return `${d} of a level`;
    case 'water':
    case 'rail':
      return `${d} crossing`;
    case 'people':
      return `${d} per km²`;
    default:
      return `${d} m`;
  }
}

export function compareAlts(probe: SiteProbe, rules: any, alts: Alt[], A: CompareAssumptions): CompareResult {
  const rule = goingRule(rules, A.mover, A.season);
  const onFoot = A.mover === 'dismounted' || A.mover === 'pack';
  const steep = steepFor(A.mover);
  const lines: CompareResult['lines'] = {};
  const areas: CompareResult['areas'] = {};
  const notes: string[] = [];
  const sightOk = !!(A.threat && probe.sight);
  for (const a of alts) {
    if (a.kind === 'line') {
      lines[a.id] = profileLine(probe, a.pts, rule, { stepM: 30, steepPct: steep, onFoot, sightFrom: sightOk ? { at: A.threat!, eyeM: A.eyeM, targetM: A.targetM } : null });
    } else {
      const r = readArea(probe, a.pts, rule, 60, 400);
      let seenN = 0, seenRead = 0;
      if (sightOk) {
        const pts = areaSamples(a.pts, 60, 60);
        for (const p of pts) {
          const v = probe.sight!(A.threat![0], A.threat![1], A.eyeM, p.x, p.y, A.targetM);
          if (v === null) continue;
          seenRead++;
          if (v >= 0.5) seenN++;
        }
      }
      let cx = 0, cy = 0;
      for (const p of a.pts) {
        cx += p[0];
        cy += p[1];
      }
      const c: XY = [cx / a.pts.length, cy / a.pts.length];
      const road = pickRoad(probe.roads(c[0], c[1], 3000), 1);
      areas[a.id] = { ...r, areaKm2: ringAreaKm2(a.pts), seenShare: sightOk ? (seenRead ? seenN / seenRead : null) : null, seenRead, roadM: road.road ? road.road.distM : null, roadLabel: road.label };
    }
  }

  const rows: CompareRow[] = [];
  const lineIds = alts.filter((a) => a.kind === 'line').map((a) => a.id);
  const areaIds = alts.filter((a) => a.kind === 'area').map((a) => a.id);
  const going = `for ${A.moverLabel} ${A.season === 'wet' ? 'after rain' : 'dry'} (${A.seasonWhy})`;
  const seenHow = A.threat
    ? `Chance 0.5 or more that an eye ${A.eyeM} m above the threat's place sees ${A.targetM} m above the ground, from the 30 m elevation plus trees, crops and buildings (OCOKA sight engine); places beyond one sight grid (about 25 km) are not read.`
    : 'No threat place: not read (set the Ground Guide threat marker).';

  const lineRow = (key: string, label: string, better: CompareRow['better'], minDiff: number, how: string, cell: (p: LineProfile) => CompareCell | null) => {
    if (!lineIds.length) return;
    const cells: Record<string, CompareCell | null> = {};
    for (const id of lineIds) cells[id] = cell(lines[id]);
    rows.push({ key, label, kind: 'line', better, cells, best: [], worst: [], how, minDiff });
  };
  const areaRow = (key: string, label: string, better: CompareRow['better'], minDiff: number, how: string, cell: (r: CompareResult['areas'][string]) => CompareCell | null) => {
    if (!areaIds.length) return;
    const cells: Record<string, CompareCell | null> = {};
    for (const id of areaIds) cells[id] = cell(areas[id]);
    rows.push({ key, label, kind: 'area', better, cells, best: [], worst: [], how, minDiff });
  };

  // ── corridors ───────────────────────────────────────────────────────────────────────────────────────────────────
  lineRow('length', 'Length', 'low', 100, 'Along the drawn line on the ground (Web Mercator corrected by the cosine of the latitude).', (p) => ({ value: fmtM(p.lengthM), num: p.lengthM }));
  lineRow('climb', 'Climb', 'low', 20, 'Total rise along the line from the 30 m elevation, sampled every 30 m (descent shown after the slash).', (p) => ({ value: `${Math.round(p.stats.gainM)} / ${Math.round(p.stats.lossM)} m`, num: p.stats.gainM }));
  lineRow('steep', 'Steepest', 'low', 5, `Slope along the line over a 60 m base; steep for this mover from ${steep}% (rules.json slope classes).`, (p) => ({ value: `${Math.round(p.stats.maxSlopePct)}%`, num: p.stats.maxSlopePct, tone: p.stats.maxSlopePct >= steep ? 'bad' : 'ok' }));
  lineRow('nogo', 'NO-GO', 'low', 15, `Samples every 30 m where the ground class (rules.json profile "${A.moverLabel}" NO-GO classes), the soil cone index against the mover's vehicle, or water / waterlogged ground stops the mover, ${going}.`, (p) => ({ value: p.stats.nogoM > 0 ? `${fmtM(p.stats.nogoM)} in ${p.nogo.length}` : 'none', num: p.stats.nogoM, tone: p.stats.nogoM > 0 ? 'bad' : 'ok' }));
  lineRow('slow', 'SLOW-GO', 'low', 30, `As NO-GO, for the mover's SLOW-GO classes, marginal soil and flood-prone ground after rain, ${going}.`, (p) => ({ value: p.stats.slowM > 0 ? fmtM(p.stats.slowM) : 'none', num: p.stats.slowM, tone: p.stats.slowM > 0 ? 'warn' : 'ok' }));
  lineRow('water', 'Water crossings', 'low', 1, 'Canals, drains, streams and fords crossed (a linear feature crossed in 250 m or less), from the ground class along the line.', (p) => {
    const c = p.stats.crossings;
    const n = (c.canal ?? 0) + (c.drain ?? 0) + (c.river ?? 0) + (c.ford ?? 0);
    const parts = [c.canal ? `${c.canal} canal` : '', c.drain ? `${c.drain} drain` : '', c.river ? `${c.river} stream` : '', c.ford ? `${c.ford} ford` : ''].filter(Boolean);
    return { value: n ? `${n} (${parts.join(', ')})` : 'none', num: n };
  });
  lineRow('bridges', 'Bridges', null, 1, 'Bridges on the line (ground class): the load class where it is recorded. A bridge is a way over, not a fault; one with no class recorded needs a recce.', (p) => {
    const br = p.events.filter((e) => e.kind === 'bridge' || e.kind === 'railBridge' || e.kind === 'footBridge');
    const unk = br.filter((e) => e.cls === 42).length;
    return { value: br.length ? `${br.length}${unk ? ` (${unk} cl not recorded)` : ''}` : 'none', num: br.length, tone: unk ? 'warn' : undefined };
  });
  lineRow('rail', 'Rly crossings', 'low', 1, 'Railway lines crossed (ground class 28; vehicles cross at level crossings or bridges only).', (p) => ({ value: String(p.stats.crossings.rail ?? 0), num: p.stats.crossings.rail ?? 0 }));
  lineRow('bua', 'Through BUA', 'low', 100, 'Length of the line in built-up area (ground class 3).', (p) => {
    const m = p.events.filter((e) => e.kind === 'bua').reduce((t, e) => t + (e.toM - e.fromM), 0);
    return { value: m > 0 ? fmtM(m) : 'none', num: m };
  });
  lineRow('seen', 'Seen by threat', 'low', 0.1, seenHow, (p) => (p.stats.seenShare === null ? null : { value: `${pctS(p.stats.seenShare)} of the line`, num: p.stats.seenShare, tone: p.stats.seenShare > 0.5 ? 'warn' : 'ok' }));
  lineRow('gap', 'No data', 'low', 60, 'Stretches with no elevation or no ground class in the terrain bundle (outside its cover or not built there).', (p) => ({ value: p.stats.gapM > 1 ? fmtM(p.stats.gapM) : 'none', num: p.stats.gapM, tone: p.stats.gapM > 1 ? 'warn' : 'ok' }));

  // ── positions ───────────────────────────────────────────────────────────────────────────────────────────────────
  areaRow('size', 'Area', null, 0.05, 'Size of the drawn area (a point is read as a circle of the set radius).', (r) => ({ value: `${r.areaKm2 < 1 ? r.areaKm2.toFixed(2) : r.areaKm2.toFixed(1)} km²`, num: r.areaKm2 }));
  areaRow('usable', 'Usable Gr', 'high', 0.1, `Share of grid samples (60 m apart, at most 400) not NO-GO for ${A.moverLabel} by ground class.`, (r) => (r.known ? { value: pctS(1 - r.nogo), num: 1 - r.nogo, tone: r.nogo > 0.3 ? 'bad' : r.nogo > 0.1 ? 'warn' : 'ok' } : null));
  areaRow('tilt', 'Tilt', 'low', 1, 'Tilt of a plane fitted to the 30 m elevations of the samples, and the relief (highest less lowest).', (r) => (r.tiltDeg === null ? null : { value: `${r.tiltDeg.toFixed(1)}°, ${Math.round(r.reliefM ?? 0)} m relief`, num: r.tiltDeg }));
  areaRow('firm', 'Firm', 'high', 0.1, `Share of samples whose soil cone index ${A.season === 'wet' ? 'after rain' : 'dry'} carries the mover's vehicle at least once (rules.json soilStrength).`, (r) => (r.soilKnown ? { value: pctS(1 - r.softNogo), num: 1 - r.softNogo, tone: r.softNogo > 0.2 ? 'bad' : r.softNogo > 0 ? 'warn' : 'ok' } : null));
  areaRow('wet', 'Wet / flood', 'low', 0.1, `Share of samples under water or waterlogged${A.season === 'wet' ? ', plus seasonal water and riverbed in a wet month' : ''} (wet layer); flood-prone shown separately.`, (r) => (r.wetKnown ? { value: `${pctS(r.wetBad)}${r.floodProne > 0 ? ` (+${pctS(r.floodProne)} flood-prone)` : ''}`, num: r.wetBad + (A.season === 'wet' ? r.floodProne : 0), tone: r.wetBad > 0.05 ? 'bad' : r.floodProne > 0 ? 'warn' : 'ok' } : null));
  areaRow('air', 'Hidden from air', 'high', 0.3, 'Mean concealment from the air over the samples (cc layer, 0 none to 3 good, from land cover).', (r) => (r.concealMean === null ? null : { value: `${LEVEL[Math.max(0, Math.min(3, Math.round(r.concealMean)))]} (${r.concealMean.toFixed(1)})`, num: r.concealMean }));
  areaRow('cover', 'Cover from fire', 'high', 0.3, 'Mean cover from fire over the samples (cc layer, 0 none to 3 good: bunds, banks, buildings, broken ground).', (r) => (r.coverMean === null ? null : { value: `${LEVEL[Math.max(0, Math.min(3, Math.round(r.coverMean)))]} (${r.coverMean.toFixed(1)})`, num: r.coverMean }));
  areaRow('road', 'Rd from centre', 'low', 150, 'Nearest road from the centre of the area (road network; load class where recorded).', (r) => (r.roadM === null ? { value: 'none within 3 km', num: 3000, tone: 'bad' } : { value: `${fmtM(r.roadM)} (${r.roadLabel})`, num: r.roadM }));
  areaRow('seen', 'Seen by threat', 'low', 0.1, seenHow, (r) => (r.seenShare === null ? null : { value: `${pctS(r.seenShare)} of the area`, num: r.seenShare, tone: r.seenShare > 0.5 ? 'warn' : 'ok' }));
  areaRow('people', 'People', 'low', 200, 'Mean people per km² over the samples (WorldPop 2026 estimate, 1 km grid).', (r) => (r.peopleKm2 === null ? null : { value: `${Math.round(r.peopleKm2).toLocaleString('en-US')} / km²`, num: r.peopleKm2 }));
  areaRow('gap', 'No data', 'low', 0.1, 'Share of samples with no ground class in the terrain bundle.', (r) => ({ value: r.n ? pctS(1 - r.known / r.n) : 'none', num: r.n ? 1 - r.known / r.n : 0, tone: r.known < r.n ? 'warn' : 'ok' }));

  // every row says what data it read and when a difference counts (nothing hidden)
  const ROW_DATA: Record<string, string[]> = {
    'line:length': [], 'line:climb': ['elev'], 'line:steep': ['elev'], 'line:nogo': ['class', 'rci', 'wet'], 'line:slow': ['class', 'rci', 'wet'],
    'line:water': ['class'], 'line:bridges': ['class'], 'line:rail': ['class'], 'line:bua': ['class'], 'line:seen': ['elev', 'class', 'bld'], 'line:gap': ['class', 'elev'],
    'area:size': [], 'area:usable': ['class'], 'area:tilt': ['elev'], 'area:firm': ['rci'], 'area:wet': ['wet'], 'area:air': ['cc'], 'area:cover': ['cc'],
    'area:road': ['network'], 'area:seen': ['elev', 'class', 'bld'], 'area:people': ['population'], 'area:gap': ['class'],
  };
  for (const row of rows) {
    const keys = ROW_DATA[`${row.kind}:${row.key}`] ?? [];
    const data = keys.length && A.dataText ? ` Data: ${keys.map((k) => A.dataText!(k)).join('; ')}.` : '';
    const input = A.inputText ? ` The ${row.kind === 'line' ? 'corridors' : 'positions'}: ${A.inputText}.` : '';
    const unit = diffWords(row);
    const rank = row.better ? ` Ranked only when the alternatives differ by more than ${unit} (proposal, CompareRead.ts).` : ' Shown, not ranked.';
    row.how = `${row.how}${rank}${data}${input}`;
  }

  // best / worst per ranked row
  for (const row of rows) {
    if (!row.better) continue;
    const vals = Object.entries(row.cells).filter(([, c]) => c && c.num !== null && Number.isFinite(c.num)) as Array<[string, CompareCell]>;
    if (vals.length < 2) continue;
    const nums = vals.map(([, c]) => c.num as number);
    const bestV = row.better === 'low' ? Math.min(...nums) : Math.max(...nums);
    const worstV = row.better === 'low' ? Math.max(...nums) : Math.min(...nums);
    if (Math.abs(bestV - worstV) < row.minDiff) continue; // no real difference: nobody is best
    row.best = vals.filter(([, c]) => Math.abs((c.num as number) - bestV) < row.minDiff / 2).map(([id]) => id);
    row.worst = vals.filter(([, c]) => Math.abs((c.num as number) - worstV) < row.minDiff / 2).map(([id]) => id);
  }

  // differences in words
  const diffs: string[] = [];
  for (const row of rows) {
    if (!row.best.length || !row.worst.length) continue;
    const list = Object.entries(row.cells)
      .filter(([, c]) => c)
      .map(([id, c]) => `${id} ${c!.value}`)
      .join(' · ');
    diffs.push(`${row.label}: ${list}. Best ${row.best.join(', ')}; worst ${row.worst.join(', ')}.`);
  }
  if (!diffs.length && alts.length > 1) diffs.push('No row differs by more than its smallest real difference: on this data the alternatives read alike.');

  const tally: CompareResult['tally'] = {};
  for (const a of alts) {
    const own = rows.filter((r) => r.kind === a.kind && r.better && r.best.length + r.worst.length > 0);
    tally[a.id] = { best: own.filter((r) => r.best.includes(a.id)).length, of: own.length };
  }
  if (lineIds.length && areaIds.length) notes.push('Corridors and positions are compared each among their own kind.');
  if (lineIds.length === 1 && areaIds.length <= 1 && alts.length > 1) notes.push('One corridor and one position: each is read, but nothing is ranked (rank needs two of a kind).');
  return { rows, diffs, tally, lines, areas, notes };
}

/** Ground length of a path, for the chips. */
export function altLength(pts: XY[]): number {
  let L = 0;
  for (let i = 0; i + 1 < pts.length; i++) L += groundDist(pts[i], pts[i + 1]);
  return L;
}
