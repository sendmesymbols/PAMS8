/**
 * Class Representing Vital Gr.
 * @class
 * @author Abdul Razak
 */
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import DrawEssentials from "../Support/DrawEssentials";
export interface VitalGrOptions {
    DRAW_TYPE?: number;
    CTRL_PTS?: Point[];
    GEOM?: any;
}
/**
 * Class Representing Vital Gr.
 * @class
 * @author Abdul Razak
 */
declare class VitalGr {
    declaredClass: string;
    SID: string;
    symName: string;
    symGeometricType: string;
    private view;
    private isLine;
    private _lineSym;
    private _points;
    private _geometryType;
    private _drawType;
    private _onClk;
    private _onDblClk;
    private _onMM;
    private _tGraphic;
    private eventListeners;
    constructor(view: MapView | SceneView, isLine: boolean);
    emit(event: string, data: any): void;
    on(event: string, callback: Function): void;
    off(event: string, callback?: Function): void;
    init(options: VitalGrOptions, marker: any): void;
    private createDrawEssentials;
    createSymbol(drawEssentials: DrawEssentials): Polygon;
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
    private createInnerText;
    private createSymbolByBCurve;
    private createSymbolByPolygon;
    private createSymbolByRect;
}
export default VitalGr;
