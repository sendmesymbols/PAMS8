/**
 * Class Representing Funnel.
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
  static setDefault(options: any, key: string, defaultValue: any): any {
    return options.hasOwnProperty(key) ? options[key] : defaultValue;
  }

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

  static _circleDrawEx(pt1: any, pt2: any, pt3: any): { radius: number } {
    // Simplified circle calculation
    const dx1 = pt2.x - pt1.x;
    const dy1 = pt2.y - pt1.y;
    const dx2 = pt3.x - pt1.x;
    const dy2 = pt3.y - pt1.y;
    const dist = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    return { radius: dist };
  }

  static CreateCircleSegmentFromThreePoints(
    circle: any, 
    pt1: any, 
    pt2: any, 
    pt3: any, 
    numPts: number, 
    view: ViewType
  ): { geometry: Polyline } {
    // Create a simplified arc between points
    const path: number[][] = [];
    for (let i = 0; i <= numPts; i++) {
      const angle = (i / numPts) * Math.PI;
      const screenX = pt1.x + circle.radius * Math.cos(angle);
      const screenY = pt1.y + circle.radius * Math.sin(angle);
      const mapPoint = view.toMap({ x: screenX, y: screenY });
      if (mapPoint) {
        path.push([mapPoint.x, mapPoint.y]);
      }
    }
    
    const result = new Polyline({
      spatialReference: view.spatialReference
    });
    result.addPath(path);
    
    return { geometry: result };
  }

  static ArrowFlanksLen(len1: number, len2: number): number {
    return Math.max(len1, len2) / 4;
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
  FRNT_LN_ANGL_RATIO?: number;
  FRNT_LN_DIST_RATIO?: number;
  FLAP_DIST_RATIO?: number;
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

interface FunnelOptions {
  CTRL_PTS?: Point[];
  BASE_LN_PTS?: any;
  GEOM?: Polyline;
  FRNT_LN_ANGL_RATIO?: number;
  FRNT_LN_DIST_RATIO?: number;
  FLAP_DIST_RATIO?: number;
}

export default class Funnel extends Evented {
  public declaredClass: string = "MilitarySymbology.Symbols.Funnel";
  public SID: string = "151407";
  public symName: string = "Funnel";
  public symGeometricType: string = "Area";

  private view: ViewType;
  private isLine: boolean;
  private _lineSym: any;
  private _points: Point[] = [];
  private _baseLinePts: any = [];
  private _geometryType: any = null;
  private frontLineAgle: number = 0.8;
  private frontLineDist: number = 1.5;
  private flapDist: number = 3;
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

  public init(options: FunnelOptions, marker: any): void {
    this._lineSym = marker;
    
    // Disable map navigation during drawing
    this.view.navigation.browserTouchPanEnabled = false;
    
    this.frontLineAgle = GeoTools.setDefault(options, "FRNT_LN_ANGL_RATIO", 0.8);
    this.frontLineDist = GeoTools.setDefault(options, "FRNT_LN_DIST_RATIO", 1.5);
    this.flapDist = GeoTools.setDefault(options, "FLAP_DIST_RATIO", 3);

    const drawEssentials = new DrawEssentials();

    if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("BASE_LN_PTS") && options.hasOwnProperty("GEOM")) {
      this._tGraphic.geometry = options.GEOM!;
      const drawEss = this.createDrawEssentials([...options.CTRL_PTS!], options.BASE_LN_PTS, this.frontLineAgle, this.frontLineDist, this.flapDist);
      this.__drawEnd(this._tGraphic.geometry as Polyline, drawEss);
      this._clear();
    } else if (options.hasOwnProperty("CTRL_PTS")) {
      if (options.hasOwnProperty("BASE_LN_PTS")) {
        const drawEss = this.createDrawEssentials([...options.CTRL_PTS!], options.BASE_LN_PTS, this.frontLineAgle, this.frontLineDist, this.flapDist);
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

  private createDrawEssentials(ctrlPts: Point[], baseLinePts: any, frontLineAngleRatio: number, frontLineDistRatio: number, flapDistRatio: number): DrawEssentials {
    const drawEssentials = new DrawEssentials();
    drawEssentials.SCOPE = this;
    drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
    drawEssentials.SID = this.SID;
    drawEssentials.SYM_NAME = this.symName;
    drawEssentials.FRNT_LN_ANGL_RATIO = frontLineAngleRatio;
    drawEssentials.FRNT_LN_DIST_RATIO = frontLineDistRatio;
    drawEssentials.FLAP_DIST_RATIO = flapDistRatio;
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

      const frontLineAgle = GeoTools.setDefault(drawEssentials, "FRNT_LN_ANGL_RATIO", 0.8);
      const frontLineDist = GeoTools.setDefault(drawEssentials, "FRNT_LN_DIST_RATIO", 1.5);
      const flapDistRatio = GeoTools.setDefault(drawEssentials, "FLAP_DIST_RATIO", 3);

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

      let len = GeoTools._2PtLen(midPt, endPt);
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

      let paths: any[] = [];
      paths = paths.concat(p1, p2);
      result.addPath(paths);

      // Front
      if (pts.length >= 1) {
        leftArray.push(p1);
        rightArray.push(p2);

        if (pts[0] === undefined) {
          throw new Error("Insufficient Pts");
        } else {
          const length = GeoTools._2PtLen(midPt, pts[0]) / frontLineDist;
          const angle = GeoTools.angleInRadians(midPt, pts[0]);

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

          // Flaps
          len = length / flapDistRatio + GeoTools._2PtLen(pts[0], pts[pts.length - 1]);
          let flapAngle = GeoTools.angleInRadians(stPtCandidatePt, endPtCandidatePt) - frontLineAgle;

          const pt1 = new Point({
            x: -1 * len * Math.cos(flapAngle) + stPtCandidatePt.x, 
            y: -1 * len * Math.sin(flapAngle) + stPtCandidatePt.y, 
            spatialReference: this.view.spatialReference
          });
          flapAngle = GeoTools.angleInRadians(stPtCandidatePt, endPtCandidatePt) + frontLineAgle;
          const pt2 = new Point({
            x: len * Math.cos(flapAngle) + endPtCandidatePt.x, 
            y: len * Math.sin(flapAngle) + endPtCandidatePt.y, 
            spatialReference: this.view.spatialReference
          });

          leftArray.push(pt1);
          rightArray.push(pt2);

          // Funnel Head
          const candidatePoint = pts[pts.length - 1];
          const circle = GeoTools._circleDrawEx(this.view.toScreen(pt1), this.view.toScreen(pt2), this.view.toScreen(candidatePoint));
          if (circle.radius > 0) {
            const values = GeoTools.CreateCircleSegmentFromThreePoints(circle, this.view.toScreen(pt1), this.view.toScreen(pt2), this.view.toScreen(candidatePoint), 60, this.view);
            const circlepaths = values.geometry.paths[0];
            result.addPath(circlepaths.slice(0, 61));
          }
        }
      }

      result.addPath(leftArray);
      result.addPath(rightArray);

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
      this._baseLinePts,
      this.frontLineAgle,
      this.frontLineDist,
      this.flapDist
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
    
    if (this._points.length == 2) {
      this.cleanUp();
    }
  }

  private _onDoubleClickHandler(event: any): void {
    if (this._points.length >= 1) {
      this._points.push(event.mapPoint.clone());
      this.cleanUp();
    }
  }

  private cleanUp(): void {
    const drawEss = this.createDrawEssentials([...this._points], this._baseLinePts, this.frontLineAgle, this.frontLineDist, this.flapDist);
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