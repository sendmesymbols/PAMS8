// recipes.mjs -- checks the Deployment Mgr Build tab's recipes (MS/Data/Deployments/Recipes) and PlanDoctrine.json.
//   node tools/planbuilder-test/recipes.mjs          (add --quiet to print only failures and the summary)
// Runs the library's own pure validator (MS/Engines/DeploymentBuilder/PlanRecipes.ts) on every recipe in index.json,
// then feeds it broken recipes to prove it catches them. Exit code 1 on a failure. Warnings (a depth outside the row,
// a gap wider than the row) are printed but do not fail: they are the doctrine's own tolerances, for the user to judge.
import { register } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const R = await import('../../MS/Engines/DeploymentBuilder/PlanRecipes.ts');

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const quiet = process.argv.includes('--quiet');
const json = (p) => JSON.parse(readFileSync(resolve(repo, p), 'utf8'));

let fails = 0, warns = 0, n = 0;
function check(name, ok, info = '') {
  n++;
  if (!ok) fails++;
  if (!ok || !quiet) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
}

const doc = { plan: json('MS/Data/PlanDoctrine.json'), ocoka: json('MS/Data/OcokaDoctrine.json') };
const symbols = json('MS/Data/Symbols.json');
const units = new Set();
const orbatDir = 'MS/Data/Orbat/PK';
try {
  const ix = json(`${orbatDir}/index.json`);
  for (const f of ix.files) for (const u of json(`${orbatDir}/${f.file}`).units) units.add(u.id);
} catch { console.log(`note  ORBAT not found in ${orbatDir}: units not checked`); }
const ctxBase = { doc, symbols, units: units.size ? units : undefined };

// ── PlanDoctrine.json itself ─────────────────────────────────────────────────────────────────────────────────────
check('PlanDoctrine: format and version', doc.plan.format === 'pams8-plan-doctrine' && doc.plan.version === 1);
for (const [path, want] of [['size.coy', null], ['standoff.lpM', [300, 400]], ['fireLiftM.bnMor', 275], ['df.closeMinFromFdlM.mortar', 550], ['cpen.coyMin', 30], ['fit.restMs', 350]]) {
  const v = R.doctrineAt(doc, path);
  check(`PlanDoctrine: ${path} resolves`, v !== undefined && (want == null || JSON.stringify(v) === JSON.stringify(want)), JSON.stringify(v));
}
const coy = R.doctrineAt(doc, 'size.coy');
check('PlanDoctrine: Coy is the doctrine size 1500 x 600-800 m (user, 15 Nov 2026)', coy?.frontageM === 1500 && JSON.stringify(coy?.depthM) === '[600,800]');
const w = doc.plan.scoreWeights;
const wsum = ['approaches', 'depth', 'obstacle', 'gaps', 'flanks', 'exposure', 'alternates'].reduce((a, k) => a + (w[k] ?? 0), 0);
check('PlanDoctrine: score weights add up to 1', Math.abs(wsum - 1) < 1e-9, String(wsum));
// every leaf with a value carries a basis, directly or from its parent; D figures carry a source
let unbased = [], unsourced = [];
(function walk(node, path, basis, src) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;
  const b = node.basis ?? basis, s = node.src ?? src;
  if ('value' in node) { if (!b) unbased.push(path); if (b === 'D' && !s) unsourced.push(path); }
  for (const [k, v] of Object.entries(node)) if (!['sources', 'basisCodes'].includes(k)) walk(v, path ? `${path}.${k}` : k, b, s);
})(doc.plan, '', null, null);
check('PlanDoctrine: every figure has a basis', !unbased.length, unbased.join(', '));
check('PlanDoctrine: every D figure has a source', !unsourced.length, unsourced.join(', '));
for (const k of ['frontage', 'fieldOfFire', 'standoffRows']) {
  const from = doc.plan[k]?.from?.replace(/^OcokaDoctrine\./, '');
  check(`PlanDoctrine: ${k} points at OcokaDoctrine.${from}`, !!from && doc.ocoka[from] != null);
}

// ── the recipes ──────────────────────────────────────────────────────────────────────────────────────────────────
const dir = 'MS/Data/Deployments/Recipes';
const index = json(`${dir}/index.json`);
const listed = index.families.flatMap((f) => f.recipes);
const files = readdirSync(resolve(repo, dir)).filter((f) => f.endsWith('.json') && f !== 'index.json');
check('index.json lists every recipe file', files.every((f) => listed.includes(f.replace(/\.json$/, ''))), files.filter((f) => !listed.includes(f.replace(/\.json$/, ''))).join(', '));
check('index.json names no missing file', listed.every((id) => files.includes(`${id}.json`)), listed.filter((id) => !files.includes(`${id}.json`)).join(', '));

const recipes = [];
for (const f of files) {
  let r;
  try { r = json(`${dir}/${f}`); } catch (e) { check(`${f}: valid JSON`, false, e.message); continue; }
  recipes.push(r);
  const issues = R.validateRecipe(r, { ...ctxBase, file: f });
  const bad = issues.filter((i) => i.level === 'fail');
  for (const i of issues.filter((i) => i.level === 'warn')) { warns++; if (!quiet) console.log(`warn  ${r.id}: ${i.msg}`); }
  check(`${r.id}: valid`, !bad.length, bad.map((i) => i.msg).join('; '));
  const fam = index.families.find((x) => x.recipes.includes(r.id));
  check(`${r.id}: family / task / echelon / unit agree with index.json`, !!fam && fam.id === r.family && fam.task === r.task && fam.echelon === r.echelon && (fam.unit === r.unit || (r.forCoys != null && !!r.unit)));
}
const famIssues = R.validateFamilies(recipes);
check('families agree on task and echelon, no layout twice', !famIssues.length, famIssues.map((i) => i.msg).join('; '));

// Coy slots must be the doctrine Coy size; Pl slots the doctrine Pl frontage (unless a recipe sets its own)
for (const r of recipes) for (const s of r.slots) {
  if (s.echelon === '15' && R.FOOTPRINT_KINDS.includes(s.kind) && s.kind !== 'cpen') {
    const z = R.slotSizeM(doc, s);
    const turned = ((s.turnDeg ?? 0) % 180) === 90;
    check(`${r.id} ${s.role}: Coy posn 1500 x 700 m`, !!z && (turned ? z.hM === 1500 && z.wM === 700 : z.wM === 1500 && z.hM === 700), JSON.stringify(z));
  }
}

// ── the validator catches what it should ─────────────────────────────────────────────────────────────────────────
const two = recipes.find((r) => r.id === 'bn-def-two-up');
const broken = (name, mutate, expect) => {
  const r = structuredClone(two); mutate(r);
  const msgs = R.validateRecipe(r, { ...ctxBase, file: `${two.id}.json` }).filter((i) => i.level === 'fail').map((i) => i.msg);
  check(`catches: ${name}`, msgs.some((m) => expect.test(m)), msgs.join('; ') || 'nothing reported');
};
broken('unknown symbol key', (r) => { r.slots[0].sym = '99999999'; }, /not in Symbols\.json/);
broken('overlapping posns', (r) => { r.slots[1].seed.acrossM = -900; }, /overlap/);
broken('wider than the frontage row', (r) => { r.slots[0].seed.acrossM = -2600; r.slots[1].seed.acrossM = 2600; }, /wider than the row/);
broken('a terrain rule in the geometry rule', (r) => { r.slots[0].rule.prefer = ['itg']; }, /move it into terrainRule/);
broken('a rule naming a missing slot', (r) => { r.slots[2].rule.behind = ['fwdX']; }, /not in the recipe/);
broken('a rule naming a slot placed later', (r) => { r.slots[0].rule.behind = 'depth'; }, /placed later/);
broken('a bad doctrine path', (r) => { r.slots[3].rule.reach.withinMin = { doctrine: 'cpen.nope' }; }, /not in PlanDoctrine/);
broken('an unknown frontage row', (r) => { r.frontageRow = 'Battalion, nine up'; }, /not a row of OcokaDoctrine/);
broken('a posn without a seed', (r) => { delete r.slots[2].seed; }, /needs a seed/);
broken('an alternate of a missing slot', (r) => { r.alternates[0].of = 'nobody'; }, /no such slot/);
broken('id not matching the file', (r) => { r.id = 'bn-def-other'; }, /does not match the file/);
broken('a sub-unit not below the recipe', (r) => { r.slots[0].echelon = '16'; }, /not below/);
broken('an unknown ORBAT unit', (r) => { r.unit = 'inf-bn-nope'; }, /not in the ORBAT/);
broken('forCoys that the slots do not hold (3 for a recipe of four Coys)', (r) => { r.forCoys = 3; }, /forCoys is 3 but the recipe holds ground with 4/);
broken('forCoys not a whole number', (r) => { r.forCoys = 2.5; }, /forCoys 2\.5 is not a whole number/);
{
  // a family may hold a layout once for each Coy count, not twice for the same
  const t3 = recipes.find((r) => r.id === 'bn3-def-two-up');
  check('3-Coy recipes: forCoys 3, the Lt Cdo Bn: Bn Def two up with a reserve, three up with none; Bn Attk right, left, frontal; Bn Crossing two up', recipes.filter((r) => r.forCoys === 3).map((r) => r.id).sort().join() === 'bn3-attk-frontal,bn3-attk-left-flank,bn3-attk-right-flank,bn3-cross-two-up,bn3-def-three-up,bn3-def-two-up' && t3?.unit === 'inf-bn-lt-cdo' && t3.slots.filter((s) => s.kind === 'res').length === 1 && recipes.find((r) => r.id === 'bn3-def-three-up').slots.every((s) => s.kind !== 'res' && s.kind !== 'depth'));
  const a3 = recipes.find((r) => r.id === 'bn3-attk-right-flank');
  check('3-Coy Bn Attk: A and B Coys assault, C Coy the reserve; the BOF is the support weapons (no Coy, not counted)', ['asltL', 'asltR', 'res'].every((x) => a3.slots.find((s) => s.role === x)?.echelon === '15') && a3.slots.find((s) => s.role === 'bofCoy')?.label === 'Sp Wpns' && !a3.slots.find((s) => s.role === 'bofCoy').echelon);
  broken('an attack whose forCoys does not match its Coy symbols (3 for four)', (r) => { Object.assign(r, structuredClone(recipes.find((x) => x.id === 'bn-attk-frontal')), { forCoys: 3, id: 'bn-def-two-up' }); }, /forCoys is 3 but the recipe holds ground with 4/);
  check('families: the same layout once for each Coy count is allowed', !R.validateFamilies(recipes).length);
  const dup = [...recipes, { ...structuredClone(t3), id: 'bn3-def-two-up-b' }];
  check('...but the same layout twice for the same count is caught', R.validateFamilies(dup).some((i) => /same layout twice/.test(i.msg)));
}

console.log(`\n${recipes.length} recipes, ${n} checks, ${fails} failed, ${warns} warnings`);
process.exit(fails ? 1 : 0);
