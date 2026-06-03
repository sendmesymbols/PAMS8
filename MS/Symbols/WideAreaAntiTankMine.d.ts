import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
export interface WideAreaAntiTankMineOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    DRAW_TYPE?: number;
    opacity?: number;
    [key: string]: any;
}
/**
 * WideAreaAntiTankMine class for drawing Wide Area Antitank Mine symbols
 * Supports multiple drawing types: Bezier curve (1), Polygon (2), Rectangle (3)
 */
export declare class WideAreaAntiTankMine {
    private view;
    private layerManager;
    private symbolLayer;
    private isLine;
    SID: string;
    symName: string;
    symGeometricType: string;
    isObstacle: string;
    private _lineSym;
    private _textureMetadata;
    private _points;
    private _geometryType;
    private _drawType;
    private _opacity;
    private amplifier;
    private isDrawing;
    private tempGraphic;
    private clickHandler;
    private doubleClickHandler;
    private mouseMoveHandler;
    private events;
    constructor(view: MapView | SceneView, isLine?: boolean);
    /**
     * Initialize the mine symbol drawing
     */
    init(options: WideAreaAntiTankMineOptions, marker: SimpleLineSymbol): void;
    private getImagePath;
    private startInteractiveDrawing;
    private setupEventHandlers;
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
export default WideAreaAntiTankMine;
