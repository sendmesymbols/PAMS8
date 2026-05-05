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
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol';
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
    snapIntervalDeg?: number;
    lineColor?: [number, number, number];
    lineOpacity?: number;
    lineWidth?: number;
    showLabel?: boolean;
    fontSize?: number;
    showArc?: boolean;
    arcRadiusKm?: number;
    showFan?: boolean;
    showSnapPoint?: boolean;
    showAnchor?: boolean;
    relativeSegment?: boolean;
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
  adaptive?: {
    enabled?: boolean;
    coverageFraction?: number;
    maxOuterKm?: number;
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
  private _protractorGs: Graphic[] = [];

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
  private _rbFontSize: number = 12;
  private _rbFontColor: [number, number, number] = [255, 255, 255];

  // ── Option fields — coordinate display ───────────────────────────────────
  private _coordEnabled: boolean = true;
  private _coordFontSize: number = 12;
  private _coordFontColor: [number, number, number] = [255, 255, 255];

  // ── Option fields — angular guides ────────────────────────────────────────
  private _guidesEnabled: boolean = true;
  private _guidesSnapThresholdDeg: number = 8;
  private _guidesSnapIntervalDeg: number = 45;
  private _guidesLineColor: [number, number, number] = [80, 200, 255];
  private _guidesLineOpacity: number = 0.75;
  private _guidesLineWidth: number = 1.5;
  private _guidesShowLabel: boolean = true;
  private _guidesLabelFontSize: number = 11;
  private _guidesShowArc: boolean = true;
  private _guidesArcRadiusKm: number = 0.5;
  private _guidesShowFan: boolean = true;
  private _guidesShowSnapPoint: boolean = true;
  private _guidesShowAnchor: boolean = true;
  private _guidesRelativeSegment: boolean = false;
  private _prevSegBearing: number | null = null;

  // ── Option fields — distance rings ────────────────────────────────────────
  private _ringsEnabled: boolean = true;
  private _ringsIntervalKm: number = 1.0;
  private _ringsCount: number = 3;
  private _ringsLineColor: [number, number, number] = [80, 230, 120];
  private _ringsLineOpacity: number = 0.7;
  private _ringsLineWidth: number = 1.5;
  private _ringsShowLabels: boolean = true;
  private _ringsFontSize: number = 11;
  private _ringsFontColor: [number, number, number] = [255, 255, 255];

  // ── Option fields — nearby highlight ─────────────────────────────────────
  private _hlEnabled: boolean = true;
  private _hlRadiusKm: number = 5.0;
  private _hlRingRadiusKm: number = 0.5;
  private _hlNearColor: [number, number, number] = [255, 80, 80];
  private _hlMidColor: [number, number, number] = [255, 200, 80];
  private _hlFarColor: [number, number, number] = [80, 200, 80];
  private _hlOutlineWidth: number = 2.5;
  private _hlOutlineOpacity: number = 0.85;

  // ── Option fields — adaptive control ──────────────────────────────────────
  private _adaptiveEnabled: boolean = false;
  private _adaptiveCoverageFraction: number = 0.25;
  private _adaptiveMaxOuterKm: number = 200;

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
      const oldLastCtrlPt = this._lastCtrlPt;
      // ctrlPts[last] is the live cursor; the committed anchor is one before it
      this._lastCtrlPt = newCount > 1 ? ctrlPts[newCount - 2] : ctrlPts[0];
      // Track bearing of the segment just committed (for relative-segment guides)
      if (oldLastCtrlPt && this._lastCtrlPt && newCount > 2) {
        const ddx = this._lastCtrlPt.x - oldLastCtrlPt.x;
        const ddy = this._lastCtrlPt.y - oldLastCtrlPt.y;
        this._prevSegBearing = (Math.atan2(ddx, ddy) * 180 / Math.PI + 360) % 360;
      }
      this._prevCtrlPtCount = newCount;
      if (this._ringsEnabled) this._updateDistanceRings(this._lastCtrlPt);
      if (this._guidesShowArc) this._updateProtractorRing(this._lastCtrlPt!);
    }
  }

  public deactivate(): void {
    this._isActive = false;
    this._lastCtrlPt = null;
    this._prevCtrlPtCount = 0;
    this._prevSegBearing = null;

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
    this._protractorGs = [];
    this._prevSegBearing = null;
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
      if (ag.snapIntervalDeg    !== undefined) this._guidesSnapIntervalDeg   = ag.snapIntervalDeg;
      if (ag.lineColor          !== undefined) this._guidesLineColor         = ag.lineColor;
      if (ag.lineOpacity        !== undefined) this._guidesLineOpacity       = ag.lineOpacity;
      if (ag.lineWidth          !== undefined) this._guidesLineWidth         = ag.lineWidth;
      if (ag.showLabel          !== undefined) this._guidesShowLabel         = ag.showLabel;
      if (ag.fontSize           !== undefined) this._guidesLabelFontSize     = ag.fontSize;
      if (ag.showArc            !== undefined) this._guidesShowArc           = ag.showArc;
      if (ag.arcRadiusKm        !== undefined) this._guidesArcRadiusKm       = ag.arcRadiusKm;
      if (ag.showFan            !== undefined) this._guidesShowFan           = ag.showFan;
      if (ag.showSnapPoint      !== undefined) this._guidesShowSnapPoint      = ag.showSnapPoint;
      if (ag.showAnchor         !== undefined) this._guidesShowAnchor        = ag.showAnchor;
      if (ag.relativeSegment    !== undefined) this._guidesRelativeSegment   = ag.relativeSegment;
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

    const ad = opts.adaptive;
    if (ad) {
      if (ad.enabled          !== undefined) this._adaptiveEnabled          = ad.enabled;
      if (ad.coverageFraction !== undefined) this._adaptiveCoverageFraction = ad.coverageFraction;
      if (ad.maxOuterKm       !== undefined) this._adaptiveMaxOuterKm       = ad.maxOuterKm;
    }
  }

  public getStatus() {
    return {
      isEnabled: this._isEnabled,
      isActive: this._isActive,
      isGeodesic: this._isGeodesic,
      adaptiveEnabled: this._adaptiveEnabled,
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

    // Point symbols never commit a control point, so _lastCtrlPt stays null.
    // In that case center distance rings on the live cursor position instead.
    if (this._ringsEnabled && !this._lastCtrlPt) {
      this._updateDistanceRings(cursor);
    }
    if (this._guidesShowArc && !this._lastCtrlPt) {
      this._updateProtractorRing(cursor);
    }
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
      haloColor: new Color([0, 0, 0, 1]),
      haloSize:  3,
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
    for (const g of this._guideGs) this._removeGraphic(g);
    this._guideGs = [];
    if (!this._view || !this._layer) return;

    const dx = cursor.x - from.x;
    const dy = cursor.y - from.y;
    const cursorBearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;

    // Build snap angles from configurable interval
    const interval = Math.max(1, this._guidesSnapIntervalDeg);
    const snapAngles: number[] = [];
    for (let a = 0; a < 360; a += interval) snapAngles.push(a);

    // Add parallel / perpendicular guides relative to the last committed segment
    if (this._guidesRelativeSegment && this._prevSegBearing !== null) {
      for (const offset of [0, 90, 180, 270]) {
        const rel = ((this._prevSegBearing + offset) % 360 + 360) % 360;
        if (!snapAngles.some(a => Math.abs(a - rel) < 1)) snapAngles.push(rel);
      }
    }

    // Find nearest snap angle
    let minDiff = Infinity, nearest = 0;
    for (const a of snapAngles) {
      let diff = Math.abs(cursorBearing - a);
      if (diff > 180) diff = 360 - diff;
      if (diff < minDiff) { minDiff = diff; nearest = a; }
    }

    const threshold  = this._guidesSnapThresholdDeg;
    const isSnapping = minDiff <= threshold;
    const inFanZone  = minDiff <= threshold * 2;

    // Nothing to draw when cursor is far from any snap angle
    if (!inFanZone) return;

    const ext = this._view.extent;
    if (!ext) return;
    const reach = Math.max(ext.width, ext.height);

    // ── Multi-guide fan: secondary snap angles at reduced opacity ───────────
    if (this._guidesShowFan) {
      for (const a of snapAngles) {
        if (a === nearest) continue;
        let diff = Math.abs(cursorBearing - a);
        if (diff > 180) diff = 360 - diff;
        if (diff > threshold * 2) continue;
        const fanOp = this._guidesLineOpacity * 0.35 * (1 - diff / (threshold * 2));
        const r2    = a * Math.PI / 180;
        const pl2   = new Polyline({ spatialReference: from.spatialReference });
        pl2.addPath([
          [from.x - Math.sin(r2) * reach, from.y - Math.cos(r2) * reach],
          [from.x + Math.sin(r2) * reach, from.y + Math.cos(r2) * reach],
        ]);
        const fg = new Graphic({
          geometry: pl2,
          symbol: new SimpleLineSymbol({
            style: 'short-dash',
            color: new Color([...this._guidesLineColor, fanOp]),
            width: this._guidesLineWidth * 0.65,
          }),
        });
        this._layer.add(fg);
        this._guideGs.push(fg);
      }
    }

    if (!isSnapping) return;

    // ── Primary guide line — opacity scales with proximity to snap angle ────
    const rad        = nearest * Math.PI / 180;
    const gdx        = Math.sin(rad);
    const gdy        = Math.cos(rad);
    const primaryOp  = this._guidesLineOpacity * (0.6 + 0.4 * (1 - minDiff / threshold));
    const pl         = new Polyline({ spatialReference: from.spatialReference });
    pl.addPath([
      [from.x - gdx * reach, from.y - gdy * reach],
      [from.x + gdx * reach, from.y + gdy * reach],
    ]);
    const lineG = new Graphic({
      geometry: pl,
      symbol: new SimpleLineSymbol({
        style: 'dash',
        color: new Color([...this._guidesLineColor, primaryOp]),
        width: this._guidesLineWidth,
      }),
    });
    this._layer.add(lineG);
    this._guideGs.push(lineG);

    // ── Anchor crosshair at the origin control point ────────────────────────
    if (this._guidesShowAnchor) {
      this._addAnchorCrosshair(from);
    }

    // ── Angle label just outside the arc ───────────────────────────────────
    if (this._guidesShowLabel) {
      const labelDist = this._kmToMapUnits(this._guidesArcRadiusKm * 2.2, from);
      const labelPt   = new Point({
        x: from.x + gdx * labelDist,
        y: from.y + gdy * labelDist,
        spatialReference: from.spatialReference,
      });
      const lg = new Graphic({
        geometry: labelPt,
        symbol:   this._textSym(
          this._angleLabel(nearest),
          this._guidesLabelFontSize,
          this._guidesLineColor,
          0,
        ),
      });
      this._layer.add(lg);
      this._guideGs.push(lg);
    }

    // ── Projected snap point: where the cursor would land on the guide ──────
    if (this._guidesShowSnapPoint) {
      const dot    = dx * gdx + dy * gdy;
      const snapPt = new Point({
        x: from.x + gdx * dot,
        y: from.y + gdy * dot,
        spatialReference: from.spatialReference,
      });
      const sg = new Graphic({
        geometry: snapPt,
        symbol: new SimpleMarkerSymbol({
          style: 'circle',
          color: new Color([...this._guidesLineColor, 0.9]),
          size: 8,
          outline: new SimpleLineSymbol({
            color: new Color([255, 255, 255, 0.85]),
            width: 1.5,
          }),
        }),
      });
      this._layer.add(sg);
      this._guideGs.push(sg);
    }
  }

  private _addAnchorCrosshair(pt: Point): void {
    if (!this._layer) return;
    const g = new Graphic({
      geometry: pt,
      symbol: new SimpleMarkerSymbol({
        style: 'cross',
        color: new Color([...this._guidesLineColor, 0.9]),
        size: 14,
        outline: new SimpleLineSymbol({
          color: new Color([...this._guidesLineColor, 0.6]),
          width: 1.5,
        }),
      }),
    });
    this._layer.add(g);
    this._guideGs.push(g);
  }

  private _angleLabel(bearing: number): string {
    const norm  = ((bearing % 360) + 360) % 360;
    const names: Record<number, string> = {
      0: 'N', 45: 'NE', 90: 'E', 135: 'SE',
      180: 'S', 225: 'SW', 270: 'W', 315: 'NW',
    };
    return names[norm] ?? `${Math.round(norm)}°`;
  }

  private _kmToMapUnits(km: number, ref: Point): number {
    const wkid = (ref.spatialReference ?? this._view?.spatialReference)?.wkid;
    if (wkid === 3857) return km * 1000;
    if (wkid === 4326) return km / 111.32;
    return km * 1000;
  }

  private _computeAdaptiveIntervalKm(ref: Point): number {
    if (!this._view?.extent) return this._ringsIntervalKm;
    const ext      = this._view.extent;
    const minDimKm = this._mapUnitsToKm(Math.min(ext.width, ext.height), ref);
    const count    = Math.max(1, this._ringsCount);
    const rawTotal = minDimKm * this._adaptiveCoverageFraction / 2;
    const cappedTotal = Math.min(rawTotal, this._adaptiveMaxOuterKm);
    return Math.max(0.001, cappedTotal / count);
  }

  // ── Distance rings ────────────────────────────────────────────────────────

  private _updateDistanceRings(center: Point): void {
    if (!this._view || !this._layer) return;

    for (const g of this._ringGs) this._removeGraphic(g);
    this._ringGs = [];

    if (!this._ringsEnabled || this._ringsCount < 1 || this._ringsIntervalKm <= 0) return;

    const intervalKm = this._adaptiveEnabled
      ? this._computeAdaptiveIntervalKm(center)
      : this._ringsIntervalKm;

    for (let i = 1; i <= this._ringsCount; i++) {
      const distKm = i * intervalKm;
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

  // ── Protractor ring ───────────────────────────────────────────────────────

  private _updateProtractorRing(center: Point): void {
    for (const g of this._protractorGs) this._removeGraphic(g);
    this._protractorGs = [];
    if (!this._guidesShowArc || !this._layer || !this._view) return;

    const intervalKm = this._adaptiveEnabled
      ? this._computeAdaptiveIntervalKm(center)
      : this._ringsIntervalKm;
    const outerKm = (this._ringsCount > 0 && intervalKm > 0)
      ? this._ringsCount * intervalKm
      : this._guidesArcRadiusKm;
    const r = this._kmToMapUnits(outerKm, center);
    if (r <= 0) return;

    const sr  = center.spatialReference;
    const col = this._guidesLineColor;
    const add = (g: Graphic) => { this._layer!.add(g); this._protractorGs.push(g); };

    // ── Outer ring ──────────────────────────────────────────────────────────
    const SEGS = 180;
    const ringPts: number[][] = [];
    for (let i = 0; i <= SEGS; i++) {
      const a = (i / SEGS) * 2 * Math.PI;
      ringPts.push([center.x + r * Math.sin(a), center.y + r * Math.cos(a)]);
    }
    const ringPl = new Polyline({ spatialReference: sr });
    ringPl.addPath(ringPts);
    add(new Graphic({
      geometry: ringPl,
      symbol: new SimpleLineSymbol({
        style: 'solid',
        color: new Color([...col, 0.6]),
        width: 1.4,
      }),
    }));

    // ── Ticks + labels every 10° ────────────────────────────────────────────
    const dirNames: Record<number, string> = {
      0: 'N', 45: 'NE', 90: 'E', 135: 'SE',
      180: 'S', 225: 'SW', 270: 'W', 315: 'NW',
    };

    for (let deg = 0; deg < 360; deg += 10) {
      const rad = deg * Math.PI / 180;
      const sx  = Math.sin(rad);
      const sy  = Math.cos(rad);

      const isCardinal  = deg % 90 === 0;
      const isIntercard = deg % 45 === 0 && !isCardinal;
      const isThirty    = deg % 30 === 0 && deg % 45 !== 0;

      // Inward tick from ring edge
      const tickLen = isCardinal  ? r * 0.14
                    : isIntercard ? r * 0.10
                    : isThirty    ? r * 0.065
                    :               r * 0.038;
      const tickOp  = isCardinal  ? 0.9
                    : isIntercard ? 0.72
                    : isThirty    ? 0.55
                    :               0.35;
      const tickW   = isCardinal  ? 2.0
                    : isIntercard ? 1.5
                    : isThirty    ? 1.0
                    :               0.7;

      const tickPl = new Polyline({ spatialReference: sr });
      tickPl.addPath([
        [center.x + sx * r,             center.y + sy * r            ],
        [center.x + sx * (r - tickLen), center.y + sy * (r - tickLen)],
      ]);
      add(new Graphic({
        geometry: tickPl,
        symbol: new SimpleLineSymbol({
          style: 'solid',
          color: new Color([...col, tickOp]),
          width: tickW,
        }),
      }));

      // Direction name outside ring at cardinal / intercardinal positions
      if (dirNames[deg] !== undefined) {
        const fontSize = isCardinal ? 11 : 9;
        const outDist  = r * (isCardinal ? 1.24 : 1.19);
        const labelPt  = new Point({ x: center.x + sx * outDist, y: center.y + sy * outDist, spatialReference: sr });
        add(new Graphic({
          geometry: labelPt,
          symbol: new TextSymbol({
            text:      dirNames[deg],
            font:      new Font({ size: fontSize, weight: 'bold', family: 'Helvetica' }),
            color:     new Color([...col, isCardinal ? 0.95 : 0.75]),
            haloColor: new Color([0, 0, 0, 1]),
            haloSize:  2.5,
            xoffset:   0,
            yoffset:   0,
          }),
        }));
      }

      // Degree number inside ring every 30°
      if (deg % 30 === 0) {
        const inDist = r * 0.80;
        const numPt  = new Point({ x: center.x + sx * inDist, y: center.y + sy * inDist, spatialReference: sr });
        add(new Graphic({
          geometry: numPt,
          symbol: new TextSymbol({
            text:      `${deg}°`,
            font:      new Font({ size: 8, weight: 'normal', family: 'Helvetica' }),
            color:     new Color([...col, 0.65]),
            haloColor: new Color([0, 0, 0, 1]),
            haloSize:  2,
            xoffset:   0,
            yoffset:   0,
          }),
        }));
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
      haloColor: new Color([0, 0, 0, 1]),
      haloSize:  3,
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
    for (const g of [...this._guideGs, ...this._ringGs, ...this._protractorGs]) this._removeGraphic(g);
    this._rbLineG      = null;
    this._rbLabelG     = null;
    this._coordG       = null;
    this._guideGs      = [];
    this._ringGs       = [];
    this._protractorGs = [];
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
