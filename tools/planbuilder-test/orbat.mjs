// orbat.mjs -- checks the ORBAT in the Intelligent Deployment tab (MS/Engines/DeploymentBuilder/PlanOrbat.ts and where
// PlanFit / PlanWhatIf / PlanCheck use it), on the real MS/Data/Orbat/PK files (SO's Hbk 2019, RESTD: read locally).
//   node tools/planbuilder-test/orbat.mjs          (add --quiet to print only failures and the summary)
// What a unit holds (Coys down its children, weapons with weapons.json ranges, APCs), the enemy's units (Sec 13), the
// force ratio from both, the ranges the rules use, the unit's ATGM pairs sited on the tank approaches and the AT cover
// check, a mounted reserve in the trigger table, the minefield in time (engineer rates p 439), Check my plan's enemy.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const O = await import('../../MS/Engines/DeploymentBuilder/PlanOrbat.ts');
const C = await import('../../MS/Engines/DeploymentBuilder/PlanContext.ts');
const F = await import('../../MS/Engines/DeploymentBuilder/PlanFit.ts');
const W = await import('../../MS/Engines/DeploymentBuilder/PlanWhatIf.ts');
const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
const K = await import('../../MS/Engines/DeploymentBuilder/PlanCheck.ts');

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
const symbols = json('MS/Data/Symbols.json');
const P = 'MS/Data/Orbat/PK/';
const o = { own: json(`${P}inf.json`).units, en: json(`${P}en.json`).units, weapons: json(`${P}weapons.json`).weapons, engrData: json(`${P}engr.json`).engrData };
const rules = json('MS/Data/terrain-bundle/rules.json');
const goingOf = (p) => ({ nogo: new Set(rules.profiles[p].nogo), caution: new Set(rules.profiles[p].caution ?? []) });
const row = (rows, name) => rows.find((r) => r.name === name);
const sum = (l) => l.reduce((a, w) => a + w.count, 0);

// ── what a unit holds ──────────────────────────────────────────────────────────────────────────────────────────────
const std = O.brief(o, 'inf-bn-std');
check('Std Inf Bn: 809 all ranks, 4 rifle Coys of 3 Pls (pp 606-611)', std.strength === 809 && std.coys === 4 && std.plsPerCoy === 3, `${std.strength} ${std.coys} ${std.plsPerCoy}`);
check('...4 BS at 3 km and 8 x 106 mm RR at 1189 m (weapons.json)', sum(std.atgm) === 4 && std.atgm[0].rangeM === 3000 && sum(std.rr) === 8 && std.rr[0].rangeM === 1189);
check('...6 x 81 mm at 3749 m, 74 MG1A3 at 457 m, not mounted', std.mortars.some((m) => m.count === 6 && m.rangeM === 3749) && std.mgCount === 74 && std.mgEffM === 457 && !std.mounted);
const mib = O.brief(o, 'inf-bn-mib'), abib = O.brief(o, 'inf-bn-abib'), mtn = O.brief(o, 'inf-bn-mtn');
check('MIB: mounted, 60 APCs', mib.mounted && mib.apcs === 60);
check('ABIB: mounted, 6 BS (3 pairs)', abib.mounted && sum(abib.atgm) === 6 && O.atgmPairs(abib) === 3);
check('Mtn Inf Bn: 4 rifle Coys, no ATGM in the extraction (no pairs)', mtn.coys === 4 && O.atgmPairs(mtn) === 0);
check('Inf Bde 12 rifle Coys (3 Bns), Inf Div 39 (+ the Armr Regt\'s 3 Sqns)', O.brief(o, 'inf-bde').coys === 12 && O.brief(o, 'inf-div').coys === 39);
const types = O.ownBnTypes(o);
check('Bn types offered: 4-Coy types, and 3-Coy types (Lt Cdo) known', types.some((t) => t.id === 'inf-bn-std' && t.coys === 4) && types.some((t) => t.id === 'inf-bn-lt-cdo' && t.coys === 3), types.map((t) => `${t.id}:${t.coys}`).join(' '));
check('unit line names the unit, its weapons and the source page', /Std Inf Bn: 809 all ranks; 4 rifle Coys of 3 Pls; 4 BS \(3\.0 km\)/.test(O.unitLine(std)) && /p 606-611/.test(O.unitLine(std)), O.unitLine(std));

// ── the enemy (Sec 13) ─────────────────────────────────────────────────────────────────────────────────────────────
const ec = (id) => O.brief(o, id).coys;
check('en Inf Bn 4 Coys; IIB 12 (3 Inf Bns, the Fd Regt left out)', ec('en-inf-bn') === 4 && ec('en-iib') === 12);
check('en Inf Div 39, Mtn Div 36 (services left out)', ec('en-inf-div') === 39 && ec('en-mtn-div') === 36, `${ec('en-inf-div')} ${ec('en-mtn-div')}`);
check('en Armd Regt 3 Sqns; IAB 13 (3 Regts + an MIB)', ec('en-armd-regt') === 3 && ec('en-iab') === 13);
check('the enemy unit by echelon and type', O.enUnitFor('18', 'inf') === 'en-iib' && O.enUnitFor('18', 'armd') === 'en-iab' && O.enUnitFor('21', 'inf', 'mountain') === 'en-mtn-div' && O.enUnitFor('16', 'mech') === 'en-mech-inf-bn');
const fs = O.forceFromOrbat(std, O.brief(o, 'en-iib'));
const fr = C.forceRow(doc, 'defence', '16', { echelon: '18', type: 'inf', source: 'user' }, fs.ownS, fs.enS, fs);
check('force from both ORBATs: an IIB (12 Coys) on a Std Inf Bn (4) is 3 : 1', fr.st === 'pass' && /about 3 : 1/.test(fr.reason) && /IIB/.test(fr.reason) && /Std Inf Bn/.test(fr.reason), fr.reason);
const fd = O.forceFromOrbat(std, O.brief(o, 'en-inf-div'));
const frd = C.forceRow(doc, 'defence', '16', { echelon: '21', type: 'inf', source: 'user' }, fd.ownS, fd.enS, fd);
check('an en Inf Div (39) on a Bn: about 9.8 : 1, more than it holds alone', frd.st === 'warn' && /about 9.8 : 1/.test(frd.reason), frd.reason);

// ── the ranges the rules use ───────────────────────────────────────────────────────────────────────────────────────
const dStd = O.doctrineForUnit(doc, std), dMtn = O.doctrineForUnit(doc, mtn);
check('ranges from the unit: BOF RR 1189, mortars 3749, mutual support 914, ATGM 3000 (live, ORBAT)', dStd.plan.attack.bofRangeMaxM.value === 1189 && /ORBAT inf-bn-std/.test(dStd.plan.attack.bofRangeMaxM.src) && dStd.plan.attack.morRangeM.value === 3749 && dStd.plan.checkBands.mutualSupportGapMaxM.value === 914 && dStd.plan.atFramework.atgmRangeM.value === 3000);
check('a unit without the RR keeps the doctrine figure (Mtn Inf Bn)', dMtn.plan.attack.bofRangeMaxM.value === doc.plan.attack.bofRangeMaxM.value && !/ORBAT inf-bn/.test(String(dMtn.plan.attack.bofRangeMaxM.src)));
check('the doctrine itself is not changed', !/ORBAT inf-bn/.test(String(doc.plan.attack.bofRangeMaxM.src)));

// ── the unit's ATGM pairs and AT cover on the tank approaches ──────────────────────────────────────────────────────
const r2 = json('MS/Data/Deployments/Recipes/bn-def-two-up.json');
function ground({ avenues = [{ x: 0 }, { x: 5200 }] } = {}) {
  return {
    cls: () => 2, elev: () => 200, going: goingOf, label: (c) => rules.classes[String(c)]?.label ?? String(c), sight: () => 0.6,
    avenues: () => avenues.map((a) => { const path = []; for (let y = 8000; y >= -500; y -= 100) path.push({ x: a.x, y }); return { path, lengthM: 8500, goPct: 100, minWidthM: 2000, chokes: [] }; }),
    pending: () => false, dataLine: () => 'synthetic',
  };
}
const fitIn = (unit, more = {}) => ({ recipe: r2, ctx: { doc: O.doctrineForUnit(doc, unit), symbols }, opts: { alternates: 'visible' }, ground: ground(), anchor: { x: 0, y: 0 }, bearing: 0, threat: { x: 0, y: 8000 }, enemy: { echelon: '18', type: 'mech', source: 'user' }, terrain: 'plains', unit, ...more });
{
  // the second approach 5.2 km to the right: beyond the gap pair's 3 km, so the unit's second pair goes there
  const fl = F.fitLayout(fitIn(std));
  const extra = fl.raw.items.filter((i) => i.role.startsWith('atgmX'));
  check('the Std Inf Bn\'s second BS pair is placed (4 BS = 2 pairs, one in the recipe\'s gap)', extra.length === 2, extra.map((e) => `${Math.round(e.pts[0].x)},${Math.round(e.pts[0].y)}`).join(' '));
  check('...sited on the approach the gap pair does not reach, 450 m apart across it', extra.length === 2 && Math.abs((extra[0].pts[0].x + extra[1].pts[0].x) / 2 - F.toLocal(fl.frame, { x: 5200, y: 0 }).x) < 50 && Math.abs(Math.abs(extra[0].pts[0].x - extra[1].pts[0].x) - 450) < 1);
  const at = row(fl.res.rows, 'AT cover');
  check('AT cover: both tank approaches under ATGM fire', at?.st === 'pass' && /A1 \(main\): \d ATGM/.test(at.reason) && /A2: \d ATGM/.test(at.reason), at?.reason);
  const flM = F.fitLayout(fitIn(mtn));
  const atM = row(flM.res.rows, 'AT cover');
  check('a Mtn Inf Bn (no ATGM in the extraction): no extra pair; the far approach is not covered', !flM.raw.items.some((i) => i.role.startsWith('atgmX')) && atM && atM.st !== 'pass', atM?.reason);
  const flI = F.fitLayout(fitIn(std, { enemy: { echelon: '18', type: 'inf', source: 'user' } }));
  check('an infantry enemy: no AT cover row', !row(flI.res.rows, 'AT cover'));
  const pd = S.toPlanDocument(fl.raw, (pid, ov, id, de) => ({ id, de }), (pid, id, name, seq, syms) => ({ syms }), 1);
  check('the extra pair goes on the map as BS symbols (15111200)', pd.doc.poObj.plnOrdrOverlay[0].syms.filter((s) => s.de.SID === '111200').length === 4);
  // geometry mode: the second pair on the open flank
  const g0 = S.solveRecipe(r2, { doc, symbols }, {});
  const ex0 = F.atgmExtras(g0, r2, std, null, null, doc);
  check('without the ground the second pair goes on the open Lt flank of the FDL', ex0.length === 2 && ex0.every((e) => e.at.x < 0), JSON.stringify(ex0.map((e) => e.at)));
}

// ── a mounted reserve ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const inpS = fitIn(std), inpM = fitIn(mib);
  const a = W.withMoves(F.fitLayout(inpS), inpS), b = W.withMoves(F.fitLayout(inpM), inpM);
  const t = (x) => x.whatIf.triggers.find((tr) => tr.id === 'cpen-main');
  check('MIB: the reserve moves mounted to the C Pen posn (APCs, IPB p 18 vehicle rate)', t(b)?.route?.mounted === true && t(b).min < t(a).min, `${t(b)?.min} against ${t(a)?.min} min on foot`);
  check('MIB: the geometry Reserve reach says mounted', /mounted/.test(row(b.res.rows, 'Reserve reach')?.reason ?? ''), row(b.res.rows, 'Reserve reach')?.reason);
  check('the fitted rows survive the what-if (En force, Terrain, AT cover)', !!row(b.res.rows, 'En force') && !!row(b.res.rows, 'Terrain') && !!row(b.res.rows, 'AT cover'));
}

// ── the minefield in time (engr.json p 439) ────────────────────────────────────────────────────────────────────────
{
  const m35 = O.minefieldRow(o, doc, 3500, std), m60 = O.minefieldRow(o, doc, 6000, std);
  check('3.5 km of front: one Engr Fd Coy about 36 h (780 mixed clusters a Pl in 24 h): ready in time', m35?.st === 'pass' && /about 36 h/.test(m35.reason) && /p 439/.test(m35.reason), m35?.reason);
  check('...the Bn\'s 12 rifle Pls alone, at half the rate, about 18 h', /12 rifle Pls alone, at half that, about 18 h/.test(m35?.reason ?? ''));
  check('6 km of front: more than 36 h for one Fd Coy: ask for more engineers or the MML', m60?.st === 'warn' && /MML/.test(m60.reason), m60?.reason);
}

// ── Check my plan: the enemy from the ORBAT when he is not drawn ───────────────────────────────────────────────────
{
  const recs = K.recordsFromPlanDoc(json('tools/planbuilder-test/fixtures/Bde Def 12 Bde.json'));
  const r = K.checkPlan(recs, doc, { orbat: o });
  const ef = row(r.rows, 'En force');
  check('Bde Def: the assumed en Div (mech) is the RAPID (Def) of Sec 13, 34 Coys, against the Bde', /RAPID \(Def\)/.test(ef?.reason ?? '') && /34 manoeuvre Coys/.test(ef?.reason ?? ''), ef?.reason);
  const rb = K.checkPlan(K.recordsFromPlanDoc(json('MS/Data/Deployments/Plans/Own/Bn Def.json')), doc, { orbat: o });
  check('Bn Def: the enemy drawn is counted from his symbols, not the ORBAT', !/Sec 13/.test(row(rb.rows, 'En force')?.reason ?? '') && rb.enemy.source === 'symbols');
}

console.log(`\n${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
