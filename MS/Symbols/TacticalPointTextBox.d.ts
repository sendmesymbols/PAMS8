import Point from "@arcgis/core/geometry/Point";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
export interface TacticalPointTextBoxOptions {
    GEOM?: Point;
    SIZE?: number;
    ANGLE?: number;
    opacity?: number;
    [key: string]: any;
}
/**
 * TacticalPointTextBox — Freehand text box tactical point.
 * Works in 2D MapView and 3D SceneView. Mirrors TacticalPointText, but
 * uses its own SID (000111) so the AnnotationEngine can render the
 * multi-line label text supplied via the amplifier.
 */
export declare class TacticalPointTextBox {
    private view;
    private layerManager;
    private symbolLayer;
    private SIC;
    private symName;
    private symGeometricType;
    private _ptSymbol;
    private _point;
    private _path;
    private _offset;
    private _opacity;
    private tactPtSymData;
    private amplifier;
    private isDrawing;
    private tempGraphic;
    private mouseMoveHandler;
    private clickHandler;
    private eventListeners;
    constructor(view: MapView | SceneView);
    init(options: TacticalPointTextBoxOptions, marker: SimpleMarkerSymbol, sic: string, symName: string, offset: string, sidc: string): void;
    private configureMarkerSymbol;
    private startInteractiveDrawing;
    private setupEventHandlers;
    private finishDrawing;
    private createDrawEssentials;
    private drawEnd;
    private onDrawEnd;
    private cleanUp;
    private removeEventHandlers;
    deactivate(): void;
    private emit;
    private emitGlobalEvent;
    on(eventName: string, callback: Function): void;
    off(eventName: string, callback?: Function): void;
    getSymbolLayer(): GraphicsLayer;
    clearSymbols(): void;
}
export default TacticalPointTextBox;
