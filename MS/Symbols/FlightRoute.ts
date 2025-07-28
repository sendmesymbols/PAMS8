/**
 * Class Representing Flight Route.
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
}

class DrawEssentials {
  SCOPE?: any;
  SYM_GEO_TYPE?: string;
  SID?: string;
  SYM_NAME?: string;
  CTRL_PTS?: Point[];
  AMPLIFIER?: any;
  DRAW_TYPE?: number;
}

// TweenMax placeholder
class TweenMax {
  static to(target: any, duration: number, options: any): any {
    return {
      time: (t: number) => {
        if (options.bezier && Array.isArray(options.bezier)) {
          const progress = t / duration;
          const index = Math.floor(progress * (options.bezier.length - 1));
          const nextIndex = Math.min(index + 1, options.bezier.length - 1);
          const localProgress = (progress * (options.bezier.length - 1)) - index;
          
          if (index < options.bezier.length && nextIndex < options.bezier.length) {
            target.x = options.bezier[index].x + (options.bezier[nextIndex].x - options.bezier[index].x) * localProgress;
            target.y = options.bezier[index].y + (options.bezier[nextIndex].y - options.bezier[index].y) * localProgress;
          }
        }
      }
    };
  }
}

const Linear = { easeNone: "linear" };

interface FlightRouteOptions {
  CTRL_PTS?: Point[];
  GEOM?: Polyline;
  DRAW_TYPE?: number;
}

export default class FlightRoute extends Evented {
  public declaredClass: string = "MilitarySymbology.Symbols.FlightRoute";
  public SID: string = "170701";
  public symName: string = "Flight Route";
  public symGeometricType: string = "Line";

  private view: ViewType;
  private isLine: boolean;
  private _lineSym: any;
  private _points: Point[] = [];
  private _drawType: number = 1;
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

  public init(options: FlightRouteOptions, marker: any): void {
    this._lineSym = marker;
    
    // Disable map navigation during drawing
    this.view.navigation.browserTouchPanEnabled = false;

    this._drawType = GeoTools.setDefault(options, "DRAW_TYPE", this._drawType);

    const drawEssentials = new DrawEssentials();

    if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
      this._tGraphic.geometry = options.GEOM!;
      const drawEss = this.createDrawEssentials([...options.CTRL_PTS!], this._drawType);
      this.__drawEnd(this._tGraphic.geometry as Polyline, drawEss);
      this._clear();
    } else if (options.hasOwnProperty("CTRL_PTS")) {
      const drawEss = this.createDrawEssentials([...options.CTRL_PTS!], this._drawType);
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

  private createDrawEssentials(ctrlPts: Point[], drawType: number): DrawEssentials {
    const drawEssentials = new DrawEssentials();
    drawEssentials.SCOPE = this;
    drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
    drawEssentials.SID = this.SID;
    drawEssentials.SYM_NAME = this.symName;
    drawEssentials.CTRL_PTS = ctrlPts;
    drawEssentials.DRAW_TYPE = drawType;
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

      let result = new Polyline({
        spatialReference: this.view.spatialReference
      });

      const p1 = pts[0];
      const p2 = pts[pts.length - 1];

      switch (drawEssentials.DRAW_TYPE) {
        case 1:
          result = this.createSymbolByStraightLine(pts);
          break;
        case 2:
          result = this.createSymbolByLine(pts, p1, p2, drawEssentials, result);
          break;
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
      this._drawType
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

  private createSymbolByStraightLine(pts: Point[]): Polyline {
    const result = new Polyline({
      spatialReference: this.view.spatialReference
    });
    result.addPath(pts.map(p => [p.x, p.y]));
    return result;
  }

  private createSymbolByLine(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials, result: Polyline): Polyline {
    if (pts.length === 2) {
      result.addPath([[lastPoint.x, lastPoint.y], [firstPoint.x, firstPoint.y]]);
    } else if (pts.length > 2) {
      const tempArray: any[] = [];
      pts.forEach((e) => {
        tempArray.push({ x: e.x, y: e.y });
      });

      result = this.CreateBezierPath(tempArray, 100);
    }

    return result;
  }

  private CreateBezierPath(pointCollection: any[], numberOfPts: number): Polyline {
    const position = { x: pointCollection[0].x, y: pointCollection[0].y };
    
    // Remove duplicate points
    if (pointCollection.length > 1 && 
        pointCollection[pointCollection.length - 1].x === pointCollection[pointCollection.length - 2].x && 
        pointCollection[pointCollection.length - 1].y === pointCollection[pointCollection.length - 2].y) {
      pointCollection.pop();
    }
    
    if (pointCollection.length > 1 && 
        pointCollection[pointCollection.length - 1].x === pointCollection[pointCollection.length - 2].x && 
        pointCollection[pointCollection.length - 1].y === pointCollection[pointCollection.length - 2].y) {
      pointCollection.pop();
    }

    const tween = TweenMax.to(position, numberOfPts, { bezier: pointCollection, ease: Linear.easeNone });
    const path: number[][] = [];

    for (let i = 0; i <= numberOfPts; i++) {
      tween.time(i);
      path.push([position.x, position.y]);
    }

    const result = new Polyline({
      spatialReference: this.view.spatialReference
    });
    result.addPath(path);
    return result;
  }

  private cleanUp(): void {
    const drawEss = this.createDrawEssentials([...this._points], this._drawType);
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