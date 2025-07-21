import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Color from "@arcgis/core/Color";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";

// Import tactical point symbols data
import TacticalPointSymbolsData from "../Data/TacticalPointSymbols.json";

export interface TacticalPointTextOptions {
    GEOM?: Point;
    SIZE?: number;
    ANGLE?: number;
    opacity?: number;
    [key: string]: any;
}

/**
 * TacticalPointText class for drawing tactical point text symbols on MapView or SceneView
 * Supports both immediate placement (with GEOM) and interactive drawing (without GEOM)
 */
export class TacticalPointText {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    
    // Symbol properties
    private SIC: string = "000110";
    private symName: string = "TacticalPointText";
    private symGeometricType: string = "Point";
    private _ptSymbol: SimpleMarkerSymbol | null = null;
    private _point: Point | null = null;
    private _path: string = "";
    private _offset: string = "0";
    private _opacity: number = 1;
    private tactPtSymData: any;
    private amplifier: Amplifier;

    // Drawing state
    private isDrawing: boolean = false;
    private tempGraphic: Graphic | null = null;
    
    // Event handlers
    private mouseMoveHandler: any = null;
    private clickHandler: any = null;
    
    // Event emitter
    private eventListeners: Map<string, Function[]> = new Map();

    constructor(view: MapView | SceneView) {
        this.view = view;
        this.layerManager = GraphicsLayerManager.getInstance(view);
        this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.FORCE);
        this.amplifier = new Amplifier();
        this.tactPtSymData = TacticalPointSymbolsData;
        
        // Initialize layers if not already done
        this.layerManager.initializeLayers();
        
        // Set up event handlers once in constructor
        this.setupEventHandlers();
    }

    /**
     * Initialize the symbol with options
     */
    public init(options: TacticalPointTextOptions, marker: SimpleMarkerSymbol, sic: string, symName: string, offset: string, sidc: string): void {
        this._opacity = options.opacity !== undefined ? options.opacity : 1;
        
        // Get symbol path from tactical point symbols data
        const symbolKey = sidc.substr(4, 2) + sic;
        this._path = this.tactPtSymData[symbolKey];
        this._offset = offset;

        if (!this._path || this._path.length === 0) {
            throw new Error("Symbol definition not found");
        }

        // Update symbol properties
        this.SIC = sic;
        this.symName = symName;
        this._ptSymbol = marker.clone();

        // Configure the marker symbol
        this.configureMarkerSymbol(options, marker);

        // Handle immediate placement or interactive drawing
        if (options.GEOM) {
            this._point = options.GEOM;
            const drawEssentials = this.createDrawEssentials(
                options.GEOM.clone(),
                options.SIZE || marker.size,
                options.ANGLE || marker.angle,
                this._opacity
            );
            this.drawEnd(options.GEOM, this._ptSymbol, drawEssentials);
            this.cleanUp();
        } else {
            this.startInteractiveDrawing();
        }
    }

    /**
     * Configure the marker symbol with the specified options
     */
    private configureMarkerSymbol(options: TacticalPointTextOptions, marker: SimpleMarkerSymbol): void {
        if (!this._ptSymbol) return;

        // Set symbol path and style
        this._ptSymbol.path = this._path;
        this._ptSymbol.style = "path";

        // Set size
        if (options.SIZE !== undefined && options.SIZE !== 0) {
            this._ptSymbol.size = options.SIZE;
        } else {
            this._ptSymbol.size = marker.size;
        }

        // Set angle
        if (options.ANGLE !== undefined) {
            this._ptSymbol.angle = options.ANGLE;
        } else {
            this._ptSymbol.angle = marker.angle;
        }

        // Set opacity
        if (options.opacity !== undefined) {
            const color = this._ptSymbol.color as Color;
            this._ptSymbol.color = new Color([color.r, color.g, color.b, options.opacity]);
        }

        // Handle offset (Center Bottom)
        if (this._offset === "1") {
            this._ptSymbol.xoffset = 0;
            this._ptSymbol.yoffset = this._ptSymbol.size / 2;
        }
    }

    /**
     * Start interactive drawing mode
     */
    private startInteractiveDrawing(): void {
        if (!this._ptSymbol) return;

        this.isDrawing = true;

        // Create temporary graphic at map center
        const center = this.view.center;
        if (center) {
            this.tempGraphic = new Graphic({
                geometry: center,
                symbol: this._ptSymbol,
            });
            this.symbolLayer.add(this.tempGraphic);
        }
    }

    /**
     * Set up mouse event handlers for interactive drawing (called once in constructor)
     */
    private setupEventHandlers(): void {
        // Mouse move handler
        this.mouseMoveHandler = this.view.on("pointer-move", (event) => {
            if (!this.isDrawing || !this.tempGraphic) return;
            
            const mapPoint = this.view.toMap(event);
            
            if (mapPoint) {
                this.tempGraphic.geometry = mapPoint;
                this.emit("onDrawProgress", {
                    currentGeometry: mapPoint,
                    currentDrawEssentials: null,
                    currentMarker: null
                });
            }
        });

        // Click handler
        this.clickHandler = this.view.on("click", (event) => {
            if (!this.isDrawing) return;
            
            const mapPoint = this.view.toMap(event);
            
            if (mapPoint) {
                this._point = mapPoint;
                this.finishDrawing();
            }
        });
    }

    /**
     * Finish the drawing process
     */
    private finishDrawing(): void {
        if (!this._point || !this._ptSymbol) return;

        const drawEssentials = this.createDrawEssentials(
            this._point.clone(),
            this._ptSymbol.size,
            this._ptSymbol.angle,
            this._opacity
        );

        // Configure final symbol appearance
        this._ptSymbol.color = new Color([255, 255, 255, this._opacity]);

        this.drawEnd(this._point, this._ptSymbol, drawEssentials);
        this.cleanUp();
        this.removeEventHandlers();
    }

    /**
     * Create DrawEssentials for the symbol
     */
    private createDrawEssentials(geom: Point, size: number, angle: number, opacity: number): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SIC;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.GEOM = geom;
        drawEssentials.AMPLIFIER = this.amplifier.toString();
        // Note: SIZE, ANGLE, OFFSET properties don't exist in DrawEssentials, storing in extra properties
        (drawEssentials as any).SIZE = size;
        (drawEssentials as any).ANGLE = angle;
        (drawEssentials as any).OFFSET = this._offset;
        (drawEssentials as any).ISFHAND = 1;
        (drawEssentials as any).opacity = opacity;
        
        return drawEssentials;
    }

    /**
     * Handle the end of drawing
     */
    private drawEnd(geometry: Point, symbol: SimpleMarkerSymbol, drawEssentials: DrawEssentials): void {
        if (!geometry) return;

        // Convert to geographic if needed
        let geographicGeometry = geometry;
        const spatialRef = this.view.spatialReference;
        
        if (spatialRef.isWebMercator) {
            // Convert from Web Mercator to Geographic if needed
            // This would require additional conversion logic
        }

        this.onDrawEnd(geometry, symbol, drawEssentials);
    }

    /**
     * Handle the end of drawing with geographic conversion
     */
    private onDrawEnd(geometry: Point, symbol: SimpleMarkerSymbol, drawEssentials: DrawEssentials): void {
        this.emit("onDrawEnd", {
            geometry: geometry,
            marker: symbol,
            drawEssentials: drawEssentials
        });
    }

    /**
     * Clean up drawing state
     */
    private cleanUp(): void {
        this.isDrawing = false;
        
        // Remove temporary graphic
        if (this.tempGraphic) {
            this.symbolLayer.remove(this.tempGraphic);
            this.tempGraphic = null;
        }
        
        // Clear point reference
        this._point = null;
    }

    /**
     * Remove event handlers (only call when deactivating the entire symbol)
     */
    private removeEventHandlers(): void {
        if (this.mouseMoveHandler) {
            this.mouseMoveHandler.remove();
            this.mouseMoveHandler = null;
        }
        
        if (this.clickHandler) {
            this.clickHandler.remove();
            this.clickHandler = null;
        }
    }

    /**
     * Deactivate the symbol drawing
     */
    public deactivate(): void {
        this.cleanUp();
        this.removeEventHandlers();
        this._ptSymbol = null;
    }

    /**
     * Event emitter methods
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
                symbolType: "TacticalPointText",
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

export default TacticalPointText; 