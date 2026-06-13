import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";

import SymbolEvents from "../Support/SymbolEvents";
export interface TurnOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polyline;
    DRAW_TYPE?: number;
    [key: string]: any;
}

/**
 * Turn — a line (straight or curved) capped by a FILLED arrowhead at its end.
 * The geometry is a Polyline, which cannot carry a fill, so the arrowhead is "shaded":
 * its triangle is packed with dense hatch lines (same Polyline, same line symbol) so it
 * reads as solid. The whole symbol is a single Polyline geometry. No "PL" text.
 */
export class Turn {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;

    // Symbol properties
    public declaredClass: string = "MilitarySymbology.Symbols.Turn";
    private SID: string = "270504";
    private symName: string = "Turn";
    private symGeometricType: string = "Line";
    public isObstacle: string = "1"; // obstacle effect (green), like Block / Disrupt
    private _lineSym: SimpleLineSymbol | SimpleFillSymbol | null = null;
    private _points: Point[] = [];
    private _drawType: number = 2; // default to bezier so multi-point draws curve like the graphic
    private _geometryType: string | null = null;
    private amplifier: Amplifier;

    // Arrowhead tuning (relative to the line's end-to-end length).
    private _headLengthRatio: number = 0.15;
    private _headHalfWidthRatio: number = 0.4; // half base width as a fraction of head length
    private _headShadeLines: number = 40;      // hatch lines used to "fill" the head

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
        this.events = new SymbolEvents(view, "Turn");

        // Initialize layers if not already done
        this.layerManager.initializeLayers();

        // Initialize temporary graphic
        this.tempGraphic = new Graphic();
    }

    /**
     * Initialize the turn drawing
     */
    public init(options: TurnOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void {
        this._lineSym = marker;

        // Set parameters from options
        this._drawType = GeoTools.setDefault(options, "DRAW_TYPE", this._drawType);

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
            // Immediate placement with both control points and geometry
            if (options.GEOM && this.tempGraphic) {
                try {
                    this.tempGraphic.geometry = (options.GEOM instanceof Polyline)
                        ? options.GEOM
                        : new Polyline({ paths: (options.GEOM as any), spatialReference: this.view.spatialReference });
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

        // Set up event handlers
        this.setupEventHandlers();
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

        this.events.emit("onDrawClick", { currentPts: this._points });

        // For single line mode, finish after first click
        if (this.isLine === true && this._points.length === 1) {
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
        drawEssentials.AMPLIFIER = this.amplifier.toString();

        // Store additional properties
        (drawEssentials as any).SCOPE = this;
        (drawEssentials as any).CTRL_PTS = ctrlPts;
        (drawEssentials as any).DRAW_TYPE = drawType;
        (drawEssentials as any).IS_OBS = this.isObstacle;

        return drawEssentials;
    }

    /**
     * Create symbol geometry from DrawEssentials
     */
    private createSymbol(drawEssentials: DrawEssentials): Polyline | null {
        try {
            let pts: Point[];

            if ((drawEssentials as any).CTRL_PTS) {
                pts = (drawEssentials as any).CTRL_PTS;
            } else {
                throw new Error("controlPoints not found");
            }

            let result = new Polyline({ spatialReference: this.view.spatialReference });
            const p1 = pts[0];
            const p2 = pts[pts.length - 1];

            const drawType = (drawEssentials as any).DRAW_TYPE || 1;

            switch (drawType) {
                case 1:
                    result = this.createSymbolByStraightLine(pts);
                    break;
                case 2:
                    result = this.createSymbolByLine(pts, p1, p2);
                    break;
                default:
                    result = this.createSymbolByStraightLine(pts);
            }

            // Filled (shaded) arrowhead at the end of the line.
            this.addArrowHead(result, pts);

            return result;

        } catch (e) {
            console.log(this.constructor.name + ' Cannot create Symbol due to invalid geometry');
            return null;
        }
    }

    /**
     * Add a solid-looking arrowhead at the tip (last control point), aligned to the line's
     * end tangent. Because a Polyline can't be filled, the triangle is packed with hatch
     * lines (parallel to the base) so it reads as filled. All paths join the same Polyline.
     */
    private addArrowHead(result: Polyline, pts: Point[]): void {
        try {
            if (!pts || pts.length < 2) return;

            // Use the RENDERED line's end (its first path) so the head sits at the actual
            // tip and aligns with the real end tangent. For a bezier the curve tangent
            // differs from the control-point chord, which otherwise threw the head
            // off-centre; reading the geometry works for both straight and curved lines.
            const linePath = (result as any).paths?.[0] as number[][] | undefined;
            if (!linePath || linePath.length < 2) return;

            const tipArr = linePath[linePath.length - 1];
            const tip = { x: tipArr[0], y: tipArr[1] };

            // Nearest preceding point distinct from the tip → true local end tangent.
            let prevArr = linePath[linePath.length - 2];
            for (let i = linePath.length - 2; i >= 0; i--) {
                if (Math.hypot(tipArr[0] - linePath[i][0], tipArr[1] - linePath[i][1]) > 1e-9) {
                    prevArr = linePath[i];
                    break;
                }
            }

            // End tangent.
            let dx = tip.x - prevArr[0], dy = tip.y - prevArr[1];
            const dlen = Math.hypot(dx, dy);
            if (dlen === 0) return;
            dx /= dlen; dy /= dlen;

            // Perpendicular.
            const px = -dy, py = dx;

            // Size relative to the overall span.
            const scale = GeoTools._2PtLen(pts[0], tip) || dlen;
            const len = scale * this._headLengthRatio;
            const halfW = len * this._headHalfWidthRatio;
            if (len <= 0) return;

            // Triangle: tip + two base corners.
            const baseCx = tip.x - dx * len, baseCy = tip.y - dy * len;
            const b1 = [baseCx + px * halfW, baseCy + py * halfW];
            const b2 = [baseCx - px * halfW, baseCy - py * halfW];

            // Crisp outline.
            result.addPath([[tip.x, tip.y], b1, b2, [tip.x, tip.y]]);

            // Shade: hatch lines from near the tip out to the base. Each spans edge-to-edge
            // (parallel to the base); densely spaced so the triangle looks solid.
            const steps = this._headShadeLines;
            for (let i = 1; i <= steps; i++) {
                const s = i / steps;
                const a = [tip.x + (b1[0] - tip.x) * s, tip.y + (b1[1] - tip.y) * s];
                const c = [tip.x + (b2[0] - tip.x) * s, tip.y + (b2[1] - tip.y) * s];
                result.addPath([a, c]);
            }
        } catch (e) {
            console.log('Error adding Turn arrowhead');
        }
    }

    /**
     * Create symbol by straight line (draw type 1)
     */
    private createSymbolByStraightLine(pts: Point[]): Polyline {
        const result = new Polyline({ spatialReference: this.view.spatialReference });
        const path = pts.map(pt => [pt.x, pt.y]);
        result.addPath(path);
        return result;
    }

    /**
     * Create symbol by bezier line (draw type 2)
     */
    private createSymbolByLine(pts: Point[], firstPoint: Point, lastPoint: Point): Polyline {
        const result = new Polyline({ spatialReference: this.view.spatialReference });

        if (pts.length === 2) {
            result.addPath([[firstPoint.x, firstPoint.y], [lastPoint.x, lastPoint.y]]);
        } else if (pts.length > 2) {
            // Convert points to simple objects for Bezier path
            const tempArray = pts.map(pt => ({ x: pt.x, y: pt.y }));

            // Create Bezier path using our Shapes utility
            const bezierPoints = Shapes.CreateBezierPathPCOnly(tempArray, 100);
            const bezierPath = bezierPoints.map(pt => [pt.x, pt.y]);
            result.addPath(bezierPath);
        }

        return result;
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

export default Turn;
