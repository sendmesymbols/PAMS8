import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Polygon from "@arcgis/core/geometry/Polygon";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import Color from "@arcgis/core/Color";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";

import SymbolEvents from "../Support/SymbolEvents";
export interface FreehandSemiCircleFilledOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    opacity?: number;
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
 * FreehandSemiCircleFilled class for drawing Filled Freehand Semi Circle symbols on MapView or SceneView
 * Creates filled semi-circles from three points with opacity support
 */
export class FreehandSemiCircleFilled {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;
    
    // Symbol properties
    private SID: string = "000140";
    private symName: string = "Freehand - Semi Circle Filled";
    private symGeometricType: string = "Area";
    private _lineSym: SimpleLineSymbol | SimpleFillSymbol | null = null;
    private _points: Point[] = [];
    private _geometryType: string | null = null;
    private amplifier: Amplifier;
    private _opacity: number = 1;
    
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
        this.events = new SymbolEvents(view, "FreehandSemiCircleFilled");
        
        // Initialize layers if not already done
        this.layerManager.initializeLayers();
        
        // Initialize temporary graphic
        this.tempGraphic = new Graphic();
    }

    /**
     * Initialize the freehand semi circle filled drawing
     */
    public init(options: FreehandSemiCircleFilledOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void {
        // Set opacity from options
        this._opacity = options.opacity || 1;

        // Create filled symbol
        if (marker) {
            let color: Color;
            if ('color' in marker) {
                color = new Color((marker as any).color);
                color.a = this._opacity;
            } else {
                color = new Color([0, 0, 0, this._opacity]);
            }

            this._lineSym = new SimpleFillSymbol({
                style: "solid",
                color: color,
                outline: new SimpleLineSymbol({
                    style: (marker as any).style || "solid",
                    color: (marker as any).color || [0, 0, 0, 1],
                    width: (marker as any).width || 1
                })
            });
        }

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
        
        this.events.emit("onDrawClick", { currentPts: this._points });

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
     * Create symbol geometry from DrawEssentials (same as FreehandSemiCircle)
     */
    private createSymbol(drawEssentials: DrawEssentials): Polygon | null {
        try {
            let pts: Point[];

            if ((drawEssentials as any).CTRL_PTS) {
                pts = (drawEssentials as any).CTRL_PTS;
            } else {
                throw new Error("controlPoints not found");
            }

            const polygon = new Polygon({ spatialReference: this.view.spatialReference });

            if (pts.length < 2) {
                return polygon;
            }

            const startingPt = pts[0];
            const endPt = pts[1];

            // For two points, return a minimally closed ring so 4.x accepts the polygon
            if (pts.length === 2) {
                polygon.addRing([
                    [startingPt.x, startingPt.y],
                    [endPt.x, endPt.y],
                    [startingPt.x, startingPt.y]
                ]);
                return polygon;
            }

            // For three or more points, compute the semicircle through the three points
            const candidatePoint = pts[2];

            const startScreen = this.view.toScreen(startingPt);
            const endScreen = this.view.toScreen(endPt);
            const candidateScreen = this.view.toScreen(candidatePoint);

            const circle = this._circleDrawEx(startScreen, endScreen, candidateScreen);
            if (circle.radius <= 0) {
                // Fallback: thin triangle for invalid circle
                polygon.addRing([
                    [startingPt.x, startingPt.y],
                    [endPt.x, endPt.y],
                    [candidatePoint.x, candidatePoint.y],
                    [startingPt.x, startingPt.y]
                ]);
                return polygon;
            }

            const values = Shapes.createCircleSegmentFromThreePoints(
                this.view,
                circle,
                startScreen,
                endScreen,
                candidateScreen,
                60
            );

            return values.geometry;

        } catch (e) {
            console.log(this.constructor.name + ' Cannot create Symbol due to invalid geometry');
            return null;
        }
    }

    /**
     * Calculate circle from three points (same as FreehandSemiCircle)
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
     * Recursive determinant calculation (same as FreehandSemiCircle)
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
        this._geometryType = null;
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

export default FreehandSemiCircleFilled; 