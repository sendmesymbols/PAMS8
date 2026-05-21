import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
export interface MovingConvoyOptions {
    CTRL_PTS?: Point[];
    BASE_LN_PTS?: {
        startPt: Point;
        endPt: Point;
    };
    GEOM?: Polyline;
    [key: string]: any;
}
/**
 * MovingConvoy class for drawing Moving Convoy / Approach tactical symbols
 */
export declare class MovingConvoy {
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
    private _baseLinePts;
    private _geometryType;
    private amplifier;
    private isDrawing;
    private tempGraphic;
    private clickHandler;
    private doubleClickHandler;
    private mouseMoveHandler;
    private baseLineEndHandler;
    private baseLineProgressHandler;
    private baseLineClickHandler;
    private events;
    constructor(view: MapView | SceneView, isLine?: boolean);
    /**
     * Initialize the Moving Convoy drawing
     */
    init(options: MovingConvoyOptions, marker: SimpleLineSymbol): void;
    private startBaseLineDrawing;
    private baseLineClick;
    private baseLineDrawProgress;
    private baseLineDrawEnd;
    private setupControlPointHandlers;
    private _onClickHandler;
    private _onDoubleClickHandler;
    private _onMouseMoveHandler;
    private createDrawEssentials;
    private createSymbol;
    private getFlankPts;
    getBaseLinePts(): any;
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
export default MovingConvoy;
