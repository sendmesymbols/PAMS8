// admindes.mjs -- the Admin Area finder on desert ground (DW_Review.md N11, 28 Nov 2026): the desert test
// (SiteScan.desertGround, as the Plan Builder's Auto desert), the Forward row (as far forward as possible within easy
// turn-round, DW s24 paras 7 h, 8 a p 82), the Water row for every kind (sweet water only in tobas and the green belt,
// p 80; water points round the clock, p 86) and the desert note (mobile APs / petrol points forward, p 82).
//   node tools/sitefinder-test/admindes.mjs          (add --quiet to print only failures and the summary)
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const S = await import('../../MS/Engines/SiteScan/SiteScan.ts');
const A = await import('../../MS/Engines/AdminArea/AdminAreaFind.ts');

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const json = (p) => JSON.parse(readFileSync(resolve(repo, p), 'utf8'));
const ADMIN_DOC = json('MS/Data/AdminDoctrine.json');
const quiet = process.argv.includes('--quiet');
let fails = 0, n = 0;
function check(name, ok, info = '') {
  n++;
  if (!ok) fails++;
  if (!ok || !quiet) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
}

// the Thar round Mithi; y north, the front 20 km east (toward India)
const O = S.lngLatToMerc(69.8, 24.73);
const sc = S.scaleAt(O[1]);
const at = (e, nn) => [O[0] + e / sc, O[1] + nn / sc];
const en = (p) => [(p[0] - O[0]) * sc, (p[1] - O[1]) * sc];
const RULES = {
  classes: { '4': { label: 'Permanent water' }, '12': { label: 'Bare / desert' }, '13': { label: 'Sand' }, '14': { label: 'Sand dunes' }, '2': { label: 'Cropland' } },
  profiles: { wheeled: { nogo: [4, 14], caution: [13] }, gun: { nogo: [4, 14], caution: [13] }, tracked: { nogo: [4], caution: [14] } },
  grotbc: { soilStrength: { byProfile: { gun: 'wheeled_heavy', wheeled: 'wheeled', tracked: 'tracked' }, vehicles: { wheeled_heavy: { fine: [70, 115], coarse: [65, 100] }, wheeled: { fine: [55, 95], coarse: [50, 80] }, tracked: { fine: [45, 75], coarse: [25, 40] } } } },
};
function world({ cls = () => 12, features = [] } = {}) {
  return {
    cls: (x, y) => cls(...en([x, y])),
    elev: () => 60,
    layer: (k) => (k === 'cc' ? 1 << 4 : k === 'rci_dry' || k === 'rci_wet' ? 120 : k === 'wet' ? 0 : k === 'bld' ? 0 : null),
    roads: () => [],
    features: (x, y, r, kinds) => features.filter((f) => kinds.has(f.kind)).map((f) => ({ ...f, x: at(f.e, f.n)[0], y: at(f.e, f.n)[1], distM: S.groundDist([x, y], at(f.e, f.n)), label: f.label ?? f.kind, name: f.name ?? null, attrs: {} })).filter((f) => f.distM <= r).sort((a, b) => a.distM - b.distM),
    people: () => 10,
  };
}
const AR = A.adminRulesFrom(ADMIN_DOC);
const front = { label: 'FEBA', runs: [[at(20000, -20000), at(20000, 20000)]] };
const task = (centre, o = {}) => ({ kind: 'baa', centre, radiusM: 800, threat: null, front, gun: null, gunDepthM: 0, op: 'def', season: 'dry', vehicles: null, ...o });
const whyNot = (w, e, nn, o = {}) => A.adminWhyNot(w, RULES, task(at(e, nn), o), AR, at(e, nn), null).site.rows;
const row = (rows, key) => rows.find((r) => r.key === key);

// ── the doctrine and the desert test ────────────────────────────────────────────────────────────────────────────────
{
  const D = AR.desert;
  check('AdminDoctrine desert: the Plan Builder\'s desert test (classes 12 13 14 16, half within 3 km, M) and three DW rules with refs found (verify.py)', D.detectClasses.join() === '12,13,14,16' && D.detectShare.value === 0.5 && D.detectWithinM.value === 3000 && ['forward', 'water', 'stocks'].every((k) => D[k].basis === 'R' && D[k].refs.every((r) => r.book === 'dw' && r.checked?.status === 'ok')));
  check('SiteScan.desertGround: all bare desert reads desert, all cropland not, no class data null', S.desertGround(world(), at(0, 0), D.detectClasses, 0.5, 3000) === true && S.desertGround(world({ cls: () => 2 }), at(0, 0), D.detectClasses, 0.5, 3000) === false && S.desertGround(world({ cls: () => null }), at(0, 0), D.detectClasses, 0.5, 3000) === null);
  check('...a desert half dunes and half sand counts; a third of it not', S.desertGround(world({ cls: (e) => (e < 0 ? 14 : 13) }), at(0, 0), D.detectClasses, 0.5, 3000) === true && S.desertGround(world({ cls: (e) => (e < -1000 ? 13 : 2) }), at(0, 0), D.detectClasses, 0.5, 3000) === false);
}

// ── the rows ────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const des = world();
  // the DAA carries the operation's distance behind the front (defence 48 km): one 12 km behind its figure, one forward of it
  const want = AR.kinds.daa.behind.def.value;
  const daa = { kind: 'daa' };
  const back = whyNot(des, 20000 - (want + 12000), 0, daa), fwd = whyNot(des, 20000 - (want - 2000), 0, daa);
  const fb = row(back, 'forward'), ff = row(fwd, 'forward');
  check('desert: a DAA 12 km behind its 48 km figure gets Forward (desert) warn: as far forward as possible within easy turn-round (DW p 82)', fb?.tone === 'warn' && /DW s24 paras 7 h, 8 a p 82/.test(fb.why) && /Beyond row/.test(fb.fix), `${fb?.value} | want ${want}`);
  check('...one forward of the figure: ok', ff?.tone === 'ok', ff?.value);
  check('...the Forward row cites DW p 82 in its rules', fb?.rules?.some((r) => /82/.test(JSON.stringify(r)) && /Desert/i.test(JSON.stringify(r))), JSON.stringify(fb?.rules?.slice(-2)));
  // the AP needs no water off the desert; on it every kind gets the Water row
  const ap = { kind: 'ap' };
  const w = row(whyNot(des, 0, 0, ap), 'water');
  check('desert: every kind gets the Water row (an AP needs none off the desert); none near warns with the desert why and fix (DW pp 80, 86)', w?.tone === 'warn' && /tobas and the green belt/.test(w.why) && /DW pp 66, 80/.test(w.why) && /bowser from the green belt/.test(w.fix), w?.why);
  const wet = row(whyNot(world({ features: [{ kind: AR.needs.waterKinds[0], e: 300, n: 0, label: 'Tube well' }] }), 0, 0, ap), 'water');
  check('...a water point 300 m off: Water ok', wet?.tone === 'ok', wet?.value);
  const crop = world({ cls: () => 2 });
  check('off the desert (cropland): no Forward (desert) row on the DAA, and an AP gets no Water row', !row(whyNot(crop, 20000 - (want + 12000), 0, daa), 'forward') && !row(whyNot(crop, 0, 0, ap), 'water'));
  const res = A.findAdminSites(des, RULES, task(at(20000 - want - 4000, 0), { radiusM: 1500 }), AR);
  check('findAdminSites on desert ground: desert true, the desert note first (mobile APs, petrol points forward, DW p 82; AD after reserves and HQs, p 63)', res.desert === true && /Desert ground/.test(res.notes[0]) && /petrol points well forward/.test(res.notes[0]) && /DW s18 para 5 p 63/.test(res.notes[0]));
  const forcedOff = A.findAdminSites(des, RULES, task(at(20000 - want - 4000, 0), { radiusM: 1500, desert: false }), AR);
  check('...the task may say it is not desert (the Plan Builder\'s ground): no desert note', forcedOff.desert === false && !forcedOff.notes.some((x) => /Desert ground/.test(x)));
}

console.log(`\n${n - fails} of ${n} checks passed`);
process.exit(fails ? 1 : 0);
