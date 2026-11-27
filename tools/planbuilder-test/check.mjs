// check.mjs -- checks the enemy and terrain context (PlanContext.ts, used by PlanFit / PlanWhatIf) and Check my plan
// (PlanCheck.ts) on the sample plans in MS/Data/Deployments/Plans/Own.
//   node tools/planbuilder-test/check.mjs          (add --quiet to print only failures and the summary)
// Context on synthetic ground round 0,0 (a metre is a metre), the Bn two up facing north, the enemy 8 km out: the
// enemy's echelon sizes the approaches (a narrow one carries less than his main effort), his type sets the going and
// the times, his FUP is watched or not, the force ratio, and the ground's kind (obstacle, desert, mountains) read off
// the ground changes the frontage allowed, the gaps, the flanks and the foot rates. Then the samples: Bde Def (12 Bde,
// own only, a DCB in front), Bn Def (a Coy with three Pls and the enemy's Bn attack drawn), Div Attk (own Bde attack
// on an enemy Bn's Coy posns).
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const C = await import('../../MS/Engines/DeploymentBuilder/PlanContext.ts');
const F = await import('../../MS/Engines/DeploymentBuilder/PlanFit.ts');
const W = await import('../../MS/Engines/DeploymentBuilder/PlanWhatIf.ts');
const K = await import('../../MS/Engines/DeploymentBuilder/PlanCheck.ts');

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
const r2 = json('MS/Data/Deployments/Recipes/bn-def-two-up.json');
const row = (rows, name) => rows.find((r) => r.name === name);

// ── the enemy ──────────────────────────────────────────────────────────────────────────────────────────────────────
check('default enemy for a Bn defence: an en Bde, mech (one level up, 3 : 1)', (() => { const e = C.defaultEnemy(doc, '16'); return e.echelon === '18' && e.type === 'mech'; })());
check('default enemy for a Coy defence: an en Bn', C.defaultEnemy(doc, '15').echelon === '16');
check('default enemy in the mountains: infantry (MW pp 238-239)', C.defaultEnemy(doc, '16', 'mountain').type === 'inf');
check('default enemy for a Bn attack: the defender one level down, an en Coy', C.defaultEnemy(doc, '16', null, 'attack').echelon === '15');
check('an en Bde attacks on Bn corridors 1.5 km wide (IPB p 7)', C.enemyCorridorM(doc, '18') === 1500 && C.enemyCorridorM(doc, '16') === 500 && C.enemyCorridorM(doc, '21') === 3000);
check('an approach 900 m wide at its narrowest carries an en Bn, not a Bde', C.approachCarries(doc, 900) === '16');
check('1.6 km carries an en Bde; 3.2 km an en Div', C.approachCarries(doc, 1600) === '18' && C.approachCarries(doc, 3200) === '21');
check('Inf comes on foot, Mech / Armd tracked', C.enemyProfile(doc, 'inf') === 'dismounted' && C.enemyProfile(doc, 'armd') === 'tracked');
check('en Inf FUP 1000-1200 m (IBB p201); tanks 2500-3000 m (IBB p214)', C.enemyFupM(doc, 'inf')[0] === 1000 && C.enemyFupM(doc, 'mech')[0] === 2500);
const fr = (en) => C.forceRow(doc, 'defence', '16', { echelon: en, type: 'mech', source: 'user' });
check('force: an en Bde on a Bn is the 3 : 1 it plans to hold (pass)', fr('18').st === 'pass', fr('18').reason);
check('force: an en Div on a Bn is more than it holds alone (warn)', fr('21').st === 'warn', fr('21').reason);
check('force: an en Bn on a Bn is short of 3 : 1 (a probe or raid)', fr('16').st === 'pass' && /short of/.test(fr('16').reason));
const fa = C.forceRow(doc, 'attack', '16', { echelon: '15', type: 'inf', source: 'default' });
check('force: a Bn attacking an en Coy is 3 : 1, the usual superiority (IBB p 248)', fa.st === 'pass' && fa.name === 'Force ratio' && /IBB S47 para 17 a p 248/.test(fa.reason), fa.reason);
const fm = C.forceRow(doc, 'attack', '16', { echelon: '15', type: 'inf', source: 'default' }, 3, 1, {}, 'mountain');
check('force in mountains: exactly 3 : 1 is not enough, more than 3 : 1 in sequence (MW p 80)', fm.st === 'warn' && /about 3 : 1/.test(fm.reason) && /MW p 80/.test(fm.reason) && /in sequence/.test(fm.reason), fm.reason);
const fm4 = C.forceRow(doc, 'attack', '16', { echelon: '15', type: 'inf', source: 'default' }, 4, 1, {}, 'mountain');
check('force in mountains: 4 : 1 passes', fm4.st === 'pass', fm4.reason);

// ── the fit with the enemy ─────────────────────────────────────────────────────────────────────────────────────────
function ground({ cls = () => 2, elev = () => 200, sight = () => 0.2, avenues = null, calls = [] } = {}) {
  return {
    cls, elev, going: goingOf, label: (c) => rules.classes[String(c)]?.label ?? String(c), sight,
    avenues: (from, to, frontageM, profile) => {
      calls.push({ frontageM, profile });
      return (avenues ?? [{ x: 0, chokes: [] }, { x: 3600, chokes: [] }]).map((a) => {
        const path = []; for (let y = 8000; y >= -500; y -= 100) path.push({ x: a.x - (a.x * Math.max(0, 2000 - y)) / 2500, y });
        return { path, lengthM: 8000, goPct: 100, minWidthM: 2000, chokes: a.chokes };
      });
    },
    pending: () => false, dataLine: () => 'synthetic',
  };
}
const fitIn = (g, more = {}) => ({ recipe: r2, ctx, opts: { alternates: 'visible' }, ground: g, anchor: { x: 0, y: 0 }, bearing: 0, threat: { x: 0, y: 8000 }, ...more });
const bde = { echelon: '18', type: 'mech', source: 'user' };
{
  const calls = [];
  // A1 (least cost) has a 900 m choke; A2 has none: for an en Bde, A2 is the main approach
  const g = ground({ calls, avenues: [{ x: 0, chokes: [{ at: { x: 0, y: 3000 }, widthM: 900, label: 'Narrow Gr' }] }, { x: 3600, chokes: [] }] });
  const fl = F.fitLayout(fitIn(g, { enemy: bde, terrain: 'plains' }));
  const ap = fl.fit.approaches;
  check('approaches found tracked for a mech enemy, chokes against his 1.5 km corridors', calls[0]?.profile === 'tracked' && calls[0]?.frontageM === 1500, JSON.stringify(calls[0]));
  check('a 900 m choke: that approach carries an en Bn at most', ap[0].full === false && ap[0].carries === '16');
  check('the main approach is the one that carries his Bde', ap[1].main && !ap[0].main);
  const ac = row(fl.res.rows, 'Approaches covered');
  check('the reason names the capacity', /narrow: an en Bn at most/.test(ac.reason) && /takes an en Bde/.test(ac.reason), ac.reason);
  check('the En force and Terrain rows join the checks', !!row(fl.res.rows, 'En force') && row(fl.res.rows, 'Terrain')?.reason.startsWith('Plains'));
  const fup = row(fl.res.rows, 'En FUP');
  check('his likely FUP on the main approach 2.5-3 km out, dead ground here: watch it (warn)', fup?.st === 'warn' && /2\.\d km out/.test(fup.reason), fup?.reason);
  const fl2 = F.fitLayout(fitIn(ground({ sight: () => 0.9 }), { enemy: bde, terrain: 'plains' }));
  check('his FUP in view from a forward posn: pass', row(fl2.res.rows, 'En FUP')?.st === 'pass', row(fl2.res.rows, 'En FUP')?.reason);
  const flW = W.withMoves(F.fitLayout(fitIn(ground(), { enemy: bde, terrain: 'plains' })), fitIn(ground(), { enemy: bde, terrain: 'plains' }));
  const inf = { echelon: '18', type: 'inf', source: 'user' };
  const callsI = [];
  const flI = W.withMoves(F.fitLayout(fitIn(ground({ calls: callsI }), { enemy: inf, terrain: 'plains' })), fitIn(ground(), { enemy: inf, terrain: 'plains' }));
  check('an infantry enemy: approaches on foot', callsI[0]?.profile === 'dismounted');
  check('an infantry enemy is slower to the FDL than tanks (IPB p 18: 4 against 24 km/h)', flI.whatIf.enemyToFdlMin > 5 * flW.whatIf.enemyToFdlMin, `${flI.whatIf.enemyToFdlMin} against ${flW.whatIf.enemyToFdlMin} min`);
  check('the wording follows his type', flI.whatIf.mover === 'leading infantry' && flW.whatIf.mover === 'lead vehicles');
}

// ── the kind of ground ─────────────────────────────────────────────────────────────────────────────────────────────
{
  // a canal 300 m in front of the FDL, all along it (the FDL's world y read off the plan: the click is on the Bn HQ)
  const fl0 = F.fitLayout(fitIn(ground(), { enemy: bde, terrain: 'plains' }));
  const fdlW = Math.max(...fl0.raw.slots.filter((s) => s.role.startsWith('fwd')).map((s) => F.toWorld(fl0.frame, { x: s.centre.x, y: s.centre.y + s.hM / 2 }).y));
  const fl = F.fitLayout(fitIn(ground({ cls: (x, y) => (y > fdlW + 250 && y < fdlW + 350 ? 20 : 2) }), { enemy: bde, terrain: 'auto' }));
  check('Auto reads a canal in front as an obstacle', fl.terrain.kind === 'obstacle' && fl.terrain.source === 'auto', JSON.stringify(fl.terrain));
  check('the obstacle tie-in: the canal under the forward posns\' fire', row(fl.res.rows, 'Obstacle tie-in')?.st === 'pass', row(fl.res.rows, 'Obstacle tie-in')?.reason);
  const flFar = F.fitLayout(fitIn(ground({ cls: (x, y) => (y > fdlW + 1250 && y < fdlW + 1350 ? 20 : 2) }), { enemy: bde, terrain: 'obstacle' }));
  check('a canal 1.3 km out is beyond the MGs: warn, move up or a mask posn', row(flFar.res.rows, 'Obstacle tie-in')?.st === 'warn', row(flFar.res.rows, 'Obstacle tie-in')?.reason);
  const al = C.frontageAllowance(doc, '16', 'obstacle');
  // frontages from the books, own rows only (24 Nov 2026): the Foxland (enemy) rows of IC s113 are never own
  check('on an obstacle a Bn holds 2750-4115 m (IBB Annex V p 483, x = yards), not the Foxland 6 km', al?.range[0] === 2750 && al?.range[1] === 4115 && /IBB Annex V p 483/.test(al?.src ?? ''), al?.src);
  const onOb = (m) => row(C.applyContext([{ name: 'Frontage', st: 'pass', reason: '' }], doc, '16', 'defence', m, 2, null, { kind: 'obstacle', source: 'user' }), 'Frontage');
  check('on an obstacle 4 km passes, 5.5 km fails (IBB Annex V: up to 4115 m)', onOb(4000).st === 'pass' && onOb(5500).st === 'fail', `${onOb(4000).st} / ${onOb(5500).st}: ${onOb(5500).reason}`);
  check('mountains: no own Bn figure in MW, so three up is held to IBB\'s extended 6.5 km (the Foxland 6-8 km is the enemy\'s)', C.frontageAllowance(doc, '16', 'mountain', 3)?.range[1] === 6500 && !/Mountain infantry battalion/.test(C.frontageAllowance(doc, '16', 'mountain', 3)?.src ?? ''), C.frontageAllowance(doc, '16', 'mountain', 3)?.src);
  // frontages by the ground (user, 24 Nov 2026: extended frontages in the desert, large ones in mountains, DW / MW):
  // plains normal 3-5 km (IBB p 277), extended (IBB S59, Annex U) warns there; the desert and mountains pass extended
  const fv = (kind, n, m) => C.applyContext([{ name: 'Frontage', st: 'pass', reason: '' }, { name: 'Gaps', st: 'warn', reason: 'widest 1.2 km' }], doc, '16', 'defence', m, n, null, { kind, source: 'user' });
  check('plains: a Bn two up on 4.5 km passes, the normal 3-5 km (IBB p 277)', row(fv('plains', 2, 4500), 'Frontage').st === 'pass' && /IBB S53 para 4 c p 277/.test(row(fv('plains', 2, 4500), 'Frontage').reason), row(fv('plains', 2, 4500), 'Frontage').reason);
  check('plains: three up on 6 km warns: an extended frontage (IBB S59 p 325), with a fix', row(fv('plains', 3, 6000), 'Frontage').st === 'warn' && /extended frontage/.test(row(fv('plains', 3, 6000), 'Frontage').reason) && row(fv('plains', 3, 6000), 'Frontage').detail?.fix?.length === 2, row(fv('plains', 3, 6000), 'Frontage').reason);
  check('plains: three up on 7 km fails (beyond Annex U App 6, 6.5 km)', row(fv('plains', 3, 7000), 'Frontage').st === 'fail', row(fv('plains', 3, 7000), 'Frontage').reason);
  check('desert: three up on 6 km passes, extended ground (DW p 24, p 56); its gaps accepted', row(fv('desert', 3, 6000), 'Frontage').st === 'pass' && /DW p 24/.test(row(fv('desert', 3, 6000), 'Frontage').reason) && row(fv('desert', 3, 6000), 'Gaps').st === 'pass', row(fv('desert', 3, 6000), 'Frontage').reason);
  check('mountains: three up on 6.5 km passes (MW p 148: frontages generally large); its gaps accepted (MW p 148)', row(fv('mountain', 3, 6500), 'Frontage').st === 'pass' && /MW p 148/.test(row(fv('mountain', 3, 6500), 'Frontage').reason) && /MW p 148/.test(row(fv('mountain', 3, 6500), 'Gaps').reason), row(fv('mountain', 3, 6500), 'Frontage').reason);
  check('mountains: three up on 7.5 km fails (beyond IBB Annex U App 6, 6.5 km)', row(fv('mountain', 3, 7500), 'Frontage').st === 'fail', row(fv('mountain', 3, 7500), 'Frontage').reason);
  // a Bde / Div on extended ground: no figure printed, so beyond its row it warns there and fails in the plains
  const rc = (ech, kind, m) => C.frontageRowCheck(doc, ech, kind, 2, m);
  check('a Bde on 14 km: fails in the plains (OOW1 10-12 km), warns in the desert (DW p 56) and mountains (MW p 148), no figure printed', rc('18', 'plains', 14000).st === 'fail' && rc('18', 'desert', 14000).st === 'warn' && /DW p 56/.test(rc('18', 'desert', 14000).reason) && rc('18', 'mountain', 14000).st === 'warn' && /MW p 148/.test(rc('18', 'mountain', 14000).reason), `${rc('18', 'plains', 14000).st} / ${rc('18', 'desert', 14000).st} / ${rc('18', 'mountain', 14000).st}`);
  check('a Coy on 1.8 km fails in the desert too: never extended (IBB S59 para 6 b p 326)', rc('15', 'desert', 1800).st === 'fail' && /IBB S59 para 6 b p 326/.test(rc('15', 'desert', 1800).reason), rc('15', 'desert', 1800).reason);
  check('a Pl on 550 m passes (IBB App 5 600 m) and names AMP\'s 500 m most', rc('14', 'plains', 550).st === 'pass' && /AMP p 1\.3/.test(rc('14', 'plains', 550).reason), rc('14', 'plains', 550).reason);
  // no source cites the margin table on IBB p 277 ('(Source: ARIB)'): it is a reader's note, not IBB
  {
    const bad = [];
    // an entry (an object) that names the margin note must say, in one of its own strings, that it is not IBB
    const walk = (o, path) => {
      if (!o || typeof o !== 'object') return;
      const own = Object.values(o).filter((v) => typeof v === 'string');
      if (own.some((v) => /ARIB/.test(v)) && !own.some((v) => /not IBB|not AP 8360|reader's/.test(v))) bad.push(path);
      for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
    };
    walk(doc.plan, 'PlanDoctrine'); walk(doc.ocoka, 'OcokaDoctrine');
    check('every mention of the IBB margin tables (Source: ARIB) says they are a typed note by a reader, not IBB', !bad.length, bad.join(', '));
  }
  check('plains: gaps are not accepted by the ground (the row stays a warning)', row(fv('plains', 3, 4800), 'Gaps').st === 'warn');
  check('a Coy frontage is not extended on any ground (IBB S59 para 6 b p 326; AMP p 1.10: 1200-1500 m)', C.frontageAllowance(doc, '15', 'obstacle')?.range[1] === 1500 && /IBB S59 para 6 b p 326/.test(C.frontageAllowance(doc, '15', 'obstacle')?.src ?? ''));
  // desert: sand dunes all round
  const flD = F.fitLayout(fitIn(ground({ cls: () => 14 }), { enemy: bde, terrain: 'auto' }));
  check('Auto reads dunes all round as desert', flD.terrain.kind === 'desert', JSON.stringify(flD.terrain));
  check('desert flanks: the tank threat from any direction (OOW1 pp 68-69)', row(flD.res.rows, 'Flanks')?.st !== 'pass' && /any direction/.test(row(flD.res.rows, 'Flanks')?.reason ?? ''));
  const gd = C.applyContext([{ name: 'Gaps', st: 'warn', reason: 'widest 900 m' }], doc, '16', 'defence', 4000, 2, null, { kind: 'desert', source: 'user' });
  check('desert: large gaps accepted (OOW1 s22 p68)', row(gd, 'Gaps').st === 'pass' && /desert/.test(row(gd, 'Gaps').reason));
  // mountains: a ridge rising 600 m to the north-east
  const hill = (x, y) => 200 + Math.max(0, Math.min(600, (x + y) / 8));
  const flM = F.fitLayout(fitIn(ground({ elev: hill }), { enemy: { echelon: '18', type: 'inf', source: 'user' }, terrain: 'auto' }));
  check('Auto reads a 600 m rise within 5 km as mountains', flM.terrain.kind === 'mountain', JSON.stringify(flM.terrain));
  check('mountains: whether the forward posns dominate the main approach', !!row(flM.res.rows, 'Dominates the approach'), row(flM.res.rows, 'Dominates the approach')?.reason);
  const f0 = { anchor: { x: 0, y: 0 }, bearing: 0, k: 1, pivot: { x: 0, y: 0 } };
  const flat = W.routeOnFoot(ground(), f0, doc, { x: 0, y: 0 }, { x: 0, y: 2000 }, null, false, 'plains');
  const climb = W.routeOnFoot(ground({ elev: (x, y) => 200 + y * 0.3 }), f0, doc, { x: 0, y: 0 }, { x: 0, y: 2000 }, null, false, 'mountain');
  check('mountains: 3 km/h and 30-60 min per 300 m of climb (MW p 81)', climb.min > flat.min * 2, `${climb.min} against ${flat.min} min for 2 km, 600 m up`);
  check('without the bundle Auto stays plains, assumed', F.fitLayout(fitIn({ ...ground({ cls: () => null, elev: () => NaN }), sight: undefined }, { terrain: 'auto' })).terrain.source === 'assumed');
}

// ── Check my plan on the samples ───────────────────────────────────────────────────────────────────────────────────
// the template plans, and the 12 Bde Def kept as a test fixture (taken off the Templates list, 15 Nov 2026)
const sample = (name) => K.recordsFromPlanDoc(json(name === 'Bde Def 12 Bde' ? `tools/planbuilder-test/fixtures/${name}.json` : `MS/Data/Deployments/Plans/Own/${name}.json`));
const flatGround = ground({ sight: () => 0.6 });
{
  const r = K.checkPlan(sample('Bde Def 12 Bde'), doc, {});
  const k = (lbl) => r.posns.find((p) => p.label === lbl)?.kind;
  check('Bde Def: read as a defence of a Bde (Bn posns)', r.task === 'defence' && r.planEch === '18' && r.mapped.posnEch === '16', `${r.task} ${r.planEch} ${r.mapped.posnEch}`);
  check('Bde Def: 27 FF, 26 Punjab, 25 AK forward', k('27 FF') === 'fwd' && k('26 Punjab') === 'fwd' && k('25 AK') === 'fwd', r.posns.map((p) => `${p.label}:${p.kind}`).join(', '));
  check('Bde Def: D2 and D3 (planned) in depth', k('D2') === 'depth' && k('D3') === 'depth');
  check('Bde Def: unlabelled planned outlines over held posns left out (16.2)', r.posns.filter((p) => p.kind === 'ignore').length >= 1);
  const deg = (r.frame.bearing * 180) / Math.PI;
  check('Bde Def: the front read from the arcs of fire, minefields and covering troops (east, assumed)', r.threat.from === 'cues' && deg > 60 && deg < 120 && r.unclear.some((u) => /front is read/.test(u)), `${deg.toFixed(0)} deg`);
  check('Bde Def: the DCB drawn in depth (on the Line of No Pen) is not taken as an obstacle in front', r.terrain.kind === 'plains' && r.terrain.source === 'assumed');
  check('Bde Def: the enemy one level up (an en Div), assumed', r.enemy.echelon === '21' && r.enemy.source === 'default');
  check('Bde Def: the Reserves symbol read as the reserve', r.posns.some((p) => p.kind === 'res' && /Res/.test(p.label)) && /Res to behind/.test(row(r.rows, 'Reserve reach')?.reason ?? ''));
  check('Bde Def: the planned D line named apart from the depth held', /D line, occupied later/.test(row(r.rows, 'Depth')?.reason ?? ''), row(r.rows, 'Depth')?.reason);
  check('Bde Def: the forward posns face the threat (echelon marks on their rear sides)', row(r.rows, 'Facing the threat')?.st === 'pass', row(r.rows, 'Facing the threat')?.reason);
  check('Bde Def: 25 km on plains is more than a Bde holds (OOW1 10-12 km)', row(r.rows, 'Frontage')?.st === 'fail', row(r.rows, 'Frontage')?.reason);
  const ro = K.checkPlan(sample('Bde Def 12 Bde'), doc, { terrain: 'obstacle' });
  const fr = row(ro.rows, 'Frontage');
  check('Bde Def with the ground set to Obstacle: its 26 km judged against a Bde on an obstacle, 8-10 km (GSP 1947 s26, the user\'s choice): fail', fr?.st === 'fail' && /Bde on an obstacle \(GSP 1947 s26 p 119/.test(fr.reason) && /10\.0 km/.test(fr.reason), fr?.reason);
  check('Bde Def: gaps between Bns judged by the minefields drawn across them (OOW1 p82)', /OOW1 p82/.test(row(r.rows, 'Gaps')?.reason ?? ''), row(r.rows, 'Gaps')?.reason);
  check('Bde Def: each Bn locality held to its size', r.slots.every((s) => s.checks.some((c) => c.name === 'Size')));
  check('Bde Def: without the bundle the ground stays grey, never Pass', r.slots.every((s) => s.st !== 'pass'));
  const rg = K.checkPlan(sample('Bde Def 12 Bde'), doc, { ground: flatGround });
  check('Bde Def on ground: approaches and fields of fire read', row(rg.rows, 'Approaches covered')?.st !== 'unchecked' && !!row(rg.rows, 'Fields of fire'), row(rg.rows, 'Approaches covered')?.reason);
  check('Bde Def: Copy as Text', /CHECK MY PLAN: BDE DEFENCE/.test(K.checkText(r)));
}
{
  const r = K.checkPlan(sample('Bn Def'), doc, { ground: flatGround });
  check('Bn Def: a Coy defence, A Coy is the outline holding three Pl posns', r.planEch === '15' && r.posns.find((p) => p.label === 'A Coy')?.kind === 'outline' && r.posns.filter((p) => p.ech === '14').length === 3, r.posns.map((p) => `${p.label}:${p.kind}:${p.ech}`).join(', '));
  check('Bn Def: the front from the enemy symbols', r.threat.from === 'enemy');
  check('Bn Def: the enemy read from his symbols: a Bn with armour (mech)', r.enemy.source === 'symbols' && r.enemy.echelon === '16' && r.enemy.type === 'mech', JSON.stringify(r.enemy));
  check('Bn Def: the force about 3 : 1, the attack it plans for', row(r.rows, 'En force')?.st === 'pass', row(r.rows, 'En force')?.reason);
  check('Bn Def: the drawn en axes read as his approaches', row(r.rows, 'Drawn en axes')?.reason.startsWith('3 enemy axes'), row(r.rows, 'Drawn en axes')?.reason);
  check('Bn Def: the drawn en FUP is the one judged', /drawn en FUP/.test(row(r.rows, 'En FUP')?.reason ?? ''), row(r.rows, 'En FUP')?.reason);
  check('Bn Def: frontage held to a Coy\'s 1200-1500 m (AMP p 1.10), never extended (IBB p 326)', /Coy 1200-1500 m \(AMP p 1\.10/.test(row(r.rows, 'Frontage')?.reason ?? '') && /IBB S59 para 6 b p 326/.test(row(r.rows, 'Frontage')?.reason ?? ''), row(r.rows, 'Frontage')?.reason);
  check('Bn Def: nothing moved (check only)', r.fit && Object.keys(r.fit.nudges).length === 0);
}
{
  const r = K.checkPlan(sample('Div Attk'), doc, {});
  check('Div Attk: read as an attack', r.task === 'attack', r.title);
  check('Div Attk: each axis matched to an enemy posn', r.groups.length >= 4 && r.groups.filter((g) => g.obj).length >= 4, r.groups.map((g) => `${g.label}->${g.obj?.label}`).join(', '));
  check('Div Attk: FUP distances measured', r.groups.some((g) => /to the Obj's near edge/.test(row(g.rows, 'FUP from the Obj')?.reason ?? '')), r.groups.map((g) => row(g.rows, 'FUP from the Obj')?.reason).join(' | '));
  check('Div Attk: the force ratio against the enemy drawn', row(r.rows, 'Force ratio')?.st !== 'unchecked' && r.enemy.source === 'symbols', row(r.rows, 'Force ratio')?.reason);
  check('Div Attk: the ground needs the bundle (grey)', r.groups.every((g) => g.rows.some((c) => c.st === 'unchecked')));
  const rg = K.checkPlan(sample('Div Attk'), doc, { ground: flatGround });
  check('Div Attk on ground: FUP unseen and the going read per axis', rg.groups.some((g) => !!row(g.rows, 'FUP unseen') && !!row(g.rows, 'Approach going')));
}
{
  // the user's roles win; a threat marker sets the front
  const recs = sample('Bde Def 12 Bde');
  const base = K.checkPlan(recs, doc, {});
  const id = base.posns.find((p) => p.label === '25 AK').id;
  const r = K.checkPlan(recs, doc, { kinds: { [id]: 'res' } });
  check('a role set by the user is kept', r.posns.find((p) => p.id === id)?.kind === 'res' && r.posns.find((p) => p.id === id)?.kindWhy === 'set');
  check('...and the reserve reach is then checked', /25 AK to behind/.test(row(r.rows, 'Reserve reach')?.reason ?? ''), row(r.rows, 'Reserve reach')?.reason);
  const none = K.checkPlan(recs.filter((x) => !/DCB|Mine|Arc|Cover/i.test(x.drawEss?.SYM_NAME ?? '')), doc, {});
  check('no enemy, obstacle or marker: the front is asked for', none.threat.from === 'none' && none.unclear.some((u) => /mark the threat/.test(u)));
}

// ── the ground shapes the plan (user, 15 Nov 2026) ─────────────────────────────────────────────────────────────────
const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
{
  const res = S.solveRecipe(r2, ctx, {});
  const a = res.items.find((i) => i.role === 'fwdL');
  const c = res.slots.find((s) => s.role === 'fwdL').centre;
  const m = { x: (a.pts[0].x + a.pts[a.pts.length - 1].x) / 2, y: (a.pts[0].y + a.pts[a.pts.length - 1].y) / 2 };
  check('a built Battle Posn carries its echelon mark on its rear side (away from the enemy)', m.y < c.y - 100, `mark at y ${Math.round(m.y)}, centre ${Math.round(c.y)}`);
  // round trip: the built plan as a Plan document, read back by Check my plan
  const out = S.toPlanDocument(res, (pid, ov, id, de) => ({ plnOrdrSymbolPK: { plnOrdrSymbolId: id }, drawEss: JSON.stringify(de) }), (pid, id, name, seq, syms) => ({ plnOrdrSymbolSet: syms }), 1);
  const rt = K.checkPlan(K.recordsFromPlanDoc(out.doc), doc, { threat: { x: 0, y: 9000 } });
  const kd = (l) => rt.posns.find((p) => p.label === l)?.kind;
  check('round trip: Check my plan reads the built two up as a Bn plan, A and B Coy forward', rt.planEch === '16' && kd('A Coy') === 'fwd' && kd('B Coy') === 'fwd', rt.posns.map((p) => `${p.label}:${p.kind}`).join(', '));
  check('round trip: the built posns face the threat', row(rt.rows, 'Facing the threat')?.st === 'pass', row(rt.rows, 'Facing the threat')?.reason);
  check('round trip: the frontage passes the IBB row', row(rt.rows, 'Frontage')?.st === 'pass', row(rt.rows, 'Frontage')?.reason);
  const rt2 = K.checkPlan(K.recordsFromPlanDoc(out.doc), doc, {});
  const b2 = rt2.frame ? (rt2.frame.bearing * 180) / Math.PI : NaN;
  check('round trip without a marker: the front read from its FEBA and minefield (north), D Coy not forward', Math.abs(b2) < 20 && rt2.posns.find((p) => p.label === 'D Coy')?.kind !== 'fwd', `${b2.toFixed(0)} deg; ${rt2.posns.map((p) => `${p.label}:${p.kind}`).join(', ')}`);
  check('round trip: a Bn of 4 rifle Coys against an en Bde is 3 : 1 (ORBAT)', /about 3 : 1/.test(row(rt2.rows, 'En force')?.reason ?? ''), row(rt2.rows, 'En force')?.reason);
}
{
  // a knoll 25 m high just in front of A Coy (the forward left posn), outside it: it moves up to hold it
  const res = S.solveRecipe(r2, ctx, {});
  const flat0 = F.fitLayout(fitIn(ground(), { terrain: 'plains' }));
  const W = (p) => F.toWorld(flat0.frame, p);
  const A = res.slots.find((s) => s.role === 'fwdL');
  const hill = W({ x: A.centre.x, y: A.centre.y + A.hM / 2 + 200 });
  const elev = (x, y) => 200 + 25 * Math.exp(-(((x - hill.x) ** 2 + (y - hill.y) ** 2) / (2 * 200 ** 2)));
  const fl = F.fitLayout(fitIn(ground({ elev }), { terrain: 'plains' }));
  const sl = fl.fit.slides.find((s) => s.role === 'fwdL');
  check('a posn moves up to higher ground nearby (8 m or more higher, E)', sl?.why === 'high' && sl.riseM >= 8, JSON.stringify(sl));
  check('...and says so in its ground check', /up to ground \d+ m higher/.test(fl.res.slots.find((s) => s.role === 'fwdL').checks[0].reason));
  const flat = F.fitLayout(fitIn(ground(), { terrain: 'plains' }));
  check('flat ground: no posn moves and no outline is reshaped', !flat.fit.slides.length && !Object.keys(flat.fit.outlines ?? {}).length);
  // a lake under the right-hand third of B Coy's outline: those points pulled in, the echelon mark kept
  const B = res.slots.find((s) => s.role === 'fwdR');
  const bc = W(B.centre);
  const lakeX = bc.x + B.wM * 0.42;
  // a lake beyond 0.42 of B Coy's half-width to its right, only beside the posn (not under the echelon mark's ends)
  const fl2 = F.fitLayout(fitIn(ground({ cls: (x, y) => (x > lakeX && x < lakeX + 600 && y > bc.y - B.hM * 0.4 && y < bc.y + B.hM ? 4 : 2) }), { terrain: 'plains' }));
  const sh = fl2.fit.outlines?.fwdR;
  check('outline points over a lake are pulled in (the curve follows the ground)', !!sh && sh.filter(([u], i) => u > 0 && Math.abs(u) < Math.abs(S.BP_SHAPE[i][0]) - 1e-6).length >= 1, JSON.stringify(sh));
  check('...the echelon mark (first and last points) stays on the rear', !!sh && sh[0][1] === S.BP_SHAPE[0][1] && sh[6][1] === S.BP_SHAPE[6][1]);
  const item = fl2.raw.items.find((i) => i.role === 'fwdR');
  const slotC = fl2.raw.slots.find((s) => s.role === 'fwdR').centre;
  check('...and the built posn is drawn with the shaped curve', item && item.pts.length === 7 && item.pts.slice(1, 6).every((p) => F.toWorld(fl2.frame, p).x <= lakeX + 1), JSON.stringify(item.pts.map((p) => Math.round(F.toWorld(fl2.frame, p).x - bc.x))) + ` lake at +${Math.round(lakeX - bc.x)}; centre moved ${Math.round(slotC.x - B.centre.x)}`);
}
{
  // the attack: a lake across the straight axis; the way on foot bends round it
  const ra = json('MS/Data/Deployments/Recipes/bn-attk-frontal.json');
  const g = ground({
    cls: (x, y) => (Math.abs(x) < 250 && Math.abs(y + 600) < 150 ? 4 : 2),
    avenues: null,
  });
  g.avenues = (from, to) => {
    const mid = { x: (from.x + to.x) / 2 + 600, y: (from.y + to.y) / 2 };
    const path = [];
    for (let t = 0; t <= 1.0001; t += 0.05) path.push(t < 0.5 ? { x: from.x + (mid.x - from.x) * t * 2, y: from.y + (mid.y - from.y) * t * 2 } : { x: mid.x + (to.x - mid.x) * (t - 0.5) * 2, y: mid.y + (to.y - mid.y) * (t - 0.5) * 2 });
    return [{ path, lengthM: 2000, goPct: 100, minWidthM: 900, chokes: [] }];
  };
  const fl = F.fitLayout({ recipe: ra, ctx, opts: {}, ground: g, anchor: { x: 0, y: 0 }, bearing: Math.PI, threat: null, terrain: 'plains' });
  const ax = fl.raw.items.find((i) => i.role === 'axis');
  check('attack: the axis bends round NO-GO on the ground (CTRL_PTS curve)', ax.pts.length > 2 && !!fl.fit.paths?.axis, `${ax.pts.length} points`);
  check('...its width (BASE_LN_PTS) still across its tail', !!ax.base && Math.hypot(ax.base.start.x - ax.base.end.x, ax.base.start.y - ax.base.end.y) > 300);
  check('...and the pace along it in the H-hour sum (assault from the SL, fire lifting)', /fire lifts/.test(row(fl.res.rows, 'H-hour sum')?.reason ?? ''), row(fl.res.rows, 'H-hour sum')?.reason);
}

// ── a built plan checked again reads the same (the user: "why does the Auto plan fail when checked again?") ──────────
{
  const g = ground({ sight: () => 0.6 });
  const inp = fitIn(g, { enemy: { echelon: '18', type: 'mech', source: 'user' }, terrain: 'obstacle' });
  const fl = W.withMoves(F.fitLayout(inp), inp);
  const pd = S.toPlanDocument(fl.raw, (pid, ov, id, de) => ({ plnOrdrSymbolPK: { plnOrdrSymbolId: id }, drawEss: JSON.stringify(de) }), (pid, id, name, seq, syms) => ({ plnOrdrSymbolSet: syms }), 1);
  // as the Deployment Mgr lays it: the pivot (HQ) on the anchor, with its roles and what it was fitted for
  const pivot = fl.frame.pivot;
  const meta = { ground: fl.terrain.kind, groundWhy: fl.terrain.why ?? null, enemy: { echelon: fl.enemy.echelon, type: fl.enemy.type }, unit: null, threat: { x: 0, y: 8000 } };
  const syms = K.readSymbols(K.recordsFromPlanDoc(pd.doc)).map((s) => ({ ...s, pts: s.pts.map((p) => F.toWorld(fl.frame, p)), pbRole: pd.roles[s.id], pbRecipe: r2.id, pbMeta: meta }));
  const r = K.checkPlan(syms, doc, { ground: g, recipes: { [r2.id]: r2 } });
  const kd = (l) => r.posns.find((p) => p.label === l)?.kind;
  check('built plan read by its roles: D Coy the reserve, Sup and C Pen posns as such', kd('D Coy') === 'res' && kd('C Coy') === 'depth' && kd('Sup 1') === 'sup' && kd('C Pen') === 'cpen', r.posns.map((p) => `${p.label}:${p.kind}`).join(', '));
  check('...the ground and enemy it was built for, and its threat', r.terrain.kind === 'obstacle' && r.terrain.source === 'plan' && r.enemy.source === 'plan' && r.threat.from === 'plan', `${r.terrain.kind}/${r.terrain.source} ${r.enemy.source} ${r.threat.from}`);
  check('...the reserve\'s reach checked, the planned posns not held to a size', /D Coy to behind/.test(row(r.rows, 'Reserve reach')?.reason ?? '') && !r.slots.find((s) => s.label === 'C Pen')?.checks.some((c) => c.name === 'Size'));
  const same = ['Frontage', 'Depth', 'Gaps', 'Mutual support', 'Facing the threat', 'Approaches covered', 'Flanks', 'Fields of fire', 'Exposure', 'Obstacle tie-in', 'En force', 'Terrain', 'Reserve reach', 'Alternates', 'AT cover', 'Moves in time'];
  const diff = same.filter((nm) => row(fl.res.rows, nm) && row(r.rows, nm) && row(fl.res.rows, nm).st !== row(r.rows, nm).st).map((nm) => `${nm}: built ${row(fl.res.rows, nm).st}, checked ${row(r.rows, nm).st}`);
  check('the same plan checked again gives the build\'s verdicts row for row', !diff.length, diff.join('; ') || same.filter((nm) => row(r.rows, nm)).length + ' rows the same');
  const slotDiff = fl.res.slots.filter((s) => { const c = r.slots.find((x) => x.label === s.label); const gr = (x) => x?.checks.find((k) => k.name === 'Ground')?.st; return c && gr(s) !== gr(c); }).map((s) => s.label);
  check('...and each posn\'s ground the same', !slotDiff.length, slotDiff.join(', '));
  const stDiff = fl.res.slots.filter((x) => { const c = r.slots.find((y) => y.label === x.label); return c && c.st !== x.st; }).map((x) => `${x.label}: built ${x.st}, checked ${r.slots.find((y) => y.label === x.label).st}`);
  check('...and each posn\'s verdict the same (the reserve\'s moves included)', !stDiff.length, stDiff.join('; '));
  check('...the trigger table read again too', r.whatIf?.triggers.length === fl.whatIf.triggers.length, `${r.whatIf?.triggers.length} against ${fl.whatIf.triggers.length}`);
  check('...with the build\'s rows all there', ['Reserve reach', 'AT cover', 'Moves in time'].every((nm) => !!row(r.rows, nm)), ['Reserve reach', 'AT cover', 'Moves in time'].filter((nm) => !row(r.rows, nm)).join(', '));
}
// ── AT Coys grouped to the Bn (LAT, HAT): read back from what the plan was built for ────────────────────────────────
{
  const O = await import('../../MS/Engines/DeploymentBuilder/PlanOrbat.ts');
  const P = 'MS/Data/Orbat/PK/';
  const orbat = { own: O.mergeOwn(O.OWN_ORBAT_FILES.map((f) => json(`${P}${f}`).units)), en: json(`${P}en.json`).units, weapons: json(`${P}weapons.json`).weapons, engrData: json(`${P}engr.json`).engrData };
  const std = O.brief(orbat, 'inf-bn-std'), grouped = O.withAtGroup(orbat, std, 'inf-bn-lat-apc', 1);
  const g = ground({ sight: () => 0.6 });
  const build = (unit) => { const inp = fitIn(g, { enemy: { echelon: '18', type: 'mech', source: 'user' }, terrain: 'obstacle', unit }); return { inp, fl: W.withMoves(F.fitLayout(inp), inp) }; };
  const b0 = build(std), b1 = build(grouped);
  const read = (b, atGroup) => {
    const pd = S.toPlanDocument(b.fl.raw, (pid, ov, id, de) => ({ plnOrdrSymbolPK: { plnOrdrSymbolId: id }, drawEss: JSON.stringify(de) }), (pid, id, name, seq, syms) => ({ plnOrdrSymbolSet: syms }), 1);
    const meta = { ground: b.fl.terrain.kind, groundWhy: null, enemy: { echelon: '18', type: 'mech' }, unit: 'inf-bn-std', threat: { x: 0, y: 8000 }, atGroup };
    const syms = K.readSymbols(K.recordsFromPlanDoc(pd.doc)).map((s) => ({ ...s, pts: s.pts.map((p) => F.toWorld(b.fl.frame, p)), pbRole: pd.roles[s.id], pbRecipe: r2.id, pbMeta: meta }));
    return K.checkPlan(syms, doc, { ground: g, recipes: { [r2.id]: r2 }, orbat });
  };
  const rg = read(b1, { id: 'inf-bn-lat-apc', coys: 1 }), rn = read(b1, null);
  check('a plan built with 1 LAT Coy has 7 extra pairs on the map (14 BS symbols) against the Std Bn\'s 1', b1.fl.raw.items.filter((i) => i.role.startsWith('atgmX')).length === 14 && b0.fl.raw.items.filter((i) => i.role.startsWith('atgmX')).length === 2);
  check('Check my plan reads the group back: the AT cover row holds 16 ATGM (8 pairs) and names the Std Inf Bn + 1 LAT Coy', /holds 16 ATGM \(8 pairs\)/.test(row(rg.rows, 'AT cover')?.reason ?? ''), row(rg.rows, 'AT cover')?.reason);
  check('...without the group in what it was built for, the same plan is counted at the unit\'s own 4 ATGM', /holds 4 ATGM \(2 pairs\)/.test(row(rn.rows, 'AT cover')?.reason ?? ''), row(rn.rows, 'AT cover')?.reason);
  check('...and the force row names the unit as built (rifle Coys unchanged)', /Std Inf Bn \+ 1 LAT Coy \(APC borne\) \(4 rifle Coys\)/.test(row(rg.rows, 'En force')?.reason ?? ''), row(rg.rows, 'En force')?.reason);
}
// ── tank Sqns grouped to the Bn defence: read back from what the plan was built for ─────────────────────────────────
{
  const O = await import('../../MS/Engines/DeploymentBuilder/PlanOrbat.ts');
  const T = await import('../../MS/Engines/DeploymentBuilder/PlanTanks.ts');
  const P = 'MS/Data/Orbat/PK/';
  const orbat = { own: O.mergeOwn(O.OWN_ORBAT_FILES.map((f) => json(`${P}${f}`).units)), en: json(`${P}en.json`).units, weapons: json(`${P}weapons.json`).weapons, engrData: json(`${P}engr.json`).engrData };
  const sqn = O.tankSqnOf(orbat), d1 = T.withDefTanks(r2, doc, 1, { tanks: sqn.tanks, tps: sqn.tps, tpTanks: sqn.tpTanks, regtTanks: sqn.regtTanks, src: sqn.src });
  const g = ground({ sight: () => 0.6 });
  const inp = fitIn(g, { recipe: d1, enemy: { echelon: '18', type: 'mech', source: 'user' }, terrain: 'obstacle', unit: O.brief(orbat, 'inf-bn-std') });
  const fl = W.withMoves(F.fitLayout(inp), inp);
  const pd = S.toPlanDocument(fl.raw, (pid, ov, id, de) => ({ plnOrdrSymbolPK: { plnOrdrSymbolId: id }, drawEss: JSON.stringify(de) }), (pid, id, name, seq, syms) => ({ plnOrdrSymbolSet: syms }), 1);
  const meta = { ground: fl.terrain.kind, groundWhy: null, enemy: { echelon: '18', type: 'mech' }, unit: 'inf-bn-std', threat: { x: 0, y: 8000 }, atGroup: null, defTanks: 1 };
  const syms = K.readSymbols(K.recordsFromPlanDoc(pd.doc)).map((s) => ({ ...s, pts: s.pts.map((p) => F.toWorld(fl.frame, p)), pbRole: pd.roles[s.id], pbRecipe: d1.id, pbMeta: meta }));
  const r = K.checkPlan(syms, doc, { ground: g, recipes: { [d1.id]: d1 }, orbat });
  const sqnPosn = r.posns.find((p) => p.label === 'A Sqn');
  check('built with 1 tank Sqn: Check my plan does not take the Sqn for a posn held (not a posn, or ignored), the Coys read as before', (!sqnPosn || sqnPosn.kind === 'ignore') && r.posns.find((p) => p.label === 'A Coy')?.kind === 'fwd' && r.posns.find((p) => p.label === 'D Coy')?.kind === 'res', r.posns.map((p) => `${p.label}:${p.kind}`).join(', '));
  check('...its Tank leaguer row read from the symbol, the same verdict as the build', row(r.rows, 'Tank leaguer')?.st === row(fl.res.rows, 'Tank leaguer')?.st && /A Sqn: tracks go/.test(row(r.rows, 'Tank leaguer')?.reason ?? ''), row(r.rows, 'Tank leaguer')?.reason);
  check('...its Tank AT cover row read the same as the build\'s: the guns on each approach from the C Pen and Sup posns', !!row(fl.res.rows, 'Tank AT cover') && row(r.rows, 'Tank AT cover')?.st === row(fl.res.rows, 'Tank AT cover')?.st && /A1 \(main\): under their guns/.test(row(r.rows, 'Tank AT cover')?.reason ?? ''), row(r.rows, 'Tank AT cover')?.reason);
  check('...and the A Sqn\'s switch to the Sup posn is in the trigger table as the build timed it', r.whatIf?.triggers.some((t) => t.id.startsWith('tk-sup-') && t.min === fl.whatIf.triggers.find((x) => x.id === t.id)?.min), r.whatIf?.triggers.map((t) => t.id).join(' '));
  check('...the Sqn\'s move to the C Pen posn in the trigger table, mounted, as the build timed it', r.whatIf?.triggers.some((t) => t.id === 'tk-cpen-tkSqn' && t.route?.mounted === true && t.min === fl.whatIf.triggers.find((x) => x.id === 'tk-cpen-tkSqn')?.min), r.whatIf?.triggers.map((t) => `${t.id}:${t.min}`).join(' '));
  check('...and the force row counts the Sqn (4 Coys + 1 Tk Sqn of 14 tanks)', /4 rifle Coys \+ 1 Tk Sqn of 14 tanks/.test(row(r.rows, 'En force')?.reason ?? ''), row(r.rows, 'En force')?.reason);
  const rn = K.checkPlan(syms.map((s) => ({ ...s, pbMeta: { ...meta, defTanks: 0 } })), doc, { ground: g, recipes: { [d1.id]: d1 }, orbat });
  check('...with no Sqn in what it was built for the force is the Bn\'s own 4 Coys', !/Tk Sqn/.test(row(rn.rows, 'En force')?.reason ?? ''), row(rn.rows, 'En force')?.reason);
}
// ── an approach that ends at the FDL: the C Pen posn is still sited, on its line carried into the depth ─────────────
{
  const g = ground();
  const flat = F.fitLayout(fitIn(g, { terrain: 'plains' }));
  const front = Math.max(...flat.raw.slots.filter((s) => s.role.startsWith('fwd')).map((s) => F.toWorld(flat.frame, { x: s.centre.x, y: s.centre.y + s.hM / 2 }).y));
  g.avenues = () => { const path = []; for (let y = 8000; y >= front; y -= 100) path.push({ x: 300, y }); return [{ path, lengthM: 8000 - front, goPct: 100, minWidthM: 2000, chokes: [] }]; };
  const inp = fitIn(g, { terrain: 'plains', enemy: { echelon: '18', type: 'mech', source: 'user' } });
  const fl = W.withMoves(F.fitLayout(inp), inp);
  const t = fl.whatIf.triggers.find((x) => x.id === 'cpen-main');
  check('an approach ending at the FDL: the C Pen posn sited on its line carried into the depth', !!fl.whatIf.cpen && !!t?.route && fl.whatIf.cpen.y < F.toLocal(fl.frame, { x: 300, y: front }).y, t ? `${t.min} / ${t.enemyMin} min` : 'no trigger');
}
// ── J moves the reserve when its moves are too slow ─────────────────────────────────────────────────────────────────
{
  // the enemy's tanks 11 km in front of the FDL: the reserve on foot is late to the C Pen posn
  const f0 = F.fitLayout(fitIn(ground(), { terrain: 'plains' }));
  const fdlJ = Math.max(...f0.raw.slots.filter((s) => s.role.startsWith('fwd')).map((s) => F.toWorld(f0.frame, { x: s.centre.x, y: s.centre.y + s.hM / 2 }).y));
  const from = Math.round(fdlJ + 11000);
  const g = ground({ avenues: [{ x: 0, chokes: [] }] });
  g.avenues = () => { const path = []; for (let y = from; y >= -500; y -= 100) path.push({ x: 0, y }); return [{ path, lengthM: from + 500, goPct: 100, minWidthM: 2000, chokes: [] }]; };
  const inp = { ...fitIn(g, { enemy: { echelon: '18', type: 'mech', source: 'user' }, terrain: 'plains' }), threat: { x: 0, y: from } };
  const refit = (i) => { const f = F.fitLayout(i); return f ? W.withMoves(f, i) : null; };
  const cur = refit(inp);
  const dres = cur.res.slots.find((s) => s.role === 'res');
  const mv = dres.checks.find((c) => c.name === 'Moves in time');
  check('the reserve carries its moves\' verdict (here too slow)', mv?.st === 'fail', mv?.reason);
  const j = F.nextBestSpot(inp, cur, new Set(), refit);
  check('J moves the reserve nearer (the moves no longer fail), and the plan ranks better', j?.role === 'res' && j.to.fit.fails < cur.fit.fails && j.to.res.slots.find((s) => s.role === 'res').checks.find((c) => c.name === 'Moves in time')?.st !== 'fail', j ? `${j.label} ${Math.round(j.distM)} m: fails ${cur.fit.fails} -> ${j.to.fit.fails}, warns ${cur.fit.warns} -> ${j.to.fit.warns}` : 'no move');
}

console.log(`\n${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
