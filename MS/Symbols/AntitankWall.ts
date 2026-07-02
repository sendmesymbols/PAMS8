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
import DrawSeam from "../Support/DrawSeam";
export interface AntitankWallOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polyline;
    DRAW_TYPE?: number;
    [key: string]: any;
}

/**
 * AntitankWall — a line (straight or curved, per DRAW_TYPE) carrying downward-pointing
 * triangular teeth along its length ( ‾\/‾\/‾ ): a flat baseline whose tooth apexes are
 * inverted (point to the opposite side of ObstacleLine). Teeth follow the local line
 * direction so they work for both draw types. Not an obstacle (isObstacle = "0"), so it
 * renders in the standard identity color. Single Polyline geometry. MIL-STD-2525D 25290204.
 */
export class AntitankWall {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;

    // Symbol properties
    public declaredClass: string = "MilitarySymbology.Symbols.AntitankWall";
    private SID: string = "290204";
    private symName: string = "Antitank Wall";
    private symGeometricType: string = "Line";
    public isObstacle: string = "0";
    private _lineSym: SimpleLineSymbol | SimpleFillSymbol | null = null;
    private _points: Point[] = [];
    private _drawType: number = 1;
    private amplifier: Amplifier;

    // Teeth tuning: count along the line, base width and apex height as fractions of a cell.
    private _teethCount: number = 7;
    private _toothBaseRatio: number = 0.6;
    private _toothHeightRatio: number = 0.6;
    private _toothSide: number = -1; // +1 / -1: which side of the line the apexes point (-1 = downward/inverted)

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
        this.events = new SymbolEvents(view, "AntitankWall");

        // Initialize layers if not already done
        this.layerManager.initializeLayers();

        // Initialize temporary graphic
        this.tempGraphic = new Graphic();
    }

    /**
     * Initialize the antitank wall drawing
     */
    public init(options: AntitankWallOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void {
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
        drawEssentials.AMPLIFIER = this.amplifier.toString();

        // Store additional properties
        (drawEssentials as any).SCOPE = this;
        (drawEssentials as any).CTRL_PTS = ctrlPts;
        (drawEssentials as any).DRAW_TYPE = drawType;
        (drawEssentials as any).IS_OBS = this.isObstacle;

        return drawEssentials;
    }

    /**
     * Create symbol geometry from DrawEssentials.
     * Builds the base line (straight or bezier), then converts it to a toothed line.
     */
    private createSymbol(drawEssentials: DrawEssentials): Polyline | null {
        try {
            const pts: Point[] = (drawEssentials as any).CTRL_PTS;
            if (!pts || pts.length === 0) throw new Error("controlPoints not found");

            const p1 = pts[0];
            const p2 = pts[pts.length - 1];
            const drawType = (drawEssentials as any).DRAW_TYPE || 1;

            const base = (drawType === 2)
                ? this.createSymbolByLine(pts, p1, p2)
                : this.createSymbolByStraightLine(pts);

            const linePts = (base as any).paths?.[0] as number[][] | undefined;
            if (!linePts || linePts.length < 2) return base;

            return this.buildToothedLine(linePts);

        } catch (e) {
            /* invalid geometry mid-draw is expected; ignore */
            return null;
        }
    }

    /**
     * Convert a plain polyline into a toothed line: flat baseline with triangular teeth
     * ( ‾\/‾ ) whose apexes point to one side, perpendicular to the LOCAL line direction
     * (so it follows curves too). Returns a single closed-free Polyline path.
     */
    private buildToothedLine(linePts: number[][]): Polyline {
        const sr = this.view.spatialReference;
        const result = new Polyline({ spatialReference: sr });

        // Cumulative arc length.
        const cum: number[] = [0];
        for (let i = 1; i < linePts.length; i++) {
            const dx = linePts[i][0] - linePts[i - 1][0];
            const dy = linePts[i][1] - linePts[i - 1][1];
            cum.push(cum[i - 1] + Math.hypot(dx, dy));
        }
        const total = cum[cum.length - 1];
        if (total === 0) {
            result.addPath(linePts);
            return result;
        }

        const teeth = Math.max(1, this._teethCount);
        const cell = total / teeth;
        const toothH = cell * this._toothHeightRatio;
        const baseHalf = cell * this._toothBaseRatio / 2;

        const out: number[][] = [];
        out.push(this.pointAt(linePts, cum, 0));
        for (let k = 0; k < teeth; k++) {
            const c = (k + 0.5) * cell;
            out.push(this.pointAt(linePts, cum, c - baseHalf));            // tooth base (left), on line
            const apex = this.apexAt(linePts, cum, c, toothH);            // apex, perpendicular outward
            out.push(apex);
            out.push(this.pointAt(linePts, cum, c + baseHalf));            // tooth base (right), on line
        }
        out.push(this.pointAt(linePts, cum, total));

        result.addPath(out);
        return result;
    }

    /** Point on the polyline at arc-length s. */
    private pointAt(linePts: number[][], cum: number[], s: number): number[] {
        const total = cum[cum.length - 1];
        if (s <= 0) return [linePts[0][0], linePts[0][1]];
        if (s >= total) return [linePts[linePts.length - 1][0], linePts[linePts.length - 1][1]];
        let i = 1;
        while (i < cum.length && cum[i] < s) i++;
        const segLen = cum[i] - cum[i - 1] || 1;
        const t = (s - cum[i - 1]) / segLen;
        const a = linePts[i - 1], b = linePts[i];
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }

    /** Apex point: the line point at s, offset perpendicular to the local tangent. */
    private apexAt(linePts: number[][], cum: number[], s: number, height: number): number[] {
        const total = cum[cum.length - 1];
        const ss = Math.max(0, Math.min(total, s));
        let i = 1;
        while (i < cum.length && cum[i] < ss) i++;
        const a = linePts[i - 1], b = linePts[i];
        let tx = b[0] - a[0], ty = b[1] - a[1];
        const l = Math.hypot(tx, ty) || 1;
        tx /= l; ty /= l;
        const p = this.pointAt(linePts, cum, ss);
        // Left perpendicular (-ty, tx) scaled by side.
        return [p[0] - ty * height * this._toothSide, p[1] + tx * height * this._toothSide];
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

export default AntitankWall;
