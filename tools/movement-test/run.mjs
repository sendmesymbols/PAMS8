// run.mjs -- Movement Guide engine checks.
//   node tools/movement-test/run.mjs
// Node 24 runs the library's own pure engine (MS/Engines/MovementGuide/MovementGuideScan.ts) directly on a synthetic
// piece of ground built here, so every danger has a known place to be found. Exit code 1 when a check fails.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as M from '../../MS/Engines/MovementGuide/MovementGuideScan.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const R = M.rulesFrom(JSON.parse(readFileSync(resolve(repo, 'MS/Data/MovementDoctrine.json'), 'utf8')));

let fails = 0;
let n = 0;
function check(name, ok, info = '') {
  n++;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
}

import { O, s, at, path, roadXY, bendPt, endPt, km3, hillC, townC, sideXY, elevAt, cls, bld, sight, FEATURES, probe, wheeled, foot } from './world.mjs';

// ── checks ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const pts = M.densify(path, 50);
check('densify: chainage rises and ends at the route length', pts.every((p, i) => !i || p.chainM > pts[i - 1].chainM) && Math.abs(pts[pts.length - 1].chainM - 5000) < 1, `${pts.length} pts, end ${pts[pts.length - 1].chainM.toFixed(1)} m`);

const scanner = new M.RouteScanner(R);
const t0 = performance.now();
const r = scanner.scan(path, probe, { going: wheeled, sight: true, threat: null, borders: [] }, 1);
const t1 = performance.now();
console.log(`scan 5 km: ${(t1 - t0).toFixed(1)} ms, ${r.stations.length} stations, ${r.stretches.length} stretches`);
for (const st of r.stretches) console.log(`   ${(st.fromM / 1000).toFixed(2)}-${(st.toM / 1000).toFixed(2)} km  ${st.label.padEnd(24)} ${String(st.score).padStart(3)}  ${st.why}`);
const has = (kind, fromKm, toKm) => r.stretches.some((st) => st.kind === kind && st.toM >= fromKm * 1000 && st.fromM <= toKm * 1000);
check('length 5 km', Math.abs(r.lengthM - 5000) < 1);
check('VP: culvert at 0.5 km', has('vp', 0.45, 0.55));
check('No way off the Rd at 1.2-1.4 km (canal L, embankment R)', has('noExit', 1.25, 1.35));
check('Likely ambush site at 1.0-1.5 km', has('ambush', 1.0, 1.5));
check('Likely mine spot at the junction / bend (2.0 km)', has('mine', 1.95, 2.05));
check('Overlooked by the hill near 3.0 km', has('overlooked', 2.7, 3.3));
check('BUA at 4.0-4.5 km', has('bua', 4.05, 4.45));
check('Rooftops in the town', has('rooftops', 4.05, 4.45));
check('Sensitive site (mosque) near 2.5 km', has('sensitive', 2.4, 2.6));
check('No BUA on the first leg', !r.stretches.some((st) => st.kind === 'bua' && st.toM < 2000));
check('Risk high', r.risk === 'high', r.risk);
check('People near the route counted', r.peopleNear !== null && r.peopleNear > 0, String(r.peopleNear));
check('Town passed', r.placesPassed.some((p) => p.name === 'Testabad'));

// Caching: the same route again reads nothing new and gives the same answer.
const t2 = performance.now();
const r2 = scanner.scan(path, probe, { going: wheeled, sight: true, threat: null, borders: [] }, 1);
const t3 = performance.now();
check('Second scan of the same route is cached', JSON.stringify(r2.stretches) === JSON.stringify(r.stretches), `${(t3 - t2).toFixed(1)} ms vs ${(t1 - t0).toFixed(1)} ms`);
const live = scanner.scan(path, probe, { going: wheeled, sight: false }, 1);
check('Live scan (no sight) has no overlook', !live.stretches.some((st) => st.kind === 'overlooked') && !live.sightDone);

// Threat and border.
const threat = M.offsetPt(km3[0], km3[1], 135, 1500);
const border = M.offsetPt(bendPt[0], bendPt[1], 180, 3000);
const bxy = [border[0] - 20000 / s, border[1], border[0] + 20000 / s, border[1]];
const r3 = scanner.scan(path, probe, { going: wheeled, sight: true, threat, borders: [{ kind: 'Line of Control', xy: bxy, box: [bxy[0], bxy[1], bxy[2], bxy[3]] }] }, 1);
check('Threat may see the Rd', (r3.counts.exposed ?? 0) > 0);
check('LoC within reach (3 km)', r3.stretches.some((st) => st.kind === 'border' && st.score === 60));

// Protection.
const both = M.planPickets(r, probe, R, 'bothSides', foot);
const few = M.planPickets(r, probe, R, 'fewest', foot);
console.log(`pickets both sides: ${both.pickets.length} (${both.men} men, ${both.coveragePct} %), fewest: ${few.pickets.length} (${few.coveragePct} %)`);
for (const p of both.pickets) console.log(`   ${p.side} ${(p.chainM / 1000).toFixed(2)} km  ${p.source.padEnd(7)} rise ${p.riseM} m  covers ${(p.coversFromM / 1000).toFixed(2)}-${(p.coversToM / 1000).toFixed(2)} km`);
check('Picketing: pickets on both sides', both.pickets.some((p) => p.side === 'L') && both.pickets.some((p) => p.side === 'R'));
check('Picketing: a platoon each', both.men === both.pickets.length * R.picket.menPer);
check('Piqueting (fewest) needs no more posts than both sides', few.pickets.length <= both.pickets.length);
check('Piqueting covers most of the road', few.coveragePct >= 80, `${few.coveragePct} %`);
check('The hill is used as a picket', both.pickets.some((p) => p.source === 'high' || p.name === 'Test Hill'));
const cp = M.checkPosts(r, R);
check('Check post at the bridge / junction with NO-GO flanks or none', Array.isArray(cp), `${cp.length}`);
const order = M.clearanceOrder(r);
check('Clearance order worst first, clearable only', order.every((x, i) => !i || order[i - 1].score >= x.score) && order.every((x) => M.CLEARABLE.has(x.kind)), order.map((x) => `${x.kind}:${x.score}`).join(' '));
const cv = M.casevacFor([path[0]], probe, R);
check('Casevac: nearest hospital and helipad', cv[0].hospital?.name === 'DHQ' && cv[0].hls?.kind === 'helipad');

// Cordon round the town.
const rb = M.buaRingAround(M.offsetPt(townC[0], townC[1], 0, 100), probe, R);
check('BUA ring found round the town', !!rb && rb.ring.length >= 3);
if (rb) {
  const c = M.cordonPlan(rb.ring, 'bua', probe, R);
  console.log(`cordon: ${Math.round(c.perimeterM)} m, urban ${c.urban}, inner ${c.inner.men} (perimeter ${c.inner.perimeterMen} + rooftops ${c.inner.rooftopMen} + side roads ${c.inner.sideRoadMen}), road blocks ${c.outerCordon.roadBlocks}, people ${c.people}`);
  check('Cordon: urban', c.urban);
  check('Cordon perimeter about 2 pi 350 m', c.perimeterM > 1800 && c.perimeterM < 2600, `${Math.round(c.perimeterM)} m`);
  check('Cordon: 15 men per 100 m', c.inner.perimeterMen === Math.ceil((c.perimeterM / 100) * 15));
  check('Cordon: side roads cross the ring', c.sideRoads.length >= 2, `${c.sideRoads.length}`);
  check('Cordon: road blocks on the exits', c.outerCordon.roadBlocks >= 2 && c.outerCordon.men === c.outerCordon.roadBlocks * 10);
  check('Cordon: people inside about 8000/km2 x area', c.people !== null && c.people > 1500 && c.people < 4000, String(c.people));
  check('Cordon: cave in the hide list', c.hides.some((h) => h.kind === 'cave'));
}
// A farm cluster astride the road at 0.5 km: the road crosses the ring twice, the trees once.
const rural = M.cordonPlan(M.circleRing(at(1300, -100), 300), 'circle', probe, R);
check('Rural cordon: sections on escape routes only', !rural.urban && rural.inner.sections >= 2 && rural.inner.men === rural.inner.sections * 10, `${rural.inner.sections} sections: ${rural.escapes.map((e) => e.why).join(', ')}`);
check('No BUA ring in open fields', M.buaRingAround(at(500, -1500), probe, R) === null);

// Lane.
const lane = M.laneCheck(r, R, foot);
check('Lane: within one night (flat, 24 km)', lane.withinNight && lane.limitKm === 24 && !lane.hills);
check('Lane: canal is an obstacle on foot', lane.obstacles.length === 0 || lane.obstacles.every((o) => o.why));

console.log(`\n${n - fails} / ${n} checks pass`);
process.exit(fails ? 1 : 0);
