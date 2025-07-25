import Point from "@arcgis/core/geometry/Point";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Amplifier from "../Support/Amplifier";
import '../ThirdParty/milsymbol.d.ts';
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
export declare class UEISymbol {
    private view;
    private layerManager;
    private symbolLayer;
    private SIC;
    private symName;
    private symGeometricType;
    private _ueiData;
    private _height;
    private _width;
    private _ptSymbol;
    private _options;
    private isDrawing;
    private tempGraphic;
    private symbolData;
    private pointSymbol;
    private amplifier;
    private mouseMoveHandler;
    private clickHandler;
    private eventListeners;
    constructor(view: MapView | SceneView);
    /**
     * Initialize the symbol with options
     */
    init(options: any, marker?: any, sic?: string, symName?: string, offset?: string, sidc?: string): void;
    /**
     * Create symbol data using the milsymbol library
     */
    private createSymbolData;
    /**
     * Create a fallback symbol if milsymbol fails
     */
    private createFallbackSymbol;
    /**
     * Place symbol immediately at the specified geometry
     */
    private placeSymbolImmediately;
    /**
     * Start interactive drawing mode
     */
    private startInteractiveDrawing;
    /**
     * Set up mouse event handlers for interactive drawing (called once in constructor)
     */
    private setupEventHandlers;
    /**
     * Place symbol at the specified point
     */
    private placeSymbolAtPoint;
    /**
     * Create DrawEssentials for the symbol
     */
    private createDrawEssentials;
    /**
     * Handle the end of drawing
     */
    private drawEnd;
    /**
     * Handle the end of drawing with geographic conversion
     */
    private onDrawEnd;
    /**
     * Clean up drawing state
     */
    private cleanUp;
    /**
     * Remove event handlers (only call when deactivating the entire symbol)
     */
    private removeEventHandlers;
    /**
     * Deactivate the symbol drawing
     */
    deactivate(): void;
    /**
     * Event emitter methods
     */
    private emit;
    /**
     * Emit global events that can be caught by SymbolEngine
     */
    private emitGlobalEvent;
    on(eventName: string, callback: Function): void;
    off(eventName: string, callback?: Function): void;
    /**
     * Get the current symbol layer
     */
    getSymbolLayer(): GraphicsLayer;
    /**
     * Clear all symbols from the layer
     */
    clearSymbols(): void;
}
export default UEISymbol;
