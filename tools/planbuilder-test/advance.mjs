// advance.mjs -- checks the advance to contact (MS/Engines/DeploymentBuilder/PlanAdvance.ts): an Armd Bde leading an Armd
// Div's advance (OoW Vol II Fig 2; PlanDoctrine advance): the recipe, the echelons' rows, the going for tracks on the
// axis on synthetic ground (open, a canal across it, a wide marsh), the flank guards' ground, Check my plan as drawn.
//   node tools/planbuilder-test/advance.mjs          (add --quiet to print only failures and the summary)
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const V = await import('../../MS/Engines/DeploymentBuilder/PlanAdvance.ts');
const F = await import('../../MS/Engines/DeploymentBuilder/PlanFit.ts');
const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
const R = await import('../../MS/Engines/DeploymentBuilder/PlanRecipes.ts');

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
const row = (rows, name) => rows.find((r) => r.name === name);
const rec = json('MS/Data/Deployments/Recipes/bde-advance-armd.json');

// ── the recipe and its rows ──────────────────────────────────────────────────────────────────────────────────────────
const bad = R.validateRecipe(rec, ctx).filter((i) => i.level === 'fail').map((i) => i.msg);
check('the Armd Bde advance validates; task advance, pivot the SP', !bad.length && rec.task === 'advance' && rec.pivot === 'sp', bad.join('; '));
const F0 = V.advanceFigures(doc);
check('Fig 2 as read from the page text: C Tps 4-8 km, Van Gd 3.5 km, Main Gd 3 km, the Main Body straight behind (6.5 km) and 6 km deep, the Div\'s flank guards 15-20 km', JSON.stringify(F0.ctps) === '[4000,8000]' && F0.van === 3500 && F0.main === 3000 && JSON.stringify(F0.flank) === '[15000,20000]' && F0.body === 6500 && F0.bodyDepth === 6000);
const g = S.solveRecipe(rec, ctx, {});
const rows = V.advanceRows(g.items, doc);
check('geometry: Covering troops, Advance Guard, Main Body and Flank guards all pass as laid', ['Covering troops', 'Advance Guard', 'Main Body', 'Flank guards'].every((x) => row(rows, x)?.st === 'pass'), rows.map((r) => `${r.name} ${r.st}`).join(', '));
check('...each cites the page text under the highlights', rows.every((r) => /read from the page text under the highlights/.test(r.reason)));
check('...C Tps 6.0 km ahead, the Main Body\'s head 6.5 km behind, the flank guards 17.5 km out (for the Armd Div)', /^6\.0 km ahead/.test(row(rows, 'Covering troops').reason) && /^its head 6\.5 km behind/.test(row(rows, 'Main Body').reason) && /^17\.5 km and 17\.5 km out .*for the Armd Div/.test(row(rows, 'Flank guards').reason), `${row(rows, 'Main Body').reason.slice(0, 60)} | ${row(rows, 'Flank guards').reason.slice(0, 60)}`);
const moved = g.items.map((i) => (i.role === 'mainBody' ? { ...i, pts: i.pts.map((p) => ({ x: p.x, y: p.y - 6000 })) } : i.role === 'flankL' ? { ...i, pts: i.pts.map((p) => ({ x: p.x + 4000, y: p.y })) } : i));
const rm = V.advanceRows(moved, doc);
check('the Main Body dragged 6 km further back, a flank guard in to 2 km: both warn', row(rm, 'Main Body')?.st === 'warn' && row(rm, 'Flank guards')?.st === 'warn', `${row(rm, 'Main Body')?.reason.slice(0, 40)} | ${row(rm, 'Flank guards')?.reason.slice(0, 40)}`);

// ── on synthetic ground ──────────────────────────────────────────────────────────────────────────────────────────────
const nogo = rules.profiles.tracked.nogo[0];
const open = [...Array(40).keys()].find((c) => !rules.profiles.tracked.nogo.includes(c) && rules.classes?.[c] !== undefined) ?? 1;
const mk = (cls) => ({ cls, elev: () => 200, going: goingOf, label: (c) => `class ${c}`, pending: () => false, dataLine: () => 'synthetic' });
const A = { x: 8200000, y: 3700000 };
const inp = (ground) => ({ recipe: rec, ctx, opts: {}, ground, anchor: A, bearing: 0 });
// bearing 0: the advance runs north (+y); a canal 60 m wide across the axis 2 km ahead, a marsh 800 m deep 3 km back
const canal = (x, y) => (y > A.y + 2000 && y < A.y + 2060 ? nogo : open);
const marsh = (x, y) => (y < A.y - 3000 && y > A.y - 3800 ? nogo : open);
const f1 = V.fitAdvance(inp(mk(() => open)));
check('open ground: Going on the axis passes (0 % NO-GO), the flank guards on open ground', row(f1.res.rows, 'Going on the axis')?.st === 'pass' && /^0 %/.test(row(f1.res.rows, 'Going on the axis').reason) && row(f1.res.rows, 'Flank guards\' ground')?.st === 'pass', row(f1.res.rows, 'Going on the axis')?.reason);
const f2 = V.fitAdvance(inp(mk(canal)));
check('a canal 60 Mercator m wide 2000 Mercator m ahead (1.7 km on the ground at this latitude): under 200 m, pass; the stretch named', row(f2.res.rows, 'Going on the axis')?.st === 'pass' && /longest NO-GO stretch [4-8]0 m 1\.7 km ahead of the SP/.test(row(f2.res.rows, 'Going on the axis').reason), row(f2.res.rows, 'Going on the axis')?.reason);
const f3 = V.fitAdvance(inp(mk(marsh)));
check('a marsh 800 m deep across the axis 3 km back: over 500 m, fail, with the fix', row(f3.res.rows, 'Going on the axis')?.st === 'fail' && /bridge or a detour/.test(row(f3.res.rows, 'Going on the axis').reason), row(f3.res.rows, 'Going on the axis')?.reason);
const f4 = V.fitAdvance(inp(mk((x, y) => (x < A.x - 4000 ? nogo : open))));
check('the left flank guard on NO-GO for tracks: warn', row(f4.res.rows, 'Flank guards\' ground')?.st === 'warn' && /left flank guard on class \d+ \(NO-GO/.test(row(f4.res.rows, 'Flank guards\' ground').reason), row(f4.res.rows, 'Flank guards\' ground')?.reason);
check('the fit lays the plan where it was clicked, the SP at the anchor; mode terrain', f1.res.mode === 'terrain' && Math.hypot(F.toWorld(f1.frame, g.items.find((i) => i.role === 'sp').pts[0]).x - A.x, F.toWorld(f1.frame, g.items.find((i) => i.role === 'sp').pts[0]).y - A.y) < 1);
const f5 = F.fitLayout(inp(mk(() => open)));
check('PlanFit.fitLayout hands an advance to fitAdvance', !!f5 && !!row(f5.res.rows, 'Going on the axis'));

// ── the axis routed, its crossings and report lines ─────────────────────────────────────────────────────────────────
{
  const CANAL = 20, BR60 = 39, BR_LIGHT = 41;
  // a canal 60 Mercator m wide 2000 m ahead, a bridge across it on the axis (40 m wide)
  const bridged = (br) => (x, y) => (y > A.y + 2000 && y < A.y + 2060 ? (Math.abs(x - A.x) < 20 ? br : CANAL) : open);
  const b60 = V.fitAdvance(inp(mk(bridged(BR60))));
  check('a canal crossed on a Cl 60+ bridge: Crossings on the axis passes, the canal named 1.7 km ahead of the SP', row(b60.res.rows, 'Crossings on the axis')?.st === 'pass' && /class 20 1\.7 km ahead of the SP: a Cl 60\+ bridge/.test(row(b60.res.rows, 'Crossings on the axis').reason), row(b60.res.rows, 'Crossings on the axis')?.reason);
  const rl = b60.raw.items.find((i) => i.role === 'rl1');
  check('...RL 1 laid on it across the axis (1.5 km long), labelled for the water; RL 2-4 not laid', !!rl && /^RL 1 /.test(rl.label) && Math.abs(Math.hypot(rl.pts[1].x - rl.pts[0].x, rl.pts[1].y - rl.pts[0].y) - 1500) < 2 && !b60.raw.items.some((i) => /^rl[234]$/.test(i.role)), rl ? `${rl.label} ${rl.pts.map((q) => `${Math.round(q.x)},${Math.round(q.y)}`).join(' ')}` : 'none');
  check('...Report lines passes, the bound SP to RL 1 1.7 km', row(b60.res.rows, 'Report lines')?.st === 'pass' && /Bounds: SP to RL 1 1\.7 km/.test(row(b60.res.rows, 'Report lines').reason), row(b60.res.rows, 'Report lines')?.reason);
  const bl = V.fitAdvance(inp(mk(bridged(BR_LIGHT))));
  check('...the bridge below Cl 50: Crossings on the axis fails', row(bl.res.rows, 'Crossings on the axis')?.st === 'fail' && /below Cl 50/.test(row(bl.res.rows, 'Crossings on the axis').reason));
  const nb = V.fitAdvance(inp(mk((x, y) => (y > A.y + 2000 && y < A.y + 2060 ? CANAL : open))));
  check('...no bridge on the axis: fail, the way to fix it said', row(nb.res.rows, 'Crossings on the axis')?.st === 'fail' && /no bridge on the axis/.test(row(nb.res.rows, 'Crossings on the axis').reason));
  const band = (y, y0) => y > A.y + y0 && y < A.y + y0 + 60;
  const two = V.fitAdvance(inp(mk((x, y) => (band(y, 2000) || band(y, 2400) || band(y, 4500) ? (Math.abs(x - A.x) < 20 ? BR60 : CANAL) : open))));
  const rls = two.raw.items.filter((i) => /^rl\d$/.test(i.role));
  check('three canals ahead, two of them 340 m apart: two report lines (1 km apart at least), the bounds between them', rls.length === 2 && /RL 1 to RL 2 [123]\.\d km/.test(row(two.res.rows, 'Report lines').reason), row(two.res.rows, 'Report lines')?.reason);
  const DIST = 21;
  const dc = V.fitAdvance(inp(mk((x, y) => (band(y, 2000) ? (Math.abs(x - A.x) < 20 ? BR60 : DIST) : band(y, 2400) ? (Math.abs(x - A.x) < 20 ? BR60 : CANAL) : open))));
  check('a distributary then a canal 400 m on: one report line, on the canal (the bigger obstacle wins within the spacing)', dc.raw.items.filter((i) => /^rl\d$/.test(i.role)).length === 1 && /RL 1 \(class 20\)/.test(row(dc.res.rows, 'Report lines').reason), row(dc.res.rows, 'Report lines')?.reason.slice(0, 80));
  check('no water ahead: Report lines not checked, set by eye', row(f1.res.rows, 'Report lines')?.st === 'unchecked');
  check('no route reader: Axis route not checked, the straight line read; none of it on a road', row(f1.res.rows, 'Axis route')?.st === 'unchecked' && /straight line/.test(row(f1.res.rows, 'Axis route').reason));
  // a reader that routes: a dog-leg 1.5 km east between the two ends, a road along part of it
  const road = 34;
  const dog = (off) => (a, b) => [{ path: [a, { x: (a.x + b.x) / 2 + off, y: (a.y + b.y) / 2 }, b], lengthM: 0, goPct: 100, minWidthM: 400, chokes: [] }];
  const fr = V.fitAdvance(inp({ ...mk((x) => (x > A.x + 1200 && x < A.x + 1300 ? road : open)), avenues: dog(1500) }));
  const axItem = fr.raw.items.find((i) => i.role === 'axis');
  check('a routing reader: the axis laid along its way (the arrow bends), Axis route passes with the length against straight', row(fr.res.rows, 'Axis route')?.st === 'pass' && /times; warn over 1\.5/.test(row(fr.res.rows, 'Axis route').reason) && axItem.pts.length >= 4 && axItem.pts.some((p) => Math.abs(p.x - axItem.pts[0].x) > 1000), row(fr.res.rows, 'Axis route')?.reason);
  check('...the share on roads named with the class (Cl 60+)', /on roads \(Cl 60\+/.test(row(fr.res.rows, 'Axis route').reason), row(fr.res.rows, 'Axis route')?.reason);
  check('...a way round 9 km out: over 1.5 times the straight line, warn', row(V.fitAdvance(inp({ ...mk(() => open), avenues: dog(9000) })).res.rows, 'Axis route')?.st === 'warn');
  // a bridge whose water the bundle does not show beside it: still an obstacle crossed, a report line on it
  const deck = V.fitAdvance(inp(mk((x, y) => (band(y, 2000) && Math.abs(x - A.x) < 300 ? BR60 : open))));
  check('a bridge with no water read beside it: named water under a bridge, RL 1 on the bridge', /water under a bridge 1\.7 km ahead of the SP: a Cl 60\+ bridge/.test(row(deck.res.rows, 'Crossings on the axis')?.reason ?? '') && /RL 1 \(bridge\)/.test(row(deck.res.rows, 'Report lines')?.reason ?? ''), `${row(deck.res.rows, 'Crossings on the axis')?.reason?.slice(0, 90)} | ${row(deck.res.rows, 'Report lines')?.reason?.slice(0, 40)}`);
  // the line 40 m beside the bridge (a drawn axis, a raster cell): the bridge is taken as the one used
  const beside = V.fitAdvance(inp(mk((x, y) => (band(y, 2000) ? (x > A.x + 30 && x < A.x + 70 ? BR60 : CANAL) : open))));
  check('the axis passing 30-70 m beside the bridge: the bridge found, not "no bridge"', row(beside.res.rows, 'Crossings on the axis')?.st === 'pass', row(beside.res.rows, 'Crossings on the axis')?.reason?.slice(0, 120));
  // water past the C Tps (under the arrow's head) is not the axis's
  // the C Tps 6 km out on the ground is about 7080 Mercator m here; the arrow's head 300 m (about 355) past them
  const past = (x, y) => (y > A.y + 7200 && y < A.y + 7260 ? CANAL : open);
  const fp = V.fitAdvance(inp(mk(past)));
  const dp = {};
  for (const i of fp.raw.items) { if (dp[i.role]) continue; dp[i.role] = { pts: i.pts.map((p) => { const w = F.toWorld(fp.frame, p); return [w.x, w.y]; }) }; }
  check('a canal just past the C Tps, under the arrow\'s head: neither the build nor Check my plan reads it', row(fp.res.rows, 'Crossings on the axis')?.st === 'pass' && row(V.checkAdvance(inp(mk(past)), dp).rows, 'Crossings on the axis')?.st === 'pass', `${row(fp.res.rows, 'Crossings on the axis')?.reason?.slice(0, 60)} | ${row(V.checkAdvance(inp(mk(past)), dp).rows, 'Crossings on the axis')?.reason?.slice(0, 60)}`);
  // Check my plan reads the axis and RL 1 as drawn
  const dd = {};
  for (const i of b60.raw.items) { if (dd[i.role]) continue; dd[i.role] = { pts: i.pts.map((p) => { const w = F.toWorld(b60.frame, p); return [w.x, w.y]; }) }; }
  const cc = V.checkAdvance(inp(mk(bridged(BR60))), dd);
  check('Check my plan: RL 1 read as drawn (about 1.7 km ahead), the crossing on the Cl 60+ bridge', /RL 1 1\.[67] km ahead of the SP/.test(row(cc.rows, 'Report lines')?.reason ?? '') && row(cc.rows, 'Crossings on the axis')?.st === 'pass', `${row(cc.rows, 'Report lines')?.reason?.slice(0, 80)} | ${row(cc.rows, 'Crossings on the axis')?.st}`);
}

// ── the march (the Move Planner's road engine) and the halting areas ────────────────────────────────────────────────
{
  const O = await import('../../MS/Engines/DeploymentBuilder/PlanOrbat.ts');
  const P = 'MS/Data/Orbat/PK/';
  const orbat = { own: O.mergeOwn(O.OWN_ORBAT_FILES.map((f) => json(`${P}${f}`).units)), en: [], weapons: json(`${P}weapons.json`).weapons };
  const m = V.marchFromOrbat(orbat, json('MS/Data/MoveDoctrine.json'));
  check('serials from the ORBAT: Adv Gd the Armr Regt (116 vehicles), Main Body the IABG less a Regt (HQ 30, 2 Regts 232, MIB 144, Lt AD (SP) Regt 104 = 510), the uncounted named', m?.serials[0].vehicles === 116 && m.serials[1].vehicles === 510 && /not counted.*Med Regt \(SP\)/.test(m.serials[1].known), JSON.stringify(m?.serials.map((s) => [s.name, s.vehicles])));
  check('...road rules from MoveDoctrine: 20 / 15 km/h? no: columns with tanks on good roads 25 / 20, 20 vehicles a km by day', JSON.stringify(m.rules.speedsAll.good) === '[25,20]' && m.rules.density.road.day === 20);
  const CANAL = 20, BR60 = 39;
  const band = (y, y0) => y > A.y + y0 && y < A.y + y0 + 60;
  const gnd = mk((x, y) => (band(y, 2000) || band(y, 4500) ? (Math.abs(x - A.x) < 20 ? BR60 : CANAL) : open));
  const rm = { ...rec, march: m };
  const fm = V.fitAdvance({ ...inp(gnd), recipe: rm });
  const mr = row(fm.res.rows, 'March');
  check('March row: H at first light; each serial\'s column and time past a point; heads at RL 1, RL 2 and the C Tps\' line', !!mr && /first light/.test(mr.reason) && /Adv Gd \(Armr Regt gp\): 116 vehicles/.test(mr.reason) && /at RL 1 H\+0:\d\d, at RL 2 H\+0:\d\d, at the C Tps' line H\+0:\d\d/.test(mr.reason) && /min past a point/.test(mr.reason), mr?.reason.slice(0, 700));
  check('...the Main Body\'s head at the SP after the Adv Gd\'s (6.5 km back at 25 km/h: about H+0:16)', /Main Body: 510 vehicles.*its head at SP H\+0:1[5-7]/.test(mr.reason), mr.reason.match(/Main Body: .{0,400}/)?.[0]);
  check('...the Armr Regt as one road column is 10.0 km long by day (116 at 20 a km plus 2 min a 25 vehicles at 25 km/h): longer than the 8 km to the Main Body, warn', mr.st === 'warn' && /Adv Gd .*10\.0 km long by day/.test(mr.reason) && /Main Body closes on it/.test(mr.reason), mr.st);
  const small = { ...m, serials: [{ ...m.serials[0], vehicles: 60 }, m.serials[1]] };
  const sr = row(V.fitAdvance({ ...inp(gnd), recipe: { ...rec, march: small } }).res.rows, 'March');
  check('...an Adv Gd of 60 vehicles (5.5 km): under the 8 km, pass', sr?.st === 'pass', sr?.reason.match(/Adv Gd[^;]*long by day/)?.[0]);
  const has = fm.raw.items.filter((i) => /^ha\d$/.test(i.role));
  const rl1 = fm.raw.items.find((i) => i.role === 'rl1');
  check('halting areas: HA 1, HA 2, one a report line, 1 km short of it, beside the axis on the right', has.length === 2 && has[0].label === 'HA 1' && rl1 && Math.abs((has[0].pts.reduce((s, p) => s + p.y, 0) / 4) - (rl1.pts[0].y + rl1.pts[1].y) / 2 + 1000) < 5 && has[0].pts.every((p) => p.x > 0) && row(fm.res.rows, 'Halting areas')?.st === 'pass', has.map((h) => `${h.label} ${Math.round(h.pts[0].x)},${Math.round(h.pts[0].y)}`).join(' '));
  const big = { ...m, serials: [{ ...m.serials[0], vehicles: 400 }, m.serials[1]] };
  check('an Adv Gd of 400 vehicles: its column longer than 8 km, the Main Body closes on it: warn', row(V.fitAdvance({ ...inp(gnd), recipe: { ...rec, march: big } }).res.rows, 'March')?.st === 'warn');
  // the settings from the tab: report lines 3 km apart, H at last light
  const gnd3 = mk((x, y) => (band(y, 2000) || band(y, 4500) || band(y, 6000) ? (Math.abs(x - A.x) < 20 ? BR60 : CANAL) : open));
  const r1 = V.fitAdvance({ ...inp(gnd3), recipe: { ...rec, march: m } }), r3 = V.fitAdvance({ ...inp(gnd3), recipe: { ...rec, march: m, advance: { rlApartM: 3000, hAt: 'first' } } });
  const nRl = (f) => f.raw.items.filter((i) => /^rl\d$/.test(i.role)).length;
  check('RL apart set to 3 km: fewer report lines than at the 1 km default, the row says "as set"', nRl(r3) < nRl(r1) && /at least 3\.0 km apart: as set/.test(row(r3.res.rows, 'Report lines').reason) && /the default, E/.test(row(r1.res.rows, 'Report lines').reason), `${nRl(r1)} at 1 km, ${nRl(r3)} at 3 km`);
  const last = V.fitAdvance({ ...inp(gnd), recipe: { ...rec, march: m, advance: { rlApartM: 1000, hAt: 'last' } } });
  check('H at last light: the March row says a night advance; the Main Body (43 km) runs on into the day: warn, past first light', /at last light today there \(civil twilight, as set: a night advance\)/.test(row(last.res.rows, 'March').reason), row(last.res.rows, 'March')?.reason.slice(0, 160));
  check('no march on the recipe (no ORBAT): no March row; no report lines, no halting areas', !row(f1.res.rows, 'March') && !f1.raw.items.some((i) => /^ha\d$/.test(i.role)));
}

// ── Check my plan as drawn ───────────────────────────────────────────────────────────────────────────────────────────
// drawn turned to bearing 90 (east): the read takes the axis from the SP toward the C Tps
const turned = { ...f1.frame, bearing: Math.PI / 2 };
const drawn = {};
for (const i of g.items) { if (drawn[i.role]) continue; drawn[i.role] = { pts: i.pts.map((p) => { const w = F.toWorld(turned, p); return [w.x, w.y]; }) }; }
const c1 = V.checkAdvance(inp(mk(() => open)), drawn);
check('Check my plan, drawn facing east: the same rows pass, nothing missing', !!c1 && ['Covering troops', 'Advance Guard', 'Main Body', 'Flank guards', 'Going on the axis'].every((x) => row(c1.rows, x)?.st === 'pass') && !c1.missing.length, c1?.rows.map((r) => `${r.name} ${r.st}`).join(', '));
const d2 = { ...drawn, ctps: { pts: drawn.ctps.pts.map((q) => [q[0] + 4000, q[1]]) } };
const c2 = V.checkAdvance(inp(mk(() => open)), d2);
check('...the C Tps dragged 4 km further out (10 km): Covering troops warns', row(c2.rows, 'Covering troops')?.st === 'warn', row(c2.rows, 'Covering troops')?.reason.slice(0, 60));
const { flankL, flankR, ...noFlanks } = drawn;
const c3 = V.checkAdvance(inp(mk(() => open)), noFlanks);
check('...without the flank guards drawn: they are listed missing, no Flank guards row', c3.missing.length === 2 && !row(c3.rows, 'Flank guards'), c3.missing.join(', '));

console.log(`\n${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
