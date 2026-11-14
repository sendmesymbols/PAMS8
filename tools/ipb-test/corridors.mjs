// corridors.mjs -- checks for the IPB mobility corridors and avenues of approach (GroundGuideIpbCorridors.ts).
//   node tools/ipb-test/corridors.mjs            synthetic checks + real frames from MS/Data/terrain-bundle (when present)
//   node tools/ipb-test/corridors.mjs --no-real  synthetic checks only
// Synthetic ground is a coding made by hand (GO everywhere, then NO-GO rivers, belts, SLOW-GO bands), so every answer
// has a known place. Exit code 1 when a check fails.
import { register } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const { findCorridors, attackArrow, simplifyLine, arrowHeadFrac } = await import('../../MS/Engines/GroundGuide/GroundGuideIpbCorridors.ts');
const { codeIpb, ipbRulesFrom, IPB, WHY } = await import('../../MS/Engines/GroundGuide/GroundGuideIpb.ts');

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
}

// ------------------------------------------------------------------------------------------------ synthetic codings
// 400 x 300 cells of 30 m (12 x 9 km); movement east along the middle; frame 10.8 x 7.2 km.
const W = 400, H = 300, RES = 30;
function coding(paint) {
  const code = new Uint8Array(W * H).fill(IPB.GO), why = new Uint16Array(W * H), waterW = new Uint16Array(W * H);
  if (paint) paint({ set: (x, y, k, w = 0, ww = 0) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const q = y * W + x; code[q] = k; why[q] = w; waterW[q] = ww; } });
  return { x0: 0, y0: 0, w: W, h: H, res: RES, code, why, waterW };
}
const frame = { sx: 20, sy: 150, axisDeg: 90, lengthM: 360 * RES, widthM: 240 * RES };
const run = (c, o = {}) => findCorridors({ coding: c, frame, mcWidthM: o.mc ?? 500, spacingM: o.sp ?? 2000, sectorDeg: 90, strips: o.strips });
const viable = (r) => r.aas.filter((a) => a.viable);
// x of a frame point `alongM` from the start edge.
const X = (alongM) => Math.round(20 + alongM / RES);

// 1 Open plain: straight avenues, no narrows, no crossover.
{
  const r = run(coding());
  const v = viable(r);
  check('open plain: avenues found, each room for 3+ corridors', v.length >= 1 && v.every((a) => a.open), `${v.length} avenues · ${r.ms.toFixed(0)} ms`);
  check('open plain: no narrows, no crossover', r.aas.every((a) => a.narrows.length === 0) && r.crossovers.length === 0);
  const a = v[0];
  const dy = Math.abs(a.line[1] - a.line[a.line.length - 1]);
  check('open plain: the way runs straight along the axis', dy < 3 && !a.stopped, `drift ${dy.toFixed(1)} cells`);
  check('open plain: avenues lettered A, B… by rank', r.aas.map((x) => x.id).join('') === 'ABCDEFG'.slice(0, r.aas.length) && r.aas[0].rank === 1);
  check('open plain: each avenue has two corridors drawn inside it', v.every((x) => x.mcs.length === 2 && r.mcs.filter((m) => m.aa === x.id).length === 2));
}

// 2 A NO-GO river across the frame (4 cells, 120 m) with one bridge at y = 100: every way crosses there.
{
  const c = coding(({ set }) => {
    for (let y = 0; y < H; y++) for (let x = 200; x < 204; x++) set(x, y, IPB.NOGO, WHY.WATER, 120);
    for (let x = 200; x < 204; x++) for (let y = 100; y < 102; y++) set(x, y, IPB.SLOW, WHY.CROSSING);
  });
  const r = run(c);
  const v = viable(r);
  const cross = r.aas.flatMap((a) => a.narrows).filter((n) => n.kind === 'crossing');
  check('river with one bridge: one avenue (the ways meet at the bridge)', v.length === 1, `${v.length} avenues · ${r.ways.join(' | ')}`);
  check('river with one bridge: a crossing narrows at the bridge', cross.length >= 1 && Math.abs(cross[0].y - 101) <= 3 && Math.abs(cross[0].x - 202) <= 4, cross[0] ? `at ${cross[0].x.toFixed(0)},${cross[0].y.toFixed(0)} · ${cross[0].widthM} m` : 'none');
  check('river with one bridge: the narrows is as wide as the bridge (60 m)', cross.length >= 1 && cross[0].widthM <= 90, cross[0] ? `${cross[0].widthM} m` : '');
}
{
  const c = coding(({ set }) => { for (let y = 0; y < H; y++) for (let x = 200; x < 204; x++) set(x, y, IPB.NOGO, WHY.WATER, 120); });
  const r = run(c);
  check('river with no bridge: the ways stop at the river', r.aas.length >= 1 && r.aas.every((a) => a.stopped && a.endM < (200 - 20) * RES + 60), r.aas.map((a) => `${a.id} stops ${(a.endM / 1000).toFixed(1)} km`).join(', '));
}

// 3 Two NO-GO belts along the axis leaving a gap: 3 km gap = an avenue; a 650 m gap = a lone corridor; 300 m = none.
for (const [gapM, want] of [[3000, 'avenue'], [650, 'lone'], [300, 'none']]) {
  const half = Math.round(gapM / RES / 2);
  const c = coding(({ set }) => { for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (Math.abs(y - 150) > half) set(x, y, IPB.NOGO, WHY.BUA); });
  const r = run(c);
  const got = viable(r).length ? 'avenue' : r.aas.length ? 'lone' : 'none';
  check(`a ${gapM} m gap between NO-GO belts: ${want}`, got === want, `${got} · ${r.notes.join('; ') || r.ways[0] || ''}`);
}

// 4 Small obstacles (90 m villages every 900 m) do not shape a 500 m corridor: no narrows.
{
  const c = coding(({ set }) => { for (let x = 20; x < W; x += 30) for (let y = 10; y < H; y += 30) for (let u = 0; u < 3; u++) for (let v = 0; v < 3; v++) set(x + u, y + v, IPB.NOGO, WHY.BUA); });
  const r = run(c);
  check('small NO-GO patches (90 m) are left out: no narrows', viable(r).length >= 1 && r.aas.every((a) => a.narrows.length === 0), `${viable(r).length} avenues`);
}

// 5 A SLOW-GO band across a 1 km gap (between NO-GO belts): a narrows of SLOW-GO.
{
  const c = coding(({ set }) => {
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (Math.abs(y - 150) > 17) set(x, y, IPB.NOGO, WHY.BUA);
    for (let x = 180; x < 200; x++) for (let y = 133; y <= 167; y++) set(x, y, IPB.SLOW, WHY.SLOPE);
  });
  const r = run(c);
  const n = r.aas.flatMap((a) => a.narrows);
  check('a SLOW-GO band across the way is a SLOW-GO narrows', n.some((q) => q.kind === 'slow' && Math.abs(q.x - 190) <= 12), n.map((q) => `${q.kind} ${q.widthM} m @${q.x.toFixed(0)}`).join(', ') || 'none');
}

// 6 Two avenues kept apart by a NO-GO wall along the axis, with an opening: a crossover there.
{
  const c = coding(({ set }) => {
    for (let x = 0; x < W; x++) for (let y = 140; y < 160; y++) if (x < 190 || x > 240) set(x, y, IPB.NOGO, WHY.BUA);
  });
  const r = run(c, { strips: 2 });
  const x = r.crossovers[0];
  check('a wall between two avenues with an opening: a crossover in the opening', viable(r).length === 2 && !!x && x.from[0] >= 185 && x.from[0] <= 245, x ? `${x.id} ${x.a}-${x.b} at x ${x.from[0].toFixed(0)} · depth ${x.depthM} m` : `none · ${viable(r).length} avenues`);
}

// 7 A water line (width not recorded) across the way is crossed, not a narrows.
{
  const c = coding(({ set }) => { for (let y = 0; y < H; y++) set(200, y, IPB.NA, WHY.NA_WATER, 30); });
  const r = run(c);
  const a = viable(r)[0];
  check('a water line across the way is crossed (no narrows) and counted', !!a && a.narrows.length === 0 && a.waterLines === 1, a ? `${a.waterLines} line(s)` : 'no avenue');
}

// 8 The arrow: open back, tip at the end, widest at the back, inner line only for a main attack.
{
  const pts = [[0, 0], [100, 0], [200, 10], [300, 0]];
  const m = attackArrow(pts, 0.05, true), s = attackArrow(pts, 0.05, false);
  const tip = m.stroke.find((p) => p[0] === 300 && p[1] === 0);
  const back = Math.hypot(m.stroke[0][0] - m.stroke[m.stroke.length - 1][0], m.stroke[0][1] - m.stroke[m.stroke.length - 1][1]);
  check('arrow: the stroke leaves the back open and passes the tip', !!tip && back > 10 && m.fill.length === m.stroke.length + 1, `back ${back.toFixed(1)}`);
  check('arrow: inner line for the main attack only', m.inner.length === 3 && s.inner.length === 0);
  // The head keeps its shape on a long arrow (28 km, 1.1 km wide at the back) and a short one (7 km): about as long as
  // it is wide, never a needle (user, 2026-11-14).
  for (const [L, W] of [[28000, 1100], [7000, 1100], [48000, 4500]]) {
    const tail = W / (2 * (L + L / 2.4));
    const a = attackArrow([[0, 0], [L, 0]], tail, true);
    const tipI = a.stroke.findIndex((p) => p[0] === L);
    const hl = a.stroke[tipI - 1], hr = a.stroke[tipI + 1];
    const headLen = L - hl[0], headW = Math.abs(hl[1] - hr[1]);
    const r = headLen / headW;
    check(`arrow ${L / 1000} km x ${W} m: head ${Math.round(headLen)} m long, ${Math.round(headW)} m wide (ratio 0.9-1.6)`, r >= 0.9 && r <= 1.6 && arrowHeadFrac(tail) <= 0.15, `ratio ${r.toFixed(2)} · HEAD_RATIO ${arrowHeadFrac(tail).toFixed(3)}`);
  }
  const simp = simplifyLine([[0, 0], [1, 0.01], [2, 0], [3, 5], [4, 0]], 0.1);
  check('simplify keeps the corner and drops the near-straight point', simp.length === 4);
}

// 9 Cost: a Bde frame (14 x 28 km at 30 m) on synthetic ground.
{
  const BW = 940, BH = 520;
  const code = new Uint8Array(BW * BH).fill(IPB.GO), why = new Uint16Array(BW * BH), waterW = new Uint16Array(BW * BH);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 160; k++) { const x0 = Math.floor(rnd() * BW), y0 = Math.floor(rnd() * BH), r = 4 + Math.floor(rnd() * 12); for (let y = y0 - r; y <= y0 + r; y++) for (let x = x0 - r; x <= x0 + r; x++) if (x >= 0 && y >= 0 && x < BW && y < BH) code[y * BW + x] = IPB.NOGO; }
  const c = { x0: 0, y0: 0, w: BW, h: BH, res: 30, code, why, waterW };
  const t = performance.now();
  const r = findCorridors({ coding: c, frame: { sx: 10, sy: BH / 2, axisDeg: 90, lengthM: 920 * 30, widthM: 14000 }, mcWidthM: 500, spacingM: 2000, sectorDeg: 90 });
  const ms = performance.now() - t;
  check('a Bde frame (14 x 28 km) in under 800 ms', ms < 800 && r.aas.length >= 1, `${ms.toFixed(0)} ms · ${r.aas.length} avenues`);
}

// ------------------------------------------------------------------------------------------------ real frames (bundle)
const bundle = resolve(repo, 'MS/Data/terrain-bundle');
if (!process.argv.includes('--no-real') && existsSync(resolve(bundle, 'manifest.json'))) {
  const decodePng = (buf) => {
    let p = 8, w = 0, h = 0; const idat = [];
    while (p < buf.length) { const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8); if (type === 'IHDR') { w = buf.readUInt32BE(p + 8); h = buf.readUInt32BE(p + 12); } else if (type === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len)); else if (type === 'IEND') break; p += 12 + len; }
    const raw = inflateSync(Buffer.concat(idat)), o = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) { const f = raw[y * (w + 1)], row = y * (w + 1) + 1; for (let x = 0; x < w; x++) { const a = x ? o[y * w + x - 1] : 0, b = y ? o[(y - 1) * w + x] : 0, cc = x && y ? o[(y - 1) * w + x - 1] : 0; let v = raw[row + x]; if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1; else if (f === 4) { const pp = a + b - cc, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - cc); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : cc; } o[y * w + x] = v & 255; } }
    return o;
  };
  const man = JSON.parse(readFileSync(resolve(bundle, 'manifest.json'), 'utf8'));
  const R = ipbRulesFrom(JSON.parse(readFileSync(resolve(repo, 'MS/Data/IpbDoctrine.json'), 'utf8')));
  const Z = man.zoom.max, TS = man.tileSize, nW = TS * 2 ** Z;
  const FR = { bde: { w: 14000, fwd: 18000, rear: 6000, lead: 4000, mc: 500, sp: 2000 }, div: { w: 30000, fwd: 30000, rear: 10000, lead: 8000, mc: 1500, sp: 6000 } };
  for (const site of [{ name: 'Phillora, Bde HQ, threat E', lon: 74.65, lat: 32.43, threat: 90, hq: 'bde' }, { name: 'Demo 2 area, Div HQ, threat E', lon: 73.85, lat: 30.95, threat: 90, hq: 'div' }]) {
    const fr = FR[site.hq];
    const sl = Math.sin(site.lat * Math.PI / 180);
    const ax = ((site.lon + 180) / 360) * nW, ay = (0.5 - Math.log((1 + sl) / (1 - sl)) / (4 * Math.PI)) * nW;
    const res = (40075016.686 / nW) * Math.cos(site.lat * Math.PI / 180);
    const axis = (site.threat + 180) % 360, th = axis * Math.PI / 180, Fx = Math.sin(th), Fy = -Math.cos(th), Rx = Math.cos(th), Ry = Math.sin(th);
    const tb = site.threat * Math.PI / 180, sD = fr.fwd + fr.lead;
    const sx0 = ax + Math.sin(tb) * sD / res, sy0 = ay - Math.cos(tb) * sD / res, L = sD + fr.rear;
    const cs = [[0, -fr.w / 2], [0, fr.w / 2], [L, fr.w / 2], [L, -fr.w / 2]].map(([a, q]) => [sx0 + (a * Fx + q * Rx) / res, sy0 + (a * Fy + q * Ry) / res]);
    const pad = (fr.mc + 1200) / res + 4;
    const bx0 = Math.min(...cs.map((p) => p[0])) - pad, bx1 = Math.max(...cs.map((p) => p[0])) + pad, by0 = Math.min(...cs.map((p) => p[1])) - pad, by1 = Math.max(...cs.map((p) => p[1])) + pad;
    const tx0 = Math.floor(bx0 / TS), tx1 = Math.floor(bx1 / TS), ty0 = Math.floor(by0 / TS), ty1 = Math.floor(by1 / TS);
    const gw = (tx1 - tx0 + 1) * TS, gh = (ty1 - ty0 + 1) * TS;
    const lay = (layer, fill) => { const o = new Uint8Array(gw * gh).fill(fill); for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) { const f = `${bundle}/${layer}/${Z}/${tx}/${ty}.png`; if (!existsSync(f)) continue; const t = decodePng(readFileSync(f)); for (let r = 0; r < TS; r++) o.set(t.subarray(r * TS, r * TS + TS), ((ty - ty0) * TS + r) * gw + (tx - tx0) * TS); } return o; };
    const cls = lay(man.layers.class, 255), hi = lay(man.layers.elev_hi, 255), lo = lay(man.layers.elev_lo, 0);
    const elev = new Float32Array(gw * gh);
    for (let i = 0; i < elev.length; i++) elev[i] = hi[i] === 255 ? NaN : hi[i] * 256 + lo[i] - 500;
    const px0 = tx0 * TS, py0 = ty0 * TS;
    const t = performance.now();
    const c = codeIpb({ grid: { w: gw, h: gh, res, cls, elev }, rules: R, mover: 'armour', moveDeg: axis, month: 11, lonLat: [site.lon, site.lat], avlbSpanM: 18, season: 'coding', box: [Math.floor(bx0 - px0), Math.floor(by0 - py0), Math.ceil(bx1 - px0), Math.ceil(by1 - py0)] });
    const r = findCorridors({ coding: c, frame: { sx: sx0 - px0 - c.x0, sy: sy0 - py0 - c.y0, axisDeg: axis, lengthM: L, widthM: fr.w }, mcWidthM: fr.mc, spacingM: fr.sp, sectorDeg: 90 });
    const ms = performance.now() - t;
    const v = r.aas.filter((a) => a.viable);
    check(`real ${site.name}: avenues found, coded + read in under 2 s`, v.length >= 1 && ms < 2000, `${Math.round(ms)} ms (coding ${Math.round(c.ms)}, corridors ${Math.round(r.ms)}) · ${v.map((a) => `${a.id} ${a.goPct.toFixed(0)} % GO, ${a.narrows.length} narrows`).join('; ')}`);
  }
} else console.log('SKIP  real frames (no terrain bundle or --no-real)');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
