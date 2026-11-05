/**
 * GroundGuidePopulationLayer.ts
 *
 * The People map layer of the Ground Guide (B in GROTBC): every ~1 km cell of the bundle's population grid
 * coloured by its density class (GroundGuidePopulation.POPULATION_CLASSES), so a planner sees where people live
 * before placing anything. An ArcGIS BaseTileLayer painted on the main thread straight from the grid already in
 * memory (nearest cell, crisp at every zoom); 2D and 3D (draped). Cells with nobody are left clear.
 */

import BaseTileLayer from '@arcgis/core/layers/BaseTileLayer';
import { POPULATION_CLASSES, type GroundGuidePopulation } from './GroundGuidePopulation';

const TILE = 256;
const EARTH_R = 6378137;

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function createPopulationLayer(pop: GroundGuidePopulation, opacity: number): any {
  const colors = POPULATION_CLASSES.map((c) => ({ min: c.min, rgb: rgb(c.color) }));
  const colorOf = (v: number) => {
    let c = colors[0];
    for (const x of colors) if (v >= x.min) c = x;
    return c.rgb;
  };

  function render(level: number, row: number, col: number): ImageData {
    const img = new ImageData(TILE, TILE);
    const h = pop.header;
    if (!h || !pop.ready) return img;
    const world = 2 * Math.PI * EARTH_R;
    const size = world / 2 ** level;
    const x0 = -Math.PI * EARTH_R + col * size;
    const y0 = Math.PI * EARTH_R - row * size;
    const [w, , , n] = h.bounds;
    // Rows and columns are separable in Web Mercator: one grid row per pixel row, one grid column per pixel column.
    const gc = new Int32Array(TILE);
    for (let px = 0; px < TILE; px++) {
      const lng = ((x0 + ((px + 0.5) / TILE) * size) / EARTH_R) * (180 / Math.PI);
      gc[px] = Math.floor((lng - w) / h.cell);
    }
    const d = img.data;
    let lastKey = -1;
    let lastRgb: [number, number, number] | null = null;
    for (let py = 0; py < TILE; py++) {
      const y = y0 - ((py + 0.5) / TILE) * size;
      const lat = (2 * Math.atan(Math.exp(y / EARTH_R)) - Math.PI / 2) * (180 / Math.PI);
      const gr = Math.floor((n - lat) / h.cell);
      if (gr < 0 || gr >= h.rows) continue;
      for (let px = 0; px < TILE; px++) {
        const c = gc[px];
        if (c < 0 || c >= h.cols) continue;
        const key = gr * h.cols + c;
        if (key !== lastKey) {
          lastKey = key;
          const v = pop.cellDensity(gr, c);
          lastRgb = v === null || v < 1 ? null : colorOf(v);
        }
        if (!lastRgb) continue;
        const o = (py * TILE + px) * 4;
        d[o] = lastRgb[0];
        d[o + 1] = lastRgb[1];
        d[o + 2] = lastRgb[2];
        d[o + 3] = 235;
      }
    }
    return img;
  }

  const Layer = (BaseTileLayer as any).createSubclass({
    fetchTile(level: number, row: number, col: number) {
      return Promise.resolve(render(level, row, col));
    },
  });
  return new Layer({
    id: 'ms-ground-guide-population',
    title: 'People (Ground Guide, WorldPop estimate)',
    opacity,
    listMode: 'hide',
  });
}
