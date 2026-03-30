/**
 * Class Representing Withdraw.
 * @class
 * @author Abdul Razak
 */

import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Graphic from "@arcgis/core/Graphic";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import * as webMercatorUtils from "@arcgis/core/geometry/support/webMercatorUtils";
import * as jsonUtils from "@arcgis/core/geometry/support/jsonUtils";

import DrawEssentials from "../Support/DrawEssentials";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";
import BaseLine from "../Support/BaseLine.ts";

export interface WithdrawOptions {
    ECHLON?: number;
    CTRL_PTS?: Point[];
    GEOM?: any;
}

/**
 * Class Representing Withdraw.
 * @class
 * @author Abdul Razak
 */
class Withdraw {
    public declaredClass: string = "MilitarySymbology.Symbols.Withdraw";
    public SID: string = "342400";
    public symName: string = "Withdraw";
    public symGeometricType: string = "Area";

    private view: MapView | SceneView;
    private isLine: boolean;
    private _lineSym: any;
    private _points: Point[] = [];
    private _geometryType: any = null;
    private _arrowHeadRatio: any;
    private _echlon: number = 0;
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

    public init(options: WithdrawOptions, marker: any): void {
        this._lineSym = marker;
        (this.view as any).navigation.setImmediateClick(false);
        (this.view as any).disableDoubleClickZoom();

        var drawEssentials = new DrawEssentials();
        var baseLine = new BaseLine(this.view, this._lineSym);

        this._echlon = options.ECHLON || 0;
        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
            this._tGraphic.geometry = options.GEOM;
            drawEssentials = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.ECHLON || 0);
            this.__drawEnd(this._tGraphic.geometry, drawEssentials);
            this._clear();
        } else if (options.hasOwnProperty("CTRL_PTS")) {
            drawEssentials = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.ECHLON || 0);
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

    private find_angle(p0: Point, p1: Point, c: Point): number {
        var p0c = Math.sqrt(Math.pow(c.x - p0.x, 2) + Math.pow(c.y - p0.y, 2));
        var p1c = Math.sqrt(Math.pow(c.x - p1.x, 2) + Math.pow(c.y - p1.y, 2));
        var p0p1 = Math.sqrt(Math.pow(p1.x - p0.x, 2) + Math.pow(p1.y - p0.y, 2));
        return Math.acos((p1c * p1c + p0c * p0c - p0p1 * p0p1) / (2 * p1c * p0c));
    }

    private angleBetweenTwoPointsWithFixedPoint(point1X: number, point1Y: number, point2X: number, point2Y: number, fixedX: number, fixedY: number): number {
        var angle1 = Math.atan2(point1Y - fixedY, point1X - fixedX);
        var angle2 = Math.atan2(point2Y - fixedY, point2X - fixedX);
        return angle1 - angle2;
    }

    private createDrawEssentials(ctrlPts: Point[], echlon: number): DrawEssentials {
        var drawEssentials = new DrawEssentials();
        drawEssentials.SCOPE = this;
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.CTRL_PTS = ctrlPts;
        drawEssentials.AMPLIFIER = (this as any).amplifier;
        drawEssentials.ECHLON = echlon;
        return drawEssentials;
    }

    public createSymbol(drawEssentials: DrawEssentials): Polyline {
        try {
            var pts: Point[], arrowHeadRatio: number;

            if (drawEssentials.hasOwnProperty("CTRL_PTS")) {
                pts = drawEssentials.CTRL_PTS;
            } else {
                throw "controlPoints not found";
            }

            var result = new Polyline(this.view.spatialReference);

            var startingPt = pts[0];
            var endPt = pts[1];

            if (pts.length === 2) {
                result.addPath([startingPt, endPt]);
            } else if (pts.length === 3) {
                var candidatePoint = pts[2];
                var values: any;
                var paths: any[] = [];
                var circle = this._circleDrawEx((this.view as any).toScreen(startingPt), (this.view as any).toScreen(endPt), (this.view as any).toScreen(candidatePoint));
                if (circle.radius > 0) {
                    values = this.CreateCircleSegmentFromThreePoints(circle, (this.view as any).toScreen(startingPt), (this.view as any).toScreen(endPt), (this.view as any).toScreen(candidatePoint), 60, this.view);
                    paths = values.geometry.paths[0];
                    result.addPath(paths.slice(0, 60));
                }
            } else if (pts.length > 3) {
                var candidatePoint = pts[2];
                var lastPt = pts[pts.length - 1];
                var secLastPt = pts[pts.length - 2];

                var values: any;
                var paths: any[] = [];
                var circle = this._circleDrawEx((this.view as any).toScreen(startingPt), (this.view as any).toScreen(endPt), (this.view as any).toScreen(candidatePoint));
                if (circle.radius > 0) {
                    values = this.CreateCircleSegmentFromThreePoints(circle, (this.view as any).toScreen(startingPt), (this.view as any).toScreen(endPt), (this.view as any).toScreen(candidatePoint), 60, this.view);
                    paths = values.geometry.paths[0];
                    result.addPath(paths.slice(0, 60));
                }
                var paths: any[] = [];
                paths.push(result.getPoint(0, 0));

                for (var i = 3; i < pts.length - 1; i++) {
                    paths.push(pts[i]);
                }
                paths = paths.concat(lastPt);

                var values: any;
                values = GeoTools._fracture(paths, 10, this.view.spatialReference);
                result.paths = result.paths.concat(values.geometry.paths);
                var cLenLimit: number;
                var baseLineLen = GeoTools._2PtLen(startingPt, lastPt);
                for (var i = 0; i < values.midPoints.length; i++) {
                    cLenLimit = values.midPoints[i].len / 2;
                    if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
                    result.addPath(Shapes.createW(values.midPoints[i].midPt.x, values.midPoints[i].midPt.y, cLenLimit, this.view.spatialReference));
                }

                result.addPath(Shapes.arrowHead(lastPt, GeoTools.ArrowFlanksLen(GeoTools._2PtLen(secLastPt, lastPt), GeoTools._2PtLen(startingPt, lastPt)), GeoTools.angleInRadians(secLastPt, lastPt)));
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
        drawEssentials.ECHLON = this._echlon;

        this._tGraphic.geometry = this.createSymbol(drawEssentials);
        this.emit("onDrawProgress", { 'currentGeometry': this._tGraphic.geometry, 'currentDrawEssentials': drawEssentials, 'currentMarker': this._lineSym });
    }

    private _onClckHdler(clickPoint: any): void {
        this._points.push(clickPoint.mapPoint.offset(0, 0));
        if (this._points.length == 1) this._onMM = this.view.on("pointer-move", this._onMMoveHdler.bind(this));
        this.emit("onDrawClick", { 'currentPts': this._points });
    }

    private _onDblClkHandler(clickPoint: any): void {
        this._points.push(clickPoint.mapPoint);
        this.cleanUp();
    }

    private cleanUp(): void {
        var drawEss = new DrawEssentials();
        drawEss = this.createDrawEssentials(this._points.slice(), this._echlon);
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

    private _circleDrawEx(pt1: any, pt2: any, pt3: any): any {
        var i: number;
        var r: number, m11: number, m12: number, m13: number, m14: number;
        var a = [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0]
        ];
        var P = [
            [pt1.x, pt1.y],
            [pt2.x, pt2.y],
            [pt3.x, pt3.y]
        ];

        for (i = 0; i < 3; i++) {
            a[i][0] = P[i][0];
            a[i][1] = P[i][1];
            a[i][2] = 1;
        }
        m11 = this._determinantDrawEx(a, 3);

        for (i = 0; i < 3; i++) {
            a[i][0] = P[i][0] * P[i][0] + P[i][1] * P[i][1];
            a[i][1] = P[i][1];
            a[i][2] = 1;
        }
        m12 = this._determinantDrawEx(a, 3);

        for (i = 0; i < 3; i++) {
            a[i][0] = P[i][0] * P[i][0] + P[i][1] * P[i][1];
            a[i][1] = P[i][0];
            a[i][2] = 1;
        }
        m13 = this._determinantDrawEx(a, 3);

        for (i = 0; i < 3; i++) {
            a[i][0] = P[i][0] * P[i][0] + P[i][1] * P[i][1];
            a[i][1] = P[i][0];
            a[i][2] = P[i][1];
        }
        m14 = this._determinantDrawEx(a, 3);

        if (m11 == 0) {
            r = 0;
        } else {
            var Xo = 0.5 * m12 / m11;
            var Yo = -0.5 * m13 / m11;
            r = Math.sqrt(Xo * Xo + Yo * Yo + m14 / m11);
        }

        return { radius: r, center: { x: Xo, y: Yo } };
    }

    private _determinantDrawEx(a: number[][], n: number): number {
        var i: number, j: number, j1: number, j2: number;
        var d = 0;
        var m = [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0]
        ];

        if (n == 2) {
            d = a[0][0] * a[1][1] - a[1][0] * a[0][1];
        } else {
            d = 0;
            for (j1 = 0; j1 < n; j1++) {
                for (i = 1; i < n; i++) {
                    j2 = 0;
                    for (j = 0; j < n; j++) {
                        if (j == j1) continue;
                        m[i - 1][j2] = a[i][j];
                        j2++;
                    }
                }
                d = d + Math.pow(-1.0, j1) * a[0][j1] * this._determinantDrawEx(m, n - 1);
            }
        }

        return d;
    }

    private CreateCircleSegmentFromThreePoints(circle: any, pt1: any, pt2: any, pt3: any, numberOfPts: number, view: MapView | SceneView): any {
        var center = circle.center, radius = circle.radius, path: any[] = [];
        pt1.x -= center.x;
        pt1.y -= center.y;
        pt2.x -= center.x;
        pt2.y -= center.y;
        pt3.x -= center.x;
        pt3.y -= center.y;
        var anglePt1 = Math.atan2(pt1.y, pt1.x), anglePt2 = Math.atan2(pt2.y, pt2.x), anglePt3 = Math.atan2(pt3.y, pt3.x);
        anglePt1 = anglePt1 < 0 ? 2 * Math.PI + anglePt1 : anglePt1;
        anglePt2 = anglePt2 < 0 ? 2 * Math.PI + anglePt2 : anglePt2;
        anglePt3 = anglePt3 < 0 ? 2 * Math.PI + anglePt3 : anglePt3;
        var startAngle = Math.min(anglePt1, anglePt2);
        var endAngle = Math.max(anglePt1, anglePt2);
        var swipeAngle = endAngle - startAngle;
        if (anglePt3 < startAngle || anglePt3 > endAngle) {
            swipeAngle -= (2 * Math.PI);
        }
        var angle = swipeAngle / numberOfPts, pt: any;

        for (var i = 0; i <= numberOfPts; i++) {
            pt = (view as any).toMap({ x: radius * Math.cos(startAngle + i * angle) + center.x, y: radius * Math.sin(startAngle + i * angle) + center.y });
            path.push(pt);
        }

        var result = new Polyline(view.spatialReference);
        result.addPath(path);

        return { "geometry": result, "lastPoint": path[numberOfPts], "backPoint": path[numberOfPts - 5] };
    }
}

export default Withdraw; 