// salient.mjs -- checks the salient plans built on 27 Nov 2026 from Mountain Warfare (GSP-1973, 2003; MW_Review.md N4):
// the defence of a salient (bde-def-mtn-salient, MW s14 pp 178-179: the arch held lightly, strong shoulders, the depth
// localities prepared, the reserve central) and the reduction of the En's salient (bde-attk-mtn-salient, MW s9 pp 124-133,
// Figure 4 p 131: the arch fixed, the base attacked from both flanks, infiltration to the base, assembly at more than
// one place), their rows (PlanMountain.layoutRows) and Check my plan on a built plan.
//   node tools/planbuilder-test/salient.mjs          (add --quiet to print only failures and the summary)
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
const V = await import('../../MS/Engines/DeploymentBuilder/PlanRecipes.ts');
const M = await import('../../MS/Engines/DeploymentBuilder/PlanMountain.ts');
const K = await import('../../MS/Engines/DeploymentBuilder/PlanCheck.ts');

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
const symbols = json('MS/Data/Symbols.json');
const ctx = { doc, symbols };
const rec = (id) => json(`MS/Data/Deployments/Recipes/${id}.json`);
const row = (rows, name) => rows.find((r) => r.name === name);
const mtnRows = (r) => M.layoutRows(S.solveRecipe(r, ctx, {}).items, r, doc);
const slot = (r, role) => r.slots.find((s) => s.role === role);
const def = rec('bde-def-mtn-salient'), atk = rec('bde-attk-mtn-salient');
const index = json('MS/Data/Deployments/Recipes/index.json');

// ── the recipes ──────────────────────────────────────────────────────────────────────────────────────────────────────
for (const r of [def, atk]) {
  const issues = V.validateRecipe(r, { doc, symbols, file: `${r.id}.json` });
  check(`${r.id}: a valid recipe (no fail, no warn)`, issues.length === 0, issues.map((i) => `${i.level}: ${i.msg}`).join('; '));
  const fam = index.families.find((f) => f.recipes.includes(r.id));
  check(`${r.id}: in index.json, family ${r.family} (Bde, ${r.task}, inf-bde)`, !!fam && fam.id === r.family && fam.echelon === '18' && fam.task === r.task && fam.unit === 'inf-bde');
  check(`${r.id}: a mountain recipe, layout salient`, r.layout === 'salient' && M.isMountainRecipe(r) && V.LAYOUTS.includes('salient'));
}
check('the tab labels the layout "Salient"', /salient: 'Salient'/.test(read('MS/Engines/DeploymentBuilder/PlanBuildTab.ts')));

// ── the defence of a salient (MW s14 pp 178-179) ─────────────────────────────────────────────────────────────────────
{
  const res = S.solveRecipe(def, ctx, {});
  const rows = M.layoutRows(res.items, def, doc);
  const want = ['Shoulders', 'Arch', 'Reserve central', 'Depth'];
  check('defence as laid: Shoulders, Arch, Reserve central and Depth pass', want.every((x) => row(rows, x)?.st === 'pass'), rows.map((r) => `${r.name} [${r.st}]`).join(', '));
  check('...Shoulders: 12 Pls each against 3 on the arch, MW s14 para 1 a p 178', /12 Pls.*12 Pls.*against 3 Pls on the arch/.test(row(rows, 'Shoulders').reason) && /MW s14 para 1, para 1 a p 178/.test(row(rows, 'Shoulders').reason), row(rows, 'Shoulders').reason.slice(0, 160));
  check('...Arch ahead of the shoulders, the salient own ground toward the En (MW s9 para 2 a p 124)', /ahead of the shoulders/.test(row(rows, 'Arch').reason) && /MW s9 para 2 a p 124/.test(row(rows, 'Arch').reason));
  check('...Reserve central behind the arch, para 1 h p 179, split per sub-sector where the tracks are poor (para 2 d)', /behind the arch/.test(row(rows, 'Reserve central').reason) && /para 1 h p 179/.test(row(rows, 'Reserve central').reason) && /para 2 d/.test(row(rows, 'Reserve central').reason));
  check('...Depth: two localities prepared for occupation, drawn planned (para 1 b p 178)', /2 depth localities, 2 prepared for occupation/.test(row(rows, 'Depth').reason) && res.items.filter((i) => /^depth[LR]$/.test(i.role)).length === 2 && res.items.filter((i) => /^depth[LR]$/.test(i.role)).every((i) => i.planned));
  check('...Salient note unchecked: more troops than a linear border, fire from three sides, a Bn per major approach (p 179)', row(rows, 'Salient')?.st === 'unchecked' && /linear border/.test(row(rows, 'Salient').reason) && /para 1 g/.test(row(rows, 'Salient').reason));
  check('...Strong points unchecked without the ground', row(rows, 'Strong points')?.st === 'unchecked');
  const share = row(res.rows, 'Reserve share');
  check('solver: the reserve share counts Bns only (the arch Coy is not a Bn): 1 of the 3 Bns', /1 of the 3 Bns/.test(share?.reason ?? '') && Math.abs(share.m - 1 / 3) < 1e-9, share?.reason?.slice(0, 80));
  check('solver: frontage on the Bde row (11.9 km of 12 km) and depth 4-6 km pass', row(res.rows, 'Frontage')?.st === 'pass' && row(res.rows, 'Depth')?.st === 'pass');
  // bad variants
  const weak = structuredClone(def); Object.assign(slot(weak, 'shL'), { echelon: '15', label: 'A Coy, L shoulder', size: { doctrine: 'size.coy' } });
  const rw = row(mtnRows(weak), 'Shoulders');
  check('a shoulder held by a Coy, as strong as the arch: Shoulders warns with a Why and a Fix (para 2 a p 179: envelopment at the base)', rw?.st === 'warn' && rw.detail?.fix?.length === 3 && /envelopment directed at its base/.test(rw.detail.why), rw?.reason?.slice(0, 120));
  const flat = structuredClone(def); slot(flat, 'shL').seed.backM = -3600; slot(flat, 'shR').seed.backM = -3600;
  const ra = row(mtnRows(flat), 'Arch');
  check('the shoulders laid ahead of the arch (no projection): Arch warns, "use Bde Def: two Bns up"', ra?.st === 'warn' && /two Bns up/.test(ra.detail?.fix?.join(' ') ?? ''), ra?.reason?.slice(0, 120));
  const side = structuredClone(def); Object.assign(slot(side, 'res').seed, { acrossM: -2000, backM: 3200 });
  const rr = row(mtnRows(side), 'Reserve central');
  check('the reserve 2 km off the middle (over 20 % of the span, M): Reserve central warns', rr?.st === 'warn' && /2\.0 km off the middle/.test(rr.reason), rr?.reason?.slice(0, 120));
  const nodep = structuredClone(def); nodep.slots = nodep.slots.filter((s) => !/^depth/.test(s.role));
  check('no depth localities: Depth warns', row(mtnRows(nodep), 'Depth')?.st === 'warn');
}

// ── the reduction of a salient (MW s9 pp 124-133, Figure 4 p 131) ────────────────────────────────────────────────────
{
  const res = S.solveRecipe(atk, ctx, {});
  const rows = M.layoutRows(res.items, atk, doc);
  check('attack as laid: Base or shoulder, Front fixed, Infiltration to the base, Assembly, Reserve per axis pass', ['Base or shoulder', 'Front fixed', 'Infiltration to the base', 'Assembly', 'Reserve per axis'].every((x) => row(rows, x)?.st === 'pass'), rows.map((r) => `${r.name} [${r.st}]`).join(', '));
  check('...the main axis from a flank (87° off the fixing direction), the Obj on the L shoulder, not the arch (para 5 a p 128)', /OBJ A \(L shoulder\)/.test(row(rows, 'Base or shoulder').reason) && /main axis 8\d° off the fixing direction/.test(row(rows, 'Base or shoulder').reason) && /MW s9 para 5 a, b p 128/.test(row(rows, 'Base or shoulder').reason));
  check('...three Assy Areas (para 8 p 130); Deception and Arty and DAA unchecked (pp 132-133)', /3 Assy Areas/.test(row(rows, 'Assembly').reason) && row(rows, 'Deception')?.st === 'unchecked' && row(rows, 'Arty and DAA')?.st === 'unchecked' && /DAA/.test(row(rows, 'Arty and DAA').reason));
  check('...the Objective read unchecked without the ground', row(rows, 'Objective')?.st === 'unchecked');
  check('solver: FUP 1.1 km, Bn assault 450 m, reserve within the hour: all pass', ['FUP from the Obj', 'Assault frontage', 'Reserve reach'].every((x) => row(res.rows, x)?.st === 'pass'), ['FUP from the Obj', 'Assault frontage', 'Reserve reach'].map((x) => `${x} [${row(res.rows, x)?.st}]`).join(', '));
  check('...the 2525D symbols: Fixation 25341100, Infiltration Lane 25140800, Main Attk / Sp Attk 25151403 / 25151404', slot(atk, 'fix').sym === '25341100' && slot(atk, 'infilLane').sym === '25140800' && slot(atk, 'axis').sym === '25151403' && slot(atk, 'axisS').sym === '25151404');
  // bad variants
  const onArch = structuredClone(atk); slot(onArch, 'obj').shape.rect = { ...slot(onArch, 'obj').shape.rect, acrossM: 0, backM: -2000 };
  const rb = row(mtnRows(onArch), 'Base or shoulder');
  check('the main Obj on the arch: Base or shoulder warns "The main attack goes onto the arch" (para 4 a p 127: very costly)', rb?.st === 'warn' && rb.detail?.head === 'The main attack goes onto the arch' && /very costly/.test(rb.detail.why), rb?.reason?.slice(0, 120));
  const frontal = structuredClone(atk); slot(frontal, 'axis').shape.pts = [[-3000, -3000], [-3000, -4000]];
  const rf = row(mtnRows(frontal), 'Base or shoulder');
  check('the main axis parallel to the fixing arrow: warns "comes in frontally"', rf?.st === 'warn' && /frontally/.test(rf.detail?.head ?? ''), rf?.reason?.slice(0, 160));
  const oneAssy = structuredClone(atk); oneAssy.slots = oneAssy.slots.filter((s) => s.role !== 'assyS' && s.role !== 'assyF');
  check('one Assy Area: Assembly warns (para 8 b, d p 130)', row(mtnRows(oneAssy), 'Assembly')?.st === 'warn');
  const noInf = structuredClone(atk); noInf.slots = noInf.slots.filter((s) => s.role !== 'infil');
  check('no infiltration force: Infiltration to the base warns', row(mtnRows(noInf), 'Infiltration to the base')?.st === 'warn');
  const noFix = structuredClone(atk); noFix.slots = noFix.slots.filter((s) => s.role !== 'fix');
  check('no fixing arrow: Front fixed warns', row(mtnRows(noFix), 'Front fixed')?.st === 'warn');
  // the Objective read on the elevation, the same reader as the Bn mountain attack
  const o = res.items.find((i) => i.role === 'obj').pts, oc = { x: o.reduce((a, p) => a + p.x, 0) / o.length, y: o.reduce((a, p) => a + p.y, 0) / o.length };
  const hill = (p) => 2000 + 300 * Math.exp(-((p.x - oc.x) ** 2 + (p.y - oc.y) ** 2) / (2 * 500 ** 2));
  const ro = row(M.layoutRows(res.items, atk, doc, hill), 'Objective');
  check('with the elevation, the Obj on its hill: Objective passes', ro?.st === 'pass', ro?.reason?.slice(0, 120));
}

// ── Check my plan on a built salient plan ────────────────────────────────────────────────────────────────────────────
{
  const recsOf = (recipe) => {
    const out = S.toPlanDocument(S.solveRecipe(recipe, ctx, {}), (pid, ov, id, de) => ({ plnOrdrSymbolPK: { plnOrdrSymbolId: id }, drawEss: JSON.stringify(de) }), (pid, id, name, seq, syms) => ({ plnOrdrSymbolSet: syms }), 1);
    return K.recordsFromPlanDoc(out.doc).map((r) => ({ ...r, attrs: { ...(r.attrs ?? {}), pbRole: out.roles[r.id], pbRecipe: recipe.id } }));
  };
  const rd = K.checkPlan(recsOf(def), doc, { recipes: { [def.id]: def } });
  check('Check my plan reads a built salient defence: Shoulders, Arch, Reserve central rows', ['Shoulders', 'Arch', 'Reserve central'].every((x) => row(rd.rows, x)), rd.rows.map((r) => `${r.name} [${r.st}]`).join(', '));
  check('...and passes them', ['Shoulders', 'Arch', 'Reserve central'].every((x) => row(rd.rows, x)?.st === 'pass'), ['Shoulders', 'Arch', 'Reserve central'].map((x) => `${x} [${row(rd.rows, x)?.st}]`).join(', '));
  const ra = K.checkPlan(recsOf(atk), doc, { recipes: { [atk.id]: atk } });
  check('Check my plan reads a built reduction of a salient: Base or shoulder, Front fixed, Assembly', ['Base or shoulder', 'Front fixed', 'Assembly'].every((x) => row(ra.rows, x)), ra.rows.map((r) => `${r.name} [${r.st}]`).join(', '));
}

// ── the doctrine ─────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const sl = doc.plan.mountain.salient;
  const pages = new Set((sl?.refs ?? []).map((r) => r.page));
  check('PlanDoctrine mountain.salient: MW refs on pp 124, 127, 128, 130, 132, 133, 178, 179 (basis D)', sl?.basis === 'D' && ['124', '127', '128', '130', '132', '133', '178', '179'].every((p) => pages.has(p)), [...pages].join(','));
  check('...centralShare 0.2, archRadiusM 1500, flankMinDeg 45: method settings (M), each saying the book gives no figure', sl.centralShare?.value === 0.2 && sl.archRadiusM?.value === 1500 && sl.flankMinDeg?.value === 45 && [sl.centralShare, sl.archRadiusM, sl.flankMinDeg].every((x) => x.basis === 'M' && /no (distance|angle)/.test(x.src)));
}

console.log(`\n${n - fails} of ${n} checks passed${fails ? `, ${fails} FAILED` : ''}`);
process.exit(fails ? 1 : 0);
