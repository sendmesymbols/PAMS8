// avn.mjs -- checks the Air Aslt Bn's air lift (MS/Engines/DeploymentBuilder/PlanAvn.ts): the Air Aslt Sqn's hels and
// loads from the ORBAT (avn.json avnData, weapons.json: SO's Hbk 2019 Sec 7), the troops lifted (inf.json), the waves,
// the round trip and the build-up on the LZ against PlanDoctrine airAslt (E), and the Air lift row.
//   node tools/planbuilder-test/avn.mjs          (add --quiet to print only failures and the summary)
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const O = await import('../../MS/Engines/DeploymentBuilder/PlanOrbat.ts');
const V = await import('../../MS/Engines/DeploymentBuilder/PlanAvn.ts');

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const quiet = process.argv.includes('--quiet');
const json = (p) => JSON.parse(readFileSync(resolve(repo, p), 'utf8'));
let fails = 0, n = 0;
function check(name, ok, info = '') {
  n++;
  if (!ok) fails++;
  if (!ok || !quiet) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
}
const plan = json('MS/Data/PlanDoctrine.json');
const doc = { plan, ocoka: json('MS/Data/OcokaDoctrine.json') };
const P = 'MS/Data/Orbat/PK/';
const orbat = { own: O.mergeOwn(O.OWN_ORBAT_FILES.map((f) => json(`${P}${f}`).units)), en: json(`${P}en.json`).units, weapons: json(`${P}weapons.json`).weapons, avnData: json(`${P}avn.json`).avnData };

check('the Air Aslt Bn is recognised; a rifle Bn is not', V.isAirAslt('inf-bn-air-aslt') && !V.isAirAslt('inf-bn-inf') && !V.isAirAslt(null) && V.airLiftOf(orbat, 'inf-bn-inf', doc) === null);
const l = V.airLiftOf(orbat, 'inf-bn-air-aslt', doc);
check('the Air Aslt Sqn: 12 Air Aslt Hels (2 Flts x 6) as the Bell 412 (9 troops, 220 km/h), 5 Cargo Hels taken as the Bell 412 (E)', l?.hels.length === 2 && l.hels[0].count === 12 && /Bell 412/.test(l.hels[0].type) && l.hels[0].troops === 9 && l.hels[0].kmh === 220 && l.hels[1].count === 5 && l.hels[1].assumed, JSON.stringify(l?.hels));
check('...153 troops a wave', l.perWave === 153);
check('the troops lifted: Bn HQ 45, 4 STCs 588, Cbt Sp Coy 98 = 731; the Adm Pl by road; an STC 147', l.troops === 731 && l.lifted.length === 3 && l.coy === 147 && !l.lifted.some((x) => /Adm/.test(x.name)), JSON.stringify(l.lifted));
check('5 waves; a round trip 25 km each way at 220 km/h plus 10 min on the ground = 24 min (E figures)', l.waves === 5 && l.turnMin === 24 && l.pzLzKm === 25 && l.groundMin === 10, `${l.waves} waves, ${l.turnMin} min`);
check('...the Bn complete 1.6 h after the first wave lands: within the 2 h (E)', Math.abs(l.buildH - 1.6) < 1e-9 && l.maxH === 2);
const r = V.airLiftRow(l);
check('Air lift row: pass; the first wave (153) lands more than an STC (147)', r.name === 'Air lift' && r.st === 'pass' && /153 a wave/.test(r.reason) && /5 waves/.test(r.reason), r.reason);
// a far PZ: 60 km each way
const far = V.airLiftOf(orbat, 'inf-bn-air-aslt', { ...doc, plan: { ...plan, airAslt: { ...plan.airAslt, pzLzKm: { value: 60 } } } });
check('a PZ 60 km out: the round trip 43 min, the build-up 2.9 h: warn, with the remedies', far.turnMin === 43 && V.airLiftRow(far).st === 'warn' && /second Sqn/.test(V.airLiftRow(far).reason), `${far.turnMin} min, ${far.buildH.toFixed(1)} h`);
// the Cargo Flt as Mi-17s: 5 x 24
const mi = V.airLiftOf(orbat, 'inf-bn-air-aslt', { ...doc, plan: { ...plan, airAslt: { ...plan.airAslt, cargoHel: { value: 'mi-17' } } } });
check('the Cargo Flt as Mi-17s (24 troops, 230 km/h): 228 a wave, 4 waves; the slower Bell sets the pace', mi.perWave === 108 + 120 && mi.waves === 4 && mi.turnMin === 24, `${mi.perWave} a wave, ${mi.waves} waves`);
// without the Air Aslt Sqn in the ORBAT
check('no Air Aslt Sqn in the ORBAT: no lift', V.airLiftOf({ ...orbat, own: orbat.own.filter((u) => u.id !== 'avn-sqn-air-aslt') }, 'inf-bn-air-aslt', doc) === null);

console.log(`\n${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
