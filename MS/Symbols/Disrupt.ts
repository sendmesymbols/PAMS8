/**
 * Class Representing Disrupt.
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
  
  static angleInRadians(pt1: Point, pt2: Point): number {
    return Math.atan2(pt2.y - pt1.y, pt2.x - pt1.x);
  }
  
  static twoPtsRelationShip(pt1: Point, pt2: Point): string {
    if (pt2.x >= pt1.x && pt2.y >= pt1.y) return "ne";
    if (pt2.x <= pt1.x && pt2.y >= pt1.y) return "nw";
    if (pt2.x <= pt1.x && pt2.y <= pt1.y) return "sw";    
    return "se";
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
}

class DrawEssentials {
  SCOPE?: any;
  SYM_GEO_TYPE?: string;
  SID?: string;
  SYM_NAME?: string;
  CTRL_PTS?: Point[];
  BASE_LN_PTS?: { startPt: Point; endPt: Point };
  AMPLIFIER?: any;
}

class Shapes {
  static createD(midPt: Point, size: number, numberOfSegments: number): number[][] {
    // Create D shape
    const result: number[][] = [];
    const angleIncrement = Math.PI / numberOfSegments;
    
    for (let i = 0; i <= numberOfSegments; i++) {
      const angle = i * angleIncrement;
      const x = midPt.x + size * Math.cos(angle);
      const y = midPt.y + size * Math.sin(angle);
      result.push([x, y]);
    }
    
    return result;
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

// Simplified BaseLine class
class BaseLine extends Evented {
  private view: ViewType;
  private _lineSym: any;
  private _points: Point[] = [];
  private _tGraphic: Graphic;
  private _onClk: any;
  
  constructor(view: ViewType, symbol: any) {
    super();
    this.view = view;
    this._lineSym = symbol;
    this._tGraphic = new Graphic();
  }
  
  init(): void {
    this._tGraphic = new Graphic({ geometry: null, symbol: this._lineSym });
    this.view.graphics.add(this._tGraphic);
    this._onClk = this.view.on("click", (event) => this._onClickHandler(event));
  }
  
  private _onClickHandler(event: any): void {
    this._points.push(event.mapPoint.clone());
    
    if (this._points.length === 2) {
      const polyline = new Polyline({
        spatialReference: this.view.spatialReference
      });
      polyline.addPath([[this._points[0].x, this._points[0].y], [this._points[1].x, this._points[1].y]]);
      
      (polyline as any)._baseLine = { startPt: this._points[0], endPt: this._points[1] };
      (polyline as any).controlPoints = [...this._points];
      
      this.emit("drawEnd", { geometry: polyline });
      this._onClk.remove();
    }
  }
}

interface DisruptOptions {
  CTRL_PTS?: Point[];
  BASE_LN_PTS?: { startPt: Point; endPt: Point };
  GEOM?: Polyline;
}

export default class Disrupt extends Evented {
  public declaredClass: string = "MilitarySymbology.Symbols.Disrupt";
  public SID: string = "341000";
  public symName: string = "Disrupt";
  public symGeometricType: string = "Area";

  private view: ViewType;
  private isLine: boolean;
  private _lineSym: any;
  private _points: Point[] = [];
  private _baseLinePts: { startPt: Point; endPt: Point } | null = null;
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

  public init(options: DisruptOptions, marker: any): void {
    this._lineSym = marker;
    
    // Disable map navigation during drawing
    this.view.navigation.browserTouchPanEnabled = false;

    const drawEssentials = new DrawEssentials();
    const baseLine = new BaseLine(this.view, this._lineSym);

    if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("BASE_LN_PTS") && options.hasOwnProperty("GEOM")) {
      this._tGraphic.geometry = options.GEOM!;
      const drawEss = this.createDrawEssentials([...options.CTRL_PTS!], options.BASE_LN_PTS!);
      this.__drawEnd(this._tGraphic.geometry as Polyline, drawEss);
      this._clear();
    } else if (options.hasOwnProperty("CTRL_PTS")) {
      if (options.hasOwnProperty("BASE_LN_PTS")) {
        const drawEss = this.createDrawEssentials([...options.CTRL_PTS!], options.BASE_LN_PTS!);
        this._tGraphic.geometry = this.createSymbol(drawEss);
        this.__drawEnd(this._tGraphic.geometry as Polyline, drawEss);
        this._clear();
      } else {
        throw new Error("Control Points and Baseline or Distance is required to create symbol non-interactively");
      }
    } else {
      this._onBaseLineEnd = baseLine.on("drawEnd", (evt: any) => this.baseLineDrawEnd(evt));
      baseLine.init();
    }
  }

  private createDrawEssentials(ctrlPts: Point[], baseLinePts: { startPt: Point; endPt: Point }): DrawEssentials {
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
    this._onBaseLineEnd.remove();
    this._tGraphic = new Graphic({ geometry: evt.geometry, symbol: this._lineSym });
    this.view.graphics.add(this._tGraphic);
    this._baseLinePts = evt.geometry._baseLine;
    this._onMM = this.view.on("pointer-move", (event) => this._onMouseMoveHandler(event));
    this._onClk = this.view.on("click", (event) => this._onClickHandler(event));
    this._onDblClk = this.view.on("double-click", (event) => this._onDoubleClickHandler(event));
    this.emit("onBaseLineDrawEnd", { currentPts: evt.geometry.controlPoints });
  }

  private createSymbol(drawEssentials: DrawEssentials): Polyline {
    try {
      let pts: Point[];

      if (drawEssentials.hasOwnProperty("CTRL_PTS") && drawEssentials.CTRL_PTS) {
        pts = drawEssentials.CTRL_PTS;
      } else {
        throw new Error("controlPoints not found");
      }

      const stPt = drawEssentials.BASE_LN_PTS!.startPt;
      const endPt = drawEssentials.BASE_LN_PTS!.endPt;

      const firstPoint = pts[0];
      let lastPoint = pts[pts.length - 1];
      const leftArray: any[] = [];
      const rightArray: any[] = [];
      let middleArray: any[] = [];

      if (!stPt || !endPt) {
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

      const len = GeoTools._2PtLen(midPt, endPt);
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

      result.addPath([[p1.x, p1.y], [p2.x, p2.y]]);

      // Front
      if (pts.length >= 1) {
        leftArray.push(p1);
        rightArray.push(p2);
        middleArray.push(midPt);
      }

      let stPtCandidatePt: Point;
      let endPtCandidatePt: Point;
      let baseLineLen: number;

      for (let i = 0; i < pts.length; i++) {
        // Find distance between candidatePoint and Mid Point
        const length = GeoTools._2PtLen(midPt, pts[i]);
        const angle = GeoTools.angleInRadians(midPt, pts[i]);

        stPtCandidatePt = new Point({
          x: p1.x + length * Math.cos(angle),
          y: p1.y + length * Math.sin(angle),
          spatialReference: this.view.spatialReference
        });

        endPtCandidatePt = new Point({
          x: p2.x + length * Math.cos(angle),
          y: p2.y + length * Math.sin(angle),
          spatialReference: this.view.spatialReference
        });

        let len2 = length / 5;
        baseLineLen = GeoTools._2PtLen(stPtCandidatePt, endPtCandidatePt);

        const baseLineLenLimit = baseLineLen / 4;
        if (len2 > baseLineLenLimit) len2 = baseLineLenLimit;

        k = GeoTools.angleInRadians(midPt, pts[i]);

        // Shorten Left Array Point
        const shortenLeftPt = {
          x: -1 * length / 5 * Math.cos(k) + stPtCandidatePt.x,
          y: -1 * length / 5 * Math.sin(k) + stPtCandidatePt.y
        };
        leftArray.push(shortenLeftPt);

        // Shorten Middle Array Point
        const shortenMiddlePt = {
          x: -1 * length / 10 * Math.cos(k) + pts[i].x,
          y: -1 * length / 10 * Math.sin(k) + pts[i].y
        };
        middleArray.push(shortenMiddlePt);

        rightArray.push(endPtCandidatePt);
      }

      result.addPath(leftArray.map(p => Array.isArray(p) ? p : [p.x, p.y]));
      result.addPath(rightArray.map(p => Array.isArray(p) ? p : [p.x, p.y]));

      const values = GeoTools._fracture(middleArray.map(p => new Point({
        x: p.x,
        y: p.y,
        spatialReference: this.view.spatialReference
      })), 10, this.view.spatialReference);

      if (values && values.geometry && values.geometry.paths) {
        result.paths = result.paths.concat(values.geometry.paths);
      }

      for (let i = 0; i < values.midPoints.length; i++) {
        let cLenLimit = values.midPoints[i].len / 2;
        if (cLenLimit > baseLineLen! / 3.6) cLenLimit = baseLineLen! / 3.6;
        result.addPath(Shapes.createD(values.midPoints[i].midPt, cLenLimit, 40));
      }

      // Arrows
      if (leftArray.length >= 2) {
        result.addPath(Shapes.arrowHead(
          new Point({ x: leftArray[leftArray.length - 1].x, y: leftArray[leftArray.length - 1].y, spatialReference: this.view.spatialReference }),
          GeoTools.ArrowFlanksLen(GeoTools._2PtLen(midPt, pts[pts.length - 1]), GeoTools._2PtLen(stPtCandidatePt!, endPtCandidatePt!)),
          GeoTools.angleInRadians(
            new Point({ x: leftArray[leftArray.length - 2].x, y: leftArray[leftArray.length - 2].y, spatialReference: this.view.spatialReference }),
            new Point({ x: leftArray[leftArray.length - 1].x, y: leftArray[leftArray.length - 1].y, spatialReference: this.view.spatialReference })
          )
        ));

        result.addPath(Shapes.arrowHead(
          rightArray[rightArray.length - 1],
          GeoTools.ArrowFlanksLen(GeoTools._2PtLen(midPt, pts[pts.length - 1]), GeoTools._2PtLen(stPtCandidatePt!, endPtCandidatePt!)),
          GeoTools.angleInRadians(rightArray[rightArray.length - 2], rightArray[rightArray.length - 1])
        ));

        result.addPath(Shapes.arrowHead(
          new Point({ x: middleArray[middleArray.length - 1].x, y: middleArray[middleArray.length - 1].y, spatialReference: this.view.spatialReference }),
          GeoTools.ArrowFlanksLen(GeoTools._2PtLen(midPt, pts[pts.length - 1]), GeoTools._2PtLen(stPtCandidatePt!, endPtCandidatePt!)),
          GeoTools.angleInRadians(
            new Point({ x: middleArray[middleArray.length - 2].x, y: middleArray[middleArray.length - 2].y, spatialReference: this.view.spatialReference }),
            new Point({ x: middleArray[middleArray.length - 1].x, y: middleArray[middleArray.length - 1].y, spatialReference: this.view.spatialReference })
          )
        ));
      }

      // Back line
      k = GeoTools.angleInRadians(midPt, pts[0]);
      const elongateMiddlePt = {
        x: -1 * GeoTools._2PtLen(midPt, pts[0]) / 10 * Math.cos(k) + midPt.x,
        y: -1 * GeoTools._2PtLen(midPt, pts[0]) / 10 * Math.sin(k) + midPt.y
      };
      
      middleArray = [];
      middleArray.push(elongateMiddlePt, { x: midPt.x, y: midPt.y });
      result.addPath(middleArray.map(p => [p.x, p.y]));

      return result;
    } catch (e) {
      console.log(this.declaredClass + ' Cannot create Symbol due to invalid geometry');
      throw e;
    }
  }

  public getBaseLinePts(): { startPt: Point; endPt: Point } | null {
    return this._baseLinePts;
  }

  private _onMouseMoveHandler(event: any): void {
    if (!this._baseLinePts) return;
    
    const candidatePoint = event.mapPoint;
    const drawEssentials = this.createDrawEssentials(
      [...this._points, candidatePoint],
      this._baseLinePts
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
    
    if (this.isLine === true && this._points.length === 1) {
      this.cleanUp();
    }
  }

  private _onDoubleClickHandler(event: any): void {
    this._points.push(event.mapPoint.clone());
    this.cleanUp();
  }

  private cleanUp(): void {
    if (!this._baseLinePts) return;
    
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
} 