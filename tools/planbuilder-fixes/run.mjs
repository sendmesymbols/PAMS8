// run.mjs -- checks the Plan Builder review fixes of 23 Nov 2026 (MS/Engines/DeploymentBuilder pure modules).
//   node tools/planbuilder-fixes/run.mjs          (add --quiet to print only failures and the summary)
// Kept apart from tools/planbuilder-test (owned by the Deployment Mgr work) so the two can move on their own; fold these
// checks into the suite they belong to when convenient. Synthetic ground in Web Mercator round 0,0 (k = 1: a metre is a
// metre), the plan facing north, as fit.mjs draws it.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
const F = await import('../../MS/Engines/DeploymentBuilder/PlanFit.ts');
const W = await import('../../MS/Engines/DeploymentBuilder/PlanWhatIf.ts');
const A = await import('../../MS/Engines/DeploymentBuilder/PlanArty.ts');
const AD = await import('../../MS/Engines/DeploymentBuilder/PlanAD.ts');
const PE = await import('../../MS/Engines/DeploymentBuilder/PlanEngr.ts');
const PA = await import('../../MS/Engines/DeploymentBuilder/PlanAttack.ts');
const PT = await import('../../MS/Engines/DeploymentBuilder/PlanTanks.ts');
const PP = await import('../../MS/Engines/DeploymentBuilder/PlanPhase.ts');
const PC = await import('../../MS/Engines/DeploymentBuilder/PlanCrossing.ts');

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
const goingOf = (p) => ({ nogo: new Set(rules.profiles[p]?.nogo ?? []), caution: new Set(rules.profiles[p]?.caution ?? []) });
const row = (rows, name) => rows?.find((r) => r.name === name);

function ground({ cls = () => 2, elev = () => 200, sight = () => 0.2, avenues = 'centre' } = {}) {
  return {
    cls, elev, going: goingOf, label: (c) => rules.classes[String(c)]?.label ?? `Class ${c}`, sight: (ox, oy, e, tx, ty) => sight(tx, ty),
    // 'centre': one approach; 'two': a main one and a secondary one bending in from 3.6 km out (whatif.mjs's ground)
    avenues: avenues === 'none' ? () => [] : (from) => (avenues === 'two' ? [0, 3600] : [0]).map((ax, i) => {
      const path = []; for (let y = from.y; y >= -500; y -= 100) path.push({ x: i === 0 ? ax : ax - (ax * Math.max(0, 2000 - y)) / 2500, y });
      return { path, lengthM: from.y, goPct: 100, minWidthM: 900, chokes: [] };
    }),
    pending: () => false, dataLine: () => 'synthetic',
  };
}
const inp = (recipe, g, extra = {}) => ({ recipe, ctx, opts: { alternates: 'visible' }, ground: g, anchor: { x: 0, y: 0 }, bearing: 0, threat: { x: 0, y: 8000 }, ...extra });

// ── 1. the ground's kind needs a class sample: elevation alone is not plains ──────────────────────────────────────
{
  const r2 = rec('bn-def-two-up');
  const res = S.solveRecipe(r2, ctx, {});
  const f = { anchor: { x: 0, y: 0 }, bearing: 0, k: 1, pivot: res.items.find((i) => i.id === res.pivotId).pts[0] };
  const onlyElev = ground({ cls: () => null });
  check('Terrain: elevation in, class tiles not yet: not known (null), never "plains, read from the terrain"', F.detectTerrain(onlyElev, f, res, r2, doc) === null);
  const plain = ground();
  check('...with class data on flat open ground: plains, from the terrain', F.detectTerrain(plain, f, res, r2, doc)?.kind === 'plains');
}

// ── 2. fields of fire: under the 200 m minimum fails (the ladder had two warn steps and never failed at 100-200 m) ──
{
  // a wood 150 m in front of every forward posn: clear about 150 m
  const r2 = rec('bn-def-two-up');
  const fl0 = F.fitLayout(inp(r2, ground()));
  const fwdY = Math.max(...fl0.raw.slots.filter((s) => r2.slots.find((x) => x.role === s.role)?.kind === 'fwd').map((s) => F.toWorld(fl0.frame, { x: 0, y: s.centre.y + s.hM / 2 }).y));
  const wood = (x, y) => (y > fwdY + 150 && y < fwdY + 400 ? 31 : 2);
  const sightW = (tx, ty) => (ty > fwdY + 150 ? 0.1 : 0.9);
  const fl = F.fitLayout(inp(r2, ground({ cls: wood, sight: sightW })));
  const fof = fl.res.slots.flatMap((s) => s.checks).filter((c) => c.name === 'Fd of fire');
  check('Fd of fire: about 150 m clear against the 200 m minimum (IBB p279) fails, not warns', fof.length > 0 && fof.every((c) => c.st === 'fail'), fof.map((c) => `${c.st}: ${c.reason.slice(0, 40)}`).join(' | '));
}

// ── 3. all round: a posn turned 120 / 240 has no flanks either ────────────────────────────────────────────────────
{
  const fl = F.fitLayout(inp(rec('coy-def-all-round'), ground()));
  check('Flanks: Coy Def all round (posns turned 120 / 240) has no flanks, as the Bn all round', row(fl.res.rows, 'Flanks')?.st === 'unchecked', row(fl.res.rows, 'Flanks')?.reason);
}

// ── 4. no approach found is not a Pass ──────────────────────────────────────────────────────────────────────────
{
  const fl = F.fitLayout(inp(rec('bn-def-two-up'), ground({ avenues: 'none' })));
  check('Approaches covered: none found is grey (the search may have failed), never a Pass', row(fl.res.rows, 'Approaches covered')?.st === 'unchecked', row(fl.res.rows, 'Approaches covered')?.reason);
}

// ── 5. what-if: the Sup posn is timed where it is drawn; the alternate's move has one time ───────────────────────
{
  const r2 = rec('bn-def-two-up');
  const i = inp(r2, ground({ avenues: 'two' }));
  const fl = W.withMoves(F.fitLayout(i), i);
  const sups = fl.whatIf.sups;
  const drawn = fl.raw.items.filter((it) => it.role === 'sup');
  const ok = sups.every((s) => { const t = fl.whatIf.triggers.find((x) => x.id === `sup-${s.apch}`); const end = t?.route?.pts?.[t.route.pts.length - 1]; return !end || (Math.abs(end.x - s.centre.x) < 1 && Math.abs(end.y - s.centre.y) < 1); });
  check('Sup posn: the reserve\'s route ends where the Sup posn is drawn (timed after it is cleared of the others)', ok && sups.length > 0 && drawn.length === sups.length, `${sups.length} Sup, ${drawn.length} drawn`);
  // the alternates' times: PlanSolve's row and the what-if's trigger on open ground agree (foot 4 km/h x 1.5 + 5 min)
  const res = S.solveRecipe(r2, ctx, { alternates: 'visible' });
  const alt = res.alternates[0];
  const slot = res.slots.find((s) => s.role === alt.of);
  const km = Math.hypot(alt.centre.x - slot.centre.x, alt.centre.y - slot.centre.y) / 1000;
  check('Alternates row: on foot at 4 km/h (IPB p 18), half as long again under shelling, + 5 min: the what-if\'s figures', Math.abs(alt.min - Math.round(km * 15 * 1.5 + 5)) <= 1, `${alt.label} ${alt.min} min for ${km.toFixed(2)} km`);
  // NaN never reaches the text
  check('What-if: no enemy time reads NaN', fl.whatIf.triggers.every((t) => t.enemyMin === null || Number.isFinite(t.enemyMin)) && !/NaN/.test(JSON.stringify(fl.res.rows)));
}

// ── 6. an assumed enemy start says its own distance ──────────────────────────────────────────────────────────────
{
  const rc = rec('coy-def-two-up');
  const i = inp(rc, ground(), { threat: null });
  const fl = W.withMoves(F.fitLayout(i), i);
  const words = W.enemyStartWords(fl.whatIf);
  check('Assumed start: a Coy plan says 3.0 km out (the distance used), not 5 km', fl.whatIf.enemyStartAssumed && /3\.0 km out/.test(words), words);
}

// ── 7. artillery: an attack's gun area clear of the Assy Area; Coy and Bde plans take one too ─────────────────────
{
  const ad = { defMinM: 1000, attkMinM: 1000, defMaxFrac: 1 / 3, attkMaxFrac: 1 / 3, regtM: [1000, 1000], btyM: [400, 200], room: [0.9, 0.7], src: { band: 'GunDoctrine front', area: 'GunDoctrine areas' } };
  const fd = { id: 'fd', name: 'Fd Regt', unit: 'regt', guns: 18, partner: null, weapon: { id: 'w', name: '122 mm How', planM: 10620, maxM: 11800, minM: 0, sp: false }, src: 'test' };
  const box = (s) => { const r = s.shape.rect; return [r.acrossM - r.wM / 2, r.backM - r.hM / 2, r.acrossM + r.wM / 2, r.backM + r.hM / 2]; };
  const clearOf = (a, b) => a[2] + 100 <= b[0] || a[0] - 100 >= b[2] || a[3] + 100 <= b[1] || a[1] - 100 >= b[3];
  // an attack with its Assy Area moved to where the gun area would go: the gun area steps aside
  const atk = rec('bn-attk-frontal');
  const busy = { ...atk, slots: atk.slots.map((s) => (s.role === 'assy' ? { ...s, shape: { rect: { acrossM: 1500, backM: 3000, wM: 1000, hM: 700 } } } : s)) };
  const g = A.withArty(busy, doc, A.artyOnPlan(fd, 'attack', ad));
  const ga = g.slots.find((s) => s.role === 'gunArea'), assy = g.slots.find((s) => s.role === 'assy');
  check('Gun area (attack): 100 m clear of the Assy Area sitting where it would have gone', !!ga && clearOf(box(ga), box(assy)), JSON.stringify(ga?.shape?.rect));
  const coy = A.withArty(rec('coy-def-two-up'), doc, A.artyOnPlan({ ...fd, unit: 'bty', name: 'Fd Bty', guns: 6 }, 'defence', ad));
  check('Gun area: a Coy defence takes its support Bty\'s gun area', coy.slots.some((s) => s.role === 'gunArea'), coy.id);
}

// ── 8. AD: the bridges and gun areas get their wanted FUs first ─────────────────────────────────────────────────
{
  const r = rec('bde-cross-two-up');
  const vps = AD.vpsOf(r, doc);
  const first = vps.filter((v) => v.pri === 1);
  const fus = Array.from({ length: first.length * 2 }, (_, i) => ({ name: `FU ${i + 1}`, effM: 4000, kind: 'gun' }));
  const a = { name: 'AD Bty', fus, releaseM: 1500, minFus: 2, siteM: [300, 1000], assumedNote: null };
  const out = AD.withAd(r, doc, a);
  const near = (v) => out.slots.filter((s) => /^ad\d+$/.test(s.role) && Math.hypot(s.shape.at[0] - v.x, s.shape.at[1] - v.y) <= 1001).length;
  check(`AD: ${fus.length} FUs over ${first.length} first-priority VPs: each gets 2 (ad.minFus), none spread to the HQ first`, first.length > 0 && first.every((v) => near(v) >= 2), first.map((v) => `${v.role}:${near(v)}`).join(' '));
}

// ── 9. a blank raft cell is not an infinite time ───────────────────────────────────────────────────────────────
{
  const kinds = { rafts: { cn3: { label: 'Ribbon raft (Chinese, 3 bays, Cl 60)', cls: 60, buildMin: [20, 25, 30], tripsPerH: [6, 4, 0], page: '431' }, us5: null } };
  const rf = PE.engrRafts({ name: 'Br Bn Engrs', ribbon: 2 }, 250, 0, kinds);
  check('Engr rafts: the table prints no trips for a 300 m column: not checked, never "H+Infinity"', rf?.row?.st === 'unchecked' && rf.firstMin === null && !/Infinity/.test(rf.row.reason), rf?.row?.reason);
}

// ── 10. ATGM on the Obj: a range the ORBAT lacks is said as assumed ──────────────────────────────────────────────
{
  const res = S.solveRecipe(rec('bn-attk-frontal'), ctx, {});
  const ca = { apchs: [{ from: 'N', df: { x: 0, y: -2400 }, seenPct: 80 }] };
  const r = PA.atOnObj(ca, res, [{ name: 'Baktar Shikan', count: 4, rangeM: null }], doc, '15111200');
  check('AT on the Obj: no range in the ORBAT: the figure used is said to be assumed (E)', !!r && /assumed, E/.test(r.row.reason), r?.row?.reason?.slice(-120));
}

// ── 11. phase 2 and the tanks read the BOF's side the same way (where it sits) ──────────────────────────────────
{
  const fr = rec('bn-attk-frontal');
  const flipped = { ...fr, slots: fr.slots.map((s) => (s.role === 'bof' ? { ...s, shape: { ...s.shape, ctrl: [-Math.abs(s.shape.base[0][0]), s.shape.ctrl?.[1] ?? 0] } } : s)) };
  const bx = flipped.slots.find((s) => s.role === 'bof').shape.base;
  const bofSide = Math.sign(bx.reduce((a, p) => a + p[0], 0));
  check('Phase 2 side: away from where the BOF sits (its base), whatever way it fires', PP.defaultSide(flipped) === -bofSide, `BOF base x ${bofSide}, phase 2 side ${PP.defaultSide(flipped)}`);
}

// ── 12. tank times added twice are not doubled; an empty drawn crossing reads nothing ────────────────────────────
{
  const res = S.solveRecipe(PT.withTanks(rec('bn-attk-frontal'), doc, 'fire'), ctx, {});
  const h = PA.attackTimes(res, null, null, doc, 'plains', true, null);
  PT.addTankTimes(h, res, null, null, doc, true, 'fire', null);
  const once = h.steps.length;
  PT.addTankTimes(h, res, null, null, doc, true, 'fire', null);
  check('Tank timing run again on the same sum: the steps replaced, not doubled', h.steps.length === once, `${once} then ${h.steps.length}`);
  const c = PC.checkCrossing(inp(rec('bn-cross-two-up'), ground()), {});
  check('Check my plan on a crossing with nothing drawn: null, not a -Infinity reach', c === null);
}

// ── 13. a profile the rules lack is never all GO ──────────────────────────────────────────────────────────────────
{
  const src = readFileSync(resolve(repo, 'MS/Engines/DeploymentBuilder/PlanGroundProbe.ts'), 'utf8');
  check('Ground probe: a missing "gun" profile falls back to the tracked going (source)', /profile === 'gun' \? P\.tracked/.test(src));
}

console.log(`\n${n - fails} of ${n} checks passed`);
process.exit(fails ? 1 : 0);
