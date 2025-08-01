/**
 * Class Representing Funnel.
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
interface FunnelOptions {
    CTRL_PTS?: Point[];
    BASE_LN_PTS?: any;
    GEOM?: Polyline;
    FRNT_LN_ANGL_RATIO?: number;
    FRNT_LN_DIST_RATIO?: number;
    FLAP_DIST_RATIO?: number;
}
export default class Funnel extends Evented {
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
    private frontLineAgle;
    private frontLineDist;
    private flapDist;
    private _tGraphic;
    private _onClk;
    private _onDblClk;
    private _onMM;
    private _onBaseLineEnd;
    private _onBaseLineProgress;
    private _onBaseLineClick;
    constructor(view: ViewType, isLine: boolean);
    init(options: FunnelOptions, marker: any): void;
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
