import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Color from "@arcgis/core/Color";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";
import BaseLine from "../Support/BaseLine.ts";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";

export interface BoundaryOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polyline;
    ECHELON?: number;
    [key: string]: any;
}

/**
 * Boundary class for drawing Boundary/Bdry line symbols
 * Creates fracture lines with echelon markers along the boundary
 * Uses black color explicitly and supports echelon levels
 */
export class Boundary {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;
    
    // Symbol properties
    private SID: string = "110100";
    private symName: string = "Boundary / Bdry";
    private symGeometricType: string = "Line";
    private _lineSym: SimpleLineSymbol | null = null;
    private _points: Point[] = [];
    private _geometryType: string | null = null;
    private _echelon: number = 0;
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
     * Initialize the boundary drawing
     */
    public init(options: BoundaryOptions, marker: SimpleLineSymbol): void {
        this._lineSym = marker.clone();
        
        // Set color to black explicitly
        const blackColor = new Color('#000000');
        this._lineSym.color = blackColor;

        this._echelon = options.ECHELON || 0;
        
        // Set up event handlers
        this.setupEventHandlers();

        const drawEssentials = new DrawEssentials();

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
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
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.ECHELON || 0);
            if (this.tempGraphic && this.tempGraphic.geometry) {
                this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEss);
            }
            this._clear();

        } else if (options.hasOwnProperty("CTRL_PTS")) {
            // Immediate placement with control points only
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.ECHELON || 0);
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
        (drawEssentials as any).ECHELON = this._echelon;

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
    private createDrawEssentials(ctrlPts: Point[], echelon: number): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.GEOM = null;
        drawEssentials.AMPLIFIER = this.amplifier.toString();
        
        // Store additional properties
        (drawEssentials as any).SCOPE = this;
        (drawEssentials as any).CTRL_PTS = ctrlPts;
        (drawEssentials as any).ECHELON = echelon;

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
            const firstPoint = pts[0];
            const lastPoint = pts[pts.length - 1];

            // Create fracture with midpoints for echelon markers
            const values = this.fracture(pts, 20);
            if (!values || !values.geometry) {
                return null;
            }

            // Add fracture paths to result
            if (values.geometry.paths) {
                result.paths = result.paths.concat(values.geometry.paths);
            }

            // Write echelon markers at fracture midpoints
            if (values.midPoints && Array.isArray(values.midPoints)) {
                for (let i = 0; i < values.midPoints.length; i++) {
                    const midPointInfo = values.midPoints[i];
                    
                    if (i < pts.length && midPointInfo.midPt) {
                        const angle = this.angleInRadians(pts[i], midPointInfo.midPt);
                        let length = this.calculateDistance(pts[i], midPointInfo.midPt) / 10;
                        
                        // Calculate length limits
                        const baseLineLen = this.calculateDistance(pts[i], midPointInfo.midPt) / 6;
                        let cLenLimit = baseLineLen / 6;
                        if (cLenLimit > baseLineLen / 4) {
                            cLenLimit = baseLineLen / 4;
                        }

                        // Create echelon markers
                        const echelons = this.createEchelon(
                            (drawEssentials as any).ECHELON, 
                            midPointInfo.midPt, 
                            cLenLimit, 
                            angle
                        );
                        
                        if (echelons && Array.isArray(echelons)) {
                            for (let j = 0; j <= echelons.length - 1; j++) {
                                if (echelons[j] && Array.isArray(echelons[j])) {
                                    values.geometry.addPath(echelons[j]);
                                }
                            }
                        }
                    }
                }
            }

            return values.geometry;
            
        } catch (e) {
            console.log(this.constructor.name + ' Cannot create Symbol due to invalid geometry');
            return null;
        }
    }

    /**
     * Create fracture lines
     */
    private fracture(pts: Point[], segments: number): any {
        try {
            if (GeoTools && (GeoTools as any)._fracture) {
                return (GeoTools as any)._fracture(pts, segments, this.view.spatialReference);
            }

            // Fallback fracture implementation
            const result = new Polyline({ spatialReference: this.view.spatialReference });
            const midPoints: any[] = [];

            for (let i = 0; i < pts.length - 1; i++) {
                const start = pts[i];
                const end = pts[i + 1];
                const path: number[][] = [];

                for (let j = 0; j <= segments; j++) {
                    const t = j / segments;
                    const x = start.x + t * (end.x - start.x);
                    const y = start.y + t * (end.y - start.y);
                    path.push([x, y]);
                }

                result.addPath(path);
                
                // Add midpoint info
                const midPt = new Point({
                    x: (start.x + end.x) / 2,
                    y: (start.y + end.y) / 2,
                    spatialReference: this.view.spatialReference
                });
                
                midPoints.push({
                    midPt: midPt,
                    len: this.calculateDistance(start, end)
                });
            }

            return {
                geometry: result,
                midPoints: midPoints
            };
        } catch (e) {
            console.log(e);
            console.log('Error creating fracture:', e);
            return null;
        }
    }

    /**
     * Create echelon markers
     */
    private createEchelon(echelon: number, midPt: Point, cLenLimit: number, angle: number): any[] | null {
        try {
            if (Shapes && (Shapes as any).createEchelon) {
                return (Shapes as any).createEchelon(echelon, midPt, cLenLimit, angle);
            }

            // Fallback echelon creation
            const echelons: number[][][] = [];
            
            // Create simple echelon markers based on level
            for (let i = 0; i < Math.max(1, echelon); i++) {
                const offsetY = i * cLenLimit * 0.3;
                const startX = midPt.x - cLenLimit * Math.cos(angle + Math.PI/2);
                const startY = midPt.y - cLenLimit * Math.sin(angle + Math.PI/2) + offsetY;
                const endX = midPt.x + cLenLimit * Math.cos(angle + Math.PI/2);
                const endY = midPt.y + cLenLimit * Math.sin(angle + Math.PI/2) + offsetY;
                
                echelons.push([[startX, startY], [endX, endY]]);
            }

            return echelons;
        } catch (e) {
            console.log('Error creating echelon:', e);
            return null;
        }
    }

    /**
     * Calculate angle in radians between two points
     */
    private angleInRadians(pt1: Point, pt2: Point): number {
        return Math.atan2(pt2.y - pt1.y, pt2.x - pt1.x);
    }

    /**
     * Calculate distance between two points
     */
    private calculateDistance(pt1: any, pt2: any): number {
        const dx = pt2.x - pt1.x;
        const dy = pt2.y - pt1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Clean up drawing state and finalize
     */
    private cleanUp(): void {
        if (this._points.length === 0) return;

        const drawEssentials = this.createDrawEssentials(this._points.slice(), this._echelon);
        
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
                symbolType: "Boundary",
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

export default Boundary; 