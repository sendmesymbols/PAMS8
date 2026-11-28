// run.mjs -- the Aprc (Ground Appreciation) engine's pure parts.
//   node tools/aprc-test/run.mjs
// Node 24 runs MS/Engines/GroundAppreciation (AprcModel, AprcWrite, AprcHtml, AprcDocx, AprcDeck) on a synthetic AOR
// reading (three approaches, four lines of def, invented names), so every answer has a known value: the outline and its
// numbering, whose words print in which copy, what a new reading keeps, the drafted paragraphs and their basis, the
// page, the Word package and the slides. Exit code 1 on a failure.
import { register } from 'node:module';

register('../movement-test/hooks.mjs', import.meta.url);
const M = await import('../../MS/Engines/GroundAppreciation/AprcModel.ts');
const W = await import('../../MS/Engines/GroundAppreciation/AprcWrite.ts');
const H = await import('../../MS/Engines/GroundAppreciation/AprcHtml.ts');
const D = await import('../../MS/Engines/GroundAppreciation/AprcDocx.ts');
const K = await import('../../MS/Engines/GroundAppreciation/AprcDeck.ts');

let fails = 0, n = 0;
function check(name, ok, info = '') {
  n++;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
}

// ── a synthetic reading ──────────────────────────────────────────────────────────────────────────────────────────
const apch = (side, rank, o = {}) => ({
  side, rank, from: 'Rampura', fromAcross: true, fromOffsetM: 300,
  path: [[side === 'Lt' ? -2000 : side === 'Rt' ? 2000 : 0, 7000], [side === 'Lt' ? -1800 : side === 'Rt' ? 1800 : 0, 3000], [0, 0]],
  lengthM: 7400, pastM: 6100, cross: { at: [0, 5500], border: 'Intl Border', near: 'Chak 9', nearM: 1200, dir: 'W' },
  through: [{ name: 'Burj', people: 1800, atM: 2000 }, { name: 'Kot Jaimal', people: 5200, atM: 4200 }],
  obstacles: [{ name: 'Sukh Nala', type: 'nala', widthM: 12, at: [0, 4000], atM: 1300, bridge: null, bridgeM: null }, { name: 'Lakhan Disty', type: 'canal', widthM: 9, at: [0, 2500], atM: 2600, bridge: [40, 2500], bridgeM: 40 }],
  roadsAlong: [{ name: 'BURJ - KOT JAIMAL', cls: 'metalled', km: 3.1 }],
  band: { bua: 0.09, trees: 0.14, go: 0.84 }, minWidthM: 2600, fits: true, goPct: 84, score: 7.5, ...o,
});
const reading = {
  centre: [8290000, 3830000], k: 1.18, faceDeg: 0, source: 'echelon', outline: [[-3000, -1500], [-3000, 6000], [3000, 6000], [3000, -1500]],
  mitg: { at: [0, 0], name: 'Qila Mor' }, originsAssumed: true, corridorM: 2000, frontLimit: { m: 6500, label: 'Bn 3 coys up' }, country: 'Canal plains',
  apchs: [apch('Lt', 1), apch('Cen', 2, { pastM: 5000, lengthM: 6300, score: 8.2 }), apch('Rt', 3, { pastM: 6600, lengthM: 7900, fits: false, minWidthM: 1100, roadsAlong: [], score: 12.1 })],
  lines: [
    { id: 'W', role: 'Screen', name: 'Burj – Tibbi', cut: [[-3000, 4000], [3000, 4000]], frontM: 6000, buas: ['Burj', null, 'Tibbi'], obstacle: 'Sukh Nala', lateral: false, depthM: 1500 },
    { id: 'X', role: 'FDLs', name: 'Kot Jaimal – Dhok Rai', cut: [[-3000, 2500], [3000, 2500]], frontM: 7600, buas: ['Kot Jaimal', 'Nurpur', 'Dhok Rai'], obstacle: 'Lakhan Disty', lateral: true, depthM: 3000 },
    { id: 'Y', role: 'Depth', name: 'Chak 21 – Jhanda', cut: [[-3000, 1200], [3000, 1200]], frontM: 6100, buas: ['Chak 21', 'Pindi Dogran', null], obstacle: null, lateral: true, depthM: 4300 },
    { id: 'Z', role: 'Str Pt', name: 'Rasulpur – Bhal', cut: [[-3000, 0], [3000, 0]], frontM: 6200, buas: [null, 'Qila Mor', null], obstacle: null, lateral: true, depthM: null },
  ],
  laterals: [{ a: 'Lt', b: 'Cen', n: 2 }, { a: 'Cen', b: 'Rt', n: 1 }],
  msr: { name: 'QILA MOR - PASRUR', cls: 'metalled', distM: 300 }, thruRoad: { name: 'NURPUR - QILA MOR', cls: 'metalled' },
  dml: [{ side: 'Lt', water: 'Lakhan Disty', at: [0, 2500], bridgeM: 40 }],
  going: { goPct: 78, slowPct: 19, nogoPct: 3, buaPct: 7, nogoInAor: 1, nogoOut: [] },
  bridges: { inAor: 3, classed: 0 },
  hatch: { cellM: 60, x0: 0, y0: 0, nx: 0, ny: 0, rows: [] },
  map: { water: [], roads: [], borders: [], places: [{ name: 'Qila Mor', at: [0, 0], people: 9000, across: false }, { name: 'Kot Jaimal', at: [-1800, 2500], people: 5200, across: false }, { name: 'Rampura', at: [0, 7500], people: 4000, across: true }], itg: [[500, 800], [-900, 2000]] },
  pending: false, ms: 1, msParts: {},
};
const frame = { season: 'dry', month: 'Feb', used: 'echelon', source: 'boundaries', profileLabel: 'Tracked', echelon: 'Bn', note: 'Bdys: need one each side' };
const gin = {
  reading, frame,
  ground: { elevationM: 247.4, slopeBand: 'Level (0-2°)', landform: 'Plain', rough: null },
  roads: { density: 1.42, allWeatherPct: 62, radiusM: 3000, exitDirs: ['N', 'S', 'E'] },
  weather: { monthName: 'February', tmax: 21.2, tmin: 7.1, precMm: 28, windMs: 2.04, source: 'WorldClim', dataDate: '1970-2000' },
  visibility: { fogPct: 20, hazePct: 12, lt2kmPct: 18, meanViewKm: 4.6, stationKm: 40 },
  cover: { direct: 1, indirect: 0, ground: 2, aerial: 1 },
  crop: { tallPct: 5, hidesPct: 60 },
  obsn: { Lt: { near: 'Kot Jaimal', radiusM: 2000, seenPct: 41, clearMedianM: 912, country: 'open', overlook: null }, Cen: null },
  light: W.lightTimes(new Date('2027-02-15T06:00:00Z'), 32.5, 74.5, 300),
  drawnObs: ['Minefield 1.2 km N of Kot Jaimal'],
  threatMarked: false, readAt: '2027-02-15 11:00',
};

// ── the model ────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const d = M.newDoc('def');
  const ids = [];
  M.walk(d, (p) => ids.push(p.id));
  check('outline: ids are unique', new Set(ids).size === ids.length, `${ids.length}`);
  for (const id of ['rev.en', 'aim', 'gr.gen', 'gr.apchs', 'gr.itg', 'gr.obs', 'gr.cover', 'gr.met', 'gr.ded.pri', 'gr.ded.dp1.fdls', 'en.opts', 'own.str', 'ts.req', 'crs.react', 'crs.adopted', 'plan.exec.outline', 'plan.comd'])
    if (!ids.includes(id)) check(`outline: has ${id}`, false);
  check('outline: parts in order, the sketch an annex', d.parts.map((p) => p.title).join('|') === 'REVIEW OF SIT|AIM|FACTORS|COURSES|PLAN|ANX P: SKETCH');
  check('outline: FACTORS groups', d.parts[2].groups.map((g) => g.title).join('|') === 'Gr and Weather|En Sit|Own Sit|Time and Space');
  const top = M.lines(d).filter((l) => l.type === 'para' && l.depth === 0 && l.part.id !== 'anx').map((l) => l.label);
  check('numbering: top level runs 1. to n. across parts', top.every((l, i) => l === `${i + 1}.`), top.slice(0, 6).join(' '));
  check('numbering: labels by depth', M.label(1, 0) === 'a.' && M.label(2, 2) === '(3)' && M.label(3, 1) === '(b)' && M.label(4, 3) === 'iv.');
  check('numbering: Gen Description is para 5, Apchs 6', M.numberOf(d, 'gr.gen') === '5' && M.numberOf(d, 'gr.apchs') === '6');
  check('numbering: a sub-paragraph', M.numberOf(d, 'gr.ded.dp1.fdls') === '11b(1)(a)', M.numberOf(d, 'gr.ded.dp1.fdls'));
  const kinds = M.aprcKinds();
  check('kinds: defence and attack both ready', kinds.find((k) => k.kind === 'def').ready && kinds.find((k) => k.kind === 'attk').ready === true);
  check('kinds: the attack has its own outline', M.newDoc('attk').kind === 'attk' && M.newDoc('attk').parts[0].title === 'REVIEW OF THE SIT');
  const t = M.toText(d, 'fair');
  check('text: an empty document prints ruled lines', t.includes('5. Gen Description. ________________'));
  check('text: never "whites" or the 1:50k layer name', !/whites/i.test(t) && !/NCGDB/.test(JSON.stringify(d)));
  check('text: address block is titles and ruled lines', t.includes('Copy no ____ of ____') && t.includes('Tel Mil: ________'));
  check('text: the marking is a ruled line at head and foot, no text held', t.startsWith('________________\n') && t.endsWith('\n________________') && !('marking' in d));
}
{
  const d = M.newDoc('def');
  M.applyPatches(d, [{ id: 'gr.gen', draft: 'Plains.', state: 'gr', basis: [{ kind: 'data', text: 'x' }] }, { id: 'gr.ded.pri', draft: 'Lt, Cen, Rt.', state: 'judge' }, { id: 'nope', draft: 'x' }]);
  const gen = M.find(d, 'gr.gen'), pri = M.find(d, 'gr.ded.pri');
  check('shown: a drafted fact prints in both copies', M.shown(gen, 'fair').text === 'Plains.' && M.shown(gen, 'draft').mark === 'GR');
  check('shown: a proposal not accepted prints a ruled line in the fair copy', M.shown(pri, 'fair').text === null);
  check('shown: the draft copy shows it as a proposal', M.shown(pri, 'draft').text === 'Lt, Cen, Rt.' && M.shown(pri, 'draft').proposal === true);
  check('accept: only a proposal can be accepted', M.accept(d, 'gr.gen') === false && M.accept(d, 'gr.ded.pri') === true);
  check('shown: accepted, it prints in the fair copy', M.shown(pri, 'fair').text === 'Lt, Cen, Rt.' && M.shown(pri, 'draft').proposal === false);
  M.setMine(d, 'gr.gen', '  My own words.  ');
  check('mine: the planner\'s words win', M.shown(gen, 'fair').text === 'My own words.' && M.shown(gen, 'fair').mark === 'WRITTEN');
  check('mine: not stale while the draft is the same', M.isStale(gen) === false);
  const next = M.newDoc('def');
  M.applyPatches(next, [{ id: 'gr.gen', draft: 'Hills.', state: 'gr' }, { id: 'gr.ded.pri', draft: 'Lt, Cen, Rt.', state: 'judge' }]);
  M.carryOver(d, next);
  check('carry over: a new reading keeps the planner\'s words', M.shown(M.find(next, 'gr.gen'), 'fair').text === 'My own words.');
  check('carry over: and marks them stale when the ground reading changed', M.isStale(M.find(next, 'gr.gen')) === true);
  check('carry over: an acceptance is kept', M.find(next, 'gr.ded.pri').accepted === true);
  M.setMine(next, 'gr.gen', '');
  check('mine: empty text gives the paragraph back to the tool', M.shown(M.find(next, 'gr.gen'), 'fair').text === 'Hills.');
  const c = M.counts(d);
  check('counts: written, proposals', c.written === 1 && c.judge === 1 && c.open === 0, JSON.stringify(c));
  const d2 = M.newDoc('def');
  M.applyPatches(d2, [{ id: 'gr.ded.pri', draft: 'A.', state: 'judge' }, { id: 'gr.ded.comb', draft: 'B.', state: 'judge' }]);
  check('accept all', M.acceptAll(d2) === 2 && M.counts(d2).open === 0);
}

// ── the writer ───────────────────────────────────────────────────────────────────────────────────────────────────
const doc = M.newDoc('def');
const gw = W.writeGround(gin);
M.applyPatches(doc, gw.patches);
doc.confirm = gw.confirm;
doc.frame = gw.frame;
doc.sources = ['Land cover (2021)', '1:50k map (Survey of Pakistan)'];
{
  const P = (id) => M.find(doc, id);
  check('Gr: Gen Description drafted', P('gr.gen').state === 'gr' && /Canal plains\./.test(P('gr.gen').draft) && /GO on 78 % of the AOR, SLOW-GO 19 %, NO-GO 3 % in 1 patch/.test(P('gr.gen').draft), P('gr.gen').draft);
  const gwR = W.writeGround({ ...gin, reading: { ...reading, reliefM: 77, country: 'Desert' } }).patches.find((x) => x.id === 'gr.gen');
  check('Gr: Gen Description says how far the ground rises when read, and the country rule is in the basis (DW pp 2-3; mountainTest E)', /^Desert: the ground within 5 km of Qila Mor rises 77 m\./.test(gwR.draft) && gwR.basis.some((b) => b.kind === 'calc' && /dune faces \(DW pp 2-3\)/.test(b.text) && /the rise from the 30 m elevation/.test(b.text)) && /^Canal plains\./.test(P('gr.gen').draft) && P('gr.gen').basis.some((b) => /no elevation read, the classes alone/.test(b.text)), gwR.draft);
  check('Gr: Gen Description names the water lines and the Rd density', /2 water lines lie across the apchs: Sukh Nala \(nala\) and Lakhan Disty \(canal\)/.test(P('gr.gen').draft) && /Rd density 1\.4 km per km²/.test(P('gr.gen').draft));
  const ap = P('gr.apchs');
  check('Gr: three apchs in Lt, Cen, Rt order', ap.children.map((c) => c.head).join('|') === 'Lt Apch|Cen Apch|Rt Apch');
  check('Gr: twelve heads each', ap.children.every((c) => c.children.length === 12), ap.children.map((c) => c.children.length).join(','));
  check('Gr: apchs say when the threat is assumed', /start points assumed/.test(ap.draft) && ap.figure === 'trace');
  check('Gr: Capacity from the reading', /Bde \(\+\)/.test(P('gr.apch.lt.capacity').draft) && /Narrows to 1\.1 km/.test(P('gr.apch.rt.capacity').draft));
  check('Gr: Obsn filled where it was read', /about 41 % of the ground within 2\.0 km/.test(P('gr.apch.lt.obsn').draft) && /open country/.test(P('gr.apch.lt.obsn').draft));
  check('Gr: Obsn left to the planner where it was not', P('gr.apch.cen.obsn').draft === null && P('gr.apch.cen.obsn').state === 'yours');
  check('Gr: ITGs: the MITG first, Effs if Lost left to the planner with the facts', P('gr.itg').children[0].head === 'Qila Mor (MITG)' && P('gr.itg.mitg.effs').draft === null && P('gr.itg.mitg.effs').prompts.length >= 2);
  check('Gr: ITGs: BUAs astride the FDLs and depth are proposals', P('gr.itg.kot-jaimal')?.state === 'judge' && P('gr.itg.nurpur')?.state === 'judge' && !P('gr.itg.burj'));
  check('Gr: Obs lists water, NO-GO, bridges and the drawn minefield', /Sukh Nala \(nala, 12 m\) across the Lt, Cen and Rt apchs/.test(P('gr.obs').draft) && /3 bridges in the AOR, 0 with a load class/.test(P('gr.obs').draft) && /Minefield 1\.2 km N of Kot Jaimal/.test(P('gr.obs').draft), P('gr.obs').draft);
  check('Gr: Cover by apch, at the MITG and crops', /Lt BUAs 9 %, trees and orchards 14 %/.test(P('gr.cover').draft) && /cover from dir fire poor/.test(P('gr.cover').draft) && /60 % of the cropland hides a crouching man/.test(P('gr.cover').draft));
  check('Gr: Met Conditions with light', /February: max 21 °C, min 7 °C, rain 28 mm, wind 2\.0 m\/s/.test(P('gr.met').draft) && /first lt 06\d\d, last lt 18\d\d hrs \(UTC\+5, PKT\)/.test(P('gr.met').draft) && P('gr.met').basis.some((b) => /UTC\+5, PKT/.test(b.text)), P('gr.met').draft);
  check('Gr: Pri of Apchs is a proposal with its reasons', P('gr.ded.pri').state === 'judge' && /^Lt \(6\.1 km past the Intl Border, 2 BUAs, 2 water obs\), Cen .* then Rt .*narrows to 1\.1 km\)\.$/.test(P('gr.ded.pri').draft), P('gr.ded.pri').draft);
  check('Gr: Pri of Comb from the laterals', /^Lt and Cen \(2 metalled laterals\); Cen and Rt \(1 metalled lateral\)\.$/.test(P('gr.ded.comb').draft));
  const ln = P('gr.ded.lines');
  check('Gr: lines of def listed from the front', ln.children[0].children.map((c) => c.head).join('|') === 'Line W|Line X|Line Y|Line Z' && /along Lakhan Disty/.test(P('gr.ded.line.x').draft));
  check('Gr: pri of lines is a proposal; in the echelon frame it says the frontage is not tested', P('gr.ded.lines.pri').state === 'judge' && /Line X \(FDLs\), Line Y \(Depth\), Line W \(Screen\)/.test(P('gr.ded.lines.pri').draft) && /set Bdys or a Box to test the frontage/.test(P('gr.ded.lines.pri').draft), P('gr.ded.lines.pri').draft);
  {
    const withBdys = W.writeGround({ ...gin, reading: { ...reading, source: 'boundaries' }, frame: { ...frame, used: 'boundaries', note: null } });
    const pri = withBdys.patches.find((x) => x.id === 'gr.ded.lines').children[1];
    check('Gr: with Bdys the frontage is tested', /Frontage 7\.6 km: 1\.1 km over Bn 3 coys up/.test(pri.draft) && withBdys.frame.aor === 'Bdy symbols', pri.draft);
  }
  check('Gr: DP 1 proposes what the lines give', /Line X/.test(P('gr.ded.dp1.fdls').draft) && P('gr.ded.dp1.strpt').draft === 'Qila Mor.' && P('gr.ded.dp1.bias').draft === 'Lt and Cen.' && /Lt and Cen/.test(P('gr.ded.dp1.atk').draft));
  check('Gr: DP 1 leaves the rest to the planner', ['obs', 'surv', 'df', 'killing', 'catk', 'mor', 'hq', 'tac', 'misc', 'adv'].every((k) => P(`gr.ded.dp1.${k}`).draft === null));
  let bare = [];
  M.walk(doc, (p) => {
    if (p.draft && p.state !== 'yours' && !p.basis.length && !/^gr\.ded\.line\.|^gr\.itg\.mitg$/.test(p.id)) bare.push(p.id);
  });
  check('Gr: every drafted paragraph says what it rests on', bare.length === 0, bare.join(','));
  let proposals = 0, facts = 0;
  M.walk(doc, (p) => {
    if (p.id.startsWith('gr.ded.') && p.draft) (p.state === 'judge' ? proposals++ : facts++);
  });
  check('Gr: deductions are proposals; only the list of lines is fact', proposals >= 8 && facts === 5, `${proposals} proposals, ${facts} facts`);
  check('Gr: confirm list and frame', doc.confirm.length >= 5 && doc.frame.place === 'Qila Mor' && /asked: Bdy symbols/.test(doc.frame.aor) && doc.frame.threat === 'assumed forward of the AOR');
  check('Gr: nothing names the 1:50k source layer', !/NCGDB/.test(JSON.stringify(doc)));
  const lt = W.lightTimes(new Date('2027-06-21T06:00:00Z'), 32.5, 74.5, 300);
  check('light: longer day in June than in February', Number(lt.firstLight) < Number(gin.light.firstLight) && Number(lt.lastLight) > Number(gin.light.lastLight), `${lt.firstLight}-${lt.lastLight}`);
}
{
  const syms = [
    { id: '1', key: '10121100', name: 'Infantry', side: 'enemy', ech: '18', label: '', where: 'at Rampura' },
    { id: '2', key: '10121100', name: 'Infantry', side: 'enemy', ech: '18', label: '', where: 'at Rampura' },
    { id: '3', key: '10120500', name: 'Armour', side: 'enemy', ech: '17', label: '', where: null },
    { id: '4', key: '10121100', name: 'Infantry', side: 'own', ech: '16', label: '7 XX', where: 'at Qila Mor' },
    { id: '5', key: '25270700', name: 'Minefield', side: 'own', ech: null, label: '', where: '1.2 km N of Kot Jaimal' },
    { id: '6', key: '25110100', name: 'Boundary', side: 'own', ech: '16', label: '', where: null },
  ];
  check('symbols: force line, largest echelon first', W.forceLine(syms.filter((s) => s.side === 'enemy')) === '2 x Infantry Bde, 1 x Armour Regt');
  const sw = W.writeSymbols(syms);
  const d = M.newDoc('def');
  M.applyPatches(d, sw.patches);
  check('symbols: en and own read from the map', M.find(d, 'rev.en').state === 'map' && /2 x Infantry Bde, 1 x Armour Regt/.test(M.find(d, 'en.comp').draft) && /7 XX \(Bn\) at Qila Mor/.test(M.find(d, 'own.disp').draft));
  check('symbols: a boundary is not a unit; a minefield is an obstacle', !/Boundary/.test(M.find(d, 'own.disp').draft) && sw.drawnObs.length === 1 && /Minefield 1\.2 km N/.test(sw.drawnObs[0]));
  const t = M.find(d, 'own.str').table;
  check('symbols: relative strength counted by arm, ratio left blank', t.rows.length === 2 && t.rows[0][1] === 'Armour' && t.rows[1][2] === '2 x Bde' && t.rows[1][3] === '1 x Bn' && t.rows.every((r) => r[4] === ''), JSON.stringify(t.rows));
  check('symbols: none marked says so', W.writeSymbols([]).patches.length === 0 && W.writeSymbols([]).confirm.length === 1);
  const pw = W.writePlan({ title: 'Bn Def three up', posns: [{ label: 'A Coy', kind: 'fwd' }, { label: 'B Coy', kind: 'fwd' }, { label: 'D Coy', kind: 'depth' }], rows: [{ name: 'Frontage', st: 'fail', reason: '7.6 km: 1.1 km over' }, { name: 'Mutual sp', st: 'pass', reason: 'every posn covered' }], triggers: [{ trigger: 'Disty crossed', who: 'D Coy', from: 'Chak 21', to: 'C pen 1', min: 22, enemyMin: 35, st: 'pass', reason: '' }] });
  M.applyPatches(d, pw.patches);
  check('plan: own disposns and the outline from the check', /Fwd: A Coy and B Coy\. Depth: D Coy\./.test(M.find(d, 'own.disp').draft) && M.find(d, 'plan.exec.outline').state === 'map');
  check('plan: advs and disadvs are proposals', M.find(d, 'crs.an.adv').state === 'judge' && /Mutual sp/.test(M.find(d, 'crs.an.adv').draft) && /Frontage: 7\.6 km/.test(M.find(d, 'crs.an.dis').draft));
  check('plan: his reactions against own moves', M.find(d, 'crs.react').table.rows.length === 1 && /35 min/.test(M.find(d, 'crs.react').table.rows[0][1]) && /In time/.test(M.find(d, 'crs.react').table.rows[0][2]));
}

// ── the page ─────────────────────────────────────────────────────────────────────────────────────────────────────
doc.figures = [{ id: 'trace', kind: 'trace', caption: 'Trace', svg: '<svg xmlns="http://www.w3.org/2000/svg" width="9" height="8"></svg>', png: 'data:image/png;base64,AAAA', w: 900, h: 800 }];
M.setMine(doc, 'aim', 'To def <Qila Mor> & hold it.');
{
  const fair = H.bodyHtml(doc, 'fair'), draft = H.bodyHtml(doc, 'draft');
  check('page: paragraphs carry their ids', /data-id="gr\.apch\.lt\.capacity"/.test(fair));
  check('page: user text is escaped', fair.includes('To def &lt;Qila Mor&gt; &amp; hold it.'));
  check('page: fair copy has no marks and rules a proposal', !/ap-mk /.test(fair) && /data-id="gr\.ded\.pri"><span class="ap-n">\(1\)<\/span><span class="ap-b"><span class="ap-h">Pri of Apchs<\/span>\. <span class="ap-rule long">/.test(fair));
  check('page: draft copy marks and shows the proposal', /PROPOSAL/.test(draft) && /ap-mk GR/.test(draft) && /CONFIRM ON GR/.test(draft) && /BASIS OF THE DRAFTED PARAGRAPHS/.test(draft));
  check('page: the figure prints under Apchs', /Fig 1\. Trace/.test(fair) && /<svg/.test(fair));
  check('page: tables print ruled', /<table>/.test(fair) && /<th>Ratio<\/th>/.test(fair));
  check('page: no "whites"', !/whites/i.test(fair + draft));
  const pr = H.printHtml(doc, 'fair');
  check('print: A4, the page number in the top margin where supported', /@page\{size:A4/.test(pr) && /@top-center\{content:counter\(page\)/.test(pr) && pr.startsWith('<!doctype html>'));
  check('print: the marking ruled line heads and foots every page from a repeating table head and foot (no margin boxes needed)', /<thead><tr><td><div class="ap-mkg"><span class="ap-rule"><\/span><\/div><\/td><\/tr><\/thead><tfoot><tr><td><div class="ap-mkg">/.test(pr) && !/display:none/.test(pr) && (pr.match(/class="ap-mkg"/g) || []).length === 2);
  check('print: the title is the file name (Save as PDF takes it)', /<title>Aprc_Qila_Mor_\d{4}-\d\d-\d\d<\/title>/.test(pr) && H.aprcFileBase(doc, 'draft', new Date('2027-02-15T08:00:00Z')) === 'Aprc_Qila_Mor_2027-02-15_draft', pr.match(/<title>[^<]*/)?.[0]);
  check('page: the sheet shows the ruled line at head and foot', (fair.match(/<div class="ap-mkg"><span class="ap-rule"><\/span><\/div>/g) || []).length === 2);
}

// ── Word ─────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const balanced = (xml) => {
    const st = [];
    for (const m of xml.matchAll(/<(\/?)([A-Za-z0-9:]+)((?:"[^"]*"|[^>"])*?)(\/?)>/g)) {
      if (m[0].startsWith('<?')) continue;
      if (m[4]) continue;
      if (m[1]) {
        if (st.pop() !== m[2]) return false;
      } else st.push(m[2]);
    }
    return st.length === 0;
  };
  const files = D.docxFiles(doc, 'draft', { trace: { bytes: new Uint8Array([137, 80, 78, 71]), w: 900, h: 800 } });
  const need = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/header1.xml', 'word/footer1.xml', 'word/_rels/document.xml.rels', 'word/media/image1.png'];
  check('Word: the package has its parts', need.every((k) => k in files), Object.keys(files).join(' '));
  const xmlOk = Object.entries(files).filter(([k]) => k.endsWith('.xml') || k.endsWith('.rels')).every(([, v]) => balanced(v));
  check('Word: every XML part is well formed', xmlOk);
  const body = files['word/document.xml'];
  check('Word: numbered paragraphs with headings underlined', body.includes('<w:t xml:space="preserve">6.</w:t>') && body.includes('<w:u w:val="single"/></w:rPr><w:t xml:space="preserve">Apchs</w:t>'));
  check('Word: user text is escaped', body.includes('To def &lt;Qila Mor&gt; &amp; hold it.'));
  check('Word: tables, the picture and its caption', body.includes('<w:tbl>') && body.includes('r:embed="rId10"') && body.includes('Fig 1. Trace') && files['word/_rels/document.xml.rels'].includes('media/image1.png'));
  check('Word: page number field and the ruled line in the header, the ruled line in the footer', files['word/header1.xml'].includes(' PAGE ') && files['word/header1.xml'].includes('>________________<') && files['word/footer1.xml'].includes('>________________<'));
  check('Word: draft copy carries marks and annexes', body.includes('[PROPOSAL]') && body.includes('CONFIRM ON GR') && body.includes('BASIS OF THE DRAFTED PARAGRAPHS'));
  const fair = D.docxFiles(doc, 'fair')['word/document.xml'];
  check('Word: fair copy has neither, and prints ruled lines', !fair.includes('[PROPOSAL]') && !fair.includes('CONFIRM ON GR') && fair.includes('________________________') && !fair.includes('<w:drawing>'));
}

// ── slides ───────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const o = { copy: 'draft', blankBg: 'data:image/png;base64,BBBB' };
  const full = K.buildDeck(doc, { ...o, kind: 'full' });
  const dec = K.buildDeck(doc, { ...o, kind: 'decision' });
  const sand = K.buildDeck(doc, { ...o, kind: 'sand' });
  const titles = full.map((s) => s.title);
  check('slides: full brief has the title, the apchs one by one and Confirm on Gr', titles[0] === 'APRC OF THE SIT' && ['Apchs', 'Lt Apch', 'Cen Apch', 'Rt Apch', 'Gen Description', 'ITGs', 'Confirm on Gr'].every((t) => titles.includes(t)), titles.join(' | '));
  check('slides: a heading two paragraphs share is told apart by its group', titles.includes('Deductions: Gr and Weather') && !titles.includes('Deductions'), titles.join(' | '));
  check('slides: a section slide stands before a group of two or more', titles.indexOf('Gr and Weather') === titles.indexOf('Gen Description') - 1 && full.find((s) => s.title === 'Gr and Weather').sourceRef === 'aprc:section:gr');
  check('slides: every slide carries its number out of the deck', full.every((s, i) => s.overlays.some((v) => v.text === `${i + 1} / ${full.length}`)));
  check('slides: unwritten paragraphs make no slide', !titles.includes('Air Sit') && !titles.includes('Msn'));
  check('slides: decision brief is shorter, sand model is the ground only', dec.length < full.length && sand.length < full.length && !sand.some((s) => s.title === 'Aim') && dec.some((s) => s.title === 'AIM' || s.title === 'Aim'), `${full.length}/${dec.length}/${sand.length}`);
  check('slides: every slide is screen-only with a source and a section', full.every((s) => s.backgroundDataUrl && s.sourceRef?.startsWith('aprc:') && s.sourceHash && s.view.capturedIn === '2d') && full.find((s) => s.title === 'Apchs').section === 'Factors: Gr and Weather');
  const lt = full.find((s) => s.title === 'Lt Apch');
  check('slides: an apch is its route, short facts and its significance beside the trace', lt.overlays.some((v) => v.kind === 'table' && v.rows.some((r) => r[0] === 'Length') && v.rows.some((r) => r[0] === 'Capacity') && !v.rows.some((r) => r[0] === 'Definition')) && lt.overlays.some((v) => v.kind === 'image' && v.src.startsWith('data:image/png')) && lt.overlays.some((v) => v.text === 'Significance') && lt.overlays.some((v) => /→/.test(v.text ?? '')));
  check('slides: what the apch slide leaves out is in its notes', /Definition/.test(lt.notes ?? '') && /Dir Keeping|Depl Areas/.test(lt.notes ?? ''));
  const gen = full.find((s) => s.title === 'Gen Description');
  check('slides: the going is a bar with its words, the rest short points', gen.overlays.filter((v) => v.kind === 'rect').length >= 3 && gen.overlays.some((v) => /^GO \d+ %$/.test(v.text ?? '')) && gen.overlays.some((v) => v.listStyle === 'bullet'));
  const ded = full.find((s) => s.title === 'Deductions: Gr and Weather');
  check('slides: ground deductions rank the apchs and lay the lines of def by depth', ded.overlays.filter((v) => v.kind === 'ellipse').length >= 2 && ded.overlays.filter((v) => v.kind === 'line' && v.strokeDash === 'dashed').length >= 3 && ded.overlays.some((v) => v.text === 'FDLs'));
  check('slides: Confirm on Gr is a checklist, each item once', (() => { const c = full.find((s) => s.title === 'Confirm on Gr'); const t = c.comments.map((x) => x.text); const boxes = c.overlays.filter((v) => v.kind === 'rect' && v.w < 0.02).length; return t.length && new Set(t).size === t.length && boxes === t.length; })());
  const fairDeck = K.buildDeck(doc, { ...o, copy: 'fair', kind: 'full' });
  check('slides: the fair copy leaves proposals out', !JSON.stringify(fairDeck).includes('(proposal)') && JSON.stringify(full).includes('(proposal)'));
  check('slides: the draft tags proposals, the fair copy does not', full.some((s) => s.overlays.some((v) => v.text === 'Proposal' || v.text === 'Proposals')) && !fairDeck.some((s) => s.overlays.some((v) => v.text === 'Proposal' || v.text === 'Proposals' || v.text === 'Draft')));
  const conf = full.find((s) => s.title === 'Confirm on Gr');
  check('slides: confirm items are task comments', conf.comments.length >= 5 && conf.comments.every((c) => c.kind === 'task'));
  check('slides: notes carry the paragraph in full', /Lt Apch/.test(full.find((s) => s.title === 'Apchs').notes));
  // refresh: a foreign slide stays, an edited one is kept, the rest are replaced
  const mine = { id: 'u1', title: 'My slide', view: { capturedIn: '2d' }, visibleLayers: {}, transitionMs: 500 };
  const held = [mine, ...full.map((s) => ({ ...s, overlays: s.overlays.map((v) => ({ ...v })) }))];
  const edited = held.find((s) => s.title === 'Gen Description');
  edited.overlays[edited.overlays.length - 1].text = 'I rewrote this';
  const m = K.mergeDeck(held, K.buildDeck(doc, { ...o, kind: 'full' }));
  check('refresh: foreign slide first, edited slide kept, others replaced', m.slides[0].id === 'u1' && m.kept === 1 && m.replaced === full.length - 1 && m.slides.find((s) => s.title === 'Gen Description').id === edited.id && m.slides.length === full.length + 1, JSON.stringify({ kept: m.kept, replaced: m.replaced, added: m.added }));
  const m2 = K.mergeDeck(held, K.buildDeck(doc, { ...o, kind: 'sand' }));
  check('refresh: an edited slide survives a smaller deck', m2.slides.some((s) => s.id === edited.id) && m2.slides.length === sand.length + 1);
}

// ── typed table cells ────────────────────────────────────────────────────────────────────────────────────────────
{
  const d = M.newDoc('def');
  M.applyPatches(d, [{ id: 'own.tasks.dp1', draft: '', state: 'judge', table: { head: ['Ser', 'Locs', 'Inf'], rows: [['(1)', 'FDLs: A', '3 x pl'], ['(2)', 'Total', '3 x pl']] } }]);
  const p = M.find(d, 'own.tasks.dp1');
  check('cells: a proposal table keeps only its first column in the fair copy', JSON.stringify(M.tableOf(p, 'fair').rows) === JSON.stringify([['(1)', '', ''], ['(2)', '', '']]));
  check('cells: the draft copy shows the proposal', M.tableOf(p, 'draft').rows[0][2] === '3 x pl');
  check('cells: typed cells win in both copies', M.setCell(d, 'own.tasks.dp1', 0, 2, ' 2 x pl ') && M.tableOf(p, 'fair').rows[0][2] === '2 x pl' && M.tableOf(p, 'draft').rows[0][2] === '2 x pl');
  check('cells: out of range is refused', M.setCell(d, 'own.tasks.dp1', 5, 0, 'x') === false && M.setCell(d, 'own.tasks.dp1', 0, 9, 'x') === false);
  check('cells: an added row takes typing', M.addRow(d, 'own.tasks.dp1') && M.setCell(d, 'own.tasks.dp1', 2, 1, 'Screen') && M.tableOf(p, 'fair').rows.length === 3 && M.tableOf(p, 'fair').rows[2][1] === 'Screen');
  const next = M.newDoc('def');
  M.applyPatches(next, [{ id: 'own.tasks.dp1', draft: '', state: 'judge', table: { head: ['Ser', 'Locs', 'Inf'], rows: [['(1)', 'FDLs: B', '3 x pl']] } }]);
  M.carryOver(d, next);
  const q = M.find(next, 'own.tasks.dp1');
  check('cells: keyed by the row, not its index', p.cells['fdls: a::2'] === '2 x pl' && p.cells['+0::1'] === 'Screen', JSON.stringify(p.cells));
  check('cells: a row of his gone from the new reading: his cells kept as an added row with its name, the paragraph marked', q.addRows === 2 && q.cells['+0::1'] === 'Screen' && q.cells['+1::2'] === '2 x pl' && q.cells['+1::1'] === 'FDLs: A' && JSON.stringify(q.moved.rows) === '[1]' && M.staleWhy(q) === 'rows' && M.tableOf(q, 'draft').rows[0][1] === 'FDLs: B' && M.tableOf(q, 'draft').rows[2][2] === '2 x pl', JSON.stringify(q.cells));
  {
    const n2 = M.newDoc('def');
    M.applyPatches(n2, [{ id: 'own.tasks.dp1', draft: '', state: 'judge', table: { head: ['Ser', 'Locs', 'Inf'], rows: [['(1)', 'FDLs: Z', '3 x pl'], ['(2)', 'FDLs: A', '3 x pl'], ['(3)', 'Total', '6 x pl']] } }]);
    M.carryOver(d, n2);
    const r2 = M.find(n2, 'own.tasks.dp1');
    check('cells: a row added above his moves nothing: his figure stays on its row', M.tableOf(r2, 'draft').rows[1][2] === '2 x pl' && M.tableOf(r2, 'draft').rows[0][2] === '3 x pl' && !r2.moved && r2.addRows === 1);
    check('cells: use the new reading drops the moved rows; keep clears the mark', (() => { const c1 = JSON.parse(JSON.stringify(next)); M.dropMoved(c1, 'own.tasks.dp1'); const a = M.find(c1, 'own.tasks.dp1'); const c2 = JSON.parse(JSON.stringify(next)); M.keepMoved(c2, 'own.tasks.dp1'); const b = M.find(c2, 'own.tasks.dp1'); return a.addRows === 1 && a.cells['+0::1'] === 'Screen' && !a.cells['+1::2'] && !a.moved && b.addRows === 2 && !b.moved; })());
    const old = { cells: { '0,2': 'x', '1,1': 'y', '2,0': 'z' }, table: { head: ['Ser', 'Locs', 'Inf'], rows: [['(1)', 'FDLs: A', ''], ['(2)', 'Total', '']] }, id: 't' };
    M.migrateCells(old);
    check('cells: kept "row,col" cells are re-keyed by row on open', old.cells['fdls: a::2'] === 'x' && old.cells['total::1'] === 'y' && old.cells['+0::0'] === 'z', JSON.stringify(old.cells));
    const rk = M.rowKeys({ head: ['Ser', 'Ev'], rows: [['a.', 'His lead element at TAI 1: H+0:54 to H+1:36 (0654 hrs D Day to 0736 hrs D Day).'], ['b.', 'Unforeseen'], ['c.', 'Unforeseen'], ['d.', '']] });
    check('cells: row keys leave times out, tell repeats and blanks apart', rk[0] === 'his lead element at tai 1: .' && rk[1] === 'unforeseen' && rk[2] === 'unforeseen#2' && rk[3] === 'unforeseen#2~1', JSON.stringify(rk));
  }
  M.addRow(d, 'own.tasks.dp1', -1);
  check('cells: removing the added row drops its cells', !p.addRows && p.cells['+0::1'] === undefined && p.cells['fdls: a::2'] === '2 x pl');
  M.setCell(d, 'own.tasks.dp1', 0, 2, null);
  check('cells: null gives a cell back to the tool', !p.cells);
  M.accept(d, 'own.tasks.dp1');
  check('cells: accepted, the table prints in the fair copy', M.tableOf(p, 'fair').rows[0][2] === '3 x pl');
  check('cells: Word and the page print the typed table', (() => { M.setCell(d, 'own.tasks.dp1', 1, 1, 'Grand <total>'); return D.docxFiles(d, 'fair')['word/document.xml'].includes('Grand &lt;total&gt;') && H.bodyHtml(d, 'fair').includes('Grand &lt;total&gt;'); })());
}

// ── the en options from the IPB reading ──────────────────────────────────────────────────────────────────────────
{
  const e = {
    force: '2 x Infantry Bde, 1 x Armour Regt', mover: 'armour', rates: { go: [24, 24], slow: [16, 8] }, fromThreat: true, aaFor: 'Bde: Bn avenues', mcWidthM: 1500, objective: 'Qila Mor',
    avenues: [
      { id: 'AA 1', rank: 1, viable: true, main: true, lengthM: 14200, goPct: 82, minWidthM: 1800, waterLines: 2, through: ['Burj', 'Kot Jaimal'], onto: 'Lt flanking', startH: [0.5, 0.6], endH: [1.4, 2.6] },
      { id: 'AA 2', rank: 2, viable: true, main: false, lengthM: 12100, goPct: 70, minWidthM: 900, waterLines: 1, through: ['Nurpur'], onto: 'frontal', startH: [0.4, 0.5], endH: [1.1, 2.9] },
      { id: 'MC 5', rank: 3, viable: false, main: false, lengthM: 9000, goPct: 60, minWidthM: 500, waterLines: 0, through: [], onto: null, startH: [0, 0], endH: [1, 1] },
    ],
    tais: [{ id: 'TAI 1', aa: 'AA 1', why: 'the crossing (9 m): denied, he needs bridging', earliestH: 0.9, latestH: 1.7 }],
    dps: [{ id: 'DP 1', kind: 'interdict', aa: 'AA 1', tai: 'TAI 1', decision: 'interdict at TAI 1', earliestH: -1.1, beforeH: true }, { id: 'DP 2', kind: 'catk', aa: 'AA 2', tai: null, decision: 'launch the C attk', earliestH: 0.7, beforeH: false }],
    template: { label: 'Inf Bde attack', src: 'KYE-2019 p 40', confirmed: false, phases: [{ phase: 'Ph 1', time: 'H to H+2' }] },
  };
  check('hplus', W.hplus(1.5) === 'H+1:30' && W.hplus(2) === 'H+2' && W.hplus(-1.1) === 'H-1:06');
  const ew = W.writeEnemy(e);
  const d = M.newDoc('def');
  M.applyPatches(d, ew.patches);
  const o1 = M.find(d, 'en.opt1.what').draft;
  check('en: option 1 is the first avenue, with the force, places and times', /^2 x Infantry Bde, 1 x Armour Regt along AA 1 \(Lt flanking\): 14\.2 km, GO on 82 %, narrowest 1\.8 km, through Burj and Kot Jaimal\. The En's lead element reaches the avenue at H\+0:30 to H\+0:36 and Qila Mor at H\+1:24 to H\+2:36\./.test(o1), o1);
  check('en: the template phase names follow, flagged unconfirmed', /Doctrinal template "Inf Bde attack" \(a reading still to confirm\): phases Ph 1\./.test(o1), o1);
  check('en: options are proposals with the book rates as basis', M.find(d, 'en.opt1.what').state === 'judge' && M.find(d, 'en.opt1.what').basis.some((b) => b.kind === 'rule' && /IPB book p 18/.test(b.text)));
  check('en: option 1 advs and disadvs compared', /room all along/.test(M.find(d, 'en.opt1.adv').draft) && /^Best going \(GO on 82 %\)/.test(M.find(d, 'en.opt1.adv').draft) && /^Latest onto the objective/.test(M.find(d, 'en.opt1.dis').draft) && /2 water lines to cross/.test(M.find(d, 'en.opt1.dis').draft));
  {
    const close = W.writeEnemy({ ...e, avenues: [{ ...e.avenues[0], goPct: 72, endH: [1.2, 2] }, { ...e.avenues[1], goPct: 70, endH: [1.1, 2] }] }).patches;
    const dd = M.newDoc('def');
    M.applyPatches(dd, close);
    check('en: differences under 0.25 h or 5 % of GO are not called better or worse, nor most dangerous', !/earliest onto|latest onto|best going|worst going/.test(JSON.stringify(close)) && M.find(dd, 'en.danger').draft === null);
  }
  check('en: most dangerous is one of the two options', (() => { const p3 = W.writeEnemy({ ...e, avenues: [...e.avenues.slice(0, 2), { ...e.avenues[0], id: 'AA 3', rank: 3, endH: [0.5, 1] }] }).patches; return /Along AA 2/.test(p3.find((x) => x.id === 'en.danger').draft); })());
  check('en: option 2 is the second avenue; a lone corridor is not an option', /along AA 2 \(frontal\)/.test(M.find(d, 'en.opt2').draft) && /narrows to 0\.9 km/.test(M.find(d, 'en.opt2').draft) && !/MC 5/.test(JSON.stringify(ew.patches)));
  check('en: most dangerous = earliest onto the objective, a proposal', M.find(d, 'en.danger').draft === 'Along AA 2: the En is onto Qila Mor earliest, at H+1:06.' && M.find(d, 'en.danger').state === 'judge');
  check('en: most probable is the IPB reading\'s main avenue, a proposal saying it has no book figure', /^Along AA 1 \(Lt flanking\): the main avenue of the IPB reading/.test(M.find(d, 'en.probable').draft) && M.find(d, 'en.probable').state === 'judge' && M.find(d, 'en.probable').basis.some((b) => /no book figure/.test(b.text)), M.find(d, 'en.probable').draft);
  check('en: no main avenue, most probable stays the planner\'s', !W.writeEnemy({ ...e, avenues: e.avenues.map((a) => ({ ...a, main: false })) }).patches.some((x) => x.id === 'en.probable'));
  const rt = M.find(d, 'crs.react').table;
  check('en: reactions table from the TAIs and DPs', rt.rows.length === 2 && /TAI 1 on AA 1 \(the crossing/.test(rt.rows[0][1]) && /DP 1: interdict at TAI 1 \(before H\)/.test(rt.rows[0][2]) && /DP 2: launch the C attk by H\+0:42/.test(rt.rows[1][2]) && rt.rows[1][0] === 'b.');
  check('en: the 2 hr rule is cited', M.find(d, 'crs.react').basis.some((b) => /IPB book p 30/.test(b.text)));
  check('en: no avenue, no option', W.writeEnemy({ ...e, avenues: [e.avenues[2]] }).patches.length === 0);
  const one = W.writeEnemy({ ...e, avenues: [e.avenues[0]] });
  check('en: one avenue gives option 1 only, no comparison words', one.patches.some((x) => x.id === 'en.opt1.what') && !one.patches.some((x) => x.id === 'en.opt2' || x.id === 'en.danger') && !/best going|earliest onto/.test(JSON.stringify(one.patches)));
  const unmarked = W.writeEnemy({ ...e, force: null }).patches.find((x) => x.id === 'en.opt1.what').draft;
  check('en: unmarked force is said so', unmarked.startsWith('The en (strength not marked) along AA 1'));
  const plan = W.writePlan({ title: 'P', posns: [], rows: [], triggers: [{ trigger: 'x', who: 'D Coy', from: 'a', to: 'b', min: 10, enemyMin: 20, st: 'pass', reason: '' }] });
  M.applyPatches(d, plan.patches);
  check('en: a checked plan replaces the reactions table', M.find(d, 'crs.react').table.rows.length === 1 && /D Coy/.test(M.find(d, 'crs.react').table.rows[0][2]));
  const gw2 = W.writeGround({ ...gin, wx: { marginal: ['Tr veh day (vis)'], unfavourable: ['CAS (ceiling)'] } });
  const met = gw2.patches.find((x) => x.id === 'gr.met');
  check('weather: Annex A values in Met Conditions with the book cited', /unfavourable for CAS \(ceiling\); marginal for Tr veh day \(vis\)/.test(met.draft) && met.basis.some((b) => /Annex A pp 19-20/.test(b.text)));
  const gw3 = W.writeGround({ ...gin, wx: { marginal: [], unfavourable: [], mtn: { elevM: 2600, notes: ['Fog lies thick in the valleys early in the morning (MW p 229).', 'Snow hides the tracks above 2500 m (MW p 298).'] } } });
  const met3 = gw3.patches.find((x) => x.id === 'gr.met');
  check('weather: on mountain ground the Met paragraph carries the MW notes (about 2600 m), Mountain Warfare in the basis', /Mountains \(about 2600 m\): Fog lies thick in the valleys early in the morning \(MW p 229\)\. Snow hides the tracks above 2500 m \(MW p 298\)\./.test(met3.draft) && met3.basis.some((b) => /Mountain Warfare \(GSP-1973\)/.test(b.text)));
  check('...off the mountains no such line', !/Mountains \(about/.test(met.draft));
}

// ── tasks for DP 1 ───────────────────────────────────────────────────────────────────────────────────────────────
{
  const tw = W.writeTasks(reading);
  const d = M.newDoc('def');
  M.applyPatches(d, tw.patches);
  const t = M.find(d, 'own.tasks.dp1').table;
  check('tasks: a Coy per BUA on the FDLs and in depth', t.rows.filter((r) => /^FDLs: /.test(r[1])).map((r) => r[1]).join('|') === 'FDLs: Kot Jaimal|FDLs: Nurpur|FDLs: Dhok Rai' && t.rows.filter((r) => /^Depth: /.test(r[1])).length === 2, JSON.stringify(t.rows.map((r) => r[1])));
  check('tasks: Str Pt and screen a Pl each, total 17 x pl', t.rows.some((r) => r[1] === 'Str Pt: Qila Mor' && r[2] === '1 x pl') && t.rows.some((r) => /^Screen/.test(r[1])) && t.rows[t.rows.length - 1][2] === '17 x pl');
  check('tasks: serials only on the first locality of a line', t.rows[0][0] === '(1)' && t.rows[1][0] === '' && t.rows[3][0] === '(2)');
  check('tasks: a proposal, and the allotment says what it needs', M.find(d, 'own.tasks.dp1').state === 'judge' && /DP 1 needs 17 x pl/.test(M.find(d, 'own.ded.basic').draft));
  check('tasks: no FDLs line, no table', W.writeTasks({ ...reading, lines: [] }).patches.length === 0);
}

// ── clock times and his phases ───────────────────────────────────────────────────────────────────────────────────
{
  check('H: parsed as HH:MM or HHMM', W.parseHHour('06:00') === 360 && W.parseHHour('2130') === 1290 && W.parseHHour('') === null && W.parseHHour('25:00') === null);
  check('clock: rolls over the day', W.clockAt(360, 1 + 40 / 60) === '0740 hrs D Day' && W.clockAt(1290, 4) === '0130 hrs D+1' && W.clockAt(360, -7) === '2300 hrs D-1');
  check('when: H+ alone, or with clock times', W.whenText([1.5, 1.5], null) === 'H+1:30' && W.whenText([1, 2], 360) === 'H+1 to H+2 (0700 hrs D Day to 0800 hrs D Day)');
  const base = {
    force: null, mover: 'armour', rates: { go: [24, 24], slow: [16, 8] }, fromThreat: true, aaFor: 'Bde', mcWidthM: 1500, objective: 'Qila Mor', tais: [], dps: [], template: null,
    avenues: [{ id: 'AA 1', rank: 1, viable: true, main: true, lengthM: 14200, goPct: 82, minWidthM: 1800, waterLines: 2, through: [], onto: null, startH: [0.5, 0.6], endH: [1.4, 2.6],
      lines: [{ id: 'X', role: 'FDLs', h: [0.9, 1.6] }, { id: 'W', role: 'Screen', h: [0.7, 1.1] }, { id: 'Y', role: 'Depth', h: [1.1, 2] }, { id: 'Z', role: 'Str Pt', h: [1.3, 2.5] }] }],
  };
  const t1 = W.writeEnemy(base).patches.find((x) => x.id === 'en.opt1.what').draft;
  check('phases: prelim, break-in, depth, onto the objective, from the lines crossed', /Unopposed, the En phases would run: Prelim ph, Line W \(Screen\) at H\+0:42 to H\+1:06; Ph 1 \(break-in\), Line X \(FDLs\) at H\+0:54 to H\+1:36; Ph 2, Line Y \(Depth\) at H\+1:06 to H\+2; Ph 3, onto Qila Mor at H\+1:24 to H\+2:36\. Each fight adds to these times\./.test(t1), t1);
  const t2 = W.writeEnemy({ ...base, hHour: '06:00' }).patches;
  const w2 = t2.find((x) => x.id === 'en.opt1.what');
  check('phases: clock times with H set, and H named in the basis', /Ph 3, onto Qila Mor at H\+1:24 to H\+2:36 \(0724 hrs D Day to 0836 hrs D Day\)/.test(w2.draft) && w2.basis.some((b) => b.kind === 'input' && /H: 06:00 on D Day/.test(b.text)));
  check('phases: none when no line is crossed', !/phases would run/.test(W.writeEnemy({ ...base, avenues: [{ ...base.avenues[0], lines: [] }] }).patches[0].draft));
}

// ── relative strength from the ORBAT ─────────────────────────────────────────────────────────────────────────────
{
  const bn = { name: 'Inf Bn (Std)', count: 1, coys: 4, strength: 850, atgm: 8, mortars: 6, plsPerCoy: 3, src: "SO's Hbk 2019 p 12 (inf-bn-std)" };
  const bde = { name: 'RAPID Inf Bde', count: 1, coys: 13, strength: null, atgm: 24, mortars: 18, plsPerCoy: 3, src: "SO's Hbk 2019 Sec 13 p 701 (en-rapid-inf-bde)" };
  const s = W.writeStrength({ en: [bde], enAssumed: 'one level up', own: [bn], ownAssumed: null, need: 19 });
  const d = M.newDoc('def');
  M.applyPatches(d, s.patches);
  const p = M.find(d, 'own.str');
  check('strength: table by measure with ratios en to own', JSON.stringify(p.table.rows[0]) === JSON.stringify(['a.', 'Manoeuvre Coys / Sqns', '13', '4', '3.3 : 1']) && p.table.rows[1][2] === '?' && p.table.rows[1][4] === '?' && p.table.rows[2][4] === '3.0 : 1', JSON.stringify(p.table.rows));
  check('strength: an assumed en makes it a proposal, and says so', p.state === 'judge' && /RAPID Inf Bde \(assumed\)/.test(p.draft) && p.basis.some((b) => /En assumed/.test(b.text)) && s.confirm.length === 1);
  check('strength: the ORBAT pages are the basis', p.basis.some((b) => b.kind === 'data' && /p 12 \(inf-bn-std\)/.test(b.text) && /p 701/.test(b.text)));
  check('strength: Pls held against the need, ATGM pairs', /DP 1 needs 19 x pl; 1 x Inf Bn \(Std\) holds 12 x pl: short by 7 x pl/.test(M.find(d, 'own.ded.basic').draft) && /4 ATGM pairs held/.test(M.find(d, 'own.ded.basic').draft));
  check('strength: composition from the ORBAT', /4 manoeuvre Coys of 3 Pls, 850 all ranks, 8 ATGM launchers, 6 mortars/.test(M.find(d, 'own.comp').draft));
  const marked = W.writeStrength({ en: [{ ...bde, count: 2 }], enAssumed: null, own: [bn], ownAssumed: null, need: 10 });
  M.applyPatches(d, marked.patches);
  check('strength: marked units count, read from the map; spare Pls said', M.find(d, 'own.str').state === 'map' && M.find(d, 'own.str').table.rows[0][2] === '26' && /2 x pl to spare/.test(M.find(d, 'own.ded.basic').draft));
  check('strength: nothing without both sides', W.writeStrength({ en: [], enAssumed: null, own: [bn], ownAssumed: null, need: 1 }).patches.length === 0);
}

// ── time required ────────────────────────────────────────────────────────────────────────────────────────────────
{
  const tr = W.writeTimeReq({
    move: { from: '7 Bn at Pasrur', km: 18.4, kmh: 20, src: 'all types, good roads, by night' },
    prep: { h: [24, 36], src: 'IC s75 para 1 p 399' },
    mines: { frontM: 6100, engr: 'Engr Fd Coy (taken: one Engr Fd Coy)', handH: 63, mechH: null, perPl: 780, src: "SO's Hbk 2019 p 439" },
  });
  const d = M.newDoc('def');
  M.applyPatches(d, tr.patches);
  const t = M.find(d, 'ts.req').table;
  const row = (what) => t.rows.find((r) => r[1] === what);
  check('time: battle procedure first, the guide\'s specimen said', t.rows[0][1] === 'Battle procedure at all lvls' && t.rows[0][2] === '12' && /specimen \(Understanding Aprc Sec II sheet 7\)/.test(t.rows[0][3]));
  check('time: the move in as a lower bound', row('Mov / occupation of def')[2] === '0.9 +' && /18\.4 km in a straight line at 20 km\/h by night/.test(row('Mov / occupation of def')[3]));
  check('time: posn preparation and mine laying with their books', row('Prep of main def (altn / sec)')[2] === '24-36' && row('Protective M fd laying')[2] === '63' && M.find(d, 'ts.req').basis.some((b) => /p 399/.test(b.text)) && M.find(d, 'ts.req').basis.some((b) => /p 439/.test(b.text)));
  check('time: the guide\'s standard list, as specimen hours', row('Prep of C pen posn')[2] === '12' && row('C attk and C pen rehearsals')[2] === '8' && row('Laying of wire obs')[2] === '6' && row('Participation in Bde rehearsals')[2] === '12' && t.rows.length === 15);
  check('time: two totals, one row after the other and the critical path', row('Total, one row after the other')[2] === '198 +' && row('Total time (critical path)')[2] === '76 +' && tr.reqH > 75.9 && tr.reqH < 76 && M.find(d, 'ts.req').state === 'judge', `${row('Total, one row after the other')[2]} / ${row('Total time (critical path)')[2]} / ${tr.reqH}`);
  check('time: nothing known, nothing written', W.writeTimeReq({ move: null, prep: null, mines: null }).patches.length === 0);
}

// ── grouping and tasks ───────────────────────────────────────────────────────────────────────────────────────────
{
  const ct = W.writeCoyTasks([
    { label: 'D Coy', kind: 'depth', span: 'from incl Chak 21 to incl Pindi Dogran', units: ['Mor Pl'], moves: [{ to: 'C pen 1', min: 22, inTime: true }], catk: ['Kot Jaimal', 'Nurpur'] },
    { label: 'A Coy', kind: 'fwd', span: 'over Kot Jaimal', units: [], moves: [], catk: [] },
    { label: 'C pen 1', kind: 'cpen', span: null, units: [], moves: [], catk: [] },
  ]);
  const d = M.newDoc('def');
  M.applyPatches(d, ct.patches);
  const k = M.find(d, 'plan.exec.tasks').children;
  check('coys: fwd first, posns that are not Coys left out', k.map((c) => c.head).join('|') === 'A Coy|D Coy');
  check('coys: take up def posn over / from incl to incl, by a ruled time', M.find(d, 'plan.exec.tasks.a-coy.t1').draft === 'Take up def posn over Kot Jaimal by ________.' && M.find(d, 'plan.exec.tasks.d-coy.t1').draft === 'Take up def posn from incl Chak 21 to incl Pindi Dogran by ________.');
  check('coys: depth gets C attk and its what-if move as proposals', /Be prep to launch C attk on Kot Jaimal or Nurpur on orders\./.test(M.find(d, 'plan.exec.tasks.d-coy.t2').draft) && /Be prep to occupy C pen 1 on orders \(22 min: in time\)\./.test(M.find(d, 'plan.exec.tasks.d-coy.t3').draft) && M.find(d, 'plan.exec.tasks.d-coy.t2').state === 'judge');
  check('coys: grouping from what is in the posn, else the planner\'s', M.find(d, 'plan.exec.tasks.d-coy.grp').draft === 'In loc: Mor Pl.' && M.find(d, 'plan.exec.tasks.a-coy.grp').draft === null);
  check('coys: numbered under Exec', /^29b\(1\)$|^\d+b\(1\)$/.test(M.numberOf(d, 'plan.exec.tasks.a-coy')), M.numberOf(d, 'plan.exec.tasks.a-coy'));
  check('tasks: writeTasks says how many Pls', W.writeTasks(reading).pls === 17 && W.writeTasks({ ...reading, lines: [] }).pls === null);
}

// ── the attack (Mechs of Aprc (Attk)) ────────────────────────────────────────────────────────────────────────────
{
  const d = M.newDoc('attk');
  const ids = [];
  M.walk(d, (p) => ids.push(p.id));
  check('attk outline: ids are unique', new Set(ids).size === ids.length, `${ids.length}`);
  check('attk outline: parts in the book\'s order', d.parts.map((p) => p.title).join('|') === 'REVIEW OF THE SIT|AIM|FACTORS|COURSES|PLAN|ANX P: SKETCH');
  const top = M.lines(d).filter((l) => l.type === 'para' && l.depth === 0 && l.part.id !== 'anx');
  check('attk numbering: 24 paras as the book', top.length === 24 && top.every((l, i) => l.label === `${i + 1}.`), `${top.length}`);
  const at = (id) => M.numberOf(d, id);
  check('attk numbering: Gen Description 5, Imp Tac Grs 6, Apchs 7, Deductions 11', at('gr.gen') === '5' && at('gr.itg') === '6' && at('gr.apchs') === '7' && at('gr.ded') === '11');
  check('attk numbering: En Sit 12, Own Sit 13, Almt 14, Time and Space 15', at('en') === '12' && at('own') === '13' && at('almt') === '14' && at('ts') === '15');
  check('attk numbering: Course A 16, En Reactions 17, Analysis 18, Course Adopted 20', at('crs.a') === '16' && at('crs.react') === '17' && at('crs.an') === '18' && at('crs.adopted') === '20');
  check('attk numbering: Msn 21, Exec 22, Adm and Log 23, Comd and Sig 24', at('plan.msn') === '21' && at('plan.exec') === '22' && at('plan.adm') === '23' && at('plan.comd') === '24');
  check('attk numbering: sub-paragraphs as the book', at('gr.ded.aps') === '11d' && at('plan.exec.coord.loc') === '22h(2)' && at('crs.react.ph2.depth') === '17e(3)' && at('en.ded.basic') === '12c(1)', `${at('gr.ded.aps')} ${at('plan.exec.coord.loc')} ${at('crs.react.ph2.depth')} ${at('en.ded.basic')}`);
  let unref = 0;
  // the book's sheet, or (the doctrine review's heads, 24 Nov 2026) another book with its printed page
  const cites = (x) => /^Mechs of Aprc \(Attk\) pp? [\d-]+$/.test(x) || /\((?:OoW Vol I{1,3}|IBB|MIB|MW|DW|lsf|IDD|SO's Hbk 2019 Sec 12)\b[^()]*\bpp? \d[\d-]*[^()]*\)$/.test(x);
  M.walk(d, (p) => { if (p.draft === null && !p.prompts.some(cites)) unref++; });
  check('attk prompts: every ruled paragraph cites its book and page', unref === 0, `${unref} without`);
  check('attk tables: Assessment of Tasks and Almt with the book\'s heads, Backward Calc with its 18 events', M.find(d, 'own.tasks').table.head.join('|') === 'Ser|Task / Loc|Inf (Sec)|Armr (Tp)|Aslt Pnr|Arty|BS / W pn Sec' && M.find(d, 'almt').table.rows.some((r) => r[1] === '- FUP protection') && M.find(d, 'ts.calc').table.rows.length === 18 && M.find(d, 'ts.calc').table.rows[12][1] === 'H hr');
  const t = M.toText(d, 'fair');
  check('attk text: an empty attack prints ruled lines, never "whites"', t.includes('5. Gen Description. ________________') && t.includes('24. Comd and Sig.') && !/whites/i.test(t));
  const dt = M.toText(d, 'draft');
  check('attk text: the draft copy shows the book\'s heads under a ruled line', /\(Discuss two up; Hostilities between __ and __;.*Mechs of Aprc \(Attk\) p 1\)/.test(dt));
  M.applyPatches(d, M.attkHeads('Bn'));
  check('attk heads: a Bn attack names Coys, the Mor Pl and the Bn HQ', M.find(d, 'plan.exec.pl1').head === 'A Coy' && M.find(d, 'plan.exec.mor').head === 'Mor Pl' && M.find(d, 'plan.comd.hq').head === 'Loc of Bn HQ' && M.attkHeads('Coy').length === 0);
}
// the synthetic reading, taken round the objective from own side (its sides are his: own Lt = his Rt)
const ad = M.newDoc('attk');
{
  const sym = W.writeSymbols([
    { id: 'e1', key: '10110100', name: 'Infantry', side: 'enemy', ech: '15', label: '2 Coy', where: 'at Qila Mor' },
    { id: 'o1', key: '10110100', name: 'Infantry', side: 'own', ech: '16', label: '1 Bn', where: '6.0 km SW of Qila Mor' },
  ]);
  M.applyPatches(ad, sym.patches);
  const gw = W.writeGround({ ...gin, attack: true, threatMarked: true, startWords: 'FUP 1 2.1 km S of Kot Jaimal', mitgObsn: { near: null, radiusM: 2000, seenPct: 58, clearMedianM: 1300, country: 'open', overlook: null } });
  M.applyPatches(ad, gw.patches);
  ad.confirm = gw.confirm;
  ad.frame = gw.frame;
  const P = (id) => M.find(ad, id);
  check('attk Gr: Gen Description, Obs, Cover and Met as for the defence', /Canal plains\./.test(P('gr.gen').draft) && /February: max 21 °C/.test(P('gr.met').draft) && P('gr.obs').state === 'gr');
  check('attk Gr: the sides are mirrored to the attacker (his Lt is own Rt)', /across the Rt, Cen and Lt apchs/.test(P('gr.obs').draft) && /Rt BUAs 9 %/.test(P('gr.cover').draft), P('gr.obs').draft);
  const ap = P('gr.apchs');
  check('attk Apchs: own Lt first, from own side onto the obj', ap.children.map((c) => c.head).join('|') === 'Lt Apch|Cen Apch|Rt Apch' && /from own side onto Qila Mor/.test(ap.draft) && ap.figure === 'trace', ap.children.map((c) => c.head).join('|'));
  check('attk Apchs: the book\'s twelve heads in its order', ap.children.every((c) => c.children.map((x) => x.head).join('|') === 'Definition|Length|Capacity|Cover|Mutual Sp|Depl Areas|Obs|Dominating Features|Obsn and F of F|Tfc|Dir Keeping|Significance'));
  check('attk Apchs: own Lt is the reading\'s Rt (it narrows to 1.1 km)', /^No narrower than 1\.1 km between NO-GO areas: room for a Coy size force/.test(P('gr.apch.lt.capacity').draft) && /room for a Bn size force/.test(P('gr.apch.rt.capacity').draft), `${P('gr.apch.lt.capacity').draft} / ${P('gr.apch.rt.capacity').draft}`);
  check('attk Apchs: capacity rests on the IPB widths (the pamphlet), the two guides beside it', (() => { const b = P('gr.apch.lt.capacity').basis; const i = b.findIndex((x) => x.kind === 'rule' && /a Bde 3 km, a Div 6 km \(IPB book p 7\)/.test(x.text)); const j = b.findIndex((x) => /Mechs of Aprc/.test(x.text)); return i >= 0 && j > i; })() && P('gr.apch.lt.capacity').basis.some((b) => /Mechs of Aprc \(Attk\) p 2/.test(b.text) && /Understanding Aprc p 18/.test(b.text)));
  check('attk Apchs: Depl Areas left to the planner with the book\'s heads', P('gr.apch.lt.depl-areas').draft === null && P('gr.apch.lt.depl-areas').prompts.some((x) => /FAA, FUP or BOF/.test(x)) && P('gr.apch.lt.depl-areas').prompts.includes('Mechs of Aprc (Attk) p 2'));
  check('attk Apchs: Obsn and F of F where read (the reading\'s Lt is own Rt)', /about 41 % of the ground/.test(P('gr.apch.rt.obsn-and-f-of-f').draft) && P('gr.apch.lt.obsn-and-f-of-f').draft === null);
  const m = P('gr.itg.mitg');
  check('attk ITGs: the obj first with the book\'s heads', m.head === 'Qila Mor (MITG)' && m.children.map((c) => c.head).join('|') === 'Loc|Size / Type / Configuration|Tps Needed to Def|Tps Req to Capture|Depth|Mutual Sp|Cover|Obsn|Domination|Best Dir of Attk|Effs if Captured');
  check('attk ITGs: Loc, Cover, Obsn, Domination from the ground', /^Qila Mor, on Rd /.test(P('gr.itg.mitg.loc').draft) && /concealment from gr obsn fair/.test(P('gr.itg.mitg.cover').draft) && /From it about 58 % of the ground within 2\.0 km is in view toward own side/.test(P('gr.itg.mitg.obsn').draft) && /^247 m, plain/.test(P('gr.itg.mitg.domination').draft), P('gr.itg.mitg.loc').draft);
  check('attk ITGs: Effs if Captured a proposal from the Rds; Tps to capture the planner\'s', P('gr.itg.mitg.effs').state === 'judge' && /opens Rd/i.test(P('gr.itg.mitg.effs').draft) && P('gr.itg.mitg.capture').draft === null);
  check('attk ITGs: his localities on the lines facing the attk, sides mirrored', /Astride the Rt apch on Line X, the En likely FDLs/.test(P('gr.itg.kot-jaimal')?.draft ?? '') && P('gr.itg.kot-jaimal').state === 'judge' && /the En likely depth/.test(P('gr.itg.chak-21')?.draft ?? ''));
  check('attk Aim: to capture the obj, a proposal', P('aim').draft === 'To capture area Qila Mor with fol limitations:-' && P('aim').state === 'judge' && M.shown(P('aim'), 'fair').text === null);
  check('attk Deductions: pri of objs, MITG first with its reasons', /^Qila Mor emerges as the MITG: all 3 apchs terminate on it/.test(P('gr.ded.obj').draft) && /\(1\) Kot Jaimal/.test(P('gr.ded.obj').draft), P('gr.ded.obj').draft);
  check('attk Deductions: comb of apchs mirrored, phases from his lines', /Rt and Cen \(2 metalled laterals\)/.test(P('gr.ded.comb').draft) && /^Phase 1: the En's FDLs on Line X/.test(P('gr.ded.c.phases').draft), `${P('gr.ded.comb').draft} / ${P('gr.ded.c.phases').draft}`);
  check('attk Gr: the frame says where own tps start', /own start FUP 1/.test(ad.frame.threat));
  check('attk Gr: never the 1:50k layer name', !/NCGDB/.test(JSON.stringify(ad)));
  check('attk symbols: his disposns under Option 1', /Marked on the map: 1 x Infantry Coy/.test(P('en.opt1.disp').draft) && P('en.opt1.disp').state === 'map' && /1 x Infantry Coy/.test(P('rev.en').draft));
}
{
  // the IPB reading onto the obj: Lt / Rt flank, frontal, turning
  const av = (o) => ({ id: 'A', rank: 1, onto: 'left', label: 'Lt flanking', lengthM: 6200, goPct: 80, minWidthM: 1400, waterLines: 1, assaultM: 1100, assaultNogoPct: 0, fupWhere: '1.1 km W of Qila Mor', ...o });
  const e = { objective: 'Qila Mor', mover: 'dismounted inf', aaFor: 'Bn', mcWidthM: 500, fupM: 1100, start: 'own start', startAssumed: false,
    avenues: [av({ id: 'F', rank: 1, onto: 'frontal', label: 'Frontal', lengthM: 5000 }), av({ id: 'L', rank: 2 }), av({ id: 'R', rank: 3, onto: 'right', label: 'Rt flanking', lengthM: 7100, goPct: 90, waterLines: 0, fupWhere: '1.1 km E of Qila Mor' })],
    turn: { label: 'Br on Lakhan Disty', kind: 'bridge', behindM: 2600, msr: true, where: '2.6 km N of Qila Mor' } };
  const dw = W.writeAttkDir(e);
  const d = M.newDoc('attk');
  M.applyPatches(d, dw.patches);
  const P = (id) => M.find(d, id);
  check('attk dir: flanks before frontal, frontal last', /^Dir of attk in pri: \(1\) Lt flank.*\(2\) Rt flank.*\(3\) frontal/.test(P('gr.ded.apch').draft), P('gr.ded.apch').draft);
  check('attk dir: Lt against Rt weighed head by head', /Lt against Rt: Lt shorter \(6\.2 against 7\.1 km\); Rt better going \(GO on 90 % against 80 %\); Rt fewer water lines \(0 against 1\)\. Better on 2 of 3 heads: the Rt\./.test(P('gr.ded.apch').draft), P('gr.ded.apch').draft);
  check('attk dir: the turning apch onto his MSR choke', /blocks the En MSR at Br on Lakhan Disty \(bridge\), 2\.6 km behind Qila Mor/.test(P('gr.ded.apch').draft) && /^At Br on Lakhan Disty \(2\.6 km N of Qila Mor\): a bridge on the En MSR/.test(P('gr.ded.ap1.block').draft));
  check('attk dir: AP-1 from the flank the weighing favours, FUP from IBB p 201', /^To attk from the Rt flank onto Qila Mor, with a blocking posn on the En's MSR behind it\.$/.test(P('gr.ded.ap1').draft) && /^1\.1 km E of Qila Mor, 1\.1 km short of Qila Mor/.test(P('gr.ded.ap1.fup').draft) && P('gr.ded.ap1.fup').basis.some((b) => /IBB p 201/.test(b.text)), `${P('gr.ded.ap1').draft} / ${P('gr.ded.ap1.fup').draft}`);
  check('attk dir: Best Dir of Attk on the MITG and AP-2 the other flank', P('gr.itg.mitg.dir').draft === 'Rt flank onto Qila Mor.' && /^From the Lt flank: changes the dir of attk/.test(P('gr.ded.ap2').draft));
  check('attk dir: all proposals, cited (flanking: the book pp 3-4; turning: IBB S35 p 140)', ['gr.ded.apch', 'gr.ded.ap1', 'gr.ded.ap1.block'].every((id) => P(id).state === 'judge') && P('gr.ded.apch').basis.some((b) => /pp 3-4/.test(b.text)) && P('gr.ded.ap1.block').basis.some((b) => /IBB S35 p 140/.test(b.text)));
  check('attk dir: no apch onto the obj, nothing written', W.writeAttkDir({ ...e, avenues: e.avenues.map((a) => ({ ...a, onto: null })) }).patches.length === 0);
}
{
  // a checked attack plan
  const c = { title: 'Bn attack: 2 axes onto 2 enemy posns', recipe: 'bn-attk-right-flank',
    axes: [
      { label: 'Main Attk', phase: 1, obj: 'Obj 1', objWhere: 'at Kot Jaimal', fup: 'FUP', fupWhere: '1.1 km E of Kot Jaimal', sl: 'SL', bof: 'BOF', bofWhere: '0.9 km N of Kot Jaimal', rows: [{ name: 'FUP from the Obj', st: 'pass', reason: '1,100 m to the Obj\'s near edge' }, { name: 'BOF range', st: 'warn', reason: '1,300 m; 106 mm RR reaches 1,189 m' }] },
      { label: 'Ph 2', phase: 2, obj: 'Obj 2', objWhere: 'at Qila Mor', fup: 'FUP 2', fupWhere: null, sl: null, bof: null, bofWhere: null, rows: [] },
    ],
    rows: [{ name: 'Force ratio', st: 'pass', reason: '4 : 1' }], confirm: ['Main Attk: FUP and SL by recce'], assumptions: ['Read as drawn'] };
  const pw = W.writeAttkPlan(c);
  const d = M.newDoc('attk');
  M.applyPatches(d, pw.patches);
  const P = (id) => M.find(d, id);
  check('attk plan: Course A and the Gen Outline from the plan, flank and phases', /^Bn attack: 2 axes onto 2 enemy posns\. Attk from the Rt flank in 2 phases: Phase 1: Main Attk onto Obj 1 \(at Kot Jaimal\), FUP 1\.1 km E of Kot Jaimal, SL, BOF 0\.9 km N of Kot Jaimal\. Phase 2: Ph 2 onto Obj 2 \(at Qila Mor\), FUP 2\./.test(P('crs.a').draft) && P('plan.exec.outline').state === 'map', P('crs.a').draft);
  check('attk plan: AP-1 phases, FUP, BOF and Loc as drawn', P('gr.ded.ap1.ph1').draft === 'Capturing Obj 1.' && P('gr.ded.ap1.ph2').draft === 'Capturing Obj 2.' && /as drawn/.test(P('gr.ded.ap1.fup').draft) && /^FUP 1\.1 km E of Kot Jaimal; BOF 0\.9 km N of Kot Jaimal; SL\.$/.test(P('plan.exec.coord.loc').draft));
  check('attk plan: the tasks tables name the objs by phase, the figures left blank', P('own.tasks').table.rows.some((r) => r[1] === '- Obj 1') && P('almt').table.rows.some((r) => r[1] === '- Obj 2') && P('own.tasks').table.rows.every((r) => r.slice(2).every((x) => x === '')));
  check('attk plan: advs and disadvs from the check rows, proposals', /Force ratio: 4 : 1/.test(P('crs.an.adv').draft) && /Main Attk: BOF range/.test(P('crs.an.dis').draft) && P('crs.an.dis').state === 'judge' && pw.confirm.length === 2);
}
{
  // relative strength for the attack: own to en, 3 : 1
  const bn = { name: 'Inf Bn (Std)', count: 1, coys: 4, strength: 850, atgm: 8, mortars: 6, plsPerCoy: 3, src: "SO's Hbk 2019 p 12 (inf-bn-std)" };
  const coy = { name: 'En Inf Coy', count: 1, coys: 1, strength: 120, atgm: 2, mortars: 2, plsPerCoy: 3, src: "SO's Hbk 2019 Sec 13 (en-inf-coy)" };
  const s = W.writeStrength({ en: [coy], enAssumed: 'one level down', own: [bn], ownAssumed: null, need: null }, { attack: true, disposns: '1 Bn (Bn) 6.0 km SW of Qila Mor' });
  const d = M.newDoc('attk');
  M.applyPatches(d, s.patches);
  const p = M.find(d, 'own.str');
  check('attk strength: ratio own to en, against the usual 3 : 1 (IBB p 248; MW p 80 only in mountains)', p.table.rows[0][4] === '4.0 : 1' && /more than the 3 : 1 an attacker wants\.$/.test(p.draft) && p.basis.some((b) => /IBB p 248/.test(b.text)) && !p.basis.some((b) => /MW p 80/.test(b.text)), JSON.stringify(p.table.rows[0]));
  { const pm = W.writeStrength({ en: [coy], enAssumed: 'one level down', own: [bn], ownAssumed: null, need: null }, { attack: true, mountains: true }).patches.find((x) => x.id === 'own.str');
    check('attk strength: in mountains MW p 80, comparatively more than 3 : 1, in sequence', pm.basis.some((b) => /MW p 80/.test(b.text) && /no figure printed/.test(b.text)) && /in mountains comparatively more is wanted, in sequence/.test(pm.draft), pm.draft); }
  check('attk strength: composition and disposns in one paragraph', /4 manoeuvre Coys of 3 Pls/.test(M.find(d, 'own.comp').draft) && /Disposns: 1 Bn \(Bn\) 6\.0 km SW of Qila Mor\./.test(M.find(d, 'own.comp').draft));
}
{
  // copies, Word and slides walk the attack outline
  const o = { copy: 'draft', blankBg: 'data:image/png;base64,BBBB' };
  const fair = H.bodyHtml(ad, 'fair'), draft = H.bodyHtml(ad, 'draft');
  check('attk page: the fair copy prints facts, not open proposals', !fair.includes('Qila Mor emerges') && draft.includes('Qila Mor emerges') && fair.includes('Canal plains'));
  const x = D.docxFiles(ad, 'fair')['word/document.xml'];
  check('attk Word: the document carries the attack headings', x.includes('Imp Tac Grs') && x.includes('Almt of Tps to Task') && x.includes('Comd and Sig') && !/whites/i.test(x));
  const full = K.buildDeck(ad, { ...o, kind: 'full' });
  const dec = K.buildDeck(ad, { ...o, kind: 'decision' });
  const sand = K.buildDeck(ad, { ...o, kind: 'sand' });
  const tt = full.map((s) => s.title);
  check('attk slides: the full brief has the apchs one by one', ['Apchs', 'Lt Apch', 'Cen Apch', 'Rt Apch', 'Gen Description', 'Imp Tac Grs'].every((t) => tt.includes(t)), tt.join(' | '));
  check('attk slides: decision brief reaches into En Sit and Own Sit', dec.some((s) => s.sourceRef === 'aprc:en.opts') && dec.length < full.length, dec.map((s) => s.sourceRef).join(' '));
  check('attk slides: sand model is the ground only', sand.length > 1 && sand.every((s) => !/^aprc:(aim|en|own|crs|plan)/.test(s.sourceRef ?? '')));
  check('attk slides: the book\'s blank tables make no slide until drafted or typed', !full.some((s) => s.sourceRef === 'aprc:ts.calc' || s.sourceRef === 'aprc:own.tasks'));
  check('attk kinds: a defence deck is unchanged by the attack lists', K.DECK_IDS.def.decision.includes('en.opts') && !K.DECK_IDS.def.decision.includes('own.tasks'));
}

// ── a Read that cannot read again keeps the reading (fix 1), what changed (18), H re-times only times (2) ────────────
{
  const prev = M.newDoc('def');
  M.applyPatches(prev, W.writeGround(gin).patches, 'gr');
  M.applyPatches(prev, [{ id: 'en.opt1.what', draft: 'Old option.', state: 'judge' }], 'en');
  M.applyPatches(prev, [{ id: 'rev.en', draft: 'Marked: 1 x Bde.', state: 'map' }], 'map');
  prev.frame = gw.frame;
  prev.sources = ['Land cover (2021)'];
  prev.confirm = [{ text: 'Walk the Lt apch.', paras: ['gr.apchs'], src: 'gr' }, { text: 'Symbols old.', paras: ['rev.en'], src: 'map' }];
  prev.readAt = { gr: '2027-02-15 11:00', en: '2027-02-15 11:00' };
  M.setMine(prev, 'gr.obs', 'My obs.');
  // this Read: the ground not read, the map read again
  const next = M.newDoc('def');
  M.applyPatches(next, [{ id: 'rev.en', draft: 'Marked: 2 x Bde.', state: 'map' }], 'map');
  const kept = M.keepUnread(prev, next, ['gr', 'en', 'orbat', 'time']);
  check('keep: the ground not read keeps the earlier Gr paragraphs, frame, data and their Confirm items', kept > 5 && M.find(next, 'gr.gen').draft === M.find(prev, 'gr.gen').draft && M.find(next, 'gr.apchs').children.length === 3 && next.frame?.place === 'Qila Mor' && next.sources.length === 1 && next.confirm.some((c) => c.text === 'Walk the Lt apch.') && !next.confirm.some((c) => c.text === 'Symbols old.') && next.readAt.gr === '2027-02-15 11:00', `${kept}`);
  check('keep: the en options not read are kept too; what was read again wins', M.find(next, 'en.opt1.what').draft === 'Old option.' && M.find(next, 'rev.en').draft === 'Marked: 2 x Bde.');
  check('keep: nothing kept from a sheet of the other kind', M.keepUnread(M.newDoc('attk'), M.newDoc('def'), ['gr']) === 0);
  const ch = M.markChanges(prev, next);
  check('changed: only what this Read changed is marked, with what it said before', ch === 1 && M.find(next, 'rev.en').changed === 'map' && M.find(next, 'rev.en').before.draft === 'Marked: 1 x Bde.' && !M.find(next, 'gr.gen').changed, `${ch}`);
  check('changed: nothing marked against a sheet never read', M.markChanges(null, next) === 0 && !M.find(next, 'rev.en').changed);
  M.carryOver(prev, next);
  check('keep: his words ride on the kept reading, not stale', M.find(next, 'gr.obs').mine.text === 'My obs.' && !M.isStale(M.find(next, 'gr.obs')));
  // stale reasons
  const n3 = M.newDoc('def');
  M.applyPatches(n3, [{ id: 'gr.obs', draft: 'Different obs.', state: 'gr' }, { id: 'rev.en', draft: 'Marked: 3 x Bde.', state: 'map' }], 'gr');
  M.applyPatches(n3, [{ id: 'rev.en', src: 'map' }]);
  M.markChanges(next, n3);
  M.carryOver(next, n3);
  check('stale: says what changed under his words (Gr)', M.staleWhy(M.find(n3, 'gr.obs')) === 'gr' && M.shown(M.find(n3, 'gr.obs'), 'draft').why === 'gr');
  M.setMine(n3, 'rev.en', 'My en.');
  const rt = M.retime(n3, [{ id: 'rev.en', draft: 'Marked at H+1.', state: 'map' }], ['map']);
  check('retime: a clock change marks his words "H changed", not Gr', rt === 1 && M.staleWhy(M.find(n3, 'rev.en')) === 'h' && M.find(n3, 'rev.en').changed === 'h' && M.STALE_MARK.h === 'H changed since');
  check('retime: a paragraph from another reading is left alone (a reactions table the plan settled)', (() => { const d = M.newDoc('def'); M.applyPatches(d, [{ id: 'crs.react', draft: '', state: 'judge', table: { head: ['Ser', 'En', 'Own'], rows: [['a.', 'Plan row', 'x']] } }], 'plan'); return M.retime(d, [{ id: 'crs.react', draft: '', state: 'judge', table: { head: ['Ser', 'En', 'Own'], rows: [['a.', 'IPB row', 'y']] } }], ['en', 'time']) === 0 && M.find(d, 'crs.react').table.rows[0][1] === 'Plan row'; })());
  check('text, page and Word mark stale by what changed', /H changed since\]/.test(M.toText(n3, 'draft')) && /H CHANGED SINCE/.test(H.bodyHtml(n3, 'draft')) && /H CHANGED SINCE/.test(D.docxFiles(n3, 'draft')['word/document.xml']));
  // given back words are kept
  M.setMine(n3, 'gr.obs', null);
  check('give back: his words are kept to put back', M.find(n3, 'gr.obs').discarded.text === 'My obs.' && !M.find(n3, 'gr.obs').mine && M.restoreDiscarded(n3, 'gr.obs') && M.find(n3, 'gr.obs').mine.text === 'My obs.' && !M.find(n3, 'gr.obs').discarded);
  const c = M.counts((() => { const d = M.newDoc('def'); M.applyPatches(d, [{ id: 'gr.ded.pri', draft: 'A.', state: 'judge' }, { id: 'gr.ded.comb', draft: 'B.', state: 'judge' }]); M.accept(d, 'gr.ded.pri'); return d; })());
  check('counts: accepted proposals counted as accepted, not open', c.accepted === 1 && c.open === 1 && c.judge === 2, JSON.stringify(c));
}
// ── opening a file (13) ──────────────────────────────────────────────────────────────────────────────────────────
{
  const raw = JSON.parse(JSON.stringify(M.newDoc('attk')));
  delete raw.figures; delete raw.confirm; delete raw.sources; raw.marking = 'SECRET';
  raw.parts[2].groups[0].paras[0].basis = undefined;
  const t = raw.parts[1].groups[0].paras[0];
  const n = M.normalizeDoc(raw);
  check('open: an older or hand-edited file gets the arrays the sheet reads', n && Array.isArray(n.figures) && Array.isArray(n.confirm) && Array.isArray(n.sources) && n.kind === 'attk' && !('marking' in n) && Array.isArray(n.parts[2].groups[0].paras[0].basis) && !!t);
  check('open: not an appreciation, refused', M.normalizeDoc({ version: 2, parts: [] }) === null && M.normalizeDoc(null) === null && M.normalizeDoc('x') === null);
  check('open: toText and the page run on it', M.toText(n, 'draft').length > 100 && H.bodyHtml(n, 'draft').length > 100);
  // a sheet kept before drafts carried their reading: the reading is told from the id, so a Read that cannot read keeps it
  const legacy = JSON.parse(JSON.stringify(doc));
  M.walk(legacy, (p) => { delete p.src; });
  const ln = M.normalizeDoc(legacy);
  const fresh = M.newDoc('def');
  check('open: an older sheet gets its readings told from the ids, and a Read without the ground keeps them', M.find(ln, 'gr.gen').src === 'gr' && M.find(ln, 'own.str').src === 'orbat' && M.keepUnread(ln, fresh, ['gr', 'orbat']) > 5 && M.find(fresh, 'gr.gen').draft === M.find(doc, 'gr.gen').draft);
}
// ── unique ids (14) ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const u = new Set(['gr.itg.more']);
  check('ids: a repeat gets -2, -3; a fixed id is never taken', M.uniqueId(u, 'a') === 'a' && M.uniqueId(u, 'a') === 'a-2' && M.uniqueId(u, 'a') === 'a-3' && M.uniqueId(u, 'gr.itg.more') === 'gr.itg.more-2');
  const ct = W.writeCoyTasks([{ label: 'A Coy', kind: 'fwd', span: null, units: [], moves: [], catk: [] }, { label: 'A Coy', kind: 'fwd', span: 'over X', units: [], moves: [], catk: [] }]);
  const d = M.newDoc('def');
  M.applyPatches(d, ct.patches);
  const ids = [];
  M.walk(d, (p) => ids.push(p.id));
  check('ids: two posns of one name give unique ids', new Set(ids).size === ids.length && !!M.find(d, 'plan.exec.tasks.a-coy-2.t1'));
  const r2 = { ...reading, lines: [...reading.lines.slice(0, 1), { ...reading.lines[1], buas: ['More', 'Chak-21', null] }, { ...reading.lines[2], buas: ['Chak 21', null, null] }, reading.lines[3]] };
  const d2 = M.newDoc('def');
  M.applyPatches(d2, W.writeGround({ ...gin, reading: r2 }).patches);
  const ids2 = [];
  M.walk(d2, (p) => ids2.push(p.id));
  check('ids: ITGs whose names slug alike, or a place called More, stay unique', new Set(ids2).size === ids2.length && !!M.find(d2, 'gr.itg.chak-21-2') && !!M.find(d2, 'gr.itg.more-2'), ids2.filter((x) => x.startsWith('gr.itg.')).join(' '));
}
// ── the writer's new paragraphs (24-31) ──────────────────────────────────────────────────────────────────────────
{
  const g = W.writeGround({ ...gin, threatMarked: true, threatWords: 'the Threat marker, 6.2 km N of Qila Mor' });
  check('threat: the marker in words in the frame and the basis', g.frame.threat === 'the Threat marker, 6.2 km N of Qila Mor' && g.patches.find((x) => x.id === 'gr.apchs').basis.some((b) => /Threat marker, 6\.2 km N/.test(b.text)));
  const dp2 = g.patches.find((x) => x.id === 'gr.ded.dp2');
  check('DP 2: stepped back to the depth line, a proposal', dp2.state === 'judge' && /^FDLs on Line Y \(Chak 21 – Jhanda/.test(dp2.draft) && /Line X \(Kot Jaimal – Dhok Rai\) held by a screen/.test(dp2.draft), dp2.draft);
  check('DP 2: no depth line, left to the planner', W.writeGround({ ...gin, reading: { ...reading, lines: reading.lines.map((l) => (l.role === 'Depth' ? { ...l, role: '' } : l)) } }).patches.find((x) => x.id === 'gr.ded.dp2').draft === null);
  const five = [{ ...reading.lines[0], id: 'V', depthM: 900 }, ...reading.lines, { ...reading.lines[2], id: 'Y2', role: '', depthM: 5200 }];
  const g5 = W.writeGround({ ...gin, reading: { ...reading, lines: five } });
  const poss = g5.patches.find((x) => x.id === 'gr.ded.lines').children[0];
  check('lines: as many as the reading gives, from the front by depth, the MITG line last', poss.children.map((c) => c.head).join('|') === 'Line V|Line W|Line X|Line Y|Line Y2|Line Z', poss.children.map((c) => c.head).join('|'));
  const ob = { near: 'Burj', radiusM: 2000, seenPct: 40, clearMedianM: 800, country: 'open', overlook: null, points: 3, minSeenPct: 22, maxSeenPct: 61, worstNear: 'Burj' };
  const gs = W.writeGround({ ...gin, obsn: { Lt: ob } });
  const lo = gs.patches.find((x) => x.id === 'gr.apchs').children[0].children.find((c) => c.id === 'gr.apch.lt.obsn');
  check('Obsn: sampled along the apch, the spread and the worst place said', /about 40 % \(22-61 % at 3 points; least near Burj\) of the ground within 2\.0 km is in view from points along it/.test(lo.draft) && lo.basis.some((b) => /at 3 points along/.test(b.text)), lo.draft);
  const sw = W.writeSymbols([{ id: 'h', key: '10110000', name: 'Infantry', side: 'own', ech: '16', label: '7 Bn', where: '1.2 km S of Qila Mor', hq: true }, { id: 'h2', key: '10110000', name: 'Infantry', side: 'enemy', ech: '16', label: 'X', where: null, hq: true }]);
  const hq = sw.patches.find((x) => x.id === 'plan.comd');
  check('HQ: own HQ symbols in Comd and Sig, from the map', hq?.state === 'map' && hq.draft === 'HQ as marked: 7 Bn (Bn HQ) 1.2 km S of Qila Mor.' && W.writeSymbols([{ id: 'h', key: '10110000', name: 'Infantry', side: 'own', ech: '15', label: 'A', where: null, hq: true }], { attack: true }).patches.some((x) => x.id === 'plan.comd.hq'));
  const bn = { name: 'Inf Bn (Std)', count: 1, coys: 4, strength: 850, atgm: 8, mortars: 6, plsPerCoy: 3, src: 'x' };
  const st = W.writeStrength({ en: [{ ...bn, name: 'En Bn', coys: 3 }], enAssumed: null, own: [bn], ownAssumed: null, need: null }, { attack: true });
  check('strength: the advice is a proposal of its own; the figures stay a fact', !/phase the attk/.test(st.patches.find((x) => x.id === 'own.str').draft) && st.patches.find((x) => x.id === 'own.str').state === 'map' && st.patches.find((x) => x.id === 'own.ded.addl')?.state === 'judge' && /phase the attk/.test(st.patches.find((x) => x.id === 'own.ded.addl').draft));
  const fire = W.writeFire({ posnSide: 'own', posns: 4, assumedRange: true, lines: [{ id: 'AA 1', coveredPct: 55, screenedPct: 10, deadPct: 20, outPct: 15, seenPct: 62, gaps: [{ fromM: 3200, toM: 4100, kind: 'd' }, { fromM: 0, toM: 2100, kind: 'o' }, { fromM: 5000, toM: 5100, kind: 's' }] }], killing: [{ on: 'AA 1', kind: 'narrows', widthM: 400, lengthM: 600, alongM: 4600, where: '0.8 km E of Burj' }] });
  const fd = M.newDoc('def');
  M.applyPatches(fd, fire.patches);
  check('fire: killing areas, DF, Surv and Obs from own fire, all proposals with OoW Vol I pp 42-45', /^The narrows \(0\.4 km wide\) on AA 1, 4\.6 km along \(0\.8 km E of Burj\)\.$/.test(M.find(fd, 'gr.ded.dp1.killing').draft) && /AA 1 3\.2-4\.1 km along \(dead\)/.test(M.find(fd, 'gr.ded.dp1.df').draft) && !/5\.0-5\.1/.test(M.find(fd, 'gr.ded.dp1.df').draft) && /AA 1 62 % of its length/.test(M.find(fd, 'gr.ded.dp1.surv').draft) && /on AA 1 4\.6 km along/.test(M.find(fd, 'gr.ded.dp1.obs').draft) && ['killing', 'df', 'surv', 'obs'].every((k) => M.find(fd, `gr.ded.dp1.${k}`).state === 'judge') && M.find(fd, 'gr.ded.dp1.killing').basis.some((b) => /OoW Vol I pp 42-45/.test(b.text)) && fire.confirm.length === 1, M.find(fd, 'gr.ded.dp1.killing').draft);
  check('fire: the en posns firing (an attack reading) write nothing here', W.writeFire({ posnSide: 'enemy', posns: 1, assumedRange: false, lines: [{ id: 'x', coveredPct: 1, screenedPct: 0, deadPct: 0, outPct: 0, seenPct: 1, gaps: [] }], killing: [] }).patches.length === 0);
  const air = W.writeAir({ lzs: [{ id: 'LZ 2', rank: 2, where: 'at Burj', why: '', existing: null }, { id: 'LZ 1', rank: 1, where: '1.1 km N of Nurpur', why: '', existing: 'helipad' }], dzs: [{ id: 'DZ 1', rank: 1, where: null, why: '' }], routes: [{ id: 'A1', to: 'Qila Mor', lengthM: 12000, seenPct: 30 }], band: 'NOE' });
  const ap = air.patches[0];
  check('air: his likeliest LZs and DZs in Common Deductions, a proposal, the book and the US figures said', ap.id === 'en.ded.common' && ap.state === 'judge' && /^Heliborne: the En's likeliest LZs LZ 1 1\.1 km N of Nurpur \(helipad\) and LZ 2 at Burj; DZs DZ 1\./.test(ap.draft) && ap.basis.some((b) => /IPB book pp 5-6/.test(b.text) && /to confirm/.test(b.text)) && ap.prompts === undefined, ap.draft);
  check('air: none read, nothing written', W.writeAir({ lzs: [], dzs: [], routes: [], band: '' }).patches.length === 0);
  const td = M.newDoc('def');
  M.applyPatches(td, W.writeTimeData({ hHour: '06:00', reqH: 88, fdlH: 0.9 }).patches);
  check('time data: D Day, occupied by H less the Time Req, ready by H with his earliest at the FDLs', M.find(td, 'ts.data.d-day').draft === 'H at 0600 hrs on D Day.' && /^Not later than H-88 \(1400 hrs D-4\)/.test(M.find(td, 'ts.data.time-by-which-def-to-be-occupied').draft) && /^By H \(0600 hrs D Day\): the En sets out at H and can be at the FDLs from H\+0:54 \(0654 hrs D Day\), unopposed\.$/.test(M.find(td, 'ts.data.time-by-which-def-to-be-ready').draft) && M.find(td, 'ts.data.i-day').draft === null, M.find(td, 'ts.data.time-by-which-def-to-be-occupied').draft);
  check('time data: nothing known, nothing written', W.writeTimeData({ hHour: null, reqH: null, fdlH: null }).patches.length === 0);
  check('H-hour sum: read from the plan row\'s words', JSON.stringify(W.hSumFromText('leave the Assy Area H-1 h 30 (night rates, IBB p 18); fup to sl 300 m 4 min; fire lifts 200 m H+5 min (IC s66 p305); on Obj 1 H+42 min; H2 H+95 min, fire lifts on Obj 2 100 m H+100 min, on Obj 2 H+130 min')) === JSON.stringify({ leaveBeforeMin: 90, objMin: 42, h2Min: 95, obj2Min: 130 }) && W.hSumFromText('nothing') === null && W.parseHRel('H') === 0);
  const tc = W.writeTimeCalcAttk('02:00', { leaveBeforeMin: 90, objMin: 42, h2Min: 95, obj2Min: 130 }).patches[0];
  const rowOf = (e) => tc.table.rows.find((r) => r[1] === e);
  check('time calc (attk): H on its row, the plan\'s march, assault and Phase 2', rowOf('H hr')[3] === 'H (0200 hrs D Day)' && rowOf('FAA to FUP')[2] === '90 min' && rowOf('FAA to FUP')[3] === 'H-1:30 (0030 hrs D Day)' && rowOf('FUP to Obj Phase 1')[3] === 'H+0:42 (0242 hrs D Day)' && rowOf('SL to Obj Phase 2')[2] === '35 min' && tc.table.rows.length === 18 && tc.state === 'judge', JSON.stringify(rowOf('FAA to FUP')));
  check('time calc (attk): neither H nor a plan, the book\'s blank table stays', W.writeTimeCalcAttk(null, null).patches.length === 0 && W.writeTimeCalcAttk('02:00', null).patches[0].table.rows.filter((r) => r[3]).length === 1);
  const adm = W.writeAdm({ kind: 'BAA', sites: [{ rank: 2, where: 'at Burj', tone: 'warn', verdict: 'Needs a culvert.' }, { rank: 1, where: '2 km S of Nurpur', tone: 'ok', verdict: '' }] });
  check('adm: the Admin Area finder\'s best sites, a proposal to walk', adm.patches[0].id === 'plan.adm' && adm.patches[0].draft === 'BAA: site 1 2 km S of Nurpur (passes); site 2 at Burj (needs work: Needs a culvert).' && adm.patches[0].state === 'judge' && adm.confirm.length === 1 && W.writeAdm({ kind: 'BAA', sites: [] }).patches.length === 0, adm.patches[0].draft);
}

// ── the two Aprc books' mechanics (Understanding Aprc, Mechs of Aprc (Attk); 24 Nov 2026) ─────────────────────────
{
  const X = await import('../../MS/Engines/GroundAppreciation/AprcMechs.ts');
  // D-times
  check('mechs: D-times parse as the books write them', X.parseDTime('0600 D+1') === 1800 && X.parseDTime('D-1 1000') === -840 && X.parseDTime('1000 hrs D-10') === -13800 && X.parseDTime('06:00 D Day') === 360 && X.parseDTime('0600') === 360 && X.parseDTime('2400') === null && X.parseDTime('') === null && X.dClock(1505) === '0105 hrs D+1');
  check('mechs: day lt and ni hrs between two D-times', (() => { const dn = X.dayNight(-840, 360, 360, 1080); return dn.day === 8 && dn.ni === 12; })() && X.lastLtBefore(360, 1080) === -360 && X.lastLtBefore(1300, 1080) === 1080);

  // 2 up / 3 up: the pamphlet drives, the guide beside
  const c4 = X.coysUp(4000), c76 = X.coysUp(7600), c12 = X.coysUp(12000), c68 = X.coysUp(6800);
  check('mechs: Coys up by IBB p 481 (two up to 4.5 km, three to 6.5 km, then extended)', c4.up === 2 && !c4.ext && c76.up === 3 && c76.ext && c76.guideUp === 3 && c76.plsUp === 2 && c12.plsUp === 3 && /extended frontage/.test(c76.text) && c76.basis[0].text.includes('IBB Annex U App 6 p 481'), c76.text);
  check('mechs: where the guide differs the pamphlet is taken, and said', X.coysUp(5500).up === 3 && X.coysUp(5500).guideUp === 2 && /the pamphlet's figure is taken/.test(X.coysUp(5500).text) && /between its bands/.test(c68.text) && X.coysUp(7600, 2).up === 2 && /held to 2 Coys up by the aim/.test(X.coysUp(7600, 2).text));

  // the def laid by the aim
  const L0 = X.layoutDef(reading, {}, 'Bn');
  check('mechs: no limitation, the reading\'s roles stand', L0.fdl.id === 'X' && L0.depth.id === 'Y' && L0.ahead.map((l) => l.id).join() === 'W' && L0.strPt.id === 'Z' && !L0.moved && L0.screenKm[0] === 1.5 && L0.screenKm[1] === 2 && L0.detsWhere === 'on Line W (Sukh Nala)', JSON.stringify(L0.screenKm));
  const Lf = X.layoutDef(reading, { fwd: true }, 'Bn');
  check('mechs: as far fwd as tac feasible: the line nearest 5-8 km past the border, depth behind it', Lf.fdl.id === 'Y' && Lf.depth.id === 'Z' && Lf.ahead.map((l) => l.id).join() === 'W,X' && Lf.moved && Lf.detsWhere === '1.5-2 km past the Intl Border' && /the line nearest the 5-8 km a Bn leaves/.test(Lf.reasons[0]) && Lf.basis.some((b) => /Understanding Aprc p 3/.test(b.text)), Lf.reasons[0]);
  const Ln = X.layoutDef(reading, { noPen: 'Y' }, 'Bn');
  check('mechs: no pen beyond Line Y: the depth on it, the FDLs 3-5 km ahead (OoW Vol I p 17 cited)', Ln.fdl.id === 'W' && Ln.depth.id === 'Y' && Ln.detsWhere === null && Ln.basis.some((b) => /OoW Vol I p 17/.test(b.text)) && /held in depth, the FDLs 2\.8 km ahead/.test(Ln.reasons[0]), Ln.reasons[0]);
  const La = X.layoutDef(reading, { allCosts: 'Qila Mor', salient: true }, 'Bn');
  check('mechs: def at all costs puts the depth on it; a salient is a prompt', La.depth.id === 'Z' && La.prompts.some((x) => /def at its base/.test(x)) && La.reasons.some((x) => /Qila Mor, to be def at all costs, is held in depth on Line Z/.test(x)));
  const lp = X.writeLayoutDef(L0, reading);
  const LP = (id) => lp.find((x) => x.id === id);
  check('mechs: lines of def in pri with the reasons for pri 1', /^Pri of lines of def: \(1\) Line X \(FDLs\), \(2\) Line Y \(depth\), \(3\) Line W \(protective dets\), \(4\) Line Z \(str pt Qila Mor\)\. Reasons for Line X as pri 1: \(a\) It draws str from the gr: along Lakhan Disty/.test(LP('gr.ded.lines.pri').draft) && LP('gr.ded.lines.pri').state === 'judge', LP('gr.ded.lines.pri').draft);
  check('mechs: DP 1 FDLs with Coys up; screens 1-1.5 km ahead (OoW Vol I Annex A p 102 first)', /^Line X \(Kot Jaimal – Dhok Rai\) along Lakhan Disty, 3 km past the Intl Border: 3 Coys up, Pls 2 up/.test(LP('gr.ded.dp1.fdls').draft) && LP('gr.ded.dp1.screens').draft === '1.5-2 km past the Intl Border, 1-1.5 km ahead of Line X.' && LP('gr.ded.dp1.screens').basis[0].text.includes('OoW Vol I Annex A p 102'), LP('gr.ded.dp1.fdls').draft);
  check('mechs: adv posn on a natural obs (OoW Vol I p 14), C pen, res and armr by the guide', /Protective dets on Line W \(Sukh Nala\); an adv posn on Sukh Nala \(Line W\)/.test(LP('gr.ded.dp1.adv').draft) && LP('gr.ded.dp1.adv').basis[0].text.includes('OoW Vol I p 14') && /^On the Lt apch, the most threatened: about 1,500 m behind Line X/.test(LP('gr.ded.dp1.cpen').draft) && LP('gr.ded.dp1.cpen').basis.some((b) => /IBB p 310/.test(b.text)) && /LAT and HAT never in res/.test(LP('gr.ded.dp1.res').draft) && /HAT: in the protective dets, then in bulk in the FDL gaps on the Lt tk apch, the most threatened; the Cen only by what reaches it, never an even spread/.test(LP('gr.ded.dp1.armr').draft) && LP('gr.ded.dp1.armr').basis.some((b) => /IBB p 73/.test(b.text)), LP('gr.ded.dp1.armr').draft);
  const doc0 = M.newDoc('def');
  check('mechs: the new DP heads and the Vis are in the def outline', ['gr.ded.dp1.cpen', 'gr.ded.dp1.res', 'gr.ded.dp1.armr', 'en.vis', 'ts.data.time-now', 'ts.data.first-lt', 'ts.data.last-lt', 'anx.sketch'].every((id) => M.find(doc0, id)) && M.find(M.newDoc('attk'), 'anx.sketch') && M.numberOf(doc0, 'anx.sketch') === '1');

  // analysis and course
  const an = X.analysisDef(Lf, reading, { fwd: true, attrition: true });
  check('mechs: analysis under the book\'s heads, the limitations as advs or disadvs', an.dis.some((x) => /^FDLs only 4\.3 km past the Intl Border: little room for the protective dets \(Aim\)$/.test(x)) && an.adv.some((x) => /^Max attrition: the protective dets fight on successive lines \(Line W, Line X\) \(Aim\)$/.test(x)) && an.dis.some((x) => /Def is not based on an eff obs \(Lines of def\)/.test(x)), JSON.stringify(an));
  const an0 = X.analysisDef(L0, reading, {});
  check('mechs: all apchs covered when a BUA stands on each; an extended frontage a disadv', an0.adv.some((x) => /All apchs eff covered: a BUA astride each on Line X \(Apchs\)/.test(x)) && an0.adv.some((x) => /eff obs, Lakhan Disty/.test(x)) && an0.dis.some((x) => /over-stretched/.test(x)) && an0.dis.some((x) => /Depth only 1\.3 km behind the FDLs/.test(x)));
  const cr = X.courseDef(L0, reading, { check: null, prepFrom: '0600 hrs D-2', readyBy: '0600 hrs D Day' });
  check('mechs: Course A in the book\'s paragraph, what is missing named', /^Def along Line X along Lakhan Disty \(Kot Jaimal – Dhok Rai\)\. FDLs comprising 3 Coys, a Coy each in area Kot Jaimal, Nurpur and Dhok Rai\. Depth comprising 2 Coys, a Coy each in area Chak 21 and Pindi Dogran\./.test(cr.text) && /C attk objs in order of pri: Kot Jaimal, Nurpur and Dhok Rai\./.test(cr.text) && /Having bias of def towards the Lt and Cen apchs and that of A tk def towards the Lt and Cen\. Commencing prep of def by 0600 hrs D-2 and completing def by 0600 hrs D Day\.$/.test(cr.text) && cr.missing.some((x) => /res/.test(x)) && !/^To\b/.test(cr.text), cr.text);
  const crp = X.courseDef(L0, reading, { check: { title: 'Bn Def', posns: [{ label: 'A Coy', kind: 'fwd' }, { label: 'B Coy', kind: 'fwd' }, { label: 'D Coy', kind: 'depth' }, { label: 'C Coy', kind: 'res' }, { label: 'C pen 1', kind: 'cpen' }], rows: [] }, prepFrom: null, readyBy: null });
  check('mechs: a checked plan names the Coys', /FDLs comprising 2 Coys, a Coy each in area A Coy and B Coy\. Depth comprising 1 Coy, in area D Coy\./.test(crp.text) && /Res in area C Coy\./.test(crp.text) && /C pen posns in area C pen 1\./.test(crp.text) && crp.missing.some((x) => /timings/.test(x)), crp.text);

  // the vis of the en op
  const v = X.visDef(L0, reading, { hMin: 360, night: null });
  const vt = v.steps.map((s) => s.en);
  check('mechs: the Vis tier by tier at the guide\'s figures, best to the En', /^En is likely to cross the Intl Border on a broad front, on the Lt, Cen and Rt apchs, at 0600 hrs D Day$/.test(vt[1]) && /contact the protective dets on Line W \(Burj – Tibbi\) at 0730 hrs D Day/.test(vt[2]) && /clear Line W and resume the adv at 1330 hrs D Day/.test(vt[3]) && /contact the screens ahead of Line X at 1345 hrs D Day/.test(vt[4]) && /contact the FDLs on Line X at 1600 hrs D Day/.test(vt[5]) && /at 2200 hrs D Day$/.test(vt[6]), vt.slice(1, 7).join(' | '));
  check('mechs: his phases, the C pen by IBB p 310 and the str pt after 12 h', /complete Ph 1 on Line X by 0200 hrs D\+1/.test(vt[9]) && /not later than 2330 hrs D Day to 0000 hrs D\+1/.test(v.steps[9].own) && /Ph 2 onto the depth on Line Y .* by 0400 hrs D\+1/.test(vt[10]) && /launch Ph 3 onto Qila Mor at 1600 hrs D\+1, taking 6-8 h/.test(vt[11]) && vt.every((t) => /\bis likely to\b/.test(t) && !/\bwill\b/.test(t)), vt.slice(9).join(' | '));
  check('mechs: the Vis cites the guide and the linear model, KYE beside', v.basis.some((b) => /Understanding Aprc p 9-11/.test(b.text) && /Sec V p 5-8/.test(b.text)) && v.basis.some((b) => /KYE 2019 p 216/.test(b.text)));
  const vw = X.writeVisDef(v, [['a.', 'The En lead element at TAI 1', 'DP 1: blow the br']], [['a.', 'Ph 1 done: lead elm at C pen 1 in 40 min', 'D Coy to C pen 1: in time']]);
  const rt2 = vw.find((x) => x.id === 'crs.react').table.rows;
  check('mechs: reactions in the three phases, the IPB rows in prep, the what-if in C attk', rt2[0][1] === 'Prep Ph' && rt2.findIndex((r) => r[1] === 'Aslt Ph') > rt2.findIndex((r) => /TAI 1/.test(r[1])) && rt2.findIndex((r) => /C pen 1 in 40/.test(r[1])) > rt2.findIndex((r) => r[1] === 'C Attk Ph') && rt2.filter((r) => r[0]).length === v.steps.length + 3 && vw[0].children.length === v.steps.length && vw[0].children[0].id === 'en.vis.a');

  // time and space (the def)
  const nt = { firstLt: 360, lastLt: 1080, spans: [], moonPct: 50, waxing: true, quarter: 2, light: { firstLight: '0600', lastLight: '1800', moonPct: 50, utcOffsetH: 5, date: '2027-02-15' } };
  const ts = X.writeTsDef({ lim: {}, hMin: 360, nowMin: -2520, night: nt, zone: 'UTC+5, PKT', moveH: 1, prepH: 36, minesH: 63, reqH: 76 });
  const TS = (id) => ts.patches.find((x) => x.id === id);
  check('mechs: no time given, the def ready by the last lt before the En attk (UA p 8)', ts.readyMin === -360 && /^By the last lt before the En attk: 1800 hrs D-1 \(the En H 0600 hrs D Day\)\.$/.test(TS('ts.data.time-by-which-def-to-be-ready').draft) && TS('ts.data.time-by-which-def-to-be-ready').basis[0].text.includes('Understanding Aprc p 8'));
  check('mechs: time now, first and last lt, the time aval split day / ni', TS('ts.data.time-now').draft === '0600 hrs D-2.' && TS('ts.data.first-lt').draft === '0600 hrs (2027-02-15).' && TS('ts.data.total-time-aval').draft === '36 h: 24 h of day lt and 12 h of ni.', TS('ts.data.total-time-aval').draft);
  check('mechs: essential timings back from ready, OoW Vol I p 39 for the 36 h; less time aval deduced', /^Essential timings: battle procedure to start by 1700 hrs D-3; mov from the conc A to the FDLs by 0500 hrs D-2; prep of the main def from 0600 hrs D-2/.test(TS('ts.ded.dp').draft) && /Short by 27 h: the M fd laying should have started at 0300 hrs D-3/.test(TS('ts.ded.dp').draft) && TS('ts.ded.dp').basis[0].text.includes('OoW Vol I p 39') && /^Less time aval \(36 h against 76 h/.test(TS('ts.ded.common').draft), TS('ts.ded.dp').draft);
  const ts2 = X.writeTsDef({ lim: { by: '0600 D Day' }, hMin: 360, nowMin: -10000, night: nt, zone: 'x', moveH: null, prepH: 36, minesH: null, reqH: 48 });
  check('mechs: the aim\'s ready-by wins; more time aval deduced', ts2.readyMin === 360 && /^0600 hrs D Day: the aim's limitation\.$/.test(ts2.patches.find((x) => x.id === 'ts.data.time-by-which-def-to-be-ready').draft) && /^More time aval/.test(ts2.patches.find((x) => x.id === 'ts.ded.common').draft));

  // the aim
  const aimD = X.writeAim('def', { fwd: true, noPen: 'Y', by: '0600 D Day', other: ['Pl size protection to gd the brs'] }, { place: 'Qila Mor', hMin: null, lastLt: null, turn: null, readyDerived: null });
  check('mechs: the def aim with its limitations tabulated', aimD[0].draft === 'To def the given AOR with fol limitations:-' && aimD[0].children.map((c) => c.draft).join(' | ') === 'Def to be as far fwd as tac feasible. | No pen beyond Line Y. | Def to be ready by 0600 hrs D Day. | Pl size protection to gd the brs.' && aimD[0].src === 'aim' && X.writeAim('def', {}, { place: 'x', hMin: null, lastLt: null, turn: null, readyDerived: null }).length === 0);
  const aimA = X.writeAim('attk', { destr: true, night: true, by: '0600 D+1' }, { place: 'Qila Mor', hMin: null, lastLt: null, turn: 'Br 1', readyDerived: null });
  check('mechs: the attk aim: max destr blocks the wdr before the attk', aimA[0].draft === 'To capture area Qila Mor with fol limitations:-' && aimA[0].children.map((c) => c.id).join() === 'aim.destr,aim.wdr,aim.by,aim.ni' && /block at Br 1 before the attk/.test(aimA[0].children[1].draft) && aimA[0].children[2].draft === 'Area to be captured by 0600 hrs D+1.');

  // the attack: the apchs on the book's planning parameters
  const tt = X.apchTestsAttk(reading, { fupM: 1100, echelon: 'Bn', enNear: { Rt: ['A Coy'] } });
  check('mechs: the apch tests in own Lt / Cen / Rt order (the reading\'s sides mirrored)', tt.table.head.join('|') === 'Ser|Test|Lt Apch|Cen Apch|Rt Apch' && /^Yes: Dhok Rai/.test(tt.table.rows[1][2]) && /^Yes: Kot Jaimal/.test(tt.table.rows[1][4]) && /^Yes: A Coy: discard it/.test(tt.table.rows[4][2]) && /^No: narrows to 1\.1 km/.test(tt.table.rows[5][2]) && /^No: the FUP 5\.5 km inside the En area/.test(tt.table.rows[0][2]), JSON.stringify(tt.table.rows.map((r) => r[2])));
  check('mechs: the apch tests: MITG in Ph 1, a feature ending Ph 1, the BUA to confirm', /^No: Dhok Rai first/.test(tt.table.rows[3][2]) && /^Yes: Lakhan Disty/.test(tt.table.rows[2][3]) && tt.confirm.length === 3 && tt.basis[0].text.includes('Understanding Aprc p 16-17') && tt.basis[1].text.includes('IBB p 201'));
  check('mechs: the tests\' advs and disadvs per side; a Pl seen tells against it', tt.dis.Lt.some((x) => /En seen on it/.test(x)) && !tt.best.includes('Lt') && tt.adv.Rt.includes('Ph 1 ends on Lakhan Disty, a distinguishable feature'));

  // the attack: the time calc against the books' own specimens
  const tB = X.timeCalcAttk({ echelon: 'Bn', hMin: null, msnBy: 1800, nowMin: null, hsum: null, phases: 2, bunkers: false, fupM: 933, night: null });
  const rB = (i) => tB.table.rows[i];
  check('mechs: Bn backward calc gives the guide\'s specimen: H 0110, A hr 0348 (UA p 24)', tB.h === 1510 && rB(12)[2] === '0110 hrs D+1' && rB(6)[2] === '0348 hrs D+1' && rB(11)[2] === '28 mins' && rB(14)[3] === '2305 hrs D Day' && rB(1)[2] === '40 mins' && rB(10)[2] === '90 mins', `${rB(12)[2]} ${rB(6)[2]} ${rB(14)[3]}`);
  const tC = X.timeCalcAttk({ echelon: 'Coy', hMin: null, msnBy: 300, nowMin: null, hsum: null, phases: 2, bunkers: false, fupM: 1100, night: null });
  const rC = (i) => tC.table.rows[i];
  check('mechs: Coy backward calc gives Mechs p 14\'s specimen: H 0200, A hr 0315, FAA 0025', rC(12)[2] === '0200 hrs D Day' && rC(6)[2] === '0315 hrs D Day' && rC(14)[3] === '0025 hrs D Day' && rC(15)[3] === '0005 hrs D Day' && rC(1)[3] === '0400 hrs D Day', `${rC(12)[2]} ${rC(6)[2]} ${rC(14)[3]}`);
  const tH = X.timeCalcAttk({ echelon: 'Bn', hMin: 120, msnBy: null, nowMin: null, hsum: { leaveBeforeMin: 90, objMin: 42, h2Min: null, obj2Min: null }, phases: 1, bunkers: true, fupM: 1100, night: null });
  check('mechs: fwd calc from H with the plan\'s march and assault, one phase, bunkers', tH.table.rows[11][2] === '42 mins' && tH.table.rows[14][2] === '90 mins' && tH.table.rows[10][2] === '2 hrs' && tH.table.rows[4][2] === '-' && tH.table.rows[6][2] === '-' && tH.table.rows[0][2] === dClockOf(X, 120 + 42 + 120 + 15 + 40) && tH.basis.some((b) => /IBB p 18/.test(b.text)));
  const moonNight = { firstLt: 360, lastLt: 1080, spans: [{ from: 1080, to: 1380, moon: false }, { from: 1380, to: 1800, moon: true }], moonPct: 70, waxing: false, quarter: 3, light: nt.light };
  const tM = X.timeCalcAttk({ echelon: 'Bn', hMin: 1380, msnBy: null, nowMin: null, hsum: null, phases: 2, bunkers: false, fupM: 1100, night: moonNight });
  check('mechs: the moon: adv all timings to keep the mov, H and Ph 1 dark (UA Sec III sheet 7)', tM.shift === -150 && /^adv all timings by 2 h 30/.test(tM.moonText), `${tM.shift} ${tM.moonText}`);
  const lateDark = { firstLt: 380, lastLt: 1080, spans: [{ from: 1080, to: 1563, moon: true }, { from: 1563, to: 1820, moon: false }], moonPct: 66, waxing: true, quarter: 2, light: nt.light };
  const tL1 = X.timeCalcAttk({ echelon: 'Bn', hMin: null, msnBy: 1800, nowMin: null, hsum: null, phases: 2, bunkers: false, fupM: 1100, night: lateDark });
  const tL2 = X.timeCalcAttk({ echelon: 'Bn', hMin: 1505, msnBy: null, nowMin: null, hsum: null, phases: 2, bunkers: false, fupM: 1100, night: lateDark });
  check('mechs: the moon: else at least H and Ph 1 dark, the mov by covered routes; never past the msn time', tL1.shift === null && /^no shift of the timetable within the msn time puts H and Ph 1 in the dark/.test(tL1.moonText) && tL2.shift === 90 && /^delay all timings by 1 h 30 so that H and Ph 1 fall in the dark \(the mov from the FAA in the moonlight/.test(tL2.moonText), `${tL1.moonText} / ${tL2.moonText}`);
  check('mechs: the moon\'s words: quarter, spans, the part of the ni', /^The moon is in its 3rd qtr \(70 % lit\), up 2300-0600 hrs; dark 1800-2300 hrs: attk in the early part of the ni, reorg in the moonlight\.$/.test(X.moonWords(moonNight)), X.moonWords(moonNight));
  const night = X.nightOf('2027-02-15', 32.5, 74.5, 300);
  check('mechs: the night of D Day: first / last lt and spans that run last lt to first lt', night.firstLt > 300 && night.firstLt < 450 && night.lastLt > 1000 && night.lastLt < 1150 && night.spans[0].from === night.lastLt && night.spans[night.spans.length - 1].to === 1440 + night.firstLt && night.spans.every((s, i) => !i || s.from === night.spans[i - 1].to) && [1, 2, 3, 4].includes(night.quarter), `${night.firstLt} ${night.lastLt} q${night.quarter}`);

  // all of it, the attack
  const wa = X.writeMechs({ kind: 'attk', echelon: 'Bn', reading, limits: { by: '0600 D+1', destr: true }, hHour: null, timeNow: 'D-1 1000', night: nt, zone: 'z', ipbRows: [], planRows: [], check: null, planAdv: [], planDis: [], time: null, attk: null, attkPlan: null, hsum: null, enNear: {}, symbols: [] });
  const WA = (id) => wa.patches.find((x) => x.id === id);
  check('mechs: attk: the tests ride under Pri of Apchs, the Time Calc, the data and the timings', WA('gr.ded.apch').children[0].id === 'gr.ded.apch.tests' && WA('gr.ded.apch').draft === undefined && WA('ts.calc').table.rows.length === 18 && WA('ts.data.now').draft === '1000 hrs D-1.' && WA('ts.data.total').draft === '44 hrs.' && /^Mov from the FAA to the FUP .*; BOF to be estb by .*; Blocking posn to be estb by/.test(WA('ts.ded.timings').draft) && /^(\d+ h( \d+)?|\d+ min) more than the time req|^Short by/.test((WA('ts.ded.more') ?? WA('ts.ded.less')).draft) && WA('anx.sketch').table.rows.length === 14, WA('ts.ded.timings').draft);
  const ad = M.newDoc('attk');
  M.applyPatches(ad, wa.patches);
  check('mechs: attk: applied to the outline, the analysis from the tests', /\(Apch\)/.test(M.find(ad, 'crs.an.adv').draft ?? M.find(ad, 'crs.an.dis').draft) && M.find(ad, 'gr.ded.apch.tests').table && M.find(ad, 'aim.wdr').draft);

  // the sketch and the style
  const sk = X.writeSketch('def', [{ id: '1', key: '25270703', name: 'Minefield - Anti Tank Mine', side: 'own', ech: null, label: 'Mf 1', where: null }, { id: '2', key: '10110000', name: 'Inf', side: 'own', ech: '15', label: 'A Coy', where: null }, { id: '3', key: '25342203', name: 'Screen', side: 'own', ech: null, label: '', where: null }], null, null)[0];
  const skr = (re) => sk.table.rows.find((r) => re.test(r[1]));
  check('mechs: the sketch (Anx P): what the map holds, what is by hand, what is not marked', skr(/^SD aspects/)[2] === 'By hand' && skr(/^M fds/)[2] === '1: Mf 1' && skr(/^Screens/)[2] === '1: Screen' && /no Pl symbols: marked one step down/.test(skr(/^Coy locs/)[2]) && skr(/^C pen posns/)[2] === 'Not marked' && sk.basis[0].text.includes('Understanding Aprc p 31-32') && sk.state === 'map', skr(/^Coy locs/)[2]);
  const sd = M.newDoc('def');
  M.setMine(sd, 'aim', 'Defend the AOR');
  M.setMine(sd, 'crs.a', 'To def along line X');
  M.setMine(sd, 'gr.ded.common', 'Keeping in view the flat gr, I must lay mines');
  M.setMine(sd, 'crs.an.adv', 'Def on higher gr. Good depth.');
  M.applyPatches(sd, [{ id: 'en.vis', draft: '', state: 'judge', children: [M.para('en.vis.a', null, { draft: 'En will cross the border at 0600; I must engage him.', state: 'judge' })] }]);
  const notes = X.styleNotes(sd).map((x) => x.id).sort().join(',');
  check('mechs: style notes on the books\' writing rules', notes === 'aim,crs.a,crs.an.adv,en.vis.a,en.vis.a,gr.ded.common', notes);
  const sa = M.newDoc('attk');
  M.setMine(sa, 'en.ded.obj', 'Keeping in view the En cap, the pri stands cfm');
  check('mechs: style: the attack keeps "Keeping in view" (the guide\'s own attk specimens use it)', X.styleNotes(sa).length === 0);

  // all of it, the def, on the outline
  const wd = X.writeMechs({ kind: 'def', echelon: 'Bn', reading, limits: { fwd: true }, hHour: '06:00', timeNow: null, night: nt, zone: 'z', ipbRows: [], planRows: [], check: null, planAdv: [], planDis: [], time: { moveH: 1, prepH: 36, minesH: 63, reqH: 76 }, attk: null, attkPlan: null, hsum: null, enNear: {}, symbols: [] });
  const dd = M.newDoc('def');
  M.applyPatches(dd, W.writeGround(gin).patches);
  M.applyPatches(dd, wd.patches);
  check('mechs: def: the aim, the layout, the course, the Vis and the reactions land on the outline', M.find(dd, 'aim').children.length === 2 && /^To def the given AOR/.test(M.find(dd, 'aim').draft) && /^Pri of lines of def: \(1\) Line Y \(FDLs\)/.test(M.find(dd, 'gr.ded.lines.pri').draft) && /^Def along Line Y/.test(M.find(dd, 'crs.a').draft) && M.find(dd, 'en.vis').children.length > 6 && M.find(dd, 'crs.react').table.rows[0][1] === 'Prep Ph' && M.find(dd, 'anx.sketch').table && M.find(dd, 'aim').src === 'aim' && M.find(dd, 'gr.ded.lines.pri').src === 'gr', M.find(dd, 'gr.ded.lines.pri').draft);
  check('mechs: the limitations ride in the doc and survive a file', (() => { const d2 = M.newDoc('def'); d2.limits = { fwd: true, noPen: 'Y', delayH: '72', junk: 1 }; const n2 = M.normalizeDoc(JSON.parse(JSON.stringify(d2))); return n2.limits.fwd === true && n2.limits.noPen === 'Y' && n2.limits.delayH === 72 && !('junk' in n2.limits) && M.normalizeDoc(JSON.parse(JSON.stringify(M.newDoc('def')))).limits === undefined; })());
  check('mechs: typed cells follow a column renamed by head (Inf -> Inf (Pl), A tk -> Remarks)', (() => { const f = M.colMap(['Ser', 'Locs', 'Inf', 'A tk', 'Engrs'], ['Ser', 'Task / Loc', 'Inf (Pl)', 'Armr (Tp)', 'LAT (Pl)', 'HAT (Pl)', 'Engrs (Sec)', 'Remarks']); return f(1) === 1 && f(2) === 2 && f(3) === 7 && f(4) === 6; })());
}

// ── the doctrine books (Doctrine_Review.md GroundAppreciation R69-R93; 24 Nov 2026) ─────────────────────────────────
{
  const X = await import('../../MS/Engines/GroundAppreciation/AprcMechs.ts');
  const B = await import('../../MS/Engines/GroundAppreciation/AprcBooks.ts');
  const has = (p, re) => !!p && p.prompts.some((x) => re.test(x));

  // R69: the DS guns in the Time Req, by ni, with IBB p 122 and p 154; R80 / R88: the ground's own prep notes
  const base = { move: { from: '7 Bn at Pasrur', km: 18.4, kmh: 20, src: 'x' }, prep: { h: [36, 36], src: 'OoW Vol I p 39', note: 'A Bn prepares its posns in at least 36 working hrs' }, mines: null };
  const tg = W.writeTimeReq({ ...base, guns: 'Bty', ground: 'Desert' });
  const tgT = tg.patches[0].table, tgRow = (w) => tgT.rows.find((r) => r[1] === w);
  check('books R69: the DS fd Bty in the Time Req at 40 min by ni (IBB p 122), not on the critical path', tgRow('Depl of the DS fd Bty')[2] === '0.7' && /By ni 40 min \(20 by day\), excluding travel; registration 20 min each plus 20; without daylight recce a Bty 2 h/.test(tgRow('Depl of the DS fd Bty')[3]) && tg.patches[0].basis.some((b) => /IBB p 122 para 5/.test(b.text) && /IBB p 154/.test(b.text)) && Math.abs(tg.reqH - W.writeTimeReq(base).reqH) < 1e-9, tgRow('Depl of the DS fd Bty')[3]);
  check('books R80: desert trenches by frames on the prep row (DW Annex B p 97, p 95)', /In desert: revetted trenches by frames, 6 h for a wpn crew with the frames to hand, 4-6 h more to make them/.test(tgRow('Prep of main def (altn / sec)')[3]) && tg.patches[0].basis.some((b) => /DW Annex B p 97/.test(b.text) && /DW p 95 note b/.test(b.text)));
  const tm = W.writeTimeReq({ ...base, guns: 'Regt', ground: 'Mountains' });
  check('books R88: mountain digging and cold-weather maint (MW pp 147, 262); a Bde\'s fd Regt 1.5 h', /In mountains: the difficulty of digging means more time \(no figure printed\)/.test(tm.patches[0].table.rows.find((r) => r[1].startsWith('Prep of main def'))[3]) && tm.patches[0].basis.some((b) => /MW p 147/.test(b.text) && /MW p 262/.test(b.text)) && tm.patches[0].table.rows.find((r) => r[1] === 'Depl of the DS fd Regt')[2] === '1.5' && W.writeTimeReq({ ...base, ground: 'Plains' }).patches[0].table.rows.length === 15);

  // R70 / R82: the quick attk, contact to H
  const qB = X.timeCalcAttk({ echelon: 'Bn', hMin: 120, msnBy: null, nowMin: null, hsum: null, phases: 1, bunkers: false, fupM: 1100, night: null, quick: true });
  const qr = (i) => qB.table.rows[i];
  check('books R70: a Bn quick attk by MIB Annex L: recce and orders 65 min, to the FUP 25, in the FUP 10 (100 min)', qB.quickMin === 100 && qr(17)[1] === 'Recce, planning and orders (from contact)' && qr(17)[2] === '65 mins' && qr(14)[1] === 'Mov to the FUP' && qr(14)[2] === '25 mins' && qr(13)[2] === '10 mins' && qr(15)[2] === '-' && qr(16)[2] === '-' && qB.start[17] === -100 && qr(17)[3] === X.dClock(20) && qB.basis.some((b) => /MIB p 89/.test(b.text) && /IBB p 133/.test(b.text) && /Annex L pp 347-348/.test(b.text)), JSON.stringify(qB.table.rows.slice(13)));
  const qC = X.timeCalcAttk({ echelon: 'Coy', hMin: 120, msnBy: null, nowMin: null, hsum: null, phases: 2, bunkers: false, fupM: null, night: null, quick: true });
  check('books R70: a Coy quick attk 45 min, inside MIB 30-60 and IBB at most 30-45', qC.quickMin === 45 && qC.table.rows[17][2] === '45 mins' && /^Contact to H/.test(qC.table.rows[17][1]) && [13, 14, 15, 16].every((i) => qC.table.rows[i][2] === '-') && qC.start[17] === -45);
  const wq = X.writeMechs({ kind: 'attk', echelon: 'Bn', reading, limits: { quick: true, night: true }, hHour: '02:00', timeNow: null, night: null, zone: 'z', ipbRows: [], planRows: [], check: null, planAdv: [], planDis: [], time: null, attk: null, attkPlan: null, hsum: null, enNear: {}, symbols: [] });
  const wqt = wq.patches.find((x) => x.id === 'ts.ded.timings');
  check('books R69 / R82: essential timings: contact, the Annex L drill, the DS fd Bty depl by ni (IBB p 122)', /^Contact not later than 0020 hrs D Day \(a quick attk, contact to H 100 min\); recce 0020 hrs D Day to 0100 hrs D Day, orders 0110 hrs D Day to 0125 hrs D Day, in the FUP by 0150 hrs D Day; H hr 0200 hrs D Day/.test(wqt.draft) && /DS fd Bty to start its depl not later than 0120 hrs D Day \(40 min by ni, excluding travel and registration\)/.test(wqt.draft) && wqt.basis.some((b) => /IBB p 170 para 5/.test(b.text)), wqt.draft);
  const wd0 = X.writeMechs({ kind: 'attk', echelon: 'Bde', reading, limits: {}, hHour: '14:00', timeNow: null, night: { firstLt: 360, lastLt: 1080, spans: [], moonPct: 0, waxing: true, quarter: 1, light: null }, zone: 'z', ipbRows: [], planRows: [], check: null, planAdv: [], planDis: [], time: null, attk: null, attkPlan: null, hsum: null, enNear: {}, symbols: [] });
  check('books R69: a Bde attk by day: the DS fd Regt 45 min', /DS fd Regt to start its depl not later than 1315 hrs D Day \(45 min by day/.test(wd0.patches.find((x) => x.id === 'ts.ded.timings').draft));

  // R85: the uphill assault in mountains (MW Annex F)
  check('books R85: the slant factor table as printed (next row up; none below 30 degrees; the last above 70)', B.slantFactor(29).factor === 1 && B.slantFactor(29).row === null && B.slantFactor(45).factor === 1.41 && B.slantFactor(32.5).row === 35 && B.slantFactor(65).factor === 2.37 && B.slantFactor(80).factor === 2.93 && /beyond the table/.test(B.slantFactor(80).note));
  const tMtn = X.timeCalcAttk({ echelon: 'Bn', hMin: 120, msnBy: null, nowMin: null, hsum: null, phases: 1, bunkers: false, fupM: 1100, night: null, climbM: 700 });
  check('books R85: FUP to obj on the slant (32.5 degrees: 1.22) plus 1 h a 350 m of climb: 33 min -> 160 min', tMtn.table.rows[11][2] === '160 mins' && tMtn.basis.some((b) => /MW Annex F pp 311-313/.test(b.text)) && tMtn.basis.some((b) => /x 1\.22, plus 120 min/.test(b.text)), tMtn.table.rows[11][2]);

  // R72 / R82: the Vis basis (IBB pp 310, 312) and the En's quick attk in the reactions table
  const L0 = X.layoutDef(reading, {}, 'Bn');
  const v = X.visDef(L0, reading, { hMin: 360, night: null });
  const rt = X.writeVisDef(v).find((x) => x.id === 'crs.react');
  const iQ = rt.table.rows.findIndex((r) => /quick attk on contact/.test(r[1]));
  check('books R72: the Vis cites IBB p 310 (his Ph 1 by 1.5-2 h, a Bde 3 h) and p 312 (two phases, 2,000-3,000 m)', v.basis.some((b) => /IBB S57 para 11 p 310/.test(b.text) && /IBB S57 para 17 p 312/.test(b.text)));
  check('books R82: the En quick attk off contact in the Aslt Ph, MIB pp 96-97 (a Coy gp 30-60, a Bn gp 60-100 min)', iQ > 0 && /contact the FDLs/.test(rt.table.rows[iQ - 1][1]) && /a Coy gp 30-60 min, a Bn gp 60-100 min after it \(from 1630 hrs D Day, a Bn gp from 1700 hrs D Day\)/.test(rt.table.rows[iQ][1]) && rt.basis.some((b) => /MIB p 89; pp 96-97/.test(b.text)), rt.table.rows[iQ]?.[1]);

  // R74: the line of denial
  const Ld = X.layoutDef(reading, { denial: 'Y' }, 'Bn');
  check('books R74: the line of denial stands for the line of no pen when none is set (OoW Vol I pp 17-18)', Ld.depth.id === 'Y' && Ld.fdl.id === 'W' && /the line of denial \(Line Y\) is held in depth/.test(Ld.reasons[0]) && Ld.basis.some((b) => /OoW Vol I pp 17-18/.test(b.text)), Ld.reasons[0]);
  const Lnd = X.layoutDef(reading, { noPen: 'Z', denial: 'Y' }, 'Bn');
  check('books R74: a line of no pen behind the line of denial is flagged (OoW Vol I p 17)', Lnd.prompts.some((x) => /Line Z \(no pen\) lies behind Line Y, the line of denial given/.test(x)) && Lnd.depth.id === 'Z');
  const aDn = X.writeAim('def', { denial: 'Y' }, { place: 'x', hMin: null, lastLt: null, turn: null, readyDerived: null });
  const anD = X.analysisDef(Ld, reading, { denial: 'Y' });
  check('books R74: the aim and the analysis carry the line of denial', aDn[0].children[0].id === 'aim.denial' && aDn[0].children[0].draft === 'Integrity of Line Y, the line of denial, to be preserved.' && anD.adv.some((x) => /^The integrity of the line of denial \(Line Y\) is preserved/.test(x)) && anD.basis.some((b) => /OoW Vol I pp 17-18/.test(b.text)) && X.analysisDef(L0, reading, { denial: 'W' }).dis.some((x) => /^FDLs behind the line of denial \(Line W\)/.test(x)));
  const anB = X.analysisDef(X.layoutDef(reading, {}, 'Bde'), reading, {});
  check('books R74: a Bde\'s depth line tested on its obs (OoW Vol I p 17 para 24); a Bn\'s not', anB.dis.some((x) => /^The depth line \(Line Y\) rests on no strong obs/.test(x)) && anB.basis.some((b) => /OoW Vol I p 17 para 24/.test(b.text)) && !X.analysisDef(L0, reading, {}).dis.some((x) => /rests on no strong obs/.test(x)));
  check('books: the new limitations survive a file (denial, quick, climb)', (() => { const n2 = M.normLimits({ denial: 'Y', quick: 1, climbM: '450', junk: 2 }); return n2.denial === 'Y' && n2.quick === true && n2.climbM === 450 && !('junk' in n2); })());

  // R75 / R77 / R79 / R83 / R84 / R90 / R92 / R93: the books' heads to consider
  const dd = M.newDoc('def'), da = M.newDoc('attk');
  check('books R75: Res prompts: four factors, point / timing / dir (OoW Vol I pp 19-20)', has(M.find(dd, 'gr.ded.dp1.res'), /OoW Vol I p 19\)$/) && has(M.find(dd, 'gr.ded.dp1.res'), /point of employment, the timing .* the dir \(OoW Vol I p 20\)/));
  check('books R84: the mountain str pt (MW pp 151-152, 166, 176) and pri of work (MW p 172)', has(M.find(dd, 'gr.ded.dp1.strpt'), /30 days staying power.*\(MW p 152\)/) && has(M.find(dd, 'gr.ded.dp1.strpt'), /one third of the force.*\(MW p 176\)/) && has(M.find(dd, 'ts.ded.common'), /^In mountains, pri of work: fighting and amn bunkers.*\(MW p 172\)/));
  check('books R77: the leading En option, contingency plans, the res and silent / noisy (OoW Vol II pp 27, 30-32)', has(M.find(da, 'en.lead'), /OoW Vol II p 30/) && has(M.find(da, 'plan.exec.cont'), /OoW Vol II p 32/) && has(M.find(da, 'own.ded.c.res'), /OoW Vol II pp 31-32/) && has(M.find(da, 'en.ded.c.arty'), /^Silent or noisy:.*\(OoW Vol II p 27\)$/) && M.numberOf(da, 'plan.exec.coord.loc') === '22h(2)' && M.numberOf(da, 'plan.exec.cont') === '22i');
  check('books R79: desert ITG heads (DW pp 7, 20, 38)', has(M.find(dd, 'gr.itg'), /water sources \(DW p 7\)$/) && has(M.find(dd, 'gr.itg'), /\(DW p 20\)$/) && has(M.find(da, 'gr.ded.obj'), /sources of water supply.*\(DW p 38\)$/) && M.find(dd, 'gr.itg').draft === '');
  check('books R83: think two down, interdiction, spoiling attks (MIB pp 161-162)', has(M.find(dd, 'own.tasks.dp1'), /Think two down.*\(MIB p 162\)/) && has(M.find(dd, 'gr.ded.common'), /^Interdiction tgts: defiles.*\(MIB p 162\)/) && has(M.find(dd, 'gr.ded.common'), /\(MIB p 161\)$/));
  check('books R90: Adm and Log prompts: commodity pts, 1st line, cas evac 4 h / 12 h (lsf pp 23-27, 47, 81-82)', has(M.find(dd, 'plan.adm'), /AP open 24 h.*PP open 2-4 h.*Sup P 2 h daily/) && has(M.find(dd, 'plan.adm'), /rations 3 days in reserve.*\(lsf p 23\)/) && has(M.find(dd, 'plan.adm'), /4 h without expert treatment, surgery within 12 h \(lsf p 47\)/) && has(M.find(da, 'plan.adm.cap'), /lsf p 47/));
  check('books R92: the En on a DCB (IDD pp 3, 5-8)', has(M.find(da, 'en.opt1.dis'), /^En on a DCB, its vulnerabilities \(IDD pp 5-7\)/) && has(M.find(da, 'en.opt1.adv'), /^En on a DCB, its strengths \(IDD pp 7-8\)/) && has(M.find(da, 'en.opt1.obs'), /600-800 m deep \(IDD p 3; 600 m on p 5\)/));
  check('books R93: air sp requests (SO\'s Hbk 2019 Sec 12 pp 1203-1204), no timings printed', has(M.find(dd, 'plan.exec.coord'), /pre-planned requests up the chain fd units, Bde HQ, Div HQ, ASOC \(SO's Hbk 2019 Sec 12 p 1203\); emergency requests \(p 1204\); no timings printed/) && has(M.find(da, 'own.ded.c.df'), /ASOC/));

  // R86: mules and porters
  check('books R86: mules and porters for the attk by echelon (MW pp 142, 145-146, 324-325, 330-331)', /^Build-up and maint after capture: 16 vehs, 582 mules or 1,164 porters \(1st line reserve \(amn\) 154/.test(B.liftDraft('attk', 'Bn').draft) && /1,746 mules or 3,492 porters for the Bde/.test(B.liftDraft('attk', 'Bde').draft) && /^F ech stores: pri 1 the rifle Coys' \(24 mules or 62 porters a Coy\).*pri 2 the rest \(69 mules or 180 porters a Bn\)/.test(B.liftDraft('attk', 'Coy').draft) && B.liftDraft('attk', 'Bn').basis.some((b) => /MW p 145 para 11/.test(b.text)) && B.MW_LIFT.bnRows.reduce((a, r) => a + r[2], 0) === 582 && B.MW_LIFT.bnRows.reduce((a, r) => a + r[3], 0) === 1164 && B.MW_LIFT.bnRows.reduce((a, r) => a + r[1], 0) === 16);
  check('books R86 / R88: maint in def (MW pp 322-323); a Bde\'s not printed, said so', /^Maint in def: 158 mules a week for rations and 123 mules a lift of amn replenishment, a Bn's\. /.test(B.liftDraft('def', 'Bn').draft) && /a Bde's not printed \(three Bns: 474 and 369, by sum\)/.test(B.liftDraft('def', 'Bde').draft));

  // R91: the cas estimate from the ORBAT strength by rank
  const list = [
    { id: 'bn', arm: 'inf', subtype: 'std', name: 'Inf Bn', strength: { offr: 26, jco: 24, sldr: 727, sw: 20, att: 12, total: 809 } },
    { id: 'hq', arm: 'inf', subtype: 'hq', name: 'Bde HQ', strength: { offr: 5, jco: 2, sldr: 63, sw: 2, total: 72 } },
    { id: 'bde', arm: 'inf', subtype: 'inf-bde', name: 'Inf Bde', children: [{ role: 'Bde HQ', unit: 'hq', count: 1 }, { role: 'Inf Bn', unit: 'bn', count: 3 }, { role: 'Sig Coy', count: 1 }] },
  ];
  const g1 = B.casGroupsOf(list, 'bn', 1), g3 = B.casGroupsOf(list, 'bde', 1);
  check('books R91: strength by rank and lsf row; SW and att with the Sldrs; units without ranks named', g1.groups.length === 1 && g1.groups[0].arm === 'SIB' && g1.groups[0].sldr === 759 && g3.groups[0].offr === 83 && g3.groups[0].sldr === 2342 && g3.missing.join() === 'Sig Coy' && B.casArmOf({ arm: 'inf', id: 'inf-bn-mech' }) === 'MIB' && B.casArmOf({ arm: 'inf', id: 'inf-coy-hat-atgm' }) === 'LAT / HAT' && B.casArmOf({ arm: 'armr' }) === 'AC' && B.casArmOf({ arm: 'log' }) === 'Svcs');
  const ce = B.casEstimate({ groups: g1.groups, missing: [], src: "SO's Hbk 2019 p 10 (bn)" });
  check('books R91: the cas estimate at the lsf rates (pp 50-51), sick 0.10 % (p 50), ADS 75 a day (p 48)', Math.abs(B.battleCas(g1.groups, 'intense') - 19.714) < 1e-9 && ce.table.rows[0].join('|') === 'Intense|20|1|21|1' && ce.table.rows[2][0] === 'Low' && /^809 all ranks \(SIB 809\): a day of intense fighting about 20 battle cas and 1 sick and injured, 21 in all, 1 ADS at 75 a day/.test(ce.draft) && ce.state === 'judge' && ce.src === 'orbat' && ce.basis.some((b) => /lsf pp 50-51/.test(b.text)) && ce.basis.some((b) => /Annex K p 80/.test(b.text)) && B.casEstimate({ groups: [], missing: [], src: 'x' }) === null, ce.draft);

  // R81 / R86 / R91: the heads a Read adds where they apply, the planner's kept
  const ha = M.newDoc('attk');
  const added = B.readHeads(ha, { mounted: true, mountains: true, orbat: true });
  check('books R81: a mounted unit\'s AP-1 gets a Dismounting Area after the FUP (MIB pp 90, 120-123)', added.join() === 'gr.ded.ap1.dis,plan.adm.lift,plan.adm.cas' && M.find(ha, 'gr.ded.ap1.depl').children.map((c) => c.id).join() === 'gr.ded.ap1.fup,gr.ded.ap1.dis,gr.ded.ap1.bof,gr.ded.ap1.faa' && has(M.find(ha, 'gr.ded.ap1.dis'), /out of hand-thrown grenade range.*\(MIB p 121\)/) && M.find(ha, 'plan.adm').children.slice(-2).map((c) => c.id).join() === 'plan.adm.lift,plan.adm.cas');
  const hd = M.newDoc('def');
  B.readHeads(hd, { mounted: true, mountains: false, orbat: true });
  M.applyPatches(hd, [ce]);
  check('books R91: the def\'s Adm and Log gets the Cas Estimate (no dismounting area in a def)', !M.find(hd, 'gr.ded.ap1.dis') && M.find(hd, 'plan.adm').children.map((c) => c.id).join() === 'plan.adm.cas' && M.find(hd, 'plan.adm.cas').table.rows.length === 3 && /\d+a$/.test(M.numberOf(hd, 'plan.adm.cas')) && M.toText(hd, 'fair').includes('Cas Estimate.'));
  const prev = M.newDoc('attk');
  B.readHeads(prev, { mounted: true, mountains: false, orbat: true });
  M.setMine(prev, 'gr.ded.ap1.dis', 'Dismount 600 m short in the nala');
  M.applyPatches(prev, [ce]);
  const next = M.newDoc('attk');
  const kept = B.readHeads(next, { mounted: false, mountains: false, orbat: false }, prev, ['orbat']);
  const next2 = M.newDoc('attk');
  check('books: a head with the planner\'s words, or from a reading not taken, stays; else it goes', kept.join() === 'gr.ded.ap1.dis,plan.adm.cas' && B.readHeads(next2, { mounted: false, mountains: false, orbat: false }, prev, []).join() === 'gr.ded.ap1.dis' && B.readHeads(M.newDoc('attk'), { mounted: false, mountains: false, orbat: false }, M.newDoc('attk')).length === 0, kept.join());
}

// ── the last open doctrine items (R78 withdrawal, R85 climb read, R74 line of denial drawn; 24 Nov 2026) ─────────────
{
  const X = await import('../../MS/Engines/GroundAppreciation/AprcMechs.ts');
  const S = await import('../../MS/Engines/GroundGuide/GroundGuideScopeAor.ts');
  const has = (p, re) => !!p && p.prompts.some((x) => re.test(x));
  const nt = { firstLt: 360, lastLt: 1080, spans: [], moonPct: 50, waxing: true, quarter: 2, light: { firstLight: '0600', lastLight: '1800', moonPct: 50, utcOffsetH: 5, date: '2027-02-15' } };
  const mIn = (o) => ({ kind: 'wdr', echelon: 'Bn', reading, limits: {}, hHour: null, timeNow: null, night: nt, zone: 'z', ipbRows: [], planRows: [], check: null, planAdv: [], planDis: [], time: null, attk: null, attkPlan: null, hsum: null, enNear: {}, symbols: [], ...o });

  // R78: the withdrawal outline (OoW Vol III)
  const w0 = M.newDoc('wdr');
  const ids = [];
  M.walk(w0, (p) => ids.push(p.id));
  check('wdr R78: a kind of its own, ready in the Kind select, ids unique', w0.kind === 'wdr' && M.aprcKinds().find((k) => k.kind === 'wdr')?.ready === true && M.aprcKinds().find((k) => k.kind === 'wdr').label === 'Withdrawal' && new Set(ids).size === ids.length, `${ids.length}`);
  check('wdr R78: parts as the def\'s, the factors as OoW Vol III pp 7-16 groups them', w0.parts.map((p) => p.title).join('|') === 'REVIEW OF SIT|AIM|FACTORS|COURSES|PLAN|ANX P: SKETCH' && w0.parts[2].groups.map((g) => g.title).join('|') === 'Terrain and Weather|Time and Space|Own and En Sit|Int, Security and Deception|Dmls, Air and Adm');
  const W0 = (id) => M.find(w0, id);
  check('wdr R78: the factors cite their pages (terrain p 8, weather p 9, T&S pp 9-10, own and en p 10, int p 11, security p 12, deception p 13, dmls p 14, air p 15, adm pp 15-16)',
    has(W0('gr.obs'), /OoW Vol III p 8 para 5a/) && has(W0('gr.met'), /OoW Vol III p 9 para 5b/) && has(W0('ts.ded.common'), /OoW Vol III p 10 para 6c/) && has(W0('ts.ded.common'), /OoW Vol III p 9 para 6a/) && has(W0('en.comp'), /OoW Vol III p 10 para 7a/) && has(W0('sec.int'), /OoW Vol III p 11 para 8a/) && has(W0('sec.sec'), /OoW Vol III p 12 para 9a/) && has(W0('sec.decep'), /OoW Vol III p 13 para 10c/) && has(W0('sp.dml'), /OoW Vol III p 14 para 11a/) && has(W0('sp.air'), /OoW Vol III p 15 para 12/) && has(W0('sp.adm'), /OoW Vol III pp 15-16 para 13b/));
  check('wdr R78: the main decisions in Course A (pp 6-7 para 3)', has(W0('crs.a'), /OoW Vol III p 6 para 3a-b/) && has(W0('crs.a'), /OoW Vol III p 7 para 3c/) && has(W0('crs.a'), /OoW Vol III p 7 para 3d/) && has(W0('crs.a'), /OoW Vol III p 7 para 3e-l/) && has(W0('crs.an.adv'), /OoW Vol III p 6 para 2/));
  check('wdr R78: what the plan must fix: covering tps (p 31), intmed posns (pp 33-34), routes back (p 8), timings (p 19, Annex A), rear parties (p 45)',
    has(W0('plan.exec.cover'), /OoW Vol III p 31 para 9b/) && has(W0('gr.ded.intmed'), /OoW Vol III p 33 para 16/) && has(W0('plan.exec.intmed'), /OoW Vol III p 34 para 22/) && has(W0('gr.routes'), /OoW Vol III p 8 para 5a/) && has(W0('ts.ded.timings'), /OoW Vol III p 19 para 17/) && has(W0('plan.exec.coord'), /OoW Vol III pp 72-73, Annex A/) && has(W0('plan.exec.rear'), /OoW Vol III p 45 para 5/) && has(W0('plan.exec.seq'), /OoW Vol III p 44 para 2/) && has(W0('ts.req'), /OoW Vol I p 39/));
  {
    const all = [];
    M.walk(w0, (p) => p.prompts.forEach((x) => all.push(x)));
    const plain = all.filter((x) => !/\((OoW Vol III|OoW Vol I|Understanding Aprc|lsf|SO's Hbk|GSP-1947|DW|IBB)|OoW Vol III p|OoW Vol I p|GSP-1947 p/.test(x) && !/^(With reasons|On the same lines|MITG: the new def posn)/.test(x));
    check('wdr R78: every book prompt carries its book and page; never "his / he" for the En', !plain.length && !all.some((x) => /\b(his|he)\b/i.test(x)), plain.join(' | '));
  }
  const wn = M.normalizeDoc(JSON.parse(JSON.stringify({ ...M.newDoc('wdr'), limits: { deny: '0300 D+1', noMovBefore: '1900 D Day', clearLine: 'Line Y', clearBy: '0500 D+1', newPosn: 'Qila Mor', byDay: 1, junk: 2 } })));
  check('wdr R78: a file keeps the kind and the wdr limitations', wn.kind === 'wdr' && wn.limits.deny === '0300 D+1' && wn.limits.noMovBefore === '1900 D Day' && wn.limits.clearLine === 'Line Y' && wn.limits.clearBy === '0500 D+1' && wn.limits.newPosn === 'Qila Mor' && wn.limits.byDay === true && !('junk' in wn.limits));

  // R78: the Gr drafted from the AOR reading round the new posn
  const gw = W.writeGroundWdr(reading);
  const G = (id) => gw.patches.find((x) => x.id === id);
  check('wdr R78: routes back from the reading (MSR, Rd through, Rds along the apchs, laterals; OoW Vol III p 8)', G('gr.routes').state === 'gr' && /^MSR: Qila Mor – Pasrur metalled, 0\.3 km from Qila Mor\. Rd Nurpur – Qila Mor metalled runs through Qila Mor\. Rds along the apchs: Lt \(Burj – Kot Jaimal\); Cen \(Burj – Kot Jaimal\)\. Laterals: the Lt and Cen apchs joined by 2 metalled Rds; the Cen and Rt apchs joined by 1 metalled Rd\./.test(G('gr.routes').draft), G('gr.routes').draft);
  check('wdr R78: the new posn read at the MITG, a proposal (OoW Vol III p 39)', G('gr.ded.newposn').state === 'judge' && /^Read at Qila Mor: FDLs on Line X \(Kot Jaimal – Dhok Rai, 7\.6 km between bdys, along Lakhan Disty\), depth on Line Y \(Chak 21 – Jhanda\)\./.test(G('gr.ded.newposn').draft) && G('gr.ded.newposn').basis.some((b) => /OoW Vol III p 39 para 1/.test(b.text)), G('gr.ded.newposn').draft);
  check('wdr R78: intmed posns: the lines forward of the new FDLs, those on an obs first, their spacing (OoW Vol III p 33 para 16)', G('gr.ded.intmed').state === 'judge' && /^Lines across the En apchs forward of the new posn, from the front: Line W \(Burj – Tibbi, along Sukh Nala, 1\.5 km ahead of Line X\)\. As intmed posns or the covering tps' delay lines, those on an obs first: Line W\. Apart: W to X 1\.5 km; far enough that the En must redeploy/.test(G('gr.ded.intmed').draft) && G('gr.ded.intmed').basis.some((b) => /OoW Vol III p 33 para 16/.test(b.text)), G('gr.ded.intmed').draft);
  check('wdr R78: routes to keep open and to block, the primary dml belt (OoW Vol III pp 8, 55-56)', /^Keep open for the wdr until the rear parties are through: the Lt and Cen apchs \(a Rd along it\); reserve dmls on the brs they cross\. Block early: the Rt apch \(no Rd/.test(G('gr.ded.routes').draft) && /Sukh Nala \(nala\) and Lakhan Disty \(canal\)/.test(G('gr.ded.routes').draft) && G('gr.ded.routes').basis.some((b) => /p 56 para 5a/.test(b.text)), G('gr.ded.routes').draft);
  check('wdr R78: brs on the En apchs as facts, Engr advice to confirm (OoW Vol III pp 55-56)', G('sp.dml').state === 'gr' && G('sp.dml').draft === 'Brs over water on the En apchs: over Lakhan Disty on the Lt apch, 40 m off its crossing. 3 brs in the AOR, 0 with a load class recorded.' && gw.confirm.some((c) => /Engr advice/.test(c.text) && c.paras[0] === 'sp.dml'), G('sp.dml').draft);

  // R78: the aim and Time and Space by the limitations, the night of D Day, the 36 working hrs
  const lim = { deny: '0300 D+1', noMovBefore: '1900 D Day', clearLine: 'Line Y', clearBy: '0500 D+1', delayH: 12, newPosn: 'Qila Mor' };
  const wm = X.writeMechs(mIn({ limits: lim, timeNow: 'D-1 1000' }));
  const P = (id) => wm.patches.find((x) => x.id === id);
  check('wdr R78: the aim: to occupy the new posn with the min of interference and cas (OoW Vol III p 3 para 7a), the limitations tabulated (p 19 para 17, p 10 para 6c)', P('aim').draft === 'To wdr to the new def posn at Qila Mor and occupy it with the min of interference from the En and the min of cas, with fol limitations:-' && P('aim').children.map((c) => c.id).join() === 'aim.deny,aim.nomov,aim.clear,aim.delay' && P('aim').children[0].draft === 'Posn to be denied to the En until 0300 hrs D+1.' && P('aim').children[2].draft === 'All tps to be clear of Line Y by 0500 hrs D+1.' && P('aim').basis.some((b) => /p 3 para 7a/.test(b.text)) && P('aim').children[0].basis.some((b) => /p 19 para 17a/.test(b.text)), P('aim').draft);
  check('wdr R78: nothing set, nothing written; the new posn alone gives the aim without limitations', X.writeAim('wdr', {}, { place: 'Qila Mor', hMin: null, lastLt: null, turn: null, readyDerived: null }).length === 0 && X.writeAim('wdr', { newPosn: 'Burj' }, { place: 'Qila Mor', hMin: null, lastLt: null, turn: null, readyDerived: null })[0].draft === 'To wdr to the new def posn at Burj and occupy it with the min of interference from the En and the min of cas.');
  check('wdr R78: time data: the limitations, last lt D Day, first lt D+1, the hrs of darkness', P('ts.data.deny').draft === '0300 hrs D+1.' && P('ts.data.no-mov').draft === '1900 hrs D Day.' && P('ts.data.clear').draft === 'Line Y: 0500 hrs D+1.' && P('ts.data.last-lt').draft === '1800 hrs D Day (D Day 2027-02-15).' && P('ts.data.first-lt').draft === '0600 hrs D+1, the end of the ni of D Day.' && P('ts.data.dark').draft === '12 h on the ni of D Day.' && P('ts.data.time-now').draft === '1000 hrs D-1.');
  check('wdr R78: Time Req: the new posn 36 working hrs a Bn (OoW Vol I p 39), the rest no figure printed, said so', P('ts.req').table.rows[0].join('|') === 'a.|Prep of the new def posn|36|A Bn needs at least 36 working hrs to prep its posns to meet a full-scale attk (OoW Vol I p 39)' && P('ts.req').table.rows.slice(1, 4).every((r) => r[2] === '' && /^No figure printed/.test(r[3])) && X.writeMechs(mIn({ limits: lim, echelon: 'Coy' })).patches.find((x) => x.id === 'ts.req').table.rows[0][2] === '12');
  const tdr = P('ts.ded.timings').draft;
  check('wdr R78: essential timings back from the new posn ready (denied till + the delay fwd of it, OoW Vol III pp 10, 24, 31), the darkness for the mov back, in time', /^Essential timings: no rearward mov except recce parties before 1900 hrs D Day; prep of the new def posn to start not later than 0300 hrs D Day, 36 hrs before it is to be ready at 1500 hrs D\+1 \(the posn denied until 0300 hrs D\+1 and the En held fwd of the new posn 12 hrs\); posn denied until 0300 hrs D\+1, then finally abandoned; all tps clear of Line Y by 0500 hrs D\+1; 10 h of darkness for the mov back, 1900 hrs D Day to 0500 hrs D\+1\. In time: 17 h to spare/.test(tdr) && P('ts.ded.timings').basis.some((b) => /OoW Vol III p 24 para 1/.test(b.text)) && P('ts.ded.timings').basis.some((b) => /p 44 para 1/.test(b.text)), tdr);
  const wl = X.writeMechs(mIn({ limits: { deny: '0300 D+1', noMovBefore: '1500 D Day', clearBy: '0700 D+1' }, timeNow: '0500 D Day' })).patches.find((x) => x.id === 'ts.ded.timings').draft;
  check('wdr R78: the checks: clear after first lt (OoW Vol III p 44 para 1), rearward mov before last lt (p 13 para 10c(2)), the prep short from time now', /All tps clear at 0700 hrs D\+1, after first lt \(0600 hrs D\+1\): a ni wdr is to finish before daylight \(OoW Vol III p 44 para 1\)/.test(wl) && /Rearward mov from 1500 hrs D Day, before last lt/.test(wl) && /Short by 14 h: the prep of the new posn should have started at 1500 hrs D-1;.*\(OoW Vol III p 39 para 2\)/.test(wl) && /36 hrs before it is to be ready at 0300 hrs D\+1 \(when the tps disengage from the posn\)/.test(wl), wl);
  check('wdr R78: ni or day: the hrs of darkness and the moon, a proposal (OoW Vol III pp 43-44)', /^By ni: 12 h of darkness on the ni of D Day, last lt 1800 hrs D Day to first lt 0600 hrs D\+1; the wdr to start so as to finish before first lt\. The moon 50 % lit, too low or too thin to light the ni\.$/.test(P('gr.ded.time').draft) && P('gr.ded.time').state === 'judge', P('gr.ded.time').draft);
  const wday = X.writeMechs(mIn({ limits: { byDay: true, deny: '1400 D Day' } }));
  check('wdr R78: the sequence by ni (OoW Vol III p 44 para 2) and by day (p 41 para 2)', /^By ni: a\. recce parties for the rear posns and the routes back, the only rearward mov before 1900 hrs D Day; b\. AD depl/.test(P('plan.exec.seq').draft) && /\(0300 hrs D\+1\)/.test(P('plan.exec.seq').draft) && /^By day: /.test(wday.patches.find((x) => x.id === 'plan.exec.seq').draft) && wday.patches.find((x) => x.id === 'plan.exec.seq').basis.some((b) => /p 41 para 2/.test(b.text)) && /^By day, as given/.test(wday.patches.find((x) => x.id === 'gr.ded.time').draft) && wday.patches.find((x) => x.id === 'aim').children.some((c) => c.id === 'aim.day'));
  check('wdr R78: the sketch: Annex P and Q (OoW Vol III pp 75-76)', P('anx.sketch').table.rows.length === 13 && P('anx.sketch').basis[0].text.includes('Annex P p 75') && P('anx.sketch').table.rows.some((r) => /^Intmed posns$/.test(r[1])) && P('anx.sketch').table.rows.some((r) => /^Bomb line$/.test(r[1])));

  // R78: the whole sheet, its copies and exports
  const wd = M.newDoc('wdr');
  wd.limits = lim;
  M.applyPatches(wd, W.writeGround(gin).patches, 'gr');
  M.applyPatches(wd, gw.patches, 'gr');
  M.applyPatches(wd, wm.patches);
  const tx = M.toText(wd, 'draft');
  check('wdr R78: the Gr and the timings land on the outline', /^MSR:/.test(M.find(wd, 'gr.routes').draft) && /^Canal plains\./.test(M.find(wd, 'gr.gen').draft) && M.find(wd, 'gr.apchs').children.length === 3 && M.find(wd, 'gr.met').draft !== null && M.find(wd, 'ts.req').table.rows.length === 5 && M.find(wd, 'aim').children.length === 4 && tx.includes('Routes Back.') && tx.includes('Rear Parties.') && !/NCGDB|whites/i.test(tx));
  check('wdr R78: the page, Word and the style notes walk it', H.bodyHtml(wd, 'fair').includes('Intmed Posns') && D.docxFiles(wd, 'fair')['word/document.xml'].includes('Covering Tps, Flk Gds and Rearguards') && (() => { const s2 = M.newDoc('wdr'); M.setMine(s2, 'aim', 'Withdraw to X'); return X.styleNotes(s2).some((n) => n.id === 'aim' && /Understanding Aprc p 8/.test(n.note)); })());
  const ko = { copy: 'draft', blankBg: 'data:image/png;base64,BBBB' };
  const kf = K.buildDeck(wd, { ...ko, kind: 'full' }), kd = K.buildDeck(wd, { ...ko, kind: 'decision' }), ks = K.buildDeck(wd, { ...ko, kind: 'sand' });
  check('wdr R78: slides: its own short decks, "Wdr" on the foot', K.DECK_IDS.wdr && kf.some((s) => s.sourceRef === 'aprc:gr.routes') && kd.length < kf.length && kd.some((s) => s.sourceRef === 'aprc:ts.ded') && ks.every((s) => !/^aprc:(aim|en|own|crs|plan)/.test(s.sourceRef ?? '')) && kf.some((s) => s.overlays.some((v) => /^Aprc · Wdr/.test(v.text ?? ''))) && K.buildDeck(doc, { ...ko, kind: 'full' }).some((s) => s.overlays.some((v) => /^Aprc · Def/.test(v.text ?? ''))), kd.map((s) => s.sourceRef).join(' '));

  // R85: the climb read off the ground, a typed climb overriding it
  const cr = { m: 700, horizM: 1100, from: 'the SL 1.1 km SW of Burj', to: 'Qila Mor' };
  const base = { echelon: 'Bn', hMin: 120, msnBy: null, nowMin: null, hsum: null, phases: 1, bunkers: false, fupM: 1100, night: null };
  const tR = X.timeCalcAttk({ ...base, climbRead: cr });
  check('books R85: the climb read off the 30 m elevation sets the assault (1.22 slant + 120 min: 160 mins), the basis says it was read', tR.table.rows[11][2] === '160 mins' && tR.climb.by === 'read' && tR.climb.m === 700 && tR.basis.some((b) => b.kind === 'data' && /read off the 30 m elevation from the SL 1\.1 km SW of Burj to Qila Mor \(1\.1 km apart\); a climb typed in the Limitations box overrides it/.test(b.text)) && tR.basis.some((b) => /MW Annex F pp 311-313/.test(b.text)), tR.table.rows[11][2]);
  const tT = X.timeCalcAttk({ ...base, climbM: 350, climbRead: cr });
  check('books R85: a typed climb overrides the one read, and says so (17.6 degrees: no factor, 33 + 60 = 93 mins)', tT.table.rows[11][2] === '93 mins' && tT.climb.by === 'typed' && tT.basis.some((b) => b.kind === 'input' && /350 m of climb, as typed in the Limitations box \(read off the 30 m elevation: 700 m from the SL 1\.1 km SW of Burj, not used\)/.test(b.text)) && X.timeCalcAttk(base).climb === null && X.timeCalcAttk({ ...base, climbRead: { ...cr, m: 0 } }).climb === null, tT.table.rows[11][2]);
  const aIn = (o) => ({ kind: 'attk', echelon: 'Bn', reading, limits: {}, hHour: '02:00', timeNow: null, night: null, zone: 'z', ipbRows: [], planRows: [], check: null, planAdv: [], planDis: [], time: null, attk: null, attkPlan: null, hsum: null, enNear: {}, symbols: [], ...o });
  const tcR = X.writeMechs(aIn({ climb: cr })).patches.find((x) => x.id === 'ts.calc'), tcT = X.writeMechs(aIn({ climb: cr, limits: { climbM: 450 } })).patches.find((x) => x.id === 'ts.calc');
  check('books R85: the Time Calc paragraph says which climb it used; none, no words', tcR.draft === 'FUP to Obj uphill: 700 m of climb, read off the 30 m elevation from the SL 1.1 km SW of Burj to Qila Mor (1.1 km apart); a climb typed in the Limitations box overrides it.' && /^FUP to Obj uphill: 450 m of climb, as typed in the Limitations box \(read off the 30 m elevation: 700 m/.test(tcT.draft) && X.writeMechs(aIn({})).patches.find((x) => x.id === 'ts.calc').draft === '' && has(M.find(M.newDoc('attk'), 'ts.calc'), /Read takes the climb off the 30 m elevation from the SL, else the FUP, to the obj; a climb typed in the Limitations box overrides it/), tcR.draft);

  // R74: the line of denial drawn on the AOR trace and listed on the sketch
  const fr = { reading, layout: 'deductions', style: 'trace', orient: 'north', layers: { going: true, apch: true, line: true, itg: true, dml: true, msr: true }, northDeg: 0, source: 'echelon', used: 'echelon', note: null, echelon: 'Bn', profileLabel: 'Tracked', when: 'Dry · Feb', season: 'dry', month: 'Feb', loading: false, keys: { detail: false } };
  const svgD = S.aorMapSvg(reading, { ...fr, denial: 'Y' }, 900, 800, 'full'), svg0 = S.aorMapSvg(reading, fr, 900, 800, 'full'), svgM = S.aorMapSvg(reading, { ...fr, denial: 'Y' }, 397, 300, 'min');
  check('books R74: the trace marks the line of denial given, "Line of Denial" beside its letter; none set, none marked', (svgD.match(/>Line of Denial</g) ?? []).length === 1 && (svgD.match(/stroke-width="12"/g) ?? []).length === 1 && !svg0.includes('Line of Denial') && !svg0.includes('stroke-width="12"') && svgM.includes('>Line of Denial<') && !S.aorMapSvg(reading, { ...fr, denial: 'Q' }, 900, 800, 'full').includes('Line of Denial'));
  // the Gr Scope rail's Copy as Text (guide.aorText) names it too, once the guide has it (guide.setAorDenial)
  const txD = S.aorText(reading, { ...fr, denial: 'Y' }), tx0 = S.aorText(reading, fr);
  check('books R74: the AOR Copy as Text names the line of denial on its line of def (OoW Vol I pp 17-18); none set, none named', /Line Y \(Line of Denial, given by the higher comd: OoW Vol I pp 17-18\)\./.test(txD) && (txD.match(/Line of Denial/g) ?? []).length === 1 && !tx0.includes('Line of Denial'), txD.match(/.*Line Y.*/)?.[0]);
  check('books R74: the rail\'s Lines row names it ("Denial Y"); a letter the reading has no line for, not', / · Denial Y$/.test(S.aorWords(reading, { ...fr, denial: 'Y' }).rows.line[0]) && !/Denial/.test(S.aorWords(reading, { ...fr, denial: 'Q' }).rows.line[0]) && !/Denial/.test(S.aorWords(reading, fr).rows.line[0]), S.aorWords(reading, { ...fr, denial: 'Y' }).rows.line[0]);
  const skD = X.writeSketch('def', [], null, null, { denial: 'Y', lines: ['W', 'X', 'Y', 'Z'] })[0], skN = X.writeSketch('def', [], null, null, { denial: 'Q', lines: ['W', 'X', 'Y', 'Z'] })[0], sk0 = X.writeSketch('def', [], null, null)[0];
  const lastD = skD.table.rows[skD.table.rows.length - 1];
  check('books R74: the sketch annex lists the line of denial, on the trace or not (OoW Vol I pp 17-18)', skD.table.rows.length === sk0.table.rows.length + 1 && lastD[1] === 'Line of denial: Line Y, given by the higher comd with the msn' && lastD[2] === 'On the trace: Line Y, "Line of Denial"' && /OoW Vol I pp 17-18/.test(lastD[3]) && /^Not on the trace: no Line Q in the reading$/.test(skN.table.rows[skN.table.rows.length - 1][2]) && X.writeSketch('attk', [], null, null, { denial: 'Y', lines: ['Y'] })[0].table.rows.length === 14);
  const wdD = X.writeMechs({ ...mIn({ kind: 'def', limits: { denial: 'Y' } }), hHour: '06:00' }).patches.find((x) => x.id === 'anx.sketch');
  check('books R74: a def Read with a line of denial set carries it to the sketch annex', wdD.table.rows.some((r) => r[1] === 'Line of denial: Line Y, given by the higher comd with the msn'));
}

// ── the five books re-read for the Aprc (Aprc_Review.md, 28 Nov 2026): GSP-1947, IBB, OoW Vol I / II, MW, DW ─────────
{
  const X = await import('../../MS/Engines/GroundAppreciation/AprcMechs.ts');
  const B = await import('../../MS/Engines/GroundAppreciation/AprcBooks.ts');
  const fs = await import('node:fs');
  const hasB = (p, re) => !!p && p.basis.some((b) => re.test(b.text));
  const hasP = (p, re) => !!p && p.prompts.some((x) => re.test(x));

  // F1: a Bn normally 3-5 km in the plains (IBB pp 276-277); Annex U App 6 is the extended frontages' annex
  const n48 = X.coysUp(4800), n55 = X.coysUp(5500);
  check('five F1: a Bn normally holds 3-5 km (IBB S53 para 4 c pp 276-277); 5.5 km is extended, 4.8 km is not', !n48.ext && n55.ext && n48.up === 3 && n48.basis[0].text.includes('IBB S53 para 4 c pp 276-277') && /where a Bn normally holds 3-5 km/.test(n48.text) && /extended frontage, its gaps covered/.test(n55.text) && /two Coys up 4\.5 km and three up 6\.5 km/.test(n55.text), n55.text);
  const o40 = X.coysUp(4000, null, { obstacle: 'BRB Canal' }), o45 = X.coysUp(4500, null, { obstacle: 'BRB Canal' });
  check('five F1: along a canal / A tk ditch three Coys up up to 4,115 m (IBB S61 p 333; Annex V p 483)', o40.up === 3 && !o40.ext && o45.ext && /along BRB Canal, where a Bn three Coys up holds up to 4\.1 km/.test(o40.text) && o40.basis[0].text.includes('IBB S61 p 333') && o40.basis[0].text.includes('IBB S60 p 331'), o40.text);
  const m40 = X.coysUp(4000, null, { ground: 'mountains' }), d40 = X.coysUp(4000, null, { ground: 'desert' });
  check('five F1: mountains and desert print no Bn figure, IBB taken and the book\'s rule beside (OoW Vol I p 72; DW p 22)', /MW prints no Bn figure/.test(m40.text) && m40.basis.some((b) => /OoW Vol I p 72/.test(b.text)) && /DW prints no Bn figure/.test(d40.text) && d40.basis.some((b) => /DW p 22/.test(b.text) && /GSP-1947 p 172/.test(b.text)));
  check('five F1: frontages below Bn not extended (IBB S59 para 6 b p 326)', n48.basis.some((b) => /IBB S59 para 6 b p 326/.test(b.text)));

  // wide water along the FDLs: 24 m or more (IBB S60 p 331)
  const wet = JSON.parse(JSON.stringify(reading));
  wet.apchs.forEach((a) => a.obstacles.forEach((ob) => { if (ob.name === 'Lakhan Disty') ob.widthM = 60; }));
  check('five F1: the water along a line counts as an obs only at 24 m or more (a 9 m disty does not)', X.wideWaterOn(reading, reading.lines[1]) === null && X.wideWaterOn(wet, wet.lines[1])?.widthM === 60 && X.wideWaterOn(wet, wet.lines[2]) === null);
  const Lw = X.layoutDef(wet, {}, 'Bn');
  const lpw = X.writeLayoutDef(Lw, wet);
  check('five F1: on a 60 m canal the Bn goes three Coys up along it, extended past 4.1 km, its width named', Lw.wideObs?.name === 'Lakhan Disty' && Lw.coys.up === 3 && Lw.coys.ext && /along Lakhan Disty, where a Bn three Coys up holds up to 4\.1 km/.test(lpw.find((x) => x.id === 'gr.ded.dp1.fdls').draft) && hasB(lpw.find((x) => x.id === 'gr.ded.dp1.fdls'), /Lakhan Disty: 60 m wide/));

  // F5: a Bde's depth at the yardstick's 4-6 km (OoW Vol I Annex B p 103); on a DCB GSP-1947 p 119
  const Lb = X.layoutDef(reading, {}, 'Bde');
  const lpb = X.writeLayoutDef(Lb, reading);
  const Pb = (id) => lpb.find((x) => x.id === id);
  check('five F5: a Bde\'s front against the yardstick, OoW Vol I Annex B p 103', !Lb.coys && /The FDLs run 7\.6 km, narrower than the 10\.0 km of the yardstick; the depth line 1\.3 km behind the FDLs, short of the 4-6 km yardstick\./.test(Pb('gr.ded.dp1.fdls').draft) && hasB(Pb('gr.ded.dp1.fdls'), /OoW Vol I Annex B p 103/) && hasB(Pb('gr.ded.dp1.depth'), /OoW Vol I Annex B p 103/), Pb('gr.ded.dp1.fdls').draft);
  const Lbw = X.writeLayoutDef(X.layoutDef(wet, {}, 'Bde'), wet).find((x) => x.id === 'gr.ded.dp1.fdls');
  check('five F5: a Bde on a DCB: up to 8-10 km, all three Bns three up (GSP-1947 p 119 para 5, pp 120-121)', /along Lakhan Disty, narrower than the 8\.0 km a Bde may be given on a DCB: all three Bns three up/.test(Lbw.draft) && hasB(Lbw, /GSP-1947 s26 para 5 p 119/) && hasB(Lbw, /pp 120-121/), Lbw.draft);
  const Lf2 = X.layoutDef(reading, { fwd: true }, 'Bde');
  check('five F5: a Bde\'s depth line looked for 4-6 km behind the FDLs, not the guide\'s Bn 3-5 km', Lf2.fdl.id === 'Y' && Lf2.depth?.id === 'Z');

  // F2: the res by echelon and ground
  check('five F2: a Bde\'s res is not the guide\'s Bn res: no "never LAT / HAT", OoW Vol I pp 18-19 and GSP-1947 p 122 cited', /^The Bde res behind Line Y: strong in armr, at least equal to the En in mobility and hitting power\./.test(Pb('gr.ded.dp1.res').draft) && !/LAT and HAT never/.test(Pb('gr.ded.dp1.res').draft) && hasB(Pb('gr.ded.dp1.res'), /GSP-1947 s27 para 3 p 122/) && hasB(Pb('gr.ded.dp1.res'), /OoW Vol I pp 18-19/), Pb('gr.ded.dp1.res').draft);
  const mtn = { ...reading, country: 'Mountains' }, des = { ...reading, country: 'Desert' };
  const Lm = X.layoutDef(mtn, {}, 'Bn'), Ld = X.layoutDef(des, {}, 'Bn');
  const lpm = X.writeLayoutDef(Lm, mtn), lpd = X.writeLayoutDef(Ld, des);
  const Pm = (id) => lpm.find((x) => x.id === id), Pd = (id) => lpd.find((x) => x.id === id);
  check('five F2: in mountains the res split, a central one of little value upwards of Bn lvl (MW p 169; GSP-1947 p 176)', /In mountains: split, each part close to its valley/.test(Pm('gr.ded.dp1.res').draft) && hasB(Pm('gr.ded.dp1.res'), /MW p 169/) && hasB(Pm('gr.ded.dp1.res'), /GSP-1947 p 176/));
  check('five F2: in desert a third or more, mainly armr, down to Bde, within 2-6 h (DW pp 26-27)', /one third or more of the force, mainly armr, kept down to Bde, employed within 2-6 h/.test(Pd('gr.ded.dp1.res').draft) && hasB(Pd('gr.ded.dp1.res'), /DW p 26/) && hasB(Pd('gr.ded.dp1.res'), /DW p 27/));
  check('five N5: mountains hold the dominating features astride the main axis (MW p 147; GSP-1947 p 175); desert localities with large gaps (DW p 22)', /In mountains: hold the dominating features astride the main axis/.test(Pm('gr.ded.dp1.fdls').draft) && hasB(Pm('gr.ded.dp1.fdls'), /MW p 147/) && /In desert: deny the vital gr only/.test(Pd('gr.ded.dp1.fdls').draft) && hasB(Pd('gr.ded.dp1.fdls'), /DW p 22/) && !/In mountains|In desert/.test(X.writeLayoutDef(X.layoutDef(reading, {}, 'Bn'), reading).find((x) => x.id === 'gr.ded.dp1.fdls').draft));

  // F3 and N4: A tk in bulk; protective dets never reinforced; C pen at the outset
  const lp0 = X.writeLayoutDef(X.layoutDef(reading, {}, 'Bn'), reading);
  const P0 = (id) => lp0.find((x) => x.id === id);
  check('five N4: protective dets never so large as to weaken the main def, never reinforced (OoW Vol I p 13; GSP-1947 p 105 para 10)', /Never so large as to weaken the main def, and not reinforced\./.test(P0('gr.ded.dp1.adv').draft) && hasB(P0('gr.ded.dp1.adv'), /GSP-1947 p 105 para 10/) && hasB(P0('gr.ded.dp1.adv'), /OoW Vol I p 13/));
  check('five N4: C pen posns planned and prepared at the outset (GSP-1947 p 109 para 22; OoW Vol I p 52)', /planned and prepared at the outset\.$/.test(P0('gr.ded.dp1.cpen').draft) && hasB(P0('gr.ded.dp1.cpen'), /GSP-1947 p 109 para 22/) && hasB(P0('gr.ded.dp1.cpen'), /OoW Vol I p 52/));
  check('five N5: in desert covering tps rather than an adv posn (OoW Vol I p 71), the C pen mode less preferred (DW p 27), ATGMs concentrated (DW p 58)', /covering tps rather than an adv posn/.test(Pd('gr.ded.dp1.adv').draft) && !/an adv posn on Sukh Nala/.test(Pd('gr.ded.dp1.adv').draft) && hasB(Pd('gr.ded.dp1.adv'), /OoW Vol I p 71/) && /less preferred, not ruled out/.test(Pd('gr.ded.dp1.cpen').draft) && hasB(Pd('gr.ded.dp1.armr'), /DW p 58/));

  // N6: the En attk by the ground (MW pp 164-165; DW p 13)
  const vm = X.visDef(Lm, mtn, { hMin: 360, night: null }), vd = X.visDef(Ld, des, { hMin: 360, night: null }), v0 = X.visDef(X.layoutDef(reading, {}, 'Bn'), reading, { hMin: 360, night: null });
  check('five N6: in mountains the En punishes selected posts, multidirectional, infiltrating (MW pp 164-165)', vm.steps.some((x) => /punish selected posts first and attk the feature covering the Lt apch from multiple dirs, infiltrating/.test(x.en)) && vm.basis.some((b) => /MW pp 164-165/.test(b.text)) && vm.steps.length === v0.steps.length + 1 - 2 * Math.min(2, Lm.ahead.length) && !vm.steps.some((x) => /protective dets/.test(x.en)));
  check('five N6: in desert the En outflanks the def, fight the battle outflanked (DW p 13)', vd.steps.some((x) => /by-pass the localities and outflank the def/.test(x.en) && /Fight the battle outflanked/.test(x.own)) && vd.basis.some((b) => /DW p 13 para a/.test(b.text)) && !v0.basis.some((b) => /MW pp 164-165|DW p 13/.test(b.text)));

  // F4 / N7: the Time Req's mines and guns by ground
  const mines = { frontM: 6100, engr: 'Engr Fd Coy', handH: 63, mechH: 21, perPl: 780, src: "SO's Hbk 2019 p 439" };
  const base = { move: null, prep: { h: [36, 36], src: 'OoW Vol I p 39' }, mines, guns: 'Bty' };
  const tD = W.writeTimeReq({ ...base, ground: 'Desert' }), tP = W.writeTimeReq({ ...base, ground: 'Plains' }), tM = W.writeTimeReq({ ...base, ground: 'Mountains' });
  const mRow = (t) => t.patches[0].table.rows.find((r) => r[1] === 'Protective M fd laying');
  const gRow = (t) => t.patches[0].table.rows.find((r) => r[1] === 'Depl of the DS fd Bty');
  check('five F4: in desert the M fd by hand (MMLs fail in loose sand, DW p 65); elsewhere the MMLs\' shorter time', mRow(tD)[2] === '63' && /MMLs only on the dhars, by hand on the soft sand/.test(mRow(tD)[3]) && tD.patches[0].basis.some((b) => /DW p 65/.test(b.text)) && mRow(tP)[2] === '21' && !/dhars/.test(mRow(tP)[3]) && tD.reqH - tP.reqH === 63 - 36 && W.minesHours(mines, 'Desert').h === 63 && W.minesHours(mines, 'Desert').sand && W.minesHours(mines, 'Plains').h === 21 && W.minesHours(null, 'Desert').h === null);
  check('five N7: guns by section near hairpin bends in mountains (MW pp 240, 244); towed guns in loose sand (DW p 60)', /single wpn|singly or by sections near the hairpin bends/.test(gRow(tM)[3]) && tM.patches[0].basis.some((b) => /MW p 240/.test(b.text) && /MW p 244/.test(b.text)) && /towed guns are hard to move in loose sand, SP guns ideal/.test(gRow(tD)[3]) && tD.patches[0].basis.some((b) => /DW p 60/.test(b.text)) && !/hairpin|loose sand/.test(gRow(tP)[3]));

  // F7 / F8: the attack's FUP and dir by ground
  const av = (o) => ({ id: 'A', rank: 1, onto: 'left', label: 'Lt flanking', lengthM: 6200, goPct: 80, minWidthM: 1400, waterLines: 1, assaultM: 1100, assaultNogoPct: 0, fupWhere: '1.1 km W of Qila Mor', ...o });
  const e = { objective: 'Qila Mor', mover: 'dismounted inf', aaFor: 'Bn', mcWidthM: 500, fupM: 1100, start: 'own start', startAssumed: false, avenues: [av({ id: 'L' }), av({ id: 'R', rank: 2, onto: 'right', label: 'Rt flanking' })], turn: null };
  const fupOf = (c) => W.writeAttkDir({ ...e, country: c }).patches.find((x) => x.id === 'gr.ded.ap1.fup');
  const dirOf = (c) => W.writeAttkDir({ ...e, country: c }).patches.find((x) => x.id === 'gr.ded.apch');
  check('five F7: in mountains no classic FUP, a designated place crossed at H (MW p 85), MGs\' range with NVDs (MW p 228)', hasB(fupOf('Mountains'), /no classic FUP.*MW p 85.*MW p 228/) && hasB(fupOf('Canal plains'), /1000-1200 m, out of the En NVD and SA reach \(IBB p 201\)/) && !hasB(fupOf('Canal plains'), /MW p 85/));
  check('five F8: in mountains frontal attks have little chance, along ridges and spurs (MW pp 78-79); desert by the tk going (DW pp 34, 38; OoW Vol II p 68)', hasB(dirOf('Mountains'), /MW pp 78-79/) && hasB(dirOf('Desert'), /DW pp 34, 38/) && hasB(dirOf('Desert'), /OoW Vol II p 68/) && !hasB(dirOf(null), /MW pp 78-79|DW pp 34, 38/));

  // N1-N3, N8-N12: the outline's heads to consider, each with its book and page
  const da = M.newDoc('attk'), dd = M.newDoc('def'), dw = M.newDoc('wdr');
  check('five N1: aslt frontages by echelon and ground under Phases of Attk (IBB p 248; GSP-1947 pp 86-87; DW p 47; GSP-1947 p 88)', hasP(M.find(da, 'gr.ded.c.phases'), /GSP-1947 p 86 para 12 d/) && hasP(M.find(da, 'gr.ded.c.phases'), /IBB S47 para 17 a p 248/) && hasP(M.find(da, 'gr.ded.c.phases'), /DW p 47/) && hasP(M.find(da, 'gr.ded.c.phases'), /thinking two down.*GSP-1947 p 88/));
  check('five N2: main and secondary attk (p 84), prelim ops (p 89), an obs aslt at two places (p 90), reorg with the tks till the RRs are sited (p 91)', hasP(M.find(da, 'gr.ded.ap1'), /GSP-1947 p 84 para 7/) && hasP(M.find(da, 'own.ded.c.hold'), /GSP-1947 p 89/) && hasP(M.find(da, 'gr.ded.c.pnr'), /GSP-1947 p 90 para 14/) && hasP(M.find(da, 'gr.ded.c.reorg'), /GSP-1947 p 91/));
  check('five N3: the En res times under En Caps and Blocking Posn (GSP-1947 p 83, IDD p 5 beside)', hasP(M.find(da, 'en.caps'), /35-40 min.*2-3 h.*4-6 h.*12-16 h \(GSP-1947 p 83\); IDD p 5 differs/) && hasP(M.find(da, 'en.ded.ap1.block'), /GSP-1947 p 83/));
  check('five N12: mountains and desert in the attack (MW pp 80-82, 85-86; DW pp 38-39, 46-48)', hasP(M.find(da, 'gr.ded.ap1.fup'), /MW p 85/) && hasP(M.find(da, 'gr.ded.c.pnr'), /MW p 86/) && hasP(M.find(da, 'gr.ded.c.timing'), /MW p 82/) && hasP(M.find(da, 'own.ded.c.res'), /MW p 82/) && hasP(M.find(da, 'own.ded.c.res'), /DW p 39/) && hasP(M.find(da, 'gr.ded.c.armr'), /DW p 48/) && hasP(M.find(da, 'gr.ded.c.reorg'), /DW p 46/) && hasP(M.find(da, 'ts.calc'), /MW pp 80-81/));
  check('five N4 / N11: the def\'s echelons and main / secondary effort (GSP-1947 p 104); DP heads by ground and on a DCB', hasP(M.find(dd, 'gr.ded.common'), /GSP-1947 p 104 para 4/) && hasP(M.find(dd, 'gr.ded.common'), /GSP-1947 p 104 para 5/) && hasP(M.find(dd, 'gr.ded.dp1.fdls'), /GSP-1947 p 119 para 5/) && hasP(M.find(dd, 'gr.ded.dp1.adv'), /GSP-1947 p 105 para 10/) && hasP(M.find(dd, 'gr.ded.dp1.cpen'), /GSP-1947 p 109 para 22/) && hasP(M.find(dd, 'gr.ded.dp1.armr'), /IBB p 73/) && hasP(M.find(dd, 'gr.ded.dp1.res'), /MW p 169/) && hasP(M.find(dd, 'plan.adm'), /DW p 21/));
  check('five N10: the wdr: GSP-1947 s30 beside OoW Vol III; no wdr on foot in desert (DW p 32)', hasP(M.find(dw, 'gr.ded.intmed'), /GSP-1947 p 149; IBB p 378/) && hasP(M.find(dw, 'gr.ded.newposn'), /GSP-1947 p 145/) && hasP(M.find(dw, 'ts.ded.timings'), /GSP-1947 p 147/) && hasP(M.find(dw, 'sec.sec'), /GSP-1947 p 143 para 8/) && hasP(M.find(dw, 'own.mob'), /DW p 32/) && hasP(M.find(dw, 'gr.routes'), /DW p 32/));

  // F6: cites
  const modelSrc = fs.readFileSync(new URL('../../MS/Engines/GroundAppreciation/AprcModel.ts', import.meta.url), 'utf8');
  check('five F6: the climb\'s rule is MW Annex F p 313 para 3 c (not p 312); the amn lift\'s rows add to 101, its total 123 kept', !/Annex F p 312\)/.test(modelSrc) && /MW Annex F p 313 para 3 c/.test(modelSrc) && B.liftDraft('def', 'Bn').basis.some((b) => /rows add to 101, its printed total 123 is kept/.test(b.text)));
  // the line's name already says "Along X": not "along X" twice; the ground's rule once in the FDLs' basis
  const named = { ...des, lines: des.lines.map((l) => (l.id === 'X' ? { ...l, name: 'Along Lakhan Disty' } : l)) };
  const fdN = X.writeLayoutDef(X.layoutDef(named, {}, 'Bn'), named).find((x) => x.id === 'gr.ded.dp1.fdls');
  const crN = X.courseDef(X.layoutDef(named, {}, 'Bn'), named, { check: null, prepFrom: null, readyBy: null });
  check('five: a line named "Along X" is not followed by "along X" again; the desert rule once in the basis', /^Line X \(Along Lakhan Disty\), 3 km past/.test(fdN.draft) && /^Def along Line X \(Along Lakhan Disty\)\./.test(crN.text) && fdN.basis.filter((b) => /DW p 22/.test(b.text)).length === 1 && Pm('gr.ded.dp1.fdls').basis.filter((b) => /OoW Vol I p 72/.test(b.text)).length === 1, fdN.draft);
  const two = { ...wet, lines: wet.lines.map((l) => (l.id === 'X' ? { ...l, buas: ['Kot Jaimal', null, 'Dhok Rai'] } : l)) };
  const crT = X.courseDef(X.layoutDef(two, {}, 'Bn'), two, { check: null, prepFrom: null, readyBy: null });
  check('five F1: Course A takes the Coys up of DP 1 when the BUAs on the line are fewer (3 up along the canal, 2 BUAs)', /FDLs comprising 3 Coys, a Coy each in area Kot Jaimal and Dhok Rai and one more on Line X\./.test(crT.text) && /FDLs comprising 3 Coys, a Coy each in area Kot Jaimal, Nurpur and Dhok Rai\./.test(X.courseDef(X.layoutDef(reading, {}, 'Bn'), reading, { check: null, prepFrom: null, readyBy: null }).text), crT.text);
  // SZB_Review.md I2 / I3 / I5 / U7: the SZ by its ground (SZ Battle (C&SC) p 3 paras 5-7, p 19, pp 7-8)
  {
    const szB = (pp) => pp.basis.some((b) => /SZ Battle \(C&SC\) p 3 paras 5-7/.test(b.text));
    const p0a = P0('gr.ded.dp1.adv'), pma = Pm('gr.ded.dp1.adv'), pda = Pd('gr.ded.dp1.adv');
    const L0z = X.layoutDef(reading, {}, 'Bn');
    check('szb I2: plains, the SZ under 5 km leaves no room for a C Tps battle on DLs (SZ Battle p 3)', new RegExp(`The SZ is ${L0z.fdlKm.toFixed(1).replace('.0', '')} km: the plains' none or 2-5 km leaves no room for a C Tps battle on several DLs`).test(p0a.draft) && szB(p0a) && p0a.basis[0].text.includes('OoW Vol I p 14'), p0a.draft);
    check('szb I3: mountains, no SZ battle, OPs / screens / link ptls only, no protective dets (SZ Battle p 3; MW s12 p 164)', /^No SZ battle in the mountains/.test(pma.draft) && Lm.detsWhere === null && szB(pma) && hasB(pma, /MW s12 p 164/), pma.draft);
    check('szb I2: desert, the C Tps on the lines ahead as DLs across the SZ, shallower than 20-50 km here (SZ Battle pp 3, 10)', /DLs across the SZ/.test(pda.draft) && /shallower than the desert's 20-50 km: room for fewer DLs/.test(pda.draft) && hasB(pda, /SZ Battle p 10 para 20 b/) && /covering tps rather than an adv posn/.test(pda.draft), pda.draft);
    const far = (r, k) => ({ ...r, lines: r.lines.map((l) => ({ ...l, depthM: l.depthM != null ? l.depthM * k : l.depthM })), apchs: r.apchs.map((a) => ({ ...a, pastM: a.pastM * k })) });
    const desFar = far(des, 7);
    const Ldf = X.layoutDef(desFar, {}, 'Bn');
    const vdf = X.visDef(Ldf, desFar, { hMin: 360, night: null });
    check('szb I5: a desert SZ over 10 km, the En clears it by daylight (SZ Battle pp 7-8) beside DW 24-48 h and the guide\'s 1 km/h', Ldf.fdlKm > 10 && vdf.basis.some((b) => /SZ Battle pp 7-8/.test(b.text) && /DW pp 10-12/.test(b.text) && /15-20 min before H/.test(b.text)) && !vd.basis.some((b) => /SZ Battle pp 7-8/.test(b.text)), `${Ldf.fdlKm}`);
    check('szb U7: the En\'s shallow mnvr round a DL 10-15 km in 3 h, deep 20-25 km in 6 h, beside the guide\'s 4 h (SZ Battle p 19)', v0.basis.some((b) => /SZ Battle p 19 para 31/.test(b.text)) && !vm.basis.some((b) => /SZ Battle p 19/.test(b.text)) && vm.basis.some((b) => /no SZ battle in Kashmir/.test(b.text)));
    // U10: a C Tps msn in the Limitations box (SZ Battle p 4 para 8; pp 26-27 para 41 f-g)
    const aimP = (lim) => X.writeAim('def', lim, { place: 'X', hMin: null, lastLt: null, turn: null, readyDerived: null }).flatMap((p) => p.children ?? []).find((k) => k.id === 'aim.delay');
    const a1 = aimP({ delayH: 48, casPct: 30, viable: true }), a2 = aimP({ casPct: 20 }), a3 = aimP({ delayH: 12 });
    check('szb U10: the aim "Delay the En for 48 hrs inflicting 30% cas on the En, while remaining a viable force." cites SZ Battle', a1?.draft === 'Delay the En for 48 hrs inflicting 30% cas on the En, while remaining a viable force.' && a1.basis.some((b) => /SZ Battle p 4 para 8/.test(b.text)) && a2?.draft === 'Inflict 20% cas on the En.' && a3?.draft === 'Delay the En for 12 hrs.', JSON.stringify([a1?.draft, a2?.draft, a3?.draft]));
    check('szb U10: casPct and viable survive a file, a cas over 100 % is dropped', (() => { const l = M.normLimits({ casPct: 30, viable: true }); const l2 = M.normLimits({ casPct: 150 }); return l?.casPct === 30 && l?.viable === true && l2 === undefined; })());
    // E6 / U5 / U6 / U8 / U9: the handout's heads as prompts in the def outline
    const ddz = M.newDoc('def');
    check('szb E6: DP 1 Adv Posn prompts the SZ by sector, the C Tps msn, technique, KGs at dhars, BHOL, passage and grouping', hasP(M.find(ddz, 'gr.ded.dp1.adv'), /SZ Battle \(C&SC\) p 3 para 5/) && hasP(M.find(ddz, 'gr.ded.dp1.adv'), /pp 14-16 para 27/) && hasP(M.find(ddz, 'gr.ded.dp1.adv'), /pp 12-13 paras 23-24/) && hasP(M.find(ddz, 'gr.ded.dp1.adv'), /pp 21-22 para 35/));
    check('szb U5 / U8 / U9: arty, AD and engrs in the SZ; 2-2.5 second line lifts in Adm and Log', hasP(M.find(ddz, 'gr.ded.common'), /SZ Battle pp 24-25/) && hasP(M.find(ddz, 'plan.adm'), /2-2\.5 lifts.*SZ Battle p 25 para 38 f/));
    check('szb U6: the En\'s SZ clearance, feint 50-60 km and para / heliborne up to a Bde (SZ Battle pp 7-8)', hasP(M.find(ddz, 'en.ded.common'), /Flight Path Bde/) && hasP(M.find(ddz, 'en.ded.common'), /feint by the Holding Corps 50-60 km away/));
    check('szb I7: the sketch names the BHOL beside the BHL', /BHL \(BHOL\)/.test(fs.readFileSync(new URL('../../MS/Engines/GroundAppreciation/AprcMechs.ts', import.meta.url), 'utf8')));
  }
  check('five: groundKind takes the AOR\'s country',B.groundKind('Mountains') === 'mountains' && B.groundKind('Desert') === 'desert' && B.groundKind('Canal plains') === 'plains' && B.groundKind(null) === 'plains');
}

function dClockOf(X, m) {
  return X.dClock(m);
}

console.log(`\n${n - fails} of ${n} checks passed`);
process.exit(fails ? 1 : 0);
