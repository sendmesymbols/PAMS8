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
import BaseLine from "../Support/BaseLine.ts";
import GeoTools from "../Support/GeoTools.ts";
import Utils from "../Support/utils";
import SymbolEvents from "../Support/SymbolEvents";
import DrawSeam from "../Support/DrawSeam";
export interface FreehandDoubleLineArrowOptions {
    CTRL_PTS?: Point[];
    BASE_LN_PTS?: { startPt: Point, endPt: Point };
    GEOM?: Polyline;
    [key: string]: any;
}

/**
 * FreehandDoubleLineArrow class for drawing double line arrow symbols on MapView or SceneView
 * Supports both immediate placement and interactive drawing modes with baseline functionality
 */
export class FreehandDoubleLineArrow {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;

    // Symbol properties
    private SID: string = "000004";
    private symName: string = "Freehand - Double Line Arrow";
    private symGeometricType: string = "Area";
    private _lineSym: SimpleLineSymbol | null = null;
    private _points: Point[] = [];
    private _baseLinePts: { startPt: Point, endPt: Point } | null = null;
    private _geometryType: string | null = null;
    private amplifier: Amplifier;

    // Drawing state
    private isDrawing: boolean = false;
    private tempGraphic: Graphic | null = null;

    // Event handlers
    private clickHandler: any = null;
    private doubleClickHandler: any = null;
    private mouseMoveHandler: any = null;
    private baseLineEndHandler: any = null;
    private baseLineProgressHandler: any = null;
    private baseLineClickHandler: any = null;

    // Event emitter
    private events: SymbolEvents;

    constructor(view: MapView | SceneView, isLine: boolean = false) {
        this.view = view;
        this.isLine = isLine;
        this.layerManager = GraphicsLayerManager.getInstance(view);
        this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.TACT);
        this.amplifier = new Amplifier();
        this.events = new SymbolEvents(view, "FreehandDoubleLineArrow");

        // Initialize layers if not already done
        this.layerManager.initializeLayers();

        // Initialize temporary graphic
        this.tempGraphic = new Graphic();
    }

    /**
     * Initialize the freehand double line arrow drawing
     */
    public init(options: FreehandDoubleLineArrowOptions, marker: SimpleLineSymbol): void {
        this._lineSym = marker;

        let drawEssentials = new DrawEssentials();
        const baseLine = new BaseLine(this.view, this._lineSym);

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("BASE_LN_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
            // Immediate placement with all parameters
            if (options.GEOM && this.tempGraphic) {
                try {
                    this.tempGraphic.geometry = new Polyline({
                        paths: options.GEOM,
                        spatialReference: this.view.spatialReference
                    });
                    drawEssentials = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.BASE_LN_PTS!);
                    this.__drawEnd(this.tempGraphic.geometry, drawEssentials);
                    this._clear();
                } catch (error) {
                    console.error(this.symName, "Failed to create Polyline geometry:", error);
                }
            }

        } else if (options.hasOwnProperty("CTRL_PTS")) {
            if (options.hasOwnProperty("BASE_LN_PTS")) {
                // Immediate placement with control points and baseline
                const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.BASE_LN_PTS!);
                const geometry = this.createSymbol(drawEss);
                if (geometry && this.tempGraphic) {
                    this.tempGraphic.geometry = geometry;
                    this.__drawEnd(geometry, drawEss);
                    this._clear();
                }
            } else {
                throw new Error("Control Points and Baseline or Distance is required to create symbol non-interactively");
            }

        } else {
            // Interactive drawing mode - start with baseline
            this.setupBaseLineHandlers(baseLine);
            baseLine.init();
        }
    }

    /**
     * Set up baseline event handlers
     */
    private setupBaseLineHandlers(baseLine: BaseLine): void {
        this.baseLineEndHandler = baseLine.on("drawEnd", (evt: any) => {
            this.baseLineDrawEnd(evt);
        });

        this.baseLineClickHandler = baseLine.on("onBaseLineClick", (evt: any) => {
            this.baseLineClick(evt);
        });

        this.baseLineProgressHandler = baseLine.on("onBaseLineProgress", (evt: any) => {
            this.baseLineDrawProgress(evt);
        });
    }

    /**
     * Handle baseline draw end
     */
    private baseLineDrawEnd(evt: any): void {
        if (this.baseLineEndHandler) {
            this.baseLineEndHandler.remove();
        }

        this.tempGraphic = new Graphic({
            geometry: evt.geometry,
            symbol: this._lineSym
        });
        this.symbolLayer.add(this.tempGraphic);

        this._baseLinePts = (evt.geometry as any)._baseLine;

        // Set up interactive drawing handlers
        this.setupEventHandlers();

        this.events.emit("onBaseLineDrawEnd", { currentPts: (evt.geometry as any).controlPoints });
    }

    /**
     * Handle baseline draw progress
     */
    private baseLineDrawProgress(evt: any): void {
        const localDrawEssentials: any = {};
        localDrawEssentials.CTRL_PTS = evt.currentGeometry;

        const pl = new Polyline({ spatialReference: this.view.spatialReference });
        pl.addPath(evt.currentGeometry.map((pt: Point) => [pt.x, pt.y]));

        this.events.emit("onDrawProgress", {
            currentGeometry: pl,
            currentDrawEssentials: localDrawEssentials,
            currentMarker: evt.currentMarker,
            isBaseLine: true
        });
    }

    /**
     * Handle baseline click
     */
    private baseLineClick(evt: any): void {
        this.events.emit("onDrawClick", { currentPts: evt.currentGeometry, isBaseLine: true });
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

        // Mouse move handler
        this.mouseMoveHandler = this.view.on("pointer-move", (event) => {
            this._onMouseMoveHandler(event);
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
        this.events.emit("onDrawClick", { currentPts: this._points });

        // For single line mode, finish after first click
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
        if (!this.tempGraphic || !this._baseLinePts) return;

        const mapPoint = DrawSeam.resolvePoint(this.view, inputEvent);
        if (!mapPoint) return;

        const candidatePoint = new Point({
            x: mapPoint.x,
            y: mapPoint.y,
            spatialReference: this.view.spatialReference
        });

        const drawEssentials = new DrawEssentials();
        (drawEssentials as any).CTRL_PTS = this._points.concat([candidatePoint]);
        (drawEssentials as any).BASE_LN_PTS = this._baseLinePts;

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
    private createDrawEssentials(ctrlPts: Point[], baseLinePts: any): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.GEOM = null;
        drawEssentials.AMPLIFIER = this.amplifier.toString();

        // Store additional properties
        (drawEssentials as any).SCOPE = this;
        (drawEssentials as any).CTRL_PTS = ctrlPts;
        (drawEssentials as any).BASE_LN_PTS = baseLinePts;
        (drawEssentials as any).ISFHAND = 1;

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

            const baseLinePts = (drawEssentials as any).BASE_LN_PTS;
            if (!baseLinePts || !baseLinePts.startPt || !baseLinePts.endPt) {
                throw new Error("Base line points not found");
            }

            const stPt = baseLinePts.startPt;
            const endPt = baseLinePts.endPt;
            const midPt = Utils.getMidPoint(stPt, endPt, this.view.spatialReference);
            const firstPoint = pts[0];
            const lastPoint = pts.length >= 1 ? firstPoint : pts[pts.length - 1];

            const result = new Polyline({ spatialReference: this.view.spatialReference });
            const leftArray: Point[] = [];
            const rightArray: Point[] = [];
            const middleArray: Point[] = [];

            // Base Line calculation
            const len = Utils.calculateDistance(midPt, endPt);
            let k = Math.atan((midPt.y - lastPoint.y) / (midPt.x - lastPoint.x));

            switch (Utils.getTwoPointsRelationship(midPt, lastPoint)) {
                case "ne":
                    k += Math.PI / 2;
                    break;
                case "nw":
                    k += Math.PI * 3 / 2;
                    break;
                case "sw":
                    k += Math.PI * 3 / 2;
                    break;
                case "se":
                    k += Math.PI / 2;
                    break;
            }

            const partialLen = len;
            const p1 = new Point({
                x: partialLen * Math.cos(k) + midPt.x,
                y: partialLen * Math.sin(k) + midPt.y,
                spatialReference: this.view.spatialReference
            });
            const p2 = new Point({
                x: -1 * partialLen * Math.cos(k) + midPt.x,
                y: -1 * partialLen * Math.sin(k) + midPt.y,
                spatialReference: this.view.spatialReference
            });

            // Add base line
            result.addPath([[p1.x, p1.y], [p2.x, p2.y]]);

            // Initialize arrays
            if (pts.length >= 1) {
                leftArray.push(p1);
                rightArray.push(p2);
                middleArray.push(midPt);
            }

            // Process front lines
            let shortenLeftPt: Point = p1;
            let shortenRightPt: Point = p2;

            for (let i = 0; i < pts.length; i++) {
                const length = Utils.calculateDistance(midPt, pts[i]);
                const angle = Utils.calculateAngle(midPt, pts[i]);

                const stPtCandidatePt = new Point({
                    x: p1.x + length * Math.cos(angle),
                    y: p1.y + length * Math.sin(angle),
                    spatialReference: this.view.spatialReference
                });
                const endPtCandidatePt = new Point({
                    x: p2.x + length * Math.cos(angle),
                    y: p2.y + length * Math.sin(angle),
                    spatialReference: this.view.spatialReference
                });

                let lineLen = length / 5;
                const baseLineLen = Utils.calculateDistance(stPtCandidatePt, endPtCandidatePt);
                const baseLineLenLimit = baseLineLen / 4;
                if (lineLen > baseLineLenLimit) lineLen = baseLineLenLimit;

                const lineAngle = Utils.calculateAngle(stPtCandidatePt, endPtCandidatePt);
                k = Utils.calculateAngle(midPt, pts[i]);

                // Shorten points for arrow effect
                shortenLeftPt = new Point({
                    x: -1 * length / 10 * Math.cos(k) + stPtCandidatePt.x,
                    y: -1 * length / 5 * Math.sin(k) + stPtCandidatePt.y,
                    spatialReference: this.view.spatialReference
                });
                leftArray.push(shortenLeftPt);

                shortenRightPt = new Point({
                    x: -1 * length / 10 * Math.cos(k) + endPtCandidatePt.x,
                    y: -1 * length / 5 * Math.sin(k) + endPtCandidatePt.y,
                    spatialReference: this.view.spatialReference
                });
                rightArray.push(shortenRightPt);

                const shortenMiddlePt = new Point({
                    x: -1 * length / 10 * Math.cos(k) + pts[i].x,
                    y: -1 * length / 10 * Math.sin(k) + pts[i].y,
                    spatialReference: this.view.spatialReference
                });
                middleArray.push(shortenMiddlePt);
            }

            // Add left and right lines
            result.addPath(leftArray.map(pt => [pt.x, pt.y]));
            result.addPath(rightArray.map(pt => [pt.x, pt.y]));

            // Create arrow head
            if (pts.length > 0) {
                const leftFlankPt = this.getFlankPts(shortenLeftPt, leftArray[0]);
                const rightFlankPt = this.getFlankPts(shortenRightPt, rightArray[0]);

                const arrowHeadPath = [
                    [shortenLeftPt.x, shortenLeftPt.y],
                    [leftFlankPt[1].x, leftFlankPt[1].y],
                    [pts[pts.length - 1].x, pts[pts.length - 1].y],
                    [rightFlankPt[0].x, rightFlankPt[0].y],
                    [shortenRightPt.x, shortenRightPt.y]
                ];
                result.addPath(arrowHeadPath);
            }

            return result;

        } catch (e) {
            /* invalid geometry mid-draw is expected; ignore */
            return null;
        }
    }

    /**
     * Get flank points for arrow head
     */
    private getFlankPts(firstPoint: Point, lastPoint: Point): { x: number, y: number }[] {
        const baseLineLen = Utils.calculateDistance(firstPoint, lastPoint) / 4;
        let cLenLimit = baseLineLen / 4;
        if (cLenLimit > baseLineLen / 2) cLenLimit = baseLineLen / 2;

        const len = cLenLimit;
        let k = Math.atan((firstPoint.y - lastPoint.y) / (firstPoint.x - lastPoint.x));

        switch (Utils.getTwoPointsRelationship(firstPoint, lastPoint)) {
            case "ne":
                k += Math.PI / 2;
                break;
            case "nw":
                k += Math.PI * 3 / 2;
                break;
            case "sw":
                k += Math.PI * 3 / 2;
                break;
            case "se":
                k += Math.PI / 2;
                break;
        }

        const partialLen = len;

        return [
            { x: partialLen * Math.cos(k) + firstPoint.x, y: partialLen * Math.sin(k) + firstPoint.y },
            { x: -1 * partialLen * Math.cos(k) + firstPoint.x, y: -1 * partialLen * Math.sin(k) + firstPoint.y }
        ];
    }


    /**
     * Get baseline points
     */
    public getBaseLinePts(): { startPt: Point, endPt: Point } | null {
        return this._baseLinePts;
    }

    /**
     * Clean up drawing state and finalize
     */
    private cleanUp(): void {
        if (this._points.length === 0 || !this._baseLinePts) return;

        const drawEssentials = this.createDrawEssentials(this._points.slice(), this._baseLinePts);

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
        this._baseLinePts = null;
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
        if (this.baseLineEndHandler) {
            this.baseLineEndHandler.remove();
            this.baseLineEndHandler = null;
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

export default FreehandDoubleLineArrow; 