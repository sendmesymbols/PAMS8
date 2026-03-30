import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
export interface ContainOptions {
    CTRL_PTS?: Point[];
    BASE_LN_PTS?: {
        startPt: Point;
        endPt: Point;
    };
    GEOM?: Polyline;
    [key: string]: any;
}
/**
 * Contain class for drawing Contain tactical symbols
 * Uses baseline + control points
 * Returns Polyline geometry despite being classified as an Area symbol
 */
export declare class Contain {
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
    private _teethSize;
    private _teethGap;
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
     * Initialize the Contain drawing
     */
    init(options: ContainOptions, marker: SimpleLineSymbol): void;
    /**
     * Start baseline drawing
     */
    private startBaseLineDrawing;
    /**
     * Handle baseline click events
     */
    private baseLineClick;
    /**
     * Handle baseline draw progress
     */
    private baseLineDrawProgress;
    /**
     * Handle baseline draw end
     */
    private baseLineDrawEnd;
    /**
     * Set up control point drawing handlers
     */
    private setupControlPointHandlers;
    /**
     * Handle click events for control points
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
     * Create flap (arrow wings) path at the end point
     */
    private flaps;
    private createTeeth;
    /**
     * Get baseline points
     */
    getBaseLinePts(): any;
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
export default Contain;
