import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";
import TextSymbol from "@arcgis/core/symbols/TextSymbol";
import GraphicsLayerManager, { LAYER_NAMES, SYMBOL_LAYER_IDS } from "../../Managers/GraphicsLayerManager";
import settingsData from "../../Data/Settings.json";
import { DeclutterEngine, SolveContext } from "./DeclutterEngine";
import { IndexEntry } from "./SpatialIndex";
import { getEchelonCode, getIdentityCode } from "./echelon";

const SOLVE_STEP_NAME = "cluster";

/** Identity color palette (RGB) — solid versions of the standard 2525D scheme. */
const IDENTITY_COLOR: Record<string, [number, number, number]> = {
  friend:  [0, 51, 204],
  hostile: [255, 48, 49],
  neutral: [0, 167, 80],
  unknown: [255, 200, 0],
  other:   [120, 120, 120],
};

interface Cluster {
  members: IndexEntry[];
  group: string;          // identity group key
  centroidScreen: { x: number; y: number };
  centroidMapPoint: Point; // for placing the badge geometry
}

/**
 * Aggregates nearby symbols into count badges to keep dense scenes readable.
 *
 * Algorithm: greedy pass over priority-sorted index entries. For each
 * unprocessed entry, take its on-screen neighbours within radiusPx that
 * share the same identity group; if the count meets minClusterSize, they
 * become a cluster and their graphics are hidden, replaced by a single
 * badge in the CLUSTER layer.
 *
 * Performance discipline:
 *   - Single pass over the index, O(N * k) where k = local density
 *   - No work above maxZoom (clusters disabled when the scene is sparse)
 *   - Graphics already hidden by echelon/zoom rules are skipped
 *   - Reuses the cluster layer (removeAll → re-add) rather than creating
 *     and destroying a layer per solve
 */
export class ClusterEngine {
  private _getView: () => MapView | SceneView;
  private _layerManager: GraphicsLayerManager;
  private _declutter: DeclutterEngine;
  private _enabled = false;
  /** Graphics currently hidden by clustering, mapped to their pre-hide state. */
  private _hiddenMembers = new Map<string, boolean>();
  private _clustersActive = false;
  /** Member IDs the user clicked to expand — skipped from re-clustering until they click elsewhere or zoom. */
  private _pinnedExpanded = new Set<string>();
  private _clickHandle: { remove(): void } | null = null;
  /** In-flight cluster fade animation frame, tracked so it can be cancelled on disable / view-switch. */
  private _fadeRaf: number | null = null;

  constructor(
    viewProvider: () => MapView | SceneView,
    layerManager: GraphicsLayerManager,
    declutter: DeclutterEngine,
  ) {
    this._getView = viewProvider;
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
    this._wireClickHandler();
  }

  disable(): void {
    if (!this._enabled) return;
    this._enabled = false;
    if (this._fadeRaf !== null) { cancelAnimationFrame(this._fadeRaf); this._fadeRaf = null; }
    this._declutter.unregisterSolveStep(SOLVE_STEP_NAME);
    this._clickHandle?.remove();
    this._clickHandle = null;
    this._pinnedExpanded.clear();
    this._restoreAllHidden();
    const layer = this._layerManager.getLayer(LAYER_NAMES.CLUSTER);
    if (layer) {
      layer.removeAll();
      layer.opacity = 1;
    }
    this._clustersActive = false;
  }

  refresh(): void {
    if (this._enabled) this._declutter.requestSolve();
  }

  onViewChanged(_view: MapView | SceneView, newLayerManager?: GraphicsLayerManager): void {
    if (this._enabled) {
      if (this._fadeRaf !== null) { cancelAnimationFrame(this._fadeRaf); this._fadeRaf = null; }
      this._clickHandle?.remove();
      this._clickHandle = null;
      this._pinnedExpanded.clear();
      // Restore against the OLD manager first (where the graphics were hidden),
      // then adopt the new view's manager for subsequent solves.
      this._restoreAllHidden();
      const layer = this._layerManager.getLayer(LAYER_NAMES.CLUSTER);
      layer?.removeAll();
      this._clustersActive = false;
      if (newLayerManager) this._layerManager = newLayerManager;
      this._wireClickHandler();
      this._declutter.requestSolve();
    }
  }

  /**
   * Click-to-expand: clicking a cluster badge pins its members so they
   * stay visible at their true positions until the user clicks elsewhere
   * or the view zooms. Clicking blank map unpins everything.
   */
  private _wireClickHandler(): void {
    const view = this._getView();
    if (!view) return;
    this._clickHandle = view.on("click", (event: any) => {
      view.hitTest(event).then((res: any) => {
        const hit = res?.results?.find((r: any) => r?.graphic?.attributes?.__isCluster);
        if (hit) {
          const memberIds: string[] = hit.graphic.attributes?.clusterMemberIds ?? [];
          if (memberIds.length === 0) return;
          for (const id of memberIds) this._pinnedExpanded.add(id);
          this._declutter.requestSolve();
        } else if (this._pinnedExpanded.size > 0) {
          // Clicked blank map — collapse the expansion
          this._pinnedExpanded.clear();
          this._declutter.requestSolve();
        }
      }).catch(() => { /* hitTest can reject during view transitions */ });
    });
  }

  // -------------------------------------------------------------------------
  // Solve step
  // -------------------------------------------------------------------------

  private _solve(ctx: SolveContext): void {
    if (!this._enabled) return;
    const cfg = this._cfg();
    const layer = this._layerManager.getOrCreateLayer(LAYER_NAMES.CLUSTER);
    if (!layer) return;

    // Restore the previous solve's hidden graphics first, so subsequent rules
    // start from a clean slate.
    this._restoreAllHidden();
    layer.removeAll();

    // Clusters are pointless at high zoom (the scene is naturally sparse).
    if (ctx.zoom > cfg.maxZoom) {
      this._fadeOutIfActive(layer, cfg.fadeMs);
      return;
    }

    const clusters = this._computeClusters(ctx, cfg);
    if (clusters.length === 0) {
      this._fadeOutIfActive(layer, cfg.fadeMs);
      return;
    }

    const promoteToSeed = cfg.promoteMode === "seed";

    for (const c of clusters) {
      const seedPromote = promoteToSeed && this._allShareEchelon(c.members);

      if (seedPromote) {
        // Members are already sorted by priority desc inside _computeClusters
        // (greedy seeds with the highest-priority unprocessed entry).
        const seed = c.members[0];

        // Keep seed visible; hide everyone else
        for (const m of c.members) {
          if (m === seed) continue;
          this._hiddenMembers.set(m.id, m.graphic.visible !== false);
          m.graphic.visible = false;
        }

        const countBadge = this._makeSeedCountBadge(ctx, seed, c);
        if (countBadge) layer.add(countBadge);
      } else {
        // Original count-badge mode: hide all members, render circle + text
        for (const m of c.members) {
          this._hiddenMembers.set(m.id, m.graphic.visible !== false);
          m.graphic.visible = false;
        }
        layer.addMany(this._makeBadge(c));
      }
    }

    this._fadeInIfInactive(layer, cfg.fadeMs);
  }

  /** True when every cluster member has the same echelon code. */
  private _allShareEchelon(members: IndexEntry[]): boolean {
    if (members.length === 0) return false;
    const first = getEchelonCode(members[0].graphic);
    for (let i = 1; i < members.length; i++) {
      if (getEchelonCode(members[i].graphic) !== first) return false;
    }
    return true;
  }

  /**
   * Tiny "×N" indicator placed NE of the seed symbol. Used when promote
   * mode is on and all members share echelon — the seed conveys the unit
   * type, the count conveys how many.
   */
  private _makeSeedCountBadge(ctx: SolveContext, seed: IndexEntry, c: Cluster): Graphic | null {
    const color = IDENTITY_COLOR[c.group] ?? IDENTITY_COLOR.other;
    const offsetPx = 18;
    const badgeScreen = { x: seed.x + offsetPx, y: seed.y - offsetPx };
    const mapPt = ctx.view.toMap(badgeScreen as any);
    if (!mapPt) return null;

    return new Graphic({
      geometry: mapPt,
      symbol: new TextSymbol({
        text: `×${c.members.length}`,
        color: [255, 255, 255, 1] as any,
        font: { size: 11, family: "Inter, sans-serif", weight: "bold" },
        haloColor: [color[0], color[1], color[2], 1] as any,
        haloSize: 2,
      }),
      attributes: {
        __isCluster: true,
        __isClusterCount: true,
        clusterCount: c.members.length,
        clusterGroup: c.group,
        clusterMemberIds: c.members.map(m => m.id),
      },
    });
  }

  // -------------------------------------------------------------------------
  // Clustering algorithm
  // -------------------------------------------------------------------------

  private _computeClusters(ctx: SolveContext, cfg: ReturnType<typeof this._cfg>): Cluster[] {
    // Snapshot all entries; sort by priority desc so the highest-importance
    // graphic seeds its neighbourhood's cluster.
    const all: IndexEntry[] = [];
    for (const [, bucket] of ctx.index.bucketEntries()) {
      for (const e of bucket) {
        // Skip graphics already hidden by other rules (echelon, zoom)
        if (e.graphic.visible === false) continue;
        // Skip entries the user explicitly expanded via click-to-expand
        if (this._pinnedExpanded.has(e.id)) continue;
        all.push(e);
      }
    }
    all.sort((a, b) => b.priority - a.priority);

    const processed = new Set<string>();
    const clusters: Cluster[] = [];

    for (const seed of all) {
      if (processed.has(seed.id)) continue;
      processed.add(seed.id);

      const seedGroup = cfg.respectIdentity ? this._groupOf(seed.graphic) : "all";

      // BFS flood-fill: grow the group transitively so that chains A–B–C
      // are fully collected regardless of which entry seeds first.
      // Each entry is enqueued at most once (guarded by `processed`), so
      // total work across the outer loop remains O(N·k) amortised.
      const members: IndexEntry[] = [seed];
      const queue: IndexEntry[] = [seed];

      while (queue.length > 0) {
        const current = queue.shift()!;
        const neighbours = ctx.index.within(current.x, current.y, cfg.radiusPx);
        for (const nb of neighbours) {
          if (processed.has(nb.id)) continue;
          if (nb.graphic.visible === false) continue;
          if (cfg.respectIdentity && this._groupOf(nb.graphic) !== seedGroup) continue;
          if (this._pinnedExpanded.has(nb.id)) continue;
          processed.add(nb.id);
          members.push(nb);
          queue.push(nb);   // explore neighbours of this neighbour
        }
      }

      if (members.length < cfg.minClusterSize) continue;

      // Centroid in screen space then back-project for the badge geometry
      let sx = 0, sy = 0;
      for (const m of members) { sx += m.x; sy += m.y; }
      sx /= members.length;
      sy /= members.length;

      const mapPt = ctx.view.toMap({ x: sx, y: sy } as any);
      if (!mapPt) continue;

      clusters.push({
        members,
        group: seedGroup,
        centroidScreen: { x: sx, y: sy },
        centroidMapPoint: mapPt,
      });
    }

    return clusters;
  }

  // -------------------------------------------------------------------------
  // Badge rendering
  // -------------------------------------------------------------------------

  private _makeBadge(c: Cluster): Graphic[] {
    const count = c.members.length;
    const sizePx = Math.min(60, 22 + Math.log2(count) * 5);
    const color = IDENTITY_COLOR[c.group] ?? IDENTITY_COLOR.other;

    const circle = new Graphic({
      geometry: c.centroidMapPoint,
      symbol: new SimpleMarkerSymbol({
        style: "circle",
        color: [color[0], color[1], color[2], 0.85] as any,
        size: sizePx,
        outline: { color: [255, 255, 255, 1] as any, width: 2 },
      }),
      attributes: {
        __isCluster: true,
        clusterCount: count,
        clusterGroup: c.group,
        clusterMemberIds: c.members.map(m => m.id),
      },
    });

    const text = new Graphic({
      geometry: c.centroidMapPoint,
      symbol: new TextSymbol({
        text: String(count),
        color: [255, 255, 255, 1] as any,
        font: {
          size: Math.max(10, sizePx * 0.42),
          family: "Inter, sans-serif",
          weight: "bold",
        },
        haloColor: [color[0], color[1], color[2], 1] as any,
        haloSize: 0,
      }),
      attributes: {
        __isCluster: true,
        __isClusterText: true,
      },
    });

    return [circle, text];
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private _groupOf(g: Graphic): string {
    const c = getIdentityCode(g);
    if (c === "3" || c === "2") return "friend";
    if (c === "6" || c === "5" || c === "7") return "hostile";
    if (c === "4") return "neutral";
    if (c === "0" || c === "1") return "unknown";
    return "other";
  }

  private _restoreAllHidden(): void {
    for (const [id, preState] of this._hiddenMembers) {
      // The index might be stale by the time we restore, so search across
      // all symbol layers for this id. Cheap (only runs on cluster changes).
      const g = this._findGraphicById(id);
      if (g) g.visible = preState;
    }
    this._hiddenMembers.clear();
  }

  private _findGraphicById(id: string): Graphic | null {
    // Use the spatial index first (O(1)).
    const entry = this._declutter.spatialIndex.getById(id);
    if (entry) return entry.graphic;
    // Index miss — it may have been rebuilt since the member was hidden, or
    // the member scrolled out of the viewport (toScreen failed, so it isn't
    // in the index). Fall back to a direct scan of the symbol layers so a
    // hidden member is ALWAYS restored. The id matches how SpatialIndex keys
    // entries (String(g.attributes.id)). Only runs on cluster changes.
    for (const layerId of SYMBOL_LAYER_IDS) {
      const layer = this._layerManager.getLayer(layerId);
      const graphics = (layer?.graphics?.toArray?.() ?? []) as Graphic[];
      for (const g of graphics) {
        if (String(g.attributes?.id ?? "") === id) return g;
      }
    }
    return null;
  }

  private _fadeInIfInactive(layer: GraphicsLayer, fadeMs: number): void {
    if (this._clustersActive) {
      layer.opacity = 1;
      return;
    }
    this._clustersActive = true;
    this._animateOpacity(layer, layer.opacity, 1, fadeMs);
  }

  private _fadeOutIfActive(layer: GraphicsLayer, fadeMs: number): void {
    if (!this._clustersActive) return;
    this._clustersActive = false;
    this._animateOpacity(layer, layer.opacity, 0, fadeMs, () => {
      // After fade-out, removeAll has already happened in _solve.
      layer.opacity = 1;
    });
  }

  private _animateOpacity(
    layer: GraphicsLayer,
    from: number,
    to: number,
    ms: number,
    onComplete?: () => void,
  ): void {
    if (this._fadeRaf !== null) cancelAnimationFrame(this._fadeRaf);
    layer.opacity = from;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - start) / ms, 1);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      layer.opacity = from + (to - from) * ease;
      if (t < 1) {
        this._fadeRaf = requestAnimationFrame(step);
      } else {
        this._fadeRaf = null;
        layer.opacity = to;
        onComplete?.();
      }
    };
    this._fadeRaf = requestAnimationFrame(step);
  }

  private _cfg() {
    const c = (settingsData as any).declutter?.cluster ?? {};
    return {
      minClusterSize:  c.minClusterSize ?? 3,
      radiusPx:        c.radiusPx       ?? 40,
      maxZoom:         c.maxZoom        ?? 14,
      fadeMs:          c.fadeMs         ?? 250,
      respectIdentity: c.respectIdentity !== false,
      promoteMode:     c.promoteMode    ?? "badge",
    };
  }
}

export default ClusterEngine;
