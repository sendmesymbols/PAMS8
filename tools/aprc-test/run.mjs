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
  check('kinds: defence ready, attack has its place', kinds.find((k) => k.kind === 'def').ready && kinds.find((k) => k.kind === 'attk').ready === false);
  check('kinds: attack falls back to the defence outline until registered', M.newDoc('attk').kind === 'def');
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
  check('Gr: Met Conditions with light', /February: max 21 °C, min 7 °C, rain 28 mm, wind 2\.0 m\/s/.test(P('gr.met').draft) && /first lt 06\d\d, last lt 18\d\d hrs \(UTC\+5\)/.test(P('gr.met').draft), P('gr.met').draft);
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
  check('print: A4 with the page number and the marking as a ruled line in the margins', /@page\{size:A4/.test(pr) && /@top-center\{content:counter\(page\) "\\A ________________"/.test(pr) && /@bottom-center\{content:"________________"/.test(pr) && pr.startsWith('<!doctype html>'));
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
  check('slides: full brief has the title, the apchs one by one and Confirm on Gr', titles[0] === 'APRC OF THE SIT' && ['Apchs', 'Lt Apch', 'Cen Apch', 'Rt Apch', 'Gen Description', 'ITGs', 'Deductions', 'Confirm on Gr'].every((t) => titles.includes(t)), titles.join(' | '));
  check('slides: unwritten paragraphs make no slide', !titles.includes('Air Sit') && !titles.includes('Msn'));
  check('slides: decision brief is shorter, sand model is the ground only', dec.length < full.length && sand.length < full.length && !sand.some((s) => s.title === 'Aim') && dec.some((s) => s.title === 'AIM' || s.title === 'Aim'), `${full.length}/${dec.length}/${sand.length}`);
  check('slides: every slide is screen-only with a source and a section', full.every((s) => s.backgroundDataUrl && s.sourceRef?.startsWith('aprc:') && s.sourceHash && s.view.capturedIn === '2d') && full.find((s) => s.title === 'Apchs').section === 'Factors: Gr and Weather');
  const lt = full.find((s) => s.title === 'Lt Apch');
  check('slides: an apch is a table of its heads beside the trace', lt.overlays.some((v) => v.kind === 'table' && v.rows.length === 12 && v.rows[0][0] === 'Definition') && lt.overlays.some((v) => v.kind === 'image' && v.src.startsWith('data:image/png')));
  const fairDeck = K.buildDeck(doc, { ...o, copy: 'fair', kind: 'full' });
  check('slides: the fair copy leaves proposals out', !JSON.stringify(fairDeck).includes('(proposal)') && JSON.stringify(full).includes('(proposal)'));
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

console.log(`\n${n - fails} of ${n} checks passed`);
process.exit(fails ? 1 : 0);
