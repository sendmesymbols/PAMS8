// airspace.mjs -- checks for the airspace control measures and gun-target lines over the air avenues
// (GroundGuideIpbAirspace.ts).   node tools/ipb-test/airspace.mjs
// Synthetic flights north on a flat plane (k = 1: Mercator units are metres), zones and guns with a known answer.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
register('../movement-test/hooks.mjs', import.meta.url);
const { airspaceRead, airspaceRulesFrom, zoneEffect } = await import('../../MS/Engines/GroundGuide/GroundGuideIpbAirspace.ts');

const here = dirname(fileURLToPath(import.meta.url));
const doctrine = JSON.parse(readFileSync(resolve(here, '../../MS/Data/IpbDoctrine.json'), 'utf8'));
const rules = airspaceRulesFrom(doctrine);
let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
}
const sq = (cx, cy, half) => [[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half]];
const north = (id, x, L = 8000) => ({ id, rank: Number(id), to: 'LZ 1', line: [[x, 0], [x, L]], lengthM: L });

check('rules: 13 airspace symbol codes, PAA range 14,596 m, near 500 m', Object.keys(rules.symbols).length === 13 && rules.gtl.paaRangeM === 14596 && rules.gtl.nearM === 500);

{
  // Own flight: own ROZ over 2 km of Air 1 (25 %), own ACA over 1 km of Air 2, his MEZ over 1 km of Air 2, his ROZ off every route.
  const r = airspaceRead({
    side: 'own', k: 1, rules,
    routes: [north('1', 0), north('2', 2000), north('3', -4000)],
    zones: [
      { id: 'z1', key: '25171000', label: 'ROZ 1', side: 'own', ring: sq(0, 3000, 1000) },
      { id: 'z2', key: '25251002', label: 'ACA 1', side: 'own', ring: sq(2000, 6000, 500) },
      { id: 'z3', key: '25171600', label: 'MEZ 1', side: 'enemy', ring: sq(2000, 1000, 500) },
      { id: 'z4', key: '25171000', label: 'ROZ 2', side: 'enemy', ring: sq(6000, 4000, 500) },
      { id: 'z5', key: '25140100', label: 'not airspace', side: 'own', ring: sq(0, 1000, 500) },
    ],
    guns: [], targets: [],
  });
  const z1 = r.zones.find((z) => z.id === 'z1'), z2 = r.zones.find((z) => z.id === 'z2'), z3 = r.zones.find((z) => z.id === 'z3'), z4 = r.zones.find((z) => z.id === 'z4');
  check('a symbol that is not an airspace measure is left out', r.zones.length === 4 && !r.zones.some((z) => z.id === 'z5'));
  check('own ROZ on own flight: restricted, Air 1 25 % inside from 2 km out', !!z1 && z1.effect === 'restricted' && z1.routes.length === 1 && z1.routes[0].id === '1' && Math.abs(z1.routes[0].pct - 25) <= 1 && Math.abs(z1.routes[0].alongM - 2000) <= 60, z1 ? JSON.stringify(z1.routes) : 'none');
  check('own ACA on own flight: safe, Air 2 about 12 %', !!z2 && z2.effect === 'safe' && z2.routes[0]?.id === '2' && Math.abs(z2.routes[0].pct - 12.5) <= 1.5);
  check('his MEZ on own flight: a threat', !!z3 && z3.effect === 'threat' && z3.routes[0]?.id === '2');
  check("his ROZ: his measure, binds nobody, no avenue inside", !!z4 && z4.effect === 'his' && z4.routes.length === 0);
  check('zones ranked restricted, threat first', r.zones[0].effect === 'restricted' && r.zones[1].effect === 'threat');
  const a1 = r.routes.find((x) => x.id === '1'), a2 = r.routes.find((x) => x.id === '2'), a3 = r.routes.find((x) => x.id === '3');
  check('Air 1 per-avenue: restricted 25 %, text names ROZ 1', !!a1 && Math.abs(a1.pct.restricted - 25) <= 1 && /ROZ 1 2[45] % restricted/.test(a1.text), a1?.text);
  check('Air 2: safe and threat shares, no restricted', !!a2 && a2.pct.restricted === 0 && a2.pct.safe > 10 && a2.pct.threat > 10, a2?.text);
  check('Air 3: clear', !!a3 && a3.text === 'clear of the measures and lines drawn');
  const touch = airspaceRead({ side: 'own', k: 1, rules, routes: [north('1', 0)], zones: [{ id: 't', key: '25171000', label: 'ROZ T', side: 'own', ring: sq(0, 4000, 30) }], guns: [], targets: [] });
  check('a 60 m touch of an 8 km avenue reads 1 %, never 0', touch.zones[0].routes[0]?.pct === 1 && touch.routes[0].pct.restricted === 1, JSON.stringify(touch.zones[0].routes));
  check('no guns: a note says no gun-target line, no GTL', r.gtls.length === 0 && r.notes.some((n) => /No own gun area/.test(n)));
  check('the sources are FM 3-09 pages', z1.src.includes('B-27') && z2.src.includes('B-9'));
}
{
  // Own flight with own guns: a PAA at (-3000, 2000) and the Obj at (3000, 6000): the line crosses Air 1 (x = 0) at y = 4000.
  const r = airspaceRead({
    side: 'own', k: 1, rules,
    routes: [north('1', 0), north('2', 2000), north('3', -4000), north('4', -3400)],
    zones: [],
    guns: [
      { id: 'paa-1', label: 'PAA 1', at: [-3000, 2000], minM: 1500, maxM: 14596, kind: 'paa' },
      { id: 'gun-1', label: 'Mor', at: [-3000, 2200], minM: 100, maxM: 4550, kind: 'unit' },
      { id: 'gun-2', label: 'Fd Arty', at: [-3000, 7900], minM: 1500, maxM: 14596, kind: 'unit' },
    ],
    targets: [
      { id: 'obj', label: 'Obj', at: [3000, 6000], kind: 'objective' },
      { id: 'posn-1', label: 'En Coy', at: [-3000, 8000], kind: 'posn' },
    ],
  });
  const g1 = r.gtls.find((g) => g.gun === 'PAA 1' && g.target === 'Obj');
  check('PAA → Obj is a gun-target line of 7.2 km', !!g1 && Math.abs(g1.lengthM - 7211) <= 2, g1 ? `${g1.lengthM}` : 'none');
  const c1 = g1?.crossings.find((c) => c.route === '1');
  check('Air 1 crosses it 4.0 km out, 3.6 km from the guns', !!c1 && Math.abs(c1.alongRouteM - 4000) <= 5 && Math.abs(c1.fromGunM - 3606) <= 5 && Math.abs(c1.at[1] - 4000) <= 5, c1 ? JSON.stringify(c1) : 'none');
  const c2 = g1?.crossings.find((c) => c.route === '2');
  check('Air 2 crosses it at y = 5,333', !!c2 && Math.abs(c2.at[1] - 5333) <= 5);
  check('Air 3 (west of the guns) neither crosses nor is near', !!g1 && !g1.crossings.some((c) => c.route === '3') && !g1.near.some((c) => c.route === '3'));
  check('Air 4, 400 m west of the guns, is near the line (within 500 m)', !!g1 && g1.near.some((c) => c.route === '4' && c.distM <= 500 && c.distM >= 300), JSON.stringify(g1?.near));
  check('the mortar (max 4,550 m) reaches no target: no line from it', !r.gtls.some((g) => g.gun === 'Mor'));
  check('Fd Arty 100 m from the En Coy: inside its minimum range, no line; it reaches the Obj', !r.gtls.some((g) => g.gun === 'Fd Arty' && g.target === 'En Coy') && r.gtls.some((g) => g.gun === 'Fd Arty' && g.target === 'Obj'));
  check('lines are numbered nearest pair first', r.gtls[0].n === 1 && r.gtls.every((g, i) => g.n === i + 1) && r.gtls[0].lengthM <= r.gtls[r.gtls.length - 1].lengthM);
  const a1 = r.routes.find((x) => x.id === '1');
  check('Air 1 text: crosses GTL n (PAA 1 → Obj) 4.0 km out, 3.6 km from the guns', !!a1 && /crosses GTL \d \(PAA 1 → Obj\) 4\.0 km out, 3\.6 km from the guns/.test(a1.text), a1?.text);
  check('own flight crossing: the note says separation set with the ALO, FM 3-09 B-28', r.notes.some((n) => /ALO/.test(n) && /B-28/.test(n)));
  check('the PAA range note names 155 mm how, IBB p 120', r.notes.some((n) => /155 mm how, IBB p 120/.test(n)));
}
{
  // His flight (defence reading): own ROZ is his measure to cross, own SHORADEZ engages him, own guns to a TAI cross his avenue.
  const r = airspaceRead({
    side: 'enemy', k: 1, rules,
    routes: [north('1', 0)],
    zones: [
      { id: 'z1', key: '25171000', label: 'ROZ 1', side: 'own', ring: sq(0, 3000, 1000) },
      { id: 'z2', key: '25171900', label: 'SHORADEZ 1', side: 'own', ring: sq(0, 6000, 500) },
      { id: 'z3', key: '25170900', label: 'HIDACZ 1', side: 'enemy', ring: sq(0, 1000, 300) },
    ],
    guns: [{ id: 'paa-1', label: 'PAA 1', at: [-3000, 2000], minM: 1500, maxM: 14596, kind: 'paa' }],
    targets: [{ id: 'TAI 1', label: 'TAI 1', at: [3000, 6000], kind: 'tai' }],
  });
  const z1 = r.zones.find((z) => z.id === 'z1'), z2 = r.zones.find((z) => z.id === 'z2'), z3 = r.zones.find((z) => z.id === 'z3');
  check("own ROZ on his flight: his measure (does not bind him)", !!z1 && z1.effect === 'his');
  check('own SHORADEZ on his flight: a threat to him (own AD engages)', !!z2 && z2.effect === 'threat' && z2.routes[0]?.pct > 5);
  check("his HIDACZ on his own flight: coordinate (his own measure)", !!z3 && z3.effect === 'coordinate');
  check('own guns to TAI 1 cross his Air 1; the note is the B-60 one for own aircraft', r.gtls.length === 1 && r.gtls[0].crossings.some((c) => c.route === '1') && r.notes.some((n) => /B-60/.test(n)));
  check('zoneEffect: own ACA for own flight is safe; for his flight it is his measure', zoneEffect('aca', 'own', 'own').effect === 'safe' && zoneEffect('aca', 'own', 'enemy').effect === 'his');
}
{
  // No targets and guns: the note names what is missing; sampling at 50 m along an 8 km route gives 161 samples.
  const r = airspaceRead({ side: 'own', k: 1, rules, routes: [north('1', 0)], zones: [], guns: [{ id: 'g', label: 'PAA 1', at: [0, 0], minM: 1500, maxM: 14596, kind: 'paa' }], targets: [] });
  check('guns but no target: the note says so', r.gtls.length === 0 && r.notes.some((n) => /no target for the lines/.test(n)));
  // k scales: with k = 2 (Mercator units twice the ground metre), the same drawing is half the ground length.
  const r2 = airspaceRead({ side: 'own', k: 2, rules, routes: [north('1', 0)], zones: [], guns: [{ id: 'g', label: 'PAA 1', at: [-3000, 2000], minM: 1500, maxM: 14596, kind: 'paa' }], targets: [{ id: 'obj', label: 'Obj', at: [3000, 6000], kind: 'objective' }] });
  check('k corrects distances: the 7.2 km line reads 3.6 km at k = 2, the crossing 1.8 km from the guns', r2.gtls.length === 1 && Math.abs(r2.gtls[0].lengthM - 3606) <= 2 && Math.abs(r2.gtls[0].crossings[0].fromGunM - 1803) <= 3, JSON.stringify(r2.gtls[0]?.crossings));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
