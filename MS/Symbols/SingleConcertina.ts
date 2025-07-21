/**
 * Class Representing Single Concertina.
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

class SingleConcertina {
  public declaredClass = "MilitarySymbology.Symbols.SingleConcertina";
  public SID = "290307";
  public symName = "Wire Obs - Single Concertina";
  public symGeometricType = "Line";
  public isObstacle = "1";

  private map: MapView | SceneView;
  private isLine: boolean;
  private _lineSym: any;
  private _points: Point[] = [];
  private _geometryType: string | null = null;
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

    if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
      this._tGraphic!.geometry = options.GEOM;
      const essentials = this.createDrawEssentials(this.cloneArray(options.CTRL_PTS));
      this.__drawEnd(this._tGraphic!.geometry, essentials);
      this._clear();
    } else if (options.hasOwnProperty("CTRL_PTS")) {
      const essentials = this.createDrawEssentials(this.cloneArray(options.CTRL_PTS));
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

  public createDrawEssentials(ctrlPts: Point[]): DrawEssentials {
    const drawEssentials = new DrawEssentials();
    drawEssentials.SCOPE = this;
    drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
    drawEssentials.SID = this.SID;
    drawEssentials.SYM_NAME = this.symName;
    drawEssentials.CTRL_PTS = ctrlPts;
    drawEssentials.IS_OBS = this.isObstacle;
    return drawEssentials;
  }

  public createSymbol(drawEssentials: DrawEssentials): Polyline | null {
    try {
      let pts: Point[];

      if (drawEssentials.hasOwnProperty("CTRL_PTS")) {
        pts = drawEssentials.CTRL_PTS;
      } else {
        throw "controlPoints not found";
      }

      const result = new Polyline({
        spatialReference: this.map.spatialReference
      });

      // Add Crosses
      let gapRatio = GeoTools._2PtLen(pts[0], pts[pts.length - 1]);
      gapRatio = gapRatio / 20;

      let cLenLimit: number;
      const baseLineLen = GeoTools._2PtLen(pts[0], pts[pts.length - 1]) / 7;
      cLenLimit = baseLineLen / 7;
      if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;

      const resPts = GeoTools.getDashPts(pts, [gapRatio, gapRatio]);
      for (let i = 0; i < resPts.length; i++) {
        if (Shapes && typeof Shapes.createEchelon === 'function') {
          const echelons = Shapes.createEchelon('120', resPts[i], cLenLimit);
          for (let j = 0; j <= echelons.length - 1; j++) {
            result.addPath(echelons[j]);
          }
        }
      }

      // Create Line
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

      const p1 = { x: partialLen * Math.cos(k) + firstPoint.x, y: partialLen * Math.sin(k) + firstPoint.y };
      const p2 = { x: -1 * partialLen * Math.cos(k) + firstPoint.x, y: -1 * partialLen * Math.sin(k) + firstPoint.y };

      if (pts.length >= 1) {
        rightArray.push([p2.x, p2.y]);
      }

      for (let i = 0; i < pts.length; i++) {
        // Find distance between candidatePoint and Mid Point
        const length = GeoTools._2PtLen(firstPoint, pts[i]);
        const angle = GeoTools.angleInRadians(firstPoint, pts[i]);

        const stPtCandidatePt = new Point({
          x: p1.x + length * Math.cos(angle),
          y: p1.y + length * Math.sin(angle),
          spatialReference: this.map.spatialReference
        });
        const endPtCandidatePt = new Point({
          x: p2.x + length * Math.cos(angle),
          y: p2.y + length * Math.sin(angle),
          spatialReference: this.map.spatialReference
        });

        len = length / 5;
        const baseLnLen = GeoTools._2PtLen(stPtCandidatePt, endPtCandidatePt);
        const baseLineLenLimit = baseLnLen / 4;
        if (len > baseLineLenLimit) len = baseLineLenLimit;

        rightArray.push([endPtCandidatePt.x, endPtCandidatePt.y]);
      }

      result.addPath(rightArray);

      return result;
    } catch (e) {
      console.log(this.declaredClass + ' Cannot create Symbol due to invalid geometry');
      return null;
    }
  }

  private _onMMoveHdler(inputPoint: any): void {
    const candidatePoint = inputPoint.mapPoint;
    const drawEssentials = new DrawEssentials();
    drawEssentials.CTRL_PTS = this._points.concat(candidatePoint);
    
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
  }

  private _onDblClkHandler(clickPoint: any): void {
    this._points.push(clickPoint.mapPoint);
    this.cleanUp();
  }

  private cleanUp(): void {
    const drawEss = this.createDrawEssentials(this.cloneArray(this._points));
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

  // Utility methods
  private cloneArray(arr: any[]): any[] {
    return arr.map(item => item.clone ? item.clone() : { ...item });
  }

      private emit(eventName: string, data: any): void {
        // Event emission implementation
        console.log(`Event: ${eventName}`, data);
    }
}

export default SingleConcertina; 