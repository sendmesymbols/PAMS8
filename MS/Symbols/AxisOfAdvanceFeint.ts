import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
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

export interface AxisOfAdvanceFeintOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    HEAD_RATIO?: number;
    TAIL_FACTOR?: number;
    [key: string]: any;
}

interface ArrowHeadResult {
    rings: any[];
    newLeftOuterPt: any;
    newCandidatePt: any;
    newRightOuterPt: any;
}

/**
 * AxisOfAdvanceFeint class for drawing Axis of Advance for Feint arrows
 * Creates complex arrow shapes with feint lines in front of the arrow head
 * Similar to AvenueOfApchs but with additional visual elements for deception
 */
export class AxisOfAdvanceFeint {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;
    
    // Symbol properties
    private SID: string = "151406";
    private symName: string = "Axis Of Advance For Feint";
    private symGeometricType: string = "Area";
    private _lineSym: SimpleLineSymbol | null = null;
    private _points: Point[] = [];
    private _geometryType: string | null = null;
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
     * Initialize the axis of advance feint drawing
     */
    public init(options: AxisOfAdvanceFeintOptions, marker: SimpleLineSymbol): void {
        this._lineSym = marker.clone();

        // Set arrow parameters with defaults
        this._headPercentage = this.setDefault(options, "HEAD_RATIO", this._headPercentage);
        this._tailFactor = this.setDefault(options, "TAIL_FACTOR", this._tailFactor);
        
        // Set up event handlers
        this.setupEventHandlers();

        const drawEssentials = new DrawEssentials();

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
            // Immediate placement with both control points and geometry
            if (options.GEOM && this.tempGraphic) {
                this.tempGraphic.geometry = options.GEOM;
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
     * Utility method to set default values
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

            if (pts.length <= 2) {
                return this.createSimpleFeintArrow(pts);
            } else {
                return this.createComplexFeintArrow(pts);
            }
            
        } catch (e) {
            console.log(this.constructor.name + ' Cannot create Symbol due to invalid geometry');
            return null;
        }
    }

    /**
     * Create simple feint arrow for 2 or fewer points
     */
    private createSimpleFeintArrow(pts: Point[]): Polygon {
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

        const result = new Polygon({ spatialReference: this.view.spatialReference });
        let ring: number[][] = [];
        
        ring.push([pt1.x, pt1.y]);
        
        // Get arrow head with feint line information
        const values = this.CreateArrowHeadPathEx(p1, lastPoint, p2, len, this._headPercentage, 15);
        ring = ring.concat(values.rings.map((pt: any) => [pt.x, pt.y]));
        
        ring.push([p2.x, p2.y]);
        result.addRing(ring);

        // Add feint lines in front of arrow
        this.addFeintLines(result, values);

        return result;
    }

    /**
     * Create complex feint arrow for more than 2 points
     */
    private createComplexFeintArrow(pts: Point[]): Polygon {
        const result = new Polygon({ spatialReference: this.view.spatialReference });
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
        let leftBezier = this.CreateBezierPathPCOnly(leftArray, 70);
        let rightBezier = this.CreateBezierPathPCOnly(rightArray, 70);

        // Splice for arrow head
        leftBezier.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);
        rightBezier.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);

        const values = this.CreateArrowHeadPathEx(
            leftBezier[leftBezier.length - 1],
            lastPoint,
            rightBezier[rightBezier.length - 1],
            totalL,
            this._headPercentage,
            15
        );

        // Combine all paths
        let ring: number[][] = [];
        ring = ring.concat(leftBezier.map(pt => [pt.x, pt.y]));
        ring = ring.concat(values.rings.map((pt: any) => [pt.x, pt.y]));
        ring = ring.concat(rightBezier.reverse().map(pt => [pt.x, pt.y]));

        result.addRing(ring);

        // Add feint lines
        this.addFeintLines(result, values);

        return result;
    }

    /**
     * Add feint lines in front of the arrow head
     */
    private addFeintLines(result: Polygon, values: ArrowHeadResult): void {
        try {
            // Create feint lines using fracture points
            const leftFeintLine = this.fracturePts(values.newLeftOuterPt, values.newCandidatePt, 10);
            if (leftFeintLine && leftFeintLine.paths) {
                this.addAllRings(leftFeintLine.paths, result);
            }

            const rightFeintLine = this.fracturePts(values.newRightOuterPt, values.newCandidatePt, 10);
            if (rightFeintLine && rightFeintLine.paths) {
                this.addAllRings(rightFeintLine.paths, result);
            }
        } catch (e) {
            console.log('Error adding feint lines:', e);
        }
    }

    /**
     * Create fracture points between two points
     */
    private fracturePts(pt1: any, pt2: any, segments: number): { paths: number[][][] } | null {
        if (!pt1 || !pt2) return null;

        const dx = pt2.x - pt1.x;
        const dy = pt2.y - pt1.y;
        const path: number[][] = [];

        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            path.push([
                pt1.x + t * dx,
                pt1.y + t * dy
            ]);
        }

        return {
            paths: [path]
        };
    }

    /**
     * Add all rings/paths to the result polygon
     */
    private addAllRings(paths: number[][][], result: Polygon): void {
        if (paths && Array.isArray(paths)) {
            for (const path of paths) {
                if (path && Array.isArray(path) && path.length > 1) {
                    result.addRing(path);
                }
            }
        }
    }

    /**
     * Create arrow head path with feint line positions
     */
    private CreateArrowHeadPathEx(pt1: any, candidatePt: Point, pt2: any, totalLen: number, headPercentage: number, headAngle: number, straight?: boolean): ArrowHeadResult {
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

        const leftInnerPt = { 
            x: candidatePt.x + result * Math.cos(angle1), 
            y: candidatePt.y + result * Math.sin(angle1) 
        };
        const leftOuterPt = { 
            x: candidatePt.x + headSideLen * Math.cos(angle1 - (headAngle / 180) * Math.PI), 
            y: candidatePt.y + headSideLen * Math.sin(angle1 - (headAngle / 180) * Math.PI) 
        };

        const rightInnerPt = { 
            x: candidatePt.x + result * Math.cos(angle2), 
            y: candidatePt.y + result * Math.sin(angle2) 
        };
        const rightOuterPt = { 
            x: candidatePt.x + headSideLen * Math.cos(angle2 + (headAngle / 180) * Math.PI), 
            y: candidatePt.y + headSideLen * Math.sin(angle2 + (headAngle / 180) * Math.PI) 
        };

        const ring = [];
        ring.push(leftInnerPt);
        ring.push(leftOuterPt);
        ring.push(candidatePt);
        ring.push(rightOuterPt);
        ring.push(rightInnerPt);

        // Calculate feint line positions
        const midPt = this.getMidPoint(pt1, pt2);
        const angle = this.twoPtsAngle(midPt, candidatePt);

        const newCandidatePt = { 
            x: candidatePt.x + (headSideLen / 5) * Math.cos(angle), 
            y: candidatePt.y + (headSideLen / 5) * Math.sin(angle) 
        };
        const newLeftOuterPt = { 
            x: leftOuterPt.x + (headSideLen / 5) * Math.cos(angle), 
            y: leftOuterPt.y + (headSideLen / 5) * Math.sin(angle) 
        };
        const newRightOuterPt = { 
            x: rightOuterPt.x + (headSideLen / 5) * Math.cos(angle), 
            y: rightOuterPt.y + (headSideLen / 5) * Math.sin(angle) 
        };

        return { 
            rings: ring, 
            newLeftOuterPt: newLeftOuterPt, 
            newCandidatePt: newCandidatePt, 
            newRightOuterPt: newRightOuterPt 
        };
    }

    /**
     * Get midpoint between two points
     */
    private getMidPoint(pt1: any, pt2: any): any {
        return {
            x: (pt1.x + pt2.x) / 2,
            y: (pt1.y + pt2.y) / 2
        };
    }

    /**
     * Create Bezier path for point collection only (fallback)
     */
    private CreateBezierPathPCOnly(pointCollection: any[], numberOfPts: number): any[] {
        if (pointCollection.length < 2) {
            return pointCollection;
        }

        const path: any[] = [];
        
        for (let i = 0; i <= numberOfPts; i++) {
            const t = i / numberOfPts;
            const segmentLength = 1 / (pointCollection.length - 1);
            const segmentIndex = Math.floor(t / segmentLength);
            const localT = (t - segmentIndex * segmentLength) / segmentLength;
            
            const startIdx = Math.min(segmentIndex, pointCollection.length - 2);
            const endIdx = startIdx + 1;
            
            if (pointCollection[startIdx] && pointCollection[endIdx]) {
                const x = pointCollection[startIdx].x + localT * (pointCollection[endIdx].x - pointCollection[startIdx].x);
                const y = pointCollection[startIdx].y + localT * (pointCollection[endIdx].y - pointCollection[startIdx].y);
                path.push({ x, y });
            }
        }
        
        return path;
    }

    /**
     * Calculate angle between two points relative to a candidate point
     */
    private twoPtsAngle(candidatePt: any, pt: any): number {
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
        
        this.emitGlobalEvent(eventName, data);
    }

    private emitGlobalEvent(eventName: string, data: any): void {
        const customEvent = new CustomEvent(eventName, {
            detail: {
                symbolType: "AxisOfAdvanceFeint",
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

export default AxisOfAdvanceFeint; 