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

export interface FreehandSemiCircleOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    [key: string]: any;
}

export interface CircleResult {
    radius: number;
    center: { x: number, y: number };
}

export interface CircleSegmentResult {
    geometry: Polygon;
    lastPoint: Point;
    backPoint: Point;
}

/**
 * FreehandSemiCircle class for drawing Freehand Semi Circle symbols on MapView or SceneView
 * Creates semi-circles from three points with circle calculations
 */
export class FreehandSemiCircle {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;
    
    // Symbol properties
    private SID: string = "000130";
    private symName: string = "Freehand - Semi Circle";
    private symGeometricType: string = "Area";
    private _lineSym: SimpleLineSymbol | SimpleFillSymbol | null = null;
    private _points: Point[] = [];
    private _geometryType: string | null = null;
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
     * Initialize the freehand semi circle drawing
     */
    public init(options: FreehandSemiCircleOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void {
        this._lineSym = marker;

        const drawEssentials = new DrawEssentials();

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
            
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice());
            
            if (this.tempGraphic && this.tempGraphic.geometry) {
                this.__drawEnd(this.tempGraphic.geometry as Polygon, drawEss);
            }
            this._clear();

        } else if (options.hasOwnProperty("CTRL_PTS")) {
            // Immediate placement with control points only
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice());
            
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

        // Semi-circle requires 3 points, so finish after 3rd click
        if (this._points.length === 3) {
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
    private createDrawEssentials(ctrlPts: Point[]): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.AMPLIFIER = this.amplifier.toString();
        
        // Store additional properties
        (drawEssentials as any).SCOPE = this;
        (drawEssentials as any).CTRL_PTS = ctrlPts;
        (drawEssentials as any).ISFHAND = 1; // Mark as freehand

        return drawEssentials;
    }

    /**
     * Create symbol geometry from DrawEssentials
     */
    private createSymbol(drawEssentials: DrawEssentials): Polygon | null {
        try {
            let controlPoints: Point[];

            if ((drawEssentials as any).CTRL_PTS) {
                controlPoints = (drawEssentials as any).CTRL_PTS as Point[];
            } else {
                throw new Error("controlPoints not found");
            }

            // Always create a polygon geometry (temp preview will still render with line symbol)
            const polygon = new Polygon({ spatialReference: this.view.spatialReference });

            if (controlPoints.length < 2) {
                return polygon; // empty polygon for insufficient points
            }

            const startingPt = controlPoints[0];
            const endPt = controlPoints[1];

            // For two points, return a minimally closed ring so 4.x accepts the polygon
            if (controlPoints.length === 2) {
                polygon.addRing([
                    [startingPt.x, startingPt.y],
                    [endPt.x, endPt.y],
                    [startingPt.x, startingPt.y]
                ]);
                return polygon;
            }

            // For three or more points, compute the semicircle through the three points
            const candidatePoint = controlPoints[2];

            const startScreen = this.view.toScreen(startingPt);
            const endScreen = this.view.toScreen(endPt);
            const candidateScreen = this.view.toScreen(candidatePoint);

            const circle = this._circleDrawEx(startScreen, endScreen, candidateScreen);
            if (circle.radius <= 0) {
                // Fallback: just make a thin triangle from the three points to avoid crash
                polygon.addRing([
                    [startingPt.x, startingPt.y],
                    [endPt.x, endPt.y],
                    [candidatePoint.x, candidatePoint.y],
                    [startingPt.x, startingPt.y]
                ]);
                return polygon;
            }

            const values = this.CreateCircleSegmentFromThreePoints(
                circle,
                startScreen,
                endScreen,
                candidateScreen,
                60
            );

            // values.geometry already contains a polygon ring with map coordinates
            // Use it directly to avoid misinterpreting ring coordinate structures
            return values.geometry;

        } catch (e) {
            console.log(this.constructor.name + ' Cannot create Symbol due to invalid geometry');
            return null;
        }
    }

    /**
     * Calculate circle from three points
     */
    private _circleDrawEx(pt1: any, pt2: any, pt3: any): CircleResult {
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

        // Find minor 11
        for (let i = 0; i < 3; i++) {
            a[i][0] = P[i][0];
            a[i][1] = P[i][1];
            a[i][2] = 1;
        }
        const m11 = this._determinantDrawEx(a, 3);

        // Find minor 12
        for (let i = 0; i < 3; i++) {
            a[i][0] = P[i][0] * P[i][0] + P[i][1] * P[i][1];
            a[i][1] = P[i][1];
            a[i][2] = 1;
        }
        const m12 = this._determinantDrawEx(a, 3);

        // Find minor 13
        for (let i = 0; i < 3; i++) {
            a[i][0] = P[i][0] * P[i][0] + P[i][1] * P[i][1];
            a[i][1] = P[i][0];
            a[i][2] = 1;
        }
        const m13 = this._determinantDrawEx(a, 3);

        // Find minor 14
        for (let i = 0; i < 3; i++) {
            a[i][0] = P[i][0] * P[i][0] + P[i][1] * P[i][1];
            a[i][1] = P[i][0];
            a[i][2] = P[i][1];
        }
        const m14 = this._determinantDrawEx(a, 3);

        let r = 0;
        let Xo = 0;
        let Yo = 0;

        if (m11 !== 0) {
            Xo = 0.5 * m12 / m11;
            Yo = -0.5 * m13 / m11;
            r = Math.sqrt(Xo * Xo + Yo * Yo + m14 / m11);
        }

        return { radius: r, center: { x: Xo, y: Yo } };
    }

    /**
     * Recursive determinant calculation
     */
    private _determinantDrawEx(a: number[][], n: number): number {
        const m = [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0]
        ];

        if (n === 2) {
            return a[0][0] * a[1][1] - a[1][0] * a[0][1];
        }

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
            d += Math.pow(-1.0, j1) * a[0][j1] * this._determinantDrawEx(m, n - 1);
        }

        return d;
    }

    /**
     * Create circle segment from three points
     */
    private CreateCircleSegmentFromThreePoints(
        circle: CircleResult, 
        pt1: any, 
        pt2: any, 
        pt3: any, 
        numberOfPts: number
    ): CircleSegmentResult {
        const center = circle.center;
        const radius = circle.radius;
        const path: Point[] = [];

        // Normalize points relative to center
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

        // Normalize angles to [0, 2*PI]
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
            
            const mapPt = this.view.toMap(screenPt);
            if (mapPt) {
                path.push(new Point({
                    x: mapPt.x,
                    y: mapPt.y,
                    spatialReference: this.view.spatialReference
                }));
            }
        }

        const result = new Polygon({ spatialReference: this.view.spatialReference });
        const pathCoords = path.map(pt => [pt.x, pt.y]);
        result.addRing(pathCoords);

        return { 
            geometry: result, 
            lastPoint: path[numberOfPts] || path[path.length - 1], 
            backPoint: path[Math.max(0, numberOfPts - 5)] || path[0] 
        };
    }

    /**
     * Clean up drawing state and finalize
     */
    private cleanUp(): void {
        const drawEss = this.createDrawEssentials(this._points.slice());
        
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
                symbolType: "FreehandSemiCircle",
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

export default FreehandSemiCircle; 