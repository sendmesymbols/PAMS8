import Point from "@arcgis/core/geometry/Point";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
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
export declare class TacticalPointText {
    private view;
    private layerManager;
    private symbolLayer;
    private SIC;
    private symName;
    private symGeometricType;
    private _ptSymbol;
    private _point;
    private _path;
    private _offset;
    private _opacity;
    private tactPtSymData;
    private amplifier;
    private isDrawing;
    private tempGraphic;
    private mouseMoveHandler;
    private clickHandler;
    private eventListeners;
    constructor(view: MapView | SceneView);
    /**
     * Initialize the symbol with options
     */
    init(options: TacticalPointTextOptions, marker: SimpleMarkerSymbol, sic: string, symName: string, offset: string, sidc: string): void;
    /**
     * Configure the marker symbol with the specified options
     */
    private configureMarkerSymbol;
    /**
     * Start interactive drawing mode
     */
    private startInteractiveDrawing;
    /**
     * Set up mouse event handlers for interactive drawing (called once in constructor)
     */
    private setupEventHandlers;
    /**
     * Finish the drawing process
     */
    private finishDrawing;
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
export default TacticalPointText;
