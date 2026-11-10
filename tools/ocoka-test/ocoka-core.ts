/**
 * ocoka-core.ts  --  the test program's door to the OCOKA engine.
 *
 * The engine itself now lives in the library: MS/Engines/GroundGuide/GroundGuideOcoka.ts (pure, no imports), and is
 * re-exported here unchanged, so `run.mjs` and the page test the very code the Ground Guide runs. This file only adds
 * what a test needs: an async tile loader (Node reads PNG files, the page fetches them) and the going table from
 * rules.json.
 */
export * from '../../MS/Engines/GroundGuide/GroundGuideOcoka.ts';
import { buildGrid, lonLatToPx, mPerPx, type Going, type OcokaGrid, type OcokaLayers } from '../../MS/Engines/GroundGuide/GroundGuideOcoka.ts';

export const Z = 12;
export const TS = 256;
export const LAYERS: OcokaLayers = { cls: 'class', elevHi: 'elev_hi', elevLo: 'elev_lo', bld: 'bld' };

/** Returns the 256 x 256 bytes of one z12 tile, or null when the bundle has none there. */
export type TileSource = (layer: string, x: number, y: number) => Promise<Uint8Array | null>;

/** Fetch the tiles a circle needs, then lay them out with the engine's own `buildGrid`. */
export async function loadGrid(src: TileSource, lon: number, lat: number, radiusM: number, layers: OcokaLayers = LAYERS): Promise<OcokaGrid> {
  const [cx, cy] = lonLatToPx(lon, lat, Z, TS);
  const rp = radiusM / mPerPx(lat, Z, TS) + 2;
  const got = new Map<string, Uint8Array | null>();
  const jobs: Promise<void>[] = [];
  for (const layer of [layers.cls, layers.elevHi, layers.elevLo, layers.bld])
    if (layer)
      for (let ty = Math.floor((cy - rp) / TS); ty <= Math.floor((cy + rp) / TS); ty++)
        for (let tx = Math.floor((cx - rp) / TS); tx <= Math.floor((cx + rp) / TS); tx++)
          jobs.push(src(layer, tx, ty).then((t) => void got.set(`${layer}/${tx}/${ty}`, t)));
  await Promise.all(jobs);
  return buildGrid((layer, x, y) => got.get(`${layer}/${x}/${y}`) ?? null, layers, Z, TS, lat, cx, cy, rp);
}

/** Position of a lon / lat inside a grid, in pixels. */
export function gridXY(g: OcokaGrid, lon: number, lat: number): [number, number] {
  const [x, y] = lonLatToPx(lon, lat, g.z, g.ts);
  return [x - g.px0, y - g.py0];
}

/** A mover's NO-GO and SLOW-GO classes from its profile in rules.json. */
export function goingTable(rules: any, profile: string): Going {
  const p = rules.profiles[profile];
  const nogo = new Uint8Array(256);
  const caution = new Uint8Array(256);
  for (const c of p?.nogo ?? []) nogo[c] = 1;
  for (const c of p?.caution ?? []) caution[c] = 1;
  return { nogo, caution };
}
