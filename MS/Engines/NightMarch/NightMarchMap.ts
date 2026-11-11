/**
 * NightMarchMap.ts
 *
 * The night march chart on the map, on one ground-draped GraphicsLayer of its own (`ms-night-march`):
 *   - the enemy's sights round the objective: night sights (violet dashed ring) and thermal (fainter);
 *   - the route SP -> FUP, cased, with skylines (violet dashes), stretches seen from the objective (red) and hidden from
 *     it (green) when the terrain was read;
 *   - a label at each leg's middle: leg number, bearing (grid, and magnetic when the GMA is set) and paces;
 *   - numbered turns, the SP, check points on long legs (white ticks), halts (H), obstacles crossed (x);
 *   - the marking: a lamp at each light the party puts out (shaded to the rear), the FUP's tape, the places in it, the
 *     start line (thick white tape) and the axis tape to its end light, then the axis on to the objective (dotted);
 *   - the objective (diamond).
 * Every graphic carries its symbol (a symbol-less graphic is never drawn in a SceneView); markers and labels are
 * PictureMarkerSymbols so it shows in 2D and 3D. Colours: verdicts red / green / orange only, the enemy violet, lights
 * the warm token, the route the accent.
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
import { plOffset, type MercXY } from '../PlatoonGuide/PlatoonGuideRead';
import type { NightMarchChart } from './NightMarchRead';
import { brgText, type NmUnits } from './NightMarchText';

const LAYER_ID = 'ms-night-march';
type RGB = [number, number, number];
const ACCENT: RGB = [142, 193, 234];
const RED: RGB = [229, 72, 77];
const GREEN: RGB = [47, 168, 98];
const VIOLET: RGB = [167, 139, 250];
const LAMP: RGB = [255, 210, 122];
const WHITE: RGB = [241, 243, 246];
const DARK: RGB = [20, 24, 29];

const rgb = (c: RGB): string => `rgb(${c[0]},${c[1]},${c[2]})`;
const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const svgUrl = (w: number, h: number, body: string): string => Utils.svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);
const disc = (t: string, fill: RGB, ink = '#14181d'): string => {
  const fs = t.length > 2 ? 8 : t.length > 1 ? 9.5 : 11.5;
  return svgUrl(22, 22, `<circle cx="11" cy="11" r="9" fill="${rgb(fill)}" stroke="#14181d" stroke-width="1.6"/><text x="11" y="${11 + fs * 0.36}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="${fs}" fill="${ink}">${esc(t)}</text>`);
};
/** A lamp: a warm dot with a dark shade on its forward half (it shows only to the rear). */
const lamp = (): string => svgUrl(18, 18, `<circle cx="9" cy="9" r="6.5" fill="${rgb(LAMP)}" stroke="#14181d" stroke-width="1.5"/><circle cx="9" cy="9" r="2.4" fill="#fff"/>`);
const cross = (c: RGB): string => {
  const x = 'M5 5 L17 17 M17 5 L5 17';
  return svgUrl(22, 22, `<path d="${x}" stroke="#fff" stroke-opacity="0.9" stroke-width="6" stroke-linecap="round" fill="none"/><path d="${x}" stroke="${rgb(c)}" stroke-width="3" stroke-linecap="round" fill="none"/>`);
};
const diamond = (c: RGB, t: string): string =>
  svgUrl(30, 30, `<path d="M15 2 L28 15 L15 28 L2 15 Z" fill="${rgb(c)}" stroke="#14181d" stroke-width="1.8"/><text x="15" y="18.3" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="8.5" fill="#fff">${esc(t)}</text>`);
/** A dark plate with light text (the leg label): written to fit. */
function plate(text: string, accent: RGB): { url: string; w: number; h: number } {
  const w = Math.round(text.length * 6.3 + 16);
  const h = 20;
  const body = `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="5" fill="#14181d" fill-opacity="0.88" stroke="${rgb(accent)}" stroke-width="1.4"/><text x="${w / 2}" y="14" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="11" fill="#f1f3f6">${esc(text)}</text>`;
  return { url: svgUrl(w, h, body), w, h };
}

export interface NmMapShow {
  chart: NightMarchChart;
  units: NmUnits;
  rings: boolean;
  labels: boolean;
}

type Convert = (p: MercXY) => [number, number] | null;

export class NightMarchMap {
  private _layer: GraphicsLayer | null = null;
  private _map: any = null;
  private _syms = new Map<string, any>();
  private _waiting: NmMapShow | null = null;
  private _whenHooked = false;

  constructor(private readonly _getView: () => any) {}

  get layer(): GraphicsLayer | null {
    return this._layer;
  }

  show(p: NmMapShow): void {
    const view = this._getView?.();
    const sr = view?.spatialReference;
    if (view?.map && !sr && typeof view.when === 'function') {
      this._waiting = p;
      if (!this._whenHooked) {
        this._whenHooked = true;
        view
          .when(() => {
            this._whenHooked = false;
            const w = this._waiting;
            this._waiting = null;
            if (w && this._getView?.() === view) this.show(w);
          })
          .catch(() => {
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
    const fill = (ring: MercXY[], c: RGB, a: number, outline?: { c: RGB; a: number; w: number; style: 'solid' | 'dash' | 'short-dash' }) => {
      const r = ring.map(conv).filter((q): q is [number, number] => q !== null);
      if (r.length < 3) return;
      r.push(r[0]);
      out.push(new Graphic({ geometry: new Polygon({ rings: [r], spatialReference: sr }), symbol: this._fill(c, a, outline) }));
    };
    const mark = (at: MercXY, key: string, make: () => { url: string; w: number; h: number }, title?: string) => {
      const q = conv(at);
      if (!q) return;
      let s = this._syms.get(key);
      if (!s) {
        const m = make();
        s = new PictureMarkerSymbol({ url: m.url, width: m.w, height: m.h });
        this._syms.set(key, s);
      }
      out.push(new Graphic({ geometry: new Point({ x: q[0], y: q[1], spatialReference: sr }), symbol: s, attributes: title ? { title } : undefined }));
    };
    const sq = (url: string, px: number) => () => ({ url, w: px, h: px });

    const C = p.chart;
    const path = C.path;
    if (path.length < 2) {
      this._layer!.removeAll();
      return;
    }
    // 1. The enemy's sights round the objective.
    if (C.objective && C.sights && p.rings) {
      const ring = (r: number) => {
        const pts: MercXY[] = [];
        for (let i = 0; i <= 90; i++) pts.push(plOffset(C.objective!, i * 4, r));
        return pts;
      };
      line(ring(C.sights.thermal.radiusM), VIOLET, 0.45, 1.5, 'dash');
      fill(ring(C.sights.night.radiusM), VIOLET, 0.07);
      line(ring(C.sights.night.radiusM), DARK, 0.45, 3.5);
      line(ring(C.sights.night.radiusM), VIOLET, 0.95, 2, 'dash');
      mark(plOffset(C.objective, 0, C.sights.night.radiusM), `ring-n-${C.sights.night.radiusM}`, () => plate(`Night sights ${C.sights!.night.radiusM} m`, VIOLET), 'Enemy night sights');
      mark(plOffset(C.objective, 0, C.sights.thermal.radiusM), `ring-t-${C.sights.thermal.radiusM}`, () => plate(`Thermal ${(C.sights!.thermal.radiusM / 1000).toFixed(0)} km`, VIOLET), 'Enemy thermal sights');
    }

    // 2. The route, cased, with what the terrain said along it.
    line(path, DARK, 0.6, 8);
    line(path, ACCENT, 0.95, 3.5);
    const along = (fromM: number, toM: number): MercXY[] => {
      const pts: MercXY[] = [];
      for (const lg of C.legs) {
        const c0 = lg.cumM - lg.distM;
        const t0 = Math.max(0, (fromM - c0) / lg.distM), t1 = Math.min(1, (toM - c0) / lg.distM);
        if (t1 >= t0 && t1 >= 0 && t0 <= 1) {
          pts.push([lg.from[0] + (lg.to[0] - lg.from[0]) * t0, lg.from[1] + (lg.to[1] - lg.from[1]) * t0]);
          pts.push([lg.from[0] + (lg.to[0] - lg.from[0]) * t1, lg.from[1] + (lg.to[1] - lg.from[1]) * t1]);
        }
      }
      return pts;
    };
    for (const s of C.dead) line(along(s.fromM, Math.max(s.toM, s.fromM + 30)), GREEN, 0.85, 5.5);
    for (const s of C.exposed) line(along(s.fromM, Math.max(s.toM, s.fromM + 30)), RED, 0.85, 5.5);
    for (const s of C.skyline) line(along(s.fromM - 25, s.toM + 25), VIOLET, 1, 3, 'short-dash');
    // The column's way inside the night-sight ring: dotted white over the accent (silent from here).
    if (C.sights?.night.enterAtM !== null && C.sights?.night.enterAtM !== undefined) line(along(C.sights.night.enterAtM, C.lengthM), WHITE, 0.9, 1.6, 'dot');

    // 3. The FUP: tape, places, SL, axis tape, then the axis to the objective.
    const F = C.fup;
    if (C.objective) line([F.axisEnd, C.objective], WHITE, 0.55, 1.5, 'dot');
    fill(F.corners, C.fup.tone === 'bad' ? RED : C.fup.tone === 'warn' ? [238, 138, 31] : GREEN, 0.14, { c: WHITE, a: 0.95, w: 1.6, style: 'dash' });
    for (const s of F.slots) {
      fill(s.corners, WHITE, s.hq ? 0.22 : 0.08, { c: WHITE, a: 0.7, w: 1, style: 'solid' });
      if (p.labels) mark(s.at, `slot-${s.label}`, () => plate(s.label, WHITE), s.label);
    }
    line([F.sl[0], F.sl[1]], DARK, 0.7, 7);
    line([F.sl[0], F.sl[1]], WHITE, 1, 4);
    const slMid: MercXY = [(F.sl[0][0] + F.sl[1][0]) / 2, (F.sl[0][1] + F.sl[1][1]) / 2];
    line([slMid, F.axisEnd], WHITE, 0.95, 2.2, 'dash');
    if (p.labels) {
      const slAt = plOffset(slMid, F.axisDeg, 22);
      mark(slAt, `sl-${F.slFeature ?? ''}`, () => plate(F.slFeature ? `SL · ${F.slFeature}` : 'SL', WHITE), 'Start line');
      mark(plOffset(F.corners[0], F.axisDeg + 180, 26), 'fup-label', () => plate('FUP', WHITE), 'Forming-up place');
    }

    // 4. Points along the route: lamps, check points, halts, obstacles, turns, the SP.
    for (const l of C.lights) mark([l.x, l.y], 'lamp', () => ({ url: lamp(), w: 15, h: 15 }), `Light: ${l.label}`);
    for (const lg of C.legs) for (const c of lg.checkPts) mark([c.x, c.y], 'chk', sq(disc('✓', WHITE), 16), `Check point, leg ${lg.i} at ${Math.round(c.atM)} m`);
    C.timing.halts.forEach((h, i) => mark([h.x, h.y], `halt`, sq(disc('H', [255, 210, 122]), 20), `Halt ${i + 1}: ${h.min} min`));
    for (const ob of C.obstacles) mark([ob.x, ob.y], 'obs', () => ({ url: cross(RED), w: 18, h: 18 }), `Obs: ${ob.label}`);
    C.legs.forEach((lg) => {
      if (!lg.toFup) mark(lg.to, `turn-${lg.i}-${lg.tone}`, sq(disc(String(lg.i), lg.tone === 'ok' ? ACCENT : lg.tone === 'warn' ? [238, 138, 31] : RED), 22), `Turn ${lg.i}${lg.landmark ? `: ${lg.landmark.label}${lg.landmark.name ? ` ${lg.landmark.name}` : ''}` : ''}`);
    });
    mark(path[0], 'sp', sq(disc('SP', WHITE), 24), 'Start point');
    if (p.labels) {
      for (const lg of C.legs) {
        const mid: MercXY = [(lg.from[0] + lg.to[0]) / 2, (lg.from[1] + lg.to[1]) / 2];
        const t = `${lg.i} · ${brgText(lg.bearingDeg, lg.magDeg, p.units, true)} · ${lg.paces.toLocaleString('en-GB')} p`;
        mark(mid, `leg|${t}|${lg.tone}`, () => plate(t, lg.tone === 'ok' ? ACCENT : lg.tone === 'warn' ? [238, 138, 31] : RED), `Leg ${lg.i}`);
      }
    }
    if (C.objective) mark(C.objective, 'obj', () => ({ url: diamond(RED, 'OBJ'), w: 30, h: 30 }), 'Objective');

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
  private _fill(c: RGB, a: number, o?: { c: RGB; a: number; w: number; style: 'solid' | 'dash' | 'short-dash' }): SimpleFillSymbol {
    const key = `f|${c}|${a}|${o ? `${o.c}|${o.a}|${o.w}|${o.style}` : ''}`;
    let s = this._syms.get(key);
    if (!s) {
      s = new SimpleFillSymbol({ color: [...c, a], outline: o ? { color: [...o.c, o.a], width: o.w, style: o.style } : { color: [0, 0, 0, 0], width: 0 } });
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
    if (!this._layer) this._layer = new GraphicsLayer({ id: LAYER_ID, title: 'Night March', listMode: 'hide', elevationInfo: { mode: 'on-the-ground' } });
    if (this._map !== map) {
      this._detach();
      map.add(this._layer);
      this._map = map;
    }
  }
}
