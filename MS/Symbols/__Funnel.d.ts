import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
export interface FunnelOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    BASE_LN_PTS?: {
        startPt: Point;
        endPt: Point;
    };
    HEAD_RATIO?: number;
    TAIL_FACTOR?: number;
    FRNT_LN_ANGL_RATIO?: number;
    FRNT_LN_DIST_RATIO?: number;
    FLAP_DIST_RATIO?: number;
    [key: string]: any;
}
/**
 * Funnel class for drawing Avenue of Approaches arrows
 * Creates complex arrow shapes with configurable head and tail parameters
 * Supports both simple (<=2 points) and complex (>2 points) arrow creation
 */
export declare class Funnel {
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
    private frontLineAngle;
    private frontLineDist;
    private flapDist;
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
    init(options: FunnelOptions, marker: SimpleLineSymbol): void;
    /**
     * Start baseline drawing phase
     */
    private startBaselineDrawing;
    /**
     * Handle baseline drawing completion
     */
    private baseLineDrawEnd;
    /**
     * Handle baseline drawing progress
     */
    private baseLineDrawProgress;
    /**
     * Handle baseline click events
     */
    private baseLineClick;
    /**
     * Start interactive drawing mode for funnel points
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
export default Funnel;
