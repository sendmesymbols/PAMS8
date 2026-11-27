// adminmtn.mjs -- admin areas on mountain ground (MW s25 para 3 pp 264-265): the rows Slides (p 264; p 281: over 35°
// fails, over 25° warns where snow lies), Part way up (not the valley floor where the nullahs flood, p 9, nor the top),
// Rock / gravel (p 265), Helipad Gr (a recorded helipad or a level patch of 4° or less, p 265 / p 256), Water for every
// kind (p 264, p 266), the room row citing p 265, the mountain note; plains unchanged.
//   node tools/sitefinder-test/adminmtn.mjs          (add --quiet to print only failures and the summary)
// Synthetic grounds built here, near Muzaffarabad: a valley with sides rising 19°, a cliff above a site, a 10° hillside
// with one level patch, and flat plains.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const S = await import('../../MS/Engines/SiteScan/SiteScan.ts');
const A = await import('../../MS/Engines/AdminArea/AdminAreaFind.ts');
const G = await import('../../MS/Engines/GunDeployment/GunDeploymentFind.ts');

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const json = (p) => JSON.parse(readFileSync(resolve(repo, p), 'utf8'));
const ADMIN_DOC = json('MS/Data/AdminDoctrine.json');
const GUN_DOC = json('MS/Data/GunDoctrine.json');
const quiet = process.argv.includes('--quiet');
let fails = 0, n = 0;
function check(name, ok, info = '') {
  n++;
  if (!ok) fails++;
  if (!ok || !quiet) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
}

const O = S.lngLatToMerc(73.47, 34.37);
const sc = S.scaleAt(O[1]);
const at = (e, nn) => [O[0] + e / sc, O[1] + nn / sc];
const en = (p) => [(p[0] - O[0]) * sc, (p[1] - O[1]) * sc];
const RULES = {
  classes: { '4': { label: 'Permanent water' }, '15': { label: 'Rocky ground / scree / stony waste' }, '20': { label: 'Canal' } },
  profiles: { wheeled: { nogo: [4, 20], caution: [] }, gun: { nogo: [4, 20], caution: [] }, tracked: { nogo: [4, 20], caution: [] } },
  grotbc: { soilStrength: { byProfile: { gun: 'wheeled_heavy', wheeled: 'wheeled', tracked: 'tracked' }, vehicles: { wheeled_heavy: { fine: [70, 115], coarse: [65, 100] }, wheeled: { fine: [55, 95], coarse: [50, 80] }, tracked: { fine: [45, 75], coarse: [25, 40] } } } },
};
function world({ elev, cls = () => 0, features = [], rci = 120 } = {}) {
  return {
    cls: (x, y) => cls(...en([x, y])),
    elev: (x, y) => elev(...en([x, y])),
    layer: (k) => (k === 'cc' ? 2 << 4 : k === 'rci_dry' || k === 'rci_wet' ? rci : k === 'wet' ? 0 : k === 'bld' ? 0 : null),
    roads: () => [],
    features: (x, y, r, kinds) => features.filter((f) => kinds.has(f.kind)).map((f) => ({ ...f, x: at(f.e, f.n)[0], y: at(f.e, f.n)[1], distM: S.groundDist([x, y], at(f.e, f.n)), label: f.label ?? f.kind, name: f.name ?? null, attrs: {} })).filter((f) => f.distM <= r).sort((a, b) => a.distM - b.distM),
    people: () => 10,
  };
}
const AR = A.adminRulesFrom(ADMIN_DOC);
const task = (centre, o = {}) => ({ kind: 'ech', centre, radiusM: 800, threat: null, front: null, gun: null, gunDepthM: 0, op: 'def', season: 'dry', vehicles: null, ...o });
const rowsAt = (w, e, nn, o = {}) => A.adminWhyNot(w, RULES, task(at(e, nn), o), AR, at(e, nn), null).site.rows;
const row = (rows, key) => rows.find((r) => r.key === key);

// ── the doctrine ──────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const M = AR.mountains;
  check('AdminDoctrine mountains: slides 35° / 25° (MW p 281, R), snow above 2000 m (p 1, R), helipad 4° (p 256, R)', M.slideDeg.value === 35 && M.slideDeg.basis === 'R' && M.freshSnowDeg.value === 25 && M.snowAboveM.value === 2000 && M.helipadDeg.value === 4 && M.helipadDeg.basis === 'R');
  check('...the distances are decisions (E, decided and searched): slides 500 m, part way 1.5 km, helipad 3 km, landing point 80 m, snow months', ['slideReachM', 'partWayWithinM', 'helipadM', 'helipadSideM'].every((k) => M[k].basis === 'E' && M[k].decided && M[k].searched?.length) && M.snowMonths.basis === 'E' && M.snowMonths.decided);
  check('...the mountain test is the gun finder\'s (400 m within 5 km), the same SiteScan.mountainGround', M.detectRiseM.value === 400 && M.detectWithinM.value === 5000 && G.gunRulesFrom(GUN_DOC).mountains.detectRiseM.value === 400);
}

// ── a valley: sides rising 19° from a floor 600 m wide ────────────────────────────────────────────────────────────────
{
  const valley = world({ elev: (e) => 1000 + 0.35 * Math.max(0, Math.abs(e) - 300) });
  check('the valley reads as mountain ground (SiteScan.mountainGround)', S.mountainGround(valley, at(0, 0), 400, 5000) === true);
  const floor = rowsAt(valley, 0, 0);
  const pw = row(floor, 'partway');
  check('on the valley floor: Part way up warns, the nullahs flood (MW p 9), the book wants part way up (p 264)', pw?.tone === 'warn' && /valley floor/.test(pw.why) && /MW p 9/.test(pw.why) && /p 264/.test(pw.why) && /nullah bed/.test(pw.fix ?? ''), `${pw?.value} | ${pw?.why}`);
  const side = rowsAt(valley, 1500, 0);
  const pw2 = row(side, 'partway');
  check('part way up the side (about 45 % up): passes', pw2?.tone === 'ok' && /of the way up/.test(pw2.value), pw2?.value);
  const sl = row(side, 'slides');
  check('...the 19° slope above it: no slide danger (under 25°)', sl?.tone === 'ok' && /nothing over 25°/.test(sl.value), sl?.value);
  const top = rowsAt(world({ elev: (e) => 2500 - 0.35 * Math.abs(e) }), 0, 0);
  check('on the top of a ridge: Part way up warns (the downwind side, part way up, p 264)', row(top, 'partway')?.tone === 'warn' && /on the top/.test(row(top, 'partway').why));
  const w = row(side, 'water');
  check('every kind gets Water on mountain ground: a stream or lake near (MW p 264), seldom on the heights (p 266)', !!w && /MW p 264/.test(w.why) && /p 266/.test(w.why) && w.rules.some((r) => r.page === '266') && w.rules.some((r) => r.page === '264'), w?.why);
  check('...the Room row cites MW p 265 (sufficient size to allow proper dispersion)', row(side, 'room').rules.some((r) => r.page === '265' && /dispersion/.test(r.quote ?? '')));
}

// ── slides: a 45° cliff 400-700 m east of the site, and a 30° slope high up in winter ─────────────────────────────────
{
  const cliff = world({ elev: (e) => 1500 + (e > 400 && e < 700 ? e - 400 : e >= 700 ? 300 + (e - 700) * 0.1 : 0) });
  const sl = row(rowsAt(cliff, 0, 0), 'slides');
  check('a 45° slope 400-700 m above the site: Slides fails (over 35°, MW p 281; free of slides, p 264), named with its bearing', sl?.tone === 'bad' && /slope 4\d° above it/.test(sl.value) && / E$/.test(sl.value) && /MW p 264/.test(sl.why) && /p 281/.test(sl.why) && !!sl.fix, `${sl?.value} | ${sl?.fix}`);
  const steep30 = (base) => world({ elev: (e) => base + (e > 400 && e < 900 ? (e - 400) * 0.58 : e >= 900 ? 290 + (e - 900) * 0.1 : 0) });
  const dec = row(rowsAt(steep30(2500), 0, 0, { month: 12 }), 'slides');
  check('a 30° slope above a site at 2,500 m in December: warns (deep new snow over 25° for 2-3 days, p 281)', dec?.tone === 'warn' && /snow lies here/.test(dec.why), `${dec?.value} | ${dec?.why}`);
  const jul = row(rowsAt(steep30(2500), 0, 0, { month: 7 }), 'slides');
  check('...the same in July: passes, said why (out of the snow months)', jul?.tone === 'ok' && /out of the snow months/.test(jul.why), jul?.why);
  const low = row(rowsAt(steep30(1200), 0, 0, { month: 12 }), 'slides');
  check('...the same slope at 1,200 m in December: passes (below the snow, MW p 1)', low?.tone === 'ok');
  const any = row(rowsAt(steep30(2500), 0, 0), 'slides');
  check('...no month given: every month counts (safety first): warns', any?.tone === 'warn');
}

// ── helipad Gr: a 10° hillside with one level patch 1.2 km east; a recorded helipad ──────────────────────────────────
{
  const hill = (patch) => world({ elev: (e, nn) => (patch && Math.hypot(e - 1200, nn) < 80 ? 1500 + 0.176 * 1100 : 1500 + 0.176 * e + (e < 0 ? 0 : 0)) });
  const withPatch = row(rowsAt(hill(true), 0, 0), 'helipad');
  check('a level patch 1.2 km east: Helipad Gr passes, "level patch ... E", confirm on the ground (MW p 265, p 256)', withPatch?.tone === 'ok' && /level patch \d+° 1\.\d km E/.test(withPatch.value) && /confirm it on the ground/.test(withPatch.why), withPatch?.value);
  const none = row(rowsAt(hill(false), 0, 0), 'helipad');
  check('...no patch within 3 km: warns, engineers build helipads (MW p 248)', none?.tone === 'warn' && /no patch of 4° or less within 3/.test(none.value) && /MW p 248/.test(none.fix ?? ''), `${none?.value} | ${none?.fix}`);
  const rec = row(rowsAt(world({ elev: (e) => 1500 + 0.176 * e, features: [{ kind: '40', e: 2000, n: 0, label: 'Helipad', name: 'Kel' }] }), 0, 0), 'helipad');
  check('...a recorded helipad 2 km east: named first', rec?.tone === 'ok' && /Helipad Kel 2\.0 km E/.test(rec.value), rec?.value);
}

// ── rock or gravel ────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const v = (cls, rci) => world({ elev: (e) => 1000 + 0.35 * Math.max(0, Math.abs(e) - 300), cls, rci });
  const rock = row(rowsAt(v(() => 15, 120), 1500, 0), 'rock');
  check('rocky / stony ground on the area: Rock / gravel passes (MW p 265)', rock?.tone === 'ok' && /rocky \/ stony Gr 100%/.test(rock.value) && rock.rules.some((r) => r.page === '265'), rock?.value);
  const firm = row(rowsAt(v(() => 0, 120), 1500, 0), 'rock');
  check('...no rock but firm soil on the cone index: passes, said so', firm?.tone === 'ok' && /firm soil on the cone index/.test(firm.value), firm?.value);
  const soft = row(rowsAt(v(() => 0, 30), 1500, 0), 'rock');
  check('...no rock and soft soil: warns, hard standing', soft?.tone === 'warn' && /Hard standing/.test(soft.fix ?? ''), soft?.value);
}

// ── the search and the note; plains unchanged ─────────────────────────────────────────────────────────────────────────
{
  const valley = world({ elev: (e) => 1000 + 0.35 * Math.max(0, Math.abs(e) - 300) });
  const res = A.findAdminSites(valley, RULES, task(at(1200, 0), { radiusM: 1200 }), AR);
  check('the search on mountain ground: result marked mountain, the note leads (MW s25 para 3 pp 264-265, downwind and defence to confirm)', res.mountain === true && /Mountain ground/.test(res.notes[0]) && /downwind side/.test(res.notes[0]) && /pp 264-265/.test(res.notes[0]), res.notes[0]?.slice(0, 160));
  check('...every site carries Slides, Part way up, Rock / gravel, Helipad Gr and Water', res.sites.length > 0 && res.sites.every((s) => ['slides', 'partway', 'rock', 'helipad', 'water'].every((k) => s.rows.some((r) => r.key === k))));
  const rec = A.adminLines(res, task(at(1200, 0)), (p) => `${Math.round(en(p)[0])}`, '');
  check('...the decision record cites Mountain Warfare with page numbers', rec.some((l) => /Mountain Warfare p 281/.test(l)) && rec.some((l) => /Mountain Warfare p 265/.test(l)));
  const plains = world({ elev: () => 200 });
  const pr = A.findAdminSites(plains, RULES, task(at(0, 0)), AR);
  check('plains: not mountain ground, none of the mountain rows, no note', pr.mountain === false && pr.sites.every((s) => !s.rows.some((r) => ['slides', 'partway', 'rock', 'helipad'].includes(r.key))) && !pr.notes.some((x) => /Mountain ground/.test(x)));
  const forced = A.findAdminSites(plains, RULES, task(at(0, 0), { mountain: true }), AR);
  check('...a caller that knows the ground (mountain: true) gets the rows on any ground', forced.mountain === true && forced.sites.every((s) => s.rows.some((r) => r.key === 'slides')));
}

console.log(`\n${n - fails} of ${n} checks passed${fails ? `, ${fails} FAILED` : ''}`);
process.exit(fails ? 1 : 0);
