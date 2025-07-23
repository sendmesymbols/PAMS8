import Graphic from "@arcgis/core/Graphic";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import PictureMarkerSymbol from "@arcgis/core/symbols/PictureMarkerSymbol";
import View from "@arcgis/core/views/View";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import GraphicsLayerManager from "../Managers/GraphicsLayerManager";
import '../ThirdParty/milsymbol.d.ts';
import { ParsedSIDC } from '../SIDC/SIDC';
import Amplifier from "../Support/Amplifier.ts";
import DrawEssentials from "../Support/DrawEssentials.ts";
interface Evented {
    on(type: string, listener: Function): {
        remove(): void;
    };
    emit(type: string, event: any): boolean;
}
interface SymbolOptions {
    sidc?: string;
    size?: number;
    quantity?: string;
    staffComments?: string;
    additionalInformation?: string;
    type?: string;
    dtg?: string;
    location?: string;
    outlineColor?: string;
    outlineWidth?: number;
    [key: string]: any;
}
declare class SymbolEngine implements Evented {
    private _layerManager;
    private _contextMenuManager;
    private _getView;
    private currentSymbol;
    private sidc;
    private amplifier;
    private _registeredSymbols;
    private eventListeners;
    private labelOptions;
    private mapper;
    constructor(viewProvider: () => MapView | SceneView);
    /**
     * Implement Evented interface methods
     */
    emit(type: string, event: any): boolean;
    /**
     * Register any symbol instance to listen to its events
     */
    registerSymbol(symbolInstance: any, symbolType?: string): void;
    /**
     * Unregister any symbol instance
     */
    unregisterSymbol(symbolInstance: any, symbolType?: string): void;
    /**
     * Setup global event listener for onDrawProgress events
     * This allows catching events from any symbol class without manual registration
     */
    setupGlobalEventListener(): void;
    onViewChanged(newView: MapView | SceneView): void;
    get view(): MapView | SceneView;
    get layerManager(): GraphicsLayerManager;
    set layerManager(value: GraphicsLayerManager);
    createPointSymbol(color?: string, size?: number): SimpleMarkerSymbol;
    /**
     * Register context menu items for different graphic types
     */
    private registerContextMenuItems;
    /**
     * Handle context menu actions
     */
    private handleContextMenuAction;
    /**
     * Emit events for the main application to handle
     */
    private emitEvent;
    /**
     * Show details for a symbol
     */
    private showSymbolDetails;
    /**
     * Center the map view on a graphic
     */
    private centerOnGraphic;
    /**
     * Remove a graphic from its layer
     */
    private removeGraphic;
    /**
     * Modify a military symbol
     */
    private modifySymbol;
    enrichSymbolOptions(options: SymbolOptions): SymbolOptions & {
        parsedSIDC?: ParsedSIDC;
        label?: string;
        text?: string;
    };
    createLineSymbol(color?: string, width?: number): SimpleLineSymbol;
    createFillSymbol(color?: string, outlineColor?: string, outlineWidth?: number): SimpleFillSymbol;
    createPictureMarkerSymbol(url: string, width: number, height: number): PictureMarkerSymbol;
    addPointToLayer(geometry: __esri.Point): void;
    addPictureMarkerAtCenter(url: string, width: number | undefined, height: number | undefined, view: MapView | SceneView): void;
    drawMilSymbolInteractively(drawEssentials: DrawEssentials, amplifier: Amplifier, attr: object): void;
    private addMilSymbolFor2D;
    addMilSymbolAtPoint(point: __esri.Point, drawEssentials: DrawEssentials, amplifier: Amplifier, attr: object): void;
    addMilSymbolAtCenter(options: SymbolOptions): void;
    protected svgToDataURL(svg: string): string;
    protected addMilSymbolFor3D(geometry: __esri.Point, options: SymbolOptions): void;
    private addPictureMarkerFor2D;
    private addPictureMarkerFor3D;
    applySymbol(graphic: Graphic, symbol: SimpleMarkerSymbol | SimpleLineSymbol | SimpleFillSymbol): void;
    static isView2D(view: View): boolean;
    static isView3D(view: View): boolean;
    ensureMsAvailable(): void;
    generateForceSymbol(drawEssentials: DrawEssentials, amplifier: Amplifier, attr: object): PictureMarkerSymbol | undefined;
    initialize(drawEssentials: DrawEssentials, amplifier: Amplifier, isPassive?: boolean): void;
    getSymbol(isLine?: boolean): any;
    createSymbolCacheKey(options: SymbolOptions, scaleFactor: number): string;
    private drawSymEnd;
    private getOpacityValue;
    private symDrawProgress;
    private symDrawClick;
    private baseLineDrawEnd;
    /**
     * Test method to demonstrate milsymbol.js integration
     * This replicates the functionality from main.ts
     */
    testMilSymbol(): void;
    /**
     * Getter function to expose symbol data
     * @returns The complete symbol data object
     */
    getSymbolData(): any;
    /**
     * Get symbol data by key
     * @param key The symbol key to retrieve
     * @returns The symbol data for the specified key or null if not found
     */
    getSymbolByKey(key: string): any;
    /**
     * Get all symbol names for autocomplete
     * @returns Array of objects with key and name for autocomplete
     */
    getSymbolNamesForAutocomplete(): Array<{
        key: string;
        name: string;
    }>;
}
export default SymbolEngine;
