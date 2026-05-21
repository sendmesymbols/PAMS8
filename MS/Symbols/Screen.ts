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
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";

import SymbolEvents from "../Support/SymbolEvents";
export interface ScreenOptions {
  CTRL_PTS?: Point[];
  GEOM?: Polyline;
  ECHLON?: number;
  [key: string]: any;
}

/**
 * Screen class for drawing Screen tactical symbols
 * Uses direct click drawing (up to 3 points) with arrow heads and S-curves
 * Returns Polyline geometry despite being classified as an Area symbol
 */
export class Screen {
  private view: MapView | SceneView;
  private layerManager: GraphicsLayerManager;
  private symbolLayer: GraphicsLayer;
  private isLine: boolean;

  // Symbol properties
  public declaredClass: string = "MilitarySymbology.Symbols.Screen";
  public SID: string = "342203";
  public symName: string = "Screen";
  public symGeometricType: string = "Area";

  private _lineSym: SimpleLineSymbol | null = null;
  private _points: Point[] = [];
  private _geometryType: string | null = null;
  private _echlon: number = 0;
  private amplifier: Amplifier;

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
    this.events = new SymbolEvents(view, "Screen");

    // Initialize layers if not already done
    this.layerManager.initializeLayers();

    // Initialize temporary graphic
    this.tempGraphic = new Graphic();
  }

  /**
   * Initialize the Screen drawing
   */
  public init(options: ScreenOptions, marker: SimpleLineSymbol): void {
    this._lineSym = marker;

    this._echlon = options.ECHLON || 0;

    if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
      // Immediate placement with both control points and geometry
      if (options.GEOM && this.tempGraphic) {
        try {
          this.tempGraphic.geometry = (options.GEOM instanceof Polyline)
            ? options.GEOM
            : new Polyline({ paths: (options.GEOM as any), spatialReference: this.view.spatialReference });
        } catch (error) {
          console.error(this.symName, "Failed to create Polyline geometry:", error);
        }
      }

      const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.ECHLON || 0);
      if (this.tempGraphic && this.tempGraphic.geometry) {
        this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEss);
      }
      this._clear();

    } else if (options.hasOwnProperty("CTRL_PTS")) {
      // Immediate placement with control points only
      const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.ECHLON || 0);
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

    // Set up click handler
    this.clickHandler = this.view.on("click", (event) => {
      this._onClickHandler(event);
    });

    // Set up double click handler
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

    // Start mouse move after first click
    if (this._points.length === 1) {
      this.mouseMoveHandler = this.view.on("pointer-move", (event) => {
        this._onMouseMoveHandler(event);
      });
    }

    this.events.emit("onDrawClick", { currentPts: this._points });

    // Auto-complete after 3 clicks
    if (this._points.length === 3) {
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
    if (!this.tempGraphic) return;

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
  private createDrawEssentials(ctrlPts: Point[], echlon: number): DrawEssentials {
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
   * Create symbol geometry from DrawEssentials
   */
  private createSymbol(drawEssentials: DrawEssentials): Polyline | null {
    try {
      const spatialReference = this.view.spatialReference;
      const pts: Point[] = (drawEssentials as any).CTRL_PTS;
      if (!pts || pts.length === 0) throw new Error("controlPoints not found");

      const firstPoint = pts[0];
      const secondPoint = pts[1];
      if (!firstPoint || !secondPoint) throw new Error("Start and end points are required");

      const result = new Polyline({ spatialReference });

      // Arrow head at the first point (backward)
      const baseLen12 = GeoTools._2PtLen(firstPoint, secondPoint);
      const ahLen1 = GeoTools.ArrowFlanksLen(baseLen12, baseLen12);
      const ah1 = (Shapes as any).arrowHeadBackward(
        firstPoint,
        ahLen1,
        GeoTools.angleInRadians(firstPoint, secondPoint)
      ) as Point[];
      if (ah1 && ah1.length) {
        result.addPath(ah1.map(p => [p.x, p.y]));
      }

      // Midpoint and right wing construction
      let midPt = GeoTools.getMidPoint(firstPoint, secondPoint);
      let length = GeoTools._2PtLen(firstPoint, midPt) / 3;
      let angleVal = GeoTools.toDegrees(16); // In Degrees (legacy: GeoTools.toDegrees(16))

      const rightWing = new Point({
        x: midPt.x + length * Math.cos(this.toRad(angleVal)),
        y: midPt.y + length * Math.sin(this.toRad(angleVal)),
        spatialReference
      });

      let angle = GeoTools.angleInRadians(rightWing, secondPoint);
      let gapPt = new Point({
        x: rightWing.x + length * 2 * Math.cos(angle),
        y: rightWing.y + length * 2 * Math.sin(angle),
        spatialReference
      });

      // Create S near the gap
      let baseLineLen = GeoTools._2PtLen(firstPoint, secondPoint);
      let cLenLimit = baseLineLen / 25;
      if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;

      let cPt = new Point({
        x: gapPt.x + cLenLimit * 1.5 * Math.cos(angle),
        y: gapPt.y + cLenLimit * 1.5 * Math.sin(angle),
        spatialReference
      });

      const sPts1: Point[] = (Shapes as any).createS(cPt.x, cPt.y, cLenLimit, spatialReference) || [];
      if (sPts1.length) result.addPath(sPts1.map(p => [p.x, p.y]));

      // Stem from first point through midpoint to gap
      result.addPath([
        [firstPoint.x, firstPoint.y],
        [midPt.x, midPt.y],
        [rightWing.x, rightWing.y],
        [gapPt.x, gapPt.y]
      ]);

      // If third control point exists, mirror logic on the other side and add forward arrow
      if (pts.length === 3) {
        const thirdPt = pts[2];

        midPt = GeoTools.getMidPoint(thirdPt, secondPoint);
        length = GeoTools._2PtLen(thirdPt, midPt) / 3;
        angleVal = GeoTools.toDegrees(-32); // In Degrees

        const leftWing = new Point({
          x: midPt.x + length * Math.cos(GeoTools.toRad(angleVal)),
          y: midPt.y + length * Math.sin(GeoTools.toRad(angleVal)),
          spatialReference
        });

        angle = GeoTools.angleInRadians(leftWing, secondPoint);
        gapPt = new Point({
          x: leftWing.x + length * 2 * Math.cos(angle),
          y: leftWing.y + length * 2 * Math.sin(angle),
          spatialReference
        });

        // Create S
        baseLineLen = GeoTools._2PtLen(thirdPt, secondPoint);
        cLenLimit = baseLineLen / 25;
        if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;

        cPt = new Point({
          x: gapPt.x + cLenLimit * 1.5 * Math.cos(angle),
          y: gapPt.y + cLenLimit * 1.5 * Math.sin(angle),
          spatialReference
        });

        const sPts2: Point[] = (Shapes as any).createS(cPt.x, cPt.y, cLenLimit, spatialReference) || [];
        if (sPts2.length) result.addPath(sPts2.map(p => [p.x, p.y]));

        // Stem from third point through midpoint to gap
        result.addPath([
          [thirdPt.x, thirdPt.y],
          [midPt.x, midPt.y],
          [leftWing.x, leftWing.y],
          [gapPt.x, gapPt.y]
        ]);

        // Arrow head at the third point (forward)
        const ahLen2 = GeoTools.ArrowFlanksLen(
          GeoTools._2PtLen(secondPoint, thirdPt),
          GeoTools._2PtLen(secondPoint, thirdPt)
        );
        const ah2 = (Shapes as any).arrowHead(
          thirdPt,
          ahLen2,
          GeoTools.angleInRadians(secondPoint, thirdPt)
        ) as Point[];
        if (ah2 && ah2.length) {
          result.addPath(ah2.map(p => [p.x, p.y]));
        }
      }

      return result;
    } catch (e) {
      console.log(this.declaredClass + ' Cannot create Symbol due to invalid geometry');
      return null;
    }
  }

  /**
   * Convert degrees to radians (legacy helper matching JS source)
   */
  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /**
   * Clean up drawing state and finalize
   */
  private cleanUp(): void {
    if (this._points.length === 0) return;

    const drawEssentials = this.createDrawEssentials(this._points.slice(), this._echlon);

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

export default Screen;