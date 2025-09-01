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


export interface TripleStrandConcertinaOptions {
  CTRL_PTS?: Point[];
  GEOM?: Polyline;
  DRAW_TYPE?: number;

  [key: string]: any;
}

/**
 * TripleStrandConcertina class for Triple Concertina symbol
 */
export class TripleStrandConcertina {
  private view: MapView | SceneView;
  private layerManager: GraphicsLayerManager;
  private symbolLayer: GraphicsLayer;
  private isLine: boolean;

  // Symbol metadata
  public declaredClass = "MilitarySymbology.Symbols.TripleStrandConcertina";
  public SID = "290309";
  public symName = "Wire Obs - Triple Strand Concertina";
  public symGeometricType = "Line";
  public isObstacle = "1";

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
   * Initialize the Single Conc drawing
   */
  public init(options: TripleStrandConcertinaOptions, marker: SimpleLineSymbol): void {

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

    this.emit("onDrawClick", {currentPts: this._points});

    // For single line mode, finish after first click
    if (this.isLine === true && this._points.length === 1) {
      this.emit("onDrawClick", {currentPts: this._points});
      this.cleanUp();
    }

    // For rectangle draw type, finish after 2 points
    if (this._drawType === 3 && this._points.length === 2) {
      this.emit("onDrawClick", {currentPts: this._points});
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
        [...this._points, candidatePoint]
    );

    (drawEssentials as any).CTRL_PTS = this._points.concat([candidatePoint]);
    (drawEssentials as any).DRAW_TYPE = this._drawType;

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
   * Create a polyline containing oval paths + a base line path (legacy-like rightArray)
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

      // Sample points along the line to place circles (efficient)
      const totalLen = GeoTools._2PtLen(pts[0], pts[pts.length - 1]);
      const gap = Math.max(totalLen / 40, 0.0001); // aim ~40 circles along full length
      const allSamples = GeoTools.getDashPts(pts, [gap, gap]);

      // Downsample to a bounded count for performance (max ~60)
      const desiredCount = Math.min(60, Math.max(20, allSamples.length));
      const stepIdx = Math.max(1, Math.floor(allSamples.length / Math.max(1, desiredCount)));

      // Circle size proportional to spacing so they don't overlap
      const baseLenDiv = Math.max(totalLen, 1);
      const radius = Math.max(gap * 0.3, 0.0001);
      const circleSteps = 20; // low segment count for performance
      const unitCircle: Array<[number, number]> = [];
      for (let a = 0; a < circleSteps; a++) {
        const theta = (a / circleSteps) * 2 * Math.PI;
        unitCircle.push([Math.cos(theta), Math.sin(theta)]);
      }

      for (let i = 0; i < allSamples.length; i += stepIdx) {
        const c = allSamples[i];
        const path: number[][] = [];
        for (let a = 0; a < circleSteps; a++) {
          const dx = unitCircle[a][0] * radius;
          const dy = unitCircle[a][1] * radius;
          path.push([c.x + dx, c.y + dy]);
        }
        // Close path
        if (path.length) path.push([path[0][0], path[0][1]]);
        result.addPath(path);
      }

      // Base line path similar to legacy rightArray
      const firstPoint = pts[0];
      const lastPoint = pts[pts.length - 1];
      // Offset equals circle radius so the base line is tangent to circles
      let len = radius;
      let k = Math.atan((firstPoint.y - lastPoint.y) / (firstPoint.x - lastPoint.x));
      switch (GeoTools.twoPtsRelationShip(firstPoint, lastPoint)) {
        case "ne": k += Math.PI / 2; break;
        case "nw": k += (Math.PI * 3) / 2; break;
        case "sw": k += (Math.PI * 3) / 2; break;
        case "se": k += Math.PI / 2; break;
      }

      const p2 = { x: -1 * len * Math.cos(k) + firstPoint.x, y: -1 * len * Math.sin(k) + firstPoint.y };
      const rightArray: number[][] = [];
      rightArray.push([p2.x, p2.y]);
      for (let i = 0; i < pts.length; i++) {
        const length = GeoTools._2PtLen(firstPoint, pts[i]);
        const angle = GeoTools.angleInRadians(firstPoint, pts[i]);
        const endPtCandidatePt = new Point({
          x: p2.x + length * Math.cos(angle),
          y: p2.y + length * Math.sin(angle),
          spatialReference: this.view.spatialReference
        });
        rightArray.push([endPtCandidatePt.x, endPtCandidatePt.y]);
      }
      if (rightArray.length > 1) {
        result.addPath(rightArray);
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
    this._geometryType = null;
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

export default TripleStrandConcertina;