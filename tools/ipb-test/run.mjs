// run.mjs -- checks for the IPB coding of the Ground Guide's Extended View (MS/Engines/GroundGuide/GroundGuideIpb.ts).
//   node tools/ipb-test/run.mjs            synthetic checks + a real area from MS/Data/terrain-bundle (when present)
//   node tools/ipb-test/run.mjs --no-real  synthetic checks only
// Node 24 runs the library's own module directly (type stripping). Exit code 1 when a check fails.
import { readFileSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { codeIpb, ipbRulesFrom, ipbMoverOf, ipbReasonsAt, ipbSummaryText, IPB, WHY } from '../../MS/Engines/GroundGuide/GroundGuideIpb.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const doctrine = JSON.parse(readFileSync(resolve(repo, 'MS/Data/IpbDoctrine.json'), 'utf8'));
const R = ipbRulesFrom(doctrine);

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
}

// ------------------------------------------------------------------------------------------------ synthetic grids
const RES = 30, N = 100;
function grid(fn = {}) {
  const cls = new Uint8Array(N * N);
  const elev = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    cls[y * N + x] = fn.cls ? fn.cls(x, y) : 0;
    elev[y * N + x] = fn.elev ? fn.elev(x, y) : 200;
  }
  return { w: N, h: N, res: RES, cls, elev };
}
const run = (g, o = {}) => codeIpb({ grid: g, rules: R, mover: o.mover ?? 'armour', moveDeg: o.moveDeg === undefined ? 90 : o.moveDeg, month: o.month ?? 11, lonLat: o.lonLat ?? [74.6, 32.4], avlbSpanM: o.avlb ?? 18, season: o.season ?? 'coding', obstacles: o.obstacles });
const at = (c, x, y) => ({ code: c.code[y * c.w + x], why: c.why[y * c.w + x] });
const C = 50;
// A ramp rising east: `pct` % over `cells` cells starting at x = 45 (relief stays small when it is short).
const ramp = (pct, cells, x0 = 45) => (x) => 200 + Math.min(Math.max(x - x0, 0), cells) * RES * pct / 100;

// 1 Slope (IPB pp 10-11): uphill along the movement.
{
  const g = grid({ elev: ramp(50, 5) });
  const c = run(g, { moveDeg: 90 });
  check('slope 50 % uphill (moving E) is NO-GO', at(c, 47, C).code === IPB.NOGO && (at(c, 47, C).why & WHY.SLOPE) !== 0, `code ${at(c, 47, C).code}, ${Math.round(c.slope[C * c.w + 47])} %`);
  const d = run(g, { moveDeg: 270 });
  check('the same slope downhill (26.6°) is GO', at(d, 47, C).code === IPB.GO, `code ${at(d, 47, C).code}`);
  const e = run(g, { moveDeg: null });
  check('all round: the steepest slope counts as uphill (NO-GO)', at(e, 47, C).code === IPB.NOGO);
}
{
  const g = grid({ elev: ramp(35, 8) });
  const c = run(g, { moveDeg: 90 });
  check('slope 35 % uphill is SLOW-GO (30-45 %)', at(c, 48, C).code === IPB.SLOW && (at(c, 48, C).why & WHY.SLOPE) !== 0, `code ${at(c, 48, C).code}, relief ${Math.round(c.relief[C * c.w + 48])} m`);
  const n = run(g, { moveDeg: 0 });
  check('moving across the slope (N) it is GO', at(n, 48, C).code === IPB.GO);
}
{
  const g = grid({ elev: ramp(70, 3) });
  const c = run(g, { moveDeg: 270 });
  check('downhill 35° is not classed by the book', at(c, 46, C).code === IPB.NC && (at(c, 46, C).why & WHY.NC_SLOPE) !== 0, `code ${at(c, 46, C).code}`);
}
// 2 Relief (IPB pp 10-11), moving N so the E-W ramp gives no slope along the movement.
{
  const c = run(grid({ elev: (x) => 200 + Math.min(Math.max(x - 40, 0) * RES * 0.25, 150) }), { moveDeg: 0 });
  check('relief 150 m per km is SLOW-GO', at(c, C, C).code === IPB.SLOW && (at(c, C, C).why & WHY.RELIEF) !== 0, `relief ${Math.round(c.relief[C * c.w + C])}`);
  const d = run(grid({ elev: (x) => 200 + Math.min(Math.max(x - 37, 0) * RES * 0.4, 300) }), { moveDeg: 0 });
  check('relief 300 m per km is NO-GO', at(d, C, C).code === IPB.NOGO && (at(d, C, C).why & WHY.RELIEF) !== 0, `relief ${Math.round(d.relief[C * d.w + C])}`);
  const e = run(grid({ elev: (x) => 200 + Math.min(Math.max(x - 35, 0) * RES * 0.6, 500) }), { moveDeg: 0 });
  check('relief over 400 m per km is not classed', at(e, C, C).code === IPB.NC && (at(e, C, C).why & WHY.NC_RELIEF) !== 0, `relief ${Math.round(e.relief[C * e.w + C])}`);
}
// 3 Built-up areas (IPB p 9, armour only).
{
  const wide = run(grid({ cls: (x, y) => (x >= 48 && x < 53 && y >= 40 && y < 60 ? 3 : 0) }), { moveDeg: 90 });
  check('BUA 600 m wide across the movement is NO-GO for armour', at(wide, 50, 50).code === IPB.NOGO && (at(wide, 50, 50).why & WHY.BUA) !== 0, `width ${wide.buaW[50 * wide.w + 50]} m`);
  const small = run(grid({ cls: (x, y) => (x >= 48 && x < 53 && y >= 45 && y < 55 ? 3 : 0) }), { moveDeg: 90 });
  check('BUA 300 m wide with a bypass is not NO-GO', at(small, 50, 50).code === IPB.GO, `code ${at(small, 50, 50).code}`);
  const boxed = run(grid({ cls: (x, y) => (x >= 48 && x < 53 && y >= 45 && y < 55 ? 3 : (y >= 36 && y <= 40) || (y >= 59 && y <= 63) ? 4 : 0) }), { moveDeg: 90 });
  check('BUA 300 m wide with water on both flanks (no easy bypass) is NO-GO', at(boxed, 50, 50).code === IPB.NOGO && (at(boxed, 50, 50).why & WHY.BUA) !== 0);
  const foot = run(grid({ cls: (x, y) => (x >= 48 && x < 53 && y >= 40 && y < 60 ? 3 : 0) }), { moveDeg: 90, mover: 'dismounted' });
  check('the BUA rule is for armour only (dismounted: GO)', at(foot, 50, 50).code === IPB.GO);
}
// 4 Hydrology (IPB pp 9-11).
{
  const river = run(grid({ cls: (x) => (x >= 48 && x <= 50 ? 4 : 0) }));
  check('river 90 m wide (wider than the AVLB span) is NO-GO', at(river, 49, C).code === IPB.NOGO && (at(river, 49, C).why & WHY.WATER) !== 0, `width ${river.waterW[C * river.w + 49]} m`);
  const canal = run(grid({ cls: (x) => (x === 50 ? 20 : 0) }));
  check('a canal one cell wide: width not recorded, not assessed', at(canal, 50, C).code === IPB.NA && (at(canal, 50, C).why & WHY.NA_WATER) !== 0);
  const bridged = run(grid({ cls: (x, y) => (x >= 48 && x <= 50 ? (y === C ? 39 : 4) : 0) }));
  check('a bridge across it is a crossing (SLOW-GO)', at(bridged, 49, C).code === IPB.SLOW && (at(bridged, 49, C).why & WHY.CROSSING) !== 0);
  const seas = run(grid({ cls: (x) => (x >= 45 && x <= 55 ? 5 : 0) }));
  check('seasonal water: depth not recorded, not assessed', at(seas, C, C).code === IPB.NA && (at(seas, C, C).why & WHY.SEASONAL_WATER) !== 0);
  const wideSpan = run(grid({ cls: (x) => (x >= 48 && x <= 50 ? 4 : 0) }), { avlb: 100 });
  check('with a 100 m AVLB the same river is spannable: SLOW-GO, bank not recorded', at(wideSpan, 49, C).code === IPB.SLOW && (at(wideSpan, 49, C).why & WHY.NA_WATER) !== 0);
}
// 5, 6 Vegetation and roads (IPB pp 10-12).
{
  const forest = (x, y) => (x >= 20 && x < 80 && y >= 20 && y < 80 ? 31 : 0);
  const arm = run(grid({ cls: forest }));
  check('armour in woods with no roads: NO-GO by roads, trees not assessed', at(arm, C, C).code === IPB.NOGO && (at(arm, C, C).why & WHY.ROADS) !== 0 && (at(arm, C, C).why & WHY.NA_VEG) !== 0);
  const mech = run(grid({ cls: forest }), { mover: 'mech' });
  check('mechanized in woods: trees not assessed', at(mech, C, C).code === IPB.NA && (at(mech, C, C).why & WHY.NA_VEG) !== 0);
  const foot = run(grid({ cls: forest }), { mover: 'dismounted' });
  check('dismounted in woods: no criterion applies (GO)', at(foot, C, C).code === IPB.GO);
  const one = run(grid({ cls: (x, y) => (x === 45 && y >= 20 && y < 80 ? 34 : forest(x, y)) }));
  check('one hard road per km in woods: SLOW-GO for armour, roads negate the trees', at(one, C, C).code === IPB.SLOW && (at(one, C, C).why & WHY.NA_VEG) === 0, `${one.roadH[C * one.w + C] / 10} per km`);
  const two = run(grid({ cls: (x, y) => ((x === 40 || x === 60) && y >= 20 && y < 80 ? 34 : forest(x, y)) }));
  check('two hard roads per km in woods: GO for armour', at(two, C, C).code === IPB.GO, `${two.roadH[C * two.w + C] / 10} per km`);
  const open = run(grid());
  check('open country: the roads rule does not apply (GO)', at(open, C, C).code === IPB.GO);
}
// 7 Man-made obstacles (IPB p 10).
{
  const c = run(grid(), { obstacles: [{ kind: 'area', pts: [[40, 40], [60, 40], [60, 60], [40, 60]] }] });
  check('a minefield symbol is NO-GO inside, GO outside', at(c, C, C).code === IPB.NOGO && (at(c, C, C).why & WHY.MANMADE) !== 0 && at(c, 10, 10).code === IPB.GO);
}
// 8 Season rules (Desert p 4, Mountain pp 259, 281).
{
  const rann = grid({ cls: () => 16 });
  const jul = run(rann, { month: 7, lonLat: [69.6, 23.9] });
  check('Rann salt pan in July: NO-GO (in the coding)', at(jul, C, C).code === IPB.NOGO && (at(jul, C, C).why & WHY.SEASON) !== 0);
  const notes = run(rann, { month: 7, lonLat: [69.6, 23.9], season: 'notes' });
  check('as notes: flagged, not coded', at(notes, C, C).code === IPB.GO && (at(notes, C, C).why & WHY.NOTE_SEASON) !== 0);
  const dec = run(rann, { month: 12, lonLat: [69.6, 23.9] });
  check('Rann in December: no season rule', at(dec, C, C).code === IPB.GO);
  const high = grid({ elev: () => 3000 });
  check('above 2500 m in January: NO-GO (snow closure)', at(run(high, { month: 1 }), C, C).code === IPB.NOGO);
  check('above 2500 m in July: GO', at(run(high, { month: 7 }), C, C).code === IPB.GO);
  const snowSlope = run(grid({ cls: () => 8, elev: (x, y) => 1500 + Math.min(Math.max(y - 49, 0), 3) * RES * 0.8 }), { month: 7, moveDeg: 90 });
  check('snow slope over 35° (steepest, any direction): NO-GO', at(snowSlope, C, C).code === IPB.NOGO && (at(snowSlope, C, C).why & WHY.SEASON) !== 0);
}
// Precedence and reasons.
{
  const c = run(grid({ cls: (x, y) => (x >= 20 && x < 80 ? 31 : 0), elev: ramp(35, 8) }), { mover: 'mech' });
  check('SLOW-GO by slope with trees not assessed stays SLOW-GO, flagged', at(c, 48, C).code === IPB.SLOW && (at(c, 48, C).why & WHY.NA_VEG) !== 0);
  const d = run(grid({ cls: (x) => (x >= 46 && x <= 49 ? 4 : 0), elev: ramp(35, 8) }));
  const z = at(d, 47, C);
  check('NO-GO by water beats SLOW-GO by slope; the mask names water only', z.code === IPB.NOGO && (z.why & WHY.WATER) !== 0 && (z.why & WHY.SLOPE) === 0);
  const rs = ipbReasonsAt(d, R, 47, C);
  check('reasons name the slope, the water and the water table', rs.some((r) => r.crit === 'slope') && rs.some((r) => r.crit === 'water' && r.cls === 'nogo') && rs.some((r) => r.crit === 'waterTable'), rs.map((r) => r.text).join(' | '));
  check('the not-assessed list always has the water table', d.stats.notAssessed[0].startsWith('Water table'));
  check('mover mapping: tracked → armour, wheeled → mech, dismounted → dismounted', ipbMoverOf('tracked', R) === 'armour' && ipbMoverOf('wheeled', R) === 'mech' && ipbMoverOf('dismounted', R) === 'dismounted');
  check('doctrine figures read: NO-GO 45 %, SLOW-GO 30 %, GO 30°, BUA 500 m, AVLB 18 m', R.nogoUphillPct === 45 && R.slowUphillPct === 30 && R.goDeg === 30 && R.buaWideM === 500 && R.defaultAvlbM === 18);
}
// Cost.
{
  const M = 700, cls = new Uint8Array(M * M), elev = new Float32Array(M * M);
  for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
    const v = (Math.sin(x * 0.05) + Math.cos(y * 0.037)) * 40 + 200;
    elev[y * M + x] = v;
    cls[y * M + x] = (x * 7 + y * 13) % 97 < 3 ? 3 : x % 120 === 0 ? 20 : (x + y) % 150 < 6 ? 31 : y % 90 === 0 ? 34 : 2;
  }
  const t = performance.now();
  const c = codeIpb({ grid: { w: M, h: M, res: RES, cls, elev }, rules: R, mover: 'armour', moveDeg: 90, month: 11, lonLat: [74, 32], avlbSpanM: 18, season: 'coding' });
  const ms = performance.now() - t;
  check('700 x 700 cells (a 10 km square) codes in under 600 ms', ms < 600, `${Math.round(ms)} ms · ${ipbSummaryText(c)}`);
}

// ------------------------------------------------------------------------------------------------ a real area (bundle)
const bundle = resolve(repo, 'MS/Data/terrain-bundle');
if (!process.argv.includes('--no-real') && existsSync(resolve(bundle, 'manifest.json'))) {
  const decodePng = (buf) => {
    let p = 8, w = 0, h = 0, bd = 0, col = 0; const idat = [];
    while (p < buf.length) {
      const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8);
      if (type === 'IHDR') { w = buf.readUInt32BE(p + 8); h = buf.readUInt32BE(p + 12); bd = buf[p + 16]; col = buf[p + 17]; }
      else if (type === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
      else if (type === 'IEND') break;
      p += 12 + len;
    }
    if (bd !== 8 || col !== 0) throw new Error(`unsupported PNG ${bd}/${col}`);
    const raw = inflateSync(Buffer.concat(idat)), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const f = raw[y * (w + 1)], row = y * (w + 1) + 1;
      for (let x = 0; x < w; x++) {
        const a = x ? out[y * w + x - 1] : 0, b = y ? out[(y - 1) * w + x] : 0, cc = x && y ? out[(y - 1) * w + x - 1] : 0;
        let v = raw[row + x];
        if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
        else if (f === 4) { const pp = a + b - cc, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - cc); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : cc; }
        out[y * w + x] = v & 255;
      }
    }
    return out;
  };
  const man = JSON.parse(readFileSync(resolve(bundle, 'manifest.json'), 'utf8'));
  const Z = man.zoom.max, TS = man.tileSize;
  const place = { name: 'Phillora', lon: 74.65, lat: 32.43, km: 4 };
  const nW = TS * 2 ** Z, sLat = Math.sin(place.lat * Math.PI / 180);
  const cx = ((place.lon + 180) / 360) * nW, cy = (0.5 - Math.log((1 + sLat) / (1 - sLat)) / (4 * Math.PI)) * nW;
  const res = (40075016.686 / nW) * Math.cos(place.lat * Math.PI / 180), rpx = (place.km * 1000) / res;
  const tx0 = Math.floor((cx - rpx) / TS), tx1 = Math.floor((cx + rpx) / TS), ty0 = Math.floor((cy - rpx) / TS), ty1 = Math.floor((cy + rpx) / TS);
  const gw = (tx1 - tx0 + 1) * TS, gh = (ty1 - ty0 + 1) * TS;
  const lay = (layer, fill) => {
    const out = new Uint8Array(gw * gh).fill(fill);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const f = `${bundle}/${layer}/${Z}/${tx}/${ty}.png`;
      if (!existsSync(f)) continue;
      const t = decodePng(readFileSync(f));
      for (let r = 0; r < TS; r++) out.set(t.subarray(r * TS, r * TS + TS), ((ty - ty0) * TS + r) * gw + (tx - tx0) * TS);
    }
    return out;
  };
  const cls = lay(man.layers.class, 255), hi = lay(man.layers.elev_hi, 255), lo = lay(man.layers.elev_lo, 0);
  const elev = new Float32Array(gw * gh);
  for (let i = 0; i < elev.length; i++) elev[i] = hi[i] === 255 ? NaN : hi[i] * 256 + lo[i] - 500;
  const ox = Math.round(cx - tx0 * TS), oy = Math.round(cy - ty0 * TS), r = Math.round(rpx);
  const c = codeIpb({ grid: { w: gw, h: gh, res, cls, elev }, rules: R, mover: 'armour', moveDeg: 270, month: 11, lonLat: [place.lon, place.lat], avlbSpanM: 18, season: 'coding', box: [ox - r, oy - r, ox + r, oy + r] });
  const p = c.stats.pct, sum = p.go + p.slow + p.nogo + p.na + p.nc;
  check(`real area ${place.name} (${place.km} km round, armour moving W): coded`, c.stats.cells > 10000 && Math.abs(sum - 100) < 0.01, `${Math.round(c.ms)} ms · ${ipbSummaryText(c)}`);
  let canalGo = 0, canal = 0;
  for (let by = 0; by < c.h; by++) for (let bx = 0; bx < c.w; bx++) {
    const k = cls[(c.y0 + by) * gw + c.x0 + bx];
    if (k === 20 || k === 21 || k === 4) { canal++; if (c.code[by * c.w + bx] === IPB.GO) canalGo++; }
  }
  check('no water cell is painted GO (NO-GO or not assessed)', canalGo === 0, `${canal} water cells`);
  console.log(`      not assessed: ${c.stats.notAssessed.join('; ')}`);
  console.log(`      built-up NO-GO: ${c.stats.buaNogo.slice(0, 4).map((b) => `${b.widthM} m${b.noBypass ? ' (no bypass)' : ''}`).join(', ') || 'none'}`);
} else console.log('SKIP  real area (no terrain bundle or --no-real)');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
