/**
 * GroundGuideIpbFire.ts
 *
 * Observation and fire corridors over the IPB avenues (IPB_Plan.md §6.3; Phase 4): how much of each avenue the other
 * side's positions cover with direct fire, where the gaps are, and what they can watch. Pure: no DOM, no view, no I/O
 * (it runs in Node: `node tools/ipb-test/fire.mjs`); sight is the Extended View's own (`analyseSight`, a chance read from
 * 30 m elevation plus buildings, crops and trees, GroundGuideOcoka.ts).
 *
 *   - Each position casts one fan of rays (all round, no coarser than its range allows) out to the larger of its
 *     weapon's effective range and its observation reach (capped), traced once.
 *   - Each avenue is sampled every `stepM` along its centre line; a sample is looked up in every fan that reaches it:
 *     under fire (inside a weapon's effective range, an even chance or better of being seen), screened (the ground
 *     shows it but something on it blocks the line), dead (the ground hides it), or out of range. Surveillance: seen from
 *     any position within its observation reach.
 *   - Gaps: stretches of 300 m or more not under fire (dead, screened or out of range), named by where they lie along
 *     the avenue: where to put mines, a direct-fire task or an OP.
 *   - Killing area candidates (OoW Vol I pp 42-45): an avenue's narrows that lie under fire, and covered stretches of
 *     1 km or more; the commander designates engagement areas.
 *   - Nearest: how close the nearest position comes to each avenue's centre line, and which, so an avenue wholly out of
 *     range can say why (user, 2026-11-14: "Coverage Along Each Apch is always out of range? is it a bug?": a lone
 *     platoon's 300 m does not reach a Bde HQ's avenue passing 308 m away).
 */

import { analyseSight, bearingsFor, fineStep, sightRuns, type OcokaGrid, type SightTables } from './GroundGuideOcoka';

export interface IpbFirePosn {
  /** Grid pixels. */
  x: number;
  y: number;
  /** Eye height above the ground, metres (2.4 a vehicle, 1.6 a man). */
  eyeM: number;
  /** The weapon's effective range (direct fire, or anti-armour against an armoured mover), metres. */
  effM: number;
  /** How far it can watch, metres (at least its range). */
  obsM: number;
  label: string;
}
export interface IpbFireLine {
  id: string;
  /** Centre line, grid pixels, in the direction of movement; `alongM` per point (from the area's start edge). */
  pts: Array<[number, number]>;
  alongM: number[];
  /** Narrows on it (grid pixels), for killing area candidates. */
  narrows?: Array<{ x: number; y: number; alongM: number; widthM: number; kind: string }>;
}
export interface IpbFireArgs {
  grid: OcokaGrid;
  posns: IpbFirePosn[];
  lines: IpbFireLine[];
  tables: SightTables | null;
  /** Height of what is looked for on the avenues: 2.4 m a vehicle (armour, mech), 1.7 m a man. */
  targetM: number;
  /** Sample spacing along the avenues, metres (default 100). */
  stepM?: number;
  /** Farthest any fan is traced, metres (default 6000). */
  capM?: number;
  /** Also trace the fans' dead and screened ground for the map (runs per position). */
  fans?: boolean;
}

/** 'c' under fire, 's' screened, 'd' dead, 'o' out of range. */
export type IpbFireState = 'c' | 's' | 'd' | 'o';
export interface IpbFireCoverage {
  id: string;
  samples: Array<{ alongM: number; x: number; y: number; state: IpbFireState; seen: boolean; by: number }>;
  coveredPct: number;
  screenedPct: number;
  deadPct: number;
  outPct: number;
  /** Seen from any position within its observation reach, %. */
  seenPct: number;
  gaps: Array<{ fromM: number; toM: number; kind: 'd' | 's' | 'o' }>;
  /** Positions (indices) that fire on it, most samples first. */
  byPosn: number[];
  /** The closest any position comes to the centre line, metres, and which (index); null / -1 with no positions. */
  nearestM: number | null;
  nearestPosn: number;
}
export interface IpbKillingArea {
  on: string;
  /** Grid pixels. */
  x: number;
  y: number;
  alongM: number;
  kind: 'narrows' | 'stretch';
  widthM: number | null;
  lengthM: number;
  /** Positions that cover it. */
  by: number[];
  text: string;
}
export interface IpbFireFan {
  posn: number;
  radiusM: number;
  effM: number;
  /** Runs of each ray (state 0 seen, 1 dead, 2 screened), for the map; empty unless `fans`. */
  runs: Array<{ bearingDeg: number; halfDeg: number; fromM: number; toM: number; state: 0 | 1 | 2 }>;
}
export interface IpbFire {
  lines: IpbFireCoverage[];
  killing: IpbKillingArea[];
  fans: IpbFireFan[];
  ms: number;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Fire coverage of the avenues from the positions. */
export function fireCoverage(a: IpbFireArgs): IpbFire {
  const t0 = now();
  const g = a.grid;
  const res = g.res;
  const capM = a.capM ?? 6000;
  const stepM = a.stepM ?? 100;
  interface Fan { bearings: Float32Array; stepDeg: number; steps: number; trace: Uint8Array; terr: Uint8Array; effM: number; obsM: number; x: number; y: number }
  const fans: Fan[] = [];
  const outFans: IpbFireFan[] = [];
  a.posns.forEach((p, k) => {
    const radiusM = Math.min(capM, Math.max(p.effM, p.obsM));
    const stepDeg = Math.max(0.5, fineStep(radiusM, res));
    const bearings = bearingsFor(stepDeg);
    const steps = Math.max(1, Math.floor(radiusM / res));
    const trace = new Uint8Array(bearings.length * steps);
    const terr = new Uint8Array(bearings.length * steps);
    analyseSight(g, p.x, p.y, bearings, { eyeM: p.eyeM, targetM: a.targetM, tolM: 1, tables: a.tables, going: null, effM: p.effM, radiusM: steps * res + 0.001, trace, traceTerrain: terr });
    const real = 360 / bearings.length;
    fans.push({ bearings, stepDeg: real, steps, trace, terr, effM: p.effM, obsM: Math.min(radiusM, p.obsM), x: p.x, y: p.y });
    const f: IpbFireFan = { posn: k, radiusM, effM: p.effM, runs: [] };
    if (a.fans) for (const r of sightRuns(trace, terr, bearings.length, steps, res, p.effM)) if (r.toM - r.fromM >= 1) f.runs.push({ bearingDeg: bearings[r.ray], halfDeg: real / 2, fromM: r.fromM, toM: r.toM, state: r.state });
    outFans.push(f);
  });
  // The chance a fan gives a point (0-250, 255 none), and on the ground alone.
  const look = (f: Fan, x: number, y: number): { d: number; p: number; pt: number } | null => {
    const dx = x - f.x, dy = y - f.y;
    const dM = Math.hypot(dx, dy) * res;
    const s = Math.round(dM / res);
    if (s < 1 || s > f.steps) return null;
    const b = (((Math.atan2(dx, -dy) * 180) / Math.PI) + 360) % 360;
    const r = Math.round(b / f.stepDeg) % f.bearings.length;
    const q = r * f.steps + s - 1;
    return { d: dM, p: f.trace[q], pt: f.terr[q] };
  };
  const lines: IpbFireCoverage[] = [];
  const killing: IpbKillingArea[] = [];
  for (const L of a.lines) {
    // Samples every stepM along the line.
    const samples: IpbFireCoverage['samples'] = [];
    const n = L.pts.length;
    if (n < 2) continue;
    let acc = 0;
    let next = 0;
    for (let i = 1; i < n; i++) {
      const [x0, y0] = L.pts[i - 1], [x1, y1] = L.pts[i];
      const seg = Math.hypot(x1 - x0, y1 - y0) * res;
      while (next <= acc + seg && seg > 0) {
        const t = (next - acc) / seg;
        const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        const alongM = L.alongM[i - 1] + (L.alongM[i] - L.alongM[i - 1]) * t;
        let state: IpbFireState = 'o', seen = false, by = -1, bestP = -1;
        let screened = false, dead = false;
        let fired = false;
        for (let k = 0; k < fans.length; k++) {
          const f = fans[k];
          const v = look(f, x, y);
          if (!v || v.p === 255) continue;
          if (v.d <= f.obsM && v.p >= 125) seen = true;
          if (v.d > f.effM) continue;
          if (v.p >= 125) {
            if (v.p > bestP) ((bestP = v.p), (by = k));
            fired = true;
          } else if (v.pt >= 125) screened = true;
          else dead = true;
        }
        state = fired ? 'c' : screened ? 's' : dead ? 'd' : 'o';
        samples.push({ alongM, x, y, state, seen, by });
        next += stepM;
      }
      acc += seg;
    }
    const m = samples.length || 1;
    const pct = (st: IpbFireState): number => (100 * samples.filter((s) => s.state === st).length) / m;
    // Gaps: runs of one kind not under fire (dead, screened, out of range), 300 m or more; a piece under 200 m joins the
    // run before it, so a gap is named where its ground really is dead, screened or out of reach.
    const runs: Array<{ fromM: number; toM: number; kind: IpbFireState }> = [];
    for (const s of samples) {
      const last = runs[runs.length - 1];
      if (last && last.kind === s.state && Math.abs(last.toM - s.alongM) <= stepM + 1) last.toM = s.alongM + stepM;
      else runs.push({ fromM: s.alongM, toM: s.alongM + stepM, kind: s.state });
    }
    for (let i = 1; i < runs.length; i++) {
      const r = runs[i], p = runs[i - 1];
      if (r.kind !== 'c' && p.kind !== 'c' && r.toM - r.fromM < 200) {
        p.toM = r.toM;
        runs.splice(i--, 1);
      }
    }
    const gaps: IpbFireCoverage['gaps'] = [];
    for (const r of runs) {
      if (r.kind === 'c' || r.toM - r.fromM < 300) continue;
      const prev = gaps[gaps.length - 1];
      if (prev && prev.kind === r.kind && Math.abs(prev.toM - r.fromM) < 1) prev.toM = r.toM;
      else gaps.push({ fromM: r.fromM, toM: r.toM, kind: r.kind as 'd' | 's' | 'o' });
    }
    const count = new Map<number, number>();
    for (const s of samples) if (s.by >= 0) count.set(s.by, (count.get(s.by) ?? 0) + 1);
    // The nearest position to the centre line (exact, segment by segment).
    let nearestM: number | null = null, nearestPosn = -1;
    a.posns.forEach((p, k) => {
      for (let i = 1; i < n; i++) {
        const [x0, y0] = L.pts[i - 1], [x1, y1] = L.pts[i];
        const dx = x1 - x0, dy = y1 - y0;
        const t = Math.max(0, Math.min(1, ((p.x - x0) * dx + (p.y - y0) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(p.x - x0 - t * dx, p.y - y0 - t * dy) * res;
        if (nearestM === null || d < nearestM) ((nearestM = d), (nearestPosn = k));
      }
    });
    lines.push({
      id: L.id,
      samples,
      coveredPct: pct('c'),
      screenedPct: pct('s'),
      deadPct: pct('d'),
      outPct: pct('o'),
      seenPct: (100 * samples.filter((s) => s.seen).length) / m,
      gaps,
      byPosn: [...count.entries()].sort((p, q) => q[1] - p[1]).map((e) => e[0]),
      nearestM,
      nearestPosn,
    });
    // Killing area candidates: narrows under fire, then covered stretches of 1 km or more.
    for (const nw of L.narrows ?? []) {
      const by: number[] = [];
      fans.forEach((f, k) => {
        const v = look(f, nw.x, nw.y);
        if (v && v.p !== 255 && v.p >= 125 && v.d <= f.effM) by.push(k);
      });
      if (by.length) killing.push({ on: L.id, x: nw.x, y: nw.y, alongM: nw.alongM, kind: 'narrows', widthM: nw.widthM, lengthM: 0, by, text: `${nw.kind === 'crossing' ? 'Crossing' : nw.kind === 'slow' ? 'SLOW-GO narrows' : 'Narrows'} ${Math.round(nw.widthM)} m wide, under fire from ${by.length} Posn${by.length > 1 ? 's' : ''}` });
    }
    let st: number | null = null;
    for (let i = 0; i <= samples.length; i++) {
      const c = i < samples.length && samples[i].state === 'c';
      if (c && st === null) st = i;
      if (!c && st !== null) {
        const len = (i - st) * stepM;
        if (len >= 1000) {
          const mid = samples[st + Math.floor((i - st) / 2)];
          const by = [...new Set(samples.slice(st, i).map((s) => s.by).filter((b) => b >= 0))];
          killing.push({ on: L.id, x: mid.x, y: mid.y, alongM: mid.alongM, kind: 'stretch', widthM: null, lengthM: len, by, text: `${(len / 1000).toFixed(1)} km under fire from ${by.length} Posn${by.length > 1 ? 's' : ''}` });
        }
        st = null;
      }
    }
  }
  // Narrows first (canalised under fire), then the longest stretches; at most three per avenue.
  killing.sort((p, q) => (p.kind === q.kind ? (p.kind === 'narrows' ? q.by.length - p.by.length : q.lengthM - p.lengthM) : p.kind === 'narrows' ? -1 : 1));
  const per = new Map<string, number>();
  const kept = killing.filter((k) => {
    const c = per.get(k.on) ?? 0;
    per.set(k.on, c + 1);
    return c < 3;
  });
  return { lines, killing: kept, fans: outFans, ms: now() - t0 };
}
