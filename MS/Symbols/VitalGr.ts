/**
 * Class Representing Vital Gr.
 * @class
 * @author Abdul Razak
 */

import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Polygon from "@arcgis/core/geometry/Polygon";
import Graphic from "@arcgis/core/Graphic";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import * as webMercatorUtils from "@arcgis/core/geometry/support/webMercatorUtils";
import * as jsonUtils from "@arcgis/core/geometry/support/jsonUtils";

import DrawEssentials from "../Support/DrawEssentials";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";
import BaseLine from "../Support/BaseLine.ts";

export interface VitalGrOptions {
    DRAW_TYPE?: number;
    CTRL_PTS?: Point[];
    GEOM?: any;
}

/**
 * Class Representing Vital Gr.
 * @class
 * @author Abdul Razak
 */
class VitalGr {
    public declaredClass: string = "MilitarySymbology.Symbols.VitalGr";
    public SID: string = "242301";
    public symName: string = "Vital Gr";
    public symGeometricType: string = "Area";

    private view: MapView | SceneView;
    private isLine: boolean;
    private _lineSym: any;
    private _points: Point[] = [];
    private _geometryType: any = null;
    private _drawType: number = 1;
    private _onClk: any;
    private _onDblClk: any;
    private _onMM: any;
    private _tGraphic: Graphic;
    private eventListeners: Map<string, Function[]> = new Map();

    constructor(view: MapView | SceneView, isLine: boolean) {
        this.view = view;
        this.isLine = isLine;
        this._tGraphic = new Graphic();
    }

    public emit(event: string, data: any): void {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
            listeners.forEach(listener => listener(data));
        }
    }

    public on(event: string, callback: Function): void {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event)!.push(callback);
    }

    public off(event: string, callback?: Function): void {
        if (!callback) {
            this.eventListeners.delete(event);
        } else {
            const listeners = this.eventListeners.get(event);
            if (listeners) {
                const index = listeners.indexOf(callback);
                if (index > -1) {
                    listeners.splice(index, 1);
                }
            }
        }
    }

    public init(options: VitalGrOptions, marker: any): void {
        this._lineSym = marker;
        (this.view as any).navigation.setImmediateClick(false);
        (this.view as any).disableDoubleClickZoom();

        var drawEssentials = new DrawEssentials();
        var baseLine = new BaseLine(this.view, this._lineSym);
        this._drawType = options.DRAW_TYPE || 1;

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
            this._tGraphic.geometry = options.GEOM;
            drawEssentials = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.DRAW_TYPE || 1);
            this.__drawEnd(this._tGraphic.geometry, drawEssentials);
            this._clear();
        } else if (options.hasOwnProperty("CTRL_PTS")) {
            drawEssentials = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.DRAW_TYPE || 1);
            this._tGraphic.geometry = this.createSymbol(drawEssentials);
            this.__drawEnd(this._tGraphic.geometry, drawEssentials);
            this._clear();
        } else {
            this._tGraphic = new Graphic(null, this._lineSym);
            this.view.graphics.add(this._tGraphic);

            this._onClk = this.view.on("click", this._onClckHdler.bind(this));
            this._onDblClk = this.view.on("double-click", this._onDblClkHandler.bind(this));
        }
    }

    private createDrawEssentials(ctrlPts: Point[], drawType: number): DrawEssentials {
        var drawEssentials = new DrawEssentials();
        drawEssentials.SCOPE = this;
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.CTRL_PTS = ctrlPts;
        drawEssentials.AMPLIFIER = (this as any).amplifier;
        drawEssentials.DRAW_TYPE = drawType;
        return drawEssentials;
    }

    public createSymbol(drawEssentials: DrawEssentials): Polygon {
        try {
            var pts: Point[];

            if (drawEssentials.hasOwnProperty("CTRL_PTS")) {
                pts = drawEssentials.CTRL_PTS;
            } else {
                throw "controlPoints not found";
            }

            var lastPoint = pts[pts.length - 1];
            var firstPoint = pts[0];
            var result = new Polygon(this.view.spatialReference);

            switch (drawEssentials.DRAW_TYPE) {
                case 1:
                    result = this.createSymbolByBCurve(pts, firstPoint, lastPoint, drawEssentials, result);
                    break;
                case 2:
                    result = this.createSymbolByPolygon(pts, firstPoint, lastPoint, drawEssentials, result);
                    break;
                case 3:
                    result = this.createSymbolByRect(pts, firstPoint, lastPoint, drawEssentials, result);
                    break;
            }

            return result;
        } catch (e) {
            console.log(this.declaredClass + ' Can not create Symbol due to invalid geometry');
            return new Polygon(this.view.spatialReference);
        }
    }

    private _onMMoveHdler(inputPoint: any): void {
        var candidatePoint = inputPoint.mapPoint;
        var drawEssentials = new DrawEssentials();
        drawEssentials.CTRL_PTS = this._points.concat(candidatePoint);
        drawEssentials.DRAW_TYPE = this._drawType;
        this._tGraphic.geometry = this.createSymbol(drawEssentials);
        this.emit("onDrawProgress", { 'currentGeometry': this._tGraphic.geometry, 'currentDrawEssentials': drawEssentials, 'currentMarker': this._lineSym });
    }

    private _onClckHdler(clickPoint: any): void {
        this._points.push(clickPoint.mapPoint.offset(0, 0));
        if (this._points.length == 1) this._onMM = this.view.on("pointer-move", this._onMMoveHdler.bind(this));
        this.emit("onDrawClick", { 'currentPts': this._points });
        if (this.isLine == true && this._points.length == 1) {
            this.emit("onDrawClick", { 'currentPts': this._points });
            this.cleanUp();
        }

        if (this._drawType === 3 && this._points.length === 2) {
            this.emit("onDrawClick", { 'currentPts': this._points });
            this.cleanUp();
        }
    }

    private _onDblClkHandler(clickPoint: any): void {
        this._points.push(clickPoint.mapPoint);
        this.cleanUp();
    }

    private cleanUp(): void {
        var drawEss = new DrawEssentials();
        drawEss = this.createDrawEssentials(this._points.slice(), this._drawType);
        this.__drawEnd(this._tGraphic.geometry, drawEss);
        this._clear();
        this._removeEvents();
    }

    private __drawEnd(drawGeometry: any, drawEssentials: DrawEssentials): void {
        if (drawGeometry) {
            var spRef = this.view.spatialReference, geographicGeometry: any;

            if (spRef && spRef.isWebMercator) {
                geographicGeometry = webMercatorUtils.webMercatorToGeographic(drawGeometry, true);
            } else if (spRef && spRef.wkid === 4326) {
                geographicGeometry = jsonUtils.fromJSON(drawGeometry.toJSON());
            }
            this.__onDrawEnd(drawGeometry, geographicGeometry, drawEssentials);
        }
    }

    private __onDrawEnd(geometry: any, geoGeometry: any, drawEssParam: DrawEssentials): void {
        this.emit("onDrawEnd", { 'geometry': geometry, 'geographicGeometry': geoGeometry, 'drawEssentials': drawEssParam, 'marker': this._lineSym });
    }

    private _clear(): void {
        if (this._tGraphic && this.view.graphics.contains(this._tGraphic)) {
            this.view.graphics.remove(this._tGraphic);
        }
        this._tGraphic = null;
        this._points = [];
    }

    private _removeEvents(): void {
        if (this._onClk) this._onClk.remove();
        if (this._onDblClk) this._onDblClk.remove();
        if (this._onMM) this._onMM.remove();
        (this.view as any).enableDoubleClickZoom();
    }

    public deactivate(): void {
        this._clear();
        this._removeEvents();
        this._geometryType = null;
    }

    private _onDrawComplete(event: any): void {
        // Implementation if needed
    }

    private CreateBezierPath(pointCollection: any[], numberOfPts: number, view: MapView | SceneView): Polygon {
        var position = { x: pointCollection[0].x, y: pointCollection[0].y };
        if (pointCollection[pointCollection.length - 1].x === pointCollection[pointCollection.length - 2].x && pointCollection[pointCollection.length - 1].y === pointCollection[pointCollection.length - 2].y) {
            pointCollection.pop();
        }
        if (pointCollection[pointCollection.length - 1].x === pointCollection[pointCollection.length - 2].x && pointCollection[pointCollection.length - 1].y === pointCollection[pointCollection.length - 2].y) {
            pointCollection.pop();
        }

        // Note: TweenMax is not available in modern TypeScript, using linear interpolation as fallback
        var path: any[] = [];
        for (var i = 0; i <= numberOfPts; i++) {
            var t = i / numberOfPts;
            var x = 0, y = 0;
            for (var j = 0; j < pointCollection.length; j++) {
                var coef = this.binomialCoefficient(pointCollection.length - 1, j) * Math.pow(1 - t, pointCollection.length - 1 - j) * Math.pow(t, j);
                x += coef * pointCollection[j].x;
                y += coef * pointCollection[j].y;
            }
            path.push({ x: x, y: y });
        }

        var result = new Polygon(view.spatialReference);
        result.addRing(path);
        return result;
    }

    private binomialCoefficient(n: number, k: number): number {
        if (k === 0 || k === n) return 1;
        if (k > n - k) k = n - k;
        var res = 1;
        for (var i = 0; i < k; i++) {
            res = res * (n - i) / (i + 1);
        }
        return res;
    }

    private createInnerText(result: Polygon, firstPoint: Point, lastPoint: Point): Polygon {
        var res = result;
        try {
            var midPt = res.extent.center;
            var cLenLimit: number;
            var baseLineLen = GeoTools._2PtLen(firstPoint, lastPoint);
            var cLenLimit = baseLineLen / 10;
            if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
            var vg = Shapes.createVG(midPt.x, midPt.y, cLenLimit, midPt.spatialReference);
            for (var j = 0; j <= vg.length - 1; j++) {
                res.addRing(vg[j]);
            }

            return res;
        } catch (e) {
            console.log('Can not create Inner Text');
            return result;
        }
    }

    private createSymbolByBCurve(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials): Polygon {
        var result = new Polygon(this.view.spatialReference);
        var tempArray: any[] = [];
        pts.forEach(function (e) {
            tempArray.push({ x: e.x, y: e.y });
        });

        tempArray.push({ x: firstPoint.x, y: firstPoint.y });
        result = this.CreateBezierPath(tempArray, 130, this.view);
        result = this.createInnerText(result, firstPoint, lastPoint);

        return result;
    }

    private createSymbolByPolygon(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials): Polygon {
        var result = new Polygon(this.view.spatialReference);
        var tempArray: any[] = [];
        pts.forEach(function (e) {
            tempArray.push({ x: e.x, y: e.y });
        });

        tempArray.push({ x: firstPoint.x, y: firstPoint.y });

        result.addRing(tempArray);
        result = this.createInnerText(result, firstPoint, lastPoint);

        return result;
    }

    private createSymbolByRect(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials): Polygon {
        var result = new Polygon(this.view.spatialReference);
        var tempArray: any[] = [];
        pts.forEach(function (e) {
            tempArray.push({ x: e.x, y: e.y });
        });

        result.addRing(tempArray);
        var extent = result.extent;
        result = new Polygon(this.view.spatialReference);
        tempArray = [];
        tempArray.push(firstPoint);
        tempArray.push(new Point(extent.xmin, extent.ymin, this.view.spatialReference));

        tempArray.push(lastPoint);
        tempArray.push(new Point(extent.xmax, extent.ymax, this.view.spatialReference));
        tempArray.push(firstPoint);

        result.addRing(tempArray);

        var firstLastDist = GeoTools._2PtLen(firstPoint, lastPoint);
        var thirdFourthDist = GeoTools._2PtLen(new Point(extent.xmin, extent.ymin, this.view.spatialReference),
            new Point(extent.xmax, extent.ymax, this.view.spatialReference));

        result = this.createInnerText(result, firstPoint, lastPoint);

        return result;
    }
}

export default VitalGr; 