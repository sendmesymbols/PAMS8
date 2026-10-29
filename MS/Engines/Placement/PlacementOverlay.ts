/**
 * PlacementOverlay.ts
 *
 * Map overlay for the Placement Advisor: paints the terrain bundle for one
 * mobility profile as deployable / near no-go / caution / no-go, so a planner
 * can see where ground is available before placing anything. It is an ArcGIS
 * BaseTileLayer whose tiles are coloured from the same PNG class and distance
 * tiles the advisor reads, so it needs no extra data and works in 2D (MapView)
 * and 3D (SceneView, draped).
 *
 * Fetching, decoding and painting run in the tile worker when the source has
 * one (WorkerTileSource.renderOverlay); otherwise — worker disabled, blocked or
 * dead — the identical painter (PlacementOverlayPaint) runs on the main thread.
 *
 * Levels below the bundle's minimum zoom draw nothing; levels above its
 * maximum are over-zoomed from the finest tile (nearest pixel).
 */

import BaseTileLayer from '@arcgis/core/layers/BaseTileLayer';
import { compileProfile, type CompiledProfile } from './PlacementEvaluator';
import { OVERLAY_COLORS, paintOverlayTile, type OverlayPaintParams } from './PlacementOverlayPaint';
import { layerNames, type PlacementProfile, type TerrainManifest, type TerrainRules } from './PlacementTypes';
import type { TileSource } from './TerrainTileCache';

export { OVERLAY_COLORS };

export const OVERLAY_LEGEND: Array<{ key: keyof typeof OVERLAY_COLORS; label: string }> = [
  { key: 'ok', label: 'Deployable' },
  { key: 'near', label: 'Near no-go' },
  { key: 'caution', label: 'Caution' },
  { key: 'nogo', label: 'No-go' },
];

/** A TileSource that can also paint overlay tiles itself (WorkerTileSource). */
export interface OverlayRenderingSource extends TileSource {
  readonly workerActive?: boolean;
  renderOverlay?: (
    clsLayer: string,
    distLayer: string | null,
    z: number,
    ax: number,
    ay: number,
    params: OverlayPaintParams,
    fallback: () => Promise<Uint8ClampedArray | null>,
  ) => Promise<Uint8ClampedArray | null>;
}

export interface OverlayInputs {
  source: OverlayRenderingSource;
  manifest: TerrainManifest;
  rules: TerrainRules;
  /** Profile to paint right now (never `exempt`). */
  getProfile: () => PlacementProfile;
  /** Deployable ground within this many metres of no-go is painted "near". */
  getNearM: () => number;
}

export function createOverlayLayer(inputs: OverlayInputs, opacity: number): any {
  const ts = inputs.manifest.tileSize;
  const compiled = new Map<PlacementProfile, CompiledProfile>();
  const compile = (p: PlacementProfile): CompiledProfile => {
    let c = compiled.get(p);
    if (!c) compiled.set(p, (c = compileProfile(inputs.rules, p)));
    return c;
  };

  async function render(level: number, row: number, col: number): Promise<ImageData> {
    const m = inputs.manifest;
    const blank = () => new ImageData(ts, ts); // transparent
    if (level < m.zoom.min) return blank();
    const z = Math.min(level, m.zoom.max);
    const dz = level - z;
    if (dz > 8) return blank();

    const profile = inputs.getProfile();
    const cp = compile(profile);
    if (cp.exempt) return blank();
    const names = layerNames(m, profile);
    const ax = col >> dz;
    const ay = row >> dz;
    const mask = (1 << dz) - 1;
    const params: OverlayPaintParams = {
      tileSize: ts,
      nogo: cp.nogo,
      caution: cp.caution,
      nearM: inputs.getNearM(),
      scale: m.distScaleM,
      dz,
      offX: (col & mask) * ts,
      offY: (row & mask) * ts,
    };

    const onMainThread = async (): Promise<Uint8ClampedArray | null> => {
      const [ct, dt] = await Promise.all([
        inputs.source.fetchTile(names.cls, z, ax, ay),
        names.dist ? inputs.source.fetchTile(names.dist, z, ax, ay).catch(() => null) : Promise.resolve(null),
      ]);
      return ct ? paintOverlayTile(ct, dt, params) : null;
    };

    const src = inputs.source;
    const rgba =
      src.renderOverlay && src.workerActive
        ? await src.renderOverlay(names.cls, names.dist, z, ax, ay, params, onMainThread)
        : await onMainThread();
    return rgba ? new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, ts, ts) : blank();
  }

  const Layer = (BaseTileLayer as any).createSubclass({
    fetchTile(level: number, row: number, col: number) {
      return render(level, row, col);
    },
  });
  return new Layer({
    id: 'ms-placement-overlay',
    title: 'Terrain availability (Placement Advisor)',
    opacity,
    listMode: 'hide',
  });
}
