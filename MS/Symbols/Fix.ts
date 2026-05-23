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
  public declaredClass: string = "MilitarySymbology.Symbols.Fix";
  public SID: string = "341100";
  public symName: string = "Fixation";
  public symGeometricType: string = "Line";


  private _lineSym: SimpleLineSymbol | null = null;
  private _points: Point[] = [];
  private _geometryType: string | null = null;
  private _drawType: number = 1;
  private amplifier: Amplifier;
  private _teethSize: number = 3;
  private _teethGap: number = 30;
  private _headRatio: number = 10;
  private _tailRatio: number = 10;

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

    this._lineSym = marker;

    this._drawType = options.DRAW_TYPE || 1;

    // Optional tunables
    this._tailRatio = GeoTools.setDefault(options, "TAIL_FACTOR", this._tailRatio);
    this._headRatio = GeoTools.setDefault(options, "HEAD_RATIO", this._headRatio);
    this._teethSize = GeoTools.setDefault(options, "TEETH_SIZE", this._teethSize);
    this._teethGap = GeoTools.setDefault(options, "TEETH_GAP", this._teethGap);

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
    (drawEssentials as any).TAIL_FACTOR = this._tailRatio;
    (drawEssentials as any).HEAD_RATIO = this._headRatio;
    (drawEssentials as any).TEETH_SIZE = this._teethSize;
    (drawEssentials as any).TEETH_GAP = this._teethGap;

    return drawEssentials;
  }

  /**
   * Create symbol per legacy JS: add the control path and place cross marks (SIDC '18') at intervals
   */
  private createSymbol(drawEssentials: DrawEssentials): Polyline | null {
    try {
      const ctrlPts = (drawEssentials as any).CTRL_PTS as Point[] | undefined;
      if (!ctrlPts || ctrlPts.length < 2) return null;

      const pts = ctrlPts;
      const firstPoint = pts[0];
      const secondPoint = pts[1];
      const lastPoint = pts[pts.length - 1];
      const secLastPoint = pts[pts.length - 2];

      const spatialReference = this.view.spatialReference;
      const result = new Polyline({ spatialReference });

      // Baseline metrics
      const baseLineLenFull = GeoTools._2PtLen(firstPoint, lastPoint);

      // 1) Place an 'F' at the start
      let cLenLimit = baseLineLenFull / 10;
      if (cLenLimit > baseLineLenFull / 3) cLenLimit = baseLineLenFull / 3;
      const fPts = Shapes.createF(firstPoint.x, firstPoint.y, cLenLimit, firstPoint.spatialReference);
      result.addPath(fPts.map(p => [p.x, p.y]));

      // 2) Tail segment forward from start
      let k = GeoTools.twoPtsAngle(firstPoint, secondPoint);
      cLenLimit = baseLineLenFull / 8;
      const lineStPt = { x: cLenLimit * Math.cos(k) + firstPoint.x, y: cLenLimit * Math.sin(k) + firstPoint.y };
      cLenLimit = baseLineLenFull / this._tailRatio;
      const lineEndPt = { x: cLenLimit * Math.cos(k) + lineStPt.x, y: cLenLimit * Math.sin(k) + lineStPt.y };
      result.addPath([[lineStPt.x, lineStPt.y], [lineEndPt.x, lineEndPt.y]]);

      // 3) Head stub near end
      k = GeoTools.twoPtsAngle(secLastPoint, lastPoint);
      cLenLimit = (baseLineLenFull / this._headRatio) * 1.5;
      const lineEndPt2 = { x: -1 * cLenLimit * Math.cos(k) + lastPoint.x, y: -1 * cLenLimit * Math.sin(k) + lastPoint.y };
      result.addPath([[lineEndPt2.x, lineEndPt2.y], [lastPoint.x, lastPoint.y]]);

      // 4) Build chopped path between tail end and head start
      const chopPts: { x: number; y: number }[] = [lineEndPt].concat(
        pts.slice(1, pts.length - 1).map(p => ({ x: p.x, y: p.y })),
        [lineEndPt2]
      );

      // 5) Create double lines offset from chopped path
      const firstChopPt = chopPts[0];
      const lastChopPt = chopPts[chopPts.length - 1];
      const leftArray: Point[] = [];
      const rightArray: Point[] = [];

      let len = baseLineLenFull / 5 / this._teethSize;
      let perp = Math.atan((firstChopPt.y - lastChopPt.y) / ((firstChopPt.x - lastChopPt.x) || 1e-9));
      switch (GeoTools.twoPtsRelationShip(new Point({ x: firstChopPt.x, y: firstChopPt.y }), new Point({ x: lastChopPt.x, y: lastChopPt.y }))) {
        case "ne":
        case "se":
          perp += Math.PI / 2;
          break;
        case "nw":
        case "sw":
          perp += (3 * Math.PI) / 2;
          break;
      }

      const partialLen = len;
      const p1 = { x: partialLen * Math.cos(perp) + firstChopPt.x, y: partialLen * Math.sin(perp) + firstChopPt.y };
      const p2 = { x: -1 * partialLen * Math.cos(perp) + firstChopPt.x, y: -1 * partialLen * Math.sin(perp) + firstChopPt.y };

      if (chopPts.length >= 1) {
        leftArray.push(new Point({ x: p1.x, y: p1.y, spatialReference }));
        rightArray.push(new Point({ x: p2.x, y: p2.y, spatialReference }));
      }

      for (let i = 0; i < chopPts.length; i++) {
        const target = chopPts[i];
        const tgtPt = new Point({ x: target.x, y: target.y, spatialReference });
        const firstPt = new Point({ x: firstChopPt.x, y: firstChopPt.y, spatialReference });
        const lengthTo = GeoTools._2PtLen(firstPt, tgtPt);
        const angTo = GeoTools.angleInRadians(firstPt, tgtPt);

        const stPtCandidatePt = new Point({ x: p1.x + lengthTo * Math.cos(angTo), y: p1.y + lengthTo * Math.sin(angTo), spatialReference });
        const endPtCandidatePt = new Point({ x: p2.x + lengthTo * Math.cos(angTo), y: p2.y + lengthTo * Math.sin(angTo), spatialReference });

        // Thickness limiter (kept for parity; points not used further)
        let segLen = lengthTo / 5;
        const baseBetween = GeoTools._2PtLen(stPtCandidatePt, endPtCandidatePt);
        const baseLimit = baseBetween / 4;
        if (segLen > baseLimit) segLen = baseLimit;

        leftArray.push(stPtCandidatePt);
        rightArray.push(endPtCandidatePt);
      }

      // 6) Generate alternating mid points to form zig-zag
      let gapRatio = GeoTools._2PtLen(new Point({ x: chopPts[0].x, y: chopPts[0].y, spatialReference }), new Point({ x: chopPts[chopPts.length - 1].x, y: chopPts[chopPts.length - 1].y, spatialReference }));
      gapRatio = gapRatio / this._teethGap;
      const rightResPts = GeoTools.getDashPts(rightArray, [gapRatio, gapRatio]);
      const leftResPts = GeoTools.getDashPts(leftArray, [gapRatio, gapRatio]);

      const zig: Point[] = [];
      for (let i = 1; i < rightResPts.length; i++) {
        if (i % 2 === 0) zig.push(rightResPts[i]); else zig.push(leftResPts[i]);
      }

      if (zig.length > 0) {
        // Connect tail to first zig point
        result.addPath([[lineEndPt.x, lineEndPt.y], [zig[0].x, zig[0].y]]);
        // Add zig-zag path
        result.addPath(zig.map(p => [p.x, p.y]));
      }

      // Connect last zig to head start
      const lastZig = zig.length > 0 ? zig[zig.length - 1] : new Point({ x: lineEndPt.x, y: lineEndPt.y, spatialReference });
      result.addPath([[lastZig.x, lastZig.y], [lineEndPt2.x, lineEndPt2.y]]);

      // 7) Arrow head at the end
      const ah = Shapes.arrowHead(lastPoint, GeoTools.ArrowFlanksLen(GeoTools._2PtLen(secLastPoint, lastPoint), GeoTools._2PtLen(secLastPoint, lastPoint)), GeoTools.angleInRadians(secLastPoint, lastPoint));
      result.addPath(ah.map(p => [p.x, p.y]));

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