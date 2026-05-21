import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";

import SymbolEvents from "../Support/SymbolEvents";
export interface FwdLineOfTpsOptions {
  CTRL_PTS?: Point[];
  GEOM?: Polyline;
  DRAW_TYPE?: number;
  [key: string]: any;
}

/**
 * FwdLineOfTps class for drawing fwd line of tps symbols on MapView or SceneView
 * Supports both immediate placement and interactive drawing modes
 */
export class FwdLineOfTps {
  private view: MapView | SceneView;
  private layerManager: GraphicsLayerManager;
  private symbolLayer: GraphicsLayer;
  private isLine: boolean;

  // Symbol properties
  public declaredClass: string = "MilitarySymbology.Symbols.FwdLineOfTps";
  public SID: string = "140101";
  public symName: string = "Fwd Line of Troops";
  public symGeometricType: string = "Line";

  private _lineSym: SimpleLineSymbol | null = null;
  private _points: Point[] = [];
  private _drawType: number = 1;
  private _geometryType: string | null = null;
  private amplifier: Amplifier;

  // Drawing state
  private isDrawing: boolean = false;
  private tempGraphic: Graphic | null = null;

  // Event handlers
  private clickHandler: any = null;
  private doubleClickHandler: any = null;
  private mouseMoveHandler: any = null;

  // Event emitter
  private events: SymbolEvents;

  constructor(view: MapView | SceneView, isLine: boolean = false) {
    this.view = view;
    this.isLine = isLine;
    this.layerManager = GraphicsLayerManager.getInstance(view);
    this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.FORCE);
    this.amplifier = new Amplifier();
    this.events = new SymbolEvents(view, "FwdLineOfTps");

    // Initialize layers if not already done
    this.layerManager.initializeLayers();

    // Initialize temporary graphic
    this.tempGraphic = new Graphic();
  }

  /**
   * Initialize the FLOT line drawing
   */
  public init(options: FwdLineOfTpsOptions, marker: SimpleLineSymbol): void {
    this._lineSym = marker;
    // Set up event handlers
    this.setupEventHandlers();

    this._drawType = GeoTools.setDefault(options, "DRAW_TYPE", this._drawType);

    const hasCtrlPts = options.hasOwnProperty("CTRL_PTS") && Array.isArray(options.CTRL_PTS);
    const hasGeom = options.hasOwnProperty("GEOM") && options.GEOM;

    const drawEss = hasCtrlPts ? this.createDrawEssentials(options.CTRL_PTS!.slice(), this._drawType) : null;

    if (this._drawType === 2 && hasCtrlPts) {
      // For DRAW_TYPE 2, ignore GEOM even if provided
      const geometry = this.createSymbol(drawEss!);
      if (geometry && this.tempGraphic) {
        this.tempGraphic.geometry = geometry;
        this.__drawEnd(geometry, drawEss!);
        this._clear();
        this._removeEvents();
      }

    } else if (hasCtrlPts && hasGeom && this.tempGraphic) {
      // For other draw types, use GEOM if provided
      try {
        this.tempGraphic.geometry = new Polyline({
          paths: options.GEOM,
          spatialReference: this.view.spatialReference
        });
      } catch (error) {
        console.error(this.symName, "Failed to create Polyline geometry:", error);
      }

      if (this.tempGraphic.geometry) {
        this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEss!);
        this._clear();
        this._removeEvents();
      }

    } else if (hasCtrlPts) {
      // Only CTRL_PTS provided
      const geometry = this.createSymbol(drawEss!);
      if (geometry && this.tempGraphic) {
        this.tempGraphic.geometry = geometry;
        this.__drawEnd(geometry, drawEss!);
        this._clear();
        this._removeEvents();
      }

    } else {
      // Fallback to interactive drawing mode
      this.startInteractiveDrawing();
    }
  }

  /**
   * Start interactive drawing mode
   */
  private startInteractiveDrawing(): void {
    if (!this._lineSym) return;
    this.isDrawing = true;
    this.tempGraphic = new Graphic({
      geometry: null,
      symbol: this._lineSym
    });
    this.symbolLayer.add(this.tempGraphic);
  }

  /**
   * Set up mouse event handlers for interactive drawing
   */
  private setupEventHandlers(): void {
    // Click handler
    this.clickHandler = this.view.on("click", (event) => {
      this._onClickHandler(event);
    });

    // Double click handler
    this.doubleClickHandler = this.view.on("double-click", (event) => {
      this._onDoubleClickHandler(event);
    });
  }

  /**
   * Handle click events
   */
  private _onClickHandler(clickEvent: any): void {
    const mapPoint = this.view.toMap(clickEvent);
    if (!mapPoint) return;

    const point = new Point({
      x: mapPoint.x,
      y: mapPoint.y,
      spatialReference: this.view.spatialReference
    });

    this._points.push(point);

    if (this._points.length === 1) {
      // First click - set up mouse move handler
      this.mouseMoveHandler = this.view.on("pointer-move", (event) => {
        this._onMouseMoveHandler(event);
      });
    }

    this.events.emit("onDrawClick", { currentPts: this._points });

    // For single line mode, finish after first click
    if (this.isLine === true && this._points.length === 1) {
      this.events.emit("onDrawClick", { currentPts: this._points });
      this.cleanUp();
    }
  }

  /**
   * Handle double click events
   */
  private _onDoubleClickHandler(clickEvent: any): void {
    const mapPoint = this.view.toMap(clickEvent);
    if (!mapPoint) return;

    const point = new Point({
      x: mapPoint.x,
      y: mapPoint.y,
      spatialReference: this.view.spatialReference
    });

    this._points.push(point);
    this.cleanUp();
  }

  /**
   * Handle mouse move events
   */
  private _onMouseMoveHandler(inputEvent: any): void {
    if (!this.isDrawing || !this.tempGraphic) return;

    const mapPoint = this.view.toMap(inputEvent);
    if (!mapPoint) return;

    const candidatePoint = new Point({
      x: mapPoint.x,
      y: mapPoint.y,
      spatialReference: this.view.spatialReference
    });

    const drawEssentials = new DrawEssentials();
    drawEssentials.CTRL_PTS = this._points.concat([candidatePoint]);
    drawEssentials.DRAW_TYPE = this._drawType;

    const geometry = this.createSymbol(drawEssentials);
    if (geometry) {
      this.tempGraphic.geometry = geometry;
      this.events.emit("onDrawProgress", {
        currentGeometry: geometry,
        currentDrawEssentials: drawEssentials,
        currentMarker: this._lineSym
      });
    }
  }

  /**
   * Create DrawEssentials object
   */
  private createDrawEssentials(ctrlPts: Point[], drawType: number): DrawEssentials {
    const drawEssentials = new DrawEssentials();
    drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
    drawEssentials.SID = this.SID;
    drawEssentials.SYM_NAME = this.symName;
    drawEssentials.GEOM = null;
    drawEssentials.AMPLIFIER = this.amplifier.toString();
    // Store additional properties
    (drawEssentials as any).SCOPE = this;
    (drawEssentials as any).CTRL_PTS = ctrlPts;
    (drawEssentials as any).DRAW_TYPE = drawType;

    return drawEssentials;
  }

  /**
   * Create symbol geometry from DrawEssentials
   */
  private createSymbol(drawEssentials: DrawEssentials): Polyline | null {
    try {
      // Extract control points
      const pts: Point[] = (drawEssentials as any).CTRL_PTS;
      if (!pts || pts.length < 2) {
        throw new Error("controlPoints not found");
      }

      const spatialReference = this.view.spatialReference;
      const result = new Polyline({ spatialReference });

      // Compute parameters as in 3.x implementation
      const totalLen = GeoTools._2PtLen(pts[0], pts[pts.length - 1]);
      const gapRatio = totalLen / 20; // spacing for dash points

      // Base size for half-circles
      const baseLineLen = totalLen / 6.58;
      let cLenLimit = baseLineLen / 6.58;
      if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;

      // Generate positions along the path and create half-circles at those points
      const resPts: Point[] = GeoTools.getDashPts(pts, [gapRatio, gapRatio]);
      for (let i = 1; i < resPts.length - 1; i++) {
        const center = resPts[i];
        const prev = resPts[i - 1];
        const angle = GeoTools.angleInRadians(center, prev);
        const halfCirclePts: Point[] = Shapes.createFLOTHalfCircle(center, angle, cLenLimit);
        if (halfCirclePts && halfCirclePts.length) {
          result.addPath(halfCirclePts.map(p => [p.x, p.y]));
        }
      }

      return result;
    } catch (e) {
      console.log(this.declaredClass + ' Can not create Symbol due to invalid geometry');
      return null;
    }
  }

  /**
   * Create straight line symbol
   */
  private createSymbolByStraightLine(pts: Point[]): Polyline {
    const result = new Polyline({ spatialReference: this.view.spatialReference });
    const path = pts.map(pt => [pt.x, pt.y]);
    result.addPath(path);
    return result;
  }

  /**
   * Create curved line symbol
   */
  private createSymbolByLine(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials): Polyline {
    const result = new Polyline({ spatialReference: this.view.spatialReference });

    if (pts.length === 2) {
      result.addPath([[lastPoint.x, lastPoint.y], [firstPoint.x, firstPoint.y]]);
    } else if (pts.length > 2) {
      const tempArray: { x: number, y: number }[] = [];
      pts.forEach(pt => {
        tempArray.push({ x: pt.x, y: pt.y });
      });
      return Shapes.createBezierPath(tempArray, 100, this.view.spatialReference);
    }
    return result;    }



  /**
   * Clean up drawing state and finalize
   */
  private cleanUp(): void {
    if (this._points.length === 0) return;

    const drawEssentials = this.createDrawEssentials(this._points.slice(), this._drawType);

    if (this.tempGraphic && this.tempGraphic.geometry) {
      this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEssentials);
    }

    this._clear();
    this._removeEvents();
  }

  /**
   * Handle draw end
   */
  private __drawEnd(drawGeometry: Polyline, drawEssentials: DrawEssentials): void {
    if (drawGeometry) {
      const spatialRef = this.view.spatialReference;
      let geographicGeometry = drawGeometry;

      if (spatialRef && spatialRef.isWebMercator) {
        // Geographic conversion would go here if needed
        // geographicGeometry = webMercatorUtils.webMercatorToGeographic(drawGeometry);
      } else if (spatialRef && spatialRef.wkid === 4326) {
        geographicGeometry = drawGeometry.clone();
      }

      this.__onDrawEnd(drawGeometry, geographicGeometry, drawEssentials);
    }
  }

  /**
   * Final draw end handler
   */
  private __onDrawEnd(geometry: Polyline, geoGeometry: Polyline, drawEssParam: DrawEssentials): void {
    this.events.emit("onDrawEnd", {
      geometry: geometry,
      geographicGeometry: geoGeometry,
      drawEssentials: drawEssParam,
      marker: this._lineSym
    });
  }

  /**
   * Clear graphics and state
   */
  private _clear(): void {
    if (this.tempGraphic && this.symbolLayer) {
      this.symbolLayer.remove(this.tempGraphic);
    }

    this.tempGraphic = null;
    this._points = [];
  }

  /**
   * Remove event handlers
   */
  private _removeEvents(): void {
    //this.view.navigation.enabled = false;

    if (this.clickHandler) {
      this.clickHandler.remove();
      this.clickHandler = null;
    }
    if (this.doubleClickHandler) {
      this.doubleClickHandler.remove();
      this.doubleClickHandler = null;
    }
    if (this.mouseMoveHandler) {
      this.mouseMoveHandler.remove();
      this.mouseMoveHandler = null;
    }
  }

  /**
   * Deactivate the drawing tool
   */
  public deactivate(): void {
    this._clear();
    this._removeEvents();
    this._geometryType = null;
    this.isDrawing = false;
  }

  public on(eventName: string, callback: (data: any) => void): void {
      this.events.on(eventName, callback);
  }

  public off(eventName: string, callback?: (data: any) => void): void {
      this.events.off(eventName, callback);
  }


  /**
   * Get the current symbol layer
   */
  public getSymbolLayer(): GraphicsLayer {
    return this.symbolLayer;
  }

  /**
   * Clear all symbols from the layer
   */
  public clearSymbols(): void {
    this.symbolLayer.removeAll();
  }
}

export default FwdLineOfTps;