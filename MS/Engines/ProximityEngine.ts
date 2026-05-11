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
import Polygon from '@arcgis/core/geometry/Polygon';
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

const LAYER_ID = 'ProximityGraphicsLayer';

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
  private _isGeodesic: boolean = false;
  private _lastTick: number = 0;

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
    this._isEnabled = true;
    this._emitStateChange('enabled');
    this._emitHint(
      `Snap to nearest point enabled — cursor will snap to existing symbols within ` +
        (this._snapRadiusPx > 0 ? `${this._snapRadiusPx}px` : 'unlimited') +
        `. Unit: ${DIST_ABBR[this._distUnit]}.`,
      'idle',
    );
    EngineLogger.success(
      'Proximity Engine',
      `Enabled — snap indicators on. Range: ${this._snapRadiusPx > 0 ? `${this._snapRadiusPx}px` : 'unlimited'}, unit: ${DIST_ABBR[this._distUnit]}`,
    );
    console.info('[ProximityEngine] enabled');
  }

  public disable(): void {
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
    this._candidateSnapshot = [];
    this._candidateExtents = [];
    for (const id of this._targetLayerIds) {
      const lyr = this._view.map.findLayerById(id) as GraphicsLayer | undefined;
      if (lyr) {
        lyr.graphics.forEach((g: Graphic) => {
          if (g.geometry) {
            this._candidateSnapshot.push(g);
            this._candidateExtents.push(this._computeCandidateExtent(g));
          }
        });
      }
    }

    // Pre-allocate reusable symbol and geometry objects for this draw session.
    this._initReuseObjects();

    const containerEl = this._resolveContainer();
    if (!containerEl) {
      this._isActive = false;
      return;
    }

    // Register at window capture phase so ArcGIS SketchViewModel interception
    // doesn't swallow the events.
    this._boundPointerMove = (e: PointerEvent) => {
      if (!this._isActive || !this._view) return;

      const now = Date.now();
      if (now - this._lastTick < 33) return; // ~30fps — sufficient for snap UI
      this._lastTick = now;

      const rect = containerEl.getBoundingClientRect();
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        this._clear();
        return;
      }

      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const mapPt = this._view.toMap({ x, y }) ?? null;
      if (mapPt) this._runProximity(mapPt);
      else this._clear();
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
    // When a snap radius is set, skip candidates whose geometry extent center
    // is farther away (in map units) than the screen-pixel threshold allows.
    // This avoids running expensive geometry engine calls on distant graphics.
    let activeIndices: number[];
    if (this._snapRadiusPx > 0 && this._view) {
      const resolution = (this._view as any).resolution as number;
      if (resolution > 0) {
        const threshMapUnits = (this._snapRadiusPx + 50) * resolution; // 50px buffer
        activeIndices = [];
        for (let i = 0; i < candidates.length; i++) {
          const e = this._candidateExtents[i];
          if (!e || Math.hypot(mapPt.x - e.cx, mapPt.y - e.cy) <= threshMapUnits + e.halfDiag) {
            activeIndices.push(i);
          }
        }
      } else {
        activeIndices = candidates.map((_, i) => i);
      }
    } else {
      activeIndices = candidates.map((_, i) => i);
    }

    // ── Find nearest point across filtered candidates ─────────────────────
    let bestDist = Infinity;
    let bestCoord: Point | null = null;

    for (const i of activeIndices) {
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
      this._clear();
      // candidates.length > 0 is guaranteed here (checked above)
      this._emitHint('No nearby symbols within snap range.', 'no-targets');
      return;
    }

    // Hide indicator when nearest symbol exceeds the configured screen-pixel radius.
    if (this._snapRadiusPx > 0) {
      const distPx = this._screenDist(mapPt, bestCoord);
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
    if (!this._snapGraphic) {
      this._snapGraphic = new Graphic({ geometry: snap, symbol: this._dotSym! });
      this._layer.add(this._snapGraphic);
      this._emitHint('Snapped to nearest symbol — click to place point at snap target.', 'snapped');
      EngineLogger.nextStep('Proximity Engine', 'Snapped to nearest symbol — click to confirm position');
    } else {
      this._snapGraphic.geometry = snap;
    }

    // ── 2. Dashed line ────────────────────────────────────────────────────
    if (!this._lineGraphic) {
      this._lineGraphic = new Graphic({ geometry: linePl, symbol: this._lineSym! });
      this._layer.add(this._lineGraphic);
    } else {
      this._lineGraphic.geometry = linePl;
    }

    // ── 3. Distance + Direction label ─────────────────────────────────────
    const labelParts: string[] = [];
    if (this._showDistance) labelParts.push(distLabel);
    if (this._showDirection) labelParts.push(bearingStr);

    if (labelParts.length > 0 && this._txtSym) {
      this._txtSym.text = labelParts.join(' | ');
      if (!this._labelGraphic) {
        this._labelGraphic = new Graphic({ geometry: midPt, symbol: this._txtSym });
        this._layer.add(this._labelGraphic);
      } else {
        this._labelGraphic.geometry = midPt;
        this._labelGraphic.symbol = this._txtSym;
      }
    }

    this._emitSnap(snap, distLabel);
  }

  /** Remove all indicator graphics from the layer. Re-created lazily on next snap. */
  private _clear(): void {
    if (!this._layer) return;
    if (this._snapGraphic) {
      this._layer.remove(this._snapGraphic);
      this._snapGraphic = null;
    }
    if (this._lineGraphic) {
      this._layer.remove(this._lineGraphic);
      this._lineGraphic = null;
    }
    if (this._labelGraphic) {
      this._layer.remove(this._labelGraphic);
      this._labelGraphic = null;
    }
    this._emitClear();
  }

  // ── Geometry helpers ──────────────────────────────────────────────────────

  private _calcDist(a: Point, b: Point): string {
    try {
      const pl = new Polyline({ spatialReference: a.spatialReference });
      pl.addPath([
        [a.x, a.y],
        [b.x, b.y],
      ]);
      const raw = this._isGeodesic
        ? geometryEngine.geodesicLength(pl, this._distUnit as any)
        : geometryEngine.planarLength(pl, this._distUnit as any);
      return `${Math.abs(raw).toFixed(1)} ${DIST_ABBR[this._distUnit]}`;
    } catch {
      return '—';
    }
  }

  private _calcBearing(a: Point, b: Point): number {
    try {
      if (this._isGeodesic) {
        // When the view is already WGS84 (wkid 4326), coordinates are lon/lat —
        // no reprojection needed. Skip the two geometryEngine.project() calls.
        let lon1: number, lat1: number, lon2: number, lat2: number;
        if (a.spatialReference?.wkid === 4326) {
          lon1 = a.x; lat1 = a.y;
          lon2 = b.x; lat2 = b.y;
        } else {
          const geoPt1 = geometryEngine.project(
            new Point({ x: a.x, y: a.y, spatialReference: a.spatialReference }),
            { wkid: 4326 },
          ) as Point | null;
          const geoPt2 = geometryEngine.project(
            new Point({ x: b.x, y: b.y, spatialReference: b.spatialReference }),
            { wkid: 4326 },
          ) as Point | null;
          if (!geoPt1 || !geoPt2) return 0;
          lon1 = geoPt1.x; lat1 = geoPt1.y;
          lon2 = geoPt2.x; lat2 = geoPt2.y;
        }
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
    const sr = this._view?.spatialReference;
    this._isGeodesic = sr?.wkid === 4326;
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
   * Pre-allocate reusable symbol objects for the current draw session.
   * Subsequent frames mutate these in place rather than constructing new instances.
   */
  private _initReuseObjects(): void {
    this._dotSym = new SimpleMarkerSymbol({
      style: 'circle',
      color: new Color([255, 255, 255, 1.0]),
      size: this._markerSize,
      outline: { color: new Color([...this._markerColor, 1.0]), width: 2.5 },
    });

    this._lineSym = new SimpleLineSymbol({
      style: 'short-dash',
      color: new Color([...this._lineColor, this._lineOpacity]),
      width: this._lineWidth + 0.5,
    });

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

    // Update pre-allocated symbols in place
    if (this._dotSym) {
      this._dotSym.size = this._markerSize;
      this._dotSym.outline = new SimpleLineSymbol({
        color: new Color([...this._markerColor, 1.0]),
        width: 2.5,
      });
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
      this._txtSym.font = new Font({ size: this._fontSize, family: 'Helvetica', style: 'italic', weight: 'bold' });
      this._txtSym.color = new Color([...this._fontColor, 1]);
    }
    if (this._labelGraphic && this._txtSym) {
      this._labelGraphic.symbol = this._txtSym;
    }
  }
}

export default ProximityEngine;
