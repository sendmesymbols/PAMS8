// desert.mjs -- the Ground Guide's Desert Warfare items (DW_Review.md G1-G3, 27 Nov 2026): the desert observation rule
// on the Extended View reading (DW pp 7, 61), water sources weighed as key ground in the desert (pp 7, 38), and a canal
// across two approaches standing as a line of defence in a desert AOR (p 4).
//   node tools/ipb-test/desert.mjs          (add --quiet to print only failures and the summary)
// The view modules carry TypeScript parameter properties: the file runs itself again with --experimental-transform-types.
import { spawnSync } from 'node:child_process';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

if (!process.execArgv.includes('--experimental-transform-types')) {
  const r = spawnSync(process.execPath, ['--experimental-transform-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
register('../movement-test/hooks.mjs', import.meta.url);
register('./jsonhook.mjs', import.meta.url);

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const quiet = process.argv.includes('--quiet');
const json = (p) => JSON.parse(readFileSync(resolve(repo, p), 'utf8'));
let fails = 0, n = 0;
function check(name, ok, info = '') {
  n++;
  if (!ok) fails++;
  if (!ok || !quiet) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
}

// ── G1: the desert observation rule on the reading ──────────────────────────────────────────────────────────────────
const OR = await import('../../MS/Engines/GroundGuide/GroundGuideOcokaRead.ts');
const ocoka = json('MS/Data/OcokaDoctrine.json');
const grid = (c) => ({ w: 200, h: 200, res: 30, cls: new Uint8Array(200 * 200).fill(c), elev: new Float32Array(200 * 200).fill(100) });
const d = OR.desertSight(grid(13), 100, 100, 2000, ocoka);
check('G1: a reading on sand carries the desert observation rule: 5-20 km from a vantage point (OcokaDoctrine observation.desert, DW pp 7, 61)', d?.sharePct === 100 && d.detectKm[0] === 5 && d.detectKm[1] === 20 && /DW pp 7, 61/.test(d.src), JSON.stringify(d));
check('...on cropland none', OR.desertSight(grid(2), 100, 100, 2000, ocoka) === null);
const half = grid(2);
for (let i = 0; i < half.cls.length; i++) if (i % 200 < 100) half.cls[i] = 14;
check('...half dunes, half cropland: the desert from half (IpbTemplates desertTest share)', OR.desertSight(half, 100, 100, 2000, ocoka)?.sharePct >= 45);
const nodata = grid(255);
check('...no class data: not called desert', OR.desertSight(nodata, 100, 100, 2000, ocoka) === null);

// ── G2: water sources as key ground in the desert ───────────────────────────────────────────────────────────────────
const EV = await import('../../MS/Engines/GroundGuide/GroundGuideExtendedView.ts');
const cand = (name, at, dist) => ({ name, kindLabel: 'Knoll', level: 1, distanceM: dist, bearingDeg: 0, compass: 'N', higherM: 0, seenP: null, at, itg: { traits: {} } });
const o = (desert) => ({ lngLat: [70, 28], threat: { allRound: true, sectorDeg: 360, bearingDeg: 0 }, radiusM: 5000, plan: null, key: { candidates: [cand('Dry knoll', [0, 3000], 1500), cand('Well knoll', [3000, 0], 1500)] }, desert });
const water = [{ kindLabel: 'Tube well', name: null, distanceM: 2000, compass: 'E', at: [3300, 0] }];
const ranked = EV.rankKeyGround(o({ sharePct: 90, detectKm: [5, 20], text: '', src: 'DW pp 7, 61', water }));
check('G2: in the desert the candidate commanding a water source ranks first, its reason cites DW p 7', ranked[0].c.name === 'Well knoll' && ranked[0].why.some((w) => /Commands water · Tube well/.test(w.text) && /DW p 7/.test(w.text)), ranked.map((r) => `${r.c.name} ${r.score.toFixed(2)}`).join(', '));
const plain = EV.rankKeyGround(o(null));
check('...off the desert water weighs nothing (the two tie on distance)', !plain.some((r) => r.why.some((w) => /water/i.test(w.text))) && Math.abs(plain[0].score - plain[1].score) < 1e-9);
const far = EV.rankKeyGround(o({ sharePct: 90, detectKm: [5, 20], text: '', src: '', water: [{ kindLabel: 'Well', name: 'Far well', distanceM: 4800, compass: 'E', at: [9000, 9000] }] }));
check('...a water point beyond the 1 km a candidate commands adds nothing', !far.some((r) => r.why.some((w) => /water/i.test(w.text))));

// ── G3: a canal across two approaches is a line of def in a desert AOR (DW p 4) ─────────────────────────────────────
const aorSrc = readFileSync(resolve(repo, 'MS/Engines/GroundGuide/GroundGuideAor.ts'), 'utf8');
check('G3: a desert AOR keeps a water line across two approaches as a line by itself, ridges not; the line says why (DW p 4)', /desertAor && obstacle && waterNames\.has\(obstacle\)/.test(aorSrc) && /if \(ol\.key !== 'ridgeline'\) waterNames\.add/.test(aorSrc) && /canals in the green belt are lines of defence \(DW p 4\)/.test(aorSrc) && /villages in the desert belt are a line of defence \(DW p 4\)/.test(aorSrc));
check('...the D sheet and Copy as Text carry the reason', /l\.desert \? `; \$\{l\.desert\}`/.test(readFileSync(resolve(repo, 'MS/Engines/GroundGuide/GroundGuideAorSheet.ts'), 'utf8')) && /l\.desert \? `; \$\{l\.desert\}`/.test(readFileSync(resolve(repo, 'MS/Engines/GroundGuide/GroundGuideScopeAor.ts'), 'utf8')));

console.log(`\n${n - fails}/${n} passed${fails ? `, ${fails} FAILED` : ''}`);
process.exit(fails ? 1 : 0);
