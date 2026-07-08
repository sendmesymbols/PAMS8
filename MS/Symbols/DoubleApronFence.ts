import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";

import GraphicsLayerManager, {LAYER_NAMES} from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";
import DrawSeam from "../Support/DrawSeam";


import SymbolEvents from "../Support/SymbolEvents";
export interface DoubleApronFenceOptions {
  CTRL_PTS?: Point[];
  GEOM?: Polyline;
  DRAW_TYPE?: number;

  [key: string]: any;
}

/**
 * DoubleApronFence class for Double Apron Fence symbol
 */
export class DoubleApronFence {
  private view: MapView | SceneView;
  private layerManager: GraphicsLayerManager;
  private symbolLayer: GraphicsLayer;
  private isLine: boolean;

  // Symbol metadata
  public declaredClass: string = "MilitarySymbology.Symbols.DoubleApronFence";
  public SID: string = "290304";
  public symName: string = "Wire Obs - Double Apron Fence";
  public symGeometricType: string = "Line";
  public isObstacle: string = "1";


  private _lineSym: SimpleLineSymbol | null = null;
  private _points: Point[] = [];
  private _geometryType: string | null = null;
  private _drawType: number = 1;
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
    this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.TACT);
    this.amplifier = new Amplifier();
    this.events = new SymbolEvents(view, "DoubleApronFence");

    // Initialize layers if not already done
    this.layerManager.initializeLayers();

    // Initialize temporary graphic
    this.tempGraphic = new Graphic();
  }

  /**
   * Initialize the Single Conc drawing
   */
  public init(options: DoubleApronFenceOptions, marker: SimpleLineSymbol): void {

    this._lineSym = new SimpleLineSymbol({
      color: "green",
      width: marker.width,
    });

    this._drawType = options.DRAW_TYPE || 1;

    // Set up event handlers
    this.setupEventHandlers();

    const drawEssentials = new DrawEssentials();

    if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
      // Immediate placement with both control points and geometry
      if (options.GEOM && this.tempGraphic) {
        try {
          // Assign provided polyline geometry directly
          this.tempGraphic.geometry = options.GEOM;
        } catch (error) {
          console.error(this.symName, "Failed to set Polyline geometry:", error);
        }
      }

      const drawEss = this.createDrawEssentials(options.CTRL_PTS!);
      if (this.tempGraphic && this.tempGraphic.geometry) {
        this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEss);
      }
      this._clear();

    } else if (options.hasOwnProperty("CTRL_PTS")) {
      // Immediate placement with control points only
      const drawEss = this.createDrawEssentials(options.CTRL_PTS!);
      const geometry = this.createSymbol(drawEss);
      if (geometry && this.tempGraphic) {
        this.tempGraphic.geometry = geometry;
        this.__drawEnd(geometry, drawEss);
        this._clear();
      }

    } else {
      // Interactive drawing mode
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
      symbol: this._lineSym,
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
    const mapPoint = DrawSeam.resolvePoint(this.view, clickEvent);
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

    this.events.emit("onDrawClick", {currentPts: this._points});

    // For single line mode, finish after first click
    if (this.isLine === true && this._points.length === 1) {
      this.events.emit("onDrawClick", {currentPts: this._points});
      this.cleanUp();
    }

    // For rectangle draw type, finish after 2 points
    if (this._drawType === 3 && this._points.length === 2) {
      this.events.emit("onDrawClick", {currentPts: this._points});
      this.cleanUp();
    }
  }

  /**
   * Handle double click events
   */
  private _onDoubleClickHandler(clickEvent: any): void {
    const mapPoint = DrawSeam.resolvePoint(this.view, clickEvent);
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

    const mapPoint = DrawSeam.resolvePoint(this.view, inputEvent);
    if (!mapPoint) return;

    const candidatePoint = new Point({
      x: mapPoint.x,
      y: mapPoint.y,
      spatialReference: this.view.spatialReference
    });


    const drawEssentials = this.createDrawEssentials(
      [...this._points, candidatePoint]
    );

    (drawEssentials as any).CTRL_PTS = this._points.concat([candidatePoint]);
    (drawEssentials as any).DRAW_TYPE = this._drawType;

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
   * Create DrawEssentials object with symbol parameters
   */
  private createDrawEssentials(ctrlPts: Point[]): DrawEssentials {
    const drawEssentials = new DrawEssentials();
    drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
    drawEssentials.SID = this.SID;
    drawEssentials.SYM_NAME = this.symName;
    (drawEssentials as any).SCOPE = this;
    (drawEssentials as any).CTRL_PTS = ctrlPts;
    (drawEssentials as any).AMPLIFIER = this.amplifier.toString();
    (drawEssentials as any).IS_OBS = this.isObstacle;

    return drawEssentials;
  }

  /**
   * Create symbol per legacy JS: add the control path and place cross marks (SIDC '18') at intervals
   */
  private createSymbol(drawEssentials: DrawEssentials): Polyline | null {
    try {
      if (!(drawEssentials as any).CTRL_PTS) {
        throw new Error("Control points not found");
      }

      const pts = (drawEssentials as any).CTRL_PTS as Point[];
      if (pts.length < 2) {
        return null;
      }

      const result = new Polyline({ spatialReference: this.view.spatialReference });

      // Add original control path
      const ctrlPath = pts.map(p => [p.x, p.y]);
      result.addPath(ctrlPath);

      // Compute sampling gap
      let gapRatio = GeoTools._2PtLen(pts[0], pts[pts.length - 1]);
      gapRatio = gapRatio / 20;

      // Size control like legacy
      const baseLineLen = GeoTools._2PtLen(pts[0], pts[pts.length - 1]) / 7;
      let cLenLimit = baseLineLen / 7;
      if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;

      // Sample points and place cross marks, each rotated to the fence's local bearing
      // so the cross stays perpendicular to the centerline at every draw angle.
      const resPts = GeoTools.getDashPts(pts, [gapRatio, gapRatio]);
      for (let i = 0; i < resPts.length; i++) {
        const a = resPts[i];
        const b = resPts[i + 1] ?? resPts[i - 1];       // neighbour along the line
        const angle = b
          ? (i + 1 < resPts.length
              ? GeoTools.angleInRadians(a, b)            // forward tangent
              : GeoTools.angleInRadians(b, a))           // last point: backward tangent
          : 0;
        const paths = Shapes.createOrientedCross(a, cLenLimit, angle);
        for (let j = 0; j < paths.length; j++) {
          const pathPairs = paths[j].map(p => [p.x, p.y]);
          result.addPath(pathPairs);
        }
      }

      return result;

    } catch (error) {
      console.error(this.declaredClass + ' Cannot create symbol due to invalid geometry:', error);
      return null;
    }
  }

  /**
   * Complete the drawing process
   */
  private cleanUp(): void {
    if (this._points.length < 2) return;

    const drawEssentials = this.createDrawEssentials(
      [...this._points]
    );

    const geometry = this.createSymbol(drawEssentials);
    if (geometry) {
      this.__drawEnd(geometry, drawEssentials);
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

  /** Premium stylus seam: remove the last placed vertex (undo). Re-render is
   *  driven by the premium layer's next move. */
  public removeLastPoint(): boolean {
    if (!this._points || this._points.length === 0) return false;
    this._points.pop();
    if (this._points.length === 0 && this.tempGraphic) {
      this.tempGraphic.geometry = null;
    }
    return true;
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


  public getSymbolLayer(): GraphicsLayer {
    return this.symbolLayer;
  }

  public clearSymbols(): void {
    this.symbolLayer.removeAll();
  }
}

export default DoubleApronFence;