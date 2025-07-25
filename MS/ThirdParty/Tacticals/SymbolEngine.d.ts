import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Polygon from "@arcgis/core/geometry/Polygon";
import type MapView from "@arcgis/core/views/MapView";
import type SceneView from "@arcgis/core/views/SceneView";
import type { SymbolOptions, SymbolResult } from './types';
import { type TacticalGraphicOptions } from './TacticalGraphics';
export declare class SymbolEngine {
    private view;
    private layers;
    private sketchVM;
    private symbolCache;
    constructor(view: MapView | SceneView);
    private initializeLayers;
    private getLayer;
    drawMilSymbolInteractively(options: SymbolOptions): Promise<void>;
    addMilSymbolAtPoint(point: Point, options: SymbolOptions): SymbolResult;
    private generateMilitarySymbol;
    private createDefaultPointSymbol;
    private createMilitarySymbol;
    private generateSymbolURL;
    private createSymbolCacheKey;
    drawTacticalGraphic(options: TacticalGraphicOptions): Promise<void>;
    addTacticalGraphic(geometry: Point | Polyline | Polygon, options: TacticalGraphicOptions): Graphic;
    destroy(): void;
}
