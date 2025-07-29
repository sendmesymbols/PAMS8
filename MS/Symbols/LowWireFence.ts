/**
 * Class Representing Low Wire Fence.
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

  static getDashPts(points: Point[], gapArray: number[]): Point[] {
    // Simplified implementation for placing crosses at intervals
    const result: Point[] = [];
    if (points.length < 2) return result;

    const totalLen = GeoTools._2PtLen(points[0], points[points.length - 1]);
    const gap = gapArray[0] || totalLen / 10;
    const numPoints = Math.floor(totalLen / gap);

    for (let i = 0; i <= numPoints; i++) {
      const ratio = i / numPoints;
      const x = points[0].x + ratio * (points[points.length - 1].x - points[0].x);
      const y = points[0].y + ratio * (points[points.length - 1].y - points[0].y);
      result.push(new Point({ x: x, y: y, spatialReference: points[0].spatialReference }));
    }

    return result;
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
}

class Shapes {
  static createEchelon(type: string, point: Point, size: number): number[][][] {
    // Create cross pattern for type '18'
    if (type === '18') {
      return [[
        [point.x - size, point.y - size],
        [point.x + size, point.y + size]
      ], [
        [point.x - size, point.y + size],
        [point.x + size, point.y - size]
      ]];
    }
    return [];
  }
}

interface LowWireFenceOptions {
  CTRL_PTS?: Point[];
  GEOM?: Polyline;
}

export default class LowWireFence extends Evented {
  public declaredClass: string = "MilitarySymbology.Symbols.LowWireFence";
  public SID: string = "290305";
  public symName: string = "Wire Obs - Low Wire Fence";
  public symGeometricType: string = "Line";
  public isObstacle: string = "1";

  private view: ViewType;
  private isLine: boolean;
  private _lineSym: any;
  private _points: Point[] = [];
  private _geometryType: any = null;
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

  public init(options: LowWireFenceOptions, marker: any): void {
    this._lineSym = marker;
    
    // Disable map navigation during drawing
    this.view.navigation.browserTouchPanEnabled = false;

    const drawEssentials = new DrawEssentials();

    if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
      this._tGraphic.geometry = options.GEOM!;
      const drawEss = this.createDrawEssentials([...options.CTRL_PTS!]);
      this.__drawEnd(this._tGraphic.geometry as Polyline, drawEss);
      this._clear();
    } else if (options.hasOwnProperty("CTRL_PTS")) {
      const drawEss = this.createDrawEssentials([...options.CTRL_PTS!]);
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

  private createDrawEssentials(ctrlPts: Point[]): DrawEssentials {
    const drawEssentials = new DrawEssentials();
    drawEssentials.SCOPE = this;
    drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
    drawEssentials.SID = this.SID;
    drawEssentials.SYM_NAME = this.symName;
    drawEssentials.CTRL_PTS = ctrlPts;
    drawEssentials.IS_OBS = this.isObstacle;
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

      // Add Crosses
      let gapRatio = GeoTools._2PtLen(pts[0], pts[pts.length - 1]);
      gapRatio = gapRatio / 20;

      const baseLineLen = GeoTools._2PtLen(pts[0], pts[pts.length - 1]) / 7;
      let cLenLimit = baseLineLen / 7;
      if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;

      const resPts = GeoTools.getDashPts(pts, [gapRatio, gapRatio]);
      for (let i = 0; i < resPts.length; i++) {
        const echelons = Shapes.createEchelon('18', resPts[i], cLenLimit);
        for (let j = 0; j <= echelons.length - 1; j++) {
          result.addPath(echelons[j]);
        }
      }

      // Create parallel lines
      const firstPoint = pts[0];
      const lastPoint = pts[pts.length - 1];
      const rightArray: number[][] = [];

      let len = cLenLimit;
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
      const p1 = { 
        x: partialLen * Math.cos(k) + firstPoint.x, 
        y: partialLen * Math.sin(k) + firstPoint.y 
      };
      const p2 = { 
        x: -1 * partialLen * Math.cos(k) + firstPoint.x, 
        y: -1 * partialLen * Math.sin(k) + firstPoint.y 
      };

      // Add first parallel line segment
      result.addPath([[p1.x, p1.y], [p2.x, p2.y]]);

      if (pts.length >= 1) {
        rightArray.push([p2.x, p2.y]);
      }

      // Create parallel lines for each point
      for (let i = 0; i < pts.length; i++) {
        const length = GeoTools._2PtLen(firstPoint, pts[i]);
        const angle = GeoTools.angleInRadians(firstPoint, pts[i]);

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

        // Calculate segment length
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

        rightArray.push([endPtCandidatePt.x, endPtCandidatePt.y]);
      }

      result.addPath(rightArray);
      return result;
    } catch (e) {
      console.log(this.declaredClass + ' Cannot create Symbol due to invalid geometry');
      throw e;
    }
  }

  private _onMouseMoveHandler(event: any): void {
    const candidatePoint = event.mapPoint;
    const drawEssentials = this.createDrawEssentials([...this._points, candidatePoint]);

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
    const drawEss = this.createDrawEssentials([...this._points]);
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