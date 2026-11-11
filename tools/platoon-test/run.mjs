// run.mjs -- Platoon Guide engine checks.
//   node tools/platoon-test/run.mjs
// Node 24 runs the library's own pure engine (MS/Engines/PlatoonGuide/PlatoonGuideRead.ts) on a synthetic piece of
// ground built here, with the Movement Guide's route scan (MovementGuideScan.ts) for the dangers on roads, so every
// answer has a known place to be found. Exit code 1 when a check fails.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as P from '../../MS/Engines/PlatoonGuide/PlatoonGuideRead.ts';
import * as M from '../../MS/Engines/MovementGuide/MovementGuideScan.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const R = P.plRulesFrom(JSON.parse(readFileSync(resolve(repo, 'MS/Data/PlatoonDoctrine.json'), 'utf8')));
const MR = M.rulesFrom(JSON.parse(readFileSync(resolve(repo, 'MS/Data/MovementDoctrine.json'), 'utf8')));
const rules = JSON.parse(readFileSync(resolve(repo, 'MS/Data/terrain-bundle/rules.json'), 'utf8'));
const speeds = JSON.parse(readFileSync(resolve(repo, 'MS/Data/MovementSpeeds.json'), 'utf8'));

let fails = 0;
let n = 0;
function check(name, ok, info = '') {
  n++;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
}

// ── synthetic ground near Islamabad (lat 33.6): metres east / north of O ─────────────────────────────────────────────
const O = M.lngLatToMerc(73.0, 33.6);
const s = M.scaleAt(O[1]);
const at = (e, nn) => [O[0] + e / s, O[1] + nn / s];
const local = (x, y) => ({ e: (x - O[0]) * s, n: (y - O[1]) * s });

const HILL = { e: -600, n: 600, r: 300, h: 60 };
const ORCH = { e0: 400, e1: 700, n0: 300, n1: 600 };
const VILL = { e: 1800, n: 1800, r: 150 };
function elevL(e, nn) {
  const d = Math.hypot(e - HILL.e, nn - HILL.n);
  return 500 + (d < HILL.r ? HILL.h * (1 - (d / HILL.r) ** 2) : 0);
}
function clsL(e, nn) {
  if (Math.abs(e + 250) <= 10 && Math.abs(nn) <= 3000) return 20; // canal
  if (Math.abs(nn + 300) <= 10 && Math.abs(e) <= 3000) return 34; // road
  if (Math.abs(e - 150) <= 8 && nn >= -200 && nn <= 900) return 47; // dry nullah
  if (e >= ORCH.e0 && e <= ORCH.e1 && nn >= ORCH.n0 && nn <= ORCH.n1) return 30; // orchard
  if (Math.hypot(e - VILL.e, nn - VILL.n) <= VILL.r) return 3; // village
  return 0;
}
const near = (e, nn, x0, x1, y0, y1, m) => e >= x0 - m && e <= x1 + m && nn >= y0 - m && nn <= y1 + m;

const LABEL = {
  tube_well: 'Tube well', well_lined: 'Well (lined)', hospital: 'Hospital', bhu: 'Basic health unit', police_station: 'Police station',
  watch_tower: 'Watch tower', mast: 'Mast', trig_station: 'Trig station', chimney: 'Factory chimney', km_road: 'KM stone (road)',
  mosque: 'Mosque', school: 'School / college', village: 'Village', culvert: 'Culvert', helipad: 'Helipad', deserted_site: 'Deserted site',
};
const FEATS = [
  ['tube_well', 200, 100, {}],
  ['well_lined', -100, -500, {}],
  ['hospital', 3000, 3000, { n: 'Test Civil Hospital' }],
  ['bhu', 1500, -1000, {}],
  ['police_station', 2000, 0, { n: 'Test Thana' }],
  ['watch_tower', HILL.e, HILL.n, {}],
  ['mast', 800, -800, {}],
  ['trig_station', -1500, -1200, { e: 512 }],
  ['chimney', 1200, 1500, {}],
  ['km_road', 0, -300, { n: 12.5 }],
  ['mosque', 300, -200, {}],
  ['school', -150, 200, {}],
  ['village', VILL.e, VILL.n, { n: 'Test Kot', wp: 2400, d: 'Testpur', h: 'Test Tehsil' }],
  ['culvert', 500, -300, {}],
  ['helipad', 2500, -2500, {}],
  ['deserted_site', -300, -700, {}],
].map(([kind, e, nn, a]) => {
  const p = at(e, nn);
  return { kind, x: p[0], y: p[1], a };
});
const LINES = [
  { kind: 'road', xy: [...at(-3000, -300), ...at(3000, -300)], attrs: { t: 'metalled', r: 'N-5', k: 3 } },
  { kind: 'canal', xy: [...at(-250, -3000), ...at(-250, 3000)], attrs: { n: 'Test Canal' } },
  { kind: 'power_line', xy: [...at(-3000, 1000), ...at(3000, 1000)], attrs: { v: 132 } },
];

function lineDist(x, y, xy) {
  return M.distToLine([x, y], xy);
}

const probe = {
  resM: 30,
  cls(x, y) {
    const l = local(x, y);
    return clsL(l.e, l.n);
  },
  elev(x, y) {
    const l = local(x, y);
    return elevL(l.e, l.n);
  },
  bld(x, y) {
    const l = local(x, y);
    return Math.hypot(l.e - VILL.e, l.n - VILL.n) <= VILL.r ? 5 | (2 << 3) | (2 << 6) : 0;
  },
  raster(layer, x, y) {
    const l = local(x, y);
    const c = clsL(l.e, l.n);
    if (layer === 'cc') return c === 30 ? (3 << 4) | 2 : c === 3 ? (2 << 4) | 2 : (1 << 4) | 0;
    if (layer === 'wet') return Math.abs(l.e - 150) <= 30 && l.n >= -200 && l.n <= 900 ? 1 : 0;
    if (layer === 'landform') return Math.hypot(l.e - HILL.e, l.n - HILL.n) <= 80 ? 6 : 3;
    if (layer === 'hut') return 0;
    if (layer === 'distHls') {
      if (c !== 0) return 0;
      const dRoad = Math.abs(l.n + 300), dCanal = Math.abs(l.e + 250), dNul = Math.abs(l.e - 150);
      const dOrch = near(l.e, l.n, ORCH.e0, ORCH.e1, ORCH.n0, ORCH.n1, 40) ? 0 : 99;
      return Math.min(dRoad, dCanal, dNul, dOrch) < 40 ? 2 : 10;
    }
    return null;
  },
  sight2(ox, oy, eyeM, tx, ty, targetM) {
    const a = local(ox, oy), b = local(tx, ty);
    const L = Math.hypot(b.e - a.e, b.n - a.n);
    const h0 = elevL(a.e, a.n) + eyeM, h1 = elevL(b.e, b.n) + targetM;
    let pTerrain = 1, p = 1;
    const steps = Math.max(1, Math.ceil(L / 15));
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      const e = a.e + (b.e - a.e) * t, nn = a.n + (b.n - a.n) * t;
      const line = h0 + (h1 - h0) * t;
      if (elevL(e, nn) > line) pTerrain = 0;
      const c = clsL(e, nn);
      if ((c === 30 || c === 3) && L * (1 - t) > 30) p = 0.2;
    }
    return { p: Math.min(p, pTerrain), pTerrain };
  },
  sight(ox, oy, eyeM, tx, ty, targetM) {
    return this.sight2(ox, oy, eyeM, tx, ty, targetM).p;
  },
  features(x, y, r, kinds) {
    const out = [];
    for (const f of FEATS) {
      if (!kinds.has(f.kind)) continue;
      const d = Math.hypot(f.x - x, f.y - y) * s;
      if (d > r) continue;
      const label = LABEL[f.kind] ?? f.kind;
      out.push({ kind: f.kind, label, name: f.a.n && typeof f.a.n === 'string' ? f.a.n : null, x: f.x, y: f.y, distM: d, attrs: f.a });
    }
    return out.sort((p, q) => p.distM - q.distM);
  },
  roads(x, y, r) {
    const l = local(x, y);
    const d = Math.abs(l.n + 300);
    if (d > r) return [];
    const p = at(Math.max(-3000, Math.min(3000, l.e)), -300);
    return [{ distM: d, x: p[0], y: p[1], attrs: { t: 'metalled', r: 'N-5' } }];
  },
  lines(x, y, r, kinds) {
    return LINES.filter((l) => kinds.has(l.kind) && lineDist(x, y, l.xy) <= r + 10);
  },
  people(x, y) {
    const l = local(x, y);
    return Math.hypot(l.e - VILL.e, l.n - VILL.n) <= 600 ? 400 : 50;
  },
  takePending() {
    return false;
  },
};

const going = (p) => ({ nogo: new Set(rules.profiles[p].nogo ?? []), caution: new Set(rules.profiles[p].caution ?? []) });
const foot = going('dismounted');
const veh = going('wheeled');
const classLabel = (c) => rules.classes[String(c)]?.label ?? `Class ${c}`;
const g = rules.grotbc.layers;
const codebooks = { wet: g.wet, landform: g.landform, bldDensity: g.bld.density, bldSize: g.bld.size, ccLevels: g.cc.levels };
const roadScanner = new M.RouteScanner(MR);
const footScanner = new M.RouteScanner(MR);
const borders = [{ kind: 'Line of Control', xy: [...at(-9000, 4000), ...at(9000, 4000)], box: [at(-9000, 4000)[0], at(0, 4000)[1], at(9000, 4000)[0], at(0, 4000)[1]] }];
const ctx = {
  at: O,
  echelon: 'platoon',
  eye: 'standing',
  month: 11,
  foot,
  veh,
  classLabel,
  codebooks,
  borders,
  people: { perKm2At: 50, rings: [{ km: 1, people: 160 }, { km: 2, people: 900 }], ages: { males15_49: 40, under15: 60, over65: 6 } },
  scanRoad: (path, sight) => roadScanner.scan(path, probe, { going: veh, sight, borders }),
  full: false,
};

// ── 1 here (live read) ───────────────────────────────────────────────────────────────────────────────────────────────
const t0 = performance.now();
const live = P.readPoint(probe, R, ctx);
const liveMs = performance.now() - t0;
const H = live.here;
check('live read has no costly groups', live.see === null && live.danger === null && live.stop === null);
check('going here: foot GO on open land', H.going.foot === 'go' && H.going.veh === 'go', `${H.going.foot}/${H.going.veh}`);
check('cover here read from cc (poor concealment, no cover)', H.cover.cover === 0 && H.cover.concealment === 1);
check('better concealment found in the orchard (NE)', !!H.betterConcealment && ['NE', 'E', 'N'].includes(H.betterConcealment.dir) && H.betterConcealment.distM < 600, H.betterConcealment ? `${Math.round(H.betterConcealment.distM)} m ${H.betterConcealment.dir}` : 'none');
check('nearest water = the tube well, marked as needing power', H.water.nearest?.kind === 'tube_well' && /power/.test(H.water.nearest.why ?? ''), H.water.nearest?.label);
check('nearest water without power = the lined well', H.water.perennial?.kind === 'well_lined');
check('canal named as flowing water ~250 m W', H.water.line?.name === 'Test Canal' && Math.abs(H.water.line.distM - 250) < 15 && H.water.line.dir === 'W');
const dirOf = (d) => H.waysOut.dirs.find((x) => x.dir === d);
check('way out W blocked for foot by the 20 m canal (250 m out)', dirOf('W').foot === 'nogo', dirOf('W').foot);
check('ways out NW / SW open (the canal is 354 m out on the diagonal)', dirOf('NW').foot === 'go' && dirOf('SW').foot === 'go');
check('way out E open for foot, SLOW-GO for wheels (dry nullah)', dirOf('E').foot === 'go' && dirOf('E').veh === 'slow', `${dirOf('E').foot}/${dirOf('E').veh}`);
check('nearest road N-5, 300 m S', H.waysOut.road?.name === 'N-5' && Math.abs(H.waysOut.road.distM - 300) < 5 && H.waysOut.road.dir === 'S');
check('clear ground for a helicopter at the point', H.hls.ground?.distM === 0);
check('recorded helipad found', H.hls.recorded?.kind === 'helipad');
check('hospital with a drive time', H.medical.hospital?.name === 'Test Civil Hospital' && H.medical.driveMin === 9, `${H.medical.driveMin} min`);
check('KM stone on the N-5', H.where.km?.label === 'KM 12.5' && H.where.km.name === 'N-5', `${H.where.km?.label} ${H.where.km?.name}`);
check('nearest place, district and tehsil', H.where.place?.name === 'Test Kot' && H.where.district === 'Testpur' && H.where.tehsil === 'Test Tehsil');
check('people within 500 m from the density', live.people.within500 === 39 && live.people.rings.length === 2);
check('nearest BUA with its people', live.people.bua?.name === 'Test Kot' && /2,400/.test(live.people.bua.why ?? ''));
check('sensitive sites in the bubble: mosque and school', live.people.sensitive.counts.length === 2);
check('help: police station listed', live.help.friends.some((f) => f.kind === 'police_station'));
check('live read is quick', liveMs < 60, `${liveMs.toFixed(1)} ms`);

// ── 2-6 full read ────────────────────────────────────────────────────────────────────────────────────────────────────
const t1 = performance.now();
const full = P.readPoint(probe, R, { ...ctx, full: true });
const fullMs = performance.now() - t1;
const S = full.see;
check('full read has sight, dangers and where to stop', !!S && !!full.danger && !!full.stop);
check('fan: 36 rays out to 1000 m', S.rays.length === 36 && S.rays[0].states.length === 20);
const ray = (b) => S.rays.find((r) => Math.abs(r.bearingDeg - b) < 0.1);
const nwRay = ray(310);
check('dead ground behind the hill (NW)', nwRay.states[19] === 3, `states ${[...nwRay.states].join('')}`);
const neRay = ray(50);
check('screened ground behind the orchard (NE)', [...neRay.states].slice(15).includes(2), `states ${[...neRay.states].join('')}`);
check('shares add up', Math.abs(S.pct.seen + S.pct.screened + S.pct.dead - 100) <= 2, JSON.stringify(S.pct));
check('overlooking ground on the hill (NW)', S.overlook.length >= 1 && ['NW', 'N', 'W'].includes(S.overlook[0].dir), S.overlook.map((o) => `${o.dir} ${Math.round(o.distM)}`).join(', '));
check('no rooftops near', S.rooftops === null);
check('not on a skyline', S.skyline === false);
check('range card: watch tower and mosque as reference points', S.refs.some((r) => r.kind === 'watch_tower') && S.refs.some((r) => r.kind === 'mosque'), S.refs.map((r) => r.kind).join(', '));
const rk = S.resection.map((r) => r.kind).sort().join(',');
check('resection: tower, mast, trig (chimney hidden by the orchard)', rk === 'mast,trig_station,watch_tower', rk);
const D = full.danger;
check('roads in the bubble scanned (~1.9 km of the N-5)', D.roadKm > 1.5 && D.roadKm < 2.1, `${D.roadKm.toFixed(2)} km`);
const cul = D.spots.find((x) => (x.kind === 'vp' || x.kind === 'mine') && M.groundDist([x.x, x.y], at(500, -300)) < 100);
check('culvert on the road named as a danger', !!cul, D.spots.map((x) => `${x.kind}:${x.score}@${Math.round(local(x.x, x.y).e)}`).join(' '));
check('covered approach: the dry nullah 150 m E', D.approaches.some((a) => a.kind === 'cls47' && a.dir === 'E' && a.distM < 200), D.approaches.map((a) => `${a.label} ${a.dir}`).join(', '));
check('hazard: deserted site', D.hazards.some((h) => h.kind === 'deserted_site'));
check('border within reach (~4 km)', D.border && Math.abs(D.border.km - 4) < 0.2, D.border ? `${D.border.km.toFixed(1)} km` : 'none');
const hb = full.stop.harbour;
const hl = hb ? local(hb.x, hb.y) : null;
check('patrol base in the orchard', !!hl && hl.e >= ORCH.e0 && hl.e <= ORCH.e1 && hl.n >= ORCH.n0 && hl.n <= ORCH.n1, hl ? `${Math.round(hl.e)}, ${Math.round(hl.n)}` : 'none');
const op = full.stop.op;
// The domed top hides its own slopes, so the forward slope (the military crest) may see more than the top itself.
check('OP on the hill (top or forward slope)', !!op && M.groundDist([op.x, op.y], at(HILL.e, HILL.n)) < HILL.r, op ? `${Math.round(local(op.x, op.y).e)}, ${Math.round(local(op.x, op.y).n)}` : 'none');
check('relay ground found, no radio shadow', !!full.help.relay && full.help.radioShadow === false);
check('checks and gaps listed', full.checks.length >= 4 && full.gaps.some((x) => /incident/.test(x)));
check('full read in time', fullMs < 1500, `${fullMs.toFixed(0)} ms`);

// ── 7 patrol route card ──────────────────────────────────────────────────────────────────────────────────────────────
const F = speeds.movers.foot;
const footSpeeds = { ground: F.ground, road: F.road.track, toblerA: F.slope.a[0], toblerB: F.slope.b };
const pctx = { foot, speeds: footSpeeds, classLabel, scanRoad: (path, sight, threat) => footScanner.scan(path, probe, { going: foot, sight, borders, threat }) };
const card = P.patrolCard(probe, R, [O, at(800, 0), at(800, 800)], pctx);
check('two legs', card.legs.length === 2);
check('leg 1: 090°, 800 m, 960 paces', Math.round(card.legs[0].bearingDeg) === 90 && Math.abs(card.legs[0].distM - 800) < 1 && card.legs[0].paces === 960, `${card.legs[0].bearingDeg.toFixed(1)} ${card.legs[0].distM.toFixed(0)} ${card.legs[0].paces}`);
check('leg 2: 000°', Math.round(card.legs[1].bearingDeg) % 360 === 0);
check('leg 1 time ~12 min by day, longer by night', card.legs[0].minDay >= 12 && card.legs[0].minDay <= 14 && card.legs[0].minNight > card.legs[0].minDay, `${card.legs[0].minDay} / ${card.legs[0].minNight}`);
check('bounds every 650 m and a final meeting point', card.bounds.length === 2 && !!card.fmp && Math.abs(card.fmp.chainM - 1150) < 1);
check('no threat: exposed from high Gr only, no dead stretches', card.dead.length === 0 && card.threatKnown === false);
const card2 = P.patrolCard(probe, R, [O, at(-600, 0)], pctx);
check('canal crossed named as an obstacle', card2.obstacles.length === 1 && card2.obstacles[0].label === 'Canal' && Math.abs(card2.obstacles[0].chainM - 250) < 60, card2.obstacles.map((o) => `${o.label}@${Math.round(o.chainM)}`).join(' '));
const card3 = P.patrolCard(probe, R, [O, at(800, 0), at(800, 50), O], pctx);
check('same way back flagged', card3.sameWayBack === true && /route back/.test(card3.checks[0]));
check('a loop is not flagged', card.sameWayBack === false);
// South of the hill, the threat north of it: the stretch behind the hill is hidden; then over the top and down the far side.
const card4 = P.patrolCard(probe, R, [at(-1200, 200), at(-200, 200), at(-600, 600), at(-600, 1000)], { ...pctx, threat: at(-600, 2000) });
check('with a threat: stretches hidden from it (behind the hill)', card4.dead.length >= 1 && card4.threatKnown, card4.dead.map((d) => `${Math.round(d.fromM)}-${Math.round(d.toM)}`).join(' '));
check('skyline over the hilltop', card4.skyline.length >= 1, card4.skyline.map((d) => `${Math.round(d.fromM)}-${Math.round(d.toM)}`).join(' '));
check('exposed again over the top and down the far side', card4.exposed.some((x) => x.fromM >= 1500), card4.exposed.map((d) => `${Math.round(d.fromM)}-${Math.round(d.toM)}`).join(' '));

// ── flat ground: no OP proposed without height ───────────────────────────────────────────────────────────────────────
const flatProbe = { ...probe, elev: () => 500, sight2: (ox, oy, e, tx, ty, t) => ({ p: 1, pTerrain: 1 }), sight: () => 1 };
const flat = P.readPoint(flatProbe, R, { ...ctx, full: true, scanRoad: undefined });
check('flat ground: no OP site claimed (needs a tower or a roof)', flat.stop.op === null);

console.log(`\n${n - fails} / ${n} checks passed${fails ? `, ${fails} FAILED` : ''}`);
process.exit(fails ? 1 : 0);
