import Point from "@arcgis/core/geometry/Point";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Amplifier from "../Support/Amplifier";
export interface MarkerOptions {
    color?: any;
    size?: number;
    angle?: number;
    outline?: {
        color?: any;
        width?: number;
    };
}
export interface TacticalPointOptions {
    GEOM?: Point;
    SIZE?: number;
    ANGLE?: number;
    AMPLIFIER?: Amplifier;
    [key: string]: any;
}
/**
 * TacticalPoint class for drawing tactical point symbols on MapView or SceneView.
 * Supports both immediate placement (with GEOM) and interactive drawing (without GEOM).
 */
export declare class TacticalPoint {
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
    private amplifier;
    private isDrawing;
    private tempGraphic;
    private tactPtSymData;
    private mouseMoveHandler;
    private clickHandler;
    private events;
    constructor(view: MapView | SceneView);
    init(options: TacticalPointOptions, marker?: MarkerOptions, sic?: string, symName?: string, offset?: string, sidc?: string): void;
    /**
     * Build a PictureMarkerSymbol with an SVG data URL — works consistently in 2D and 3D
     * views and survives switching between them.
     */
    private createCrossCompatibleSymbol;
    /** Approximate bounding box of an SVG path, used to center it in a 500x500 viewBox. */
    private calculatePathBounds;
    private pathToSvgDataUrl;
    private getSymbolSize;
    private getSymbolAngle;
    private createDrawEssentials;
    private placeSymbolImmediately;
    private startInteractiveDrawing;
    private setupEventHandlers;
    private finishDrawing;
    private emitDrawEnd;
    private cleanUp;
    private removeEventHandlers;
    deactivate(): void;
    on(eventName: string, callback: (data: any) => void): void;
    off(eventName: string, callback?: (data: any) => void): void;
    getSymbolLayer(): GraphicsLayer;
    clearSymbols(): void;
}
export default TacticalPoint;
