// frontage.mjs -- checks for the objective's frontage and the assault frontage by side, echelon and ground
// (GroundGuideFrontage.ts; OcokaDoctrine frontage.rows / frontage.objective).  node tools/ipb-test/frontage.mjs
// Every figure is a book's: the checks name the book and page they expect. Exit code 1 when a check fails.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
register('../movement-test/hooks.mjs', import.meta.url);
const F = await import('../../MS/Engines/GroundGuide/GroundGuideFrontage.ts');
const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(readFileSync(resolve(here, '../../MS/Data', f), 'utf8'));
const oc = read('OcokaDoctrine.json'), tpl = read('IpbTemplates.json'), plan = read('PlanDoctrine.json');
let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
}

// ── the ground at the objective (synthetic 30 m grids, 400 x 400 px = 12 km; the objective in the middle, its front north) ──
const N = 400, RES = 30;
const grid = (paint) => { const g = { w: N, h: N, res: RES, cls: new Uint8Array(N * N).fill(2), elev: new Float32Array(N * N).fill(200) }; if (paint) paint(g); return g; };
const T = F.groundTestsFrom(oc, tpl);
const at = (g) => F.groundKindAt(g, 200, 200, [0, -1], 4000, T);
check('flat farmland: plains', at(grid()).kind === 'plains', at(grid()).why);
const hill = grid((g) => { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) g.elev[y * N + x] = 200 + Math.max(0, 450 - Math.hypot(x - 260, y - 200) * 3); });
check('the ground within 5 km rises 450 m: mountains (IpbTemplates mountainTest, 400 m)', at(hill).kind === 'mountain' && /rises 4\d\d m/.test(at(hill).why), at(hill).why);
const canal = (y0) => grid((g) => { for (let x = 0; x < N; x++) for (let y = y0; y < y0 + 2; y++) g.cls[y * N + x] = 20; });
check('a canal 600 m in front, all along the front: an obstacle', at(canal(180)).kind === 'obstacle' && /100 %/.test(at(canal(180)).why), at(canal(180)).why);
check('the same canal 600 m behind it: not an obstacle in front', at(canal(220)).kind === 'plains', at(canal(220)).why);
check('a canal 2 km in front: beyond 1.5 km, not an obstacle', at(canal(132)).kind === 'plains', at(canal(132)).why);
const dunes = grid((g) => g.cls.fill(14));
check('dunes all round: desert (IpbTemplates desertTest)', at(dunes).kind === 'desert', at(dunes).why);
const dunesHill = grid((g) => { g.cls.fill(14); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) g.elev[y * N + x] = 200 + Math.max(0, 450 - Math.hypot(x - 260, y - 200) * 3); });
check('dunes on a 450 m rise: mountains first (the order of PlanDoctrine terrain.detect)', at(dunesHill).kind === 'mountain');
const O = plan.terrain.detect.obstacle;
check('the obstacle test has the same figures as PlanDoctrine terrain.detect.obstacle', JSON.stringify(T.obstacle.classes) === JSON.stringify(O.classes) && T.obstacle.share === O.share && T.obstacle.withinM === O.withinM, JSON.stringify(T.obstacle));

// ── the objective's frontage: own ──
const of = (whose, ech, kind, size = 'mid') => F.objectiveFrontage(oc, whose, ech, kind, size);
const bnP = of('own', '16', 'plains');
check('own Bn, plains: 3000-5000 m, mid 4 km x 2.5 km (IBB S53 para 4 c p 277)', bnP.frontageM === 4000 && bnP.depthM === 2500 && /IBB S53 para 4 c pp 276-277/.test(bnP.src) && /IBB S53 para 4 c p 277/.test(bnP.why), F.objectiveLine(bnP));
const bnD = of('own', '16', 'desert'), bnM = of('own', '16', 'mountain');
check('own Bn, desert: extended, IBB Annex U App 6 two up 4500 m (DW p 24, p 56)', bnD.frontageM === 4500 && /App 6/.test(bnD.src) && /DW p 24, p 56/.test(bnD.why), F.objectiveLine(bnD));
check('own Bn, mountains: extended, IBB two up 4500 m (MW p 148, p 150), never the Foxland 6-8 km', bnM.frontageM === 4500 && /MW p 148, p 150/.test(bnM.why) && !/Foxland|Mountain infantry/.test(bnM.row), F.objectiveLine(bnM));
const bnO = of('own', '16', 'obstacle');
check('own Bn on a canal: IBB Annex V 2750-4115 m, depth 1830-2750 m (x = yards)', Math.round(bnO.frontageM) === 3433 && bnO.depthM === 2290 && /Annex V p 483/.test(bnO.src), F.objectiveLine(bnO));
const coys = ['plains', 'desert', 'mountain', 'obstacle'].map((k) => of('own', '15', k));
check('own Coy: 1200-1500 m on every ground, never extended (AMP p 1.10; IBB S59 para 6 b p 326)', coys.every((c) => c.frontageM === 1350 && c.depthM === 700 && /AMP p 1\.10/.test(c.src) && /IBB S59 para 6 b p 326/.test(c.why)), coys.map((c) => c.frontageM).join(', '));
check('own Pl: IBB Annex U App 5 600 m on every ground, not extended', ['plains', 'desert'].every((k) => of('own', '14', k).frontageM === 600 && /App 5/.test(of('own', '14', k).src)));
check('own Bde: 10-12 km (OOW1); on a ditch cum bund 8-10 km (GSP s26 p 119)', of('own', '18', 'plains').frontageM === 11000 && of('own', '18', 'obstacle').frontageM === 9000 && /GSP 1947 s26/.test(of('own', '18', 'obstacle').src), `${of('own', '18', 'plains').frontageM} / ${of('own', '18', 'obstacle').frontageM}`);
check('the size setting picks the low or high figure', of('own', '16', 'plains', 'min').frontageM === 3000 && of('own', '16', 'plains', 'max').frontageM === 5000);
check('no echelon: no frontage (the guide keeps its taken one and says so)', of('own', null, 'plains') === null);

// ── the objective's frontage: the enemy's own figures ──
const enC = of('en', '15', 'plains'), enBo = of('en', '16', 'obstacle'), enBm = of('en', '16', 'mountain'), enBp = of('en', '16', 'plains');
check('En Coy: 650-1000 m, depth 300 m (IDD p 3)', enC.frontageM === 825 && enC.depthM === 300 && /IDD p 3/.test(enC.src), F.objectiveLine(enC));
check('En Bn on the bund: two up 2000-3000 m, depth 900 m (IDD p 3)', enBo.frontageM === 2500 && enBo.depthM === 900, F.objectiveLine(enBo));
check('En Bn in mountains: 6000-8000 m (IC s113, Foxland)', enBm.frontageM === 7000 && /Foxland/.test(enBm.src + enBm.why), F.objectiveLine(enBm));
check('En Bn in the plains: 3000 m x 2000 m (IC s113 p 658, Foxland)', enBp.frontageM === 3000 && enBp.depthM === 2000 && /Foxland/.test(enBp.src), F.objectiveLine(enBp));
const enBde = of('en', '18', 'plains');
check('En Bde off the bund: no En figure printed, the own row stands in and says so', enBde.standIn && /stands in/.test(enBde.why), F.objectiveLine(enBde));
check('En Div on an obstacle: 60-80 km (IC s113 p 658, frontageObstacleM)', of('en', '21', 'obstacle').frontageM === 70000);

// ── the mapping: own rows are never the enemy's, every row cites a book ──
const rowsBy = new Map(oc.frontage.rows.map((r) => [r.unit, r]));
const named = (block) => Object.entries(block).filter(([k]) => /^\d+$/.test(k)).flatMap(([, by]) => Object.values(by).map((v) => (typeof v === 'string' ? v : v.row)));
const ownRows = [...named(oc.frontage.objective.own), ...named(oc.frontage.objective.assault.own)];
const allRows = [...ownRows, ...named(oc.frontage.objective.en), ...named(oc.frontage.objective.assault.en)];
check('every row the mapping names exists and cites a book', allRows.every((u) => rowsBy.has(u) && /(IBB|AMP|GSP|IDD|IC|OoW|OOW|DW|MW)\b/.test(rowsBy.get(u).src)), allRows.filter((u) => !rowsBy.has(u)).join(', '));
check('no own row is an enemy row (En ..., or IC s113 / s114 Foxland)', ownRows.every((u) => !/^En /.test(u) && !/^IC s11[34]/.test(rowsBy.get(u).src)), ownRows.join(' | '));
check('the calc night rows from GSP are gone (IBB p 248 printed instead)', !rowsBy.has('Battalion, night attack in plains (half a brigade two up)') && !rowsBy.has('Company, night attack in plains (half a battalion two up)'));

// ── the assault frontage by night and by day ──
const as = (whose, ech, kind) => F.assaultFrontage(oc, whose, ech, kind);
const coyP = as('own', '15', 'plains');
check('own Coy assault: 250 m by night (IBB S47 para 17 a p 248); by day wider, no figure (OOW2 s9 para 2 c p 36)', coyP.nightM[0] === 250 && coyP.nightM[1] === 250 && /IBB S47 para 17 a p 248/.test(coyP.src) && /OOW2 s9 para 2 c p 36/.test(coyP.day), F.assaultLine(coyP));
const bnA = as('own', '16', 'plains');
check('own Bn two up: 450-650 m by night (IBB p 248)', bnA.nightM[0] === 450 && bnA.nightM[1] === 650, F.assaultLine(bnA));
check('desert by day: twice the night (DW s12 para 18 a p 47)', /DW s12 para 18 a p 47/.test(as('own', '16', 'desert').day));
check('mountains: narrower, not specified (MW p 79; GSP p 86-87)', /MW p 79/.test(as('own', '16', 'mountain').day) && /GSP s19 para 12 a p 86/.test(as('own', '16', 'mountain').day));
check('own Bde in the desert: 3000-4000 m (GSP s19 para 12 e p 87); in the plains 1100-1500 m by night (GSP p 86)', as('own', '18', 'desert').nightM[1] === 4000 && as('own', '18', 'plains').nightM[1] === 1500);
const enA = as('en', F.echelonUp('14'), 'plains');
check('his assault onto your Pl: his Coy, 60-200 m by night (IC s114 p 684), no day figure printed', enA.ech === '15' && enA.nightM[0] === 60 && enA.nightM[1] === 200 && /IC s114 p 684/.test(enA.src) && /none is printed/.test(enA.day), F.assaultLine(enA));
const enBdeA = as('en', F.echelonUp('16'), 'plains');
check('his assault onto your Bn: no En Bde figure printed, the 400 m of his Bn stands in and says so (IC s114 p 684)', enBdeA.ech === '16' && enBdeA.nightM[1] === 400 && /No En Bde assault frontage is printed/.test(F.assaultLine(enBdeA)), F.assaultLine(enBdeA));
check('own Div attack: no Div figure printed, the Bde row stands in', as('own', '21', 'plains')?.ech === '18' && !!as('own', '21', 'plains')?.standIn);
check('a range reads in one unit: 60-200 m, 3-4 km', / 60-200 m /.test(F.assaultLine(enA)) && / 3-4 km /.test(F.assaultLine(as('own', '18', 'desert'))), F.assaultLine(as('own', '18', 'desert')).slice(0, 60));
check('the lines for the Detail carry the row, book and page', /IBB S53 para 4 c/.test(F.objectiveLine(bnP)) && /IBB S47 para 17 a p 248/.test(F.assaultLine(coyP)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
