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
 * with ground the book could not assess taken as GO, LATEST at night rates with it taken as SLOW-GO. En infantry on foot in
 * the plains march at his own 4.5 km/h by day (IC s113 para 20 c (1) p 664) when the caller passes it (`decRatesFrom`
 * `enemyFootDayKmh`): faster than IPB's 4, so it drives his EARLIEST time, IPB beside.
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
  /** The going along it, in order; `riseM` the ascent inside the stretch (metres climbed), `fallM` its descent. */
  going: Array<{ fromM: number; toM: number; cls: DecCls; riseM?: number; fallM?: number }>;
  narrows: Array<{ alongM: number; widthM: number; kind: 'crossing' | 'slow' | 'narrow' | 'steep' }>;
  /** Where own depth localities stand along it (the rearmost own Posn beside it), metres; null when none. */
  depthM: number | null;
  /** The En FUP on an approach onto the objective, along it (metres); null or absent when none (OoW Vol I p 51: a TAI). */
  fupM?: number | null;
}
export interface DecRates {
  /** km/h [day, night] for GO, SLOW-GO, NO-GO (NO-GO night: the slower figure). */
  go: [number, number];
  slow: [number, number];
  nogo: [number, number];
  /**
   * Men on foot pay the climb (MW p 81: 30-60 min per 300 m of ascent): minutes per 300 m [earliest, latest]; null for
   * vehicles. The same figure the Intelligent Deployment tab's moves pay (PlanDoctrine terrain.kinds.mountain). The books
   * differ: IC s113 para 20 c (2) p 664 adds one hour per 300 m of ascent for the Foxland (En) infantry, the same as MW's
   * latest; MW's 30 min stays the earliest (the faster, safety first for the En's times).
   */
  climbMinPer300?: [number, number] | null;
  /**
   * Men on foot pay the descent too (MW p 81: 30-60 min per 600 m): [earliest, latest]; null for vehicles. IC s113 para
   * 20 c (2) p 664 adds one hour per 450 m of descent for the En infantry: slower than MW's, told beside, never driving.
   */
  descentMinPer600?: [number, number] | null;
  /**
   * The GO day rate was raised to the En infantry's own march rate (IC s113 para 20 c (1) p 664: 4.5 km/h in the plains by
   * day), faster than IPB p 18's 4: the En's earliest time is never later than his own doctrine allows. Null: IPB's stands.
   */
  enemyDayKmh?: { kmh: number; ipbKmh: number } | null;
  /** The GO rates are MW's mountain rates (3 km/h by day, 0.5 by night), SLOW-GO / NO-GO capped at them. */
  mountain?: boolean;
}
export interface DecArgs {
  aas: DecAaIn[];
  crossovers: Array<{ id: string; a: string; b: string; alongM: number }>;
  rates: DecRates;
  /** From the enemy's start to each avenue's start, metres (0: he starts at the area's edge; negative: he starts that far inside it). */
  leadM: Record<string, number>;
  /** The book's lead for a DP (2 h) and the own action's time on top, hours. */
  leadH: number;
  reactionH: number;
  /** The corridor width: a narrows narrower than it is a TAI. */
  mcWidthM: number;
  /** The counter-attack's time, minutes (null: no counter-attack DP). */
  catkMin: number | null;
  catkLabel: string;
  /**
   * The enemy's courses of action (ATP 2-01.3 6-7..6-13: COAs ranked most likely to least, and the most dangerous;
   * 2026-11-23): own fire on each avenue (% under fire, from the fire corridors), the avenue of his turning approach onto
   * own MSR, and the avenue his doctrinal template is laid along; left out: no COAs.
   */
  coa?: { fire?: Record<string, number>; turnAa?: string | null; templateAa?: string | null };
  /** The Indian reserves' reaction (IDD p 5), read when the reading is of the En defence (own attack): hours after H or after the decision. */
  reserves?: Array<{ level: string; h: [number, number]; from: 'attack' | 'decision'; what?: string }> | null;
  /** The book the ladder comes from (IDD p 5, or GSP 1947 p 83 by the reserveLadder setting). */
  reservesSrc?: string;
  /** The cues that confirm the En main effort (OoW Vol I p 54), named on the counter-attack DP. */
  catkCues?: string[] | null;
}
export interface DecReserve {
  level: string;
  fromH: number;
  toH: number;
  from: 'attack' | 'decision';
  what: string;
  text: string;
}
export interface DecCoa {
  id: 'COA 1' | 'COA 2';
  kind: 'likely' | 'dangerous';
  aa: string;
  why: string[];
  /** The NAI whose activity confirms this COA against the other (null: none tells them apart). */
  indicatorNai: string | null;
  endH: [number, number];
}

export interface DecNai {
  id: string;
  n: number;
  aa: string;
  alongM: number;
  kind: 'entry' | 'crossing' | 'narrows' | 'slow' | 'crossover' | 'fup';
  shows: string;
  earliestH: number;
  latestH: number;
  tai: string | null;
  widthM: number | null;
  /** The COAs activity here points to (the avenue's); every NAI carries its own avenue's COA. */
  coas?: string[];
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
  /** COA 1 most likely, COA 2 most dangerous (ATP 2-01.3); null when not asked or one avenue only. */
  coas: DecCoa[] | null;
  /** The Indian reserves' ladder (own attack only), else empty. */
  reserves: DecReserve[];
  notes: string[];
}

/**
 * The book's rates (IpbDoctrine.json `rates`) for a mover: vehicles for armour and mech, foot for dismounted. In mountains
 * (`opts.mountain`) men on foot move at MW's rates (p 81: 3 km/h by day, 0.5-1 by night; the latest takes 0.5), and no
 * worse going is faster than the GO rate; they pay the climb and the descent everywhere.
 */
/**
 * The rates for the mover (IPB p 18; MW p 81 in the mountains). `enemyFootDayKmh`: when the avenues are the En's and he is
 * on foot in the plains, his own day march rate (IC s113 para 20 c (1) p 664, 4.5 km/h; OcokaDoctrine
 * `enemyMarch.footKmhDay`) raises the GO day rate when faster than IPB's (safety first: his earliest time); IPB is kept
 * beside in `enemyDayKmh`. The caller passes it only for the En's avenues; never in the mountains (IC's figure is the
 * plains', MW's mountain rates stand).
 */
export function decRatesFrom(doc: any, mover: 'armour' | 'mech' | 'dismounted', opts: { mountain?: boolean; enemyFootDayKmh?: number | null } = {}): DecRates {
  const r = doc?.rates ?? {};
  const t = mover === 'dismounted' ? (r.footKmh ?? { go: [4, 3.2], slow: [2.4, 1.6], nogo: [1, [0.1, 0.5]] }) : (r.vehicleKmh ?? { go: [24, 24], slow: [16, 8], nogo: [1, [0.1, 0.5]] });
  const pair = (v: any, d: [number, number]): [number, number] => {
    if (!Array.isArray(v)) return d;
    const night = Array.isArray(v[1]) ? Math.min(...v[1]) : Number(v[1]);
    return [Number(v[0]) || d[0], night || d[1]];
  };
  const climb = Array.isArray(r.mountain?.addMinPer300mAscent) ? (r.mountain.addMinPer300mAscent as [number, number]) : [30, 60];
  const desc = Array.isArray(r.mountain?.addMinPer600mDescent) ? (r.mountain.addMinPer600mDescent as [number, number]) : [30, 60];
  const foot = mover === 'dismounted';
  let go = pair(t.go, [24, 24]), slow = pair(t.slow, [16, 8]), nogo = pair(t.nogo, [1, 0.1]);
  const mtn = foot && !!opts.mountain;
  if (mtn) {
    const day = Number(r.mountain?.dayKmh) || 3;
    const nk = r.mountain?.nightKmh;
    const night = Array.isArray(nk) ? Math.min(...nk.map(Number)) : Number(nk) || 0.5;
    go = [day, night];
    slow = [Math.min(slow[0], day), Math.min(slow[1], night)];
    nogo = [Math.min(nogo[0], day), Math.min(nogo[1], night)];
  }
  let enemyDayKmh: DecRates['enemyDayKmh'] = null;
  const fox = Number(opts.enemyFootDayKmh);
  if (foot && !mtn && Number.isFinite(fox) && fox > go[0]) {
    enemyDayKmh = { kmh: fox, ipbKmh: go[0] };
    go = [fox, go[1]];
  }
  return {
    go, slow, nogo, enemyDayKmh,
    climbMinPer300: foot ? [Number(climb[0]) || 30, Number(climb[1]) || 60] : null,
    descentMinPer600: foot ? [Number(desc[0]) || 30, Number(desc[1]) || 60] : null,
    mountain: mtn,
  };
}

const SHOWS: Record<DecNai['kind'], string> = {
  entry: 'lead elements enter the area',
  crossing: 'columns close up at the crossing; bridging stores, engineers forward',
  narrows: 'columns close up to pass the narrows; deploying beyond it',
  slow: 'columns slow and close up in SLOW-GO',
  crossover: 'columns switch to the other avenue',
  fup: 'assaulting elements close up and shake out in the FUP; supporting fire starts',
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
    const pos = Math.max(0, lead);
    const lead0 = (pos / 1000) / a.rates.go[0], lead1 = (pos / 1000) / a.rates.go[1];
    // Cumulative times at each stretch's start.
    const segs = aa.going.filter((g) => g.toM > g.fromM).sort((p, q) => p.fromM - q.fromM);
    const raw = (alongM: number, late: boolean): number => {
      let t = late ? lead1 : lead0;
      if (alongM <= aa.startM) {
        // Before the avenue: on the way in from the enemy's start, at GO.
        return t - ((aa.startM - alongM) / 1000) / a.rates.go[late ? 1 : 0];
      }
      const climb = a.rates.climbMinPer300;
      const desc = a.rates.descentMinPer600;
      for (const g of segs) {
        if (g.fromM >= alongM) break;
        const len = Math.min(alongM, g.toM) - g.fromM;
        t += (len / 1000) / speed(g.cls, late);
        // The climb inside the stretch (its share, when the stretch is only partly covered): 30 min per 300 m at his
        // earliest, 60 at his latest (MW p 81), on foot only; IC s113 para 20 c (2) p 664 gives the En infantry 1 h per
        // 300 m (MW's latest): the faster MW figure stays his earliest, safety first.
        if (climb && g.riseM) t += ((g.riseM * (len / Math.max(1e-6, g.toM - g.fromM))) / 300) * (climb[late ? 1 : 0] / 60);
        // The descent likewise: 30 min per 600 m at his earliest, 60 at his latest (MW p 81); IC p 664's 1 h per 450 m is
        // slower and is not used.
        if (desc && g.fallM) t += ((g.fallM * (len / Math.max(1e-6, g.toM - g.fromM))) / 600) * (desc[late ? 1 : 0] / 60);
      }
      return t;
    };
    // A negative lead: he starts inside the avenue, `-lead` past its start (the threat marker there). His clock is 0
    // at that place, at his own going on the way there, not at the edge.
    const off0 = lead < 0 ? raw(aa.startM - lead, false) : 0;
    const off1 = lead < 0 ? raw(aa.startM - lead, true) : 0;
    const fn = (alongM: number, late: boolean): number => raw(alongM, late) - (late ? off1 : off0);
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
      const kind: DecNai['kind'] = nw.kind === 'crossing' ? 'crossing' : nw.kind === 'slow' || nw.kind === 'steep' ? 'slow' : 'narrows';
      raw.push({ aa: aa.id, alongM: nw.alongM, kind, shows: SHOWS[kind], earliestH: fn(nw.alongM, false), latestH: fn(nw.alongM, true), tai: null, widthM: nw.widthM });
    }
  }
  // The En FUP on an approach onto the objective: he concentrates there (OoW Vol I p 51: engage him in the FAA and FUP).
  for (const aa of a.aas) {
    if (aa.fupM === null || aa.fupM === undefined || !(aa.fupM > aa.startM && aa.fupM <= aa.endM)) continue;
    const fn = timeAt.get(aa.id)!;
    raw.push({ aa: aa.id, alongM: aa.fupM, kind: 'fup', shows: SHOWS.fup, earliestH: fn(aa.fupM, false), latestH: fn(aa.fupM, true), tai: null, widthM: null });
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
    tais.push({ id: '', n: 0, nai: n.id, aa: n.aa, alongM: n.alongM, why: n.kind === 'crossing' ? `the crossing (${Math.round(n.widthM ?? 0)} m): denied, the En needs bridging` : `narrows ${Math.round(n.widthM ?? 0)} m, under a corridor's width: blocked, the En cannot pass deployed`, earliestH: n.earliestH, latestH: n.latestH });
  }
  // The FUPs: a TAI each beside the two per avenue (OoW Vol I p 51; DF in depth disrupts his preparation, p 41).
  for (const n of nais.filter((x) => x.kind === 'fup')) {
    tais.push({ id: '', n: 0, nai: n.id, aa: n.aa, alongM: n.alongM, why: 'the En FUP: engage him while he forms up (OoW Vol I p 51), DF in depth', earliestH: n.earliestH, latestH: n.latestH });
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
      dps.push({ id: '', n: 0, kind: 'catk', aa: aa.id, tai: null, alongM: at.alongM, beyondM: Math.max(0, aa.startM - at.alongM), beforeH: at.beforeH, earliestH: tDepth - a.catkMin / 60, decision: `Launch the counter-attack (${a.catkLabel}, ${a.catkMin} min) while the depth localities on ${aa.id} still hold${a.catkCues?.length ? `; first confirm the En main effort is on ${aa.id}: ${a.catkCues.join(', ')} (OoW Vol I p 54)` : ''}` });
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
  // COAs: most likely (his template's avenue, else the best going), most dangerous (the one that hurts you most: onto
  // your MSR, least under your fire, fastest through), and the NAI that tells them apart (ATP 2-01.3 6-7..6-13, 6-20).
  let coas: DecCoa[] | null = null;
  if (a.coa) {
    const viable = a.aas.filter((x) => x.viable);
    const prof = (id: string) => profiles.find((p) => p.aa === id);
    const likely = (a.coa.templateAa && viable.find((x) => x.id === a.coa!.templateAa)) ?? viable.find((x) => x.main) ?? viable[0];
    if (likely) {
      const fire = a.coa.fire ?? {};
      const whyL = [a.coa.templateAa === likely.id ? 'the En doctrinal template is laid along it' : 'the best going of the avenues read', `${likely.id} through the area ${hPlus(prof(likely.id)?.endH[0] ?? 0)} at the earliest`];
      if (fire[likely.id] !== undefined) whyL.push(`${Math.round(fire[likely.id])} % of it under your fire`);
      const rest = viable.filter((x) => x.id !== likely.id);
      const fastest = rest.length ? Math.min(...rest.map((x) => prof(x.id)?.endH[0] ?? Infinity)) : Infinity;
      const scored = rest.map((x) => {
        let s = 0;
        const why: string[] = [];
        if (a.coa!.turnAa === x.id) ((s += 3), why.push('the En turning approach: onto your MSR, round your front'));
        const f = fire[x.id];
        if (f !== undefined) {
          if (f < (fire[likely.id] ?? 100)) ((s += 2), why.push(`less of it under your fire than COA 1 (${Math.round(f)} % against ${Math.round(fire[likely.id] ?? 100)} %)`));
          else why.push(`${Math.round(f)} % under your fire`);
        }
        const e = prof(x.id)?.endH[0] ?? Infinity;
        if (e <= fastest + 1e-6 && rest.length > 1) ((s += 1), why.push(`the fastest through the area of the others (${hPlus(e)})`));
        else why.push(`through the area ${hPlus(e)} at the earliest`);
        return { x, s, why };
      });
      scored.sort((p, q) => q.s - p.s);
      const dangerous = scored[0];
      const firstNai = (aa: string): DecNai | undefined => nais.filter((n) => n.aa === aa).sort((p, q) => p.alongM - q.alongM)[0];
      coas = [{ id: 'COA 1', kind: 'likely', aa: likely.id, why: whyL, indicatorNai: firstNai(likely.id)?.id ?? null, endH: prof(likely.id)?.endH ?? [0, 0] }];
      if (dangerous) coas.push({ id: 'COA 2', kind: 'dangerous', aa: dangerous.x.id, why: dangerous.why, indicatorNai: firstNai(dangerous.x.id)?.id ?? null, endH: prof(dangerous.x.id)?.endH ?? [0, 0] });
      else notes.push('One avenue only: no second course of action to set against the first.');
      for (const n of nais) n.coas = coas.filter((c) => c.aa === n.aa).map((c) => c.id);
    }
  }
  // The Indian reserves (IDD p 5), when the reading is of the En defence: when each can be on the objective.
  const reserves: DecReserve[] = (a.reserves ?? []).map((r) => {
    const what = r.what ?? '';
    // under an hour in minutes (GSP p 83: a Coy within 35-40 minutes)
    const t = (h: number) => (h < 1 ? `${Math.round(h * 60)}` : `${h}`), unit = r.h[1] < 1 ? 'min' : 'h';
    const span = r.h[0] === r.h[1] ? `${t(r.h[0])} ${unit}` : `${t(r.h[0])}-${t(r.h[1])} ${unit}`;
    return { level: r.level, fromH: r.h[0], toH: r.h[1], from: r.from, what, text: `En ${r.level} reserve${what ? ` (${what})` : ''}: reacts ${span} after ${r.from === 'decision' ? 'his decision' : 'the attack starts'} (${a.reservesSrc ?? 'IDD p 5'})` };
  });
  const hp = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${h}`);
  if (reserves.length) notes.push(`Be firm on the Obj before H+${hp(reserves[0].fromH)}: the En ${reserves[0].level} reserve can react by then (${a.reservesSrc ?? 'IDD p 5'})`);
  return { profiles, nais, tais, dps, coas, reserves, notes };
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
  /** The month's usual wind (ERA5 normal, GroundGuideWind): its direction is added to the wind rows. */
  wind?: { dirText: string; all: { fromDeg: number | null } } | null;
}

const COMPASS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
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

/** One of MW's mountain weather notes for the month and height (IpbDoctrine coding.season.mountainWx). */
export interface MountainWxNote { id: string; for: Array<'fire' | 'mnvr' | 'air'>; text: string }

/**
 * MW's weather and snow notes on mountain ground (IpbDoctrine `coding.season.mountainWx`): the fog in the valleys till
 * 0900-1000 (p 229), poor visibility above 2000 m (pp 229-230), snow hiding the tracks above 2500 m in winter (p 298),
 * how snow slides start (pp 69, 71), flash floods in the nullahs (p 9), weather from the west (pp 10, 288). An item with
 * `aboveM` needs the area that high (an unknown height keeps it out); one with `winter` needs a winter month. None off
 * the mountains. Notes only: nothing here codes GO / NO-GO.
 */
export function mountainWxNotes(doc: any, o: { month: number; elevM: number | null; mountain: boolean }): MountainWxNote[] {
  if (!o.mountain) return [];
  const W = doc?.coding?.season?.mountainWx ?? {};
  const items: any[] = Array.isArray(W.items) ? W.items : [];
  const winter: number[] = Array.isArray(W.winterMonths?.value) ? W.winterMonths.value.map(Number) : [11, 12, 1, 2, 3, 4];
  const out: MountainWxNote[] = [];
  for (const it of items) {
    if (!it?.text) continue;
    const above = Number(it.aboveM);
    if (Number.isFinite(above) && !(o.elevM !== null && o.elevM >= above)) continue;
    if (it.winter && !winter.includes(o.month)) continue;
    const uses = (Array.isArray(it.for) ? it.for : ['mnvr']).filter((u: string): u is 'fire' | 'mnvr' | 'air' => u === 'fire' || u === 'mnvr' || u === 'air');
    out.push({ id: String(it.id ?? ''), for: uses, text: String(it.text) });
  }
  return out;
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
      // Speed from WorldClim (the finer grid); the direction from the wind grid, and for smoke / agents where they drift.
      const dir = w.wind ? `; ${w.wind.dirText}${/NBC/.test(r.mission) && w.wind.all.fromDeg !== null ? `, drifts to ${COMPASS8[Math.round(((w.wind.all.fromDeg + 180) % 360) / 45) % 8]}` : ''}` : '';
      return { ...base, status: judge(windKt, r.go, r.marginal), value: `mean ${r1(windKt)} kt (not gusts)${dir}` };
    }
    if (e === 'rainfall') {
      const p = w.clim?.prec[m];
      return { ...base, status: 'na' as WxStatus, value: `rate not in the bundle${p != null ? ` (${Math.round(p)} mm in the month)` : ''}` };
    }
    if (e === 'snow depth') return { ...base, status: 'na' as WxStatus, value: 'not in the bundle' };
    return { ...base, status: 'met' as WxStatus, value: 'get from Met' };
  });
}
