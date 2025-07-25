import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
export interface BaseLineOptions {
    letter?: string;
    [key: string]: any;
}
/**
 * BaseLine class for creating baseline drawing functionality
 * Supports interactive baseline creation with various letter modifiers
 */
export declare class BaseLine {
    private view;
    private _lineSymbol;
    private _points;
    private _geometryType;
    private candidatePoint;
    private letter?;
    private _tGraphic;
    private _onClick;
    private _onMouseMove;
    private eventListeners;
    constructor(view: MapView | SceneView, lineSymbol: SimpleLineSymbol);
    /**
     * Initialize the baseline drawing
     */
    init(letter?: string): void;
    /**
     * Handle click events
     */
    private _onClickHandler;
    /**
     * Handle mouse move events (standard baseline)
     */
    private _onMouseMoveHandler;
    /**
     * Handle mouse move events with letter modifier (C, CC, B)
     */
    private _onMouseMoveHandlerC;
    /**
     * Create C shape modifier
     */
    private _createC;
    /**
     * Create CC shape modifier
     */
    private _createCC;
    /**
     * Create B shape modifier
     */
    private _createB;
    /**
     * Create baseline between two points
     */
    private _baseLine;
    /**
     * Emit progress event
     */
    private emitProgress;
    /**
     * Emit click event
     */
    private emitClick;
    /**
     * Handle drawing completion
     */
    private _drawEnd;
    /**
     * Handle draw end event
     */
    private onDrawEnd;
    /**
     * Clean up graphics and state
     */
    private _clear;
    /**
     * Remove event handlers
     */
    private _removeEvents;
    /**
     * Deactivate the baseline tool
     */
    deactivate(): void;
    /**
     * Event emitter functionality
     */
    private emit;
    on(eventName: string, callback: Function): void;
    off(eventName: string, callback?: Function): void;
}
export default BaseLine;
