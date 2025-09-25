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
import BaseLine from "../Support/BaseLine.ts";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";

export interface ContainOptions {
  CTRL_PTS?: Point[];
  BASE_LN_PTS?: {startPt: Point, endPt: Point};
  GEOM?: Polyline;
  [key: string]: any;
}

/**
 * Contain class for drawing Contain tactical symbols
 * Uses baseline + control points
 * Returns Polyline geometry despite being classified as an Area symbol
 */
export class Contain {
  private view: MapView | SceneView;
  private layerManager: GraphicsLayerManager;
  private symbolLayer: GraphicsLayer;
  private isLine: boolean;

  // Symbol properties
  private SID: string = "340400";
  private symName: string = "Contain";
  private symGeometricType: string = "Area";

  private _lineSym: SimpleLineSymbol | null = null;
  private _points: Point[] = [];
  private _baseLinePts: any = {};
  private _geometryType: string | null = null;
  private amplifier: Amplifier;

  private _teethSize:number = 2;
  private _teethGap:number = 5;

  // Drawing state
  private isDrawing: boolean = false;
  private tempGraphic: Graphic | null = null;
  private baseLineComplete: boolean = false;

  // Event handlers
  private clickHandler: any = null;
  private doubleClickHandler: any = null;
  private mouseMoveHandler: any = null;
  private baseLineEndHandler: any = null;
  private baseLineProgressHandler: any = null;
  private baseLineClickHandler: any = null;

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
   * Initialize the Contain drawing
   */
  public init(options: ContainOptions, marker: SimpleLineSymbol): void {
    this._lineSym = marker.clone();

    this._teethSize = 2;
    this._teethGap = 5;


    const drawEssentials = new DrawEssentials();

    this._teethSize = GeoTools.setDefault(options, "TEETH_SIZE", this._teethSize);
    this._teethGap = GeoTools.setDefault(options, "TEETH_GAP", this._teethGap);
    if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("BASE_LN_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
      // Immediate placement with both control points and geometry
      if (options.GEOM && this.tempGraphic) {
        try {
          // If GEOM is already a Polyline, use it directly; otherwise, build from paths
          this.tempGraphic.geometry = (options.GEOM instanceof Polyline)
              ? options.GEOM
              : new Polyline({ paths: (options.GEOM as any), spatialReference: this.view.spatialReference });
        } catch (error) {
          console.error(this.symName, "Failed to create Polyline geometry:", error);
        }
      }

      const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.BASE_LN_PTS!);
      if (this.tempGraphic && this.tempGraphic.geometry) {
        this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEss);
      }
      this._clear();

    } else if (options.hasOwnProperty("CTRL_PTS")) {
      if (options.hasOwnProperty("BASE_LN_PTS")) {
        // Immediate placement with control points and baseline
        const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.BASE_LN_PTS!);
        const geometry = this.createSymbol(drawEss);
        if (geometry && this.tempGraphic) {
          this.tempGraphic.geometry = geometry;
          this.__drawEnd(geometry, drawEss);
          this._clear();
        }
      } else {
        throw new Error("Control Points and Baseline or Distance is required to create symbol non-interactively");
      }

    } else {
      // Interactive drawing mode - start with baseline
      this.startBaseLineDrawing();
    }
  }

  /**
   * Start baseline drawing
   */
  private startBaseLineDrawing(): void {
    const baseLine = new BaseLine(this.view, this._lineSym!);

    this.baseLineClickHandler = baseLine.on("onBaseLineClick", (evt: any) => {
      this.baseLineClick(evt);
    });

    this.baseLineProgressHandler = baseLine.on("onBaseLineProgress", (evt: any) => {
      this.baseLineDrawProgress(evt);
    });

    this.baseLineEndHandler = baseLine.on("drawEnd", (evt: any) => {
      this.baseLineDrawEnd(evt);
    });

    baseLine.init();
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
   * Handle baseline draw progress
   */
  private baseLineDrawProgress(evt: any): void {
    const localDrawEssentials: any = {};
    localDrawEssentials.CTRL_PTS = evt.currentGeometry;

    const pl = new Polyline({ spatialReference: this.view.spatialReference });
    pl.addPath(evt.currentGeometry);

    this.emit("onDrawProgress", {
      currentGeometry: pl,
      currentDrawEssentials: localDrawEssentials,
      currentMarker: evt.currentMarker,
      isBaseLine: true
    });
  }

  /**
   * Handle baseline draw end
   */
  private baseLineDrawEnd(evt: any): void {
    if (this.baseLineEndHandler) {
      this.baseLineEndHandler.remove();
      this.baseLineEndHandler = null;
    }

    this.tempGraphic = new Graphic({
      geometry: evt.geometry,
      symbol: this._lineSym
    });
    this.symbolLayer.add(this.tempGraphic);

    this._baseLinePts = (evt.geometry as any)._baseLine;
    this.baseLineComplete = true;

    // Start control point drawing
    this.setupControlPointHandlers();

    this.emit("onBaseLineDrawEnd", {
      currentPts: (evt.geometry as any).controlPoints
    });
  }

  /**
   * Set up control point drawing handlers
   */
  private setupControlPointHandlers(): void {
    // Mouse move handler
    this.mouseMoveHandler = this.view.on("pointer-move", (event) => {
      this._onMouseMoveHandler(event);
    });

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
   * Handle click events for control points
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

    this.emit("onDrawClick", { currentPts: this._points });

    // For single line mode, finish after first click
    if (this.isLine === true && this._points.length === 1) {
      this.emit("onDrawClick", { currentPts: this._points });
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
    if (!this.baseLineComplete || !this.tempGraphic) return;

    const mapPoint = this.view.toMap(inputEvent);
    if (!mapPoint) return;

    const candidatePoint = new Point({
      x: mapPoint.x,
      y: mapPoint.y,
      spatialReference: this.view.spatialReference
    });

    const drawEssentials = new DrawEssentials();
    (drawEssentials as any).CTRL_PTS = this._points.concat([candidatePoint]);
    (drawEssentials as any).BASE_LN_PTS = this._baseLinePts;

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
  private createDrawEssentials(ctrlPts: Point[], baseLinePts: any): DrawEssentials {
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

    return drawEssentials;
  }

  /**
   * Create symbol geometry from DrawEssentials
   */
  private createSymbol(drawEssentials: DrawEssentials): Polyline | null {
    try {
      const spatialReference = this.view.spatialReference;
      const pts: Point[] = (drawEssentials as any).CTRL_PTS;
      if (!pts || pts.length === 0) throw new Error("controlPoints not found");

      // Baseline start/end are the first two inputs in legacy; in 4.x they come from BASE_LN_PTS
      const stPt: Point = (drawEssentials as any).BASE_LN_PTS?.startPt;
      const endPt: Point = (drawEssentials as any).BASE_LN_PTS?.endPt;
      if (!stPt || !endPt) throw new Error("First Parameter of the Function is an Array with Start and End Point");

      // Candidate point defines arc side (legacy used pts[2]); here we use the first control point
      const candidate: Point = pts[0];

      const result = new Polyline({ spatialReference });

      // Build circle from three points in screen space and sample arc back to map
      const stScr = (this.view as any).toScreen(stPt);
      const endScr = (this.view as any).toScreen(endPt);
      const candScr = (this.view as any).toScreen(candidate);
      if (!stScr || !endScr || !candScr) return null;

      const circle = GeoTools.circleFromThreeScreenPoints(stScr, endScr, candScr);
      if (!circle || circle.radius <= 0) {
        // Fallback to simple baseline
        result.addPath([[stPt.x, stPt.y], [endPt.x, endPt.y]]);
        return result;
      }

      const circleSeg = Shapes.createCircleSegmentFromThreePoints(this.view as any, circle, stScr, endScr, candScr, 60);
      const ring = (circleSeg.geometry as any).rings?.[0] as number[][];
      if (!ring || ring.length === 0) return null;

      // Split the arc into two paths leaving a gap
      const firstArc = ring.slice(0, 28);
      const secondArc = ring.slice(32, 60);
      if (firstArc.length >= 2) result.addPath(firstArc);
      if (secondArc.length >= 2) result.addPath(secondArc);

      // Add C at middle of the gap
      if (ring[30]) {
        const cPoint = new Point({ x: ring[30][0], y: ring[30][1], spatialReference });
        const firstPoint = new Point({ x: ring[28][0], y: ring[28][1], spatialReference });
        const secondPoint = new Point({ x: ring[32][0], y: ring[32][1], spatialReference });
        const baseLineLen = GeoTools._2PtLen(firstPoint, secondPoint);
        let cLenLimit = baseLineLen / 5;
        if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
        const cPts: Point[] = (Shapes as any).createCC(cPoint.x, cPoint.y, cLenLimit, spatialReference) || [];
        if (cPts.length) result.addPath(cPts.map(p => [p.x, p.y]));
      }

      // Teeth along both arcs toward center
      const ext = result.extent;
      const centerPt = ext?.center;
      if (centerPt) {
        const center = new Point({ x: centerPt.x, y: centerPt.y, spatialReference });
        const length = GeoTools._2PtLen(endPt, center) / 10;
        const teethSize = length * GeoTools.setDefault(drawEssentials as any, "TEETH_SIZE", this._teethSize);
        const teethGap = GeoTools.setDefault(drawEssentials as any, "TEETH_GAP", this._teethGap);

        for (let i = teethGap; i < 28 && i < firstArc.length; i += teethGap) {
          const p = new Point({ x: firstArc[i][0], y: firstArc[i][1], spatialReference });
          const ang = GeoTools.angleInRadians(center, p);
          result.addPath(this.createTeeth(p, ang, teethSize));
        }
        for (let i = teethGap; i < 28 && i < secondArc.length; i += teethGap) {
          const p = new Point({ x: secondArc[i][0], y: secondArc[i][1], spatialReference });
          const ang = GeoTools.angleInRadians(center, p);
          result.addPath(this.createTeeth(p, ang, teethSize));
        }
      }

      // Handle additional control points (fracture lines and ENY + arrow head)
      if (pts.length > 1) {
        const lastPt = pts[pts.length - 1];
        const secLastPt = pts[pts.length - 2];

        if (ext?.center) {
          const center = new Point({ x: ext.center.x, y: ext.center.y, spatialReference });
          // Build path: center -> pts[1..n-1] -> lastPt
          const fracturePoints: Point[] = [center];
          for (let i = 1; i < pts.length - 1; i++) fracturePoints.push(pts[i]);
          fracturePoints.push(lastPt);

          const values = (GeoTools as any)._fracture(fracturePoints, 10, spatialReference);
          if (values && values.geometry) {
            const gPaths = (values.geometry as Polyline).paths as number[][][];
            gPaths.forEach(p => result.addPath(p));

            const baseLineLen = GeoTools._2PtLen(stPt, lastPt);
            for (let i = 0; i < values.midPoints.length; i++) {
              let cLenLimit = values.midPoints[i].len / 2;
              if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
              const enyPaths = (Shapes as any).createENY(values.midPoints[i].midPt.x, values.midPoints[i].midPt.y, cLenLimit, spatialReference) || [];
              for (let j = 0; j < enyPaths.length; j++) {
                result.addPath(enyPaths[j].map((p: Point) => [p.x, p.y]));
              }
            }
          }

          // Backward arrow head from center towards next control (pts[1])
          const toward = pts[1] || lastPt;
          const mainLen = GeoTools._2PtLen(center, toward);
          const baseLen = GeoTools._2PtLen(lastPt, secLastPt);
          const arrowLen = (GeoTools as any).ArrowFlanksLen(mainLen, baseLen);
          const angle = GeoTools.angleInRadians(center, toward);
          const arrow = (Shapes as any).arrowHeadBackward(center, arrowLen, angle) as Point[];
          if (arrow && arrow.length) {
            result.addPath(arrow.map(p => [p.x, p.y]));
          }
        }
      }

      return result;
    } catch (e) {
      console.log(this.constructor.name + " Cannot create Symbol due to invalid geometry");
      return null;
    }
  }

  /**
   * Create flap (arrow wings) path at the end point
   */
  private flaps(candidatePoint: Point, length: number, angleRad: number, side: number): number[][] {
    try {
      const delta = (15 * Math.PI) / 180; // 15 degrees in radians
      // Adjust to angle wings inward toward the corridor center
      const adj = side === 1 ? (angleRad + delta) : (angleRad - delta);
      const dx = Math.cos(adj);
      const dy = Math.sin(adj);

      const wing1 = [candidatePoint.x + length * dx, candidatePoint.y + length * dy];
      const wing2 = [candidatePoint.x - length * dx, candidatePoint.y - length * dy];
      return [wing1, [candidatePoint.x, candidatePoint.y], wing2];
    } catch (e) {
      return [];
    }
  }

  private createTeeth(startPt: Point, angle: number, teethSize: number): number[][] {
    const midPtTwrdsCntr = [
      startPt.x - teethSize * Math.cos(angle),
      startPt.y - teethSize * Math.sin(angle)
    ];
    return [[startPt.x, startPt.y], midPtTwrdsCntr];
  }


  /**
   * Get baseline points
   */
  public getBaseLinePts(): any {
    return this._baseLinePts;
  }

  /**
   * Clean up drawing state and finalize
   */
  private cleanUp(): void {
    if (this._points.length === 0) return;

    const drawEssentials = this.createDrawEssentials(this._points.slice(), this._baseLinePts);

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
    this._baseLinePts = {};
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
    if (this.baseLineEndHandler) {
      this.baseLineEndHandler.remove();
      this.baseLineEndHandler = null;
    }
    if (this.baseLineProgressHandler) {
      this.baseLineProgressHandler.remove();
      this.baseLineProgressHandler = null;
    }
    if (this.baseLineClickHandler) {
      this.baseLineClickHandler.remove();
      this.baseLineClickHandler = null;
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
    this.baseLineComplete = false;
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

export default Contain;