/**
 * MovePlannerMap.ts
 *
 * The Move Planner on the map, on two GraphicsLayers of its own:
 *   `ms-move-planner`       the plan: routes in their colours (cased), SP / Rel P / CP plates, halts (SH white square,
 *                           LH circle, harbour orange diamond, close-up blue), crossing waits (red X with who waits),
 *                           DI peace locations joined to the SP (dashed), assembly areas (checked against their size),
 *                           rail stations and the rail line, enemy stations with their arrows;
 *   `ms-move-planner-time`  the timeline: each serial's column from tail to head at the chosen time, its head marked.
 * Markers and labels are PictureMarkerSymbols so the layer shows in 2D and 3D.
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
import { mkPath, pointAtS, slicePath, type LngLat } from './MoveGeo';
import { positionAt } from './MoveRoad';
import { dtg, durText } from './MoveTime';
import type { MvPlanDoc, MvResult } from './MovePlannerModel';

const LAYER = 'ms-move-planner';
const TIME_LAYER = 'ms-move-planner-time';
type RGB = [number, number, number];

const esc = (s: string): string => Utils.escapeHtml(s);
const svgUrl = (w: number, h: number, body: string): string => Utils.svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);
function hexRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 216, 77];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function plate(text: string, color: string, dark = true): { url: string; w: number; h: number } {
  const t = text.length > 34 ? text.slice(0, 33) + '…' : text;
  const w = Math.round(t.length * 6.4 + 18);
  const h = 20;
  const body = `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="5" fill="${dark ? '#14181d' : color}" fill-opacity="0.9" stroke="${color}" stroke-width="1.6"/><text x="${w / 2}" y="14" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="11" fill="${dark ? '#f1f3f6' : '#14181d'}">${esc(t)}</text>`;
  return { url: svgUrl(w, h, body), w, h };
}
const marker = {
  SH: () => svgUrl(14, 14, '<rect x="2" y="2" width="10" height="10" fill="#fff" stroke="#14181d" stroke-width="1.6"/>'),
  LH: () => svgUrl(16, 16, '<circle cx="8" cy="8" r="6" fill="#fff" stroke="#14181d" stroke-width="1.6"/><circle cx="8" cy="8" r="2" fill="#14181d"/>'),
  DLH: () => svgUrl(20, 20, '<path d="M10 1 L19 10 L10 19 L1 10 Z" fill="#ee8a1f" stroke="#14181d" stroke-width="1.6"/><text x="10" y="13.5" text-anchor="middle" font-family="Arial" font-weight="700" font-size="9" fill="#14181d">H</text>'),
  DC: () => svgUrl(16, 16, '<circle cx="8" cy="8" r="6" fill="#8ec1ea" stroke="#14181d" stroke-width="1.6"/>'),
  X: () => {
    const p = 'M4 4 L16 16 M16 4 L4 16';
    return svgUrl(20, 20, `<path d="${p}" stroke="#fff" stroke-width="6" stroke-linecap="round"/><path d="${p}" stroke="#e5484d" stroke-width="3" stroke-linecap="round"/>`);
  },
  station: (c: string) => svgUrl(22, 22, `<rect x="3" y="3" width="16" height="16" rx="3" fill="${c}" stroke="#14181d" stroke-width="1.8"/><path d="M7 15 L15 15 M8 7 L14 7 L14 13 L8 13 Z" stroke="#14181d" stroke-width="1.6" fill="none"/>`),
  head: (c: string) => svgUrl(22, 22, `<circle cx="11" cy="11" r="8" fill="${c}" stroke="#14181d" stroke-width="2"/><path d="M8 11 L14 11 M11 8 L14 11 L11 14" stroke="#14181d" stroke-width="2" fill="none"/>`),
  dot: (c: string) => svgUrl(14, 14, `<circle cx="7" cy="7" r="5" fill="${c}" stroke="#14181d" stroke-width="1.6"/>`),
};

export class MovePlannerMap {
  private _layer: GraphicsLayer | null = null;
  private _time: GraphicsLayer | null = null;
  private _getView: () => any;
  constructor(getView: () => any) {
    this._getView = getView;
  }

  private _ensure(): { view: any; layer: GraphicsLayer; time: GraphicsLayer } | null {
    const view = this._getView();
    const map = view?.map;
    if (!map) return null;
    const is3d = view.type === '3d';
    if (!this._layer || !map.findLayerById(LAYER)) {
      this._layer = (map.findLayerById(LAYER) as GraphicsLayer) ?? new GraphicsLayer({ id: LAYER, title: 'Move Planner', listMode: 'hide', ...(is3d ? { elevationInfo: { mode: 'on-the-ground' } } : {}) } as any);
      if (!map.findLayerById(LAYER)) map.add(this._layer);
    }
    if (!this._time || !map.findLayerById(TIME_LAYER)) {
      this._time = (map.findLayerById(TIME_LAYER) as GraphicsLayer) ?? new GraphicsLayer({ id: TIME_LAYER, title: 'Move Planner (time)', listMode: 'hide', ...(is3d ? { elevationInfo: { mode: 'on-the-ground' } } : {}) } as any);
      if (!map.findLayerById(TIME_LAYER)) map.add(this._time);
    }
    return { view, layer: this._layer!, time: this._time! };
  }

  private _sr(view: any): { merc: boolean; sr: any } {
    const sr = view?.spatialReference;
    return { merc: !!sr?.isWebMercator, sr: sr?.isWebMercator ? { wkid: 102100 } : { wkid: 4326 } };
  }
  private _xy(merc: boolean, p: LngLat): [number, number] {
    return merc ? (webMercatorUtils.lngLatToXY(p[0], p[1]) as [number, number]) : [p[0], p[1]];
  }
  private _pt(view: any, p: LngLat): Point {
    const { merc, sr } = this._sr(view);
    const [x, y] = this._xy(merc, p);
    return new Point({ x, y, spatialReference: sr });
  }
  private _line(view: any, pts: LngLat[]): Polyline {
    const { merc, sr } = this._sr(view);
    return new Polyline({ paths: [pts.map((p) => this._xy(merc, p))], spatialReference: sr });
  }
  private _poly(view: any, ring: LngLat[]): Polygon {
    const { merc, sr } = this._sr(view);
    const r = ring.map((p) => this._xy(merc, p));
    r.push(r[0]);
    return new Polygon({ rings: [r], spatialReference: sr });
  }
  private _pic(view: any, at: LngLat, url: string, w: number, h: number, attrs: any = {}, yoff = 0): Graphic {
    return new Graphic({ geometry: this._pt(view, at), symbol: new PictureMarkerSymbol({ url, width: `${w}px`, height: `${h}px`, yoffset: yoff }) as any, attributes: attrs });
  }

  clear(): void {
    this._layer?.removeAll();
    this._time?.removeAll();
  }

  destroy(): void {
    const map = this._getView()?.map;
    for (const l of [this._layer, this._time]) if (l && map?.findLayerById(l.id)) map.remove(l);
    this._layer = null;
    this._time = null;
  }

  /** Draw the plan and its results. `labels` adds the names and the halts' times. */
  draw(plan: MvPlanDoc, res: MvResult | null, opts: { labels: boolean; halts: boolean; selected?: string | null }): void {
    const e = this._ensure();
    if (!e) return;
    const { view, layer } = e;
    layer.removeAll();
    const gs: Graphic[] = [];
    const used = new Set<string>();
    if (plan.kind === 'rail') {
      const rr = plan.routes.find((r) => r.id === plan.rail.routeId);
      if (rr) used.add(rr.id);
    } else if (plan.kind === 'enemy') {
      for (const f of plan.enemy) if (f.routeId) used.add(f.routeId);
    } else for (const s of plan.serials) if (s.routeId) used.add(s.routeId);
    // routes
    for (const r of plan.routes) {
      if (r.pts.length < 2) continue;
      const c = hexRgb(r.color);
      const inUse = used.has(r.id) || !plan.serials.length;
      const g = this._line(view, r.pts);
      gs.push(new Graphic({ geometry: g, symbol: new SimpleLineSymbol({ color: [20, 24, 29, inUse ? 0.85 : 0.5], width: inUse ? 7 : 4.5, cap: 'round', join: 'round' }) as any }));
      gs.push(new Graphic({ geometry: g, symbol: new SimpleLineSymbol({ color: [...c, inUse ? 1 : 0.55], width: inUse ? 4 : 2.5, cap: 'round', join: 'round', style: r.source === 'straight' ? 'dash' : 'solid' }) as any, attributes: { mvRoute: r.id } }));
      if (opts.labels) {
        const a = plate(r.sp || 'SP', r.color, false);
        gs.push(this._pic(view, r.pts[0], a.url, a.w, a.h, {}, 14));
        const b = plate(r.rp || 'Rel P', r.color, false);
        gs.push(this._pic(view, r.pts[r.pts.length - 1], b.url, b.w, b.h, {}, 14));
        const P = mkPath(r.pts);
        const mid = pointAtS(P, P.length / 2);
        const nm = plate(r.name, r.color);
        gs.push(this._pic(view, mid, nm.url, nm.w, nm.h, {}, -14));
      }
      gs.push(this._pic(view, r.pts[0], marker.dot(r.color), 14, 14));
      gs.push(this._pic(view, r.pts[r.pts.length - 1], marker.dot(r.color), 14, 14));
      for (const cp of r.cps) {
        const p = plate(cp.name, r.color);
        gs.push(this._pic(view, cp.at, marker.dot('#ffffff'), 12, 12));
        if (opts.labels) gs.push(this._pic(view, cp.at, p.url, p.w, p.h, {}, 14));
      }
    }
    // serial results
    if (res && (plan.kind === 'road' || plan.kind === 'assy' || plan.kind === 'di')) {
      for (const s of res.serials) {
        const dim = opts.selected && opts.selected !== s.doc.id;
        if (s.doc.dl && s.route.pts.length) {
          gs.push(new Graphic({ geometry: this._line(view, [s.doc.dl, s.route.pts[0]]), symbol: new SimpleLineSymbol({ color: [...hexRgb(s.color), 0.8], width: 2, style: 'short-dash' }) as any }));
          gs.push(this._pic(view, s.doc.dl, marker.dot(s.color), 14, 14));
          if (opts.labels) {
            const p = plate(`${s.doc.name} DL`, s.color);
            gs.push(this._pic(view, s.doc.dl, p.url, p.w, p.h, {}, 14));
          }
        }
        if (opts.halts && !dim) {
          for (const st of s.run.stops) {
            if (st.kind === 'X') continue;
            const url = marker[st.kind as 'SH' | 'LH' | 'DLH' | 'DC']();
            const sz = st.kind === 'DLH' ? 20 : st.kind === 'LH' || st.kind === 'DC' ? 16 : 14;
            gs.push(this._pic(view, st.at, url, sz, sz, { mvStop: `${s.doc.name} ${st.label} ${dtg(res.clock, st.t0)}-${dtg(res.clock, st.t1)}` }));
            if (opts.labels && st.kind === 'DLH') {
              const p = plate(`${s.doc.name} harbour ${dtg(res.clock, st.t0)} - ${dtg(res.clock, st.t1)}`, '#ee8a1f');
              gs.push(this._pic(view, st.at, p.url, p.w, p.h, {}, -16));
            }
          }
        }
      }
      for (const c of res.sched?.conflicts ?? []) {
        gs.push(this._pic(view, c.at, marker.X(), 20, 20));
        if (opts.labels) {
          const lo = plan.serials.find((x) => x.id === c.loser)?.name ?? '';
          const p = plate(`${lo} waits ${durText(c.waitMin)}`, '#e5484d');
          gs.push(this._pic(view, c.at, p.url, p.w, p.h, {}, -16));
        }
      }
      for (const s of plan.serials) {
        if (!s.assyArea || s.assyArea.length < 3) continue;
        const chk = res.assy?.space.find((x) => x.id === s.id);
        const col: RGB = chk?.tone === 'bad' ? [229, 72, 77] : chk?.tone === 'ok' ? [47, 168, 98] : [238, 138, 31];
        gs.push(new Graphic({ geometry: this._poly(view, s.assyArea), symbol: new SimpleFillSymbol({ color: [...col, 0.12], outline: { color: [...col, 1], width: 2, style: 'dash' } }) as any }));
        if (opts.labels) {
          const cx: LngLat = [s.assyArea.reduce((m, p) => m + p[0], 0) / s.assyArea.length, s.assyArea.reduce((m, p) => m + p[1], 0) / s.assyArea.length];
          const p = plate(`Assy ${s.fmn || s.name}${chk ? `: ${chk.text}` : ''}`, `rgb(${col.join(',')})`);
          gs.push(this._pic(view, cx, p.url, p.w, p.h));
        }
      }
    }
    // stations
    const station = (at: LngLat | null, name: string, col: string) => {
      if (!at) return;
      gs.push(this._pic(view, at, marker.station(col), 22, 22));
      if (opts.labels && name) {
        const p = plate(name, col);
        gs.push(this._pic(view, at, p.url, p.w, p.h, {}, 18));
      }
    };
    if (plan.kind === 'rail') {
      const rr = plan.routes.find((r) => r.id === plan.rail.routeId);
      if (!rr && plan.rail.eAt && plan.rail.dAt) gs.push(new Graphic({ geometry: this._line(view, [plan.rail.eAt, plan.rail.dAt]), symbol: new SimpleLineSymbol({ color: [142, 193, 234, 0.9], width: 3, style: 'dash' }) as any }));
      station(plan.rail.eAt, plan.rail.eSta ? `E.Sta ${plan.rail.eSta}` : 'E.Sta', '#8ec1ea');
      station(plan.rail.dAt, plan.rail.dSta ? `D.Sta ${plan.rail.dSta}` : 'D.Sta', '#8ec1ea');
    }
    if (plan.kind === 'enemy') {
      for (const f of plan.enemy) {
        if (f.mode !== 'rail') continue;
        if (f.eAt && f.dAt) gs.push(new Graphic({ geometry: this._line(view, [f.eAt, f.dAt]), symbol: new SimpleLineSymbol({ color: [229, 72, 77, 0.85], width: 2.5, style: 'dash', marker: { style: 'arrow', placement: 'end', color: [229, 72, 77] } as any }) as any }));
        station(f.eAt, f.eSta ? `${f.name}: ${f.eSta}` : f.name, '#e5484d');
        station(f.dAt, f.dSta, '#e5484d');
      }
    }
    layer.addMany(gs);
  }

  /** The columns on the road at time `t`: tail to head along the route, the head marked. */
  drawTime(res: MvResult | null, t: number | null): void {
    const e = this._ensure();
    if (!e) return;
    const { view, time } = e;
    time.removeAll();
    if (!res || t === null) return;
    const gs: Graphic[] = [];
    const runs = [...res.serials.map((s) => ({ run: s.run, color: s.color, name: s.doc.name })), ...(res.enemy?.road ?? []).map((x) => ({ run: x.run, color: '#e5484d', name: x.doc.name }))];
    for (const x of runs) {
      const p = positionAt(x.run, t);
      const L = x.run.lengthM;
      const h = Math.max(0, Math.min(L, p.head)), tl = Math.max(0, Math.min(L, p.tail));
      if (p.state === 'after' && tl >= L - 1) continue;
      if (p.state === 'before' && h <= 0) continue;
      const col = hexRgb(x.color);
      if (h - tl > 1) {
        const g = this._line(view, slicePath(x.run.path, tl, h));
        gs.push(new Graphic({ geometry: g, symbol: new SimpleLineSymbol({ color: [255, 255, 255, 0.95], width: 11, cap: 'round' }) as any }));
        gs.push(new Graphic({ geometry: g, symbol: new SimpleLineSymbol({ color: [...col, 1], width: 7, cap: 'round' }) as any }));
      }
      const at = pointAtS(x.run.path, h);
      gs.push(this._pic(view, at, marker.head(x.color), 22, 22));
      const pl = plate(`${x.name}${p.state === 'halted' ? ' (halted)' : ''}`, x.color);
      gs.push(this._pic(view, at, pl.url, pl.w, pl.h, {}, 18));
    }
    time.addMany(gs);
  }
}
