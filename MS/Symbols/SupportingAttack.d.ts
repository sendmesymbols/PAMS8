import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
export interface SupportingAttackOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polyline;
    HEAD_RATIO?: number;
    TAIL_FACTOR?: number;
    [key: string]: any;
}
/**
 * Supporting Attack class for drawing Supporting Attack Like Arrow symbols on MapView or SceneView
 * Supports both immediate placement and interactive drawing modes
 */
export declare class SupportingAttack {
    private view;
    private layerManager;
    private symbolLayer;
    private isLine;
    declaredClass: string;
    SID: string;
    symName: string;
    symGeometricType: string;
    private _lineSym;
    private _points;
    private amplifier;
    private _tailFactor;
    private _headPercentage;
    private isDrawing;
    private tempGraphic;
    private clickHandler;
    private doubleClickHandler;
    private mouseMoveHandler;
    private events;
    constructor(view: MapView | SceneView, isLine?: boolean);
    /**
     * Initialize the freehand supporting attack drawing
     */
    init(options: SupportingAttackOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void;
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
     * Create simple arrow for 2 points or less
     */
    private createSimpleArrow;
    /**
     * Create complex arrow for multiple points
     */
    private createComplexArrow;
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
export default SupportingAttack;
