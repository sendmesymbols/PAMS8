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
 *
 * 18 Nov 2026: a cell is a short value plus a second line (`sub`: "3 stretches", the road's name); a row keeps its
 * method, its ranking rule and the data it read apart (`method`, `rank`, `dataKeys`) so the panel shows each once; each
 * alternative carries what to check first (`flags`: NO-GO on the line, steep, soft or wet ground, no road); "seen by
 * threat" with no threat set is shown as such and not ranked.
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
  /** Where the alternatives came from ("drawn on the map", "the selected symbols"): one text, or one per kind. */
  inputText?: string | ((kind: AltKind) => string);
}

export interface CompareCell {
  /** The value in few words ("300 m", "good", "none"). */
  value: string;
  /** What goes with it on a second line ("3 stretches", "Sialkot - Pasrur, cl 60"). */
  sub?: string;
  num: number | null;
  tone?: Tone;
}

/** A cell in one line: the value with its second line in brackets. */
export function cellText(c: CompareCell | null | undefined): string {
  return c ? (c.sub ? `${c.value} (${c.sub})` : c.value) : 'not read';
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
  /** How the row was worked out, in full: the method, when a difference counts, the data read, the inputs. */
  how: string;
  /** The method alone. */
  method: string;
  /** When a difference counts ("Ranked only when ..."), or "Shown, not ranked." */
  rank: string;
  /** The bundle data the row read (SiteScan.dataCatalog keys). */
  dataKeys: string[];
  /** Smallest difference that counts as a difference (in the row's own unit). */
  minDiff: number;
  /** Best to worst in the row's own unit ("2.0 km", "2 crossings"); empty when the row is not ranked. */
  delta: string;
}

/** Something to check first on an alternative: a stopper (bad) or a caution (warn). */
export interface CompareFlag {
  tone: 'bad' | 'warn';
  /** The row it comes from. */
  key: string;
  text: string;
}

export interface CompareResult {
  rows: CompareRow[];
  diffs: string[];
  /** Rows each alternative is best on (ranked rows of its own kind only). */
  tally: Record<string, { best: number; of: number }>;
  /** What to check first on each alternative (NO-GO on the line, steep, soft or wet ground, no road, no data). */
  flags: Record<string, CompareFlag[]>;
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

/** Centre of a ring by area (the mean of its points when it has no area). */
export function ringCentroid(ring: XY[]): XY {
  if (!ring.length) return [0, 0];
  let a = 0, cx = 0, cy = 0, mx = 0, my = 0;
  const x0 = ring[0][0], y0 = ring[0][1];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    // relative to the first point: Web Mercator metres are large numbers
    const ax = ring[j][0] - x0, ay = ring[j][1] - y0, bx = ring[i][0] - x0, by = ring[i][1] - y0;
    const f = ax * by - bx * ay;
    a += f;
    cx += (ax + bx) * f;
    cy += (ay + by) * f;
    mx += ring[i][0];
    my += ring[i][1];
  }
  if (Math.abs(a) < 1e-6) return [mx / ring.length, my / ring.length];
  return [x0 + cx / (3 * a), y0 + cy / (3 * a)];
}

/** A difference in the row's own unit: "2.0 km", "2 crossings", "20 points". */
function deltaWords(row: CompareRow, d: number): string {
  switch (row.key) {
    case 'climb':
      return `${Math.round(d)} m`;
    case 'steep':
      return `${Math.round(d)} %`;
    case 'tilt':
      return `${d.toFixed(1)}°`;
    case 'water':
    case 'rail':
      return `${Math.round(d)} crossing${Math.round(d) === 1 ? '' : 's'}`;
    case 'seen':
    case 'usable':
    case 'firm':
    case 'wet':
      return `${Math.round(d * 100)} points`;
    case 'air':
    case 'cover':
      return `${d.toFixed(1)} of a level`;
    case 'people':
      return `${Math.round(d).toLocaleString('en-US')} per km²`;
    case 'gap':
      return row.kind === 'line' ? fmtM(d) : `${Math.round(d * 100)} points`;
    default:
      return fmtM(d);
  }
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
      const c = ringCentroid(a.pts);
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

  // no threat place: said so in the cell, and the row is not ranked
  const NO_THREAT: CompareCell = { value: 'threat not set', num: null, tone: 'unknown' };

  const lineRow = (key: string, label: string, better: CompareRow['better'], minDiff: number, how: string, cell: (p: LineProfile) => CompareCell | null) => {
    if (!lineIds.length) return;
    const cells: Record<string, CompareCell | null> = {};
    for (const id of lineIds) cells[id] = cell(lines[id]);
    rows.push({ key, label, kind: 'line', better, cells, best: [], worst: [], how, method: how, rank: '', dataKeys: [], minDiff, delta: '' });
  };
  const areaRow = (key: string, label: string, better: CompareRow['better'], minDiff: number, how: string, cell: (r: CompareResult['areas'][string]) => CompareCell | null) => {
    if (!areaIds.length) return;
    const cells: Record<string, CompareCell | null> = {};
    for (const id of areaIds) cells[id] = cell(areas[id]);
    rows.push({ key, label, kind: 'area', better, cells, best: [], worst: [], how, method: how, rank: '', dataKeys: [], minDiff, delta: '' });
  };

  // ── corridors ───────────────────────────────────────────────────────────────────────────────────────────────────
  lineRow('length', 'Length', 'low', 100, 'Along the drawn line on the ground (Web Mercator corrected by the cosine of the latitude).', (p) => ({ value: fmtM(p.lengthM), num: p.lengthM }));
  lineRow('climb', 'Climb', 'low', 20, 'Total rise along the line from the 30 m elevation, sampled every 30 m and counted in 3 m steps; the descent is shown under it.', (p) => ({ value: `${Math.round(p.stats.gainM)} m`, sub: `down ${Math.round(p.stats.lossM)} m`, num: p.stats.gainM }));
  lineRow('steep', 'Steepest', 'low', 5, `Slope along the line over a 60 m base; steep for this mover from ${steep}% (rules.json slope classes).`, (p) => ({ value: `${Math.round(p.stats.maxSlopePct)}%`, num: p.stats.maxSlopePct, tone: p.stats.maxSlopePct >= steep ? 'bad' : 'ok' }));
  lineRow('nogo', 'NO-GO', 'low', 15, `Samples every 30 m where the ground class (rules.json profile "${A.moverLabel}" NO-GO classes), the soil cone index against the mover's vehicle, or water / waterlogged ground stops the mover, ${going}.`, (p) => (p.stats.nogoM > 0 ? { value: fmtM(p.stats.nogoM), sub: `${p.nogo.length} stretch${p.nogo.length === 1 ? '' : 'es'}`, num: p.stats.nogoM, tone: 'bad' } : { value: 'none', num: 0, tone: 'ok' }));
  lineRow('slow', 'SLOW-GO', 'low', 30, `As NO-GO, for the mover's SLOW-GO classes, marginal soil and flood-prone ground after rain, ${going}.`, (p) => ({ value: p.stats.slowM > 0 ? fmtM(p.stats.slowM) : 'none', num: p.stats.slowM, tone: p.stats.slowM > 0 ? 'warn' : 'ok' }));
  lineRow('water', 'Water crossings', 'low', 1, 'Canals, drains, streams and fords crossed (a linear feature crossed in 250 m or less), from the ground class along the line.', (p) => {
    const c = p.stats.crossings;
    const n = (c.canal ?? 0) + (c.drain ?? 0) + (c.river ?? 0) + (c.ford ?? 0);
    const parts = [c.canal ? `${c.canal} canal` : '', c.drain ? `${c.drain} drain` : '', c.river ? `${c.river} stream` : '', c.ford ? `${c.ford} ford` : ''].filter(Boolean);
    return n ? { value: String(n), sub: parts.join(', '), num: n } : { value: 'none', num: 0 };
  });
  lineRow('bridges', 'Bridges', null, 1, 'Bridges on the line (ground class): the load class where it is recorded. A bridge is a way over, not a fault; one with no class recorded needs a recce.', (p) => {
    const br = p.events.filter((e) => e.kind === 'bridge' || e.kind === 'railBridge' || e.kind === 'footBridge');
    const unk = br.filter((e) => e.cls === 42).length;
    return br.length ? { value: String(br.length), sub: unk ? `${unk} cl not recorded` : undefined, num: br.length, tone: unk ? 'warn' : undefined } : { value: 'none', num: 0 };
  });
  lineRow('rail', 'Rly crossings', 'low', 1, 'Railway lines crossed (ground class 28; vehicles cross at level crossings or bridges only).', (p) => ({ value: String(p.stats.crossings.rail ?? 0), num: p.stats.crossings.rail ?? 0 }));
  lineRow('bua', 'Through BUA', 'low', 100, 'Length of the line in built-up area (ground class 3).', (p) => {
    const m = p.events.filter((e) => e.kind === 'bua').reduce((t, e) => t + (e.toM - e.fromM), 0);
    return { value: m > 0 ? fmtM(m) : 'none', num: m };
  });
  lineRow('seen', 'Seen by threat', A.threat ? 'low' : null, 0.1, seenHow, (p) => (!A.threat ? NO_THREAT : p.stats.seenShare === null ? null : { value: pctS(p.stats.seenShare), sub: 'of the line', num: p.stats.seenShare, tone: p.stats.seenShare > 0.5 ? 'warn' : 'ok' }));
  lineRow('gap', 'No data', 'low', 60, 'Stretches with no elevation or no ground class in the terrain bundle (outside its cover or not built there).', (p) => ({ value: p.stats.gapM > 1 ? fmtM(p.stats.gapM) : 'none', num: p.stats.gapM, tone: p.stats.gapM > 1 ? 'warn' : 'ok' }));

  // ── positions ───────────────────────────────────────────────────────────────────────────────────────────────────
  areaRow('size', 'Area', null, 0.05, 'Size of the drawn area (a point is read as a circle of the set radius).', (r) => ({ value: `${r.areaKm2 < 1 ? r.areaKm2.toFixed(2) : r.areaKm2.toFixed(1)} km²`, num: r.areaKm2 }));
  areaRow('usable', 'Usable Gr', 'high', 0.1, `Share of grid samples (60 m apart, at most 400) not NO-GO for ${A.moverLabel} by ground class.`, (r) => (r.known ? { value: pctS(1 - r.nogo), num: 1 - r.nogo, tone: r.nogo > 0.3 ? 'bad' : r.nogo > 0.1 ? 'warn' : 'ok' } : null));
  areaRow('tilt', 'Tilt', 'low', 1, 'Tilt of a plane fitted to the 30 m elevations of the samples, and the relief (highest less lowest).', (r) => (r.tiltDeg === null ? null : { value: `${r.tiltDeg.toFixed(1)}°`, sub: `${Math.round(r.reliefM ?? 0)} m relief`, num: r.tiltDeg }));
  areaRow('firm', 'Firm', 'high', 0.1, `Share of samples whose soil cone index ${A.season === 'wet' ? 'after rain' : 'dry'} carries the mover's vehicle at least once (rules.json soilStrength).`, (r) => (r.soilKnown ? { value: pctS(1 - r.softNogo), num: 1 - r.softNogo, tone: r.softNogo > 0.2 ? 'bad' : r.softNogo > 0 ? 'warn' : 'ok' } : null));
  areaRow('wet', 'Wet / flood', 'low', 0.1, `Share of samples under water or waterlogged${A.season === 'wet' ? ', plus seasonal water and riverbed in a wet month' : ''} (wet layer); flood-prone shown separately.`, (r) => (r.wetKnown ? { value: pctS(r.wetBad), sub: r.floodProne > 0 ? `+${pctS(r.floodProne)} flood-prone` : undefined, num: r.wetBad + (A.season === 'wet' ? r.floodProne : 0), tone: r.wetBad > 0.05 ? 'bad' : r.floodProne > 0 ? 'warn' : 'ok' } : null));
  areaRow('air', 'Hidden from air', 'high', 0.3, 'Mean concealment from the air over the samples (cc layer, 0 none to 3 good, from land cover).', (r) => (r.concealMean === null ? null : { value: LEVEL[Math.max(0, Math.min(3, Math.round(r.concealMean)))], sub: `${r.concealMean.toFixed(1)} of 3`, num: r.concealMean }));
  areaRow('cover', 'Cover from fire', 'high', 0.3, 'Mean cover from fire over the samples (cc layer, 0 none to 3 good: bunds, banks, buildings, broken ground).', (r) => (r.coverMean === null ? null : { value: LEVEL[Math.max(0, Math.min(3, Math.round(r.coverMean)))], sub: `${r.coverMean.toFixed(1)} of 3`, num: r.coverMean }));
  areaRow('road', 'Rd from centre', 'low', 150, 'Nearest road from the centre of the area (road network; load class where recorded).', (r) => (r.roadM === null ? { value: 'none', sub: 'within 3 km', num: 3000, tone: 'bad' } : { value: fmtM(r.roadM), sub: r.roadLabel || undefined, num: r.roadM }));
  areaRow('seen', 'Seen by threat', A.threat ? 'low' : null, 0.1, seenHow, (r) => (!A.threat ? NO_THREAT : r.seenShare === null ? null : { value: pctS(r.seenShare), sub: 'of the area', num: r.seenShare, tone: r.seenShare > 0.5 ? 'warn' : 'ok' }));
  areaRow('people', 'People', 'low', 200, 'Mean people per km² over the samples (WorldPop 2026 estimate, 1 km grid).', (r) => (r.peopleKm2 === null ? null : { value: `${Math.round(r.peopleKm2).toLocaleString('en-US')} / km²`, num: r.peopleKm2 }));
  areaRow('gap', 'No data', 'low', 0.1, 'Share of samples with no ground class in the terrain bundle.', (r) => (r.n && r.known < r.n ? { value: pctS(1 - r.known / r.n), num: 1 - r.known / r.n, tone: 'warn' } : { value: 'none', num: 0, tone: 'ok' }));

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
    const inText = typeof A.inputText === 'function' ? A.inputText(row.kind) : A.inputText;
    const input = inText ? ` The ${row.kind === 'line' ? 'corridors' : 'positions'}: ${inText}.` : '';
    row.dataKeys = keys;
    // a row is ranked from its smallest real difference up (0 against 1 crossing is a difference)
    row.rank = row.better ? `Ranked only when the alternatives differ by ${diffWords(row)} or more (proposal, CompareRead.ts).` : 'Shown, not ranked.';
    row.how = `${row.method} ${row.rank}${data}${input}`;
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
    row.delta = deltaWords(row, Math.abs(bestV - worstV));
  }

  // differences in words: each alternative from the best to the worst, and how far apart the two ends are
  const diffs: string[] = [];
  for (const row of rows) {
    if (!row.best.length || !row.worst.length) continue;
    const sign = row.better === 'high' ? -1 : 1;
    const list = (Object.entries(row.cells).filter(([, c]) => c) as Array<[string, CompareCell]>)
      .sort((a, b) => (a[1].num === null ? 1 : b[1].num === null ? -1 : sign * (a[1].num - b[1].num)))
      .map(([id, c]) => `${id} ${cellText(c)}${row.best.includes(id) ? ' best' : row.worst.includes(id) ? ' worst' : ''}`)
      .join(', ');
    diffs.push(`${row.label}: ${list} (${row.delta} apart).`);
  }
  // "read alike" is only true of a kind that has two or more to rank
  if (!diffs.length && (lineIds.length > 1 || areaIds.length > 1)) diffs.push('No row differs by more than its smallest real difference: on this data the alternatives read alike.');

  // what to check first on each alternative: every cell toned bad, the NO-GO with what stops the mover, and no data
  const flags: CompareResult['flags'] = {};
  for (const a of alts) {
    const out: CompareFlag[] = [];
    for (const row of rows) {
      if (row.kind !== a.kind) continue;
      const c = row.cells[a.id];
      if (!c) continue;
      if (c.tone === 'bad') {
        let text = `${row.label} ${cellText(c)}`;
        if (row.key === 'nogo' && a.kind === 'line') {
          const why = [...new Set(lines[a.id].nogo.map((x) => x.why))].slice(0, 3);
          if (why.length) text += `: ${why.join(', ')}`;
        } else if (row.key === 'steep') text += ` (steep for this mover from ${steep}%)`;
        out.push({ tone: 'bad', key: row.key, text });
      } else if (c.tone === 'warn' && (row.key === 'gap' || row.key === 'bridges')) {
        out.push({ tone: 'warn', key: row.key, text: row.key === 'bridges' ? `Br ${c.sub ?? c.value}: recce` : `No data ${cellText(c)}` });
      }
    }
    flags[a.id] = out;
  }

  const tally: CompareResult['tally'] = {};
  for (const a of alts) {
    const own = rows.filter((r) => r.kind === a.kind && r.better && r.best.length + r.worst.length > 0);
    tally[a.id] = { best: own.filter((r) => r.best.includes(a.id)).length, of: own.length };
  }
  if (lineIds.length && areaIds.length) notes.push('Corridors and positions are compared each among their own kind.');
  if (lineIds.length === 1 && areaIds.length <= 1 && alts.length > 1) notes.push('One corridor and one position: each is read, but nothing is ranked (rank needs two of a kind).');
  return { rows, diffs, tally, flags, lines, areas, notes };
}

/** Ground length of a path, for the chips. */
export function altLength(pts: XY[]): number {
  let L = 0;
  for (let i = 0; i + 1 < pts.length; i++) L += groundDist(pts[i], pts[i + 1]);
  return L;
}
