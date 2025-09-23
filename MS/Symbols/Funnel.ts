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

export interface FunnelOptions {
  CTRL_PTS?: Point[];
  BASE_LN_PTS?: {startPt: Point, endPt: Point};
  GEOM?: Polyline;
  [key: string]: any;
}

/**
 * Funnel class for drawing Funnel tactical symbols
 * Uses baseline + control points
 * Returns Polyline geometry despite being classified as an Area symbol
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
  private _baseLinePts: any = {};
  private _geometryType: string | null = null;
  private amplifier: Amplifier;

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
   * Initialize the Funnel drawing
   */
  public init(options: FunnelOptions, marker: SimpleLineSymbol): void {
    this._lineSym = marker.clone();

    const drawEssentials = new DrawEssentials();

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
      // Extract control points
      const pts: Point[] = (drawEssentials as any).CTRL_PTS;
      if (!pts || pts.length === 0) {
        throw new Error("controlPoints not found");
      }

      // Extract baseline points
      const stPt: Point = (drawEssentials as any).BASE_LN_PTS?.startPt;
      const endPt: Point = (drawEssentials as any).BASE_LN_PTS?.endPt;
      if (!stPt || !endPt) {
        throw new Error("First Parameter of the Function is an Array with Start and End Point");
      }

      const spatialReference = this.view.spatialReference;
      const result = new Polyline({ spatialReference });

      // Midpoint of baseline
      const midPt = GeoTools.getMidPoint(stPt, endPt);

      // Orientation for corridor sides based on first control point
      const firstPoint = pts[0];
      let k = Math.atan((midPt.y - firstPoint.y) / (midPt.x - firstPoint.x));
      switch (GeoTools.twoPtsRelationShip(midPt, firstPoint)) {
        case "ne":
          k += Math.PI / 2; break;
        case "nw":
          k += Math.PI * 3 / 2; break;
        case "sw":
          k += Math.PI * 3 / 2; break;
        case "se":
          k += Math.PI / 2; break;
      }

      const partialLen = GeoTools._2PtLen(midPt, endPt);
      const p1 = { x: partialLen * Math.cos(k) + midPt.x, y: partialLen * Math.sin(k) + midPt.y };
      const p2 = { x: -1 * partialLen * Math.cos(k) + midPt.x, y: -1 * partialLen * Math.sin(k) + midPt.y };

      // Fracture baseline (gap) and add CC at midpoint of the gap
      const p1Pt = new Point({ x: p1.x, y: p1.y, spatialReference });
      const p2Pt = new Point({ x: p2.x, y: p2.y, spatialReference });
      const values = (GeoTools as any)._fracturePts
        ? (GeoTools as any)._fracturePts(p1Pt, p2Pt, 10, spatialReference)
        : null;
      if (values && values.geometry && (values.geometry as Polyline).paths) {
        (values.geometry as Polyline).paths.forEach((path: number[][]) => result.addPath(path));
        const baseLineLen = GeoTools._2PtLen(p1Pt, p2Pt);
        let cLenLimit = values.len / 2;
        if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
        const ccPts: Point[] = (Shapes as any).createCC
          ? (Shapes as any).createCC(values.midPoint.x, values.midPoint.y, cLenLimit, spatialReference)
          : [];
        if (ccPts && ccPts.length) {
          result.addPath(ccPts.map(p => [p.x, p.y]));
        }
      }

      // Build left/right corridor paths
      const leftArray: number[][] = [];
      const rightArray: number[][] = [];
      if (pts.length >= 1) {
        leftArray.push([p1.x, p1.y]);
        rightArray.push([p2.x, p2.y]);
      }

      for (let i = 0; i < pts.length; i++) {
        const candidate = pts[i];
        const length = GeoTools._2PtLen(midPt, candidate);
        const angle = GeoTools.angleInRadians(midPt, candidate);

        const stPtCandidatePt = new Point({
          x: p1.x + length * Math.cos(angle),
          y: p1.y + length * Math.sin(angle),
          spatialReference
        });
        const endPtCandidatePt = new Point({
          x: p2.x + length * Math.cos(angle),
          y: p2.y + length * Math.sin(angle),
          spatialReference
        });

        leftArray.push([stPtCandidatePt.x, stPtCandidatePt.y]);
        rightArray.push([endPtCandidatePt.x, endPtCandidatePt.y]);
      }

      if (leftArray.length >= 2) result.addPath(leftArray);
      if (rightArray.length >= 2) result.addPath(rightArray);

      // Flaps at the corridor ends
      if (leftArray.length >= 2 && rightArray.length >= 2) {
        const leftLast = new Point({ x: leftArray[leftArray.length - 1][0], y: leftArray[leftArray.length - 1][1], spatialReference });
        const leftPrev = new Point({ x: leftArray[leftArray.length - 2][0], y: leftArray[leftArray.length - 2][1], spatialReference });
        const rightLast = new Point({ x: rightArray[rightArray.length - 1][0], y: rightArray[rightArray.length - 1][1], spatialReference });
        const rightPrev = new Point({ x: rightArray[rightArray.length - 2][0], y: rightArray[rightArray.length - 2][1], spatialReference });

        const lastCandidate = pts[pts.length - 1];
        const mainLen = GeoTools._2PtLen(midPt, lastCandidate);
        const baseLen = GeoTools._2PtLen(leftLast, rightLast);
        const flapLen = (GeoTools as any).ArrowFlanksLen ? (GeoTools as any).ArrowFlanksLen(mainLen, baseLen) : Math.min(mainLen / 10, baseLen / 4);

        const leftAngle = GeoTools.angleInRadians(leftPrev, leftLast);
        const rightAngle = GeoTools.angleInRadians(rightPrev, rightLast);

        const leftFlap = this.flaps(leftLast, flapLen, leftAngle, 1);
        const rightFlap = this.flaps(rightLast, flapLen, rightAngle, 0);

        if (leftFlap.length) result.addPath(leftFlap);
        if (rightFlap.length) result.addPath(rightFlap);
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

  /**
   * Create circle path at point with radius (unused in Funnel; kept if needed)
   */
  private createACP(pt: Point, radius: number): number[][] {
    try {
      const circlePts: Point[] = (Shapes as any).createCircle
        ? (Shapes as any).createCircle(pt, radius, 60)
        : [];
      if (Array.isArray(circlePts) && circlePts.length > 0) {
        return circlePts.map(p => [p.x, p.y]);
      }
      return [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Create circle path at point with radius (used as ACP circle)
   */
  private createACP(pt: Point, radius: number): number[][] {
    try {
      const circlePts: Point[] = (Shapes as any).createCircle
        ? (Shapes as any).createCircle(pt, radius, 60)
        : [];
      if (Array.isArray(circlePts) && circlePts.length > 0) {
        return circlePts.map(p => [p.x, p.y]);
      }
      return [];
    } catch (e) {
      return [];
    }
  }



  /**
   * Calculate distance between two points
   */
  private calculateDistance(pt1: any, pt2: any): number {
    const dx = pt2.x - pt1.x;
    const dy = pt2.y - pt1.y;
    return Math.sqrt(dx * dx + dy * dy);
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

export default Funnel;