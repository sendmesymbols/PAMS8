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

export interface ContainOptions {
  CTRL_PTS?: Point[];
  BASE_LN_PTS?: {startPt: Point, endPt: Point};
  GEOM?: Polyline;
  [key: string]: any;
}

/**
 * Contain class for drawing Contain tactical symbols
 * Uses baseline + control points
 * Returns Polyline geometry despite being classified as an Area symbol
 */
export class Contain {
  private view: MapView | SceneView;
  private layerManager: GraphicsLayerManager;
  private symbolLayer: GraphicsLayer;
  private isLine: boolean;

  // Symbol properties
  private SID: string = "340400";
  private symName: string = "Contain";
  private symGeometricType: string = "Area";

  private _lineSym: SimpleLineSymbol | null = null;
  private _points: Point[] = [];
  private _baseLinePts: any = {};
  private _geometryType: string | null = null;
  private amplifier: Amplifier;

  private _teethSize:number = 2;
  private _teethGap:number = 5;

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
   * Initialize the Contain drawing
   */
  public init(options: ContainOptions, marker: SimpleLineSymbol): void {
    this._lineSym = marker.clone();

    this._teethSize = 2;
    this._teethGap = 5;


    const drawEssentials = new DrawEssentials();

    this._teethSize = GeoTools.setDefault(options, "TEETH_SIZE", this._teethSize);
    this._teethGap = GeoTools.setDefault(options, "TEETH_GAP", this._teethGap);
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

      const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._teethSize, this._teethGap);
      if (this.tempGraphic && this.tempGraphic.geometry) {
        this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEss);
      }
      this._clear();

    } else if (options.hasOwnProperty("CTRL_PTS")) {
      // Immediate placement with control points only
      const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._teethSize, this._teethGap);
        const geometry = this.createSymbol(drawEss);
        if (geometry && this.tempGraphic) {
          this.tempGraphic.geometry = geometry;
          this.__drawEnd(geometry, drawEss);
          this._clear();
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
        currentPts: (evt.geometry as any).controlPoints || []
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
  private createDrawEssentials(ctrlPts: Point[], teethSize: number, teethGap: number): DrawEssentials {
    const drawEssentials = new DrawEssentials();
    drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
    drawEssentials.SID = this.SID;
    drawEssentials.SYM_NAME = this.symName;
    drawEssentials.GEOM = null;
    drawEssentials.AMPLIFIER = this.amplifier.toString();

    // Store additional properties
    (drawEssentials as any).SCOPE = this;
    (drawEssentials as any).CTRL_PTS = ctrlPts;
    (drawEssentials as any).TEETH_SIZE = teethSize;
    (drawEssentials as any).TEETH_GAP = teethGap;


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

      const result = new Polyline({ spatialReference });

      // pts[0] = startingPt, pts[1] = endPt
      const startingPt = pts[0];
      const endPt = pts[1];

      if (pts.length === 2) {
        // Simple line between two points
        result.addPath([[startingPt.x, startingPt.y], [endPt.x, endPt.y]]);
      } else if (pts.length === 3) {
        // Arc with candidate point - matches legacy exactly
        const candidatePoint = pts[2];
        
        // Build circle from three points in screen space
        const stScr = (this.view as any).toScreen(startingPt);
        const endScr = (this.view as any).toScreen(endPt);
        const candScr = (this.view as any).toScreen(candidatePoint);
        if (!stScr || !endScr || !candScr) return null;

        const circle = GeoTools.circleFromThreeScreenPoints(stScr, endScr, candScr);
        if (circle.radius > 0) {
          const values = this.CreateCircleSegmentFromThreePoints(circle, stScr, endScr, candScr, 60, this.view as any);
          const paths = values.geometry.paths[0] as number[][];
          if (paths && paths.length >= 60) {
            result.addPath(paths.slice(0, 28));
            result.addPath(paths.slice(32, 60));

            // Create C
            const cPoint = new Point({ x: paths[30][0], y: paths[30][1], spatialReference });
            const firstPoint = new Point({ x: paths[28][0], y: paths[28][1], spatialReference });
            const secondPoint = new Point({ x: paths[32][0], y: paths[32][1], spatialReference });
            const baseLineLen = GeoTools._2PtLen(firstPoint, secondPoint);
            let cLenLimit = baseLineLen / 5;
        if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
            const cPts: Point[] = (Shapes as any).createCC(cPoint.x, cPoint.y, cLenLimit, spatialReference) || [];
            if (cPts.length) result.addPath(cPts.map(p => [p.x, p.y]));

            // Teeth
            const centerPt = result.extent?.center;
            if (centerPt) {
              const center = new Point({ x: centerPt.x, y: centerPt.y, spatialReference });
              const length = GeoTools._2PtLen(endPt, center) / 10;
              const teethSize = length * GeoTools.setDefault(drawEssentials as any, "TEETH_SIZE", this._teethSize);
              const teethGap = GeoTools.setDefault(drawEssentials as any, "TEETH_GAP", this._teethGap);

              for (let i = teethGap; i < 28 && i < paths.length; i += teethGap) {
                const p = new Point({ x: paths[i][0], y: paths[i][1], spatialReference });
                const ang = GeoTools.angleInRadians(center, p);
                result.addPath(this.createTeeth(p, ang, teethSize));
              }

              for (let i = teethGap; i < 28 && i < (paths.length - 32); i += teethGap) {
                const idx = i + 32;
                if (idx < paths.length) {
                  const p = new Point({ x: paths[idx][0], y: paths[idx][1], spatialReference });
                  const ang = GeoTools.angleInRadians(center, p);
                  result.addPath(this.createTeeth(p, ang, teethSize));
                }
              }
            }
          }
        }
      } else if (pts.length > 3) {
        // Multiple control points - more complex logic from legacy
        const candidatePoint = pts[2];
        const lastPt = pts[pts.length - 1];
        const secLastPt = pts[pts.length - 2];

        // Same arc logic as 3-point case
        const stScr = (this.view as any).toScreen(startingPt);
        const endScr = (this.view as any).toScreen(endPt);
        const candScr = (this.view as any).toScreen(candidatePoint);
        if (!stScr || !endScr || !candScr) return null;

        const circle = GeoTools.circleFromThreeScreenPoints(stScr, endScr, candScr);
        if (circle.radius > 0) {
          const values = this.CreateCircleSegmentFromThreePoints(circle, stScr, endScr, candScr, 60, this.view as any);
          const paths = values.geometry.paths[0] as number[][];
          if (paths && paths.length >= 60) {
            result.addPath(paths.slice(0, 28));
            result.addPath(paths.slice(32, 60));

            // Create C
            const cPoint = new Point({ x: paths[30][0], y: paths[30][1], spatialReference });
            const firstPoint = new Point({ x: paths[28][0], y: paths[28][1], spatialReference });
            const secondPoint = new Point({ x: paths[32][0], y: paths[32][1], spatialReference });
            const baseLineLen = GeoTools._2PtLen(firstPoint, secondPoint);
            let cLenLimit = baseLineLen / 5;
            if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
            const cPts: Point[] = (Shapes as any).createCC(cPoint.x, cPoint.y, cLenLimit, spatialReference) || [];
            if (cPts.length) result.addPath(cPts.map(p => [p.x, p.y]));

            // Teeth
            const centerPt = result.extent?.center;
            if (centerPt) {
              const center = new Point({ x: centerPt.x, y: centerPt.y, spatialReference });
              const length = GeoTools._2PtLen(endPt, center) / 10;
              const teethSize = length * GeoTools.setDefault(drawEssentials as any, "TEETH_SIZE", this._teethSize);
              const teethGap = GeoTools.setDefault(drawEssentials as any, "TEETH_GAP", this._teethGap);

              for (let i = teethGap; i < 28 && i < paths.length; i += teethGap) {
                const p = new Point({ x: paths[i][0], y: paths[i][1], spatialReference });
                const ang = GeoTools.angleInRadians(center, p);
                result.addPath(this.createTeeth(p, ang, teethSize));
              }

              for (let i = teethGap; i < 28 && i < (paths.length - 32); i += teethGap) {
                const idx = i + 32;
                if (idx < paths.length) {
                  const p = new Point({ x: paths[idx][0], y: paths[idx][1], spatialReference });
                  const ang = GeoTools.angleInRadians(center, p);
                  result.addPath(this.createTeeth(p, ang, teethSize));
                }
              }

              // Additional fracture logic for pts[3..n]
              const fracturePoints: Point[] = [center];
              for (let i = 3; i < pts.length - 1; i++) {
                fracturePoints.push(pts[i]);
              }
              fracturePoints.push(lastPt);

              const fractureValues = (GeoTools as any)._fracture(fracturePoints, 10, spatialReference);
              if (fractureValues && fractureValues.geometry) {
                const fracPaths = (fractureValues.geometry as Polyline).paths as number[][][];
                fracPaths.forEach(p => result.addPath(p));

                const baseLineLen = GeoTools._2PtLen(startingPt, lastPt);
                for (let i = 0; i < fractureValues.midPoints.length; i++) {
                  let cLenLimit = fractureValues.midPoints[i].len / 2;
                  if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
                  const enyPaths = (Shapes as any).createENY(fractureValues.midPoints[i].midPt.x, fractureValues.midPoints[i].midPt.y, cLenLimit, spatialReference) || [];
                  for (let j = 0; j < enyPaths.length; j++) {
                    result.addPath(enyPaths[j].map((p: Point) => [p.x, p.y]));
                  }
                }
              }

              // Arrow Head
              const arrowLen = GeoTools.ArrowFlanksLen(GeoTools._2PtLen(center, pts[3]), GeoTools._2PtLen(lastPt, secLastPt));
              const angle = GeoTools.angleInRadians(center, pts[3]);
              const arrow = (Shapes as any).arrowHeadBackward(center, arrowLen, angle) as Point[];
              if (arrow && arrow.length) {
                result.addPath(arrow.map(p => [p.x, p.y]));
              }
            }
          }
        }
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

  private createTeeth(startPt: Point, angle: number, teethSize: number): number[][] {
    const midPtTwrdsCntr = [
      startPt.x - teethSize * Math.cos(angle),
      startPt.y - teethSize * Math.sin(angle)
    ];
    return [[startPt.x, startPt.y], midPtTwrdsCntr];
  }

  /**
   * Create circle segment from three points (ported from legacy)
   */
  private CreateCircleSegmentFromThreePoints(
    circle: { radius: number; center: { x: number; y: number } },
    pt1: any,
    pt2: any, 
    pt3: any,
    numberOfPts: number,
    view: any
  ): { geometry: Polyline; lastPoint: Point; backPoint: Point } {
    const center = circle.center;
    const radius = circle.radius;
    const path: Point[] = [];

    // Adjust points relative to center
    pt1.x -= center.x;
    pt1.y -= center.y;
    pt2.x -= center.x;
    pt2.y -= center.y;
    pt3.x -= center.x;
    pt3.y -= center.y;

    // Calculate angles
    let anglePt1 = Math.atan2(pt1.y, pt1.x);
    let anglePt2 = Math.atan2(pt2.y, pt2.x);
    let anglePt3 = Math.atan2(pt3.y, pt3.x);

    // Normalize angles to 0-2π
    anglePt1 = anglePt1 < 0 ? 2 * Math.PI + anglePt1 : anglePt1;
    anglePt2 = anglePt2 < 0 ? 2 * Math.PI + anglePt2 : anglePt2;
    anglePt3 = anglePt3 < 0 ? 2 * Math.PI + anglePt3 : anglePt3;

    const startAngle = Math.min(anglePt1, anglePt2);
    const endAngle = Math.max(anglePt1, anglePt2);
    let swipeAngle = endAngle - startAngle;

    if (anglePt3 < startAngle || anglePt3 > endAngle) {
      swipeAngle -= (2 * Math.PI);
    }

    const angle = swipeAngle / numberOfPts;

    for (let i = 0; i <= numberOfPts; i++) {
      const screenPt = {
        x: radius * Math.cos(startAngle + i * angle) + center.x,
        y: radius * Math.sin(startAngle + i * angle) + center.y
      };
      const mapPt = view.toMap(screenPt);
      path.push(mapPt);
    }

    const result = new Polyline({ spatialReference: view.spatialReference });
    result.addPath(path.map(p => [p.x, p.y]));

    return {
      geometry: result,
      lastPoint: path[numberOfPts],
      backPoint: path[numberOfPts - 5]
    };
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

    const drawEssentials = this.createDrawEssentials(this._points.slice(), this._teethSize, this._teethGap);

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

export default Contain;