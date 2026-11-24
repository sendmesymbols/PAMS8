/**
 * The wind (W), from the bundle's wind grid (`grotbc.wind`: ERA5 1990-2019 normal at 0.25°, 00 / 06 / 12 / 18 UTC;
 * tools/terrain-pipeline/scripts/wind.py). Pure: the grid is parsed and read here, the fetch is the small loader at the
 * foot. WorldClim (climate grid) gives the mean speed only; this adds where the wind usually comes FROM, how steady it
 * is (|mean vector| / mean speed) and whether it turns between day and night.
 *
 * Readings built on it (figures in IpbDoctrine `wind`):
 *   - lzWind: helicopters land and take off into the wind (FM 3-21.38, T, page unverified): the run-in comes from the
 *     downwind side and the departure leaves upwind, so the 10 : 1 approach test (`air.approach`) is read on those two
 *     sectors.
 *   - dzWind: jumpers drift downwind: the release point lies upwind of the DZ (E, no drift figure applied).
 *   - downwind: smoke and agents drift with the wind (IBB p 109; OoW Vol II p 93).
 * A normal, not a forecast: every text says so where it is used, and Met gives the wind on the day.
 */

export interface WindMeta {
  lat0: number;
  lon0: number;
  step: number;
  rows: number;
  cols: number;
  hoursUtc: number[];
  layers: Array<{ id: string; scale?: number }>;
  source?: string;
  sourceRef?: { dataDate?: string; name?: string };
  caveats?: string[];
}
export interface WindGrid {
  meta: WindMeta;
  data: Int16Array;
  index: Map<string, number>;
}
export interface WindRules {
  /** Steadiness under this: "variable", no direction named, nothing decided by it. */
  steadyMin: number;
  /** Steadiness from this: "steady"; between the two: "mostly". */
  steadyWord: number;
  /** A mean speed under this (kt) is light: any clear approach serves. */
  lightKt: number;
  /** Day and night directions this far apart (degrees), both named: the wind turns. */
  turnDeg: number;
}
export interface WindHour {
  hourUtc: number;
  /** Local clock hour (UTC + offset). */
  hourLocal: number;
  /** Where the wind comes from, degrees true; null when it is variable (steadiness under `steadyMin`). */
  fromDeg: number | null;
  /** Mean speed (m/s) and the steady part of it (the mean vector's length). */
  meanMs: number;
  vecMs: number;
  /** |mean vector| / mean speed, 0-1. */
  steady: number;
}
export interface WindReading {
  month: number;
  hours: WindHour[];
  /** All four hours together, the day's two (local 06:00-18:00) and the night's two. */
  all: WindHour;
  day: WindHour;
  night: WindHour;
  /** Day and night both named and `turnDeg` or more apart. */
  turns: boolean;
  /** The mean under `lightKt`. */
  light: boolean;
  /** `all` has no direction. */
  variable: boolean;
  /** "from NW 6 kt, steady" (+ "; by night from NE" when it turns). */
  text: string;
  source: string;
  dataDate: string;
}

export const KT = 1.943844;
const D2R = Math.PI / 180;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass8 = (deg: number): string => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
const angDiff = (a: number, b: number): number => {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
};

export function windRulesFrom(doc: any): WindRules {
  const W = doc?.wind ?? {};
  return {
    steadyMin: W.steadyMin?.value ?? 0.3,
    steadyWord: W.steadyWord?.value ?? 0.6,
    lightKt: W.lightKt?.value ?? 3,
    turnDeg: W.turnDeg?.value ?? 90,
  };
}

export function parseWind(meta: any, buf: ArrayBuffer): WindGrid {
  const m = meta as WindMeta;
  if (!m || !(m.rows > 1) || !(m.cols > 1) || !(m.step > 0) || !Array.isArray(m.layers)) throw new Error('not a wind grid');
  const data = new Int16Array(buf);
  if (data.length !== m.layers.length * m.rows * m.cols) throw new Error(`wind grid: ${data.length} values, expected ${m.layers.length * m.rows * m.cols}`);
  const index = new Map<string, number>();
  m.layers.forEach((l, i) => index.set(l.id, i));
  return { meta: m, data, index };
}

/** One layer read bilinearly between the grid points; null outside the grid or when the layer is missing. */
function sample(g: WindGrid, id: string, lon: number, lat: number): number | null {
  const li = g.index.get(id);
  if (li === undefined) return null;
  const m = g.meta;
  const r = (m.lat0 - lat) / m.step, c = (lon - m.lon0) / m.step;
  if (!(r >= 0 && c >= 0 && r <= m.rows - 1 && c <= m.cols - 1)) return null;
  const r0 = Math.min(m.rows - 2, Math.floor(r)), c0 = Math.min(m.cols - 2, Math.floor(c));
  const fr = r - r0, fc = c - c0;
  const plane = m.rows * m.cols, base = li * plane;
  const at = (rr: number, cc: number): number => g.data[base + rr * m.cols + cc];
  const v = (1 - fr) * ((1 - fc) * at(r0, c0) + fc * at(r0, c0 + 1)) + fr * ((1 - fc) * at(r0 + 1, c0) + fc * at(r0 + 1, c0 + 1));
  return v / (m.layers[li].scale ?? 1);
}

/** The mean of some hours' vectors and speeds, as a WindHour (hourUtc / hourLocal of the first). */
function combine(hs: Array<{ u: number; v: number; s: number; hourUtc: number; hourLocal: number }>, R: WindRules): WindHour {
  const n = Math.max(1, hs.length);
  const u = hs.reduce((a, h) => a + h.u, 0) / n, v = hs.reduce((a, h) => a + h.v, 0) / n, s = hs.reduce((a, h) => a + h.s, 0) / n;
  const vec = Math.hypot(u, v);
  const steady = s > 0 ? Math.min(1, vec / s) : 0;
  // Meteorological "from": the vector points where the air goes, so it comes from the opposite way.
  const fromDeg = steady >= R.steadyMin && vec > 0.05 ? (Math.atan2(-u, -v) / D2R + 360) % 360 : null;
  return { hourUtc: hs[0]?.hourUtc ?? 0, hourLocal: hs[0]?.hourLocal ?? 0, fromDeg, meanMs: s, vecMs: vec, steady };
}

export function windWords(h: WindHour, R: WindRules): string {
  const kt = Math.round(h.meanMs * KT);
  if (h.fromDeg === null) return `variable, mean ${kt} kt`;
  return `from ${compass8(h.fromDeg)} ${kt} kt, ${h.steady >= R.steadyWord ? 'steady' : 'mostly'}`;
}

/** The month's wind at a point (month 1-12; `utcOffsetH` turns the grid's UTC hours into the local clock, PKT 5). */
export function windAt(g: WindGrid | null, lon: number, lat: number, month: number, utcOffsetH: number, R: WindRules): WindReading | null {
  if (!g) return null;
  const mm = String(Math.min(12, Math.max(1, Math.round(month)))).padStart(2, '0');
  const raw: Array<{ u: number; v: number; s: number; hourUtc: number; hourLocal: number }> = [];
  for (const h of g.meta.hoursUtc ?? [0, 6, 12, 18]) {
    const hh = String(h).padStart(2, '0');
    const u = sample(g, `u_${mm}_${hh}`, lon, lat), v = sample(g, `v_${mm}_${hh}`, lon, lat), s = sample(g, `s_${mm}_${hh}`, lon, lat);
    if (u === null || v === null || s === null) return null;
    raw.push({ u, v, s, hourUtc: h, hourLocal: (((h + utcOffsetH) % 24) + 24) % 24 });
  }
  const hours = raw.map((h) => combine([h], R));
  const isDay = (h: { hourLocal: number }): boolean => h.hourLocal >= 6 && h.hourLocal < 18;
  const all = combine(raw, R), day = combine(raw.filter(isDay), R), night = combine(raw.filter((h) => !isDay(h)), R);
  const turns = day.fromDeg !== null && night.fromDeg !== null && angDiff(day.fromDeg, night.fromDeg) >= R.turnDeg;
  const light = all.meanMs * KT < R.lightKt;
  let text = turns ? `by day ${windWords(day, R)}; by night ${windWords(night, R)}` : windWords(all, R);
  if (light) text += ' (light)';
  return {
    month: Number(mm), hours, all, day, night, turns, light, variable: all.fromDeg === null, text,
    source: String(g.meta.source ?? 'ERA5'), dataDate: String(g.meta.sourceRef?.dataDate ?? '1990-2019 normal'),
  };
}

// ── readings ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface LzWind {
  /** The sector the run-in comes from (downwind of the LZ) and the one it leaves by (upwind), degrees; null: no wind named. */
  runIn: number | null;
  leave: number | null;
  /** both clear / run-in only / leave only / neither / light (any clear approach) / variable (keep two opposite). */
  fit: 'both' | 'in' | 'out' | 'neither' | 'light' | 'variable';
  text: string;
}

/** Landing and taking off into the wind, read on the LZ's approaches clear by 10 : 1 (outward bearings, 45° steps). */
export function lzWind(approaches: number[], w: WindReading | null, R: WindRules): LzWind | null {
  if (!w) return null;
  const h = w.all;
  if (w.variable || h.fromDeg === null) return { runIn: null, leave: null, fit: 'variable', text: `Wind ${windWords(h, R)}: keep two opposite approaches clear` };
  const snap = (d: number): number => (Math.round((((d % 360) + 360) % 360) / 45) % 8) * 45;
  const runIn = snap(h.fromDeg + 180), leave = snap(h.fromDeg);
  const has = (b: number): boolean => approaches.some((a) => angDiff(a, b) < 1);
  const i = has(runIn), o = has(leave);
  const lead = `Wind ${windWords(h, R)}`;
  if (w.light) return { runIn, leave, fit: 'light', text: `${lead}: light, any clear approach serves` };
  const fit = i && o ? 'both' : i ? 'in' : o ? 'out' : 'neither';
  const t = {
    both: `run in from ${compass8(runIn)}, leave to ${compass8(leave)}: both clear`,
    in: `run in from ${compass8(runIn)} clear; leave to ${compass8(leave)} not clear by 10 : 1: take off across the wind, check on the ground`,
    out: `run in from ${compass8(runIn)} not clear by 10 : 1; leave to ${compass8(leave)} clear: land across the wind or choose another LZ`,
    neither: `neither the run-in from ${compass8(runIn)} nor the way out to ${compass8(leave)} is clear: land across the wind or choose another LZ`,
  }[fit];
  return { runIn, leave, fit, text: `${lead}: ${t}${w.turns ? ` (it turns: by night ${windWords(w.night, R)})` : ''}` };
}

/** Jumpers drift downwind: the release point lies upwind of the DZ. */
export function dzWind(w: WindReading | null, R: WindRules): string | null {
  if (!w) return null;
  const h = w.all;
  if (h.fromDeg === null) return `Wind ${windWords(h, R)}: the drift cannot be planned from the normal, get it from Met`;
  return `Wind ${windWords(h, R)}: jumpers drift to ${compass8(h.fromDeg + 180)}, release upwind (${compass8(h.fromDeg)} side) of the DZ, clear ground on its ${compass8(h.fromDeg + 180)} edge`;
}

/** Where smoke and agents drift (IBB p 109; OoW Vol II p 93). */
export function downwind(w: WindReading | null, R: WindRules): string | null {
  if (!w) return null;
  const h = w.all;
  if (h.fromDeg === null) return `Wind ${windWords(h, R)}: no usual drift, get it from Met`;
  return `smoke and agents drift to ${compass8(h.fromDeg + 180)} (wind ${windWords(h, R)})`;
}

/** An avenue's heading against the wind: the wind behind it, into it, or across it (proforma g, the user signs it). */
export function avenueWind(headingDeg: number, w: WindReading | null, R: WindRules): string | null {
  if (!w) return null;
  const h = w.all;
  if (h.fromDeg === null) return 'wind variable';
  const d = angDiff(headingDeg, (h.fromDeg + 180) % 360); // 0: moving with the wind
  const rel = d <= 45 ? 'wind behind it' : d >= 135 ? 'into the wind' : 'wind across it';
  return `${rel} (from ${compass8(h.fromDeg)})`;
}

// ── loader ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The bundle's wind grid, fetched on first use (`get()` starts it and returns null until it is in). */
export class WindLoader {
  private _grid: WindGrid | null = null;
  private _state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';

  constructor(
    private readonly _indexUrl: string,
    private readonly _dataUrl: string,
    private readonly _onReady: () => void,
  ) {}

  get state(): string {
    return this._state;
  }
  get(): WindGrid | null {
    if (this._state === 'idle') void this._load();
    return this._grid;
  }
  private async _load(): Promise<void> {
    this._state = 'loading';
    try {
      const [h, d] = await Promise.all([fetch(this._indexUrl), fetch(this._dataUrl)]);
      if (!h.ok || !d.ok) throw new Error(`HTTP ${h.status} / ${d.status}`);
      this._grid = parseWind(await h.json(), await d.arrayBuffer());
      this._state = 'ready';
      this._onReady();
    } catch {
      this._state = 'failed';
    }
  }
}
