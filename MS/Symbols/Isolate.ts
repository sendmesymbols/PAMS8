/**
 * Class Representing Isolate.
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

  static getMidPoint(pt1: Point, pt2: Point): Point {
    return new Point({
      x: (pt1.x + pt2.x) / 2,
      y: (pt1.y + pt2.y) / 2,
      spatialReference: pt1.spatialReference
    });
  }

  static twoPtsAngle(pt1: Point, pt2: Point): number {
    return Math.atan2(pt2.y - pt1.y, pt2.x - pt1.x);
  }

  static setDefault(options: any, key: string, defaultValue: any): any {
    return options.hasOwnProperty(key) ? options[key] : defaultValue;
  }
}

class DrawEssentials {
  SCOPE?: any;
  SYM_GEO_TYPE?: string;
  SID?: string;
  SYM_NAME?: string;
  CTRL_PTS?: Point[];
  AMPLIFIER?: any;
  TEETH_SIZE?: number;
}

class Shapes {
  static createI(x: number, y: number, size: number, spatialRef: any): number[][] {
    // Create I shape for Isolate
    return [
      [x - size/2, y + size],
      [x + size/2, y + size],
      [x, y + size],
      [x, y - size],
      [x - size/2, y - size],
      [x + size/2, y - size]
    ];
  }
}

interface IsolateOptions {
  CTRL_PTS?: Point[];
  GEOM?: Polyline;
  TEETH_SIZE?: number;
}

export default class Isolate extends Evented {
  public declaredClass: string = "MilitarySymbology.Symbols.Isolate";
  public SID: string = "341500";
  public symName: string = "Isolate";
  public symGeometricType: string = "Area";

  private view: ViewType;
  private isLine: boolean;
  private _lineSym: any;
  private _points: Point[] = [];
  private _geometryType: any = null;
  private _teethSize: number = 2;
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

  public init(options: IsolateOptions, marker: any): void {
    this._lineSym = marker;
    
    // Disable map navigation during drawing
    this.view.navigation.browserTouchPanEnabled = false;
    
    this._teethSize = GeoTools.setDefault(options, "TEETH_SIZE", this._teethSize);

    const drawEssentials = new DrawEssentials();

    if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
      this._tGraphic.geometry = options.GEOM!;
      const drawEss = this.createDrawEssentials([...options.CTRL_PTS!], options.TEETH_SIZE);
      this.__drawEnd(this._tGraphic.geometry as Polyline, drawEss);
      this._clear();
    } else if (options.hasOwnProperty("CTRL_PTS")) {
      const drawEss = this.createDrawEssentials([...options.CTRL_PTS!], options.TEETH_SIZE);
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

  private createDrawEssentials(ctrlPts: Point[], teethSize?: number): DrawEssentials {
    const drawEssentials = new DrawEssentials();
    drawEssentials.SCOPE = this;
    drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
    drawEssentials.SID = this.SID;
    drawEssentials.SYM_NAME = this.symName;
    drawEssentials.CTRL_PTS = ctrlPts;
    drawEssentials.TEETH_SIZE = teethSize;
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
      } else if (pts.length > 2) {
        const candidatePoint = pts[2];
        const circle = this._circleDrawEx(this.view.toScreen(startingPt), this.view.toScreen(endPt), this.view.toScreen(candidatePoint));
        
        if (circle.radius > 0) {
          const values = this.CreateCircleSegmentFromThreePoints(circle, this.view.toScreen(startingPt), this.view.toScreen(endPt), this.view.toScreen(candidatePoint), 60, this.view);
          const paths = values.geometry.paths[0];

          result.addPath(paths.slice(0, 25).map((p: any) => [p.x, p.y]));
          result.addPath(paths.slice(35, 60).map((p: any) => [p.x, p.y]));

          // Create I
          const cPoint = new Point({
            x: paths[30][0], 
            y: paths[30][1], 
            spatialReference: this.view.spatialReference
          });
          const firstPoint = new Point({
            x: paths[25][0], 
            y: paths[25][1], 
            spatialReference: this.view.spatialReference
          });
          const secondPoint = new Point({
            x: paths[35][0], 
            y: paths[35][1], 
            spatialReference: this.view.spatialReference
          });
          
          const baseLineLen = GeoTools._2PtLen(firstPoint, secondPoint);
          let cLenLimit = baseLineLen / 5;
          if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
          
          result.addPath(Shapes.createI(cPoint.x, cPoint.y, cLenLimit, this.view.spatialReference));

          // Create arrow wings
          const length = GeoTools._2PtLen(endPt, cPoint) / 10;
          let angle = GeoTools.twoPtsAngle(values.backPoint, values.lastPoint);

          if (angle < 3.14159) {
            angle += 2.35619;
          } else {
            angle -= 2.35619;
          }

          const innerWing = new Point({
            x: endPt.x + length * Math.cos(angle), 
            y: endPt.y + length * Math.sin(angle), 
            spatialReference: this.view.spatialReference
          });
          
          angle = GeoTools.twoPtsAngle(values.backPoint, values.lastPoint);
          if (angle > 3.14159) {
            angle += 2.35619;
          } else {
            angle -= 2.35619;
          }

          const outerWing = new Point({
            x: endPt.x + length * Math.cos(angle), 
            y: endPt.y + length * Math.sin(angle), 
            spatialReference: this.view.spatialReference
          });
          
          result.addPath([[innerWing.x, innerWing.y], [endPt.x, endPt.y]]);
          result.addPath([[outerWing.x, outerWing.y], [endPt.x, endPt.y]]);

          // Inner Teeth
          const teethSize = length * GeoTools.setDefault(drawEssentials, "TEETH_SIZE", this._teethSize);
          const extent = result.extent;
          
          if (extent && extent.center) {
            const centerPt = extent.center;

            if (result.paths && result.paths.length > 0) {
              // Add teeth along the paths
              for (let pathIndex = 0; pathIndex < Math.min(2, result.paths.length); pathIndex++) {
                const path = result.paths[pathIndex];
                if (path && path.length > 15) {
                  const startPt = new Point({
                    x: path[1][0], 
                    y: path[1][1], 
                    spatialReference: this.view.spatialReference
                  });
                  const endPt1 = new Point({
                    x: path[7][0], 
                    y: path[7][1], 
                    spatialReference: this.view.spatialReference
                  });
                  result.addPath(this.createTeeth(startPt, endPt1, centerPt, teethSize));
                }
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
      this._teethSize
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
    
    if (this._points.length === 3) {
      this.cleanUp();
    }
  }

  private _onDoubleClickHandler(event: any): void {
    this._points.push(event.mapPoint.clone());
    this.cleanUp();
  }

  private cleanUp(): void {
    const drawEss = this.createDrawEssentials([...this._points], this._teethSize);
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

  private _circleDrawEx(pt1: any, pt2: any, pt3: any): { radius: number, center: { x: number, y: number } } {
    // Simplified circle calculation based on three points
    const dx1 = pt2.x - pt1.x;
    const dy1 = pt2.y - pt1.y;
    const dx2 = pt3.x - pt1.x;
    const dy2 = pt3.y - pt1.y;
    
    const area = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(area) < 1e-10) {
      return { radius: 0, center: { x: 0, y: 0 } };
    }
    
    const d1 = dx1 * dx1 + dy1 * dy1;
    const d2 = dx2 * dx2 + dy2 * dy2;
    
    const cx = pt1.x + (d1 * dy2 - d2 * dy1) / (2 * area);
    const cy = pt1.y + (dx1 * d2 - dx2 * d1) / (2 * area);
    
    const radius = Math.sqrt((cx - pt1.x) ** 2 + (cy - pt1.y) ** 2);
    
    return { radius: radius, center: { x: cx, y: cy } };
  }

  private CreateCircleSegmentFromThreePoints(circle: any, pt1: any, pt2: any, pt3: any, numberOfPts: number, view: ViewType): { geometry: Polyline, lastPoint: Point, backPoint: Point } {
    const center = circle.center;
    const radius = circle.radius;
    const path: Point[] = [];
    
    // Calculate angles for the three points
    const anglePt1 = Math.atan2(pt1.y - center.y, pt1.x - center.x);
    const anglePt2 = Math.atan2(pt2.y - center.y, pt2.x - center.x);
    const anglePt3 = Math.atan2(pt3.y - center.y, pt3.x - center.x);
    
    const normalizeAngle = (angle: number) => angle < 0 ? 2 * Math.PI + angle : angle;
    
    const startAngle = normalizeAngle(Math.min(anglePt1, anglePt2));
    const endAngle = normalizeAngle(Math.max(anglePt1, anglePt2));
    let swipeAngle = endAngle - startAngle;
    
    if (normalizeAngle(anglePt3) < startAngle || normalizeAngle(anglePt3) > endAngle) {
      swipeAngle -= (2 * Math.PI);
    }
    
    const angleStep = swipeAngle / numberOfPts;
    
    for (let i = 0; i <= numberOfPts; i++) {
      const screenX = radius * Math.cos(startAngle + i * angleStep) + center.x;
      const screenY = radius * Math.sin(startAngle + i * angleStep) + center.y;
      const pt = view.toMap({ x: screenX, y: screenY });
      if (pt) {
        path.push(pt);
      }
    }
    
    const result = new Polyline({
      spatialReference: view.spatialReference
    });
    result.addPath(path.map(p => [p.x, p.y]));
    
    return {
      geometry: result,
      lastPoint: path[numberOfPts] || path[path.length - 1],
      backPoint: path[Math.max(0, numberOfPts - 5)] || path[0]
    };
  }

  private createTeeth(startPt: Point, endPt: Point, centerPt: Point, teethSize: number): number[][] {
    const midPt = GeoTools.getMidPoint(startPt, endPt);
    const angle = GeoTools.twoPtsAngle(centerPt, midPt);
    const midPtTwrdsCntr = new Point({
      x: -1 * teethSize * Math.cos(angle) + midPt.x,
      y: -1 * teethSize * Math.sin(angle) + midPt.y,
      spatialReference: this.view.spatialReference
    });
    
    return [[startPt.x, startPt.y], [midPtTwrdsCntr.x, midPtTwrdsCntr.y], [endPt.x, endPt.y]];
  }
} 