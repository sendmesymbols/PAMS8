/**
 * Class Representing Moving Convoy.
 *
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

  static angleInRadians(pt1: Point, pt2: Point): number {
    return Math.atan2(pt2.y - pt1.y, pt2.x - pt1.x);
  }

  static twoPtsRelationShip(pt1: Point, pt2: Point): string {
    if (pt2.x >= pt1.x && pt2.y >= pt1.y) return "ne";
    if (pt2.x <= pt1.x && pt2.y >= pt1.y) return "nw";
    if (pt2.x <= pt1.x && pt2.y <= pt1.y) return "sw";
    if (pt2.x >= pt1.x && pt2.y <= pt1.y) return "se";
    return "ne";
  }

  static getMidPoint(pt1: Point, pt2: Point): Point {
    return new Point({
      x: (pt1.x + pt2.x) / 2,
      y: (pt1.y + pt2.y) / 2,
      spatialReference: pt1.spatialReference
    });
  }

  static toDegrees(radians: number): number {
    return radians * (180 / Math.PI);
  }

  static toRad(degrees: number): number {
    return degrees * (Math.PI / 180);
  }
}

class DrawEssentials {
  SCOPE?: any;
  SYM_GEO_TYPE?: string;
  SID?: string;
  SYM_NAME?: string;
  CTRL_PTS?: Point[];
  BASE_LN_PTS?: any;
  AMPLIFIER?: any;
}

class BaseLine {
  private view: ViewType;
  private symbol: any;
  private _onClk: any;
  private _onDblClk: any;
  private _onMM: any;
  private _tGraphic: Graphic;
  private _points: Point[] = [];

  constructor(view: ViewType, symbol: any) {
    this.view = view;
    this.symbol = symbol;
    this._tGraphic = new Graphic();
  }

  public init(): void {
    this.view.navigation.browserTouchPanEnabled = false;
    this._tGraphic = new Graphic({ geometry: null, symbol: this.symbol });
    this.view.graphics.add(this._tGraphic);
    this._setupEventHandlers();
  }

  private _setupEventHandlers(): void {
    this._onClk = this.view.on("click", (event) => this._onClickHandler(event));
    this._onDblClk = this.view.on("double-click", (event) => this._onDoubleClickHandler(event));
  }

  private _onClickHandler(event: any): void {
    this._points.push(event.mapPoint.clone());
    this.emit("onBaseLineClick", { currentGeometry: this._points });
    
    if (this._points.length === 1) {
      this._onMM = this.view.on("pointer-move", (event) => this._onMouseMoveHandler(event));
    }
  }

  private _onDoubleClickHandler(event: any): void {
    this._points.push(event.mapPoint.clone());
    this.cleanUp();
  }

  private _onMouseMoveHandler(event: any): void {
    const candidatePoint = event.mapPoint;
    const currentPoints = [...this._points, candidatePoint];
    
    const polyline = new Polyline({
      spatialReference: this.view.spatialReference
    });
    polyline.addPath(currentPoints.map(pt => [pt.x, pt.y]));
    
    this._tGraphic.geometry = polyline;
    this.emit("onBaseLineProgress", { 
      currentGeometry: currentPoints, 
      currentMarker: this.symbol 
    });
  }

  private cleanUp(): void {
    const polyline = new Polyline({
      spatialReference: this.view.spatialReference
    });
    polyline.addPath(this._points.map(pt => [pt.x, pt.y]));
    
    // Add baseline info to geometry
    (polyline as any)._baseLine = {
      startPt: this._points[0],
      endPt: this._points[this._points.length - 1]
    };
    (polyline as any).controlPoints = this._points;
    
    this.emit("drawEnd", { geometry: polyline });
    this._clear();
    this._removeEvents();
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

  public emit(event: string, data: any): void {
    // Event emission for baseline
  }
}

interface MovingConvoyOptions {
  CTRL_PTS?: Point[];
  BASE_LN_PTS?: any;
  GEOM?: Polyline;
}

export default class MovingConvoy extends Evented {
  public declaredClass: string = "MilitarySymbology.Symbols.MovingConvoy";
  public SID: string = "330100";
  public symName: string = "Moving Convoy / Approach";
  public symGeometricType: string = "Area";

  private view: ViewType;
  private isLine: boolean;
  private _lineSym: any;
  private _points: Point[] = [];
  private _baseLinePts: any = null;
  private _geometryType: any = null;
  private _tGraphic: Graphic;

  private _onClk: any;
  private _onDblClk: any;
  private _onMM: any;
  private _onBaseLineEnd: any;
  private _onBaseLineProgress: any;
  private _onBaseLineClick: any;

  constructor(view: ViewType, isLine: boolean) {
    super();
    this.view = view;
    this.isLine = isLine;
    this._tGraphic = new Graphic();
  }

  public init(options: MovingConvoyOptions, marker: any): void {
    this._lineSym = marker;
    this.view.navigation.browserTouchPanEnabled = false;

    const drawEssentials = new DrawEssentials();
    const baseLine = new BaseLine(this.view, this._lineSym);

    if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("BASE_LN_PTS") && options.hasOwnProperty("GEOM")) {
      this._tGraphic.geometry = options.GEOM!;
      const drawEss = this.createDrawEssentials([...options.CTRL_PTS!], options.BASE_LN_PTS);
      this.__drawEnd(this._tGraphic.geometry as Polyline, drawEss);
      this._clear();
    } else if (options.hasOwnProperty("CTRL_PTS")) {
      if (options.hasOwnProperty("BASE_LN_PTS")) {
        const drawEss = this.createDrawEssentials([...options.CTRL_PTS!], options.BASE_LN_PTS);
        this._tGraphic.geometry = this.createSymbol(drawEss);
        this.__drawEnd(this._tGraphic.geometry as Polyline, drawEss);
        this._clear();
      } else {
        throw new Error("Control Points and Baseline or Distance is required to create symbol non-interactively");
      }
    } else {
      this._onBaseLineEnd = baseLine.on("drawEnd", (event) => this.baseLineDrawEnd(event));
      this._onBaseLineClick = baseLine.on("onBaseLineClick", (event) => this.baseLineClick(event));
      this._onBaseLineProgress = baseLine.on("onBaseLineProgress", (event) => this.baseLineDrawProgress(event));
      baseLine.init();
    }
  }

  private createDrawEssentials(ctrlPts: Point[], baseLinePts: any): DrawEssentials {
    const drawEssentials = new DrawEssentials();
    drawEssentials.SCOPE = this;
    drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
    drawEssentials.SID = this.SID;
    drawEssentials.SYM_NAME = this.symName;
    drawEssentials.CTRL_PTS = ctrlPts;
    drawEssentials.BASE_LN_PTS = baseLinePts;
    return drawEssentials;
  }

  private baseLineDrawEnd(evt: any): void {
    if (this._onBaseLineEnd) this._onBaseLineEnd.remove();
    
    this._tGraphic = new Graphic({ geometry: evt.geometry, symbol: this._lineSym });
    this.view.graphics.add(this._tGraphic);
    this._baseLinePts = evt.geometry._baseLine;
    
    this._onMM = this.view.on("pointer-move", (event) => this._onMouseMoveHandler(event));
    this._onClk = this.view.on("click", (event) => this._onClickHandler(event));
    this._onDblClk = this.view.on("double-click", (event) => this._onDoubleClickHandler(event));
    
    this.emit("onBaseLineDrawEnd", { currentPts: evt.geometry.controlPoints });
  }

  private baseLineDrawProgress(evt: any): void {
    const localDrawEssentials = new DrawEssentials();
    localDrawEssentials.CTRL_PTS = evt.currentGeometry;
    
    const pl = new Polyline({
      spatialReference: this.view.spatialReference
    });
    pl.addPath(evt.currentGeometry.map((pt: Point) => [pt.x, pt.y]));
    
    this.emit("onDrawProgress", {
      currentGeometry: pl,
      currentDrawEssentials: localDrawEssentials,
      currentMarker: evt.currentMarker,
      isBaseLine: true
    });
  }

  private baseLineClick(evt: any): void {
    this.emit("onDrawClick", { currentPts: evt.currentGeometry, isBaseLine: true });
  }

  private createSymbol(drawEssentials: DrawEssentials): Polyline {
    try {
      let pts: Point[];

      if (drawEssentials.hasOwnProperty("CTRL_PTS") && drawEssentials.CTRL_PTS) {
        pts = drawEssentials.CTRL_PTS;
      } else {
        throw new Error("controlPoints not found");
      }

      const stPt = drawEssentials.BASE_LN_PTS.startPt;
      const endPt = drawEssentials.BASE_LN_PTS.endPt;

      const firstPoint = pts[0];
      const lastPoint = pts[pts.length - 1];
      const leftArray: any[] = [];
      const rightArray: any[] = [];
      const middleArray: any[] = [];

      if (stPt === undefined || endPt === undefined) {
        throw new Error("First Parameter of the Function is an Array with Start and End Point");
      }

      const midPt = GeoTools.getMidPoint(stPt, endPt);
      const result = new Polyline({
        spatialReference: this.view.spatialReference
      });

      // Base Line
      if (pts.length >= 1) {
        lastPoint = firstPoint;
      }

      let len = GeoTools._2PtLen(midPt, lastPoint);
      let k = Math.atan((midPt.y - lastPoint.y) / (midPt.x - lastPoint.x));

      switch (GeoTools.twoPtsRelationShip(midPt, lastPoint)) {
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
      const p1 = { x: partialLen * Math.cos(k) + midPt.x, y: partialLen * Math.sin(k) + midPt.y };
      const p2 = { x: -1 * partialLen * Math.cos(k) + midPt.x, y: -1 * partialLen * Math.sin(k) + midPt.y };

      const paths = [p1, p2];
      result.addPath(paths.map(pt => [pt.x, pt.y]));

      // Front
      if (pts.length >= 1) {
        leftArray.push(p1);
        rightArray.push(p2);
        middleArray.push(midPt);
      }

      // leftArray is top arrow
      for (let i = 0; i < pts.length; i++) {
        const length = GeoTools._2PtLen(midPt, pts[i]);
        let angle = GeoTools.angleInRadians(midPt, pts[i]);

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

        len = length / 5;
        const baseLineLen = GeoTools._2PtLen(stPtCandidatePt, endPtCandidatePt);
        const baseLineLenLimit = baseLineLen / 4;
        if (len > baseLineLenLimit) len = baseLineLenLimit;

        const segmentAngle = GeoTools.angleInRadians(stPtCandidatePt, endPtCandidatePt);

        const pt1 = new Point({
          x: -1 * len * Math.cos(segmentAngle) + stPtCandidatePt.x,
          y: -1 * len * Math.sin(segmentAngle) + stPtCandidatePt.y,
          spatialReference: this.view.spatialReference
        });
        const pt2 = new Point({
          x: len * Math.cos(segmentAngle) + endPtCandidatePt.x,
          y: len * Math.sin(segmentAngle) + endPtCandidatePt.y,
          spatialReference: this.view.spatialReference
        });

        k = angle = GeoTools.angleInRadians(midPt, pts[i]);

        // Shorten Left Array Point
        const shortenLeftPt = {
          x: -1 * length / 10 * Math.cos(k) + stPtCandidatePt.x,
          y: -1 * length / 5 * Math.sin(k) + stPtCandidatePt.y
        };
        leftArray.push(shortenLeftPt);

        // Shorten Right Array Point
        const shortenRightPt = {
          x: -1 * length / 10 * Math.cos(k) + endPtCandidatePt.x,
          y: -1 * length / 5 * Math.sin(k) + endPtCandidatePt.y
        };
        rightArray.push(shortenRightPt);

        // Shorten Middle Array Point
        const shortenMiddlePt = {
          x: -1 * length / 10 * Math.cos(k) + pts[i].x,
          y: -1 * length / 10 * Math.sin(k) + pts[i].y
        };
        middleArray.push(shortenMiddlePt);
      }

      result.addPath(leftArray.map(pt => [pt.x, pt.y]));
      result.addPath(rightArray.map(pt => [pt.x, pt.y]));

      // Create Arrow Head
      const leftFlankPt = this.getFlankPts(shortenLeftPt, leftArray[0]);
      const rightFlankPt = this.getFlankPts(shortenRightPt, rightArray[0]);
      result.addPath([
        [shortenLeftPt.x, shortenLeftPt.y],
        [leftFlankPt[1].x, leftFlankPt[1].y],
        [pts[pts.length - 1].x, pts[pts.length - 1].y],
        [rightFlankPt[0].x, rightFlankPt[0].y],
        [shortenRightPt.x, shortenRightPt.y]
      ]);

      return result;
    } catch (e) {
      console.log(this.declaredClass + ' Cannot create Symbol due to invalid geometry');
      throw e;
    }
  }

  private getFlankPts(firstPoint: any, lastPoint: any): any[] {
    let cLenLimit;
    const baseLineLen = GeoTools._2PtLen(firstPoint, lastPoint) / 4;
    cLenLimit = baseLineLen / 4;
    if (cLenLimit > baseLineLen / 2) cLenLimit = baseLineLen / 2;

    const len = cLenLimit;
    let k = Math.atan((firstPoint.y - lastPoint.y) / (firstPoint.x - lastPoint.x));

    switch (GeoTools.twoPtsRelationShip(firstPoint, lastPoint)) {
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
    return [
      { x: partialLen * Math.cos(k) + firstPoint.x, y: partialLen * Math.sin(k) + firstPoint.y },
      { x: -1 * partialLen * Math.cos(k) + firstPoint.x, y: -1 * partialLen * Math.sin(k) + firstPoint.y }
    ];
  }

  public getBaseLinePts(): any {
    return this._baseLinePts;
  }

  private _onMouseMoveHandler(event: any): void {
    const candidatePoint = event.mapPoint;
    const drawEssentials = new DrawEssentials();
    drawEssentials.CTRL_PTS = [...this._points, candidatePoint];
    drawEssentials.BASE_LN_PTS = this._baseLinePts;

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
    
    if (this.isLine === true && this._points.length === 1) {
      this.cleanUp();
    }
  }

  private _onDoubleClickHandler(event: any): void {
    this._points.push(event.mapPoint.clone());
    this.cleanUp();
  }

  private cleanUp(): void {
    const drawEss = this.createDrawEssentials([...this._points], this._baseLinePts);
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
    this._baseLinePts = null;
  }

  private _removeEvents(): void {
    if (this._onClk) this._onClk.remove();
    if (this._onDblClk) this._onDblClk.remove();
    if (this._onMM) this._onMM.remove();
    if (this._onBaseLineEnd) this._onBaseLineEnd.remove();
    this.view.navigation.browserTouchPanEnabled = true;
  }

  public deactivate(): void {
    this._clear();
    this._removeEvents();
    this._geometryType = null;
  }

  private _arrowHead(candidatePoint: Point, length: number, angle: number): number[][] {
    const path: number[][] = [];

    angle += 15;
    const angle1 = GeoTools.toDegrees(angle); // In Degrees
    angle -= 30;
    const angle2 = GeoTools.toDegrees(angle);

    const rightWing = new Point({
      x: candidatePoint.x + length * Math.cos(GeoTools.toRad(angle1)),
      y: candidatePoint.y + length * Math.sin(GeoTools.toRad(angle1)),
      spatialReference: this.view.spatialReference
    });

    const leftWing = new Point({
      x: candidatePoint.x + length * Math.cos(GeoTools.toRad(angle2)),
      y: candidatePoint.y + length * Math.sin(GeoTools.toRad(angle2)),
      spatialReference: this.view.spatialReference
    });

    path.push([rightWing.x, rightWing.y]);
    path.push([candidatePoint.x, candidatePoint.y]);
    path.push([leftWing.x, leftWing.y]);

    return path;
  }
} 