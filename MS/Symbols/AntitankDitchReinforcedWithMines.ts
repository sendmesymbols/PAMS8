import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import GraphicsLayerManager, {LAYER_NAMES} from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";
import GeoTools from "../Support/GeoTools.ts";


import SymbolEvents from "../Support/SymbolEvents";
export interface AntitankDitchReinforcedWithMinesOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    DRAW_TYPE?: number;

    [key: string]: any;
}

/**
 * AntitankDitchReinforcedWithMines — the antitank-ditch line (filled triangular teeth)
 * reinforced with antitank mines (filled circles). Teeth are inverted relative to
 * DitchEmpty and alternate with the mine circles along the line. Everything is one Polygon
 * geometry rendered with a SimpleFillSymbol so both the teeth and circles read as solid.
 */
export class AntitankDitchReinforcedWithMines {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;

    // Symbol properties
    public declaredClass: string = "MilitarySymbology.Symbols.AntitankDitchReinforcedWithMines";
    public SID: string = "290203";
    public symName: string = "Antitank Ditch Reinforced with Antitank Mines";
    public symGeometricType: string = "Line";
    public isObstacle: string = "1";

    private _fillSym: SimpleFillSymbol | null = null;
    private _points: Point[] = [];
    private _teethSize: number = 3;
    private _teethGap: number = 20;
    private _circleRatio: number = 0.6; // mine radius as a fraction of tooth height
    private _lineHalfWidthRatio: number = 0.003; // connecting line half-width as a fraction of baseline length
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
        this.events = new SymbolEvents(view, "AntitankDitchReinforcedWithMines");

        // Initialize layers if not already done
        this.layerManager.initializeLayers();

        // Initialize temporary graphic
        this.tempGraphic = new Graphic();
    }

    /**
     * Initialize the drawing
     */
    public init(options: AntitankDitchReinforcedWithMinesOptions, marker: SimpleLineSymbol): void {
        // Filled black symbol so teeth and mines render solid (a Polyline / line symbol
        // could not be filled — an area + fill is the way to get solid shapes).
        this._fillSym = new SimpleFillSymbol({
            color: "black",
            outline: new SimpleLineSymbol({ color: "black", width: marker.width })
        });

        this._drawType = options.DRAW_TYPE || 1;

        // Set up event handlers
        this.setupEventHandlers();

        // Set default values from options
        this._teethSize = GeoTools.setDefault(options, "TEETH_SIZE", this._teethSize);
        this._teethGap = GeoTools.setDefault(options, "TEETH_GAP", this._teethGap);

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
            // Immediate placement with both control points and geometry
            if (options.GEOM && this.tempGraphic) {
                try {
                    this.tempGraphic.geometry = options.GEOM;
                } catch (error) {
                    console.error(this.symName, "Failed to set Polygon geometry:", error);
                }
            }

            const drawEss = this.createDrawEssentials(options.CTRL_PTS!, this._teethSize, this._teethGap);
            if (this.tempGraphic && this.tempGraphic.geometry) {
                this.__drawEnd(this.tempGraphic.geometry as Polygon, drawEss);
            }
            this._clear();

        } else if (options.hasOwnProperty("CTRL_PTS")) {
            // Immediate placement with control points only
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!, this._teethSize, this._teethGap);
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
        if (!this._fillSym) return;
        this.isDrawing = true;
        this.tempGraphic = new Graphic({
            geometry: null,
            symbol: this._fillSym,
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


        const drawEssentials = this.createDrawEssentials(
            [...this._points, candidatePoint],
            this._teethSize,
            this._teethGap
        );

        (drawEssentials as any).CTRL_PTS = this._points.concat([candidatePoint]);
        (drawEssentials as any).DRAW_TYPE = this._drawType;

        const geometry = this.createSymbol(drawEssentials);
        if (geometry) {
            this.tempGraphic.geometry = geometry;
            this.events.emit("onDrawProgress", {
                currentGeometry: geometry,
                currentDrawEssentials: drawEssentials,
                currentMarker: this._fillSym
            });
        }
    }

    /**
     * Create DrawEssentials object with symbol parameters
     */
    private createDrawEssentials(ctrlPts: Point[], teethSize: number, teethGap: number): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        (drawEssentials as any).SCOPE = this;
        (drawEssentials as any).CTRL_PTS = ctrlPts;
        (drawEssentials as any).AMPLIFIER = this.amplifier.toString();
        (drawEssentials as any).IS_OBS = this.isObstacle;
        (drawEssentials as any).TEETH_SIZE = teethSize;
        (drawEssentials as any).TEETH_GAP = teethGap;

        return drawEssentials;
    }

    /**
     * Build a closed circle ring (filled mine) of radius r centred at (cx, cy).
     */
    private circleRing(cx: number, cy: number, r: number): number[][] {
        const ring: number[][] = [];
        const steps = 20;
        for (let i = 0; i <= steps; i++) {
            const a = (Math.PI * 2 * i) / steps;
            ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
        return ring;
    }

    /**
     * Force a ring clockwise. ArcGIS treats counter-clockwise rings as holes, so a polygon
     * of all-CCW rings renders as outline only (no fill). Clockwise rings fill solid.
     */
    private ensureCW(ring: number[][]): number[][] {
        let area = 0;
        for (let i = 0; i < ring.length - 1; i++) {
            area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
        }
        return area > 0 ? ring.slice().reverse() : ring;
    }

    /**
     * Build a thin filled ribbon (closed ring) along the centre line — the connecting
     * ditch line. Offsets each sample ±hw perpendicular to the local direction.
     */
    private buildRibbon(samples: Point[], hw: number): number[][] {
        const n = samples.length;
        const left: number[][] = [];
        const right: number[][] = [];
        for (let i = 0; i < n; i++) {
            let dx: number, dy: number;
            if (i === 0) { dx = samples[1].x - samples[0].x; dy = samples[1].y - samples[0].y; }
            else if (i === n - 1) { dx = samples[n - 1].x - samples[n - 2].x; dy = samples[n - 1].y - samples[n - 2].y; }
            else { dx = samples[i + 1].x - samples[i - 1].x; dy = samples[i + 1].y - samples[i - 1].y; }
            const l = Math.hypot(dx, dy) || 1;
            const nx = -dy / l, ny = dx / l;
            left.push([samples[i].x + nx * hw, samples[i].y + ny * hw]);
            right.push([samples[i].x - nx * hw, samples[i].y - ny * hw]);
        }
        const ring: number[][] = [...left];
        for (let i = n - 1; i >= 0; i--) ring.push(right[i]);
        ring.push([left[0][0], left[0][1]]); // close
        return ring;
    }

    /**
     * Create the symbol geometry: inverted filled teeth alternating with filled mine
     * circles along the line. Single Polygon with one ring per shape.
     */
    private createSymbol(drawEssentials: DrawEssentials): Polygon | null {
        try {
            if (!(drawEssentials as any).CTRL_PTS) {
                throw new Error("Control points not found");
            }

            const pts = (drawEssentials as any).CTRL_PTS as Point[];
            if (pts.length < 2) {
                return null;
            }

            const result = new Polygon({
                spatialReference: this.view.spatialReference
            });

            const firstPoint = pts[0];
            const lastPoint = pts[pts.length - 1];
            const baseLineLen = GeoTools._2PtLen(firstPoint, lastPoint);
            const middleArray = pts;

            // Sample the centre line into evenly spaced points.
            const gapRatio = GeoTools._2PtLen(middleArray[0], middleArray[middleArray.length - 1]) / this._teethGap;
            const midSamples = GeoTools.getDashPts(middleArray, [gapRatio, gapRatio]);
            const samples = midSamples && midSamples.length > 1 ? midSamples : middleArray;

            // Connecting ditch line: a thin filled ribbon down the centre of the line.
            if (samples.length >= 2) {
                const hw = baseLineLen * this._lineHalfWidthRatio;
                result.addRing(this.ensureCW(this.buildRibbon(samples, hw)));
            }

            // Alternate: inverted filled tooth, then filled mine circle, along the line.
            let makeTooth = true;
            for (let i = 1; i < samples.length; i++) {
                const p0 = samples[i - 1];
                const p1 = samples[i];

                const dx = p1.x - p0.x;
                const dy = p1.y - p0.y;
                const segLen = Math.sqrt(dx * dx + dy * dy);
                if (segLen === 0) continue;

                // Unit tangent and normal
                const ux = dx / segLen;
                const uy = dy / segLen;
                const nx = -uy;
                const ny = ux;

                const height = Math.max(segLen / Math.max(2, this._teethSize), baseLineLen / 40);
                const midX = (p0.x + p1.x) / 2;
                const midY = (p0.y + p1.y) / 2;

                if (makeTooth) {
                    // Inverted tooth (side = -1, opposite DitchEmpty), apex off the line.
                    const side = -1;
                    const apexX = midX + nx * height * side;
                    const apexY = midY + ny * height * side;
                    result.addRing(this.ensureCW([
                        [p0.x, p0.y],
                        [apexX, apexY],
                        [p1.x, p1.y],
                        [p0.x, p0.y]
                    ]));
                } else {
                    // Mine: filled circle hanging BELOW the line (same side as the teeth),
                    // tangent to it — centre offset one radius along -normal so its top sits
                    // on the line and the body is below.
                    const r = height * this._circleRatio;
                    const ccx = midX - nx * r;
                    const ccy = midY - ny * r;
                    result.addRing(this.ensureCW(this.circleRing(ccx, ccy, r)));
                }

                makeTooth = !makeTooth;
            }

            return result;

        } catch (error) {
            console.error(this.declaredClass + ' Cannot create symbol due to invalid geometry:', error);
            return null;
        }
    }

    /**
     * Complete the drawing process
     */
    private cleanUp(): void {
        if (this._points.length < 2) return;

        const drawEssentials = this.createDrawEssentials(
            [...this._points],
            this._teethSize,
            this._teethGap
        );

        const geometry = this.createSymbol(drawEssentials);
        if (geometry) {
            this.__drawEnd(geometry, drawEssentials);
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
            marker: this._fillSym
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

export default AntitankDitchReinforcedWithMines;
