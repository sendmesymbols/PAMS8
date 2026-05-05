/**
 * DrawingCueEngine.ts
 * Live visual overlays on the map while drawing a symbol:
 *   • Rubber-band dashed line + live length / bearing label (last ctrl-pt → cursor)
 *   • Floating cursor coordinate label (lat / lon)
 *   • Distance rings from the last placed control point
 *   • Angular guide line snapping to nearest of 0/45/90/135/180/225/270/315° from last ctrl-pt
 *   • Nearby-symbol highlight rings, color-coded by cursor proximity
 *
 * Singleton — DrawingCueEngine.getInstance().
 *
 * Events emitted on document:
 *   "drawing-cue-state-change" – { isActive: boolean }
 */

import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polyline from '@arcgis/core/geometry/Polyline';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol';
import TextSymbol from '@arcgis/core/symbols/TextSymbol';
import Font from '@arcgis/core/symbols/Font';
import Color from '@arcgis/core/Color';
import * as geometryEngine from '@arcgis/core/geometry/geometryEngine';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils';
import EngineLogger from '../Support/EngineLogger';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';

// ── Public option types ───────────────────────────────────────────────────────

export interface DrawingCueOptions {
  enabled?: boolean;
  rubberBand?: {
    enabled?: boolean;
    lineColor?: [number, number, number];
    lineOpacity?: number;
    lineWidth?: number;
    showLabel?: boolean;
    fontSize?: number;
    fontColor?: [number, number, number];
  };
  coordinateDisplay?: {
    enabled?: boolean;
    fontSize?: number;
    fontColor?: [number, number, number];
  };
  angularGuides?: {
    enabled?: boolean;
    snapThresholdDeg?: number;
    lineColor?: [number, number, number];
    lineOpacity?: number;
    lineWidth?: number;
  };
  distanceRings?: {
    enabled?: boolean;
    intervalKm?: number;
    ringCount?: number;
    lineColor?: [number, number, number];
    lineOpacity?: number;
    lineWidth?: number;
    showLabels?: boolean;
    fontSize?: number;
    fontColor?: [number, number, number];
  };
  nearbyHighlight?: {
    enabled?: boolean;
    radiusKm?: number;
    ringRadiusKm?: number;
    nearColor?: [number, number, number];
    midColor?: [number, number, number];
    farColor?: [number, number, number];
    outlineWidth?: number;
    outlineOpacity?: number;
  };
}

// ── Internal candidate record ─────────────────────────────────────────────────

interface CandidateInfo {
  original: Graphic;
  centroid: Point;
  highlightGraphic: Graphic | null;
}

// ── Layer ID ──────────────────────────────────────────────────────────────────

const LAYER_ID = 'DrawingCueLayer';

// ── Engine ────────────────────────────────────────────────────────────────────

class DrawingCueEngine {
  private static _instance: DrawingCueEngine;

  private _view: MapView | SceneView | null = null;
  private _layer: GraphicsLayer | null = null;
  private _isEnabled: boolean = true;
  private _isActive: boolean = false;
  private _isGeodesic: boolean = false;
  private _lastTick: number = 0;

  // Live graphics (mutated in-place where possible)
  private _rbLineG: Graphic | null = null;
  private _rbLabelG: Graphic | null = null;
  private _coordG: Graphic | null = null;
  private _guideGs: Graphic[] = [];
  private _ringGs: Graphic[] = [];

  // State
  private _lastCtrlPt: Point | null = null;
  private _prevCtrlPtCount: number = 0;
  private _candidateInfo: CandidateInfo[] = [];

  // Pointer listener
  private _boundPointerMove: ((e: PointerEvent) => void) | null = null;
  private _pointerHandle: { remove(): void } | null = null;

  // ── Option fields — rubber band ───────────────────────────────────────────
  private _rbEnabled: boolean = true;
  private _rbLineColor: [number, number, number] = [255, 200, 0];
  private _rbLineOpacity: number = 0.75;
  private _rbLineWidth: number = 1.5;
  private _rbShowLabel: boolean = true;
  private _rbFontSize: number = 11;
  private _rbFontColor: [number, number, number] = [0, 0, 0];

  // ── Option fields — coordinate display ───────────────────────────────────
  private _coordEnabled: boolean = true;
  private _coordFontSize: number = 11;
  private _coordFontColor: [number, number, number] = [0, 0, 0];

  // ── Option fields — angular guides ────────────────────────────────────────
  private _guidesEnabled: boolean = true;
  private _guidesSnapThresholdDeg: number = 8;
  private _guidesLineColor: [number, number, number] = [100, 200, 255];
  private _guidesLineOpacity: number = 0.45;
  private _guidesLineWidth: number = 1;

  // ── Option fields — distance rings ────────────────────────────────────────
  private _ringsEnabled: boolean = true;
  private _ringsIntervalKm: number = 1.0;
  private _ringsCount: number = 3;
  private _ringsLineColor: [number, number, number] = [100, 200, 100];
  private _ringsLineOpacity: number = 0.4;
  private _ringsLineWidth: number = 1;
  private _ringsShowLabels: boolean = true;
  private _ringsFontSize: number = 10;
  private _ringsFontColor: [number, number, number] = [20, 20, 20];

  // ── Option fields — nearby highlight ─────────────────────────────────────
  private _hlEnabled: boolean = true;
  private _hlRadiusKm: number = 5.0;
  private _hlRingRadiusKm: number = 0.5;
  private _hlNearColor: [number, number, number] = [255, 80, 80];
  private _hlMidColor: [number, number, number] = [255, 200, 80];
  private _hlFarColor: [number, number, number] = [80, 200, 80];
  private _hlOutlineWidth: number = 2.5;
  private _hlOutlineOpacity: number = 0.85;

  private constructor() {}

  public static getInstance(): DrawingCueEngine {
    if (!DrawingCueEngine._instance) {
      DrawingCueEngine._instance = new DrawingCueEngine();
    }
    return DrawingCueEngine._instance;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  get isEnabled(): boolean { return this._isEnabled; }
  get isActive(): boolean { return this._isActive; }

  public start(view: MapView | SceneView): void {
    this._view = view;
    this._resolveGeodesic();
    this._layer = this._getOrCreateLayer();
  }

  public enable(): void {
    this._isEnabled = true;
    EngineLogger.success('Drawing Cue Engine', 'Enabled — visual guides will appear while drawing');
  }

  public disable(): void {
    this._isEnabled = false;
    if (this._isActive) this.deactivate();
    EngineLogger.nextStep('Drawing Cue Engine', 'Disabled — drawing guides off');
  }

  public toggle(): boolean {
    this._isEnabled ? this.disable() : this.enable();
    return this._isEnabled;
  }

  /**
   * Called once when drawing begins. Snapshots existing graphics for nearby
   * highlight and starts the pointer-move listener.
   * Idempotent — safe to call on every onDrawProgress event.
   */
  public activate(targetLayerIds: string[]): void {
    if (!this._isEnabled || !this._view || !this._layer || this._isActive) return;
    this._isActive = true;

    // Snapshot candidates
    this._candidateInfo = [];
    for (const id of targetLayerIds) {
      const lyr = this._view.map.findLayerById(id) as GraphicsLayer | undefined;
      if (!lyr) continue;
      lyr.graphics.forEach((g: Graphic) => {
        const centroid = this._centroid(g);
        if (centroid) this._candidateInfo.push({ original: g, centroid, highlightGraphic: null });
      });
    }

    // Pre-create highlight ring graphics for each candidate (geometry computed once)
    if (this._hlEnabled) {
      for (const info of this._candidateInfo) {
        try {
          const rawRing = this._isGeodesic
            ? geometryEngine.geodesicBuffer(info.centroid, this._hlRingRadiusKm, 'kilometers')
            : geometryEngine.buffer(info.centroid, this._hlRingRadiusKm, 'kilometers');
          const ringGeom = Array.isArray(rawRing) ? rawRing[0] : rawRing;
          if (!ringGeom) continue;
          const sym = new SimpleFillSymbol({
            color: new Color([0, 0, 0, 0]),
            outline: new SimpleLineSymbol({ color: new Color([0, 0, 0, 0]), width: this._hlOutlineWidth }),
          });
          const hlG = new Graphic({ geometry: ringGeom, symbol: sym });
          this._layer.add(hlG);
          info.highlightGraphic = hlG;
        } catch { /* unsupported geometry */ }
      }
    }

    // Pointer listener for cursor tracking (coordinate display, rubber band, guides, highlights)
    const containerEl = this._resolveContainer();
    if (containerEl) {
      this._boundPointerMove = (e: PointerEvent) => {
        if (!this._isActive || !this._view) return;
        const now = Date.now();
        if (now - this._lastTick < 16) return; // ~60 fps
        this._lastTick = now;

        const rect = containerEl.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX > rect.right ||
            e.clientY < rect.top  || e.clientY > rect.bottom) return;

        const mapPt = this._view.toMap({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        if (mapPt) this._onCursorMove(mapPt);
      };
      window.addEventListener('pointermove', this._boundPointerMove, true);
      this._pointerHandle = {
        remove: () => {
          if (this._boundPointerMove) {
            window.removeEventListener('pointermove', this._boundPointerMove!, true);
            this._boundPointerMove = null;
          }
        },
      };
    }

    EngineLogger.nextStep('Drawing Cue Engine', 'Active — rubber-band, angle guides, and distance rings enabled while drawing');
    this._emitStateChange(true);
  }

  /**
   * Called on each onDrawProgress event. Updates last ctrl-pt and redraws
   * distance rings when a new point is committed.
   */
  public updateFromProgress(_geom: __esri.Geometry, ctrlPts: Point[]): void {
    if (!this._isEnabled || !this._isActive || ctrlPts.length < 1) return;
    const newCount = ctrlPts.length;
    if (newCount !== this._prevCtrlPtCount) {
      // ctrlPts[last] is the live cursor; the committed anchor is one before it
      this._lastCtrlPt = newCount > 1 ? ctrlPts[newCount - 2] : ctrlPts[0];
      this._prevCtrlPtCount = newCount;
      if (this._ringsEnabled) this._updateDistanceRings(this._lastCtrlPt);
    }
  }

  public deactivate(): void {
    this._isActive = false;
    this._lastCtrlPt = null;
    this._prevCtrlPtCount = 0;

    this._pointerHandle?.remove();
    this._pointerHandle = null;

    // Remove highlight graphics
    for (const info of this._candidateInfo) {
      if (info.highlightGraphic) this._removeGraphic(info.highlightGraphic);
    }
    this._candidateInfo = [];

    this._clearDrawingGraphics();
    EngineLogger.success('Drawing Cue Engine', 'Drawing complete — visual guides cleared');
    this._emitStateChange(false);
  }

  public onViewChanged(view: MapView | SceneView): void {
    this.deactivate();
    this._view = view;
    this._resolveGeodesic();
    this._rbLineG = null;
    this._rbLabelG = null;
    this._coordG = null;
    this._guideGs = [];
    this._ringGs = [];
    this._layer = this._getOrCreateLayer();
  }

  public setOptions(opts: DrawingCueOptions): void {
    if (opts.enabled !== undefined) { opts.enabled ? this.enable() : this.disable(); }

    const rb = opts.rubberBand;
    if (rb) {
      if (rb.enabled     !== undefined) this._rbEnabled      = rb.enabled;
      if (rb.lineColor   !== undefined) this._rbLineColor    = rb.lineColor;
      if (rb.lineOpacity !== undefined) this._rbLineOpacity  = rb.lineOpacity;
      if (rb.lineWidth   !== undefined) this._rbLineWidth    = rb.lineWidth;
      if (rb.showLabel   !== undefined) this._rbShowLabel    = rb.showLabel;
      if (rb.fontSize    !== undefined) this._rbFontSize     = rb.fontSize;
      if (rb.fontColor   !== undefined) this._rbFontColor    = rb.fontColor;
    }

    const cd = opts.coordinateDisplay;
    if (cd) {
      if (cd.enabled   !== undefined) this._coordEnabled   = cd.enabled;
      if (cd.fontSize  !== undefined) this._coordFontSize  = cd.fontSize;
      if (cd.fontColor !== undefined) this._coordFontColor = cd.fontColor;
    }

    const ag = opts.angularGuides;
    if (ag) {
      if (ag.enabled            !== undefined) this._guidesEnabled           = ag.enabled;
      if (ag.snapThresholdDeg   !== undefined) this._guidesSnapThresholdDeg  = ag.snapThresholdDeg;
      if (ag.lineColor          !== undefined) this._guidesLineColor         = ag.lineColor;
      if (ag.lineOpacity        !== undefined) this._guidesLineOpacity       = ag.lineOpacity;
      if (ag.lineWidth          !== undefined) this._guidesLineWidth         = ag.lineWidth;
    }

    const dr = opts.distanceRings;
    if (dr) {
      if (dr.enabled     !== undefined) this._ringsEnabled    = dr.enabled;
      if (dr.intervalKm  !== undefined) this._ringsIntervalKm = dr.intervalKm;
      if (dr.ringCount   !== undefined) this._ringsCount      = dr.ringCount;
      if (dr.lineColor   !== undefined) this._ringsLineColor  = dr.lineColor;
      if (dr.lineOpacity !== undefined) this._ringsLineOpacity= dr.lineOpacity;
      if (dr.lineWidth   !== undefined) this._ringsLineWidth  = dr.lineWidth;
      if (dr.showLabels  !== undefined) this._ringsShowLabels = dr.showLabels;
      if (dr.fontSize    !== undefined) this._ringsFontSize   = dr.fontSize;
      if (dr.fontColor   !== undefined) this._ringsFontColor  = dr.fontColor;
    }

    const nh = opts.nearbyHighlight;
    if (nh) {
      if (nh.enabled        !== undefined) this._hlEnabled        = nh.enabled;
      if (nh.radiusKm       !== undefined) this._hlRadiusKm       = nh.radiusKm;
      if (nh.ringRadiusKm   !== undefined) this._hlRingRadiusKm   = nh.ringRadiusKm;
      if (nh.nearColor      !== undefined) this._hlNearColor      = nh.nearColor;
      if (nh.midColor       !== undefined) this._hlMidColor       = nh.midColor;
      if (nh.farColor       !== undefined) this._hlFarColor       = nh.farColor;
      if (nh.outlineWidth   !== undefined) this._hlOutlineWidth   = nh.outlineWidth;
      if (nh.outlineOpacity !== undefined) this._hlOutlineOpacity = nh.outlineOpacity;
    }
  }

  public getStatus() {
    return {
      isEnabled: this._isEnabled,
      isActive: this._isActive,
      isGeodesic: this._isGeodesic,
      candidates: this._candidateInfo.length,
      activeGraphics: this._layer?.graphics.length ?? 0,
    };
  }

  // ── Internal: cursor update ───────────────────────────────────────────────

  private _onCursorMove(cursor: Point): void {
    if (!this._layer) return;

    if (this._coordEnabled) this._updateCoordLabel(cursor);

    if (this._rbEnabled && this._lastCtrlPt) {
      this._updateRubberBand(this._lastCtrlPt, cursor);
    } else {
      this._removeGraphic(this._rbLineG);  this._rbLineG  = null;
      this._removeGraphic(this._rbLabelG); this._rbLabelG = null;
    }

    if (this._guidesEnabled && this._lastCtrlPt) {
      this._updateAngularGuides(this._lastCtrlPt, cursor);
    }

    if (this._hlEnabled) this._updateNearbyHighlights(cursor);
  }

  // ── Rubber band ───────────────────────────────────────────────────────────

  private _updateRubberBand(from: Point, to: Point): void {
    if (!this._layer) return;
    const pl = new Polyline({ spatialReference: from.spatialReference });
    pl.addPath([[from.x, from.y], [to.x, to.y]]);

    const lineSym = new SimpleLineSymbol({
      style: 'short-dash',
      color: new Color([...this._rbLineColor, this._rbLineOpacity]),
      width: this._rbLineWidth + 0.5,
    });

    if (!this._rbLineG) {
      this._rbLineG = new Graphic({ geometry: pl, symbol: lineSym });
      this._layer.add(this._rbLineG);
    } else {
      this._rbLineG.geometry = pl;
      this._rbLineG.symbol   = lineSym;
    }

    if (this._rbShowLabel) {
      const mid = new Point({
        x: (from.x + to.x) / 2,
        y: (from.y + to.y) / 2,
        spatialReference: from.spatialReference,
      });
      const angle = this._lineAngle(from, to);
      const dist    = this._segLen(from, to);
      const bearing = this._bearing(from, to);
      const label   = `${dist}  ${bearing}`;
      const sym     = this._textSym(label, this._rbFontSize, this._rbFontColor, angle);

      if (!this._rbLabelG) {
        this._rbLabelG = new Graphic({ geometry: mid, symbol: sym });
        this._layer.add(this._rbLabelG);
      } else {
        this._rbLabelG.geometry = mid;
        this._rbLabelG.symbol   = sym;
      }
    } else {
      this._removeGraphic(this._rbLabelG);
      this._rbLabelG = null;
    }
  }

  // ── Coordinate display ────────────────────────────────────────────────────

  private _updateCoordLabel(cursor: Point): void {
    if (!this._layer) return;

    let geoX = cursor.x;
    let geoY = cursor.y;

    try {
      const sr = cursor.spatialReference ?? this._view?.spatialReference;
      if (sr?.wkid === 3857) {
        const geo = webMercatorUtils.webMercatorToGeographic(cursor) as Point;
        if (geo) { geoX = geo.x; geoY = geo.y; }
      }
    } catch {}

    const latDir = geoY >= 0 ? 'N' : 'S';
    const lonDir = geoX >= 0 ? 'E' : 'W';
    const label  = `${Math.abs(geoY).toFixed(5)}°${latDir}  ${Math.abs(geoX).toFixed(5)}°${lonDir}`;

    const font = new Font({ size: this._coordFontSize, family: 'Courier New', weight: 'bold' });
    const sym  = new TextSymbol({
      text: label,
      font,
      color:     new Color([...this._coordFontColor, 1.0]),
      haloColor: new Color([255, 255, 255, 0.95]),
      haloSize:  2.5,
      xoffset:   14,
      yoffset:   -16,
    });

    if (!this._coordG) {
      this._coordG = new Graphic({ geometry: cursor, symbol: sym });
      this._layer.add(this._coordG);
    } else {
      this._coordG.geometry = cursor;
      this._coordG.symbol   = sym;
    }
  }

  // ── Angular guides ────────────────────────────────────────────────────────

  private _updateAngularGuides(from: Point, cursor: Point): void {
    if (!this._view || !this._layer) return;

    const dx = cursor.x - from.x;
    const dy = cursor.y - from.y;
    // Bearing 0=North, clockwise
    const cursorBearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;

    const cardinals = [0, 45, 90, 135, 180, 225, 270, 315];
    let minDiff = Infinity;
    let nearest = 0;
    for (const c of cardinals) {
      let diff = Math.abs(cursorBearing - c);
      if (diff > 180) diff = 360 - diff;
      if (diff < minDiff) { minDiff = diff; nearest = c; }
    }

    // Clear old guides
    for (const g of this._guideGs) this._removeGraphic(g);
    this._guideGs = [];

    if (minDiff > this._guidesSnapThresholdDeg) return;

    const ext = this._view.extent;
    if (!ext) return;
    const reach = Math.max(ext.width, ext.height);
    const rad   = nearest * Math.PI / 180;
    const gdx   = Math.sin(rad);
    const gdy   = Math.cos(rad);

    const pl = new Polyline({ spatialReference: from.spatialReference });
    pl.addPath([
      [from.x - gdx * reach, from.y - gdy * reach],
      [from.x + gdx * reach, from.y + gdy * reach],
    ]);

    const sym = new SimpleLineSymbol({
      style: 'dash',
      color: new Color([...this._guidesLineColor, this._guidesLineOpacity]),
      width: this._guidesLineWidth,
    });
    const g = new Graphic({ geometry: pl, symbol: sym });
    this._layer.add(g);
    this._guideGs.push(g);
  }

  // ── Distance rings ────────────────────────────────────────────────────────

  private _updateDistanceRings(center: Point): void {
    if (!this._view || !this._layer) return;

    for (const g of this._ringGs) this._removeGraphic(g);
    this._ringGs = [];

    if (!this._ringsEnabled || this._ringsCount < 1 || this._ringsIntervalKm <= 0) return;

    for (let i = 1; i <= this._ringsCount; i++) {
      const distKm = i * this._ringsIntervalKm;
      try {
        const rawRing = this._isGeodesic
          ? geometryEngine.geodesicBuffer(center, distKm, 'kilometers')
          : geometryEngine.buffer(center, distKm, 'kilometers');
        const ring = Array.isArray(rawRing) ? rawRing[0] : rawRing;
        if (!ring) continue;

        const fillSym = new SimpleFillSymbol({
          color: new Color([0, 0, 0, 0]),
          outline: new SimpleLineSymbol({
            style: 'dash',
            color: new Color([...this._ringsLineColor, this._ringsLineOpacity]),
            width: this._ringsLineWidth,
          }),
        });
        const rg = new Graphic({ geometry: ring, symbol: fillSym });
        this._layer.add(rg);
        this._ringGs.push(rg);

        if (this._ringsShowLabels) {
          const ext = (ring as any).extent;
          if (ext) {
            const labelPt = new Point({
              x: ext.xmax,
              y: center.y + (ext.ymax - center.y) * 0.707,
              spatialReference: center.spatialReference,
            });
            const abbr = distKm >= 1 ? `${distKm} km` : `${Math.round(distKm * 1000)} m`;
            const lg = new Graphic({
              geometry: labelPt,
              symbol:   this._textSym(abbr, this._ringsFontSize, this._ringsFontColor, 0),
            });
            this._layer.add(lg);
            this._ringGs.push(lg);
          }
        }
      } catch (e) {
        console.warn('[DrawingCueEngine] ring error:', e);
      }
    }
  }

  // ── Nearby highlight ──────────────────────────────────────────────────────

  private _updateNearbyHighlights(cursor: Point): void {
    if (!this._layer) return;
    for (const info of this._candidateInfo) {
      if (!info.highlightGraphic) continue;

      const distKm  = this._geodesicDistKm(cursor, info.centroid);
      const alpha   = distKm < this._hlRadiusKm
        ? Math.round(this._hlOutlineOpacity * 255)
        : 0;
      const color = this._hlColor(distKm);

      info.highlightGraphic.symbol = new SimpleFillSymbol({
        color: new Color([0, 0, 0, 0]),
        outline: new SimpleLineSymbol({
          style: 'solid',
          color: new Color([...color, alpha]),
          width: this._hlOutlineWidth,
        }),
      });
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _geodesicDistKm(a: Point, b: Point): number {
    try {
      const pl = new Polyline({ spatialReference: a.spatialReference });
      pl.addPath([[a.x, a.y], [b.x, b.y]]);
      const raw = this._isGeodesic
        ? geometryEngine.geodesicLength(pl, 'kilometers' as any)
        : geometryEngine.planarLength(pl, 'kilometers' as any);
      return Math.abs(raw);
    } catch {
      const mapDist = Math.hypot(b.x - a.x, b.y - a.y);
      return this._mapUnitsToKm(mapDist, a);
    }
  }

  private _hlColor(distKm: number): [number, number, number] {
    const t1 = this._hlRadiusKm / 3;
    const t2 = this._hlRadiusKm * 2 / 3;
    if (distKm < t1) return this._hlNearColor;
    if (distKm < t2) return this._hlMidColor;
    return this._hlFarColor;
  }

  private _mapUnitsToKm(mapUnits: number, ref: Point): number {
    const wkid = (ref.spatialReference ?? this._view?.spatialReference)?.wkid;
    if (wkid === 3857) return mapUnits / 1000;      // meters → km
    if (wkid === 4326) return mapUnits * 111.32;    // degrees → km (approx)
    return mapUnits;
  }

  private _centroid(graphic: Graphic): Point | null {
    const geom = graphic.geometry;
    if (!geom) return null;
    if (geom.type === 'point') return geom as Point;
    const ext = geom.extent;
    if (!ext) return null;
    return new Point({
      x: (ext.xmin + ext.xmax) / 2,
      y: (ext.ymin + ext.ymax) / 2,
      spatialReference: ext.spatialReference,
    });
  }

  private _segLen(pt1: Point, pt2: Point): string {
    try {
      const pl = new Polyline({ spatialReference: pt1.spatialReference });
      pl.addPath([[pt1.x, pt1.y], [pt2.x, pt2.y]]);
      const raw = this._isGeodesic
        ? geometryEngine.geodesicLength(pl, 'kilometers' as any)
        : geometryEngine.planarLength(pl, 'kilometers' as any);
      const km = Math.abs(raw);
      return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(2)} km`;
    } catch { return '—'; }
  }

  private _bearing(a: Point, b: Point): string {
    const rise = b.y - a.y;
    const run  = b.x - a.x;
    if (rise === 0) return a.x > b.x ? 'Due W' : 'Due E';
    if (run  === 0) return a.y > b.y ? 'Due S' : 'Due N';
    const ns  = rise < 0 ? 'S' : 'N';
    const ew  = run  < 0 ? 'W' : 'E';
    const deg = Math.atan(Math.abs(run) / Math.abs(rise)) * 180 / Math.PI;
    const d   = Math.floor(deg);
    const m   = Math.floor((deg - d) * 60);
    return `${ns}${d}°${m}'${ew}`;
  }

  private _lineAngle(a: Point, b: Point): number {
    return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI * -1;
  }

  private _textSym(text: string, size: number, color: [number, number, number], angle: number): TextSymbol {
    return new TextSymbol({
      text,
      font:      new Font({ size, style: 'normal', weight: 'bold', family: 'Helvetica' }),
      color:     new Color([...color, 1]),
      haloColor: new Color([255, 255, 255, 0.95]),
      haloSize:  2,
      angle,
      xoffset:   5,
      yoffset:   8,
    });
  }

  private _clearDrawingGraphics(): void {
    if (!this._layer) return;
    for (const g of [this._rbLineG, this._rbLabelG, this._coordG]) {
      if (g) this._removeGraphic(g);
    }
    for (const g of [...this._guideGs, ...this._ringGs]) this._removeGraphic(g);
    this._rbLineG  = null;
    this._rbLabelG = null;
    this._coordG   = null;
    this._guideGs  = [];
    this._ringGs   = [];
  }

  private _removeGraphic(g: Graphic | null): void {
    if (g && this._layer) this._layer.remove(g);
  }

  private _resolveGeodesic(): void {
    const sr = this._view?.spatialReference;
    this._isGeodesic = sr?.wkid === 4326 || sr?.wkid === 3857;
  }

  private _resolveContainer(): HTMLElement | null {
    if (!this._view) return null;
    const raw = this._view.container;
    if (!raw) return null;
    if (typeof raw === 'string') return document.getElementById(raw);
    return raw as HTMLElement;
  }

  private _getOrCreateLayer(): GraphicsLayer {
    if (!this._view) throw new Error('[DrawingCueEngine] start() must be called first');
    let layer = this._view.map.findLayerById(LAYER_ID) as GraphicsLayer | undefined;
    if (!layer) {
      layer = new GraphicsLayer({ id: LAYER_ID, elevationInfo: { mode: 'on-the-ground' } });
      this._view.map.add(layer);
    }
    return layer;
  }

  private _emitStateChange(isActive: boolean): void {
    document.dispatchEvent(new CustomEvent('drawing-cue-state-change', {
      detail: { isActive },
      bubbles: true,
    }));
  }
}

export default DrawingCueEngine;
