/**
 * MoveEnemy.ts
 *
 * Enemy move estimates for the Move Planner: when each enemy formation can be in the area. Pure.
 *
 *   rail   (the old En Mov) train k of a formation leaves its entraining station at start + k x gap, runs at the line
 *          speed with a 60 min halt every 8 h, and arrives; the old code worked out only the first and last trains and
 *          collected loading, marshalling, trans-shipment, gauge change, crossing and unforeseen times without using them.
 *          Here they count: arrival adds trans-shipment, gauge change, crossings and unforeseen; detraining adds
 *          unloading; the formation is inducted `readyAfterMin` after its last train has detrained (E). Formations that
 *          entrain at the same station follow one another (the old "inter-org interval", which was lost on reload), and
 *          arrivals at the same detraining station keep the station gap (R).
 *   road   a column by road with MoveRoad (augmentation: OCOKA roadmap "enemy approaches with time-distance").
 *   matrix the induction matrix (Staff Duties Annex D to Chapter 7): by day M, M+1 ..., what is on the move and what is
 *          already in the area.
 */

import { MIN, DAY_MIN, atLocal, mDayOf, type MvClock } from './MoveTime';
import { railHalts, type RailRules } from './MoveRail';

export interface EnTypeInfo {
  label: string;
  trains: number;
  basis?: string;
}

export interface EnemyRules {
  types: Record<string, EnTypeInfo>;
  readyAfterMin: number;
  roadSpeed: [number, number];
  roadDensity: [number, number];
  roadVehs: Record<string, number>;
}

export function enemyRulesFrom(doc: any): EnemyRules {
  const e = doc?.enemy ?? {};
  return {
    types: e.trainsByType ?? {},
    readyAfterMin: e.readyAfterMin ?? 180,
    roadSpeed: e.byRoad?.speed ?? [40, 30],
    roadDensity: e.byRoad?.density ?? [20, 30],
    roadVehs: e.byRoad?.vehsByType ?? {},
  };
}

export interface EnFmnIn {
  id: string;
  name: string;
  type: string;
  /** Trains needed; null = from the type table. */
  trains: number | null;
  eSta: string;
  dSta: string;
  distKm: number;
  kmh: number;
  /** Day of the first departure (0 = M) and its local minute. */
  startDay: number;
  startMin: number;
  gapMin: number;
  halts: boolean;
  order: number;
}

export interface EnTrainTime {
  k: number;
  dep: number;
  arr: number;
  detrained: number;
}

export interface EnFmnOut {
  id: string;
  name: string;
  type: string;
  trains: number;
  eSta: string;
  dSta: string;
  distKm: number;
  kmh: number;
  runMin: number;
  haltCount: number;
  first: EnTrainTime;
  last: EnTrainTime;
  all: EnTrainTime[];
  inducted: number;
  /** Minutes the formation was held for an earlier one at its stations. */
  heldMin: number;
  notes: string[];
}

export function trainsFor(type: string, ER: EnemyRules): number {
  return ER.types[type]?.trains ?? 0;
}

/** Enemy formations by rail, in order; formations sharing a station queue on it. */
export function enemyRail(fmns: EnFmnIn[], clock: MvClock, RR: RailRules, ER: EnemyRules): EnFmnOut[] {
  const sorted = fmns.slice().sort((a, b) => a.order - b.order);
  const lastDepAt = new Map<string, number>();
  const arrivalsAt = new Map<string, number[]>();
  const out: EnFmnOut[] = [];
  const station = RR.stationMin * MIN;
  for (const f of sorted) {
    const notes: string[] = [];
    const n = Math.max(1, Math.round(f.trains ?? trainsFor(f.type, ER)) || 1);
    const gap = Math.max(f.gapMin, RR.stationMin) * MIN;
    if (f.gapMin < RR.stationMin) notes.push(`Gap raised to ${RR.stationMin} min (station rule)`);
    const kmh = f.kmh > 0 ? f.kmh : RR.mainKmh;
    const runMin = (Math.max(0, f.distKm) / kmh) * 60;
    const halts = f.halts ? railHalts(runMin, RR.haltEveryMin, RR.haltMin) : 0;
    const extra = RR.times.transShipment + RR.times.gaugeChange + RR.times.crossings + RR.times.unforeseen;
    const tripMin = runMin + halts * RR.haltMin + extra;
    let t0 = atLocal(clock, f.startDay, f.startMin);
    const want = t0;
    const prev = lastDepAt.get(f.eSta);
    if (prev !== undefined && t0 < prev + gap) t0 = prev + gap;
    // arrivals at the detraining station keep the station gap from every earlier train there
    const arrs = arrivalsAt.get(f.dSta) ?? [];
    for (let guard = 0; guard < 200; guard++) {
      const firstArr = t0 + tripMin * MIN;
      const clash = arrs.some((a) => Math.abs(a - firstArr) < station || (firstArr < a && firstArr + (n - 1) * gap > a - station));
      if (!clash) break;
      t0 = Math.max(...arrs) - tripMin * MIN + station;
    }
    const heldMin = Math.round((t0 - want) / MIN);
    if (heldMin > 0) notes.push(`Held ${heldMin} min for formations ahead at ${f.eSta} / ${f.dSta}`);
    const all: EnTrainTime[] = [];
    for (let k = 0; k < n; k++) {
      const dep = t0 + k * gap;
      const arr = dep + tripMin * MIN;
      all.push({ k, dep, arr, detrained: arr + RR.times.unloading * MIN });
    }
    lastDepAt.set(f.eSta, all[n - 1].dep);
    arrivalsAt.set(f.dSta, [...arrs, ...all.map((x) => x.arr)]);
    out.push({
      id: f.id,
      name: f.name,
      type: f.type,
      trains: n,
      eSta: f.eSta,
      dSta: f.dSta,
      distKm: f.distKm,
      kmh,
      runMin,
      haltCount: halts,
      first: all[0],
      last: all[n - 1],
      all,
      inducted: all[n - 1].detrained + ER.readyAfterMin * MIN,
      heldMin: Math.max(0, heldMin),
      notes,
    });
  }
  return out;
}

export interface MatrixRow {
  day: number;
  /** End of that day (local 2400). */
  endMs: number;
  moving: string[];
  inducted: string[];
  /** Inducted formations by type up to this day. */
  byType: Record<string, number>;
}

/** The induction matrix: for each day from M, which formations are moving and which are in the area by its end. */
export function inductionMatrix(items: { id: string; name: string; type: string; start: number; inducted: number }[], clock: MvClock): MatrixRow[] {
  if (!items.length) return [];
  const d0 = Math.min(0, ...items.map((x) => mDayOf(clock, x.start)));
  const d1 = Math.max(...items.map((x) => mDayOf(clock, x.inducted)));
  const rows: MatrixRow[] = [];
  for (let d = d0; d <= Math.min(d1, d0 + 60); d++) {
    const end = atLocal(clock, d, DAY_MIN);
    const inducted = items.filter((x) => x.inducted <= end);
    const moving = items.filter((x) => x.start <= end && x.inducted > end);
    const byType: Record<string, number> = {};
    for (const x of inducted) byType[x.type] = (byType[x.type] ?? 0) + 1;
    rows.push({ day: d, endMs: end, moving: moving.map((x) => x.id), inducted: inducted.map((x) => x.id), byType });
  }
  return rows;
}
