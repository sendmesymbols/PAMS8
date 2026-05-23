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
import Color from "@arcgis/core/Color";

export interface BtleHndOvrLnOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polyline;
    opacity?: number;
    DRAW_TYPE?: number;
    [key: string]: any;
}

/**
 * BtleHndOvrLn class for drawing Battle Handover Line (BHOL) symbols
 * Creates a line with "BHOL" markers at both ends
 * Supports opacity settings for display
 */
export class BtleHndOvrLn {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;
    
    // Symbol properties
    private SID: string = "141902";
    private symName: string = "Battle Handover Line (BHOL)";
    private symGeometricType: string = "Line";
    private _lineSym: SimpleLineSymbol | null = null;
    private _points: Point[] = [];
    private _geometryType: string | null = null;
    private _drawType: number = 1;
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
        this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.TACT);
        this.amplifier = new Amplifier();
        this.events = new SymbolEvents(view, "BtleHndOvrLn");
        
        // Initialize layers if not already done
        this.layerManager.initializeLayers();
        
        // Initialize temporary graphic
        this.tempGraphic = new Graphic();
    }

    /**
     * Initialize the battle handover line drawing
     */
    public init(options: BtleHndOvrLnOptions, marker: SimpleLineSymbol): void {
        this._opacity = 1;

        if (options.hasOwnProperty('opacity')) {
            this._opacity = options.opacity!;
        }

        this._lineSym = marker.clone();
        const blackColor = new Color('#000000');
        this._lineSym.color = blackColor;
        this._lineSym.color.a = this._opacity;

        // Draw type (1: straight, 2: bezier)
        this._drawType = (options as any).DRAW_TYPE || 1;
        
        // Set up event handlers
        this.setupEventHandlers();

        const drawEssentials = new DrawEssentials();

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
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
            
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._opacity);
            if (this.tempGraphic && this.tempGraphic.geometry) {
                this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEss);
            }
            this._clear();

        } else if (options.hasOwnProperty("CTRL_PTS")) {
            // Immediate placement with control points only
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._opacity);
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
        
        this.events.emit("onDrawClick", { currentPts: this._points });

        // For single line mode, finish after first click
        if (this.isLine === true && this._points.length === 1) {
            this.events.emit("onDrawClick", { currentPts: this._points });
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
        (drawEssentials as any).DRAW_TYPE = this._drawType;

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
    private createDrawEssentials(ctrlPts: Point[], opacity: number): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.GEOM = null;
        drawEssentials.AMPLIFIER = this.amplifier.toString();
        drawEssentials.opacity = opacity;
        
        // Store additional properties
        (drawEssentials as any).SCOPE = this;
        (drawEssentials as any).CTRL_PTS = ctrlPts;

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

            let result: Polyline;
            const p1 = pts[0];
            const p2 = pts[pts.length - 1];

            const drawType = (drawEssentials as any).DRAW_TYPE || this._drawType || 1;

            switch (drawType) {
                case 1:
                    result = this.createSymbolByStraightLine(pts);
                    break;
                case 2:
                    result = this.createSymbolByLine(pts, p1, p2);
                    break;
                default:
                    result = this.createSymbolByStraightLine(pts);
            }

            // Add BHOL markers at both ends
            this.addBHOLMarkers(result, p1, p2);

            return result;
            
        } catch (e) {
            console.log(this.constructor.name + ' Cannot create Symbol due to invalid geometry');
            return null;
        }
    }

    /**
     * Create symbol by straight line (draw type 1)
     */
    private createSymbolByStraightLine(pts: Point[]): Polyline {
        const result = new Polyline({ spatialReference: this.view.spatialReference });
        const path = pts.map(pt => [pt.x, pt.y]);
        result.addPath(path);
        return result;
    }

    /**
     * Create symbol by bezier line (draw type 2)
     */
    private createSymbolByLine(pts: Point[], firstPoint: Point, lastPoint: Point): Polyline {
        const result = new Polyline({ spatialReference: this.view.spatialReference });
        if (pts.length === 2) {
            result.addPath([[firstPoint.x, firstPoint.y], [lastPoint.x, lastPoint.y]]);
        } else if (pts.length > 2) {
            const tempArray = pts.map(pt => ({ x: pt.x, y: pt.y }));
            const bezierPoints = Shapes.CreateBezierPathPCOnly(tempArray, 100);
            const bezierPath = bezierPoints.map((pt: any) => [pt.x, pt.y]);
            result.addPath(bezierPath);
        }
        return result;
    }

    /**
     * Add "BHOL" markers at both ends of the line
     */
    private addBHOLMarkers(result: Polyline, p1: Point, p2: Point): void {
        try {
            const len = this.calculateDistance(p1, p2) / 20;
            const k = this.calculateAngle(p1, p2);
            
            // Add BHOL marker at start point
            const pt1 = {
                x: -1 * len * Math.cos(k) + p1.x,
                y: -1 * len * Math.sin(k) + p1.y
            };

            if (Shapes && (Shapes as any).createBHOL) {
                try {
                    const paths1 = (Shapes as any).createBHOL(pt1.x, pt1.y, len / 2, this.view.spatialReference, this.view);
                    if (paths1 && Array.isArray(paths1)) {
                        for (let i = 0; i < paths1.length; i++) {
                            if (paths1[i]) {
                                result.addPath(paths1[i]);
                            }
                        }
                    }
                } catch (e) {
                    console.log('Error creating BHOL marker at start point, using fallback');
                    this.createSimpleBHOL(result, pt1, len / 2);
                }
            } else {
                this.createSimpleBHOL(result, pt1, len / 2);
            }

            // Add BHOL marker at end point
            const pt2 = {
                x: len * Math.cos(k) + p2.x,
                y: len * Math.sin(k) + p2.y
            };

            if (Shapes && (Shapes as any).createBHOL) {
                try {
                    const paths2 = (Shapes as any).createBHOL(pt2.x + (len / 0.5), pt2.y, len / 2, this.view.spatialReference, this.view);
                    if (paths2 && Array.isArray(paths2)) {
                        for (let i = 0; i < paths2.length; i++) {
                            if (paths2[i]) {
                                result.addPath(paths2[i]);
                            }
                        }
                    }
                } catch (e) {
                    console.log('Error creating BHOL marker at end point, using fallback');
                    this.createSimpleBHOL(result, pt2, len / 2);
                }
            } else {
                this.createSimpleBHOL(result, pt2, len / 2);
            }

        } catch (e) {
            console.log('Error adding BHOL markers');
        }
    }

    /**
     * Create simple "BHOL" text as fallback
     */
    private createSimpleBHOL(result: Polyline, center: any, size: number): void {
        const letterHeight = size;
        const letterWidth = size * 0.4;
        const spacing = size * 0.1;

        // Create "B" shape
        const b_vertical = [[center.x - letterWidth*3 - spacing*3, center.y - letterHeight/2], [center.x - letterWidth*3 - spacing*3, center.y + letterHeight/2]];
        const b_top = [[center.x - letterWidth*3 - spacing*3, center.y - letterHeight/2], [center.x - letterWidth*2 - spacing*3, center.y - letterHeight/2]];
        const b_middle = [[center.x - letterWidth*3 - spacing*3, center.y], [center.x - letterWidth*2 - spacing*3, center.y]];
        const b_bottom = [[center.x - letterWidth*3 - spacing*3, center.y + letterHeight/2], [center.x - letterWidth*2 - spacing*3, center.y + letterHeight/2]];

        // Create "H" shape
        const h_left = [[center.x - letterWidth*2 - spacing*2, center.y - letterHeight/2], [center.x - letterWidth*2 - spacing*2, center.y + letterHeight/2]];
        const h_right = [[center.x - letterWidth - spacing*2, center.y - letterHeight/2], [center.x - letterWidth - spacing*2, center.y + letterHeight/2]];
        const h_middle = [[center.x - letterWidth*2 - spacing*2, center.y], [center.x - letterWidth - spacing*2, center.y]];

        // Create "O" shape (simplified as rectangle)
        const o_left = [[center.x - spacing, center.y - letterHeight/2], [center.x - spacing, center.y + letterHeight/2]];
        const o_right = [[center.x + letterWidth - spacing, center.y - letterHeight/2], [center.x + letterWidth - spacing, center.y + letterHeight/2]];
        const o_top = [[center.x - spacing, center.y - letterHeight/2], [center.x + letterWidth - spacing, center.y - letterHeight/2]];
        const o_bottom = [[center.x - spacing, center.y + letterHeight/2], [center.x + letterWidth - spacing, center.y + letterHeight/2]];

        // Create "L" shape
        const l_vertical = [[center.x + letterWidth + spacing, center.y - letterHeight/2], [center.x + letterWidth + spacing, center.y + letterHeight/2]];
        const l_horizontal = [[center.x + letterWidth + spacing, center.y + letterHeight/2], [center.x + letterWidth*2 + spacing, center.y + letterHeight/2]];

        // Add as separate paths
        result.addPath(b_vertical);
        result.addPath(b_top);
        result.addPath(b_middle);
        result.addPath(b_bottom);
        result.addPath(h_left);
        result.addPath(h_right);
        result.addPath(h_middle);
        result.addPath(o_left);
        result.addPath(o_right);
        result.addPath(o_top);
        result.addPath(o_bottom);
        result.addPath(l_vertical);
        result.addPath(l_horizontal);
    }

    /**
     * Utility method to calculate distance
     */
    private calculateDistance(pt1: Point, pt2: Point): number {
        const dx = pt2.x - pt1.x;
        const dy = pt2.y - pt1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Utility method to calculate angle
     */
    private calculateAngle(pt1: Point, pt2: Point): number {
        return Math.atan2(pt2.y - pt1.y, pt2.x - pt1.x);
    }

    /**
     * Clean up drawing state and finalize
     */
    private cleanUp(): void {
        if (this._points.length === 0) return;

        const drawEssentials = this.createDrawEssentials(this._points.slice(), this._opacity);
        
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


    public getSymbolLayer(): GraphicsLayer {
        return this.symbolLayer;
    }

    public clearSymbols(): void {
        this.symbolLayer.removeAll();
    }
}

export default BtleHndOvrLn; 