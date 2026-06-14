import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import Point from "@arcgis/core/geometry/Point";
import Multipoint from "@arcgis/core/geometry/Multipoint";
import Polygon from "@arcgis/core/geometry/Polygon";
import Polyline from "@arcgis/core/geometry/Polyline";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import TextSymbol from "@arcgis/core/symbols/TextSymbol";
import Color from "@arcgis/core/Color";
import * as geometryEngine from "@arcgis/core/geometry/geometryEngine";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import { buildSectorRing } from "./sectorGeometry";
import { latLonToUTM, utmToLatLon } from "../MGRSEngine";
import GraphicsLayerManager, { LAYER_NAMES } from "../../Managers/GraphicsLayerManager";
import type { DeclutterEngine } from "../Declutter/DeclutterEngine";

// ─── Public option interfaces ───────────────────────────────────────────────

export interface LayerEffectsOptions {
  enabled: boolean;
  /** ArcGIS CSS-filter effect string for the FORCE layer (UEI symbols) */
  forceEffect: string;
  /** ArcGIS CSS-filter effect string for the TACT_PT layer */
  tactPtEffect: string;
  /** ArcGIS CSS-filter effect string for the TACT layer */
  tactEffect: string;
}

export interface CoverageRingsOptions {
  enabled: boolean;
  /** Buffer radius in kilometres around each point symbol */
  radiusKm: number;
  /** Highlight contested zones where friendly and enemy rings overlap */
  showOverlap: boolean;
  friendlyColor: number[];
  enemyColor: number[];
  overlapColor: number[];
  fillOpacity: number;
  outlineWidth: number;
}

export interface ForceRatioGridOptions {
  enabled: boolean;
  /** Approximate grid cell side-length in kilometres */
  cellSizeKm: number;
  /** Fill colour when friendly dominates (>= 1.5:1 ratio) */
  favorableColor: number[];
  /** Fill colour when forces are roughly equal */
  parityColor: number[];
  /** Fill colour when enemy dominates (>= 1.5:1 ratio) */
  unfavorableColor: number[];
  fillOpacity: number;
}

export interface ConvexHullOptions {
  enabled: boolean;
  friendlyFillColor: number[];
  enemyFillColor: number[];
  neutralFillColor: number[];
  fillOpacity: number;
  outlineWidth: number;
}

export interface RenderOptions {
  /** Use ArcGIS SceneView high quality profile in 3D */
  highQuality3D: boolean;
  /** Disable 3D direct shadows and ambient occlusion */
  disableSceneShadows: boolean;
  /** Use high quality SceneView atmosphere rendering in 3D */
  highAtmosphereQuality: boolean;
  /** @deprecated legacy "lift everything" flag — superseded by the three per-kind toggles below. */
  liftSymbolsFromGround?: boolean;
  /** Lift force/UEI point symbols above terrain */
  liftForcePoints: boolean;
  /** Lift tactical point symbols above terrain */
  liftTacticalPoints: boolean;
  /** Lift tactical line/area graphics above terrain */
  liftLinesAreas: boolean;
  /** Elevation offset (metres) used when a lift flag is enabled */
  symbolElevationOffset: number;
  /** Draw vertical drop lines from lifted force points down to terrain (3D only) */
  forcePointDropLines: boolean;
  dropLineColor: number[];
  dropLineWidth: number;
  dropLineOpacity: number;
}

export interface ExtrudedFootprintsOptions {
  enabled: boolean;
  /** Extrude polygon (area) graphics into 3D blocks */
  extrudePolygons: boolean;
  /** Block height in metres for extruded polygons */
  polygonHeightM: number;
  /** Show solid edges on extruded polygons */
  polygonShowEdges: boolean;
  /** Extrude polyline graphics into vertical walls */
  extrudeLines: boolean;
  /** Wall height in metres for extruded lines */
  lineWallHeightM: number;
  /** Wall thickness in metres (PathSymbol3DLayer width) */
  lineWallThicknessM: number;
  /** Fill opacity for extruded faces (0–1) */
  fillOpacity: number;
  /** Source for the extrusion colour */
  colorMode: "identity" | "inherit" | "single";
  /** Used when colorMode === "single" */
  singleColor: number[];
  /** Edge colour for SolidEdges3D */
  edgeColor: number[];
}

/**
 * "Aggregate" mode: when the view zooms out past the threshold (where
 * DeclutterEngine typically hides individual symbols), automatically surface
 * analytical summaries (hull / grid) so the user still sees force disposition
 * instead of an empty map. User-toggled overlays are unaffected; this only
 * adds overlays on top.
 */
export interface AggregateOptions {
  enabled: boolean;
  /** Auto-show analytical summary when view zoom is below this level */
  zoomBelow: number;
  /** Include convex hull in the aggregate view */
  showHull: boolean;
  /** Include force-ratio grid in the aggregate view */
  showGrid: boolean;
}

export interface VisualizationOptions {
  render: RenderOptions;
  layerEffects: LayerEffectsOptions;
  coverageRings: CoverageRingsOptions;
  forceRatioGrid: ForceRatioGridOptions;
  convexHull: ConvexHullOptions;
  extrudedFootprints: ExtrudedFootprintsOptions;
  aggregate: AggregateOptions;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: VisualizationOptions = {
  render: {
    highQuality3D: false,
    disableSceneShadows: false,
    highAtmosphereQuality: false,
    liftForcePoints: false,
    liftTacticalPoints: false,
    liftLinesAreas: false,
    symbolElevationOffset: 100,
    forcePointDropLines: true,
    dropLineColor: [40, 40, 40],
    dropLineWidth: 1.5,
    dropLineOpacity: 0.85,
  },
  layerEffects: {
    enabled: false,
    forceEffect: "bloom(1, 0.5px, 0.1)",
    tactPtEffect: "bloom(0.8, 0.5px, 0.05)",
    tactEffect: "drop-shadow(0px, 0px, 6px, #0050ff, 0.7)",
  },
  coverageRings: {
    enabled: false,
    radiusKm: 5,
    showOverlap: true,
    friendlyColor: [0, 100, 200],
    enemyColor: [220, 50, 50],
    overlapColor: [255, 150, 0],
    fillOpacity: 0.12,
    outlineWidth: 1.5,
  },
  forceRatioGrid: {
    enabled: false,
    cellSizeKm: 20,
    favorableColor: [0, 80, 200],
    parityColor: [150, 150, 150],
    unfavorableColor: [200, 50, 50],
    fillOpacity: 0.25,
  },
  convexHull: {
    enabled: false,
    friendlyFillColor: [0, 80, 200],
    enemyFillColor: [200, 50, 50],
    neutralFillColor: [80, 200, 120],
    fillOpacity: 0.1,
    outlineWidth: 2,
  },
  extrudedFootprints: {
    enabled: false,
    extrudePolygons: true,
    polygonHeightM: 100,
    polygonShowEdges: true,
    extrudeLines: true,
    lineWallHeightM: 100,
    lineWallThicknessM: 6,
    fillOpacity: 0.22,
    colorMode: "identity",
    singleColor: [80, 120, 200],
    edgeColor: [40, 40, 40],
  },
  aggregate: {
    enabled: false,
    zoomBelow: 6,
    showHull: true,
    showGrid: false,
  },
};

const VIZ_LAYER_ID = "VisualizationOverlayLayer";
const VIZ_TAG = "__viz__";

/**
 * Layer IDs targeted by render settings (lift / drop lines / membership
 * normalisation). These are the symbol layers created by GraphicsLayerManager
 * — referenced here by string id so render code can find them on the SceneView
 * map without coupling to the layer-manager singleton.
 */
const RENDER_LAYER_IDS = {
  forcePoints: 'ForceSymbolsLayer',
  tacticalPoints: 'TacticalPointSymbolsLayer',
  linesAreas: 'TacticalSymbolsLayer',
  forcePointDropLines: 'ForcePointDropLinesLayer',
} as const;

// ─── Engine ─────────────────────────────────────────────────────────────────

export class VisualizationEngine {
  private static _instance: VisualizationEngine | null = null;

  private _view: MapView | SceneView | null = null;
  private _layerManager: GraphicsLayerManager | null = null;
  private _vizLayer: GraphicsLayer | null = null;
  private _options: VisualizationOptions;
  private _watchers: Array<{ remove(): void }> = [];
  private _refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private _enabled = false;
  private _declutter: DeclutterEngine | null = null;
  private static readonly DECLUTTER_STEP_NAME = "viz-aggregate";

  // ── Render settings state ────────────────────────────────────────────────
  // Tracked independently of overlay state so render settings apply even when
  // the engine's overlay features (`enable()` / `disable()`) are off.
  /** The SceneView that render settings target. Captured on first applyRenderSettings. */
  private _renderSceneView: SceneView | null = null;
  /** SceneView defaults captured before any user overrides — used to revert. */
  private _initialSceneRenderState: {
    qualityProfile: unknown;
    directShadowsEnabled?: boolean;
    ambientOcclusionEnabled?: boolean;
    atmosphereQuality?: unknown;
  } | null = null;
  /** Watcher that rebuilds drop lines whenever the FORCE layer's graphic count changes. */
  private _dropLineWatcher: { remove(): void } | null = null;

  private constructor() {
    this._options = JSON.parse(JSON.stringify(DEFAULT_OPTIONS)) as VisualizationOptions;
  }

  public static getInstance(): VisualizationEngine {
    if (!VisualizationEngine._instance) {
      VisualizationEngine._instance = new VisualizationEngine();
    }
    return VisualizationEngine._instance;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  public start(view: MapView | SceneView): void {
    this._view = view;
    this._layerManager = GraphicsLayerManager.getInstance(view);
    this._setupVizLayer();
    this._setupWatchers();
  }

  public enable(): void {
    this._enabled = true;
    this._applyLayerEffects();
    this._scheduleRefresh();
  }

  public disable(): void {
    this._enabled = false;
    this._clearLayerEffects();
    this._clearVizLayer();
  }

  public get isEnabled(): boolean {
    return this._enabled;
  }

  public toggle(): boolean {
    if (this._enabled) {
      this.disable();
    } else {
      this.enable();
    }
    return this._enabled;
  }

  public onViewChanged(view: MapView | SceneView): void {
    this._view = view;
    this._clearWatchers();
    if (this._vizLayer && view.map) {
      const existing = view.map.findLayerById(VIZ_LAYER_ID);
      if (!existing) {
        view.map.add(this._vizLayer, 0);
      }
    }
    this._setupWatchers();
    if (this._enabled) this._scheduleRefresh();
  }

  /** Force a refresh of all enabled overlays. Useful for external engines (e.g. EditEngine) after bulk geometry mutations. */
  public refresh(): void {
    this._scheduleRefresh();
  }

  /**
   * Hook into DeclutterEngine's solve pipeline so analytical overlays refresh
   * in sync with declutter passes. Pure refresh trigger — no behavior change
   * beyond what aggregate mode already provides through the zoom watcher.
   * Call disconnectDeclutter() before swapping declutter instances.
   */
  public connectDeclutter(declutter: DeclutterEngine): void {
    if (this._declutter === declutter) return;
    this.disconnectDeclutter();
    this._declutter = declutter;
    declutter.registerSolveStep(VisualizationEngine.DECLUTTER_STEP_NAME, () => {
      if (this._enabled) this._scheduleRefresh();
    });
  }

  public disconnectDeclutter(): void {
    this._declutter?.unregisterSolveStep(VisualizationEngine.DECLUTTER_STEP_NAME);
    this._declutter = null;
  }

  public setOptions(options: Partial<VisualizationOptions>): void {
    if (options.render)         Object.assign(this._options.render,         options.render);
    if (options.layerEffects)   Object.assign(this._options.layerEffects,   options.layerEffects);
    if (options.coverageRings)  Object.assign(this._options.coverageRings,  options.coverageRings);
    if (options.forceRatioGrid) Object.assign(this._options.forceRatioGrid, options.forceRatioGrid);
    if (options.convexHull)     Object.assign(this._options.convexHull,     options.convexHull);
    if (options.extrudedFootprints) Object.assign(this._options.extrudedFootprints, options.extrudedFootprints);
    if (options.aggregate)      Object.assign(this._options.aggregate,      options.aggregate);

    // Render settings apply independently of overlay enable-state: if we
    // already have a SceneView, re-push them whenever they change.
    if (options.render && this._renderSceneView) {
      this._applyRenderSettings(this._renderSceneView, this._options.render);
    }

    if (this._enabled) {
      this._applyLayerEffects();
      this._scheduleRefresh();
    }
  }

  /**
   * Apply render settings (lift, drop lines, scene quality, shadows,
   * atmosphere) to the given SceneView. Safe to call before `start()` or
   * `enable()` — render settings are independent of overlay state. The
   * sceneView is cached so subsequent `setOptions({ render })` calls re-apply
   * automatically.
   *
   * `settings` may be either a partial RenderOptions object or the full
   * settings tree (with a `visualization.render` path) — both shapes are
   * accepted for compatibility with how `Settings.json` is structured.
   */
  public applyRenderSettings(sceneView: SceneView, settings: any = {}): void {
    if (!sceneView) return;
    const render: Partial<RenderOptions> =
      settings?.visualization?.render ?? settings?.render ?? settings ?? {};
    if (this._renderSceneView !== sceneView) {
      this._captureInitialSceneRenderState(sceneView);
      this._renderSceneView = sceneView;
    }
    // Keep the engine's cached options in sync so later setOptions calls merge
    // cleanly. Doing this through Object.assign preserves any other keys we
    // weren't told about this round.
    Object.assign(this._options.render, render);
    this._applyRenderSettings(sceneView, this._options.render);
  }

  // ─── Setup ─────────────────────────────────────────────────────────────────

  private _setupVizLayer(): void {
    if (!this._view?.map) return;

    let layer = this._view.map.findLayerById(VIZ_LAYER_ID) as GraphicsLayer;
    if (!layer) {
      layer = new GraphicsLayer({
        id: VIZ_LAYER_ID,
        title: "Visualization Overlay",
        listMode: "hide",
        opacity: 1,
        elevationInfo: { mode: "relative-to-ground", offset: 0 },
      } as any);
      // Index 0 = bottom of draw stack — sits under all symbol layers
      this._view.map.add(layer, 0);
    }
    this._vizLayer = layer;
  }

  private _setupWatchers(): void {
    if (!this._layerManager || !this._view) return;

    const watchLayer = (layerName: string) => {
      const layer = this._layerManager!.getOrCreateLayer(layerName);
      this._watchers.push(
        reactiveUtils.watch(
          // Signature picks up add/remove (length) AND in-place geometry edits
          // (reading geom.x/.y / first ring vertex makes reactiveUtils re-fire on mutation).
          () => {
            let sig = layer.graphics.length;
            layer.graphics.forEach((g: any) => {
              const geom = g.geometry as any;
              if (!geom) return;
              const v = geom.type === "point"
                ? [geom.x, geom.y]
                : (geom.rings?.[0]?.[0] ?? geom.paths?.[0]?.[0]);
              if (v) sig += (v[0] ?? 0) + (v[1] ?? 0) * 1e-4;
            });
            return sig;
          },
          () => this._scheduleRefresh(),
        ),
      );
    };

    watchLayer(LAYER_NAMES.FORCE);
    watchLayer(LAYER_NAMES.TACT_PT);
    watchLayer(LAYER_NAMES.TACT);

    // Refresh when zoom crosses the aggregate-mode threshold
    this._watchers.push(
      reactiveUtils.watch(
        () => (this._view as any)?.zoom,
        () => {
          if (this._enabled && this._options.aggregate.enabled) {
            this._scheduleRefresh();
          }
        },
      ),
    );

    // Refresh whenever extent changes — every overlay is now extent-gated
    this._watchers.push(
      reactiveUtils.watch(
        () => (this._view as any)?.extent,
        () => {
          if (!this._enabled) return;
          const o = this._options;
          if (
            o.coverageRings.enabled ||
            o.forceRatioGrid.enabled ||
            o.convexHull.enabled ||
            o.extrudedFootprints.enabled
          ) {
            this._scheduleRefresh();
          }
        },
      ),
    );
  }

  private _clearWatchers(): void {
    this._watchers.forEach(h => h.remove());
    this._watchers = [];
    // The force-point drop-line watcher lives outside the _watchers array and
    // is bound to the current view's force layer — dispose it here too so a
    // 2D/3D switch (onViewChanged) doesn't leak it and pin the discarded view.
    if (this._dropLineWatcher) {
      this._dropLineWatcher.remove();
      this._dropLineWatcher = null;
    }
  }

  // ─── Refresh scheduling ────────────────────────────────────────────────────

  private _scheduleRefresh(): void {
    if (!this._enabled) return;
    if (this._refreshTimer !== null) clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = null;
      this._refresh();
    }, 150);
  }

  private _refresh(): void {
    if (!this._enabled || !this._vizLayer) return;
    this._vizLayer.removeAll();

    const o = this._options;
    const agg = this._isInAggregateMode();
    const showHull = o.convexHull.enabled     || (agg && o.aggregate.showHull);
    const showGrid = o.forceRatioGrid.enabled || (agg && o.aggregate.showGrid);

    if (o.coverageRings.enabled)      this._computeCoverageRings();
    if (showGrid)                     this._computeForceRatioGrid();
    if (showHull)                     this._computeConvexHull();
    if (o.extrudedFootprints.enabled) this._computeExtrudedFootprints();
  }

  /** True when aggregate mode is active for the current view zoom. */
  private _isInAggregateMode(): boolean {
    const a = this._options.aggregate;
    if (!a.enabled) return false;
    const zoom = (this._view as any)?.zoom;
    if (typeof zoom !== "number") return false;
    return zoom < a.zoomBelow;
  }

  // ─── Layer Effects ─────────────────────────────────────────────────────────

  private _applyLayerEffects(): void {
    if (!this._layerManager) return;
    const opt = this._options.layerEffects;
    const layers = [
      { layer: this._layerManager.getOrCreateLayer(LAYER_NAMES.FORCE),   effect: opt.enabled ? opt.forceEffect   : null },
      { layer: this._layerManager.getOrCreateLayer(LAYER_NAMES.TACT_PT), effect: opt.enabled ? opt.tactPtEffect  : null },
      { layer: this._layerManager.getOrCreateLayer(LAYER_NAMES.TACT),    effect: opt.enabled ? opt.tactEffect    : null },
    ];
    layers.forEach(({ layer, effect }) => {
      try { (layer as any).effect = effect || null; } catch (_) { /* not supported */ }
    });
  }

  private _clearLayerEffects(): void {
    if (!this._layerManager) return;
    [LAYER_NAMES.FORCE, LAYER_NAMES.TACT_PT, LAYER_NAMES.TACT].forEach(name => {
      try { (this._layerManager!.getOrCreateLayer(name) as any).effect = null; } catch (_) { /* */ }
    });
  }

  // ─── Coverage Rings ────────────────────────────────────────────────────────

  private _computeCoverageRings(): void {
    if (!this._vizLayer) return;
    const opt = this._options.coverageRings;
    const { friendly, enemy } = this._getPointGraphics();

    const friendlyBufs: any[] = [];
    const enemyBufs:   any[] = [];

    const addRings = (graphics: Graphic[], color: number[], bufs: any[]) => {
      graphics.forEach(g => {
        const pt = g.geometry as Point;
        if (!pt || pt.type !== "point") return;
        const buf = geometryEngine.geodesicBuffer(pt, opt.radiusKm, "kilometers") as any;
        if (!buf) return;
        bufs.push(buf);
        this._vizLayer!.add(new Graphic({
          geometry: buf,
          symbol: new SimpleFillSymbol({
            color: new Color([color[0], color[1], color[2], opt.fillOpacity]),
            outline: new SimpleLineSymbol({
              color: new Color([color[0], color[1], color[2], 0.7]),
              width: opt.outlineWidth,
              style: "short-dash",
            }),
          }),
          attributes: { [VIZ_TAG]: "ring" },
        }));
      });
    };

    addRings(friendly, opt.friendlyColor, friendlyBufs);
    addRings(enemy,    opt.enemyColor,    enemyBufs);

    if (!opt.showOverlap || friendlyBufs.length === 0 || enemyBufs.length === 0) return;

    try {
      const uF = geometryEngine.union(friendlyBufs) as any;
      const uE = geometryEngine.union(enemyBufs)   as any;
      if (!uF || !uE) return;
      const overlap = geometryEngine.intersect(uF, uE) as any;
      if (!overlap) return;
      const oc = opt.overlapColor;
      this._vizLayer.add(new Graphic({
        geometry: overlap,
        symbol: new SimpleFillSymbol({
          color: new Color([oc[0], oc[1], oc[2], Math.min(opt.fillOpacity * 2.5, 0.5)]),
          outline: new SimpleLineSymbol({
            color: new Color([oc[0], oc[1], oc[2], 0.9]),
            width: opt.outlineWidth + 0.5,
            style: "solid",
          }),
        }),
        attributes: { [VIZ_TAG]: "overlap" },
      }));
    } catch (_) { /* geometry error */ }
  }

  // ─── Force Ratio Grid ──────────────────────────────────────────────────────

  private _computeForceRatioGrid(): void {
    if (!this._vizLayer) return;
    const opt = this._options.forceRatioGrid;
    const { friendly, enemy } = this._getPointGraphics();
    if (friendly.length + enemy.length === 0) return;

    // Compute bounding box of all point symbols
    let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
    [...friendly, ...enemy].forEach(g => {
      const pt = g.geometry as Point;
      if (!pt) return;
      if (pt.x < xmin) xmin = pt.x;
      if (pt.x > xmax) xmax = pt.x;
      if (pt.y < ymin) ymin = pt.y;
      if (pt.y > ymax) ymax = pt.y;
    });

    // Pad the bounding box
    const padX = Math.max((xmax - xmin) * 0.15, 5000);
    const padY = Math.max((ymax - ymin) * 0.15, 5000);
    xmin -= padX; xmax += padX;
    ymin -= padY; ymax += padY;

    // Cell size in metres (Web Mercator — approximate but tactically sufficient)
    const cellM = opt.cellSizeKm * 1000;
    const cols = Math.min(Math.ceil((xmax - xmin) / cellM), 20);
    const rows = Math.min(Math.ceil((ymax - ymin) / cellM), 20);
    if (cols === 0 || rows === 0) return;

    const cellW = (xmax - xmin) / cols;
    const cellH = (ymax - ymin) / rows;

    // Count symbols per cell
    const grid: Array<Array<{ f: number; e: number }>> = Array.from(
      { length: rows }, () => Array.from({ length: cols }, () => ({ f: 0, e: 0 })),
    );

    const assign = (graphics: Graphic[], key: "f" | "e") => {
      graphics.forEach(g => {
        const pt = g.geometry as Point;
        if (!pt) return;
        const c = Math.min(Math.max(Math.floor((pt.x - xmin) / cellW), 0), cols - 1);
        const r = Math.min(Math.max(Math.floor((pt.y - ymin) / cellH), 0), rows - 1);
        grid[r][c][key]++;
      });
    };
    assign(friendly, "f");
    assign(enemy,    "e");

    const sr = (friendly[0] ?? enemy[0]).geometry?.spatialReference ?? { wkid: 102100 };

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = grid[r][c];
        if (cell.f === 0 && cell.e === 0) continue;

        const x0 = xmin + c * cellW, y0 = ymin + r * cellH;
        const x1 = x0 + cellW,       y1 = y0 + cellH;

        const cellPoly = new Polygon({
          rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
          spatialReference: sr,
        });

        const fill = this._ratioColor(cell.f, cell.e, opt);
        this._vizLayer.add(new Graphic({
          geometry: cellPoly,
          symbol: new SimpleFillSymbol({
            color: new Color([fill[0], fill[1], fill[2], opt.fillOpacity]),
            outline: new SimpleLineSymbol({
              color: new Color([fill[0], fill[1], fill[2], 0.35]),
              width: 0.5,
            }),
          }),
          attributes: { [VIZ_TAG]: "grid" },
        }));

        // Small ratio label in each populated cell
        if (cell.f > 0 || cell.e > 0) {
          const label = cell.e === 0 ? `${cell.f}:0` : `${cell.f}:${cell.e}`;
          this._vizLayer.add(new Graphic({
            geometry: new Point({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, spatialReference: sr }),
            symbol: new TextSymbol({
              text: label,
              color: new Color([255, 255, 255, 1]),
              haloColor: new Color([0, 0, 0, 0.85]),
              haloSize: 2,
              font: { size: 15, weight: "bold" },
              verticalAlignment: "middle",
              horizontalAlignment: "center",
            }),
            attributes: { [VIZ_TAG]: "grid-label" },
          }));
        }
      }
    }
  }

  private _ratioColor(f: number, e: number, opt: ForceRatioGridOptions): number[] {
    if (e === 0) return opt.favorableColor;
    if (f === 0) return opt.unfavorableColor;
    const ratio = f / e;
    if (ratio >= 1.5) return opt.favorableColor;
    if (ratio <= 0.67) return opt.unfavorableColor;
    if (ratio > 1) return this._lerpColor(opt.parityColor, opt.favorableColor,   (ratio - 1) / 0.5);
    return              this._lerpColor(opt.parityColor, opt.unfavorableColor, (1 - ratio) / 0.33);
  }

  private _lerpColor(a: number[], b: number[], t: number): number[] {
    const s = Math.max(0, Math.min(1, t));
    return [
      Math.round(a[0] + (b[0] - a[0]) * s),
      Math.round(a[1] + (b[1] - a[1]) * s),
      Math.round(a[2] + (b[2] - a[2]) * s),
    ];
  }

  // ─── Convex Hull ───────────────────────────────────────────────────────────

  private _computeConvexHull(): void {
    if (!this._vizLayer) return;
    const opt = this._options.convexHull;
    const { friendly, enemy, neutral } = this._getPointGraphics();

    const drawHull = (graphics: Graphic[], fillColor: number[]) => {
      if (graphics.length < 3) return;
      const pts = graphics
        .map(g => g.geometry)
        .filter((g): g is Point => !!g && g.type === "point");
      if (pts.length < 3) return;

      try {
        const multipt = new Multipoint({
          points: pts.map(p => [p.x, p.y]),
          spatialReference: pts[0].spatialReference,
        });
        const hull = geometryEngine.convexHull(multipt) as any;
        if (!hull || Array.isArray(hull) || hull.type !== "polygon") return;

        this._vizLayer!.add(new Graphic({
          geometry: hull as Polygon,
          symbol: new SimpleFillSymbol({
            color: new Color([fillColor[0], fillColor[1], fillColor[2], opt.fillOpacity]),
            outline: new SimpleLineSymbol({
              color: new Color([fillColor[0], fillColor[1], fillColor[2], 0.75]),
              width: opt.outlineWidth,
              style: "short-dot",
            }),
          }),
          attributes: { [VIZ_TAG]: "hull" },
        }));
      } catch (_) { /* collinear or single-point degenerate case */ }
    };

    drawHull(friendly, opt.friendlyFillColor);
    drawHull(enemy,    opt.enemyFillColor);
    drawHull(neutral,  opt.neutralFillColor);
  }

  // ─── Extruded Footprints (3D blocks / walls for lines & areas) ─────────────

  private _computeExtrudedFootprints(): void {
    if (!this._vizLayer || !this._layerManager) return;
    if ((this._view as any)?.type === "2d") return; // walls only meaningful in SceneView

    const opt = this._options.extrudedFootprints;
    const tactLayer = this._layerManager.getOrCreateLayer(LAYER_NAMES.TACT);
    if (!tactLayer?.graphics) return;

    const FRIENDLY = [0, 100, 200];
    const ENEMY    = [220, 50, 50];
    const NEUTRAL  = [80, 200, 120];
    const UNKNOWN  = [200, 200, 80];

    const resolveColor = (g: Graphic): number[] => {
      if (opt.colorMode === "single") return opt.singleColor;
      if (opt.colorMode === "inherit") {
        const sym = g.symbol as any;
        const c = sym?.color;
        if (c) {
          if (Array.isArray(c)) return [c[0], c[1], c[2]];
          if (typeof c.r === "number") return [c.r, c.g, c.b];
        }
        return opt.singleColor;
      }
      const id = this._getIdentity(g);
      if (id === "friendly") return FRIENDLY;
      if (id === "enemy")    return ENEMY;
      if (id === "neutral")  return NEUTRAL;
      return UNKNOWN;
    };

    const alpha = Math.max(0, Math.min(1, opt.fillOpacity));
    const makeFill = (rgb: number[]): SimpleFillSymbol =>
      new SimpleFillSymbol({
        color: new Color([rgb[0], rgb[1], rgb[2], alpha]),
        outline: new SimpleLineSymbol({
          color: new Color([opt.edgeColor[0], opt.edgeColor[1], opt.edgeColor[2], opt.polygonShowEdges ? 0.9 : 0]),
          width: opt.polygonShowEdges ? 1 : 0,
        }),
      });

    const addWallQuad = (
      x0: number, y0: number, x1: number, y1: number,
      h: number, sr: any, fillSym: SimpleFillSymbol, tag: string,
    ): void => {
      this._vizLayer!.add(new Graphic({
        geometry: new Polygon({
          rings: [[
            [x0, y0, 0],
            [x1, y1, 0],
            [x1, y1, h],
            [x0, y0, h],
            [x0, y0, 0],
          ]] as any,
          hasZ: true,
          spatialReference: sr,
        } as any),
        symbol: fillSym,
        attributes: { [VIZ_TAG]: tag },
      }));
    };

    const tactGraphics = this._filterByExtent(tactLayer.graphics.toArray());
    tactGraphics.forEach((g: Graphic) => {
      if (g.attributes?.[VIZ_TAG]) return;
      const geom = g.geometry as any;
      if (!geom) return;

      const rgb = resolveColor(g);
      const fillSym = makeFill(rgb);

      if (geom.type === "polygon" && opt.extrudePolygons) {
        const sr = geom.spatialReference;
        const H = opt.polygonHeightM;
        const rings: number[][][] = geom.rings ?? [];

        rings.forEach((ring) => {
          for (let i = 0; i < ring.length - 1; i++) {
            const [x0, y0] = ring[i];
            const [x1, y1] = ring[i + 1];
            addWallQuad(x0, y0, x1, y1, H, sr, fillSym, "extruded-polygon");
          }
        });

        // Top cap — clone rings lifted to z=H
        const topRings = rings.map((ring) =>
          ring.map(([x, y]) => [x, y, H]),
        );
        this._vizLayer!.add(new Graphic({
          geometry: new Polygon({
            rings: topRings as any,
            hasZ: true,
            spatialReference: sr,
          } as any),
          symbol: fillSym,
          attributes: { [VIZ_TAG]: "extruded-polygon" },
        }));
        return;
      }

      if (geom.type === "polyline" && opt.extrudeLines) {
        const sr = geom.spatialReference;
        const H = opt.lineWallHeightM;
        const T = Math.max(0, opt.lineWallThicknessM);
        const paths: number[][][] = geom.paths ?? [];

        if (T <= 0) {
          // Thin sheet — vertical quad along each segment
          paths.forEach((path) => {
            for (let i = 0; i < path.length - 1; i++) {
              const [x0, y0] = path[i];
              const [x1, y1] = path[i + 1];
              addWallQuad(x0, y0, x1, y1, H, sr, fillSym, "extruded-line");
            }
          });
        } else {
          // Buffer the polyline into a corridor polygon, then extrude as walls + cap
          try {
            const corridor = geometryEngine.geodesicBuffer(geom, T / 2, "meters") as any;
            const corridors: any[] = Array.isArray(corridor) ? corridor : [corridor];
            corridors.forEach((poly) => {
              if (!poly?.rings) return;
              const cRings: number[][][] = poly.rings;
              cRings.forEach((ring) => {
                for (let i = 0; i < ring.length - 1; i++) {
                  const [x0, y0] = ring[i];
                  const [x1, y1] = ring[i + 1];
                  addWallQuad(x0, y0, x1, y1, H, poly.spatialReference ?? sr, fillSym, "extruded-line");
                }
              });
              const topRings = cRings.map((ring) =>
                ring.map(([x, y]) => [x, y, H]),
              );
              this._vizLayer!.add(new Graphic({
                geometry: new Polygon({
                  rings: topRings as any,
                  hasZ: true,
                  spatialReference: poly.spatialReference ?? sr,
                } as any),
                symbol: fillSym,
                attributes: { [VIZ_TAG]: "extruded-line" },
              }));
            });
          } catch (_) { /* buffer failed — skip */ }
        }
      }
    });
  }

  // ─── Threat Fan (on-demand, callable from context menu) ────────────────────

  /**
   * Draw time-distance threat projection rings centred on the given graphic.
   * Each entry in timeHoursIntervals produces a concentric circle whose radius
   * equals speedKmh × hours.  Outermost ring is drawn first (largest, behind).
   */
  public showThreatFan(
    graphic: Graphic,
    speedKmh: number,
    timeHoursIntervals: number[],
  ): void {
    if (!this._vizLayer) return;
    const pt = graphic.geometry as Point;
    if (!pt || pt.type !== "point") return;

    // Remove any previous threat-fan graphics
    const existing = this._vizLayer.graphics.filter(
      (g: Graphic) => g.attributes?.[VIZ_TAG] === "threatfan",
    ).toArray();
    existing.forEach((g: Graphic) => this._vizLayer!.remove(g));

    const palette: Array<[number, number, number, number]> = [
      [255, 200,   0, 0.20],
      [255, 120,  30, 0.28],
      [220,  50,  50, 0.36],
    ];

    // Draw outermost first so inner rings sit on top
    [...timeHoursIntervals]
      .map((h, i) => ({ h, i }))
      .sort((a, b) => b.h - a.h)
      .forEach(({ h, i }) => {
        const radiusKm = speedKmh * h;
        if (radiusKm <= 0) return;
        const buf = geometryEngine.geodesicBuffer(pt, radiusKm, "kilometers") as any;
        if (!buf) return;
        const [r, g, b, a] = palette[Math.min(i, palette.length - 1)];
        this._vizLayer!.add(new Graphic({
          geometry: buf,
          symbol: new SimpleFillSymbol({
            color: new Color([r, g, b, a]),
            outline: new SimpleLineSymbol({
              color: new Color([r, g, b, 0.85]),
              width: 1.5,
              style: "solid",
            }),
          }),
          attributes: { [VIZ_TAG]: "threatfan" },
        }));
      });
  }

  /** Remove all threat-fan overlays */
  public clearThreatFan(): void {
    if (!this._vizLayer) return;
    this._vizLayer.graphics
      .filter((g: Graphic) => g.attributes?.[VIZ_TAG] === "threatfan")
      .toArray()
      .forEach((g: Graphic) => this._vizLayer!.remove(g));
  }

  // ─── Threat / Engagement Sector (azimuth-bounded wedge) ────────────────────

  /**
   * Draw a geodesic engagement/threat sector (wedge) centered on a point.
   * Sweeps CLOCKWISE from azStartDeg to azEndDeg. Multiple sectors may coexist;
   * use clearSectors() to remove them all.
   */
  public showSector(
    center: Point | Graphic,
    opts: {
      rangeKm: number;
      azStartDeg: number;
      azEndDeg: number;
      color?: [number, number, number];
      opacity?: number;
    },
  ): void {
    if (!this._vizLayer) return;
    const pt = ("geometry" in center ? center.geometry : center) as Point | null;
    if (!pt || pt.type !== "point") return;
    if (!(opts.rangeKm > 0)) return;
    if (((opts.azEndDeg - opts.azStartDeg) % 360 + 360) % 360 === 0) return; // degenerate

    const ring = buildSectorRing(
      pt.longitude as number, pt.latitude as number,
      opts.rangeKm, opts.azStartDeg, opts.azEndDeg,
    );
    const polygon = new Polygon({ rings: [ring], spatialReference: { wkid: 4326 } });
    const [r, g, b] = opts.color ?? [220, 50, 50];
    const a = opts.opacity ?? 0.30;
    this._vizLayer.add(new Graphic({
      geometry: polygon,
      symbol: new SimpleFillSymbol({
        color: new Color([r, g, b, a]),
        outline: new SimpleLineSymbol({ color: new Color([r, g, b, 0.85]), width: 1.5, style: "solid" }),
      }),
      attributes: { [VIZ_TAG]: "sector" },
    }));
  }

  /** Remove all sector overlays (committed and preview). */
  public clearSectors(): void {
    if (!this._vizLayer) return;
    this._vizLayer.graphics
      .filter((g: Graphic) => g.attributes?.[VIZ_TAG] === "sector" || g.attributes?.[VIZ_TAG] === "sector-preview")
      .toArray()
      .forEach((g: Graphic) => this._vizLayer!.remove(g));
  }

  /** Internal: draw/replace the live preview wedge while the SectorDrawTool is active. */
  public _renderSectorPreview(
    pt: Point, rangeKm: number, azStartDeg: number, azEndDeg: number,
  ): void {
    if (!this._vizLayer) return;
    this._vizLayer.graphics
      .filter((g: Graphic) => g.attributes?.[VIZ_TAG] === "sector-preview")
      .toArray()
      .forEach((g: Graphic) => this._vizLayer!.remove(g));
    if (!(rangeKm > 0)) return;
    const ring = buildSectorRing(
      pt.longitude as number, pt.latitude as number, rangeKm, azStartDeg, azEndDeg,
    );
    this._vizLayer.add(new Graphic({
      geometry: new Polygon({ rings: [ring], spatialReference: { wkid: 4326 } }),
      symbol: new SimpleFillSymbol({
        color: new Color([220, 50, 50, 0.15]),
        outline: new SimpleLineSymbol({ color: new Color([220, 50, 50, 0.9]), width: 1.5, style: "dash" }),
      }),
      attributes: { [VIZ_TAG]: "sector-preview" },
    }));
  }

  public clearSectorPreview(): void {
    if (!this._vizLayer) return;
    this._vizLayer.graphics
      .filter((g: Graphic) => g.attributes?.[VIZ_TAG] === "sector-preview")
      .toArray()
      .forEach((g: Graphic) => this._vizLayer!.remove(g));
  }

  // ─── MGRS Density Heatmap (cells snapped to the MGRS/UTM grid) ─────────────

  /**
   * Shade MGRS grid cells by the symbols they contain. Cells are true UTM-aligned
   * squares at the chosen precision (0 = 100 km, 1 = 10 km, 2 = 1 km). In "ratio"
   * mode each cell is coloured by friendly:hostile force ratio (favourable / parity /
   * unfavourable, contested = mixed) reusing the force-ratio palette; in "count" mode
   * cells are a single amber hue whose opacity scales with total symbol density.
   * Opacity always scales with how busy the cell is relative to the busiest cell.
   */
  public showMgrsDensity(opts?: { precision?: 0 | 1 | 2; mode?: "ratio" | "count" }): void {
    if (!this._vizLayer) return;
    const precision = opts?.precision ?? 1;
    const intervalM = precision === 0 ? 100000 : precision === 1 ? 10000 : 1000;
    const mode = opts?.mode ?? "ratio";
    const { friendly, enemy } = this._getPointGraphics();
    if (friendly.length + enemy.length === 0) return;

    this.clearMgrsDensity();

    type Cell = { f: number; e: number; zone: number; south: boolean; ce: number; cn: number };
    const cells = new Map<string, Cell>();
    const bin = (graphics: Graphic[], key: "f" | "e") => {
      graphics.forEach(g => {
        const pt = g.geometry as Point;
        if (!pt) return;
        const lon = pt.longitude as number;
        const lat = pt.latitude as number;
        if (lon == null || lat == null || Number.isNaN(lon) || Number.isNaN(lat)) return;
        const zone = Math.floor((lon + 180) / 6) + 1;
        const utm = latLonToUTM(lat, lon, zone);
        const south = lat < 0;
        const ce = Math.floor(utm.e / intervalM);
        const cn = Math.floor(utm.n / intervalM);
        const id = `${zone}:${south ? "S" : "N"}:${ce}:${cn}`;
        let cell = cells.get(id);
        if (!cell) { cell = { f: 0, e: 0, zone, south, ce, cn }; cells.set(id, cell); }
        cell[key]++;
      });
    };
    bin(friendly, "f");
    bin(enemy, "e");

    let maxTotal = 1;
    cells.forEach(c => { maxTotal = Math.max(maxTotal, c.f + c.e); });

    cells.forEach(cell => {
      const e0 = cell.ce * intervalM, n0 = cell.cn * intervalM;
      const e1 = e0 + intervalM,      n1 = n0 + intervalM;
      const sw = utmToLatLon(cell.zone, cell.south, e0, n0);
      const se = utmToLatLon(cell.zone, cell.south, e1, n0);
      const ne = utmToLatLon(cell.zone, cell.south, e1, n1);
      const nw = utmToLatLon(cell.zone, cell.south, e0, n1);
      const ring: number[][] = [
        [sw.lon, sw.lat], [se.lon, se.lat], [ne.lon, ne.lat], [nw.lon, nw.lat], [sw.lon, sw.lat],
      ];
      const poly = new Polygon({ rings: [ring], spatialReference: { wkid: 4326 } });

      const total = cell.f + cell.e;
      const heat = total / maxTotal;
      let fill: number[];
      let alpha: number;
      if (mode === "count") {
        fill = [255, 140, 0];
        alpha = 0.15 + 0.5 * heat;
      } else {
        fill = this._ratioColor(cell.f, cell.e, this._options.forceRatioGrid);
        alpha = 0.20 + 0.35 * heat;
      }

      this._vizLayer!.add(new Graphic({
        geometry: poly,
        symbol: new SimpleFillSymbol({
          color: new Color([fill[0], fill[1], fill[2], alpha]),
          outline: new SimpleLineSymbol({ color: new Color([fill[0], fill[1], fill[2], 0.5]), width: 0.75 }),
        }),
        attributes: { [VIZ_TAG]: "mgrs-density" },
      }));

      const c = utmToLatLon(cell.zone, cell.south, e0 + intervalM / 2, n0 + intervalM / 2);
      const label = mode === "count"
        ? `${total}`
        : (cell.e === 0 ? `${cell.f}:0` : `${cell.f}:${cell.e}`);
      this._vizLayer!.add(new Graphic({
        geometry: new Point({ x: c.lon, y: c.lat, spatialReference: { wkid: 4326 } }),
        symbol: new TextSymbol({
          text: label,
          color: new Color([255, 255, 255, 1]),
          haloColor: new Color([0, 0, 0, 0.85]),
          haloSize: 2,
          font: { size: 13, weight: "bold" },
          verticalAlignment: "middle",
          horizontalAlignment: "center",
        }),
        attributes: { [VIZ_TAG]: "mgrs-density-label" },
      }));
    });
  }

  /** Remove all MGRS density-heatmap overlays. */
  public clearMgrsDensity(): void {
    if (!this._vizLayer) return;
    this._vizLayer.graphics
      .filter((g: Graphic) => g.attributes?.[VIZ_TAG] === "mgrs-density" || g.attributes?.[VIZ_TAG] === "mgrs-density-label")
      .toArray()
      .forEach((g: Graphic) => this._vizLayer!.remove(g));
  }

  // ─── Render Settings (lift / drop lines / quality / shadows / atmosphere) ──

  private _captureInitialSceneRenderState(view: SceneView): void {
    const sceneView = view as any;
    const lighting = sceneView.environment?.lighting;
    const atmosphere = sceneView.environment?.atmosphere;
    this._initialSceneRenderState = {
      qualityProfile: sceneView.qualityProfile,
      directShadowsEnabled: lighting?.directShadowsEnabled,
      ambientOcclusionEnabled: lighting?.ambientOcclusionEnabled,
      atmosphereQuality: atmosphere?.quality,
    };
  }

  private _applyRenderSettings(sceneView: SceneView, render: RenderOptions): void {
    const sv = sceneView as any;
    const defaults = this._initialSceneRenderState;

    if (render.highQuality3D === true) {
      sv.qualityProfile = 'high';
    } else if (defaults?.qualityProfile !== undefined) {
      sv.qualityProfile = defaults.qualityProfile;
    }

    const lighting = sv.environment?.lighting;
    if (lighting) {
      if (render.disableSceneShadows === true) {
        lighting.directShadowsEnabled = false;
        lighting.ambientOcclusionEnabled = false;
      } else {
        if (defaults?.directShadowsEnabled !== undefined) {
          lighting.directShadowsEnabled = defaults.directShadowsEnabled;
        }
        if (defaults?.ambientOcclusionEnabled !== undefined) {
          lighting.ambientOcclusionEnabled = defaults.ambientOcclusionEnabled;
        }
      }
    }

    const atmosphere = sv.environment?.atmosphere;
    if (atmosphere) {
      if (render.highAtmosphereQuality === true) {
        atmosphere.quality = 'high';
      } else if (defaults?.atmosphereQuality !== undefined) {
        atmosphere.quality = defaults.atmosphereQuality;
      }
    }

    this._normalizeSymbolLayerMembership(sceneView);
    this._applySymbolElevationSettings(sceneView, render);
  }

  /**
   * Move stray graphics back to the symbol layer that matches their
   * drawEssentials kind. Without this, symbols added before render settings
   * existed could end up on the wrong layer and resist elevation changes.
   */
  private _normalizeSymbolLayerMembership(sceneView: SceneView): void {
    const renderLayerIds = Object.values(RENDER_LAYER_IDS);
    renderLayerIds.forEach((layerId) => {
      const layer = sceneView.map.findLayerById(layerId) as any;
      if (!layer?.graphics) return;
      Array.from(layer.graphics).forEach((graphic: any) => {
        const targetLayerId = this._getRenderLayerIdForGraphic(graphic);
        if (!targetLayerId || targetLayerId === layerId) return;
        const targetLayer = sceneView.map.findLayerById(targetLayerId) as any;
        if (!targetLayer) return;
        layer.remove(graphic);
        targetLayer.add(graphic);
      });
    });
  }

  private _getRenderLayerIdForGraphic(graphic: any): string | null {
    const drawEssentials = graphic?.attributes?.drawEssentials;
    if (!drawEssentials) return null;
    const symGeoType = String(drawEssentials.SYM_GEO_TYPE ?? '').toLowerCase();
    const isUei = drawEssentials.UEI === '1' || drawEssentials.UEI === 1;
    if (isUei || symGeoType === 'fpoint') {
      return RENDER_LAYER_IDS.forcePoints;
    }
    if (symGeoType === 'point' || graphic.geometry?.type === 'point') {
      return RENDER_LAYER_IDS.tacticalPoints;
    }
    return RENDER_LAYER_IDS.linesAreas;
  }

  private _applySymbolElevationSettings(
    sceneView: SceneView,
    render: RenderOptions,
  ): void {
    const offset =
      typeof render.symbolElevationOffset === 'number'
        ? render.symbolElevationOffset
        : 1;
    const legacyLiftAll = render.liftSymbolsFromGround === true;
    const liftForcePoints = render.liftForcePoints ?? legacyLiftAll;
    const liftTacticalPoints = render.liftTacticalPoints ?? legacyLiftAll;
    const liftLinesAreas = render.liftLinesAreas ?? legacyLiftAll;

    // Bias the force-point layer slightly higher than the drop-line tip when
    // drop lines are on. milsymbol-generated PictureMarkers anchor at the
    // unit-frame centre, with modifiers/labels rendered below it, so a line
    // ending at the bare anchor altitude appears to overrun the symbol body.
    // Lifting the marker an extra fraction of the offset (clamped to a sane
    // minimum so it still works at small offsets) makes the line tip clearly
    // terminate beneath the symbol — flag above the halyard tip, not stuck
    // through the middle of it.
    const dropLinesOn = liftForcePoints && render.forcePointDropLines !== false && offset > 0;
    const forceOffset = dropLinesOn
      ? offset + Math.max(15, offset * 0.15)
      : offset;

    this._applyLayerElevation(sceneView, RENDER_LAYER_IDS.forcePoints,    liftForcePoints,    forceOffset);
    this._applyLayerElevation(sceneView, RENDER_LAYER_IDS.tacticalPoints, liftTacticalPoints, offset);
    this._applyLayerElevation(sceneView, RENDER_LAYER_IDS.linesAreas,     liftLinesAreas,     offset);

    this._applyForcePointDropLines(sceneView, render, liftForcePoints, offset);
  }

  private _applyLayerElevation(
    sceneView: SceneView,
    layerId: string,
    shouldLift: boolean,
    offset: number,
  ): void {
    const layer = sceneView.map.findLayerById(layerId) as any;
    if (!layer) return;
    layer.elevationInfo = shouldLift && offset > 0
      ? { mode: 'relative-to-ground', offset }
      : { mode: 'on-the-ground' };
  }

  private _getOrCreateDropLineLayer(sceneView: SceneView): any {
    let layer = sceneView.map.findLayerById(RENDER_LAYER_IDS.forcePointDropLines) as any;
    if (!layer) {
      layer = new GraphicsLayer({
        id: RENDER_LAYER_IDS.forcePointDropLines,
        title: 'Force Point Drop Lines',
        listMode: 'hide',
        elevationInfo: { mode: 'relative-to-ground', offset: 0 },
      } as any);
      sceneView.map.add(layer, 0);
    }
    return layer;
  }

  private _rebuildForcePointDropLines(
    sceneView: SceneView,
    render: RenderOptions,
    offset: number,
  ): void {
    const layer = this._getOrCreateDropLineLayer(sceneView);
    layer.removeAll();
    if (offset <= 0) return;

    const forceLayer = sceneView.map.findLayerById(RENDER_LAYER_IDS.forcePoints) as any;
    if (!forceLayer?.graphics) return;

    const color = render.dropLineColor ?? [40, 40, 40];
    const width = render.dropLineWidth ?? 1.5;
    const opacity = render.dropLineOpacity ?? 0.85;
    const rgba: [number, number, number, number] = [color[0], color[1], color[2], opacity];

    Array.from(forceLayer.graphics).forEach((g: any) => {
      const geom = g?.geometry;
      if (!geom || geom.type !== 'point') return;
      const pt = geom as Point;
      const line = new Polyline({
        hasZ: true,
        paths: [[
          [pt.x, pt.y, offset],
          [pt.x, pt.y, 0],
        ]],
        spatialReference: pt.spatialReference,
      } as any);
      // Dark casing under a dashed coloured top — matches the
      // Trafficability route / Ladder spine styling so all three engines
      // share the same visual language for "line dropped over terrain".
      layer.add(new Graphic({
        geometry: line,
        symbol: new SimpleLineSymbol({
          color: [14, 20, 26, 0.5] as any,
          width: width * 2.5,
          style: 'solid',
        }) as any,
        attributes: { __dropLine__: true },
      } as any));
      layer.add(new Graphic({
        geometry: line,
        symbol: new SimpleLineSymbol({
          color: rgba,
          width,
          style: 'short-dash',
        }) as any,
        attributes: { __dropLine__: true },
      } as any));
    });
  }

  private _applyForcePointDropLines(
    sceneView: SceneView,
    render: RenderOptions,
    liftForcePoints: boolean,
    offset: number,
  ): void {
    const enabled = liftForcePoints && (render.forcePointDropLines !== false) && offset > 0;

    if (this._dropLineWatcher) {
      this._dropLineWatcher.remove();
      this._dropLineWatcher = null;
    }

    const layer = this._getOrCreateDropLineLayer(sceneView);
    layer.visible = enabled;

    if (!enabled) {
      layer.removeAll();
      return;
    }

    this._rebuildForcePointDropLines(sceneView, render, offset);

    const forceLayer = sceneView.map.findLayerById(RENDER_LAYER_IDS.forcePoints) as any;
    if (forceLayer?.graphics) {
      this._dropLineWatcher = reactiveUtils.watch(
        () => forceLayer.graphics.length,
        () => this._rebuildForcePointDropLines(sceneView, render, offset),
      );
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private _clearVizLayer(): void {
    this._vizLayer?.removeAll();
  }

  private _getPointGraphics(): {
    friendly: Graphic[];
    enemy: Graphic[];
    neutral: Graphic[];
  } {
    if (!this._layerManager) return { friendly: [], enemy: [], neutral: [] };

    const friendly: Graphic[] = [];
    const enemy:    Graphic[] = [];
    const neutral:  Graphic[] = [];

    [LAYER_NAMES.FORCE, LAYER_NAMES.TACT_PT, LAYER_NAMES.TACT].forEach(name => {
      const layer = this._layerManager!.getOrCreateLayer(name);
      layer.graphics.forEach((g: Graphic) => {
        if (g.attributes?.[VIZ_TAG]) return; // skip our own overlays
        const geo = g.geometry;
        if (!geo || geo.type !== "point") return;
        const id = this._getIdentity(g);
        if (id === "friendly")      friendly.push(g);
        else if (id === "enemy")    enemy.push(g);
        else if (id === "neutral")  neutral.push(g);
      });
    });

    return {
      friendly: this._filterByExtent(friendly),
      enemy:    this._filterByExtent(enemy),
      neutral:  this._filterByExtent(neutral),
    };
  }

  /**
   * Filter graphics to those overlapping the current view extent, padded 1.5×
   * so symbols just off-screen still contribute (e.g. coverage rings reaching in).
   * Falls back to the full list if extent is unavailable or the SRs disagree.
   */
  private _filterByExtent<T extends Graphic>(graphics: T[]): T[] {
    const view = this._view as any;
    const ext = view?.extent;
    if (!ext || graphics.length === 0) return graphics;
    let padded: any;
    try { padded = ext.clone().expand(1.5); } catch { padded = ext; }
    return graphics.filter(g => {
      const geom = g.geometry as any;
      if (!geom) return false;
      if (geom.type === "point") {
        try { return padded.contains(geom); } catch { return true; }
      }
      const gExt = geom.extent;
      if (gExt) {
        try { return padded.intersects(gExt); } catch { return true; }
      }
      return true;
    });
  }

  private _getIdentity(graphic: Graphic): "friendly" | "enemy" | "neutral" | "unknown" {
    const de  = graphic.attributes?.drawEssentials;
    const raw = de?.SIDC ?? de?.AMPLIFIER?.SIDC ?? "";
    const sidc = String(raw ?? "");
    if (sidc.length < 4) return "unknown";

    const code = sidc.substring(2, 4);
    if (code === "02" || code === "03") return "friendly";
    if (code === "05" || code === "06") return "enemy";  // "07" removed — not a valid 2525D code (likely typo for "06")
    if (code === "04") return "neutral";
    // "00" (Pending) and "01" (Unknown) fall through intentionally — excluded from overlays
    return "unknown";
  }
}

export default VisualizationEngine;
