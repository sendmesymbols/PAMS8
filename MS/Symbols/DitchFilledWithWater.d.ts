/**
 * Class Representing Ditch Filled With Water.
 * @class
 * @author Abdul Razak
 */
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import Evented from "@arcgis/core/core/Evented";
type ViewType = MapView | SceneView;
interface DitchFilledWithWaterOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    TEETH_SIZE?: number;
    TEETH_GAP?: number;
    opacity?: number;
}
export default class DitchFilledWithWater extends Evented {
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
    private _teethSize;
    private _teethGap;
    private _headRatio;
    private _tailRatio;
    private _opacity;
    private _tGraphic;
    private _onClk;
    private _onDblClk;
    private _onMM;
    constructor(view: ViewType, isLine: boolean);
    init(options: DitchFilledWithWaterOptions, marker: any): void;
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
