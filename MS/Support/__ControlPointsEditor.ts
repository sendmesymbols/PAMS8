import { Evented } from "dojo/Evented";
import { Color } from "dojo/_base/Color";
import { lang } from "dojo/_base/lang";
import { array } from "dojo/_base/array";
import { connect } from "dojo/_base/connect";
import { window } from "dojo/_base/window";
import { has } from "dojo/has";
import { keys } from "dojo/keys";
import { domConstruct } from "dojo/dom-construct";
import { domStyle } from "dojo/dom-style";
import { kernel as esriKernel } from "esri/kernel";
import { sniff as esriSniff } from "esri/sniff";
import { _toolbar as Toolbar } from "esri/toolbars/_toolbar";
import { SimpleMarkerSymbol } from "esri/symbols/SimpleMarkerSymbol";
import { SimpleLineSymbol } from "esri/symbols/SimpleLineSymbol";
import { SimpleFillSymbol } from "esri/symbols/SimpleFillSymbol";
import { Graphic as _Graphic } from "esri/graphic";
import { jsonUtils as jsonUtility } from "esri/geometry/jsonUtils";
import { webMercatorUtils } from "esri/geometry/webMercatorUtils";
import { Polyline as _Polyline } from "esri/geometry/Polyline";
import { Polygon as _Polygon } from "esri/geometry/Polygon";
import { Multipoint } from "esri/geometry/Multipoint";
import { Rect } from "esri/geometry/Rect";
import { on } from "dojo/on";
import { GraphicsLayer } from "esri/layers/GraphicsLayer";
import { SnappingManager } from "esri/SnappingManager";
import { Point } from "esri/geometry/Point";
import { Moveable } from "dojox/gfx/Moveable";
import { matrix } from "dojox/gfx/matrix";
import { lang as esriLang } from "esri/lang";
import { jsonUtils as geometryJsonUtils } from "esri/geometry/jsonUtils";
import { json } from "dojo/_base/json";
import { GeoTools } from "./GeoTools";

// Interfaces
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

interface Anchor {
    graphic: Graphic;
    moveable: Moveable;
}

interface MoveableEvent {
    host: {
        _index: number;
        controlPointIndex?: number;
        _control?: boolean;
        shape: any;
    };
    dx: number;
    dy: number;
}

interface Transform {
    dx: number;
    dy: number;
}

interface ScreenPoint {
    x: number;
    y: number;
}

interface BoxCoords {
    x: number;
    y: number;
    width?: number;
    height?: number;
}

interface EventArgs {
    angle?: number;
    scaleX?: number;
    scaleY?: number;
    transform?: any;
    around?: any;
}

export class ControlPointsEditor extends Evented {
    private _cpAnchors: Anchor[];
    private _toolbar: EditToolbar;
    private _scale: boolean;
    private _rotate: boolean;
    private _defaultEventArgs: EventArgs;
    private _scaleEvent: string;
    private _rotateEvent: string;
    private _uniformScaling: boolean;
    private map: Map;
    private cPoints: ControlPoint[];
    private _markerSymbol2: SimpleMarkerSymbol;
    private _markerSymbol: SimpleMarkerSymbol;
    private _controlSymbol: SimpleMarkerSymbol;
    private _lineSymbol: SimpleLineSymbol;
    private _moveStartHandler: Function;
    private _firstMoveHandler: Function;
    private _moveStopHandler: Function;
    private _moveHandler: Function;
    private _scaleStopHandler: Function;
    private _scratchGL: GraphicsLayer;
    private _baseLinePts: ControlPoint[];
    private _graphic: Graphic;
    private _controlPoints: ControlPoint[];
    private _drawExtendType: string;
    private _box: _Graphic;
    private _anchors: Anchor[];
    private _connects: any[];
    private _startTx: any;
    private _wrapOffset: number;
    private _centerCoord: any;
    private _startLine: any[];
    private _moveLine: any[];
    private _startBox: BoxCoords;
    private _moveBox: BoxCoords;
    private _xfactor: number;
    private _yfactor: number;
    private _firstMoverToCenter: number;
    private _cpScreen: ScreenPoint[];
    private _moved: boolean;

    constructor(map: Map, graphicLayer: GraphicsLayer, toolbar: EditToolbar, cPoints: ControlPoint[]) {
        super();
        
        this._cpAnchors = [];
        this._toolbar = toolbar;
        this._scale = true;
        this._rotate = true;
        this._defaultEventArgs = {};
        this._scaleEvent = "Scale";
        this._rotateEvent = "Rotate";
        this._uniformScaling = true;
        this.map = map;
        this.cPoints = cPoints;

        this._markerSymbol2 = new SimpleMarkerSymbol(
            SimpleMarkerSymbol.STYLE_CROSS, 
            15, 
            new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new Color([0, 0, 0]), 2), 
            new Color([255, 0, 255, 0.25])
        );
        
        this._markerSymbol = new SimpleMarkerSymbol(
            SimpleMarkerSymbol.STYLE_CIRCLE, 
            13, 
            new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new Color([0, 0, 0]), 2), 
            new Color([255, 255, 255, 0.25])
        );
        
        this._controlSymbol = new SimpleMarkerSymbol(
            SimpleMarkerSymbol.STYLE_CIRCLE, 
            13, 
            new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new Color([0, 0, 0]), 2), 
            new Color([255, 0, 0, 1])
        );
        
        this._lineSymbol = new SimpleLineSymbol(SimpleLineSymbol.STYLE_DASH, new Color([64, 64, 64]), 1);

        this._moveStartHandler = lang.hitch(this, this._moveStartHandler);
        this._firstMoveHandler = lang.hitch(this, this._firstMoveHandler);
        this._moveStopHandler = lang.hitch(this, this._moveStopHandler);
        this._moveHandler = lang.hitch(this, this._moveHandler);
        this._scaleStopHandler = lang.hitch(this, this._scaleStop);

        this._defaultEventArgs = {};
        this._scratchGL = graphicLayer;
        this._baseLinePts = [];
    }

    private _scaleStop(event: any, qthis: any): void {}

    private _move(evt: any): void {
        const a = evt.graphic;
        this._startTx = a.getDojoShape().getTransform();
        const graphic = this._graphic;
        const editToolbar = this._toolbar;
        const geometry = editToolbar._geo ? webMercatorUtils.geographicToWebMercator(evt.graphic.geometry) : evt.graphic.geometry;
        const geometryType = geometry.type;
        const graphicDojoShape = graphic.getDojoShape();
        const graphicTransform = graphicDojoShape.getTransform();
        
        if (evt.transform) {
            array.forEach(this._graphic.drawEssentials.controlPoints, (item: ControlPoint, index: number) => {
                const a = this._updateControlPt(this._graphic.geometry, item, graphicTransform);
                this._graphic.drawEssentials.controlPoints[index].update(a.x, a.y);
                console.log(this._graphic.drawEssentials.controlPoints[index]);
                GeoTools.displayPoint(evt.target._map, this._graphic.drawEssentials.controlPoints[index]);
            }, this);
        }
    }

    private _setUp(evt: any): void {
        this._graphic = (this._graphic == undefined) ? this._setGraphic(evt.graphic) : this._graphic;
    }

    private _scaleRotateMove(evt: any, callbk?: Function): void {
        let f: Point;
        const tempCpoints: Point[] = [];
        
        for (const index in this._controlPoints) {
            const geometry = this._controlPoints[index];
            f = this._updateControlPoints(geometry, this._graphic.getDojoShape().getTransform(), this._graphic.getLayer()._div.getTransform());
            tempCpoints[index] = new Point(f.x, f.y, this.map.spatialReference);
        }

        this._graphic.attributes.tempCpoints = tempCpoints;
        this._graphic.drawEssentials.DRAW_TYPE = this._drawExtendType;

        // Base Line Points
        const tempBpoints: Point[] = [];

        if (this._graphic.drawEssentials.hasOwnProperty("BASE_LN_PTS")) {
            for (const index in this._baseLinePts) {
                const geometry = this._baseLinePts[index];
                f = this._updateControlPoints(geometry, this._graphic.getDojoShape().getTransform(), this._graphic.getLayer()._div.getTransform());
                tempBpoints[index] = new Point(f.x, f.y, this.map.spatialReference);
            }

            this._graphic.attributes.tempBpoints = tempBpoints;
        }
    }

    private _onGraphicMove(a: any, b: any): void {}

    private _setGraphic(graphic: Graphic): void {
        this._graphic = graphic;

        if (graphic.drawEssentials.CTRL_PTS) this._controlPoints = graphic.drawEssentials.CTRL_PTS;
        if (graphic.drawEssentials.BASE_LN_PTS) this._baseLinePts = graphic.drawEssentials.BASE_LN_PTS;
        if (graphic.drawEssentials.DRAW_TYPE) this._drawExtendType = graphic.drawEssentials.DRAW_TYPE;
    }

    activate(graphic: Graphic): void {
        this._setGraphic(graphic);
        this.emit("cpActivate", {
            "state": 1,
            "graphic": this._graphic
        });
        this._init();
    }

    private _draw(): void {
        if (this._graphic.getDojoShape()) {
            this._graphic.getDojoShape().moveToFront();
            const boxCoords = this._getBoxCoords(null, this.map);
            const polyLine = new _Polyline(this.map.spatialReference);
            const filteredBoxCoords = lang.clone(array.filter(boxCoords, (item: any, index: number) => {
                return 8 !== index && 0 === index % 2;
            }));
            
            if (filteredBoxCoords[0]) {
                filteredBoxCoords.push([filteredBoxCoords[0][0], filteredBoxCoords[0][1]]);
            }
            
            polyLine.addPath(filteredBoxCoords);
            if (this._rotate) polyLine.addPath([boxCoords[1], boxCoords[8]]);
            
            if (this._box) {
                this._box.setGeometry(polyLine);
            } else {
                this._box = new _Graphic(polyLine, this._lineSymbol);
                this._scratchGL.add(this._box);
            }

            if (this._controlPoints) {
                if (this._cpAnchors) {
                    array.forEach(this._cpAnchors, (item: Anchor, index: number) => {
                        const pt = new Point(this._cpAnchors[index].graphic.geometry, this.map.spatialReference);
                        item.graphic.controlPoints = true;
                        item.graphic.setGeometry(pt);
                        const itemMoveable = item.moveable;
                        const itemDojoShape = item.graphic.getDojoShape();
                        
                        if (itemDojoShape) {
                            if (itemMoveable) {
                                if (itemDojoShape !== itemMoveable.shape) {
                                    itemMoveable.destroy();
                                    item.moveable = this._getMoveable(item.graphic, index, true, index);
                                }
                            } else {
                                item.moveable = this._getMoveable(item.graphic, index, true, index);
                            }
                        }
                    }, this);
                } else {
                    this._cpAnchors = [];
                    this._connects = [];
                    array.forEach(this._controlPoints, (item: ControlPoint, index: number) => {
                        const point = new Point(item, this.map.spatialReference);
                        const d = new _Graphic(point, this._controlSymbol);
                        d.controlPoints = true;
                        this._scratchGL.add(d);
                        this._cpAnchors.push({
                            graphic: d,
                            moveable: this._getMoveable(d, index, true, index)
                        });
                    }, this);
                }
            }
        }
    }

    private _getBoxCoords(useScreen: boolean | null, map: Map): any[] {
        const screenBoundingBox = this._getTransformedBoundingBox(this._graphic);
        const a: any[] = [];
        let currentItem: any, nextItem: any, middle: any;
        
        array.forEach(screenBoundingBox, (item: any, index: number, arr: any[]) => {
            currentItem = item;
            nextItem = arr[index + 1] || arr[0];
            middle = {
                x: (currentItem.x + nextItem.x) / 2,
                y: (currentItem.y + nextItem.y) / 2
            };
            
            if (!useScreen) {
                currentItem = map.toMap(currentItem);
                middle = map.toMap(middle);
            }
            
            a.push([currentItem.x, currentItem.y]);
            a.push([middle.x, middle.y]);
        });
        
        // Add rotate handle graphic
        if (this._rotate) {
            const screenBoundingBoxClone = lang.clone(a[1]);
            const screenBoundingBoxPoint = useScreen ? {
                x: screenBoundingBoxClone[0],
                y: screenBoundingBoxClone[1]
            } : this.map.toScreen({
                x: screenBoundingBoxClone[0],
                y: screenBoundingBoxClone[1],
                spatialReference: this.map.spatialReference
            });
            
            screenBoundingBoxPoint.y -= 30;
            if (!useScreen) {
                const mapPoint = this.map.toMap(screenBoundingBoxPoint);
                a.push([mapPoint.x, mapPoint.y]);
            }
        }
        
        return a;
    }

    private _getTransformedBoundingBox(graphic: Graphic): any[] {
        const extent = graphic.geometry.getExtent();
        const spatialReference = graphic.geometry.spatialReference;
        const upLeftPt = new Point(extent.xmin, extent.ymax, spatialReference);
        const downRightPt = new Point(extent.xmax, extent.ymin, spatialReference);
        const upLeftScreen = this.map.toScreen(upLeftPt);
        const downRightScreen = this.map.toScreen(downRightPt);
        
        return [{
            x: upLeftScreen.x,
            y: upLeftScreen.y
        }, {
            x: downRightScreen.x,
            y: upLeftScreen.y
        }, {
            x: downRightScreen.x,
            y: downRightScreen.y
        }, {
            x: upLeftScreen.x,
            y: downRightScreen.y
        }];
    }

    private _getMoveable(graphic: Graphic, index: number, controlMovable?: boolean, controlPointIndex?: number): Moveable {
        const dojoShape = graphic.getDojoShape();
        if (dojoShape) {
            const moveAble = new Moveable(dojoShape);
            moveAble._index = index;
            moveAble.controlPointIndex = controlPointIndex;
            moveAble._control = controlMovable;

            moveAble.onMoveStart = lang.hitch(this, this._moveStartHandler);
            moveAble.onFirstMove = lang.hitch(this, this._firstMoveHandler);
            moveAble.onMoveStop = lang.hitch(this, this._moveStopHandler);
            moveAble.onMove = lang.hitch(this, this._moveHandler);

            return moveAble;
        }
        return null;
    }

    private _moveStartHandler(b: any): void {}

    private _firstMoveHandler(b: MoveableEvent): void {
        const index = b.host._index;
        const offset = this._wrapOffset = b.host.shape._wrapOffsets[0] || 0;
        const transform = this._graphic.getLayer()._div.getTransform();
        let middeScreen: any;
        
        const screenBbox = array.map(this._getBoxCoords(true), (a: any) => {
            return {
                x: a[0] + offset,
                y: a[1]
            };
        });
        
        middeScreen = {
            x: screenBbox[1].x,
            y: screenBbox[3].y
        };
        
        this._centerCoord = matrix.multiplyPoint(matrix.invert(transform), middeScreen);

        if (this._controlPoints) {
            this._cpScreen = [];
            array.forEach(this._controlPoints, (item: ControlPoint, index: number) => {
                this._cpScreen.push(this.map.toScreen(item));
            }, this);
        }
    }

    private _moveHandler(b: MoveableEvent, inputPt: any): void {
        const index = b.host._index;
        const eventArgs = this._defaultEventArgs;
        let d: any, g: any, f: any, h: any, m = 0, k = 0;
        
        eventArgs.angle = 0;
        eventArgs.scaleX = 1;
        eventArgs.scaleY = 1;

        if (8 === index && !b.host._control) {
            const startLine = this._startLine;
            const moveLine = this._moveLine;
            const moveLine2Pt = moveLine[1];
            moveLine2Pt.x += inputPt.dx;
            moveLine2Pt.y += inputPt.dy;
            const movedAngle = this._getAngle(startLine, moveLine);
            const startLinePt1AfterRotate = matrix.rotategAt(movedAngle, startLine[0]);
            this._graphic.getDojoShape().setTransform(startLinePt1AfterRotate);
            eventArgs.transform = startLinePt1AfterRotate;
            eventArgs.angle = movedAngle;
            eventArgs.around = startLine[0];
        } else if (!b.host._control) {
            d = this._startBox;
            g = this._moveBox;
            g.width += inputPt.dx * this._xfactor;
            g.height += inputPt.dy * this._yfactor;
            
            if (this._uniformScaling) {
                f = g.x + this._xfactor * g.width;
                g = g.y + this._yfactor * g.height;
                g = Math.sqrt((f - this._centerCoord.x) * (f - this._centerCoord.x) + (g - this._centerCoord.y) * (g - this._centerCoord.y));
                f = h = g / this._firstMoverToCenter;
                m = this._xfactor * d.width / 2;
                k = this._yfactor * d.height / 2;
            } else {
                f = g.width / d.width;
                h = g.height / d.height;
            }
            
            if (isNaN(f) || f === Infinity || f === -Infinity) f = 1;
            if (isNaN(h) || h === Infinity || h === -Infinity) h = 1;
            
            g = matrix.scaleAt(f, h, d.x + m, d.y + k);
            this._graphic.getDojoShape().setTransform(g);
            eventArgs.transform = g;
            eventArgs.scaleX = f;
            eventArgs.scaleY = h;
            eventArgs.around = {
                x: d.x + m,
                y: d.y + k
            };
        } else {
            const cpindex = b.host.controlPointIndex;
            this._cpScreen[cpindex].x += inputPt.dx;
            this._cpScreen[cpindex].y += inputPt.dy;
            this._controlPoints[cpindex] = this.map.toMap(this._cpScreen[cpindex]);

            this.emit("cpMoved", {
                graphic: this._graphic,
                drawEssentials: this._graphic.drawEssentials
            });
            
            this._draw();

            array.forEach(this._cpAnchors, (item: Anchor, index: number) => {
                if (index === cpindex) {
                    const pt = new Point(this._controlPoints[cpindex], this.map.spatialReference);
                    item.graphic.controlPoints = true;
                    item.graphic.setGeometry(pt);
                    item.graphic.getDojoShape().moveToFront();
                } else {
                    const shape = item.graphic.getDojoShape();
                    if (shape !== null) shape.moveToFront();
                }
            }, this);

            this._graphic.drawEssentials.CTRL_PTS = this._controlPoints;
        }
    }

    private _moveStopHandler(b: any): void {
        this._graphic.drawEssentials.CTRL_PTS = this._controlPoints;
        this._graphic.drawEssentials.drawExtendType = this._drawExtendType;
        this._draw();
        
        let shape: any = null;
        array.forEach(this._anchors, (item: Anchor) => {
            shape = item.graphic.getDojoShape();
            if (shape !== null) shape.moveToFront();
        });
        
        shape = null;
        array.forEach(this._cpAnchors, (item: Anchor) => {
            shape = item.graphic.getDojoShape();
            if (shape !== null) shape.moveToFront();
        });
    }

    private _updateSegments(map: any, rings: any[], graphicTransform: any, layerTransform: any, spatialReference: any): void {
        const wrapOffset = this._wrapOffset || 0;
        array.forEach(rings, (b: any) => {
            array.forEach(b, (b: any) => {
                const f = map.toScreen({
                    x: b[0],
                    y: b[1],
                    spatialReference: spatialReference
                }, true);
                f.x += wrapOffset;
                f = matrix.multiplyPoint([layerTransform, graphicTransform, matrix.invert(layerTransform)], f);
                f.x -= wrapOffset;
                f = map.toMap(f);
                b[0] = f.x;
                b[1] = f.y;
            });
        });
    }

    private _updateControlPt(geometry: any, point: Point, graphicTransform: Transform): Point {
        const firstPoint = geometry.getPoint(0, 0);
        const mapfirstPoint = this.map.toMap(this.map.toScreen(firstPoint).offset(graphicTransform.dx, graphicTransform.dy));
        const dx = mapfirstPoint.x - firstPoint.x;
        const dy = mapfirstPoint.y - firstPoint.y;
        return point.offset(dx, dy);
    }

    private _updateControlPoints(pt: Point, graphicTransform: any, layerTransform: any): Point {
        const wrapOffset = this._wrapOffset || 0;
        let f = this.map.toScreen(pt, true);
        f.x += wrapOffset;
        f = matrix.multiplyPoint([layerTransform, graphicTransform, matrix.invert(layerTransform)], f);
        f.x -= wrapOffset;
        return this.map.toMap(f);
    }

    private _getAngle(b: any[], e: any[]): number {
        const c = 180 * Math.atan2(b[0].y - b[1].y, b[0].x - b[1].x) / Math.PI;
        return 180 * Math.atan2(e[0].y - e[1].y, e[0].x - e[1].x) / Math.PI - c;
    }

    private _init(): void {
        this._draw();
    }

    deactivate(graphicLayer: GraphicsLayer): void {
        this.emit("cpDeActivate", {
            "state": 0,
            "graphic": this._graphic
        });
        this._cleanUp(graphicLayer);
        this._removeEvents();
    }

    private _cleanUp(_scratchGL: GraphicsLayer): void {
        if (this._connects) {
            array.forEach(this._connects, connect.disconnect);
        }
        
        if (this._anchors) {
            array.forEach(this._anchors, (e: Anchor) => {
                _scratchGL.remove(e.graphic);
                if (e.moveable) e.moveable.destroy();
            });
        }
        
        if (this._cpAnchors) {
            array.forEach(this._cpAnchors, (e: Anchor) => {
                _scratchGL.remove(e.graphic);
                if (e.moveable) e.moveable.destroy();
            });
        }
        
        if (this._box) {
            _scratchGL.remove(this._box);
        }
        
        this._box = null;
        this._anchors = null;
        this._connects = null;
        this._cpAnchors = null;
    }

    private _removeEvents(): void {
        // Event cleanup if needed
    }
} 