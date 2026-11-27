// dw.mjs -- checks what Desert Warfare (GSP-1972, 2002) added to the Intelligent Deployment on 27 Nov 2026 (DW_Review.md):
// a Bde / Div reserve on foot in the desert (DW pp 23, 26-27), the minefield by MML only on the dhars and the breach by
// hand, the TAMs not counted (p 65), loose sand no gun ground for towed guns (p 60), the desert withdrawal's walk to the
// vehicles (pp 32-33), and the desert notes on the attack, the gaps and the AT cover (pp 23, 38-46, 58).
//   node tools/planbuilder-test/dw.mjs          (add --quiet to print only failures and the summary)
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
const C = await import('../../MS/Engines/DeploymentBuilder/PlanContext.ts');
const O = await import('../../MS/Engines/DeploymentBuilder/PlanOrbat.ts');
const E = await import('../../MS/Engines/DeploymentBuilder/PlanEngr.ts');
const AT = await import('../../MS/Engines/DeploymentBuilder/PlanAttack.ts');
const A = await import('../../MS/Engines/DeploymentBuilder/PlanArty.ts');
const F = await import('../../MS/Engines/DeploymentBuilder/PlanFit.ts');
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
const rec = (id) => json(`MS/Data/Deployments/Recipes/${id}.json`);
const row = (rows, name) => rows.find((r) => r.name === name);
const rules = json('MS/Data/terrain-bundle/rules.json');
const goingOf = (p) => ({ nogo: new Set(rules.profiles[p].nogo), caution: new Set(rules.profiles[p].caution ?? []) });
const P = 'MS/Data/Orbat/PK/';
const orbat = { own: O.mergeOwn(O.OWN_ORBAT_FILES.map((f) => json(`${P}${f}`).units)), en: json(`${P}en.json`).units, weapons: json(`${P}weapons.json`).weapons, engrData: json(`${P}engr.json`).engrData };

// ── the doctrine: every desert rule cited, verify.py-checked ─────────────────────────────────────────────────────────
{
  const d = doc.plan.terrain.kinds.desert;
  const R = d.rules ?? {};
  const keys = ['mechReserves', 'minesOnSand', 'towedGunsOnSand', 'atgmConcentrated', 'gapsAndLesserApproaches', 'attack', 'withdrawal'];
  check('PlanDoctrine terrain.kinds.desert.rules: seven rules, each D with DW refs found on their pages (verify.py --write)', keys.every((k) => R[k]?.basis === 'D' && R[k].refs?.length && R[k].refs.every((r) => r.book === 'DW' && r.checked?.status === 'ok')), keys.filter((k) => !(R[k]?.refs ?? []).every((r) => r.checked?.status === 'ok')).join(' '));
  check('the desert kind cites the all-round layout on p 27 (concentric circles), the open flanks p 13, the gaps p 22 (R145)', ['27', '13', '22'].every((p) => d.refs.some((r) => r.page === p && r.role === 'rule' && r.checked?.status === 'ok')) && !d.refs.some((r) => /2 -- 6 hours/.test(r.quote)), d.refs.map((r) => `${r.page}:${r.quote}`).join(' | '));
  const w = doc.plan.withdrawal.desertWalkMaxM;
  check('withdrawal.desertWalkMaxM 457 m: E, decided and searched, DW p 32 the rule, IBB p 381 the Coy RV as context', w?.value === 457 && w.basis === 'E' && w.decided && /DW s9/.test(w.searched) && w.refs.some((r) => r.book === 'DW' && r.page === '32' && r.checked?.status === 'ok'));
  const gd = json('MS/Data/GunDoctrine.json').desert.note;
  check('GunDoctrine desert note: successive gun positions only "when a withdrawal is anticipated" (R146), towed guns in loose sand', /when a withdrawal is anticipated \(p 60\)/.test(gd) && /towed guns hard to move in loose sand/.test(gd), gd);
  const ipb = json('MS/Data/IpbDoctrine.json').decisionPoints.reserves;
  check('IpbDoctrine decisionPoints.reserves: DW p 27 named the own reserves, not the En\'s (the En ladder IDD / GSP)', /Own Div and Bde reserves in the desert/.test(ipb.text) && /not the En's/.test(ipb.text) && ipb.indian?.ladder?.length === 4);
}

// ── reserves: mechanised down to Bde, mainly armour; counter-penetration less preferred (DW pp 23, 26-27) ────────────
{
  const bde = S.solveRecipe(rec('bde-def-two-up'), ctx, {});
  const rr = row(bde.rows, 'Reserve reach');
  check('Bde Def two up: the reserve Bn timed on foot and passing in the plains', rr?.st === 'pass' && /on foot/.test(rr.reason), rr?.reason);
  const plains = row(C.groundNotes(bde.rows, doc, 'plains', 'defence', '18', null), 'Reserve reach');
  check('...the plains leave it a pass', plains.st === 'pass' && !/DW p 23/.test(plains.reason));
  const des = row(C.groundNotes(bde.rows, doc, 'desert', 'defence', '18', null), 'Reserve reach');
  check('...in the desert it warns: mechanised reserves down to Bde, mainly armour (DW p 23 para 5 c, p 26 para 10 b), with a why and fixes', des.st === 'warn' && /DW p 23 para 5 c, p 26 para 10 b/.test(des.reason) && /mainly armour/.test(des.detail?.why ?? '') && des.detail.fix.length === 2, des.reason);
  check('...and says the counter-penetration mode is less preferred (DW p 27 para 10 h)', /counter-penetration mode is less preferred, though not ruled out \(DW p 27 para 10 h\)/.test(des.reason));
  const div = S.solveRecipe(rec('div-def-two-up'), ctx, {});
  const dd = row(C.groundNotes(div.rows, doc, 'desert', 'defence', '21', null), 'Reserve reach');
  check('Div Def two up in the desert: the mounted Div reserve still passes, with the C Pen note', dd.st === 'pass' && /mounted/.test(dd.reason) && /DW p 27 para 10 h/.test(dd.reason), dd.reason);
  const bn = S.solveRecipe(rec('bn-def-two-up'), ctx, {});
  const bnR = row(C.groundNotes(bn.rows, doc, 'desert', 'defence', '16', null), 'Reserve reach');
  check('a Bn\'s Coy reserve on foot in the desert is not judged by it (mechanised reserves "down to the brigade level")', bnR.st === row(bn.rows, 'Reserve reach').st && !/DW p 23 para 5 c/.test(bnR.reason), bnR.reason);
}

// ── the minefield: MML on the dhars, by hand on soft sand (DW p 65) ──────────────────────────────────────────────────
{
  const ts = E.ownEngrTypes(orbat), T = (id) => ts.find((t) => t.id === id);
  const std = O.brief(orbat, 'inf-bn-std');
  const wide = O.minefieldRow(orbat, doc, 12000, std, T('engr-bn-def-inf-div-corps'));
  check('Mines in time carries the hours by hand (m) and the hours to be ready (limitM) for the ground to judge', Number.isFinite(wide.m) && wide.limitM === 36, `${wide.m} / ${wide.limitM}`);
  check('...12 km with the Def Engr Bn: by hand beyond the 36 h, the MMLs make it good: a pass off the desert', wide.st === 'pass' && wide.m > wide.limitM, wide.reason);
  const dW = row(C.groundNotes([wide], doc, 'desert', 'defence', '16', null), 'Mines in time');
  check('...in the desert it warns: the MMLs lay only on the dhars (DW p 65), the time by hand said', dW.st === 'warn' && new RegExp(`about ${Math.round(wide.m)} h against the 36 h`).test(dW.reason) && /MML on sand/.test(dW.detail.head), dW.reason);
  const pW = row(C.groundNotes([wide], doc, 'plains', 'defence', '16', null), 'Mines in time');
  check('...in the plains it stays a pass', pW.st === 'pass');
  const short = O.minefieldRow(orbat, doc, 3500, std, T('engr-bn-def-inf-div-corps'));
  const dS = row(C.groundNotes([short], doc, 'desert', 'defence', '16', null), 'Mines in time');
  check('3.5 km with the Def Engr Bn: by hand inside the time, a pass in the desert too (with the DW p 65 note)', short.m <= short.limitM && dS.st === 'pass' && /DW p 65/.test(dS.reason), `${short.m} h`);
}

// ── the breach: by hand, the TAMs not counted on soft sand (DW p 65) ─────────────────────────────────────────────────
{
  const ts = E.ownEngrTypes(orbat), T = (id) => ts.find((t) => t.id === id);
  const kinds = E.bridgeKinds(orbat.engrData);
  const mf = AT.withAttackMinefield(rec('bn-attk-frontal'), doc);
  const withE = (r, id) => ({ ...r, engr: { ...T(id), kinds } });
  const pl = AT.attackBreach(withE(mf, 'engr-bn-aslt'), doc, true, orbat.engrData, 'plains');
  const de = AT.attackBreach(withE(mf, 'engr-bn-aslt'), doc, true, orbat.engrData, 'desert');
  check('the Aslt Engr Bn in the plains: its TAMs, under an hour', pl.h < 1 && /TAMs/.test(pl.by + pl.row.reason), pl.row.reason);
  check('...in the desert: timed by hand (Annex Q), its TAMs not counted, DW p 65 said', de.h >= 6 && /by hand/.test(de.by) && /TAMs? not counted: in the desert TAMs may work on the dhars but are likely to fail on soft sand \(DW p 65\)/.test(de.row.reason), `${de.h} h ${de.row.reason}`);
  const h = AT.attackTimes(S.solveRecipe(withE(mf, 'engr-bn-aslt'), ctx, {}), null, null, doc, 'desert', true, null);
  const st = h.steps.find((s) => /Engineers begin the lanes/.test(s.label));
  check('...the H-hour sum in the desert begins the lanes by hand, hours before H, not the TAMs\' minutes', st && st.at <= -360 && /by hand/.test(st.label), st ? `${st.label} ${st.at}` : 'none');
}

// ── the gun area: loose sand for towed guns (DW p 60) ────────────────────────────────────────────────────────────────
{
  const GR = G.gunRulesFrom(json('MS/Data/GunDoctrine.json'));
  const ad = {
    defMinM: GR.front.def.minM.value, attkMinM: GR.front.attk.minM.value, defMaxFrac: GR.front.def.maxFrac.value, attkMaxFrac: GR.front.attk.maxFrac.value,
    regtM: [GR.areas.regt.frontM.value, GR.areas.regt.depthM.value], btyM: [GR.areas.bty.frontM.value, GR.areas.bty.depthM.value],
    room: [GR.room.okShare.value, GR.room.minShare.value], src: { band: 'GunDoctrine front', area: 'GunDoctrine areas' },
  };
  const types = A.ownArtyTypes(orbat), T_ = (id) => types.find((t) => t.id === id);
  const sand = Number(Object.keys(rules.classes).find((k) => rules.classes[k].name === 'sand'));
  check('the bundle\'s Sand class is a caution for the Gun Position going, not a NO-GO (SP guns take it)', goingOf('gun').caution.has(sand) && !goingOf('gun').nogo.has(sand) && rules.classes[String(sand)].label === 'Sand');
  const g = (cls) => ({ cls, elev: () => 200, going: goingOf, label: (c) => rules.classes[String(c)]?.label ?? String(c), sight: () => 0.1, pending: () => false, dataLine: () => 'synthetic',
    avenues: () => [0, 3600].map((x) => { const path = []; for (let y = 8000; y >= -500; y -= 100) path.push({ x: x - (x * Math.max(0, 2000 - y)) / 2500, y }); return { path, lengthM: 8500, goPct: 100, minWidthM: 2000, chokes: [] }; }) });
  const mech = { echelon: '18', type: 'mech', source: 'user' };
  const fit = (arty, cls, terrain = 'desert') => F.fitLayout({ recipe: A.withArty(rec('bn-def-two-up'), doc, A.artyOnPlan(arty, 'defence', ad)), ctx, opts: { alternates: 'visible' }, ground: g(cls), anchor: { x: 0, y: 0 }, bearing: 0, threat: { x: 0, y: 8000 }, enemy: mech, terrain });
  const towed = row(fit(T_('arty-regt-fd'), () => sand).res.rows, 'Gun area');
  check('a towed Fd Regt on loose sand: none of it gun ground, fail, DW p 60 said', towed?.st === 'fail' && /0 % of it/.test(towed.reason) && /100 % loose sand, not counted: towed guns are hard to move in loose sand, SP guns are ideal there \(DW p 60\)/.test(towed.reason), towed?.reason);
  const sp = row(fit(T_('arty-regt-med-sp'), () => sand).res.rows, 'Gun area');
  check('the Med Regt (SP) on the same sand: 100 %, a pass, "taken by SP guns"', sp?.st === 'pass' && /100 % of it/.test(sp.reason) && /taken by SP guns \(DW p 60\)/.test(sp.reason), sp?.reason);
  const firm = row(fit(T_('arty-regt-fd'), () => 12).res.rows, 'Gun area');
  check('the towed Fd Regt on bare desert (the dhars, firm): a pass, no sand named', firm?.st === 'pass' && !/loose sand/.test(firm.reason), firm?.reason);
  const plainsSand = row(fit(T_('arty-regt-fd'), () => sand, 'plains').res.rows, 'Gun area');
  check('loose sand is loose sand on any ground (a river bed in the plains): the towed Regt fails there too', plainsSand?.st === 'fail');
}

// ── the desert withdrawal (DW s9 pp 32-33) ───────────────────────────────────────────────────────────────────────────
{
  const g = { cls: () => 2, elev: () => 200, going: goingOf, label: (c) => `C${c}`, sight: () => 0.9, pending: () => false, dataLine: () => 'synthetic', avenues: () => null };
  const inp = (id, terrain) => ({ recipe: rec(id), ctx, opts: {}, ground: g, anchor: { x: 0, y: 0 }, bearing: 0, threat: null, terrain, cursor: { x: 0, y: 20000 } });
  const night = F.fitLayout(inp('bn-wdr-night', 'desert'));
  const d = row(night.res.rows, 'Desert');
  check('Bn Wdr by night in the desert: the Desert row warns on the 1.5-2 km walk to the embussing points (DW p 32), books differ with IBB p 383', d?.st === 'warn' && /walks \d\.\d km to its embussing point/.test(d.reason) && /DW s9 para 1 p 32/.test(d.reason) && /IBB's Coy embussing points 1500-2000 m back/.test(d.detail?.why ?? ''), d?.reason);
  check('...its items name each long walk, the fix the Coy RVs within 460 m (IBB p 381), the intermediate posn on a feature with delay potential', d?.detail?.items?.length >= 2 && /within 460 m of the posns \(IBB s75 para 14 a p 381\)/.test(d.detail.fix[0]) && /an intermediate posn only on a feature with delay potential/.test(d.reason), d?.detail?.items?.join('; '));
  check('...the plains have no Desert row', !row(F.fitLayout(inp('bn-wdr-night', 'plains')).res.rows, 'Desert'));
  const day = row(F.fitLayout(inp('bn-wdr-day', 'desert')).res.rows, 'Desert');
  check('Bn Wdr by day in the desert: the walk judged the same way', !!day && ['pass', 'warn'].includes(day.st) && /DW s9 para 1 p 32/.test(day.reason), day?.reason);
  const delay = row(F.fitLayout(inp('bn-delay', 'desert')).res.rows, 'Desert');
  check('the delaying action in the desert: a note (successive delaying posns or leap-frog, DW p 25), not the walk', delay?.st === 'pass' && /DW s7 para 9 b p 25/.test(delay.reason), delay?.reason);
}

// ── the attack, the gaps and the AT cover: the desert notes ──────────────────────────────────────────────────────────
{
  const atk = S.solveRecipe(rec('bn-attk-frontal'), ctx, {});
  const ga = C.groundNotes(atk.rows, doc, 'desert', 'attack', '16', true);
  const fa = row(ga, 'Form of attack');
  check('a desert attack: Form of attack names armour heavy or combined inf-tank (DW p 42), tank going (p 38), objectives (p 38), reorganisation (p 46)', /DW s12 para 12 p 42/.test(fa.reason) && /tank going/.test(fa.reason) && /water sources/.test(fa.reason) && /p 46/.test(fa.reason), fa.reason);
  check('...the plains attack has none of it', !/DW s12/.test(row(C.groundNotes(atk.rows, doc, 'plains', 'attack', '16', true), 'Form of attack').reason));
  const gaps = C.applyContext([{ name: 'Gaps', st: 'warn', reason: 'widest 3 km' }], doc, '18', 'defence', 0, 2, null, { kind: 'desert', source: 'user' });
  check('desert gaps: accepted, mines over the gaps and mobile task forces on the lesser approaches (DW p 23 paras 5 e-f)', row(gaps, 'Gaps').st === 'pass' && /DW p 23 paras 5 e-f/.test(row(gaps, 'Gaps').reason));
  const at = row(C.groundNotes([{ name: 'AT cover', st: 'pass', reason: 'x' }], doc, 'desert', 'defence', '16', null), 'AT cover');
  check('desert AT cover: the ATGMs concentrated on the most threatened approach (DW p 58), minefields channel his armour (p 23)', /DW s16 para 4 b-c p 58/.test(at.reason) && /DW p 23 para 5 d/.test(at.reason));
}

// ── the advance in the desert (DW pp 35-37, 55) ─────────────────────────────────────────────────────────────────────
{
  const V = await import('../../MS/Engines/DeploymentBuilder/PlanAdvance.ts');
  const open = [...Array(40).keys()].find((c) => !rules.profiles.tracked.nogo.includes(c) && rules.classes?.[c] !== undefined) ?? 1;
  const mk = (cls) => ({ cls, elev: () => 200, going: goingOf, label: (c) => `class ${c}`, pending: () => false, dataLine: () => 'synthetic' });
  const A = { x: 8200000, y: 3700000 };
  const inp = (id, terrain) => ({ recipe: rec(id), ctx, opts: {}, ground: mk(() => open), anchor: A, bearing: 0, terrain });
  const bde = row(V.fitAdvance(inp('bde-advance-armd', 'desert')).res.rows, 'Desert');
  check('an Armd Bde advance on one axis in the desert warns: a very wide front, combat groups, multiple axes (DW pp 35, 55), with fixes', bde?.st === 'warn' && /DW s11 paras 1 a, 2 p 35; s15 para 4 p 55/.test(bde.reason) && bde.detail.fix.length === 2, bde?.reason);
  check('...in the plains no Desert row', !row(V.fitAdvance(inp('bde-advance-armd', 'plains')).res.rows, 'Desert'));
  const bn = row(V.fitAdvance(inp('bn-advance-one-up', 'desert')).res.rows, 'Desert');
  check('a Bn Adv Gd in the desert: a note (the Bn on its Bde\'s axis), armour outflanks, night cross-country (DW pp 35-37, 55)', bn?.st === 'pass' && /DW p 55 para 4 b/.test(bn.reason) && /p 37 para 8/.test(bn.reason), bn?.reason);
  const div = row(V.fitAdvance(inp('div-advance-two-bde', 'desert')).res.rows, 'Desert');
  check('an Armd Div on two axes in the desert: a pass, the very wide front (DW pp 35, 55)', div?.st === 'pass' && /two Bdes on two axes/.test(div.reason), div?.reason);
}

// ── minor ops in the desert (DW s8 pp 28-30) ────────────────────────────────────────────────────────────────────────
{
  const SO = await import('../../MS/Engines/DeploymentBuilder/PlanSmallOps.ts');
  const ok = SO.desertMinorOpRow([{ name: 'Time', st: 'pass', reason: '' }]);
  check('a patrol within the night in the desert: a note (hideouts, by night, FOO / FAC, wheels where far: DW pp 28-30)', ok.st === 'pass' && /hideouts/.test(ok.reason) && /DW pp 29-30/.test(ok.reason));
  const far = SO.desertMinorOpRow([{ name: 'Time', st: 'warn', reason: '' }]);
  check('...past the night on foot it warns: targets farther off limit ops on foot (DW p 29 c), wheels / helicopters / a hideout', far.st === 'warn' && /DW s8 para 2 c p 29/.test(far.reason) && far.detail.fix.length === 3);
}

// ── N3: the ATGMs concentrated on the main approach (DW p 58; IBB p 73) ─────────────────────────────────────────────
{
  const std = O.brief(orbat, 'inf-bn-std'), lat = O.withAtGroup(orbat, std, 'inf-bn-lat-apc', 1);
  const r = rec('bn-def-two-up'), res = S.solveRecipe(r, ctx, {});
  const frame = { anchor: { x: 0, y: 0 }, bearing: 0, k: 1, pivot: res.items.find((i) => i.role === 'hq').pts[0] };
  const path = (x) => { const p = []; for (let y = 8000; y >= -500; y -= 100) p.push(F.toWorld(frame, { x, y })); return p; };
  const apchs = [{ id: 'A1', main: true, full: true, path: path(-1500), chokes: [] }, { id: 'A2', main: false, full: false, path: path(4500), chokes: [] }];
  const ex = F.atgmExtras(res, r, lat, apchs, frame, doc);
  // each launcher counted to the approach it lies nearer to (A1 at x -1500, A2 at x 4500)
  const toMain = (e) => Math.abs(e.at.x + 1500) <= Math.abs(e.at.x - 4500);
  const onMain = ex.filter(toMain).length / 2, onSec = ex.filter((e) => !toMain(e)).length / 2;
  check('N3: an LAT Coy\'s extra pairs go to the main approach, not spread to the flanks (DW p 58; IBB p 73)', ex.length / 2 >= 6 && onMain > onSec && onMain + onSec === ex.length / 2, `main ${onMain} pairs, A2 ${onSec}, of ${ex.length / 2}`);
  const all = { ...res, items: [...res.items, ...ex.map((e, k) => ({ role: e.role, label: 'BS', key: e.key, pts: [e.at], id: `x${k}` }))] };
  const en = { echelon: '18', type: 'mech', source: 'user' };
  const ok = F.atCoverRow(all, r, lat, apchs, frame, doc, en);
  check('...the AT cover row passes: the main approach the densest', ok.st === 'pass', ok.reason.slice(0, 160));
  const spread = { ...res, items: [...res.items, ...[0, 1, 2, 3].map((k) => ({ role: `atgmX${k + 1}`, label: 'BS', key: ex[0]?.key, pts: [{ x: 4500 + (k % 2 ? 300 : -300), y: -800 }], id: `s${k}` }))] };
  const bad = F.atCoverRow(spread, r, lat, apchs, frame, doc, en);
  check('...ATGMs massed on the secondary approach instead: AT cover warns, the main not the densest (DW p 58)', bad.st === 'warn' && /not the densest/.test(bad.detail?.head ?? '') && /DW s16 para 4 b-c p 58/.test(bad.detail.why), bad.reason.slice(0, 200));
}

// ── N1, N4, N5, N10: the desert defence's own rows ──────────────────────────────────────────────────────────────────
{
  const bn = C.groundNotes(S.solveRecipe(rec('bn-def-two-up'), ctx, {}).rows, doc, 'desert', 'defence', '16', null);
  check('N1: a desert Bn defence gets "Sited to deny" grey: comm centres, BUAs, admin areas, ground over the MSRs (DW p 22 para 5 a), confirm on the map', row(bn, 'Sited to deny')?.st === 'unchecked' && /DW s7 para 5 a p 22/.test(row(bn, 'Sited to deny').reason));
  check('N4: Strong points: concentric circles, inner core, self-sufficient, stocked to fight bypassed (DW pp 27-28, 85)', row(bn, 'Strong points')?.st === 'pass' && /concentric circles/.test(row(bn, 'Strong points').reason) && /p 13/.test(row(bn, 'Strong points').reason));
  check('N10: Desert prep: frame revetment 6 h a crew + 4-6 h, 114,994 sandbags, double fwd + rev slope (DW Annexes A-B)', row(bn, 'Desert prep')?.st === 'pass' && /114,994 sandbags/.test(row(bn, 'Desert prep').reason) && /6 h a weapon crew/.test(row(bn, 'Desert prep').reason));
  const bde = C.groundNotes(S.solveRecipe(rec('bde-def-two-up'), ctx, {}).rows, doc, 'desert', 'defence', '18', null);
  check('N5: a desert Bde defence gets Covering troops: by night, armour based, a handover line (DW pp 24-25, 56)', row(bde, 'Covering troops')?.st === 'pass' && /handover line/.test(row(bde, 'Covering troops').reason) && !row(bde, 'Desert prep'));
  const twice = C.groundNotes(bn, doc, 'desert', 'defence', '16', null);
  check('...run twice (build, then the fit): each row once, its text once', twice.filter((x) => x.name === 'Strong points').length === 1 && (row(twice, 'Strong points').reason.match(/concentric circles/g) ?? []).length === 1);
  const pl = C.groundNotes(S.solveRecipe(rec('bn-def-two-up'), ctx, {}).rows, doc, 'plains', 'defence', '16', null);
  check('...the plains get none of them', !['Sited to deny', 'Strong points', 'Desert prep', 'Covering troops'].some((nm) => row(pl, nm)));
}

// ── N2: the Armd Bde mobile defence (MIB Annex P paras 2, 6; DW p 22) ───────────────────────────────────────────────
{
  const M = await import('../../MS/Engines/DeploymentBuilder/PlanMountain.ts');
  const V = await import('../../MS/Engines/DeploymentBuilder/PlanRecipes.ts');
  const r = rec('bde-def-mobile');
  const issues = V.validateRecipe(r, { doc, symbols, file: 'bde-def-mobile.json' });
  check('N2: bde-def-mobile validates (only "no frontage row", as mib-def-fixing), layout mobile, the IABG, in the index', !issues.some((i) => i.level === 'fail') && issues.every((i) => /no frontage row/.test(i.msg)) && r.layout === 'mobile' && r.unit === 'armr-iabg' && json('MS/Data/Deployments/Recipes/index.json').families.some((f) => f.recipes.includes('bde-def-mobile')), issues.map((i) => i.msg).join('; '));
  const res = S.solveRecipe(r, ctx, {});
  const lr = M.layoutRows(res.items, r, doc);
  check('...its rows: Killing zone between the fixing groups, Counter-attack force mounted behind it in time, Fixing and striking (books differ)', row(lr, 'Killing zone')?.st === 'pass' && row(lr, 'Counter-attack force')?.st === 'pass' && /MIB Annex P/.test(row(lr, 'Fixing and striking')?.reason ?? '') && /books differ/.test(row(lr, 'Fixing and striking').reason), lr.map((x) => `${x.name} ${x.st}`).join(', '));
  const foot = { ...r, slots: r.slots.map((s) => (s.role === 'res' ? { ...s, mounted: false } : s)) };
  check('...a counter-attack force on foot warns', row(M.layoutRows(S.solveRecipe(foot, ctx, {}).items, foot, doc), 'Counter-attack force')?.st === 'warn');
  const kzOut = res.items.map((i) => (i.role === 'kz' ? { ...i, pts: i.pts.map((p) => ({ x: p.x + 9000, y: p.y })) } : i));
  check('...a killing zone off to a flank, not between the groups, warns', row(M.layoutRows(kzOut, r, doc), 'Killing zone')?.st === 'warn');
  const des = C.groundNotes([...res.rows, ...lr], doc, 'desert', 'defence', '18', null);
  check('...in the desert: mobile defence preferred in the Thar, area and mobile combined in Cholistan (DW s7 para 4 c p 22)', /preferred in the Thar/.test(row(des, 'Fixing and striking').reason) && /DW s7 para 4 c p 22/.test(row(des, 'Fixing and striking').reason));
  check('...the reserve share a third and mounted: no desert reserve warning', row(des, 'Reserve share')?.st === 'pass' && row(des, 'Reserve reach')?.st === 'pass');
}

// the Ground Guide's desert checks (G1-G3) are in tools/ipb-test/desert.mjs (its view modules need transform-types)

console.log(`\n${n - fails}/${n} passed${fails ? `, ${fails} FAILED` : ''}`);
process.exit(fails ? 1 : 0);
