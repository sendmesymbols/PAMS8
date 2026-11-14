/**
 * MoveRail.ts
 *
 * Rail movement for the Move Planner: vehicles onto wagons, wagons into trains, trains into a timetable. Pure.
 * Rules from MoveDoctrine.json `rail` (SO's Handbook Sec 9 910-913, Staff Duties Vol II Rail Mov):
 *
 *   wagons     each kind of vehicle goes on the stock the table names (2 T-series tks or 1 M-series tk per MBFR, 2 APCs
 *              per BKF, ...); MBFR weighs 64 t with one tank, 96 with two; personnel 60 to a TLR / SLR; stores 20 t to a C.
 *              The old Rly Mov had the planner drag every vehicle onto a wagon by hand; here it is done for them and can be
 *              read back as the entrainment table.
 *   trains     the standard components (2 engines, brake van, 2 AD KFs, mob ramp KF, kitchen C, TLR for crews) plus wagons
 *              while the train stays within 72 C units excluding engines, 2,000 tons, and 18 double-loaded MBFRs (R). The
 *              old code allowed 61 usable C units and no weight limit.
 *   timetable  stock is placed 45 min after last light at the earliest (night moves); a train leaves after loading and
 *              marshalling, at least 1 h 30 min after the one before from the same station (R); it runs at 32 kmph on a
 *              main line, 24 on a branch line (R), halting 60 min every 8 h (old En Mov); unloading follows arrival.
 *              The old code started every later train of a day at start + one interval and never moved a train's date.
 */

import { MIN, DAY_MIN, atLocal, mDayOf, type LightBook, type MvClock } from './MoveTime';

export type StockType = 'MBFR' | 'MBFU' | 'BKF' | 'KF' | 'C' | 'TLR' | 'Brake' | 'Engine';
export const LOAD_STOCK: StockType[] = ['MBFR', 'MBFU', 'BKF', 'KF', 'C', 'TLR'];
export const ALL_STOCK: StockType[] = ['Engine', 'Brake', 'MBFR', 'MBFU', 'BKF', 'KF', 'C', 'TLR'];

export interface RailKind {
  label: string;
  cat: string;
  tracked: boolean;
  mlc: number;
  rail: [StockType, number][];
}

export interface RailRules {
  mainKmh: number;
  branchKmh: number;
  stationMin: number;
  runningMin: number;
  placingMin: number;
  rampDayMin: number;
  rampNiMin: number;
  maxC: number;
  maxTons: number;
  tonsInclEngines: boolean;
  maxMbfrDouble: number;
  stock: Record<StockType, { label: string; c: number; tons: [number, number]; pax?: number; storesTons?: number }>;
  essential: { role: string; stock: StockType }[];
  kinds: Record<string, RailKind>;
  times: { loading: number; unloading: number; marshalling: number; transShipment: number; gaugeChange: number; unforeseen: number; crossings: number; sidings: number };
  haltEveryMin: number;
  haltMin: number;
  circuity: number;
}

export function railRulesFrom(doc: any): RailRules {
  const r = doc?.rail ?? {};
  const t = r.timesMin ?? {};
  return {
    mainKmh: r.speeds?.main ?? 32,
    branchKmh: r.speeds?.branch ?? 24,
    stationMin: r.intervals?.stationMin ?? 90,
    runningMin: r.intervals?.runningMin ?? 30,
    placingMin: r.placing?.afterLastLightMin ?? 45,
    rampDayMin: r.mobRamp?.dayMin ?? 30,
    rampNiMin: r.mobRamp?.niMin ?? 45,
    maxC: r.train?.maxC ?? 72,
    maxTons: r.train?.maxTons ?? 2000,
    tonsInclEngines: r.train?.tonsInclEngines === true,
    maxMbfrDouble: r.train?.maxMbfrDouble ?? 18,
    stock: r.stock,
    essential: r.essential?.items ?? [],
    kinds: doc?.vehicles?.kinds ?? {},
    times: {
      loading: t.loading ?? 60,
      unloading: t.unloading ?? 60,
      marshalling: t.marshalling ?? 30,
      transShipment: t.transShipment ?? 0,
      gaugeChange: t.gaugeChange ?? 0,
      unforeseen: t.unforeseen ?? 30,
      crossings: t.crossings ?? 0,
      sidings: t.sidings ?? 1,
    },
    haltEveryMin: r.halts?.everyMin ?? 480,
    haltMin: r.halts?.haltMin ?? 60,
    circuity: r.circuity?.factor ?? 1.25,
  };
}

// ── vehicles onto wagons ────────────────────────────────────────────────────────────────────────────────────────────

export interface RailUnitIn {
  id: string;
  name: string;
  vehicles: { kind: string; count: number }[];
  /** Personnel besides the vehicle crews (who ride in each train's TLR). */
  pax: number;
  storesTons: number;
}

export interface Wagon {
  type: StockType;
  unit: string;
  load: { kind: string; n: number }[];
  tons: number;
  c: number;
  /** MBFR with two vehicles (96 t). */
  double: boolean;
  pax: number;
  stores: number;
}

/** Every unit's vehicles, personnel and stores on wagons; vehicles of a kind the table does not know are listed. */
export function loadWagons(units: RailUnitIn[], R: RailRules): { wagons: Wagon[]; unknown: { unit: string; kind: string; count: number }[] } {
  const wagons: Wagon[] = [];
  const unknown: { unit: string; kind: string; count: number }[] = [];
  const mk = (type: StockType, unit: string): Wagon => ({ type, unit, load: [], tons: R.stock[type]?.tons?.[0] ?? 0, c: R.stock[type]?.c ?? 0, double: false, pax: 0, stores: 0 });
  for (const u of units) {
    for (const v of u.vehicles) {
      if (!(v.count > 0)) continue;
      const k = R.kinds[v.kind];
      const opt = k?.rail?.[0];
      if (!opt) {
        unknown.push({ unit: u.id, kind: v.kind, count: v.count });
        continue;
      }
      const [type, per] = opt;
      if (per < 1) {
        // a vehicle that needs several wagons (AVLB: 2 MBFRs)
        const need = Math.ceil(1 / per);
        for (let i = 0; i < v.count; i++)
          for (let j = 0; j < need; j++) {
            const w = mk(type, u.id);
            if (j === 0) w.load.push({ kind: v.kind, n: 1 });
            w.tons = R.stock[type].tons[1] ?? w.tons;
            wagons.push(w);
          }
        continue;
      }
      let left = v.count;
      while (left > 0) {
        const n = Math.min(per, left);
        const w = mk(type, u.id);
        w.load.push({ kind: v.kind, n });
        w.double = n >= 2;
        w.tons = R.stock[type].tons[n >= 2 ? 1 : 0] ?? w.tons;
        wagons.push(w);
        left -= n;
      }
    }
    const paxPer = R.stock.TLR?.pax ?? 60;
    for (let left = Math.max(0, Math.round(u.pax)); left > 0; left -= paxPer) {
      const w = mk('TLR', u.id);
      w.pax = Math.min(paxPer, left);
      wagons.push(w);
    }
    const tPer = R.stock.C?.storesTons ?? 20;
    for (let left = Math.max(0, u.storesTons); left > 0.01; left -= tPer) {
      const w = mk('C', u.id);
      w.stores = Math.min(tPer, left);
      wagons.push(w);
    }
  }
  return { wagons, unknown };
}

// ── wagons into trains ──────────────────────────────────────────────────────────────────────────────────────────────

export interface Train {
  n: number;
  name: string;
  units: string[];
  wagons: Wagon[];
  /** Counts by stock type, standard components included (engines and brake van too). */
  stock: Record<StockType, number>;
  /** C units excluding engines, and tons (engines counted as the rules say). */
  c: number;
  tons: number;
  mbfrDouble: number;
  kind: 'vehicle' | 'personnel' | 'stores';
  checks: string[];
}

function essentialLoad(R: RailRules, kind: 'vehicle' | 'personnel' | 'stores'): { c: number; tons: number; stock: Record<StockType, number> } {
  const stock = { Engine: 0, Brake: 0, MBFR: 0, MBFU: 0, BKF: 0, KF: 0, C: 0, TLR: 0 } as Record<StockType, number>;
  const items = kind === 'vehicle' ? R.essential : [{ role: 'Engine', stock: 'Engine' as StockType }, { role: 'Brake Van', stock: 'Brake' as StockType }];
  let c = 0, tons = 0;
  for (const it of items) {
    stock[it.stock]++;
    if (it.stock !== 'Engine') c += R.stock[it.stock]?.c ?? 0;
    if (it.stock !== 'Engine' || R.tonsInclEngines) tons += R.stock[it.stock]?.tons?.[0] ?? 0;
  }
  return { c, tons, stock };
}

/**
 * Trains in order of the units: each vehicle train is its standard components plus wagons while it stays within the
 * C units, the tons and the double-loaded MBFR cap; a unit spills into the next train and the next unit fills the space
 * left (`mixUnits`), or starts its own train.
 */
export function composeTrains(wagons: Wagon[], unitsOrder: string[], R: RailRules, opts: { mixUnits?: boolean; names?: Record<string, string> } = {}): Train[] {
  const mix = opts.mixUnits !== false;
  const order: StockType[] = ['MBFR', 'MBFU', 'BKF', 'KF', 'C', 'TLR'];
  const byUnit = new Map<string, Wagon[]>();
  for (const w of wagons) {
    const l = byUnit.get(w.unit);
    if (l) l.push(w);
    else byUnit.set(w.unit, [w]);
  }
  const trains: Train[] = [];
  let cur: Train | null = null;
  const open = (kind: Train['kind']) => {
    const e = essentialLoad(R, kind);
    const t: Train = { n: trains.length + 1, name: '', units: [], wagons: [], stock: { ...e.stock }, c: e.c, tons: e.tons, mbfrDouble: 0, kind, checks: [] };
    trains.push(t);
    return t;
  };
  for (const uid of unitsOrder) {
    const ws = (byUnit.get(uid) ?? []).slice().sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    if (!ws.length) continue;
    const allPax = ws.every((w) => w.type === 'TLR');
    const allStores = ws.every((w) => w.type === 'C');
    const kind: Train['kind'] = allPax ? 'personnel' : allStores ? 'stores' : 'vehicle';
    if (!cur || !mix || cur.kind !== kind) cur = open(kind);
    for (const w of ws) {
      const fits = (t: Train) =>
        t.c + w.c <= R.maxC && t.tons + w.tons <= R.maxTons && !(w.type === 'MBFR' && w.double && t.mbfrDouble + 1 > R.maxMbfrDouble);
      if (!fits(cur)) cur = open(kind);
      if (!fits(cur)) cur.checks.push(`${w.type} does not fit an empty train`);
      cur.wagons.push(w);
      cur.c += w.c;
      cur.tons += w.tons;
      cur.stock[w.type]++;
      if (w.type === 'MBFR' && w.double) cur.mbfrDouble++;
      if (!cur.units.includes(uid)) cur.units.push(uid);
    }
  }
  for (const t of trains) {
    const names = t.units.map((u) => opts.names?.[u] ?? u);
    t.name = `Train ${t.n}`;
    if (t.c > R.maxC) t.checks.push(`${t.c} C units: over ${R.maxC}`);
    if (t.tons > R.maxTons) t.checks.push(`${t.tons} tons: over ${R.maxTons}`);
    void names;
  }
  return trains;
}

// ── trains into a timetable ─────────────────────────────────────────────────────────────────────────────────────────

export interface RailSetup {
  distKm: number;
  kmh: number;
  /** Earliest the first train may be placed (UTC ms). */
  startMs: number;
  moveType: 'night' | 'day' | 'both';
  /** Minutes between trains leaving (and arriving) at a station; at least the station gap (R). */
  intervalMin: number;
  /** Loading on a live line (mob ramp) rather than a loop line with end ramps. */
  liveLine: boolean;
  /** Wagons the railway can give per day, by type; null = as many as needed. */
  stockPerDay?: Partial<Record<StockType, number>> | null;
  halts: boolean;
  /** Where first and last light are read (the entraining station). */
  at: [number, number];
}

export interface TrainTimed extends Train {
  placed: number;
  dep: number;
  arr: number;
  detrained: number;
  runMin: number;
  haltCount: number;
  day: number;
  notes: string[];
}

/** Halts on a run: n halts of `haltMin` every `everyMin` of running, strictly before the end (old En Mov). */
export function railHalts(runMin: number, everyMin: number, haltMin: number): number {
  if (!(everyMin > 0) || !(haltMin > 0)) return 0;
  return Math.max(0, Math.ceil(runMin / everyMin) - 1);
}

/** The night that holds `t`, or the next one when `t` is by day: last light and the first light that ends it. */
export function nightAt(light: LightBook, t: number, lat: number, lng: number): { ll: number; fl: number } {
  const d = mDayOf(light.clock, t);
  const L = light.day(d, lat, lng);
  if (t < L.first) return { ll: light.day(d - 1, lat, lng).last, fl: L.first };
  return { ll: L.last, fl: light.day(d + 1, lat, lng).first };
}

/** The timetable: placing, loading and marshalling, departures spaced at the station, running, halts, arrival, unloading. */
export function timeTrains(trains: Train[], set: RailSetup, light: LightBook, R: RailRules): TrainTimed[] {
  const out: TrainTimed[] = [];
  const [lng, lat] = set.at;
  const gap = Math.max(set.intervalMin, R.stationMin) * MIN;
  const kmh = set.kmh > 0 ? set.kmh : R.mainKmh;
  const runMin = (set.distKm / kmh) * 60;
  const halts = set.halts ? railHalts(runMin, R.haltEveryMin, R.haltMin) : 0;
  const extra = R.times.transShipment + R.times.gaugeChange + R.times.crossings + R.times.unforeseen;
  const sidings = Math.max(1, Math.round(R.times.sidings));
  const usedByDay = new Map<number, Partial<Record<StockType, number>>>();
  const lastDeps: number[] = [];
  let prevDep = -Infinity;
  for (const tr of trains) {
    const notes: string[] = [];
    const isNightAt = (t: number) => !light.isDay(t, lat, lng);
    const ramp = (t: number) => (set.liveLine ? (isNightAt(t) ? R.rampNiMin : R.rampDayMin) : 0);
    // the earliest the stock can be placed: after the train before has gone from a free siding, never before the start
    let placed = Math.max(set.startMs, lastDeps.length >= sidings ? lastDeps[lastDeps.length - sidings] : -Infinity);
    for (let guard = 0; guard < 60; guard++) {
      if (set.moveType === 'night') {
        // placed 45 min after last light at the earliest (R), loaded before first light
        const nt = nightAt(light, placed, lat, lng);
        placed = Math.max(placed, nt.ll + R.placingMin * MIN);
        if (placed + (R.times.loading + ramp(placed)) * MIN > nt.fl) {
          placed = nt.fl + MIN;
          if (!notes.length) notes.push('Moved to the next night: loading would run into daylight');
          continue;
        }
      } else if (set.moveType === 'day' && isNightAt(placed + 1)) {
        placed = light.nextChange(placed, lat, lng);
      }
      const dep = Math.max(placed + (R.times.loading + R.times.marshalling + ramp(placed)) * MIN, prevDep + gap);
      // wagons the railway gives per day (per night for night moves: the night of M / M+1 counts as M)
      const night = set.moveType === 'night';
      const d = night ? mDayOf(light.clock, nightAt(light, placed, lat, lng).ll) : mDayOf(light.clock, placed);
      if (set.stockPerDay) {
        const used = usedByDay.get(d) ?? {};
        const short = LOAD_STOCK.some((k) => set.stockPerDay![k] !== undefined && (used[k] ?? 0) + tr.stock[k] > (set.stockPerDay![k] ?? Infinity));
        if (short && Object.keys(used).length) {
          placed = night ? nightAt(light, placed, lat, lng).fl + MIN : atLocal(light.clock, d + 1, 0);
          notes.push(`Moved to the next ${night ? 'night' : 'day'}: not enough wagons`);
          continue;
        }
        for (const k of LOAD_STOCK) used[k] = (used[k] ?? 0) + tr.stock[k];
        usedByDay.set(d, used);
      }
      const arr = dep + (runMin + halts * R.haltMin + extra) * MIN;
      const detrained = arr + (R.times.unloading + (set.liveLine ? (!light.isDay(arr, lat, lng) ? R.rampNiMin : R.rampDayMin) : 0)) * MIN;
      out.push({ ...tr, placed, dep, arr, detrained, runMin, haltCount: halts, day: d, notes });
      prevDep = dep;
      lastDeps.push(dep);
      break;
    }
  }
  return out;
}

/** Wagons needed by type: per train and per M day (standard components, brake vans and engines included). */
export function stockDemand(timed: TrainTimed[], clock: MvClock): { byDay: Map<number, Record<StockType, number>>; total: Record<StockType, number> } {
  const byDay = new Map<number, Record<StockType, number>>();
  const total = { Engine: 0, Brake: 0, MBFR: 0, MBFU: 0, BKF: 0, KF: 0, C: 0, TLR: 0 } as Record<StockType, number>;
  for (const t of timed) {
    const d = mDayOf(clock, t.placed);
    const row = byDay.get(d) ?? ({ Engine: 0, Brake: 0, MBFR: 0, MBFU: 0, BKF: 0, KF: 0, C: 0, TLR: 0 } as Record<StockType, number>);
    for (const k of ALL_STOCK) {
      row[k] += t.stock[k];
      total[k] += t.stock[k];
    }
    byDay.set(d, row);
  }
  return { byDay, total };
}

/** How many trains can leave one station in a night: from 45 min after last light, one per gap, loaded before first light. */
export function trainsPerNight(light: LightBook, day: number, at: [number, number], gapMin: number, R: RailRules): number {
  const a = light.day(day, at[1], at[0]), b = light.day(day + 1, at[1], at[0]);
  const from = a.last + (R.placingMin + R.times.loading + R.times.marshalling) * MIN;
  const to = b.first;
  if (!(to > from)) return 0;
  return Math.floor((to - from) / (Math.max(gapMin, R.stationMin) * MIN)) + 1;
}

export { DAY_MIN };
