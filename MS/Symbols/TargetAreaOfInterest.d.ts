/**
 * Class Representing Target Area of Interest.
 * @class
 * @author Abdul Razak
 */
import Point from '@arcgis/core/geometry/Point';
import Polygon from '@arcgis/core/geometry/Polygon';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import DrawEssentials from "../Support/DrawEssentials";
declare class TargetAreaOfInterest {
    declaredClass: string;
    SID: string;
    symName: string;
    symGeometricType: string;
    private map;
    private isLine;
    private _lineSym;
    private _points;
    private _geometryType;
    private _drawType;
    private _tGraphic;
    private _onClk;
    private _onDblClk;
    private _onMM;
    constructor(map: MapView | SceneView, isLine: boolean);
    init(options: any, marker: any): void;
    createDrawEssentials(ctrlPts: Point[], drawType: number): DrawEssentials;
    createSymbol(drawEssentials: DrawEssentials): Polygon | null;
    private _onMMoveHdler;
    private _onClckHdler;
    private _onDblClkHandler;
    private cleanUp;
    private __drawEnd;
    private __onDrawEnd;
    private _clear;
    private _removeEvents;
    deactivate(): void;
    private CreateBezierPath;
    private createInnerText;
    private createSymbolByBCurve;
    private createSymbolByPolygon;
    private createSymbolByRect;
    private cloneArray;
    private emit;
}
export default TargetAreaOfInterest;
