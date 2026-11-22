// side.mjs -- the Platoon Guide's side of the LoC / border (MS/Engines/PlatoonGuide/PlatoonGuideSide.ts) on the real
// terrain bundle's admin.geojson and boundaries.geojson.
//   node tools/platoon-test/side.mjs
// Skips (exit 0) when the bundle is not on this machine. Exit code 1 when a check fails.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PlSideMap } from '../../MS/Engines/PlatoonGuide/PlatoonGuideSide.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const B = resolve(repo, 'MS/Data/terrain-bundle');
if (!existsSync(resolve(B, 'admin.geojson')) || !existsSync(resolve(B, 'boundaries.geojson'))) {
  console.log('SKIP  no terrain bundle with admin.geojson and boundaries.geojson');
  process.exit(0);
}
const admin = JSON.parse(readFileSync(resolve(B, 'admin.geojson'), 'utf8'));
const bnd = JSON.parse(readFileSync(resolve(B, 'boundaries.geojson'), 'utf8'));
const mov = JSON.parse(readFileSync(resolve(repo, 'MS/Data/MovementDoctrine.json'), 'utf8'));
const pl = JSON.parse(readFileSync(resolve(repo, 'MS/Data/PlatoonDoctrine.json'), 'utf8'));

let fails = 0;
let n = 0;
function check(name, ok, info = '') {
  n++;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
}

const t0 = performance.now();
const S = PlSideMap.from(admin, bnd, { own: pl.side.ownCountry, kinds: new Set(mov.exposure.borderKinds), nearLineM: pl.side.nearLineM, onLineM: pl.side.onLineM });
check('built from the bundle', !!S, `${(performance.now() - t0).toFixed(0)} ms`);

const PLACES = [
  ['Islamabad', 73.05, 33.7, 'own'], ['Muzaffarabad', 73.47, 34.37, 'own'], ['Kel (Neelum)', 74.35, 34.83, 'own'], ['Gilgit', 74.31, 35.92, 'own'],
  ['Skardu', 75.63, 35.3, 'own'], ['Kotli', 73.9, 33.52, 'own'], ['Sialkot', 74.53, 32.49, 'own'], ['Lahore', 74.35, 31.55, 'own'], ['Karachi', 67.0, 24.86, 'own'],
  ['Srinagar', 74.8, 34.08, 'other'], ['Kupwara', 74.25, 34.53, 'other'], ['Poonch (IIOJ&K)', 74.09, 33.77, 'other'], ['Jammu', 74.86, 32.73, 'other'],
  ['Kargil', 76.13, 34.55, 'other'], ['Amritsar', 74.87, 31.63, 'other'], ['Bhuj', 69.67, 23.25, 'other'], ['Kabul', 69.17, 34.53, 'other'],
];
for (const [name, x, y, want] of PLACES) check(`${name}: ${want}`, S.side(x, y) === want, String(S.side(x, y)));

const kx0 = 111.32, ky = 110.574;
const SIDE_KINDS = ['Line of Control', 'Pakistan-India', 'Pakistan-Afghanistan', 'Pakistan-Afghanistan (undemarcated)', 'Pakistan-Iran', 'Pakistan-China'];
/** Every stretch's midpoint and left normal (km frame), for the kinds asked. */
function* stretches(kinds) {
  for (const f of bnd.features) {
    if (!kinds.includes(f.properties.kind)) continue;
    const g = f.geometry;
    for (const l of g.type === 'LineString' ? [g.coordinates] : g.coordinates)
      for (let i = 0; i + 1 < l.length; i += 2) {
        const [x0, y0] = l[i], [x1, y1] = l[i + 1];
        const my = (y0 + y1) / 2, kx = kx0 * Math.cos((my * Math.PI) / 180);
        const dx = (x1 - x0) * kx, dy = (y1 - y0) * ky, L = Math.hypot(dx, dy);
        if (L >= 0.02) yield { kind: f.properties.kind, mx: (x0 + x1) / 2, my, kx, nx: -dy / L, ny: dx / L };
      }
  }
}
const off = (s, km) => [s.mx + (s.nx * km) / s.kx, s.my + (s.ny * km) / ky];

// 150 m either side of each stretch that has Pakistan on one side: never the same answer both sides (a wrong one);
// "not known" where a zig-zag brings the line within 100 m is the safe answer and allowed.
for (const kind of SIDE_KINDS.filter((k) => !k.includes('undemarcated'))) {
  let total = 0, wrong = 0, unknown = 0;
  for (const s of stretches([kind])) {
    const ca = S.countryAt(...off(s, 1.5)), cb = S.countryAt(...off(s, -1.5));
    if (ca !== pl.side.ownCountry && cb !== pl.side.ownCountry) continue; // the IIOJ&K - India stretches
    const a = S.side(...off(s, 0.15)), b = S.side(...off(s, -0.15));
    total++;
    if (!a || !b) unknown++;
    else if (a === b) wrong++;
  }
  check(`${kind}: 150 m either side, wrong answers 0.5 % or fewer`, total > 0 && wrong / total <= 0.005, `${wrong} wrong, ${unknown} not known, of ${total}`);
}

// 0.35 - 0.9 km out, where the country areas are reliable (they follow the lines to about 0.2 km): the line's answer
// agrees with them nearly everywhere (left: the lines' ends near NJ9842 and the Karakoram Pass, the Kathua tri-junction).
{
  let total = 0, differ = 0;
  for (const s of stretches(SIDE_KINDS))
    for (const km of [0.35, 0.6, 0.9, -0.35, -0.6, -0.9]) {
      const [x, y] = off(s, km);
      const c = S.countryAt(x, y);
      const v = S.side(x, y);
      if (c === null || v === null) continue;
      total++;
      if (v !== (c === pl.side.ownCountry ? 'own' : 'other')) differ++;
    }
  check('0.35 - 0.9 km from the lines: agrees with the country areas (99.5 % or more)', total > 1000 && differ / total <= 0.005, `${differ} of ${total} differ`);
}

// On the line: not known (never offered as own).
{
  const l = bnd.features.find((f) => f.properties.kind === 'Line of Control').geometry;
  const c = (l.type === 'LineString' ? l.coordinates : l.coordinates[0])[5];
  check('a place on the LoC is not known', S.side(c[0], c[1]) === null);
}

console.log(`\n${n - fails} / ${n} checks passed${fails ? `, ${fails} FAILED` : ''}`);
process.exit(fails ? 1 : 0);
