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

export interface AmbushOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polyline;
    TEETH_SIZE?: number;
    TEETH_GAP?: number;
    [key: string]: any;
}

interface Circle {
    radius: number;
    center: {
        x: number;
        y: number;
    };
}

interface CircleSegmentResult {
    geometry: Polyline;
    lastPoint: Point;
    backPoint: Point;
}

/**
 * Ambush class for drawing Ambush symbols on MapView or SceneView
 * Supports both immediate placement and interactive drawing modes with curved sections and teeth
 */
export class Ambush {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;
    
    // Symbol properties
    private SID: string = "141700";
    private symName: string = "Ambush";
    private symGeometricType: string = "Area";
    private _lineSym: SimpleLineSymbol | null = null;
    private _points: Point[] = [];
    private _geometryType: string | null = null;
    private _teethSize: number = 2;
    private _teethGap: number = 5;
    private amplifier: Amplifier;
    
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
     * Initialize the ambush drawing
     */
    public init(options: AmbushOptions, marker: SimpleLineSymbol): void {
        this._lineSym = marker.clone();
        this._teethSize = 2;
        this._teethGap = 5;

        // Set configurable options
        this._teethSize = this.setDefault(options, "TEETH_SIZE", this._teethSize);
        this._teethGap = this.setDefault(options, "TEETH_GAP", this._teethGap);
        
        // Set up event handlers
        this.setupEventHandlers();

        const drawEssentials = new DrawEssentials();
        const baseLine = new BaseLine(this.view, this._lineSym);

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
            // Immediate placement with both control points and geometry
            if (options.GEOM && this.tempGraphic) {
                this.tempGraphic.geometry = options.GEOM;
            }
            
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.TEETH_SIZE, options.TEETH_GAP);
            if (this.tempGraphic && this.tempGraphic.geometry) {
                this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEss);
            }
            this._clear();

        } else if (options.hasOwnProperty("CTRL_PTS")) {
            // Immediate placement with control points only
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.TEETH_SIZE, options.TEETH_GAP);
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
        (drawEssentials as any).TEETH_GAP = this._teethGap;
        (drawEssentials as any).TEETH_SIZE = this._teethSize;

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
    private createDrawEssentials(ctrlPts: Point[], teethSize?: number, teethGap?: number): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.GEOM = null;
        drawEssentials.AMPLIFIER = this.amplifier.toString();
        
        // Store additional properties
        (drawEssentials as any).SCOPE = this;
        (drawEssentials as any).CTRL_PTS = ctrlPts;
        (drawEssentials as any).TEETH_SIZE = teethSize || this._teethSize;
        (drawEssentials as any).TEETH_GAP = teethGap || this._teethGap;

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

            const result = new Polyline({ spatialReference: this.view.spatialReference });
            
            const startingPt = pts[0];
            const endPt = pts[1];

            if (pts.length === 2) {
                // Simple line case
                result.addPath([[startingPt.x, startingPt.y], [endPt.x, endPt.y]]);
                
            } else if (pts.length === 3) {
                // Curved section with teeth
                const candidatePoint = pts[2];
                const circle = this._circleDrawEx(
                    this.view.toScreen(startingPt), 
                    this.view.toScreen(endPt), 
                    this.view.toScreen(candidatePoint)
                );
                
                if (circle.radius > 0) {
                    const values = this.CreateCircleSegmentFromThreePoints(
                        circle, 
                        this.view.toScreen(startingPt), 
                        this.view.toScreen(endPt), 
                        this.view.toScreen(candidatePoint), 
                        60, 
                        this.view
                    );
                    
                    if (values && values.geometry && values.geometry.paths[0]) {
                        const paths = values.geometry.paths[0];
                        result.addPath(paths.slice(0, 60));
                        
                        // Add teeth
                        this.addTeeth(result, drawEssentials);
                    }
                }
                
            } else if (pts.length > 3) {
                // Complex path with curved section, additional points, and arrow
                const candidatePoint = pts[2];
                const lastPt = pts[pts.length - 1];
                const secLastPt = pts[pts.length - 2];
                
                // Create curved section
                const circle = this._circleDrawEx(
                    this.view.toScreen(startingPt), 
                    this.view.toScreen(endPt), 
                    this.view.toScreen(candidatePoint)
                );
                
                if (circle.radius > 0) {
                    const values = this.CreateCircleSegmentFromThreePoints(
                        circle, 
                        this.view.toScreen(startingPt), 
                        this.view.toScreen(endPt), 
                        this.view.toScreen(candidatePoint), 
                        60, 
                        this.view
                    );
                    
                    if (values && values.geometry && values.geometry.paths[0]) {
                        const paths = values.geometry.paths[0];
                        result.addPath(paths.slice(0, 60));
                        
                        // Add connection path through intermediate points
                        const connectionPath: number[][] = [];
                        const centerPt = result.getExtent()?.getCenter();
                        if (centerPt) {
                            connectionPath.push([centerPt.x, centerPt.y]);
                        }
                        
                        // Add intermediate points
                        for (let i = 3; i < pts.length - 1; i++) {
                            connectionPath.push([pts[i].x, pts[i].y]);
                        }
                        connectionPath.push([lastPt.x, lastPt.y]);
                        
                        result.addPath(connectionPath);
                        
                        // Add teeth
                        this.addTeeth(result, drawEssentials);
                        
                        // Add arrow head
                        const arrowHead = this.createArrowHead(secLastPt, lastPt);
                        if (arrowHead && arrowHead.length > 0) {
                            result.addPath(arrowHead);
                        }
                    }
                }
            }

            return result;
            
        } catch (e) {
            console.log(this.constructor.name + ' Cannot create Symbol due to invalid geometry');
            return null;
        }
    }

    /**
     * Add teeth to the curved section
     */
    private addTeeth(polyline: Polyline, drawEssentials: DrawEssentials): void {
        try {
            const centerPt = polyline.getExtent()?.getCenter();
            if (!centerPt) return;

            // Get the first path for teeth calculation
            const firstPath = polyline.paths[0];
            if (!firstPath || firstPath.length < 30) return;

            const endPt = new Point({ x: firstPath[firstPath.length - 1][0], y: firstPath[firstPath.length - 1][1], spatialReference: this.view.spatialReference });
            const midPt = new Point({ x: firstPath[30][0], y: firstPath[30][1], spatialReference: this.view.spatialReference });
            
            const length = this.calculateDistance(endPt, midPt) / 10;
            const teethSize = length * this.setDefault(drawEssentials, "TEETH_SIZE", this._teethSize);
            const angle = this.calculateAngle(centerPt, midPt);
            const teethGap = this.setDefault(drawEssentials, "TEETH_GAP", this._teethGap);
            
            for (let i = teethGap; i < 60; i += teethGap) {
                if (firstPath[i]) {
                    const teethPath = this.createTeeth(
                        new Point({ x: firstPath[i][0], y: firstPath[i][1], spatialReference: this.view.spatialReference }), 
                        angle, 
                        teethSize
                    );
                    polyline.addPath(teethPath);
                }
            }
        } catch (e) {
            console.log('Error adding teeth:', e);
        }
    }

    /**
     * Create arrow head geometry
     */
    private createArrowHead(secLastPt: Point, lastPt: Point): number[][] | null {
        try {
            // Use Shapes utility if available
            if (Shapes && (Shapes as any).arrowHead) {
                const flanksLen = this.calculateArrowFlanksLength(
                    this.calculateDistance(secLastPt, lastPt),
                    this.calculateDistance(secLastPt, lastPt)
                );
                const angle = this.calculateAngle(secLastPt, lastPt);
                return (Shapes as any).arrowHead(lastPt, flanksLen, angle);
            }
            
            // Fallback arrow head creation
            return this.createSimpleArrowHead(secLastPt, lastPt);
            
        } catch (e) {
            console.log('Error creating arrow head, using fallback');
            return this.createSimpleArrowHead(secLastPt, lastPt);
        }
    }

    /**
     * Create simple arrow head as fallback
     */
    private createSimpleArrowHead(secLastPt: Point, lastPt: Point): number[][] {
        const length = this.calculateDistance(secLastPt, lastPt) * 0.3;
        const angle = this.calculateAngle(secLastPt, lastPt);
        const arrowAngle = Math.PI / 6; // 30 degrees
        
        const leftPoint = [
            lastPt.x - length * Math.cos(angle - arrowAngle),
            lastPt.y - length * Math.sin(angle - arrowAngle)
        ];
        
        const rightPoint = [
            lastPt.x - length * Math.cos(angle + arrowAngle),
            lastPt.y - length * Math.sin(angle + arrowAngle)
        ];
        
        return [
            [leftPoint[0], leftPoint[1]],
            [lastPt.x, lastPt.y],
            [rightPoint[0], rightPoint[1]]
        ];
    }

    /**
     * Create teeth geometry
     */
    private createTeeth(startPt: Point, angle: number, teethSize: number): number[][] {
        const midPtTwrdsCntr = new Point({
            x: -1 * teethSize * Math.cos(angle) + startPt.x,
            y: -1 * teethSize * Math.sin(angle) + startPt.y,
            spatialReference: this.view.spatialReference
        });
        
        return [[startPt.x, startPt.y], [midPtTwrdsCntr.x, midPtTwrdsCntr.y]];
    }

    /**
     * Circle calculation from three points
     */
    private _circleDrawEx(pt1: any, pt2: any, pt3: any): Circle {
        const a = [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0]
        ];
        const P = [
            [pt1.x, pt1.y],
            [pt2.x, pt2.y],
            [pt3.x, pt3.y]
        ];

        // Calculate determinants
        for (let i = 0; i < 3; i++) {
            a[i][0] = P[i][0];
            a[i][1] = P[i][1];
            a[i][2] = 1;
        }
        const m11 = this._determinantDrawEx(a, 3);

        for (let i = 0; i < 3; i++) {
            a[i][0] = P[i][0] * P[i][0] + P[i][1] * P[i][1];
            a[i][1] = P[i][1];
            a[i][2] = 1;
        }
        const m12 = this._determinantDrawEx(a, 3);

        for (let i = 0; i < 3; i++) {
            a[i][0] = P[i][0] * P[i][0] + P[i][1] * P[i][1];
            a[i][1] = P[i][0];
            a[i][2] = 1;
        }
        const m13 = this._determinantDrawEx(a, 3);

        for (let i = 0; i < 3; i++) {
            a[i][0] = P[i][0] * P[i][0] + P[i][1] * P[i][1];
            a[i][1] = P[i][0];
            a[i][2] = P[i][1];
        }
        const m14 = this._determinantDrawEx(a, 3);

        let r: number;
        let Xo: number = 0;
        let Yo: number = 0;

        if (m11 === 0) {
            r = 0;
        } else {
            Xo = 0.5 * m12 / m11;
            Yo = -0.5 * m13 / m11;
            r = Math.sqrt(Xo * Xo + Yo * Yo + m14 / m11);
        }

        return {
            radius: r,
            center: { x: Xo, y: Yo }
        };
    }

    /**
     * Calculate determinant
     */
    private _determinantDrawEx(a: number[][], n: number): number {
        const m = [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0]
        ];

        if (n === 2) {
            return a[0][0] * a[1][1] - a[1][0] * a[0][1];
        } else {
            let d = 0;
            for (let j1 = 0; j1 < n; j1++) {
                for (let i = 1; i < n; i++) {
                    let j2 = 0;
                    for (let j = 0; j < n; j++) {
                        if (j === j1) continue;
                        m[i - 1][j2] = a[i][j];
                        j2++;
                    }
                }
                d = d + Math.pow(-1.0, j1) * a[0][j1] * this._determinantDrawEx(m, n - 1);
            }
            return d;
        }
    }

    /**
     * Create circle segment from three points
     */
    private CreateCircleSegmentFromThreePoints(circle: Circle, pt1: any, pt2: any, pt3: any, numberOfPts: number, view: MapView | SceneView): CircleSegmentResult | null {
        try {
            const center = circle.center;
            const radius = circle.radius;
            const path: Point[] = [];

            // Adjust points relative to center
            pt1.x -= center.x;
            pt1.y -= center.y;
            pt2.x -= center.x;
            pt2.y -= center.y;
            pt3.x -= center.x;
            pt3.y -= center.y;

            // Calculate angles
            let anglePt1 = Math.atan2(pt1.y, pt1.x);
            let anglePt2 = Math.atan2(pt2.y, pt2.x);
            let anglePt3 = Math.atan2(pt3.y, pt3.x);

            anglePt1 = anglePt1 < 0 ? 2 * Math.PI + anglePt1 : anglePt1;
            anglePt2 = anglePt2 < 0 ? 2 * Math.PI + anglePt2 : anglePt2;
            anglePt3 = anglePt3 < 0 ? 2 * Math.PI + anglePt3 : anglePt3;

            const startAngle = Math.min(anglePt1, anglePt2);
            const endAngle = Math.max(anglePt1, anglePt2);
            let swipeAngle = endAngle - startAngle;

            if (anglePt3 < startAngle || anglePt3 > endAngle) {
                swipeAngle -= (2 * Math.PI);
            }

            const angle = swipeAngle / numberOfPts;

            for (let i = 0; i <= numberOfPts; i++) {
                const screenPt = {
                    x: radius * Math.cos(startAngle + i * angle) + center.x,
                    y: radius * Math.sin(startAngle + i * angle) + center.y
                };
                
                const mapPt = view.toMap(screenPt);
                if (mapPt) {
                    path.push(new Point({
                        x: mapPt.x,
                        y: mapPt.y,
                        spatialReference: view.spatialReference
                    }));
                }
            }

            const result = new Polyline({ spatialReference: view.spatialReference });
            result.addPath(path.map(pt => [pt.x, pt.y]));

            return {
                geometry: result,
                lastPoint: path[numberOfPts],
                backPoint: path[numberOfPts - 5]
            };
            
        } catch (e) {
            console.log('Error creating circle segment:', e);
            return null;
        }
    }

    /**
     * Utility methods
     */
    private calculateDistance(pt1: Point, pt2: Point): number {
        const dx = pt2.x - pt1.x;
        const dy = pt2.y - pt1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    private calculateAngle(fromPt: Point, toPt: Point): number {
        const dx = toPt.x - fromPt.x;
        const dy = toPt.y - fromPt.y;
        return Math.atan2(dy, dx);
    }

    private calculateArrowFlanksLength(segmentLength: number, totalLength: number): number {
        // Use GeoTools if available
        if (GeoTools && (GeoTools as any).ArrowFlanksLen) {
            try {
                return (GeoTools as any).ArrowFlanksLen(segmentLength, totalLength);
            } catch (e) {
                // Fallback calculation
            }
        }
        
        // Simple fallback calculation
        return Math.min(segmentLength * 0.3, totalLength * 0.2);
    }

    private setDefault(options: any, key: string, defaultValue: any): any {
        if (GeoTools && (GeoTools as any).setDefault) {
            try {
                return (GeoTools as any).setDefault(options, key, defaultValue);
            } catch (e) {
                // Fallback
            }
        }
        
        // Fallback implementation
        return options && options.hasOwnProperty(key) ? options[key] : defaultValue;
    }

    /**
     * Clean up drawing state and finalize
     */
    private cleanUp(): void {
        if (this._points.length === 0) return;

        const drawEssentials = this.createDrawEssentials(this._points.slice(), this._teethSize, this._teethGap);
        
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
                symbolType: "Ambush",
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

export default Ambush; 