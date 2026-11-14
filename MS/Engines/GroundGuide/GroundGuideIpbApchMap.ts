/**
 * GroundGuideIpbApchMap.ts
 *
 * Draws the Extended View's IPB avenues of approach (GroundGuideIpbCorridors.ts) on the map, one ground-draped layer
 * just above the IPB coding and under every symbol layer:
 *   - each avenue as the MS open-back attack arrow (MainAttack.ts shape): the best going solid with the inner line in its
 *     head (main attack), the others dashed (supporting attack); red for the enemy's, blue for own;
 *   - the two corridors inside each avenue as fine white dashes (`extended.ipb.mapCorridors`), a lone corridor as a grey
 *     dashed line;
 *   - narrows as amber diamonds, crossovers as a white dashed line across, the area read as a thin dashed outline;
 *   - labels (`extended.ipb.labels`; user, 2026-11-14: "label every line and circle"): `auto` a short label on every line,
 *     circle and box (the area read, avenues, corridors, crossovers, narrows, fire ranges and the fire along each avenue,
 *     NAIs / TAIs / DPs, air avenues, LZ / DZ, AD reach, OP lines, the template's elements and moves), `all` adds details
 *     (times, obstructions), `off` none.
 * Markers and labels are PictureMarkerSymbols so they show in a SceneView too. The layer is rebuilt when the reading
 * changes (once per area), not on every mouse move.
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
import type { IpbApchView, MercXY } from './GroundGuideTypes';

const LAYER_ID = 'ms-ground-guide-ipb-apch';
type RGB = [number, number, number];
const ENEMY: RGB = [255, 90, 96];
const OWN: RGB = [142, 193, 234];
const LONE: RGB = [170, 178, 186];
const MC: RGB = [255, 255, 255];
const NARROWS: RGB = [255, 176, 46];
const CROSS: RGB = [233, 237, 241];
const rgb = (c: RGB): string => `rgb(${c[0]},${c[1]},${c[2]})`;
type Convert = (p: MercXY) => [number, number] | null;

/** An FUP: a ring in the side's colour with a dark edge, open in the middle (where the approach turns into the assault). */
const fupUrl = (c: RGB): string =>
  Utils.svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.5" fill="none" stroke="#14181d" stroke-width="4.5"/><circle cx="10" cy="10" r="6.5" fill="none" stroke="${rgb(c)}" stroke-width="2.2"/></svg>`);
/** An MSR choke the turning approach blocks: a ring in the side's colour crossed out (a block). */
const chokeUrl = (c: RGB): string =>
  Utils.svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="#14181d" stroke="${rgb(c)}" stroke-width="2.4"/><path d="M7.5 7.5 L16.5 16.5 M16.5 7.5 L7.5 16.5" stroke="${rgb(c)}" stroke-width="2.4" stroke-linecap="round"/></svg>`);
/** A narrows: an amber diamond with a dark edge. */
const diamondUrl = (): string =>
  Utils.svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M11 2 L20 11 L11 20 L2 11 Z" fill="${rgb(NARROWS)}" stroke="#14181d" stroke-width="2" stroke-linejoin="round"/></svg>`);
/**
 * The map labels' opacity, pill and text together (user, 2026-11-14: "dim the labels on map 50% opaque"), so the
 * ground, the avenues and the rings under them still show. Both Extended View layers draw their labels with `pill`.
 */
export const LABEL_OPACITY = 0.5;

/** A label pill: dark red (enemy) or dark blue (own) with the avenue's colour round it, at LABEL_OPACITY. */
export function pill(text: string, col: RGB, fill: string, small = false): { url: string; w: number; h: number } {
  const fs = small ? 11 : 12.5;
  const w = Math.max(30, Math.round(text.length * fs * 0.62 + 18));
  const h = small ? 18 : 22;
  const body = `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${(h - 2) / 2}" fill="${fill}" stroke="${rgb(col)}" stroke-width="1.5"/><text x="${w / 2}" y="${h / 2 + fs * 0.36}" font-size="${fs}" font-weight="750" text-anchor="middle" fill="#fff" font-family="system-ui,Segoe UI,Arial,sans-serif">${Utils.escapeHtml(text)}</text>`;
  return { url: Utils.svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><g opacity="${LABEL_OPACITY}">${body}</g></svg>`), w, h };
}

export interface IpbApchMapShow {
  corridors: boolean;
  labels: 'auto' | 'all' | 'off';
  /** The fire on the avenues (extended.ipb.mapFire): each avenue coloured by fire along it, and the Posns' ranges. */
  fire?: boolean;
  /** NAIs, TAIs and decision points (extended.ipb.mapDecision). */
  decision?: boolean;
  /** Air avenues, LZ / DZ, AD sites, OPs over the enemy's LZs, obstructions (extended.ipb.mapAir). */
  air?: boolean;
  /** The situation template's elements (extended.ipb.mapTemplate). */
  template?: boolean;
}
/** A template element: the enemy's diamond with a letter for its mover, ringed by what the ground check did. */
function tplUrl(letter: string, status: string): string {
  const ring = status === 'moved' ? '#ffb02e' : status === 'known' ? '#8ec1ea' : status === 'nowhere' ? '#ffffff' : 'none';
  const op = status === 'outside' ? 0.5 : 1;
  const x = status === 'nowhere' ? '<path d="M6 6 L22 22 M22 6 L6 22" stroke="#fff" stroke-width="2"/>' : '';
  return Utils.svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28" opacity="${op}">${ring !== 'none' ? `<circle cx="14" cy="14" r="12.5" fill="none" stroke="${ring}" stroke-width="2.2"/>` : ''}<path d="M14 3.5 L24.5 14 L14 24.5 L3.5 14 Z" fill="#5a1d22" stroke="#ff6b6f" stroke-width="1.8" stroke-linejoin="round"/><text x="14" y="18" font-size="10.5" font-weight="800" text-anchor="middle" fill="#fff" font-family="system-ui,Segoe UI,Arial,sans-serif">${letter}</text>${x}</svg>`);
}
const TPL_LETTER: Record<string, string> = { armour: 'A', mech: 'M', dismounted: 'I', gun: 'G' };
const TPL_RED: RGB = [255, 107, 111];
/** Air colours: the enemy's flights magenta, own sky blue; AD yellow-green. */
const AIR_EN: RGB = [255, 122, 217];
const AIR_OWN: RGB = [127, 214, 255];
const AD: RGB = [184, 240, 112];
/** An AD site: the AD dome over a base line, in a dark disc. */
const adUrl = (): string =>
  Utils.svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26"><circle cx="13" cy="13" r="11.5" fill="#14181d" stroke="${rgb(AD)}" stroke-width="2"/><path d="M6 17 H20 M7.5 17 A5.5 5.5 0 0 1 18.5 17" fill="none" stroke="${rgb(AD)}" stroke-width="2.2" stroke-linecap="round"/></svg>`);
/** An OP: a triangle with a dot (the OP symbol), own blue. */
const opUrl = (col: RGB): string =>
  Utils.svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="22" viewBox="0 0 24 22"><path d="M12 2 L22 20 L2 20 Z" fill="#14181d" stroke="${rgb(col)}" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="14" r="2.6" fill="${rgb(col)}"/></svg>`);
/** A vertical obstruction (mast, tower, chimney, overhead tank): a small dark spike. */
const spikeUrl = (): string =>
  Utils.svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="12" height="14" viewBox="0 0 12 14"><path d="M6 1 L10 13 L2 13 Z" fill="#ffd27a" stroke="#14181d" stroke-width="1.4" stroke-linejoin="round"/></svg>`);
/** A decision point: a numbered star (gold to interdict, blue for the counter-attack), as the book's Fig 10. */
function starUrl(n: number, catk: boolean): string {
  const col = catk ? '#8ec1ea' : '#ffd27a';
  return Utils.svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="-15 -15 30 30"><path d="M0 -13 L3.8 -4 L13 -4 L5.6 1.8 L8.3 11 L0 5.5 L-8.3 11 L-5.6 1.8 L-13 -4 L-3.8 -4 Z" fill="#14181d" stroke="${col}" stroke-width="2.2" stroke-linejoin="round"/><text y="4" font-size="11" font-weight="800" text-anchor="middle" fill="${col}" font-family="system-ui,Segoe UI,Arial,sans-serif">${n}</text></svg>`);
}
/** Fire along an avenue: under fire green, dead red, screened amber, out of range dark grey (the Extended View's colours). */
const FIRE_COL: Record<'c' | 's' | 'd' | 'o', [number, number, number, number]> = { c: [47, 168, 98, 1], d: [229, 72, 77, 1], s: [238, 138, 31, 1], o: [60, 66, 74, 0.85] };
const RANGE: RGB = [255, 210, 63];
const GREY: RGB = [200, 206, 212];
/** A distance as the labels give it: metres to 1 km, then km to one place. */
export const dist = (m: number): string => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);
const FIRE_WORD: Record<'c' | 's' | 'd' | 'o', string> = { c: 'Under fire', s: 'Screened', d: 'Dead Gr', o: 'Out of range' };
/** Map units (Web Mercator metres) per screen pixel near a place, in a MapView or a SceneView. */
export function mapRes(view: any, at: MercXY | null): number {
  if (view?.type === '2d' && Number.isFinite(view.resolution) && view.resolution > 0) return view.resolution;
  const s = Number(view?.scale);
  return Number.isFinite(s) && s > 0 ? (s / 3779.527559) * (at ? Math.cosh(at[1] / 6378137) : 1) : 0;
}
/** A label to declutter: where, its size and lift on screen (px), and its rank (0 first). */
export interface LabelItem {
  at: MercXY;
  w: number;
  h: number;
  yoffset: number;
  prio: number;
}
/**
 * The labels that fit at this resolution: taken by rank (then in the order given), each kept only if it does not overlap
 * one already kept (2 px apart). Worked out again when the zoom changes, so a closer look shows more of them.
 */
export function declutter<T extends LabelItem>(items: T[], res: number, padPx = 2): T[] {
  if (!(res > 0)) return items;
  const kept: Array<[number, number, number, number]> = [];
  const out: T[] = [];
  const order = items.map((it, i) => ({ it, i })).sort((a, b) => a.it.prio - b.it.prio || a.i - b.i);
  for (const { it } of order) {
    const cx = it.at[0] / res;
    const cy = -it.at[1] / res - it.yoffset;
    const r: [number, number, number, number] = [cx - it.w / 2 - padPx, cy - it.h / 2 - padPx, cx + it.w / 2 + padPx, cy + it.h / 2 + padPx];
    if (kept.some((k) => k[0] < r[2] && r[0] < k[2] && k[1] < r[3] && r[1] < k[3])) continue;
    kept.push(r);
    out.push(it);
  }
  return out;
}
/** The point a share of the way along a line, by length. */
export function along(line: MercXY[], f: number): MercXY {
  if (line.length < 2) return line[0];
  let total = 0;
  for (let i = 1; i < line.length; i++) total += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  let want = total * f;
  for (let i = 1; i < line.length; i++) {
    const d = Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    if (want <= d && d > 0) return [line[i - 1][0] + ((line[i][0] - line[i - 1][0]) * want) / d, line[i - 1][1] + ((line[i][1] - line[i - 1][1]) * want) / d];
    want -= d;
  }
  return line[line.length - 1];
}

export class GroundGuideIpbApchMap {
  private _layer: GraphicsLayer | null = null;
  private _map: any = null;
  private _key = '';

  constructor(private readonly _getView: () => any) {}

  get shownKey(): string {
    return this._key;
  }

  /** Draw a reading (replacing what is shown). `key` names what is drawn, so the same reading is not drawn twice. */
  show(v: IpbApchView, on: IpbApchMapShow, key: string): void {
    const view = this._getView?.();
    const sr = view?.spatialReference;
    const conv = sr ? this._converter(sr) : null;
    if (!view?.map || !sr || !conv) return this.clear();
    const res = mapRes(view, v.anchor);
    // The labels are decluttered for the zoom: a new zoom step draws them again.
    key = `${key}|${res > 0 ? Math.round(Math.log2(res) * 3) : 0}`;
    if (this._key === key && this._map === view.map) return;
    this._ensure(view.map);
    const layer = this._layer!;
    layer.removeAll();
    const gs: Graphic[] = [];
    const path = (pts: MercXY[]): number[][] => pts.map(conv).filter((c): c is [number, number] => c !== null);
    const line = (pts: MercXY[], c: RGB, a: number, width: number, style: 'solid' | 'dash' | 'short-dash' | 'dot' = 'solid'): void => {
      const p = path(pts);
      if (p.length >= 2) gs.push(new Graphic({ geometry: new Polyline({ paths: [p], spatialReference: sr }), symbol: new SimpleLineSymbol({ color: [...c, a], width, style, cap: 'round', join: 'round' }) }));
    };
    const marker = (at: MercXY, sym: PictureMarkerSymbol): void => {
      const c = conv(at);
      if (c) gs.push(new Graphic({ geometry: new Point({ x: c[0], y: c[1], spatialReference: sr }), symbol: sym }));
    };
    const col = v.side === 'enemy' ? ENEMY : OWN;
    const dark = v.side === 'enemy' ? '#5a1d22' : '#1d3f66';
    const sideWord = v.side === 'enemy' ? 'En' : 'Own';
    const labels = on.labels !== 'off';
    const all = on.labels === 'all';
    /** A small label pill at a place, `yoffset` pt up, ranked `prio` (0 first) for the declutter at the end. */
    const tags: Array<LabelItem & { sym: PictureMarkerSymbol }> = [];
    const tag = (at: MercXY, text: string, c: RGB, fill: string, yoffset = 0, small = true, prio = 3): void => {
      const p = pill(text, c, fill, small);
      tags.push({ at, w: p.w, h: p.h, yoffset: (yoffset * 4) / 3, prio, sym: new PictureMarkerSymbol({ url: p.url, width: p.w * 0.75, height: p.h * 0.75, yoffset }) });
    };
    /** The top (north) of a circle of radius `r` (Web Mercator metres) round `c`. */
    const top = (c: MercXY, r: number): MercXY => [c[0], c[1] + r];

    // The area read.
    if (v.frame.length === 4) {
      line([...v.frame, v.frame[0]], [233, 237, 241], 0.55, 1, 'dash');
      if (labels) {
        const north = v.frame.reduce((a, b) => (b[1] > a[1] ? b : a));
        tag(north, `Area read · ${v.hqLabel}${v.forEch ? ` (your ${v.forEch})` : ''} · ${v.frameKm[0]} x ${v.frameKm[1]} km`, GREY, '#2a3038', 10, true, 2);
      }
    }
    // Avenues: fill, then the open-back outline (solid main, dashed others), then the inner line of the main attack.
    for (const a of [...v.aas].reverse()) {
      if (!a.viable) {
        line(a.line, LONE, 0.9, 1.6, 'dash');
        continue;
      }
      const ring = path(a.arrow.fill);
      if (ring.length >= 4) gs.push(new Graphic({ geometry: new Polygon({ rings: [ring], spatialReference: sr }), symbol: new SimpleFillSymbol({ color: [...col, a.main ? 0.2 : 0.12], outline: null as any }) }));
      line(a.arrow.stroke, [20, 24, 29], 0.55, a.main ? 4.4 : 3.6);
      line(a.arrow.stroke, col, 1, a.main ? 2.4 : 1.8, a.main ? 'solid' : 'dash');
      if (a.arrow.inner.length) line(a.arrow.inner, col, 1, 1.8);
    }
    if (on.corridors) for (const m of v.mcs) if (m.aa) line(m.line, MC, 0.75, 1.1, 'short-dash');
    for (const x of v.crossovers) line([x.from, x.to], CROSS, 0.9, 1.8, 'dash');
    // Fire on the avenues: a band along each avenue's centre in the fire's colours, and each Posn's effective range.
    if (on.fire && v.fire) {
      for (const p of v.fire.posns) {
        const k = Math.cosh(p.at[1] / 6378137);
        const ring: MercXY[] = [];
        for (let i = 0; i <= 72; i++) {
          const t = (i / 72) * Math.PI * 2;
          ring.push([p.at[0] + Math.sin(t) * p.effM * k, p.at[1] + Math.cos(t) * p.effM * k]);
        }
        line(ring, RANGE, p.spot ? 0.95 : 0.7, p.spot ? 1.6 : 1.2, 'short-dash');
        if (labels) tag(top(p.at, p.effM * k), `${p.label} · range ${dist(p.effM)}`, RANGE, '#2a2410', 0, true, p.spot ? 2 : 4);
      }
      for (const L of v.fire.lines)
        for (const sg of L.segs) {
          if (sg.line.length < 2) continue;
          // Out of range is the quiet state: thin and faint, so the fired, dead and screened stretches stand out.
          const quiet = sg.state === 'o';
          if (!quiet) line(sg.line, [11, 13, 16], 0.6, 7);
          const c = FIRE_COL[sg.state];
          line(sg.line, [c[0], c[1], c[2]], quiet ? 0.45 : c[3], quiet ? 2.4 : 4.5);
        }
      // The longest stretch of each kind along each avenue says what its colour means.
      if (labels) {
        for (const L of v.fire.lines) {
          const best: Partial<Record<'c' | 's' | 'd' | 'o', { len: number; line: MercXY[] }>> = {};
          for (const sg of L.segs) {
            const len = sg.toM - sg.fromM;
            if (sg.line.length >= 2 && len >= 500 && len > (best[sg.state]?.len ?? 0)) best[sg.state] = { len, line: sg.line };
          }
          for (const st of ['c', 's', 'd', 'o'] as const) {
            const b = best[st];
            if (!b) continue;
            const fc = FIRE_COL[st];
            tag(along(b.line, 0.5), `${FIRE_WORD[st]} ${dist(b.len)}`, [fc[0], fc[1], fc[2]], '#14181d', -12, true, st === 'o' ? 6 : 3);
          }
        }
      }
    }
    // Event template and decision support: NAIs as dashed circles, TAIs as boxes along the avenue, DPs as numbered stars.
    if (on.decision && v.decision) {
      const dv = v.decision;
      const k0 = Math.cosh(v.anchor[1] / 6378137);
      const r = Math.max(300, v.mcWidthM / 2) * k0;
      for (const n of dv.nais) {
        const ring: MercXY[] = [];
        for (let i = 0; i <= 40; i++) ring.push([n.at[0] + Math.sin((i * Math.PI) / 20) * r, n.at[1] + Math.cos((i * Math.PI) / 20) * r]);
        line(ring, [232, 235, 238], n.tai ? 0.5 : 0.85, 1.4, 'dash');
      }
      for (const t of dv.tais) {
        const b = (t.dirDeg * Math.PI) / 180;
        const L = Math.max(600, v.mcWidthM * 1.4) * k0, W = Math.max(400, v.mcWidthM) * k0;
        const f: MercXY = [Math.sin(b), Math.cos(b)], q: MercXY = [Math.cos(b), -Math.sin(b)];
        const c = (u: number, w: number): MercXY => [t.at[0] + f[0] * u + q[0] * w, t.at[1] + f[1] * u + q[1] * w];
        const box = [c(-L / 2, -W / 2), c(L / 2, -W / 2), c(L / 2, W / 2), c(-L / 2, W / 2)];
        const ring2 = path([...box, box[0]]);
        if (ring2.length >= 4) gs.push(new Graphic({ geometry: new Polygon({ rings: [ring2], spatialReference: sr }), symbol: new SimpleFillSymbol({ color: [255, 210, 122, 0.12], outline: new SimpleLineSymbol({ color: [255, 210, 122, 1], width: 2 }) }) }));
      }
      for (const d of dv.dps) marker(d.at, new PictureMarkerSymbol({ url: starUrl(d.n, d.kind === 'catk'), width: 24, height: 24 }));
      if (labels) {
        const h = (x: number): string => `${Math.round(x * 10) / 10} h`;
        for (const d of dv.dps) {
          const where = d.inArea ? '' : d.beforeH ? ' before H' : ` ${Math.round(d.beyondM / 1000)} km out`;
          tag(d.at, `${d.kind === 'catk' ? 'C Attk DP' : 'DP'} ${d.n}${where}`, d.kind === 'catk' ? OWN : [255, 210, 122], '#2a2410', -16, true, 1);
        }
        for (const t of dv.tais) tag(t.at, `TAI ${t.n}${all ? ` · ${h(t.earliestH)}-${h(t.latestH)}` : ''}`, [255, 210, 122], '#2a2410', 14, true, 2);
        for (const n of dv.nais) {
          if (n.tai) continue;
          tag(top(n.at, r), `NAI ${n.n}${all ? ` · ${h(n.earliestH)}-${h(n.latestH)}` : ''}`, [232, 235, 238], '#2a3038', 8, true, 2);
        }
      }
    }
    // Air: the air avenues as long dashes with a chevron at the end, LZ / DZ squares, AD sites with their reach, OPs.
    if (on.air && v.air) {
      const av = v.air;
      const ac = av.side === 'enemy' ? AIR_EN : AIR_OWN;
      const k0 = Math.cosh(v.anchor[1] / 6378137);
      for (const d of av.ad) {
        const ring: MercXY[] = [];
        for (let i = 0; i <= 72; i++) ring.push([d.at[0] + Math.sin((i * Math.PI) / 36) * av.adRangeM * k0, d.at[1] + Math.cos((i * Math.PI) / 36) * av.adRangeM * k0]);
        line(ring, AD, d.rank === 1 ? 0.7 : 0.45, 1.2, 'short-dash');
        if (labels) tag(top(d.at, av.adRangeM * k0), `${d.id} reach ${dist(av.adRangeM)}`, AD, '#26331a', 8, true, 5);
      }
      for (const r of [...av.routes].reverse()) {
        if (r.line.length < 2) continue;
        line(r.line, [20, 24, 29], 0.55, r.rank === 1 ? 5.4 : 4.2);
        line(r.line, ac, 1, r.rank === 1 ? 2.8 : 2, r.rank === 1 ? 'solid' : 'dash');
        // A chevron at the end, along the last leg.
        const b = r.line[r.line.length - 1];
        let a0 = r.line[r.line.length - 2];
        for (let i = r.line.length - 2; i >= 0; i--) {
          a0 = r.line[i];
          if (Math.hypot(b[0] - a0[0], b[1] - a0[1]) >= 300 * k0) break;
        }
        const L = Math.hypot(b[0] - a0[0], b[1] - a0[1]) || 1;
        const ux = (b[0] - a0[0]) / L, uy = (b[1] - a0[1]) / L;
        const h = 320 * k0;
        line([[b[0] - ux * h - uy * h * 0.6, b[1] - uy * h + ux * h * 0.6], b, [b[0] - ux * h + uy * h * 0.6, b[1] - uy * h - ux * h * 0.6]], ac, 1, r.rank === 1 ? 2.8 : 2);
      }
      for (const z of [...av.lzs, ...av.dzs]) {
        const ring = path([...z.ring, z.ring[0]]);
        if (ring.length >= 4) gs.push(new Graphic({ geometry: new Polygon({ rings: [ring], spatialReference: sr }), symbol: new SimpleFillSymbol({ color: [...ac, z.rank === 1 ? 0.22 : 0.12], outline: new SimpleLineSymbol({ color: [...ac, 1], width: z.rank === 1 ? 2.2 : 1.6, style: z.kind === 'dz' ? 'dash' : 'solid' }) }) }));
      }
      for (const z of av.lzs) {
        if (!z.op || (z.rank > 3 && on.labels !== 'all')) continue;
        line([z.op.at, z.at], OWN, 0.7, 1.2, 'short-dash');
        marker(z.op.at, new PictureMarkerSymbol({ url: opUrl(OWN), width: 18, height: 17 }));
        if (labels) tag(z.op.at, `OP over ${z.id} · ${dist(z.op.distM)}`, OWN, '#1d3f66', -14, true, 5);
      }
      const adSym = new PictureMarkerSymbol({ url: adUrl(), width: 22, height: 22 });
      for (const d of av.ad) marker(d.at, adSym);
      const spike = new PictureMarkerSymbol({ url: spikeUrl(), width: 9, height: 11 });
      for (const o of av.obstructions) marker(o.at, spike);
      if (labels) {
        const darkA = av.side === 'enemy' ? '#4a1640' : '#173a4f';
        for (const r of av.routes) {
          if (r.line.length < 2) continue;
          tag(along(r.line, 0.45), `${av.side === 'enemy' ? 'En' : 'Own'} Air Apch ${r.id}${all ? ` · ${dist(r.lengthM)}` : ''}`, ac, darkA, 0, r.rank !== 1, 4);
        }
        for (const z of [...av.lzs, ...av.dzs]) tag(z.at, `${z.id}${all ? ` · ${Math.round(z.sideM)} m` : ''}`, ac, darkA, 14, true, z.rank === 1 ? 3 : 4);
        if (all) for (const o of av.obstructions) tag(o.at, `${o.label} ${Math.round(o.heightM)} m`, [255, 210, 122], '#2a2410', 11, true, 7);
        for (const d of av.ad) tag(d.at, d.id, AD, '#26331a', -16, true, 4);
      }
    }
    // The situation template: where doctrine puts each element (a hollow ring) and where the ground lets it be (the enemy's
    // diamond, its mover's letter), a dashed line between; objectives and assembly areas as dashed rings, the FUP as a
    // line square to the avenue, a bridgehead as its box.
    if (on.template && v.template) {
      const tv = v.template;
      const k0 = Math.cosh(v.anchor[1] / 6378137);
      const ringOf = (c: MercXY, r: number): MercXY[] => Array.from({ length: 41 }, (_, i) => [c[0] + Math.sin((i / 40) * Math.PI * 2) * r, c[1] + Math.cos((i / 40) * Math.PI * 2) * r] as MercXY);
      for (const e of tv.elements) {
        if (e.status === 'none') continue;
        const r = e.footM * k0;
        if (e.doc && (e.status === 'moved' || e.status === 'known') && e.movedM > 0) {
          line([e.doc, e.at], [233, 237, 241], 0.8, 1.4, 'dash');
          line(ringOf(e.doc, Math.min(r, 400 * k0)), [233, 237, 241], 0.6, 1, 'short-dash');
          if (labels) {
            tag([(e.doc[0] + e.at[0]) / 2, (e.doc[1] + e.at[1]) / 2], `${e.status === 'known' ? 'Known Posn' : 'Moved'} ${dist(e.movedM)}`, [233, 237, 241], '#2a3038', 0, true, 4);
            tag(top(e.doc, Math.min(r, 400 * k0)), "Doctrine's place", [233, 237, 241], '#2a3038', 6, true, 6);
          }
        }
        if (e.role === 'objective') line(ringOf(e.at, r), TPL_RED, 0.95, 2, 'dash');
        else if (e.role === 'assy') line(ringOf(e.at, r), TPL_RED, 0.8, 1.6, 'short-dash');
        else if (e.role === 'fup') {
          const b = (e.dirDeg * Math.PI) / 180;
          const q: MercXY = [Math.cos(b), -Math.sin(b)];
          line([[e.at[0] - q[0] * r, e.at[1] - q[1] * r], [e.at[0] + q[0] * r, e.at[1] + q[1] * r]], TPL_RED, 1, 2.4);
        } else if (e.box && e.box.length === 4) {
          const ring = path([...e.box, e.box[0]]);
          if (ring.length >= 4) gs.push(new Graphic({ geometry: new Polygon({ rings: [ring], spatialReference: sr }), symbol: new SimpleFillSymbol({ color: [...TPL_RED, 0.08], outline: new SimpleLineSymbol({ color: [...TPL_RED, 0.95], width: 2, style: 'dash' }) }) }));
        }
        if (e.mover && e.role !== 'fup' && e.role !== 'assy' && !e.box) marker(e.at, new PictureMarkerSymbol({ url: tplUrl(TPL_LETTER[e.mover] ?? '?', e.status), width: 21, height: 21 }));
      }
      if (labels) {
        for (const e of tv.elements) {
          if (e.status === 'none') continue;
          const ring = e.role === 'objective' || e.role === 'assy';
          tag(ring ? top(e.at, e.footM * k0) : e.at, `En ${e.label}`, TPL_RED, '#3a1416', ring ? 8 : -15, true, e.role === 'objective' ? 1 : 3);
        }
      }
    }
    const dia = new PictureMarkerSymbol({ url: diamondUrl(), width: 15, height: 15 });
    for (const a of v.aas) for (const n of a.narrows) marker(n.at, dia);
    // The objective the approaches end on: its frontage x depth box (a line for a Pl or Sec), and each approach's FUP.
    const ob = v.objective;
    if (ob && ob.ring.length === 4) {
      const flat = ob.depthM < 1;
      const edge = flat ? [ob.ring[0], ob.ring[1]] : [...ob.ring, ob.ring[0]];
      line(edge, [20, 24, 29], 0.6, flat ? 6 : 4);
      line(edge, [255, 255, 255], 0.95, flat ? 3 : 1.8, flat ? 'solid' : 'dash');
      if (labels) {
        const topP = ob.ring.reduce((a, b) => (b[1] > a[1] ? b : a));
        const size = `${dist(ob.frontageM)}${ob.depthM >= 1 ? ` x ${dist(ob.depthM)}` : ''}`;
        tag(topP, `Obj: ${ob.label} · ${size}${ob.assumed ? ' (taken)' : ''}`, [233, 237, 241], '#2a3038', 12, true, 0);
      }
      // The MSR behind it and the choke the turning approach blocks.
      const tn = ob.turn;
      if (tn) {
        if (tn.road.length >= 2) {
          line(tn.road, [20, 24, 29], 0.6, 5);
          line(tn.road, [255, 255, 255], 0.9, 2, 'dash');
        }
        marker(tn.at, new PictureMarkerSymbol({ url: chokeUrl(col), width: 18, height: 18 }));
        if (labels) tag(tn.at, `${v.side === 'own' ? 'En' : 'Your'} MSR choke · ${tn.label}${all ? ` · ${dist(tn.behindM)} behind` : ''}`, col, dark, 15, true, 1);
      }
      const fs = new PictureMarkerSymbol({ url: fupUrl(col), width: 15, height: 15 });
      for (const a of v.aas) {
        if (!a.fupAt) continue;
        marker(a.fupAt, fs);
        if (labels) tag(a.fupAt, `FUP ${a.id}${all ? ` · ${dist(ob.fupM)} short` : ''}`, col, dark, -14, true, 2);
      }
    }
    // Labels.
    if (labels) {
      for (const a of v.aas) {
        if (!a.line.length) continue;
        tag(a.splitAt ? along(a.line.slice(a.splitAt), 0.5) : along(a.line, a.onto ? 0.45 : 0.3), a.viable ? `${sideWord} Apch ${a.id}${a.ontoLabel ? ` · ${a.ontoLabel}` : ''}${a.main ? ' (best)' : ''}` : `Cor ${a.id} (lone)`, a.viable ? col : LONE, a.viable ? dark : '#2a3038', 0, false, a.viable ? 0 : 3);
      }
      if (on.corridors) for (const m of v.mcs) if (m.aa && m.line.length >= 2) tag(along(m.line, 0.62), `Mob Cor ${m.id}${all ? ` · ${dist(v.mcWidthM)}` : ''}`, MC, '#2a3038', 0, true, 5);
      for (const a of v.aas)
        for (const n of a.narrows) tag(n.at, `${n.kind === 'crossing' ? 'Crossing' : 'Narrows'} ${Math.round(n.widthM)} m`, NARROWS, '#3a2a10', 12, true, 1);
      for (const x of v.crossovers) tag([(x.from[0] + x.to[0]) / 2, (x.from[1] + x.to[1]) / 2], `Crossover ${x.a}-${x.b}`, CROSS, '#2a3038', 0, true, 5);
    }
    // The labels that fit at this zoom, most important first; the rest come back on a closer look.
    for (const t of declutter(tags, res)) marker(t.at, t.sym);
    layer.addMany(gs);
    this._key = key;
  }

  clear(): void {
    this._layer?.removeAll();
    this._key = '';
  }

  /** The view (or its map) changed: leave the old map; the next `show` adds the layer to the new one. */
  onViewChanged(): void {
    this._detach();
    this._key = '';
  }

  destroy(): void {
    this._detach();
    this._layer?.destroy();
    this._layer = null;
    this._key = '';
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
    if (!this._layer) this._layer = new GraphicsLayer({ id: LAYER_ID, title: 'Ground Guide IPB avenues', listMode: 'hide', elevationInfo: { mode: 'on-the-ground' } });
    if (this._map !== map) {
      this._detach();
      // Above the IPB coding (index 0 when shown), under the symbol layers.
      const coding = map.layers?.findIndex?.((l: any) => l?.id === 'ms-ground-guide-ipb') ?? -1;
      map.add(this._layer, coding >= 0 ? coding + 1 : 0);
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
