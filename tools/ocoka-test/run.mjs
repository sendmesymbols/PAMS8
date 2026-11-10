// run.mjs -- OCOKA lens test program, command-line half.
//   node tools/ocoka-test/run.mjs [--quick]
// Node 24 runs the TypeScript core directly. Needs MS/Data/terrain-bundle (tiles, rules.json, visibility/).
// Writes tools/ocoka-test/last-run.json and prints a report. Exit code 1 when a check fails.
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

// ------------------------------------------------------------------------------------------------ PNG (8-bit gray) + sources
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
let tileReads = 0;
const fsSource = async (layer, x, y) => {
  const key = `${layer}/${x}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const f = `${bundle}/${layer}/${core.Z}/${x}/${y}.png`;
  tileReads++;
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
const rng = (key) => symbols[key].Rng;

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
  return { median: t[n >> 1], p95: t[Math.floor(n * 0.95)], mean: t.reduce((a, b) => a + b, 0) / n };
}

// ------------------------------------------------------------------------------------------------ synthetic mosaics
function synth(w, h, lat, elevFn, classFn) {
  const res = core.mPerPx(lat);
  const elev = new Float32Array(w * h), cls = new Uint8Array(w * h), cc = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { elev[y * w + x] = elevFn(x, y, res); cls[y * w + x] = classFn ? classFn(x, y) : 0; }
  return { tx0: 0, ty0: 0, nx: w / 256, ny: h / 256, w, h, px0: 0, py0: 0, lat, res, layers: { class: cls, cc }, elev };
}
const noBlk = core.blockerTable(doctrine, 'none', 11);
const baseOpts = (o = {}) => ({ eyeM: 2, targetM: 1.7, radiusM: 5000, noiseM: 0, k: 0.13, blk: noBlk, effM: 2000, ...o });

say('OCOKA lens test program');
say(`bundle ${bundle}`);
say(`node ${process.version}${quick ? '  (--quick)' : ''}`);

// ================================================================================================ A. synthetic geometry
say('\nA. Synthetic geometry (the sight engine against cases with a known answer)');
{
  const W = 1024;
  const cx = 512.5, cy = 512.5;
  // A1 flat plain
  let m = synth(W, W, 0, () => 100);
  let r = core.analyseRays(m, cx, cy, core.bearingsFor(5), baseOpts());
  check('flat plain: every ray clear to 5 km', Math.min(...r.clear) >= 4900, `min clear ${f0(Math.min(...r.clear))} m`);
  const ob = core.observationOf(r);
  check('flat plain: 100 % of the ground seen', ob.seenPct > 99.5, `${f1(ob.seenPct)} %`);
  // A2 ridge 1 km north
  const res0 = core.mPerPx(0);
  m = synth(W, W, 0, (x, y) => 100 + 20 * Math.exp(-(((cy - 1000 / res0) - y) ** 2) / (2 * (60 / res0) ** 2)));
  r = core.analyseRays(m, cx, cy, Float32Array.from([0, 90, 180, 270]), baseOpts());
  check('20 m ridge 1 km north: sight to the north ends at the ridge', r.clear[0] > 800 && r.clear[0] < 1100, `clear ${f0(r.clear[0])} m`);
  check('20 m ridge: nothing hides the other three directions', r.clear[1] >= 4900 && r.clear[2] >= 4900 && r.clear[3] >= 4900);
  const ob2 = core.observationOf(core.analyseRays(m, cx, cy, core.bearingsFor(5), baseOpts()));
  check('20 m ridge: less than the whole ground is seen', ob2.seenPct < 95 && ob2.seenPct > 60, `${f1(ob2.seenPct)} %`);
  // A3 curvature
  m = synth(W, W, 0, () => 0);
  r = core.analyseRays(m, cx, cy, Float32Array.from([0]), baseOpts({ radiusM: 14000, eyeM: 2, targetM: 1.7 }));
  const Reff = 6371008.8 / (1 - 0.13);
  const expect = Math.sqrt(2 * Reff * 2) + Math.sqrt(2 * Reff * 1.7);
  check('earth curvature: first hidden near the radio-horizon sum for eye 2 m + target 1.7 m', Math.abs(r.clear[0] - expect) < 120, `${f0(r.clear[0])} m, expected ${f0(expect)} m`);
  // A4 mutual visibility (A sees B iff B sees A), random smooth terrain, exact sample alignment on the east axis
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const terms = Array.from({ length: 12 }, () => ({ ax: rnd() * 0.02 + 0.003, ay: rnd() * 0.02 + 0.003, p: rnd() * 6.28, q: rnd() * 6.28, a: rnd() * 14 }));
  m = synth(W, W, 20, (x, y) => 300 + terms.reduce((s, t) => s + t.a * Math.sin(x * t.ax + t.p) * Math.cos(y * t.ay + t.q), 0));
  let pairs = 0, agree = 0, seen = 0;
  for (let i = 0; i < 600; i++) {
    const ax = 200 + Math.floor(rnd() * 300) + 0.5, ay = 200 + Math.floor(rnd() * 600) + 0.5, s = 5 + Math.floor(rnd() * 150);
    const o1 = baseOpts({ radiusM: (s + 1) * m.res, eyeM: 2, targetM: 2, trace: new Uint8Array(s + 2) });
    core.analyseRays(m, ax, ay, Float32Array.from([90]), o1);
    const o2 = baseOpts({ radiusM: (s + 1) * m.res, eyeM: 2, targetM: 2, trace: new Uint8Array(s + 2) });
    core.analyseRays(m, ax + s, ay, Float32Array.from([270]), o2);
    const ab = o1.trace[s - 1], ba = o2.trace[s - 1];
    pairs++; if (ab === ba) agree++; if (ab === 1) seen++;
  }
  check('mutual visibility: A sees B exactly when B sees A', agree === pairs, `${agree}/${pairs} pairs agree (${seen} of them see each other)`);
  // A5 noise floor
  m = synth(W, W, 0, (x, y) => 100 + (Math.abs(y - (cy - 600 / res0)) < 2 ? 0.8 : 0));
  const hidden = (noise) => core.analyseRays(m, cx, cy, Float32Array.from([0]), baseOpts({ radiusM: 4000, noiseM: noise, targetM: 0.4 })).clear[0] < 3900;
  check('noise floor: a 0.8 m step hides a prone man with no floor, not with a 1 m floor', hidden(0) && !hidden(1.0));
  // A6 class blocker
  const cls = (x, y) => (Math.abs(y - (cy - 400 / res0)) < 2 ? 25 : 0);
  m = synth(W, W, 0, () => 100, cls);
  const blk = core.blockerTable(doctrine, 'max', 11);
  const withB = core.analyseRays(m, cx, cy, Float32Array.from([0]), baseOpts({ blk, radiusM: 3000, targetM: 0.4 })).clear[0];
  const without = core.analyseRays(m, cx, cy, Float32Array.from([0]), baseOpts({ radiusM: 3000, targetM: 0.4 })).clear[0];
  check('a bund (class 25, 1-2 m) hides a prone man behind it, the bare DEM does not', withB < 500 && without >= 2900, `with ${f0(withB)} m, without ${f0(without)} m`);
  // A7a patchy blockers: tall crops by the month's crop mix, built-up by building density
  const tallAug = core.cropTallShare(doctrine, 8), tallApr = core.cropTallShare(doctrine, 4);
  check('crop mix: a share of the cropland is tall in August, none in April', tallAug > 0.1 && tallAug < 0.3 && tallApr === 0, `August ${f1(tallAug * 100)} %, April ${f1(tallApr * 100)} %`);
  const field = synth(W, W, 20, () => 200, () => 2);
  // one observer standing inside a tall patch sees nothing, which is right: so take the median over 40 observer positions
  const obsIn = (month) => {
    const reach = [], seen = [];
    for (let i = 0; i < 40; i++) {
      const o = core.observationOf(core.analyseRays(field, 200.5 + (i % 8) * 70, 200.5 + Math.floor(i / 8) * 90, core.bearingsFor(3), baseOpts({ eyeM: 1.6, blk: core.blockerTable(doctrine, 'max', month) })));
      reach.push(o.reachMedianM); seen.push(o.seenPct);
    }
    reach.sort((x, y) => x - y); seen.sort((x, y) => x - y);
    return { reachMedianM: reach[20], seenPct: seen[20], country: reach[20] <= 200 ? 'veryClose' : reach[20] <= 500 ? 'close' : 'open' };
  };
  const oAug = obsIn(8), oApr = obsIn(4);
  check('a cropland plain: the view reaches farther in April (nothing tall) than in August (16 % tall) and August is not a blank wall (median of 40 positions)', oApr.reachMedianM > oAug.reachMedianM && oAug.reachMedianM > 100, `April reach ${f0(oApr.reachMedianM)} m, August reach ${f0(oAug.reachMedianM)} m (${oAug.country}), August ${f1(oAug.seenPct)} % of the ground seen`);
  const town = synth(W, W, 20, () => 200, () => 3);
  town.layers.bld = new Uint8Array(W * W).fill(4);         // building density class 4 (300-1000 per km2)
  const rTown = core.observationOf(core.analyseRays(town, cx, cy, core.bearingsFor(2), baseOpts({ eyeM: 1.6, radiusM: 3000, blk: core.blockerTable(doctrine, 'max', 11) })));
  check('a medium-density town is very close or close country', rTown.country !== 'open', `${rTown.country}, reach median ${f0(rTown.reachMedianM)} m, ${f1(rTown.seenPct)} % seen`);
  // A7 going flood: a canal line stops the flood, a gap lets it through
  const going = core.goingTable(rules, 'tracked');
  const wall = (x, y) => (Math.abs(x - (cx + 600 / res0)) < 2 ? 20 : 0);
  m = synth(W, W, 0, () => 100, wall);
  let gr = core.goReach(m, cx, cy, going, 3000, 2500);
  check('canal across the east: the flood stops short of it', gr.sectorM[6] < 700, `east sector reaches ${f0(gr.sectorM[6])} m`);
  const gap = (x, y) => (Math.abs(x - (cx + 600 / res0)) < 2 && Math.abs(y - cy) > 20 ? 20 : 0);
  m = synth(W, W, 0, () => 100, gap);
  gr = core.goReach(m, cx, cy, going, 3000, 2500);
  check('canal with a gap: the flood goes through it', gr.sectorM[6] > 2000, `east sector reaches ${f0(gr.sectorM[6])} m`);
}

// ================================================================================================ B. sun and moon
say('\nB. Light (sun and moon, calculated from date, time and place)');
{
  const lat = 31.55, lon = 74.35;
  const maxAlt = (y, mo, d) => { let b = -90; for (let h = 0; h < 24; h += 0.05) b = Math.max(b, core.sunAltitude(new Date(Date.UTC(y, mo - 1, d, 0, 0) + h * 3600000), lat, lon)); return b; };
  const eq = maxAlt(2026, 3, 20), su = maxAlt(2026, 6, 21), wi = maxAlt(2026, 12, 21);
  check('sun at the March equinox: noon altitude 90 - latitude', Math.abs(eq - (90 - lat)) < 1, `${f1(eq)} deg, expected ${f1(90 - lat)}`);
  check('sun at the June solstice: 90 - latitude + 23.4', Math.abs(su - (90 - lat + 23.44)) < 1, `${f1(su)} deg, expected ${f1(90 - lat + 23.44)}`);
  check('sun at the December solstice: 90 - latitude - 23.4', Math.abs(wi - (90 - lat - 23.44)) < 1, `${f1(wi)} deg, expected ${f1(90 - lat - 23.44)}`);
  const nm = core.moonState(new Date(Date.UTC(2026, 10, 9, 7, 0)), lat, lon), fm = core.moonState(new Date(Date.UTC(2026, 10, 24, 15, 0)), lat, lon), fq = core.moonState(new Date(Date.UTC(2026, 10, 17, 14, 0)), lat, lon);
  check('new moon of 9 Nov 2026 is nearly dark', nm.illum < 0.03, `illuminated ${f1(nm.illum * 100)} %`);
  check('full moon of 24 Nov 2026 is nearly full', fm.illum > 0.97, `illuminated ${f1(fm.illum * 100)} %`);
  check('first quarter of 17 Nov 2026 is about half', fq.illum > 0.4 && fq.illum < 0.6, `illuminated ${f1(fq.illum * 100)} %`);
  const noon = core.lightAt(new Date(Date.UTC(2026, 10, 10, 7, 0)), lat, lon), night = core.lightAt(new Date(Date.UTC(2026, 10, 10, 22, 0)), lat, lon);
  check('Lahore noon is day', noon.level === 'day', noon.level);
  check('Lahore 03:00 on 11 Nov (new moon) is starlight', night.level === 'starlight', `${night.level}, moon ${f1(night.moonIllum * 100)} % lit, ${f1(night.moonAltDeg)} deg`);
  let moonlit = false;
  for (let h = 0; h < 24 && !moonlit; h += 0.25) moonlit = core.lightAt(new Date(Date.UTC(2026, 10, 24, 12, 0) + h * 3600000), lat, lon).level === 'moonlight';
  check('around the full moon of 24 Nov there is moonlight at night', moonlit);
}

// ================================================================================================ C. real sites
say('\nC. Real sites on the bundle (what the lens would say, with the DEM alone and with the doctrine blockers)');
const sites = [];
async function pickInTile(tx, ty, better, layers = ['class']) {
  const m = await core.loadMosaic(fsSource, ...core.pxToLonLat(tx * 256 + 128, ty * 256 + 128), 200, layers);
  const cls = m.layers['class'];
  let best = -1, bv = null;
  for (let y = 20; y < m.h - 20; y++) for (let x = 20; x < m.w - 20; x++) {
    const i = y * m.w + x, e = m.elev[i];
    if (e !== e) continue;
    const v = better(e, cls[i], x, y, m);
    if (v !== null && (bv === null || v > bv)) { bv = v; best = i; }
  }
  const x = best % m.w, y = (best - x) / m.w;
  return core.pxToLonLat(m.px0 + x + 0.5, m.py0 + y + 0.5);
}
const [mgLon, mgLat] = await pickInTile(2879, 1639, (e) => e);                                  // highest ground of the Margalla tile
const [vlLon, vlLat] = await pickInTile(2879, 1639, (e, c) => (c === 0 || c === 2 || c === 12 ? -e : null));   // lowest open / cropland there
const lahCell = await core.loadMosaic(fsSource, 74.35, 31.55, 600, ['class', 'cc']);
let canalAt = null;
{
  const [ox, oy] = core.mosaicXY(lahCell, 74.35, 31.55);
  const cls = lahCell.layers['class'];
  let bd = 1e9;
  for (let y = 0; y < lahCell.h; y++) for (let x = 0; x < lahCell.w; x++) if (cls[y * lahCell.w + x] === 20) { const d = Math.hypot(x - ox, y - oy); if (d < bd) { bd = d; canalAt = [x, y]; } }
}
sites.push({ id: 'Margalla crest', lon: mgLon, lat: mgLat, want: 'wide view, not overlooked' });
sites.push({ id: 'Islamabad valley floor', lon: vlLon, lat: vlLat, want: 'short view, overlooked by the hills' });
sites.push({ id: 'Cholistan flat', lon: 71.9, lat: 28.2, want: 'open country, long clear sight' });
sites.push({ id: 'Lahore centre', lon: 74.3436, lat: 31.5497, want: 'very close country' });
{
  const [cLon, cLat] = core.pxToLonLat(lahCell.px0 + canalAt[0] + 0.5, lahCell.py0 + canalAt[1] + 0.5);
  sites.push({ id: 'Lahore canal bank', lon: cLon + 0.0012, lat: cLat, want: 'a canal in front, covered by fire?', threat: 'canal' });
}
sites.push({ id: 'Skardu valley', lon: 75.63, lat: 35.3, want: 'mountain valley, overlooked' });
sites.push({ id: 'Quetta', lon: 67.0, lat: 30.19, want: 'valley floor ringed by hills' });
sites.push({ id: 'Karachi', lon: 67.01, lat: 24.86, want: 'built-up coastal plain' });

const siteOut = [];
const weaponKeys = [['rifle', '15110100', 'dir'], ['tank', '15120203', 'at']];
for (const s of sites) {
  const m = await core.loadMosaic(fsSource, s.lon, s.lat, 6000, ['class', 'cc', 'bld']);
  const [ox, oy] = core.mosaicXY(m, s.lon, s.lat);
  const step = core.raysFor(5000, m.res);
  const all = core.bearingsFor(step);
  const going = core.goingTable(rules, 'tracked');
  let threat = 0;
  if (s.threat === 'canal') {
    const cls = m.layers['class'];
    let bd = 1e9, cx = 0, cy = 0;
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (cls[y * m.w + x] === 20) { const d = Math.hypot(x - ox, y - oy); if (d < bd) { bd = d; cx = x; cy = y; } }
    threat = ((Math.atan2(cx - ox, -(cy - oy)) * 180) / Math.PI + 360) % 360;
  }
  const row = { id: s.id, lon: +s.lon.toFixed(4), lat: +s.lat.toFixed(4), elevM: null, want: s.want, threat: +threat.toFixed(0), modes: {} };
  const sec = { centreDeg: threat, halfDeg: 45 };
  for (const mode of ['none', 'mid', 'max']) {
    const blk = core.blockerTable(doctrine, mode, 11);
    const r = core.analyseRays(m, ox, oy, all, { eyeM: 1.6, targetM: 1.7, radiusM: 5000, noiseM: 1.0, k: 0.13, blk, going, effM: 2000 });
    const o = core.observationOf(r);
    const fofR = core.fieldOfFireOf(r, sec, rng('15110100').dir[1]);
    const fofT = core.fieldOfFireOf(r, sec, rng('15120203').at[1]);
    const ob = core.obstacleFrontOf(r, sec, rng('15120203').at[1]);
    row.elevM = Math.round(r.elev0);
    row.modes[mode] = { seenPct: +o.seenPct.toFixed(1), clearMedianM: Math.round(o.clearMedianM), reachMedianM: Math.round(o.reachMedianM), country: o.country, overlook: o.overlook, rifle: fofR, tank: fofT, obst: ob, rays: r.n, samples: r.samples };
  }
  const gr = core.goReach(m, ox, oy, going, 5000, 2000);
  const dom = core.dominanceOf(m, ox, oy, 3000);
  row.goReach = { reachPct: +gr.reachPct.toFixed(0), waysOut: gr.waysOut };
  row.dominance = dom;
  row.cover = core.coverAt(m, ox, oy, rules, doctrine, 11);
  row.visibility = core.visibilityAt(vis, s.lon, s.lat, 12);
  siteOut.push(row);
}
say('  Each figure is given for the bare DEM (upper bound) / the middle blocker heights (central case) / the tallest blockers (lower bound).');
say('  site                       elev | % of ground seen    | median reach m        | country                      | rifle: dead ground %     | tank FoF (mid) | overlooked by (mid) | above highest in 3 km | ways out');
for (const r of siteOut) {
  const a = r.modes.none, c = r.modes.mid, b = r.modes.max;
  const tri = (k, w) => [a, c, b].map((x) => f0(x[k]).padStart(w)).join(' / ');
  say(`  ${r.id.padEnd(26)} ${String(r.elevM).padStart(4)} | ${tri('seenPct', 3)}      | ${tri('reachMedianM', 5)} | ${(a.country + ' / ' + c.country + ' / ' + b.country).padEnd(28)} | ${[a, c, b].map((x) => f0(x.rifle.deadPct).padStart(3)).join(' / ')} (rifle ${rng('15110100').dir[1]} m) | ${c.tank.grade.padEnd(8)} | ${c.overlook ? '+' + f0(c.overlook.riseM) + ' m at ' + f0(c.overlook.distM) + ' m' : 'no'} | ${f0(r.dominance.aboveMaxM)} m | ${r.goReach.waysOut}/24 direct`);
}
const by = Object.fromEntries(siteOut.map((r) => [r.id, r]));
say('  plausibility checks');
check('crest sees more than the valley floor', by['Margalla crest'].modes.max.seenPct > by['Islamabad valley floor'].modes.max.seenPct, `${f0(by['Margalla crest'].modes.max.seenPct)} % against ${f0(by['Islamabad valley floor'].modes.max.seenPct)} %`);
check('the crest stands higher in its surroundings than the valley floor', by['Margalla crest'].dominance.aboveMaxM > by['Islamabad valley floor'].dominance.aboveMaxM + 50, `${f0(by['Margalla crest'].dominance.aboveMaxM)} m against ${f0(by['Islamabad valley floor'].dominance.aboveMaxM)} m from the highest ground within 3 km`);
check('a summit is not called close country: the view reaches far even though the slope below it is dead ground', by['Margalla crest'].modes.max.country === 'open', `reach median ${f0(by['Margalla crest'].modes.max.reachMedianM)} m, clear median ${f0(by['Margalla crest'].modes.max.clearMedianM)} m`);
const openSites = siteOut.filter((r) => /Margalla|Cholistan|Skardu/.test(r.id));
check('on open or mountain ground the tallest blockers still leave a view (3 % or more of the ground seen)', openSites.every((r) => r.modes.max.seenPct >= 3), openSites.map((r) => `${r.id} ${f0(r.modes.max.seenPct)} %`).join(', '));
check('the three cases keep their order (DEM >= middle >= tallest) at every site', siteOut.every((r) => r.modes.none.seenPct >= r.modes.mid.seenPct - 0.5 && r.modes.mid.seenPct >= r.modes.max.seenPct - 0.5));
check('the valley floor is overlooked by high ground (15 m or more above it in view)', !!by['Islamabad valley floor'].modes.max.overlook, by['Islamabad valley floor'].modes.max.overlook ? `+${f0(by['Islamabad valley floor'].modes.max.overlook.riseM)} m` : 'none');
check('Cholistan is open country', by['Cholistan flat'].modes.max.country === 'open', `reach median ${f0(by['Cholistan flat'].modes.max.reachMedianM)} m`);
check('Lahore centre is close or very close country (with the blockers)', by['Lahore centre'].modes.max.country !== 'open', `${by['Lahore centre'].modes.max.country}, reach median ${f0(by['Lahore centre'].modes.max.reachMedianM)} m`);
check('the DEM alone calls Lahore centre more open than the blockers do (the DSM smooths the town)', by['Lahore centre'].modes.none.reachMedianM > by['Lahore centre'].modes.max.reachMedianM, `reach median ${f0(by['Lahore centre'].modes.none.reachMedianM)} m against ${f0(by['Lahore centre'].modes.max.reachMedianM)} m`);
check('canal bank: a NO-GO class (canal) is the nearest obstacle toward it', [4, 20, 21].includes(by['Lahore canal bank'].modes.none.obst.nogoClass), `class ${by['Lahore canal bank'].modes.none.obst.nogoClass} at ${f0(by['Lahore canal bank'].modes.none.obst.nogoM)} m`);

// ================================================================================================ D. cost
say('\nD. Cost per call (Node 24 / V8, tiles already in memory; the browser main thread is within a factor of two of this)');
const timing = {};
for (const where of [{ id: 'Margalla crest', mode: 'hills' }, { id: 'Lahore centre', mode: 'plain' }]) {
  const s = sites.find((x) => x.id === where.id);
  const m = await core.loadMosaic(fsSource, s.lon, s.lat, 11000, ['class', 'cc', 'bld']);
  const [ox, oy] = core.mosaicXY(m, s.lon, s.lat);
  const blk = core.blockerTable(doctrine, 'max', 11), going = core.goingTable(rules, 'tracked');
  const o = (radiusM, effM) => ({ eyeM: 1.6, targetM: 1.7, radiusM, noiseM: 1.0, k: 0.13, blk, going, effM });
  const n = quick ? 60 : 200;
  const cases = [
    ['wedge 90 deg, 1 deg, to 500 m (rifle)', () => core.analyseRays(m, ox, oy, core.bearingsFor(1, 0, 90), o(500, 300))],
    ['wedge 90 deg, 1 deg, to 2 km (tank)', () => core.analyseRays(m, ox, oy, core.bearingsFor(1, 0, 90), o(2000, 2000))],
    ['wedge 90 deg, fine, to 3 km (ATGM)', () => core.analyseRays(m, ox, oy, core.bearingsFor(core.raysFor(3000, m.res), 0, 90), o(3000, 3000))],
    ['all round, 2 deg, to 1 km', () => core.analyseRays(m, ox, oy, core.bearingsFor(2), o(1000, 300))],
    ['all round, fine, to 5 km (observation)', () => core.analyseRays(m, ox, oy, core.bearingsFor(core.raysFor(5000, m.res)), o(5000, 2000))],
    ['all round, fine, half-pixel step, to 5 km', () => core.analyseRays(m, ox, oy, core.bearingsFor(core.raysFor(5000, m.res)), { ...o(5000, 2000), stepPx: 0.5 })],
    ['all round, fine, to 10 km', () => core.analyseRays(m, ox, oy, core.bearingsFor(core.raysFor(10000, m.res)), o(10000, 2000))],
    ['going flood to 5 km', () => core.goReach(m, ox, oy, going, 5000, 2000)],
    ['cover at the point + month visibility + light', () => { core.coverAt(m, ox, oy, rules, doctrine, 11); core.visibilityAt(vis, s.lon, s.lat, 12); core.lightAt(new Date(), s.lat, s.lon); }],
    ['highest ground within 3 km', () => core.dominanceOf(m, ox, oy, 3000)],
  ];
  say(`  ${where.id} (${where.mode})`);
  timing[where.id] = {};
  for (const [name, fn] of cases) {
    const b = bench(fn, n);
    timing[where.id][name] = b;
    say(`    ${name.padEnd(46)} median ${b.median.toFixed(2).padStart(6)} ms   p95 ${b.p95.toFixed(2).padStart(6)} ms`);
  }
}
{
  const s = sites.find((x) => x.id === 'Lahore centre');
  tileCache.clear();
  const t0 = performance.now();
  const m = await core.loadMosaic(fsSource, s.lon, s.lat, 6000, ['class', 'cc']);
  const t1 = performance.now();
  say(`  cold: 6 km mosaic of 2 + 2 layers: ${m.nx} x ${m.ny} tiles x ${tileReads ? 4 : 0} layers read and PNG-decoded in ${(t1 - t0).toFixed(0)} ms (node, no worker; the app's tile cache has most of these already)`);
  timing.coldMosaicMs = t1 - t0;
}
const wedgeCase = timing['Lahore centre']['wedge 90 deg, 1 deg, to 2 km (tank)'];
check('a 90 degree wedge to 2 km fits a mouse move (under 2 ms median)', wedgeCase.median < 2, `${wedgeCase.median.toFixed(2)} ms`);
const full5 = timing['Margalla crest']['all round, fine, to 5 km (observation)'];
check('the full 5 km all-round view fits a Detail refresh (under 15 ms median)', full5.median < 15, `${full5.median.toFixed(2)} ms`);

// ================================================================================================ E. independent cross-check
say('\nE. Cross-check against an independent implementation (Python, probes every sixth of a pixel, same tiles, bare DEM)');
{
  const s0 = sites.find((x) => x.id === 'Margalla crest');
  const m = await core.loadMosaic(fsSource, s0.lon, s0.lat, 4000, ['class']);
  const [ox, oy] = core.mosaicXY(m, s0.lon, s0.lat);
  const py = resolve(repo, 'tools/terrain-pipeline/.venv/Scripts/python.exe');
  const cross = {};
  for (const stepPx of [1, 0.5]) {
    const bear = core.bearingsFor(15), radiusM = 3500;
    const steps = Math.floor(radiusM / (m.res * stepPx));
    const trace = new Uint8Array(bear.length * steps);
    core.analyseRays(m, ox, oy, bear, { eyeM: 1.6, targetM: 1.7, radiusM, noiseM: 0, k: 0.13, blk: noBlk, effM: 1000, stepPx, trace });
    writeFileSync(resolve(here, 'crosscheck-input.json'), JSON.stringify({ bundle, tx0: m.tx0, ty0: m.ty0, nx: m.nx, ny: m.ny, ox, oy, res: m.res, eyeM: 1.6, targetM: 1.7, k: 0.13, steps, stepPx, bearings: Array.from(bear), trace: Array.from(trace) }));
    if (!existsSync(py)) { say('  (pipeline Python not found: skipped)'); break; }
    const p = spawnSync(py, [resolve(here, 'crosscheck.py'), resolve(here, 'crosscheck-input.json')], { encoding: 'utf8' });
    if (p.status !== 0) { check('Python cross-check ran', false, (p.stderr || '').slice(-300)); break; }
    const j = JSON.parse(p.stdout);
    cross[stepPx] = j;
    say(`  step ${stepPx} px: ${j.samples} samples on ${bear.length} rays: ${j.agree} agree; engine says seen where the reference says hidden ${j.tsSeenRefHidden}, engine hidden where reference seen ${j.tsHiddenRefSeen}`);
    if (j.missDistM.length) say(`        the ${j.missDistM.length} engine-seen / reference-hidden samples lie at ${j.missDistM[0]}-${j.missDistM[j.missDistM.length - 1]} m (median ${j.missDistM[j.missDistM.length >> 1]} m)`);
  }
  if (cross[1]) check('step 1 px agrees with the independent check on 98 % or more of the samples', cross[1].agreePct >= 98, `${cross[1].agreePct.toFixed(2)} %`);
  if (cross[0.5]) check('step 0.5 px agrees on 99.5 % or more', cross[0.5].agreePct >= 99.5, `${cross[0.5].agreePct.toFixed(2)} %`);
  results.push({ name: 'crosscheck', detail: cross });
}

say(`\n${results.filter((r) => r.ok !== undefined).length - failures} of ${results.filter((r) => r.ok !== undefined).length} checks passed${failures ? `, ${failures} FAILED` : ''}.`);
writeFileSync(resolve(here, 'last-run.json'), JSON.stringify({ when: new Date().toISOString(), node: process.version, results, sites: siteOut, timing }, null, 1));
writeFileSync(resolve(here, 'last-run.txt'), out.join('\n') + '\n');
process.exit(failures ? 1 : 0);
