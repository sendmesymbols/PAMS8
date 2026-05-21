import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
export interface MultiHeadMainAttackOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    HEADER_CTRL_PTS?: Point[][];
    HEAD_RATIO?: number;
    TAIL_FACTOR?: number;
    [key: string]: any;
}
export interface ArrowHeadResult {
    rings: Array<{
        x: number;
        y: number;
    }>;
    midPtLeft: {
        x: number;
        y: number;
    };
    midPtRight: {
        x: number;
        y: number;
    };
    newCandiadatePt: {
        x: number;
        y: number;
    };
}
export declare class MultiHeadMainAttack {
    private view;
    private layerManager;
    private symbolLayer;
    private isLine;
    private SID;
    private symName;
    private symGeometricType;
    private _lineSym;
    private _geometryType;
    private amplifier;
    private _tailFactor;
    private _headPercentage;
    private _arrowHeadRatio;
    private _points;
    private _headerCollection;
    private _newHead;
    private _savedHeadPoints;
    private isDrawing;
    private tempGraphic;
    private clickHandler;
    private doubleClickHandler;
    private mouseMoveHandler;
    private events;
    constructor(view: MapView | SceneView, isLine?: boolean);
    init(options: MultiHeadMainAttackOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void;
    deactivate(): void;
    getSymbolLayer(): GraphicsLayer;
    clearSymbols(): void;
    private _startInteractiveDrawing;
    private _bindEvents;
    private _onClick;
    private _onDoubleClick;
    private _onMouseMove;
    private _updateCollection;
    private _refreshDisplay;
    private _finalizeAndEmit;
    private _computeHeadGeom;
    private _buildMergedFromPointArrays;
    private _unionPolys;
    private _createSimpleArrow;
    private _createComplexArrow;
    private _createArrowHeadPath;
    private _makeDrawEssentials;
    private __drawEnd;
    private _clearState;
    private _removeEvents;
    on(eventName: string, callback: (data: any) => void): void;
    off(eventName: string, callback?: (data: any) => void): void;
}
export default MultiHeadMainAttack;
