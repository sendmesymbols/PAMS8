/**
 * MovementGuideMap.ts
 *
 * The Movement Guide on the map, on one ground-draped GraphicsLayer of its own (`ms-movement-guide`):
 *   - the danger ribbon along the route: red where the worst danger scores 70 or more, orange 50-69, yellow 30-49;
 *   - a lettered marker on each danger worth a look (V vulnerable point, A likely ambush site, M likely mine / IED
 *     spot, B where the enemy can block the road, S sensitive site, N natural hazard), and on the ground that
 *     overlooks the road a violet triangle with a dashed line to the stretch it sees;
 *   - the piquets (blue P, a dash to the stretch each covers), the gaps no piquet sees (grey dashes), check posts (CP);
 *   - a cordon: the inner cordon (solid blue), the outer ring of road blocks (dashed), RB on every exit, x where a side
 *     road crosses the cordon, E on each escape route (in the country), S sensitive sites, H possible hides;
 *   - an infiltration lane: a red x on each obstacle on foot.
 * Graphics are built with their symbols (a symbol-less graphic is never drawn in a SceneView) and markers are
 * PictureMarkerSymbols, so it shows in 2D and 3D. Text is kept to one or two letters inside a marker.
 */

import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polyline from '@arcgis/core/geometry/Polyline';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import PictureMarkerSymbol from '@arcgis/core/symbols/PictureMarkerSymbol';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import Utils from '../../Support/utils';
import type { CheckPost, CordonReading, HazardKind, LaneReading, MercXY, Picket, Station, Stretch } from './MovementGuideScan';

const LAYER_ID = 'ms-movement-guide';
type RGB = [number, number, number];
export const MG_RED: RGB = [229, 57, 53];
export const MG_ORANGE: RGB = [245, 124, 0];
export const MG_YELLOW: RGB = [253, 216, 53];
const BLUE: RGB = [33, 150, 243];
const VIOLET: RGB = [167, 139, 250];
const PURPLE: RGB = [171, 71, 188];
const BROWN: RGB = [141, 110, 99];
const GREY: RGB = [176, 190, 197];

const rgb = (c: RGB): string => `rgb(${c[0]},${c[1]},${c[2]})`;
const svg = (body: string, size = 22): string => Utils.svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 22 22">${body}</svg>`);
const letter = (t: string, fill: RGB, shape: 'circle' | 'square' | 'diamond' = 'circle', ink = '#fff'): string => {
  const body =
    shape === 'square'
      ? `<rect x="2" y="2" width="18" height="18" rx="3" fill="${rgb(fill)}" stroke="#14181d" stroke-width="1.5"/>`
      : shape === 'diamond'
        ? `<path d="M11 1.5 L20.5 11 L11 20.5 L1.5 11 Z" fill="${rgb(fill)}" stroke="#14181d" stroke-width="1.5"/>`
        : `<circle cx="11" cy="11" r="9" fill="${rgb(fill)}" stroke="#14181d" stroke-width="1.5"/>`;
  const fs = t.length > 1 ? 8.5 : 11;
  return svg(`${body}<text x="11" y="${11 + fs * 0.36}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="${fs}" fill="${ink}">${t}</text>`);
};
const crossUrl = (c: RGB): string => {
  const x = 'M5 5 L17 17 M17 5 L5 17';
  return svg(`<path d="${x}" stroke="#fff" stroke-opacity="0.9" stroke-width="6" stroke-linecap="round" fill="none"/><path d="${x}" stroke="${rgb(c)}" stroke-width="3" stroke-linecap="round" fill="none"/>`);
};
const triUrl = (c: RGB): string => svg(`<path d="M11 2.5 L20 19 L2 19 Z" fill="${rgb(c)}" stroke="#14181d" stroke-width="1.5" stroke-linejoin="round"/>`);

const MARK: Partial<Record<HazardKind, { t: string; c: RGB; shape?: 'circle' | 'square' | 'diamond'; ink?: string }>> = {
  vp: { t: 'V', c: MG_ORANGE },
  ambush: { t: 'A', c: MG_RED },
  mine: { t: 'M', c: MG_RED, shape: 'diamond' },
  block: { t: 'B', c: MG_RED, shape: 'square' },
  sensitive: { t: 'S', c: PURPLE },
  natural: { t: 'N', c: [0, 137, 123] },
};

export type MovRGB = [number, number, number];
export const MG_BLUE: MovRGB = [33, 150, 243];
export const MG_VIOLET: MovRGB = [167, 139, 250];
export const MG_GREEN: MovRGB = [67, 160, 71];
export const MG_CYAN: MovRGB = [0, 229, 255];
export interface MovMapLine {
  pts: MercXY[];
  c: MovRGB;
  a?: number;
  w?: number;
  style?: 'solid' | 'dash' | 'short-dash';
}
export interface MovMapMark {
  at: MercXY;
  /** One or two letters (or a number) inside the marker. */
  t: string;
  c: MovRGB;
  shape?: 'circle' | 'square' | 'diamond';
  title?: string;
  size?: number;
}

export interface MovMapProducts {
  /** A card's own lines and lettered markers, drawn above everything else. */
  lines?: MovMapLine[] | null;
  marks?: MovMapMark[] | null;
  route?: { stations: Station[]; stretches: Stretch[] } | null;
  pickets?: Picket[] | null;
  gaps?: Array<{ fromM: number; toM: number }> | null;
  checkPosts?: CheckPost[] | null;
  cordon?: CordonReading | null;
  lane?: LaneReading | null;
}

type Convert = (p: MercXY) => [number, number] | null;

export class MovementGuideMap {
  private _layer: GraphicsLayer | null = null;
  private _map: any = null;
  private _syms = new Map<string, any>();

  constructor(private readonly _getView: () => any) {}

  get layer(): GraphicsLayer | null {
    return this._layer;
  }

  /** Draw the products (replacing what was there). */
  show(p: MovMapProducts): void {
    const view = this._getView?.();
    const sr = view?.spatialReference;
    if (!view?.map || !sr) return;
    const conv = this._converter(sr);
    if (!conv) return;
    this._ensure(view.map);
    const out: Graphic[] = [];
    const line = (pts: MercXY[], c: RGB, a: number, w: number, style: 'solid' | 'dash' | 'short-dash' = 'solid') => {
      const path = pts.map(conv).filter((q): q is [number, number] => q !== null);
      if (path.length < 2) return;
      out.push(new Graphic({ geometry: new Polyline({ paths: [path], spatialReference: sr }), symbol: this._line(c, a, w, style) }));
    };
    const mark = (at: MercXY, key: string, url: () => string, size: number, title?: string) => {
      const q = conv(at);
      if (!q) return;
      let s = this._syms.get(key);
      if (!s) {
        s = new PictureMarkerSymbol({ url: url(), width: size, height: size });
        this._syms.set(key, s);
      }
      out.push(new Graphic({ geometry: new Point({ x: q[0], y: q[1], spatialReference: sr }), symbol: s, attributes: title ? { title } : undefined }));
    };

    const r = p.route;
    if (r && r.stations.length >= 2) {
      const st = r.stations;
      // The worst score at each station, then runs of one colour band.
      const worst = new Float32Array(st.length);
      for (const s of r.stretches) {
        for (const x of st) if (x.chainM >= s.fromM && x.chainM <= s.toM && s.score > worst[x.i]) worst[x.i] = s.score;
      }
      const band = (v: number) => (v >= 70 ? 3 : v >= 50 ? 2 : v >= 30 ? 1 : 0);
      const colours: RGB[] = [GREY, MG_YELLOW, MG_ORANGE, MG_RED];
      line(st.map((s) => [s.x, s.y] as MercXY), [20, 24, 29], 0.55, 9);
      let i0 = 0;
      for (let i = 1; i <= st.length; i++) {
        if (i < st.length && band(worst[i]) === band(worst[i0])) continue;
        const b = band(worst[i0]);
        const pts = st.slice(i0, Math.min(st.length, i + 1)).map((s) => [s.x, s.y] as MercXY);
        if (b > 0) line(pts, colours[b], 0.9, 6);
        else line(pts, GREY, 0.7, 3);
        i0 = i;
      }
      for (const g of p.gaps ?? []) {
        const pts = st.filter((s) => s.chainM >= g.fromM && s.chainM <= g.toM).map((s) => [s.x, s.y] as MercXY);
        line(pts, GREY, 0.95, 2, 'short-dash');
      }
      // Overlooking ground: one triangle per stretch, with its line of sight to the road.
      const seenOv = new Set<string>();
      for (const s of st) {
        const o = s.overlook;
        if (!o) continue;
        const k = `${Math.round(o.x / 50)}|${Math.round(o.y / 50)}`;
        if (seenOv.has(k)) continue;
        seenOv.add(k);
        line([[o.x, o.y], [s.x, s.y]], VIOLET, 0.9, 1.4, 'dash');
        mark([o.x, o.y], 'tri', () => triUrl(VIOLET), 15, `Overlooks the Rd, ${Math.round(o.riseM)} m above`);
      }
      const marked = r.stretches
        .filter((s) => MARK[s.kind])
        .sort((a, b) => b.score - a.score)
        .slice(0, 80);
      for (const s of marked) {
        const m = MARK[s.kind]!;
        mark([s.x, s.y], `k-${s.kind}`, () => letter(m.t, m.c, m.shape, m.ink), 18, `${s.label}: ${s.why}`);
      }
    }
    for (const pk of p.pickets ?? []) {
      const st = r?.stations ?? [];
      const mid = (pk.coversFromM + pk.coversToM) / 2;
      const near = st.reduce<Station | null>((b, s) => (!b || Math.abs(s.chainM - mid) < Math.abs(b.chainM - mid) ? s : b), null);
      if (near) line([[pk.x, pk.y], [near.x, near.y]], BLUE, 0.8, 1.2, 'dash');
      mark([pk.x, pk.y], 'picket', () => letter('P', BLUE), 18, `Picket ${pk.side}`);
    }
    for (const cp of p.checkPosts ?? []) mark([cp.x, cp.y], 'cp', () => letter('CP', BLUE, 'square'), 20, cp.why);

    const c = p.cordon;
    if (c) {
      line([...c.outer, c.outer[0]], BLUE, 0.85, 1.6, 'dash');
      line([...c.ring, c.ring[0]], BLUE, 1, 3);
      for (const x of c.sideRoads) mark(x, 'side', () => crossUrl(MG_ORANGE), 12, 'Side road');
      for (const x of c.exits) mark(x, 'rb', () => letter('RB', MG_RED, 'square'), 20, 'Road block');
      for (const e of c.escapes) mark([e.x, e.y], 'esc', () => letter('E', MG_ORANGE), 16, `Escape route: ${e.why}`);
      for (const s of c.sensitive.slice(0, 40)) mark([s.x, s.y], 'k-sensitive', () => letter('S', PURPLE), 16, s.label);
      for (const h of c.hides) mark([h.x, h.y], 'hide', () => letter('H', BROWN, 'diamond'), 16, h.label);
    }
    for (const o of p.lane?.obstacles ?? []) mark([o.x, o.y], 'obs', () => crossUrl(MG_RED), 14, o.why);
    for (const l of p.lines ?? []) {
      if (l.style !== 'short-dash' && (l.w ?? 3) >= 3) line(l.pts, [20, 24, 29], 0.5, (l.w ?? 3) + 3);
      line(l.pts, l.c, l.a ?? 1, l.w ?? 3, l.style ?? 'solid');
    }
    for (const m of p.marks ?? []) mark(m.at, `m|${m.t}|${m.c}|${m.shape ?? 'circle'}`, () => letter(m.t, m.c, m.shape ?? 'circle'), m.size ?? (m.t.length > 1 ? 20 : 18), m.title);

    this._layer!.removeAll();
    this._layer!.addMany(out);
  }

  clear(): void {
    this._layer?.removeAll();
  }

  destroy(): void {
    this._detach();
    this._layer?.destroy();
    this._layer = null;
    this._syms.clear();
  }

  private _line(c: RGB, a: number, w: number, style: 'solid' | 'dash' | 'short-dash'): SimpleLineSymbol {
    const key = `l|${c}|${a}|${w}|${style}`;
    let s = this._syms.get(key);
    if (!s) {
      s = new SimpleLineSymbol({ color: [...c, a], width: w, style, cap: 'round', join: 'round' });
      this._syms.set(key, s);
    }
    return s;
  }

  private _converter(sr: any): Convert | null {
    if (sr.isWebMercator === true || [102100, 3857, 102113, 3785].includes(sr.wkid ?? sr.latestWkid)) return (p) => [p[0], p[1]];
    if (sr.isWGS84 === true || (sr.wkid ?? sr.latestWkid) === 4326) {
      return (p) => {
        const ll = webMercatorUtils.xyToLngLat(p[0], p[1]);
        return ll ? [ll[0], ll[1]] : null;
      };
    }
    return null;
  }

  private _ensure(map: any): void {
    if (!this._layer) {
      this._layer = new GraphicsLayer({ id: LAYER_ID, title: 'Movement Guide', listMode: 'hide', elevationInfo: { mode: 'on-the-ground' } });
    }
    if (this._map !== map) {
      this._detach();
      map.add(this._layer);
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
}
