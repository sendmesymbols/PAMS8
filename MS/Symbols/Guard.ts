import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import GraphicsLayerManager, {LAYER_NAMES} from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";


import SymbolEvents from "../Support/SymbolEvents";
export interface GuardOptions {
  CTRL_PTS?: Point[];
  GEOM?: Polyline;
  DRAW_TYPE?: number;

  [key: string]: any;
}

/**
 * Guard class for drawing Phase Line symbols on MapView or SceneView
 * Creates line symbol
 */
export class Guard {
  private view: MapView | SceneView;
  private layerManager: GraphicsLayerManager;
  private symbolLayer: GraphicsLayer;
  private isLine: boolean;

  // Symbol properties
  public declaredClass: string = "MilitarySymbology.Symbols.Guard";
  public SID: string = "342202";
  public symName: string = "Guard";
  public symGeometricType: string = "Area";

  private _lineSym: SimpleLineSymbol | SimpleFillSymbol | null = null;
  private _points: Point[] = [];
  private _drawType: number = 1;
  private _geometryType: string | null = null;
  private amplifier: Amplifier;

  private _echlon: number = 0;
  private _tailFactor: number = 0.17;

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
    this.events = new SymbolEvents(view, "Guard");

    // Initialize layers if not already done
    this.layerManager.initializeLayers();

    // Initialize temporary graphic
    this.tempGraphic = new Graphic();
  }

  /**
   * Initialize the phase line drawing
   */
  public init(options: GuardOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void {
    this._lineSym = marker;

    // Set parameters from options
    this._drawType = GeoTools.setDefault(options, "DRAW_TYPE", this._drawType);
    this._tailFactor = GeoTools.setDefault(options, "TAIL_FACTOR", this._tailFactor);
    this._echlon = options.ECHLON || 0;


    const drawEssentials = new DrawEssentials();

    if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
      // Immediate placement with both control points and geometry
      if (options.GEOM && this.tempGraphic) {
        try {
          this.tempGraphic.geometry = new Polyline({
            paths: options.GEOM,
            spatialReference: this.view.spatialReference
          });
        } catch (error) {
          console.error(this.symName, "Failed to create Polyline geometry:", error);
        }
      }

      const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.ECHLON);

      if (this.tempGraphic && this.tempGraphic.geometry) {
        this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEss);
      }
      this._clear();

    } else if (options.hasOwnProperty("CTRL_PTS")) {

      // Immediate placement with control points only
      const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.ECHLON);

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
      symbol: this._lineSym
    });
    this.symbolLayer.add(this.tempGraphic);

    // Set up event handlers
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

    this.events.emit("onDrawClick", {currentPts: this._points});

    // For single line mode, finish after first click
    if (this.isLine === true && this._points.length === 1) {
      this.cleanUp();
    }

    // For Guard, finish after 3 points (legacy behavior)
    if (this._points.length === 3) {
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

    const drawEssentials = new DrawEssentials();
    (drawEssentials as any).CTRL_PTS = this._points.concat([candidatePoint]);
    (drawEssentials as any).ECHLON = this._echlon;

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
  private createDrawEssentials(ctrlPts: Point[], echlon?: number): DrawEssentials {
    const drawEssentials = new DrawEssentials();
    drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
    drawEssentials.SID = this.SID;
    drawEssentials.SYM_NAME = this.symName;
    drawEssentials.AMPLIFIER = this.amplifier.toString();

    // Store additional properties
    (drawEssentials as any).SCOPE = this;
    (drawEssentials as any).CTRL_PTS = ctrlPts;
    (drawEssentials as any).ECHLON = echlon;

    return drawEssentials;
  }

  /**
   * Create symbol geometry from DrawEssentials (matches legacy Guard behavior)
   */
  private createSymbol(drawEssentials: DrawEssentials): Polyline | null {
    try {
      let pts: Point[];

      if ((drawEssentials as any).CTRL_PTS) {
        pts = (drawEssentials as any).CTRL_PTS;
      } else {
        throw new Error("controlPoints not found");
      }

      const spatialReference = this.view.spatialReference;
      const result = new Polyline({ spatialReference });
      const firstPoint = pts[0];
      const secondPoint = pts[1];

      // Arrow Head at first point (backward)
      const arrowLength = GeoTools.ArrowFlanksLen(GeoTools._2PtLen(firstPoint, secondPoint), GeoTools._2PtLen(firstPoint, secondPoint));
      const arrowAngle = GeoTools.angleInRadians(firstPoint, secondPoint);
      const arrowHead = (Shapes as any).arrowHeadBackward(firstPoint, arrowLength, arrowAngle) as Point[];
      if (arrowHead && arrowHead.length) {
        result.addPath(arrowHead.map(p => [p.x, p.y]));
      }

      // Create first wing
      const midPt = GeoTools.getMidPoint(firstPoint, secondPoint);
      const length = GeoTools._2PtLen(firstPoint, midPt) / 3;
      const angle = this.toRad(16); // 16 degrees

      const rightWing = new Point({
        x: midPt.x - length * Math.cos(angle),
        y: midPt.y - length * Math.sin(angle),
        spatialReference
      });

      const wingAngle = GeoTools.angleInRadians(rightWing, secondPoint);
      const gapPt = new Point({
        x: rightWing.x + length * 2 * Math.cos(wingAngle),
        y: rightWing.y + length * 2 * Math.sin(wingAngle),
        spatialReference
      });


      // Create G symbol
      const baseLineLen = GeoTools._2PtLen(firstPoint, secondPoint);
      let cLenLimit = baseLineLen / 25;
      if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;

      const cPt = new Point({
        x: gapPt.x + cLenLimit * 1.5 * Math.cos(wingAngle),
        y: gapPt.y + cLenLimit * 1.5 * Math.sin(wingAngle),
        spatialReference
      });

      const cPts = (Shapes as any).createG(cPt.x, cPt.y, cLenLimit, spatialReference) as Point[];
      if (cPts && cPts.length) {
        result.addPath(cPts.map(p => [p.x, p.y]));
      }


      // Add first wing path
      result.addPath([
        [firstPoint.x, firstPoint.y],
        [midPt.x, midPt.y],
        [rightWing.x, rightWing.y],
        [gapPt.x, gapPt.y]
      ]);

      // Handle third point if present
      if (pts.length === 3) {
        const thirdPt = pts[2];

        const midPt2 = GeoTools.getMidPoint(thirdPt, secondPoint);
        const length2 = GeoTools._2PtLen(thirdPt, midPt2) / 3;
        const angle2 = this.toRad(-32); // -32 degrees

        const leftWing = new Point({
          x: midPt2.x + length2 * Math.cos(angle2),
          y: midPt2.y + length2 * Math.sin(angle2),
          spatialReference
        });

        const wingAngle2 = GeoTools.angleInRadians(leftWing, secondPoint);
        const gapPt2 = new Point({
          x: leftWing.x + length2 * 2 * Math.cos(wingAngle2),
          y: leftWing.y + length2 * 2 * Math.sin(wingAngle2),
          spatialReference
        });

        // Create second G symbol
        const baseLineLen2 = GeoTools._2PtLen(thirdPt, secondPoint);
        let cLenLimit2 = baseLineLen2 / 25;
        if (cLenLimit2 > baseLineLen2 / 3.6) cLenLimit2 = baseLineLen2 / 3.6;

        const cPt2 = new Point({
          x: gapPt2.x + cLenLimit2 * 1.5 * Math.cos(wingAngle2),
          y: gapPt2.y + cLenLimit2 * 1.5 * Math.sin(wingAngle2),
          spatialReference
        });

        const cPts2 = (Shapes as any).createG(cPt2.x, cPt2.y, cLenLimit2, spatialReference) as Point[];
        if (cPts2 && cPts2.length) {
          result.addPath(cPts2.map(p => [p.x, p.y]));
        }

        // Add second wing path
        result.addPath([
          [thirdPt.x, thirdPt.y],
          [midPt2.x, midPt2.y],
          [leftWing.x, leftWing.y],
          [gapPt2.x, gapPt2.y]
        ]);

        // Forward arrow head at third point
        const arrowLength2 = GeoTools.ArrowFlanksLen(GeoTools._2PtLen(secondPoint, thirdPt), GeoTools._2PtLen(secondPoint, thirdPt));
        const arrowAngle2 = GeoTools.angleInRadians(secondPoint, thirdPt);
        const arrowHead2 = (Shapes as any).arrowHead(thirdPt, arrowLength2, arrowAngle2) as Point[];
        if (arrowHead2 && arrowHead2.length) {
          result.addPath(arrowHead2.map(p => [p.x, p.y]));
        }
      }

      return result;

    } catch (e) {
      console.log(this.constructor.name + ' Cannot create Symbol due to invalid geometry');
      return null;
    }
  }


  /**
   * Convert degrees to radians
   */
  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /**
   * Clean up drawing state and finalize
   */
  private cleanUp(): void {
    if (this._points.length === 0) return;

    const drawEss = this.createDrawEssentials(this._points.slice(), this._echlon);

    if (this.tempGraphic && this.tempGraphic.geometry) {
      this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEss);
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
        // geographicGeometry = webMercatorUtils.webMercatorToGeographic(drawGeometry);
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


  /**
   * Get the current symbol layer
   */
  public getSymbolLayer(): GraphicsLayer {
    return this.symbolLayer;
  }

  /**
   * Clear all symbols from the layer
   */
  public clearSymbols(): void {
    this.symbolLayer.removeAll();
  }
}

export default Guard;