/**
 * PlatoonGuideMap.ts
 *
 * The Platoon Guide on the map, on one ground-draped GraphicsLayer of its own (`ms-platoon-guide`):
 *   - the search radius (the bubble) as a dotted ring round the point read, its distance on it, and the point itself;
 *   - the visibility sketch on the ground: dead ground (red) and ground screened by crops, trees and buildings (amber);
 *   - a marker on each answer: the halo's disc and glyph with its short word under it (user, 2026-11-13: "2-3 chars can
 *     tell users about it on map"; water a drop, hospital a cross, OP the OP sign, help a lifebuoy, BUA a building):
 *     Wtr, Cov better cover, HLS, Hosp / BHU, KM stone, BUA, Pol / Post / BOP / Fort / Cantt (help), RL relay, PB
 *     patrol base, OP; a dashed leader from the point to the ones a commander walks to;
 *   - dangers: IED likely mine, Amb likely ambush, VP vulnerable point, RB road block (ringed when strong), HG ground
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
import { SURFACE } from '../GroundGuide/GroundGuideTokens';
import { dangerGlyph, glyph, GLYPH_CODE, helpCode, type GlyphKind } from './PlatoonGuideRadar';
import { plOffset, type MercXY, type PatrolCard, type PlReading, type PlSpot } from './PlatoonGuideRead';
import { dist, ECHELON_WORD } from './PlatoonGuideText';

const LAYER_ID = 'ms-platoon-guide';
type RGB = [number, number, number];
const RED: RGB = [229, 57, 53];
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
const smallDiamond = (c: RGB): string => svg(`<path d="M11 5 L17 11 L11 17 L5 11 Z" fill="${rgb(c)}" stroke="#14181d" stroke-width="1.5"/>`);
/** A map pin whose tip is the picture's centre (markers are centred on their point). */
const pinUrl = (): string =>
  svg('<path d="M11 11C9.6 8.8 7.1 6.7 7.1 4.6A3.9 3.9 0 0 1 14.9 4.6C14.9 6.7 12.4 8.8 11 11Z" fill="#ffd27a" stroke="#14181d" stroke-width="0.9"/><circle cx="11" cy="4.6" r="1.5" fill="#14181d"/><circle cx="11" cy="11" r="1.1" fill="#14181d"/>');
const dotUrl = (c: RGB): string => svg(`<circle cx="11" cy="11" r="5" fill="${rgb(c)}" stroke="#fff" stroke-width="2"/>`);

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Points per picture unit for the icon markers (the disc is 22 units: ~24 px on screen). */
const ICON_PT = 0.82;
const svgNode = (tag: string, attrs: Record<string, string | number>, parent: Element, text?: string): Element => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
};
/** An icon marker: the halo's dark disc with its glyph and the short word under it. The picture is as tall above the
 *  disc as the word makes it below, so the disc sits on the point in 2D and 3D without offsets. */
function iconMarker(kind: GlyphKind, code: string, ring: string | null): { url: string; w: number; h: number } {
  const D = 11, capH = 13;
  const capW = Math.ceil(code.length * 6.6 + 10);
  const W = Math.max(2 * D + 8, capW + 2);
  const H = 2 * (D + 3 + capH);
  const cx = W / 2, cy = H / 2;
  const root = document.createElementNS(SVG_NS, 'svg');
  root.setAttribute('xmlns', SVG_NS);
  root.setAttribute('width', String(W));
  root.setAttribute('height', String(H));
  root.setAttribute('viewBox', `0 0 ${W} ${H}`);
  if (ring) svgNode('circle', { cx, cy, r: D + 2.6, fill: 'none', stroke: ring, 'stroke-width': 2.4 }, root);
  svgNode('circle', { cx, cy, r: D, fill: SURFACE.ring, stroke: ring ?? '#ffffff', 'stroke-opacity': ring ? 1 : 0.8, 'stroke-width': 1.4 }, root);
  glyph(root, kind, cx, cy, 5.6);
  const ty = cy + D + 3;
  svgNode('rect', { x: cx - capW / 2, y: ty, width: capW, height: capH, rx: 6.5, fill: SURFACE.ring, 'fill-opacity': 0.9, stroke: '#ffffff', 'stroke-opacity': 0.35 }, root);
  svgNode('text', { x: cx, y: ty + 9.6, 'text-anchor': 'middle', 'font-family': 'Arial, sans-serif', 'font-weight': 700, 'font-size': 10, fill: '#ffffff' }, root, code);
  return { url: Utils.svgToDataUrl(new XMLSerializer().serializeToString(root)), w: W * ICON_PT, h: H * ICON_PT };
}
/** A word on the map in a dark pill (the search radius on its ring). */
function wordPill(text: string, color: string): { url: string; w: number; h: number } {
  const W = Math.ceil(text.length * 6.4 + 16), H = 17;
  const root = document.createElementNS(SVG_NS, 'svg');
  root.setAttribute('xmlns', SVG_NS);
  root.setAttribute('width', String(W));
  root.setAttribute('height', String(H));
  root.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svgNode('rect', { x: 0.7, y: 0.7, width: W - 1.4, height: H - 1.4, rx: 8, fill: SURFACE.ring, 'fill-opacity': 0.88, stroke: color, 'stroke-width': 1.2 }, root);
  svgNode('text', { x: W / 2, y: 12.2, 'text-anchor': 'middle', 'font-family': 'Arial, sans-serif', 'font-weight': 700, 'font-size': 10.5, fill: '#ffffff' }, root, text);
  return { url: Utils.svgToDataUrl(new XMLSerializer().serializeToString(root)), w: W * ICON_PT, h: H * ICON_PT };
}
const STRONG_RING = 'rgb(229,72,77)';
const SEARCH: RGB = [144, 202, 249];

export interface PlMapShow {
  reading?: PlReading | null;
  patrol?: { card: PatrolCard; path: MercXY[] } | null;
  /** Draw the sight sketch (dead / screened ground). */
  sight?: boolean;
  /** The reading is pinned (A, or the pointer on the Pl Guide bar): a pin marks the point read. */
  pin?: boolean;
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
    const iconMark = (at: MercXY, kind: GlyphKind, code: string, title: string, ring: string | null = null) => {
      const q = conv(at);
      if (!q) return;
      const key = `I|${kind}|${code}|${ring ?? ''}`;
      let sy = this._syms.get(key);
      if (!sy) {
        const m = iconMarker(kind, code, ring);
        sy = new PictureMarkerSymbol({ url: m.url, width: m.w, height: m.h });
        this._syms.set(key, sy);
      }
      out.push(new Graphic({ geometry: new Point({ x: q[0], y: q[1], spatialReference: sr }), symbol: sy, attributes: { title } }));
    };
    const spotIcon = (o: MercXY, s: PlSpot | null | undefined, kind: GlyphKind, code: string, leader: RGB | null = null, ring: string | null = null) => {
      if (!s) return;
      const at: MercXY = [s.x, s.y];
      if (leader && s.distM > 20) line([o, at], leader, 0.85, 1.5, 'dash');
      iconMark(at, kind, code, `${s.label}${s.name ? ` ${s.name}` : ''}`, ring);
    };

    const r = p.reading;
    if (r) {
      const o = r.at;
      const ring: MercXY[] = [];
      for (let i = 0; i <= 120; i++) ring.push(plOffset(o, i * 3, r.radiusM));
      // The search radius: a dotted ring on a dark bed (it reads on any imagery), its distance at its foot.
      line(ring, DARK, 0.5, 4.5);
      line(ring, SEARCH, 1, 2.6, 'dot');
      const foot = conv(plOffset(o, 180, r.radiusM));
      if (foot) {
        const word = `${ECHELON_WORD[r.echelon] ?? 'Pl'} search ${dist(r.radiusM)}`;
        const key = `W|${word}`;
        let sy = this._syms.get(key);
        if (!sy) {
          const m = wordPill(word, rgb(SEARCH));
          sy = new PictureMarkerSymbol({ url: m.url, width: m.w, height: m.h });
          this._syms.set(key, sy);
        }
        out.push(new Graphic({ geometry: new Point({ x: foot[0], y: foot[1], spatialReference: sr }), symbol: sy, attributes: { title: 'How far round the point the Pl Guide reads' } }));
      }
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
      if (H.waysOut.road) mark([H.waysOut.road.x, H.waysOut.road.y], 'dot|road', () => dotUrl([120, 144, 156]), 12, 'Nearest Rd / Tr');
      if (S) {
        for (const x of S.refs) mark([x.x, x.y], 'ref', () => smallDiamond(WHITE), 14, `${x.label}${x.name ? ` ${x.name}` : ''} (range card)`);
        S.resection.forEach((x, i) => mark([x.x, x.y], `res${i}`, () => letter(`R${i + 1}`, DARK, 'circle'), 20, `Resection ${i + 1}: ${x.label}`));
        for (const ov of S.overlook) {
          line([[ov.x, ov.y], o], VIOLET, 0.7, 1.2, 'short-dash');
          iconMark([ov.x, ov.y], 'overlook', GLYPH_CODE.overlook, ov.why ?? 'Gr that looks down on the point');
        }
        if (S.rooftops) spotIcon(o, S.rooftops, 'overlook', 'Roof');
      }
      const D = r.danger;
      if (D) {
        // Road stretches overlooked by high ground stay in the panel's list: on the map a second kind of mark beside
        // "ground that looks down on you" reads as the same thing.
        for (const sp of D.spots) {
          const g = sp.kind === 'rooftops' ? null : dangerGlyph(sp.kind);
          if (g && g !== 'overlook') iconMark([sp.x, sp.y], g, GLYPH_CODE[g], `${sp.label}: ${sp.why ?? ''}`, (sp.score ?? 0) >= 70 ? STRONG_RING : null);
        }
        for (const h of D.hazards) mark([h.x, h.y], 'hz', () => crossUrl(BROWN), 16, h.label);
      }
      // The answers, the far ones first so the near ones sit on top.
      for (const f of r.help.friends.slice(0, 3).reverse()) spotIcon(o, f, 'help', helpCode(f.kind));
      spotIcon(o, r.help.relay, 'relay', GLYPH_CODE.relay);
      spotIcon(o, H.medical.bhu, 'hospital', 'BHU');
      spotIcon(o, H.medical.hospital, 'hospital', GLYPH_CODE.hospital, H.medical.hospital && H.medical.hospital.distM <= 5000 ? RED : null);
      spotIcon(o, r.people.bua, 'bua', GLYPH_CODE.bua);
      spotIcon(o, H.where.km, 'km', GLYPH_CODE.km);
      spotIcon(o, H.hls.recorded, 'hls', GLYPH_CODE.hls);
      spotIcon(o, H.hls.ground && H.hls.ground.distM > 15 ? H.hls.ground : null, 'hls', GLYPH_CODE.hls, VIOLET);
      spotIcon(o, H.betterCover ?? H.betterConcealment, 'cover', GLYPH_CODE.cover, BROWN);
      if (H.water.nearest && H.water.perennial && H.water.nearest !== H.water.perennial) spotIcon(o, H.water.nearest, 'water', GLYPH_CODE.water);
      spotIcon(o, H.water.perennial && H.water.nearest && H.water.perennial.distM < H.water.nearest.distM * 3 ? H.water.perennial : H.water.nearest, 'water', GLYPH_CODE.water, WATER);
      if (r.stop) {
        spotIcon(o, r.stop.op, 'op', GLYPH_CODE.op, INDIGO);
        spotIcon(o, r.stop.harbour, 'harbour', GLYPH_CODE.harbour, GREEN);
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

    if (p.pin && r) mark(r.at, 'PIN', pinUrl, 44, 'Pinned: the Pl Guide reads here until Esc');
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
