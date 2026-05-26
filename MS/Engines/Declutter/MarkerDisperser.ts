import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import GraphicsLayerManager, {
  SYMBOL_LAYER_IDS,
} from "../../Managers/GraphicsLayerManager";
import settingsData from "../../Data/Settings.json";
import { DeclutterEngine, SolveContext } from "./DeclutterEngine";

const SOLVE_STEP_NAME = "markerDisperser";

// Attributes used to remember each symbol's true map position so we can
// (a) detect stacks from logical positions on subsequent solves, and
// (b) restore exactly when the disperser is disabled.
const ATTR_ORIG_X = "__dspOrigX";
const ATTR_ORIG_Y = "__dspOrigY";
// Cache origin's wkid so subsequent solves can reconstruct the correct
// SR after the graphic's geometry has been mutated to the view's SR.
const ATTR_ORIG_WKID = "__dspOrigWkid";
// Last position we set — used to detect user edits between solves.
const ATTR_LAST_X = "__dspLastSetX";
const ATTR_LAST_Y = "__dspLastSetY";
/** A pixel of geometric tolerance — floating point round-trips through
 *  toScreen / toMap can drift by 1e-9 even when nothing changed. */
const DRIFT_EPSILON = 1e-6;

interface LogicalEntry {
  graphic: Graphic;
  id: string;
  /** Screen-space position derived from the logical (original) map coord. */
  screenX: number;
  screenY: number;
  /** Original map coords (cached if dispersed, else current). */
  origX: number;
  origY: number;
  sr: any;
}

/**
 * Equivalent of ArcGIS's "Disperse Markers" tool.
 *
 * Problem solved: at high zoom, symbols at near-identical coordinates
 * (e.g. multiple units at the same fortification) sit exactly on top of
 * each other and the user can only see the topmost. Clustering aggregates
 * away the detail; disperse fans the stack so every member is visible
 * at its slightly-offset position while the user still knows they
 * share a location.
 *
 * Algorithm:
 *   1. Read each visible point symbol's *logical* position (origX/Y if
 *      previously dispersed, else current geometry) — this makes the pass
 *      idempotent: re-running on already-dispersed symbols still computes
 *      the same stack centroid.
 *   2. Greedy stack detection in screen space (within thresholdPx).
 *   3. For each stack ≥ 2 members, distribute around the centroid on a
 *      circle of radiusPx. Sort by id for stable ordering across solves.
 *   4. Restore any symbol that was dispersed last solve but is no longer
 *      part of a stack.
 *
 * Composition:
 *   - Inactive below minZoom (clustering owns that range).
 *   - Skips graphics with visible=false (so cluster-hidden members are
 *     ignored).
 *   - Skips non-Point geometries (lines/areas don't disperse).
 *   - Skips cluster badges (__isCluster attribute).
 */
export class MarkerDisperser {
  private _layerManager: GraphicsLayerManager;
  private _declutter: DeclutterEngine;
  private _enabled = false;
  /** Graphic id → graphic, for symbols currently dispersed. */
  private _dispersed = new Map<string, Graphic>();

  constructor(
    _viewProvider: () => MapView | SceneView,
    layerManager: GraphicsLayerManager,
    declutter: DeclutterEngine,
  ) {
    this._layerManager = layerManager;
    this._declutter = declutter;
  }

  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    this._declutter.registerSolveStep(SOLVE_STEP_NAME, ctx => this._solve(ctx));
  }

  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    this._declutter.unregisterSolveStep(SOLVE_STEP_NAME);
    this._restoreAll();
  }

  refresh(): void {
    if (this._enabled) this._declutter.requestSolve();
  }

  onViewChanged(_view: MapView | SceneView): void {
    if (this._enabled) {
      this._restoreAll();
      this._declutter.requestSolve();
    }
  }

  // -------------------------------------------------------------------------
  // Solve
  // -------------------------------------------------------------------------

  private _solve(ctx: SolveContext): void {
    if (!this._enabled) return;
    const cfg = this._cfg();

    // Out of active zoom band — restore everything and bail. Below
    // minZoom: clustering territory. Above maxZoom: the user is
    // inspecting individuals and doesn't want a radial fan.
    if (ctx.zoom < cfg.minZoom || ctx.zoom > cfg.maxZoom) {
      this._restoreAll();
      return;
    }

    // ------------------------------------------------------------------
    // Self-healing: detect user edits since last solve. If a currently-
    // tracked graphic's geometry no longer matches what we set, the user
    // moved it. Clear its cache so this solve treats the new position as
    // the new logical origin.
    // ------------------------------------------------------------------
    for (const [id, g] of Array.from(this._dispersed)) {
      const attrs = g.attributes;
      const cur = g.geometry as Point | null;
      if (!attrs || !cur) { this._dispersed.delete(id); continue; }
      const lastX = attrs[ATTR_LAST_X];
      const lastY = attrs[ATTR_LAST_Y];
      if (lastX === undefined || lastY === undefined) continue;
      if (Math.abs((cur.x ?? 0) - lastX) > DRIFT_EPSILON ||
          Math.abs((cur.y ?? 0) - lastY) > DRIFT_EPSILON) {
        // User moved this graphic. Strip all disperser state — the new
        // geometry becomes the logical origin from now on.
        delete attrs[ATTR_ORIG_X];
        delete attrs[ATTR_ORIG_Y];
        delete attrs[ATTR_ORIG_WKID];
        delete attrs[ATTR_LAST_X];
        delete attrs[ATTR_LAST_Y];
        this._dispersed.delete(id);
      }
    }

    // ------------------------------------------------------------------
    // 1. Collect logical entries from all symbol layers.
    // ------------------------------------------------------------------
    const entries: LogicalEntry[] = [];
    const view = ctx.view;
    const margin = 50;
    const vw = view.width;
    const vh = view.height;

    for (const layerId of SYMBOL_LAYER_IDS) {
      const layer = this._layerManager.getLayer(layerId);
      if (!layer) continue;
      layer.graphics.forEach((g: Graphic) => {
        if (g.visible === false) return;
        const attrs = g.attributes ?? {};
        if (attrs.__isCluster) return;
        if (attrs.__ladderRung !== undefined) return;
        const geom = g.geometry as Point | null;
        if (!geom || geom.type !== "point") return;
        const id = String(attrs.id ?? "");
        if (!id) return;

        const origX = attrs[ATTR_ORIG_X] !== undefined ? attrs[ATTR_ORIG_X] : geom.x;
        const origY = attrs[ATTR_ORIG_Y] !== undefined ? attrs[ATTR_ORIG_Y] : geom.y;
        if (origX == null || origY == null) return;

        // Reconstruct the SR the origin was captured in. After we mutate
        // g.geometry to a dispersed map point, geom.spatialReference is
        // the view's SR — not necessarily what origX/origY were captured
        // in (typical case: WGS84 origin, Web Mercator view).
        const origWkid = attrs[ATTR_ORIG_WKID];
        const origSR: SpatialReference =
          origWkid
            ? new SpatialReference({ wkid: origWkid })
            : (geom.spatialReference as SpatialReference);

        let screen: { x: number; y: number } | null | undefined;
        try {
          screen = view.toScreen(new Point({ x: origX, y: origY, spatialReference: origSR }));
        } catch { return; }
        if (!screen) return;
        if (screen.x < -margin || screen.x > vw + margin ||
            screen.y < -margin || screen.y > vh + margin) return;

        entries.push({
          graphic: g, id,
          screenX: screen.x, screenY: screen.y,
          origX, origY,
          sr: origSR,
        });
      });
    }

    if (entries.length === 0) {
      this._restoreAll();
      return;
    }

    // ------------------------------------------------------------------
    // 2. Build a small screen-space grid keyed on thresholdPx, then
    //    greedy-detect stacks.
    // ------------------------------------------------------------------
    const cellSize = cfg.thresholdPx;
    const grid = new Map<string, LogicalEntry[]>();
    for (const e of entries) {
      const k = `${Math.floor(e.screenX / cellSize)},${Math.floor(e.screenY / cellSize)}`;
      let b = grid.get(k);
      if (!b) { b = []; grid.set(k, b); }
      b.push(e);
    }

    const neighborsOf = (e: LogicalEntry): LogicalEntry[] => {
      const cx = Math.floor(e.screenX / cellSize);
      const cy = Math.floor(e.screenY / cellSize);
      const r2 = cfg.thresholdPx * cfg.thresholdPx;
      const out: LogicalEntry[] = [];
      for (let dcx = -1; dcx <= 1; dcx++) {
        for (let dcy = -1; dcy <= 1; dcy++) {
          const bucket = grid.get(`${cx + dcx},${cy + dcy}`);
          if (!bucket) continue;
          for (const o of bucket) {
            const dx = o.screenX - e.screenX;
            const dy = o.screenY - e.screenY;
            if (dx * dx + dy * dy <= r2) out.push(o);
          }
        }
      }
      return out;
    };

    const processed = new Set<string>();
    const stacks: LogicalEntry[][] = [];

    for (const seed of entries) {
      if (processed.has(seed.id)) continue;
      const group = neighborsOf(seed).filter(n => !processed.has(n.id));
      if (group.length >= 2) {
        group.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        for (const m of group) processed.add(m.id);
        stacks.push(group);
      } else {
        processed.add(seed.id);
      }
    }

    // ------------------------------------------------------------------
    // 3. Apply disperse to each stack.
    // ------------------------------------------------------------------
    const newDispersed = new Map<string, Graphic>();

    for (const stack of stacks) {
      let sx = 0, sy = 0, mx = 0, my = 0;
      for (const m of stack) {
        sx += m.screenX; sy += m.screenY;
        mx += m.origX;   my += m.origY;
      }
      const n = stack.length;
      sx /= n; sy /= n;
      mx /= n; my /= n;

      const N = Math.min(n, cfg.maxGroupSize);
      for (let i = 0; i < N; i++) {
        const m = stack[i];
        const angle = (i / N) * Math.PI * 2 - Math.PI / 2; // start at top
        const px = sx + Math.cos(angle) * cfg.radiusPx;
        const py = sy + Math.sin(angle) * cfg.radiusPx;
        const mapPt = view.toMap({ x: px, y: py } as any);
        if (!mapPt) continue;

        // Cache original on first displacement; always update last-set
        // so self-healing can detect user edits between solves.
        const attrs = m.graphic.attributes ?? {};
        if (attrs[ATTR_ORIG_X] === undefined) {
          attrs[ATTR_ORIG_X] = m.origX;
          attrs[ATTR_ORIG_Y] = m.origY;
          attrs[ATTR_ORIG_WKID] = (m.sr as any)?.wkid ?? 0;
        }
        attrs[ATTR_LAST_X] = mapPt.x;
        attrs[ATTR_LAST_Y] = mapPt.y;
        m.graphic.attributes = attrs;
        m.graphic.geometry = mapPt;
        newDispersed.set(m.id, m.graphic);
      }

      // Members beyond maxGroupSize stay at their logical position (rare;
      // safety valve for huge stacks). Restore them if they were dispersed.
      for (let i = N; i < n; i++) {
        const m = stack[i];
        this._restoreOne(m.graphic);
      }
    }

    // ------------------------------------------------------------------
    // 4. Restore any symbol dispersed last pass but no longer in a stack.
    // ------------------------------------------------------------------
    for (const [id, g] of this._dispersed) {
      if (!newDispersed.has(id)) this._restoreOne(g);
    }
    this._dispersed = newDispersed;
  }

  // -------------------------------------------------------------------------
  // Restore helpers
  // -------------------------------------------------------------------------

  private _restoreAll(): void {
    for (const g of this._dispersed.values()) this._restoreOne(g);
    this._dispersed.clear();
  }

  private _restoreOne(g: Graphic): void {
    const attrs = g.attributes;
    if (!attrs) return;
    if (attrs[ATTR_ORIG_X] !== undefined && attrs[ATTR_ORIG_Y] !== undefined) {
      const cur = g.geometry as Point | null;
      // Use cached origin wkid so we restore to the right SR (geom.sr is
      // the view's SR after mutation, not necessarily what we captured).
      const origWkid = attrs[ATTR_ORIG_WKID];
      const sr: SpatialReference = origWkid
        ? new SpatialReference({ wkid: origWkid })
        : (cur?.spatialReference as SpatialReference);
      g.geometry = new Point({
        x: attrs[ATTR_ORIG_X],
        y: attrs[ATTR_ORIG_Y],
        spatialReference: sr,
      });
      delete attrs[ATTR_ORIG_X];
      delete attrs[ATTR_ORIG_Y];
      delete attrs[ATTR_ORIG_WKID];
    }
    delete attrs[ATTR_LAST_X];
    delete attrs[ATTR_LAST_Y];
  }

  // -------------------------------------------------------------------------
  // Config
  // -------------------------------------------------------------------------

  private _cfg() {
    const d = (settingsData as any).declutter?.disperse ?? {};
    return {
      minZoom:      d.minZoom      ?? 14,
      maxZoom:      d.maxZoom      ?? 18,
      thresholdPx:  d.thresholdPx  ?? 12,
      radiusPx:     d.radiusPx     ?? 18,
      maxGroupSize: d.maxGroupSize ?? 12,
    };
  }
}

export default MarkerDisperser;
