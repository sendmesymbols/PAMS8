// phase2.mjs -- checks the two-phase attack (MS/Engines/DeploymentBuilder/PlanPhase.ts, through PlanAttack and
// PlanFit.fitLayout): the recipe (Obj 2 behind Obj 1, FUP 2 / SL 2 / phase 2 axis round Obj 1's flank, the follow-up
// Coys in the reserve's place, the mortars' step-up posn, the LOE beyond Obj 2), the geometry rows, the H-hour sum
// with H2, and on the ground: Obj 2 on a hostile posn drawn behind Obj 1 or on his high ground, the side round Obj 1
// (FUP 2 hidden from Obj 2, NO-GO, his MSR), the follow-up Coys' way kept off Obj 1.
//   node tools/planbuilder-test/phase2.mjs          (add --quiet to print only failures and the summary)
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const F = await import('../../MS/Engines/DeploymentBuilder/PlanFit.ts');
const A = await import('../../MS/Engines/DeploymentBuilder/PlanAttack.ts');
const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
const R = await import('../../MS/Engines/DeploymentBuilder/PlanRecipes.ts');
const Ph = await import('../../MS/Engines/DeploymentBuilder/PlanPhase.ts');

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
const two = (r, side) => Ph.twoPhaseRecipe(r, doc, side);
/** How far beyond a box's edge a point lies, along a direction from its centre. */
const beyondAlong = (b, p, u) => {
  const L = Math.hypot(u.x, u.y), ux = u.x / L, uy = u.y / L;
  const near = Math.min(Math.abs(ux) > 1e-9 ? b.w / 2 / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-9 ? b.h / 2 / Math.abs(uy) : Infinity);
  return (p.x - b.c.x) * ux + (p.y - b.c.y) * uy - near;
};
const withPh2 = (o) => ({ ...doc, plan: { ...doc.plan, attack: { ...doc.plan.attack, phase2: { ...doc.plan.attack.phase2, ...o } } } });
const inpOf = (recipe, g, more = {}) => ({ recipe, ctx, opts: {}, ground: g, anchor: { x: 0, y: 0 }, bearing: 0, threat: null, terrain: 'plains', ...more });
const flatG = { cls: () => 2, elev: () => 200, going: goingOf, label: (c) => rules.classes[String(c)]?.label ?? String(c), sight: () => 0.9, pending: () => false, dataLine: () => 'synthetic',
  avenues: (from, to) => [{ path: [from, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, to], lengthM: Math.hypot(to.x - from.x, to.y - from.y), goPct: 100, minWidthM: 2000, chokes: [] }] };

// ── the recipe ───────────────────────────────────────────────────────────────────────────────────────────────────
for (const r of [front, right, left]) {
  const t = two(r);
  const fails2 = R.validateRecipe(t, { doc, symbols }).filter((i) => i.level === 'fail').map((i) => i.msg);
  check(`${r.layout}: the two-phase recipe validates`, !fails2.length, fails2.join('; '));
  check(`...its own id and name, the one passed in unchanged`, t.id === `${r.id}-2ph` && /two phases/.test(t.name) && !r.slots.some((s) => s.role === 'obj2') && r.slots.some((s) => s.role === 'res'));
  const roles = new Set(t.slots.map((s) => s.role));
  check('...Obj 2, FUP 2, SL 2, the phase 2 axis, C and D Coys and the mortars\' step-up posn; no reserve', ['obj2', 'fup2', 'sl2', 'axis2', 'fu1', 'fu2', 'mor2'].every((x) => roles.has(x)) && !roles.has('res'));
  const res = S.solveRecipe(t, ctx, {});
  const o1 = Ph.boxOf(it(res, 'obj').pts), o2 = Ph.boxOf(it(res, 'obj2').pts);
  check('...Obj 2 1.5 km behind Obj 1 (his depth Coy, E)', Math.abs(o2.c.y - o1.c.y - 1500) < 1 && Math.abs(o2.c.x - o1.c.x) < 1, `${Math.round(o2.c.y - o1.c.y)} m`);
  check('...labels: OBJ 1, OBJ 2, C Coy, D Coy, Spt Coy at the BOF', it(res, 'obj').label === 'OBJ 1' && it(res, 'obj2').label === 'OBJ 2' && it(res, 'fu1').label === 'C Coy' && it(res, 'fu2').label === 'D Coy' && it(res, 'bofCoy').label === 'Spt Coy');
  const F2 = centre(it(res, 'fup2').pts);
  const want = r.layout === 'left-flank' ? -1 : 1;
  const side = r.layout === 'frontal' ? (F2.x < o1.c.x ? 'left' : 'right') : (Math.sign(F2.x - o1.c.x) === want ? 'own flank' : 'other');
  check(`...phase 2 round the ${r.layout === 'frontal' ? 'left (away from the BOF)' : 'flank the assault came from'}`, r.layout === 'frontal' ? side === 'left' : side === 'own flank', side);
  check('...FUP 2 600-1200 m from Obj 2 and 300 m clear of Obj 1', row(res.rows, 'FUP 2 from Obj 2')?.st === 'pass' && row(res.rows, 'FUP 2 clear of Obj 1')?.st === 'pass', `${row(res.rows, 'FUP 2 from Obj 2')?.reason}; ${row(res.rows, 'FUP 2 clear of Obj 1')?.reason}`);
  const S2 = centre(it(res, 'sl2').pts);
  check('...SL 2 beyond the last fire lift (600 m from Obj 2)', Ph.boxGap(o2, S2) >= 599, `${Math.round(Ph.boxGap(o2, S2))} m`);
  const ax = it(res, 'axis2').pts, u = { x: ax[1].x - ax[0].x, y: ax[1].y - ax[0].y };
  const offDeg = Math.round((Math.acos(-u.y / Math.hypot(u.x, u.y)) * 180) / Math.PI);
  check('...phase 2 comes onto Obj 2 60 deg off the line he faces (onto his flank, IBB p186)', Math.abs(180 - offDeg - 60) <= 16, `${180 - offDeg} deg`);
  check('...its arrow ends inside Obj 2', Ph.boxGap(o2, ax[ax.length - 1]) === 0);
  const loe = centre(it(res, 'loe').pts);
  check('...the LOE 600 m beyond Obj 2\'s far edge along the phase 2 axis', Math.abs(beyondAlong(o2, loe, u) - 600) < 5, `${Math.round(beyondAlong(o2, loe, u))} m beyond`);
  check('...Phases, Ph 2 fire base pass; Reserve warns: tell Bde', row(res.rows, 'Phases')?.st === 'pass' && row(res.rows, 'Ph 2 fire base')?.st === 'pass' && row(res.rows, 'Reserve')?.st === 'warn' && /tell Bde/.test(row(res.rows, 'Reserve')?.reason ?? ''), row(res.rows, 'Ph 2 fire base')?.reason);
  check('...the mortars reach the LOE from their step-up posn short of Obj 1 (IBB p176 d)', row(res.rows, 'Mortars reach the LOE')?.st === 'pass' && /step-up posn/.test(row(res.rows, 'Mortars reach the LOE')?.reason ?? ''), row(res.rows, 'Mortars reach the LOE')?.reason);
  const m2 = it(res, 'mor2');
  check('...the step-up posn is drawn planned (dashed), 300 m short of Obj 1, away from the phase 2 way', m2.planned === true && S.sidcFor(m2)[6] === '1' && Math.abs(o1.c.y - o1.h / 2 - m2.pts[0].y - 300) < 1 && Math.sign(m2.pts[0].x - o1.c.x) === -Math.sign(F2.x - o1.c.x));
  const lay = Ph.layPhase2(o1, o2, centre(it(res, 'fup').pts), want === 1 && r.layout !== 'frontal' ? 1 : -1, 60, doc);
  check('...the follow-up Coys\' way keeps 300 m off Obj 1 (not through the Coys on it)', Ph.pathGap(lay.via, o1) >= 299, `${Math.round(Ph.pathGap(lay.via, o1))} m`);
}
{
  // both sides from every layout: the way round never cuts across Obj 1
  const res = S.solveRecipe(two(right, -1), ctx, {});
  const o1 = Ph.boxOf(it(res, 'obj').pts), o2 = Ph.boxOf(it(res, 'obj2').pts);
  const lay = Ph.layPhase2(o1, o2, centre(it(res, 'fup').pts), -1, 60, doc);
  check('Right flank, phase 2 round the left: the way goes in front of Obj 1 by its near corner, 300 m off', lay.via.length === 4 && Ph.pathGap(lay.via, o1) >= 299, `${lay.via.length - 1} legs, ${Math.round(Ph.pathGap(lay.via, o1))} m off`);
}
{
  // one follow-up Coy (the Ph 2 by chips / R while placing, or attack.phase2.coys 1): C Coy goes, D Coy is the reserve
  for (const r of [front, right, left]) {
    const t = Ph.twoPhaseRecipe(r, doc, undefined, 1);
    const sl = (role) => t.slots.find((s) => s.role === role);
    const fails1 = R.validateRecipe(t, { doc, symbols }).filter((i) => i.level === 'fail').map((i) => i.msg);
    check(`${r.layout}, one follow-up Coy: C Coy onto Obj 2, D Coy kept as the reserve, the BOF the Spt Coy`, !fails1.length && t.id === `${r.id}-2ph1` && /D Coy res/.test(t.name) && sl('fu1')?.label === 'C Coy' && !sl('fu2') && sl('res')?.label === 'D Coy' && sl('bofCoy')?.label === 'Spt Coy', fails1.join('; ') || t.id);
    const res = S.solveRecipe(t, ctx, {});
    check('...no "no Bn reserve" warning; the reserve\'s reach is timed; the Phases row names it', !row(res.rows, 'Reserve') && !!row(res.rows, 'Reserve reach') && /D Coy the Bn reserve/.test(row(res.rows, 'Phases')?.reason ?? ''), row(res.rows, 'Phases')?.reason);
    check('...C Coy and D Coy side by side where the reserve was, not on one spot', dist(it(res, 'fu1').pts[0], it(res, 'res').pts[0]) >= 299);
  }
  const d1 = withPh2({ coys: { value: 1, basis: 'U' } });
  check('...the doctrine default (attack.phase2.coys) sets it when the user has not', Ph.twoPhaseRecipe(front, d1).id.endsWith('-2ph1') && Ph.twoPhaseRecipe(front, d1, undefined, 2).id.endsWith('-2ph'));
  const fl1 = F.fitLayout(inpOf(Ph.twoPhaseRecipe(right, doc, undefined, 1), flatG));
  check('...fitted on the ground, the reserve moves with the FUP and phase 2 still times H2', !!fl1.fit.attack?.hSum?.phase2 && !!row(fl1.res.rows, 'Reserve reach'), row(fl1.res.rows, 'Reserve reach')?.reason);
}

// ── the H-hour sum by geometry ───────────────────────────────────────────────────────────────────────────────────
{
  const res = S.solveRecipe(two(front), ctx, {});
  const h = A.attackTimes(res, null, null, doc, 'plains', false, null);
  const p = h?.phase2;
  check('H-hour sum: phase 2 timed (Obj 1 taken, the move round to FUP 2, H2, Obj 2)', !!p && p.h2At > p.obj1At && p.obj2At > p.h2At && h.loeAt > p.obj2At, p ? `Obj 1 ${A.hRelText(p.obj1At)}, H2 ${A.hRelText(p.h2At)}, Obj 2 ${A.hRelText(p.obj2At)}, LOE ${A.hRelText(h.loeAt)}` : '');
  const fupMin = doc.plan.attack.phase2.fupMin.value;
  check('...H2 = Obj 1 taken + the move + 15 min forming up + FUP 2 to SL 2', p && p.gapMin === p.marchMin + fupMin + h.steps.find((s) => s.label === 'FUP 2 to SL 2').min, `${p?.gapMin} = ${p?.marchMin} + ${fupMin} + ${h.steps.find((s) => s.label === 'FUP 2 to SL 2')?.min}`);
  check('...steps in time order, Obj 1 then Obj 2 then the LOE', h.steps.every((s, i) => i === 0 || s.at >= h.steps[i - 1].at) && h.steps.map((s) => s.label).join('|').includes('Through Obj 1|Follow-up Coys: FUP to FUP 2|Form up at FUP 2|FUP 2 to SL 2|Assault: SL 2 to Obj 2 (H2)|Through Obj 2|On to the LOE'), h.steps.map((s) => s.label).join(' > '));
  check('...the fire lifts on Obj 2 after H2, the furthest first', p.lifts.every((l) => l.at >= p.h2At) && p.lifts[0].at <= p.lifts[3].at, p.lifts.map((l) => `${l.rM} m ${A.hRelText(l.at)}`).join(', '));
  const hn = A.attackTimes(res, null, null, doc, 'plains', true, null);
  check('...by night the move round Obj 1 is slower', hn.phase2.marchMin > p.marchMin, `${p.marchMin} by day, ${hn.phase2.marchMin} by night`);
  check('Ph 2 timing: the row says when Obj 1 falls, H2 and the gap; within the limit passes', A.phase2Row(h, withPh2({ maxGapMin: { value: 90, basis: 'U' } }))?.st === 'pass' && /after Obj 1 falls/.test(A.phase2Row(h, doc)?.reason ?? ''), A.phase2Row(h, doc)?.reason);
  const hb = A.attackTimes(res, null, null, withPh2({ waitAt: { value: 'behind', basis: 'U' } }), 'plains', false, null);
  check('...close behind the assault (IBB p186 h(2)): less of the way left when Obj 1 falls, H2 sooner', hb.phase2.gapMin < p.gapMin && hb.steps.some((st) => st.label === 'Follow-up Coys close up behind the assault' && st.at === 0), `${p.gapMin} min from the FUP, ${hb.phase2.gapMin} min closed up`);
  const dTight = withPh2({ maxGapMin: { value: 10, basis: 'U' } });
  check('...longer warns: he has time to react (IBB p176 c)', A.phase2Row(h, dTight)?.st === 'warn' && /IBB p176 c/.test(A.phase2Row(h, dTight)?.reason ?? ''));
  const one = A.attackTimes(S.solveRecipe(front, ctx, {}), null, null, doc, 'plains', false, null);
  check('One phase is unchanged: no phase 2, the LOE after the Obj', !one.phase2 && one.steps.some((s) => s.label === 'On to the LOE') && one.steps.some((s) => s.label === 'Through the Obj') && A.phase2Row(one, doc) === null);
}

// ── on the ground ────────────────────────────────────────────────────────────────────────────────────────────────
const ref = F.fitLayout(inpOf(two(front), flatG));
const W = (p) => F.toWorld(ref.frame, p), L = (w) => F.toLocal(ref.frame, w);
const b0 = S.solveRecipe(two(front), ctx, {});
const O1 = Ph.boxOf(it(b0, 'obj').pts), O2 = Ph.boxOf(it(b0, 'obj2').pts);
{
  const fl = ref;
  check('Fit: phase 2 timed on the ground, the Ph 2 rows and the Phase 2 factor', !!fl.fit.attack?.hSum?.phase2 && ['Obj 2', 'Ph 2 direction', 'FUP 2 unseen', 'Ph 2 going', 'Ph 2 timing'].every((x) => row(fl.res.rows, x)) && fl.fit.attack.factors.some((x) => x.key === 'phase2'),
    ['Obj 2', 'Ph 2 direction', 'FUP 2 unseen', 'Ph 2 going', 'Ph 2 timing'].filter((x) => !row(fl.res.rows, x)).join(', '));
  check('...nothing drawn behind Obj 1 and flat ground: Obj 2 assumed straight behind (warn: draw his depth posn)', row(fl.res.rows, 'Obj 2')?.st === 'warn' && fl.fit.attack.phase2.obj2From === 'assumed', row(fl.res.rows, 'Obj 2')?.reason);
  const route = fl.fit.attack.phase2.route;
  check('...the follow-up Coys\' way from the FUP to FUP 2, kept off Obj 1', route.length >= 2 && dist(route[0], centre(it(fl.raw, 'fup').pts)) < 1 && dist(route[route.length - 1], centre(it(fl.raw, 'fup2').pts)) < 1 && Ph.pathGap(route, Ph.boxOf(it(fl.raw, 'obj').pts)) >= 250, `${route.length - 1} legs, ${Math.round(Ph.pathGap(route, Ph.boxOf(it(fl.raw, 'obj').pts)))} m off Obj 1`);
}
{
  // a hostile Coy drawn 1.8 km behind Obj 1 and 400 m to the right: Obj 2 goes onto it
  const en = { x: O1.c.x + 400, y: O1.c.y + 1800 };
  const fl = F.fitLayout(inpOf(two(front), flatG, { enemyAt: [W(en)] }));
  const c2 = Ph.boxOf(it(fl.raw, 'obj2').pts).c;
  check('Obj 2 on the hostile posn drawn behind Obj 1', dist(c2, en) < 2 && row(fl.res.rows, 'Obj 2')?.st === 'pass' && /enemy posn drawn/.test(row(fl.res.rows, 'Obj 2')?.reason ?? ''), `${Math.round(dist(c2, en))} m; ${row(fl.res.rows, 'Obj 2')?.reason}`);
  const b2 = Ph.boxOf(it(fl.raw, 'obj2').pts), a2 = it(fl.raw, 'axis2').pts, u2 = { x: a2[a2.length - 1].x - a2[0].x, y: a2[a2.length - 1].y - a2[0].y };
  const sl2Out = Ph.boxGap(b2, centre(it(fl.raw, 'sl2').pts)), loeOut = beyondAlong(b2, centre(it(fl.raw, 'loe').pts), u2);
  check('...FUP 2, SL 2 and the LOE laid afresh round it', sl2Out >= 590 && Math.abs(loeOut - 600) < 60 && Ph.boxGap(b2, a2[a2.length - 1]) === 0, `SL 2 ${Math.round(sl2Out)} m out, the LOE ${Math.round(loeOut)} m beyond`);
  // one off to the side (60 deg) and one too near are not his depth
  const side = { x: O1.c.x + 1700, y: O1.c.y + 900 }, near = { x: O1.c.x, y: O1.c.y + 700 };
  const fl2 = F.fitLayout(inpOf(two(front), flatG, { enemyAt: [W(side), W(near)] }));
  check('...a posn off to the side or touching Obj 1 is not taken for his depth', fl2.fit.attack.phase2.obj2From === 'assumed', row(fl2.res.rows, 'Obj 2')?.reason);
}
{
  // a hill 1.25 km behind Obj 1, 300 m to the left: his depth on the high ground
  const hill = { x: O1.c.x - 700, y: O1.c.y + 1150 };
  const g = { ...flatG, elev: (x, y) => 200 + Math.max(0, 40 - dist(L({ x, y }), hill) / 15) };
  const fl = F.fitLayout(inpOf(two(front), g));
  const c2 = Ph.boxOf(it(fl.raw, 'obj2').pts).c;
  check('Obj 2 on his high ground behind Obj 1 when nothing is drawn', fl.fit.attack.phase2.obj2From === 'highGround' && dist(c2, hill) < 320, `${Math.round(dist(c2, hill))} m from the hilltop; ${row(fl.res.rows, 'Obj 2')?.reason}`);
}
{
  // Obj 2 sees the right of Obj 1 but not the left: phase 2 goes round the left
  const g = { ...flatG, sight: (ox, oy, e, tx, ty) => (L({ x: tx, y: ty }).x > O1.c.x ? 0.9 : 0.1) };
  const fl = F.fitLayout(inpOf(two(right), g));
  check('Side: FUP 2 where Obj 2 cannot see it, even against the flank the assault came from', fl.fit.attack.phase2.side === -1 && row(fl.res.rows, 'FUP 2 unseen')?.st === 'pass', `${row(fl.res.rows, 'Ph 2 direction')?.reason}`);
  check('...the reason names the other way', /right way has FUP 2 more in view/.test(row(fl.res.rows, 'Ph 2 direction')?.reason ?? ''));
  const g2 = { ...flatG, sight: () => 0.9 };
  const fl2 = F.fitLayout(inpOf(two(right), g2));
  check('...seen either way: the shorter way (the flank the assault came from), and FUP 2 unseen warns', fl2.fit.attack.phase2.side === 1 && row(fl2.res.rows, 'FUP 2 unseen')?.st === 'warn', row(fl2.res.rows, 'FUP 2 unseen')?.reason);
}
{
  // a marsh (NO-GO on foot) where the right FUP 2 would be: the left
  const lay = Ph.layPhase2(O1, O2, centre(it(b0, 'fup').pts), 1, 60, doc);
  const nogo = [...goingOf('dismounted').nogo][0];
  const g = { ...flatG, cls: (x, y) => (L({ x, y }).x > O1.c.x + O1.w / 2 + 100 ? nogo : 2) };
  const fl = F.fitLayout(inpOf(two(front, 1), g));
  check('Side: NO-GO at the right FUP 2 sends phase 2 round the left', fl.fit.attack.phase2.side === -1, `${row(fl.res.rows, 'Ph 2 direction')?.reason}; right FUP 2 at x ${Math.round(lay.fup2.x)}`);
}
{
  // frontal, the same both ways but a bridge on his MSR behind Obj 2's right: the right (the LOE chokes it)
  const bridge = { x: O2.c.x + 900, y: O2.c.y + 1100 };
  const g = { ...flatG, cls: (x, y) => (dist(L({ x, y }), bridge) < 60 ? 39 : 2) };
  const fl = F.fitLayout(inpOf(two(front), g));
  const ends = (sd) => dist(centre(Ph.layPhase2(O1, O2, centre(it(b0, 'fup').pts), sd, 60, doc).loePts), bridge);
  const nearSide = ends(1) < ends(-1) ? 1 : -1;
  check('Side: equal ground, the way whose LOE ends nearer his MSR bridge (it comes from the other side of Obj 2)', fl.fit.attack.phase2.side === nearSide && fl.fit.attack.choke?.kind === 'bridge' && /further from his MSR/.test(row(fl.res.rows, 'Ph 2 direction')?.reason ?? ''), `${row(fl.res.rows, 'Ph 2 direction')?.reason}`);
  check('...his MSR is sought behind Obj 2, not Obj 1', fl.fit.attack.choke && fl.fit.attack.choke.at.y > Ph.boxOf(it(fl.raw, 'obj2').pts).c.y);
}
{
  // Auto over the two-phase layouts: a feasible flank still before frontal
  const fits = [front, right, left].map((r) => ({ fit: F.fitLayout(inpOf(two(r), flatG)).fit, recipe: two(r) }));
  const ranked = F.rankFits(fits);
  check('Auto: two phases, frontal still last', ranked[ranked.length - 1].recipe.layout === 'frontal', ranked.map((x) => `${x.recipe.layout} ${x.fit.score}`).join(', '));
  check('...each fit\'s FUP 2 rows pass after the finder', fits.every((x) => true) && [front, right, left].every((r) => { const fl = F.fitLayout(inpOf(two(r), flatG)); return row(fl.res.rows, 'FUP 2 from Obj 2')?.st === 'pass' && row(fl.res.rows, 'FUP 2 clear of Obj 1')?.st === 'pass'; }));
}
{
  // the plan document: the phase 2 symbols are placed (Obj 2, FUP 2, SL 2, the arrow, C and D Coys, the step-up mortars)
  const out = S.toPlanDocument(S.solveRecipe(two(front), ctx, {}), (pid, ov, id, de) => ({ id, de }), (pid, id, name, seq, syms) => ({ syms }), 1);
  const roles = new Set(Object.values(out.roles));
  check('Plan document: the phase 2 symbols are placed with their roles', ['obj2', 'fup2', 'sl2', 'axis2', 'fu1', 'fu2', 'mor2'].every((r) => roles.has(r)), [...roles].join(', '));
}

// ── Check my plan on a two-phase plan ────────────────────────────────────────────────────────────────────────────
{
  const K = await import('../../MS/Engines/DeploymentBuilder/PlanCheck.ts');
  const recsOf = (recipe, withRoles = true) => {
    const out = S.toPlanDocument(S.solveRecipe(recipe, ctx, {}), (pid, ov, id, de) => ({ plnOrdrSymbolPK: { plnOrdrSymbolId: id }, drawEss: JSON.stringify(de) }), (pid, id, name, seq, syms) => ({ plnOrdrSymbolSet: syms }), 1);
    return K.recordsFromPlanDoc(out.doc).map((r) => (withRoles ? { ...r, attrs: { ...(r.attrs ?? {}), pbRole: out.roles[r.id], pbRecipe: recipe.id } } : r));
  };
  const ph2Group = (rep) => rep.groups.find((g) => g.phase === 2);
  for (const [name, recipe] of [['frontal', two(front)], ['right flank', two(right)]]) {
    const rep = K.checkPlan(recsOf(recipe), doc, {});
    const g2 = ph2Group(rep), r = (n) => g2?.rows.find((x) => x.name === n);
    check(`Check my plan, built ${name} in two phases: the Ph 2 arrow read as phase 2 from Obj 1`, rep.task === 'attack' && !!g2 && /OBJ 2/.test(g2.obj?.label ?? '') && row(rep.rows, 'Phases')?.st === 'pass', `${row(rep.rows, 'Phases')?.reason}; groups ${rep.groups.map((g) => `${g.label}:${g.phase}`).join(', ')}`);
    check('...judged as phase 2: FUP 2 band, Obj 1 the fire base, a new direction; no BOF rows on it', r('FUP 2 from Obj 2')?.st === 'pass' && r('Ph 2 fire base')?.st === 'pass' && r('Ph 2 direction')?.st === 'pass' && !r('FUP from the Obj') && !r('BOF range'), g2?.rows.map((x) => `${x.name} [${x.st}]`).join(', '));
    check('...phase 1 still judged as before (FUP 1000-1200 m, the BOF)', rep.groups.find((g) => g.phase === 1)?.rows.some((x) => x.name === 'FUP from the Obj' && x.st === 'pass'));
    check('...both follow-up Coys: Reserve warns (tell Bde)', row(rep.rows, 'Reserve')?.st === 'warn' && /tell Bde/.test(row(rep.rows, 'Reserve')?.reason ?? ''));
  }
  const rep1 = K.checkPlan(recsOf(Ph.twoPhaseRecipe(front, doc, undefined, 1)), doc, {});
  check('...C Coy following up, D Coy the reserve: Reserve passes', row(rep1.rows, 'Reserve')?.st === 'pass' && /D Coy/.test(row(rep1.rows, 'Reserve')?.reason ?? ''), row(rep1.rows, 'Reserve')?.reason);
  // drawn by hand (no roles): phase 2 found by where its arrow starts
  const drawn = K.checkPlan(recsOf(two(front), false), doc, {});
  check('Check my plan, drawn (no roles): an arrow starting beside Obj 1 onto a deeper Obj is phase 2', !!ph2Group(drawn) && ph2Group(drawn).rows.some((x) => x.name === 'Ph 2 fire base'), drawn.groups.map((g) => `${g.label}:${g.phase} -> ${g.obj?.label}`).join(', '));
  // drawn badly: the phase 2 arrow starts on Obj 1 and goes through it
  const syms = K.readSymbols(recsOf(two(front), false));
  const o1s = syms.find((s) => s.key === '25151700' && /OBJ 1/.test(s.label)), o2s = syms.find((s) => s.key === '25151700' && /OBJ 2/.test(s.label));
  const ax2 = syms.find((s) => s.key === '25151403' && /Ph 2/.test(s.label));
  const c1 = centre(o1s.pts), c2 = centre(o2s.pts);
  const bad = syms.map((s) => (s === ax2 ? { ...s, pts: [{ x: c1.x + (c2.x - c1.x) * 0.1, y: c1.y + (c2.y - c1.y) * 0.1 }, { x: c1.x + (c2.x - c1.x) * 0.8, y: c1.y + (c2.y - c1.y) * 0.8 }] } : s));
  const badRep = K.checkPlan(bad, doc, {});
  const bg = ph2Group(badRep);
  check('...an arrow from inside Obj 1 straight on to Obj 2 warns: through the Coys on Obj 1, no new direction', bg?.rows.find((x) => x.name === 'Ph 2 direction')?.st === 'warn', bg?.rows.find((x) => x.name === 'Ph 2 direction')?.reason ?? badRep.groups.map((g) => `${g.label}:${g.phase}`).join(', '));
  // a one-phase plan is not read as two
  const one = K.checkPlan(recsOf(front, false), doc, {});
  check('...a one-phase attack has no phase 2 and no Phases row', !ph2Group(one) && !row(one.rows, 'Phases'));
  // with the ground: his counter-attack ways in onto the last objective only (the reorganisation)
  const wg = K.checkPlan(recsOf(two(front)), doc, { ground: flatG });
  const caRow = (g) => g?.rows.find((x) => x.name === 'Approaches covered');
  check('Check my plan with the ground: his counter-attack read onto Obj 2 (the last), not Obj 1', caRow(ph2Group(wg))?.st === 'pass' && /onto OBJ 2/.test(caRow(ph2Group(wg)).reason) && !caRow(wg.groups.find((g) => g.phase === 1)), caRow(ph2Group(wg))?.reason);
  const wg1 = K.checkPlan(recsOf(front), doc, { ground: flatG });
  check('...a one-phase attack reads it onto its Obj, from beyond it (his side)', caRow(wg1.groups[0])?.st === 'pass' && /3 ways in/.test(caRow(wg1.groups[0]).reason), caRow(wg1.groups[0])?.reason);
}

console.log(`\n${n - fails} of ${n} checks passed${fails ? `, ${fails} FAILED` : ''}`);
process.exit(fails ? 1 : 0);
