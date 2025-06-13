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
import {watch}  from "@arcgis/core/core/reactiveUtils"
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";

//import  from "esri/core/reactiveUtils";

import GraphicsLayerManager, {LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import ms from '../ThirdParty/MilSymbols/UEITypes.js';
import type { SymbolOptions } from '../ThirdParty/MilSymbols/UEITypes.ts';
import { parseSIDC, ParsedSIDC } from '../SIDC/SIDC';
import ContextMenuManager, { ContextMenuItem, MenuItemEvent } from '../Managers/ContextMenuManager';


class SymbolEngine {
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


        // Observe view type changes
        watch(
            () => this._getView.container?.type,
            (newType, oldType) => {
                // The initial call might have oldType as undefined
                if (newType && newType !== oldType) {
                    onViewSwitch(newType as "2d" | "3d", oldType as "2d" | "3d" | undefined);
                } else if (newType && oldType === undefined) { // Handle initial load
                    onViewSwitch(newType as "2d" | "3d", undefined);
                }
            },
            { initial: true }
        );

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

        const graphic = new Graphic({ geometry, symbol });
        layer.add(graphic);
    }

    private addPictureMarkerFor2D(geometry: __esri.Point, url: string, width: number, height: number): void {
        const layer = this._layerManager.getOrCreateLayer(LAYER_NAMES.FORCE);
        const symbol = new PictureMarkerSymbol({ url, width, height });

        const graphic = new Graphic({ geometry, symbol });
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
        return view instanceof SceneView;
    }

    ensureMsAvailable(): void {
        if (!ms?.Symbol || typeof ms.Symbol !== 'function') {
            throw new Error("MS (milsymbol) library is not properly loaded or invalid.");
        }
    }

    generateForceSymbol(options: SymbolOptions, scaleFactor: number): PictureMarkerSymbol | undefined {
        try {
            options.outlineColor = options.outlineColor ?? "red";
            options.outlineWidth = options.outlineWidth ?? 2;


            const enrichedOptions = this.enrichSymbolOptions(options);
            const symbol = new ms.Symbol(enrichedOptions);
            const canvas = symbol.asCanvas(scaleFactor);
            const url = canvas.toDataURL();
            const { width, height } = symbol.getSize();
            const anchor = symbol.getAnchor();

            const xoffset = (width / 2) - anchor.x;
            const yoffset = (height / 2) - anchor.y;

            const pictureMarkerSymbol = new PictureMarkerSymbol({
                url, width, height, xoffset, yoffset
            });

            //this.symbolCache.set(cacheKey, pictureMarkerSymbol);
            return pictureMarkerSymbol;
        } catch (e) {
            console.error("Error generating force symbol:", e);
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


}

export default SymbolEngine;

