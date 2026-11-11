/**
 * MovementGuideDraw.ts
 *
 * The cards' own drawing tool (they are not tied to any symbol): a route or a line (click points, double-click or
 * Enter to finish), an area (the same, closed), or one point (one click). Backspace takes the last point back, Esc
 * cancels. While drawing, `onMove` hands the shape so far (with the cursor) to the card for a quick read. The clicks
 * stop at the tool: the map does not zoom on the double-click and nothing is selected.
 */

import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polygon from '@arcgis/core/geometry/Polygon';
import Polyline from '@arcgis/core/geometry/Polyline';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol';
import type { MercXY } from './MovementGuideScan';

export type DrawKind = 'line' | 'area' | 'point';
export interface DrawRequest {
  kind: DrawKind;
  /** What the status line says while drawing ("Draw the route: click points, double-click to finish"). */
  prompt: string;
  onMove?: (pts: MercXY[]) => void;
  onDone: (pts: MercXY[]) => void;
  onCancel?: () => void;
  onStatus?: (text: string | null) => void;
}

const LAYER_ID = 'ms-movement-guide-draw';
const INK: [number, number, number] = [0, 229, 255];

function toMerc(p: any): MercXY | null {
  if (!p) return null;
  const sr = p.spatialReference;
  if (sr?.isWebMercator || [102100, 3857].includes(sr?.wkid)) return [p.x, p.y];
  if (typeof p.longitude === 'number' && typeof p.latitude === 'number') {
    const [x, y] = webMercatorUtils.lngLatToXY(p.longitude, p.latitude);
    return [x, y];
  }
  return null;
}

export class MovementGuideDraw {
  private _req: DrawRequest | null = null;
  private _pts: MercXY[] = [];
  private _cursor: MercXY | null = null;
  private _handles: Array<{ remove(): void }> = [];
  private _key: ((e: KeyboardEvent) => void) | null = null;
  private _layer: GraphicsLayer | null = null;
  private _map: any = null;
  private _cursorStyle = '';

  constructor(private readonly _getView: () => any) {}

  get active(): boolean {
    return this._req !== null;
  }

  start(req: DrawRequest): void {
    this.cancel(false);
    const view = this._getView();
    if (!view) return;
    this._req = req;
    this._pts = [];
    this._cursor = null;
    this._ensure(view);
    req.onStatus?.(req.prompt);
    const container = view.container as HTMLElement | null;
    if (container) {
      this._cursorStyle = container.style.cursor;
      container.style.cursor = 'crosshair';
    }
    this._handles.push(
      view.on('click', (e: any) => {
        e.stopPropagation();
        const p = toMerc(e.mapPoint);
        if (!p) return;
        if (req.kind === 'point') {
          this._finish([p]);
          return;
        }
        const last = this._pts[this._pts.length - 1];
        if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 0.5) this._pts.push(p);
        this._draw();
      }),
      view.on('double-click', (e: any) => {
        e.stopPropagation();
        this._finishShape();
      }),
      view.on('pointer-move', (e: any) => {
        const mp = view.toMap({ x: e.x, y: e.y });
        const p = toMerc(mp);
        if (!p) return;
        this._cursor = p;
        this._draw();
        if (this._pts.length && req.onMove) req.onMove([...this._pts, p]);
      }),
    );
    this._key = (e: KeyboardEvent) => {
      if (!this._req) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.cancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        this._finishShape();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        this._pts.pop();
        this._draw();
      }
    };
    window.addEventListener('keydown', this._key, true);
  }

  /** Stop drawing; `notify` tells the card it was cancelled. */
  cancel(notify = true): void {
    const req = this._req;
    this._teardown();
    if (req && notify) {
      req.onStatus?.(null);
      req.onCancel?.();
    }
  }

  destroy(): void {
    this._teardown();
    if (this._map && this._layer) {
      try {
        this._map.remove(this._layer);
      } catch {
        /* map gone */
      }
    }
    this._layer?.destroy();
    this._layer = null;
    this._map = null;
  }

  private _finishShape(): void {
    const req = this._req;
    if (!req) return;
    const need = req.kind === 'area' ? 3 : 2;
    if (this._pts.length < need) {
      req.onStatus?.(`${req.prompt} (at least ${need} points)`);
      return;
    }
    this._finish(this._pts.slice());
  }

  private _finish(pts: MercXY[]): void {
    const req = this._req;
    this._teardown();
    req?.onStatus?.(null);
    req?.onDone(pts);
  }

  private _teardown(): void {
    for (const h of this._handles) h.remove();
    this._handles = [];
    if (this._key) window.removeEventListener('keydown', this._key, true);
    this._key = null;
    const container = this._getView()?.container as HTMLElement | null;
    if (container && this._req) container.style.cursor = this._cursorStyle;
    this._req = null;
    this._pts = [];
    this._layer?.removeAll();
  }

  private _ensure(view: any): void {
    if (!this._layer) this._layer = new GraphicsLayer({ id: LAYER_ID, title: 'Mov Guide drawing', listMode: 'hide', elevationInfo: { mode: 'on-the-ground' } });
    if (this._map !== view.map) {
      if (this._map) {
        try {
          this._map.remove(this._layer);
        } catch {
          /* gone */
        }
      }
      view.map.add(this._layer);
      this._map = view.map;
    }
  }

  private _draw(): void {
    const view = this._getView();
    const req = this._req;
    if (!view || !req || !this._layer) return;
    const sr = view.spatialReference;
    const conv = (p: MercXY): number[] => {
      if (sr?.isWebMercator || [102100, 3857].includes(sr?.wkid)) return [p[0], p[1]];
      return webMercatorUtils.xyToLngLat(p[0], p[1]);
    };
    const pts = this._cursor ? [...this._pts, this._cursor] : this._pts;
    const gs: Graphic[] = [];
    if (pts.length >= 2) {
      if (req.kind === 'area' && pts.length >= 3) {
        gs.push(new Graphic({ geometry: new Polygon({ rings: [[...pts, pts[0]].map(conv)], spatialReference: sr }), symbol: new SimpleFillSymbol({ color: [...INK, 0.12], outline: new SimpleLineSymbol({ color: [...INK, 1], width: 2, style: 'dash' }) }) }));
      } else {
        gs.push(new Graphic({ geometry: new Polyline({ paths: [pts.map(conv)], spatialReference: sr }), symbol: new SimpleLineSymbol({ color: [...INK, 1], width: 2.5, style: 'dash' }) }));
      }
    }
    for (const p of this._pts) {
      const [x, y] = conv(p);
      gs.push(new Graphic({ geometry: new Point({ x, y, spatialReference: sr }), symbol: new SimpleMarkerSymbol({ size: 7, color: [255, 255, 255, 1], outline: { color: [...INK, 1], width: 2 } }) }));
    }
    this._layer.removeAll();
    this._layer.addMany(gs);
  }
}
