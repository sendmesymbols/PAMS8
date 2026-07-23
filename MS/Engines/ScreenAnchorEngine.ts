/**
 * ScreenAnchorEngine.ts — "Pin to Screen"
 *
 * A per-item toggle so a title, legend, or callout stays fixed on screen
 * while the map pans and zooms beneath it. Pinned graphics store their
 * anchor as a fraction of the view size (xPct / yPct); one continuous
 * extent watch re-translates their geometry every frame (debounced ~16ms)
 * so they track *during* the pan, not just at its end.
 *
 * Gated behind `features.screenAnchor` (opt-in), dynamically loaded by
 * SymbolEngine mirroring the MGRS / DeploymentBuilder lifecycle.
 *
 * 3D caveat: toMap under camera tilt is nonlinear and can miss the globe —
 * every toMap is null-guarded and re-anchoring freezes while the camera is
 * tilted. 2D (including rotation) is exact.
 *
 * Persistence: `pinned` / `xPct` / `yPct` live on graphic.attributes and are
 * explicitly round-tripped by SerializationEngine (drawEssentials is rebuilt
 * from scratch by each symbol class on load, so mirroring into it is NOT
 * reliable). On load, SymbolEngine.loadSymbolFromJSON calls
 * registerSavedPin() and the pin re-applies against the NEW view size.
 */

import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import * as reactiveUtils from '@arcgis/core/core/reactiveUtils';

import GraphicsLayerManager, { SYMBOL_LAYER_IDS } from '../Managers/GraphicsLayerManager';
import type ContextMenuManager from '../Managers/ContextMenuManager';
import type { ContextMenuItem } from '../Managers/ContextMenuManager';
import EngineLogger from '../Support/EngineLogger';

const ENGINE_NAME = 'ScreenAnchorEngine';
const REANCHOR_DEBOUNCE_MS = 16;

/** Pin is offered for the freehand family only (text / AutoShape / arrows). */
function isPinnableType(t: string | undefined): boolean {
  return (
    !!t &&
    (t.startsWith('Freehand') ||
      t.startsWith('AutoShape') ||
      t === 'TacticalPointText' ||
      t === 'TacticalPointTextBox')
  );
}

interface PinRecord {
  xPct: number;
  yPct: number;
}

class ScreenAnchorEngine {
  private static _instance: ScreenAnchorEngine | null = null;

  private _view: MapView | SceneView | null = null;
  private _contextMenuManager: ContextMenuManager | null = null;
  private _enabled = false;
  private _providerRegistered = false;

  private _pins: Map<string, PinRecord> = new Map();
  private _handles: Array<{ remove(): void }> = [];
  private _reanchorTimer: number | null = null;
  private _tiltWarned = false;

  private constructor() {}

  public static getInstance(): ScreenAnchorEngine {
    if (!ScreenAnchorEngine._instance) {
      ScreenAnchorEngine._instance = new ScreenAnchorEngine();
    }
    return ScreenAnchorEngine._instance;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  public start(view: MapView | SceneView, contextMenuManager: ContextMenuManager): void {
    this._view = view;
    this._contextMenuManager = contextMenuManager;
    this._setupWatch();
    this._registerContextMenu();
    this._rescanPins();
    EngineLogger.success(ENGINE_NAME, 'ScreenAnchorEngine started');
  }

  public onViewChanged(view: MapView | SceneView): void {
    this._clearWatch();
    this._view = view;
    this._setupWatch();
    // Layers are keyed per-view — re-resolve pins against the new view.
    this._rescanPins();
    this._scheduleReanchor();
  }

  public enable(): void {
    this._enabled = true;
    this._scheduleReanchor();
  }

  public disable(): void {
    this._enabled = false;
    if (this._reanchorTimer !== null) {
      clearTimeout(this._reanchorTimer);
      this._reanchorTimer = null;
    }
  }

  public destroy(): void {
    this.disable();
    this._clearWatch();
    this._pins.clear();
    this._view = null;
    ScreenAnchorEngine._instance = null;
  }

  private get _layerManager(): GraphicsLayerManager | null {
    return this._view ? GraphicsLayerManager.getInstance(this._view) : null;
  }

  // ── Pin / unpin ────────────────────────────────────────────────────────────

  /** Pin a graphic at its CURRENT on-screen position. */
  public pinGraphic(graphic: Graphic): void {
    const v: any = this._view;
    const id = graphic?.attributes?.id;
    if (!v || !id) return;

    const anchor = this._anchorOf(graphic.geometry);
    if (!anchor) return;
    const s = v.toScreen(
      new Point({ x: anchor.x, y: anchor.y, spatialReference: v.spatialReference }),
    );
    if (!s) {
      EngineLogger.error(ENGINE_NAME, 'Cannot pin: graphic is off-screen');
      return;
    }

    const xPct = s.x / v.width;
    const yPct = s.y / v.height;
    graphic.attributes.pinned = true;
    graphic.attributes.xPct = xPct;
    graphic.attributes.yPct = yPct;
    this._pins.set(id, { xPct, yPct });
    EngineLogger.success(ENGINE_NAME, `Pinned "${id}" at ${(xPct * 100).toFixed(1)}% / ${(yPct * 100).toFixed(1)}%`);
  }

  /** Unpin — the graphic keeps its current geometry and behaves normally again. */
  public unpinGraphic(graphic: Graphic): void {
    const id = graphic?.attributes?.id;
    if (!id) return;
    delete graphic.attributes.pinned;
    delete graphic.attributes.xPct;
    delete graphic.attributes.yPct;
    this._pins.delete(id);
    EngineLogger.success(ENGINE_NAME, `Unpinned "${id}"`);
  }

  /**
   * Re-register a pin restored by the load path (attributes.pinned/xPct/yPct
   * already applied). The stored geometry is a snapshot at the LAST anchor —
   * the debounced re-anchor translates it to match the pct against the new
   * view size/extent once the view settles.
   */
  public registerSavedPin(graphic: Graphic): void {
    const a = graphic?.attributes;
    if (!a?.id || a.pinned !== true) return;
    if (typeof a.xPct !== 'number' || typeof a.yPct !== 'number') return;
    this._pins.set(a.id, { xPct: a.xPct, yPct: a.yPct });
    this._scheduleReanchor();
  }

  public get pinCount(): number {
    return this._pins.size;
  }

  /** Pick up pre-existing pinned graphics (loaded before the engine started). */
  private _rescanPins(): void {
    const lm = this._layerManager;
    if (!lm) return;
    for (const layerId of SYMBOL_LAYER_IDS) {
      const layer = lm.getLayer(layerId);
      (layer?.graphics as any)?.forEach((g: Graphic) => {
        const a = g.attributes;
        if (a?.id && a.pinned === true && typeof a.xPct === 'number' && typeof a.yPct === 'number') {
          this._pins.set(a.id, { xPct: a.xPct, yPct: a.yPct });
        }
      });
    }
  }

  // ── Continuous re-anchor ───────────────────────────────────────────────────

  private _setupWatch(): void {
    if (!this._view) return;
    // Watch extent (not stationary) so pins track DURING the pan/zoom.
    const h = reactiveUtils.watch(
      () => (this._view as any)?.extent,
      () => this._scheduleReanchor(),
    );
    this._handles.push(h);
  }

  private _clearWatch(): void {
    this._handles.forEach((h) => h.remove());
    this._handles = [];
    if (this._reanchorTimer !== null) {
      clearTimeout(this._reanchorTimer);
      this._reanchorTimer = null;
    }
  }

  private _scheduleReanchor(): void {
    if (!this._enabled || this._pins.size === 0) return;
    if (this._reanchorTimer !== null) clearTimeout(this._reanchorTimer);
    this._reanchorTimer = window.setTimeout(() => {
      this._reanchorTimer = null;
      this._reanchorAll();
    }, REANCHOR_DEBOUNCE_MS);
  }

  private _reanchorAll(): void {
    const v: any = this._view;
    if (!v || !this._enabled || this._pins.size === 0) return;

    // 3D under tilt: toMap is nonlinear (screen-locking would smear) — freeze.
    if (v.type === '3d' && (v.camera?.tilt ?? 0) > 1) {
      if (!this._tiltWarned) {
        this._tiltWarned = true;
        EngineLogger.nextStep(ENGINE_NAME, 'Pins frozen while the 3D camera is tilted');
      }
      return;
    }
    this._tiltWarned = false;

    // EPSILON below a quarter-pixel of map units kills feedback churn
    // (pin mutation retriggers geometry watches elsewhere).
    const epsilon = (Number(v.resolution) || 0.05) * 0.25;

    for (const [id, pin] of this._pins) {
      const g = this._findGraphicById(id);
      if (!g) {
        // Graphic deleted — drop the pin (a reload re-registers via the load path).
        this._pins.delete(id);
        continue;
      }
      // A Morphix edit rebuilds attributes (only `id` survives) — re-stamp the
      // pin attrs so save/label state stays correct.
      if (g.attributes && g.attributes.pinned !== true) {
        g.attributes.pinned = true;
        g.attributes.xPct = pin.xPct;
        g.attributes.yPct = pin.yPct;
      }
      const targetMap = v.toMap({ x: pin.xPct * v.width, y: pin.yPct * v.height });
      if (!targetMap) continue; // 3D ray missed the globe
      const anchor = this._anchorOf(g.geometry);
      if (!anchor) continue;

      const dx = targetMap.x - anchor.x;
      const dy = targetMap.y - anchor.y;
      if (Math.hypot(dx, dy) < epsilon) continue;
      this._translateGraphic(g, dx, dy);
    }
  }

  // ── Geometry translation (geometry + drawEssentials in lockstep) ──────────

  /**
   * Pure translation, inlined per vertex (no Point allocation — this fires
   * every frame during a pan × every pin). CTRL_PTS / BASE_LN_PTS / GEOM are
   * translated too: a later Morphix edit or re-render reads exactly these and
   * would otherwise snap the shape back to stale control points.
   */
  private _translateGraphic(g: Graphic, dx: number, dy: number): void {
    const geom: any = g.geometry;
    if (!geom) return;

    if (geom.type === 'point') {
      const c = geom.clone();
      c.x += dx;
      c.y += dy;
      g.geometry = c;
    } else if (geom.type === 'polyline' && geom.paths) {
      const c = geom.clone();
      c.paths = c.paths.map((path: number[][]) =>
        path.map(([x, y]: number[]) => [x + dx, y + dy]),
      );
      g.geometry = c;
    } else if (geom.type === 'polygon' && geom.rings) {
      const c = geom.clone();
      c.rings = c.rings.map((ring: number[][]) =>
        ring.map(([x, y]: number[]) => [x + dx, y + dy]),
      );
      g.geometry = c;
    } else {
      return;
    }

    const de: any = g.attributes?.drawEssentials;
    if (!de) return;
    if (Array.isArray(de.CTRL_PTS)) {
      for (const pt of de.CTRL_PTS) {
        if (pt && typeof pt.x === 'number') {
          pt.x += dx;
          pt.y += dy;
        }
      }
    }
    const bl = de.BASE_LN_PTS;
    if (bl) {
      for (const key of ['startPt', 'midPt', 'endPt'] as const) {
        const pt = bl[key];
        if (pt && typeof pt.x === 'number') {
          pt.x += dx;
          pt.y += dy;
        }
      }
    }
    if (de.GEOM && typeof de.GEOM.x === 'number') {
      de.GEOM.x += dx;
      de.GEOM.y += dy;
    }
  }

  private _anchorOf(geom: any): { x: number; y: number } | null {
    if (!geom) return null;
    if (geom.type === 'point') return { x: geom.x, y: geom.y };
    if (geom.type === 'polyline') {
      const p = geom.paths?.[0]?.[0];
      return p ? { x: p[0], y: p[1] } : null;
    }
    if (geom.type === 'polygon') {
      const c = geom.centroid;
      if (c) return { x: c.x, y: c.y };
      const p = geom.rings?.[0]?.[0];
      return p ? { x: p[0], y: p[1] } : null;
    }
    const c = geom.extent?.center;
    return c ? { x: c.x, y: c.y } : null;
  }

  private _findGraphicById(id: string): Graphic | null {
    const lm = this._layerManager;
    if (!lm) return null;
    for (const layerId of SYMBOL_LAYER_IDS) {
      const layer = lm.getLayer(layerId);
      const hit = (layer?.graphics as any)?.find((g: Graphic) => g.attributes?.id === id);
      if (hit) return hit;
    }
    return null;
  }

  // ── Context menu ───────────────────────────────────────────────────────────

  private _registerContextMenu(): void {
    if (this._providerRegistered || !this._contextMenuManager) return;
    this._providerRegistered = true;

    // Dynamic provider — evaluated every time the menu opens, so the label
    // flips Pin ↔ Unpin off attributes.pinned and the item disappears when
    // the feature is toggled off.
    this._contextMenuManager.addDynamicItemProvider((graphic: Graphic): ContextMenuItem[] => {
      if (!this._enabled || !graphic?.attributes?.id) return [];
      const type = graphic.attributes.graphicType || graphic.attributes.type;
      if (!isPinnableType(type)) return [];
      return [
        {
          id: 'screen-anchor-toggle',
          label: (g?: Graphic) =>
            g?.attributes?.pinned === true ? 'Unpin from Screen' : 'Pin to Screen',
          icon: '📌',
          action: (g: Graphic) => {
            g.attributes?.pinned === true ? this.unpinGraphic(g) : this.pinGraphic(g);
          },
        },
      ];
    });
  }
}

export default ScreenAnchorEngine;
