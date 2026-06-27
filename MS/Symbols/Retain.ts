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
export interface RetainOptions {
  CTRL_PTS?: Point[];
  GEOM?: Polyline;
  DRAW_TYPE?: number;

  [key: string]: any;
}

/**
 * Retain class for drawing the Retain tactical mission graphic on MapView or SceneView.
 * Based on Secure: a circular arc (from 3 control points) with a lettered gap and an
 * arrowhead/flap at the tail. Adds outward-radial teeth around the arc and an "R" at
 * the gap. The whole symbol is a single Polyline geometry (many paths).
 */
export class Retain {
  private view: MapView | SceneView;
  private layerManager: GraphicsLayerManager;
  private symbolLayer: GraphicsLayer;
  private isLine: boolean;

  public declaredClass: string = "MilitarySymbology.Symbols.Retain";
  public SID: string = "151205";
  public symName: string = "Retain";
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
    this.events = new SymbolEvents(view, "Retain");

    // Initialize layers if not already done
    this.layerManager.initializeLayers();

    // Initialize temporary graphic
    this.tempGraphic = new Graphic();
  }

  /**
   * Initialize the Retain drawing
   */
  public init(options: RetainOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void {
    this._lineSym = marker;

    // Set parameters from options
    this._drawType = GeoTools.setDefault(options, "DRAW_TYPE", this._drawType);
    this._tailFactor = GeoTools.setDefault(options, "TAIL_FACTOR", this._tailFactor);
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

    // For Retain, finish after 3 points (legacy behavior)
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
   * Create symbol geometry from DrawEssentials.
   * Single Polyline: arc (split for the lettered gap) + outward teeth + "R" + arrowhead flap.
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

      const startingPt = pts[0];
      const endPt = pts[1];

      if (pts.length === 2) {
        // Straight line for two points
        result.addPath([[startingPt.x, startingPt.y], [endPt.x, endPt.y]]);
        return result;
      }

      if (pts.length > 2) {
        const candidatePoint = pts[2];
        const numberOfPts = 60;

        // Compute circle in screen space and build arc in map space
        const sp1 = (this.view as any).toScreen(startingPt);
        const sp2 = (this.view as any).toScreen(endPt);
        const sp3 = (this.view as any).toScreen(candidatePoint);
        const circle = GeoTools.circleFromThreeScreenPoints(sp1, sp2, sp3);

        if (circle.radius > 0) {
          const values = Shapes.createCircleSegmentFromThreePoints(this.view as any, circle, sp1, sp2, sp3, numberOfPts);

          // Extract arc path (ring) and split with a gap.
          // createCircleSegmentFromThreePoints returns a Polyline -> use paths, not rings.
          const ring = (values.geometry as any).paths?.[0] as number[][];
          if (ring && ring.length >= numberOfPts + 1) {
            result.addPath(ring.slice(0, 25));
            result.addPath(ring.slice(35, numberOfPts + 1));

            // Create R at arc center section (in the gap). Use the STROKE variant:
            // single-path createR retraces itself and collapses in the 3D tessellator
            // (renders in 2D, breaks in 3D). createRStrokes returns clean, non-retracing
            // strokes — each added as its own path of this single Polyline geometry.
            const cPoint = new Point({ x: ring[30][0], y: ring[30][1], spatialReference });
            const arcP1 = new Point({ x: ring[25][0], y: ring[25][1], spatialReference });
            const arcP2 = new Point({ x: ring[35][0], y: ring[35][1], spatialReference });
            const baseLineLen = GeoTools._2PtLen(arcP1, arcP2);
            let cLenLimit = baseLineLen / 5;
            if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
            const rStrokes = Shapes.createRStrokes(cPoint.x, cPoint.y, cLenLimit, spatialReference);
            rStrokes.forEach(stroke => result.addPath(stroke.map(p => [p.x, p.y])));

            // Outward radial teeth around the arc (the Retain "sun" look). Use the
            // polyline extent center as the radial origin (matches Contain), but point
            // the teeth OUTWARD instead of inward. Skip the lettered gap (25..35).
            const centerPt = result.extent?.center;
            if (centerPt) {
              const center = new Point({ x: centerPt.x, y: centerPt.y, spatialReference });
              const teethSz = (GeoTools._2PtLen(endPt, center) / 10) * 2;
              const step = 2;
              for (let i = 2; i < 25; i += step) {
                const p = new Point({ x: ring[i][0], y: ring[i][1], spatialReference });
                result.addPath(this.createTeeth(p, GeoTools.angleInRadians(center, p), teethSz));
              }
              for (let i = 37; i <= numberOfPts - 2; i += step) {
                const p = new Point({ x: ring[i][0], y: ring[i][1], spatialReference });
                result.addPath(this.createTeeth(p, GeoTools.angleInRadians(center, p), teethSz));
              }
            }

            // Wings (flap) at end point. The arc ring is ordered by angle, so endPt
            // can be at either ring end depending on draw direction. Pick the ring end
            // nearest endPt and read the tangent from THAT end so the flap stays stable
            // (otherwise it wobbles as the direction changes).
            const length = GeoTools._2PtLen(endPt, cPoint) / 10;

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

            const baseAngle = GeoTools.twoPtsAngle(arcBackPt, arcTipPt);

            let angle = baseAngle < Math.PI ? baseAngle + 2.35619 : baseAngle - 2.35619; // ±135°
            const innerWing = new Point({
              x: endPt.x + length * Math.cos(angle),
              y: endPt.y + length * Math.sin(angle),
              spatialReference
            });

            angle = baseAngle > Math.PI ? baseAngle + 2.35619 : baseAngle - 2.35619;
            const outerWing = new Point({
              x: endPt.x + length * Math.cos(angle),
              y: endPt.y + length * Math.sin(angle),
              spatialReference
            });

            result.addPath([[innerWing.x, innerWing.y], [endPt.x, endPt.y]]);
            result.addPath([[outerWing.x, outerWing.y], [endPt.x, endPt.y]]);
          }
        }

        return result;
      }

      return result;
    } catch (e) {
      /* invalid geometry mid-draw is expected; ignore */
      return null;
    }
  }

  /**
   * Create one outward-pointing tooth as a 2-point path.
   * `angle` is the radial direction (center -> point); the tooth extends outward from the arc.
   */
  private createTeeth(startPt: Point, angle: number, teethSize: number): number[][] {
    const tip = [teethSize * Math.cos(angle) + startPt.x, teethSize * Math.sin(angle) + startPt.y];
    return [[startPt.x, startPt.y], tip];
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

export default Retain;
