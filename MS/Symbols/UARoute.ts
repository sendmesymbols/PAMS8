/**
 * Class Representing Unmanned Aircraft (UA) Route.
 * @class
 * @author Abdul Razak
 */

import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Polygon from "@arcgis/core/geometry/Polygon";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";

export interface UARouteOptions {
    CTRL_PTS?: Point[];
    BASE_LN_PTS?: any;
    GEOM?: Polyline;
    [key: string]: any;
}

class UARoute {
    public SID = "170700";
    public symName = "UAV Route";
    public symGeometricType = "Line";

    private map: MapView | SceneView;
    private isLine: boolean;
    private _tGraphic: Graphic | null = null;
    private _lineSym: SimpleLineSymbol | SimpleFillSymbol;
    private _points: Point[] = [];
    private _baseLinePts: Point[] = [];
    private _geometryType: string | null = null;

    // Event handler properties
    private _onClickHandler: any;
    private _onDoubleClickHandler: any;
    private _onPointerMoveHandler: any;
    private _onBaseLineEndHandler: any;
    private _onBaseLineProgressHandler: any;
    private _onBaseLineClickHandler: any;

    constructor(map: MapView | SceneView, isLine: boolean) {
        this.map = map;
        this.isLine = isLine;
        this._tGraphic = new Graphic();
    }

    public init(options: UARouteOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void {
        this._lineSym = marker;

        // Disable map navigation for drawing
        if ('disableDoubleClickZoom' in this.map) {
            (this.map as any).disableDoubleClickZoom();
        }

        const drawEssentials = new DrawEssentials();

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("BASE_LN_PTS") && options.hasOwnProperty("GEOM")) {
            this._tGraphic!.geometry = options.GEOM;
            const essentials = this.createDrawEssentials(this._cloneArray(options.CTRL_PTS!), this._cloneArray(options.BASE_LN_PTS));
            this.__drawEnd(this._tGraphic!.geometry, essentials);
            this._clear();
        } else if (options.hasOwnProperty("CTRL_PTS")) {
            if (options.hasOwnProperty("BASE_LN_PTS")) {
                const essentials = this.createDrawEssentials(this._cloneArray(options.CTRL_PTS!), this._cloneArray(options.BASE_LN_PTS));
                this._tGraphic!.geometry = this.createSymbol(essentials);
                this.__drawEnd(this._tGraphic!.geometry, essentials);
                this._clear();
            } else {
                throw "Control Points and Baseline or Distance is required to create symbol non-interactively";
            }
        } else {
            // Interactive drawing mode - would need BaseLine implementation
            // For now, set up basic event handlers
            this._tGraphic = new Graphic({ symbol: this._lineSym });
            this.map.graphics.add(this._tGraphic);
            this._setupEventHandlers();
        }
    }

    public createDrawEssentials(ctrlPts: Point[], baseLinePts: any): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SCOPE = this;
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        (drawEssentials as any).CTRL_PTS = ctrlPts;
        (drawEssentials as any).BASE_LN_PTS = baseLinePts;
        return drawEssentials;
    }

    public createSymbol(drawEssentials: DrawEssentials): Polyline | null {
        try {
            let pts: Point[];

            if ((drawEssentials as any).hasOwnProperty("CTRL_PTS")) {
                pts = (drawEssentials as any).CTRL_PTS;
            } else {
                throw "controlPoints not found";
            }

            const stPt = (drawEssentials as any).BASE_LN_PTS.startPt;
            const endPt = (drawEssentials as any).BASE_LN_PTS.endPt;

            if (stPt === undefined || endPt === undefined) {
                throw "First Parameter of the Function is an Array with Start and End Point";
            }

            const midPt = GeoTools.getMidPoint(stPt, endPt);
            const result = new Polyline({ spatialReference: this.map.spatialReference });

            const firstPoint = pts[0];
            const leftArray: number[][] = [];
            const rightArray: number[][] = [];
            const middleArray: number[][] = [];

            let len = GeoTools._2PtLen(midPt, endPt);
            let k = Math.atan((midPt.y - firstPoint.y) / (midPt.x - firstPoint.x));

            switch (GeoTools.twoPtsRelationShip(midPt, firstPoint)) {
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
            const p1 = { x: partialLen * Math.cos(k) + midPt.x, y: partialLen * Math.sin(k) + midPt.y };
            const p2 = { x: -1 * partialLen * Math.cos(k) + midPt.x, y: -1 * partialLen * Math.sin(k) + midPt.y };

            if (pts.length >= 1) {
                leftArray.push([p1.x, p1.y]);
                rightArray.push([p2.x, p2.y]);
                middleArray.push([midPt.x, midPt.y]);
            }

            const gapLen = GeoTools._2PtLen(endPt, stPt);

            for (let i = 0; i < pts.length; i++) {
                // Find distance between candidatePoint and Mid Point
                const length = GeoTools._2PtLen(midPt, pts[i]);
                const angle = GeoTools.angleInRadians(midPt, pts[i]);

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
                const baseLineLen = GeoTools._2PtLen(stPtCandidatePt, endPtCandidatePt);
                const baseLineLenLimit = baseLineLen / 4;
                if (len > baseLineLenLimit) len = baseLineLenLimit;

                leftArray.push([stPtCandidatePt.x, stPtCandidatePt.y]);
                rightArray.push([endPtCandidatePt.x, endPtCandidatePt.y]);
                middleArray.push([pts[i].x, pts[i].y]);

                // Create Circles
                const circlePath = this.createACP(pts[i], gapLen / 2);
                result.addPath(circlePath);

                // Add text if available
                if (Shapes && typeof Shapes.createACP === 'function') {
                    try {
                        const text = Shapes.createACP(pts[i].x, pts[i].y, gapLen / 10, pts[i].spatialReference);
                        for (let j = 0; j <= text.length - 1; j++) {
                            result.addPath(text[j]);
                        }
                    } catch (e) {
                        console.log('Cannot create ACP text');
                    }
                }
            }

            result.addPath(leftArray);
            result.addPath(rightArray);

            // Add circle for middle point
            result.addPath(this.createACP(middleArray[0] as any, gapLen / 2));

            // Add UA text along the path
            const values = GeoTools._fracture(middleArray, 10, this.map.spatialReference);
            let cLenLimit: number;
            for (let i = 0; i < values.midPoints.length; i++) {
                cLenLimit = values.midPoints[i].len / 2;
                const baseLineLen = GeoTools._2PtLen(stPt, endPt);
                if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;

                if (Shapes && typeof Shapes.createUA === 'function') {
                    try {
                        const text = Shapes.createUA(values.midPoints[i].midPt.x, values.midPoints[i].midPt.y, cLenLimit, values.midPoints[i].midPt.spatialReference);
                        for (let j = 0; j <= text.length - 1; j++) {
                            result.addPath(text[j]);
                        }
                    } catch (e) {
                        console.log('Cannot create UA text');
                    }
                }
            }

            return result;
        } catch (e) {
            console.log('Cannot create Symbol due to invalid geometry');
            return null;
        }
    }

    public createACP(pt: Point, radius: number): number[][] {
        // Create circle points
        if (Shapes && typeof Shapes.createCircle === 'function') {
            try {
                return Shapes.createCircle(pt, radius, 60);
            } catch (e) {
                console.log('Cannot create circle');
            }
        }
        // Fallback: simple circle approximation
        const path: number[][] = [];
        for (let i = 0; i <= 60; i++) {
            const angle = (i / 60) * 2 * Math.PI;
            path.push([pt.x + radius * Math.cos(angle), pt.y + radius * Math.sin(angle)]);
        }
        return path;
    }

    public getBaseLinePts(): Point[] {
        return this._baseLinePts;
    }

    private _setupEventHandlers(): void {
        this._onClickHandler = this.map.on("click", (event) => this._onClickHdler(event));
        this._onDoubleClickHandler = this.map.on("double-click", (event) => this._onDoubleClickHdler(event));
    }

    private _onClickHdler(clickPoint: any): void {
        this._points.push(clickPoint.mapPoint.clone());
        this.emit("onDrawClick", { 'currentPts': this._points });
        
        if (this.isLine && this._points.length === 1) {
            this.cleanUp();
        }
    }

    private _onDoubleClickHdler(clickPoint: any): void {
        this._points.push(clickPoint.mapPoint);
        this.cleanUp();
    }

    private cleanUp(): void {
        const drawEss = this.createDrawEssentials(this._cloneArray(this._points), this._cloneArray(this._baseLinePts));
        this.__drawEnd(this._tGraphic?.geometry, drawEss);
        this._clear();
        this._removeEvents();
    }

    private __drawEnd(drawGeometry: any, drawEssentials: DrawEssentials): void {
        if (drawGeometry) {
            let geographicGeometry: any;
            const spRef = this.map.spatialReference;
            
            if (spRef && (spRef as any).isWebMercator) {
                // Handle web mercator conversion if needed
                geographicGeometry = drawGeometry;
            } else if (spRef.wkid === 4326) {
                geographicGeometry = JSON.parse(JSON.stringify(drawGeometry.toJSON()));
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
        this._baseLinePts = [];
    }

    private _removeEvents(): void {
        if (this._onClickHandler) this._onClickHandler.remove();
        if (this._onDoubleClickHandler) this._onDoubleClickHandler.remove();
        if (this._onPointerMoveHandler) this._onPointerMoveHandler.remove();
        
        if ('enableDoubleClickZoom' in this.map) {
            (this.map as any).enableDoubleClickZoom();
        }
    }

    public deactivate(): void {
        this._clear();
        this._removeEvents();
        this._geometryType = null;
    }

    private _cloneArray(arr: any[]): any[] {
        return arr ? arr.map(item => item.clone ? item.clone() : { ...item }) : [];
    }

    private emit(eventName: string, data: any): void {
        // Event emission implementation
        console.log(`Event: ${eventName}`, data);
    }
}

export default UARoute; 