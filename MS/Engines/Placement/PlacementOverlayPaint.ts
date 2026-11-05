/**
 * PlacementOverlayPaint.ts
 *
 * Pure pixel painter for the Placement overlay: class (+ distance) tile bytes in,
 * RGBA bytes out. No DOM and no ArcGIS imports, so the same code runs inside the
 * tile worker (TerrainTileWorker.ts) and as the main-thread fallback
 * (PlacementOverlay.ts).
 */

import { decodeRci, soilStep, wetStep, type VehicleRule } from './PlacementGoing';
import type { GoingSeason } from './PlacementTypes';

export const NODATA = 255;

/**
 * Paint the going for a season (T: `placement.traffic.overlay`) instead of the ground classes alone: the class
 * step, made worse by the soil (`soil` tile: the season's cone index under `cone`, or the soil texture looked up
 * in `bearingMin` under `bearing`) and, after rain, by the wet layer, as PlacementGoing judges a pixel.
 */
export interface OverlayGoingParams {
  season: GoingSeason;
  rule: 'cone' | 'bearing' | 'words';
  /** The mode's soil thresholds; null when the mode is not judged on soil. */
  veh: VehicleRule | null;
  /** `bearing`: least step (0 GO, 1 SLOW-GO, 2 NO-GO) per soil byte. */
  bearingMin?: Uint8Array;
}

/** RGBA per overlay state; layer opacity scales these further. */
export const OVERLAY_COLORS = {
  nogo: [214, 48, 49, 200],
  caution: [243, 156, 18, 170],
  near: [241, 214, 70, 150],
  ok: [46, 160, 90, 105],
} as const;

export interface OverlayPaintParams {
  tileSize: number;
  /** 256 flags each: 1 = no-go / caution for the painted profile. */
  nogo: Uint8Array;
  caution: Uint8Array;
  /** Deployable ground within this many metres of no-go is painted "near". */
  nearM: number;
  /** Metres per distance-layer unit. */
  scale: number;
  /** Levels above the bundle's finest: the tile is a sub-region of an ancestor, over-zoomed. */
  dz: number;
  /** Position of the requested tile inside the ancestor, in ancestor pixels. */
  offX: number;
  offY: number;
  /** Set to paint the going for a season; the soil and wet tiles come in beside the class tile. */
  going?: OverlayGoingParams;
}

const STEP_OF: Record<string, number> = { go: 0, slow: 1, nogo: 2 };

/**
 * Paint one overlay tile. `ct` is the class tile, `dt` the distance tile (or null
 * when the bundle has none for this profile). With `p.going`, `st` is the soil tile
 * for its rule (cone index or texture) and `wt` the wet layer, either may be null.
 * Returns tileSize² × 4 RGBA bytes.
 */
export function paintOverlayTile(
  ct: Uint8Array,
  dt: Uint8Array | null,
  p: OverlayPaintParams,
  st: Uint8Array | null = null,
  wt: Uint8Array | null = null,
): Uint8ClampedArray {
  const ts = p.tileSize;
  const out = new Uint8ClampedArray(ts * ts * 4);
  const { dz, offX, offY, nogo, caution, nearM, scale } = p;
  const K = OVERLAY_COLORS;
  const g = p.going;
  /** Extra steps from the soil and wet ground at one pixel (0 when there is no going to paint). */
  const soilWet = (si: number): number => {
    if (!g) return 0;
    let s = 0;
    if (st && g.rule !== 'words') {
      const b = st[si];
      if (g.rule === 'bearing') s = g.bearingMin && b !== NODATA ? g.bearingMin[b] : 0;
      else if (g.veh) {
        const r = decodeRci(b);
        if (r) s = STEP_OF[soilStep(r.ci, r.coarse, g.veh)];
      }
    }
    if (g.season === 'wet' && wt) s = Math.max(s, STEP_OF[wetStep(wt[si] === NODATA ? null : wt[si], g.veh)]);
    return s;
  };
  for (let oy = 0; oy < ts; oy++) {
    const sy = dz ? (offY + oy) >> dz : oy;
    for (let ox = 0; ox < ts; ox++) {
      const sx = dz ? (offX + ox) >> dz : ox;
      const si = sy * ts + sx;
      const c = ct[si];
      if (c === NODATA) continue;
      let col: readonly number[];
      const extra = nogo[c] ? 0 : soilWet(si);
      if (nogo[c] || extra === 2) col = K.nogo;
      else if (caution[c] || extra === 1) col = K.caution;
      else {
        const dv = dt ? dt[si] : NODATA;
        col = dv !== NODATA && dv * scale < nearM ? K.near : K.ok;
      }
      const o = (oy * ts + ox) * 4;
      out[o] = col[0];
      out[o + 1] = col[1];
      out[o + 2] = col[2];
      out[o + 3] = col[3];
    }
  }
  return out;
}
