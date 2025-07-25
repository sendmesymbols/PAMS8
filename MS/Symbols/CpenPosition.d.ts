import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
export interface CpenPositionOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polyline;
    ECHELON?: number;
    DRAW_TYPE?: number;
    FACE_GAP?: number;
    [key: string]: any;
}
export interface ClosestPointResult {
    x: number;
    y: number;
    index: number;
    fTo: number;
    fFrom: number;
}
/**
 * CpenPosition class for drawing C Pen Position symbols on MapView or SceneView
 * Supports both immediate placement and interactive drawing modes with multiple draw types
 */
export declare class CpenPosition {
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
    private _echelon;
    private _drawType;
    private _face_gap;
    private _FACE_GAP_CONTS;
    private _FACE_GAP_CONTS_ELL;
    private isDrawing;
    private tempGraphic;
    private clickHandler;
    private doubleClickHandler;
    private mouseMoveHandler;
    private eventListeners;
    constructor(view: MapView | SceneView, isLine?: boolean);
    /**
     * Initialize the C pen position drawing
     */
    init(options: CpenPositionOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void;
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
     * Create symbol by line (draw type 1)
     */
    private createSymbolByLine;
    /**
     * Create symbol by close line (draw type 2)
     */
    private createSymbolByCloseLine;
    /**
     * Create symbol by perfect ellipse (draw type 3)
     */
    private createSymbolByPerfectEllipse;
    /**
     * Create ellipse path
     */
    private createEllipse;
    /**
     * Create echelon symbols
     */
    private createEchelon;
    /**
     * Get closest point on lines (for arrays of number arrays)
     */
    private getClosestPointOnLines;
    /**
     * Get closest point on lines (for point objects)
     */
    private getClosestPointOnLines2;
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
export default CpenPosition;
