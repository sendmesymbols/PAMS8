// run.mjs -- OCOKA lens test program, command-line half.
//   node tools/ocoka-test/run.mjs [--quick]
// Node 24 runs the library's own engine (MS/Engines/GroundGuide/GroundGuideOcoka.ts) directly.
// Needs MS/Data/terrain-bundle (tiles, rules.json, visibility/). Writes last-run.txt / last-run.json. Exit code 1 when a check fails.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as core from './ocoka-core.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const bundle = resolve(repo, 'MS/Data/terrain-bundle');
const quick = process.argv.includes('--quick');

// ------------------------------------------------------------------------------------------------ PNG (8-bit gray) + source
function decodePng(buf) {
  let p = 8, w = 0, h = 0, bitDepth = 0, color = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8);
    if (type === 'IHDR') { w = buf.readUInt32BE(p + 8); h = buf.readUInt32BE(p + 12); bitDepth = buf[p + 16]; color = buf[p + 17]; }
    else if (type === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bitDepth !== 8 || color !== 0) throw new Error(`unsupported PNG ${bitDepth}/${color}`);
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (w + 1)], row = y * (w + 1) + 1;
    for (let x = 0; x < w; x++) {
      const a = x ? out[y * w + x - 1] : 0, b = y ? out[(y - 1) * w + x] : 0, c = x && y ? out[(y - 1) * w + x - 1] : 0;
      let v = raw[row + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * w + x] = v & 255;
    }
  }
  return out;
}
const tileCache = new Map();
const fsSource = async (layer, x, y) => {
  const key = `${layer}/${x}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const f = `${bundle}/${layer}/${core.Z}/${x}/${y}.png`;
  const t = existsSync(f) ? decodePng(readFileSync(f)) : null;
  tileCache.set(key, t);
  return t;
};

// ------------------------------------------------------------------------------------------------ data
const rules = JSON.parse(readFileSync(`${bundle}/rules.json`, 'utf8'));
const doctrine = JSON.parse(readFileSync(resolve(repo, 'MS/Data/OcokaDoctrine.json'), 'utf8'));
const symbols = JSON.parse(readFileSync(resolve(repo, 'MS/Data/Symbols.json'), 'utf8'));
const visHead = JSON.parse(readFileSync(`${bundle}/visibility/visibility.json`, 'utf8'));
const visBin = readFileSync(`${bundle}/visibility/visibility.bin`);
const vis = core.parseVisibility(visHead, visBin.buffer.slice(visBin.byteOffset, visBin.byteOffset + visBin.byteLength));
const weapon = (key) => core.weaponOf(symbols[key].Rng);
const fireRule = { ...doctrine.fieldOfFire.grade };

// ------------------------------------------------------------------------------------------------ reporting
const results = [];
let failures = 0;
const out = [];
const say = (s = '') => { out.push(s); console.log(s); };
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  say(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
}
const f0 = (v) => (Number.isFinite(v) ? Math.round(v).toString() : '-');
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-');
function bench(fn, n) {
  for (let i = 0; i < Math.min(10, n); i++) fn();
  const t = [];
  for (let i = 0; i < n; i++) { const a = performance.now(); fn(); t.push(performance.now() - a); }
  t.sort((a, b) => a - b);
  return { median: t[n >> 1], p95: t[Math.floor(n * 0.95)] };
}

// ------------------------------------------------------------------------------------------------ synthetic grids
function synth(w, h, lat, elevFn, classFn, bldFn) {
  const res = core.mPerPx(lat, core.Z);
  const elev = new Float32Array(w * h), cls = new Uint8Array(w * h), bld = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { elev[y * w + x] = elevFn(x, y, res); cls[y * w + x] = classFn ? classFn(x, y) : 0; bld[y * w + x] = bldFn ? bldFn(x, y) : 0; }
  return { z: core.Z, ts: 256, tx0: 0, ty0: 0, nx: w / 256, ny: h / 256, w, h, px0: 0, py0: 0, res, elev, cls, bld, pending: false };
}
const opts = (o = {}) => ({ eyeM: 2, targetM: 1.7, radiusM: 5000, effM: 2000, tolM: 1, tables: null, ...o });

say('OCOKA lens test program');
say(`engine MS/Engines/GroundGuide/GroundGuideOcoka.ts   bundle ${bundle}`);
say(`node ${process.version}${quick ? '  (--quick)' : ''}`);

// ================================================================================================ A. synthetic geometry
say('\nA. Synthetic cases with a known answer');
{
  const W = 1024, cx = 512.5, cy = 512.5;
  const res0 = core.mPerPx(0, core.Z);
  let g = synth(W, W, 0, () => 100);
  let r = core.analyseSight(g, cx, cy, core.bearingsFor(5), opts());
  check('flat plain: every ray clear to 5 km and all of it seen', Math.min(...r.clear) >= 4900 && core.observationOf(r).seenPct > 99.5, `min clear ${f0(Math.min(...r.clear))} m, ${f1(core.observationOf(r).seenPct)} % seen`);

  g = synth(W, W, 0, (x, y) => 100 + 20 * Math.exp(-(((cy - 1000 / res0) - y) ** 2) / (2 * (60 / res0) ** 2)));
  r = core.analyseSight(g, cx, cy, Float32Array.from([0, 90, 180, 270]), opts());
  check('20 m ridge 1 km north: sight to the north ends at the ridge, the other three run clear', r.clear[0] > 800 && r.clear[0] < 1100 && r.clear[1] >= 4900 && r.clear[2] >= 4900 && r.clear[3] >= 4900, `north clear ${f0(r.clear[0])} m`);
  const ob = core.observationOf(core.analyseSight(g, cx, cy, core.bearingsFor(5), opts()));
  check('20 m ridge: the dead ground behind it is not seen', ob.seenPct < 95 && ob.seenPct > 60, `${f1(ob.seenPct)} % seen`);

  g = synth(W, W, 0, () => 0);
  r = core.analyseSight(g, cx, cy, Float32Array.from([0]), opts({ radiusM: 14000, tolM: 0.05 }));
  const Reff = 6371008.8 / (1 - 0.13);
  const expect = Math.sqrt(2 * Reff * 2) + Math.sqrt(2 * Reff * 1.7);
  check('earth curvature: a 1.7 m target drops out of sight of a 2 m eye at the horizon sum', Math.abs(r.clear[0] - expect) < 150, `${f0(r.clear[0])} m, expected ${f0(expect)} m`);

  // A sees B exactly when B sees A (ground alone, equal heights): 600 random pairs on rolling ground
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const terms = Array.from({ length: 12 }, () => ({ ax: rnd() * 0.02 + 0.003, ay: rnd() * 0.02 + 0.003, p: rnd() * 6.28, q: rnd() * 6.28, a: rnd() * 14 }));
  g = synth(W, W, 20, (x, y) => 300 + terms.reduce((s, t) => s + t.a * Math.sin(x * t.ax + t.p) * Math.cos(y * t.ay + t.q), 0));
  let pairs = 0, agree = 0, seen = 0;
  for (let i = 0; i < 600; i++) {
    const ax = 200 + Math.floor(rnd() * 300) + 0.5, ay = 200 + Math.floor(rnd() * 600) + 0.5, s = 5 + Math.floor(rnd() * 150);
    const o = opts({ eyeM: 2, targetM: 2, tolM: 0.001 });
    const ab = core.sightTo(g, ax, ay, ax + s, ay, o), ba = core.sightTo(g, ax + s, ay, ax, ay, o);
    pairs++;
    if ((ab.p >= 0.5) === (ba.p >= 0.5)) agree++;
    if (ab.p >= 0.5) seen++;
  }
  check('mutual visibility: A sees B exactly when B sees A', agree === pairs, `${agree}/${pairs} pairs agree (${seen} see each other)`);

  // tolerance: a bump smaller than the tolerance leaves a doubt, not a verdict
  // eye 2 m, a 1.7 m bump at 600 m: with the earth's curve the line over it passes about half a metre above a prone man 3 km out
  g = synth(W, W, 0, (x, y) => 100 + (Math.abs(y - (cy - 600 / res0)) < 2 ? 1.7 : 0));
  const far = (tol) => core.sightTo(g, cx, cy, cx, cy - 3000 / res0, opts({ targetM: 0.4, tolM: tol })).p;
  check('a bump that hides a prone man by half a metre: surely hidden with a fine tolerance, in doubt with 1 m', far(0.05) === 0 && far(1) > 0.05 && far(1) < 0.5, `chance seen ${f1(far(0.05) * 100)} % at 5 cm, ${f1(far(1) * 100)} % at 1 m`);

  // what the elevation cannot show
  const T0 = core.sightTables(doctrine, 11, res0);
  g = synth(W, W, 0, () => 100, (x, y) => (Math.abs(y - (cy - 400 / res0)) < 2 ? 25 : 0));
  const behind = (tables) => core.sightTo(g, cx, cy, cx, cy - 700 / res0, opts({ eyeM: 1.6, targetM: 0.4, tolM: 0.2, tables })).p;
  check('a bund 400 m out: a prone man 300 m behind it is hidden from a standing man; the bare elevation says he is seen', behind(T0) < 0.05 && behind(null) > 0.95, `with ${f1(behind(T0) * 100)} %, without ${f1(behind(null) * 100)} %`);

  const aug = core.cropShares(doctrine, 8), apr = core.cropShares(doctrine, 4);
  check('crop mix: a share of the cropland is tall in August, none in April', aug.tall > 0.1 && aug.tall < 0.3 && apr.tall === 0, `August ${f1(aug.tall * 100)} %, April ${f1(apr.tall * 100)} %`);
  const res20 = core.mPerPx(20, core.Z);
  const field = synth(W, W, 20, () => 200, () => 2);
  const obsIn = (month) => core.observationOf(core.analyseSight(field, cx, cy, core.bearingsFor(2), opts({ eyeM: 1.6, tables: core.sightTables(doctrine, month, res20) })));
  const oAug = obsIn(8), oApr = obsIn(4), oAug2 = obsIn(8);
  check('a cropland plain: the view reaches the edge in April and a few hundred metres in August (16 % tall)', oApr.reachMedianM > 4900 && oAug.reachMedianM > 200 && oAug.reachMedianM < 1500, `April ${f0(oApr.reachMedianM)} m, August ${f0(oAug.reachMedianM)} m (${oAug.country}); August: ${f1(oAug.seenPct)} % expected, ${f1(oAug.terrainPct)} % on the ground alone`);
  check('the same point gives the same answer twice (nothing is random)', oAug.seenPct === oAug2.seenPct && oAug.reachMedianM === oAug2.reachMedianM);
  const town = synth(W, W, 20, () => 200, () => 3, () => 4 | (2 << 3) | (1 << 6));   // 300-1,000 buildings per km2, houses of 40-100 m2, 3-6 m high
  const oTown = core.observationOf(core.analyseSight(town, cx, cy, core.bearingsFor(2), opts({ eyeM: 1.6, radiusM: 3000, tables: core.sightTables(doctrine, 11, res20) })));
  check('a medium-density town: close or very close country, with a view of a street length, not zero', oTown.country !== 'open' && oTown.reachMedianM > 60, `${oTown.country}, reach ${f0(oTown.reachMedianM)} m, ${f1(oTown.seenPct)} % expected against ${f1(oTown.terrainPct)} % on the ground alone`);

  // going
  const going = core.goingTable(rules, 'tracked');
  g = synth(W, W, 0, () => 100, (x) => (Math.abs(x - (cx + 600 / res0)) < 2 ? 20 : 0));
  let gr = core.goReach(g, cx, cy, going, 3000);
  let ways = core.waysOut(g, cx, cy, going, 2000);
  check('a canal across the east: the flood stops at it and the straight way east is stopped by it', gr.directM[6] < 700 && ways.state[6] === 'nogo' && ways.stopClass[6] === 20, `flood ${f0(gr.directM[6])} m, way east ${ways.state[6]} at ${f0(ways.distM[6])} m; ${ways.go} GO, ${ways.blocked} stopped`);
  g = synth(W, W, 0, () => 100, (x, y) => (Math.abs(x - (cx + 600 / res0)) < 2 && Math.abs(y - cy) > 20 ? 20 : 0));
  gr = core.goReach(g, cx, cy, going, 3000);
  check('the same canal with a gap: the flood goes through', gr.directM[6] > 2000, `east reaches ${f0(gr.directM[6])} m`);
  // a canal one pixel wide running diagonally (NW-SE) across the north-east: its cells touch only at their corners
  g = synth(W, W, 0, () => 100, (x, y) => (x - Math.floor(cx) - (y - Math.floor(cy)) === 24 ? 20 : 0));
  ways = core.waysOut(g, cx, cy, going, 2000);
  const sight = core.analyseSight(g, cx, cy, core.bearingsFor(1, 45, 60), opts({ going, radiusM: 2000 }));
  check('a canal one pixel wide running diagonally: no ray slips between its cells', ways.state[3] === 'nogo' && Array.from(sight.nogoClass).every((c) => c === 20), `way NE ${ways.state[3]} at ${f0(ways.distM[3])} m; ${Array.from(sight.nogoClass).filter((c) => c === 20).length}/${sight.n} sight rays meet it`);
}

// ================================================================================================ A2. map products
say('\nA2. Map products: fan runs, where a sight line is lost, avenues and chokepoints, a better position');
{
  const W = 1024, cx = 512.5, cy = 512.5;
  const res0 = core.mPerPx(0, core.Z);
  const going = core.goingTable(rules, 'tracked');
  // a 20 m ridge 1 km north
  let g = synth(W, W, 0, (x, y) => 100 + 20 * Math.exp(-(((cy - 1000 / res0) - y) ** 2) / (2 * (60 / res0) ** 2)));
  const steps = Math.floor(3000 / res0);
  const tr = new Uint8Array(steps), tt = new Uint8Array(steps);
  core.analyseSight(g, cx, cy, Float32Array.from([0]), opts({ radiusM: 3000, trace: tr, traceTerrain: tt }));
  const runs = core.sightRuns(tr, tt, 1, steps, res0, 2500);
  const dead = runs.find((r) => r.state === 1);
  check('fan runs: seen up to the ridge, then dead ground, nothing screened', runs[0].state === 0 && !!dead && dead.fromM > 850 && dead.fromM < 1150 && !runs.some((r) => r.state === 2) && runs[runs.length - 1].toM <= 2500, `${runs.map((r) => `${['seen', 'dead', 'screened'][r.state]} ${f0(r.fromM)}-${f0(r.toM)}`).join(', ')}`);
  const st = core.sightTo(g, cx, cy, cx, cy - 3000 / res0, opts());
  check('a sight line over the ridge is lost at the ridge', st.p < 0.2 && st.blockAtM > 850 && st.blockAtM < 1150, `chance ${f0(st.p * 100)} %, lost ${f0(st.blockAtM)} m out`);

  // avenues: a canal across the east with one gap of 3 cells, 40 cells south of the direct line
  const wallX = Math.floor(cx + 600 / res0);
  const gapY = Math.floor(cy) + 40;
  g = synth(W, W, 0, () => 100, (x, y) => (x === wallX && Math.abs(y - gapY) > 1 ? 20 : 0));
  const sx = cx + 1500 / res0;
  let av = core.findAvenue(g, sx, cy, cx, cy, { going, frontageM: 300 });
  const through = [];
  for (let k = 0; k < av.path.length; k += 2) if (Math.floor(av.path[k]) === wallX) through.push(Math.floor(av.path[k + 1]));
  check('avenue: it reaches the position through the only gap in the canal', av.reached && through.length === 1 && Math.abs(through[0] - gapY) <= 1, `crosses at row ${through[0]} (gap at ${gapY}), ${f0(av.lengthM)} m against ${f0(1500)} m direct`);
  check('avenue: the gap is reported as a chokepoint narrower than a 300 m frontage, squeezed by the canal', !av.fits && av.chokes.length >= 1 && av.chokes[0].widthM < 200 && av.chokes[0].nogoClass === 20 && Math.abs(Math.floor(av.chokes[0].x) - wallX) <= 1, `width ${f0(av.chokes[0]?.widthM)} m at ${f0(av.chokes[0]?.atM)} m from the start, class ${av.chokes[0]?.nogoClass}`);
  av = core.findAvenue(g, sx, cy, cx, cy, { going, frontageM: 60 });
  check('avenue: a 60 m column fits through the same gap', av.reached && av.fits, `narrowest ${f0(av.minWidthM)} m`);
  g = synth(W, W, 0, () => 100, (x) => (x === wallX ? 20 : 0));
  check('avenue: a canal with no gap leaves no avenue', !core.findAvenue(g, sx, cy, cx, cy, { going, frontageM: 300 }).reached);
  g = synth(W, W, 0, () => 100, (x, y) => (x - Math.floor(cx) - (y - Math.floor(cy)) === 24 ? 20 : 0));
  check('avenue: it does not cut the corner of a canal one pixel wide running diagonally', !core.findAvenue(g, cx + 30, cy - 30, cx, cy, { going, frontageM: 100 }).reached);
  // SLOW-GO ground across the direct line: the avenue goes round it when that is cheaper
  g = synth(W, W, 0, () => 100, (x, y) => (Math.abs(x - (cx + 20)) < 8 && Math.abs(y - cy) < 12 ? 3 : 0));
  av = core.findAvenue(g, cx + 40, cy, cx, cy, { going, frontageM: 60 });
  check('avenue: it goes round a small block of SLOW-GO ground', av.reached && av.goPct > 95 && av.lengthM > 40 * res0, `${f0(av.goPct)} % on GO ground, ${f0(av.lengthM)} m against ${f0(40 * res0)} m direct`);
  // a second avenue away from the first
  g = synth(W, W, 0, () => 100, (x, y) => (x === wallX && Math.abs(y - gapY) > 1 && Math.abs(y - (Math.floor(cy) - 60)) > 1 ? 20 : 0));
  const first = core.findAvenue(g, sx, cy, cx, cy, { going, frontageM: 100 });
  const mask = core.avenueMask(g, first, 6);
  const second = core.findAvenue(g, sx, cy, cx, cy, { going, frontageM: 100, avoid: mask, avoidCost: 4 });
  check('avenue: with two gaps a second avenue takes the other gap', first.reached && second.reached && core.avenueOverlap(g, second, mask) < 0.6, `overlap ${f0(core.avenueOverlap(g, second, mask) * 100)} %, lengths ${f0(first.lengthM)} m and ${f0(second.lengthM)} m`);

  // a better position: the point sits 180 m behind a 15 m rise that hides the ground to the north
  const res20 = core.mPerPx(20, core.Z);
  g = synth(W, W, 20, (x, y) => 100 + 15 * Math.exp(-(((cy - 180 / res20) - y) ** 2) / (2 * (50 / res20) ** 2)));
  const bp = core.betterPosition(g, cx, cy, { eyeM: 1.6, targetM: 1.7, radiusM: 600, effM: 600, tolM: 1, tables: null, going, threatDeg: 0, sectorDeg: 90, searchM: 300 });
  check('better position: it finds the rise in front, with better fields of fire than the point', !!bp && core.bearingDiff(bp.bearingDeg, 0) <= 30 && bp.distanceM >= 120 && bp.distanceM <= 300 && bp.higherM > 5 && { good: 2, marginal: 1, poor: 0 }[bp.fire.grade] > { good: 2, marginal: 1, poor: 0 }[bp.here.grade], bp ? `${f0(bp.distanceM)} m at ${f0(bp.bearingDeg)} deg, ${f0(bp.higherM)} m higher: ${bp.here.grade} (${f0(bp.here.seenPct)} % seen) becomes ${bp.fire.grade} (${f0(bp.fire.seenPct)} %)` : 'none found');
  g = synth(W, W, 20, () => 100);
  check('better position: on a flat plain there is none to offer', core.betterPosition(g, cx, cy, { eyeM: 1.6, targetM: 1.7, radiusM: 600, effM: 600, tolM: 1, tables: null, going, threatDeg: 0, sectorDeg: 90, searchM: 300 }) === null);
}

// ================================================================================================ B. light
say('\nB. Light (sun and moon from date, time and place)');
{
  const lat = 31.55, lon = 74.35;
  const maxAlt = (y, mo, d) => { let b = -90; for (let h = 0; h < 24; h += 0.05) b = Math.max(b, core.sunAltitude(new Date(Date.UTC(y, mo - 1, d, 0, 0) + h * 3600000), lat, lon)); return b; };
  const eq = maxAlt(2026, 3, 20), su = maxAlt(2026, 6, 21), wi = maxAlt(2026, 12, 21);
  check('sun at noon: 90 - latitude at the equinox, +/- 23.4 at the solstices', Math.abs(eq - (90 - lat)) < 1 && Math.abs(su - (90 - lat + 23.44)) < 1 && Math.abs(wi - (90 - lat - 23.44)) < 1, `${f1(eq)} / ${f1(su)} / ${f1(wi)} deg, expected ${f1(90 - lat)} / ${f1(90 - lat + 23.44)} / ${f1(90 - lat - 23.44)}`);
  const nm = core.moonState(new Date(Date.UTC(2026, 10, 9, 7, 0)), lat, lon), fm = core.moonState(new Date(Date.UTC(2026, 10, 24, 15, 0)), lat, lon), fq = core.moonState(new Date(Date.UTC(2026, 10, 17, 14, 0)), lat, lon);
  check('moon of November 2026: new on the 9th, first quarter on the 17th, full on the 24th', nm.illum < 0.03 && fq.illum > 0.4 && fq.illum < 0.6 && fm.illum > 0.97, `lit ${f1(nm.illum * 100)} % / ${f1(fq.illum * 100)} % / ${f1(fm.illum * 100)} %`);
  const noon = core.lightAt(new Date(Date.UTC(2026, 10, 10, 7, 0)), lat, lon), night = core.lightAt(new Date(Date.UTC(2026, 10, 10, 22, 0)), lat, lon);
  check('Lahore noon is day; 03:00 on 11 November (new moon) is starlight', noon.level === 'day' && night.level === 'starlight', `${noon.level}, ${night.level}`);
  const nNew = core.nightOf(new Date(Date.UTC(2026, 10, 9, 12, 0)), lat, lon), nFull = core.nightOf(new Date(Date.UTC(2026, 10, 24, 12, 0)), lat, lon);
  check('the night of the new moon is a starlight night, the night of the full moon a moonlight night', nNew.level === 'starlight' && nFull.level === 'moonlight', `moonlit share of the dark hours ${f0(nNew.moonlitShare * 100)} % / ${f0(nFull.moonlitShare * 100)} %`);
}

// ================================================================================================ C. real sites
say('\nC. Real sites on the bundle');
async function pickInTile(tx, ty, better) {
  const g = await core.loadGrid(fsSource, ...core.pxToLonLat(tx * 256 + 128, ty * 256 + 128, core.Z), 200);
  let best = -1, bv = null;
  for (let y = 20; y < g.h - 20; y++) for (let x = 20; x < g.w - 20; x++) {
    const i = y * g.w + x, e = g.elev[i];
    if (e !== e) continue;
    const v = better(e, g.cls[i]);
    if (v !== null && (bv === null || v > bv)) { bv = v; best = i; }
  }
  const x = best % g.w, y = (best - x) / g.w;
  return core.pxToLonLat(g.px0 + x + 0.5, g.py0 + y + 0.5, core.Z);
}
const [mgLon, mgLat] = await pickInTile(2879, 1639, (e) => e);
const [vlLon, vlLat] = await pickInTile(2879, 1639, (e, c) => (c === 0 || c === 2 || c === 12 ? -e : null));
// open farmland: the cell with the most cropland and the fewest buildings within 2 km, somewhere in a block of the Punjab plain
let farmLon = 0, farmLat = 0;
{
  const g = await core.loadGrid(fsSource, 72.9, 30.9, 9000);
  const W2 = g.w, win = 60;
  const crop = new Float64Array(W2 * g.h), built = new Float64Array(W2 * g.h), tree = new Float64Array(W2 * g.h);
  for (let y = 0; y < g.h; y++) { let rc = 0, rb = 0, rt = 0; for (let x = 0; x < W2; x++) { const c = g.cls[y * W2 + x]; rc += c === 2 || c === 23 ? 1 : 0; rb += g.bld[y * W2 + x] ? 1 : 0; rt += c === 1 || c === 30 || c === 31 ? 1 : 0; crop[y * W2 + x] = rc + (y ? crop[(y - 1) * W2 + x] : 0); built[y * W2 + x] = rb + (y ? built[(y - 1) * W2 + x] : 0); tree[y * W2 + x] = rt + (y ? tree[(y - 1) * W2 + x] : 0); } }
  const box = (a, x, y) => a[(y + win) * W2 + x + win] - a[(y - win - 1) * W2 + x + win] - a[(y + win) * W2 + x - win - 1] + a[(y - win - 1) * W2 + x - win - 1];
  let best = -1e9, bx = 0, byy = 0;
  for (let y = win + 2; y < g.h - win - 2; y += 4) for (let x = win + 2; x < W2 - win - 2; x += 4) { const c = g.cls[y * W2 + x]; if (c !== 2 && c !== 23) continue; const v = box(crop, x, y) - 3 * box(built, x, y) - 3 * box(tree, x, y); if (v > best) { best = v; bx = x; byy = y; } }
  [farmLon, farmLat] = core.pxToLonLat(g.px0 + bx + 0.5, g.py0 + byy + 0.5, core.Z);
}
const lahore = await core.loadGrid(fsSource, 74.35, 31.55, 600);
let canalAt = null;
{
  const [ox, oy] = core.gridXY(lahore, 74.35, 31.55);
  let bd = 1e9;
  for (let y = 0; y < lahore.h; y++) for (let x = 0; x < lahore.w; x++) if (lahore.cls[y * lahore.w + x] === 20) { const d = Math.hypot(x - ox, y - oy); if (d < bd) { bd = d; canalAt = [x, y]; } }
}
const [cLon, cLat] = core.pxToLonLat(lahore.px0 + canalAt[0] + 0.5, lahore.py0 + canalAt[1] + 0.5, core.Z);
const sites = [
  { id: 'Margalla crest', lon: mgLon, lat: mgLat },
  { id: 'Islamabad valley floor', lon: vlLon, lat: vlLat },
  { id: 'Cholistan flat', lon: 71.9, lat: 28.2 },
  { id: 'Lahore centre', lon: 74.3436, lat: 31.5497 },
  { id: 'Lahore canal bank', lon: cLon + 0.0012, lat: cLat, threat: 'canal' },
  { id: 'Punjab farmland', lon: farmLon, lat: farmLat },
  { id: 'Skardu valley', lon: 75.63, lat: 35.3 },
  { id: 'Quetta', lon: 67.0, lat: 30.19 },
  { id: 'Karachi', lon: 67.01, lat: 24.86 },
];
const RADIUS = 5000;
function readSite(g, ox, oy, s, month, wkey, threat, quickRays = true) {
  const going = core.goingTable(rules, 'tracked');
  const T = core.sightTables(doctrine, month, g.res);
  const wp = weapon(wkey);
  const base = { eyeM: 1.6, targetM: wp.targetM, tolM: 1, tables: T, going };
  const all = core.analyseSight(g, ox, oy, core.bearingsFor(quickRays ? 2 : core.fineStep(RADIUS, g.res)), { ...base, radiusM: RADIUS, effM: wp.effM });
  const bands = core.newBands([0, 100, 300, 600, 1000, 2000]);
  const wedgeR = Math.min(RADIUS, Math.max(wp.effM, 600));
  const wedge = core.analyseSight(g, ox, oy, core.bearingsFor(core.fineStep(wedgeR, g.res), threat, 90), { ...base, radiusM: wedgeR, effM: wp.effM, bands });
  return { obs: core.observationOf(all), fire: core.fireOf(wedge, wp.effM, bands, fireRule), obst: core.obstacleFrontOf(wedge, wp.effM), ways: core.waysOut(g, ox, oy, going, 2000), dom: core.dominanceOf(g, ox, oy, 3000), weapon: wp };
}
const siteOut = [];
for (const s of sites) {
  const g = await core.loadGrid(fsSource, s.lon, s.lat, RADIUS + 1000);
  const [ox, oy] = core.gridXY(g, s.lon, s.lat);
  let threat = 0;
  if (s.threat === 'canal') {
    let bd = 1e9, cx = 0, cy = 0;
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.cls[y * g.w + x] === 20) { const d = Math.hypot(x - ox, y - oy); if (d < bd) { bd = d; cx = x; cy = y; } }
    threat = ((Math.atan2(cx - ox, -(cy - oy)) * 180) / Math.PI + 360) % 360;
  }
  const rifle = readSite(g, ox, oy, s, 11, '15110100', threat), tank = readSite(g, ox, oy, s, 11, '15120203', threat);
  const aug = readSite(g, ox, oy, s, 8, '15110100', threat);
  siteOut.push({ id: s.id, lon: +s.lon.toFixed(4), lat: +s.lat.toFixed(4), elevM: Math.round(core.elevAt(g, ox, oy)), threat: Math.round(threat), rifle, tank, augSeenPct: aug.obs.seenPct, augReachM: aug.obs.reachMedianM, vis: core.visibilityAt(vis, s.lon, s.lat, 12) });
}
say('  Seen % = of the ground within 5 km: on the ground alone / expected / sure.  November, standing man (eye 1.6 m), threat to the north (canal bank: toward the canal).');
say('  site                    elev | seen % alone/exp/sure | reach m | country    | rifle 300 m: grade, clear m, seen/dead/screened % | tank 2 km: grade, clear m, seen/dead/screened % | overlooked           | ways out GO/SLOW/stopped');
for (const r of siteOut) {
  const o = r.rifle.obs, fr = r.rifle.fire, ft = r.tank.fire, w = r.rifle.ways;
  const fire = (f) => `${f.grade.padEnd(8)} ${f0(f.clearMedianM).padStart(4)}  ${f0(f.seenPct).padStart(3)}/${f0(f.deadPct).padStart(3)}/${f0(f.screenedPct).padStart(3)}`;
  say(`  ${r.id.padEnd(23)} ${String(r.elevM).padStart(4)} | ${f0(o.terrainPct).padStart(3)} / ${f0(o.seenPct).padStart(3)} / ${f0(o.surePct).padStart(3)}       | ${f0(o.reachMedianM).padStart(5)}   | ${o.country.padEnd(10)} | ${fire(fr)}                    | ${fire(ft)}                  | ${(o.overlook ? `+${f0(o.overlook.riseM)} m at ${f0(o.overlook.distM)} m, ${f0(o.overlookArcPct)} % of arc` : 'no').padEnd(20)} | ${w.go}/${w.slow}/${w.blocked}`);
}
const by = Object.fromEntries(siteOut.map((r) => [r.id, r]));
say('  plausibility');
check('the crest sees more than the valley floor', by['Margalla crest'].rifle.obs.seenPct > by['Islamabad valley floor'].rifle.obs.seenPct, `${f0(by['Margalla crest'].rifle.obs.seenPct)} % against ${f0(by['Islamabad valley floor'].rifle.obs.seenPct)} %`);
check('the crest is open country with poor fields of fire (the slope below a summit is dead ground)', by['Margalla crest'].rifle.obs.country === 'open' && by['Margalla crest'].rifle.fire.grade === 'poor', `reach ${f0(by['Margalla crest'].rifle.obs.reachMedianM)} m, clear ${f0(by['Margalla crest'].rifle.fire.clearMedianM)} m, dead ground ${f0(by['Margalla crest'].rifle.fire.deadPct)} %`);
check('the valley floor is overlooked from most directions', by['Islamabad valley floor'].rifle.obs.overlookArcPct > 40 && !!by['Islamabad valley floor'].rifle.obs.overlook, `${f0(by['Islamabad valley floor'].rifle.obs.overlookArcPct)} % of the arc`);
check('Cholistan is open country', by['Cholistan flat'].rifle.obs.country === 'open', `reach ${f0(by['Cholistan flat'].rifle.obs.reachMedianM)} m`);
check('Lahore centre: the ground alone says open, the buildings make it close or very close country', by['Lahore centre'].rifle.obs.terrainPct > 3 * by['Lahore centre'].rifle.obs.seenPct && by['Lahore centre'].rifle.obs.country !== 'open', `${f0(by['Lahore centre'].rifle.obs.terrainPct)} % alone, ${f1(by['Lahore centre'].rifle.obs.seenPct)} % expected, reach ${f0(by['Lahore centre'].rifle.obs.reachMedianM)} m (${by['Lahore centre'].rifle.obs.country})`);
check('dense towns are very close country: the view ends within a block', ['Lahore centre', 'Karachi', 'Quetta'].every((k) => by[k].rifle.obs.country === 'veryClose'), ['Lahore centre', 'Karachi', 'Quetta'].map((k) => `${k} ${f0(by[k].rifle.obs.reachMedianM)} m`).join(', '));
check('farmland: less is seen in August (tall crops) than in November', by['Punjab farmland'].augSeenPct < by['Punjab farmland'].rifle.obs.seenPct, `August ${f1(by['Punjab farmland'].augSeenPct)} % (reach ${f0(by['Punjab farmland'].augReachM)} m), November ${f1(by['Punjab farmland'].rifle.obs.seenPct)} % (reach ${f0(by['Punjab farmland'].rifle.obs.reachMedianM)} m)`);
check('expected never exceeds what the ground alone allows, and sure never exceeds expected', siteOut.every((r) => r.rifle.obs.seenPct <= r.rifle.obs.terrainPct + 0.01 && r.rifle.obs.surePct <= r.rifle.obs.seenPct + 5));
check('seen + dead + screened ground inside the range make 100 %', siteOut.every((r) => Math.abs(r.tank.fire.seenPct + r.tank.fire.deadPct + r.tank.fire.screenedPct - 100) < 0.5));
check('canal bank: the canal is the nearest NO-GO toward it, inside rifle range', [4, 20, 21].includes(by['Lahore canal bank'].rifle.obst.nogoClass) && by['Lahore canal bank'].rifle.obst.inRange, `class ${by['Lahore canal bank'].rifle.obst.nogoClass} at ${f0(by['Lahore canal bank'].rifle.obst.nogoM)} m, chance seen ${f0(by['Lahore canal bank'].rifle.obst.seenP * 100)} %`);
check('the grade follows the weapon: a tank asks for more than a rifle on the same ground', siteOut.every((r) => ({ good: 2, marginal: 1, poor: 0 })[r.tank.fire.grade] <= ({ good: 2, marginal: 1, poor: 0 })[r.rifle.fire.grade] || r.tank.fire.clearMedianM > r.rifle.fire.clearMedianM));

// ================================================================================================ D. cost
say('\nD. Cost per call (Node 24 / V8, tiles in memory; the browser is within a factor of two)');
const timing = {};
for (const id of ['Margalla crest', 'Lahore centre']) {
  const s = sites.find((x) => x.id === id);
  const g = await core.loadGrid(fsSource, s.lon, s.lat, 11000);
  const [ox, oy] = core.gridXY(g, s.lon, s.lat);
  const going = core.goingTable(rules, 'tracked'), T = core.sightTables(doctrine, 11, g.res);
  const o = (radiusM, effM) => ({ eyeM: 1.6, targetM: 1.7, radiusM, effM, tolM: 1, tables: T, going });
  const n = quick ? 60 : 200;
  const cases = [
    ['fire wedge 90 deg to 600 m (rifle)', () => core.analyseSight(g, ox, oy, core.bearingsFor(core.fineStep(600, g.res), 0, 90), { ...o(600, 300), bands: core.newBands([0, 100, 300, 600]) })],
    ['fire wedge 90 deg to 2 km (tank)', () => core.analyseSight(g, ox, oy, core.bearingsFor(core.fineStep(2000, g.res), 0, 90), { ...o(2000, 2000), bands: core.newBands([0, 100, 300, 600, 1000, 2000]) })],
    ['observation all round, 2 deg, to 5 km', () => core.analyseSight(g, ox, oy, core.bearingsFor(2), o(5000, 2000))],
    ['straight ways out, 24 sectors to 2 km', () => core.waysOut(g, ox, oy, going, 2000)],
    ['highest ground within 3 km', () => core.dominanceOf(g, ox, oy, 3000)],
    ['sight to 3 ITG candidates 3 km away', () => { for (const b of [0, 120, 240]) core.sightTo(g, ox, oy, ox + Math.sin(b) * 3000 / g.res, oy - Math.cos(b) * 3000 / g.res, o(3000, 0)); }],
    ['picture: all round, fine, to 5 km, with the trace', () => { const b = core.bearingsFor(core.fineStep(5000, g.res)); core.analyseSight(g, ox, oy, b, { ...o(5000, 2000), trace: new Uint8Array(b.length * Math.floor(5000 / g.res)) }); }],
    ['going flood to 5 km (ways round)', () => core.goReach(g, ox, oy, going, 5000)],
    ['sight tables for a month', () => core.sightTables(doctrine, 8, g.res)],
    ['map: avenue from 4 km east, 300 m frontage', () => core.findAvenue(g, ox + 4000 / g.res, oy, ox, oy, { going, frontageM: 300 })],
    ['map: better position within 300 m', () => core.betterPosition(g, ox, oy, { ...o(2000, 2000), threatDeg: 0, sectorDeg: 90, searchM: 300 })],
    ['map: fan runs of the tank wedge', () => { const bb = core.bearingsFor(core.fineStep(2000, g.res), 0, 90); const st2 = Math.floor(2000 / g.res); const t1 = new Uint8Array(bb.length * st2), t2 = new Uint8Array(bb.length * st2); core.analyseSight(g, ox, oy, bb, { ...o(2000, 2000), trace: t1, traceTerrain: t2 }); core.sightRuns(t1, t2, bb.length, st2, g.res, 2000); }],
  ];
  say(`  ${id}`);
  timing[id] = {};
  let move = 0;
  for (const [name, fn] of cases) {
    const b = bench(fn, n);
    timing[id][name] = b;
    if (cases.indexOf(cases.find((c) => c[0] === name)) < 6 && name !== 'fire wedge 90 deg to 600 m (rifle)') move += b.median;
    say(`    ${name.padEnd(46)} median ${b.median.toFixed(2).padStart(6)} ms   p95 ${b.p95.toFixed(2).padStart(6)} ms`);
  }
  timing[id].perMove = move;
  say(`    = every mouse move (tank wedge + observation + ways + highest ground + 3 sight lines): ${move.toFixed(2)} ms`);
}
{
  const s = sites.find((x) => x.id === 'Lahore centre');
  const peekAll = new Map(tileCache);
  const [cx, cy] = core.lonLatToPx(s.lon, s.lat, core.Z);
  const rp = 6000 / core.mPerPx(s.lat, core.Z);
  const b = bench(() => core.buildGrid((l, x, y) => peekAll.get(`${l}/${x}/${y}`) ?? null, core.LAYERS, core.Z, 256, s.lat, cx, cy, rp), quick ? 20 : 60);
  timing.buildGridMs = b.median;
  say(`  laying the tiles for a 6 km circle side by side (once per few km of cursor travel): median ${b.median.toFixed(1)} ms`);
}
check('everything the cursor card needs fits a mouse move (under 4 ms in Node)', timing['Margalla crest'].perMove < 4 && timing['Lahore centre'].perMove < 4, `${timing['Margalla crest'].perMove.toFixed(2)} ms hills, ${timing['Lahore centre'].perMove.toFixed(2)} ms town`);
check('the fine picture fits a Detail refresh (under 20 ms)', timing['Margalla crest']['picture: all round, fine, to 5 km, with the trace'].median < 20, `${timing['Margalla crest']['picture: all round, fine, to 5 km, with the trace'].median.toFixed(1)} ms`);

// ================================================================================================ E. independent cross-check
say('\nE. Cross-check against an independent implementation (Python, probes every sixth of a pixel, same tiles, ground alone)');
{
  const s0 = sites.find((x) => x.id === 'Margalla crest');
  const g = await core.loadGrid(fsSource, s0.lon, s0.lat, 4000);
  const [ox, oy] = core.gridXY(g, s0.lon, s0.lat);
  const py = resolve(repo, 'tools/terrain-pipeline/.venv/Scripts/python.exe');
  const cross = {};
  for (const stepPx of [1, 0.5]) {
    const bear = core.bearingsFor(15), radiusM = 3500;
    const steps = Math.max(1, Math.floor(radiusM / (g.res * stepPx)));
    const trace = new Uint8Array(bear.length * steps);
    core.analyseSight(g, ox, oy, bear, { eyeM: 1.6, targetM: 1.7, radiusM, effM: 1000, tolM: 0.001, tables: null, stepPx, trace });
    const flags = Array.from(trace, (v) => (v === 255 ? 2 : v >= 125 ? 1 : 0));
    writeFileSync(resolve(here, 'crosscheck-input.json'), JSON.stringify({ bundle, tx0: g.tx0, ty0: g.ty0, nx: g.nx, ny: g.ny, ox, oy, res: g.res, eyeM: 1.6, targetM: 1.7, k: 0.13, steps, stepPx, bearings: Array.from(bear), trace: flags }));
    if (!existsSync(py)) { say('  (pipeline Python not found: skipped)'); break; }
    const p = spawnSync(py, [resolve(here, 'crosscheck.py'), resolve(here, 'crosscheck-input.json')], { encoding: 'utf8' });
    if (p.status !== 0) { check('Python cross-check ran', false, (p.stderr || '').slice(-300)); break; }
    const j = JSON.parse(p.stdout);
    cross[stepPx] = j;
    say(`  step ${stepPx} px: ${j.samples} samples on ${bear.length} rays: ${j.agree} agree; engine seen / reference hidden ${j.tsSeenRefHidden}, engine hidden / reference seen ${j.tsHiddenRefSeen}`);
  }
  if (cross[1]) check('step 1 px agrees with the independent check on 98 % or more of the samples', cross[1].agreePct >= 98, `${cross[1].agreePct.toFixed(2)} %`);
  if (cross[0.5]) check('step 0.5 px agrees on 99.5 % or more', cross[0.5].agreePct >= 99.5, `${cross[0.5].agreePct.toFixed(2)} %`);
  results.push({ name: 'crosscheck', detail: cross });
}

const total = results.filter((r) => r.ok !== undefined).length;
say(`\n${total - failures} of ${total} checks passed${failures ? `, ${failures} FAILED` : ''}.`);
writeFileSync(resolve(here, 'last-run.json'), JSON.stringify({ when: new Date().toISOString(), node: process.version, results, sites: siteOut, timing }, null, 1));
writeFileSync(resolve(here, 'last-run.txt'), out.join('\n') + '\n');
process.exit(failures ? 1 : 0);
