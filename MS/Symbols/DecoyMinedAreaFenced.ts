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
export interface DecoyMinedAreaFencedOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    DRAW_TYPE?: number;

    [key: string]: any;
}

/**
 * DecoyMinedAreaFenced class for the MIL-STD-2525D Decoy (Phony) Mined Area, Fenced
 * symbol (25270901). Supports drawing types: Bezier curve (1), Polygon (2), Rectangle (3).
 * Non-obstacle (renders in the standard identity colour) with a SOLID line symbol.
 * Around the boundary it places the fence pattern X-X-X-M-X-X-X (an "M" every fourth
 * glyph, the rest "X"). Only the centre inverted-V (caret) is dashed, and that dashing
 * is produced as real GEOMETRY — short stroked ring segments separated by empty gaps —
 * NOT a dashed line style. Copied from DecoyMinedArea.
 */
export class DecoyMinedAreaFenced {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;

    // Symbol properties
    public declaredClass = "MilitarySymbology.Symbols.DecoyMinedAreaFenced";
    private SID: string = "270901";
    private symName: string = "Decoy Mined Area Fenced";
    private symGeometricType: string = "Area";
    public isObstacle: string = "0";
    private _lineSym: SimpleLineSymbol | null = null;
    private _points: Point[] = [];
    private _drawType: number = 1;
    private amplifier: Amplifier;

    // Fence pattern: total glyphs around the boundary, and "M" every Nth (rest "X").
    private _fenceGlyphCount: number = 16;
    private _fenceMEvery: number = 4;

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
        this.events = new SymbolEvents(view, "DecoyMinedAreaFenced");

        // Initialize layers if not already done
        this.layerManager.initializeLayers();

        // Initialize temporary graphic
        this.tempGraphic = new Graphic();
    }

    /**
     * Initialize the decoy mined area (fenced) drawing
     */
    public init(options: DecoyMinedAreaFencedOptions, marker: SimpleLineSymbol): void {
        this._lineSym = marker.clone();
        this._drawType = options.DRAW_TYPE || 1;

        // Set up event handlers
        this.setupEventHandlers();

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
            // Immediate placement with both control points and geometry
            if (options.GEOM && this.tempGraphic) {
                try {
                    this.tempGraphic.geometry = new Polygon({
                        rings: options.GEOM as any,
                        spatialReference: this.view.spatialReference
                    });
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

            let result: Polygon | Polyline | null = null;

            switch (drawType) {
                case 1:
                    result = Shapes.createSymbolByBCurve(pts, firstPoint, lastPoint, drawEssentials, this.view.spatialReference);
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

            if (!result) {
                return result;
            }

            // X-X-X-M fence around the boundary, then the dashed decoy caret in the centre.
            const withFence = this.createFenceMarkers(result as Polygon);
            return this.addDecoyMarker(withFence);

        } catch (e) {
            /* invalid geometry mid-draw is expected; ignore */
            return null;
        }
    }


    /**
     * Place the fence pattern X-X-X-M-X-X-X around the boundary: evenly-spaced glyphs
     * by arc length, an "M" every _fenceMEvery-th (anchored at the top-centre) and an
     * "X" otherwise. Each glyph is broken into 2-point segments (so multi-point strokes
     * like "X" survive) and added as polygon rings — sharing the solid line symbol.
     */
    private createFenceMarkers(result: Polygon): Polygon {
        try {
            const extent = result.extent;
            if (!extent) {
                return result;
            }

            const sp = (extent.center as Point)?.spatialReference || this.view.spatialReference;
            const dr = Math.min(extent.width, extent.height) / 16; // glyph half-height
            if (!dr || dr <= 0) {
                return result;
            }

            const ring = (result.rings && result.rings.length > 0) ? result.rings[0] : null;
            if (!ring || ring.length < 2) {
                return result;
            }

            // Cumulative arc length around the boundary ring.
            const cum: number[] = [0];
            for (let i = 1; i < ring.length; i++) {
                cum.push(cum[i - 1] + Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]));
            }
            const total = cum[cum.length - 1];
            if (total <= 0) {
                return result;
            }

            // Anchor the first "M" at the top-centre, then step evenly around the ring.
            const cx = (extent.xmin + extent.xmax) / 2;
            const startS = this.arcLengthNearest(ring, cum, cx, extent.ymax);

            const glyphCount = Math.max(this._fenceMEvery, this._fenceGlyphCount);
            for (let g = 0; g < glyphCount; g++) {
                const s = (startS + (total * g) / glyphCount) % total;
                const pos = this.ringPointAt(ring, cum, s);

                const strokesList: Point[][] = (g % this._fenceMEvery === 0)
                    ? (Shapes as any).createM(pos[0], pos[1], dr, sp)        // M -> Point[][]
                    : [(Shapes as any).createX(pos[0], pos[1], dr, sp)];     // X -> wrap Point[]

                this.addGlyphSegments(result, strokesList);
            }

            return result;
        } catch (e) {
            console.log('Cannot create fence markers');
            return result;
        }
    }

    /**
     * Add the decoy marker: a dashed inverted-V (caret, apex up) in the centre. The dashes
     * are real GEOMETRY — each dash is a short stroked ring with a gap of empty geometry
     * after it — NOT a dashed line style, so the caret reads dashed while the rest of the
     * symbol (boundary + X/M fence) stays solid.
     */
    private addDecoyMarker(result: Polygon): Polygon {
        try {
            const extent = result.extent;
            if (!extent) {
                return result;
            }

            const w = extent.width;
            const h = extent.height;
            if (!w || !h) {
                return result;
            }

            const cx = (extent.xmin + extent.xmax) / 2;
            const cy = (extent.ymin + extent.ymax) / 2;

            // Inverted-V (apex up), centred, proportional to the area extent.
            const apex: number[] = [cx, cy + h * 0.18];
            const leftEnd: number[] = [cx - w * 0.27, cy - h * 0.10];
            const rightEnd: number[] = [cx + w * 0.27, cy - h * 0.10];

            // Dash period (dash + gap) and the "on" fraction, sized to the shape.
            const period = Math.min(w, h) * 0.09;
            const dutyOn = 0.55;

            // Dash both legs from the outer end toward the apex so the pattern is
            // mirror-symmetric about the vertical axis. Real geometry — NOT a line style.
            const dashes: number[][][] = [
                ...this.dashedSegments(leftEnd, apex, period, dutyOn),
                ...this.dashedSegments(rightEnd, apex, period, dutyOn)
            ];

            for (let i = 0; i < dashes.length; i++) {
                const d = dashes[i];
                if (d && d.length === 2) {
                    // Close the 2-point dash minimally so it renders as one stroked segment.
                    result.addRing([d[0], d[1], d[0]]);
                }
            }

            return result;
        } catch (e) {
            console.log('Cannot create Decoy marker');
            return result;
        }
    }

    /**
     * Break a line segment into dash sub-segments (real geometry). Returns an array of
     * [start, end] point pairs; the gaps between consecutive dashes are left empty.
     */
    private dashedSegments(p1: number[], p2: number[], period: number, dutyOn: number): number[][][] {
        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const len = Math.hypot(dx, dy);
        if (len === 0 || period <= 0) {
            return [[p1, p2]];
        }
        const ux = dx / len;
        const uy = dy / len;
        const on = period * Math.max(0.05, Math.min(0.95, dutyOn));
        const segs: number[][][] = [];
        let s = 0;
        while (s < len - 1e-6) {
            const e = Math.min(s + on, len);
            segs.push([
                [p1[0] + ux * s, p1[1] + uy * s],
                [p1[0] + ux * e, p1[1] + uy * e]
            ]);
            s += period;
        }
        return segs;
    }

    /**
     * Break each stroke of a glyph into 2-point segments and add them as polygon rings
     * (closed minimally so they stay stroked segments rather than filled areas).
     */
    private addGlyphSegments(result: Polygon, strokesList: Point[][]): void {
        const segs = (Shapes as any).strokesToSegments
            ? (Shapes as any).strokesToSegments(strokesList)
            : null;
        if (!segs || !Array.isArray(segs)) {
            return;
        }
        for (let i = 0; i < segs.length; i++) {
            const seg = segs[i];
            if (seg && seg.length === 2) {
                result.addRing([seg[0], seg[1], seg[0]]);
            }
        }
    }

    /** Point on the boundary ring at arc-length s (wraps around the closed ring). */
    private ringPointAt(ring: number[][], cum: number[], s: number): number[] {
        const total = cum[cum.length - 1];
        let ss = total > 0 ? s % total : 0;
        if (ss < 0) ss += total;
        if (ss <= 0) return [ring[0][0], ring[0][1]];
        let i = 1;
        while (i < cum.length && cum[i] < ss) i++;
        if (i >= cum.length) return [ring[ring.length - 1][0], ring[ring.length - 1][1]];
        const segLen = (cum[i] - cum[i - 1]) || 1;
        const t = (ss - cum[i - 1]) / segLen;
        const a = ring[i - 1], b = ring[i];
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }

    /** Arc-length of the ring vertex nearest to (x, y) — used to anchor the first "M". */
    private arcLengthNearest(ring: number[][], cum: number[], x: number, y: number): number {
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < ring.length; i++) {
            const dx = ring[i][0] - x;
            const dy = ring[i][1] - y;
            const d = dx * dx + dy * dy;
            if (d < bestDist) {
                bestDist = d;
                bestIdx = i;
            }
        }
        return cum[bestIdx] || 0;
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

export default DecoyMinedAreaFenced;
