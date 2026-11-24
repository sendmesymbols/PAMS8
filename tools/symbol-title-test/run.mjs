// run.mjs -- SymbolTitle checks (the name shown when one symbol is selected).
//   node tools/symbol-title-test/run.mjs
// Exit code 1 when a check fails.
import { symbolTitle, echelonWord } from '../../MS/Support/SymbolTitle.ts';

let fails = 0;
let n = 0;
const eq = (label, got, want) => {
  n++;
  if (got !== want) {
    fails++;
    console.log(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
};

// SIDC: 10 | context 0 | SI | set | status | HQ/TF/FD | echelon (2) | entity (6) | mods (4)
const sidc = ({ si = '3', set = '10', status = '0', hq = '0', ech = '00', entity = '121100' } = {}) =>
  `100${si}${set}${status}${hq}${ech}${entity}0000`;

// Units: designation first
eq('16 Inf Div', symbolTitle({ sidc: sidc({ ech: '21' }), name: 'Inf', desig: '16' }).title, '16 Inf Div');
eq('Inf Bn, no desig', symbolTitle({ sidc: sidc({ ech: '16' }), name: 'Inf' }).title, 'Inf Bn');
eq('Inf, no echelon', symbolTitle({ sidc: sidc(), name: 'Inf', desig: '5' }).title, '5 Inf');
eq('qualifier in brackets', symbolTitle({ sidc: sidc({ ech: '16', entity: '121102' }), name: 'Inf - MIB', desig: '26' }).title, '26 Inf Bn (MIB)');
eq('generic base gives way', symbolTitle({ sidc: sidc({ ech: '15', entity: '121300' }), name: 'Land Unit - Recce/Cavalry/Scout', desig: 'A' }).title, 'A Recce/Cavalry/Scout Sqn');

// Regimental arms: Bn level is a Regt, Coy a Sqn / Bty, Pl a Tp
eq('22 Armr Regt (Bn level)', symbolTitle({ sidc: sidc({ ech: '16', entity: '120500' }), name: 'Armr', desig: '22' }).title, '22 Armr Regt');
eq('22 Armr Regt (Regt level)', symbolTitle({ sidc: sidc({ ech: '17', entity: '120500' }), name: 'Armr', desig: '22' }).title, '22 Armr Regt');
eq('Armr Sqn', symbolTitle({ sidc: sidc({ ech: '15', entity: '120500' }), name: 'Armr', desig: 'B' }).title, 'B Armr Sqn');
eq('Armr Tp', echelonWord(sidc({ ech: '14', entity: '120500' })), 'Tp');
eq('Armd Bde stays Bde', echelonWord(sidc({ ech: '18', entity: '120500' })), 'Bde');
eq('Fd Arty Bty', echelonWord(sidc({ ech: '15', entity: '130300' })), 'Bty');
eq('AD Regt', echelonWord(sidc({ ech: '16', entity: '130100' })), 'Regt');
eq('Inf Coy stays Coy', echelonWord(sidc({ ech: '15' })), 'Coy');

// HQ / TF / Dummy
eq('HQ', symbolTitle({ sidc: sidc({ ech: '21', hq: '2' }), name: 'Inf', desig: '16' }).title, 'HQ 16 Inf Div');
eq('TF HQ', symbolTitle({ sidc: sidc({ ech: '18', hq: '6' }), name: 'Inf', desig: '7' }).title, 'HQ 7 Inf Bde (TF)');
eq('Dummy', symbolTitle({ sidc: sidc({ ech: '16', hq: '1' }), name: 'Inf', desig: '3' }).title, '3 Inf Bn (Dummy)');

// Control measures: name first, echelon in brackets
eq('Battle Posn A (Coy)', symbolTitle({ sidc: sidc({ set: '25', ech: '15', entity: '151200' }), name: 'Battle Posn', desig: 'A' }).title, 'Battle Posn A (Coy)');
eq('Battle Posn, bare', symbolTitle({ sidc: sidc({ set: '25', entity: '151200' }), name: 'Battle Posn' }).title, 'Battle Posn');
eq('control measure keeps its dash name', symbolTitle({ sidc: sidc({ set: '25' }), name: 'Arty DF/Grid Origin', desig: 'AB 1001' }).title, 'Arty DF/Grid Origin AB 1001');
eq('control measure never Regt', symbolTitle({ sidc: sidc({ set: '25', ech: '16', entity: '120500' }), name: 'Bdy' }).title, 'Bdy (Bn)');

// Side, planned, higher formation
const en = symbolTitle({ sidc: sidc({ si: '6', ech: '21', status: '1' }), name: 'Inf', desig: '16', higher: '1 Corps' });
eq('en side', en.side, 'en');
eq('en sub', en.sub, 'En · Planned · of 1 Corps');
eq('own sub', symbolTitle({ sidc: sidc(), name: 'Inf' }).sub, 'Own');
eq('neutral', symbolTitle({ sidc: sidc({ si: '4' }), name: 'Inf' }).side, 'neutral');

// Fallbacks: no SIDC / bad SIDC / no name / echelon from drawEssentials
eq('no sidc', symbolTitle({ name: 'Freehand Area', desig: 'X' }).title, 'Freehand Area X');
eq('no name', symbolTitle({}).title, 'Symbol');
eq('no sidc no side', symbolTitle({ name: 'Inf' }).side, null);
eq('echelon fallback', echelonWord('100310000000000000000', '18'), 'Bde');
eq('mobility is not an echelon', echelonWord(sidc({ set: '15', ech: '31', entity: '110904' })), null);
eq('whitespace trimmed', symbolTitle({ sidc: sidc({ ech: '21' }), name: ' Inf ', desig: '  16  ' }).title, '16 Inf Div');
eq('numeric desig', symbolTitle({ sidc: sidc({ ech: '21' }), name: 'Inf', desig: 16 }).title, '16 Inf Div');

console.log(`${n - fails} / ${n} checks pass`);
process.exit(fails ? 1 : 0);
