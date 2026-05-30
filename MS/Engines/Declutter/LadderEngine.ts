import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import GraphicsLayerManager, {
  LAYER_NAMES,
  SYMBOL_LAYER_IDS,
} from "../../Managers/GraphicsLayerManager";
import settingsData from "../../Data/Settings.json";
import { DeclutterEngine, SolveContext } from "./DeclutterEngine";
import { getIdentityCode } from "./echelon";
import { priorityOf } from "./PriorityResolver";

const SOLVE_STEP_NAME = "ladder";

// Cache the symbol's true map position so we can:
//   (a) detect stacks from logical positions on subsequent solves
//   (b) restore exactly when laddering is disabled or the user moves it
const ATTR_ORIG_X = "__ladOrigX";
const ATTR_ORIG_Y = "__ladOrigY";
// Cache the original geometry's wkid so subsequent solves can reconstruct
// the correct spatial reference. Without this, the SR drifts to the view's
// SR (because we mutate g.geometry) and toScreen mis-projects the cached
// origin on every solve after the first.
const ATTR_ORIG_WKID = "__ladOrigWkid";
// Last position we set — used by the self-healing drift check.
const ATTR_LAST_X = "__ladLastSetX";
const ATTR_LAST_Y = "__ladLastSetY";
// Composition guard: MarkerDisperser skips any graphic with this attribute.
const ATTR_RUNG   = "__ladderRung";

const DRIFT_EPSILON = 1e-6;

type IdentityGroup = "friend" | "hostile" | "neutral" | "unknown" | "other";

interface LogicalEntry {
  graphic: Graphic;
  id: string;
  screenX: number;
  screenY: number;
  origX: number;
  origY: number;
  sr: any;
  identity: IdentityGroup;
  priority: number;
}

/**
 * "Laddering" declutter strategy.
 *
 * Within a screen-pixel detection radius (thresholdPx), nearby same-
 * identity symbols are gathered into a vertical stack — "rungs"
 * connected by a thin line (the "spine") down to the geographic
 * centroid. Visually it reads like flags hoisted on a halyard.
 *
 * Composition:
 *   - Activates above minZoom (default 14) just like MarkerDisperser.
 *   - When LadderEngine claims a graphic it tags __ladderRung.
 *     MarkerDisperser skips any graphic with that attribute, so the
 *     two engines never fight over the same stack — ladder wins.
 *   - Cluster badges (__isCluster) and non-Point graphics are skipped.
 *   - Already-dispersed graphics (with __dspOrigX cached) still have a
 *     valid logical position so ladder reads it correctly.
 *
 * Ordering: rungs are sorted by `priorityOf` descending, so the
 * highest-echelon symbol always lands on the top rung.
 */
export class LadderEngine {
  private _layerManager: GraphicsLayerManager;
  private _declutter: DeclutterEngine;
  private _enabled = false;
  /** id → graphic, for symbols currently on a rung. */
  private _laddered = new Map<string, Graphic>();
  /**
   * Original elevationInfo.mode of each layer we mutated when entering
   * altitude mode. Stored so disable() can restore exactly.
   */
  private _origElevationModes = new Map<string, string>();

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
    this._clearLadderLayer();
    this._applyLayerElevationMode(false);
  }

  refresh(): void {
    if (this._enabled) this._declutter.requestSolve();
  }

  onViewChanged(_view: MapView | SceneView): void {
    if (this._enabled) {
      // Layer references change with the view; clear cached originals so
      // the next solve re-captures them on the new view's layers.
      this._origElevationModes.clear();
      this._restoreAll();
      this._clearLadderLayer();
      this._declutter.requestSolve();
    }
  }

  // -------------------------------------------------------------------------
  // Solve
  // -------------------------------------------------------------------------

  private _solve(ctx: SolveContext): void {
    if (!this._enabled) return;
    const cfg = this._cfg();

    // Altitude mode only makes visual sense in a 3D SceneView — a 2D
    // MapView ignores z entirely. Fall back to screen-space placement
    // when not in 3D so the user still sees ladders instead of nothing.
    const is3D = (ctx.view as any)?.type === "3d";
    const altitudeActive = cfg.altitudeMode && is3D;

    // Sync layer elevation modes with the *effective* altitude state.
    // When altitudeActive is on we need symbol layers in "relative-to-
    // ground" so z values are honoured; otherwise restore originals
    // (typically "on-the-ground").
    this._applyLayerElevationMode(altitudeActive);

    // Out of active zoom band — restore everything and bail. Below
    // minZoom: the scene is overview-level and clustering owns it.
    // Above maxZoom: the user is inspecting individual symbols and does
    // not want them reorganised into a halyard.
    if (ctx.zoom < cfg.minZoom || ctx.zoom > cfg.maxZoom) {
      this._restoreAll();
      this._clearLadderLayer();
      return;
    }

    // ------------------------------------------------------------------
    // Self-healing: detect user edits since last solve. If a tracked
    // graphic's geometry no longer matches what we set, the user moved
    // it. Clear cache so this solve treats new position as the logical
    // origin.
    // ------------------------------------------------------------------
    for (const [id, g] of Array.from(this._laddered)) {
      const attrs = g.attributes;
      const cur = g.geometry as Point | null;
      if (!attrs || !cur) { this._laddered.delete(id); continue; }
      const lastX = attrs[ATTR_LAST_X];
      const lastY = attrs[ATTR_LAST_Y];
      if (lastX === undefined || lastY === undefined) continue;
      if (Math.abs((cur.x ?? 0) - lastX) > DRIFT_EPSILON ||
          Math.abs((cur.y ?? 0) - lastY) > DRIFT_EPSILON) {
        delete attrs[ATTR_ORIG_X];
        delete attrs[ATTR_ORIG_Y];
        delete attrs[ATTR_ORIG_WKID];
        delete attrs[ATTR_LAST_X];
        delete attrs[ATTR_LAST_Y];
        delete attrs[ATTR_RUNG];
        this._laddered.delete(id);
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
    const now = Date.now();

    for (const layerId of SYMBOL_LAYER_IDS) {
      const layer = this._layerManager.getLayer(layerId);
      if (!layer) continue;
      layer.graphics.forEach((g: Graphic) => {
        if (g.visible === false) return;
        const attrs = g.attributes ?? {};
        if (attrs.__isCluster) return;
        const geom = g.geometry as Point | null;
        if (!geom || geom.type !== "point") return;
        const id = String(attrs.id ?? "");
        if (!id) return;

        const origX = attrs[ATTR_ORIG_X] !== undefined ? attrs[ATTR_ORIG_X] : geom.x;
        const origY = attrs[ATTR_ORIG_Y] !== undefined ? attrs[ATTR_ORIG_Y] : geom.y;
        if (origX == null || origY == null) return;

        // Reconstruct the SR that origX/origY were captured in. After we
        // mutate g.geometry to a ladder rung position, geom.spatialReference
        // becomes the view's SR — so we can't rely on it for cached origins
        // captured from a different SR (typical case: WGS84 origin, Web
        // Mercator view).
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
          identity: this._identityGroupKey(g),
          priority: priorityOf(g, now),
        });
      });
    }

    if (entries.length === 0) {
      this._restoreAll();
      this._clearLadderLayer();
      return;
    }

    // ------------------------------------------------------------------
    // 2. Stack detection — screen-space grid hash on thresholdPx.
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
        for (const m of group) processed.add(m.id);
        stacks.push(group);
      } else {
        processed.add(seed.id);
      }
    }

    // ------------------------------------------------------------------
    // 3. For each stack: split by identity (if respecting identity),
    //    then ladder each subgroup that meets the size band.
    // ------------------------------------------------------------------
    const ladderLayer = this._layerManager.getOrCreateLayer(LAYER_NAMES.LADDER);
    if (!ladderLayer) return;
    ladderLayer.removeAll();

    const newLaddered = new Map<string, Graphic>();

    for (const stack of stacks) {
      const subgroups = cfg.respectIdentity
        ? this._splitByIdentity(stack)
        : [stack];

      for (const subgroup of subgroups) {
        if (subgroup.length < cfg.minRungs) {
          // Restore any previously-laddered members of this subgroup
          for (const m of subgroup) this._restoreIfTracked(m.id);
          continue;
        }
        if (subgroup.length > cfg.maxRungs) {
          // Skip this subgroup entirely; restore any that were laddered
          for (const m of subgroup) this._restoreIfTracked(m.id);
          continue;
        }

        // Sort by priority desc (highest echelon at the top rung)
        subgroup.sort((a, b) => {
          if (b.priority !== a.priority) return b.priority - a.priority;
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });

        const N = subgroup.length;
        const sr = subgroup[0].sr;

        if (altitudeActive) {
          // ──────────────────────────────────────────────────────────
          // ALTITUDE MODE — symbols stack vertically in 3D, connected
          // by a "stem" running from the ground to the top rung.
          // ──────────────────────────────────────────────────────────

          // Map-space centroid of the stack (lat/lon in the original SR)
          let mx = 0, my = 0;
          for (const m of subgroup) { mx += m.origX; my += m.origY; }
          mx /= N;
          my /= N;

          // i=0 is highest priority → highest z. Rung positions:
          //   z(i) = stemBaseAltitudeM + (N - 1 - i) * altitudeSpacingM
          // Top rung sits at stemBaseAltitudeM + (N-1)*altitudeSpacingM.
          const topZ = cfg.stemBaseAltitudeM + (N - 1) * cfg.altitudeSpacingM;

          for (let i = 0; i < N; i++) {
            const m = subgroup[i];
            const z = cfg.stemBaseAltitudeM + (N - 1 - i) * cfg.altitudeSpacingM;
            const newPt = new Point({
              x: mx,
              y: my,
              z,
              hasZ: true,
              spatialReference: sr,
            } as any);

            const attrs = m.graphic.attributes ?? {};
            if (attrs[ATTR_ORIG_X] === undefined) {
              attrs[ATTR_ORIG_X] = m.origX;
              attrs[ATTR_ORIG_Y] = m.origY;
              attrs[ATTR_ORIG_WKID] = (m.sr as any)?.wkid ?? 0;
            }
            attrs[ATTR_LAST_X] = newPt.x;
            attrs[ATTR_LAST_Y] = newPt.y;
            attrs[ATTR_RUNG] = i;
            m.graphic.attributes = attrs;
            m.graphic.geometry = newPt;
            newLaddered.set(m.id, m.graphic);
          }

          // Stem: vertical polyline from the ground up to the top rung
          const stem = new Polyline({
            hasZ: true,
            spatialReference: sr,
            paths: [[
              [mx, my, cfg.stemBaseAltitudeM],
              [mx, my, topZ],
            ]],
          } as any);
          ladderLayer.add(new Graphic({
            geometry: stem,
            symbol: new SimpleLineSymbol({
              color: [14, 20, 26, 0.5] as any,
              width: cfg.spineWidth * 2.5,
            }),
            attributes: { __isLadderSpine: true },
          }));
          ladderLayer.add(new Graphic({
            geometry: stem,
            symbol: new SimpleLineSymbol({
              color: [...cfg.spineColor, cfg.spineOpacity] as any,
              width: cfg.spineWidth,
              style: 'short-dash' as any,
            }),
            attributes: { __isLadderSpine: true },
          }));
          // Tie-lines are meaningless in altitude mode (rungs share x/y
          // with the stem); skip them.
        } else {
          // ──────────────────────────────────────────────────────────
          // SCREEN MODE — current ground/screen-space side or center
          // layout. Behaviour preserved unchanged.
          // ──────────────────────────────────────────────────────────
          let sx = 0, sy = 0;
          for (const m of subgroup) { sx += m.screenX; sy += m.screenY; }
          sx /= N;
          sy /= N;

          const middle = (N - 1) / 2;
          const spineX = sx;

          for (let i = 0; i < N; i++) {
            const m = subgroup[i];
            const px = cfg.layout === "side" ? sx + cfg.sideOffsetPx : sx;
            const py = sy + (i - middle) * cfg.rungSpacingPx;
            const mapPt = view.toMap({ x: px, y: py } as any);
            if (!mapPt) continue;

            const attrs = m.graphic.attributes ?? {};
            if (attrs[ATTR_ORIG_X] === undefined) {
              attrs[ATTR_ORIG_X] = m.origX;
              attrs[ATTR_ORIG_Y] = m.origY;
              attrs[ATTR_ORIG_WKID] = (m.sr as any)?.wkid ?? 0;
            }
            attrs[ATTR_LAST_X] = mapPt.x;
            attrs[ATTR_LAST_Y] = mapPt.y;
            attrs[ATTR_RUNG] = i;
            m.graphic.attributes = attrs;
            m.graphic.geometry = mapPt;
            newLaddered.set(m.id, m.graphic);
          }

          // Spine: top → bottom at spineX.
          const topY = sy + (0 - middle) * cfg.rungSpacingPx;
          const botY = sy + (N - 1 - middle) * cfg.rungSpacingPx;
          const topMap = view.toMap({ x: spineX, y: topY } as any);
          const botMap = view.toMap({ x: spineX, y: botY } as any);
          if (topMap && botMap) {
            const spinePoly = new Polyline({
              paths: [[[topMap.x!, topMap.y!], [botMap.x!, botMap.y!]]],
              spatialReference: sr,
            });
            ladderLayer.add(new Graphic({
              geometry: spinePoly,
              symbol: new SimpleLineSymbol({
                color: [14, 20, 26, 0.5] as any,
                width: cfg.spineWidth * 2.5,
              }),
              attributes: { __isLadderSpine: true },
            }));
            ladderLayer.add(new Graphic({
              geometry: spinePoly,
              symbol: new SimpleLineSymbol({
                color: [...cfg.spineColor, cfg.spineOpacity] as any,
                width: cfg.spineWidth,
                style: 'short-dash' as any,
              }),
              attributes: { __isLadderSpine: true },
            }));
          }

          // Tie lines (side layout only)
          if (cfg.layout === "side" && cfg.showTieLines) {
            for (let i = 0; i < N; i++) {
              const ry = sy + (i - middle) * cfg.rungSpacingPx;
              const a = view.toMap({ x: spineX, y: ry } as any);
              const b = view.toMap({ x: spineX + cfg.sideOffsetPx, y: ry } as any);
              if (!a || !b) continue;
              const tie = new Polyline({
                paths: [[[a.x!, a.y!], [b.x!, b.y!]]],
                spatialReference: sr,
              });
              ladderLayer.add(new Graphic({
                geometry: tie,
                symbol: new SimpleLineSymbol({
                  color: [...cfg.spineColor, cfg.spineOpacity * 0.6] as any,
                  width: Math.max(0.5, cfg.spineWidth * 0.75),
                }),
                attributes: { __isLadderTie: true },
              }));
            }
          }
        }
      }
    }

    // ------------------------------------------------------------------
    // 4. Restore any symbol laddered last pass but no longer in a stack.
    // ------------------------------------------------------------------
    for (const [id, g] of this._laddered) {
      if (!newLaddered.has(id)) this._restoreOne(g);
    }
    this._laddered = newLaddered;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Map standard identity char → simple group key (mirrors ClusterEngine taxonomy). */
  private _identityGroupKey(g: Graphic): IdentityGroup {
    const c = getIdentityCode(g);
    if (c === "3" || c === "2") return "friend";
    if (c === "6" || c === "5" || c === "7") return "hostile";
    if (c === "4") return "neutral";
    if (c === "0" || c === "1") return "unknown";
    return "other";
  }

  /** Partition a stack into per-identity subgroups. */
  private _splitByIdentity(stack: LogicalEntry[]): LogicalEntry[][] {
    const groups = new Map<IdentityGroup, LogicalEntry[]>();
    for (const e of stack) {
      let g = groups.get(e.identity);
      if (!g) { g = []; groups.set(e.identity, g); }
      g.push(e);
    }
    return Array.from(groups.values());
  }

  private _restoreAll(): void {
    for (const g of this._laddered.values()) this._restoreOne(g);
    this._laddered.clear();
  }

  /** Restore a single graphic to its cached origin and strip all ladder attrs. */
  private _restoreOne(g: Graphic): void {
    const attrs = g.attributes;
    if (!attrs) return;
    if (attrs[ATTR_ORIG_X] !== undefined && attrs[ATTR_ORIG_Y] !== undefined) {
      const cur = g.geometry as Point | null;
      // Use the cached origin wkid so we restore to the right SR; falling
      // back to the current geometry's SR only when no cache is present.
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
    delete attrs[ATTR_RUNG];
  }

  /** If `id` is currently laddered, restore and forget it. */
  private _restoreIfTracked(id: string): void {
    const g = this._laddered.get(id);
    if (g) {
      this._restoreOne(g);
      this._laddered.delete(id);
    }
  }

  private _clearLadderLayer(): void {
    const layer = this._layerManager.getLayer(LAYER_NAMES.LADDER);
    layer?.removeAll();
  }

  /**
   * Switch the LADDER + symbol layers' elevationInfo so that z values on
   * graphics are honoured in altitude mode. When `enable=false` (or the
   * setting toggles back off), restore the original modes (typically
   * "on-the-ground") so other engines / non-laddered symbols behave as
   * before.
   */
  private _applyLayerElevationMode(enable: boolean): void {
    const targetMode = "relative-to-ground";
    const layerIds = [LAYER_NAMES.LADDER, ...SYMBOL_LAYER_IDS];

    if (enable) {
      for (const lid of layerIds) {
        const layer = this._layerManager.getLayer(lid);
        if (!layer) continue;
        const curMode = (layer as any).elevationInfo?.mode ?? "on-the-ground";
        if (curMode === targetMode) continue;
        if (!this._origElevationModes.has(lid)) {
          this._origElevationModes.set(lid, curMode);
        }
        (layer as any).elevationInfo = { mode: targetMode };
      }
    } else {
      for (const [lid, origMode] of this._origElevationModes) {
        const layer = this._layerManager.getLayer(lid);
        if (layer) (layer as any).elevationInfo = { mode: origMode };
      }
      this._origElevationModes.clear();
    }
  }

  private _cfg() {
    const l = (settingsData as any).declutter?.ladder ?? {};
    return {
      minZoom:           l.minZoom           ?? 14,
      maxZoom:           l.maxZoom           ?? 17,
      thresholdPx:       l.thresholdPx       ?? 50,
      minRungs:          l.minRungs          ?? 2,
      maxRungs:          l.maxRungs          ?? 15,
      layout:            (l.layout           ?? "side") as "side" | "center",
      sideOffsetPx:      l.sideOffsetPx      ?? 24,
      rungSpacingPx:     l.rungSpacingPx     ?? 22,
      spineColor:        (l.spineColor       ?? [180, 180, 180]) as [number, number, number],
      spineWidth:        l.spineWidth        ?? 1,
      spineOpacity:      l.spineOpacity      ?? 0.7,
      respectIdentity:   l.respectIdentity   !== false,
      showTieLines:      l.showTieLines      !== false,
      altitudeMode:      l.altitudeMode      === true,
      altitudeSpacingM:  l.altitudeSpacingM  ?? 250,
      stemBaseAltitudeM: l.stemBaseAltitudeM ?? 0,
    };
  }
}

export default LadderEngine;
