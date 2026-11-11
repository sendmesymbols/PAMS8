/**
 * PlatoonGuideMap.ts
 *
 * The Platoon Guide on the map, on one ground-draped GraphicsLayer of its own (`ms-platoon-guide`):
 *   - the bubble (dashed ring) round the point read, and the point itself;
 *   - the visibility sketch on the ground: dead ground (red) and ground screened by crops, trees and buildings (amber);
 *   - a lettered marker on each answer, with a dashed leader from the point to the ones a commander walks to:
 *     W water, C better cover, H landing Gr, + hospital, K KM stone, PB patrol base, OP, RL relay;
 *   - dangers: M likely mine / IED, A likely ambush, V vulnerable point, B road block, a violet triangle on ground
 *     that looks down on the point, x hazards, a small diamond on each range card landmark, R1-R3 the resection set;
 *   - a patrol route card: the route, red where exposed, green where hidden from the threat, violet dashes on
 *     skylines, x on obstacles crossed, bounds (dots) and the final meeting point (F).
 * Graphics carry their symbols (a symbol-less graphic is never drawn in a SceneView); markers are PictureMarkerSymbols
 * so it shows in 2D and 3D.
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
import { plOffset, type MercXY, type PatrolCard, type PlReading, type PlSpot } from './PlatoonGuideRead';

const LAYER_ID = 'ms-platoon-guide';
type RGB = [number, number, number];
const RED: RGB = [229, 57, 53];
const ORANGE: RGB = [245, 124, 0];
const AMBER: RGB = [255, 179, 0];
const BLUE: RGB = [33, 150, 243];
const WATER: RGB = [41, 182, 246];
const GREEN: RGB = [67, 160, 71];
const BROWN: RGB = [141, 110, 99];
const VIOLET: RGB = [171, 71, 188];
const INDIGO: RGB = [126, 87, 194];
const WHITE: RGB = [236, 239, 241];
const DARK: RGB = [20, 24, 29];

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
const smallDiamond = (c: RGB): string => svg(`<path d="M11 5 L17 11 L11 17 L5 11 Z" fill="${rgb(c)}" stroke="#14181d" stroke-width="1.5"/>`);
const dotUrl = (c: RGB): string => svg(`<circle cx="11" cy="11" r="5" fill="${rgb(c)}" stroke="#fff" stroke-width="2"/>`);

const DANGER_MARK: Record<string, { t: string; c: RGB; shape?: 'circle' | 'square' | 'diamond' }> = {
  mine: { t: 'M', c: RED, shape: 'diamond' },
  ambush: { t: 'A', c: RED },
  vp: { t: 'V', c: ORANGE },
  block: { t: 'B', c: RED, shape: 'square' },
  rooftops: { t: 'R', c: VIOLET, shape: 'square' },
};

export interface PlMapShow {
  reading?: PlReading | null;
  patrol?: { card: PatrolCard; path: MercXY[] } | null;
  /** Draw the sight sketch (dead / screened ground). */
  sight?: boolean;
}

type Convert = (p: MercXY) => [number, number] | null;

export class PlatoonGuideMap {
  private _layer: GraphicsLayer | null = null;
  private _map: any = null;
  private _syms = new Map<string, any>();
  private _waiting: PlMapShow | null = null;
  private _whenHooked = false;

  constructor(private readonly _getView: () => any) {}

  get layer(): GraphicsLayer | null {
    return this._layer;
  }

  show(p: PlMapShow): void {
    const view = this._getView?.();
    const sr = view?.spatialReference;
    if (view?.map && !sr && typeof view.when === 'function') {
      // A view still loading (a SceneView before its first frame) has no spatial reference yet: draw once it is ready.
      this._waiting = p;
      if (!this._whenHooked) {
        this._whenHooked = true;
        view.when(() => {
          this._whenHooked = false;
          const w = this._waiting;
          this._waiting = null;
          if (w && this._getView?.() === view) this.show(w);
        }).catch(() => {
          this._whenHooked = false;
        });
      }
      return;
    }
    if (!view?.map || !sr) return;
    const conv = this._converter(sr);
    if (!conv) return;
    this._ensure(view.map);
    const out: Graphic[] = [];
    const line = (pts: MercXY[], c: RGB, a: number, w: number, style: 'solid' | 'dash' | 'short-dash' | 'dot' = 'solid') => {
      const path = pts.map(conv).filter((q): q is [number, number] => q !== null);
      if (path.length < 2) return;
      out.push(new Graphic({ geometry: new Polyline({ paths: [path], spatialReference: sr }), symbol: this._line(c, a, w, style) }));
    };
    const fill = (ring: MercXY[], c: RGB, a: number) => {
      const r = ring.map(conv).filter((q): q is [number, number] => q !== null);
      if (r.length < 3) return;
      r.push(r[0]);
      out.push(new Graphic({ geometry: new Polygon({ rings: [r], spatialReference: sr }), symbol: this._fill(c, a) }));
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
    const spotMark = (o: MercXY, s: PlSpot | null | undefined, t: string, c: RGB, shape: 'circle' | 'square' | 'diamond' = 'circle', leader = false) => {
      if (!s) return;
      const at: MercXY = [s.x, s.y];
      if (leader && s.distM > 20) line([o, at], c, 0.85, 1.5, 'dash');
      mark(at, `L|${t}|${c}|${shape}`, () => letter(t, c, shape), 20, `${s.label}${s.name ? ` ${s.name}` : ''}`);
    };

    const r = p.reading;
    if (r) {
      const o = r.at;
      const ring: MercXY[] = [];
      for (let i = 0; i <= 72; i++) ring.push(plOffset(o, i * 5, r.radiusM));
      line(ring, DARK, 0.5, 3.5);
      line(ring, BLUE, 0.9, 1.5, 'dash');
      const S = r.see;
      if (S && p.sight !== false) {
        const half = 180 / S.rays.length;
        for (const ray of S.rays) {
          let i = 0;
          while (i < ray.states.length) {
            const st = ray.states[i];
            let j = i;
            while (j + 1 < ray.states.length && ray.states[j + 1] === st) j++;
            if (st === 2 || st === 3) {
              const r0 = i * S.stepM, r1 = (j + 1) * S.stepM;
              const wedge: MercXY[] = [plOffset(o, ray.bearingDeg - half, r0), plOffset(o, ray.bearingDeg + half, r0), plOffset(o, ray.bearingDeg + half, r1), plOffset(o, ray.bearingDeg - half, r1)];
              // Light enough that the imagery under it still reads (in hills dead ground can be most of the bubble).
              fill(wedge, st === 3 ? RED : AMBER, st === 3 ? 0.2 : 0.16);
            }
            i = j + 1;
          }
        }
      }
      const H = r.here;
      spotMark(o, H.water.perennial && H.water.nearest && H.water.perennial.distM < H.water.nearest.distM * 3 ? H.water.perennial : H.water.nearest, 'W', WATER, 'circle', true);
      if (H.water.nearest && H.water.perennial && H.water.nearest !== H.water.perennial) spotMark(o, H.water.nearest, 'W', WATER);
      spotMark(o, H.betterCover ?? H.betterConcealment, 'C', BROWN, 'circle', true);
      spotMark(o, H.hls.ground && H.hls.ground.distM > 15 ? H.hls.ground : null, 'H', VIOLET, 'circle', true);
      spotMark(o, H.hls.recorded, 'H', VIOLET, 'square');
      spotMark(o, H.medical.hospital, '+', RED, 'square', H.medical.hospital ? H.medical.hospital.distM <= 5000 : false);
      spotMark(o, H.medical.bhu, '+', [239, 154, 154], 'square');
      spotMark(o, H.where.km, 'K', WHITE, 'square');
      if (H.waysOut.road) mark([H.waysOut.road.x, H.waysOut.road.y], 'dot|road', () => dotUrl([120, 144, 156]), 12, 'Nearest Rd / Tr');
      if (S) {
        for (const x of S.refs) mark([x.x, x.y], 'ref', () => smallDiamond(WHITE), 14, `${x.label}${x.name ? ` ${x.name}` : ''} (range card)`);
        S.resection.forEach((x, i) => mark([x.x, x.y], `res${i}`, () => letter(`R${i + 1}`, DARK, 'circle'), 20, `Resection ${i + 1}: ${x.label}`));
        for (const ov of S.overlook) {
          line([[ov.x, ov.y], o], VIOLET, 0.7, 1.2, 'short-dash');
          mark([ov.x, ov.y], 'ov', () => triUrl(VIOLET), 18, ov.why);
        }
        if (S.rooftops) spotMark(o, S.rooftops, 'R', VIOLET, 'square');
      }
      const D = r.danger;
      if (D) {
        // Road stretches overlooked by high ground stay in the panel's list: on the map a second kind of triangle
        // beside "ground that looks down on you" reads as the same thing.
        for (const s of D.spots) {
          const m = DANGER_MARK[s.kind];
          if (m) mark([s.x, s.y], `d|${s.kind}`, () => letter(m.t, m.c, m.shape ?? 'circle'), 20, `${s.label}: ${s.why ?? ''}`);
        }
        for (const h of D.hazards) mark([h.x, h.y], 'hz', () => crossUrl(BROWN), 16, h.label);
      }
      for (const f of r.help.friends.slice(0, 3)) spotMark(o, f, 'F', BLUE, 'square');
      spotMark(o, r.help.relay, 'RL', INDIGO, 'circle');
      if (r.stop) {
        spotMark(o, r.stop.harbour, 'PB', GREEN, 'square', true);
        spotMark(o, r.stop.op, 'OP', INDIGO, 'square', true);
      }
      mark(o, 'here', () => dotUrl(BLUE), 16, 'Point read');
    }

    const pc = p.patrol;
    if (pc && pc.path.length >= 2) {
      const card = pc.card;
      line(pc.path, DARK, 0.55, 7);
      line(pc.path, BLUE, 0.95, 3.5);
      const along = (fromM: number, toM: number): MercXY[] => {
        const pts: MercXY[] = [];
        let chain = 0;
        for (let i = 0; i + 1 < pc.path.length; i++) {
          const a = pc.path[i], b = pc.path[i + 1];
          const L = card.legs[i]?.distM ?? 0;
          if (L <= 0) continue;
          const t0 = Math.max(0, (fromM - chain) / L), t1 = Math.min(1, (toM - chain) / L);
          if (t1 >= t0 && t1 >= 0 && t0 <= 1) {
            pts.push([a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0]);
            pts.push([a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1]);
          }
          chain += L;
        }
        return pts;
      };
      for (const s of card.exposed) line(along(s.fromM, Math.max(s.toM, s.fromM + 30)), RED, 0.9, 5);
      for (const s of card.dead) line(along(s.fromM, Math.max(s.toM, s.fromM + 30)), GREEN, 0.9, 5);
      for (const s of card.skyline) line(along(s.fromM - 25, s.toM + 25), VIOLET, 1, 3, 'short-dash');
      for (const ob of card.obstacles) mark([ob.x, ob.y], 'obs', () => crossUrl(RED), 18, `Obs: ${ob.label}`);
      for (const bd of card.bounds) mark([bd.x, bd.y], 'bound', () => dotUrl(WHITE), 12, `Bound at ${Math.round(bd.chainM)} m`);
      if (card.fmp) mark([card.fmp.x, card.fmp.y], 'fmp', () => letter('F', GREEN, 'circle'), 20, 'Final meeting point');
      card.legs.forEach((l) => mark(l.to, `leg${l.i}`, () => letter(String(l.i), BLUE, 'circle'), 18, `End of leg ${l.i}`));
    }

    this._layer!.removeAll();
    this._layer!.addMany(out);
  }

  clear(): void {
    this._waiting = null;
    this._layer?.removeAll();
  }

  destroy(): void {
    this._detach();
    this._layer?.destroy();
    this._layer = null;
    this._syms.clear();
  }

  private _detach(): void {
    if (this._layer && this._map) {
      try {
        this._map.remove(this._layer);
      } catch {
        /* the map is already gone */
      }
    }
    this._map = null;
  }

  private _line(c: RGB, a: number, w: number, style: 'solid' | 'dash' | 'short-dash' | 'dot'): SimpleLineSymbol {
    const key = `l|${c}|${a}|${w}|${style}`;
    let s = this._syms.get(key);
    if (!s) {
      s = new SimpleLineSymbol({ color: [...c, a], width: w, style, cap: 'round', join: 'round' });
      this._syms.set(key, s);
    }
    return s;
  }
  private _fill(c: RGB, a: number): SimpleFillSymbol {
    const key = `f|${c}|${a}`;
    let s = this._syms.get(key);
    if (!s) {
      s = new SimpleFillSymbol({ color: [...c, a], outline: { color: [0, 0, 0, 0], width: 0 } });
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
      this._layer = new GraphicsLayer({ id: LAYER_ID, title: 'Platoon Guide', listMode: 'hide', elevationInfo: { mode: 'on-the-ground' } });
    }
    if (this._map !== map) {
      this._detach();
      map.add(this._layer);
      this._map = map;
    }
  }
}
