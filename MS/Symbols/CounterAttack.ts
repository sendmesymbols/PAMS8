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
    private eventListeners: Map<string, Function[]> = new Map();

    constructor(view: MapView | SceneView, isLine: boolean = false) {
        this.view = view;
        this.isLine = isLine;
        this.layerManager = GraphicsLayerManager.getInstance(view);
        this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.FORCE);
        this.amplifier = new Amplifier();

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
            //(this._lineSym as any).style = "dash";
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

        // Add CATK lettering with 2D-safe rings (epsilon split and closed ring)
        try {
            const midPt = GeoTools.getMidPoint(firstPoint, lastPoint);
            const baseLineLen = GeoTools._2PtLen(new Point({ x: p1.x, y: p1.y, spatialReference: this.view.spatialReference }), new Point({ x: p2.x, y: p2.y, spatialReference: this.view.spatialReference }));
            let cLenLimit = baseLineLen / 2;
            if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
            const catkRings = Shapes.CATK(midPt.x, midPt.y, cLenLimit, this.view.spatialReference);
            if (catkRings && Array.isArray(catkRings)) {
                for (let j = 0; j <= catkRings.length - 1; j++) {
                    const stroke = catkRings[j];
                    if (stroke && Array.isArray(stroke) && stroke.length > 0) {
                        const coords: number[][] = stroke.map((pt: any) => [pt.x, pt.y]);
                        if (coords.length === 2) {
                            coords.push([coords[1][0] + 1e-6, coords[1][1] + 1e-6]);
                        }
                        coords.push(coords[0]);
                        result.addRing(coords);
                    }
                }
            }
        } catch {
            // ignore CATK failures
        }


        return result;
    }

    /**
     * Create complex arrow for multiple points
     */
    private createComplexArrow(pts: Point[], drawEssentials: DrawEssentials): Polygon {
        const leftArray: Point[] = [];
        const rightArray: Point[] = [];
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

            const pt1 = new Point({
                x: this._tailFactor * partialLen * Math.cos(angleArray[i]) + tempArray[i].x,
                y: this._tailFactor * partialLen * Math.sin(angleArray[i]) + tempArray[i].y,
                spatialReference: this.view.spatialReference
            });
            const pt2 = new Point({
                x: -1 * this._tailFactor * partialLen * Math.cos(angleArray[i]) + tempArray[i].x,
                y: -1 * this._tailFactor * partialLen * Math.sin(angleArray[i]) + tempArray[i].y,
                spatialReference: this.view.spatialReference
            });

            leftArray.push(pt1);
            rightArray.push(pt2);
        }

        leftArray.push(new Point({ x: lastPoint.x, y: lastPoint.y, spatialReference: this.view.spatialReference }));
        rightArray.push(new Point({ x: lastPoint.x, y: lastPoint.y, spatialReference: this.view.spatialReference }));

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

        // Add CATK lettering near the arrow head with 2D-safe rings
        try {
            const spatialReference = this.view.spatialReference;
            const midPt = GeoTools.getMidPoint(pts[Math.max(0, pts.length - 2)], lastPoint);
            const indexL = Math.max(0, Math.round(leftBezier.length / Math.max(1, pts.length)) - 1);
            const indexR = Math.max(0, Math.round(rightBezier.length / Math.max(1, pts.length)) - 1);
            const baseLineLen = GeoTools._2PtLen(
                new Point({ x: leftBezier[indexL].x, y: leftBezier[indexL].y, spatialReference }),
                new Point({ x: rightBezier[indexR].x, y: rightBezier[indexR].y, spatialReference })
            ) / Math.max(1, pts.length);
            let cLenLimit = baseLineLen / 2;
            if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
            const catkRings = Shapes.CATK(midPt.x, midPt.y, cLenLimit, spatialReference);
            if (catkRings && Array.isArray(catkRings)) {
                for (let j = 0; j <= catkRings.length - 1; j++) {
                    const stroke = catkRings[j];
                    if (stroke && Array.isArray(stroke) && stroke.length > 0) {
                        const coords: number[][] = stroke.map((pt: any) => [pt.x, pt.y]);
                        if (coords.length === 2) {
                            coords.push([coords[1][0] + 1e-6, coords[1][1] + 1e-6]);
                        }
                        coords.push(coords[0]);
                        result.addRing(coords);
                    }
                }
            }
        } catch {
            // ignore CATK failures
        }

        return result;
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

    /**
     * Event emitter functionality
     */
    private emit(eventName: string, data: any): void {
        const listeners = this.eventListeners.get(eventName);
        if (listeners) {
            listeners.forEach(listener => listener(data));
        }

        // Also emit as a global document event for SymbolEngine to catch
        this.emitGlobalEvent(eventName, data);
    }

    /**
     * Emit global events that can be caught by SymbolEngine
     */
    private emitGlobalEvent(eventName: string, data: any): void {
        const customEvent = new CustomEvent(eventName, {
            detail: {
                symbolType: "CounterAttack",
                eventName: eventName,
                ...data
            },
            bubbles: true,
            cancelable: true
        });

        // Dispatch from the view container if available, otherwise from document
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