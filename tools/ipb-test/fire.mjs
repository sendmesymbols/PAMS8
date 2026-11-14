// fire.mjs -- checks for the IPB fire corridors (GroundGuideIpbFire.ts) and the proforma (GroundGuideIpbProforma.ts).
//   node tools/ipb-test/fire.mjs
// Synthetic ground with a known answer: a flat plain, a ridge that makes dead ground, a wood that screens. Exit code 1
// when a check fails.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
register('../movement-test/hooks.mjs', import.meta.url);
const { fireCoverage } = await import('../../MS/Engines/GroundGuide/GroundGuideIpbFire.ts');
const { proforma, pfKey, PF_ROWS } = await import('../../MS/Engines/GroundGuide/GroundGuideIpbProforma.ts');
const { sightTables } = await import('../../MS/Engines/GroundGuide/GroundGuideOcoka.ts');

const here = dirname(fileURLToPath(import.meta.url));
const doctrine = JSON.parse(readFileSync(resolve(here, '../../MS/Data/OcokaDoctrine.json'), 'utf8'));
let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
}
// 300 x 300 cells of 30 m (9 km square), flat at 200 m, all open ground (class 0).
const N = 300, RES = 30;
function grid(paint) {
  const elev = new Float32Array(N * N).fill(200), cls = new Uint8Array(N * N);
  if (paint) paint({ elev, cls });
  return { z: 12, ts: 256, tx0: 0, ty0: 0, nx: 1, ny: 1, w: N, h: N, px0: 0, py0: 0, res: RES, elev, cls, bld: null, pending: false };
}
// A line running north to south at x = 150 + dx, along 0..9 km.
const line = (id, x, narrows) => ({ id, pts: [[x, 5], [x, 295]], alongM: [0, 290 * RES], narrows });
const posn = (x, y, effM, obsM = effM) => ({ x, y, eyeM: 2.4, effM, obsM, label: 'Posn' });
const run = (g, posns, lines, tables = null) => fireCoverage({ grid: g, posns, lines, tables, targetM: 2.4 });
const stateAt = (cov, alongM) => cov.samples.reduce((b, s) => (Math.abs(s.alongM - alongM) < Math.abs(b.alongM - alongM) ? s : b)).state;

{
  // Posn 600 m east of the line's middle, range 2 km: covered about the middle 3.7 km, out of range at the ends.
  const r = run(grid(), [posn(170, 150, 2000)], [line('A', 150)]);
  const c = r.lines[0];
  check('open plain: the middle of the Apch is under fire, the ends out of range', stateAt(c, 4350) === 'c' && stateAt(c, 200) === 'o' && stateAt(c, 8500) === 'o', `${c.coveredPct.toFixed(0)}% covered · ${c.outPct.toFixed(0)}% out`);
  check('open plain: the covered share matches the range (about 2 x 1.9 km of 8.7 km)', Math.abs(c.coveredPct - (2 * Math.sqrt(2000 ** 2 - 600 ** 2)) / 8700 * 100) < 4, `${c.coveredPct.toFixed(1)}%`);
  check('out-of-range stretches are gaps of kind "o"', c.gaps.length === 2 && c.gaps.every((q) => q.kind === 'o'), c.gaps.map((q) => `${q.kind} ${(q.fromM / 1000).toFixed(1)}-${(q.toM / 1000).toFixed(1)}`).join(', '));
}
{
  // A ridge 25 m high just west of the Posn, north of it: the line north of the middle is dead ground.
  const g = grid(({ elev }) => { for (let y = 60; y < 145; y++) for (let x = 160; x < 166; x++) elev[y * N + x] = 225; });
  const r = run(g, [posn(170, 150, 2500)], [line('A', 150)]);
  const c = r.lines[0];
  const deadGap = c.gaps.find((q) => q.kind === 'd');
  check('a ridge between the Posn and the Apch makes dead ground: a "dead" gap north of the middle', !!deadGap && deadGap.toM <= 4500 && deadGap.fromM >= 1000 && stateAt(c, 5500) === 'c', deadGap ? `dead ${(deadGap.fromM / 1000).toFixed(1)}-${(deadGap.toM / 1000).toFixed(1)} km · ${c.deadPct.toFixed(0)}% dead` : 'none');
}
{
  // A wood (screening class) between the Posn and the south half of the line: screened, not dead.
  const blocker = Object.entries(doctrine.surfaceBlockers?.classes ?? {}).find(([, v]) => (v?.q ?? 0) >= 0.3)?.[0];
  const cid = Number(blocker ?? 31);
  const T = sightTables(doctrine, 11, RES);
  const g = grid(({ cls }) => { for (let y = 155; y < 260; y++) for (let x = 156; x < 168; x++) cls[y * N + x] = cid; });
  const r = run(g, [posn(170, 150, 2500)], [line('A', 150)], T);
  const c = r.lines[0];
  check(`a wood (class ${cid}) between them screens the south half (screened, not dead)`, c.screenedPct > 10 && stateAt(c, 6000) === 's' && stateAt(c, 3500) === 'c', `${c.screenedPct.toFixed(0)}% screened · ${c.deadPct.toFixed(0)}% dead`);
}
{
  // A Posn 308 m off the line with a 300 m reach (a lone platoon beside a Bde HQ's avenue): out of range all along, and
  // the nearest says why (user, 2026-11-14: "Coverage Along Each Apch is always out of range? is it a bug?").
  const r = run(grid(), [posn(150 + 308 / RES, 150, 300)], [line('A', 150)]);
  const c = r.lines[0];
  check('a Posn 308 m off the Apch with 300 m reach: out of range all along, nearest 308 m', c.outPct === 100 && Math.abs(c.nearestM - 308) < 1 && c.nearestPosn === 0, `${c.outPct.toFixed(0)}% out · nearest ${c.nearestM?.toFixed(0)} m`);
  const r2 = run(grid(), [posn(150 + 250 / RES, 150, 300)], [line('A', 150)]);
  check('the same Posn 250 m off: part of the Apch under fire', r2.lines[0].coveredPct > 0 && Math.abs(r2.lines[0].nearestM - 250) < 1, `${r2.lines[0].coveredPct.toFixed(0)}% covered`);
  const r3 = run(grid(), [], [line('A', 150)]);
  check('no Posns: nearest is null', r3.lines[0].nearestM === null && r3.lines[0].nearestPosn === -1);
}
{
  // Surveillance reaches past the weapon: seen but not under fire.
  const r = run(grid(), [posn(170, 150, 1000, 4000)], [line('A', 150)]);
  const c = r.lines[0];
  check('an OP sees farther than it fires: watched share > fired share', c.seenPct > c.coveredPct + 30, `seen ${c.seenPct.toFixed(0)}% · fire ${c.coveredPct.toFixed(0)}%`);
}
{
  // A narrows under fire is a killing area candidate; one out of range is not.
  const r = run(grid(), [posn(170, 150, 2000)], [line('A', 150, [{ x: 150, y: 150, alongM: 4350, widthM: 300, kind: 'narrow' }, { x: 150, y: 20, alongM: 450, widthM: 200, kind: 'crossing' }])]);
  const ka = r.killing.filter((k) => k.kind === 'narrows');
  check('a narrows under fire is a killing area candidate; one out of range is not', ka.length === 1 && Math.abs(ka[0].alongM - 4350) < 1, ka.map((k) => k.text).join('; '));
  check('a covered stretch of a km or more is a candidate too', r.killing.some((k) => k.kind === 'stretch' && k.lengthM >= 1000));
}
{
  const t = performance.now();
  const posns = Array.from({ length: 10 }, (_, k) => posn(40 + k * 25, 100 + (k % 3) * 40, 3000, 4000));
  const r = run(grid(), posns, ['A', 'B', 'C'].map((id, k) => line(id, 80 + k * 70)));
  const ms = performance.now() - t;
  check('10 Posns over 3 Apchs in under 600 ms', ms < 600 && r.lines.length === 3, `${ms.toFixed(0)} ms`);
}

// ------------------------------------------------------------------------------------------------ proforma
const m = (o) => ({ coveredPct: 50, coverPct: 10, obstacles: 2, itg: 1, rooms: 2, medianWidthM: 2000, goPct: 90, lengthM: 20000, roadPct: 40, sigsPct: 70, seenPct: 60, buaPct: 3, ...o });
{
  const p = proforma([{ head: 'En', side: 'enemy', aas: [{ id: 'A', m: m({ coveredPct: 64, goPct: 95, roadPct: 70 }) }, { id: 'B', m: m({ coveredPct: 48, goPct: 80, roadPct: 20 }) }] }]);
  const row = (k) => p.rows.find((r) => r.key === k).cells[0];
  check('row a: less under fire is + for the avenue\'s user (B 48% beats A 64%)', row('a')[0].sign === '−' && row('a')[1].sign === '+');
  check('row f: more GO is + (A 95% beats B 80%)', row('f')[0].sign === '+' && row('f')[1].sign === '−');
  check('rows d, g, k, l are left to the user (?)', ['d', 'g', 'k', 'l'].every((k) => row(k).every((c) => c.sign === '?')));
  check('equal measures suggest nothing (row b: both 10%)', row('b').every((c) => c.sign === '?'));
  const tA = p.totals[0][0], tB = p.totals[0][1];
  check('totals are + less − and the lead is named', p.lead[0] !== null && p.lead[0].id === (tA > tB ? 'A' : 'B') && Math.abs(tA - tB) >= 1, `A ${tA} · B ${tB} · lead ${p.lead[0]?.id}`);
  const q = proforma([{ head: 'En', side: 'enemy', aas: [{ id: 'A', m: m({ coveredPct: 64 }) }, { id: 'B', m: m({ coveredPct: 48 }) }] }], { [pfKey(0, 'A', 'a')]: '+' });
  check('a user\'s sign wins and is marked as the user\'s', q.rows[0].cells[0][0].sign === '+' && q.rows[0].cells[0][0].user && q.rows[0].cells[0][0].suggested === '−');
  const one = proforma([{ head: 'Own', side: 'own', aas: [{ id: 'A', m: m({}) }] }]);
  check('one avenue in a group: no comparison, every sign "?"', one.rows.every((r) => r.cells[0][0].sign === '?') && one.lead[0] === null);
  const nul = proforma([{ head: 'En', side: 'enemy', aas: [{ id: 'A', m: m({ coveredPct: null }) }, { id: 'B', m: m({ coveredPct: null }) }] }]);
  check('no Posns read: row a is "?"', nul.rows[0].cells[0].every((c) => c.sign === '?' && /no Posns/.test(c.value)));
  const two = proforma([{ head: 'En', side: 'enemy', aas: [{ id: 'A', m: m({}) }, { id: 'B', m: m({}) }] }, { head: 'Own', side: 'own', aas: [{ id: 'A', m: m({}) }, { id: 'B', m: m({}) }, { id: 'C', m: m({}) }, { id: 'D', m: m({}) }, { id: 'E', m: m({}) }] }]);
  check('two groups, at most four avenues (A-D) each; 12 rows (h split in two)', two.groups.length === 2 && two.groups[1].ids.length === 4 && two.rows.length === 12 && PF_ROWS.length === 12);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
