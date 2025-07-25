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

export interface CanalizeOptions {
    CTRL_PTS?: Point[];
    BASE_LN_PTS?: {startPt: Point, endPt: Point};
    GEOM?: Polyline;
    [key: string]: any;
}

/**
 * Canalize class for drawing Canalize tactical symbols
 * Uses baseline + control points pattern with fracture lines and arrow flaps
 * Returns Polyline geometry despite being classified as an Area symbol
 */
export class Canalize {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;
    
    // Symbol properties
    private SID: string = "340400";
    private symName: string = "Canalize";
    private symGeometricType: string = "Area";
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
        this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.FORCE);
        this.amplifier = new Amplifier();
        
        // Initialize layers if not already done
        this.layerManager.initializeLayers();
        
        // Initialize temporary graphic
        this.tempGraphic = new Graphic();
    }

    /**
     * Initialize the canalize drawing
     */
    public init(options: CanalizeOptions, marker: SimpleLineSymbol): void {
        this._lineSym = marker.clone();
        
        const drawEssentials = new DrawEssentials();
        const baseLine = new BaseLine(this.view, this._lineSym);

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("BASE_LN_PTS") && options.hasOwnProperty("GEOM")) {
            // Immediate placement with all parameters
            if (options.GEOM && this.tempGraphic) {
                this.tempGraphic.geometry = options.GEOM;
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
                }
                this._clear();
            } else {
                throw new Error("Control Points and Baseline or Distance is required to create symbol non-interactively");
            }
        } else {
            // Interactive drawing mode
            this.baseLineEndHandler = baseLine.on("drawEnd", this.baseLineDrawEnd.bind(this));
            this.baseLineClickHandler = baseLine.on("onBaseLineClick", this.baseLineClick.bind(this));
            this.baseLineProgressHandler = baseLine.on("onBaseLineProgress", this.baseLineDrawProgress.bind(this));
            baseLine.init("C");
        }
    }

    /**
     * Handle baseline drawing completion
     */
    private baseLineDrawEnd(evt: any): void {
        if (this.baseLineEndHandler) {
            this.baseLineEndHandler.remove();
        }
        
        if (this.tempGraphic && evt.geometry) {
            this.tempGraphic.geometry = evt.geometry;
            this.symbolLayer.add(this.tempGraphic);
        }
        
        this._baseLinePts = evt.geometry._baseLine;
        this.setupControlPointHandlers();
        this.emit("onBaseLineDrawEnd", { "currentPts": evt.geometry.controlPoints });
    }

    /**
     * Handle baseline drawing progress
     */
    private baseLineDrawProgress(evt: any): void {
        const localDrawEssentials = new DrawEssentials();
        (localDrawEssentials as any).CTRL_PTS = evt.currentGeometry;
        
        const pl = new Polyline({
            paths: [evt.currentGeometry],
            spatialReference: this.view.spatialReference
        });
        
        this.emit("onDrawProgress", { 
            'currentGeometry': pl, 
            'currentDrawEssentials': localDrawEssentials, 
            'currentMarker': evt.currentMarker, 
            'isBaseLine': true 
        });
    }

    /**
     * Handle baseline click events
     */
    private baseLineClick(evt: any): void {
        this.emit("onDrawClick", { 'currentPts': evt.currentGeometry, 'isBaseLine': true });
    }

    /**
     * Set up control point event handlers
     */
    private setupControlPointHandlers(): void {
        this.mouseMoveHandler = this.view.on("pointer-move", this._onMouseMoveHandler.bind(this));
        this.clickHandler = this.view.on("click", this._onClickHandler.bind(this));
        this.doubleClickHandler = this.view.on("double-click", this._onDoubleClickHandler.bind(this));
    }

    /**
     * Handle click events for control points
     */
    private _onClickHandler(clickEvent: any): void {
        const mapPoint = this.view.toMap(clickEvent);
        if (!mapPoint) return;

        this._points.push(new Point({
            x: mapPoint.x,
            y: mapPoint.y,
            spatialReference: this.view.spatialReference
        }));

        this.emit("onDrawClick", { 'currentPts': this._points });
        
        if (this.isLine && this._points.length === 1) {
            this.emit("onDrawClick", { 'currentPts': this._points });
            this.cleanUp();
        }
    }

    /**
     * Handle double-click events
     */
    private _onDoubleClickHandler(clickEvent: any): void {
        const mapPoint = this.view.toMap(clickEvent);
        if (!mapPoint) return;

        this._points.push(new Point({
            x: mapPoint.x,
            y: mapPoint.y,
            spatialReference: this.view.spatialReference
        }));

        this.cleanUp();
    }

    /**
     * Handle mouse move events
     */
    private _onMouseMoveHandler(inputEvent: any): void {
        const mapPoint = this.view.toMap(inputEvent);
        if (!mapPoint) return;

        const candidatePoint = new Point({
            x: mapPoint.x,
            y: mapPoint.y,
            spatialReference: this.view.spatialReference
        });

        const drawEssentials = new DrawEssentials();
        (drawEssentials as any).CTRL_PTS = this._points.concat(candidatePoint);
        (drawEssentials as any).BASE_LN_PTS = this._baseLinePts;

        if (this.tempGraphic) {
            const geometry = this.createSymbol(drawEssentials);
            if (geometry) {
                this.tempGraphic.geometry = geometry;
            }
        }

        this.emit("onDrawProgress", { 
            'currentGeometry': this.tempGraphic?.geometry, 
            'currentDrawEssentials': drawEssentials, 
            'currentMarker': this._lineSym 
        });
    }

    /**
     * Create draw essentials object
     */
    private createDrawEssentials(ctrlPts: Point[], baseLinePts: any): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SCOPE = this.symName;
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        (drawEssentials as any).CTRL_PTS = ctrlPts;
        (drawEssentials as any).BASE_LN_PTS = baseLinePts;
        drawEssentials.AMPLIFIER = this.amplifier.toString();
        
        return drawEssentials;
    }

    /**
     * Create the canalize symbol geometry
     */
    private createSymbol(drawEssentials: DrawEssentials): Polyline | null {
        try {
            let pts: Point[];
            if ((drawEssentials as any).CTRL_PTS) {
                pts = (drawEssentials as any).CTRL_PTS;
            } else {
                throw new Error("controlPoints not found");
            }

            const stPt = (drawEssentials as any).BASE_LN_PTS.startPt;
            const endPt = (drawEssentials as any).BASE_LN_PTS.endPt;

            if (!stPt || !endPt) {
                throw new Error("First Parameter of the Function is an Array with Start and End Point");
            }

            const firstPoint = pts[0];
            const lastPoint = pts[pts.length - 1];
            const leftArray: Point[] = [];
            const rightArray: Point[] = [];

            const midPt = GeoTools.getMidPoint(stPt, endPt);

            const result = new Polyline({
                spatialReference: this.view.spatialReference
            });

            // Base Line
            if (pts.length >= 1) {
                // Use first point as last point if only one point
                // This is handled in the original code but seems redundant
            }

            const len = GeoTools._2PtLen(midPt, lastPoint);
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

            const p1 = new Point({
                x: partialLen * Math.cos(k) + midPt.x,
                y: partialLen * Math.sin(k) + midPt.y,
                spatialReference: this.view.spatialReference
            });

            const p2 = new Point({
                x: -1 * partialLen * Math.cos(k) + midPt.x,
                y: -1 * partialLen * Math.sin(k) + midPt.y,
                spatialReference: this.view.spatialReference
            });

            // Fracture Baseline
            const values = GeoTools._fracturePts(p1, p2, 10, this.view.spatialReference);
            result.paths = result.paths.concat(values.geometry.paths);

            const baseLineLen = GeoTools._2PtLen(p1, p2);
            let cLenLimit = values.len / 2;
            
            if (cLenLimit > baseLineLen / 3.6) {
                cLenLimit = baseLineLen / 3.6;
            }
            
            // Create CC shape - using a simple circle for now
            const ccPath = this.createCCShape(values.midPoint.x, values.midPoint.y, cLenLimit);
            result.addPath(ccPath);

            // Front
            if (pts.length >= 1) {
                leftArray.push(p1);
                rightArray.push(p2);
            }

            for (let i = 0; i < pts.length; i++) {
                const length = GeoTools._2PtLen(midPt, pts[i]);
                const angle = GeoTools.angleInRadians(midPt, pts[i]);

                const stPtCandidatePt = new Point({
                    x: p1.x + length * Math.cos(angle),
                    y: p1.y + length * Math.sin(angle),
                    spatialReference: this.view.spatialReference
                });

                const endPtCandidatePt = new Point({
                    x: p2.x + length * Math.cos(angle),
                    y: p2.y + length * Math.sin(angle),
                    spatialReference: this.view.spatialReference
                });

                leftArray.push(stPtCandidatePt);
                rightArray.push(endPtCandidatePt);
            }

            result.addPath(leftArray);
            result.addPath(rightArray);

            // Arrows
            if (leftArray.length >= 2 && rightArray.length >= 2) {
                const lastStPtCandidatePt = leftArray[leftArray.length - 1];
                const lastEndPtCandidatePt = rightArray[rightArray.length - 1];
                
                const leftFlap = this._flaps(
                    leftArray[leftArray.length - 1],
                    this.calculateArrowFlanksLen(GeoTools._2PtLen(midPt, pts[pts.length - 1]), GeoTools._2PtLen(lastStPtCandidatePt, lastEndPtCandidatePt)),
                    GeoTools.angleInRadians(leftArray[leftArray.length - 2], leftArray[leftArray.length - 1]),
                    1
                );
                result.addPath(leftFlap);

                const rightFlap = this._flaps(
                    rightArray[rightArray.length - 1],
                    this.calculateArrowFlanksLen(GeoTools._2PtLen(midPt, pts[pts.length - 1]), GeoTools._2PtLen(lastStPtCandidatePt, lastEndPtCandidatePt)),
                    GeoTools.angleInRadians(rightArray[rightArray.length - 2], rightArray[rightArray.length - 1]),
                    0
                );
                result.addPath(rightFlap);
            }

            return result;
        } catch (e) {
            console.log(this.symName + ' Cannot create Symbol due to invalid geometry');
            return null;
        }
    }

    /**
     * Create arrow flaps
     */
    private _flaps(candidatePoint: Point, length: number, angle: number, side: number): Point[] {
        const path: Point[] = [];
        
        if (side === 1) {
            angle -= 15;
            const angle1 = GeoTools.toDegrees(angle);

            const rightWing = new Point({
                x: candidatePoint.x + length * Math.cos(GeoTools.toRad(Number(angle1))),
                y: candidatePoint.y + length * Math.sin(GeoTools.toRad(Number(angle1))),
                spatialReference: this.view.spatialReference
            });

            const rightWing2 = new Point({
                x: -1 * length * Math.cos(GeoTools.toRad(Number(angle1))) + candidatePoint.x,
                y: -1 * length * Math.sin(GeoTools.toRad(Number(angle1))) + candidatePoint.y,
                spatialReference: this.view.spatialReference
            });

            path.push(rightWing, candidatePoint, rightWing2);
        } else {
            angle += 15;
            const angle2 = GeoTools.toDegrees(angle);

            const rightWing = new Point({
                x: candidatePoint.x + length * Math.cos(GeoTools.toRad(Number(angle2))),
                y: candidatePoint.y + length * Math.sin(GeoTools.toRad(Number(angle2))),
                spatialReference: this.view.spatialReference
            });

            const rightWing2 = new Point({
                x: -1 * length * Math.cos(GeoTools.toRad(Number(angle2))) + candidatePoint.x,
                y: -1 * length * Math.sin(GeoTools.toRad(Number(angle2))) + candidatePoint.y,
                spatialReference: this.view.spatialReference
            });

            path.push(rightWing, candidatePoint, rightWing2);
        }

        return path;
    }

    /**
     * Get baseline points
     */
    public getBaseLinePts(): any {
        return this._baseLinePts;
    }

    /**
     * Clean up drawing state
     */
    private cleanUp(): void {
        const drawEss = this.createDrawEssentials(this._points.slice(), this._baseLinePts);
        
        if (this.tempGraphic && this.tempGraphic.geometry) {
            this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEss);
        }
        
        this._clear();
        this._removeEvents();
    }

    /**
     * Handle draw end
     */
    private __drawEnd(drawGeometry: Polyline, drawEssentials: DrawEssentials): void {
        if (drawGeometry) {
            const spRef = this.view.spatialReference;
            let geographicGeometry: Polyline | null = null;

            if (spRef.isWebMercator()) {
                // Handle web mercator conversion if needed
                geographicGeometry = drawGeometry.clone();
            } else if (spRef.wkid === 4326) {
                geographicGeometry = drawGeometry.clone();
            }

            this.__onDrawEnd(drawGeometry, geographicGeometry || drawGeometry, drawEssentials);
        }
    }

    /**
     * Emit draw end event
     */
    private __onDrawEnd(geometry: Polyline, geoGeometry: Polyline, drawEssParam: DrawEssentials): void {
        this.emit("onDrawEnd", { 
            'geometry': geometry, 
            'geographicGeometry': geoGeometry, 
            'drawEssentials': drawEssParam, 
            'marker': this._lineSym 
        });
    }

    /**
     * Clear drawing state
     */
    private _clear(): void {
        if (this.tempGraphic) {
            this.symbolLayer.remove(this.tempGraphic);
            this.tempGraphic = null;
        }

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
     * Deactivate the symbol drawing
     */
    public deactivate(): void {
        this._clear();
        this._removeEvents();
        this._geometryType = null;
    }

    /**
     * Emit events to listeners
     */
    private emit(eventName: string, data: any): void {
        const listeners = this.eventListeners.get(eventName);
        if (listeners) {
            listeners.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in event listener for ${eventName}:`, error);
                }
            });
        }
    }

    /**
     * Add event listener
     */
    public on(eventName: string, callback: Function): void {
        if (!this.eventListeners.has(eventName)) {
            this.eventListeners.set(eventName, []);
        }
        this.eventListeners.get(eventName)!.push(callback);
    }

    /**
     * Remove event listener
     */
    public off(eventName: string, callback?: Function): void {
        const listeners = this.eventListeners.get(eventName);
        if (listeners && callback) {
            const index = listeners.indexOf(callback);
            if (index > -1) {
                listeners.splice(index, 1);
            }
        } else if (listeners) {
            this.eventListeners.delete(eventName);
        }
    }

    /**
     * Get the symbol layer
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

    /**
     * Calculate arrow flanks length
     */
    private calculateArrowFlanksLen(length1: number, length2: number): number {
        return Math.min(length1, length2) * 0.3;
    }

    /**
     * Create CC shape (simplified circle)
     */
    private createCCShape(centerX: number, centerY: number, radius: number): Point[] {
        const points: Point[] = [];
        const segments = 16;
        
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * 2 * Math.PI;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);
            
            points.push(new Point({
                x: x,
                y: y,
                spatialReference: this.view.spatialReference
            }));
        }
        
        return points;
    }
}

export default Canalize; 