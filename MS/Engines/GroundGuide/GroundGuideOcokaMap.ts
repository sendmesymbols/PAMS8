/**
 * GroundGuideOcokaMap.ts
 *
 * Draws the OCOKA lens's products on the map while a symbol is being placed (user, 2026-11-11: "show line of sight and
 * all you said above on the map"):
 *   - the fire fan toward the threat out to the weapon's range (yellow outline), with DEAD ground red (the terrain
 *     hides it) and SCREENED ground amber (crops, buildings or trees stand in the line);
 *   - the threat's own view when the threat is a place: the ground it sees between itself and the position (violet),
 *     and its line to the position, solid when it probably sees it, dashed with a cross where the line is lost;
 *   - lines of sight from the position to the ITG candidates, the same way;
 *   - the avenues of approach from the threat to the position (red, the second one dashed) with a diamond on each
 *     chokepoint;
 *   - a better position nearby (green ring, joined to the position by a green dash), which J takes.
 * With the map overlay on it also paints the lens's overlay (`ocoka.overlay`), which stays whether or not a symbol is
 * being placed: all the ground the threat may see from its place (violet), or all the ground that may be seen from the
 * position (light blue).
 * No text is drawn on the map (the cards name everything). Like GroundGuideIndicators, the graphics are made once on one
 * ground-draped layer and only have their geometry swapped, and markers are PictureMarkerSymbols on Point graphics so
 * they also show in a SceneView.
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
import type { MercXY, OcokaMapOverlay, OcokaMapPlan, OcokaMapSight } from './GroundGuideTypes';

const LAYER_ID = 'ms-ground-guide-ocoka';
type RGB = [number, number, number];
const SEEN: RGB = [62, 224, 122];
const DEAD: RGB = [229, 72, 77];
const SCREENED: RGB = [238, 138, 31];
const THREAT: RGB = [255, 210, 63];
const ENEMY: RGB = [167, 139, 250];
const AVENUE: RGB = [229, 72, 77];
const BETTER: RGB = [47, 168, 98];
/** The view from the position on the overlay: light blue, which reads on green hills and on brown fields alike. */
const VIEW: RGB = [64, 200, 255];

export interface OcokaMapShow {
  fan: boolean;
  enemy: boolean;
  sight: boolean;
  avenues: boolean;
  better: boolean;
}

type Convert = (p: MercXY) => [number, number] | null;
const svg = (body: string, size = 22): string => Utils.svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 22 22">${body}</svg>`);
const rgb = (c: RGB): string => `rgb(${c[0]},${c[1]},${c[2]})`;
/** Where a line of sight is lost: a cross in the line's colour on a white casing. */
const crossUrl = (c: RGB): string => {
  const x = 'M5 5 L17 17 M17 5 L5 17';
  return svg(`<path d="${x}" stroke="#fff" stroke-opacity="0.9" stroke-width="6" stroke-linecap="round" fill="none"/><path d="${x}" stroke="${rgb(c)}" stroke-width="3" stroke-linecap="round" fill="none"/>`);
};
/** A chokepoint: an amber diamond with a dark edge. */
const chokeUrl = (): string => svg(`<path d="M11 2 L20 11 L11 20 L2 11 Z" fill="${rgb(SCREENED)}" stroke="#14181d" stroke-width="2" stroke-linejoin="round"/><path d="M11 6.5 V12.5 M11 15 V15.6" stroke="#14181d" stroke-width="2.2" stroke-linecap="round"/>`);
/** A better position: a green ring round a white centre. */
const betterUrl = (): string => svg(`<circle cx="11" cy="11" r="8.5" fill="#fff" stroke="${rgb(BETTER)}" stroke-width="3.5"/><circle cx="11" cy="11" r="3" fill="${rgb(BETTER)}"/>`);
/** The end of a line of sight that is in view: a small ring in the line's colour. */
const endUrl = (c: RGB): string => svg(`<circle cx="11" cy="11" r="6.5" fill="#fff" stroke="${rgb(c)}" stroke-width="3"/>`);

export class GroundGuideOcokaMap {
  private _layer: GraphicsLayer | null = null;
  private _map: any = null;
  private _g: Record<string, Graphic> = {};
  private _pools: Record<string, Graphic[]> = { cross: [], choke: [], end: [] };
  private _syms: Record<string, PictureMarkerSymbol> = {};
  private _shown = false;
  /** The overlay's own graphics, apart from the placing products: `hide()` leaves them. */
  private _ov: Record<string, Graphic> = {};
  private _ovKind: 'threat' | 'view' | null = null;

  constructor(private readonly _getView: () => any) {}

  get layer(): GraphicsLayer | null {
    return this._layer;
  }

  /** What the overlay shows now: the threat's view, the view from the position, or nothing. */
  get overlayKind(): 'threat' | 'view' | null {
    return this._ovKind;
  }

  /**
   * Draw (or move) the products. `sight` and `plan` may each be null (not worked out yet, or nothing to show): what is
   * given is drawn, the rest is hidden. `from` is the position being placed.
   */
  show(from: MercXY, sight: OcokaMapSight | null, plan: OcokaMapPlan | null, on: OcokaMapShow): void {
    const view = this._getView?.();
    const sr = view?.spatialReference;
    const conv = sr ? this._converter(sr) : null;
    if (!view?.map || !sr || !conv) {
      this.hide();
      return;
    }
    this._ensure(view.map);
    const area = (key: string, list: MercXY[][] | null | undefined): void => {
      const r = list && list.length ? this._rings(list, conv) : [];
      const g = this._g[key];
      g.geometry = r.length ? new Polygon({ rings: r, spatialReference: sr }) : null;
      g.visible = r.length > 0;
    };
    const lines = (key: string, list: MercXY[][]): void => {
      const paths: number[][][] = [];
      for (const line of list) {
        const pts = line.map(conv).filter((c): c is [number, number] => c !== null);
        if (pts.length >= 2) paths.push(pts);
      }
      const g = this._g[key];
      g.geometry = paths.length ? new Polyline({ paths, spatialReference: sr }) : null;
      g.visible = paths.length > 0;
    };

    const fan = on.fan ? sight?.fan : null;
    area('fan', fan ? [fan.outline] : null);
    area('dead', fan?.dead);
    area('screened', fan?.screened);

    const enemy = on.enemy ? sight?.enemy : null;
    // With the overlay painting all the threat sees, its wedge toward the position would only double it.
    const wedge = this._ovKind === 'threat' ? null : enemy;
    area('enemyArea', wedge ? [wedge.outline] : null);
    area('enemySeen', wedge?.seen);

    // Lines of sight: in view (solid), may be (dashed amber), lost (dashed red, with a cross where).
    const seenL: MercXY[][] = [], maybeL: MercXY[][] = [], lostL: MercXY[][] = [];
    const crosses: MercXY[] = [], ends: MercXY[] = [];
    const add = (a: MercXY, b: MercXY, p: number, blockAt: MercXY | null): void => {
      if (p >= 0.5) {
        seenL.push([a, b]);
        ends.push(b);
      } else if (p >= 0.2) maybeL.push([a, b]);
      else {
        lostL.push([a, b]);
        if (blockAt) crosses.push(blockAt);
      }
    };
    if (on.sight) for (const l of sight?.lines ?? []) add(from, l.to, l.p, l.blockAt);
    const eSeen: MercXY[][] = [], eLost: MercXY[][] = [];
    if (enemy) {
      if (enemy.seesP >= 0.5) eSeen.push([enemy.at, from]);
      else {
        eLost.push([enemy.at, from]);
        if (enemy.blockAt) crosses.push(enemy.blockAt);
      }
    }
    lines('losSeen', seenL);
    lines('losMaybe', maybeL);
    lines('losLost', lostL);
    lines('enemySees', eSeen);
    lines('enemyLost', eLost);
    this._place('end', ends, sr, conv);
    this._place('cross', crosses, sr, conv);

    const avs = on.avenues ? (plan?.avenues ?? []) : [];
    lines('avCasing', avs.map((a) => a.path));
    lines('av1', avs.slice(0, 1).map((a) => a.path));
    lines('av2', avs.slice(1).map((a) => a.path));
    this._place('choke', avs.flatMap((a) => a.chokes.map((c) => c.at)), sr, conv);

    const better = on.better ? plan?.better : null;
    lines('betterLine', better ? [[from, better.at]] : []);
    const bm = this._g.betterMark;
    const bc = better ? conv(better.at) : null;
    bm.geometry = bc ? new Point({ x: bc[0], y: bc[1], spatialReference: sr }) : null;
    bm.visible = !!bc;
    this._shown = true;
  }

  /**
   * The lens's overlay: all the ground the threat may see from its place (violet), or all the ground that may be seen
   * from the position (light blue). Null clears it. It is drawn under the placing products and stays while they come
   * and go.
   */
  showOverlay(o: OcokaMapOverlay | null): void {
    const view = this._getView?.();
    const sr = view?.spatialReference;
    const conv = sr ? this._converter(sr) : null;
    if (!o || !view?.map || !sr || !conv) {
      for (const g of Object.values(this._ov)) if (g.visible) g.visible = false;
      this._ovKind = null;
      return;
    }
    this._ensure(view.map);
    const mine = o.kind === 'threat' ? ['threatSeen', 'threatArea'] : ['viewSeen', 'viewArea'];
    for (const [k, g] of Object.entries(this._ov)) if (!mine.includes(k) && g.visible) g.visible = false;
    const set = (key: string, list: MercXY[][]): void => {
      const r = this._rings(list, conv);
      const g = this._ov[key];
      g.geometry = r.length ? new Polygon({ rings: r, spatialReference: sr }) : null;
      g.visible = r.length > 0;
    };
    set(mine[0], o.seen);
    set(mine[1], [o.outline]);
    this._ovKind = o.kind;
    if (o.kind === 'threat') {
      for (const k of ['enemyArea', 'enemySeen']) if (this._g[k]?.visible) this._g[k].visible = false;
    }
  }

  hide(): void {
    if (!this._shown) return;
    for (const g of Object.values(this._g)) g.visible = false;
    for (const pool of Object.values(this._pools)) for (const g of pool) g.visible = false;
    this._shown = false;
  }

  /** The view changed: leave the old map so the next show() attaches to the new one. */
  onViewChanged(): void {
    this._detach();
  }

  destroy(): void {
    this._detach();
    this._layer?.destroy();
    this._layer = null;
    this._g = {};
    this._ov = {};
    this._ovKind = null;
    this._pools = { cross: [], choke: [], end: [] };
    this._shown = false;
  }

  private _rings(list: MercXY[][], conv: Convert): number[][][] {
    const out: number[][][] = [];
    for (const ring of list) {
      const r: number[][] = [];
      for (const p of ring) {
        const c = conv(p);
        if (!c) break;
        r.push(c);
      }
      if (r.length === ring.length && r.length >= 4) out.push(r);
    }
    return out;
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
      this._layer = new GraphicsLayer({ id: LAYER_ID, title: 'Ground Guide OCOKA', listMode: 'hide', elevationInfo: { mode: 'on-the-ground' } });
      const fill = (c: RGB, a: number, outline: [RGB, number, number, ('solid' | 'dash')?] | null): SimpleFillSymbol =>
        new SimpleFillSymbol({ color: [...c, a], outline: outline ? new SimpleLineSymbol({ color: [...outline[0], outline[1]], width: outline[2], style: outline[3] ?? 'solid' }) : (null as any) });
      const line = (c: RGB, a: number, width: number, style: 'solid' | 'dash' | 'short-dash' = 'solid'): SimpleLineSymbol => new SimpleLineSymbol({ color: [...c, a], width, style, cap: 'round', join: 'round' });
      // Every graphic is created WITH its symbol: a symbol-less graphic added to a SceneView layer is never picked up later.
      const make = (key: string, symbol: any): Graphic => (this._g[key] = new Graphic({ symbol, visible: false }));
      this._syms = {
        cross: new PictureMarkerSymbol({ url: crossUrl(DEAD), width: 12, height: 12 }),
        choke: new PictureMarkerSymbol({ url: chokeUrl(), width: 17, height: 17 }),
        end: new PictureMarkerSymbol({ url: endUrl(SEEN), width: 10, height: 10 }),
      };
      const ov = (key: string, symbol: any): Graphic => (this._ov[key] = new Graphic({ symbol, visible: false }));
      // Bottom to top: the overlay, areas, the threat's view, avenues, lines of sight, the better position, markers.
      this._layer.addMany([
        ov('viewSeen', fill(VIEW, 0.34, null)),
        ov('viewArea', fill(VIEW, 0, [VIEW, 0.85, 1.2, 'dash'])),
        ov('threatSeen', fill(ENEMY, 0.32, null)),
        ov('threatArea', fill(ENEMY, 0, [ENEMY, 0.85, 1.2, 'dash'])),
        make('enemySeen', fill(ENEMY, 0.26, null)),
        make('enemyArea', fill(ENEMY, 0, [ENEMY, 0.9, 1.4, 'dash'])),
        make('fan', fill(SEEN, 0.1, [THREAT, 0.95, 1.6])),
        make('screened', fill(SCREENED, 0.42, null)),
        make('dead', fill(DEAD, 0.45, null)),
        make('avCasing', line([20, 24, 29], 0.75, 7)),
        make('av2', line(AVENUE, 1, 2.6, 'dash')),
        make('av1', line(AVENUE, 1, 3.6)),
        make('enemyLost', line(ENEMY, 1, 2.2, 'short-dash')),
        make('enemySees', line(ENEMY, 1, 2.8)),
        make('losLost', line(DEAD, 0.95, 1.8, 'short-dash')),
        make('losMaybe', line(SCREENED, 0.95, 1.8, 'dash')),
        make('losSeen', line(SEEN, 1, 2.2)),
        make('betterLine', line(BETTER, 1, 2.4, 'dash')),
        make('betterMark', new PictureMarkerSymbol({ url: betterUrl(), width: 18, height: 18 })),
      ]);
    }
    if (this._map !== map) {
      this._detach();
      map.add(this._layer); // appended last: above the overlay and the symbol layers
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

  /** Put one pooled Point graphic on each place and hide the rest of the pool (a pool only grows). */
  private _place(kind: 'cross' | 'choke' | 'end', places: MercXY[], sr: any, conv: Convert): void {
    const pool = this._pools[kind];
    const coords = places.map(conv).filter((c): c is [number, number] => c !== null);
    for (let i = pool.length; i < coords.length; i++) {
      const g = new Graphic({ symbol: this._syms[kind], visible: false });
      this._layer!.graphics.add(g);
      pool.push(g);
    }
    for (let i = 0; i < pool.length; i++) {
      const g = pool[i];
      if (i < coords.length) {
        g.geometry = new Point({ x: coords[i][0], y: coords[i][1], spatialReference: sr });
        g.visible = true;
      } else if (g.visible) g.visible = false;
    }
  }
}
