import Graphic from '@arcgis/core/Graphic';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol';
import PictureMarkerSymbol from '@arcgis/core/symbols/PictureMarkerSymbol';
import View from '@arcgis/core/views/View';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import Point from '@arcgis/core/geometry/Point';
import SpatialReference from '@arcgis/core/geometry/SpatialReference';
import GraphicsLayerManager from '../Managers/GraphicsLayerManager';
import '../ThirdParty/MilSymbols/milsymbol.d.ts';
import { ParsedSIDC } from '../SIDC/SIDC';
import ContextMenuManager from '../Managers/ContextMenuManager';
import settingsData from '../Data/Settings.json';
import Amplifier from '../Support/Amplifier.ts';
import DrawEssentials from '../Support/DrawEssentials.ts';
import EditEngine from './EditEngine.ts';
import SelectionEngine from './SelectionEngine.ts';
import type MeasurementEngine from './MeasurementEngine.ts';
import ProximityEngine from './ProximityEngine.ts';
import DrawingCueEngine from './DrawingCueEngine.ts';
import MGRSEngine from './MGRSEngine.ts';
import WeaponEffectEngine from './Analysis/WeaponEffectEngine';
import LOSEngine from './Analysis/LOSEngine';
import TrajectoryEngine from './Analysis/TrajectoryEngine';
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
interface UndoEntry {
    label: string;
    undo: () => void;
    redo: () => void;
}
declare class SymbolEngine implements Evented {
    private _layerManager;
    private _contextMenuManager;
    private _getView;
    private _editEngine;
    private _measurementEngine?;
    private _proximityEngine;
    private _drawingCueEngine;
    private _mgrsEngine;
    private _weaponEffectEngine;
    private _losEngine;
    private _trajectoryEngine;
    private _bufferEngine;
    private _corridorEngine;
    private currentSymbol;
    private sidc;
    private amplifier;
    private _registeredSymbols;
    private eventListeners;
    private labelOptions;
    private mapper;
    private isDrawing;
    private _creationMode;
    private _lastDrawEssentials;
    private _lastAmplifier;
    private _continuousTimeoutId;
    private _undoStack;
    private _redoStack;
    private _preEditSnapshot;
    private _clipboard;
    private _pendingAttrs;
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
    private _initProximityEngine;
    private _initDrawingCueEngine;
    private _initMGRSEngine;
    private _initWeaponEffectEngine;
    private _initLOSEngine;
    private _initTrajectoryEngine;
    private _initBufferEngine;
    private _initCorridorEngine;
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
    /** Access the ContextMenuManager instance. */
    get contextMenuManager(): ContextMenuManager;
    /** Remove all graphics from every managed layer. */
    clearAllGraphics(): void;
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
    /** Access the ProximityEngine — toggle or adjust snap options programmatically.
     *  May be undefined if the feature is disabled in Settings.json or not yet loaded. */
    get proximityEngine(): ProximityEngine | null;
    /** Access the DrawingCueEngine — control visual overlays during drawing. */
    get drawingCueEngine(): DrawingCueEngine | null;
    /** Access the MGRSEngine — grid overlay controls and runtime configuration. */
    get mgrsEngine(): MGRSEngine | null;
    /** Access the WeaponEffectEngine — open WEZ analysis panels programmatically. */
    get weaponEffectEngine(): WeaponEffectEngine | null;
    /** Access the LOSEngine — open LOS/viewshed panels programmatically. */
    get losEngine(): LOSEngine | null;
    /** Access the TrajectoryEngine — open projectile trajectory analysis panels programmatically. */
    get trajectoryEngine(): TrajectoryEngine | null;
    /** Get current settings data for the control panel */
    get settings(): typeof settingsData;
    /**
     * Handle runtime setting changes from the control panel.
     * Updates settingsData in memory and applies changes to active engines.
     */
    onSettingChanged(path: string[], value: any): void;
    /** Push an undo entry and clear the redo stack. */
    _pushUndo(entry: UndoEntry): void;
    /** Snapshot the graphic's current geometry and CTRL_PTS before an edit begins. */
    private _capturePreEditSnapshot;
    /**
     * Wire the EditEngine's changeInSymbol event to push an undo entry.
     * Called once in the constructor; re-called after view switch.
     */
    private _wireEditEngineUndo;
    private _buildGraphicUndoState;
    /** Undo the last operation. */
    undo(): void;
    /** Redo the last undone operation. */
    redo(): void;
    /** Number of operations available to undo. */
    get undoCount(): number;
    /** Current creation mode ('single' or 'continuous'). */
    get creationMode(): 'single' | 'continuous';
    set creationMode(mode: 'single' | 'continuous');
    /** Stop continuous creation mode and revert to single. No-op if already single. */
    stopContinuousMode(): void;
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
     * Paste clipboard graphic(s) at targetPoint.
     * Single item: places its centroid at targetPoint.
     * Multiple items: preserves relative layout, collective centroid lands at targetPoint.
     * Returns the first pasted Graphic, or null if clipboard is empty.
     */
    pasteSymbol(targetPoint: Point, expandDistance?: number, expandUnit?: string): Graphic | null;
    /** Paste a single clipboard item whose geometry has already been positioned. */
    private _pasteOneItem;
    /** Transform CTRL_PTS, BASE_LN_PTS and GEOM in a drawEssentials copy using a transform function. */
    private _transformDrawEssentials;
    /** Shift CTRL_PTS, BASE_LN_PTS and GEOM in a drawEssentials copy by (dx, dy). */
    private _shiftDrawEssentials;
    /** Build a new graphic from a clipboard item + positioned geometry, returning undo/redo closures. */
    private _buildPastedGraphic;
    /** Geodesic bearing (degrees, 0=N, 90=E) from lon1/lat1 to lon2/lat2 (WGS84 coordinates). */
    private _computeBearing;
    /** Centroid of all clipboard geometries (for multi-paste anchor). */
    private _clipboardCentroid;
    /** Translate all vertices of a geometry by (dx, dy). */
    private _shiftGeometry;
    /**
     * Show Paste Offset Dialog (Triggered by CTRL+SHIFT+V)
     */
    _showPasteOffsetDialog(): void;
    /**
     * Enter "paste mode" with expansion/contraction distance: the next map click pastes the clipboard graphic there.
     */
    _activatePasteModeWithOffset(expandDistance: number, expandUnit: string): void;
    /**
     * Enter "paste mode": the next map click pastes the clipboard graphic there.
     * Escape cancels paste mode.
     */
    _activatePasteMode(): void;
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
    /**
     * Project a Point to the specified spatial reference.
     * @param point The Point to project
     * @param spatialReference The target spatial reference
     * @returns The projected Point (returns same as input)
     */
    reProject(point: Point, spatialReference: SpatialReference): Point;
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
    private _serializePoint;
    /**
     * Serialize a single graphic to a plain JSON-safe object.
     * Saves CTRL_PTS / BASE_LN_PTS for line/area symbols and GEOM for point symbols.
     * On load these are fed back into initialize(isPassive=true) so the symbol is
     * reconstructed through the same rendering pipeline used when it was first drawn.
     */
    saveSymbolToJSON(graphic: Graphic): object;
    /**
     * Reconstruct a graphic from a serialised pams8 object.
     * When CTRL_PTS / BASE_LN_PTS / GEOM are present the symbol is re-rendered
     * through initialize(isPassive=true) — the same pipeline as interactive drawing.
     * Falls back to direct Graphic construction for milsymbol / legacy format.
     */
    loadSymbolFromJSON(data: any): Graphic | null;
    /** Serialise every graphic across all symbol layers into an array. */
    exportLayerToJSON(): object[];
    /** Reconstruct all graphics from a serialised array. */
    importLayerFromJSON(data: object[]): void;
    /** Download all symbols as a PAMS8 JSON file. */
    saveToFile(filename?: string): void;
    /** Download a single graphic as a PAMS8 JSON file. */
    saveSymbolToFile(graphic: Graphic): void;
    /** Convert an ArcGIS Point (or plain {x,y}) to the Plan PlanPoint format. */
    private _toPlanPoint;
    /**
     * Build the AMPLIFIER block for Area / Line / TacticalPoint symbols.
     * Includes all fields that symbol classes may attach as extra properties.
     */
    private _serializeAmplifierForPlan;
    /** Build drawEss JSON for UEI / milsymbol (FPoint) graphics. */
    private _buildFPointPlanDrawEss;
    /** Build drawEss JSON for Area / Line graphics (including those with BASE_LN_PTS). */
    private _buildAreaLinePlanDrawEss;
    /** Build drawEss JSON for TacticalPoint (SYM_GEO_TYPE "Point") graphics. */
    private _buildPointPlanDrawEss;
    /**
     * Dispatch to the correct drawEss serializer based on the graphic's SYM_GEO_TYPE.
     * Returns null for graphics that cannot be represented in plan format.
     */
    private _buildPlanDrawEss;
    /** Download all graphics as a Plan JSON file. */
    savePlanToFile(filename?: string): void;
    /**
     * Convert a Plan drawEss JSON string back into the format expected by loadSymbolFromJSON.
     * PlanPoints ({type, x, y, sp}) are compatible with ArcGIS Point construction (spatialReference
     * defaults to WGS84 when absent), so no special conversion is needed.
     */
    private _loadPlanSymbol;
    /** Open a Plan JSON file and restore all symbols from it. */
    loadPlanFromFile(): void;
    /** Open a file picker; loads from PAMS8 JSON, template, or GeoJSON file. */
    loadFromFile(): void;
    /**
     * Save a symbol's draw configuration (without geometry) as a template file.
     * Loading the template triggers interactive placement (no GEOM/CTRL_PTS set).
     * Also stores to localStorage so the dynamic context-menu "Apply" list stays current.
     */
    saveTemplateToFile(graphic: Graphic): void;
    /** Open a file picker; loads a template and starts interactive placement. */
    loadTemplateFromFile(): void;
    /** Reconstruct DrawEssentials from template data and start interactive placement. */
    private _applyTemplateData;
    /** Export all symbol layers as a standard GeoJSON FeatureCollection (WGS84 coordinates). */
    exportToGeoJSON(): object;
    /** Reconstruct symbols from a pams8 GeoJSON FeatureCollection. */
    importFromGeoJSON(geojson: any): void;
    /** Download all symbols as a standard GeoJSON file. */
    saveToGeoJSONFile(filename?: string): void;
    /** Open a file picker and load symbols from a GeoJSON or PAMS8 JSON file. */
    loadFromGeoJSONFile(): void;
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
