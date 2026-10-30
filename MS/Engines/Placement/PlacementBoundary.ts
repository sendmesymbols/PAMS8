/**
 * PlacementBoundary.ts
 *
 * Optional map layer that draws the country boundary shipped inside the terrain bundle
 * (`boundary.geojson`, written by tools/terrain-pipeline/scripts/make_boundary.py):
 * the national outline, the provinces, the Line of Control and the international borders.
 *
 * For the official bundle this is the Survey of Pakistan's depiction, with the whole of
 * Jammu & Kashmir on Pakistan's side and the Line of Control shown as a line. The engine only
 * draws what the bundle contains; it adds no geometry of its own.
 *
 * Lines only (no fills), so it never hides the terrain overlay or the symbols under it.
 */

import Graphic from '@arcgis/core/Graphic';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';

const LAYER_ID = 'ms-placement-boundary';

type Style = { color: [number, number, number, number]; width: number; style: 'solid' | 'dash' };
const STYLES: Record<string, Style> = {
  outline: { color: [0, 110, 40, 1], width: 2.5, style: 'solid' },
  province: { color: [90, 90, 90, 0.7], width: 1, style: 'solid' },
  loc: { color: [220, 30, 30, 1], width: 2, style: 'dash' },
  border: { color: [20, 20, 20, 0.9], width: 1.5, style: 'solid' },
};

/** Every path of a GeoJSON geometry; polygon rings are drawn as closed lines. */
function pathsOf(g: any): number[][][] {
  if (!g) return [];
  switch (g.type) {
    case 'LineString':
      return [g.coordinates];
    case 'MultiLineString':
      return g.coordinates;
    case 'Polygon':
      return g.coordinates;
    case 'MultiPolygon':
      return g.coordinates.flat();
    default:
      return [];
  }
}

export class PlacementBoundary {
  private _layer: GraphicsLayer | null = null;
  private _map: any = null;
  private _loadedUrl: string | null = null;
  private _loading: Promise<boolean> | null = null;

  constructor(private readonly _getView: () => any) {}

  /** Fetch + build the graphics once per URL. Resolves false when the file cannot be read. */
  async load(url: string): Promise<boolean> {
    if (this._loadedUrl === url) return true;
    if (this._loading) return this._loading;
    this._loading = (async () => {
      try {
        const resp = await fetch(url, { cache: 'no-cache' });
        if (!resp.ok) return false;
        const fc = await resp.json();
        const graphics: Graphic[] = [];
        for (const f of fc.features ?? []) {
          const st = STYLES[f.properties?.kind];
          if (!st) continue;
          const paths = pathsOf(f.geometry).filter((p) => p.length > 1);
          if (paths.length === 0) continue;
          graphics.push(
            new Graphic({
              geometry: { type: 'polyline', paths, spatialReference: { wkid: 4326 } } as any,
              symbol: { type: 'simple-line', color: st.color, width: st.width, style: st.style } as any,
              attributes: { kind: f.properties.kind, name: f.properties.name ?? '' },
            }),
          );
        }
        this._layer?.destroy();
        this._layer = new GraphicsLayer({
          id: LAYER_ID,
          title: 'Official boundary',
          listMode: 'hide',
          elevationInfo: { mode: 'on-the-ground' },
        });
        this._layer.addMany(graphics);
        this._loadedUrl = url;
        return true;
      } catch {
        return false;
      } finally {
        this._loading = null;
      }
    })();
    return this._loading;
  }

  /** Put the layer on the current view's map (call after load()). */
  show(): void {
    const map = this._getView?.()?.map;
    if (!map || !this._layer) return;
    if (this._map !== map) {
      this._detach();
      map.add(this._layer); // appended last: thin lines above the overlay and symbols
      this._map = map;
    }
    this._layer.visible = true;
  }

  hide(): void {
    if (this._layer) this._layer.visible = false;
  }

  /** The view changed: leave the old map; the next show() attaches to the new one. */
  onViewChanged(): void {
    this._detach();
  }

  /** Forget the loaded file (the bundle changed) and remove the layer. */
  reset(): void {
    this._detach();
    this._layer?.destroy();
    this._layer = null;
    this._loadedUrl = null;
  }

  get layer(): GraphicsLayer | null {
    return this._layer;
  }

  private _detach(): void {
    if (this._map && this._layer) {
      try {
        this._map.remove(this._layer);
      } catch {
        /* map already torn down */
      }
    }
    this._map = null;
  }
}
