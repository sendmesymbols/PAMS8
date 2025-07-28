/**
 * Class Representing Forming Up Point.
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
}

class DrawEssentials {
  SCOPE?: any;
  SYM_GEO_TYPE?: string;
  SID?: string;
  SYM_NAME?: string;
  CTRL_PTS?: Point[];
  AMPLIFIER?: any;
}

class Shapes {
  static createEllipse(options: {center: any, longAxis: number, shortAxis: number, numberOfPoints: number, map: ViewType}): number[][] {
    // Create ellipse points
    const {center, longAxis, shortAxis, numberOfPoints, map} = options;
    const path: number[][] = [];
    
    for (let i = 0; i <= numberOfPoints; i++) {
      const angle = (i / numberOfPoints) * 2 * Math.PI;
      const screenX = center.x + (longAxis / 2) * Math.cos(angle);
      const screenY = center.y + (shortAxis / 2) * Math.sin(angle);
      
      // Convert back to map coordinates
      const mapPoint = map.toMap({ x: screenX, y: screenY });
      if (mapPoint) {
        path.push([mapPoint.x, mapPoint.y]);
      }
    }
    
    return path;
  }
  
  static createFUP(x: number, y: number, size: number, spatialRef: any): number[][][] {
    // Create FUP text shapes
    const paths: number[][][] = [];
    
    // F shape
    paths.push([
      [x - size, y - size],
      [x - size, y + size],
      [x + size/2, y + size],
      [x - size, y],
      [x + size/3, y]
    ]);
    
    // U shape
    paths.push([
      [x - size/3, y + size],
      [x - size/3, y - size/2],
      [x + size/3, y - size/2],
      [x + size/3, y + size]
    ]);
    
    // P shape
    paths.push([
      [x + size/2, y - size],
      [x + size/2, y + size],
      [x + size, y + size],
      [x + size, y],
      [x + size/2, y]
    ]);
    
    return paths;
  }
}

interface FormingUpPointOptions {
  CTRL_PTS?: Point[];
  GEOM?: Polyline;
}

export default class FormingUpPoint extends Evented {
  public declaredClass: string = "MilitarySymbology.Symbols.FormingUpPoint";
  public SID: string = "140302";
  public symName: string = "FUP";
  public symGeometricType: string = "Area";

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

  public init(options: FormingUpPointOptions, marker: any): void {
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

      const lastPoint = pts[pts.length - 1];
      const firstPoint = pts[0];
      const result = new Polyline({
        spatialReference: this.view.spatialReference
      });

      const ellipseResult = this.createSymbolByPerfectEllipse(pts, firstPoint, lastPoint, drawEssentials, result);

      return ellipseResult;
    } catch (e) {
      console.log(this.declaredClass + ' Cannot create Symbol due to invalid geometry');
      throw e;
    }
  }

  private _onMouseMoveHandler(event: any): void {
    const candidatePoint = event.mapPoint;
    const drawEssentials = this.createDrawEssentials(
      [...this._points, candidatePoint]
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

    if (this._points.length === 2) {
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

  private createSymbolByPerfectEllipse(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials, result: Polyline): Polyline {
    const firstPtScreen = this.view.toScreen(firstPoint);
    const lastPtScreen = this.view.toScreen(lastPoint);
    const widthScreen = lastPtScreen.x - firstPtScreen.x;
    const heightScreen = lastPtScreen.y - firstPtScreen.y;
    
    const paths = Shapes.createEllipse({ 
      center: firstPtScreen, 
      longAxis: widthScreen, 
      shortAxis: heightScreen, 
      numberOfPoints: 60, 
      map: this.view 
    });
    
    result.addPath(paths);

    // Write Text
    const extent = result.extent;
    if (extent && extent.center) {
      const centerPt = extent.center;
      const cLenLimit = GeoTools._2PtLen(firstPoint, lastPoint) / 10;

      const text = Shapes.createFUP(centerPt.x, centerPt.y, cLenLimit, centerPt.spatialReference);
      for (let j = 0; j <= text.length - 1; j++) {
        result.addPath(text[j]);
      }
    }

    return result;
  }
} 