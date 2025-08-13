/**
 * Class Representing Forward Assembly Area.
 * @class
 * @author Abdul Razak
 */

import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import * as webMercatorUtils from "@arcgis/core/geometry/support/webMercatorUtils";
import * as jsonUtils from "@arcgis/core/geometry/support/jsonUtils";
import Evented from "@arcgis/core/core/Evented";
import ShapesUtil from "../Support/Shapes.ts";

type ViewType = MapView | SceneView;

// Temporary utility classes
class GeoTools {
  static _2PtLen(pt1: Point, pt2: Point): number {
    return Math.sqrt(Math.pow(pt2.x - pt1.x, 2) + Math.pow(pt2.y - pt1.y, 2));
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

class Shapes {
  static createFAA(x: number, y: number, size: number, spatialRef: any): number[][][] {
    // Create FAA (Forward Assembly Area) shapes
    const shapes: number[][][] = [];
    
    // F shape
    shapes.push([
      [x - size, y - size],
      [x - size, y + size],
      [x + size/2, y + size],
      [x - size, y],
      [x + size/3, y]
    ]);
    
    // A shape
    shapes.push([
      [x - size/3, y - size],
      [x, y + size],
      [x + size/3, y - size],
      [x - size/6, y],
      [x + size/6, y]
    ]);
    
    // A shape (second)
    shapes.push([
      [x + size/3, y - size],
      [x + size*2/3, y + size],
      [x + size, y - size],
      [x + size/2, y],
      [x + size*5/6, y]
    ]);
    
    return shapes;
  }
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

interface FwdAssemblyAreaOptions {
  CTRL_PTS?: Point[];
  GEOM?: Polygon;
  DRAW_TYPE?: number;
}

export default class FwdAssemblyArea extends Evented {
  public declaredClass: string = "MilitarySymbology.Symbols.FwdAssemblyArea";
  public SID: string = "150201";
  public symName: string = "Fwd Assy Area";
  public symGeometricType: string = "Area";

  private view: ViewType;
  private isLine: boolean;
  private _lineSym: any;
  private _points: Point[] = [];
  private _geometryType: any = null;
  private _drawType: number = 1;
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

  public init(options: FwdAssemblyAreaOptions, marker: any): void {
    this._lineSym = marker;
    
    // Disable map navigation during drawing
    this.view.navigation.browserTouchPanEnabled = false;
    
    this._drawType = options.DRAW_TYPE || 1;

    const drawEssentials = new DrawEssentials();

    if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
      try {
        this._tGraphic.geometry = new Polygon({
          rings: options.GEOM as any,
          spatialReference: this.view.spatialReference
        });
      } catch (error) {
        console.error(this.symName, "Failed to create Polygon geometry:", error);
      }
      const drawEss = this.createDrawEssentials([...options.CTRL_PTS!], options.DRAW_TYPE);
      this.__drawEnd(this._tGraphic.geometry as Polygon, drawEss);
      this._clear();
    } else if (options.hasOwnProperty("CTRL_PTS")) {
      const drawEss = this.createDrawEssentials([...options.CTRL_PTS!], options.DRAW_TYPE);
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

  private createDrawEssentials(ctrlPts: Point[], drawType?: number): DrawEssentials {
    const drawEssentials = new DrawEssentials();
    drawEssentials.SCOPE = this;
    drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
    drawEssentials.SID = this.SID;
    drawEssentials.SYM_NAME = this.symName;
    drawEssentials.CTRL_PTS = ctrlPts;
    drawEssentials.DRAW_TYPE = drawType;
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

      const lastPoint = pts[pts.length - 1];
      const firstPoint = pts[0];
    let result: Polygon | null = null;

    switch (drawEssentials.DRAW_TYPE) {
      case 1:
        result = ShapesUtil.createSymbolByBCurve(pts, firstPoint, lastPoint, drawEssentials as any, this.view.spatialReference);
        break;
      case 2:
        result = ShapesUtil.createSymbolByPolygon(pts, firstPoint, lastPoint, drawEssentials as any, this.view.spatialReference);
        break;
      case 3:
        result = ShapesUtil.createSymbolByRect(pts, firstPoint, lastPoint, drawEssentials as any, this.view.spatialReference);
        break;
      default:
        result = ShapesUtil.createSymbolByPolygon(pts, firstPoint, lastPoint, drawEssentials as any, this.view.spatialReference);
    }

    return result ? this.createInnerText(result, firstPoint, lastPoint) : (new Polygon({ spatialReference: this.view.spatialReference }));
    } catch (e) {
    console.error(e);
    console.log(this.declaredClass + ' Cannot create Symbol due to invalid geometry');
    return new Polygon({ spatialReference: this.view.spatialReference });
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

    if (this._drawType === 3 && this._points.length === 2) {
      this.cleanUp();
    }
  }

  private _onDoubleClickHandler(event: any): void {
    this._points.push(event.mapPoint.clone());
    this.cleanUp();
  }

  private cleanUp(): void {
    const drawEss = this.createDrawEssentials([...this._points], this._drawType);
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

  private CreateBezierPath(pointCollection: any[], numberOfPts: number): Polygon {
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

    const result = new Polygon({
      spatialReference: this.view.spatialReference
    });
    result.addRing(path);
    return result;
  }

  private createInnerText(result: Polygon, firstPoint: Point, lastPoint: Point): Polygon {
    try {
      const extent = result.extent;
      if (extent && extent.center) {
        const midPt = extent.center;
        const baseLineLen = GeoTools._2PtLen(firstPoint, lastPoint);
        let cLenLimit = baseLineLen / 10;
        if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
        
        const faaShapes = Shapes.createFAA(midPt.x, midPt.y, cLenLimit, midPt.spatialReference);
        for (let j = 0; j <= faaShapes.length - 1; j++) {
          result.addRing(faaShapes[j]);
        }
      }
      return result;
    } catch (e) {
      console.log('Cannot create Inner Text');
      return result;
    }
  }

  private createSymbolByBCurve(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials, result: Polygon): Polygon {
    const tempArray: any[] = [];
    pts.forEach((e) => {
      tempArray.push({ x: e.x, y: e.y });
    });

    tempArray.push({ x: firstPoint.x, y: firstPoint.y });
    result = this.CreateBezierPath(tempArray, 130);
    result = this.createInnerText(result, firstPoint, lastPoint);

    return result;
  }

  private createSymbolByPolygon(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials, result: Polygon): Polygon {
    const tempArray: number[][] = [];
    pts.forEach((e) => {
      tempArray.push([e.x, e.y]);
    });

    tempArray.push([firstPoint.x, firstPoint.y]);

    result.addRing(tempArray);
    result = this.createInnerText(result, firstPoint, lastPoint);

    return result;
  }

  private createSymbolByRect(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials, result: Polygon): Polygon {
    const tempArray: number[][] = [];
    pts.forEach((e) => {
      tempArray.push([e.x, e.y]);
    });

    result.addRing(tempArray);
    const extent = result.extent;
    
    if (extent) {
      result = new Polygon({
        spatialReference: this.view.spatialReference
      });
      
      const rectArray: number[][] = [];
      rectArray.push([firstPoint.x, firstPoint.y]);
      rectArray.push([extent.xmin, extent.ymin]);
      rectArray.push([lastPoint.x, lastPoint.y]);
      rectArray.push([extent.xmax, extent.ymax]);
      rectArray.push([firstPoint.x, firstPoint.y]);

      result.addRing(rectArray);
      result = this.createInnerText(result, firstPoint, lastPoint);
    }

    return result;
  }
} 