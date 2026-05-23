import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import Point from "@arcgis/core/geometry/Point";
import Multipoint from "@arcgis/core/geometry/Multipoint";
import Polygon from "@arcgis/core/geometry/Polygon";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import TextSymbol from "@arcgis/core/symbols/TextSymbol";
import Color from "@arcgis/core/Color";
import * as geometryEngine from "@arcgis/core/geometry/geometryEngine";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import GraphicsLayerManager, { LAYER_NAMES } from "../../Managers/GraphicsLayerManager";

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
  /** Lift force/UEI point symbols above terrain */
  liftForcePoints: boolean;
  /** Lift tactical point symbols above terrain */
  liftTacticalPoints: boolean;
  /** Lift tactical line/area graphics above terrain */
  liftLinesAreas: boolean;
  /** Elevation offset (metres) used when a lift flag is enabled */
  symbolElevationOffset: number;
}

export interface VisualizationOptions {
  render: RenderOptions;
  layerEffects: LayerEffectsOptions;
  coverageRings: CoverageRingsOptions;
  forceRatioGrid: ForceRatioGridOptions;
  convexHull: ConvexHullOptions;
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
    symbolElevationOffset: 1,
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
    fillOpacity: 0.1,
    outlineWidth: 2,
  },
};

const VIZ_LAYER_ID = "VisualizationOverlayLayer";
const VIZ_TAG = "__viz__";

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

  public setOptions(options: Partial<VisualizationOptions>): void {
    if (options.render)         Object.assign(this._options.render,         options.render);
    if (options.layerEffects)   Object.assign(this._options.layerEffects,   options.layerEffects);
    if (options.coverageRings)  Object.assign(this._options.coverageRings,  options.coverageRings);
    if (options.forceRatioGrid) Object.assign(this._options.forceRatioGrid, options.forceRatioGrid);
    if (options.convexHull)     Object.assign(this._options.convexHull,     options.convexHull);

    if (this._enabled) {
      this._applyLayerEffects();
      this._scheduleRefresh();
    }
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
      });
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
          () => layer.graphics.length,
          () => this._scheduleRefresh(),
        ),
      );
    };

    watchLayer(LAYER_NAMES.FORCE);
    watchLayer(LAYER_NAMES.TACT_PT);
    watchLayer(LAYER_NAMES.TACT);

    // Refresh grid when the view extent changes
    this._watchers.push(
      reactiveUtils.watch(
        () => (this._view as any)?.extent,
        () => {
          if (this._enabled && this._options.forceRatioGrid.enabled) {
            this._scheduleRefresh();
          }
        },
      ),
    );
  }

  private _clearWatchers(): void {
    this._watchers.forEach(h => h.remove());
    this._watchers = [];
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
    if (this._options.coverageRings.enabled)  this._computeCoverageRings();
    if (this._options.forceRatioGrid.enabled) this._computeForceRatioGrid();
    if (this._options.convexHull.enabled)     this._computeConvexHull();
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
              color: new Color([255, 255, 255, 0.85]),
              haloColor: new Color([0, 0, 0, 0.6]),
              haloSize: 1,
              font: { size: 9, weight: "bold" },
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
    const { friendly, enemy } = this._getPointGraphics();

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

    return { friendly, enemy, neutral };
  }

  private _getIdentity(graphic: Graphic): "friendly" | "enemy" | "neutral" | "unknown" {
    const de  = graphic.attributes?.drawEssentials;
    const raw = de?.SIDC ?? de?.AMPLIFIER?.SIDC ?? "";
    const sidc = String(raw ?? "");
    if (sidc.length < 4) return "unknown";

    const code = sidc.substring(2, 4);
    if (code === "02" || code === "03") return "friendly";
    if (code === "05" || code === "06" || code === "07") return "enemy";
    if (code === "04") return "neutral";
    return "unknown";
  }
}

export default VisualizationEngine;
