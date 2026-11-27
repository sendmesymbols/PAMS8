// mtnapch.mjs -- checks the mountain approach types (GroundGuideIpbCorridors.mountainApproach, mtnHardestIndex;
// IpbDoctrine mountainApproach): MW s7 para 4 a p 78 (river / valley, nullah, ridge-line approaches), p 79 (the
// difficult approach normally lightly held), p 46, p 52. Synthetic elevation on a 30 m grid, the approach running east
// along the middle row, so every answer has a known place.
//   node tools/ipb-test/mtnapch.mjs        Exit code 1 when a check fails.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const C = await import('../../MS/Engines/GroundGuide/GroundGuideIpbCorridors.ts');

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const json = (p) => JSON.parse(readFileSync(resolve(repo, p), 'utf8'));
let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
}

const D = json('MS/Data/IpbDoctrine.json');
const R = C.mtnApchRulesFrom(D);
const RES = 30, W = 400, H = 200, YC = 100;
// the approach: 8 km east along the middle row (grid cells [x, y, ...])
const line = new Float32Array([20, YC, 120, YC, 200, YC, 290, YC]);
// elevation from metres across the way (dy > 0 south of it) and metres along (x)
const grid = (fn) => (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? NaN : fn((y - YC) * RES, x * RES));
const read = (fn) => C.mountainApproach(line, grid(fn), RES, R);

check('the reading\'s settings come from IpbDoctrine mountainApproach.read (basis E, decided and searched)', R.stepM === 100 && R.reachM === 1500 && R.riseM === 30 && R.nullahMaxM === 500 && D.mountainApproach.read.basis === 'E' && !!D.mountainApproach.read.decided && !!D.mountainApproach.read.searched, JSON.stringify(R));

// a broad valley: a floor 1.2 km wide, then the sides rise
const valley = read((dy) => 1000 + Math.max(0, Math.abs(dy) - 600) * 0.4);
check('a broad valley (floor 1.2 km): Valley, its floor read over 1 km wide', valley?.kind === 'valley' && valley.floorM > 1000, JSON.stringify(valley));
// a very broad valley (the Swat at Mingora, 27 Nov 2026): a floor 4 km wide, the sides beyond 1.5 km: still a valley
const wide = read((dy) => 1000 + Math.max(0, Math.abs(dy) - 2000) * 0.4);
check('a very broad valley (floor 4 km, wider than the 1.5 km look-out): Valley, read out to 5 km (floorReachM)', wide?.kind === 'valley' && wide.floorM > 3000 && R.floorReachM === 5000, JSON.stringify(wide));
// a hillside that falls only far out (beyond 1.5 km) on one side and rises on the other: a side slope, not a ridge
const farFall = read((dy) => 1500 + (dy > 0 ? 0.3 * dy : Math.min(0, dy + 2000) * 0.3));
check('...a fall beyond 1.5 km never makes a ridge line', farFall?.kind !== 'ridge', JSON.stringify(farFall));
// a nullah: a floor 200 m wide, steep sides
const nullah = read((dy) => 1000 + Math.max(0, Math.abs(dy) - 100) * 0.8);
check('a narrow nullah (floor 200 m, steep sides): Nullah, floor within 500 m', nullah?.kind === 'nullah' && nullah.floorM <= R.nullahMaxM, JSON.stringify(nullah));
// a ridge line: the ground falls away both sides
const ridge = read((dy) => 2000 - Math.abs(dy) * 0.3);
check('a ridge line (falls 30 % both sides): Ridge', ridge?.kind === 'ridge' && ridge.shares.ridge === 100, JSON.stringify(ridge));
// a side slope: up one side, down the other
const slope = read((dy) => 1500 + dy * 0.3);
check('a traverse across a hillside: Side slope', slope?.kind === 'slope', JSON.stringify(slope));
// flat ground (the plains): neither rises nor falls; the guide types approaches only on mountain ground
const flat = read(() => 200);
check('flat ground reads as neither floor nor ridge (slope class, no floor)', flat?.kind === 'slope' && flat.floorM === null, JSON.stringify(flat));
const tpl = json('MS/Data/IpbTemplates.json');
check('...and off the mountains nothing is typed: the guide types only where the ground within 5 km rises 400 m (IpbTemplates mountainTest)', Number(tpl.mountainTest?.riseM) === 400);
// a third along a ridge, a third across a hillside, a third in a valley: no type holds half: mixed, two named
const mixed = read((dy, x) => (x < 3300 ? 2000 - Math.abs(dy) * 0.3 : x < 6000 ? 1500 + dy * 0.3 : 1000 + Math.max(0, Math.abs(dy) - 600) * 0.4));
check('a ridge, then a hillside, then a valley (none half of it): Mixed, the two most common named', mixed?.kind === 'mixed' && !!mixed.top[0] && !!mixed.top[1] && mixed.top[0] !== mixed.top[1], JSON.stringify(mixed));
// most of it on a ridge: Ridge, even with a stretch in a valley
const most = read((dy, x) => (x < 6500 ? 2000 - Math.abs(dy) * 0.3 : 1000 + Math.max(0, Math.abs(dy) - 600) * 0.4));
check('three quarters along a ridge, the rest in a valley: Ridge, valley the second', most?.kind === 'ridge' && most.top[1] === 'valley', JSON.stringify(most));
// a floor that narrows: valley in parts, nullah in parts, a floor all the way
const narrows = read((dy, x) => 1000 + Math.max(0, Math.abs(dy) - (x < 4200 ? 600 : 100)) * 0.6);
check('a valley that narrows into a nullah: still a floor, typed by its median width', (narrows?.kind === 'valley' || narrows?.kind === 'nullah') && narrows.shares.valley + narrows.shares.nullah === 100, JSON.stringify(narrows));
// no heights at all
check('no heights under the line: no reading', C.mountainApproach(line, () => NaN, RES, R) === null);
check('a one-point line: no reading', C.mountainApproach(new Float32Array([5, 5]), grid(() => 1), RES, R) === null);

// the difficult approach (MW p 79)
const h1 = C.mtnHardestIndex([{ hoursDay: 2.1, goPct: 80 }, { hoursDay: 4.6, goPct: 60 }, { hoursDay: 3.0, goPct: 40 }]);
check('the difficult approach: the most hours at the book\'s day rates (B, 4.6 h)', h1?.index === 1 && h1.byHours === true, JSON.stringify(h1));
const h2 = C.mtnHardestIndex([{ hoursDay: null, goPct: 80 }, { hoursDay: 4.6, goPct: 60 }, { goPct: 35 }]);
check('...without hours for every one: the least GO (C, 35 %)', h2?.index === 2 && h2.byHours === false, JSON.stringify(h2));
check('...one approach alone: none named', C.mtnHardestIndex([{ hoursDay: 1, goPct: 50 }]) === null);

// the book: every type's words with their printed page, checked by verify.py
const MA = D.mountainApproach;
const pages = (k) => (MA[k]?.refs ?? []).map((r) => `${r.book} ${r.page}`).join(',');
check('valley, nullah, ridge: MW p 78', ['valley', 'nullah', 'ridge'].every((k) => MA[k]?.text && /MW 78/.test(pages(k))), ['valley', 'nullah', 'ridge'].map(pages).join(' | '));
check('along ridges MW pp 79, 46; lightly held MW p 79; LPs MW p 52', /MW 79/.test(pages('alongRidges')) && /MW 46/.test(pages('alongRidges')) && /MW 79/.test(pages('lightlyHeld')) && /MW 52/.test(pages('listeningPosts')));
const unchecked = ['valley', 'nullah', 'ridge', 'alongRidges', 'lightlyHeld', 'listeningPosts'].flatMap((k) => MA[k].refs).filter((r) => r.checked?.status !== 'ok');
check('every mountainApproach ref found on its page by verify.py (checked ok)', unchecked.length === 0, unchecked.map((r) => `${r.page}: ${r.quote}`).join('; '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
