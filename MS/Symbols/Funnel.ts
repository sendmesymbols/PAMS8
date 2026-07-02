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
import DrawSeam from "../Support/DrawSeam";
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
  private frontLineAgle: number = 0;
  private frontLineDist: number = 0;
  private flapDist: number = 0;

  // Event emitter
  private events: SymbolEvents;

  constructor(view: MapView | SceneView, isLine: boolean = false) {
    this.view = view;
    this.isLine = isLine;
    this.layerManager = GraphicsLayerManager.getInstance(view);
    this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.TACT);
    this.amplifier = new Amplifier();
    this.events = new SymbolEvents(view, "Funnel");

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
    this.frontLineAgle = GeoTools.setDefault(options, "FRNT_LN_ANGL_RATIO", 0.8);
    this.frontLineDist = GeoTools.setDefault(options, "FRNT_LN_DIST_RATIO", 1.5);
    this.flapDist = GeoTools.setDefault(options, "FLAP_DIST_RATIO", 3);

    // no-op

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

      const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.BASE_LN_PTS!, this.frontLineAgle, this.frontLineDist, this.flapDist);
      if (this.tempGraphic && this.tempGraphic.geometry) {
        this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEss);
      }
      this._clear();

    } else if (options.hasOwnProperty("CTRL_PTS")) {
      if (options.hasOwnProperty("BASE_LN_PTS")) {
        // Immediate placement with control points and baseline
        const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.BASE_LN_PTS!, this.frontLineAgle, this.frontLineDist, this.flapDist);
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

    // Immediately render symbol using current points without requiring mouse move
    const drawEssentials = new DrawEssentials();
    (drawEssentials as any).CTRL_PTS = this._points.slice();
    (drawEssentials as any).BASE_LN_PTS = this._baseLinePts;
    const geometry = this.createSymbol(drawEssentials);
    if (geometry && this.tempGraphic) {
      this.tempGraphic.geometry = geometry;
      this.events.emit("onDrawProgress", {
        currentGeometry: geometry,
        currentDrawEssentials: drawEssentials,
        currentMarker: this._lineSym
      });
    }

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
  private createDrawEssentials(ctrlPts: Point[], baseLinePts: any, frontLineAngleRatio:any, frontLineDistRatio:any, flapDistRatio:any): DrawEssentials {
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

    drawEssentials.FRNT_LN_ANGL_RATIO = frontLineAngleRatio;
    drawEssentials.FRNT_LN_DIST_RATIO = frontLineDistRatio;
    drawEssentials.FLAP_DIST_RATIO = flapDistRatio;

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

      // Extract ratios
      const frontLineAgle: number = GeoTools.setDefault(drawEssentials as any, "FRNT_LN_ANGL_RATIO", 0.8);
      const frontLineDist: number = GeoTools.setDefault(drawEssentials as any, "FRNT_LN_DIST_RATIO", 1.5);
      const flapDistRatio: number = GeoTools.setDefault(drawEssentials as any, "FLAP_DIST_RATIO", 3);

      // Extract baseline points
      const stPt: Point = (drawEssentials as any).BASE_LN_PTS?.startPt;
      const endPt: Point = (drawEssentials as any).BASE_LN_PTS?.endPt;
      if (!stPt || !endPt) {
        throw new Error("First Parameter of the Function is an Array with Start and End Point");
      }

      const spatialReference = this.view.spatialReference;
      const result = new Polyline({ spatialReference });

      // Compute midpoint on baseline
      const midPt = GeoTools.getMidPoint(stPt, endPt);

      // Determine baseline orientation using first control point (as in 3.x)
      const firstPoint = pts[0];
      let lastPoint = pts[pts.length - 1];
      if (pts.length >= 1) {
        lastPoint = firstPoint;
      }

      let k = Math.atan((midPt.y - lastPoint.y) / (midPt.x - lastPoint.x));
      switch (GeoTools.twoPtsRelationShip(midPt, lastPoint)) {
        case "ne": k += Math.PI / 2; break;
        case "nw": k += Math.PI * 3 / 2; break;
        case "sw": k += Math.PI * 3 / 2; break;
        case "se": k += Math.PI / 2; break;
      }

      // Base line endpoints from midpoint along angle k
      const partialLen = GeoTools._2PtLen(midPt, endPt);
      const p1 = { x: partialLen * Math.cos(k) + midPt.x, y: partialLen * Math.sin(k) + midPt.y };
      const p2 = { x: -1 * partialLen * Math.cos(k) + midPt.x, y: -1 * partialLen * Math.sin(k) + midPt.y };

      // Add baseline path
      result.addPath([[p1.x, p1.y], [p2.x, p2.y]]);

      // Front (corridor) points from first control point
      const leftArray: number[][] = [];
      const rightArray: number[][] = [];
      if (pts.length >= 1) {
        leftArray.push([p1.x, p1.y]);
        rightArray.push([p2.x, p2.y]);

        // Extend towards first control point using ratios
        const length = GeoTools._2PtLen(midPt, pts[0]) / frontLineDist;
        const angle = GeoTools.angleInRadians(midPt, pts[0]);

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

        // Flaps
        const flapLen = length / flapDistRatio + GeoTools._2PtLen(pts[0], pts[pts.length - 1]);
        let flapAngle = GeoTools.angleInRadians(stPtCandidatePt, endPtCandidatePt) - frontLineAgle;
        const ptLeft = new Point({
          x: -1 * flapLen * Math.cos(flapAngle) + stPtCandidatePt.x,
          y: -1 * flapLen * Math.sin(flapAngle) + stPtCandidatePt.y,
          spatialReference
        });
        flapAngle = GeoTools.angleInRadians(stPtCandidatePt, endPtCandidatePt) + frontLineAgle;
        const ptRight = new Point({
          x: flapLen * Math.cos(flapAngle) + endPtCandidatePt.x,
          y: flapLen * Math.sin(flapAngle) + endPtCandidatePt.y,
          spatialReference
        });

        leftArray.push([ptLeft.x, ptLeft.y]);
        rightArray.push([ptRight.x, ptRight.y]);

        // Funnel head (arc) through ptLeft, ptRight and last control point
        const candidatePoint = pts[pts.length - 1];
        const ptLeftScreen: any = (this.view as any).toScreen(ptLeft);
        const ptRightScreen: any = (this.view as any).toScreen(ptRight);
        const candScreen: any = (this.view as any).toScreen(candidatePoint);

        if (ptLeftScreen && ptRightScreen && candScreen) {
          const circle = GeoTools.circleFromThreeScreenPoints(
            { x: ptLeftScreen.x, y: ptLeftScreen.y },
            { x: ptRightScreen.x, y: ptRightScreen.y },
            { x: candScreen.x, y: candScreen.y }
          );
          if (circle && circle.radius > 0) {
            const arcVals = Shapes.createCircleSegmentFromThreePoints(
              this.view as any,
              circle,
              { x: ptLeftScreen.x, y: ptLeftScreen.y },
              { x: ptRightScreen.x, y: ptRightScreen.y },
              { x: candScreen.x, y: candScreen.y },
              60
            );
            if (arcVals && arcVals.geometry) {
              const ring = (arcVals.geometry as any).rings?.[0] as number[][];
              if (ring && ring.length) {
                // As in 3.x, use 61 points (0..60) if available
                const arcPath = ring.slice(0, 61);
                result.addPath(arcPath);
              }
            }
          }
        }
      }

      // Add the left and right paths
      if (leftArray.length) result.addPath(leftArray);
      if (rightArray.length) result.addPath(rightArray);

      return result;
    } catch (e) {
      console.log(this.declaredClass + ' Can not create Symbol due to invalid geometry');
      return null;
    }
  }


  /**
   * Clean up drawing state and finalize
   */
  private cleanUp(): void {
    if (this._points.length === 0) return;

    const drawEssentials = this.createDrawEssentials(
      this._points.slice(),
      this._baseLinePts,
      this.frontLineAgle,
      this.frontLineDist,
      this.flapDist
    );

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

export default Funnel;