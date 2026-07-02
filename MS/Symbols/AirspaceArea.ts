import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import GraphicsLayerManager, {LAYER_NAMES} from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";
import Shapes from "../Support/Shapes.ts";
import DrawSeam from "../Support/DrawSeam";

import SymbolEvents from "../Support/SymbolEvents";

export interface AirspaceAreaOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    DRAW_TYPE?: number;

    [key: string]: any;
}

/**
 * AirspaceArea — shared footprint class for airspace control measures
 * (ROZ — Restricted Operations Zone, ACA — Airspace Coordination Area).
 *
 * Models the FlightZone area-symbol drawing pattern (Bezier curve (1),
 * Polygon (2), Rectangle (3)). The floor/ceiling altitude band and effective
 * DTG are authored separately by the AirspaceEngine, which extrudes the
 * footprint into a 3D volume and runs conflict detection.
 */
export class AirspaceArea {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;

    public declaredClass: string = "MilitarySymbology.Symbols.AirspaceArea";
    public SID: string = "251000";
    public symName: string = "Airspace Area";
    public symGeometricType: string = "Area";

    private _lineSym: SimpleLineSymbol | null = null;
    private _points: Point[] = [];
    private _drawType: number = 1;
    private amplifier: Amplifier;

    /** Whether this instance draws a single-segment line (parity with other area symbols). */
    public get isLineMode(): boolean { return this.isLine; }

    private isDrawing: boolean = false;
    private tempGraphic: Graphic | null = null;

    private clickHandler: any = null;
    private doubleClickHandler: any = null;
    private mouseMoveHandler: any = null;

    private events: SymbolEvents;

    constructor(view: MapView | SceneView, isLine: boolean = false) {
        this.view = view;
        this.isLine = isLine;
        this.layerManager = GraphicsLayerManager.getInstance(view);
        this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.TACT);
        this.amplifier = new Amplifier();
        this.events = new SymbolEvents(view, "AirspaceArea");
        this.layerManager.initializeLayers();
        this.tempGraphic = new Graphic();
    }

    public init(options: AirspaceAreaOptions, marker: SimpleLineSymbol): void {
        this._lineSym = marker.clone();
        this._drawType = options.DRAW_TYPE || 1;
        this.setupEventHandlers();

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
            if (options.GEOM && this.tempGraphic) {
                try {
                    this.tempGraphic.geometry = options.GEOM;
                } catch (error) {
                    console.error(this.symName, "Failed to set Polygon geometry:", error);
                }
            }
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.DRAW_TYPE || 1);
            if (this.tempGraphic && this.tempGraphic.geometry) {
                this.__drawEnd(this.tempGraphic.geometry as Polygon, drawEss);
            }
            this._clear();
        } else if (options.hasOwnProperty("CTRL_PTS")) {
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.DRAW_TYPE || 1);
            const geometry = this.createSymbol(drawEss);
            if (geometry && this.tempGraphic) {
                this.tempGraphic.geometry = geometry;
                this.__drawEnd(geometry, drawEss);
                this._clear();
            }
        } else {
            this.startInteractiveDrawing();
        }
    }

    private startInteractiveDrawing(): void {
        if (!this._lineSym) return;
        this.isDrawing = true;
        this.tempGraphic = new Graphic({geometry: null, symbol: this._lineSym});
        this.symbolLayer.add(this.tempGraphic);
    }

    private setupEventHandlers(): void {
        this.clickHandler = this.view.on("click", (event) => this._onClickHandler(event));
        this.doubleClickHandler = this.view.on("double-click", (event) => this._onDoubleClickHandler(event));
    }

    private _onClickHandler(clickEvent: any): void {
        const mapPoint = DrawSeam.resolvePoint(this.view, clickEvent);
        if (!mapPoint) return;
        const point = new Point({x: mapPoint.x, y: mapPoint.y, spatialReference: this.view.spatialReference});
        this._points.push(point);

        if (this._points.length === 1) {
            this.mouseMoveHandler = this.view.on("pointer-move", (event) => this._onMouseMoveHandler(event));
        }
        this.events.emit("onDrawClick", {currentPts: this._points});

        if (this._drawType === 3 && this._points.length === 2) {
            this.events.emit("onDrawClick", {currentPts: this._points});
            this.cleanUp();
        }
    }

    private _onDoubleClickHandler(clickEvent: any): void {
        const mapPoint = DrawSeam.resolvePoint(this.view, clickEvent);
        if (!mapPoint) return;
        const point = new Point({x: mapPoint.x, y: mapPoint.y, spatialReference: this.view.spatialReference});
        this._points.push(point);
        this.cleanUp();
    }

    private _onMouseMoveHandler(inputEvent: any): void {
        if (!this.isDrawing || !this.tempGraphic) return;
        const mapPoint = DrawSeam.resolvePoint(this.view, inputEvent);
        if (!mapPoint) return;
        const candidatePoint = new Point({x: mapPoint.x, y: mapPoint.y, spatialReference: this.view.spatialReference});

        const drawEssentials = new DrawEssentials();
        (drawEssentials as any).CTRL_PTS = this._points.concat([candidatePoint]);
        (drawEssentials as any).DRAW_TYPE = this._drawType;

        const geometry = this.createSymbol(drawEssentials);
        if (geometry) {
            this.tempGraphic.geometry = geometry;
            this.events.emit("onDrawProgress", {
                currentGeometry: geometry,
                currentDrawEssentials: drawEssentials,
                currentMarker: this._lineSym
            });
        }
    }

    private createDrawEssentials(ctrlPts: Point[], drawType: number): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.GEOM = null;
        drawEssentials.AMPLIFIER = this.amplifier.toString();
        (drawEssentials as any).SCOPE = this;
        (drawEssentials as any).CTRL_PTS = ctrlPts;
        (drawEssentials as any).DRAW_TYPE = drawType;
        return drawEssentials;
    }

    private createSymbol(drawEssentials: DrawEssentials): Polygon | null {
        try {
            const pts: Point[] = (drawEssentials as any).CTRL_PTS;
            if (!pts) throw new Error("controlPoints not found");
            const lastPoint = pts[pts.length - 1];
            const firstPoint = pts[0];
            const drawType = (drawEssentials as any).DRAW_TYPE || 1;

            switch (drawType) {
                case 1:
                    return Shapes.createSymbolByBCurve(pts, firstPoint, lastPoint, drawEssentials, this.view.spatialReference) as Polygon;
                case 2:
                    return Shapes.createSymbolByPolygon(pts, firstPoint, lastPoint, drawEssentials, this.view.spatialReference);
                case 3:
                    return Shapes.createSymbolByRect(pts, firstPoint, lastPoint, drawEssentials, this.view.spatialReference);
                default:
                    return Shapes.createSymbolByPolygon(pts, firstPoint, lastPoint, drawEssentials, this.view.spatialReference);
            }
        } catch (e) {
            /* invalid geometry mid-draw is expected; ignore */
            return null;
        }
    }

    private cleanUp(): void {
        if (this._points.length === 0) return;
        const drawEssentials = this.createDrawEssentials(this._points.slice(), this._drawType);
        if (this.tempGraphic && this.tempGraphic.geometry) {
            this.__drawEnd(this.tempGraphic.geometry as Polygon, drawEssentials);
        }
        this._clear();
        this._removeEvents();
    }

    private __drawEnd(drawGeometry: Polygon, drawEssentials: DrawEssentials): void {
        if (drawGeometry) {
            const spatialRef = this.view.spatialReference;
            let geographicGeometry = drawGeometry;
            if (spatialRef && spatialRef.wkid === 4326) {
                geographicGeometry = drawGeometry.clone();
            }
            this.__onDrawEnd(drawGeometry, geographicGeometry, drawEssentials);
        }
    }

    private __onDrawEnd(geometry: Polygon, geoGeometry: Polygon, drawEssParam: DrawEssentials): void {
        this.events.emit("onDrawEnd", {
            geometry: geometry,
            geographicGeometry: geoGeometry,
            drawEssentials: drawEssParam,
            marker: this._lineSym
        });
    }

    private _clear(): void {
        if (this.tempGraphic && this.symbolLayer) {
            this.symbolLayer.remove(this.tempGraphic);
        }
        this.tempGraphic = null;
        this._points = [];
    }

    private _removeEvents(): void {
        this.clickHandler?.remove();
        this.clickHandler = null;
        this.doubleClickHandler?.remove();
        this.doubleClickHandler = null;
        this.mouseMoveHandler?.remove();
        this.mouseMoveHandler = null;
    }

    /** Premium stylus seam: remove the last placed vertex (undo). Re-render is
     *  driven by the premium layer's next move. */
    public removeLastPoint(): boolean {
        if (!this._points || this._points.length === 0) return false;
        this._points.pop();
        if (this._points.length === 0 && this.tempGraphic) {
            this.tempGraphic.geometry = null;
        }
        return true;
    }

    public deactivate(): void {
        this._clear();
        this._removeEvents();
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

export default AirspaceArea;
