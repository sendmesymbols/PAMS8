import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import GraphicsLayerManager, { LAYER_NAMES } from "../../Managers/GraphicsLayerManager";
import settingsData from "../../Data/Settings.json";

const SYMBOL_LAYERS = [LAYER_NAMES.FORCE, LAYER_NAMES.TACT_PT, LAYER_NAMES.TACT] as const;
// Approximate Web Mercator scale at zoom 0 (used for minScale conversion)
const BASE_SCALE = 591657550.5;

export interface DeclutterOptions {
  enabled?: boolean;
  annotations?: {
    mode?: "off" | "zoom" | "minscale" | "density";
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
  private _zoomWatcher: { remove(): void } | null = null;
  private _enabled = false;
  // RAF handle per layer id (cancel in-flight fades when a new one starts)
  private _fadeHandles = new Map<string, number>();
  // Track last integer zoom so echelon re-eval only runs on integer zoom changes
  private _lastZoomInt = -1;

  constructor(viewProvider: () => MapView | SceneView, layerManager: GraphicsLayerManager) {
    this._getView = viewProvider;
    this._layerManager = layerManager;
    this._attachZoomWatcher();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  enable(): void {
    this._enabled = true;
    const zoom = this._getView()?.zoom;
    if (zoom !== undefined) this._onZoomChange(zoom);
  }

  disable(): void {
    this._enabled = false;
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
  }

  /** Call when the map view switches between 2D and 3D. */
  onViewChanged(newView: MapView | SceneView): void {
    this._zoomWatcher?.remove();
    this._attachZoomWatcher();
    const zoom = newView?.zoom;
    if (this._enabled && zoom !== undefined) this._onZoomChange(zoom);
  }

  destroy(): void {
    this._zoomWatcher?.remove();
    this._zoomWatcher = null;
    this._reset();
  }

  // -------------------------------------------------------------------------
  // Zoom watcher
  // -------------------------------------------------------------------------

  private _attachZoomWatcher(): void {
    this._zoomWatcher = reactiveUtils.watch(
      () => this._getView()?.zoom,
      (zoom: number) => {
        if (zoom !== undefined) this._onZoomChange(zoom);
      }
    );
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
    }
  }

  // -------------------------------------------------------------------------
  // Annotation declutter
  // -------------------------------------------------------------------------

  private _applyAnnotations(zoom: number): void {
    const d = (settingsData as any).declutter;
    switch (d?.annotations?.mode ?? "off") {
      case "zoom":     this._annotZoomThreshold(zoom); break;
      case "minscale": this._annotMinScale(); break;
      case "density":  this._annotDensity(); break;
      default:         this._annotOff(); break;
    }
  }

  private _annotZoomThreshold(zoom: number): void {
    const d = (settingsData as any).declutter;
    const threshold = d?.annotations?.zoomThreshold ?? 8;
    const fadeMs    = d?.annotations?.fadeMs        ?? 400;
    const annotLayer = this._layerManager.getOrCreateLayer(LAYER_NAMES.ANNOTATION_LAYER);
    if (!annotLayer) return;

    const shouldShow = zoom >= threshold;
    const alreadyCorrect =
      annotLayer.visible === shouldShow &&
      annotLayer.opacity === (shouldShow ? 1 : 0);
    if (alreadyCorrect) return;

    const fromOpacity = annotLayer.opacity;
    const toOpacity   = shouldShow ? 1 : 0;

    this._fadeLayer(LAYER_NAMES.ANNOTATION_LAYER, annotLayer, fromOpacity, toOpacity, fadeMs, () => {
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

      let screenPt: { x: number; y: number };
      try {
        screenPt = view.toScreen(geom);
      } catch {
        g.visible = true;
        return;
      }

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
      this._symbolZoomHide(zoomInt);
    }
  }

  /**
   * Show/hide symbols based on their echelon and the ZoomLvlEchelon map.
   * Echelon "00" (no echelon assigned) is always treated as visible.
   */
  private _applyEchelon(zoomInt: number): void {
    const echelonMap = (settingsData as any).ZoomLvlEchelon;
    if (!echelonMap) return;

    // Find the highest map key that is <= zoomInt
    const sortedKeys = Object.keys(echelonMap).map(Number).sort((a, b) => a - b);
    let mapKey = sortedKeys[0];
    for (const k of sortedKeys) {
      if (k <= zoomInt) mapKey = k;
    }
    const visibleEchelons: string[] = echelonMap[String(mapKey)] ?? ["00"];
    const fadeMs = (settingsData as any).declutter?.symbols?.fadeMs ?? 300;

    SYMBOL_LAYERS.forEach(layerName => {
      const layer = this._layerManager.getLayer(layerName);
      if (!layer) return;

      // Check if any graphics need to change so we avoid unnecessary flashes
      let needsUpdate = false;
      layer.graphics.forEach((g: Graphic) => {
        const echelon = this._getEchelon(g);
        const shouldShow = visibleEchelons.includes(echelon);
        if (g.visible !== shouldShow) needsUpdate = true;
      });

      if (!needsUpdate) return;

      // Flash-fade: fade out → update visibility → fade in
      this._flashLayer(layerName, layer, fadeMs, () => {
        layer.graphics.forEach((g: Graphic) => {
          const echelon = this._getEchelon(g);
          g.visible = visibleEchelons.includes(echelon);
        });
      });
    });

    // Keep annotation layer in sync: hide labels whose parent symbol is hidden
    this._syncAnnotationsToSymbolVisibility();
  }

  /** Extract 2-char echelon code from a graphic's attributes. */
  private _getEchelon(g: Graphic): string {
    const de = g.attributes?.drawEssentials;
    if (de?.ECHELON) return String(de.ECHELON);

    // Fallback: parse from SIDC stored in amplifier or drawEssentials
    const sidc: string = de?.SIDC || g.attributes?.sidc || "";
    if (sidc.length === 20) return sidc.substr(8, 2);
    if (sidc.length >= 10) return sidc.substr(8, 2);

    return "00"; // treat unknown echelon as always-visible
  }

  /** After echelon visibility is applied, hide annotations for hidden parent symbols. */
  private _syncAnnotationsToSymbolVisibility(): void {
    const annotLayer = this._layerManager.getOrCreateLayer(LAYER_NAMES.ANNOTATION_LAYER);
    if (!annotLayer) return;

    // Collect IDs of all currently visible symbols across all layers
    const visibleIds = new Set<string>();
    SYMBOL_LAYERS.forEach(layerName => {
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

  private _symbolZoomHide(zoom: number): void {
    const d = (settingsData as any).declutter;
    const threshold = d?.symbols?.zoomThreshold ?? 5;
    const fadeMs    = d?.symbols?.fadeMs        ?? 400;
    const show      = zoom >= threshold;

    SYMBOL_LAYERS.forEach(layerName => {
      const layer = this._layerManager.getLayer(layerName);
      if (!layer || layer.visible === show) return;
      const fromOp = layer.opacity;
      const toOp   = show ? 1 : 0;
      this._fadeLayer(layerName, layer, fromOp, toOp, fadeMs, () => {
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

    const annotLayer = this._layerManager.getOrCreateLayer(LAYER_NAMES.ANNOTATION_LAYER);
    if (annotLayer) {
      (annotLayer as any).minScale = 0;
      annotLayer.visible = true;
      annotLayer.opacity = 1;
      annotLayer.graphics.forEach((g: Graphic) => { g.visible = true; });
    }

    SYMBOL_LAYERS.forEach(layerName => {
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
