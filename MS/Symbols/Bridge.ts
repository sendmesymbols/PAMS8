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

import SymbolEvents from "../Support/SymbolEvents";
export interface BridgeOptions {
    CTRL_PTS?: Point[];
    BASE_LN_PTS?: { startPt: Point; endPt: Point };
    GEOM?: Polyline;
    TAIL_FACTOR?: number;
    FLAP_ANGLE?: number;
    [key: string]: any;
}

/**
 * Bridge class for drawing Bridge - Gap symbols
 * Requires baseline drawing followed by bridge gap points
 * Creates notched lines and flaps to represent bridge gaps
 */
export class Bridge {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;
    
    // Symbol properties
    private SID: string = "271100";
    private symName: string = "Bridge - Gap";
    private symGeometricType: string = "Line";
    private _lineSym: SimpleLineSymbol | null = null;
    private _points: Point[] = [];
    private _baseLinePts: { startPt?: Point; endPt?: Point } = {};
    private _geometryType: string | null = null;
    private amplifier: Amplifier;
    private _tailFactor: number = 0.17;
    private _flap_angle: number = 45;
    
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
    private events: SymbolEvents;

    constructor(view: MapView | SceneView, isLine: boolean = false) {
        this.view = view;
        this.isLine = isLine;
        this.layerManager = GraphicsLayerManager.getInstance(view);
        this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.TACT);
        this.amplifier = new Amplifier();
        this.events = new SymbolEvents(view, "Bridge");
        
        // Initialize layers if not already done
        this.layerManager.initializeLayers();
        
        // Initialize temporary graphic
        this.tempGraphic = new Graphic();
    }

    /**
     * Initialize the bridge drawing
     */
    public init(options: BridgeOptions, marker: SimpleLineSymbol): void {
        this._lineSym = marker.clone();
        this._tailFactor = (GeoTools as any).setDefault ? (GeoTools as any).setDefault(options, "TAIL_FACTOR", this._tailFactor) : (options.TAIL_FACTOR || this._tailFactor);
        this._flap_angle = (GeoTools as any).setDefault ? (GeoTools as any).setDefault(options, "FLAP_ANGLE", this._flap_angle) : (options.FLAP_ANGLE || this._flap_angle);
        
        const drawEssentials = new DrawEssentials();

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("BASE_LN_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
            // Immediate placement with both control points and geometry
            if (options.GEOM && this.tempGraphic) {
                try {
                    this.tempGraphic.geometry = new Polyline({
                        paths: options.GEOM,
                        spatialReference: this.view.spatialReference
                    });
                } catch (error) {
                    console.error(this.symName, "Failed to create Polyline geometry:", error);
                }
            }
            
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.BASE_LN_PTS!, this._tailFactor, this._flap_angle);
            if (this.tempGraphic && this.tempGraphic.geometry) {
                this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEss);
            }
            this._clear();

        } else if (options.hasOwnProperty("CTRL_PTS")) {
            if (options.hasOwnProperty("BASE_LN_PTS")) {
                const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.BASE_LN_PTS!, this._tailFactor, this._flap_angle);
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

        baseLine.init();
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
        
        // Set up handlers for bridge gap direction
        this.mouseMoveHandler = this.view.on("pointer-move", (event) => {
            this._onMouseMoveHandler(event);
        });
        this.clickHandler = this.view.on("click", (event) => {
            this._onClickHandler(event);
        });
        this.doubleClickHandler = this.view.on("double-click", (event) => {
            this._onDoubleClickHandler(event);
        });
        
        this.events.emit("onBaseLineDrawEnd", { currentPts: evt.geometry.controlPoints });
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
        this.events.emit("onDrawClick", { currentPts: this._points });
        
        if (this.isLine === true && this._points.length === 1) {
            this.events.emit("onDrawClick", { currentPts: this._points });
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
    private createDrawEssentials(ctrlPts: Point[], baseLinePts: { startPt: Point; endPt: Point }, tailFactor: number, flagAngle: number): DrawEssentials {
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
        (drawEssentials as any).TAIL_FACTOR = tailFactor;
        (drawEssentials as any).FLAP_ANGLE = flagAngle;

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
            const stPt = baseLinePts.startPt;
            const endPt = baseLinePts.endPt;

            if (!stPt || !endPt) {
                throw new Error("Start and End Point required for baseline");
            }

            const firstPoint = pts[0];
            const lastPoint = pts[pts.length - 1];
            const leftArray: Point[] = [];
            const rightArray: Point[] = [];

            const midPt = this.getMidPoint(stPt, endPt);
            const result = new Polyline({ spatialReference: this.view.spatialReference });

            // Determine direction based on first control point
            let currentLastPoint = firstPoint;
            if (pts.length >= 1) {
                currentLastPoint = firstPoint;
            }

            const len = this.calculateDistance(midPt, endPt);
            let k = Math.atan((midPt.y - currentLastPoint.y) / (midPt.x - currentLastPoint.x));

            // Adjust angle based on relationship
            const relationship = this.twoPtsRelationShip(midPt, currentLastPoint);
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

            const partialLen = len;
            const p1 = { x: partialLen * Math.cos(k) + midPt.x, y: partialLen * Math.sin(k) + midPt.y };
            const p2 = { x: -1 * partialLen * Math.cos(k) + midPt.x, y: -1 * partialLen * Math.sin(k) + midPt.y };

            // Build bridge gap structure
            if (pts.length >= 1) {
                leftArray.push(new Point({ x: p1.x, y: p1.y, spatialReference: this.view.spatialReference }));
                rightArray.push(new Point({ x: p2.x, y: p2.y, spatialReference: this.view.spatialReference }));
            }

            // Create bridge gap projection lines with shortened segments
            for (let i = 0; i < pts.length; i++) {
                const length = this.calculateDistance(midPt, pts[i]);
                const angle = this.calculateAngle(midPt, pts[i]);

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

                // Shorten Left Array Point - move it back toward the baseline
                const shortenLeftPt = {
                    x: stPtCandidatePt.x - (length / 9) * Math.cos(angle),
                    y: stPtCandidatePt.y - (length / 9) * Math.sin(angle)
                };
                leftArray.push(new Point({ x: shortenLeftPt.x, y: shortenLeftPt.y, spatialReference: this.view.spatialReference }));

                // Shorten Right Array Point - move it back toward the baseline
                const shortenRightPt = {
                    x: endPtCandidatePt.x - (length / 9) * Math.cos(angle),
                    y: endPtCandidatePt.y - (length / 9) * Math.sin(angle)
                };
                rightArray.push(new Point({ x: shortenRightPt.x, y: shortenRightPt.y, spatialReference: this.view.spatialReference }));

                // Add the shortened points again to create the gap pattern
                leftArray.push(new Point({ x: shortenLeftPt.x, y: shortenLeftPt.y, spatialReference: this.view.spatialReference }));
                rightArray.push(new Point({ x: shortenRightPt.x, y: shortenRightPt.y, spatialReference: this.view.spatialReference }));
            }

            // Add paths for left and right sides
            result.addPath(leftArray.map(pt => [pt.x, pt.y]));
            result.addPath(rightArray.map(pt => [pt.x, pt.y]));

            // Add bridge flaps/notches at appropriate points
            if (leftArray.length > 1 && rightArray.length > 1) {
                const shortenLeftPt = leftArray[leftArray.length - 1];
                const shortenRightPt = rightArray[rightArray.length - 1];

                // Back Flaps (from baseline toward gap)
                const backLeftFlap = this.createStNotches(
                    new Point({ x: p1.x, y: p1.y, spatialReference: this.view.spatialReference }),
                    shortenLeftPt,
                    this._tailFactor,
                    this._flap_angle,
                    0
                );
                const backFlapPath = [
                    [backLeftFlap.x, backLeftFlap.y],
                    [p1.x, p1.y]
                ];
                result.addPath(backFlapPath);

                const backRightFlap = this.createStNotches(
                    new Point({ x: p2.x, y: p2.y, spatialReference: this.view.spatialReference }),
                    shortenRightPt,
                    this._tailFactor,
                    this._flap_angle,
                    1
                );
                const backRightFlapPath = [
                    [backRightFlap.x, backRightFlap.y],
                    [p2.x, p2.y]
                ];
                result.addPath(backRightFlapPath);

                // Front Flaps (from gap toward baseline)
                const frontLeftFlap = this.createStNotches(
                    shortenLeftPt,
                    new Point({ x: p1.x, y: p1.y, spatialReference: this.view.spatialReference }),
                    this._tailFactor,
                    this._flap_angle,
                    1
                );
                const frontLeftFlapPath = [
                    [frontLeftFlap.x, frontLeftFlap.y],
                    [shortenLeftPt.x, shortenLeftPt.y]
                ];
                result.addPath(frontLeftFlapPath);

                const frontRightFlap = this.createStNotches(
                    shortenRightPt,
                    new Point({ x: p2.x, y: p2.y, spatialReference: this.view.spatialReference }),
                    this._tailFactor,
                    this._flap_angle,
                    0
                );
                const frontRightFlapPath = [
                    [frontRightFlap.x, frontRightFlap.y],
                    [shortenRightPt.x, shortenRightPt.y]
                ];
                result.addPath(frontRightFlapPath);
            }

            return result;
            
        } catch (e) {
            console.log(this.constructor.name + ' Cannot create Symbol due to invalid geometry');
            return null;
        }
    }

    /**
     * Create notch/flap at specified position
     */
    private createStNotches(firstPoint: Point, lastPoint: Point, tailFactor: number, angle: number, inner: number): { x: number; y: number } {
        const len = this.calculateDistance(firstPoint, lastPoint);
        let k = Math.atan((firstPoint.y - lastPoint.y) / (firstPoint.x - lastPoint.x));
        
        // Adjust angle based on relationship
        const relationship = this.twoPtsRelationShip(firstPoint, lastPoint);
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
        
        let pt1: { x: number; y: number };
        
        if (inner === 0) {
            k += this.toRad(angle);
            pt1 = {
                x: tailFactor * len * Math.cos(k) + firstPoint.x,
                y: tailFactor * len * Math.sin(k) + firstPoint.y
            };
        } else {
            k -= this.toRad(angle);
            pt1 = {
                x: -1 * tailFactor * len * Math.cos(k) + firstPoint.x,
                y: -1 * tailFactor * len * Math.sin(k) + firstPoint.y
            };
        }
        
        return pt1;
    }

    /**
     * Convert degrees to radians
     */
    private toRad(degrees: number): number {
        return degrees * Math.PI / 180;
    }

    /**
     * Get baseline points
     */
    public getBaseLinePts(): { startPt?: Point; endPt?: Point } {
        return this._baseLinePts;
    }

    /**
     * Utility methods
     */
    private getMidPoint(pt1: Point, pt2: Point): Point {
        return new Point({
            x: (pt1.x + pt2.x) / 2,
            y: (pt1.y + pt2.y) / 2,
            spatialReference: this.view.spatialReference
        });
    }

    private calculateDistance(pt1: Point | any, pt2: Point | any): number {
        const dx = pt2.x - pt1.x;
        const dy = pt2.y - pt1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    private calculateAngle(pt1: Point | any, pt2: Point | any): number {
        return Math.atan2(pt2.y - pt1.y, pt2.x - pt1.x);
    }

    private twoPtsRelationShip(pt1: Point, pt2: Point): string {
        if (pt2.x >= pt1.x && pt2.y >= pt1.y) return "ne";
        if (pt2.x < pt1.x && pt2.y >= pt1.y) return "nw";
        if (pt2.x < pt1.x && pt2.y < pt1.y) return "sw";
        return "se";
    }

    /**
     * Clean up drawing state and finalize
     */
    private cleanUp(): void {
        if (this._points.length === 0) return;

        const drawEssentials = this.createDrawEssentials(this._points.slice(), this._baseLinePts as { startPt: Point; endPt: Point }, this._tailFactor, this._flap_angle);
        
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

    public on(eventName: string, callback: (data: any) => void): void {
        this.events.on(eventName, callback);
    }

    public off(eventName: string, callback?: (data: any) => void): void {
        this.events.off(eventName, callback);
    }


    public getSymbolLayer(): GraphicsLayer {
        return this.symbolLayer;
    }

    public clearSymbols(): void {
        this.symbolLayer.removeAll();
    }
}

export default Bridge; 