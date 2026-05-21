import Point from '@arcgis/core/geometry/Point';
import Polyline from '@arcgis/core/geometry/Polyline';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
export interface WithdrawOptions {
    ECHLON?: number;
    CTRL_PTS?: Point[];
    GEOM?: Polyline;
    [key: string]: any;
}
/**
 * Withdraw class for drawing Withdraw tactical symbols
 * Uses baseline + control points pattern with arc and arrow
 * Returns Polyline geometry despite being classified as an Area symbol
 */
export declare class Withdraw {
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
    private _geometryType;
    private _arrowHeadRatio;
    private _echlon;
    private amplifier;
    private isDrawing;
    private tempGraphic;
    private clickHandler;
    private doubleClickHandler;
    private mouseMoveHandler;
    private events;
    private toXYPath;
    constructor(view: MapView | SceneView, isLine?: boolean);
    init(options: WithdrawOptions, marker: SimpleLineSymbol): void;
    /**
     * Start interactive drawing mode
     */
    private startInteractiveDrawing;
    /**
     * Set up event handlers for interactive drawing
     */
    private setupEventHandlers;
    /**
     * Handle click events for control points
     */
    private _onClickHandler;
    /**
     * Handle double click events
     */
    private _onDoubleClickHandler;
    private find_angle;
    private angleBetweenTwoPointsWithFixedPoint;
    private createDrawEssentials;
    private createSymbol;
    /**
     * Handle mouse move events
     */
    private _onMouseMoveHandler;
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
    private _circleDrawEx;
    private _determinantDrawEx;
    private CreateCircleSegmentFromThreePoints;
}
export default Withdraw;
