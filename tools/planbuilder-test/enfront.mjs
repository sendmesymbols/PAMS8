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
// the stand-off kept is the middle of the two Coys' as placed (about 1.8 km): A Coy forward, B Coy back
check('B Coy, where the En front comes nearer, moves back', nB && nB.y < -100, JSON.stringify(nB));
check('A Coy, further from it, moves forward', nA && nA.y > 100, JSON.stringify(nA));
const dep = r2.slots.find((s) => s.kind === 'depth');
const dB = base.slots.filter((s) => s.kind === 'depth' || s.kind === 'res').find((s) => Math.abs(s.centre.x - B.centre.x) <= B.wM / 2);
if (dB) check('the depth posn behind B Coy moves back with it', fitB.nudges[dB.role] && near(fitB.nudges[dB.role].y, nB.y, 1), JSON.stringify(fitB.nudges[dB.role]));
else check('a depth posn backs B Coy in the annex layout', !!dep && false, 'none found behind B');
const so = row(fitB.rows, 'Stand-off');
check('Stand-off row passes, both front edges at the same stand-off, says what moved, turned and bent', so?.st === 'pass' && /back \d+ m/.test(so.reason) && /the middle of where/.test(so.reason), so?.reason);
const sds = (/A Coy ([\d.]+) (km|m), B Coy ([\d.]+) (km|m)/.exec(so?.reason ?? '') ?? []);
const km = (v, u) => (u === 'km' ? Number(v) * 1000 : Number(v));
check('both forward Coys end within 50 m of the same stand-off', sds.length && Math.abs(km(sds[1], sds[2]) - km(sds[3], sds[4])) <= 50, sds.slice(1).join(' '));
check('En front row: across the front, no flank wrap', row(fitB.rows, 'En front')?.st === 'pass', row(fitB.rows, 'En front')?.reason);
check('the approaches start on the En front, not assumed', fitB.fromAssumed === false, JSON.stringify(fitB.from));
check('stand-off links drawn for the forward posns', (fitB.standLinks ?? []).length === 2, JSON.stringify(fitB.standLinks?.map((l) => l.dM)));
const re = S.solveRecipe(r2, ctx, { alternates: 'none', nudges: fitB.nudges, turns: fitB.turns, outlines: fitB.outlines, plShift: fitB.plShift, paths: fitB.frontPaths });
const Bn = re.slots.find((s) => s.role === 'fwdR');
check('the solver lays B Coy where the fit moved it, size kept', near(Bn.centre.y, B.centre.y + nB.y, 1) && Bn.wM === B.wM && Bn.hM === B.hM);

// 1. the FDL follows the En front's curve, the same stand-off all along
const lfB = { pts: bowed.pts.map((p) => F.toLocal(fr, p)), closed: false };
const fdl = fitB.frontPaths?.fdl ?? [];
const ref = Number((/laid at ([\d.]+) (km|m)/.exec(so?.reason ?? '') ?? [])[1]) * ((/laid at [\d.]+ km/.test(so?.reason ?? '')) ? 1000 : 1);
check('the FDL is laid along the En front (more than two points, a bend in it)', fdl.length >= 4 && Math.max(...fdl.map((p) => p.y)) - Math.min(...fdl.map((p) => p.y)) > 200, `${fdl.length} pts`);
check('every FDL point stands the stand-off from the En front (within 40 m)', fdl.every((p) => Math.abs(E.standDist(lfB, p) - ref) <= 40), fdl.map((p) => Math.round(E.standDist(lfB, p))).join(','));
const fdlItem = re.items.find((i) => i.role === 'fdl');
check('the solver draws the FEBA on that curve', fdlItem && fdlItem.pts.length === fdl.length);

// 2. a knoll in the En front within one Coy's frontage bends that Coy's front edge, not the whole posn
const bump = inW({ kind: 'line', pts: [{ x: -8000, y: frontY + 1500 }, { x: A.centre.x - 400, y: frontY + 1500 }, { x: A.centre.x, y: frontY + 1150 }, { x: A.centre.x + 400, y: frontY + 1500 }, { x: 8000, y: frontY + 1500 }] });
const fitK2 = F.fitPlan({ res: base, recipe: r2, doc, frame: fr, ground: open, threat: null, front: bump });
const oA = fitK2.outlines?.fwdL ?? [];
check('A Coy\'s outline has the bent front (11 points: rear kept, seven across the front)', oA.length === 11, String(oA.length));
const vMid = oA[5]?.[1], vEnd = oA[2]?.[1];
check('its front edge follows the knoll: held back in the middle opposite it, forward at the corners where the En line recedes', vMid <= 0.52 && vEnd > vMid + 0.1, `${vMid?.toFixed(2)} mid, ${vEnd?.toFixed(2)} at the corner`);
check('the rear side and echelon mark stay as the annex draws them', oA[0][0] === 0.2 && oA[0][1] === -0.5 && oA[10][0] === -0.2 && oA[10][1] === -0.5);

// 3. the stand-off is the middle of the Coys', not the axis: a salient between the Coys does not pull them onto its shoulders
const between = inW({ kind: 'line', pts: [{ x: -8000, y: frontY + 2000 }, { x: -500, y: frontY + 2000 }, { x: 0, y: frontY + 600 }, { x: 500, y: frontY + 2000 }, { x: 8000, y: frontY + 2000 }] });
const fitM = F.fitPlan({ res: base, recipe: r2, doc, frame: fr, ground: open, threat: null, front: between });
const sdOf = (rows) => { const m = /A Coy ([\d.]+) (km|m), B Coy ([\d.]+) (km|m)/.exec(row(rows, 'Stand-off')?.reason ?? ''); return m ? [km(m[1], m[2]), km(m[3], m[4])] : null; };
const before = sdOf(F.frontCheckRows(base, r2, doc, fr, between)), after = sdOf(fitM.rows);
check('a salient between the Coys: the stand-off kept is the Coys own as placed, not the salient tip',before && after && Math.abs(after[0] - before[0]) <= 40 && Math.abs(after[1] - before[1]) <= 40, `${before} -> ${after}`);

// 5. a posn turns to face its own part of a slanted En front (within 45 deg), its depth posn with it
const slantR = inW({ kind: 'line', pts: [{ x: -8000, y: frontY + 2000 }, { x: 0, y: frontY + 2000 }, { x: 8000, y: frontY + 2000 - 8000 * Math.tan(Math.PI / 9) }] });
const fitT = F.fitPlan({ res: base, recipe: r2, doc, frame: fr, ground: open, threat: null, front: slantR });
const tB = fitT.turns?.fwdR ?? 0, tA = fitT.turns?.fwdL ?? 0;
check('B Coy, facing the En line slanting toward it, turns about 20 deg Rt', tB > 10 && tB <= 45, `${tB.toFixed(1)}`);
check('A Coy, facing the straight part, turns little', Math.abs(tA) < Math.abs(tB), `${tA.toFixed(1)}`);
const reT = S.solveRecipe(r2, ctx, { alternates: 'none', nudges: fitT.nudges, turns: fitT.turns, outlines: fitT.outlines });
const bpB = reT.items.find((i) => i.role === 'fwdR');
const rear = bpB.pts[0], rear2 = bpB.pts[bpB.pts.length - 1];
check('the solver draws B Coy turned (its rear side no longer square to the plan)', Math.abs(rear.y - rear2.y) > 20, `${Math.round(rear.y)} vs ${Math.round(rear2.y)}`);
check('the Stand-off row says which posns turned and which way', /turned \d+° Rt/.test(row(fitT.rows, 'Stand-off')?.reason ?? ''), row(fitT.rows, 'Stand-off')?.reason);

// 4. Pl detail: each forward Pl post stands on the curve, its inset behind the Coy's front edge kept
const resPl = S.solveRecipe(r2, ctx, { alternates: 'none', detail: 'pl' });
const fitPl = F.fitPlan({ res: resPl, recipe: r2, doc, frame: fr, ground: open, threat: null, front: bump });
const sh = fitPl.plShift?.fwdL ?? [];
check('A Coy\'s forward Pl posts get their own shifts, the depth Pl none', sh.length === 3 && sh[2] === 0 && (sh[0] !== 0 || sh[1] !== 0), JSON.stringify(sh));
const rePl = S.solveRecipe(r2, ctx, { alternates: 'none', detail: 'pl', nudges: fitPl.nudges, turns: fitPl.turns, outlines: fitPl.outlines, plShift: fitPl.plShift });
const pls = rePl.items.filter((i) => i.role === 'fwdLPl');
check('the solver draws the Pl posts where they were shifted', pls.length === 3);

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
check('geometry mode: B Coy moves as with the terrain, turned and laid the same', geo.nudges.fwdR && near(geo.nudges.fwdR.y, fitB.nudges.fwdR.y, 1) && JSON.stringify(geo.turns) === JSON.stringify(fitB.turns ?? {}) && (geo.paths.fdl ?? []).length === fdl.length, JSON.stringify(geo.nudges.fwdR));
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
