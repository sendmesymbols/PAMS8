import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
export interface FwdAssemblyAreaOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    DRAW_TYPE?: number;
    [key: string]: any;
}
/**
 * FwdAssemblyArea class for drawing Forward Assembly Area symbols
 * Supports multiple drawing types: Bezier curve (1), Polygon (2), Rectangle (3)
 * Includes inner text markers using createFAA method
 */
export declare class FwdAssemblyArea {
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
    private _drawType;
    private amplifier;
    private isDrawing;
    private tempGraphic;
    private clickHandler;
    private doubleClickHandler;
    private mouseMoveHandler;
    private events;
    constructor(view: MapView | SceneView, isLine?: boolean);
    /**
     * Initialize the forward assembly area drawing
     */
    init(options: FwdAssemblyAreaOptions, marker: SimpleLineSymbol): void;
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
     * Create inner text markers for Forward Assembly Area
     */
    private createInnerText;
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
export default FwdAssemblyArea;
