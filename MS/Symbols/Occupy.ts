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
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";

import SymbolEvents from "../Support/SymbolEvents";
export interface OccupyOptions {
  CTRL_PTS?: Point[];
  GEOM?: Polyline;
  ECHLON?: number;
  [key: string]: any;
}

/**
 * Class Representing Occupy.
 * Direct click drawing (up to 3 points) with arc, "O" marker, and caret wings.
 */
export class Occupy {
  private view: MapView | SceneView;
  private layerManager: GraphicsLayerManager;
  private symbolLayer: GraphicsLayer;
  private isLine: boolean;

  // Symbol properties
  public declaredClass: string = "MilitarySymbology.Symbols.Occupy";
  public SID: string = "341700";
  public symName: string = "Occupy";
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
    this.events = new SymbolEvents(view, "Occupy");

    // Initialize layers if not already done
    this.layerManager.initializeLayers();

    // Initialize temporary graphic
    this.tempGraphic = new Graphic();
  }

  /**
   * Initialize the Occupy drawing
   */
  public init(options: OccupyOptions, marker: SimpleLineSymbol): void {
    this._lineSym = marker;

    this._echlon = options.ECHLON || 0;

    if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
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
      const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._echlon);
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

  private startInteractiveDrawing(): void {
    if (!this._lineSym) return;

    this.isDrawing = true;
    this.tempGraphic = new Graphic({
      geometry: null,
      symbol: this._lineSym
    });
    this.symbolLayer.add(this.tempGraphic);

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

  private createDrawEssentials(ctrlPts: Point[], echlon: number ): DrawEssentials {
    const drawEssentials = new DrawEssentials();
    drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
    drawEssentials.SID = this.SID;
    drawEssentials.SYM_NAME = this.symName;
    drawEssentials.AMPLIFIER = this.amplifier.toString();

    (drawEssentials as any).SCOPE = this;
    (drawEssentials as any).CTRL_PTS = ctrlPts;
    (drawEssentials as any).ECHLON = echlon;

    return drawEssentials;
  }



  private createSymbol(drawEssentials: DrawEssentials): Polyline | null {
    try {
      const spatialReference = this.view.spatialReference;
      const pts: Point[] = (drawEssentials as any).CTRL_PTS;
      if (!pts || pts.length === 0) throw new Error("controlPoints not found");

      const result = new Polyline({ spatialReference });
      const startingPt = pts[0];
      const endPt = pts[1];

      if (pts.length === 2) {
        result.addPath([[startingPt.x, startingPt.y], [endPt.x, endPt.y]]);

      } else if (pts.length > 2) {
        const candidatePoint = pts[2];

        // Build circle from three points in screen space
        const stScr = (this.view as any).toScreen(startingPt);
        const endScr = (this.view as any).toScreen(endPt);
        const candScr = (this.view as any).toScreen(candidatePoint);
        if (!stScr || !endScr || !candScr) return null;

        const circle = GeoTools.circleFromThreeScreenPoints(stScr, endScr, candScr);
        if (!circle || circle.radius <= 0) {
          result.addPath([[startingPt.x, startingPt.y], [endPt.x, endPt.y]]);
          return result;
        }

        const circleSeg = Shapes.createCircleSegmentFromThreePoints(this.view as any, circle, stScr, endScr, candScr, 60);
        const ring = (circleSeg.geometry as any).paths?.[0] as number[][];
        if (!ring || ring.length === 0) return null;

        // Split arc with a gap
        const firstArc = ring.slice(0, 25);
        const secondArc = ring.slice(35, 60);
        if (firstArc.length >= 2) result.addPath(firstArc);
        if (secondArc.length >= 2) result.addPath(secondArc);

        // Create O at the gap
        if (ring[30] && ring[25] && ring[35]) {
          const cPoint = new Point({ x: ring[30][0], y: ring[30][1], spatialReference });
          const firstPoint = new Point({ x: ring[25][0], y: ring[25][1], spatialReference });
          const secondPoint = new Point({ x: ring[35][0], y: ring[35][1], spatialReference });
          const baseLineLen = GeoTools._2PtLen(firstPoint, secondPoint);
          let cLenLimit = baseLineLen / 5;
          if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
          const oPts: Point[] = (Shapes as any).createO(cPoint.x, cPoint.y, cLenLimit, spatialReference) || [];
          if (oPts.length) result.addPath(oPts.map(p => [p.x, p.y]));
        }

        // Create wings (caret arrowhead) at endPt aligned to arc tangent
        if (endPt && ring.length >= 6) {
          const cPoint = new Point({ x: ring[30][0], y: ring[30][1], spatialReference });
          const length = GeoTools._2PtLen(endPt, cPoint) / 10;

          // Determine which end of the arc ring is near endPt
          const firstRingPt = new Point({ x: ring[0][0], y: ring[0][1], spatialReference });
          const lastRingPt = new Point({ x: ring[ring.length - 1][0], y: ring[ring.length - 1][1], spatialReference });

          let arcBackPt: Point;
          let arcTipPt: Point;

          if (GeoTools._2PtLen(endPt, lastRingPt) <= GeoTools._2PtLen(endPt, firstRingPt)) {
            const bi = Math.max(0, ring.length - 6);
            arcBackPt = new Point({ x: ring[bi][0], y: ring[bi][1], spatialReference });
            arcTipPt = lastRingPt;
          } else {
            const bi = Math.min(5, ring.length - 1);
            arcBackPt = new Point({ x: ring[bi][0], y: ring[bi][1], spatialReference });
            arcTipPt = firstRingPt;
          }

          // Inner wing
          let angle = GeoTools.twoPtsAngle(arcBackPt, arcTipPt);
          if (angle < Math.PI) angle += 2.35619; else angle -= 2.35619;
          const innerWing = [endPt.x + length * Math.cos(angle), endPt.y + length * Math.sin(angle)];
          const innerWingPlus = [-1 * length * Math.cos(angle) + endPt.x, -1 * length * Math.sin(angle) + endPt.y];
          result.addPath([innerWingPlus, [endPt.x, endPt.y], innerWing]);

          // Outer wing
          angle = GeoTools.twoPtsAngle(arcBackPt, arcTipPt);
          if (angle > Math.PI) angle += 2.35619; else angle -= 2.35619;
          const outerWing = [endPt.x + length * Math.cos(angle), endPt.y + length * Math.sin(angle)];
          const outerWingPlus = [-1 * length * Math.cos(angle) + endPt.x, -1 * length * Math.sin(angle) + endPt.y];
          result.addPath([outerWingPlus, [endPt.x, endPt.y], outerWing]);
        }
      }

      return result;
    } catch (e) {
      /* invalid geometry mid-draw is expected; ignore */
      return null;
    }
  }

  private cleanUp(): void {
    if (this._points.length === 0) return;

    const drawEssentials = this.createDrawEssentials(this._points.slice(), this._echlon);

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

export default Occupy;