import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";
import PictureMarkerSymbol from "@arcgis/core/symbols/PictureMarkerSymbol";
import PointSymbol3D from "@arcgis/core/symbols/PointSymbol3D";
import IconSymbol3DLayer from "@arcgis/core/symbols/IconSymbol3DLayer";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";

// Import tactical point symbols data
import tacticalPointSymbols from "../Data/TacticalPointSymbols.json";

export interface TacticalPointOptions {
    GEOM?: Point;
    SIZE?: number;
    ANGLE?: number;
    AMPLIFIER?: Amplifier;
    [key: string]: any;
}

/**
 * TacticalPoint class for drawing tactical point symbols on MapView or SceneView
 * Supports both immediate placement (with GEOM) and interactive drawing (without GEOM)
 */
export class TacticalPoint {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    
    // Symbol properties
    private SIC: string = "000000";
    private symName: string = "TacticalPoint";
    private symGeometricType: string = "Point";
    private _ptSymbol: SimpleMarkerSymbol | PictureMarkerSymbol | PointSymbol3D | null = null;
    private _point: Point | null = null;
    private _path: string = "";
    private _offset: string = "0";
    private size: number = 20;
    private angle: number = 0;
    private amplifier: Amplifier;
    
    // Drawing state
    private isDrawing: boolean = false;
    private tempGraphic: Graphic | null = null;
    private tactPtSymData: any;
    
    // Event handlers
    private mouseMoveHandler: any = null;
    private clickHandler: any = null;
    
    // Event emitter
    private eventListeners: Map<string, Function[]> = new Map();

    constructor(view: MapView | SceneView) {
        this.view = view;
        this.layerManager = GraphicsLayerManager.getInstance(view);
        this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.TACT_PT);
        this.amplifier = new Amplifier();
        this.tactPtSymData = tacticalPointSymbols;
        
        // Initialize layers if not already done
        this.layerManager.initializeLayers();
        
        // Set up event handlers once in constructor
        this.setupEventHandlers();
    }

    /**
     * Initialize the tactical point symbol with options
     */
    public init(options: TacticalPointOptions, marker?: SimpleMarkerSymbol, sic?: string, symName?: string, offset?: string, sidc?: string): void {
        try {
            if (!sidc || !sic) {
                throw new Error("SIDC and SIC are required for tactical point symbols");
            }

            // Get symbol path from tactical point symbols data
            const symbolKey = sidc.substr(4, 2) + sic;
            this._path = this.tactPtSymData[symbolKey];



            if (!this._path || this._path.length === undefined) {
                throw new Error("Symbol definition not found for key: " + symbolKey);
            }

            // Update symbol properties
            this.SIC = sic;
            this.symName = symName || this.symName;
            this._offset = offset || "0";

            this._ptSymbol = this.createCrossCompatibleSymbol(
                this._path, 
                marker?.color || [0, 0, 0, 1],
                options.SIZE || marker?.size || 20,
                options.ANGLE || marker?.angle || 0,
                marker?.outline
            );

            console.log("TacticalPoint symbol created for", this.view.type, "view:", {
                path: this._path,
                symbolType: this._ptSymbol.type
            });

            // Handle immediate placement or interactive drawing
            if (options.GEOM) {
                this._point = options.GEOM.clone();
                const symbolSize = this.getSymbolSize(this._ptSymbol);
                const symbolAngle = this.getSymbolAngle(this._ptSymbol);
                const drawEssentials = this.createDrawEssentials(this._point, symbolSize, symbolAngle);
                this.placeSymbolImmediately(this._point, drawEssentials);
            } else {
                this.startInteractiveDrawing();
            }

        } catch (error) {
            console.error("Error initializing TacticalPoint:", error);
            throw error;
        }
    }

    /**
     * Create cross-compatible symbol for both 2D and 3D views
     */
    private createCrossCompatibleSymbol(
        path: string, 
        color: any, 
        size: number, 
        angle: number, 
        outline?: any
    ): SimpleMarkerSymbol | PictureMarkerSymbol | PointSymbol3D {
        
        console.log(`Creating symbol for ${this.view.type} view with path:`, path);
        
        if (this.view.type === "2d") {
            // For 2D views, use SimpleMarkerSymbol with path
            const symbol = new SimpleMarkerSymbol({
                style: "path",
                path: path,
                color: color,
                size: size,
                angle: angle,
                outline: outline || {
                    color: [255, 255, 255, 1],
                    width: 1
                }
            });

            // Set offset if specified (Center Bottom positioning)
            if (this._offset === "1") {
                symbol.yoffset = size / 2;
            }

            return symbol;
        } else {
            // For 3D views, use PictureMarkerSymbol with SVG data URL
            // This is more reliable than PointSymbol3D for complex paths
            const svg3DSize = Math.max(size * 4, 30);
            const svgDataUrl = this.pathToSvgDataUrl(path, color, size);
            console.log("Generated SVG data URL for 3D:", svgDataUrl);
            
            const symbol = new PictureMarkerSymbol({
                url: svgDataUrl,
                width: svg3DSize,
                height: svg3DSize,
                angle: angle
            });

            // Set offset if specified (use the 3D size for offset calculation)
            if (this._offset === "1") {
                symbol.yoffset = svg3DSize / 2;
            }

            return symbol;
        }
    }

    /**
     * Convert SVG path to SVG data URL for 3D compatibility
     */
    private pathToSvgDataUrl(path: string, color: any, size: number): string {
        try {
            console.log("pathToSvgDataUrl input color:", color, "type:", typeof color);
            
            // Handle different color formats: ArcGIS Color object, array, or string
            let colorStr = '#000000'; // Default fallback
            let strokeColorStr = '#000000';
            
            if (color && typeof color === 'object') {
                if (color.hasOwnProperty('r') && color.hasOwnProperty('g') && color.hasOwnProperty('b')) {
                    // ArcGIS Color object format: {r, g, b, a}
                    const a = color.hasOwnProperty('a') ? color.a : 1;
                    colorStr = `rgba(${color.r},${color.g},${color.b},${a})`;
                    // Create darker stroke for contrast
                    strokeColorStr = `rgba(${Math.max(0, color.r - 50)},${Math.max(0, color.g - 50)},${Math.max(0, color.b - 50)},${a})`;
                    console.log("ArcGIS Color object detected:", color, "->", colorStr);
                } else if (Array.isArray(color)) {
                    // Array format: [r, g, b, a]
                    colorStr = `rgba(${color[0]},${color[1]},${color[2]},${color[3] || 1})`;
                    strokeColorStr = `rgba(${Math.max(0, color[0] - 50)},${Math.max(0, color[1] - 50)},${Math.max(0, color[2] - 50)},${color[3] || 1})`;
                    console.log("Array color detected:", color, "->", colorStr);
                }
            } else if (typeof color === 'string') {
                // String format: hex or named color
                colorStr = color;
                strokeColorStr = color;
                console.log("String color detected:", color);
            }
            
            console.log("Final colors - Fill:", colorStr, "Stroke:", strokeColorStr);
                
            // Use larger size for 3D view visibility - using the multiplier set above
            const svg3DSize = Math.max(size * 4, 30);
                
            // Use a standard viewBox that works well with most tactical symbol paths
            // Most tactical symbols are designed for a 0-500 coordinate system
            const svgString = `<svg width="${svg3DSize}" height="${svg3DSize}" viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg">
                <path d="${path}" fill="${colorStr}" stroke="${strokeColorStr}" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/>
            </svg>`;
            
            console.log("Generated SVG string for 3D (size multiplier applied):", svgString);
            console.log("Original size:", size, "3D size:", svg3DSize);
            
            // Convert to data URL using base64 encoding (more reliable than encodeURIComponent)
            const base64SVG = btoa(svgString);
            const dataUrl = `data:image/svg+xml;base64,${base64SVG}`;
            
            return dataUrl;
            
        } catch (error) {
            console.error("Error creating SVG data URL:", error);
            
            // Fallback to a simple circle if SVG generation fails
            const fallbackSize = Math.max(size * 1.5, 30);
            const fallbackSvg = `<svg width="${fallbackSize}" height="${fallbackSize}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                <circle cx="50" cy="50" r="40" fill="#FF0000" stroke="#800000" stroke-width="2"/>
            </svg>`;
            
            const base64Fallback = btoa(fallbackSvg);
            return `data:image/svg+xml;base64,${base64Fallback}`;
        }
    }

    /**
     * Get symbol size from different symbol types
     */
    private getSymbolSize(symbol: SimpleMarkerSymbol | PictureMarkerSymbol | PointSymbol3D): number {
        if (symbol instanceof SimpleMarkerSymbol) {
            return symbol.size;
        } else if (symbol instanceof PictureMarkerSymbol) {
            return typeof symbol.width === 'string' ? parseInt(symbol.width) : (symbol.width as number) || 20;
        } else if (symbol instanceof PointSymbol3D) {
            return (symbol.symbolLayers.getItemAt(0) as IconSymbol3DLayer)?.size || 20;
        }
        return 20;
    }

    /**
     * Get symbol angle from different symbol types
     */
    private getSymbolAngle(symbol: SimpleMarkerSymbol | PictureMarkerSymbol | PointSymbol3D): number {
        if (symbol instanceof SimpleMarkerSymbol) {
            return symbol.angle || 0;
        } else if (symbol instanceof PictureMarkerSymbol) {
            return symbol.angle || 0;
        }
        // PointSymbol3D doesn't have angle property, return 0
        return 0;
    }

    /**
     * Create DrawEssentials for the tactical point
     */
    private createDrawEssentials(geometry: Point, size: number, angle: number): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SIC;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.SIZE = size;
        drawEssentials.GEOM = geometry;
        drawEssentials.AMPLIFIER = this.amplifier.toString();
        
        // Add custom properties for tactical points
        (drawEssentials as any).ANGLE = angle;
        (drawEssentials as any).OFFSET = this._offset;

        return drawEssentials;
    }

    /**
     * Place symbol immediately at the specified geometry
     */
    private placeSymbolImmediately(geometry: Point, drawEssentials: DrawEssentials): void {
        if (!this._ptSymbol) return;

        console.log("placeSymbolImmediately called with geometry:", geometry);
        console.log("Using symbol:", this._ptSymbol);
        console.log("DrawEssentials:", drawEssentials);

        // Call drawEnd to emit the event that will be caught by SymbolEngine
        this.drawEnd(geometry, this._ptSymbol, drawEssentials);
        this.cleanUp();
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

        console.log("Started interactive drawing for TacticalPoint");
    }

    /**
     * Set up mouse event handlers for interactive drawing
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
                this._point = mapPoint.clone();
                this.finishDrawing();
            }
        });
    }

    /**
     * Finish the interactive drawing process
     */
    private finishDrawing(): void {
        if (!this._point || !this._ptSymbol) return;

        const symbolSize = this.getSymbolSize(this._ptSymbol);
        const symbolAngle = this.getSymbolAngle(this._ptSymbol);
        
        const drawEssentials = this.createDrawEssentials(
            this._point, 
            symbolSize, 
            symbolAngle
        );

        this.drawEnd(this._point, this._ptSymbol, drawEssentials);
        this.cleanUp();
    }

    /**
     * Handle the end of drawing with geographic conversion
     */
    private drawEnd(geometry: Point, symbol: SimpleMarkerSymbol | PictureMarkerSymbol | PointSymbol3D, drawEssentials: DrawEssentials): void {
        if (!geometry) return;

        // Convert to geographic if needed
        let geographicGeometry = geometry;
        const spatialRef = this.view.spatialReference;
        
        if (spatialRef.isWebMercator) {
            // For 4.x API, geographic conversion is handled internally
            // We can use the geometry as-is or apply projection if needed
        }

        this.onDrawEnd(geometry, symbol, drawEssentials);
    }

    /**
     * Handle the end of drawing and emit events
     */
    private onDrawEnd(geometry: Point, symbol: SimpleMarkerSymbol | PictureMarkerSymbol | PointSymbol3D, drawEssentials: DrawEssentials): void {
        console.log("TacticalPoint onDrawEnd called");
        
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
        
        // Clear point
        this._point = null;
    }

    /**
     * Remove event handlers
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
     * Deactivate the tactical point drawing
     */
    public deactivate(): void {
        this.cleanUp();
        this.removeEventHandlers();
        this._ptSymbol = null;
        this.isDrawing = false;
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
                symbolType: "TacticalPoint",
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
     * Clear all tactical point symbols from the layer
     */
    public clearSymbols(): void {
        this.symbolLayer.removeAll();
    }
}

export default TacticalPoint; 