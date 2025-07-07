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
import '../ThirdParty/milsymbol.d.ts';
import { parseSIDC, ParsedSIDC } from '../SIDC/SIDC';
import ContextMenuManager, { ContextMenuItem, MenuItemEvent } from '../Managers/ContextMenuManager';

import symData from "../Data/Symbols.json";
import settingsData from "../Data/Settings.json";

interface Evented {
    on(type: string, listener: Function): { remove(): void };
    emit(type: string, event: any): boolean;
}

// Assume these are your migrated custom modules.
// You'll need to define their interfaces/classes based on their actual logic.
interface ISIDC {
    _sidc: string;
    validateSIDC(sidc: string): boolean;
    getSID(): string;
    getSIDC(): string;
    getMarker(symGeometricType: string, isObstacle: boolean, fill?: boolean): SimpleMarkerSymbol | SimpleLineSymbol | null;
    // Add other methods that SIDC class might have
}

interface IMapper {
    getInstance(): any; // Should return an instance of a symbol class (e.g., MainAttackSymbol, AmbushSymbol)
}

interface IAnnotationEngine {
    annotate(
        textGraphicsLayer: GraphicsLayer,
        geometry: Point | Polyline | Polygon,
        amplifier: string,
        drawEssentials: DrawEssentials,
        graphicId: string,
        textSize: number,
        isFreeHand: number,
        labelOptions: LabelOptions,
        options: { opacity?: number }
    ): void;
}

// Placeholder for custom symbol classes that Mapper would return
interface ISymbolClass {
    map: MapView | SceneView;
    isLine: boolean;
    amplifier: string;
    symGeometricType: string;
    isObstacle: boolean;
    on(type: string, listener: Function): { remove(): void };
    init(drawEssentials: DrawEssentials, marker: any, sid: string, name: string, offset: any, sidc: string): void;
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

interface Settings {
    textSize: number;
    defaultLineWidth: number;
    defaultSymbolSize: number;
    spatialReferences: {
        WGS1SP?: number;
        WGS2SP?: string; // WKT
        LCC1SP?: number; // WKID or WKT
        LCC2SP?: number; // WKID or WKT
    };
}

interface DrawEssentials {
    IS_LINE: boolean;
    SID?: string;
    GEOM?: Point | Polyline | Polygon;
    OPTIONS?: {
        GEOM?: Point | Polyline | Polygon;
    };
    CTRL_PTS?: Point[];
    BASE_LN_PTS?: {
        startPt?: Point;
        midPt?: Point;
        endPt?: Point;
    };
    SIZE?: number;
    opacity?: number;
    SIDC?: string;
    AMPLIFIER?: string;
    ISFHAND?: number;
    labelOptions?: LabelOptions;
    SYM_GEO_TYPE?: string; // Added for clarity based on usage in getOpacityValue
}

interface LabelOptions {
    // Define properties for labelOptions if they exist
    // e.g., position: string; font: string;
}


class SymbolEngine implements Evented {
    private _layerManager: GraphicsLayerManager;
    private _contextMenuManager: ContextMenuManager;
    private _getView: () => MapView | SceneView;

    constructor(viewProvider: () => MapView | SceneView) {
        this._getView = viewProvider;
        this._layerManager = GraphicsLayerManager.getInstance(this.view);
        this._layerManager.initializeLayers();
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
         console.log("SymbolEngine detected activeView type change:", newType);
         // Potentially re-initialize or update SymbolEngine based on new view type
     });

        // Initialize the ContextMenuManager
        this._contextMenuManager = ContextMenuManager.getInstance();
        this._contextMenuManager.initialize(this.view, {
            targetGraphicTypes: ["milSymbol", "specialPoint", "force"],
            targetLayerIds: [LAYER_NAMES.FORCE, LAYER_NAMES.TACT_PT, LAYER_NAMES.TACT, "milSymbols"]
        });

        // Register context menu items for different graphic types
        this.registerContextMenuItems();

        // Listen for context menu events
        this._contextMenuManager.on("menu-item-click", this.handleContextMenuAction.bind(this));

        // Initialize symbol engine
        console.log("Symbol Engine initialized");

        // --- Context Menu Setup using the Evented Class ---

        //when(this._getView, "ready", () => {
         //   console.log("RWADY")
        //});


    }





    onViewChanged(newView: MapView | SceneView) {
        console.log("SymbolEngine: Detected view change:00000000000000000000000", newView?.type);
        this._layerManager = GraphicsLayerManager.getInstance(newView);
        this._layerManager.initializeLayers();
        // Possibly clear or rebind events
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
        this._contextMenuManager.registerMenuItems("milSymbol", milSymbolMenuItems);
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
     * Modify a military symbol
     */
    private modifySymbol(graphic: Graphic): void {
        console.log("Modifying symbol:", graphic.attributes?.name || "Unnamed");

        // Example implementation - in a real app, you might show a form
        // that allows users to modify the symbol's properties
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



    drawMilSymbolInteractively(options: SymbolOptions): void {
        const sketchLayer = this._layerManager.getOrCreateLayer(LAYER_NAMES.SKETCH);
        const view = this.view;
        const sketchVM = new SketchViewModel({
            view,
            layer: sketchLayer,
            pointSymbol: this.generateForceSymbol(options, 3),
        });

        sketchVM.create("point");

        sketchVM.on("create", (event) => {
            if (event.state === "complete") {
                const point = event.graphic.geometry as __esri.Point;
                this.addMilSymbolAtPoint(point, options);
                sketchLayer.remove(event.graphic);
                sketchVM.destroy();
            }
        });
    }
    private addMilSymbolFor2D(geometry: __esri.Point, options: SymbolOptions): void {
        const layer = this._layerManager.getOrCreateLayer("milSymbols");
        const symbol = this.generateForceSymbol(options, 3);

        const graphic = new Graphic({ geometry, symbol });
        layer.add(graphic);
    }

    addMilSymbolAtPoint(point: __esri.Point, options: SymbolOptions): void {
        try {
            this.addMilSymbolFor2D(point, options);
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
        if (typeof window.MS === 'undefined') {
            throw new Error("MS (UEITypes) library is not properly loaded or invalid.");
        }
        
        console.log("MS (milsymbol.js) version:", window.MS.version);
        console.log("MS (milsymbol.js) standard:", window.MS._STD2525 ? "2525" : "APP6");
        console.log("MS (milsymbol.js) marker parts count:", window.MS.getMarkerParts().length);
    }

    generateForceSymbol(options: SymbolOptions, scaleFactor: number): PictureMarkerSymbol | undefined {
        try {
            // Use milsymbol.js instead of UEITypes
            const sidc = options.sidc;
            if (!sidc) {
                console.error("SIDC is required for symbol generation");
                return undefined;
            }

            // Create milsymbol.js options
            const msOptions = {
                size: options.size || 35
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




            return pictureMarkerSymbol;
        } catch (e) {
            console.error("Error generating force symbol with milsymbol.js:", e);
            return undefined;
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

    private drawSymEnd(event: {
        geometry: Point | Polyline | Polygon,
        marker: SimpleMarkerSymbol | SimpleLineSymbol,
        drawEssentials: DrawEssentials
    }): void {
        const symbol = event.marker;
        const graphic = new Graphic({
            geometry: event.geometry,
            symbol: symbol
        });

        const tempId = this.generateUUID();
        event.drawEssentials.SIDC = this.SIDC.getSIDC(); // Ensure SIDC is passed
        event.drawEssentials.AMPLIFIER = this.amplifier; // Ensure amplifier is passed
        graphic.attributes = {
            drawEssentials: event.drawEssentials,
            id: ((this.attrs.hasOwnProperty('symbolId') === false) || (this.attrs.symbolId === undefined) || this.attrs.symbolId === null) ? tempId : this.attrs.symbolId,
            ...this.attrs // Merge other attributes
        };
        graphic.set("drawEssentials", event.drawEssentials); // Set as a custom property
        graphic.set("id", graphic.attributes.id); // Set as a custom property

        this.graphicsLayer.add(graphic);

        this._endEventHandle?.remove();
        this._drawProgressEventHandle?.remove();
        this._drawClickEventHandle?.remove();
        this._drawBaseLineEndEventHandle?.remove();

        const isFreeHand = graphic.attributes.drawEssentials.ISFHAND || 0;
        event.drawEssentials.labelOptions = this.labelOptions;

        const options = this.getOpacityValue(graphic);

        AnnotationEngine.annotate(
            this.textGraphicsLayer,
            event.geometry,
            event.drawEssentials.AMPLIFIER!, // Ensure AMPLIFIER is not undefined
            event.drawEssentials,
            graphic.attributes.id,
            this.settings.textSize,
            isFreeHand,
            this.labelOptions!, // Ensure labelOptions is not undefined
            options
        );

        if (event.drawEssentials.hasOwnProperty('opacity')) delete event.drawEssentials.opacity;

        this.emit("symDrawEnd", {
            'isDone': "done",
            'drawEssentials': event.drawEssentials,
            'id': graphic.attributes.id,
            'graphic': graphic
        });
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
        return symData;
    }

    /**
     * Get symbol data by key
     * @param key The symbol key to retrieve
     * @returns The symbol data for the specified key or null if not found
     */
    public getSymbolByKey(key: string): any {
        return symData[key] || null;
    }

    /**
     * Get all symbol names for autocomplete
     * @returns Array of objects with key and name for autocomplete
     */
    public getSymbolNamesForAutocomplete(): Array<{key: string, name: string}> {
        return Object.entries(symData).map(([key, data]: [string, any]) => ({
            key: key,
            name: data.Name || 'Unnamed Symbol'
        }));
    }



}

export default SymbolEngine;

