/**
 * PlacementOverlayPaint.ts
 *
 * Pure pixel painter for the Placement overlay: class (+ distance) tile bytes in,
 * RGBA bytes out. No DOM and no ArcGIS imports, so the same code runs inside the
 * tile worker (TerrainTileWorker.ts) and as the main-thread fallback
 * (PlacementOverlay.ts).
 */

export const NODATA = 255;

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
}

/**
 * Paint one overlay tile. `ct` is the class tile, `dt` the distance tile (or null
 * when the bundle has none for this profile). Returns tileSize² × 4 RGBA bytes.
 */
export function paintOverlayTile(ct: Uint8Array, dt: Uint8Array | null, p: OverlayPaintParams): Uint8ClampedArray {
  const ts = p.tileSize;
  const out = new Uint8ClampedArray(ts * ts * 4);
  const { dz, offX, offY, nogo, caution, nearM, scale } = p;
  const K = OVERLAY_COLORS;
  for (let oy = 0; oy < ts; oy++) {
    const sy = dz ? (offY + oy) >> dz : oy;
    for (let ox = 0; ox < ts; ox++) {
      const sx = dz ? (offX + ox) >> dz : ox;
      const si = sy * ts + sx;
      const c = ct[si];
      if (c === NODATA) continue;
      let col: readonly number[];
      if (nogo[c]) col = K.nogo;
      else if (caution[c]) col = K.caution;
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
