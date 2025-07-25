/**
 * Class Representing Triple Strand Concertina.
 * @class
 * @author Abdul Razak
 */
import Point from '@arcgis/core/geometry/Point';
import Polyline from '@arcgis/core/geometry/Polyline';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import DrawEssentials from "../Support/DrawEssentials";
declare class TripleStrandConcertina {
    declaredClass: string;
    SID: string;
    symName: string;
    symGeometricType: string;
    isObstacle: string;
    private map;
    private isLine;
    private _lineSym;
    private _points;
    private _geometryType;
    private _tGraphic;
    private _onClk;
    private _onDblClk;
    private _onMM;
    constructor(map: MapView | SceneView, isLine: boolean);
    init(options: any, marker: any): void;
    createDrawEssentials(ctrlPts: Point[]): DrawEssentials;
    createSymbol(drawEssentials: DrawEssentials): Polyline | null;
    private _onMMoveHdler;
    private _onClckHdler;
    private _onDblClkHandler;
    private cleanUp;
    private __drawEnd;
    private __onDrawEnd;
    private _clear;
    private _removeEvents;
    deactivate(): void;
    private cloneArray;
    private emit;
}
export default TripleStrandConcertina;
