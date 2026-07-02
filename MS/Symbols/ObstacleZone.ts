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
import Shapes from "../Support/Shapes.ts";
import DrawSeam from "../Support/DrawSeam";

import SymbolEvents from "../Support/SymbolEvents";
export interface ObstacleZoneOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    DRAW_TYPE?: number;

    [key: string]: any;
}

/**
 * ObstacleZone — an obstacle area whose entire boundary is a sawtooth (outward-pointing
 * teeth), rendered green via the obstacle marker. Based on NamedAreaOfInterest, but the
 * inner "NAI" text is removed and the smooth outline is replaced by the toothed perimeter.
 * The whole symbol is a single Polygon geometry (one toothed ring).
 */
export class ObstacleZone {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;

    // Symbol properties
    public declaredClass = "MilitarySymbology.Symbols.ObstacleZone";
    private SID: string = "270200";
    private symName: string = "Obstacle Zone";
    private symGeometricType: string = "Area";
    public isObstacle: string = "1";
    private _lineSym: SimpleLineSymbol | null = null;
    private _points: Point[] = [];
    private _geometryType: string | null = null;
    private _drawType: number = 1;
    private amplifier: Amplifier;

    // Tooth density / depth / base width (relative to perimeter / edge length).
    private _teethCount: number = 24;
    private _toothHeightRatio: number = 0.7;
    private _toothBaseRatio: number = 0.7;

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
        this.events = new SymbolEvents(view, "ObstacleZone");

        // Initialize layers if not already done
        this.layerManager.initializeLayers();

        // Initialize temporary graphic
        this.tempGraphic = new Graphic();
    }

    /**
     * Initialize the obstacle zone drawing
     */
    public init(options: ObstacleZoneOptions, marker: SimpleLineSymbol): void {
        this._lineSym = marker.clone();
        this._drawType = options.DRAW_TYPE || 1;

        // Set up event handlers
        this.setupEventHandlers();

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
            // Immediate placement with both control points and geometry
            if (options.GEOM && this.tempGraphic) {
                try {
                    this.tempGraphic.geometry = (options.GEOM instanceof Polygon)
                        ? options.GEOM
                        : new Polygon({ rings: (options.GEOM as any), spatialReference: this.view.spatialReference });
                } catch (error) {
                    console.error(this.symName, "Failed to create Polygon geometry:", error);
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
        (drawEssentials as any).IS_OBS = this.isObstacle;

        return drawEssentials;
    }

    /**
     * Create symbol geometry from DrawEssentials.
     * Builds the base area (bezier / polygon / rect) then replaces its smooth outline
     * with an outward-pointing sawtooth ring. Single Polygon geometry, no inner text.
     */
    private createSymbol(drawEssentials: DrawEssentials): Polygon | null {
        try {
            const pts: Point[] = (drawEssentials as any).CTRL_PTS;
            if (!pts || pts.length === 0) throw new Error("controlPoints not found");

            const firstPoint = pts[0];
            const lastPoint = pts[pts.length - 1];
            const drawType = (drawEssentials as any).DRAW_TYPE || 1;
            const sr = this.view.spatialReference;

            let base: Polygon | Polyline | null;
            switch (drawType) {
                case 2:
                    base = Shapes.createSymbolByPolygon(pts, firstPoint, lastPoint, drawEssentials, sr);
                    break;
                case 3:
                    base = Shapes.createSymbolByRect(pts, firstPoint, lastPoint, drawEssentials, sr);
                    break;
                case 1:
                default:
                    base = Shapes.createSymbolByBCurve(pts, firstPoint, lastPoint, drawEssentials, sr);
            }

            if (!base) return null;
            return this.applySawtooth(base);

        } catch (e) {
            /* invalid geometry mid-draw is expected; ignore */
            return null;
        }
    }

    /**
     * Replace a base area outline with outward-pointing teeth seated on a flat baseline.
     * Each edge gets one triangular tooth in its middle; the ends of every edge stay ON
     * the boundary, so the gaps between teeth are flat (no inward "valley" teeth — every
     * tooth points outward). Returns a single closed Polygon.
     */
    private applySawtooth(base: Polygon | Polyline): Polygon {
        const sr = this.view.spatialReference;

        const ring: number[][] =
            (base as any).rings?.[0] ??
            (base as any).paths?.[0] ??
            [];
        if (ring.length < 4) return base as Polygon;

        const sampled = this.resampleClosedRing(ring, this._teethCount);
        if (sampled.length < 3) return base as Polygon;

        // Centroid for outward orientation.
        let cx = 0, cy = 0;
        for (const p of sampled) { cx += p[0]; cy += p[1]; }
        cx /= sampled.length; cy /= sampled.length;

        // Mean edge length -> tooth height.
        let perim = 0;
        for (let i = 0; i < sampled.length; i++) {
            const a = sampled[i], b = sampled[(i + 1) % sampled.length];
            perim += Math.hypot(b[0] - a[0], b[1] - a[1]);
        }
        const toothHeight = (perim / sampled.length) * this._toothHeightRatio;

        // Tooth base spans this fraction of each edge, centered; the rest stays flat.
        const halfBase = this._toothBaseRatio / 2;

        const sawtooth: number[][] = [];
        for (let i = 0; i < sampled.length; i++) {
            const a = sampled[i];
            const b = sampled[(i + 1) % sampled.length];
            const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;

            let ex = b[0] - a[0], ey = b[1] - a[1];
            const len = Math.hypot(ex, ey) || 1;
            ex /= len; ey /= len;

            // Perpendicular, flipped so the apex points outward (away from centroid).
            let px = -ey, py = ex;
            if (px * (mx - cx) + py * (my - cy) < 0) { px = -px; py = -py; }

            // Tooth base centered on the edge; its ends stay on the baseline so the
            // segments between teeth are flat (outward teeth only, never inward).
            const tL = [mx - ex * len * halfBase, my - ey * len * halfBase];
            const tR = [mx + ex * len * halfBase, my + ey * len * halfBase];
            const apex = [mx + px * toothHeight, my + py * toothHeight];

            sawtooth.push(a, tL, apex, tR);
        }
        sawtooth.push([sampled[0][0], sampled[0][1]]); // close the ring

        const result = new Polygon({ spatialReference: sr });
        result.addRing(sawtooth);
        return result;
    }

    /**
     * Resample a (possibly open) ring into `n` points equally spaced by arc length.
     */
    private resampleClosedRing(ring: number[][], n: number): number[][] {
        const pts = ring.slice();
        const first = pts[0];
        const last = pts[pts.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
            pts.push([first[0], first[1]]);
        }

        const seg: number[] = [];
        let total = 0;
        for (let i = 0; i < pts.length - 1; i++) {
            const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
            seg.push(d);
            total += d;
        }
        if (total === 0) return [];

        const step = total / n;
        const out: number[][] = [];
        let segIdx = 0;
        let segStart = 0;
        for (let k = 0; k < n; k++) {
            const target = k * step;
            while (segIdx < seg.length - 1 && segStart + seg[segIdx] < target) {
                segStart += seg[segIdx];
                segIdx++;
            }
            const segLen = seg[segIdx] || 1;
            const t = (target - segStart) / segLen;
            const a = pts[segIdx], b = pts[segIdx + 1];
            out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
        return out;
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

export default ObstacleZone;
