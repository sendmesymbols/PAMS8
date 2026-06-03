import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import GraphicsLayerManager, {
  LAYER_NAMES,
  SYMBOL_LAYER_IDS,
} from "../../Managers/GraphicsLayerManager";
import settingsData from "../../Data/Settings.json";
import { getEchelonCode } from "./echelon";
import { SpatialIndex } from "./SpatialIndex";

// Approximate Web Mercator scale at zoom 0 (used for minScale conversion)
const BASE_SCALE = 591657550.5;
// Debounce window for batching graphics-change events
const GRAPHIC_BATCH_MS = 100;
// Debounce window for solve pipeline (coalesces zoom + pan + add bursts)
const SOLVE_DEBOUNCE_MS = 200;
// SpatialIndex cell size — 64px keeps neighbor scans tight without
// fragmenting the bucket map too much.
const INDEX_CELL_PX = 64;

type AnnotMode = "off" | "zoom" | "minscale" | "density";
type Handle = { remove(): void };

/**
 * Context passed to every solve step. Read-only from the step's perspective:
 * the step may toggle graphic visibility or push aggregate graphics into a
 * separate layer, but it must not mutate the index.
 */
export interface SolveContext {
  view: MapView | SceneView;
  index: SpatialIndex;
  zoom: number;
  zoomInt: number;
}

export type SolveStep = (ctx: SolveContext) => void;

/** Stats dispatched after every solve pass for the perf HUD. */
export interface SolveStats {
  solveMs: number;
  indexSize: number;
  perStepMs: Record<string, number>;
  zoom: number;
  timestamp: number;
}

export interface DeclutterOptions {
  enabled?: boolean;
  annotations?: {
    mode?: AnnotMode;
    zoomThreshold?: number;
    densityMinPx?: number;
    fadeMs?: number;
  };
  symbols?: {
    hideBelow?: boolean;
    zoomThreshold?: number;
    echelonBased?: boolean;
    fadeMs?: number;
  };
}

export class DeclutterEngine {
  private _getView: () => MapView | SceneView;
  private _layerManager: GraphicsLayerManager;
  private _zoomWatcher: Handle | null = null;
  private _stationaryWatcher: Handle | null = null;
  private _graphicsWatchers = new Map<string, Handle>();
  private _enabled = false;

  // RAF handle per layer id (cancel in-flight fades when a new one starts)
  private _fadeHandles = new Map<string, number>();
  // Track last integer zoom so echelon re-eval only runs on integer zoom changes
  private _lastZoomInt = -1;
  // Track last annotation mode so we can reset state on mode change
  private _lastAnnotMode: AnnotMode | null = null;
  // Pending batched-graphic-change layers and timer
  private _dirtyLayers = new Set<string>();
  private _dirtyTimer: number | null = null;

  // Solve pipeline (Phase 1 foundation) — dormant until a step registers
  private _spatialIndex = new SpatialIndex(INDEX_CELL_PX);
  private _solveSteps = new Map<string, SolveStep>();
  private _solveTimer: number | null = null;
  // Set whenever graphics are added/removed (or the view switches) so the next
  // solve rebuilds the index even though the view fingerprint hasn't changed.
  private _indexDirty = false;

  constructor(viewProvider: () => MapView | SceneView, layerManager: GraphicsLayerManager) {
    this._getView = viewProvider;
    this._layerManager = layerManager;
    this._attachZoomWatcher();
    this._attachStationaryWatcher();
    this._attachGraphicsWatchers();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  enable(): void {
    this._enabled = true;
    const zoom = this._getView()?.zoom;
    if (zoom !== undefined) this._onZoomChange(zoom);
    this._scheduleSolve();
  }

  disable(): void {
    this._enabled = false;
    if (this._solveTimer !== null) {
      clearTimeout(this._solveTimer);
      this._solveTimer = null;
    }
    this._spatialIndex.clear();
    this._reset();
  }

  /** Re-read settings and re-apply declutter at the current zoom level. */
  refresh(): void {
    const d = (settingsData as any).declutter;
    if (!d || d.enabled === false) {
      this._reset();
      return;
    }
    this._enabled = true;
    this._lastZoomInt = -1; // force echelon re-eval
    const zoom = this._getView()?.zoom;
    if (zoom !== undefined) this._onZoomChange(zoom);
    this._scheduleSolve();
  }

  /** Call when the map view switches between 2D and 3D. */
  onViewChanged(newView: MapView | SceneView, newLayerManager?: GraphicsLayerManager): void {
    // 2D and 3D resolve to *different* GraphicsLayerManager instances, so the
    // captured manager is stale after a switch. Adopt the new one before the
    // watchers (which read this._layerManager) and any solve re-attach.
    if (newLayerManager) this._layerManager = newLayerManager;
    // The new view's layers are a different graphics set — force a rebuild.
    this._indexDirty = true;
    this._spatialIndex.clear();
    this._attachZoomWatcher();
    this._attachStationaryWatcher();
    this._attachGraphicsWatchers();
    const zoom = newView?.zoom;
    if (this._enabled && zoom !== undefined) {
      this._onZoomChange(zoom);
      this._scheduleSolve();
    }
  }

  destroy(): void {
    this._zoomWatcher?.remove();
    this._zoomWatcher = null;
    this._stationaryWatcher?.remove();
    this._stationaryWatcher = null;
    this._graphicsWatchers.forEach(h => h.remove());
    this._graphicsWatchers.clear();
    if (this._dirtyTimer !== null) {
      clearTimeout(this._dirtyTimer);
      this._dirtyTimer = null;
    }
    if (this._solveTimer !== null) {
      clearTimeout(this._solveTimer);
      this._solveTimer = null;
    }
    this._solveSteps.clear();
    this._spatialIndex.clear();
    this._reset();
  }

  // -------------------------------------------------------------------------
  // Solve pipeline API (Phase 1 foundation)
  //
  // Future declutter engines (cluster, label placer, marker disperser, etc.)
  // register themselves as solve steps. The pipeline does **nothing** when
  // no steps are registered, so this whole foundation is zero-cost for
  // anyone not opted in.
  // -------------------------------------------------------------------------

  /**
   * Register a named solve step. Calling twice with the same name replaces
   * the previous step. Steps run in insertion order on each solve pass.
   */
  registerSolveStep(name: string, step: SolveStep): void {
    this._solveSteps.set(name, step);
    if (this._enabled) this._scheduleSolve();
  }

  unregisterSolveStep(name: string): void {
    this._solveSteps.delete(name);
  }

  /** External trigger — engines call this after mutating their own state. */
  requestSolve(): void {
    if (this._enabled) this._scheduleSolve();
  }

  /** Read-only access for solve steps that need richer queries between passes. */
  get spatialIndex(): SpatialIndex {
    return this._spatialIndex;
  }

  // -------------------------------------------------------------------------
  // Watchers
  // -------------------------------------------------------------------------

  private _attachZoomWatcher(): void {
    this._zoomWatcher?.remove();
    this._zoomWatcher = reactiveUtils.watch(
      () => this._getView()?.zoom,
      (zoom: number | undefined) => {
        if (zoom !== undefined) this._onZoomChange(zoom);
      }
    );
  }

  /** Pan-aware re-evaluation: density mode needs to re-bin on pan. */
  private _attachStationaryWatcher(): void {
    this._stationaryWatcher?.remove();
    this._stationaryWatcher = reactiveUtils.watch(
      () => this._getView()?.stationary,
      (stationary: boolean | undefined) => {
        if (!stationary || !this._enabled) return;
        const d = (settingsData as any).declutter;
        if (d?.annotations?.mode === "density") this._annotDensity();
        this._scheduleSolve();
      }
    );
  }

  /**
   * Watch each symbol layer's graphics collection so newly added graphics
   * inherit current declutter rules without waiting for the next zoom change.
   */
  private _attachGraphicsWatchers(): void {
    this._graphicsWatchers.forEach(h => h.remove());
    this._graphicsWatchers.clear();

    const watchLayer = (layerId: string) => {
      const layer = this._layerManager.getLayer(layerId);
      if (!layer || !layer.graphics) return;
      const handle = layer.graphics.on("change", (evt: { added?: Graphic[]; removed?: Graphic[] }) => {
        if (!this._enabled) return;
        if (!evt.added?.length && !evt.removed?.length) return;
        // Membership changed — the spatial index must be rebuilt next solve,
        // even if the view hasn't moved (otherwise new graphics are invisible
        // to cluster/disperse/ladder/label steps until the next pan/zoom).
        this._indexDirty = true;
        this._dirtyLayers.add(layerId);
        this._scheduleDirtyFlush();
      });
      this._graphicsWatchers.set(layerId, handle);
    };

    SYMBOL_LAYER_IDS.forEach(watchLayer);
    watchLayer(LAYER_NAMES.ANNOTATION_LAYER);
  }

  /** Coalesce bursts of graphic adds into a single re-solve pass. */
  private _scheduleDirtyFlush(): void {
    if (this._dirtyTimer !== null) return;
    this._dirtyTimer = window.setTimeout(() => {
      this._dirtyTimer = null;
      const layers = Array.from(this._dirtyLayers);
      this._dirtyLayers.clear();
      this._flushDirtyLayers(layers);
    }, GRAPHIC_BATCH_MS);
  }

  private _flushDirtyLayers(layerIds: string[]): void {
    const view = this._getView();
    const zoom = view?.zoom;
    if (zoom === undefined) return;
    const d = (settingsData as any).declutter;
    if (!d || d.enabled === false) return;

    const zoomInt = Math.floor(zoom);
    const echelonOn = d?.symbols?.echelonBased === true;
    const hideOn = d?.symbols?.hideBelow === true;
    const hideThreshold = d?.symbols?.zoomThreshold ?? 5;
    const symbolsShouldShow = !hideOn || zoom >= hideThreshold;
    const visibleEchelons = echelonOn ? this._visibleEchelonsForZoom(zoomInt) : null;

    for (const layerId of layerIds) {
      const layer = this._layerManager.getLayer(layerId);
      if (!layer) continue;

      if (layerId === LAYER_NAMES.ANNOTATION_LAYER) {
        // Annotation mode handles its own visibility on zoom; on add we just
        // re-run the active mode against the new graphics.
        const mode: AnnotMode = d?.annotations?.mode ?? "off";
        if (mode === "density") this._annotDensity();
        // zoom/minscale/off modes affect the layer as a whole — adds inherit.
        continue;
      }

      // Symbol layer — apply current per-graphic visibility rules
      layer.graphics.forEach((g: Graphic) => {
        const echOk = visibleEchelons === null
          ? true
          : visibleEchelons.includes(this._getEchelon(g));
        g.visible = symbolsShouldShow && echOk;
      });
    }

    this._syncAnnotationsToSymbolVisibility();
    this._scheduleSolve();
  }

  // -------------------------------------------------------------------------
  // Solve pipeline (internal)
  // -------------------------------------------------------------------------

  /** Debounced trigger — coalesces zoom + pan + add bursts. */
  private _scheduleSolve(): void {
    if (this._solveSteps.size === 0) return;       // dormant — no consumers
    if (this._solveTimer !== null) return;          // already scheduled
    this._solveTimer = window.setTimeout(() => {
      this._solveTimer = null;
      this._runSolve();
    }, SOLVE_DEBOUNCE_MS);
  }

  private _runSolve(): void {
    if (!this._enabled || this._solveSteps.size === 0) return;

    const view = this._getView();
    const zoom = view?.zoom;
    if (!view || zoom === undefined) return;

    const tStart = performance.now();

    // Rebuild the index when the view has moved, when it's empty, or when
    // graphics were added/removed since the last solve (_indexDirty). The
    // dirty flag is essential: graphics-add bursts don't change the view
    // fingerprint, so without it new symbols never enter the index while the
    // map is stationary. Cheap: O(N) single pass.
    if (this._spatialIndex.isStale(view) || this._spatialIndex.size === 0 || this._indexDirty) {
      const sources = SYMBOL_LAYER_IDS.map(layerId => {
        const layer = this._layerManager.getLayer(layerId);
        return {
          layerId,
          graphics: (layer?.graphics?.toArray?.() ?? []) as Graphic[],
        };
      });
      this._spatialIndex.rebuild(sources, view);
      this._indexDirty = false;
    }

    const ctx: SolveContext = {
      view,
      index: this._spatialIndex,
      zoom,
      zoomInt: Math.floor(zoom),
    };

    const perStepMs: Record<string, number> = {};

    // Run steps in insertion order. Wrap each in a try/catch so one bad
    // step can't halt the pipeline for the others.
    for (const [name, step] of this._solveSteps) {
      const tStep = performance.now();
      try {
        step(ctx);
      } catch (err) {
        console.error(`[DeclutterEngine] solve step "${name}" failed`, err);
      }
      perStepMs[name] = performance.now() - tStep;
    }

    // Stats event for the perf HUD. Cheap to dispatch even with no
    // listeners — the document event system early-outs.
    const stats: SolveStats = {
      solveMs:   performance.now() - tStart,
      indexSize: this._spatialIndex.size,
      perStepMs,
      zoom,
      timestamp: Date.now(),
    };
    document.dispatchEvent(new CustomEvent("declutter-solve-stats", { detail: stats }));
  }

  // -------------------------------------------------------------------------
  // Main dispatch
  // -------------------------------------------------------------------------

  private _onZoomChange(zoom: number): void {
    const d = (settingsData as any).declutter;
    if (!d || d.enabled === false) return;

    this._applyAnnotations(zoom);

    const zoomInt = Math.floor(zoom);
    if (zoomInt !== this._lastZoomInt) {
      this._lastZoomInt = zoomInt;
      this._applySymbols(zoomInt);
    } else {
      // Same integer zoom — still need to handle fractional crossing of the
      // hideBelow threshold (e.g. 4.9 → 5.1 with threshold=5 changes show state).
      if (d?.symbols?.hideBelow) this._symbolZoomHide(zoom);
    }
  }

  // -------------------------------------------------------------------------
  // Annotation declutter
  // -------------------------------------------------------------------------

  private _applyAnnotations(zoom: number): void {
    const d = (settingsData as any).declutter;
    const mode: AnnotMode = d?.annotations?.mode ?? "off";

    // Mode-switch cleanup: clear state left behind by the previous mode
    if (this._lastAnnotMode !== null && this._lastAnnotMode !== mode) {
      this._cleanupAnnotMode(this._lastAnnotMode);
    }
    this._lastAnnotMode = mode;

    switch (mode) {
      case "zoom":     this._annotZoomThreshold(zoom); break;
      case "minscale": this._annotMinScale(); break;
      case "density":  this._annotDensity(); break;
      default:         this._annotOff(); break;
    }
  }

  /** Undo side-effects left by `prevMode` so the next mode starts clean. */
  private _cleanupAnnotMode(prevMode: AnnotMode): void {
    const annotLayer = this._layerManager.getOrCreateLayer(LAYER_NAMES.ANNOTATION_LAYER);
    if (!annotLayer) return;

    if (prevMode === "minscale") {
      (annotLayer as any).minScale = 0;
    }
    if (prevMode === "density") {
      annotLayer.graphics.forEach((g: Graphic) => { g.visible = true; });
    }
  }

  private _annotZoomThreshold(zoom: number): void {
    const d = (settingsData as any).declutter;
    const threshold = d?.annotations?.zoomThreshold ?? 8;
    const fadeMs    = d?.annotations?.fadeMs        ?? 400;
    const annotLayer = this._layerManager.getOrCreateLayer(LAYER_NAMES.ANNOTATION_LAYER);
    if (!annotLayer) return;

    const shouldShow = zoom >= threshold;
    const targetOpacity = shouldShow ? 1 : 0;
    const alreadyCorrect =
      annotLayer.visible === shouldShow &&
      annotLayer.opacity === targetOpacity;
    if (alreadyCorrect) return;

    const fromOpacity = annotLayer.opacity;

    this._fadeLayer(LAYER_NAMES.ANNOTATION_LAYER, annotLayer, fromOpacity, targetOpacity, fadeMs, () => {
      if (!shouldShow) annotLayer.visible = false;
    });

    // Make visible immediately when fading IN so graphics appear during the transition
    if (shouldShow) annotLayer.visible = true;
  }

  private _annotMinScale(): void {
    const d = (settingsData as any).declutter;
    const threshold = d?.annotations?.zoomThreshold ?? 8;
    const annotLayer = this._layerManager.getOrCreateLayer(LAYER_NAMES.ANNOTATION_LAYER);
    if (!annotLayer) return;
    (annotLayer as any).minScale = BASE_SCALE / Math.pow(2, threshold);
    annotLayer.visible = true;
    annotLayer.opacity = 1;
  }

  private _annotDensity(): void {
    const d = (settingsData as any).declutter;
    const cellSize   = d?.annotations?.densityMinPx ?? 30;
    const annotLayer = this._layerManager.getOrCreateLayer(LAYER_NAMES.ANNOTATION_LAYER);
    const view       = this._getView();
    if (!annotLayer || !view) return;

    const grid = new Map<string, boolean>();
    annotLayer.graphics.forEach((g: Graphic) => {
      const geom = g.geometry as Point | null;
      if (!geom) { g.visible = true; return; }

      let screenPt: { x: number; y: number } | null | undefined;
      try {
        screenPt = view.toScreen(geom);
      } catch {
        g.visible = true;
        return;
      }
      if (!screenPt) { g.visible = true; return; }

      const key = `${Math.floor(screenPt.x / cellSize)},${Math.floor(screenPt.y / cellSize)}`;
      if (grid.has(key)) {
        g.visible = false;
      } else {
        grid.set(key, true);
        g.visible = true;
      }
    });

    annotLayer.visible = true;
    annotLayer.opacity = 1;
  }

  private _annotOff(): void {
    const annotLayer = this._layerManager.getOrCreateLayer(LAYER_NAMES.ANNOTATION_LAYER);
    if (!annotLayer) return;
    (annotLayer as any).minScale = 0;
    annotLayer.visible = true;
    annotLayer.opacity = 1;
    annotLayer.graphics.forEach((g: Graphic) => { g.visible = true; });
  }

  // -------------------------------------------------------------------------
  // Symbol declutter
  // -------------------------------------------------------------------------

  private _applySymbols(zoomInt: number): void {
    const d = (settingsData as any).declutter;

    if (d?.symbols?.echelonBased) {
      this._applyEchelon(zoomInt);
    }

    if (d?.symbols?.hideBelow) {
      // hideBelow uses raw (fractional) zoom for threshold crossing
      const zoom = this._getView()?.zoom;
      if (zoom !== undefined) this._symbolZoomHide(zoom);
    }
  }

  /** Build the list of visible echelon codes at a given integer zoom. */
  private _visibleEchelonsForZoom(zoomInt: number): string[] | null {
    const echelonMap = (settingsData as any).ZoomLvlEchelon;
    if (!echelonMap) return null;

    const sortedKeys = Object.keys(echelonMap).map(Number).sort((a, b) => a - b);
    let mapKey = sortedKeys[0];
    for (const k of sortedKeys) {
      if (k <= zoomInt) mapKey = k;
    }
    return echelonMap[String(mapKey)] ?? null;
  }

  /**
   * Show/hide symbols based on their echelon and the ZoomLvlEchelon map.
   * Echelon "00" (no echelon assigned) is always treated as visible.
   * Single-pass: collects desired state and only flashes if at least one
   * graphic actually changes.
   */
  private _applyEchelon(zoomInt: number): void {
    const visibleEchelons = this._visibleEchelonsForZoom(zoomInt);
    const fadeMs = (settingsData as any).declutter?.symbols?.fadeMs ?? 300;

    SYMBOL_LAYER_IDS.forEach(layerName => {
      const layer = this._layerManager.getLayer(layerName);
      if (!layer) return;

      // Single pass: compute desired visibility, collect dirty graphics
      const updates: Array<{ g: Graphic; visible: boolean }> = [];
      layer.graphics.forEach((g: Graphic) => {
        const shouldShow = visibleEchelons === null ? true : visibleEchelons.includes(this._getEchelon(g));
        if (g.visible !== shouldShow) {
          updates.push({ g, visible: shouldShow });
        }
      });

      if (updates.length === 0) return;

      // Flash-fade: fade out → apply all updates → fade in
      this._flashLayer(layerName, layer, fadeMs, () => {
        for (const u of updates) u.g.visible = u.visible;
      });
    });

    // Keep annotation layer in sync: hide labels whose parent symbol is hidden
    this._syncAnnotationsToSymbolVisibility();
  }

  /** Delegates to the shared echelon parser in ./echelon. */
  private _getEchelon(g: Graphic): string {
    return getEchelonCode(g);
  }

  /** After echelon visibility is applied, hide annotations for hidden parent symbols. */
  private _syncAnnotationsToSymbolVisibility(): void {
    const annotLayer = this._layerManager.getOrCreateLayer(LAYER_NAMES.ANNOTATION_LAYER);
    if (!annotLayer) return;

    // Collect IDs of all currently visible symbols across all layers
    const visibleIds = new Set<string>();
    SYMBOL_LAYER_IDS.forEach(layerName => {
      const layer = this._layerManager.getLayer(layerName);
      if (!layer) return;
      layer.graphics.forEach((g: Graphic) => {
        if (g.visible !== false) {
          const id = g.attributes?.id;
          if (id) visibleIds.add(String(id));
        }
      });
    });

    annotLayer.graphics.forEach((ag: Graphic) => {
      const parentId = ag.attributes?.parentId;
      if (parentId) ag.visible = visibleIds.has(String(parentId));
    });
  }

  /**
   * Fade symbol layers in/out at the hideBelow zoom threshold.
   * Checks both visible AND opacity so a stale fade (opacity=0, visible=true)
   * doesn't cause a no-op when the layer should be showing.
   */
  private _symbolZoomHide(zoom: number): void {
    const d = (settingsData as any).declutter;
    const threshold = d?.symbols?.zoomThreshold ?? 5;
    const fadeMs    = d?.symbols?.fadeMs        ?? 400;
    const show      = zoom >= threshold;
    const targetOp  = show ? 1 : 0;

    SYMBOL_LAYER_IDS.forEach(layerName => {
      const layer = this._layerManager.getLayer(layerName);
      if (!layer) return;

      const alreadyCorrect = layer.visible === show && layer.opacity === targetOp;
      if (alreadyCorrect) return;

      const fromOp = layer.opacity;
      this._fadeLayer(layerName, layer, fromOp, targetOp, fadeMs, () => {
        if (!show) layer.visible = false;
      });
      if (show) layer.visible = true;
    });
  }

  // -------------------------------------------------------------------------
  // Reset everything to default visible state
  // -------------------------------------------------------------------------

  private _reset(): void {
    // Cancel all in-flight animations
    this._fadeHandles.forEach(handle => cancelAnimationFrame(handle));
    this._fadeHandles.clear();
    this._lastZoomInt = -1;
    this._lastAnnotMode = null;

    const annotLayer = this._layerManager.getOrCreateLayer(LAYER_NAMES.ANNOTATION_LAYER);
    if (annotLayer) {
      (annotLayer as any).minScale = 0;
      annotLayer.visible = true;
      annotLayer.opacity = 1;
      annotLayer.graphics.forEach((g: Graphic) => { g.visible = true; });
    }

    SYMBOL_LAYER_IDS.forEach(layerName => {
      const layer = this._layerManager.getLayer(layerName);
      if (layer) {
        layer.visible = true;
        layer.opacity = 1;
        layer.graphics.forEach((g: Graphic) => { g.visible = true; });
      }
    });
  }

  // -------------------------------------------------------------------------
  // Animation helpers  (requestAnimationFrame-based)
  // -------------------------------------------------------------------------

  /**
   * Smoothly animate a GraphicsLayer's opacity from `from` to `to` over `ms` milliseconds.
   * Uses an ease-in-out curve. Cancels any previous animation on the same layer.
   */
  private _fadeLayer(
    layerId: string,
    layer: GraphicsLayer,
    from: number,
    to: number,
    ms: number,
    onComplete?: () => void
  ): void {
    // Cancel any in-flight animation on this layer
    const prev = this._fadeHandles.get(layerId);
    if (prev !== undefined) cancelAnimationFrame(prev);

    layer.opacity = from;
    layer.visible = true;

    const start = performance.now();
    const animate = (now: number) => {
      const t = Math.min((now - start) / ms, 1);
      // Ease-in-out quadratic
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      layer.opacity = from + (to - from) * ease;

      if (t < 1) {
        this._fadeHandles.set(layerId, requestAnimationFrame(animate));
      } else {
        layer.opacity = to;
        this._fadeHandles.delete(layerId);
        onComplete?.();
      }
    };

    this._fadeHandles.set(layerId, requestAnimationFrame(animate));
  }

  /**
   * Flash-update a layer: fade out → run updateFn → fade back in.
   * This gives a smooth "scene refresh" effect when bulk symbol visibility changes.
   */
  private _flashLayer(
    layerId: string,
    layer: GraphicsLayer,
    ms: number,
    updateFn: () => void
  ): void {
    const half = Math.max(ms / 2, 80);
    this._fadeLayer(layerId, layer, 1, 0, half, () => {
      updateFn();
      this._fadeLayer(layerId, layer, 0, 1, half);
    });
  }
}

export default DeclutterEngine;
