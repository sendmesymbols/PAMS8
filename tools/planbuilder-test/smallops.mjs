// smallops.mjs -- checks Phase 8 of the Intelligent Deployment (MS/Engines/DeploymentBuilder/PlanSmallOps.ts through
// PlanFit.fitLayout): the ambush laid on the road under the click (line / L / V from MovementGuidePlans.ambushSiteAt,
// better sites from ambushSites, the KZ in view, stops, RV 750-900 m back), the patrol's routes out and in (planPatrol)
// with its card (patrolCard: FRV 400-500 m short, bounds, times), and the recce's OPs over the NAI (high ground,
// together seeing most of it, routes to them in dead ground). Ground: the Movement Guide's synthetic world
// (tools/movement-test/world.mjs: a road with a canal and an embankment beside it at km 1.2-1.4, a bend at km 2, a
// 60 m hill, a town).
//   node tools/planbuilder-test/smallops.mjs          (add --quiet to print only failures and the summary)
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const F = await import('../../MS/Engines/DeploymentBuilder/PlanFit.ts');
const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
const R = await import('../../MS/Engines/DeploymentBuilder/PlanRecipes.ts');
const O = await import('../../MS/Engines/DeploymentBuilder/PlanSmallOps.ts');
const M = await import('../../MS/Engines/MovementGuide/MovementGuideScan.ts');
const MP = await import('../../MS/Engines/MovementGuide/MovementGuidePlans.ts');
const PL = await import('../../MS/Engines/PlatoonGuide/PlatoonGuideRead.ts');
const W = await import('../movement-test/world.mjs');
const GR = await import('../../MS/Engines/MovementGuide/MovementGuideGrid.ts');

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
const rec = (id) => json(`MS/Data/Deployments/Recipes/${id}.json`);
const row = (rows, name) => rows.find((r) => r.name === name);
const it = (res, role) => res.items.find((i) => i.role === role);
const its = (res, role) => res.items.filter((i) => i.role === role);
const centre = (pts) => ({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length });
const movRules = M.rulesFrom(json('MS/Data/MovementDoctrine.json'));
const plRules = PL.plRulesFrom(json('MS/Data/PlatoonDoctrine.json'));
const ground = (gm = W.probe, extra = {}) => {
  const mov = { ...gm, raster: () => null, sight2: (...a) => { const s = gm.sight(...a); return { p: s, pTerrain: s }; }, going: (p) => (p === 'dismounted' ? W.foot : W.wheeled), classLabel: (c) => `C${c}`, takePending: () => false, ...extra };
  return { cls: gm.cls, elev: gm.elev, going: (p) => (p === 'dismounted' ? W.foot : W.wheeled), label: (c) => `C${c}`, sight: gm.sight, pending: () => false, dataLine: () => 'synthetic', mov: () => mov };
};
const g = ground();
const XY = (p) => ({ x: p[0], y: p[1] });
const gd = (a, b) => M.groundDist([a.x, a.y], [b.x, b.y]);
// a plan item's world point(s), through the fit's frame
const world = (fl, p) => { const f = fl.frame; const lx = (p.x - f.pivot.x) * f.k, ly = (p.y - f.pivot.y) * f.k, c = Math.cos(f.bearing), s = Math.sin(f.bearing); return { x: f.anchor.x + lx * c + ly * s, y: f.anchor.y - lx * s + ly * c }; };
const inpOf = (recipe, anchor, bearingDeg, more = {}) => ({ recipe, ctx, opts: {}, ground: g, anchor: XY(anchor), bearing: (bearingDeg * Math.PI) / 180, threat: null, movRules, plRules, ...more });
const roadSide = (p) => M.distToLine([p.x, p.y], W.roadXY);
const line = rec('pl-ambush-line'), Lr = rec('pl-ambush-l'), Vr = rec('pl-ambush-v'), ptl = rec('pl-patrol'), r2 = rec('pl-recce-two-ops'), r3 = rec('pl-recce-three-ops');

// ── the recipes and the geometry ─────────────────────────────────────────────────────────────────────────────────────
for (const r of [line, Lr, Vr, ptl, r2, r3]) {
  const bad = R.validateRecipe(r, { doc, symbols }).filter((i) => i.level === 'fail').map((i) => i.msg);
  check(`${r.id}: validates; a small op (Phase 8) with its pivot`, !bad.length && R.SMALL_TASKS.includes(r.task) && !!r.pivot, bad.join('; '));
  const res = O.solveSmall(r, ctx, {}, null);
  const piv = res.items.find((i) => i.id === res.pivotId);
  check('...geometry only: the pivot at the click (0, 0), the ground rows grey, a confirm list', piv?.role === r.pivot && Math.hypot(piv.pts[0].x, piv.pts[0].y) < 1 && res.rows.some((x) => x.st === 'unchecked') && res.confirm.length >= 3, res.rows.map((x) => `${x.name} ${x.st}`).join(', '));
}
{
  const res = O.solveSmall(ptl, ctx, {}, 2000);
  const oc = centre(it(res, 'obj').pts), frv = it(res, 'frv').pts[0];
  check('Patrol, geometry aimed 2 km: the Obj at the aim, the FRV 450 m short of it (R 400-500 m) and its row passes', Math.abs(oc.y - 2000) < 1 && Math.abs(oc.y - frv.y - 450) < 1 && row(res.rows, 'FRV')?.st === 'pass', row(res.rows, 'FRV')?.reason);
  const out = it(res, 'out').pts;
  check('...the route out from the SP to the Obj, the route in back to the SP', Math.hypot(out[0].x, out[0].y) < 1 && out[out.length - 1].y > 1800 && Math.hypot(it(res, 'in').pts.at(-1).x, it(res, 'in').pts.at(-1).y) < 60);
  const rc = O.solveSmall(r3, ctx, {}, 3000);
  const nc = centre(it(rc, 'nai').pts), ops = rc.items.filter((i) => /^op\d$/.test(i.role));
  check('Recce, geometry aimed 3 km: the NAI there, three OPs between, on the own side, OP range and OPs apart pass', Math.abs(nc.y - 3000) < 1 && ops.length === 3 && ops.every((o) => o.pts[0].y < nc.y && o.pts[0].y > 0) && row(rc.rows, 'OP range')?.st === 'pass' && row(rc.rows, 'OPs apart')?.st === 'pass', `${row(rc.rows, 'OP range')?.reason}; ${row(rc.rows, 'OPs apart')?.reason}`);
  const doc2 = S.toPlanDocument(res, (pid, ov, id, de) => ({ id, ...de }), (pid, id, name, seq, syms) => ({ id, syms }), 1);
  check('Plan document: the SP is the pivot; FPoint units carry their echelon', doc2.pivotId === res.pivotId && doc2.doc.poObj.plnOrdrOverlay[0].syms.some((s) => s.SYM_GEO_TYPE === 'FPoint' && s.SIDC.slice(8, 10) === '13'));
}

// ── ambush: the road, the defile ─────────────────────────────────────────────────────────────────────────────────────
const defile = W.at(1300, 0);
{
  // he comes from the west (km 0): the aim points west
  const fl = F.fitLayout(inpOf(line, defile, 270));
  const rows = fl.res.rows;
  check('Ambush at the defile, line: fitted on the ground, its reading kept for the map', fl.res.mode === 'terrain' && fl.fit.small?.task === 'ambush', fl.res.mode);
  check('...Road passes: the KZ on the Rd the click is on', row(rows, 'Road')?.st === 'pass', row(rows, 'Road')?.reason);
  check('...Target held passes: a defile (canal one side, embankment the other)', row(rows, 'Target held')?.st === 'pass' && /defile/.test(row(rows, 'Target held')?.reason), row(rows, 'Target held')?.reason);
  const road = fl.fit.small.road;
  check('...the road is read up toward him (west) first: its start lies west of the click', road[0][0] < defile[0] - 500, `${Math.round((road[0][0] - defile[0]) * W.s)} m`);
  const kz = centre(it(fl.raw, 'kz').pts.map((p) => world(fl, p)));
  check('...the KZ on the Rd at the click', roadSide(kz) < 15 && gd(kz, XY(defile)) < 40, `${Math.round(roadSide(kz))} m off the Rd, ${Math.round(gd(kz, XY(defile)))} m from the click`);
  const fg = world(fl, it(fl.raw, 'ambGp').pts[0]);
  check('...the Fire Gp beside the Rd, back from it (30-200 m)', roadSide(fg) > 30 && roadSide(fg) < 200, `${Math.round(roadSide(fg))} m`);
  const s1 = world(fl, it(fl.raw, 'stop1').pts[0]), s2 = world(fl, it(fl.raw, 'stop2').pts[0]);
  check('...Stop 1 up the Rd toward him (west), Stop 2 beyond the KZ (east)', s1.x < kz.x - 100 && s2.x > kz.x + 100, `${Math.round((s1.x - kz.x) * W.s)} / ${Math.round((s2.x - kz.x) * W.s)} m`);
  const rv = world(fl, it(fl.raw, 'rv').pts[0]);
  check('...the RV 750-900 m back from the Rd and its row passes (R)', row(rows, 'RV')?.st === 'pass' && roadSide(rv) > 600 && roadSide(rv) < 950, `${row(rows, 'RV')?.reason}`);
  check('...a straight stretch: the line layout suits the ground', row(rows, 'Layout')?.st === 'pass', row(rows, 'Layout')?.reason);
  check('...every row named: Road, Target held, Hidden from behind, Fire posn, KZ in view, Stops, Withdrawal, RV, Reinforcements, Village, Layout, Site, Better site',
    ['Road', 'Target held', 'Hidden from behind', 'Fire posn', 'KZ in view', 'Stops', 'Withdrawal', 'RV', 'Reinforcements', 'Village', 'Layout', 'Site', 'Better site'].every((x) => row(rows, x)), rows.map((x) => x.name).join(', '));
  check('...KZ in view: the fire group sees it on flat ground', row(rows, 'KZ in view')?.st === 'pass', row(rows, 'KZ in view')?.reason);
  check('...the Site row lists what scored (+ / - lines)', (row(rows, 'Site')?.detail?.items ?? []).length >= 5 && row(rows, 'Site').detail.items.some((x) => /Defile/.test(x)), (row(rows, 'Site')?.detail?.items ?? []).join(' | '));
  const amb = it(fl.raw, 'amb');
  check('...the Ambush symbol: an arc beside the KZ and its arrow into the KZ (4 control points)', amb.pts.length === 4 && gd(world(fl, amb.pts[3]), kz) < 30);
  const kzW = Math.max(...it(fl.raw, 'kz').pts.map((p) => roadSide(world(fl, p)))), arcW = Math.min(roadSide(world(fl, amb.pts[0])), roadSide(world(fl, amb.pts[1])));
  check('...the KZ (the road and its verges) stays short of the fire line', kzW < arcW, `KZ to ${Math.round(kzW)} m, fire line at ${Math.round(arcW)} m`);
  const pd = S.toPlanDocument(fl.raw, (pid, ov, id, de) => ({ id, ...de }), (pid, id, name, seq, syms) => ({ id, syms }), 1);
  check('...the KZ target is the pivot (the click)', pd.pivotId === fl.raw.pivotId && fl.raw.items.find((i) => i.id === pd.pivotId)?.role === 'kzTgt' && Math.hypot(it(fl.raw, 'kzTgt').pts[0].x, it(fl.raw, 'kzTgt').pts[0].y) < 1);
  // aimed the other way: he comes from the east
  const fe = F.fitLayout(inpOf(line, defile, 90));
  const e1 = world(fe, it(fe.raw, 'stop1').pts[0]);
  check('Aimed east (he comes from the east): Stop 1 now east of the KZ', e1.x > defile[0] + 100 / W.s, `${Math.round((e1.x - defile[0]) * W.s)} m`);
  const tk = F.fitLayout(inpOf(line, defile, 270, { mover: 'dismounted' }));
  check('A target on foot: the canal holds men on foot one side only, the embankment not at all', row(tk.res.rows, 'Target held')?.st !== 'pass' || !/defile/.test(row(tk.res.rows, 'Target held')?.reason), row(tk.res.rows, 'Target held')?.reason);
}
{
  // a click off the road
  const off = W.at(1300, 600);
  const fl = F.fitLayout(inpOf(line, off, 270));
  check('Ambush 600 m off the Rd: Road fails, with why and the fix (click on the road)', row(fl.res.rows, 'Road')?.st === 'fail' && /Click on the road/.test((row(fl.res.rows, 'Road')?.detail?.fix ?? []).join(' ')), row(fl.res.rows, 'Road')?.reason);
  check('...still laid (across country along the aim), the score held down', fl.raw.items.length >= 8 && fl.fit.score <= 60, `score ${fl.fit.score}`);
  const near = F.fitLayout(inpOf(line, W.at(1300, 120), 270));
  check('120 m off the Rd: laid on the Rd, the Road row warns how far', row(near.res.rows, 'Road')?.st === 'warn' && /from the click/.test(row(near.res.rows, 'Road')?.reason), row(near.res.rows, 'Road')?.reason);
}
{
  // open crops at km 0.7, he comes from the east: the defile 600 m up the road scores more
  const fl = F.fitLayout(inpOf(line, W.at(700, 0), 90));
  const rows = fl.res.rows;
  check('Ambush in open crops: Target held warns (his vehicles leave the Rd), why and fix given', row(rows, 'Target held')?.st === 'warn' && !!row(rows, 'Target held')?.detail?.why && (row(rows, 'Target held')?.detail?.fix ?? []).length >= 2, row(rows, 'Target held')?.reason);
  const b = fl.fit.small.better?.[0];
  check('...a better site offered up the Rd toward him, at the defile', row(rows, 'Better site')?.st === 'warn' && b && Math.abs(M.groundDist([b.x, b.y], defile)) < 200 && b.alongM < 0, `${row(rows, 'Better site')?.reason}`);
  check('...the fixes point to it', /up the Rd/.test((row(rows, 'Target held')?.detail?.fix ?? [])[0] ?? ''), (row(rows, 'Target held')?.detail?.fix ?? [])[0]);
  const here = F.fitLayout(inpOf(line, defile, 90));
  check('...and Auto would rank the defile above the crops', here.fit.score > fl.fit.score, `${here.fit.score} vs ${fl.fit.score}`);
}
{
  // the bend at km 2: the ground suits an L
  const fits = [line, Lr, Vr].map((r) => F.fitLayout(inpOf(r, W.bendPt, 270)));
  const [fLine, fL] = fits;
  check('At the bend: the line layout warns the ground suits an L', row(fLine.res.rows, 'Layout')?.st === 'warn' && /suits an L/.test(row(fLine.res.rows, 'Layout')?.reason), row(fLine.res.rows, 'Layout')?.reason);
  check('...the L layout passes it', row(fL.res.rows, 'Layout')?.st === 'pass', row(fL.res.rows, 'Layout')?.reason);
  const ranked = F.rankFits(fits);
  check('...Auto ranks the L first', ranked[0].recipe.layout === 'l', ranked.map((x) => `${x.recipe.layout} ${x.fit.fails}/${x.fit.warns}/${x.fit.score}`).join(', '));
  check('...the L has its short leg (Sp Gp) at the far end of the KZ', !!it(fL.raw, 'amb2') && !!it(fL.raw, 'amb2Gp') && it(fL.raw, 'amb2Gp').label === 'Sp Gp');
  const fV = fits[2];
  const a1 = world(fV, it(fV.raw, 'ambGp').pts[0]), a2 = world(fV, it(fV.raw, 'amb2Gp').pts[0]);
  const sideOf = (p) => { const k = M.bearingOf(W.bendPt, W.at(0, 0)); const b = M.bearingOf(W.bendPt, [p.x, p.y]); return Math.sign(Math.sin(((b - k) * Math.PI) / 180)); };
  check('V: a leg each side of the Rd', sideOf(a1) !== sideOf(a2) && roadSide(a1) > 30 && roadSide(a2) > 30, `${sideOf(a1)} / ${sideOf(a2)}`);
}
{
  // the engine kept: ambushSites gives what it gave, ambushSiteAt scores any station and lays the shape asked for
  const r = new M.RouteScanner(movRules).scan(W.path, W.probe, { going: W.wheeled, sight: true, threat: null });
  const sites = MP.ambushSites(r, W.probe, movRules, W.foot);
  check('Movement Guide: ambushSites still finds the defile first', sites.length && Math.abs(sites[0].chainM - 1300) < 150, sites.map((s) => `${s.chainM} ${s.score}`).join(', '));
  const st = MP.stationAtChain(r, 700);
  const at = MP.ambushSiteAt(r, st, W.probe, movRules, W.foot, 'V');
  check('ambushSiteAt: any station scored (open crops: exits none, not a likely site), the V laid as asked', at.exits === 'none' && at.score < movRules.ambush.minScore && at.layout.shape === 'V' && at.groundShape === 'line' && !!at.layout.arm);
}

// ── patrol ───────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const sp = W.at(-800, -1600), obj = W.at(2600, 1400);
  const brg = M.bearingOf(sp, obj);
  const fl = F.fitLayout(inpOf(ptl, sp, brg, { cursor: XY(obj), night: true }));
  const rows = fl.res.rows;
  check('Patrol: fitted, routes out and in found', fl.res.mode === 'terrain' && row(rows, 'Route out')?.st === 'pass' && !!fl.fit.small?.out && !!fl.fit.small?.back, row(rows, 'Route out')?.reason);
  check('...the Obj where it was aimed (the second click)', gd(world(fl, centre(it(fl.raw, 'obj').pts)), XY(obj)) < 30);
  const out = it(fl.raw, 'out').pts.map((p) => world(fl, p));
  check('...the route out from the SP to the Obj', gd(out[0], XY(sp)) < 30 && gd(out[out.length - 1], XY(obj)) < 60, `${Math.round(gd(out[out.length - 1], XY(obj)))} m short`);
  check('...the route in differs from the route out (R)', row(rows, 'Route in')?.st === 'pass', row(rows, 'Route in')?.reason);
  const frv = world(fl, it(fl.raw, 'frv').pts[0]);
  const fr = row(rows, 'FRV');
  check('...the FRV on the route 400-500 m short of the Obj (R)', !!fr && fr.st !== 'fail' && gd(frv, XY(obj)) > 250 && gd(frv, XY(obj)) < 520, `${fr?.st}: ${fr?.reason}`);
  const b = its(fl.raw, 'bound');
  check('...check points at the bounds, numbered (CheckPt)', b.length >= 3 && b.every((x) => x.key === '25130300') && b[0].label === '1', `${b.length}`);
  check('...rows: Bounds, Seen, Villages, Skylines, Dangers, Time', ['Bounds', 'Seen', 'Villages', 'Skylines', 'Dangers', 'Time'].every((x) => row(rows, x)), rows.map((x) => `${x.name} ${x.st}`).join(', '));
  check('...Time: out, at the Obj and back by night', /by night: out .* at the Obj, back /.test(row(rows, 'Time')?.reason ?? ''), row(rows, 'Time')?.reason);
  const legsOut = fl.fit.small.legs.filter((l) => l.way === 'Out');
  check('...the route card: a few legs a patrol can walk by night (the grid steps straightened), each with a bearing and paces', legsOut.length >= 2 && legsOut.length <= 15 && legsOut.every((l) => l.paces > 0 && l.bearingDeg >= 0 && l.bearingDeg < 360 && l.gridDeg >= 0 && l.gridDeg < 360), `${legsOut.length} legs out`);
  // bearings are grid, not true: no sheets' grid read here, so the UTM grid (zone 43, grid north 1.1 W of true at 73 E)
  const brgOff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  const utmC = PL.plUtmConvergence(sp).deg;
  check('...grid bearings: no sheets grid read, UTM zone 43 named, grid = true - convergence', fl.fit.small.grid === 'UTM zone 43' && legsOut.every((l) => brgOff(l.gridDeg, l.bearingDeg - utmC) <= 1.05), `${fl.fit.small.grid}: ${legsOut.map((l) => `${l.bearingDeg}T/${l.gridDeg}G`).join(' ')}`);
  check('...the town avoided: no village on the way out', !(row(rows, 'Villages')?.reason ?? '').includes('Testabad'), row(rows, 'Villages')?.reason);
  check('...a confirm list for the ground', fl.res.confirm.length >= 3);
  check('...each leg in mils too (6400 to the circle, from the grid bearing); no GMA set: no magnetic bearing', legsOut.every((l) => Math.abs(l.mils - (l.gridDeg * 6400) / 360) <= 9 && l.magDeg === null), legsOut.map((l) => `${l.gridDeg}/${l.mils}`).join(' '));
  const gm = F.fitLayout(inpOf(ptl, sp, brg, { cursor: XY(obj), night: true, gmaDeg: 2.5 }));
  const gl = gm.fit.small.legs.filter((l) => l.way === 'Out');
  check('...GMA +2.5 (E): magnetic = grid - GMA on every leg', gl.length && gl.every((l) => Math.abs(((l.gridDeg - 2.5 - l.magDeg + 540) % 360) - 180) <= 1), gl.map((l) => `${l.gridDeg}->${l.magDeg}`).join(' '));
  // the bundle's sheets.json read (MovementGuideProbe.gridConvergence over MovementGuideGrid): the Indian grid zone I,
  // grid north sin 32.5 x 5 = 2.69 E of true at 73 E; mils and magnetic follow the grid bearing
  const sheets = new GR.SheetGridReader();
  sheets.load({ '50k': [['43G/1', 72.5, 33.5, 73.5, 34]], grid: { zones: [{ id: 'I', lat0: 32.5, lon0: 68 }, { id: 'IIa', lat0: 26, lon0: 74 }], boundary: [[54, 28], [84, 28]] } });
  const gIn = ground(W.probe, { gridConvergence: (x, y) => sheets.convergence(...M.mercToLngLat(x, y)) });
  const ig = F.fitLayout(inpOf(ptl, sp, brg, { cursor: XY(obj), night: true, gmaDeg: 2.5, ground: gIn }));
  const il = ig.fit.small.legs.filter((l) => l.way === 'Out');
  const iC = Math.sin((32.5 * Math.PI) / 180) * 5;
  check('...the sheets grid read: Indian grid zone I named, grid = true - 2.7 on every leg', ig.fit.small.grid === 'Indian grid zone I' && il.length >= 2 && il.every((l) => brgOff(l.gridDeg, l.bearingDeg - iC) <= 1.05), `${ig.fit.small.grid}: ${il.map((l) => `${l.bearingDeg}T/${l.gridDeg}G`).join(' ')}`);
  check('...mils and magnetic from the Indian grid bearing', il.every((l) => Math.abs(l.mils - (l.gridDeg * 6400) / 360) <= 9 && brgOff(l.magDeg, l.gridDeg - 2.5) <= 1), il.map((l) => `${l.gridDeg}G ${l.mils}mil ${l.magDeg}M`).join(' '));
  // leg ends onto features recognisable at night (PlatoonDoctrine legFeatureKinds within legFeatureM)
  const hill = XY(W.hillC ?? W.at(0, 0));
  const kinds = new Set(['hill']);
  const near100 = W.probe.features(hill.x, hill.y, 1, kinds).length ? M.offsetPt(hill.x, hill.y, 90, 100) : null;
  if (near100) {
    const a = M.offsetPt(hill.x, hill.y, 270, 900), z = M.offsetPt(hill.x, hill.y, 90, 1100);
    const open = { cls: () => 2, features: W.probe.features };
    const snapped = O.snapLegEnds([a, near100, z], open, { patrol: { legFeatureKinds: ['hill'], legFeatureM: 150 } }, W.foot);
    check('Leg ends: a turn 100 m from Test Hill moves onto the hill (a feature to find at night); the ends stay', gd(XY(snapped[1]), hill) < 1 && gd(XY(snapped[0]), XY(a)) < 1 && gd(XY(snapped[2]), XY(z)) < 1);
    const nogoK = [...W.foot.nogo][0];
    const blocked = { cls: (x, y) => (M.groundDist([x, y], [hill.x, hill.y]) < 40 ? nogoK : 2), features: W.probe.features };
    const kept = O.snapLegEnds([a, near100, z], blocked, { patrol: { legFeatureKinds: ['hill'], legFeatureM: 150 } }, W.foot);
    check('...but not when the way to it crosses NO-GO on foot: the turn stays where it was', gd(XY(kept[1]), XY(near100)) < 1);
  } else check('Leg ends: the test world has Test Hill', false);
  const near = W.at(-700, -1300);
  const sh = F.fitLayout(inpOf(ptl, sp, M.bearingOf(sp, near), { cursor: XY(near) }));
  check('Patrol aimed 300 m out: the Obj kept where aimed; too short for an FRV (warn, not a fail)', row(sh.res.rows, 'FRV')?.st === 'warn' && /too short/.test(row(sh.res.rows, 'FRV')?.reason) && gd(world(sh, centre(it(sh.raw, 'obj').pts)), XY(near)) < 30, row(sh.res.rows, 'FRV')?.reason);
}

// ── recce ────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const sp = W.at(-1500, -2500), nai = W.at(1200, 600);
  const brg = M.bearingOf(sp, nai);
  for (const [r, k] of [[r2, 2], [r3, 3]]) {
    const fl = F.fitLayout(inpOf(r, sp, brg, { cursor: XY(nai) }));
    const rows = fl.res.rows;
    const ops = fl.fit.small?.ops ?? [];
    check(`Recce ${k} OPs: fitted, ${k} OPs sited`, fl.res.mode === 'terrain' && ops.length === k && !row(rows, 'OPs sited'), ops.map((o) => `${o.label} ${o.seenPct}%`).join(', '));
    const nc = world(fl, centre(it(fl.raw, 'nai').pts));
    check('...the NAI where it was aimed', gd(nc, XY(nai)) < 30);
    const band = doc.plan.smallOps.recce.opBandM.value;
    check('...each OP on the own side, within the band from the NAI', ops.every((o) => { const d = M.groundDist([o.x, o.y], nai); return d >= band[0] - 1 && d <= band[1] + 1 && M.groundDist([o.x, o.y], sp) < M.groundDist(nai, sp) + 300; }));
    let apart = Infinity;
    for (let i = 0; i < ops.length; i++) for (let j = i + 1; j < ops.length; j++) apart = Math.min(apart, M.groundDist([ops[i].x, ops[i].y], [ops[j].x, ops[j].y]));
    check('...OPs at least 300 m apart (E) and the row passes', apart >= 300 && row(rows, 'OPs apart')?.st === 'pass', `${Math.round(apart)} m`);
    check('...the plan\'s OP symbols where the reading put them', ops.every((o, i) => gd(world(fl, it(fl.raw, `op${i + 1}`).pts[0]), o) < 5));
    check('...NAI seen, OP ground, Routes hidden rows', ['NAI seen', 'OP ground', 'Routes hidden'].every((x) => row(rows, x)), rows.map((x) => `${x.name} ${x.st}`).join(', '));
    check('...routes to each OP', (fl.fit.small.routes ?? []).filter(Boolean).length === k && its(fl.raw, 'rt1').length === 1);
  }
  // behind the hill: the hill hides part of the NAI; a second OP adds what the first cannot see
  const hill = W.hillC;
  const nai2 = M.offsetPt(hill[0], hill[1], 315, 700), sp2 = M.offsetPt(hill[0], hill[1], 135, 2600);
  const fl = F.fitLayout(inpOf(r2, sp2, M.bearingOf(sp2, nai2), { cursor: XY(nai2) }));
  const ops = fl.fit.small.ops, pts = fl.fit.small.naiPts;
  const u = pts.filter((p) => p.by.length).length / pts.length;
  // an OP straight behind the hill on the line to the NAI (1 km out) sees little: the siting goes round the hill
  const q = M.offsetPt(nai2[0], nai2[1], M.bearingOf(nai2, sp2), 1000);
  const qPct = pts.filter((p) => W.sight(q[0], q[1], 1, p.x, p.y, 2.4) >= 0.5).length / pts.length;
  check('Recce behind a hill: an OP straight behind the hill would see little of the NAI', qPct < 0.5, `${Math.round(qPct * 100)} %`);
  check('...the OPs sited round it see more, each one, and together most of it', ops.every((o) => o.seenPct / 100 > qPct) && u >= 0.7, `${ops.map((o) => `${o.label} ${o.seenPct} %`).join(', ')}; together ${Math.round(u * 100)} %`);
  const ns = row(fl.res.rows, 'NAI seen');
  check('...the NAI seen row says how much, each OP listed in its detail', !!ns && (ns.detail?.items ?? []).length === 2 && /OP 1: .* sees \d+ %/.test(ns.detail.items[0]), ns?.reason);
}

// ── Check my plan: the plan as drawn read with the same rows ─────────────────────────────────────────────────────────
{
  const asDrawn = (fl, edit = {}) => {
    const d = {};
    for (const i of fl.raw.items) {
      if (d[i.role]) continue;
      const w = (p) => { const q = world(fl, p); return [q.x, q.y]; };
      d[i.role] = { pts: i.pts.map(w), ...(i.base ? { base: { start: w(i.base.start), mid: w(i.base.mid), end: w(i.base.end) } } : {}) };
    }
    return { ...d, ...edit };
  };
  const same = (a, b, names) => names.every((nm) => row(a, nm)?.st === row(b, nm)?.st);
  // patrol
  const sp = W.at(-800, -1600), obj = W.at(2600, 1400);
  const pf = F.fitLayout(inpOf(ptl, sp, M.bearingOf(sp, obj), { cursor: XY(obj), night: true }));
  const pc = O.checkSmallOp(inpOf(ptl, sp, 0, { night: true }), asDrawn(pf));
  const pn = ['Route out', 'Route in', 'FRV', 'Seen', 'Villages', 'Skylines', 'Time'];
  check('Check my plan, patrol: read as drawn, the same verdicts as built', !!pc && same(pc.rows, pf.res.rows, pn) && !pc.missing.length, pc ? pn.map((nm) => `${nm} ${row(pf.res.rows, nm)?.st}/${row(pc.rows, nm)?.st}`).join(', ') : 'null');
  const onObj = O.checkSmallOp(inpOf(ptl, sp, 0, { night: true }), asDrawn(pf, { frv: { pts: [obj] } }));
  check('...the FRV dragged onto the Obj: the FRV row warns (0 m short, seen)', row(onObj.rows, 'FRV')?.st === 'warn', row(onObj.rows, 'FRV')?.reason);
  const noIn = asDrawn(pf); delete noIn.in;
  check('...no route in drawn: Route in says so, not a fail', /no second way back|no route/.test(row(O.checkSmallOp(inpOf(ptl, sp, 0), noIn).rows, 'Route in')?.reason ?? '') && row(O.checkSmallOp(inpOf(ptl, sp, 0), noIn).rows, 'Route in')?.st !== 'fail');
  // recce
  const rsp = W.at(-1500, -2500), nai = W.at(1200, 600);
  const rf = F.fitLayout(inpOf(r2, rsp, M.bearingOf(rsp, nai), { cursor: XY(nai) }));
  const rc = O.checkSmallOp(inpOf(r2, rsp, 0), asDrawn(rf));
  check('Check my plan, recce: the NAI seen and OPs apart as built', !!rc && same(rc.rows, rf.res.rows, ['NAI seen', 'OPs apart', 'OP ground']), rc ? `${row(rc.rows, 'NAI seen')?.reason} | ${row(rc.rows, 'OPs apart')?.reason}` : 'null');
  const close = asDrawn(rf); close.op2 = { pts: [close.op1.pts[0].map((v, i) => v + (i ? 60 / W.s : 0))] };
  check('...OP 2 dragged 60 m from OP 1: OPs apart warns', row(O.checkSmallOp(inpOf(r2, rsp, 0), close).rows, 'OPs apart')?.st === 'warn', row(O.checkSmallOp(inpOf(r2, rsp, 0), close).rows, 'OPs apart')?.reason);
  // ambush
  const af = F.fitLayout(inpOf(line, defile, 270));
  const ac = O.checkSmallOp(inpOf(line, defile, 0), asDrawn(af));
  const an = ['Road', 'Target held', 'Hidden from behind', 'KZ in view', 'Stops', 'Withdrawal', 'RV', 'Site'];
  check('Check my plan, ambush: the same verdicts as built; the drawn fire line 30-120 m from the Rd', !!ac && same(ac.rows, af.res.rows, an) && row(ac.rows, 'Fire line')?.st === 'pass', ac ? an.map((nm) => `${nm} ${row(af.res.rows, nm)?.st}/${row(ac.rows, nm)?.st}`).join(', ') : 'null');
  const nearRv = asDrawn(af); nearRv.rv = { pts: [defile.map((v, i) => v + (i ? -200 / W.s : 0))] };
  check('...the RV dragged 200 m from the Rd: the RV row warns (wants 750-900 m)', row(O.checkSmallOp(inpOf(line, defile, 0), nearRv).rows, 'RV')?.st === 'warn', row(O.checkSmallOp(inpOf(line, defile, 0), nearRv).rows, 'RV')?.reason);

  // ── area ambush (IC s44 p 152, Fig 16): the central site and an outlying ambush each way along the Rd ──
  const ar = rec('pl-ambush-area');
  const aa = F.fitLayout(inpOf(ar, defile, 270));
  const ao = aa.fit.small?.outlying ?? [];
  check('Area ambush at the defile: the central site laid as the line ambush (its rows kept)', aa.res.mode === 'terrain' && ['Road', 'Target held', 'KZ in view', 'Stops', 'RV', 'Site'].every((x) => row(aa.res.rows, x)) && row(aa.res.rows, 'Target held')?.st === 'pass', aa.res.rows.map((x) => `${x.name} ${x.st}`).join(', '));
  check('...two outlying ambushes: one up the Rd toward him, one down it, each 400-1200 m from the central KZ (E)', ao.length === 2 && ao.some((o) => o.alongM < 0) && ao.some((o) => o.alongM > 0) && ao.every((o) => Math.abs(o.alongM) >= 400 && Math.abs(o.alongM) <= 1300), ao.map((o) => `${o.label} ${o.alongM} m, ${o.score}`).join('; '));
  const o1 = world(aa, it(aa.raw, 'out1Gp').pts[0]), o2 = world(aa, it(aa.raw, 'out2Gp').pts[0]);
  const kzA = centre(it(aa.raw, 'kz').pts.map((p) => world(aa, p)));
  check('...Outlying 1 on his side (west of the KZ), Outlying 2 beyond it (east); each group beside the Rd', o1.x < kzA.x - 300 && o2.x > kzA.x + 300 && roadSide(o1) < 150 && roadSide(o2) < 150, `${Math.round((o1.x - kzA.x) * W.s)} / ${Math.round((o2.x - kzA.x) * W.s)} m, ${Math.round(roadSide(o1))} / ${Math.round(roadSide(o2))} m off the Rd`);
  check('...the Outlying row says where each is and what it sees; its Ambush symbols drawn (out1, out2)', !!row(aa.res.rows, 'Outlying') && /Outlying 1: .* up the Rd/.test(row(aa.res.rows, 'Outlying')?.reason ?? row(aa.res.rows, 'Outlying')?.detail?.items?.join(' ') ?? '') && it(aa.raw, 'out1')?.key === '25141700' && it(aa.raw, 'out2')?.pts.length === 4, `${row(aa.res.rows, 'Outlying')?.st}: ${row(aa.res.rows, 'Outlying')?.reason}`);
  check('...confirm: every way into and out of the central site found on the ground', aa.res.confirm.some((x) => /Area ambush: every way/.test(x)));
  const ac2 = O.checkSmallOp(inpOf(ar, defile, 0), asDrawn(aa));
  check('Check my plan, area ambush: read as drawn, the Outlying verdict as built, nothing missing', !!ac2 && row(ac2.rows, 'Outlying')?.st === row(aa.res.rows, 'Outlying')?.st && !ac2.missing.length, ac2 ? `${row(aa.res.rows, 'Outlying')?.st}/${row(ac2.rows, 'Outlying')?.st} ${ac2.missing.join(',')}` : 'null');
  const noOut = asDrawn(aa); delete noOut.out2; delete noOut.out2Gp;
  const ac3 = O.checkSmallOp(inpOf(ar, defile, 0), noOut);
  check('...Outlying 2 not drawn: named as missing, the row reads Outlying 1 only', !!ac3 && ac3.missing.includes('Outlying 2 fire line') && !/Outlying 2/.test(row(ac3.rows, 'Outlying')?.reason ?? ''), ac3 ? `${ac3.missing.join(',')} | ${row(ac3.rows, 'Outlying')?.reason}` : 'null');

  // ── Coy screen (IC s73 pp 378-381): posts in front of the main posn on the ground he would watch it from ──
  const sr = rec('coy-screen');
  const hill = XY(W.hillC);
  const srv = W.at(0, 0).map((v, i) => (i ? hill.y - 1500 / W.s : hill.x));
  const sAim = [hill.x, hill.y + 1200 / W.s];
  const sf = F.fitLayout(inpOf(sr, srv, M.bearingOf(srv, sAim), { cursor: XY(sAim) }));
  const srows = sf.res.rows;
  check('Coy screen south of Test Hill, aimed north: fitted, three Pl posts sited', sf.res.mode === 'terrain' && (sf.fit.small?.ops ?? []).length === 3 && sf.fit.small?.screen === true && !row(srows, 'Posts sited'), srows.map((x) => `${x.name} ${x.st}`).join(', '));
  const posts = ['op1', 'op2', 'op3'].map((r) => world(sf, it(sf.raw, r).pts[0]));
  const fwdOf = (p) => { const d = gd(XY(srv), p), b = ((M.bearingOf(srv, [p.x, p.y]) - M.bearingOf(srv, sAim)) * Math.PI) / 180; return d * Math.cos(b); };
  check('...every post 300-1500 m forward of the Wdr RV (no further than needed: IC p378)', posts.every((p) => fwdOf(p) >= 250 && fwdOf(p) <= 1550) && row(srows, 'Posts forward')?.st === 'pass', posts.map((p) => Math.round(fwdOf(p))).join(' / '));
  check('...a post on Test Hill (the knoll of IC p378: high ground that sees over the front)', posts.some((p) => gd(p, hill) < 250), posts.map((p) => Math.round(gd(p, hill))).join(' / '));
  check('...laid laterally with intervals: 1, 2, 3 Pl left to right, spanning the front', row(srows, 'Laterally')?.st === 'pass' && posts[0].x < posts[1].x && posts[1].x < posts[2].x, row(srows, 'Laterally')?.reason);
  check('...his viewpoints: the points of the ground in front that see the main posn counted (those are what the posts watch)', row(srows, 'His viewpoints')?.st === 'pass' && /(\d+) of (\d+) points/.test(row(srows, 'His viewpoints')?.reason ?? ''), row(srows, 'His viewpoints')?.reason);
  check('...rows: Ground in front seen, Post ground, Withdrawal (covered way back), Time back', ['Ground in front seen', 'Post ground', 'Withdrawal', 'Time back'].every((x) => row(srows, x)), srows.map((x) => x.name).join(', '));
  check('...the Screen symbol (25342203) from the left post to the right one, its centre behind them', it(sf.raw, 'scr')?.key === '25342203' && gd(world(sf, it(sf.raw, 'scr').pts[0]), posts[0]) < 5 && gd(world(sf, it(sf.raw, 'scr').pts[2]), posts[2]) < 5 && fwdOf(world(sf, it(sf.raw, 'scr').pts[1])) < Math.min(...posts.map(fwdOf)));
  check('...confirm: withdrawal on the order of the commander who ordered it, 50 % or time up if comms break (IC p381)', sf.res.confirm.some((x) => /50 %/.test(x) && /IC p381/.test(x)));
  const sc2 = O.checkSmallOp(inpOf(sr, srv, 0), asDrawn(sf));
  check('Check my plan, Coy screen: read as drawn, the same verdicts as built', !!sc2 && same(sc2.rows, srows, ['His viewpoints', 'Ground in front seen', 'Posts forward', 'Laterally', 'Post ground', 'Withdrawal']) && !sc2.missing.length, sc2 ? ['His viewpoints', 'Ground in front seen', 'Posts forward', 'Laterally', 'Post ground', 'Withdrawal'].map((nm) => `${nm} ${row(srows, nm)?.st}/${row(sc2.rows, nm)?.st}`).join(', ') : 'null');
  // the ground still loading (no class anywhere yet): not a NO-GO fail, and no row passes with no posts to judge
  const loadMov = { ...g.mov(), cls: () => null, sight: () => null, takePending: () => true };
  const loadG = { ...g, cls: () => null, pending: () => true, mov: () => loadMov };
  const sl = F.fitLayout(inpOf(sr, srv, M.bearingOf(srv, sAim), { cursor: XY(sAim), ground: loadG }));
  check('Coy screen while the ground loads: Posts sited not checked (not a NO-GO fail); no post rows pass with no posts', row(sl.res.rows, 'Posts sited')?.st === 'unchecked' && !row(sl.res.rows, 'Posts forward') && !row(sl.res.rows, 'Withdrawal') && !sl.res.rows.some((x) => x.st === 'fail'), sl.res.rows.map((x) => `${x.name} ${x.st}`).join(', '));
  const rl = F.fitLayout(inpOf(r2, W.at(-1500, -2500), 45, { cursor: XY(W.at(1200, 600)), ground: loadG }));
  check('...the recce the same: OPs sited not checked while loading', row(rl.res.rows, 'OPs sited')?.st === 'unchecked' && !row(rl.res.rows, 'Routes hidden'), rl.res.rows.map((x) => `${x.name} ${x.st}`).join(', '));
  const far = asDrawn(sf); far.op2 = { pts: [[far.op2.pts[0][0], far.op2.pts[0][1] + 1500 / W.s]] };
  check('...2 Pl dragged 1.5 km further out: Posts forward warns (further than needed)', row(O.checkSmallOp(inpOf(sr, srv, 0), far).rows, 'Posts forward')?.st === 'warn', row(O.checkSmallOp(inpOf(sr, srv, 0), far).rows, 'Posts forward')?.reason);
}

// ── without the ground ───────────────────────────────────────────────────────────────────────────────────────────────
{
  const flat = { cls: () => 2, elev: () => 200, going: () => W.foot, label: String, sight: () => 1, pending: () => false, dataLine: () => 'none' };
  const fl = F.fitLayout(inpOf(line, defile, 270, { ground: flat }));
  check('No Movement Guide reader: the geometry stands, every ground row grey (never pass)', fl.res.mode === 'geometry' && ['Target held', 'KZ in view', 'Withdrawal'].every((x) => row(fl.res.rows, x)?.st === 'unchecked'));
}

console.log(`\n${n - fails} of ${n} checks passed`);
process.exit(fails ? 1 : 0);
