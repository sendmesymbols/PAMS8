// gunsec.mjs -- towed guns by section on mountain ground (MW s22 para 5 b p 240, para 6 a (1) p 244): gun areas near the
// roads too small for the conventional layout, so a Bty goes in two or three section sites near the road, a Regt as three
// such Btys; light (mule-packed) and SP guns keep the conventional layout; plains unchanged.
//   node tools/sitefinder-test/gunsec.mjs
// A synthetic mountain built here: ground rising 600 m over 5 km, steep everywhere (gun NO-GO) except flat terraces
// 220 x 120 m, 150 m off a road, 600 m apart along it.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const S = await import('../../MS/Engines/SiteScan/SiteScan.ts');
const G = await import('../../MS/Engines/GunDeployment/GunDeploymentFind.ts');

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const json = (p) => JSON.parse(readFileSync(resolve(repo, p), 'utf8'));
const GUN_DOC = json('MS/Data/GunDoctrine.json');
const WEAPONS = json('MS/Data/Orbat/PK/weapons.json');
const quiet = process.argv.includes('--quiet');
let fails = 0, n = 0;
function check(name, ok, info = '') {
  n++;
  if (!ok) fails++;
  if (!ok || !quiet) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
}

const O = S.lngLatToMerc(73.9, 34.4);
const sc = S.scaleAt(O[1]);
const at = (e, nn) => [O[0] + e / sc, O[1] + nn / sc];
const en = (p) => [(p[0] - O[0]) * sc, (p[1] - O[1]) * sc];
// gun NO-GO on 30 (steep slope, a stand-in for the bundle's steep classes), BUA, water, canal
const RULES = {
  classes: { '3': { label: 'Built-up area' }, '4': { label: 'Permanent water' }, '20': { label: 'Canal' }, '30': { label: 'Steep slope' } },
  profiles: { gun: { nogo: [3, 4, 20, 30], caution: [] }, wheeled: { nogo: [4, 20, 30], caution: [] }, tracked: { nogo: [4, 20], caution: [] } },
  grotbc: { soilStrength: { byProfile: { gun: 'wheeled_heavy', wheeled: 'wheeled', tracked: 'tracked' }, vehicles: { wheeled_heavy: { fine: [70, 115], coarse: [65, 100] }, wheeled: { fine: [55, 95], coarse: [50, 80] }, tracked: { fine: [45, 75], coarse: [25, 40] } } } },
};
const TERR = Array.from({ length: 9 }, (_, i) => ({ e: 150, n: -2400 + 600 * i }));
const onTerrace = (e, nn) => TERR.find((t) => Math.abs(e - t.e) <= 110 && Math.abs(nn - t.n) <= 60) ?? null;
function world({ mountain = true, open = false } = {}) {
  const base = (e, nn) => (mountain ? 1500 + 0.12 * nn : 200);
  return {
    cls: (x, y) => { const [e, nn] = en([x, y]); return open || onTerrace(e, nn) ? 0 : 30; },
    elev: (x, y) => { const [e, nn] = en([x, y]); const t = onTerrace(e, nn); return t ? base(t.e, t.n) : base(e, nn); },
    layer: (k) => (k === 'cc' ? 2 << 4 : k === 'rci_dry' || k === 'rci_wet' ? 120 : 0),
    roads: (x, y, r) => { const [e, nn] = en([x, y]); const d = Math.abs(e); return d <= r ? [{ distM: d, x: at(0, nn)[0], y, attrs: { t: 'secondary', k: 2, aw: true, c: '50', r: 'Mtn Rd' } }] : []; },
    features: () => [],
    people: () => 10,
  };
}

const R = G.gunRulesFrom(GUN_DOC);
const guns = G.gunWeapons(WEAPONS, R.planFrac.value);
const W = (id) => guns.find((w) => w.id === id);
const towed = W('122-mm-how-d-30'), pack = W('105-mm-pack-how'), sp = guns.find((w) => w.sp);
const task = (o = {}) => ({ centre: at(150, 0), radiusM: 3000, target: at(150, 9000), front: null, weapon: towed, unit: 'bty', op: 'def', season: 'dry', month: 11, ...o });

// ── the doctrine ──────────────────────────────────────────────────────────────────────────────────────────────────────
check('GunDoctrine areas.sec: a section site 200 x 100 m (two guns 100 m apart, FM 6-50 p 3-6, U; depth M)', R.areas.sec.frontM.value === 200 && R.areas.sec.frontM.basis === 'U' && R.areas.sec.depthM.value === 100 && R.areas.sec.depthM.basis === 'M');
check('mountains.bySection: a Bty in 2 or 3 places (MW p 244, D); sections 300 m apart (ATP 3-09.50 p 2-2, U); within 2 km (E, decided)', R.mountains.sitesMin === 2 && R.mountains.sitesMax === 3 && R.mountains.sitesPerBty.basis === 'D' && R.mountains.sitesPerBty.refs?.some((r) => r.book === 'mw' && r.page === '244') && R.mountains.minApartM.value === 300 && R.mountains.minApartM.basis === 'U' && R.mountains.maxSpreadM.value === 2000 && R.mountains.maxSpreadM.basis === 'E' && !!R.mountains.maxSpreadM.decided);
check('the light gun is the 105 mm Pack How (mule loads, MW p 244); towed only (MW pp 240-241)', R.mountains.lightIds.includes('105-mm-pack-how') && GUN_DOC.mountains.bySection.towedOnly.refs.some((r) => r.page === '241'));

// ── the ground test and who goes by section ──────────────────────────────────────────────────────────────────────────
check('mountainAt: 600 m of rise within 5 km reads as mountains; the flat world does not', G.mountainAt(world(), at(150, 0), R) === true && G.mountainAt(world({ mountain: false }), at(150, 0), R) === false);
check('mountainAt: no elevation read -> unknown (null)', G.mountainAt({ ...world(), elev: () => NaN }, at(150, 0), R) === null);
check('goesBySection: the towed 122 mm D-30 yes; the 105 mm Pack How (light) no; an SP gun no', G.goesBySection(towed, R) && !G.goesBySection(pack, R) && (!sp || !G.goesBySection(sp, R)));
check('gunTaskFor: towed in mountains -> section sites; light or flat ground -> as given; the caller\'s "not mountains" wins', G.gunTaskFor(world(), task(), R).area === 'sec' && !G.gunTaskFor(world(), task({ weapon: pack }), R).area && !G.gunTaskFor(world({ mountain: false }), task(), R).area && !G.gunTaskFor(world(), task(), R, false).area);

// ── the old answer on the terraces: no conventional Bty area fits ────────────────────────────────────────────────────
{
  const old = G.findGunAreas(world(), RULES, task(), R, null);
  check('the conventional 400 x 200 m Bty area finds no place on the terraces (room fails everywhere)', old.sites.length === 0 && old.rejected.room > 0, `${old.sites.length} sites, room rejected ${old.rejected.room}`);
}

// ── a Bty by sections ────────────────────────────────────────────────────────────────────────────────────────────────
{
  const t = G.gunTaskFor(world(), task(), R);
  const res = G.findGunSites(world(), RULES, t, R, null);
  const b = res.btys?.[0];
  check('mountains, a towed Bty: one Bty by sections in three section sites', res.btys?.length === 1 && b.sites.length === 3 && res.sites.length === 3, `${res.btys?.length} btys, ${b?.sites.length} sites`);
  const apart = b ? b.sites.every((s, i) => b.sites.every((q, j) => i === j || S.groundDist(s.at, q.at) >= 300 - 1)) : false;
  const within = b ? b.sites.every((s) => S.groundDist(b.sites[0].at, s.at) <= 2000 + 1) : false;
  check('...every pair of sections 300 m or more apart, every section within 2 km of the first', apart && within, b?.sites.map((s) => en(s.at).map(Math.round).join(',')).join(' | '));
  check('...each a section site with room for its two guns (200 x 100 m, all usable) on a terrace', b?.sites.every((s) => s.rows.find((r) => r.key === 'room').tone === 'ok' && /200 x 100 m/.test(s.rows.find((r) => r.key === 'room').value) && onTerrace(...en(s.at))), b?.sites.map((s) => s.rows.find((r) => r.key === 'room').value).join(' | '));
  check('...the area is the section site; the Bty row cites MW p 244 and p 240 (recce), passes', res.area.label === 'Section gun site' && b.row.tone === 'ok' && b.row.rules.some((r) => r.page === '244') && b.row.rules.some((r) => r.page === '240') && /hairpin bends/.test(b.row.why) && /not read from the data/.test(b.row.why), b?.row.value);
  check('...a note says by sections, MW pp 240, 244; each section says which of the Bty it is', res.notes.some((x) => /by sections/.test(x) && /MW pp 240, 244/.test(x)) && /The Bty, section 2 of 3/.test(b.sites[1].why[0]));
  const L = G.gunLines(res, t, (p) => en(p).map(Math.round).join(' '));
  check('the decision record carries the Bty by sections line with its cites', L.some((x) => /^The Bty: 3 section sites within/.test(x) && /\[\d/.test(x)), L.find((x) => /section sites/.test(x)));
}

// ── a Regt: three Btys by sections ───────────────────────────────────────────────────────────────────────────────────
{
  const t = G.gunTaskFor(world(), task({ unit: 'regt', radiusM: 3000 }), R);
  const res = G.findGunSites(world(), RULES, t, R, null);
  const all = (res.btys ?? []).flatMap((g) => g.sites);
  const distinct = new Set(all.map((s) => s.at.join(','))).size === all.length;
  check('a Regt: three Btys, each in 2 or 3 section sites, no site shared', res.btys?.length === 3 && res.btys.every((g) => g.sites.length >= 2 && g.sites.length <= 3) && distinct, res.btys?.map((g) => `${g.label} ${g.sites.length}`).join(', '));
  const ok = all.every((s, i) => all.every((q, j) => i === j || S.groundDist(s.at, q.at) >= 300 - 1));
  check('...every two sections of the Regt 300 m or more apart', ok);
}

// ── too few places: the Bty row warns with a fix ─────────────────────────────────────────────────────────────────────
{
  const one = { ...world(), cls: (x, y) => { const [e, nn] = en([x, y]); return Math.abs(e - 150) <= 110 && Math.abs(nn) <= 60 ? 0 : 30; } };
  const res = G.findGunSites(one, RULES, G.gunTaskFor(one, task(), R), R, null);
  check('one terrace only: one section site, the Bty row warns and says what to do', res.btys?.[0]?.sites.length === 1 && res.btys[0].tone === 'warn' && /recce/.test(res.btys[0].row.fix ?? ''), res.btys?.[0]?.row.fix);
}

// ── unchanged off the mountains, and for light guns ──────────────────────────────────────────────────────────────────
{
  const flat = world({ mountain: false, open: true });
  const t = G.gunTaskFor(flat, task(), R);
  const res = G.findGunSites(flat, RULES, t, R, null);
  check('plains (open, flat): the conventional Bty area as before, no sections', !t.area && !res.btys && res.sites.length > 0 && res.area.label === GUN_DOC.areas.bty.label, `${res.sites.length} sites, ${res.area.label}`);
  const tp = G.gunTaskFor(world({ open: true }), task({ weapon: pack }), R);
  const rp = G.findGunSites(world({ open: true }), RULES, tp, R, null);
  check('mountains, the light 105 mm Pack How: the conventional layout (MW p 241), no sections', !tp.area && !rp.btys && rp.area.label === GUN_DOC.areas.bty.label);
}

console.log(`\n${n - fails} of ${n} checks passed${fails ? `, ${fails} FAILED` : ''}`);
process.exit(fails ? 1 : 0);
