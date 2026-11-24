// revslope.mjs -- checks the reverse slope defence (MS/Engines/DeploymentBuilder/PlanRevSlope.ts) on synthetic ground:
// a ridge in front of a Bn Def two up, the posns moved behind it within MG range, OPs and FPF on the crest, the depth
// Coy onto the next high ground; flat ground gives an honest fail, no elevation an honest grey.
//   node tools/planbuilder-test/revslope.mjs          (add --quiet to print only failures and the summary)
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
const R = await import('../../MS/Engines/DeploymentBuilder/PlanRevSlope.ts');
const V = await import('../../MS/Engines/DeploymentBuilder/PlanRecipes.ts');

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

// ground: world = plan metres (anchor 0,0, north), a ridge across the front at y = ridgeY (40 m high, 250 m wide),
// a second ridge behind at y = backY; flat elsewhere at 200 m
const ground = ({ ridgeY = null, backY = null, known = true, high = 40 } = {}) => {
  const elev = (x, y) => {
    if (!known) return NaN;
    let e = 200;
    if (ridgeY !== null) e += high * Math.exp(-(((y - ridgeY) / 250) ** 2));
    if (backY !== null) e += 20 * Math.exp(-(((y - backY) / 200) ** 2));
    return e;
  };
  return {
    cls: () => (known ? 2 : null), elev, going: goingOf, label: (c) => `C${c}`,
    // sight: blocked when the line passes a point higher than both ends' line of sight (a crest between)
    sight(ox, oy, e, tx, ty, t) {
      if (!known) return null;
      const e0 = elev(ox, oy) + e, e1 = elev(tx, ty) + t;
      for (let s = 0.05; s < 0.95; s += 0.05) { const h = elev(ox + (tx - ox) * s, oy + (ty - oy) * s); if (h > e0 + (e1 - e0) * s + 0.5) return 0.05; }
      return 0.95;
    },
    pending: () => false, dataLine: () => 'synthetic ground',
  };
};
const frameFor = (res) => ({ anchor: { x: 0, y: 0 }, bearing: 0, k: 1, pivot: res.items.find((i) => i.id === res.pivotId).pts[0] });
// world y of a plan y (the anchor at 0,0 facing north: world = plan - pivot)
const wy = (f, y) => y - f.pivot.y;
const bn = rec('bn-def-rev-slope'), coy = rec('coy-def-rev-slope');

// the recipes validate and lay as the two up ones with a crest line, OPs and FPF
{
  const issues = V.validateRecipe(bn, { doc, symbols: ctx.symbols }).filter((i) => i.level === 'fail');
  check('bn-def-rev-slope validates', !issues.length, issues.map((i) => i.msg).join('; '));
  const res = S.solveRecipe(bn, ctx);
  check('geometry: the crest line, two OPs and two FPF targets laid ahead of the forward Coys', ['crest', 'crestOp1', 'crestOp2', 'fpf1', 'fpf2'].every((r) => res.items.some((i) => i.role === r)) && res.items.find((i) => i.role === 'crest').pts[0].y > Math.max(...res.items.filter((i) => i.role === 'fwdL' || i.role === 'fwdR').flatMap((i) => i.pts.map((p) => p.y))), res.items.map((i) => i.role).join(','));
  check('geometry: Frontage and Depth rows as the two up layout', row(res.rows, 'Frontage')?.st === 'pass' && !!row(res.rows, 'Depth'));
}

// a ridge 600 m in front of the forward Coys' front edge: the plan moves up behind it
{
  const res = S.solveRecipe(bn, ctx);
  const f = frameFor(res);
  const front = Math.max(...res.items.filter((i) => i.role === 'fwdL' || i.role === 'fwdR').flatMap((i) => i.pts.map((p) => p.y)));
  const g = ground({ ridgeY: wy(f, front) + 600, backY: wy(f, front) - 2600 });
  const rs = R.findReverseSlope(res, f, g, doc);
  check('ridge 600 m ahead: the crest is found and read 30-50 m high', rs.crest && rs.crestRiseM >= 30 && rs.crestRiseM <= 45, `${rs.crestRiseM} m`);
  check('...the FDL ends up behind the crest within MG range (150-457 m)', rs.fdlBehindM >= 150 && rs.fdlBehindM <= 457 && row(rs.rows, 'Behind the crest')?.st === 'pass', `${rs.fdlBehindM} m: ${row(rs.rows, 'Behind the crest')?.reason}`);
  check('...the whole plan moved forward the same way (fwd, depth, res, HQ, mortars; not the crest OPs / FPF)', ['fwdL', 'fwdR', 'res', 'mor', 'hq'].every((r) => rs.nudges[r] && Math.abs(rs.nudges[r].y - rs.nudges.fwdL.y) < 1) && rs.nudges.fwdL.y > 100 && !rs.nudges.crestOp1 && !rs.nudges.fpf1, JSON.stringify(rs.nudges.fwdL));
  check('...the crest line and the OPs laid on the real crest', rs.geom.crest && Math.abs(rs.geom.crest.pts[0].y - (front + 600)) < 60 && rs.geom.crestOp1 && Math.abs(rs.geom.crestOp1.pts[0].y - (front + 600)) < 60, `${rs.geom.crest?.pts[0].y} vs ${front + 600}`);
  check('...FPF on the crest (the FDL less than 500 m behind it)', row(rs.rows, 'FPF')?.st === 'pass' && Math.abs(rs.geom.fpf1.pts[0].y - (front + 600)) < 60, row(rs.rows, 'FPF')?.reason);
  check('...hidden from his side: the posns behind the ridge are not seen from 1.5 km beyond it', row(rs.rows, 'Hidden from the En side')?.st === 'pass', row(rs.rows, 'Hidden from the En side')?.reason);
  const dRow = rs.rows.find((r) => /on high ground/.test(r.name));
  check('...the depth Coy onto the next high ground behind', dRow?.st === 'pass' && rs.nudges.depth && rs.nudges.depth.y < rs.nudges.fwdL.y, dRow?.reason);
  check('...Crest held: OPs by day, the crest in strength by night (IC p 430 / IBB p 358); confirm list names the dummy posns and the AT weapons in depth', row(rs.rows, 'Crest held')?.st === 'pass' && rs.confirm.some((c) => /Dummy/.test(c)) && rs.confirm.some((c) => /Anti-tank/.test(c)));
}

// a ridge 1.3 km ahead: the plan still moves, the FDL held to 457 m behind the crest
{
  const res = S.solveRecipe(bn, ctx);
  const f = frameFor(res);
  const front = Math.max(...res.items.filter((i) => i.role === 'fwdL' || i.role === 'fwdR').flatMap((i) => i.pts.map((p) => p.y)));
  const rs = R.findReverseSlope(res, f, ground({ ridgeY: wy(f, front) + 1300 }), doc);
  check('ridge 1.3 km ahead: the plan moves up so the FDL is 457 m behind the crest, no further', rs.crest && Math.abs(rs.fdlBehindM - 457) < 40 && rs.nudges.fwdL.y > 700, `${rs.fdlBehindM} m, moved ${rs.nudges.fwdL?.y}`);
}

// flat ground: an honest fail; no elevation: grey
{
  const res = S.solveRecipe(bn, ctx);
  const f = frameFor(res);
  const flat = R.findReverseSlope(res, f, ground({}), doc);
  check('flat ground: Crest fails with why and fix (take a forward-slope layout), nothing moved', row(flat.rows, 'Crest')?.st === 'fail' && !!row(flat.rows, 'Crest')?.detail?.fix?.length && !Object.keys(flat.nudges).length, row(flat.rows, 'Crest')?.reason);
  const none = R.findReverseSlope(res, f, ground({ known: false }), doc);
  check('no elevation: Crest not checked (grey), never pass', row(none.rows, 'Crest')?.st === 'unchecked' && !none.rows.some((r) => r.st === 'pass'));
}

// the Coy version
{
  const res = S.solveRecipe(coy, ctx);
  const f = frameFor(res);
  const front = Math.max(...res.items.filter((i) => i.role === 'fwdL' || i.role === 'fwdR').flatMap((i) => i.pts.map((p) => p.y)));
  const rs = R.findReverseSlope(res, f, ground({ ridgeY: wy(f, front) + 500, backY: wy(f, front) - 1100, high: 25 }), doc);
  check('Coy Def reverse slope: crest found, Pls behind it within MG range, the reserve Pl on the high ground behind', rs.crest && row(rs.rows, 'Behind the crest')?.st === 'pass' && rs.rows.find((r) => /on high ground/.test(r.name))?.st === 'pass', rs.rows.map((r) => `${r.name} ${r.st}`).join(', '));
}

// the crest finder itself
{
  const prof = (ys) => ys.map((y, i) => ({ y: i * 30, e: y }));
  check('crestOnProfile: the highest rise that falls again beyond it', R.crestOnProfile(prof([200, 205, 215, 230, 240, 235, 225, 210, 205, 200, 200]), 8, 300)?.y === 120);
  check('crestOnProfile: a slope that keeps rising is no crest', R.crestOnProfile(prof([200, 210, 220, 230, 240, 250, 260, 270]), 8, 300) === null);
  check('crestOnProfile: a rise under the gain is no crest', R.crestOnProfile(prof([200, 203, 205, 204, 202, 200, 200]), 8, 300) === null);
}


// ── through PlanFit.fitLayout: the crest rows join the defence's, the plan moved behind the crest ───────────────────
{
  const F = await import('../../MS/Engines/DeploymentBuilder/PlanFit.ts');
  const res0 = S.solveRecipe(bn, ctx);
  const f0 = frameFor(res0);
  const front = Math.max(...res0.items.filter((i) => i.role === 'fwdL' || i.role === 'fwdR').flatMap((i) => i.pts.map((p) => p.y)));
  const g = ground({ ridgeY: wy(f0, front) + 600, backY: wy(f0, front) - 2600 });
  const fl = F.fitLayout({ recipe: bn, ctx, opts: {}, ground: g, anchor: { x: 0, y: 0 }, bearing: 0, threat: null, terrain: 'plains' });
  check('fitLayout, reverse slope: the crest rows join the defence rows, the crest on the fit, the FDL within MG range of it', !!fl && row(fl.res.rows, 'Crest')?.st === 'pass' && row(fl.res.rows, 'Behind the crest')?.st === 'pass' && !!fl.fit.revSlope?.crest && fl.fit.revSlope.fdlBehindM <= 457 && !!row(fl.res.rows, 'Frontage'), fl ? fl.res.rows.map((r) => `${r.name} ${r.st}`).join(', ') : 'null');
  const fof = row(fl.res.rows, 'Fields of fire');
  check('...Fields of fire read the reverse slope way: FDL to the crest, pass, the ground beyond named as the price; only one such row', fof?.st === 'pass' && /a reverse slope: .* from the FDL to the crest/.test(fof.reason) && /para 2 b/.test(fof.reason) && fl.res.rows.filter((r) => r.name === 'Fields of fire').length === 1, fof?.reason);
  check('...the score counts that row, not the forward-slope one (no Fields of fire fail drags it)', fl.fit.score >= 0 && !fl.res.rows.some((r) => r.name === 'Fields of fire' && r.st === 'fail'), String(fl.fit.score));
  const crest = fl.raw.items.find((i) => i.role === 'crest');
  check('...the crest line drawn on the real crest, the OPs and FPF on it', !!crest && Math.abs(crest.pts[0].y - (front + 600)) < 60 && fl.raw.items.some((i) => i.role === 'crestOp1') && fl.raw.items.some((i) => i.role === 'fpf1'), crest ? `${Math.round(crest.pts[0].y)} vs ${front + 600}` : 'no crest');
}

console.log(`\n${n - fails} of ${n} checks passed`);
process.exit(fails ? 1 : 0);
