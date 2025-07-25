import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
export interface BypassOptions {
    CTRL_PTS?: Point[];
    BASE_LN_PTS?: {
        startPt: Point;
        endPt: Point;
    };
    GEOM?: Polyline;
    [key: string]: any;
}
/**
 * Bypass class for drawing Bypass symbols
 * Requires baseline drawing followed by bypass direction points
 * Creates fracture patterns and "B" markers on the baseline
 */
export declare class Bypass {
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
    private baselineDrawn;
    private clickHandler;
    private doubleClickHandler;
    private mouseMoveHandler;
    private baseLineEndHandler;
    private baseLineProgressHandler;
    private baseLineClickHandler;
    private eventListeners;
    constructor(view: MapView | SceneView, isLine?: boolean);
    /**
     * Initialize the bypass drawing
     */
    init(options: BypassOptions, marker: SimpleLineSymbol): void;
    /**
     * Start baseline drawing mode
     */
    private startBaselineDrawing;
    /**
     * Handle baseline draw end
     */
    private baseLineDrawEnd;
    /**
     * Handle baseline draw progress
     */
    private baseLineDrawProgress;
    /**
     * Handle baseline click
     */
    private baseLineClick;
    /**
     * Handle click events after baseline is drawn
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
     * Create fracture baseline pattern
     */
    private createFractureBaseline;
    /**
     * Create fracture points pattern
     */
    private fracturePts;
    /**
     * Create "B" marker
     */
    private createBMarker;
    /**
     * Create arrow head
     */
    private createArrowHead;
    /**
     * Calculate arrow flank length
     */
    private calculateArrowLength;
    /**
     * Get baseline points
     */
    getBaseLinePts(): {
        startPt?: Point;
        endPt?: Point;
    };
    /**
     * Utility methods
     */
    private getMidPoint;
    private calculateDistance;
    private calculateAngle;
    private twoPtsRelationShip;
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
export default Bypass;
