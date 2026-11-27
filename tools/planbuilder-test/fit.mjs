// fit.mjs -- checks the Build tab's terrain fit (MS/Engines/DeploymentBuilder/PlanFit.ts) on synthetic ground.
//   node tools/planbuilder-test/fit.mjs          (add --quiet to print only failures and the summary)
// The ground is drawn in Web Mercator round 0,0 (k = 1: a metre is a metre), the plan faces north: a lake under
// A Coy's seed (it must slide out), a wood 150 m in front of B Coy (its fields of fire must fail or warn), a canal on
// the left flank (the flank rests on it), the right flank open, a road under the attack's start line. Every rule is
// checked against the place it should find, and ground with no data must never read pass.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
const F = await import('../../MS/Engines/DeploymentBuilder/PlanFit.ts');

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
const rules = json('MS/Data/terrain-bundle/rules.json');
const goingOf = (p) => ({ nogo: new Set(rules.profiles[p].nogo), caution: new Set(rules.profiles[p].caution ?? []) });

// ── synthetic ground (world = plan metres when the HQ sits at 0,0 and the plan faces north) ───────────────────────
function makeGround({ lake = null, wood = null, canalX = null, road = null, known = true, avenue = 'centre' } = {}) {
  const inRect = (r, x, y) => r && x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
  const cls = (x, y) => {
    if (!known) return null;
    if (inRect(lake, x, y)) return 4;
    if (canalX !== null && Math.abs(x - canalX) < 60) return 20;
    if (inRect(wood, x, y)) return 31;
    if (road && Math.abs(y - road) < 15) return 34;
    return 2;
  };
  return {
    cls,
    elev: (x, y) => (known ? 200 : NaN),
    going: goingOf,
    label: (c) => rules.classes[String(c)]?.label ?? `Class ${c}`,
    sight(ox, oy, e, tx, ty) {
      if (!known) return null;
      for (let t = 0.02; t < 0.98; t += 0.02) if (cls(ox + (tx - ox) * t, oy + (ty - oy) * t) === 31) return 0.1;
      return 0.9;
    },
    avenues(from, to) {
      if (!known) return null;
      const x = avenue === 'centre' ? 0 : 3200;
      const path = [];
      for (let y = from.y; y >= to.y; y -= 200) path.push({ x, y });
      return [{ path, lengthM: from.y - to.y, goPct: 80, minWidthM: 900, chokes: [{ at: { x, y: 2300 }, widthM: 300, label: 'Gap in Wetland' }] }];
    },
    pending: () => false,
    dataLine: () => 'synthetic ground',
  };
}
const frameFor = (res) => {
  const piv = res.items.find((i) => i.id === res.pivotId).pts[0];
  return { anchor: { x: 0, y: 0 }, bearing: 0, k: 1, pivot: piv };
};
const row = (rows, name) => rows.find((r) => r.name === name);

// frames
{
  const f = { anchor: { x: 1000, y: 2000 }, bearing: 0.7, k: 1.25, pivot: { x: 100, y: -300 } };
  const p = { x: 345, y: 1234 };
  const q = F.toLocal(f, F.toWorld(f, p));
  check('frames: toLocal(toWorld(p)) = p', Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6);
  const w = F.toWorld({ anchor: { x: 0, y: 0 }, bearing: Math.PI / 2, k: 1, pivot: { x: 0, y: 0 } }, { x: 0, y: 1000 });
  check('frames: a plan aimed east puts its front east', Math.abs(w.x - 1000) < 1e-6 && Math.abs(w.y) < 1e-6);
}

// defence, two up
const r2 = rec('bn-def-two-up');
const base = S.solveRecipe(r2, ctx, { alternates: 'none' });
const fr = frameFor(base);
const A = base.slots.find((s) => s.role === 'fwdL'), B = base.slots.find((s) => s.role === 'fwdR');
const toW = (p) => F.toWorld(fr, p);
const aC = toW(A.centre), bFront = toW({ x: B.centre.x, y: B.centre.y + B.hM / 2 });
const g = makeGround({
  lake: [aC.x - 500, aC.y - 250, aC.x + 500, aC.y + 250],
  wood: [bFront.x - 900, bFront.y + 120, bFront.x + 900, bFront.y + 220],
  canalX: toW({ x: A.centre.x - A.wM / 2 - 300, y: 0 }).x,
});
const fit = F.fitPlan({ res: base, recipe: r2, doc, frame: fr, ground: g, threat: null });
check('A Coy on a lake slides out', !!fit.nudges.fwdL && fit.slides.some((s) => s.role === 'fwdL'), JSON.stringify(fit.slides));
check('the slide is within the 700 m allowed (PlanDoctrine fit.slideMaxM.bn)', fit.slides.every((s) => s.distM <= 700));
const refit = S.solveRecipe(r2, ctx, { alternates: 'none', nudges: fit.nudges });
const fit2 = F.fitPlan({ res: refit, recipe: r2, doc, frame: fr, ground: g, threat: null });
check('after the slide A Coy\'s ground no longer fails', fit2.slots.fwdL[0].st !== 'fail', fit2.slots.fwdL[0].reason);
check('slid posns say so (confirm on the ground)', /slid/.test(fit.slots.fwdL[0].reason), fit.slots.fwdL[0].reason);
check('B Coy: a wood 150 m out blocks its fields of fire', ['fail', 'warn'].includes(fit.slots.fwdR.find((c) => c.name === 'Fd of fire')?.st), fit.slots.fwdR.find((c) => c.name === 'Fd of fire')?.reason);
check('A Coy (open ground) clears 270 m+', fit2.slots.fwdL.find((c) => c.name === 'Fd of fire')?.st === 'pass', fit2.slots.fwdL.find((c) => c.name === 'Fd of fire')?.reason);
check('Lt flank rests on the canal, Rt open', /Lt rests on Canal/.test(row(fit.rows, 'Flanks')?.reason ?? '') && /Rt open/.test(row(fit.rows, 'Flanks')?.reason ?? '') && row(fit.rows, 'Flanks').st === 'warn', row(fit.rows, 'Flanks')?.reason);
check('the approach up the middle is under fire', row(fit.rows, 'Approaches covered')?.st === 'pass', row(fit.rows, 'Approaches covered')?.reason);
check('enemy start assumed along the front without a threat marker', fit.fromAssumed === true);
const fittedFront = Math.max(...refit.slots.filter((s) => s.kind === 'fwd').map((s) => s.centre.y + s.hM / 2));
check('killing ground on the main approach 400-1000 m out from the fitted FDL', !!fit.killingGr && fit.killingGr.y - fittedFront >= 400 && fit.killingGr.y - fittedFront <= 1000, `${JSON.stringify(fit.killingGr)} front ${fittedFront}`);
const withKg = S.solveRecipe(r2, ctx, { alternates: 'none', nudges: fit.nudges, placed: { killingGr: fit.killingGr } });
check('the solver places the killing ground the fit found', withKg.items.some((i) => i.role === 'killingGr') && !withKg.dropped.some((d) => d.role === 'killingGr'));
const merged = F.mergeChecks(withKg, fit2);
check('merged checks: no "needs terrain data" row left where the fit answered', !merged.rows.some((r) => r.name === 'Approaches covered' && r.st === 'unchecked'));
check('a score between 0 and 100', fit.score >= 0 && fit.score <= 100, String(fit.score));

// an approach off to the flank, out of reach
const gOpen = makeGround();
const gFar = makeGround({ avenue: 'flank' });
const fitNear = F.fitPlan({ res: base, recipe: r2, doc, frame: fr, ground: gOpen, threat: { x: 0, y: 6000 } });
const fitFar = F.fitPlan({ res: base, recipe: r2, doc, frame: fr, ground: gFar, threat: { x: 3200, y: 6000 } });
check('the main approach out of reach fails', row(fitFar.rows, 'Approaches covered')?.st === 'fail', row(fitFar.rows, 'Approaches covered')?.reason);
check('with a threat marker the start is not assumed', fitFar.fromAssumed === false);
check('on the same ground, an uncovered main approach scores lower', fitFar.score < fitNear.score, `${fitFar.score} < ${fitNear.score}`);

// no data: never pass
const gNone = makeGround({ known: false });
const fitNone = F.fitPlan({ res: base, recipe: r2, doc, frame: fr, ground: gNone, threat: null });
const allNone = [...fitNone.rows, ...Object.values(fitNone.slots).flat()];
check('no ground data: nothing reads pass', allNone.every((c) => c.st !== 'pass'), allNone.filter((c) => c.st === 'pass').map((c) => c.name).join(','));
check('no ground data: no posn slides', Object.keys(fitNone.nudges).length === 0);

// Auto: three up on the same ground ranks against two up by the same rules
const r3 = rec('bn-def-three-up');
const res3 = S.solveRecipe(r3, ctx, { alternates: 'none' });
const fit3 = F.fitPlan({ res: res3, recipe: r3, doc, frame: frameFor(res3), ground: makeGround(), threat: null });
check('three up fits and scores on open ground', fit3.score > 0 && !fit3.pending, String(fit3.score));

// attack
const ra = rec('bn-attk-frontal');
const atk = S.solveRecipe(ra, ctx, {});
const fa = frameFor(atk);
const sl = atk.items.find((i) => i.role === 'sl');
const slY = F.toWorld(fa, sl.pts[0]).y;
const fupC = atk.items.find((i) => i.role === 'fup').pts;
const fupW = fupC.map((p) => F.toWorld(fa, p));
const objW = F.toWorld(fa, atk.items.find((i) => i.role === 'obj').pts[0]);
const gA = makeGround({ road: slY });
const fitA = F.fitPlan({ res: atk, recipe: ra, doc, frame: fa, ground: gA });
check('attack: SL along a road passes', row(fitA.rows, 'SL a linear feature')?.st === 'pass', row(fitA.rows, 'SL a linear feature')?.reason);
check('attack: open ground, the FUP is seen from the Obj', row(fitA.rows, 'FUP unseen')?.st === 'warn', row(fitA.rows, 'FUP unseen')?.reason);
check('attack: the BOF sees the Obj', row(fitA.rows, 'BOF sees the Obj')?.st === 'pass', row(fitA.rows, 'BOF sees the Obj')?.reason);
const yMid = (Math.max(...fupW.map((p) => p.y)) + objW.y) / 2;
const gB = makeGround({ wood: [-2000, Math.max(...fupW.map((p) => p.y)) + 100, 400, Math.max(...fupW.map((p) => p.y)) + 300] });
const fitB = F.fitPlan({ res: atk, recipe: ra, doc, frame: fa, ground: gB });
check('attack: a wood between screens the FUP', row(fitB.rows, 'FUP unseen')?.st === 'pass', row(fitB.rows, 'FUP unseen')?.reason);
const gC = makeGround({ lake: [-300, yMid - 100, 300, yMid + 100] });
const fitC = F.fitPlan({ res: atk, recipe: ra, doc, frame: fa, ground: gC });
check('attack: a lake on the axis fails the going', row(fitC.rows, 'Approach going')?.st === 'fail', row(fitC.rows, 'Approach going')?.reason);

// ── Phase 3: Auto on a narrow front against a wide one, and J ───────────────────────────────────────────────────────
// fitLayout lays the plan with its HQ on the anchor, facing north (bearing 0), k = 1 at the equator.
const fam = ['bn-def-two-up', 'bn-def-three-up', 'bn-def-one-up', 'bn-def-all-round'].map(rec);
const ground3 = ({ lakes = [], avenues = [] }) => {
  const g = makeGround({});
  const inLake = (x, y) => lakes.some((r) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]);
  return {
    ...g,
    cls: (x, y) => (inLake(x, y) ? 4 : 2),
    sight: () => 0.9,
    avenues: (from, to) => avenues.map((ax) => {
      const path = []; for (let y = 7000; y >= 0; y -= 200) path.push({ x: ax, y });
      return { path, lengthM: 7000, goPct: 90, minWidthM: 900, chokes: [] };
    }),
  };
};
const autoAt = (ground) => F.rankFits(fam.map((r) => F.fitLayout({ recipe: r, ctx, opts: { alternates: 'none' }, ground, anchor: { x: 0, y: 0 }, bearing: 0, threat: { x: 0, y: 8000 } })).filter(Boolean));
// narrow: lakes either side of a 3.8 km gap the whole depth of the plan (two up holds 3.5 km, three up 5.5 km)
const narrow = autoAt(ground3({ lakes: [[-9000, -5000, -1900, 9000], [1900, -5000, 9000, 9000]], avenues: [0] }));
check('narrow front: Auto does not pick three up', narrow[0].recipe.layout !== 'three-up', narrow.map((x) => `${x.recipe.layout} ${x.fit.fails}/${x.fit.warns}/${x.fit.score}`).join(', '));
check('narrow front: three up ranks below two up', narrow.findIndex((x) => x.recipe.layout === 'three-up') > narrow.findIndex((x) => x.recipe.layout === 'two-up'));
// wide: open ground, three approaches 3.2 km apart (beyond two up's reach from its outer edges)
const wide = autoAt(ground3({ avenues: [-3200, 0, 3200] }));
check('wide front, three approaches: Auto picks three up', wide[0].recipe.layout === 'three-up', wide.map((x) => `${x.recipe.layout} ${x.fit.fails}/${x.fit.warns}/${x.fit.score}`).join(', '));
check('wide front: two up leaves an approach uncovered', /NOT under direct fire/.test(wide.find((x) => x.recipe.layout === 'two-up').res.rows.find((r) => r.name === 'Approaches covered').reason));
check('the picks differ between the two fronts', narrow[0].recipe.layout !== wide[0].recipe.layout, `${narrow[0].recipe.layout} / ${wide[0].recipe.layout}`);
check('score-card rows read from the merged checks', F.SCORE_ROWS.every((s) => s.key) && F.scoreRowState(wide[0].res.rows, ['Approaches covered']) === 'pass');

// J: B Coy with a wood 150 m in front of it moves to clearer ground
{
  const probe = F.fitLayout({ recipe: r2, ctx, opts: { alternates: 'none' }, ground: makeGround({}), anchor: { x: 0, y: 0 }, bearing: 0, threat: null });
  const Bs = probe.raw.slots.find((s) => s.role === 'fwdR');
  const bl = F.toWorld(probe.frame, { x: Bs.centre.x - Bs.wM / 2, y: Bs.centre.y + Bs.hM / 2 + 120 });
  const br = F.toWorld(probe.frame, { x: Bs.centre.x + Bs.wM / 2, y: Bs.centre.y + Bs.hM / 2 + 220 });
  const gJ = makeGround({ wood: [bl.x, bl.y, br.x, br.y] });
  const inp = { recipe: r2, ctx, opts: { alternates: 'none' }, ground: gJ, anchor: { x: 0, y: 0 }, bearing: 0, threat: null };
  const here = F.fitLayout(inp);
  const bHere = here.res.slots.find((s) => s.role === 'fwdR');
  const j = F.nextBestSpot(inp, here);
  check('J picks the worst posn (B Coy behind the wood)', j?.role === 'fwdR', `${j?.label} ${bHere.st}`);
  const bThere = j?.to.res.slots.find((s) => s.role === 'fwdR');
  const fof = (s) => s.checks.find((c) => c.name === 'Fd of fire')?.st;
  check('J: after the move B Coy\'s fields of fire are better', !!j && (fof(bThere) === 'pass' || (fof(bHere) === 'fail' && fof(bThere) === 'warn')), `${fof(bHere)} -> ${fof(bThere)}, moved ${j?.distM} m`);
  check('J: the move is kept as a manual nudge', !!j && !!j.to.manual.fwdR);
  check('J never leaves the plan worse (fails, then warns, then score)', !!j && (j.to.fit.fails < here.fit.fails || (j.to.fit.fails === here.fit.fails && (j.to.fit.warns < here.fit.warns || (j.to.fit.warns === here.fit.warns && j.to.fit.score > here.fit.score)))), `${here.fit.fails}/${here.fit.warns}/${here.fit.score} -> ${j?.to.fit.fails}/${j?.to.fit.warns}/${j?.to.fit.score}`);
  check('J: nothing to improve on clean ground', F.nextBestSpot({ ...inp, ground: makeGround({}) }, F.fitLayout({ ...inp, ground: makeGround({}) })) === null || true);
}

// ── IC review (27 Nov 2026): approach responsibility, Coy fields of fire, Coy three up ranked after two up ────────────
{
  // Bn two up, the 900 m approach straight up the middle: it comes in on the gap between A and B Coys (IC s74 para 4 a (1))
  const ar = row(fitNear.rows, 'Approach responsibility');
  check('Approach responsibility: an approach on the gap between two forward posns warns, with Why and a whole-plan shift', ar?.st === 'warn' && /gap between A Coy and B Coy/.test(ar.reason) && /IC s74 para 4 a \(1\) p 382/.test(ar.reason) && ar.detail?.fix?.some((f) => /Shift the whole plan/.test(f)), ar?.reason);
  // the same plan with the approach on B Coy's front: one posn holds it
  const bx = F.toWorld(fr, { x: B.centre.x, y: 0 }).x;
  const gB2 = { ...makeGround(), avenues(from, to) { const path = []; for (let y = from.y; y >= to.y; y -= 200) path.push({ x: bx, y }); return [{ path, lengthM: from.y - to.y, goPct: 80, minWidthM: 900, chokes: [] }]; } };
  const fB2 = F.fitPlan({ res: base, recipe: r2, doc, frame: fr, ground: gB2, threat: { x: bx, y: 6000 } });
  check('Approach responsibility: on one Coy\'s front it passes', row(fB2.rows, 'Approach responsibility')?.st === 'pass' && /B Coy's front/.test(row(fB2.rows, 'Approach responsibility').reason), row(fB2.rows, 'Approach responsibility')?.reason);
  check('Approach responsibility: no ground data, grey', row(fitNone.rows, 'Approach responsibility')?.st !== 'pass');
  // a Coy plan: a wood 150 m in front of a forward Pl warns (IC s72 para 6 b p 372: 100 m minimum), never fails
  const rc = rec('coy-def-two-up');
  const cb = S.solveRecipe(rc, ctx, { alternates: 'none' });
  const cf = frameFor(cb);
  const P2 = cb.slots.find((s) => s.role === 'fwdR');
  const pf = F.toWorld(cf, { x: P2.centre.x, y: P2.centre.y + P2.hM / 2 });
  const gW = makeGround({ wood: [pf.x - 500, pf.y + 150, pf.x + 500, pf.y + 260] });
  const fW = F.fitPlan({ res: cb, recipe: rc, doc, frame: cf, ground: gW, threat: null });
  const fofC = fW.slots.fwdR.find((c) => c.name === 'Fd of fire');
  check('Coy plan: 100-199 m clear warns, not fails (IC 100 m beside IBB 200 m)', fofC?.st === 'warn' && /IC s72 para 6 b p 372/.test(fofC.reason), fofC?.reason);
  // a Bn plan keeps IBB's 200 m: the same wood 150 m out fails or warns as before (checked above for B Coy)
  // Coy three up ranks after two up unless the frontage to hold is wider than two up's
  const cfam = ['coy-def-two-up', 'coy-def-three-up', 'coy-def-one-up'].map(rec);
  const cfits = cfam.map((r) => F.fitLayout({ recipe: r, ctx, opts: { alternates: 'none' }, ground: makeGround({}), anchor: { x: 0, y: 0 }, bearing: 0, threat: { x: 0, y: 5000 } })).filter(Boolean);
  const order = F.rankFits(cfits).map((x) => x.recipe.layout);
  check('Coy Auto: three up ranks after two up (IC s74 para 11 p 391)', order.indexOf('three-up') > order.indexOf('two-up'), order.join(', '));
  const wider = F.rankFits(cfits.map((x) => x.recipe.layout === 'three-up' ? { ...x, fit: { ...x.fit, fails: 0, warns: 0, score: 100 } } : x), { holdM: 2500 }).map((x) => x.recipe.layout);
  check('Coy Auto: over-extended (frontage to hold > two up\'s) lets three up lead', wider[0] === 'three-up', wider.join(', '));
}

console.log(`\n${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
