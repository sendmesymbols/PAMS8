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

export interface BypassOptions {
    CTRL_PTS?: Point[];
    BASE_LN_PTS?: {startPt: Point, endPt: Point};
    GEOM?: Polyline;
    [key: string]: any;
}

/**
 * Bypass class for drawing Bypass tactical symbols
 * Uses baseline + control points pattern
 * Returns Polyline geometry
 */
export class Bypass {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;

    // Symbol properties
    public declaredClass: string = "MilitarySymbology.Symbols.Bypass";
    public SID: string = "340300";
    public symName: string = "Bypass";
    public symGeometricType: string = "Area";

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
     * Initialize the Bypass drawing
     */
    public init(options: BypassOptions, marker: SimpleLineSymbol): void {
        this._lineSym = marker.clone();
        // this.map.navigationManager.setImmediateClick(false);
        // this.map.disableDoubleClickZoom();

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("BASE_LN_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
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

            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.BASE_LN_PTS!);
            if (this.tempGraphic && this.tempGraphic.geometry) {
                this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEss);
            }
            this._clear();

        } else if (options.hasOwnProperty("CTRL_PTS")) {
            if (options.hasOwnProperty("BASE_LN_PTS")) {
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

        baseLine.init("B");
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
        this.mouseMoveHandler = this.view.on("pointer-move", (event) => {
            this._onMouseMoveHandler(event);
        });

        this.clickHandler = this.view.on("click", (event) => {
            this._onClickHandler(event);
        });

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
            const pts: Point[] = (drawEssentials as any).CTRL_PTS;
            if (!pts || pts.length === 0) throw new Error("controlPoints not found");

            const stPt: Point = (drawEssentials as any).BASE_LN_PTS?.startPt;
            const endPt: Point = (drawEssentials as any).BASE_LN_PTS?.endPt;
            if (!stPt || !endPt) throw new Error("First Parameter of the Function is an Array with Start and End Point");

            const spatialReference = this.view.spatialReference;
            const midPt = GeoTools.getMidPoint(stPt, endPt);
            const result = new Polyline({ spatialReference });

            const firstPoint = pts[0];
            let lastPoint = firstPoint;
            if (pts.length >= 1) {
                lastPoint = firstPoint;
            }

            const len = GeoTools._2PtLen(midPt, endPt);
            let k = Math.atan((midPt.y - lastPoint.y) / (midPt.x - lastPoint.x));

            switch (GeoTools.twoPtsRelationShip(midPt, lastPoint)) {
                case "ne": k += Math.PI / 2; break;
                case "nw": k += Math.PI * 3 / 2; break;
                case "sw": k += Math.PI * 3 / 2; break;
                case "se": k += Math.PI / 2; break;
            }

            const partialLen = len;
            const p1 = new Point({ x: partialLen * Math.cos(k) + midPt.x, y: partialLen * Math.sin(k) + midPt.y, spatialReference });
            const p2 = new Point({ x: -1 * partialLen * Math.cos(k) + midPt.x, y: -1 * partialLen * Math.sin(k) + midPt.y, spatialReference });

            // Fracture baseline with "B" marker
            const values = GeoTools._fracturePts(p1, p2, 10, spatialReference);
            result.paths = result.paths.concat(values.geometry.paths);

            const baseLineLen = GeoTools._2PtLen(p1, p2);
            let cLenLimit = values.len / 2;
            if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
            result.addPath(Shapes.createB(values.midPoint, cLenLimit, 40).map(pt => [pt.x, pt.y]));

            // Build left and right arrays
            const leftArray: Point[] = [];
            const rightArray: Point[] = [];

            if (pts.length >= 1) {
                leftArray.push(p1);
                rightArray.push(p2);
            }

            let stPtCandidatePt: Point | null = null;
            let endPtCandidatePt: Point | null = null;

            for (let i = 0; i < pts.length; i++) {
                const length = GeoTools._2PtLen(midPt, pts[i]);
                const angle = GeoTools.angleInRadians(midPt, pts[i]);

                stPtCandidatePt = new Point({ x: p1.x + length * Math.cos(angle), y: p1.y + length * Math.sin(angle), spatialReference });
                endPtCandidatePt = new Point({ x: p2.x + length * Math.cos(angle), y: p2.y + length * Math.sin(angle), spatialReference });

                leftArray.push(stPtCandidatePt);
                rightArray.push(endPtCandidatePt);
            }

            result.addPath(leftArray.map(pt => [pt.x, pt.y]));
            result.addPath(rightArray.map(pt => [pt.x, pt.y]));

            // Arrow heads at tips
            if (stPtCandidatePt && endPtCandidatePt && leftArray.length >= 2 && rightArray.length >= 2) {
                const arrowLen = GeoTools.ArrowFlanksLen(
                    GeoTools._2PtLen(midPt, pts[pts.length - 1]),
                    GeoTools._2PtLen(stPtCandidatePt, endPtCandidatePt)
                );

                result.addPath(Shapes.arrowHead(
                    leftArray[leftArray.length - 1],
                    arrowLen,
                    GeoTools.angleInRadians(leftArray[leftArray.length - 2], leftArray[leftArray.length - 1])
                ).map(pt => [pt.x, pt.y]));

                result.addPath(Shapes.arrowHead(
                    rightArray[rightArray.length - 1],
                    arrowLen,
                    GeoTools.angleInRadians(rightArray[rightArray.length - 2], rightArray[rightArray.length - 1])
                ).map(pt => [pt.x, pt.y]));
            }

            return result;
        } catch (e) {
            console.log(this.constructor.name + " Cannot create Symbol due to invalid geometry");
            return null;
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

export default Bypass;
