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

export interface BreachOptions {
    CTRL_PTS?: Point[];
    BASE_LN_PTS?: { startPt: Point; endPt: Point };
    GEOM?: Polyline;
    [key: string]: any;
}

/**
 * Breach class for drawing Breach symbols
 * Requires baseline drawing followed by breach direction points
 * Creates arrows and fracture patterns on the baseline
 */
export class Breach {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;
    
    // Symbol properties
    private SID: string = "340200";
    private symName: string = "Breach";
    private symGeometricType: string = "Area";
    private _lineSym: SimpleLineSymbol | null = null;
    private _points: Point[] = [];
    private _baseLinePts: { startPt?: Point; endPt?: Point } = {};
    private _geometryType: string | null = null;
    private amplifier: Amplifier;
    
    // Drawing state
    private isDrawing: boolean = false;
    private tempGraphic: Graphic | null = null;
    private baselineDrawn: boolean = false;
    
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
     * Initialize the breach drawing
     */
    public init(options: BreachOptions, marker: SimpleLineSymbol): void {
        this._lineSym = marker.clone();
        
        // const drawEssentials = new DrawEssentials();

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("BASE_LN_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
            // Immediate placement with all data
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
                const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.BASE_LN_PTS!);
                const geometry = this.createSymbol(drawEss);
                if (geometry && this.tempGraphic) {
                    this.tempGraphic.geometry = geometry;
                    this.__drawEnd(geometry, drawEss);
                    this._clear();
                }
            } else {
                throw new Error("Control Points and Baseline Pts are required to create symbol non-interactively");
            }

        } else {
            // Interactive drawing mode - start with baseline
            this.startBaselineDrawing();
        }
    }

    /**
     * Start baseline drawing mode
     */
    private startBaselineDrawing(): void {
        if (!this._lineSym) return;
        
        const baseLine = new (BaseLine as any)(this.view, this._lineSym);
        
        this.baseLineEndHandler = baseLine.on("drawEnd", (evt: any) => {
            this.baseLineDrawEnd(evt);
        });
        
        this.baseLineClickHandler = baseLine.on("onBaseLineClick", (evt: any) => {
            this.baseLineClick(evt);
        });
        
        this.baseLineProgressHandler = baseLine.on("onBaseLineProgress", (evt: any) => {
            this.baseLineDrawProgress(evt);
        });

        baseLine.init("B");
    }

    /**
     * Handle baseline draw end
     */
    private baseLineDrawEnd(evt: any): void {
        if (this.baseLineEndHandler) {
            this.baseLineEndHandler.remove();
        }
        
        this.tempGraphic = new Graphic({
            geometry: evt.geometry,
            symbol: this._lineSym
        });
        this.symbolLayer.add(this.tempGraphic);
        
        this._baseLinePts = evt.geometry._baseLine;
        this.baselineDrawn = true;
        
        // Set up handlers for breach direction
        this.mouseMoveHandler = this.view.on("pointer-move", (event) => {
            this._onMouseMoveHandler(event);
        });
        this.clickHandler = this.view.on("click", (event) => {
            this._onClickHandler(event);
        });
        this.doubleClickHandler = this.view.on("double-click", (event) => {
            this._onDoubleClickHandler(event);
        });
        
        this.emit("onBaseLineDrawEnd", { currentPts: evt.geometry.controlPoints });
    }

    /**
     * Handle baseline draw progress
     */
    private baseLineDrawProgress(evt: any): void {
        const localDrawEssentials: any = {
            CTRL_PTS: evt.currentGeometry
        };
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
     * Handle baseline click
     */
    private baseLineClick(evt: any): void {
        this.emit("onDrawClick", {
            currentPts: evt.currentGeometry,
            isBaseLine: true
        });
    }

    /**
     * Handle click events after baseline is drawn
     */
    private _onClickHandler(clickEvent: any): void {
        if (!this.baselineDrawn) return;
        
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
        if (!this.baselineDrawn) return;
        
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
        if (!this.baselineDrawn || !this.tempGraphic) return;

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
    private createDrawEssentials(ctrlPts: Point[], baseLinePts: { startPt: Point; endPt: Point }): DrawEssentials {
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

        return drawEssentials;
    }

    /**
     * Create symbol geometry from DrawEssentials
     */
    private createSymbol(drawEssentials: DrawEssentials): Polyline | null {
        try {
            // Extract control points
            const ctrlPts: Point[] = (drawEssentials as any).CTRL_PTS;
            if (!ctrlPts || ctrlPts.length === 0) {
                throw new Error("controlPoints not found");
            }

            // Extract baseline points
            const baseLinePts = (drawEssentials as any).BASE_LN_PTS;
            const stPt: Point = baseLinePts?.startPt;
            const endPt: Point = baseLinePts?.endPt;
            if (!stPt || !endPt) {
                throw new Error("Start and End Point required for baseline");
            }

            const spatialReference = this.view.spatialReference;
            const firstPoint = ctrlPts[0];

            const result = new Polyline({ spatialReference });

            // Midpoint and base direction
            const midPt = GeoTools.getMidPoint(stPt, endPt);
            let k = Math.atan((midPt.y - firstPoint.y) / (midPt.x - firstPoint.x));

            switch (GeoTools.twoPtsRelationShip(midPt, firstPoint)) {
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

            const partialLen = GeoTools._2PtLen(midPt, endPt);
            const p1 = new Point({ x: partialLen * Math.cos(k) + midPt.x, y: partialLen * Math.sin(k) + midPt.y, spatialReference });
            const p2 = new Point({ x: -1 * partialLen * Math.cos(k) + midPt.x, y: -1 * partialLen * Math.sin(k) + midPt.y, spatialReference });

            // Fracture baseline using GeoTools and add "B" marker using Shapes
            const fracture = GeoTools._fracturePts(p1, p2, 10, spatialReference);
            fracture.geometry.paths.forEach((path: number[][]) => result.addPath(path));

            const baseLineLen = GeoTools._2PtLen(p1, p2);
            let cLenLimit = fracture.len / 2;
            if (cLenLimit > baseLineLen / 3.6) {
                cLenLimit = baseLineLen / 3.6;
            }
            const bPts = Shapes.createB(fracture.midPoint, cLenLimit, 40);
            result.addPath(bPts.map(pt => [pt.x, pt.y]));

            // Front projection lines
            const leftArray: Point[] = [];
            const rightArray: Point[] = [];
            if (ctrlPts.length >= 1) {
                leftArray.push(p1);
                rightArray.push(p2);
            }

            let stPtCandidatePt: Point | null = null;
            let endPtCandidatePt: Point | null = null;

            for (let i = 0; i < ctrlPts.length; i++) {
                const length = GeoTools._2PtLen(midPt, ctrlPts[i]);
                const angle = GeoTools.angleInRadians(midPt, ctrlPts[i]);

                stPtCandidatePt = new Point({
                    x: p1.x + length * Math.cos(angle),
                    y: p1.y + length * Math.sin(angle),
                    spatialReference
                });

                endPtCandidatePt = new Point({
                    x: p2.x + length * Math.cos(angle),
                    y: p2.y + length * Math.sin(angle),
                    spatialReference
                });

                leftArray.push(stPtCandidatePt);
                rightArray.push(endPtCandidatePt);
            }

            result.addPath(leftArray.map(pt => [pt.x, pt.y]));
            result.addPath(rightArray.map(pt => [pt.x, pt.y]));

            // Arrow flaps at the end
            if (leftArray.length > 1 && rightArray.length > 1 && stPtCandidatePt && endPtCandidatePt) {
                const leftEndPt = leftArray[leftArray.length - 1];
                const rightEndPt = rightArray[rightArray.length - 1];
                const leftPrevPt = leftArray[leftArray.length - 2];
                const rightPrevPt = rightArray[rightArray.length - 2];

                const arrowLength = this.calculateArrowLength(
                    midPt,
                    ctrlPts[ctrlPts.length - 1],
                    stPtCandidatePt,
                    endPtCandidatePt
                );

                const leftFlap = this.createArrowFlap(
                    leftEndPt,
                    arrowLength,
                    GeoTools.angleInRadians(leftPrevPt, leftEndPt),
                    0
                );

                const rightFlap = this.createArrowFlap(
                    rightEndPt,
                    arrowLength,
                    GeoTools.angleInRadians(rightPrevPt, rightEndPt),
                    1
                );

                result.addPath(leftFlap);
                result.addPath(rightFlap);
            }

            return result;
        } catch (e) {
            console.log(this.constructor.name + " Cannot create Symbol due to invalid geometry");
            return null;
        }
    }

    

    /**
     * Create arrow flap
     */
    private createArrowFlap(candidatePoint: Point, length: number, angle: number, side: number): number[][] {
        const path: number[][] = [];
        
        if (side === 1) {
            // Right side
            angle -= 15 * Math.PI / 180;
            
            const rightWing = {
                x: candidatePoint.x + length * Math.cos(angle),
                y: candidatePoint.y + length * Math.sin(angle)
            };
            
            const rightWing2 = {
                x: candidatePoint.x - length * Math.cos(angle),
                y: candidatePoint.y - length * Math.sin(angle)
            };
            
            path.push([rightWing.x, rightWing.y]);
            path.push([candidatePoint.x, candidatePoint.y]);
            path.push([rightWing2.x, rightWing2.y]);
            
        } else {
            // Left side
            angle += 15 * Math.PI / 180;
            
            const leftWing = {
                x: candidatePoint.x + length * Math.cos(angle),
                y: candidatePoint.y + length * Math.sin(angle)
            };
            
            const leftWing2 = {
                x: candidatePoint.x - length * Math.cos(angle),
                y: candidatePoint.y - length * Math.sin(angle)
            };
            
            path.push([leftWing.x, leftWing.y]);
            path.push([candidatePoint.x, candidatePoint.y]);
            path.push([leftWing2.x, leftWing2.y]);
        }
        
        return path;
    }

    /**
     * Calculate arrow flank length
     */
    private calculateArrowLength(midPt: Point, lastPt: Point, stPtCandidate: Point, endPtCandidate: Point): number {
        const mainLength = this.calculateDistance(midPt, lastPt);
        const crossLength = this.calculateDistance(stPtCandidate, endPtCandidate);
        return Math.min(mainLength * 0.2, crossLength * 0.3);
    }

    /**
     * Utility methods
     */

    private calculateDistance(pt1: Point | any, pt2: Point | any): number {
        const dx = pt2.x - pt1.x;
        const dy = pt2.y - pt1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }



    /**
     * Get baseline points
     */
    public getBaseLinePts(): { startPt?: Point; endPt?: Point } {
        return this._baseLinePts;
    }

    /**
     * Clean up drawing state and finalize
     */
    private cleanUp(): void {
        if (this._points.length === 0) return;

        const drawEssentials = this.createDrawEssentials(this._points.slice(), this._baseLinePts as { startPt: Point; endPt: Point });
        
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
        this.baselineDrawn = false;
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
                symbolType: "Breach",
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

export default Breach; 