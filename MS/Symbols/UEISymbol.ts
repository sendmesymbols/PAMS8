
import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import PictureMarkerSymbol from "@arcgis/core/symbols/PictureMarkerSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";
import { enrichSymbolOptions } from "../SIDC/SIDC";
import '../ThirdParty/MilSymbols/milsymbol.d.ts';

// Import the milsymbol library for symbol generation
declare const ms: any;

export interface UEISymbolOptions {
    SIDC?: string;
    GEOM?: Point;
    ANGLE?: number;
    SIZE?: number;
    AMPLIFIER?: Amplifier;
    [key: string]: any;
}

export interface SymbolData {
    asImage: () => string;
    height: number;
    width: number;
}

/**
 * UEISymbol class for drawing military symbols on MapView or SceneView
 * Supports both immediate placement (with GEOM) and interactive drawing (without GEOM)
 */
export class UEISymbol {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    
    // Symbol properties
    private SIC: string = "000000";
    private symName: string = "UEISymbol";
    private symGeometricType: string = "FPoint";
    private _ueiData : any = null;
    private _height:any = null;
    private _width:any = null;
    private _ptSymbol:any = null;
    private _options: any = null;

    // Drawing state
    private isDrawing: boolean = false;
    private tempGraphic: Graphic | null = null;
    private symbolData: SymbolData | null = null;
    private pointSymbol: PictureMarkerSymbol | null = null;
    private amplifier: Amplifier;
    
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
        
        // Initialize layers if not already done
        this.layerManager.initializeLayers();
        
        // Set up event handlers once in constructor
        this.setupEventHandlers();
    }

    /**
     * Initialize the symbol with options
     */
    public init(options: any, marker?: any, sic?: string, symName?: string, offset?: string, sidc?: string): void {
        // Update symbol properties
        if (sic) this.SIC = sic;
        if (symName) this.symName = symName;

        this._options = options;
        
        // Create symbol data using milsymbol library
        //this.createSymbolData(options, sidc);
        const opts = options.OPTIONS || options;
        const milsymbolOptions = {
            size: Number(options.extraSettings?.size) || 35,
            uniqueDesignation: opts.uniqueDesignation || "",
            quantity: opts.quantity || '',
            reinforcedReduced: opts.reinforcedReduced || '',
            staffComments: opts.staffComments || '',
            additionalInformation: opts.additionalInformation || '',
            evaluationRating: opts.evaluationRating || '',
            combatEffectiveness: opts.combatEffectiveness || '',
            signatureEquipment: opts.signatureEquipment || '',
            higherFormation: opts.higherFormation || '',
            hostile: opts.hostile || '',
            iffSif: opts.iffSif || '',
            direction: opts.direction || '',
            sigint: opts.sigint || '',
            type: opts.type || '',
            dtg: opts.dtg || '',
            altitudeDepth: opts.altitudeDepth || '',
            location: opts.location || '',
            speed: opts.speed || '',
            specialHeadquarters: opts.specialHeadquarters || '',
            platformType: opts.platformType || '',
            equipmentTeardownTime: opts.equipmentTeardownTime || '',
            commonIdentifier: opts.commonIdentifier || '',
            auxiliaryEquipmentIndicator: opts.auxiliaryEquipmentIndicator || ''
        };

        this._ueiData = new (window as any).MS.symbol(sidc, milsymbolOptions).getMarker();

        //this._ueiData = new window.MS.symbol(sidc,options).getMarker();

        this._height = this._ueiData.height || 35;
        this._width = this._ueiData.width || 35;

        const canvas = this._ueiData.asCanvas();

        // Convert SVG to data URL
        const dataUrl = canvas.toDataURL();


        const anchor = this._ueiData.markerAnchor || { x: this._width / 2, y: this._height / 2 };
        const xoffset = (this._width / 2) - anchor.x;
        const yoffset = (this._height / 2) - anchor.y;

        this._ptSymbol =  new PictureMarkerSymbol({
            url: dataUrl,
            width: this._width + "px",
            height: this._height + "px",
            xoffset,
            yoffset
        });



        //this._ptSymbol = new PictureMarkerSymbol({url: dataUrl, width: this._width + "px", height: this._height + "px"});

        if (options.hasOwnProperty("ANGLE")) {
            this._ptSymbol.setAngle(options.ANGLE);
        }

        var drawEssentials = new DrawEssentials();
        // Handle immediate placement or interactive drawing
        if (options.GEOM) {
            drawEssentials = this.createDrawEssentials(options.GEOM.clone(), options);
            this.placeSymbolImmediately(options.GEOM, options);
        } else {
            this.startInteractiveDrawing(options);
        }
    }

    /**
     * Create symbol data using the milsymbol library
     */
    private createSymbolData(options: UEISymbolOptions, sidc?: string): void {
        try {
            const symbolOptions = enrichSymbolOptions({
                sidc: sidc || options.SIDC || this.SIC,
                size: options.SIZE || 20,
                ...options
            });

            // Use milsymbol to generate the symbol
            this._ueiData = new ms.symbol(sidc, symbolOptions).getMarker();
            this.symbolData = {
                asImage: () => this._ueiData.asCanvas().toDataURL(),
                height: this._ueiData.height || 35,
                width: this._ueiData.width || 35
            };

            // Create PictureMarkerSymbol
            this.pointSymbol = new PictureMarkerSymbol({
                url: this.symbolData.asImage(),
                width: this.symbolData.width,
                height: this.symbolData.height
            });

            // Apply angle if specified
            if (options.ANGLE) {
                // Note: PictureMarkerSymbol doesn't have setAngle method in 4.x
                // Angle can be applied through rotation property or symbol modification
                console.log("Angle specified but not implemented for PictureMarkerSymbol in 4.x");
            }

        } catch (error) {
            console.error("Error creating symbol data:", error);
            // Fallback to a simple symbol
            this.createFallbackSymbol(options);
        }
    }

    /**
     * Create a fallback symbol if milsymbol fails
     */
    private createFallbackSymbol(options: UEISymbolOptions): void {
        this.pointSymbol = new PictureMarkerSymbol({
            url: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHZpZXdCb3g9IjAgMCAyMCAyMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTAiIGN5PSIxMCIgcj0iOCIgZmlsbD0iIzAwMDAwMCIgc3Ryb2tlPSIjRkZGRkZGIiBzdHJva2Utd2lkdGg9IjIiLz4KPC9zdmc+",
            width: 20,
            height: 20
        });
    }

    /**
     * Place symbol immediately at the specified geometry
     */
    private placeSymbolImmediately(geometry: Point, options: UEISymbolOptions): void {
        if (!this._ptSymbol) return;

        const drawEssentials = this.createDrawEssentials(geometry, options);
        this.drawEnd(geometry, this._ptSymbol, drawEssentials);
    }

    /**
     * Start interactive drawing mode
     */
    private startInteractiveDrawing(options: any): void {
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
        
        // Event handlers are already set up in constructor, just need to enable drawing state
        // Disable navigation during drawing
        // Note: Navigation API has changed in 4.x, using alternative approach
        // this.view.navigation.enabled = false; // Commented out due to API changes
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
                    currentMarker: this._ptSymbol
                });
            }
        });

        // Click handler
        this.clickHandler = this.view.on("click", (event) => {
            if (!this.isDrawing) return;
            
            const mapPoint = this.view.toMap(event);
            
            if (mapPoint) {
                this.cleanUp();
                this.placeSymbolAtPoint(mapPoint);
            }
        });
    }

    /**
     * Place symbol at the specified point
     */
    private placeSymbolAtPoint(point: Point): void {
        if (!this._ptSymbol) return;
        
        // Create DrawEssentials for the final placement
        //const drawEssentials = this.createDrawEssentials(point, this._options);
        
        // Fire the onDrawEnd event
        this.onDrawEnd(point, this._ptSymbol, this._options);
    }

    /**
     * Create DrawEssentials for the symbol
     */
    private createDrawEssentials(geometry: Point, options: UEISymbolOptions): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SIC;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.GEOM = geometry;
        drawEssentials.AMPLIFIER = this.amplifier.toString();
        // Note: OPTIONS and UEI properties don't exist in DrawEssentials, storing in extra properties
        (drawEssentials as any).OPTIONS = options;
        (drawEssentials as any).UEI = "1";

        return drawEssentials;
    }

    /**
     * Handle the end of drawing
     */
    private drawEnd(geometry: Point, symbol: PictureMarkerSymbol, drawEssentials: DrawEssentials): void {
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
    private onDrawEnd(geometry: Point, symbol: PictureMarkerSymbol, drawEssentials: DrawEssentials): void {
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
        
        // Event handlers remain active but won't execute due to isDrawing = false
        // Re-enable navigation
        // Note: Navigation API has changed in 4.x
        // this.view.navigation.doubleClickZoomEnabled = true; // Commented out due to API changes
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
        this.pointSymbol = null;
        this.symbolData = null;
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
                symbolType: "UEISymbol",
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

export default UEISymbol;

