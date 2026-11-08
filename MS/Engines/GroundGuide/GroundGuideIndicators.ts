/**
 * GroundGuideIndicators.ts
 *
 * Draws the Ground Guide's indicator lines on the map: from the symbol (or the
 * part of a shape that decides the verdict) to the terrain that is the reason for it,
 * with a marker on that terrain and extra marks on the parts of a line/area that lie in
 * no-go ground.
 *
 *   line + marker in the verdict ladder's colour (GroundGuideTokens, item 1, 2026-11-08): yellow from a Marginal
 *                         position to the NO-GO ground beside it, red to the contested part of a shape (partly /
 *                         mostly in no-go)
 *   green line + marker : from a symbol that is inside no-go to the nearest deployable
 *                         ground (where it could move to)
 * No text is drawn on the map (user, 2026-11-08: the label "obstructs the view"; the cursor card already names the
 * ground and says how far). Other units' footprints are violet, not SLOW-GO orange (item 16).
 *
 * Like ProximityEngine, the graphics are created once, kept on one ground-draped
 * GraphicsLayer and only have their geometry swapped / visibility toggled afterwards,
 * so following the cursor never adds or removes graphics (which would redraw the layer);
 * the marker pools only grow when a shape needs more marks than any before it.
 *
 * Markers are PictureMarkerSymbols on one Point graphic each: a SceneView draws neither
 * SimpleMarkerSymbol ('x', 'cross', 'circle', ...) nor Multipoint geometry on this draped
 * layer, so either would show in 2D only.
 */

import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polyline from '@arcgis/core/geometry/Polyline';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import PictureMarkerSymbol from '@arcgis/core/symbols/PictureMarkerSymbol';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import Utils from '../../Support/utils';
import { OTHER_UNIT, OWN_UNIT, rgbOf, STEP_COLOR, TONE, type Tone } from './GroundGuideTokens';
import type { MercXY, GroundGuideIndicator } from './GroundGuideTypes';

const LAYER_ID = 'ms-ground-guide-indicators';

/** The line colour for an indicator: the verdict's ladder fill; green for the way to usable ground. */
function lineTone(kind: GroundGuideIndicator['kind'], tone: Tone): Tone {
  if (kind === 'deployable') return 'go';
  if (tone === 'marg' || tone === 'part' || tone === 'nogo') return tone;
  return kind === 'contested' ? 'part' : 'nogo';
}

function toneRgb(t: Tone): [number, number, number] {
  return rgbOf(t === 'go' ? STEP_COLOR.go : TONE[t].fill);
}

type Convert = (p: MercXY) => [number, number] | null;

const svg = (body: string): string =>
  Utils.svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">${body}</svg>`);

/** The X mark for ground in no-go: the kind's colour on a white casing. */
function markUrl([r, g, b]: [number, number, number]): string {
  const x = 'M4 4 L18 18 M18 4 L4 18';
  return svg(
    `<path d="${x}" stroke="#fff" stroke-opacity="0.9" stroke-width="6" stroke-linecap="round" fill="none"/>` +
      `<path d="${x}" stroke="rgb(${r},${g},${b})" stroke-width="3" stroke-linecap="round" fill="none"/>`,
  );
}

/** The marker on the terrain a line points to: a white circle (diamond for deployable ground) ringed in the kind's colour. */
function endUrl([r, g, b]: [number, number, number], diamond: boolean): string {
  const stroke = `stroke="rgb(${r},${g},${b})" stroke-width="3" fill="#fff"`;
  return svg(diamond ? `<path d="M11 2 L20 11 L11 20 L2 11 Z" ${stroke} stroke-linejoin="round"/>` : `<circle cx="11" cy="11" r="8" ${stroke}/>`);
}

export class GroundGuideIndicators {
  private _layer: GraphicsLayer | null = null;
  private _map: any = null;
  private _casing: Graphic | null = null;
  private _line: Graphic | null = null;
  /** One Point graphic per line end / X mark; the unused tail of each pool is hidden. */
  private _endPool: Graphic[] = [];
  private _markPool: Graphic[] = [];
  private _endSym: PictureMarkerSymbol | null = null;
  private _markSym: PictureMarkerSymbol | null = null;
  private _stretchCasing: Graphic | null = null;
  private _stretch: Graphic | null = null;
  private _fpOwn: Graphic | null = null;
  private _fpOthers: Graphic | null = null;
  private _fpVisible = false;
  /** The kind and tone the symbols were made for ("no-go:marg"). */
  private _kind: string | null = null;
  private _visible = false;

  constructor(private readonly _getView: () => any) {}

  /** Draw (or move) the lines for these indicators in the verdict's ladder colour (`tone`); hides everything when there are none. */
  show(indicators: GroundGuideIndicator[], tone: Tone = 'nogo'): void {
    const view = this._getView?.();
    const sr = view?.spatialReference;
    const conv = sr ? this._converter(sr) : null;
    if (!view?.map || !sr || !conv || indicators.length === 0) {
      this.hide();
      return;
    }

    const paths: [number, number][][] = [];
    const ends: [number, number][] = [];
    const marks: [number, number][] = [];
    const stretches: [number, number][][] = [];
    for (const ind of indicators) {
      const a = conv(ind.from);
      const b = conv(ind.to);
      if (!a || !b) continue;
      paths.push([a, b]);
      ends.push(b);
      for (const m of ind.marks) {
        const c = conv(m);
        if (c) marks.push(c);
      }
      for (const run of ind.stretches ?? []) {
        const pts = run.map(conv).filter((c): c is [number, number] => c !== null);
        if (pts.length >= 2) stretches.push(pts);
      }
    }
    if (paths.length === 0) {
      this.hide();
      return;
    }

    const kind = indicators[0].kind;
    const lt = lineTone(kind, tone);
    this._ensure(view.map, kind, lt);
    if (`${kind}:${lt}` !== this._kind) this._applyKind(kind, lt);

    this._casing!.geometry = new Polyline({ paths, spatialReference: sr });
    this._line!.geometry = new Polyline({ paths, spatialReference: sr });
    this._placePoints(this._endPool, ends, this._endSym!, sr, () => null);
    this._placePoints(this._markPool, marks, this._markSym!, sr, () => this._endPool[0] ?? null);
    const stretchGeom = stretches.length ? new Polyline({ paths: stretches, spatialReference: sr }) : null;
    this._stretchCasing!.geometry = stretchGeom;
    this._stretch!.geometry = stretchGeom;
    this._stretchCasing!.visible = this._stretch!.visible = stretchGeom !== null;

    if (!this._visible) {
      this._casing!.visible = true;
      this._line!.visible = true;
      this._visible = true;
    }
  }

  /** Hide the indicator lines (the footprint outline has its own `hideFootprint`). */
  hide(): void {
    if (!this._visible) return;
    for (const g of [this._casing, this._line, ...this._endPool, ...this._markPool, this._stretchCasing, this._stretch]) {
      if (g) g.visible = false;
    }
    this._visible = false;
  }

  /**
   * Draw the echelon footprint being judged (blue) and, in violet (not a verdict colour, item 16), the footprints
   * of the neighbours that are too close. `ring` is a closed ring or the 2 end points of a line.
   */
  showFootprint(ring: MercXY[], others: MercXY[][]): void {
    const view = this._getView?.();
    const sr = view?.spatialReference;
    const conv = sr ? this._converter(sr) : null;
    if (!view?.map || !sr || !conv || ring.length < 2) {
      this.hideFootprint();
      return;
    }
    const path = (r: MercXY[]): [number, number][] | null => {
      const out: [number, number][] = [];
      for (const p of r) {
        const c = conv(p);
        if (!c) return null;
        out.push(c);
      }
      if (out.length > 2) out.push(out[0]); // close a ring; a 2-point line stays open
      return out;
    };
    const own = path(ring);
    if (!own) {
      this.hideFootprint();
      return;
    }
    this._ensure(view.map, 'no-go', 'nogo');
    this._fpOwn!.geometry = new Polyline({ paths: [own], spatialReference: sr });
    const neighbour = others.map(path).filter((p): p is [number, number][] => p !== null);
    this._fpOthers!.geometry = neighbour.length ? new Polyline({ paths: neighbour, spatialReference: sr }) : null;
    this._fpOthers!.visible = neighbour.length > 0;
    this._fpOwn!.visible = true;
    this._fpVisible = true;
  }

  hideFootprint(): void {
    if (!this._fpVisible) return;
    if (this._fpOwn) this._fpOwn.visible = false;
    if (this._fpOthers) this._fpOthers.visible = false;
    this._fpVisible = false;
  }

  /** The view changed: leave the old map so the next show() attaches to the new one. */
  onViewChanged(): void {
    this.hide();
    this.hideFootprint();
    this._detach();
  }

  destroy(): void {
    this._detach();
    this._layer?.destroy();
    this._layer = null;
    this._casing = this._line = null;
    this._endPool = [];
    this._markPool = [];
    this._endSym = this._markSym = null;
    this._stretchCasing = this._stretch = null;
    this._fpOwn = this._fpOthers = null;
    this._fpVisible = false;
    this._kind = null;
    this._visible = false;
  }

  /** The layer, for hosts that want to inspect or restyle it. */
  get layer(): GraphicsLayer | null {
    return this._layer;
  }

  // ── internals ────────────────────────────────────────────────────────────

  private _converter(sr: any): Convert | null {
    if (sr.isWebMercator === true || [102100, 3857, 102113, 3785].includes(sr.wkid ?? sr.latestWkid)) {
      return (p) => [p[0], p[1]];
    }
    if (sr.isWGS84 === true || (sr.wkid ?? sr.latestWkid) === 4326) {
      return (p) => {
        const ll = webMercatorUtils.xyToLngLat(p[0], p[1]);
        return ll ? [ll[0], ll[1]] : null;
      };
    }
    return null;
  }

  private _ensure(map: any, kind: GroundGuideIndicator['kind'], tone: Tone): void {
    if (!this._layer) {
      this._layer = new GraphicsLayer({
        id: LAYER_ID,
        title: 'Ground Guide indicators',
        listMode: 'hide',
        elevationInfo: { mode: 'on-the-ground' },
      });
      // Every graphic is created WITH its symbol (geometry arrives later), the way
      // ProximityEngine does it: a symbol-less graphic added to a SceneView layer is
      // never picked up when its symbol is set afterwards.
      const s = this._symbols(kind, tone);
      this._endSym = s.end;
      this._markSym = s.mark;
      this._casing = new Graphic({ symbol: s.casing, visible: false });
      this._line = new Graphic({ symbol: s.line, visible: false });
      this._endPool = [new Graphic({ symbol: s.end, visible: false })];
      // The stretches of a line / area edge that run through no-go ground: solid red on a white casing.
      this._stretchCasing = new Graphic({
        symbol: new SimpleLineSymbol({ style: 'solid', color: [255, 255, 255, 0.9], width: 9, cap: 'round', join: 'round' }),
        visible: false,
      });
      this._stretch = new Graphic({
        symbol: new SimpleLineSymbol({ style: 'solid', color: [...rgbOf(TONE.part.fill), 1], width: 5, cap: 'round', join: 'round' }),
        visible: false,
      });
      // Footprint outlines sit under the indicator lines so a line to no-go ground stays readable.
      this._fpOthers = new Graphic({
        symbol: new SimpleLineSymbol({ style: 'dash', color: [...rgbOf(OTHER_UNIT), 1], width: 2 }),
        visible: false,
      });
      this._fpOwn = new Graphic({
        symbol: new SimpleLineSymbol({ style: 'solid', color: [...rgbOf(OWN_UNIT), 1], width: 2.5 }),
        visible: false,
      });
      this._layer.addMany([
        this._fpOthers,
        this._fpOwn,
        this._stretchCasing,
        this._stretch,
        this._casing,
        this._line,
        ...this._endPool,
      ]);
      this._kind = `${kind}:${tone}`;
    }
    if (this._map !== map) {
      this._detach();
      map.add(this._layer); // appended last = above the overlay and the symbol layers
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

  /**
   * Put one pooled Point graphic on each coordinate and hide the rest of the pool. A pool only
   * grows (rarely: a shape with more marks than any before it); a new graphic is created WITH its
   * symbol and goes in just below `above()` (on top when null), keeping the 2D stacking marks < ends.
   */
  private _placePoints(pool: Graphic[], coords: [number, number][], sym: PictureMarkerSymbol, sr: any, above: () => Graphic | null): void {
    for (let i = pool.length; i < coords.length; i++) {
      const g = new Graphic({ symbol: sym, visible: false });
      const graphics = this._layer!.graphics;
      const ref = above();
      const at = ref ? graphics.indexOf(ref) : -1;
      graphics.add(g, at < 0 ? graphics.length : at);
      pool.push(g);
    }
    for (let i = 0; i < pool.length; i++) {
      const g = pool[i];
      if (i < coords.length) {
        g.geometry = new Point({ x: coords[i][0], y: coords[i][1], spatialReference: sr });
        g.visible = true;
      } else if (g.visible) {
        g.visible = false;
      }
    }
  }

  /** The kind or the verdict's tone (colour / marker shape) changed: swap in symbols for it. */
  private _applyKind(kind: GroundGuideIndicator['kind'], tone: Tone): void {
    const s = this._symbols(kind, tone);
    this._kind = `${kind}:${tone}`;
    this._casing!.symbol = s.casing;
    this._line!.symbol = s.line;
    this._endSym = s.end;
    this._markSym = s.mark;
    for (const g of this._endPool) g.symbol = s.end;
    for (const g of this._markPool) g.symbol = s.mark;
  }

  private _symbols(kind: GroundGuideIndicator['kind'], tone: Tone) {
    const rgb = toneRgb(tone);
    // A yellow line reads on a dark casing; the reds and the green on a white one.
    const casing: [number, number, number, number] = tone === 'marg' ? [20, 24, 29, 0.85] : [255, 255, 255, 0.8];
    return {
      casing: new SimpleLineSymbol({ style: 'solid', color: casing, width: 5 }),
      line: new SimpleLineSymbol({ style: 'dash', color: [...rgb, 1], width: 2.5 }),
      end: new PictureMarkerSymbol({ url: endUrl(rgb, kind === 'deployable'), width: 12, height: 12 }),
      mark: new PictureMarkerSymbol({ url: markUrl(rgb), width: 11, height: 11 }),
    };
  }
}
