import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
export interface AmbushOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polyline;
    TEETH_SIZE?: number;
    TEETH_GAP?: number;
    [key: string]: any;
}
/**
 * Ambush class for drawing Ambush symbols on MapView or SceneView
 * Supports both immediate placement and interactive drawing modes with curved sections and teeth
 */
export declare class Ambush {
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
    private _teethSize;
    private _teethGap;
    private amplifier;
    private isDrawing;
    private tempGraphic;
    private clickHandler;
    private doubleClickHandler;
    private mouseMoveHandler;
    private events;
    constructor(view: MapView | SceneView, isLine?: boolean);
    private toPointPath;
    /**
     * Initialize the ambush drawing
     */
    init(options: AmbushOptions, marker: SimpleLineSymbol): void;
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
     * Add teeth to the curved section
     */
    private addTeeth;
    private addTeethFromArc;
    /**
     * Create arrow head geometry
     */
    private createArrowHead;
    /**
     * Create simple arrow head as fallback
     */
    private createSimpleArrowHead;
    /**
     * Create teeth geometry
     */
    private createTeeth;
    /**
     * Circle calculation from three points
     */
    private _circleDrawEx;
    /**
     * Calculate determinant
     */
    private _determinantDrawEx;
    /**
     * Create circle segment from three points
     */
    private CreateCircleSegmentFromThreePoints;
    /**
     * Utility methods
     */
    private calculateDistance;
    private calculateAngle;
    private calculateArrowFlanksLength;
    private setDefault;
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
export default Ambush;
