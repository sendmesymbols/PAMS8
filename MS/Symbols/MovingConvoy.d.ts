import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
export interface MovingConvoyOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    HEAD_RATIO?: number;
    TAIL_FACTOR?: number;
    [key: string]: any;
}
/**
 * MovingConvoy class for drawing Avenue of Approaches arrows
 * Creates complex arrow shapes with configurable head and tail parameters
 * Supports both simple (<=2 points) and complex (>2 points) arrow creation
 */
export declare class MovingConvoy {
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
    private _baseLinePts;
    private clickHandler;
    private doubleClickHandler;
    private mouseMoveHandler;
    private eventListeners;
    constructor(view: MapView | SceneView, isLine?: boolean);
    /**
     * Initialize the avenue of approaches drawing
     */
    init(options: MovingConvoyOptions, marker: SimpleLineSymbol): void;
    /**
     * Utility method to set default values (mimics GeoTools.setDefault)
     */
    private setDefault;
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
     * Create Bezier path for point collection only (fallback)
     */
    /**
     * Determine relationship between two points
     */
    private twoPtsRelationship;
    /**
     * Get baseline points
     */
    getBaseLinePts(): Point[];
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
    private emitGlobalEvent;
    on(eventName: string, callback: Function): void;
    off(eventName: string, callback?: Function): void;
    getSymbolLayer(): GraphicsLayer;
    clearSymbols(): void;
}
export default MovingConvoy;
