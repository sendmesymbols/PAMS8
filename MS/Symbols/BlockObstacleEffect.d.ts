import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
export interface BlockObstacleEffectOptions {
    CTRL_PTS?: Point[];
    BASE_LN_PTS?: {
        startPt: Point;
        endPt: Point;
    };
    GEOM?: Polyline;
    [key: string]: any;
}
/**
 * BlockObstacleEffect class for drawing Block/Obstacle Effect tactical symbols
 * Uses baseline + control points pattern with simpler geometry than Block
 * Classified as obstacle type with isObstacle property
 */
export declare class BlockObstacleEffect {
    private view;
    private layerManager;
    private symbolLayer;
    private isLine;
    private SID;
    private symName;
    private symGeometricType;
    private isObstacle;
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
    private events;
    constructor(view: MapView | SceneView, isLine?: boolean);
    /**
     * Initialize the block obstacle effect drawing
     */
    init(options: BlockObstacleEffectOptions, marker: SimpleLineSymbol): void;
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
     * Calculate distance between two points
     */
    private calculateDistance;
    /**
     * Calculate angle for two points relationship
     */
    private calculateAngle;
    /**
     * Determine relationship between two points
     */
    private twoPtsRelationship;
    /**
     * Get midpoint between two points
     */
    private getMidPoint;
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
export default BlockObstacleEffect;
