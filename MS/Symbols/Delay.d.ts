import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
export interface DelayOptions {
    CTRL_PTS?: Point[];
    BASE_LN_PTS?: {
        startPt: Point;
        endPt: Point;
    };
    GEOM?: Polyline;
    [key: string]: any;
}
/**
 * Delay class for drawing Delay tactical symbols
 * Uses baseline + control points
 * Returns Polyline geometry despite being classified as an Area symbol
 */
export declare class Delay {
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
    private events;
    constructor(view: MapView | SceneView, isLine?: boolean);
    /**
     * Initialize the Delay drawing
     */
    init(options: DelayOptions, marker: SimpleLineSymbol): void;
    /**
     * Start interactive drawing mode (no baseline)
     */
    private startInteractiveDrawing;
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
     * Create circle segment from three points (ported from legacy)
     */
    private CreateCircleSegmentFromThreePoints;
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
    on(eventName: string, callback: (data: any) => void): void;
    off(eventName: string, callback?: (data: any) => void): void;
    getSymbolLayer(): GraphicsLayer;
    clearSymbols(): void;
}
export default Delay;
