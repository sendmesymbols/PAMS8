import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
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
export interface FriendlyAirborneAviationOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    HEAD_RATIO?: number;
    TAIL_FACTOR?: number;
    [key: string]: any;
}

interface XY {
    x: number;
    y: number;
}

/**
 * FriendlyAirborneAviation symbol — a Main Attack arrow whose two body edges
 * swap sides and cross through the middle, forming the airborne "X" arrow.
 * Emitted as a single Polygon geometry. Supports immediate placement and
 * interactive drawing modes.
 */
export class FriendlyAirborneAviation {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;

    // Symbol properties
    private SID: string = "151401";          // Symbol Set: 25  →  code 25151401
    private symName: string = "Friendly Airborne Aviation";
    private symGeometricType: string = "Area";
    private _lineSym: SimpleLineSymbol | SimpleFillSymbol | null = null;
    private _points: Point[] = [];
    private amplifier: Amplifier;

    // Symbol parameters
    private _tailFactor: number = 0.05;
    private _headPercentage: number = 0.07;
    private _headLengthScale: number = 1.15;
    private _arrowHeadRatio: number = 1.35;
    private _shoulderFraction: number = 0.48;
    private _crossFraction: number = 0.74;

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
        this.events = new SymbolEvents(view, "FriendlyAirborneAviation");

        // Initialize layers if not already done
        this.layerManager.initializeLayers();

        // Initialize temporary graphic
        this.tempGraphic = new Graphic();
    }

    /**
     * Initialize the drawing
     */
    public init(options: FriendlyAirborneAviationOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void {
        this._lineSym = marker;

        // Set parameters from options
        this._headPercentage = GeoTools.setDefault(options, "HEAD_RATIO", this._headPercentage);
        this._tailFactor = GeoTools.setDefault(options, "TAIL_FACTOR", this._tailFactor);

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
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

            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._headPercentage, this._tailFactor);
            if (this.tempGraphic && this.tempGraphic.geometry) {
                this.__drawEnd(this.tempGraphic.geometry as Polygon, drawEss);
            }
            this._clear();

        } else if (options.hasOwnProperty("CTRL_PTS")) {
            // Immediate placement with control points only
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._headPercentage, this._tailFactor);
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
        if (!this.isDrawing || !this.tempGraphic) return;

        const mapPoint = this.view.toMap(inputEvent);
        if (!mapPoint) return;

        const candidatePoint = new Point({
            x: mapPoint.x,
            y: mapPoint.y,
            spatialReference: this.view.spatialReference
        });

        const drawEssentials = this.createDrawEssentials(
            this._points.concat([candidatePoint]),
            this._headPercentage,
            this._tailFactor
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
    private createDrawEssentials(ctrlPts: Point[], headRatio: number, tailFactor: number): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.AMPLIFIER = this.amplifier.toString();

        // Store additional properties
        (drawEssentials as any).SCOPE = this;
        (drawEssentials as any).CTRL_PTS = ctrlPts;
        (drawEssentials as any).HEAD_RATIO = headRatio;
        (drawEssentials as any).TAIL_FACTOR = tailFactor;

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

            const result = new Polygon({
                spatialReference: this.view.spatialReference
            });

            if (pts.length <= 2) {
                return this.createSimpleArrow(pts, result);
            } else {
                return this.createComplexArrow(pts, result);
            }

        } catch (e) {
            console.log(this.constructor.name + ' Cannot create Symbol due to invalid geometry');
            return null;
        }
    }

    /**
     * Create simple arrow for 2 points or less
     */
    private createSimpleArrow(pts: Point[], result: Polygon): Polygon {
        if (pts.length < 2) return result;

        return this.createShoulderedArrow([
            { x: pts[0].x, y: pts[0].y },
            { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y }
        ], result);
    }

    /**
     * Create complex arrow for multiple points
     */
    private createComplexArrow(pts: Point[], result: Polygon): Polygon {
        const controlPoints = pts.map(pt => ({ x: pt.x, y: pt.y }));
        const centerline = Shapes.CreateBezierPathPCOnly(controlPoints, 70);
        return this.createShoulderedArrow(centerline, result);
    }

    /**
     * Build the target profile: parallel tail rails, a distinct shoulder,
     * a late crossing, and a reopened neck leading into the arrowhead.
     */
    private createShoulderedArrow(centerline: XY[], result: Polygon): Polygon {
        const totalLen = GeoTools._ptCollectionLen(centerline, 0);
        if (centerline.length < 2 || totalLen <= 0) return result;

        const headFraction = Math.min(0.35, Math.max(0.06, this._headPercentage * this._headLengthScale));
        const bodyLen = totalLen * (1 - headFraction);
        const bodyHalfWidth = totalLen * this._tailFactor;
        const bodySamples = 100;
        const bodyCenter: XY[] = [];
        const leftRail: XY[] = [];
        const rightRail: XY[] = [];

        for (let i = 0; i <= bodySamples; i++) {
            bodyCenter.push(this.pointAtDistance(centerline, bodyLen * i / bodySamples));
        }

        for (let i = 0; i <= bodySamples; i++) {
            const progress = i / bodySamples;
            const tangent = this.tangentAt(bodyCenter, i);
            const normal = { x: -tangent.y, y: tangent.x };
            const widthFactor = this.railWidthFactor(progress);

            leftRail.push({
                x: bodyCenter[i].x + normal.x * bodyHalfWidth * widthFactor,
                y: bodyCenter[i].y + normal.y * bodyHalfWidth * widthFactor
            });
            rightRail.push({
                x: bodyCenter[i].x - normal.x * bodyHalfWidth * widthFactor,
                y: bodyCenter[i].y - normal.y * bodyHalfWidth * widthFactor
            });
        }

        this.addStrokePath(result, leftRail);
        this.addStrokePath(result, rightRail);

        const bodyEnd = bodyCenter[bodySamples];
        const headTangent = this.tangentAt(bodyCenter, bodySamples);
        const headNormal = { x: -headTangent.y, y: headTangent.x };
        const headOuterHalf = totalLen * headFraction * this._arrowHeadRatio;
        const tip = centerline[centerline.length - 1];
        const rightInner = leftRail[bodySamples];
        const leftInner = rightRail[bodySamples];
        const rightOuter = {
            x: bodyEnd.x - headNormal.x * headOuterHalf,
            y: bodyEnd.y - headNormal.y * headOuterHalf
        };
        const leftOuter = {
            x: bodyEnd.x + headNormal.x * headOuterHalf,
            y: bodyEnd.y + headNormal.y * headOuterHalf
        };

        this.addStroke(result, rightInner, rightOuter);
        this.addStroke(result, rightOuter, tip);
        this.addStroke(result, tip, leftOuter);
        this.addStroke(result, leftOuter, leftInner);

        return result;
    }

    private railWidthFactor(progress: number): number {
        if (progress <= this._shoulderFraction) return 1;

        if (progress <= this._crossFraction) {
            return 1 - (progress - this._shoulderFraction) /
                (this._crossFraction - this._shoulderFraction);
        }

        return -(progress - this._crossFraction) / (1 - this._crossFraction);
    }

    private addStrokePath(result: Polygon, path: XY[]): void {
        for (let i = 1; i < path.length; i++) {
            this.addStroke(result, path[i - 1], path[i]);
        }
    }

    private addStroke(result: Polygon, start: XY, end: XY): void {
        result.addRing([
            [start.x, start.y],
            [end.x, end.y]
        ]);
    }

    private pointAtDistance(path: XY[], distance: number): XY {
        let travelled = 0;

        for (let i = 1; i < path.length; i++) {
            const segmentLen = GeoTools._2PtLen(path[i - 1], path[i]);
            if (travelled + segmentLen >= distance) {
                const ratio = segmentLen === 0 ? 0 : (distance - travelled) / segmentLen;
                return {
                    x: path[i - 1].x + (path[i].x - path[i - 1].x) * ratio,
                    y: path[i - 1].y + (path[i].y - path[i - 1].y) * ratio
                };
            }
            travelled += segmentLen;
        }

        return { ...path[path.length - 1] };
    }

    private tangentAt(path: XY[], index: number): XY {
        const before = path[Math.max(0, index - 1)];
        const after = path[Math.min(path.length - 1, index + 1)];
        const dx = after.x - before.x;
        const dy = after.y - before.y;
        const len = Math.hypot(dx, dy) || 1;
        return { x: dx / len, y: dy / len };
    }

    /**
     * Clean up drawing state and finalize
     */
    private cleanUp(): void {
        if (this._points.length === 0) return;

        const drawEssentials = this.createDrawEssentials(
            this._points.slice(),
            this._headPercentage,
            this._tailFactor
        );

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

export default FriendlyAirborneAviation;
