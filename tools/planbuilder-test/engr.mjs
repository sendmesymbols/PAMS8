// engr.mjs -- checks engineers with a plan (MS/Engines/DeploymentBuilder/PlanEngr.ts and PlanOrbat.minefieldRow): the
// engineer units of the ORBAT (engr.json: SO's Hbk 2019 Sec 4) with their Pls and equipment, the protective minefield
// in time with them (p 439: by hand, and the MMLs), their bridging across a gap (pp 427-432: ribbon bridge, AM-50, AVLB),
// the mechanical breach with TAMs (p 451), and on a crossing laid on the ground (through PlanCrossing).
//   node tools/planbuilder-test/engr.mjs          (add --quiet to print only failures and the summary)
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const O = await import('../../MS/Engines/DeploymentBuilder/PlanOrbat.ts');
const E = await import('../../MS/Engines/DeploymentBuilder/PlanEngr.ts');

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
const doc = { plan: json('MS/Data/PlanDoctrine.json'), ocoka: json('MS/Data/OcokaDoctrine.json') };
const P = 'MS/Data/Orbat/PK/';
const orbat = { own: O.mergeOwn(O.OWN_ORBAT_FILES.map((f) => json(`${P}${f}`).units)), en: json(`${P}en.json`).units, weapons: json(`${P}weapons.json`).weapons, engrData: json(`${P}engr.json`).engrData };

// ── the engineer units ───────────────────────────────────────────────────────────────────────────────────────────────
const ts = E.ownEngrTypes(orbat), T = (id) => ts.find((t) => t.id === id);
check('offered: Fd Coy, IFCE, IMCE, the Def and Offn Div Engr Bns, the Mech, Aslt and Br Bns', ts.map((t) => t.id).join() === 'engr-fd-coy,engr-ifce,engr-imce,engr-bn-def-inf-div-corps,engr-bn-offn-inf-div,engr-bn-mech,engr-bn-aslt,engr-bn-br', ts.map((t) => t.id).join(' '));
const k = (t) => [t.pls, t.mml, t.tam, t.miclic, t.avlb, t.ribbon, t.am50].join('/');
check('Fd Coy 3 Pls; Def Engr Bn 9 Pls and 9 MML (p 404); Offn 9 Pls, 6 MML, 5 TAM, 5 MICLIC, 1 AM-50 (p 402)', k(T('engr-fd-coy')) === '3/0/0/0/0/0/0' && k(T('engr-bn-def-inf-div-corps')) === '9/9/0/0/0/0/0' && k(T('engr-bn-offn-inf-div')) === '9/6/5/5/0/0/1', `${k(T('engr-bn-def-inf-div-corps'))} ${k(T('engr-bn-offn-inf-div'))}`);
check('Aslt Engr Bn 9 Pls (2 Aslt Engr + 1 Aslt Fd a Coy, 3 Coys), 15 TAM, 9 AVLB, 3 AM-50 (p 408); Br Bn no laying Pls, 2 ribbon, 4 AM-50 (p 412); Mech 4 Pls, 4 MML, 6 AVLB', k(T('engr-bn-aslt')) === '9/0/15/0/9/0/3' && k(T('engr-bn-br')) === '0/0/0/0/0/2/4' && k(T('engr-bn-mech')) === '4/4/0/0/6/0/0', `${k(T('engr-bn-aslt'))} ${k(T('engr-bn-br'))} ${k(T('engr-bn-mech'))}`);
check('the line names Pls and equipment, sets singular and plural', E.engrText(T('engr-bn-offn-inf-div')) === 'Offn Inf Div Engr Bn: 9 engineer Pls, 6 MML, 5 TAM, 5 MICLIC, 1 AM-50 / HMB set' && /2 ribbon bridge sets, 4 AM-50 \/ HMB sets/.test(E.engrText(T('engr-bn-br'))), E.engrText(T('engr-bn-offn-inf-div')));

// ── the minefield ────────────────────────────────────────────────────────────────────────────────────────────────────
const std = O.brief(orbat, 'inf-bn-std');
const m0 = O.minefieldRow(orbat, doc, 3500, std), mFd = O.minefieldRow(orbat, doc, 3500, std, T('engr-fd-coy')), mDef = O.minefieldRow(orbat, doc, 3500, std, T('engr-bn-def-inf-div-corps'));
check('no engineers chosen: the doctrine row as before (one Engr Fd Coy, about 36 h)', /one Engr Fd Coy \(3 Pls at 780 in 24 h, SO's Hbk p 439\) about 36 h/.test(m0.reason) && m0.st === 'pass', m0.reason);
check('the Fd Coy chosen: the same 36 h, named', /the Fd Coy by hand with its 3 Pls .* about 36 h/.test(mFd.reason) && mFd.st === 'pass', mFd.reason);
check('the Def Engr Bn: by hand with 9 Pls about 12 h; with its MMLs (one set of 6, 3 in reserve) alongside about 5 h (p 439, under trial)', /9 Pls .* about 12 h/.test(mDef.reason) && /with its MMLs .*1 set, the rest in reserve\) about 5 h/.test(mDef.reason) && /under trial/.test(mDef.reason) && mDef.st === 'pass', mDef.reason);
const wide = O.minefieldRow(orbat, doc, 12000, std, T('engr-bn-def-inf-div-corps'));
check('12 km of front: by hand 41 h, over the 36 h to be ready; with the MMLs 18 h: pass on the faster', /about 41 h/.test(wide.reason) && /about 18 h/.test(wide.reason) && wide.st === 'pass', wide.reason);
const mBr = O.minefieldRow(orbat, doc, 3500, std, T('engr-bn-br'));
check('the Br Bn: no Pls that lay mines: warn, more engineers', mBr.st === 'warn' && /no engineer Pls that lay mines/.test(mBr.reason), mBr.reason);
const mMech = O.minefieldRow(orbat, doc, 3500, std, T('engr-bn-mech'));
check('the Mech Engr Bn: 4 MML, short of a set of 6: said', /4 MML, short of a set of 6/.test(mMech.reason), mMech.reason);
const h = E.minesByEngr(T('engr-bn-def-inf-div-corps'), 9000, 780);
check('minesByEngr: 9 km with one MML set (9000 m) and 9 Pls (7020 m) in 24 h: 13 h; by hand 31 h', h.sets === 1 && h.mechH === 13 && h.handH === 31, JSON.stringify(h));

// ── bridging ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const kinds = E.bridgeKinds(orbat.engrData);
check('the tables: ribbon bridge (US figures) 100 m Cl 60, 1 h / 1 h 15 / 1 h 30; AM-50 54 m Cl 50 as printed; AVLB (Pak, T-59) 18 m Cl 60 in 3 min', kinds.ribbon?.spanM === 100 && kinds.ribbon.cls === 60 && JSON.stringify(kinds.ribbon.hours) === '[1,1.25,1.5]' && kinds.am50?.spanM === 54 && JSON.stringify(kinds.am50.hours) === '[1.75,1,1.25]' && kinds.avlb?.spanM === 18 && kinds.avlb.cls === 60, JSON.stringify(kinds));
const B = (id, need, li = 2) => E.engrBridge(T(id), need, li, kinds);
check('Br Bn over 70 m on a dark night: one AM-50 set is too short (54 m), the ribbon bridge: 1 h 30, open H+1 h 30', B('engr-bn-br', 70)?.openH === 1.5 && /Ribbon bridge \(Cl 60\) across 70 m: 1 h 30 min by dark night/.test(B('engr-bn-br', 70).row.reason) && /Br Bn Engrs' Ribbon/.test(B('engr-bn-br', 70).row.reason), B('engr-bn-br', 70)?.row.reason);
check('Br Bn over 50 m: the AM-50 (1 h 15 dark) beats the ribbon bridge (1 h 30)', B('engr-bn-br', 50)?.openH === 1.25 && /AM-50/.test(B('engr-bn-br', 50).row.reason));
check('Br Bn over 150 m: two ribbon sets one after the other, 3 h (E)', B('engr-bn-br', 150)?.openH === 3 && /2 sets/.test(B('engr-bn-br', 150).row.reason) && /one after the other, E/.test(B('engr-bn-br', 150).row.reason));
check('...over 250 m: more than it holds: warn, the Div\'s M2 or Corps', B('engr-bn-br', 250)?.row.st === 'warn' && B('engr-bn-br', 250).openH === null);
check('Aslt Engr Bn over a 15 m ditch: the AVLB, 3 min', B('engr-bn-aslt', 15)?.openH === 0.05 && /AVLB/.test(B('engr-bn-aslt', 15).row.reason) && /3 min/.test(B('engr-bn-aslt', 15).row.reason));
check('a Fd Coy holds no bridging: no row', B('engr-fd-coy', 50) === null);
check('by day the AM-50 is 1 h 45 as printed (slower than by moonlight: so printed)', E.engrBridge(T('engr-bn-aslt'), 50, 0, kinds).openH === 1.75 && E.engrBridge(T('engr-bn-aslt'), 50, 1, kinds).openH === 1);

// ── the TAM breach ───────────────────────────────────────────────────────────────────────────────────────────────────
const tb = E.tamBreach(T('engr-bn-aslt'), 2, 950, 6);
check('Aslt Engr Bn, 2 lanes 950 m deep: one TAM a lane, about 3 h 10 min each (p 451: 600 m 2 h, 900 m 3 h, uncertain reading) against 6 h by hand', tb.row.st === 'pass' && tb.h === 3.2 && /about 3 h 12 min each/.test(tb.row.reason) && /uncertain/.test(tb.row.reason) && /6 h by hand/.test(tb.row.reason), tb.row.reason);
const tb2 = E.tamBreach(T('engr-bn-offn-inf-div'), 6, 900, 6);
check('the Offn Engr Bn\'s 5 TAMs for 6 lanes: short of 1, the rest by hand (warn); its MICLIC named', tb2.row.st === 'warn' && /short of 1/.test(tb2.row.reason) && /5 MICLIC/.test(tb2.row.reason), tb2.row.reason);
check('no TAMs: no row', E.tamBreach(T('engr-fd-coy'), 2, 950, 6) === null);

console.log(`\n${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
