/**
 * Class Representing Infiltration Lane.
 *
 * @class
 * @author Abdul Razak
 */
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Evented from "@arcgis/core/core/Evented";
type ViewType = MapView | SceneView;
interface InfiltrationLaneOptions {
    CTRL_PTS?: Point[];
    BASE_LN_PTS?: any;
    GEOM?: Polyline;
}
export default class InfiltrationLane extends Evented {
    declaredClass: string;
    SID: string;
    symName: string;
    symGeometricType: string;
    private view;
    private isLine;
    private _lineSym;
    private _points;
    private _baseLinePts;
    private _geometryType;
    private _tGraphic;
    private _onClk;
    private _onDblClk;
    private _onMM;
    private _onBaseLineEnd;
    private _onBaseLineProgress;
    private _onBaseLineClick;
    constructor(view: ViewType, isLine: boolean);
    init(options: InfiltrationLaneOptions, marker: any): void;
    private createDrawEssentials;
    private baseLineDrawEnd;
    private _setupMainEventHandlers;
    private baseLineDrawProgress;
    private baseLineClick;
    private createSymbol;
    getBaseLinePts(): any;
    private _onMouseMoveHandler;
    private _onClickHandler;
    private _onDoubleClickHandler;
    private cleanUp;
    private __drawEnd;
    private __onDrawEnd;
    private _clear;
    private _removeEvents;
    deactivate(): void;
}
export {};
