// decision.mjs -- checks for the IPB rates, event template, decision support and Annex A weather
// (GroundGuideIpbDecision.ts).  node tools/ipb-test/decision.mjs
// Avenues drawn by hand (GO, SLOW-GO, unassessed stretches, narrows, crossings) with answers worked out by hand.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
register('../movement-test/hooks.mjs', import.meta.url);
const { decide, decRatesFrom, hPlus, annexA } = await import('../../MS/Engines/GroundGuide/GroundGuideIpbDecision.ts');
const here = dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(readFileSync(resolve(here, '../../MS/Data/IpbDoctrine.json'), 'utf8'));

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
}
const near = (a, b, e = 0.01) => Math.abs(a - b) <= e;
const veh = decRatesFrom(doc, 'armour');
const foot = decRatesFrom(doc, 'dismounted');
const aa = (id, going, narrows = [], o = {}) => ({ id, viable: true, main: id === 'A', startM: 0, endM: going[going.length - 1][1], going: going.map(([fromM, toM, cls]) => ({ fromM, toM, cls })), narrows, depthM: null, ...o });
const args = (aas, o = {}) => ({ aas, crossovers: [], rates: veh, leadM: {}, leadH: 2, reactionH: 0, mcWidthM: 500, catkMin: null, catkLabel: 'Bn', ...o });
const prof = (r, id) => r.profiles.find((p) => p.aa === id);

check('book rates: vehicles 24 / 16 / 1 by day, 24 / 8 / 0.1 by night; foot 4 / 2.4 / 1 and 3.2 / 1.6 / 0.1', veh.go[0] === 24 && veh.slow[0] === 16 && veh.slow[1] === 8 && veh.nogo[1] === 0.1 && foot.go[0] === 4 && foot.go[1] === 3.2 && foot.slow[0] === 2.4, JSON.stringify({ veh, foot }));
{
  const r = decide(args([aa('A', [[0, 24000, 'go']])]));
  check('24 km of GO for armour: 1 h by day and by night', near(prof(r, 'A').endH[0], 1) && near(prof(r, 'A').endH[1], 1));
}
{
  const r = decide(args([aa('A', [[0, 10000, 'go'], [10000, 14000, 'slow'], [14000, 24000, 'go']])]));
  const e = 20 / 24 + 4 / 16, l = 20 / 24 + 4 / 8;
  check('a 4 km SLOW-GO stretch: 16 km/h by day, 8 by night', near(prof(r, 'A').endH[0], e) && near(prof(r, 'A').endH[1], l), `${hPlus(prof(r, 'A').endH[0])} / ${hPlus(prof(r, 'A').endH[1])}`);
}
{
  const r = decide(args([aa('A', [[0, 12000, 'na'], [12000, 24000, 'go']])]));
  check('ground not assessed: GO at the earliest, SLOW-GO by night at the latest (he is never assumed slower)', near(prof(r, 'A').endH[0], 1) && near(prof(r, 'A').endH[1], 12 / 8 + 12 / 24));
}
{
  const r = decide(args([aa('A', [[0, 24000, 'go']])], { leadM: { A: 12000 } }));
  const entry = r.nais.find((n) => n.kind === 'entry');
  check('the threat 12 km out: he enters the area at H+0:30', near(entry.earliestH, 0.5) && hPlus(entry.earliestH) === 'H+0:30', hPlus(entry.earliestH));
}
{
  const r = decide(args([aa('A', [[0, 24000, 'go']], [{ alongM: 6000, widthM: 300, kind: 'narrow' }, { alongM: 12000, widthM: 60, kind: 'crossing' }, { alongM: 18000, widthM: 700, kind: 'narrow' }]), aa('B', [[0, 24000, 'go']])], { crossovers: [{ id: 'X1', a: 'A', b: 'B', alongM: 9000 }] }));
  const kinds = r.nais.map((n) => `${n.id}:${n.aa}:${n.kind}`).join(' ');
  check('NAIs at the entries, the narrows, the crossing and the crossover, numbered by time', r.nais.length === 6 && r.nais[0].kind === 'entry' && r.nais.every((n, i) => i === 0 || n.earliestH >= r.nais[i - 1].earliestH) && r.nais.some((n) => n.kind === 'crossover'), kinds);
  check('TAIs: the crossing and the 300 m narrows (under the 500 m corridor), not the 700 m one', r.tais.length === 2 && r.tais.some((t) => /crossing/.test(t.why)) && r.tais.some((t) => /300 m/.test(t.why)) && !r.tais.some((t) => /700/.test(t.why)), r.tais.map((t) => `${t.id} ${t.why}`).join('; '));
  check('each TAI has its NAI marked', r.tais.every((t) => r.nais.find((n) => n.id === t.nai)?.tai === t.id));
}
{
  // TAI at 20 km, threat 60 km out: he is there at H+3:20; the DP 2 h earlier (H+1:20) is 28 km before he enters the area.
  const r = decide(args([aa('A', [[0, 24000, 'go']], [{ alongM: 20000, widthM: 60, kind: 'crossing' }])], { leadM: { A: 60000 } }));
  const dp = r.dps[0], tai = r.tais[0];
  check('TAI H+3:20 with the threat 60 km out', hPlus(tai.earliestH) === 'H+3:20', hPlus(tai.earliestH));
  check('its DP 2 h earlier (H+1:20) lies 28 km beyond the area, toward him', dp && dp.kind === 'interdict' && hPlus(dp.earliestH) === 'H+1:20' && near(dp.beyondM, 28000, 50) && !dp.beforeH, dp ? `${dp.id} ${hPlus(dp.earliestH)} · ${(dp.beyondM / 1000).toFixed(1)} km beyond` : 'none');
  check('the note says a DP lies beyond the area (the higher HQ\'s NAIs)', r.notes.some((n) => /beyond the area/.test(n)));
}
{
  // No threat place: H at the area's edge; TAI at 12 km (H+0:30): the DP falls before H.
  const r = decide(args([aa('A', [[0, 24000, 'go']], [{ alongM: 12000, widthM: 60, kind: 'crossing' }])]));
  check('a DP before the enemy starts: decide it before H', r.dps[0]?.beforeH === true && r.notes.some((n) => /before the enemy starts/.test(n)));
  const r2 = decide(args([aa('A', [[0, 24000, 'go']], [{ alongM: 12000, widthM: 60, kind: 'crossing' }])], { reactionH: 1, leadM: { A: 100000 } }));
  check('the own action\'s time is added to the 2 h (DP 3 h before the TAI)', near(r2.tais[0].earliestH - r2.dps[0].earliestH, 3));
}
{
  // Depth localities 18 km in, Bn counter-attack 60 min: the CATK DP where he is 1 h short of them.
  const r = decide(args([aa('A', [[0, 24000, 'go']], [], { depthM: 18000 })], { catkMin: 60, leadM: { A: 48000 } }));
  const d = r.dps.find((x) => x.kind === 'catk');
  check('counter-attack DP: 1 h before he reaches the depth localities', !!d && near(d.earliestH, (48 + 18) / 24 - 1) && /counter-attack/.test(d.decision), d ? `${d.id} ${hPlus(d.earliestH)}` : 'none');
}
{
  const r = decide(args([aa('A', [[0, 8000, 'go']])], { rates: foot }));
  check('dismounted: 8 km of GO in 2 h by day, 2.5 h by night', near(prof(r, 'A').endH[0], 2) && near(prof(r, 'A').endH[1], 2.5));
}
check('hPlus: H+1:25, H-0:40', hPlus(1 + 25 / 60) === 'H+1:25' && hPlus(-40 / 60) === 'H-0:40');

// ------------------------------------------------------------------------------------------------ Annex A
{
  const w = { month: 1, vis: { meanViewKm: 4, lt2kmPct: 18, fogPct: 12, stationKm: 30 }, clim: { tmin: [-5], tmax: [38], wind: [5.5], prec: [40] } };
  const rows = annexA(doc.weather.rows, w);
  const st = (mission, element) => rows.find((r) => r.mission.startsWith(mission) && r.element === element)?.status;
  check('visibility 4 km: tracked GO, anti-tank GO, 155 mm marginal, CAS unfavourable', st('Mnvr - mob, tracked, day', 'visibility') === 'go' && st('Mnvr - weapon positioning', 'visibility') === 'go' && st('Fire Sp (155', 'visibility') === 'marg' && st('Fire Sp (CAS', 'visibility') === 'unfav');
  check('dismounted heat: mean max 38 °C over 32 is marginal; anti-tank cold: mean min -5 °C is GO', st('Mnvr - mob, dismounted', 'temperature') === 'marg' && st('Mnvr - weapon positioning', 'temperature') === 'go');
  const chill = rows.find((r) => r.element === 'wind chill');
  check('wind chill at -5 °C and 5.5 m/s is about -12 °C: marginal (0 to -30)', chill.status === 'marg' && /-1[0-2]/.test(chill.value), chill.value);
  check('surface wind 5.5 m/s (10.7 kt): GO for 155 mm (< 35 kt), marginal for airborne (10-13 kt)', st('Fire Sp (155', 'surface wind') === 'go' && st('Airborne', 'surface wind') === 'marg');
  check('ceiling, clouds, stability, humidity: get from Met; rainfall rate and snow depth: not in the bundle', st('Fire Sp (CAS', 'ceiling') === 'met' && st('NBC', 'humidity') === 'met' && st('Mnvr - mob, tracked, day', 'rainfall') === 'na' && /40 mm/.test(rows.find((r) => r.element === 'rainfall').value));
  check('visibility carries the share of days under 2 km and fog', /18% of days under 2 km/.test(rows[0].value) && /fog 12%/.test(rows[0].value), rows[0].value);
  const none = annexA(doc.weather.rows, { month: 6, vis: null, clim: null });
  check('no data: every row says so, none coded', none.every((r) => r.status === 'na' || r.status === 'met'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
