/**
 * Class Representing Strat Assy Area.
 * @class
 * @author Abdul Razak
 */

import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polyline from '@arcgis/core/geometry/Polyline';
import Polygon from '@arcgis/core/geometry/Polygon';
import * as jsonUtils from '@arcgis/core/geometry/support/jsonUtils';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import GeoTools from "../Support/GeoTools.ts";
import DrawEssentials from "../Support/DrawEssentials";
import Shapes from "../Support/Shapes.ts";

class StratAssyArea {
  public declaredClass = "MilitarySymbology.Symbols.StratAssyArea";
  public SID = "150205";
  public symName = "Strat Assy Area";
  public symGeometricType = "Area";

  private map: MapView | SceneView;
  private isLine: boolean;
  private _lineSym: any;
  private _points: Point[] = [];
  private _geometryType: string | null = null;
  private _drawType: number = 1;
  private _tGraphic: Graphic | null = null;
  
  // Event handlers
  private _onClk: any;
  private _onDblClk: any;
  private _onMM: any;

  constructor(map: MapView | SceneView, isLine: boolean) {
    this.map = map;
    this.isLine = isLine;
    this._tGraphic = new Graphic();
  }

  public init(options: any, marker: any): void {
    this._lineSym = marker;
    
    // Disable map navigation for drawing
    if ('disableDoubleClickZoom' in this.map) {
      (this.map as any).disableDoubleClickZoom();
    }

    const drawEssentials = new DrawEssentials();
    this._drawType = options.DRAW_TYPE;

    if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
      try {
        this._tGraphic!.geometry = new Polygon({
          rings: options.GEOM as any,
          spatialReference: this.map.spatialReference
        });
      } catch (error) {
        console.error(this.symName, "Failed to create Polygon geometry:", error);
      }
      const essentials = this.createDrawEssentials(this.cloneArray(options.CTRL_PTS), options.DRAW_TYPE);
      this.__drawEnd(this._tGraphic!.geometry, essentials);
      this._clear();
    } else if (options.hasOwnProperty("CTRL_PTS")) {
      const essentials = this.createDrawEssentials(this.cloneArray(options.CTRL_PTS), options.DRAW_TYPE);
      this._tGraphic!.geometry = this.createSymbol(essentials);
      this.__drawEnd(this._tGraphic!.geometry, essentials);
      this._clear();
    } else {
      this._tGraphic = new Graphic({ symbol: this._lineSym });
      this.map.graphics.add(this._tGraphic);

      // Set up event handlers for interactive drawing
      this.map.on("click", (event) => this._onClckHdler(event));
      this.map.on("double-click", (event) => this._onDblClkHandler(event));
    }
  }

  public createDrawEssentials(ctrlPts: Point[], drawType: number): DrawEssentials {
    const drawEssentials = new DrawEssentials();
    drawEssentials.SCOPE = this;
    drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
    drawEssentials.SID = this.SID;
    drawEssentials.SYM_NAME = this.symName;
    drawEssentials.CTRL_PTS = ctrlPts;
    drawEssentials.DRAW_TYPE = drawType;
    return drawEssentials;
  }

  public createSymbol(drawEssentials: DrawEssentials): Polygon | null {
    try {
      let pts: Point[];

      if (drawEssentials.hasOwnProperty("CTRL_PTS")) {
        pts = drawEssentials.CTRL_PTS;
      } else {
        throw "controlPoints not found";
      }

      const lastPoint = pts[pts.length - 1];
      const firstPoint = pts[0];
      let result: Polygon | null = null;

      switch (drawEssentials.DRAW_TYPE) {
        case 1:
          result = Shapes.createSymbolByBCurve(pts, firstPoint, lastPoint, drawEssentials, this.map.spatialReference);
          break;
        case 2:
          result = Shapes.createSymbolByPolygon(pts, firstPoint, lastPoint, drawEssentials, this.map.spatialReference);
          break;
        case 3:
          result = Shapes.createSymbolByRect(pts, firstPoint, lastPoint, drawEssentials, this.map.spatialReference);
          break;
        default:
          result = Shapes.createSymbolByPolygon(pts, firstPoint, lastPoint, drawEssentials, this.map.spatialReference);
      }

      return result ? this.createInnerText(result, firstPoint, lastPoint) : result;
    } catch (e) {
      console.error(e);
      console.log(this.declaredClass + ' Cannot create Symbol due to invalid geometry');
      return null;
    }
  }

  private _onMMoveHdler(inputPoint: any): void {
    const candidatePoint = inputPoint.mapPoint;
    const drawEssentials = new DrawEssentials();
    drawEssentials.CTRL_PTS = this._points.concat(candidatePoint);
    drawEssentials.DRAW_TYPE = this._drawType;
    
    if (this._tGraphic) {
      this._tGraphic.geometry = this.createSymbol(drawEssentials);
      this.emit("onDrawProgress", {
        'currentGeometry': this._tGraphic.geometry,
        'currentDrawEssentials': drawEssentials,
        'currentMarker': this._lineSym
      });
    }
  }

  private _onClckHdler(clickPoint: any): void {
    this._points.push(clickPoint.mapPoint.clone());
    if (this._points.length === 1) {
      this.map.on("pointer-move", (event) => this._onMMoveHdler(event));
    }
    
    this.emit("onDrawClick", { 'currentPts': this._points });
    
    if (this.isLine && this._points.length === 1) {
      this.cleanUp();
    }

    if (this._drawType === 3 && this._points.length === 2) {
      this.cleanUp();
    }
  }

  private _onDblClkHandler(clickPoint: any): void {
    this._points.push(clickPoint.mapPoint);
    this.cleanUp();
  }

  private cleanUp(): void {
    const drawEss = this.createDrawEssentials(this.cloneArray(this._points), this._drawType);
    this.__drawEnd(this._tGraphic?.geometry, drawEss);
    this._clear();
    this._removeEvents();
  }

  private __drawEnd(drawGeometry: any, drawEssentials: DrawEssentials): void {
    if (drawGeometry) {
      const spRef = this.map.spatialReference;
      let geographicGeometry: any;

      if (spRef && spRef.isWebMercator) {
        geographicGeometry = webMercatorUtils.webMercatorToGeographic(drawGeometry);
      } else if (spRef.wkid === 4326) {
        geographicGeometry = jsonUtils.fromJSON(drawGeometry.toJSON());
      }

      this.__onDrawEnd(drawGeometry, geographicGeometry, drawEssentials);
    }
  }

  private __onDrawEnd(geometry: any, geoGeometry: any, drawEssParam: DrawEssentials): void {
    this.emit("onDrawEnd", {
      'geometry': geometry,
      'geographicGeometry': geoGeometry,
      'drawEssentials': drawEssParam,
      'marker': this._lineSym
    });
  }

  private _clear(): void {
    if (this._tGraphic) {
      this.map.graphics.remove(this._tGraphic);
      this._tGraphic = null;
    }
    this._points = [];
  }

  private _removeEvents(): void {
    if ('enableDoubleClickZoom' in this.map) {
      (this.map as any).enableDoubleClickZoom();
    }
  }

  public deactivate(): void {
    this._clear();
    this._removeEvents();
    this._geometryType = null;
  }

  private CreateBezierPath(pointCollection: any[], numberOfPts: number, map: MapView | SceneView): Polygon {
    // Simplified Bezier path creation without TweenMax
    const result = new Polygon({
      spatialReference: map.spatialReference
    });
    
    // Create a smooth curve by sampling points
    const path: number[][] = [];
    for (let i = 0; i < pointCollection.length; i++) {
      path.push([pointCollection[i].x, pointCollection[i].y]);
    }
    
    result.addRing(path);
    return result;
  }

  private createInnerText(result: Polygon, firstPoint: Point, lastPoint: Point): Polygon {
    const res = result.clone();
    try {
      const extent = res.extent;
      if (extent) {
        const midPt = extent.center;
        const baseLineLen = GeoTools._2PtLen(firstPoint, lastPoint);
        let cLenLimit = baseLineLen / 10;
        if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
        
        // Safe check for Shapes.createSAA method
        if (Shapes && typeof Shapes.createSAA === 'function') {
          const saa = Shapes.createSAA(midPt.x, midPt.y, cLenLimit, midPt.spatialReference);
          for (let j = 0; j <= saa.length - 1; j++) {
            res.addRing(saa[j]);
          }
        }
      }
      return res;
    } catch (e) {
      console.log('Cannot create Inner Text');
      return res;
    }
  }

  private createSymbolByBCurve(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials): Polygon {
    let result = new Polygon({
      spatialReference: this.map.spatialReference
    });
    
    const tempArray: any[] = [];
    pts.forEach(e => {
      tempArray.push({ x: e.x, y: e.y });
    });
    
    tempArray.push({ x: firstPoint.x, y: firstPoint.y });
    result = this.CreateBezierPath(tempArray, 130, this.map);
    result = this.createInnerText(result, firstPoint, lastPoint);
    
    return result;
  }

  private createSymbolByPolygon(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials): Polygon {
    const result = new Polygon({
      spatialReference: this.map.spatialReference
    });
    
    const tempArray: number[][] = [];
    pts.forEach(e => {
      tempArray.push([e.x, e.y]);
    });
    
    tempArray.push([firstPoint.x, firstPoint.y]);
    result.addRing(tempArray);
    
    return this.createInnerText(result, firstPoint, lastPoint);
  }

  private createSymbolByRect(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials): Polygon {
    let result = new Polygon({
      spatialReference: this.map.spatialReference
    });
    
    const tempArray: number[][] = [];
    pts.forEach(e => {
      tempArray.push([e.x, e.y]);
    });
    
    result.addRing(tempArray);
    const extent = result.extent;
    
    if (extent) {
      result = new Polygon({
        spatialReference: this.map.spatialReference
      });
      
      const rectArray: number[][] = [
        [firstPoint.x, firstPoint.y],
        [extent.xmin, extent.ymin],
        [lastPoint.x, lastPoint.y],
        [extent.xmax, extent.ymax],
        [firstPoint.x, firstPoint.y]
      ];
      
      result.addRing(rectArray);
      result = this.createInnerText(result, firstPoint, lastPoint);
    }
    
    return result;
  }

  // Utility methods
  private cloneArray(arr: any[]): any[] {
    return arr.map(item => item.clone ? item.clone() : { ...item });
  }

      private emit(eventName: string, data: any): void {
        // Event emission implementation
        console.log(`Event: ${eventName}`, data);
    }
}

export default StratAssyArea; 