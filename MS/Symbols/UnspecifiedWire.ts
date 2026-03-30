/**
 * Class Representing Unspecified Wire.
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

export interface UnspecifiedWireOptions {
    CTRL_PTS?: Point[];
    GEOM?: any;
}

/**
 * Class Representing Unspecified Wire.
 * @class
 * @author Abdul Razak
 */
class UnspecifiedWire {
    public declaredClass: string = "MilitarySymbology.Symbols.UnspecifiedWire";
    public SID: string = "290301";
    public symName: string = "Wire Obs - Unspecified Wire";
    public symGeometricType: string = "Line";
    public isObstacle: string = "1";

    private view: MapView | SceneView;
    private isLine: boolean;
    private _lineSym: any;
    private _points: Point[] = [];
    private _geometryType: any = null;
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

    public init(options: UnspecifiedWireOptions, marker: any): void {
        this._lineSym = marker;
        (this.view as any).navigation.setImmediateClick(false);
        (this.view as any).disableDoubleClickZoom();

        var drawEssentials = new DrawEssentials();
        var baseLine = new BaseLine(this.view, this._lineSym);

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
            this._tGraphic.geometry = options.GEOM;
            drawEssentials = this.createDrawEssentials(options.CTRL_PTS!.slice());
            this.__drawEnd(this._tGraphic.geometry, drawEssentials);
            this._clear();
        } else if (options.hasOwnProperty("CTRL_PTS")) {
            drawEssentials = this.createDrawEssentials(options.CTRL_PTS!.slice());
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

    private createDrawEssentials(ctrlPts: Point[]): DrawEssentials {
        var drawEssentials = new DrawEssentials();
        drawEssentials.SCOPE = this;
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.CTRL_PTS = ctrlPts;
        drawEssentials.AMPLIFIER = (this as any).amplifier;
        drawEssentials.IS_OBS = this.isObstacle;
        return drawEssentials;
    }

    public createSymbol(drawEssentials: DrawEssentials): Polyline {
        try {
            var pts: Point[];

            if (drawEssentials.hasOwnProperty("CTRL_PTS")) {
                pts = drawEssentials.CTRL_PTS;
            } else {
                throw "controlPoints not found";
            }

            var result = new Polyline(this.view.spatialReference);

            var gapRatio = GeoTools._2PtLen(pts[0], pts[pts.length - 1]);
            gapRatio = gapRatio / 20;

            var cLenLimit: number, echelons: any[];
            var baseLineLen = GeoTools._2PtLen(pts[0], pts[pts.length - 1]) / 7;
            cLenLimit = baseLineLen / 7;
            if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
            var resPts = GeoTools.getDashPts(pts, [gapRatio, gapRatio]);
            for (var i = 0; i < resPts.length; i++) {
                echelons = Shapes.createEchelon('18', resPts[i], cLenLimit);
                for (var j = 0; j <= echelons.length - 1; j++) {
                    result.addPath(echelons[j]);
                }
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
    }

    private _onDblClkHandler(clickPoint: any): void {
        this._points.push(clickPoint.mapPoint);
        this.cleanUp();
    }

    private cleanUp(): void {
        var drawEss = new DrawEssentials();
        drawEss = this.createDrawEssentials(this._points.slice());
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
}

export default UnspecifiedWire; 