/**
 * Class Representing Supporting Attack.
 *
 * @class
 * @author Abdul Razak
 */
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import DrawEssentials from "../Support/DrawEssentials";
export interface SupportingAttackOptions {
    HEAD_RATIO?: number;
    TAIL_FACTOR?: number;
    CTRL_PTS?: Point[];
    GEOM?: any;
}
/**
 * Class Representing Supporting Attack.
 * @class
 * @author Abdul Razak
 */
declare class SupportingAttack {
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
    private _onClk;
    private _onDblClk;
    private _onMM;
    private _tGraphic;
    private _tailFactor;
    private _headPercentage;
    private eventListeners;
    constructor(view: MapView | SceneView, isLine: boolean);
    emit(event: string, data: any): void;
    on(event: string, callback: Function): void;
    off(event: string, callback?: Function): void;
    init(options: SupportingAttackOptions, marker: any): void;
    private createDrawEssentials;
    createSymbol(drawEssentials: DrawEssentials): Polygon;
    getBaseLinePts(): any;
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
    private CreateArrowHeadPathEx;
}
export default SupportingAttack;
