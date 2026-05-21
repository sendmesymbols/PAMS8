import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
export interface FreehandDottedArrowOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polyline;
    DRAW_TYPE?: number;
    TEETH_GAP?: number;
    [key: string]: any;
}
/**
 * FreehandDottedArrow class for drawing dotted arrow symbols on MapView or SceneView
 * Supports both immediate placement and interactive drawing modes
 */
export declare class FreehandDottedArrow {
    private view;
    private layerManager;
    private symbolLayer;
    private isLine;
    private SID;
    private symName;
    private symGeometricType;
    private _lineSym;
    private _points;
    private _drawType;
    private _teethGap;
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
     * Initialize the freehand dotted arrow drawing
     */
    init(options: FreehandDottedArrowOptions, marker: SimpleLineSymbol): void;
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
     * Create arrow head geometry
     */
    private createArrowHead;
    /**
     * Create simple arrow head as fallback
     */
    private createSimpleArrowHead;
    /**
     * Create dotted line symbol
     */
    private createSymbolByLine;
    /**
     * Create curved dotted line symbol
     */
    private createSymbolByCurve;
    /**
     * Create Bezier path from points (returns array of points instead of Polyline)
     */
    private CreateBezierPath;
    /**
     * Get dash points along a path
     */
    private getDashPoints;
    /**
     * Get point at specific distance along path
     */
    private getPointAtDistance;
    /**
     * Calculate total path length
     */
    private calculatePathLength;
    /**
     * Utility methods
     */
    private calculateDistance;
    private calculateAngle;
    private removeDuplicatePoints;
    private calculateBezierPoint;
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
export default FreehandDottedArrow;
