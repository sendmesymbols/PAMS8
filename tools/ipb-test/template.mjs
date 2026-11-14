// template.mjs -- checks for the IPB situation templates (GroundGuideIpbTemplate.ts, MS/Data/IpbTemplates.json).
//   node tools/ipb-test/template.mjs
// Synthetic codings with a known answer: elements on open ground stay; tanks in a swamp move to GO; guns on a hilltop
// move off it; a known enemy symbol takes an element's place and is not moved; crossings, bridgeheads, a missing second
// avenue, outside the area, a defence template beyond the FDL, the auto pick. Exit code 1 when a check fails.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
register('../movement-test/hooks.mjs', import.meta.url);
const { layTemplate, pickTemplate, tplRulesFrom, templatesFrom } = await import('../../MS/Engines/GroundGuide/GroundGuideIpbTemplate.ts');

const here = dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(readFileSync(resolve(here, '../../MS/Data/IpbTemplates.json'), 'utf8'));
const rules = tplRulesFrom(doc);
let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
}
// 600 x 600 cells of 30 m (18 km square), flat at 200 m, GO for every mover.
const N = 600, RES = 30;
function grid(paint) {
  const elev = new Float32Array(N * N).fill(200), cls = new Uint8Array(N * N);
  const codes = { armour: new Uint8Array(N * N), mech: new Uint8Array(N * N), dismounted: new Uint8Array(N * N) };
  if (paint) paint({ elev, cls, codes });
  return { grid: { z: 12, ts: 256, tx0: 0, ty0: 0, nx: 1, ny: 1, w: N, h: N, px0: 0, py0: 0, res: RES, elev, cls, bld: null, pending: false }, codes };
}
// The enemy comes from the north (y = 0) south toward the position at (300, 520): avenue A at x = 300, B at x = 420.
const aa = (id, rank, x, narrows = []) => ({ id, rank, viable: true, pts: [[x, 5], [x, 595]], alongM: [0, 590 * RES], narrows });
const T = (id) => templatesFrom(doc).find((t) => t.id === id);
function run(g, o = {}) {
  return layTemplate({
    grid: g.grid, ox: 0, oy: 0, w: N, h: N, codes: g.codes, res: RES,
    aas: [aa('A', 1, 300), aa('B', 2, 420)], objective: { x: 300, y: 520 }, depth: { x: 300, y: 580 }, fdl: null,
    known: [], template: T('idp-bde'), rules, ...o,
  });
}
const el = (r, id) => r.elements.find((e) => e.id === id);

{
  const r = run(grid());
  const fup = el(r, 'fup');
  check('open ground: every element stays where doctrine puts it', r.moved === 0 && r.elements.every((e) => ['ok', 'fixed', 'none'].includes(e.status)), r.elements.map((e) => `${e.id}:${e.status}`).join(' '));
  check('the FUP is 1.1 km short of the objective on Apch A (IBB p 203)', Math.abs((520 - fup.y) * RES - 1100) < 40 && Math.abs(fup.x - 300) < 1, `${((520 - fup.y) * RES).toFixed(0)} m`);
  check('the two assault Bn gps are 600 m either side of the axis', Math.abs(el(r, 'a1').x - (300 + 20)) < 1 && Math.abs(el(r, 'a2').x - (300 - 20)) < 1, `${el(r, 'a1').x.toFixed(1)} / ${el(r, 'a2').x.toFixed(1)}`);
  check('the supporting attack is on Apch B', Math.abs(el(r, 'sp').x - 420) < 1);
  check('objectives are fixed at the position and the depth', el(r, 'obj1').status === 'fixed' && el(r, 'obj2').status === 'fixed' && el(r, 'obj2').y === 580);
  check('no water crossing on Apch A: the crossing site has no place', el(r, 'xing').status === 'none', el(r, 'xing').why);
}
{
  // A swamp (NO-GO for armour) round the armour's place, 3 km short of the objective: it moves out to GO.
  const r = run(grid(({ codes }) => { for (let y = 380; y < 450; y++) for (let x = 250; x < 350; x++) codes.armour[y * N + x] = 2; }));
  const cg = el(r, 'cg');
  check('tanks in a swamp are moved to the nearest GO', cg.status === 'moved' && cg.movedM > 0 && cg.movedM <= 3000, cg.why);
  check('... and where they end up is not NO-GO for armour', (() => { const xi = Math.floor(cg.x), yi = Math.floor(cg.y); return !(yi >= 380 && yi < 450 && xi >= 250 && xi < 350) || cg.nogoPct <= 25; })(), `${cg.x.toFixed(0)},${cg.y.toFixed(0)}`);
  check('the infantry FUP beside the swamp is not moved (the swamp is NO-GO for armour only)', el(r, 'fup').status === 'ok');
}
{
  // The gun area on a 60 m hill: moved off the hilltop.
  const g = grid(({ elev }) => { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const d = Math.hypot(x - 233, y - 220) * RES; if (d < 900) elev[y * N + x] = 260 - d / 15; } });
  const r = run(g);
  const gun = el(r, 'guns');
  check('guns on a hilltop are moved off it (book p 23)', gun.status === 'moved' && /hilltop/.test(gun.why), `${gun.why} · doc ${gun.doc.map((v) => v.toFixed(0))}`);
}
{
  // A known enemy armour regt 800 m from the armour's place, on NO-GO: it takes the place and is not moved.
  const g = grid(({ codes }) => { for (let y = 390; y < 420; y++) for (let x = 320; x < 340; x++) codes.armour[y * N + x] = 2; });
  const r = run(g, { known: [{ x: 327, y: 405, mover: 'armour', label: 'En armr regt' }] });
  const cg = el(r, 'cg');
  check('a known enemy symbol takes the element\'s place and is never moved', cg.status === 'known' && cg.x === 327 && cg.y === 405, cg.why);
  const r2 = run(grid(), { known: [{ x: 327, y: 405, mover: 'gun', label: 'En guns' }] });
  check('... but only one of its kind (guns do not stand in for tanks)', el(r2, 'cg').status === 'ok');
}
{
  // Only one avenue: the supporting attack goes beside it, with a note.
  const r = run(grid(), { aas: [aa('A', 1, 300)] });
  const sp = el(r, 'sp');
  check('no second avenue: the supporting attack is placed beside the first, said so', Math.abs(sp.x - 300) > 40 && r.notes.some((n) => /No Apch 2/.test(n)), `${sp.x.toFixed(0)} · ${r.notes[0]}`);
}
{
  // A canal crossing on Apch A 8 km in: the crossing site sits on it; the strike bridgehead box is 6 x 8 km beyond it.
  const nar = [{ x: 300, y: 272, alongM: 267 * RES, kind: 'crossing' }];
  const r = run(grid(), { aas: [aa('A', 1, 300, nar), aa('B', 2, 420, [{ x: 420, y: 300, alongM: 295 * RES, kind: 'crossing' }])] });
  check('the crossing site is at the first water crossing on Apch A', el(r, 'xing').status === 'fixed' && el(r, 'xing').y === 272);
  const g = grid(({ codes }) => { for (let y = 272; y < 360; y++) for (let x = 200; x < 300; x++) codes.mech[y * N + x] = 2; });
  const b = run(g, { template: T('strike-bh'), aas: [aa('A', 1, 300, nar), aa('B', 2, 420, [{ x: 420, y: 300, alongM: 295 * RES, kind: 'crossing' }])] });
  const bh = el(b, 'bh1');
  const bw = Math.hypot(bh.box[1][0] - bh.box[0][0], bh.box[1][1] - bh.box[0][1]) * RES, bdp = Math.hypot(bh.box[3][0] - bh.box[0][0], bh.box[3][1] - bh.box[0][1]) * RES;
  check('a strike bridgehead is 6 km wide and 8 km deep beyond the crossing (OoW II s14)', Math.abs(bw - 6000) < 5 && Math.abs(bdp - 8000) < 5 && bh.box[3][1] > bh.box[0][1], `${bw.toFixed(0)} x ${bdp.toFixed(0)} m`);
  check('... with its NO-GO share for mech said', bh.nogoPct > 15 && /NO-GO/.test(bh.why), bh.why);
  check('the break-out Armd Div waits 20 km short of the crossing (outside the area: placed, not judged)', el(b, 'armd').status === 'outside', el(b, 'armd').why);
}
{
  // A defence template: the forward Coys on the FDL, the main Bn 4 km beyond it along the own avenue.
  const own = [{ id: 'A', rank: 1, viable: true, pts: [[300, 595], [300, 5]], alongM: [0, 590 * RES], narrows: [] }];
  const r = run(grid(), { template: T('def-bde'), aas: own, objective: { x: 300, y: 300 }, fdl: { x: 300, y: 350 } });
  const main = el(r, 'main');
  check('defence template: the forward localities on the FDL', Math.abs(el(r, 'fwd1').y - 350) < 1);
  check('... the main defences 4 km beyond the FDL, deeper in the enemy\'s ground', Math.abs((350 - main.y) * RES - 4000) < 40, `${((350 - main.y) * RES).toFixed(0)} m`);
}
{
  check('auto pick: defence + Bde HQ -> IDP op by a Bde CC', pickTemplate(doc, { readFor: 'defence', hq: 'bde' })?.id === 'idp-bde');
  check('auto pick: defence + Div HQ -> DSF op by a Div-size BG', pickTemplate(doc, { readFor: 'defence', hq: 'div' })?.id === 'dsf-div');
  check('auto pick: mountains -> Mtn Div attack', pickTemplate(doc, { readFor: 'defence', hq: 'bde', mountain: true })?.id === 'mtn-attk');
  check('auto pick: own attack + Bde -> the enemy Inf Bde defence', pickTemplate(doc, { readFor: 'attack', hq: 'bde' })?.id === 'def-bde');
  check('a named template is used as asked', pickTemplate(doc, { readFor: 'defence', hq: 'bde', want: 'strike-bh' })?.id === 'strike-bh');
  check('the Fig 6 and Fig 7 readings are marked unconfirmed', doc.confirmations?.fig6?.confirmed === false && doc.confirmations?.fig7?.confirmed === false);
  const all = templatesFrom(doc);
  check('every template element has a basis and every D figure a source', all.every((t) => t.elements.every((e) => e.basis && (e.basis === 'E' || e.src || t.src))), `${all.length} templates`);
}
{
  const t = performance.now();
  for (let i = 0; i < 10; i++) run(grid(({ codes }) => { for (let y = 380; y < 450; y++) for (let x = 250; x < 350; x++) codes.armour[y * N + x] = 2; }));
  const ms = (performance.now() - t) / 10;
  check('a template with a moved element in under 120 ms', ms < 120, `${ms.toFixed(0)} ms each`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
