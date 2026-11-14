// air.mjs -- checks for the IPB air avenues, LZ / DZ and AD sites (GroundGuideIpbAir.ts).
//   node tools/ipb-test/air.mjs
// Synthetic ground with a known answer: a flat plain flown north, a ridge that hides the flight from an observer, a mast,
// a canal to follow, slopes, a clearing in a wood, mountains, an existing helipad, an OP hill. Exit code 1 when a check fails.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
register('../movement-test/hooks.mjs', import.meta.url);
const { airIpb, airRulesFrom } = await import('../../MS/Engines/GroundGuide/GroundGuideIpbAir.ts');

const here = dirname(fileURLToPath(import.meta.url));
const doctrine = JSON.parse(readFileSync(resolve(here, '../../MS/Data/IpbDoctrine.json'), 'utf8'));
const rules = airRulesFrom(doctrine);
let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
}
// 300 x 300 cells of 30 m (9 km square), flat at 200 m, open land (class 0). Flown north from the bottom edge.
const N = 300, RES = 30;
function grid(paint, n = N) {
  const elev = new Float32Array(n * n).fill(200), cls = new Uint8Array(n * n);
  if (paint) paint({ elev, cls, n });
  return { z: 12, ts: 256, tx0: 0, ty0: 0, nx: 1, ny: 1, w: n, h: n, px0: 0, py0: 0, res: RES, elev, cls, bld: null, pending: false };
}
const frame = { sx: 150, sy: 297, axisDeg: 0, lengthM: 8700, widthM: 8400 };
function run(g, o = {}) {
  return airIpb({
    grid: g, rules, frame, band: 'contour', lzClass: 4, lzPoints: 4,
    observers: [], obstructions: [], lines: [], existing: [],
    lzZone: { fromM: 6000, toM: 8600 }, objective: { x: 150, y: 20 }, tables: null, enemyLz: false,
    ...o,
  });
}
// Mean x of a line between two rows, sampled every pixel along it.
const meanX = (pts, y0, y1) => {
  let sx = 0, n = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const L = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    for (let t = 0; t < L; t++) { const x = ax + ((bx - ax) * t) / L, y = ay + ((by - ay) * t) / L; if (y >= y0 && y <= y1) { sx += x; n++; } }
  }
  return n ? sx / n : NaN;
};

{
  const r = run(grid());
  const z = r.lzs[0];
  check('flat plain: an LZ in the zone, near the Obj, slope 0, all 8 approaches clear', !!z && z.alongM >= 6000 && z.slopeDeg < 1 && z.approaches.length === 8 && z.distObjM < 1500, z ? `${z.id} ${z.why}` : 'none');
  check('LZ size: 4 landing points of size 4 (80 m) laid 2 x 2 = 160 m', r.lzSideM === 160);
  const a = r.routes[0];
  check('flat plain: Air Apch 1 runs from the start edge to LZ 1, about the straight length', !!a && a.to === 'LZ 1' && a.lengthM > 6000 && a.lengthM < 9500, a ? a.why : 'none');
  check('no observers: a note says concealment is not judged', r.notes.some((n) => /not judged/.test(n)) && r.observers === 0);
  check('a DZ of 550 m is found on open ground', r.dzs.length >= 1 && r.dzs[0].sideM === 550, r.dzs[0]?.why ?? 'none');
}
{
  // An observer east of the axis; a ridge 60 m high runs north-south 1.2 km west of the axis: behind it the flight is hidden.
  const g = grid(({ elev }) => { for (let y = 0; y < N; y++) for (let x = 108; x < 114; x++) elev[y * N + x] = 260; });
  const eyes = [{ x: 200, y: 150, eyeM: 2, reachM: 6000, label: 'En OP' }];
  const open = run(grid(), { observers: eyes, objective: { x: 60, y: 20 } });
  const hid = run(g, { observers: eyes, objective: { x: 60, y: 20 } });
  const a = hid.routes[0];
  check('a ridge between the observer and the west: the air avenue keeps behind it (west of the ridge)', !!a && meanX(a.pts, 60, 240) < 108, a ? `mean x ${meanX(a.pts, 60, 240).toFixed(0)} · ${a.why}` : 'none');
  check('behind the ridge it is far less in view than over the open plain', !!a && a.seenPct + 30 < (open.routes[0]?.seenPct ?? 0), `${a?.seenPct.toFixed(0)} % vs ${open.routes[0]?.seenPct.toFixed(0)} %`);
}
{
  // A mast on the straight line: the way passes more than 300 m from it (a short detour is cheap).
  const r = run(grid(), { obstructions: [{ x: 150, y: 150, kind: 'mast', label: 'Mast', heightM: null }] });
  const a = r.routes[0];
  const d = Math.min(...a.pts.map(([x, y]) => Math.hypot(x - 150, y - 150) * RES));
  check('a mast on the line: the air avenue keeps 300 m clear of it', a.obstructionsNear.length === 0 && d >= 280, `${d.toFixed(0)} m`);
}
{
  // A canal running north 900 m east of the axis: followed (parallel feature, navigation).
  const r = run(grid(), { lines: [{ kind: 'canal', name: 'Test Canal', pts: [[180, 299], [180, 0]] }] });
  const a = r.routes[0];
  check('a canal parallel to the flight is followed for most of the way', a.parallelPct > 50 && a.follows.some((f) => f.name === 'Test Canal'), `${a.parallelPct.toFixed(0)} % · ${a.why}`);
}
{
  // A power line across the area: crossed once, counted.
  const r = run(grid(), { lines: [{ kind: 'power_line', name: null, pts: [[0, 150], [299, 150]] }] });
  check('a power line across the area is counted as crossed once', r.routes[0].wires === 1, r.routes[0].why);
}
{
  // The zone slopes at 10 degrees except a flat terrace in the east: the LZ is on the terrace.
  const g = grid(({ elev }) => {
    const rise = Math.tan(10 * Math.PI / 180) * RES;
    for (let y = 0; y < 110; y++) for (let x = 0; x < N; x++) elev[y * N + x] = 200 + (110 - y) * rise;
    for (let y = 20; y < 60; y++) for (let x = 220; x < 260; x++) elev[y * N + x] = 200 + 70 * rise;
  });
  const r = run(g);
  const z = r.lzs[0];
  check('slope 10 degrees over the zone: LZ 1 is on the flat terrace', !!z && z.x > 215 && z.x < 265 && z.y > 15 && z.y < 65 && z.slopeDeg <= 7, z ? `${z.x.toFixed(0)},${z.y.toFixed(0)} ${z.why}` : 'none');
  check('a 10 degree LZ, if listed, carries a slope caution', r.lzs.filter((q) => q.slopeDeg > 7).every((q) => q.caution.some((c) => /slope/.test(c))));
  check('LZs within the slope limit rank above any over it', r.lzs.every((q, i) => q.slopeDeg <= 7 || r.lzs.slice(i + 1).every((x) => x.slopeDeg > 7)), r.lzs.map((q) => `${q.id} ${q.slopeDeg.toFixed(0)}°`).join(', '));
}
{
  // A wood fills the zone (12 m trees); a clearing 300 m across fails 10 : 1, one 500 m across passes.
  const wood = (clearM) => grid(({ cls }) => {
    for (let y = 0; y < 100; y++) for (let x = 0; x < N; x++) cls[y * N + x] = 1;
    const r = Math.round(clearM / RES / 2);
    for (let y = 50 - r; y < 50 + r; y++) for (let x = 150 - r; x < 150 + r; x++) cls[y * N + x] = 0;
  });
  const small = run(wood(240)), big = run(wood(500));
  check('a clearing 240 m across in a 12 m wood: no LZ for 4 points (no approach 120 m clear: 10 : 1)', small.lzs.every((z) => z.points === 1) && small.lzPoints === 1, small.lzs.map((z) => z.why).join('; '));
  check('... but a single landing point fits it, and a note says so', small.lzs.length >= 1 && small.notes.some((n) => /single landing points/.test(n)), small.notes.find((n) => /single/.test(n)) ?? 'none');
  const tiny = run(wood(150));
  check('a clearing 150 m across: no LZ at all, a note says why', tiny.lzs.length === 0 && tiny.notes.some((n) => /No LZ for 4 landing points or one/.test(n)), tiny.notes.find((n) => /No LZ/.test(n)) ?? tiny.lzs.map((z) => z.why).join('; '));
  check('a clearing 500 m across: an LZ in it with a clear approach', big.lzs.length >= 1 && Math.abs(big.lzs[0].x - 150) < 8 && Math.abs(big.lzs[0].y - 50) < 8 && big.lzs[0].approaches.length >= 1, big.lzs[0]?.why ?? 'none');
}
{
  // Mountains: a 300 m hill beside a 5 degree slope. In mountains 5 degrees is over the 4 degree limit (MW p 256).
  const rise = Math.tan(5 * Math.PI / 180) * RES;
  const g = grid(({ elev }) => {
    for (let y = 0; y < 110; y++) for (let x = 0; x < N; x++) elev[y * N + x] = 200 + (110 - y) * rise;
    for (let y = 0; y < 110; y++) for (let x = 0; x < 40; x++) elev[y * N + x] += 300;
  });
  const flat = grid(({ elev }) => { for (let y = 0; y < 110; y++) for (let x = 0; x < N; x++) elev[y * N + x] = 200 + (110 - y) * rise; });
  const m = run(g, { objective: { x: 70, y: 40 }, maxLz: 40 }), p = run(flat, { objective: { x: 70, y: 40 } });
  const zm = m.lzs.find((z) => z.mountain);
  check('in mountains a 5 degree LZ is cautioned (MW p 256, 4 degrees)', !!zm && zm.caution.some((c) => /MW p 256/.test(c)), zm ? zm.why + ' · ' + zm.caution.join('; ') : 'none');
  check('on a plain the same 5 degree slope needs no caution', p.lzs.length > 0 && !p.lzs[0].mountain && !p.lzs[0].caution.length, p.lzs[0]?.why ?? 'none');
}
{
  // An existing helipad 2 km from the Obj ranks first.
  const r = run(grid(), { existing: [{ x: 230, y: 60, kind: 'helipad', label: 'Helipad', name: 'Test' }] });
  check('an existing helipad in the zone ranks first', r.lzs[0]?.existing?.includes('Helipad') && Math.hypot(r.lzs[0].x - 230, r.lzs[0].y - 60) < 6, r.lzs[0]?.why ?? 'none');
}
{
  // Enemy LZs: an OP over each from the highest ground near it that sees it.
  const g = grid(({ elev }) => { for (let y = 70; y < 80; y++) for (let x = 200; x < 210; x++) elev[y * N + x] = 240; });
  const r = run(g, { enemyLz: true, objective: { x: 150, y: 40 } });
  const z = r.lzs[0];
  check("the enemy's LZ gets an OP on the hill that sees it", !!z?.op && z.op.riseM >= 30 && z.op.x >= 199 && z.op.x <= 211, z?.op ? `${z.op.x},${z.op.y} +${z.op.riseM} m at ${z.op.distM} m` : 'none');
}
{
  // AD sites: on a flat plain they see the avenue; long-range or flank shots named.
  const r = run(grid());
  const s = r.ad[0];
  check('AD site 1 sees 3 km or more of the air avenue', !!s && s.seenM >= 3000, s ? s.why : 'none');
  check('AD sites name long-range or flank shots', r.ad.some((q) => q.kinds.includes('long') || q.kinds.includes('flank')), r.ad.map((q) => q.kinds.join('+')).join(' | '));
  // AD only on the defender's side: the far 3.7 km of the area (rows above y = 130).
  const rz = run(grid(), { adZone: { fromM: 5000, toM: 8700 } });
  check("AD sites stay in the defender's zone", rz.ad.length > 0 && rz.ad.every((q) => q.y <= 131), rz.ad.map((q) => `${q.id} y ${q.y.toFixed(0)}`).join(', '));
  // An east-west ridge 50 m high across the middle: the avenue crosses its crest; a site in the low ground north of it gets a bottom shot.
  const g = grid(({ elev }) => { for (let y = 140; y < 160; y++) for (let x = 0; x < N; x++) elev[y * N + x] = 200 + 50 * (1 - Math.abs(y - 150) / 10); });
  const r2 = run(g);
  check('an avenue crossing a ridge: an AD site below it gets a bottom shot', r2.ad.some((q) => q.kinds.includes('bottom')), r2.ad.map((q) => `${q.id} ${q.why}`).join(' | '));
}
{
  // An observer at the far end with nothing to hide behind: the avenue is in view, the LZ seen.
  const r = run(grid(), { observers: [{ x: 150, y: 10, eyeM: 2, reachM: 6000, label: 'En' }] });
  check('in the open near an observer the LZ is "in view"', r.lzs[0]?.seenP >= 0.5, r.lzs[0]?.why ?? 'none');
  // Behind a 40 m hill the same LZ zone is hidden from him: LZ 1 is chosen in the hill's shadow.
  const hill = grid(({ elev }) => { for (let y = 25; y < 35; y++) for (let x = 0; x < N; x++) elev[y * N + x] = 240; });
  const rh = run(hill, { observers: [{ x: 150, y: 5, eyeM: 2, reachM: 6000, label: 'En' }] });
  check('a hill between the observer and the zone: LZ 1 is hidden behind it', rh.lzs[0]?.seenP !== null && rh.lzs[0]?.seenP < 0.2 && rh.lzs[0].y > 35, rh.lzs[0] ? `${rh.lzs[0].why} · y ${rh.lzs[0].y.toFixed(0)}` : 'none');
}
{
  // Bigger area (600 x 900 cells, about 18 x 27 km) with 6 observers: in time.
  const n = 900;
  const g = grid(({ elev, n: nn }) => { for (let y = 0; y < nn; y++) for (let x = 0; x < nn; x++) elev[y * nn + x] = 200 + 30 * Math.sin(x / 40) * Math.cos(y / 55); }, n);
  const t = performance.now();
  const r = airIpb({
    grid: g, rules, frame: { sx: 450, sy: 897, axisDeg: 0, lengthM: 26500, widthM: 14000 }, band: 'contour', lzClass: 4, lzPoints: 4,
    observers: Array.from({ length: 6 }, (_, k) => ({ x: 300 + k * 60, y: 200 + (k % 2) * 200, eyeM: 2, reachM: 6000, label: 'En' })),
    obstructions: [], lines: [], existing: [], lzZone: { fromM: 19000, toM: 26000 }, objective: { x: 450, y: 60 }, tables: null, enemyLz: false,
  });
  const ms = performance.now() - t;
  check('a Bde-size area with 6 observers in under 2.5 s', ms < 2500 && r.routes.length >= 1, `${ms.toFixed(0)} ms · ${r.routes.length} avenues · ${r.lzs.length} LZ · ${r.ad.length} AD · engine ${r.ms} ms`);
  check('two or three air avenues that do not share most of their way', r.routes.length >= 2, r.routes.map((q) => `${q.id}: ${q.why}`).join(' | '));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
