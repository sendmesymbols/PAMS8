/**
 * Class Representing Strong Point.
 * @class
 * @author Abdul Razak
 */
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import DrawEssentials from "../Support/DrawEssentials";
export interface StrongPointOptions {
    ECHELON?: any;
    DRAW_TYPE?: number;
    FACE_GAP?: number;
    CTRL_PTS?: Point[];
    GEOM?: any;
    [key: string]: any;
}
/**
 * Class Representing Strong Point.
 */
declare class StrongPoint {
    declaredClass: string;
    SID: string;
    symName: string;
    symGeometricType: string;
    private view;
    private isLine;
    private layerManager;
    private symbolLayer;
    private amplifier;
    private _lineSym;
    private _points;
    private _geometryType;
    private _echelon;
    private _drawType;
    private _face_gap;
    private _FACE_GAP_CONTS;
    private _FACE_GAP_CONTS_ELL;
    private _tGraphic;
    private clickHandler;
    private doubleClickHandler;
    private mouseMoveHandler;
    private events;
    constructor(view: MapView | SceneView, isLine?: boolean);
    init(options: StrongPointOptions, marker: any): void;
    private createDrawEssentials;
    private createStrongPts;
    createSymbol(drawEssentials: DrawEssentials): Polyline;
    private _onMMoveHdler;
    private _onClckHdler;
    private _onDblClkHandler;
    private cleanUp;
    private __drawEnd;
    private __onDrawEnd;
    private _clear;
    private _removeEvents;
    deactivate(): void;
    private createPolyFromObject;
    private getLastPtFromPoly;
    private getPolylineCenter;
    private CreateBezierPath;
    private binomialCoefficient;
    private getClosestPointOnLines2;
    private getClosestPointOnLines;
    private createSymbolByLine;
    private createSymbolByCloseLine;
    private createSymbolByPerfectEllipse;
    emit(event: string, data: any): void;
    on(event: string, callback: (data: any) => void): void;
    off(event: string, callback?: (data: any) => void): void;
    getSymbolLayer(): GraphicsLayer;
    clearSymbols(): void;
}
export default StrongPoint;
