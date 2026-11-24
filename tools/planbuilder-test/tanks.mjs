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

// ── tanks grouped to a Bn defence (armour in defence): leaguers beside the reserve, the C Pen force at the tank rate ──────
{
  const W = await import('../../MS/Engines/DeploymentBuilder/PlanWhatIf.ts');
  const O = await import('../../MS/Engines/DeploymentBuilder/PlanOrbat.ts');
  const P = 'MS/Data/Orbat/PK/';
  const orbat = { own: O.mergeOwn(O.OWN_ORBAT_FILES.map((f) => json(`${P}${f}`).units)), en: json(`${P}en.json`).units, weapons: json(`${P}weapons.json`).weapons };
  const sqn = O.tankSqnOf(orbat), sq = { tanks: sqn.tanks, tps: sqn.tps, tpTanks: sqn.tpTanks, regtTanks: sqn.regtTanks, src: sqn.src };
  const two = rec('bn-def-two-up'), three3 = rec('bn3-def-three-up');
  const d1 = T.withDefTanks(two, doc, 1, sq), d2 = T.withDefTanks(two, doc, 2, sq), d3 = T.withDefTanks(three3, doc, 1, sq);
  const bad = (r) => R.validateRecipe(r, { doc, symbols }).filter((i) => i.level === 'fail').map((i) => i.msg);
  check('1 and 2 Sqns on a Bn Def: the recipes validate, own ids (-tkd1, -tkd2), the one passed in unchanged', !bad(d1).length && !bad(d2).length && d1.id === 'bn-def-two-up-tkd1' && d2.id === 'bn-def-two-up-tkd2' && d1.defTanks === 1 && d2.defTanks === 2 && !two.slots.some((x) => x.role === 'tkSqn') && !two.defTanks, [...bad(d1), ...bad(d2)].join('; '));
  const at = (r, role) => r.slots.find((x) => x.role === role)?.shape?.at;
  check('leaguers beside the reserve (D Coy at 1350 m back): A Sqn 1100 m to the right, B Sqn 1100 m to the left', JSON.stringify(at(d1, 'tkSqn')) === '[1100,1350]' && JSON.stringify(at(d2, 'tkSqn2')) === '[-1100,1350]' && d2.slots.find((x) => x.role === 'tkSqn2').label === 'B Sqn');
  check('a layout with no reserve (3 Coys three up): the leaguer 500 m behind the rear edge of the forward Coys (-550 m: at -50)', !bad(d3).length && at(d3, 'tkSqn')[0] === 900 && at(d3, 'tkSqn')[1] === -50, JSON.stringify(at(d3, 'tkSqn')));
  const coyDef = rec('coy-def-two-up');
  check('no Sqn and an attack are left as they are; more than 3 is held to 3; a plan that already has them is not given more', T.withDefTanks(two, doc, 0) === two && T.withDefTanks(front, doc, 1) === front && T.withDefTanks(two, doc, 9).defTanks === 3 && T.withDefTanks(d1, doc, 2) === d1);
  const res1 = S.solveRecipe(d1, ctx, {}), base1 = S.solveRecipe(two, ctx, {});
  const sqI = it(res1, 'tkSqn');
  check('solved: the Sqn is a tank unit symbol with its label; the frontage and depth rows are unchanged by it', !!sqI && sqI.label === 'A Sqn' && row(res1.rows, 'Frontage')?.reason === row(base1.rows, 'Frontage')?.reason && row(res1.rows, 'Depth')?.reason === row(base1.rows, 'Depth')?.reason, sqI?.key);
  const gr = T.defTankRows(res1.items, d1, null, null, doc, null);
  check('geometry: one row, not checked, saying the Sqn of 14 tanks (ORBAT) and that their guns count as AT at 2.5 km (E)', gr.length === 1 && gr[0].name === 'Tank Sqns' && gr[0].st === 'unchecked' && /1 tank Sqn of 14 tanks/.test(gr[0].reason) && /count as AT at 2\.5 km \(E/.test(gr[0].reason), gr[0]?.reason);
  check('no tank Sqn in the layout: no row', !T.defTankRows(base1.items, two, null, null, doc, null).length);

  // on the ground: the Sqn to the C Pen posn at the tank rate against the reserve on foot
  const defG = (over = {}) => ({ cls: () => 2, elev: () => 200, going: goingOf, label: (c) => rules.classes[String(c)]?.label ?? String(c), sight: () => 0.1, pending: () => false, dataLine: () => 'synthetic', ...over,
    avenues: () => [0, 3600].map((x) => { const path = []; for (let y = 8000; y >= -500; y -= 100) path.push({ x: x - (x * Math.max(0, 2000 - y)) / 2500, y }); return { path, lengthM: 8500, goPct: 100, minWidthM: 2000, chokes: [] }; }) });
  const mech = { echelon: '18', type: 'mech', source: 'user' };
  const inpD = (r, g, more = {}) => ({ recipe: r, ctx, opts: { alternates: 'visible' }, ground: g, anchor: { x: 0, y: 0 }, bearing: 0, threat: { x: 0, y: 8000 }, enemy: mech, terrain: 'plains', ...more });
  const fitD = (r, g) => { const inp = inpD(r, g); return W.withMoves(F.fitLayout(inp), inp); };
  const f1 = fitD(d1, defG());
  const trg = (fl, id) => fl.whatIf.triggers.find((t) => t.id === id);
  const rT = trg(f1, 'tk-cpen-tkSqn'), rR = trg(f1, 'cpen-main');
  check('the what-if: the A Sqn goes to the C Pen posn on tracks (mounted), timed against the enemy', !!rT && rT.route?.mounted === true && rT.who === 'A Sqn' && rT.min !== null && rT.enemyMin !== null, JSON.stringify({ min: rT?.min, enemy: rT?.enemyMin, who: rT?.who }));
  check('...faster than the reserve Coy on foot to the same posn (tank rate 24 km/h against 5)', !!rR && rT.min < rR.min && rR.route?.mounted !== true, `${rT?.min} against ${rR?.min} min`);
  check('...in the trigger table and the Moves in time row (two more moves than without the Sqn: the C Pen posn and the secondary approach\'s Sup posn)', f1.whatIf.triggers.length === fitD(two, defG()).whatIf.triggers.length + 2 && /moves in time/.test(row(f1.res.rows, 'Moves in time')?.reason ?? ''), `${f1.whatIf.triggers.length}`);
  const hr = row(f1.res.rows, 'Tank leaguer');
  check('the Tank leaguer row on the ground: tracks go, hidden from his start, guns count as AT at 2.5 km (E)', hr?.st === 'pass' && /A Sqn: tracks go, hidden from where the En starts/.test(hr.reason) && /count as AT at 2\.5 km/.test(hr.reason), hr?.reason);
  const f2 = fitD(d2, defG());
  check('two Sqns: both go to the C Pen posn, one row names both leaguers', !!trg(f2, 'tk-cpen-tkSqn') && !!trg(f2, 'tk-cpen-tkSqn2') && /A Sqn: .*B Sqn:/.test(row(f2.res.rows, 'Tank leaguer')?.reason ?? ''), row(f2.res.rows, 'Tank leaguer')?.reason);
  // NO-GO for tracks at the leaguer, and a leaguer in his view
  const at1 = F.fitLayout(inpD(d1, defG()));
  const wp = F.toWorld(at1.frame, it(at1.raw, 'tkSqn').pts[0]);
  const trNogo = [...goingOf('tracked').nogo][0];
  const gBad = defG({ cls: (x, y) => (Math.hypot(x - wp.x, y - wp.y) < 120 ? trNogo : 2) });
  const hb = row(fitD(d1, gBad).res.rows, 'Tank leaguer');
  check('a leaguer on NO-GO for tracks fails: move it by hand', hb?.st === 'fail' && /NO-GO for tracks/.test(hb.reason), hb?.reason);
  const hs = row(fitD(d1, defG({ sight: () => 0.9 })).res.rows, 'Tank leaguer');
  check('a leaguer in his view warns: hull down or move it', hs?.st === 'warn' && /likely in the En's view/.test(hs.reason), hs?.reason);
  // a layout with no reserve: the Sqn alone is the C Pen force
  const f3 = fitD(d3, defG());
  check('a 3-Coy three up (no reserve): the Sqn alone is the C Pen force, and there is a C Pen posn for it', !!trg(f3, 'tk-cpen-tkSqn') && !trg(f3, 'cpen-main') && !!f3.whatIf.cpen);
  // the force ratio counts the Sqns
  const std = O.brief(orbat, 'inf-bn-std'), en = O.brief(orbat, 'en-rapid-inf-bde');
  const ff = (k) => O.forceFromOrbat(std, en, sqn, k);
  check('the force counts each Sqn as one more manoeuvre unit: a Bn of 4 Coys with 2 Sqns is 6, named', ff(0).ownS === 4 && ff(1).ownS === 5 && ff(2).ownS === 6 && /\+ 2 Tk Sqns of 14 tanks/.test(ff(2).ownName) && /\+ 1 Tk Sqn of 14 tanks/.test(ff(1).ownName), ff(2).ownName);
}

// ── armour in defence, the limits overcome: Sup posns, the tank guns as AT (E), tank Tps in a Coy defence ─────────────────
{
  const W = await import('../../MS/Engines/DeploymentBuilder/PlanWhatIf.ts');
  const O = await import('../../MS/Engines/DeploymentBuilder/PlanOrbat.ts');
  const P = 'MS/Data/Orbat/PK/';
  const orbat = { own: O.mergeOwn(O.OWN_ORBAT_FILES.map((f) => json(`${P}${f}`).units)), en: json(`${P}en.json`).units, weapons: json(`${P}weapons.json`).weapons };
  const sqn = O.tankSqnOf(orbat), sq = { tanks: sqn.tanks, tps: sqn.tps, tpTanks: sqn.tpTanks, regtTanks: sqn.regtTanks, src: sqn.src };
  const two = rec('bn-def-two-up'), coyDef = rec('coy-def-two-up');
  const defG = (over = {}) => ({ cls: () => 2, elev: () => 200, going: goingOf, label: (c) => rules.classes[String(c)]?.label ?? String(c), sight: () => 0.1, pending: () => false, dataLine: () => 'synthetic', ...over,
    avenues: () => [0, 3600].map((x) => { const path = []; for (let y = 8000; y >= -500; y -= 100) path.push({ x: x - (x * Math.max(0, 2000 - y)) / 2500, y }); return { path, lengthM: 8500, goPct: 100, minWidthM: 2000, chokes: [] }; }) });
  const mech = { echelon: '18', type: 'mech', source: 'user' };
  const fitD = (r, g, more = {}) => { const inp = { recipe: r, ctx, opts: { alternates: 'visible' }, ground: g, anchor: { x: 0, y: 0 }, bearing: 0, threat: { x: 0, y: 8000 }, enemy: mech, terrain: 'plains', ...more }; return W.withMoves(F.fitLayout(inp), inp); };
  const trg = (fl, id) => fl.whatIf.triggers.find((t) => t.id === id);

  // the secondary approach's Sup posn
  const d1 = T.withDefTanks(two, doc, 1, sq), d2 = T.withDefTanks(two, doc, 2, sq);
  const f1 = fitD(d1, defG()), f2 = fitD(d2, defG());
  const supT = f1.whatIf.triggers.filter((t) => t.id.startsWith('tk-sup-'));
  check('the A Sqn can switch to the Sup posn of the secondary approach: timed on tracks against his time there', supT.length === 1 && supT[0].who === 'A Sqn' && supT[0].route?.mounted === true && supT[0].min !== null && supT[0].enemyMin !== null && /^Enemy on A2/.test(supT[0].trigger), JSON.stringify(supT.map((t) => [t.id, t.min, t.enemyMin])));
  check('...faster than the reserve Coy on foot to the same Sup posn', supT[0].min < f1.whatIf.triggers.find((t) => t.id.startsWith('sup-')).min);
  check('with two Sqns only the first (A) is timed to the Sup posn; both go to the C Pen posn', f2.whatIf.triggers.filter((t) => t.id.startsWith('tk-sup-')).length === 1 && !!trg(f2, 'tk-cpen-tkSqn') && !!trg(f2, 'tk-cpen-tkSqn2'));
  check('the trigger table words it as a Sup move ("A Sqn to Sup 1, enemy on A2"), not as a penetration', /A Sqn -> Sup 1/.test(W.triggerLines(f1.whatIf).join('\n')) && /Enemy on A2 \(secondary\): A Sqn/.test(W.triggerLines(f1.whatIf).join('\n')));

  // the tank guns as AT, from the C Pen posn on the main approach and the Sup posn on the secondary one
  const tcr = row(f1.res.rows, 'Tank AT cover');
  check('Tank AT cover: each approach under the Sqn\'s guns beyond the FDL, from the C Pen posn (main) and Sup 1 (A2); 2.5 km (E)', tcr?.st === 'pass' && /A1 \(main\): under their guns \d+ m beyond the FDL from the C Pen posn/.test(tcr.reason) && /A2: under their guns \d+ m beyond the FDL from Sup 1/.test(tcr.reason) && /2\.5 km effective, E/.test(tcr.reason), tcr?.reason);
  check('no tank unit: no Tank AT cover row', !row(fitD(two, defG()).res.rows, 'Tank AT cover'));
  // a short gun leaves the approach uncovered: the doctrine figure is the one used
  const shortDoc = { ...doc, plan: { ...doc.plan, atFramework: { ...doc.plan.atFramework, tankGunEffM: { value: 300, basis: 'E' } } } };
  const inpS = { recipe: d1, ctx: { doc: shortDoc, symbols }, opts: { alternates: 'visible' }, ground: defG(), anchor: { x: 0, y: 0 }, bearing: 0, threat: { x: 0, y: 8000 }, enemy: mech, terrain: 'plains' };
  const rs = row(W.withMoves(F.fitLayout(inpS), inpS).res.rows, 'Tank AT cover');
  check('a 300 m gun (PlanDoctrine atFramework.tankGunEffM) leaves the approaches short of the 500 m wanted: warn', rs?.st === 'warn' && /0\.3 km effective|300 m effective/.test(rs.reason), rs?.reason);

  // tank Tps in a Coy defence
  const c1 = T.withDefTanks(coyDef, doc, 1, sq), c2 = T.withDefTanks(coyDef, doc, 2, sq);
  const bad = (r) => R.validateRecipe(r, { doc, symbols }).filter((i) => i.level === 'fail').map((i) => i.msg);
  check('a Coy defence takes tank Tps: 1 and 2 Tps validate, ids -tkd1 / -tkd2, labels A Tp / B Tp, unit Tp, echelon 14', !bad(c1).length && !bad(c2).length && c1.id === 'coy-def-two-up-tkd1' && c1.defTanksUnit === 'Tp' && c2.slots.find((x) => x.role === 'tkSqn2').label === 'B Tp' && c1.slots.find((x) => x.role === 'tkSqn').echelon === '14', [...bad(c1), ...bad(c2)].join('; '));
  const at = (r, role) => r.slots.find((x) => x.role === role)?.shape?.at;
  check('...the leaguers beside the reserve Pl (600 m wide at 230 m back): 650 m off its centre, alternate sides', JSON.stringify(at(c1, 'tkSqn')) === '[650,230]' && JSON.stringify(at(c2, 'tkSqn2')) === '[-650,230]', JSON.stringify([at(c1, 'tkSqn'), at(c2, 'tkSqn2')]));
  const fc = fitD(c1, defG(), { unit: O.brief(orbat, 'inf-coy-std-rifle') });
  const tc = trg(fc, 'tk-cpen-tkSqn');
  check('on the ground a tank Tp goes to the C Pen posn on tracks; the Tank leaguer row says "1 tank Tp of 3 tanks"', !!tc && tc.who === 'A Tp' && tc.route?.mounted === true && /1 tank Tp of 3 tanks/.test(row(fc.res.rows, 'Tank leaguer')?.reason ?? ''), JSON.stringify({ who: tc?.who, min: tc?.min }));
  const ff = (k) => O.forceFromOrbat(O.brief(orbat, 'inf-coy-std-rifle'), O.brief(orbat, 'en-inf-bn'), sqn, k, true);
  check('the force counts a Tp as a third of a Coy: a Coy with 3 Tps is 2, named "+ 3 Tk Tps of 3 tanks"', ff(0).ownS === 1 && Math.abs(ff(1).ownS - 4 / 3) < 1e-9 && ff(3).ownS === 2 && /\+ 3 Tk Tps of 3 tanks/.test(ff(3).ownName) && /\+ 1 Tk Tp of 3 tanks/.test(ff(1).ownName), ff(3).ownName);
  check('a Bn Def\'s Sqn is still one more unit; a Coy Def\'s Sqn count is not used for it (Sqns only on a Bn)', O.forceFromOrbat(O.brief(orbat, 'inf-bn-std'), null, sqn, 2).ownS === 6);
}

// ── the tank Sqn as the reserve in phase 2; a screen held by a Recce Sqn ─────────────────────────────────────────────
{
  const O = await import('../../MS/Engines/DeploymentBuilder/PlanOrbat.ts');
  const SO = await import('../../MS/Engines/DeploymentBuilder/PlanSmallOps.ts');
  const P = 'MS/Data/Orbat/PK/';
  const orbat = { own: O.mergeOwn(O.OWN_ORBAT_FILES.map((f) => json(`${P}${f}`).units)), en: [], weapons: json(`${P}weapons.json`).weapons };
  const sqn = O.tankSqnOf(orbat), sq = { tanks: sqn.tanks, tps: sqn.tps, tpTanks: sqn.tpTanks, regtTanks: sqn.regtTanks, src: sqn.src };
  const two = Ph.twoPhaseRecipe(front, doc, undefined, 2);
  const r0 = row(S.solveRecipe(two, ctx, {}).rows, 'Reserve'), r1 = row(S.solveRecipe(T.withTanks(two, doc, 'close', sq), ctx, {}).rows, 'Reserve');
  check('two phases by C, D Coys, no tanks: no Bn reserve (warn), and it says tanks would be one', r0?.st === 'warn' && /take tanks/.test(r0.reason), r0?.reason);
  check('...with tanks: the Sqn (14 tanks), its part in phase 1 done, is the reserve behind Obj 1 (pass, E; tell Bde all the same)', r1?.st === 'pass' && /the tank Sqn \(14 tanks\)/.test(r1.reason) && /IC s105 para 21 b; E/.test(r1.reason) && /tell Bde/.test(r1.reason), r1?.reason);
  // the Recce Sqn
  const rs = O.recceSqnOf(orbat);
  check('the Recce Sqn (p 109-112): 11 tanks (SHQ 2 + 3 AFV Tps of 3), 2 Rifle Tps in 8 APCs', rs?.tanks === 11 && rs.afvTps === 3 && rs.rifleTps === 2 && rs.apcs === 8, JSON.stringify(rs));
  const scr = rec('coy-screen'), v = SO.withRecceScreen(scr, doc, rs);
  const bad = R.validateRecipe(v, { doc, symbols }).filter((i) => i.level === 'fail').map((i) => i.msg);
  check('a screen by the Recce Sqn: validates, id -rcs, its posts the AFV Tps (1-3 Tp, tank symbols), the eye 2.5 m from the cupola (E); the one passed in unchanged', !bad.length && v.id === 'coy-screen-rcs' && v.slots.filter((s) => /^op\d$/.test(s.role)).map((s) => `${s.label}/${s.sym}`).join() === '1 Tp/10120500,2 Tp/10120500,3 Tp/10120500' && v.screenBy.eyeM === 2.5 && !scr.screenBy && scr.slots.find((s) => s.role === 'op1').label === '1 Pl', bad.join('; '));
  check('...its line names the Sqn, the posts and the Rifle Tps; not a screen: left as it is', /11 tanks \(3 AFV Tps the posts, eye 2\.5 m/.test(v.screenBy.text) && /2 Rifle Tps in 8 APCs/.test(v.screenBy.text) && SO.withRecceScreen(front, doc, rs) === front, v.screenBy.text);
}


// ── the Sqn Assy area and its move up; FUP (Tks) against the En ATGMs ──────────────────────────────────────────────────
{
  const t = T.withTanks(front, doc, 'close');
  check('Sqn Assy area: a slot behind FUP (Tks) in the tank recipe', t.slots.some((s) => s.role === 'tkHarbour'));
  const fl = F.fitLayout(inpOf(t, flatG));
  const h = fl.fit.attack.hSum;
  const hb = h.steps.find((s) => /leaves its Assy area/.test(s.label)), lv = h.steps.find((s) => /Tanks leave FUP/.test(s.label));
  check('...the move from the Assy area to FUP (Tks) in the H-hour sum, before the FUP is left, about 2 km at the tank rate', hb && lv && hb.at < lv.at && hb.distM >= 1800 && hb.distM <= 2400 && hb.min > 0, hb ? `${hb.at} -> ${lv?.at}, ${hb.distM} m ${hb.min} min` : 'no harbour step');
  const flf = F.fitLayout(inpOf(T.withTanks(front, doc, 'fire'), flatG));
  check('...fire sp too: the Assy area step before the Sqn moves to its fire posns', flf.fit.attack.hSum.steps.some((s) => /leaves its Assy area/.test(s.label)));
  check('...no En ATGM range given: no FUP (Tks) vs En ATGM row (the IBB p 214 band stands in the Tank FUP row)', !row(fl.res.rows, 'FUP (Tks) vs En ATGM') && row(fl.res.rows, 'Tank FUP'));
  const kon = F.fitLayout(inpOf(t, flatG, { enAtgmM: 4000, enAtgmSrc: 'the En Mech Inf Bn\'s Konkurs ATGM, 4.0 km (ORBAT)' }));
  const rK = row(kon.res.rows, 'FUP (Tks) vs En ATGM');
  check('...the En Konkurs reaches 4 km: FUP (Tks) 2.5-3 km out is inside it, fail with the fix (move it back to 4.3 km)', rK?.st === 'fail' && /Konkurs/.test(rK.reason) && rK.detail?.fix?.some((x) => /4\.3 km/.test(x)), rK?.reason);
  const mil = F.fitLayout(inpOf(t, flatG, { enAtgmM: 2000, enAtgmSrc: 'the En Inf Bn\'s Milan ATGM, 2.0 km (ORBAT)' }));
  check('...the En Milan reaches 2 km: FUP (Tks) beyond it, pass', row(mil.res.rows, 'FUP (Tks) vs En ATGM')?.st === 'pass', row(mil.res.rows, 'FUP (Tks) vs En ATGM')?.reason);
}

console.log(`\n${n - fails} of ${n} checks passed${fails ? `, ${fails} FAILED` : ''}`);
process.exit(fails ? 1 : 0);
