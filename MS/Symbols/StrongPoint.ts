/**
 * Class Representing Strong Point.
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
/*
import webMercatorUtils from "@arcgis/core/geometry/support/webMercatorUtils";
import jsonUtils from "@arcgis/core/geometry/support/jsonUtils";
*/

import DrawEssentials from "../Support/DrawEssentials";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";
import BaseLine from "../Support/BaseLine.ts";

export interface StrongPointOptions {
    ECHELON?: number;
    DRAW_TYPE?: number;
    FACE_GAP?: number;
    CTRL_PTS?: Point[];
    GEOM?: any;
}

/**
 * Class Representing Strong Point.
 * @class
 * @author Abdul Razak
 */
class StrongPoint {
    public declaredClass: string = "MilitarySymbology.Symbols.StrongPoint";
    public SID: string = "151203";
    public symName: string = "Strong Pt";
    public symGeometricType: string = "Area";

    private view: MapView | SceneView;
    private isLine: boolean;
    private _lineSym: any;
    private _points: Point[] = [];
    private _geometryType: any = null;
    private _arrowHeadRatio: any;
    private _echelon: number = 0;
    private _drawType: number = 1;
    private _face_gap: number = 0;
    private _FACE_GAP_CONTS: number = 5;
    private _FACE_GAP_CONTS_ELL: number = 2;
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

    public init(options: StrongPointOptions, marker: any): void {
        this._lineSym = marker;
        (this.view as any).navigation.setImmediateClick(false);
        (this.view as any).disableDoubleClickZoom();

        var drawEssentials = new DrawEssentials();
        var baseLine = new BaseLine(this.view, this._lineSym);

        this._echelon = options.ECHELON || 0;
        this._drawType = options.DRAW_TYPE || 1;
        this._face_gap = options.FACE_GAP || 0;

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
            this._tGraphic.setGeometry(options.GEOM);
            drawEssentials = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._echelon, this._drawType, this._face_gap);
            this.__drawEnd(this._tGraphic.geometry, drawEssentials);
            this._clear();
        } else if (options.hasOwnProperty("CTRL_PTS")) {
            drawEssentials = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._echelon, this._drawType, this._face_gap);
            this._tGraphic.setGeometry(this.createSymbol(drawEssentials));
            this.__drawEnd(this._tGraphic.geometry, drawEssentials);
            this._clear();
        } else {
            this._tGraphic = new Graphic(null, this._lineSym);
            this.view.graphics.add(this._tGraphic);

            this._onClk = this.view.on("click", this._onClckHdler.bind(this));
            this._onDblClk = this.view.on("double-click", this._onDblClkHandler.bind(this));
        }
    }

    private createDrawEssentials(ctrlPts: Point[], echelon: number, drawType: number, face_gap: number): DrawEssentials {
        var drawEssentials = new DrawEssentials();
        drawEssentials.SCOPE = this;
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.CTRL_PTS = ctrlPts;
        drawEssentials.AMPLIFIER = (this as any).amplifier;
        drawEssentials.ECHELON = echelon;
        drawEssentials.DRAW_TYPE = drawType;
        drawEssentials.FACE_GAP = face_gap;
        return drawEssentials;
    }

    private createStrongPts(pts: Point[], gap_ratio: number, center_pt: Point, result: Polyline, type: number): Polyline {
        var paths: any[] = [];
        var firstPoint = new Point(pts[0].x, pts[0].y, this.view.spatialReference);
        var lastPoint = pts[pts.length - 1];

        var gapRatio = GeoTools._2PtLen(firstPoint, lastPoint);
        gapRatio = gapRatio / gap_ratio;

        var cLenLimit: number;
        var baseLineLen = GeoTools._2PtLen(firstPoint, lastPoint);
        if (type === 1) {
            cLenLimit = baseLineLen / 2;
            if (cLenLimit > baseLineLen / 2) cLenLimit = baseLineLen / 2;
        } else if (type === 2) {
            cLenLimit = baseLineLen / 12;
            if (cLenLimit > baseLineLen / 12) cLenLimit = baseLineLen / 12;
        } else {
            cLenLimit = baseLineLen / 10;
            if (cLenLimit > baseLineLen / 10) cLenLimit = baseLineLen / 10;
        }

        var resPts = GeoTools.getDashPts(pts, [gapRatio, gapRatio], 5);
        var k: number;
        for (var i = 0; i < resPts.length; i += 2) {
            k = GeoTools.twoPtsAngle(resPts[i], center_pt);
            k += Math.PI;
            result.addPath([new Point(cLenLimit * Math.cos(k) + resPts[i].x, cLenLimit * Math.sin(k) + resPts[i].y, this.view.spatialReference), resPts[i]]);
        }

        return result;
    }

    public createSymbol(drawEssentials: DrawEssentials): Polyline {
        try {
            var pts: Point[], arrowHeadRatio: number;

            if (drawEssentials.hasOwnProperty("CTRL_PTS")) {
                pts = drawEssentials.CTRL_PTS;
            } else {
                throw "controlPoints not found";
            }

            var lastPoint = pts[pts.length - 1];
            var firstPoint = pts[0];
            var result = new Polyline(this.view.spatialReference);

            switch (drawEssentials.DRAW_TYPE) {
                case 1:
                    result = this.createSymbolByLine(pts, firstPoint, lastPoint, drawEssentials, result);
                    break;
                case 2:
                    result = this.createSymbolByCloseLine(pts, firstPoint, lastPoint, drawEssentials, result);
                    break;
                case 3:
                    result = this.createSymbolByPerfectEllipse(pts, firstPoint, lastPoint, drawEssentials, result);
                    break;
            }

            return result;
        } catch (e) {
            console.log(this.declaredClass + ' Can not create Symbol due to invalid geometry');
            return new Polyline(this.view.spatialReference);
        }
    }

    private _onMMoveHdler(inputPoint: any): void {
        var candidatePoint = inputPoint.mapPoint;
        var drawEssentials = new DrawEssentials();

        drawEssentials.CTRL_PTS = this._points.concat(candidatePoint);
        drawEssentials.ECHELON = this._echelon;
        drawEssentials.DRAW_TYPE = this._drawType;
        drawEssentials.FACE_GAP = this._face_gap;

        this._tGraphic.setGeometry(this.createSymbol(drawEssentials));
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
    }

    private _onDblClkHandler(clickPoint: any): void {
        this._points.push(clickPoint.mapPoint);
        this.cleanUp();
    }

    private cleanUp(): void {
        var drawEss = new DrawEssentials();
        drawEss = this.createDrawEssentials(this._points.slice(), this._echelon, this._drawType, this._face_gap);
        this.__drawEnd(this._tGraphic.geometry, drawEss);
        this._clear();
        this._removeEvents();
    }

    private __drawEnd(drawGeometry: any, drawEssentials: DrawEssentials): void {
        if (drawGeometry) {
            const spatialRef = this.view.spatialReference;
            let geographicGeometry = drawGeometry;

            if (spatialRef && spatialRef.isWebMercator) {
                // Geographic conversion would go here if needed
            } else if (spatialRef && spatialRef.wkid === 4326) {
                geographicGeometry = drawGeometry.clone();
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

    private CreateBezierPath(pointCollection: any[], numberOfPts: number, view: MapView | SceneView): Polyline {
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

        var result = new Polyline(view.spatialReference);
        result.addPath(path);
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

    private getClosestPointOnLines2(pXy: any, aXys: any[]): any {
        var minDist: number;
        var fTo: number;
        var fFrom: number;
        var x: number;
        var y: number;
        var i: number;
        var dist: number;

        if (aXys.length > 1) {
            for (var n = 1; n < aXys.length; n++) {
                if (aXys[n].x != aXys[n - 1].x) {
                    var a = (aXys[n].y - aXys[n - 1].y) / (aXys[n].x - aXys[n - 1].x);
                    var b = aXys[n].y - a * aXys[n].x;
                    dist = Math.abs(a * pXy.x + b - pXy.y) / Math.sqrt(a * a + 1);
                } else {
                    dist = Math.abs(pXy.x - aXys[n].x);
                }

                var rl2 = Math.pow(aXys[n].y - aXys[n - 1].y, 2) + Math.pow(aXys[n].x - aXys[n - 1].x, 2);
                var ln2 = Math.pow(aXys[n].y - pXy.y, 2) + Math.pow(aXys[n].x - pXy.x, 2);
                var lnm12 = Math.pow(aXys[n - 1].y - pXy.y, 2) + Math.pow(aXys[n - 1].x - pXy.x, 2);
                var dist2 = Math.pow(dist, 2);
                var calcrl2 = ln2 - dist2 + lnm12 - dist2;

                if (calcrl2 > rl2) {
                    dist = Math.sqrt(Math.min(ln2, lnm12));
                }

                if ((minDist == null) || (minDist > dist)) {
                    if (calcrl2 > rl2) {
                        if (lnm12 < ln2) {
                            fTo = 0;
                            fFrom = 1;
                        } else {
                            fFrom = 0;
                            fTo = 1;
                        }
                    } else {
                        fTo = ((Math.sqrt(lnm12 - dist2)) / Math.sqrt(rl2));
                        fFrom = ((Math.sqrt(ln2 - dist2)) / Math.sqrt(rl2));
                    }
                    minDist = dist;
                    i = n;
                }
            }

            var dx = aXys[i - 1].x - aXys[i].x;
            var dy = aXys[i - 1].y - aXys[i].y;

            x = aXys[i - 1].x - (dx * fTo);
            y = aXys[i - 1].y - (dy * fTo);
        }

        return { 'x': x, 'y': y, 'index': i, 'fTo': fTo, 'fFrom': fFrom };
    }

    private getClosestPointOnLines(pXy: any, aXys: any[]): any {
        var minDist: number;
        var fTo: number;
        var fFrom: number;
        var x: number;
        var y: number;
        var i: number;
        var dist: number;

        if (aXys.length > 1) {
            for (var n = 1; n < aXys.length; n++) {
                if (aXys[n][0] != aXys[n - 1][0]) {
                    var a = (aXys[n][1] - aXys[n - 1][1]) / (aXys[n][0] - aXys[n - 1][0]);
                    var b = aXys[n][1] - a * aXys[n][0];
                    dist = Math.abs(a * pXy.x + b - pXy.y) / Math.sqrt(a * a + 1);
                } else {
                    dist = Math.abs(pXy.x - aXys[n][0]);
                }

                var rl2 = Math.pow(aXys[n][1] - aXys[n - 1][1], 2) + Math.pow(aXys[n][0] - aXys[n - 1][0], 2);
                var ln2 = Math.pow(aXys[n][1] - pXy.y, 2) + Math.pow(aXys[n][0] - pXy.x, 2);
                var lnm12 = Math.pow(aXys[n - 1][1] - pXy.y, 2) + Math.pow(aXys[n - 1][0] - pXy.x, 2);
                var dist2 = Math.pow(dist, 2);
                var calcrl2 = ln2 - dist2 + lnm12 - dist2;

                if (calcrl2 > rl2) {
                    dist = Math.sqrt(Math.min(ln2, lnm12));
                }

                if ((minDist == null) || (minDist > dist)) {
                    if (calcrl2 > rl2) {
                        if (lnm12 < ln2) {
                            fTo = 0;
                            fFrom = 1;
                        } else {
                            fFrom = 0;
                            fTo = 1;
                        }
                    } else {
                        fTo = ((Math.sqrt(lnm12 - dist2)) / Math.sqrt(rl2));
                        fFrom = ((Math.sqrt(ln2 - dist2)) / Math.sqrt(rl2));
                    }
                    minDist = dist;
                    i = n;
                }
            }

            var dx = aXys[i - 1][0] - aXys[i][0];
            var dy = aXys[i - 1][1] - aXys[i][1];

            x = aXys[i - 1][0] - (dx * fTo);
            y = aXys[i - 1][1] - (dy * fTo);
        }

        return { 'x': x, 'y': y, 'index': i, 'fTo': fTo, 'fFrom': fFrom };
    }

    private getPolylineCenter(polyline: Polyline): Point {
        var startPoint = GeoTools.getLastPtFromPoly(polyline);
        var endPoint = polyline.getPoint(0, 0);
        return new Point((startPoint.x + endPoint.x) / 2.0, (startPoint.y + endPoint.y) / 2.0);
    }

    private createSymbolByLine(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials): Polyline {
        var result = new Polyline(this.view.spatialReference);
        var paths: any[] = [];

        if (pts.length === 2) {
            result.addPath([lastPoint, firstPoint]);
        } else if (pts.length > 2) {
            var tempArray: any[] = [];
            pts.forEach(function (e) {
                tempArray.push({ x: e.x, y: e.y });
            });

            result = this.CreateBezierPath(tempArray, 100, this.view);
            result = this.createStrongPts(GeoTools.createPolyFromObject(result.paths[0]), 5, this.getPolylineCenter(result), result, 1);

            var lastPt = result.paths[0][result.paths[0].length - 1];
            var midPt = GeoTools.getMidPoint(new Point(lastPt[0], lastPt[1], this.view.spatialReference), result.getPoint(0, 0));
            var baseLineLen = GeoTools._2PtLen(new Point(lastPt[0], lastPt[1], this.view.spatialReference), result.getPoint(0, 0));

            var cLenLimit = baseLineLen / 10;
            if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;

            var echelons = Shapes.createEchelon(drawEssentials.ECHELON, midPt, cLenLimit, GeoTools.angleInRadians(firstPoint, lastPoint));

            for (var j = 0; j <= echelons.length - 1; j++) {
                result.addPath(echelons[j]);
            }
        }

        return result;
    }

    private createSymbolByCloseLine(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials): Polyline {
        var result = new Polyline(this.view.spatialReference);
        var paths: any[] = [];

        if (pts.length === 2) {
            result.addPath([lastPoint, firstPoint]);
        } else if (pts.length > 2) {
            var tempArray: any[] = [];
            pts.forEach(function (e) {
                tempArray.push({ x: e.x, y: e.y });
            });

            tempArray.push({ x: firstPoint.x, y: firstPoint.y });
            paths = this.CreateBezierPath(tempArray, 100, this.view).paths[0];

            var midPt = this.getClosestPointOnLines(lastPoint, paths);

            var frstEndPIndx = midPt.index - this._FACE_GAP_CONTS - Math.floor(GeoTools.setDefault(drawEssentials, "FACE_GAP", this._FACE_GAP_CONTS) / 2);
            var secStartPIndx = midPt.index + this._FACE_GAP_CONTS + Math.floor(GeoTools.setDefault(drawEssentials, "FACE_GAP", this._FACE_GAP_CONTS) / 2);
            if (secStartPIndx >= 100) secStartPIndx = 100;

            result.addPath(paths.slice(0, frstEndPIndx));
            result.addPath(paths.slice(secStartPIndx, 101));

            result = this.createStrongPts(GeoTools.createPolyFromObject(result.paths[0]), 5, this.getPolylineCenter(result), result, 2);
            result = this.createStrongPts(GeoTools.createPolyFromObject(result.paths[1]), 5, this.getPolylineCenter(result), result, 2);

            var p1 = new Point(paths[frstEndPIndx][0], paths[frstEndPIndx][1], this.view.spatialReference);
            var p2 = new Point(paths[secStartPIndx][0], paths[secStartPIndx][1], this.view.spatialReference);

            var previousDist: number;
            var baseLineLen = GeoTools._2PtLen(p1, p2);
            var cLenLimit = baseLineLen / 10;

            if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
            if (isNaN(cLenLimit)) {
                cLenLimit = previousDist;
            } else {
                previousDist = cLenLimit;
            }

            var echelons = Shapes.createEchelon(drawEssentials.ECHELON, midPt, cLenLimit, GeoTools.angleInRadians(p1, p2));
            for (var j = 0; j <= echelons.length - 1; j++) {
                result.addPath(echelons[j]);
            }
        }

        return result;
    }

    private createSymbolByPerfectEllipse(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials): Polyline {
        var result = new Polyline(this.view.spatialReference);

        if (pts.length === 2) {
            var firstPtScreen = (this.view as any).toScreen(firstPoint);
            var lastPtScreen = (this.view as any).toScreen(lastPoint);
            var widthScreen = lastPtScreen.x - firstPtScreen.x;
            var heightScreen = lastPtScreen.y - firstPtScreen.y;
            var paths = Shapes.createEllipse({ center: firstPtScreen, longAxis: widthScreen, shortAxis: heightScreen, numberOfPoints: 60, map: this.view });
            result.addPath(paths);
        } else if (pts.length > 2) {
            var secondPt = pts[1];
            var firstPtScreen = (this.view as any).toScreen(firstPoint);
            var lastPtScreen = (this.view as any).toScreen(secondPt);
            var widthScreen = lastPtScreen.x - firstPtScreen.x;
            var heightScreen = lastPtScreen.y - firstPtScreen.y;
            var paths = Shapes.createEllipse({ center: firstPtScreen, longAxis: widthScreen, shortAxis: heightScreen, numberOfPoints: 60, map: this.view });

            var midPt = this.getClosestPointOnLines2(lastPoint, paths);

            var frstEndPIndx = midPt.index - this._FACE_GAP_CONTS_ELL - Math.floor(GeoTools.setDefault(drawEssentials, "FACE_GAP", this._FACE_GAP_CONTS_ELL) / 2);
            var secStartPIndx = midPt.index + this._FACE_GAP_CONTS_ELL + Math.floor(GeoTools.setDefault(drawEssentials, "FACE_GAP", this._FACE_GAP_CONTS_ELL) / 2);

            if (frstEndPIndx <= 0) frstEndPIndx = 0;
            if (secStartPIndx >= 60) secStartPIndx = 60;

            result.addPath(paths.slice(0, frstEndPIndx));
            result.addPath(paths.slice(secStartPIndx, 61));

            result = this.createStrongPts(GeoTools.createPolyFromObject(result.paths[0]), 5, this.getPolylineCenter(result), result, 3);
            result = this.createStrongPts(GeoTools.createPolyFromObject(result.paths[1]), 5, this.getPolylineCenter(result), result, 3);

            var p1 = new Point(paths[frstEndPIndx].x, paths[frstEndPIndx].y, this.view.spatialReference);
            var p2 = new Point(paths[secStartPIndx].x, paths[secStartPIndx].y, this.view.spatialReference);

            var previousDist: number;
            var baseLineLen = GeoTools._2PtLen(p1, p2);
            var cLenLimit = baseLineLen / 10;
            if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
            if (isNaN(cLenLimit)) {
                cLenLimit = previousDist;
            } else {
                previousDist = cLenLimit;
            }

            var echelons = Shapes.createEchelon(drawEssentials.ECHELON, midPt, cLenLimit, GeoTools.angleInRadians(p1, p2));
            for (var j = 0; j <= echelons.length - 1; j++) {
                result.addPath(echelons[j]);
            }
        }

        return result;
    }
}

export default StrongPoint; 