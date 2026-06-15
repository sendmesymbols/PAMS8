import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import PictureMarkerSymbol from "@arcgis/core/symbols/PictureMarkerSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";
import SymbolEvents from "../Support/SymbolEvents";

import tacticalPointSymbols from "../Data/TacticalPointSymbols.json";

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

/** Normalize ArcGIS Color / [r,g,b,a] / hex / named string into a CSS color string. */
function toCssColor(color: any, fallback: string): string {
    if (color == null) return fallback;
    if (typeof color === "string") return color;
    if (Array.isArray(color)) {
        return `rgba(${color[0]},${color[1]},${color[2]},${color[3] ?? 1})`;
    }
    if (typeof color === "object" && "r" in color && "g" in color && "b" in color) {
        return `rgba(${color.r},${color.g},${color.b},${color.a ?? 1})`;
    }
    return fallback;
}

/**
 * TacticalPoint class for drawing tactical point symbols on MapView or SceneView.
 * Supports both immediate placement (with GEOM) and interactive drawing (without GEOM).
 */
export class TacticalPoint {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;

    // Symbol properties
    private SIC: string = "000000";
    private symName: string = "TacticalPoint";
    private symGeometricType: string = "Point";
    private _ptSymbol: PictureMarkerSymbol | null = null;
    private _point: Point | null = null;
    private _path: string = "";
    private _offset: string = "0";
    private amplifier: Amplifier;

    // Drawing state
    private isDrawing: boolean = false;
    private tempGraphic: Graphic | null = null;
    private tactPtSymData: any;

    // Event handlers
    private mouseMoveHandler: any = null;
    private clickHandler: any = null;

    private events: SymbolEvents;

    constructor(view: MapView | SceneView) {
        this.view = view;
        this.layerManager = GraphicsLayerManager.getInstance(view);
        this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.TACT_PT);
        this.amplifier = new Amplifier();
        this.events = new SymbolEvents(view, "TacticalPoint");
        this.tactPtSymData = tacticalPointSymbols;

        this.layerManager.initializeLayers();
        this.setupEventHandlers();
    }

    public init(
        options: TacticalPointOptions,
        marker?: MarkerOptions,
        sic?: string,
        symName?: string,
        offset?: string,
        sidc?: string
    ): void {
        if (!sidc || !sic) {
            throw new Error("SIDC and SIC are required for tactical point symbols");
        }

        const symbolKey = sidc.substr(4, 2) + sic;
        this._path = this.tactPtSymData[symbolKey];
        if (!this._path || this._path.length === undefined) {
            throw new Error("Symbol definition not found for key: " + symbolKey);
        }

        this.SIC = sic;
        this.symName = symName || this.symName;
        this._offset = offset || "0";

        this._ptSymbol = this.createCrossCompatibleSymbol(
            this._path,
            marker?.color || [0, 0, 0, 1],
            options.SIZE || marker?.size || 20,
            options.ANGLE || marker?.angle || 0,
            marker?.outline
        );

        if (options.GEOM) {
            this._point = options.GEOM.clone();
            const drawEssentials = this.createDrawEssentials(
                this._point,
                this.getSymbolSize(this._ptSymbol),
                this.getSymbolAngle(this._ptSymbol)
            );
            this.placeSymbolImmediately(this._point, drawEssentials);
        } else {
            this.startInteractiveDrawing();
        }
    }

    /**
     * Build a PictureMarkerSymbol with an SVG data URL — works consistently in 2D and 3D
     * views and survives switching between them.
     */
    private createCrossCompatibleSymbol(
        path: string,
        color: any,
        size: number,
        angle: number,
        outline?: any
    ): PictureMarkerSymbol {
        const svgDataUrl = this.pathToSvgDataUrl(path, color, size, outline);

        // 3D views need a larger raster to stay crisp.
        const adjustedSize = this.view.type === "3d"
            ? Math.max(size * 3.5, 48)
            : Math.max(size * 3, 36);

        const symbol = new PictureMarkerSymbol({
            url: svgDataUrl,
            width: adjustedSize,
            height: adjustedSize,
            angle,
        });

        // _offset === "1" means anchor at center-bottom: shift the raster up by half its height.
        symbol.xoffset = 0;
        symbol.yoffset = this._offset === "1" ? adjustedSize / 2 : 0;
        return symbol;
    }

    /** Approximate bounding box of an SVG path, used to center it in a 500x500 viewBox. */
    private calculatePathBounds(path: string): { centerX: number; centerY: number } {
        const numbers = path.match(/-?\d+\.?\d*/g);
        if (!numbers || numbers.length < 2) {
            return { centerX: 250, centerY: 250 };
        }
        const coords = numbers.map(n => parseFloat(n));
        const xs = coords.filter((_, i) => i % 2 === 0);
        const ys = coords.filter((_, i) => i % 2 === 1);
        let minX = Math.min(...xs), maxX = Math.max(...xs);
        let minY = Math.min(...ys), maxY = Math.max(...ys);
        if (minX === maxX) { minX -= 50; maxX += 50; }
        if (minY === maxY) { minY -= 50; maxY += 50; }
        return { centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
    }

    private pathToSvgDataUrl(path: string, color: any, size: number, outline?: any): string {
        try {
            const fillColor = toCssColor(color, "#000000");
            const strokeColor = toCssColor(outline?.color, "#FFFFFF");
            const strokeWidth = outline?.width != null ? String(outline.width) : "4";

            const svgSize = Math.max(size * 3, 64);
            const { centerX, centerY } = this.calculatePathBounds(path);
            const tx = 250 - centerX;
            const ty = 250 - centerY;

            const svg = `<svg width="${svgSize}" height="${svgSize}" viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg">`
                + `<g transform="translate(${tx},${ty})">`
                + `<path d="${path}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round"/>`
                + `</g></svg>`;

            return `data:image/svg+xml;base64,${btoa(svg)}`;
        } catch (error) {
            console.error("Error creating SVG data URL:", error);
            const fallbackSize = Math.max(size * 2.5, 48);
            const fallbackSvg = `<svg width="${fallbackSize}" height="${fallbackSize}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40" fill="#FF0000" stroke="#FFFFFF" stroke-width="2"/></svg>`;
            return `data:image/svg+xml;base64,${btoa(fallbackSvg)}`;
        }
    }

    private getSymbolSize(symbol: PictureMarkerSymbol): number {
        return typeof symbol.width === "string" ? parseInt(symbol.width) : (symbol.width as number) || 20;
    }

    private getSymbolAngle(symbol: PictureMarkerSymbol): number {
        return symbol.angle || 0;
    }

    private createDrawEssentials(geometry: Point, size: number, angle: number): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SIC;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.SIZE = size;
        drawEssentials.GEOM = geometry;
        drawEssentials.AMPLIFIER = this.amplifier.toString();
        (drawEssentials as any).ANGLE = angle;
        (drawEssentials as any).OFFSET = this._offset;
        return drawEssentials;
    }

    private placeSymbolImmediately(geometry: Point, drawEssentials: DrawEssentials): void {
        if (!this._ptSymbol) return;
        this.emitDrawEnd(geometry, this._ptSymbol, drawEssentials);
        this.cleanUp();
    }

    private startInteractiveDrawing(): void {
        if (!this._ptSymbol) return;
        this.isDrawing = true;
        const center = this.view.center;
        if (center) {
            this.tempGraphic = new Graphic({ geometry: center, symbol: this._ptSymbol });
            this.symbolLayer.add(this.tempGraphic);
        }
    }

    private setupEventHandlers(): void {
        this.mouseMoveHandler = this.view.on("pointer-move", (event) => {
            if (!this.isDrawing || !this.tempGraphic) return;
            const mapPoint = this.view.toMap(event);
            if (mapPoint) {
                this.tempGraphic.geometry = mapPoint;
                this.events.emit("onDrawProgress", {
                    currentGeometry: mapPoint,
                    currentDrawEssentials: null,
                    currentMarker: null,
                });
            }
        });

        this.clickHandler = this.view.on("click", (event) => {
            if (!this.isDrawing) return;
            const mapPoint = this.view.toMap(event);
            if (mapPoint) {
                this._point = mapPoint.clone();
                this.finishDrawing();
            }
        });
    }

    private finishDrawing(): void {
        if (!this._point || !this._ptSymbol) return;
        const drawEssentials = this.createDrawEssentials(
            this._point,
            this.getSymbolSize(this._ptSymbol),
            this.getSymbolAngle(this._ptSymbol)
        );
        this.emitDrawEnd(this._point, this._ptSymbol, drawEssentials);
        this.cleanUp();
    }

    private emitDrawEnd(geometry: Point, symbol: PictureMarkerSymbol, drawEssentials: DrawEssentials): void {
        if (!geometry) return;
        this.events.emit("onDrawEnd", { geometry, marker: symbol, drawEssentials });
    }

    private cleanUp(): void {
        this.isDrawing = false;
        if (this.tempGraphic) {
            this.symbolLayer.remove(this.tempGraphic);
            this.tempGraphic = null;
        }
        this._point = null;
        // Drop the view listeners registered in the constructor — the engine
        // creates a fresh instance per draw, so this instance is done.
        this.removeEventHandlers();
    }

    private removeEventHandlers(): void {
        this.mouseMoveHandler?.remove();
        this.mouseMoveHandler = null;
        this.clickHandler?.remove();
        this.clickHandler = null;
    }

    public deactivate(): void {
        this.cleanUp();
        this.removeEventHandlers();
        this._ptSymbol = null;
        this.isDrawing = false;
    }

    public on(eventName: string, callback: (data: any) => void): void {
        this.events.on(eventName, callback);
    }

    public off(eventName: string, callback?: (data: any) => void): void {
        this.events.off(eventName, callback);
    }

    public getSymbolLayer(): GraphicsLayer {
        return this.symbolLayer;
    }

    public clearSymbols(): void {
        this.symbolLayer.removeAll();
    }
}

export default TacticalPoint;
