/**
 * Class Representing Supporting Attack.
 *
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

export interface SupportingAttackOptions {
    HEAD_RATIO?: number;
    TAIL_FACTOR?: number;
    CTRL_PTS?: Point[];
    GEOM?: any;
}

/**
 * Class Representing Supporting Attack.
 * @class
 * @author Abdul Razak
 */
class SupportingAttack {
    public declaredClass: string = "MilitarySymbology.Symbols.SupportingAttack";
    public SID: string = "151404";
    public symName: string = "Sp Attk";
    public symGeometricType: string = "Area";

    private view: MapView | SceneView;
    private isLine: boolean;
    private _lineSym: any;
    private _points: Point[] = [];
    private _geometryType: any = null;
    private _arrowHeadRatio: any;
    private _onClk: any;
    private _onDblClk: any;
    private _onMM: any;
    private _tGraphic: Graphic;
    private _tailFactor: number = 0.05;
    private _headPercentage: number = 0.07;
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

    public init(options: SupportingAttackOptions, marker: any): void {
        this._lineSym = marker;
        (this.view as any).navigation.setImmediateClick(false);
        (this.view as any).disableDoubleClickZoom();

        this._headPercentage = GeoTools.setDefault(options, "HEAD_RATIO", 0.07);
        this._tailFactor = GeoTools.setDefault(options, "TAIL_FACTOR", 0.05);

        var drawEssentials = new DrawEssentials();
        var baseLine = new BaseLine(this.view, this._lineSym);

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
            this._tGraphic.setGeometry(options.GEOM);
            drawEssentials = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._headPercentage, this._tailFactor);
            this.__drawEnd(this._tGraphic.geometry, drawEssentials);
            this._clear();
        } else if (options.hasOwnProperty("CTRL_PTS")) {
            drawEssentials = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._headPercentage, this._tailFactor);
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

    private createDrawEssentials(ctrlPts: Point[], arrowHeadRatio: number, tailFactor: number): DrawEssentials {
        var drawEssentials = new DrawEssentials();
        drawEssentials.SCOPE = this;
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.CTRL_PTS = ctrlPts;
        drawEssentials.AMPLIFIER = (this as any).amplifier;
        drawEssentials.HEAD_RATIO = arrowHeadRatio;
        drawEssentials.TAIL_FACTOR = tailFactor;
        return drawEssentials;
    }

    public createSymbol(drawEssentials: DrawEssentials): Polygon {
        try {
            var pts: Point[], arrowHeadRatio: number;

            if (drawEssentials.hasOwnProperty("CTRL_PTS")) {
                pts = drawEssentials.CTRL_PTS;
            } else {
                throw "controlPoints not found";
            }

            arrowHeadRatio = GeoTools.setDefault(drawEssentials, "HEAD_RATIO", 5);
            if (pts.length <= 2) {
                var firstPoint = pts[0];
                var lastPoint = pts[pts.length - 1];

                var len = GeoTools._2PtLen(firstPoint, lastPoint);
                var k = Math.atan((firstPoint.y - lastPoint.y) / (firstPoint.x - lastPoint.x));
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

                var pt1 = { x: this._tailFactor * len * Math.cos(k) + firstPoint.x, y: this._tailFactor * len * Math.sin(k) + firstPoint.y };
                var pt2 = { x: -1 * this._tailFactor * len * Math.cos(k) + firstPoint.x, y: -1 * this._tailFactor * len * Math.sin(k) + firstPoint.y };
                var partialLen = (1 - this._headPercentage) * len;
                var p1 = { x: this._tailFactor * partialLen * Math.cos(k) + firstPoint.x, y: this._tailFactor * partialLen * Math.sin(k) + firstPoint.y };
                var p2 = { x: -1 * this._tailFactor * partialLen * Math.cos(k) + firstPoint.x, y: -1 * this._tailFactor * partialLen * Math.sin(k) + firstPoint.y };

                var result = new Polygon(this.view.spatialReference);
                var ring: any[] = [];
                ring.push(pt1);

                ring = ring.concat(this.CreateArrowHeadPathEx(p1, lastPoint, p2, len, this._headPercentage, 15));

                ring.push(p2);
                if (!(result as any).isClockwise(ring) && !(this as any).respectDrawingVertexOrder) {
                    console.debug(this.declaredClass + " :  Polygons drawn in anti-clockwise direction will be reversed to be clockwise.");
                    ring.reverse();
                }
                result.addRing(ring);
            } else {
                var leftArray: any[] = [], rightArray: any[] = [];
                var result = new Polygon(this.view.spatialReference);
                var lastPoint = pts[pts.length - 1];
                var tempArray: any[] = [];
                var leftArray: any[] = [], rightArray: any[] = [];

                pts.forEach(function (e) {
                    tempArray.push({ x: e.x, y: e.y });
                });

                var angleArray = GeoTools._vertexAngle(tempArray);
                var totalL = GeoTools._ptCollectionLen(tempArray, 0);
                for (var i = 0, len = tempArray.length - 1; i < len; i++) {
                    var partialLen = GeoTools._ptCollectionLen(tempArray, i);
                    partialLen += totalL / 2.4;

                    var pt1 = { x: (this._tailFactor) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x, y: (this._tailFactor) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y };
                    var pt2 = { x: -1 * (this._tailFactor) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x, y: -1 * (this._tailFactor) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y };

                    leftArray.push(pt1);
                    rightArray.push(pt2);
                }

                leftArray.push({ x: lastPoint.x, y: lastPoint.y });
                rightArray.push({ x: lastPoint.x, y: lastPoint.y });

                leftArray = Shapes.CreateBezierPathPCOnly(leftArray, 70);
                leftArray.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);

                rightArray = Shapes.CreateBezierPathPCOnly(rightArray, 70);
                rightArray.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);

                var headPath = this.CreateArrowHeadPathEx(leftArray[leftArray.length - 1], lastPoint, rightArray[rightArray.length - 1], GeoTools._ptCollectionLen(tempArray, 0), this._headPercentage, 15);

                var ring: any[] = [];
                ring = ring.concat(leftArray);
                ring = ring.concat(headPath);
                ring = ring.concat(rightArray.reverse());

                result.addRing(ring);
            }

            return result;
        } catch (e) {
            console.log(this.declaredClass + ' Can not create Symbol due to invalid geometry');
            return new Polygon(this.view.spatialReference);
        }
    }

    public getBaseLinePts(): any {
        return (this as any)._baseLinePts;
    }

    private _onMMoveHdler(inputPoint: any): void {
        var candidatePoint = inputPoint.mapPoint;
        var drawEssentials = new DrawEssentials();

        drawEssentials.CTRL_PTS = this._points.concat(candidatePoint);
        drawEssentials.BASE_LN_PTS = (this as any)._baseLinePts;
        drawEssentials.BK_LN_DIST_RATIO = (this as any).backLineDist;
        drawEssentials.BK_LN_ANGL_RATIO = (this as any).backLineAngle;

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
        drawEss = this.createDrawEssentials(this._points.slice(), this._headPercentage, this._tailFactor);
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
        (this as any)._baseLinePts = [];
        (this as any)._curvePt1 = (this as any)._curvePt2 = null;
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

    private CreateArrowHeadPathEx(pt1: any, candidatePt: any, pt2: any, totalLen: number, headPercentage: number, headAngle: number, straight?: boolean): any[] {
        var headSizeBaseRatio = 1.07;
        var headBaseLen = totalLen * headPercentage;
        var headSideLen = headBaseLen * headSizeBaseRatio;
        var angle1 = GeoTools.twoPtsAngle(candidatePt, pt1);
        var angle2 = GeoTools.twoPtsAngle(candidatePt, pt2);

        var midAngle = (Math.abs(angle1 - angle2)) / 2;
        if (Math.abs(angle1 - angle2) > Math.PI * 1.88) midAngle += Math.PI;
        var len = Math.sqrt(headBaseLen * headBaseLen + headSideLen * headSideLen - 2 * headSideLen * headBaseLen * Math.cos(midAngle + headAngle / 180 * Math.PI));
        var upAngle = Math.asin(headBaseLen * Math.sin(midAngle + headAngle / 180 * Math.PI) / len);
        var centAngle = upAngle + headAngle / 180 * Math.PI;
        var result: number;
        result = (straight == false || straight == undefined) ? (headBaseLen * Math.sin(Math.PI - centAngle - midAngle) / Math.sin(centAngle)) : 0;
        var path: any[] = [];

        path.push({ x: candidatePt.x + result * Math.cos(angle1), y: candidatePt.y + result * Math.sin(angle1) });
        path.push({ x: candidatePt.x + headSideLen * Math.cos(angle1 - headAngle / 180 * Math.PI), y: candidatePt.y + headSideLen * Math.sin(angle1 - headAngle / 180 * Math.PI) });
        path.push(candidatePt);
        path.push({ x: candidatePt.x + headSideLen * Math.cos(angle2 + headAngle / 180 * Math.PI), y: candidatePt.y + headSideLen * Math.sin(angle2 + headAngle / 180 * Math.PI) });
        path.push({ x: candidatePt.x + result * Math.cos(angle2), y: candidatePt.y + result * Math.sin(angle2) });
        return path;
    }
}

export default SupportingAttack; 