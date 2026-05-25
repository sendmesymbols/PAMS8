import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Color from "@arcgis/core/Color";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";

import TacticalPointSymbolsData from "../Data/TacticalPointSymbols.json";

export interface TacticalPointTextBoxOptions {
    GEOM?: Point;
    SIZE?: number;
    ANGLE?: number;
    opacity?: number;
    [key: string]: any;
}

/**
 * TacticalPointTextBox — Freehand text box tactical point.
 * Works in 2D MapView and 3D SceneView. Mirrors TacticalPointText, but
 * uses its own SID (000111) so the AnnotationEngine can render the
 * multi-line label text supplied via the amplifier.
 */
export class TacticalPointTextBox {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;

    private SIC: string = "000111";
    private symName: string = "TacticalPointTextBox";
    private symGeometricType: string = "Point";
    private _ptSymbol: SimpleMarkerSymbol | null = null;
    private _point: Point | null = null;
    private _path: string = "";
    private _offset: string = "0";
    private _opacity: number = 1;
    private tactPtSymData: any;
    private amplifier: Amplifier;

    private isDrawing: boolean = false;
    private tempGraphic: Graphic | null = null;

    private mouseMoveHandler: any = null;
    private clickHandler: any = null;

    private eventListeners: Map<string, Function[]> = new Map();

    constructor(view: MapView | SceneView) {
        this.view = view;
        this.layerManager = GraphicsLayerManager.getInstance(view);
        this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.TACT);
        this.amplifier = new Amplifier();
        this.tactPtSymData = TacticalPointSymbolsData;

        this.layerManager.initializeLayers();
        this.setupEventHandlers();
    }

    public init(options: TacticalPointTextBoxOptions, marker: SimpleMarkerSymbol, sic: string, symName: string, offset: string, sidc: string): void {
        this._opacity = options.opacity !== undefined ? options.opacity : 1;

        const symbolKey = sidc.substr(4, 2) + sic;
        this._path = this.tactPtSymData[symbolKey];
        this._offset = offset;

        if (!this._path || this._path.length === 0) {
            throw new Error("Symbol definition not found");
        }

        this.SIC = sic;
        this.symName = symName;
        this._ptSymbol = marker.clone();

        this.configureMarkerSymbol(options, marker);

        if (options.GEOM) {
            this._point = options.GEOM;
            const drawEssentials = this.createDrawEssentials(
                options.GEOM.clone(),
                options.SIZE || marker.size,
                options.ANGLE || marker.angle,
                this._opacity
            );
            this.drawEnd(options.GEOM, this._ptSymbol, drawEssentials);
            this.cleanUp();
        } else {
            this.startInteractiveDrawing();
        }
    }

    private configureMarkerSymbol(options: TacticalPointTextBoxOptions, marker: SimpleMarkerSymbol): void {
        if (!this._ptSymbol) return;

        this._ptSymbol.path = this._path;
        this._ptSymbol.style = "path";

        if (options.SIZE !== undefined && options.SIZE !== 0) {
            this._ptSymbol.size = options.SIZE;
        } else {
            this._ptSymbol.size = marker.size;
        }

        if (options.ANGLE !== undefined) {
            this._ptSymbol.angle = options.ANGLE;
        } else {
            this._ptSymbol.angle = marker.angle;
        }

        if (options.opacity !== undefined) {
            const color = this._ptSymbol.color as Color;
            this._ptSymbol.color = new Color([color.r, color.g, color.b, options.opacity]);
        }

        if (this._offset === "1") {
            this._ptSymbol.xoffset = 0;
            this._ptSymbol.yoffset = this._ptSymbol.size / 2;
        }
    }

    private startInteractiveDrawing(): void {
        if (!this._ptSymbol) return;

        this.isDrawing = true;

        const center = this.view.center;
        if (center) {
            this.tempGraphic = new Graphic({
                geometry: center,
                symbol: this._ptSymbol,
            });
            this.symbolLayer.add(this.tempGraphic);
        }
    }

    private setupEventHandlers(): void {
        this.mouseMoveHandler = this.view.on("pointer-move", (event) => {
            if (!this.isDrawing || !this.tempGraphic) return;

            const mapPoint = this.view.toMap(event);

            if (mapPoint) {
                this.tempGraphic.geometry = mapPoint;
                this.emit("onDrawProgress", {
                    currentGeometry: mapPoint,
                    currentDrawEssentials: null,
                    currentMarker: null
                });
            }
        });

        this.clickHandler = this.view.on("click", (event) => {
            if (!this.isDrawing) return;

            const mapPoint = this.view.toMap(event);

            if (mapPoint) {
                this._point = mapPoint;
                this.finishDrawing();
            }
        });
    }

    private finishDrawing(): void {
        if (!this._point || !this._ptSymbol) return;

        const drawEssentials = this.createDrawEssentials(
            this._point.clone(),
            this._ptSymbol.size,
            this._ptSymbol.angle,
            this._opacity
        );

        this._ptSymbol.color = new Color([255, 255, 255, this._opacity]);

        this.drawEnd(this._point, this._ptSymbol, drawEssentials);
        this.cleanUp();
        this.removeEventHandlers();
    }

    private createDrawEssentials(geom: Point, size: number, angle: number, opacity: number): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SIC;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.GEOM = geom;
        drawEssentials.AMPLIFIER = this.amplifier.toString();
        (drawEssentials as any).SIZE = size;
        (drawEssentials as any).ANGLE = angle;
        (drawEssentials as any).OFFSET = this._offset;
        (drawEssentials as any).ISFHAND = 1;
        (drawEssentials as any).opacity = opacity;

        return drawEssentials;
    }

    private drawEnd(geometry: Point, symbol: SimpleMarkerSymbol, drawEssentials: DrawEssentials): void {
        if (!geometry) return;
        this.onDrawEnd(geometry, symbol, drawEssentials);
    }

    private onDrawEnd(geometry: Point, symbol: SimpleMarkerSymbol, drawEssentials: DrawEssentials): void {
        this.emit("onDrawEnd", {
            geometry: geometry,
            marker: symbol,
            drawEssentials: drawEssentials
        });
    }

    private cleanUp(): void {
        this.isDrawing = false;

        if (this.tempGraphic) {
            this.symbolLayer.remove(this.tempGraphic);
            this.tempGraphic = null;
        }

        this._point = null;
    }

    private removeEventHandlers(): void {
        if (this.mouseMoveHandler) {
            this.mouseMoveHandler.remove();
            this.mouseMoveHandler = null;
        }

        if (this.clickHandler) {
            this.clickHandler.remove();
            this.clickHandler = null;
        }
    }

    public deactivate(): void {
        this.cleanUp();
        this.removeEventHandlers();
        this._ptSymbol = null;
    }

    private emit(eventName: string, data: any): void {
        const listeners = this.eventListeners.get(eventName);
        if (listeners) {
            listeners.forEach(listener => listener(data));
        }
        this.emitGlobalEvent(eventName, data);
    }

    private emitGlobalEvent(eventName: string, data: any): void {
        const customEvent = new CustomEvent(eventName, {
            detail: {
                symbolType: "TacticalPointTextBox",
                eventName: eventName,
                ...data
            },
            bubbles: true,
            cancelable: true
        });

        if (this.view && this.view.container) {
            this.view.container.dispatchEvent(customEvent);
        } else {
            document.dispatchEvent(customEvent);
        }
    }

    public on(eventName: string, callback: Function): void {
        if (!this.eventListeners.has(eventName)) {
            this.eventListeners.set(eventName, []);
        }
        this.eventListeners.get(eventName)!.push(callback);
    }

    public off(eventName: string, callback?: Function): void {
        if (!callback) {
            this.eventListeners.delete(eventName);
        } else {
            const listeners = this.eventListeners.get(eventName);
            if (listeners) {
                const index = listeners.indexOf(callback);
                if (index > -1) {
                    listeners.splice(index, 1);
                }
            }
        }
    }

    public getSymbolLayer(): GraphicsLayer {
        return this.symbolLayer;
    }

    public clearSymbols(): void {
        this.symbolLayer.removeAll();
    }
}

export default TacticalPointTextBox;
