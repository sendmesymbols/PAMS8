// tanks.mjs -- checks tanks with the Bn attack (MS/Engines/DeploymentBuilder/PlanTanks.ts, through PlanSolve, PlanAttack
// and PlanFit.fitLayout): FUP (Tks) 2500-3000 m out (IBB p214), Close sp (the tanks' own axis converging on the Obj, the
// rear troop on a flank, timed to the infantry's assault line, IBB pp 186-188) and Fire sp (fire posns by the BOF, there
// as the infantry come as close, night range 800 / 1600 m, IBB pp 214-215), who leads from his fields of fire (IBB S35
// pp 145-146), the tanks' going, and Check my plan reading a built plan with tanks.
//   node tools/planbuilder-test/tanks.mjs          (add --quiet to print only failures and the summary)
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const F = await import('../../MS/Engines/DeploymentBuilder/PlanFit.ts');
const A = await import('../../MS/Engines/DeploymentBuilder/PlanAttack.ts');
const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
const R = await import('../../MS/Engines/DeploymentBuilder/PlanRecipes.ts');
const T = await import('../../MS/Engines/DeploymentBuilder/PlanTanks.ts');
const Ph = await import('../../MS/Engines/DeploymentBuilder/PlanPhase.ts');
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
const ctx = { doc, symbols };
const rules = json('MS/Data/terrain-bundle/rules.json');
const goingOf = (p) => ({ nogo: new Set(rules.profiles[p].nogo), caution: new Set(rules.profiles[p].caution ?? []) });
const rec = (id) => json(`MS/Data/Deployments/Recipes/${id}.json`);
const row = (rows, name) => rows.find((r) => r.name === name);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const centre = (pts) => ({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length });
const it = (res, role) => res.items.find((i) => i.role === role);
const front = rec('bn-attk-frontal'), right = rec('bn-attk-right-flank'), left = rec('bn-attk-left-flank');
const withPlan = (o) => ({ ...doc, plan: { ...doc.plan, attack: { ...doc.plan.attack, tanks: { ...doc.plan.attack.tanks, ...o } } } });
const inpOf = (recipe, g, more = {}) => ({ recipe, ctx, opts: {}, ground: g, anchor: { x: 0, y: 0 }, bearing: 0, threat: null, terrain: 'plains', ...more });
const flatG = { cls: () => 2, elev: () => 200, going: goingOf, label: (c) => rules.classes[String(c)]?.label ?? String(c), sight: () => 0.9, pending: () => false, dataLine: () => 'synthetic',
  avenues: (from, to) => [{ path: [from, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, to], lengthM: Math.hypot(to.x - from.x, to.y - from.y), goPct: 100, minWidthM: 2000, chokes: [] }] };

// ── the recipe ───────────────────────────────────────────────────────────────────────────────────────────────────
for (const r of [front, right, left]) for (const mode of ['close', 'fire']) {
  const t = T.withTanks(r, doc, mode);
  const fl = R.validateRecipe(t, { doc, symbols }).filter((i) => i.level === 'fail').map((i) => i.msg);
  check(`${r.layout}, ${mode} sp: the recipe validates, its own id, the one passed in unchanged`, !fl.length && t.id === `${r.id}-tk${mode[0]}` && t.tanks === mode && !r.slots.some((s) => s.role === 'tkFup'), fl.join('; '));
  const res = S.solveRecipe(t, ctx, {});
  const o1 = Ph.boxOf(it(res, 'obj').pts);
  const Fc = centre(it(res, 'tkFup').pts);
  check('...FUP (Tks) 2500-3000 m from the Obj (IBB p214) and the Tank FUP row passes', row(res.rows, 'Tank FUP')?.st === 'pass' && Ph.boxGap(o1, Fc) >= 2400 && Ph.boxGap(o1, Fc) <= 3100, row(res.rows, 'Tank FUP')?.reason);
  check('...the Sqn there; who leads waits for the ground', dist(it(res, 'tkSqn').pts[0], Fc) < 200 && row(res.rows, 'Who leads')?.st === 'unchecked' && row(res.rows, 'Tanks')?.st === 'pass');
  const { E, u } = T.entryOf(it(res, 'axis').pts, o1);
  const nrm = { x: u.y, y: -u.x };
  const side = (p) => Math.sign((p.x - E.x) * nrm.x + (p.y - E.y) * nrm.y);
  const bm = it(res, 'bof').base?.mid ?? it(res, 'bof').pts[0];
  check('...aside of the infantry\'s axis, away from the BOF (a place of its own, IBB p181)', side(Fc) === -side(bm), `FUP (Tks) side ${side(Fc)}, BOF side ${side(bm)}`);
  if (mode === 'close') {
    const ax = it(res, 'tkAxis').pts;
    check('...Close sp: the tanks\' axis from FUP (Tks) converging on where the infantry enter the Obj (IBB p186)', dist(ax[0], Fc) < 200 && dist(ax[ax.length - 1], E) <= 150 && Ph.boxGap(o1, ax[ax.length - 1]) === 0);
    const rr = it(res, 'tkRear').pts[0];
    check('...the rear troop 1.5 km out on the BOF\'s flank (IBB p188 c, p215 b)', Math.abs(dist(rr, E) - 1500) < 60 && side(rr) === side(bm) && it(res, 'tkRear').echelon === '14');
  } else {
    const fp = it(res, 'tkFire');
    check('...Fire sp: fire posns beside the BOF, planned (taken up after H)', fp.planned === true && dist(fp.pts[0], bm) < 300, `${Math.round(dist(fp.pts[0], bm))} m from the BOF`);
  }
}
{
  const t2 = T.withTanks(Ph.twoPhaseRecipe(front, doc), doc, 'close');
  check('Two phases with tanks: phase 1 gets the tanks, ids stack (-2ph-tkc)', t2.id === 'bn-attk-frontal-2ph-tkc' && t2.phases === 2 && t2.slots.some((s) => s.role === 'tkAxis') && t2.slots.some((s) => s.role === 'axis2'));
  check('...none leaves the recipe as it is', T.withTanks(front, doc, 'none') === front);
}

// ── the H-hour sum by geometry ───────────────────────────────────────────────────────────────────────────────────
{
  const res = S.solveRecipe(T.withTanks(front, doc, 'close'), ctx, {});
  const h = A.attackTimes(res, null, null, doc, 'plains', false, null);
  const rows = T.addTankTimes(h, res, null, null, doc, false, 'close', null);
  const tAl = h.objAt - Math.round((250 / 100) * h.paceMinPer100m);
  check('Close sp timing: at the infantry\'s assault line (250 m out) as they reach it, firing them on, on the Obj a minute before them (IBB p187)', h.tanks && h.tanks.atAt === tAl && h.tanks.onObjAt === h.objAt - 1 && h.tanks.leaveAt < h.tanks.atAt && h.steps.some((st) => st.label === 'Tanks at the assault line, firing the infantry on') && row(rows, 'Tank timing')?.st === 'pass', row(rows, 'Tank timing')?.reason);
  check('...its steps in the H-hour sum in time order', h.steps.some((s) => s.label.startsWith('Tanks leave FUP (Tks)')) && h.steps.every((s, i) => !i || s.at >= h.steps[i - 1].at), h.steps.map((s) => `${A.hRelText(s.at)} ${s.label}`).join(' > '));
  const hn = A.attackTimes(res, null, null, doc, 'plains', true, null);
  T.addTankTimes(hn, res, null, null, doc, true, 'close', null);
  check('...by night the tanks take longer from FUP (Tks) (8 against 16 km/h, E)', hn.tanks.atAt - hn.tanks.leaveAt > h.tanks.atAt - h.tanks.leaveAt, `${h.tanks.atAt - h.tanks.leaveAt} by day, ${hn.tanks.atAt - hn.tanks.leaveAt} by night`);
  check('...without the ground the going is not checked', row(rows, 'Tank going')?.st === 'unchecked');
  check('...and the H-hour row names the tanks\' steps', /tanks leave fup \(tks\)/.test(A.hSumRow(h, doc).reason));
}
{
  const res = S.solveRecipe(T.withTanks(front, doc, 'fire'), ctx, {});
  const h = A.attackTimes(res, null, null, doc, 'plains', true, null);
  const rows = T.addTankTimes(h, res, null, null, doc, true, 'fire', null);
  const o1 = Ph.boxOf(it(res, 'obj').pts), dF = Ph.boxGap(o1, it(res, 'tkFire').pts[0]);
  const want = Math.max(0, h.objAt - Math.round((dF / 100) * h.paceMinPer100m));
  check('Fire sp timing: at the fire posns as the infantry come as close to the Obj (IBB p214 option a), H at the latest', h.tanks.atAt === want && h.tanks.leaveAt < want && h.tanks.onObjAt === null, row(rows, 'Tank timing')?.reason);
  check('...the fire posns inside the night range with NVD (800 m)', row(rows, 'Tank fire range')?.st === (dF <= 800 ? 'pass' : 'warn'), row(rows, 'Tank fire range')?.reason);
  const rows2 = T.addTankTimes(A.attackTimes(res, null, null, doc, 'plains', true, null), res, null, null, withPlan({ nightFireM: { value: 100, basis: 'U' } }), true, 'fire', null);
  check('...beyond it by night: register the targets by day (IBB p214)', row(rows2, 'Tank fire range')?.st === 'warn' && /register the targets by day/.test(row(rows2, 'Tank fire range')?.reason ?? ''), row(rows2, 'Tank fire range')?.reason);
}

// ── on the ground ────────────────────────────────────────────────────────────────────────────────────────────────
{
  const ref = F.fitLayout(inpOf(T.withTanks(front, doc, 'close'), flatG));
  const L = (w) => F.toLocal(ref.frame, w);
  const base = S.solveRecipe(T.withTanks(front, doc, 'close'), ctx, {});
  const o1 = Ph.boxOf(it(base, 'obj').pts);
  const F0 = centre(it(base, 'tkFup').pts);
  check('Fit: tank rows read once each (Tank FUP, Who leads, Tank timing, Tank going), the timing in the H-hour sum', ['Tank FUP', 'Who leads', 'Tank timing', 'Tank going'].every((x) => ref.res.rows.filter((r) => r.name === x).length === 1) && !!ref.fit.attack.hSum.tanks, ['Tank FUP', 'Who leads', 'Tank timing', 'Tank going'].map((x) => `${x}:${ref.res.rows.filter((r) => r.name === x).length}`).join(' '));
  check('...open ground, seen all the way: who leads says the tanks may (IBB S35 p145)', /open tank country, the tanks may lead/.test(row(ref.res.rows, 'Who leads')?.reason ?? '') && ref.fit.attack.tanks.fieldM >= 1500, row(ref.res.rows, 'Who leads')?.reason);
  // the Obj sees all but a fold 400 m to the left of FUP (Tks): it moves there
  const fold = { x: F0.x - 400, y: F0.y };
  const gFold = { ...flatG, sight: (ox, oy, e, tx, ty) => (dist(L({ x: tx, y: ty }), fold) < 300 ? 0.1 : 0.9) };
  const ff = F.fitLayout(inpOf(T.withTanks(front, doc, 'close'), gFold));
  const F1 = centre(it(ff.raw, 'tkFup').pts);
  check('Tank FUP finder: into ground hidden from the Obj, still 2.5-3 km out', dist(F1, fold) < 300 && row(ff.res.rows, 'Tank FUP')?.st === 'pass' && Ph.boxGap(o1, F1) >= 2400, `${Math.round(dist(F1, fold))} m from the fold; ${row(ff.res.rows, 'Tank FUP')?.reason}`);
  check('...the Sqn goes with it', dist(it(ff.raw, 'tkSqn').pts[0], F1) < 200);
  // his fields of fire end 350 m out along the approach (a crest): the infantry leads; 150 m: a troop at most
  const { E, u } = T.entryOf(it(base, 'axis').pts, o1);
  const gField = (m) => ({ ...flatG, sight: (ox, oy, e, tx, ty) => { const p = L({ x: tx, y: ty }); const t = (E.x - p.x) * u.x + (E.y - p.y) * u.y; return t > m ? 0.1 : 0.9; } });
  const f350 = F.fitLayout(inpOf(T.withTanks(front, doc, 'close'), gField(350)));
  check('Who leads: fields of fire 350 m: the infantry leads (400-500 m or less)', row(f350.res.rows, 'Who leads')?.st === 'pass' && /the infantry leads, the tanks behind them/.test(row(f350.res.rows, 'Who leads').reason) && Math.abs(f350.fit.attack.tanks.fieldM - 375) <= 50, row(f350.res.rows, 'Who leads')?.reason);
  const f150 = F.fitLayout(inpOf(T.withTanks(front, doc, 'close'), gField(150)));
  check('...150 m: very close country, a troop at most; Close sp warns', row(f150.res.rows, 'Who leads')?.st === 'warn' && /a troop of tanks at most/.test(row(f150.res.rows, 'Who leads').reason), row(f150.res.rows, 'Who leads')?.reason);
  const f150f = F.fitLayout(inpOf(T.withTanks(front, doc, 'fire'), gField(150)));
  check('...Fire sp there is no risk (the tanks shoot from out of it)', row(f150f.res.rows, 'Who leads')?.st === 'pass');
  // a canal (NO-GO for tracks) across the tanks' axis
  const tr = [...goingOf('tracked').nogo][0];
  const ax = it(base, 'tkAxis').pts, mid = { x: (ax[0].x + ax[1].x) / 2, y: (ax[0].y + ax[1].y) / 2 };
  const gCanal = { ...flatG, cls: (x, y) => { const p = L({ x, y }); return Math.abs((p.x - mid.x) * u.x + (p.y - mid.y) * u.y) < 30 ? tr : 2; } };
  const fc = F.fitLayout(inpOf(T.withTanks(front, doc, 'close'), gCanal));
  check('Tank going: NO-GO for tracks across their axis fails: turn it, bridge it or fight infantry heavy', row(fc.res.rows, 'Tank going')?.st === 'fail' && /infantry heavy/.test(row(fc.res.rows, 'Tank going').reason), row(fc.res.rows, 'Tank going')?.reason);
  const fr = F.fitLayout(inpOf(T.withTanks(front, doc, 'fire'), flatG, { night: true }));
  const route = fr.fit.attack.tanks.route;
  check('Fire sp on the ground: the Sqn\'s way on tracks from FUP (Tks) to its fire posns, timed', route && dist(route[0], centre(it(fr.raw, 'tkFup').pts)) < 1 && dist(route[route.length - 1], it(fr.raw, 'tkFire').pts[0]) < 1 && !!fr.fit.attack.hSum.tanks, row(fr.res.rows, 'Tank timing')?.reason);
  const ranked = F.rankFits([front, right, left].map((r) => ({ fit: F.fitLayout(inpOf(T.withTanks(r, doc, 'close'), flatG)).fit, recipe: T.withTanks(r, doc, 'close') })));
  check('Auto with tanks: frontal still last', ranked[ranked.length - 1].recipe.layout === 'frontal', ranked.map((x) => `${x.recipe.layout} ${x.fit.score}`).join(', '));
}

// ── Check my plan on a built plan with tanks ─────────────────────────────────────────────────────────────────────
{
  const t = T.withTanks(right, doc, 'close');
  const out = S.toPlanDocument(S.solveRecipe(t, ctx, {}), (pid, ov, id, de) => ({ plnOrdrSymbolPK: { plnOrdrSymbolId: id }, drawEss: JSON.stringify(de) }), (pid, id, name, seq, syms) => ({ plnOrdrSymbolSet: syms }), 1);
  const recs = K.recordsFromPlanDoc(out.doc).map((r) => ({ ...r, attrs: { pbRole: out.roles[r.id], pbRecipe: t.id } }));
  const rep = K.checkPlan(recs, doc, {});
  const tg = rep.groups.find((g) => g.label === 'Tks');
  check('Check my plan: the tanks\' axis read as the tanks\' (FUP (Tks) in the tank band, IBB p214), no SL or BOF asked of it', tg && tg.rows.find((x) => x.name === 'FUP from the Obj')?.st === 'pass' && !tg.rows.some((x) => /^SL|^BOF/.test(x.name)), tg?.rows.map((x) => `${x.name} [${x.st}]`).join(', '));
  check('...not taken for a later phase', !rep.groups.some((g) => g.phase === 2) && !row(rep.rows, 'Phases'));
  const inf = rep.groups.find((g) => g.label !== 'Tks');
  check('...the infantry\'s axis judged as before', inf?.rows.find((x) => x.name === 'FUP from the Obj')?.st === 'pass' && inf.rows.some((x) => x.name === 'BOF on a flank'));
  const wg = K.checkPlan(recs, doc, { ground: flatG }).groups.find((g) => g.label === 'Tks');
  check('...with the ground the tanks\' axis is read on tracks (Tank going), not on foot', wg?.rows.some((x) => x.name === 'Tank going' && x.st === 'pass') && !wg.rows.some((x) => x.name === 'Approach going') && !wg.rows.some((x) => x.name === 'Approaches covered'), wg?.rows.map((x) => `${x.name} [${x.st}]`).join(', '));
  const drawn = K.checkPlan(K.recordsFromPlanDoc(out.doc), doc, {});
  const dg = drawn.groups.find((g) => g.label === 'Tks');
  check('...drawn by hand (no roles): the arrow labelled Tks is the tanks\' too', dg && !dg.rows.some((x) => /^SL|^BOF/.test(x.name)) && !drawn.groups.some((g) => g.phase === 2), dg?.rows.map((x) => x.name).join(', '));
}

console.log(`\n${n - fails} of ${n} checks passed${fails ? `, ${fails} FAILED` : ''}`);
process.exit(fails ? 1 : 0);
