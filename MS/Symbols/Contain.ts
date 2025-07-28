/**
 * Class Representing Contain.
 * @class
 * @author Abdul Razak
 */

import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Polygon from "@arcgis/core/geometry/Polygon";
import * as webMercatorUtils from "@arcgis/core/geometry/support/webMercatorUtils";
import * as jsonUtils from "@arcgis/core/geometry/support/jsonUtils";
import Evented from "@arcgis/core/core/Evented";
// import BaseLine from "../MilSymbologyComponents/BaseLine";
// import GeoTools from "../MilSymbologyExt/GeoTools";
// import DrawEssentials from "../MilSymbologySymbolsEngine/DrawEssentials";
// import Shapes from "../MilSymbologyComponents/Shapes";

// Temporary placeholders for utility classes
class BaseLine {
  constructor(view: any, symbol: any) {}
}

class GeoTools {
  static setDefault(obj: any, key: string, defaultValue: any): any {
    return obj && obj[key] !== undefined ? obj[key] : defaultValue;
  }
  static _2PtLen(pt1: Point, pt2: Point): number {
    return Math.sqrt(Math.pow(pt2.x - pt1.x, 2) + Math.pow(pt2.y - pt1.y, 2));
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
  TEETH_SIZE?: number;
  TEETH_GAP?: number;
}

class Shapes {
  static createCC(x: number, y: number, size: number, spatialRef: any): number[][] {
    return [[x - size, y], [x + size, y]];
  }
}

type ViewType = MapView | SceneView;

interface ContainOptions {
  CTRL_PTS?: Point[];
  GEOM?: Polyline;
  TEETH_SIZE?: number;
  TEETH_GAP?: number;
}

interface DrawEvent {
  geometry: Polyline;
  geographicGeometry?: Polyline;
  drawEssentials: DrawEssentials;
  marker: any;
}

export default class Contain extends Evented {
  public declaredClass: string = "MilitarySymbology.Symbols.Contain";
  public SID: string = "151204";
  public symName: string = "Contain";
  public symGeometricType: string = "Area";

  private view: ViewType;
  private isLine: boolean;
  private _lineSym: any;
  private _points: Point[] = [];
  private _geometryType: any = null;
  private _teethSize: number = 2;
  private _teethGap: number = 5;
  private _tGraphic: Graphic;

  private _onClk: any;
  private _onDblClk: any;
  private _onMM: any;

  constructor(view: ViewType, isLine?: boolean) {
    super();
    this.view = view;
    this.isLine = isLine || false;
    this._tGraphic = new Graphic();
  }

  public init(options: ContainOptions, marker: any): void {
    this._lineSym = marker;
    
    // Disable map navigation during drawing
    this.view.navigation.browserTouchPanEnabled = false;
    
    this._teethSize = GeoTools.setDefault(options, "TEETH_SIZE", this._teethSize);
    this._teethGap = GeoTools.setDefault(options, "TEETH_GAP", this._teethGap);

    const drawEssentials = new DrawEssentials();
    const baseLine = new BaseLine(this.view, this._lineSym);

    if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
      this._tGraphic.geometry = options.GEOM!;
      const drawEss = this.createDrawEssentials([...options.CTRL_PTS!], options.TEETH_SIZE, options.TEETH_GAP);
      this.__drawEnd(this._tGraphic.geometry as Polyline, drawEss);
      this._clear();
    } else if (options.hasOwnProperty("CTRL_PTS")) {
      const drawEss = this.createDrawEssentials([...options.CTRL_PTS!], options.TEETH_SIZE, options.TEETH_GAP);
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

  private createDrawEssentials(ctrlPts: Point[], teethSize?: number, teethGap?: number): DrawEssentials {
    const drawEssentials = new DrawEssentials();
    drawEssentials.SCOPE = this;
    drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
    drawEssentials.SID = this.SID;
    drawEssentials.SYM_NAME = this.symName;
    drawEssentials.CTRL_PTS = ctrlPts;
    drawEssentials.TEETH_SIZE = teethSize;
    drawEssentials.TEETH_GAP = teethGap;
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
          result.addPath(paths.slice(0, 28));  
          result.addPath(paths.slice(32, 60));

          // Create C
          const cPoint = new Point({
            x: paths[30][0],
            y: paths[30][1],
            spatialReference: this.view.spatialReference
          });

          const firstPoint = new Point({
            x: paths[28][0],
            y: paths[28][1],
            spatialReference: this.view.spatialReference
          });

          const secondPoint = new Point({
            x: paths[32][0],
            y: paths[32][1],
            spatialReference: this.view.spatialReference
          });

          const baseLineLen = GeoTools._2PtLen(firstPoint, secondPoint);
          let cLenLimit = baseLineLen / 5;
          if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;

          result.addPath(Shapes.createCC(cPoint.x, cPoint.y, cLenLimit, this.view.spatialReference));

          // Add teeth
          const extent = result.extent;
          if (extent && extent.center) {
            const centerPt = extent.center;
            const length = GeoTools._2PtLen(endPt, centerPt) / 10;
            const teethSize = length * GeoTools.setDefault(drawEssentials, "TEETH_SIZE", this._teethSize);
            const teethGap = GeoTools.setDefault(drawEssentials, "TEETH_GAP", this._teethGap);

            for (let i = teethGap; i < 28; i += teethGap) {
              const pt1 = result.getPoint(0, i);
              const pt2 = result.getPoint(0, i);
              if (pt1 && pt2) {
                result.addPath(this.createTeeth(pt1 as Point, GeoTools.angleInRadians(centerPt, pt2 as Point), teethSize));
              }
            }

            for (let i = teethGap; i < 28; i += teethGap) {
              const pt1 = result.getPoint(1, i);
              const pt2 = result.getPoint(1, i);
              if (pt1 && pt2) {
                result.addPath(this.createTeeth(pt1 as Point, GeoTools.angleInRadians(centerPt, pt2 as Point), teethSize));
              }
            }
          }
        }
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
      this._teethSize,
      this._teethGap
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
    this.emit("onDrawClick", { currentPts: this._points });
    
    if (this._points.length === 1) {
      this._onMM = this.view.on("pointer-move", (event) => this._onMouseMoveHandler(event));
    }
  }

  private _onDoubleClickHandler(event: any): void {
    this._points.push(event.mapPoint.clone());
    this.cleanUp();
  }

  private cleanUp(): void {
    const drawEss = this.createDrawEssentials([...this._points], this._teethSize, this._teethGap);
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

  private createTeeth(startPt: Point, angle: number, teethSize: number): number[][] {
    if (!startPt) return [];
    
    const midPtTwrdsCntr = new Point({
      x: -1 * teethSize * Math.cos(angle) + startPt.x,
      y: -1 * teethSize * Math.sin(angle) + startPt.y,
      spatialReference: this.view.spatialReference
    });
    
    return [[startPt.x, startPt.y], [midPtTwrdsCntr.x, midPtTwrdsCntr.y]];
  }
} 