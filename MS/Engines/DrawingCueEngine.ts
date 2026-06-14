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
import { MagneticCompass, MagneticCompassOptions } from './Cue/MagneticCompass';
import type Geometry from "@arcgis/core/geometry/Geometry";

// ── Public option types ───────────────────────────────────────────────────────

export interface DrawingCueOptions {
  enabled?: boolean;
  closeCue?: boolean;
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
    protractorDetail?: 'full' | 'reduced';
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
  magneticCompass?: MagneticCompassOptions;
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
  private _needleGs: Graphic[] = [];

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
  private _guidesProtractorDetail: 'full' | 'reduced' = 'reduced';
  private _prevSegBearing: number | null = null;

  // ── Cache fields — protractor & distance ring rebuild guards ──────────────
  private _lastProtractorCenter: Point | null = null;
  private _lastProtractorRadius: number = 0;
  private _lastRingsCenter: Point | null = null;
  private _lastRingsRadius: number = 0;

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

  // ── Option fields — close-ring cue ────────────────────────────────────────
  private _closeCueEnabled: boolean = true;
  private _closeFirstVertex: Point | null = null;
  private _closeRingG: Graphic | null = null;
  private static readonly CLOSE_PX = 16;

  // ── Magnetic compass child engine ──────────────────────────────────────────
  private _compass: MagneticCompass | null = null;

  private constructor() {}

  get compassEngine(): MagneticCompass | null { return this._compass; }

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

    if (!this._compass) this._compass = new MagneticCompass();
    this._compass.start(view);
  }

  public openCompassWidget(): void {
    if (!this._compass) return;
    // Auto-enable so the panel is immediately functional — without this, the
    // map click handler bails on `!_enabled` and "+ Add Compass" appears to
    // do nothing. Mirrors what the user would otherwise toggle separately.
    this._compass.enable();
    // Broadcast through the settings bus so the legacy panel's `setting-
    // magneticCompass` checkbox and the modular widget's row both reflect
    // reality. Receivers are idempotent (settingsData mutation + compass
    // .setOptions → .enable() again is a no-op).
    try {
      window.dispatchEvent(new CustomEvent('settingsChanged', {
        detail: {
          path: ['drawingCues', 'magneticCompass', 'enabled'],
          value: true,
          fullPath: 'drawingCues.magneticCompass.enabled',
        },
      }));
    } catch { /* ignore */ }
    this._compass.openWidget();
  }
  public closeCompassWidget(): void { this._compass?.closeWidget(); }

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
        this._updateCloseCue(e);
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
  public updateFromProgress(_geom: Geometry, ctrlPts: Point[]): void {
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

    // Close-cue: armed only while drawing a polygon with >= 3 committed anchors.
    // ctrlPts[last] is the live cursor, so committed anchors = ctrlPts.length - 1.
    const committed = ctrlPts.length - 1;
    if (this._closeCueEnabled && _geom?.type === "polygon" && committed >= 3) {
      this._closeFirstVertex = ctrlPts[0] ?? null;
    } else {
      this._closeFirstVertex = null;
      this._clearCloseRing();
    }
  }

  public deactivate(): void {
    this._isActive = false;
    this._lastCtrlPt = null;
    this._prevCtrlPtCount = 0;
    this._prevSegBearing = null;
    this._lastProtractorCenter = null;
    this._lastProtractorRadius = 0;
    this._lastRingsCenter = null;
    this._lastRingsRadius = 0;

    this._pointerHandle?.remove();
    this._pointerHandle = null;

    // Remove highlight graphics
    for (const info of this._candidateInfo) {
      if (info.highlightGraphic) this._removeGraphic(info.highlightGraphic);
    }
    this._candidateInfo = [];

    this._closeFirstVertex = null;
    this._clearCloseRing();
    this._clearDrawingGraphics();
    for (const g of this._needleGs) this._removeGraphic(g);
    this._needleGs = [];
    EngineLogger.success('Drawing Cue Engine', 'Drawing complete — visual guides cleared');
    this._emitStateChange(false);
  }

  public onViewChanged(view: MapView | SceneView): void {
    this._compass?.onViewChanged(view);
    this.deactivate();
    this._view = view;
    this._resolveGeodesic();
    this._rbLineG = null;
    this._rbLabelG = null;
    this._coordG = null;
    this._guideGs = [];
    this._ringGs = [];
    this._protractorGs = [];
    this._needleGs = [];
    this._prevSegBearing = null;
    this._lastProtractorCenter = null;
    this._lastProtractorRadius = 0;
    this._lastRingsCenter = null;
    this._lastRingsRadius = 0;
    this._layer = this._getOrCreateLayer();
  }

  public setOptions(opts: DrawingCueOptions): void {
    if (opts.enabled !== undefined) { opts.enabled ? this.enable() : this.disable(); }

    if (opts.closeCue !== undefined) {
      this._closeCueEnabled = opts.closeCue;
      if (!opts.closeCue) {
        this._closeFirstVertex = null;
        this._clearCloseRing();
      }
    }

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
      if (ag.showArc !== undefined) {
        this._guidesShowArc = ag.showArc;
        if (!ag.showArc) {
          for (const g of this._protractorGs) this._removeGraphic(g);
          this._protractorGs = [];
          for (const g of this._needleGs) this._removeGraphic(g);
          this._needleGs = [];
          this._lastProtractorCenter = null;
          this._lastProtractorRadius = 0;
        }
      }
      if (ag.arcRadiusKm        !== undefined) this._guidesArcRadiusKm       = ag.arcRadiusKm;
      if (ag.showFan            !== undefined) this._guidesShowFan           = ag.showFan;
      if (ag.showSnapPoint      !== undefined) this._guidesShowSnapPoint      = ag.showSnapPoint;
      if (ag.showAnchor         !== undefined) this._guidesShowAnchor        = ag.showAnchor;
      if (ag.relativeSegment    !== undefined) this._guidesRelativeSegment   = ag.relativeSegment;
      if (ag.protractorDetail   !== undefined) this._guidesProtractorDetail  = ag.protractorDetail;
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

    if (opts.magneticCompass !== undefined) {
      this._compass?.setOptions(opts.magneticCompass);
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

    // Live bearing needle — tracks cursor relative to the last control point
    if (this._guidesShowArc && this._lastCtrlPt) {
      this._updateProtractorNeedle(this._lastCtrlPt, cursor);
    } else if (!this._lastCtrlPt) {
      // cursor-centred mode: needle not applicable, clear any stale needle
      for (const g of this._needleGs) this._removeGraphic(g);
      this._needleGs = [];
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
    if (!this._ringsEnabled || this._ringsCount < 1 || this._ringsIntervalKm <= 0) return;

    const intervalKm = this._adaptiveEnabled
      ? this._computeAdaptiveIntervalKm(center)
      : this._ringsIntervalKm;

    // Skip rebuild when center hasn't moved more than ~2% of the outer ring radius
    const outerKm = this._ringsCount * intervalKm;
    const outerMapUnits = this._kmToMapUnits(outerKm, center);
    const isSameCenter = this._lastRingsCenter !== null
      && Math.abs(this._lastRingsCenter.x - center.x) < outerMapUnits * 0.02
      && Math.abs(this._lastRingsCenter.y - center.y) < outerMapUnits * 0.02;
    const isSameRadius = Math.abs(outerMapUnits - this._lastRingsRadius) < outerMapUnits * 0.01;
    if (isSameCenter && isSameRadius && this._ringGs.length > 0) return;

    for (const g of this._ringGs) this._removeGraphic(g);
    this._ringGs = [];
    this._lastRingsCenter = center;
    this._lastRingsRadius = outerMapUnits;

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
    if (!this._guidesShowArc || !this._layer || !this._view) return;

    const intervalKm = this._adaptiveEnabled
      ? this._computeAdaptiveIntervalKm(center)
      : this._ringsIntervalKm;
    const outerKm = (this._ringsCount > 0 && intervalKm > 0)
      ? this._ringsCount * intervalKm
      : this._guidesArcRadiusKm;
    const r = this._kmToMapUnits(outerKm, center);
    if (r <= 0) return;

    // Skip rebuild when center and radius are effectively unchanged
    const isSameCenter = this._lastProtractorCenter !== null
      && Math.abs(this._lastProtractorCenter.x - center.x) < r * 0.02
      && Math.abs(this._lastProtractorCenter.y - center.y) < r * 0.02;
    const isSameRadius = Math.abs(r - this._lastProtractorRadius) < r * 0.01;
    if (isSameCenter && isSameRadius && this._protractorGs.length > 0) return;

    // Rebuild — clear stale graphics first
    for (const g of this._protractorGs) this._removeGraphic(g);
    this._protractorGs = [];
    this._lastProtractorCenter = center;
    this._lastProtractorRadius = r;

    const sr  = center.spatialReference;
    const col = this._guidesLineColor;            // [R, G, B] = cyan-blue
    const add = (g: Graphic) => { this._layer!.add(g); this._protractorGs.push(g); };

    // ── Outer ring (bold) ────────────────────────────────────────────────────
    const SEGS = 360;
    const ringPts: number[][] = [];
    for (let i = 0; i <= SEGS; i++) {
      const a = (i / SEGS) * 2 * Math.PI;
      ringPts.push([center.x + r * Math.sin(a), center.y + r * Math.cos(a)]);
    }
    const ringPl = new Polyline({ spatialReference: sr });
    ringPl.addPath(ringPts);
    add(new Graphic({
      geometry: ringPl,
      symbol: new SimpleLineSymbol({ style: 'solid', color: new Color([...col, 0.70]), width: 1.8 }),
    }));

    // ── Inner concentric reference ring at 60 % radius ───────────────────────
    const rInner = r * 0.60;
    const innerPts: number[][] = [];
    for (let i = 0; i <= SEGS; i++) {
      const a = (i / SEGS) * 2 * Math.PI;
      innerPts.push([center.x + rInner * Math.sin(a), center.y + rInner * Math.cos(a)]);
    }
    const innerPl = new Polyline({ spatialReference: sr });
    innerPl.addPath(innerPts);
    add(new Graphic({
      geometry: innerPl,
      symbol: new SimpleLineSymbol({ style: 'solid', color: new Color([...col, 0.28]), width: 0.8 }),
    }));

    // ── Cardinal spokes (N / E / S / W) — thin dashed full-diameter lines ────
    for (const spokeDeg of [0, 90, 180, 270]) {
      const sRad = spokeDeg * Math.PI / 180;
      const sx   = Math.sin(sRad);
      const sy   = Math.cos(sRad);
      const spokePl = new Polyline({ spatialReference: sr });
      spokePl.addPath([
        [center.x - sx * r, center.y - sy * r],
        [center.x + sx * r, center.y + sy * r],
      ]);
      add(new Graphic({
        geometry: spokePl,
        symbol: new SimpleLineSymbol({ style: 'short-dot', color: new Color([...col, 0.22]), width: 0.7 }),
      }));
    }

    // ── Center anchor dot ────────────────────────────────────────────────────
    add(new Graphic({
      geometry: center,
      symbol: new SimpleMarkerSymbol({
        style:   'circle',
        color:   new Color([...col, 0.95]),
        size:    6,
        outline: new SimpleLineSymbol({ color: new Color([0, 0, 0, 0.8]), width: 1.2 }),
      }),
    }));

    // ── North triangle indicator at 12-o'clock ───────────────────────────────
    // A small filled triangle pointing inward just inside the outer ring
    const triBase  = r * 0.04;
    const triTip   = r * 0.88;   // tip (towards center)
    const triOuter = r * 1.02;   // base (just outside ring)
    // Triangle vertices: left, right, tip
    const triPl = new Polyline({ spatialReference: sr });
    triPl.addPath([
      [center.x - triBase, center.y + triOuter],
      [center.x + triBase, center.y + triOuter],
      [center.x,           center.y + triTip  ],
      [center.x - triBase, center.y + triOuter],   // close
    ]);
    add(new Graphic({
      geometry: triPl,
      symbol: new SimpleLineSymbol({ style: 'solid', color: new Color([255, 80, 80, 0.95]), width: 2.0 }),
    }));

    // ── Tick marks ───────────────────────────────────────────────────────────
    // Hierarchy:  5° micro | 10° minor | 30° major | 45° intercardinal | 90° cardinal
    const dirNames: Record<number, string> = {
      0: 'N', 45: 'NE', 90: 'E', 135: 'SE',
      180: 'S', 225: 'SW', 270: 'W', 315: 'NW',
    };

    const tickStep = this._guidesProtractorDetail === 'reduced' ? 10 : 5;
    for (let deg = 0; deg < 360; deg += tickStep) {
      const rad = deg * Math.PI / 180;
      const sx  = Math.sin(rad);
      const sy  = Math.cos(rad);

      const isCardinal   = deg % 90 === 0;
      const isIntercard  = deg % 45 === 0 && !isCardinal;
      const isMajor30    = deg % 30 === 0 && deg % 45 !== 0;
      const isMinor10    = deg % 10 === 0 && deg % 30 !== 0;
      const isMicro5     = !isMinor10 && !isMajor30 && !isIntercard && !isCardinal;

      const tickLen = isCardinal  ? r * 0.15
                    : isIntercard ? r * 0.11
                    : isMajor30   ? r * 0.075
                    : isMinor10   ? r * 0.045
                    :               r * 0.025;      // micro-5°
      const tickOp  = isCardinal  ? 0.95
                    : isIntercard ? 0.78
                    : isMajor30   ? 0.60
                    : isMinor10   ? 0.40
                    :               0.22;
      const tickW   = isCardinal  ? 2.2
                    : isIntercard ? 1.6
                    : isMajor30   ? 1.1
                    : isMinor10   ? 0.8
                    :               0.5;

      const tickPl = new Polyline({ spatialReference: sr });
      tickPl.addPath([
        [center.x + sx * r,            center.y + sy * r           ],
        [center.x + sx * (r-tickLen),  center.y + sy * (r-tickLen) ],
      ]);
      add(new Graphic({
        geometry: tickPl,
        symbol: new SimpleLineSymbol({ style: 'solid', color: new Color([...col, tickOp]), width: tickW }),
      }));

      // ── Cardinal / intercardinal direction labels (outside ring) ──────────
      if (dirNames[deg] !== undefined) {
        const isCard   = deg % 90 === 0;
        const fontSize = isCard ? 12 : 9;
        const outDist  = r * (isCard ? 1.28 : 1.20);
        const labelCol: [number,number,number] = isCard ? [255, 80, 80] : col;
        const labelPt  = new Point({ x: center.x + sx * outDist, y: center.y + sy * outDist, spatialReference: sr });
        add(new Graphic({
          geometry: labelPt,
          symbol: new TextSymbol({
            text:      dirNames[deg],
            font:      new Font({ size: fontSize, weight: 'bold', family: 'Helvetica' }),
            color:     new Color([...labelCol, isCard ? 1.0 : 0.82]),
            haloColor: new Color([0, 0, 0, 1]),
            haloSize:  3,
            xoffset:   0,
            yoffset:   0,
          }),
        }));
      }

      // ── Degree numbers inside ring at every 30° ───────────────────────────
      if (deg % 30 === 0) {
        const inDist = r * 0.76;
        const numPt  = new Point({ x: center.x + sx * inDist, y: center.y + sy * inDist, spatialReference: sr });
        add(new Graphic({
          geometry: numPt,
          symbol: new TextSymbol({
            text:      `${deg}°`,
            font:      new Font({ size: 8, weight: 'normal', family: 'Helvetica' }),
            color:     new Color([...col, 0.70]),
            haloColor: new Color([0, 0, 0, 1]),
            haloSize:  2,
            xoffset:   0,
            yoffset:   0,
          }),
        }));
      }
    }
  }

  /**
   * Live bearing needle — updates every pointer-move tick.
   * Draws from the last control point toward the cursor with:
   *  • a thin shaft line along the exact azimuth
   *  • a bright arrowhead dot at the ring perimeter
   *  • a halo label showing the numeric bearing
   */
  private _updateProtractorNeedle(center: Point, cursor: Point): void {
    if (!this._guidesShowArc || !this._layer) return;

    const intervalKm = this._adaptiveEnabled
      ? this._computeAdaptiveIntervalKm(center)
      : this._ringsIntervalKm;
    const outerKm = (this._ringsCount > 0 && intervalKm > 0)
      ? this._ringsCount * intervalKm
      : this._guidesArcRadiusKm;
    const r = this._kmToMapUnits(outerKm, center);
    if (r <= 0) return;

    const dx = cursor.x - center.x;
    const dy = cursor.y - center.y;
    if (Math.hypot(dx, dy) < r * 0.01) return;   // cursor too close to center

    const sr = center.spatialReference;

    // Bearing in degrees (0° = North, clockwise)
    const bearingDeg = ((Math.atan2(dx, dy) * 180 / Math.PI) + 360) % 360;
    const bearingRad = bearingDeg * Math.PI / 180;
    const nsx = Math.sin(bearingRad);
    const nsy = Math.cos(bearingRad);

    const tipX = center.x + nsx * r;
    const tipY = center.y + nsy * r;

    // Initialise the 3 needle graphics once; mutate geometry + symbol each tick
    if (this._needleGs.length === 0) {
      const shaftG = new Graphic();
      const dotG   = new Graphic();
      const labelG = new Graphic();
      this._layer.add(shaftG);
      this._layer.add(dotG);
      this._layer.add(labelG);
      this._needleGs = [shaftG, dotG, labelG];
    }
    const [shaftG, dotG, labelG] = this._needleGs;

    // Shaft
    const needlePl = new Polyline({ spatialReference: sr });
    needlePl.addPath([[center.x, center.y], [tipX, tipY]]);
    shaftG.geometry = needlePl;
    shaftG.symbol   = new SimpleLineSymbol({
      style: 'solid',
      color: new Color([255, 220, 60, 0.85]),
      width: 1.6,
    });

    // Arrowhead dot
    dotG.geometry = new Point({ x: tipX, y: tipY, spatialReference: sr });
    dotG.symbol   = new SimpleMarkerSymbol({
      style:   'circle',
      color:   new Color([255, 220, 60, 1.0]),
      size:    9,
      outline: new SimpleLineSymbol({ color: new Color([0, 0, 0, 0.9]), width: 1.5 }),
    });

    // Bearing label
    const labelDist  = r * 1.16;
    const bearingStr = `${Math.round(bearingDeg).toString().padStart(3, '0')}°`;
    labelG.geometry = new Point({
      x: center.x + nsx * labelDist,
      y: center.y + nsy * labelDist,
      spatialReference: sr,
    });
    labelG.symbol = new TextSymbol({
      text:      bearingStr,
      font:      new Font({ size: 11, weight: 'bold', family: 'Courier New' }),
      color:     new Color([255, 220, 60, 1.0]),
      haloColor: new Color([0, 0, 0, 1]),
      haloSize:  3,
      xoffset:   0,
      yoffset:   0,
    });
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

  /** Show a "close ring" over the first vertex when the cursor is within CLOSE_PX. */
  private _updateCloseCue(e: PointerEvent): void {
    if (!this._closeCueEnabled || !this._closeFirstVertex || !this._view || !this._layer) {
      this._clearCloseRing();
      return;
    }
    const screen = this._view.toScreen(this._closeFirstVertex);
    if (!screen) { this._clearCloseRing(); return; }
    const rect = (this._view.container as HTMLElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const dist = Math.hypot(px - screen.x, py - screen.y);
    if (dist > DrawingCueEngine.CLOSE_PX) { this._clearCloseRing(); return; }
    if (!this._closeRingG) {
      this._closeRingG = new Graphic({
        geometry: this._closeFirstVertex,
        symbol: new SimpleMarkerSymbol({
          style: "circle",
          color: [0, 0, 0, 0],
          size: DrawingCueEngine.CLOSE_PX * 2,
          outline: { color: [80, 220, 120, 0.95], width: 2 },
        }),
      });
      this._layer.add(this._closeRingG);
    } else {
      this._closeRingG.geometry = this._closeFirstVertex;
    }
  }

  private _clearCloseRing(): void {
    if (this._closeRingG && this._layer) this._layer.remove(this._closeRingG);
    this._closeRingG = null;
  }

  private _clearDrawingGraphics(): void {
    if (!this._layer) return;
    for (const g of [this._rbLineG, this._rbLabelG, this._coordG]) {
      if (g) this._removeGraphic(g);
    }
    for (const g of [...this._guideGs, ...this._ringGs, ...this._protractorGs, ...this._needleGs]) this._removeGraphic(g);
    this._rbLineG      = null;
    this._rbLabelG     = null;
    this._coordG       = null;
    this._guideGs      = [];
    this._ringGs       = [];
    this._protractorGs = [];
    this._needleGs     = [];
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
