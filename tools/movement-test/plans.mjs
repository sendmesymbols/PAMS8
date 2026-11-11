// plans.mjs -- checks for the Movement Guide cards' plans (MS/Engines/MovementGuide/MovementGuidePlans.ts) on the
// synthetic ground of world.mjs.   node tools/movement-test/plans.mjs     Exit code 1 when a check fails.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('./hooks.mjs', import.meta.url);
const M = await import('../../MS/Engines/MovementGuide/MovementGuideScan.ts');
const P = await import('../../MS/Engines/MovementGuide/MovementGuidePlans.ts');
const W = await import('./world.mjs');

const here = dirname(fileURLToPath(import.meta.url));
const R = M.rulesFrom(JSON.parse(readFileSync(resolve(here, '../../MS/Data/MovementDoctrine.json'), 'utf8')));
let n = 0, fails = 0;
const check = (name, ok, info = '') => {
  n++;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
};
const t = (f) => {
  const t0 = performance.now();
  const v = f();
  return [v, (performance.now() - t0).toFixed(1)];
};

const scanner = new M.RouteScanner(R);
const route = scanner.scan(W.path, W.probe, { going: W.wheeled, sight: true }, 1);

// Cordon sectors.
const ring = M.buaRingAround(W.townC, W.probe, R).ring;
const c = M.cordonPlan(ring, 'bua', W.probe, R);
const lay = P.cordonSectors(c, R, 30);
console.log(`cordon ${Math.round(c.perimeterM)} m: ${lay.sectors.length} Pl sectors of ${Math.round(lay.sectorM)} m, ${lay.companies} Coy, posts ${lay.posts.map((p) => p.kind).join(',')}`);
check('Cordon: a platoon holds 200 m at 15 per 100 m', Math.round(lay.sectorM) === 200);
check('Cordon: sectors cover the whole line', Math.abs(lay.sectors[lay.sectors.length - 1].toM - c.perimeterM) < 1 && lay.sectors[0].fromM === 0);
check('Cordon: three platoons a company', lay.companies === Math.ceil(lay.sectors.length / 3) && lay.sectors[3]?.label === '1 Pl B Coy');
check('Cordon: posts face inward', lay.sectors.every((s) => {
  const ctr = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
  const d = Math.abs(((M.bearingOf([s.x, s.y], ctr) - s.facingDeg + 540) % 360) - 180);
  return d < 2;
}));
check('Cordon: a road block on every exit, a post on every side road', lay.posts.filter((p) => p.kind === 'roadBlock').length === c.exits.length && lay.posts.filter((p) => p.kind === 'sideRoad').length === c.sideRoads.length);
const rural = M.cordonPlan(M.circleRing(W.at(1300, -100), 300), 'circle', W.probe, R);
const rl = P.cordonSectors(rural, R);
check('Rural cordon: sections on escape routes, no sectors', rl.sectors.length === 0 && rl.posts.filter((p) => p.kind === 'escape').length === rural.escapes.length);

// Picket timings.
const pk = M.planPickets(route, W.probe, R, 'bothSides', W.foot);
const tm = P.picketTimings(pk.pickets, { roadKmh: 3, footKmh: 3 });
check('Picket timings rise along the road', tm.every((x, i) => !i || x.roadMin >= tm[i - 1].roadMin));
check('Climbing to the hill picket takes longer than walking flat', (() => {
  const hi = pk.pickets.findIndex((p) => p.riseM > 20);
  if (hi < 0) return false;
  const flat = (pk.pickets[hi].offsetM / 1000 / 3) * 60;
  return tm[hi].climbMin > flat;
})());
check('Tobler: uphill slower, flat as given', P.toblerKmh(3, 0) === 3 && P.toblerKmh(3, 0.3) < 2);

// Convoy.
const cv = P.convoyPlan(route, { vehicles: 30, packetSize: 8, gapMin: 5, vehGapM: 100, speedKmh: 40, boundKm: 2, startMin: 6 * 60, haltEveryMin: 120, haltMin: 15 });
console.log(`convoy: ${cv.packets.length} packets, ${cv.bounds.length} bounds, run ${cv.runMin} min, total ${cv.totalMin} min`);
check('Convoy: 30 vehicles in packets of 8 = 4 packets (8,8,8,6)', cv.packets.length === 4 && cv.packets[3].vehicles === 6);
check('Convoy: packets leave 5 min apart or more', cv.packets.every((p, i) => !i || p.spMin - cv.packets[i - 1].spMin >= 5));
check('Convoy: bounds run start to end without gaps', cv.bounds[0].fromM === 0 && Math.abs(cv.bounds[cv.bounds.length - 1].toM - route.lengthM) < 1 && cv.bounds.every((b, i) => !i || b.fromM === cv.bounds[i - 1].toM));
check('Convoy: a bound never ends in the town', cv.bounds.slice(0, -1).every((b) => M.groundDist([b.x, b.y], W.townC) > 300));
check('Convoy: the ambush stretch is cleared in its bound', cv.bounds.some((b) => b.clear.some((s) => s.kind === 'ambush')));

// Likely mines.
const mines = P.likelyMineSites(route, 40);
check('Mines: the culvert and the junction are listed, worst first', mines.some((m) => m.kind === 'culvert') && mines.some((m) => /junction/.test(m.why)) && mines.every((m, i) => !i || mines[i - 1].score >= m.score), mines.map((m) => `${m.kind}:${m.score}`).join(' '));

// Patrol.
const start = W.at(200, -600);
const obj = M.offsetPt(W.bendPt[0], W.bendPt[1], 45, 2600);
const [pr, ms] = t(() => P.planPatrol(W.probe, R, start, obj, { foot: W.foot, avoidRoads: true, avoidVillages: true, avoidWoodEdges: true, avoidSkylines: true, threat: null, separateM: 150 }));
const len = (p) => p.reduce((a, q, i) => (i ? a + M.groundDist(p[i - 1], q) : 0), 0);
console.log(`patrol: out ${pr.out ? Math.round(len(pr.out)) : '-'} m (${pr.out?.length} pts), back ${pr.back ? Math.round(len(pr.back)) : '-'} m, cell ${pr.cellM} m, ${ms} ms, met ${JSON.stringify(pr.met)}`);
check('Patrol: a route out and a route back found', !!pr.out && !!pr.back);
check('Patrol: ends at the start and the objective', pr.out && M.groundDist(pr.out[0], start) < 1 && M.groundDist(pr.out[pr.out.length - 1], obj) < 1);
check('Patrol: never crosses the canal on foot', pr.out && M.densify(pr.out, 10).every((p) => W.cls(p.x, p.y) !== 20));
check('Patrol: keeps out of the town', pr.out && M.densify(pr.out, 20).every((p) => M.groundDist([p.x, p.y], W.townC) > 250));
const mids = (p) => M.densify(p, 50).slice(4, -4);
const apart = pr.out && pr.back ? mids(pr.back).filter((q) => M.distToLine([q.x, q.y], pr.out.flat()) > 100).length / Math.max(1, mids(pr.back).length) : 0;
check('Patrol: the route back is a different way', apart >= 0.5, `${Math.round(apart * 100)} % of it 100 m or more from the route out`);

// Ambush.
const amb = P.ambushSites(route, W.probe, R, W.foot);
console.log(`ambush: ${amb.map((a) => `#${a.rank} ${(a.chainM / 1000).toFixed(2)} km ${a.score} ${a.layout.shape}`).join('; ')}`);
check('Ambush: the defile at 1.2-1.4 km is a site', amb.some((a) => a.chainM >= 1000 && a.chainM <= 1500));
const a1 = amb.find((a) => a.chainM >= 1000 && a.chainM <= 1500);
check('Ambush: killing zone 150 m along the road', a1 && Math.abs(M.groundDist(a1.layout.kz[0], a1.layout.kz[1]) - 150) < 60);
check('Ambush: meeting point 750-900 m back', a1 && a1.layout.meetingM >= 750 && a1.layout.meetingM <= 900);
check('Ambush: fire group on the side with cover (south: trees)', a1 && a1.layout.side === 'R');
check('Ambush: stop groups beyond both ends', a1 && a1.layout.stops.length === 2);

// Road block.
const rb = P.roadBlockSites(route, W.probe, R, W.foot);
console.log(`road block: ${rb.map((b) => `#${b.rank} ${(b.chainM / 1000).toFixed(2)} km ${b.score} pos ${b.positions.length}`).join('; ')}`);
check('Road block: every site has NO-GO both sides', rb.every((b) => { const st = route.stations.reduce((m, q) => (Math.abs(q.chainM - b.chainM) < Math.abs(m.chainM - b.chainM) ? q : m)); return st.left === 'nogo' && st.right === 'nogo'; }));
check('Road block: scored parts add up', rb.every((b) => b.score === Math.min(100, b.parts.reduce((a, p) => a + p.pts, 0))));

// Infiltration: a 4 km line north-south 1 km west of the start; enemy to the west.
const lineA = W.at(-1500, -2000), lineB = W.at(-1500, 2000);
// The line runs south to north, so the enemy (west) is on its left: -1.
const [inf, ims] = t(() => P.infiltrationLanes(W.probe, R, [lineA, lineB], -1, W.foot));
console.log(`infil: ${inf.lanes.length} lanes (${inf.lanes.map((l) => `${Math.round(l.lengthM)} m seen ${l.seenPct} %`).join(', ')}), ${inf.posts.length} posts, after ${inf.afterPct} %, ${ims} ms`);
check('Infil: lanes found across the band', inf.lanes.length >= 2 && inf.lanes.every((l) => l.lengthM >= 2 * R.infil.bandM * 0.8));
check('Infil: lanes are apart', inf.lanes.length < 2 || M.densify(inf.lanes[1].path, 100).some((p) => M.distToLine([p.x, p.y], inf.lanes[0].path.flat()) > 300));
check('Infil: new posts see most of the lanes', inf.posts.length > 0 && inf.afterPct >= 60, `${inf.afterPct} %`);
check('Infil: new posts on the own side (east)', inf.posts.filter((p) => p.source === 'new').every((p) => p.x > lineA[0]));

console.log(`\n${n - fails} / ${n} checks pass`);
process.exit(fails ? 1 : 0);
