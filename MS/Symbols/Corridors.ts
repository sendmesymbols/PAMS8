import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Polygon from "@arcgis/core/geometry/Polygon";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import GraphicsLayerManager, {LAYER_NAMES} from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";


import SymbolEvents from "../Support/SymbolEvents";
export interface CorridorsOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polyline;
    DRAW_TYPE?: number;

    [key: string]: any;
}

/**
 * Corridors class for drawing Phase Line symbols on MapView or SceneView
 * Creates line symbols with "PL" text markers at both ends
 */
export class Corridors {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;

    // Symbol properties
    public declaredClass: string = "MilitarySymbology.Symbols.Corridors";
    public SID: string = "110101";
    public symName: string = "Mob Corridors";
    public symGeometricType: string = "Line";

    private _lineSym: SimpleLineSymbol | SimpleFillSymbol | null = null;
    private _points: Point[] = [];
    private _drawType: number = 1;
    private _geometryType: string | null = null;
    private amplifier: Amplifier;

  private _echelon: number = 0;
  private _tailFactor: number = 0.17;

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
        this.events = new SymbolEvents(view, "Corridors");

        // Initialize layers if not already done
        this.layerManager.initializeLayers();

        // Initialize temporary graphic
        this.tempGraphic = new Graphic();
    }

    /**
     * Initialize the phase line drawing
     */
    public init(options: CorridorsOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void {
        this._lineSym = marker;

        // Set parameters from options
        this._drawType = GeoTools.setDefault(options, "DRAW_TYPE", this._drawType);
        this._tailFactor = GeoTools.setDefault(options, "TAIL_FACTOR", this._tailFactor);
        this._echelon = options.ECHELON || 0;


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

            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.ECHELON, this._tailFactor);

            if (this.tempGraphic && this.tempGraphic.geometry) {
                this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEss);
            }
            this._clear();

        } else if (options.hasOwnProperty("CTRL_PTS")) {

            // Immediate placement with control points only
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.ECHELON, this._tailFactor);

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

        this.events.emit("onDrawClick", {currentPts: this._points});

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
    private createDrawEssentials(ctrlPts: Point[], echelon?: number, tailFactor?: number): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.AMPLIFIER = this.amplifier.toString();

        // Store additional properties
        (drawEssentials as any).SCOPE = this;
        (drawEssentials as any).CTRL_PTS = ctrlPts;
        (drawEssentials as any).ECHELON = echelon;
        (drawEssentials as any).TAIL_FACTOR = tailFactor;

        return drawEssentials;
    }

    /**
     * Create symbol geometry from DrawEssentials (matches legacy behavior)
     */
    private createSymbol(drawEssentials: DrawEssentials): Polyline | null {
        try {
            let pts: Point[];

            if ((drawEssentials as any).CTRL_PTS) {
                pts = (drawEssentials as any).CTRL_PTS;
            } else {
                throw new Error("controlPoints not found");
            }

            const spatialReference = this.view.spatialReference;
            const lastPoint = pts[pts.length - 1];
            const firstPoint = pts[0];

            // Use fracture logic like legacy
            const values = (GeoTools as any)._fracture(pts, 20, spatialReference);
            if (!values || !values.geometry) {
                throw new Error("Failed to create fractured geometry");
            }

            const result = values.geometry as Polyline;

            // Write in between Fractures - add echelons at midpoints
            for (let i = 0; i < values.midPoints.length; i++) {
                const k = GeoTools.angleInRadians(pts[i], values.midPoints[i].midPt);
                const baseLineLen = GeoTools._2PtLen(pts[i], values.midPoints[i].midPt) / 6;
                let cLenLimit = baseLineLen / 6;
                if (cLenLimit > baseLineLen / 4) cLenLimit = baseLineLen / 4;

                const echelon = (drawEssentials as any).ECHELON || this._echelon;
                const echelons = (Shapes as any).createEchelon(
                    echelon, 
                    values.midPoints[i].midPt, 
                    cLenLimit, 
                    GeoTools.angleInRadians(pts[i], values.midPoints[i].midPt)
                );
                
                if (echelons && Array.isArray(echelons)) {
                    for (let j = 0; j < echelons.length; j++) {
                        if (Array.isArray(echelons[j])) {
                            result.addPath(echelons[j].map((p: Point) => [p.x, p.y]));
                        } else {
                            result.addPath(echelons[j]);
                        }
                    }
                }
            }

            // Add Notches at start and end
            let notches = this._createStNotches(firstPoint, pts[1], this._tailFactor);
            notches[1] = [firstPoint.x, firstPoint.y]; // Replace null with actual point
            result.addPath(notches);

            if (pts.length <= 2) {
                notches = this._createStNotches(lastPoint, firstPoint, this._tailFactor);
            } else {
                notches = this._createStNotches(lastPoint, pts[pts.length - 2], this._tailFactor);
            }
            notches[1] = [lastPoint.x, lastPoint.y]; // Replace null with actual point
            result.addPath(notches);

            return result;

        } catch (e) {
            /* invalid geometry mid-draw is expected; ignore */
            return null;
        }
    }

    /**
     * Add PL markers at both ends of the line
     */
    private addPLMarkers(result: Polyline, p1: Point, p2: Point): void {
        try {
            const len = GeoTools._2PtLen(p1, p2) / 20;
            const k = GeoTools.angleInRadians(p1, p2);

            // PL marker at start point
            const pt1 = {
                x: -1 * len * Math.cos(k) + p1.x,
                y: -1 * len * Math.sin(k) + p1.y
            };

            if ('createPL' in Shapes && typeof (Shapes as any).createPL === 'function') {
                const plPaths1 = (Shapes as any).createPL(pt1.x, pt1.y, len / 2, this.view.spatialReference);
                if (plPaths1 && Array.isArray(plPaths1)) {
                    plPaths1.forEach((path: any) => {
                        if (path && Array.isArray(path)) {
                            result.addPath(path);
                        }
                    });
                }

                // PL marker at end point
                const pt2 = {
                    x: len * Math.cos(k) + p2.x,
                    y: len * Math.sin(k) + p2.y
                };

                const plPaths2 = (Shapes as any).createPL(pt2.x, pt2.y, len / 2, this.view.spatialReference);
                if (plPaths2 && Array.isArray(plPaths2)) {
                    plPaths2.forEach((path: any) => {
                        if (path && Array.isArray(path)) {
                            result.addPath(path);
                        }
                    });
                }
            }
        } catch (e) {
            console.log('Error adding PL markers');
        }
    }

    /**
     * Create symbol by straight line (draw type 1)
     */
    private createSymbolByStraightLine(pts: Point[]): Polyline {
        const result = new Polyline({spatialReference: this.view.spatialReference});
        const path = pts.map(pt => [pt.x, pt.y]);
        result.addPath(path);
        return result;
    }

    /**
     * Create symbol by bezier line (draw type 2)
     */
    private createSymbolByLine(pts: Point[], firstPoint: Point, lastPoint: Point): Polyline {
        const result = new Polyline({spatialReference: this.view.spatialReference});

        if (pts.length === 2) {
            result.addPath([[lastPoint.x, lastPoint.y], [firstPoint.x, firstPoint.y]]);
        } else if (pts.length > 2) {
            // Convert points to simple objects for Bezier path
            const tempArray = pts.map(pt => ({x: pt.x, y: pt.y}));

            // Create Bezier path using our Shapes utility
            const bezierPoints = Shapes.CreateBezierPathPCOnly(tempArray, 100);
            const bezierPath = bezierPoints.map(pt => [pt.x, pt.y]);
            result.addPath(bezierPath);
        }

        return result;
    }

    /**
     * Create start/end notches (ported from legacy)
     */
    private _createStNotches(firstPoint: Point, lastPoint: Point, tailFactor: number): number[][] {
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

        k += GeoTools.toRad(45);
        const pt1 = [
            tailFactor * len * Math.cos(k) + firstPoint.x,
            tailFactor * len * Math.sin(k) + firstPoint.y
        ];
        k -= GeoTools.toRad(90);
        const pt2 = [
            -1 * tailFactor * len * Math.cos(k) + firstPoint.x,
            -1 * tailFactor * len * Math.sin(k) + firstPoint.y
        ];

        return [pt1, [0, 0], pt2]; // Middle point to be filled by caller
    }

    /**
     * Clean up drawing state and finalize
     */
    private cleanUp(): void {
        if (this._points.length === 0) return;

        const drawEss = this.createDrawEssentials(this._points.slice(), this._echelon, this._tailFactor);

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

export default Corridors; 