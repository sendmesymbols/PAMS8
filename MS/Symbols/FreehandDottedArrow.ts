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
import Utils from "../Support/Utils.ts";


import SymbolEvents from "../Support/SymbolEvents";
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

    // Dash properties
    private dashLength: number = 10; // Length of each dash in map units
    private gapLength: number = 5;  // Length of gap between dashes in map units


    // Drawing state
    private isDrawing: boolean = false;
    private tempGraphic: Graphic | null = null;
    
    // Event handlers
    private clickHandler: any = null;
    private doubleClickHandler: any = null;
    private mouseMoveHandler: any = null;
    
    // Event emitter
    private events: SymbolEvents;

    constructor(view: MapView | SceneView, isLine: boolean = false) {
        this.view = view;
        this.isLine = isLine;
        this.layerManager = GraphicsLayerManager.getInstance(view);
        this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.FORCE);
        this.amplifier = new Amplifier();
        this.events = new SymbolEvents(view, "FreehandDottedArrow");
        
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
     * Create dashed curved line symbol
     */
    private createDashedSymbolByCurve(pts: Point[], drawEssentials: DrawEssentials, result: Polyline): Polyline {
        if (pts.length < 2) {
            return result;
        }

        const teethGap = (drawEssentials as any).TEETH_GAP || this._teethGap;
        const dashArray = [teethGap, teethGap];

        if (pts.length === 2) {
            const dashedPoints = GeoTools.getDashPts(pts, dashArray);
            for (let i = 0; i < dashedPoints.length - 1; i += 2) {
                const p1 = dashedPoints[i];
                const p2 = dashedPoints[i + 1];
                if (p2) {
                    result.addPath([[p1.x, p1.y], [p2.x, p2.y]]);
                }
            }
        } else {
            const tempArray: { x: number, y: number }[] = pts.map(pt => ({ x: pt.x, y: pt.y }));
            const bezierPoints = Utils.createBezierPath(tempArray, 100, this.view.spatialReference, true) as Polyline;

            bezierPoints.paths.forEach(path => {
                const pathPoints = path.map(([x, y]) => new Point({ x, y, spatialReference: this.view.spatialReference }));
                const dashedPoints = GeoTools.getDashPts(pathPoints, dashArray);
                for (let i = 0; i < dashedPoints.length - 1; i += 2) {
                    const p1 = dashedPoints[i];
                    const p2 = dashedPoints[i + 1];
                    if (p2) {
                        result.addPath([[p1.x, p1.y], [p2.x, p2.y]]);
                    }
                }
            });
        }

        return result;
    }

    /**
     * Create dashed straight line symbol
     */
    private createDashedSymbolByLine(pts: Point[], drawEssentials: DrawEssentials, result: Polyline): Polyline {
        if (pts.length < 2) {
            return result;
        }

        const teethGap = (drawEssentials as any).TEETH_GAP || this._teethGap;
        const dashArray = [teethGap, teethGap];
        const dashedPoints = GeoTools.getDashPts(pts, dashArray);

        for (let i = 0; i < dashedPoints.length - 1; i += 2) {
            const p1 = dashedPoints[i];
            const p2 = dashedPoints[i + 1];
            if (p2) {
                result.addPath([[p1.x, p1.y], [p2.x, p2.y]]);
            }
        }

        return result;
    }

    /**
     * Create dashed segments between two points
     */
    private createDashedSegment(startPt: Point, endPt: Point): number[][][] {
        const paths: number[][][] = [];

        // Calculate total segment length
        const totalLength = this.calculateDistance(startPt, endPt);
        const dashGapLength = this.dashLength + this.gapLength;
        const numDashes = Math.floor(totalLength / dashGapLength);

        if (numDashes === 0) {
            // If segment is too short, return a single dash
            return [[[startPt.x, startPt.y], [endPt.x, endPt.y]]];
        }

        // Calculate direction vector
        const dx = endPt.x - startPt.x;
        const dy = endPt.y - startPt.y;
        const segmentLength = Math.sqrt(dx * dx + dy * dy);
        const unitX = dx / segmentLength;
        const unitY = dy / segmentLength;

        // Generate dash segments
        for (let i = 0; i < numDashes; i++) {
            const startT = i * dashGapLength;
            const endT = Math.min(startT + this.dashLength, segmentLength);

            const startX = startPt.x + unitX * startT;
            const startY = startPt.y + unitY * startT;
            const endX = startPt.x + unitX * endT;
            const endY = startPt.y + unitY * endT;

            paths.push([[startX, startY], [endX, endY]]);
        }

        // Add partial dash if there's remaining length
        const lastDashEnd = numDashes * dashGapLength;
        if (lastDashEnd < segmentLength) {
            const startX = startPt.x + unitX * lastDashEnd;
            const startY = startPt.y + unitY * lastDashEnd;
            paths.push([[startX, startY], [endPt.x, endPt.y]]);
        }

        return paths;
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
        
        this.events.emit("onDrawClick", { currentPts: this._points });

        // For single line mode, finish after first click
        if (this.isLine === true && this._points.length === 1) {
            this.events.emit("onDrawClick", { currentPts: this._points });
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
            this.events.emit("onDrawProgress", {
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
     * Override createSymbol to create dashed line geometry
     */
    protected createSymbol(drawEssentials: DrawEssentials): Polyline | null {
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
                    result = this.createDashedSymbolByLine(pts, drawEssentials, result);
                    break;
                case 2:
                    result = this.createDashedSymbolByCurve(pts, drawEssentials, result);
                    break;
                default:
                    result = this.createDashedSymbolByLine(pts, drawEssentials, result);
                    break;
            }

            // Add Arrow Head (remains solid)
            if (pts.length >= 2) {
                const arrowHeadPath = this.createArrowHead(pts);
                if (arrowHeadPath && arrowHeadPath.length > 0) {
                    result.addPath(arrowHeadPath);
                }
            }

            return result;
        } catch (e) {
            console.error(this.constructor.name + ' Cannot create Symbol due to invalid geometry');
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

            pts.forEach((pt:Point) => {
                tempArray.push({ x: pt.x, y: pt.y });
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
        // Collect path points as Point instances
        const path: Point[] = [];

        for (let i = 0; i <= numberOfPts; i++) {
            tween.time(i);
            const pt = new Point({
                x: position.x,
                y: position.y,
                spatialReference: this.view.spatialReference
            });
            path.push(pt);
        }

        var result = new Polyline({"spatialReference": this.view.spatialReference});
        result.addPath(path);
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
        this.events.emit("onDrawEnd", {
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

    public on(eventName: string, callback: (data: any) => void): void {
        this.events.on(eventName, callback);
    }

    public off(eventName: string, callback?: (data: any) => void): void {
        this.events.off(eventName, callback);
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