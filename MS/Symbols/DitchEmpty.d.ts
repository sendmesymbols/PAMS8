import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
export interface DitchEmptyOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    DRAW_TYPE?: number;
    [key: string]: any;
}
/**
 * DitchEmpty class for Ditch Empty symbol
 * Supports multiple drawing types: Bezier curve (1), Polygon (2), Rectangle (3)
 */
export declare class DitchEmpty {
    private view;
    private layerManager;
    private symbolLayer;
    private isLine;
    declaredClass: string;
    SID: string;
    symName: string;
    symGeometricType: string;
    isObstacle: string;
    private _lineSym;
    private _points;
    private _teethSize;
    private _teethGap;
    private _headRatio;
    private _tailRatio;
    private _geometryType;
    private _drawType;
    private amplifier;
    private _opacity;
    private isDrawing;
    private tempGraphic;
    private clickHandler;
    private doubleClickHandler;
    private mouseMoveHandler;
    private eventListeners;
    constructor(view: MapView | SceneView, isLine?: boolean);
    /**
     * Initialize the DCB drawing
     */
    init(options: DitchEmptyOptions, marker: SimpleLineSymbol): void;
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
     * Create DrawEssentials object with symbol parameters
     */
    private createDrawEssentials;
    /**
     * Create the ditch empty symbol geometry
     */
    private createSymbol;
    /**
     * Complete the drawing process
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
export default DitchEmpty;
