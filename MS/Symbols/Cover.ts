/**
 * Class Representing Cover.
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
  
  static toDegrees(rad: number): number {
    return rad * (180 / Math.PI);
  }
  
  static toRad(deg: number): number {
    return deg * (Math.PI / 180);
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
  AMPLIFIER?: any;
  ECHLON?: number;
}

class Shapes {
  static createCC(x: number, y: number, size: number, spatialRef: any): number[][] {
    // Create a simple C shape
    const halfSize = size / 2;
    return [
      [x - halfSize, y + halfSize],
      [x - halfSize, y - halfSize],
      [x + halfSize, y - halfSize],
      [x + halfSize, y],
      [x - halfSize, y],
      [x - halfSize, y + halfSize]
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
  
  static arrowHeadBackward(tip: Point, length: number, angle: number): number[][] {
    return Shapes.arrowHead(tip, length, angle + Math.PI);
  }
}

interface CoverOptions {
  CTRL_PTS?: Point[];
  GEOM?: Polyline;
  ECHLON?: number;
}

export default class Cover extends Evented {
  public declaredClass: string = "MilitarySymbology.Symbols.Cover";
  public SID: string = "342201";
  public symName: string = "Covering Tps";
  public symGeometricType: string = "Area";

  private view: ViewType;
  private isLine: boolean;
  private _lineSym: any;
  private _points: Point[] = [];
  private _geometryType: any = null;
  private _echlon: number = 0;
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

  public init(options: CoverOptions, marker: any): void {
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

      const secondPoint = pts[1];
      const firstPoint = pts[0];

      // Arrow Head (backward)
      const arrowPath = Shapes.arrowHeadBackward(
        firstPoint, 
        GeoTools.ArrowFlanksLen(
          GeoTools._2PtLen(firstPoint, secondPoint), 
          GeoTools._2PtLen(firstPoint, secondPoint)
        ), 
        GeoTools.angleInRadians(firstPoint, secondPoint)
      );
      result.addPath(arrowPath);

      const midPt = GeoTools.getMidPoint(firstPoint, secondPoint);
      const length = GeoTools._2PtLen(firstPoint, midPt) / 3;
      const angle = GeoTools.toDegrees(16); // In Degrees

      const rightWing = new Point({
        x: midPt.x + length * Math.cos(this.toRad(angle)),
        y: midPt.y + length * Math.sin(this.toRad(angle)),
        spatialReference: this.view.spatialReference
      });

      const wingAngle = GeoTools.angleInRadians(rightWing, secondPoint);
      const gapPt = new Point({
        x: rightWing.x + length * 2 * Math.cos(wingAngle),
        y: rightWing.y + length * 2 * Math.sin(wingAngle),
        spatialReference: this.view.spatialReference
      });

      // Create C
      const baseLineLen = GeoTools._2PtLen(firstPoint, secondPoint);
      let cLenLimit = baseLineLen / 25;
      if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;

      const cPt = new Point({
        x: gapPt.x + cLenLimit * 1.5 * Math.cos(wingAngle),
        y: gapPt.y + cLenLimit * 1.5 * Math.sin(wingAngle),
        spatialReference: this.view.spatialReference
      });

      result.addPath(Shapes.createCC(cPt.x, cPt.y, cLenLimit, this.view.spatialReference));

      // Add main path
      result.addPath([
        [firstPoint.x, firstPoint.y],
        [midPt.x, midPt.y],
        [rightWing.x, rightWing.y],
        [gapPt.x, gapPt.y]
      ]);

      if (pts.length === 3) {
        const thirdPt = pts[2];

        const midPt2 = GeoTools.getMidPoint(thirdPt, secondPoint);
        const length2 = GeoTools._2PtLen(thirdPt, midPt2) / 3;
        const angle2 = GeoTools.toDegrees(-32); // In Degrees

        const leftWing = new Point({
          x: midPt2.x + length2 * Math.cos(GeoTools.toRad(angle2)),
          y: midPt2.y + length2 * Math.sin(GeoTools.toRad(angle2)),
          spatialReference: this.view.spatialReference
        });

        const leftWingAngle = GeoTools.angleInRadians(leftWing, secondPoint);
        const gapPt2 = new Point({
          x: leftWing.x + length2 * 2 * Math.cos(leftWingAngle),
          y: leftWing.y + length2 * 2 * Math.sin(leftWingAngle),
          spatialReference: this.view.spatialReference
        });

        // Create C for left side
        const baseLineLen2 = GeoTools._2PtLen(thirdPt, secondPoint);
        let cLenLimit2 = baseLineLen2 / 25;
        if (cLenLimit2 > baseLineLen2 / 3.6) cLenLimit2 = baseLineLen2 / 3.6;

        const cPt2 = new Point({
          x: gapPt2.x + cLenLimit2 * 1.5 * Math.cos(leftWingAngle),
          y: gapPt2.y + cLenLimit2 * 1.5 * Math.sin(leftWingAngle),
          spatialReference: this.view.spatialReference
        });

        result.addPath(Shapes.createCC(cPt2.x, cPt2.y, cLenLimit2, this.view.spatialReference));

        result.addPath([
          [thirdPt.x, thirdPt.y],
          [midPt2.x, midPt2.y],
          [leftWing.x, leftWing.y],
          [gapPt2.x, gapPt2.y]
        ]);

        // Arrow head for third point
        const arrowPath2 = Shapes.arrowHead(
          thirdPt, 
          GeoTools.ArrowFlanksLen(
            GeoTools._2PtLen(secondPoint, thirdPt), 
            GeoTools._2PtLen(secondPoint, thirdPt)
          ),
          GeoTools.angleInRadians(secondPoint, thirdPt)
        );
        result.addPath(arrowPath2);
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
    
    if (this._points.length === 3) {
      this.cleanUp();
    }
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

  private toDegrees(rad: number): number {
    const angleDeg = rad * (180 / Math.PI);
    const result = ((angleDeg + 360) % 360);
    return isNaN(result) ? 0 : result;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  private angleRadians(p1: Point, p2: Point): number {
    return Math.atan2(p2.y - p1.y, p2.x - p1.x);
  }
} 