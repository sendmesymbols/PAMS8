/**
 * SiteLine.ts
 *
 * The pure line reader the cross-section and the comparison share (X-Section, Compare). No DOM, no ArcGIS, no I/O and
 * only erasable TypeScript, so Node runs it (tools/sitefinder-test/line.mjs). A line (Web Mercator points) is walked on
 * the ground in even steps; at each sample the terrain bundle gives the height (30 m elevation), the ground class and
 * the wet layer and, for the mover and the season, the going:
 *
 *   going    the worst of the class (rules.json profile: NO-GO / SLOW-GO), the season's soil cone index against the
 *            mover's vehicle, and the wet layer (water and, after rain, waterlogged ground stop vehicles; flood-prone
 *            and riverbed ground slow everyone);
 *   runs     consecutive samples of one class, with the obstacle words for the classes that matter to a move
 *            (canal, drain, river, railway, road, bridge, ford, BUA, bund, cutting, cliff, wall, dunes, forest, nullah):
 *            a short run across a linear feature is a crossing, a long one is "along";
 *   slope    along the line over a 60 m base, with the steep stretches;
 *   gaps     stretches with no elevation or no ground class (no data, or tiles not loaded yet: the probe's pending flag
 *            tells which);
 *   seen     (when a threat is given) the chance the threat sees each sample, from the OCOKA sight engine, and the
 *            stretches seen.
 *
 * What the bundle cannot read is a gap, never GO.
 */

import { groundDist, offsetPt, bearingOf, type GroundRule, type SiteProbe, type XY } from './SiteScan';

export type Going = 'go' | 'slow' | 'nogo';

export interface LineSample {
  /** Chainage from the start, ground metres. */
  m: number;
  x: number;
  y: number;
  elev: number;
  cls: number | null;
  wet: number | null;
  going: Going | null;
  /** Why the going is not GO: 'class' | 'soil' | 'wet'. */
  why: 'class' | 'soil' | 'wet' | null;
  /** Slope along the line, percent, signed (uphill positive), over a 60 m base; null where heights are missing. */
  slopePct: number | null;
  /** Chance the threat sees the sample (0-1), when a threat is given and the sight could be read. */
  seen: number | null;
}

export interface LineRun {
  fromM: number;
  toM: number;
  cls: number | null;
  going: Going | null;
}

export type ObstacleKind =
  | 'canal' | 'drain' | 'river' | 'water' | 'marsh' | 'rail' | 'road' | 'bridge' | 'footBridge' | 'railBridge' | 'ford'
  | 'bua' | 'bund' | 'cutting' | 'cliff' | 'wall' | 'dunes' | 'forest' | 'nullah' | 'steep';

export interface LineEvent {
  kind: ObstacleKind;
  fromM: number;
  toM: number;
  /** Mid chainage. */
  m: number;
  /** A crossing (short, across a linear feature) or a stretch along it. */
  mode: 'cross' | 'along' | 'in';
  cls: number | null;
  going: Going | null;
  /** Short words for the chart and the text ("Canal 40 m", "Br cl not recorded", "BUA 600 m"). */
  label: string;
}

export interface LineStretch {
  fromM: number;
  toM: number;
  why: string;
}

export interface LineProfile {
  lengthM: number;
  stepM: number;
  samples: LineSample[];
  runs: LineRun[];
  events: LineEvent[];
  /** No-data stretches: what is missing there. */
  gaps: Array<{ fromM: number; toM: number; what: 'elev' | 'class' | 'both' }>;
  nogo: LineStretch[];
  steep: LineStretch[];
  seenStretches: LineStretch[];
  stats: {
    gainM: number;
    lossM: number;
    minElev: number | null;
    maxElev: number | null;
    maxSlopePct: number;
    maxSlopeAtM: number;
    goM: number;
    slowM: number;
    nogoM: number;
    unknownM: number;
    gapM: number;
    /** Share of the line the threat sees (chance 0.5 or more), of the samples read; null without a threat. */
    seenShare: number | null;
    seenRead: number;
    crossings: Partial<Record<ObstacleKind, number>>;
  };
}

/** Class codes (rules.json classes) to obstacle words. Linear features first: a short run across them is a crossing. */
const CLASS_KIND: Record<number, { kind: ObstacleKind; linear: boolean; word: string }> = {
  20: { kind: 'canal', linear: true, word: 'Canal' },
  21: { kind: 'canal', linear: true, word: 'Minor canal' },
  22: { kind: 'drain', linear: true, word: 'Drain' },
  4: { kind: 'water', linear: false, word: 'Water' },
  5: { kind: 'water', linear: false, word: 'Seasonal water' },
  46: { kind: 'river', linear: true, word: 'Stream' },
  6: { kind: 'marsh', linear: false, word: 'Marsh' },
  28: { kind: 'rail', linear: true, word: 'Rly' },
  34: { kind: 'road', linear: true, word: 'Rd cl 60+' },
  35: { kind: 'road', linear: true, word: 'Rd cl 50-59' },
  36: { kind: 'road', linear: true, word: 'Rd below cl 50' },
  37: { kind: 'road', linear: true, word: 'Rd cl not recorded' },
  38: { kind: 'road', linear: true, word: 'Unmetalled Rd' },
  39: { kind: 'bridge', linear: true, word: 'Br cl 60+' },
  40: { kind: 'bridge', linear: true, word: 'Br cl 50-59' },
  41: { kind: 'bridge', linear: true, word: 'Br below cl 50' },
  42: { kind: 'bridge', linear: true, word: 'Br cl not recorded' },
  43: { kind: 'railBridge', linear: true, word: 'Rly Br' },
  44: { kind: 'footBridge', linear: true, word: 'Foot Br' },
  45: { kind: 'ford', linear: true, word: 'Ford / ferry' },
  3: { kind: 'bua', linear: false, word: 'BUA' },
  24: { kind: 'bund', linear: true, word: 'Bund over 2 m' },
  25: { kind: 'bund', linear: true, word: 'Bund' },
  26: { kind: 'cutting', linear: true, word: 'Cutting' },
  27: { kind: 'cliff', linear: true, word: 'Cliff' },
  49: { kind: 'wall', linear: true, word: 'Wall / fence' },
  14: { kind: 'dunes', linear: false, word: 'Dunes' },
  31: { kind: 'forest', linear: false, word: 'Forest' },
  17: { kind: 'nullah', linear: true, word: 'Dry nullah' },
  47: { kind: 'nullah', linear: true, word: 'Dry nullah' },
};

export const OBSTACLE_WORD: Record<ObstacleKind, string> = {
  canal: 'Canal', drain: 'Drain', river: 'Stream', water: 'Water', marsh: 'Marsh', rail: 'Rly', road: 'Rd', bridge: 'Br',
  footBridge: 'Foot Br', railBridge: 'Rly Br', ford: 'Ford', bua: 'BUA', bund: 'Bund', cutting: 'Cutting', cliff: 'Cliff',
  wall: 'Wall', dunes: 'Dunes', forest: 'Forest', nullah: 'Nullah', steep: 'Steep',
};

/** A linear feature crossed in less than this is a crossing; more is a stretch along it. */
const CROSS_MAX_M = 250;
/** Climb is counted in steps of at least this (m): about the vertical noise of the GLO-30 elevation. */
export const CLIMB_STEP_M = 3;

const RANK: Record<Going, number> = { go: 0, slow: 1, nogo: 2 };

export interface LineOpts {
  /** Sample spacing (m); widened to keep under `maxSamples`. */
  stepM?: number;
  maxSamples?: number;
  /** Slope at or over this (percent) is steep for the mover. */
  steepPct?: number;
  /** The threat's eye: where and how high; the target height above the ground on the line. */
  sightFrom?: { at: XY; eyeM: number; targetM: number } | null;
  /** At most this many sight reads (spread evenly). */
  maxSight?: number;
  /** Mover on foot: waterlogged ground slows rather than stops. */
  onFoot?: boolean;
}

/** Points every `stepM` along a path (ground metres), with chainage. */
export function walkPath(path: XY[], stepM: number): Array<{ p: XY; m: number }> {
  const out: Array<{ p: XY; m: number }> = [];
  if (path.length < 2) return out;
  let m = 0;
  out.push({ p: path[0], m: 0 });
  let carry = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1];
    const L = groundDist(a, b);
    if (!(L > 0)) continue;
    const brg = bearingOf(a, b);
    let d = stepM - carry;
    while (d < L) {
      out.push({ p: offsetPt(a[0], a[1], brg, d), m: m + d });
      d += stepM;
    }
    carry = L - (d - stepM);
    m += L;
  }
  const last = path[path.length - 1];
  if (out[out.length - 1].m < m - 0.5) out.push({ p: last, m });
  return out;
}

export function pathLength(path: XY[]): number {
  let L = 0;
  for (let i = 0; i + 1 < path.length; i++) L += groundDist(path[i], path[i + 1]);
  return L;
}

/** Read a line on the ground for a mover in a season. */
export function profileLine(probe: SiteProbe, path: XY[], rule: GroundRule, o: LineOpts = {}): LineProfile {
  const lengthM = pathLength(path);
  const maxSamples = o.maxSamples ?? 1500;
  const stepM = Math.max(o.stepM ?? 30, lengthM / maxSamples);
  const pts = walkPath(path, stepM);
  const rciKey = rule.season === 'wet' ? 'rci_wet' : 'rci_dry';
  const samples: LineSample[] = pts.map(({ p, m }) => {
    const elev = probe.elev(p[0], p[1]);
    const cls = probe.cls(p[0], p[1]);
    const w = probe.layer('wet', p[0], p[1]);
    const wet = w === null || w === 255 ? null : w;
    let going: Going | null = null;
    let why: LineSample['why'] = null;
    if (cls !== null && cls !== 255) {
      going = rule.nogo[cls] ? 'nogo' : rule.caution[cls] ? 'slow' : 'go';
      if (going !== 'go') why = 'class';
      if (rule.soil) {
        const r = probe.layer(rciKey, p[0], p[1]);
        if (r !== null && r !== 255) {
          const ci = r & 127, coarse = (r & 128) !== 0;
          const [v1, v50] = coarse ? rule.soil.coarse : rule.soil.fine;
          const s: Going = ci >= v50 ? 'go' : ci >= v1 ? 'slow' : 'nogo';
          if (RANK[s] > RANK[going]) {
            going = s;
            why = 'soil';
          }
        }
      }
      if (wet !== null) {
        const ws: Going = wet === 5 ? 'nogo' : wet === 4 ? (rule.season === 'wet' && !o.onFoot ? 'nogo' : 'slow') : rule.season === 'wet' && (wet === 1 || wet === 3) ? 'slow' : 'go';
        if (RANK[ws] > RANK[going]) {
          going = ws;
          why = 'wet';
        }
      }
    }
    return { m, x: p[0], y: p[1], elev, cls: cls === 255 ? null : cls, wet, going, why, slopePct: null, seen: null };
  });

  // slope over a 60 m base (at least two steps)
  const base = Math.max(60, stepM * 2);
  let j = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    while (j < i && s.m - samples[j].m > base) j++;
    const a = samples[Math.max(0, j - 1)];
    if (i > 0 && Number.isFinite(s.elev) && Number.isFinite(a.elev) && s.m > a.m) s.slopePct = ((s.elev - a.elev) / (s.m - a.m)) * 100;
  }

  // sight from the threat, spread over at most maxSight samples
  if (o.sightFrom && probe.sight) {
    const maxSight = o.maxSight ?? 200;
    const every = Math.max(1, Math.ceil(samples.length / maxSight));
    for (let i = 0; i < samples.length; i += every) {
      const s = samples[i];
      const v = probe.sight(o.sightFrom.at[0], o.sightFrom.at[1], o.sightFrom.eyeM, s.x, s.y, o.sightFrom.targetM);
      for (let k = i; k < Math.min(samples.length, i + every); k++) samples[k].seen = v;
    }
  }

  // runs of one class
  const runs: LineRun[] = [];
  for (const s of samples) {
    const r = runs[runs.length - 1];
    if (r && r.cls === s.cls && r.going === s.going) r.toM = s.m;
    // a new run starts half way between the last sample of the one before and its own first sample
    else runs.push({ fromM: r ? (r.toM + s.m) / 2 : 0, toM: s.m, cls: s.cls, going: s.going });
  }
  // each run spans to the next run's start
  for (let i = 0; i < runs.length; i++) runs[i].toM = i + 1 < runs.length ? runs[i + 1].fromM : lengthM;

  // obstacle events from class runs (adjacent runs of one obstacle kind merged)
  const events: LineEvent[] = [];
  for (const r of runs) {
    const k = r.cls !== null ? CLASS_KIND[r.cls] : undefined;
    if (!k) continue;
    const prev = events[events.length - 1];
    if (prev && prev.kind === k.kind && r.fromM - prev.toM <= stepM * 1.5) {
      prev.toM = r.toM;
      if (r.going && (!prev.going || RANK[r.going] > RANK[prev.going])) prev.going = r.going;
      continue;
    }
    events.push({ kind: k.kind, fromM: r.fromM, toM: r.toM, m: 0, mode: 'cross', cls: r.cls, going: r.going, label: k.word });
  }
  for (const e of events) {
    const w = Math.max(stepM, e.toM - e.fromM);
    const k = e.cls !== null ? CLASS_KIND[e.cls] : undefined;
    e.m = (e.fromM + e.toM) / 2;
    e.mode = k?.linear ? (w <= CROSS_MAX_M ? 'cross' : 'along') : 'in';
    e.label = `${k?.word ?? OBSTACLE_WORD[e.kind]}${e.mode === 'along' ? ` along ${fmtM(w)}` : e.mode === 'in' ? ` ${fmtM(w)}` : ''}`;
  }

  // gaps (no elevation / no class)
  const gaps: LineProfile['gaps'] = [];
  for (const s of samples) {
    const noE = !Number.isFinite(s.elev), noC = s.cls === null;
    if (!noE && !noC) continue;
    const what = noE && noC ? 'both' : noE ? 'elev' : 'class';
    const g = gaps[gaps.length - 1];
    if (g && s.m - g.toM <= stepM * 1.5 && g.what === what) g.toM = s.m;
    else gaps.push({ fromM: s.m, toM: s.m, what });
  }
  for (const g of gaps) g.toM = Math.min(lengthM, g.toM + stepM / 2), g.fromM = Math.max(0, g.fromM - stepM / 2);

  // stretches: NO-GO, steep, seen
  const stretches = (test: (s: LineSample) => boolean, why: (s: LineSample) => string): LineStretch[] => {
    const out: LineStretch[] = [];
    for (const s of samples) {
      if (!test(s)) continue;
      const last = out[out.length - 1];
      if (last && s.m - last.toM <= stepM * 1.5) last.toM = s.m;
      else out.push({ fromM: s.m, toM: s.m, why: why(s) });
    }
    for (const st of out) {
      st.fromM = Math.max(0, st.fromM - stepM / 2);
      st.toM = Math.min(lengthM, st.toM + stepM / 2);
    }
    return out;
  };
  const steepPct = o.steepPct ?? 25;
  const nogo = stretches(
    (s) => s.going === 'nogo',
    (s) => (s.why === 'soil' ? 'soil too soft' : s.why === 'wet' ? (s.wet === 5 ? 'water' : 'waterlogged') : s.cls !== null ? CLASS_KIND[s.cls]?.word ?? `class ${s.cls}` : 'NO-GO'),
  );
  const steep = stretches((s) => s.slopePct !== null && Math.abs(s.slopePct) >= steepPct, (s) => `${Math.round(Math.abs(s.slopePct ?? 0))}% ${(s.slopePct ?? 0) > 0 ? 'up' : 'down'}`);
  const seenStretches = o.sightFrom ? stretches((s) => s.seen !== null && s.seen >= 0.5, () => 'seen') : [];
  for (const st of steep) events.push({ kind: 'steep', fromM: st.fromM, toM: st.toM, m: (st.fromM + st.toM) / 2, mode: 'in', cls: null, going: null, label: `Steep ${st.why}` });
  events.sort((a, b) => a.fromM - b.fromM);

  // stats
  let gainM = 0, lossM = 0, minE = Infinity, maxE = -Infinity, maxSlope = 0, maxAt = 0;
  let goM = 0, slowM = 0, nogoM = 0, unknownM = 0, seenN = 0, seenRead = 0;
  // climb counts a rise or fall only once it reaches CLIMB_STEP_M from the last counted height, so the 30 m elevation's
  // metre-scale noise on flat ground does not add up to a climb that is not there
  let anchor = NaN;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const span = (i + 1 < samples.length ? samples[i + 1].m : lengthM) - s.m;
    if (Number.isFinite(s.elev)) {
      if (!Number.isFinite(anchor)) anchor = s.elev;
      const dz = s.elev - anchor;
      if (Math.abs(dz) >= CLIMB_STEP_M) {
        if (dz > 0) gainM += dz;
        else lossM -= dz;
        anchor = s.elev;
      }
      minE = Math.min(minE, s.elev);
      maxE = Math.max(maxE, s.elev);
    }
    if (s.slopePct !== null && Math.abs(s.slopePct) > maxSlope) {
      maxSlope = Math.abs(s.slopePct);
      maxAt = s.m;
    }
    if (s.going === 'go') goM += span;
    else if (s.going === 'slow') slowM += span;
    else if (s.going === 'nogo') nogoM += span;
    else unknownM += span;
    if (s.seen !== null) {
      seenRead++;
      if (s.seen >= 0.5) seenN++;
    }
  }
  const crossings: Partial<Record<ObstacleKind, number>> = {};
  for (const e of events) if (e.mode === 'cross') crossings[e.kind] = (crossings[e.kind] ?? 0) + 1;
  return {
    lengthM,
    stepM,
    samples,
    runs,
    events,
    gaps,
    nogo,
    steep,
    seenStretches,
    stats: {
      gainM,
      lossM,
      minElev: Number.isFinite(minE) ? minE : null,
      maxElev: Number.isFinite(maxE) ? maxE : null,
      maxSlopePct: maxSlope,
      maxSlopeAtM: maxAt,
      goM,
      slowM,
      nogoM,
      unknownM,
      gapM: gaps.reduce((t, g) => t + (g.toM - g.fromM), 0),
      seenShare: o.sightFrom ? (seenRead ? seenN / seenRead : null) : null,
      seenRead,
      crossings,
    },
  };
}

export function fmtM(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m / 10) * 10} m`;
}

/**
 * Steep slope along the line for a mover, percent, from the bundle's own slope classes (rules.json): vehicles from 15°
 * (class 10 "Moderate slope 15-30°: hard going for vehicles", 26.8 %), foot and pack animals from 30° (class 9 "Steep
 * slope >30°: climbable on foot only", 57.7 %).
 */
export function steepFor(profile: string): number {
  return profile === 'dismounted' || profile === 'pack' ? 57.7 : 26.8;
}
