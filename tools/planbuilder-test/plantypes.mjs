// plantypes.mjs -- checks the plan types built on 24 Nov 2026 from Doctrine_Review.md (R211, R212, R226, R238/R239, R185,
// R227): the Bn delaying action (bn-delay, PlanDelay.ts), the withdrawal by day (bn-wdr-day), and the rest as they land.
//   node tools/planbuilder-test/plantypes.mjs          (add --quiet to print only failures and the summary)
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
const Wd = await import('../../MS/Engines/DeploymentBuilder/PlanWithdrawal.ts');
const Dl = await import('../../MS/Engines/DeploymentBuilder/PlanDelay.ts');
const V = await import('../../MS/Engines/DeploymentBuilder/PlanRecipes.ts');
const F = await import('../../MS/Engines/DeploymentBuilder/PlanFit.ts');

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const quiet = process.argv.includes('--quiet');
const json = (p) => JSON.parse(readFileSync(resolve(repo, p), 'utf8'));
let n = 0, fails = 0;
function check(name, ok, info = '') {
  n++;
  if (!ok) fails++;
  if (!ok || !quiet) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
}
const doc = { plan: json('MS/Data/PlanDoctrine.json'), ocoka: json('MS/Data/OcokaDoctrine.json') };
const ctx = { doc, symbols: json('MS/Data/Symbols.json') };
const rec = (id) => json(`MS/Data/Deployments/Recipes/${id}.json`);
const rules = json('MS/Data/terrain-bundle/rules.json');
const goingOf = (p) => ({ nogo: new Set(rules.profiles[p].nogo), caution: new Set(rules.profiles[p].caution ?? []) });
const row = (rows, name) => rows.find((r) => r.name === name);
const item = (res, role) => res.items.find((i) => i.role === role);
const centre = (pts) => ({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length });
const top = (pts) => Math.min(...pts.map((p) => p.y)), bottom = (pts) => Math.max(...pts.map((p) => p.y));
const index = json('MS/Data/Deployments/Recipes/index.json');
const fams = index.families ?? index;

// open ground in world metres; a ridge of high ground (`hill`: a y band that blocks the view behind it) and water bands
const ground = ({ waterY = [], blockY = null, known = true } = {}) => {
  const cls = (x, y) => (!known ? null : waterY.some((w) => Math.abs(y - w) < 20) ? 20 : 2);
  return {
    cls, elev: () => (known ? 200 : NaN), going: goingOf, label: (c) => `C${c}`,
    sight(ox, oy, e, tx, ty) { if (!known) return null; if (blockY !== null && (oy - blockY) * (ty - blockY) < 0) return 0.1; return 0.9; },
    avenues(from, to) { return known ? [{ path: [from, to], lengthM: 0, goPct: 90, minWidthM: 500, chokes: [] }] : null; },
    pending: () => false, dataLine: () => 'synthetic ground',
  };
};
const frameFor = (res) => ({ anchor: { x: 0, y: 0 }, bearing: 0, k: 1, pivot: item(res, 'hq').pts[0] });

// ── R226 the Bn delaying action ──────────────────────────────────────────────────────────────────────────────────────
{
  const dl = rec('bn-delay');
  const issues = V.validateRecipe(dl, { doc, symbols: ctx.symbols }).filter((i) => i.level === 'fail');
  check('bn-delay validates; in the bn-wdr family with the night and day withdrawals', !issues.length && fams.find((f) => f.id === 'bn-wdr')?.recipes.includes('bn-delay') && V.LAYOUTS.includes('delay'), issues.map((i) => i.msg).join('; '));
  const res = S.solveRecipe(dl, ctx);
  const fwd = ['fwdL', 'fwdC', 'fwdR'].map((r) => item(res, r));
  check('DP 1: all three Coys forward on a wide front, D Coy a small reserve behind (MIB p 238 para 13 a)', fwd.every((i) => centre(i.pts).y < 0) && centre(item(res, 'res').pts).y > 0 && Math.abs(centre(fwd[0].pts).x - centre(fwd[2].pts).x) >= 3500);
  check('DP 2 and DP 3 planned, DP 2 half way to DP 3; the echelons behind DP 2 (MIB p 239 d)', item(res, 'dp2') && item(res, 'dp3') && Math.abs(centre(item(res, 'dp2').pts).y * 2 - centre(item(res, 'dp3').pts).y) < 5 && top(item(res, 'ech').pts) > bottom(item(res, 'dp2').pts));
  const names = res.rows.map((r) => r.name);
  check('geometry rows: Delay posns, Coys forward, Gaps covered, Reserve, Echelons, Delay time; no rear parties or programme from last light', ['Delay posns', 'Coys forward', 'Gaps covered', 'Reserve', 'Echelons', 'Delay time'].every((x) => names.includes(x)) && !names.includes('Rear parties') && !names.includes('Timings'), names.join(', '));
  check('the default hops pass: each 4.2 km or more, the En 81 mm Mor redeploys (MIB pp 237-238)', row(res.rows, 'Delay posns')?.st === 'pass' && /81 mm/.test(row(res.rows, 'Delay posns')?.reason), row(res.rows, 'Delay posns')?.reason);
  check('Coys forward passes (three forward, one reserve, none in depth); Gaps covered by two OPs; how long is the higher Comd\'s (grey, OOW3 p 29)', row(res.rows, 'Coys forward')?.st === 'pass' && row(res.rows, 'Gaps covered')?.st === 'pass' && row(res.rows, 'Delay time')?.st === 'unchecked' && /OOW3/.test(row(res.rows, 'Delay time')?.reason));
  check('the ground rows grey without the terrain: Routes hidden, Long range obsn, Obstacles in front; no Behind an obstacle', ['Routes hidden', 'Long range obsn', 'Obstacles in front'].every((x) => row(res.rows, x)?.st === 'unchecked') && !row(res.rows, 'Behind an obstacle'), names.join(', '));
  // aimed short: 5 km to DP 3 puts DP 2 2.5 km back, a hop under the mortar's reach
  const short = S.solveRecipe(dl, ctx, { geom: Wd.withdrawalGeom(dl, doc, 5000) });
  const dp = row(short.rows, 'Delay posns');
  check('aimed 5 km: the hops are short of 4.2 km and warn with why and fix', dp?.st === 'warn' && dp.detail?.fix?.length > 0, dp?.reason);
  check('...the routes back follow DP 2 to its new place', bottom(item(short, 'rtA').pts) - top(item(short, 'dp2').pts) < 5 && Math.abs(item(short, 'rtA').pts[0].x - centre(item(short, 'fwdL').pts).x) < 5);
  // on the ground: a ridge 1 km in front of DP 1 blocks the view; water 1.2 km in front of DP 2
  const f = frameFor(res);
  const dp1Front = top(fwd[0].pts) - f.pivot.y, dp2Front = top(item(res, 'dp2').pts) - f.pivot.y;
  const fd = Wd.findWithdrawal(res, f, ground({ blockY: dp1Front - 1000, waterY: [dp2Front - 1200] }), doc, {});
  const lro = row(fd.rows, 'Long range obsn'), obs = row(fd.rows, 'Obstacles in front');
  check('on the ground: DP 1 blinded by a ridge 1 km out warns Long range obsn (MIB p 237 b (1)) with a fix', lro?.st === 'warn' && /DP 1 \d+ %/.test(lro.reason) && lro.detail?.fix?.length > 0, lro?.reason);
  check('...water 1.2 km in front of DP 2 named; DP 1 and DP 3 have none: Obstacles in front warns (MIB p 237 b (3))', obs?.st === 'warn' && /DP 2: water 1\.2 km in front/.test(obs.reason) && /DP 1: none/.test(obs.reason), obs?.reason);
  check('...routes timed by day (4 km/h, IPB p 18) and the delay\'s confirm list (lateral ridge, demolitions, boundaries)', /by day/.test(row(fd.rows, 'Routes')?.reason) && fd.routes.every((r) => r.by === 'day') && fd.confirm.some((c) => /lateral ridge/.test(c)) && fd.confirm.some((c) => /demolition plan/.test(c)) && !fd.times.length, row(fd.rows, 'Routes')?.reason);
  const clear = Wd.findWithdrawal(res, f, ground({ waterY: [dp1Front - 800, dp2Front - 800, top(item(res, 'dp3').pts) - f.pivot.y - 800] }), doc, {});
  check('open view and water in front of every DP: both pass', row(clear.rows, 'Long range obsn')?.st === 'pass' && row(clear.rows, 'Obstacles in front')?.st === 'pass', `${row(clear.rows, 'Long range obsn')?.reason} | ${row(clear.rows, 'Obstacles in front')?.reason}`);
  const grey = Wd.findWithdrawal(res, f, ground({ known: false }), doc, {});
  check('no ground: Long range obsn grey, never pass', row(grey.rows, 'Long range obsn')?.st === 'unchecked');
  // through fitLayout and Check my plan
  const inp = { recipe: dl, ctx, opts: {}, ground: ground({ waterY: [dp1Front - 800] }), anchor: { x: 0, y: 0 }, bearing: 0, threat: null, terrain: 'plains', cursor: { x: 0, y: 12000 } };
  const fl = F.fitLayout(inp);
  check('fitLayout: DP 3 at the aimed 12 km, no Behind an obstacle row left over', !!fl && Math.abs(centre(item(fl.raw, 'dp3').pts).y - 12000) < 60 && !row(fl.res.rows, 'Behind an obstacle') && !!row(fl.res.rows, 'Long range obsn'), fl ? fl.res.rows.map((r) => r.name).join(', ') : 'null');
  const drawn = {};
  for (const i of fl.raw.items) if (!drawn[i.role]) drawn[i.role] = { pts: i.pts.map((p) => { const w = F.toWorld(fl.frame, p); return [w.x, w.y]; }) };
  const ck = Wd.checkWithdrawal(inp, drawn);
  check('Check my plan reads a delay as drawn: the same Delay posns verdict, nothing missing', !!ck && row(ck.rows, 'Delay posns')?.st === row(fl.res.rows, 'Delay posns')?.st && !ck.missing.length, ck ? `${ck.rows.map((r) => `${r.name} ${r.st}`).join(', ')} | missing ${ck.missing}` : 'null');
  const noDp3 = { ...drawn }; delete noDp3.dp3;
  check('...DP 3 not drawn: named as missing', Wd.checkWithdrawal(inp, noDp3)?.missing.includes('DP 3'));
}

// ── R211 the withdrawal by day ──────────────────────────────────────────────────────────────────────────────────────
{
  const dy = rec('bn-wdr-day');
  const issues = V.validateRecipe(dy, { doc, symbols: ctx.symbols }).filter((i) => i.level === 'fail');
  check('bn-wdr-day validates', !issues.length, issues.map((i) => i.msg).join('; '));
  const res = S.solveRecipe(dy, ctx);
  const names = res.rows.map((r) => r.name);
  check('by day: no rear parties, covering Pl, Coy RVs or programme; Intermediate posn and New main posn as by night', !names.includes('Rear parties') && !names.includes('Covering Pl') && !names.includes('Timings') && !names.includes('Coy RVs') && ['Intermediate posn', 'New main posn'].every((x) => names.includes(x)), names.join(', '));
  check('Leap-frog: the fresh posns wholly behind the depth Coys (MIB pp 223-224); Passage lanes laid (OOW3 p 43)', row(res.rows, 'Leap-frog')?.st === 'pass' && row(res.rows, 'Passage lanes')?.st === 'pass', `${row(res.rows, 'Leap-frog')?.reason}`);
  check('By day warns: normally avoided unless the weather or roads demand it (OOW3 p 40), with the fixes', row(res.rows, 'By day')?.st === 'warn' && row(res.rows, 'By day')?.detail?.fix?.length >= 2);
  check('Sequence: reversed, tanks last except in very close country, no assembly areas (MIB p 224; OOW3 p 41)', /tanks remain until last/.test(row(res.rows, 'Sequence')?.reason) && /no assembly areas/.test(row(res.rows, 'Sequence')?.reason));
  // fresh posns moved in front of the depth Coys: Leap-frog warns
  const fa = item(res, 'freshA');
  const bad = Dl.byDayRows(res.items.map((i) => (i.role === 'freshA' ? { ...i, pts: i.pts.map((p) => ({ x: p.x, y: p.y - 2500 })) } : i)), dy);
  check('a fresh posn left in front of the depth Coys: Leap-frog warns and names it', row(bad.rows, 'Leap-frog')?.st === 'warn' && /A Coy \(fresh posn\)/.test(row(bad.rows, 'Leap-frog')?.reason), row(bad.rows, 'Leap-frog')?.reason);
  check('no passage points drawn: Passage lanes warns', row(Dl.byDayRows(res.items.filter((i) => !/^pp/.test(i.role)), dy).rows, 'Passage lanes')?.st === 'warn' && !!fa);
  const f = frameFor(res);
  const fd = Wd.findWithdrawal(res, f, ground({ waterY: [12000] }), doc, {});
  check('on the ground: routes by day, no night programme, the intermediate posn behind the canal', fd.routes.length === 2 && fd.routes.every((r) => r.by === 'day') && !fd.times.length && row(fd.rows, 'Behind an obstacle')?.st === 'pass' && !row(fd.rows, 'Rear parties'), fd.rows.map((r) => `${r.name} ${r.st}`).join(', '));
  check('...the confirm list: boundaries, passage lanes and contact points; air for the critical stages; no "finishes before daylight"', fd.confirm.some((c) => /passage lanes/.test(c)) && fd.confirm.some((c) => /air superiority/.test(c)) && !fd.confirm.some((c) => /before daylight/.test(c)));
}

// ── R212 the Bde and Div withdrawal (OOW3 Annex P) ──────────────────────────────────────────────────────────────────
for (const [id, sub, div] of [['bde-wdr-night', 'Bn', false], ['div-wdr-night', 'Bde', true]]) {
  const r = rec(id);
  const issues = V.validateRecipe(r, { doc, symbols: ctx.symbols }).filter((i) => i.level === 'fail');
  check(`${id} validates; its own family in the index`, !issues.length && fams.some((f) => f.recipes?.includes(id)), issues.map((i) => i.msg).join('; '));
  const res = S.solveRecipe(r, ctx);
  const ip1 = item(res, 'intPosn'), ip2 = item(res, 'intPosn2'), nm = item(res, 'newMain');
  check(`${id}: Annex P order back from the old posn: covering tps, Int Posn 1, covering tps, Int Posn 2, the new posn`, centre(item(res, 'cov1').pts).y < centre(ip1.pts).y && centre(ip1.pts).y < centre(item(res, 'cov2').pts).y && centre(item(res, 'cov2').pts).y < centre(ip2.pts).y && centre(ip2.pts).y < centre(nm.pts).y);
  const names = res.rows.map((x) => x.name);
  check(`${id}: rows Intermediate posn, Second int posn, New main posn, Int posns held, Covering tps, Flank guard, Axes, Reserve, Dml belt, Rear parties`, ['Intermediate posn', 'Second int posn', 'New main posn', 'Int posns held', 'Covering tps', 'Flank guard', 'Axes', 'Reserve', 'Dml belt', 'Rear parties'].every((x) => names.includes(x)), names.join(', '));
  check(`${id}: unaimed, every hop clears the En 105 mm (17.2 km): Second int posn and New main posn pass`, row(res.rows, 'Second int posn')?.st === 'pass' && row(res.rows, 'New main posn')?.st === 'pass', `${row(res.rows, 'Second int posn')?.reason} | ${row(res.rows, 'New main posn')?.reason}`);
  check(`${id}: int posns held by ${div ? 'a Bde' : 'a Bn'}, less deep than the new posn (OOW3 p 34); three axes apart; the reserve; the belt across the new posn's front`, row(res.rows, 'Int posns held')?.st === 'pass' && new RegExp(`for a ${sub}`).test(row(res.rows, 'Int posns held')?.reason) && row(res.rows, 'Axes')?.st === 'pass' && /3 axes/.test(row(res.rows, 'Axes')?.reason) && row(res.rows, 'Reserve')?.st === 'pass' && row(res.rows, 'Dml belt')?.st === 'pass', `${row(res.rows, 'Axes')?.reason}`);
  check(`${id}: ${div ? 'the Div covering troops an Armd Regt gp (OOW3 p 32)' : 'rear parties per forward Bn (OOW3 p 45)'}`, div ? /Armd Regt/.test(row(res.rows, 'Covering tps')?.reason) : row(res.rows, 'Rear parties')?.st === 'pass' && /forward Bns/.test(row(res.rows, 'Rear parties')?.reason));
  // aimed short: 30 km to the new posn: the hops fall inside the En guns and warn with a fix
  const g30 = Wd.withdrawalGeom(r, doc, 30000);
  const short = S.solveRecipe(r, ctx, { geom: g30 });
  check(`${id}: aimed 30 km: the new posn at 30 km; Second int posn warns with why and fix`, Math.abs(centre(g30.newMain.pts).y - 30000) < 1 && row(short.rows, 'Second int posn')?.st === 'warn' && row(short.rows, 'Second int posn')?.detail?.fix?.length > 0, row(short.rows, 'Second int posn')?.reason);
  // two routes merged: Axes warns (OOW3 p 8)
  const merged = res.items.map((i) => (i.role === 'rtC' ? { ...i, pts: item(res, 'rtA').pts.map((p) => ({ x: p.x + 50, y: p.y })) } : i));
  check(`${id}: Route C laid 50 m beside Route A: Axes warns, names them`, row(Wd.withdrawalGeometryRows(merged, r, doc).rows, 'Axes')?.st === 'warn', row(Wd.withdrawalGeometryRows(merged, r, doc).rows, 'Axes')?.reason);
  // on the ground and through Check my plan
  const f = frameFor(res);
  const fd = Wd.findWithdrawal(res, f, ground({ waterY: [12000] }), doc, {});
  check(`${id}: on the ground: the Bn night rows (Routes, Timings) with the formation rows; the Annex A timings and AD at the defiles to confirm`, ['Routes', 'Timings', 'Second int posn', 'Axes', 'Behind an obstacle'].every((x) => row(fd.rows, x)) && fd.confirm.some((c) => /Annex A/.test(c)) && fd.confirm.some((c) => /defiles/.test(c)), fd.rows.map((x) => `${x.name} ${x.st}`).join(', '));
  const inp = { recipe: r, ctx, opts: {}, ground: ground(), anchor: { x: 0, y: 0 }, bearing: 0, threat: null, terrain: 'plains', cursor: { x: 0, y: 60000 } };
  const fl = F.fitLayout(inp);
  const drawn = {};
  for (const i of fl.raw.items) if (!drawn[i.role]) drawn[i.role] = { pts: i.pts.map((p) => { const w = F.toWorld(fl.frame, p); return [w.x, w.y]; }) };
  const ck = Wd.checkWithdrawal(inp, drawn);
  check(`${id}: Check my plan reads it as drawn: the same Second int posn verdict, nothing missing`, !!ck && row(ck.rows, 'Second int posn')?.st === row(fl.res.rows, 'Second int posn')?.st && !ck.missing.length, ck ? ck.missing.join(', ') : 'null');
  const no2 = { ...drawn }; delete no2.intPosn2;
  check(`${id}: Int Posn 2 not drawn: named as missing`, Wd.checkWithdrawal(inp, no2)?.missing.includes(`Int Posn 2 (${sub})`));
}

// ── R238 / R239 the mountain layouts (MW) ────────────────────────────────────────────────────────────────────────────
{
  const M = await import('../../MS/Engines/DeploymentBuilder/PlanMountain.ts');
  const solved = (id) => { const r = rec(id); return { r, res: S.solveRecipe(r, ctx) }; };
  const rowsOf = (id) => { const { r, res } = solved(id); return M.layoutRows(res.items, r, doc); };
  for (const id of ['bn-def-mtn-ridge', 'bn-def-mtn-penetrant', 'bn-def-mtn-lateral', 'bn-def-mtn-pass', 'bn-def-mtn-valley', 'bn-attk-mtn']) {
    const issues = V.validateRecipe(rec(id), { doc, symbols: ctx.symbols }).filter((i) => i.level === 'fail');
    check(`${id} validates; the Mtn Inf Bn; in its family`, !issues.length && rec(id).unit === 'inf-bn-mtn' && fams.some((f) => f.recipes?.includes(id)), issues.map((i) => i.msg).join('; '));
  }
  check('plsOf: a Coy 3, "less a Pl" 2, "less 12 Pl" (a numbered Pl) 2, "less 2 Pls" 1, a Pl 1', M.plsOf({ echelon: '15', label: 'A Coy' }) === 3 && M.plsOf({ echelon: '15', label: 'C Coy less a Pl' }) === 2 && M.plsOf({ echelon: '15', label: 'D Coy less 12 Pl (Res)' }) === 2 && M.plsOf({ echelon: '15', label: 'D Coy less 2 Pls' }) === 1 && M.plsOf({ echelon: '14', label: '7 Pl' }) === 1);
  const ridge = rowsOf('bn-def-mtn-ridge');
  check('ridge between nullahs: 4 of 12 Pls on the nullahs, 1/3 : 2/3 passes (MW p 154)', row(ridge, 'Nullahs')?.st === 'pass' && /4 of 12 Pls/.test(row(ridge, 'Nullahs')?.reason), row(ridge, 'Nullahs')?.reason);
  {
    const { r, res } = solved('bn-def-mtn-ridge');
    const thin = M.layoutRows(res.items.filter((i) => !/^nul[LR]2$/.test(i.role)), r, doc);
    check('...two nullah posts taken away (2 of 10 Pls): warns with the proportion as the fix', row(thin, 'Nullahs')?.st === 'warn' && row(thin, 'Nullahs')?.detail?.fix?.length > 0, row(thin, 'Nullahs')?.reason);
  }
  const pen = rowsOf('bn-def-mtn-penetrant');
  check('penetrant ridge: depth along it, side spurs both sides, two valley blocks (MW p 155)', ['Depth along ridge', 'Side spurs', 'Valleys blocked'].every((x) => row(pen, x)?.st === 'pass'), pen.map((x) => `${x.name} ${x.st}`).join(', '));
  {
    const { r, res } = solved('bn-def-mtn-penetrant');
    const wide = M.layoutRows(res.items.map((i) => (i.role === 'depth' ? { ...i, pts: i.pts.map((p) => ({ x: p.x + 2500, y: p.y })) } : i)), r, doc);
    check('...B Coy moved 2.5 km off the ridge: Depth along ridge warns', row(wide, 'Depth along ridge')?.st === 'warn', row(wide, 'Depth along ridge')?.reason);
  }
  const lat = rowsOf('bn-def-mtn-lateral');
  check('lateral ridge: the top held, the reserve on it, forward spurs occupied (MW p 157)', row(lat, 'Ridge top')?.st === 'pass' && row(lat, 'Forward spurs')?.st === 'pass', lat.map((x) => `${x.name} ${x.st}`).join(', '));
  const pas = rowsOf('bn-def-mtn-pass');
  check('pass: both shoulders held, the pass itself blocked (MW p 158)', row(pas, 'Both shoulders')?.st === 'pass' && row(pas, 'Pass blocked')?.st === 'pass');
  {
    const { r, res } = solved('bn-def-mtn-pass');
    check('...B Coy off the right shoulder: Both shoulders warns', row(M.layoutRows(res.items.filter((i) => i.role !== 'shR'), r, doc), 'Both shoulders')?.st === 'warn');
  }
  const val = rowsOf('bn-def-mtn-valley');
  check('valley: heights both sides, two lines, the valley bed (MW pp 161-162); strong points grey to confirm (p 152)', ['Heights both sides', 'Successive posns', 'Valley bed'].every((x) => row(val, x)?.st === 'pass') && row(val, 'Strong points')?.st === 'unchecked');
  const atk = rowsOf('bn-attk-mtn');
  check('mountain attack: three directions onto the Obj (assault, fire base, infiltration), the block beyond the Obj, a reserve on the axis (MW pp 82-84, 94)', ['Multidirectional', 'Infiltration', 'Fire base', 'Reserve per axis'].every((x) => row(atk, x)?.st === 'pass') && row(atk, 'Objective')?.st === 'unchecked', atk.map((x) => `${x.name} ${x.st}`).join(', '));
  {
    const { r, res } = solved('bn-attk-mtn');
    const one = M.layoutRows(res.items.filter((i) => i.role !== 'infil' && i.role !== 'bof'), r, doc);
    check('...without the fire base and the infiltration: one direction, Multidirectional fails', row(one, 'Multidirectional')?.st === 'fail', row(one, 'Multidirectional')?.reason);
  }
  check('a plains recipe gets no mountain rows', M.layoutRows(S.solveRecipe(rec('bn-def-two-up'), ctx).items, rec('bn-def-two-up'), doc).length === 0);
  // through the fit: the rows land on the fitted plan
  const r = rec('bn-def-mtn-pass');
  const fl = F.fitLayout({ recipe: r, ctx, opts: {}, ground: ground(), anchor: { x: 0, y: 0 }, bearing: 0, threat: null, terrain: 'mountain', cursor: null });
  check('fitLayout on a mountain recipe carries its layout rows', !!fl && !!row(fl.res.rows, 'Both shoulders'), fl ? fl.res.rows.map((x) => x.name).join(', ') : 'null');
}

// ── R185 the BUA attack and defence (IBB S49, S58); R227 the MIB fixing force (MIB s23, Annex P) ─────────────────────
{
  const M = await import('../../MS/Engines/DeploymentBuilder/PlanMountain.ts');
  for (const id of ['bn-attk-bua', 'bn-def-bua', 'mib-def-fixing']) {
    const issues = V.validateRecipe(rec(id), { doc, symbols: ctx.symbols }).filter((i) => i.level === 'fail');
    check(`${id} validates; in its family`, !issues.length && fams.some((f) => f.recipes?.includes(id)), issues.map((i) => i.msg).join('; '));
  }
  const solved = (id) => { const r = rec(id); const res = S.solveRecipe(r, ctx); return { r, res, rows: M.layoutRows(res.items, r, doc) }; };
  const atk = solved('bn-attk-bua');
  check('BUA attack: from a flank, Pl frontage within 100 m, the foothold then bounds, heavy weapons, reserves; dusk grey (IBB S49)', ['From a flank', 'Pl frontage', 'Phases', 'Heavy weapons', 'Reserves'].every((x) => row(atk.rows, x)?.st === 'pass') && row(atk.rows, 'Soon after dusk')?.st === 'unchecked', atk.rows.map((x) => `${x.name} ${x.st}: ${x.reason.slice(0, 60)}`).join(' | '));
  {
    const wide = M.layoutRows(atk.res.items.map((i) => (i.role === 'obj' ? { ...i, pts: i.pts.map((p) => ({ x: p.x * 3, y: p.y })) } : i)), atk.r, doc);
    check('...the foothold three times as wide: over 100 m a Pl, warns (IBB p 268)', row(wide, 'Pl frontage')?.st === 'warn', row(wide, 'Pl frontage')?.reason);
    const noPl = M.layoutRows(atk.res.items.filter((i) => !/^pl\d$/.test(i.role)), atk.r, doc);
    check('...no bounds beyond the foothold: Phases warns (IBB p 265)', row(noPl, 'Phases')?.st === 'warn');
  }
  const def = solved('bn-def-bua');
  check('BUA defence: localities, a screen in front, strong points in depth, barricades, a mobile reserve (IBB S58)', ['Localities', 'Screen', 'Strong points', 'Barricades', 'Reserve'].every((x) => row(def.rows, x)?.st === 'pass'), def.rows.map((x) => `${x.name} ${x.st}`).join(', '));
  check('...the screen taken away: warns', row(M.layoutRows(def.res.items.filter((i) => i.role !== 'scr'), def.r, doc), 'Screen')?.st === 'warn');
  const fx = solved('mib-def-fixing');
  check('MIB fixing force: strong points in depth, the killing zone between the groups, APCs, a mounted counter-attack force, within 6 x 10 km (MIB s23, Annex P)', ['Strong points', 'Killing zone', 'APCs in locality', 'Counter-attack', 'Gp area'].every((x) => row(fx.rows, x)?.st === 'pass') && row(fx.rows, 'Prerequisites')?.st === 'unchecked', fx.rows.map((x) => `${x.name} ${x.st}: ${x.reason.slice(0, 50)}`).join(' | '));
  {
    const off = M.layoutRows(fx.res.items.map((i) => (i.role === 'kz' ? { ...i, pts: i.pts.map((p) => ({ x: p.x - 4000, y: p.y })) } : i)), fx.r, doc);
    check('...the killing zone moved outside the groups: warns', row(off, 'Killing zone')?.st === 'warn');
    const flat = M.layoutRows(fx.res.items.filter((i) => !/^sp/.test(i.role)), fx.r, doc);
    check('...no depth strong points: Strong points warns (MIB p 158)', row(flat, 'Strong points')?.st === 'warn');
  }
}

console.log(`\n${n - fails} of ${n} checks passed`);
process.exit(fails ? 1 : 0);
