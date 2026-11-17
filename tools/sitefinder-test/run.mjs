// run.mjs -- Gun Deployment and Admin Area engine checks.
//   node tools/sitefinder-test/run.mjs
// Node 24 runs the pure engines (MS/Engines/SiteScan/SiteScan.ts, GunDeployment/GunDeploymentFind.ts,
// AdminArea/AdminAreaFind.ts) on a synthetic ground near Lahore built here, so every answer has a known value: the site
// rectangle, the plane's tilt, the shares a site reads, the crest of a ridge in mils (FM 6-50 A1 / A2), the range
// low-angle fire clears it from, gun areas kept off a canal and behind the FDL, out-of-range targets, and admin areas
// kept out of the enemy gun's reach, off flood ground in a wet month, with the doctrine figures read from the JSON.
// Exit code 1 on a failure.
import { register } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const S = await import('../../MS/Engines/SiteScan/SiteScan.ts');
const G = await import('../../MS/Engines/GunDeployment/GunDeploymentFind.ts');
const A = await import('../../MS/Engines/AdminArea/AdminAreaFind.ts');

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const json = (p) => JSON.parse(readFileSync(resolve(repo, p), 'utf8'));
const GUN_DOC = json('MS/Data/GunDoctrine.json');
const ADMIN_DOC = json('MS/Data/AdminDoctrine.json');
const WEAPONS = json('MS/Data/Orbat/PK/weapons.json');

let fails = 0;
let n = 0;
function check(name, ok, info = '') {
  n++;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ── the synthetic ground ────────────────────────────────────────────────────────────────────────────────────────────
// Origin near Lahore. A world is a set of functions of ground metres east (e) and north (n) of the origin.
const O = S.lngLatToMerc(74.3, 31.5);
const sc = S.scaleAt(O[1]);
const at = (e, nn) => [O[0] + e / sc, O[1] + nn / sc];
const en = (p) => [(p[0] - O[0]) * sc, (p[1] - O[1]) * sc];

// rules.json-like profiles: gun NO-GO on canal (20), BUA (3), water (4); wheeled NO-GO on canal and water
const RULES = {
  classes: { '3': { label: 'Built-up area' }, '4': { label: 'Permanent water' }, '20': { label: 'Canal' } },
  profiles: {
    gun: { nogo: [3, 4, 20], caution: [18] },
    wheeled: { nogo: [4, 20], caution: [] },
    tracked: { nogo: [4, 20], caution: [] },
  },
  grotbc: {
    soilStrength: {
      byProfile: { gun: 'wheeled_heavy', wheeled: 'wheeled', tracked: 'tracked' },
      vehicles: { wheeled_heavy: { fine: [70, 115], coarse: [65, 100] }, wheeled: { fine: [55, 95], coarse: [50, 80] }, tracked: { fine: [45, 75], coarse: [25, 40] } },
    },
  },
};

function world(o = {}) {
  const cls = o.cls ?? (() => 0);
  const elev = o.elev ?? (() => 200);
  return {
    cls: (x, y) => cls(...en([x, y])),
    elev: (x, y) => elev(...en([x, y])),
    layer: (k, x, y) => {
      const [e, nn] = en([x, y]);
      if (k === 'cc') return (o.cc ?? (() => 2))(e, nn) << 4;
      if (k === 'wet') return (o.wet ?? (() => 0))(e, nn);
      if (k === 'rci_dry') return (o.rciDry ?? (() => 120))(e, nn);
      if (k === 'rci_wet') return (o.rciWet ?? (() => 120))(e, nn);
      if (k === 'bld') return 0;
      return null;
    },
    roads: (x, y, r) => {
      const [e] = en([x, y]);
      // one road running north-south at e = roadE
      const roadE = o.roadE ?? 0;
      const d = Math.abs(e - roadE);
      return d <= r ? [{ distM: d, x: at(roadE, en([x, y])[1])[0], y, attrs: { t: 'secondary', k: o.roadTier ?? 2, aw: o.roadAw ?? true, c: '50', r: 'N-5' } }] : [];
    },
    features: (x, y, r, kinds) => (o.features ?? []).filter((f) => kinds.has(f.kind)).map((f) => ({ ...f, ...{ x: at(f.e, f.n)[0], y: at(f.e, f.n)[1] }, distM: S.groundDist([x, y], at(f.e, f.n)), label: f.label ?? f.kind, name: null, attrs: {} })).filter((f) => f.distM <= r).sort((a, b) => a.distM - b.distM),
    people: () => o.people ?? 100,
  };
}

// ── 1. SiteScan ─────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const ring = S.rectRing(at(0, 0), 90, 400, 200); // facing east: frontage across (N-S) 400, depth along (E-W) 200
  const ex = ring.map((p) => en(p));
  const w = Math.max(...ex.map((p) => p[0])) - Math.min(...ex.map((p) => p[0]));
  const h = Math.max(...ex.map((p) => p[1])) - Math.min(...ex.map((p) => p[1]));
  check('rectRing facing east: depth 200 m along E-W, frontage 400 m across N-S', near(w, 200, 1) && near(h, 400, 1), `${w.toFixed(1)} x ${h.toFixed(1)}`);
  const L = S.lattice(at(0, 0), 1000, 100);
  check('lattice 1 km at 100 m: about pi x 10^2 = 317 points, nearest first', L.length > 300 && L.length < 330 && S.groundDist(L[0], at(0, 0)) < 1, String(L.length));
  const tilt = S.planeTilt([{ u: 0, v: 0, z: 0 }, { u: 100, v: 0, z: 8.75 }, { u: 0, v: 100, z: 0 }, { u: 100, v: 100, z: 8.75 }]);
  check('planeTilt: rise 8.75 m in 100 m = 5.0 degrees', near(tilt.tiltDeg, 5.0, 0.05), tilt.tiltDeg.toFixed(2));
  const rule = S.goingRule(RULES, 'gun', 'dry');
  const half = world({ cls: (e) => (e > 0 ? 20 : 0) }); // canal on the east half
  const r = S.readSite(half, at(0, 0), 0, 400, 400, rule, 6, 4);
  check('readSite: canal on the east half of the site -> NO-GO share 0.5', near(r.nogo, 0.5, 0.01), r.nogo.toFixed(2));
  const soft = world({ rciWet: (e) => (e > 0 ? 40 : 120) });
  const rw = S.readSite(soft, at(0, 0), 0, 400, 400, S.goingRule(RULES, 'gun', 'wet'), 6, 4);
  const rd = S.readSite(soft, at(0, 0), 0, 400, 400, S.goingRule(RULES, 'gun', 'dry'), 6, 4);
  check('readSite: cone index 40 after rain is too soft for heavy wheels (70) on half the site; dry reads firm', near(rw.softNogo, 0.5, 0.01) && rd.softNogo === 0, `${rw.softNogo} / ${rd.softNogo}`);
  check('seasonFor: 160 mm in Aug at the place = wet; 20 mm in Nov = dry', S.seasonFor(8, [10, 20, 30, 20, 20, 60, 180, 160, 70, 10, 20, 10], 100, [7, 8, 9]).season === 'wet' && S.seasonFor(11, [10, 20, 30, 20, 20, 60, 180, 160, 70, 10, 20, 10], 100, [7, 8, 9]).season === 'dry');
  check('seasonFor without climate data: Aug wet, Nov dry (monsoon months)', S.seasonFor(8, null, 100, [7, 8, 9]).season === 'wet' && S.seasonFor(11, null, 100, [7, 8, 9]).season === 'dry');
  const pr = S.pickRoad([{ distM: 100, x: 0, y: 0, attrs: { k: 1, n: 'Track' } }, { distM: 400, x: 0, y: 0, attrs: { k: 2, r: 'N-5', c: '50', aw: true } }], 2);
  check('pickRoad: the nearest road meeting class 50 is N-5 at 400 m, not the nearer track', pr.road?.distM === 400 && pr.tier === 2 && pr.label.startsWith('N-5'), pr.label);
  check('mils: 45 degrees = 800 mils', near(S.mils(Math.PI / 4), 800, 1e-9));
}

// ── 2. Gun doctrine and weapons ─────────────────────────────────────────────────────────────────────────────────────
const GR = G.gunRulesFrom(GUN_DOC);
{
  check('GunDoctrine: Bty area 400 x 200 m (FM 6-50 para 3-6, basis U)', GR.areas.bty.frontM.value === 400 && GR.areas.bty.depthM.value === 200 && GR.areas.bty.frontM.basis === 'U');
  check("GunDoctrine: Regt area 1000 x 1000 m (SO's Hbk Sec 2 p 225, basis R)", GR.areas.regt.frontM.value === 1000 && GR.areas.regt.frontM.basis === 'R');
  check("GunDoctrine: planning range 90 % (SO's Hbk p 212, R); 2/3 kept forward -> at most 1/3 behind (SZ p 24, R)", GR.planFrac.value === 0.9 && GR.planFrac.basis === 'R' && near(GR.front.def.maxFrac.value, 1 / 3, 0.001) && GR.front.def.maxFrac.basis === 'R');
  check('GunDoctrine: slope 5 deg ok / 10 deg max (JMRC, U); crest clearance 5 m, rapid tables to 300 mils (FM 6-50, U)', GR.level.okDeg.value === 5 && GR.level.maxDeg.value === 10 && GR.crest.clearM.value === 5 && GR.crest.steepMils.value === 300);
  const W = G.gunWeapons(WEAPONS, 0.9);
  const sp = W.find((w) => w.id === '155-mm-how-sp-m109-a2-a5');
  check('weapons.json: 155 mm SP M109 max 16,550 m, plan 14,895 m, self-propelled, high angle', sp && sp.maxM === 16550 && sp.planM === 14895 && sp.sp && sp.highAngle, sp ? `${sp.maxM}/${sp.planM}` : 'missing');
  check('weapons.json: 130 mm Gun is a gun (no high angle); M198 left out (no range printed); no enemy guns', W.find((w) => w.id === '130-mm-gun')?.highAngle === false && !W.some((w) => w.id === '155-mm-how-towed-m198') && !W.some((w) => w.id.startsWith('en-')));
  check('weapons.json: A-100 MLRS minimum range 40 km', W.find((w) => w.id.startsWith('300-mm-mlrs'))?.minM === 40000);
}
const W155 = G.gunWeapons(WEAPONS, 0.9).find((w) => w.id === '155-mm-how-sp-m109-a2-a5');
const W130 = G.gunWeapons(WEAPONS, 0.9).find((w) => w.id === '130-mm-gun');

// ── 3. Crest ────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  // flat ground at 100 m with a ridge 60 m high (top 160 m) 1,000 m north of the guns
  const ridge = world({ elev: (e, nn) => (nn > 950 && nn < 1050 ? 160 : 100) });
  const c = G.crestAlong(ridge, at(0, 0), 0, 8000, W155.maxM, GR, null, 25);
  // the walk steps 25 m from 30 m: the first sample on the ridge's near face (950 m) is the crest
  check('crest found at the ridge face, 955 m north (first step past 950 m)', c && c.distM === 955, c ? String(c.distM) : 'none');
  const siteExpect = c ? S.mils(Math.atan2(160 - 102 - (0.87 * c.distM * c.distM) / (2 * 6371000), c.distM)) : NaN;
  check('angle of site to the crest = atan(58 m / 955 m) = about 62 mils; A1 rounded up', c && near(c.siteMils, siteExpect, 0.05) && c.a1Mils === Math.ceil(c.siteMils), c ? `${c.siteMils.toFixed(2)} (expect ${siteExpect.toFixed(2)}), A1 ${c.a1Mils}` : '');
  check('PCR to the nearest 100 m = 1000 m; A2 = 5 m / 1.0 km = 5 mils (FM 6-50)', c && c.pcrM === 1000 && c.a2Mils === 5, c ? `${c.pcrM} / ${c.a2Mils}` : '');
  check('low-angle fire clears the ridge only from some kilometres: the range is between the crest and the max', c && c.lowMinRangeM > 1000 && c.lowMinRangeM < W155.maxM && !c.masksAll, c ? String(Math.round(c.lowMinRangeM)) : '');
  const flat = world({ elev: () => 100 });
  const cf = G.crestAlong(flat, at(0, 0), 0, 8000, W155.maxM, GR, null, 25);
  check('flat ground: no crest above the muzzle (site negative), no masked range', cf && cf.siteMils < 0 && cf.lowMinRangeM === null, cf ? cf.siteMils.toFixed(2) : '');
  const trees = world({ elev: () => 100, cls: (e, nn) => (nn > 450 && nn < 550 ? 31 : 0) });
  const ct = G.crestAlong(trees, at(0, 0), 0, 3000, W155.maxM, GR, (x, y) => (trees.cls(x, y) === 31 ? 15 : 0), 25);
  check('a forest 500 m out, 15 m high, makes the crest (what stands on the ground counts)', ct && near(ct.distM, 475, 30) && ct.siteMils > 20, ct ? `${ct.distM} m, ${ct.siteMils.toFixed(1)} mils` : '');
  const wall = world({ elev: (e, nn) => (nn > 450 && nn < 550 ? 900 : 100) });
  const cw = G.crestAlong(wall, at(0, 0), 0, 3000, W155.maxM, GR, null, 25);
  check('a crest 800 m high at 475 m: A1 + A2 over 300 mils (compute by hand), masks every low-angle range', cw && cw.steep && cw.masksAll, cw ? `${cw.a1Mils}+${cw.a2Mils}` : '');
}

// ── 4. Gun areas ────────────────────────────────────────────────────────────────────────────────────────────────────
function gunTask(o = {}) {
  return {
    centre: at(0, 0),
    radiusM: 2000,
    target: at(0, 9000),
    front: { kind: 'line', runs: [[at(-10000, 4000), at(10000, 4000)]], label: 'the FDL' },
    weapon: W155,
    unit: 'bty',
    op: 'def',
    season: 'dry',
    month: 11,
    ...o,
  };
}
{
  const open = world({ cc: () => 2, roadE: 300 });
  const res = G.findGunAreas(open, RULES, gunTask(), GR, null);
  check('open firm ground, road 300 m off, FDL 4 km ahead, target 9 km: good gun areas found', res.sites.length > 0 && res.sites[0].tone === 'ok', `${res.sites.length} sites, best ${res.sites[0]?.verdict}`);
  check('gun areas at least the alternate spacing (500 m) apart, ranked 1..n', res.sites.every((s, i) => res.sites.slice(i + 1).every((t) => S.groundDist(s.at, t.at) >= 500)) && res.sites.every((s, i) => s.rank === i + 1));
  check('each gun area faces the target (north)', res.sites.every((s) => near(((s.axisDeg + 540) % 360) - 180, 0, 15)), res.sites.map((s) => s.axisDeg.toFixed(0)).join(','));
  const fr = res.sites[0].rows.find((r) => r.key === 'front');
  check('front row: 4 km behind the FDL is ok (2 km min, 1/3 of 14.9 km = 5 km max)', fr && fr.tone === 'ok', fr?.value);

  const canal = world({ cc: () => 2, roadE: 300, cls: (e) => (Math.abs(e) < 900 ? 20 : 0) });
  const rc = G.findGunAreas(canal, RULES, gunTask(), GR, null);
  check('a canal 1.8 km wide across the centre: no gun area is centred in it', rc.sites.every((s) => Math.abs(en(s.at)[0]) >= 900 - 1) && rc.rejected.nogo > 0, `${rc.sites.length} sites, ${rc.rejected.nogo} NO-GO`);

  const far = G.findGunAreas(open, RULES, gunTask({ target: at(0, 30000) }), GR, null);
  check('target 30 km off for a 16.55 km gun: no gun area, the note says out of range', far.sites.length === 0 && far.notes.some((x) => /out of .*range/.test(x)), far.notes[0]);

  const wrong = G.findGunAreas(open, RULES, gunTask({ centre: at(0, 6000), radiusM: 1000 }), GR, null);
  check("search circle beyond the FDL on the target's side: no gun area (the note says so)", wrong.sites.length === 0 && wrong.rejected.side > 0, wrong.notes[0]);

  const nearFdl = G.findGunAreas(open, RULES, gunTask({ centre: at(0, 3200), radiusM: 400 }), GR, null);
  check('just behind the FDL (under 2 km): behind-front row fails', nearFdl.sites.length === 0 || nearFdl.sites.every((s) => s.rows.find((r) => r.key === 'front').tone === 'bad'));

  const steep = world({ cc: () => 2, roadE: 300, elev: (e, nn) => 100 + nn * Math.tan((8 * Math.PI) / 180) });
  const rs = G.findGunAreas(steep, RULES, gunTask(), GR, null);
  check('ground tilting 8 degrees: level row warns (over 5, under 10)', rs.sites.length && rs.sites.every((s) => s.rows.find((r) => r.key === 'level').tone === 'warn'), rs.sites[0]?.rows.find((r) => r.key === 'level').value);

  const ridge = world({ cc: () => 2, roadE: 300, elev: (e, nn) => (nn > 2400 && nn < 2600 ? 300 : 100) });
  // one gun area at the origin (a 100 m circle): the ridge 2.4-2.6 km north, the target 5 km north. At 5 km the 155 mm's
  // low-angle curve (fitted to 16.55 km) is 193 m up over the ridge's face, short of 198 + 5 m: masked.
  const one = { centre: at(0, 0), radiusM: 100, target: at(0, 5000), front: null };
  const rr = G.findGunAreas(ridge, RULES, gunTask(one), GR, null);
  const cr = rr.sites[0]?.rows.find((r) => r.key === 'crest');
  check('a 200 m ridge between the guns and a target 5 km off: crest row warns (a howitzer fires high angle)', cr && cr.tone === 'warn' && /high angle/.test(cr.fix ?? ''), cr?.value);
  const rr130 = G.findGunAreas(ridge, RULES, gunTask({ ...one, weapon: W130 }), GR, null);
  const cr130 = rr130.sites[0]?.rows.find((r) => r.key === 'crest');
  check('the same ridge for the 130 mm gun (no high angle): crest row fails', cr130 && cr130.tone === 'bad', cr130?.value);
  const wide = G.findGunAreas(ridge, RULES, gunTask({ target: at(0, 5000), front: null }), GR, null);
  const best = wide.sites[0]?.rows.find((r) => r.key === 'crest');
  check('searching 2 km round: the best gun area is one far enough back that low-angle fire clears the ridge', best && best.tone === 'ok' && en(wide.sites[0].at)[1] < 0, `${best?.value} at n ${Math.round(en(wide.sites[0].at)[1])}`);

  const lines = G.gunLines(res, gunTask(), (p) => `${Math.round(en(p)[0])},${Math.round(en(p)[1])}`, '');
  check('Copy as Text: header, a line per site, the firing-table caution', /^GUN DEPLOYMENT - DECISION RECORD: 155 mm How \(SP\)/.test(lines[0]) && lines.some((l) => /^1\. /.test(l)) && /firing tables/.test(lines[lines.length - 1]));
}

// ── 4b. Rules, order and "Why not here?" (gun) ───────────────────────────────────────────────────────────────────────
{
  const open = world({ cc: () => 2, roadE: 300 });
  const res = G.findGunAreas(open, RULES, gunTask(), GR, null);
  const s1 = res.sites[0];
  check('every check row of every gun area carries at least one rule', res.sites.every((s) => s.rows.every((r) => r.rules.length > 0)));
  const rng = s1.rows.find((r) => r.key === 'range').rules;
  check("Range row cites the ORBAT weapon (SOH Sec 2 p 210...) and SO's Hbk p 212, words checked in the book", rng.some((r) => r.basis === 'D' && /Sec 2/.test(r.book) && /210/.test(r.page)) && rng.some((r) => r.page === '212' && /Planning range-90 percent/.test(r.quote) && r.checked === 'ok'), rng.map((r) => `${r.book} p ${r.page} ${r.checked}`).join(' | '));
  const fr = s1.rows.find((r) => r.key === 'front').rules;
  check('Behind-front row cites SZ Battle p 24 (checked) and marks the 2 km minimum as E', fr.some((r) => /Security Zone/.test(r.book) && r.page === '24' && r.checked === 'ok') && fr.some((r) => r.basis === 'E' && !r.book && /2 km/.test(r.note ?? '')));
  check('Room row cites FM 6-50 p 3-6 (200 by 400 m) and the terrain rule for the gun', s1.rows.find((r) => r.key === 'room').rules.some((r) => r.page === '3-6') && s1.rows.find((r) => r.key === 'room').rules.some((r) => r.basis === 'T'));
  check('#1 says why it is chosen; #2 says why it is below #1 (or that they are equal choices)', /^Chosen:/.test(s1.why[0]) && /^(Below #1|Same result as #1)/.test(res.sites[1].why[0]), `${s1.why[0]} / ${res.sites[1].why[0]}`);
  const canal = world({ cc: () => 2, roadE: 300, cls: (e) => (Math.abs(e) < 900 ? 20 : 0) });
  const rc = G.findGunAreas(canal, RULES, gunTask(), GR, null);
  const ng = rc.rejectedWhy.find((r) => r.gate === 'nogo');
  check('places left out on the canal: the reason names the class and cites the terrain rule', ng && /Canal/.test(ng.text) && ng.rules.some((r) => r.basis === 'T'), ng?.text);
  const wn = G.gunWhyNot(canal, RULES, gunTask(), GR, at(0, 0), rc.sites[0], null);
  check('Why not here? on the canal: NO-GO gate, with the rule', wn.gates[0]?.gate === 'nogo' && wn.gates[0].rules.length > 0 && /^Not listed/.test(wn.verdict), wn.verdict);
  const wb = G.gunWhyNot(open, RULES, gunTask(), GR, at(0, 6000), s1, null);
  check("Why not here? beyond the FDL: the target's-side gate cites the front rule", wb.gates.some((g) => g.gate === 'side' && g.rules.some((r) => /Security Zone/.test(r.book))), wb.verdict);
  const wg = G.gunWhyNot(open, RULES, gunTask(), GR, s1.at, s1, null);
  check('Why not here? on a good place: no gate fails, every row read with its rules', wg.gates.length === 0 && wg.site.rows.every((r) => r.rules.length), wg.verdict);
  const rec = G.gunLines(res, gunTask(), (p) => `${Math.round(en(p)[0])},${Math.round(en(p)[1])}`, '', wb);
  check("decision record: rows carry [n] citations, the rules list quotes SO's Hbk p 212, the why-not is in", rec.some((l) => /\[\d+(, \d+)*\]$/.test(l)) && rec.some((l) => /^\[\d+\] .*Sec 2 Arty p 212 "Planning range-90 percent of max range" \(checked in the book\)/.test(l)) && rec.some((l) => /^Why not/.test(l)));
}

// ── 4c. Everything backed: data with sources and dates, inputs, thresholds (gun) ───────────────────────────────────────
{
  const mpath = resolve(repo, 'MS/Data/terrain-bundle/manifest.json');
  const manifest = existsSync(mpath) ? JSON.parse(readFileSync(mpath, 'utf8')) : null;
  if (manifest) {
    const cat = S.dataCatalog(manifest);
    const open = world({ cc: () => 2, roadE: 300 });
    const t = gunTask({ data: cat, inputs: { target: 'picked on the map', front: 'the FDL drawn on the map', centre: 'picked on the map' }, seasonWhy: 'Nov: 20 mm of rain in the month (wet from 100 mm)', wetFromMm: 100 });
    const res = G.findGunAreas(open, RULES, t, GR, null);
    const s1 = res.sites[0];
    const backed = (r) => r.rules.some((x) => x.role === 'data' || x.basis === 'D');
    check('with the bundle catalogue: every gun row names the data its value came from', s1.rows.every(backed), s1.rows.filter((r) => !backed(r)).map((r) => r.label).join(','));
    const air = s1.rows.find((r) => r.key === 'air').rules.find((x) => x.role === 'data');
    check('Hidden from air names the cc layer with WorldCover 2021 and the 1:50k map (never NCGDB)', /Cover \/ concealment/.test(air.book) && /WorldCover/.test(air.quote) && /2021/.test(air.quote) && /1:50k map/.test(air.quote) && !/NCGDB/.test(air.quote), air.quote);
    const firm = s1.rows.find((r) => r.key.startsWith('firm')).rules;
    check('Firm names the 10 % needs-work figure, the soil rule (STARTING PROPOSAL), SoilGrids and the month\'s rain', firm.some((x) => /10% soft needs work/.test(x.figure)) && firm.some((x) => /STARTING PROPOSAL/.test(x.note ?? '')) && firm.some((x) => /SoilGrids/.test(x.quote ?? '')) && firm.some((x) => /20 mm/.test(x.note ?? x.figure)));
    const front = s1.rows.find((r) => r.key === 'front').rules;
    check('Behind front names your inputs (the FDL drawn, the target picked)', front.some((x) => x.book === 'Your input' && /FDL drawn/.test(x.quote)) && front.some((x) => x.book === 'Your input' && /picked/.test(x.quote)));
    check('Access names the x2 fail figure and the Rd network sources', s1.rows.find((r) => r.key === 'access').rules.some((x) => /x the limit fails/.test(x.figure)) && s1.rows.find((r) => r.key === 'access').rules.some((x) => /OpenStreetMap|OSM|1:50k/.test(x.quote ?? '')));
    check('the list order is backed: method, weights, finer reading, places tried', res.orderRules.length === 4 && res.orderRules.every((x) => x.note) && /every 150 m/.test(res.orderRules[3].note), res.orderRules.map((x) => x.figure).join(', '));
    const rec = G.gunLines(res, t, (p) => `${Math.round(en(p)[0])}`, '');
    check('the decision record lists the data with dates ([data] lines) and the order line', rec.some((l) => /^\[\d+\] \[data\] .*terrain bundle built/.test(l)) && rec.some((l) => /^Order: .*\[\d/.test(l)));
  } else console.log('SKIP  data-backing checks (no terrain bundle)');
}

// ── 5. Admin areas ──────────────────────────────────────────────────────────────────────────────────────────────────
const AR = A.adminRulesFrom(ADMIN_DOC);
{
  check("AdminDoctrine: DAA 4 x 4.5 km, Def 48 km behind (SO's Hbk Sec 10 p 1054-1055, R)", AR.kinds.daa.frontM.value === 4000 && AR.kinds.daa.depthM.value === 4500 && AR.kinds.daa.behind.def.value === 48000 && AR.kinds.daa.behind.def.basis === 'R');
  check('AdminDoctrine: RP 2 x 2 km (3-5 sq km, R); 50 veh per km² (R)', AR.kinds.rp.frontM.value === 2000 && AR.kinds.rp.frontM.basis === 'R' && AR.vehPerKm2.value === 50);
  check('AdminDoctrine: Unit Ech clear of his field guns (MIB p 66, R); BAA clear of his medium guns (ATP 4-90 p 27, U)', AR.kinds.ech.beyond.value === 'field' && AR.kinds.ech.beyond.basis === 'R' && AR.kinds.baa.beyond.value === 'medium' && AR.kinds.baa.beyond.basis === 'U');
  check('AdminDoctrine: ADS not within range of his field guns (Glossary p 9, R); off the MSR 1 km (FM 63-21 p 1-4, U); people 1,500 per km2 (UN Degree of Urbanisation, S)', AR.kinds.ads.beyond.value === 'field' && AR.kinds.ads.beyond.basis === 'R' && AR.road.offMainM.value === 1000 && AR.road.offMainM.basis === 'U' && AR.checks.peopleWarnKm2.value === 1500 && AR.checks.peopleWarnKm2.basis === 'S');
  const guns = A.enemyGuns(WEAPONS);
  const m46 = A.gunFor(guns, 'medium', AR);
  const ifg = A.gunFor(guns, 'field', AR);
  check('enemy guns: medium = 130 mm M-46 27,490 m; field = 105 mm IFG 17,200 m (Sec 13 p 1325)', m46?.id === 'en-130-mm-m-46' && m46.rangeM === 27490 && ifg?.id === 'en-105-mm-ifg-lfg' && ifg.rangeM === 17200, `${m46?.name} ${m46?.rangeM}, ${ifg?.name} ${ifg?.rangeM}`);
  check('enemy guns: Bofors and Bhim are medium, D-30 field, BM-21 rocket, mortars mortar', guns.find((g) => g.id === 'en-155-mm-fh-77-bofors')?.cls === 'medium' && guns.find((g) => g.id === 'en-bhim-sp-155-mm')?.cls === 'medium' && guns.find((g) => g.id === 'en-122-mm-how-d-30')?.cls === 'field' && guns.find((g) => g.id === 'en-122-mm-bm-21-mbrl')?.cls === 'rocket' && guns.filter((g) => g.cls === 'mortar').length > 0);
  check('vehicles size the area: 200 veh at 50 per km² = 4 km² = 2,000 m square', A.adminSize({ kind: 'baa', vehicles: 200 }, AR).frontM === 2000);

  const task = (o = {}) => ({ kind: 'baa', centre: at(0, 0), radiusM: 4000, threat: [at(0, 35000)], front: null, gun: m46, gunDepthM: 0, op: 'def', season: 'dry', vehicles: null, ...o });
  const open = world({ cc: () => 2, roadE: 500, features: [{ kind: '1', e: 800, n: 0, label: 'Tube well' }] });
  const res = A.findAdminSites(open, RULES, task(), AR);
  check('BAA 35 km from the threat, clear of the M-46 (27.5 km), firm, hidden, road 500 m off: good sites', res.sites.length > 0 && res.sites[0].tone === 'ok', `${res.sites.length}, ${res.sites[0]?.verdict}`);
  check('BAA sites at least an area (2.5 km) apart', res.sites.every((s, i) => res.sites.slice(i + 1).every((t) => S.groundDist(s.at, t.at) >= AR.kinds.baa.frontM.value)));
  const close = A.findAdminSites(open, RULES, task({ threat: [at(0, 20000)], radiusM: 3000 }), AR);
  // 17-23 km from the threat, all inside the M-46's 27.5 km: places under 22 km are not even tried; the rest are laid
  // out as honest fails with the distance to move back
  const beyondRows = close.sites.map((s) => s.rows.find((r) => r.key === 'beyond'));
  check('threat 20 km off: every BAA left is a fail on the M-46 row, with the distance to move back', close.rejected.gun > 0 && close.sites.every((s) => s.tone === 'bad') && beyondRows.every((r) => r.tone === 'bad' && /M-46/.test(r.value) && /further back/.test(r.fix ?? '')), beyondRows[0]?.fix);
  const tooClose = A.findAdminSites(open, RULES, task({ threat: [at(0, 10000)], radiusM: 3000 }), AR);
  check('threat 10 km off: no BAA at all, the note names the gun', tooClose.sites.length === 0 && tooClose.notes.some((x) => /M-46/.test(x)), tooClose.notes[0]);
  const deeper = A.findAdminSites(open, RULES, task({ threat: [at(0, 20000)], radiusM: 3000, gunDepthM: 10000 }), AR);
  check('the same with his guns 10 km behind the threat place: reach 17.5 km -> sites found', deeper.sites.length > 0);
  const flood = world({ cc: () => 2, roadE: 500, wet: () => 1 });
  const fw = A.findAdminSites(flood, RULES, task({ season: 'wet' }), AR);
  const fd = A.findAdminSites(flood, RULES, task({ season: 'dry' }), AR);
  check('flood-prone ground: fails in a wet month, only warns in a dry one', fw.sites.every((s) => s.rows.find((r) => r.key === 'wet').tone === 'bad') && fd.sites.every((s) => s.rows.find((r) => r.key === 'wet').tone === 'warn'));
  const daa = A.findAdminSites(open, RULES, task({ kind: 'daa', radiusM: 6000, threat: [at(0, 48000)], front: { runs: [[at(-20000, 48000), at(20000, 48000)]], label: 'the FDL' } }), AR);
  const bh = daa.sites[0]?.rows.find((r) => r.key === 'behind');
  check('DAA 48 km behind the FDL in defence: behind-front row ok', bh && bh.tone === 'ok', bh?.value);
  const daaAdv = A.findAdminSites(open, RULES, task({ kind: 'daa', op: 'adv', radiusM: 6000, threat: [at(0, 48000)], front: { runs: [[at(-20000, 48000), at(20000, 48000)]], label: 'the FDL' } }), AR);
  check('the same DAA in an advance (15-20 km wanted): behind-front row warns', daaAdv.sites[0]?.rows.find((r) => r.key === 'behind').tone === 'warn');
  const ads = A.findAdminSites(world({ cc: () => 2, roadE: 200, features: [{ kind: '71', e: 600, n: 0, label: 'Basic health unit' }, { kind: '1', e: 300, n: 0, label: 'Tube well' }] }), RULES, task({ kind: 'ads', gun: A.gunFor(guns, 'mortar', AR), threat: [at(0, 15000)] }), AR);
  const b = ads.sites[0]?.rows.find((r) => r.key === 'buildings');
  check('ADS wants a pucca building: the BHU 600 m off is named', b && b.tone === 'ok' && /Basic health unit/.test(b.value), b?.value);
  const ech = A.findAdminSites(open, RULES, task({ kind: 'ech', gun: A.gunFor(guns, 'field', AR), radiusM: 1500 }), AR);
  const by = ech.sites[0]?.rows.find((r) => r.key === 'beyond')?.rules ?? [];
  check('Unit Ech beyond-guns row cites MIB p 66 (checked) and the en gun from Sec 13 p 1325', by.some((r) => /Mech Inf Bn/.test(r.book) && r.page === '66' && r.checked === 'ok') && by.some((r) => r.basis === 'D' && /1325/.test(r.page)), by.map((r) => `${r.book} p ${r.page}`).join(' | '));
  check('every admin row carries at least one rule', ech.sites.every((s) => s.rows.every((r) => r.rules.length > 0)));
  const bh2 = daa.sites[0]?.rows.find((r) => r.key === 'behind')?.rules ?? [];
  check("DAA behind-front row cites SO's Hbk Sec 10 p 1055 'Def. 48 kms from fwd tps'", bh2.some((r) => r.page === '1055' && /48 kms/.test(r.quote ?? '') && r.checked === 'ok'));
  const wnA = A.adminWhyNot(open, RULES, task({ threat: [at(0, 10000)] }), AR, at(0, 0), res.sites[0]);
  check('admin Why not here? 10 km from the threat: the guns gate, citing the M-46 range', wnA.gates[0]?.gate === 'gun' && wnA.gates[0].rules.some((r) => /M-46/.test(r.quote ?? '')), wnA.verdict);
  const recA = A.adminLines(res, task(), (p) => `${Math.round(en(p)[0])},${Math.round(en(p)[1])}`, '', wnA);
  check('admin decision record: why lines, rules cited, why-not', recA.some((l) => /Why: Chosen/.test(l)) && recA.some((l) => /^Rules and data cited/.test(l)) && recA.some((l) => /^Why not/.test(l)));
  {
    const mpath = resolve(repo, 'MS/Data/terrain-bundle/manifest.json');
    if (existsSync(mpath)) {
      const cat = S.dataCatalog(JSON.parse(readFileSync(mpath, 'utf8')));
      const rb = A.findAdminSites(open, RULES, task({ data: cat, inputs: { threat: 'picked on the map', gun: 'the default for a BAA' }, seasonWhy: 'Nov: dry', wetFromMm: 100 }), AR);
      const sA = rb.sites[0];
      check('with the bundle catalogue: every admin row names its data', sA.rows.every((r) => r.rules.some((x) => x.role === 'data' || x.basis === 'D')), sA.rows.filter((r) => !r.rules.some((x) => x.role === 'data' || x.basis === 'D')).map((r) => r.label).join(','));
      const pe = sA.rows.find((r) => r.key === 'people').rules;
      check('People names the 1,500 per km2 figure (Degree of Urbanisation p 52, checked) and WorldPop 2026', pe.some((x) => /1,500 per km/.test(x.figure) && x.basis === 'S' && x.page === '52' && x.checked === 'ok') && pe.some((x) => /WorldPop/.test(x.quote ?? '') && /2026/.test(x.quote ?? '')));
      check('Beyond en guns names the threat as your input and the gun as the panel default', sA.rows.find((r) => r.key === 'beyond').rules.some((x) => x.book === 'Your input' && /picked/.test(x.quote)));
    }
  }
  const noRoad = A.findAdminSites(world({ cc: () => 2, roadE: 9000 }), RULES, task({ radiusM: 2000 }), AR);
  check('no road within 3 km: road row fails and says recce a road', noRoad.sites.every((s) => s.rows.find((r) => r.key === 'road').tone === 'bad'));
}

// ── 6. Method settings (M): a search shortcut never changes a verdict ───────────────────────────────────────────────
{
  // every figure is backed: a book (R / U / S with refs), the data, a method setting (M), or a decision (E) that says
  // where it was looked for and when it was decided
  const figs = [];
  const walkF = (o, path) => {
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      if ('basis' in o && ('value' in o || 'src' in o) && path.length) figs.push([path.join('.'), o]);
      else for (const [k, v] of Object.entries(o)) if (k !== 'sources' && k !== 'basisKey' && k !== 'refs') walkF(v, [...path, k]);
    }
  };
  walkF(GUN_DOC, ['gun']);
  walkF(ADMIN_DOC, ['admin']);
  const unbacked = figs.filter(([, f]) => (f.basis === 'E' ? !(f.decided && f.searched?.length && f.src) : ['R', 'U', 'S'].includes(f.basis) ? !(f.refs ?? []).some((r) => (r.role ?? 'rule') === 'rule') && !/weapons\.json|Sec 13/.test(f.src ?? '') : f.basis === 'M' ? !f.src : false));
  check('every doctrine figure is backed: a book rule with page, a method setting with its reason, or a decision that names where it was looked for', figs.length > 80 && unbacked.length === 0, unbacked.map(([p]) => p).join(', ') || `${figs.length} figures`);
  const undecided = figs.filter(([, f]) => f.basis === 'E' && !f.decided).map(([p]) => p);
  check('no figure is left an open proposal: each E is a recorded decision (17 Nov 2026)', undecided.length === 0, undecided.join(', '));
  const unchecked = figs.flatMap(([p, f]) => (f.refs ?? []).filter((r) => r.checked?.status !== 'ok').map(() => p));
  check('every book reference was found on its page (verify.py --write)', unchecked.length === 0, [...new Set(unchecked)].join(', '));
  check('GunDoctrine: alternate posn 500 m (ATP 3-09.50 p 2-2, U); attack 1 km behind (FM 3-09.70 p 3-3, U); refraction 0.13 (Esri, M)', GR.altMinM.value === 500 && GR.altMinM.basis === 'U' && GR.front.attk.minM.value === 1000 && GR.front.attk.minM.basis === 'U' && GUN_DOC.crest.refraction.basis === 'M' && GUN_DOC.crest.refraction.refs[0].book === 'esri');
  const dec = S.figRefs(GUN_DOC.front.def.minM, 'Behind front 2 km', S.refSources(GUN_DOC));
  check('a decision reads "Decision, no book figure" with where it was looked for and the date', S.basisLabel(dec[0]) === 'Decision, no book figure' && /ATP 3-09\.50/.test(dec[0].searched ?? '') && dec[0].decided === '2026-11-17' && /Looked for in/.test(S.refLine(dec[0])));
  check('GunDoctrine: the search shortcuts, the data-sufficiency rules and the order are method settings (M)', ['frontGateFrac', 'minKnownGate'].every((k) => GUN_DOC.scan[k].basis === 'M') && GUN_DOC.checks.minKnownShare.basis === 'M' && GUN_DOC.order.pre.basis === 'M');
  check('AdminDoctrine: gun / wet shortcuts M; the room cut stays a decision (E: it leaves out what the room row only warns on)', ADMIN_DOC.scan.gunGateFrac.basis === 'M' && ADMIN_DOC.scan.wetGateX.basis === 'M' && ADMIN_DOC.scan.roomGateX.basis === 'E');
  // every place a shortcut cuts, read in full by "Why not here?", fails the same check
  const grid = [];
  for (let e = -3000; e <= 3000; e += 500) for (let nn = -3000; nn <= 3000; nn += 500) grid.push(at(e, nn));
  const open = world({ cc: () => 2, roadE: 300 });
  const gt = gunTask({ front: { kind: 'line', runs: [[at(-10000, 1500), at(10000, 1500)]], label: 'the FDL' }, target: at(0, 9000) });
  let cut = 0, held = 0;
  for (const p of grid) {
    const w = G.gunWhyNot(open, RULES, gt, GR, p, null, null);
    if (!w.gates.some((g) => g.gate === 'front')) continue;
    cut++;
    if (w.site.rows.find((r) => r.key === 'front')?.tone === 'bad') held++;
  }
  check('gun front shortcut: every place it cuts (nearer than half the 2 km minimum) fails Behind front when read in full', cut > 0 && held === cut, `${held} / ${cut}`);

  const m46 = A.gunFor(A.enemyGuns(WEAPONS), 'medium', AR);
  const at0 = { kind: 'baa', centre: at(0, 0), radiusM: 4000, threat: [at(0, 24000)], front: null, gun: m46, gunDepthM: 0, op: 'def', season: 'dry', vehicles: null };
  cut = 0;
  held = 0;
  let wcut = 0, wheld = 0;
  const wetHalf = world({ cc: () => 2, roadE: 300, wet: (e) => (e > 0 ? 4 : 0) });
  for (const p of grid) {
    const w = A.adminWhyNot(wetHalf, RULES, at0, AR, p, null);
    if (w.gates.some((g) => g.gate === 'gun')) {
      cut++;
      if (w.site.rows.find((r) => r.key === 'beyond')?.tone === 'bad') held++;
    }
    if (w.gates.some((g) => g.gate === 'wet')) {
      wcut++;
      if (w.site.rows.find((r) => r.key === 'wet')?.tone === 'bad') wheld++;
    }
  }
  check("admin gun shortcut: every place it cuts (under 80 % of the M-46's reach) fails Beyond en guns when read in full", cut > 0 && held === cut, `${held} / ${cut}`);
  check('admin wet shortcut: every place it cuts (3 x the waterlogged limit) fails Flood / drainage when read in full', wcut > 0 && wheld === wcut, `${wheld} / ${wcut}`);
}

console.log(`\n${n - fails} / ${n} checks passed`);
process.exit(fails ? 1 : 0);
