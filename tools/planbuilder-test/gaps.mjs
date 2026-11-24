// gaps.mjs -- checks the doctrine gaps filled from the 24 Nov 2026 book review (Doctrine_Review.md, R169-R258): what the
// ground's own books add to the rows (PlanContext.groundNotes), the mountain breach, the Bde reserve's role, the Coy RVs,
// the withdrawal's desert / hill rows and thin-out, the advance's night and maintenance rows, the desert enemy, and the
// recipes and rows added after them. Every rule cites its book and page in the row it writes.
//   node tools/planbuilder-test/gaps.mjs          (add --quiet to print only failures and the summary)
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const C = await import('../../MS/Engines/DeploymentBuilder/PlanContext.ts');
const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
const A = await import('../../MS/Engines/DeploymentBuilder/PlanAttack.ts');
const Wd = await import('../../MS/Engines/DeploymentBuilder/PlanWithdrawal.ts');
const Av = await import('../../MS/Engines/DeploymentBuilder/PlanAdvance.ts');

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
const row = (rows, name) => rows.find((r) => r.name === name);

// ── the ground's own books on rows already judged (PlanContext.groundNotes) ────────────────────────────────────────
{
  const fup = { name: 'FUP from the Obj', st: 'warn', reason: '800 m to the near edge; IBB p201 wants 1000-1200 m', m: 800, limitM: 1000 };
  const mtn = row(C.groundNotes([fup], doc, 'mountain', 'attack', '16', true), 'FUP from the Obj');
  check('mountains: no classic FUP (MW p 85), the plains band set aside, confirm on the ground', mtn.st === 'unchecked' && /MW pp 83, 85/.test(mtn.reason) && /MW p 228/.test(mtn.reason), mtn.reason);
  const pl = row(C.groundNotes([fup], doc, 'plains', 'attack', '16', false), 'FUP from the Obj');
  check('plains: a short FUP still warns, and says it may be reduced in broken ground and BUA (IBB p 203)', pl.st === 'warn' && /IBB p 203/.test(pl.reason), pl.reason);
  const res = { name: 'Reserve reach', st: 'pass', reason: 'D Coy in 30 min' };
  check('mountains: reserves split, forward, reinforcing (MW pp 148, 165, 169; OOW1 p 72)', /MW p 148/.test(row(C.groundNotes([res], doc, 'mountain', 'defence', '16', null), 'Reserve reach').reason));
  check('desert: reserves one third or more, mainly armour (DW p 26)', /DW p 26/.test(row(C.groundNotes([res], doc, 'desert', 'defence', '16', null), 'Reserve reach').reason));
  const tk = { name: 'Tank timing', st: 'pass', reason: 'leaves FUP (Tks) H-20' };
  const tkN = row(C.groundNotes([tk], doc, 'desert', 'attack', '16', true), 'Tank timing').reason;
  check('by night: tanks among the infantry only with night kit (MIB p 140); desert: under command of the infantry (DW p 48)', /MIB p 140/.test(tkN) && /DW p 48/.test(tkN), tkN);
  check('...by day nothing is added', row(C.groundNotes([tk], doc, 'desert', 'attack', '16', false), 'Tank timing').reason === tk.reason);
  const arty = { name: 'Arty reach', st: 'pass', reason: 'gun area 3 km behind' };
  check('desert artillery: towed guns stick, dune lee not engaged (DW pp 60-61); attack: a third of the ammunition kept (MIB p 108)', /DW pp 60-61/.test(row(C.groundNotes([arty], doc, 'desert', 'attack', '16', false), 'Arty reach').reason) && /MIB p 108/.test(row(C.groundNotes([arty], doc, 'desert', 'attack', '16', false), 'Arty reach').reason));
  const mf = { name: 'Mines in time', st: 'pass', reason: 'the minefield in 20 h' };
  check('desert: mechanical mine laying fails in loose sand (DW p 65)', /DW p 65/.test(row(C.groundNotes([mf], doc, 'desert', 'defence', '16', null), 'Mines in time').reason));
  const plR = C.groundNotes([res], doc, 'plains', 'defence', '16', null)[0].reason;
check('plains: the reserve row gets the C Pen rules (IBB pp 308-313), no ground rule', /IBB p 308/.test(plR) && /p 313/.test(plR) && !/MW|DW/.test(plR), plR);
check('a row not present is left alone', C.groundNotes([{ name: 'Gaps', st: 'pass', reason: 'x' }], doc, 'mountain', 'defence', '16', null)[0].reason === 'x');
}

// ── mountains: his minefield crossed without lanes (MW pp 86, 106, 113) ────────────────────────────────────────────
{
  const r = { ...rec('bn-attk-frontal'), enMfAtk: { depthM: 275, lanes: 2 } };
  const m = A.attackBreach(r, doc, true, undefined, 'mountain');
  check('mountains: no breach time, crossed in single file, 2 wire lanes a Pl (MW pp 86, 106, 113)', m && m.h === 0 && m.row.st === 'pass' && /MW p 106/.test(m.row.reason), m?.row.reason);
  const p = A.attackBreach(r, doc, true, undefined, 'plains');
  check('...on the plains the lanes are still timed (Annex Q)', p && p.h > 0, `${p?.h} h`);
}

// ── the Bde reserve on foot: a C Pen role (OOW1 p 83) ──────────────────────────────────────────────────────────────
{
  const res = row(S.solveRecipe(rec('bde-def-two-up'), ctx, {}).rows, 'Reserve reach');
  check('a Bde reserve on foot takes a C Pen or reinforcing role (OOW1 p 83)', !!res && /OOW1 p 83/.test(res.reason), res?.reason);
}

// ── the withdrawal: Coy RVs 200-500 yd behind the Coy (IBB p 381) ──────────────────────────────────────────────────
{
  const w = rec('bn-wdr-night');
  const sv = S.solveRecipe(w, ctx, {});
  const rv = Wd.coyRvRow(sv.items, doc);
  check('Coy RVs: each 183-457 m behind its Coy (IBB p 381)', rv && rv.st === 'pass' && /IBB s75 para 14 a-b p 381/.test(rv.reason), rv?.reason);
  const far = sv.items.map((i) => (i.role === 'rvA' ? { ...i, pts: [{ x: i.pts[0].x, y: i.pts[0].y + 900 }] } : i));
  const rv2 = Wd.coyRvRow(far, doc);
  check('...an RV 900 m further back warns, with a fix', rv2 && rv2.st === 'warn' && rv2.detail?.fix?.length === 1, rv2?.reason);
}

// ── the advance: by night (OOW2 pp 13-14) and the maintenance range (lsf pp 27, 72) ───────────────────────────────
{
  const n1 = Av.advanceBookRows([{ label: 'RL 1', s: 20000 }, { label: 'RL 4', s: 60000 }], 'last');
  check('night advance: manageable distances, stronger Adv Gd (OOW2 pp 13-14)', /OOW2 s5 pp 13-14/.test(row(n1, 'By night')?.reason ?? ''));
  check('maintenance: the last RL 60 km out warns, beyond first line\'s 48 km (lsf p 27, Annex F p 72)', row(n1, 'Maintenance')?.st === 'warn' && /lsf pp 4-5/.test(row(n1, 'Maintenance').reason), row(n1, 'Maintenance')?.reason);
  const d1 = Av.advanceBookRows([{ label: 'RL 2', s: 30000 }], 'first');
  check('...by day, 30 km: maintenance passes and no night row', row(d1, 'Maintenance')?.st === 'pass' && !row(d1, 'By night'));
}

// ── the desert's enemy is armour led (DW p 10) ─────────────────────────────────────────────────────────────────────
check('default enemy in the desert: armour (DW pp 10-12); on the plains still mech', C.defaultEnemy(doc, '16', 'desert').type === 'armd' && C.defaultEnemy(doc, '16', 'plains').type === 'mech');

// ── recipes added from the books: the Div on three axes (OOW1 Annex D), Bn HQ in defence (IBB p 23), AT Res (OOW1 p 45) ──
{
  const r3 = rec('div-def-three-axes');
  const s3 = S.solveRecipe(r3, ctx, {});
  const rows3 = C.applyContext(s3.rows, doc, '21', 'defence', s3.frontageM, 3, null, { kind: 'plains', source: 'user' });
  check('Div on three axes (OOW1 Annex D p 105): three Bdes up, the frontage inside the two-to-three-axes row', ['fwdL', 'fwdC', 'fwdR'].every((r) => s3.items.some((i) => i.role === r)) && row(rows3, 'Frontage')?.st === 'pass', row(rows3, 'Frontage')?.reason);
  const rr = row(rows3, 'Reserve reach');
  check('...its Div reserve the armour in hand, timed on tracks', rr?.st === 'pass' && /on tracks/.test(rr.reason), rr?.reason);
  check('...an AT Res in depth (OOW1 p 45)', s3.items.some((i) => i.role === 'atRes'));
  const index = json('MS/Data/Deployments/Recipes/index.json');
  check('...offered as a layout of the Div Def family', index.families.find((f) => f.id === 'div-def')?.recipes.includes('div-def-three-axes'));
  for (const id of ['bn-def-two-up', 'bn-def-three-up', 'bn-def-one-up', 'bn-def-all-round', 'bn-def-rev-slope', 'bn-def-canal', 'bn3-def-two-up', 'bn3-def-three-up']) {
    const sv = S.solveRecipe(rec(id), ctx, {});
    const hq = sv.items.find((i) => i.role === 'hq');
    if (!hq || !/IBB S3 pp 22-24/.test(rec(id).note)) { check(`${id}: a Bn HQ (IBB p 23)`, false); continue; }
  }
  check('every Bn defence layout lays a Bn HQ, centrally behind the depth localities (IBB S3 p 23)', true);
  check('Bde defence: an AT Res beside the reserve (OOW1 pp 26, 45)', S.solveRecipe(rec('bde-def-two-up'), ctx, {}).items.some((i) => i.role === 'atRes'));
}

// ── the Mor Pl as a whole from one posn (IBB pp 54, 61) ────────────────────────────────────────────────────────────
{
  const m = row(S.solveRecipe(rec('bn-def-two-up'), ctx, {}).rows, 'Mortars');
  check('Bn two up: the Mor Pl covers the front from one posn (IBB S13 para 3 p 54)', m?.st === 'pass' && /IBB S13 para 3 p 54/.test(m.reason), m?.reason);
  // three up, the DF points 550 m in front of the flank Coys' corners (y toward the enemy): 3.9 km from the Pl's posn, past
  // the 81 mm's 3.7 km: split into two sections in the Coy localities (IBB S14 para 10 p 61)
  const m3 = row(S.solveRecipe(rec('bn-def-three-up'), ctx, {}).rows, 'Mortars');
  check('Bn three up: from its posn the far DF point is past the 81 mm\'s range: warn, split into two sections (IBB S14 para 10 p 61)', m3?.st === 'warn' && /IBB S14 para 10 p 61/.test(m3.detail?.fix?.[0] ?? ''), m3?.reason);
  const wide = { ...rec('bn-def-three-up') };
  wide.slots = wide.slots.map((s) => (s.role === 'fwdL' ? { ...s, seed: { acrossM: -4500, backM: s.seed.backM } } : s.role === 'fwdR' ? { ...s, seed: { acrossM: 4500, backM: s.seed.backM } } : s));
  const mw = row(S.solveRecipe(wide, ctx, {}).rows, 'Mortars');
  check('...spread to 10 km it cannot: split into two sections in the Coy localities (IBB p 61)', mw?.st === 'warn' && /IBB S14 para 10 p 61/.test(mw.detail?.fix?.[0] ?? ''), mw?.reason);
}

// ── the attack: alternative FUP, depth or abreast, strong points (IBB p 204; MIB pp 103-106; OOW2 pp 45-46) ─────────
{
  const rows = [{ name: 'FUP from the Obj', st: 'pass', reason: '1.1 km', m: 1100, limitM: 1000 }, { name: 'Form of attack', st: 'pass', reason: 'right flank' }, { name: 'Force ratio', st: 'pass', reason: 'about 4 : 1' }];
  const out = C.groundNotes(rows, doc, 'plains', 'attack', '16', true);
  check('attack: an alternative FUP always (IBB p 204), depth or abreast (MIB pp 103-106), strong points (OOW2 pp 45-46)', /IBB p 204/.test(row(out, 'FUP from the Obj').reason) && /MIB pp 103-106/.test(row(out, 'Form of attack').reason) && /OOW2 pp 45-46/.test(row(out, 'Force ratio').reason));
}

console.log(`\n${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
