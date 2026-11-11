/**
 * NightMarchDraw.ts
 *
 * The Night March's own draw tool, in two steps:
 *   route      click the SP, then each turn; double-click (or Enter) at the FUP. Backspace takes the last point back,
 *              Esc stops.
 *   objective  click the objective; Esc (or Enter) for none.
 * While drawing, `onMove` hands the route so far and the cursor to the engine for the cursor card. The clicks stop at
 * the tool: the map does not zoom on the double-click and nothing is selected. Its own layer (`ms-night-march-draw`):
 * the legs laid (accent, cased), the rubber band to the cursor (dashed), numbered points, and in the objective step a
 * dotted line from the FUP to the cursor.
 */

import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polyline from '@arcgis/core/geometry/Polyline';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol';
import type { MercXY } from '../PlatoonGuide/PlatoonGuideRead';

export interface NmDrawRequest {
  onMove(route: MercXY[], cursor: MercXY, step: 'route' | 'objective'): void;
  onRoute?(route: MercXY[]): void;
  onDone(route: MercXY[], objective: MercXY | null): void;
  onCancel?(): void;
  onStatus?(text: string | null): void;
}

const LAYER_ID = 'ms-night-march-draw';
const INK: [number, number, number] = [142, 193, 234];

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

export class NightMarchDraw {
  private _req: NmDrawRequest | null = null;
  private _step: 'route' | 'objective' = 'route';
  private _pts: MercXY[] = [];
  private _cursor: MercXY | null = null;
  private _handles: Array<{ remove(): void }> = [];
  private _key: ((e: KeyboardEvent) => void) | null = null;
  private _layer: GraphicsLayer | null = null;
  private _map: any = null;
  private _cursorStyle = '';
  private _syms: Record<string, any> = {};

  constructor(private readonly _getView: () => any) {}

  get active(): boolean {
    return this._req !== null;
  }
  get step(): 'route' | 'objective' {
    return this._step;
  }

  start(req: NmDrawRequest): void {
    this.cancel(false);
    const view = this._getView();
    if (!view) return;
    this._req = req;
    this._step = 'route';
    this._pts = [];
    this._cursor = null;
    this._ensure(view);
    req.onStatus?.('Night march: click the SP, then each turn; double-click the FUP');
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
        if (this._step === 'objective') {
          this._finish(p);
          return;
        }
        const last = this._pts[this._pts.length - 1];
        if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 0.5) this._pts.push(p);
        this._draw();
      }),
      view.on('double-click', (e: any) => {
        e.stopPropagation();
        if (this._step !== 'route') return;
        // The double-click is the FUP: the map does not always send a click for it, so its point is added here.
        const p = toMerc(e.mapPoint);
        const last = this._pts[this._pts.length - 1];
        if (p && (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 0.5)) this._pts.push(p);
        this._routeDone();
      }),
      view.on('pointer-move', (e: any) => {
        const p = toMerc(view.toMap({ x: e.x, y: e.y }));
        if (!p) return;
        this._cursor = p;
        this._draw();
        if (this._pts.length) this._req?.onMove(this._pts.slice(), p, this._step);
      }),
    );
    this._key = (e: KeyboardEvent) => {
      if (!this._req) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (this._step === 'objective') this._finish(null);
        else this.cancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (this._step === 'route') this._routeDone();
        else this._finish(null);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        if (this._step === 'objective') {
          this._step = 'route';
          this._req.onStatus?.('Night march: click each turn; double-click the FUP');
        } else this._pts.pop();
        this._draw();
        if (this._pts.length && this._cursor) this._req.onMove(this._pts.slice(), this._cursor, this._step);
      }
    };
    window.addEventListener('keydown', this._key, true);
  }

  /** Stop drawing; `notify` tells the engine it was cancelled. */
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

  private _routeDone(): void {
    const req = this._req;
    if (!req) return;
    if (this._pts.length < 2) {
      req.onStatus?.('Night march: at least the SP and the FUP (two points)');
      return;
    }
    this._step = 'objective';
    req.onRoute?.(this._pts.slice());
    req.onStatus?.('Night march: click the Obj (Esc for none)');
    this._draw();
  }

  private _finish(obj: MercXY | null): void {
    const req = this._req;
    const pts = this._pts.slice();
    this._teardown();
    req?.onStatus?.(null);
    req?.onDone(pts, obj);
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
    this._step = 'route';
    this._layer?.removeAll();
  }

  private _ensure(view: any): void {
    if (!this._layer) this._layer = new GraphicsLayer({ id: LAYER_ID, title: 'Night March drawing', listMode: 'hide', elevationInfo: { mode: 'on-the-ground' } });
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

  private _sym(key: string, make: () => any): any {
    return (this._syms[key] ??= make());
  }

  private _draw(): void {
    const view = this._getView();
    if (!view || !this._req || !this._layer) return;
    const sr = view.spatialReference;
    const conv = (p: MercXY): number[] => (sr?.isWebMercator || [102100, 3857].includes(sr?.wkid) ? [p[0], p[1]] : webMercatorUtils.xyToLngLat(p[0], p[1]));
    const line = (pts: MercXY[], key: string, make: () => any) => {
      if (pts.length >= 2) gs.push(new Graphic({ geometry: new Polyline({ paths: [pts.map(conv)], spatialReference: sr }), symbol: this._sym(key, make) }));
    };
    const gs: Graphic[] = [];
    line(this._pts, 'case', () => new SimpleLineSymbol({ color: [20, 24, 29, 0.6], width: 7, cap: 'round', join: 'round' }));
    line(this._pts, 'laid', () => new SimpleLineSymbol({ color: [...INK, 1], width: 3, cap: 'round', join: 'round' }));
    const last = this._pts[this._pts.length - 1];
    if (last && this._cursor) {
      if (this._step === 'route') line([last, this._cursor], 'band', () => new SimpleLineSymbol({ color: [...INK, 1], width: 2.5, style: 'dash' }));
      else line([last, this._cursor], 'obj', () => new SimpleLineSymbol({ color: [229, 72, 77, 0.95], width: 2, style: 'short-dot' }));
    }
    this._pts.forEach((p, i) => {
      const [x, y] = conv(p);
      const end = this._step === 'objective' && i === this._pts.length - 1;
      const key = i === 0 ? 'sp' : end ? 'fup' : 'turn';
      gs.push(
        new Graphic({
          geometry: new Point({ x, y, spatialReference: sr }),
          symbol: this._sym(key, () =>
            i === 0
              ? new SimpleMarkerSymbol({ size: 11, color: [241, 243, 246, 1], outline: { color: [20, 24, 29, 1], width: 2 } })
              : end
                ? new SimpleMarkerSymbol({ style: 'square', size: 12, color: [47, 168, 98, 0.9], outline: { color: [241, 243, 246, 1], width: 2 } })
                : new SimpleMarkerSymbol({ size: 8, color: [...INK, 1], outline: { color: [20, 24, 29, 1], width: 1.5 } }),
          ),
        }),
      );
    });
    this._layer.removeAll();
    this._layer.addMany(gs);
  }
}
