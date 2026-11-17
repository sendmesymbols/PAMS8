/**
 * SiteMap.ts
 *
 * A site finder on the map (Gun Deployment, Admin Area), on one GraphicsLayer of its own per finder: the search circle,
 * each candidate area coloured by its verdict with its rank, the picked places (search centre, target, threat), lines
 * (line of fire, masked stretch) and range arcs, each with a small label. Markers and labels are PictureMarkerSymbols so
 * the layer shows in 2D and 3D. Coordinates come in as Web Mercator metres.
 */

import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polygon from '@arcgis/core/geometry/Polygon';
import Polyline from '@arcgis/core/geometry/Polyline';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import PictureMarkerSymbol from '@arcgis/core/symbols/PictureMarkerSymbol';
import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import Utils from '../../Support/utils';
import { offsetPt, type Tone, type XY } from './SiteScan';

export type RGB = [number, number, number];
export const TONE_RGB: Record<Tone, RGB> = { ok: [47, 168, 98], warn: [238, 138, 31], bad: [229, 72, 77], unknown: [154, 163, 173] };
const hex = (c: RGB) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const svgUrl = (w: number, h: number, body: string): string => Utils.svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);
const esc = (s: string) => Utils.escapeHtml(s);

export interface MapPoly {
  ring: XY[];
  tone: Tone;
  selected: boolean;
  label?: string;
  /** Colour instead of the tone's (Compare's alternative colours). */
  rgb?: RGB;
}
export interface MapLine {
  pts: XY[];
  rgb: RGB;
  width: number;
  dash?: boolean;
  label?: string;
}
export interface MapMark {
  at: XY;
  kind: 'centre' | 'target' | 'threat' | 'crest' | 'site' | 'tick' | 'letter';
  /** For 'letter': the letter and its colour. */
  letter?: string;
  rgb?: RGB;
  label?: string;
}
export interface MapSpec {
  circle?: { at: XY; radiusM: number; label?: string } | null;
  polys: MapPoly[];
  lines: MapLine[];
  marks: MapMark[];
}

function plate(text: string, border: string): { url: string; w: number; h: number } {
  const t = text.length > 40 ? text.slice(0, 39) + '…' : text;
  const w = Math.round(t.length * 6.3 + 16);
  const h = 19;
  return {
    url: svgUrl(w, h, `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="5" fill="#14181d" fill-opacity="0.85" stroke="${border}" stroke-width="1.5"/><text x="${w / 2}" y="13.5" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="11" fill="#f1f3f6">${esc(t)}</text>`),
    w,
    h,
  };
}

function markUrl(kind: MapMark['kind'], m?: MapMark): { url: string; s: number } {
  switch (kind) {
    case 'tick':
      return { s: 8, url: svgUrl(8, 8, '<circle cx="4" cy="4" r="3" fill="#fff" stroke="#14181d" stroke-width="1.4"/>') };
    case 'letter': {
      const c = m?.rgb ? hex(m.rgb) : '#8ec1ea';
      return { s: 22, url: svgUrl(22, 22, `<circle cx="11" cy="11" r="9.5" fill="${c}" stroke="#14181d" stroke-width="1.8"/><text x="11" y="15" text-anchor="middle" font-family="Arial" font-weight="700" font-size="12" fill="#14181d">${esc(m?.letter ?? '')}</text>`) };
    }
    case 'target':
      return { s: 26, url: svgUrl(26, 26, '<circle cx="13" cy="13" r="9" fill="none" stroke="#fff" stroke-width="4"/><circle cx="13" cy="13" r="9" fill="none" stroke="#e5484d" stroke-width="2.2"/><path d="M13 1 V8 M13 18 V25 M1 13 H8 M18 13 H25" stroke="#e5484d" stroke-width="2.2"/>') };
    case 'threat':
      return { s: 24, url: svgUrl(24, 24, '<path d="M12 2 L22 21 L2 21 Z" fill="#e5484d" stroke="#14181d" stroke-width="1.8"/><text x="12" y="18" text-anchor="middle" font-family="Arial" font-weight="700" font-size="11" fill="#fff">!</text>') };
    case 'crest':
      return { s: 20, url: svgUrl(20, 20, '<path d="M2 16 L10 4 L18 16 Z" fill="#f1d646" stroke="#14181d" stroke-width="1.8"/>') };
    case 'site':
      return { s: 12, url: svgUrl(12, 12, '<circle cx="6" cy="6" r="4" fill="#fff" stroke="#14181d" stroke-width="1.6"/>') };
    default:
      return { s: 22, url: svgUrl(22, 22, '<circle cx="11" cy="11" r="8" fill="none" stroke="#14181d" stroke-width="4"/><circle cx="11" cy="11" r="8" fill="none" stroke="#8ec1ea" stroke-width="2.2"/><circle cx="11" cy="11" r="2.2" fill="#8ec1ea"/>') };
  }
}

/** Points of a circle (ground metres) round `c`. */
export function circlePts(c: XY, radiusM: number, n = 72): XY[] {
  const out: XY[] = [];
  for (let i = 0; i <= n; i++) out.push(offsetPt(c[0], c[1], (i * 360) / n, radiusM));
  return out;
}

/** An arc of `radiusM` round `c`, `spanDeg` wide, centred on `bearingDeg`. */
export function arcPts(c: XY, radiusM: number, bearingDeg: number, spanDeg: number, n = 36): XY[] {
  const out: XY[] = [];
  for (let i = 0; i <= n; i++) out.push(offsetPt(c[0], c[1], bearingDeg - spanDeg / 2 + (i * spanDeg) / n, radiusM));
  return out;
}

export class SiteMap {
  private _layer: GraphicsLayer | null = null;
  private _getView: () => any;
  private _id: string;
  private _title: string;

  constructor(getView: () => any, id: string, title: string) {
    this._getView = getView;
    this._id = id;
    this._title = title;
  }

  private _ensure(): { view: any; layer: GraphicsLayer } | null {
    const view = this._getView();
    const map = view?.map;
    if (!map) return null;
    if (!this._layer || !map.findLayerById(this._id)) {
      const is3d = view.type === '3d';
      this._layer = (map.findLayerById(this._id) as GraphicsLayer) ?? new GraphicsLayer({ id: this._id, title: this._title, listMode: 'hide', ...(is3d ? { elevationInfo: { mode: 'on-the-ground' } } : {}) } as any);
      if (!map.findLayerById(this._id)) map.add(this._layer);
    }
    return { view, layer: this._layer! };
  }

  private _conv(view: any): { sr: any; xy: (p: XY) => [number, number] } {
    const merc = !!view?.spatialReference?.isWebMercator;
    return {
      sr: merc ? { wkid: 102100 } : { wkid: 4326 },
      xy: (p: XY) => (merc ? [p[0], p[1]] : (webMercatorUtils.xyToLngLat(p[0], p[1]) as [number, number])),
    };
  }

  clear(): void {
    this._layer?.removeAll();
    this._hoverG = null;
  }

  destroy(): void {
    const map = this._getView()?.map;
    if (this._layer && map?.findLayerById(this._layer.id)) map.remove(this._layer);
    this._layer = null;
    this._hoverG = null;
  }

  private _hoverG: Graphic | null = null;

  /** A marker that follows the chart's hover (null takes it off). */
  hover(p: XY | null): void {
    const e = this._ensure();
    if (!e) return;
    if (this._hoverG) e.layer.remove(this._hoverG);
    this._hoverG = null;
    if (!p) return;
    const { sr, xy } = this._conv(e.view);
    const [x, y] = xy(p);
    this._hoverG = new Graphic({
      geometry: new Point({ x, y, spatialReference: sr }),
      symbol: new PictureMarkerSymbol({ url: svgUrl(16, 16, '<circle cx="8" cy="8" r="6" fill="#ffc800" stroke="#14181d" stroke-width="2"/>'), width: '16px', height: '16px' }) as any,
    });
    e.layer.add(this._hoverG);
  }

  draw(spec: MapSpec, labels = true): void {
    const e = this._ensure();
    if (!e) return;
    const { view, layer } = e;
    const { sr, xy } = this._conv(view);
    const gs: Graphic[] = [];
    const pt = (p: XY) => new Point({ x: xy(p)[0], y: xy(p)[1], spatialReference: sr });
    const pic = (p: XY, url: string, w: number, h: number, yoff = 0) => new Graphic({ geometry: pt(p), symbol: new PictureMarkerSymbol({ url, width: `${w}px`, height: `${h}px`, yoffset: yoff }) as any });
    const label = (p: XY, text: string, border: string, yoff = 0) => {
      const pl = plate(text, border);
      gs.push(pic(p, pl.url, pl.w, pl.h, yoff));
    };
    if (spec.circle) {
      const ring = circlePts(spec.circle.at, spec.circle.radiusM);
      gs.push(new Graphic({ geometry: new Polyline({ paths: [ring.map(xy)], spatialReference: sr }), symbol: new SimpleLineSymbol({ color: [142, 193, 234, 0.9], width: 1.6, style: 'dash' }) as any }));
      if (labels && spec.circle.label) label(ring[0], spec.circle.label, '#8ec1ea');
    }
    // unselected first, the selected on top
    const polys = [...spec.polys].sort((a, b) => Number(a.selected) - Number(b.selected));
    for (const p of polys) {
      const c = p.rgb ?? TONE_RGB[p.tone];
      const ring = p.ring.map(xy);
      ring.push(ring[0]);
      gs.push(
        new Graphic({
          geometry: new Polygon({ rings: [ring], spatialReference: sr }),
          symbol: new SimpleFillSymbol({ color: [...c, p.selected ? 0.32 : 0.16], outline: { color: p.selected ? [255, 255, 255, 1] : [...c, 0.95], width: p.selected ? 2.6 : 1.6 } }) as any,
        }),
      );
      if (labels && p.label) {
        let cx = 0, cy = 0;
        for (const q of p.ring) {
          cx += q[0];
          cy += q[1];
        }
        label([cx / p.ring.length, cy / p.ring.length], p.label, hex(c));
      }
    }
    for (const l of spec.lines) {
      if (l.pts.length < 2) continue;
      gs.push(new Graphic({ geometry: new Polyline({ paths: [l.pts.map(xy)], spatialReference: sr }), symbol: new SimpleLineSymbol({ color: [...l.rgb, 0.95], width: l.width, style: l.dash ? 'dash' : 'solid' }) as any }));
      if (labels && l.label) label(l.pts[Math.floor(l.pts.length / 2)], l.label, hex(l.rgb), 12);
    }
    for (const m of spec.marks) {
      const u = markUrl(m.kind, m);
      gs.push(pic(m.at, u.url, u.s, u.s));
      if (labels && m.label) label(m.at, m.label, m.kind === 'target' || m.kind === 'threat' ? '#e5484d' : m.kind === 'crest' ? '#f1d646' : m.rgb ? hex(m.rgb) : '#8ec1ea', m.kind === 'tick' ? -12 : -(u.s / 2 + 12));
    }
    layer.removeAll();
    layer.addMany(gs);
    if (this._hoverG) layer.add(this._hoverG);
  }
}

export default SiteMap;
