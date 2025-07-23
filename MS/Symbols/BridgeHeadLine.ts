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
import BaseLine from "../Support/BaseLine.ts";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";

export interface BridgeHeadLineOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polyline;
    DRAW_TYPE?: number;
    [key: string]: any;
}

/**
 * BridgeHeadLine class for drawing Bridgehead Line symbols
 * Supports multiple drawing types: Straight line (1), Curved line (2)
 * Includes "BL" markers at both ends of the line
 */
export class BridgeHeadLine {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;
    
    // Symbol properties
    private SID: string = "141400";
    private symName: string = "Bridgehead Line";
    private symGeometricType: string = "Line";
    private _lineSym: SimpleLineSymbol | null = null;
    private _points: Point[] = [];
    private _geometryType: string | null = null;
    private _drawType: number = 1;
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
     * Initialize the bridgehead line drawing
     */
    public init(options: BridgeHeadLineOptions, marker: SimpleLineSymbol): void {
        this._lineSym = marker.clone();
        this._drawType = (GeoTools as any).setDefault ? (GeoTools as any).setDefault(options, "DRAW_TYPE", this._drawType) : (options.DRAW_TYPE || this._drawType);
        
        // Set up event handlers
        this.setupEventHandlers();

        const drawEssentials = new DrawEssentials();

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
            // Immediate placement with both control points and geometry
            if (options.GEOM && this.tempGraphic) {
                this.tempGraphic.geometry = options.GEOM;
            }
            
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._drawType);
            if (this.tempGraphic && this.tempGraphic.geometry) {
                this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEss);
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

            const result = new Polyline({ spatialReference: this.view.spatialReference });
            const p1 = pts[0];
            const p2 = pts[pts.length - 1];
            const drawType = (drawEssentials as any).DRAW_TYPE || 1;

            switch (drawType) {
                case 1:
                    result.addPath([[p1.x, p1.y], [p2.x, p2.y]]);
                    break;
                case 2:
                    this.createSymbolByLine(pts, p1, p2, drawEssentials, result);
                    break;
            }

            // Add BL markers at both ends
            this.addBLMarkers(result, p1, p2);

            return result;
            
        } catch (e) {
            console.log(this.constructor.name + ' Cannot create Symbol due to invalid geometry');
            return null;
        }
    }

    /**
     * Create symbol using curved line
     */
    private createSymbolByLine(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials, result: Polyline): void {
        if (pts.length === 2) {
            result.addPath([[lastPoint.x, lastPoint.y], [firstPoint.x, firstPoint.y]]);
        } else if (pts.length > 2) {
            const tempArray = pts.map(e => ({ x: e.x, y: e.y }));
            const bezierResult = this.CreateBezierPath(tempArray, 100, this.view);
            if (bezierResult && bezierResult.paths && bezierResult.paths.length > 0) {
                bezierResult.paths.forEach(path => result.addPath(path));
            }
        }
    }

    /**
     * Create Bezier path (fallback without TweenMax)
     */
    private CreateBezierPath(pointCollection: any[], numberOfPts: number, view: MapView | SceneView): Polyline {
        const result = new Polyline({ spatialReference: view.spatialReference });
        
        if (pointCollection.length < 2) {
            return result;
        }

        // Remove duplicate points
        while (pointCollection.length > 1 && 
               pointCollection[pointCollection.length - 1].x === pointCollection[pointCollection.length - 2].x && 
               pointCollection[pointCollection.length - 1].y === pointCollection[pointCollection.length - 2].y) {
            pointCollection.pop();
        }

        const path: number[][] = [];
        
        if (pointCollection.length === 2) {
            for (let i = 0; i <= numberOfPts; i++) {
                const t = i / numberOfPts;
                const x = pointCollection[0].x + t * (pointCollection[1].x - pointCollection[0].x);
                const y = pointCollection[0].y + t * (pointCollection[1].y - pointCollection[0].y);
                path.push([x, y]);
            }
        } else {
            for (let i = 0; i <= numberOfPts; i++) {
                const t = i / numberOfPts;
                const segmentLength = 1 / (pointCollection.length - 1);
                const segmentIndex = Math.floor(t / segmentLength);
                const localT = (t - segmentIndex * segmentLength) / segmentLength;
                
                const startIdx = Math.min(segmentIndex, pointCollection.length - 2);
                const endIdx = startIdx + 1;
                
                const x = pointCollection[startIdx].x + localT * (pointCollection[endIdx].x - pointCollection[startIdx].x);
                const y = pointCollection[startIdx].y + localT * (pointCollection[endIdx].y - pointCollection[startIdx].y);
                path.push([x, y]);
            }
        }
        
        result.addPath(path);
        return result;
    }

    /**
     * Add "BL" markers at both ends of the line
     */
    private addBLMarkers(result: Polyline, p1: Point, p2: Point): void {
        try {
            const len = this.calculateDistance(p1, p2) / 20;
            const k = this.calculateAngle(p1, p2);
            
            // Add BL marker at start point
            const pt1 = {
                x: -1 * len * Math.cos(k) + p1.x,
                y: -1 * len * Math.sin(k) + p1.y
            };

            if (Shapes && (Shapes as any).createBL) {
                try {
                    const paths1 = (Shapes as any).createBL(pt1.x, pt1.y, len / 2, this.view.spatialReference);
                    if (paths1 && Array.isArray(paths1)) {
                        for (let i = 0; i < paths1.length; i++) {
                            if (paths1[i]) {
                                result.addPath(paths1[i]);
                            }
                        }
                    }
                } catch (e) {
                    console.log('Error creating BL marker at start point, using fallback');
                    this.createSimpleBL(result, pt1, len / 2);
                }
            } else {
                this.createSimpleBL(result, pt1, len / 2);
            }

            // Add BL marker at end point
            const pt2 = {
                x: len * Math.cos(k) + p2.x,
                y: len * Math.sin(k) + p2.y
            };

            if (Shapes && (Shapes as any).createBL) {
                try {
                    const paths2 = (Shapes as any).createBL(pt2.x + (len / 0.5), pt2.y, len / 2, this.view.spatialReference);
                    if (paths2 && Array.isArray(paths2)) {
                        for (let i = 0; i < paths2.length; i++) {
                            if (paths2[i]) {
                                result.addPath(paths2[i]);
                            }
                        }
                    }
                } catch (e) {
                    console.log('Error creating BL marker at end point, using fallback');
                    this.createSimpleBL(result, pt2, len / 2);
                }
            } else {
                this.createSimpleBL(result, pt2, len / 2);
            }

        } catch (e) {
            console.log('Error adding BL markers');
        }
    }

    /**
     * Create simple "BL" text as fallback
     */
    private createSimpleBL(result: Polyline, center: any, size: number): void {
        const letterHeight = size;
        const letterWidth = size * 0.5;
        const spacing = size * 0.1;

        // Create "B" shape
        const b_vertical = [[center.x - letterWidth - spacing, center.y - letterHeight/2], [center.x - letterWidth - spacing, center.y + letterHeight/2]];
        const b_top = [[center.x - letterWidth - spacing, center.y - letterHeight/2], [center.x - spacing, center.y - letterHeight/2]];
        const b_middle = [[center.x - letterWidth - spacing, center.y], [center.x - spacing, center.y]];
        const b_bottom = [[center.x - letterWidth - spacing, center.y + letterHeight/2], [center.x - spacing, center.y + letterHeight/2]];

        // Create "L" shape
        const l_vertical = [[center.x + spacing, center.y - letterHeight/2], [center.x + spacing, center.y + letterHeight/2]];
        const l_horizontal = [[center.x + spacing, center.y + letterHeight/2], [center.x + letterWidth + spacing, center.y + letterHeight/2]];

        // Add as separate paths
        result.addPath(b_vertical);
        result.addPath(b_top);
        result.addPath(b_middle);
        result.addPath(b_bottom);
        result.addPath(l_vertical);
        result.addPath(l_horizontal);
    }

    /**
     * Utility method to calculate distance
     */
    private calculateDistance(pt1: Point, pt2: Point): number {
        const dx = pt2.x - pt1.x;
        const dy = pt2.y - pt1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Utility method to calculate angle
     */
    private calculateAngle(pt1: Point, pt2: Point): number {
        return Math.atan2(pt2.y - pt1.y, pt2.x - pt1.x);
    }

    /**
     * Clean up drawing state and finalize
     */
    private cleanUp(): void {
        if (this._points.length === 0) return;

        const drawEssentials = this.createDrawEssentials(this._points.slice(), this._drawType);
        
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
        
        this.emitGlobalEvent(eventName, data);
    }

    private emitGlobalEvent(eventName: string, data: any): void {
        const customEvent = new CustomEvent(eventName, {
            detail: {
                symbolType: "BridgeHeadLine",
                eventName: eventName,
                ...data
            },
            bubbles: true,
            cancelable: true
        });

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

    public getSymbolLayer(): GraphicsLayer {
        return this.symbolLayer;
    }

    public clearSymbols(): void {
        this.symbolLayer.removeAll();
    }
}

export default BridgeHeadLine; 