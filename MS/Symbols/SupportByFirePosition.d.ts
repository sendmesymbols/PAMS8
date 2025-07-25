import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
export interface SupportByFirePositionOptions {
    CTRL_PTS?: Point[];
    BASE_LN_PTS?: {
        startPt: Point;
        endPt: Point;
    };
    GEOM?: Polygon;
    BK_LN_DIST_RATIO?: number;
    BK_LN_ANGL_RATIO?: number;
    FRNT_LN_ANGL_RATIO?: number;
    [key: string]: any;
}
/**
 * SupportByFirePosition class for drawing Support By Fire Position symbols on MapView or SceneView
 * Supports both immediate placement and interactive drawing modes
 */
export declare class SupportByFirePosition {
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
    private backLineDist;
    private backLineAngle;
    private frontLineAgle;
    private isDrawing;
    private tempGraphic;
    private clickHandler;
    private doubleClickHandler;
    private mouseMoveHandler;
    private baseLineEndHandler;
    private baseLineClickHandler;
    private baseLineProgressHandler;
    private eventListeners;
    constructor(view: MapView | SceneView, isLine?: boolean);
    /**
     * Initialize the support by fire position drawing
     * @example
     * // Activating interactive drawing and return geometry
     * endEvent = supportByFirePosition.on("onDrawEnd", drawSymEnd);
     *
     * var drawEssentials = {
     *   baseLinePts: {startPt: new Point(88.59375, 88.59375, this.view.spatialReference), endPt: new Point(79.453125, -11.25, this.view.spatialReference)},
     *   controlPoints: [new Point(6.6796875, 9.140625, this.view.spatialReference), new Point(7.6796875, 8.140625, this.view.spatialReference)],
     *   backLineDist: 5,
     *   backLineAngle: 5,
     *   frontLineAgle: 5
     * };
     *
     * supportByFirePosition.init(drawEssentials);
     */
    init(options: SupportByFirePositionOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void;
    /**
     * Start interactive baseline drawing
     */
    private startBaseLineDrawing;
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
    /**
     * Emit global events that can be caught by SymbolEngine
     */
    private emitGlobalEvent;
    on(eventName: string, callback: Function): void;
    off(eventName: string, callback?: Function): void;
    /**
     * Get the current symbol layer
     */
    getSymbolLayer(): GraphicsLayer;
    /**
     * Clear all symbols from the layer
     */
    clearSymbols(): void;
}
export default SupportByFirePosition;
