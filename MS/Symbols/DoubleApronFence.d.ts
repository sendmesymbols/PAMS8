/**
 * Class Representing Double Apron Fence.
 * @class
 * @author Abdul Razak
 */
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Evented from "@arcgis/core/core/Evented";
type ViewType = MapView | SceneView;
interface DoubleApronFenceOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polyline;
}
export default class DoubleApronFence extends Evented {
    declaredClass: string;
    SID: string;
    symName: string;
    symGeometricType: string;
    isObstacle: string;
    private view;
    private isLine;
    private _lineSym;
    private _points;
    private _geometryType;
    private _tGraphic;
    private _onClk;
    private _onDblClk;
    private _onMM;
    constructor(view: ViewType, isLine: boolean);
    init(options: DoubleApronFenceOptions, marker: any): void;
    private _setupEventHandlers;
    private createDrawEssentials;
    private createSymbol;
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
