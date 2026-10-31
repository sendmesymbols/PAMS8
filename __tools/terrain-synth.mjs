#!/usr/bin/env node
/**
 * terrain-synth.mjs — writes a small SYNTHETIC terrain bundle for developing
 * and testing the Placement Advisor without real data.
 *
 *   node tools/terrain-synth.mjs [outDir] [--zmin 8] [--zmax 12]
 *
 * Default output: public/terrain-bundle/ (served by Vite at /terrain-bundle).
 * Format: MS/Docs/15-placement-advisor.md. Dependency-free (Node zlib only).
 *
 * The area is a 1.2° x 1.0° box around the harness default view (Pakistan,
 * 69.35E 30.38N region) holding analytic shapes — a river, a lake, marsh,
 * a city, a snow cap with a steep ring, and a restricted rectangle — so every
 * verdict (ok / near / caution / partial / in) can be reproduced by hand.
 * Only the finest level is analytic; coarser levels are reduced from it the same
 * way the real pipeline does (class = top-left pixel, distance = MIN), so this
 * bundle also passes tools/terrain-pipeline/scripts/validate.py.
 *
 * THIS DATA IS FAKE. Never ship it; the manifest carries `synthetic: true`.
 */
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
const OUT = resolve(positional[0] ?? 'public/terrain-bundle');
const ZMIN = flag('zmin', 8);
const ZMAX = flag('zmax', 12);
const TS = 256;
const DIST_SCALE_M = 10;
const DIST_CAP = 254;

// ── Area of interest (WGS84) ───────────────────────────────────────────────
const BOUNDS = [68.75, 29.85, 69.95, 30.85]; // west, south, east, north
const CENTER = [69.35, 30.35];

// ── Geometry helpers (local equirectangular metres around CENTER) ──────────
const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON = 111_320 * Math.cos((CENTER[1] * Math.PI) / 180);
const toLocal = (lon, lat) => [(lon - CENTER[0]) * M_PER_DEG_LON, (lat - CENTER[1]) * M_PER_DEG_LAT];

const ORIGIN = 20037508.342789244;
const mercToLonLat = (x, y) => [
  (x / ORIGIN) * 180,
  (Math.atan(Math.exp((y / ORIGIN) * Math.PI)) * 360) / Math.PI - 90,
];
const res = (z) => (2 * ORIGIN) / (TS * 2 ** z);

// ── Shapes: each yields a signed distance (metres, <0 inside) ──────────────
const circle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;
const rect = (x0, y0, x1, y1) => (x, y) => {
  const dx = Math.max(x0 - x, 0, x - x1);
  const dy = Math.max(y0 - y, 0, y - y1);
  const out = Math.hypot(dx, dy);
  if (out > 0) return out;
  return -Math.min(x - x0, x1 - x, y - y0, y1 - y); // inside → negative
};
// River: sinusoidal centre-line running west→east, half-width 150 m.
const riverCentre = (x) => 4000 * Math.sin(x / 14000);
const river = (x, y) => Math.abs(y - riverCentre(x)) * Math.cos(Math.atan((4000 / 14000) * Math.cos(x / 14000))) - 150;

const SHAPES = {
  // class code → signed-distance function
  water_lake: circle(-18000, -14000, 3200), // 4
  river, // 4
  marsh_a: circle(8000, 11000, 2600), // 6
  marsh_b: circle(14000, -9000, 1800), // 6
  city: circle(-6000, 15000, 4200), // 3
  snow: circle(26000, 20000, 3000), // 8
  steep_ring: (x, y) => Math.abs(Math.hypot(x - 26000, y - 20000) - 7000) - 2200, // 9
  restricted: rect(-26000, 2000, -20000, 9000), // 11
  moderate: (x, y) => Math.abs(Math.hypot(x - 26000, y - 20000) - 12500) - 2500, // 10
  trees: circle(2000, -22000, 5000), // 1
  crops: rect(-8000, -26000, 4000, -16000), // 2
};

// class code, shape, no-go for which profiles — mirrors rules.json below.
const CLASS_ORDER = [
  // [code, shape] in precedence order (first hit wins)
  [4, SHAPES.water_lake],
  [4, SHAPES.river],
  [6, SHAPES.marsh_a],
  [6, SHAPES.marsh_b],
  [3, SHAPES.city],
  [11, SHAPES.restricted],
  [8, SHAPES.snow],
  [9, SHAPES.steep_ring],
  [10, SHAPES.moderate],
  [1, SHAPES.trees],
  [2, SHAPES.crops],
];
const BASE_CLASS = 12; // bare / desert

const RULES = {
  version: 'synthetic-1',
  classes: {
    0: { name: 'open_land', label: 'Open land' },
    1: { name: 'tree_cover', label: 'Tree cover' },
    2: { name: 'cropland', label: 'Cropland' },
    3: { name: 'built_up', label: 'Built-up area' },
    4: { name: 'water_permanent', label: 'Permanent water' },
    5: { name: 'water_seasonal', label: 'Seasonal water / flood zone' },
    6: { name: 'wetland', label: 'Wetland / marsh' },
    7: { name: 'mangrove', label: 'Mangrove' },
    8: { name: 'snow_ice', label: 'Snow / ice / glacier' },
    9: { name: 'steep_slope', label: 'Steep slope (>30°)' },
    10: { name: 'moderate_slope', label: 'Moderate slope (15–30°)' },
    11: { name: 'restricted', label: 'Restricted / protected area' },
    12: { name: 'bare_desert', label: 'Bare / desert' },
    255: { name: 'nodata', label: 'No data' },
  },
  profiles: {
    dismounted: { label: 'Dismounted', nogo: [4, 8, 11], caution: [5, 6, 7, 9] },
    wheeled: { label: 'Wheeled vehicles', nogo: [4, 5, 6, 7, 8, 9, 11], caution: [1, 3, 10] },
    tracked: { label: 'Tracked vehicles', nogo: [4, 6, 7, 8, 9, 11], caution: [3, 5, 10] },
    vessel: { label: 'Surface vessel', requires: [4], caution: [5] },
    generic: { label: 'Generic land', nogo: [4], caution: [6, 7] },
    exempt: { label: 'Not terrain-bound' },
  },
};
const PROFILES = ['dismounted', 'wheeled', 'tracked', 'vessel', 'generic'];

function classAt(x, y) {
  for (const [code, sd] of CLASS_ORDER) if (sd(x, y) <= 0) return code;
  return BASE_CLASS;
}

const PROFILE_SETS = Object.fromEntries(
  PROFILES.map((p) => {
    const r = RULES.profiles[p];
    return [p, { nogo: r.requires ? null : new Set(r.nogo), requires: r.requires ? new Set(r.requires) : null }];
  }),
);

/** Is class `cls` no-go for `profile`? (`requires` profiles: everything outside the set.) */
function isNoGo(profile, cls) {
  const s = PROFILE_SETS[profile];
  return s.requires ? !s.requires.has(cls) : s.nogo.has(cls);
}

/**
 * Metres from a deployable point to the nearest no-go (caller handles the inside-no-go case).
 * Never overstates: for a union of shapes the distance to the complement is at least the
 * largest depth among the shapes containing the point.
 */
function distNoGo(profile, x, y) {
  const s = PROFILE_SETS[profile];
  if (s.requires) {
    let depth = 0;
    for (const [code, sd] of CLASS_ORDER) if (s.requires.has(code)) depth = Math.max(depth, -sd(x, y));
    return depth;
  }
  let d = Infinity;
  for (const [code, sd] of CLASS_ORDER) if (s.nogo.has(code)) d = Math.min(d, sd(x, y));
  return Math.max(0, d);
}

// ── PNG writer (8-bit greyscale, IHDR/IDAT/IEND only) ──────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
function encodePng(pixels /* Uint8Array TS*TS */) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(TS, 0);
  ihdr.writeUInt32BE(TS, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const raw = Buffer.alloc((TS + 1) * TS);
  for (let y = 0; y < TS; y++) {
    raw[y * (TS + 1)] = 0; // filter: none
    Buffer.from(pixels.buffer, pixels.byteOffset + y * TS, TS).copy(raw, y * (TS + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Tiling ─────────────────────────────────────────────────────────────────
const lonLatToMerc = (lon, lat) => [
  (lon * ORIGIN) / 180,
  (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * (ORIGIN / 180),
];
const [mx0, my0] = lonLatToMerc(BOUNDS[0], BOUNDS[1]);
const [mx1, my1] = lonLatToMerc(BOUNDS[2], BOUNDS[3]);

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let files = 0;
let bytes = 0;
const writeTile = (layer, z, x, y, px) => {
  const dir = join(OUT, layer, String(z), String(x));
  mkdirSync(dir, { recursive: true });
  const png = encodePng(px);
  writeFileSync(join(dir, `${y}.png`), png);
  files++;
  bytes += png.length;
};

// Only the finest level is computed analytically; every coarser level is REDUCED
// from the level below exactly like the real pipeline (tools/terrain-pipeline/
// scripts/tile.py): class = top-left pixel of each 2x2 block (nearest, so codes
// stay valid), distance = MIN (a coarse pixel never claims more clearance than
// any fine pixel under it; 255 nodata only survives when all four are nodata).
const LAYERS = ['class', ...PROFILES.map((p) => `dist_${p}`)];
const tiles = Object.fromEntries(LAYERS.map((l) => [l, new Map()])); // layer → "z/x/y" → Uint8Array
const tkey = (z, x, y) => `${z}/${x}/${y}`;

{
  const z = ZMAX;
  const r = res(z);
  const tx0 = Math.floor((mx0 + ORIGIN) / r / TS);
  const tx1 = Math.floor((mx1 + ORIGIN) / r / TS);
  const ty0 = Math.floor((ORIGIN - my1) / r / TS);
  const ty1 = Math.floor((ORIGIN - my0) / r / TS);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const cls = new Uint8Array(TS * TS);
      const dist = Object.fromEntries(PROFILES.map((p) => [p, new Uint8Array(TS * TS)]));
      let any = false;
      for (let py = 0; py < TS; py++) {
        const my = ORIGIN - (ty * TS + py + 0.5) * r;
        for (let px = 0; px < TS; px++) {
          const mx = (tx * TS + px + 0.5) * r - ORIGIN;
          const [lon, lat] = mercToLonLat(mx, my);
          const i = py * TS + px;
          if (lon < BOUNDS[0] || lon > BOUNDS[2] || lat < BOUNDS[1] || lat > BOUNDS[3]) {
            cls[i] = 255;
            for (const p of PROFILES) dist[p][i] = 255;
            continue;
          }
          any = true;
          const [lx, ly] = toLocal(lon, lat);
          const c = classAt(lx, ly);
          cls[i] = c;
          for (const p of PROFILES) {
            // 0 exactly where the class is no-go; otherwise at least 1 unit.
            dist[p][i] = isNoGo(p, c)
              ? 0
              : Math.min(DIST_CAP, Math.max(1, Math.round(distNoGo(p, lx, ly) / DIST_SCALE_M)));
          }
        }
      }
      if (!any) continue; // fully outside → no file → 404 = no coverage
      tiles.class.set(tkey(z, tx, ty), cls);
      for (const p of PROFILES) tiles[`dist_${p}`].set(tkey(z, tx, ty), dist[p]);
    }
  }
  console.log(`z${z}: ${tiles.class.size} tiles (analytic)`);
}

const H = TS / 2;
for (let z = ZMAX - 1; z >= ZMIN; z--) {
  const parents = new Set();
  for (const k of tiles.class.keys()) {
    const [kz, kx, ky] = k.split('/').map(Number);
    if (kz === z + 1) parents.add(`${kx >> 1}/${ky >> 1}`);
  }
  for (const pk of parents) {
    const [qx, qy] = pk.split('/').map(Number);
    for (const layer of LAYERS) {
      const out = new Uint8Array(TS * TS).fill(255);
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const child = tiles[layer].get(tkey(z + 1, 2 * qx + dx, 2 * qy + dy));
          if (!child) continue;
          for (let y = 0; y < H; y++) {
            for (let x = 0; x < H; x++) {
              const a = child[2 * y * TS + 2 * x];
              out[(dy * H + y) * TS + dx * H + x] =
                layer === 'class'
                  ? a
                  : Math.min(a, child[2 * y * TS + 2 * x + 1], child[(2 * y + 1) * TS + 2 * x], child[(2 * y + 1) * TS + 2 * x + 1]);
            }
          }
        }
      }
      tiles[layer].set(tkey(z, qx, qy), out);
    }
  }
  console.log(`z${z}: ${parents.size} tiles (reduced from z${z + 1})`);
}

for (const layer of LAYERS) {
  for (const [k, px] of tiles[layer]) {
    const [z, x, y] = k.split('/').map(Number);
    writeTile(layer, z, x, y, px);
  }
}

writeFileSync(
  join(OUT, 'manifest.json'),
  JSON.stringify(
    {
      format: 'pams-terrain-bundle',
      version: 1,
      name: 'SYNTHETIC terrain (dev/test only)',
      synthetic: true,
      crs: 'EPSG:3857',
      tileSize: TS,
      zoom: { min: ZMIN, max: ZMAX },
      bounds: BOUNDS,
      distScaleM: DIST_SCALE_M,
      layers: { class: 'class', dist: 'dist_{profile}' },
      profiles: PROFILES,
      built: new Date().toISOString(),
      pipelineVersion: 'terrain-synth',
      rulesVersion: RULES.version,
      sources: [],
    },
    null,
    2,
  ),
);
writeFileSync(join(OUT, 'rules.json'), JSON.stringify(RULES, null, 2));
writeFileSync(
  join(OUT, 'LICENSES.txt'),
  'SYNTHETIC test data generated by tools/terrain-synth.mjs. Not derived from any real source; not for operational use.\n',
);
// Landmarks for hand-testing (lon, lat) → expected class, printed and saved.
const LANDMARKS = {
  lake_centre: [-18000, -14000],
  river_at_x0: [0, riverCentre(0)],
  marsh_a: [8000, 11000],
  city_centre: [-6000, 15000],
  snow_cap: [26000, 20000],
  restricted: [-23000, 5500],
  open_desert: [-25000, -5000],
};
const landmarks = {};
for (const [k, [x, y]] of Object.entries(LANDMARKS)) {
  landmarks[k] = {
    lon: +(CENTER[0] + x / M_PER_DEG_LON).toFixed(5),
    lat: +(CENTER[1] + y / M_PER_DEG_LAT).toFixed(5),
    class: classAt(x, y),
  };
}
writeFileSync(join(OUT, 'landmarks.json'), JSON.stringify(landmarks, null, 2));
console.log(`\nWrote ${files} tiles (${(bytes / 1024).toFixed(0)} KB) to ${OUT}`);
console.log('Landmarks:', landmarks);
