// water.mjs -- checks for the water obstacle classifier (MS/Engines/MovementGuide/MovementGuideWater.ts) on synthetic
// ground near lat 30.5:
//   * Upper Test Canal: a main canal running east (drawn downstream, the land falls 0.5 m a km to the east), 60 m wide,
//     its water 1.5 m above the land (in-filled), crests 3 m up 30-45 m from its centre (embankment class), sheet banks
//     left 2 m / right 3 m; marsh south of it at km -0.5..0.5; a class 60 bridge at km 1.0.
//   * Second Canal: 250 m south of it from km 4 to km 8 (a twin there).
//   * Test River: 3 km north, 200 m of water 4 m below the land (in-cut), a reach note (2 m deep, 1.2 m/s, 220 m wet
//     span), a ford in use Oct-Apr and a ferry.
//   * A drain the sheet does not draw: 2 km south, 20 m of class 22.
//     node tools/movement-test/water.mjs     Exit code 1 when a check fails.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('./hooks.mjs', import.meta.url);
const M = await import('../../MS/Engines/MovementGuide/MovementGuideScan.ts');
const WG = await import('../../MS/Engines/MovementGuide/MovementGuideWater.ts');

const here = dirname(fileURLToPath(import.meta.url));
const DOC = JSON.parse(readFileSync(resolve(here, '../../MS/Data/MovementDoctrine.json'), 'utf8'));
const R = WG.waterRulesFrom(DOC);
let n = 0, fails = 0;
const check = (name, ok, info = '') => {
  n++;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
};

// ── the ground ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const O = M.lngLatToMerc(73.0, 30.5);
const s = M.scaleAt(O[1]);
const at = (e, nn) => [O[0] + e / s, O[1] + nn / s];
const local = (x, y) => ({ e: (x - O[0]) * s, n: (y - O[1]) * s });
const canalXY = [...at(-8000, 0), ...at(8000, 0)];
const twinXY = [...at(4000, -250), ...at(8000, -250)];
const riverXY = [...at(-8000, 3000), ...at(8000, 3000)];
let riverName = 'Test River';

function land(e) {
  return 200 - e * 0.0005;
}
function elev(x, y) {
  const { e, n: nn } = local(x, y);
  const L = land(e);
  const a = Math.abs(nn);
  if (a < 30) return L + 1.5; // canal water stands above the land
  if (a <= 45) return L + 3; // its banks
  const r = Math.abs(nn - 3000);
  if (r < 100) return L - 4; // river water below the land
  if (r <= 130) return L + 2; // flood bunds
  return L;
}
function cls(x, y) {
  const { e, n: nn } = local(x, y);
  if (e >= 990 && e <= 1010 && Math.abs(nn) < 60) return 39; // the bridge is burnt over the water
  if (Math.abs(nn) < 30) return 20;
  if (Math.abs(nn) <= 45) return 24;
  if (e >= -500 && e <= 500 && nn <= -60 && nn >= -200) return 6;
  if (e >= 4000 && Math.abs(nn + 250) < 15) return 20;
  if (Math.abs(nn - 3000) < 100) return 4;
  if (Math.abs(nn + 2000) <= 10) return 22;
  return 2;
}
const FEATURES = [
  { kind: 'bridge', label: 'Bridge', name: 'Canal Br', p: at(1000, 0), attrs: {} },
  { kind: 'bridge', label: 'Bridge', name: null, p: at(1012, 6), attrs: {} }, // the same bridge recorded twice
  { kind: 'ford', label: 'Ford', name: 'Kacha Ford', p: at(-500, 3000), attrs: { su: 'Oct-Apr' } },
  { kind: 'ferry', label: 'Ferry', name: null, p: at(2500, 3000), attrs: { bo: '2 boats' } },
  { kind: 'river_reach', label: 'River reach', name: 'Test River', p: at(800, 3000), attrs: { dp: 2, cu: 1.2, ws: 220, s: 'sandy' } },
  { kind: 'culvert', label: 'Culvert', name: null, p: at(0, 1500), attrs: {} },
];
const probe = {
  resM: 30,
  cls,
  elev,
  bld: () => 0,
  sight: () => 1,
  people: () => 100,
  roads: () => [],
  raster(layer, x, y) {
    return layer === 'wet' && cls(x, y) === 6 ? 4 : 0;
  },
  features(x, y, r, kinds) {
    return FEATURES.filter((f) => kinds.has(f.kind))
      .map((f) => ({ kind: f.kind, label: f.label, name: f.name, x: f.p[0], y: f.p[1], distM: M.groundDist([x, y], f.p), attrs: f.attrs }))
      .filter((f) => f.distM <= r)
      .sort((a, b) => a.distM - b.distM);
  },
  lines(x, y, r, kinds) {
    const all = [
      { kind: 'canal', xy: canalXY, attrs: { n: 'Upper Test Canal', t: 'MainCanal', w: 60, dp: 3, bl: 2, br: 3, b: 3 } },
      { kind: 'canal', xy: twinXY, attrs: { n: 'Second Canal', t: 'Canal', w: 30 } },
      { kind: 'river', xy: riverXY, attrs: { n: riverName, t: 'river' } },
    ];
    return all.filter((l) => kinds.has(l.kind) && M.distToLine([x, y], l.xy) <= r + 50);
  },
};
const base = { purpose: 'cross', month: 1 };

// ── the canal ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const c = WG.readWater(probe, R, at(0, -200), base);
check('Canal: found from 200 m south', !!c && c.source === 'canal' && c.name === 'Upper Test Canal');
check('Canal: irrigation canal, Annex P 3', c.type === 'irrigationCanal' && c.annex === 3, c.typeWhy.join('; '));
check('Canal: home is the clicked (south) bank', c.homeSign === 1 && c.home.dir === 'S' && c.far.dir === 'N', `${c.homeWhy}, home ${c.home.dir}`);
check('Canal: width from the sheet', c.width.v === 60 && c.width.src === 'sheet');
check('Canal: flows downstream as drawn', c.flow === 'downstream');
check('Canal: sheet banks on their sides (right = south 3 m home, left 2 m far)', c.home.aboveWater.v === 3 && c.far.aboveWater.v === 2 && c.home.aboveWater.src === 'sheet');
check('Canal: water above the land (in-filled)', c.shape === 'raised');
check('Canal: crests 3 m above the land from 30 m ground', c.home.aboveLand.v === 3 && c.far.aboveLand.v === 3, `${c.home.aboveLand.v} / ${c.far.aboveLand.v}`);
check('Canal: embankment recorded on both banks', c.home.bund === 'Embankment over 2 m' && c.far.bund === 'Embankment over 2 m');
check('Canal: marsh beside the home (south) bank only', c.home.marshM >= 100 && c.far.marshM === 0, `${c.home.marshM} / ${c.far.marshM}`);
check('Canal: the bridge 1 km east is class 60', c.crossings.length >= 1 && c.crossings[0].tankable === true && c.crossings[0].dir === 'E', JSON.stringify(c.crossings.map((q) => [q.kind, q.load, q.dir])));
check('Canal: one bridge recorded twice is listed once', c.crossings.filter((q) => q.kind === 'bridge').length === 1 && c.crossings[0].name === 'Canal Br');
check('Canal: river ford / culvert not on the canal', !c.crossings.some((q) => q.kind === 'ford' || q.kind === 'culvert'));
// Only one bank on the sheet (b), and the flow unknown: the higher bank, side not recorded.
const one = WG.readWater({ ...probe, lines: (x, y, r, k) => probe.lines(x, y, r, k).map((l) => (l.kind === 'canal' && l.attrs.n === 'Upper Test Canal' ? { ...l, xy: [...at(8000, 0), ...at(-8000, 0)].map((v, i) => v + (i % 2 ? 0 : 0)), attrs: { n: 'Upper Test Canal', t: 'MainCanal', w: 60, b: 4 } } : l)) }, R, at(0, -200), base);
check('Canal: one sheet bank only reads as the higher bank (4 m), side not recorded', one.far.aboveWater.v === 4 && one.far.aboveWater.hi === 4 && /higher bank/.test(one.far.aboveWater.note ?? ''), JSON.stringify(one.far.aboveWater));
check('Canal: tanks NO-GO except at the class 60 bridge', c.verdict.tanks.v === 'nogo' && /class 60 bridge/.test(c.verdict.tanks.why), c.verdict.tanks.why);
check('Canal: foot needs boats or a bridge (3 m deep)', c.verdict.foot.v === 'nogo');
check('Canal: section centred on the water (edges ±30 m)', !!c.section.edges && Math.abs(c.section.edges[0] + 30) <= 10 && Math.abs(c.section.edges[1] - 30) <= 10, JSON.stringify(c.section.edges));
check('Canal: the season text is the dry one in January', !c.season.wet && /cusecs/.test(c.season.text));

const cN = WG.readWater(probe, R, at(0, 200), base);
check('Canal: clicked from the north, home is the north bank', cN.homeSign === -1 && cN.home.dir === 'N' && cN.home.aboveWater.v === 2);
const cT = WG.readWater(probe, R, at(0, 200), { ...base, threat: at(0, 5000) });
check('Canal: a threat marker to the north puts home south', cT.homeSign === 1 && /threat/.test(cT.homeWhy));
const cF = WG.readWater(probe, R, at(0, -200), { ...base, flipHome: true });
check('Canal: Swap turns home to the north', cF.homeSign === -1 && /swapped/.test(cF.homeWhy));
const cOn = WG.readWater(probe, R, at(0, 0), base);
check('Canal: a click on the water leaves home to be set', cOn.homeGuessed && cOn.recce.some((t) => /Which bank is home/.test(t)));
const cTwin = WG.readWater(probe, R, at(6000, 100), base);
check('Twin: two canals 250 m apart and parallel', cTwin.type === 'twinCanal' && cTwin.annex === 6 && cTwin.twinWith === 'Second Canal', cTwin.typeWhy.join('; '));

// ── the river ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const rv = WG.readWater(probe, R, at(0, 2700), base);
check('River: undammed, Annex P 2', rv.type === 'undammedRiver' && rv.annex === 2, rv.typeWhy.join('; '));
check('River: depth, current and wet span from the reach note', rv.depth.v === 2 && rv.current.v === 1.2 && rv.width.v === 220 && rv.width.src === 'reach' && rv.bed === 'sandy');
check('River: water below the land (in-cut)', rv.shape === 'sunk');
check('River: the section widens to read the land behind a 200 m river (flood bunds 2 m)', rv.home.aboveLand.v === 2 && rv.far.aboveLand.v === 2, `${rv.home.aboveLand.v} / ${rv.far.aboveLand.v}, ±${-rv.section.d[0]} m`);
const ford = rv.crossings.find((q) => q.kind === 'ford');
check('River: the ford is in use in January (Oct-Apr)', ford?.inUseNow === true && ford?.months === 'Oct-Apr');
check('River: the ferry with its boats', rv.crossings.some((q) => q.kind === 'ferry' && q.boats === '2 boats'));
check('River: tanks NO-GO (2 m deep), foot needs boats (2 m)', rv.verdict.tanks.v === 'nogo' && rv.verdict.foot.v === 'nogo', `${rv.verdict.tanks.why} / ${rv.verdict.foot.why}`);
const rvAug = WG.readWater(probe, R, at(0, 2700), { ...base, month: 8 });
check('River: the ford is not in use in August', rvAug.crossings.find((q) => q.kind === 'ford')?.inUseNow === false);
riverName = 'Chenab';
const dm = WG.readWater(probe, R, at(0, 2700), base);
check('River: the Chenab is dammed (list), Annex P 1', dm.type === 'dammedRiver' && dm.annex === 1);
check('River: dammed, January: water belt low, tanks SLOW-GO', dm.verdict.tanks.v === 'slow', dm.verdict.tanks.why);
const dmAug = WG.readWater(probe, R, at(0, 2700), { ...base, month: 8 });
check('River: dammed, August: a substantial obstacle', dmAug.season.wet && dmAug.verdict.tanks.v === 'nogo');
riverName = 'Test River';

// ── the drain the sheet does not draw ──────────────────────────────────────────────────────────────────────────────────
const dr = WG.readWater(probe, R, at(500, -2150), base);
check('Drain: found on the class layer', !!dr && dr.source === 'class' && dr.type === 'drain' && dr.annex === 7, dr && dr.typeWhy.join('; '));
check('Drain: depth is the pamphlet range (1.8-4.6 m)', dr.depth.src === 'pamphlet' && dr.depth.lo === 1.8 && dr.depth.hi === 4.6);
check('Drain: dry in January, crossing it: still a 1.8-4.6 m step, tanks NO-GO', dr.verdict.tanks.v === 'nogo' && /step/.test(dr.verdict.tanks.why), dr.verdict.tanks.why);
const drHold = WG.readWater(probe, R, at(500, -2150), { ...base, purpose: 'hold' });
check('Drain: dry in January, holding it: not counted on to stop tanks', drHold.verdict.tanks.v === 'slow', drHold.verdict.tanks.why);
check('Drain: a 30 m height estimate carries +2 m on its top end', dr.home.aboveLand.src === 'est' && dr.home.aboveLand.hi === dr.home.aboveLand.v + 2);
const drWet = WG.readWater(probe, R, at(500, -2150), { ...base, month: 8 });
check('Drain: flowing in August, tanks NO-GO', drWet.verdict.tanks.v === 'nogo', drWet.verdict.tanks.why);
check('Drain: depth on the recce list', dr.recce.some((t) => /Depth/.test(t)));

// ── a placed anti-tank ditch ───────────────────────────────────────────────────────────────────────────────────────────
const ditch = [at(-1000, -5000), at(1000, -5000)];
const atd = WG.readWater(probe, R, at(0, -5200), { ...base, line: { pts: ditch, type: WG.typeOfSymbolKey('25290203'), name: 'AT Ditch' } });
check('AT ditch: the symbol gives the type (Annex P 8)', atd.type === 'atDitch' && atd.annex === 8 && atd.source === 'symbol');
check('AT ditch: home bank 1.5-3 m, far bank at ground level', atd.home.aboveLand.lo === 1.5 && atd.home.aboveLand.hi === 3 && atd.far.aboveLand.v === 0);
check('AT ditch: tanks NO-GO', atd.verdict.tanks.v === 'nogo');
check('DCB symbol reads as a defence drain', WG.typeOfSymbolKey('25290201') === 'defenceDrain' && WG.typeOfSymbolKey('25290100') === null);
const ov = WG.readWater(probe, R, at(0, -200), { ...base, type: 'linkCanal' });
check('Type set on the card wins', ov.type === 'linkCanal' && ov.annex === 4);

// ── safety: holding it never overstates it ─────────────────────────────────────────────────────────────────────────────
const holdDrain = WG.readWater(probe, R, at(500, -2150), { ...base, month: 8, purpose: 'hold' });
check('Hold: the drain is taken at its shallow end (1.8 m)', WG.worst(holdDrain.depth, 'lo') === 1.8 && WG.worst(drWet.depth, 'hi') === 4.6);

// ── an axis across all three ───────────────────────────────────────────────────────────────────────────────────────────
const ax = WG.readAxis(probe, R, [at(300, -2600), at(300, 3600)], base);
const kinds = ax.obstacles.map((o) => o.reading.type);
check('Axis: drain, canal, river in order', kinds.join(',') === 'drain,irrigationCanal,undammedRiver', `${kinds.join(',')} at ${ax.obstacles.map((o) => o.chainM).join(', ')} m`);
check('Axis: home is the start (south) side of each', ax.obstacles.every((o) => o.reading.home.dir === 'S'), ax.obstacles.map((o) => o.reading.home.dir).join(','));

// ── a reach along the canal ────────────────────────────────────────────────────────────────────────────────────────────
const rc = WG.readReach(probe, R, at(-2000, -150), at(2000, -150), base);
check('Reach: 4 km of canal in 9 stations', !!rc && rc.stations.length === 9 && Math.abs(rc.lengthM - 4000) < 20, rc && `${rc.stations.length} stations, ${rc.lengthM} m`);
check('Reach: the bridge appears at its station', rc.stations.some((q) => q.crossing && /Canal Br/.test(q.crossing)));
check('Reach: banks read at every station', rc.stations.every((q) => q.homeM !== null && q.farM !== null));

// ── odds and ends ──────────────────────────────────────────────────────────────────────────────────────────────────────
check('Months: Oct-Apr in Jan / not in Jun; "Nov to Mar"; nonsense is null', WG.inUse('Oct-Apr', 1) === true && WG.inUse('Oct-Apr', 6) === false && WG.inUse('Nov to Mar', 12) === true && WG.inUse('dry season', 3) === null);
check('Nothing within 500 m: no reading', WG.readWater(probe, R, at(0, -1000), base) === null);
const q = WG.quickWater(probe, R, at(0, -60));
check('Quick read: the canal and its width', q?.type === 'irrigationCanal' && q.width.v === 60);
check('Doctrine: all ten Annex P types with their sections', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].every((k) => Object.values(R.types).some((t) => t.annex === k)));

console.log(`\n${n - fails} / ${n} passed`);
process.exit(fails ? 1 : 0);
