// szb.mjs -- checks what the C&SC handout "Concept and Conduct of SZ Battle" (SZB, 2010) added on 28 Nov 2026
// (SZB_Review.md): the SZ by its ground (p 3 paras 5-7), the desert's DLs and BHOL (p 10 para 20 b, p 5 para 9 h), the
// IB read from the Ground Guide's borders, and the covering troops plans (N1).
//   node tools/planbuilder-test/szb.mjs          (add --quiet to print only failures and the summary)
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
const V = await import('../../MS/Engines/DeploymentBuilder/PlanRecipes.ts');
const Z = await import('../../MS/Engines/DeploymentBuilder/PlanSz.ts');

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
const ctx = { doc, symbols: json('MS/Data/Symbols.json') };
const rec = (id) => json(`MS/Data/Deployments/Recipes/${id}.json`);
const items = (res, role) => res.items.filter((i) => i.role === role);
const ys = (it) => it.pts.map((p) => p.y);
const front = (res) => Math.max(...res.slots.filter((s) => s.kind === 'fwd').map((s) => s.centre.y + s.hM / 2));

// ── I1 / E4: the SZ by its ground ────────────────────────────────────────────────────────────────────────────────────
for (const id of ['div-def-two-up', 'div-def-three-axes']) {
  const r = rec(id);
  check(`${id}: valid with the dl / bhol slots`, V.validateRecipe(r, { doc, symbols: ctx.symbols }).length === 0, V.validateRecipe(r, { doc, symbols: ctx.symbols }).map((e) => e.msg).join('; '));
  // no ground given: as before (the Demo2 10 km SZ, C Tps 4 km), no DLs
  const old = S.solveRecipe(r, ctx, {});
  const szOld = items(old, 'sz')[0];
  check(`${id}: no ground given, the SZ drawn as before (10 km, divDepthM)`, !!szOld && Math.abs(Math.max(...ys(szOld)) - Math.min(...ys(szOld)) - 10000) < 1, szOld ? `${Math.max(...ys(szOld)) - Math.min(...ys(szOld))}` : 'none');
  check(`${id}: no ground given, no DL or BHOL`, !items(old, 'dl').length && !items(old, 'bhol').length && !old.sz);
  // plains: 5 km (the top of 2-5 km), C Tps inside it, no DLs, the row grey (IB not read)
  const pl = S.solveRecipe(r, ctx, { ground: 'plains' });
  const f = front(pl), szP = items(pl, 'sz')[0];
  const dP = szP ? Math.max(...ys(szP)) - Math.min(...ys(szP)) : 0;
  check(`${id}: plains SZ 5 km deep (SZB p 3: none or 2-5 km)`, Math.abs(dP - 5000) < 1, `${dP}`);
  check(`${id}: plains C Tps inside the SZ, no DLs`, items(pl, 'ctps').every((c) => c.pts[0].y - f <= pl.sz.farM && c.pts[0].y > f) && !items(pl, 'dl').length && !items(pl, 'bhol').length);
  const rowP = Z.szRows(pl.sz, 'user')[0];
  check(`${id}: plains row grey while the IB is not read, cites SZB p 3`, rowP.name === 'Security zone' && rowP.st === 'unchecked' && /p 3 paras 5-6/.test(rowP.reason), rowP.reason.slice(0, 120));
  // desert: 20 km (the foot of 20-50 km), three DLs, a BHOL 2.5 km ahead, C Tps on DL 1
  const de = S.solveRecipe(r, ctx, { ground: 'desert' });
  const fd = front(de), szD = items(de, 'sz')[0];
  const dD = szD ? Math.max(...ys(szD)) - Math.min(...ys(szD)) : 0;
  check(`${id}: desert SZ 20 km deep (SZB p 3: 20-50 km)`, Math.abs(dD - 20000) < 1, `${dD}`);
  const dls = items(de, 'dl'), bh = items(de, 'bhol');
  check(`${id}: desert three DLs labelled DL 1-3, DL 1 the farthest`, dls.length === 3 && dls.map((d) => d.label).join(',') === 'DL 1,DL 2,DL 3' && dls[0].pts[0].y > dls[1].pts[0].y && dls[1].pts[0].y > dls[2].pts[0].y, dls.map((d) => `${d.label}@${Math.round(d.pts[0].y - fd)}`).join(' '));
  check(`${id}: desert BHOL 2.5 km ahead of the FDL, behind the last DL`, bh.length === 1 && Math.abs(bh[0].pts[0].y - fd - 2500) < 1 && bh[0].pts[0].y < dls[2].pts[0].y, bh[0] ? `${bh[0].pts[0].y - fd}` : 'none');
  check(`${id}: desert C Tps on DL 1`, items(de, 'ctps').length >= 2 && items(de, 'ctps').every((c) => Math.abs(c.pts[0].y - dls[0].pts[0].y) < 1));
  check(`${id}: the DLs and BHOL are 2525D Phase Line / BHOL symbols`, dls.every((d) => d.key === '25140300') && bh[0]?.key === '25141902');
  const rowsD = Z.szRows(de.sz, 'bundle');
  check(`${id}: desert rows Security zone + Delaying lines, the En's SZ clearance beside DW`, rowsD.length === 2 && rowsD[1].name === 'Delaying lines' && /Flight Path Bde/.test(rowsD[0].reason) && /DW pp 10-12/.test(rowsD[0].reason) && /Fig 2 p 15/.test(rowsD[1].reason));
  // mountains: none laid
  const mt = S.solveRecipe(r, ctx, { ground: 'mountain' });
  check(`${id}: mountains no SZ, no C Tps, no DLs (SZB p 3: no SZ battle)`, !items(mt, 'sz').length && !items(mt, 'ctps').length && !items(mt, 'dl').length && mt.sz?.none === true);
  const rowM = Z.szRows(mt.sz, 'bundle')[0];
  check(`${id}: mountains row says none laid, SZB p 3 and MW p 164`, rowM.st === 'pass' && /p 3 para 5/.test(rowM.reason) && /MW s12 p 164/.test(rowM.reason));
  // the IB read: the SZ runs to it
  const ib = S.solveRecipe(r, ctx, { ground: 'desert', szBorderM: 35000 });
  const szI = items(ib, 'sz')[0];
  check(`${id}: the IB read 35 km ahead, the SZ runs to it`, !!szI && Math.abs(Math.max(...ys(szI)) - front(ib) - 35000) < 1 && Z.szRows(ib.sz, 'bundle')[0].st === 'pass');
  const ibN = S.solveRecipe(r, ctx, { ground: 'desert', szBorderM: 6000 });
  check(`${id}: a desert IB only 6 km ahead leaves room for one DL: warns`, ibN.sz.dls.length === 1 && Z.szRows(ibN.sz, 'bundle')[0].st === 'warn', `${ibN.sz.dls.length} DLs`);
  const ibP = S.solveRecipe(r, ctx, { ground: 'plains', szBorderM: 3000 });
  check(`${id}: plains IB 3 km ahead, the SZ to it and the row passes`, Math.abs(ibP.sz.farM - 3000) < 1 && Z.szRows(ibP.sz, 'bundle')[0].st === 'pass');
}

// borderAheadM: the facing ray's first border crossing ahead of the FDL
const line = [[{ x: -20000, y: 30000 }, { x: 20000, y: 34000 }]];
const bA = Z.borderAheadM(line, [-5000, 0, 5000], 5000);
check('borderAheadM: the median crossing ahead of the FDL', Math.abs(bA - 27000) < 1, `${bA}`);
check('borderAheadM: no border ahead gives null', Z.borderAheadM([[{ x: -20000, y: -3000 }, { x: 20000, y: -3000 }]], [0], 5000) === null);

// ── E1: the Bn delay's technique, successive (default) or alternate (MIB s28 para 5 pp 232-233; SZB pp 14-16) ──────────
{
  const D = await import('../../MS/Engines/DeploymentBuilder/PlanDelay.ts');
  const base = rec('bn-delay');
  const alt = D.withDelayTechnique(base, 'alternate');
  check('E1: successive returns the recipe unchanged', D.withDelayTechnique(base, 'successive') === base);
  check('E1: alternate is bn-delay-alt, valid, two Coys of Gp 1 on DP 1, no res / C Coy there, DP 2 occupied by Gp 2', alt.id === 'bn-delay-alt' && alt.delayTech === 'alternate' && V.validateRecipe(alt, { doc, symbols: ctx.symbols }).length === 0
    && alt.slots.filter((s) => s.kind === 'fwd').map((s) => s.label).join(',') === 'A Coy (Gp 1),B Coy (Gp 1)' && !alt.slots.some((s) => s.role === 'res' || s.role === 'fwdR' || s.role === 'rtC')
    && alt.slots.find((s) => s.role === 'dp2').planned === false && /Gp 2 \(C, D Coys\)/.test(alt.slots.find((s) => s.role === 'dp2').label), V.validateRecipe(alt, { doc, symbols: ctx.symbols }).map((e) => e.msg).join('; '));
  const rS = S.solveRecipe(base, ctx, {}), rA = S.solveRecipe(alt, ctx, {});
  const tS = D.delayRows(rS.items, base, doc).rows, tA = D.delayRows(rA.items, alt, doc).rows;
  const tr = (rows, n) => rows.find((r) => r.name === n);
  check('E1: successive rows: Technique cites MIB para 5 a and SZB pp 14-15 beside it; Coys forward kept', /MIB s28 para 5 a pp 232-233/.test(tr(tS, 'Technique')?.reason ?? '') && /pp 14-15 para 27 a/.test(tr(tS, 'Technique').reason) && !!tr(tS, 'Coys forward'));
  check('E1: alternate rows: Technique passes (MIB para 5 b, SZB Fig 3), Handover grey, no Coys forward row', tr(tA, 'Technique')?.st === 'pass' && /MIB s28 para 5 b p 233/.test(tr(tA, 'Technique').reason) && /Fig 3/.test(tr(tA, 'Technique').reason) && tr(tA, 'Handover')?.st === 'unchecked' && !tr(tA, 'Coys forward'));
}

// ── E2: in the desert the killing ground round a dhar (SZ Battle p 13 para 25 c) ─────────────────────────────────────
{
  const F = await import('../../MS/Engines/DeploymentBuilder/PlanFit.ts');
  const rules = json('MS/Data/terrain-bundle/rules.json');
  const goingOf = (p) => ({ nogo: new Set(rules.profiles[p].nogo), caution: new Set(rules.profiles[p].caution ?? []) });
  const r2 = rec('bn-def-two-up');
  const base = S.solveRecipe(r2, ctx, { alternates: 'none' });
  const piv = base.items.find((i) => i.id === base.pivotId).pts[0];
  const fr = { anchor: { x: 0, y: 0 }, bearing: 0, k: 1, pivot: piv };
  const frontW = F.toWorld(fr, { x: 0, y: Math.max(...base.slots.filter((s) => s.kind === 'fwd').map((s) => s.centre.y + s.hM / 2)) }).y;
  // a firm flat 600 m across centred 800 m ahead of the FDL on the approach, dunes 30 m high in a ring 700-1000 m round it
  const dc = { x: 0, y: frontW + 800 };
  const ground = (withDhar) => ({
    cls: (x, y) => (withDhar && Math.hypot(x - dc.x, y - dc.y) <= 600 ? 12 : 13),
    elev: (x, y) => { const d = Math.hypot(x - dc.x, y - dc.y); return withDhar && d >= 700 && d <= 1000 ? 230 : 200; },
    going: goingOf, label: (c) => rules.classes[String(c)]?.label ?? `Class ${c}`,
    sight: () => 0.9,
    avenues(from, to) { const path = []; for (let y = from.y; y >= to.y; y -= 100) path.push({ x: 0, y }); return [{ path, lengthM: from.y - to.y, goPct: 80, minWidthM: 900, chokes: [] }]; },
    pending: () => false, dataLine: () => 'synthetic desert',
  });
  const fD = F.fitPlan({ res: base, recipe: r2, doc, frame: fr, ground: ground(true), threat: null, terrain: { kind: 'desert', source: 'user' } });
  const fN = F.fitPlan({ res: base, recipe: r2, doc, frame: fr, ground: ground(false), threat: null, terrain: { kind: 'desert', source: 'user' } });
  const fP = F.fitPlan({ res: base, recipe: r2, doc, frame: fr, ground: ground(true), threat: null, terrain: { kind: 'plains', source: 'user' } });
  const kgRow = (f) => f.rows.find((r) => r.name === 'KG at a dhar');
  check('E2: desert, the killing ground goes to the dhar on the main approach and the row passes', !!fD.killingGr && Math.hypot(F.toWorld(fr, fD.killingGr).x - dc.x, F.toWorld(fr, fD.killingGr).y - dc.y) <= 300 && kgRow(fD)?.st === 'pass' && /SZ Battle \(C&SC\) p 13 para 25 c/.test(kgRow(fD).reason), `${JSON.stringify(fD.killingGr)} ${kgRow(fD)?.st}`);
  check('E2: desert with no dhar, the row is grey (confirm on the ground)', kgRow(fN)?.st === 'unchecked');
  check('E2: off the desert no dhar row', !kgRow(fP));
}

// ── E3: the SZ in the Gr Scope AOR reading (GroundGuideAor.aorSz; SZ Battle p 3) ───────────────────────────────────
{
  const A = await import('../../MS/Engines/GroundGuide/GroundGuideAor.ts');
  const L = (id, depthM, role = '') => ({ id, role, name: id, cut: [[0, 0], [1, 0]], frontM: 6000, buas: [], obstacle: null, lateral: false, depthM });
  const lines = [L('W', 6000, 'Screen'), L('X', 12000), L('Y', 24000, 'FDLs'), L('Z', null, 'Str Pt')];
  const d = A.aorSz('Desert', lines, true), p = A.aorSz('Plains', [L('W', 1500, 'Screen'), L('X', 4000, 'FDLs')], true), m = A.aorSz('Mountains', lines, true);
  check('E3: desert SZ 24 km to the border, the lines ahead serve as DLs (W, X)', d.sector === 'desert' && d.depthM === 24000 && d.dls.join(',') === 'W,X' && /within the 20-50 km a desert SZ gives/.test(d.text) && /SZ Battle p 3/.test(d.text), d.text);
  check('E3: plains SZ 4 km, the plains\' none or 2-5 km, no DLs', p.sector === 'plains' && !p.dls.length && /none or 2-5 km in the plains/.test(p.text), p.text);
  check('E3: mountains, no SZ battle', m.sector === 'none' && /No SZ battle/.test(m.text));
  const nb = A.aorSz('Canal plains', [L('W', 8250, 'Screen'), L('Y', 16000, 'FDLs')], false);
  check('E3: the IB outside the AOR: the SZ is only said to be deeper, no judgement on the band', nb.fromBorder === false && /the IB lies beyond it, so the SZ is deeper/.test(nb.text) && !/room for DLs|short of/.test(nb.text), nb.text);
  check('E3: no FDLs, no SZ', A.aorSz('Plains', [L('W', 1500)], true) === null);
}

// ── N1: the C Tps battle at BG and Cbt Gp level (PlanCtps; SZB pp 4-27) ──────────────────────────────────────────────
{
  const C = await import('../../MS/Engines/DeploymentBuilder/PlanCtps.ts');
  const idx = json('MS/Data/Deployments/Recipes/index.json');
  const fam = (id) => idx.families.find((f) => f.id === id);
  check('N1: families C Tps Battle (BG) and (Cbt Gp), three options each', fam('bg-ctps')?.recipes.length === 3 && fam('cbtgp-ctps')?.recipes.length === 3 && fam('bg-ctps').unit === 'armr-regt' && fam('cbtgp-ctps').unit === 'armr-iabg');
  const row = (rows, n) => rows.find((r) => r.name === n);
  for (const id of [...fam('bg-ctps').recipes, ...fam('cbtgp-ctps').recipes]) {
    const r = rec(id);
    const iss = V.validateRecipe(r, { doc, symbols: ctx.symbols });
    const res = S.solveRecipe(r, ctx, {});
    const rows = C.ctpsRows(res.items, r, doc);
    const want = r.echelon === '18' ? ['Frontage', 'Option', 'Killing ground', 'Behind mines', 'Delaying lines', 'Delay', 'Fall-back routes', 'BHOL and passage', 'Arty, AD and engrs', 'Night and security'] : ['Frontage', 'CAT frontage', 'Option', 'Mask posn', 'Killing ground', 'Behind mines', 'Delaying lines', 'Delay', 'Fall-back routes', 'BHOL and passage', 'Arty, AD and engrs', 'Night and security'];
    check(`N1 ${id}: valid, solved, every row present`, !iss.length && res.items.length > 8 && want.every((n) => row(rows, n)), iss.map((e) => e.msg).join('; ') || want.filter((n) => !row(rows, n)).join(', '));
    const bad = rows.filter((x) => x.st === 'fail' || (x.st === 'warn' && x.name !== 'Option'));
    check(`N1 ${id}: as built, no row fails or warns but the option's own weakness`, bad.length === 0, bad.map((x) => `${x.name}: ${x.reason.slice(0, 90)}`).join(' | '));
    check(`N1 ${id}: the option row cites SZB p 16 / 17 para 28`, /SZ Battle \(C&SC\) p 1[67] para 28/.test(row(rows, 'Option').reason));
  }
  const b1 = rec('bg-ctps-two-up');
  const r1 = S.solveRecipe(b1, ctx, {});
  const rowsN = C.ctpsRows(r1.items, b1, doc);
  check('N1: BG option 1 frontage 22 km within 20-25 km; CATs 7 km within 6-8 km; three DLs 8 and 7 km apart; Delay grey without an order', row(rowsN, 'Frontage').st === 'pass' && /22 km wide/.test(row(rowsN, 'Frontage').reason) && /7\.0 km/.test(row(rowsN, 'CAT frontage').reason) && row(rowsN, 'Delaying lines').m === 3 && /8\.0 km and 7\.0 km apart/.test(row(rowsN, 'Delaying lines').reason) && row(rowsN, 'Delay').st === 'unchecked', row(rowsN, 'Delaying lines').reason.slice(0, 80));
  const d48 = C.ctpsRows(r1.items, { ...b1, wdrDelayH: 48 }, doc), d9 = C.ctpsRows(r1.items, { ...b1, wdrDelayH: 9 }, doc);
  check('N1: 48 h ordered, three DLs give 9-18 h at the En pace (p 19): warns with fixes; 9 h ordered passes', row(d48, 'Delay').st === 'warn' && /9-18 h/.test(row(d48, 'Delay').reason) && row(d48, 'Delay').detail?.fix.length === 3 && row(d9, 'Delay').st === 'pass');
  check('N1: option 2 (three up) and Cbt Gp option 3 (HAT forward) warn with a fix list (p 17)', ['bg-ctps-three-up', 'cbtgp-ctps-opt3'].every((id) => { const r = rec(id); const o = row(C.ctpsRows(S.solveRecipe(r, ctx, {}).items, r, doc), 'Option'); return o.st === 'warn' && o.detail?.fix.length === 3; }));
  const noMask = r1.items.filter((i) => i.role !== 'mask' && i.role !== 'kg1');
  const rM = C.ctpsRows(noMask, b1, doc);
  check('N1: without the mask posn and the KG the rows warn (p 17 para 28 c (4); p 13 para 25)', row(rM, 'Mask posn').st === 'warn' && row(rM, 'Killing ground').st === 'warn');
  check('N1: the layouts reach the build, fit and Check my plan through layoutRows', (await import('../../MS/Engines/DeploymentBuilder/PlanMountain.ts')).layoutRows(r1.items, b1, doc).some((x) => x.name === 'Mask posn'));
  const ov = C.ctpsOverride([{ name: 'Frontage', reason: '16 km held by 2 forward posns (IBB Annex U)' }, { name: 'Frontage', reason: 'the sector 22 km wide (SZ Battle (C&SC) p 13 para 24)' }, { name: 'Depth', reason: 'x' }, { name: 'Mutual support', reason: 'x' }, { name: 'Approach responsibility', reason: 'x' }, { name: 'Mines in time', reason: 'x' }, { name: 'Flanks', reason: 'x' }], b1);
  check('N1: the main-defence rows that do not apply are dropped (Bn frontage, depth, MG support, one posn per approach, continuous minefield); its own Frontage and Flanks stay', ov.map((r) => r.name).join(',') === 'Frontage,Flanks' && /SZ Battle/.test(ov[0].reason) && C.ctpsOverride([{ name: 'Depth', reason: 'x' }], rec('bn-def-two-up')).length === 1);
  const sc = doc.plan.securityZone.ctps;
  check('N1: doctrine securityZone.ctps: frontages, CAT, tp, ambush, En mnvr, ammo lifts are D with SZB refs; CAT depth E decided', ['cbtGpFrontageM', 'bgFrontageM', 'catFrontageM', 'catWithinDlM', 'tpFrontageM', 'ambushM', 'enShallowH', 'enDeepH', 'ammoLifts'].every((k) => sc[k].basis === 'D' && sc[k].refs.some((x) => x.book === 'SZB')) && sc.catDepthM.basis === 'E' && !!sc.catDepthM.decided);
}

// ── E7: the En's SZ clearance template in the desert (IpbTemplates sz-desert; SZB pp 7-8, Fig 1) ──────────────────────
{
  const T = await import('../../MS/Engines/GroundGuide/GroundGuideIpbTemplate.ts');
  const tpl = json('MS/Data/IpbTemplates.json');
  const pd = T.pickTemplate(tpl, { readFor: 'defence', hq: 'div', desert: true }), pp = T.pickTemplate(tpl, { readFor: 'defence', hq: 'div', desert: false });
  check('E7: a Div HQ in the desert reads the En SZ clearance template; off the desert the DSF one', pd?.id === 'sz-desert' && pp?.id === 'dsf-div', `${pd?.id} / ${pp?.id}`);
  const t = tpl.templates.find((x) => x.id === 'sz-desert');
  check('E7: Flight Path Bde, Direct Pressure Force, two Encircling Forces, an Interception Force; Fig 1 reading not confirmed', ['fpb', 'dpf', 'enc1', 'enc2', 'icpt'].every((id) => t.elements.some((e) => e.id === id)) && tpl.confirmations.szbFig1?.confirmed === false && /SZ Battle pp 7-8/.test(t.src));
}

// doctrine: the bands, D with SZB refs
const B = doc.plan.securityZone.byGround;
check('PlanDoctrine securityZone.byGround: plains 2-5 km, desert 20-50 km, mountain 0, each D with an SZB p 3 ref', JSON.stringify(B.plains.value) === '[2000,5000]' && JSON.stringify(B.desert.value) === '[20000,50000]' && B.mountain.value === 0 && ['plains', 'obstacle', 'desert', 'mountain'].every((k) => B[k].basis === 'D' && B[k].refs.some((r) => r.book === 'SZB' && r.page === '3')));
check('PlanDoctrine sources: SZB', !!doc.plan.sources.SZB?.file);
check('PlanDoctrine withdrawal.delay: MIB para 5 a (successive posns), not 6 a', /para 5 a pp 232-233/.test(doc.plan.withdrawal.delay.src) && !/para 6 a p 233/.test(doc.plan.withdrawal.delay.src));

console.log(`\n${n - fails}/${n} passed${fails ? `, ${fails} FAILED` : ''}`);
process.exit(fails ? 1 : 0);
