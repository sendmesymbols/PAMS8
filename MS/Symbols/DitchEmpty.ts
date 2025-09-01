import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Color from "@arcgis/core/Color";
import GraphicsLayerManager, {LAYER_NAMES} from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";


export interface DitchEmptyOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    DRAW_TYPE?: number;

    [key: string]: any;
}

/**
 * DitchEmpty class for Ditch Empty symbol
 * Supports multiple drawing types: Bezier curve (1), Polygon (2), Rectangle (3)
 */
export class DitchEmpty {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;

    // Symbol properties
    // Symbol properties
    public declaredClass: string = "MilitarySymbology.Symbols.DitchEmpty";
    public SID: string = "290201";
    public symName: string = "DCB";
    public symGeometricType: string = "Line";
    public isObstacle: string = "1";

    private _lineSym: SimpleLineSymbol | null = null;
    private _points: Point[] = [];
    private _teethSize: number = 3;
    private _teethGap: number = 20;
    private _headRatio: number = 10;
    private _tailRatio: number = 10;
    private _geometryType: string | null = null;
    private _drawType: number = 1;
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
     * Initialize the Vital Ground drawing
     */
    public init(options: DitchEmptyOptions, marker: SimpleLineSymbol): void {
        this._lineSym = marker.clone();
        // Set line symbol color
        if (this._lineSym) {
            this._lineSym.color = new Color([0, 0, 0, 1]);
        }

        this._drawType = options.DRAW_TYPE || 1;

        // Set up event handlers
        this.setupEventHandlers();

        const drawEssentials = new DrawEssentials();

        // Set default values from options
        this._teethSize = GeoTools.setDefault(options, "TEETH_SIZE", this._teethSize);
        this._teethGap = GeoTools.setDefault(options, "TEETH_GAP", this._teethGap);

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
            // Immediate placement with both control points and geometry
            if (options.GEOM && this.tempGraphic) {
                try {
                    // If a Polygon geometry is provided, assign it directly
                    this.tempGraphic.geometry = options.GEOM;
                } catch (error) {
                    console.error(this.symName, "Failed to set Polygon geometry:", error);
                }
            }

            const drawEss = this.createDrawEssentials(options.CTRL_PTS!, this._teethSize, this._teethGap);
            if (this.tempGraphic && this.tempGraphic.geometry) {
                this.__drawEnd(this.tempGraphic.geometry as Polygon, drawEss);
            }
            this._clear();

        } else if (options.hasOwnProperty("CTRL_PTS")) {
            // Immediate placement with control points only
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!, this._teethSize, this._teethGap);
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

        this.emit("onDrawClick", {currentPts: this._points});

        // For single line mode, finish after first click
        if (this.isLine === true && this._points.length === 1) {
            this.emit("onDrawClick", {currentPts: this._points});
            this.cleanUp();
        }

        // For rectangle draw type, finish after 2 points
        if (this._drawType === 3 && this._points.length === 2) {
            this.emit("onDrawClick", {currentPts: this._points});
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


        const drawEssentials = this.createDrawEssentials(
            [...this._points, candidatePoint],
            this._teethSize,
            this._teethGap
        );

        (drawEssentials as any).CTRL_PTS = this._points.concat([candidatePoint]);
        (drawEssentials as any).DRAW_TYPE = this._drawType;

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
     * Create DrawEssentials object with symbol parameters
     */
    private createDrawEssentials(ctrlPts: Point[], teethSize: number, teethGap: number): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SCOPE = this;
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.CTRL_PTS = ctrlPts;
        drawEssentials.AMPLIFIER = this.amplifier;
        drawEssentials.IS_OBS = this.isObstacle;
        drawEssentials.TEETH_SIZE = teethSize;
        drawEssentials.TEETH_GAP = teethGap;

        return drawEssentials;
    }

    /**
     * Create the ditch empty symbol geometry
     */
    private createSymbol(drawEssentials: DrawEssentials): Polygon | null {
        try {
            if (!drawEssentials.hasOwnProperty("CTRL_PTS") || !drawEssentials.CTRL_PTS) {
                throw new Error("Control points not found");
            }

            const pts = drawEssentials.CTRL_PTS;
            if (pts.length < 2) {
                return null;
            }

            const result = new Polygon({
                spatialReference: this.view.spatialReference
            });

            const firstPoint = pts[0];
            const lastPoint = pts[pts.length - 1];
            const baseLineLen = GeoTools._2PtLen(firstPoint, lastPoint);

            // Use original points for processing
            const chopPts = pts;

            // Create the main line structure
            const firstChopPt = chopPts[0];
            const lastChopPt = chopPts[chopPts.length - 1];
            const leftArray: Point[] = [];
            const rightArray: Point[] = [];
            const middleArray: Point[] = [];

            const len = baseLineLen / 5 / this._teethSize;
            let k = Math.atan((firstChopPt.y - lastChopPt.y) / (firstChopPt.x - lastChopPt.x));

            // Adjust angle based on point relationship
            switch (GeoTools.twoPtsRelationShip(firstChopPt, lastChopPt)) {
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
                x: partialLen * Math.cos(k) + firstChopPt.x,
                y: partialLen * Math.sin(k) + firstChopPt.y,
                spatialReference: this.view.spatialReference
            });
            const p2 = new Point({
                x: -1 * partialLen * Math.cos(k) + firstChopPt.x,
                y: -1 * partialLen * Math.sin(k) + firstChopPt.y,
                spatialReference: this.view.spatialReference
            });

            if (chopPts.length >= 1) {
                leftArray.push(p1);
                rightArray.push(p2);
                middleArray.push(firstChopPt);
            }

            // Process all control points
            for (let i = 0; i < chopPts.length; i++) {
                const length = GeoTools._2PtLen(firstChopPt, chopPts[i]);
                const angle = GeoTools.angleInRadians(firstChopPt, chopPts[i]);

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

                let adjustedLen = length / 5;
                const baseLineLenLimit = GeoTools._2PtLen(stPtCandidatePt, endPtCandidatePt) / 4;
                if (adjustedLen > baseLineLenLimit) {
                    adjustedLen = baseLineLenLimit;
                }

                leftArray.push(stPtCandidatePt);
                rightArray.push(endPtCandidatePt);
                middleArray.push(chopPts[i]);
            }

            // Add middle array as main ring
            const middleRing: number[][] = middleArray.map(pt => [pt.x, pt.y]);
            result.addRing(middleRing);

            // Create teeth pattern
            const gapRatio = GeoTools._2PtLen(chopPts[0], chopPts[chopPts.length - 1]) / this._teethGap;
            const rightResPts = GeoTools.getDashPts(rightArray, [gapRatio, gapRatio]);
            const leftResPts = GeoTools.getDashPts(leftArray, [gapRatio, gapRatio]);
            const middleResPts = GeoTools.getDashPts(middleArray, [gapRatio, gapRatio]);

            // Create alternating teeth pattern
            const teethPath: number[][] = [];
            for (let i = 1; i < middleResPts.length; i++) {
                if (i % 2 === 0) {
                    teethPath.push([leftResPts[i].x, leftResPts[i].y]);
                } else {
                    teethPath.push([middleResPts[i].x, middleResPts[i].y]);
                }
            }

            if (teethPath.length > 0) {
                result.addRing(teethPath);
            }

            return result;

        } catch (error) {
            console.error(this.declaredClass + ' Cannot create symbol due to invalid geometry:', error);
            return null;
        }
    }

    /**
     * Complete the drawing process
     */
    private cleanUp(): void {
        if (this._points.length < 2) return;

        const drawEssentials = this.createDrawEssentials(
            [...this._points],
            this._teethSize,
            this._teethGap
        );

        const geometry = this.createSymbol(drawEssentials);
        if (geometry) {
            this.__drawEnd(geometry, drawEssentials);
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
                symbolType: this.constructor.name,
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

export default DitchEmpty;