/**
 * Class Representing Withdraw.
 * @class
 * @author Abdul Razak
 */
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import DrawEssentials from "../Support/DrawEssentials";
export interface WithdrawOptions {
    ECHLON?: number;
    CTRL_PTS?: Point[];
    GEOM?: any;
}
/**
 * Class Representing Withdraw.
 * @class
 * @author Abdul Razak
 */
declare class Withdraw {
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
    private _echlon;
    private _onClk;
    private _onDblClk;
    private _onMM;
    private _tGraphic;
    private eventListeners;
    constructor(view: MapView | SceneView, isLine: boolean);
    emit(event: string, data: any): void;
    on(event: string, callback: Function): void;
    off(event: string, callback?: Function): void;
    init(options: WithdrawOptions, marker: any): void;
    private find_angle;
    private angleBetweenTwoPointsWithFixedPoint;
    private createDrawEssentials;
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
    private _circleDrawEx;
    private _determinantDrawEx;
    private CreateCircleSegmentFromThreePoints;
}
export default Withdraw;
