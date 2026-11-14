/**
 * GroundGuideIpbDecision.ts
 *
 * Rates of movement, the event template and decision support over the IPB avenues (IPB_Plan.md §6.6, §6.7; Phase 5),
 * and the Annex A weather critical values for the month and place. Pure: no DOM, no view, no I/O (Node:
 * `node tools/ipb-test/decision.mjs`).
 *
 * Time along an avenue (book p 18): GO, SLOW-GO and NO-GO stretches at the book's rates for the mover (vehicles 24 / 16
 * / 1 km/h by day; foot 4 / 2.4 / 1), from the enemy's start (the threat marker's place, else the area's edge). Two
 * times for every place, so the defender never counts on the enemy being slower than he may be: EARLIEST at day rates
 * with ground the book could not assess taken as GO, LATEST at night rates with it taken as SLOW-GO.
 * Event template (pp 23-28): NAIs where the enemy shows himself: where an avenue enters the area, its narrows and
 * crossings, where it meets another (crossover). Decision support (pp 28-32): TAIs are NAIs where interdiction would make
 * him abandon the avenue or need unusual engineer support (a crossing; a narrows narrower than a corridor); a DECISION
 * POINT for each TAI where he is still `leadH` (2 h, p 30) plus the own action's time short of it, at his earliest. A
 * counter-attack DP (OoW Vol I p 54): where he is the counter-attack's time (Coy 30 min, Bn 1 h) short of the depth
 * localities, so it goes in while they still hold. A DP that falls before he enters the area lies beyond it, toward him:
 * said in km, a matter for the higher HQ's NAIs.
 */

export type DecCls = 'go' | 'slow' | 'nogo' | 'na';
export interface DecAaIn {
  id: string;
  viable: boolean;
  main: boolean;
  startM: number;
  endM: number;
  /** The going along it, in order. */
  going: Array<{ fromM: number; toM: number; cls: DecCls }>;
  narrows: Array<{ alongM: number; widthM: number; kind: 'crossing' | 'slow' | 'narrow' }>;
  /** Where own depth localities stand along it (the rearmost own Posn beside it), metres; null when none. */
  depthM: number | null;
}
export interface DecRates {
  /** km/h [day, night] for GO, SLOW-GO, NO-GO (NO-GO night: the slower figure). */
  go: [number, number];
  slow: [number, number];
  nogo: [number, number];
}
export interface DecArgs {
  aas: DecAaIn[];
  crossovers: Array<{ id: string; a: string; b: string; alongM: number }>;
  rates: DecRates;
  /** From the enemy's start to each avenue's start, metres (0: he starts at the area's edge). */
  leadM: Record<string, number>;
  /** The book's lead for a DP (2 h) and the own action's time on top, hours. */
  leadH: number;
  reactionH: number;
  /** The corridor width: a narrows narrower than it is a TAI. */
  mcWidthM: number;
  /** The counter-attack's time, minutes (null: no counter-attack DP). */
  catkMin: number | null;
  catkLabel: string;
}

export interface DecNai {
  id: string;
  n: number;
  aa: string;
  alongM: number;
  kind: 'entry' | 'crossing' | 'narrows' | 'slow' | 'crossover';
  shows: string;
  earliestH: number;
  latestH: number;
  tai: string | null;
  widthM: number | null;
}
export interface DecTai {
  id: string;
  n: number;
  nai: string;
  aa: string;
  alongM: number;
  why: string;
  earliestH: number;
  latestH: number;
}
export interface DecDp {
  id: string;
  n: number;
  kind: 'interdict' | 'catk';
  aa: string;
  tai: string | null;
  /** Along the avenue, metres (below its start when it lies before he enters the area); and how far before the area's edge. */
  alongM: number;
  beyondM: number;
  /** Before the enemy even starts (H): decide before H. */
  beforeH: boolean;
  earliestH: number;
  /** What falls due there (a suggestion; the decision is the commander's). */
  decision: string;
}
export interface DecProfile {
  aa: string;
  /** [alongM, earliestH, latestH] every ~200 m from the enemy's start (alongM of the avenue's start minus the lead). */
  pts: Array<[number, number, number]>;
  startH: [number, number];
  endH: [number, number];
}
export interface DecResult {
  profiles: DecProfile[];
  nais: DecNai[];
  tais: DecTai[];
  dps: DecDp[];
  notes: string[];
}

/** The book's rates (IpbDoctrine.json `rates`) for a mover: vehicles for armour and mech, foot for dismounted. */
export function decRatesFrom(doc: any, mover: 'armour' | 'mech' | 'dismounted'): DecRates {
  const r = doc?.rates ?? {};
  const t = mover === 'dismounted' ? (r.footKmh ?? { go: [4, 3.2], slow: [2.4, 1.6], nogo: [1, [0.1, 0.5]] }) : (r.vehicleKmh ?? { go: [24, 24], slow: [16, 8], nogo: [1, [0.1, 0.5]] });
  const pair = (v: any, d: [number, number]): [number, number] => {
    if (!Array.isArray(v)) return d;
    const night = Array.isArray(v[1]) ? Math.min(...v[1]) : Number(v[1]);
    return [Number(v[0]) || d[0], night || d[1]];
  };
  return { go: pair(t.go, [24, 24]), slow: pair(t.slow, [16, 8]), nogo: pair(t.nogo, [1, 0.1]) };
}

const SHOWS: Record<DecNai['kind'], string> = {
  entry: 'lead elements enter the area',
  crossing: 'columns close up at the crossing; bridging stores, engineers forward',
  narrows: 'columns close up to pass the narrows; deploying beyond it',
  slow: 'columns slow and close up in SLOW-GO',
  crossover: 'columns switch to the other avenue',
};

export function decide(a: DecArgs): DecResult {
  const notes: string[] = [];
  const speed = (cls: DecCls, late: boolean): number => {
    const k = late ? 1 : 0;
    if (cls === 'go') return a.rates.go[k];
    if (cls === 'slow') return a.rates.slow[k];
    if (cls === 'nogo') return a.rates.nogo[k];
    return late ? a.rates.slow[1] : a.rates.go[0]; // not assessed: GO at its earliest, SLOW-GO at its latest
  };
  const profiles: DecProfile[] = [];
  const timeAt = new Map<string, (alongM: number, late: boolean) => number>();
  for (const aa of a.aas) {
    const lead = a.leadM[aa.id] ?? 0;
    const lead0 = (lead / 1000) / a.rates.go[0], lead1 = (lead / 1000) / a.rates.go[1];
    // Cumulative times at each stretch's start.
    const segs = aa.going.filter((g) => g.toM > g.fromM).sort((p, q) => p.fromM - q.fromM);
    const fn = (alongM: number, late: boolean): number => {
      let t = late ? lead1 : lead0;
      if (alongM <= aa.startM) {
        // Before the avenue: on the way in from the enemy's start, at GO.
        return t - ((aa.startM - alongM) / 1000) / a.rates.go[late ? 1 : 0];
      }
      for (const g of segs) {
        if (g.fromM >= alongM) break;
        const len = Math.min(alongM, g.toM) - g.fromM;
        t += (len / 1000) / speed(g.cls, late);
      }
      return t;
    };
    timeAt.set(aa.id, fn);
    const pts: Array<[number, number, number]> = [];
    const from = aa.startM - lead;
    const step = Math.max(100, (aa.endM - from) / 160);
    for (let m = from; m < aa.endM; m += step) pts.push([m, fn(m, false), fn(m, true)]);
    pts.push([aa.endM, fn(aa.endM, false), fn(aa.endM, true)]);
    profiles.push({ aa: aa.id, pts, startH: [fn(aa.startM, false), fn(aa.startM, true)], endH: [fn(aa.endM, false), fn(aa.endM, true)] });
  }
  // NAIs: entry, narrows, crossovers; numbered by the earliest time.
  const raw: Array<Omit<DecNai, 'id' | 'n'>> = [];
  for (const aa of a.aas) {
    const fn = timeAt.get(aa.id)!;
    raw.push({ aa: aa.id, alongM: aa.startM, kind: 'entry', shows: SHOWS.entry, earliestH: fn(aa.startM, false), latestH: fn(aa.startM, true), tai: null, widthM: null });
    for (const nw of aa.narrows) {
      const kind: DecNai['kind'] = nw.kind === 'crossing' ? 'crossing' : nw.kind === 'slow' ? 'slow' : 'narrows';
      raw.push({ aa: aa.id, alongM: nw.alongM, kind, shows: SHOWS[kind], earliestH: fn(nw.alongM, false), latestH: fn(nw.alongM, true), tai: null, widthM: nw.widthM });
    }
  }
  for (const x of a.crossovers) {
    const fn = timeAt.get(x.a);
    if (!fn) continue;
    raw.push({ aa: x.a, alongM: x.alongM, kind: 'crossover', shows: `columns switch between ${x.a} and ${x.b}`, earliestH: fn(x.alongM, false), latestH: fn(x.alongM, true), tai: null, widthM: null });
  }
  raw.sort((p, q) => p.earliestH - q.earliestH);
  const nais: DecNai[] = raw.map((r, i) => ({ ...r, id: `NAI ${i + 1}`, n: i + 1 }));
  // TAIs: on the avenues (not lone corridors), crossings and narrows narrower than a corridor; two per avenue at most.
  const taiCands = nais.filter((n) => {
    const aa = a.aas.find((x) => x.id === n.aa);
    return aa?.viable && (n.kind === 'crossing' || ((n.kind === 'narrows' || n.kind === 'slow') && (n.widthM ?? Infinity) < a.mcWidthM));
  });
  const perAa = new Map<string, number>();
  const tais: DecTai[] = [];
  for (const n of [...taiCands].sort((p, q) => (p.kind === 'crossing' ? 0 : 1) - (q.kind === 'crossing' ? 0 : 1) || (p.widthM ?? 0) - (q.widthM ?? 0))) {
    const c = perAa.get(n.aa) ?? 0;
    if (c >= 2) continue;
    perAa.set(n.aa, c + 1);
    tais.push({ id: '', n: 0, nai: n.id, aa: n.aa, alongM: n.alongM, why: n.kind === 'crossing' ? `the crossing (${Math.round(n.widthM ?? 0)} m): denied, he needs bridging` : `narrows ${Math.round(n.widthM ?? 0)} m, under a corridor's width: blocked, he cannot pass deployed`, earliestH: n.earliestH, latestH: n.latestH });
  }
  tais.sort((p, q) => p.earliestH - q.earliestH);
  tais.forEach((t, i) => {
    t.n = i + 1;
    t.id = `TAI ${t.n}`;
    const nai = nais.find((x) => x.id === t.nai);
    if (nai) nai.tai = t.id;
  });
  // DPs: interdiction (lead before each TAI at his earliest), then the counter-attack per avenue with depth.
  const back = (aa: DecAaIn, targetH: number): { alongM: number; beforeH: boolean } => {
    const fn = timeAt.get(aa.id)!;
    const lead = a.leadM[aa.id] ?? 0;
    // Before he even starts (time < 0): decide before H; the place is his start.
    if (targetH < 0) return { alongM: aa.startM - lead, beforeH: true };
    // Inside the avenue: bisection on the time profile; before it: on the way in, at GO.
    if (targetH < fn(aa.startM, false)) return { alongM: aa.startM - (fn(aa.startM, false) - targetH) * a.rates.go[0] * 1000, beforeH: false };
    let lo = aa.startM, hi = aa.endM;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (fn(mid, false) < targetH) lo = mid;
      else hi = mid;
    }
    return { alongM: lo, beforeH: false };
  };
  const dps: DecDp[] = [];
  const lead = a.leadH + a.reactionH;
  for (const t of tais) {
    const aa = a.aas.find((x) => x.id === t.aa)!;
    const at = back(aa, t.earliestH - lead);
    dps.push({ id: '', n: 0, kind: 'interdict', aa: aa.id, tai: t.id, alongM: at.alongM, beyondM: Math.max(0, aa.startM - at.alongM), beforeH: at.beforeH, earliestH: t.earliestH - lead, decision: `Interdict at ${t.id} (${t.why.split(':')[0]})? Fire, obstacle or a force to block it: ordered here to be in place in time` });
  }
  if (a.catkMin !== null) {
    for (const aa of a.aas) {
      if (!aa.viable || aa.depthM === null || aa.depthM <= aa.startM) continue;
      const fn = timeAt.get(aa.id)!;
      const tDepth = fn(aa.depthM, false);
      const at = back(aa, tDepth - a.catkMin / 60);
      dps.push({ id: '', n: 0, kind: 'catk', aa: aa.id, tai: null, alongM: at.alongM, beyondM: Math.max(0, aa.startM - at.alongM), beforeH: at.beforeH, earliestH: tDepth - a.catkMin / 60, decision: `Launch the counter-attack (${a.catkLabel}, ${a.catkMin} min) while the depth localities on ${aa.id} still hold` });
    }
  }
  dps.sort((p, q) => p.earliestH - q.earliestH);
  dps.forEach((d, i) => {
    d.n = i + 1;
    d.id = `DP ${d.n}`;
  });
  if (!tais.length) notes.push('No TAI: no crossing and no narrows under a corridor\'s width on the avenues');
  const far = dps.filter((d) => d.beyondM > 0 && !d.beforeH);
  if (far.length) notes.push(`${far.map((d) => d.id).join(', ')} beyond the area read, toward the enemy: watch it with the higher HQ's NAIs`);
  if (dps.some((d) => d.beforeH)) notes.push('A decision falls due before the enemy starts (H): decide it on the plan, not on events');
  return { profiles, nais, tais, dps, notes };
}

/** "H+1:25" for hours from the enemy's start (negative: "H-0:40"). */
export function hPlus(h: number): string {
  const s = h < 0 ? '-' : '+';
  const m = Math.round(Math.abs(h) * 60);
  return `H${s}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

// ── Annex A weather critical values (book pp 19-20) ──────────────────────────────────────────────────────────────────

export type WxStatus = 'go' | 'marg' | 'unfav' | 'met' | 'na';
export interface WxRow {
  mission: string;
  element: string;
  go: string;
  marginal: string;
  status: WxStatus;
  value: string;
}
export interface WxInput {
  month: number;
  /** The month's visibility (GSOD grid): mean view, % of days under 2 km, % of fog days, km to the station. */
  vis: { meanViewKm: number | null; lt2kmPct: number | null; fogPct: number | null; stationKm: number | null } | null;
  /** Climate normals (WorldClim): monthly mean daily min / max °C, mean wind m/s, precipitation mm. */
  clim: { tmin: Array<number | null>; tmax: Array<number | null>; wind: Array<number | null>; prec: number[] } | null;
}

/** A threshold "> 1.5 km", "< 32 °C": [op, value]. */
function thr(s: string): [string, number] | null {
  const m = /([<>])\s*(-?[\d,.]+)/.exec(s);
  return m ? [m[1], Number(m[2].replace(/,/g, ''))] : null;
}
/** A marginal band "0.8-1.5 km", "0 to -30 °C", "> 32 °C": [lo, hi] (either may be open). */
function band(s: string): [number, number] | null {
  const t = /(-?[\d,.]+)\s*(?:-|to)\s*(-?[\d,.]+)/.exec(s);
  if (t) {
    const a = Number(t[1].replace(/,/g, '')), b = Number(t[2].replace(/,/g, ''));
    return [Math.min(a, b), Math.max(a, b)];
  }
  const o = thr(s);
  if (!o) return null;
  return o[0] === '>' ? [o[1], Infinity] : [-Infinity, o[1]];
}
function judge(v: number, go: string, marginal: string): WxStatus {
  const g = thr(go);
  if (g && ((g[0] === '>' && v > g[1]) || (g[0] === '<' && v < g[1]))) return 'go';
  const b = band(marginal);
  if (b && v >= b[0] && v <= b[1]) return 'marg';
  return 'unfav';
}

/** Annex A rows coded from what the bundle has for the month and place; the rest "get from Met" or not in the bundle. */
export function annexA(rows: Array<{ mission: string; element: string; go: string; marginal: string }>, w: WxInput): WxRow[] {
  const m = Math.min(12, Math.max(1, w.month)) - 1;
  const tmin = w.clim?.tmin[m] ?? null, tmax = w.clim?.tmax[m] ?? null;
  const windMs = w.clim?.wind[m] ?? null;
  const windKt = windMs !== null ? windMs * 1.944 : null;
  const tmean = tmin !== null && tmax !== null ? (tmin + tmax) / 2 : null;
  // Wind chill (Environment Canada / NWS formula) at the month's mean minimum and mean wind.
  let chill: number | null = null;
  if (tmin !== null && windMs !== null) {
    const kmh = windMs * 3.6;
    chill = tmin <= 10 && kmh > 4.8 ? 13.12 + 0.6215 * tmin - 11.37 * kmh ** 0.16 + 0.3965 * tmin * kmh ** 0.16 : tmin;
  }
  const r1 = (v: number): string => (Math.abs(v) >= 10 ? String(Math.round(v)) : v.toFixed(1));
  return rows.map((r) => {
    const base = { mission: r.mission, element: r.element, go: r.go, marginal: r.marginal };
    const e = r.element.toLowerCase();
    if (e === 'visibility') {
      const v = w.vis?.meanViewKm ?? null;
      if (v === null) return { ...base, status: 'na' as WxStatus, value: 'no visibility data here' };
      const extra = [w.vis?.lt2kmPct != null ? `${Math.round(w.vis.lt2kmPct)}% of days under 2 km` : '', w.vis?.fogPct != null && w.vis.fogPct >= 3 ? `fog ${Math.round(w.vis.fogPct)}% of days` : ''].filter(Boolean).join(', ');
      return { ...base, status: judge(v, r.go, r.marginal), value: `mean ${r1(v)} km${extra ? `; ${extra}` : ''}` };
    }
    if (e === 'temperature') {
      // Heat limits read on the hot afternoons (mean maximum), cold limits on the mean minimum, NBC on the mean.
      const g = thr(r.go);
      const v = /NBC/.test(r.mission) ? tmean : g && g[0] === '<' ? tmax : tmin;
      if (v === null) return { ...base, status: 'na' as WxStatus, value: 'no climate data here' };
      return { ...base, status: judge(v, r.go, r.marginal), value: `${/NBC/.test(r.mission) ? 'mean' : g && g[0] === '<' ? 'mean max' : 'mean min'} ${r1(v)} °C` };
    }
    if (e === 'wind chill') {
      if (chill === null) return { ...base, status: 'na' as WxStatus, value: 'no climate data here' };
      return { ...base, status: judge(chill, r.go, r.marginal), value: `${r1(chill)} °C at the mean min and wind` };
    }
    if (e === 'surface wind' || e.startsWith('wind below')) {
      if (windKt === null) return { ...base, status: 'na' as WxStatus, value: 'no climate data here' };
      return { ...base, status: judge(windKt, r.go, r.marginal), value: `mean ${r1(windKt)} kt (not gusts)` };
    }
    if (e === 'rainfall') {
      const p = w.clim?.prec[m];
      return { ...base, status: 'na' as WxStatus, value: `rate not in the bundle${p != null ? ` (${Math.round(p)} mm in the month)` : ''}` };
    }
    if (e === 'snow depth') return { ...base, status: 'na' as WxStatus, value: 'not in the bundle' };
    return { ...base, status: 'met' as WxStatus, value: 'get from Met' };
  });
}
