// mtnwxtext.mjs -- checks that the mountain weather notes (IpbWxView.mtn, MW pp 9-10, 69-71, 229-230, 288-289, 298) reach
// the tab 3 Copy as Text once, with their pages, and that an area off the mountains writes no such line.
//   node tools/ipb-test/mtnwxtext.mjs        Exit code 1 when a check fails.
import { register } from 'node:module';

register('../movement-test/hooks.mjs', import.meta.url);
const V = await import('../../MS/Engines/GroundGuide/GroundGuideIpbApchView.ts');

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
}

const view = (wx) => ({
  side: 'enemy', aaFor: 'Bn', hqLabel: 'Bde HQ', mcFor: 'Coy', mcWidthM: 500, spacingM: 2000, frameKm: [14, 28], mover: 'dismounted', axisDeg: 0,
  apchEnd: 'through', objective: null, obstacles: [], aas: [], crossovers: [], notes: [], wx,
});
const notes = [
  { id: 'fog', for: ['fire', 'mnvr', 'air'], text: 'Fog lies thick in the valleys, nullahs and river beds early in the morning and clears with the sun by about 0900-1000 (MW p 229).' },
  { id: 'flashFloods', for: ['mnvr'], text: 'Flash floods in the nullahs and rivers (MW p 9): keep clear of the nullah beds after rain.' },
];
const mtn = V.apchText({ ipbApch: view({ month: 1, rows: [], mtn: { elevM: 2600, notes } }) });
const lines = mtn.filter((l) => /^Mountain weather/.test(l));
check('the mountain weather notes reach Copy as Text in one line, the month and the height named', lines.length === 1 && /^Mountain weather, Jan, about 2600 m \(notes, not coded\):/.test(lines[0]), lines.join(' | '));
check('...each note with its MW page, once', /\(MW p 229\)/.test(lines[0]) && /\(MW p 9\)/.test(lines[0]) && (lines[0].match(/MW p 229/g) || []).length === 1, lines[0]);
const plains = V.apchText({ ipbApch: view({ month: 1, rows: [], mtn: null }) });
check('off the mountains (no notes): no such line', !plains.some((l) => /^Mountain weather/.test(l)));
check('no weather read at all: no such line', !V.apchText({ ipbApch: view(undefined) }).some((l) => /^Mountain weather/.test(l)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
