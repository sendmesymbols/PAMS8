// attack.mjs -- checks the attack in depth (MS/Engines/DeploymentBuilder/PlanAttack.ts through PlanFit.fitLayout):
// the finders (FUP into dead ground, SL on a linear feature with a clear run, BOF off the axis where it sees the
// objective, Assy Area hidden with a road), the H-hour sum (day / night, fire lifts, SLOW-GO slows the assault),
// his MSR choke and the left / right / frontal factors (flanks first; the one whose LOE chokes his MSR wins), and the
// night march chart from the Assy Area to the FUP.
//   node tools/planbuilder-test/attack.mjs          (add --quiet to print only failures and the summary)
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const F = await import('../../MS/Engines/DeploymentBuilder/PlanFit.ts');
const A = await import('../../MS/Engines/DeploymentBuilder/PlanAttack.ts');
const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
const N = await import('../../MS/Engines/NightMarch/NightMarchRead.ts');

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
const rules = json('MS/Data/terrain-bundle/rules.json');
const goingOf = (p) => ({ nogo: new Set(rules.profiles[p].nogo), caution: new Set(rules.profiles[p].caution ?? []) });
const nm = N.nmRulesFrom(json('MS/Data/NightMarchDoctrine.json'));
const rec = (id) => json(`MS/Data/Deployments/Recipes/${id}.json`);
const row = (rows, name) => rows.find((r) => r.name === name);
const front = rec('bn-attk-frontal'), right = rec('bn-attk-right-flank'), left = rec('bn-attk-left-flank');
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const centre = (pts) => ({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length });

// the frame every attack layout shares (the objective on the anchor; plan +y toward the enemy)
const inpOf = (recipe, g, more = {}) => ({ recipe, ctx, opts: {}, ground: g, anchor: { x: 0, y: 0 }, bearing: 0, threat: null, terrain: 'plains', ...more });
const flatG = { cls: () => 2, elev: () => 200, going: goingOf, label: (c) => rules.classes[String(c)]?.label ?? String(c), sight: () => 0.9, pending: () => false, dataLine: () => 'synthetic',
  avenues: (from, to) => [{ path: [from, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, to], lengthM: Math.hypot(to.x - from.x, to.y - from.y), goPct: 100, minWidthM: 2000, chokes: [] }] };
const ref = F.fitLayout(inpOf(front, flatG));
const W = (p) => F.toWorld(ref.frame, p), L = (w) => F.toLocal(ref.frame, w);
const base = S.solveRecipe(front, ctx, {});
const it = (res, role) => res.items.find((i) => i.role === role);
const O = centre(it(base, 'obj').pts), F0 = centre(it(base, 'fup').pts);

// ── the FUP finder ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  // the objective sees everything except a fold 10 degrees clockwise round it from the recipe's FUP
  const a = Math.atan2(F0.x - O.x, F0.y - O.y) + (10 * Math.PI) / 180, R0 = dist(F0, O);
  const fold = { x: O.x + R0 * Math.sin(a), y: O.y + R0 * Math.cos(a) };
  const g = { ...flatG, sight: (ox, oy, e, tx, ty) => (dist(L({ x: tx, y: ty }), fold) < 380 ? 0.1 : 0.9) };
  const fl = F.fitLayout(inpOf(front, g));
  const fc = centre(it(fl.raw, 'fup').pts);
  check('FUP finder: the FUP swung round the Obj into the dead ground (the least move that hides it)', dist(fc, fold) < 380 && dist(fc, F0) > 50 && row(fl.res.rows, 'FUP finder')?.st === 'pass', `${Math.round(dist(fc, fold))} m from the fold; ${row(fl.res.rows, 'FUP finder')?.reason}`);
  check('...the assault Coys, reserve and HQ go with it', ['asltL', 'res', 'hq'].every((r) => Math.abs(dist(it(fl.raw, r).pts[0], it(base, r).pts[0]) - dist(fc, F0)) < 60));
  check('...still 1000-1200 m from the Obj\'s near edge', row(fl.res.rows, 'FUP from the Obj')?.st === 'pass', row(fl.res.rows, 'FUP from the Obj')?.reason);
  const seen = F.fitLayout(inpOf(front, flatG));
  check('FUP finder: nothing hidden within 20 deg: say so (form up by night or under smoke)', row(seen.res.rows, 'FUP finder')?.st === 'warn', row(seen.res.rows, 'FUP finder')?.reason);
}

// ── the SL finder ──────────────────────────────────────────────────────────────────────────────────────────────────
{
  // a metalled road across the axis 450 m ahead of the FUP; a second 250 m ahead with a canal beyond it
  const roadY = F0.y + 450, nearY = F0.y + 250;
  const g1 = { ...flatG, cls: (x, y) => { const l = L({ x, y }); return Math.abs(l.y - roadY) < 25 ? 34 : 2; } };
  const fl = F.fitLayout(inpOf(front, g1));
  const sc = centre(it(fl.raw, 'sl').pts);
  check('SL finder: the SL on the road square to the axis', Math.abs(sc.y - roadY) < 30 && row(fl.res.rows, 'SL finder')?.st === 'pass', `${Math.round(sc.y - roadY)} m off; ${row(fl.res.rows, 'SL finder')?.reason}`);
  check('...the axis starts at the SL', dist(it(fl.raw, 'axis').pts[0], sc) < 1);
  const g2 = { ...flatG, cls: (x, y) => { const l = L({ x, y }); return Math.abs(l.y - nearY) < 25 ? 34 : Math.abs(l.y - (nearY + 120)) < 30 ? 20 : Math.abs(l.y - roadY) < 25 ? 34 : 2; } };
  const fl2 = F.fitLayout(inpOf(front, g2));
  const sc2 = centre(it(fl2.raw, 'sl').pts);
  check('...never behind an obstacle: a road with a canal beyond it is passed over', Math.abs(sc2.y - nearY) > 60, `SL at ${Math.round(sc2.y - F0.y)} m ahead of the FUP`);
}

{
  // a road across the axis only 500 m short of the Obj: inside the last fire lift (450 m) with no room, so not the SL
  const nearEdge = it(base, 'obj').pts.reduce((m, p) => Math.min(m, p.y), Infinity);
  const g = { ...flatG, cls: (x, y) => (Math.abs(L({ x, y }).y - (nearEdge - 500)) < 25 ? 34 : 2) };
  const fl = F.fitLayout(inpOf(front, g));
  const sc = centre(it(fl.raw, 'sl').pts);
  check('SL finder: not on a feature inside the last fire lift (the SL at least 600 m out: IC s66 p305 + 150 m)', nearEdge - sc.y >= 600 && row(fl.res.rows, 'SL finder')?.st === 'warn', `SL ${Math.round(nearEdge - sc.y)} m from the Obj`);
}

// ── the BOF siter ──────────────────────────────────────────────────────────────────────────────────────────────────
{
  // a knoll 30 m high 1.1 km from the Obj's centre (320 m off its edge), 55 degrees off the axis on the left, the only
  // place that sees the Obj
  const back = Math.atan2(F0.x - O.x, F0.y - O.y) - (55 * Math.PI) / 180;
  const hill = { x: O.x + 1100 * Math.sin(back), y: O.y + 1100 * Math.cos(back) };
  const g = { ...flatG, elev: (x, y) => 200 + 30 * Math.exp(-(dist(L({ x, y }), hill) ** 2) / (2 * 200 ** 2)), sight: (ox, oy) => (dist(L({ x: ox, y: oy }), hill) < 150 ? 0.9 : 0.2) };
  const fl = F.fitLayout(inpOf(front, g));
  const bof = it(fl.raw, 'bof');
  const bp = bof.base.mid;
  check('BOF siter: the BOF on the knoll that sees the Obj, off the axis', dist(bp, hill) < 150 && row(fl.res.rows, 'BOF siter')?.st === 'pass', `${Math.round(dist(bp, hill))} m from the knoll; ${row(fl.res.rows, 'BOF siter')?.reason}`);
  const to = { x: O.x - bp.x, y: O.y - bp.y }, bl = { x: bof.base.end.x - bof.base.start.x, y: bof.base.end.y - bof.base.start.y };
  check('...facing the Obj (its base square to the line to it, its point toward it)', Math.abs(to.x * bl.x + to.y * bl.y) / (Math.hypot(to.x, to.y) * Math.hypot(bl.x, bl.y)) < 0.05 && dist(bof.pts[0], O) < dist(bp, O));
  check('...its Coy with it', dist(it(fl.raw, 'bofCoy').pts[0], bp) < 1);
  // a flank attack on a 1500 m wide Coy locality: the BOF never inside it or touching it (seen in the app, 15 Nov 2026)
  const fr = F.fitLayout(inpOf(right, { ...flatG, sight: () => 0.9 }));
  const ob = it(fr.raw, 'obj').pts, mid = it(fr.raw, 'bof').base.mid;
  const x0 = Math.min(...ob.map((p) => p.x)), x1 = Math.max(...ob.map((p) => p.x)), y0 = Math.min(...ob.map((p) => p.y)), y1 = Math.max(...ob.map((p) => p.y));
  const out = Math.hypot(Math.max(0, x0 - mid.x, mid.x - x1), Math.max(0, y0 - mid.y, mid.y - y1));
  check('BOF siter: at least 300 m outside the Obj\'s edge, even on a wide Obj', out >= 299, `${Math.round(out)} m outside`);
  check('...and the BOF on a flank and in range still', row(fl.res.rows, 'BOF on a flank')?.st === 'pass' && row(fl.res.rows, 'BOF range')?.st === 'pass', `${row(fl.res.rows, 'BOF on a flank')?.reason}; ${row(fl.res.rows, 'BOF range')?.reason}`);
}

// ── the Assy Area finder and the route ─────────────────────────────────────────────────────────────────────────────
{
  // the Obj sees the ground behind the FUP except a wood 3.5 km back and 15 degrees off, which has a road beside it
  const back = Math.atan2(F0.x - O.x, F0.y - O.y) + (15 * Math.PI) / 180;
  const wood = { x: O.x + 3500 * Math.sin(back), y: O.y + 3500 * Math.cos(back) };
  const g = { ...flatG, cls: (x, y) => { const l = L({ x, y }); return Math.abs(l.x - (wood.x + 250)) < 25 && dist(l, wood) < 800 ? 36 : 2; }, sight: (ox, oy, e, tx, ty) => (dist(L({ x: tx, y: ty }), wood) < 450 ? 0.1 : 0.9) };
  const fl = F.fitLayout(inpOf(front, g));
  const ac = centre(it(fl.raw, 'assy').pts);
  check('Assy finder: in the wood hidden from the Obj, a road beside it, 1-5 miles back', dist(ac, wood) < 100 && row(fl.res.rows, 'Assy finder')?.st === 'pass', `${Math.round(dist(ac, wood))} m off; ${row(fl.res.rows, 'Assy finder')?.reason}`);
  const route = fl.fit.attack?.route;
  check('...the route on foot from it to the FUP', route?.length >= 2 && dist(route[0], ac) < 1 && dist(route[route.length - 1], centre(it(fl.raw, 'fup').pts)) < 1);
}

// ── the H-hour sum ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  const day = F.fitLayout(inpOf(front, flatG)), night = F.fitLayout(inpOf(front, flatG, { night: true, nmRules: nm }));
  const hd = day.fit.attack.hSum, hn = night.fit.attack.hSum;
  check('H-hour sum: leave the Assy Area before H; H = crossing the SL', hd.leaveBeforeH > 30 && hd.steps.find((s) => s.label.startsWith('Assault')).at === 0, A.hRelText(-hd.leaveBeforeH));
  check('...by night the approach is slower (IBB p 18: 4 against 3 km/h)', hn.leaveBeforeH > hd.leaveBeforeH, `${hn.leaveBeforeH} against ${hd.leaveBeforeH} min`);
  const lifts = hd.lifts.map((l) => l.at);
  check('...the fire lifts in order as the assault closes (450, 360, 275, 180 m: IC s66 p305)', lifts.every((t, i) => !i || t >= lifts[i - 1]) && hd.lifts[0].rM === 450 && hd.lifts[3].rM === 180, hd.lifts.map((l) => `${l.rM} m ${A.hRelText(l.at)}`).join(', '));
  check('...on the Obj after the last lift, the LOE after that', hd.objAt >= lifts[3] && hd.loeAt > hd.objAt, `Obj ${A.hRelText(hd.objAt)}, LOE ${A.hRelText(hd.loeAt)}`);
  const slowG = { ...flatG, cls: () => 15 };   // rocky ground: SLOW-GO on foot
  const hs = F.fitLayout(inpOf(front, slowG)).fit.attack.hSum;
  check('...SLOW-GO on the axis slows the assault (the ground sets the pace)', hs.objAt > hd.objAt && hs.paceMinPer100m > hd.paceMinPer100m, `${hs.paceMinPer100m} against ${hd.paceMinPer100m} min a 100 m`);
  check('...an H-hour row in the checks', /fire lifts/.test(row(day.res.rows, 'H-hour sum')?.reason ?? ''));
  const geo = A.attackTimes(S.solveRecipe(front, ctx, {}), null, null, doc, 'plains', false, null);
  check('...without the ground: straight lines at the march rate', geo && geo.leaveBeforeH > 0 && geo.lifts.length === 4);
}

// ── his MSR and left against right ─────────────────────────────────────────────────────────────────────────────────
{
  const choke = (side) => {
    // a bridge on his MSR 1.5 km behind the Obj, on the right of the frontal line
    const b = { x: O.x + 1500 * side, y: O.y + 1500 };
    return { ...flatG, cls: (x, y) => (dist(L({ x, y }), b) < 60 ? 39 : 2) };
  };
  const fit = (recipe, g) => F.fitLayout(inpOf(recipe, g));
  const gR = choke(1);
  const R = fit(right, gR), Lf = fit(left, gR), Fr = fit(front, gR);
  check('his MSR choke found behind the Obj: the bridge', R.fit.attack.choke?.kind === 'bridge', JSON.stringify(R.fit.attack.choke?.label));
  const f = (fl, k) => fl.fit.attack.factors.find((x) => x.key === k);
  // the flank whose LOE ends nearest the bridge chokes it
  const nearer = f(R, 'msrChoke').v >= f(Lf, 'msrChoke').v ? 'right' : 'left';
  check('the flank whose LOE comes nearer the bridge scores the MSR factor higher', f(R, 'msrChoke').v !== f(Lf, 'msrChoke').v, `${nearer}: right ${f(R, 'msrChoke').reason}; left ${f(Lf, 'msrChoke').reason}`);
  const ranked = F.rankFits([Fr, R, Lf]);
  check('Auto: frontal ranks last (form of attack: dangerous, small chance)', ranked[2].recipe.layout === 'frontal' && f(Fr, 'form').v === 0, ranked.map((x) => `${x.recipe.layout} ${x.fit.score}`).join(', '));
  check(`Auto: the ${nearer} flank first (it chokes his MSR)`, ranked[0].recipe.layout === `${nearer}-flank`, ranked.map((x) => `${x.recipe.layout} ${x.fit.score}`).join(', '));
  // frontal with fewer warnings than a flank still ranks below it (only if unavoidable); a flank with a fail does not
  const fewer = { ...Fr, fit: { ...Fr.fit, warns: 0, score: 99 } }, more = { ...R, fit: { ...R.fit, warns: 9, fails: 0, score: 40 } };
  check('Auto: a feasible flank before frontal whatever its warnings (frontal only if unavoidable)', F.rankFits([fewer, more])[0].recipe.layout === 'right-flank');
  const failed = { ...R, fit: { ...R.fit, fails: 1 } };
  check('...but a flank with a fail is not feasible: frontal before it', F.rankFits([failed, Fr])[0].recipe.layout === 'frontal');
  check('each factor carries its weight and reason', R.fit.attack.factors.length >= 7 && R.fit.attack.factors.every((x) => x.w > 0 && x.reason));
}

// ── by night: the Night March chart from the Assy Area to the FUP ──────────────────────────────────────────────────
{
  const fl = F.fitLayout(inpOf(right, flatG, { night: true, nmRules: nm }));
  const nb = fl.fit.attack.night;
  check('night: the march chart from the Assy Area to the FUP (legs, bearings, paces)', nb && nb.legs.length >= 1 && nb.paces > 0 && nb.legs.every((l) => Number.isFinite(l.bearingDeg)), nb ? `${nb.legs.length} legs, ${nb.paces} paces, leave ${A.hRelText(-nb.leaveBeforeH)}` : 'none');
  check('...where it comes inside his thermal sights', nb.thermalAtM !== null, `${nb.thermalAtM} m`);
  check('...a Night march row', !!row(fl.res.rows, 'Night march'), row(fl.res.rows, 'Night march')?.reason);
  // a winding route on foot is cut to legs a man can march on a bearing
  const wind = { ...flatG, avenues: (from, to) => { const path = []; for (let i = 0; i <= 40; i++) { const t = i / 40; path.push({ x: from.x + (to.x - from.x) * t + 20 * Math.sin(i), y: from.y + (to.y - from.y) * t }); } return [{ path, lengthM: 1, goPct: 100, minWidthM: 2000, chokes: [] }]; } };
  const nbw = F.fitLayout(inpOf(right, wind, { night: true, nmRules: nm })).fit.attack.night;
  check('...a winding route cut to few legs (within 75 m of the ground route, E)', nbw && nbw.legs.length <= 3, `${nbw?.legs.length} legs`);
  check('by day: no night march', !F.fitLayout(inpOf(right, flatG)).fit.attack.night);
  // the night legs' bearings are grid: the bundle reader's sheets' grid (ground.mov().gridConvergence), else UTM
  const gridG = { ...flatG, mov: () => ({ gridConvergence: () => ({ deg: 3.4, name: 'Indian grid zone I' }) }) };
  const nbg = F.fitLayout(inpOf(right, gridG, { night: true, nmRules: nm })).fit.attack.night;
  const gOff = (l, c) => Math.abs(((l.gridDeg - (l.bearingDeg - c) + 540) % 360) - 180);
  check('...night legs in the sheets grid: grid = true - convergence (3.4 E), the grid named', nbg && nbg.grid === 'Indian grid zone I' && nbg.legs.every((l) => gOff(l, 3.4) <= 1), nbg ? nbg.legs.map((l) => `${l.bearingDeg}T ${l.gridDeg}G`).join(', ') : 'none');
  check('...no sheets grid: UTM named', /^UTM zone \d+$/.test(nb.grid), nb.grid);
}

// ── his counter-attack onto the objective (reorganisation, IBB p189) ────────────────────────────────────────────────
{
  const ca = F.fitLayout(inpOf(front, flatG));
  const c = ca.fit.attack.counter;
  const rows = ca.res.rows.filter((r) => r.name === 'Approaches covered');
  check('Counter-attack: his ways in from his depth onto the Obj found, the row read (no longer "not checked")', c && c.apchs.length >= 2 && rows.length === 1 && rows[0].st === 'pass', `${c?.apchs.length} ways; ${rows[0]?.reason}`);
  check('...by armour unless he is infantry, from behind and both sides', c.mover === 'tracked' && /armour/.test(rows[0].reason) && new Set(c.apchs.map((a) => a.from)).size === c.apchs.length, c.apchs.map((a) => a.from).join(', '));
  const ob = it(ca.raw, 'obj').pts, x0 = Math.min(...ob.map((p) => p.x)), x1 = Math.max(...ob.map((p) => p.x)), y0 = Math.min(...ob.map((p) => p.y)), y1 = Math.max(...ob.map((p) => p.y));
  const gapOf = (p) => Math.hypot(Math.max(0, x0 - p.x, p.x - x1), Math.max(0, y0 - p.y, p.y - y1));
  check('...a DF target on each about 600 m out (outside the DF safety distances)', c.apchs.every((a) => a.df && Math.abs(gapOf(a.df) - 600) < 60), c.apchs.map((a) => Math.round(gapOf(a.df))).join(', '));
  check('...they come from his side (beyond the Obj), not through the own FUP', c.apchs.every((a) => a.path[0].y > y1));
  // dead ground on the way in from straight behind, 650-950 m out: an LP and DF there
  const g = { ...flatG, sight: (ox, oy, e, tx, ty) => { const l = L({ x: tx, y: ty }); return Math.abs(l.x - O.x) < 200 && l.y > y1 + 650 && l.y < y1 + 950 ? 0.1 : 0.9; } };
  const fd = F.fitLayout(inpOf(front, g));
  const rd = fd.res.rows.find((r) => r.name === 'Approaches covered');
  check('...dead ground on one way in warns and says where: an LP and DF there', rd?.st === 'warn' && /dead ground [67]\d0 m out: an LP and DF there/.test(rd.reason), rd?.reason);
  const inf = F.fitLayout(inpOf(front, flatG, { enemy: { echelon: '15', type: 'inf', source: 'user' } }));
  check('...his infantry counter-attacks on foot', inf.fit.attack.counter.mover === 'dismounted' && /on foot/.test(inf.res.rows.find((r) => r.name === 'Approaches covered')?.reason ?? ''));
  const noAv = F.fitLayout(inpOf(front, { ...flatG, avenues: undefined }));
  check('...without the ground\'s ways the solver\'s row stays, not checked', noAv.res.rows.filter((r) => r.name === 'Approaches covered').length === 1 && noAv.res.rows.find((r) => r.name === 'Approaches covered').st === 'unchecked');
  const Ph = await import('../../MS/Engines/DeploymentBuilder/PlanPhase.ts');
  const two = F.fitLayout(inpOf(Ph.twoPhaseRecipe(front, doc), flatG));
  check('...in two phases his counter-attack is read onto Obj 2', /onto OBJ 2/.test(two.res.rows.find((r) => r.name === 'Approaches covered')?.reason ?? ''), two.res.rows.find((r) => r.name === 'Approaches covered')?.reason);

  // AT on the Obj: the unit's ATGMs (and AT Coys grouped to the attack) onto the last objective
  const O2 = await import('../../MS/Engines/DeploymentBuilder/PlanOrbat.ts');
  const P2 = 'MS/Data/Orbat/PK/';
  const orbat = { own: O2.mergeOwn(O2.OWN_ORBAT_FILES.map((f) => json(`${P2}${f}`).units)), en: [], weapons: json(`${P2}weapons.json`).weapons };
  const std = O2.brief(orbat, 'inf-bn-std');
  const lat = O2.ownAtTypes(orbat).find((t) => /lat/i.test(t.id));
  const fs1 = F.fitLayout(inpOf(front, flatG, { unit: std }));
  const ar = row(fs1.res.rows, 'AT on the Obj');
  const nStd = std.atgm.reduce((s, w) => s + w.count, 0), ways = fs1.fit.attack.counter.apchs.filter((a) => a.df).length;
  check('AT on the Obj, the Std Inf Bn alone: its own launchers in pairs facing his ways in; fewer pairs than ways: warn', !!ar && /onto OBJ/i.test(ar.reason) && (Math.floor(nStd / 2) < ways ? ar.st === 'warn' && /left without a pair/.test(ar.reason) : true), `${nStd} launchers, ${ways} ways: ${ar?.st} ${ar?.reason.slice(0, 160)}`);
  const pairs = fs1.raw.items.filter((i) => /^atgmObj\d$/.test(i.role));
  const ob1 = it(fs1.raw, 'obj').pts, inObj = (p) => p.x >= Math.min(...ob1.map((q) => q.x)) - 1 && p.x <= Math.max(...ob1.map((q) => q.x)) + 1 && p.y >= Math.min(...ob1.map((q) => q.y)) - 1 && p.y <= Math.max(...ob1.map((q) => q.y)) + 1;
  check('...the pairs drawn on the Obj (two launchers a pair, inside its outline)', pairs.length === 2 * Math.min(Math.floor(nStd / 2), ways) && pairs.every((i) => inObj(i.pts[0])), `${pairs.length} launchers drawn`);
  const grouped = O2.withAtGroup(orbat, std, lat.id, 2);
  const fg = F.fitLayout(inpOf(front, flatG, { unit: grouped }));
  const ag = row(fg.res.rows, 'AT on the Obj');
  check('...with 2 LAT Coys grouped: a pair for every way in, each DF point within reach: pass', ag?.st === 'pass' && !/left without/.test(ag.reason) && fg.raw.items.filter((i) => /^atgmObj\d$/.test(i.role)).length === 2 * ways, ag?.reason.slice(0, 300));
  check('...no ATGM in the unit (none given): no AT on the Obj row', !row(F.fitLayout(inpOf(front, flatG)).res.rows, 'AT on the Obj'));
}

// ── a Coy attack: the Bn layout's FUP laid farther out than 1.2 km from a Pl locality is pulled in to the band ──────
{
  const fl = F.fitLayout(inpOf(rec('coy-attk-right-flank'), flatG));
  const fu = row(fl.res.rows, 'FUP from the Obj'), fd = row(fl.res.rows, 'FUP finder'), af = row(fl.res.rows, 'Assault frontage');
  check('Coy Attk: the FUP pulled in to 1.0-1.2 km off the Pl Obj (IBB p201), the finder names the pull', fu?.st === 'pass' && /in to 1\.0 km-1\.2 km off the Obj/.test(fd?.reason ?? ''), `${fu?.reason} | ${fd?.reason}`);
  check('...the assault frontage judged on the Company row (IBB S47 para 17 a p 248: 250 m by night), not the Bn one', /Company, night attack: IBB S47 para 17 a p 248/.test(af?.reason ?? ''), af?.reason);
  const bde = F.fitLayout(inpOf(rec('bde-attk-two-up'), flatG));
  check('Bde Attk: the assault frontage judged on the Brigade row (GSP p 86)', /Brigade, night attack in plains, two battalions up/.test(row(bde.res.rows, 'Assault frontage')?.reason ?? ''), row(bde.res.rows, 'Assault frontage')?.reason);
}

// ── the desert: a night attack takes half the day's frontage (DW s12 para 18 a p 47) ───────────────────────────
{
  const C = await import('../../MS/Engines/DeploymentBuilder/PlanContext.ts');
  const ar = S.solveRecipe(rec('bn-attk-frontal'), ctx, {}).rows;
  const base = row(ar, 'Assault frontage');
  check('the solver carries the assault width and its night limit (IBB p 248: a Bn two up 450-650 m) for the ground to judge again', base?.m > 0 && base?.limitM === 650, `${base?.m} / ${base?.limitM}`);
  const at = (kind, night, w = 1200) => row(C.applyContext([{ ...base, m: w, st: 'warn' }], doc, '16', 'attack', 0, 2, null, { kind, source: 'user' }, {}, night), 'Assault frontage');
  check('desert by day: a Bn assault 1.2 km wide passes, twice the night row\'s 650 m (DW p 47)', at('desert', false).st === 'pass' && /1\.3 km/.test(at('desert', false).reason) && /DW s12 para 18 a p 47/.test(at('desert', false).reason), at('desert', false).reason);
  check('desert by night: 1.2 km warns, the night row 650 m, with a fix (narrow it, or by day / bright moonlight)', at('desert', true).st === 'warn' && at('desert', true).detail?.fix?.length === 2, at('desert', true).reason);
  check('desert by night: 600 m passes, 700 m warns (IBB p 248: 450-650 m)', at('desert', true, 600).st === 'pass' && at('desert', true, 700).st === 'warn', `${at('desert', true, 600).st} / ${at('desert', true, 700).st}`);
  check('desert, light not known (a drawn plan): 1.2 km warns "by day or in bright moonlight only"', at('desert', null).st === 'warn' && /by day or in bright moonlight only/.test(at('desert', null).reason), at('desert', null).reason);
  check('plains by day: 1.2 km warns "no day figure printed: judge it" (OOW2 s9 para 2 c p 36), never fails', at('plains', false).st === 'warn' && /no day figure is printed/.test(at('plains', false).reason) && /OOW2 s9 para 2 c p 36/.test(at('plains', false).reason) && !at('plains', false).detail, at('plains', false).reason);
  check('plains by night: 1.2 km warns with a fix; 600 m passes (IBB p 248)', at('plains', true).st === 'warn' && at('plains', true).detail?.fix?.length === 2 && at('plains', true, 600).st === 'pass', at('plains', true).reason);
  check('plains by day: 600 m passes, the night figure, and says a day attack may be wider', at('plains', false, 600).st === 'pass' && /wider frontage is allowed/.test(at('plains', false, 600).reason), at('plains', false, 600).reason);
  check('mountains: 1.2 km warns by day too: narrower than open ground (MW p 79; GSP p 86), with a fix', at('mountain', false).st === 'warn' && /MW p 79/.test(at('mountain', false).reason) && at('mountain', false).detail?.fix?.length === 2, at('mountain', false).reason);
  check('mountains: 600 m passes by day and by night', at('mountain', false, 600).st === 'pass' && at('mountain', true, 600).st === 'pass', at('mountain', true, 600).reason);
  check('no ground fails an assault frontage (the books print limits by night only)', ['plains', 'obstacle', 'desert', 'mountain'].every((k) => [true, false, null].every((nt) => at(k, nt, 3000).st !== 'fail')));
}

console.log(`\n${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
