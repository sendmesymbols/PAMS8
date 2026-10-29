/**
 * PlacementIndicators.ts
 *
 * Draws the Placement Advisor's indicator lines on the map: from the symbol (or the
 * part of a shape that decides the verdict) to the terrain that is the reason for it,
 * with a marker on that terrain, extra marks on the parts of a line/area that lie in
 * no-go ground, and a short label.
 *
 *   red   line + marker : to the nearest no-go ground (too close) or to the contested
 *                         part of a shape (partly / mostly in no-go)
 *   green line + marker : from a symbol that is inside no-go to the nearest deployable
 *                         ground (where it could move to)
 *
 * Like ProximityEngine, the graphics are created once, kept on one ground-draped
 * GraphicsLayer and only have their geometry swapped / visibility toggled afterwards,
 * so following the cursor never adds or removes graphics (which would redraw the layer).
 */

import Graphic from '@arcgis/core/Graphic';
import Multipoint from '@arcgis/core/geometry/Multipoint';
import Point from '@arcgis/core/geometry/Point';
import Polyline from '@arcgis/core/geometry/Polyline';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Font from '@arcgis/core/symbols/Font';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol';
import TextSymbol from '@arcgis/core/symbols/TextSymbol';
import type { MercXY, PlacementIndicator } from './PlacementTypes';

const LAYER_ID = 'ms-placement-indicators';

const RGB: Record<PlacementIndicator['kind'], [number, number, number]> = {
  'no-go': [214, 48, 49],
  contested: [214, 48, 49],
  deployable: [46, 160, 90],
};

type Convert = (p: MercXY) => [number, number] | null;

export class PlacementIndicators {
  private _layer: GraphicsLayer | null = null;
  private _map: any = null;
  private _casing: Graphic | null = null;
  private _line: Graphic | null = null;
  private _ends: Graphic | null = null;
  private _marks: Graphic | null = null;
  private _label: Graphic | null = null;
  private _labelSym: TextSymbol | null = null;
  private _kind: PlacementIndicator['kind'] | null = null;
  private _labelText = '';
  private _labelLeft = false;
  private _visible = false;

  constructor(private readonly _getView: () => any) {}

  /** Draw (or move) the lines for these indicators; hides everything when there are none. */
  show(indicators: PlacementIndicator[], labels: boolean): void {
    const view = this._getView?.();
    const sr = view?.spatialReference;
    const conv = sr ? this._converter(sr) : null;
    if (!view?.map || !sr || !conv || indicators.length === 0) {
      this.hide();
      return;
    }

    const paths: [number, number][][] = [];
    const ends: [number, number][] = [];
    const marks: [number, number][] = [];
    for (const ind of indicators) {
      const a = conv(ind.from);
      const b = conv(ind.to);
      if (!a || !b) continue;
      paths.push([a, b]);
      ends.push(b);
      for (const m of ind.marks) {
        const c = conv(m);
        if (c) marks.push(c);
      }
    }
    if (paths.length === 0) {
      this.hide();
      return;
    }

    const kind = indicators[0].kind;
    this._ensure(view.map, kind);
    if (kind !== this._kind) this._applyKind(kind);

    this._casing!.geometry = new Polyline({ paths, spatialReference: sr });
    this._line!.geometry = new Polyline({ paths, spatialReference: sr });
    this._ends!.geometry = new Multipoint({ points: ends, spatialReference: sr });
    this._marks!.geometry = marks.length ? new Multipoint({ points: marks, spatialReference: sr }) : null;
    this._marks!.visible = marks.length > 0;

    const text = labels ? indicators[0].label : '';
    if (text) {
      this._label!.geometry = new Point({ x: ends[0][0], y: ends[0][1], spatialReference: sr });
      // Put the text beyond the end of the line (on the side away from the symbol) so it never covers the line.
      const left = paths[0][1][0] < paths[0][0][0];
      if (text !== this._labelText || left !== this._labelLeft) {
        // Mutate the one text symbol and re-assign it (as ProximityEngine does) so both 2D and 3D refresh.
        const sym = this._labelSym!;
        sym.text = text;
        sym.horizontalAlignment = left ? 'right' : 'left';
        sym.xoffset = left ? -10 : 10;
        this._label!.symbol = sym;
        this._labelText = text;
        this._labelLeft = left;
      }
    }
    this._label!.visible = !!text;

    if (!this._visible) {
      this._casing!.visible = true;
      this._line!.visible = true;
      this._ends!.visible = true;
      this._visible = true;
    }
  }

  hide(): void {
    if (!this._visible) return;
    for (const g of [this._casing, this._line, this._ends, this._marks, this._label]) if (g) g.visible = false;
    this._visible = false;
  }

  /** The view changed: leave the old map so the next show() attaches to the new one. */
  onViewChanged(): void {
    this.hide();
    this._detach();
  }

  destroy(): void {
    this._detach();
    this._layer?.destroy();
    this._layer = null;
    this._casing = this._line = this._ends = this._marks = this._label = null;
    this._labelSym = null;
    this._kind = null;
    this._labelText = '';
    this._visible = false;
  }

  /** The layer, for hosts that want to inspect or restyle it. */
  get layer(): GraphicsLayer | null {
    return this._layer;
  }

  // ── internals ────────────────────────────────────────────────────────────

  private _converter(sr: any): Convert | null {
    if (sr.isWebMercator === true || [102100, 3857, 102113, 3785].includes(sr.wkid ?? sr.latestWkid)) {
      return (p) => [p[0], p[1]];
    }
    if (sr.isWGS84 === true || (sr.wkid ?? sr.latestWkid) === 4326) {
      return (p) => {
        const ll = webMercatorUtils.xyToLngLat(p[0], p[1]);
        return ll ? [ll[0], ll[1]] : null;
      };
    }
    return null;
  }

  private _ensure(map: any, kind: PlacementIndicator['kind']): void {
    if (!this._layer) {
      this._layer = new GraphicsLayer({
        id: LAYER_ID,
        title: 'Placement indicators',
        listMode: 'hide',
        elevationInfo: { mode: 'on-the-ground' },
      });
      // Every graphic is created WITH its symbol (geometry arrives later), the way
      // ProximityEngine does it: a symbol-less graphic added to a SceneView layer is
      // never picked up when its symbol is set afterwards.
      const s = this._symbols(kind);
      this._labelSym = s.label;
      this._casing = new Graphic({ symbol: s.casing, visible: false });
      this._line = new Graphic({ symbol: s.line, visible: false });
      this._ends = new Graphic({ symbol: s.end, visible: false });
      this._marks = new Graphic({ symbol: s.mark, visible: false });
      this._label = new Graphic({ symbol: s.label, visible: false });
      this._layer.addMany([this._casing, this._line, this._marks, this._ends, this._label]);
      this._kind = kind;
      this._labelText = '';
    }
    if (this._map !== map) {
      this._detach();
      map.add(this._layer); // appended last = above the overlay and the symbol layers
      this._map = map;
    }
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

  /** The kind (colour / marker shape) changed: swap in symbols for it. */
  private _applyKind(kind: PlacementIndicator['kind']): void {
    const s = this._symbols(kind);
    this._kind = kind;
    this._labelSym = s.label;
    this._labelText = ''; // forces the label symbol to be re-assigned on this show()
    this._casing!.symbol = s.casing;
    this._line!.symbol = s.line;
    this._ends!.symbol = s.end;
    this._marks!.symbol = s.mark;
    this._label!.symbol = s.label;
  }

  private _symbols(kind: PlacementIndicator['kind']) {
    const rgb = RGB[kind];
    return {
      casing: new SimpleLineSymbol({ style: 'solid', color: [255, 255, 255, 0.8], width: 5 }),
      line: new SimpleLineSymbol({ style: 'dash', color: [...rgb, 1], width: 2.5 }),
      end: new SimpleMarkerSymbol({
        style: kind === 'deployable' ? 'diamond' : 'circle',
        color: [255, 255, 255, 1],
        size: 11,
        outline: { color: [...rgb, 1], width: 2.5 },
      }),
      mark: new SimpleMarkerSymbol({
        style: 'x',
        color: [...rgb, 1],
        size: 9,
        outline: { color: [...rgb, 1], width: 2 },
      }),
      label: new TextSymbol({
        text: '',
        font: new Font({ size: 11, weight: 'bold', family: 'Helvetica' }),
        color: [255, 255, 255, 1],
        haloColor: [...rgb, 0.95],
        haloSize: 2.5,
        horizontalAlignment: 'left',
        xoffset: 10,
        yoffset: -4,
      }),
    };
  }
}
