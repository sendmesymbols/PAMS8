// run.mjs -- Night March chart engine checks.
//   node tools/nightmarch-test/run.mjs
// Node 24 runs the library's own pure engine (MS/Engines/NightMarch/NightMarchRead.ts), which leans on the Platoon
// Guide's patrol route card, on routes built here: once from the geometry alone and once over a small synthetic piece of
// ground (a canal, a road, a hill, a mosque), so every answer has a known place to be found. Exit code 1 on a failure.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const N = await import('../../MS/Engines/NightMarch/NightMarchRead.ts');
const P = await import('../../MS/Engines/PlatoonGuide/PlatoonGuideRead.ts');

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const R = N.nmRulesFrom(JSON.parse(readFileSync(resolve(repo, 'MS/Data/NightMarchDoctrine.json'), 'utf8')));
const PR = P.plRulesFrom(JSON.parse(readFileSync(resolve(repo, 'MS/Data/PlatoonDoctrine.json'), 'utf8')));
const speeds = JSON.parse(readFileSync(resolve(repo, 'MS/Data/MovementSpeeds.json'), 'utf8'));

let fails = 0;
let n = 0;
function check(name, ok, info = '') {
  n++;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ── ground near Islamabad: metres east / north of O ─────────────────────────────────────────────────────────────────
const D2R = Math.PI / 180;
const lngLatToMerc = (lng, lat) => [(lng * Math.PI * 6378137) / 180, Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2)) * 6378137];
const O = lngLatToMerc(73.0, 33.6);
const s = P.plScale(O[1]);
const at = (e, nn) => [O[0] + e / s, O[1] + nn / s];

// ── 1. pure helpers ─────────────────────────────────────────────────────────────────────────────────────────────────
check('120 paces per 100 m', N.pacesFor(100, R) === 120 && N.pacesFor(650, R) === 780);
check('mils: 90° = 1600 mils', N.toMils(90) === 1600 && N.toMils(360) === 0);
check('magnetic = grid - GMA (east)', N.magOf(45, 3) === 42 && N.magOf(1, 3) === 358 && N.magOf(45, null) === null);
check('HH:MM parse', N.parseHHMM('02:30') === 150 && N.parseHHMM('0415') === 255 && N.parseHHMM('25:00') === null && N.parseHHMM('') === null);
check('clock wraps the day', N.clock(-30) === '23:30' && N.clock(150) === '02:30');
check('H-relative', N.hRel(-165) === 'H-2:45' && N.hRel(0) === 'H');

// ── 2. geometry only: SP 3 km south-west, two turns, FUP; Obj 1.5 km beyond the FUP ─────────────────────────────────
const route = [at(-1500, -3000), at(-1500, -1500), at(0, -1000), at(0, 0)];
const obj = at(0, 1500);
const flat = N.nightMarchChart({ path: route, objective: obj, echelon: 'company', gmaDeg: 3, hHourMin: N.parseHHMM('03:00'), terrainKind: 'plains' }, R);
check('three legs', flat.legs.length === 3, `${flat.legs.length}`);
check('leg 1 due north', near(flat.legs[0].bearingDeg, 0, 0.5) || near(flat.legs[0].bearingDeg, 360, 0.5), flat.legs[0].bearingDeg.toFixed(1));
check('leg 1 magnetic = 357', Math.round(flat.legs[0].magDeg) === 357, String(flat.legs[0].magDeg));
check('leg 1 1500 m = 1800 paces', near(flat.legs[0].distM, 1500, 3) && near(flat.legs[0].paces, 1800, 4), `${flat.legs[0].distM.toFixed(0)} m ${flat.legs[0].paces}`);
check('running paces add up', flat.legs[2].cumPaces === N.pacesFor(flat.lengthM, R) && flat.paces === flat.legs[2].cumPaces);
check('long leg gets check points', flat.legs[0].long && flat.legs[0].checkPts.length === 2, `${flat.legs[0].checkPts.map((c) => c.atM)}`);
check('no terrain: flat 3 km/h + 15%', flat.timing.flatKmh === 3 && near(flat.legs[0].minNight, 30 * 1.15, 1), String(flat.legs[0].minNight));
check('FUP 1500 m: ok', flat.fup.tone === 'ok' && near(flat.fup.distToObjM, 1500, 3));
check('axis on the Obj (north)', near(flat.fup.axisDeg, 0, 0.5) || near(flat.fup.axisDeg, 360, 0.5));
check('SL square to the axis, company front 200 m', near(P.plDist(flat.fup.sl[0], flat.fup.sl[1]), 200, 1) && near(P.plBearing(flat.fup.sl[0], flat.fup.sl[1]), 90, 1));
check('SL in front of the FUP centre', P.plDist(N.nearestOnPath([flat.fup.sl[0], flat.fup.sl[1]], obj).at, obj) < 1500);
check('company FUP: 4 places', flat.fup.slots.length === 4 && flat.fup.slots.some((x) => x.hq));
check('approach from the rear: ok', flat.fup.approachTone === 'ok', flat.fup.approachDeg.toFixed(0));
const totalMin = flat.legs.reduce((a, l) => a + l.minNight, 0);
check('march time = legs + halts', flat.timing.marchMin === flat.legs[2].endMin && near(flat.timing.marchMin, totalMin + flat.timing.halts.length * 15, 2), `${flat.timing.marchMin} vs ${totalMin}+${flat.timing.halts.length}h`);
check('leave SP = H - march - FUP time', flat.timing.leaveBeforeH === flat.timing.marchMin + 20 && flat.timing.leaveSp === N.clock(180 - flat.timing.leaveBeforeH), `${flat.timing.leaveSp}`);
check('stores: SL + FUP + axis tape', flat.stores.tapeM === 200 + 2 * (200 + 120) + 100 && flat.stores.rolls === 10, `${flat.stores.tapeM} m ${flat.stores.rolls}`);
check('lights: SP, turns, route, entry, SL, corners, axis', flat.lights.filter((l) => l.kind === 'turn').length === 2 && flat.lights.filter((l) => l.kind === 'sl').length === 2 && flat.lights.some((l) => l.kind === 'axis'));
check('night sight ring entered before the FUP', flat.sights.night.enterAtM === null, String(flat.sights.night.enterAtM));
check('thermal ring entered', flat.sights.thermal.enterAtM !== null && flat.sights.thermal.enterAtM < flat.lengthM);
check('no terrain is said', flat.checks.some((c) => /No terrain read/.test(c.text)));

// Long march: halts every 2 h.
const longRoute = [at(0, -12000), at(0, -1300)];
const lm = N.nightMarchChart({ path: longRoute, objective: obj, echelon: 'battalion', gmaDeg: null, hHourMin: null, terrainKind: 'plains' }, R);
check('long march: halts after 2 h of moving', lm.timing.halts.length === Math.floor((lm.timing.moveMin - 0.001) / 120) && lm.timing.halts[0].atMin === 120, `${lm.timing.halts.map((h) => h.atMin)} move ${lm.timing.moveMin}`);
check('no GMA: warn + magnetic null', lm.legs[0].magDeg === null && lm.checks.some((c) => /grid-magnetic/.test(c.text)));
check('no H: clock null', lm.timing.leaveSp === null && lm.timing.leaveBeforeH > 0);
check('battalion FUP 2800 m from the Obj', near(lm.fup.distToObjM, 2800, 5));

// FUP too close, approach from the enemy side.
const close = N.nightMarchChart({ path: [at(0, 2500), at(0, 700)], objective: obj, echelon: 'platoon', gmaDeg: 2, hHourMin: null, terrainKind: 'plains' }, R);
check('FUP 800 m: bad', close.fup.tone === 'bad' && close.tone === 'bad' && close.checks[0].tone === 'bad');
check('route from beyond the Obj side: bad approach', close.fup.approachTone === 'bad', close.fup.approachDeg.toFixed(0));
const edge = N.nightMarchChart({ path: [at(-500, -1500), at(0, 400)], objective: obj, echelon: 'platoon', gmaDeg: 2, hHourMin: null, terrainKind: 'plains' }, R);
check('FUP 1100 m: warn', edge.fup.tone === 'warn');
const tanks = N.nightMarchChart({ path: route, objective: obj, echelon: 'company', gmaDeg: 2, hHourMin: null, terrainKind: 'plains', tanks: true }, R);
check('with tanks 1500 m is too close', tanks.fup.tone === 'bad');
const noObj = N.nightMarchChart({ path: route, objective: null, echelon: 'company', gmaDeg: 2, hHourMin: null, terrainKind: 'desert' }, R);
check('no Obj: axis along the last leg, warn', near(noObj.fup.axisDeg, flat.legs[2].bearingDeg, 0.5) && noObj.checks.some((c) => /No Obj set/.test(c.text)) && noObj.sights === null);
check('desert night speed 2.5', noObj.timing.flatKmh === 2.5);

// ── 3. over ground: a canal across leg 2, a road on the SL, a mosque at turn 1, a crest ────────────────────────────
function clsL(e, nn) {
  if (Math.abs(nn + 1250) <= 10 && e >= -1600 && e <= 200) return 20; // canal (NO-GO on foot)
  if (Math.abs(nn - 60) <= 6 && Math.abs(e) <= 1000) return 34; // road east-west, on the company SL (FUP depth 120 / 2)
  return 0;
}
function elevL(e, nn) {
  const d = Math.hypot(e + 1500, nn + 2200);
  return 500 + (d < 250 ? 40 * (1 - (d / 250) ** 2) : 0);
}
const loc = (x, y) => ({ e: (x - O[0]) * s, n: (y - O[1]) * s });
const FEATS = [{ kind: 'mosque', label: 'Mosque', name: 'Masjid Test', ...{ x: at(-1490, -1490)[0], y: at(-1490, -1490)[1] } }];
const probe = {
  resM: 30,
  cls: (x, y) => {
    const { e, n: nn } = loc(x, y);
    return clsL(e, nn);
  },
  elev: (x, y) => {
    const { e, n: nn } = loc(x, y);
    return elevL(e, nn);
  },
  bld: () => 0,
  sight: () => null,
  sight2: () => null,
  features: (x, y, r, kinds) =>
    FEATS.filter((f) => kinds.has(f.kind))
      .map((f) => ({ ...f, distM: P.plDist([x, y], [f.x, f.y]), attrs: {} }))
      .filter((f) => f.distM <= r),
  roads: () => [],
  lines: (x, y, r, kinds) => {
    if (!kinds.has('road')) return [];
    const a = at(-1000, 60), b = at(1000, 60);
    const d = Math.abs(loc(x, y).n - 60);
    return d <= r ? [{ kind: 'road', xy: [a[0], a[1], b[0], b[1]], attrs: { n: 'Test Rd' } }] : [];
  },
  people: () => null,
  raster: (layer, x, y) => {
    if (layer !== 'landform') return 0;
    const { e, n: nn } = loc(x, y);
    return Math.hypot(e + 1500, nn + 2200) < 60 ? 6 : 1;
  },
  takePending: () => false,
};
const foot = { nogo: new Set([20]), caution: new Set() };
const fs = speeds.movers.foot;
const footSpeeds = { ground: fs.ground, road: fs.road.track, toblerA: fs.slope.a[0], toblerB: fs.slope.b };
const classLabel = (c) => ({ 20: 'Canal', 34: 'Metalled Rd' })[c] ?? `Class ${c}`;
const terr = N.nightMarchChart({ path: route, objective: obj, echelon: 'company', gmaDeg: 3, hHourMin: 180, terrainKind: 'plains', probe, patrolRules: PR, foot, speeds: footSpeeds, classLabel }, R);
check('terrain read', terr.terrain === true && terr.timing.flatKmh === null);
check('turn 1 ends on the mosque', terr.legs[0].landmark?.kind === 'mosque', terr.legs[0].landmark?.label);
check('turn 2 has no landmark: warn', !terr.legs[1].landmark && terr.legs[1].tone === 'warn' && terr.checks.some((c) => /Leg 2 ends on no feature/.test(c.text)));
check('canal crossed on leg 2', terr.obstacles.length >= 1 && /Canal/.test(terr.obstacles[0].label) && terr.obstacles[0].chainM > 1500 && terr.obstacles[0].chainM < 1500 + 800, String(terr.obstacles[0]?.chainM));
check('crossing slows leg 2 vs flat', terr.legs[1].minNight > flat.legs[1].minNight, `${terr.legs[1].minNight} vs ${flat.legs[1].minNight}`);
check('skyline on the crest of leg 1', terr.skyline.length >= 1 && terr.checks.some((c) => /skyline/.test(c.text)));
check('SL on the road', /Road Test Rd|Road/.test(terr.fup.slFeature ?? ''), terr.fup.slFeature ?? 'none');
check('no obstacle beyond the SL', terr.fup.obstacleAhead === null);
// The canal just beyond a FUP's SL.
const canalFup = N.nightMarchChart({ path: [at(-800, -3000), at(-800, -1400)], objective: at(-800, 600), echelon: 'company', gmaDeg: 3, hHourMin: null, terrainKind: 'plains', probe, patrolRules: PR, foot, speeds: footSpeeds, classLabel }, R);
check('canal beyond the SL: bad', canalFup.fup.obstacleAhead?.label === 'Canal' && canalFup.checks[0].tone === 'bad', JSON.stringify(canalFup.fup.obstacleAhead));

// ── 4. the cursor ───────────────────────────────────────────────────────────────────────────────────────────────────
const live = N.liveLeg({ laid: route.slice(0, 2), cursor: at(0, -1000), objective: obj, gmaDeg: 3, terrainKind: 'plains', probe, patrolRules: PR, foot, speeds: footSpeeds, classLabel }, R);
check('live leg no 2, bearing ~072', live.legNo === 2 && near(live.bearingDeg, 71.6, 1), live.bearingDeg.toFixed(1));
check('live leg crosses the canal: bad', live.crossing === 'Canal' && live.tone === 'bad');
check('live leg running paces', near(live.cumPaces, N.pacesFor(1500 + P.plDist(route[1], route[2]), R), 2));
check('live leg prev bearings', live.prevBearings.length === 1);
const liveFlat = N.liveLeg({ laid: [at(0, -3000)], cursor: at(0, 900), objective: obj, gmaDeg: null, terrainKind: 'plains' }, R);
check('live leg inside night sights: bad', liveFlat.sight === 'night' && liveFlat.tone === 'bad' && liveFlat.long);
const on = N.legAt(flat, at(-1500, -2400), 30, R);
check('pointer on leg 1 at 600 m = 720 paces in', on && on.leg.i === 1 && near(on.pacesIn, 720, 3) && near(on.pacesToGo, 1080, 3), on ? `${on.pacesIn}/${on.pacesToGo}` : 'none');
check('pointer off the route: none', N.legAt(flat, at(800, -2400), 30, R) === null);

console.log(`\n${n - fails} of ${n} checks passed`);
process.exit(fails ? 1 : 0);
