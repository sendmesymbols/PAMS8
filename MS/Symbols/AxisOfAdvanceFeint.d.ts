import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
export interface AxisOfAdvanceFeintOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    HEAD_RATIO?: number;
    TAIL_FACTOR?: number;
    [key: string]: any;
}
/**
 * AxisOfAdvanceFeint class for drawing Axis of Advance for Feint arrows
 * Creates complex arrow shapes with feint lines in front of the arrow head
 * Similar to AvenueOfApchs but with additional visual elements for deception
 */
export declare class AxisOfAdvanceFeint {
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
    private _tailFactor;
    private _headPercentage;
    private isDrawing;
    private tempGraphic;
    private _baseLinePts;
    private clickHandler;
    private doubleClickHandler;
    private mouseMoveHandler;
    private events;
    constructor(view: MapView | SceneView, isLine?: boolean);
    /**
     * Initialize the axis of advance feint drawing
     */
    init(options: AxisOfAdvanceFeintOptions, marker: SimpleLineSymbol): void;
    /**
     * Utility method to set default values
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
     * Create simple feint arrow for 2 or fewer points
     */
    private createSimpleFeintArrow;
    /**
     * Create complex feint arrow for more than 2 points
     */
    private createComplexFeintArrow;
    /**
     * Add feint lines in front of the arrow head
     */
    private addFeintLines;
    /**
     * Create fracture points between two points
     */
    private fracturePts;
    /**
     * Add all rings/paths to the result polygon
     */
    private addAllRings;
    /**
     * Create arrow head path with feint line positions
     */
    private CreateArrowHeadPathEx;
    /**
     * Get midpoint between two points
     */
    private getMidPoint;
    /**
     * Create Bezier path for point collection only (fallback)
     */
    private CreateBezierPathPCOnly;
    /**
     * Calculate angle between two points relative to a candidate point
     */
    private twoPtsAngle;
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
     * Calculate vertex angles for point array
     */
    private calculateVertexAngles;
    /**
     * Calculate path length
     */
    private calculatePathLength;
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
    on(eventName: string, callback: (data: any) => void): void;
    off(eventName: string, callback?: (data: any) => void): void;
    getSymbolLayer(): GraphicsLayer;
    clearSymbols(): void;
}
export default AxisOfAdvanceFeint;
