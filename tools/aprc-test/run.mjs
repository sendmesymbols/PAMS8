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
  check('outline: parts in order', d.parts.map((p) => p.title).join('|') === 'REVIEW OF SIT|AIM|FACTORS|COURSES|PLAN');
  check('outline: FACTORS groups', d.parts[2].groups.map((g) => g.title).join('|') === 'Gr and Weather|En Sit|Own Sit|Time and Space');
  const top = M.lines(d).filter((l) => l.type === 'para' && l.depth === 0).map((l) => l.label);
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
  check('time: the move in as a lower bound', t.rows[0][2] === '0.9 +' && /18\.4 km in a straight line at 20 km\/h by night/.test(t.rows[0][3]));
  check('time: posn preparation and mine laying with their books', t.rows[1][2] === '24-36' && t.rows[3][2] === '63' && M.find(d, 'ts.req').basis.some((b) => /p 399/.test(b.text)) && M.find(d, 'ts.req').basis.some((b) => /p 439/.test(b.text)));
  check('time: the rows it cannot tell are left blank; total is a floor', t.rows[2][2] === '' && t.rows[4][2] === '' && t.rows[t.rows.length - 1][2] === '88 +' && M.find(d, 'ts.req').state === 'judge');
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
  check('attk outline: parts in the book\'s order', d.parts.map((p) => p.title).join('|') === 'REVIEW OF THE SIT|AIM|FACTORS|COURSES|PLAN');
  const top = M.lines(d).filter((l) => l.type === 'para' && l.depth === 0);
  check('attk numbering: 24 paras as the book', top.length === 24 && top.every((l, i) => l.label === `${i + 1}.`), `${top.length}`);
  const at = (id) => M.numberOf(d, id);
  check('attk numbering: Gen Description 5, Imp Tac Grs 6, Apchs 7, Deductions 11', at('gr.gen') === '5' && at('gr.itg') === '6' && at('gr.apchs') === '7' && at('gr.ded') === '11');
  check('attk numbering: En Sit 12, Own Sit 13, Almt 14, Time and Space 15', at('en') === '12' && at('own') === '13' && at('almt') === '14' && at('ts') === '15');
  check('attk numbering: Course A 16, En Reactions 17, Analysis 18, Course Adopted 20', at('crs.a') === '16' && at('crs.react') === '17' && at('crs.an') === '18' && at('crs.adopted') === '20');
  check('attk numbering: Msn 21, Exec 22, Adm and Log 23, Comd and Sig 24', at('plan.msn') === '21' && at('plan.exec') === '22' && at('plan.adm') === '23' && at('plan.comd') === '24');
  check('attk numbering: sub-paragraphs as the book', at('gr.ded.aps') === '11d' && at('plan.exec.coord.loc') === '22h(2)' && at('crs.react.ph2.depth') === '17e(3)' && at('en.ded.basic') === '12c(1)', `${at('gr.ded.aps')} ${at('plan.exec.coord.loc')} ${at('crs.react.ph2.depth')} ${at('en.ded.basic')}`);
  let unref = 0;
  M.walk(d, (p) => { if (p.draft === null && !p.prompts.some((x) => /^Mechs of Aprc \(Attk\) pp? [\d-]+$/.test(x))) unref++; });
  check('attk prompts: every ruled paragraph cites the book and its page', unref === 0, `${unref} without`);
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
  check('attk Apchs: capacity rests on the book\'s 4 km Bde and the IPB widths', P('gr.apch.lt.capacity').basis.some((b) => b.kind === 'rule' && /Mechs of Aprc \(Attk\) p 2/.test(b.text) && /IPB book p 7/.test(b.text)));
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
  check('attk strength: ratio own to en, against the 3 : 1 an attacker wants (MW p 80)', p.table.rows[0][4] === '4.0 : 1' && /more than the 3 : 1 an attacker wants/.test(p.draft) && p.basis.some((b) => /MW p 80/.test(b.text)), JSON.stringify(p.table.rows[0]));
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

console.log(`\n${n - fails} of ${n} checks passed`);
process.exit(fails ? 1 : 0);
