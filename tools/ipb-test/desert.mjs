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
check('...in a desert AOR a village counts from 100 people within 2 km (dhanis small and sparse; DW p 7 long ranges), off the desert 300 within 800 m as before (checked in the app 28 Nov: Mithi, Chachro, Diplo now get W X Y village lines)', /const VIL = desertAor \? \{ people: 100, withinM: 2000, nearM: 1000, bigPeople: 300 \} : \{ people: 300, withinM: 800, nearM: 400, bigPeople: 1000 \}/.test(aorSrc) && /nearestPlace\(p, home, VIL\.people, VIL\.withinM\)/.test(aorSrc));
check('...the D sheet and Copy as Text carry the reason', /l\.desert \? `; \$\{l\.desert\}`/.test(readFileSync(resolve(repo, 'MS/Engines/GroundGuide/GroundGuideAorSheet.ts'), 'utf8')) && /l\.desert \? `; \$\{l\.desert\}`/.test(readFileSync(resolve(repo, 'MS/Engines/GroundGuide/GroundGuideScopeAor.ts'), 'utf8')));

// ── G4: dune faces are not mountains (28 Nov 2026, Aprc_Review.md §3) ──────────────────────────────────────────────
// The bundle's slope classes (sloping 7-15°, moderate 15-30°, steep, escarpment) count as mountain ground; in the Thar
// they are dune faces (dunes 50-300 ft, a vertical slip face: DW pp 2-3). Shares measured on the real bundle within 5 km:
// Mithi relief 77 m, sand 45 %; Nagarparkar (Karoonjhar) 309 m, slopes 43 %, sand 14 %; Muzaffarabad 830 m, slopes 48 %.
// Islamkot (the Desert Warfare session's run, 28 Nov): relief 72 m, sand under 30 %, read Mountains under the first rule;
// since then the relief decides whenever it is read: slopes make Mountains only on the mountain test (400 m in 5 km).
const A = await import('../../MS/Engines/GroundGuide/GroundGuideAor.ts');
const shOf = (o) => (g) => o[g] ?? 0;
const mithi = shOf({ 1: 0.2, 2: 0.45, 4: 0.2, 6: 0.12 }), karoon = shOf({ 1: 0.43, 2: 0.14, 6: 0.25 }), mzd = shOf({ 1: 0.48, 4: 0.29 }), rocky = shOf({ 1: 0.3, 2: 0.55 });
check('G4: the Thar round Mithi (slopes 20 %, sand 45 %, the ground rising 77 m in 5 km) reads Desert, not Mountains', A.aorCountry(mithi, 77) === 'Desert');
check('...with no elevation read the classes alone decide, as before (Mountains)', A.aorCountry(mithi, null) === 'Mountains');
const islamkot = shOf({ 1: 0.2, 2: 0.25, 6: 0.4 });
check('...Islamkot (slopes 20 %, sand 25 %, 72 m) is not Mountains: the ground fails the mountain test whatever the sand', A.aorCountry(islamkot, 72) !== 'Mountains');
check('...the Karoonjhar hills (slopes 43 %, sand 14 %, 309 m) fail the 400 m test too: not Mountains, the other classes decide', A.aorCountry(karoon, 309) === 'Plains' && A.aorCountry(karoon, 400) === 'Mountains');
check('...Muzaffarabad (830 m) stays Mountains; a rocky desert range rising 400 m or more stays Mountains', A.aorCountry(mzd, 830) === 'Mountains' && A.aorCountry(rocky, 900) === 'Mountains' && A.aorCountry(rocky, 399) === 'Desert');
check('...the rise is IpbTemplates mountainTest riseM (400 m, E), passed in by the guide', A.AOR_MOUNTAIN_RISE_M === json('MS/Data/IpbTemplates.json').mountainTest.riseM && A.aorCountry(mithi, 450, 500) === 'Desert' && A.aorCountry(mithi, 450) === 'Mountains');
check('...the other countries unchanged', A.aorCountry(shOf({ 6: 0.8, 5: 0.01 }), 26) === 'Canal plains' && A.aorCountry(shOf({ 6: 0.8 }), 26) === 'Plains' && A.aorCountry(shOf({ 3: 0.2 }), 10) === 'Riverine' && A.aorCountry(shOf({ 4: 0.4 }), 10) === 'Built-up');
const ggSrc = readFileSync(resolve(repo, 'MS/Engines/GroundGuide/GroundGuide.ts'), 'utf8');
check('...the guide reads the rise within 5 km of the MITG into the AOR input, and waits for its tiles', /const relief = this\._aorRelief\(anchor, lat\)/.test(ggSrc) && /relief\.pending/.test(ggSrc) && /reliefM: relief\.m/.test(ggSrc) && /mountainTest\?\.withinM \?\? 5000/.test(ggSrc));

console.log(`\n${n - fails}/${n} passed${fails ? `, ${fails} FAILED` : ''}`);
process.exit(fails ? 1 : 0);
