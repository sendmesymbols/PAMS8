import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
export interface CanalizeOptions {
    CTRL_PTS?: Point[];
    BASE_LN_PTS?: {
        startPt: Point;
        endPt: Point;
    };
    GEOM?: Polyline;
    [key: string]: any;
}
/**
 * Canalize class for drawing Canalize tactical symbols
 * Uses baseline + control points pattern with fracture lines and arrow flaps
 * Returns Polyline geometry despite being classified as an Area symbol
 */
export declare class Canalize {
    private view;
    private layerManager;
    private symbolLayer;
    private isLine;
    private SID;
    private symName;
    private symGeometricType;
    private _lineSym;
    private _points;
    private _baseLinePts;
    private _geometryType;
    private amplifier;
    private isDrawing;
    private tempGraphic;
    private baseLineComplete;
    private clickHandler;
    private doubleClickHandler;
    private mouseMoveHandler;
    private baseLineEndHandler;
    private baseLineProgressHandler;
    private baseLineClickHandler;
    private eventListeners;
    constructor(view: MapView | SceneView, isLine?: boolean);
    /**
     * Initialize the canalize drawing
     */
    init(options: CanalizeOptions, marker: SimpleLineSymbol): void;
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
     * Set up control point event handlers
     */
    private setupControlPointHandlers;
    /**
     * Handle click events for control points
     */
    private _onClickHandler;
    /**
     * Handle double-click events
     */
    private _onDoubleClickHandler;
    /**
     * Handle mouse move events
     */
    private _onMouseMoveHandler;
    /**
     * Create draw essentials object
     */
    private createDrawEssentials;
    /**
     * Create the canalize symbol geometry
     */
    private createSymbol;
    /**
     * Create arrow flaps
     */
    private _flaps;
    /**
     * Get baseline points
     */
    getBaseLinePts(): any;
    /**
     * Clean up drawing state
     */
    private cleanUp;
    /**
     * Handle draw end
     */
    private __drawEnd;
    /**
     * Emit draw end event
     */
    private __onDrawEnd;
    /**
     * Clear drawing state
     */
    private _clear;
    /**
     * Remove event handlers
     */
    private _removeEvents;
    /**
     * Deactivate the symbol drawing
     */
    deactivate(): void;
    /**
     * Emit events to listeners
     */
    private emit;
    /**
     * Add event listener
     */
    on(eventName: string, callback: Function): void;
    /**
     * Remove event listener
     */
    off(eventName: string, callback?: Function): void;
    /**
     * Get the symbol layer
     */
    getSymbolLayer(): GraphicsLayer;
    /**
     * Clear all symbols from the layer
     */
    clearSymbols(): void;
    /**
     * Calculate arrow flanks length
     */
    private calculateArrowFlanksLen;
    /**
     * Create CC shape (simplified circle)
     */
    private createCCShape;
}
export default Canalize;
