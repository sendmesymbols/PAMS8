import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Polygon from "@arcgis/core/geometry/Polygon";
import Graphic from "@arcgis/core/Graphic";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import DrawEssentials from "../Support/DrawEssentials";
import GeoTools from "../Support/GeoTools";
import Shapes from "../Support/Shapes";
import BattlePosition from "./BattlePosition.ts";

export interface PenetrationBoxOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    DRAW_TYPE?: number;
    [key: string]: any;
}

/**
 * Class Representing Penetration Box.
 * @class
 * @author Abdul Razak
 */
class PenetrationBox {
    public declaredClass: string = "MilitarySymbology.Symbols.PenetrationBox";
    public SID: string = "151900";
    public symName: string = "Pen Box";
    public symGeometricType: string = "Area";

    private view: MapView | SceneView;
    private isLine: boolean;
    private _lineSymbol: SimpleLineSymbol | null = null;
    private _points: Point[] = [];
    private _geometryType: string | null = null;
    private _drawType: number = 1;
    private _tGraphic: Graphic | null = null;

    // Event handlers
    private _onClick: any = null;
    private _onDblClick: any = null;
    private _onMouseMove: any = null;

    // Event emitter
    private eventListeners: Map<string, Function[]> = new Map();

    constructor(view: MapView | SceneView, isLine: boolean) {
        this.view = view;
        this.isLine = isLine;
    }

    /**
     * Initialize the symbol drawing
     */
    public init(options: PenetrationBoxOptions, marker: SimpleLineSymbol): void {
        this._lineSymbol = marker;
        this.view.navigation.setImmediateClick(false);
        this.view.disableDoubleClickZoom();

        const drawEssentials = new DrawEssentials();
        this._drawType = options.DRAW_TYPE || 1;

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
            this._tGraphic = new Graphic({ geometry: options.GEOM });
            drawEssentials.CTRL_PTS = [...(options.CTRL_PTS || [])];
            drawEssentials.DRAW_TYPE = this._drawType;
            this.__drawEnd(this._tGraphic.geometry as Polygon, drawEssentials);
            this._clear();
        } else if (options.hasOwnProperty("CTRL_PTS")) {
            drawEssentials.CTRL_PTS = [...(options.CTRL_PTS || [])];
            drawEssentials.DRAW_TYPE = this._drawType;
            this._tGraphic = new Graphic({ 
                geometry: this.createSymbol(drawEssentials),
                symbol: this._lineSymbol 
            });
            this.__drawEnd(this._tGraphic.geometry as Polygon, drawEssentials);
            this._clear();
        } else {
            this._tGraphic = new Graphic({ symbol: this._lineSymbol });
            if ((this.view as any).graphics) {
                (this.view as any).graphics.add(this._tGraphic);
            }

            this._onClick = this.view.on("click", this._onClickHandler.bind(this));
            this._onDblClick = this.view.on("double-click", this._onDblClickHandler.bind(this));
        }
    }

    /**
     * Create draw essentials object
     */
    private createDrawEssentials(ctrlPts: Point[], drawType: number): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SCOPE = this.declaredClass;
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.CTRL_PTS = ctrlPts;
        drawEssentials.AMPLIFIER = (this as any).amplifier;
        drawEssentials.DRAW_TYPE = drawType;
        return drawEssentials;
    }

    /**
     * Create the symbol geometry
     */
    private createSymbol(drawEssentials: DrawEssentials): Polygon {
        try {
            const pts = drawEssentials.CTRL_PTS;
            if (!pts || pts.length === 0) {
                throw new Error("controlPoints not found");
            }

            const lastPoint = pts[pts.length - 1];
            const firstPoint = pts[0];
            const result = new Polygon({ spatialReference: this.view.spatialReference });

            switch (drawEssentials.DRAW_TYPE) {
                case 1:
                    return this.createSymbolByBCurve(pts, firstPoint, lastPoint, drawEssentials);
                case 2:
                    return this.createSymbolByPolygon(pts, firstPoint, lastPoint, drawEssentials);
                case 3:
                    return this.createSymbolByRect(pts, firstPoint, lastPoint, drawEssentials);
                default:
                    throw new Error("Invalid draw type");
            }
        } catch (e) {
            console.log(this.declaredClass + ' Can not create Symbol due to invalid geometry');
            throw e;
        }
    }

    /**
     * Handle mouse move events
     */
    private _onMouseMoveHandler(inputPoint: any): void {
        const candidatePoint = this.view.toMap(inputPoint);
        if (!candidatePoint) return;

        const drawEssentials = new DrawEssentials();
        drawEssentials.CTRL_PTS = [...this._points, candidatePoint];
        drawEssentials.DRAW_TYPE = this._drawType;

        if (this._tGraphic) {
            this._tGraphic.geometry = this.createSymbol(drawEssentials);
        }

        this.emit("onDrawProgress", { 
            currentGeometry: this._tGraphic?.geometry, 
            currentDrawEssentials: drawEssentials, 
            currentMarker: this._lineSymbol 
        });
    }

    /**
     * Handle click events
     */
    private _onClickHandler(clickPoint: any): void {
        const mapPoint = this.view.toMap(clickPoint);
        if (!mapPoint) return;

        this._points.push(new Point({
            x: mapPoint.x,
            y: mapPoint.y,
            spatialReference: this.view.spatialReference
        }));

        if (this._points.length === 1) {
            this._onMouseMove = this.view.on("pointer-move", this._onMouseMoveHandler.bind(this));
        }

        this.emit("onDrawClick", { currentPts: this._points });

        if (this.isLine && this._points.length === 1) {
            this.emit("onDrawClick", { currentPts: this._points });
            this.cleanUp();
        }

        if (this._drawType === 3 && this._points.length === 2) {
            this.emit("onDrawClick", { currentPts: this._points });
            this.cleanUp();
        }
    }

    /**
     * Handle double click events
     */
    private _onDblClickHandler(clickPoint: any): void {
        const mapPoint = this.view.toMap(clickPoint);
        if (!mapPoint) return;

        this._points.push(new Point({
            x: mapPoint.x,
            y: mapPoint.y,
            spatialReference: this.view.spatialReference
        }));

        this.cleanUp();
    }

    /**
     * Clean up drawing state
     */
    private cleanUp(): void {
        const drawEss = this.createDrawEssentials([...this._points], this._drawType);
        this.__drawEnd(this._tGraphic?.geometry as Polygon, drawEss);
        this._clear();
        this._removeEvents();
    }

    /**
     * Handle draw end
     */
    private __drawEnd(drawGeometry: Polygon, drawEssentials: DrawEssentials): void {
        if (drawGeometry) {
            let geographicGeometry: Polygon | null = null;
            const spRef = this.view.spatialReference;

            if (spRef.isWebMercator) {
                geographicGeometry = drawGeometry.clone() as Polygon;
            } else if (spRef.wkid === 4326) {
                geographicGeometry = drawGeometry.clone() as Polygon;
            }

            this.__onDrawEnd(drawGeometry, geographicGeometry, drawEssentials);
        }
    }

    /**
     * Emit draw end event
     */
    private __onDrawEnd(geometry: Polygon, geoGeometry: Polygon | null, drawEssParam: DrawEssentials): void {
        this.emit("onDrawEnd", { 
            geometry: geometry, 
            geographicGeometry: geoGeometry, 
            drawEssentials: drawEssParam, 
            marker: this._lineSymbol 
        });
    }

    /**
     * Clear drawing state
     */
    private _clear(): void {
        if (this._tGraphic && (this.view as any).graphics) {
            (this.view as any).graphics.remove(this._tGraphic);
        }

        this._tGraphic = null;
        this._points = [];
    }

    /**
     * Remove event listeners
     */
    private _removeEvents(): void {
        if (this._onClick) this._onClick.remove();
        if (this._onDblClick) this._onDblClick.remove();
        if (this._onMouseMove) this._onMouseMove.remove();
        this.view.enableDoubleClickZoom();
    }

    /**
     * Deactivate the symbol
     */
    public deactivate(): void {
        this._clear();
        this._removeEvents();
        this._geometryType = null;
    }

    /**
     * Create Bezier path
     */
    private CreateBezierPath(pointCollection: Point[], numberOfPts: number, view: MapView | SceneView): Polygon {
        const position = { x: pointCollection[0].x, y: pointCollection[0].y };
        
        if (pointCollection[pointCollection.length - 1].x === pointCollection[pointCollection.length - 2].x && 
            pointCollection[pointCollection.length - 1].y === pointCollection[pointCollection.length - 2].y) {
            pointCollection.pop();
        }
        
        if (pointCollection[pointCollection.length - 1].x === pointCollection[pointCollection.length - 2].x && 
            pointCollection[pointCollection.length - 1].y === pointCollection[pointCollection.length - 2].y) {
            pointCollection.pop();
        }

        // Note: This would need TweenMax library for bezier curve calculation
        // For now, we'll create a simple polygon
        const path: Point[] = [];
        for (let i = 0; i <= numberOfPts; i++) {
            const t = i / numberOfPts;
            // Simple linear interpolation for now
            const x = pointCollection[0].x + t * (pointCollection[pointCollection.length - 1].x - pointCollection[0].x);
            const y = pointCollection[0].y + t * (pointCollection[pointCollection.length - 1].y - pointCollection[0].y);
            path.push(new Point({ x, y, spatialReference: view.spatialReference }));
        }

        const result = new Polygon({ spatialReference: view.spatialReference });
        result.addRing(path);
        return result;
    }

    /**
     * Create symbol by B-curve
     */
    private createSymbolByBCurve(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials): Polygon {
        const tempArray: Point[] = [];
        pts.forEach(e => {
            tempArray.push(new Point({ x: e.x, y: e.y, spatialReference: this.view.spatialReference }));
        });

        tempArray.push(new Point({ x: firstPoint.x, y: firstPoint.y, spatialReference: this.view.spatialReference }));
        return this.CreateBezierPath(tempArray, 130, this.view);
    }

    /**
     * Create symbol by polygon
     */
    private createSymbolByPolygon(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials): Polygon {
        const result = new Polygon({ spatialReference: this.view.spatialReference });
        const tempArray: Point[] = [];
        
        pts.forEach(e => {
            tempArray.push(new Point({ x: e.x, y: e.y, spatialReference: this.view.spatialReference }));
        });

        tempArray.push(new Point({ x: firstPoint.x, y: firstPoint.y, spatialReference: this.view.spatialReference }));
        result.addRing(tempArray);
        return result;
    }

    /**
     * Create symbol by rectangle
     */
    private createSymbolByRect(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials): Polygon {
        const result = new Polygon({ spatialReference: this.view.spatialReference });
        const tempArray: Point[] = [];
        
        pts.forEach(e => {
            tempArray.push(new Point({ x: e.x, y: e.y, spatialReference: this.view.spatialReference }));
        });

        result.addRing(tempArray);
        const extent = result.extent;
        
        const newResult = new Polygon({ spatialReference: this.view.spatialReference });
        const newTempArray: Point[] = [];
        newTempArray.push(firstPoint);
        newTempArray.push(new Point({ x: extent.xmin, y: extent.ymin, spatialReference: this.view.spatialReference }));
        newTempArray.push(lastPoint);
        newTempArray.push(new Point({ x: extent.xmax, y: extent.ymax, spatialReference: this.view.spatialReference }));
        newTempArray.push(firstPoint);

        newResult.addRing(newTempArray);
        return newResult;
    }

    /**
     * Emit events
     */
    private emit(eventName: string, data: any): void {
        const listeners = this.eventListeners.get(eventName);
        if (listeners) {
            listeners.forEach(callback => callback(data));
        }
    }

    /**
     * Add event listener
     */
    public on(eventName: string, callback: Function): void {
        if (!this.eventListeners.has(eventName)) {
            this.eventListeners.set(eventName, []);
        }
        this.eventListeners.get(eventName)!.push(callback);
    }

    /**
     * Remove event listener
     */
    public off(eventName: string, callback?: Function): void {
        if (!callback) {
            this.eventListeners.delete(eventName);
        } else {
            const listeners = this.eventListeners.get(eventName);
            if (listeners) {
                const index = listeners.indexOf(callback);
                if (index > -1) {
                    listeners.splice(index, 1);
                }
            }
        }
    }
}

export default PenetrationBox;