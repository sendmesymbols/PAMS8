// idb.mjs -- checks what GSP 1947 Infantry Division in Battle (2001) added on 27 Nov 2026 (IDB_Review.md): the Div
// defence's three echelons (protective detachments, main posn, reserves: s23 pp 104-109), the Div reserve of an Inf Bde,
// the Armd Regt and the LAT Bn given transport (s27 para 3 p 122), the second-line troops row (s17 pp 73-74), the
// Indian reserves beside IDD (p 83) and the Move Planner's Inf Div figures (Annex J p 205).
//   node tools/planbuilder-test/idb.mjs          (add --quiet to print only failures and the summary)
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
const V = await import('../../MS/Engines/DeploymentBuilder/PlanRecipes.ts');
const O = await import('../../MS/Engines/DeploymentBuilder/PlanOrbat.ts');
const MR = await import('../../MS/Engines/MovePlanner/MoveReports.ts');

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
const row = (rows, name) => rows.find((r) => r.name === name);
const item = (res, role) => res.items.find((i) => i.role === role);
const ys = (it) => it.pts.map((p) => p.y);

// ── the Div defence: three echelons (GSP s23 paras 5-13 pp 104-106; OoW Vol I Annex A p 102) ─────────────────────────
for (const id of ['div-def-two-up', 'div-def-three-axes']) {
  const r = rec(id);
  const issues = V.validateRecipe(r, { doc, symbols: ctx.symbols, file: `${id}.json` });
  check(`${id}: a valid recipe (no fail, no warn)`, issues.length === 0, issues.map((i) => `${i.level}: ${i.msg}`).join('; '));
  const res = S.solveRecipe(r, ctx, {});
  const fdl = Math.max(...ys(item(res, 'fdl')));
  const sz = item(res, 'sz'), ctps = res.items.filter((i) => /^ctps/.test(i.role));
  check(`${id}: a Security Zone (00000161) wholly ahead of the FDL, 10 km deep`, !!sz && sz.key === '00000161' && Math.min(...ys(sz)) > fdl && Math.abs(Math.max(...ys(sz)) - Math.min(...ys(sz)) - 10000) < 1, sz ? `${Math.min(...ys(sz))}..${Math.max(...ys(sz))}, FDL ${fdl}` : 'none');
  const fwd = res.items.filter((i) => /^fwd[LCR]$/.test(i.role));
  check(`${id}: a C Tps group on each forward Bde's axis, ahead of the FDL inside the SZ (p 105 para 10)`, ctps.length === fwd.length && ctps.every((c) => c.pts[0].y > fdl && c.pts[0].y < Math.max(...ys(sz))), ctps.map((c) => `${c.pts[0].x},${c.pts[0].y}`).join(' '));
  const cp = res.items.filter((i) => /^cpen[LR]$/.test(i.role));
  const rearOfFwd = Math.min(...fwd.flatMap(ys));
  check(`${id}: two C Pen posns, planned (dashed), behind the forward Bdes (pp 108-109 paras 20-22)`, cp.length === 2 && cp.every((c) => c.planned && Math.max(...ys(c)) < rearOfFwd), cp.map((c) => `${Math.min(...ys(c))}..${Math.max(...ys(c))}`).join(' | '));
  check(`${id}: the AT Res is the LAT Bn (p 122 para 3)`, /LAT Bn/.test(item(res, 'atRes')?.label ?? ''));
  const rr = row(res.rows, 'Reserve reach');
  check(`${id}: the Div reserve timed mounted and passing`, rr?.st === 'pass' && /on tracks|mounted/.test(rr.reason), rr?.reason);
  check(`${id}: the note cites GSP for the echelons and the Div reserve`, /GSP 1947 Inf Div in Battle/.test(r.note) && /p 122/.test(r.note) && /pp 104-106/.test(r.note));
}
{
  const res = S.solveRecipe(rec('div-def-two-up'), ctx, {});
  check('two up: the Armd Regt in the Div reserve, inside the reserve Bde (p 122 para 3; p 107 para 19 a)', (() => { const a = item(res, 'armrRes'), b = item(res, 'res'); const y = a.pts[0].y, x = a.pts[0].x; return a.key === '10120500' && x >= Math.min(...b.pts.map((p) => p.x)) && x <= Math.max(...b.pts.map((p) => p.x)) && y >= Math.min(...ys(b)) && y <= Math.max(...ys(b)); })());
  const rr = row(res.rows, 'Reserve reach');
  check('two up: the infantry Bde reserve is "mounted (transport from the Div\'s pool, GSP p 122)", not "on tracks"', /transport from the Div's pool, GSP p 122/.test(rr?.reason ?? '') && !/on tracks/.test(rr?.reason ?? ''), rr?.reason);
  check('...the reserve share still one of three Bdes (C Pen posns are not counted)', Math.abs(row(res.rows, 'Reserve share')?.m - 1 / 3) < 1e-9);
  const r3 = row(S.solveRecipe(rec('div-def-three-axes'), ctx, {}).rows, 'Reserve reach');
  check('three axes: the armour reserve still "on tracks"', /on tracks/.test(r3?.reason ?? ''), r3?.reason);
}

// ── the Div attack (GSP s19 pp 84-91) ─────────────────────────────────────────────────────────────────────────────────────
{
  const C = await import('../../MS/Engines/DeploymentBuilder/PlanContext.ts');
  const index = json('MS/Data/Deployments/Recipes/index.json');
  const ids = ['div-attk-main-left', 'div-attk-main-right', 'div-attk-one-up'];
  check('a Div Attk family of three layouts (two up main left / right, one up)', JSON.stringify(index.families.find((f) => f.id === 'div-attk')?.recipes) === JSON.stringify(ids));
  for (const id of ids) {
    const issues = V.validateRecipe(rec(id), { doc, symbols: ctx.symbols, file: `${id}.json` });
    check(`${id}: a valid recipe (no fail, no warn)`, issues.length === 0, issues.map((i) => `${i.level}: ${i.msg}`).join('; '));
  }
  check('...no two layouts the same in the family', V.validateFamilies(ids.map(rec)).length === 0);
  const L = S.solveRecipe(rec('div-attk-main-left'), ctx, {}), R = S.solveRecipe(rec('div-attk-main-right'), ctx, {}), U = S.solveRecipe(rec('div-attk-one-up'), ctx, {});
  const fm = row(L.rows, 'Div formation');
  check('two up: Div formation passes on the plains with m 2 (para 11 a p 85)', fm?.st === 'pass' && fm.m === 2 && /para 11 a p 85/.test(fm.reason), fm?.reason);
  const ca = row(L.rows, 'Clear axes');
  check('two up: each Bde on its own clear axis, the Div attack frontage = the Bdes\' and the gap (para 12 d p 86)', ca?.st === 'pass' && Math.abs(ca.m - 5300) < 1 && /para 12 d p 86/.test(ca.reason), ca?.reason);
  check('two up: the main attack has the Div reserve behind it (para 14 p 90; para 7 p 84)', row(L.rows, 'Main attack')?.st === 'pass' && row(R.rows, 'Main attack')?.st === 'pass');
  check('...mirrored: the secondary attack on the main attack\'s left, the boundary between them', item(R, 'objS').pts[0].x < item(R, 'obj').pts[0].x && item(L, 'objS').pts[0].x > item(L, 'obj').pts[0].x && item(L, 'bdy').pts[0].x > 0 && item(R, 'bdy').pts[0].x < 0);
  check('...the secondary attack is drawn as a 2525D Sp Attk (25151404), the main as Main Attk (25151403)', item(L, 'axisS').key === '25151404' && item(L, 'axis').key === '25151403');
  check('...the main attack\'s FUP and Bde assault frontage judged like any attack (1.0-1.2 km; 1.3 km within 1.5 km)', row(L.rows, 'FUP from the Obj')?.st === 'pass' && row(L.rows, 'Assault frontage')?.st === 'pass');
  check('...no Bn "Reserve reach" on a Div attack: the Div reserve row gives distance and times, no printed limit (p 88)', !row(L.rows, 'Reserve reach') && row(L.rows, 'Div reserve')?.st === 'pass' && /no time is printed/.test(row(L.rows, 'Div reserve').reason));
  // a reserve put behind the secondary attack warns
  const bad = rec('div-attk-main-left');
  bad.slots.find((s) => s.role === 'divRes').shape.at = [4000, 7500];
  check('a Div reserve behind the secondary attack: Main attack warns, with a fix', row(S.solveRecipe(bad, ctx, {}).rows, 'Main attack')?.st === 'warn');
  const over = rec('div-attk-main-left');
  for (const s of over.slots) if (/S$/.test(s.role) && s.shape?.pts) s.shape.pts = s.shape.pts.map(([x, y]) => [x - 3200, y]);
  check('overlapping Bde axes: Clear axes warns', row(S.solveRecipe(over, ctx, {}).rows, 'Clear axes')?.st === 'warn');
  const fu = row(U.rows, 'Div formation');
  check('one up: m 1, the follow-up Bde round OBJ A onto OBJ B (para 11 b p 86)', fu?.m === 1 && row(U.rows, 'Clear axes')?.st === 'pass' && /round OBJ A onto OBJ B/.test(row(U.rows, 'Clear axes').reason));
  // the ground (groundNotes): mountains want one up; the desert does not suit an Inf Div attack
  const g = (res, kind) => row(C.groundNotes(res.rows, doc, kind, 'attack', '21', true), 'Div formation');
  check('mountains: two up warns (one up the more applicable, p 85), one up passes with the mountain rules (pp 174-175)', g(L, 'mountain')?.st === 'warn' && g(U, 'mountain')?.st === 'pass' && /first light/.test(g(U, 'mountain').reason));
  check('desert: an Inf Div attack warns (s38 para 3 a p 171), with fixes', g(L, 'desert')?.st === 'warn' && /p 171/.test(g(L, 'desert').reason) && g(L, 'desert').detail?.fix?.length === 2);
  check('plains: two up passes; one up is told the narrow front is more easily sealed off (pp 86-87)', g(L, 'plains')?.st === 'pass' && /seal(ed)? off/.test(g(U, 'plains')?.reason ?? ''));
}

// ── the Div attack two down, the preliminary op and Ph 2 (GSP s19 para 13 b (3)-(6) p 88, para 13 d p 89) ──────────
{
  const D = await import('../../MS/Engines/DeploymentBuilder/PlanDivAttack.ts');
  const L = rec('div-attk-main-left'), U = rec('div-attk-one-up');
  const tb = (res) => row(res.rows, 'Tasks in Bns');
  const sL = S.solveRecipe(L, ctx, {}), sU = S.solveRecipe(U, ctx, {});
  check('two down, two up: 4 Bns in the assault, 2 Bde reserve Bns, the Div reserve Bde\'s 3: 9 of 9 (p 88; p 60; Annex A)', tb(sL)?.st === 'pass' && tb(sL).m === 9 && /4 Bns in the assault, 2 in the Bdes' reserves/.test(tb(sL).reason) && doc.plan.divAttack.bnsInDiv.value === 9, tb(sL)?.reason);
  check('two down, one up: the leading Bde\'s 3 Bns, the follow-up and reserve Bdes 3 each: 9', tb(sU)?.st === 'pass' && tb(sU).m === 9, tb(sU)?.reason);
  check('...the main Bde\'s assault Bns carry asltL / asltR, so the attack fit moves them with the FUP', ['asltL', 'asltR'].every((r) => item(sL, r)?.echelon === '16'));
  const extra = rec('div-attk-main-left');
  extra.slots.push({ role: 'bnLX', kind: 'point', sym: '10121100', label: 'Lt Bn', echelon: '16', order: 3, shape: { at: [0, 3000] } });
  check('a tenth Bn: Tasks in Bns warns (more than the Div holds: from Corps, p 59)', row(S.solveRecipe(extra, ctx, {}).rows, 'Tasks in Bns')?.st === 'warn');
  // the preliminary operation
  const P = D.withDivOptions(L, doc, { phases: 1, prelim: true }), sP = S.solveRecipe(P, ctx, {});
  const vP = V.validateRecipe(P, { doc, symbols: ctx.symbols });
  check('prelim op: a valid recipe, id -pre, OBJ P1 and P2 on the ground of each FUP (own side of the SL, forward of the Assy)', vP.length === 0 && P.id === 'div-attk-main-left-pre' && ['objP', 'objPS'].every((r) => { const c = item(sP, r).pts; const y = c.reduce((a, p) => a + p.y, 0) / c.length; return y < 250 && y > -3750; }), vP.map((i) => i.msg).join('; '));
  check('...each leading Bde\'s Res Bn does it; the Prelim op row passes with p 89 and says force and time are E', item(sP, 'bnRes').label === 'Res Bn (Prelim Op)' && row(sP.rows, 'Prelim op')?.st === 'pass' && /para 13 d p 89/.test(row(sP.rows, 'Prelim op').reason) && /decisions \(E\)/.test(row(sP.rows, 'Prelim op').reason));
  check('...one up: only the leading Bde\'s outposts (OBJ P1)', (() => { const u = S.solveRecipe(D.withDivOptions(U, doc, { phases: 1, prelim: true }), ctx, {}); return !!item(u, 'objP') && !item(u, 'objPS'); })());
  check('...the recipe passed in is not changed', !L.slots.some((s) => s.role === 'objP'));
  // Ph 2 by the Div reserve
  const T = D.withDivOptions(L, doc, { phases: 2, prelim: false }), sT = S.solveRecipe(T, ctx, {});
  const vT = V.validateRecipe(T, { doc, symbols: ctx.symbols });
  check('Ph 2: a valid recipe, id -2ph; OBJ C behind and between OBJ A and OBJ B, PL 1 beyond the Ph 1 Objs, the LOE beyond OBJ C', vT.length === 0 && T.id === 'div-attk-main-left-2ph' && (() => { const c = item(sT, 'objC').pts, a = item(sT, 'obj').pts, b = item(sT, 'objS').pts; const cx = c.reduce((s, p) => s + p.x, 0) / 4; return Math.min(...c.map((p) => p.y)) > Math.max(...a.map((p) => p.y)) && cx > Math.max(...a.map((p) => p.x)) && cx < Math.min(...b.map((p) => p.x)) && Math.min(...item(sT, 'pl1').pts.map((p) => p.y)) > Math.max(...a.map((p) => p.y)) && item(sT, 'loe').pts[0].y > Math.max(...c.map((p) => p.y)); })(), vT.map((i) => i.msg).join('; '));
  check('...Div phases passes (p 88 (6)); FUP C 1.0-1.2 km from OBJ C; Ph 2 through the gap 550 m clear of the Ph 1 Objs', row(sT.rows, 'Div phases')?.st === 'pass' && row(sT.rows, 'FUP C from OBJ C')?.st === 'pass' && row(sT.rows, 'Ph 2 through the gap')?.st === 'pass' && Math.abs(row(sT.rows, 'Ph 2 through the gap').m - 550) < 1, row(sT.rows, 'Ph 2 through the gap')?.reason);
  check('...Fresh reserve warns: the Div reserve is committed and the plan names none (p 88 (5)), three fixes', row(sT.rows, 'Fresh reserve')?.st === 'warn' && row(sT.rows, 'Fresh reserve').detail?.fix?.length === 3 && !row(sT.rows, 'Div reserve'));
  check('...the boundary ends short of FUP C; the reserve Bde labelled for Ph 2', Math.max(...item(sT, 'bdy').pts.map((p) => p.y)) < Math.min(...item(sT, 'fupC').pts.map((p) => p.y)) && item(sT, 'divRes').label === '3 Bde (Ph 2)');
  check('...one up is phased already: Ph 2 adds nothing to it', D.withDivOptions(U, doc, { phases: 2, prelim: false }) === U);
  check('...both options together: id -pre-2ph, valid', (() => { const b = D.withDivOptions(L, doc, { phases: 2, prelim: true }); return b.id === 'div-attk-main-left-pre-2ph' && V.validateRecipe(b, { doc, symbols: ctx.symbols }).length === 0; })());
  check('...a Bn or Bde attack is left as it is', D.withDivOptions(rec('bde-attk-two-up'), doc, { phases: 2, prelim: true }).id === 'bde-attk-two-up');
}

// ── a Bde on a ditch cum bund, three Bns up (GSP s26 pp 118-121) ──────────────────────────────────────────────────────
{
  const r = rec('bde-def-dcb');
  const issues = V.validateRecipe(r, { doc, symbols: ctx.symbols, file: 'bde-def-dcb.json' });
  check('bde-def-dcb: a valid recipe (no fail, no warn), the Bde Def family, the ditch layout (the click on the ditch)', issues.length === 0 && r.family === 'bde-def' && r.layout === 'ditch' && r.pivot === 'xTgt', issues.map((i) => i.msg).join('; '));
  const index = json('MS/Data/Deployments/Recipes/index.json');
  check('...offered in the Bde Def family beside two up', !!index.families.find((f) => f.id === 'bde-def')?.recipes.includes('bde-def-dcb'));
  const s = S.solveRecipe(r, ctx, {});
  const fw = s.items.filter((i) => /^fwd[LCR]$/.test(i.role));
  check('three Bns up on the obstacle, no depth Bn: Three up on the DCB passes (para 8 b pp 120-121)', fw.length === 3 && row(s.rows, 'Three up on the DCB')?.st === 'pass');
  check('frontage 9.15 km held on the obstacle, inside the Bde\'s 8000-10000 m (para 5 p 119)', row(s.rows, 'Frontage')?.st === 'pass' && Math.abs(s.frontageM - 9150) < 1, row(s.rows, 'Frontage')?.reason);
  const dp = row(s.rows, 'Depth');
  check('Depth judged on the Bns\' own (an AT ditch Bn 1850-2757 m, IBB App 9), not the plains Bde\'s 4-6 km: passes', dp?.st === 'pass' && Math.abs(dp.m - 1850) < 1 && /para 8 b pp 120-121/.test(dp.reason), dp?.reason);
  check('Gaps covered: both gaps between the Bns mined (para 8 c p 121); Mutual support by the Bns\' mortars passes', row(s.rows, 'Gaps covered')?.st === 'pass' && /2 of the 2/.test(row(s.rows, 'Gaps covered').reason) && row(s.rows, 'Mutual support')?.st === 'pass');
  check('Contingency posns: two, planned (dashed), behind the Bns (para 8 f p 121)', row(s.rows, 'Contingency posns')?.st === 'pass' && s.items.filter((i) => /^cp[LR]$/.test(i.role)).every((i) => i.planned));
  check('Protective elements: a 2525D Screen 1.5 km ahead of the ditch (para 6 p 120)', row(s.rows, 'Protective elements')?.st === 'pass' && item(s, 'scr')?.key === '25342203' && Math.abs(row(s.rows, 'Protective elements').m - 1500) < 1);
  check('Reserves: the counter-penetration and counter-attack reserves are the Div\'s (para 6 p 120; para 8 g p 121)', row(s.rows, 'Reserves')?.st === 'pass' && /Div's/.test(row(s.rows, 'Reserves').reason));
  // a Bn moved back into depth: three up warns
  const two = rec('bde-def-dcb');
  const c = two.slots.find((x) => x.role === 'fwdC'); c.kind = 'depth'; c.seed = { acrossM: 0, backM: 3000 };
  check('one Bn put in depth instead: Three up on the DCB warns, with fixes', row(S.solveRecipe(two, ctx, {}).rows, 'Three up on the DCB')?.st === 'warn');
  check('...the two-up Bde (plains) keeps its own depth rule (no DCB rows)', !row(S.solveRecipe(rec('bde-def-two-up'), ctx, {}).rows, 'Three up on the DCB'));
}

// ── second-line troops (GSP s17 paras 13, 17-18 pp 73-74) ─────────────────────────────────────────────────────────────
{
  const u = (id, name, extra = {}) => ({ id, name, side: 'own', echelon: '16', strength: 696, coys: 4, plsPerCoy: 3, atgm: [], rr: [], mortars: [], mgEffM: null, mgCount: 4, apcs: 0, mounted: false, src: 'test', notes: [], ...extra });
  const rg = u('inf-wing-rangers', 'Rangers Wing'), fc = u('inf-wing-fc', 'FC Wing'), mj = u('inf-bn-mjd', 'Mjd Bn');
  const a = O.secondLineRow(rg, 'attack', 'mech');
  check('a Rangers Wing in an attack: warn, defensive operations only (p 74 para 18)', a?.st === 'warn' && /para 18 p 74/.test(a.reason) && a.detail?.fix?.length === 2, a?.reason);
  const d = O.secondLineRow(fc, 'defence', 'armd');
  check('an FC Wing in defence against armour, no AT grouped: warn, no AT weapons (p 74 para 17 a)', d?.st === 'warn' && /no AT weapons/.test(d.reason) && /17 a/.test(d.reason), d?.reason);
  const dAt = O.secondLineRow(u('inf-wing-fc', 'FC Wing + 1 LAT Coy', { atgm: [{ id: null, name: 'Baktar Shikan', count: 12, rangeM: 3000 }] }), 'defence', 'armd');
  check('...with an AT group grouped to it: pass', dAt?.st === 'pass', dAt?.reason);
  check('...against infantry: pass (purely infantry operations, para 18)', O.secondLineRow(rg, 'defence', 'inf')?.st === 'pass');
  check('a Mjd Bn in an attack: warn, base of fire not the assault (p 73 para 13 c)', O.secondLineRow(mj, 'attack', 'inf')?.st === 'warn' && /13 c p 73/.test(O.secondLineRow(mj, 'attack', 'inf').reason));
  check('a Mjd Bn holding against mech: warn, less important areas (p 73 para 13 a); against infantry: pass', O.secondLineRow(mj, 'defence', 'mech')?.st === 'warn' && O.secondLineRow(mj, 'defence', 'inf')?.st === 'pass');
  check('a Rangers rifle Coy (a Coy plan of the Wing) is judged too', O.secondLineRow(u('inf-coy-rangers-rifle', 'Rangers Rifle Coy', { echelon: '15' }), 'attack', 'inf')?.st === 'warn');
  check('a regular Bn, an ambush or a patrol: no row', O.secondLineRow(u('inf-bn-std', 'Std Inf Bn'), 'attack', 'inf') === null && O.secondLineRow(rg, 'ambush', 'inf') === null && O.secondLineRow(null, 'defence', 'inf') === null);
}

// ── the Indian reserves: GSP p 83 beside IDD p 5 (the books differ) ─────────────────────────────────────────────────────
{
  const ipb = json('MS/Data/IpbDoctrine.json');
  const ind = ipb.decisionPoints.reserves.indian;
  check('IpbDoctrine lists GSP as a source; the Indian reserves cite GSP p 83 beside IDD p 5, the ladder still IDD\'s', !!ipb.sources.GSP && ind.refs.some((r) => r.book === 'GSP' && r.page === '83') && ind.refs.some((r) => r.book === 'IDD') && ind.ladder[0].h[0] === 1 && /35-40 min/.test(ind.text));
  const tpl = json('MS/Data/IpbTemplates.json');
  const t = (id) => tpl.templates.find((x) => x.id === id);
  check('IpbTemplates: GSP beside IDD / KYE / DW in the Bde, Div and desert defences and the break-in / break-out phases', [t('def-bde'), t('def-div'), t('def-desert')].every((x) => /GSP 1947/.test(x?.src ?? '')) && ['breakin', 'breakout'].every((id) => /GSP 1947/.test(tpl.phases.offensive.rows.find((r) => r.id === id).src)));
}

// ── the Move Planner: an Inf Div concentrates on 20 map squares (Annex J para 1 h p 205) ─────────────────────────────────
{
  const md = json('MS/Data/MoveDoctrine.json');
  const sp = MR.spaceRulesFrom(md);
  check('Inf Div fighting echelons 20 map squares and the DAA 15-20 (GSP Annex J p 205)', sp.assyKm2.inf_div[0] === 20 && sp.assyKm2.inf_div[1] === 20 && sp.assyKm2.div_daa[0] === 15 && sp.assyKm2.div_daa[1] === 20);
  const ok = MR.assySpace('inf_div', 24, sp), small = MR.assySpace('inf_div', 12, sp), big = MR.assySpace('inf_div', 45, sp);
  check('24 km2 is enough for an Inf Div ("needs 20", one figure said once); 12 too small; 45 much larger', ok.tone === 'ok' && /needs 20\)/.test(ok.text) && small.tone === 'bad' && big.tone === 'warn', `${ok.text} | ${small.text} | ${big.text}`);
  check('an Inf Div moves in 10 trains with its B vehs by road (Annex J para 1 f)', md.rail.trainsPerFmn.inf_div.bVehsByRoad === 10);
}

// ── H6: the C Tps and SZ read their doctrine paths (GSP s23 p 105 para 10, p 107) ─────────────────────────────────────────
{
  for (const id of ['div-def-two-up', 'div-def-three-axes']) {
    const r = rec(id), res = S.solveRecipe(r, ctx);
    const ct = res.items.filter((i) => i.role === 'ctps'), sz = item(res, 'sz');
    const fwd = res.items.filter((i) => /^fwd/.test(i.role) && i.pts.length >= 3);
    const front = Math.max(...fwd.flatMap((i) => i.pts.map((p) => p.y)));
    const ahead = doc.plan.securityZone.divCtpsAheadM.value, deep = doc.plan.securityZone.divDepthM.value;
    check(id + ': a C Tps group per forward Bde, ' + ahead + ' m ahead of the FDL (securityZone.divCtpsAheadM, GSP p 105)', ct.length === fwd.length && ct.every((c) => Math.abs(c.pts[0].y - front - ahead) < 600), ct.map((c) => Math.round(c.pts[0].y - front)).join(', '));
    check(id + ': the SZ ' + deep / 1000 + ' km deep (securityZone.divDepthM, GSP p 107)', !!sz && Math.abs(Math.max(...ys(sz)) - Math.min(...ys(sz)) - deep) < 1, sz && String(Math.max(...ys(sz)) - Math.min(...ys(sz))));
    check(id + ': the recipe names the doctrine paths, no figure written in', JSON.stringify(r).includes('securityZone.divCtpsAheadM') && JSON.stringify(r).includes('securityZone.divDepthM'));
  }
  const sz = doc.plan.securityZone;
  check('the two figures carry their GSP refs (pp 105, 107)', sz.divCtpsAheadM.refs?.some((x) => x.book === 'GSP' && x.page === '105') && sz.divDepthM.refs?.some((x) => x.book === 'GSP' && x.page === '107'));
}

// ── H9: a Div on an obstacle with more than two Div-size approaches (GSP s26 para 5 p 119) ───────────────────────────────
{
  const Dc = await import('../../MS/Engines/DeploymentBuilder/PlanDcb.ts');
  const lv = (e) => ({ '15': 1, '16': 2, '18': 3, '21': 4 })[e] ?? null;
  const r = rec('div-def-two-up');
  const two = Dc.divApproachesRow(r, 'obstacle', [{ id: 'A1', carries: '21' }, { id: 'A2', carries: '21' }, { id: 'A3', carries: '18' }], doc, lv);
  const three = Dc.divApproachesRow(r, 'obstacle', [{ id: 'A1', carries: '21' }, { id: 'A2', carries: '21' }, { id: 'A3', carries: '21' }], doc, lv);
  check('two Div-size approaches (a third for a Bde): pass', two?.st === 'pass' && two.m === 2, two?.reason);
  check('three Div-size approaches: warn, with the book\'s words and a fix (more resources)', three?.st === 'warn' && three.m === 3 && /p 119/.test(three.reason) && three.detail?.fix?.length >= 2, three?.reason);
  check('not on an obstacle, not a Div, or an attack: no row', Dc.divApproachesRow(r, 'plains', [{ id: 'A1', carries: '21' }, { id: 'A2', carries: '21' }, { id: 'A3', carries: '21' }], doc, lv) === null && Dc.divApproachesRow(rec('bde-def-two-up'), 'obstacle', [{ id: 'A1', carries: '21' }], doc, lv) === null && Dc.divApproachesRow(rec('div-attk-main-left'), 'obstacle', [{ id: 'A1' }], doc, lv) === null);
  check('the limit is PlanDoctrine terrain.kinds.obstacle.divMajorApchsMax (2, GSP p 119)', doc.plan.terrain.kinds.obstacle.divMajorApchsMax.value === 2 && doc.plan.terrain.kinds.obstacle.divMajorApchsMax.refs?.[0]?.page === '119');
}

// ── H7 / H8: the withdrawal switches (GSP s30 paras 13-17 pp 144-145; OoW Vol III pp 33, 39-40) ─────────────────────────
{
  const Wf = await import('../../MS/Engines/DeploymentBuilder/PlanWithdrawalFmn.ts');
  for (const id of ['bde-wdr-night', 'div-wdr-night']) {
    const base = rec(id);
    const n2 = S.solveRecipe(Wf.withWdrOptions(base, doc, { intPosns: 2, newPosnBy: 'fresh' }), ctx);
    const n1 = S.solveRecipe(Wf.withWdrOptions(base, doc, { intPosns: 1, newPosnBy: 'fresh' }), ctx);
    const n0r = Wf.withWdrOptions(base, doc, { intPosns: 0, newPosnBy: 'fresh' }), n0 = S.solveRecipe(n0r, ctx);
    const ip = (s) => s.items.filter((i) => /^intPosn/.test(i.role)).length;
    check(id + ': Int posns 2 / 1 / 0 draw 2 / 1 / 0 intermediate posns; the default (2) is today\'s plan', ip(n2) === 2 && ip(n1) === 1 && ip(n0) === 0 && ip(S.solveRecipe(base, ctx)) === 2, [ip(n2), ip(n1), ip(n0)].join('/'));
    check(id + ': with none, row Int posns says the covering troops impose the delay alone (GSP p 145 para 15) and the hop to the new posn is judged', row(n0.rows, 'Int posns')?.st === 'pass' && /p 145/.test(row(n0.rows, 'Int posns').reason) && !!row(n0.rows, 'New posn hop'), row(n0.rows, 'New posn hop')?.reason?.slice(0, 80));
    check(id + ': the variants carry their own ids (-w0, -w1) so the tab finds the family again', n0r.id === id + '-w0' && Wf.withWdrOptions(base, doc, { intPosns: 1, newPosnBy: 'fresh' }).id === id + '-w1');
  }
  const byRes = S.solveRecipe(Wf.withWdrOptions(rec('div-wdr-night'), doc, { intPosns: 2, newPosnBy: 'res' }), ctx);
  check('Div: New posn by Res sends the reserve Bde to prepare the new posn (GSP p 145 para 17); the Reserve row warns, books differ (OoW Vol III p 40)', !!item(byRes, 'resNew') && !item(byRes, 'res') && row(byRes.rows, 'New posn prepared by')?.st === 'pass' && row(byRes.rows, 'Reserve')?.st === 'warn' && /books differ/i.test(row(byRes.rows, 'Reserve').detail?.why ?? ''), row(byRes.rows, 'Reserve')?.reason?.slice(0, 90));
}

// ── the Indian reserves ladder switch: IDD (default) or GSP p 83 ──────────────────────────────────────────────────────────
{
  const ipb = json('MS/Data/IpbDoctrine.json');
  const ind = ipb.decisionPoints.reserves.indian, st = json('MS/Data/Settings.json');
  const gsp = Object.fromEntries(ind.ladderGsp.map((x) => [x.lvl ?? x.level ?? x.id, x.h]));
  check('the ladder from GSP p 83 sits beside IDD\'s: Bn 35-40 min, Bde 2-3 h, Div 4-6 h', ind.ladderGsp.length >= 3 && JSON.stringify(ind.ladderGsp).includes('0.58') && JSON.stringify(ind.ladderGsp).includes('[2,3]') && JSON.stringify(ind.ladderGsp).includes('[4,6]'), JSON.stringify(gsp));
  check('Settings: extended.ipb.reserveLadder defaults to idd (today\'s times)', st.groundGuide.extended.ipb.reserveLadder === 'idd');
  const gg = readFileSync(resolve(repo, 'MS/Engines/GroundGuide/GroundGuide.ts'), 'utf8');
  check('the guide picks ladderGsp on gsp, else the IDD ladder', /reserveLadder === 'gsp'/.test(gg) && /ladderGsp/.test(gg));
}

// ── N3: relief in line and passage of lines (GSP s29 pp 134-140, s20 pp 93-96) ──────────────────────────────────────────
{
  for (const id of ['bde-relief', 'bde-passage']) {
    const iss = V.validateRecipe(rec(id), { doc, symbols: ctx.symbols }).filter((i) => i.level === 'fail');
    check(id + ' validates', !iss.length, iss.map((i) => i.msg).join('; '));
  }
  const rl = S.solveRecipe(rec('bde-relief'), ctx);
  const names = ['Relief time', 'Relief routes', 'Order of relief', 'Command change', 'Artillery', 'By night'];
  check('relief: the six rows, every one a pass on the recipe as laid', names.every((nm) => row(rl.rows, nm)?.st === 'pass'), names.map((nm) => (row(rl.rows, nm)?.st ?? 'none')).join(' '));
  check('relief: 48 h for a Bde Gp (relief.bdeGpMinH, GSP p 134); command changes once more than half is relieved (pp 136-137)', /48 h/.test(row(rl.rows, 'Relief time').reason) && /p 134/.test(row(rl.rows, 'Relief time').reason) && /pp 136-137/.test(row(rl.rows, 'Command change').reason));
  check('relief: an Assy area, a route and a guides RV for each incoming Bn', ['assyA', 'assyB', 'assyC', 'rtA', 'rtB', 'rtC', 'rvA', 'rvB', 'rvC'].every((r) => item(rl, r)));
  const ps = S.solveRecipe(rec('bde-passage'), ctx);
  const pn = ['Lanes', 'Passage points', 'Assy area', 'Handover', 'Holding fire'];
  check('passage: the five rows, every one a pass', pn.every((nm) => row(ps.rows, nm)?.st === 'pass'), pn.map((nm) => (row(ps.rows, nm)?.st ?? 'none')).join(' '));
  check('passage: the BHOL on the holding FDL, a lane and a passage point per assault Bn, a contact point', ['bhol', 'laneL', 'laneR', 'ppL', 'ppR', 'cp', 'holdL', 'holdR'].every((r) => item(ps, r)));
  const ix = json('MS/Data/Deployments/Recipes/index.json');
  check('index: the two families, Bde level', ['bde-relief', 'bde-passage'].every((fid) => ix.families.some((x) => x.id === fid && x.echelon === '18')));
}

// ── N6: anti-heliborne defence of a VP (GSP s28 pp 127-133) ─────────────────────────────────────────────────────────────
{
  const F = await import('../../MS/Engines/DeploymentBuilder/PlanFit.ts');
  const r = rec('bn-anti-hb');
  const iss = V.validateRecipe(r, { doc, symbols: ctx.symbols }).filter((i) => i.level === 'fail');
  check('bn-anti-hb validates', !iss.length, iss.map((i) => i.msg).join('; '));
  const geo = S.solveRecipe(r, ctx);
  check('without the terrain the landing areas are assumed: Landing areas grey, never a pass', row(geo.rows, 'Landing areas')?.st === 'unchecked');
  check('the plan: OPs, obstacles and a road block on each LA; local defence, IAG and DAG all pass', ['LAs watched', 'LAs obstructed', 'Exits blocked', 'Local defence', 'Immediate action', 'Deliberate action'].every((nm) => row(geo.rows, nm)?.st === 'pass'));
  const flat = (cls) => ({ cls, elev: () => 200, going: () => ({ nogo: new Set(), caution: new Set() }), label: (c) => 'C' + c, sight: () => 0.9, avenues: () => null, pending: () => false, dataLine: () => 'synthetic ground' });
  const fitAt = (g) => F.fitLayout({ recipe: r, ctx, opts: { alternates: 'none' }, ground: g, anchor: { x: 0, y: 0 }, bearing: 0, threat: null });
  const las = (fl) => fl.res.items.filter((i) => /^la[A-C]$/.test(i.role));
  const cOf = (it) => ({ x: it.pts.reduce((a, p) => a + p.x, 0) / it.pts.length, y: it.pts.reduce((a, p) => a + p.y, 0) / it.pts.length });
  const vp = (fl) => item(fl.res, 'vp').pts[0];
  // open level ground everywhere: three LAs, nearest first, clear of the local defence, apart
  const open = fitAt(flat(() => 2));
  const L = las(open), dv = L.map((i) => Math.hypot(cOf(i).x - vp(open).x, cOf(i).y - vp(open).y));
  check('open ground: three LAs read, 600-1200 m from the VP (clearOfVpM), 800 m apart (laApartM)', L.length === 3 && dv.every((d) => d >= 590 && d <= 1200) && L.every((a, i) => L.every((b, j) => i === j || Math.hypot(cOf(a).x - cOf(b).x, cOf(a).y - cOf(b).y) >= 790)), dv.map(Math.round).join(', '));
  const third = (it) => { const c = cOf(it), v0 = vp(open); return Math.floor((((Math.atan2(c.x - v0.x, c.y - v0.y) * 180) / Math.PI + 360) % 360) / 120); };
  check('...all round: one LA in each third of the circle round the VP, lettered clockwise from north', new Set(L.map(third)).size === 3 && L.map(third).join('') === '012', L.map(third).join(''));
  const se = fitAt(flat((x, y) => (x > 0 && y < 0 ? 2 : 9)));
  check('...open ground on one side only: the three LAs still read there', las(se).length === 3 && las(se).every((i) => cOf(i).x > 0 && cOf(i).y < 0));
  check('...Landing areas pass (3), its OP between each LA and the VP', row(open.res.rows, 'Landing areas')?.st === 'pass' && row(open.res.rows, 'Landing areas').m === 3 && ['A', 'B', 'C'].every((k) => { const op = item(open.res, 'op' + k).pts[0], la = cOf(item(open.res, 'la' + k)); return Math.hypot(op.x - vp(open).x, op.y - vp(open).y) < Math.hypot(la.x - vp(open).x, la.y - vp(open).y); }));
  // woods / BUA within 2 km: the LAs lie beyond
  const wood = fitAt(flat((x, y) => (Math.hypot(x, y) < 2000 ? 9 : 2)));
  const dw = las(wood).map((i) => Math.hypot(cOf(i).x, cOf(i).y));
  check('no land class within 2 km: the LAs are read beyond it', las(wood).length === 3 && dw.every((d) => d >= 2000), dw.map(Math.round).join(', '));
  // steep everywhere: none, the rows grey
  const steep = fitAt({ ...flat(() => 2), elev: (x) => 200 + x * 0.5 });
  check('steep ground (27 degrees) everywhere: no LA, Landing areas warns, the LA rows grey, no LA drawn', las(steep).length === 0 && row(steep.res.rows, 'Landing areas')?.st === 'warn' && row(steep.res.rows, 'LAs watched')?.st === 'unchecked', row(steep.res.rows, 'Landing areas')?.reason?.slice(0, 60));
  // the ground not loaded: grey
  const unk = fitAt({ ...flat(() => null), pending: () => true });
  check('the ground not loaded: Landing areas grey (still loading)', row(unk.res.rows, 'Landing areas')?.st === 'unchecked');
  const ah = doc.plan.antiHb;
  check('PlanDoctrine antiHb figures: E, decided and searched', ['searchM', 'laMinM', 'laApartM', 'clearOfVpM', 'slopeOkDeg', 'landClasses', 'opFromLaM'].every((k) => ah[k]?.basis === 'E' && ah[k].decided && ah[k].searched));
}

// ── N5: the Inf Div advance on one axis (GSP s18 pp 76-80, Annex H p 203) ─────────────────────────────────────────────
{
  const A = await import('../../MS/Engines/DeploymentBuilder/PlanAdvance.ts');
  const F = await import('../../MS/Engines/DeploymentBuilder/PlanFit.ts');
  const r = rec('div-advance-inf');
  const iss = V.validateRecipe(r, { doc, symbols: ctx.symbols }).filter((i) => i.level === 'fail');
  check('div-advance-inf validates', !iss.length, iss.map((i) => i.msg).join('; '));
  const s = S.solveRecipe(r, ctx);
  check('it reads as an Inf Div advance (its harbour areas); the Armd Bde, Bn and Armd Div advances keep their kinds', A.advanceKind(s.items) === 'idiv' && A.advanceKind(S.solveRecipe(rec('bde-advance-armd'), ctx).items) === 'bde' && A.advanceKind(S.solveRecipe(rec('bn-advance-one-up'), ctx).items) === 'bn' && A.advanceKind(S.solveRecipe(rec('div-advance-two-bde'), ctx).items) === 'div');
  const rows = A.advanceRows(s.items, doc);
  const names = ['Grouping', 'Covering troops', 'Leading Pl', 'Main Gd', 'Arty with Adv Gd', 'Harbour areas', 'Div Tac HQ', 'DAA', 'Flank guards'];
  check('as laid: every Annex H row a pass', names.every((nm) => row(rows, nm)?.st === 'pass'), names.map((nm) => nm + ' ' + (row(rows, nm)?.st ?? 'none')).join(', '));
  check('...the Country row grey without the ground (GSP p 76 para 3)', row(rows, 'Country')?.st === 'unchecked' && /p 76/.test(row(rows, 'Country').reason));
  check('mob tps 1 h or 10-15 miles ahead (16-24 km), Har areas 15-20 miles apart (24-32 km), the Ldg Pl 20-30 min: Annex H p 203 figures', JSON.stringify(doc.plan.advance.infDiv.ctpsAheadM.value) === '[16000,24000]' && JSON.stringify(doc.plan.advance.infDiv.harApartM.value) === '[24000,32000]' && JSON.stringify(doc.plan.advance.infDiv.ldgPlAheadMin.value) === '[20,30]');
  // moved: the mob tps 30 km out, the follow-up harbour 10 km behind, the arty behind the Main Gd, the DAA 60 km back
  const mv = (it, dy) => ({ ...it, pts: it.pts.map((p) => ({ x: p.x, y: p.y + dy })) });
  const ys0 = (role) => item(s, role).pts[0].y;
  const bad = s.items.map((i) => (i.role === 'ctps' ? mv(i, -10000) : i.role === 'har2' ? mv(i, 18000) : i.role === 'arty' ? mv(i, ys0('mainGd') - ys0('arty') - 500) : i.role === 'daa' ? mv(i, -30000) : i));
  const br = A.advanceRows(bad, doc);
  check('moved out of the book: Covering troops, Harbour areas, Arty with Adv Gd and DAA warn', ['Covering troops', 'Harbour areas', 'Arty with Adv Gd', 'DAA'].every((nm) => row(br, nm)?.st === 'warn'), ['Covering troops', 'Harbour areas', 'Arty with Adv Gd', 'DAA'].map((nm) => nm + ' ' + row(br, nm)?.st).join(', '));
  const flat = { cls: () => 2, elev: () => 200, going: () => ({ nogo: new Set(), caution: new Set() }), label: (c) => 'C' + c, sight: () => 0.9, avenues: null, pending: () => false, dataLine: () => 'synthetic ground' };
  const fitAt = (terrain) => F.fitLayout({ recipe: r, ctx, opts: { alternates: 'none' }, ground: flat, anchor: { x: 0, y: 0 }, bearing: 0, threat: null, terrain });
  const pl = fitAt('plains'), mt = fitAt('mountains');
  check('fitted in open country: Country warns, made mobile or the Armd Div (p 76 para 3)', row(pl.res.rows, 'Country')?.st === 'warn' && pl.res.rows.find((x) => x.name === 'Country').detail?.fix?.length === 2);
  check('fitted in mountains: Country passes (restricted or mountainous country)', row(mt.res.rows, 'Country')?.st === 'pass');
  check('fitted: the axis read from the leading Bde\'s harbour to the mob tps, no IABG halting areas or march rows', !!row(pl.res.rows, 'Going on the axis') && /29\.0 km/.test(row(pl.res.rows, 'Going on the axis').reason) && !row(pl.res.rows, 'Halting areas') && !row(pl.res.rows, 'March'), row(pl.res.rows, 'Going on the axis')?.reason?.slice(0, 50));
  const ix = json('MS/Data/Deployments/Recipes/index.json');
  check('index: the Inf Div Advance family (inf-div), beside the Armd Div\'s', ix.families.some((x) => x.id === 'div-advance-inf' && x.unit === 'inf-div' && x.recipes.includes('div-advance-inf')));
}

console.log(`\n${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
