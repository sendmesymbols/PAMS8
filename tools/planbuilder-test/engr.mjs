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

// ── an engineer Bn's Coys shared between Bns ─────────────────────────────────────────────────────────────────────────
{
  check('the Bns\' Coys that work: Def / Offn Div Engr Bn 3 Fd Coys, Aslt Engr Bn 4 (3 Aslt Engr + the Aslt Br Coy), Br Bn 2, Mech 2; a Coy 1', T('engr-bn-def-inf-div-corps').coys === 3 && T('engr-bn-offn-inf-div').coys === 3 && T('engr-bn-aslt').coys === 4 && T('engr-bn-br').coys === 2 && T('engr-bn-mech').coys === 2 && T('engr-fd-coy').coys === 1, ts.map((t) => `${t.id}:${t.coys}`).join(' '));
  const one = E.engrShare(T('engr-bn-def-inf-div-corps'), 1);
  check('1 Coy of the Def Engr Bn: 3 Pls, a set of 6 MMLs with it (p 439), a third of its men; named', one.pls === 3 && one.mml === 6 && one.coys === 1 && one.name === '1 Coy of the Def Inf Div/Corps Engr Bn' && one.strength === Math.round(740 / 3), `${one.name} ${one.pls} ${one.mml} ${one.strength}`);
  const two = E.engrShare(T('engr-bn-aslt'), 2);
  check('2 of the Aslt Engr Bn\'s 4 Coys: half its Pls, TAMs and AVLBs (E)', two.pls === 5 && two.tam === 7 && two.avlb === 4 && two.am50 === 1, `${two.pls} ${two.tam} ${two.avlb} ${two.am50}`);
  check('all of its Coys, or a Coy: the unit as it is', E.engrShare(T('engr-bn-br'), 2) === T('engr-bn-br') && E.engrShare(T('engr-fd-coy'), 1) === T('engr-fd-coy'));
  const m1 = O.minefieldRow(orbat, doc, 3500, O.brief(orbat, 'inf-bn-std'), one);
  check('Mines in time with 1 Coy of the Def Engr Bn: by hand 36 h, with its MML set about 7 h', /3 Pls .* about 36 h/.test(m1.reason) && /about 7 h/.test(m1.reason), m1.reason);
}

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

// ── the ribbon bays as rafts (p 430-431) ─────────────────────────────────────────────────────────────────────────────
{
  check('the raft table: Chinese 3-bay ribbon raft Cl 60 built 10 / 15 / 20 min, 5 / 4 / 3 trips an hour over 75 / 150 / 300 m; the US 5-bay one has no class printed', JSON.stringify(kinds.rafts.cn3?.buildMin) === '[10,15,20]' && JSON.stringify(kinds.rafts.cn3?.tripsPerH) === '[5,4,3]' && kinds.rafts.cn3.cls === 60 && kinds.rafts.us5?.cls === null, JSON.stringify(kinds.rafts));
  const rf = E.engrRafts(T('engr-bn-br'), 60, 2, kinds);
  check('Br Bn over 60 m on a dark night: built 20 min, 5 trips an hour: the first tank H+26 min, a Sqn of 14 H+3 h 8 min; the US raft named, no class', rf.firstMin === 26 && rf.sqnMin === 188 && /the first tank about H\+26 min, a Sqn of 14 H\+3 h 8 min/.test(rf.row.reason) && /prints no class/.test(rf.row.reason), rf.row.reason);
  check('wider than 300 m: warn; no ribbon sets (the Aslt Engr Bn): no row', E.engrRafts(T('engr-bn-br'), 400, 2, kinds).row.st === 'warn' && E.engrRafts(T('engr-bn-aslt'), 60, 2, kinds) === null);
}

// ── the TAM breach ───────────────────────────────────────────────────────────────────────────────────────────────────
const tb = E.tamBreach(T('engr-bn-aslt'), 2, 950, 6);
check('Aslt Engr Bn, 2 lanes 950 m deep: one TAM a lane, about 3 h 10 min each (p 451: 600 m 2 h, 900 m 3 h, uncertain reading) against 6 h by hand', tb.row.st === 'pass' && tb.h === 3.2 && /about 3 h 12 min each/.test(tb.row.reason) && /uncertain/.test(tb.row.reason) && /6 h by hand/.test(tb.row.reason), tb.row.reason);
const tb2 = E.tamBreach(T('engr-bn-offn-inf-div'), 6, 900, 6);
check('the Offn Engr Bn\'s 5 TAMs for 6 lanes: short of 1, the rest by hand (warn); its MICLIC named', tb2.row.st === 'warn' && /short of 1/.test(tb2.row.reason) && /5 MICLIC/.test(tb2.row.reason), tb2.row.reason);
check('no TAMs: no row', E.tamBreach(T('engr-fd-coy'), 2, 950, 6) === null);

// ── his minefield in front of the Obj on a Bn Attk, and the breach before H ──────────────────────────────────────────
{
  const AT = await import('../../MS/Engines/DeploymentBuilder/PlanAttack.ts');
  const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
  const R = await import('../../MS/Engines/DeploymentBuilder/PlanRecipes.ts');
  const Ph = await import('../../MS/Engines/DeploymentBuilder/PlanPhase.ts');
  const symbols = json('MS/Data/Symbols.json'), ctx = { doc, symbols };
  const rec = (id) => json(`MS/Data/Deployments/Recipes/${id}.json`);
  const front = rec('bn-attk-frontal'), right = rec('bn-attk-right-flank');
  const mf = AT.withAttackMinefield(front, doc), mfR = AT.withAttackMinefield(right, doc), mf2 = AT.withAttackMinefield(Ph.twoPhaseRecipe(front, doc), doc);
  const bad = (r) => R.validateRecipe(r, ctx).filter((i) => i.level === 'fail').map((i) => i.msg);
  check('Bn Attk with his minefield: validates (frontal, right flank, two phases), id -amf, 275 m deep, 2 lanes; the one passed in unchanged', !bad(mf).length && !bad(mfR).length && !bad(mf2).length && mf.id === 'bn-attk-frontal-amf' && mf.enMfAtk.depthM === 275 && mf.enMfAtk.lanes === 2 && !front.enMfAtk && mf.slots.filter((s) => s.sym === '25340200').length === 2 && mf.slots.find((s) => s.role === 'enMfA').hostile, [...bad(mf), ...bad(mfR)].join('; '));
  const ys = mf.slots.find((s) => s.role === 'enMfA').shape.pts.map((p) => p[1]);
  check('...about 200 m in front of the Obj\'s near edge (-1150), 275 m deep: from -950 to -675 (IC s111.5, s107)', Math.abs(Math.min(...ys) + 950) <= 2 && Math.abs(Math.max(...ys) + 675) <= 2, ys.join(' '));
  const xs = mfR.slots.find((s) => s.role === 'enMfA').shape.pts, axR = right.slots.find((s) => s.role === 'axis').shape.pts;
  const cx = xs.reduce((a, p) => a + p[0], 0) / 4, cy = xs.reduce((a, p) => a + p[1], 0) / 4, last = axR[axR.length - 1], prev = axR[axR.length - 2];
  const off = Math.abs((cx - prev[0]) * (last[1] - prev[1]) - (cy - prev[1]) * (last[0] - prev[0])) / Math.hypot(last[0] - prev[0], last[1] - prev[1]);
  check('a flank attack: the minefield lies across the axis where it enters the Obj (its centre on the axis line)', off < 5, `${Math.round(off)} m off the axis`);
  const B = (r, night) => AT.attackBreach(r, doc, night, orbat.engrData);
  const b0 = B(mf, false);
  check('no engineers grouped: Breach warns: 3 Pls a lane, 6 for the 2 lanes, 4 h by day (Annex Q); p 450 for 360 yd: 2 Pls, 4 h 8 min', b0.row.st === 'warn' && /3 engineer Pls a lane, 4 h by day/.test(b0.row.reason) && /6 engineer Pls needed/.test(b0.row.reason) && /p 450 for 360 yd: 2 Pls a lane, 4 h 8 min/.test(b0.row.reason), b0.row.reason);
  const withE = (r, id) => ({ ...r, engr: { ...T(id), kinds } });
  const bDef = B(withE(mf, 'engr-bn-def-inf-div-corps'), true), bFd = B(withE(mf, 'engr-fd-coy'), false), bAs = B(withE(mf, 'engr-bn-aslt'), true);
  check('the Def Engr Bn (9 Pls): the lanes at once, 6 h by dark night: begun 6 h before H (pass)', bDef.row.st === 'pass' && bDef.h === 6 && /9 Pls do the lanes at once: begun 6 h before H/.test(bDef.row.reason), bDef.row.reason);
  check('a Fd Coy (3 Pls) for 6: two turns, 8 h by day (warn)', bFd.row.st === 'warn' && bFd.h === 8 && /in 2 turns, 8 h/.test(bFd.row.reason), bFd.row.reason);
  check('the Aslt Engr Bn: its TAMs, under an hour for 275 m (p 451) against 6 h by hand (pass)', bAs.row.st === 'pass' && bAs.h < 1 && /TAMs/.test(bAs.row.reason), bAs.row.reason);
  check('no minefield: no Breach', B(front, false) === null);
  // the H-hour sum: the engineers begin before H
  const h = AT.attackTimes(S.solveRecipe(withE(mf, 'engr-bn-def-inf-div-corps'), ctx, {}), null, null, doc, 'plains', true, null);
  const st = h.steps.find((s) => /Engineers begin the lanes/.test(s.label));
  check('the H-hour sum: the engineers begin the lanes 6 h before H (Def Engr Bn, by hand), the steps in time order', st?.at === -360 && /Def Inf Div\/Corps Engr Bn, by hand/.test(st.label) && h.steps.every((s, i) => !i || s.at >= h.steps[i - 1].at), st ? `${st.label} ${st.at}` : 'none');
}

// ── inundation (pp 452-453) ─────────────────────────────────────────────────────────────────────────────────────────
{
  const def = T('engr-bn-def-inf-div-corps'), fd = T('engr-fd-coy');
  const spec = { beltYds: 500, cusecs: 100, soil: 'loam' };
  const a = E.inundation(orbat.engrData, 2500, def, spec);
  // 2500 m = 2734 yd: 3 compartments; the Def Engr Bn's Pls in teams of 4
  const teams = Math.max(1, Math.floor(def.pls / 4));
  const build = Math.max(10, (3 * 10 - 2 * 0.5) / teams);
  check('a 500 yd belt across 2.5 km: 3 compartments of 1000 yd; built by teams of 4 Pls (10 days each, half a day off a common dyke)', a?.compartments === 3 && a.beltM === 457 && new RegExp(`Build ${build >= 10 ? Math.round(build) : build.toFixed(1)} days`).test(a.row.reason), `${def.pls} Pls, ${teams} teams; ${a?.row.reason}`);
  check('...filled 3 x 25 h at 100 cusecs (3.1 days); loam saturates 0.5-1.7 days: under 2 days, so unsuitable (warn)', /fill 3\.1 days at 100 cusecs \(25 h/.test(a.row.reason) && /saturate 0\.5-1\.7 days in loam/.test(a.row.reason) && a.row.st === 'warn', a.row.st);
  const cl = E.inundation(orbat.engrData, 2500, def, { ...spec, soil: 'clayLoam' });
  check('clay loam saturates in 1.7-5 days: suitable, the time not judged (not checked)', cl.row.st === 'unchecked' && /saturate 1\.7-5\.0 days/.test(cl.row.reason), cl.row.reason.match(/saturate[^;)]*/)?.[0]);
  const clay = E.inundation(orbat.engrData, 2500, def, { ...spec, soil: 'clay' });
  check('clay: 25-50 days: unsuitable, fail', clay.row.st === 'fail');
  const one = E.inundation(orbat.engrData, 2500, fd, { ...spec, soil: 'clayLoam' });
  check('a Fd Coy (3 Pls): one team, 4/3 times as long; more days than the Bn', one.days > cl.days && /short of 4 Pls/.test(one.row.reason), `${one.days.toFixed(1)} vs ${cl.days.toFixed(1)} days`);
  const deep = E.inundation(orbat.engrData, 2500, def, { beltYds: 1000, cusecs: 150, soil: 'clayLoam' });
  check('a 1000 yd belt at 150 cusecs: 14 days a compartment, 34 h filling', /14 days each/.test(deep.row.reason) && /34 h a compartment/.test(deep.row.reason));
  check('...wire, AT ditches and demolitions said to have no rates', /no rates/.test(a.row.reason));
  check('no table: null', E.inundation([], 2500, def, spec) === null);
  const R = await import('../../MS/Engines/DeploymentBuilder/PlanRecipes.ts');
  const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
  const rec = json('MS/Data/Deployments/Recipes/bn-def-two-up.json');
  const ctx = { doc, symbols: json('MS/Data/Symbols.json') };
  const wi = E.withInundation(rec, doc, spec);
  const bad = R.validateRecipe(wi, ctx).filter((i) => i.level === 'fail').map((i) => i.msg);
  const sv = S.solveRecipe(wi, ctx, {});
  const it = (r) => sv.items.find((i) => i.role === r);
  const yMax = (i) => Math.max(...i.pts.map((p) => p.y)), yMin = (i) => Math.min(...i.pts.map((p) => p.y));
  check('Bn defence inundated: id -inu, valid; an Obstacle Zone labelled Inundation, 457 m deep, beyond the minefield', wi.id === 'bn-def-two-up-inu' && !bad.length && it('inund')?.label === 'Inundation' && Math.abs(yMax(it('inund')) - yMin(it('inund')) - 457) < 2 && yMin(it('inund')) > yMax(it('atMines')), `${bad.join('; ')} inund ${it('inund') && `${Math.round(yMin(it('inund')))}..${Math.round(yMax(it('inund')))}`} mines ..${it('atMines') && Math.round(yMax(it('atMines')))}`);
  check('...an attack or an inundated plan is left as it is', E.withInundation(json('MS/Data/Deployments/Recipes/bn-attk-frontal.json'), doc, spec).id === 'bn-attk-frontal' && E.withInundation(wi, doc, spec) === wi);
}

console.log(`\n${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
