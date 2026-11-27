// mtnair.mjs -- checks the Air tab and the weather notes on mountain ground (Mountain Warfare, GSP-1973): own LZs masked
// from the En's view (MW p 255), take-off into the wind (p 255), dust and snow clouds on dry barren ground (p 256), the
// lift at altitude (pp 256, 263), the two air notes (pp 257-258), and the mountain weather notes (pp 9, 10, 69, 71,
// 229-230, 288-289, 298) by month and height; none of it on the plains.
//   node tools/ipb-test/mtnair.mjs
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
register('../movement-test/hooks.mjs', import.meta.url);
const { airIpb, airRulesFrom } = await import('../../MS/Engines/GroundGuide/GroundGuideIpbAir.ts');
const { lzWind, windRulesFrom } = await import('../../MS/Engines/GroundGuide/GroundGuideWind.ts');
const { mountainWxNotes } = await import('../../MS/Engines/GroundGuide/GroundGuideIpbDecision.ts');

const here = dirname(fileURLToPath(import.meta.url));
const doctrine = JSON.parse(readFileSync(resolve(here, '../../MS/Data/IpbDoctrine.json'), 'utf8'));
const rules = airRulesFrom(doctrine);
let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
}
// 300 x 300 cells of 30 m, flown north from the bottom edge; the LZ zone in the north (6-8.6 km along).
const N = 300, RES = 30;
function grid(paint, base = 200) {
  const elev = new Float32Array(N * N).fill(base), cls = new Uint8Array(N * N);
  if (paint) paint({ elev, cls });
  return { z: 12, ts: 256, tx0: 0, ty0: 0, nx: 1, ny: 1, w: N, h: N, px0: 0, py0: 0, res: RES, elev, cls, bld: null, pending: false };
}
const frame = { sx: 150, sy: 297, axisDeg: 0, lengthM: 8700, widthM: 8400 };
const run = (g, o = {}) => airIpb({
  grid: g, rules, frame, band: 'contour', lzClass: 4, lzPoints: 1,
  observers: [], obstructions: [], lines: [], existing: [],
  lzZone: { fromM: 6000, toM: 8600 }, objective: { x: 150, y: 40 }, tables: null, enemyLz: false, maxLz: 40, ...o,
});
// A knife-edge ridge `h` m high runs north-south at x 198-199 through the LZ zone (too narrow to land on): west of it the floor is hidden from an observer
// on the floor to the east (x 270); east of it the floor is in his view. The ridge also gives the relief that makes it
// mountain ground (200 m within 1 km).
const ridged = (h, base, paint) => grid(({ elev, cls }) => {
  for (let y = 0; y < 110; y++) for (let x = 198; x < 200; x++) elev[y * N + x] = base + h;
  if (paint) paint({ elev, cls });
}, base);
const eyes = [{ x: 270, y: 40, eyeM: 2, reachM: 6000, label: 'En OP' }];
const west = (z) => z.x < 197, east = (z) => z.x > 201 && z.x < 265;

// ── masked own LZs (MW p 255) ─────────────────────────────────────────────────────────────────────────────────────────
{
  const g = ridged(250, 1500);
  const own = run(g, { observers: eyes });
  const zh = own.lzs.find((z) => z.mountain && west(z) && z.seenP !== null && z.seenP < 0.2);
  // in view: a 300 m wall along the west edge makes the strip beside it mountain ground; an observer on the open floor sees it
  const wall = grid(({ elev }) => { for (let y = 0; y < 110; y++) for (let x = 0; x < 20; x++) elev[y * N + x] = 1800; }, 1500);
  const seenRun = run(wall, { observers: [{ x: 90, y: 40, eyeM: 2, reachM: 6000, label: 'En OP' }], objective: { x: 40, y: 40 } });
  const zs = seenRun.lzs.find((z) => z.mountain && z.seenP !== null && z.seenP >= 0.5);
  check('mountains, own LZ behind the ridge: "masked from the En\'s view (MW p 255)"', !!zh && /masked from the En's view \(MW p 255\)/.test(zh.why), zh ? zh.why : 'none');
  check('...an own LZ in his view: cautioned, landing sites are shielded by masking terrain or woods (MW p 255)', !!zs && zs.caution.some((c) => /MW p 255/.test(c)), zs ? zs.caution.join('; ') : 'none');
  check('...the masked LZ ranks first', own.lzs[0] && west(own.lzs[0]) && own.lzs[0].seenP !== null && own.lzs[0].seenP < 0.2, own.lzs[0]?.why);
  const en = run(g, { observers: eyes, enemyLz: true });
  const ze = en.lzs.find((z) => Math.abs(z.x - zh.x) < 1 && Math.abs(z.y - zh.y) < 1);
  check('...the masked bonus is the own side\'s only: the same LZ scores 3 x (1 - seen) more for own than for the En', !!ze && Math.abs(zh.score - ze.score - rules.mtn.maskW * (1 - zh.seenP)) < 0.15, ze ? `${zh.score} own vs ${ze.score} En` : 'not found');
  check('...the En\'s LZ never says "masked" (that is his choice)', en.lzs.every((z) => !/MW p 255/.test(z.why) && !z.caution.some((c) => /MW p 255/.test(c))));
  const low = run(ridged(100, 1500), { observers: eyes });
  check('the same layout with a 100 m ridge (not mountain ground): no MW p 255 text', low.lzs.length > 0 && low.lzs.every((z) => !z.mountain && !/MW p 255/.test(z.why) && !z.caution.some((c) => /MW p 255/.test(c))), low.lzs[0]?.why);
  check('mountain LZs: the two air notes, strafing and bunker busting non-effective (MW p 257), heliborne less hampered by low cloud (p 258)', own.notes.some((n) => /MW p 257/.test(n)) && own.notes.some((n) => /MW p 258/.test(n)));
  check('...no such notes on the plains', !low.notes.some((n) => /MW p 25[78]/.test(n)));
}

// ── dust and snow clouds, the lift at altitude (MW pp 256, 263) ───────────────────────────────────────────────────────
{
  const bare = run(ridged(250, 1500, ({ cls }) => { for (let y = 0; y < 110; y++) for (let x = 0; x < 198; x++) cls[y * N + x] = 12; }));
  const zb = bare.lzs.find((z) => z.mountain && west(z));
  check('mountains, an LZ on bare ground: cautioned for dust clouds that give the landing away and blind the pilot (MW p 256)', !!zb && zb.caution.some((c) => /dust or snow clouds .*MW p 256/.test(c)), zb ? zb.caution.join('; ') : 'none');
  const open = run(ridged(250, 1500));
  const zo = open.lzs.find((z) => z.mountain && west(z));
  check('...open land: no dust caution', !!zo && !zo.caution.some((c) => /dust/.test(c)), zo?.caution.join('; '));
  const high = run(ridged(250, 2700));
  const zh = high.lzs.find((z) => z.mountain);
  check('mountains at 2700 m: the lift cautioned, density altitude and weight (MW pp 256, 263; 2500 m, E)', !!zh && zh.elevM >= 2500 && zh.caution.some((c) => /above sea level: the lift falls with altitude .*MW pp 256, 263/.test(c)), zh ? `${zh.elevM} m: ${zh.caution.join('; ')}` : 'none');
  check('...at 1500 m: no altitude caution', !!zo && !zo.caution.some((c) => /above sea level/.test(c)), String(zo?.elevM));
  check('the doctrine: altitudeM 2500 basis E, decided and searched; dust share M; masked weight M', rules.mtn.altM === 2500 && doctrine.air.mountain.altitudeM.basis === 'E' && !!doctrine.air.mountain.altitudeM.decided && !!doctrine.air.mountain.altitudeM.searched && doctrine.air.mountain.dust.share.basis === 'M' && doctrine.air.mountain.masked.weightBasis === 'M');
}

// ── take off into the wind (MW p 255) ────────────────────────────────────────────────────────────────────────────────
{
  const R = windRulesFrom(doctrine);
  const h = { hourUtc: 0, hourLocal: 5, fromDeg: 270, meanMs: 5, vecMs: 4.5, steady: 0.9 };
  const w = { month: 1, hours: [], all: h, day: h, night: h, turns: false, light: false, variable: false, text: '', dirText: '', source: 'ERA5', dataDate: '1990-2019' };
  const all8 = [0, 45, 90, 135, 180, 225, 270, 315];
  const m = lzWind(all8, w, R, true), p = lzWind(all8, w, R, false);
  check('mountains, both ways clear: take off into the wind (to W): less power, more payload (MW p 255)', /take off into the wind \(to W\): less power, more payload \(MW p 255\)/.test(m.text), m.text);
  check('...the plains: no MW p 255', !/MW p 255/.test(p.text), p.text);
  const m2 = lzWind([90], w, R, true);
  check('...the departure upwind not clear: room to turn into the wind, not "take off into the wind"', /leave room to turn into it/.test(m2.text) && !/take off into the wind \(to/.test(m2.text), m2.text);
}

// ── the mountain weather notes (MW pp 9, 10, 69, 71, 229-230, 288-289, 298) ──────────────────────────────────────────
{
  const ids = (o) => mountainWxNotes(doctrine, o).map((x) => x.id);
  const jan3000 = ids({ month: 1, elevM: 3000, mountain: true });
  check('a 3000 m area in January: fog, poor visibility, snow over the tracks, slides, flash floods, weather from the west', ['fog', 'poorVis', 'snowTracks', 'slides', 'flashFloods', 'westToEast'].every((k) => jan3000.includes(k)), jan3000.join(', '));
  const jul3000 = ids({ month: 7, elevM: 3000, mountain: true });
  check('...in July: no winter snow notes (tracks, slides), the fog and visibility stay', !jul3000.includes('snowTracks') && !jul3000.includes('slides') && jul3000.includes('fog') && jul3000.includes('poorVis'), jul3000.join(', '));
  const jan1500 = ids({ month: 1, elevM: 1500, mountain: true });
  check('...at 1500 m in January: no poor-visibility (above 2000 m), no tracks (above 2500 m) or slides (above 2000 m)', !jan1500.includes('poorVis') && !jan1500.includes('snowTracks') && !jan1500.includes('slides') && jan1500.includes('fog'), jan1500.join(', '));
  check('...height unknown: only the notes that need no height', !ids({ month: 1, elevM: null, mountain: true }).some((k) => ['poorVis', 'snowTracks', 'slides'].includes(k)));
  check('...off the mountains: none', ids({ month: 1, elevM: 3000, mountain: false }).length === 0);
  const fog = mountainWxNotes(doctrine, { month: 1, elevM: 3000, mountain: true }).find((x) => x.id === 'fog');
  check('...the fog note reaches the Wx tiles for fire, manoeuvre and air, with 0900-1000 and MW p 229', !!fog && ['fire', 'mnvr', 'air'].every((u) => fog.for.includes(u)) && /0900-1000/.test(fog.text) && /MW p 229/.test(fog.text));
  const snow = doctrine.coding.season.mountainWx.items.find((x) => x.id === 'snowTracks');
  check('...the snow-tracks note is a manoeuvre note above 2500 m in winter (MW p 298)', snow.aboveM === 2500 && snow.winter === true && /MW p 298/.test(snow.text) && snow.for.join() === 'mnvr');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
