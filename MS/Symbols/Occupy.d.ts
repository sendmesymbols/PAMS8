import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
export interface OccupyOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polyline;
    ECHLON?: number;
    [key: string]: any;
}
/**
 * Class Representing Occupy.
 * Direct click drawing (up to 3 points) with arc, "O" marker, and caret wings.
 */
export declare class Occupy {
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
    private _echlon;
    private amplifier;
    private isDrawing;
    private tempGraphic;
    private clickHandler;
    private doubleClickHandler;
    private mouseMoveHandler;
    private events;
    constructor(view: MapView | SceneView, isLine?: boolean);
    /**
     * Initialize the Occupy drawing
     */
    init(options: OccupyOptions, marker: SimpleLineSymbol): void;
    private startInteractiveDrawing;
    private _onClickHandler;
    private _onDoubleClickHandler;
    private _onMouseMoveHandler;
    private createDrawEssentials;
    private createSymbol;
    private cleanUp;
    private __drawEnd;
    private __onDrawEnd;
    private _clear;
    private _removeEvents;
    deactivate(): void;
    on(eventName: string, callback: (data: any) => void): void;
    off(eventName: string, callback?: (data: any) => void): void;
    getSymbolLayer(): GraphicsLayer;
    clearSymbols(): void;
}
export default Occupy;
