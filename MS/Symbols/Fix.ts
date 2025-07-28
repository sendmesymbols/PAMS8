/**
 * Class Representing Fixation.
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
  
  static setDefault(options: any, key: string, defaultValue: any): any {
    return options.hasOwnProperty(key) ? options[key] : defaultValue;
  }
  
  static angleInRadians(pt1: Point, pt2: Point): number {
    return Math.atan2(pt2.y - pt1.y, pt2.x - pt1.x);
  }
  
  static twoPtsAngle(pt1: Point, pt2: Point): number {
    return Math.atan2(pt2.y - pt1.y, pt2.x - pt1.x);
  }
  
  static twoPtsRelationShip(pt1: Point, pt2: Point): string {
    if (pt2.x >= pt1.x && pt2.y >= pt1.y) return "ne";
    if (pt2.x <= pt1.x && pt2.y >= pt1.y) return "nw";
    if (pt2.x <= pt1.x && pt2.y <= pt1.y) return "sw";    
    return "se";
  }
  
  static getDashPts(points: Point[], gapArray: number[]): Point[] {
    // Simplified dash points generation
    const result: Point[] = [];
    const totalLen = this._2PtLen(points[0], points[points.length - 1]);
    const gapSize = gapArray[0] || 10;
    const numberOfSegments = Math.floor(totalLen / gapSize);
    
    for (let i = 0; i <= numberOfSegments; i++) {
      const ratio = i / numberOfSegments;
      const index = Math.floor(ratio * (points.length - 1));
      const nextIndex = Math.min(index + 1, points.length - 1);
      const localRatio = (ratio * (points.length - 1)) - index;
      
      if (index < points.length && nextIndex < points.length) {
        const x = points[index].x + (points[nextIndex].x - points[index].x) * localRatio;
        const y = points[index].y + (points[nextIndex].y - points[index].y) * localRatio;
        result.push(new Point({ x, y, spatialReference: points[0].spatialReference }));
      }
    }
    
    return result;
  }
  
  static ArrowFlanksLen(len1: number, len2: number): number {
    return Math.min(len1, len2) * 0.3;
  }
  
  static getLastPtFromPoly(polyline: Polyline): Point {
    // Get the last point from a polyline
    if (polyline.paths && polyline.paths.length > 0) {
      const lastPath = polyline.paths[polyline.paths.length - 1];
      if (lastPath.length > 0) {
        const lastPoint = lastPath[lastPath.length - 1];
        return new Point({
          x: lastPoint[0],
          y: lastPoint[1],
          spatialReference: polyline.spatialReference
        });
      }
    }
    return new Point({ x: 0, y: 0 });
  }
}

class DrawEssentials {
  SCOPE?: any;
  SYM_GEO_TYPE?: string;
  SID?: string;
  SYM_NAME?: string;
  CTRL_PTS?: Point[];
  AMPLIFIER?: any;
  IS_OBS?: string;
  TAIL_FACTOR?: number;
  HEAD_RATIO?: number;
  TEETH_SIZE?: number;
  TEETH_GAP?: number;
}

class Shapes {
  static createF(x: number, y: number, size: number, spatialRef: any): number[][] {
    // Create F shape
    return [
      [x - size, y - size],
      [x - size, y + size],
      [x + size, y + size],
      [x - size, y],
      [x + size/2, y]
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

interface FixOptions {
  CTRL_PTS?: Point[];
  GEOM?: Polyline;
  TAIL_FACTOR?: number;
  HEAD_RATIO?: number;
  TEETH_SIZE?: number;
  TEETH_GAP?: number;
}

export default class Fix extends Evented {
  public declaredClass: string = "MilitarySymbology.Symbols.Fix";
  public SID: string = "341100";
  public symName: string = "Fixation";
  public symGeometricType: string = "Line";

  private view: ViewType;
  private isLine: boolean;
  private _lineSym: any;
  private _points: Point[] = [];
  private _geometryType: any = null;
  private _teethSize: number = 3;
  private _teethGap: number = 30;
  private _headRatio: number = 10;
  private _tailRatio: number = 10;
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

  public init(options: FixOptions, marker: any): void {
    this._lineSym = marker;
    
    // Disable map navigation during drawing
    this.view.navigation.browserTouchPanEnabled = false;

    const drawEssentials = new DrawEssentials();
    this._tailRatio = GeoTools.setDefault(options, "TAIL_FACTOR", this._tailRatio);
    this._headRatio = GeoTools.setDefault(options, "HEAD_RATIO", this._headRatio);
    this._teethSize = GeoTools.setDefault(options, "TEETH_SIZE", this._teethSize);
    this._teethGap = GeoTools.setDefault(options, "TEETH_GAP", this._teethGap);

    if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
      this._tGraphic.geometry = options.GEOM!;
      const drawEss = this.createDrawEssentials([...options.CTRL_PTS!], this._tailRatio, this._headRatio, this._teethSize, this._teethGap);
      this.__drawEnd(this._tGraphic.geometry as Polyline, drawEss);
      this._clear();
    } else if (options.hasOwnProperty("CTRL_PTS")) {
      const drawEss = this.createDrawEssentials([...options.CTRL_PTS!], this._tailRatio, this._headRatio, this._teethSize, this._teethGap);
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

  private createDrawEssentials(ctrlPts: Point[], tailRatio: number, headRatio: number, teethSize: number, teethGap: number): DrawEssentials {
    const drawEssentials = new DrawEssentials();
    drawEssentials.SCOPE = this;
    drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
    drawEssentials.SID = this.SID;
    drawEssentials.SYM_NAME = this.symName;
    drawEssentials.CTRL_PTS = ctrlPts;
    drawEssentials.TAIL_FACTOR = tailRatio;
    drawEssentials.HEAD_RATIO = headRatio;
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

      const firstPoint = pts[0];
      const secondPoint = pts[1];
      const lastPoint = pts[pts.length - 1];
      const secLastPoint = pts[pts.length - 2];

      // Shorten Pts according to head and tail ratio
      const baseLineLen = GeoTools._2PtLen(firstPoint, lastPoint);
      let cLenLimit = baseLineLen / 10;

      if (cLenLimit > baseLineLen / 3) cLenLimit = baseLineLen / 3;
      result.addPath(Shapes.createF(firstPoint.x, firstPoint.y, cLenLimit, firstPoint.spatialReference));

      const k1 = GeoTools.twoPtsAngle(firstPoint, secondPoint);
      cLenLimit = baseLineLen / 8;
      const lineStPt = { x: cLenLimit * Math.cos(k1) + firstPoint.x, y: cLenLimit * Math.sin(k1) + firstPoint.y };

      // Gap
      cLenLimit = baseLineLen / this._tailRatio;
      const lineEndPt = { x: cLenLimit * Math.cos(k1) + lineStPt.x, y: cLenLimit * Math.sin(k1) + lineStPt.y };
      result.addPath([[lineStPt.x, lineStPt.y], [lineEndPt.x, lineEndPt.y]]);

      // Attach Head 
      const k2 = GeoTools.twoPtsAngle(secLastPoint, lastPoint);
      cLenLimit = baseLineLen / this._headRatio * 1.5;
      const lineEndPt2 = { x: -1 * cLenLimit * Math.cos(k2) + lastPoint.x, y: -1 * cLenLimit * Math.sin(k2) + lastPoint.y };
      result.addPath([[lineEndPt2.x, lineEndPt2.y], [lastPoint.x, lastPoint.y]]);

      // Create chopPts
      const chopPts: any[] = [lineEndPt, ...pts.slice(1, pts.length - 1), lineEndPt2];

      // Create Double Line
      const firstChopPt = chopPts[0];
      const lastChopPt = chopPts[chopPts.length - 1];
      const leftArray: any[] = [];
      const rightArray: any[] = [];

      let len = baseLineLen / 5 / this._teethSize;
      let k = Math.atan((firstChopPt.y - lastChopPt.y) / (firstChopPt.x - lastChopPt.x));

      switch (GeoTools.twoPtsRelationShip(firstChopPt, lastChopPt)) {
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
      const p1 = { x: partialLen * Math.cos(k) + firstChopPt.x, y: partialLen * Math.sin(k) + firstChopPt.y };
      const p2 = { x: -1 * partialLen * Math.cos(k) + firstChopPt.x, y: -1 * partialLen * Math.sin(k) + firstChopPt.y };

      if (chopPts.length >= 1) {
        leftArray.push(p1);
        rightArray.push(p2);
      }

      for (let i = 0; i < chopPts.length; i++) {
        // Find distance between candidatePoint and Mid Point
        const length = GeoTools._2PtLen(firstChopPt, chopPts[i]);
        const angle = GeoTools.angleInRadians(firstChopPt, chopPts[i]);

        const stPtCandidatePt = new Point({
          x: p1.x + length * Math.cos(angle),
          y: p1.y + length * Math.sin(angle),
          spatialReference: this.view.spatialReference
        });

        const endPtCandidatePt = new Point({
          x: p2.x + length * Math.cos(angle),
          y: p2.y + length * Math.sin(angle),
          spatialReference: this.view.spatialReference
        });

        leftArray.push(stPtCandidatePt);
        rightArray.push(endPtCandidatePt);
      }

      // Create MidPts of Left and Right Array
      let gapRatio = GeoTools._2PtLen(chopPts[0], chopPts[chopPts.length - 1]);
      gapRatio = gapRatio / this._teethGap;

      const rightResPts = GeoTools.getDashPts(rightArray, [gapRatio, gapRatio]);
      const leftResPts = GeoTools.getDashPts(leftArray, [gapRatio, gapRatio]);

      const paths: any[] = [];
      for (let i = 1; i < rightResPts.length; i++) {
        if (i % 2 === 0) {
          paths.push(rightResPts[i]);
        } else {
          paths.push(leftResPts[i]);
        }
      }

      // Connect this F -- with /\/\/\
      result.addPath([[lineEndPt.x, lineEndPt.y], [paths[0].x, paths[0].y]]);

      result.addPath(paths.map(p => Array.isArray(p) ? p : [p.x, p.y]));

      // Connect arrow tail and zig zag
      const lastZigZagPt = GeoTools.getLastPtFromPoly(result);
      result.addPath([[lastZigZagPt.x, lastZigZagPt.y], [lineEndPt2.x, lineEndPt2.y]]);

      // Arrow Head
      result.addPath(Shapes.arrowHead(
        lastPoint,
        GeoTools.ArrowFlanksLen(GeoTools._2PtLen(secLastPoint, lastPoint), GeoTools._2PtLen(secLastPoint, lastPoint)),
        GeoTools.angleInRadians(secLastPoint, lastPoint)
      ));

      return result;
    } catch (e) {
      console.log(this.declaredClass + ' Cannot create Symbol due to invalid geometry');
      throw e;
    }
  }

  private _onMouseMoveHandler(event: any): void {
    const drawEssentials = this.createDrawEssentials(
      [...this._points, event.mapPoint],
      this._tailRatio,
      this._headRatio,
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
    
    if (this._points.length === 1) {
      this._onMM = this.view.on("pointer-move", (event) => this._onMouseMoveHandler(event));
    }
    
    this.emit("onDrawClick", { currentPts: this._points });
    
    if (this.isLine === true && this._points.length === 1) {
      this.cleanUp();
    }
  }

  private _onDoubleClickHandler(event: any): void {
    this._points.push(event.mapPoint.clone());
    this.cleanUp();
  }

  private cleanUp(): void {
    const drawEss = this.createDrawEssentials([...this._points], this._tailRatio, this._headRatio, this._teethSize, this._teethGap);
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
} 