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
const R = await import('../../MS/Engines/DeploymentBuilder/PlanRecipes.ts');

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

// ── every own arm as one list; the types offered; a Coy or Pl plan follows the type; Bde types ─────────────────────
{
  const lists = O.OWN_ORBAT_FILES.map((f) => json(`${P}${f}`).units);
  const all = { ...o, own: O.mergeOwn(lists) };
  const B = (id) => O.brief(all, id);
  check('every own arm file as one list: 358 units, no id twice (index.json counts.own)', all.own.length === 358 && all.own.length === lists.reduce((a, l) => a + l.length, 0) && json(`${P}index.json`).counts.own === 358, `${all.own.length}`);
  const twice = O.mergeOwn([o.own, null, undefined, [{ id: 'inf-bn-std', name: 'x' }, { name: 'no id' }]]);
  check('a missing arm file adds nothing; an id met twice keeps the first; no id: left out', twice.length === o.own.length && twice.find((u) => u.id === 'inf-bn-std').name === 'Std Inf Bn');
  const key = (b) => JSON.stringify([b.coys, b.strength, b.plsPerCoy, b.atgm, b.rr, b.mortars, b.mgCount, b.apcs]);
  check('the Bn types read the same from inf.json alone and from every arm', O.ownBnTypes(o).every((t) => key(O.brief(o, t.id)) === key(B(t.id))));
  check('Inf Bde: its Sig Coy (sig.json) is found, so 2,586 all ranks (3 x 809 + HQ 72 + Sig Coy 87); 12 Coys as before', O.brief(o, 'inf-bde').strength === null && B('inf-bde').strength === 2586 && B('inf-bde').coys === 12, `${B('inf-bde').strength}`);
  const mech = B('inf-bde-mech-indep');
  check('Indep Mech Inf Bde Gp: its Armr Regt (armr.json) is found: 2 MIBs + 3 Sqns = 11, its 6 BS, mounted (2 x 60 APCs + the Regt\'s 4)', mech.coys === 11 && mech.atgm.some((w) => w.id === 'bs' && w.count === 6) && mech.mounted && mech.apcs === 124, `${mech.coys} ${mech.apcs}`);
  check('IIBG: 12 Coys (its Indep S&T Coy is no manoeuvre Coy); the Fd Regt\'s guns are no ATGM', B('inf-bde-iibg').coys === 12 && B('inf-bde-iibg').atgm.every((w) => !/how|gun/i.test(w.name)), `${B('inf-bde-iibg').coys}`);
  check('a towed howitzer is no TOW: the Hy Regt and the Armd Div Arty hold no ATGM; a TOW Launcher still is one', B('arty-regt-hy-8in').atgm.length === 0 && B('arty-armd-div-arty').atgm.length === 0 && all.own.some((u) => u.arm === 'inf' && B(u.id).atgm.some((w) => /TOW Launcher/.test(w.name))));

  const types = O.ownBnTypes(all), T = (id) => types.find((t) => t.id === id);
  check('types offered: the FC and Rangers Wings (4 rifle Coys, 730 all ranks, pp 642-644)', T('inf-wing-fc')?.coys === 4 && T('inf-wing-rangers')?.coys === 4 && B('inf-wing-rangers').strength === 730, types.map((t) => `${t.id}:${t.coys}`).join(' '));
  check('...no Sp / HQ / Adm Wing; the SSG Bn, SSG (Mtn) and Coast Guards Bn offered too (4 Coys each)', !types.some((t) => /wing-fc-(sp|hq|adm)/.test(t.id)) && ['inf-bn-ssg', 'inf-bn-ssg-mtn', 'inf-bn-coast-guards'].every((id) => types.find((t) => t.id === id)?.coys === 4) && types.length === 16, `${types.length}`);
  check('each rifle type names its rifle Coy and Pl (Mtn, MIB, Lt Cdo, Rangers)', T('inf-bn-mtn').coy === 'inf-coy-mtn-rifle' && T('inf-bn-mtn').pl === 'inf-pl-mtn-rifle' && T('inf-bn-mib').coy === 'inf-coy-mib-rifle' && T('inf-bn-mib').pl === 'inf-pl-mib-rifle' && T('inf-bn-lt-cdo').coy === 'inf-coy-lt-cdo' && T('inf-wing-rangers').pl === 'inf-pl-rangers-rifle');
  check('every type but the AT Bns and the SSG (Mtn) has both; an AT Bn (LAT, HAT) has neither; the SSG (Mtn)\'s SF / SOC Coys print no rifle Pl', types.every((t) => (/lat|hat|ssg-mtn/.test(t.id) ? !t.pl : !!t.coy && !!t.pl)), types.filter((t) => !t.coy || !t.pl).map((t) => t.id).join(' '));
  check('typeFits: a Lt Cdo Bn (3 Coys) not for a 4-Coy Bn layout, but its Coy (3 Pls) for a Coy plan and its Pl for a Pl plan', !O.typeFits(T('inf-bn-lt-cdo'), '16', 4) && O.typeFits(T('inf-bn-lt-cdo'), '15', 3) && O.typeFits(T('inf-bn-lt-cdo'), '14', 0));
  check('...a LAT Bn for none; a Std Inf Bn for all three', ['16', '15', '14'].every((e) => !O.typeFits(T('inf-bn-lat-apc'), e, e === '16' ? 4 : 3) && O.typeFits(T('inf-bn-std'), e, e === '16' ? 4 : 3)));
  const U = (ech, pick) => O.unitForPlan(all, ech, pick);
  check('a type chosen: the Bn plan is that Bn, the Coy plan its rifle Coy, the Pl plan that Coy\'s rifle Pl', U('16', { type: 'inf-bn-mtn' }) === 'inf-bn-mtn' && U('15', { type: 'inf-bn-mtn', preferred: 'inf-coy-std-rifle' }) === 'inf-coy-mtn-rifle' && U('14', { type: 'inf-bn-mtn' }) === 'inf-pl-mtn-rifle');
  check('no type chosen: the recipe\'s unit, else the standard one; an AT Bn on a Coy plan: the recipe\'s', U('15', { preferred: 'inf-coy-std-rifle' }) === 'inf-coy-std-rifle' && U('14', {}) === 'inf-pl-std-rifle' && U('16', {}) === 'inf-bn-std' && U('15', { type: 'inf-bn-hat', preferred: 'inf-coy-std-rifle' }) === 'inf-coy-std-rifle' && U('14', { type: 'not-a-unit' }) === 'inf-pl-std-rifle');
  check('a Bde plan takes the Bde type, not the Bn type; a Div plan stays the Inf Div', U('18', { type: 'inf-bn-mtn', bde: 'inf-bde-mech-indep' }) === 'inf-bde-mech-indep' && U('18', { type: 'inf-bn-mtn' }) === 'inf-bde' && U('18', { bde: 'not-a-unit' }) === 'inf-bde' && U('21', { type: 'inf-bn-mtn', bde: 'inf-bde-iibg' }) === 'inf-div');
  const bdes = O.ownBdeTypes(all);
  check('Bde types: Inf Bde (first), IIBG, Indep Mech Inf Bde Gp (3 Bn-sized manoeuvre units each) and the IABG (3 Armr Regts + a MIB = 4); the Mech Bde Gp and the IABG mounted', bdes.length === 4 && bdes[0].id === 'inf-bde' && ['inf-bde', 'inf-bde-iibg', 'inf-bde-mech-indep'].every((id) => bdes.find((b) => b.id === id)?.bns === 3) && bdes.find((b) => b.id === 'armr-iabg')?.bns === 4 && bdes.filter((b) => b.mounted).map((b) => b.id).sort().join() === 'armr-iabg,inf-bde-mech-indep', JSON.stringify(bdes));

  const mibCoy = B(U('15', { type: 'inf-bn-mib' })), mibPl = B(U('14', { type: 'inf-bn-mib' })), stdPl = B('inf-pl-std-rifle'), stdCoy = B('inf-coy-std-rifle');
  check('a MIB\'s Coy and Pl are mounted (13 and 3 APCs); the Std Inf Bn\'s are not', mibCoy.mounted && mibCoy.apcs === 13 && mibPl.mounted && mibPl.apcs === 3 && !stdCoy.mounted && !stdPl.mounted, `${mibCoy.apcs} ${mibPl.apcs}`);
  check('size in words: a Bn its Coys, a Coy its Pls, a Pl nothing (it read "12 rifle Coys")', O.sizeText(B('inf-bn-std')) === '4 rifle Coys of 3 Pls' && O.sizeText(stdCoy) === '3 Pls' && O.sizeText(stdPl) === null && !/Coys/.test(O.unitLine(stdPl)), O.unitLine(stdPl));
  check('...a Bde or above and the enemy count manoeuvre Coys (armour Sqns among them)', O.sizeText(mech) === '11 manoeuvre Coys' && /^39 manoeuvre Coys/.test(O.sizeText(B('inf-div'))) && /manoeuvre/.test(O.sizeText(B('en-iib'))) && /Std Inf Bn \(4 rifle Coys\)/.test(O.forceFromOrbat(std, null).ownName) && /\(11 manoeuvre Coys\)/.test(O.forceFromOrbat(mech, null).ownName));
  check('a rifle Pl counts a third of a Coy, a Coy one; the Bns above them are not changed by it', stdPl.coys === 0.33 && stdCoy.coys === 1 && B('inf-bn-std').coys === 4 && B('inf-div').coys === 39);
  // a Coy Def of a MIB: the reserve Pl moves mounted, as a Bn Def's reserve Coy does
  const rc = json('MS/Data/Deployments/Recipes/coy-def-two-up.json');
  const reach = (unit) => row(S.solveRecipe(rc, { doc: O.doctrineForUnit(doc, unit), symbols }, { mountedReserve: !!unit.mounted }).rows, 'Reserve reach');
  check('Coy Def of a MIB Coy: Reserve reach says mounted; of a Std rifle Coy: on foot', /mounted/.test(reach(mibCoy)?.reason ?? '') && /on foot/.test(reach(stdCoy)?.reason ?? ''), reach(mibCoy)?.reason);
}

// ── step 2: 3-Coy Bn layouts (Lt Cdo) and AT Coys grouped to a Bn (LAT, HAT) ────────────────────────────────────────
{
  const all = { ...o, own: O.mergeOwn(O.OWN_ORBAT_FILES.map((f) => json(`${P}${f}`).units)) };
  const B = (id) => O.brief(all, id);
  const ltc = B('inf-bn-lt-cdo');
  const lay3 = (id) => json(`MS/Data/Deployments/Recipes/${id}.json`);
  const two3 = lay3('bn3-def-two-up'), three3 = lay3('bn3-def-three-up');
  const solve = (r, unit) => S.solveRecipe(r, { doc: O.doctrineForUnit(doc, unit), symbols }, { mountedReserve: !!unit?.mounted });
  const r3 = solve(two3, ltc);
  check('Lt Cdo Bn: 3 rifle Coys of 3 Pls, 583 all ranks (p 623): what the 3-Coy layouts are for', ltc.coys === 3 && ltc.plsPerCoy === 3 && ltc.strength === 583);
  check('Bn Def two up, one back (3 Coys): A and B forward, C Coy the reserve; frontage and depth in the IBB two-up row', r3.slots.filter((s) => s.kind === 'fwd').length === 2 && r3.slots.find((s) => s.kind === 'res')?.label === 'C Coy' && row(r3.rows, 'Frontage')?.st === 'pass' && row(r3.rows, 'Depth')?.st === 'pass', `${row(r3.rows, 'Frontage')?.reason} | ${row(r3.rows, 'Depth')?.reason}`);
  // at the book's 4 km/h (IBB p 18) the reserve 3.3 km deep takes 36 min: inside the Bn counter-attack's hour (IBB p 306)
  check('...the reserve takes 36 min on foot (IBB 4 km/h; a Bn counter-attack within an hour, IBB p 306), the gap is held, no Coy in depth', row(r3.rows, 'Reserve reach')?.st === 'pass' && /36 min/.test(row(r3.rows, 'Reserve reach')?.reason ?? '') && row(r3.rows, 'Gaps')?.st === 'pass' && !r3.slots.some((s) => s.kind === 'depth'), row(r3.rows, 'Reserve reach')?.reason);
  const t3 = solve(three3, ltc);
  check('Bn Def three up, none back (3 Coys): 5.5 km inside the 6.5 km row; the Depth row warns (no Coy left for a reserve) and there is no Reserve reach row', row(t3.rows, 'Frontage')?.st === 'pass' && row(t3.rows, 'Depth')?.st === 'warn' && !row(t3.rows, 'Reserve reach'), `${row(t3.rows, 'Frontage')?.reason} | ${row(t3.rows, 'Depth')?.reason}`);
  check('a 4-Coy layout of the same family is not for the Lt Cdo Bn (4 Coys wanted, 3 held)', json('MS/Data/Deployments/Recipes/bn-def-two-up.json').slots.filter((s) => s.echelon === '15' && ['fwd', 'depth', 'res', 'round'].includes(s.kind)).length === 4 && ltc.coys !== 4);

  // the AT Bns
  const ats = O.ownAtTypes(all), A = (id) => ats.find((t) => t.id === id);
  check('AT Bns: LAT (APC borne), LAT (Jeep borne), HAT; 3 ATGM Coys of 12 launchers each (36 shared over 3)', ats.length === 3 && ats.every((t) => t.coys === 3 && t.launchersPerCoy === 12) && !!A('inf-bn-lat-apc') && !!A('inf-bn-lat-jeep') && !!A('inf-bn-hat'), JSON.stringify(ats.map((t) => `${t.id}:${t.coys}x${t.launchersPerCoy}`)));
  check('...each names its Coy (LAT Coy, HAT Coy (HAT Bn)) and its all ranks', /LAT Coy/.test(A('inf-bn-lat-apc').coyName) && /HAT Coy/.test(A('inf-bn-hat').coyName) && A('inf-bn-lat-apc').coyStrength === 161, `${A('inf-bn-lat-apc').coyName} ${A('inf-bn-lat-apc').coyStrength}`);
  check('no rifle Bn is an AT Bn (Lt Cdo, Std, Mtn ...)', !ats.some((t) => /std|mtn|mib|abib|lt-cdo|air-aslt|mjd/.test(t.id)));
  const g1 = O.withAtGroup(all, std, 'inf-bn-lat-apc', 1), g3 = O.withAtGroup(all, std, 'inf-bn-hat', 3);
  check('1 LAT Coy grouped to a Std Inf Bn: 4 + 12 = 16 ATGM launchers = 8 pairs (was 2); name and all ranks (809 + 161)', sum(g1.atgm) === 16 && O.atgmPairs(g1) === 8 && O.atgmPairs(std) === 2 && /Std Inf Bn \+ 1 LAT Coy/.test(g1.name) && g1.strength === 970, `${sum(g1.atgm)} ${g1.name} ${g1.strength}`);
  check('3 HAT Coys: 36 more (40 = 20 pairs); its Coys, rifle Coys and mounted flag are not changed', O.atgmPairs(g3) === 20 && g3.coys === std.coys && g3.mounted === std.mounted && g3.name === 'Std Inf Bn + 3 HAT Coys (HAT Bn)' && g1.name === 'Std Inf Bn + 1 LAT Coy (APC borne)', `${sum(g3.atgm)} ${g3.name}`);
  check('the Std Inf Bn itself is not changed (a copy)', sum(std.atgm) === 4 && !/\+/.test(std.name) && std.notes.length === 0);
  check('no group, an unknown AT Bn, no Coys or no unit: the unit comes back as it was', O.withAtGroup(all, std, null, 2) === std && O.withAtGroup(all, std, 'inf-bn-std', 2) === std && O.withAtGroup(all, std, 'inf-bn-lat-apc', 0) === std && O.withAtGroup(all, null, 'inf-bn-lat-apc', 1) === null);
  check('more Coys than the AT Bn has (9) are held to its 3', sum(O.withAtGroup(all, std, 'inf-bn-lat-apc', 9).atgm) === 4 + 36);
  check('the unit line names the group and its launchers (12 ATGM at 3.0 km)', /^Std Inf Bn \+ 1 LAT Coy \(APC borne\): 970 all ranks; .*12 ATGM \(3\.0 km\)/.test(O.unitLine(g1)) && g1.notes.some((x) => /grouped to it: 12 ATGM/.test(x)), O.unitLine(g1));

  // sited on the tank approaches: more pairs than the Std Bn's one extra, the AT cover row counts them
  const fitG = (unit) => F.fitLayout({ ...fitIn(unit), unit });
  const base = fitG(std), grp = fitG(g1);
  const pairsOf = (fl) => new Set(fl.raw.items.filter((i) => i.role.startsWith('atgmX')).map((i) => i.role)).size;
  check('1 LAT Coy: 6 more pairs than the Std Bn\'s one extra (7 placed), the symbols are BS', pairsOf(base) === 1 && pairsOf(grp) === 7 && grp.raw.items.filter((i) => i.role.startsWith('atgmX')).length === 14, `${pairsOf(base)} -> ${pairsOf(grp)}`);
  const xs = grp.raw.items.filter((i) => i.role.startsWith('atgmX')).map((i) => Math.round(i.pts[0].x));
  check('...pairs on the same approach fan out along the front (no two pairs on the same spot)', new Set(xs.map((x) => Math.round(x / 10))).size === xs.length, xs.join(' '));
  const atg = row(grp.res.rows, 'AT cover');
  check('AT cover names the group: 16 ATGM (8 pairs) held, both approaches under fire', /holds 16 ATGM \(8 pairs\)/.test(atg?.reason ?? '') && atg?.st === 'pass', atg?.reason);
  // geometry mode (no ground): the flanks, as many as are needed
  const g0 = S.solveRecipe(r2, { doc, symbols }, {});
  const ex = F.atgmExtras(g0, r2, g1, null, null, doc);
  check('without the ground: the 7 extra pairs stand on the flanks of the FDL, none on another\'s spot', new Set(ex.map((e) => e.role)).size === 7 && new Set(ex.map((e) => Math.round(e.at.x / 10))).size === ex.length, `${new Set(ex.map((e) => e.role)).size} pairs`);
}

// ── step 3: armour: the tank Sqn with an attack from the Armr Regt, the IABG and the Armd Div ───────────────────────
{
  const all = { ...o, own: O.mergeOwn(O.OWN_ORBAT_FILES.map((f) => json(`${P}${f}`).units)) };
  const B = (id) => O.brief(all, id);
  const sq = O.tankSqnOf(all);
  check('the tank Sqn from the ORBAT: 14 tanks (SHQ 2 + 4 Tps of 3, p 115), from an Armr Regt of 44', sq?.tanks === 14 && sq.tps === 4 && sq.tpTanks === 3 && sq.regtTanks === 44 && /p 107-108, 111/.test(sq.src), JSON.stringify(sq));
  check('...in words', O.tankSqnText(sq) === '14 tanks (4 Tps of 3, SHQ 2), from an Armr Regt of 44', O.tankSqnText(sq));
  check('without the armour file (inf.json alone) there is no Sqn: the tanks keep the doctrine', O.tankSqnOf(o) === null && O.tankSqnOf(all, 'armr-sqn-hq') === null);
  check('the Armr Regt: 3 Sqns, 466 all ranks; the Recce Regt holds no manoeuvre Coys here', B('armr-regt').coys === 3 && B('armr-regt').strength === 466 && B('armr-recce-regt').coys === 0);

  // the force ratio: a Sqn with the attack is one more manoeuvre unit
  const f0 = O.forceFromOrbat(std, O.brief(o, 'en-inf-coy')), f1 = O.forceFromOrbat(std, O.brief(o, 'en-inf-coy'), sq);
  check('a Bn (4 Coys) attacking an en Coy: 4 : 1; with the Sqn 5 : 1; the unit named with the Sqn and its tanks', f0.ownS === 4 && f1.ownS === 5 && /Std Inf Bn \(4 rifle Coys \+ 1 Tk Sqn of 14 tanks\)/.test(f1.ownName) && f0.enS === 1, f1.ownName);
  check('no unit: no Sqn counted either', O.forceFromOrbat(null, null, sq).ownS === undefined);
  const fa = C.forceRow(doc, 'attack', '16', { echelon: '15', type: 'inf', source: 'default' }, f1.ownS, f1.enS, f1);
  check('Force ratio row: about 5 : 1, the Sqn named', /about 5 : 1/.test(fa.reason) && /1 Tk Sqn of 14 tanks/.test(fa.reason), fa.reason);

  // the tanks' rows count the Sqn
  const T = await import('../../MS/Engines/DeploymentBuilder/PlanTanks.ts');
  const A = await import('../../MS/Engines/DeploymentBuilder/PlanAttack.ts');
  const front = json('MS/Data/Deployments/Recipes/bn-attk-frontal.json');
  const tSq = { tanks: sq.tanks, tps: sq.tps, tpTanks: sq.tpTanks, regtTanks: sq.regtTanks, src: sq.src };
  const timing = (mode, s) => { const t = T.withTanks(front, doc, mode, s); const res = S.solveRecipe(t, { doc, symbols }, {}); const h = A.attackTimes(res, null, null, doc, 'plains', false, null); return { t, rows: T.addTankTimes(h, res, null, null, doc, false, mode, null) }; };
  const c1 = timing('close', tSq), f1t = timing('fire', tSq), c0 = timing('close', null);
  check('Close sp with the Sqn: the timing says "the Sqn (-), 11 of its 14 tanks," and the recipe carries the Sqn', /the Sqn \(-\), 11 of its 14 tanks, leaves FUP/.test(row(c1.rows, 'Tank timing')?.reason ?? '') && c1.t.tankSqn?.tanks === 14, row(c1.rows, 'Tank timing')?.reason);
  check('Fire sp: "the Sqn of 14 tanks leaves FUP (Tks)"', /the Sqn of 14 tanks leaves FUP/.test(row(f1t.rows, 'Tank timing')?.reason ?? ''), row(f1t.rows, 'Tank timing')?.reason);
  check('without the ORBAT the wording is as before ("the Sqn leaves"), and the recipe has no Sqn', /^the Sqn leaves FUP/.test(row(c0.rows, 'Tank timing')?.reason ?? '') && !c0.t.tankSqn, row(c0.rows, 'Tank timing')?.reason);
  check('the recipe with the Sqn still validates, and the one passed in is not changed', !R.validateRecipe(c1.t, { doc, symbols }).some((i) => i.level === 'fail') && !front.tankSqn);

  // formations
  const divs = O.ownDivTypes(all);
  check('Div types: Inf Div (first, 39 manoeuvre Coys) and the Armd Div (27: 5 Armr Regts x 3 Sqns + 3 MIBs x 4; its Armd Bdes are made of those Regts, not 12 more each)', divs.length === 2 && divs[0].id === 'inf-div' && divs[1].id === 'armr-div-armd' && divs[0].coys === 39 && divs[1].coys === 27, JSON.stringify(divs));
  const iabg = B('armr-iabg'), U = (ech, pick) => O.unitForPlan(all, ech, pick);
  check('IABG: 13 manoeuvre Coys / Sqns (3 Armr Regts x 3 + a MIB 4), mounted (107 APCs), named a Bde', iabg.coys === 13 && iabg.mounted && iabg.apcs === 107 && O.sizeText(iabg) === '13 manoeuvre Coys', `${iabg.coys} ${iabg.apcs}`);
  check('a Bde plan can take the IABG; a Div plan the Armd Div; no pick: the Inf Bde, the Inf Div', U('18', { bde: 'armr-iabg' }) === 'armr-iabg' && U('21', { div: 'armr-div-armd' }) === 'armr-div-armd' && U('18', {}) === 'inf-bde' && U('21', {}) === 'inf-div' && U('21', { div: 'nope' }) === 'inf-div');
  check('the Armd Div reads from the Armr file: 13,128 all ranks (p 101, 103, 120)', B('armr-div-armd').strength === 13128);
}

// ── AT grouping by Pl on a Coy defence ───────────────────────────────────────────────────────────────────────────────
{
  const all = { ...o, own: O.mergeOwn(O.OWN_ORBAT_FILES.map((f) => json(`${P}${f}`).units)) };
  const ats = O.ownAtTypes(all), lat = ats.find((t) => t.id === 'inf-bn-lat-apc');
  check('AT Bns by Pl: 2 ATGM Pls an AT Coy, 6 launchers a Pl (the Coy\'s 12 shared), a Pl 32 all ranks', ats.every((t) => t.plsPerCoy === 2 && t.launchersPerPl === 6) && lat.plStrength === 32, JSON.stringify(ats.map((t) => [t.id, t.plsPerCoy, t.launchersPerPl, t.plStrength])));
  const coy = O.brief(all, 'inf-coy-std-rifle');
  const p1 = O.withAtGroup(all, coy, 'inf-bn-lat-apc', 1, true), p2 = O.withAtGroup(all, coy, 'inf-bn-hat', 2, true), p9 = O.withAtGroup(all, coy, 'inf-bn-lat-apc', 9, true);
  check('a rifle Coy + 1 ATGM Pl: 6 launchers (3 pairs), 141 + 32 all ranks, named', sum(p1.atgm) === 6 && O.atgmPairs(p1) === 3 && p1.strength === 173 && p1.name === 'Rifle Coy (Std Inf Bn) + 1 ATGM Pl (LAT Coy (APC borne))', `${p1.name} ${p1.strength}`);
  check('...2 HAT Pls 12 launchers; more than a Coy\'s 2 Pls held to 2; the Coy itself unchanged', sum(p2.atgm) === 12 && sum(p9.atgm) === 12 && sum(coy.atgm) === 0 && !/\+/.test(coy.name));
  check('by Coy (a Bn defence) unchanged: 1 LAT Coy is still 12 more', sum(O.withAtGroup(all, std, 'inf-bn-lat-apc', 1).atgm) === 16);
  // the pairs sited on the tank approaches of a Coy defence
  const rc = json('MS/Data/Deployments/Recipes/coy-def-two-up.json');
  const flC = F.fitLayout({ ...fitIn(p1), recipe: rc, ctx: { doc: O.doctrineForUnit(doc, p1), symbols }, unit: p1 });
  const pairs = new Set(flC.raw.items.filter((i) => i.role.startsWith('atgmX')).map((i) => i.role)).size;
  check('a Coy Def with 1 ATGM Pl: its 3 pairs sited (the rifle Coy holds none), AT cover names the group', pairs === 3 && /Rifle Coy \(Std Inf Bn\) \+ 1 ATGM Pl/.test(row(flC.res.rows, 'AT cover')?.reason ?? ''), `${pairs} | ${row(flC.res.rows, 'AT cover')?.reason}`);
}

console.log(`\n${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
