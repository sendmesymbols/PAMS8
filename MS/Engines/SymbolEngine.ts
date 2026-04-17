import Graphic from "@arcgis/core/Graphic";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import PictureMarkerSymbol from "@arcgis/core/symbols/PictureMarkerSymbol";
import PointSymbol3D from "@arcgis/core/symbols/PointSymbol3D";
import IconSymbol3DLayer from "@arcgis/core/symbols/IconSymbol3DLayer";
import Color from "@arcgis/core/Color";
import View from "@arcgis/core/views/View";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SketchViewModel from "@arcgis/core/widgets/Sketch/SketchViewModel";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Polygon from "@arcgis/core/geometry/Polygon";

//import  from "esri/core/reactiveUtils";

import GraphicsLayerManager, {LAYER_NAMES } from "../Managers/GraphicsLayerManager";
/*
import ms from '../ThirdParty/MilSymbols/UEITypes.js';
import type { SymbolOptions } from '../ThirdParty/MilSymbols/UEITypes.ts';
*/

// Import milsymbol types for the global MS object
import '../ThirdParty/MilSymbols/milsymbol.d.ts';
import { parseSIDC, ParsedSIDC } from '../SIDC/SIDC';
import ContextMenuManager, { ContextMenuItem, MenuItemEvent } from '../Managers/ContextMenuManager';

import symbolData from "../Data/Symbols.json";
import settingsData from "../Data/Settings.json";
import Amplifier from "../Support/Amplifier.ts";
import SIDC from "../Support/SIDC.ts"
import DrawEssentials from "../Support/DrawEssentials.ts";
import Mapper from "../Engines/Mapper.ts"
import AnnotationEngine from "./AnnotationEngine.ts";
import GeoTools from "../Support/GeoTools.ts";
import EditEngine from "./EditEngine.ts";
import SelectionEngine from "./SelectionEngine.ts";
// MeasurementEngine is loaded dynamically based on Settings.json features.measurementEngine
import type MeasurementEngine from "./MeasurementEngine.ts";


interface Evented {
    on(type: string, listener: Function): { remove(): void };
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





// Interfaces for data loaded from JSON
interface SymbolDefinition {
    Class: string;
    Name: string;
    Offset: { x: number; y: number };
    Fill: boolean;
    SymGeoType: "Point" | "FPoint" | "Polyline" | "Polygon";
}

interface SymbolData {
    [key: string]: SymbolDefinition;
}




interface UndoEntry {
    label: string;
    undo: () => void;
    redo: () => void;
}

class SymbolEngine implements Evented {
    private _layerManager: GraphicsLayerManager;
    private _contextMenuManager: ContextMenuManager;
    private _getView: () => MapView | SceneView;
    private _editEngine: EditEngine;
    private _measurementEngine?: MeasurementEngine;
    private currentSymbol: any | undefined;
    private sidc:any | undefined;
    private amplifier: Amplifier | undefined;
    private _registeredSymbols: Set<any> = new Set();
    private eventListeners: Map<string, Function[]> = new Map();
    private labelOptions: any = {};
    private mapper: any;
    private isDrawing = false;

    // Undo / Redo stacks
    private _undoStack: UndoEntry[] = [];
    private _redoStack: UndoEntry[] = [];
    // Geometry/CTRL_PTS snapshot captured just before an edit operation starts
    private _preEditSnapshot: { geometry: any; ctrlPts: any; baseLnPts: any } | null = null;

    // Copy/Paste clipboard
    private _clipboard: { graphic: Graphic; layerId: string } | null = null;

    // Multi-select
    private _selectionEngine!: SelectionEngine;




    constructor(viewProvider: () => MapView | SceneView) {
        this._getView = viewProvider;
        this._layerManager = GraphicsLayerManager.getInstance(this.view);
        this._layerManager.initializeLayers();
        this._editEngine = new EditEngine(viewProvider, this._layerManager);
        this._wireEditEngineUndo();
        this._selectionEngine = new SelectionEngine(viewProvider, this._layerManager);
        this._selectionEngine.activate([LAYER_NAMES.FORCE, LAYER_NAMES.TACT_PT, LAYER_NAMES.TACT, "milSymbols"]);
        this.ensureMsAvailable();

        // Initialize symbol engine
        console.log("Symbol Engine initialized");


        //reactiveUtils.watch(() => this._getView()?.zoom, (newType: "2d" | "3d" | undefined) => {

        reactiveUtils.watch(
            () => this._getView()?.type,
            (newType: string| undefined, oldType: string| undefined) => { // Use lowercase 'string' for primitive type
                console.log("SymbolEngine ------ TYPE watcher FIRED. New:", newType, "Old:", oldType);
                // Potentially re-initialize or update SymbolEngine based on new view type
            },
            { initial: true } // This makes it fire once on setup
        );


        reactiveUtils.watch(() => this._getView()?.type, (newType: string | undefined, oldType: string | undefined) => {
            console.log(newType)
            console.log(oldType)
        });

        reactiveUtils.watch(() => this._getView()?.type, (newType: "2d" | "3d" | undefined) => {
            console.log("SymbolEngine ------:", newType);
            // Potentially re-initialize or update SymbolEngine based on new view type
        });

        reactiveUtils.watch(() => this._getView()?.zoom, (newType: Number) => {
         //console.log("SymbolEngine detected activeView type change:", newType);
         // Potentially re-initialize or update SymbolEngine based on new view type
     });

        // Initialize the ContextMenuManager
        this._contextMenuManager = ContextMenuManager.getInstance();
        this._contextMenuManager.initialize(this.view, {
            targetGraphicTypes: [],   // any type on these layers gets the menu
            targetLayerIds: [LAYER_NAMES.FORCE, LAYER_NAMES.TACT_PT, LAYER_NAMES.TACT, "milSymbols"]
        });

        // Register context menu items for different graphic types
        this.registerContextMenuItems();

        // Listen for context menu events
        this._contextMenuManager.on("menu-item-click", this.handleContextMenuAction.bind(this));

        // Conditionally load MeasurementEngine based on Settings.json feature flag
        this._initMeasurementEngine();

        // Wire global keyboard shortcuts (if enabled in Settings.json)
        if ((settingsData as any).features?.shortcuts !== false) {
            this._setupKeyboardShortcuts();
        }

        // Set up global event listeners for drawing events
        this.setupGlobalEventListener();

        // Initialize symbol engine
        console.log("Symbol Engine initialized");

        // --- Context Menu Setup using the Evented Class ---

        //when(this._getView, "ready", () => {
         //   console.log("RWADY")
        //});


    }

    /**
     * Implement Evented interface methods
     */

    /*
    public on(type: string, listener: Function): { remove(): void } {
        if (!this.eventListeners.has(type)) {
            this.eventListeners.set(type, []);
        }
        this.eventListeners.get(type)!.push(listener);
        
        return {
            remove: () => {
                const listeners = this.eventListeners.get(type);
                if (listeners) {
                    const index = listeners.indexOf(listener);
                    if (index > -1) {
                        listeners.splice(index, 1);
                    }
                }
            }
        };
    }
    */

    public emit(type: string, event: any): boolean {
        const listeners = this.eventListeners.get(type);
        if (listeners) {
            listeners.forEach(listener => listener(event));
            return true;
        }
        return false;
    }

    /**
     * Register any symbol instance to listen to its events
     */
    public registerSymbol(symbolInstance: any, symbolType: string = "Symbol"): void {
        if (this._registeredSymbols.has(symbolInstance)) {
            console.warn(`${symbolType} instance is already registered`);
            return;
        }

        this._registeredSymbols.add(symbolInstance);

        // Listen to the onDrawProgress event
        if (symbolInstance.on && typeof symbolInstance.on === 'function') {
            symbolInstance.on("onDrawProgress", (data: any) => {
                console.log(`SymbolEngine caught onDrawProgress event from ${symbolType}:`);
                console.log("  currentGeometry:", data.currentGeometry);
                console.log("  currentDrawEssentials:", data.currentDrawEssentials);
                console.log("  currentMarker:", data.currentMarker);
                console.log("  Full event data:", data);
                
                // Emit a custom event that can be caught by the main application
                this.emitEvent("onDrawProgress", {
                    symbolType: symbolType,
                    currentGeometry: data.currentGeometry,
                    currentDrawEssentials: data.currentDrawEssentials,
                    currentMarker: data.currentMarker,
                    originalData: data
                });
            });

            // Listen to other events as well
            symbolInstance.on("onDrawEnd", (data: any) => {
                console.log(`SymbolEngine caught onDrawEnd event from ${symbolType}:`);
                console.log("  Full event data:", data);
                
                // Emit a custom event
                this.emitEvent("onDrawEnd", {
                    symbolType: symbolType,
                    originalData: data
                });
            });

            console.log(`${symbolType} registered with SymbolEngine and event listeners attached`);
        } else {
            console.warn(`${symbolType} instance does not support event listening (missing 'on' method)`);
        }
    }

    /**
     * Unregister any symbol instance
     */
    public unregisterSymbol(symbolInstance: any, symbolType: string = "Symbol"): void {
        this._registeredSymbols.delete(symbolInstance);
        console.log(`${symbolType} unregistered from SymbolEngine`);
    }

    /**
     * Setup global event listener for onDrawProgress events
     * This allows catching events from any symbol class without manual registration
     */
    public setupGlobalEventListener(): void {
        // Listen to custom events on the document
        document.addEventListener("onDrawProgress", (event: any) => {
            console.log("SymbolEngine caught global onDrawProgress event:");
            console.log("  Event detail:", event.detail);

            // Feed drawing progress into the measurement engine
            const detail = event.detail;
            if (detail?.currentGeometry && detail?.currentDrawEssentials?.CTRL_PTS) {
                this._measurementEngine?.updateSegments(
                    detail.currentGeometry,
                    detail.currentDrawEssentials.CTRL_PTS,
                );
            }
        });

        // New control point clicked — arm the next segment measurement graphic
        document.addEventListener("onDrawClick", (event: any) => {
            const detail = event.detail;
            if (detail?.currentPts) {
                this._measurementEngine?.addSegment(detail.currentPts);
            }
        });

        document.addEventListener("onDrawEnd", (event: any) => {
            console.log("SymbolEngine caught global onDrawEnd event:");
            console.log("  Event detail:", event.detail);

            // Handle the draw end event by creating and adding a graphic
            this.drawSymEnd(event.detail);

            // Clear measurement overlays when the symbol is finalised
            this._measurementEngine?.wrapUp();
        });

        console.log("SymbolEngine global event listeners set up");
    }



    /**
     * Generate a UUID for graphics
     */
    private generateUUID(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }





    onViewChanged(newView: MapView | SceneView) {
        console.log("SymbolEngine: Detected view change:", newView?.type);
        this._editEngine.deactivate();
        this._layerManager = GraphicsLayerManager.getInstance(newView);
        this._layerManager.initializeLayers();
        this._editEngine = new EditEngine(this._getView, this._layerManager);
        this._wireEditEngineUndo();
        this._selectionEngine.onViewChanged(newView);
        // Re-attach measurement engine to the new view
        this._measurementEngine?.onViewChanged(newView);

        // Re-initialize the ContextMenuManager for the new view so its
        // pointer-down / contextmenu listeners are bound to the active view.
        this._contextMenuManager.initialize(newView, {
            targetGraphicTypes: [],
            targetLayerIds: [LAYER_NAMES.FORCE, LAYER_NAMES.TACT_PT, LAYER_NAMES.TACT, "milSymbols"]
        });
    }

    /**
     * Dynamically import and initialise MeasurementEngine only when the
     * Settings.json feature flag is true.  The dynamic import keeps the module
     * out of the initial bundle when the feature is disabled.
     */
    private async _initMeasurementEngine(): Promise<void> {
        const features = (settingsData as any).features ?? {};
        if (features.measurementEngine === false) {
            console.info("[SymbolEngine] MeasurementEngine disabled via Settings.json");
            return;
        }
        try {
            const { default: ME } = await import("./MeasurementEngine.ts");
            this._measurementEngine = ME.getInstance();
            this._measurementEngine.start(this.view);
            this._contextMenuManager.linkMeasurementEngine(this._measurementEngine);
            // Emit so the host app can initialise its panel
            this.emitEvent("measurementEngineReady", { engine: this._measurementEngine });
            console.info("[SymbolEngine] MeasurementEngine loaded");
        } catch (e) {
            console.error("[SymbolEngine] Failed to load MeasurementEngine:", e);
        }
    }

    get view() {
        return this._getView();
    }

    get layerManager(): GraphicsLayerManager {
        return GraphicsLayerManager.getInstance(this.view);
    }

    set layerManager(value: GraphicsLayerManager) {
        this._layerManager = value;
    }

    createPointSymbol(color: string = "#FF0000", size: number = 10): SimpleMarkerSymbol {
        return new SimpleMarkerSymbol({
            color: new Color(color),
            size,
            outline: {color: "#000000", width: 1},
        });
    }

    /**
     * Register context menu items for different graphic types
     */
    private registerContextMenuItems(): void {

        console.log("Registered")
        const milSymbolMenuItems: ContextMenuItem[] = [
            {
                id: "show-details",
                label: "Show Details",
                shortcut: "I",
                icon: '<span style="font-size:14px">ℹ️</span>',
                action: (graphic) => this.showSymbolDetails(graphic)
            },
            {
                id: "center-on",
                label: "Center On",
                shortcut: "C",
                icon: '<span style="font-size:14px">🎯</span>',
                action: (graphic) => this.centerOnGraphic(graphic)
            },
            {
                id: "remove-graphic",
                label: "Remove",
                shortcut: "Del",
                icon: '<span style="font-size:14px">🗑️</span>',
                action: (graphic) => this.removeGraphic(graphic)
            },
            // ── Edit submenu ────────────────────────────────────────────────
            {
                id: "edit-submenu",
                label: "Edit",
                icon: '<span style="font-size:14px">✏️</span>',
                children: [
                    {
                        id: "modify-symbol",
                        label: "Move, Scale, Rotate",
                        shortcut: "M",
                        icon: '<span style="font-size:14px">✏️</span>',
                        visible: (_graphic) => !this._editEngine.isModifyingSymbol,
                        action: (graphic) => this.modifySymbol(graphic)
                    },
                    {
                        id: "disable-modify-symbol",
                        label: "Disable Move, Scale, Rotate",
                        shortcut: "Esc",
                        icon: '<span style="font-size:14px">✖</span>',
                        visible: (_graphic) => this._editEngine.isModifyingSymbol,
                        action: (_graphic) => this.deactivateEdit()
                    },
                    {
                        id: "edit-ctrl-pts",
                        label: "Edit Control Points",
                        shortcut: "E",
                        icon: '<span style="font-size:14px">⬡</span>',
                        visible: (_graphic) => !this._editEngine.isEditingControlPoints,
                        action: (graphic) => this.activateEditControlPoints(graphic)
                    },
                    {
                        id: "deactivate-ctrl-pts",
                        label: "Deactivate Control Points",
                        shortcut: "Esc",
                        icon: '<span style="font-size:14px">✖</span>',
                        visible: (_graphic) => this._editEngine.isEditingControlPoints,
                        action: (_graphic) => this.deactivateEdit()
                    }
                ]
            },
            // ── Selection submenu ───────────────────────────────────────────
            {
                id: "selection-submenu",
                label: "Selection",
                icon: '<span style="font-size:14px">☑</span>',
                children: [
                    {
                        id: "toggle-select",
                        label: (graphic: any) => this._selectionEngine.isSelected(graphic) ? "Deselect" : "Add to Selection",
                        shortcut: "Shift+Click",
                        icon: '<span style="font-size:14px">☑</span>',
                        action: (graphic) => this._selectionEngine.toggleGraphic(graphic)
                    },
                    {
                        id: "clear-selection",
                        label: () => `Clear Selection (${this._selectionEngine.count})`,
                        icon: '<span style="font-size:14px">✕</span>',
                        visible: () => this._selectionEngine.count > 0,
                        action: (_graphic) => this._selectionEngine.clearSelection()
                    },
                    {
                        id: "move-selected",
                        label: () => `Move Selected (${this._selectionEngine.count})`,
                        shortcut: "M",
                        icon: '<span style="font-size:14px">⤢</span>',
                        visible: () => this._selectionEngine.count > 1,
                        action: (_graphic) => {
                            this._closeActiveWorkflow();
                            this._selectionEngine.moveSelected(
                                ({ graphics, dx, dy }) => this._pushUndo({
                                    label: `Move ${graphics.length} Symbols`,
                                    undo: () => this._selectionEngine["_applyDelta"](graphics, -dx, -dy),
                                    redo: () => this._selectionEngine["_applyDelta"](graphics, dx, dy),
                                })
                            );
                        }
                    },
                    {
                        id: "delete-selected",
                        label: () => `Delete Selected (${this._selectionEngine.count})`,
                        shortcut: "Del",
                        icon: '<span style="font-size:14px">🗑️</span>',
                        visible: () => this._selectionEngine.count > 1,
                        action: (_graphic) => this._selectionEngine.deleteSelected(
                            (entry) => this._pushUndo(entry)
                        )
                    },
                    {
                        id: "align-horizontal",
                        label: "Distribute Horizontal",
                        icon: '<span style="font-size:14px">⇔</span>',
                        visible: () => this._selectionEngine.count > 1,
                        action: (_graphic) => this._selectionEngine.alignHorizontal(e => this._pushUndo(e))
                    },
                    {
                        id: "align-vertical",
                        label: "Distribute Vertical",
                        icon: '<span style="font-size:14px">⇕</span>',
                        visible: () => this._selectionEngine.count > 1,
                        action: (_graphic) => this._selectionEngine.alignVertical(e => this._pushUndo(e))
                    },
                    {
                        id: "arrange-square",
                        label: "Arrange Square",
                        icon: '<span style="font-size:14px">⊞</span>',
                        visible: () => this._selectionEngine.count > 1,
                        action: (_graphic) => this._selectionEngine.arrangeSquare(500, e => this._pushUndo(e))
                    },
                    {
                        id: "arrange-triangle",
                        label: "Arrange Triangle",
                        icon: '<span style="font-size:14px">▲</span>',
                        visible: () => this._selectionEngine.count > 1,
                        action: (_graphic) => this._selectionEngine.arrangeTriangle(500, e => this._pushUndo(e))
                    },
                    {
                        id: "arrange-inv-triangle",
                        label: "Arrange Inverted Triangle",
                        icon: '<span style="font-size:14px">▽</span>',
                        visible: () => this._selectionEngine.count > 1,
                        action: (_graphic) => this._selectionEngine.arrangeInvertedTriangle(500, e => this._pushUndo(e))
                    }
                ]
            },
            // ── Clipboard submenu ───────────────────────────────────────────
            {
                id: "clipboard-submenu",
                label: "Clipboard",
                icon: '<span style="font-size:14px">📋</span>',
                visible: () => (settingsData as any).features?.copyPaste !== false || (settingsData as any).features?.shortcuts !== false,
                children: [
                    {
                        id: "copy-symbol",
                        label: "Copy Symbol",
                        shortcut: "Ctrl+C",
                        icon: '<span style="font-size:14px">📋</span>',
                        visible: () => (settingsData as any).features?.copyPaste !== false,
                        action: (graphic) => this.copySymbol(graphic)
                    },
                    {
                        id: "paste-symbol",
                        label: "Paste Symbol",
                        shortcut: "Ctrl+V",
                        icon: '<span style="font-size:14px">📌</span>',
                        visible: () => (settingsData as any).features?.copyPaste !== false && this._clipboard !== null,
                        action: (_graphic) => this._activatePasteMode()
                    },
                    {
                        id: "undo",
                        label: () => this._undoStack.length > 0 ? `Undo ${this._undoStack[this._undoStack.length - 1].label}` : "Undo",
                        shortcut: "Ctrl+Z",
                        icon: '<span style="font-size:14px">↩</span>',
                        enabled: (_graphic) => this._undoStack.length > 0,
                        visible: () => (settingsData as any).features?.shortcuts !== false,
                        action: (_graphic) => this.undo()
                    },
                    {
                        id: "redo",
                        label: () => this._redoStack.length > 0 ? `Redo ${this._redoStack[this._redoStack.length - 1].label}` : "Redo",
                        shortcut: "Ctrl+Y",
                        icon: '<span style="font-size:14px">↪</span>',
                        enabled: (_graphic) => this._redoStack.length > 0,
                        visible: () => (settingsData as any).features?.shortcuts !== false,
                        action: (_graphic) => this.redo()
                    }
                ]
            },
            // ── Save / Load submenu ─────────────────────────────────────────
            {
                id: "saveload-submenu",
                label: "Save / Load",
                icon: '<span style="font-size:14px">💾</span>',
                visible: () => (settingsData as any).features?.saveLoad !== false,
                children: [
                    {
                        id: "save-symbol",
                        label: "Save Symbol",
                        icon: '<span style="font-size:14px">💾</span>',
                        action: (graphic) => this.saveSymbolToFile(graphic)
                    },
                    {
                        id: "save-all-symbols",
                        label: "Save All Symbols",
                        icon: '<span style="font-size:14px">🗂️</span>',
                        action: (_graphic) => this.saveToFile()
                    },
                    {
                        id: "load-symbols",
                        label: "Load Symbols",
                        icon: '<span style="font-size:14px">📂</span>',
                        action: (_graphic) => this.loadFromFile()
                    }
                ]
            }
        ];

        // Dynamic Templates submenu — rebuilt each time the menu opens
        this._contextMenuManager.addDynamicItemProvider((graphic) => {
            if ((settingsData as any).features?.templates === false) return [];
            const names = this.listTemplates();
            const applyItems: ContextMenuItem[] = names.map((name, i) => ({
                id: `apply-template-${i}`,
                label: name,
                icon: '<span style="font-size:14px">🏷️</span>',
                action: (_g: Graphic) => this.applyTemplate(name, graphic),
            }));
            return [{
                id: "templates-submenu",
                label: "Templates",
                icon: '<span style="font-size:14px">📌</span>',
                children: [
                    {
                        id: "save-as-template",
                        label: "Save as Template…",
                        icon: '<span style="font-size:14px">📌</span>',
                        action: (g) => this._promptSaveTemplate(g)
                    },
                    ...applyItems
                ]
            }];
        });

        // Register menu items for force symbols
        const forceMenuItems: ContextMenuItem[] = [
            {
                id: "show-details",
                label: "Show Details",
                shortcut: "I",
                icon: '<span style="font-size:14px">ℹ️</span>',
                action: (graphic) => this.showSymbolDetails(graphic)
            },
            {
                id: "center-on",
                label: "Center On",
                shortcut: "C",
                icon: '<span style="font-size:14px">🎯</span>',
                action: (graphic) => this.centerOnGraphic(graphic)
            },
            {
                id: "remove-graphic",
                label: "Remove",
                shortcut: "Del",
                icon: '<span style="font-size:14px">🗑️</span>',
                action: (graphic) => this.removeGraphic(graphic)
            }
        ];

        // Register the menu items
        // "milSymbol" / "force" = legacy explicit types
        // "symbol" = default type set by drawSymEnd for all tactical symbols
        this._contextMenuManager.registerMenuItems("milSymbol", milSymbolMenuItems);
        this._contextMenuManager.registerMenuItems("symbol", milSymbolMenuItems);
        this._contextMenuManager.registerMenuItems("force", forceMenuItems);

        // You can also register menu items for other graphic types as needed
    }

    /**
     * Handle context menu actions
     */
    private handleContextMenuAction(event: MenuItemEvent): void {
        console.log(`Context menu action: ${event.actionId} on ${event.graphicType} in layer ${event.layerId}`);

        // Emit a custom event for the main application to handle
        // This allows the main app to perform any additional housekeeping
        this.emitEvent("symbolAction", {
            type: event.actionId,
            graphic: event.graphic,
            layerId: event.layerId,
            graphicType: event.graphicType,
            point: event.point
        });
    }

    /**
     * Emit events for the main application to handle
     */
    private emitEvent(eventName: string, data: any): void {
        // Create a custom event that bubbles up to the document level
        const customEvent = new CustomEvent(eventName, {
            detail: data,
            bubbles: true,
            cancelable: true
        });

        // Dispatch the event from the view container with null check
        if (this.view && this.view.container) {
            this.view.container.dispatchEvent(customEvent);
        } else {
            // Fallback to dispatching from document if container is null
            document.dispatchEvent(customEvent);
        }
    }

    /**
     * Show details for a symbol
     */
    private showSymbolDetails(graphic: Graphic): void {
        console.log("Showing details for symbol:", graphic.attributes);

        // Example implementation - could show in a panel or dialog
        if (graphic.attributes?.sidc) {
            const parsedSidc = parseSIDC(graphic.attributes.sidc);
            console.log("Symbol details:", parsedSidc);

            // You could show this information in a panel or dialog
            // For now, just log to console
        }
    }

    /**
     * Center the map view on a graphic
     */
    private centerOnGraphic(graphic: Graphic): void {
        console.log("Centering on graphic:", graphic.attributes?.name || "Unnamed");

        if (graphic.geometry) {
            this.view.goTo({
                target: graphic,
                zoom: this.view.zoom
            }).catch(error => {
                console.error("Error centering on graphic:", error);
            });
        }
    }

    /**
     * Remove a graphic from its layer
     */
    private removeGraphic(graphic: Graphic): void {
        console.log("Removing graphic:", graphic.attributes?.name || "Unnamed");

        const layer = graphic.layer as __esri.GraphicsLayer | null;
        if (!layer) return;

        const annotationLayer = this._layerManager.getOrCreateLayer(LAYER_NAMES.ANNOTATION_LAYER);
        const graphicId = graphic.attributes?.id;
        const de = graphic.attributes?.drawEssentials;

        this._pushUndo({
            label: "Remove Symbol",
            undo: () => {
                layer.add(graphic);
                if (de?.AMPLIFIER && graphicId) {
                    AnnotationEngine.annotate(
                        annotationLayer, graphic.geometry, de.AMPLIFIER,
                        de, graphicId, settingsData.textSize,
                        de.ISFHAND || 0, this.labelOptions || {}, {}
                    );
                }
            },
            redo: () => {
                layer.remove(graphic);
                if (graphicId) AnnotationEngine.deAnnotate(annotationLayer, graphicId);
            }
        });

        layer.remove(graphic);
        if (graphicId) AnnotationEngine.deAnnotate(annotationLayer, graphicId);
    }

    /**
     * Close whichever workflow is currently active (EditEngine edit session or
     * SelectionEngine move) before starting a new one.  Must be called at the
     * top of every operation that begins an interactive workflow.
     */
    private _closeActiveWorkflow(): void {
        this._editEngine.deactivate();
        this._selectionEngine.cancelMove();
    }

    /**
     * Activate interactive editing for a graphic.
     * Point symbols → move.  Poly/polygon symbols → move + rotate + scale.
     * Called automatically from the right-click context menu or M shortcut.
     */
    public modifySymbol(graphic: Graphic): void {
        console.log("SymbolEngine: activating edit for", graphic.attributes?.id ?? "graphic");
        this._closeActiveWorkflow();
        this._capturePreEditSnapshot(graphic, "Move, Scale, Rotate");
        this._editEngine.activate(graphic);
    }

    /**
     * Activate control-point editing (CTRL_PTS drag handles) for a poly/polygon graphic.
     */
    public activateEditControlPoints(graphic: Graphic): void {
        this._closeActiveWorkflow();
        this._capturePreEditSnapshot(graphic, "Edit Control Points");
        this._editEngine.activateEditControlPoints(graphic);
    }

    /**
     * Programmatically scale a point symbol by a factor (e.g. 1.2 = +20 %).
     * Emits "scalePointSymbol" on the EditEngine; listen there to regenerate
     * the PictureMarkerSymbol with the new SIZE.
     */
    public scalePointSymbol(graphic: Graphic, factor: number): void {
        this._editEngine.scalePointSymbol(graphic, factor);
    }

    /**
     * Deactivate any active edit / reshape session.
     */
    public deactivateEdit(): void {
        this._editEngine.deactivate();
    }

    /** Access the underlying EditEngine to register event listeners. */
    public get editEngine(): EditEngine {
        return this._editEngine;
    }

    /** Access the SelectionEngine for multi-select state and batch operations. */
    public get selectionEngine(): SelectionEngine {
        return this._selectionEngine;
    }

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
    private _setupKeyboardShortcuts(): void {
        document.addEventListener("keydown", (e: KeyboardEvent) => {
            // Skip when typing in an input field
            const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
            if (tag === "input" || tag === "textarea" || tag === "select") return;

            // Handle Ctrl shortcuts first
            if (e.ctrlKey || e.metaKey) {
                if (e.shiftKey && (e.key === "z" || e.key === "Z")) { e.preventDefault(); this.redo(); }
                else if (e.key === "z" || e.key === "Z") { e.preventDefault(); this.undo(); }
                else if (e.key === "y" || e.key === "Y") { e.preventDefault(); this.redo(); }
                else if (e.key === "c" || e.key === "C") {
                    const g = this._contextMenuManager.getLastClickedGraphic();
                    if (g) { e.preventDefault(); this.copySymbol(g); }
                }
                else if (e.key === "v" || e.key === "V") {
                    e.preventDefault(); this._activatePasteMode();
                }
                return;
            }

            const graphic = this._contextMenuManager.getLastClickedGraphic();

            switch (e.key) {
                case "m":
                case "M":
                    if (graphic) { e.preventDefault(); this.modifySymbol(graphic); }
                    break;
                case "e":
                case "E":
                    if (graphic) { e.preventDefault(); this.activateEditControlPoints(graphic); }
                    break;
                case "Escape":
                    if (this._editEngine.isModifyingSymbol || this._editEngine.isEditingControlPoints) {
                        e.preventDefault();
                        this.deactivateEdit();
                    }
                    break;
                case "Delete":
                    // Batch delete if multiple selected, otherwise remove the right-clicked graphic
                    if (this._selectionEngine.count > 1) {
                        e.preventDefault();
                        this._selectionEngine.deleteSelected(entry => this._pushUndo(entry));
                    } else if (graphic) {
                        e.preventDefault();
                        this.removeGraphic(graphic);
                    }
                    break;
                case "i":
                case "I":
                    if (graphic) { e.preventDefault(); this.showSymbolDetails(graphic); }
                    break;
                case "c":
                case "C":
                    if (graphic) { e.preventDefault(); this.centerOnGraphic(graphic); }
                    break;
            }
        });
    }

    /** Access the MeasurementEngine — configure units or toggle programmatically.
     *  May be undefined if the feature is disabled in Settings.json or not yet loaded. */
    public get measurementEngine(): MeasurementEngine | undefined {
        return this._measurementEngine;
    }

    // -----------------------------------------------------------------------
    // Undo / Redo
    // -----------------------------------------------------------------------

    /** Push an undo entry and clear the redo stack. */
    private _pushUndo(entry: UndoEntry): void {
        this._undoStack.push(entry);
        this._redoStack = [];
    }

    /** Snapshot the graphic's current geometry and CTRL_PTS before an edit begins. */
    private _capturePreEditSnapshot(graphic: Graphic, operationLabel: string): void {
        const de = graphic.attributes?.drawEssentials;
        this._preEditSnapshot = {
            geometry: graphic.geometry?.clone(),
            ctrlPts: de?.CTRL_PTS ? de.CTRL_PTS.map((p: any) => p.clone?.() ?? p) : null,
            baseLnPts: de?.BASE_LN_PTS ? JSON.parse(JSON.stringify(de.BASE_LN_PTS)) : null,
        };
        (this._preEditSnapshot as any)._graphic = graphic;
        (this._preEditSnapshot as any)._label = operationLabel;
    }

    /**
     * Wire the EditEngine's changeInSymbol event to push an undo entry.
     * Called once in the constructor; re-called after view switch.
     */
    private _wireEditEngineUndo(): void {
        this._editEngine.on("changeInSymbol", ({ graphic }: { graphic: Graphic }) => {
            const snap = this._preEditSnapshot;
            if (!snap || (snap as any)._graphic !== graphic) return;

            const prevGeometry = snap.geometry;
            const prevCtrlPts = snap.ctrlPts;
            const prevBaseLnPts = snap.baseLnPts;
            const label = (snap as any)._label ?? "Edit";

            // Capture the "after" state now (changeInSymbol fires after completion)
            const de = graphic.attributes?.drawEssentials;
            const nextGeometry = graphic.geometry?.clone();
            const nextCtrlPts = de?.CTRL_PTS ? de.CTRL_PTS.map((p: any) => p.clone?.() ?? p) : null;
            const nextBaseLnPts = de?.BASE_LN_PTS ? JSON.parse(JSON.stringify(de.BASE_LN_PTS)) : null;

            const annotationLayer = this._layerManager.getOrCreateLayer(LAYER_NAMES.ANNOTATION_LAYER);
            const graphicId = graphic.attributes?.id;

            const applyState = (geom: any, ctrlPts: any, baseLnPts: any) => {
                graphic.geometry = geom;
                if (de && ctrlPts) de.CTRL_PTS = ctrlPts;
                if (de && baseLnPts) de.BASE_LN_PTS = baseLnPts;
                if (graphicId) {
                    AnnotationEngine.deAnnotate(annotationLayer, graphicId);
                    if (de?.AMPLIFIER) {
                        AnnotationEngine.annotate(
                            annotationLayer, geom, de.AMPLIFIER,
                            de, graphicId, settingsData.textSize,
                            de.ISFHAND || 0, this.labelOptions || {}, {}
                        );
                    }
                }
            };

            this._pushUndo({
                label,
                undo: () => applyState(prevGeometry, prevCtrlPts, prevBaseLnPts),
                redo: () => applyState(nextGeometry, nextCtrlPts, nextBaseLnPts),
            });

            this._preEditSnapshot = null;
        });
    }

    /** Undo the last operation. */
    public undo(): void {
        const entry = this._undoStack.pop();
        if (!entry) return;
        entry.undo();
        this._redoStack.push(entry);
        console.info(`[Undo] ${entry.label}`);
    }

    /** Redo the last undone operation. */
    public redo(): void {
        const entry = this._redoStack.pop();
        if (!entry) return;
        entry.redo();
        this._undoStack.push(entry);
        console.info(`[Redo] ${entry.label}`);
    }

    /** Number of operations available to undo. */
    public get undoCount(): number { return this._undoStack.length; }

    /** Number of operations available to redo. */
    public get redoCount(): number { return this._redoStack.length; }

    /** Label of the next undo operation, or null if the stack is empty. */
    public get nextUndoLabel(): string | null {
        return this._undoStack.length > 0 ? this._undoStack[this._undoStack.length - 1].label : null;
    }

    /** Label of the next redo operation, or null if the stack is empty. */
    public get nextRedoLabel(): string | null {
        return this._redoStack.length > 0 ? this._redoStack[this._redoStack.length - 1].label : null;
    }

    // -----------------------------------------------------------------------
    // Copy / Paste
    // -----------------------------------------------------------------------

    /**
     * Copy a graphic to the internal clipboard.
     * Stores a deep clone of the graphic's geometry, symbol, and drawEssentials.
     */
    public copySymbol(graphic: Graphic): void {
        this._clipboard = {
            graphic: graphic.clone(),
            layerId: graphic.layer?.id ?? this._layerManager.getSymbolLayer().id
        };
        console.info("[CopyPaste] Copied:", graphic.attributes?.id ?? "graphic");
        this.emitEvent("symbolCopied", { graphic });
    }

    /**
     * True when the clipboard holds a graphic ready to paste.
     */
    public get hasClipboard(): boolean {
        return this._clipboard !== null;
    }

    /**
     * Paste the clipboard graphic at a specific map point.
     * Returns the newly created Graphic, or null if the clipboard is empty.
     */
    public pasteSymbol(targetPoint: Point): Graphic | null {
        if (!this._clipboard) return null;

        const source = this._clipboard.graphic;
        const de = source.attributes?.drawEssentials;

        // Clone and offset geometry to the target point
        const newGeom = this._offsetGeometryTo(source.geometry, targetPoint);
        if (!newGeom) return null;

        const newId = this.generateUUID();
        const newGraphic = source.clone();
        newGraphic.geometry = newGeom;
        newGraphic.attributes = {
            ...source.attributes,
            id: newId,
            drawEssentials: de ? { ...de } : undefined,
        };

        const layer = this._layerManager.getOrCreateLayer(this._clipboard.layerId)
            ?? this._layerManager.getSymbolLayer();
        layer.add(newGraphic);

        // Re-annotate
        const annotationLayer = this._layerManager.getOrCreateLayer(LAYER_NAMES.ANNOTATION_LAYER);
        if (de?.AMPLIFIER) {
            AnnotationEngine.annotate(
                annotationLayer, newGeom, de.AMPLIFIER,
                de, newId, settingsData.textSize,
                de.ISFHAND || 0, this.labelOptions || {}, {}
            );
        }

        // Push undo entry
        this._pushUndo({
            label: "Paste Symbol",
            undo: () => {
                layer.remove(newGraphic);
                AnnotationEngine.deAnnotate(annotationLayer, newId);
            },
            redo: () => {
                layer.add(newGraphic);
                if (de?.AMPLIFIER) {
                    AnnotationEngine.annotate(
                        annotationLayer, newGeom, de.AMPLIFIER,
                        de, newId, settingsData.textSize,
                        de.ISFHAND || 0, this.labelOptions || {}, {}
                    );
                }
            }
        });

        console.info("[CopyPaste] Pasted at", targetPoint);
        this.emitEvent("symbolPasted", { graphic: newGraphic });
        return newGraphic;
    }

    /**
     * Enter "paste mode": the next map click pastes the clipboard graphic there.
     * Escape cancels paste mode.
     */
    private _activatePasteMode(): void {
        if (!this._clipboard) return;

        this._closeActiveWorkflow();
        this.emitEvent("pasteMode", { active: true });
        console.info("[CopyPaste] Paste mode active — click map to paste");

        const clickHandle = this.view.on("click", (evt) => {
            clickHandle.remove();
            keyHandle();
            const pt = this.view.toMap({ x: evt.x, y: evt.y });
            if (pt) this.pasteSymbol(pt);
            this.emitEvent("pasteMode", { active: false });
        });

        const keyHandler = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                clickHandle.remove();
                keyHandle();
                this.emitEvent("pasteMode", { active: false });
                console.info("[CopyPaste] Paste mode cancelled");
            }
        };
        document.addEventListener("keydown", keyHandler, { once: false });
        const keyHandle = () => document.removeEventListener("keydown", keyHandler);
    }

    /**
     * Translate all vertices of a geometry so that its centroid lands at targetPoint.
     */
    private _offsetGeometryTo(sourceGeom: any, targetPoint: Point): any {
        if (!sourceGeom) return null;
        try {
            const clone = sourceGeom.clone();
            if (clone.type === "point") {
                clone.x = targetPoint.x;
                clone.y = targetPoint.y;
                if (targetPoint.z !== undefined) clone.z = targetPoint.z;
            } else {
                // Compute centroid from extent
                const ext = clone.extent;
                if (!ext) return clone;
                const dx = targetPoint.x - (ext.xmin + ext.xmax) / 2;
                const dy = targetPoint.y - (ext.ymin + ext.ymax) / 2;
                if (clone.type === "polyline") {
                    clone.paths = clone.paths.map((path: number[][]) =>
                        path.map(([x, y, ...rest]) => [x + dx, y + dy, ...rest])
                    );
                } else if (clone.type === "polygon") {
                    clone.rings = clone.rings.map((ring: number[][]) =>
                        ring.map(([x, y, ...rest]) => [x + dx, y + dy, ...rest])
                    );
                }
            }
            return clone;
        } catch {
            return sourceGeom.clone();
        }
    }



    public enrichSymbolOptions(options: SymbolOptions): SymbolOptions & {
        parsedSIDC?: ParsedSIDC;
        label?: string;
        text?: string;
    } {
        try {
            if (!options.sidc) throw new Error("Missing SIDC in symbol options");

            console.log("SIDC:", options.sidc);
            const parsed = parseSIDC(options.sidc);
            console.log("Parsed SIDC:", parsed);
            console.log("Standard Identity", parsed.setA.standardIdentityLabel);
            console.log("Symbol Set", parsed.setA.symbolSetLabel);
            console.log("Echelon", parsed.setA.echelonMobilityLabel);

            return {
                ...options,
                parsedSIDC: parsed,
                label: `${parsed.setA.standardIdentityLabel ?? ""} ${parsed.setA.symbolSetLabel ?? ""}`.trim(),
                text: parsed.setA.echelonMobilityLabel ?? "",
            };
        } catch (error) {
            console.warn(error);
            console.warn("Invalid SIDC provided:", options.sidc);
            return options;
        }
    }



    createLineSymbol(color: string = "#0000FF", width: number = 2): SimpleLineSymbol {
        return new SimpleLineSymbol({ color: new Color(color), width });
    }

    createFillSymbol(color = "#00FF00", outlineColor = "#000000", outlineWidth = 1): SimpleFillSymbol {
        return new SimpleFillSymbol({
            color: new Color(color),
            outline: new SimpleLineSymbol({ color: new Color(outlineColor), width: outlineWidth }),
        });
    }

    createPictureMarkerSymbol(url: string, width: number, height: number): PictureMarkerSymbol {
        return new PictureMarkerSymbol({ url, width, height });
    }

    addPointToLayer(geometry: __esri.Point): void {
        const layer = this._layerManager.getOrCreateLayer(LAYER_NAMES.FORCE);
        const symbol = this.createPointSymbol();
        const graphic = new Graphic({ geometry, symbol });
        layer.add(graphic);
    }

    addPictureMarkerAtCenter(url: string, width = 20, height = 20, view: MapView | SceneView): void {
        if (!view.center) return console.error("View center is not defined.");
        const geometry = view.center.clone();

        if (SymbolEngine.isView2D(view)) {
            this.addPictureMarkerFor2D(geometry, url, width, height);
        } else {
            this.addPictureMarkerFor3D(geometry, url, width, height);
        }
    }



    drawMilSymbolInteractively(drawEssentials: DrawEssentials, amplifier:Amplifier, attr:object): void {
        const sketchLayer = this._layerManager.getOrCreateLayer(LAYER_NAMES.SKETCH);
        const view = this.view;
        const sketchVM = new SketchViewModel({
            view,
            layer: sketchLayer,
            pointSymbol: this.generateForceSymbol(drawEssentials, amplifier, attr),
        });

        sketchVM.create("point");

        sketchVM.on("create", (event) => {
            if (event.state === "complete") {
                const point = event.graphic.geometry as __esri.Point;
                this.addMilSymbolAtPoint(point, drawEssentials, amplifier, attr);
                sketchLayer.remove(event.graphic);
                sketchVM.destroy();
            }
        });
    }
    private addMilSymbolFor2D(geometry: __esri.Point, drawEssentials: DrawEssentials, amplifier:Amplifier, attr:object): void {
        const layer = this._layerManager.getSymbolLayer();
        const symbol = this.generateForceSymbol(drawEssentials, amplifier, attr);

        const graphic = new Graphic({ geometry, symbol, attributes:attr });
        layer.add(graphic);
    }

    addMilSymbolAtPoint(point: __esri.Point, drawEssentials: DrawEssentials, amplifier:Amplifier, attr:object): void {
        try {
            this.addMilSymbolFor2D(point, drawEssentials, amplifier, attr);
            /*
            if (SymbolEngine.isView2D(view)) {
                this.addMilSymbolFor2D(point, options, dataUrl, width, height);
            } else {
                this.addMilSymbolFor3D(point, options, dataUrl, width, height);
            }
            */
        } catch (err) {
            console.error("Error drawing milsymbol:", err);
        }
    }

    addMilSymbolAtCenter(options: SymbolOptions): void {
        if (!this.view.center) return console.error("View center is not defined.");
        const geometry = this.view.center.clone();

        try {

            this.addMilSymbolFor2D(geometry, options);

            /*
            if (SymbolEngine.isView2D(view)) {
                this.addMilSymbolFor2D(geometry, options, dataUrl, width, height);
            } else {
                this.addMilSymbolFor3D(geometry, options, dataUrl, width, height);
            }
             */

        } catch (error) {
            console.error("Error creating milsymbol:", error);
        }
    }

    protected svgToDataURL(svg: string): string {
        const encodedSVG = encodeURIComponent(svg);
        return `data:image/svg+xml;charset=utf-8,${encodedSVG}`;
    }



    protected addMilSymbolFor3D(geometry: __esri.Point, options: SymbolOptions): void {
        const layer = this._layerManager.getOrCreateLayer("milSymbols");
        const symbol = this.generateForceSymbol(options, 3);

        const graphic = new Graphic({ geometry, symbol, attributes: {
                type: "force"
            }
        });
        layer.add(graphic);
    }

    private addPictureMarkerFor2D(geometry: __esri.Point, url: string, width: number, height: number): void {
        const layer = this._layerManager.getOrCreateLayer(LAYER_NAMES.FORCE);
        const symbol = new PictureMarkerSymbol({ url, width, height });

        const graphic = new Graphic({ geometry, symbol, attributes: {
                type: "force"
            } });
        layer.add(graphic);
    }

    private addPictureMarkerFor3D(geometry: __esri.Point, url: string, width: number, height: number): void {
        const layer = this._layerManager.getOrCreateLayer(LAYER_NAMES.FORCE);

        const symbol = new PointSymbol3D({
            symbolLayers: [
                new IconSymbol3DLayer({
                    resource: { href: url },
                    size: width,
                    anchor: "bottom"
                })
            ],
            verticalOffset: {
                screenLength: height,
                maxWorldLength: 500,
                minWorldLength: 50
            }
        });

        const graphic = new Graphic({ geometry, symbol });
        layer.add(graphic);
    }

    applySymbol(graphic: Graphic, symbol: SimpleMarkerSymbol | SimpleLineSymbol | SimpleFillSymbol): void {
        graphic.symbol = symbol;
    }

    static isView2D(view: View): boolean {
        return view.type === "2d";
    }

    static isView3D(view: View): boolean {
        return view instanceof SceneView ;
    }

    ensureMsAvailable(): void {
        // Check for both UEITypes.js and milsymbol.js
        if (typeof (window as any).MS === 'undefined') {
            throw new Error("MS (UEITypes) library is not properly loaded or invalid.");
        }
        
        console.log("MS (milsymbol.js) version:", (window as any).MS.version);
        console.log("MS (milsymbol.js) standard:", (window as any).MS._STD2525 ? "2525" : "APP6");
        console.log("MS (milsymbol.js) marker parts count:", (window as any).MS.getMarkerParts().length);
    }

    generateForceSymbol(drawEssentials: DrawEssentials, amplifier: Amplifier, attr:object): PictureMarkerSymbol | undefined {
        try {
            // Use milsymbol.js instead of UEITypes
            const sidc = amplifier.SIDC;
            if (!sidc) {
                console.error("SIDC is required for symbol generation");
                return undefined;
            }

            // Create milsymbol.js options
            const msOptions = {
                size: drawEssentials.SIZE || 35
            };

            // Generate the symbol using milsymbol.js
            const symbol = new window.MS.symbol(sidc, msOptions);

            /*// Initialize the marker to generate drawInstructions
            symbol.getMarker();
            // Generate SVG
            const svgString = symbol.asSVG();
            console.log("Generated SVG from milsymbol.js:", svgString);
            // Convert SVG to data URL
            const dataUrl = "data:image/svg+xml;base64," + btoa(svgString);

            // Get symbol dimensions
            const width = symbol.width || 35;
            const height = symbol.height || 35;

            // Calculate offsets based on anchor point
            const anchor = symbol.markerAnchor || { x: width / 2, y: height / 2 };
            const xoffset = (width / 2) - anchor.x;
            const yoffset = (height / 2) - anchor.y;

            const pictureMarkerSymbol = new PictureMarkerSymbol({
                url: dataUrl,
                width: width + "px",
                height: height + "px",
                xoffset,
                yoffset
            });*/
            symbol.getMarker();
            // Generate SVG
            const canvas = symbol.asCanvas();

            // Convert SVG to data URL
            const dataUrl = canvas.toDataURL();

            // Get symbol dimensions
            const width = symbol.width || 35;
            const height = symbol.height || 35;

            // Calculate offsets based on anchor point
            const anchor = symbol.markerAnchor || { x: width / 2, y: height / 2 };
            const xoffset = (width / 2) - anchor.x;
            const yoffset = (height / 2) - anchor.y;

            const pictureMarkerSymbol = new PictureMarkerSymbol({
                url: dataUrl,
                width: width + "px",
                height: height + "px",
                xoffset,
                yoffset
            });
            return pictureMarkerSymbol;

        } catch (e) {
            console.error("Error generating force symbol with milsymbol.js:", e);
            return undefined;
        }
    }

    public initialize(drawEssentials: DrawEssentials, amplifier: Amplifier, isPassive?: boolean): void {
        try {
            if (isPassive === undefined) {
                isPassive = false;
            }

            // Close any active edit/move workflow before starting a new draw
            if (!isPassive) this._closeActiveWorkflow();

            // Moved initialization of symbolData to constructor to avoid re-parsing
            // this.symbolData = JSON.parse(symData); // symData is already imported as JSON object

            // Ensure SIDC and currentSymbol are properly set before proceeding
            // This part assumes that SIDC and amplifier are already set up in a way that getSID/getSIDC return meaningful values
            // Or, they need to be passed into initialize if they vary per call.
            // For now, I'll use the dummy SIDC initialized in the constructor.
            // If you have a concrete SIDC instance, use that here.
            this.sidc  = new SIDC(amplifier.SIDC); // Assuming Amplifier has a SIDC property and SIDC class can be instantiated this way.
            this.amplifier = amplifier; // Set the amplifier for later use

            const reqSID = this.sidc.getSID();
            const coSIDC = this.sidc.getSIDC();
            const symSet = coSIDC.substring(4, 6); // Changed substr to substring for correctness in modern JS

            // Find the current symbol definition
            this.currentSymbol = symbolData[symSet + reqSID];



            if (this.currentSymbol) { // Wrap the rest of the logic in this check
                const symbol = this.getSymbol(drawEssentials.IS_LINE);
                symbol.amplifier = amplifier;



                /*
                // Set up event handlers
                this.endEvent = symbol.on("onDrawEnd", (data: any) => this.drawSymEnd(data));
                this.drawProgressEvent = symbol.on("onDrawProgress", (data: any) => this.symDrawProgress(data));
                this.drawClickEvent = symbol.on("onDrawClick", (data: any) => this.symDrawClick(data));
                this.drawBaseLineEndEvent = symbol.on("onBaseLineDrawEnd", (data: any) => this.baseLineDrawEnd(data));
                */

                let marker: any = null;

                if (drawEssentials.extraSettings !== undefined) {
                    if (drawEssentials.extraSettings.textSize !== undefined) {
                        settingsData.textSize = drawEssentials.extraSettings.textSize;
                    }
                }

                // Make sure labelOptions is defined; assuming it might be part of SymbolEngine's state or a parameter
                // If labelOptions is not passed as a parameter to initialize, you need to decide how it's initialized.
                // For now, I'll keep it as `this.labelOptions = labelOptions || {};` and assume `labelOptions` is an existing variable in this scope.
                // If it's not, you'll need to pass it or define a default.
                // For the purpose of this snippet, let's assume it comes from `drawEssentials` or is a class property.
                this.labelOptions = drawEssentials.labelOptions || {};


                if (this.currentSymbol.SymGeoType === "Point" || this.currentSymbol.SymGeoType === "FPoint") {
                    marker = this.sidc.getMarker(symbol.symGeometricType, symbol.isObstacle, this.currentSymbol.Fill);

                    /*
                    extraSettings parameters is added to pass line width and force symbol size from interface, remove it and relevant conditions
                    to let SIDC class read settings from settings.json
                    */

                    if (drawEssentials.extraSettings !== undefined) { // Changed 'extraSettings' to 'drawEssentials.extraSettings'
                        if (this.currentSymbol.SymGeoType === "Point") {
                            if (drawEssentials.extraSettings.hasOwnProperty('lineWidth')) {
                                marker.outline.width = drawEssentials.extraSettings.lineWidth;
                            }

                            if (drawEssentials.extraSettings.hasOwnProperty('size')) {
                                drawEssentials.SIZE = drawEssentials.extraSettings.size;
                            }

                            if (drawEssentials.extraSettings.hasOwnProperty('opacity')) {
                                marker.outline.color.a = drawEssentials.extraSettings.opacity;
                                if (drawEssentials.SID !== "000110") marker.color.a = drawEssentials.extraSettings.opacity;
                                drawEssentials.opacity = drawEssentials.extraSettings.opacity;
                            }

                        }
                        if (this.currentSymbol.SymGeoType === "FPoint") {
                            if (drawEssentials.extraSettings.hasOwnProperty('size')) {
                                drawEssentials.SIZE = drawEssentials.extraSettings.size; // Changed drawEssentials.size to drawEssentials.SIZE
                            }

                            if (drawEssentials.extraSettings.hasOwnProperty('opacity')) {
                                drawEssentials.opacity = drawEssentials.extraSettings.opacity;
                            }

                        }

                    }


                    if (isPassive === true) {
                        debugger;
                        // Assuming this.reProject and this.map exist
                        if (drawEssentials.hasOwnProperty('GEOM') && drawEssentials.GEOM) {
                            drawEssentials.GEOM = this.reProject(drawEssentials.GEOM, this.view.spatialReference); // Changed this.map to this.view
                        }
                        if (drawEssentials.hasOwnProperty('OPTIONS') && drawEssentials.OPTIONS?.hasOwnProperty('GEOM') && drawEssentials.OPTIONS.GEOM) {
                            drawEssentials.OPTIONS.GEOM = this.reProject(drawEssentials.OPTIONS.GEOM, this.view.spatialReference); // Changed this.map to this.view
                            debugger;
                        }

                    }

                    symbol.init(drawEssentials, marker, this.sidc.getSID(),
                        this.currentSymbol.Name, this.currentSymbol.Offset, this.sidc._sidc);
                } else {
                    marker = this.sidc.getMarker(symbol.symGeometricType, symbol.isObstacle);

                    /*
                    extraSettings parameters is added to pass line width and force symbol size from interface, remove it and relevant conditions
                    to let SIDC class read settings from settings.json
                    */
                    if (drawEssentials.extraSettings !== undefined) { // Changed 'extraSettings' to 'drawEssentials.extraSettings'

                        if (drawEssentials.extraSettings.hasOwnProperty('lineWidth')) {
                            marker.width = drawEssentials.extraSettings.lineWidth;
                        }

                        if (drawEssentials.extraSettings.hasOwnProperty('opacity')) {
                            marker.color.a = drawEssentials.extraSettings.opacity;
                            drawEssentials.opacity = drawEssentials.extraSettings.opacity;
                        }

                    }

                    if (isPassive === true) {
                        debugger;

                        if (drawEssentials.hasOwnProperty('CTRL_PTS') && drawEssentials.CTRL_PTS) {
                            for (var j = 0; j < drawEssentials.CTRL_PTS.length; j++) {
                                drawEssentials.CTRL_PTS[j] = this.reProject(drawEssentials.CTRL_PTS[j], this.view.spatialReference); // Changed this.map to this.view
                            }
                        }

                        if (drawEssentials.hasOwnProperty('BASE_LN_PTS') && drawEssentials.BASE_LN_PTS) {
                            debugger;
                            if (drawEssentials.BASE_LN_PTS.hasOwnProperty('startPt') && drawEssentials.BASE_LN_PTS.startPt) drawEssentials.BASE_LN_PTS.startPt = this.reProject(drawEssentials.BASE_LN_PTS.startPt, this.view.spatialReference); // Changed this.map to this.view
                            if (drawEssentials.BASE_LN_PTS.hasOwnProperty('midPt') && drawEssentials.BASE_LN_PTS.midPt) drawEssentials.BASE_LN_PTS.midPt = this.reProject(drawEssentials.BASE_LN_PTS.midPt, this.view.spatialReference); // Changed this.map to this.view
                            if (drawEssentials.BASE_LN_PTS.hasOwnProperty('endPt') && drawEssentials.BASE_LN_PTS.endPt) drawEssentials.BASE_LN_PTS.endPt = this.reProject(drawEssentials.BASE_LN_PTS.endPt, this.view.spatialReference); // Changed this.map to this.view
                        }
                    }
                    symbol.init(drawEssentials, marker);
                }
            } else {
                console.warn(`Symbol data not found for SIDC part: ${symSet + reqSID}`);
            }

        } catch (e) {
            console.error("Error parsing labels for symbol generation", e);
        }
    }

    public getSymbol(isLine?: boolean): any {
        if (this.currentSymbol !== undefined) {
            this.mapper = new Mapper(this.currentSymbol.Class);
            const SymbolClass = this.mapper.getInstance();
            return new SymbolClass(this.view, isLine);
        } else {
            throw new Error("SIDC not found");
        }
    }


    createSymbolCacheKey(options: SymbolOptions, scaleFactor: number): string {
        const relevantOptions = {
            sidc: options.sidc,
            scaleFactor,
            quantity: options.quantity,
            staffComments: options.staffComments,
            additionalInformation: options.additionalInformation,
            type: options.type,
            dtg: options.dtg,
            location: options.location,
            outlineColor: options.outlineColor,
            outlineWidth: options.outlineWidth,
        };

        return JSON.stringify(relevantOptions);
    }

    private drawSymEnd(event: any): void {
        try {
            // Handle both event types - extract common properties
            const { geometry, marker, drawEssentials, symbolType } = event;
            
            // Validation from handleDrawEnd
            if (!geometry || !marker) {
                console.warn("Missing geometry or marker in draw end event");
                return;
            }

            // Handle different geometry types
            let symbol;
            if (geometry.type === "point" || geometry.type === "polyline" || geometry.type === "polygon") {
                symbol = marker;
            } else {
                console.error("Unhandled geometry type:", geometry.type);
                return;
            }

            // Create the graphic
            const graphic = new Graphic({
                geometry: geometry,
                symbol: symbol
            });
            this.isDrawing = false;

            // Generate a temporary ID
            const tempId = this.generateUUID();
            
            // Set up drawEssentials and attributes
            if (drawEssentials) {
                // Set SIDC if we have it
                if (this.sidc && this.sidc.getSIDC) {
                    drawEssentials.SIDC = this.sidc.getSIDC();
                }
                
                // Set AMPLIFIER if we have it
                if (this.amplifier) {
                    drawEssentials.AMPLIFIER = this.amplifier;
                }
                
                graphic.set("drawEssentials", drawEssentials);
            }

            // Set up graphic attributes - handle both old style (this.attrs) and new style
            const attrs: any = {
                drawEssentials: drawEssentials,
                type: symbolType || "symbol"
            };

            // Handle ID assignment - check for existing attrs or use temp ID
            if (this.attrs && this.attrs.hasOwnProperty('symbolId') && this.attrs.symbolId !== undefined && this.attrs.symbolId !== null) {
                attrs.id = this.attrs.symbolId;
            } else {
                attrs.id = tempId;
            }

            // Merge additional attributes if they exist
            if (this.attrs) {
                Object.assign(attrs, this.attrs);
            }

            graphic.attributes = attrs;
            graphic.set("id", attrs.id);

            // Get the appropriate layer from LayerManager
            const graphicsLayer = this._layerManager.getSymbolLayer();
            graphicsLayer.add(graphic);
            console.info("Symbol Added")

            // Push undo entry for the Add operation
            const symLabel = drawEssentials?.SIDC ? `Symbol (${drawEssentials.SIDC.slice(0, 6)})` : "Symbol";
            const annotationLayer = this._layerManager.getOrCreateLayer(LAYER_NAMES.ANNOTATION_LAYER);
            this._pushUndo({
                label: `Add ${symLabel}`,
                undo: () => {
                    graphicsLayer.remove(graphic);
                    AnnotationEngine.deAnnotate(annotationLayer, attrs.id);
                },
                redo: () => {
                    graphicsLayer.add(graphic);
                    if (drawEssentials?.AMPLIFIER) {
                        AnnotationEngine.annotate(
                            annotationLayer, geometry, drawEssentials.AMPLIFIER,
                            drawEssentials, attrs.id, settingsData.textSize,
                            drawEssentials.ISFHAND || 0, this.labelOptions || {}, {}
                        );
                    }
                }
            });



            // Clean up event handlers if they exist
            this._endEventHandle?.remove();
            this._drawProgressEventHandle?.remove();
            this._drawClickEventHandle?.remove();
            this._drawBaseLineEndEventHandle?.remove();

            // Handle annotation if drawEssentials and amplifier are available
            if (drawEssentials && drawEssentials.AMPLIFIER) {
                const isFreeHand = drawEssentials.ISFHAND || 0;
                drawEssentials.labelOptions = this.labelOptions;

                const options = this.getOpacityValue(graphic);

                // Get the annotation layer from LayerManager
                const annotationLayer = this._layerManager.getOrCreateLayer(LAYER_NAMES.ANNOTATION_LAYER);
                
                AnnotationEngine.annotate(
                    annotationLayer,
                    geometry,
                    drawEssentials.AMPLIFIER,
                    drawEssentials,
                    attrs.id,
                    settingsData.textSize,
                    isFreeHand,
                    this.labelOptions || {},
                    options
                );
            }

            // Clean up opacity if it exists
            if (drawEssentials && drawEssentials.hasOwnProperty('opacity')) {
                delete drawEssentials.opacity;
            }

            console.log("Graphic added to layer:", {
                id: attrs.id,
                geometryType: geometry.type,
                symbolType: symbolType || "unknown"
            });

            // Emit custom events for further processing
            this.emit("symDrawEnd", {
                'isDone': "done",
                'drawEssentials': drawEssentials,
                'id': attrs.id,
                'graphic': graphic
            });

            this.emitEvent("symbolCreated", {
                graphic: graphic,
                id: attrs.id,
                drawEssentials: drawEssentials,
                isDone: "done"
            });

        } catch (error) {
            console.error("Error in drawSymEnd:", error);
        }
    }

    private getOpacityValue(graphic: Graphic): { opacity?: number } {
        const options: { opacity?: number } = {};
        if (graphic.geometry.type === 'polyline' || graphic.geometry.type === 'polygon') {
            const symbol = graphic.symbol as SimpleLineSymbol; // Or SimpleFillSymbol
            if (symbol && symbol.color) {
                options.opacity = symbol.color.a;
            }
        } else if (graphic.attributes?.drawEssentials?.SYM_GEO_TYPE === 'Point') {
            const symbol = graphic.symbol as SimpleMarkerSymbol;
            if (symbol && symbol.outline?.color) {
                options.opacity = symbol.outline.color.a;
            }
        }
        return options;
    }

    private symDrawProgress(event: { currentDrawEssentials: DrawEssentials, currentGeometry: any, currentMarker: any }): void {
        this.emit("symDrawProgress", {
            "currentDrawEssentials": event.currentDrawEssentials,
            "currentGeometry": event.currentGeometry,
            "currentMarker": event.currentMarker
        });
    }

    private symDrawClick(event: { currentPts: Point[] }): void {
        this.emit("symDrawClick", {
            "currentPts": event.currentPts
        });
    }

    private baseLineDrawEnd(event: { currentPts: Point[] }): void {
        this.emit("baseLineDrawEnd", {
            "currentPts": event.currentPts
        });
    }

    private generateUUID(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Test method to demonstrate milsymbol.js integration
     * This replicates the functionality from main.ts
     */
    public testMilSymbol(): void {
        console.log("Testing milsymbol.js integration in SymbolEngine...");
        
        // Check if MS object is available
        if (typeof window.MS === 'undefined') {
            console.error("MS object not found. Make sure milsymbol.js is loaded.");
            return;
        }
        
        console.log("MS version:", window.MS.version);
        console.log("MS standard:", window.MS._STD2525 ? "2525" : "APP6");
        console.log("MS marker parts count:", window.MS.getMarkerParts().length);
        console.log("MS color modes available:", Object.keys(window.MS._colorModes || {}));
        
        // Test creating a simple military symbol
        //const sidc = "130310001412050000000000000000"; // User-provided SIDC
        const sidc = "10121000001205000000"; // User-provided SIDC
        //
        const options = {
            size: 60
        };
        
        try {
            // Generate the symbol using the correct API
            const symbol = new window.MS.symbol(sidc, options);
            console.log("Generated symbol:", symbol);
            
            // Check if symbol was created properly
            if (!symbol) {
                console.error("Failed to create symbol object");
                return;
            }
            
            // Get symbol properties
            const properties = symbol.getProperties();
            console.log("Symbol properties:", properties);
            
            // Initialize the marker to generate drawInstructions
            symbol.getMarker();
            console.log("Marker initialized, drawInstructions length:", symbol.drawInstructions?.length || 0);
            console.log("DrawInstructions:", symbol.drawInstructions);
            console.log("Symbol properties after getMarker:", symbol.properties);
            console.log("Symbol colors after getMarker:", symbol.colors);
            
            // Test color modes
            const lightColors = window.MS.getColorMode("Light");
            console.log("Light color mode:", lightColors);
            
            // Test dash arrays
            const dashArrays = window.MS.getDashArrays();
            console.log("Dash arrays:", dashArrays);
            
            // Test setting a new standard
            const standardSet = window.MS.setStandard("2525");
            console.log("Standard set to 2525:", standardSet);
            
            // Create a test graphic on the map
            const view = this.view;
            if (view && symbol) {
                // Create a graphics layer for test symbols
                let testLayer = view.map.findLayerById("testSymbolLayer") as GraphicsLayer;
                if (!testLayer) {
                    testLayer = new GraphicsLayer({ id: "testSymbolLayer" });
                    view.map.add(testLayer);
                }
                
                // Get SVG string from the symbol
                const svgString = symbol.asSVG();
                console.log("Generated SVG:", svgString);
                
                // Convert SVG to data URL for PictureMarkerSymbol
                const dataUrl = "data:image/svg+xml;base64," + btoa(svgString);
                
                // Create a point at the center of the view
                const center = view.center;
                const point = new Point({
                    longitude: center.longitude,
                    latitude: center.latitude,
                    spatialReference: view.spatialReference
                });
                
                // Create the symbol
                const pictureSymbol = new PictureMarkerSymbol({
                    url: dataUrl,
                    width: "35px",
                    height: "35px"
                });
                
                // Create and add the graphic
                const graphic = new Graphic({
                    geometry: point,
                    symbol: pictureSymbol,
                    attributes: {
                        type: "testSymbol",
                        sidc: sidc,
                        description: "Test military symbol created with milsymbol.js in SymbolEngine"
                    }
                });
                
                testLayer.add(graphic);
                console.log("Test symbol added to map at center point from SymbolEngine");
            }
            
        } catch (error) {
            console.error("Error testing milsymbol.js in SymbolEngine:", error);
        }
    }

    /**
     * Getter function to expose symbol data
     * @returns The complete symbol data object
     */
    public getSymbolData(): any {
        return symbolData;
    }

    /**
     * Get symbol data by key
     * @param key The symbol key to retrieve
     * @returns The symbol data for the specified key or null if not found
     */
    public getSymbolByKey(key: string): any {
        return symbolData[key] || null;
    }

    /**
     * Get all symbol names for autocomplete
     * @returns Array of objects with key and name for autocomplete
     */
    public getSymbolNamesForAutocomplete(): Array<{key: string, name: string}> {
        return Object.entries(symbolData).map(([key, data]: [string, any]) => ({
            key: key,
            name: data.Name || 'Unnamed Symbol'
        }));
    }

    // -----------------------------------------------------------------------
    // Feature 5 — Save / Load Symbol Configurations
    // -----------------------------------------------------------------------

    /** Serialize a single graphic to a plain JSON-safe object. */
    public saveSymbolToJSON(graphic: Graphic): object {
        const de: any = graphic.attributes?.drawEssentials;
        const amplifier: any = de?.AMPLIFIER;

        const serializePt = (pt: any) =>
            pt ? { x: pt.x, y: pt.y, spatialReference: pt.spatialReference?.toJSON?.() } : null;

        const ctrlPtsSerialized = de?.CTRL_PTS
            ? de.CTRL_PTS.map(serializePt)
            : undefined;

        const baseLnPtsSerialized = de?.BASE_LN_PTS ? {
            startPt: serializePt(de.BASE_LN_PTS.startPt),
            midPt:   serializePt(de.BASE_LN_PTS.midPt),
            endPt:   serializePt(de.BASE_LN_PTS.endPt),
        } : undefined;

        const deJson: any = { ...de };
        delete deJson.SCOPE;
        delete deJson.AMPLIFIER;
        delete deJson.CTRL_PTS;
        delete deJson.BASE_LN_PTS;
        deJson._CTRL_PTS = ctrlPtsSerialized;
        deJson._BASE_LN_PTS = baseLnPtsSerialized;

        return {
            pams8Version: "1.0",
            layerId:      graphic.layer?.id ?? this._layerManager.getSymbolLayer().id,
            id:           graphic.attributes?.id,
            graphicType:  graphic.attributes?.type ?? "symbol",
            geometry:     graphic.geometry?.toJSON?.(),
            geometryType: graphic.geometry?.type,
            symbol:       graphic.symbol?.toJSON?.(),
            symbolType:   graphic.symbol?.type,
            drawEssentials: deJson,
            amplifier:    amplifier ? { ...amplifier } : null,
        };
    }

    /** Reconstruct a Graphic from a serialised object and add it to the correct layer. */
    public loadSymbolFromJSON(data: any): Graphic | null {
        try {
            let geometry: any;
            if (data.geometry && data.geometryType) {
                if      (data.geometryType === "point")    geometry = new Point(data.geometry);
                else if (data.geometryType === "polyline") geometry = new Polyline(data.geometry);
                else if (data.geometryType === "polygon")  geometry = new Polygon(data.geometry);
            }

            let symbol: any;
            if (data.symbol && data.symbolType) {
                if      (data.symbolType === "picture-marker") symbol = new PictureMarkerSymbol(data.symbol);
                else if (data.symbolType === "simple-line")    symbol = new SimpleLineSymbol(data.symbol);
                else if (data.symbolType === "simple-fill")    symbol = new SimpleFillSymbol(data.symbol);
                else if (data.symbolType === "simple-marker")  symbol = new SimpleMarkerSymbol(data.symbol);
            }

            const amplifier = new Amplifier();
            if (data.amplifier) Object.assign(amplifier, data.amplifier);

            const de = new DrawEssentials();
            if (data.drawEssentials) {
                const { _CTRL_PTS, _BASE_LN_PTS, ...rest } = data.drawEssentials;
                Object.assign(de, rest);
                if (_CTRL_PTS) {
                    (de as any).CTRL_PTS = (_CTRL_PTS as any[])
                        .map((p: any) => p ? new Point({ x: p.x, y: p.y, spatialReference: p.spatialReference }) : null)
                        .filter(Boolean);
                }
                if (_BASE_LN_PTS) {
                    (de as any).BASE_LN_PTS = {
                        startPt: _BASE_LN_PTS.startPt ? new Point(_BASE_LN_PTS.startPt) : undefined,
                        midPt:   _BASE_LN_PTS.midPt   ? new Point(_BASE_LN_PTS.midPt)   : undefined,
                        endPt:   _BASE_LN_PTS.endPt   ? new Point(_BASE_LN_PTS.endPt)   : undefined,
                    };
                }
            }
            (de as any).AMPLIFIER = amplifier;

            const id = data.id || this.generateUUID();
            const graphic = new Graphic({
                geometry,
                symbol,
                attributes: { id, type: data.graphicType || "symbol", drawEssentials: de },
            });

            const layer = this._layerManager.getOrCreateLayer(data.layerId)
                ?? this._layerManager.getSymbolLayer();
            layer.add(graphic);

            const annotationLayer = this._layerManager.getOrCreateLayer(LAYER_NAMES.ANNOTATION_LAYER);
            if (geometry && amplifier.SIDC) {
                AnnotationEngine.annotate(
                    annotationLayer, geometry, amplifier,
                    de, id, settingsData.textSize,
                    (de as any).ISFHAND || 0, this.labelOptions || {}, {}
                );
            }

            return graphic;
        } catch (e) {
            console.error("[SaveLoad] loadSymbolFromJSON failed:", e);
            return null;
        }
    }

    /** Serialise every graphic across all symbol layers into an array. */
    public exportLayerToJSON(): object[] {
        const result: object[] = [];
        const layerIds = [LAYER_NAMES.TACT, LAYER_NAMES.TACT_PT, LAYER_NAMES.FORCE, "milSymbols"];
        for (const layerId of layerIds) {
            const layer = this._layerManager.getOrCreateLayer(layerId) as any;
            if (!layer?.graphics) continue;
            (layer.graphics as any).forEach((g: Graphic) => {
                try { result.push(this.saveSymbolToJSON(g)); } catch { /* skip */ }
            });
        }
        return result;
    }

    /** Reconstruct all graphics from a serialised array. */
    public importLayerFromJSON(data: object[]): void {
        data.forEach(item => this.loadSymbolFromJSON(item as any));
        console.info(`[SaveLoad] Imported ${data.length} symbols`);
    }

    /** Trigger a browser download of all graphics as a JSON file. */
    public saveToFile(filename?: string): void {
        const data = this.exportLayerToJSON();
        this._downloadJSON(data, filename ?? `pams8_symbols_${Date.now()}.json`);
        console.info(`[SaveLoad] Exported ${data.length} symbols`);
    }

    /** Trigger a browser download of a single graphic as a JSON file. */
    public saveSymbolToFile(graphic: Graphic): void {
        const data = this.saveSymbolToJSON(graphic);
        this._downloadJSON(data, `pams8_symbol_${Date.now()}.json`);
    }

    /** Open a file picker; load symbols from the chosen JSON file. */
    public loadFromFile(): void {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.onchange = (e: Event) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (evt) => {
                try {
                    const parsed = JSON.parse(evt.target?.result as string);
                    if (Array.isArray(parsed)) this.importLayerFromJSON(parsed);
                    else this.loadSymbolFromJSON(parsed);
                } catch (err) {
                    console.error("[SaveLoad] Failed to parse JSON file:", err);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    private _downloadJSON(data: any, filename: string): void {
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    // -----------------------------------------------------------------------
    // Feature 7 — Symbol Templates
    // -----------------------------------------------------------------------

    private readonly _TEMPLATES_KEY = "pams8_templates";

    /** Save the amplifier + size of the given graphic as a named template. */
    public saveAsTemplate(name: string, graphic: Graphic): void {
        const de: any = graphic.attributes?.drawEssentials;
        const templates = this._loadTemplatesStore();
        templates[name] = {
            name,
            size:      de?.SIZE,
            amplifier: de?.AMPLIFIER ? { ...de.AMPLIFIER } : {},
        };
        localStorage.setItem(this._TEMPLATES_KEY, JSON.stringify(templates));
        console.info(`[Templates] Saved template: "${name}"`);
    }

    /** Apply a saved template's amplifier + size to an existing graphic and re-annotate. */
    public applyTemplate(name: string, graphic: Graphic): void {
        const t = this._loadTemplatesStore()[name];
        if (!t) { console.warn(`[Templates] Not found: "${name}"`); return; }

        const de: any = graphic.attributes?.drawEssentials;
        if (!de) return;

        if (t.size !== undefined) de.SIZE = t.size;

        const amplifier = new Amplifier();
        Object.assign(amplifier, t.amplifier);
        de.AMPLIFIER = amplifier;

        const id = graphic.attributes?.id;
        const annotationLayer = this._layerManager.getOrCreateLayer(LAYER_NAMES.ANNOTATION_LAYER);
        if (id) {
            AnnotationEngine.deAnnotate(annotationLayer, id);
            if (amplifier.SIDC) {
                AnnotationEngine.annotate(
                    annotationLayer, graphic.geometry, amplifier,
                    de, id, settingsData.textSize,
                    de.ISFHAND || 0, this.labelOptions || {}, {}
                );
            }
        }
        console.info(`[Templates] Applied template: "${name}"`);
    }

    public listTemplates(): string[] {
        return Object.keys(this._loadTemplatesStore());
    }

    public deleteTemplate(name: string): void {
        const templates = this._loadTemplatesStore();
        delete templates[name];
        localStorage.setItem(this._TEMPLATES_KEY, JSON.stringify(templates));
    }

    private _loadTemplatesStore(): Record<string, any> {
        try { return JSON.parse(localStorage.getItem(this._TEMPLATES_KEY) || "{}"); }
        catch { return {}; }
    }

    private _promptSaveTemplate(graphic: Graphic): void {
        const name = window.prompt("Enter template name:");
        if (name?.trim()) this.saveAsTemplate(name.trim(), graphic);
    }

}

export default SymbolEngine;

