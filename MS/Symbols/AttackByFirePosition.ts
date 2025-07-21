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
import BaseLine from "../Support/BaseLine.ts";
import GeoTools from "../Support/GeoTools.ts";

export interface AttackByFirePositionOptions {
    CTRL_PTS?: Point[];
    BASE_LN_PTS?: { startPt: Point, endPt: Point };
    GEOM?: Polygon;
    BK_LN_DIST_RATIO?: number;
    BK_LN_ANGL_RATIO?: number;
    [key: string]: any;
}

/**
 * AttackByFirePosition class for drawing Attack By Fire Position symbols on MapView or SceneView
 * Supports both immediate placement and interactive drawing modes
 */
export class AttackByFirePosition {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;
    
    // Symbol properties
    private SID: string = "152000";
    private symName: string = "Attk by Fire Posn";
    private symGeometricType: string = "Area";
    private _lineSym: SimpleLineSymbol | SimpleFillSymbol | null = null;
    private _points: Point[] = [];
    private _baseLinePts: Point[] = [];
    private _geometryType: string | null = null;
    private amplifier: Amplifier;
    
    // Symbol parameters
    private backLineDist: number = 5;
    private backLineAngle: number = 5;
    
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
     * Initialize the attack by fire position drawing
     */
    public init(options: AttackByFirePositionOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void {
        this._lineSym = marker;
        
        // Set parameters from options
        this.backLineDist = GeoTools.setDefault(options, "BK_LN_DIST_RATIO", 5);
        this.backLineAngle = GeoTools.setDefault(options, "BK_LN_ANGL_RATIO", 5);

        const drawEssentials = new DrawEssentials();
        const baseLine = new BaseLine(this.view, this._lineSym as SimpleLineSymbol);

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("BASE_LN_PTS") && options.hasOwnProperty("GEOM")) {
            // Immediate placement with all parameters
            if (options.GEOM && this.tempGraphic) {
                this.tempGraphic.geometry = options.GEOM;
            }
            
            const drawEss = this.createDrawEssentials(
                options.CTRL_PTS!.slice(), 
                options.BASE_LN_PTS!, 
                this.backLineDist,
                this.backLineAngle
            );
            
            if (this.tempGraphic && this.tempGraphic.geometry) {
                this.__drawEnd(this.tempGraphic.geometry as Polygon, drawEss);
            }
            this._clear();

        } else if (options.hasOwnProperty("CTRL_PTS")) {
            // Immediate placement with control points
            if (options.hasOwnProperty("BASE_LN_PTS")) {
                const drawEss = this.createDrawEssentials(
                    options.CTRL_PTS!.slice(), 
                    options.BASE_LN_PTS!, 
                    this.backLineDist,
                    this.backLineAngle
                );
                
                const geometry = this.createSymbol(drawEss);
                if (geometry && this.tempGraphic) {
                    this.tempGraphic.geometry = geometry;
                    this.__drawEnd(geometry, drawEss);
                    this._clear();
                }
            } else {
                throw new Error("Control Points and Baseline or Distance is required to create symbol non-interactively");
            }

        } else {
            // Interactive drawing mode
            this.startBaseLineDrawing(baseLine);
        }
    }

    /**
     * Start interactive baseline drawing
     */
    private startBaseLineDrawing(baseLine: BaseLine): void {
        // Set up baseline event handlers
        baseLine.on("drawEnd", (evt: any) => {
            this.baseLineDrawEnd(evt);
        });
        
        baseLine.on("onBaseLineClick", (evt: any) => {
            this.baseLineClick(evt);
        });
        
        baseLine.on("onBaseLineProgress", (evt: any) => {
            this.baseLineDrawProgress(evt);
        });
        
        baseLine.init();
    }

    /**
     * Handle baseline draw end
     */
    private baseLineDrawEnd(evt: any): void {
        this.tempGraphic = new Graphic({
            geometry: evt.geometry,
            symbol: this._lineSym
        });
        this.symbolLayer.add(this.tempGraphic);
        
        this._baseLinePts = (evt.geometry as any)._baseLine || [];
        
        // Set up main drawing event handlers
        this.setupEventHandlers();
        
        this.emit("onBaseLineDrawEnd", { currentPts: (evt.geometry as any).controlPoints || [] });
    }

    /**
     * Handle baseline draw progress
     */
    private baseLineDrawProgress(evt: any): void {
        const localDrawEssentials: any = {};
        localDrawEssentials.CTRL_PTS = evt.currentGeometry;
        
        const pl = new Polyline({
            paths: [evt.currentGeometry],
            spatialReference: this.view.spatialReference
        });
        
        this.emit("onDrawProgress", {
            currentGeometry: pl,
            currentDrawEssentials: localDrawEssentials,
            currentMarker: evt.currentMarker,
            isBaseLine: true
        });
    }

    /**
     * Handle baseline click
     */
    private baseLineClick(evt: any): void {
        this.emit("onDrawClick", {
            currentPts: evt.currentGeometry,
            isBaseLine: true
        });
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

        // Mouse move handler
        this.mouseMoveHandler = this.view.on("pointer-move", (event) => {
            this._onMouseMoveHandler(event);
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
        this.emit("onDrawClick", { currentPts: this._points });

        // For single line mode, finish after first click
        if (this.isLine === true && this._points.length === 1) {
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
        if (!this.tempGraphic || this._points.length === 0) return;

        const mapPoint = this.view.toMap(inputEvent);
        if (!mapPoint) return;

        const candidatePoint = new Point({
            x: mapPoint.x,
            y: mapPoint.y,
            spatialReference: this.view.spatialReference
        });

        const currentPoints = this._points.concat([candidatePoint]);
        const drawEssentials = this.createDrawEssentials(
            currentPoints,
            { startPt: this._baseLinePts[0], endPt: this._baseLinePts[this._baseLinePts.length - 1] },
            this.backLineDist,
            this.backLineAngle
        );
        
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
    private createDrawEssentials(
        ctrlPts: Point[], 
        baseLinePts: { startPt: Point, endPt: Point },
        backLineDistRatio: number, 
        backLineAngleRatio: number
    ): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.AMPLIFIER = this.amplifier.toString();
        
        // Store additional properties
        (drawEssentials as any).SCOPE = this;
        (drawEssentials as any).CTRL_PTS = ctrlPts;
        (drawEssentials as any).BASE_LN_PTS = baseLinePts;
        (drawEssentials as any).BK_LN_DIST_RATIO = backLineDistRatio;
        (drawEssentials as any).BK_LN_ANGL_RATIO = backLineAngleRatio;

        return drawEssentials;
    }

    /**
     * Create symbol geometry from DrawEssentials
     */
    private createSymbol(drawEssentials: DrawEssentials): Polygon | null {
        try {
            let pts: Point[];
            let backLineDist: number;
            let backLineAngle: number;

            if ((drawEssentials as any).CTRL_PTS) {
                pts = (drawEssentials as any).CTRL_PTS;
            } else {
                throw new Error("controlPoints not found");
            }

            if ((drawEssentials as any).BK_LN_DIST_RATIO) {
                backLineDist = (drawEssentials as any).BK_LN_DIST_RATIO;
            } else {
                backLineDist = this.backLineDist;
            }

            if ((drawEssentials as any).BK_LN_ANGL_RATIO) {
                backLineAngle = (drawEssentials as any).BK_LN_ANGL_RATIO;
            } else {
                backLineAngle = this.backLineAngle;
            }

            const baseLinePts = (drawEssentials as any).BASE_LN_PTS;
            if (!baseLinePts || !baseLinePts.startPt || !baseLinePts.endPt) {
                throw new Error("baseline points not found");
            }

            // Create the attack by fire position geometry
            const result = new Polygon({ 
                spatialReference: this.view.spatialReference 
            });

            // Calculate the baseline length and angle
            const baseLineLength = GeoTools._2PtLen(baseLinePts.startPt, baseLinePts.endPt);
            const baseLineAngleRad = GeoTools.twoPtsAngle(baseLinePts.startPt, baseLinePts.endPt);
            
            // Calculate back line distance
            const backLineDistance = baseLineLength * backLineDist / 100;
            
            // Calculate back angle
            const backAngle = baseLineAngleRad + Math.PI;
            
            // Calculate back line points
            const backLeftPt = {
                x: baseLinePts.startPt.x + backLineDistance * Math.cos(backAngle + (backLineAngle * Math.PI / 180)),
                y: baseLinePts.startPt.y + backLineDistance * Math.sin(backAngle + (backLineAngle * Math.PI / 180))
            };
            
            const backRightPt = {
                x: baseLinePts.endPt.x + backLineDistance * Math.cos(backAngle - (backLineAngle * Math.PI / 180)),
                y: baseLinePts.endPt.y + backLineDistance * Math.sin(backAngle - (backLineAngle * Math.PI / 180))
            };

            // Create the main ring for the attack by fire position
            const ring: number[][] = [];
            
            // Add baseline points
            ring.push([baseLinePts.startPt.x, baseLinePts.startPt.y]);
            ring.push([baseLinePts.endPt.x, baseLinePts.endPt.y]);
            
            // Add back line points
            ring.push([backRightPt.x, backRightPt.y]);
            ring.push([backLeftPt.x, backLeftPt.y]);
            
            // Close the ring
            ring.push([baseLinePts.startPt.x, baseLinePts.startPt.y]);

            result.addRing(ring);

            return result;

        } catch (e) {
            console.log(this.constructor.name + ' Cannot create Symbol due to invalid geometry');
            return null;
        }
    }

    /**
     * Clean up drawing state and finalize
     */
    private cleanUp(): void {
        if (this._points.length === 0 && this._baseLinePts.length === 0) return;

        const drawEssentials = this.createDrawEssentials(
            this._points.slice(),
            { startPt: this._baseLinePts[0], endPt: this._baseLinePts[this._baseLinePts.length - 1] },
            this.backLineDist,
            this.backLineAngle
        );
        
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
        this._baseLinePts = [];
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
                symbolType: "AttackByFirePosition",
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

export default AttackByFirePosition; 