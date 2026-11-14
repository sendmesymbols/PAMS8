// more.mjs -- rail, enemy and report checks for the Move Planner (run by run.mjs).
export default async function more({ check, T, C, light, near, MIN, DOC }) {
  const RL = await import('../../MS/Engines/MovePlanner/MoveRail.ts');
  const EN = await import('../../MS/Engines/MovePlanner/MoveEnemy.ts');
  const RP = await import('../../MS/Engines/MovePlanner/MoveReports.ts');
  const RR = RL.railRulesFrom(DOC);
  const ER = EN.enemyRulesFrom(DOC);

  // ── rail: wagons ──────────────────────────────────────────────────────────────────────────────────────────────────
  const armdRegt = { id: 'u1', name: '11 Cav', vehicles: [{ kind: 'tank_t', count: 44 }, { kind: 'arv', count: 3 }, { kind: 'apc', count: 6 }, { kind: 'jeep', count: 9 }, { kind: 'trk_25', count: 20 }], pax: 0, storesTons: 30 };
  const lw = RL.loadWagons([armdRegt], RR);
  const by = (t) => lw.wagons.filter((w) => w.type === t).length;
  check('44 T-series tks = 22 MBFR double loaded; 3 ARV = 3 more MBFR', by('MBFR') === 25 && lw.wagons.filter((w) => w.type === 'MBFR' && w.double).length === 22, String(by('MBFR')));
  check('MBFR 96 t with two tks, 64 with one', lw.wagons.find((w) => w.type === 'MBFR' && w.double).tons === 96 && lw.wagons.find((w) => w.type === 'MBFR' && !w.double).tons === 64);
  check('6 APCs = 3 BKF, 20 trucks = 20 BKF, 9 jeeps = 5 KF, 30 t stores = 2 C', by('BKF') === 23 && by('KF') === 5 && by('C') === 2, `${by('BKF')} ${by('KF')} ${by('C')}`);
  const lw2 = RL.loadWagons([{ id: 'u2', name: 'x', vehicles: [{ kind: 'avlb', count: 2 }, { kind: 'zzz', count: 3 }], pax: 130, storesTons: 0 }], RR);
  check('an AVLB takes two MBFRs; 130 pax = 3 TLR; unknown kind listed', lw2.wagons.filter((w) => w.type === 'MBFR').length === 4 && lw2.wagons.filter((w) => w.type === 'TLR').length === 3 && lw2.unknown.length === 1);

  // ── rail: trains ──────────────────────────────────────────────────────────────────────────────────────────────────
  const trains = RL.composeTrains(lw.wagons, ['u1'], RR);
  const t1 = trains[0];
  check('standard components: 2 engines, brake van, 3 KF, a C, a TLR = 8 C units', t1.stock.Engine === 2 && t1.stock.Brake === 1 && t1.stock.TLR >= 1);
  check('no train over 72 C units or 2,000 tons', trains.every((t) => t.c <= 72 && t.tons <= 2000), trains.map((t) => `${t.c}C/${t.tons}t`).join(' '));
  check('a tank train takes at most 18 double-loaded MBFRs', trains.every((t) => t.mbfrDouble <= 18) && t1.mbfrDouble === 18, trains.map((t) => t.mbfrDouble).join());
  check('an armd regt fits 3 trains', trains.length === 3, String(trains.length));

  // ── rail: timetable, by night from Lahore ─────────────────────────────────────────────────────────────────────────
  const set = { distKm: 320, kmh: 32, startMs: T.atLocal(C, 0, 12 * 60), moveType: 'night', intervalMin: 90, liveLine: false, stockPerDay: null, halts: true, at: [74.33, 31.55] };
  const tt = RL.timeTrains(trains, set, light, RR);
  const ll = light.day(0, 31.55, 74.33).last;
  check('first stock placed 45 min after last light', near((tt[0].placed - ll) / MIN, 45, 0.5), T.hhmm(C, tt[0].placed));
  check('trains leave 90 min apart', near((tt[1].dep - tt[0].dep) / MIN, 90, 0.01) && near((tt[2].dep - tt[1].dep) / MIN, 90, 0.01), tt.map((t) => T.hhmm(C, t.dep)).join());
  check('320 km at 32 kmph = 10 h, one 60 min halt, +30 unforeseen', near((tt[0].arr - tt[0].dep) / MIN, 600 + 60 + 30, 0.5) && tt[0].haltCount === 1, ((tt[0].arr - tt[0].dep) / MIN).toFixed(0));
  check('every train is loaded by night', tt.every((t) => !light.isDay(t.placed + 1, 31.55, 74.33) && !light.isDay(t.placed + 60 * MIN, 31.55, 74.33)));
  // a long train list moves to the next night once loading would run into daylight
  const many = RL.composeTrains(RL.loadWagons([{ ...armdRegt, vehicles: [{ kind: 'tank_t', count: 300 }] }], RR).wagons, ['u1'], RR);
  const tm = RL.timeTrains(many, set, light, RR);
  const nights = new Set(tm.map((t) => T.mDayOf(C, t.placed - 6 * 60 * MIN)));
  check(`${many.length} tank trains need ${nights.size} nights, ${RL.trainsPerNight(light, 0, [74.33, 31.55], 90, RR)} a night`, nights.size >= 2 && tm.every((t) => !light.isDay(t.placed + 1, 31.55, 74.33)), tm.map((t) => T.dtg(C, t.placed)).join(' '));
  const dem = RL.stockDemand(tt, C);
  check('stock demand counts brake vans and engines', dem.total.Engine === 6 && dem.total.Brake === 3 && dem.total.MBFR === 25, JSON.stringify(dem.total));
  // wagons per day: only 20 MBFRs a day -> the second tank train waits a day
  const tl = RL.timeTrains(trains, { ...set, stockPerDay: { MBFR: 20 } }, light, RR);
  check('20 MBFRs a night: the second tank train goes the next night', tl[1].day === tl[0].day + 1 && tl[1].placed > light.day(1, 31.55, 74.33).last, tl.map((t) => `${t.day}:${T.dtg(C, t.placed)}`).join(' '));

  // ── enemy ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  check('armd div needs 55 trains (R)', EN.trainsFor('armd_div', ER) === 55);
  const fm = [
    { id: 'e1', name: '1 Armd Div', type: 'armd_div', trains: null, eSta: 'Jhansi', dSta: 'Suratgarh', distKm: 700, kmh: 40, startDay: 0, startMin: 360, gapMin: 60, halts: true, order: 1 },
    { id: 'e2', name: '33 Armd Div', type: 'armd_div', trains: 4, eSta: 'Jhansi', dSta: 'Bikaner', distKm: 700, kmh: 40, startDay: 0, startMin: 360, gapMin: 90, halts: true, order: 2 },
  ];
  const en = EN.enemyRail(fm, C, RR, ER);
  check('gap raised to the 90 min station rule', near((en[0].all[1].dep - en[0].all[0].dep) / MIN, 90, 0.01) && en[0].notes.some((x) => /Gap raised/.test(x)));
  check('700 km at 40 kmph: 1050 min + 2 halts + unforeseen', near((en[0].first.arr - en[0].first.dep) / MIN, 1050 + 120 + 30, 0.5), ((en[0].first.arr - en[0].first.dep) / MIN).toFixed(0));
  check('second formation from the same station follows the first', en[1].first.dep >= en[0].last.dep + 90 * MIN && en[1].heldMin > 0, `${T.dtg(C, en[0].last.dep)} -> ${T.dtg(C, en[1].first.dep)}`);
  check('inducted 3 h after the last train detrains', near((en[0].inducted - en[0].last.detrained) / MIN, 180, 0.01));
  const mx = EN.inductionMatrix(en.map((e) => ({ id: e.id, name: e.name, type: e.type, start: e.first.dep, inducted: e.inducted })), C);
  check('matrix: the first moving on M (the second queues), both in by the last day', mx[0].moving.length === 1 && mx[mx.length - 1].inducted.length === 2 && mx[mx.length - 1].byType.armd_div === 2, mx.map((r) => `${T.mDayLabel(r.day)}:${r.moving.length}/${r.inducted.length}`).join(' '));

  // ── reports ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const AR = RP.armRulesFrom(DOC);
  check('arm from SIDC: inf, armr, unknown = misc', RP.armOf('10031000141211000000', AR) === 'inf' && RP.armOf('10031000151205000000', AR) === 'armr' && RP.armOf('10031000150000000000', AR) === 'misc');
  const at = (d, h) => T.atLocal(C, d, h * 60);
  const units = [
    { id: 'a', name: '5 FF', corps: '1 Corps', opCorps: '30 Corps', fmn: '8 Div', gpPri: 1, arm: 'inf', bus: 7, trk: 10, closedMs: at(0, 22) },
    { id: 'b', name: '11 Cav', corps: '1 Corps', opCorps: '30 Corps', fmn: '6 Armd Div', gpPri: 1, arm: 'armr', bus: 2, trk: 12, closedMs: at(1, 3) },
    { id: 'c', name: '22 Punjab', corps: '2 Corps', opCorps: '4 Corps', fmn: '8 Div', gpPri: 2, arm: 'inf', bus: 7, trk: 10, closedMs: at(1, 20) },
  ];
  const pg = RP.progressByDay(units, C);
  check('progress: 1 Corps 50 % on M, 100 % on M+1', pg.days[0].pct['1 Corps'] === 50 && pg.days[1].pct['1 Corps'] === 100 && pg.days[1].pct['2 Corps'] === 100, JSON.stringify(pg.days.map((d) => d.pct)));
  check('progress by priority II: only 22 Punjab', RP.progressByDay(units, C, 2).total['2 Corps'] === 1 && !RP.progressByDay(units, C, 2).total['1 Corps']);
  const aw = RP.armWise(units, AR);
  check('arm-wise: two inf units, split by op corps', aw.cell('inf', '1 Corps')['30 Corps'] === 1 && aw.cell('inf', '2 Corps')['4 Corps'] === 1);
  const hm = RP.hmtByFmn(units);
  check('HMT by formation: 8 Div under 30 Corps 7 buses', hm.find((r) => r.fmn === '8 Div' && r.opCorps === '30 Corps').bus === 7 && hm.length === 3);
  const bt = RP.blockTimings([{ id: 'a', name: 'A', fmn: '8 Div', spDue: at(0, 18), rpClear: at(0, 23) }, { id: 'b', name: 'B', fmn: '8 Div', spDue: at(0, 19), rpClear: at(1, 2) }]);
  check('block timings: earliest SP due to latest RP clear', bt.length === 1 && bt[0].start === at(0, 18) && bt[0].finish === at(1, 2));
  const SR = RP.spaceRulesFrom(DOC);
  check('assy space: armd bde in 10 km2 too small, 14 enough', RP.assySpace('armd_bde', 10, SR).tone === 'bad' && RP.assySpace('armd_bde', 14, SR).tone === 'ok');

  // ── the plan model: one plan of each kind, worked out end to end ──────────────────────────────────────────────────
  const M = await import('../../MS/Engines/MovePlanner/MovePlannerModel.ts');
  const RU = M.rulesFrom(DOC);
  const kx = 111320 * Math.cos(31.5 * Math.PI / 180);
  const ew = [[74.0, 31.5], [74.0 + 60000 / kx, 31.5]];
  const ns = [[74.0 + 30000 / kx, 31.5 - 30000 / 110900], [74.0 + 30000 / kx, 31.5 + 30000 / 110900]];
  const di = M.newPlan('di', RU);
  di.mDate = '2026-11-14';
  di.routes.push({ id: 'r1', name: 'Red', color: '#f00', pts: ew, source: 'drawn', sp: 'SP Red', rp: 'Rel P Red', cps: [] });
  di.routes.push({ id: 'r2', name: 'Green', color: '#0f0', pts: ns, source: 'drawn', sp: 'SP Green', rp: 'Rel P Green', cps: [] });
  di.serials.push(M.newSerial(di, RU, { name: '5 FF', routeId: 'r1', corps: '1 Corps', opCorps: '30 Corps', fmn: '8 Div', corpsPri: 1, gpPri: 2, unitPri: 1, sidc: '10031000141211000000', concSummer: 60 }));
  di.serials.push(M.newSerial(di, RU, { name: '11 Cav', routeId: 'r2', corps: '2 Corps', opCorps: '4 Corps', fmn: '6 Armd Div', corpsPri: 1, gpPri: 1, unitPri: 1, sidc: '10031000151205000000', concSummer: 60 }));
  const dr = M.computePlan(di, RU);
  check('DI plan: both units worked out, 27 vehs each (HMT 10/7/10)', dr.errors.length === 0 && dr.serials.length === 2 && dr.serials[0].run.vehicles === 27, dr.errors.join('; '));
  check('DI plan: SP due = start 1800 + conc time 60 min', T.hhmm(C, dr.serials[0].run.spDue) === '1900' && dr.serials[0].conc.minutes === 60, T.dtg(C, dr.serials[0].run.spDue));
  check('DI plan: group priority 2 waits for group 1 at the crossing', dr.sched.conflicts.length === 1 && dr.sched.conflicts[0].loser === di.serials[0].id, JSON.stringify(dr.sched.conflicts.map((c) => [c.loser, c.waitMin])));
  check('DI plan: arms from the SIDCs', dr.di.units.map((u) => u.arm).join() === 'inf,armr');
  const rl = M.newPlan('rail', RU);
  rl.mDate = '2026-11-14';
  rl.rail.eAt = [74.33, 31.55];
  rl.rail.dAt = [73.08, 31.42];
  rl.serials.push(M.newSerial(rl, RU, { name: '11 Cav', mix: [{ kind: 'tank_t', count: 44 }, { kind: 'trk_25', count: 20 }], pax: 120 }));
  const rr = M.computePlan(rl, RU);
  check('rail plan: straight line x 1.25, trains timed', rr.errors.length === 0 && rr.rail.trains.length >= 2 && rr.rail.distSource.startsWith('straight'), `${rr.rail.distKm.toFixed(0)} km, ${rr.rail.trains.length} trains`);
  const enp = M.newPlan('enemy', RU);
  enp.mDate = '2026-11-14';
  enp.enemy.push(M.newEnemy(enp, RU, { name: '1 Armd Div', type: 'armd_div', distKm: 650 }));
  enp.routes.push({ id: 'r3', name: 'En Rd', color: '#c00', pts: ew, source: 'drawn', sp: 'SP', rp: 'RP', cps: [] });
  enp.enemy.push(M.newEnemy(enp, RU, { name: '9 Inf Bde', type: 'inf_bde', mode: 'road', routeId: 'r3' }));
  const er = M.computePlan(enp, RU);
  check('enemy plan: rail and road formations in the matrix', er.errors.length === 0 && er.enemy.rail[0].trains === 55 && er.enemy.road.length === 1 && er.enemy.matrix.length > 1, er.errors.join('; '));
  const back = M.normalisePlan(JSON.parse(JSON.stringify(di)), RU);
  check('a plan survives JSON and normalising', back.serials.length === 2 && back.routes[1].pts.length === 2 && M.computePlan(back, RU).serials.length === 2);
}
