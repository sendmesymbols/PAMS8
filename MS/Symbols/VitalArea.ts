/**
 * Class Representing Vital Area.
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

export interface VitalAreaOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    DRAW_TYPE?: number;
    [key: string]: any;
}

class VitalArea {
    public SID = "242303";
    public symName = "Vital Area";
    public symGeometricType = "Area";

    private map: MapView | SceneView;
    private isLine: boolean;
    private _tGraphic: Graphic | null = null;
    private _lineSym: SimpleLineSymbol | SimpleFillSymbol;
    private _points: Point[] = [];
    private _geometryType: string | null = null;
    private _drawType: number = 1;

    // Event handler properties
    private _onClickHandler: any;
    private _onDoubleClickHandler: any;
    private _onPointerMoveHandler: any;

    constructor(map: MapView | SceneView, isLine: boolean) {
        this.map = map;
        this.isLine = isLine;
        this._tGraphic = new Graphic();
    }

    public init(options: VitalAreaOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void {
        this._lineSym = marker;
        this._drawType = options.DRAW_TYPE || 1;

        // Disable map navigation for drawing
        if ('disableDoubleClickZoom' in this.map) {
            (this.map as any).disableDoubleClickZoom();
        }

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
            this._tGraphic!.geometry = options.GEOM;
            const essentials = this.createDrawEssentials(this._cloneArray(options.CTRL_PTS!), options.DRAW_TYPE!);
            this.__drawEnd(this._tGraphic!.geometry, essentials);
            this._clear();
        } else if (options.hasOwnProperty("CTRL_PTS")) {
            const essentials = this.createDrawEssentials(this._cloneArray(options.CTRL_PTS!), options.DRAW_TYPE!);
            this._tGraphic!.geometry = this.createSymbol(essentials);
            this.__drawEnd(this._tGraphic!.geometry, essentials);
            this._clear();
        } else {
            this._tGraphic = new Graphic({ symbol: this._lineSym });
            this.map.graphics.add(this._tGraphic);
            this._setupEventHandlers();
        }
    }

    public createDrawEssentials(ctrlPts: Point[], drawType: number): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SCOPE = this;
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        (drawEssentials as any).CTRL_PTS = ctrlPts;
        (drawEssentials as any).DRAW_TYPE = drawType;
        return drawEssentials;
    }

    public createSymbol(drawEssentials: DrawEssentials): Polygon | null {
        try {
            let pts: Point[];

            if ((drawEssentials as any).hasOwnProperty("CTRL_PTS")) {
                pts = (drawEssentials as any).CTRL_PTS;
            } else {
                throw "controlPoints not found";
            }

            const lastPoint = pts[pts.length - 1];
            const firstPoint = pts[0];
            let result = new Polygon({ spatialReference: this.map.spatialReference });

            switch ((drawEssentials as any).DRAW_TYPE) {
                case 1:
                    result = this.createSymbolByBCurve(pts, firstPoint, lastPoint, drawEssentials);
                    break;
                case 2:
                    result = this.createSymbolByPolygon(pts, firstPoint, lastPoint, drawEssentials);
                    break;
                case 3:
                    result = this.createSymbolByRect(pts, firstPoint, lastPoint, drawEssentials);
                    break;
            }

            return result;
        } catch (e) {
            console.log('Cannot create Symbol due to invalid geometry');
            return null;
        }
    }

    private CreateBezierPath(pointCollection: any[], numberOfPts: number, map: MapView | SceneView): Polygon {
        // Simplified Bezier path creation
        const result = new Polygon({ spatialReference: map.spatialReference });
        const path: number[][] = [];
        
        // Create smooth curve by sampling points
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

                // Safe check for Shapes.createVA method
                if (Shapes && typeof Shapes.createVA === 'function') {
                    try {
                        const va = Shapes.createVA(midPt.x, midPt.y, cLenLimit, midPt.spatialReference);
                        for (let j = 0; j <= va.length - 1; j++) {
                            res.addRing(va[j]);
                        }
                    } catch (e) {
                        console.log('Cannot create VA text');
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
        let result = new Polygon({ spatialReference: this.map.spatialReference });
        
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
        const result = new Polygon({ spatialReference: this.map.spatialReference });
        
        const tempArray: number[][] = [];
        pts.forEach(e => {
            tempArray.push([e.x, e.y]);
        });
        
        tempArray.push([firstPoint.x, firstPoint.y]);
        result.addRing(tempArray);
        
        return this.createInnerText(result, firstPoint, lastPoint);
    }

    private createSymbolByRect(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials): Polygon {
        let result = new Polygon({ spatialReference: this.map.spatialReference });
        
        const tempArray: number[][] = [];
        pts.forEach(e => {
            tempArray.push([e.x, e.y]);
        });
        
        result.addRing(tempArray);
        const extent = result.extent;
        
        if (extent) {
            result = new Polygon({ spatialReference: this.map.spatialReference });
            
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

    private _setupEventHandlers(): void {
        this._onClickHandler = this.map.on("click", (event) => this._onClickHdler(event));
        this._onDoubleClickHandler = this.map.on("double-click", (event) => this._onDoubleClickHdler(event));
    }

    private _onPointerMoveHdler(inputPoint: any): void {
        const candidatePoint = inputPoint.mapPoint;
        const drawEssentials = new DrawEssentials();
        (drawEssentials as any).CTRL_PTS = this._points.concat(candidatePoint);
        (drawEssentials as any).DRAW_TYPE = this._drawType;
        
        if (this._tGraphic) {
            this._tGraphic.geometry = this.createSymbol(drawEssentials);
            this.emit("onDrawProgress", {
                'currentGeometry': this._tGraphic.geometry,
                'currentDrawEssentials': drawEssentials,
                'currentMarker': this._lineSym
            });
        }
    }

    private _onClickHdler(clickPoint: any): void {
        this._points.push(clickPoint.mapPoint.clone());
        if (this._points.length === 1) {
            this._onPointerMoveHandler = this.map.on("pointer-move", (event) => this._onPointerMoveHdler(event));
        }
        
        this.emit("onDrawClick", { 'currentPts': this._points });
        
        if (this.isLine && this._points.length === 1) {
            this.cleanUp();
        }

        if (this._drawType === 3 && this._points.length === 2) {
            this.cleanUp();
        }
    }

    private _onDoubleClickHdler(clickPoint: any): void {
        this._points.push(clickPoint.mapPoint);
        this.cleanUp();
    }

    private cleanUp(): void {
        const drawEss = this.createDrawEssentials(this._cloneArray(this._points), this._drawType);
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

export default VitalArea; 