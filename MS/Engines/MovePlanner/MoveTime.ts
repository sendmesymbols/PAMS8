/**
 * MoveTime.ts
 *
 * The Move Planner's clock and light. Pure (Node-testable): no ArcGIS, no DOM.
 *
 *   clock   absolute times are UTC milliseconds; a plan shows them in its own zone (`offsetMin`, Pakistan +300) against
 *           its M day: "M 1830", "M+1 0215". The old Mov Plan code took "today" as the M day and the browser's zone; here
 *           the M day is a date in the plan and the zone is fixed by the plan.
 *   light   first and last light at a place on a day, by the sun's altitude (MoveDoctrine.json `light`): sunrise / sunset
 *           (0.833 degrees, the old code), civil (6) or nautical (12) twilight. Day = first light <= t < last light, in
 *           minutes (the old test compared hours and minutes separately, so no time ever counted as day).
 */

import { sunAltitude } from '../GroundGuide/GroundGuideOcoka';

export const MIN = 60000;
export const DAY_MIN = 1440;
const DAY_MS = 86400000;

/** The plan's clock: local midnight of the M day as UTC ms, and the zone. */
export interface MvClock {
  mDayMs: number;
  offsetMin: number;
}

/** "YYYY-MM-DD" (local date of the M day) and the zone offset east of UTC in minutes. */
export function clockFrom(mDate: string, offsetMin = 300): MvClock {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec((mDate ?? '').trim());
  let y: number, mo: number, d: number;
  if (m) {
    y = +m[1];
    mo = +m[2];
    d = +m[3];
  } else {
    const now = new Date(Date.now() + offsetMin * MIN);
    y = now.getUTCFullYear();
    mo = now.getUTCMonth() + 1;
    d = now.getUTCDate();
  }
  return { mDayMs: Date.UTC(y, mo - 1, d) - offsetMin * MIN, offsetMin };
}

/** Today's local date in the zone as "YYYY-MM-DD". */
export function todayIn(offsetMin = 300): string {
  const n = new Date(Date.now() + offsetMin * MIN);
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}-${String(n.getUTCDate()).padStart(2, '0')}`;
}

/** "HH:MM", "HHMM" or "H:MM" to minutes of the day; null when not a time. */
export function parseHHMM(s: string | null | undefined): number | null {
  const m = /^\s*(\d{1,2}):?(\d{2})\s*$/.exec(String(s ?? ''));
  if (!m) return null;
  const h = +m[1], mm = +m[2];
  if (h > 24 || mm > 59 || (h === 24 && mm > 0)) return null;
  return h * 60 + mm;
}

/** UTC ms of minute `minOfDay` on M+`day`. */
export function atLocal(c: MvClock, day: number, minOfDay: number): number {
  return c.mDayMs + (day * DAY_MIN + minOfDay) * MIN;
}

/** Minutes since local midnight of the M day (negative before it, over 1440 on later days). */
export function localMin(c: MvClock, t: number): number {
  return (t - c.mDayMs) / MIN;
}

/** Which day of the move a time falls on: 0 = M, 1 = M+1, -1 = M-1. */
export function mDayOf(c: MvClock, t: number): number {
  return Math.floor(localMin(c, t) / DAY_MIN);
}

export function mDayLabel(n: number): string {
  return n === 0 ? 'M' : n > 0 ? `M+${n}` : `M${n}`;
}

/** "1830" for the local clock time (rounded to the minute). */
export function hhmm(c: MvClock, t: number): string {
  if (!Number.isFinite(t)) return '----';
  const m = ((Math.round(localMin(c, t)) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}`;
}

/** "M+1 0215". */
export function dtg(c: MvClock, t: number): string {
  if (!Number.isFinite(t)) return '-';
  return `${mDayLabel(mDayOf(c, Math.round(localMin(c, t)) * MIN + c.mDayMs))} ${hhmm(c, t)}`;
}

/** The calendar date of a time in the zone: "14 Nov". */
export function dateOf(c: MvClock, t: number): string {
  const d = new Date(t + c.offsetMin * MIN);
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`;
}

/** "3 h 25 min", "45 min", "2 d 4 h". */
export function durText(min: number): string {
  if (!Number.isFinite(min)) return '-';
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  if (m < DAY_MIN * 2) return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
  const d = Math.floor(m / DAY_MIN), h = Math.round((m % DAY_MIN) / 60);
  return `${d} d${h ? ` ${h} h` : ''}`;
}

/** "03:25" for a span of minutes (hours can pass 24). */
export function durHHMM(min: number): string {
  if (!Number.isFinite(min)) return '--:--';
  const m = Math.max(0, Math.round(min));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// ── light ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export type MvLightRule = 'sun' | 'civil' | 'nautical';

export const LIGHT_ALT: Record<MvLightRule, number> = { sun: -0.833, civil: -6, nautical: -12 };

export interface MvDayLight {
  /** UTC ms of first light that local day; NaN when the sun never rises past the threshold. */
  first: number;
  last: number;
}

function crossing(lo: number, hi: number, lat: number, lng: number, alt: number, rising: boolean): number {
  let a = lo, b = hi;
  for (let i = 0; i < 18; i++) {
    const m = (a + b) / 2;
    const above = sunAltitude(new Date(m), lat, lng) >= alt;
    if (above === rising) b = m;
    else a = m;
  }
  return (a + b) / 2;
}

/** First and last light on local day `day` (0 = M) at a place: a 20-minute scan of the sun's altitude, then bisection. */
export function dayLight(c: MvClock, day: number, lat: number, lng: number, altDeg: number): MvDayLight {
  const t0 = atLocal(c, day, 0);
  const step = 20 * MIN;
  let first = NaN, last = NaN;
  let prev = sunAltitude(new Date(t0), lat, lng) >= altDeg;
  for (let t = t0 + step; t <= t0 + DAY_MS; t += step) {
    const up = sunAltitude(new Date(t), lat, lng) >= altDeg;
    if (up && !prev && Number.isNaN(first)) first = crossing(t - step, t, lat, lng, altDeg, true);
    if (!up && prev) last = crossing(t - step, t, lat, lng, altDeg, false);
    prev = up;
  }
  return { first, last };
}

/**
 * Light for a plan: first / last light by day and place (cached to 0.1 degree), day or night at a time, the next change.
 * The rule is fixed per book; the place is the column's head (light hardly moves over a march).
 */
export class LightBook {
  readonly alt: number;
  readonly clock: MvClock;
  readonly rule: MvLightRule;
  private _cache = new Map<string, MvDayLight>();
  constructor(clock: MvClock, rule: MvLightRule = 'sun') {
    this.clock = clock;
    this.rule = rule;
    this.alt = LIGHT_ALT[rule] ?? LIGHT_ALT.sun;
  }
  day(day: number, lat: number, lng: number): MvDayLight {
    const key = `${day}|${lat.toFixed(1)}|${lng.toFixed(1)}`;
    let v = this._cache.get(key);
    if (!v) {
      v = dayLight(this.clock, day, Math.round(lat * 10) / 10, Math.round(lng * 10) / 10, this.alt);
      this._cache.set(key, v);
    }
    return v;
  }
  isDay(t: number, lat: number, lng: number): boolean {
    const d = this.day(mDayOf(this.clock, t), lat, lng);
    if (Number.isNaN(d.first) || Number.isNaN(d.last)) return sunAltitude(new Date(t), lat, lng) >= this.alt;
    return t >= d.first && t < d.last;
  }
  /** The next first or last light strictly after `t` (searching up to three days ahead). */
  nextChange(t: number, lat: number, lng: number): number {
    const d0 = mDayOf(this.clock, t);
    for (let d = d0; d <= d0 + 3; d++) {
      const L = this.day(d, lat, lng);
      if (L.first > t) return L.first;
      if (L.last > t) return L.last;
    }
    return t + DAY_MS;
  }
  /** First light and last light on the day of `t` at a place. */
  of(t: number, lat: number, lng: number): MvDayLight {
    return this.day(mDayOf(this.clock, t), lat, lng);
  }
}
