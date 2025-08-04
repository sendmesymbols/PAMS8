import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";

export interface FreehandDottedArrowOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polyline;
    DRAW_TYPE?: number;
    TEETH_GAP?: number;
    [key: string]: any;
}

/**
 * FreehandDottedArrow class for drawing dotted arrow symbols on MapView or SceneView
 * Supports both immediate placement and interactive drawing modes
 */
export class FreehandDottedArrow {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;
    
    // Symbol properties
    private SID: string = "000007";
    private symName: string = "Freehand - Dotted Arrow";
    private symGeometricType: string = "Line";
    private _lineSym: SimpleLineSymbol | null = null;
    private _points: Point[] = [];
    private _drawType: number = 1;
    private _teethGap: number = 30;
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
     * Initialize the freehand dotted arrow drawing
     */
    public init(options: FreehandDottedArrowOptions, marker: SimpleLineSymbol): void {
        this._lineSym = marker;
        this._drawType = GeoTools.setDefault(options, "DRAW_TYPE", this._drawType);
        this._teethGap = GeoTools.setDefault(options, "TEETH_GAP", this._teethGap);
        
        // Set up event handlers
        this.setupEventHandlers();

        const drawEssentials = new DrawEssentials();

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
            // Immediate placement with both control points and geometry
            if (options.GEOM && this.tempGraphic) {
                try {
                    this.tempGraphic.geometry = new Polyline({
                        paths: options.GEOM,
                        spatialReference: this.view.spatialReference
                    });
                } catch (error) {
                    console.error(this.symName, "Failed to create Polyline geometry:", error);
                }
            }
            
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._drawType, this._teethGap);
            if (this.tempGraphic && this.tempGraphic.geometry) {
                this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEss);
            }
            this._clear();

        } else if (options.hasOwnProperty("CTRL_PTS")) {
            // Immediate placement with control points only
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._drawType, this._teethGap);
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
    private createDrawEssentials(ctrlPts: Point[], drawType: number, teethGap: number): DrawEssentials {
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
        (drawEssentials as any).TEETH_GAP = teethGap;
        (drawEssentials as any).ISFHAND = 1;

        return drawEssentials;
    }

    /**
     * Create symbol geometry from DrawEssentials
     */
    private createSymbol(drawEssentials: DrawEssentials): Polyline | null {
        try {
            let pts: Point[];

            if ((drawEssentials as any).CTRL_PTS) {
                pts = (drawEssentials as any).CTRL_PTS;
            } else {
                throw new Error("controlPoints not found");
            }

            let result = new Polyline({ spatialReference: this.view.spatialReference });

            switch ((drawEssentials as any).DRAW_TYPE) {
                case 1:
                    result = this.createSymbolByLine(pts, drawEssentials, result);
                    break;
                case 2:
                    result = this.createSymbolByCurve(pts, drawEssentials, result);
                    break;
                default:
                    result = this.createSymbolByLine(pts, drawEssentials, result);
                    break;
            }

            // Add Arrow Head
            if (pts.length >= 2) {
                const arrowHeadPath = this.createArrowHead(pts);
                if (arrowHeadPath && arrowHeadPath.length > 0) {
                    result.addPath(arrowHeadPath);
                }
            }

            return result;
        } catch (e) {
            console.log(this.constructor.name + ' Cannot create Symbol due to invalid geometry');
            return null;
        }
    }

    /**
     * Create arrow head geometry
     */
    private createArrowHead(pts: Point[]): number[][] | null {
        if (pts.length < 2) return null;

        try {
            const lastPoint = pts[pts.length - 1];
            const secondLastPoint = pts[pts.length - 2];
            
            // Calculate arrow dimensions
            const lineLength = this.calculateDistance(pts[0], lastPoint);
            const arrowLength = (GeoTools as any).ArrowFlanksLen ? 
                (GeoTools as any).ArrowFlanksLen(lineLength, lineLength) : 
                lineLength * 0.1;
            const angle = GeoTools.angleInRadians ? 
                GeoTools.angleInRadians(secondLastPoint, lastPoint) : 
                this.calculateAngle(secondLastPoint, lastPoint);

            // Use Shapes utility to create arrow head
            if (Shapes && (Shapes as any).arrowHead) {
                return (Shapes as any).arrowHead(lastPoint, arrowLength, angle);
            } else {
                // Fallback arrow head creation
                return this.createSimpleArrowHead(lastPoint, secondLastPoint, arrowLength);
            }
        } catch (e) {
            console.log('Error creating arrow head:', e);
            return null;
        }
    }

    /**
     * Create simple arrow head as fallback
     */
    private createSimpleArrowHead(tip: Point, base: Point, arrowLength: number): number[][] {
        const angle = this.calculateAngle(base, tip);
        const arrowAngle = Math.PI / 6; // 30 degrees
        
        const leftX = tip.x - arrowLength * Math.cos(angle - arrowAngle);
        const leftY = tip.y - arrowLength * Math.sin(angle - arrowAngle);
        const rightX = tip.x - arrowLength * Math.cos(angle + arrowAngle);
        const rightY = tip.y - arrowLength * Math.sin(angle + arrowAngle);

        return [
            [leftX, leftY],
            [tip.x, tip.y],
            [rightX, rightY]
        ];
    }

    /**
     * Create dotted line symbol
     */
    private createSymbolByLine(pts: Point[], drawEssentials: DrawEssentials, result: Polyline): Polyline {
        const newResult = new Polyline({ spatialReference: this.view.spatialReference });
        
        const gapRatio = this.calculateDistance(pts[0], pts[pts.length - 1]) / this._teethGap;
        const dottedPaths = this.getDashPoints(pts, [gapRatio, gapRatio]);

        for (let i = 0; i < dottedPaths.length; i += 2) {
            const p1 = dottedPaths[i];
            const p2 = dottedPaths[i + 1];
            if (p1 && p2) {
                newResult.addPath([[p1.x, p1.y], [p2.x, p2.y]]);
            }
        }

        return newResult;
    }

    /**
     * Create curved dotted line symbol
     */
    private createSymbolByCurve(pts: Point[], drawEssentials: DrawEssentials, result: Polyline): Polyline {
        var firstPoint = pts[0];
        var lastPoint = pts[pts.length - 1];
        var res = [];
        var paths = [];
        var dottedPaths = [];
        var p1, p2;
        var gapRatio;
        var cLenLimit;
        var baseLineLen;

        var result = new Polyline({"spatialReference": this.view.spatialReference});
        if (pts.length === 2) {
            result.addPath([lastPoint, firstPoint]);

        } else if (pts.length > 2) {

            var tempArray = [];
            Array.forEach(pts, function (e) {
                tempArray.push({ x: e.x, y: e.y });
            });

            res = this.CreateBezierPath(tempArray, 100);


            gapRatio = GeoTools._2PtLen(res[0], res[res.length - 1]);

            gapRatio = gapRatio / this._teethGap;

            baseLineLen = GeoTools._2PtLen(res[0], res[res.length - 1]) / 7;
            cLenLimit = baseLineLen / 7;
            if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;

            dottedPaths = GeoTools.getDashPts(res, [gapRatio, gapRatio]);

            for (var i = 0; i < dottedPaths.length; i += 2) {
                p1 = dottedPaths[i];
                if (dottedPaths[i + 1] != undefined) {
                    p2 = dottedPaths[i + 1];
                }
                result.addPath([p1, p2]);


            }



        }

        return result;
    }

    /**
     * Create Bezier path from points (returns array of points instead of Polyline)
     */
    private CreateBezierPath(pointCollection: { x: number, y: number }[], numberOfPts: number): { x: number, y: number }[] {
        // Remove duplicate consecutive points
        const cleanPoints = this.removeDuplicatePoints(pointCollection);
        
        if (cleanPoints.length < 2) {
            return cleanPoints;
        }

        // Simplified Bezier curve implementation
        const path: { x: number, y: number }[] = [];
        const segments = Math.max(numberOfPts, cleanPoints.length * 10);

        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const point = this.calculateBezierPoint(cleanPoints, t);
            path.push(point);
        }

        return path;
    }

    /**
     * Get dash points along a path
     */
    private getDashPoints(points: Point[] | { x: number, y: number }[], dashPattern: number[]): { x: number, y: number }[] {
        const result: { x: number, y: number }[] = [];
        if (points.length < 2 || dashPattern.length === 0) return result;

        const totalLength = this.calculatePathLength(points);
        const patternLength = dashPattern.reduce((sum, len) => sum + len, 0);
        let currentDistance = 0;
        let patternIndex = 0;
        let isDash = true; // Start with dash
        
        while (currentDistance < totalLength) {
            const segmentLength = dashPattern[patternIndex % dashPattern.length];
            const endDistance = Math.min(currentDistance + segmentLength, totalLength);
            
            if (isDash) {
                const startPoint = this.getPointAtDistance(points, currentDistance);
                const endPoint = this.getPointAtDistance(points, endDistance);
                result.push(startPoint, endPoint);
            }
            
            currentDistance = endDistance;
            patternIndex++;
            isDash = !isDash; // Alternate between dash and gap
        }

        return result;
    }

    /**
     * Get point at specific distance along path
     */
    private getPointAtDistance(points: Point[] | { x: number, y: number }[], targetDistance: number): { x: number, y: number } {
        let currentDistance = 0;
        
        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];
            const segmentLength = this.calculateDistance(p1, p2);
            
            if (currentDistance + segmentLength >= targetDistance) {
                const ratio = (targetDistance - currentDistance) / segmentLength;
                return {
                    x: p1.x + (p2.x - p1.x) * ratio,
                    y: p1.y + (p2.y - p1.y) * ratio
                };
            }
            
            currentDistance += segmentLength;
        }
        
        // Return last point if distance exceeds path length
        const lastPoint = points[points.length - 1];
        return { x: lastPoint.x, y: lastPoint.y };
    }

    /**
     * Calculate total path length
     */
    private calculatePathLength(points: Point[] | { x: number, y: number }[]): number {
        let length = 0;
        for (let i = 0; i < points.length - 1; i++) {
            length += this.calculateDistance(points[i], points[i + 1]);
        }
        return length;
    }

    /**
     * Utility methods
     */
    private calculateDistance(pt1: Point | { x: number, y: number }, pt2: Point | { x: number, y: number }): number {
        const dx = pt2.x - pt1.x;
        const dy = pt2.y - pt1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    private calculateAngle(fromPt: Point, toPt: Point): number {
        const dx = toPt.x - fromPt.x;
        const dy = toPt.y - fromPt.y;
        return Math.atan2(dy, dx);
    }

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

    private calculateBezierPoint(points: { x: number, y: number }[], t: number): { x: number, y: number } {
        if (points.length === 1) return points[0];
        
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

        const drawEssentials = this.createDrawEssentials(this._points.slice(), this._drawType, this._teethGap);
        
        if (this.tempGraphic && this.tempGraphic.geometry) {
            this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEssentials);
        }
        
        this._clear();
        this._removeEvents();
    }

    /**
     * Handle draw end
     */
    private __drawEnd(drawGeometry: Polyline, drawEssentials: DrawEssentials): void {
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

    /**
     * Final draw end handler
     */
    private __onDrawEnd(geometry: Polyline, geoGeometry: Polyline, drawEssParam: DrawEssentials): void {
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
                symbolType: "FreehandDottedArrow",
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

export default FreehandDottedArrow; 