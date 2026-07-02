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
import DrawSeam from "../Support/DrawSeam";

import SymbolEvents from "../Support/SymbolEvents";
export interface DisruptObstacleEffectOptions {
  CTRL_PTS?: Point[];
  BASE_LN_PTS?: {startPt: Point, endPt: Point};
  GEOM?: Polyline;
  [key: string]: any;
}

/**
 * DisruptObstacleEffect class for drawing DisruptObstacleEffect tactical symbols
 * Uses baseline + control points
 * Returns Polyline geometry despite being classified as an Area symbol
 */
export class DisruptObstacleEffect {
  private view: MapView | SceneView;
  private layerManager: GraphicsLayerManager;
  private symbolLayer: GraphicsLayer;
  private isLine: boolean;

  // Symbol properties
  public declaredClass: string = "MilitarySymbology.Symbols.DisruptObstacleEffect";
  public SID: string = "270502";
  public symName: string = "Disrupt / Obs Effect";
  public symGeometricType: string = "Area";
  public isObstacle: string = "1";

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
    this.events = new SymbolEvents(view, "DisruptObstacleEffect");

    // Initialize layers if not already done
    this.layerManager.initializeLayers();

    // Initialize temporary graphic
    this.tempGraphic = new Graphic();
    this._injectStyles();
  }

  private _injectStyles(): void {
    if (document.getElementById('disrupt-obs-effect-styles')) return;
    const style = document.createElement('style');
    style.id = 'disrupt-obs-effect-styles';
    style.textContent = `
      .disrupt-obs-effect-panel {
        position: fixed;
        background: var(--ms-bg, #161b26);
        border: 1px solid var(--ms-border, rgba(90, 130, 200, 0.3));
        border-radius: var(--ms-radius, 8px);
        color: var(--ms-text, #dce8f5);
        font-family: var(--ms-font, 'Inter', sans-serif);
        font-size: var(--ms-fs, 12px);
        z-index: 1100;
        overflow: hidden;
        box-shadow: var(--ms-shadow, 0 8px 32px rgba(0, 0, 0, 0.45));
      }

      .disrupt-obs-effect-panel .ms-body {
        max-height: 380px;
        overflow-y: auto;
        padding: 6px 0;
      }

      /* ── Thin ops-dark scrollbar — matches LocalPeaksEngine / Widgets.css ── */
      .disrupt-obs-effect-panel .ms-body::-webkit-scrollbar,
      .disrupt-obs-effect-panel::-webkit-scrollbar {
        width: 4px;
      }
      .disrupt-obs-effect-panel .ms-body::-webkit-scrollbar-track,
      .disrupt-obs-effect-panel::-webkit-scrollbar-track {
        background: transparent;
      }
      .disrupt-obs-effect-panel .ms-body::-webkit-scrollbar-thumb,
      .disrupt-obs-effect-panel::-webkit-scrollbar-thumb {
        background: var(--ms-border, rgba(90, 130, 200, 0.35));
        border-radius: 2px;
      }
      .disrupt-obs-effect-panel .ms-body::-webkit-scrollbar-thumb:hover,
      .disrupt-obs-effect-panel::-webkit-scrollbar-thumb:hover {
        background: var(--ms-accent, rgba(100, 180, 255, 0.65));
      }

      /* Firefox */
      .disrupt-obs-effect-panel .ms-body,
      .disrupt-obs-effect-panel {
        scrollbar-width: thin;
        scrollbar-color: var(--ms-border, rgba(90, 130, 200, 0.35)) transparent;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Initialize the DisruptObstacleEffect drawing
   */
  public init(options: DisruptObstacleEffectOptions, marker: SimpleLineSymbol): void {
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
    const mapPoint = DrawSeam.resolvePoint(this.view, clickEvent);
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
    if (!this.baseLineComplete || !this.tempGraphic) return;

    const mapPoint = DrawSeam.resolvePoint(this.view, inputEvent);
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

      // Get first and last points for calculations
      const firstPoint = pts[0];
      const lastPoint = pts[pts.length - 1];
      
      // Arrays to store the three main lines
      const leftArray: Array<{ x: number; y: number }> = [];
      const rightArray: Array<{ x: number; y: number }> = [];
      const middleArray: Array<{ x: number; y: number }> = [];

      // Calculate midpoint of baseline
      const midPt = GeoTools.getMidPoint(stPt, endPt);

      // Base Line calculation - create perpendicular line through midpoint
      // Use first point for orientation if we have at least one control point
      let referencePoint = firstPoint;
      if (pts.length >= 1) {
        referencePoint = firstPoint;
      }

      const len = GeoTools._2PtLen(midPt, endPt);
      let k = Math.atan((midPt.y - referencePoint.y) / (midPt.x - referencePoint.x));

      // Adjust angle based on quadrant relationship
      switch (GeoTools.twoPtsRelationShip(midPt, referencePoint)) {
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

      const partialLen = len;
      const p1 = { x: partialLen * Math.cos(k) + midPt.x, y: partialLen * Math.sin(k) + midPt.y };
      const p2 = { x: -1 * partialLen * Math.cos(k) + midPt.x, y: -1 * partialLen * Math.sin(k) + midPt.y };

      // Add base line path
      result.addPath([[p1.x, p1.y], [p2.x, p2.y]]);

      // Initialize arrays with starting points
      if (pts.length >= 1) {
        leftArray.push(p1);
        rightArray.push(p2);
        middleArray.push({ x: midPt.x, y: midPt.y });
      }

      // Variables to track last candidate points for arrow calculations
      let stPtCandidatePt: Point | null = null;
      let endPtCandidatePt: Point | null = null;

      // Process each control point to build the arrays
      for (let i = 0; i < pts.length; i++) {
        // Find distance between candidate point and mid point
        const length = GeoTools._2PtLen(midPt, pts[i]);
        const angle = GeoTools.angleInRadians(midPt, pts[i]);

        // Calculate candidate points on the extended baseline
        stPtCandidatePt = new Point({
          x: p1.x + length * Math.cos(angle), 
          y: p1.y + length * Math.sin(angle), 
          spatialReference
        });
        endPtCandidatePt = new Point({
          x: p2.x + length * Math.cos(angle), 
          y: p2.y + length * Math.sin(angle), 
          spatialReference
        });

        // Calculate length constraint based on local baseline
        let len2 = length / 5;
        const baseLineLen = GeoTools._2PtLen(stPtCandidatePt, endPtCandidatePt);
        const baseLineLenLimit = baseLineLen / 4;
        if (len2 > baseLineLenLimit) {
          len2 = baseLineLenLimit;
        }

        // Calculate angle between candidate points
        const angleBetween = GeoTools.angleInRadians(stPtCandidatePt, endPtCandidatePt);

        // Calculate adjustment angle from midpoint to control point
        const kLocal = GeoTools.angleInRadians(midPt, pts[i]);

        // Shorten right array point (moving toward midpoint)
        const shortenRightPt = { 
          x: -1 * (length / 5) * Math.cos(kLocal) + endPtCandidatePt.x, 
          y: -1 * (length / 5) * Math.sin(kLocal) + endPtCandidatePt.y 
        };
        rightArray.push(shortenRightPt);

        // Shorten middle array point (moving toward midpoint)
        const shortenMiddlePt = { 
          x: -1 * (length / 10) * Math.cos(kLocal) + pts[i].x, 
          y: -1 * (length / 10) * Math.sin(kLocal) + pts[i].y 
        };
        middleArray.push(shortenMiddlePt);

        // Left array gets the full candidate point
        leftArray.push({ x: stPtCandidatePt.x, y: stPtCandidatePt.y });
      }

      // Add the three main arrays as paths
      if (leftArray.length >= 2) {
        result.addPath(leftArray.map(p => [p.x, p.y]));
      }
      if (rightArray.length >= 2) {
        result.addPath(rightArray.map(p => [p.x, p.y]));
      }

      // Add middle array as a single path
      if (middleArray.length >= 2) {
        result.addPath(middleArray.map(p => [p.x, p.y]));
      }

      // Add arrow heads to the tips of all three arrays
      if (leftArray.length >= 2 && rightArray.length >= 2 && middleArray.length >= 2 && 
          stPtCandidatePt && endPtCandidatePt) {
        
        const mainLen = GeoTools._2PtLen(midPt, pts[pts.length - 1]);
        const baseLen = GeoTools._2PtLen(stPtCandidatePt, endPtCandidatePt);
        const arrowLen = GeoTools.ArrowFlanksLen 
          ? GeoTools.ArrowFlanksLen(mainLen, baseLen)
          : Math.min(mainLen / 10, baseLen / 4);

        // Create arrow heads for each array
        const leftLastPt = new Point({ 
          x: leftArray[leftArray.length - 1].x, 
          y: leftArray[leftArray.length - 1].y, 
          spatialReference 
        });
        const leftPrevPt = new Point({ 
          x: leftArray[leftArray.length - 2].x, 
          y: leftArray[leftArray.length - 2].y, 
          spatialReference 
        });

        const rightLastPt = new Point({ 
          x: rightArray[rightArray.length - 1].x, 
          y: rightArray[rightArray.length - 1].y, 
          spatialReference 
        });
        const rightPrevPt = new Point({ 
          x: rightArray[rightArray.length - 2].x, 
          y: rightArray[rightArray.length - 2].y, 
          spatialReference 
        });

        const middleLastPt = new Point({ 
          x: middleArray[middleArray.length - 1].x, 
          y: middleArray[middleArray.length - 1].y, 
          spatialReference 
        });
        const middlePrevPt = new Point({ 
          x: middleArray[middleArray.length - 2].x, 
          y: middleArray[middleArray.length - 2].y, 
          spatialReference 
        });

        // Generate arrow head paths
        const leftArrow = (Shapes as any).arrowHead
          ? (Shapes as any).arrowHead(leftLastPt, arrowLen, GeoTools.angleInRadians(leftPrevPt, leftLastPt))
          : [];
        const rightArrow = (Shapes as any).arrowHead
          ? (Shapes as any).arrowHead(rightLastPt, arrowLen, GeoTools.angleInRadians(rightPrevPt, rightLastPt))
          : [];
        const middleArrow = (Shapes as any).arrowHead
          ? (Shapes as any).arrowHead(middleLastPt, arrowLen, GeoTools.angleInRadians(middlePrevPt, middleLastPt))
          : [];

        // Add arrow paths to result
        if (leftArrow && leftArrow.length > 0) {
          result.addPath(leftArrow.map((p: any) => Array.isArray(p) ? p : [p.x, p.y]));
        }
        if (rightArrow && rightArrow.length > 0) {
          result.addPath(rightArrow.map((p: any) => Array.isArray(p) ? p : [p.x, p.y]));
        }
        if (middleArrow && middleArrow.length > 0) {
          result.addPath(middleArrow.map((p: any) => Array.isArray(p) ? p : [p.x, p.y]));
        }
      }

      // Add back line - elongate middle point behind midpoint toward midpoint
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

export default DisruptObstacleEffect;