// crossing.mjs -- checks Phase 7 of the Intelligent Deployment (MS/Engines/DeploymentBuilder/PlanCrossing.ts through
// PlanFit.fitLayout): the crossing recipes (Bn two up, Bde two up / four Bns, Div bridgehead: IBB S46 pp 237-239),
// the plan re-laid along the obstacle the click is on (MovementGuideWater.readWater / readReach), the crossing means
// and times from IBB Annex Q (pp 467-468), the drift entry (IC s70 para 4e p358), the bridge site, the far-side ground
// that observes the crossing places and the Bridgehead Line reaching out for it (IBB S46 para 24 c p240).
// Ground: the Water engine's test canal (tools/movement-test/water.mjs: 60 m, banks 3 m, drawn and flowing east, a
// Class 60 bridge at km 1.0, marsh on the south bank at km -0.5..0.5), with a ridge 2.2 km north of it (40 m) and a
// knoll 1.8 km north at km 0.8 (30 m) that see over its banks.
//   node tools/planbuilder-test/crossing.mjs          (add --quiet to print only failures and the summary)
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const F = await import('../../MS/Engines/DeploymentBuilder/PlanFit.ts');
const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
const C = await import('../../MS/Engines/DeploymentBuilder/PlanCrossing.ts');
const M = await import('../../MS/Engines/MovementGuide/MovementGuideScan.ts');
const WG = await import('../../MS/Engines/MovementGuide/MovementGuideWater.ts');

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
const WR = WG.waterRulesFrom(json('MS/Data/MovementDoctrine.json'));
const rules = json('MS/Data/terrain-bundle/rules.json');
const goingOf = (p) => ({ nogo: new Set(rules.profiles[p].nogo), caution: new Set(rules.profiles[p].caution ?? []) });
const rec = (id) => json(`MS/Data/Deployments/Recipes/${id}.json`);
const row = (rows, name) => rows.find((r) => r.name === name);
const it = (res, role) => res.items.find((i) => i.role === role);

// ── the ground ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const O = M.lngLatToMerc(73.0, 30.5);
const s = M.scaleAt(O[1]);
const at = (e, nn) => [O[0] + e / s, O[1] + nn / s];
const local = (x, y) => ({ e: (x - O[0]) * s, n: (y - O[1]) * s });
const canalXY = [...at(-8000, 0), ...at(8000, 0)];
const land = (e) => 200 - e * 0.0005;
function elev(x, y) {
  const { e, n: nn } = local(x, y);
  const L = land(e);
  const a = Math.abs(nn);
  if (a < 30) return L + 1.5;
  if (a <= 45) return L + 3;
  let h = 0;
  const r = Math.abs(nn - 2200);
  if (r < 300 && Math.abs(e) <= 3000) h = Math.max(h, 40 * (1 - (r / 300) ** 2));
  const k = Math.hypot(e - 800, nn - 1795);
  if (k < 150) h = Math.max(h, 30 * (1 - (k / 150) ** 2));
  return L + h;
}
function cls(x, y) {
  const { e, n: nn } = local(x, y);
  if (e >= 990 && e <= 1010 && Math.abs(nn) < 60) return 39;
  if (Math.abs(nn) < 30) return 20;
  if (Math.abs(nn) <= 45) return 24;
  if (e >= -500 && e <= 500 && nn <= -60 && nn >= -200) return 6;
  return 2;
}
function sight(ox, oy, eyeM, tx, ty, targetM) {
  const d = M.groundDist([ox, oy], [tx, ty]);
  const steps = Math.max(2, Math.ceil(d / 15));
  const e0 = elev(ox, oy) + eyeM, e1 = elev(tx, ty) + targetM;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (elev(ox + (tx - ox) * t, oy + (ty - oy) * t) > e0 + (e1 - e0) * t) return 0;
  }
  return 1;
}
const FEATURES = [{ kind: 'bridge', label: 'Bridge', name: 'Canal Br', p: at(1000, 0), attrs: {} }];
const probe = {
  resM: 30, cls, elev, bld: () => 0, sight, people: () => 100, roads: () => [],
  raster: (layer, x, y) => (layer === 'wet' && cls(x, y) === 6 ? 4 : 0),
  sight2: (...a) => { const v = sight(...a); return { p: v, pTerrain: v }; },
  features(x, y, r, kinds) {
    return FEATURES.filter((f) => kinds.has(f.kind)).map((f) => ({ kind: f.kind, label: f.label, name: f.name, x: f.p[0], y: f.p[1], distM: M.groundDist([x, y], f.p), attrs: f.attrs })).filter((f) => f.distM <= r).sort((a, b) => a.distM - b.distM);
  },
  lines(x, y, r, kinds) {
    const all = [{ kind: 'canal', xy: canalXY, attrs: { n: 'Upper Test Canal', t: 'MainCanal', w: 60, dp: 3, bl: 2, br: 3, b: 3 } }];
    return all.filter((l) => kinds.has(l.kind) && M.distToLine([x, y], l.xy) <= r + 50);
  },
  going: goingOf,
  classLabel: (c) => rules.classes[String(c)]?.label ?? `Class ${c}`,
  takePending: () => false,
};
const ground = { cls, elev, going: goingOf, label: probe.classLabel, sight, pending: () => false, dataLine: () => 'synthetic', mov: () => probe };
const XY = (p) => ({ x: p[0], y: p[1] });
const inpOf = (recipe, h, more = {}) => ({ recipe, ctx, opts: {}, ground, anchor: XY(h), bearing: 0, threat: null, waterRules: WR, light: 'dark', month: 1, ...more });
const world = (fl, p) => { const f = fl.frame; const lx = (p.x - f.pivot.x) * f.k, ly = (p.y - f.pivot.y) * f.k, c = Math.cos(f.bearing), sn = Math.sin(f.bearing); return { x: f.anchor.x + lx * c + ly * sn, y: f.anchor.y - lx * sn + ly * c }; };
const nOfW = (w) => local(w.x, w.y).n;
const eOfW = (w) => local(w.x, w.y).e;
const H = at(0, -100);

// ── geometry ───────────────────────────────────────────────────────────────────────────────────────────────────────────
for (const id of ['bn-cross-two-up', 'bde-cross-two-up', 'bde-cross-four-bn', 'div-bridgehead-two-bde']) {
  const r = S.solveRecipe(rec(id), ctx, {});
  const piv = r.items.find((i) => i.id === r.pivotId);
  check(`${id}: geometry: H is the pivot at the click; fronts, phase 1 and the bridgehead pass IBB S46; the ground rows grey`, piv?.role === 'xTgt' && r.rows.filter((x) => x.st !== 'unchecked').every((x) => x.st === 'pass') && ['Obstacle', 'Crossing means', 'Observed fire'].every((x) => row(r.rows, x)?.st === 'unchecked') && r.confirm.length >= 5, r.rows.map((x) => `${x.name} ${x.st}`).join(', '));
}
const flat = { cls: () => 2, elev: () => 200, going: goingOf, label: String, sight: () => 1, pending: () => false, dataLine: () => 'none' };
const g0 = F.fitLayout(inpOf(rec('bn-cross-two-up'), H, { ground: flat }));
check('No Movement Guide reader: the geometry stands, the ground rows grey', g0.res.mode === 'geometry' && row(g0.res.rows, 'Observed fire')?.st === 'unchecked');

// ── a battalion at the canal ───────────────────────────────────────────────────────────────────────────────────────────
{
  const fl = F.fitLayout(inpOf(rec('bn-cross-two-up'), H));
  const rows = fl.res.rows;
  const x = fl.fit.crossing;
  check('Bn: fitted on the ground; the obstacle read (Upper Test Canal, irrigation canal, Annex P 3, 60 m from the sheet)', fl.res.mode === 'terrain' && x?.obstacle.name === 'Upper Test Canal' && x.obstacle.annex === 3 && /60 m/.test(row(rows, 'Obstacle')?.reason), row(rows, 'Obstacle')?.reason);
  const o1 = it(fl.raw, 'obj1').pts.map((p) => world(fl, p)), fa = it(fl.raw, 'fupA').pts.map((p) => world(fl, p));
  check('...re-laid square to the canal: OBJ 1 on the far (north) bank from its crest, the FUPs on the home bank', o1.every((p) => nOfW(p) >= 30) && fa.every((p) => nOfW(p) < -40), `OBJ 1 n ${Math.round(Math.min(...o1.map(nOfW)))}-${Math.round(Math.max(...o1.map(nOfW)))}, FUP A n ${Math.round(Math.max(...fa.map(nOfW)))}`);
  const sl = it(fl.raw, 'sl').pts.map((p) => world(fl, p));
  check('...the start line along the home bank (the water line, IBB S46 para 8 f)', sl.every((p) => Math.abs(nOfW(p) + 57) < 5) && Math.max(...sl.map(eOfW)) - Math.min(...sl.map(eOfW)) > 800, `n ${Math.round(nOfW(sl[0]))}`);
  const xp = it(fl.raw, 'xpA');
  check('...each Assault Crossing spans the canal (its base on the home bank, its far end on the far bank)', nOfW(world(fl, xp.base.mid)) < -45 && nOfW(world(fl, xp.pts[0])) > 45);
  check('...Boats: 22 M2 boats (enough for the leading wave: MechInfBn p 270), 20 min a round trip over 60 m (Annex Q: 10 per 30 m); A, B Coys in one wave; C Coy H+0:20 (IC s71: H+20)', row(rows, 'Boats')?.st === 'pass' && /20 min a round trip/.test(row(rows, 'Boats').reason) && /C Coy H\+0:20/.test(row(rows, 'Boats').reason), row(rows, 'Boats')?.reason);
  check('...Bridge: 70 m to span (the 60 m gap at the bridge site) takes the 84 m M2 set, 3.75 h on a dark night: open about H+3:45; too wide for bridge-layer tanks', /60 m gap at the bridge site/.test(row(rows, 'Bridge')?.reason) && /84 m set/.test(row(rows, 'Bridge')?.reason) && /3\.75 h/.test(row(rows, 'Bridge').reason) && /H\+3:45/.test(row(rows, 'Bridge').reason) && /too wide for bridge-layer/.test(row(rows, 'Bridge').reason), row(rows, 'Bridge')?.reason);
  check('...Tanks across: no Class 50 bridge with an Inf Div: Class 50 raft 120 min, first tank H+2:15, a Sqn H+9:00 (warn, why and fix)', row(rows, 'Tanks across')?.st === 'warn' && /H\+2:15/.test(row(rows, 'Tanks across').reason) && /H\+9:00/.test(row(rows, 'Tanks across').reason) && (row(rows, 'Tanks across').detail?.fix ?? []).length >= 2, row(rows, 'Tanks across')?.reason);
  check('...Rafts: the 3 Pontoon OBM raft ready H+0:30 in the dark', /H\+0:30/.test(row(rows, 'Rafts')?.reason ?? ''), row(rows, 'Rafts')?.reason);
  const ent = x.entries;
  const xpA = world(fl, xp.base.mid);
  check('...Drift: the canal flows east: each wave enters 120 m upstream (west) of its crossing place (IC s70 para 4e)', row(rows, 'Drift')?.st === 'pass' && ent.length === 2 && ent.some((q) => Math.abs(eOfW(XY([q.x, q.y])) - (eOfW(xpA) - 120)) < 20), `${ent.map((q) => Math.round(eOfW(XY([q.x, q.y])))).join(', ')} vs ${Math.round(eOfW(xpA))}`);
  check('...Far bank 2 m above the water: a high far bank (warn: ladders, grapnels)', row(rows, 'Far bank')?.st === 'warn' && /ladders/.test(row(rows, 'Far bank').detail?.fix?.[0] ?? ''), row(rows, 'Far bank')?.reason);
  check('...Approaches and exits: marsh on the home bank by the bridge site (warn)', row(rows, 'Approaches and exits')?.st === 'warn', row(rows, 'Approaches and exits')?.reason);
  check('...Crossings near: the Class 60 Canal Br 1 km east', /Canal Br/.test(row(rows, 'Crossings near')?.reason ?? ''), row(rows, 'Crossings near')?.reason);
  check('...Observed fire: the ridge 2 km out sees the crossing places, beyond the Bn\'s 600 m (warn)', row(rows, 'Observed fire')?.st === 'warn' && x.observers.some((o) => !o.inside && o.depthM >= 1900), row(rows, 'Observed fire')?.reason);
  check('...flat ground behind the banks does not see the water (no observer nearer than the knoll / ridge)', x.observers.every((o) => o.depthM >= 1500), `${Math.min(...x.observers.map((o) => o.depthM))} m`);
  check('...the timeline in order from H', x.times[0].atMin === 0 && x.times.every((t, i) => !i || t.atMin >= x.times[i - 1].atMin), x.times.map((t) => `${t.label} ${t.atMin}`).join('; '));
  const pd = S.toPlanDocument(fl.raw, (pid, ov, id, de) => ({ id, ...de }), (pid, id, name, seq, syms) => ({ id, syms }), 1);
  const ac = pd.doc.poObj.plnOrdrOverlay[0].syms.find((q) => q.SIDC.endsWith('2713000000'.slice(0)) || q.SID === '271300');
  check('Plan document: H is the pivot; the Assault Crossings carry a base line (2525D 25271300)', fl.raw.items.find((i) => i.id === pd.pivotId)?.role === 'xTgt' && !!ac?.BASE_LN_PTS, ac ? 'ok' : 'no 271300');
  const day = F.fitLayout(inpOf(rec('bn-cross-two-up'), H, { light: 'day' }));
  check('By day: the bridge 2.25 h (Annex Q day column) and the Night row warns (night assault preferable, IBB S46 para 18)', /2\.25 h/.test(row(day.res.rows, 'Bridge')?.reason ?? '') && row(day.res.rows, 'Night')?.st === 'warn', row(day.res.rows, 'Night')?.reason);
}

// ── the bridge site moves to the existing bridge ───────────────────────────────────────────────────────────────────────
{
  const fl = F.fitLayout(inpOf(rec('bn-cross-two-up'), at(600, -100)));
  const b = fl.fit.crossing.bridges[0];
  check('Bridge site: from km 0.6 it moves east onto the Class 60 Canal Br (within 400 m)', b && b.movedM >= 200 && /Canal Br/.test(b.why) && eOfW(XY([b.x, b.y])) > 850, b ? `${Math.round(b.movedM)} m: ${b.why}` : 'none');
  const br = it(fl.raw, 'bridge');
  check('...the Bridge symbol drawn there, spanning the canal', Math.abs(eOfW(world(fl, br.base.mid)) - eOfW(XY([b.x, b.y]))) < 30 && nOfW(world(fl, br.base.mid)) < -45 && nOfW(world(fl, br.pts[0])) > 45);
}

// ── the crossing places move along the bank ────────────────────────────────────────────────────────────────────────────
{
  // from km 0.65 A Coy's place falls at km 0.41, in the marsh on the home bank (km -0.5..0.5): it moves east out of it
  const fl = F.fitLayout(inpOf(rec('bn-cross-two-up'), at(650, -100)));
  const pl = fl.fit.crossing.places;
  const a = pl.find((q) => q.movedM >= 50);
  check('Crossing places: A Coy\'s moves out of the marsh along the bank (within 150 m), B Coy\'s stays', !!a && eOfW(XY([a.x, a.y])) > 500 && pl.some((q) => q.movedM < 50) && /moved/.test(row(fl.res.rows, 'Crossing places')?.reason ?? ''), row(fl.res.rows, 'Crossing places')?.reason);
  const xpA = it(fl.raw, 'xpA');
  check('...its Assault Crossing drawn there, and the drift entry follows it', Math.abs(eOfW(world(fl, xpA.base.mid)) - eOfW(XY([a.x, a.y]))) < 25 && fl.fit.crossing.entries.some((q) => Math.abs(eOfW(XY([q.x, q.y])) - (eOfW(XY([a.x, a.y])) - 120)) < 25));
}

// ── his minefield: the home side drawn back, a Breach lane to each crossing place, the lanes timed ─────────────────────
{
  const R = await import('../../MS/Engines/DeploymentBuilder/PlanRecipes.ts');
  const bnR = rec('bn-cross-two-up');
  const mf = C.withMinefield(bnR, doc);
  const bad = R.validateRecipe(mf, { doc, symbols }).filter((i) => i.level === 'fail').map((i) => i.msg);
  check('His minefield: the recipe validates, its own id (-mf), the one passed in unchanged', !bad.length && mf.id === 'bn-cross-two-up-mf' && !bnR.slots.some((s) => s.role === 'enMf'), bad.join('; '));
  const fupBack = (r) => r.slots.find((s) => s.role === 'fupA').shape.pts[0][1];
  check('...the FUPs drawn back behind it (IBB S47: 900-1000 m; the assault goes through in file)', fupBack(mf) - fupBack(bnR) === 1010, `${fupBack(bnR)} -> ${fupBack(mf)}`);
  check('...a Breach lane (2525D 25340200) to each assault crossing place; his minefield and wire hostile', mf.slots.filter((s) => s.sym === '25340200').length === 2 && mf.slots.filter((s) => s.hostile).length === 2);
  const res = S.solveRecipe(mf, ctx, {});
  const enMf = it(res, 'enMf');
  check('...drawn with hostile identity (SIDC 6), ours with friend (3)', S.sidcFor(enMf)[3] === '6' && S.sidcFor(it(res, 'aCoy'))[3] === '3', S.sidcFor(enMf));
  const br = row(res.rows, 'Breach');
  check('...Breach: 9 engineer Pls a lane, 6 h the first on a dark night, the next every 100 min: about 19 h 20 (warn, Annex Q para 4), fixes', br?.st === 'warn' && /9 engineer Pls/.test(br.reason) && /19 h 20/.test(br.reason) && /Breach before H/.test(br.detail?.fix?.[0] ?? ''), br?.reason);
  const fl = F.fitLayout(inpOf(mf, at(650, -100)));
  const a = fl.fit.crossing.places.find((q) => q.movedM >= 50);
  const lane = it(fl.raw, 'laneXpA');
  check('...on the ground each lane follows its crossing place along the bank, from the minefield\'s home edge to the water', a && Math.abs(eOfW(world(fl, lane.base.mid)) - eOfW(XY([a.x, a.y]))) < 25 && nOfW(world(fl, lane.base.mid)) < -950 && nOfW(world(fl, lane.pts[0])) > -120, lane ? `n ${Math.round(nOfW(world(fl, lane.base.mid)))} to ${Math.round(nOfW(world(fl, lane.pts[0])))}` : 'none');
  check('...the lanes on the timeline, the Night row warns', fl.fit.crossing.times.some((t) => /lanes/.test(t.label)) && row(fl.res.rows, 'Night')?.st === 'warn', row(fl.res.rows, 'Night')?.reason);
}

// ── engineers with the crossing (ORBAT, SO's Hbk Sec 4): their own bridging, the TAM breach ─────────────────────────────
{
  const O = await import('../../MS/Engines/DeploymentBuilder/PlanOrbat.ts');
  const E = await import('../../MS/Engines/DeploymentBuilder/PlanEngr.ts');
  const P = 'MS/Data/Orbat/PK/';
  const orbat = { own: O.mergeOwn(O.OWN_ORBAT_FILES.map((x) => json(`${P}${x}`).units)), en: [], weapons: [], engrData: json(`${P}engr.json`).engrData };
  const kinds = E.bridgeKinds(orbat.engrData), T = (id) => ({ ...E.ownEngrTypes(orbat).find((t) => t.id === id), kinds });
  const withE = (r, id) => ({ ...r, id: `${r.id}-en`, engr: T(id) });
  const flBr = F.fitLayout(inpOf(withE(rec('bn-cross-two-up'), 'engr-bn-br'), H));
  const eb = row(flBr.res.rows, 'Engr bridging');
  check('Engineers: the Br Bn over the canal (70 m with the seats): its ribbon bridge, 1 h 30 on a dark night, open H+1 h 30, on the timeline before the M2', eb?.st === 'pass' && /Ribbon bridge \(Cl 60\) across 70 m: 1 h 30 min by dark night/.test(eb.reason) && flBr.fit.crossing.times.some((t) => /Ribbon bridge open \(Br Bn Engrs\)/.test(t.label) && t.atMin === 90) && !!row(flBr.res.rows, 'Bridge'), eb?.reason);
  const er = row(flBr.res.rows, 'Engr rafts');
  check('...and its ribbon bays as rafts: the first tank across on the timeline well before the bridge (Engr rafts row)', er?.st === 'pass' && flBr.fit.crossing.times.some((t) => /First tank across \(ribbon raft, Br Bn Engrs\)/.test(t.label) && t.atMin < 90), er?.reason);
  const flAs = F.fitLayout(inpOf(withE(rec('bn-cross-two-up'), 'engr-bn-aslt'), H));
  check('...the Aslt Engr Bn: two AM-50 sets one after the other (2 h 30), its AVLBs too short for 70 m', /AM-50 bridge, 2 sets \(Cl 50\) across 70 m: 2 h 30 min/.test(row(flAs.res.rows, 'Engr bridging')?.reason ?? ''), row(flAs.res.rows, 'Engr bridging')?.reason);
  const flFd = F.fitLayout(inpOf(withE(rec('bn-cross-two-up'), 'engr-fd-coy'), H));
  check('...a Fd Coy holds no bridging: no Engr bridging row, the Annex Q rows as before', !row(flFd.res.rows, 'Engr bridging') && !!row(flFd.res.rows, 'Bridge'));
  // his minefield, with the Aslt Engr Bn's TAMs
  const mf = withE(C.withMinefield(rec('bn-cross-two-up'), doc), 'engr-bn-aslt');
  const flM = F.fitLayout(inpOf(mf, at(650, -100)));
  const mb = row(flM.res.rows, 'Mech breach');
  check('...his minefield and the Aslt Engr Bn: Mech breach, a TAM to each of the 2 lanes, about 3 h against 6 h by hand (p 451, uncertain reading), on the timeline', mb?.st === 'pass' && /2 lanes/.test(mb.reason) && /6 h by hand/.test(mb.reason) && flM.fit.crossing.times.some((t) => /Lanes by TAM/.test(t.label)), mb?.reason);
  const mf0 = F.fitLayout(inpOf(C.withMinefield(rec('bn-cross-two-up'), doc), at(650, -100)));
  check('...without engineers chosen: no Mech breach row, the hand lanes only', !row(mf0.res.rows, 'Mech breach') && !row(mf0.res.rows, 'Engr bridging'));
}

// ── brigades: the Bridgehead Line reaches out for his observers ────────────────────────────────────────────────────────
{
  const two = F.fitLayout(inpOf(rec('bde-cross-two-up'), H));
  const x2 = two.fit.crossing;
  const bh = it(two.raw, 'bh').pts.map((p) => world(two, p));
  const deep = Math.max(...bh.map(nOfW)) - 45;
  check('Bde two up: the BH line reaches out to take the knoll 1.75 km beyond the bund (up to 1.8 km, IBB S46 para 20)', deep > 1700 && deep <= 1810 && /reaches out/.test(row(two.res.rows, 'Bridgehead')?.reason ?? ''), `${Math.round(deep)} m; ${row(two.res.rows, 'Bridgehead')?.reason}`);
  check('...the knoll\'s observers inside; the ridge 2 km out beyond (Observed fire warn), fix: four Bns reach 2.5 km', x2.observers.some((o) => o.inside && o.depthM < 1900) && row(two.res.rows, 'Observed fire')?.st === 'warn' && /Four battalions/.test(row(two.res.rows, 'Observed fire').detail?.fix?.[0] ?? ''), row(two.res.rows, 'Observed fire')?.reason);
  const xs = bh.map(eOfW);
  check('...the BH line still 3.5-4 km wide along the canal', Math.max(...xs) - Math.min(...xs) >= 3500 && Math.max(...xs) - Math.min(...xs) <= 4050, `${Math.round(Math.max(...xs) - Math.min(...xs))} m`);
  const four = F.fitLayout(inpOf(rec('bde-cross-four-bn'), H));
  const outside = (fl) => fl.fit.crossing.observers.filter((o) => !o.inside).length;
  check('Bde four Bns: the bridgehead 2.5 km deep takes the ridge in front: none left in front, only flank ones (fewer than two up)', / 0 in front of it/.test(row(four.res.rows, 'Observed fire')?.reason ?? '') && outside(four) < outside(two), `${row(four.res.rows, 'Observed fire')?.reason}; two up ${outside(two)} outside`);
  check('...flank observers get a flank fix (smoke, widen the bridgehead)', /flanks/.test((row(four.res.rows, 'Observed fire')?.detail?.fix ?? []).join(' ')));
  const ranked = F.rankFits([two, four]);
  check('...Auto ranks the four-Bn layout first here', ranked[0].recipe.layout === 'four-bn', ranked.map((r) => `${r.recipe.layout} ${r.fit.fails}/${r.fit.warns}/${r.fit.score}`).join(', '));
  check('...Boats for the Bde: the third Bn by the boats after them, or the bridge', /third Bn/.test(row(two.res.rows, 'Boats')?.reason ?? ''));
}

// ── a division ─────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const fl = F.fitLayout(inpOf(rec('div-bridgehead-two-bde'), H));
  const rows = fl.res.rows;
  check('Div: 8 x 6 km takes every observer (pass); about 48 km2', row(rows, 'Observed fire')?.st === 'pass' && /48 km2/.test(row(rows, 'Bridgehead')?.reason ?? ''), `${row(rows, 'Observed fire')?.reason}; ${row(rows, 'Bridgehead')?.reason}`);
  check('...Tanks across by the armoured division\'s Class 50 hollow plate bridge, 5.5 h on a dark night', row(rows, 'Tanks across')?.st === 'pass' && /5\.5 h/.test(row(rows, 'Tanks across').reason), row(rows, 'Tanks across')?.reason);
  check('...a bridge site read for each break-in brigade', fl.fit.crossing.bridges.length === 2 && /;/.test(row(rows, 'Bridge site')?.reason ?? ''), row(rows, 'Bridge site')?.reason);
}

// ── no water at the click ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const fl = F.fitLayout(inpOf(rec('bn-cross-two-up'), at(0, -2000)));
  check('No water within 400 m: Obstacle fails with why and fix; the geometry stands', row(fl.res.rows, 'Obstacle')?.st === 'fail' && /Click on the obstacle/.test(row(fl.res.rows, 'Obstacle').detail?.fix?.[0] ?? '') && fl.raw.items.length > 15, row(fl.res.rows, 'Obstacle')?.reason);
}

{
  // the tiles still loading: no water read yet is grey, never "no canal"
  const loading = { ...probe, lines: () => [], cls: () => null, elev: () => NaN, takePending: () => true };
  const fl = F.fitLayout(inpOf(rec('bn-cross-two-up'), H, { ground: { ...ground, mov: () => loading } }));
  check('Ground still loading at the click: Obstacle not checked (grey), not a fail; the fit asks to be run again', row(fl.res.rows, 'Obstacle')?.st === 'unchecked' && fl.fit.pending, row(fl.res.rows, 'Obstacle')?.reason);
}

// ── Check my plan: a crossing as drawn, read with the same rows ────────────────────────────────────────────────────────
{
  const asDrawn = (fl) => {
    const d = {};
    for (const i of fl.raw.items) {
      if (d[i.role]) continue;
      const w = (p) => { const q = world(fl, p); return [q.x, q.y]; };
      d[i.role] = { pts: i.pts.map(w), ...(i.base ? { base: { start: w(i.base.start), mid: w(i.base.mid), end: w(i.base.end) } } : {}) };
    }
    return d;
  };
  const names = ['Obstacle', 'Far bank', 'Boats', 'Bridge', 'Tanks across', 'Drift', 'Fronts', 'Phase 1', 'Bridgehead', 'Observed fire', 'Approaches and exits'];
  const bf = F.fitLayout(inpOf(rec('bde-cross-two-up'), H));
  const bc = C.checkCrossing(inpOf(rec('bde-cross-two-up'), H), asDrawn(bf));
  check('Check my plan, crossing: read as drawn, the same verdicts as built', !!bc && names.every((nm) => row(bc.rows, nm)?.st === row(bf.res.rows, nm)?.st) && !bc.missing.length, bc ? names.map((nm) => `${nm} ${row(bf.res.rows, nm)?.st}/${row(bc.rows, nm)?.st}`).join(', ') : 'null');
  // the BH line dragged in to 600 m deep: the knoll and the ridge now beyond it
  const shallow = asDrawn(bf);
  const ys = shallow.bh.pts.map((q) => local(q[0], q[1]).n), maxN = Math.max(...ys);
  shallow.bh = { pts: shallow.bh.pts.map((q) => { const l = local(q[0], q[1]); return l.n > 200 ? at(l.e, 645) : q; }) };
  const sc = C.checkCrossing(inpOf(rec('bde-cross-two-up'), H), shallow);
  const outside = (x) => x.crossing.observers.filter((o) => !o.inside).length;
  check('...the BH line dragged in to 600 m: more of his observers outside it, the Bridgehead row warns', outside(sc) > outside(bc) && row(sc.rows, 'Bridgehead')?.st === 'warn', `${Math.round(maxN)} m -> 645 m; outside ${outside(bc)} -> ${outside(sc)}; ${row(sc.rows, 'Bridgehead')?.reason}`);
  const bnF = F.fitLayout(inpOf(rec('bn-cross-two-up'), at(650, -100)));
  const bnD = asDrawn(bnF);
  bnD.bridge = { pts: [at(0, 75)], base: { start: at(-12, -75), mid: at(0, -75), end: at(12, -75) } };
  const bnC = C.checkCrossing(inpOf(rec('bn-cross-two-up'), at(650, -100)), bnD);
  check('...the bridge dragged into the marsh: Approaches and exits warn (a NO-GO strip by the bank)', row(bnC.rows, 'Approaches and exits')?.st === 'warn' && /strip/.test(row(bnC.rows, 'Approaches and exits').reason), row(bnC.rows, 'Approaches and exits')?.reason);
}

// ── artillery behind a crossing (PlanArty.withArty): laid along the canal, its reach and its ground; read as drawn ──────
{
  const A = await import('../../MS/Engines/DeploymentBuilder/PlanArty.ts');
  const fdA = { id: 'arty-regt-fd', name: 'Fd Regt', unit: 'regt', guns: 18, partner: null, weapon: { id: '122-mm-how', name: '122 mm How', planM: 10620, maxM: 11800, minM: 0, sp: false }, src: 'test',
    band: [1000, 3540], bandSrc: 'GunDoctrine front', areaM: [1000, 1000], areaSrc: 'GunDoctrine areas', room: [0.9, 0.7] };
  const r = A.withArty(rec('bde-cross-two-up'), doc, fdA);
  const fl = F.fitLayout(inpOf(r, H));
  const ga = it(fl.raw, 'gunArea').pts.map((p) => world(fl, p)).map(nOfW);
  check('Bde crossing with a Fd Regt, fitted: its gun area on the home (south) bank, 1-4 km back', Math.max(...ga) < -1000 && Math.min(...ga) > -5000, `n ${Math.round(Math.min(...ga))}..${Math.round(Math.max(...ga))}`);
  check('...Arty reach passes (the break-in and the BH in range); Gun area read on the ground', row(fl.res.rows, 'Arty reach')?.st === 'pass' && ['pass', 'warn', 'fail'].includes(row(fl.res.rows, 'Gun area')?.st), `${row(fl.res.rows, 'Arty reach')?.reason} | ${row(fl.res.rows, 'Gun area')?.st}: ${row(fl.res.rows, 'Gun area')?.reason}`);
  const d = {};
  for (const i of fl.raw.items) { if (d[i.role]) continue; const w = (p) => { const q = world(fl, p); return [q.x, q.y]; }; d[i.role] = { pts: i.pts.map(w), ...(i.base ? { base: { start: w(i.base.start), mid: w(i.base.mid), end: w(i.base.end) } } : {}) }; }
  const c = C.checkCrossing(inpOf(r, H), d);
  check('...Check my plan reads it back as drawn: the same Arty reach', row(c.rows, 'Arty reach')?.st === 'pass', row(c.rows, 'Arty reach')?.reason);
  d.gunArea = { pts: d.gunArea.pts.map((q) => { const l = local(q[0], q[1]); return at(l.e, l.n - 9000); }) };
  const far = C.checkCrossing(inpOf(r, H), d);
  const AD = await import('../../MS/Engines/DeploymentBuilder/PlanAD.ts');
  const fu = (name, effM) => ({ name, effM, weapons: [{ id: 'x', name: 'Gun', count: 4, effM, ceilingM: null, kind: 'gun', assumed: false }] });
  const adA = { id: 'ad-bty-rcg', name: 'RCG AD Bty', unit: 'bty', fus: [fu('RCG Tp 1', 4000), fu('RCG Tp 2', 4000)], src: 't', releaseM: 1500, minFus: 2, siteM: [300, 1000], assumedNote: null };
  const ra = AD.withAd(r, doc, adA), fa = F.fitLayout(inpOf(ra, H));
  check('...with an RCG AD Bty: its two Tps laid along the canal by the bridge and the gun area; AD cover on the fitted plan', ['ad1', 'ad2'].every((x) => it(fa.raw, x)?.pts.length) && !!row(fa.res.rows, 'AD cover'), row(fa.res.rows, 'AD cover')?.st + ': ' + row(fa.res.rows, 'AD cover')?.reason);
  const dA = {};
  for (const i of fa.raw.items) { if (dA[i.role]) continue; const w = (p) => { const q = world(fa, p); return [q.x, q.y]; }; dA[i.role] = { pts: i.pts.map(w), ...(i.base ? { base: { start: w(i.base.start), mid: w(i.base.mid), end: w(i.base.end) } } : {}) }; }
  check('...Check my plan reads AD cover back as drawn, the same verdict', row(C.checkCrossing(inpOf(ra, H), dA).rows, 'AD cover')?.st === row(fa.res.rows, 'AD cover')?.st, row(C.checkCrossing(inpOf(ra, H), dA).rows, 'AD cover')?.reason);
  // aimed 40 degrees off square to the canal: the plan is re-laid square to the water, and Arty reach measures behind the
  // water in the canal's frame, so the gun area stands the same distance behind the FUPs
  const fd = F.fitLayout(inpOf(r, H, { bearing: (40 * Math.PI) / 180 }));
  const dOf = (x) => Number(row(x.res.rows, 'Arty reach')?.reason.match(/Fd Regt ([\d.]+) km behind the FUPs/)?.[1]);
  check('aimed 40 degrees off square: Arty reach reads the gun area the same distance behind the FUPs (within 0.2 km)', Math.abs(dOf(fd) - dOf(fl)) <= 0.2, `${dOf(fl)} km square, ${dOf(fd)} km at 40 degrees`);
  // G on a crossing: the move (plan metres) laid over the gun area as re-laid along the canal; Arty reach re-judged
  const fm = F.fitLayout(inpOf(r, H, { manual: { gunArea: { x: 0, y: -2000 } } }));
  const ga0 = it(fl.raw, 'gunArea').pts.map((p) => world(fl, p)).map(nOfW), ga1 = it(fm.raw, 'gunArea').pts.map((p) => world(fm, p)).map(nOfW);
  const back = Math.max(...ga0) - Math.max(...ga1);
  check('G on a crossing: the gun area moved 2 km back along with the re-lay; Arty reach now reads it outside its band', Math.abs(back - 2000) < 150 && /outside its band/.test(row(fm.res.rows, 'Arty reach')?.reason ?? ''), `${Math.round(back)} m back; ${row(fm.res.rows, 'Arty reach')?.reason?.slice(0, 110)}`);
  check('...its gun area dragged 9 km back: the BH out of range, Arty reach no longer passes', row(far.rows, 'Arty reach')?.st !== 'pass' && /out/.test(row(far.rows, 'Arty reach').reason), row(far.rows, 'Arty reach')?.reason);
}

// ── the mirror: a Bn defence on the canal (IC s85, IBB S57 Fig 34) ──────────────────────────────────────────────────────
{
  const cr = rec('bn-def-canal');
  const g = S.solveRecipe(cr, ctx, {});
  check('Canal defence: geometry: the click is the canal (pivot), frontage 3.75 km within IC s85 para 11 (5 km), depth about 3 km (Fig 34), AA BB CC dashed', it(g, 'xTgt')?.id === g.pivotId && row(g.rows, 'Frontage')?.st === 'pass' && row(g.rows, 'Depth')?.st === 'pass' && ['cpAA', 'cpBB', 'cpCC'].every((r) => it(g, r)?.planned), `${row(g.rows, 'Frontage')?.reason}`);
  const fl = F.fitLayout(inpOf(cr, at(0, 0), { threat: XY(at(0, 3000)), terrain: 'plains' }));
  const rows = fl.res.rows;
  const fwd = ['fwdL', 'fwdR'].map((r) => it(fl.raw, r).pts.map((p) => world(fl, p)));
  const front = Math.max(...fwd.flat().map(nOfW));
  check('...on the ground: A and B Coys on the home (south) bank, their front edge behind its crest', front < -30 && front > -140, `front edge n ${Math.round(front)}`);
  const mask = it(fl.raw, 'maskL').pts.map((p) => world(fl, p)), mf = it(fl.raw, 'mfFar').pts.map((p) => world(fl, p));
  check('...the mask posns ahead of the canal on his side, the minefield on his side (IC s85 paras 7, 17 a)', mask.every((p) => nOfW(p) > 300) && mf.every((p) => nOfW(p) > 45), `mask n ${Math.round(Math.min(...mask.map(nOfW)))}`);
  check('...Canal row: Upper Test Canal, irrigation canal, 60 m', /Upper Test Canal/.test(row(rows, 'Canal')?.reason ?? '') && /60 m/.test(row(rows, 'Canal').reason), row(rows, 'Canal')?.reason);
  check('...Higher bank: equal banks: IC s85 para 10 b puts the bulk on the far bank (warn, with the commander\'s choice in the fix)', row(rows, 'Higher bank')?.st === 'warn' && /equal/.test(row(rows, 'Higher bank').reason), row(rows, 'Higher bank')?.reason);
  check('...Bridges in sector: the Canal Br 1 km east (strong point or prepared for demolition)', row(rows, 'Bridges in sector')?.st === 'warn' && /Canal Br/.test(row(rows, 'Bridges in sector').reason) && fl.res.confirm.some((c) => /demolition/.test(c)), row(rows, 'Bridges in sector')?.reason);
  check('...Marsh on our side hampers our own counter-attack routes (warn); Obstacle value: 60 m beyond bridge-layer tanks', row(rows, 'Marsh')?.st === 'warn' && row(rows, 'Obstacle value')?.st === 'pass', `${row(rows, 'Marsh')?.reason}; ${row(rows, 'Obstacle value')?.reason}`);
  check('...the defence engine still checks it (frontage, depth, fields of fire, flanks) and the canal is drawn for the map', ['Frontage', 'Depth', 'Fields of fire', 'Flanks'].every((n2) => row(rows, n2)) && (fl.fit.crossing?.obstacle.line.length ?? 0) >= 2, rows.map((r) => r.name).join(', '));
  const off = F.fitLayout(inpOf(cr, at(0, -2000), { threat: XY(at(0, 3000)), terrain: 'plains' }));
  check('...clicked 2 km from any canal: the Canal row fails with its fix, the plan stays laid square to the aim', row(off.res.rows, 'Canal')?.st === 'fail' && /Click on the canal/.test(row(off.res.rows, 'Canal').detail?.fix?.[0] ?? ''), row(off.res.rows, 'Canal')?.reason);
}

// ── the obstacle frame ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  const bend = [at(-3000, 0), at(0, 0), M.offsetPt(...at(0, 0), 45, 3000)];
  const of = new C.ObstacleFrame(bend, at(0, 0), 90, 1);
  const p = of.world(1000, 0), q = of.world(1000, 500);
  check('ObstacleFrame: x follows the bend (1 km along the NE leg), n goes across toward the far side', Math.abs(M.groundDist(p, at(0, 0)) - 1000) < 30 && M.bearingOf(at(0, 0), p) > 30 && M.bearingOf(at(0, 0), p) < 60 && Math.abs(M.groundDist(p, q) - 500) < 5, `${Math.round(M.bearingOf(at(0, 0), p))} deg`);
}

// ── the 3-Coy Bn crossing (the Lt Cdo Bn) ─────────────────────────────────────────────────────────────────────────────
{
  const r3 = rec('bn3-cross-two-up');
  check('3-Coy Bn crossing: forCoys 3, the Lt Cdo Bn; A, B assault, C passes through, no D Coy; the note says who stands in as reserve', r3.forCoys === 3 && r3.unit === 'inf-bn-lt-cdo' && ['aCoy', 'bCoy', 'cCoy'].every((x) => r3.slots.some((s) => s.role === x)) && !r3.slots.some((s) => s.role === 'dCoy') && /no Coy left for a reserve/.test(r3.note));
  const f3 = F.fitLayout(inpOf(r3, H));
  check('...fitted on the canal like the 4-Coy layout: the same crossing rows (Obstacle, Boats, Bridge)', ['Obstacle', 'Boats', 'Bridge'].every((x) => row(f3.res.rows, x)) && row(f3.res.rows, 'Obstacle')?.st === row(F.fitLayout(inpOf(rec('bn-cross-two-up'), H)).res.rows, 'Obstacle')?.st, f3.res.rows.map((x) => x.name).slice(0, 8).join(', '));
}

// ── Check my plan on a looping canal: a crossing built there reads back as built ──────────────────────────────────────
// Seen in the app on the Lahore Minor: the gun area 4 km back stretched the canal read for the drawn plan round a bend,
// and the fronts (650/900 m) and the bridgehead (2.7 km) read back other than built (650/650 m, 3.8 km).
{
  const A = await import('../../MS/Engines/DeploymentBuilder/PlanArty.ts');
  const fdA = { id: 'arty-regt-fd', name: 'Fd Regt', unit: 'regt', guns: 18, partner: null, weapon: { id: '122-mm-how', name: '122 mm How', planM: 10620, maxM: 11800, minM: 0, sp: false }, src: 'test',
    band: [1000, 3540], bandSrc: 'GunDoctrine front', areaM: [1000, 1000], areaSrc: 'GunDoctrine areas', room: [0.9, 0.7] };
  // the test canal straight to 3 km east of H, then doubling back 300 m behind the home bank to 1 km east of H (beside
  // FUP 2), then south and on east: the reach the build reads stops short of the bend; one stretched by the gun area
  // (2.5-3.5 km back) took the loop in, and FUP 2 read 5.0 km wide against it
  const bentXY = [...at(-8000, 0), ...at(3000, 0), ...at(3000, -300), ...at(1000, -300), ...at(1000, -800), ...at(9000, -800)];
  const dOf = (x, y) => M.distToLine([x, y], bentXY);
  const elevB = (x, y) => { const a = dOf(x, y); return land(local(x, y).e) + (a < 30 ? 1.5 : a <= 45 ? 3 : 0); };
  const clsB = (x, y) => { const a = dOf(x, y); return a < 30 ? 20 : a <= 45 ? 24 : 2; };
  const sightB = (ox, oy, eyeM, tx, ty, targetM) => {
    const d = M.groundDist([ox, oy], [tx, ty]), steps = Math.max(2, Math.ceil(d / 15)), e0 = elevB(ox, oy) + eyeM, e1 = elevB(tx, ty) + targetM;
    for (let i = 1; i < steps; i++) { const t = i / steps; if (elevB(ox + (tx - ox) * t, oy + (ty - oy) * t) > e0 + (e1 - e0) * t) return 0; }
    return 1;
  };
  const probeB = { ...probe, cls: clsB, elev: elevB, sight: sightB, sight2: (...a) => { const v = sightB(...a); return { p: v, pTerrain: v }; }, raster: () => 0, features: () => [],
    lines: (x, y, r, kinds) => (kinds.has('canal') && dOf(x, y) <= r + 50 ? [{ kind: 'canal', xy: bentXY, attrs: { n: 'Bent Test Canal', t: 'MainCanal', w: 60, dp: 3, bl: 2, br: 3, b: 3 } }] : []) };
  const groundB = { ...ground, cls: clsB, elev: elevB, sight: sightB, mov: () => probeB };
  const r = A.withArty(rec('bde-cross-two-up'), doc, fdA);
  const fl = F.fitLayout(inpOf(r, H, { ground: groundB }));
  const d = {};
  for (const i of fl.raw.items) { if (d[i.role]) continue; const w = (p) => { const q = world(fl, p); return [q.x, q.y]; }; d[i.role] = { pts: i.pts.map(w), ...(i.base ? { base: { start: w(i.base.start), mid: w(i.base.mid), end: w(i.base.end) } } : {}) }; }
  const c = C.checkCrossing(inpOf(r, H, { ground: groundB }), d);
  const ga = it(fl.raw, 'gunArea').pts.map((p) => nOfW(world(fl, p)));
  const names = ['Fronts', 'Phase 1', 'Bridgehead', 'Arty reach', 'Assy areas', 'Observed fire'];
  check('Looping canal: a Bde crossing with its Fd Regt (the gun area over 1 km back) read back by Check my plan as built: Fronts, Phase 1, Bridgehead, Arty reach, Assy areas and Observed fire the same',
    Math.min(...ga) < -1000 && !!c && names.every((nm) => row(c.rows, nm) && row(c.rows, nm).reason === row(fl.res.rows, nm)?.reason),
    c ? names.map((nm) => `${nm}: ${row(fl.res.rows, nm)?.reason?.slice(0, 50)} / ${row(c.rows, nm)?.reason?.slice(0, 50)}`).join(' | ') : 'null');
}

// ── Corps bridging: the span the gap needs is longer than the division holds (Annex Q para 1) ────────────────────
{
  const plan2 = JSON.parse(JSON.stringify(doc.plan));
  const m2 = plan2.crossing.bridges.list.find((b) => b.cls === 9);
  m2.heldM = { ...(m2.heldM ?? {}), infDiv: 60 };
  const ctx2 = { doc: { ...doc, plan: plan2 }, symbols };
  const fl = F.fitLayout({ ...inpOf(rec('bn-cross-two-up'), H), ctx: ctx2 });
  const br = row(fl.res.rows, 'Bridge');
  check('Corps bridging: the 84 m set needed, the division holds 60 m: the Bridge row warns, names Corps bridging, the fix asks Corps engineers', br?.st === 'warn' && /Corps bridging, the 84 m set from Corps engineers/.test(br.reason) && (br.detail?.fix ?? []).some((x) => /Corps engineers/.test(x)), br?.reason);
  check('...the timeline names the Corps set', fl.fit.crossing.times.some((t) => /\(Corps set\)/.test(t.label)), fl.fit.crossing.times.map((t) => t.label).join(' | '));
  const fl0 = F.fitLayout(inpOf(rec('bn-cross-two-up'), H));
  check('...with the division\'s 84 m held: no Corps words', !/Corps bridging/.test(row(fl0.res.rows, 'Bridge')?.reason ?? '') && !fl0.fit.crossing.times.some((t) => /Corps set/.test(t.label)));
}

console.log(`\n${n - fails} of ${n} checks passed`);
process.exit(fails ? 1 : 0);
