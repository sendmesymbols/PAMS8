import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polyline from '@arcgis/core/geometry/Polyline';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import GraphicsLayerManager, {
  LAYER_NAMES,
} from '../Managers/GraphicsLayerManager';
import DrawEssentials from '../Support/DrawEssentials';
import Amplifier from '../Support/Amplifier';
import GeoTools from '../Support/GeoTools.ts';
import Shapes from '../Support/Shapes.ts';
import BaseLine from '../Support/BaseLine.ts';

import SymbolEvents from "../Support/SymbolEvents";
export interface WithdrawOptions {
  ECHLON?: number;
  CTRL_PTS?: Point[];
  GEOM?: Polyline;
  [key: string]: any;
}

/**
 * WithdrawUnderPressure class for drawing WithdrawUnderPressure tactical symbols
 * Uses baseline + control points pattern with arc and arrow
 * Returns Polyline geometry despite being classified as an Area symbol
 */
export class WithdrawUnderPressure {
  private view: MapView | SceneView;
  private layerManager: GraphicsLayerManager;
  private symbolLayer: GraphicsLayer;
  private isLine: boolean;

  // Symbol properties
  public declaredClass: string = 'MilitarySymbology.Symbols.WithdrawUnderPressure';
  public SID: string = '342500';
  public symName: string = 'WithdrawUnderPressure';
  public symGeometricType: string = 'Area';

  private _lineSym: SimpleLineSymbol | null = null;
  private _points: Point[] = [];
  private _geometryType: any = null;
  private _arrowHeadRatio: any;
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

  private toXYPath(path: any[]): number[][] {
    return path.map((pt: any) => {
      if (Array.isArray(pt) && pt.length >= 2) {
        return [pt[0], pt[1]];
      }
      if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') {
        return [pt.x, pt.y];
      }
      throw new Error('Invalid path point');
    });
  }

  constructor(view: MapView | SceneView, isLine: boolean = false) {
    this.view = view;
    this.isLine = isLine;
    this.layerManager = GraphicsLayerManager.getInstance(view);
    this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.TACT);
    this.amplifier = new Amplifier();
    this.events = new SymbolEvents(view, "WithdrawUnderPressure");

    this.layerManager.initializeLayers();

    this.tempGraphic = new Graphic();
  }

  public init(options: WithdrawOptions, marker: SimpleLineSymbol): void {
    this._lineSym = marker.clone();

    //(this.view as any).navigation.setImmediateClick(false);
    //(this.view as any).disableDoubleClickZoom();

    this._echlon = options.ECHLON || 0;
    if (options.hasOwnProperty('CTRL_PTS') && options.hasOwnProperty('GEOM') && options.GEOM !== null) {
      // Immediate placement with both control points and geometry
      if (!this.tempGraphic) {
        this.tempGraphic = new Graphic({ symbol: this._lineSym });
      }
      if (options.GEOM && this.tempGraphic) {
        try {
          this.tempGraphic.geometry = (options.GEOM instanceof Polyline)
            ? options.GEOM
            : new Polyline({ paths: (options.GEOM as any), spatialReference: this.view.spatialReference });
        } catch (error) {
          console.error(this.symName, "Failed to create Polyline geometry:", error);
        }
      }

      const drawEss = this.createDrawEssentials(
        options.CTRL_PTS!.slice(),
        options.ECHLON || 0,
      );
      if (this.tempGraphic && this.tempGraphic.geometry) {
        this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEss);
      }
      this._clear();
    } else if (options.hasOwnProperty('CTRL_PTS')) {
      // Immediate placement with control points only
      if (!this.tempGraphic) {
        this.tempGraphic = new Graphic({ symbol: this._lineSym });
      }
      const drawEss = this.createDrawEssentials(
        options.CTRL_PTS!.slice(),
        options.ECHLON || 0,
      );
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

    this.setupEventHandlers();
  }

  /**
   * Set up event handlers for interactive drawing
   */
  private setupEventHandlers(): void {
    this.clickHandler = this.view.on('click', (event) => {
      this._onClickHandler(event);
    });

    this.doubleClickHandler = this.view.on('double-click', (event) => {
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
      spatialReference: this.view.spatialReference,
    });

    this._points.push(point);

    if (this._points.length === 1) {
      this.mouseMoveHandler = this.view.on('pointer-move', (event) => {
        this._onMouseMoveHandler(event);
      });
    }

    this.events.emit('onDrawClick', { currentPts: this._points });

    if (this.isLine === true && this._points.length === 1) {
      this.events.emit('onDrawClick', { currentPts: this._points });
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
      spatialReference: this.view.spatialReference,
    });

    this._points.push(point);
    this.cleanUp();
  }

  private find_angle(p0: Point, p1: Point, c: Point): number {
    var p0c = Math.sqrt(Math.pow(c.x - p0.x, 2) + Math.pow(c.y - p0.y, 2));
    var p1c = Math.sqrt(Math.pow(c.x - p1.x, 2) + Math.pow(c.y - p1.y, 2));
    var p0p1 = Math.sqrt(Math.pow(p1.x - p0.x, 2) + Math.pow(p1.y - p0.y, 2));
    return Math.acos((p1c * p1c + p0c * p0c - p0p1 * p0p1) / (2 * p1c * p0c));
  }

  private angleBetweenTwoPointsWithFixedPoint(
    point1X: number,
    point1Y: number,
    point2X: number,
    point2Y: number,
    fixedX: number,
    fixedY: number,
  ): number {
    var angle1 = Math.atan2(point1Y - fixedY, point1X - fixedX);
    var angle2 = Math.atan2(point2Y - fixedY, point2X - fixedX);
    return angle1 - angle2;
  }

  private createDrawEssentials(
    ctrlPts: Point[],
    echlon: number,
  ): DrawEssentials {
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
      var pts: Point[], arrowHeadRatio: number;

      if ((drawEssentials as any).hasOwnProperty('CTRL_PTS')) {
        pts = (drawEssentials as any).CTRL_PTS;
      } else {
        throw 'controlPoints not found';
      }

      var result = new Polyline({ spatialReference: this.view.spatialReference });

      var startingPt = pts[0];
      var endPt = pts[1];
      if (!startingPt || !endPt) return result;

      if (pts.length === 2) {
        result.addPath(this.toXYPath([startingPt, endPt]));
      } else if (pts.length === 3) {
        var candidatePoint = pts[2];
        var values: any;
        var paths: any[] = [];
        var circle = this._circleDrawEx(
          (this.view as any).toScreen(startingPt),
          (this.view as any).toScreen(endPt),
          (this.view as any).toScreen(candidatePoint),
        );
        if (circle.radius > 0) {
          values = this.CreateCircleSegmentFromThreePoints(
            circle,
            (this.view as any).toScreen(startingPt),
            (this.view as any).toScreen(endPt),
            (this.view as any).toScreen(candidatePoint),
            60,
            this.view,
          );
          paths = values.geometry.paths[0];
          result.addPath(this.toXYPath(paths.slice(0, 60)));
        }
      } else if (pts.length > 3) {
        var candidatePoint = pts[2];
        var lastPt = pts[pts.length - 1];
        var secLastPt = pts[pts.length - 2];

        var values: any;
        var paths: any[] = [];
        var circle = this._circleDrawEx(
          (this.view as any).toScreen(startingPt),
          (this.view as any).toScreen(endPt),
          (this.view as any).toScreen(candidatePoint),
        );
        if (circle.radius > 0) {
          values = this.CreateCircleSegmentFromThreePoints(
            circle,
            (this.view as any).toScreen(startingPt),
            (this.view as any).toScreen(endPt),
            (this.view as any).toScreen(candidatePoint),
            60,
            this.view,
          );
          paths = values.geometry.paths[0];
          result.addPath(this.toXYPath(paths.slice(0, 60)));
        }
        paths = [];
        paths.push(result.getPoint(0, 0));

        for (var i = 3; i < pts.length - 1; i++) {
          paths.push(pts[i]);
        }
        paths = paths.concat(lastPt);

        values = GeoTools._fracture(paths, 10, this.view.spatialReference);
        result.paths = result.paths.concat(values.geometry.paths);
        var cLenLimit: number;
        var baseLineLen = GeoTools._2PtLen(startingPt, lastPt);
        for (var i = 0; i < values.midPoints.length; i++) {
          cLenLimit = values.midPoints[i].len / 2;
          if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
          const wpPaths = Shapes.createWP(
            values.midPoints[i].midPt.x,
            values.midPoints[i].midPt.y,
            cLenLimit,
            this.view.spatialReference,
          );
          for (let j = 0; j < wpPaths.length; j++) {
            result.addPath(this.toXYPath(wpPaths[j]));
          }
        }

        result.addPath(
          this.toXYPath(Shapes.arrowHead(
            lastPt,
            GeoTools.ArrowFlanksLen(
              GeoTools._2PtLen(secLastPt, lastPt),
              GeoTools._2PtLen(startingPt, lastPt),
            ),
            GeoTools.angleInRadians(secLastPt, lastPt),
          )),
        );
      }

      return result;
    } catch (e) {
      console.log(
        this.declaredClass + ' Cannot create Symbol due to invalid geometry',
      );
      return new Polyline({ spatialReference: this.view.spatialReference });
    }
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
      spatialReference: this.view.spatialReference,
    });

    const drawEssentials = new DrawEssentials();
    (drawEssentials as any).CTRL_PTS = this._points.concat([candidatePoint]);
    (drawEssentials as any).ECHLON = this._echlon;

    const geometry = this.createSymbol(drawEssentials);
    if (geometry) {
      this.tempGraphic.geometry = geometry;
      this.events.emit('onDrawProgress', {
        currentGeometry: geometry,
        currentDrawEssentials: drawEssentials,
        currentMarker: this._lineSym,
      });
    }
  }

  /**
   * Clean up drawing state and finalize
   */
  private cleanUp(): void {
    if (this._points.length === 0) return;

    const drawEssentials = this.createDrawEssentials(
      this._points.slice(),
      this._echlon,
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
  private __drawEnd(
    drawGeometry: Polyline,
    drawEssentials: DrawEssentials,
  ): void {
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
  private __onDrawEnd(
    geometry: Polyline,
    geoGeometry: Polyline,
    drawEssParam: DrawEssentials,
  ): void {
    this.events.emit('onDrawEnd', {
      geometry: geometry,
      geographicGeometry: geoGeometry,
      drawEssentials: drawEssParam,
      marker: this._lineSym,
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

    //(this.view as any).enableDoubleClickZoom();
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

  private _circleDrawEx(pt1: any, pt2: any, pt3: any): any {
    var i: number;
    var r: number, m11: number, m12: number, m13: number, m14: number;
    var a = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    var P = [
      [pt1.x, pt1.y],
      [pt2.x, pt2.y],
      [pt3.x, pt3.y],
    ];

    for (i = 0; i < 3; i++) {
      a[i][0] = P[i][0];
      a[i][1] = P[i][1];
      a[i][2] = 1;
    }
    m11 = this._determinantDrawEx(a, 3);

    for (i = 0; i < 3; i++) {
      a[i][0] = P[i][0] * P[i][0] + P[i][1] * P[i][1];
      a[i][1] = P[i][1];
      a[i][2] = 1;
    }
    m12 = this._determinantDrawEx(a, 3);

    for (i = 0; i < 3; i++) {
      a[i][0] = P[i][0] * P[i][0] + P[i][1] * P[i][1];
      a[i][1] = P[i][0];
      a[i][2] = 1;
    }
    m13 = this._determinantDrawEx(a, 3);

    for (i = 0; i < 3; i++) {
      a[i][0] = P[i][0] * P[i][0] + P[i][1] * P[i][1];
      a[i][1] = P[i][0];
      a[i][2] = P[i][1];
    }
    m14 = this._determinantDrawEx(a, 3);

    if (m11 == 0) {
      r = 0;
    } else {
      var Xo = (0.5 * m12) / m11;
      var Yo = (-0.5 * m13) / m11;
      r = Math.sqrt(Xo * Xo + Yo * Yo + m14 / m11);
    }

    return { radius: r, center: { x: Xo, y: Yo } };
  }

  private _determinantDrawEx(a: number[][], n: number): number {
    var i: number, j: number, j1: number, j2: number;
    var d = 0;
    var m = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];

    if (n == 2) {
      d = a[0][0] * a[1][1] - a[1][0] * a[0][1];
    } else {
      d = 0;
      for (j1 = 0; j1 < n; j1++) {
        for (i = 1; i < n; i++) {
          j2 = 0;
          for (j = 0; j < n; j++) {
            if (j == j1) continue;
            m[i - 1][j2] = a[i][j];
            j2++;
          }
        }
        d =
          d + Math.pow(-1.0, j1) * a[0][j1] * this._determinantDrawEx(m, n - 1);
      }
    }

    return d;
  }

  private CreateCircleSegmentFromThreePoints(
    circle: any,
    pt1: any,
    pt2: any,
    pt3: any,
    numberOfPts: number,
    view: MapView | SceneView,
  ): any {
    var center = circle.center,
      radius = circle.radius,
      path: any[] = [];
    pt1.x -= center.x;
    pt1.y -= center.y;
    pt2.x -= center.x;
    pt2.y -= center.y;
    pt3.x -= center.x;
    pt3.y -= center.y;
    var anglePt1 = Math.atan2(pt1.y, pt1.x),
      anglePt2 = Math.atan2(pt2.y, pt2.x),
      anglePt3 = Math.atan2(pt3.y, pt3.x);
    anglePt1 = anglePt1 < 0 ? 2 * Math.PI + anglePt1 : anglePt1;
    anglePt2 = anglePt2 < 0 ? 2 * Math.PI + anglePt2 : anglePt2;
    anglePt3 = anglePt3 < 0 ? 2 * Math.PI + anglePt3 : anglePt3;
    var startAngle = Math.min(anglePt1, anglePt2);
    var endAngle = Math.max(anglePt1, anglePt2);
    var swipeAngle = endAngle - startAngle;
    if (anglePt3 < startAngle || anglePt3 > endAngle) {
      swipeAngle -= 2 * Math.PI;
    }
    var angle = swipeAngle / numberOfPts,
      pt: any;

    for (var i = 0; i <= numberOfPts; i++) {
      pt = (view as any).toMap({
        x: radius * Math.cos(startAngle + i * angle) + center.x,
        y: radius * Math.sin(startAngle + i * angle) + center.y,
      });
      path.push(pt);
    }

    var result = new Polyline({ spatialReference: view.spatialReference });
    result.addPath(this.toXYPath(path));

    return {
      geometry: result,
      lastPoint: path[numberOfPts],
      backPoint: path[numberOfPts - 5],
    };
  }
}

export default WithdrawUnderPressure;
