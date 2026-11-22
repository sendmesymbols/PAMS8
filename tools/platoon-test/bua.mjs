// bua.mjs -- the Platoon Guide's built-up areas (MS/Engines/PlatoonGuide/PlatoonGuideBua.ts) from the real terrain
// bundle's settlements.geojson.
//   node tools/platoon-test/bua.mjs
// Skips (exit 0) when the bundle is not on this machine. Exit code 1 when a check fails.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { BuaIndex, buildBuaStore } from '../../MS/Engines/PlatoonGuide/PlatoonGuideBua.ts';
import * as P from '../../MS/Engines/PlatoonGuide/PlatoonGuideRead.ts';

const here = dirname(fileURLToPath(import.meta.url));
const file = resolve(here, '../../MS/Data/terrain-bundle/settlements.geojson');
if (!existsSync(file)) {
  console.log('SKIP  no terrain bundle with settlements.geojson');
  process.exit(0);
}

let fails = 0;
let n = 0;
function check(name, ok, info = '') {
  n++;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
}

const t0 = performance.now();
const store = buildBuaStore(JSON.parse(readFileSync(file, 'utf8')));
const tBuild = performance.now() - t0;
const t1 = performance.now();
const idx = new BuaIndex(store);
const tIndex = performance.now() - t1;
check('store built: every settlement, outlines for the larger ones', store.n > 100000 && store.ringAt.length > 1000, `${store.n} settlements, ${store.ringAt.length - 1} rings, ${(store.xy.length / 2) | 0} vertices; build ${tBuild.toFixed(0)} ms, index ${tIndex.toFixed(0)} ms`);

const merc = (lng, lat) => [(lng * Math.PI * 6378137) / 180, Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 6378137];
const near = (lng, lat, r) => {
  const p = merc(lng, lat);
  return idx.near(p[0], p[1], r, P.plScale(p[1])).map((a) => ({ a, e: P.buaEdge(p, a) })).sort((x, y) => x.e.d - y.e.d);
};

// Inside Lahore: in a BUA with an outline, a big one.
const lhr = near(74.3436, 31.5497, 500);
check('central Lahore: inside a city outline', lhr.length > 0 && lhr[0].e.d === 0 && !!lhr[0].a.rings && (lhr[0].a.pop ?? 0) > 1e6, lhr[0] ? `${lhr[0].a.name} (${lhr[0].a.label}, ${Math.round(lhr[0].a.pop ?? 0)})` : 'none');

// Open country: the nearest BUA some way off, measured to its edge.
const open = near(72.0, 30.0, 5000);
check('open country: BUAs round the point, nearest by its edge', open.length > 0 && open.every((x, i) => i === 0 || x.e.d >= open[i - 1].e.d), `${open.length} within 5 km, nearest ${open[0] ? Math.round(open[0].e.d) : '-'} m (${open[0]?.a.label})`);

// A query is quick (the guide asks on every mouse move).
const t2 = performance.now();
for (let i = 0; i < 200; i++) near(73 + Math.random(), 32 + Math.random(), 10000);
check('200 reads of 10 km round a point in time', performance.now() - t2 < 2000, `${(performance.now() - t2).toFixed(0)} ms`);

console.log(`\n${n - fails} / ${n} checks passed${fails ? `, ${fails} FAILED` : ''}`);
process.exit(fails ? 1 : 0);
