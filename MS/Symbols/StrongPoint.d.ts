/**
 * Class Representing Strong Point.
 * @class
 * @author Abdul Razak
 */
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import DrawEssentials from "../Support/DrawEssentials";
export interface StrongPointOptions {
    ECHELON?: number;
    DRAW_TYPE?: number;
    FACE_GAP?: number;
    CTRL_PTS?: Point[];
    GEOM?: any;
}
/**
 * Class Representing Strong Point.
 * @class
 * @author Abdul Razak
 */
declare class StrongPoint {
    declaredClass: string;
    SID: string;
    symName: string;
    symGeometricType: string;
    private view;
    private isLine;
    private _lineSym;
    private _points;
    private _geometryType;
    private _arrowHeadRatio;
    private _echelon;
    private _drawType;
    private _face_gap;
    private _FACE_GAP_CONTS;
    private _FACE_GAP_CONTS_ELL;
    private _onClk;
    private _onDblClk;
    private _onMM;
    private _tGraphic;
    private eventListeners;
    constructor(view: MapView | SceneView, isLine: boolean);
    emit(event: string, data: any): void;
    on(event: string, callback: Function): void;
    off(event: string, callback?: Function): void;
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
    private _onDrawComplete;
    private CreateBezierPath;
    private binomialCoefficient;
    private getClosestPointOnLines2;
    private getClosestPointOnLines;
    private getPolylineCenter;
    private createSymbolByLine;
    private createSymbolByCloseLine;
    private createSymbolByPerfectEllipse;
}
export default StrongPoint;
