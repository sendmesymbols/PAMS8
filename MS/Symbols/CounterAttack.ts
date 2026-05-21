import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials.ts";
import Amplifier from "../Support/Amplifier.ts";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";

import SymbolEvents from "../Support/SymbolEvents";
export interface CounterAttackOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    HEAD_RATIO?: number;
    TAIL_FACTOR?: number;
    [key: string]: any;
}

/**
 * CounterAttack class for drawing supporting attack arrow symbols on MapView or SceneView
 * Supports both immediate placement and interactive drawing modes
 */
export class CounterAttack {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;

    // Symbol properties
    private SID: string = "340600";
    private symName: string = "Counter Attk";
    private symGeometricType: string = "Area";
    private _lineSym: SimpleLineSymbol | SimpleFillSymbol | null = null;
    private _points: Point[] = [];
    private _geometryType: string | null = null;
    private amplifier: Amplifier;

    // Symbol parameters
    private _tailFactor: number = 0.05;
    private _headPercentage: number = 0.07;

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
        this.events = new SymbolEvents(view, "CounterAttack");

        // Initialize layers if not already done
        this.layerManager.initializeLayers();

        // Initialize temporary graphic
        this.tempGraphic = new Graphic();
    }

    /**
     * Initialize the freehand close supporting attack drawing
     */
    public init(options: CounterAttackOptions, marker: SimpleLineSymbol): void {
        this._lineSym = marker;

        // Set dashed line style for counter attack
        if (this._lineSym && 'style' in this._lineSym) {
            (this._lineSym as any).style = "dash";
        }

        this._headPercentage = GeoTools.setDefault(options, "HEAD_RATIO", 0.07);
        this._tailFactor = GeoTools.setDefault(options, "TAIL_FACTOR", 0.05);

        // Set up event handlers
        this.setupEventHandlers();

        // Initialize drawing essentials if needed

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

        const drawEssentials = new DrawEssentials();
        (drawEssentials as any).CTRL_PTS = this._points.concat([candidatePoint]);

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
    private createDrawEssentials(ctrlPts: Point[], arrowHeadRatio: number, tailFactor: number): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.GEOM = null;
        drawEssentials.AMPLIFIER = this.amplifier.toString();

        // Store additional properties
        (drawEssentials as any).SCOPE = this;
        (drawEssentials as any).CTRL_PTS = ctrlPts;
        (drawEssentials as any).HEAD_RATIO = arrowHeadRatio;
        (drawEssentials as any).TAIL_FACTOR = tailFactor;
        (drawEssentials as any).ISFHAND = 1;

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

            const arrowHeadRatio = GeoTools.setDefault(drawEssentials, "HEAD_RATIO", 5);

            if (pts.length <= 2) {
                return this.createSimpleArrow(pts, arrowHeadRatio);
            } else {
                return this.createComplexArrow(pts, drawEssentials);
            }

        } catch (e) {
            console.log(this.constructor.name + ' Cannot create Symbol due to invalid geometry');
            return null;
        }
    }

    /**
     * Create simple arrow for 2 points or less
     */
    private createSimpleArrow(pts: Point[], arrowHeadRatio: number): Polygon {
        const firstPoint = pts[0];
        const lastPoint = pts[pts.length - 1];

        const len = GeoTools._2PtLen(firstPoint, lastPoint);
        let k = Math.atan((firstPoint.y - lastPoint.y) / (firstPoint.x - lastPoint.x));

        switch (GeoTools.twoPtsRelationShip(firstPoint, lastPoint)) {
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

        // Tail two points
        const pt1 = {
            x: this._tailFactor * len * Math.cos(k) + firstPoint.x,
            y: this._tailFactor * len * Math.sin(k) + firstPoint.y
        };
        const pt2 = {
            x: -1 * this._tailFactor * len * Math.cos(k) + firstPoint.x,
            y: -1 * this._tailFactor * len * Math.sin(k) + firstPoint.y
        };

        const partialLen = (1 - this._headPercentage) * len;
        const p1 = {
            x: this._tailFactor * partialLen * Math.cos(k) + firstPoint.x,
            y: this._tailFactor * partialLen * Math.sin(k) + firstPoint.y
        };
        const p2 = {
            x: -1 * this._tailFactor * partialLen * Math.cos(k) + firstPoint.x,
            y: -1 * this._tailFactor * partialLen * Math.sin(k) + firstPoint.y
        };

        const result = new Polygon({ spatialReference: this.view.spatialReference });

        // Create main arrow ring
        let ring: number[][] = [];
        ring.push([pt1.x, pt1.y]);

        const values = Shapes.CreateArrowHeadPathEx(p1, lastPoint, p2, len, this._headPercentage, 15);
        values.forEach(pt => ring.push([pt.x, pt.y]));

        ring.push([p2.x, p2.y]);

        result.addRing(ring);

        return result;
    }

    /**
     * Create complex arrow for multiple points
     */
    private createComplexArrow(pts: Point[], drawEssentials: DrawEssentials): Polygon {
        const leftArray: { x: number, y: number }[] = [];
        const rightArray: { x: number, y: number }[] = [];
        const lastPoint = pts[pts.length - 1];

        const tempArray: { x: number, y: number }[] = [];
        pts.forEach(pt => {
            tempArray.push({ x: pt.x, y: pt.y });
        });

        const angleArray = GeoTools._vertexAngle(tempArray);
        const totalL = GeoTools._ptCollectionLen(tempArray, 0);

        for (let i = 0, len = tempArray.length - 1; i < len; i++) {
            let partialLen = GeoTools._ptCollectionLen(tempArray, i);
            partialLen += totalL / 2.4;

            const pt1 = {
                x: this._tailFactor * partialLen * Math.cos(angleArray[i]) + tempArray[i].x,
                y: this._tailFactor * partialLen * Math.sin(angleArray[i]) + tempArray[i].y
            };
            const pt2 = {
                x: -1 * this._tailFactor * partialLen * Math.cos(angleArray[i]) + tempArray[i].x,
                y: -1 * this._tailFactor * partialLen * Math.sin(angleArray[i]) + tempArray[i].y
            };

            leftArray.push(pt1);
            rightArray.push(pt2);
        }

        leftArray.push({ x: lastPoint.x, y: lastPoint.y });
        rightArray.push({ x: lastPoint.x, y: lastPoint.y });

        // Create Bezier paths
        let leftBezier = Shapes.CreateBezierPathPCOnly(leftArray, 70);
        leftBezier.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);

        let rightBezier = Shapes.CreateBezierPathPCOnly(rightArray, 70);
        rightBezier.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);

        const headPath = Shapes.CreateArrowHeadPathEx(
            leftBezier[leftBezier.length - 1],
            lastPoint,
            rightBezier[rightBezier.length - 1],
            GeoTools._ptCollectionLen(tempArray, 0),
            this._headPercentage,
            15
        );

        const result = new Polygon({ spatialReference: this.view.spatialReference });

        // Combine all paths
        const ring: number[][] = [];

        // Add left bezier path
        leftBezier.forEach(pt => ring.push([pt.x, pt.y]));

        // Add arrow head
        headPath.forEach(pt => ring.push([pt.x, pt.y]));

        // Add reversed right bezier path
        rightBezier.reverse().forEach(pt => ring.push([pt.x, pt.y]));

        result.addRing(ring);


        // Add CATK lettering near the arrow head via helper

        var midPt = GeoTools.getMidPoint(pts[pts.length - 2], lastPoint);
        var indexL = Math.round(leftArray.length / pts.length);
        var indexR = Math.round(rightArray.length / pts.length);
        var cLenLimit;

        var baseLineLen = GeoTools._2PtLen(leftArray[indexL], rightArray[indexR]) / pts.length;
        cLenLimit = baseLineLen / 2;
        if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
        this.addCatkSafeRings(result, midPt, baseLineLen);



        return result;
    }


    /**
     * Add CATK lettering using many tiny 2D-safe rings to avoid auto-closing artifacts
     */
    private addCatkSafeRings(target: Polygon, center: Point, baseLineLen: number): void {
        try {
            const spatialReference = this.view.spatialReference;
            let cLenLimit = baseLineLen / 2;
            if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
            const catkRings = Shapes.CATK(center.x, center.y, cLenLimit, spatialReference);
            if (!catkRings || !Array.isArray(catkRings)) return;
            const eps = 1e-6;
            for (let s = 0; s < catkRings.length; s++) {
                const stroke = catkRings[s];
                if (!stroke || !Array.isArray(stroke) || stroke.length <= 1) continue;
                for (let i = 0; i < stroke.length - 1; i++) {
                    const a = stroke[i];
                    const b = stroke[i + 1];
                    const ringSeg: number[][] = [];
                    ringSeg.push([a.x, a.y]);
                    ringSeg.push([b.x, b.y]);
                    ringSeg.push([b.x + eps, b.y + eps]);
                    ringSeg.push([a.x, a.y]);
                    target.addRing(ringSeg);
                }
            }
        } catch {
            // ignore CATK failures
        }
    }



    /**
     * Clean up drawing state and finalize
     */
    private cleanUp(): void {
        if (this._points.length === 0) return;

        const drawEssentials = this.createDrawEssentials(this._points.slice(), this._headPercentage, this._tailFactor);

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
        // Geometry type cleared
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

export default CounterAttack;