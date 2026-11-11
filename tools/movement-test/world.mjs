// world.mjs -- the synthetic ground both test programs read: a road (2 km east, then 3 km north-east), a canal and an
// embankment beside it at 1.2-1.4 km, trees south of it at 1.0-1.6 km, a 60 m hill 400 m north-west of 3.0 km, a town
// round 4.25 km with a side road through it, a culvert, a junction, a mosque, a hospital, a helipad, a cave.
import * as M from '../../MS/Engines/MovementGuide/MovementGuideScan.ts';
// ── synthetic ground near Islamabad (lat 33.6) ──────────────────────────────────────────────────────────────────────
const O = M.lngLatToMerc(73.0, 33.6);
const s = M.scaleAt(O[1]);
const at = (eM, nM) => [O[0] + eM / s, O[1] + nM / s]; // ground metres east / north of O -> Mercator
// The road: 2 km east, then 3 km north-east (a bend at 2 km).
const bendPt = at(2000, 0);
const endPt = M.offsetPt(bendPt[0], bendPt[1], 45, 3000);
const path = [at(0, 0), bendPt, endPt];
const roadXY = path.flat();
// Along-road position (ground metres) of a point and its signed offset (+ = left / north of the first leg).
function local(x, y) {
  const g = [(x - O[0]) * s, (y - O[1]) * s];
  return { e: g[0], n: g[1] };
}
const hill = at(3000 * 0 + 2000 + 3000 * Math.SQRT1_2 * 0 + 0, 0); // placeholder, replaced below
void hill;
// The hill: 60 m high, 250 m radius, 400 m north-west of km 3.0 (on the second leg, left side).
const km3 = M.offsetPt(bendPt[0], bendPt[1], 45, 1000);
const hillC = M.offsetPt(km3[0], km3[1], 45 - 90, 400);
// The town: km 4.0-4.5 (second leg 2.0-2.5 km), 300 m either side.
const town0 = M.offsetPt(bendPt[0], bendPt[1], 45, 2000);
const townC = M.offsetPt(bendPt[0], bendPt[1], 45, 2250);
// A side road crossing the town, north-west to south-east through its centre.
const sideA = M.offsetPt(townC[0], townC[1], 135, 1200);
const sideB = M.offsetPt(townC[0], townC[1], 315, 1200);
const sideXY = [sideA[0], sideA[1], sideB[0], sideB[1]];
void town0;

function elevAt(x, y) {
  const d = M.groundDist([x, y], hillC);
  return 500 + (d < 250 ? 60 * (1 - (d / 250) ** 2) : 0);
}
function onFirstLeg(x, y) {
  const l = local(x, y);
  return l.e >= -50 && l.e <= 2050 ? l : null;
}
function cls(x, y) {
  const dRoad = M.distToLine([x, y], roadXY);
  if (dRoad <= 10) return 34;
  if (M.distToLine([x, y], sideXY) <= 8) return 34;
  const dTown = M.groundDist([x, y], townC);
  if (dTown <= 300) return 3;
  const l = onFirstLeg(x, y);
  if (l) {
    // Canal on the north side km 1.0-1.5 at 20-35 m; embankment on the south side km 1.2-1.4 at 15-30 m; trees south 80-200 m km 1.0-1.6.
    if (l.e >= 1000 && l.e <= 1500 && l.n >= 12 && l.n <= 35) return 20;
    if (l.e >= 1200 && l.e <= 1400 && l.n <= -12 && l.n >= -30) return 24;
    if (l.e >= 1000 && l.e <= 1600 && l.n <= -80 && l.n >= -200) return 1;
  }
  return 2; // cropland
}
function bld(x, y) {
  return M.groundDist([x, y], townC) <= 300 ? 5 | (2 << 3) | (2 << 6) : 0;
}
function sight(ox, oy, eyeM, tx, ty, targetM) {
  const d = M.groundDist([ox, oy], [tx, ty]);
  const n = Math.max(2, Math.ceil(d / 30));
  const e0 = elevAt(ox, oy) + eyeM;
  const e1 = elevAt(tx, ty) + targetM;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const ex = elevAt(ox + (tx - ox) * t, oy + (ty - oy) * t);
    if (ex > e0 + (e1 - e0) * t) return 0;
  }
  return 1;
}
const FEATURES = [
  { kind: 'culvert', label: 'Culvert', name: null, p: at(500, 0) },
  { kind: 'main_junction', label: 'Junction of main roads', name: null, p: bendPt },
  { kind: 'mosque', label: 'Mosque', name: 'Jamia', p: M.offsetPt(bendPt[0], bendPt[1], 45, 500).map((v, i) => v + (i ? 40 / s : 0)) },
  { kind: 'town', label: 'Town', name: 'Testabad', p: townC },
  { kind: 'hospital', label: 'Hospital', name: 'DHQ', p: at(-3000, 1000) },
  { kind: 'helipad', label: 'Helipad', name: null, p: at(-1000, -2000) },
  { kind: 'cave', label: 'Cave', name: null, p: M.offsetPt(townC[0], townC[1], 200, 1500) },
  { kind: 'hill', label: 'Hill', name: 'Test Hill', p: hillC },
];
const probe = {
  resM: 30,
  cls,
  elev: elevAt,
  bld,
  sight,
  features(x, y, r, kinds) {
    return FEATURES.filter((f) => kinds.has(f.kind))
      .map((f) => ({ kind: f.kind, label: f.label, name: f.name, x: f.p[0], y: f.p[1], distM: M.groundDist([x, y], f.p), attrs: {} }))
      .filter((f) => f.distM <= r);
  },
  roads(x, y, r) {
    const out = [];
    if (M.distToLine([x, y], roadXY) <= r) out.push({ distM: 0, x, y, attrs: { n: 'Test Rd', aw: true } });
    if (M.groundDist([x, y], bendPt) <= r) out.push({ distM: 0, x, y, attrs: { n: 'Cross Rd', aw: true } });
    return out;
  },
  lines(x, y, r, kinds) {
    if (!kinds.has('road')) return [];
    return [{ kind: 'road', xy: roadXY, attrs: {} }, { kind: 'road', xy: sideXY, attrs: {} }];
  },
  people(x, y) {
    return M.groundDist([x, y], townC) <= 300 ? 8000 : 60;
  },
};
const wheeled = { nogo: new Set([4, 5, 6, 9, 20, 21, 22, 24, 27, 28, 31, 49]), caution: new Set([1, 3, 23, 25, 26, 30]) };
const foot = { nogo: new Set([4, 6, 9, 20, 27]), caution: new Set([21, 22]) };


export { O, s, at, path, roadXY, bendPt, endPt, km3, hillC, townC, sideXY, elevAt, cls, bld, sight, FEATURES, probe, wheeled, foot };
