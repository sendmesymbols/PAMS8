/**
 * MoveRoad.ts
 *
 * Road movement for the Move Planner: one serial along its route, then every serial together with their crossings.
 * Pure (Node-testable). Rules and figures from MS/Data/MoveDoctrine.json (`road`), basis R / O / E as marked there.
 *
 *   TPP       vehs x 60 / (density x speed) + 2 min per 25 vehs or part thereof (R); column length = TPP x speed.
 *   head      moves at the day or night speed by the light at its place; halts after each 110 min running for 10 min
 *             (R), every third a 30 min long halt (O), or at fixed clock times for every column (R); at last light it
 *             halts Day TPP - Ni TPP for the column to close up to night density (R); with a Day or Ni mov window it
 *             harbours at a halt when the next leg would run past the window and waits for the window to open (O).
 *   tail      the whole column halts together; it closes up at the density halt, opens out at first light, and runs on
 *             past the RP until it has cleared it. Due at a point = the head reaches it; Clear = the tail passes it.
 *   schedule  where two routes cross, join or part, the serial of lower priority waits until the other has cleared the
 *             point plus 1 min (O, DI Mov), priority corps > group > unit > order of march; every wait is fed forward and
 *             all points are checked again until none clash.
 *
 * Fixes against the old code (kept as notes in MoveDoctrine.json): halts are placed at the true point by running time,
 * not at the nearest vertex; day/night is a real test; times carry no rounding of hours; the conflict branch for "the
 * other arrived first" works; crossings at junctions are found.
 */

import { pointAtS, meetPoints, type LngLat, type MvMeet, type MvMeetKind, type MvPath } from './MoveGeo';
import { MIN, localMin, DAY_MIN, type LightBook } from './MoveTime';

// ── rules ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export type MvRoadState = 'good' | 'hilly' | 'bad';
export type MvKind = 'road' | 'assy' | 'di' | 'rail' | 'enemy';

export interface MvRoadRules {
  extraMin: number;
  extraPer: number;
  extra: 'part' | 'prorata';
  shortRunMin: number;
  shortHaltMin: number;
  longEvery: number;
  longHaltMin: number;
  clockFirstAtMin: number;
  clockEveryMin: number;
  clockHaltMin: number;
  harbourMin: number;
  bufferMin: number;
  joinTolM: number;
  twoWay: boolean;
  speedsExcl: Record<MvRoadState, [number, number]>;
  speedsAll: Record<MvRoadState, [number, number]>;
  density: Record<string, { day: number; night: number; both?: number }>;
  speedByKind: Record<string, [number, number] | null>;
  startTime: string;
  gapMin: number;
}

export function roadRulesFrom(doc: any): MvRoadRules {
  const r = doc?.road ?? {};
  const sp = r.speeds ?? {};
  const st = (o: any, d: Record<MvRoadState, [number, number]>) => ({ good: o?.good ?? d.good, hilly: o?.hilly ?? d.hilly, bad: o?.bad ?? d.bad });
  return {
    extraMin: r.tpp?.extraMin ?? 2,
    extraPer: r.tpp?.extraPerVehs ?? 25,
    extra: r.tpp?.extra === 'prorata' ? 'prorata' : 'part',
    shortRunMin: r.halts?.short?.runMin ?? 110,
    shortHaltMin: r.halts?.short?.haltMin ?? 10,
    longEvery: r.halts?.long?.every ?? 3,
    longHaltMin: r.halts?.long?.haltMin ?? 30,
    clockFirstAtMin: r.halts?.clock?.firstAtMin ?? 50,
    clockEveryMin: r.halts?.clock?.everyMin ?? 120,
    clockHaltMin: r.halts?.clock?.haltMin ?? 10,
    harbourMin: r.halts?.harbourMin ?? 120,
    bufferMin: r.crossing?.bufferMin ?? 1,
    joinTolM: r.crossing?.joinTolM ?? 40,
    twoWay: r.crossing?.twoWay !== false,
    speedsExcl: st(sp.exclTanks, { good: [40, 30], hilly: [30, 20], bad: [30, 20] }),
    speedsAll: st(sp.allTypes, { good: [25, 20], hilly: [20, 15], bad: [20, 15] }),
    density: r.density?.byKind ?? { road: { day: 20, night: 40, both: 25 } },
    speedByKind: { assy: r.speedByKind?.assy ?? null, di: r.speedByKind?.di ?? null, road: null, enemy: null, rail: null },
    startTime: r.startDefaults?.time ?? '18:00',
    gapMin: r.startDefaults?.gapMin ?? 30,
  };
}

/** Day / night speed for a column (R table): by the road and whether it has tanks, transporters and the like. */
export function speedFor(road: MvRoadState, allTypes: boolean, R: MvRoadRules): [number, number] {
  const t = allTypes ? R.speedsAll : R.speedsExcl;
  return t[road] ?? t.good;
}

export function densityFor(kind: MvKind, R: MvRoadRules): { day: number; night: number } {
  const d = R.density[kind] ?? R.density.road ?? { day: 20, night: 40 };
  return { day: d.day, night: d.night };
}

// ── TPP and column length ───────────────────────────────────────────────────────────────────────────────────────────

/** The extra time allowance within a serial (min): 2 per 25 vehs or part thereof (R), or pro rata (old code). */
export function extraMin(n: number, R: MvRoadRules): number {
  if (n <= 0) return 0;
  return R.extra === 'prorata' ? (n * R.extraMin) / R.extraPer : R.extraMin * Math.ceil(n / R.extraPer);
}

/** Time past a point (min, rounded up): vehs x 60 / flow + extra allowance; flow = density x speed (vph). */
export function tppMin(n: number, density: number, kmh: number, R: MvRoadRules): number {
  if (n <= 0) return 0;
  const flow = density * kmh;
  if (!(flow > 0)) return Infinity;
  return Math.ceil((n * 60) / flow + extraMin(n, R) - 1e-9);
}

/** Length of column (m) = vehs / density + the extra allowance at speed (= TPP x speed, unrounded). */
export function columnLengthM(n: number, density: number, kmh: number, R: MvRoadRules): number {
  if (n <= 0 || !(density > 0)) return 0;
  return (n / density) * 1000 + ((extraMin(n, R) * kmh) / 60) * 1000;
}

export function flowVph(density: number, kmh: number): number {
  return density * kmh;
}

// ── one serial ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface MvHaltPlan {
  mode: 'running' | 'clock' | 'none';
  runMin: number;
  haltMin: number;
  /** Every n-th halt is a long halt (0 = none). Running mode only. */
  longEvery: number;
  longMin: number;
  clockFirstAtMin: number;
  clockEveryMin: number;
}

export interface MvWindow {
  kind: 'both' | 'day' | 'night';
  /** Local minutes [start, end] of the day the column may move; null = by first and last light. */
  clock?: [number, number] | null;
}

export interface MvWait {
  s: number;
  untilMs: number;
  why: string;
  with?: string;
}

export interface MvPointIn {
  name: string;
  s: number;
}

export interface MvSerialIn {
  id: string;
  name: string;
  vehicles: number;
  speedDay: number;
  speedNi: number;
  densDay: number;
  densNi: number;
  path: MvPath;
  /** When the head is due at the SP (UTC ms). */
  startMs: number;
  window: MvWindow;
  halts: MvHaltPlan;
  /** Halt at last light for the column to close up to night density (R). */
  densityHalt: boolean;
  points?: MvPointIn[];
  waits?: MvWait[];
}

export type MvStopKind = 'SH' | 'LH' | 'DLH' | 'X' | 'DC';

export interface MvStop {
  kind: MvStopKind;
  n: number;
  s: number;
  t0: number;
  t1: number;
  label: string;
  why: string;
  at: LngLat;
  with?: string;
}

export interface MvSeg {
  t0: number;
  t1: number;
  s0: number;
  s1: number;
  mode: 'move' | 'halt' | 'close';
  /** Column length in use (m). */
  lenM: number;
  /** Speed while moving or closing up (m per ms). */
  v: number;
  day: boolean;
  /** Past the RP: the column running on until its tail clears it. */
  virtual?: boolean;
}

export interface MvRun {
  id: string;
  name: string;
  vehicles: number;
  lengthM: number;
  segs: MvSeg[];
  tail: { t: number; s: number }[];
  stops: MvStop[];
  spDue: number;
  spClear: number;
  rpDue: number;
  rpClear: number;
  tppDay: number;
  tppNi: number;
  lenDayM: number;
  lenNiM: number;
  flowDay: number;
  flowNi: number;
  /** Minutes the start was moved to fit the mov window (0 = none). */
  startShiftMin: number;
  warnings: string[];
  path: MvPath;
}

function windowAllowed(w: MvWindow, day: boolean, c: { mDayMs: number }, t: number): boolean {
  if (w.kind === 'both') return true;
  if (w.clock) {
    const m = ((localMin(c as any, t) % DAY_MIN) + DAY_MIN) % DAY_MIN;
    const [a, b] = w.clock;
    const inside = a <= b ? m >= a && m < b : m >= a || m < b;
    return inside;
  }
  return w.kind === 'day' ? day : !day;
}

/** The next time after `t` the window's state flips (clock windows: the next boundary; light windows: light). */
function windowFlip(w: MvWindow, light: LightBook, t: number, lat: number, lng: number): number {
  if (w.kind === 'both') return Infinity;
  if (w.clock) {
    const m = localMin(light.clock, t);
    const base = Math.floor(m / DAY_MIN) * DAY_MIN;
    let best = Infinity;
    for (const d of [0, DAY_MIN, 2 * DAY_MIN])
      for (const x of w.clock) {
        const mm = base + d + x;
        if (mm > m + 1e-6 && mm < best) best = mm;
      }
    return light.clock.mDayMs + best * MIN;
  }
  return light.nextChange(t, lat, lng);
}

function nextOpen(w: MvWindow, light: LightBook, t: number, lat: number, lng: number): number {
  let x = t;
  for (let i = 0; i < 8; i++) {
    if (windowAllowed(w, light.isDay(x + 1, lat, lng), light.clock, x + 1)) return x;
    x = windowFlip(w, light, x + 1, lat, lng);
    if (!Number.isFinite(x)) return t;
  }
  return x;
}

function nextClockHalt(h: MvHaltPlan, light: LightBook, t: number): number {
  const m = localMin(light.clock, t);
  const k = Math.ceil((m - h.clockFirstAtMin + 1e-6) / h.clockEveryMin);
  return light.clock.mDayMs + (h.clockFirstAtMin + k * h.clockEveryMin) * MIN;
}

/** The head's way along the route, its halts and harbours, and the tail; due and clear at the SP and RP. */
export function simulate(ser: MvSerialIn, light: LightBook, R: MvRoadRules): MvRun {
  const L = ser.path.length;
  const warn: string[] = [];
  const segs: MvSeg[] = [];
  const stops: MvStop[] = [];
  const at = (s: number) => pointAtS(ser.path, Math.max(0, Math.min(L, s)));
  const isDayAt = (t: number, s: number) => {
    const p = at(s);
    return light.isDay(t, p[1], p[0]);
  };
  const tppDay = tppMin(ser.vehicles, ser.densDay, ser.speedDay, R);
  const tppNi = tppMin(ser.vehicles, ser.densNi, ser.speedNi, R);
  const lenDay = columnLengthM(ser.vehicles, ser.densDay, ser.speedDay, R);
  const lenNi = columnLengthM(ser.vehicles, ser.densNi, ser.speedNi, R);
  const waits = (ser.waits ?? []).slice().sort((a, b) => a.s - b.s).map((w) => ({ ...w, done: false }));
  const counts: Record<MvStopKind, number> = { SH: 0, LH: 0, DLH: 0, X: 0, DC: 0 };
  const H = ser.halts;

  let t = ser.startMs;
  let s = 0;
  let startShift = 0;
  const p0 = at(0);
  const fitWindow = () => {
    if (!windowAllowed(ser.window, light.isDay(t, p0[1], p0[0]), light.clock, t)) {
      const t2 = nextOpen(ser.window, light, t, p0[1], p0[0]);
      startShift += Math.round((t2 - t) / MIN);
      t = t2;
    }
  };
  // the mov window first (a start before last light waits for it), then any hold at the SP from the scheduler
  fitWindow();
  for (const w of waits)
    if (w.s <= 0.5) {
      w.done = true;
      if (w.untilMs > t) {
        counts.X++;
        stops.push({ kind: 'X', n: counts.X, s: 0, t0: t, t1: w.untilMs, label: `X-${counts.X}`, why: w.why, at: at(0), with: w.with });
        t = w.untilMs;
        fitWindow();
      }
    }
  if (startShift > 0) warn.push(`Start moved ${startShift} min to the mov window`);
  const spDue = t;
  const push = (seg: MvSeg) => {
    if (seg.t1 > seg.t0 || seg.s1 !== seg.s0) segs.push(seg);
  };
  const stop = (kind: MvStopKind, until: number, why: string, withId?: string) => {
    if (!(until > t)) return;
    const day = isDayAt(t, s);
    counts[kind]++;
    const label = kind === 'DC' ? 'Close Up' : `${kind}-${counts[kind]}`;
    stops.push({ kind, n: counts[kind], s, t0: t, t1: until, label, why, at: at(s), with: withId });
    const closing = kind === 'DC';
    push({ t0: t, t1: until, s0: s, s1: s, mode: closing ? 'close' : 'halt', lenM: closing ? lenNi : day ? lenDay : lenNi, v: ((closing ? ser.speedNi : day ? ser.speedDay : ser.speedNi) * 1000) / 60 / MIN, day });
    t = until;
  };

  let run = 0;
  let nShort = 0;
  let clockNext = H.mode === 'clock' ? nextClockHalt(H, light, t) : Infinity;
  let guard = 0;
  while (s < L - 0.01 && guard++ < 50000) {
    const p = at(s);
    const day = light.isDay(t, p[1], p[0]);
    if (!windowAllowed(ser.window, day, light.clock, t)) {
      // a halt or wait ran into the closed window: harbour here until it opens
      stop('DLH', nextOpen(ser.window, light, t, p[1], p[0]), 'Mov window closed: harbour until it opens');
      run = 0;
      if (H.mode === 'clock') clockNext = nextClockHalt(H, light, t);
      continue;
    }
    const kmh = day ? ser.speedDay : ser.speedNi;
    if (!(kmh > 0)) {
      warn.push('Speed 0: the column cannot move');
      break;
    }
    const vmm = (kmh * 1000) / 60; // m per min
    const lenNow = day ? lenDay : lenNi;
    const dEnd = (L - s) / vmm;
    const w = waits.find((x) => !x.done && x.s > s + 0.01);
    const dWait = w ? (w.s - s) / vmm : Infinity;
    const tLight = light.nextChange(t, p[1], p[0]);
    const dLight = (tLight - t) / MIN;
    const dHalt = H.mode === 'running' ? Math.max(0, H.runMin - run) : H.mode === 'clock' ? Math.max(0, (clockNext - t) / MIN) : Infinity;
    const tFlip = windowFlip(ser.window, light, t, p[1], p[0]);
    const dWin = (tFlip - t) / MIN;
    const dt = Math.max(0, Math.min(dEnd, dWait, dLight, dHalt, dWin));
    if (dt > 0) {
      const s1 = Math.min(L, s + vmm * dt);
      push({ t0: t, t1: t + dt * MIN, s0: s, s1, mode: 'move', lenM: lenNow, v: vmm / MIN, day });
      t += dt * MIN;
      s = s1;
      run += dt;
    }
    if (s >= L - 0.01) break;
    const eps = 1e-6;
    // a wait the scheduler placed (just short of a crossing)
    if (w && Math.abs(dt - dWait) < eps) {
      w.done = true;
      if (w.untilMs > t) {
        const len = (w.untilMs - t) / MIN;
        stop('X', w.untilMs, w.why, w.with);
        if (len >= H.haltMin) run = 0;
        if (H.mode === 'clock') clockNext = nextClockHalt(H, light, t);
      }
      continue;
    }
    // first or last light
    if (Math.abs(dt - dLight) < eps) {
      const p2 = at(s);
      const nowDay = light.isDay(t + 1, p2[1], p2[0]);
      if (!nowDay && day && ser.densityHalt && ser.densDay !== ser.densNi && windowAllowed(ser.window, false, light.clock, t + 1)) {
        // R: Day TPP - Ni TPP + the halt the tail needs; when the night speed is lower the tail needs longer to close up
        const diff = tppDay - tppNi;
        const closeMin = Math.ceil((lenDay - lenNi) / ((ser.speedNi * 1000) / 60) - 1e-9);
        const dur = Math.max(diff, closeMin);
        if (dur > 0) {
          stop('DC', t + dur * MIN, `Last light: close up to night density (Day TPP ${tppDay} - Ni TPP ${tppNi} min${closeMin > diff ? `; ${closeMin} min for the tail at night speed` : ''})`);
          if (dur >= H.haltMin) run = 0;
        }
      }
    }
    // the mov window closed between halts: harbour here
    {
      const p2 = at(s);
      if (!windowAllowed(ser.window, light.isDay(t + 1, p2[1], p2[0]), light.clock, t + 1)) {
        const open = nextOpen(ser.window, light, t, p2[1], p2[0]);
        stop('DLH', open, 'Mov window closed: harbour until it opens');
        run = 0;
        if (H.mode === 'clock') clockNext = nextClockHalt(H, light, t);
        continue;
      }
    }
    // a short / long halt
    const haltDue = (H.mode === 'running' && run >= H.runMin - eps) || (H.mode === 'clock' && t >= clockNext - 1);
    if (haltDue) {
      nShort++;
      const long = H.mode === 'running' && H.longEvery > 0 && nShort % H.longEvery === 0 && H.longMin > 0;
      const dur = long ? H.longMin : H.haltMin;
      const kind: MvStopKind = long ? 'LH' : 'SH';
      if (ser.window.kind !== 'both') {
        // harbour here when the next leg would run past the window (old Rd Mov / Mov & Assy)
        const after = t + dur * MIN;
        const p2 = at(s);
        const legMin = Math.min(H.mode === 'running' ? H.runMin : H.clockEveryMin, (L - s) / vmm);
        const openAfter = windowAllowed(ser.window, light.isDay(after, p2[1], p2[0]), light.clock, after);
        const close = openAfter ? windowFlip(ser.window, light, after, p2[1], p2[0]) : after;
        if (after + legMin * MIN > close) {
          const open = nextOpen(ser.window, light, close, p2[1], p2[0]);
          stop('DLH', open, 'Next leg would run past the mov window: harbour until it opens');
          run = 0;
          if (H.mode === 'clock') clockNext = nextClockHalt(H, light, t);
          continue;
        }
      }
      if (dur > 0) stop(kind, t + dur * MIN, long ? 'Long halt' : 'Short halt');
      run = 0;
      if (H.mode === 'clock') clockNext = nextClockHalt(H, light, t);
    }
  }
  if (guard >= 50000) warn.push('Stopped after too many steps: check the speeds and the mov window');
  const rpDue = t;

  // the tail: whole-column halts freeze it, the close-up halt lets it close, it opens out behind the head
  const tail = tailOf(segs, -(segs[0]?.lenM ?? (isDayAt(spDue, 0) ? lenDay : lenNi)), spDue);
  let tailEnd = tail[tail.length - 1]?.s ?? -lenDay;
  if (tailEnd < L) {
    const last = segs[segs.length - 1];
    const p2 = at(L);
    const day = light.isDay(t, p2[1], p2[0]);
    const v = ((day ? ser.speedDay : ser.speedNi) * 1000) / 60 / MIN;
    const lenM = day ? lenDay : lenNi;
    if (v > 0) {
      const dist = L - tailEnd + 1;
      const ext: MvSeg = { t0: t, t1: t + dist / v, s0: L, s1: L + dist, mode: 'move', lenM: Math.max(lenM, last?.lenM ?? lenM), v, day, virtual: true };
      segs.push(ext);
      const more = tailOf([ext], tailEnd, t);
      tail.push(...more.slice(1));
      tailEnd = tail[tail.length - 1].s;
    }
  }
  const run2: MvRun = {
    id: ser.id,
    name: ser.name,
    vehicles: ser.vehicles,
    lengthM: L,
    segs,
    tail,
    stops,
    spDue,
    spClear: NaN,
    rpDue,
    rpClear: NaN,
    tppDay,
    tppNi,
    lenDayM: lenDay,
    lenNiM: lenNi,
    flowDay: flowVph(ser.densDay, ser.speedDay),
    flowNi: flowVph(ser.densNi, ser.speedNi),
    startShiftMin: startShift,
    warnings: warn,
    path: ser.path,
  };
  run2.spClear = clearAt(run2, 0);
  run2.rpClear = clearAt(run2, L);
  return run2;
}

function tailOf(segs: MvSeg[], tail0: number, t0: number): { t: number; s: number }[] {
  const out = [{ t: t0, s: tail0 }];
  let tail = tail0;
  for (const g of segs) {
    if (g.mode === 'halt') {
      out.push({ t: g.t1, s: tail });
      continue;
    }
    if (g.mode === 'close') {
      const target = g.s0 - g.lenM;
      if (tail < target && g.v > 0) {
        const tr = g.t0 + (target - tail) / g.v;
        if (tr >= g.t1) tail += g.v * (g.t1 - g.t0);
        else {
          out.push({ t: tr, s: target });
          tail = target;
        }
      }
      out.push({ t: g.t1, s: tail });
      continue;
    }
    const v = g.t1 > g.t0 ? (g.s1 - g.s0) / (g.t1 - g.t0) : 0;
    const behind = g.s0 - g.lenM; // where the tail would be at t0 with the column at full length
    if (tail <= behind + 1e-6 || v <= 0) {
      tail += v * (g.t1 - g.t0);
      out.push({ t: g.t1, s: tail });
    } else {
      // the column opens out: the tail waits until the head is a full length ahead
      const tw = g.t0 + (tail - behind) / v;
      if (tw >= g.t1) out.push({ t: g.t1, s: tail });
      else {
        out.push({ t: tw, s: tail });
        tail += v * (g.t1 - tw);
        out.push({ t: g.t1, s: tail });
      }
    }
  }
  return out;
}

/** When the head reaches chainage `s` (m). */
export function dueAt(run: MvRun, s: number): number {
  if (s <= 0) return run.spDue;
  for (const g of run.segs) {
    if (g.mode !== 'move' || g.s1 < s) continue;
    if (g.s0 >= s) return g.t0;
    const v = (g.s1 - g.s0) / (g.t1 - g.t0);
    return g.t0 + (s - g.s0) / v;
  }
  return NaN;
}

/** When the tail has passed chainage `s` (m). */
export function clearAt(run: MvRun, s: number): number {
  const T = run.tail;
  for (let i = 1; i < T.length; i++) {
    const a = T[i - 1], b = T[i];
    if (b.s < s - 1e-6) continue;
    if (a.s >= s) return a.t;
    if (b.s === a.s) return b.t;
    return a.t + ((s - a.s) / (b.s - a.s)) * (b.t - a.t);
  }
  return NaN;
}

/** Head and tail chainage at time t (clamped to the route: before the SP = still forming up, past the RP = released). */
export function positionAt(run: MvRun, t: number): { head: number; tail: number; state: 'before' | 'moving' | 'halted' | 'after' } {
  if (t < run.spDue) {
    const lead = run.spDue - t;
    const head = -lead * (run.segs[0]?.v ?? 0);
    return { head, tail: head - (run.segs[0]?.lenM ?? 0), state: 'before' };
  }
  let head = run.lengthM;
  let state: 'moving' | 'halted' | 'after' = 'after';
  for (const g of run.segs) {
    if (t > g.t1) continue;
    head = g.mode === 'move' ? g.s0 + (g.s1 - g.s0) * ((t - g.t0) / Math.max(1, g.t1 - g.t0)) : g.s0;
    state = g.virtual ? 'after' : g.mode === 'move' ? 'moving' : 'halted';
    break;
  }
  let tail = run.tail[run.tail.length - 1]?.s ?? head;
  for (let i = 1; i < run.tail.length; i++) {
    const a = run.tail[i - 1], b = run.tail[i];
    if (t > b.t) continue;
    tail = b.t > a.t ? a.s + (b.s - a.s) * ((t - a.t) / (b.t - a.t)) : b.s;
    break;
  }
  if (t > (run.tail[run.tail.length - 1]?.t ?? 0)) state = 'after';
  return { head, tail, state };
}

// ── legs and table rows ─────────────────────────────────────────────────────────────────────────────────────────────

export interface MvLeg {
  from: string;
  to: string;
  fromS: number;
  toS: number;
  fromDue: number;
  fromClear: number;
  toDue: number;
  toClear: number;
  sh: number;
  lh: number;
  dlh: number;
  x: number;
  haltMin: number;
  totalMin: number;
  distKm: number;
}

/** Legs between the critical points (SP, CPs, crossing waits, harbours, RP), like the old tables' rows. */
export function legsOf(run: MvRun, points: MvPointIn[] = [], spName = 'SP', rpName = 'Rel P', harbourMin = 120): MvLeg[] {
  const L = run.lengthM;
  const marks: MvPointIn[] = [{ name: spName, s: 0 }];
  for (const p of points) if (p.s > 1 && p.s < L - 1) marks.push(p);
  for (const st of run.stops) {
    if (st.kind === 'X' && st.s > 1 && st.s < L - 1) marks.push({ name: `X Pt (${st.label})`, s: st.s + 0.5 });
    if (st.kind === 'DLH' && (st.t1 - st.t0) / MIN >= harbourMin && st.s > 1 && st.s < L - 1) marks.push({ name: `Harbour (${st.label})`, s: st.s + 0.5 });
  }
  marks.push({ name: rpName, s: L });
  marks.sort((a, b) => a.s - b.s);
  const legs: MvLeg[] = [];
  for (let i = 0; i < marks.length - 1; i++) {
    const a = marks[i], b = marks[i + 1];
    const inLeg = run.stops.filter((x) => (i === 0 ? x.s >= a.s - 0.01 : x.s > a.s - 0.01) && x.s < b.s - 0.01 + (i === marks.length - 2 ? 0.02 : 0));
    const fromDue = dueAt(run, a.s), toClear = clearAt(run, b.s);
    legs.push({
      from: a.name,
      to: b.name,
      fromS: a.s,
      toS: b.s,
      fromDue,
      fromClear: clearAt(run, a.s),
      toDue: dueAt(run, b.s),
      toClear,
      sh: inLeg.filter((x) => x.kind === 'SH').length,
      lh: inLeg.filter((x) => x.kind === 'LH').length,
      dlh: inLeg.filter((x) => x.kind === 'DLH').length,
      x: inLeg.filter((x) => x.kind === 'X').length,
      haltMin: Math.round(inLeg.reduce((m, x) => m + (x.t1 - x.t0) / MIN, 0)),
      totalMin: Math.round((toClear - fromDue) / MIN),
      distKm: (b.s - a.s) / 1000,
    });
  }
  return legs;
}

// ── every serial together ───────────────────────────────────────────────────────────────────────────────────────────

export interface MvSchedSerial extends MvSerialIn {
  /** Priority, most important first: [corps, group, unit]; lower number = higher priority. */
  pri: number[];
  /** Order of march (the last tie-break). */
  order: number;
}

export interface MvConflict {
  kind: MvMeetKind;
  at: LngLat;
  winner: string;
  loser: string;
  /** Chainage of the point on the loser's route. */
  sLoser: number;
  sWinner: number;
  /** When the loser was due before waiting, and how long it waits. */
  dueMs: number;
  waitMin: number;
  winnerClear: number;
}

export interface MvMeetPair {
  a: string;
  b: string;
  meet: MvMeet;
}

export interface MvSchedule {
  runs: Record<string, MvRun>;
  conflicts: MvConflict[];
  meets: MvMeetPair[];
  /** Clashes still open after the iteration cap (should be 0). */
  open: number;
}

export const MEET_WORD: Record<MvMeetKind, string> = { cross: 'Crossing', join: 'Joining', leave: 'Parting from', follow: 'Closing on', meet: 'Head-on with' };

function cmpPri(a: MvSchedSerial, b: MvSchedSerial): number {
  const n = Math.max(a.pri.length, b.pri.length);
  for (let i = 0; i < n; i++) {
    const x = a.pri[i] ?? 99, y = b.pri[i] ?? 99;
    if (x !== y) return x - y;
  }
  return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

const FOLLOW_STEP_M = 10000;

/** Where every pair of routes meets (crossings, joins, leaves, follow checks; head-on stretches as `meet`). */
export function allMeets(sers: MvSerialIn[], R: MvRoadRules): MvMeetPair[] {
  const out: MvMeetPair[] = [];
  const cache = new Map<MvPath, Map<MvPath, MvMeet[]>>();
  for (let i = 0; i < sers.length; i++)
    for (let j = i + 1; j < sers.length; j++) {
      const A = sers[i], B = sers[j];
      let ms: MvMeet[];
      if (A.path === B.path) {
        ms = [
          { kind: 'join', sA: 0, sB: 0, at: A.path.pts[0], fromA: 0, toA: A.path.length },
          { kind: 'leave', sA: A.path.length, sB: B.path.length, at: A.path.pts[A.path.pts.length - 1], fromA: 0, toA: A.path.length },
        ];
      } else {
        let m = cache.get(A.path);
        if (!m) cache.set(A.path, (m = new Map()));
        ms = m.get(B.path) ?? meetPoints(A.path, B.path, R.joinTolM);
        m.set(B.path, ms);
      }
      for (const meet of ms) {
        out.push({ a: A.id, b: B.id, meet });
        // along road both use in the same direction: a check every 10 km, so a faster column closes up instead of passing
        if (meet.kind === 'join' && meet.fromA !== undefined && meet.toA !== undefined) {
          for (let s = meet.fromA + FOLLOW_STEP_M; s < meet.toA - 1000; s += FOLLOW_STEP_M) {
            out.push({ a: A.id, b: B.id, meet: { kind: 'follow', sA: s, sB: meet.sB + (s - meet.sA), at: pointAtS(A.path, s) } });
          }
        }
      }
    }
  return out;
}

/**
 * Every serial with its crossings resolved: simulate all, find the earliest clash at a crossing, join or parting point,
 * hold the serial of lower priority just short of it until the other has cleared plus the buffer, simulate that one
 * again, and repeat until nothing clashes.
 */
export function schedule(sers: MvSchedSerial[], light: LightBook, R: MvRoadRules, opts: { twoWay?: boolean; maxIter?: number } = {}): MvSchedule {
  const twoWay = opts.twoWay ?? R.twoWay;
  const maxIter = opts.maxIter ?? 400;
  const byId = new Map(sers.map((x) => [x.id, { ...x, waits: (x.waits ?? []).slice() }]));
  const runs: Record<string, MvRun> = {};
  for (const x of byId.values()) runs[x.id] = simulate(x, light, R);
  const meets = allMeets([...byId.values()], R).filter((m) => m.meet.kind !== 'meet' || !twoWay);
  const conflicts: MvConflict[] = [];
  const buf = R.bufferMin * MIN;
  let open = 0;
  for (let iter = 0; iter < maxIter; iter++) {
    let first: { m: MvMeetPair; t: number } | null = null;
    for (const m of meets) {
      const ra = runs[m.a], rb = runs[m.b];
      const dA = dueAt(ra, m.meet.sA), cA = clearAt(ra, m.meet.sA);
      const dB = dueAt(rb, m.meet.sB), cB = clearAt(rb, m.meet.sB);
      if (![dA, cA, dB, cB].every(Number.isFinite)) continue;
      if (dA < cB + buf - 1000 && dB < cA + buf - 1000) {
        const t = Math.min(dA, dB);
        if (!first || t < first.t) first = { m, t };
      }
    }
    if (!first) {
      open = 0;
      break;
    }
    const { m } = first;
    const A = byId.get(m.a)!, B = byId.get(m.b)!;
    const aWins = cmpPri(A, B) <= 0;
    const W = aWins ? A : B, Lo = aWins ? B : A;
    const sW = aWins ? m.meet.sA : m.meet.sB, sL = aWins ? m.meet.sB : m.meet.sA;
    const until = clearAt(runs[W.id], sW) + buf;
    const due = dueAt(runs[Lo.id], sL);
    const sWait = Math.max(0, sL - 5);
    const ex = Lo.waits!.find((w) => Math.abs(w.s - sWait) < 2);
    const why = `${MEET_WORD[m.meet.kind]} ${W.name}: wait until it clears`;
    if (ex) {
      if (until <= ex.untilMs + 500) {
        open++;
        if (open > 50) break;
        continue;
      }
      ex.untilMs = until;
      ex.why = why;
    } else Lo.waits!.push({ s: sWait, untilMs: until, why, with: W.id });
    runs[Lo.id] = simulate(Lo, light, R);
    conflicts.push({ kind: m.meet.kind, at: m.meet.at, winner: W.id, loser: Lo.id, sLoser: sL, sWinner: sW, dueMs: due, waitMin: Math.max(0, Math.round((until - due) / MIN)), winnerClear: until - buf });
    open = 1;
  }
  // keep one record per loser and point (the last wait there is the one that counts)
  const seen = new Map<string, MvConflict>();
  for (const c of conflicts) seen.set(`${c.loser}|${Math.round(c.sLoser)}`, c);
  for (const c of seen.values()) {
    const r = runs[c.loser];
    const st = r.stops.find((x) => x.kind === 'X' && Math.abs(x.s - Math.max(0, c.sLoser - 5)) < 3);
    if (st) c.waitMin = Math.round((st.t1 - st.t0) / MIN);
  }
  return { runs, conflicts: [...seen.values()].filter((c) => c.waitMin > 0), meets, open };
}

// ── flow past a point (the Planning Table) ──────────────────────────────────────────────────────────────────────────

export interface MvFlowRow {
  hourMs: number;
  bySerial: { id: string; vehs: number }[];
  total: number;
}

/** Vehicles past a point in each clock hour: each serial passes evenly between its due and clear (R planning table). */
export function flowAt(entries: { id: string; vehicles: number; due: number; clear: number }[]): MvFlowRow[] {
  const ok = entries.filter((e) => Number.isFinite(e.due) && Number.isFinite(e.clear) && e.clear > e.due);
  if (!ok.length) return [];
  const H = 3600000;
  const t0 = Math.floor(Math.min(...ok.map((e) => e.due)) / H) * H;
  const t1 = Math.ceil(Math.max(...ok.map((e) => e.clear)) / H) * H;
  const rows: MvFlowRow[] = [];
  for (let h = t0; h < t1 && rows.length < 24 * 14; h += H) {
    const by = ok
      .map((e) => {
        const ov = Math.max(0, Math.min(h + H, e.clear) - Math.max(h, e.due));
        return { id: e.id, vehs: Math.round((e.vehicles * ov) / (e.clear - e.due)) };
      })
      .filter((x) => x.vehs > 0);
    rows.push({ hourMs: h, bySerial: by, total: by.reduce((m, x) => m + x.vehs, 0) });
  }
  return rows;
}
