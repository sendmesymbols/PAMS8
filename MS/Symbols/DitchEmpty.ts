import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Color from "@arcgis/core/Color";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import GraphicsLayerManager, {LAYER_NAMES} from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";


import SymbolEvents from "../Support/SymbolEvents";
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
    private _opacity: number = 0.50;

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
        this.events = new SymbolEvents(view, "DitchEmpty");

        // Initialize layers if not already done
        this.layerManager.initializeLayers();

        // Initialize temporary graphic
        this.tempGraphic = new Graphic();
    }

    /**
     * Initialize the DCB drawing
     */
    public init(options: DitchEmptyOptions, marker: SimpleLineSymbol): void {
        // Set opacity
        if (options.hasOwnProperty('opacity')) {
            this._opacity = options.opacity!;
        }

        this._lineSym = new SimpleLineSymbol({
            color: "black",
            width: marker.width,
        });

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
            symbol: this._lineSym,
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

        this.events.emit("onDrawClick", {currentPts: this._points});

        // For single line mode, finish after first click
        if (this.isLine === true && this._points.length === 1) {
            this.events.emit("onDrawClick", {currentPts: this._points});
            this.cleanUp();
        }

        // For rectangle draw type, finish after 2 points
        if (this._drawType === 3 && this._points.length === 2) {
            this.events.emit("onDrawClick", {currentPts: this._points});
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
            this.events.emit("onDrawProgress", {
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
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        (drawEssentials as any).SCOPE = this;
        (drawEssentials as any).CTRL_PTS = ctrlPts;
        (drawEssentials as any).AMPLIFIER = this.amplifier.toString();
        (drawEssentials as any).IS_OBS = this.isObstacle;
        (drawEssentials as any).TEETH_SIZE = teethSize;
        (drawEssentials as any).TEETH_GAP = teethGap;

        return drawEssentials;
    }

    /**
     * Create the ditch empty symbol geometry
     */
    private createSymbol(drawEssentials: DrawEssentials): Polygon | null {
        try {
            if (!(drawEssentials as any).CTRL_PTS) {
                throw new Error("Control points not found");
            }

            const pts = (drawEssentials as any).CTRL_PTS as Point[];
            if (pts.length < 2) {
                return null;
            }

            const result = new Polygon({
                spatialReference: this.view.spatialReference
            });

            const firstPoint = pts[0];
            const lastPoint = pts[pts.length - 1];
            const baseLineLen = GeoTools._2PtLen(firstPoint, lastPoint);
            // Use original points for processing (center line)
            const middleArray = pts;

            // Determine sampling gap based on desired teeth gap
            const gapRatio = GeoTools._2PtLen(middleArray[0], middleArray[middleArray.length - 1]) / this._teethGap;
            const midSamples = GeoTools.getDashPts(middleArray, [gapRatio, gapRatio]);

            // If sampling failed, fallback to control points
            const samples = midSamples && midSamples.length > 1 ? midSamples : middleArray;

            // Build contiguous filled triangles on the same side without gaps between bases
            let previousBaseEnd: { x: number; y: number } | null = null;
            for (let i = 1; i < samples.length; i++) {
                const p0 = samples[i - 1];
                const p1 = samples[i];

                const dx = p1.x - p0.x;
                const dy = p1.y - p0.y;
                const segLen = Math.sqrt(dx * dx + dy * dy);
                if (segLen === 0) continue;

                // Unit tangent and normal
                const ux = dx / segLen;
                const uy = dy / segLen;
                const nx = -uy;
                const ny = ux;

                // Triangle dimensions
                const baseLen = segLen; // full segment as base to avoid gaps
                const height = Math.max(segLen / Math.max(2, this._teethSize), baseLineLen / 40);

                // Always draw on the same side (left of path)
                const side = 1;

                // Apex from center of segment towards normal
                const midX = (p0.x + p1.x) / 2;
                const midY = (p0.y + p1.y) / 2;
                const apexX = midX + nx * height * side;
                const apexY = midY + ny * height * side;

                // Base endpoints are p0 and p1
                let base1X = p0.x;
                let base1Y = p0.y;
                const base2X = p1.x;
                const base2Y = p1.y;

                // Ensure no gap between consecutive bases by snapping start to previous end
                if (previousBaseEnd) {
                    base1X = previousBaseEnd.x;
                    base1Y = previousBaseEnd.y;
                }

                // Add triangle ring (closed)
                result.addRing([
                    [base1X, base1Y],
                    [apexX, apexY],
                    [base2X, base2Y],
                    [base1X, base1Y]
                ]);

                previousBaseEnd = { x: base2X, y: base2Y };
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

export default DitchEmpty;