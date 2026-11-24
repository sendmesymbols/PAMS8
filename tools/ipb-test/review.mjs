// review.mjs -- checks for the Ground Guide items of Doctrine_Review.md (24 Nov 2026) that live in data and small
// engines: speeds (MW mountain foot rule, desert after rain, the M113's 60 %, MW mules), night sights in haze and fog,
// Symbols.json ranges, the bundle's rules, the observation rows and the Indian templates.   node tools/ipb-test/review.mjs
import { register } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
register('./jsonhook.mjs', import.meta.url);
register('../movement-test/hooks.mjs', import.meta.url);
const { spotKmh } = await import('../../MS/Engines/GroundGuide/GroundGuideSpeed.ts');
const { nvdReach } = await import('../../MS/Engines/GroundGuide/GroundGuideOcoka.ts');

const here = dirname(fileURLToPath(import.meta.url));
const J = (p) => JSON.parse(readFileSync(resolve(here, '../..', p), 'utf8'));
let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
}

// ── speeds ──
const T = J('MS/Data/MovementSpeeds.json');
const foot = T.movers.foot, trk = T.movers.a_tracked, pack = T.movers.pack;
const spot = (m, o) => spotKmh(T, m, { ground: 'open', step: 'go', season: 'dry', light: 'day', grade: 0, elevM: 500, ...o });
const up20 = spot(foot, { grade: 0.2, mountain: true });
check('MW on mountain ground: a 20 % climb on foot by day about 1.2 km/h (3 km/h + 45 min per 300 m)', Math.abs(up20 - 1.2) < 0.05, up20.toFixed(2));
check('... level mountain ground: 3 km/h by day, 0.75 by night (MW p 81)', Math.abs(spot(foot, { mountain: true }) - 3) < 1e-9 && Math.abs(spot(foot, { mountain: true, light: 'night' }) - 0.75) < 1e-9);
const down20 = spot(foot, { grade: -0.2, mountain: true });
check('... a 20 % descent pays half the climb rate per metre (45 min per 600 m)', down20 > up20 && Math.abs(down20 - 1 / (1 / 3 + 0.25)) < 0.01, down20.toFixed(2));
check('off mountain ground the Pakistani table stands (4 km/h on open ground by day)', Math.abs(spot(foot, {}) - 4) < 1e-9);
const sandDry = spot(foot, { ground: 'sand' }), sandWet = spot(foot, { ground: 'sand', season: 'wet' });
check('desert after rain no slower: rain cements the sand (MIB p 261)', sandDry === sandWet && sandDry > 0, `${sandDry} / ${sandWet}`);
check('... fields after rain still slower', spot(foot, { ground: 'crops', season: 'wet' }) < spot(foot, { ground: 'crops' }));
check('tracked slope factors refitted to the M113\'s 60 % (MIB Annex C p 323), over 30° still 0', trk.gradabilityPct === 60 && trk.sideSlopePct === 30 && trk.slope.factors.join() === '1,0.9,0.7,0.35,0');
check('mules in mountains: 12.9 km a day under load, 25.7 km in all; 65 kg in hills (MW pp 319-321)', pack.dayKm.mountain.combat[0] === 12.9 && pack.dayKm.mountain.none[0] === 25.7 && pack.loadKg.hilly === 65);

// ── night sights ──
const ocoka = J('MS/Data/OcokaDoctrine.json');
const ii = nvdReach(1000, false, ocoka, 5), ti = nvdReach(3000, true, ocoka, 5);
check('image intensifier: nil on a haze or fog day (IBB p 13 para 23g)', ii.hazeDayM === 0 && ii.fogDayM === 0 && ii.ordinaryM === 1000);
check('thermal: unchanged in haze (IBB p 11 para 20b, g), the E cap on a fog day', ti.hazeDayM === 3000 && ti.fogDayM === 250);
const rows = ocoka.observation.nightDevices.rows;
check('the App 4 rows are the En (Indian Army) devices; own GP/NVB-4A has no range', rows.filter((r) => r.side === 'en').length === 4 && rows.find((r) => /GP\/NVB-4A \(own\)/.test(r.device))?.m === null);
check('desert and mountain observation rows (DW p 7, MW p 52)', ocoka.observation.desert.detectKm.join() === '5,20' && !!ocoka.observation.mountain);

// ── Symbols.json ranges ──
const S = J('MS/Data/Symbols.json');
check('81 mm mortar: minimum 550 m as stated (IBB p 57)', S['10130800'].Rng.ind[0] === 550 && S['15111402'].Rng.ind[0] === 550);
check('AD missile triple is one weapon, Anza Mk-1 (IBB p 82): 50 / 2800 / 4200', S['10130102'].Rng.ad.join() === '50,2800,4200' && /Anza/.test(S['15111110'].Rng.s));

// ── the bundle's rules (git-ignored; skipped when absent) ──
const rp = resolve(here, '../../MS/Data/terrain-bundle/rules.json');
if (existsSync(rp)) {
  const R = JSON.parse(readFileSync(rp, 'utf8'));
  check('MIB symbol judged tracked, not on foot (MIB pp 10-11, 170)', R.profileOverrides.entities['10:121102'] === 'tracked');
  check('salt pan: some ground cover only (DW p 8)', R.grotbc.coverSplit.byClass['16'].join() === '0,0,1,0');
  check('dunes stay NO-GO for wheels, said why (OoW Vol II p 68, safety first)', R.profiles.wheeled.nogo.includes(14) && /safety first/.test(R.profiles.wheeled.why['14']));
} else console.log('SKIP  bundle rules.json not present');

// ── templates and IPB doctrine ──
const tpl = J('MS/Data/IpbTemplates.json');
const t = (id) => tpl.templates.find((x) => x.id === id);
check('Indian Bde defence (IDD): BOPs ahead, two Bns on the obstacle, depth Bn 1.5 km', ['bop1', 'bn1', 'bn2', 'depth'].every((k) => t('def-bde').elements.some((e) => e.id === k)) && t('def-bde').elements.find((e) => e.id === 'depth').place.fromFdlM === 1500);
check('Bde reserve 2-4 h, not 4-6 (IDD p 5)', /2-4 h/.test(t('def-bde').src) && /IDD p 5/.test(tpl.phases.defensive.rows.find((r) => r.id === 'res').src));
check('a security-zone phase in the Indian defence (IDD pp 1-2, 4)', tpl.phases.defensive.rows.some((r) => r.id === 'sz'));
check('strike bridgehead 8 km wide, 6 deep, size marked E for the En; break-out from both', t('strike-bh').elements.find((e) => e.id === 'bh1').place.boxM.join() === '8000,6000' && t('strike-bh').elements.find((e) => e.id === 'bh1').basis === 'E' && t('strike-bh').elements.some((e) => e.id === 'brk2'));
check('new templates: desert nodal points, Indian mountain defence; infiltration in the mountain attack', !!t('def-desert') && !!t('def-mtn') && t('mtn-attk').elements.some((e) => e.id === 'infil'));
const D = J('MS/Data/IpbDoctrine.json');
check('heliborne: blocks reserves, not attacks them (OoW Vol I p 62); a Coy against a forward Bn (IBB p 344)', /block the entry of reserves/.test(D.air.heliborne.text) && D.air.heliborne.sizeVsBn.value === 'Coy');
check('counter-attack minutes cited to IBB p 306', D.decisionPoints.counterAttack.coyMin.refs[0].page === '306' && D.decisionPoints.counterAttack.bnMin.refs[0].page === '306');
check('AVLB 18 m kept as the threshold; a 24 m ditch is doctrine (IBB p 331)', D.coding.hydrology.avlbSpanM.value === 18 && D.coding.hydrology.atDitchM.value === 24);
check('decoy minefields R (OoW Vol I p 38); going factor D (OoW Vol II p 18, DW p 38)', D.coding.manMade.sides.decoy.basis === 'D' && D.ownAttack.factors.find((f) => f.id === 'going').basis === 'D');
check('Rann salt lakes unsuitable for tracks all year (MIB p 262); wet slides on 15-20° (MW p 282)', !!D.coding.season.rann.trackedYearRound && D.coding.season.snowSlopes.wetSlideDeg.value.join() === '15,20');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
