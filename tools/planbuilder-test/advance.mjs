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
check('Fig 2 figures from PlanDoctrine.advance: C Tps 4-8 km, Van Gd 3.5 km, Main Gd 3 km, flank 6 km, Main Body 8 km', JSON.stringify(F0.ctps) === '[4000,8000]' && F0.van === 3500 && F0.main === 3000 && F0.flank === 6000 && F0.body === 8000);
const g = S.solveRecipe(rec, ctx, {});
const rows = V.advanceRows(g.items, doc);
check('geometry: Covering troops, Advance Guard, Main Body and Flank guards all pass as laid', ['Covering troops', 'Advance Guard', 'Main Body', 'Flank guards'].every((x) => row(rows, x)?.st === 'pass'), rows.map((r) => `${r.name} ${r.st}`).join(', '));
check('...each says the figures are read off a highlighted scan (uncertain)', rows.every((r) => /uncertain/.test(r.reason)));
check('...C Tps 6.0 km ahead, the Main Body 8.0 km behind the head', /^6\.0 km ahead/.test(row(rows, 'Covering troops').reason) && /^8\.0 km behind/.test(row(rows, 'Main Body').reason));
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
check('a canal 60 Mercator m wide 2000 Mercator m ahead (1.7 km on the ground at this latitude): under 200 m, pass; the stretch named', row(f2.res.rows, 'Going on the axis')?.st === 'pass' && /longest NO-GO stretch [4-8]0 m 1\.7 km ahead/.test(row(f2.res.rows, 'Going on the axis').reason), row(f2.res.rows, 'Going on the axis')?.reason);
const f3 = V.fitAdvance(inp(mk(marsh)));
check('a marsh 800 m deep across the axis 3 km back: over 500 m, fail, with the fix', row(f3.res.rows, 'Going on the axis')?.st === 'fail' && /bridge or a detour/.test(row(f3.res.rows, 'Going on the axis').reason), row(f3.res.rows, 'Going on the axis')?.reason);
const f4 = V.fitAdvance(inp(mk((x, y) => (x < A.x - 4000 ? nogo : open))));
check('the left flank guard on NO-GO for tracks: warn', row(f4.res.rows, 'Flank guards\' ground')?.st === 'warn' && /left flank guard on class \d+ \(NO-GO/.test(row(f4.res.rows, 'Flank guards\' ground').reason), row(f4.res.rows, 'Flank guards\' ground')?.reason);
check('the fit lays the plan where it was clicked, the SP at the anchor; mode terrain', f1.res.mode === 'terrain' && Math.hypot(F.toWorld(f1.frame, g.items.find((i) => i.role === 'sp').pts[0]).x - A.x, F.toWorld(f1.frame, g.items.find((i) => i.role === 'sp').pts[0]).y - A.y) < 1);
const f5 = F.fitLayout(inp(mk(() => open)));
check('PlanFit.fitLayout hands an advance to fitAdvance', !!f5 && !!row(f5.res.rows, 'Going on the axis'));

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
