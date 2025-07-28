/**
 * Class Representing Delay.
 * @class
 * @author Abdul Razak
 */

import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import * as webMercatorUtils from "@arcgis/core/geometry/support/webMercatorUtils";
import * as jsonUtils from "@arcgis/core/geometry/support/jsonUtils";
import Evented from "@arcgis/core/core/Evented";

type ViewType = MapView | SceneView;

// Temporary utility classes
class GeoTools {
  static _2PtLen(pt1: Point, pt2: Point): number {
    return Math.sqrt(Math.pow(pt2.x - pt1.x, 2) + Math.pow(pt2.y - pt1.y, 2));
  }
  
  static _fracture(points: Point[], numberOfSegments: number, spatialRef: any): any {
    const result = new Polyline({ spatialReference: spatialRef });
    const midPoints: any[] = [];
    
    for (let i = 0; i < points.length - 1; i++) {
      const startPt = points[i];
      const endPt = points[i + 1];
      const segmentPoints: number[][] = [];
      
      for (let j = 0; j <= numberOfSegments; j++) {
        const ratio = j / numberOfSegments;
        const x = startPt.x + (endPt.x - startPt.x) * ratio;
        const y = startPt.y + (endPt.y - startPt.y) * ratio;
        segmentPoints.push([x, y]);
      }
      
      result.addPath(segmentPoints);
      
      // Add midpoint info
      const midX = (startPt.x + endPt.x) / 2;
      const midY = (startPt.y + endPt.y) / 2;
      const len = Math.sqrt(Math.pow(endPt.x - startPt.x, 2) + Math.pow(endPt.y - startPt.y, 2));
      
      midPoints.push({
        midPt: new Point({ x: midX, y: midY, spatialReference: spatialRef }),
        len: len
      });
    }
    
    return { geometry: result, midPoints: midPoints };
  }
  
  static ArrowFlanksLen(len1: number, len2: number): number {
    return Math.min(len1, len2) * 0.3;
  }
  
  static angleInRadians(pt1: Point, pt2: Point): number {
    return Math.atan2(pt2.y - pt1.y, pt2.x - pt1.x);
  }
}

class DrawEssentials {
  SCOPE?: any;
  SYM_GEO_TYPE?: string;
  SID?: string;
  SYM_NAME?: string;
  CTRL_PTS?: Point[];
  AMPLIFIER?: any;
  ECHLON?: number;
}

class Shapes {
  static createDD(x: number, y: number, size: number, spatialRef: any): number[][] {
    // Create DD shape - a double D
    const halfSize = size / 2;
    return [
      [x - halfSize, y],
      [x - halfSize/2, y + halfSize],
      [x + halfSize/2, y + halfSize],
      [x + halfSize, y],
      [x + halfSize/2, y - halfSize],
      [x - halfSize/2, y - halfSize],
      [x - halfSize, y]
    ];
  }
  
  static arrowHead(tip: Point, length: number, angle: number): number[][] {
    const angle1 = angle + Math.PI * 0.75;
    const angle2 = angle - Math.PI * 0.75;
    
    const pt1 = [
      tip.x + length * Math.cos(angle1),
      tip.y + length * Math.sin(angle1)
    ];
    
    const pt2 = [
      tip.x + length * Math.cos(angle2),
      tip.y + length * Math.sin(angle2)
    ];
    
    return [pt1, [tip.x, tip.y], pt2];
  }
}

interface DelayOptions {
  CTRL_PTS?: Point[];
  GEOM?: Polyline;
  ECHLON?: number;
}

export default class Delay extends Evented {
  public declaredClass: string = "MilitarySymbology.Symbols.Delay";
  public SID: string = "342400";
  public symName: string = "Delay";
  public symGeometricType: string = "Area";

  private view: ViewType;
  private isLine: boolean;
  private _lineSym: any;
  private _points: Point[] = [];
  private _geometryType: any = null;
  private _arrowHeadRatio: any;
  private _echlon: number = 0;
  private _tGraphic: Graphic;

  private _onClk: any;
  private _onDblClk: any;
  private _onMM: any;

  constructor(view: ViewType, isLine: boolean) {
    super();
    this.view = view;
    this.isLine = isLine;
    this._tGraphic = new Graphic();
  }

  public init(options: DelayOptions, marker: any): void {
    this._lineSym = marker;
    
    // Disable map navigation during drawing
    this.view.navigation.browserTouchPanEnabled = false;
    
    this._echlon = options.ECHLON || 0;

    const drawEssentials = new DrawEssentials();

    if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
      this._tGraphic.geometry = options.GEOM!;
      const drawEss = this.createDrawEssentials([...options.CTRL_PTS!], options.ECHLON);
      this.__drawEnd(this._tGraphic.geometry as Polyline, drawEss);
      this._clear();
    } else if (options.hasOwnProperty("CTRL_PTS")) {
      const drawEss = this.createDrawEssentials([...options.CTRL_PTS!], options.ECHLON);
      this._tGraphic.geometry = this.createSymbol(drawEss);
      this.__drawEnd(this._tGraphic.geometry as Polyline, drawEss);
      this._clear();
    } else {
      this._tGraphic = new Graphic({ geometry: null, symbol: this._lineSym });
      this.view.graphics.add(this._tGraphic);
      this._setupEventHandlers();
    }
  }

  private _setupEventHandlers(): void {
    this._onClk = this.view.on("click", (event) => this._onClickHandler(event));
    this._onDblClk = this.view.on("double-click", (event) => this._onDoubleClickHandler(event));
  }

  private find_angle(p0: Point, p1: Point, c: Point): number {
    const p0c = Math.sqrt(Math.pow(c.x - p0.x, 2) + Math.pow(c.y - p0.y, 2));
    const p1c = Math.sqrt(Math.pow(c.x - p1.x, 2) + Math.pow(c.y - p1.y, 2));
    const p0p1 = Math.sqrt(Math.pow(p1.x - p0.x, 2) + Math.pow(p1.y - p0.y, 2));
    return Math.acos((p1c * p1c + p0c * p0c - p0p1 * p0p1) / (2 * p1c * p0c));
  }

  private angleBetweenTwoPointsWithFixedPoint(point1X: number, point1Y: number, point2X: number, point2Y: number, fixedX: number, fixedY: number): number {
    const angle1 = Math.atan2(point1Y - fixedY, point1X - fixedX);
    const angle2 = Math.atan2(point2Y - fixedY, point2X - fixedX);
    return angle1 - angle2;
  }

  private createDrawEssentials(ctrlPts: Point[], echlon?: number): DrawEssentials {
    const drawEssentials = new DrawEssentials();
    drawEssentials.SCOPE = this;
    drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
    drawEssentials.SID = this.SID;
    drawEssentials.SYM_NAME = this.symName;
    drawEssentials.CTRL_PTS = ctrlPts;
    drawEssentials.ECHLON = echlon;
    return drawEssentials;
  }

  private createSymbol(drawEssentials: DrawEssentials): Polyline {
    try {
      let pts: Point[];

      if (drawEssentials.hasOwnProperty("CTRL_PTS") && drawEssentials.CTRL_PTS) {
        pts = drawEssentials.CTRL_PTS;
      } else {
        throw new Error("controlPoints not found");
      }

      const result = new Polyline({
        spatialReference: this.view.spatialReference
      });

      const startingPt = pts[0];
      const endPt = pts[1];

      if (pts.length === 2) {
        result.addPath([[startingPt.x, startingPt.y], [endPt.x, endPt.y]]);
      } else if (pts.length === 3) {
        const candidatePoint = pts[2];
        const circle = this._circleDrawEx(
          this.view.toScreen(startingPt),
          this.view.toScreen(endPt),
          this.view.toScreen(candidatePoint)
        );

        if (circle.radius > 0) {
          const values = this.CreateCircleSegmentFromThreePoints(
            circle,
            this.view.toScreen(startingPt),
            this.view.toScreen(endPt),
            this.view.toScreen(candidatePoint),
            60
          );

          const paths = values.geometry.paths[0];
          result.addPath(paths.slice(0, 60));
        }
      } else if (pts.length > 3) {
        const candidatePoint = pts[2];
        const lastPt = pts[pts.length - 1];
        const secLastPt = pts[pts.length - 2];

        const circle = this._circleDrawEx(
          this.view.toScreen(startingPt),
          this.view.toScreen(endPt),
          this.view.toScreen(candidatePoint)
        );

        if (circle.radius > 0) {
          const values = this.CreateCircleSegmentFromThreePoints(
            circle,
            this.view.toScreen(startingPt),
            this.view.toScreen(endPt),
            this.view.toScreen(candidatePoint),
            60
          );

          const paths = values.geometry.paths[0];
          result.addPath(paths.slice(0, 60));
        }

        const pathPoints: Point[] = [];
        const firstResultPoint = result.getPoint(0, 0);
        if (firstResultPoint) {
          pathPoints.push(firstResultPoint);
        } else {
          pathPoints.push(startingPt);
        }

        for (let i = 3; i < pts.length - 1; i++) {
          pathPoints.push(pts[i]);
        }
        pathPoints.push(lastPt);

        const fractureValues = GeoTools._fracture(pathPoints, 10, this.view.spatialReference);
        if (fractureValues && fractureValues.geometry && fractureValues.geometry.paths) {
          result.paths = result.paths.concat(fractureValues.geometry.paths);
        }

        const baseLineLen = GeoTools._2PtLen(startingPt, lastPt);
        for (let i = 0; i < fractureValues.midPoints.length; i++) {
          let cLenLimit = fractureValues.midPoints[i].len / 2;
          if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
          result.addPath(Shapes.createDD(fractureValues.midPoints[i].midPt.x, fractureValues.midPoints[i].midPt.y, cLenLimit, this.view.spatialReference));
        }

        // Arrow
        result.addPath(Shapes.arrowHead(
          lastPt,
          GeoTools.ArrowFlanksLen(GeoTools._2PtLen(secLastPt, lastPt), GeoTools._2PtLen(startingPt, lastPt)),
          GeoTools.angleInRadians(secLastPt, lastPt)
        ));
      }

      return result;
    } catch (e) {
      console.log(this.declaredClass + ' Cannot create Symbol due to invalid geometry');
      throw e;
    }
  }

  private _onMouseMoveHandler(event: any): void {
    const candidatePoint = event.mapPoint;
    const drawEssentials = this.createDrawEssentials(
      [...this._points, candidatePoint],
      this._echlon
    );

    this._tGraphic.geometry = this.createSymbol(drawEssentials);
    this.emit("onDrawProgress", {
      currentGeometry: this._tGraphic.geometry,
      currentDrawEssentials: drawEssentials,
      currentMarker: this._lineSym
    });
  }

  private _onClickHandler(event: any): void {
    this._points.push(event.mapPoint.clone());
    
    if (this._points.length === 1) {
      this._onMM = this.view.on("pointer-move", (event) => this._onMouseMoveHandler(event));
    }
    
    this.emit("onDrawClick", { currentPts: this._points });
  }

  private _onDoubleClickHandler(event: any): void {
    this._points.push(event.mapPoint.clone());
    this.cleanUp();
  }

  private cleanUp(): void {
    const drawEss = this.createDrawEssentials([...this._points], this._echlon);
    this.__drawEnd(this._tGraphic.geometry as Polyline, drawEss);
    this._clear();
    this._removeEvents();
  }

  private __drawEnd(drawGeometry: Polyline, drawEssentials: DrawEssentials): void {
    if (drawGeometry) {
      const spRef = this.view.spatialReference;
      let geographicGeometry: Polyline | undefined;

      if (spRef && webMercatorUtils.canProject(spRef, { wkid: 4326 })) {
        geographicGeometry = webMercatorUtils.webMercatorToGeographic(drawGeometry) as Polyline;
      } else if (spRef.wkid === 4326) {
        geographicGeometry = jsonUtils.fromJSON(drawGeometry.toJSON()) as Polyline;
      }

      this.__onDrawEnd(drawGeometry, geographicGeometry, drawEssentials);
    }
  }

  private __onDrawEnd(geometry: Polyline, geoGeometry: Polyline | undefined, drawEssParam: DrawEssentials): void {
    this.emit("onDrawEnd", {
      geometry: geometry,
      geographicGeometry: geoGeometry,
      drawEssentials: drawEssParam,
      marker: this._lineSym
    });
  }

  private _clear(): void {
    if (this._tGraphic) {
      this.view.graphics.remove(this._tGraphic);
    }
    this._tGraphic = new Graphic();
    this._points = [];
  }

  private _removeEvents(): void {
    if (this._onClk) this._onClk.remove();
    if (this._onDblClk) this._onDblClk.remove();
    if (this._onMM) this._onMM.remove();
    this.view.navigation.browserTouchPanEnabled = true;
  }

  public deactivate(): void {
    this._clear();
    this._removeEvents();
    this._geometryType = null;
  }

  private _circleDrawEx(pt1: any, pt2: any, pt3: any): { radius: number; center: { x: number; y: number } } {
    const a = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ];

    const P = [
      [pt1.x, pt1.y],
      [pt2.x, pt2.y],
      [pt3.x, pt3.y]
    ];

    // Find minor 11
    for (let i = 0; i < 3; i++) {
      a[i][0] = P[i][0];
      a[i][1] = P[i][1];
      a[i][2] = 1;
    }
    const m11 = this._determinantDrawEx(a, 3);

    // Find minor 12
    for (let i = 0; i < 3; i++) {
      a[i][0] = P[i][0] * P[i][0] + P[i][1] * P[i][1];
      a[i][1] = P[i][1];
      a[i][2] = 1;
    }
    const m12 = this._determinantDrawEx(a, 3);

    // Find minor 13
    for (let i = 0; i < 3; i++) {
      a[i][0] = P[i][0] * P[i][0] + P[i][1] * P[i][1];
      a[i][1] = P[i][0];
      a[i][2] = 1;
    }
    const m13 = this._determinantDrawEx(a, 3);

    // Find minor 14
    for (let i = 0; i < 3; i++) {
      a[i][0] = P[i][0] * P[i][0] + P[i][1] * P[i][1];
      a[i][1] = P[i][0];
      a[i][2] = P[i][1];
    }
    const m14 = this._determinantDrawEx(a, 3);

    let r: number;
    let Xo: number;
    let Yo: number;

    if (m11 === 0) {
      r = 0;
      Xo = 0;
      Yo = 0;
    } else {
      Xo = 0.5 * m12 / m11;
      Yo = -0.5 * m13 / m11;
      r = Math.sqrt(Xo * Xo + Yo * Yo + m14 / m11);
    }

    return { radius: r, center: { x: Xo, y: Yo } };
  }

  private _determinantDrawEx(a: number[][], n: number): number {
    const m = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ];

    if (n === 2) {
      return a[0][0] * a[1][1] - a[1][0] * a[0][1];
    }

    let d = 0;
    for (let j1 = 0; j1 < n; j1++) {
      for (let i = 1; i < n; i++) {
        let j2 = 0;
        for (let j = 0; j < n; j++) {
          if (j === j1) continue;
          m[i - 1][j2] = a[i][j];
          j2++;
        }
      }
      d = d + Math.pow(-1.0, j1) * a[0][j1] * this._determinantDrawEx(m, n - 1);
    }

    return d;
  }

  private CreateCircleSegmentFromThreePoints(circle: any, pt1: any, pt2: any, pt3: any, numberOfPts: number): any {
    const center = circle.center;
    const radius = circle.radius;
    const path: Point[] = [];

    pt1.x -= center.x;
    pt1.y -= center.y;
    pt2.x -= center.x;
    pt2.y -= center.y;
    pt3.x -= center.x;
    pt3.y -= center.y;

    let anglePt1 = Math.atan2(pt1.y, pt1.x);
    let anglePt2 = Math.atan2(pt2.y, pt2.x);
    let anglePt3 = Math.atan2(pt3.y, pt3.x);

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
      const pt = this.view.toMap({
        x: radius * Math.cos(startAngle + i * angle) + center.x,
        y: radius * Math.sin(startAngle + i * angle) + center.y
      });
      path.push(pt);
    }

    const result = new Polyline({
      spatialReference: this.view.spatialReference
    });
    result.addPath(path.map(p => [p.x, p.y]));

    return {
      geometry: result,
      lastPoint: path[numberOfPts],
      backPoint: path[numberOfPts - 5]
    };
  }
} 