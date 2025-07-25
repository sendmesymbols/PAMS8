import Point from "@arcgis/core/geometry/Point";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Amplifier from "../Support/Amplifier";
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
export declare class TacticalPoint {
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
    private size;
    private angle;
    private amplifier;
    private isDrawing;
    private tempGraphic;
    private tactPtSymData;
    private mouseMoveHandler;
    private clickHandler;
    private eventListeners;
    constructor(view: MapView | SceneView);
    /**
     * Initialize the tactical point symbol with options
     */
    init(options: TacticalPointOptions, marker?: MarkerOptions, sic?: string, symName?: string, offset?: string, sidc?: string): void;
    /**
     * Create cross-compatible symbol for both 2D and 3D views
     * Uses PictureMarkerSymbol with SVG data URL for consistent rendering
     */
    private createCrossCompatibleSymbol;
    /**
     * Calculate approximate bounds of an SVG path for centering
     */
    private calculatePathBounds;
    /**
     * Convert SVG path to SVG data URL for both 2D and 3D compatibility
     * Centers the path within the viewBox for proper anchor point alignment
     */
    private pathToSvgDataUrl;
    /**
     * Get symbol size from PictureMarkerSymbol
     */
    private getSymbolSize;
    /**
     * Get symbol angle from PictureMarkerSymbol
     */
    private getSymbolAngle;
    /**
     * Create DrawEssentials for the tactical point
     */
    private createDrawEssentials;
    /**
     * Place symbol immediately at the specified geometry
     */
    private placeSymbolImmediately;
    /**
     * Start interactive drawing mode
     */
    private startInteractiveDrawing;
    /**
     * Set up mouse event handlers for interactive drawing
     */
    private setupEventHandlers;
    /**
     * Finish the interactive drawing process
     */
    private finishDrawing;
    /**
     * Handle the end of drawing with geographic conversion
     */
    private drawEnd;
    /**
     * Handle the end of drawing and emit events
     */
    private onDrawEnd;
    /**
     * Clean up drawing state
     */
    private cleanUp;
    /**
     * Remove event handlers
     */
    private removeEventHandlers;
    /**
     * Deactivate the tactical point drawing
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
     * Clear all tactical point symbols from the layer
     */
    clearSymbols(): void;
}
export default TacticalPoint;
