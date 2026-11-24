// wind.mjs -- checks for the wind reading (GroundGuideWind.ts): the grid read, direction, steadiness, day / night, the
// LZ run-in and departure, the DZ drift, the downwind side and proforma g.   node tools/ipb-test/wind.mjs
// A synthetic 3 x 3 grid with known winds, then the real bundle grid (MS/Data/terrain-bundle/wind) when it is there.
import { register } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
register('../movement-test/hooks.mjs', import.meta.url);
const W = await import('../../MS/Engines/GroundGuide/GroundGuideWind.ts');
const { parseWind, windAt, windRulesFrom, lzWind, dzWind, downwind, avenueWind, compass8 } = W;

const here = dirname(fileURLToPath(import.meta.url));
const doctrine = JSON.parse(readFileSync(resolve(here, '../../MS/Data/IpbDoctrine.json'), 'utf8'));
const R = windRulesFrom(doctrine);
let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
}

check('rules from IpbDoctrine wind: steadyMin 0.3, steadyWord 0.6, light 3 kt, turn 90°', R.steadyMin === 0.3 && R.steadyWord === 0.6 && R.lightKt === 3 && R.turnDeg === 90);
check('doctrine: smoke IBB p 109 and NBC OOW2 p 93 carry refs; LZ rule T unverified', doctrine.wind.smoke.refs[0].page === '109' && doctrine.wind.nbc.refs[0].page === '93' && doctrine.wind.lz.basis === 'T' && doctrine.wind.lz.unverified === true);

// A grid builder: per month and UTC hour a function (row, col) -> [u, v, s] in m/s, 3 x 3 points 1 degree apart from 31N 70E.
const HOURS = [0, 6, 12, 18];
function grid(fn, scale = 100) {
  const layers = [], vals = [];
  for (let m = 1; m <= 12; m++)
    for (const h of HOURS)
      for (const [k, i] of [['u', 0], ['v', 1], ['s', 2]]) {
        layers.push({ id: `${k}_${String(m).padStart(2, '0')}_${String(h).padStart(2, '0')}`, scale });
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) vals.push(Math.round(fn(m, h, r, c)[i] * scale));
      }
  const meta = { lat0: 31, lon0: 70, step: 1, rows: 3, cols: 3, hoursUtc: HOURS, layers, source: 'test', sourceRef: { dataDate: '1990-2019 normal' } };
  return parseWind(meta, new Int16Array(vals).buffer);
}

{
  // Steady north wind (air moving south: v = -5), 5 m/s mean speed, every hour.
  const g = grid(() => [0, -5, 5]);
  const w = windAt(g, 71, 30, 1, 5, R);
  check('north wind: from N, steady 1.0', w && Math.round(w.all.fromDeg) === 0 && Math.abs(w.all.steady - 1) < 1e-6, JSON.stringify(w?.all));
  check('north wind text "from N 10 kt, steady", direction alone "from N, steady"', w?.text === 'from N 10 kt, steady' && w?.dirText === 'from N, steady', w?.text);
  check('outside the grid: null', windAt(g, 80, 30, 1, 5, R) === null);
  check('no grid: null', windAt(null, 71, 30, 1, 5, R) === null);
  const ew = grid(() => [-4, 0, 4]); // air moving west: from E
  check('east wind: from E', compass8(windAt(ew, 70.5, 30.5, 6, 5, R).all.fromDeg) === 'E');
  const sw = grid(() => [3, 3, 4.5]); // air moving NE: from SW, |v| 4.24 of 4.5
  const ws = windAt(sw, 70.2, 29.4, 7, 5, R);
  check('south-west wind: from SW, steadiness 0.94', compass8(ws.all.fromDeg) === 'SW' && Math.abs(ws.all.steady - 0.943) < 0.01, `${ws.all.fromDeg} ${ws.all.steady}`);
}

{
  // Bilinear: u rises 0 -> 2 -> 4 m/s across the columns (from W, speed = u); halfway between columns 0 and 1 reads 1.
  const g = grid((m, h, r, c) => [2 * c, 0, Math.max(0.01, 2 * c)]);
  const w = windAt(g, 70.5, 30, 3, 5, R);
  check('bilinear: halfway between points reads the mean (1 m/s)', Math.abs(w.all.meanMs - 1) < 0.01, String(w.all.meanMs));
}

{
  // Variable: the vector is small against the speed (steadiness 0.1): no direction, nothing decided.
  const g = grid(() => [0.4, 0, 4]);
  const w = windAt(g, 71, 30, 2, 5, R);
  check('steadiness 0.1: variable, no direction', w.variable && w.all.fromDeg === null && /^variable/.test(w.text), w.text);
  const lz = lzWind([0, 180], w, R);
  check('variable wind: LZ keeps two opposite approaches', lz.fit === 'variable' && /two opposite/.test(lz.text), lz.text);
  check('variable wind: DZ drift from Met', /from Met/.test(dzWind(w, R)));
  check('variable wind: proforma g says so', avenueWind(0, w, R) === 'wind variable');
}

{
  // Day / night: 00 and 18 UTC (05, 23 PKT) from N, 06 and 12 UTC (11, 17 PKT) from S.
  const g = grid((m, h) => (h === 6 || h === 12 ? [0, 3, 3] : [0, -3, 3]));
  const w = windAt(g, 71, 30, 4, 5, R);
  check('PKT: 06 and 12 UTC are day (11, 17 h), 00 and 18 UTC night (05, 23 h)', w.hours.map((h) => h.hourLocal).join(',') === '5,11,17,23');
  check('day from S, night from N: it turns', w.turns && compass8(w.day.fromDeg) === 'S' && compass8(w.night.fromDeg) === 'N', w.text);
  check('turning wind text names both', /^by day from S .*; by night from N/.test(w.text), w.text);
  check('opposite day and night: the whole day is variable', w.variable);
  // With the UTC offset 0 the same hours split 06 / 12 day again, so the reading is the same; offset 12 swaps day and night.
  const w12 = windAt(g, 71, 30, 4, 12, R);
  check('offset 12 h: day and night swap', compass8(w12.day.fromDeg) === 'N' && compass8(w12.night.fromDeg) === 'S');
}

{
  // LZ: a steady wind from NW (air moving SE: u +, v -), 6 m/s.
  const g = grid(() => [4.243, -4.243, 6]);
  const w = windAt(g, 71, 30, 1, 5, R);
  check('NW wind reads from NW', compass8(w.all.fromDeg) === 'NW', String(w.all.fromDeg));
  const both = lzWind([135, 315], w, R);
  check('LZ clear SE and NW: run in from SE, leave to NW, both clear', both.fit === 'both' && both.runIn === 135 && both.leave === 315 && /run in from SE, leave to NW: both clear/.test(both.text), both.text);
  const inOnly = lzWind([135, 90], w, R);
  check('LZ clear SE only: run-in clear, take off across the wind', inOnly.fit === 'in' && /take off across the wind/.test(inOnly.text));
  const outOnly = lzWind([315], w, R);
  check('LZ clear NW only: land across the wind or choose another', outOnly.fit === 'out' && /land across the wind/.test(outOnly.text));
  const none = lzWind([0, 180], w, R);
  check('LZ clear N and S only: neither', none.fit === 'neither');
  check('no wind reading: lzWind null', lzWind([0], null, R) === null);
  check('DZ: drift to SE, release on the NW side', /drift to SE, release upwind \(NW side\)/.test(dzWind(w, R)), dzWind(w, R));
  check('downwind: smoke and agents drift to SE', /drift to SE/.test(downwind(w, R)));
  check('proforma g: an avenue heading SE has the wind behind it', /^wind behind it \(from NW/.test(avenueWind(135, w, R)), avenueWind(135, w, R));
  check('proforma g: heading NW is into the wind, heading NE across it', /^into the wind/.test(avenueWind(315, w, R)) && /^wind across it/.test(avenueWind(45, w, R)));
}

{
  // Light: 1 m/s (1.9 kt) steady from E: any clear approach serves, the direction still named.
  const g = grid(() => [-1, 0, 1]);
  const w = windAt(g, 71, 30, 1, 5, R);
  const lz = lzWind([0], w, R);
  check('light wind: named, marked light, any clear approach', w.light && /from E 2 kt, steady \(light\)/.test(w.text) && lz.fit === 'light', `${w.text} | ${lz.text}`);
}

{
  // A grid whose value count does not match its header is refused.
  let threw = false;
  try { parseWind({ lat0: 0, lon0: 0, step: 1, rows: 2, cols: 2, hoursUtc: HOURS, layers: [{ id: 'u_01_00' }] }, new Int16Array(3).buffer); } catch { threw = true; }
  check('a short grid is refused', threw);
}

// The real grid in the bundle (git-ignored; skipped when absent).
const B = resolve(here, '../../MS/Data/terrain-bundle/wind');
if (existsSync(resolve(B, 'wind.json'))) {
  const meta = JSON.parse(readFileSync(resolve(B, 'wind.json'), 'utf8'));
  const buf = readFileSync(resolve(B, 'wind.bin'));
  const g = parseWind(meta, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  check('bundle grid: 144 layers at 0.25°', meta.layers.length === 144 && meta.step === 0.25, `${meta.cols} x ${meta.rows}`);
  const kJul = windAt(g, 67.0, 24.85, 7, 5, R);
  check('bundle: Karachi in July, the SW monsoon, steady', compass8(kJul.all.fromDeg) === 'SW' && kJul.all.steady > 0.8 && kJul.all.meanMs * 1.944 > 8, kJul.text);
  const lJan = windAt(g, 74.35, 31.55, 1, 5, R), lJul = windAt(g, 74.35, 31.55, 7, 5, R);
  check('bundle: Lahore from NW in January, from E / SE in July', ['NW', 'W', 'N'].includes(compass8(lJan.all.fromDeg ?? -1)) && ['E', 'SE'].includes(compass8(lJul.all.fromDeg ?? -1)), `${lJan.text} | ${lJul.text}`);
  check('bundle: Sialkot reads (the test area of the airspace checks)', !!windAt(g, 74.53, 32.5, 11, 5, R));
} else console.log('SKIP  bundle grid not present');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
