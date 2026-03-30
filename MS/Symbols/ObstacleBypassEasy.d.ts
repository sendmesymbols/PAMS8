import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
export interface ObstacleBypassEasyOptions {
    CTRL_PTS?: Point[];
    BASE_LN_PTS?: {
        startPt: Point;
        endPt: Point;
    };
    GEOM?: Polyline;
    [key: string]: any;
}
/**
 * Class Representing ObstacleBypassEasy.
 * @class
 * @author Abdul Razak
 */
declare class ObstacleBypassEasy {
    declaredClass: string;
    SID: string;
    symName: string;
    symGeometricType: string;
    private view;
    private isLine;
    private layerManager;
    private symbolLayer;
    private _lineSymbol;
    private _points;
    private _baseLinePts;
    private _geometryType;
    private _tGraphic;
    private _onClick;
    private _onDblClick;
    private _onMouseMove;
    private _onBaseLineEnd;
    private _onBaseLineProgress;
    private _onBaseLineClick;
    private eventListeners;
    constructor(view: MapView | SceneView, isLine: boolean);
    /**
     * Initialize the symbol drawing
     */
    init(options: ObstacleBypassEasyOptions, marker: SimpleLineSymbol): void;
    /**
     * Create draw essentials object
     */
    private createDrawEssentials;
    /**
     * Handle baseline draw end event
     */
    private baseLineDrawEnd;
    /**
     * Handle baseline draw progress event
     */
    private baseLineDrawProgress;
    /**
     * Handle baseline click event
     */
    private baseLineClick;
    /**
     * Create the symbol geometry
     */
    private createSymbol;
    /**
     * Get baseline points
     */
    getBaseLinePts(): any;
    /**
     * Handle mouse move events
     */
    private _onMouseMoveHandler;
    /**
     * Handle click events
     */
    private _onClickHandler;
    /**
     * Handle double click events
     */
    private _onDblClickHandler;
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
     * Remove event listeners
     */
    private _removeEvents;
    /**
     * Deactivate the symbol
     */
    deactivate(): void;
    /**
     * Emit events
     */
    private emit;
    private emitGlobalEvent;
    /**
     * Add event listener
     */
    on(eventName: string, callback: Function): void;
    /**
     * Remove event listener
     */
    off(eventName: string, callback?: Function): void;
}
export default ObstacleBypassEasy;
