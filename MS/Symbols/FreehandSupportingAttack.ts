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
import Amplifier from "../Support/Amplifier";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";

export interface FreehandSupportingAttackOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    HEAD_RATIO?: number;
    TAIL_FACTOR?: number;
    [key: string]: any;
}

/**
 * FreehandSupportingAttack class for drawing Freehand Supporting Attack Like Arrow symbols on MapView or SceneView
 * Supports both immediate placement and interactive drawing modes
 */
export class FreehandSupportingAttack {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;
    
    // Symbol properties
    private SID: string = "000009";
    private symName: string = "Freehand - Sp Attk Like Arrow";
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
     * Initialize the freehand supporting attack drawing
     */
    public init(options: FreehandSupportingAttackOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void {
        this._lineSym = marker;
        
        // Set parameters from options
        this._headPercentage = GeoTools.setDefault(options, "HEAD_RATIO", 0.07);
        this._tailFactor = GeoTools.setDefault(options, "TAIL_FACTOR", 0.05);

        const drawEssentials = new DrawEssentials();

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
            // Immediate placement with all parameters
            if (options.GEOM && this.tempGraphic) {
                this.tempGraphic.geometry = options.GEOM;
            }
            
            const drawEss = this.createDrawEssentials(
                options.CTRL_PTS!.slice(), 
                this._headPercentage, 
                this._tailFactor
            );
            
            if (this.tempGraphic && this.tempGraphic.geometry) {
                this.__drawEnd(this.tempGraphic.geometry as Polygon, drawEss);
            }
            this._clear();

        } else if (options.hasOwnProperty("CTRL_PTS")) {
            // Immediate placement with control points only
            const drawEss = this.createDrawEssentials(
                options.CTRL_PTS!.slice(), 
                this._headPercentage, 
                this._tailFactor
            );
            
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
        
        this.emit("onDrawClick", { currentPts: this._points });

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
        (drawEssentials as any).HEAD_RATIO = this._headPercentage;
        (drawEssentials as any).TAIL_FACTOR = this._tailFactor;
        
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
    private createDrawEssentials(
        ctrlPts: Point[], 
        arrowHeadRatio: number, 
        tailFactor: number
    ): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.AMPLIFIER = this.amplifier.toString();
        
        // Store additional properties
        (drawEssentials as any).SCOPE = this;
        (drawEssentials as any).CTRL_PTS = ctrlPts;
        (drawEssentials as any).HEAD_RATIO = arrowHeadRatio;
        (drawEssentials as any).TAIL_FACTOR = tailFactor;
        (drawEssentials as any).ISFHAND = 1; // Mark as freehand

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
        
        const values = this.CreateArrowHeadPathEx(p1, lastPoint, p2, len, this._headPercentage, 15);
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

        const headPath = this.CreateArrowHeadPathEx(
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

        return result;
    }

    /**
     * Create arrow head path
     */
    private CreateArrowHeadPathEx(
        pt1: { x: number, y: number }, 
        candidatePt: { x: number, y: number }, 
        pt2: { x: number, y: number }, 
        totalLen: number, 
        headPercentage: number, 
        headAngle: number, 
        straight?: boolean
    ): Array<{ x: number, y: number }> {
        const headSizeBaseRatio = 1.07;
        const headBaseLen = totalLen * headPercentage;
        const headSideLen = headBaseLen * headSizeBaseRatio;
        
        const angle1 = GeoTools.twoPtsAngle(candidatePt, pt1);
        const angle2 = GeoTools.twoPtsAngle(candidatePt, pt2);

        let midAngle = (Math.abs(angle1 - angle2)) / 2;
        if (Math.abs(angle1 - angle2) > Math.PI * 1.88) midAngle += Math.PI;
        
        const len = Math.sqrt(headBaseLen * headBaseLen + headSideLen * headSideLen - 2 * headSideLen * headBaseLen * Math.cos(midAngle + headAngle / 180 * Math.PI));
        const upAngle = Math.asin(headBaseLen * Math.sin(midAngle + headAngle / 180 * Math.PI) / len);
        const centAngle = upAngle + headAngle / 180 * Math.PI;
        
        const result = (straight === false || straight === undefined) ? 
            (headBaseLen * Math.sin(Math.PI - centAngle - midAngle) / Math.sin(centAngle)) : 0;

        const path = [
            { x: candidatePt.x + result * Math.cos(angle1), y: candidatePt.y + result * Math.sin(angle1) },
            { x: candidatePt.x + headSideLen * Math.cos(angle1 - headAngle / 180 * Math.PI), y: candidatePt.y + headSideLen * Math.sin(angle1 - headAngle / 180 * Math.PI) },
            candidatePt,
            { x: candidatePt.x + headSideLen * Math.cos(angle2 + headAngle / 180 * Math.PI), y: candidatePt.y + headSideLen * Math.sin(angle2 + headAngle / 180 * Math.PI) },
            { x: candidatePt.x + result * Math.cos(angle2), y: candidatePt.y + result * Math.sin(angle2) }
        ];

        return path;
    }

    /**
     * Clean up drawing state and finalize
     */
    private cleanUp(): void {
        if (this._points.length === 0) return;

        const drawEss = this.createDrawEssentials(
            this._points.slice(),
            this._headPercentage,
            this._tailFactor
        );
        
        if (this.tempGraphic && this.tempGraphic.geometry) {
            this.__drawEnd(this.tempGraphic.geometry as Polygon, drawEss);
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
        this._geometryType = null;
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
                symbolType: "FreehandSupportingAttack",
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

export default FreehandSupportingAttack; 