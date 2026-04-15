/**
 * Class Representing Strong Point.
 * @class
 * @author Abdul Razak
 */

import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Graphic from "@arcgis/core/Graphic";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";

export interface StrongPointOptions {
    ECHELON?: any;
    DRAW_TYPE?: number;
    FACE_GAP?: number;
    CTRL_PTS?: Point[];
    GEOM?: any;
    [key: string]: any;
}

/**
 * Class Representing Strong Point.
 */
class StrongPoint {
    public declaredClass: string = "MilitarySymbology.Symbols.StrongPoint";
    public SID: string = "151203";
    public symName: string = "Strong Pt";
    public symGeometricType: string = "Area";

    private view: MapView | SceneView;
    private isLine: boolean;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private amplifier: Amplifier;

    private _lineSym: any;
    private _points: Point[] = [];
    private _geometryType: any = null;
    private _echelon: any = 0;
    private _drawType: number = 1;
    private _face_gap: number = 0;
    private _FACE_GAP_CONTS: number = 5;
    private _FACE_GAP_CONTS_ELL: number = 2;

    private _tGraphic: Graphic | null = null;

    private clickHandler: any = null;
    private doubleClickHandler: any = null;
    private mouseMoveHandler: any = null;

    private eventListeners: Map<string, Function[]> = new Map();

    constructor(view: MapView | SceneView, isLine: boolean = false) {
        this.view = view;
        this.isLine = isLine;
        this.layerManager = GraphicsLayerManager.getInstance(view);
        this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.TACT);
        this.amplifier = new Amplifier();

        this.layerManager.initializeLayers();
        this._tGraphic = new Graphic();
    }

    public init(options: StrongPointOptions, marker: any): void {
        this._lineSym = marker;
        // this.map.navigationManager.setImmediateClick(false);
        // this.map.disableDoubleClickZoom();

        this._echelon = options.ECHELON || 0;
        this._drawType = options.DRAW_TYPE || 1;
        this._face_gap = options.FACE_GAP || 0;

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
            this._tGraphic = new Graphic({ geometry: options.GEOM });
            const drawEssentials = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._echelon, this._drawType, this._face_gap);
            this.__drawEnd(this._tGraphic.geometry, drawEssentials);
            this._clear();

        } else if (options.hasOwnProperty("CTRL_PTS")) {
            const drawEssentials = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._echelon, this._drawType, this._face_gap);
            const geom = this.createSymbol(drawEssentials);
            this._tGraphic = new Graphic({ geometry: geom });
            this.__drawEnd(geom, drawEssentials);
            this._clear();

        } else {
            // Interactive drawing mode
            this._tGraphic = new Graphic({ symbol: this._lineSym });
            this.symbolLayer.add(this._tGraphic);

            this.clickHandler = this.view.on("click", (event: any) => {
                this._onClckHdler(event);
            });
            this.doubleClickHandler = this.view.on("double-click", (event: any) => {
                this._onDblClkHandler(event);
            });
        }
    }

    private createDrawEssentials(ctrlPts: Point[], echelon: any, drawType: number, face_gap: number): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.AMPLIFIER = this.amplifier.toString();
        (drawEssentials as any).SCOPE = this;
        (drawEssentials as any).CTRL_PTS = ctrlPts;
        (drawEssentials as any).ECHELON = echelon;
        (drawEssentials as any).DRAW_TYPE = drawType;
        (drawEssentials as any).FACE_GAP = face_gap;
        return drawEssentials;
    }

    private createStrongPts(pts: Point[], gap_ratio: number, center_pt: Point, result: Polyline, type: number): Polyline {
        const firstPoint = new Point({ x: pts[0].x, y: pts[0].y, spatialReference: this.view.spatialReference });
        const lastPoint = pts[pts.length - 1];

        let gapRatio = GeoTools._2PtLen(firstPoint, lastPoint);
        gapRatio = gapRatio / gap_ratio;

        const baseLineLen = GeoTools._2PtLen(firstPoint, lastPoint);
        let cLenLimit: number;
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

        const resPts = GeoTools.getDashPts(pts, [gapRatio, gapRatio], 5);
        for (let i = 0; i < resPts.length; i += 2) {
            const k = GeoTools.twoPtsAngle(resPts[i], center_pt) + Math.PI;
            result.addPath([
                [cLenLimit * Math.cos(k) + resPts[i].x, cLenLimit * Math.sin(k) + resPts[i].y],
                [resPts[i].x, resPts[i].y]
            ]);
        }

        return result;
    }

    public createSymbol(drawEssentials: DrawEssentials): Polyline {
        try {
            const pts: Point[] = (drawEssentials as any).CTRL_PTS;
            if (!pts || pts.length === 0) throw new Error("controlPoints not found");

            const lastPoint = pts[pts.length - 1];
            const firstPoint = pts[0];
            let result = new Polyline({ spatialReference: this.view.spatialReference });

            switch ((drawEssentials as any).DRAW_TYPE) {
                case 1:
                    result = this.createSymbolByLine(pts, firstPoint, lastPoint, drawEssentials);
                    break;
                case 2:
                    result = this.createSymbolByCloseLine(pts, firstPoint, lastPoint, drawEssentials);
                    break;
                case 3:
                    result = this.createSymbolByPerfectEllipse(pts, firstPoint, lastPoint, drawEssentials);
                    break;
            }

            return result;
        } catch (e) {
            console.log(this.declaredClass + ' Can not create Symbol due to invalid geometry');
            return new Polyline({ spatialReference: this.view.spatialReference });
        }
    }

    private _onMMoveHdler(inputEvent: any): void {
        const mapPoint = this.view.toMap(inputEvent);
        if (!mapPoint || !this._tGraphic) return;

        const candidatePoint = new Point({ x: mapPoint.x, y: mapPoint.y, spatialReference: this.view.spatialReference });

        const drawEssentials = new DrawEssentials();
        (drawEssentials as any).CTRL_PTS = this._points.concat([candidatePoint]);
        (drawEssentials as any).ECHELON = this._echelon;
        (drawEssentials as any).DRAW_TYPE = this._drawType;
        (drawEssentials as any).FACE_GAP = this._face_gap;

        const geom = this.createSymbol(drawEssentials);
        this._tGraphic.geometry = geom;
        this.emit("onDrawProgress", { currentGeometry: geom, currentDrawEssentials: drawEssentials, currentMarker: this._lineSym });
    }

    private _onClckHdler(clickEvent: any): void {
        const mapPoint = this.view.toMap(clickEvent);
        if (!mapPoint) return;

        const point = new Point({ x: mapPoint.x, y: mapPoint.y, spatialReference: this.view.spatialReference });
        this._points.push(point);

        if (this._points.length === 1) {
            this.mouseMoveHandler = this.view.on("pointer-move", (event: any) => {
                this._onMMoveHdler(event);
            });
        }

        this.emit("onDrawClick", { currentPts: this._points });

        if (this.isLine === true && this._points.length === 1) {
            this.emit("onDrawClick", { currentPts: this._points });
            this.cleanUp();
        }
    }

    private _onDblClkHandler(clickEvent: any): void {
        const mapPoint = this.view.toMap(clickEvent);
        if (!mapPoint) return;

        const point = new Point({ x: mapPoint.x, y: mapPoint.y, spatialReference: this.view.spatialReference });
        this._points.push(point);
        this.cleanUp();
    }

    private cleanUp(): void {
        const drawEss = this.createDrawEssentials(this._points.slice(), this._echelon, this._drawType, this._face_gap);
        const geom = this._tGraphic ? this._tGraphic.geometry : null;
        this.__drawEnd(geom, drawEss);
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
        this.emit("onDrawEnd", { geometry: geometry, geographicGeometry: geoGeometry, drawEssentials: drawEssParam, marker: this._lineSym });
    }

    private _clear(): void {
        if (this._tGraphic && this.symbolLayer) {
            this.symbolLayer.remove(this._tGraphic);
        }
        this._tGraphic = null;
        this._points = [];
    }

    private _removeEvents(): void {
        if (this.clickHandler) { this.clickHandler.remove(); this.clickHandler = null; }
        if (this.doubleClickHandler) { this.doubleClickHandler.remove(); this.doubleClickHandler = null; }
        if (this.mouseMoveHandler) { this.mouseMoveHandler.remove(); this.mouseMoveHandler = null; }
        // this.map.enableDoubleClickZoom();
    }

    public deactivate(): void {
        this._clear();
        this._removeEvents();
        this._geometryType = null;
    }

    // Private helpers replacing GeoTools.createPolyFromObject / getLastPtFromPoly which don't exist in TS GeoTools
    private createPolyFromObject(pts: number[][]): Point[] {
        return pts.map(p => new Point({ x: p[0], y: p[1], spatialReference: this.view.spatialReference }));
    }

    private getLastPtFromPoly(polyline: Polyline): Point {
        const paths = polyline.paths[0];
        const last = paths[paths.length - 1];
        return new Point({ x: last[0], y: last[1], spatialReference: this.view.spatialReference });
    }

    private getPolylineCenter(polyline: Polyline): Point {
        const startPoint = this.getLastPtFromPoly(polyline);
        const firstCoord = polyline.paths[0][0];
        const endPoint = new Point({ x: firstCoord[0], y: firstCoord[1], spatialReference: this.view.spatialReference });
        return new Point({
            x: (startPoint.x + endPoint.x) / 2.0,
            y: (startPoint.y + endPoint.y) / 2.0,
            spatialReference: this.view.spatialReference
        });
    }

    private CreateBezierPath(pointCollection: any[], numberOfPts: number): Polyline {
        if (pointCollection[pointCollection.length - 1].x === pointCollection[pointCollection.length - 2].x &&
            pointCollection[pointCollection.length - 1].y === pointCollection[pointCollection.length - 2].y) {
            pointCollection.pop();
        }
        if (pointCollection.length > 2 &&
            pointCollection[pointCollection.length - 1].x === pointCollection[pointCollection.length - 2].x &&
            pointCollection[pointCollection.length - 1].y === pointCollection[pointCollection.length - 2].y) {
            pointCollection.pop();
        }

        const path: any[] = [];
        for (let i = 0; i <= numberOfPts; i++) {
            const t = i / numberOfPts;
            let x = 0, y = 0;
            for (let j = 0; j < pointCollection.length; j++) {
                const coef = this.binomialCoefficient(pointCollection.length - 1, j) *
                    Math.pow(1 - t, pointCollection.length - 1 - j) * Math.pow(t, j);
                x += coef * pointCollection[j].x;
                y += coef * pointCollection[j].y;
            }
            path.push({ x, y });
        }

        const result = new Polyline({ spatialReference: this.view.spatialReference });
        result.addPath(path.map((p: any) => [p.x, p.y]));
        return result;
    }

    private binomialCoefficient(n: number, k: number): number {
        if (k === 0 || k === n) return 1;
        if (k > n - k) k = n - k;
        let res = 1;
        for (let i = 0; i < k; i++) {
            res = res * (n - i) / (i + 1);
        }
        return res;
    }

    private getClosestPointOnLines2(pXy: any, aXys: any[]): any {
        let minDist: any = null, fTo: any, fFrom: any, x: any, y: any, iIdx: any, dist: number = 0;

        if (aXys.length > 1) {
            for (let n = 1; n < aXys.length; n++) {
                if (aXys[n].x !== aXys[n - 1].x) {
                    const a = (aXys[n].y - aXys[n - 1].y) / (aXys[n].x - aXys[n - 1].x);
                    const b = aXys[n].y - a * aXys[n].x;
                    dist = Math.abs(a * pXy.x + b - pXy.y) / Math.sqrt(a * a + 1);
                } else {
                    dist = Math.abs(pXy.x - aXys[n].x);
                }

                const rl2 = Math.pow(aXys[n].y - aXys[n - 1].y, 2) + Math.pow(aXys[n].x - aXys[n - 1].x, 2);
                const ln2 = Math.pow(aXys[n].y - pXy.y, 2) + Math.pow(aXys[n].x - pXy.x, 2);
                const lnm12 = Math.pow(aXys[n - 1].y - pXy.y, 2) + Math.pow(aXys[n - 1].x - pXy.x, 2);
                const dist2 = Math.pow(dist, 2);
                const calcrl2 = ln2 - dist2 + lnm12 - dist2;

                if (calcrl2 > rl2) dist = Math.sqrt(Math.min(ln2, lnm12));

                if (minDist === null || minDist > dist) {
                    if (calcrl2 > rl2) {
                        if (lnm12 < ln2) { fTo = 0; fFrom = 1; } else { fFrom = 0; fTo = 1; }
                    } else {
                        fTo = Math.sqrt(lnm12 - dist2) / Math.sqrt(rl2);
                        fFrom = Math.sqrt(ln2 - dist2) / Math.sqrt(rl2);
                    }
                    minDist = dist; iIdx = n;
                }
            }

            x = aXys[iIdx - 1].x - (aXys[iIdx - 1].x - aXys[iIdx].x) * fTo;
            y = aXys[iIdx - 1].y - (aXys[iIdx - 1].y - aXys[iIdx].y) * fTo;
        }

        return { x, y, index: iIdx, fTo, fFrom };
    }

    private getClosestPointOnLines(pXy: any, aXys: any[]): any {
        let minDist: any = null, fTo: any, fFrom: any, x: any, y: any, iIdx: any, dist: number = 0;

        if (aXys.length > 1) {
            for (let n = 1; n < aXys.length; n++) {
                if (aXys[n][0] !== aXys[n - 1][0]) {
                    const a = (aXys[n][1] - aXys[n - 1][1]) / (aXys[n][0] - aXys[n - 1][0]);
                    const b = aXys[n][1] - a * aXys[n][0];
                    dist = Math.abs(a * pXy.x + b - pXy.y) / Math.sqrt(a * a + 1);
                } else {
                    dist = Math.abs(pXy.x - aXys[n][0]);
                }

                const rl2 = Math.pow(aXys[n][1] - aXys[n - 1][1], 2) + Math.pow(aXys[n][0] - aXys[n - 1][0], 2);
                const ln2 = Math.pow(aXys[n][1] - pXy.y, 2) + Math.pow(aXys[n][0] - pXy.x, 2);
                const lnm12 = Math.pow(aXys[n - 1][1] - pXy.y, 2) + Math.pow(aXys[n - 1][0] - pXy.x, 2);
                const dist2 = Math.pow(dist, 2);
                const calcrl2 = ln2 - dist2 + lnm12 - dist2;

                if (calcrl2 > rl2) dist = Math.sqrt(Math.min(ln2, lnm12));

                if (minDist === null || minDist > dist) {
                    if (calcrl2 > rl2) {
                        if (lnm12 < ln2) { fTo = 0; fFrom = 1; } else { fFrom = 0; fTo = 1; }
                    } else {
                        fTo = Math.sqrt(lnm12 - dist2) / Math.sqrt(rl2);
                        fFrom = Math.sqrt(ln2 - dist2) / Math.sqrt(rl2);
                    }
                    minDist = dist; iIdx = n;
                }
            }

            x = aXys[iIdx - 1][0] - (aXys[iIdx - 1][0] - aXys[iIdx][0]) * fTo;
            y = aXys[iIdx - 1][1] - (aXys[iIdx - 1][1] - aXys[iIdx][1]) * fTo;
        }

        return { x, y, index: iIdx, fTo, fFrom };
    }

    private createSymbolByLine(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials): Polyline {
        let result = new Polyline({ spatialReference: this.view.spatialReference });

        if (pts.length === 2) {
            result.addPath([[lastPoint.x, lastPoint.y], [firstPoint.x, firstPoint.y]]);
        } else if (pts.length > 2) {
            const tempArray = pts.map(e => ({ x: e.x, y: e.y }));
            result = this.CreateBezierPath(tempArray, 100);
            result = this.createStrongPts(this.createPolyFromObject(result.paths[0]), 5, this.getPolylineCenter(result), result, 1);

            const lastPtCoord = result.paths[0][result.paths[0].length - 1];
            const lastPt = new Point({ x: lastPtCoord[0], y: lastPtCoord[1], spatialReference: this.view.spatialReference });
            const firstCoord = result.paths[0][0];
            const firstResultPt = new Point({ x: firstCoord[0], y: firstCoord[1], spatialReference: this.view.spatialReference });

            const midPt = GeoTools.getMidPoint(lastPt, firstResultPt);
            const baseLineLen = GeoTools._2PtLen(lastPt, firstResultPt);
            let cLenLimit = baseLineLen / 10;
            if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;

            const echelons = Shapes.createEchelon((drawEssentials as any).ECHELON, midPt, cLenLimit, GeoTools.angleInRadians(firstPoint, lastPoint));
            for (let j = 0; j <= echelons.length - 1; j++) {
                result.addPath((echelons[j] as Point[]).map(p => [p.x, p.y]));
            }
        }

        return result;
    }

    private createSymbolByCloseLine(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials): Polyline {
        let result = new Polyline({ spatialReference: this.view.spatialReference });

        if (pts.length === 2) {
            result.addPath([[lastPoint.x, lastPoint.y], [firstPoint.x, firstPoint.y]]);
        } else if (pts.length > 2) {
            const tempArray = pts.map(e => ({ x: e.x, y: e.y }));
            tempArray.push({ x: firstPoint.x, y: firstPoint.y });
            const paths = this.CreateBezierPath(tempArray, 100).paths[0];

            const midPt = this.getClosestPointOnLines(lastPoint, paths);

            const faceGap = GeoTools.setDefault(drawEssentials as any, "FACE_GAP", this._FACE_GAP_CONTS);
            let frstEndPIndx = midPt.index - this._FACE_GAP_CONTS - Math.floor(faceGap / 2);
            let secStartPIndx = midPt.index + this._FACE_GAP_CONTS + Math.floor(faceGap / 2);
            if (secStartPIndx >= 100) secStartPIndx = 100;

            result.addPath(paths.slice(0, frstEndPIndx));
            result.addPath(paths.slice(secStartPIndx, 101));

            result = this.createStrongPts(this.createPolyFromObject(result.paths[0]), 5, this.getPolylineCenter(result), result, 2);
            result = this.createStrongPts(this.createPolyFromObject(result.paths[1]), 5, this.getPolylineCenter(result), result, 2);

            const p1 = new Point({ x: paths[frstEndPIndx][0], y: paths[frstEndPIndx][1], spatialReference: this.view.spatialReference });
            const p2 = new Point({ x: paths[secStartPIndx][0], y: paths[secStartPIndx][1], spatialReference: this.view.spatialReference });

            let previousDist: number = 0;
            const baseLineLen = GeoTools._2PtLen(p1, p2);
            let cLenLimit = baseLineLen / 10;
            if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
            if (isNaN(cLenLimit)) {
                cLenLimit = previousDist;
            } else {
                previousDist = cLenLimit;
            }

            const echelons = Shapes.createEchelon((drawEssentials as any).ECHELON, midPt, cLenLimit, GeoTools.angleInRadians(p1, p2));
            for (let j = 0; j <= echelons.length - 1; j++) {
                result.addPath((echelons[j] as Point[]).map(p => [p.x, p.y]));
            }
        }

        return result;
    }

    private createSymbolByPerfectEllipse(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials): Polyline {
        let result = new Polyline({ spatialReference: this.view.spatialReference });

        if (pts.length === 2) {
            const firstPtScreen = (this.view as any).toScreen(firstPoint);
            const lastPtScreen = (this.view as any).toScreen(lastPoint);
            const widthScreen = lastPtScreen.x - firstPtScreen.x;
            const heightScreen = lastPtScreen.y - firstPtScreen.y;
            const paths = Shapes.createEllipse({ center: firstPtScreen, longAxis: widthScreen, shortAxis: heightScreen, numberOfPoints: 60, map: this.view });
            result.addPath((paths as any[]).map((p: any) => [p.x, p.y]));

        } else if (pts.length > 2) {
            const secondPt = pts[1];
            const firstPtScreen = (this.view as any).toScreen(firstPoint);
            const lastPtScreen = (this.view as any).toScreen(secondPt);
            const widthScreen = lastPtScreen.x - firstPtScreen.x;
            const heightScreen = lastPtScreen.y - firstPtScreen.y;
            const paths = Shapes.createEllipse({ center: firstPtScreen, longAxis: widthScreen, shortAxis: heightScreen, numberOfPoints: 60, map: this.view });

            const midPt = this.getClosestPointOnLines2(lastPoint, paths);

            const faceGap = GeoTools.setDefault(drawEssentials as any, "FACE_GAP", this._FACE_GAP_CONTS_ELL);
            let frstEndPIndx = midPt.index - this._FACE_GAP_CONTS_ELL - Math.floor(faceGap / 2);
            let secStartPIndx = midPt.index + this._FACE_GAP_CONTS_ELL + Math.floor(faceGap / 2);
            if (frstEndPIndx <= 0) frstEndPIndx = 0;
            if (secStartPIndx >= 60) secStartPIndx = 60;

            result.addPath((paths as any[]).slice(0, frstEndPIndx).map((p: any) => [p.x, p.y]));
            result.addPath((paths as any[]).slice(secStartPIndx, 61).map((p: any) => [p.x, p.y]));

            result = this.createStrongPts(this.createPolyFromObject(result.paths[0]), 5, this.getPolylineCenter(result), result, 3);
            result = this.createStrongPts(this.createPolyFromObject(result.paths[1]), 5, this.getPolylineCenter(result), result, 3);

            const pathsArr = paths as any[];
            const p1 = new Point({ x: pathsArr[frstEndPIndx].x, y: pathsArr[frstEndPIndx].y, spatialReference: this.view.spatialReference });
            const p2 = new Point({ x: pathsArr[secStartPIndx].x, y: pathsArr[secStartPIndx].y, spatialReference: this.view.spatialReference });

            let previousDist: number = 0;
            const baseLineLen = GeoTools._2PtLen(p1, p2);
            let cLenLimit = baseLineLen / 10;
            if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
            if (isNaN(cLenLimit)) {
                cLenLimit = previousDist;
            } else {
                previousDist = cLenLimit;
            }

            const echelons = Shapes.createEchelon((drawEssentials as any).ECHELON, midPt, cLenLimit, GeoTools.angleInRadians(p1, p2));
            for (let j = 0; j <= echelons.length - 1; j++) {
                result.addPath((echelons[j] as Point[]).map(p => [p.x, p.y]));
            }
        }

        return result;
    }

    /**
     * Event emitter functionality
     */
    public emit(event: string, data: any): void {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
            listeners.forEach(listener => listener(data));
        }

        const customEvent = new CustomEvent(event, {
            detail: { symbolType: this.constructor.name, eventName: event, ...data },
            bubbles: true,
            cancelable: true
        });
        if (this.view && this.view.container) {
            this.view.container.dispatchEvent(customEvent);
        } else {
            document.dispatchEvent(customEvent);
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

    public getSymbolLayer(): GraphicsLayer {
        return this.symbolLayer;
    }

    public clearSymbols(): void {
        this.symbolLayer.removeAll();
    }
}

export default StrongPoint;
