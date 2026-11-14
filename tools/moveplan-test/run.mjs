// run.mjs -- Move Planner engine checks.
//   node tools/moveplan-test/run.mjs
// Node 24 runs the library's pure engines (MS/Engines/MovePlanner/Move*.ts) on routes built here near Lahore, so every
// answer has a known value: TPP by the Staff Duties examples, halts by running time, light at Lahore in November,
// harbours in a night-only window, the close-up halt at last light, crossings and joins resolved by priority, trains
// composed within 72 C units and 2,000 tons, and enemy trains by the M day. Exit code 1 on a failure.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const T = await import('../../MS/Engines/MovePlanner/MoveTime.ts');
const G = await import('../../MS/Engines/MovePlanner/MoveGeo.ts');
const RD = await import('../../MS/Engines/MovePlanner/MoveRoad.ts');

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const DOC = JSON.parse(readFileSync(resolve(repo, 'MS/Data/MoveDoctrine.json'), 'utf8'));
const R = RD.roadRulesFrom(DOC);

let fails = 0;
let n = 0;
export function check(name, ok, info = '') {
  n++;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const MIN = 60000;

// ── 1. TPP and length (Staff Duties Vol II 14.1405 / 14.1419) ───────────────────────────────────────────────────────
check('TPP 318 vehs, 8 vpm, 18 mph = 2 h 39 min (graph: 2 h 12 + 26)', RD.tppMin(318, 8, 18, R) === 159, String(RD.tppMin(318, 8, 18, R)));
check('extra allowance 2 min per 25 or part: 318 -> 26, 25 -> 2, 26 -> 4', RD.extraMin(318, R) === 26 && RD.extraMin(25, R) === 2 && RD.extraMin(26, R) === 4);
check('TPP 450 vehs at 20 vpkm, 40 kmph = 70 min', RD.tppMin(450, 20, 40, R) === 70, String(RD.tppMin(450, 20, 40, R)));
check('length = TPP x speed: 450 vehs 20 vpkm 40 kmph = 46.5 km', near(RD.columnLengthM(450, 20, 40, R), 22500 + 24000, 1), String(RD.columnLengthM(450, 20, 40, R)));
check('speeds (R): good road excl tks 40 / 30, all types bad 20 / 15', RD.speedFor('good', false, R).join() === '40,30' && RD.speedFor('bad', true, R).join() === '20,15');

// ── 2. clock and light ──────────────────────────────────────────────────────────────────────────────────────────────
const C = T.clockFrom('2026-11-14', 300);
check('M day midnight PKT = 19:00 UTC the day before', new Date(C.mDayMs).toISOString() === '2026-11-13T19:00:00.000Z');
check('HH:MM parse', T.parseHHMM('18:30') === 1110 && T.parseHHMM('0545') === 345 && T.parseHHMM('25:00') === null);
check('DTG: M+1 0215', T.dtg(C, T.atLocal(C, 1, 135)) === 'M+1 0215' && T.dtg(C, T.atLocal(C, 0, 1110)) === 'M 1830');
const light = new T.LightBook(C, 'sun');
const LHR = [74.33, 31.55];
const dl = light.day(0, LHR[1], LHR[0]);
const fl = T.localMin(C, dl.first), ll = T.localMin(C, dl.last);
check('Lahore 14 Nov sunrise about 0640 PKT', fl > 6 * 60 + 25 && fl < 6 * 60 + 55, T.hhmm(C, dl.first));
check('Lahore 14 Nov sunset about 1710 PKT', ll > 17 * 60 && ll < 17 * 60 + 20, T.hhmm(C, dl.last));
check('day at noon, night at 2000', light.isDay(T.atLocal(C, 0, 720), LHR[1], LHR[0]) && !light.isDay(T.atLocal(C, 0, 1200), LHR[1], LHR[0]));
const civil = new T.LightBook(C, 'civil').day(0, LHR[1], LHR[0]);
check('civil first light earlier than sunrise', civil.first < dl.first && civil.last > dl.last);

// ── 3. one serial on a straight road east of Lahore ─────────────────────────────────────────────────────────────────
const line = (a, b, k = 40) => Array.from({ length: k + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / k, a[1] + ((b[1] - a[1]) * i) / k]);
const P100 = G.mkPath(line([74.0, 31.5], [74.0 + 100000 / (111320 * Math.cos(31.5 * Math.PI / 180)), 31.5]));
check('100 km path', near(P100.length, 100000, 150), P100.length.toFixed(0));
const halts = { mode: 'running', runMin: R.shortRunMin, haltMin: R.shortHaltMin, longEvery: R.longEvery, longMin: R.longHaltMin, clockFirstAtMin: R.clockFirstAtMin, clockEveryMin: R.clockEveryMin };
const base = { id: 's1', name: '1 Bde', vehicles: 100, speedDay: 40, speedNi: 30, densDay: 20, densNi: 40, path: P100, startMs: T.atLocal(C, 0, 8 * 60), window: { kind: 'both' }, halts, densityHalt: true };
const r1 = RD.simulate(base, light, R);
const sh = r1.stops.filter((s) => s.kind === 'SH');
check('one short halt after 110 min running, at 73.3 km', sh.length === 1 && near(sh[0].s, 73333, 60), `${sh.length} ${sh[0]?.s.toFixed(0)}`);
check('RP due = 150 min running + 10 min halt', near((r1.rpDue - r1.spDue) / MIN, 160, 0.6), ((r1.rpDue - r1.spDue) / MIN).toFixed(1));
check('SP clear = SP due + day TPP (15.5 min, shown 16)', near((r1.spClear - r1.spDue) / MIN, 15.5, 0.05) && r1.tppDay === 16, `${((r1.spClear - r1.spDue) / MIN).toFixed(2)} vs TPP ${r1.tppDay}`);
check('RP clear = RP due + TPP (no halt while passing)', near((r1.rpClear - r1.rpDue) / MIN, (100 * 60) / 800 + 8, 0.6), ((r1.rpClear - r1.rpDue) / MIN).toFixed(1));
const mid = RD.positionAt(r1, r1.spDue + 60 * MIN);
check('after 1 h the head is 40 km on, the tail one length behind', near(mid.head, 40000, 30) && near(mid.head - mid.tail, r1.lenDayM, 30), `${mid.head.toFixed(0)} ${(mid.head - mid.tail).toFixed(0)}`);

// clock halts: every column halts at 10 to each odd hour

// night only from 1800: harbours at first light, goes on at last light
const P400 = G.mkPath(line([74.0, 31.5], [74.0 + 400000 / (111320 * Math.cos(31.5 * Math.PI / 180)), 31.5], 120));
const rc = RD.simulate({ ...base, path: P400, densityHalt: false, halts: { ...halts, mode: 'clock' } }, light, R);
check('clock halts at 0850, 1050, 1250', rc.stops.filter((s) => s.kind === 'SH').slice(0, 3).map((s) => T.hhmm(C, s.t0)).join() === '0850,1050,1250', rc.stops.map((s) => T.hhmm(C, s.t0)).join());
const rn = RD.simulate({ ...base, path: P400, speedNi: 20, startMs: T.atLocal(C, 0, 18 * 60), window: { kind: 'night' } }, light, R);
const dlh = rn.stops.filter((s) => s.kind === 'DLH');
check('night move harbours by day', dlh.length >= 1 && dlh.every((s) => !light.isDay(s.t0 - 2 * MIN, LHR[1], 74.5) || T.localMin(C, s.t0) % 1440 > 300), dlh.map((s) => `${T.dtg(C, s.t0)}-${T.dtg(C, s.t1)}`).join(' '));
check('it moves on at last light', dlh.length >= 1 && near(T.localMin(C, dlh[0].t1) % 1440, ll, 20), dlh.map((s) => T.dtg(C, s.t1)).join());
const movingByDay = rn.segs.filter((g) => g.mode === 'move' && !g.virtual && g.day && g.t1 - g.t0 > 2 * MIN);
check('never moves by day', movingByDay.length === 0, String(movingByDay.length));

// a day start running into last light closes up to night density
const rd = RD.simulate({ ...base, path: P400, startMs: T.atLocal(C, 0, 15 * 60) }, light, R);
const dc = rd.stops.find((s) => s.kind === 'DC');
check('close-up halt at last light = Day TPP - Ni TPP, or longer for the tail at night speed', !!dc && near((dc.t1 - dc.t0) / MIN, Math.max(rd.tppDay - rd.tppNi, Math.ceil((rd.lenDayM - rd.lenNiM) / 500)), 0.01) && near(T.localMin(C, dc.t0), ll, 3), dc ? `${T.hhmm(C, dc.t0)} ${(dc.t1 - dc.t0) / MIN}` : 'none');
const after = RD.positionAt(rd, dc.t1 + 30 * MIN);
check('after it the column runs at night length', near(after.head - after.tail, rd.lenNiM, 60), `${(after.head - after.tail).toFixed(0)} vs ${rd.lenNiM.toFixed(0)}`);

// ── 4. routes that cross, and serials that share a road ─────────────────────────────────────────────────────────────
const kx = 111320 * Math.cos(31.5 * Math.PI / 180);
const EW = G.mkPath(line([74.0, 31.5], [74.0 + 60000 / kx, 31.5]));
const cx = 74.0 + 30000 / kx;
const NS = G.mkPath(line([cx, 31.5 - 30000 / 110900], [cx, 31.5 + 30000 / 110900]));
const ms = G.meetPoints(EW, NS, R.joinTolM);
check('crossing found at 30 km on both', ms.length === 1 && ms[0].kind === 'cross' && near(ms[0].sA, 30000, 80) && near(ms[0].sB, 30000, 80), JSON.stringify(ms.map((m) => [m.kind, Math.round(m.sA), Math.round(m.sB)])));
const s0 = T.atLocal(C, 0, 9 * 60);
const A = { ...base, id: 'A', name: 'A', path: EW, startMs: s0, pri: [1, 1, 1], order: 1 };
const B = { ...base, id: 'B', name: 'B', path: NS, startMs: s0, pri: [1, 2, 1], order: 2 };
const sch = RD.schedule([A, B], light, R);
const xa = RD.clearAt(sch.runs.A, sch.conflicts[0]?.sWinner ?? 0), xb = RD.dueAt(sch.runs.B, sch.conflicts[0]?.sLoser ?? 0);
check('lower group priority waits at the crossing', sch.conflicts.length === 1 && sch.conflicts[0].loser === 'B', JSON.stringify(sch.conflicts.map((c) => [c.loser, c.waitMin])));
check('B is due when A has cleared + 1 min', near((xb - xa) / MIN, 1, 0.2), ((xb - xa) / MIN).toFixed(2));
// corps beats group: B with the better corps wins although its group is worse (the old all-three test got this wrong)
const sch2 = RD.schedule([{ ...A, pri: [2, 1, 1] }, { ...B, pri: [1, 3, 1] }], light, R);
check('corps priority decides first', sch2.conflicts[0]?.loser === 'A', sch2.conflicts[0]?.loser);
// B arrives first and is still passing: it still yields to the priority serial (old rule, branch that never ran)
const sch3 = RD.schedule([{ ...A, startMs: s0 + 10 * MIN }, B], light, R);
const c3 = sch3.conflicts[0];
check('priority serial goes first even when it arrives later', c3?.loser === 'B' && RD.dueAt(sch3.runs.B, c3.sLoser) >= RD.clearAt(sch3.runs.A, c3.sWinner), sch3.conflicts.map((c) => `${c.loser} ${c.waitMin}`).join());
// same SP, same road: the second follows when the first has cleared the SP
const sch4 = RD.schedule([{ ...A }, { ...A, id: 'A2', name: 'A2', pri: [1, 1, 2], order: 2 }], light, R);
check('second serial on the same road starts when the first clears the SP + 1', near((sch4.runs.A2.spDue - sch4.runs.A.spClear) / MIN, 1, 0.2), ((sch4.runs.A2.spDue - sch4.runs.A.spClear) / MIN).toFixed(2));
// a faster column behind closes up instead of passing
const sch5 = RD.schedule([{ ...A, speedDay: 25 }, { ...A, id: 'F', name: 'F', speedDay: 40, startMs: s0 + 5 * MIN, pri: [1, 1, 2], order: 2 }], light, R);
const passes = [10000, 20000, 30000, 40000, 50000, 60000].filter((s) => RD.dueAt(sch5.runs.F, s - 1) < RD.clearAt(sch5.runs.A, s - 1)).length;
check('faster column never runs into the slower', passes === 0, `${passes} clashes, ${sch5.conflicts.length} waits`);
// a night move set to start before last light: the second serial's wait at the SP counts from last light, not the plan
const n0 = T.atLocal(C, 0, 15 * 60);
const sch7 = RD.schedule([{ ...A, startMs: n0, window: { kind: 'night' } }, { ...A, id: 'A3', name: 'A3', startMs: n0, window: { kind: 'night' }, pri: [1, 1, 2], order: 2 }], light, R);
const x7 = sch7.runs.A3.stops.find((s) => s.kind === 'X');
check('wait at the SP counted from last light (window first)', !!x7 && near((x7.t1 - x7.t0) / MIN, (sch7.runs.A.spClear - sch7.runs.A.spDue) / MIN + 1, 0.6) && x7.t0 >= sch7.runs.A.spDue, x7 ? `${T.hhmm(C, x7.t0)}-${T.hhmm(C, x7.t1)}` : 'none');
// head-on on a two-way road: no clash
const WE = G.mkPath([...EW.pts].reverse());
const sch6 = RD.schedule([A, { ...B, path: WE }], light, R);
check('head-on on a two-way road: no wait', sch6.conflicts.length === 0, String(sch6.conflicts.length));

// legs
const legs = RD.legsOf(sch.runs.B, [{ name: 'CP 1', s: 15000 }]);
check('legs: SP-CP 1, CP 1-X Pt, X Pt-Rel P', legs.length === 3 && legs[1].to.startsWith('X Pt') && legs[1].x === 1 && legs[2].x === 0, legs.map((l) => `${l.from}>${l.to}:${l.x}`).join(' | '));

// flow past the SP (planning table)
const fl1 = RD.flowAt([{ id: 'A', vehicles: 100, due: s0, clear: s0 + 30 * MIN }, { id: 'B', vehicles: 60, due: s0 + 30 * MIN, clear: s0 + 90 * MIN }]);
check('flow per hour adds up to the vehicles', fl1.reduce((m, r) => m + r.total, 0) === 160, fl1.map((r) => r.total).join());

export { R, T, G, RD, C, light, line, base, halts, near, MIN };
if (process.argv[1] && process.argv[1].endsWith('run.mjs')) {
  const more = await import('./more.mjs').catch((e) => (e.code === 'ERR_MODULE_NOT_FOUND' ? null : Promise.reject(e)));
  if (more) await more.default({ check, R, T, G, RD, C, light, line, base, halts, near, MIN, DOC });
  console.log(`\n${n - fails} / ${n} passed`);
  process.exit(fails ? 1 : 0);
}
