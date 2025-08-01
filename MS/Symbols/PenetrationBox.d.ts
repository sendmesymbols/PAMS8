import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
export interface PenetrationBoxOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    DRAW_TYPE?: number;
    [key: string]: any;
}
/**
 * Class Representing Penetration Box.
 * @class
 * @author Abdul Razak
 */
declare class PenetrationBox {
    declaredClass: string;
    SID: string;
    symName: string;
    symGeometricType: string;
    private view;
    private isLine;
    private _lineSymbol;
    private _points;
    private _geometryType;
    private _drawType;
    private _tGraphic;
    private _onClick;
    private _onDblClick;
    private _onMouseMove;
    private eventListeners;
    constructor(view: MapView | SceneView, isLine: boolean);
    /**
     * Initialize the symbol drawing
     */
    init(options: PenetrationBoxOptions, marker: SimpleLineSymbol): void;
    /**
     * Create draw essentials object
     */
    private createDrawEssentials;
    /**
     * Create the symbol geometry
     */
    private createSymbol;
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
     * Create Bezier path
     */
    private CreateBezierPath;
    /**
     * Create symbol by B-curve
     */
    private createSymbolByBCurve;
    /**
     * Create symbol by polygon
     */
    private createSymbolByPolygon;
    /**
     * Create symbol by rectangle
     */
    private createSymbolByRect;
    /**
     * Emit events
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
}
export default PenetrationBox;
