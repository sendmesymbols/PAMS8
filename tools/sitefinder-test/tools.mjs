// tools.mjs -- X-Section, Compare and AOI Check engine checks.
//   node tools/sitefinder-test/tools.mjs
// Node 24 runs the pure engines (MS/Engines/SiteScan/SiteLine.ts, Compare/CompareRead.ts, AoiCheck/AoiCheckRead.ts) on a
// synthetic ground near Lahore and on the real bundle manifest, so every answer has a known value: samples along a line,
// a canal crossed (NO-GO, one crossing), a road followed (along, not a crossing), no-data gaps by kind, steep stretches
// by mover, soil after rain, what a threat sees; two corridors and two positions compared (best, worst, the differences,
// ties that rank nobody); tile maths, the share of an AOI inside the data, no-data pixels, the layers and sources of the
// real manifest (never the name NCGDB) and the AOI verdict. Exit code 1 on a failure.
import { register } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const S = await import('../../MS/Engines/SiteScan/SiteScan.ts');
const LN = await import('../../MS/Engines/SiteScan/SiteLine.ts');
const C = await import('../../MS/Engines/Compare/CompareRead.ts');
const AO = await import('../../MS/Engines/AoiCheck/AoiCheckRead.ts');

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');

let fails = 0;
let n = 0;
function check(name, ok, info = '') {
  n++;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const O = S.lngLatToMerc(74.3, 31.5);
const sc = S.scaleAt(O[1]);
const at = (e, nn) => [O[0] + e / sc, O[1] + nn / sc];
const en = (p) => [(p[0] - O[0]) * sc, (p[1] - O[1]) * sc];
const RULES = {
  profiles: {
    wheeled: { label: 'Wheeled Vehicle', nogo: [4, 20], caution: [] },
    tracked: { label: 'Tracked Vehicle', nogo: [4], caution: [20] },
    dismounted: { label: 'Dismounted', nogo: [], caution: [20] },
  },
  grotbc: { soilStrength: { byProfile: { wheeled: 'wheeled', tracked: 'tracked', dismounted: 'foot' }, vehicles: { wheeled: { fine: [55, 95], coarse: [50, 80] }, tracked: { fine: [45, 75], coarse: [25, 40] }, foot: { fine: [15, 25], coarse: [10, 20] } } } },
};
function world(o = {}) {
  return {
    cls: (x, y) => (o.cls ?? (() => 0))(...en([x, y])),
    elev: (x, y) => (o.elev ?? (() => 200))(...en([x, y])),
    layer: (k, x, y) => {
      const [e, nn] = en([x, y]);
      if (k === 'cc') return ((o.cc ?? (() => 2))(e, nn) << 4) | (o.cover ?? (() => 1))(e, nn);
      if (k === 'wet') return (o.wet ?? (() => 0))(e, nn);
      if (k === 'rci_dry') return 120;
      if (k === 'rci_wet') return (o.rciWet ?? (() => 120))(e, nn);
      if (k === 'bld') return 0;
      return null;
    },
    roads: () => (o.road ? [{ distM: 200, x: 0, y: 0, attrs: { t: 'secondary', k: 2, aw: true, r: 'N-5', c: '50' } }] : []),
    features: () => [],
    people: () => 300,
    ...(o.sight ? { sight: (ox, oy, eye, tx, ty) => o.sight(...en([tx, ty])) } : {}),
  };
}
const north = (len) => [at(0, 0), at(0, len)];

// ── 1. SiteLine ─────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const w = LN.walkPath(north(1000), 30);
  check('walkPath: 1 km at 30 m = 35 samples, first 0, last 1000', w.length === 35 && w[0].m === 0 && near(w[w.length - 1].m, 1000, 0.5), `${w.length}`);
  const w2 = LN.walkPath([at(0, 0), at(0, 45), at(45, 45)], 30);
  check('walkPath round a corner keeps an even 30 m spacing in chainage', w2.map((q) => Math.round(q.m)).join(',') === '0,30,60,90', w2.map((q) => Math.round(q.m)).join(','));

  const canal = world({ cls: (e, nn) => (nn >= 400 && nn < 440 ? 20 : 0) });
  const p = LN.profileLine(canal, north(1000), S.goingRule(RULES, 'wheeled', 'dry'), { stepM: 10 });
  const ev = p.events.filter((e) => e.kind === 'canal');
  check('a 40 m canal across the line: one canal crossing, NO-GO for wheels', ev.length === 1 && ev[0].mode === 'cross' && ev[0].going === 'nogo' && p.stats.crossings.canal === 1, JSON.stringify(ev.map((e) => [e.mode, e.going, Math.round(e.fromM), Math.round(e.toM)])));
  check('the canal crossing sits at 400-440 m and the NO-GO stretch is about 40 m', near(ev[0].fromM, 400, 10) && near(ev[0].toM, 440, 10) && p.nogo.length === 1 && near(p.stats.nogoM, 40, 12), `${Math.round(p.stats.nogoM)} m`);
  const pt = LN.profileLine(canal, north(1000), S.goingRule(RULES, 'tracked', 'dry'), { stepM: 10 });
  check('the same canal for tracks (SLOW-GO class): no NO-GO, some SLOW-GO', pt.stats.nogoM === 0 && pt.stats.slowM > 20);

  const along = world({ cls: (e) => (Math.abs(e) < 20 ? 34 : 0) });
  const pa = LN.profileLine(along, north(1500), S.goingRule(RULES, 'wheeled', 'dry'), { stepM: 30 });
  check('a line along a road for 1.5 km: one "along" event, not a crossing', pa.events.length === 1 && pa.events[0].mode === 'along' && !pa.stats.crossings.road, pa.events.map((e) => e.label).join(';'));

  const gaps = world({ elev: (e, nn) => (nn >= 600 && nn < 700 ? NaN : 200), cls: (e, nn) => (nn >= 800 && nn < 900 ? null : 0) });
  const pg = LN.profileLine(gaps, north(1000), S.goingRule(RULES, 'wheeled', 'dry'), { stepM: 10 });
  check('no height 600-700 m and no class 800-900 m: two gaps of the right kinds', pg.gaps.length === 2 && pg.gaps[0].what === 'elev' && pg.gaps[1].what === 'class' && near(pg.stats.gapM, 200, 25), JSON.stringify(pg.gaps.map((g) => [g.what, Math.round(g.fromM), Math.round(g.toM)])));
  check('ground with no class is "not read", never GO', near(pg.stats.unknownM, 100, 15), `${Math.round(pg.stats.unknownM)} m`);

  const ramp = world({ elev: (e, nn) => (nn < 200 ? 100 : nn < 400 ? 100 + (nn - 200) * 0.3 : 160) });
  const pw = LN.profileLine(ramp, north(600), S.goingRule(RULES, 'wheeled', 'dry'), { stepM: 10, steepPct: LN.steepFor('wheeled') });
  const pf = LN.profileLine(ramp, north(600), S.goingRule(RULES, 'dismounted', 'dry'), { stepM: 10, steepPct: LN.steepFor('dismounted') });
  check('a 30% climb: steep for wheels (from 26.8%), not for foot (from 57.7%)', pw.steep.length === 1 && pf.steep.length === 0 && near(pw.stats.maxSlopePct, 30, 1), `${pw.stats.maxSlopePct.toFixed(1)}%`);
  check('climb 60 m up, none down', near(pw.stats.gainM, 60, 3) && pw.stats.lossM < 1, `${pw.stats.gainM.toFixed(1)}`);
  const noisy = world({ elev: (e, nn) => 200 + (Math.round(nn / 30) % 2 ? 1.2 : -1.2) });
  const pz = LN.profileLine(noisy, north(5000), S.goingRule(RULES, 'wheeled', 'dry'), { stepM: 30 });
  check('flat ground with +-1.2 m elevation noise: no climb counted (3 m steps)', pz.stats.gainM === 0 && pz.stats.lossM === 0, `${pz.stats.gainM} / ${pz.stats.lossM}`);

  const soft = world({ rciWet: (e, nn) => (nn >= 300 && nn < 500 ? 40 : 120) });
  const ps = LN.profileLine(soft, north(1000), S.goingRule(RULES, 'wheeled', 'wet'), { stepM: 10 });
  const pd = LN.profileLine(soft, north(1000), S.goingRule(RULES, 'wheeled', 'dry'), { stepM: 10 });
  check('cone index 40 after rain stops wheels (55) for 200 m; dry it does not', near(ps.stats.nogoM, 200, 15) && ps.nogo[0].why === 'soil too soft' && pd.stats.nogoM === 0, `${Math.round(ps.stats.nogoM)} m, ${ps.nogo[0]?.why}`);
  const lake = world({ wet: (e, nn) => (nn >= 100 && nn < 150 ? 5 : nn >= 700 && nn < 800 ? 4 : 0) });
  const plw = LN.profileLine(lake, north(1000), S.goingRule(RULES, 'wheeled', 'wet'), { stepM: 10 });
  const plf = LN.profileLine(lake, north(1000), S.goingRule(RULES, 'dismounted', 'wet'), { stepM: 10, onFoot: true });
  check('water stops everyone; waterlogged ground after rain stops wheels, slows foot', near(plw.stats.nogoM, 150, 20) && near(plf.stats.nogoM, 50, 15) && plf.stats.slowM >= 90, `${Math.round(plw.stats.nogoM)} / ${Math.round(plf.stats.nogoM)} / ${Math.round(plf.stats.slowM)}`);

  const seen = world({ sight: (e, nn) => (nn < 500 ? 0.9 : 0.1) });
  const pv = LN.profileLine(seen, north(1000), S.goingRule(RULES, 'wheeled', 'dry'), { stepM: 10, sightFrom: { at: at(0, -3000), eyeM: 2, targetM: 2.5 } });
  check('a threat that sees the first half: seen 50%, one seen stretch 0-500 m', near(pv.stats.seenShare, 0.5, 0.03) && pv.seenStretches.length === 1 && near(pv.seenStretches[0].toM, 500, 15), `${pv.stats.seenShare?.toFixed(2)}`);
  const pn = LN.profileLine(seen, north(1000), S.goingRule(RULES, 'wheeled', 'dry'), { stepM: 10 });
  check('without a threat: seen not read (null), no seen stretches', pn.stats.seenShare === null && pn.seenStretches.length === 0);
}

// ── 2. Compare ──────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const A = { mover: 'wheeled', moverLabel: 'Wheeled Vehicle', season: 'dry', seasonWhy: 'Nov', threat: null, eyeM: 2, targetM: 2.5, dataLine: '' };
  const g = world({ cls: (e, nn) => (e < 50 && nn >= 400 && nn < 440 ? 20 : 0), road: true });
  const lines = [
    { id: 'A', kind: 'line', pts: [at(0, 0), at(0, 1000)], name: '' },
    { id: 'B', kind: 'line', pts: [at(500, 0), at(500, 1300)], name: '' },
  ];
  const r = C.compareAlts(g, RULES, lines, A);
  const row = (k, kind = 'line') => r.rows.find((x) => x.key === k && x.kind === kind);
  check('corridor A crosses the canal, B does not: water crossings best B, worst A', row('water').best.join() === 'B' && row('water').worst.join() === 'A', `${row('water').cells.A.value} / ${row('water').cells.B.value}`);
  check('NO-GO best B (none), A about 40 m', row('nogo').best.join() === 'B' && row('nogo').cells.B.value === 'none');
  check('length: A 1.0 km best, B 1.3 km', row('length').best.join() === 'A' && row('length').worst.join() === 'B');
  check('bridges are shown, never ranked', row('bridges').better === null && row('bridges').best.length === 0);
  check('the differences name the rows that differ', r.diffs.some((d) => d.startsWith('Water crossings')) && r.diffs.some((d) => d.startsWith('NO-GO')));
  check('every row says how it was worked out', r.rows.every((x) => x.how && x.how.length > 20));
  check('tally: B best on more corridor rows than A', r.tally.B.best > r.tally.A.best, `${r.tally.A.best} / ${r.tally.B.best} of ${r.tally.A.of}`);
  const same = C.compareAlts(world({}), RULES, [{ id: 'A', kind: 'line', pts: north(1000), name: '' }, { id: 'B', kind: 'line', pts: [at(300, 0), at(300, 1000)], name: '' }], A);
  check('two corridors that read alike: nobody is best, the note says so', same.rows.every((x) => x.best.length === 0) && /read alike/.test(same.diffs[0]), same.diffs[0]);

  const half = world({ cls: (e) => (e < 0 ? 20 : 0), cc: (e) => (e > 400 ? 3 : 1), road: true });
  const areas = [
    { id: 'A', kind: 'area', pts: C.circleRing(at(0, 0), 250), name: '' },
    { id: 'B', kind: 'area', pts: C.circleRing(at(800, 0), 250), name: '' },
  ];
  const ra = C.compareAlts(half, RULES, areas, A);
  const ar = (k) => ra.rows.find((x) => x.key === k && x.kind === 'area');
  check('position A half on a canal, B clear: usable Gr best B (100%), A about 50%', ar('usable').best.join() === 'B' && near(ar('usable').cells.A.num, 0.5, 0.1), ar('usable').cells.A.value);
  check('hidden from air: B (good) best, A (poor) worst', ar('air').best.join() === 'B' && ar('air').worst.join() === 'A');
  check('a 250 m circle reads about 0.20 km²', near(ar('size').cells.A.num, Math.PI * 0.0625, 0.01), ar('size').cells.A.value);
  const mixed = C.compareAlts(half, RULES, [lines[0], areas[0]], A);
  check('one corridor and one position: both read, nothing ranked, a note says why', mixed.rows.every((x) => x.best.length === 0) && mixed.notes.some((x) => /nothing is ranked/.test(x)));
  const withThreat = C.compareAlts(world({ sight: (e) => (e < 400 ? 0.9 : 0.1) }), RULES, lines, { ...A, threat: at(0, -3000) });
  const sr = withThreat.rows.find((x) => x.key === 'seen' && x.kind === 'line');
  check('seen by threat: A (all seen) worst, B (unseen) best', sr.best.join() === 'B' && sr.worst.join() === 'A', `${sr.cells.A.value} / ${sr.cells.B.value}`);
}

// ── 2b. Compare: every row says when a difference counts, and what data it read ─────────────────────────────────────
{
  const A2 = { mover: 'wheeled', moverLabel: 'Wheeled Vehicle', season: 'dry', seasonWhy: 'Nov', threat: null, eyeM: 2, targetM: 2.5, dataLine: '', dataText: (k) => `DATA[${k}]`, inputText: 'A, B drawn on the map' };
  const r2 = C.compareAlts(world({}), RULES, [{ id: 'A', kind: 'line', pts: north(1000), name: '' }, { id: 'B', kind: 'line', pts: [at(300, 0), at(300, 1000)], name: '' }], A2);
  check('Compare: every ranked row states its smallest real difference (proposal); unranked rows say so', r2.rows.every((x) => (x.better ? /Ranked only when the alternatives differ by more than [\d.]+ /.test(x.how) : /Shown, not ranked/.test(x.how))), r2.rows.find((x) => x.key === 'nogo').how.slice(-160));
  check('Compare: rows name the data they read and where the alternatives came from', r2.rows.find((x) => x.key === 'nogo').how.includes('DATA[class]; DATA[rci]; DATA[wet]') && r2.rows.every((x) => /drawn on the map/.test(x.how)));
}

// ── 2c. Source dates ───────────────────────────────────────────────────────────────────────────────────────────────
check('source dates: ranges, full dates and years are read whole', S.shortDate('1984-2021') === '1984-2021' && S.shortDate('2026-10-28') === '2026-10-28' && S.shortDate('2011-2015 (TanDEM-X acquisitions)') === '2011-2015' && S.shortDate('1970-2000 normal') === '1970-2000' && S.shortDate('2021') === '2021' && S.shortDate('not recorded') === '' && S.shortDate('2000, 2005, 2010, 2015, 2020 (2020 used)') === '2020');

// ── 3. AOI Check ────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const ring = [at(-5000, -5000), at(5000, -5000), at(5000, 5000), at(-5000, 5000)];
  const box = AO.boxOf(ring);
  const z = AO.pickZoom(box, 8, 12, 48);
  check('a 10 x 10 km AOI is checked at the finest zoom (12) in under 48 tiles a layer', z === 12 && AO.tileRange(box, 12).n <= 48, `${AO.tileRange(box, 12).n} tiles`);
  const big = [at(-150000, -150000), at(150000, -150000), at(150000, 150000), at(-150000, 150000)];
  const zb = AO.pickZoom(AO.boxOf(big), 8, 12, 48);
  check('a 300 x 300 km AOI drops to a coarser zoom to stay under 48 tiles', zb < 12 && AO.tileRange(AO.boxOf(big), zb).n <= 48, `z${zb}, ${AO.tileRange(AO.boxOf(big), zb).n} tiles`);
  const tb = AO.tileBox(5, 7, 4);
  const back = AO.tileRange([tb[0] + 1, tb[1] + 1, tb[2] - 1, tb[3] - 1], 4);
  check('tileBox and tileRange agree (one tile back)', back.tx0 === 5 && back.tx1 === 5 && back.ty0 === 7 && back.ty1 === 7);
  const [lng, lat] = AO.mercToLngLat(...at(0, 0));
  const share = AO.shareInside(ring, [lng, lat - 1, lng + 1, lat + 1]);
  check('an AOI half east of the frame edge: about 50% inside', near(share, 0.5, 0.06), share?.toFixed(2));
  check('AOI area: 10 x 10 km = 100 km²', near(AO.ringKm2(ring), 100, 1), AO.ringKm2(ring).toFixed(1));
  // a tile half no-data
  const t = AO.tileRange(box, 12);
  const data = new Uint8Array(256 * 256);
  for (let r = 0; r < 256; r++) for (let c = 0; c < 128; c++) data[r * 256 + c] = 255;
  const whole = [[AO.tileBox(t.tx0, t.ty0, 12)[0] - 1, AO.tileBox(t.tx0, t.ty0, 12)[1] - 1], [AO.tileBox(t.tx0, t.ty0, 12)[2] + 1, AO.tileBox(t.tx0, t.ty0, 12)[1] - 1], [AO.tileBox(t.tx0, t.ty0, 12)[2] + 1, AO.tileBox(t.tx0, t.ty0, 12)[3] + 1], [AO.tileBox(t.tx0, t.ty0, 12)[0] - 1, AO.tileBox(t.tx0, t.ty0, 12)[3] + 1]];
  const nd = AO.nodataInTile(data, t.tx0, t.ty0, 12, 256, whole, 255, 4);
  check('a tile with its west half no-data: half the pixels inside the AOI are empty', near(nd.empty / nd.inside, 0.5, 0.02), `${nd.empty}/${nd.inside}`);

  const mpath = resolve(repo, 'MS/Data/terrain-bundle/manifest.json');
  if (existsSync(mpath)) {
    const man = JSON.parse(readFileSync(mpath, 'utf8'));
    const rules = JSON.parse(readFileSync(resolve(repo, 'MS/Data/terrain-bundle/rules.json'), 'utf8'));
    const L = AO.aoiLayers(man, rules);
    check('real manifest: class, both height bytes and cc are layers; class and heights are core', ['class', 'elev_hi', 'elev_lo', 'cc'].every((k) => L.some((l) => l.key === k)) && L.filter((l) => l.core).map((l) => l.key).sort().join() === 'class,elev_hi,elev_lo');
    check('real manifest: a distance layer per mover (dist_tracked among them)', L.some((l) => l.key === 'dist:tracked' && l.tileLayer === 'dist_tracked') && L.filter((l) => l.key.startsWith('dist:')).length === (man.profiles ?? []).length);
    const names = (man.sources ?? []).map((s) => AO.sourceName(s.id, s.name));
    check('real manifest: no source is shown as "NCGDB" (1:50k map instead)', names.every((x) => !/NCGDB/.test(x)) && names.some((x) => /1:50k map/.test(x)), names.find((x) => /50k/.test(x)));
    const tallies = L.map((layer) => ({ layer, z: 12, total: 10, loaded: layer.core ? 4 : 10, missing: layer.core ? 6 : 0, failed: 0, pending: 0, gapTiles: [], inside: 100, empty: 0 }));
    const rep = AO.buildReport(ring, man, tallies, []);
    check('class and heights missing on 60% of the AOI: verdict bad, core readings listed first', rep.verdict.tone === 'bad' && rep.affected[0].core && near(rep.affected[0].share, 0.6, 0.01), rep.verdict.text);
    const full = AO.buildReport(ring, man, L.map((layer) => ({ layer, z: 12, total: 10, loaded: 10, missing: 0, failed: 0, pending: 0, gapTiles: [], inside: 100, empty: 0 })), [{ key: 'population', uses: 'People', share: 1, note: '' }]);
    check('every tile present and no empty pixels: verdict ok, nothing affected', full.verdict.tone === 'ok' && full.affected.length === 0, full.verdict.text);
    const pending = AO.buildReport(ring, man, L.map((layer) => ({ layer, z: 12, total: 10, loaded: 5, missing: 0, failed: 0, pending: 5, gapTiles: [], inside: 100, empty: 0 })), []);
    check('while tiles are on their way the verdict says so', pending.pending && pending.verdict.tone === 'unknown');
  } else {
    console.log('SKIP  real manifest checks (no terrain bundle in MS/Data/terrain-bundle)');
  }
}

console.log(`\n${n - fails} / ${n} checks passed`);
process.exit(fails ? 1 : 0);
