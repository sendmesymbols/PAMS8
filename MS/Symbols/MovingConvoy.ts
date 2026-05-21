import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier.ts";
import BaseLine from "../Support/BaseLine.ts";
import GeoTools from "../Support/GeoTools.ts";

import SymbolEvents from "../Support/SymbolEvents";
export interface MovingConvoyOptions {
  CTRL_PTS?: Point[];
  BASE_LN_PTS?: {startPt: Point, endPt: Point};
  GEOM?: Polyline;
  [key: string]: any;
}

/**
 * MovingConvoy class for drawing Moving Convoy / Approach tactical symbols
 */
export class MovingConvoy {
  private view: MapView | SceneView;
  private layerManager: GraphicsLayerManager;
  private symbolLayer: GraphicsLayer;
  private isLine: boolean;

  // Symbol properties
  public declaredClass: string = "MilitarySymbology.Symbols.MovingConvoy";
  public SID: string = "330100";
  public symName: string = "Moving Convoy / Approach";
  public symGeometricType: string = "Area";

  private _lineSym: SimpleLineSymbol | null = null;
  private _points: Point[] = [];
  private _baseLinePts: any = null;
  private _geometryType: string | null = null;
  private amplifier: Amplifier;

  // Drawing state
  private isDrawing: boolean = false;
  private tempGraphic: Graphic | null = null;

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
    this.events = new SymbolEvents(view, "MovingConvoy");

    // Initialize layers if not already done
    this.layerManager.initializeLayers();

    // Initialize temporary graphic
    this.tempGraphic = new Graphic();
  }

  /**
   * Initialize the Moving Convoy drawing
   */
  public init(options: MovingConvoyOptions, marker: SimpleLineSymbol): void {
    this._lineSym = marker.clone();

    const drawEssentials = new DrawEssentials();

    if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("BASE_LN_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
      if (options.GEOM && this.tempGraphic) {
        try {
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

  private baseLineClick(evt: any): void {
    this.events.emit("onDrawClick", {
      currentPts: evt.currentGeometry,
      isBaseLine: true
    });
  }

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
    this.isDrawing = true;

    // Start control point drawing
    this.setupControlPointHandlers();

    this.events.emit("onBaseLineDrawEnd", {
      currentPts: (evt.geometry as any).controlPoints
    });
  }

  private setupControlPointHandlers(): void {
    this.mouseMoveHandler = this.view.on("pointer-move", (event) => {
      this._onMouseMoveHandler(event);
    });

    this.clickHandler = this.view.on("click", (event) => {
      this._onClickHandler(event);
    });

    this.doubleClickHandler = this.view.on("double-click", (event) => {
      this._onDoubleClickHandler(event);
    });
  }

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

    if (this.isLine === true && this._points.length === 1) {
      this.events.emit("onDrawClick", { currentPts: this._points });
      this.cleanUp();
    }
  }

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

  private createDrawEssentials(ctrlPts: Point[], baseLinePts: any): DrawEssentials {
    const drawEssentials = new DrawEssentials();
    drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
    drawEssentials.SID = this.SID;
    drawEssentials.SYM_NAME = this.symName;
    drawEssentials.GEOM = null;
    drawEssentials.AMPLIFIER = this.amplifier.toString();

    (drawEssentials as any).SCOPE = this;
    (drawEssentials as any).CTRL_PTS = ctrlPts;
    (drawEssentials as any).BASE_LN_PTS = baseLinePts;

    return drawEssentials;
  }

  private createSymbol(drawEssentials: DrawEssentials): Polyline | null {
    try {
      const pts: Point[] = (drawEssentials as any).CTRL_PTS;
      if (!pts || pts.length === 0) {
        throw new Error("controlPoints not found");
      }

      const baseLinePts = (drawEssentials as any).BASE_LN_PTS;
      if (!baseLinePts || baseLinePts.startPt === undefined || baseLinePts.endPt === undefined) {
        throw new Error("First Parameter of the Function is an Array with Start and End Point");
      }

      const stPt = baseLinePts.startPt as Point;
      const endPt = baseLinePts.endPt as Point;

      const firstPoint = pts[0];
      let lastPoint = pts[pts.length - 1];
      const leftArray: Point[] = [];
      const rightArray: Point[] = [];
      const middleArray: Point[] = [];

      const midPt = GeoTools.getMidPoint(stPt, endPt);
      const spatialReference = this.view.spatialReference;
      const result = new Polyline({ spatialReference });

      // Base Line
      if (pts.length >= 1) {
        lastPoint = firstPoint;
      }

      const len = GeoTools._2PtLen(midPt, endPt);
      let k = Math.atan((midPt.y - lastPoint.y) / (midPt.x - lastPoint.x));

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

      const partialLen = len;

      const p1 = new Point({ x: partialLen * Math.cos(k) + midPt.x, y: partialLen * Math.sin(k) + midPt.y, spatialReference });
      const p2 = new Point({ x: -1 * partialLen * Math.cos(k) + midPt.x, y: -1 * partialLen * Math.sin(k) + midPt.y, spatialReference });

      result.addPath([[p1.x, p1.y], [p2.x, p2.y]]);
      // End of Base Line

      // Front
      if (pts.length >= 1) {
        leftArray.push(p1);
        rightArray.push(p2);
        middleArray.push(midPt);
      }

      let shortenLeftPt: Point = p1;
      let shortenRightPt: Point = p2;

      for (let i = 0; i < pts.length; i++) {
        const length = GeoTools._2PtLen(midPt, pts[i]);
        let angle = GeoTools.angleInRadians(midPt, pts[i]);

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

        let currentLen = length / 5;
        const baseLineLen = GeoTools._2PtLen(stPtCandidatePt, endPtCandidatePt);
        const baseLineLenLimit = baseLineLen / 4;
        if (currentLen > baseLineLenLimit) currentLen = baseLineLenLimit;

        angle = GeoTools.angleInRadians(stPtCandidatePt, endPtCandidatePt);

        // Calculate shortened points
        k = GeoTools.angleInRadians(midPt, pts[i]);

        shortenLeftPt = new Point({
          x: -1 * length / 10 * Math.cos(k) + stPtCandidatePt.x,
          y: -1 * length / 5 * Math.sin(k) + stPtCandidatePt.y,
          spatialReference
        });
        leftArray.push(shortenLeftPt);

        shortenRightPt = new Point({
          x: -1 * length / 10 * Math.cos(k) + endPtCandidatePt.x,
          y: -1 * length / 5 * Math.sin(k) + endPtCandidatePt.y,
          spatialReference
        });
        rightArray.push(shortenRightPt);

        const shortenMiddlePt = new Point({
          x: -1 * length / 10 * Math.cos(k) + pts[i].x,
          y: -1 * length / 10 * Math.sin(k) + pts[i].y,
          spatialReference
        });
        middleArray.push(shortenMiddlePt);
      }

      result.addPath(leftArray.map(pt => [pt.x, pt.y]));
      result.addPath(rightArray.map(pt => [pt.x, pt.y]));

      // Create Arrow Head
      const LeftFlankPt = this.getFlankPts(shortenLeftPt, leftArray[0]);
      const rightFlankPt = this.getFlankPts(shortenRightPt, rightArray[0]);
      const lastCtrlPt = pts[pts.length - 1];

      result.addPath([
        [shortenLeftPt.x, shortenLeftPt.y],
        [LeftFlankPt[1].x, LeftFlankPt[1].y],
        [lastCtrlPt.x, lastCtrlPt.y],
        [rightFlankPt[0].x, rightFlankPt[0].y],
        [shortenRightPt.x, shortenRightPt.y]
      ]);

      return result;
    } catch (e) {
      console.log(this.declaredClass + ' Cannot create Symbol due to invalid geometry');
      return null;
    }
  }

  private getFlankPts(firstPoint: Point, lastPoint: Point): Point[] {
    const baseLineLen = GeoTools._2PtLen(firstPoint, lastPoint) / 4;
    let cLenLimit = baseLineLen / 4;
    if (cLenLimit > baseLineLen / 2) cLenLimit = baseLineLen / 2;

    const len = cLenLimit;
    let k = Math.atan((firstPoint.y - lastPoint.y) / (firstPoint.x - lastPoint.x));

    switch (GeoTools.twoPtsRelationShip(firstPoint, lastPoint)) {
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

    return [
      new Point({ x: partialLen * Math.cos(k) + firstPoint.x, y: partialLen * Math.sin(k) + firstPoint.y, spatialReference: this.view.spatialReference }),
      new Point({ x: -1 * partialLen * Math.cos(k) + firstPoint.x, y: -1 * partialLen * Math.sin(k) + firstPoint.y, spatialReference: this.view.spatialReference })
    ];
  }

  public getBaseLinePts(): any {
    return this._baseLinePts;
  }

  private cleanUp(): void {
    if (this._points.length === 0) return;

    const drawEssentials = this.createDrawEssentials(this._points.slice(), this._baseLinePts);

    if (this.tempGraphic && this.tempGraphic.geometry) {
      this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEssentials);
    }

    this._clear();
    this._removeEvents();
  }

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

  private __onDrawEnd(geometry: Polyline, geoGeometry: Polyline, drawEssParam: DrawEssentials): void {
    this.events.emit("onDrawEnd", {
      geometry: geometry,
      geographicGeometry: geoGeometry,
      drawEssentials: drawEssParam,
      marker: this._lineSym
    });
  }

  private _clear(): void {
    if (this.tempGraphic && this.symbolLayer) {
      this.symbolLayer.remove(this.tempGraphic);
    }

    this.tempGraphic = null;
    this._points = [];
    this._baseLinePts = null;
  }

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

export default MovingConvoy;