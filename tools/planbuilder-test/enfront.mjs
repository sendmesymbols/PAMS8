// enfront.mjs -- the En marked as a front line or an area (MS/Engines/DeploymentBuilder/PlanEnFront.ts) and the plan
// laid according to its curvature (PlanFit step 0, frontNudges for geometry mode).
//   node tools/planbuilder-test/enfront.mjs          (add --quiet to print only failures and the summary)
// The world is Web Mercator round 0,0 (k = 1: a metre is a metre); the plan's HQ at 0,0 faces north.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
const F = await import('../../MS/Engines/DeploymentBuilder/PlanFit.ts');
const E = await import('../../MS/Engines/DeploymentBuilder/PlanEnFront.ts');

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
const open = {
  cls: () => 2, elev: () => 200, going: goingOf, label: () => 'Open', sight: () => 0.9,
  avenues: (from, to) => [{ path: [from, to], lengthM: Math.hypot(from.x - to.x, from.y - to.y), goPct: 90, minWidthM: 1500, chokes: [] }],
  pending: () => false, dataLine: () => 'synthetic',
};
const frameFor = (res, bearing = 0) => ({ anchor: { x: 0, y: 0 }, bearing, k: 1, pivot: res.items.find((i) => i.id === res.pivotId).pts[0] });
const row = (rows, name) => rows.find((r) => r.name === name);
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ── pure: geometry ─────────────────────────────────────────────────────────────────────────────────────────────────
const straight = { kind: 'line', pts: [{ x: -6000, y: 3000 }, { x: 6000, y: 3000 }] };
check('valid: a line needs 2 points, an area 3', E.frontValid(straight) && !E.frontValid({ kind: 'area', pts: straight.pts }));
const nn = E.nearestOnFront(straight, { x: 500, y: 0 });
check('nearest on a line: straight ahead, 3 km', near(nn.at.x, 500, 1) && near(nn.dM, 3000, 1), JSON.stringify(nn));
const box = { kind: 'area', pts: [{ x: -2000, y: 2000 }, { x: 2000, y: 2000 }, { x: 2000, y: 5000 }, { x: -2000, y: 5000 }] };
check('inside an area: distance 0', E.nearestOnFront(box, { x: 0, y: 3000 }).inside && E.nearestOnFront(box, { x: 0, y: 3000 }).dM === 0);
const b0 = E.faceBearing(straight, { x: 0, y: 0 }, 3000);
check('faces a straight line square (north)', b0 !== null && near(b0, 0, 0.01), String(b0));
const slanted = { kind: 'line', pts: [{ x: -6000, y: -3000 }, { x: 6000, y: 9000 }] };   // runs SW-NE, 45 deg
const b1 = E.faceBearing(slanted, { x: 2000, y: 0 }, 3000);
check('faces a slanted line square to it (NW, -45 deg)', b1 !== null && near(b1, -Math.PI / 4, 0.06), String(b1 && (b1 * 180) / Math.PI));
check('no facing from inside his area', E.faceBearing(box, { x: 0, y: 3000 }, 2000) === null);
const fp = E.facePoint(straight, { x: 0, y: 0 }, 3000);
check('face point 5 km out along the bearing', fp && near(fp.x, 0, 1) && near(fp.y, 5000, 1));
// a salient pointing at the plan turns it toward the salient's tip even when off the axis
const salientLine = { kind: 'line', pts: [{ x: -6000, y: 3000 }, { x: 600, y: 3000 }, { x: 1000, y: 1600 }, { x: 1400, y: 3000 }, { x: 6000, y: 3000 }] };
const b2 = E.faceBearing(salientLine, { x: 0, y: 0 }, 2000);
check('a salient off to the right turns the plan toward it', b2 !== null && b2 > 0.05, String(b2 && (b2 * 180) / Math.PI));
const simp = E.simplifyFront({ kind: 'line', pts: Array.from({ length: 1000 }, (_, i) => ({ x: i * 10, y: Math.sin(i / 50) * 400 })) }, 15, 200);
check('simplified to at most 200 points', simp.pts.length <= 200 && simp.pts.length >= 10, String(simp.pts.length));
const lf0 = { pts: straight.pts, closed: false };
check('ray ahead hits a line', near(E.rayAhead(lf0, 0, 1000), 2000, 1));
check('ray beside the line misses', E.rayAhead(lf0, 7000, 0) === null);
check('ray from inside an area is negative (back to its edge)', E.rayAhead({ pts: box.pts, closed: true }, 0, 2500) < 0);

// ── fit: a bowed front (his line comes nearer opposite B Coy) ─────────────────────────────────────────────────────
const r2 = rec('bn-def-two-up');
const base = S.solveRecipe(r2, ctx, { alternates: 'none' });
const fr = frameFor(base);
const A = base.slots.find((s) => s.role === 'fwdL'), B = base.slots.find((s) => s.role === 'fwdR');
const frontY = Math.max(A.centre.y + A.hM / 2, B.centre.y + B.hM / 2);
// fronts below are written in plan metres and turned into world points
const inW = (f) => ({ kind: f.kind, pts: f.pts.map((p) => F.toWorld(fr, p)) });
// his line 2 km ahead of the FDL on the axis and opposite A Coy, 1.6 km ahead opposite B Coy (a bow toward B)
const bowed = inW({ kind: 'line', pts: [{ x: -8000, y: frontY + 2000 }, { x: A.centre.x, y: frontY + 2000 }, { x: 0, y: frontY + 2000 }, { x: B.centre.x, y: frontY + 1600 }, { x: 8000, y: frontY + 1600 }] });
const fitB = F.fitPlan({ res: base, recipe: r2, doc, frame: fr, ground: open, threat: null, front: bowed });
const nB = fitB.nudges.fwdR, nA = fitB.nudges.fwdL;
check('B Coy, where his front comes nearer, moves back about 400 m', nB && near(nB.y, -400, 30) && near(nB.x, 0, 1), JSON.stringify(nB));
check('A Coy, already at the stand-off, stays', !nA || near(nA.y, 0, 30), JSON.stringify(nA));
const dep = r2.slots.find((s) => s.kind === 'depth');
const dB = base.slots.filter((s) => s.kind === 'depth' || s.kind === 'res').find((s) => Math.abs(s.centre.x - B.centre.x) <= B.wM / 2);
if (dB) check('the depth posn behind B Coy moves back with it', fitB.nudges[dB.role] && near(fitB.nudges[dB.role].y, nB.y, 1), JSON.stringify(fitB.nudges[dB.role]));
else check('a depth posn backs B Coy in the annex layout', !!dep && false, 'none found behind B');
const so = row(fitB.rows, 'Stand-off');
check('Stand-off row passes after the move and says what moved', so?.st === 'pass' && /back 400 m/.test(so.reason), so?.reason);
check('En front row: across the front, no flank wrap', row(fitB.rows, 'En front')?.st === 'pass', row(fitB.rows, 'En front')?.reason);
check('the approaches start on his front, not assumed', fitB.fromAssumed === false && near(F.toLocal(fr, fitB.from).y, frontY + 2000, 50), JSON.stringify(fitB.from));
check('stand-off links drawn for the forward posns', (fitB.standLinks ?? []).length === 2 && fitB.standLinks.every((l) => near(l.dM, 2000, 40)), JSON.stringify(fitB.standLinks?.map((l) => l.dM)));
const re = S.solveRecipe(r2, ctx, { alternates: 'none', nudges: fitB.nudges });
const Bn = re.slots.find((s) => s.role === 'fwdR');
check('the solver lays B Coy where the fit moved it, size kept', near(Bn.centre.y, B.centre.y - 400, 30) && Bn.wM === B.wM && Bn.hM === B.hM);

// the move is capped (PlanDoctrine fit.enFront.moveM.bn 600) and says so
const steep = inW({ kind: 'line', pts: [{ x: -8000, y: frontY + 2000 }, { x: 0, y: frontY + 2000 }, { x: B.centre.x, y: frontY + 900 }, { x: 8000, y: frontY + 900 }] });
const fitS = F.fitPlan({ res: base, recipe: r2, doc, frame: fr, ground: open, threat: null, front: steep });
check('a 1100 m bow moves B Coy no more than 600 m', fitS.nudges.fwdR && fitS.nudges.fwdR.y >= -601, JSON.stringify(fitS.nudges.fwdR));
check('the Stand-off row says the move was held and warns on the uneven line', /not moved/.test(row(fitS.rows, 'Stand-off')?.reason ?? '') || row(fitS.rows, 'Stand-off')?.st === 'warn', row(fitS.rows, 'Stand-off')?.reason);

// check my plan (checkOnly): read as drawn, no moves
const fitC = F.fitPlan({ res: base, recipe: r2, doc, frame: fr, ground: open, threat: null, front: bowed, checkOnly: true });
check('Check my plan reads the front without moving a posn', Object.keys(fitC.nudges).length === 0 && /read as drawn/.test(row(fitC.rows, 'Stand-off')?.reason ?? ''), row(fitC.rows, 'Stand-off')?.reason);

// geometry mode: the same moves without terrain
const geo = F.frontNudges(base, r2, doc, fr, bowed);
check('geometry mode: B Coy moves back as with the terrain', geo.nudges.fwdR && near(geo.nudges.fwdR.y, -400, 30), JSON.stringify(geo.nudges.fwdR));
check('geometry mode gives the En front and Stand-off rows', !!row(geo.rows, 'En front') && !!row(geo.rows, 'Stand-off'));

// an area: posn inside it fails; a salient of his toward A Coy warns (MW p 126); wrapping both flanks warns
const area = { kind: 'area', pts: [{ x: -8000, y: frontY + 300 }, { x: 8000, y: frontY + 300 }, { x: 8000, y: frontY + 4000 }, { x: -8000, y: frontY + 4000 }] };
const fitIn = F.fitPlan({ res: base, recipe: r2, doc, frame: fr, ground: open, threat: null, front: inW({ kind: 'area', pts: [{ x: -8000, y: frontY - 200 }, { x: 8000, y: frontY - 200 }, { x: 8000, y: frontY + 4000 }, { x: -8000, y: frontY + 4000 }] }), checkOnly: true });
check('forward posns inside the En area fail', row(fitIn.rows, 'Stand-off')?.st === 'fail', row(fitIn.rows, 'Stand-off')?.reason);
const knoll = inW({ kind: 'area', pts: [{ x: -8000, y: frontY + 2000 }, { x: A.centre.x - 500, y: frontY + 2000 }, { x: A.centre.x, y: frontY + 1200 }, { x: A.centre.x + 500, y: frontY + 2000 }, { x: 8000, y: frontY + 2000 }, { x: 8000, y: frontY + 5000 }, { x: -8000, y: frontY + 5000 }] });
const fitK = F.fitPlan({ res: base, recipe: r2, doc, frame: fr, ground: open, threat: null, front: knoll });
check('a salient of his opposite A Coy is named, MW p 126', /salient/.test(row(fitK.rows, 'En front')?.reason ?? '') && /MW p 126/.test(row(fitK.rows, 'En front')?.reason ?? '') && row(fitK.rows, 'En front').st === 'warn', row(fitK.rows, 'En front')?.reason);
check('A Coy steps back from the salient', fitK.nudges.fwdL && fitK.nudges.fwdL.y < -100, JSON.stringify(fitK.nudges.fwdL));
const xs = base.slots.filter((s) => s.kind === 'fwd');
const lx = Math.min(...xs.map((s) => s.centre.x - s.wM / 2)), rx = Math.max(...xs.map((s) => s.centre.x + s.wM / 2));
const horseshoe = inW({ kind: 'area', pts: [{ x: lx - 1500, y: frontY - 1500 }, { x: lx - 600, y: frontY - 1500 }, { x: lx - 600, y: frontY + 1500 }, { x: rx + 600, y: frontY + 1500 }, { x: rx + 600, y: frontY - 1500 }, { x: rx + 1500, y: frontY - 1500 }, { x: rx + 1500, y: frontY + 5000 }, { x: lx - 1500, y: frontY + 5000 }] });
const fitH = F.fitPlan({ res: base, recipe: r2, doc, frame: fr, ground: open, threat: null, front: horseshoe, checkOnly: true });
check('his area level with the FDL beside both flanks: the plan in a salient (MW p 126 para 3 c)', /salient of the En front/.test(row(fitH.rows, 'En front')?.reason ?? '') && row(fitH.rows, 'En front').st === 'warn', row(fitH.rows, 'En front')?.reason);
check('the area\'s depth opposite the plan is read', /deep opposite/.test(row(fitK.rows, 'En front')?.reason ?? ''), row(fitK.rows, 'En front')?.reason);
void area;

// all round: no moves (it faces every way)
const rr = rec('bn-def-all-round');
const resR = S.solveRecipe(rr, ctx, { alternates: 'none' });
const fitR = F.fitPlan({ res: resR, recipe: rr, doc, frame: frameFor(resR), ground: open, threat: null, front: bowed });
check('an all-round defence is not reshaped', Object.values(fitR.nudges).every((v) => !v || near(v.y, 0, 1) || true) && !Object.keys(F.frontNudges(resR, rr, doc, frameFor(resR), bowed).nudges).length);

// attack: own control measures inside his area fail
const ra = rec('bn-attk-frontal');
const atk = S.solveRecipe(ra, ctx, {});
const fa = frameFor(atk);
const fup = atk.items.find((i) => i.role === 'fup').pts.map((p) => F.toWorld(fa, p));
const cover = { kind: 'area', pts: [{ x: Math.min(...fup.map((p) => p.x)) - 200, y: Math.min(...fup.map((p) => p.y)) - 200 }, { x: Math.max(...fup.map((p) => p.x)) + 200, y: Math.min(...fup.map((p) => p.y)) - 200 }, { x: Math.max(...fup.map((p) => p.x)) + 200, y: Math.max(...fup.map((p) => p.y)) + 200 }, { x: Math.min(...fup.map((p) => p.x)) - 200, y: Math.max(...fup.map((p) => p.y)) + 200 }] };
const ar = F.attackFront(atk, fa, cover);
check('an attack whose FUP lies in the En area fails the En area row', row(ar, 'En area')?.st === 'fail', row(ar, 'En area')?.reason);

console.log(`\n${n - fails} / ${n} passed${fails ? `, ${fails} FAILED` : ''}`);
process.exit(fails ? 1 : 0);
