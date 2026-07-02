import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";

import SymbolEvents from "../Support/SymbolEvents";
import DrawSeam from "../Support/DrawSeam";
export interface StartLineOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polyline;
    DRAW_TYPE?: number;
    [key: string]: any;
}

/**
 * StartLine class for drawing Start Line tactical symbols
 * No baseline - direct polyline drawing with "SL" markers at both ends
 * Returns Polyline geometry
 */
export class StartLine {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;

    // Symbol properties
    public declaredClass: string = "MilitarySymbology.Symbols.StartLine";
    public SID: string = "140303";
    public symName: string = "Start Line";
    public symGeometricType: string = "Line";

    private _lineSym: SimpleLineSymbol | null = null;
    private _points: Point[] = [];
    private _drawType: number = 1;
    private _geometryType: string | null = null;
    private amplifier: Amplifier;

    // Drawing state
    private isDrawing: boolean = false;
    private tempGraphic: Graphic | null = null;

    // Event handlers
    private clickHandler: any = null;
    private doubleClickHandler: any = null;
    private mouseMoveHandler: any = null;

    // Event emitter
    private events: SymbolEvents;

    constructor(view: MapView | SceneView, isLine: boolean = false) {
        this.view = view;
        this.isLine = isLine;
        this.layerManager = GraphicsLayerManager.getInstance(view);
        this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.TACT);
        this.amplifier = new Amplifier();
        this.events = new SymbolEvents(view, "StartLine");

        // Initialize layers if not already done
        this.layerManager.initializeLayers();

        // Initialize temporary graphic
        this.tempGraphic = new Graphic();
    }

    /**
     * Initialize the StartLine drawing
     */
    public init(options: StartLineOptions, marker: SimpleLineSymbol): void {
        this._lineSym = marker.clone();
        // this.map.navigationManager.setImmediateClick(false);
        // this.map.disableDoubleClickZoom();

        this._drawType = GeoTools.setDefault(options, "DRAW_TYPE", this._drawType);

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
            // Immediate placement with geometry
            if (options.GEOM && this.tempGraphic) {
                this.tempGraphic.geometry = options.GEOM;
            }
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._drawType);
            if (this.tempGraphic && this.tempGraphic.geometry) {
                this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEss);
            }
            this._clear();

        } else if (options.hasOwnProperty("CTRL_PTS")) {
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._drawType);
            const geometry = this.createSymbol(drawEss);
            if (geometry && this.tempGraphic) {
                this.tempGraphic.geometry = geometry;
                this.__drawEnd(geometry, drawEss);
            }
            this._clear();

        } else {
            // Interactive drawing mode
            this.tempGraphic = new Graphic({ symbol: this._lineSym });
            this.symbolLayer.add(this.tempGraphic);

            this.clickHandler = this.view.on("click", (event) => {
                this._onClickHandler(event);
            });
            this.doubleClickHandler = this.view.on("double-click", (event) => {
                this._onDoubleClickHandler(event);
            });
        }
    }

    /**
     * Create DrawEssentials object
     */
    private createDrawEssentials(ctrlPts: Point[], drawType: number): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.AMPLIFIER = this.amplifier.toString();

        (drawEssentials as any).SCOPE = this;
        (drawEssentials as any).CTRL_PTS = ctrlPts;
        (drawEssentials as any).DRAW_TYPE = drawType;

        return drawEssentials;
    }

    /**
     * Create symbol geometry from DrawEssentials
     */
    private createSymbol(drawEssentials: DrawEssentials): Polyline | null {
        try {
            const pts: Point[] = (drawEssentials as any).CTRL_PTS;
            if (!pts || pts.length === 0) throw new Error("controlPoints not found");

            const p1 = pts[0];
            const p2 = pts[pts.length - 1];

            let result: Polyline;
            switch ((drawEssentials as any).DRAW_TYPE || 1) {
                case 1:
                    result = this.createSymbolByStraightLine(pts);
                    break;
                case 2:
                    result = this.createSymbolByLine(pts, p1, p2);
                    break;
                default:
                    result = this.createSymbolByStraightLine(pts);
            }

            // Add SL markers at both ends
            const len = GeoTools._2PtLen(p1, p2) / 20;
            const k = GeoTools.angleInRadians(p1, p2);

            const pt1 = {
                x: -1 * len * Math.cos(k) + p1.x,
                y: -1 * len * Math.sin(k) + p1.y
            };
            const slPaths1 = Shapes.createSL(pt1.x, pt1.y, len / 2, this.view.spatialReference);
            for (const path of slPaths1) {
                result.addPath(path.map(pt => [pt.x, pt.y]));
            }

            const pt2 = {
                x: len * Math.cos(k) + p2.x,
                y: len * Math.sin(k) + p2.y
            };
            const slPaths2 = Shapes.createSL(pt2.x, pt2.y, len / 2, this.view.spatialReference);
            for (const path of slPaths2) {
                result.addPath(path.map(pt => [pt.x, pt.y]));
            }

            return result;
        } catch (e) {
            /* invalid geometry mid-draw is expected; ignore */
            return null;
        }
    }

    private createSymbolByStraightLine(pts: Point[]): Polyline {
        const result = new Polyline({ spatialReference: this.view.spatialReference });
        result.addPath(pts.map(pt => [pt.x, pt.y]));
        return result;
    }

    private createSymbolByLine(pts: Point[], firstPoint: Point, lastPoint: Point): Polyline {
        const result = new Polyline({ spatialReference: this.view.spatialReference });
        if (pts.length === 2) {
            result.addPath([[lastPoint.x, lastPoint.y], [firstPoint.x, firstPoint.y]]);
        } else if (pts.length > 2) {
            const tempArray = pts.map(pt => ({ x: pt.x, y: pt.y }));
            const bezierPts = Shapes.CreateBezierPathPCOnly(tempArray, 100);
            result.addPath(bezierPts.map(pt => [pt.x, pt.y]));
        }
        return result;
    }

    /**
     * Handle click events
     */
    private _onClickHandler(clickEvent: any): void {
        const mapPoint = DrawSeam.resolvePoint(this.view, clickEvent);
        if (!mapPoint) return;

        const point = new Point({
            x: mapPoint.x,
            y: mapPoint.y,
            spatialReference: this.view.spatialReference
        });

        this._points.push(point);

        if (this._points.length === 1) {
            this.mouseMoveHandler = this.view.on("pointer-move", (event) => {
                this._onMouseMoveHandler(event);
            });
        }

        this.events.emit("onDrawClick", { currentPts: this._points });

        if (this.isLine === true && this._points.length === 1) {
            this.events.emit("onDrawClick", { currentPts: this._points });
            this.cleanUp();
        }
    }

    /**
     * Handle double click events
     */
    private _onDoubleClickHandler(clickEvent: any): void {
        const mapPoint = DrawSeam.resolvePoint(this.view, clickEvent);
        if (!mapPoint) return;

        const point = new Point({
            x: mapPoint.x,
            y: mapPoint.y,
            spatialReference: this.view.spatialReference
        });

        this._points.push(point);
        this.cleanUp();
    }

    /**
     * Handle mouse move events
     */
    private _onMouseMoveHandler(inputEvent: any): void {
        if (!this.tempGraphic) return;

        const mapPoint = DrawSeam.resolvePoint(this.view, inputEvent);
        if (!mapPoint) return;

        const candidatePoint = new Point({
            x: mapPoint.x,
            y: mapPoint.y,
            spatialReference: this.view.spatialReference
        });

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

    /**
     * Clean up drawing state and finalize
     */
    private cleanUp(): void {
        if (this._points.length === 0) return;

        const drawEss = this.createDrawEssentials(this._points.slice(), this._drawType);

        if (this.tempGraphic && this.tempGraphic.geometry) {
            this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEss);
        }

        this._clear();
        this._removeEvents();
    }

    /**
     * Handle draw end
     */
    private __drawEnd(drawGeometry: Polyline, drawEssentials: DrawEssentials): void {
        if (drawGeometry) {
            const spatialRef = this.view.spatialReference;
            let geographicGeometry = drawGeometry;

            if (spatialRef && spatialRef.isWebMercator) {
                // Geographic conversion would go here if needed
            } else if (spatialRef && spatialRef.wkid === 4326) {
                geographicGeometry = drawGeometry.clone();
            }

            this.__onDrawEnd(drawGeometry, geographicGeometry, drawEssentials);
        }
    }

    /**
     * Final draw end handler
     */
    private __onDrawEnd(geometry: Polyline, geoGeometry: Polyline, drawEssParam: DrawEssentials): void {
        this.events.emit("onDrawEnd", {
            geometry: geometry,
            geographicGeometry: geoGeometry,
            drawEssentials: drawEssParam,
            marker: this._lineSym
        });
    }

    /**
     * Clear graphics and state
     */
    private _clear(): void {
        if (this.tempGraphic && this.symbolLayer) {
            this.symbolLayer.remove(this.tempGraphic);
        }

        this.tempGraphic = null;
        this._points = [];
    }

    /**
     * Remove event handlers
     */
    private _removeEvents(): void {
        if (this.clickHandler) {
            this.clickHandler.remove();
            this.clickHandler = null;
        }
        if (this.doubleClickHandler) {
            this.doubleClickHandler.remove();
            this.doubleClickHandler = null;
        }
        if (this.mouseMoveHandler) {
            this.mouseMoveHandler.remove();
            this.mouseMoveHandler = null;
        }
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

    /**
     * Deactivate the drawing tool
     */
    public deactivate(): void {
        this._clear();
        this._removeEvents();
        this._geometryType = null;
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

export default StartLine;
