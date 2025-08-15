import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Color from "@arcgis/core/Color";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";
import Shapes from "../Support/Shapes.ts";
// Removed unused imports from translation

export interface AvenueOfApchsOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    HEAD_RATIO?: number;
    TAIL_FACTOR?: number;
    [key: string]: any;
}

/**
 * AvenueOfApchs class for drawing Avenue of Approaches arrows
 * Creates complex arrow shapes with configurable head and tail parameters
 * Supports both simple (<=2 points) and complex (>2 points) arrow creation
 */
export class AvenueOfApchs {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;

    // Symbol properties
    private SID: string = "120204";
    private symName: string = "Avenue of Approaches";
    private symGeometricType: string = "Area";
    private _lineSym: SimpleFillSymbol | null = null;
    private _points: Point[] = [];
    // private _geometryType: string | null = null;
    private amplifier: Amplifier;

    // Arrow parameters
    private _tailFactor: number = 0.05;
    private _headPercentage: number = 0.07;

    // Drawing state
    private isDrawing: boolean = false;
    private tempGraphic: Graphic | null = null;
    private _baseLinePts: Point[] = [];

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
     * Initialize the avenue of approaches drawing
     */
    public init(options: AvenueOfApchsOptions, marker: SimpleLineSymbol): void {
        // Create SimpleFillSymbol with 50% transparency
        const fillColor = new Color(marker.color);
        fillColor.a = 0.50; // 50% transparency

        this._lineSym = new SimpleFillSymbol({
            style: "solid",
            color: fillColor,
            outline: new SimpleLineSymbol({
                style: marker.style,
                color: marker.color,
                width: marker.width
            })
        });

        // Set arrow parameters with defaults
        this._headPercentage = this.setDefault(options, "HEAD_RATIO", 0.07);
        this._tailFactor = this.setDefault(options, "TAIL_FACTOR", 0.05);

        // Set up event handlers
        this.setupEventHandlers();

        // removed unused variable from translation

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
            // Immediate placement with both control points and geometry
            if (options.GEOM && this.tempGraphic) {
                try {
                    this.tempGraphic.geometry = options.GEOM;
                } catch (error) {
                    console.error(this.symName, "Failed to set Polygon geometry:", error);
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
     * Utility method to set default values (mimics GeoTools.setDefault)
     */
    private setDefault(options: any, key: string, defaultValue: number): number {
        return options && options.hasOwnProperty(key) ? options[key] : defaultValue;
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
     * Create simple arrow for 2 or fewer points
     */
    private createSimpleArrow(pts: Point[], result: Polygon): Polygon {
        const firstPoint = pts[0];
        const lastPoint = pts[pts.length - 1];

        const len = this.calculateDistance(firstPoint, lastPoint);
        const k = this.calculateAngle(firstPoint, lastPoint);

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

        let ring: number[][] = [];

        ring.push([pt1.x, pt1.y]);

        // Add arrow head path
        const headPath = this.CreateArrowHeadPathEx(p1, lastPoint, p2, len, this._headPercentage, 15);
        ring = ring.concat(headPath.map(pt => [pt.x, pt.y]));

        ring.push([p2.x, p2.y]);
        ring.push([pt1.x, pt1.y]);
        ring.push([pt2.x, pt2.y]);

        result.addRing(ring);
        return result;
    }

    /**
     * Create complex arrow for more than 2 points
     */
    private createComplexArrow(pts: Point[], result: Polygon): Polygon {
        const lastPoint = pts[pts.length - 1];
        const tempArray = pts.map(e => ({ x: e.x, y: e.y }));

        // Calculate vertex angles and create left/right arrays
        const angleArray = this.calculateVertexAngles(tempArray);
        const totalL = this.calculatePathLength(tempArray, 0);

        const leftArray: any[] = [];
        const rightArray: any[] = [];

        for (let i = 0; i < tempArray.length - 1; i++) {
            let partialLen = this.calculatePathLength(tempArray, i);
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

        // Create smooth paths using Bezier (fallback to linear interpolation)
        let leftBezier = Shapes.CreateBezierPathPCOnly(leftArray, 70);
        let rightBezier = Shapes.CreateBezierPathPCOnly(rightArray, 70);

        // Splice for arrow head
        leftBezier.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);
        rightBezier.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);

        const headPath = this.CreateArrowHeadPathEx(
            leftBezier[leftBezier.length - 1],
            lastPoint,
            rightBezier[rightBezier.length - 1],
            totalL,
            this._headPercentage,
            15
        );

        // Combine all paths and explicitly close the back
        const ring: number[][] = [];

        // Add left bezier path
        leftBezier.forEach(pt => ring.push([pt.x, pt.y]));

        // Add arrow head
        headPath.forEach(pt => ring.push([pt.x, pt.y]));

        // Add reversed right bezier path
        rightBezier.reverse().forEach(pt => ring.push([pt.x, pt.y]));

        // Close the ring at the back of the arrow
        if (leftBezier.length > 0) {
            ring.push([leftBezier[0].x, leftBezier[0].y]);
        }

        result.addRing(ring);
        return result;
    }

    /**
     * Create arrow head path
     */
    private CreateArrowHeadPathEx(pt1: any, candidatePt: Point, pt2: any, totalLen: number, headPercentage: number, headAngle: number, straight?: boolean): any[] {
        const headSizeBaseRatio = 1.07;
        const headBaseLen = totalLen * headPercentage;
        const headSideLen = headBaseLen * headSizeBaseRatio;

        const angle1 = this.twoPtsAngle(candidatePt, pt1);
        const angle2 = this.twoPtsAngle(candidatePt, pt2);

        let midAngle = Math.abs(angle1 - angle2) / 2;
        if (Math.abs(angle1 - angle2) > Math.PI * 1.88) {
            midAngle += Math.PI;
        }

        const len = Math.sqrt(
            headBaseLen * headBaseLen +
            headSideLen * headSideLen -
            2 * headSideLen * headBaseLen * Math.cos(midAngle + (headAngle / 180) * Math.PI)
        );

        const upAngle = Math.asin(headBaseLen * Math.sin(midAngle + (headAngle / 180) * Math.PI) / len);
        const centAngle = upAngle + (headAngle / 180) * Math.PI;

        const result = (straight === false || straight === undefined) ?
            (headBaseLen * Math.sin(Math.PI - centAngle - midAngle) / Math.sin(centAngle)) : 0;

        const path = [];
        path.push({
            x: candidatePt.x + result * Math.cos(angle1),
            y: candidatePt.y + result * Math.sin(angle1)
        });
        path.push({
            x: candidatePt.x + headSideLen * Math.cos(angle1 - (headAngle / 180) * Math.PI),
            y: candidatePt.y + headSideLen * Math.sin(angle1 - (headAngle / 180) * Math.PI)
        });
        path.push(candidatePt);
        path.push({
            x: candidatePt.x + headSideLen * Math.cos(angle2 + (headAngle / 180) * Math.PI),
            y: candidatePt.y + headSideLen * Math.sin(angle2 + (headAngle / 180) * Math.PI)
        });
        path.push({
            x: candidatePt.x + result * Math.cos(angle2),
            y: candidatePt.y + result * Math.sin(angle2)
        });

        return path;
    }

    /**
     * Create Bezier path for point collection only (fallback)
     */
    // Removed unused fallback CreateBezierPathPCOnly (Shapes.CreateBezierPathPCOnly is used)

    /**
     * Calculate angle between two points relative to a candidate point
     */
    private twoPtsAngle(candidatePt: Point, pt: any): number {
        return Math.atan2(pt.y - candidatePt.y, pt.x - candidatePt.x);
    }

    /**
     * Calculate distance between two points
     */
    private calculateDistance(pt1: Point, pt2: Point): number {
        const dx = pt2.x - pt1.x;
        const dy = pt2.y - pt1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Calculate angle for two points relationship
     */
    private calculateAngle(firstPoint: Point, lastPoint: Point): number {
        let k = Math.atan((firstPoint.y - lastPoint.y) / (firstPoint.x - lastPoint.x));

        const relationship = this.twoPtsRelationship(firstPoint, lastPoint);
        switch (relationship) {
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

        return k;
    }

    /**
     * Determine relationship between two points
     */
    private twoPtsRelationship(pt1: Point, pt2: Point): string {
        if (pt2.x >= pt1.x && pt2.y >= pt1.y) return "ne";
        if (pt2.x < pt1.x && pt2.y >= pt1.y) return "nw";
        if (pt2.x < pt1.x && pt2.y < pt1.y) return "sw";
        return "se";
    }

    /**
     * Calculate vertex angles for point array
     */
    private calculateVertexAngles(tempArray: any[]): number[] {
        const angles: number[] = [];
        for (let i = 0; i < tempArray.length - 1; i++) {
            if (i + 1 < tempArray.length) {
                const angle = Math.atan2(
                    tempArray[i + 1].y - tempArray[i].y,
                    tempArray[i + 1].x - tempArray[i].x
                ) + Math.PI / 2; // Perpendicular angle
                angles.push(angle);
            }
        }
        return angles;
    }

    /**
     * Calculate path length
     */
    private calculatePathLength(tempArray: any[], startIndex: number): number {
        let length = 0;
        for (let i = startIndex; i < tempArray.length - 1; i++) {
            const dx = tempArray[i + 1].x - tempArray[i].x;
            const dy = tempArray[i + 1].y - tempArray[i].y;
            length += Math.sqrt(dx * dx + dy * dy);
        }
        return length;
    }

    /**
     * Get baseline points
     */
    public getBaseLinePts(): Point[] {
        return this._baseLinePts;
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
        this._baseLinePts = [];
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
        // this._geometryType = null;
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

        this.emitGlobalEvent(eventName, data);
    }

    private emitGlobalEvent(eventName: string, data: any): void {
        const customEvent = new CustomEvent(eventName, {
            detail: {
                symbolType: "AvenueOfApchs",
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

export default AvenueOfApchs;