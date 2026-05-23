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
export interface AttackByFirePositionOptions {
    CTRL_PTS?: Point[];
    BASE_LN_PTS?: { startPt: Point, endPt: Point };
    GEOM?: Polygon;
    BK_LN_DIST_RATIO?: number;
    BK_LN_ANGL_RATIO?: number;
    [key: string]: any;
}

/**
 * AttackByFirePosition class for drawing Attack By Fire Position symbols on MapView or SceneView
 * Supports both immediate placement and interactive drawing modes
 */
export class AttackByFirePosition {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;
    
    // Symbol properties
    private SID: string = "152000";
    private symName: string = "Attk by Fire Posn";
    private symGeometricType: string = "Area";
    private _lineSym: SimpleLineSymbol | SimpleFillSymbol | null = null;
    private _points: Point[] = [];
    private _baseLinePts: any = null;
    private amplifier: Amplifier;
    
    // Symbol parameters
    private backLineDist: number = 5;
    private backLineAngle: number = 5;
    
    // Drawing state
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
        this.events = new SymbolEvents(view, "AttackByFirePosition");
        
        // Initialize layers if not already done
        this.layerManager.initializeLayers();
        
        // Initialize temporary graphic
        this.tempGraphic = new Graphic();
    }

    /**
     * Initialize the attack by fire position drawing
     */
    public init(options: AttackByFirePositionOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void {
        this._lineSym = marker;
        
        // Set parameters from options
        this.backLineDist = GeoTools.setDefault(options, "BK_LN_DIST_RATIO", 5);
        this.backLineAngle = GeoTools.setDefault(options, "BK_LN_ANGL_RATIO", 5);

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
                options.BASE_LN_PTS!, 
                this.backLineDist,
                this.backLineAngle
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
                    options.BASE_LN_PTS!, 
                    this.backLineDist,
                    this.backLineAngle
                );
                
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
        
        this._baseLinePts = (evt.geometry as any)._baseLine || [];
        
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

        // If no points clicked yet, use just the candidate point, otherwise add it to existing points
        const currentPoints = this._points.length === 0 ? [candidatePoint] : this._points.concat([candidatePoint]);
        const drawEssentials = this.createDrawEssentials(
            currentPoints,
            this._baseLinePts,
            this.backLineDist,
            this.backLineAngle
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
        baseLinePts: any,
        backLineDistRatio: number, 
        backLineAngleRatio: number
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
        (drawEssentials as any).BK_LN_DIST_RATIO = backLineDistRatio;
        (drawEssentials as any).BK_LN_ANGL_RATIO = backLineAngleRatio;

        return drawEssentials;
    }

    /**
     * Create symbol geometry from DrawEssentials
     */
    private createSymbol(drawEssentials: DrawEssentials): Polyline | null {
        try {
            let pts: Point[];
            let backLineDist: number;
            let backLineAngle: number;

            if ((drawEssentials as any).CTRL_PTS) {
                pts = (drawEssentials as any).CTRL_PTS;
            } else {
                throw new Error("controlPoints not found");
            }

            backLineDist = GeoTools.setDefault(drawEssentials as any, "BK_LN_DIST_RATIO", 5);
            backLineAngle = GeoTools.setDefault(drawEssentials as any, "BK_LN_ANGL_RATIO", 5);

            const baseLinePts = (drawEssentials as any).BASE_LN_PTS;
            if (!baseLinePts || !baseLinePts.startPt || !baseLinePts.endPt) {
                throw new Error("baseline points not found");
            }

            const stPt = baseLinePts.startPt;
            const endPt = baseLinePts.endPt;
            const firstPoint = pts[0];
            let lastPoint = pts[pts.length - 1];
            const leftArray: Point[] = [];
            let paths: Point[];

            if (stPt === undefined || endPt === undefined) {
                throw new Error("First Parameter of the Function is an Array with Start and End Point");
            }

            const midPt = GeoTools.getMidPoint(stPt, endPt);
            const result = new Polyline({ spatialReference: this.view.spatialReference });

            // Base Line
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

            paths = [];
            paths = paths.concat([new Point({ x: p1.x, y: p1.y, spatialReference: this.view.spatialReference }), 
                                 new Point({ x: p2.x, y: p2.y, spatialReference: this.view.spatialReference })]);
            result.addPath(paths.map(pt => [pt.x, pt.y]));

            // Front
            if (pts.length >= 1) {
                leftArray.push(midPt);
            }

            for (let i = 0; i < pts.length; i++) {
                leftArray.push(pts[i]);
            }

            result.addPath(leftArray.map(pt => [pt.x, pt.y]));

            // Arrow - only draw if we have enough points
            if (pts.length >= 1 && leftArray.length >= 2) {
                const arrowLength = GeoTools.ArrowFlanksLen(
                    GeoTools._2PtLen(midPt, pts[pts.length - 1]), 
                    GeoTools._2PtLen(new Point({ x: p1.x, y: p1.y }), new Point({ x: p2.x, y: p2.y }))
                );
                const arrowAngle = GeoTools.angleInRadians(leftArray[leftArray.length - 2], pts[pts.length - 1]);
                const arrowHead = Shapes.arrowHead(pts[pts.length - 1], arrowLength, arrowAngle);
                result.addPath(arrowHead.map(pt => [pt.x, pt.y]));
            }

            // Back
            let length = GeoTools._2PtLen(midPt, lastPoint);
            let angle = GeoTools.angleInRadians(midPt, lastPoint);
            length = length / backLineDist;

            const stPtBackPt = new Point({
                x: p1.x - length * Math.cos(angle),
                y: p1.y - length * Math.sin(angle),
                spatialReference: this.view.spatialReference
            });
            const endPtBackPt = new Point({
                x: p2.x - length * Math.cos(angle),
                y: p2.y - length * Math.sin(angle),
                spatialReference: this.view.spatialReference
            });

            const backLen = length / backLineAngle;
            const backAngle = GeoTools.angleInRadians(stPtBackPt, endPtBackPt);

            const backPt1 = new Point({
                x: -1 * backLen * Math.cos(backAngle) + stPtBackPt.x,
                y: -1 * backLen * Math.sin(backAngle) + stPtBackPt.y,
                spatialReference: this.view.spatialReference
            });
            const backPt2 = new Point({
                x: backLen * Math.cos(backAngle) + endPtBackPt.x,
                y: backLen * Math.sin(backAngle) + endPtBackPt.y,
                spatialReference: this.view.spatialReference
            });

            paths = [];
            paths = paths.concat([new Point({ x: p1.x, y: p1.y, spatialReference: this.view.spatialReference }), backPt1]);
            result.addPath(paths.map(pt => [pt.x, pt.y]));

            paths = [];
            paths = paths.concat([new Point({ x: p2.x, y: p2.y, spatialReference: this.view.spatialReference }), backPt2]);
            result.addPath(paths.map(pt => [pt.x, pt.y]));

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
            this._baseLinePts,
            this.backLineDist,
            this.backLineAngle
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
        // Deactivation complete
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

export default AttackByFirePosition; 