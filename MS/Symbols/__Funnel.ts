import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";
// import Shapes from "../Support/Shapes.ts"; // Not used in translated createSymbol
import GeoTools from "../Support/GeoTools.ts";
import BaseLine from "../Support/BaseLine.ts";
// Removed unused imports from translation

export interface FunnelOptions {
  CTRL_PTS?: Point[];
  GEOM?: Polygon;
  BASE_LN_PTS?: { startPt: Point, endPt: Point };
  HEAD_RATIO?: number;
  TAIL_FACTOR?: number;
  FRNT_LN_ANGL_RATIO?: number;
  FRNT_LN_DIST_RATIO?: number;
  FLAP_DIST_RATIO?: number;
  [key: string]: any;
}

/**
 * Funnel class for drawing Avenue of Approaches arrows
 * Creates complex arrow shapes with configurable head and tail parameters
 * Supports both simple (<=2 points) and complex (>2 points) arrow creation
 */
export class Funnel {
  private view: MapView | SceneView;
  private layerManager: GraphicsLayerManager;
  private symbolLayer: GraphicsLayer;
  private isLine: boolean;

  // Symbol properties
  public declaredClass: string = "MilitarySymbology.Symbols.Funnel";
  public SID: string = "151407";
  public symName: string = "Funnel";
  public symGeometricType: string = "Area";

  private _lineSym: SimpleLineSymbol | null = null;
  private _points: Point[] = [];
  // private _geometryType: string | null = null;
  private amplifier: Amplifier;

  // Funnel specific parameters
  private frontLineAngle: number = 0.8;
  private frontLineDist: number = 1.5;
  private flapDist: number = 3;

  // Drawing state
  private isDrawing: boolean = false;
  private tempGraphic: Graphic | null = null;
  private _baseLinePts: { startPt: Point, endPt: Point } | null = null;

  // Event handlers
  private clickHandler: any = null;
  private doubleClickHandler: any = null;
  private mouseMoveHandler: any = null;

  // Event emitter
  private eventListeners: Map<string, Function[]> = new Map();

  constructor(view: MapView | SceneView, isLine: boolean = false) {
    this.view = view;
    this.isLine = isLine;
    this.layerManager = GraphicsLayerManager.getInstance(view);
    this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.FORCE);
    this.amplifier = new Amplifier();

    // Initialize layers if not already done
    this.layerManager.initializeLayers();

    // Initialize temporary graphic
    this.tempGraphic = new Graphic();
  }

  /**
   * Initialize the avenue of approaches drawing
   */
  public init(options: FunnelOptions, marker: SimpleLineSymbol): void {
    // Create SimpleFillSymbol with 50% transparency

    this._lineSym = marker;

    // Set arrow parameters with defaults
    this.frontLineAngle = GeoTools.setDefault(options, "FRNT_LN_ANGL_RATIO", 0.8);
    this.frontLineDist = GeoTools.setDefault(options, "FRNT_LN_DIST_RATIO", 1.5);
    this.flapDist = GeoTools.setDefault(options, "FLAP_DIST_RATIO", 3);

    // Set up event handlers
    this.setupEventHandlers();

    // removed unused variable from translation

    if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
      // Immediate placement with both control points and geometry
      if (options.GEOM && this.tempGraphic) {
        try {
          this.tempGraphic.geometry = options.GEOM;
        } catch (error) {
          console.error(this.symName, "Failed to set Polygon geometry:", error);
        }
      }

      const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.BASE_LN_PTS, this.frontLineAngle, this.frontLineDist, this.flapDist);
      if (this.tempGraphic && this.tempGraphic.geometry) {
        this.__drawEnd(this.tempGraphic.geometry as Polyline | Polygon, drawEss);
      }
      this._clear();

    } else if (options.hasOwnProperty("CTRL_PTS")) {
      // Immediate placement with control points only
      if (!options.hasOwnProperty("BASE_LN_PTS")) {
        throw new Error("Control Points and Baseline or Distance is required to create symbol non-interactively");
      }
      const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.BASE_LN_PTS, this.frontLineAngle, this.frontLineDist, this.flapDist);
      const geometry = this.createSymbol(drawEss);
      if (geometry && this.tempGraphic) {
        this.tempGraphic.geometry = geometry;
        this.__drawEnd(geometry, drawEss);
        this._clear();
      }

    } else {
      // Interactive drawing mode - start with baseline drawing
      this.startBaselineDrawing();
    }
  }

  /**
   * Start baseline drawing phase
   */
  private startBaselineDrawing(): void {
    if (!this._lineSym) return;
    
    const baseLine = new BaseLine(this.view, this._lineSym);
    
    // Set up baseline event handlers
    baseLine.on("drawEnd", this.baseLineDrawEnd.bind(this));
    baseLine.on("onDrawClick", this.baseLineClick.bind(this));
    baseLine.on("onDrawProgress", this.baseLineDrawProgress.bind(this));
    
    baseLine.init();
  }

  /**
   * Handle baseline drawing completion
   */
  private baseLineDrawEnd(evt: any): void {
    // Extract baseline points from the polyline geometry
    const geometry = evt.geometry as Polyline;
    if (geometry && geometry.paths.length > 0) {
      const path = geometry.paths[0];
      const startPt = new Point({
        x: path[0][0],
        y: path[0][1],
        spatialReference: this.view.spatialReference
      });
      const endPt = new Point({
        x: path[path.length - 1][0],
        y: path[path.length - 1][1],
        spatialReference: this.view.spatialReference
      });
      
      this._baseLinePts = { startPt, endPt };
    }
    
    // Create temp graphic for baseline
    this.tempGraphic = new Graphic({
      geometry: evt.geometry,
      symbol: this._lineSym
    });
    this.symbolLayer.add(this.tempGraphic);
    
    // Start interactive drawing for funnel points
    this.startInteractiveDrawing();
    
    this.emit("onBaseLineDrawEnd", { currentPts: geometry.paths[0] });
  }

  /**
   * Handle baseline drawing progress
   */
  private baseLineDrawProgress(evt: any): void {
    const localDrawEssentials: any = {};
    localDrawEssentials.CTRL_PTS = evt.currentGeometry;
    
    const pl = new Polyline({ spatialReference: this.view.spatialReference });
    pl.addPath(evt.currentGeometry.map((pt: Point) => [pt.x, pt.y]));
    
    this.emit("onDrawProgress", { 
      currentGeometry: pl, 
      currentDrawEssentials: localDrawEssentials, 
      currentMarker: evt.currentMarker, 
      isBaseLine: true 
    });
  }

  /**
   * Handle baseline click events
   */
  private baseLineClick(evt: any): void {
    this.emit("onDrawClick", { 
      currentPts: evt.currentGeometry, 
      isBaseLine: true 
    });
  }

  /**
   * Start interactive drawing mode for funnel points
   */
  private startInteractiveDrawing(): void {
    if (!this._lineSym) return;
    this.isDrawing = true;
    
    // Set up event handlers for funnel point drawing
    this.setupEventHandlers();
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

    // For single line mode, finish after first click
    if (this.isLine === true && this._points.length === 1) {
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

    const drawEssentials = this.createDrawEssentials(
      this._points.concat([candidatePoint]),
      this._baseLinePts,
      this.frontLineAngle,
      this.frontLineDist,
      this.flapDist
    );

    const geometry = this.createSymbol(drawEssentials);
    if (geometry) {
      this.tempGraphic.geometry = geometry;
      this.emit("onDrawProgress", {
        currentGeometry: geometry,
        currentDrawEssentials: drawEssentials,
        currentMarker: this._lineSym
      });
    }
  }

  /**
   * Create DrawEssentials object
   */
  private createDrawEssentials(ctrlPts: Point[], baseLinePts: any, frontLineAngleRatio: number, frontLineDistRatio: number, flapDistRatio: number): DrawEssentials {
    const drawEssentials = new DrawEssentials();
    drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
    drawEssentials.SID = this.SID;
    drawEssentials.SYM_NAME = this.symName;
    drawEssentials.GEOM = null;
    drawEssentials.AMPLIFIER = this.amplifier.toString();

    // Store additional properties
    (drawEssentials as any).SCOPE = this;
    (drawEssentials as any).CTRL_PTS = ctrlPts;
    (drawEssentials as any).BASE_LN_PTS = baseLinePts;
    (drawEssentials as any).FRNT_LN_ANGL_RATIO = frontLineAngleRatio;
    (drawEssentials as any).FRNT_LN_DIST_RATIO = frontLineDistRatio;
    (drawEssentials as any).FLAP_DIST_RATIO = flapDistRatio;

    return drawEssentials;
  }

  /**
   * Create symbol geometry from DrawEssentials
   */
  private createSymbol(drawEssentials: DrawEssentials): Polyline | null {
    var frontLineAgle;
    var frontLineDist;
    var flapDistRatio;

    var length;
    var angle;
    try {


      var pts;

      if (drawEssentials.hasOwnProperty("CTRL_PTS")) {
        pts = drawEssentials.CTRL_PTS;

      } else {

        throw "controlPoints not found"

      }

      frontLineAgle = GeoTools.setDefault(drawEssentials, "FRNT_LN_ANGL_RATIO", 0.8);
      frontLineDist = GeoTools.setDefault(drawEssentials, "FRNT_LN_DIST_RATIO", 1.5);
      flapDistRatio = GeoTools.setDefault(drawEssentials, "FLAP_DIST_RATIO", 3);

      var stPt = drawEssentials.BASE_LN_PTS.startPt;
      var endPt = drawEssentials.BASE_LN_PTS.endPt;

      var firstPoint = pts[0];
      var lastPoint = pts[pts.length - 1];
      var leftArray = [], rightArray = [];




      if (stPt === undefined || endPt === undefined) {
        throw "First Parameter of the Function is an Array with Start and End Point"

      }
      var midPt = GeoTools.getMidPoint(stPt, endPt);


      var result = new _Polyline(this.map.spatialReference);

      //Base Line

      if (pts.length >= 1) {
        lastPoint = firstPoint;
      }

      var len = GeoTools._2PtLen(midPt, endPt);
      var k = Math.atan((midPt.y - lastPoint.y) / (midPt.x - lastPoint.x));

      switch (GeoTools.twoPtsRelationShip(midPt, lastPoint)) {
        case "ne":
          k += Math.PI / 2;
          break;
        case "nw":
          k += Math.PI * 3 / 2;
          break;
        case "sw":
          k += Math.PI * 3 / 2;
          break;
        case "se":
          k += Math.PI / 2;
          break;
      }


      var partialLen = len;

      var p1 = { x: partialLen * Math.cos(k) + midPt.x, y: partialLen * Math.sin(k) + midPt.y };
      var p2 = { x: -1 * partialLen * Math.cos(k) + midPt.x, y: -1 * partialLen * Math.sin(k) + midPt.y };

      paths = [];
      paths = paths.concat(p1, p2);

      result.addPath(paths);


      //End of Base Line



      //Front


      if (pts.length >= 1) {
        leftArray.push(p1);
        rightArray.push(p2);


        if (pts[0] === undefined) {
          throw "Insufficient Pts";
        } else {
          var length = GeoTools._2PtLen(midPt, pts[0]) / frontLineDist;
          var angle = GeoTools.angleInRadians(midPt, pts[0]);


          var stPtCandidatePt = new Point(p1.x + length * Math.cos(angle), p1.y + length * Math.sin(angle), this.map.spatialReference);
          var endPtCandidatePt = new Point(p2.x + length * Math.cos(angle), p2.y + length * Math.sin(angle), this.map.spatialReference);

          leftArray.push(stPtCandidatePt);
          rightArray.push(endPtCandidatePt);


        }


      }


      //Flaps
      len = length / flapDistRatio + GeoTools._2PtLen(pts[0], pts[pts.length - 1]);  //Convert it into Flap Distance Variable
      angle = GeoTools.angleInRadians(stPtCandidatePt, endPtCandidatePt) - frontLineAgle;

      var pt1 = new Point(-1 * len * Math.cos(angle) + stPtCandidatePt.x, -1 * len * Math.sin(angle) + stPtCandidatePt.y, this.map.spatialReference);
      angle = GeoTools.angleInRadians(stPtCandidatePt, endPtCandidatePt) + frontLineAgle;
      var pt2 = new Point(len * Math.cos(angle) + endPtCandidatePt.x, len * Math.sin(angle) + endPtCandidatePt.y, this.map.spatialReference);

      leftArray.push(pt1);
      rightArray.push(pt2);
      //End of Flaps

      //Funnel Head

      var candidatePoint = pts[pts.length - 1];
      var values;
      var paths = [];
      var circle = GeoTools._circleDrawEx(this.map.toScreen(pt1), this.map.toScreen(pt2), this.map.toScreen(candidatePoint));
      if (circle.radius > 0) {
        values = GeoTools.CreateCircleSegmentFromThreePoints(circle, this.map.toScreen(pt1), this.map.toScreen(pt2), this.map.toScreen(candidatePoint), 60, this.map);
        paths = values.geometry.paths[0];
        result.addPath(paths.slice(0, 61));
      }

      //End of Funnel Head

      result.addPath(leftArray);
      result.addPath(rightArray);


      return result;
    } catch (e) {
      console.log(this.declaredClass + ' Can not create Symbol due to invalid geometry');

    }
  }



  /**
   * Clean up drawing state and finalize
   */
  private cleanUp(): void {
    if (this._points.length === 0) return;

    const drawEssentials = this.createDrawEssentials(this._points.slice(), this._baseLinePts, this.frontLineAngle, this.frontLineDist, this.flapDist);

    if (this.tempGraphic && this.tempGraphic.geometry) {
      this.__drawEnd(this.tempGraphic.geometry as Polyline | Polygon, drawEssentials);
    }

    this._clear();
    this._removeEvents();
  }

  /**
   * Handle draw end
   */
  private __drawEnd(drawGeometry: Polyline | Polygon, drawEssentials: DrawEssentials): void {
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
  private __onDrawEnd(geometry: Polyline | Polygon, geoGeometry: Polyline | Polygon, drawEssParam: DrawEssentials): void {
    this.emit("onDrawEnd", {
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
    this._baseLinePts = null;
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

  /**
   * Deactivate the drawing tool
   */
  public deactivate(): void {
    this._clear();
    this._removeEvents();
    // this._geometryType = null;
    this.isDrawing = false;
  }

  /**
   * Event emitter functionality
   */
  private emit(eventName: string, data: any): void {
    const listeners = this.eventListeners.get(eventName);
    if (listeners) {
      listeners.forEach(listener => listener(data));
    }

    this.emitGlobalEvent(eventName, data);
  }

  private emitGlobalEvent(eventName: string, data: any): void {
    const customEvent = new CustomEvent(eventName, {
      detail: {
        symbolType: this.constructor.name,
        eventName: eventName,
        ...data
      },
      bubbles: true,
      cancelable: true
    });

    if (this.view && this.view.container) {
      this.view.container.dispatchEvent(customEvent);
    } else {
      document.dispatchEvent(customEvent);
    }
  }

  public on(eventName: string, callback: Function): void {
    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, []);
    }
    this.eventListeners.get(eventName)!.push(callback);
  }

  public off(eventName: string, callback?: Function): void {
    if (!callback) {
      this.eventListeners.delete(eventName);
    } else {
      const listeners = this.eventListeners.get(eventName);
      if (listeners) {
        const index = listeners.indexOf(callback);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      }
    }
  }

  public getSymbolLayer(): GraphicsLayer {
    return this.symbolLayer;
  }

  public clearSymbols(): void {
    this.symbolLayer.removeAll();
  }
}

export default Funnel;