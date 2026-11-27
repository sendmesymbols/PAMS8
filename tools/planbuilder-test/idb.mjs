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

console.log(`\n${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
