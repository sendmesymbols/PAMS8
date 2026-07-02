import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";
import DrawSeam from "../Support/DrawSeam";

import SymbolEvents from "../Support/SymbolEvents";
export interface ObjAreaOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    DRAW_TYPE?: number;
    [key: string]: any;
}

/**
 * ObjArea class for drawing Objective Area tactical symbols
 * No baseline - direct polygon drawing with "OBJ" inner text
 * Returns Polygon geometry
 */
export class ObjArea {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;

    // Symbol properties
    public declaredClass: string = "MilitarySymbology.Symbols.ObjArea";
    public SID: string = "151700";
    public symName: string = "Obj Area";
    public symGeometricType: string = "Area";

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
        this.events = new SymbolEvents(view, "ObjArea");

        // Initialize layers if not already done
        this.layerManager.initializeLayers();

        // Initialize temporary graphic
        this.tempGraphic = new Graphic();
    }

    /**
     * Initialize the ObjArea drawing
     */
    public init(options: ObjAreaOptions, marker: SimpleLineSymbol): void {
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
                this.__drawEnd(this.tempGraphic.geometry as Polygon, drawEss);
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
    private createSymbol(drawEssentials: DrawEssentials): Polygon | null {
        try {
            const pts: Point[] = (drawEssentials as any).CTRL_PTS;
            if (!pts || pts.length === 0) throw new Error("controlPoints not found");

            const firstPoint = pts[0];
            const lastPoint = pts[pts.length - 1];

            switch ((drawEssentials as any).DRAW_TYPE || 1) {
                case 1: return this.createSymbolByBCurve(pts, firstPoint, lastPoint);
                case 2: return this.createSymbolByPolygon(pts, firstPoint, lastPoint);
                case 3: return this.createSymbolByRect(pts, firstPoint, lastPoint);
                default: return this.createSymbolByBCurve(pts, firstPoint, lastPoint);
            }
        } catch (e) {
            /* invalid geometry mid-draw is expected; ignore */
            return null;
        }
    }

    private createSymbolByBCurve(pts: Point[], firstPoint: Point, lastPoint: Point): Polygon {
        const result = new Polygon({ spatialReference: this.view.spatialReference });
        const tempArray = pts.map(pt => ({ x: pt.x, y: pt.y }));
        tempArray.push({ x: firstPoint.x, y: firstPoint.y });
        const bezierPts = Shapes.CreateBezierPathPCOnly(tempArray, 130);
        result.addRing(bezierPts.map(pt => [pt.x, pt.y]));
        return this.createInnerText(result, firstPoint, lastPoint);
    }

    private createSymbolByPolygon(pts: Point[], firstPoint: Point, lastPoint: Point): Polygon {
        const result = new Polygon({ spatialReference: this.view.spatialReference });
        const tempArray = pts.map(pt => [pt.x, pt.y] as number[]);
        tempArray.push([firstPoint.x, firstPoint.y]);
        result.addRing(tempArray);
        return this.createInnerText(result, firstPoint, lastPoint);
    }

    private createSymbolByRect(pts: Point[], firstPoint: Point, lastPoint: Point): Polygon {
        let result = new Polygon({ spatialReference: this.view.spatialReference });
        result.addRing(pts.map(pt => [pt.x, pt.y]));
        const extent = result.extent;
        result = new Polygon({ spatialReference: this.view.spatialReference });
        if (extent) {
            result.addRing([
                [firstPoint.x, firstPoint.y],
                [extent.xmin, extent.ymin],
                [lastPoint.x, lastPoint.y],
                [extent.xmax, extent.ymax],
                [firstPoint.x, firstPoint.y]
            ]);
        }
        return this.createInnerText(result, firstPoint, lastPoint);
    }

    /**
     * Add "OBJ" text inside the polygon
     */
    private createInnerText(result: Polygon, firstPoint: Point, lastPoint: Point): Polygon {
        try {
            const midPt = result.extent?.center;
            if (!midPt) return result;

            const baseLineLen = GeoTools._2PtLen(firstPoint, lastPoint);
            let cLenLimit = baseLineLen / 10;
            if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;

            const objPaths = Shapes.createOBJ(midPt.x, midPt.y, cLenLimit, midPt.spatialReference);
            for (const path of objPaths) {
                result.addRing(path.map(pt => [pt.x, pt.y]));
            }
        } catch (e) {
            console.log("Cannot create Inner Text");
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
            return;
        }

        // For rect draw type, finish after 2 points
        if (this._drawType === 3 && this._points.length === 2) {
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
            this.__drawEnd(this.tempGraphic.geometry as Polygon, drawEss);
        }

        this._clear();
        this._removeEvents();
    }

    /**
     * Handle draw end
     */
    private __drawEnd(drawGeometry: Polygon, drawEssentials: DrawEssentials): void {
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
    private __onDrawEnd(geometry: Polygon, geoGeometry: Polygon, drawEssParam: DrawEssentials): void {
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

export default ObjArea;
