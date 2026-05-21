import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
export interface FreehandSemiCircleOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
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
 * FreehandSemiCircle class for drawing Freehand Semi Circle symbols on MapView or SceneView
 * Creates semi-circles from three points with circle calculations
 */
export declare class FreehandSemiCircle {
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
    private isDrawing;
    private tempGraphic;
    private clickHandler;
    private doubleClickHandler;
    private mouseMoveHandler;
    private events;
    constructor(view: MapView | SceneView, isLine?: boolean);
    /**
     * Initialize the freehand semi circle drawing
     */
    init(options: FreehandSemiCircleOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void;
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
     * Create symbol geometry from DrawEssentials
     */
    private createSymbol;
    /**
     * Calculate circle from three points
     */
    private _circleDrawEx;
    /**
     * Recursive determinant calculation
     */
    private _determinantDrawEx;
    /**
     * Create circle segment from three points
     */
    private CreateCircleSegmentFromThreePoints;
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
    on(eventName: string, callback: (data: any) => void): void;
    off(eventName: string, callback?: (data: any) => void): void;
    /**
     * Get the current symbol layer
     */
    getSymbolLayer(): GraphicsLayer;
    /**
     * Clear all symbols from the layer
     */
    clearSymbols(): void;
}
export default FreehandSemiCircle;
