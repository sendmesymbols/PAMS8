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
import BaseLine from "../Support/BaseLine.ts";
import GeoTools from "../Support/GeoTools.ts";

export interface SupportByFirePositionOptions {
    CTRL_PTS?: Point[];
    BASE_LN_PTS?: { startPt: Point, endPt: Point };
    GEOM?: Polyline;
    BK_LN_DIST_RATIO?: number;
    BK_LN_ANGL_RATIO?: number;
    FRNT_LN_ANGL_RATIO?: number;
    [key: string]: any;
}

/**
 * SupportByFirePosition class for drawing Support By Fire Position (BOF) tactical symbols
 * Uses baseline + control points with front lines, arrows, and back lines
 */
export class SupportByFirePosition {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;

    // Symbol properties
    public declaredClass: string = "MilitarySymbology.Symbols.SupportByFirePosition";
    public SID: string = "152100";
    public symName: string = "BOF";
    public symGeometricType: string = "Area";

    private _lineSym: SimpleLineSymbol | SimpleFillSymbol | null = null;
    private _points: Point[] = [];
    private _baseLinePts: any = {};
    private _geometryType: string | null = null;
    private amplifier: Amplifier;

    // Symbol parameters
    private backLineDist: number = 5;
    private backLineAngle: number = 5;
    private frontLineAngle: number = 5;

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
    private eventListeners: Map<string, Function[]> = new Map();

    constructor(view: MapView | SceneView, isLine: boolean = false) {
        this.view = view;
        this.isLine = isLine;
        this.layerManager = GraphicsLayerManager.getInstance(view);
        this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.TACT);
        this.amplifier = new Amplifier();

        // Initialize layers if not already done
        this.layerManager.initializeLayers();

        // Initialize temporary graphic
        this.tempGraphic = new Graphic();
    }

    /**
     * Initialize the support by fire position drawing
     */
    public init(options: SupportByFirePositionOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void {
        this._lineSym = marker.clone();

        // Set parameters from options
        this.backLineDist = GeoTools.setDefault(options, "BK_LN_DIST_RATIO", 5);
        this.backLineAngle = GeoTools.setDefault(options, "BK_LN_ANGL_RATIO", 5);
        this.frontLineAngle = GeoTools.setDefault(options, "FRNT_LN_ANGL_RATIO", 5);

        const drawEssentials = new DrawEssentials();

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("BASE_LN_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
            // Immediate placement with geometry
            if (options.GEOM && this.tempGraphic) {
                this.tempGraphic.geometry = (options.GEOM instanceof Polyline)
                    ? options.GEOM
                    : new Polyline({ paths: (options.GEOM as any), spatialReference: this.view.spatialReference });
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
        const baseLine = new BaseLine(this.view, this._lineSym as SimpleLineSymbol);

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
        this.emit("onDrawClick", {
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

        this.emit("onDrawProgress", {
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

        this.emit("onBaseLineDrawEnd", {
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

        this.emit("onDrawClick", { currentPts: this._points });

        // For single line mode, finish after first click
        if (this.isLine === true && this._points.length === 1) {
            this.emit("onDrawClick", { currentPts: this._points });
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
        (drawEssentials as any).BK_LN_DIST_RATIO = this.backLineDist;
        (drawEssentials as any).BK_LN_ANGL_RATIO = this.backLineAngle;
        (drawEssentials as any).FRNT_LN_ANGL_RATIO = this.frontLineAngle;

        const geometry = this.createSymbol(drawEssentials);
        if (geometry) {
            this.tempGraphic.geometry = geometry;
            this.emit("onDrawProgress", {
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
        (drawEssentials as any).BK_LN_DIST_RATIO = this.backLineDist;
        (drawEssentials as any).BK_LN_ANGL_RATIO = this.backLineAngle;
        (drawEssentials as any).FRNT_LN_ANGL_RATIO = this.frontLineAngle;

        return drawEssentials;
    }

    /**
     * Create symbol geometry from DrawEssentials
     */
    private createSymbol(drawEssentials: DrawEssentials): Polyline | null {
        try {
            const spatialReference = this.view.spatialReference;
            const pts: Point[] = (drawEssentials as any).CTRL_PTS;
            if (!pts || pts.length === 0) throw new Error("controlPoints not found");

            const stPt: Point = (drawEssentials as any).BASE_LN_PTS?.startPt;
            const endPt: Point = (drawEssentials as any).BASE_LN_PTS?.endPt;
            if (!stPt || !endPt) throw new Error("First Parameter of the Function is an Array with Start and End Point");

            const backLineDist = GeoTools.setDefault(drawEssentials as any, "BK_LN_DIST_RATIO", 5);
            const backLineAngle = GeoTools.setDefault(drawEssentials as any, "BK_LN_ANGL_RATIO", 5);
            const frontLineAngle = GeoTools.setDefault(drawEssentials as any, "FRNT_LN_ANGL_RATIO", 5);

            const result = new Polyline({ spatialReference });

            const firstPoint = pts[0];
            const lastPoint = pts[pts.length - 1];
            const leftArray: any[] = [];
            const rightArray: any[] = [];

            const midPt = GeoTools.getMidPoint(stPt, endPt);

            // Base line - determine perpendicular points
            let len = GeoTools._2PtLen(midPt, endPt);
            let k = Math.atan((midPt.y - lastPoint.y) / (midPt.x - lastPoint.x));

            switch (GeoTools.twoPtsRelationShip(midPt, lastPoint)) {
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
            const p1 = { x: partialLen * Math.cos(k) + midPt.x, y: partialLen * Math.sin(k) + midPt.y };
            const p2 = { x: -1 * partialLen * Math.cos(k) + midPt.x, y: -1 * partialLen * Math.sin(k) + midPt.y };

            // Add base line path between p1 and p2
            result.addPath([[p1.x, p1.y], [p2.x, p2.y]]);

            // Front lines - extend perpendicular lines from control points
            if (pts.length >= 1) {
                leftArray.push(p1);
                rightArray.push(p2);
            }

            for (let i = 0; i < pts.length; i++) {
                const length = GeoTools._2PtLen(midPt, pts[i]);
                const angle = GeoTools.angleInRadians(midPt, pts[i]);

                const stPtCandidatePt = new Point(
                    p1.x + length * Math.cos(angle),
                    p1.y + length * Math.sin(angle),
                    spatialReference
                );
                const endPtCandidatePt = new Point(
                    p2.x + length * Math.cos(angle),
                    p2.y + length * Math.sin(angle),
                    spatialReference
                );

                len = length / frontLineAngle;
                angle = GeoTools.angleInRadians(stPtCandidatePt, endPtCandidatePt);

                const pt1 = new Point(
                    -1 * len * Math.cos(angle) + stPtCandidatePt.x,
                    -1 * len * Math.sin(angle) + stPtCandidatePt.y,
                    spatialReference
                );
                const pt2 = new Point(
                    len * Math.cos(angle) + endPtCandidatePt.x,
                    len * Math.sin(angle) + endPtCandidatePt.y,
                    spatialReference
                );

                leftArray.push(pt1);
                rightArray.push(pt2);
            }

            result.addPath(leftArray);
            result.addPath(rightArray);

            // Arrow heads at the ends of front lines
            if (leftArray.length > 0 && rightArray.length > 0) {
                const lastLeftPt = leftArray[leftArray.length - 1];
                const lastRightPt = rightArray[rightArray.length - 1];
                const midLength = GeoTools._2PtLen(midPt, pts[pts.length - 1]);
                const frontLength = GeoTools._2PtLen(
                    new Point(p1.x, p1.y, spatialReference),
                    new Point(p2.x, p2.y, spatialReference)
                );
                const arrowLen = GeoTools.ArrowFlanksLen(midLength, frontLength);

                if (leftArray.length >= 2) {
                    const angleLeft = GeoTools.angleInRadians(leftArray[leftArray.length - 2], lastLeftPt);
                    result.addPath(this._arrowHead(lastLeftPt, arrowLen, angleLeft));
                }

                if (rightArray.length >= 2) {
                    const angleRight = GeoTools.angleInRadians(rightArray[rightArray.length - 2], lastRightPt);
                    result.addPath(this._arrowHead(lastRightPt, arrowLen, angleRight));
                }
            }

            // Back lines - extend from base line endpoints in the opposite direction
            const backLength = GeoTools._2PtLen(midPt, lastPoint);
            const backAngle = GeoTools.angleInRadians(midPt, lastPoint);
            const backDist = backLength / backLineDist;

            const stPtBackPt = new Point(
                p1.x - backDist * Math.cos(backAngle),
                p1.y - backDist * Math.sin(backAngle),
                spatialReference
            );
            const endPtBackPt = new Point(
                p2.x - backDist * Math.cos(backAngle),
                p2.y - backDist * Math.sin(backAngle),
                spatialReference
            );

            len = backDist / backLineAngle;
            const backAngle2 = GeoTools.angleInRadians(stPtBackPt, endPtBackPt);

            const backPt1 = new Point(
                -1 * len * Math.cos(backAngle2) + stPtBackPt.x,
                -1 * len * Math.sin(backAngle2) + stPtBackPt.y,
                spatialReference
            );
            const backPt2 = new Point(
                len * Math.cos(backAngle2) + endPtBackPt.x,
                len * Math.sin(backAngle2) + endPtBackPt.y,
                spatialReference
            );

            result.addPath([[p1.x, p1.y], [backPt1.x, backPt1.y]]);
            result.addPath([[p2.x, p2.y], [backPt2.x, backPt2.y]]);

            return result;
        } catch (e) {
            console.log(this.constructor.name + " Cannot create Symbol due to invalid geometry");
            return null;
        }
    }

    /**
     * Create arrow head path
     */
    private _arrowHead(candidatePoint: any, length: number, angle: number): number[][] {
        const angle1 = angle + (15 * Math.PI / 180); // Add 15 degrees
        const angle2 = angle - (15 * Math.PI / 180);  // Subtract 15 degrees

        const rightWing = {
            x: candidatePoint.x + length * Math.cos(angle1),
            y: candidatePoint.y + length * Math.sin(angle1)
        };
        const leftWing = {
            x: candidatePoint.x + length * Math.cos(angle2),
            y: candidatePoint.y + length * Math.sin(angle2)
        };

        return [[rightWing.x, rightWing.y], [candidatePoint.x, candidatePoint.y], [leftWing.x, leftWing.y]];
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
        this.emit("onDrawEnd", {
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

        this.tempGraphic = new Graphic();
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

    /**
     * Event emitter functionality
     */
    private emit(eventName: string, data: any): void {
        const listeners = this.eventListeners.get(eventName);
        if (listeners) {
            listeners.forEach(listener => listener(data));
        }

        this.emitGlobalEvent(eventName, data);
    }

    private emitGlobalEvent(eventName: string, data: any): void {
        const customEvent = new CustomEvent(eventName, {
            detail: {
                symbolType: this.constructor.name,
                eventName: eventName,
                ...data
            },
            bubbles: true,
            cancelable: true
        });

        if (this.view && this.view.container) {
            this.view.container.dispatchEvent(customEvent);
        } else {
            document.dispatchEvent(customEvent);
        }
    }

    public on(eventName: string, callback: Function): void {
        if (!this.eventListeners.has(eventName)) {
            this.eventListeners.set(eventName, []);
        }
        this.eventListeners.get(eventName)!.push(callback);
    }

    public off(eventName: string, callback?: Function): void {
        if (!callback) {
            this.eventListeners.delete(eventName);
        } else {
            const listeners = this.eventListeners.get(eventName);
            if (listeners) {
                const index = listeners.indexOf(callback);
                if (index > -1) {
                    listeners.splice(index, 1);
                }
            }
        }
    }

    public getSymbolLayer(): GraphicsLayer {
        return this.symbolLayer;
    }

    public clearSymbols(): void {
        this.symbolLayer.removeAll();
    }
}

export default SupportByFirePosition;