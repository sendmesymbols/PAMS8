import Point from "@arcgis/core/geometry/Point";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Amplifier from "../Support/Amplifier";
import '../ThirdParty/MilSymbols/milsymbol.d.ts';
export interface UEISymbolOptions {
    SIDC?: string;
    GEOM?: Point;
    ANGLE?: number;
    SIZE?: number;
    AMPLIFIER?: Amplifier;
    [key: string]: any;
}
export declare class UEISymbol {
    private view;
    private layerManager;
    private symbolLayer;
    private SIC;
    private symName;
    private symGeometricType;
    private _ueiData;
    private _ptSymbol;
    private _options;
    private isDrawing;
    private tempGraphic;
    private amplifier;
    private mouseMoveHandler;
    private clickHandler;
    constructor(view: MapView | SceneView);
    init(options: any, marker?: any, sic?: string, symName?: string, offset?: string, sidc?: string): void;
    private placeSymbolImmediately;
    private startInteractiveDrawing;
    private setupEventHandlers;
    private createDrawEssentials;
    private emitDrawEnd;
    private emitGlobalEvent;
    private cleanUp;
    private removeEventHandlers;
    deactivate(): void;
    getSymbolLayer(): GraphicsLayer;
    clearSymbols(): void;
}
export default UEISymbol;
