import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import Color from "@arcgis/core/Color";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";


export interface CartoInformationModelSymbolOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    DRAW_TYPE?: number;
    opacity?: number;
    cim?: {
        style?: string;
        size?: number;
        color?: string;
        gridType?: "Fixed" | "Random";
        randomness?: number;
        stepX?: number;
        stepY?: number;
        shiftOddRows?: boolean;
    };
    [key: string]: any;
}

/**
 * FreehandAreaFilled class for drawing filled freehand area symbols on MapView or SceneView
 * Supports both immediate placement and interactive drawing modes with opacity control
 */
export class CartoInformationModelSymbol {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;
    
    // Symbol properties
    private SID: string = "000150";
    private symName: string = "Carto Symbol";
    private symGeometricType: string = "Area";
    private _lineSym: any | null = null;
    private _cimOptions?: any;
    private _points: Point[] = [];
    private _drawType: number = 1;
    private _geometryType: string | null = null;
    private _opacity: number = 0.50;
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
     * Initialize the freehand area filled drawing
     */
    public init(options: CartoInformationModelSymbolOptions, marker: SimpleLineSymbol): void {
        // Set opacity
        this._opacity = 0.50;
        if (options.hasOwnProperty('opacity')) {
            this._opacity = options.opacity!;
        }

        if (options.cim) {
            this._cimOptions = options.cim;
        } else if ((options as any).SCOPE && (options as any).SCOPE.cim) {
            this._cimOptions = (options as any).SCOPE.cim;
        } else {
            this._cimOptions = {
                style: "Mountains", // Default WebStyle name
                size: 30,
                gridType: "Random",
                randomness: 100,
                stepX: 30,
                stepY: 30,
                shiftOddRows: false
            };
        }

        // Create filled symbol from line marker
        const fillColor = new Color([marker.color.r, marker.color.g, marker.color.b, this._opacity]);
        //const fillColor = new Color(marker.color);

        this._lineSym = new SimpleFillSymbol({
            style: "solid",
            color: fillColor,
            outline: new SimpleLineSymbol({
                style: marker.style,
                color: marker.color,
                width: marker.width,
            })
        });

        const setupCIMSymbol = async () => {
            if (this._cimOptions && this._cimOptions.style) {
                try {
                    const CIMSymbol = (await import("@arcgis/core/symbols/CIMSymbol")).default;
                    const cimSymbolUtils = await import("@arcgis/core/symbols/support/cimSymbolUtils");
                    
                    const cimJsonModule = await import(`../Data/CIMFills/${this._cimOptions.style}.json`);
                    // Deep clone to avoid mutating the cached module
                    const cimJson = JSON.parse(JSON.stringify(cimJsonModule.default || cimJsonModule));
                    
                    cimJson.symbolLayers.forEach((symLayer: any, index: number) => {
                        if (symLayer.markerPlacement) {
                            let mp = symLayer.markerPlacement;
                            if (this._cimOptions.gridType) mp.gridType = this._cimOptions.gridType;
                            if (this._cimOptions.randomness !== undefined) mp.randomness = this._cimOptions.randomness;
                            if (this._cimOptions.stepX !== undefined) mp.stepX = this._cimOptions.stepX;
                            if (this._cimOptions.stepY !== undefined) mp.stepY = this._cimOptions.stepY;
                            if (this._cimOptions.shiftOddRows !== undefined) mp.shiftOddRows = this._cimOptions.shiftOddRows;
                            cimJson.symbolLayers[index].markerPlacement = mp;
                        }
                    });

                    // Add background fill and outline so the polygon isn't hollow
                    const r = marker.color.r;
                    const g = marker.color.g;
                    const b = marker.color.b;
                    const a = Math.round(this._opacity * 255);
                    
                    // Note: symbolLayers draws from last to first. By pushing these at the end, 
                    // they will draw underneath the vector markers.
                    cimJson.symbolLayers.push({
                        type: "CIMSolidStroke",
                        enable: true,
                        colorLocked: true, // Prevent applyCIMSymbolColor from overwriting this
                        capStyle: "Round",
                        joinStyle: "Round",
                        width: marker.width || 2,
                        color: [r, g, b, 255]
                    });

                    cimJson.symbolLayers.push({
                        type: "CIMSolidFill",
                        enable: true,
                        colorLocked: true, // Prevent applyCIMSymbolColor from overwriting this
                        color: [r, g, b, a]
                    });

                    const symbol: any = new CIMSymbol({
                        data: {
                            type: "CIMSymbolReference",
                            symbol: cimJson
                        }
                    });
                    
                    if (this._cimOptions.size) cimSymbolUtils.scaleCIMSymbolTo(symbol, this._cimOptions.size);
                    if (this._cimOptions.color) cimSymbolUtils.applyCIMSymbolColor(symbol, new Color(this._cimOptions.color));
                    
                    this._lineSym = symbol;
                    if (this.tempGraphic) {
                        this.tempGraphic.symbol = this._lineSym;
                    }
                } catch (e) {
                    console.error("Failed to load CIM symbol:", e);
                }
            }
        };

        setupCIMSymbol();
        
        // Set up event handlers
        this.setupEventHandlers();

        const drawEssentials = new DrawEssentials();
        this._drawType = GeoTools.setDefault(options, "DRAW_TYPE", this._drawType);

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
            // Immediate placement with both control points and geometry
            if (options.GEOM && this.tempGraphic) {
                try {
                    this.tempGraphic.geometry = new Polygon({
                        rings: options.GEOM,
                        spatialReference: this.view.spatialReference
                    });
                } catch (error) {
                    console.error(this.symName, "Failed to create Polygon geometry:", error);
                }
            }
            
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._drawType, this._opacity);
            if (this.tempGraphic && this.tempGraphic.geometry) {
                this.__drawEnd(this.tempGraphic.geometry as Polygon, drawEss);
            }
            this._clear();

        } else if (options.hasOwnProperty("CTRL_PTS")) {
            // Immediate placement with control points only
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._drawType, this._opacity);
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
    private createDrawEssentials(ctrlPts: Point[], drawType: number, opacity: number): DrawEssentials {
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
        (drawEssentials as any).opacity = opacity;

        if (this._cimOptions) {
            drawEssentials.cim = this._cimOptions;
        }

        return drawEssentials;
    }

    /**
     * Create symbol geometry from DrawEssentials
     */
    private createSymbol(drawEssentials: DrawEssentials): Polygon | Polyline | null {
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
                    return Shapes.createSymbolByBCurve(pts, firstPoint, lastPoint, drawEssentials, this.view.spatialReference);
                case 2:
                    return Shapes.createSymbolByPolygon(pts, firstPoint, lastPoint, drawEssentials, this.view.spatialReference);
                case 3:
                    return Shapes.createSymbolByRect(pts, firstPoint, lastPoint, drawEssentials, this.view.spatialReference);
                case 4:
                    return Shapes.createSymbolByPerfectEllipse(pts, firstPoint, lastPoint, drawEssentials, this.view);
                default:
                    return new Polygon({ spatialReference: this.view.spatialReference });
            }

        } catch (e) {
            console.log(this.constructor.name + ' Cannot create Symbol due to invalid geometry');
            return null;
        }
    }


    /**
     * Clean up drawing state and finalize
     */
    private cleanUp(): void {
        if (this._points.length === 0) return;

        const drawEssentials = this.createDrawEssentials(this._points.slice(), this._drawType, this._opacity);
        
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
                symbolType: "FreehandAreaFilled",
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

export default CartoInformationModelSymbol;