import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import DrawEssentials from "../Support/DrawEssentials";

export interface CanalizeOptions {
    CTRL_PTS?: Point[];
    BASE_LN_PTS?: {startPt: Point, endPt: Point};
    GEOM?: Polyline;
    [key: string]: any;
}

export declare class Canalize {
    constructor(view: MapView | SceneView, isLine?: boolean);
    
    public init(options: CanalizeOptions, marker: SimpleLineSymbol): void;
    public getBaseLinePts(): any;
    public deactivate(): void;
    public on(eventName: string, callback: Function): void;
    public off(eventName: string, callback?: Function): void;
    public getSymbolLayer(): GraphicsLayer;
    public clearSymbols(): void;
}

export default Canalize;
