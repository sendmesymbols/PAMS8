// ad.mjs -- checks air defence over a plan's vulnerable points (MS/Engines/DeploymentBuilder/PlanAD.ts): the AD Btys and
// Regts of the ORBAT (ad.json, weapons.json: SO's Hbk 2019 Sec 3) as fire units, the VPs in priority, the FUs sited round
// them, the AD cover row, and the chain with the artillery on a Bn attack, a Bn defence and the crossings.
//   node tools/planbuilder-test/ad.mjs          (add --quiet to print only failures and the summary)
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const O = await import('../../MS/Engines/DeploymentBuilder/PlanOrbat.ts');
const D = await import('../../MS/Engines/DeploymentBuilder/PlanAD.ts');
const A = await import('../../MS/Engines/DeploymentBuilder/PlanArty.ts');
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
const symbols = json('MS/Data/Symbols.json');
const ctx = { doc, symbols };
const rec = (id) => json(`MS/Data/Deployments/Recipes/${id}.json`);
const row = (rows, name) => rows.find((r) => r.name === name);
const P = 'MS/Data/Orbat/PK/';
const orbat = { own: O.mergeOwn(O.OWN_ORBAT_FILES.map((f) => json(`${P}${f}`).units)), en: json(`${P}en.json`).units, weapons: json(`${P}weapons.json`).weapons };
const bad = (r) => R.validateRecipe(r, ctx).filter((i) => i.level === 'fail').map((i) => i.msg);

// ── the AD units as fire units ───────────────────────────────────────────────────────────────────────────────────────
const types = D.ownAdTypes(orbat, doc), T_ = (id) => types.find((t) => t.id === id);
check('AD Btys and Regts offered, Btys first; not the SC&R (radars only)', types.length >= 10 && types.findIndex((t) => t.unit === 'regt') > 0 && types.slice(types.findIndex((t) => t.unit === 'regt')).every((t) => t.unit === 'regt') && !types.some((t) => /scr/.test(t.id)), types.map((t) => `${t.id}:${t.fus.length}`).join(' '));
const gm = T_('ad-bty-lt-gm');
check('Lt AD (GM) Bty: a Gun Tp (4 x 37 mm, 3.5 km) and two Msl Tps (4 SAM each, taken as the Anza Mk II 5 km, E)', gm?.fus.length === 3 && gm.fus[0].weapons[0].id === '37-mm' && gm.fus[0].effM === 3500 && gm.fus.slice(1).every((f) => f.weapons[0].id === 'anza-mk-ii' && f.weapons[0].assumed && f.effM === 5000), gm?.fus.map((f) => `${f.name}=${f.weapons.map((w) => `${w.count}x${w.id}${w.assumed ? '*' : ''}`)}`).join(' | '));
check('...named Gun Tp, Msl Tp 1, Msl Tp 2', gm.fus.map((f) => f.name).join() === 'Gun Tp,Msl Tp 1,Msl Tp 2', gm.fus.map((f) => f.name).join());
const sp = T_('ad-bty-lt-gm-sp'), rbs = T_('ad-bty-rbs70'), rcg = T_('ad-bty-rcg'), med = T_('ad-bty-med');
check('Lt AD (GM/SP) Bty: its chart boxes as FUs (Gun Tp, Msl Tp, Msl Tp RBS 70: 5 km RBS-70)', sp?.fus.length === 3 && sp.fus.some((f) => f.weapons.some((w) => w.id === 'rbs-70' && w.effM === 5000)), sp?.fus.map((f) => f.name).join());
check('RBS-70 Bty 2 Tps (8 km Bolide); RCG Bty 2 Tps (35 mm 4 km); Med AD Bty 2 FUs (57 mm 6 km)', rbs?.fus.length === 2 && rbs.fus[0].effM === 8000 && rcg?.fus.length === 2 && rcg.fus[0].effM === 4000 && med?.fus.length === 2 && med.fus[0].effM === 6000, [rbs, rcg, med].map((t) => t && `${t.id}:${t.fus.map((f) => f.effM)}`).join(' '));
const reg = T_('ad-regt-lt-gm');
check('Lt AD (GM) Regt: its three Btys\' FUs, 1 Bty Gun Tp ... 3 Bty Msl Tp 2', reg?.fus.length === 9 && reg.fus[0].name === '1 Bty Gun Tp' && reg.fus[8].name === '3 Bty Msl Tp 2', reg?.fus.map((f) => f.name).join());

// ── the figures and the VPs ──────────────────────────────────────────────────────────────────────────────────────────
const aGm = D.adOnPlan(gm, doc);
check('figures from PlanDoctrine ad (E): engage 1.5 km out, 2 FUs over the bridges and gun areas, sited 300-1000 m out', aGm.releaseM === 1500 && aGm.minFus === 2 && JSON.stringify(aGm.siteM) === '[300,1000]' && /anza/i.test(aGm.assumedNote ?? ''), JSON.stringify({ r: aGm.releaseM, m: aGm.minFus, s: aGm.siteM, n: aGm.assumedNote }));
const vb = D.vpsOf(rec('bde-cross-two-up'), doc);
check('Bde crossing VPs: the bridge first, then the Bde HQ, then the Assy areas and the Veh Wait', vb[0].role === 'bridge' && vb[1].role === 'hq' && vb.slice(2).every((v) => /^(assy|vwa)/.test(v.role)) && vb.length === 6, vb.map((v) => v.role).join());
const vd = D.vpsOf(rec('bn-def-two-up'), doc);
check('Bn defence VPs: the Bn HQ (IBB p 23; OOW1 p 27 HQs) and the reserve, from its footprint', vd.length === 2 && vd.some((v) => v.role === 'hq') && vd.find((v) => v.role === 'res')?.y > 0, JSON.stringify(vd));
// the desert: reserves first, then HQs, then gun areas (DW s18 para 5 p 63); crossing sites highest (DW p 64)
const vdD = D.vpsOf(rec('bn-def-two-up'), doc, 'desert');
check('desert: a Bn defence\'s reserve is a first-priority VP (DW p 63); off the desert it stays third', vdD[0].role === 'res' && vdD[0].pri === 1 && vd.find((v) => v.role === 'res')?.pri === 3, JSON.stringify([vdD[0], vd]));
const vbD = D.vpsOf(rec('bde-cross-two-up'), doc, 'desert');
check('desert: on a crossing the bridge stays first priority (crossing sites highest, DW p 64)', vbD[0].role === 'bridge' && vbD[0].pri === 1, vbD.map((v) => `${v.role} ${v.pri}`).join());
const defD = D.withAd(rec('bn-def-two-up'), doc, D.adOnPlan(gm, doc, 'desert'));
const sdD = S.solveRecipe(defD, ctx, {});
const rD = row(D.adRows(sdD.items, defD), 'AD cover');
check('desert: the AD cover row judges the reserve as first priority and says why (DW p 63)', !!rD && /reserves first/.test(rD.reason) && defD.ad?.ground === 'desert', rD?.reason);
check('...a plan with no VP (a Pl ambush) gets none, and is left as it is', !D.vpsOf(rec('pl-ambush-l'), doc).length && D.withAd(rec('pl-ambush-l'), doc, aGm).id === 'pl-ambush-l');

// ── sited ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const bc = D.withAd(rec('bde-cross-two-up'), doc, aGm);
const adS = (r) => r.slots.filter((s) => /^ad\d+$/.test(s.role));
check('Bde crossing with a Lt AD (GM) Bty: id -ad, valid, three FUs (ad1-ad3), AD unit symbols named for their Tps', bc.id === 'bde-cross-two-up-ad' && !bad(bc).length && adS(bc).length === 3 && adS(bc).every((s) => s.sym === '10130100') && adS(bc)[0].label === 'Gun Tp', bad(bc).join('; '));
const br = rec('bde-cross-two-up').slots.find((s) => s.role === 'bridge');
const brC = [(br.shape.base[0][0] + br.shape.base[1][0]) / 2, (br.shape.base[0][1] + br.shape.base[1][1]) / 2];
const d1 = Math.hypot(adS(bc)[0].shape.at[0] - brC[0], adS(bc)[0].shape.at[1] - brC[1]);
check('...the first FU at the bridge, forward left, a quarter of 3.5 km (875 m) out', Math.abs(d1 - 875) < 2 && adS(bc)[0].shape.at[0] < brC[0] && adS(bc)[0].shape.at[1] < brC[1], `${Math.round(d1)} m at ${adS(bc)[0].shape.at}`);
const rb = D.adRows(S.solveRecipe(bc, ctx, {}).items, bc);
check('AD cover: a Bde is compact: the three FUs, sited at the bridge, HQ and Assy, each reach every VP 1.5 km out: pass', row(rb, 'AD cover')?.st === 'pass' && /the bridge: 3 FUs/.test(row(rb, 'AD cover').reason), row(rb, 'AD cover')?.st + ': ' + row(rb, 'AD cover')?.reason);
const bReg = D.withAd(rec('bde-cross-two-up'), doc, D.adOnPlan(reg, doc));
const rr = D.adRows(S.solveRecipe(bReg, ctx, {}).items, bReg);
check('...a Regt (9 FUs): the bridge has two or more, no VP left bare: pass', row(rr, 'AD cover')?.st === 'pass', row(rr, 'AD cover')?.reason);

// ── with the artillery: the gun areas are VPs too ────────────────────────────────────────────────────────────────────
const GR = (await import('../../MS/Engines/GunDeployment/GunDeploymentFind.ts')).gunRulesFrom(json('MS/Data/GunDoctrine.json'));
const ad = { defMinM: GR.front.def.minM.value, attkMinM: GR.front.attk.minM.value, defMaxFrac: GR.front.def.maxFrac.value, attkMaxFrac: GR.front.attk.maxFrac.value, regtM: [GR.areas.regt.frontM.value, GR.areas.regt.depthM.value], btyM: [GR.areas.bty.frontM.value, GR.areas.bty.depthM.value], room: [GR.room.okShare.value, GR.room.minShare.value], src: { band: 'b', area: 'a' } };
const fd = A.ownArtyTypes(orbat).find((t) => t.id === 'arty-regt-fd');
const atk = D.withAd(A.withArty(rec('bn-attk-frontal'), doc, A.artyOnPlan(fd, 'attack', ad)), doc, aGm);
const va = D.vpsOf(atk, doc);
check('Bn attack with a Fd Regt and an AD Bty: the gun area a first-priority VP, then the Bn HQ, the Assy and the reserve', va[0].role === 'gunArea' && va[1].role === 'hq' && va.length === 4 && atk.id === 'bn-attk-frontal-gun-ad' && !bad(atk).length, va.map((v) => v.role).join() + ' ' + bad(atk).join('; '));
const ra = D.adRows(S.solveRecipe(atk, ctx, {}).items, atk);
check('...AD cover reads the gun area', /the gun area/.test(row(ra, 'AD cover')?.reason ?? ''), row(ra, 'AD cover')?.reason);
const def = D.withAd(rec('bn-def-two-up'), doc, aGm), sd = S.solveRecipe(def, ctx, {});
check('Bn defence: three FUs round the reserve, solved and in the items; AD cover pass (the reserve is not first priority)', !bad(def).length && ['ad1', 'ad2', 'ad3'].every((r) => sd.items.some((i) => i.role === r && i.pts.length)) && row(D.adRows(sd.items, def), 'AD cover')?.st === 'pass', row(D.adRows(sd.items, def), 'AD cover')?.reason);
const divR = D.withAd(A.withArty(rec('div-bridgehead-two-bde'), doc, A.artyOnPlan(A.ownDivArties(orbat).find((x) => x.id === 'arty-inf-div-arty'), 'crossing', ad)), doc, D.adOnPlan(reg, doc));
const vdv = D.vpsOf(divR, doc);
check('Div bridgehead with the Inf Div Arty and a Regt: two bridges and four gun areas first, nine FUs', vdv.slice(0, 6).every((v) => v.pri === 1) && vdv.filter((v) => /^bridge/.test(v.role)).length === 2 && adS(divR).length === 9 && !bad(divR).length, vdv.map((v) => v.role).join());
check('...a Regt\'s nine FUs reach every VP of the Div bridgehead: pass; the bridges numbered', row(D.adRows(S.solveRecipe(divR, ctx, {}).items, divR), 'AD cover')?.st === 'pass' && /the bridge 1: \d FUs; the bridge 2/.test(row(D.adRows(S.solveRecipe(divR, ctx, {}).items, divR), 'AD cover').reason), row(D.adRows(S.solveRecipe(divR, ctx, {}).items, divR), 'AD cover')?.reason);
const thin = D.withAd(A.withArty(rec('div-bridgehead-two-bde'), doc, A.artyOnPlan(A.ownDivArties(orbat).find((x) => x.id === 'arty-inf-div-arty'), 'crossing', ad)), doc, D.adOnPlan(rcg, doc));
const rt = D.adRows(S.solveRecipe(thin, ctx, {}).items, thin);
check('...an RCG Bty (2 Tps, 35 mm 4 km) over the same 8 km front: one FU a bridge, gun areas bare: fail', row(rt, 'AD cover')?.st === 'fail' && /the gun area \(\d Fd Regt\): 0 FUs/.test(row(rt, 'AD cover').reason), row(rt, 'AD cover')?.reason);
check('no AD on the recipe: no row', !D.adRows(S.solveRecipe(rec('bde-cross-two-up'), ctx, {}).items, rec('bde-cross-two-up')).length);

// ── the mountains: AD on the defiles, gun areas and log installations, sited on dominating features (MW p 247) ─────────
{
  const mt = D.withAd(rec('bn-def-two-up'), doc, D.adOnPlan(gm, doc, 'mountain'));
  const sm = S.solveRecipe(mt, ctx, {});
  check('mountains: the AD cover row names MW p 247 (defiles on the main axis, gun areas, log installations)', /MW p 247/.test(row(D.adRows(sm.items, mt, 'mountain'), 'AD cover')?.reason ?? ''));
  const id = (p) => p;
  const fu = (r) => sm.items.find((i) => i.role === r).pts[0];
  const fu1 = fu('ad1'), oth = [fu('ad2'), fu('ad3')];
  // a small hill 300 m from the Gun Tp, on its side away from the other two (they stand on level ground)
  const mx = (oth[0].x + oth[1].x) / 2, my = (oth[0].y + oth[1].y) / 2, L = Math.hypot(fu1.x - mx, fu1.y - my) || 1;
  const P = { x: fu1.x + ((fu1.x - mx) / L) * 300, y: fu1.y + ((fu1.y - my) / L) * 300 };
  const hill = (x, y) => 200 + Math.max(0, 60 - Math.hypot(x - P.x, y - P.y) / 2.5);
  const r1 = row(D.adMountainRows(sm.items, mt, id, hill, doc), 'AD sites');
  check('...a hill 300 m from the Gun Tp: it is named, the other two on level ground count as on top: pass (2 of 3)', r1?.st === 'pass' && /2 of 3 fire units/.test(r1.reason) && /Gun Tp \d+ m below the height 300 m/.test(r1.reason) && oth.every((o) => Math.hypot(o.x - P.x, o.y - P.y) > 650), r1?.reason);
  // the ground rising toward the front everywhere: every site has higher ground 500 m ahead of it
  const r2 = row(D.adMountainRows(sm.items, mt, id, (x, y) => 200 + 0.1 * y, doc), 'AD sites');
  check('...the ground rising ahead of all three: warn, each named (50 m below the height 500 m ahead), with a fix', r2?.st === 'warn' && r2.detail?.items?.length === 3 && /50 m below the height 500 m ahead/.test(r2.detail.items[0]) && r2.detail.fix.length === 2, r2?.reason);
  check('...the heights not loaded: grey', row(D.adMountainRows(sm.items, mt, id, () => NaN, doc), 'AD sites')?.st === 'unchecked');
}

console.log(`\n${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
