/**
 * MovePlannerModel.ts
 *
 * The Move Planner's plan document and how it is worked out. Pure (Node-testable): a plan is plain JSON (saved, copied
 * between hosts, imported), and `computePlan` turns it into results with the engines in MoveRoad / MoveRail / MoveEnemy /
 * MoveReports. One plan is one of five kinds, the five old Mov Plan modules:
 *
 *   road   Rd Mov: serials (columns) on routes SP -> Rel P, with halts, harbours and the mov window.
 *   assy   Mov & Assy: the same grouped by formation, ending in assembly areas; block timings, the matrix, the space check.
 *   di     DI Mov (de-induction): units from their peace locations through the SP in their concentration time, corps /
 *          group / unit priorities at crossings; progress by day, arm-wise, priority-wise and HMT reports.
 *   rail   Rly Mov: units' vehicles onto wagons, trains, the timetable between entraining and detraining stations.
 *   enemy  En Mov: enemy formations by rail (or road) to their detraining stations; the induction matrix.
 */

import { bearingDeg, havM, mkPath, projectS, type LngLat, type MvPath } from './MoveGeo';
import { LightBook, MIN, atLocal, clockFrom, parseHHMM, todayIn, type MvClock, type MvLightRule } from './MoveTime';
import {
  densityFor,
  legsOf,
  roadRulesFrom,
  schedule,
  simulate,
  speedFor,
  type MvKind,
  type MvLeg,
  type MvRoadRules,
  type MvRoadState,
  type MvRun,
  type MvSchedSerial,
  type MvSchedule,
} from './MoveRoad';
import { composeTrains, loadWagons, railRulesFrom, stockDemand, timeTrains, trainsPerNight, type RailRules, type StockType, type Train, type TrainTimed } from './MoveRail';
import { enemyRail, enemyRulesFrom, inductionMatrix, trainsFor, type EnFmnOut, type EnemyRules, type MatrixRow } from './MoveEnemy';
import { armOf, armRulesFrom, assySpace, blockTimings, spaceRulesFrom, type ArmRules, type BlockRow, type DiUnit, type SpaceRules } from './MoveReports';

export type { MvKind } from './MoveRoad';

export const KINDS: MvKind[] = ['road', 'assy', 'di', 'rail', 'enemy'];
export const KIND_LABEL: Record<MvKind, string> = { road: 'Rd Mov', assy: 'Mov & Assy', di: 'DI Mov', rail: 'Rly Mov', enemy: 'En Mov' };
export const KIND_LONG: Record<MvKind, string> = {
  road: 'Road Movement',
  assy: 'Move and Assembly',
  di: 'De-Induction Move',
  rail: 'Rail Movement',
  enemy: 'Enemy Move',
};

/** Serial colours after the first on a route (kept apart from the route colours). */
export const SERIAL_COLORS = ['#ff8a65', '#ba68c8', '#81c784', '#f06292', '#4db6ac', '#ffb74d', '#9575cd', '#aed581', '#e57373', '#64b5f6', '#fff176', '#a1887f'];

export const ROUTE_COLORS = ['#ffd84d', '#4fc3f7', '#ff8a65', '#81c784', '#ba68c8', '#f06292', '#4db6ac', '#ffb74d', '#9575cd', '#aed581', '#e57373', '#64b5f6'];

// ── the document ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface MvRouteDoc {
  id: string;
  name: string;
  color: string;
  pts: LngLat[];
  /** How the route was made: solved on the road network, drawn, a placed line, or a straight line (no network). */
  source: 'network' | 'drawn' | 'line' | 'straight';
  sp: string;
  rp: string;
  cps: { name: string; at: LngLat }[];
  /** What the road network said about it (load class, MSR share, weakest crossing). */
  note?: string;
}

export interface MvSerialDoc {
  id: string;
  name: string;
  /** Formation (Mov & Assy group, DI formation) and corps (giving corps, op corps for DI). */
  fmn: string;
  corps: string;
  opCorps: string;
  corpsPri: number;
  gpPri: number;
  unitPri: number;
  sidc: string;
  arm: string;
  vehicles: number;
  /** Vehicles by kind (MoveDoctrine.json `vehicles.kinds`): rail loading; tanks in the column. */
  mix: { kind: string; count: number }[];
  /** The column has tanks, transporters and the like (the slower "all types" speeds). */
  allTypes: boolean;
  speedDay: number | null;
  speedNi: number | null;
  densDay: number | null;
  densNi: number | null;
  routeId: string | null;
  /** Start: day and time (empty = the plan's), plus a delay (Mov & Assy: from the group start). */
  startDay: number | null;
  start: string;
  delayMin: number;
  loadMin: number;
  unloadMin: number;
  /** DI: minutes from the peace location (DL) to the SP, summer and winter. */
  concSummer: number;
  concWinter: number;
  dl: LngLat | null;
  hmt: { own: number; bus: number; trk: number } | null;
  pax: number;
  storesTons: number;
  /** Mov & Assy: the formation size for the space check, and the assembly area drawn. */
  assySize: string;
  assyArea: LngLat[] | null;
}

export interface MvEnemyDoc {
  id: string;
  name: string;
  type: string;
  trains: number | null;
  mode: 'rail' | 'road';
  eSta: string;
  dSta: string;
  eAt: LngLat | null;
  dAt: LngLat | null;
  distKm: number | null;
  kmh: number | null;
  startDay: number;
  start: string;
  gapMin: number;
  halts: boolean;
  routeId: string | null;
  vehicles: number | null;
}

export interface MvRailDoc {
  eSta: string;
  dSta: string;
  eAt: LngLat | null;
  dAt: LngLat | null;
  routeId: string | null;
  line: 'main' | 'branch';
  kmh: number | null;
  moveType: 'night' | 'day' | 'both';
  intervalMin: number;
  liveLine: boolean;
  halts: boolean;
  stockPerDay: Partial<Record<StockType, number>> | null;
  mixUnits: boolean;
  startDay: number;
  start: string;
}

export interface MvPlanDoc {
  version: 1;
  title: string;
  kind: MvKind;
  mDate: string;
  offsetMin: number;
  light: MvLightRule;
  season: 'summer' | 'winter';
  startDay: number;
  start: string;
  window: 'both' | 'day' | 'night';
  /** Clock window "HH:MM" (both empty = by first and last light). */
  windowFrom: string;
  windowTo: string;
  roadState: MvRoadState;
  haltMode: 'running' | 'clock' | 'none';
  shRunMin: number;
  shMin: number;
  lhEvery: number;
  lhMin: number;
  densityHalt: boolean;
  twoWay: boolean;
  routes: MvRouteDoc[];
  serials: MvSerialDoc[];
  rail: MvRailDoc;
  enemy: MvEnemyDoc[];
}

let _seq = 0;
export function newId(prefix: string): string {
  _seq = (_seq + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${_seq.toString(36)}`;
}

export function newPlan(kind: MvKind, R: MvRules, offsetMin = 300): MvPlanDoc {
  const H = R.road;
  return {
    version: 1,
    title: `${KIND_LABEL[kind]} Plan`,
    kind,
    mDate: todayIn(offsetMin),
    offsetMin,
    light: 'sun',
    season: 'summer',
    startDay: 0,
    start: H.startTime,
    window: kind === 'road' || kind === 'assy' ? 'night' : 'both',
    windowFrom: '',
    windowTo: '',
    roadState: 'good',
    haltMode: 'running',
    shRunMin: H.shortRunMin,
    shMin: H.shortHaltMin,
    lhEvery: H.longEvery,
    lhMin: H.longHaltMin,
    densityHalt: true,
    twoWay: H.twoWay,
    routes: [],
    serials: [],
    rail: { eSta: '', dSta: '', eAt: null, dAt: null, routeId: null, line: 'main', kmh: null, moveType: 'night', intervalMin: R.rail.stationMin, liveLine: false, halts: true, stockPerDay: null, mixUnits: true, startDay: 0, start: '12:00' },
    enemy: [],
  };
}

export function newSerial(plan: MvPlanDoc, R: MvRules, patch: Partial<MvSerialDoc> = {}): MvSerialDoc {
  const n = plan.serials.length + 1;
  const hmt = plan.kind === 'di' ? { ...R.arms.hmt } : null;
  return {
    id: newId('s'),
    name: plan.kind === 'rail' ? `Unit ${n}` : `Ser ${n}`,
    fmn: '',
    corps: '',
    opCorps: '',
    corpsPri: 1,
    gpPri: 1,
    unitPri: n,
    sidc: '',
    arm: 'misc',
    vehicles: plan.kind === 'di' ? hmt!.own + hmt!.bus + hmt!.trk : 100,
    mix: [],
    allTypes: false,
    speedDay: null,
    speedNi: null,
    densDay: null,
    densNi: null,
    routeId: plan.routes[plan.routes.length - 1]?.id ?? null,
    startDay: null,
    start: '',
    delayMin: plan.kind === 'assy' && plan.serials.length ? R.road.gapMin * plan.serials.length : 0,
    loadMin: 0,
    unloadMin: 0,
    concSummer: plan.kind === 'di' ? 120 : 0,
    concWinter: plan.kind === 'di' ? 150 : 0,
    dl: null,
    hmt,
    pax: 0,
    storesTons: 0,
    assySize: 'inf_bde',
    assyArea: null,
    ...patch,
  };
}

export function newEnemy(plan: MvPlanDoc, R: MvRules, patch: Partial<MvEnemyDoc> = {}): MvEnemyDoc {
  return {
    id: newId('e'),
    name: `En Fmn ${plan.enemy.length + 1}`,
    type: 'inf_div',
    trains: null,
    mode: 'rail',
    eSta: '',
    dSta: '',
    eAt: null,
    dAt: null,
    distKm: null,
    kmh: null,
    startDay: 0,
    start: '06:00',
    gapMin: R.rail.stationMin,
    halts: true,
    routeId: null,
    vehicles: null,
    ...patch,
  };
}

/** Bring an older or partial plan (a file, another host) up to the current shape. */
export function normalisePlan(raw: any, R: MvRules): MvPlanDoc {
  const kind: MvKind = KINDS.includes(raw?.kind) ? raw.kind : 'road';
  const base = newPlan(kind, R, typeof raw?.offsetMin === 'number' ? raw.offsetMin : 300);
  const p: MvPlanDoc = { ...base, ...(raw ?? {}), kind, version: 1 };
  p.rail = { ...base.rail, ...(raw?.rail ?? {}) };
  p.routes = (Array.isArray(raw?.routes) ? raw.routes : []).map((r: any, i: number) => ({
    id: String(r.id ?? newId('r')),
    name: String(r.name ?? `Route ${i + 1}`),
    color: String(r.color ?? ROUTE_COLORS[i % ROUTE_COLORS.length]),
    pts: (r.pts ?? []).filter((q: any) => Array.isArray(q) && q.length >= 2).map((q: any) => [+q[0], +q[1]] as LngLat),
    source: r.source ?? 'drawn',
    sp: String(r.sp ?? 'SP'),
    rp: String(r.rp ?? 'Rel P'),
    cps: (r.cps ?? []).map((c: any) => ({ name: String(c.name ?? 'CP'), at: [+c.at[0], +c.at[1]] as LngLat })),
    note: r.note,
  }));
  p.serials = (Array.isArray(raw?.serials) ? raw.serials : []).map((s: any) => newSerial({ ...p, serials: [] }, R, { ...s, id: String(s.id ?? newId('s')) }));
  p.enemy = (Array.isArray(raw?.enemy) ? raw.enemy : []).map((e: any) => newEnemy({ ...p, enemy: [] }, R, { ...e, id: String(e.id ?? newId('e')) }));
  return p;
}

// ── rules ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface MvRules {
  road: MvRoadRules;
  rail: RailRules;
  enemy: EnemyRules;
  arms: ArmRules;
  space: SpaceRules;
  doc: any;
}

export function rulesFrom(doc: any): MvRules {
  return { road: roadRulesFrom(doc), rail: railRulesFrom(doc), enemy: enemyRulesFrom(doc), arms: armRulesFrom(doc), space: spaceRulesFrom(doc), doc };
}

// ── results ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface MvSerialResult {
  doc: MvSerialDoc;
  route: MvRouteDoc;
  run: MvRun;
  legs: MvLeg[];
  startMs: number;
  /** DI: the concentration leg DL -> SP (start, SP due). */
  conc: { from: number; minutes: number } | null;
  speedDay: number;
  speedNi: number;
  densDay: number;
  densNi: number;
  /** When the serial has closed in: RP clear + unloading. */
  closedMs: number;
  color: string;
}

export interface MvResult {
  kind: MvKind;
  clock: MvClock;
  light: LightBook;
  errors: string[];
  warnings: string[];
  serials: MvSerialResult[];
  sched: MvSchedule | null;
  /** First SP due and last closed time of the whole plan. */
  span: [number, number] | null;
  di: { units: DiUnit[] } | null;
  assy: { blocks: BlockRow[]; space: { id: string; name: string; tone: 'ok' | 'warn' | 'bad'; text: string; areaKm2: number }[] } | null;
  rail: {
    distKm: number;
    distSource: string;
    kmh: number;
    wagons: number;
    unknown: { unit: string; kind: string; count: number }[];
    trains: TrainTimed[];
    demand: ReturnType<typeof stockDemand>;
    perNight: number;
  } | null;
  enemy: { rail: EnFmnOut[]; road: { doc: MvEnemyDoc; run: MvRun; inducted: number }[]; matrix: MatrixRow[] } | null;
}

function windowOf(plan: MvPlanDoc): { kind: 'both' | 'day' | 'night'; clock: [number, number] | null } {
  const a = parseHHMM(plan.windowFrom), b = parseHHMM(plan.windowTo);
  return { kind: plan.window, clock: plan.window !== 'both' && a !== null && b !== null ? [a, b] : null };
}

function haltsOf(plan: MvPlanDoc, R: MvRoadRules) {
  return {
    mode: plan.haltMode,
    runMin: Math.max(1, plan.shRunMin || R.shortRunMin),
    haltMin: Math.max(0, plan.shMin),
    longEvery: Math.max(0, Math.round(plan.lhEvery)),
    longMin: Math.max(0, plan.lhMin),
    clockFirstAtMin: R.clockFirstAtMin,
    clockEveryMin: R.clockEveryMin,
  };
}

export function vehiclesOf(s: MvSerialDoc, kind: MvKind): number {
  if (kind === 'di' && s.hmt) return Math.max(0, s.hmt.own + s.hmt.bus + s.hmt.trk);
  const mix = s.mix.reduce((m, x) => m + Math.max(0, x.count), 0);
  return Math.max(0, Math.round(s.vehicles || mix));
}

/** Area of a ring in km2 (local plane; fine for an assembly area). */
export function areaKm2(ring: LngLat[] | null): number {
  if (!ring || ring.length < 3) return 0;
  const lat0 = ring.reduce((m, p) => m + p[1], 0) / ring.length;
  const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180), ky = 110.57;
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p[0] * kx * (q[1] * ky) - q[0] * kx * (p[1] * ky);
  }
  return Math.abs(a) / 2;
}

/** Work the plan out. Serials without a route, or a route under two points, are listed in `errors` and left out. */
export function computePlan(plan: MvPlanDoc, R: MvRules): MvResult {
  const clock = clockFrom(plan.mDate, plan.offsetMin);
  const light = new LightBook(clock, plan.light);
  const res: MvResult = { kind: plan.kind, clock, light, errors: [], warnings: [], serials: [], sched: null, span: null, di: null, assy: null, rail: null, enemy: null };
  const paths = new Map<string, MvPath>();
  const pathOf = (r: MvRouteDoc) => {
    let p = paths.get(r.id);
    if (!p) paths.set(r.id, (p = mkPath(r.pts)));
    return p;
  };
  const startDefault = parseHHMM(plan.start) ?? parseHHMM(R.road.startTime) ?? 1080;

  if (plan.kind === 'road' || plan.kind === 'assy' || plan.kind === 'di') {
    const ins: MvSchedSerial[] = [];
    const meta = new Map<string, Omit<MvSerialResult, 'run' | 'legs'>>();
    plan.serials.forEach((s, i) => {
      const route = plan.routes.find((r) => r.id === s.routeId);
      if (!route || route.pts.length < 2) {
        res.errors.push(`${s.name}: no route`);
        return;
      }
      const path = pathOf(route);
      if (path.length < 10) {
        res.errors.push(`${s.name}: route too short`);
        return;
      }
      const n = vehiclesOf(s, plan.kind);
      if (!(n > 0)) {
        res.errors.push(`${s.name}: no vehicles`);
        return;
      }
      const byKind = R.road.speedByKind[plan.kind];
      const sp = byKind ?? speedFor(plan.roadState, s.allTypes, R.road);
      const dn = densityFor(plan.kind, R.road);
      const speedDay = s.speedDay ?? sp[0], speedNi = s.speedNi ?? sp[1];
      const densDay = s.densDay ?? (plan.window === 'both' && plan.kind === 'road' ? (R.road.density.road?.both ?? dn.day) : dn.day);
      const densNi = s.densNi ?? (plan.window === 'both' && plan.kind === 'road' ? (R.road.density.road?.both ?? dn.night) : dn.night);
      const conc = plan.kind === 'di' ? Math.max(0, plan.season === 'winter' ? s.concWinter : s.concSummer) : 0;
      const t0 = atLocal(clock, s.startDay ?? plan.startDay, parseHHMM(s.start) ?? startDefault) + (s.delayMin || 0) * MIN;
      const startMs = t0 + conc * MIN;
      const points = route.cps.map((c) => ({ name: c.name, s: projectS(path, c.at).s })).filter((p) => p.s > 1 && p.s < path.length - 1);
      ins.push({
        id: s.id,
        name: s.name,
        vehicles: n,
        speedDay,
        speedNi,
        densDay,
        densNi,
        path,
        startMs,
        window: windowOf(plan),
        halts: haltsOf(plan, R.road),
        densityHalt: plan.densityHalt,
        points,
        pri: plan.kind === 'di' ? [s.corpsPri || 99, s.gpPri || 99, s.unitPri || 99] : plan.kind === 'assy' ? [s.gpPri || 99, s.unitPri || 99] : [s.unitPri || 99],
        order: i,
      });
      // a serial's own colour: its route's for the first on that route, then the palette (several serials share a route)
      const onRoute = plan.serials.slice(0, i).filter((x) => x.routeId === route.id).length;
      const color = onRoute === 0 ? route.color : SERIAL_COLORS[(i + onRoute) % SERIAL_COLORS.length];
      meta.set(s.id, { doc: s, route, startMs, conc: plan.kind === 'di' ? { from: t0, minutes: conc } : null, speedDay, speedNi, densDay, densNi, closedMs: NaN, color });
    });
    if (ins.length) {
      const sched = schedule(ins, light, R.road, { twoWay: plan.twoWay });
      res.sched = sched;
      for (const x of ins) {
        const run = sched.runs[x.id];
        const m = meta.get(x.id)!;
        const legs = legsOf(run, x.points ?? [], m.route.sp || 'SP', m.route.rp || 'Rel P', R.road.harbourMin);
        const closedMs = run.rpClear + (m.doc.unloadMin || 0) * MIN;
        res.serials.push({ ...m, run, legs, closedMs });
        for (const w of run.warnings) res.warnings.push(`${x.name}: ${w}`);
      }
      if (sched.open) res.warnings.push('Some crossings could not be cleared: check the priorities and routes');
      const starts = res.serials.map((s) => (s.conc ? s.conc.from : s.run.spDue) - (s.doc.loadMin || 0) * MIN);
      const ends = res.serials.map((s) => s.closedMs);
      res.span = [Math.min(...starts), Math.max(...ends)];
    }
    if (plan.kind === 'di') {
      res.di = {
        units: plan.serials.map((s) => {
          const r = res.serials.find((x) => x.doc.id === s.id);
          return {
            id: s.id,
            name: s.name,
            corps: s.corps,
            opCorps: s.opCorps,
            fmn: s.fmn,
            gpPri: s.gpPri,
            arm: s.arm && s.arm !== 'misc' ? s.arm : armOf(s.sidc, R.arms),
            bus: s.hmt?.bus ?? 0,
            trk: s.hmt?.trk ?? 0,
            closedMs: r ? r.closedMs : NaN,
          };
        }),
      };
    }
    if (plan.kind === 'assy') {
      res.assy = {
        blocks: blockTimings(res.serials.map((s) => ({ id: s.doc.id, name: s.doc.name, fmn: s.doc.fmn || s.doc.name, spDue: s.run.spDue, rpClear: s.closedMs }))),
        space: plan.serials
          .filter((s) => s.assyArea && s.assyArea.length >= 3)
          .map((s) => {
            const a = areaKm2(s.assyArea);
            const chk = assySpace(s.assySize, a, R.space);
            return { id: s.id, name: s.fmn || s.name, tone: chk.tone, text: chk.text, areaKm2: a };
          }),
      };
    }
  }

  if (plan.kind === 'rail') {
    const rd = plan.rail;
    let distKm = 0, distSource = '';
    const route = plan.routes.find((r) => r.id === rd.routeId);
    if (route && route.pts.length >= 2) {
      distKm = pathOf(route).length / 1000;
      distSource = route.name;
    } else if (rd.eAt && rd.dAt) {
      distKm = (havM(rd.eAt, rd.dAt) / 1000) * R.rail.circuity;
      distSource = `straight line x ${R.rail.circuity}`;
    }
    if (!(distKm > 0)) res.errors.push('Set the entraining and detraining stations or a rail route');
    const units = plan.serials.map((s) => ({ id: s.id, name: s.name, vehicles: s.mix.filter((m) => m.count > 0), pax: s.pax, storesTons: s.storesTons }));
    const noMix = plan.serials.filter((s) => !s.mix.some((m) => m.count > 0) && !(s.pax > 0) && !(s.storesTons > 0));
    for (const s of noMix) res.errors.push(`${s.name}: enter its vehicles by kind`);
    const lw = loadWagons(units, R.rail);
    const names = Object.fromEntries(plan.serials.map((s) => [s.id, s.name]));
    const trains: Train[] = composeTrains(lw.wagons, plan.serials.map((s) => s.id), R.rail, { mixUnits: rd.mixUnits, names });
    const kmh = rd.kmh ?? (rd.line === 'branch' ? R.rail.branchKmh : R.rail.mainKmh);
    const at: LngLat = rd.eAt ?? route?.pts[0] ?? [74.3, 31.5];
    const timed = distKm > 0 ? timeTrains(trains, { distKm, kmh, startMs: atLocal(clock, rd.startDay, parseHHMM(rd.start) ?? 720), moveType: rd.moveType, intervalMin: rd.intervalMin, liveLine: rd.liveLine, stockPerDay: rd.stockPerDay, halts: rd.halts, at }, light, R.rail) : [];
    res.rail = { distKm, distSource, kmh, wagons: lw.wagons.length, unknown: lw.unknown, trains: timed, demand: stockDemand(timed, clock), perNight: trainsPerNight(light, rd.startDay, at, rd.intervalMin, R.rail) };
    if (timed.length) res.span = [timed[0].placed, Math.max(...timed.map((t) => t.detrained))];
  }

  if (plan.kind === 'enemy') {
    const railF = plan.enemy.filter((e) => e.mode === 'rail');
    const roadF = plan.enemy.filter((e) => e.mode === 'road');
    const outR = enemyRail(
      railF.map((e, i) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        trains: e.trains,
        eSta: e.eSta || e.id,
        dSta: e.dSta || e.id,
        distKm: e.distKm ?? (e.eAt && e.dAt ? (havM(e.eAt, e.dAt) / 1000) * R.rail.circuity : 0),
        kmh: e.kmh ?? R.rail.mainKmh,
        startDay: e.startDay,
        startMin: parseHHMM(e.start) ?? 360,
        gapMin: e.gapMin,
        halts: e.halts,
        order: plan.enemy.indexOf(e) + i * 0,
      })),
      clock,
      R.rail,
      R.enemy,
    );
    for (const e of railF) if (!(e.distKm ?? 0) && !(e.eAt && e.dAt)) res.errors.push(`${e.name}: set the distance or both stations`);
    const outRoad: { doc: MvEnemyDoc; run: MvRun; inducted: number }[] = [];
    for (const e of roadF) {
      const route = plan.routes.find((r) => r.id === e.routeId);
      if (!route || route.pts.length < 2) {
        res.errors.push(`${e.name}: by road needs a route`);
        continue;
      }
      const n = e.vehicles ?? R.enemy.roadVehs[e.type] ?? 600;
      const run = simulate(
        {
          id: e.id,
          name: e.name,
          vehicles: n,
          speedDay: e.kmh ?? R.enemy.roadSpeed[0],
          speedNi: e.kmh ?? R.enemy.roadSpeed[1],
          densDay: R.enemy.roadDensity[0],
          densNi: R.enemy.roadDensity[1],
          path: pathOf(route),
          startMs: atLocal(clock, e.startDay, parseHHMM(e.start) ?? 360),
          window: { kind: 'both' },
          halts: haltsOf(plan, R.road),
          densityHalt: true,
        },
        light,
        R.road,
      );
      outRoad.push({ doc: e, run, inducted: run.rpClear + R.enemy.readyAfterMin * MIN });
    }
    const items = [
      ...outR.map((o) => ({ id: o.id, name: o.name, type: o.type, start: o.first.dep, inducted: o.inducted })),
      ...outRoad.map((o) => ({ id: o.doc.id, name: o.doc.name, type: o.doc.type, start: o.run.spDue, inducted: o.inducted })),
    ];
    res.enemy = { rail: outR, road: outRoad, matrix: inductionMatrix(items, clock) };
    if (items.length) res.span = [Math.min(...items.map((x) => x.start)), Math.max(...items.map((x) => x.inducted))];
  }
  return res;
}

/** Trains a formation type needs (the type table), for the En Mov form. */
export function enemyTrains(type: string, R: MvRules): number {
  return trainsFor(type, R.enemy);
}

/** A short compass word for a route's general direction ("NE"). */
export function routeDir(r: MvRouteDoc): string {
  if (r.pts.length < 2) return '';
  const b = bearingDeg(r.pts[0], r.pts[r.pts.length - 1]);
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(b / 45) % 8];
}

export function routeKm(r: MvRouteDoc): number {
  return mkPath(r.pts).length / 1000;
}
