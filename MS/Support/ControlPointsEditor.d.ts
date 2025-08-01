import { Evented } from "dojo/Evented";
import { Graphic as _Graphic } from "esri/graphic";
import { GraphicsLayer } from "esri/layers/GraphicsLayer";
interface ControlPoint {
    x: number;
    y: number;
    spatialReference?: any;
}
interface DrawEssentials {
    CTRL_PTS?: ControlPoint[];
    BASE_LN_PTS?: {
        startPt?: ControlPoint;
        endPt?: ControlPoint;
        midPt?: ControlPoint;
    };
    DRAW_TYPE?: string;
    AMPLIFIER?: any;
}
interface Graphic extends _Graphic {
    drawEssentials: DrawEssentials;
    attributes: any;
    symbol: any;
    geometry: any;
    getDojoShape(): any;
    getLayer(): any;
    setGeometry(geometry: any): void;
    setSymbol(symbol: any): void;
}
interface Map {
    spatialReference: any;
    toScreen(point: any, useOffset?: boolean): any;
    toMap(point: any): any;
    addLayer(layer: any, index?: number): void;
    getLayer(id: string): any;
}
interface EditToolbar {
    _geo?: boolean;
    _endOperation(operation: string): void;
    activate(mode: number, graphic?: Graphic, options?: any): void;
    deactivate(): void;
    on(event: string, handler: Function): any;
    _scratchGL: GraphicsLayer;
    _boxEditor: any;
}
export declare class ControlPointsEditor extends Evented {
    private _cpAnchors;
    private _toolbar;
    private _scale;
    private _rotate;
    private _defaultEventArgs;
    private _scaleEvent;
    private _rotateEvent;
    private _uniformScaling;
    private map;
    private cPoints;
    private _markerSymbol2;
    private _markerSymbol;
    private _controlSymbol;
    private _lineSymbol;
    private _moveStartHandler;
    private _firstMoveHandler;
    private _moveStopHandler;
    private _moveHandler;
    private _scaleStopHandler;
    private _scratchGL;
    private _baseLinePts;
    private _graphic;
    private _controlPoints;
    private _drawExtendType;
    private _box;
    private _anchors;
    private _connects;
    private _startTx;
    private _wrapOffset;
    private _centerCoord;
    private _startLine;
    private _moveLine;
    private _startBox;
    private _moveBox;
    private _xfactor;
    private _yfactor;
    private _firstMoverToCenter;
    private _cpScreen;
    private _moved;
    constructor(map: Map, graphicLayer: GraphicsLayer, toolbar: EditToolbar, cPoints: ControlPoint[]);
    private _scaleStop;
    private _move;
    private _setUp;
    private _scaleRotateMove;
    private _onGraphicMove;
    private _setGraphic;
    activate(graphic: Graphic): void;
    private _draw;
    private _getBoxCoords;
    private _getTransformedBoundingBox;
    private _getMoveable;
    private _moveStartHandler;
    private _firstMoveHandler;
    private _moveHandler;
    private _moveStopHandler;
    private _updateSegments;
    private _updateControlPt;
    private _updateControlPoints;
    private _getAngle;
    private _init;
    deactivate(graphicLayer: GraphicsLayer): void;
    private _cleanUp;
    private _removeEvents;
}
export {};
