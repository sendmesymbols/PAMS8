// mw.mjs -- checks what Mountain Warfare (GSP-1973, 2003) added on 27 Nov 2026 (MW_Review.md): the uphill assault timed
// on the slant distance with one hour for every 350 m of climb on the covering fire (Annex F pp 311-313), a third phase
// by recycled Coys warned in mountains (s17 pp 210-215), the recycling text, and the MW section numbers (s7 Attack, s8
// Strong Point, s12 Defence, s17 Recycling).
//   node tools/planbuilder-test/mw.mjs          (add --quiet to print only failures and the summary)
import { register } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const F = await import('../../MS/Engines/DeploymentBuilder/PlanFit.ts');
const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
const Ph = await import('../../MS/Engines/DeploymentBuilder/PlanPhase.ts');
const C = await import('../../MS/Engines/DeploymentBuilder/PlanContext.ts');
const A = await import('../../MS/Engines/DeploymentBuilder/PlanAttack.ts');

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const quiet = process.argv.includes('--quiet');
const read = (p) => readFileSync(resolve(repo, p), 'utf8');
const json = (p) => JSON.parse(read(p));
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
const rec = (id) => json(`MS/Data/Deployments/Recipes/${id}.json`);
const row = (rows, name) => rows.find((r) => r.name === name);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const centre = (pts) => ({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length });
const front = rec('bn-attk-frontal');

const inpOf = (recipe, g, more = {}) => ({ recipe, ctx, opts: {}, ground: g, anchor: { x: 0, y: 0 }, bearing: 0, threat: null, terrain: 'plains', ...more });
const flatG = { cls: () => 2, elev: () => 1500, going: goingOf, label: (c) => rules.classes[String(c)]?.label ?? String(c), sight: () => 0.9, pending: () => false, dataLine: () => 'synthetic',
  avenues: (from, to) => [{ path: [from, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, to], lengthM: Math.hypot(to.x - from.x, to.y - from.y), goPct: 100, minWidthM: 2000, chokes: [] }] };
const ref = F.fitLayout(inpOf(front, flatG));
const L = (w) => F.toLocal(ref.frame, w);
const O = centre(S.solveRecipe(front, ctx, {}).items.find((i) => i.role === 'obj').pts);
// the Obj on a hill 400 m above the ground round it (a broad dome); a valley the same depth for the downhill case
const dome = (sign) => ({ ...flatG, elev: (x, y) => 1500 + sign * 400 * Math.exp(-(dist(L({ x, y }), O) ** 2) / (2 * 700 ** 2)) });
const hill = dome(1), valley = dome(-1);
const assaultStep = (h) => h.steps.find((s) => /^Assault: SL to (the Obj|Obj 1)/.test(s.label));

// ── the uphill assault (MW Annex F pp 311-313) ────────────────────────────────────────────────────────────────────────
{
  const fl = F.fitLayout(inpOf(front, hill, { terrain: 'mountain' }));
  const h = fl.fit.attack?.hSum;
  const u = h?.uphill;
  check('mountains, the Obj on a hill: the H-hour sum carries the climb from the SL to the Obj', !!u && u.dh > 20 && u.deg > 0, JSON.stringify(u));
  check('...the slant factor is 1 / cos of the angle of slope (the book\'s table)', !!u && Math.abs(u.factor - 1 / Math.cos((u.deg * Math.PI) / 180)) < 0.03, u && `${u.factor} at ${u.deg}°`);
  check('...one hour for every 350 m of climb on the covering fire (para 3 c)', !!u && u.climbMin === Math.round((u.dh / 350) * 60), u && `${u.dh} m -> ${u.climbMin} min`);
  const st = h && assaultStep(h);
  check('...the assault step is labelled uphill, slant', !!st && /\(uphill \d+ m, slant\)/.test(st.label), st?.label);
  const want = st && Math.round((st.distM / 100) * h.paceMinPer100m + u.climbMin);
  check('...it takes the slant distance at the assault pace plus the climb', !!st && Math.abs(st.min - want) <= 2, st && `${st.min} min, ${st.distM} m slant at ${h.paceMinPer100m} min a 100 m + ${u.climbMin}: ${want}`);
  const liftsOk = h && h.lifts.length && h.lifts.every((l) => Math.abs(l.at - Math.round((Math.max(0, st.distM - l.rM) / 100) * h.paceMinPer100m + u.climbMin)) <= 2);
  check('...each fire lift at (slant - safe distance) / 100 x the rate + the climb (para 3 b, c); safe distances unchanged', !!liftsOk, h && h.lifts.map((l) => `${l.rM} m ${l.at}`).join(', '));
  const hs = row(fl.res.rows, 'H-hour sum');
  check('...the H-hour sum row names Annex F and the slant factor', /MW Annex F pp 311-313/.test(hs?.reason ?? '') && /slant x \d\.\d\d/.test(hs?.reason ?? ''), hs?.reason?.slice(-320));
  const plain = F.fitLayout(inpOf(front, hill, { terrain: 'plains' })).fit.attack?.hSum;
  check('the same hill on plains ground: no Annex F (it is the hilly-terrain programme)', plain && !plain.uphill && !/uphill/.test(assaultStep(plain)?.label ?? ''));
  const flat = F.fitLayout(inpOf(front, flatG, { terrain: 'mountain' })).fit.attack?.hSum;
  check('mountains on level ground: nothing added', flat && !flat.uphill);
  const down = F.fitLayout(inpOf(front, valley, { terrain: 'mountain' })).fit.attack?.hSum;
  check('mountains, the Obj in a hollow (downhill): nothing added (Annex F is for the uphill attack)', down && !down.uphill);
  const geo = A.attackTimes(S.solveRecipe(front, ctx, {}), null, null, doc, 'mountain', true, null);
  check('mountains without the terrain (geometry only): no climb invented', geo && !geo.uphill);
}

// ── phases 2 and 3 uphill, and a third phase by recycled Coys (MW s17 pp 210-215) ──────────────────────────────────────
{
  const t3 = Ph.threePhaseRecipe(Ph.twoPhaseRecipe(front, doc), doc);
  check('three phases (two Coys in Ph 2): A and B Coys take Obj 3', /from Obj 1/.test(t3.slots.find((s) => s.role === 'fu3')?.label ?? ''));
  const flm = F.fitLayout(inpOf(t3, flatG, { terrain: 'mountain' }));
  const r3 = row(flm.res.rows, 'Ph 3 timing');
  check('mountains: Ph 3 by recycled Coys warns, citing MW s17 para 3 c p 210 (72-96 h) and the doubled timings', r3?.st === 'warn' && /MW s17 para 3 c p 210/.test(r3.reason) && /72-96 h/.test(r3.reason) && /doubled/.test(r3.reason), r3?.reason);
  check('...with a Why and a Fix (D Coy for Ph 3, a separate attack 72-96 h later, a lighter Obj 1)', r3?.detail && r3.detail.fix.length >= 3 && /80 %/.test(r3.detail.why), JSON.stringify(r3?.detail?.fix));
  check('...the H-hour sum marks the phase recycled and on mountain ground', flm.fit.attack.hSum.phase3?.recycled === true && flm.fit.attack.hSum.phase3?.mountain === true);
  const flp = F.fitLayout(inpOf(t3, flatG, { terrain: 'plains' }));
  const r3p = row(flp.res.rows, 'Ph 3 timing');
  check('plains: the same plan carries no MW recycling warn (IBB p 189: each Obj a firm base)', r3p && !/MW s17/.test(r3p.reason) && !r3p.detail?.head?.includes('recycled'), r3p?.reason);
  const t3d = Ph.threePhaseRecipe(Ph.twoPhaseRecipe(front, doc, undefined, 1), doc);
  const fld = F.fitLayout(inpOf(t3d, flatG, { terrain: 'mountain' }));
  const r3d = row(fld.res.rows, 'Ph 3 timing');
  check('mountains with D Coy (the reserve) for Ph 3: not recycled, no MW recycling warn', r3d && !/recycled the same night/.test(r3d.reason) && !r3d.detail && fld.fit.attack.hSum.phase3?.recycled === false, r3d?.reason);
  const flh = F.fitLayout(inpOf(t3, hill, { terrain: 'mountain' }));
  const hh = flh.fit.attack.hSum;
  check('mountains, two phases on the hill: phase 1 uphill timed; later phases add a climb only where they climb', !!hh.uphill && (hh.phase2?.uphill ? hh.phase2.uphill.climbMin === Math.round((hh.phase2.uphill.dh / 350) * 60) : true), JSON.stringify({ p1: hh.uphill, p2: hh.phase2?.uphill, p3: hh.phase3?.uphill }));
  // the ground note on the phase timing rows (PlanContext.groundNotes)
  const notes = C.groundNotes([{ name: 'Ph 2 timing', st: 'pass', reason: 'x' }], doc, 'mountain', 'attack', '16', true);
  check('the mountain note on Ph 2 timing: recycled within 48 h could not deliver, 72-96 h for planning, 48-72 h rest if to another sector (MW pp 210, 215)', /72-96 h after their attack/.test(notes[0].reason) && /para 6 e p 215/.test(notes[0].reason) && !/not recycled before 48-72 h/.test(notes[0].reason), notes[0].reason);
}

// ── strong points and the Obj on the elevation (MW s12 para 9 p 152; s7 para 3 p 78) ──────────────────────────────────
{
  const M = await import('../../MS/Engines/DeploymentBuilder/PlanMountain.ts');
  const sq = (cx, cy, h) => [{ x: cx - h, y: cy - h }, { x: cx + h, y: cy - h }, { x: cx + h, y: cy + h }, { x: cx - h, y: cy + h }];
  const domeAt = (cx, cy, top, s = 150) => (p) => 1500 + top * Math.exp(-((p.x - cx) ** 2 + (p.y - cy) ** 2) / (2 * s * s));
  const r1 = M.readFeature(sq(0, 0, 300), [], domeAt(100, 50, 80), 600, 10);
  check('readFeature: the top of a posn is its knoll (the Pl SP site), nothing higher round it', r1 && Math.hypot(r1.top.x - 100, r1.top.y - 50) < 40 && !r1.over && Math.round(r1.topM) >= 1575, JSON.stringify(r1 && { top: r1.top, m: r1.topM }));
  const two = (p) => Math.max(domeAt(0, 0, 60)(p), domeAt(0, 700, 120)(p));
  const r2 = M.readFeature(sq(0, 0, 250), [], two, 600, 10);
  check('...a higher hill 700 m off, its slope within 600 m: overlooked, the higher ground named with its distance', r2?.over && r2.over.m > r2.topM + 10 && r2.over.dM <= 600, JSON.stringify(r2?.over));
  const r3 = M.readFeature(sq(0, 0, 250), [sq(0, 700, 400)], two, 600, 10);
  check('...the same hill inside another own posn: not counted as overlooking', r3 && !r3.over, JSON.stringify(r3?.over));
  check('...no elevation: no reading (never invented)', M.readFeature(sq(0, 0, 250), [], () => NaN, 600, 10) === null);

  const def = rec('bn-def-mtn-ridge');
  const geo = row(M.layoutRows(S.solveRecipe(def, ctx, {}).items, def, doc), 'Strong points');
  check('ridge defence, geometry only: Strong points unchecked, the rule cited (MW s12 para 9 p 152)', geo?.st === 'unchecked' && /MW s12 para 9 p 152/.test(geo.reason), geo?.reason);
  const refD = F.fitLayout(inpOf(def, flatG, { terrain: 'mountain' }));
  const LD = (w) => F.toLocal(refD.frame, w);
  const flatRow = row(refD.res.rows, 'Strong points');
  check('ridge defence on level ground: each Coy\'s Pl SP read, nothing higher round it: pass', flatRow?.st === 'pass' && /A Coy: level ground about 1500 m, no top to choose/.test(flatRow.reason) && /nothing higher within 600 m/.test(flatRow.reason), flatRow?.reason);
  // the ground rising toward the En, 1 m in 10: every Coy's top is its forward edge, and the ground ahead stands higher
  const rising = { ...flatG, elev: (x, y) => 1500 + 0.1 * LD({ x, y }).y };
  const up = F.fitLayout(inpOf(def, rising, { terrain: 'mountain' }));
  const upRow = row(up.res.rows, 'Strong points');
  check('ridge defence with the ground rising toward the En: overlooked toward the En, warns with a Why and a Fix', upRow?.st === 'warn' && /overlooked by \d+ m .* toward the En/.test(upRow.reason) && upRow.detail?.fix?.length === 3 && /most dominating feature/.test(upRow.detail.why), upRow?.reason?.slice(0, 260));

  const atk = rec('bn-attk-mtn');
  const refA = F.fitLayout(inpOf(atk, flatG, { terrain: 'mountain' }));
  const LA = (w) => F.toLocal(refA.frame, w);
  const objC = centre(refA.raw.items.find((i) => i.role === 'obj').pts);
  const onHill = { ...flatG, elev: (x, y) => { const l = LA({ x, y }); return 1500 + 250 * Math.exp(-(dist(l, objC) ** 2) / (2 * 400 ** 2)); } };
  const oA = row(F.fitLayout(inpOf(atk, onHill, { terrain: 'mountain' })).res.rows, 'Objective');
  check('mountain attack, the Obj on its hill: Objective passes (MW s7 para 3 p 78)', oA?.st === 'pass' && /nothing higher within 600 m/.test(oA.reason), oA?.reason);
  const under = { ...flatG, elev: (x, y) => { const l = LA({ x, y }); return onHill.elev(x, y) + 300 * Math.exp(-(dist(l, { x: objC.x, y: objC.y + 900 }) ** 2) / (2 * 300 ** 2)); } };
  const oB = row(F.fitLayout(inpOf(atk, under, { terrain: 'mountain' })).res.rows, 'Objective');
  check('...a higher hill just beyond the Obj: Objective warns, the higher ground the Obj or taken first', oB?.st === 'warn' && /overlooked by/.test(oB.reason) && oB.detail?.fix?.length === 3, oB?.reason);
  const sp = doc.plan.mountain.strongPoint;
  check('PlanDoctrine mountain.strongPoint: MW p 152 / p 176 refs, overlookM 600 E (decided, searched), overlookTolM 10 M', sp?.refs?.some((r) => r.page === '152') && sp.refs.some((r) => r.page === '176') && sp.overlookM?.value === 600 && sp.overlookM.basis === 'E' && sp.overlookM.decided && sp.overlookM.searched && sp.overlookTolM?.basis === 'M');
}

// ── weapon angles onto the approach (MW s18 pp 221-225) ─────────────────────────────────────────────────────────────
{
  const def = rec('bn-def-two-up');
  const withElev = (elev) => ({ ...flatG, elev });
  const angRow = (elev) => row(F.fitLayout(inpOf(def, withElev(elev), { terrain: 'mountain', threat: { x: 0, y: 8000 } })).res.rows, 'Weapon angles');
  const steep = angRow((x, y) => 1500 + 0.3 * Math.max(0, 4000 - y)); // the ground falls 3 in 10 toward the En: ~17 deg down
  check('mountains, posns on a height 17° above the approach: Weapon angles warns, beyond the MG\'s 8.5° and the RR\'s 5° depression (MW p 221)', steep?.st === 'warn' && /beyond the MG's 8.5° and the RR's 5° depression/.test(steep.reason) && /MW s18 p 221/.test(steep.reason), steep?.reason?.slice(0, 300));
  check('...its Fix: RRs in the foothills on the lower spurs (p 225), shoulder fire within 400 m (p 223), range cards with the angle', steep?.detail?.fix?.some((x) => /foothills/.test(x) && /p 225/.test(x)) && steep.detail.fix.some((x) => /400 m/.test(x)) && steep.detail.fix.some((x) => /Range cards/.test(x)), JSON.stringify(steep?.detail?.fix));
  const mid = angRow((x, y) => 1500 + 0.08 * Math.max(0, 4000 - y)); // ~6-7 deg down: past the RR, within the MG
  check('...about 7° down: past the RR\'s 5° only (its dead arc), the MG can still depress', mid?.st === 'warn' && /beyond the RR's 5° depression \(its dead arc\)/.test(mid.reason) && !/MG's 8.5°/.test(mid.reason.split(':')[0]), mid?.reason?.slice(0, 260));
  const gentle = angRow((x, y) => 1500 + 0.04 * Math.max(0, 4000 - y)); // ~2 deg
  check('...about 2° down: within the weapons\' angles, passes', gentle?.st === 'pass' && /within the weapons' angles/.test(gentle.reason), gentle?.reason?.slice(0, 200));
  const upHill = angRow((x, y) => 1500 + 0.2 * Math.max(0, y)); // the approach above the posns: ~11 deg up
  check('...the approach 11° above the posns: beyond the MG\'s 6° elevation on its mount (within the RR\'s 30°)', upHill?.st === 'warn' && /beyond the MG's 6° elevation on its mount/.test(upHill.reason), upHill?.reason?.slice(0, 260));
  const plains = row(F.fitLayout(inpOf(def, withElev((x, y) => 1500 + 0.3 * Math.max(0, 4000 - y)), { terrain: 'plains', threat: { x: 0, y: 8000 } })).res.rows, 'Weapon angles');
  check('plains ground: no Weapon angles row (the mountain book\'s rule)', !plains);
  const wa = doc.plan.terrain.kinds.mountain.weaponAngles;
  check('PlanDoctrine weaponAngles: 6 / 8.5 / 30 / 5 deg, basis D, MW p 221', wa?.mgElevateDeg === 6 && wa.mgDepressDeg === 8.5 && wa.rrElevateDeg === 30 && wa.rrDepressDeg === 5 && wa.basis === 'D' && wa.refs.some((r) => r.page === '221'));
}

// ── the strong point drill (MW s8 pp 101-121) ─────────────────────────────────────────────────────────────────────────
{
  const night = C.groundNotes([], doc, 'mountain', 'attack', '16', true);
  const dr = row(night, 'Strong point drill');
  check('a mountain attack by night: Strong point drill (unchecked: confirm it), the path-marking group, two wire lanes a Pl, the fire shifts and the RL signal', dr?.st === 'unchecked' && /path-marking group \(1 Aslt Engr NCO, 1 Aslt Engr Sepoy, 3 riflemen\)/.test(dr.reason) && /two lanes a Pl/.test(dr.reason) && /shift to the depth targets/.test(dr.reason) && /RL shot/.test(dr.reason) && /nullah beds/.test(dr.reason), dr?.reason?.slice(0, 200));
  const day = row(C.groundNotes([], doc, 'mountain', 'attack', '16', false), 'Strong point drill');
  check('...by day: warns (almost all SP attacks by night, MW s8 p 103), soften on a broad front (p 116)', day?.st === 'warn' && /MW s8 p 103/.test(day.reason) && /broad front/.test(day.reason) && day.detail?.fix?.length === 2);
  check('...not on the plains, not in a defence', !row(C.groundNotes([], doc, 'plains', 'attack', '16', true), 'Strong point drill') && !row(C.groundNotes([], doc, 'mountain', 'defence', '16', null), 'Strong point drill'));
  const fl = F.fitLayout(inpOf(front, flatG, { terrain: 'mountain' }));
  check('a fitted Bn attack on mountain ground carries the Strong point drill row', !!row(fl.res.rows, 'Strong point drill'));
  const A2 = await import('../../MS/Engines/DeploymentBuilder/PlanAttack.ts');
  const br = A2.attackBreach({ ...front, enMfAtk: { depthM: 125, lanes: 2 } }, doc, true, undefined, 'mountain');
  check('the mountain Breach row names the path-marking group and adds no lane time (none printed)', br?.h === 0 && /path-marking group/.test(br.row.reason) && /no time/.test(br.row.reason), br?.row?.reason);
  const sd = doc.plan.terrain.kinds.mountain.spDrill;
  check('PlanDoctrine spDrill: MW pp 103, 105, 106, 113, 117, 119 refs, basis D', sd?.basis === 'D' && ['103', '105', '106', '113', '117', '119'].every((p) => sd.refs.some((r) => r.page === p)));
}

// ── AD on the defiles (MW p 247), mines in the mountains (MW pp 149-150, 171, 195), the mountain Div (GSP p 122) ─────────
{
  const AD = await import('../../MS/Engines/DeploymentBuilder/PlanAD.ts');
  const ad = { name: 'AD Bty', unit: 'bty', releaseM: 1000, minFus: 2, fus: [{ name: 'FU 1', effM: 4000, weapons: [{ name: 'RBS-70', effM: 4000 }] }], siteM: [500, 1500] };
  const items = [{ role: 'ad1', pts: [{ x: 0, y: 0 }] }];
  const two = AD.adDefileRows(items, { ad }, [{ at: { x: 1500, y: 0 }, widthM: 300, label: 'Narrows 1' }, { at: { x: 9000, y: 0 }, widthM: 250, label: 'Narrows 2' }]);
  check('AD on defiles: a defile beyond every FU\'s reach warns (MW s22 para 7 p 247), its Fix a FU on a dominating feature over it', two[0]?.st === 'warn' && /Narrows 2, 250 m wide: 0 FUs/.test(two[0].reason) && /MW s22 para 7 p 247/.test(two[0].reason) && two[0].detail?.fix?.length === 3, two[0]?.reason);
  const one = AD.adDefileRows(items, { ad }, [{ at: { x: 1500, y: 0 }, widthM: 300, label: 'Narrows 1' }]);
  check('...each defile under a FU: passes; no AD or no defile: no row', one[0]?.st === 'pass' && !AD.adDefileRows(items, {}, [{ at: { x: 0, y: 0 }, widthM: 1 }]).length && !AD.adDefileRows(items, { ad }, []).length, one[0]?.reason);

  const mines = { name: 'Mines in time', st: 'pass', reason: 'protective minefield along 4.5 km of front, about 4,500 mixed clusters: the Engr Coy ...' };
  const mn = row(C.groundNotes([mines], doc, 'mountain', 'defence', '16', null), 'Mines in time');
  check('Mines in time in the mountains: the Pioneer Pl\'s clusters an hour by light (MW p 195), the hours for the plan\'s clusters, washed away on slopes (p 149), thickest in the valleys (p 150), wire on rocky slopes (p 171)', /65 mixed clusters an hour by day, 44 by moonlight, 33 on a dark night \(MW p 195\)/.test(mn.reason) && /about 69 \/ 102 \/ 136 h of laying/.test(mn.reason) && /p 149/.test(mn.reason) && /p 150/.test(mn.reason) && /p 171/.test(mn.reason) && mn.st === 'pass', mn.reason.slice(-420));
  check('...not on the plains', !/MW p 195/.test(row(C.groundNotes([{ ...mines }], doc, 'plains', 'defence', '16', null), 'Mines in time').reason));
  check('PlanDoctrine pioneerClustersPerH: mixed 65 / 44 / 33, AT 130 / 88 / 65 (MW p 195, D)', JSON.stringify(doc.plan.terrain.kinds.mountain.pioneerClustersPerH?.mixed) === '[65,44,33]' && JSON.stringify(doc.plan.terrain.kinds.mountain.pioneerClustersPerH?.at) === '[130,88,65]' && doc.plan.terrain.kinds.mountain.pioneerClustersPerH.basis === 'D');

  const V = await import('../../MS/Engines/DeploymentBuilder/PlanRecipes.ts');
  const M = await import('../../MS/Engines/DeploymentBuilder/PlanMountain.ts');
  const dv = rec('div-def-mtn-valleys');
  const issues = V.validateRecipe(dv, { doc, symbols: ctx.symbols, file: 'div-def-mtn-valleys.json' }).filter((i) => i.level === 'fail');
  check('div-def-mtn-valleys: a valid recipe in the Div Def (Mtn) family, layout valleys', !issues.length && dv.family === 'div-def-mtn' && dv.layout === 'valleys' && json('MS/Data/Deployments/Recipes/index.json').families.some((f) => f.id === 'div-def-mtn' && f.recipes.includes('div-def-mtn-valleys')), issues.map((i) => i.msg).join('; '));
  const dres = S.solveRecipe(dv, ctx, {});
  const drows = M.layoutRows(dres.items, dv, doc);
  check('...as laid: Reserves split passes (a group behind each forward Bde, GSP s27 para 4 p 122; MW s12 p 169)', row(drows, 'Reserves split')?.st === 'pass' && /GSP 1947 Inf Div in Battle s27 para 4 p 122/.test(row(drows, 'Reserves split').reason), row(drows, 'Reserves split')?.reason);
  check('...Launch at once passes (GSP s39 para 11 p 176); Security zone unchecked (none along the LoC, MW s12 p 164)', row(drows, 'Launch at once')?.st === 'pass' && row(drows, 'Security zone')?.st === 'unchecked' && /MW s12 p 164/.test(row(drows, 'Security zone').reason), row(drows, 'Launch at once')?.reason);
  check('...no Armd Regt, no SZ and no mounted reserve in the mountain Div (armour road-bound, MW p 238)', !dv.slots.some((s) => ['armrRes', 'sz', 'ctpsL', 'ctpsR'].includes(s.role)) && !dv.slots.some((s) => s.mounted));
  const rrs = row(dres.rows, 'Reserve reach');
  check('...Reserve reach times each reserve group to its own Bde (reach.slots), the slowest judged: passes', rrs?.st === 'pass' && /the reserve split 2 ways/.test(rrs.reason) && /to its own/.test(rrs.reason), rrs?.reason);
  const one2 = JSON.parse(JSON.stringify(dv)); one2.slots = one2.slots.filter((s) => s.role !== 'resR');
  const r1 = row(M.layoutRows(S.solveRecipe(one2, ctx, {}).items, one2, doc), 'Reserves split');
  check('...with the reserve in one place: Reserves split warns, its Fix a group behind each Bde', r1?.st === 'warn' && r1.detail?.fix?.length === 2, r1?.reason);
  const rr = row(C.groundNotes([{ name: 'Reserve reach', st: 'pass', reason: 'x' }], doc, 'mountain', 'defence', '21', null), 'Reserve reach');
  check('a Div defence on mountain ground: Reserve reach names the split reserves (GSP p 122, p 176)', /GSP 1947 Inf Div in Battle s27 para 4 p 122/.test(rr.reason) && /s39 para 11 p 176/.test(rr.reason), rr.reason.slice(-260));
  check('...a Bn defence does not get the Div note', !/s27 para 4 p 122/.test(row(C.groundNotes([{ name: 'Reserve reach', st: 'pass', reason: 'x' }], doc, 'mountain', 'defence', '16', null), 'Reserve reach').reason));
}

// ── the doctrine: Annex F figures, backed ─────────────────────────────────────────────────────────────────────────────
{
  const m = doc.plan.terrain.kinds.mountain;
  check('PlanDoctrine uphillCoverMinPer350m: 60 min, basis D, MW p 313', m.uphillCoverMinPer350m?.value === 60 && m.uphillCoverMinPer350m.basis === 'D' && m.uphillCoverMinPer350m.refs.some((r) => r.book === 'MW' && r.page === '313'));
  const sf = m.slantFactor?.value ?? {};
  check('PlanDoctrine slantFactor: the book\'s table, every row 1 / cos of its angle within 0.01', Object.keys(sf).length === 9 && Object.entries(sf).every(([deg, f]) => Math.abs(f - 1 / Math.cos((Number(deg) * Math.PI) / 180)) < 0.011), JSON.stringify(sf));
}

// ── the MW section numbers (s7 Attack, s8 Strong Point, s12 Defence; s1 is the Introduction, s2 the Environment) ─────
{
  const files = ['MS/Engines/DeploymentBuilder/PlanMountain.ts', 'MS/Data/PlanDoctrine.json', ...readdirSync(resolve(repo, 'MS/Data/Deployments/Recipes')).filter((f) => /mtn/.test(f)).map((f) => `MS/Data/Deployments/Recipes/${f}`)];
  const bad = files.filter((f) => /MW s[12] /.test(read(f)));
  check('no "MW s1" / "MW s2" for the attack or the defence in PlanMountain, PlanDoctrine and the mountain recipes', !bad.length, bad.join(', '));
  check('PlanMountain names the book GSP-1973 (2003), not "GSP 2016"', !/GSP 2016/.test(read('MS/Engines/DeploymentBuilder/PlanMountain.ts')));
  const ctxSrc = read('MS/Engines/DeploymentBuilder/PlanContext.ts');
  check('PlanContext: the central reserve "from Bn level upward" (MW p 169 "upwards of battalion level")', /from Bn level upward/.test(ctxSrc) && !/above Bn level not from one central/.test(ctxSrc));
}

console.log(`\n${n - fails} of ${n} checks passed${fails ? `, ${fails} FAILED` : ''}`);
process.exit(fails ? 1 : 0);
