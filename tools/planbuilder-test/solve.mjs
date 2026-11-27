// solve.mjs -- checks the Build tab's pure solver (MS/Engines/DeploymentBuilder/PlanSolve.ts), geometry mode.
//   node tools/planbuilder-test/solve.mjs          (add --quiet to print only failures and the summary)
// Every recipe is laid out with the Pl posns on and off and the alternates on, then checked: the geometry is finite,
// posns do not overlap, the FEBA runs along the forward edges, every ground rule reads "not checked" (never pass),
// the doctrine rows give the expected verdicts, and the Plan document the Deployment Mgr places is well formed.
import { register } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
const PlanMod = await import('../../MS/Engines/ImportExport/Plan.ts');
const Plan = PlanMod.default ?? PlanMod.Plan;

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

const ctx = { doc: { plan: json('MS/Data/PlanDoctrine.json'), ocoka: json('MS/Data/OcokaDoctrine.json') }, symbols: json('MS/Data/Symbols.json') };
const dir = 'MS/Data/Deployments/Recipes';
const recipes = readdirSync(resolve(repo, dir)).filter((f) => f.endsWith('.json') && f !== 'index.json').map((f) => json(`${dir}/${f}`));
const finite = (p) => Number.isFinite(p.x) && Number.isFinite(p.y);
const row = (res, name) => res.rows.find((r) => r.name === name);

for (const r of recipes) {
  for (const detail of ['coy', 'pl']) {
    if (detail === 'pl' && r.echelon !== '16') continue;
    const res = S.solveRecipe(r, ctx, { detail, alternates: 'visible' });
    const tag = `${r.id}${detail === 'pl' ? ' +Pl' : ''}`;
    check(`${tag}: items, all coordinates finite`, res.items.length > 0 && res.items.every((i) => i.pts.length > 0 && i.pts.every(finite) && (!i.base || [i.base.start, i.base.mid, i.base.end].every(finite))), `${res.items.length} items`);
    check(`${tag}: every item has a catalog symbol`, res.items.every((i) => !!ctx.symbols[i.key]));
    check(`${tag}: ids unique`, new Set(res.items.map((i) => i.id)).size === res.items.length);
    check(`${tag}: a pivot to click on`, !!res.pivotId && res.items.some((i) => i.id === res.pivotId && (i.geo === 'Point' || i.geo === 'FPoint')), res.pivotId);
    check(`${tag}: no ground rule reads pass without the terrain`, res.slots.every((s) => s.checks.filter((c) => c.name === 'Ground' || c.name === 'Fd of fire').every((c) => c.st === 'unchecked')) && res.rows.filter((c) => /needs terrain data/.test(c.reason)).every((c) => c.st === 'unchecked'));
    check(`${tag}: a confirm-on-the-ground list`, res.confirm.length > 0);
    check(`${tag}: no posn reads Pass while its ground is unchecked`, res.slots.every((s) => s.st !== 'pass'));
    const sidcs = res.items.map(S.sidcFor);
    check(`${tag}: SIDCs are 20 digits, friend`, sidcs.every((s) => /^\d{20}$/.test(s) && s[3] === '3'));
    const out = S.toPlanDocument(res, Plan.createSymbol, Plan.createOverlay, 1);
    const syms = out.doc.poObj.plnOrdrOverlay.flatMap((o) => o.plnOrdrSymbolSet);
    check(`${tag}: Plan document holds every item`, Plan.isPlanDocument(out.doc) && syms.length === res.items.length);
    check(`${tag}: pivot and roles carried`, out.pivotId === res.pivotId && Object.keys(out.roles).length === res.items.length);
    const des = syms.map((s) => JSON.parse(s.drawEss));
    // a Bde / Div withdrawal reaches 60 km back (two intermediate posns, OOW3 Annex P): within a degree of the anchor
    check(`${tag}: points in degrees near 0,0`, des.every((d) => [d.GEOM, ...(d.CTRL_PTS ?? [])].filter(Boolean).every((p) => Math.abs(p.x) < 1 && Math.abs(p.y) < 1)));
    check(`${tag}: text has checks and confirm`, /CHECKS/.test(S.planText(res)) && /CONFIRM ON THE GROUND/.test(S.planText(res)));
  }
}

// ── defence specifics ────────────────────────────────────────────────────────────────────────────────────────────
const get = (id) => recipes.find((r) => r.id === id);
const two = S.solveRecipe(get('bn-def-two-up'), ctx, { alternates: 'visible' });
// ── the layouts as IBB Annex U / V draw them (the user, 27 Nov 2026: "follow this layout in true sense") ───────────
{
  const box = (res, role) => { const it = res.items.find((i) => i.role === role); const xs = it.pts.map((p) => p.x), ys = it.pts.map((p) => p.y); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2 }; };
  const A = box(two, 'fwdL'), B = box(two, 'fwdR'), C = box(two, 'depth'), D = box(two, 'res');
  check('two up (Annex U App 6): a depth Coy behind EACH forward Coy, C behind A, D behind B, side by side', Math.abs(C.cx - A.cx) < 1 && Math.abs(D.cx - B.cx) < 1 && Math.abs(C.cy - D.cy) < 1 && C.y1 < A.y0 && D.y1 < B.y0, `A ${A.cx},${A.cy} C ${C.cx},${C.cy} B ${B.cx},${B.cy} D ${D.cx},${D.cy}`);
  check('two up: depth 3000-4000 m, the forward edge to the rear of the depth Coys', two.depthM >= 2999 && two.depthM <= 4001, `${Math.round(two.depthM)} m`);
  check('one Bn HQ, behind the depth Coys, and the click on it (IBB S3 p 23)', two.items.filter((i) => i.role === 'hq').length === 1 && two.items.find((i) => i.role === 'hq').pts[0].y < C.y0 && two.items.find((i) => i.id === two.pivotId)?.role === 'hq');
  const ex = S.solveRecipe(get('bn-def-extended'), ctx, {});
  const pls = ex.items.filter((i) => i.role === 'fwdLPl').map((i) => box({ items: [i] }, i.role)).sort((a, b) => a.cx - b.cx);
  check('extended (Annex U App 7): each forward Coy three Pls up in a row, 600 m, 300 m apart, drawn with Coy posns only', pls.length === 3 && pls.every((p) => Math.abs(p.x1 - p.x0 - 600) < 2 && Math.abs(p.cy - pls[0].cy) < 1) && Math.abs(pls[1].x0 - pls[0].x1 - 300) < 2, pls.map((p) => `${Math.round(p.x0)}..${Math.round(p.x1)}`).join(' '));
  check('extended: 800 m between the Coys, 5600 m held inside the 6300 m row, two Coys back', Math.abs(box(ex, 'fwdR').x0 - box(ex, 'fwdL').x1 - 800) < 2 && Math.abs(ex.frontageM - 5600) < 2 && Math.abs(box(ex, 'depth').cx - box(ex, 'fwdL').cx) < 1 && Math.abs(box(ex, 'res').cx - box(ex, 'fwdR').cx) < 1, `${Math.round(ex.frontageM)} m`);
  for (const id of ['bn-def-canal-three-up', 'bn-def-at-ditch']) {
    const cv = S.solveRecipe(get(id), ctx, {});
    const f3 = ['fwdL', 'fwdC', 'fwdR'].map((r) => box(cv, r));
    check(`${id} (Annex V): three Coys up, 450 m apart, within 4115 m; frontage and depth pass`, f3.every((b) => Math.abs(b.cy - f3[0].cy) < 1) && Math.abs(f3[1].x0 - f3[0].x1 - 450) < 2 && Math.abs(f3[2].x0 - f3[1].x1 - 450) < 2 && cv.frontageM <= 4116 && row(cv, 'Frontage')?.st === 'pass' && row(cv, 'Depth')?.st === 'pass', `${Math.round(cv.frontageM)} m, ${row(cv, 'Depth')?.reason}`);
    check(`${id}: a second line force and dotted C Pen posns in depth`, cv.items.some((i) => i.role === 'slf') && cv.items.filter((i) => /^cp/.test(i.role) && i.planned).length === 2);
  }
}
check('Bn two up: frontage passes the two-up row', row(two, 'Frontage')?.st === 'pass', row(two, 'Frontage')?.reason);
check('Bn two up: depth inside 3-4 km', row(two, 'Depth')?.st === 'pass', row(two, 'Depth')?.reason);
check('Bn two up: gap 500 m passes', row(two, 'Gaps')?.st === 'pass', row(two, 'Gaps')?.reason);
// at the book's 4 km/h (IBB p 18) a reserve 3.3 km deep (inside IBB's 3-4 km) needs 36 min, past the 30 min (IBB p 279): it warns
// D Coy behind B Coy (IBB Annex U App 6 p 481: a depth Coy behind each forward Coy), 3050 m deep
check('Bn two up: reserve 43 min on foot passes a Bn counter-attack within an hour (IBB p 306; 4 km/h)', row(two, 'Reserve reach')?.st === 'pass' && /43 min.*wants 60 min/.test(row(two, 'Reserve reach')?.reason ?? ''), row(two, 'Reserve reach')?.reason);
const feba = two.items.find((i) => i.role === 'fdl');
const fwdTops = two.slots.filter((s) => s.kind === 'fwd').map((s) => s.centre.y + s.hM / 2);
check('Bn two up: FEBA (25140400) along the forward edges', feba?.key === '25140400' && feba.pts.every((p) => fwdTops.some((t) => Math.abs(p.y - t) < 1)));
check('Bn two up: 4 Coy posns, 4 Coy units, a Bn HQ', two.items.filter((i) => i.key === '25151200' && !i.planned).length === 4 && two.items.filter((i) => i.key === '10121100' && i.echelon === '15').length === 4 && two.items.some((i) => i.role === 'hq' && i.hq));
check('Bn two up: killing ground left out without terrain', two.dropped.some((d) => d.role === 'killingGr'));
check('Bn two up: DF targets 8-12', (() => { const k = two.items.filter((i) => i.role === 'dfTgt').length; return k >= 8 && k <= 12; })(), String(two.items.filter((i) => i.role === 'dfTgt').length));
const closeT = two.items.filter((i) => i.role === 'dfTgt').map((t) => Math.min(...fwdTops.map((y) => t.pts[0].y - y)));
check('Bn two up: no DF target nearer the FDL than 550 m (IC s111.4)', closeT.every((d) => d >= 549), closeT.map(Math.round).join(','));
check('Bn two up: LPs 300-400 m out', two.items.filter((i) => i.role === 'lp').every((l) => fwdTops.some((y) => l.pts[0].y - y >= 300 && l.pts[0].y - y <= 400)));
check('Bn two up: AT minefield about 200 m in front', (() => { const m = two.items.find((i) => i.role === 'atMines'); const y0 = Math.min(...m.pts.map((p) => p.y)); return Math.abs(y0 - Math.max(...fwdTops) - 200) < 1; })());
const alts = two.items.filter((i) => i.planned);
// the two Coy alternates and the two RRs' alternatives (IBB p 41), all planned
check('Bn two up: two alternates and two RR alternatives, planned (dashed)', alts.filter((a) => a.role === 'alt').length === 2 && alts.filter((a) => a.role === 'rrAlt').length === 2 && alts.length === 4 && alts.every((a) => S.sidcFor(a)[6] === '1'));
check('Bn two up: alternates clear of every posn', (() => {
  const boxes = two.slots.map((s) => ({ x: s.centre.x, y: s.centre.y, w: s.wM, h: s.hM }));
  return two.alternates.every((a) => boxes.every((b) => Math.abs(a.centre.x - b.x) >= (b.w + b.w * 0.7) / 2 || Math.abs(a.centre.y - b.y) >= (b.h + b.h * 0.7) / 2));
})());
const hid = S.solveRecipe(get('bn-def-two-up'), ctx, { alternates: 'hidden' });
check('alternates hidden: created, marked hidden (the RRs\' alternatives with them)', hid.items.filter((i) => i.planned).every((i) => i.hidden) && S.toPlanDocument(hid, Plan.createSymbol, Plan.createOverlay, 1).hidden.length === 4);
const none = S.solveRecipe(get('bn-def-two-up'), ctx, { alternates: 'none' });
check('alternates none: not created', !none.items.some((i) => i.planned));
const pl = S.solveRecipe(get('bn-def-two-up'), ctx, { detail: 'pl', alternates: 'none' });
check('+Pl posns: 12 Pl posns inside the 4 Coys', pl.items.filter((i) => i.echelon === '14' && i.key === '25151200').length === 12);
const three = S.solveRecipe(get('bn-def-three-up'), ctx, {});
check('Bn three up: frontage passes the three-up row', row(three, 'Frontage')?.st === 'pass', row(three, 'Frontage')?.reason);
const round = S.solveRecipe(get('bn-def-all-round'), ctx, {});
check('Bn all round: warns that posns face away', row(round, 'Facing the threat')?.st === 'warn');
check('Bn all round: FEBA closes round the posns', (() => { const f = round.items.find((i) => i.role === 'fdl'); return f && f.pts.length >= 5 && S.sidcFor(f).slice(4, 6) === '25'; })());
const one = S.solveRecipe(get('bn-def-one-up'), ctx, {});
check('Bn one up: frontage warns (no doctrine row, E)', row(one, 'Frontage')?.st === 'warn');
const coy = S.solveRecipe(get('coy-def-two-up'), ctx, {});
check('Coy two up: frontage 1500 m passes', row(coy, 'Frontage')?.st === 'pass' && Math.round(coy.frontageM) === 1500, String(coy.frontageM));
check('Coy two up: Pl gap 300 m passes', row(coy, 'Gaps')?.st === 'pass', row(coy, 'Gaps')?.reason);
check('Coy two up: Coy HQ is the pivot', coy.items.find((i) => i.id === coy.pivotId)?.label === 'Coy HQ');

// ── attack ───────────────────────────────────────────────────────────────────────────────────────────────────────
const atk = S.solveRecipe(get('bn-attk-frontal'), ctx, {});
check('Bn Attk: FUP 1000-1200 m from the Obj', row(atk, 'FUP from the Obj')?.st === 'pass', row(atk, 'FUP from the Obj')?.reason);
check('Bn Attk: assault 400 m wide', row(atk, 'Assault frontage')?.st === 'pass', row(atk, 'Assault frontage')?.reason);
check('Bn Attk: BOF on a flank and in range', row(atk, 'BOF on a flank')?.st === 'pass' && row(atk, 'BOF range')?.st === 'pass', `${row(atk, 'BOF on a flank')?.reason} / ${row(atk, 'BOF range')?.reason}`);
check('Bn Attk: mortars reach the LOE', row(atk, 'Mortars reach the LOE')?.st === 'pass', row(atk, 'Mortars reach the LOE')?.reason);
check('Bn Attk: the click lands on the Obj', atk.items.find((i) => i.id === atk.pivotId)?.role === 'objTgt');
const axis = atk.items.find((i) => i.role === 'axis');
check('Bn Attk: axis arrow carries BASE_LN_PTS 400 m wide', !!axis?.base && Math.abs(Math.hypot(axis.base.start.x - axis.base.end.x, axis.base.start.y - axis.base.end.y) - 400) < 1);
check('Bn Attk: LOE is the 2525D LOA (25140900)', atk.items.find((i) => i.role === 'loe')?.key === '25140900');
check('Bn Attk: FUP unseen is not checked', row(atk, 'FUP unseen')?.st === 'unchecked');

// formations: a Bde's gaps covered by its Bns' mortars, a Div's by its artillery (not the MGs' 914 m)
{
  const rj = (id) => json(`MS/Data/Deployments/Recipes/${id}.json`);
  const bde = S.solveRecipe(rj('bde-def-two-up'), ctx), div = S.solveRecipe(rj('div-def-two-up'), ctx);
  const mb = row(bde, 'Mutual support'), md = row(div, 'Mutual support');
  check('Bde Def: Mutual support judged on the Bns\' 81 mm mortars (1.5 km gap inside 3.7 km): pass, MGs named as too short', mb?.st === 'pass' && /81 mm mortars/.test(mb.reason) && /MGs only/.test(mb.reason), mb?.reason);
  check('Div Def: Mutual support between Bdes left to the Div artillery (grey, never an MG verdict)', md?.st === 'unchecked' && /Div artillery/.test(md.reason) && !/MGs sweep/.test(md.reason), md?.reason);
  const bn = S.solveRecipe(rj('bn-def-two-up'), ctx);
  check('...a Bn keeps the MG test', /MGs sweep/.test(row(bn, 'Mutual support')?.reason ?? ''), row(bn, 'Mutual support')?.reason);
}

console.log(`\n${recipes.length} recipes, ${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
