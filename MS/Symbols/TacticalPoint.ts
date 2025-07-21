import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import PictureMarkerSymbol from "@arcgis/core/symbols/PictureMarkerSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";

// Import tactical point symbols data
import tacticalPointSymbols from "../Data/TacticalPointSymbols.json";

export interface MarkerOptions {
    color?: any;
    size?: number;
    angle?: number;
    outline?: {
        color?: any;
        width?: number;
    };
}

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
    private _ptSymbol: PictureMarkerSymbol | null = null;
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
    public init(options: TacticalPointOptions, marker?: MarkerOptions, sic?: string, symName?: string, offset?: string, sidc?: string): void {
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

            console.log("offset is " + this._offset)

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
     * Uses PictureMarkerSymbol with SVG data URL for consistent rendering
     */
    private createCrossCompatibleSymbol(
        path: string, 
        color: any, 
        size: number, 
        angle: number, 
        outline?: any
    ): PictureMarkerSymbol {
        
        console.log(`Creating unified symbol for ${this.view.type} view with path:`, path);
        
        // Use PictureMarkerSymbol with SVG data URL for both 2D and 3D views
        // This ensures seamless switching between view types
        const svgDataUrl = this.pathToSvgDataUrl(path, color, size, outline);
        console.log("Generated SVG data URL:", svgDataUrl);
        
        // Adjust size based on view type for optimal visibility
        // Increase base sizes to make symbols more visible but not too large
        const adjustedSize = this.view.type === "3d" ? Math.max(size * 3.5, 48) : Math.max(size * 3, 36);
        
        const symbol = new PictureMarkerSymbol({
            url: svgDataUrl,
            width: adjustedSize,
            height: adjustedSize,
            angle: angle
        });

        console.log("Adjusted Size ", adjustedSize);
        
        // Set offset for proper positioning
        // PictureMarkerSymbol uses center anchor point by default
        if (this._offset === "1") {
            // Center Bottom positioning - move symbol up by half its height
            symbol.xoffset = 0;
            symbol.yoffset = adjustedSize / 2;
            console.log("Applied bottom-center offset:", symbol.yoffset);
        } else {
            // Default: Center the symbol perfectly on the cursor
            symbol.xoffset = 0;
            symbol.yoffset = 0;
            console.log("Applied center offset: 0,0");
        }
        return symbol;
    }

    /**
     * Calculate approximate bounds of an SVG path for centering
     */
    private calculatePathBounds(path: string): { minX: number, minY: number, maxX: number, maxY: number, centerX: number, centerY: number } {
        // Extract numbers from path - this is a simplified approach
        const numbers = path.match(/-?\d+\.?\d*/g);
        if (!numbers || numbers.length < 2) {
            // Fallback to default 500x500 bounds
            return { minX: 0, minY: 0, maxX: 500, maxY: 500, centerX: 250, centerY: 250 };
        }
        
        const coords = numbers.map(n => parseFloat(n));
        let minX = Math.min(...coords.filter((_, i) => i % 2 === 0)); // x coordinates
        let maxX = Math.max(...coords.filter((_, i) => i % 2 === 0));
        let minY = Math.min(...coords.filter((_, i) => i % 2 === 1)); // y coordinates  
        let maxY = Math.max(...coords.filter((_, i) => i % 2 === 1));
        
        // Ensure reasonable bounds
        if (minX === maxX) { minX -= 50; maxX += 50; }
        if (minY === maxY) { minY -= 50; maxY += 50; }
        
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        
        console.log("Path bounds:", { minX, minY, maxX, maxY, centerX, centerY });
        return { minX, minY, maxX, maxY, centerX, centerY };
    }

    /**
     * Convert SVG path to SVG data URL for both 2D and 3D compatibility
     * Centers the path within the viewBox for proper anchor point alignment
     */
    private pathToSvgDataUrl(path: string, color: any, size: number, outline?: any): string {
        try {
            console.log("pathToSvgDataUrl input color:", color, "type:", typeof color);
            
            // Handle different color formats: ArcGIS Color object, array, or string
            let fillColorStr = '#000000'; // Default fallback
            let strokeColorStr = '#FFFFFF'; // Default white outline
            let strokeWidth = '4'; // Increased default stroke width for better visibility
            
            if (color && typeof color === 'object') {
                if (color.hasOwnProperty('r') && color.hasOwnProperty('g') && color.hasOwnProperty('b')) {
                    // ArcGIS Color object format: {r, g, b, a}
                    const a = color.hasOwnProperty('a') ? color.a : 1;
                    fillColorStr = `rgba(${color.r},${color.g},${color.b},${a})`;
                    console.log("ArcGIS Color object detected:", color, "->", fillColorStr);
                } else if (Array.isArray(color)) {
                    // Array format: [r, g, b, a]
                    fillColorStr = `rgba(${color[0]},${color[1]},${color[2]},${color[3] || 1})`;
                    console.log("Array color detected:", color, "->", fillColorStr);
                }
            } else if (typeof color === 'string') {
                // String format: hex or named color
                fillColorStr = color;
                console.log("String color detected:", color);
            }
            
            // Handle outline color and width
            if (outline) {
                if (outline.color) {
                    if (Array.isArray(outline.color)) {
                        strokeColorStr = `rgba(${outline.color[0]},${outline.color[1]},${outline.color[2]},${outline.color[3] || 1})`;
                    } else if (typeof outline.color === 'string') {
                        strokeColorStr = outline.color;
                    } else if (outline.color.hasOwnProperty('r')) {
                        const a = outline.color.a || 1;
                        strokeColorStr = `rgba(${outline.color.r},${outline.color.g},${outline.color.b},${a})`;
                    }
                }
                if (outline.width) {
                    strokeWidth = outline.width.toString();
                }
            }
            
            console.log("Final colors - Fill:", fillColorStr, "Stroke:", strokeColorStr, "Width:", strokeWidth);
                
            // Use consistent sizing approach for both 2D and 3D
            const svgSize = Math.max(size * 3, 64);
            
            // Calculate path bounds for proper centering
            const bounds = this.calculatePathBounds(path);
            
            // Calculate transform to center the path in a 500x500 viewBox
            const translateX = 250 - bounds.centerX;
            const translateY = 250 - bounds.centerY;
                
            // Create a properly centered SVG with the path positioned in the center
            const svgString = `<svg width="${svgSize}" height="${svgSize}" viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg">
                <g transform="translate(${translateX},${translateY})">
                    <path d="${path}" fill="${fillColorStr}" stroke="${strokeColorStr}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round"/>
                </g>
            </svg>`;
            
            console.log("Generated centered SVG with translation:", translateX, translateY);
            console.log("SVG string:", svgString);
            console.log("Original size:", size, "SVG size:", svgSize);
            
            // Convert to data URL using base64 encoding
            const base64SVG = btoa(svgString);
            const dataUrl = `data:image/svg+xml;base64,${base64SVG}`;
            
            return dataUrl;
            
        } catch (error) {
            console.error("Error creating SVG data URL:", error);
            
            // Fallback to a simple circle if SVG generation fails
            const fallbackSize = Math.max(size * 2.5, 48);
            const fallbackSvg = `<svg width="${fallbackSize}" height="${fallbackSize}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                <circle cx="50" cy="50" r="40" fill="#FF0000" stroke="#FFFFFF" stroke-width="2"/>
            </svg>`;
            
            const base64Fallback = btoa(fallbackSvg);
            return `data:image/svg+xml;base64,${base64Fallback}`;
        }
    }

    /**
     * Get symbol size from PictureMarkerSymbol
     */
    private getSymbolSize(symbol: PictureMarkerSymbol): number {
        return typeof symbol.width === 'string' ? parseInt(symbol.width) : (symbol.width as number) || 20;
    }

    /**
     * Get symbol angle from PictureMarkerSymbol
     */
    private getSymbolAngle(symbol: PictureMarkerSymbol): number {
        return symbol.angle || 0;
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
            
            console.log("Created temp graphic with symbol:", {
                symbolType: this._ptSymbol.type,
                width: this._ptSymbol.width,
                height: this._ptSymbol.height,
                xoffset: this._ptSymbol.xoffset,
                yoffset: this._ptSymbol.yoffset,
                url: this._ptSymbol.url ? this._ptSymbol.url.substring(0, 100) + "..." : "none"
            });
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
    private drawEnd(geometry: Point, symbol: PictureMarkerSymbol, drawEssentials: DrawEssentials): void {
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
    private onDrawEnd(geometry: Point, symbol: PictureMarkerSymbol, drawEssentials: DrawEssentials): void {
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