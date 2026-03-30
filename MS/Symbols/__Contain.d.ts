import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
export interface ContainOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polyline;
    [key: string]: any;
}
/**
 * Contain class for drawing Contain tactical symbols
 * Uses direct click handling for control points
 * Returns Polyline geometry despite being classified as an Area symbol
 */
export declare class Contain {
    private view;
    private layerManager;
    private symbolLayer;
    private SID;
    private symName;
    private symGeometricType;
    private _lineSym;
    private _points;
    private amplifier;
    private _teethSize;
    private _teethGap;
    private tempGraphic;
    private clickHandler;
    private doubleClickHandler;
    private mouseMoveHandler;
    private eventListeners;
    constructor(view: MapView | SceneView);
    /**
     * Initialize the Contain drawing
     */
    init(options: ContainOptions, marker: SimpleLineSymbol): void;
    /**
     * Start interactive drawing (direct click handling like source)
     */
    private startInteractiveDrawing;
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
    private createTeeth;
    /**
     * Create circle segment from three points (ported from legacy)
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
