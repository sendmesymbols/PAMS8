/**
 * Class Representing Ditch Filled With Water.
 * @class
 * @author Abdul Razak
 */

import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import Color from "@arcgis/core/Color";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
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
}

class DrawEssentials {
  SCOPE?: any;
  SYM_GEO_TYPE?: string;
  SID?: string;
  SYM_NAME?: string;
  CTRL_PTS?: Point[];
  AMPLIFIER?: any;
  IS_OBS?: string;
  TEETH_SIZE?: number;
  TEETH_GAP?: number;
  opacity?: number;
}

interface DitchFilledWithWaterOptions {
  CTRL_PTS?: Point[];
  GEOM?: Polygon;
  TEETH_SIZE?: number;
  TEETH_GAP?: number;
  opacity?: number;
}

export default class DitchFilledWithWater extends Evented {
  public declaredClass: string = "MilitarySymbology.Symbols.DitchFilledWithWater";
  public SID: string = "290202";
  public symName: string = "DCB - Filled With Water";
  public symGeometricType: string = "Line";
  public isObstacle: string = "1";

  private view: ViewType;
  private isLine: boolean;
  private _lineSym: any;
  private _points: Point[] = [];
  private _geometryType: any = null;
  private _teethSize: number = 3;
  private _teethGap: number = 20;
  private _headRatio: number = 10;
  private _tailRatio: number = 10;
  private _opacity: number = 1;
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

  public init(options: DitchFilledWithWaterOptions, marker: any): void {
    this._opacity = options.hasOwnProperty('opacity') ? options.opacity! : 1;

    // Create blue filled symbol with water
    this._lineSym = new SimpleFillSymbol({
      style: "solid",
      outline: new SimpleLineSymbol({
        style: "solid",
        color: new Color([0, 0, 0, this._opacity]),
        width: marker.width || 2
      }),
      color: new Color([0, 0, 255, this._opacity])
    });
    
    // Disable map navigation during drawing
    this.view.navigation.browserTouchPanEnabled = false;

    const drawEssentials = new DrawEssentials();
    this._teethSize = GeoTools.setDefault(options, "TEETH_SIZE", this._teethSize);
    this._teethGap = GeoTools.setDefault(options, "TEETH_GAP", this._teethGap);

    if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
      this._tGraphic.geometry = options.GEOM!;
      const drawEss = this.createDrawEssentials([...options.CTRL_PTS!], this._teethSize, this._teethGap, this._opacity);
      this.__drawEnd(this._tGraphic.geometry as Polygon, drawEss);
      this._clear();
    } else if (options.hasOwnProperty("CTRL_PTS")) {
      const drawEss = this.createDrawEssentials([...options.CTRL_PTS!], this._teethSize, this._teethGap, this._opacity);
      this._tGraphic.geometry = this.createSymbol(drawEss);
      this.__drawEnd(this._tGraphic.geometry as Polygon, drawEss);
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

  private createDrawEssentials(ctrlPts: Point[], teethSize: number, teethGap: number, opacity: number): DrawEssentials {
    const drawEssentials = new DrawEssentials();
    drawEssentials.SCOPE = this;
    drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
    drawEssentials.SID = this.SID;
    drawEssentials.SYM_NAME = this.symName;
    drawEssentials.CTRL_PTS = ctrlPts;
    drawEssentials.IS_OBS = this.isObstacle;
    drawEssentials.TEETH_SIZE = teethSize;
    drawEssentials.TEETH_GAP = teethGap;
    drawEssentials.opacity = opacity;
    return drawEssentials;
  }

  private createSymbol(drawEssentials: DrawEssentials): Polygon {
    try {
      let pts: Point[];

      if (drawEssentials.hasOwnProperty("CTRL_PTS") && drawEssentials.CTRL_PTS) {
        pts = drawEssentials.CTRL_PTS;
      } else {
        throw new Error("controlPoints not found");
      }

      const result = new Polygon({
        spatialReference: this.view.spatialReference
      });

      const firstPoint = pts[0];
      const lastPoint = pts[pts.length - 1];
      
      // Shorten Pts according to head and tail ratio
      const baseLineLen = GeoTools._2PtLen(firstPoint, lastPoint);
      const chopPts = pts;

      // Create Double Line
      const firstChopPt = chopPts[0];
      const lastChopPt = chopPts[chopPts.length - 1];
      const leftArray: any[] = [];
      const rightArray: any[] = [];
      const middleArray: any[] = [];

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
        middleArray.push(firstChopPt);
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
        middleArray.push(chopPts[i]);
      }

      result.addRing(middleArray.map(p => Array.isArray(p) ? p : [p.x, p.y]));

      // Create MidPts of Left and Right Array
      let gapRatio = GeoTools._2PtLen(chopPts[0], chopPts[chopPts.length - 1]);
      gapRatio = gapRatio / this._teethGap;

      const rightResPts = GeoTools.getDashPts(rightArray, [gapRatio, gapRatio]);
      const leftResPts = GeoTools.getDashPts(leftArray, [gapRatio, gapRatio]);
      const middleResPts = GeoTools.getDashPts(middleArray, [gapRatio, gapRatio]);

      const paths: any[] = [];
      for (let i = 1; i < middleResPts.length; i++) {
        if (i % 2 === 0) {
          paths.push(leftResPts[i]);
        } else {
          paths.push(middleResPts[i]);
        }
      }

      result.addRing(paths.map(p => Array.isArray(p) ? p : [p.x, p.y]));

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
      this._teethGap,
      this._opacity
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
    const drawEss = this.createDrawEssentials([...this._points], this._teethSize, this._teethGap, this._opacity);
    this.__drawEnd(this._tGraphic.geometry as Polygon, drawEss);
    this._clear();
    this._removeEvents();
  }

  private __drawEnd(drawGeometry: Polygon, drawEssentials: DrawEssentials): void {
    if (drawGeometry) {
      const spRef = this.view.spatialReference;
      let geographicGeometry: Polygon | undefined;

      if (spRef && webMercatorUtils.canProject(spRef, { wkid: 4326 })) {
        geographicGeometry = webMercatorUtils.webMercatorToGeographic(drawGeometry) as Polygon;
      } else if (spRef.wkid === 4326) {
        geographicGeometry = jsonUtils.fromJSON(drawGeometry.toJSON()) as Polygon;
      }

      this.__onDrawEnd(drawGeometry, geographicGeometry, drawEssentials);
    }
  }

  private __onDrawEnd(geometry: Polygon, geoGeometry: Polygon | undefined, drawEssParam: DrawEssentials): void {
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