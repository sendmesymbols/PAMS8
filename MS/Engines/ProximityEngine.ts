/**
 * ProximityEngine.ts
 * Shows a real-time snap indicator (dot + dashed line + distance label) while
 * drawing a symbol, connecting the cursor to the nearest point on any existing
 * graphic in the configured target layers.
 *
 * Singleton — use ProximityEngine.getInstance().
 *
 * Events emitted on document:
 *   "proximity-state-change"  – { state: "enabled"|"disabled", isEnabled: boolean }
 *   "proximity-snap"          – { coordinate: {x,y}, distance: string, unit: string }
 *   "proximity-clear"         – {}
 *   "proximity-hint"          – { message: string, phase: "idle"|"active"|"snapped"|"no-targets" }
 *                                 Contextual guidance emitted at key moments.
 *
 * Integration:
 *   - SymbolEngine calls start() once, activate() when drawing begins,
 *     deactivate() when drawing ends, and onViewChanged() on view switch.
 */

export type ProximityHintPhase = 'idle' | 'active' | 'snapped' | 'no-targets';

export interface ProximityHint {
  message: string;
  phase: ProximityHintPhase;
}

import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polyline from '@arcgis/core/geometry/Polyline';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import TextSymbol from '@arcgis/core/symbols/TextSymbol';
import Font from '@arcgis/core/symbols/Font';
import Color from '@arcgis/core/Color';
import * as geometryEngine from '@arcgis/core/geometry/geometryEngine';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import EngineLogger from '../Support/EngineLogger';

export type ProximityDistanceUnit =
  | 'feet'
  | 'miles'
  | 'kilometers'
  | 'nautical-miles'
  | 'meters'
  | 'yards';

export interface ProximityOptions {
  nearestVertex?: boolean;
  nearestCoordinate?: boolean;
  showDistance?: boolean;
  showDirection?: boolean;
  distanceUnit?: ProximityDistanceUnit;
  snapRadiusPx?: number;
  lineColor?: [number, number, number];
  lineOpacity?: number;
  lineWidth?: number;
  markerColor?: [number, number, number];
  markerSize?: number;
  fontSize?: number;
  fontColor?: [number, number, number];
}


const DIST_ABBR: Record<ProximityDistanceUnit, string> = {
  feet: "'",
  miles: 'mi',
  kilometers: 'km',
  'nautical-miles': 'nm',
  meters: 'm',
  yards: 'yd',
};

// Metres in one of each supported unit — used to convert haversine output.
const METERS_PER_UNIT: Record<ProximityDistanceUnit, number> = {
  meters: 1,
  kilometers: 1000,
  feet: 0.3048,
  yards: 0.9144,
  miles: 1609.344,
  'nautical-miles': 1852,
};

const LAYER_ID = 'ProximityGraphicsLayer';
const WGS84_RADIUS = 6378137;        // Web Mercator sphere radius (m)
const EARTH_MEAN_RADIUS = 6371008.8; // IUGG mean radius (m), for haversine

// Pre-computed spatial data per candidate for bounding-box pre-filter.
interface CandidateExtent {
  cx: number;
  cy: number;
  halfDiag: number; // half-diagonal of geometry extent in map units (0 for points)
}

class ProximityEngine {
  private static _instance: ProximityEngine;

  private _view: MapView | SceneView | null = null;
  private _isEnabled: boolean = false;
  private _isActive: boolean = false;
  private _isGeodesic: boolean = false;     // great-circle math (4326 or Web Mercator)
  private _isLatLon: boolean = false;       // wkid 4326 — coords already lon/lat
  private _isWebMercator: boolean = false;  // wkid 3857 / 102100 — project inline

  // rAF coalescer — replaces the wall-clock 30fps throttle.
  // Pointer events are stored; the next animation frame consumes the latest one.
  private _rafId: number = 0;
  private _pendingEvent: PointerEvent | null = null;
  private _containerEl: HTMLElement | null = null;

  // Hold-Alt-to-bypass snap (matches CAD/GIS convention).
  private _altPressed: boolean = false;
  private _boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private _boundKeyUp: ((e: KeyboardEvent) => void) | null = null;
  private _boundBlur: (() => void) | null = null;
  private _boundVisibilityChange: (() => void) | null = null;

  private _pointerHandle: { remove(): void } | null = null;
  private _boundPointerMove: ((e: PointerEvent) => void) | null = null;
  private _layer: GraphicsLayer | null = null;

  // The indicator graphics (created lazily, mutated in place)
  private _snapGraphic: Graphic | null = null;
  private _lineGraphic: Graphic | null = null;
  private _labelGraphic: Graphic | null = null;

  private _targetLayerIds: string[] = [];
  // Snapshot of graphics that existed when drawing started
  private _candidateSnapshot: Graphic[] = [];
  // Parallel array: pre-computed spatial extents for bounding-box pre-filter
  private _candidateExtents: CandidateExtent[] = [];

  // Pre-allocated reusable symbol objects
  private _dotSym: SimpleMarkerSymbol | null = null;
  private _lineSym: SimpleLineSymbol | null = null;
  private _txtSym: TextSymbol | null = null;

  // Event dedup — skip re-emitting when snap coord hasn't changed
  private _lastSnapX: number = NaN;
  private _lastSnapY: number = NaN;
  private _inClearedState: boolean = true;
  // Whether the indicator graphics are currently shown (vs hidden via visible=false)
  private _indicatorVisible: boolean = false;

  // Configurable options
  private _nearestVertex: boolean = true;
  private _nearestCoordinate: boolean = true;
  private _showDistance: boolean = true;
  private _showDirection: boolean = true;
  private _distUnit: ProximityDistanceUnit = 'meters';
  private _snapRadiusPx: number = 0;
  private _lineColor: [number, number, number] = [0, 120, 255];
  private _lineOpacity: number = 0.7;
  private _lineWidth: number = 1.5;
  private _markerColor: [number, number, number] = [0, 120, 255];
  private _markerSize: number = 10;
  private _fontSize: number = 12;
  private _fontColor: [number, number, number] = [255, 255, 255];

  private constructor() {}

  public static getInstance(): ProximityEngine {
    if (!ProximityEngine._instance) {
      ProximityEngine._instance = new ProximityEngine();
    }
    return ProximityEngine._instance;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  get isEnabled(): boolean {
    return this._isEnabled;
  }
  get isActive(): boolean {
    return this._isActive;
  }

  /**
   * Attach to a view and configure target layers + options.
   * Re-call after a view switch via onViewChanged().
   */
  public start(
    view: MapView | SceneView,
    targetLayerIds: string[],
    options?: ProximityOptions,
  ): void {
    this._view = view;
    this._targetLayerIds = targetLayerIds;
    this._resolveGeodesic();
    this._layer = this._getOrCreateLayer();
    if (options) this.setOptions(options);
    console.info('[ProximityEngine] started');
  }

  public enable(): void {
    if (this._isEnabled) return; // already on — don't re-emit hints/logs
    this._isEnabled = true;
    this._emitStateChange('enabled');
    this._emitHint(
      `Snap to nearest point enabled — cursor will snap to existing symbols within ` +
        (this._snapRadiusPx > 0 ? `${this._snapRadiusPx}px` : 'unlimited') +
        `. Hold Alt to bypass. Unit: ${DIST_ABBR[this._distUnit]}.`,
      'idle',
    );
    EngineLogger.success(
      'Proximity Engine',
      `Enabled — snap indicators on. Range: ${this._snapRadiusPx > 0 ? `${this._snapRadiusPx}px` : 'unlimited'}, unit: ${DIST_ABBR[this._distUnit]}. Hold Alt to bypass`,
    );
    console.info('[ProximityEngine] enabled');
  }

  public disable(): void {
    if (!this._isEnabled) return;
    this._isEnabled = false;
    this.deactivate();
    this._emitStateChange('disabled');
    this._emitHint(
      'Snap to nearest point disabled. Re-enable to snap to existing symbols while drawing.',
      'idle',
    );
    EngineLogger.nextStep('Proximity Engine', 'Disabled — re-enable before drawing to snap to existing symbols');
    console.info('[ProximityEngine] disabled');
  }

  public toggle(): boolean {
    this._isEnabled ? this.disable() : this.enable();
    return this._isEnabled;
  }

  /**
   * Called when drawing starts. Attaches the pointer-move listener.
   * Idempotent — safe to call on every onDrawProgress event.
   */
  public activate(): void {
    if (!this._isEnabled || !this._view || this._isActive) return;
    this._isActive = true;

    // Snapshot existing graphics now — anything added during this draw session
    // (the symbol being drawn) will not be in this list and won't self-snap.
    this.refreshCandidates();

    // Pre-allocate reusable symbol and geometry objects for this draw session.
    this._initReuseObjects();

    this._containerEl = this._resolveContainer();
    if (!this._containerEl) {
      this._isActive = false;
      return;
    }

    // Register at window capture phase so ArcGIS SketchViewModel interception
    // doesn't swallow the events. Each event only stashes the latest pointer
    // position and schedules a frame — the actual work runs once per rAF, which
    // coalesces bursts of moves and stays in sync with the browser's paint.
    this._boundPointerMove = (e: PointerEvent) => {
      if (!this._isActive) return;
      this._pendingEvent = e;
      if (this._rafId === 0) {
        this._rafId = requestAnimationFrame(this._processPendingFrame);
      }
    };

    // Alt held = temporary snap bypass. Power users place a point near a symbol
    // without snapping, without toggling the engine off.
    this._boundKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && !this._altPressed) {
        this._altPressed = true;
        this._clear();
        this._emitHint('Snap bypassed — release Alt to resume snapping.', 'idle');
      }
    };
    this._boundKeyUp = (e: KeyboardEvent) => {
      if (this._altPressed && !e.altKey) this._altPressed = false;
    };
    // Alt-Tab / window switch delivers the keyup elsewhere, so clear the bypass
    // when this window loses focus or becomes hidden — otherwise snapping stays
    // permanently bypassed for the rest of the draw session.
    this._boundBlur = () => {
      if (this._altPressed) this._altPressed = false;
    };
    this._boundVisibilityChange = () => {
      if (document.hidden && this._altPressed) this._altPressed = false;
    };

    window.addEventListener('pointermove', this._boundPointerMove, true);
    window.addEventListener('keydown', this._boundKeyDown, true);
    window.addEventListener('keyup', this._boundKeyUp, true);
    window.addEventListener('blur', this._boundBlur);
    document.addEventListener('visibilitychange', this._boundVisibilityChange);
    this._pointerHandle = {
      remove: () => {
        if (this._boundPointerMove) {
          window.removeEventListener('pointermove', this._boundPointerMove!, true);
          this._boundPointerMove = null;
        }
        if (this._boundKeyDown) {
          window.removeEventListener('keydown', this._boundKeyDown!, true);
          this._boundKeyDown = null;
        }
        if (this._boundKeyUp) {
          window.removeEventListener('keyup', this._boundKeyUp!, true);
          this._boundKeyUp = null;
        }
        if (this._boundBlur) {
          window.removeEventListener('blur', this._boundBlur!);
          this._boundBlur = null;
        }
        if (this._boundVisibilityChange) {
          document.removeEventListener('visibilitychange', this._boundVisibilityChange!);
          this._boundVisibilityChange = null;
        }
        if (this._rafId !== 0) {
          cancelAnimationFrame(this._rafId);
          this._rafId = 0;
        }
        this._pendingEvent = null;
        this._altPressed = false;
      },
    };

    const targetCount = this._candidateSnapshot.length;
    if (targetCount > 0) {
      this._emitHint(
        `Proximity snap active — ${targetCount} symbol${targetCount === 1 ? '' : 's'} available to snap to.`,
        'active',
      );
      EngineLogger.nextStep(
        'Proximity Engine',
        `Active — ${targetCount} symbol${targetCount === 1 ? '' : 's'} available. Move cursor near a symbol to snap`,
      );
    } else {
      this._emitHint(
        'Proximity snap active — no symbols to snap to yet. Draw symbols first, then re-enable snap.',
        'no-targets',
      );
      EngineLogger.error('Proximity Engine', 'No symbols on the map to snap to — draw some symbols first');
    }

    console.info('[ProximityEngine] activated, candidates:', targetCount);
  }

  /**
   * Consumes the most recent pointer event once per animation frame.
   * Bound as a class arrow-property so requestAnimationFrame keeps `this`.
   */
  private _processPendingFrame = (): void => {
    this._rafId = 0;
    const e = this._pendingEvent;
    this._pendingEvent = null;
    if (!e || !this._isActive || !this._view || !this._containerEl) return;

    if (this._altPressed) {
      this._clear();
      return;
    }

    // Gate on DOM containment, not a geometric bounds test. This also skips
    // events whose target is an overlay sitting on top of the map (settings
    // panel, search box, API panel) — a bounds test would treat those as map
    // hits and snap "through" the panel.
    const tgt = e.target as Node | null;
    if (!tgt || !this._containerEl.contains(tgt)) {
      this._clear();
      return;
    }

    const rect = this._containerEl.getBoundingClientRect();
    const mapPt =
      this._view.toMap({ x: e.clientX - rect.left, y: e.clientY - rect.top }) ?? null;
    if (mapPt) this._runProximity(mapPt);
    else this._clear();
  };

  /**
   * Re-snapshot the target layers without tearing down the active session.
   * Call this if graphics are added/removed mid-draw (e.g. paste during a
   * multi-click polyline) so they become snap targets immediately.
   */
  public refreshCandidates(): void {
    if (!this._isActive || !this._view) return;
    this._candidateSnapshot = [];
    this._candidateExtents = [];
    for (const id of this._targetLayerIds) {
      const lyr = this._view.map.findLayerById(id) as GraphicsLayer | undefined;
      if (!lyr) continue;
      lyr.graphics.forEach((g: Graphic) => {
        if (g.geometry) {
          this._candidateSnapshot.push(g);
          this._candidateExtents.push(this._computeCandidateExtent(g));
        }
      });
    }
  }

  /**
   * Called when drawing ends. Removes the pointer-move listener and clears graphics.
   */
  public deactivate(): void {
    if (this._pointerHandle) {
      this._pointerHandle.remove();
      this._pointerHandle = null;
    }
    this._isActive = false;
    this._candidateSnapshot = [];
    this._candidateExtents = [];
    this._containerEl = null;
    this._clear();
    this._emitHint('Proximity snap ended — drawing complete.', 'idle');
    EngineLogger.success('Proximity Engine', 'Deactivated — drawing complete');
    console.info('[ProximityEngine] deactivated');
  }

  /** Re-attach to a new view after 2D ↔ 3D switch. */
  public onViewChanged(view: MapView | SceneView): void {
    this.deactivate();
    this._view = view;
    this._resolveGeodesic();
    this._snapGraphic = null;
    this._lineGraphic = null;
    this._labelGraphic = null;
    this._dotSym = null;
    this._lineSym = null;
    this._txtSym = null;
    this._indicatorVisible = false;
    this._layer = this._getOrCreateLayer();

    console.info('[ProximityEngine] view changed');
  }

  public setOptions(opts: ProximityOptions): void {
    if (opts.nearestVertex !== undefined)
      this._nearestVertex = opts.nearestVertex;
    if (opts.nearestCoordinate !== undefined)
      this._nearestCoordinate = opts.nearestCoordinate;
    if (opts.showDistance !== undefined) this._showDistance = opts.showDistance;
    if (opts.showDirection !== undefined)
      this._showDirection = opts.showDirection;
    if (opts.distanceUnit !== undefined) this._distUnit = opts.distanceUnit;
    if (opts.snapRadiusPx !== undefined) this._snapRadiusPx = opts.snapRadiusPx;
    if (opts.lineColor !== undefined) this._lineColor = opts.lineColor;
    if (opts.lineOpacity !== undefined) this._lineOpacity = opts.lineOpacity;
    if (opts.lineWidth !== undefined) this._lineWidth = opts.lineWidth;
    if (opts.markerColor !== undefined) this._markerColor = opts.markerColor;
    if (opts.markerSize !== undefined) this._markerSize = opts.markerSize;
    if (opts.fontSize !== undefined) this._fontSize = opts.fontSize;
    if (opts.fontColor !== undefined) this._fontColor = opts.fontColor;
  }

  // ── Core logic ────────────────────────────────────────────────────────────

  private _runProximity(mapPt: Point): void {
    if (!this._view || !this._layer) return;

    const candidates = this._candidateSnapshot;
    if (candidates.length === 0) {
      this._clear();
      return;
    }

    // ── Spatial pre-filter ────────────────────────────────────────────────
    // Skip candidates whose geometry extent is farther (in map units) than the
    // search threshold, so we never run expensive geometry-engine calls on
    // distant graphics. Inlined into the main loop — no per-frame index array.
    //
    // With an explicit snap radius the threshold is that radius (+ buffer).
    // With unlimited snap (snapRadiusPx <= 0) we still bound the search to a
    // generous multiple of the view extent, which keeps the cost sane in dense
    // scenes while preserving "snap to the nearest visible thing" behaviour.
    const resolution = this._getViewResolution();
    let threshMapUnits: number;
    if (this._snapRadiusPx > 0 && resolution > 0) {
      threshMapUnits = (this._snapRadiusPx + 50) * resolution; // 50px buffer
    } else if (resolution > 0 && this._view) {
      threshMapUnits =
        Math.max(this._view.width, this._view.height) * resolution * 1.5;
    } else {
      threshMapUnits = Number.POSITIVE_INFINITY; // resolution unknown — don't cull
    }

    // ── Find nearest point across filtered candidates ─────────────────────
    let bestDist = Infinity;
    let bestCoord: Point | null = null;

    for (let i = 0; i < candidates.length; i++) {
      const ext = this._candidateExtents[i];
      if (
        ext &&
        threshMapUnits !== Number.POSITIVE_INFINITY &&
        Math.hypot(mapPt.x - ext.cx, mapPt.y - ext.cy) > threshMapUnits + ext.halfDiag
      ) {
        continue; // extent too far — skip the geometry-engine call
      }

      const g = candidates[i];
      if (!g.geometry) continue;

      const gtype = g.geometry.type;

      // Point geometry: use the coordinate directly — no engine call needed.
      if (gtype === 'point') {
        if (this._nearestVertex || this._nearestCoordinate) {
          const pt = g.geometry as Point;
          const d = this._mapDist(mapPt, pt);
          if (d < bestDist) { bestDist = d; bestCoord = pt; }
        }
        continue;
      }

      // Non-point geometry: nearestCoordinate subsumes nearestVertex
      // (every vertex is a coordinate on the geometry, so nearestCoordinate
      // will find a result at least as close). Only fall back to nearestVertex
      // when the user explicitly wants vertex-only snapping.
      if (this._nearestCoordinate) {
        try {
          const r = geometryEngine.nearestCoordinate(g.geometry, mapPt);
          if (r?.coordinate && !r.isEmpty) {
            const d = this._mapDist(mapPt, r.coordinate);
            if (d < bestDist) { bestDist = d; bestCoord = r.coordinate; }
          }
        } catch { /* unsupported geometry type */ }
      } else if (this._nearestVertex) {
        try {
          const r = geometryEngine.nearestVertex(g.geometry, mapPt);
          if (r?.coordinate && !r.isEmpty) {
            const d = this._mapDist(mapPt, r.coordinate);
            if (d < bestDist) { bestDist = d; bestCoord = r.coordinate; }
          }
        } catch { /* unsupported geometry type */ }
      }
    }

    if (!bestCoord) {
      // Emit the hint only on the transition into "no target" — otherwise it
      // would fire every frame the cursor moves over an empty area.
      const wasShowing = this._indicatorVisible;
      this._clear();
      if (wasShowing) {
        this._emitHint('No nearby symbols within snap range.', 'no-targets');
      }
      return;
    }

    // Hide indicator when nearest symbol exceeds the configured screen-pixel radius.
    // In 2D, MapView.resolution is linear, so pixels = mapDist / resolution —
    // this avoids two view.toScreen() projection calls every frame. In 3D the
    // mapping isn't linear, so fall back to the accurate toScreen() path.
    if (this._snapRadiusPx > 0) {
      const mvRes = (this._view as MapView).resolution;
      const distPx =
        typeof mvRes === 'number' && mvRes > 0
          ? bestDist / mvRes
          : this._screenDist(mapPt, bestCoord);
      if (distPx > this._snapRadiusPx) {
        this._clear();
        return;
      }
    }

    this._renderSnap(mapPt, bestCoord);
  }

  /** Euclidean distance in map-coordinate units (used for ranking candidates). */
  private _mapDist(a: Point, b: Point): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /**
   * Approximate map-units-per-pixel for the current view.
   * MapView exposes an exact, linear `resolution`. SceneView has none, so we
   * approximate from the current extent — good enough for the coarse spatial
   * pre-filter cull (which already pads with a buffer + per-candidate halfDiag).
   */
  private _getViewResolution(): number {
    if (!this._view) return 0;
    const mvRes = (this._view as MapView).resolution;
    if (typeof mvRes === 'number' && mvRes > 0) return mvRes;
    try {
      const ext = this._view.extent;
      if (ext && this._view.width > 0) {
        return (ext.xmax - ext.xmin) / this._view.width;
      }
    } catch {
      /* extent not ready */
    }
    return 0;
  }

  /** Screen-space pixel distance — used only for optional snapRadiusPx check. */
  private _screenDist(a: Point, b: Point): number {
    if (!this._view) return Infinity;
    try {
      const scrA = this._view.toScreen(a);
      const scrB = this._view.toScreen(b);
      if (!scrA || !scrB) return Infinity;
      return Math.hypot(scrA.x - scrB.x, scrA.y - scrB.y);
    } catch {
      return Infinity;
    }
  }

  /**
   * Draw or update the three indicator graphics:
   *   1. Dot at bestCoord
   *   2. Dashed line from cursor → bestCoord
   *   3. Distance label at midpoint
   *
   * Symbol objects are pre-allocated once in _initReuseObjects() and reused
   * each frame — only their mutable text/color properties are updated.
   */
  private _renderSnap(cursor: Point, snapPt: Point): void {
    if (!this._view || !this._layer) return;
    // Indicator graphics are pre-created in _initReuseObjects(); bail if missing.
    if (!this._snapGraphic || !this._lineGraphic) return;

    // Fresh geometry objects every frame — required so ArcGIS detects a new
    // reference and re-renders. Mutating the same object in place (previous
    // approach) left the line stale because the accessor setter saw no change.
    const snap = new Point({ x: snapPt.x, y: snapPt.y, spatialReference: cursor.spatialReference });
    const midPt = new Point({ x: (cursor.x + snap.x) / 2, y: (cursor.y + snap.y) / 2, spatialReference: cursor.spatialReference });
    const linePl = new Polyline({ spatialReference: cursor.spatialReference, paths: [[[cursor.x, cursor.y], [snap.x, snap.y]]] });

    // ── Compute bearing and distance once ─────────────────────────────────
    const bearing = this._calcBearing(cursor, snap);
    const bearingStr = `${Math.round(bearing)}°`;
    const distLabel = this._calcDist(cursor, snap);

    // ── 1. Dot ────────────────────────────────────────────────────────────
    this._snapGraphic.geometry = snap;
    this._snapGraphic.visible = true;

    // ── 2. Dashed line ────────────────────────────────────────────────────
    this._lineGraphic.geometry = linePl;
    this._lineGraphic.visible = true;

    // ── 3. Distance + Direction label ─────────────────────────────────────
    const labelParts: string[] = [];
    if (this._showDistance) labelParts.push(distLabel);
    if (this._showDirection) labelParts.push(bearingStr);

    if (this._labelGraphic && this._txtSym) {
      if (labelParts.length > 0) {
        this._txtSym.text = labelParts.join(' | ');
        this._labelGraphic.geometry = midPt;
        this._labelGraphic.symbol = this._txtSym;
        this._labelGraphic.visible = true;
      } else {
        this._labelGraphic.visible = false;
      }
    }

    // First hidden→shown transition this cycle: announce the lock-on once.
    if (!this._indicatorVisible) {
      this._indicatorVisible = true;
      this._emitHint('Snapped to nearest symbol — click to place point at snap target.', 'snapped');
      EngineLogger.nextStep('Proximity Engine', 'Snapped to nearest symbol — click to confirm position');
    }

    this._emitSnap(snap, distLabel);
  }

  /**
   * Hide the indicator graphics. They stay on the layer (visible=false) and are
   * re-shown on the next snap — toggling visibility avoids the full GraphicsLayer
   * redraw that add()/remove() triggers every time the cursor leaves/re-enters range.
   */
  private _clear(): void {
    if (this._snapGraphic) this._snapGraphic.visible = false;
    if (this._lineGraphic) this._lineGraphic.visible = false;
    if (this._labelGraphic) this._labelGraphic.visible = false;
    this._indicatorVisible = false;
    this._emitClear();
  }

  // ── Geometry helpers ──────────────────────────────────────────────────────

  /**
   * Distance between two map points, formatted for display.
   * Geographic / Web Mercator views use inline great-circle (haversine) math —
   * no per-frame Polyline allocation and no geometry-engine call. Planar length
   * in Web Mercator overstates ground distance badly away from the equator, so
   * we never use it there. Other projected systems fall back to the geometry
   * engine so their native units convert correctly.
   */
  private _calcDist(a: Point, b: Point): string {
    try {
      if (this._isGeodesic) {
        const [lon1, lat1] = this._toLonLat(a);
        const [lon2, lat2] = this._toLonLat(b);
        const meters = this._haversineMeters(lat1, lon1, lat2, lon2);
        return this._formatDistance(meters / METERS_PER_UNIT[this._distUnit]);
      }
      const pl = new Polyline({ spatialReference: a.spatialReference });
      pl.addPath([
        [a.x, a.y],
        [b.x, b.y],
      ]);
      const raw = geometryEngine.planarLength(pl, this._distUnit as any);
      return this._formatDistance(Math.abs(raw));
    } catch {
      return '—';
    }
  }

  /** Convert a point's coords to [lon, lat] degrees for great-circle math. */
  private _toLonLat(p: Point): [number, number] {
    if (this._isLatLon) return [p.x, p.y];
    if (this._isWebMercator) {
      const lon = (p.x / WGS84_RADIUS) * (180 / Math.PI);
      const lat =
        (Math.atan(Math.exp(p.y / WGS84_RADIUS)) * 2 - Math.PI / 2) *
        (180 / Math.PI);
      return [lon, lat];
    }
    return [p.x, p.y];
  }

  private _haversineMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;
    const s1 = Math.sin(dLat / 2);
    const s2 = Math.sin(dLon / 2);
    const aa = s1 * s1 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * s2 * s2;
    return 2 * EARTH_MEAN_RADIUS * Math.asin(Math.min(1, Math.sqrt(aa)));
  }

  /**
   * Adaptive precision: keep the label readable across magnitudes
   * (e.g. "8473 m", "84.7 m", "0.423 km") without switching the user's chosen
   * unit out from under them.
   */
  private _formatDistance(value: number): string {
    const v = Math.abs(value);
    let str: string;
    if (v >= 100) str = v.toFixed(0);
    else if (v >= 10) str = v.toFixed(1);
    else if (v >= 1) str = v.toFixed(2);
    else str = v.toFixed(3);
    return `${str} ${DIST_ABBR[this._distUnit]}`;
  }

  private _calcBearing(a: Point, b: Point): number {
    try {
      if (this._isGeodesic) {
        // Inline lon/lat — no geometryEngine.project() round-trip per frame.
        const [lon1, lat1] = this._toLonLat(a);
        const [lon2, lat2] = this._toLonLat(b);
        const dLon = (lon2 - lon1) * (Math.PI / 180);
        const rlat1 = lat1 * (Math.PI / 180);
        const rlat2 = lat2 * (Math.PI / 180);
        const y = Math.sin(dLon) * Math.cos(rlat2);
        const x =
          Math.cos(rlat1) * Math.sin(rlat2) -
          Math.sin(rlat1) * Math.cos(rlat2) * Math.cos(dLon);
        return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
      } else {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        return (Math.atan2(dx, dy) * (180 / Math.PI) + 360) % 360;
      }
    } catch {
      return 0;
    }
  }

  private _resolveGeodesic(): void {
    const wkid = this._view?.spatialReference?.wkid;
    this._isLatLon = wkid === 4326;
    this._isWebMercator = wkid === 3857 || wkid === 102100;
    // Great-circle math is meaningful for geographic & Web Mercator systems.
    // Planar length in Web Mercator overstates ground distance away from the
    // equator, so treat it as geodesic too.
    this._isGeodesic = this._isLatLon || this._isWebMercator;
  }

  /** Safely resolve view.container, which may be a string ID or an HTMLElement. */
  private _resolveContainer(): HTMLElement | null {
    if (!this._view) return null;
    const raw = this._view.container;
    if (!raw) return null;
    if (typeof raw === 'string') {
      return document.getElementById(raw);
    }
    return raw as HTMLElement;
  }

  private _getOrCreateLayer(): GraphicsLayer {
    if (!this._view)
      throw new Error('[ProximityEngine] start() must be called before use');
    let layer = this._view.map.findLayerById(LAYER_ID) as
      | GraphicsLayer
      | undefined;
    if (!layer) {
      layer = new GraphicsLayer({
        id: LAYER_ID,
        elevationInfo: { mode: 'on-the-ground' },
      });
      this._view.map.add(layer);
    }
    return layer;
  }

  /**
   * Pre-compute bounding-box center and half-diagonal for a candidate graphic.
   * Used each frame to cull distant candidates before running geometry engine calls.
   */
  private _computeCandidateExtent(g: Graphic): CandidateExtent {
    try {
      const geom = g.geometry;
      if (!geom) return { cx: 0, cy: 0, halfDiag: 0 };
      if (geom.type === 'point') {
        const pt = geom as Point;
        return { cx: pt.x, cy: pt.y, halfDiag: 0 };
      }
      const ext = geom.extent;
      if (!ext) return { cx: 0, cy: 0, halfDiag: 0 };
      return {
        cx: (ext.xmin + ext.xmax) / 2,
        cy: (ext.ymin + ext.ymax) / 2,
        halfDiag: Math.hypot(ext.xmax - ext.xmin, ext.ymax - ext.ymin) / 2,
      };
    } catch {
      return { cx: 0, cy: 0, halfDiag: 0 };
    }
  }

  /**
   * Pre-allocate reusable symbol objects and the three indicator graphics for
   * the current draw session. The graphics are added to the layer once (hidden);
   * subsequent frames toggle their visibility and swap geometry rather than
   * adding/removing, which would force a full layer redraw each time.
   */
  private _initReuseObjects(): void {
    // Symbols don't change between draw sessions — build each once and reuse it.
    // (onViewChanged() nulls them so they're rebuilt for the new view.)
    if (!this._dotSym) {
      this._dotSym = new SimpleMarkerSymbol({
        style: 'circle',
        color: new Color([255, 255, 255, 1.0]),
        size: this._markerSize,
        outline: { color: new Color([...this._markerColor, 1.0]), width: 2.5 },
      });
    }

    if (!this._lineSym) {
      this._lineSym = new SimpleLineSymbol({
        style: 'short-dash',
        color: new Color([...this._lineColor, this._lineOpacity]),
        width: this._lineWidth + 0.5,
      });
    }

    if (!this._txtSym) {
      this._txtSym = new TextSymbol({
        text: '',
        font: new Font({ size: this._fontSize, style: 'italic', weight: 'bold', family: 'Helvetica' }),
        color: new Color([...this._fontColor, 1]),
        haloColor: new Color([0, 0, 0, 1]),
        haloSize: 3,
        xoffset: 6,
        yoffset: 6,
      });
    }

    if (!this._layer) return;

    // Create the indicator graphics once and keep them on the layer (hidden).
    if (!this._snapGraphic) {
      this._snapGraphic = new Graphic({ symbol: this._dotSym, visible: false });
      this._layer.add(this._snapGraphic);
    } else {
      this._snapGraphic.symbol = this._dotSym;
      this._snapGraphic.visible = false;
    }
    if (!this._lineGraphic) {
      this._lineGraphic = new Graphic({ symbol: this._lineSym, visible: false });
      this._layer.add(this._lineGraphic);
    } else {
      this._lineGraphic.symbol = this._lineSym;
      this._lineGraphic.visible = false;
    }
    if (!this._labelGraphic) {
      this._labelGraphic = new Graphic({ symbol: this._txtSym, visible: false });
      this._layer.add(this._labelGraphic);
    } else {
      this._labelGraphic.symbol = this._txtSym;
      this._labelGraphic.visible = false;
    }
    this._indicatorVisible = false;
  }

  // ── Event helpers ─────────────────────────────────────────────────────────

  private _emitStateChange(state: 'enabled' | 'disabled'): void {
    document.dispatchEvent(
      new CustomEvent('proximity-state-change', {
        detail: { state, isEnabled: this._isEnabled },
        bubbles: true,
      }),
    );
  }

  /** Only dispatches when the snap coordinate has moved by at least 1 map unit. */
  private _emitSnap(coordinate: Point, distance: string): void {
    const dx = coordinate.x - this._lastSnapX;
    const dy = coordinate.y - this._lastSnapY;
    if (Math.hypot(dx, dy) < 1) return; // sub-unit movement — skip
    this._lastSnapX = coordinate.x;
    this._lastSnapY = coordinate.y;
    this._inClearedState = false;

    document.dispatchEvent(
      new CustomEvent('proximity-snap', {
        detail: {
          coordinate: { x: coordinate.x, y: coordinate.y },
          distance,
          unit: this._distUnit,
        },
        bubbles: true,
      }),
    );
  }

  /** Only dispatches once per cleared state — avoids flooding listeners each frame. */
  private _emitClear(): void {
    if (this._inClearedState) return;
    this._inClearedState = true;
    this._lastSnapX = NaN;
    this._lastSnapY = NaN;
    document.dispatchEvent(
      new CustomEvent('proximity-clear', { bubbles: true }),
    );
  }

  private _emitHint(message: string, phase: ProximityHintPhase): void {
    document.dispatchEvent(
      new CustomEvent('proximity-hint', {
        detail: { message, phase },
        bubbles: true,
      }),
    );
  }

  /**
   * Returns a snapshot of the engine's current operational state.
   * Useful for status indicators and debugging.
   */
  public getStatus(): {
    isEnabled: boolean;
    isActive: boolean;
    unit: ProximityDistanceUnit;
    isGeodesic: boolean;
    targetLayers: number;
    activeGraphics: number;
    snapRadiusPx: number;
  } {
    return {
      isEnabled: this._isEnabled,
      isActive: this._isActive,
      unit: this._distUnit,
      isGeodesic: this._isGeodesic,
      targetLayers: this._targetLayerIds.length,
      activeGraphics: this._layer?.graphics.length ?? 0,
      snapRadiusPx: this._snapRadiusPx,
    };
  }

  /**
   * Update configuration options at runtime.
   * Only updates options that are provided in the config object.
   */
  public updateConfig(config: Partial<ProximityOptions>): void {
    if (config.nearestVertex !== undefined)
      this._nearestVertex = config.nearestVertex;
    if (config.nearestCoordinate !== undefined)
      this._nearestCoordinate = config.nearestCoordinate;
    if (config.showDistance !== undefined)
      this._showDistance = config.showDistance;
    if (config.showDirection !== undefined)
      this._showDirection = config.showDirection;
    if (config.distanceUnit !== undefined) this._distUnit = config.distanceUnit;
    if (config.snapRadiusPx !== undefined)
      this._snapRadiusPx = config.snapRadiusPx;
    if (config.lineColor !== undefined) this._lineColor = config.lineColor;
    if (config.lineOpacity !== undefined)
      this._lineOpacity = config.lineOpacity;
    if (config.lineWidth !== undefined) this._lineWidth = config.lineWidth;
    if (config.markerColor !== undefined)
      this._markerColor = config.markerColor;
    if (config.markerSize !== undefined) this._markerSize = config.markerSize;
    if (config.fontSize !== undefined) this._fontSize = config.fontSize;
    if (config.fontColor !== undefined) this._fontColor = config.fontColor;

    if (this._isActive && this._isEnabled) {
      this._refreshIndicatorGraphics();
    }
  }

  private _refreshIndicatorGraphics(): void {
    if (!this._layer) return;

    // Update pre-allocated symbols in place — mutate nested objects rather than
    // reconstructing them each settings change.
    if (this._dotSym) {
      this._dotSym.size = this._markerSize;
      if (this._dotSym.outline) {
        this._dotSym.outline.color = new Color([...this._markerColor, 1.0]);
        this._dotSym.outline.width = 2.5;
      }
    }
    if (this._snapGraphic && this._dotSym) {
      this._snapGraphic.symbol = this._dotSym;
    }

    if (this._lineSym) {
      this._lineSym.color = new Color([...this._lineColor, this._lineOpacity]);
      this._lineSym.width = this._lineWidth + 0.5;
    }
    if (this._lineGraphic && this._lineSym) {
      this._lineGraphic.symbol = this._lineSym;
    }

    if (this._txtSym) {
      this._txtSym.font.size = this._fontSize;
      this._txtSym.color = new Color([...this._fontColor, 1]);
    }
    if (this._labelGraphic && this._txtSym) {
      this._labelGraphic.symbol = this._txtSym;
    }
  }
}

export default ProximityEngine;
