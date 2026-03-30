import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
export interface FreehandSemiCircleFilledOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    opacity?: number;
    [key: string]: any;
}
export interface CircleResult {
    radius: number;
    center: {
        x: number;
        y: number;
    };
}
export interface CircleSegmentResult {
    geometry: Polygon;
    lastPoint: Point;
    backPoint: Point;
}
/**
 * FreehandSemiCircleFilled class for drawing Filled Freehand Semi Circle symbols on MapView or SceneView
 * Creates filled semi-circles from three points with opacity support
 */
export declare class FreehandSemiCircleFilled {
    private view;
    private layerManager;
    private symbolLayer;
    private isLine;
    private SID;
    private symName;
    private symGeometricType;
    private _lineSym;
    private _points;
    private _geometryType;
    private amplifier;
    private _opacity;
    private isDrawing;
    private tempGraphic;
    private clickHandler;
    private doubleClickHandler;
    private mouseMoveHandler;
    private eventListeners;
    constructor(view: MapView | SceneView, isLine?: boolean);
    /**
     * Initialize the freehand semi circle filled drawing
     */
    init(options: FreehandSemiCircleFilledOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void;
    /**
     * Start interactive drawing mode
     */
    private startInteractiveDrawing;
    /**
     * Set up mouse event handlers for interactive drawing
     */
    private setupEventHandlers;
    /**
     * Handle click events
     */
    private _onClickHandler;
    /**
     * Handle double click events
     */
    private _onDoubleClickHandler;
    /**
     * Handle mouse move events
     */
    private _onMouseMoveHandler;
    /**
     * Create DrawEssentials object
     */
    private createDrawEssentials;
    /**
     * Create symbol geometry from DrawEssentials (same as FreehandSemiCircle)
     */
    private createSymbol;
    /**
     * Calculate circle from three points (same as FreehandSemiCircle)
     */
    private _circleDrawEx;
    /**
     * Recursive determinant calculation (same as FreehandSemiCircle)
     */
    private _determinantDrawEx;
    /**
     * Clean up drawing state and finalize
     */
    private cleanUp;
    /**
     * Handle draw end
     */
    private __drawEnd;
    /**
     * Final draw end handler
     */
    private __onDrawEnd;
    /**
     * Clear graphics and state
     */
    private _clear;
    /**
     * Remove event handlers
     */
    private _removeEvents;
    /**
     * Deactivate the drawing tool
     */
    deactivate(): void;
    /**
     * Event emitter functionality
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
export default FreehandSemiCircleFilled;
