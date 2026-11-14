// shapes.mjs -- checks for the IPB coding as outlines (GroundGuideIpbShapes.ts), the input of Create on Map.
//   node tools/ipb-test/shapes.mjs
// Synthetic codings drawn by hand: every answer has a known shape. Exit code 1 when a check fails.
import { register } from 'node:module';
register('../movement-test/hooks.mjs', import.meta.url);
const { ipbAreas, simplifyRing } = await import('../../MS/Engines/GroundGuide/GroundGuideIpbShapes.ts');
const { IPB, WHY } = await import('../../MS/Engines/GroundGuide/GroundGuideIpb.ts');

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  · ' + detail : ''}`);
}
const W = 200, H = 160, RES = 30;
function coding(paint) {
  const code = new Uint8Array(W * H).fill(IPB.GO), why = new Uint16Array(W * H);
  paint((x, y, k = IPB.NOGO, w = WHY.BUA) => { if (x >= 0 && y >= 0 && x < W && y < H) { code[y * W + x] = k; why[y * W + x] = w; } });
  return { x0: 0, y0: 0, w: W, h: H, res: RES, code, why, waterW: new Uint16Array(W * H) };
}
const rect = (set, x0, y0, x1, y1, k, w) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, k, w); };
const inside = (ring, x, y) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const MIN = 250 * 250;

{
  const r = ipbAreas(coding((set) => rect(set, 40, 40, 60, 60)), { cls: 'nogo', minAreaM2: MIN });
  check('a 600 m square is one area with 4 corners', r.length === 1 && r[0].ring.length === 4 && r[0].areaM2 === 400 * 900, r.map((a) => `${a.ring.length} corners, ${a.areaM2} m²`).join('; '));
  check('the outline follows the cell edges', r[0] && r[0].ring.every(([x, y]) => (x === 40 || x === 60) && (y === 40 || y === 60)), JSON.stringify(r[0]?.ring));
}
{
  const r = ipbAreas(coding((set) => { rect(set, 40, 40, 60, 60); rect(set, 60, 60, 80, 80); }), { cls: 'nogo', minAreaM2: MIN });
  check('two squares touching at a corner are one area', r.length === 1 && r[0].areaM2 === 800 * 900, `${r.length} areas`);
}
{
  const r = ipbAreas(coding((set) => { rect(set, 40, 40, 80, 80); rect(set, 50, 50, 70, 70, IPB.GO, 0); }), { cls: 'nogo', minAreaM2: MIN });
  check('a ring of NO-GO round GO: the outer edge only', r.length === 1 && r[0].ring.length === 4 && r[0].ring.every(([x, y]) => (x === 40 || x === 80) && (y === 40 || y === 80)), r.map((a) => a.ring.length).join(','));
}
{
  const r = ipbAreas(coding((set) => rect(set, 40, 40, 43, 43)), { cls: 'nogo', minAreaM2: MIN });
  check('a 90 m patch is too small for the level read', r.length === 0);
}
{
  const r = ipbAreas(coding((set) => { rect(set, 40, 40, 60, 60); rect(set, 61, 40, 80, 60); }), { cls: 'nogo', minAreaM2: MIN });
  check('patches a cell apart are joined', r.length === 1 && r[0].areaM2 >= 780 * 900, `${r.length} areas, ${r[0]?.areaM2} m²`);
}
{
  const r = ipbAreas(coding((set) => { rect(set, 40, 40, 80, 60, IPB.SLOW, WHY.SLOPE); rect(set, 58, 40, 62, 60, IPB.SLOW, WHY.CROSSING); }), { cls: 'slow', minAreaM2: MIN });
  check('a bridge is not part of a SLOW-GO area', r.length === 2, `${r.length} areas`);
}
{
  // A NO-GO band across the middle; frame: x 20..180 moving east, 3 km wide (100 cells) round y = 80.
  const c = coding((set) => rect(set, 90, 0, 110, H));
  const frame = { sx: 20, sy: 80, axisDeg: 90, lengthM: 160 * RES, widthM: 100 * RES };
  const r = ipbAreas(c, { cls: 'nogo', minAreaM2: MIN, frame });
  const ys = r.flatMap((a) => a.ring.map((p) => p[1]));
  check('cut to the frame (the area read)', r.length === 1 && Math.min(...ys) >= 29 && Math.max(...ys) <= 131, `y ${Math.min(...ys)}..${Math.max(...ys)}`);
}
{
  const R = 30;
  const c = coding((set) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - 100) ** 2 + (y - 80) ** 2 <= R * R) set(x, y); });
  const r = ipbAreas(c, { cls: 'nogo', minAreaM2: MIN, maxVerts: 40 });
  const a = r[0];
  const want = Math.PI * R * R * 900;
  check('a round lake: at most 40 corners, area about πr², centre inside', !!a && a.ring.length <= 40 && Math.abs(a.areaM2 - want) / want < 0.03 && inside(a.ring, 100, 80), a ? `${a.ring.length} corners · ${(a.areaM2 / 1e6).toFixed(2)} km² (πr² ${(want / 1e6).toFixed(2)})` : 'none');
}
{
  const ring = [[0, 0], [5, 0.01], [10, 0], [10, 10], [5, 10.02], [0, 10]];
  const s = simplifyRing(ring, 0.1);
  check('a closed ring simplifies to its 4 corners', s.length === 4, JSON.stringify(s));
}
{
  const t = performance.now();
  const c = coding((set) => { for (let k = 0; k < 60; k++) rect(set, (k * 37) % 190, (k * 53) % 150, ((k * 37) % 190) + 6 + (k % 7), ((k * 53) % 150) + 5 + (k % 5)); });
  const r = ipbAreas(c, { cls: 'nogo', minAreaM2: 1 });
  const ms = performance.now() - t;
  check('60 patches traced in under 300 ms, every ring closed sensibly', r.length > 20 && r.every((a) => a.ring.length >= 3) && ms < 300, `${r.length} areas · ${ms.toFixed(0)} ms`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
