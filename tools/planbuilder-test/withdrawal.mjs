// withdrawal.mjs -- checks the Bn withdrawal (MS/Engines/DeploymentBuilder/PlanWithdrawal.ts, recipe bn-wdr-night):
// the geometry (control points, embussing points, the intermediate and new main posns), and on synthetic ground the
// routes round a lake, embussing points onto a track, the intermediate posn against his guns and behind a canal, his
// view of the routes, and the programme from last light.
//   node tools/planbuilder-test/withdrawal.mjs          (add --quiet to print only failures and the summary)
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
const Wd = await import('../../MS/Engines/DeploymentBuilder/PlanWithdrawal.ts');
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
const item = (res, role) => res.items.find((i) => i.role === role);
const centre = (pts) => ({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length });
const wdr = rec('bn-wdr-night');

// ground in world metres (anchor 0,0 facing the way of withdrawal: world = plan - pivot; the pivot is the HQ at 0,0)
const ground = ({ lake = null, canalY = null, trackX = null, known = true } = {}) => {
  const inRect = (r, x, y) => r && x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
  const cls = (x, y) => {
    if (!known) return null;
    if (inRect(lake, x, y)) return 4;
    if (canalY !== null && Math.abs(y - canalY) < 40) return 20;
    if (trackX !== null && Math.abs(x - trackX) < 12) return 36;
    return 2;
  };
  return {
    cls, elev: () => (known ? 200 : NaN), going: goingOf, label: (c) => `C${c}`,
    sight(ox, oy, e, tx, ty) { if (!known) return null; for (let t = 0.02; t < 0.98; t += 0.02) if (cls(ox + (tx - ox) * t, oy + (ty - oy) * t) === 4) return 0.1; return 0.9; },
    avenues(from, to) {
      if (!known) return null;
      // a lake in the way: go round its left edge
      const path = [from];
      if (lake) { const minX = lake[0] - 100; const yA = Math.min(from.y, to.y), yB = Math.max(from.y, to.y); if (lake[1] < yB && lake[3] > yA && from.x > lake[0] - 100 && from.x < lake[2] + 100) { path.push({ x: minX, y: from.y }, { x: minX, y: to.y }); } }
      path.push(to);
      return [{ path, lengthM: 0, goPct: 90, minWidthM: 500, chokes: [] }];
    },
    pending: () => false, dataLine: () => 'synthetic ground',
  };
};
const frameFor = (res) => ({ anchor: { x: 0, y: 0 }, bearing: 0, k: 1, pivot: item(res, 'hq').pts[0] });

// ── the recipe and its geometry ──────────────────────────────────────────────────────────────────────────────────────
{
  const issues = V.validateRecipe(wdr, { doc, symbols: ctx.symbols }).filter((i) => i.level === 'fail');
  check('bn-wdr-night validates', !issues.length, issues.map((i) => i.msg).join('; '));
  const res = S.solveRecipe(wdr, ctx);
  check('the old posn: A and B Coys forward (toward the enemy, -y), C and D behind; rear parties on the forward Coys', centre(item(res, 'fwdL').pts).y < 0 && centre(item(res, 'depth').pts).y > centre(item(res, 'fwdL').pts).y && item(res, 'rpA') && Math.abs(item(res, 'rpA').pts[0].y - centre(item(res, 'fwdL').pts).y) < 50);
  const epA = item(res, 'epA'), fwdC = centre(item(res, 'fwdL').pts).y;
  check('Coy embussing points 1500-2000 m behind the forward Coys on their routes (IBB p 383)', epA.pts[0].y - fwdC >= 1500 && epA.pts[0].y - fwdC <= 2000, `${Math.round(epA.pts[0].y - fwdC)} m`);
  check('control points: Coy RVs, Bn CP, Bn RV, Bn EP, the covering Pl; the routes dotted (00000007)', ['rvA', 'rvB', 'rvC', 'rvD', 'cp', 'bnRv', 'epBn', 'covPl'].every((r) => item(res, r)) && ['rtA', 'rtB', 'rtC', 'rtD'].every((r) => item(res, r)?.key === '00000007'));
  check('the intermediate posn (planned Coy) 17.2 km back, the new main posn (planned Bn) 25 km back, the artillery 5-6 km back', Math.abs(centre(item(res, 'intPosn').pts).y - 17200) < 50 && Math.abs(centre(item(res, 'newMain').pts).y - 25000) < 50 && centre(item(res, 'artyNew').pts).y - centre(item(res, 'res').pts).y >= 5000);
  // the aim: the new main posn at the aimed distance, the intermediate posn held back from it
  const g12 = Wd.withdrawalGeom(wdr, doc, 12000);
  check('aimed 12 km: the new main posn at 12 km, the intermediate posn 3 km short of it (not 17.2 km)', Math.abs(centre(g12.newMain.pts).y - 12000) < 1 && Math.abs(centre(g12.intPosn.pts).y - 9000) < 1, `${centre(g12.intPosn.pts).y}`);
  const g40 = Wd.withdrawalGeom(wdr, doc, 40000);
  check('aimed 40 km: the intermediate posn at his field artillery range, 17.2 km', Math.abs(centre(g40.intPosn.pts).y - 17200) < 1);
}

// ── on the ground ────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const res = S.solveRecipe(wdr, ctx);
  const f = frameFor(res);
  const fd = Wd.findWithdrawal(res, f, ground({ trackX: -1000, canalY: 12000 }), doc, {});
  const names = fd.rows.map((r) => r.name);
  check('rows: Embussing points, Routes hidden, Routes, Intermediate posn, Behind an obstacle, New main posn, Artillery, Rear parties, Covering Pl, Timings', ['Embussing points', 'Routes hidden', 'Routes', 'Intermediate posn', 'Behind an obstacle', 'New main posn', 'Artillery', 'Rear parties', 'Covering Pl', 'Timings'].every((x) => names.includes(x)), names.join(', '));
  check('EP A on the track at x = -1000: pass, no move; EP B 300 m from no track: said', row(fd.rows, 'Embussing points')?.st === 'pass' && !fd.nudges.epA && /EP A .*on a track/.test(row(fd.rows, 'Embussing points')?.reason) && /EP B .*no track/.test(row(fd.rows, 'Embussing points')?.reason), row(fd.rows, 'Embussing points')?.reason);
  check('the intermediate posn 17.2 km back passes against his 105 mm IFG (IBB p 373)', row(fd.rows, 'Intermediate posn')?.st === 'pass' && /105 mm IFG/.test(row(fd.rows, 'Intermediate posn')?.reason), row(fd.rows, 'Intermediate posn')?.reason);
  check('a canal 12 km back lies in front of it: Behind an obstacle passes', row(fd.rows, 'Behind an obstacle')?.st === 'pass', row(fd.rows, 'Behind an obstacle')?.reason);
  check('Artillery repositioned 5-6 km back: pass (IBB p 385)', row(fd.rows, 'Artillery')?.st === 'pass', row(fd.rows, 'Artillery')?.reason);
  check('four routes read with their night times (3 km/h, IBB p 18); A Coy about 1.75 km, 35 min', fd.routes.length === 4 && fd.routes.find((r) => r.role === 'rtA').min >= 30 && fd.routes.find((r) => r.role === 'rtA').min <= 40, fd.routes.map((r) => `${r.role} ${r.lengthM} m ${r.min} min`).join('; '));
  const t = (label) => fd.times.find((x) => x.label.startsWith(label));
  check('the programme from last light (IBB pp 379-380): echelons +15, control points +105, depth Coys +135, rear parties +165, denial +180, the forward Coys clear their EPs after their march', t('A and B echelons')?.atMin === 15 && t('Checkpoints')?.atMin === 105 && t('Depth Coys')?.atMin === 135 && t('Rear parties in')?.atMin === 165 && t('Time of denial')?.atMin === 180 && t('Forward Coys clear')?.atMin > 180, fd.times.map((x) => `${x.atMin} ${x.label.slice(0, 20)}`).join(' | '));
  check('Routes hidden passes on open ground with nothing in his view blocked... (sight 0.9 everywhere: seen) -> warn, honest', row(fd.rows, 'Routes hidden')?.st === 'warn', row(fd.rows, 'Routes hidden')?.reason);
  check('Rear parties and the covering Pl rows pass; the confirm list names the walked routes and the demolitions', row(fd.rows, 'Rear parties')?.st === 'pass' && row(fd.rows, 'Covering Pl')?.st === 'pass' && fd.confirm.some((c) => /walked by day/.test(c)) && fd.confirm.some((c) => /Demolitions/.test(c)));
  check('hhmm: 180 min from a 2000 last light reads 2300', Wd.hhmm(20 * 60 + 180) === '2300');
}

// a lake on A Coy's route: the route goes round it and takes longer; his guns reaching further: the intermediate posn warns
{
  const res = S.solveRecipe(wdr, ctx);
  const f = frameFor(res);
  const aWorld = { x: -1000, y: 0 };
  const lake = [aWorld.x - 250, 400 - f.pivot.y, aWorld.x + 250, 900 - f.pivot.y];
  const fd = Wd.findWithdrawal(res, f, ground({ lake }), doc, { enFieldArtyM: 22000, enFieldArtySrc: 'his 130 mm (SP) Gun, 22 km' });
  const rtA = fd.routes.find((r) => r.role === 'rtA'), rtB = fd.routes.find((r) => r.role === 'rtB');
  check('a lake on A Coy\'s route: the route bends round it and is longer than B Coy\'s', fd.paths.rtA.length > 3 && rtA.lengthM > rtB.lengthM + 300, `${rtA.lengthM} vs ${rtB.lengthM}`);
  check('his 130 mm guns reach 22 km: the intermediate posn 17.2 km back warns with why and fix', row(fd.rows, 'Intermediate posn')?.st === 'warn' && /130 mm/.test(row(fd.rows, 'Intermediate posn')?.reason) && row(fd.rows, 'Intermediate posn')?.detail?.fix?.length > 0, row(fd.rows, 'Intermediate posn')?.reason);
  check('no canal between: Behind an obstacle warns (IC p 482)', row(fd.rows, 'Behind an obstacle')?.st === 'warn');
  const hidden = Wd.findWithdrawal(res, f, ground({ lake }), doc, { threat: { x: -1000, y: -1500 - f.pivot.y } });
  check('the lake between his marker and A Coy\'s route hides part of it: fewer % seen than with no lake', (hidden.routes.find((r) => r.role === 'rtA').seenPct ?? 100) < 100);
}

// no ground data: grey, never pass
{
  const res = S.solveRecipe(wdr, ctx);
  const fd = Wd.findWithdrawal(res, frameFor(res), ground({ known: false }), doc, {});
  check('no ground: Routes hidden and Behind an obstacle not checked (grey)', row(fd.rows, 'Routes hidden')?.st === 'unchecked' && row(fd.rows, 'Behind an obstacle')?.st === 'unchecked');
}


// ── through PlanFit.fitLayout, and Check my plan as drawn ───────────────────────────────────────────────────────────
{
  const F = await import('../../MS/Engines/DeploymentBuilder/PlanFit.ts');
  const g = ground({ trackX: -1000, canalY: 12000 });
  const inp = { recipe: wdr, ctx, opts: {}, ground: g, anchor: { x: 0, y: 0 }, bearing: 0, threat: null, terrain: 'plains', cursor: { x: 0, y: 20000 } };
  const fl = F.fitLayout(inp);
  check('fitLayout dispatches a withdrawal: terrain mode, the reading on the fit, the new main posn at the aimed 20 km', !!fl && fl.res.mode === 'terrain' && !!fl.fit.withdrawal && Math.abs(centre(item(fl.raw, 'newMain').pts).y - 20000) < 60, fl ? `${Math.round(centre(item(fl.raw, 'newMain').pts).y)}` : 'null');
  check('...rows merged: Embussing points, Intermediate posn, Behind an obstacle, Timings, Routes; the routes on the fit', ['Embussing points', 'Intermediate posn', 'Behind an obstacle', 'Timings', 'Routes'].every((x) => row(fl.res.rows, x)) && fl.fit.withdrawal.routes.length === 4, fl.res.rows.map((r) => r.name).join(', '));
  const drawn = {};
  for (const i of fl.raw.items) if (!drawn[i.role]) drawn[i.role] = { pts: i.pts.map((p) => { const w = F.toWorld(fl.frame, p); return [w.x, w.y]; }) };
  const ck = Wd.checkWithdrawal(inp, drawn);
  check('Check my plan, withdrawal: read as drawn, the same verdicts as built, nothing missing', !!ck && ['Embussing points', 'Intermediate posn', 'Behind an obstacle', 'Artillery', 'Rear parties'].every((x) => row(ck.rows, x)?.st === row(fl.res.rows, x)?.st) && !ck.missing.length, ck ? ck.rows.map((r) => `${r.name} ${r.st}`).join(', ') : 'null');
  const noNew = { ...drawn }; delete noNew.newMain;
  check('...the new main posn not drawn: named as missing', Wd.checkWithdrawal(inp, noNew)?.missing.includes('New Main Posn (Bn)'));
}

// ── the obstacle in front of the intermediate posn: a canal one 30 m cell wide; a mapped canal the grid does not show ─
{
  const res = S.solveRecipe(wdr, ctx);
  const f = frameFor(res);
  const ipY = centre(item(res, 'intPosn').pts).y - f.pivot.y;
  // a drain one class cell (30 m) wide, 5 km in front of the intermediate posn: the old 60 m step could step over it
  const g1 = ground();
  const thin = { ...g1, cls: (x, y) => (Math.abs(y - (ipY - 5000)) < 15 ? 21 : g1.cls(x, y)) };
  check('a drain one 30 m cell wide 5 km in front: found (15 m steps), Behind an obstacle passes', row(Wd.findWithdrawal(res, f, thin, doc, {}).rows, 'Behind an obstacle')?.st === 'pass', row(Wd.findWithdrawal(res, f, thin, doc, {}).rows, 'Behind an obstacle')?.reason);
  // the mapped lines: a 76 m link canal 6 km in front that the class grid does not show, and a 4 m distributary nearer
  const lineAt = (y, n, w) => ({ kind: 'canal', xy: [[-8000, y], [8000, y + 300]], attrs: { n, w } });
  const withLines = (ls) => ({ ...ground(), mov: () => ({ lines: () => ls }) });
  const link = Wd.findWithdrawal(res, f, withLines([lineAt(ipY - 6000, 'Test Link Canal', 76.2), lineAt(ipY - 2000, 'Test Disty', 3.7)]), doc, {});
  const rL = row(link.rows, 'Behind an obstacle');
  check('...a 76 m link canal on the 1:50k lines, not in the class grid: passes and names it with its width; the 4 m distributary does not count', rL?.st === 'pass' && /Test Link Canal \(76 m wide\)/.test(rL.reason) && !/Disty/.test(rL.reason), rL?.reason);
  const disty = Wd.findWithdrawal(res, f, withLines([lineAt(ipY - 2000, 'Test Disty', 3.7)]), doc, {});
  check('...only a 4 m distributary between: still warns', row(disty.rows, 'Behind an obstacle')?.st === 'warn', row(disty.rows, 'Behind an obstacle')?.reason);
}

// ── the withdrawal-family checks of 24 Nov 2026 (Doctrine_Review R204, R207-R210, R213; OOW3 2006) ─────────────────
{
  const res = S.solveRecipe(wdr, ctx);
  check('control rows: Coy check pts between each Coy and its RV, the BL, two passage lanes and a contact point at the int posn (OOW3 Annex Q p 76, p 67, s10 p 48)', ['Check points', 'Bomb line', 'Passage'].every((x) => row(res.rows, x)?.st === 'pass'), ['Check points', 'Bomb line', 'Passage'].map((x) => `${x} ${row(res.rows, x)?.st}`).join(', '));
  const without = (roles) => Wd.withdrawalGeometryRows(res.items.filter((i) => !roles.includes(i.role)), wdr, doc).rows;
  check('...no Coy check pts: grey (IBB p 381 b: only if the route is long); no BL: warns; one passage lane: warns', row(without(['cpA', 'cpB']), 'Check points')?.st === 'unchecked' && row(without(['bl']), 'Bomb line')?.st === 'warn' && row(without(['ppI2']), 'Passage')?.st === 'warn');
  const g12 = Wd.withdrawalGeom(wdr, doc, 12000);
  const ipF = Math.min(...g12.intPosn.pts.map((p) => p.y));
  check('the passage points and contact point follow the int posn to its aimed place, on its front edge', [g12.ppI1, g12.ppI2, g12.ctI].every((x) => x && Math.abs(x.pts[0].y - ipF) < 1) && g12.ppI1.pts[0].x < g12.ppI2.pts[0].x);
  const f = frameFor(res);
  const ip = item(res, 'intPosn');
  const x0 = Math.min(...ip.pts.map((p) => p.x)), x1 = Math.max(...ip.pts.map((p) => p.x)), y0 = Math.min(...ip.pts.map((p) => p.y)) - f.pivot.y, y1 = Math.max(...ip.pts.map((p) => p.y)) - f.pivot.y;
  const lakeL = [x0 - f.pivot.x - 600, y0, x0 - f.pivot.x - 100, y1], lakeR = [x1 - f.pivot.x + 100, y0, x1 - f.pivot.x + 600, y1];
  const g1 = ground({ lake: lakeL });
  const oneSide = Wd.findWithdrawal(res, f, g1, doc, {});
  check('R204: a lake beside the int posn\'s left flank only: Int posn flanks warns, the right flank open (OOW3 p 33 b, p 34)', row(oneSide.rows, 'Int posn flanks')?.st === 'warn' && /left flank on water/.test(row(oneSide.rows, 'Int posn flanks')?.reason) && /right flank open/.test(row(oneSide.rows, 'Int posn flanks')?.reason), row(oneSide.rows, 'Int posn flanks')?.reason);
  const both = ground({ lake: lakeL });
  const cls2 = (x, y) => (x >= lakeR[0] && x <= lakeR[2] && y >= lakeR[1] && y <= lakeR[3] ? 4 : both.cls(x, y));
  const twoSides = Wd.findWithdrawal(res, f, { ...both, cls: cls2 }, doc, {});
  check('...lakes on both flanks: passes; the view to its front read (open ground: seen)', row(twoSides.rows, 'Int posn flanks')?.st === 'pass' && row(twoSides.rows, 'Int posn view')?.st === 'pass', `${row(twoSides.rows, 'Int posn flanks')?.reason} | ${row(twoSides.rows, 'Int posn view')?.reason}`);
  const fd = Wd.findWithdrawal(res, f, ground(), doc, {});
  check('R207: the approach between the forward Coys reaches the front within the rear parties\' MG reach (457 m): passes (OOW3 p 27)', row(fd.rows, 'Rear parties per apch')?.st === 'pass', row(fd.rows, 'Rear parties per apch')?.reason);
  const far = { ...res, items: res.items.map((i) => (/^rp[AB]$/.test(i.role) ? { ...i, pts: [{ x: i.pts[0].x * 5, y: i.pts[0].y }] } : i)) };
  const fdFar = Wd.findWithdrawal(far, f, ground(), doc, {});
  check('...the rear parties moved out to the Coys\' outer flanks: the approach is past their reach, warns with a fix', row(fdFar.rows, 'Rear parties per apch')?.st === 'warn' && row(fdFar.rows, 'Rear parties per apch')?.detail?.fix?.length > 0, row(fdFar.rows, 'Rear parties per apch')?.reason);
  check('R209 / R213: "all troops clear of the BL" in the programme; converging routes from the outer flanks to confirm (OOW3 pp 8, 19)', fd.times.some((t) => /clear of the BL/.test(t.label)) && fd.confirm.some((c) => /converging/.test(c)));
}

console.log(`\n${n - fails} of ${n} checks passed`);
process.exit(fails ? 1 : 0);
