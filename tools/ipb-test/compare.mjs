// compare.mjs -- checks for own attack, left against right (GroundGuideIpbCompare.ts).  node tools/ipb-test/compare.mjs
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
register('../movement-test/hooks.mjs', import.meta.url);
const { compareLeftRight } = await import('../../MS/Engines/GroundGuide/GroundGuideIpbCompare.ts');
const here = dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(readFileSync(resolve(here, '../../MS/Data/IpbDoctrine.json'), 'utf8'));
let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
}
const factors = doc.ownAttack.factors;
const ap = (id, onto, o = {}) => ({ id, onto, lengthM: 8000, goPct: 95, narrows: 0, assaultM: 1100, assaultNogoPct: 0, sideM: onto === 'left' ? -2000 : onto === 'right' ? 2000 : 0, fire: { coveredPct: 20, seenPct: 40, atFup: 'd' }, ...o });
const run = (apchs, o = {}) => compareLeftRight({ apchs, factors, chokeSideM: null, fupM: 1100, ...o });

check('the doctrine lists eight factors with weights 0-3 (IC s15.12 b)', factors.length === 8 && factors.every((f) => f.weight >= 0 && f.weight <= 3));
{
  const r = run([ap('A', 'left'), ap('B', 'right'), ap('C', 'frontal')]);
  check('equal approaches: left and right level, frontal shown for reference', r.best === null && r.sides[0].score === r.sides[1].score && r.sides[2].score !== null && r.notes.some((n) => /reference/.test(n)), `${r.sides.map((s) => `${s.side} ${s.score}`).join(', ')}`);
}
{
  // The right approach is under his fire on the way and at the FUP: left wins.
  const r = run([ap('A', 'left'), ap('B', 'right', { fire: { coveredPct: 70, seenPct: 90, atFup: 'c' } }), ap('C', 'frontal')]);
  check('a right approach under his fire on the way and at the FUP loses to the left', r.best === 'left' && r.marginPts >= 10, `left ${r.sides[0].score} right ${r.sides[1].score}`);
  check('the frontal approach never gets the MSR credit, so with the same fire it scores below the flank', r.sides[2].cells.msr.v === 0 && r.sides[2].score < r.sides[0].score, `frontal ${r.sides[2].score} left ${r.sides[0].score}`);
}
{
  // The turning approach goes round the right to the MSR choke: the right side credits the MSR factor.
  const r = run([ap('A', 'left'), ap('B', 'right'), ap('T', 'turn', { sideM: 3000 })], { chokeSideM: 2500 });
  check('the MSR choke reached round the right credits the right', r.best === 'right' && r.sides[1].cells.msr.v === 1 && r.sides[0].cells.msr.v < 1, `left ${r.sides[0].score} right ${r.sides[1].score}`);
}
{
  // The user's weights: the MSR factor set to 0 removes its credit.
  const r = run([ap('A', 'left'), ap('B', 'right'), ap('T', 'turn', { sideM: 3000 })], { chokeSideM: 2500, weights: { msr: 0 } });
  check("the user's weight 0 on a factor takes it out", r.best === null && r.factors.find((f) => f.id === 'msr').w === 0);
}
{
  const r = run([ap('A', 'left')]);
  check('one side only: no decision, a note', r.best === null && r.sides[1].score === null && r.notes.some((n) => /No right/.test(n)));
  const u = run([ap('A', 'left', { fire: null }), ap('B', 'right', { fire: null })]);
  check('his fire not read: the fire factors score 0.5 both sides and are marked unread', u.sides[0].cells.route.unread && u.sides[0].cells.route.v === 0.5 && u.notes.some((n) => /never decides/.test(n)));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
