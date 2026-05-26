import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import TextSymbol from "@arcgis/core/symbols/TextSymbol";
import GraphicsLayerManager, { LAYER_NAMES } from "../../Managers/GraphicsLayerManager";
import settingsData from "../../Data/Settings.json";
import { DeclutterEngine, SolveContext } from "./DeclutterEngine";

const SOLVE_STEP_NAME = "labelPlacer";

// Attribute keys used to cache state so we can restore labels exactly
// when the placer is disabled.
const ATTR_ANCHOR_X = "__lblAnchorX";
const ATTR_ANCHOR_Y = "__lblAnchorY";
const ATTR_PLACED   = "__lblPlaced";
const ATTR_ORIG_TEXT = "__lblOrigText";
// Last position we set — used to detect user edits between solves.
const ATTR_LAST_X = "__lblLastSetX";
const ATTR_LAST_Y = "__lblLastSetY";
const DRIFT_EPSILON = 1e-6;

/**
 * 8 candidate positions tried in priority order. Index 0 (above-right) is
 * the cartographic convention for label placement next to point features.
 * Each entry is a unit-vector offset; the configured offsetPx scales it.
 */
const CANDIDATE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [ 1, -1],   // NE — preferred
  [ 1,  0],   // E
  [ 1,  1],   // SE
  [ 0, -1],   // N
  [ 0,  1],   // S
  [-1, -1],   // NW
  [-1,  0],   // W
  [-1,  1],   // SW
];

const GRID_CELL_PX = 64;

interface BBox { x: number; y: number; w: number; h: number; }

interface LabelCandidate {
  graphic: Graphic;
  anchorX: number;     // screen px (anchor = original symbol position)
  anchorY: number;
  bboxW: number;
  bboxH: number;
  priority: number;
}

/**
 * Maplex-style label placer.
 *
 * Strategy per Maplex: each label tries a chain of candidate positions
 * around its anchor and takes the first one that doesn't collide with
 * already-placed labels. If none fit, the first candidate is forced
 * (overlap accepted) — abbreviation/shrink chains are deliberately out of
 * scope for this MVP.
 *
 * Performance:
 *   - O(N · k) where k is the average grid neighbourhood size; not O(N²)
 *   - Hard cap at `maxToPlace`; over-budget labels are hidden lowest first
 *   - Estimated text bbox (no DOM measurement) → constant per label
 *   - Solve runs only on stationary (already debounced by DeclutterEngine)
 *
 * Labels store their original anchor in attributes so disable / view-change
 * can restore them perfectly without losing data.
 */
export class LabelPlacer {
  private _layerManager: GraphicsLayerManager;
  private _declutter: DeclutterEngine;
  private _enabled = false;

  constructor(
    _viewProvider: () => MapView | SceneView,
    layerManager: GraphicsLayerManager,
    declutter: DeclutterEngine,
  ) {
    this._layerManager = layerManager;
    this._declutter = declutter;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  enable(): void {
    if (this._enabled) return;
    this._enabled = true;
    this._declutter.registerSolveStep(SOLVE_STEP_NAME, ctx => this._solve(ctx));
  }

  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    this._declutter.unregisterSolveStep(SOLVE_STEP_NAME);
    this._restoreAllAnchors();
    const leaderLayer = this._layerManager.getLayer(LAYER_NAMES.LEADER_LINE);
    leaderLayer?.removeAll();
  }

  refresh(): void {
    if (this._enabled) this._declutter.requestSolve();
  }

  onViewChanged(_view: MapView | SceneView): void {
    if (this._enabled) {
      // Anchors were valid in the old view's spatial reference — restore
      // so the next solve recaptures them in the new view's SR.
      this._restoreAllAnchors();
      const leaderLayer = this._layerManager.getLayer(LAYER_NAMES.LEADER_LINE);
      leaderLayer?.removeAll();
      this._declutter.requestSolve();
    }
  }

  // -------------------------------------------------------------------------
  // Solve step
  // -------------------------------------------------------------------------

  private _solve(ctx: SolveContext): void {
    if (!this._enabled) return;
    const cfg = this._cfg();

    const annotLayer = this._layerManager.getOrCreateLayer(LAYER_NAMES.ANNOTATION_LAYER);
    const leaderLayer = this._layerManager.getOrCreateLayer(LAYER_NAMES.LEADER_LINE);
    if (!annotLayer || !leaderLayer) return;

    leaderLayer.removeAll();

    // ------------------------------------------------------------------
    // 0. Self-healing: detect user edits since last solve. If a placed
    //    label's geometry no longer matches what we set, the user moved
    //    it — drop the cached anchor so this pass treats current as the
    //    new origin.
    // ------------------------------------------------------------------
    annotLayer.graphics.forEach((g: Graphic) => {
      const attrs = g.attributes;
      if (!attrs || !attrs[ATTR_PLACED]) return;
      const cur = g.geometry as Point | null;
      if (!cur) return;
      const lastX = attrs[ATTR_LAST_X];
      const lastY = attrs[ATTR_LAST_Y];
      if (lastX === undefined || lastY === undefined) return;
      if (Math.abs((cur.x ?? 0) - lastX) > DRIFT_EPSILON ||
          Math.abs((cur.y ?? 0) - lastY) > DRIFT_EPSILON) {
        // User moved this label. Strip placer state — the new geometry
        // becomes the anchor from now on.
        delete attrs[ATTR_ANCHOR_X];
        delete attrs[ATTR_ANCHOR_Y];
        delete attrs[ATTR_LAST_X];
        delete attrs[ATTR_LAST_Y];
        delete attrs[ATTR_PLACED];
      }
    });

    // ------------------------------------------------------------------
    // 1. Gather candidates: visible annotations within the viewport (with
    //    margin). Off-screen labels skip the entire pass.
    // ------------------------------------------------------------------
    const candidates: LabelCandidate[] = [];
    const view = ctx.view;
    const margin = 50;
    const vw = view.width;
    const vh = view.height;

    annotLayer.graphics.forEach((g: Graphic) => {
      if (g.visible === false) return;
      const attrs = g.attributes;
      if (!attrs || attrs.__isCluster) return;     // skip cluster badges

      const anchor = this._getAnchorMapCoords(g);
      if (!anchor) return;

      const anchorPt = new Point({
        x: anchor.x,
        y: anchor.y,
        spatialReference: anchor.sr,
      });
      let screen: { x: number; y: number } | null | undefined;
      try { screen = view.toScreen(anchorPt); } catch { return; }
      if (!screen) return;
      if (screen.x < -margin || screen.x > vw + margin ||
          screen.y < -margin || screen.y > vh + margin) return;

      const sym = g.symbol as TextSymbol | null;
      const text = String(sym?.text ?? "");
      if (!text) return;
      const fontSize = Number((sym?.font as any)?.size) || 12;

      // Estimated bbox — wide enough for variable-width fonts, no DOM cost
      const bboxW = text.length * fontSize * 0.55 + 4;
      const bboxH = fontSize * 1.3 + 4;

      const parentId = attrs.parentId;
      let priority = 0;
      if (parentId) {
        const parent = ctx.index.getById(String(parentId));
        priority = parent?.priority ?? 0;
      }

      candidates.push({
        graphic: g,
        anchorX: screen.x,
        anchorY: screen.y,
        bboxW,
        bboxH,
        priority,
      });
    });

    if (candidates.length === 0) return;

    // ------------------------------------------------------------------
    // 2. Budget cap: sort by priority desc, hide overflow.
    // ------------------------------------------------------------------
    candidates.sort((a, b) => b.priority - a.priority);
    if (candidates.length > cfg.maxToPlace) {
      const overflow = candidates.splice(cfg.maxToPlace);
      for (const o of overflow) o.graphic.visible = false;
    }

    // ------------------------------------------------------------------
    // 3. Placement: screen-space grid hash to avoid O(N²).
    // ------------------------------------------------------------------
    const placedGrid = new Map<string, BBox[]>();

    const cellKeys = (b: BBox): string[] => {
      const minCx = Math.floor(b.x / GRID_CELL_PX);
      const maxCx = Math.floor((b.x + b.w) / GRID_CELL_PX);
      const minCy = Math.floor(b.y / GRID_CELL_PX);
      const maxCy = Math.floor((b.y + b.h) / GRID_CELL_PX);
      const out: string[] = [];
      for (let cx = minCx; cx <= maxCx; cx++)
        for (let cy = minCy; cy <= maxCy; cy++)
          out.push(`${cx},${cy}`);
      return out;
    };

    const collides = (b: BBox): boolean => {
      for (const k of cellKeys(b)) {
        const bucket = placedGrid.get(k);
        if (!bucket) continue;
        for (const o of bucket) {
          if (b.x < o.x + o.w && b.x + b.w > o.x &&
              b.y < o.y + o.h && b.y + b.h > o.y) return true;
        }
      }
      return false;
    };

    const insert = (b: BBox): void => {
      for (const k of cellKeys(b)) {
        let bucket = placedGrid.get(k);
        if (!bucket) { bucket = []; placedGrid.set(k, bucket); }
        bucket.push(b);
      }
    };

    // Helper: try the 8-position chain for a given bbox size; returns the
    // first non-colliding bbox + its index, or {null, -1} if all collide.
    const tryFit = (w: number, h: number, anchorX: number, anchorY: number): { bbox: BBox | null; index: number } => {
      const halfW = w / 2;
      const halfH = h / 2;
      for (let i = 0; i < CANDIDATE_OFFSETS.length; i++) {
        const [dx, dy] = CANDIDATE_OFFSETS[i];
        const labelCx = anchorX + dx * cfg.offsetPx;
        const labelCy = anchorY + dy * cfg.offsetPx;
        const b: BBox = { x: labelCx - halfW, y: labelCy - halfH, w, h };
        if (!collides(b)) return { bbox: b, index: i };
      }
      return { bbox: null, index: -1 };
    };

    interface Placed { cand: LabelCandidate; bbox: BBox; displaced: boolean; }
    const placed: Placed[] = [];

    for (const c of candidates) {
      const attrs = c.graphic.attributes ?? {};

      // ----------------------------------------------------------------
      // 1. Try original text in 8 positions.
      // ----------------------------------------------------------------
      let result = tryFit(c.bboxW, c.bboxH, c.anchorX, c.anchorY);
      let chosen = result.bbox;
      let chosenIndex = result.index;
      let usedAbbreviation = false;

      // ----------------------------------------------------------------
      // 2. Abbreviation fallback: shorter text might fit where full didn't.
      // ----------------------------------------------------------------
      if (!chosen && cfg.abbreviateOnOverflow) {
        const sym = c.graphic.symbol as TextSymbol | null;
        const origText = attrs[ATTR_ORIG_TEXT] ?? String(sym?.text ?? "");
        if (origText.length > cfg.abbreviateMaxChars) {
          const abbr = origText.slice(0, cfg.abbreviateMaxChars) + "…";
          const fontSize = Number((sym?.font as any)?.size) || 12;
          const abbrW = abbr.length * fontSize * 0.55 + 4;
          const abbrH = fontSize * 1.3 + 4;
          result = tryFit(abbrW, abbrH, c.anchorX, c.anchorY);
          if (result.bbox) {
            chosen = result.bbox;
            chosenIndex = result.index;
            usedAbbreviation = true;
            // Cache original text (once) and swap the symbol's text.
            if (sym) {
              if (attrs[ATTR_ORIG_TEXT] === undefined) {
                attrs[ATTR_ORIG_TEXT] = origText;
                c.graphic.attributes = attrs;
              }
              const newSym = sym.clone();
              newSym.text = abbr;
              c.graphic.symbol = newSym;
            }
          }
        }
      }

      // ----------------------------------------------------------------
      // 3. Restore original text if we previously abbreviated but the
      //    full text fits now (zoom changed, neighbours moved, etc.).
      // ----------------------------------------------------------------
      if (!usedAbbreviation && attrs[ATTR_ORIG_TEXT] !== undefined) {
        const sym = c.graphic.symbol as TextSymbol | null;
        if (sym) {
          const newSym = sym.clone();
          newSym.text = attrs[ATTR_ORIG_TEXT];
          c.graphic.symbol = newSym;
        }
        delete attrs[ATTR_ORIG_TEXT];
        c.graphic.attributes = attrs;
      }

      // ----------------------------------------------------------------
      // 4. Hide-on-overflow: priority sort already drained the budget,
      //    so the labels still failing here are the least important.
      //    Drop them rather than letting them overlap.
      // ----------------------------------------------------------------
      if (!chosen && cfg.hideOnOverflow) {
        c.graphic.visible = false;
        continue;
      }

      // ----------------------------------------------------------------
      // 5. Force-place at the first candidate; overlap accepted.
      //    Reached only when neither abbreviation nor hide is enabled
      //    (or abbreviation didn't fit and hide is off).
      // ----------------------------------------------------------------
      if (!chosen) {
        const [dx, dy] = CANDIDATE_OFFSETS[0];
        const halfW = c.bboxW / 2;
        const halfH = c.bboxH / 2;
        chosen = {
          x: c.anchorX + dx * cfg.offsetPx - halfW,
          y: c.anchorY + dy * cfg.offsetPx - halfH,
          w: c.bboxW,
          h: c.bboxH,
        };
        chosenIndex = -1; // sentinel: forced
      }

      const halfW = chosen.w / 2;
      const halfH = chosen.h / 2;

      // ----------------------------------------------------------------
      // Mutate the label's geometry to the new screen-derived map point.
      // ----------------------------------------------------------------
      const centerX = chosen.x + halfW;
      const centerY = chosen.y + halfH;
      const newMapPt = view.toMap({ x: centerX, y: centerY } as any);
      if (newMapPt) {
        c.graphic.geometry = newMapPt;
        if (!c.graphic.attributes) c.graphic.attributes = {};
        c.graphic.attributes[ATTR_PLACED] = true;
        c.graphic.attributes[ATTR_LAST_X] = newMapPt.x;
        c.graphic.attributes[ATTR_LAST_Y] = newMapPt.y;
      }

      insert(chosen);

      const dxScreen = centerX - c.anchorX;
      const dyScreen = centerY - c.anchorY;
      const distSq = dxScreen * dxScreen + dyScreen * dyScreen;
      const displaced = chosenIndex === -1
        || distSq > cfg.leaderThresholdPx * cfg.leaderThresholdPx;

      placed.push({ cand: c, bbox: chosen, displaced });
    }

    // ------------------------------------------------------------------
    // 4. Leader lines: one polyline per displaced label.
    // ------------------------------------------------------------------
    const leaderSymbol = new SimpleLineSymbol({
      color: [...cfg.leaderColor, cfg.leaderOpacity] as any,
      width: cfg.leaderWidth,
    });

    for (const p of placed) {
      if (!p.displaced) continue;
      const labelGeom = p.cand.graphic.geometry as Point | null;
      if (!labelGeom) continue;
      const anchor = this._getAnchorMapCoords(p.cand.graphic);
      if (!anchor) continue;

      const line = new Polyline({
        paths: [[[anchor.x, anchor.y], [labelGeom.x ?? 0, labelGeom.y ?? 0]]],
        spatialReference: labelGeom.spatialReference!,
      });
      leaderLayer.add(new Graphic({
        geometry: line,
        symbol: leaderSymbol,
        attributes: { __isLeader: true },
      }));
    }
  }

  // -------------------------------------------------------------------------
  // Anchor management
  // -------------------------------------------------------------------------

  /**
   * Returns the label's original anchor in map coords. On first call,
   * captures the current geometry into attributes so subsequent solves
   * (which may have moved the geometry) can still find it.
   */
  private _getAnchorMapCoords(g: Graphic): { x: number; y: number; sr: any } | null {
    const attrs = g.attributes ?? {};
    const cur = g.geometry as Point | null;

    if (attrs[ATTR_ANCHOR_X] !== undefined && attrs[ATTR_ANCHOR_Y] !== undefined) {
      return { x: attrs[ATTR_ANCHOR_X], y: attrs[ATTR_ANCHOR_Y], sr: cur?.spatialReference };
    }
    if (!cur || cur.x == null || cur.y == null) return null;

    attrs[ATTR_ANCHOR_X] = cur.x;
    attrs[ATTR_ANCHOR_Y] = cur.y;
    g.attributes = attrs;
    return { x: cur.x, y: cur.y, sr: cur.spatialReference };
  }

  /** Reset all annotations to their original anchor positions and text. */
  private _restoreAllAnchors(): void {
    const annotLayer = this._layerManager.getLayer(LAYER_NAMES.ANNOTATION_LAYER);
    if (!annotLayer) return;
    annotLayer.graphics.forEach((g: Graphic) => {
      const attrs = g.attributes;
      if (!attrs) return;
      if (attrs[ATTR_PLACED] && attrs[ATTR_ANCHOR_X] !== undefined && attrs[ATTR_ANCHOR_Y] !== undefined) {
        const cur = g.geometry as Point | null;
        g.geometry = new Point({
          x: attrs[ATTR_ANCHOR_X],
          y: attrs[ATTR_ANCHOR_Y],
          spatialReference: cur?.spatialReference,
        });
      }
      // Restore abbreviated text to its original.
      if (attrs[ATTR_ORIG_TEXT] !== undefined) {
        const sym = g.symbol as TextSymbol | null;
        if (sym) {
          const newSym = sym.clone();
          newSym.text = attrs[ATTR_ORIG_TEXT];
          g.symbol = newSym;
        }
        delete attrs[ATTR_ORIG_TEXT];
      }
      delete attrs[ATTR_PLACED];
      delete attrs[ATTR_ANCHOR_X];
      delete attrs[ATTR_ANCHOR_Y];
      delete attrs[ATTR_LAST_X];
      delete attrs[ATTR_LAST_Y];
    });
  }

  // -------------------------------------------------------------------------
  // Config
  // -------------------------------------------------------------------------

  private _cfg() {
    const l = (settingsData as any).declutter?.labels ?? {};
    return {
      offsetPx:             l.offsetPx             ?? 16,
      leaderThresholdPx:    l.leaderThresholdPx    ?? 20,
      leaderColor:          l.leaderColor          ?? [128, 128, 128],
      leaderWidth:          l.leaderWidth          ?? 0.75,
      leaderOpacity:        l.leaderOpacity        ?? 0.7,
      maxToPlace:           l.maxToPlace           ?? 500,
      abbreviateOnOverflow: l.abbreviateOnOverflow !== false,
      abbreviateMaxChars:   l.abbreviateMaxChars   ?? 8,
      hideOnOverflow:       l.hideOnOverflow       === true,
    };
  }
}

export default LabelPlacer;
