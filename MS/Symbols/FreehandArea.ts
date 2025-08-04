import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";

export interface FreehandAreaOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    DRAW_TYPE?: number;
    [key: string]: any;
}

/**
 * FreehandArea class for drawing freehand area symbols on MapView or SceneView
 * Supports both immediate placement and interactive drawing modes
 */
export class FreehandArea {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;
    
    // Symbol properties
    private SID: string = "000002";
    private symName: string = "Freehand - Area";
    private symGeometricType: string = "Area";
    private _lineSym: SimpleFillSymbol | SimpleLineSymbol | null = null;
    private _points: Point[] = [];
    private _drawType: number = 1;
    private _geometryType: string | null = null;
    private amplifier: Amplifier;
    
    // Drawing state
    private isDrawing: boolean = false;
    private tempGraphic: Graphic | null = null;
    
    // Event handlers
    private clickHandler: any = null;
    private doubleClickHandler: any = null;
    private mouseMoveHandler: any = null;
    
    // Event emitter
    private eventListeners: Map<string, Function[]> = new Map();

    constructor(view: MapView | SceneView, isLine: boolean = false) {
        this.view = view;
        this.isLine = isLine;
        this.layerManager = GraphicsLayerManager.getInstance(view);
        this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.FORCE);
        this.amplifier = new Amplifier();
        
        // Initialize layers if not already done
        this.layerManager.initializeLayers();
        
        // Initialize temporary graphic
        this.tempGraphic = new Graphic();
    }

    /**
     * Initialize the freehand area drawing
     */
    public init(options: FreehandAreaOptions, marker: SimpleFillSymbol | SimpleLineSymbol): void {
        this._lineSym = marker;
        
        // Set up event handlers
        this.setupEventHandlers();

        const drawEssentials = new DrawEssentials();
        this._drawType = GeoTools.setDefault(options, "DRAW_TYPE", this._drawType);

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
            // Immediate placement with both control points and geometry
            try {
                this.tempGraphic.geometry = new Polygon({
                    rings: options.GEOM,
                    spatialReference: this.view.spatialReference
                });
            } catch (error) {
                console.error(this.symName, "Failed to create Polygon geometry:", error);
            }
            
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._drawType);
            if (this.tempGraphic && this.tempGraphic.geometry) {
                this.__drawEnd(this.tempGraphic.geometry as Polygon, drawEss);
            }
            this._clear();

        } else if (options.hasOwnProperty("CTRL_PTS")) {
            // Immediate placement with control points only
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._drawType);
            const geometry = this.createSymbol(drawEss);
            if (geometry && this.tempGraphic) {
                this.tempGraphic.geometry = geometry;
                this.__drawEnd(geometry, drawEss);
                this._clear();
            }

        } else {
            // Interactive drawing mode
            this.startInteractiveDrawing();
        }
    }

    /**
     * Start interactive drawing mode
     */
    private startInteractiveDrawing(): void {
        if (!this._lineSym) return;
        this.isDrawing = true;
        this.tempGraphic = new Graphic({
            geometry: null,
            symbol: this._lineSym
        });
        this.symbolLayer.add(this.tempGraphic);
    }

    /**
     * Set up mouse event handlers for interactive drawing
     */
    private setupEventHandlers(): void {
        // Click handler
        this.clickHandler = this.view.on("click", (event) => {
            this._onClickHandler(event);
        });

        // Double click handler  
        this.doubleClickHandler = this.view.on("double-click", (event) => {
            this._onDoubleClickHandler(event);
        });
    }

    /**
     * Handle click events
     */
    private _onClickHandler(clickEvent: any): void {
        const mapPoint = this.view.toMap(clickEvent);
        if (!mapPoint) return;

        const point = new Point({
            x: mapPoint.x,
            y: mapPoint.y,
            spatialReference: this.view.spatialReference
        });
        
        this._points.push(point);

        if (this._points.length === 1) {
            // First click - set up mouse move handler
            this.mouseMoveHandler = this.view.on("pointer-move", (event) => {
                this._onMouseMoveHandler(event);
            });
        }
        
        this.emit("onDrawClick", { currentPts: this._points });

        // For single line mode, finish after first click
        if (this.isLine === true && this._points.length === 1) {
            this.emit("onDrawClick", { currentPts: this._points });
            this.cleanUp();
        }

        // For rectangle or ellipse, finish after second click
        if ((this._drawType === 3 || this._drawType === 4) && this._points.length === 2) {
            this.emit("onDrawClick", { currentPts: this._points });
            this.cleanUp();
        }
    }

    /**
     * Handle double click events
     */
    private _onDoubleClickHandler(clickEvent: any): void {
        const mapPoint = this.view.toMap(clickEvent);
        if (!mapPoint) return;

        const point = new Point({
            x: mapPoint.x,
            y: mapPoint.y,
            spatialReference: this.view.spatialReference
        });
        
        this._points.push(point);
        this.cleanUp();
    }

    /**
     * Handle mouse move events
     */
    private _onMouseMoveHandler(inputEvent: any): void {
        if (!this.isDrawing || !this.tempGraphic) return;

        const mapPoint = this.view.toMap(inputEvent);
        if (!mapPoint) return;

        const candidatePoint = new Point({
            x: mapPoint.x,
            y: mapPoint.y,
            spatialReference: this.view.spatialReference
        });

        const drawEssentials = new DrawEssentials();
        (drawEssentials as any).CTRL_PTS = this._points.concat([candidatePoint]);
        (drawEssentials as any).DRAW_TYPE = this._drawType;

        const geometry = this.createSymbol(drawEssentials);
        if (geometry) {
            this.tempGraphic.geometry = geometry;
            this.emit("onDrawProgress", {
                currentGeometry: geometry,
                currentDrawEssentials: drawEssentials,
                currentMarker: this._lineSym
            });
        }
    }

    /**
     * Create DrawEssentials object
     */
    private createDrawEssentials(ctrlPts: Point[], drawType: number): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.GEOM = null;
        drawEssentials.AMPLIFIER = this.amplifier.toString();
        
        // Store additional properties
        (drawEssentials as any).SCOPE = this;
        (drawEssentials as any).CTRL_PTS = ctrlPts;
        (drawEssentials as any).DRAW_TYPE = drawType;
        (drawEssentials as any).ISFHAND = 1;

        return drawEssentials;
    }

    /**
     * Create symbol geometry from DrawEssentials
     */
    private createSymbol(drawEssentials: DrawEssentials): Polygon | null {
        try {
            let pts: Point[];

            if ((drawEssentials as any).CTRL_PTS) {
                pts = (drawEssentials as any).CTRL_PTS;
            } else {
                throw new Error("controlPoints not found");
            }

            const firstPoint = pts[0];
            const lastPoint = pts[pts.length - 1];

            switch ((drawEssentials as any).DRAW_TYPE) {
                case 1:
                    return this.createSymbolByBCurve(pts, firstPoint, lastPoint, drawEssentials);
                case 2:
                    return this.createSymbolByPolygon(pts, firstPoint, lastPoint, drawEssentials);
                case 3:
                    return this.createSymbolByRect(pts, firstPoint, lastPoint, drawEssentials);
                case 4:
                    return this.createSymbolByPerfectEllipse(pts, firstPoint, lastPoint, drawEssentials);
                default:
                    return new Polygon({ spatialReference: this.view.spatialReference });
            }

        } catch (e) {
            console.log(e);
            console.log(this.constructor.name + ' Cannot create Symbol due to invalid geometry');
            return null;
        }
    }

    /**
     * Create Bezier curve symbol
     */
    private createSymbolByBCurve(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials): Polygon {
        const tempArray: { x: number, y: number }[] = [];
        pts.forEach(pt => {
            tempArray.push({ x: pt.x, y: pt.y });
        });
        tempArray.push({ x: firstPoint.x, y: firstPoint.y });

        return this.CreateBezierPath(tempArray, 130);
    }

    /**
     * Create polygon symbol
     */
    private createSymbolByPolygon(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials): Polygon {
        const result = new Polygon({ spatialReference: this.view.spatialReference });
        const tempArray: number[][] = [];
        
        pts.forEach(pt => {
            tempArray.push([pt.x, pt.y]);
        });
        tempArray.push([firstPoint.x, firstPoint.y]);

        result.addRing(tempArray);
        return result;
    }

    /**
     * Create rectangle symbol
     */
    private createSymbolByRect(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials): Polygon {
        const result = new Polygon({ spatialReference: this.view.spatialReference });
        const tempArray: number[][] = [];
        
        pts.forEach(pt => {
            tempArray.push([pt.x, pt.y]);
        });

        // Create temporary polygon to get extent
        const tempPolygon = new Polygon({ spatialReference: this.view.spatialReference });
        tempPolygon.addRing(tempArray);
        const extent = tempPolygon.extent;

        if (!extent) {
            // Fallback to simple rectangle using first and last points
            const rectArray: number[][] = [
                [firstPoint.x, firstPoint.y],
                [firstPoint.x, lastPoint.y],
                [lastPoint.x, lastPoint.y],
                [lastPoint.x, firstPoint.y],
                [firstPoint.x, firstPoint.y]
            ];
            result.addRing(rectArray);
            return result;
        }

        // Create rectangle from extent
        const rectArray: number[][] = [
            [extent.xmin, extent.ymin],
            [extent.xmin, extent.ymax],
            [extent.xmax, extent.ymax],
            [extent.xmax, extent.ymin],
            [extent.xmin, extent.ymin]
        ];

        result.addRing(rectArray);
        return result;
    }

    /**
     * Create perfect ellipse symbol
     */
    private createSymbolByPerfectEllipse(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials): Polygon {
        const result = new Polygon({ spatialReference: this.view.spatialReference });

        // Convert points to screen coordinates for ellipse calculation
        const firstPtScreen = this.view.toScreen(firstPoint);
        const lastPtScreen = this.view.toScreen(lastPoint);
        
        if (!firstPtScreen || !lastPtScreen) {
            // Fallback to simple ellipse if screen conversion fails
            return this.createSimpleEllipse(firstPoint, lastPoint);
        }
        
        const widthScreen = Math.abs(lastPtScreen.x - firstPtScreen.x);
        const heightScreen = Math.abs(lastPtScreen.y - firstPtScreen.y);

        // Create ellipse using Shapes utility (assuming it exists and is compatible)
        if (Shapes && (Shapes as any).createEllipse) {
            try {
                const paths = (Shapes as any).createEllipse({
                    center: firstPtScreen,
                    longAxis: widthScreen,
                    shortAxis: heightScreen,
                    numberOfPoints: 60,
                    view: this.view
                });

                // Convert screen coordinates back to map coordinates
                const mapPath: number[][] = [];
                paths.forEach((screenPt: any) => {
                    const mapPt = this.view.toMap(screenPt);
                    if (mapPt) {
                        mapPath.push([mapPt.x, mapPt.y]);
                    }
                });

                result.addRing(mapPath);
            } catch (e) {
                // Fallback to simple circle if Shapes utility fails
                return this.createSimpleEllipse(firstPoint, lastPoint);
            }
        } else {
            // Fallback to simple circle
            return this.createSimpleEllipse(firstPoint, lastPoint);
        }

        return result;
    }

    /**
     * Create simple ellipse as fallback
     */
    private createSimpleEllipse(centerPoint: Point, radiusPoint: Point): Polygon {
        const result = new Polygon({ spatialReference: this.view.spatialReference });
        const centerX = centerPoint.x;
        const centerY = centerPoint.y;
        const radiusX = Math.abs(radiusPoint.x - centerX);
        const radiusY = Math.abs(radiusPoint.y - centerY);

        const points: number[][] = [];
        const numberOfPoints = 60;

        for (let i = 0; i <= numberOfPoints; i++) {
            const angle = (2 * Math.PI * i) / numberOfPoints;
            const x = centerX + radiusX * Math.cos(angle);
            const y = centerY + radiusY * Math.sin(angle);
            points.push([x, y]);
        }

        result.addRing(points);
        return result;
    }

    /**
     * Create Bezier path from points
     * Note: This is a simplified implementation without TweenMax
     */
    private CreateBezierPath(pointCollection: { x: number, y: number }[], numberOfPts: number): Polygon {

        var position = { x: pointCollection[0].x, y: pointCollection[0].y };
        if (pointCollection[pointCollection.length - 1].x === pointCollection[pointCollection.length - 2].x && pointCollection[pointCollection.length - 1].y === pointCollection[pointCollection.length - 2].y) {
            pointCollection.pop();
        }
        if (pointCollection[pointCollection.length - 1].x === pointCollection[pointCollection.length - 2].x && pointCollection[pointCollection.length - 1].y === pointCollection[pointCollection.length - 2].y) {
            pointCollection.pop();
        }
        //pointCollection.push(pt);
        var tween = window.TweenMax.to(position, numberOfPts, { bezier: pointCollection, ease: window.Linear.easeNone });
        //ease:Power1.easeInOut  ease: Linear.easeNone
        var path = [];
        var i;
        for (i = 0; i <= numberOfPts; i++) {
            tween.time(i);
            path.push([position.x, position.y]);
        }

        var result = new Polygon({"spatialReference": this.view.spatialReference});
        result.addRing(path);
        return result;
    }

    /**
     * Remove duplicate consecutive points
     */
    private removeDuplicatePoints(points: { x: number, y: number }[]): { x: number, y: number }[] {
        if (points.length <= 1) return points;

        const result = [points[0]];
        for (let i = 1; i < points.length; i++) {
            const current = points[i];
            const previous = points[i - 1];
            if (current.x !== previous.x || current.y !== previous.y) {
                result.push(current);
            }
        }
        return result;
    }

    /**
     * Calculate Bezier curve point at parameter t
     * Simplified implementation for multiple control points
     */
    private calculateBezierPoint(points: { x: number, y: number }[], t: number): { x: number, y: number } {
        if (points.length === 1) return points[0];
        
        // Use linear interpolation for simplicity
        // For proper Bezier curves, implement De Casteljau's algorithm
        const segmentLength = 1 / (points.length - 1);
        const segmentIndex = Math.min(Math.floor(t / segmentLength), points.length - 2);
        const localT = (t - segmentIndex * segmentLength) / segmentLength;
        
        const p1 = points[segmentIndex];
        const p2 = points[segmentIndex + 1];
        
        return {
            x: p1.x + (p2.x - p1.x) * localT,
            y: p1.y + (p2.y - p1.y) * localT
        };
    }

    /**
     * Clean up drawing state and finalize
     */
    private cleanUp(): void {
        if (this._points.length === 0) return;

        const drawEssentials = this.createDrawEssentials(this._points.slice(), this._drawType);
        
        if (this.tempGraphic && this.tempGraphic.geometry) {
            this.__drawEnd(this.tempGraphic.geometry as Polygon, drawEssentials);
        }
        
        this._clear();
        this._removeEvents();
    }

    /**
     * Handle draw end
     */
    private __drawEnd(drawGeometry: Polygon, drawEssentials: DrawEssentials): void {
        if (drawGeometry) {
            const spatialRef = this.view.spatialReference;
            let geographicGeometry = drawGeometry;

            if (spatialRef && spatialRef.isWebMercator) {
                // Geographic conversion would go here if needed
                // geographicGeometry = webMercatorUtils.webMercatorToGeographic(drawGeometry);
            } else if (spatialRef && spatialRef.wkid === 4326) {
                geographicGeometry = drawGeometry.clone();
            }

            this.__onDrawEnd(drawGeometry, geographicGeometry, drawEssentials);
        }
    }

    /**
     * Final draw end handler
     */
    private __onDrawEnd(geometry: Polygon, geoGeometry: Polygon, drawEssParam: DrawEssentials): void {
        this.emit("onDrawEnd", {
            geometry: geometry,
            geographicGeometry: geoGeometry,
            drawEssentials: drawEssParam,
            marker: this._lineSym
        });
    }

    /**
     * Clear graphics and state
     */
    private _clear(): void {
        if (this.tempGraphic && this.symbolLayer) {
            this.symbolLayer.remove(this.tempGraphic);
        }
        
        this.tempGraphic = null;
        this._points = [];
    }

    /**
     * Remove event handlers
     */
    private _removeEvents(): void {
        if (this.clickHandler) {
            this.clickHandler.remove();
            this.clickHandler = null;
        }
        if (this.doubleClickHandler) {
            this.doubleClickHandler.remove();
            this.doubleClickHandler = null;
        }
        if (this.mouseMoveHandler) {
            this.mouseMoveHandler.remove();
            this.mouseMoveHandler = null;
        }
    }

    /**
     * Deactivate the drawing tool
     */
    public deactivate(): void {
        this._clear();
        this._removeEvents();
        this._geometryType = null;
        this.isDrawing = false;
    }

    /**
     * Event emitter functionality
     */
    private emit(eventName: string, data: any): void {
        const listeners = this.eventListeners.get(eventName);
        if (listeners) {
            listeners.forEach(listener => listener(data));
        }
        
        // Also emit as a global document event for SymbolEngine to catch
        this.emitGlobalEvent(eventName, data);
    }

    /**
     * Emit global events that can be caught by SymbolEngine
     */
    private emitGlobalEvent(eventName: string, data: any): void {
        const customEvent = new CustomEvent(eventName, {
            detail: {
                symbolType: "FreehandArea",
                eventName: eventName,
                ...data
            },
            bubbles: true,
            cancelable: true
        });

        // Dispatch from the view container if available, otherwise from document
        if (this.view && this.view.container) {
            this.view.container.dispatchEvent(customEvent);
        } else {
            document.dispatchEvent(customEvent);
        }
    }

    public on(eventName: string, callback: Function): void {
        if (!this.eventListeners.has(eventName)) {
            this.eventListeners.set(eventName, []);
        }
        this.eventListeners.get(eventName)!.push(callback);
    }

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

    /**
     * Get the current symbol layer
     */
    public getSymbolLayer(): GraphicsLayer {
        return this.symbolLayer;
    }

    /**
     * Clear all symbols from the layer
     */
    public clearSymbols(): void {
        this.symbolLayer.removeAll();
    }
}

export default FreehandArea; 