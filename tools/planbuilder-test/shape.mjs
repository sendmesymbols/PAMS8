// shape.mjs -- posns shaped to the ground, the layout kept as the annex draws it (MS/Engines/DeploymentBuilder/PlanShape.ts
// and PlanFit 1a-1c; user, 27 Nov 2026: turning and stretching posns round features "messes up the whole layout"; take
// the ITG by moving the whole posn, avoid obstacles, never let curves cross, face the threat).
//   node tools/planbuilder-test/shape.mjs          (add --quiet to print only failures and the summary)
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const H = await import('../../MS/Engines/DeploymentBuilder/PlanShape.ts');
const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
const F = await import('../../MS/Engines/DeploymentBuilder/PlanFit.ts');

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const json = (p) => JSON.parse(readFileSync(resolve(repo, p), 'utf8'));
const quiet = process.argv.includes('--quiet');
let fails = 0, n = 0;
function check(name, ok, info = '') {
  n++;
  if (!ok) fails++;
  if (!ok || !quiet) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
}

const doc = { plan: json('MS/Data/PlanDoctrine.json'), ocoka: json('MS/Data/OcokaDoctrine.json') };
const o = doc.plan.fit.outline;
const pr = { scales: o.scales.value, perTenthM: o.perTenthM.value, clearM: o.clearM.value };
const WATER = new Set([4]), NOGO = new Set([9]), BUA = new Set([3]);
const ground = ({ elev = () => 200, cls = () => 2 } = {}) => ({ toWorld: (p) => p, cls, elev, water: WATER, nogo: NOGO, bua: BUA });
const box = { role: 'fwdL', c: { x: 0, y: 0 }, w: 1500, h: 700, turn: 0 };
const span = (pts) => ({ w: Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)), h: Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)) });

// ── the curve (PlanShape) ──────────────────────────────────────────────────────────────────────────────────────────
{
  check('flat ground: the posn keeps its drawn curve', H.shapePosn(box, [], ground(), pr) === null);
  const cls = (x, y) => (x > 640 && y > 200 ? 9 : x < -640 && y > 200 ? 3 : x > 0 && x < 300 && y > 300 ? 4 : 2);
  const sh = H.shapePosn(box, [], ground({ cls }), pr);
  const c = H.curveOf(box, sh);
  check('NO-GO, a built-up area and water under the curve: every point kept off them', !!sh && c.every((p) => cls(p.x, p.y) === 2), c.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' '));
  // a hill all round: the curve bulges at most a quarter of the half-size, the posn keeps its size
  const hill = H.shapePosn(box, [], ground({ elev: (x, y) => 200 + Math.hypot(x, y) / 10 }), pr);
  const sz = span(H.curveOf(box, hill)), sz0 = span(H.curveOf(box));
  check(`higher ground all round: the curve never grows past ${o.scales.value[1]} of its drawn size (the annex's size kept)`, sz.w <= sz0.w * o.scales.value[1] + 1 && sz.h <= sz0.h * o.scales.value[1] + 1, `${Math.round(sz.w)} x ${Math.round(sz.h)} against ${Math.round(sz0.w)} x ${Math.round(sz0.h)}`);
  // two posns 150 m apart with high ground between: the second keeps clear of the first's curve
  const next = { role: 'fwdR', c: { x: 1650, y: 0 }, w: 1500, h: 700, turn: 0 };
  const g = ground({ elev: (x) => 200 + Math.max(0, 60 - Math.abs(x - 825) / 5) });
  const s1 = H.shapePosn(box, [H.curveOf(next)], g, pr), c1 = H.curveOf(box, s1);
  const s2 = H.shapePosn(next, [c1], g, pr), c2 = H.curveOf(next, s2);
  check('two posns with high ground between them: the curves never cross, each 40 m clear of the other', c2.every((p) => H.polyDist(c1, p) >= pr.clearM - 1) && c1.every((p) => H.polyDist(c2, p) >= 0), `nearest ${Math.round(Math.min(...c2.map((p) => H.polyDist(c1, p))))} m`);
}

// ── the fit on a Bn two up (IBB Annex U App 6) ──────────────────────────────────────────────────────────────────────
{
  const rules = json('MS/Data/terrain-bundle/rules.json');
  const goingOf = (p) => ({ nogo: new Set(rules.profiles[p].nogo), caution: new Set(rules.profiles[p].caution ?? []) });
  const mk = (elev = () => 200) => ({
    cls: () => 2, elev, going: goingOf, label: (c) => rules.classes[String(c)]?.label ?? String(c), sight: () => 0.2,
    avenues: () => [{ path: Array.from({ length: 120 }, (_, i) => ({ x: 0, y: 10000 - i * 100 })), lengthM: 12000, goPct: 100, minWidthM: 2000, chokes: [] }],
    pending: () => false, dataLine: () => 'synthetic',
  });
  const ctx = { doc, symbols: json('MS/Data/Symbols.json') };
  const r2 = json('MS/Data/Deployments/Recipes/bn-def-two-up.json');
  const inp = (g, itgAt = null) => ({ recipe: r2, ctx, opts: { alternates: 'none', detail: 'pl' }, ground: g, anchor: { x: 0, y: 0 }, bearing: 0, threat: { x: 0, y: 10000 }, terrain: 'plains', itgAt });
  const f0 = F.fitLayout(inp(mk()));
  const W = (p) => F.toWorld(f0.frame, p);
  const slot = (fl, role) => fl.raw.slots.find((s) => s.role === role);
  const groundRow = (fl, role) => fl.fit.slots[role]?.find((c) => c.name === 'Ground')?.reason ?? '';

  // a Vital Gr 200 m beyond A Coy's front edge: A Coy moves forward whole, keeps its size, the VG inside it
  const fv = F.fitLayout(inp(mk(), [{ at: W({ x: -1000, y: 1200 + 350 + 200 }), label: 'VG 4' }]));
  const a0 = slot(f0, 'fwdL'), a1 = slot(fv, 'fwdL');
  check('a Vital Gr 200 m beyond A Coy: A Coy moves forward whole to take it in, 100 m inside its edge, the Ground row says so', a1.centre.y - a0.centre.y > 290 && a1.centre.y - a0.centre.y < 310 && Math.abs(a1.centre.x - a0.centre.x) < 1 && /moved 300 m to take in VG 4/.test(groundRow(fv, 'fwdL')), `${Math.round(a1.centre.y - a0.centre.y)} m; ${groundRow(fv, 'fwdL')}`);
  check('...its size and shape kept (1500 x 700 m, as the annex draws it)', a1.wM === 1500 && a1.hM === 700);
  // a Vital Gr 300 m out on A Coy's open flank: moving A out would open the gap to B to 900 m: refused, said why
  const ff = F.fitLayout(inp(mk(), [{ at: W({ x: -1750 - 300, y: 1200 }), label: 'VG 9' }]));
  check('a Vital Gr out on the flank: the move would open the gap past the row (500 m), so A Coy stays and the row says why', Math.abs(slot(ff, 'fwdL').centre.x - a0.centre.x) < 1 && /VG 9 not taken in: it would open a gap of .* between the forward posns/.test(groundRow(ff, 'fwdL')), groundRow(ff, 'fwdL'));
  // a hill 400 m out on A Coy's flank: the high-ground move does not drag A away from B either
  const hillW = W({ x: -1000 - 1000, y: 1200 });
  const fh = F.fitLayout(inp(mk((x, y) => 200 + Math.max(0, 80 - Math.hypot(x - hillW.x, y - hillW.y) / 8))));
  const gapAB = slot(fh, 'fwdR').centre.x - slot(fh, 'fwdR').wM / 2 - (slot(fh, 'fwdL').centre.x + slot(fh, 'fwdL').wM / 2);
  check('a hill out on A Coy\'s flank: the high-ground move keeps the gap to B Coy within the row (550 m at most)', gapAB <= 551, `gap ${Math.round(gapAB)} m`);
  // depth Coys stay behind the Coys they back
  const okBehind = ['depth', 'res'].every((r) => Math.abs(slot(fh, r).centre.x - slot(f0, r).centre.x) <= slot(f0, r).wM / 2 + 1);
  check('...and the depth Coys stay behind the Coys they back (Annex U App 6)', okBehind);
  // rough ground: no two curves cross
  const rough = F.fitLayout(inp(mk((x, y) => 200 + 40 * Math.sin(x / 300) * Math.cos(y / 260))));
  const bps = rough.res.items.filter((i) => ['fwdL', 'fwdR', 'depth', 'res'].includes(i.role));
  const cross = bps.some((a) => bps.some((b) => a !== b && a.pts.some((p) => H.insidePoly(b.pts, p))));
  check('rough ground: no posn\'s curve crosses into another', !cross);
  check('...no posn turned (the annex line-up kept): the Pl posns square in their Coy', rough.res.items.filter((i) => /Pl$/.test(i.role)).every((i) => Math.abs(i.pts[2].y - i.pts[4].y) < 1));
}

console.log(`\n${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
