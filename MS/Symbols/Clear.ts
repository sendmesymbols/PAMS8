import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Polygon from "@arcgis/core/geometry/Polygon";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier.ts";
import BaseLine from "../Support/BaseLine.ts";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";

import SymbolEvents from "../Support/SymbolEvents";
export interface ClearOptions {
    CTRL_PTS?: Point[];
    BASE_LN_PTS?: { startPt: Point, endPt: Point } | any;
    GEOM?: Polyline | Polygon | number[][][];
    [key: string]: any;
}

/**
 * Clear class for drawing Clear symbols on MapView or SceneView
 * Supports both immediate placement and interactive drawing modes
 */
export class Clear {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;
    
    // Symbol properties
    private SID: string = "340500";
    private symName: string = "Clear";
    private symGeometricType: string = "Area";
    private _lineSym: SimpleLineSymbol | SimpleFillSymbol | null = null;
    private _points: Point[] = [];
    private _baseLinePts: any = null;
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
        this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.FORCE);
        this.amplifier = new Amplifier();
        this.events = new SymbolEvents(view, "Clear");
        
        // Initialize layers if not already done
        this.layerManager.initializeLayers();
        
        // Initialize temporary graphic
        this.tempGraphic = new Graphic();
    }

    /**
     * Initialize the clear symbol drawing
     */
    public init(options: ClearOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void {
        this._lineSym = marker;
        const baseLine = new BaseLine(this.view, this._lineSym as SimpleLineSymbol);
        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("BASE_LN_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
            // Immediate placement with both control points and geometry
            if (options.GEOM && this.tempGraphic) {
                try {
                    if (options.GEOM instanceof Polygon) {
                        this.tempGraphic.geometry = options.GEOM;
                    } else {
                        this.tempGraphic.geometry = new Polygon({
                            rings: options.GEOM as number[][][],
                            spatialReference: this.view.spatialReference
                        });
                    }
                } catch (error) {
                    console.error(this.symName, "Failed to create Polygon geometry:", error);
                }
            }
            
            const drawEss = this.createDrawEssentials(
                options.CTRL_PTS!.slice(), 
                options.BASE_LN_PTS!
            );
            
            const geometry = this.createSymbol(drawEss);
            if (geometry && this.tempGraphic) {
                this.tempGraphic.geometry = geometry;
                this.__drawEnd(geometry, drawEss);
            }
            this._clear();

        } else if (options.hasOwnProperty("CTRL_PTS")) {
            // Immediate placement with control points
            if (options.hasOwnProperty("BASE_LN_PTS")) {
                const drawEss = this.createDrawEssentials(
                    options.CTRL_PTS!.slice(), 
                    options.BASE_LN_PTS!
                );
                
                const geometry = this.createSymbol(drawEss);
                if (geometry && this.tempGraphic) {
                    this.tempGraphic.geometry = geometry;
                    this.__drawEnd(geometry, drawEss);
                    this._clear();
                }
            } else {
                throw new Error("Control Points and Baseline are required to create symbol non-interactively");
            }

        } else {
            // Interactive drawing mode
            this.startBaseLineDrawing(baseLine);
        }
    }

    /**
     * Start interactive baseline drawing
     */
    private startBaseLineDrawing(baseLine: BaseLine): void {
        // Set up baseline event handlers
        baseLine.on("drawEnd", (evt: any) => {
            console.log("Clear baseLineDrawEnd received");
            this.baseLineDrawEnd(evt);
        });
        
        baseLine.on("onBaseLineClick", (evt: any) => {
            this.baseLineClick(evt);
        });
        
        baseLine.on("onBaseLineProgress", (evt: any) => {
            this.baseLineDrawProgress(evt);
        });
        
        baseLine.init();
    }

    /**
     * Handle baseline draw end
     */
    private baseLineDrawEnd(evt: any): void {
        
        this.tempGraphic = new Graphic({
            geometry: evt.geometry,
            symbol: this._lineSym
        });
        this.symbolLayer.add(this.tempGraphic);
        
        this._baseLinePts = (evt.geometry as any)._baseLine || null;
        
        // Set up main drawing event handlers
        this.setupEventHandlers();
        
        this.events.emit("onBaseLineDrawEnd", { currentPts: (evt.geometry as any).controlPoints || [] });
    }

    /**
     * Handle baseline draw progress
     */
    private baseLineDrawProgress(evt: any): void {
        const localDrawEssentials: any = {};
        localDrawEssentials.CTRL_PTS = evt.currentGeometry;
        
        const pl = new Polyline({
            paths: [evt.currentGeometry],
            spatialReference: this.view.spatialReference
        });
        
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
        this.events.emit("onDrawClick", {
            currentPts: evt.currentGeometry,
            isBaseLine: true
        });
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
        if (!this.tempGraphic || !this._baseLinePts) return;

        const mapPoint = this.view.toMap(inputEvent);
        if (!mapPoint) return;

        const candidatePoint = new Point({
            x: mapPoint.x,
            y: mapPoint.y,
            spatialReference: this.view.spatialReference
        });

        const currentPoints = this._points.length === 0 ? [candidatePoint] : this._points.concat([candidatePoint]);
        const drawEssentials = this.createDrawEssentials(
            currentPoints,
            this._baseLinePts
        );
        
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
    private createDrawEssentials(
        ctrlPts: Point[], 
        baseLinePts: { startPt: Point, endPt: Point } | any
    ): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
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
            let pts: Point[];

            if ((drawEssentials as any).CTRL_PTS) {
                pts = (drawEssentials as any).CTRL_PTS;
            } else {
                throw new Error("controlPoints not found");
            }

            const baseLinePts = (drawEssentials as any).BASE_LN_PTS;
            if (!baseLinePts || !baseLinePts.startPt || !baseLinePts.endPt) {
                throw new Error("baseline points not found");
            }

            const stPt: Point = baseLinePts.startPt;
            const endPt: Point = baseLinePts.endPt;
            const firstPoint = pts[0];
            let lastPoint = pts[pts.length - 1];

            if (stPt === undefined || endPt === undefined) {
                throw new Error("First Parameter of the Function is an Array with Start and End Point");
            }

            const midPt: Point = GeoTools.getMidPoint(stPt, endPt);
            const result = new Polyline({ spatialReference: this.view.spatialReference });

            // Base Line build
            if (pts.length >= 1) {
                lastPoint = firstPoint;
            }

            const len = GeoTools._2PtLen(midPt, endPt);
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

            // Front arrays
            const leftArray: Point[] = [];
            const rightArray: Point[] = [];
            const middleArray: Point[] = [];

            if (pts.length >= 1) {
                leftArray.push(new Point({ x: p1.x, y: p1.y, spatialReference: this.view.spatialReference }));
                rightArray.push(new Point({ x: p2.x, y: p2.y, spatialReference: this.view.spatialReference }));
                middleArray.push(midPt);
            }

            let stPtCandidatePt: Point = new Point({ x: p1.x, y: p1.y, spatialReference: this.view.spatialReference });
            let endPtCandidatePt: Point = new Point({ x: p2.x, y: p2.y, spatialReference: this.view.spatialReference });
            for (let i = 0; i < pts.length; i++) {
                const lengthToCandidate = GeoTools._2PtLen(midPt, pts[i]);
                let angle = GeoTools.angleInRadians(midPt, pts[i]);

                stPtCandidatePt = new Point({
                    x: p1.x + lengthToCandidate * Math.cos(angle),
                    y: p1.y + lengthToCandidate * Math.sin(angle),
                    spatialReference: this.view.spatialReference
                });
                endPtCandidatePt = new Point({
                    x: p2.x + lengthToCandidate * Math.cos(angle),
                    y: p2.y + lengthToCandidate * Math.sin(angle),
                    spatialReference: this.view.spatialReference
                });

                leftArray.push(stPtCandidatePt);
                rightArray.push(endPtCandidatePt);
                middleArray.push(pts[i]);
            }

            // Add left and right paths
            if (leftArray.length > 1) result.addPath(leftArray.map(pt => [pt.x, pt.y]));
            if (rightArray.length > 1) result.addPath(rightArray.map(pt => [pt.x, pt.y]));

            // Fracture the middle line and add CC arcs
            if (middleArray.length > 1) {
                const values = GeoTools._fracture(middleArray, 10, this.view.spatialReference);
                (values.geometry.paths as number[][][]).forEach(path => result.addPath(path));

                const baseLineLen = GeoTools._2PtLen(new Point({ x: p1.x, y: p1.y }), new Point({ x: p2.x, y: p2.y }));
                for (let i = 0; i < values.midPoints.length; i++) {
                    let cLenLimit = values.midPoints[i].len / 2;
                    if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
                    const cPath = Shapes.createCC(values.midPoints[i].midPt.x, values.midPoints[i].midPt.y, cLenLimit, this.view.spatialReference);
                    result.addPath(cPath.map(pt => [pt.x, pt.y]));
                }
            }

            // Arrowheads at ends of left, right, and middle
            if (leftArray.length >= 2) {
                const baseLineLen = GeoTools._2PtLen(new Point({ x: p1.x, y: p1.y }), new Point({ x: p2.x, y: p2.y }));
                const arrowLen = GeoTools.ArrowFlanksLen(GeoTools._2PtLen(midPt, middleArray[middleArray.length - 1]), baseLineLen);
                let arrowAngle = GeoTools.angleInRadians(leftArray[leftArray.length - 2], leftArray[leftArray.length - 1]);
                const leftArrow = Shapes.arrowHead(leftArray[leftArray.length - 1], arrowLen, arrowAngle);
                result.addPath(leftArrow.map(pt => [pt.x, pt.y]));

                arrowAngle = GeoTools.angleInRadians(rightArray[rightArray.length - 2], rightArray[rightArray.length - 1]);
                const rightArrow = Shapes.arrowHead(rightArray[rightArray.length - 1], arrowLen, arrowAngle);
                result.addPath(rightArrow.map(pt => [pt.x, pt.y]));

                arrowAngle = GeoTools.angleInRadians(middleArray[middleArray.length - 2], middleArray[middleArray.length - 1]);
                const midArrow = Shapes.arrowHead(middleArray[middleArray.length - 1], arrowLen, arrowAngle);
                result.addPath(midArrow.map(pt => [pt.x, pt.y]));
            }

            // Front line (short bar across the front at the last candidate)
            if (middleArray.length >= 1) {
                let lengthToFront = GeoTools._2PtLen(midPt, middleArray[middleArray.length - 1]);
                let lenFront = lengthToFront / 5;
                const baseLenNow = GeoTools._2PtLen(stPtCandidatePt, endPtCandidatePt);
                const baseLineLenLimit = baseLenNow / 4;
                if (lenFront > baseLineLenLimit) lenFront = baseLineLenLimit;
                const angleNow = GeoTools.angleInRadians(stPtCandidatePt, endPtCandidatePt);

                const pt1Front = new Point({
                    x: -1 * lenFront * Math.cos(angleNow) + stPtCandidatePt.x,
                    y: -1 * lenFront * Math.sin(angleNow) + stPtCandidatePt.y,
                    spatialReference: this.view.spatialReference
                });
                const pt2Front = new Point({
                    x: lenFront * Math.cos(angleNow) + endPtCandidatePt.x,
                    y: lenFront * Math.sin(angleNow) + endPtCandidatePt.y,
                    spatialReference: this.view.spatialReference
                });
                result.addPath([[pt1Front.x, pt1Front.y], [pt2Front.x, pt2Front.y]]);
            }

            return result;

        } catch (e) {
            console.log(this.constructor.name + ' Cannot create Symbol due to invalid geometry');
            return null;
        }
    }

    /**
     * Clean up drawing state and finalize
     */
    private cleanUp(): void {
        if (this._points.length === 0 && !this._baseLinePts) return;

        const drawEssentials = this.createDrawEssentials(
            this._points.slice(),
            this._baseLinePts
        );
        
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

export default Clear; 