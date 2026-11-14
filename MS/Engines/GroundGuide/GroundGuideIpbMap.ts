/**
 * GroundGuideIpbMap.ts
 *
 * Paints the Extended View's IPB coding (GroundGuideIpb.ts) on the map as one georeferenced image (an ArcGIS MediaLayer
 * holding a canvas), so a 10 km area of 30 m cells is one picture, not thousands of polygons, and the book's own marking
 * shows in 2D and 3D alike (IPB p 7: "cross-hatched lines for NO-GO terrain and parallel lines for SLOW-GO"):
 *   NO-GO      crosshatch on a light red,        SLOW-GO   parallel lines on a light orange,
 *   not assessed  grey dots (never painted as GO), not classed by the book  short violet dashes.
 * GO is left clear. `paint` switches to a soft tint or ATP 2-01.3's green (restricted / severely restricted). The layer
 * sits at the bottom of the operational layers, under every symbol, and is removed with the Extended View.
 */

import Extent from '@arcgis/core/geometry/Extent';
import MediaLayer from '@arcgis/core/layers/MediaLayer';
import ExtentAndRotationGeoreference from '@arcgis/core/layers/support/ExtentAndRotationGeoreference';
import ImageElement from '@arcgis/core/layers/support/ImageElement';
import { IPB, WHY, type IpbCoding } from './GroundGuideIpb';

const LAYER_ID = 'ms-ground-guide-ipb';
/** Safest MediaLayer image size (the SDK's note: 2048 x 2048). */
const MAX_PX = 2048;
type Paint = 'hatch' | 'soft' | 'atp';

/** A small tile drawn once and repeated over a class's cells. */
function pattern(ctx: CanvasRenderingContext2D, kind: 'cross' | 'lines' | 'dots' | 'dash' | 'solid', fg: string, bg: string): CanvasPattern | string {
  if (kind === 'solid') return bg;
  const s = 8;
  const t = document.createElement('canvas');
  t.width = s;
  t.height = s;
  const c = t.getContext('2d') as CanvasRenderingContext2D;
  c.fillStyle = bg;
  c.fillRect(0, 0, s, s);
  c.strokeStyle = fg;
  c.fillStyle = fg;
  c.lineWidth = 1.3;
  if (kind === 'cross' || kind === 'lines') {
    c.beginPath();
    c.moveTo(-1, s + 1);
    c.lineTo(s + 1, -1);
    c.moveTo(-1, 1);
    c.lineTo(1, -1);
    c.moveTo(s - 1, s + 1);
    c.lineTo(s + 1, s - 1);
    if (kind === 'cross') {
      c.moveTo(-1, -1);
      c.lineTo(s + 1, s + 1);
    }
    c.stroke();
  } else if (kind === 'dots') {
    c.beginPath();
    c.arc(s / 2, s / 2, 1.1, 0, Math.PI * 2);
    c.fill();
  } else {
    c.beginPath();
    c.moveTo(1, s / 2);
    c.lineTo(s * 0.55, s / 2);
    c.stroke();
  }
  return ctx.createPattern(t, 'repeat') ?? bg;
}

function styles(ctx: CanvasRenderingContext2D, paint: Paint): Record<'nogo' | 'slow' | 'na' | 'nc', CanvasPattern | string> {
  const na = pattern(ctx, 'dots', 'rgba(195,203,211,0.95)', 'rgba(195,203,211,0.10)');
  const nc = pattern(ctx, 'dash', 'rgba(185,162,232,0.95)', 'rgba(185,162,232,0.06)');
  if (paint === 'soft') return { nogo: 'rgba(229,72,77,0.38)', slow: 'rgba(238,138,31,0.28)', na: 'rgba(195,203,211,0.28)', nc: 'rgba(185,162,232,0.25)' };
  if (paint === 'atp') return { nogo: pattern(ctx, 'cross', 'rgba(127,208,138,0.95)', 'rgba(60,140,70,0.24)'), slow: pattern(ctx, 'lines', 'rgba(127,208,138,0.9)', 'rgba(60,140,70,0.06)'), na, nc };
  return { nogo: pattern(ctx, 'cross', 'rgba(255,138,141,0.95)', 'rgba(185,43,49,0.30)'), slow: pattern(ctx, 'lines', 'rgba(255,180,107,0.9)', 'rgba(238,138,31,0.08)'), na, nc };
}

export class GroundGuideIpbMap {
  private _layer: MediaLayer | null = null;
  private _map: any = null;
  private _key = '';

  constructor(private readonly _getView: () => any) {}

  /** The key of what is shown ('' when nothing is). */
  get shownKey(): string {
    return this._key;
  }

  /**
   * Show a coding over `extent` ([xmin, ymin, xmax, ymax], Web Mercator metres, the coding's own cells edge to edge).
   */
  show(c: IpbCoding, extent: [number, number, number, number], paint: Paint, key: string): void {
    const view = this._getView();
    const map = view?.map;
    if (!map || !c.w || !c.h) return this.clear();
    const scale = Math.max(1, Math.min(2, Math.floor(MAX_PX / Math.max(c.w, c.h))));
    const cw = c.w * scale;
    const ch = c.h * scale;
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const st = styles(ctx, paint);
    // One mask per class at the coding's resolution, stretched without smoothing, then filled with its pattern.
    const mask = document.createElement('canvas');
    mask.width = c.w;
    mask.height = c.h;
    const mctx = mask.getContext('2d') as CanvasRenderingContext2D;
    const layer = document.createElement('canvas');
    layer.width = cw;
    layer.height = ch;
    const lctx = layer.getContext('2d') as CanvasRenderingContext2D;
    const NA_FLAGS = WHY.NA_WATER | WHY.NA_VEG;
    const passes: Array<[keyof typeof st, (i: number) => boolean]> = [
      ['nogo', (i) => c.code[i] === IPB.NOGO],
      ['slow', (i) => c.code[i] === IPB.SLOW],
      ['na', (i) => c.code[i] === IPB.NA || (c.code[i] === IPB.SLOW && (c.why[i] & NA_FLAGS) !== 0)],
      ['nc', (i) => c.code[i] === IPB.NC],
    ];
    for (const [name, test] of passes) {
      const img = mctx.createImageData(c.w, c.h);
      let any = false;
      for (let i = 0; i < c.code.length; i++) {
        if (!test(i)) continue;
        img.data[i * 4 + 3] = 255;
        any = true;
      }
      if (!any) continue;
      mctx.clearRect(0, 0, c.w, c.h);
      mctx.putImageData(img, 0, 0);
      lctx.globalCompositeOperation = 'source-over';
      lctx.clearRect(0, 0, cw, ch);
      lctx.imageSmoothingEnabled = false;
      lctx.drawImage(mask, 0, 0, cw, ch);
      lctx.globalCompositeOperation = 'source-in';
      lctx.fillStyle = st[name];
      lctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(layer, 0, 0);
    }
    const element = new ImageElement({
      image: canvas,
      georeference: new ExtentAndRotationGeoreference({
        extent: new Extent({ xmin: extent[0], ymin: extent[1], xmax: extent[2], ymax: extent[3], spatialReference: { wkid: 102100 } }),
      }),
    });
    if (this._layer && this._map !== map) this._detach();
    if (!this._layer) {
      this._layer = new MediaLayer({ id: LAYER_ID, title: 'Ground Guide IPB coding', listMode: 'hide', opacity: 0.9, source: [element] } as any);
      map.add(this._layer, 0); // under every symbol layer
      this._map = map;
    } else {
      const src: any = (this._layer as any).source;
      src?.elements?.removeAll?.();
      src?.elements?.add?.(element);
    }
    this._key = key;
  }

  clear(): void {
    if (!this._key && !this._layer) return;
    this._detach();
    this._key = '';
  }

  /** The view (or its map) changed: leave the old map; the next `show` adds the layer to the new one. */
  onViewChanged(): void {
    this._detach();
    this._key = '';
  }

  destroy(): void {
    this._detach();
    this._key = '';
  }

  private _detach(): void {
    if (this._layer) {
      try {
        this._map?.remove(this._layer);
      } catch {
        /* the map may already be gone */
      }
      this._layer.destroy();
    }
    this._layer = null;
    this._map = null;
  }
}
