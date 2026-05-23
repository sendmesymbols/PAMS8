import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import GraphicsLayerManager, {LAYER_NAMES} from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";
import BaseLine from "../Support/BaseLine.ts";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";

import SymbolEvents from "../Support/SymbolEvents";
export interface KillingGrOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    DRAW_TYPE?: number;

    [key: string]: any;
}

/**
 * KillingGr class for Killing Gr symbol
 * Supports multiple drawing types: Bezier curve (1), Polygon (2), Rectangle (3)
 * Includes inner text markers
 */
export class KillingGr {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;

    // Symbol properties
    public declaredClass = "MilitarySymbology.Symbols.KillingGr";
    public SID: string = "242300";
    public symName: string = "Killing Gr";
    public symGeometricType: string = "Area";
    private _lineSym: SimpleLineSymbol | null = null;
    private _points: Point[] = [];
    private _geometryType: string | null = null;
    private _drawType: number = 1;
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
        this.events = new SymbolEvents(view, "KillingGr");

        // Initialize layers if not already done
        this.layerManager.initializeLayers();

        // Initialize temporary graphic
        this.tempGraphic = new Graphic();
    }

    /**
     * Initialize theKilling Gr drawing
     */
    public init(options: KillingGrOptions, marker: SimpleLineSymbol): void {
        this._lineSym = marker.clone();
        this._drawType = options.DRAW_TYPE || 1;

        // Set up event handlers
        this.setupEventHandlers();

        const drawEssentials = new DrawEssentials();

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
            // Immediate placement with both control points and geometry
            if (options.GEOM && this.tempGraphic) {
                try {
                    // If a Polygon geometry is provided, assign it directly
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
            // Immediate placement with control points only
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.DRAW_TYPE || 1);
            const geometry = this.createSymbol(drawEss);
            if (geometry && this.tempGraphic) {
                this.tempGraphic.geometry = geometry;
                this.__drawEnd(geometry, drawEss);
                this._clear();
            }

        } else {
            // Interactive drawing mode
            this.startInteractiveDrawing();
        }
    }

    /**
     * Start interactive drawing mode
     */
    private startInteractiveDrawing(): void {
        if (!this._lineSym) return;
        this.isDrawing = true;
        this.tempGraphic = new Graphic({
            geometry: null,
            symbol: this._lineSym
        });
        this.symbolLayer.add(this.tempGraphic);
    }

    /**
     * Set up mouse event handlers for interactive drawing
     */
    private setupEventHandlers(): void {
        // Click handler
        this.clickHandler = this.view.on("click", (event) => {
            this._onClickHandler(event);
        });

        // Double click handler
        this.doubleClickHandler = this.view.on("double-click", (event) => {
            this._onDoubleClickHandler(event);
        });
    }

    /**
     * Handle click events
     */
    private _onClickHandler(clickEvent: any): void {
        const mapPoint = this.view.toMap(clickEvent);
        if (!mapPoint) return;

        const point = new Point({
            x: mapPoint.x,
            y: mapPoint.y,
            spatialReference: this.view.spatialReference
        });

        this._points.push(point);

        if (this._points.length === 1) {
            // First click - set up mouse move handler
            this.mouseMoveHandler = this.view.on("pointer-move", (event) => {
                this._onMouseMoveHandler(event);
            });
        }

        this.events.emit("onDrawClick", {currentPts: this._points});

        // For single line mode, finish after first click
        if (this.isLine === true && this._points.length === 1) {
            this.events.emit("onDrawClick", {currentPts: this._points});
            this.cleanUp();
        }

        // For rectangle draw type, finish after 2 points
        if (this._drawType === 3 && this._points.length === 2) {
            this.events.emit("onDrawClick", {currentPts: this._points});
            this.cleanUp();
        }
    }

    /**
     * Handle double click events
     */
    private _onDoubleClickHandler(clickEvent: any): void {
        const mapPoint = this.view.toMap(clickEvent);
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
        if (!this.isDrawing || !this.tempGraphic) return;

        const mapPoint = this.view.toMap(inputEvent);
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
     * Create DrawEssentials object
     */
    private createDrawEssentials(ctrlPts: Point[], drawType: number): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.GEOM = null;
        drawEssentials.AMPLIFIER = this.amplifier.toString();

        // Store additional properties
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
            let pts: Point[];

            if ((drawEssentials as any).CTRL_PTS) {
                pts = (drawEssentials as any).CTRL_PTS;
            } else {
                throw new Error("controlPoints not found");
            }

            const lastPoint = pts[pts.length - 1];
            const firstPoint = pts[0];
            const drawType = (drawEssentials as any).DRAW_TYPE || 1;

            let result: Polygon | null = null;

            switch (drawType) {
                case 1:
                    result = Shapes.createSymbolByBCurve(pts, firstPoint, lastPoint, drawEssentials, this.view.spatialReference) as Polygon;
                    break;
                case 2:
                    result = Shapes.createSymbolByPolygon(pts, firstPoint, lastPoint, drawEssentials, this.view.spatialReference);
                    break;
                case 3:
                    result = Shapes.createSymbolByRect(pts, firstPoint, lastPoint, drawEssentials, this.view.spatialReference);
                    break;
                default:
                    result = Shapes.createSymbolByPolygon(pts, firstPoint, lastPoint, drawEssentials, this.view.spatialReference);
            }

            return result ? this.createInnerText(result, firstPoint, lastPoint) : result;

        } catch (e) {
            console.error(e);
            console.log(this.constructor.name + ' Cannot create Symbol due to invalid geometry');
            return null;
        }
    }


    /**
     * Create inner text markers for Killing Ground
     */
    private createInnerText(result: Polygon, firstPoint: Point, lastPoint: Point): Polygon {
        try {
            const extent = result.extent;
            if (!extent) {
                return result;
            }

            const midPt = extent.center as Point;
            if (!midPt) {
                return result;
            }

            const baseLineLen = (GeoTools as any)._2PtLen
                ? (GeoTools as any)._2PtLen(firstPoint, lastPoint)
                : Math.hypot(lastPoint.x - firstPoint.x, lastPoint.y - firstPoint.y);

            let cLenLimit = baseLineLen / 10;
            if (cLenLimit > baseLineLen / 3.6) {
                cLenLimit = baseLineLen / 3.6;
            }

            // Create closed rings per stroke so inner text is part of the polygon geometry (no extra graphics)
            const rings = (Shapes as any).createKGRings
                ? (Shapes as any).createKGRings(midPt.x, midPt.y, cLenLimit, midPt.spatialReference)
                : null;

            if (rings && Array.isArray(rings)) {
                for (let r = 0; r < rings.length; r++) {
                    const ring = rings[r];
                    if (ring && ring.length >= 4) {
                        result.addRing(ring);
                    } else if (ring && ring.length === 2) {
                        // Close a 2-point stroke minimally to keep it as a single stroked segment in polygon outline
                        const closed = [ring[0], ring[1], ring[0]];
                        result.addRing(closed);
                    }
                }
            } else {
                // Fallback to legacy createKG from the source JS
                const kgTxt = (Shapes as any).createKG(midPt.x, midPt.y, cLenLimit, midPt.spatialReference);
                if (kgTxt && Array.isArray(kgTxt)) {
                    for (let j = 0; j <= kgTxt.length - 1; j++) {
                        if (kgTxt[j]) {
                            result.addRing(kgTxt[j]);
                        }
                    }
                }
            }

            return result;
        } catch (e) {
            console.log('Cannot create Inner Text');
            return result;
        }
    }

    /**
     * Utility method to calculate distance
     */
    private calculateDistance(pt1: Point, pt2: Point): number {
        const dx = pt2.x - pt1.x;
        const dy = pt2.y - pt1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Clean up drawing state and finalize
     */
    private cleanUp(): void {
        if (this._points.length === 0) return;

        const drawEssentials = this.createDrawEssentials(this._points.slice(), this._drawType);

        if (this.tempGraphic && this.tempGraphic.geometry) {
            this.__drawEnd(this.tempGraphic.geometry as Polygon, drawEssentials);
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

export default KillingGr;