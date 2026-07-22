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
import Utils from "../Support/utils.ts";

import SymbolEvents from "../Support/SymbolEvents";
import DrawSeam from "../Support/DrawSeam";
export interface AutoShapeArrowOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polyline;
    DRAW_TYPE?: number;
    [key: string]: any;
}

/**
 * AutoShapeArrow — PowerPoint-style parameterized arrow (straight, elbow,
 * curved, double-headed).
 *
 * It is a FREEHAND line symbol: a structural twin of FreehandArrow.ts. The only
 * behavioural difference is the createSymbol() generator switch, keyed on the
 * DRAW_TYPE ("Arrow") selector. Everything else — the interactive draw, event
 * contract, and premium-stylus seam — is identical to FreehandArrow, so the
 * existing draw/edit/select/save pipelines treat it exactly like any other
 * freehand line with no special-casing.
 */
export class AutoShapeArrow {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;

    // Symbol properties
    private SID: string = "000021";
    private symName: string = "Auto Shape - Arrow";
    private symGeometricType: string = "Line";
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
        this.events = new SymbolEvents(view, "AutoShapeArrow");

        // Initialize layers if not already done
        this.layerManager.initializeLayers();

        // Initialize temporary graphic
        this.tempGraphic = new Graphic();
    }

    /**
     * Initialize the auto-shape arrow drawing
     */
    public init(options: AutoShapeArrowOptions, marker: SimpleLineSymbol): void {
        this._drawType = GeoTools.setDefault(options, "DRAW_TYPE", this._drawType);
        // Decorated lines restyle the stroke (preserving the user's colour/width):
        // border=dash, pathway=dot, road=thick. Arrows (1-4) and railway (ties are
        // geometry) keep the marker unchanged. Mirrors FreehandArea's FILL upgrade.
        this._lineSym = this._styleLineFor(this._drawType, marker);

        // Set up event handlers
        this.setupEventHandlers();

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
            // Immediate placement with both control points and geometry
            if (options.GEOM && this.tempGraphic) {
                try {
                    this.tempGraphic.geometry = new Polyline({
                        paths: options.GEOM,
                        spatialReference: this.view.spatialReference
                    });
                } catch (error) {
                    console.error(this.symName, "Failed to create Polyline geometry:", error);
                }
            }

            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._drawType);
            if (this.tempGraphic && this.tempGraphic.geometry) {
                this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEss);
            }
            this._clear();

        } else if (options.hasOwnProperty("CTRL_PTS")) {
            // Immediate placement with control points only
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._drawType);
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
     * Restyle the stroke for decorated line types (border/pathway/road), cloning
     * the passed marker so the user's colour/width survive. Arrows and railway
     * keep the marker unchanged. All styles use SimpleLineSymbol (2D/3D-safe).
     */
    private _styleLineFor(dt: number, marker: SimpleLineSymbol): SimpleLineSymbol {
        if (dt === 5) { const m = marker.clone(); m.style = "dash"; return m; }   // border
        if (dt === 8) { const m = marker.clone(); m.style = "dot"; return m; }    // pathway
        if (dt === 6) { const m = marker.clone(); m.style = "solid"; m.width = (marker.width || 2) * 3; return m; } // road (thick casing)
        return marker; // arrows (1-4) + railway (7)
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
        const mapPoint = DrawSeam.resolvePoint(this.view, clickEvent);
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

        this.events.emit("onDrawClick", { currentPts: this._points });

        // For single line mode, finish after first click
        if (this.isLine === true && this._points.length === 1) {
            this.events.emit("onDrawClick", { currentPts: this._points });
            this.cleanUp();
        }

        // Straight (1) / elbow (2) / double-headed (4) are two-point arrows — finish
        // after the second click. Curved (3) and the decorated lines (border/road/
        // railway/pathway, 5–8) keep collecting points until a double-click so they
        // can follow a multi-vertex path.
        if ((this._drawType === 1 || this._drawType === 2 || this._drawType === 4) && this._points.length === 2) {
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
        if (!this.isDrawing || !this.tempGraphic) return;

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
        (drawEssentials as any).ISFHAND = 1;

        return drawEssentials;
    }

    /**
     * Create symbol geometry from DrawEssentials.
     * The DRAW_TYPE ("Arrow") selector picks the arrow style; all reuse the
     * existing Shapes.createArrowHead + Utils.createBezierPath utilities.
     */
    private createSymbol(drawEssentials: DrawEssentials): Polyline | null {
        try {
            let pts: Point[];

            if ((drawEssentials as any).CTRL_PTS) {
                pts = (drawEssentials as any).CTRL_PTS;
            } else {
                throw new Error("controlPoints not found");
            }

            const sr = this.view.spatialReference;
            const dt = (drawEssentials as any).DRAW_TYPE;

            // ── Decorated lines (borders/roads/railways/pathways) — NO arrowhead.
            //    Border/Pathway are a plain spine (style comes from the marker,
            //    applied in init); Road/Railway add casing/tie geometry. ──
            if (dt === 5 || dt === 8) {
                const r = new Polyline({ spatialReference: sr });
                r.addPath(pts.map(p => [p.x, p.y]));
                return r;
            }
            if (dt === 6) {
                return Shapes.createRoadLine(pts, pts[0], pts[pts.length - 1], sr);
            }
            if (dt === 7) {
                return Shapes.createRailwayLine(pts, pts[0], pts[pts.length - 1], sr);
            }

            let result: Polyline = new Polyline({ spatialReference: this.view.spatialReference });
            // Points used to aim the forward arrowhead (createArrowHead reads the
            // last two). For the elbow this is the orthogonal shaft, so the head
            // points along the final segment.
            let aimPts: Point[] = pts;

            switch ((drawEssentials as any).DRAW_TYPE) {
                case 2: // elbow — orthogonal dx-then-dy shaft
                    aimPts = this.buildElbowPts(pts);
                    result.addPath(aimPts.map(p => [p.x, p.y]));
                    break;
                case 3: // curved
                    result = this.createSymbolByCurve(pts, drawEssentials, result);
                    break;
                case 1: // straight
                case 4: // double-headed (straight shaft, tail head added below)
                default:
                    result = this.createSymbolByLine(pts, drawEssentials, result);
                    break;
            }

            // Forward arrow head
            if (aimPts.length >= 2) {
                const arrowHeadPath = Shapes.createArrowHead(aimPts);
                if (arrowHeadPath && arrowHeadPath.length > 0) {
                    result.addPath(arrowHeadPath);
                }
            }

            // Tail arrow head for double-headed arrows
            if ((drawEssentials as any).DRAW_TYPE === 4 && pts.length >= 2) {
                const tailHeadPath = Shapes.createArrowHead(pts.slice().reverse());
                if (tailHeadPath && tailHeadPath.length > 0) {
                    result.addPath(tailHeadPath);
                }
            }

            return result;
        } catch (e) {
            /* invalid geometry mid-draw is expected; ignore */
            return null;
        }
    }

    /**
     * Create straight line shaft
     */
    private createSymbolByLine(pts: Point[], _drawEssentials: DrawEssentials, result: Polyline): Polyline {
        const path = pts.map(pt => [pt.x, pt.y]);
        result.addPath(path);
        return result;
    }

    /**
     * Create curved shaft (Bezier for >2 points; reversed straight for 2 points,
     * matching FreehandArrow's behaviour).
     */
    private createSymbolByCurve(pts: Point[], _drawEssentials: DrawEssentials, result: Polyline): Polyline {
        const firstPoint = pts[0];
        const lastPoint = pts[pts.length - 1];

        if (pts.length === 2) {
            result.addPath([[lastPoint.x, lastPoint.y], [firstPoint.x, firstPoint.y]]);
        } else if (pts.length > 2) {
            const tempArray: { x: number, y: number }[] = [];
            pts.forEach(pt => {
                tempArray.push({ x: pt.x, y: pt.y });
            });
            result = Utils.createBezierPath(tempArray, 100, this.view.spatialReference, true) as Polyline;
        }

        return result;
    }

    /**
     * Build an orthogonal (dx-then-dy) elbow between the first and last control
     * point. The corner sits at (last.x, first.y) so the final segment is
     * vertical and the arrowhead aims along it.
     */
    private buildElbowPts(pts: Point[]): Point[] {
        const a = pts[0];
        const b = pts[pts.length - 1];
        const sr = this.view.spatialReference;
        const corner = new Point({ x: b.x, y: a.y, spatialReference: sr });
        return [a, corner, b];
    }


    /**
     * Clean up drawing state and finalize
     */
    private cleanUp(): void {
        if (this._points.length === 0) return;

        const drawEssentials = this.createDrawEssentials(this._points.slice(), this._drawType);

        if (this.tempGraphic && this.tempGraphic.geometry) {
            this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEssentials);
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
                // geographicGeometry = webMercatorUtils.webMercatorToGeographic(drawGeometry);
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

    // ── Premium stylus seam (optional; called only by the premium layer) ─────────
    /** Remove the last placed vertex and re-render the live preview. */
    public removeLastPoint(): boolean {
        if (this._points.length === 0) return false;
        this._points.pop();
        this._refreshPreview();
        this.events.emit("onDrawClick", { currentPts: this._points });
        return true;
    }

    /** Drive a live REAL-symbol preview from an external (smoothed) stroke. */
    public setStrokePoints(points: Point[]): void {
        if (!this.tempGraphic || !points || points.length === 0) return;
        this._points = points.slice();
        this._refreshPreview();
    }

    /** Finalize the current points as the committed symbol (lift-to-finish). */
    public finishStroke(): void {
        if (this._points.length === 0) return;
        this.cleanUp();
    }

    /** Re-render the in-progress preview from the current _points. */
    private _refreshPreview(): void {
        if (!this.tempGraphic) return;
        if (this._points.length === 0) {
            this.tempGraphic.geometry = null;
            return;
        }
        const drawEssentials = this.createDrawEssentials(this._points.slice(), this._drawType);
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


    /**
     * Get the current symbol layer
     */
    public getSymbolLayer(): GraphicsLayer {
        return this.symbolLayer;
    }

    /**
     * Clear all symbols from the layer
     */
    public clearSymbols(): void {
        this.symbolLayer.removeAll();
    }
}

export default AutoShapeArrow;
