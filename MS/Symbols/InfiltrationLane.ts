/**
 * Class Representing Infiltration Lane.
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
    if (pt2.x < pt1.x && pt2.y >= pt1.y) return "nw";
    if (pt2.x < pt1.x && pt2.y < pt1.y) return "sw";
    return "se";
  }

  static toDegrees(rad: number): number {
    return rad * (180 / Math.PI);
  }

  static toRad(deg: number): number {
    return deg * (Math.PI / 180);
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

// BaseLine placeholder - emits events for baseline drawing
class BaseLine extends Evented {
  private view: ViewType;
  private symbol: any;

  constructor(view: ViewType, symbol: any) {
    super();
    this.view = view;
    this.symbol = symbol;
  }

  init(): void {
    // Start baseline drawing - simplified implementation
    let points: Point[] = [];
    
    const clickHandler = this.view.on("click", (event: any) => {
      points.push(event.mapPoint.clone());
      
      if (points.length === 2) {
        clickHandler.remove();
        
        const geometry = new Polyline({
          spatialReference: this.view.spatialReference
        });
        geometry.addPath(points.map(p => [p.x, p.y]));
        
        // Add baseline property
        (geometry as any)._baseLine = {
          startPt: points[0],
          endPt: points[1]
        };
        
        this.emit("drawEnd", { 
          geometry: geometry,
          controlPoints: points
        });
      }
    });
  }
}

interface InfiltrationLaneOptions {
  CTRL_PTS?: Point[];
  BASE_LN_PTS?: any;
  GEOM?: Polyline;
}

export default class InfiltrationLane extends Evented {
  public declaredClass: string = "MilitarySymbology.Symbols.InfiltrationLane";
  public SID: string = "140800";
  public symName: string = "Infiltration Lane";
  public symGeometricType: string = "Area";

  private view: ViewType;
  private isLine: boolean;
  private _lineSym: any;
  private _points: Point[] = [];
  private _baseLinePts: any = [];
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

  public init(options: InfiltrationLaneOptions, marker: any): void {
    this._lineSym = marker;
    
    // Disable map navigation during drawing
    this.view.navigation.browserTouchPanEnabled = false;

    const drawEssentials = new DrawEssentials();

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
      const baseLine = new BaseLine(this.view, this._lineSym);
      this._onBaseLineEnd = baseLine.on("drawEnd", (evt: any) => this.baseLineDrawEnd(evt));
      this._onBaseLineClick = baseLine.on("onBaseLineClick", (evt: any) => this.baseLineClick(evt));
      this._onBaseLineProgress = baseLine.on("onBaseLineProgress", (evt: any) => this.baseLineDrawProgress(evt));
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
    this._setupMainEventHandlers();
    this.emit("onBaseLineDrawEnd", { currentPts: evt.geometry.controlPoints });
  }

  private _setupMainEventHandlers(): void {
    this._onMM = this.view.on("pointer-move", (event) => this._onMouseMoveHandler(event));
    this._onClk = this.view.on("click", (event) => this._onClickHandler(event));
    this._onDblClk = this.view.on("double-click", (event) => this._onDoubleClickHandler(event));
  }

  private baseLineDrawProgress(evt: any): void {
    const localDrawEssentials: any = [];
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

      if (stPt === undefined || endPt === undefined) {
        throw new Error("First Parameter of the Function is an Array with Start and End Point");
      }

      const firstPoint = pts[0];
      let lastPoint = pts[pts.length - 1];
      const leftArray: any[] = [];
      const rightArray: any[] = [];

      const midPt = GeoTools.getMidPoint(stPt, endPt);
      const result = new Polyline({ spatialReference: this.view.spatialReference });

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

      // Front
      if (pts.length >= 1) {
        leftArray.push(p1);
        rightArray.push(p2);
      }

      // leftArray is top arrow
      for (let i = 0; i < pts.length; i++) {
        // Find distance between candidatePoint and Mid Point
        const length = GeoTools._2PtLen(midPt, pts[i]);
        const angle = GeoTools.angleInRadians(midPt, pts[i]);

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

      result.addPath(leftArray.map(p => [p.x, p.y]));
      result.addPath(rightArray.map(p => [p.x, p.y]));

      return result;
    } catch (e) {
      console.log(this.declaredClass + ' Cannot create Symbol due to invalid geometry');
      throw e;
    }
  }

  public getBaseLinePts(): any {
    return this._baseLinePts;
  }

  private _onMouseMoveHandler(event: any): void {
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
    this._baseLinePts = [];
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