import Graphic from "@arcgis/core/Graphic";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import PictureMarkerSymbol from "@arcgis/core/symbols/PictureMarkerSymbol";
import View from "@arcgis/core/views/View";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import Point from "@arcgis/core/geometry/Point";
import GraphicsLayerManager from "../Managers/GraphicsLayerManager";
import '../ThirdParty/MilSymbols/milsymbol.d.ts';
import { ParsedSIDC } from '../SIDC/SIDC';
import Amplifier from "../Support/Amplifier.ts";
import DrawEssentials from "../Support/DrawEssentials.ts";
import EditEngine from "./EditEngine.ts";
import SelectionEngine from "./SelectionEngine.ts";
import type MeasurementEngine from "./MeasurementEngine.ts";
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
    private _editEngine;
    private _measurementEngine?;
    private currentSymbol;
    private sidc;
    private amplifier;
    private _registeredSymbols;
    private eventListeners;
    private labelOptions;
    private mapper;
    private isDrawing;
    private _undoStack;
    private _redoStack;
    private _preEditSnapshot;
    private _clipboard;
    private _selectionEngine;
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
    /**
     * Dynamically import and initialise MeasurementEngine only when the
     * Settings.json feature flag is true.  The dynamic import keeps the module
     * out of the initial bundle when the feature is disabled.
     */
    private _initMeasurementEngine;
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
     * Close whichever workflow is currently active (EditEngine edit session or
     * SelectionEngine move) before starting a new one.  Must be called at the
     * top of every operation that begins an interactive workflow.
     */
    private _closeActiveWorkflow;
    /**
     * Activate interactive editing for a graphic.
     * Point symbols → move.  Poly/polygon symbols → move + rotate + scale.
     * Called automatically from the right-click context menu or M shortcut.
     */
    modifySymbol(graphic: Graphic): void;
    /**
     * Activate control-point editing (CTRL_PTS drag handles) for a poly/polygon graphic.
     */
    activateEditControlPoints(graphic: Graphic): void;
    /**
     * Programmatically scale a point symbol by a factor (e.g. 1.2 = +20 %).
     * Emits "scalePointSymbol" on the EditEngine; listen there to regenerate
     * the PictureMarkerSymbol with the new SIZE.
     */
    scalePointSymbol(graphic: Graphic, factor: number): void;
    /**
     * Deactivate any active edit / reshape session.
     */
    deactivateEdit(): void;
    /** Access the underlying EditEngine to register event listeners. */
    get editEngine(): EditEngine;
    /** Access the SelectionEngine for multi-select state and batch operations. */
    get selectionEngine(): SelectionEngine;
    /**
     * Wire global keyboard shortcuts for context-menu actions.
     * Shortcuts only fire when the map container (or document) is focused and
     * no input/textarea element has keyboard focus.
     *
     * Shortcut table:
     *   M        → Move, Scale, Rotate (last right-clicked graphic)
     *   E        → Edit Control Points (last right-clicked graphic)
     *   Escape   → Deactivate any active edit session
     *   Delete   → Remove last right-clicked graphic
     *   I        → Show Details
     *   C        → Center On
     */
    private _setupKeyboardShortcuts;
    /** Access the MeasurementEngine — configure units or toggle programmatically.
     *  May be undefined if the feature is disabled in Settings.json or not yet loaded. */
    get measurementEngine(): MeasurementEngine | undefined;
    /** Push an undo entry and clear the redo stack. */
    private _pushUndo;
    /** Snapshot the graphic's current geometry and CTRL_PTS before an edit begins. */
    private _capturePreEditSnapshot;
    /**
     * Wire the EditEngine's changeInSymbol event to push an undo entry.
     * Called once in the constructor; re-called after view switch.
     */
    private _wireEditEngineUndo;
    /** Undo the last operation. */
    undo(): void;
    /** Redo the last undone operation. */
    redo(): void;
    /** Number of operations available to undo. */
    get undoCount(): number;
    /** Number of operations available to redo. */
    get redoCount(): number;
    /** Label of the next undo operation, or null if the stack is empty. */
    get nextUndoLabel(): string | null;
    /** Label of the next redo operation, or null if the stack is empty. */
    get nextRedoLabel(): string | null;
    /**
     * Copy a graphic to the internal clipboard.
     * Stores a deep clone of the graphic's geometry, symbol, and drawEssentials.
     */
    copySymbol(graphic: Graphic): void;
    /**
     * True when the clipboard holds a graphic ready to paste.
     */
    get hasClipboard(): boolean;
    /**
     * Paste the clipboard graphic at a specific map point.
     * Returns the newly created Graphic, or null if the clipboard is empty.
     */
    pasteSymbol(targetPoint: Point): Graphic | null;
    /**
     * Enter "paste mode": the next map click pastes the clipboard graphic there.
     * Escape cancels paste mode.
     */
    private _activatePasteMode;
    /**
     * Translate all vertices of a geometry so that its centroid lands at targetPoint.
     */
    private _offsetGeometryTo;
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
    /** Serialize a single graphic to a plain JSON-safe object. */
    saveSymbolToJSON(graphic: Graphic): object;
    /** Reconstruct a Graphic from a serialised object and add it to the correct layer. */
    loadSymbolFromJSON(data: any): Graphic | null;
    /** Serialise every graphic across all symbol layers into an array. */
    exportLayerToJSON(): object[];
    /** Reconstruct all graphics from a serialised array. */
    importLayerFromJSON(data: object[]): void;
    /** Trigger a browser download of all graphics as a JSON file. */
    saveToFile(filename?: string): void;
    /** Trigger a browser download of a single graphic as a JSON file. */
    saveSymbolToFile(graphic: Graphic): void;
    /** Open a file picker; load symbols from the chosen JSON file. */
    loadFromFile(): void;
    private _downloadJSON;
    private readonly _TEMPLATES_KEY;
    /** Save the amplifier + size of the given graphic as a named template. */
    saveAsTemplate(name: string, graphic: Graphic): void;
    /** Apply a saved template's amplifier + size to an existing graphic and re-annotate. */
    applyTemplate(name: string, graphic: Graphic): void;
    listTemplates(): string[];
    deleteTemplate(name: string): void;
    private _loadTemplatesStore;
    private _promptSaveTemplate;
}
export default SymbolEngine;
