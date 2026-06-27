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

import SymbolEvents from "../Support/SymbolEvents";
export interface DisruptOptions {
  CTRL_PTS?: Point[];
  BASE_LN_PTS?: {startPt: Point, endPt: Point};
  GEOM?: Polyline;
  [key: string]: any;
}

/**
 * Disrupt class for drawing Disrupt tactical symbols
 * Uses baseline + control points
 * Returns Polyline geometry despite being classified as an Area symbol
 */
export class Disrupt {
  private view: MapView | SceneView;
  private layerManager: GraphicsLayerManager;
  private symbolLayer: GraphicsLayer;
  private isLine: boolean;

  // Symbol properties
  public declaredClass: string = "MilitarySymbology.Symbols.Disrupt";
  public SID: string = "341000";
  public symName: string = "Disrupt";
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
  private events: SymbolEvents;

  constructor(view: MapView | SceneView, isLine: boolean = false) {
    this.view = view;
    this.isLine = isLine;
    this.layerManager = GraphicsLayerManager.getInstance(view);
    this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.TACT);
    this.amplifier = new Amplifier();
    this.events = new SymbolEvents(view, "Disrupt");

    // Initialize layers if not already done
    this.layerManager.initializeLayers();

    // Initialize temporary graphic
    this.tempGraphic = new Graphic();
  }

  /**
   * Initialize the Disrupt drawing
   */
  public init(options: DisruptOptions, marker: SimpleLineSymbol): void {
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
    this.events.emit("onDrawClick", {
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

    this.events.emit("onDrawProgress", {
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

    this.events.emit("onBaseLineDrawEnd", {
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

      // Determine orientation k using the first control point
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

      // Base line as a single path
      result.addPath([[p1.x, p1.y], [p2.x, p2.y]]);

      // Front arrays
      const leftArray: Array<{ x: number; y: number }> = [];
      const rightArray: Array<{ x: number; y: number }> = [];
      const middleArray: Array<{ x: number; y: number }> = [];

      if (pts.length >= 1) {
        leftArray.push(p1);
        rightArray.push(p2);
        middleArray.push({ x: midPt.x, y: midPt.y });
      }

      // Variables to capture the last candidate's endpoints for arrow size computation
      let lastStPtCandidatePt: Point | null = null;
      let lastEndPtCandidatePt: Point | null = null;

      for (let i = 0; i < pts.length; i++) {
        // Distance and angle from mid to candidate
        const length = GeoTools._2PtLen(midPt, pts[i]);
        const angleToCandidate = GeoTools.angleInRadians(midPt, pts[i]);

        const stPtCandidatePt = new Point({
          x: p1.x + length * Math.cos(angleToCandidate),
          y: p1.y + length * Math.sin(angleToCandidate),
          spatialReference
        });
        const endPtCandidatePt = new Point({
          x: p2.x + length * Math.cos(angleToCandidate),
          y: p2.y + length * Math.sin(angleToCandidate),
          spatialReference
        });

        // Compute limited cross length along the local baseline between st and end candidates
        let len2 = length / 5;
        const baseLineLenLocal = GeoTools._2PtLen(stPtCandidatePt, endPtCandidatePt);
        const baseLineLenLimit = baseLineLenLocal / 4;
        if (len2 > baseLineLenLimit) len2 = baseLineLenLimit;

        // Angle between the endpoints for local baseline
        const angleBetweenCandidates = GeoTools.angleInRadians(stPtCandidatePt, endPtCandidatePt);

        // Shorten left and middle points towards the mid point as per legacy
        const kLocal = GeoTools.angleInRadians(midPt, pts[i]);
        const shortenLeftPt = {
          x: -1 * (length / 5) * Math.cos(kLocal) + stPtCandidatePt.x,
          y: -1 * (length / 5) * Math.sin(kLocal) + stPtCandidatePt.y
        };
        leftArray.push(shortenLeftPt);

        const shortenMiddlePt = {
          x: -1 * (length / 10) * Math.cos(kLocal) + pts[i].x,
          y: -1 * (length / 10) * Math.sin(kLocal) + pts[i].y
        };
        middleArray.push(shortenMiddlePt);

        rightArray.push({ x: endPtCandidatePt.x, y: endPtCandidatePt.y });

        lastStPtCandidatePt = stPtCandidatePt;
        lastEndPtCandidatePt = endPtCandidatePt;
      }

      // Add left and right arrays as paths
      if (leftArray.length >= 2) result.addPath(leftArray.map(p => [p.x, p.y]));
      if (rightArray.length >= 2) result.addPath(rightArray.map(p => [p.x, p.y]));

      // Fracture the middle array and add D letters at the fractured midpoints
      const fractureValues = (GeoTools as any)._fracture
        ? (GeoTools as any)._fracture(
            middleArray.map(p => new Point({ x: p.x, y: p.y, spatialReference })),
            10,
            spatialReference
          )
        : null;
      if (fractureValues && fractureValues.geometry && (fractureValues.geometry as Polyline).paths) {
        // Add fractured paths
        (fractureValues.geometry as Polyline).paths.forEach((path: number[][]) => result.addPath(path));

        // For each midPoint, add a D shape with capped size
        const baseLineLenForCap = (lastStPtCandidatePt && lastEndPtCandidatePt)
          ? GeoTools._2PtLen(lastStPtCandidatePt, lastEndPtCandidatePt)
          : GeoTools._2PtLen(new Point({ x: p1.x, y: p1.y, spatialReference }), new Point({ x: p2.x, y: p2.y, spatialReference }));

        for (let i = 0; i < fractureValues.midPoints.length; i++) {
          let cLenLimit = fractureValues.midPoints[i].len / 2;
          if (cLenLimit > baseLineLenForCap / 3.6) cLenLimit = baseLineLenForCap / 3.6;
          const dPts: Point[] = (Shapes as any).createD
            ? (Shapes as any).createD(fractureValues.midPoints[i].midPt, cLenLimit, 40)
            : [];
          if (dPts && dPts.length) {
            result.addPath(dPts.map(p => [p.x, p.y]));
          }
        }
      }

      // Arrows on the tips of left, right and middle arrays
      if (leftArray.length >= 2 && rightArray.length >= 2 && middleArray.length >= 2 && lastStPtCandidatePt && lastEndPtCandidatePt) {
        const mainLen = GeoTools._2PtLen(midPt, pts[pts.length - 1]);
        const baseLen = GeoTools._2PtLen(lastStPtCandidatePt, lastEndPtCandidatePt);
        const arrowLen = (GeoTools as any).ArrowFlanksLen ? (GeoTools as any).ArrowFlanksLen(mainLen, baseLen) : Math.min(mainLen / 10, baseLen / 4);

        const leftLastPt = new Point({ x: leftArray[leftArray.length - 1].x, y: leftArray[leftArray.length - 1].y, spatialReference });
        const leftPrevPt = new Point({ x: leftArray[leftArray.length - 2].x, y: leftArray[leftArray.length - 2].y, spatialReference });
        const rightLastPt = new Point({ x: rightArray[rightArray.length - 1].x, y: rightArray[rightArray.length - 1].y, spatialReference });
        const rightPrevPt = new Point({ x: rightArray[rightArray.length - 2].x, y: rightArray[rightArray.length - 2].y, spatialReference });
        const middleLastPt = new Point({ x: middleArray[middleArray.length - 1].x, y: middleArray[middleArray.length - 1].y, spatialReference });
        const middlePrevPt = new Point({ x: middleArray[middleArray.length - 2].x, y: middleArray[middleArray.length - 2].y, spatialReference });

        const leftArrow = (Shapes as any).arrowHead
          ? (Shapes as any).arrowHead(leftLastPt, arrowLen, GeoTools.angleInRadians(leftPrevPt, leftLastPt))
          : [];
        const rightArrow = (Shapes as any).arrowHead
          ? (Shapes as any).arrowHead(rightLastPt, arrowLen, GeoTools.angleInRadians(rightPrevPt, rightLastPt))
          : [];
        const middleArrow = (Shapes as any).arrowHead
          ? (Shapes as any).arrowHead(middleLastPt, arrowLen, GeoTools.angleInRadians(middlePrevPt, middleLastPt))
          : [];

        if (leftArrow && leftArrow.length) result.addPath(leftArrow.map((p: any) => Array.isArray(p) ? p : [p.x, p.y]));
        if (rightArrow && rightArrow.length) result.addPath(rightArrow.map((p: any) => Array.isArray(p) ? p : [p.x, p.y]));
        if (middleArrow && middleArrow.length) result.addPath(middleArrow.map((p: any) => Array.isArray(p) ? p : [p.x, p.y]));
      }

      // Back line from slightly behind mid towards mid
      if (pts.length > 0) {
        const backAngle = GeoTools.angleInRadians(midPt, pts[0]);
        const backLen = GeoTools._2PtLen(midPt, pts[0]) / 10;
        const elongateMiddlePt = {
          x: -1 * backLen * Math.cos(backAngle) + midPt.x,
          y: -1 * backLen * Math.sin(backAngle) + midPt.y
        };
        result.addPath([[elongateMiddlePt.x, elongateMiddlePt.y], [midPt.x, midPt.y]]);
      }

      return result;
    } catch (e) {
      /* invalid geometry mid-draw is expected; ignore */
      return null;
    }
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

export default Disrupt;