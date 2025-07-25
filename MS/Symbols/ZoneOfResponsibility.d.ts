/**
 * Class Representing Zone of Responsibility.
 * @class
 * @author Abdul Razak
 */
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import DrawEssentials from "../Support/DrawEssentials";
export interface ZoneOfResponsibilityOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    DRAW_TYPE?: number;
    [key: string]: any;
}
declare class ZoneOfResponsibility {
    SID: string;
    symName: string;
    symGeometricType: string;
    private map;
    private isLine;
    private _tGraphic;
    private _lineSym;
    private _points;
    private _geometryType;
    private _drawType;
    private _onClickHandler;
    private _onDoubleClickHandler;
    private _onPointerMoveHandler;
    constructor(map: MapView | SceneView, isLine: boolean);
    init(options: ZoneOfResponsibilityOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void;
    createDrawEssentials(ctrlPts: Point[], drawType: number): DrawEssentials;
    createSymbol(drawEssentials: DrawEssentials): Polygon | null;
    private CreateBezierPath;
    private createInnerText;
    private createSymbolByBCurve;
    private createSymbolByPolygon;
    private createSymbolByRect;
    private _setupEventHandlers;
    private _onPointerMoveHdler;
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
export default ZoneOfResponsibility;
