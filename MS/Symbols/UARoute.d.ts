/**
 * Class Representing Unmanned Aircraft (UA) Route.
 * @class
 * @author Abdul Razak
 */
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import DrawEssentials from "../Support/DrawEssentials";
export interface UARouteOptions {
    CTRL_PTS?: Point[];
    BASE_LN_PTS?: any;
    GEOM?: Polyline;
    [key: string]: any;
}
declare class UARoute {
    SID: string;
    symName: string;
    symGeometricType: string;
    private map;
    private isLine;
    private _tGraphic;
    private _lineSym;
    private _points;
    private _baseLinePts;
    private _geometryType;
    private _onClickHandler;
    private _onDoubleClickHandler;
    private _onPointerMoveHandler;
    private _onBaseLineEndHandler;
    private _onBaseLineProgressHandler;
    private _onBaseLineClickHandler;
    constructor(map: MapView | SceneView, isLine: boolean);
    init(options: UARouteOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void;
    createDrawEssentials(ctrlPts: Point[], baseLinePts: any): DrawEssentials;
    createSymbol(drawEssentials: DrawEssentials): Polyline | null;
    createACP(pt: Point, radius: number): number[][];
    getBaseLinePts(): Point[];
    private _setupEventHandlers;
    private _onClickHdler;
    private _onDoubleClickHdler;
    private cleanUp;
    private __drawEnd;
    private __onDrawEnd;
    private _clear;
    private _removeEvents;
    deactivate(): void;
    private _cloneArray;
    private emit;
}
export default UARoute;
