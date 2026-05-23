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
import Shapes from "../Support/Shapes.ts";

import SymbolEvents from "../Support/SymbolEvents";
export interface UARouteOptions {
    CTRL_PTS?: Point[];
    BASE_LN_PTS?: {startPt: Point, endPt: Point};
    GEOM?: Polyline;
    [key: string]: any;
}

/**
 * UARoute class for drawing UARoute tactical symbols
 * Uses baseline + control points
 * Returns Polyline geometry despite being classified as an Area symbol
 */
export class UARoute {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;

    // Symbol properties
    public SID = "170700";
    public symName = "UAV Route";
    public symGeometricType = "Line";

    private _lineSym: SimpleLineSymbol | null = null;
    private _points: Point[] = [];
    private _baseLinePts: any = {};
    private _geometryType: string | null = null;
    private amplifier: Amplifier;

    // Drawing state
    private isDrawing: boolean = false;
    private tempGraphic: Graphic | null = null;
    private baseLineComplete: boolean = false;

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
        this.events = new SymbolEvents(view, "UARoute");

        // Initialize layers if not already done
        this.layerManager.initializeLayers();

        // Initialize temporary graphic
        this.tempGraphic = new Graphic();
    }

    /**
     * Initialize the UARoute drawing
     */
    public init(options: UARouteOptions, marker: SimpleLineSymbol): void {
        this._lineSym = marker.clone();

        const drawEssentials = new DrawEssentials();

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("BASE_LN_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
            // Immediate placement with both control points and geometry
            if (options.GEOM && this.tempGraphic) {
                try {
                    // If GEOM is already a Polyline, use it directly; otherwise, build from paths
                    this.tempGraphic.geometry = (options.GEOM instanceof Polyline)
                        ? options.GEOM
                        : new Polyline({ paths: (options.GEOM as any), spatialReference: this.view.spatialReference });
                } catch (error) {
                    console.error(this.symName, "Failed to create Polyline geometry:", error);
                }
            }

            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.BASE_LN_PTS!);
            if (this.tempGraphic && this.tempGraphic.geometry) {
                this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEss);
            }
            this._clear();

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
            this.startBaseLineDrawing();
        }
    }

    /**
     * Start baseline drawing
     */
    private startBaseLineDrawing(): void {
        const baseLine = new BaseLine(this.view, this._lineSym!);

        this.baseLineClickHandler = baseLine.on("onBaseLineClick", (evt: any) => {
            this.baseLineClick(evt);
        });

        this.baseLineProgressHandler = baseLine.on("onBaseLineProgress", (evt: any) => {
            this.baseLineDrawProgress(evt);
        });

        this.baseLineEndHandler = baseLine.on("drawEnd", (evt: any) => {
            this.baseLineDrawEnd(evt);
        });

        baseLine.init();
    }

    /**
     * Handle baseline click events
     */
    private baseLineClick(evt: any): void {
        this.events.emit("onDrawClick", {
            currentPts: evt.currentGeometry,
            isBaseLine: true
        });
    }

    /**
     * Handle baseline draw progress
     */
    private baseLineDrawProgress(evt: any): void {
        const localDrawEssentials: any = {};
        localDrawEssentials.CTRL_PTS = evt.currentGeometry;

        const pl = new Polyline({ spatialReference: this.view.spatialReference });
        pl.addPath(evt.currentGeometry);

        this.events.emit("onDrawProgress", {
            currentGeometry: pl,
            currentDrawEssentials: localDrawEssentials,
            currentMarker: evt.currentMarker,
            isBaseLine: true
        });
    }

    /**
     * Handle baseline draw end
     */
    private baseLineDrawEnd(evt: any): void {
        if (this.baseLineEndHandler) {
            this.baseLineEndHandler.remove();
            this.baseLineEndHandler = null;
        }

        this.tempGraphic = new Graphic({
            geometry: evt.geometry,
            symbol: this._lineSym
        });
        this.symbolLayer.add(this.tempGraphic);

        this._baseLinePts = (evt.geometry as any)._baseLine;
        this.baseLineComplete = true;

        // Start control point drawing
        this.setupControlPointHandlers();

        this.events.emit("onBaseLineDrawEnd", {
            currentPts: (evt.geometry as any).controlPoints
        });
    }

    /**
     * Set up control point drawing handlers
     */
    private setupControlPointHandlers(): void {
        // Mouse move handler
        this.mouseMoveHandler = this.view.on("pointer-move", (event) => {
            this._onMouseMoveHandler(event);
        });

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
     * Handle click events for control points
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
        if (!this.baseLineComplete || !this.tempGraphic) return;

        const mapPoint = this.view.toMap(inputEvent);
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

        return drawEssentials;
    }

    /**
     * Create symbol geometry from DrawEssentials
     */
    private createSymbol(drawEssentials: DrawEssentials): Polyline | null {
        try {
            // Extract control points
            const pts: Point[] = (drawEssentials as any).CTRL_PTS;
            if (!pts || pts.length === 0) {
                throw new Error("controlPoints not found");
            }

            // Extract baseline points
            const stPt: Point = (drawEssentials as any).BASE_LN_PTS?.startPt;
            const endPt: Point = (drawEssentials as any).BASE_LN_PTS?.endPt;
            if (!stPt || !endPt) {
                throw new Error("First Parameter of the Function is an Array with Start and End Point");
            }

            const spatialReference = this.view.spatialReference;
            const result = new Polyline({ spatialReference });

            // Midpoint of baseline
            const midPt = GeoTools.getMidPoint(stPt, endPt);

            // Orientation for corridor sides based on first control point
            const firstPoint = pts[0];
            let k = Math.atan((midPt.y - firstPoint.y) / (midPt.x - firstPoint.x));
            switch (GeoTools.twoPtsRelationShip(midPt, firstPoint)) {
                case "ne":
                    k += Math.PI / 2; break;
                case "nw":
                    k += Math.PI * 3 / 2; break;
                case "sw":
                    k += Math.PI * 3 / 2; break;
                case "se":
                    k += Math.PI / 2; break;
            }

            const partialLen = GeoTools._2PtLen(midPt, endPt);
            const p1 = { x: partialLen * Math.cos(k) + midPt.x, y: partialLen * Math.sin(k) + midPt.y };
            const p2 = { x: -1 * partialLen * Math.cos(k) + midPt.x, y: -1 * partialLen * Math.sin(k) + midPt.y };

            // Build left/right corridor paths and middle track
            const leftArray: number[][] = [];
            const rightArray: number[][] = [];
            const middleArray: Point[] = [];

            if (pts.length >= 1) {
                leftArray.push([p1.x, p1.y]);
                rightArray.push([p2.x, p2.y]);
                middleArray.push(midPt);
            }

            const gapLen = GeoTools._2PtLen(endPt, stPt);

            for (let i = 0; i < pts.length; i++) {
                const candidate = pts[i];
                const length = GeoTools._2PtLen(midPt, candidate);
                const angle = GeoTools.angleInRadians(midPt, candidate);

                const stPtCandidatePt = new Point({
                    x: p1.x + length * Math.cos(angle),
                    y: p1.y + length * Math.sin(angle),
                    spatialReference
                });
                const endPtCandidatePt = new Point({
                    x: p2.x + length * Math.cos(angle),
                    y: p2.y + length * Math.sin(angle),
                    spatialReference
                });

                // Clamp short offsets relative to instantaneous baseline
                let lenCand = length / 5;
                const baseLineLen = GeoTools._2PtLen(stPtCandidatePt, endPtCandidatePt);
                const baseLineLenLimit = baseLineLen / 4;
                if (lenCand > baseLineLenLimit) lenCand = baseLineLenLimit;

                // Angle between instantaneous baseline endpoints (not used further but preserved for parity)
                const angle2 = GeoTools.angleInRadians(stPtCandidatePt, endPtCandidatePt);
                const _pt1 = new Point({
                    x: -1 * lenCand * Math.cos(angle2) + stPtCandidatePt.x,
                    y: -1 * lenCand * Math.sin(angle2) + stPtCandidatePt.y,
                    spatialReference
                });
                const _pt2 = new Point({
                    x: lenCand * Math.cos(angle2) + endPtCandidatePt.x,
                    y: lenCand * Math.sin(angle2) + endPtCandidatePt.y,
                    spatialReference
                });
                void(_pt1); void(_pt2);

                leftArray.push([stPtCandidatePt.x, stPtCandidatePt.y]);
                rightArray.push([endPtCandidatePt.x, endPtCandidatePt.y]);
                middleArray.push(candidate);

                // Circles at each candidate
                result.addPath(this.createACP(candidate, gapLen / 2));

                // "ACP" letters near the candidate
                const acpStrokes = (Shapes as any).createACP
                    ? (Shapes as any).createACP(candidate.x, candidate.y, gapLen / 10, spatialReference)
                    : [];
                if (Array.isArray(acpStrokes)) {
                    for (let j = 0; j <= acpStrokes.length - 1; j++) {
                        const seg = acpStrokes[j] as Point[];
                        if (seg && seg.length) {
                            result.addPath(seg.map(p => [p.x, p.y]));
                        }
                    }
                }
            }

            // Add corridor side paths
            if (leftArray.length >= 2) result.addPath(leftArray);
            if (rightArray.length >= 2) result.addPath(rightArray);

            // Central ACP at the baseline midpoint
            if (middleArray.length > 0) {
                result.addPath(this.createACP(middleArray[0], gapLen / 2));

                const midAcpStrokes = (Shapes as any).createACP
                    ? (Shapes as any).createACP(middleArray[0].x, middleArray[0].y, gapLen / 10, spatialReference)
                    : [];
                if (Array.isArray(midAcpStrokes)) {
                    for (let j = 0; j <= midAcpStrokes.length - 1; j++) {
                        const seg = midAcpStrokes[j] as Point[];
                        if (seg && seg.length) {
                            result.addPath(seg.map(p => [p.x, p.y]));
                        }
                    }
                }
            }

            // Fracture middle path only to get midpoints; do not add fracture geometry
            const values = (GeoTools as any)._fracture
                ? (GeoTools as any)._fracture(middleArray, 10, spatialReference)
                : null;

            const corridorBaseLen = GeoTools._2PtLen(new Point({ x: p1.x, y: p1.y, spatialReference }), new Point({ x: p2.x, y: p2.y, spatialReference }));
            if (values && values.midPoints && Array.isArray(values.midPoints)) {
                for (let i = 0; i < values.midPoints.length; i++) {
                    let cLenLimit = values.midPoints[i].len / 2;
                    if (cLenLimit > corridorBaseLen / 3.6) cLenLimit = corridorBaseLen / 3.6;
                    const uaStrokes = (Shapes as any).createUA
                        ? (Shapes as any).createUA(values.midPoints[i].midPt.x, values.midPoints[i].midPt.y, cLenLimit, values.midPoints[i].midPt.spatialReference)
                        : [];
                    if (Array.isArray(uaStrokes)) {
                        for (let j = 0; j <= uaStrokes.length - 1; j++) {
                            const seg = uaStrokes[j] as Point[];
                            if (seg && seg.length) {
                                result.addPath(seg.map(p => [p.x, p.y]));
                            }
                        }
                    }
                }
            }

            return result;
        } catch (e) {
            console.log(this.constructor.name + " Cannot create Symbol due to invalid geometry");
            return null;
        }
    }

    /**
     * Create circle path at point with radius (used as ACP circle)
     */
    private createACP(pt: Point, radius: number): number[][] {
        try {
            const circlePts: Point[] = (Shapes as any).createCircle
                ? (Shapes as any).createCircle(pt, radius, 60)
                : [];
            if (Array.isArray(circlePts) && circlePts.length > 0) {
                return circlePts.map(p => [p.x, p.y]);
            }
            return [];
        } catch (e) {
            return [];
        }
    }


    /**
     * Get baseline points
     */
    public getBaseLinePts(): any {
        return this._baseLinePts;
    }

    /**
     * Clean up drawing state and finalize
     */
    private cleanUp(): void {
        if (this._points.length === 0) return;

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
        this._baseLinePts = {};
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
        if (this.baseLineProgressHandler) {
            this.baseLineProgressHandler.remove();
            this.baseLineProgressHandler = null;
        }
        if (this.baseLineClickHandler) {
            this.baseLineClickHandler.remove();
            this.baseLineClickHandler = null;
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
        this.baseLineComplete = false;
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

export default UARoute;