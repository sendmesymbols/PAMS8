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




    constructor(viewProvider: () => MapView | SceneView) {
        this._getView = viewProvider;
        this._layerManager = GraphicsLayerManager.getInstance(this.view);
        this._layerManager.initializeLayers();
        this._editEngine = new EditEngine(viewProvider, this._layerManager);
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
        // Re-attach measurement engine to the new view
        this._measurementEngine?.onViewChanged(newView);
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
        // Register menu items for military symbols
        const milSymbolMenuItems: ContextMenuItem[] = [
            {
                id: "show-details",
                label: "Show Details",
                icon: '<span style="font-size:14px">ℹ️</span>',
                action: (graphic) => this.showSymbolDetails(graphic)
            },
            {
                id: "center-on",
                label: "Center On",
                icon: '<span style="font-size:14px">🎯</span>',
                action: (graphic) => this.centerOnGraphic(graphic)
            },
            {
                id: "remove-graphic",
                label: "Remove",
                icon: '<span style="font-size:14px">🗑️</span>',
                action: (graphic) => this.removeGraphic(graphic),
                group: "Edit Actions",
                order: 2
            },
            {
                id: "modify-symbol",
                label: "Modify Symbol",
                icon: '<span style="font-size:14px">✏️</span>',
                action: (graphic) => this.modifySymbol(graphic),
                group: "Edit Actions",
                order: 1
            },
            {
                id: "edit-ctrl-pts",
                label: "Edit Control Points",
                icon: '<span style="font-size:14px">⬡</span>',
                action: (graphic) => this.activateEditControlPoints(graphic),
                group: "Edit Actions",
                order: 2
            },
            {
                id: "deactivate-ctrl-pts",
                label: "Deactivate Control Points",
                icon: '<span style="font-size:14px">✖</span>',
                visible: (_graphic) => this._editEngine.isEditingControlPoints,
                action: (_graphic) => this.deactivateEdit(),
                group: "Edit Actions",
                order: 3
            }
        ];

        // Register menu items for force symbols
        const forceMenuItems: ContextMenuItem[] = [
            {
                id: "show-details",
                label: "Show Details",
                icon: '<span style="font-size:14px">ℹ️</span>',
                action: (graphic) => this.showSymbolDetails(graphic)
            },
            {
                id: "center-on",
                label: "Center On",
                icon: '<span style="font-size:14px">🎯</span>',
                action: (graphic) => this.centerOnGraphic(graphic)
            },
            {
                id: "remove-graphic",
                label: "Remove",
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

        if (graphic.layer) {
            (graphic.layer as __esri.GraphicsLayer).remove(graphic);
        }
    }

    /**
     * Activate interactive editing for a graphic.
     * Point symbols → move.  Poly/polygon symbols → move + rotate + scale.
     * Called automatically from the right-click context menu "Modify Symbol" item.
     */
    private modifySymbol(graphic: Graphic): void {
        console.log("SymbolEngine: activating edit for", graphic.attributes?.id ?? "graphic");
        this._editEngine.activate(graphic);
    }

    /**
     * Activate control-point editing (CTRL_PTS drag handles) for a poly/polygon graphic.
     */
    public activateEditControlPoints(graphic: Graphic): void {
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

    /** Access the MeasurementEngine — configure units or toggle programmatically.
     *  May be undefined if the feature is disabled in Settings.json or not yet loaded. */
    public get measurementEngine(): MeasurementEngine | undefined {
        return this._measurementEngine;
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



}

export default SymbolEngine;

