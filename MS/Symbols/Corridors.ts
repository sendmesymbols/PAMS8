/**
 * Class Representing Corridors.
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
  static setDefault(obj: any, key: string, defaultValue: any): any {
    return obj && obj[key] !== undefined ? obj[key] : defaultValue;
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
  
  static angleInRadians(pt1: Point, pt2: Point): number {
    return Math.atan2(pt2.y - pt1.y, pt2.x - pt1.x);
  }
  
  static _2PtLen(pt1: Point, pt2: Point): number {
    return Math.sqrt(Math.pow(pt2.x - pt1.x, 2) + Math.pow(pt2.y - pt1.y, 2));
  }
  
  static toDegrees(rad: number): number {
    return rad * (180 / Math.PI);
  }
  
  static toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }
  
  static twoPtsRelationShip(pt1: Point, pt2: Point): string {
    if (pt2.x >= pt1.x && pt2.y >= pt1.y) return "ne";
    if (pt2.x <= pt1.x && pt2.y >= pt1.y) return "nw";
    if (pt2.x <= pt1.x && pt2.y <= pt1.y) return "sw";    
    return "se";
  }
}

class DrawEssentials {
  SCOPE?: any;
  SYM_GEO_TYPE?: string;
  SID?: string;
  SYM_NAME?: string;
  CTRL_PTS?: Point[];
  AMPLIFIER?: any;
  ECHELON?: number;
  TAIL_FACTOR?: number;
}

class Shapes {
  static createEchelon(echelon: number, center: Point, size: number, angle: number): number[][][] {
    const result: number[][][] = [];
    const numLines = Math.max(1, echelon || 1);
    
    for (let i = 0; i < numLines; i++) {
      const offset = (i - (numLines - 1) / 2) * size * 0.5;
      const x1 = center.x + Math.cos(angle + Math.PI / 2) * offset - Math.cos(angle) * size;
      const y1 = center.y + Math.sin(angle + Math.PI / 2) * offset - Math.sin(angle) * size;
      const x2 = center.x + Math.cos(angle + Math.PI / 2) * offset + Math.cos(angle) * size;
      const y2 = center.y + Math.sin(angle + Math.PI / 2) * offset + Math.sin(angle) * size;
      
      result.push([[x1, y1], [x2, y2]]);
    }
    
    return result;
  }
}

interface CorridorsOptions {
  CTRL_PTS?: Point[];
  GEOM?: Polyline;
  ECHELON?: number;
  TAIL_FACTOR?: number;
}

export default class Corridors extends Evented {
  public declaredClass: string = "MilitarySymbology.Symbols.Corridors";
  public SID: string = "110101";
  public symName: string = "Mob Corridors";
  public symGeometricType: string = "Line";

  private view: ViewType;
  private isLine: boolean;
  private _lineSym: any;
  private _points: Point[] = [];
  private _geometryType: any = null;
  private _echelon: number = 0;
  private _tailFactor: number = 0.17;
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

  public init(options: CorridorsOptions, marker: any): void {
    this._lineSym = marker;
    
    // Disable map navigation during drawing
    this.view.navigation.browserTouchPanEnabled = false;
    
    this._tailFactor = GeoTools.setDefault(options, "TAIL_FACTOR", this._tailFactor);
    this._echelon = options.ECHELON || 0;

    const drawEssentials = new DrawEssentials();

    if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
      this._tGraphic.geometry = options.GEOM!;
      const drawEss = this.createDrawEssentials([...options.CTRL_PTS!], options.ECHELON, this._tailFactor);
      this.__drawEnd(this._tGraphic.geometry as Polyline, drawEss);
      this._clear();
    } else if (options.hasOwnProperty("CTRL_PTS")) {
      const drawEss = this.createDrawEssentials([...options.CTRL_PTS!], options.ECHELON, this._tailFactor);
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

  private createDrawEssentials(ctrlPts: Point[], echelon?: number, tailFactor?: number): DrawEssentials {
    const drawEssentials = new DrawEssentials();
    drawEssentials.SCOPE = this;
    drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
    drawEssentials.SID = this.SID;
    drawEssentials.SYM_NAME = this.symName;
    drawEssentials.CTRL_PTS = ctrlPts;
    drawEssentials.ECHELON = echelon;
    drawEssentials.TAIL_FACTOR = tailFactor;
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
      
      const lastPoint = pts[pts.length - 1];
      const firstPoint = pts[0];

      const values = GeoTools._fracture(pts, 20, this.view.spatialReference);

      // Write in between Fractures
      for (let i = 0; i < values.midPoints.length; i++) {
        const k = GeoTools.angleInRadians(pts[i], values.midPoints[i].midPt);
        const length = GeoTools._2PtLen(pts[i], values.midPoints[i].midPt) / 10;
        
        const cLenLimit = values.midPoints[i].len / 6 / 6;
        const echelons = Shapes.createEchelon(
          drawEssentials.ECHELON || 0, 
          values.midPoints[i].midPt, 
          cLenLimit, 
          GeoTools.angleInRadians(pts[i], values.midPoints[i].midPt)
        );
        
        for (let j = 0; j <= echelons.length - 1; j++) {
          values.geometry.addPath(echelons[j]);
        }
      }

      // Add Notches
      const firstNotches = this._createStNotches(firstPoint, pts[1], this._tailFactor);
      firstNotches[1] = [firstPoint.x, firstPoint.y];
      values.geometry.addPath(firstNotches);

      let lastNotches: number[][];
      if (pts.length <= 2) {
        lastNotches = this._createStNotches(lastPoint, firstPoint, this._tailFactor);
      } else {
        lastNotches = this._createStNotches(lastPoint, pts[pts.length - 2], this._tailFactor);
      }

      lastNotches[1] = [lastPoint.x, lastPoint.y];
      values.geometry.addPath(lastNotches);

      return values.geometry;
    } catch (e) {
      console.log(this.declaredClass + ' Cannot create Symbol due to invalid geometry');
      throw e;
    }
  }

  private _onMouseMoveHandler(event: any): void {
    const candidatePoint = event.mapPoint;
    const drawEssentials = this.createDrawEssentials(
      [...this._points, candidatePoint],
      this._echelon,
      this._tailFactor
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
    const drawEss = this.createDrawEssentials([...this._points], this._echelon, this._tailFactor);
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

  private _createStNotches(firstPoint: Point, lastPoint: Point, tailFactor: number): number[][] {
    const len = GeoTools._2PtLen(firstPoint, lastPoint);
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

    k += GeoTools.toRad(45);
    const pt1 = [
      tailFactor * len * Math.cos(k) + firstPoint.x, 
      tailFactor * len * Math.sin(k) + firstPoint.y
    ];
    
    k -= GeoTools.toRad(90);
    const pt2 = [
      -1 * tailFactor * len * Math.cos(k) + firstPoint.x, 
      -1 * tailFactor * len * Math.sin(k) + firstPoint.y
    ];

    return [pt1, [0, 0], pt2]; // [0, 0] is placeholder for center pt, to be filled by caller
  }
} 