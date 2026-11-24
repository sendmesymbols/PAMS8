// arty.mjs -- checks artillery with a Bn plan (MS/Engines/DeploymentBuilder/PlanArty.ts): the Regts and Btys of the ORBAT
// (arty.json, weapons.json: SO's Hbk 2019 Sec 2), the gun area laid behind the plan in the Gun Deployment doctrine's band
// (GunDoctrine.json front, areas, room), Arty reach (DF Tgts, his FUP; the Obj and LOE in an attack), the Gun area row on
// the ground (the bundle's Gun Position going), the recipe chain with tanks and 3-Coy layouts, and Check my plan's read-back.
//   node tools/planbuilder-test/arty.mjs          (add --quiet to print only failures and the summary)
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const O = await import('../../MS/Engines/DeploymentBuilder/PlanOrbat.ts');
const A = await import('../../MS/Engines/DeploymentBuilder/PlanArty.ts');
const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
const R = await import('../../MS/Engines/DeploymentBuilder/PlanRecipes.ts');
const F = await import('../../MS/Engines/DeploymentBuilder/PlanFit.ts');
const W = await import('../../MS/Engines/DeploymentBuilder/PlanWhatIf.ts');
const T = await import('../../MS/Engines/DeploymentBuilder/PlanTanks.ts');
const K = await import('../../MS/Engines/DeploymentBuilder/PlanCheck.ts');
const G = await import('../../MS/Engines/GunDeployment/GunDeploymentFind.ts');

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
const rules = json('MS/Data/terrain-bundle/rules.json');
const goingOf = (p) => ({ nogo: new Set(rules.profiles[p].nogo), caution: new Set(rules.profiles[p].caution ?? []) });
const rec = (id) => json(`MS/Data/Deployments/Recipes/${id}.json`);
const row = (rows, name) => rows.find((r) => r.name === name);
const P = 'MS/Data/Orbat/PK/';
const orbat = { own: O.mergeOwn(O.OWN_ORBAT_FILES.map((f) => json(`${P}${f}`).units)), en: json(`${P}en.json`).units, weapons: json(`${P}weapons.json`).weapons, engrData: json(`${P}engr.json`).engrData };
const GR = G.gunRulesFrom(json('MS/Data/GunDoctrine.json'));
const ad = {
  defMinM: GR.front.def.minM.value, attkMinM: GR.front.attk.minM.value, defMaxFrac: GR.front.def.maxFrac.value, attkMaxFrac: GR.front.attk.maxFrac.value,
  regtM: [GR.areas.regt.frontM.value, GR.areas.regt.depthM.value], btyM: [GR.areas.bty.frontM.value, GR.areas.bty.depthM.value],
  room: [GR.room.okShare.value, GR.room.minShare.value], src: { band: 'GunDoctrine front', area: 'GunDoctrine areas' },
};

// ── the artillery a Bn can have ────────────────────────────────────────────────────────────────────────────────────────
const types = A.ownArtyTypes(orbat), T_ = (id) => types.find((t) => t.id === id);
check('Regts offered: Fd, Med, Med (SP), Hy (155 mm Gun), Mtn; their Btys after them', ['arty-regt-fd', 'arty-regt-med', 'arty-regt-med-sp', 'arty-regt-hy-155gun', 'arty-regt-mtn'].every((id) => T_(id)?.unit === 'regt') && types.findIndex((t) => t.unit === 'bty') === 5 && types.length === 10, types.map((t) => t.id).join(' '));
check('...not the rockets (MLRS 40 km min, MBRL: general support), the 8 in (no weapon linked) or the locating units', !types.some((t) => /mlrs|mbrl|8in|loc/.test(t.id)));
const fd = T_('arty-regt-fd');
check('Fd Regt: 18 x 122 mm How, planning range 10.6 km (90 % of 11.8 km, p 212), towed; its Bty the Fd Bty (6)', fd.guns === 18 && fd.weapon.id === '122-mm-how' && fd.weapon.planM === 10620 && !fd.weapon.sp && fd.partner === 'arty-bty-fd' && T_('arty-bty-fd').guns === 6 && T_('arty-bty-fd').partner === 'arty-regt-fd');
check('Med Regt (SP): the M109, SP; Hy Regt: 12 x 155 mm Gun at 21.2 km', T_('arty-regt-med-sp').weapon.sp && T_('arty-regt-hy-155gun').guns === 12 && T_('arty-regt-hy-155gun').weapon.planM === 21162);

// ── the band and the gun area (GunDoctrine) ──────────────────────────────────────────────────────────────────────────
const aDef = A.artyOnPlan(fd, 'defence', ad), aAtk = A.artyOnPlan(fd, 'attack', ad), aMtn = A.artyOnPlan(T_('arty-regt-mtn'), 'defence', ad), aBty = A.artyOnPlan(T_('arty-bty-fd'), 'defence', ad);
check('band behind the front: defence 2.0 km to a third of 10.6 km (3.5 km); attack from 1.0 km (GunDoctrine front)', JSON.stringify(aDef.band) === '[2000,3540]' && JSON.stringify(aAtk.band) === '[1000,3540]', `${aDef.band} ${aAtk.band}`);
check('gun area: a Regt 1000 x 1000 m, a Bty 400 x 200 m (GunDoctrine areas); room 90 % wanted, 70 % least', JSON.stringify(aDef.areaM) === '[1000,1000]' && JSON.stringify(aBty.areaM) === '[400,200]' && JSON.stringify(aDef.room) === '[0.9,0.7]');
check('a shorter gun has a narrower band: Mtn Regt 2.0-3.0 km', JSON.stringify(aMtn.band) === '[2000,3000]');

// ── the recipe ───────────────────────────────────────────────────────────────────────────────────────────────────────
const two = rec('bn-def-two-up'), front = rec('bn-attk-frontal');
const d1 = A.withArty(two, doc, aDef), t1 = A.withArty(front, doc, aAtk);
const bad = (r) => R.validateRecipe(r, ctx).filter((i) => i.level === 'fail').map((i) => i.msg);
check('Bn Def and Bn Attk with the Fd Regt: the recipes validate, ids -gun, the gun area a PAA (25240501) named for the Regt', !bad(d1).length && !bad(t1).length && d1.id === 'bn-def-two-up-gun' && t1.id === 'bn-attk-frontal-gun' && d1.slots.find((s) => s.role === 'gunArea')?.sym === '25240501' && d1.slots.find((s) => s.role === 'gunArea').label === 'Fd Regt', [...bad(d1), ...bad(t1)].join('; '));
check('...the ones passed in unchanged; a Coy plan and a plan that has its artillery already are left as they are', !two.slots.some((s) => s.role === 'gunArea') && !two.arty && A.withArty(d1, doc, aDef) === d1);
const rect = (r) => r.slots.find((s) => s.role === 'gunArea').shape.rect;
check('defence: on the axis, its front edge in the middle of the band behind the FDL (FDL front edge -1550 m + 2770 m)', rect(d1).acrossM === 0 && rect(d1).backM === -1550 + 2770 + 500, JSON.stringify(rect(d1)));
check('attack: 1500 m beside the axis (clear of the Assy Area), its front edge 2270 m behind the FUP', rect(t1).acrossM === 1500 && rect(t1).backM === 0 + 2270 + 500, JSON.stringify(rect(t1)));

// ── Arty reach without the ground ────────────────────────────────────────────────────────────────────────────────────
const rD = S.solveRecipe(d1, ctx, {}), rT = S.solveRecipe(t1, ctx, {});
const reachD = A.artyRows(rD.items, d1, 2500), reachT = A.artyRows(rT.items, t1, null);
check('defence: Arty reach passes: 2.8 km behind the FDL, the guns 7.3 km beyond it, past his FUP 2.5 km out, all DF Tgts in range', reachD.length === 1 && reachD[0].st === 'pass' && /2\.8 km behind the FDL/.test(reachD[0].reason) && /7\.3 km beyond the FDL, past the En FUP 2\.5 km out/.test(reachD[0].reason) && /(\d+) of \1 DF Tgts in range/.test(reachD[0].reason), reachD[0]?.reason);
check('attack: Arty reach passes: 2.3 km behind the FUP, the Obj and the LOE in range', reachT[0]?.st === 'pass' && /2\.3 km behind the FUP/.test(reachT[0].reason) && /the Obj and the LOE in range/.test(reachT[0].reason), reachT[0]?.reason);
check('the gun area changes no frontage or depth row', row(rD.rows, 'Frontage')?.reason === row(S.solveRecipe(two, ctx, {}).rows, 'Frontage')?.reason && row(rD.rows, 'Depth')?.reason === row(S.solveRecipe(two, ctx, {}).rows, 'Depth')?.reason);
check('no artillery: no rows', !A.artyRows(S.solveRecipe(two, ctx, {}).items, two, 2500).length);
// a gun too short: the band is empty, it stands at the minimum and falls short
const shortGun = { ...aDef, weapon: { ...aDef.weapon, planM: 4000 }, band: [2000, 1333] };
const dS = A.withArty(two, doc, shortGun), rowS = A.artyRows(S.solveRecipe(dS, ctx, {}).items, dS, 2500)[0];
check('a 4 km gun: the band is empty, the gun area stands at its 2 km minimum, reaches short of his FUP and of DF Tgts: warn', rowS.st === 'warn' && /short of the En FUP/.test(rowS.reason) && /no band: a third of its range \(1\.3 km\) is short of the 2\.0 km/.test(rowS.reason) && !/(\d+) of \1 DF/.test(rowS.reason), rowS.reason);
const tS = A.withArty(front, doc, { ...aAtk, weapon: { ...aAtk.weapon, planM: 2500 } }), rowTS = A.artyRows(S.solveRecipe(tS, ctx, {}).items, tS, null)[0];
check('an attack whose Obj and LOE are out of range fails: the guns forward, or a longer gun', rowTS.st === 'fail' && /out of range/.test(rowTS.reason), rowTS.reason);
// moved too near the front
const near = rD.items.map((i) => (i.role === 'gunArea' ? { ...i, pts: i.pts.map((p) => ({ x: p.x, y: p.y + 1500 })) } : i));
check('a gun area moved to 1.3 km behind the FDL warns: too near the front, he overruns it early (OoW I p 70)', A.artyRows(near, d1, 2500)[0].st === 'warn' && /too near the front/.test(A.artyRows(near, d1, 2500)[0].reason));

// ── the chain: with tanks, two phases, a 3-Coy layout ────────────────────────────────────────────────────────────────
const sqn = O.tankSqnOf(orbat), sq = { tanks: sqn.tanks, tps: sqn.tps, tpTanks: sqn.tpTanks, regtTanks: sqn.regtTanks, src: sqn.src };
const chain1 = A.withArty(T.withDefTanks(two, doc, 1, sq), doc, aDef), chain2 = A.withArty(T.withTanks(front, doc, 'close', sq), doc, aAtk), chain3 = A.withArty(rec('bn3-def-two-up'), doc, aDef);
check('with tank Sqns, with tanks in close sp, on a 3-Coy layout: both kept, ids stack (-tkd1-gun, -tkc-gun), all validate', chain1.id === 'bn-def-two-up-tkd1-gun' && chain1.slots.some((s) => s.role === 'tkSqn') && chain2.id === 'bn-attk-frontal-tkc-gun' && chain2.slots.some((s) => s.role === 'tkAxis') && chain3.forCoys === 3 && [chain1, chain2, chain3].every((r) => !bad(r).length));

// ── on the ground ────────────────────────────────────────────────────────────────────────────────────────────────────
const defG = (over = {}) => ({ cls: () => 2, elev: () => 200, going: goingOf, label: (c) => rules.classes[String(c)]?.label ?? String(c), sight: () => 0.1, pending: () => false, dataLine: () => 'synthetic', ...over,
  avenues: () => [0, 3600].map((x) => { const path = []; for (let y = 8000; y >= -500; y -= 100) path.push({ x: x - (x * Math.max(0, 2000 - y)) / 2500, y }); return { path, lengthM: 8500, goPct: 100, minWidthM: 2000, chokes: [] }; }) });
const mech = { echelon: '18', type: 'mech', source: 'user' };
const inp = (r, g) => ({ recipe: r, ctx, opts: { alternates: 'visible' }, ground: g, anchor: { x: 0, y: 0 }, bearing: 0, threat: { x: 0, y: 8000 }, enemy: mech, terrain: 'plains' });
const flG = F.fitLayout(inp(d1, defG()));
const gaRow = row(flG.res.rows, 'Gun area'), arRow = row(flG.res.rows, 'Arty reach');
check('on the ground: Gun area passes on open ground (100 % a gun position may take), Arty reach is there too', gaRow?.st === 'pass' && /100 % of it/.test(gaRow.reason) && /sites it with the Gun Deployment finder/.test(gaRow.reason) && arRow?.st === 'pass', gaRow?.reason);
const gunNoGo = [...goingOf('gun').nogo].find((c) => !goingOf('dismounted').nogo.has(c) && !goingOf('tracked').nogo.has(c)) ?? [...goingOf('gun').nogo][0];
const ga = flG.raw.items.find((i) => i.role === 'gunArea');
const gc = F.toWorld(flG.frame, { x: ga.pts.reduce((s, p) => s + p.x, 0) / ga.pts.length, y: ga.pts.reduce((s, p) => s + p.y, 0) / ga.pts.length });
const half = (x, y) => (x > gc.x + 100 ? gunNoGo : 2), all = () => gunNoGo, edge = (x) => (x > gc.x + 300 ? gunNoGo : 2);
check('...a gun area half on ground no gun position takes fails: move it', row(F.fitLayout(inp(d1, defG({ cls: half }))).res.rows, 'Gun area')?.st === 'fail');
check('...a fifth of it so warns (80 %: between 70 and 90)', row(F.fitLayout(inp(d1, defG({ cls: edge }))).res.rows, 'Gun area')?.st === 'warn', row(F.fitLayout(inp(d1, defG({ cls: edge }))).res.rows, 'Gun area')?.reason);
check('...none of it usable fails', row(F.fitLayout(inp(d1, defG({ cls: all }))).res.rows, 'Gun area')?.st === 'fail');
check('the ground reads the Gun Position going (rules.json profiles.gun), not the wheels\' or tracks\'', !!rules.profiles.gun && goingOf('gun').nogo.size > goingOf('tracked').nogo.size);

// ── Check my plan reads the artillery back ───────────────────────────────────────────────────────────────────────────
{
  const g = defG();
  const fi = inp(d1, g);
  const fl = W.withMoves(F.fitLayout(fi), fi);
  const pd = S.toPlanDocument(fl.raw, (pid, ov, id, de) => ({ plnOrdrSymbolPK: { plnOrdrSymbolId: id }, drawEss: JSON.stringify(de) }), (pid, id, name, seq, syms) => ({ plnOrdrSymbolSet: syms }), 1);
  const meta = { ground: fl.terrain.kind, groundWhy: null, enemy: { echelon: '18', type: 'mech' }, unit: 'inf-bn-std', threat: { x: 0, y: 8000 }, arty: d1.arty };
  const syms = K.readSymbols(K.recordsFromPlanDoc(pd.doc)).map((s) => ({ ...s, pts: s.pts.map((p) => F.toWorld(fl.frame, p)), pbRole: pd.roles[s.id], pbRecipe: d1.id, pbMeta: meta }));
  const r = K.checkPlan(syms, doc, { ground: g, recipes: { [d1.id]: d1 }, orbat });
  check('Check my plan on the placed plan: Arty reach and Gun area read back with the build\'s verdicts', row(r.rows, 'Arty reach')?.st === row(fl.res.rows, 'Arty reach')?.st && row(r.rows, 'Gun area')?.st === row(fl.res.rows, 'Gun area')?.st, `${row(r.rows, 'Arty reach')?.reason} | ${row(r.rows, 'Gun area')?.st}`);
  check('...the gun area is not taken for a posn held', !r.posns.some((p) => p.label === 'Fd Regt' && p.kind !== 'ignore'));
  const rn = K.checkPlan(syms.map((s) => ({ ...s, pbMeta: { ...meta, arty: null } })), doc, { ground: g, recipes: { [d1.id]: d1 }, orbat });
  check('...built without artillery: no Arty rows', !row(rn.rows, 'Arty reach') && !row(rn.rows, 'Gun area'));
}

// ── the fire lifts by the plan's own guns (IC s66 p305) ──────────────────────────────────────────────────────────────
{
  const AT = await import('../../MS/Engines/DeploymentBuilder/PlanAttack.ts');
  const ringsOf = (r) => AT.attackTimes(S.solveRecipe(r, ctx, {}), null, null, doc, 'plains', false, null).lifts.map((l) => `${l.label} ${l.rM}`).join(', ');
  check('no artillery on the plan: the assault timed to every lift (120 mm 450, Med 360, Bn Mor 275, Fd 180)', ringsOf(front) === '120 mm Mor 450, Med 360, Bn Mor 275, Fd 180', ringsOf(front));
  check('the Fd Regt: its own field lift (180 m) and the Bn\'s mortars (275 m) only', ringsOf(t1) === 'Bn Mor 275, Fd Regt 180', ringsOf(t1));
  const tMed = A.withArty(front, doc, A.artyOnPlan(T_('arty-regt-med'), 'attack', ad)), tHy = A.withArty(front, doc, A.artyOnPlan(T_('arty-bty-hy-155gun'), 'attack', ad)), tMtn = A.withArty(front, doc, A.artyOnPlan(T_('arty-regt-mtn'), 'attack', ad));
  check('a Med Regt and a Hy Bty lift at the medium 360 m; a Mtn Regt (105 mm) at the field 180 m', ringsOf(tMed) === 'Bn Mor 275, Med Regt 360' && /360$/.test(ringsOf(tHy)) && /Mtn Regt 180$/.test(ringsOf(tMtn)), `${ringsOf(tMed)} | ${ringsOf(tHy)} | ${ringsOf(tMtn)}`);
  check('liftRings: the furthest lift sets how far out the SL must be: 450 m without artillery, 275 m with the Fd Regt', Math.max(...AT.liftRings(S.solveRecipe(front, ctx, {}), doc).map((x) => x[1])) === 450 && Math.max(...AT.liftRings(rT, doc).map((x) => x[1])) === 275);
}

// ── Check my plan on an attack built with artillery ──────────────────────────────────────────────────────────────────
{
  const pd = S.toPlanDocument(rT, (pid, ov, id, de) => ({ plnOrdrSymbolPK: { plnOrdrSymbolId: id }, drawEss: JSON.stringify(de) }), (pid, id, name, seq, syms) => ({ plnOrdrSymbolSet: syms }), 1);
  // placed in Web Mercator near 31.5 N (a plan drawn at the equator would scale differently): metres times the Mercator factor
  const k = 1 / Math.cos((31.5 * Math.PI) / 180), y0 = 3700000;
  const syms = K.readSymbols(K.recordsFromPlanDoc(pd.doc)).map((s) => ({ ...s, pts: s.pts.map((p) => ({ x: p.x * k, y: y0 + p.y * k })), pbRole: pd.roles[s.id], pbRecipe: t1.id, pbMeta: { arty: t1.arty } }));
  const r = K.checkPlan(syms, doc, {});
  const ar = row(r.rows, 'Arty reach');
  check('Check my plan on a built Bn Attk with the Fd Regt: Arty reach read back from the gun area, FUP, Obj and LOE: 2.3 km behind the FUP, the Obj and LOE in range', r.task === 'attack' && ar?.st === reachT[0].st && /2\.3 km behind the FUP/.test(ar.reason) && /the Obj and the LOE in range/.test(ar.reason), ar?.reason);
  const rn = K.checkPlan(syms.map((s) => ({ ...s, pbMeta: {} })), doc, {});
  check('...without artillery in what it was built for: no Arty reach', !row(rn.rows, 'Arty reach'));
}

// ── crossings: a Regt behind a Bn or Bde crossing, the Div Arty behind a Div bridgehead ─────────────────────────────────
{
  const divs = A.ownDivArties(orbat, types), inf = divs.find((d) => d.id === 'arty-inf-div-arty'), armd = divs.find((d) => d.id === 'arty-armd-div-arty');
  check('Div Arties: Inf Div Arty 2 Fd + 2 Med Regts (72 guns), Armd Div Arty 3 Med (SP) + 1 Med Regt (Sec 2 pp 202-203)', inf?.unit === 'div' && inf.regts.map((r) => r.id).join() === 'arty-regt-fd,arty-regt-fd,arty-regt-med,arty-regt-med' && inf.guns === 72 && armd?.regts.length === 4 && armd.regts.filter((r) => r.id === 'arty-regt-med-sp').length === 3, divs.map((d) => `${d.id}:${d.regts.map((r) => r.name)}`).join(' | '));
  check('...the Regts named 1 Fd Regt, 2 Fd Regt ...; the chip shows its longest gun', inf.regts[0].name === '1 Fd Regt' && inf.regts[3].name === '2 Med Regt' && inf.weapon.planM === Math.max(...inf.regts.map((r) => r.weapon.planM)));
  const cx = A.artyOnPlan(fd, 'crossing', ad), dx = A.artyOnPlan(inf, 'crossing', ad);
  check('a crossing is an attack: the band from 1.0 km; each Div Regt with its own band and area', cx.band[0] === 1000 && dx.regts.length === 4 && dx.regts.every((r) => r.band[0] === 1000 && r.areaM[0] === 1000) && dx.regts[2].band[1] > dx.regts[0].band[1]);
  const bde = A.withArty(rec('bde-cross-two-up'), doc, cx), div = A.withArty(rec('div-bridgehead-two-bde'), doc, dx), bn = A.withArty(rec('bn-cross-two-up'), doc, cx);
  check('Bn, Bde, Div crossings take it: ids -gun, valid recipes; one gun area a Bn or Bde, four a Div (gunArea .. gunArea4)', [bn, bde, div].every((r) => r.id.endsWith('-gun') && !bad(r).length) && bde.slots.filter((s) => /^gunArea/.test(s.role)).length === 1 && div.slots.filter((s) => /^gunArea/.test(s.role)).map((s) => s.role).join() === 'gunArea,gunArea2,gunArea3,gunArea4', [...bad(bn), ...bad(bde), ...bad(div)].join('; '));
  const box = (s) => { const r = s.shape.rect; return [r.acrossM - r.wM / 2, r.backM - r.hM / 2, r.acrossM + r.wM / 2, r.backM + r.hM / 2]; };
  const overlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  const clearOf = (r) => { const g = r.slots.filter((s) => /^gunArea/.test(s.role)).map(box); const other = r.slots.filter((s) => s.shape?.rect && !/^gunArea/.test(s.role)).map(box); return g.every((a, i) => !other.some((b) => overlap(a, b)) && !g.some((b, j) => j !== i && overlap(a, b))); };
  check('...on the home bank, clear of the Assy areas and of each other', [bn, bde, div].every(clearOf) && [bn, bde, div].every((r) => r.slots.filter((s) => /^gunArea/.test(s.role)).every((s) => s.shape.rect.backM - s.shape.rect.hM / 2 > 300)), div.slots.filter((s) => /^gunArea/.test(s.role)).map((s) => JSON.stringify(s.shape.rect)).join(' '));
  const sv = (r) => S.solveRecipe(r, ctx, {});
  const rb = A.artyRows(sv(bde).items, bde, null), rd = A.artyRows(sv(div).items, div, null);
  check('Bde crossing, Fd Regt: Arty reach passes, the break-in and the BH in range', row(rb, 'Arty reach')?.st === 'pass' && /the break-in in range/.test(row(rb, 'Arty reach').reason), row(rb, 'Arty reach')?.reason);
  check('Div bridgehead, Inf Div Arty: Arty reach reads all four Regts; the 6 km BH beyond the Fd Regts: warn or pass with the Med Regts on it', /1 Fd Regt.*2 Fd Regt.*1 Med Regt.*2 Med Regt/.test(row(rd, 'Arty reach')?.reason ?? '') && row(rd, 'Arty reach').st !== 'fail', row(rd, 'Arty reach')?.st + ': ' + row(rd, 'Arty reach')?.reason);
  const hy = A.withArty(rec('div-bridgehead-two-bde'), doc, A.artyOnPlan(T_('arty-regt-mtn'), 'crossing', ad));
  check('a crossing without arty has no Arty reach row', !A.artyRows(sv(rec('bde-cross-two-up')).items, rec('bde-cross-two-up'), null).length && !!hy.arty);
}

console.log(`\n${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
