import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
// import Polygon from "@arcgis/core/geometry/Polygon";
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
import DrawSeam from "../Support/DrawSeam";

import SymbolEvents from "../Support/SymbolEvents";
export interface BattlePositionOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polyline;
    ECHELON?: number;
    DRAW_TYPE?: number;
    FACE_GAP?: number;
    [key: string]: any;
}

export interface ClosestPointResult {
    x: number;
    y: number;
    index: number;
    fTo: number;
    fFrom: number;
}

/**
 * BattlePosition class for drawing Battle Position symbols on MapView or SceneView
 * Supports both immediate placement and interactive drawing modes with multiple draw types
 */
export class BattlePosition {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;
    
    // Symbol properties
    private SID: string = "151200";
    private symName: string = "Battle Posn";
    private symGeometricType: string = "Area";
    private _lineSym: SimpleLineSymbol | SimpleFillSymbol | null = null;
    private _points: Point[] = [];
    private _geometryType: string | null = null;
    private amplifier: Amplifier;
    
    // Battle Position specific parameters
    private _echelon: number = 0;
    private _drawType: number = 1;
    private _face_gap: number = 0;
    private _FACE_GAP_CONTS: number = 5;
    private _FACE_GAP_CONTS_ELL: number = 2;
    
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
        this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.TACT);
        this.amplifier = new Amplifier();
        this.events = new SymbolEvents(view, "BattlePosition");
        
        // Initialize layers if not already done
        this.layerManager.initializeLayers();
        
        // Initialize temporary graphic
        this.tempGraphic = new Graphic();
    }

    /**
     * Initialize the battle position drawing
     */
    public init(options: BattlePositionOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void {
        this._lineSym = marker;
        
        // Set parameters from options
        this._echelon = options.ECHELON || 0;
        this._drawType = options.DRAW_TYPE || 1;
        this._face_gap = options.FACE_GAP || 0;

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
            
            const drawEss = this.createDrawEssentials(
                options.CTRL_PTS!.slice(), 
                options.ECHELON || 0,
                options.DRAW_TYPE || 1,
                options.FACE_GAP || 0
            );
            
            if (this.tempGraphic && this.tempGraphic.geometry) {
                this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEss);
            }
            this._clear();

        } else if (options.hasOwnProperty("CTRL_PTS")) {
            // Immediate placement with control points only
            const drawEss = this.createDrawEssentials(
                options.CTRL_PTS!.slice(), 
                options.ECHELON || 0,
                options.DRAW_TYPE || 1,
                options.FACE_GAP || 0
            );
            
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
        
        // Set up event handlers
        this.setupEventHandlers();
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
        const mapPoint = DrawSeam.resolvePoint(this.view, clickEvent);
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
            this.cleanUp();
        }
    }

    /**
     * Handle double click events
     */
    private _onDoubleClickHandler(clickEvent: any): void {
        const mapPoint = DrawSeam.resolvePoint(this.view, clickEvent);
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

        const mapPoint = DrawSeam.resolvePoint(this.view, inputEvent);
        if (!mapPoint) return;

        const candidatePoint = new Point({
            x: mapPoint.x,
            y: mapPoint.y,
            spatialReference: this.view.spatialReference
        });

        const drawEssentials = new DrawEssentials();
        (drawEssentials as any).CTRL_PTS = this._points.concat([candidatePoint]);
        (drawEssentials as any).ECHELON = this._echelon;
        (drawEssentials as any).DRAW_TYPE = this._drawType;
        (drawEssentials as any).FACE_GAP = this._face_gap;
        
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
    private createDrawEssentials(
        ctrlPts: Point[], 
        echelon: number, 
        drawType: number, 
        face_gap: number
    ): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.AMPLIFIER = this.amplifier.toString();
        
        // Store additional properties
        (drawEssentials as any).SCOPE = this;
        (drawEssentials as any).CTRL_PTS = ctrlPts;
        (drawEssentials as any).ECHELON = echelon;
        (drawEssentials as any).DRAW_TYPE = drawType;
        (drawEssentials as any).FACE_GAP = face_gap;

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

            const lastPoint = pts[pts.length - 1];
            const firstPoint = pts[0];
            let result = new Polyline({ spatialReference: this.view.spatialReference });

            const drawType = (drawEssentials as any).DRAW_TYPE || 1;

            switch (drawType) {
                case 1:
                    result = Shapes.createPolylineByLine(
                        pts,
                        firstPoint,
                        lastPoint,
                        drawEssentials,
                        this.view.spatialReference
                    );
                    break;
                case 2:
                    result = Shapes.createPolylineByCloseLine(
                        pts,
                        firstPoint,
                        lastPoint,
                        drawEssentials,
                        this.view.spatialReference,
                        this._FACE_GAP_CONTS
                    );
                    break;
                case 3:
                    result = Shapes.createPolylineByPerfectEllipse(
                        pts,
                        firstPoint,
                        lastPoint,
                        drawEssentials,
                        this.view.spatialReference,
                        this._FACE_GAP_CONTS_ELL
                    );
                    break;
                default:
                    result = Shapes.createPolylineByLine(
                        pts,
                        firstPoint,
                        lastPoint,
                        drawEssentials,
                        this.view.spatialReference
                    );
            }

            return result;

        } catch (e) {
            /* invalid geometry mid-draw is expected; ignore */
            return null;
        }
    }



    /**
     * Clean up drawing state and finalize
     */
    private cleanUp(): void {
        if (this._points.length === 0) return;

        const drawEss = this.createDrawEssentials(
            this._points.slice(),
            this._echelon,
            this._drawType,
            this._face_gap
        );
        
        if (this.tempGraphic && this.tempGraphic.geometry) {
            this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEss);
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

    /** Premium stylus seam: remove the last placed vertex (undo). Re-render is
     *  driven by the premium layer's next move. */
    public removeLastPoint(): boolean {
        if (!this._points || this._points.length === 0) return false;
        this._points.pop();
        if (this._points.length === 0 && this.tempGraphic) {
            this.tempGraphic.geometry = null;
        }
        return true;
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

export default BattlePosition; 