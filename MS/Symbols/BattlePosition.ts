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
import Shapes from "../Support/Shapes.ts";

export interface BattlePositionOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polyline;
    ECHELON?: number;
    DRAW_TYPE?: number;
    FACE_GAP?: number;
    [key: string]: any;
}

export interface ClosestPointResult {
    x: number;
    y: number;
    index: number;
    fTo: number;
    fFrom: number;
}

/**
 * BattlePosition class for drawing Battle Position symbols on MapView or SceneView
 * Supports both immediate placement and interactive drawing modes with multiple draw types
 */
export class BattlePosition {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;
    
    // Symbol properties
    private SID: string = "151200";
    private symName: string = "Battle Posn";
    private symGeometricType: string = "Area";
    private _lineSym: SimpleLineSymbol | SimpleFillSymbol | null = null;
    private _points: Point[] = [];
    private _geometryType: string | null = null;
    private amplifier: Amplifier;
    
    // Battle Position specific parameters
    private _echelon: number = 0;
    private _drawType: number = 1;
    private _face_gap: number = 0;
    private _FACE_GAP_CONTS: number = 5;
    private _FACE_GAP_CONTS_ELL: number = 2;
    
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
     * Initialize the battle position drawing
     */
    public init(options: BattlePositionOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void {
        this._lineSym = marker;
        
        // Set parameters from options
        this._echelon = options.ECHELON || 0;
        this._drawType = options.DRAW_TYPE || 1;
        this._face_gap = options.FACE_GAP || 0;

        const drawEssentials = new DrawEssentials();

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
            // Immediate placement with all parameters
            if (options.GEOM && this.tempGraphic) {
                this.tempGraphic.geometry = options.GEOM;
            }
            
            const drawEss = this.createDrawEssentials(
                options.CTRL_PTS!.slice(), 
                options.ECHELON || 0,
                options.DRAW_TYPE || 1,
                options.FACE_GAP || 0
            );
            
            if (this.tempGraphic && this.tempGraphic.geometry) {
                this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEss);
            }
            this._clear();

        } else if (options.hasOwnProperty("CTRL_PTS")) {
            // Immediate placement with control points only
            const drawEss = this.createDrawEssentials(
                options.CTRL_PTS!.slice(), 
                options.ECHELON || 0,
                options.DRAW_TYPE || 1,
                options.FACE_GAP || 0
            );
            
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
        (drawEssentials as any).ECHELON = this._echelon;
        (drawEssentials as any).DRAW_TYPE = this._drawType;
        (drawEssentials as any).FACE_GAP = this._face_gap;
        
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
    private createDrawEssentials(
        ctrlPts: Point[], 
        echelon: number, 
        drawType: number, 
        face_gap: number
    ): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.AMPLIFIER = this.amplifier.toString();
        
        // Store additional properties
        (drawEssentials as any).SCOPE = this;
        (drawEssentials as any).CTRL_PTS = ctrlPts;
        (drawEssentials as any).ECHELON = echelon;
        (drawEssentials as any).DRAW_TYPE = drawType;
        (drawEssentials as any).FACE_GAP = face_gap;

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

            const lastPoint = pts[pts.length - 1];
            const firstPoint = pts[0];
            let result = new Polyline({ spatialReference: this.view.spatialReference });

            const drawType = (drawEssentials as any).DRAW_TYPE || 1;

            switch (drawType) {
                case 1:
                    result = this.createSymbolByLine(pts, firstPoint, lastPoint, drawEssentials);
                    break;
                case 2:
                    result = this.createSymbolByCloseLine(pts, firstPoint, lastPoint, drawEssentials);
                    break;
                case 3:
                    result = this.createSymbolByPerfectEllipse(pts, firstPoint, lastPoint, drawEssentials);
                    break;
                default:
                    result = this.createSymbolByLine(pts, firstPoint, lastPoint, drawEssentials);
            }

            return result;

        } catch (e) {
            console.log(this.constructor.name + ' Cannot create Symbol due to invalid geometry');
            return null;
        }
    }

    /**
     * Create symbol by line (draw type 1)
     */
    private createSymbolByLine(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials): Polyline {
        const result = new Polyline({ spatialReference: this.view.spatialReference });
        
        if (pts.length === 2) {
            result.addPath([[lastPoint.x, lastPoint.y], [firstPoint.x, firstPoint.y]]);
        } else if (pts.length > 2) {
            // Convert points to simple objects for Bezier path
            const tempArray = pts.map(pt => ({ x: pt.x, y: pt.y }));
            
            // Create Bezier path using our Shapes utility
            const bezierPoints = Shapes.CreateBezierPathPCOnly(tempArray, 100);
            const bezierPath = bezierPoints.map(pt => [pt.x, pt.y]);
            result.addPath(bezierPath);
            
            // Add echelon symbols
            const lastPt = bezierPath[bezierPath.length - 1];
            const firstPt = bezierPath[0];
            
            const midPt = GeoTools.getMidPoint(
                new Point({ x: lastPt[0], y: lastPt[1], spatialReference: this.view.spatialReference }),
                new Point({ x: firstPt[0], y: firstPt[1], spatialReference: this.view.spatialReference })
            );
            
            const baseLineLen = GeoTools._2PtLen(
                new Point({ x: lastPt[0], y: lastPt[1], spatialReference: this.view.spatialReference }),
                new Point({ x: firstPt[0], y: firstPt[1], spatialReference: this.view.spatialReference })
            );
            
            let cLenLimit = baseLineLen / 10;
            if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
            
            const echelons = this.createEchelon(
                (drawEssentials as any).ECHELON || 0, 
                { x: midPt.x, y: midPt.y }, 
                cLenLimit, 
                GeoTools.twoPtsAngle(firstPoint, lastPoint)
            );
            
            for (const echelon of echelons) {
                result.addPath(echelon);
            }
        }

        return result;
    }

    /**
     * Create symbol by close line (draw type 2)
     */
    private createSymbolByCloseLine(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials): Polyline {
        const result = new Polyline({ spatialReference: this.view.spatialReference });
        
        if (pts.length === 2) {
            result.addPath([[lastPoint.x, lastPoint.y], [firstPoint.x, firstPoint.y]]);
        } else if (pts.length > 2) {
            // Convert points to simple objects and close the path
            const tempArray = pts.map(pt => ({ x: pt.x, y: pt.y }));
            tempArray.push({ x: firstPoint.x, y: firstPoint.y }); // Close the line
            
            const bezierPoints = Shapes.CreateBezierPathPCOnly(tempArray, 100);
            const paths = bezierPoints.map(pt => [pt.x, pt.y]);
            
            const midPt = this.getClosestPointOnLines({ x: lastPoint.x, y: lastPoint.y }, paths);
            
            const faceGap = GeoTools.setDefault(drawEssentials, "FACE_GAP", this._FACE_GAP_CONTS);
            const frstEndPIndx = Math.max(0, midPt.index - this._FACE_GAP_CONTS - Math.floor(faceGap / 2));
            const secStartPIndx = Math.min(100, midPt.index + this._FACE_GAP_CONTS + Math.floor(faceGap / 2));
            
            // Add the two segments with gap
            if (frstEndPIndx > 0) {
                result.addPath(paths.slice(0, frstEndPIndx));
            }
            if (secStartPIndx < paths.length) {
                result.addPath(paths.slice(secStartPIndx));
            }
            
            // Add echelon symbols
            if (frstEndPIndx < paths.length && secStartPIndx < paths.length) {
                const p1 = new Point({ 
                    x: paths[frstEndPIndx][0], 
                    y: paths[frstEndPIndx][1], 
                    spatialReference: this.view.spatialReference 
                });
                const p2 = new Point({ 
                    x: paths[secStartPIndx][0], 
                    y: paths[secStartPIndx][1], 
                    spatialReference: this.view.spatialReference 
                });
                
                const baseLineLen = GeoTools._2PtLen(p1, p2);
                let cLenLimit = baseLineLen / 10;
                if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
                
                const echelons = this.createEchelon(
                    (drawEssentials as any).ECHELON || 0, 
                    midPt, 
                    cLenLimit, 
                    GeoTools.twoPtsAngle(p1, p2)
                );
                
                for (const echelon of echelons) {
                    result.addPath(echelon);
                }
            }
        }

        return result;
    }

    /**
     * Create symbol by perfect ellipse (draw type 3)
     */
    private createSymbolByPerfectEllipse(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials): Polyline {
        const result = new Polyline({ spatialReference: this.view.spatialReference });
        
        if (pts.length === 2) {
            // Create ellipse using the two points
            const center = { x: firstPoint.x, y: firstPoint.y };
            const widthMap = Math.abs(lastPoint.x - firstPoint.x);
            const heightMap = Math.abs(lastPoint.y - firstPoint.y);
            
            const paths = this.createEllipse(center, widthMap, heightMap, 60);
            result.addPath(paths);
            
        } else if (pts.length > 2) {
            const secondPt = pts[1];
            const center = { x: firstPoint.x, y: firstPoint.y };
            const widthMap = Math.abs(secondPt.x - firstPoint.x);
            const heightMap = Math.abs(secondPt.y - firstPoint.y);
            
            const paths = this.createEllipse(center, widthMap, heightMap, 60);
            const ellipsePoints = paths.map(pt => ({ x: pt[0], y: pt[1] }));
            
            const midPt = this.getClosestPointOnLines2({ x: lastPoint.x, y: lastPoint.y }, ellipsePoints);
            
            const faceGap = GeoTools.setDefault(drawEssentials, "FACE_GAP", this._FACE_GAP_CONTS_ELL);
            const frstEndPIndx = Math.max(0, midPt.index - this._FACE_GAP_CONTS_ELL - Math.floor(faceGap / 2));
            const secStartPIndx = Math.min(60, midPt.index + this._FACE_GAP_CONTS_ELL + Math.floor(faceGap / 2));
            
            // Add the two segments with gap
            if (frstEndPIndx > 0) {
                result.addPath(paths.slice(0, frstEndPIndx));
            }
            if (secStartPIndx < paths.length) {
                result.addPath(paths.slice(secStartPIndx));
            }
            
            // Add echelon symbols
            if (frstEndPIndx < paths.length && secStartPIndx < paths.length) {
                const p1 = new Point({ 
                    x: paths[frstEndPIndx][0], 
                    y: paths[frstEndPIndx][1], 
                    spatialReference: this.view.spatialReference 
                });
                const p2 = new Point({ 
                    x: paths[secStartPIndx][0], 
                    y: paths[secStartPIndx][1], 
                    spatialReference: this.view.spatialReference 
                });
                
                const baseLineLen = GeoTools._2PtLen(p1, p2);
                let cLenLimit = baseLineLen / 10;
                if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
                
                const echelons = this.createEchelon(
                    (drawEssentials as any).ECHELON || 0, 
                    midPt, 
                    cLenLimit, 
                    GeoTools.twoPtsAngle(p1, p2)
                );
                
                for (const echelon of echelons) {
                    result.addPath(echelon);
                }
            }
        }

        return result;
    }

    /**
     * Create ellipse path
     */
    private createEllipse(center: { x: number, y: number }, width: number, height: number, numberOfPoints: number): number[][] {
        const paths: number[][] = [];
        const angleStep = (2 * Math.PI) / numberOfPoints;
        
        for (let i = 0; i <= numberOfPoints; i++) {
            const angle = i * angleStep;
            const x = center.x + (width / 2) * Math.cos(angle);
            const y = center.y + (height / 2) * Math.sin(angle);
            paths.push([x, y]);
        }
        
        return paths;
    }

    /**
     * Create echelon symbols
     */
    private createEchelon(echelonLevel: number, center: { x: number, y: number }, length: number, angle: number): number[][][] {
        const echelons: number[][][] = [];
        
        if (echelonLevel <= 0) return echelons;
        
        // Simple echelon representation - vertical lines
        const perpAngle = angle + Math.PI / 2;
        const spacing = length / (echelonLevel + 1);
        
        for (let i = 1; i <= echelonLevel; i++) {
            const offset = (i - (echelonLevel + 1) / 2) * spacing;
            const startX = center.x + offset * Math.cos(angle) - (length / 4) * Math.cos(perpAngle);
            const startY = center.y + offset * Math.sin(angle) - (length / 4) * Math.sin(perpAngle);
            const endX = center.x + offset * Math.cos(angle) + (length / 4) * Math.cos(perpAngle);
            const endY = center.y + offset * Math.sin(angle) + (length / 4) * Math.sin(perpAngle);
            
            echelons.push([[startX, startY], [endX, endY]]);
        }
        
        return echelons;
    }

    /**
     * Get closest point on lines (for arrays of number arrays)
     */
    private getClosestPointOnLines(pXy: { x: number, y: number }, aXys: number[][]): ClosestPointResult {
        let minDist: number | null = null;
        let fTo = 0;
        let fFrom = 0;
        let x = 0;
        let y = 0;
        let bestIndex = 0;

        if (aXys.length > 1) {
            for (let n = 1; n < aXys.length; n++) {
                let dist: number;
                
                if (aXys[n][0] !== aXys[n - 1][0]) {
                    const a = (aXys[n][1] - aXys[n - 1][1]) / (aXys[n][0] - aXys[n - 1][0]);
                    const b = aXys[n][1] - a * aXys[n][0];
                    dist = Math.abs(a * pXy.x + b - pXy.y) / Math.sqrt(a * a + 1);
                } else {
                    dist = Math.abs(pXy.x - aXys[n][0]);
                }

                const rl2 = Math.pow(aXys[n][1] - aXys[n - 1][1], 2) + Math.pow(aXys[n][0] - aXys[n - 1][0], 2);
                const ln2 = Math.pow(aXys[n][1] - pXy.y, 2) + Math.pow(aXys[n][0] - pXy.x, 2);
                const lnm12 = Math.pow(aXys[n - 1][1] - pXy.y, 2) + Math.pow(aXys[n - 1][0] - pXy.x, 2);
                const dist2 = Math.pow(dist, 2);
                const calcrl2 = ln2 - dist2 + lnm12 - dist2;

                if (calcrl2 > rl2) {
                    dist = Math.sqrt(Math.min(ln2, lnm12));
                }

                if (minDist === null || minDist > dist) {
                    if (calcrl2 > rl2) {
                        if (lnm12 < ln2) {
                            fTo = 0;
                            fFrom = 1;
                        } else {
                            fFrom = 0;
                            fTo = 1;
                        }
                    } else {
                        fTo = Math.sqrt(lnm12 - dist2) / Math.sqrt(rl2);
                        fFrom = Math.sqrt(ln2 - dist2) / Math.sqrt(rl2);
                    }
                    minDist = dist;
                    bestIndex = n;
                }
            }

            const dx = aXys[bestIndex - 1][0] - aXys[bestIndex][0];
            const dy = aXys[bestIndex - 1][1] - aXys[bestIndex][1];
            x = aXys[bestIndex - 1][0] - (dx * fTo);
            y = aXys[bestIndex - 1][1] - (dy * fTo);
        }

        return { x, y, index: bestIndex, fTo, fFrom };
    }

    /**
     * Get closest point on lines (for point objects)
     */
    private getClosestPointOnLines2(pXy: { x: number, y: number }, aXys: { x: number, y: number }[]): ClosestPointResult {
        let minDist: number | null = null;
        let fTo = 0;
        let fFrom = 0;
        let x = 0;
        let y = 0;
        let bestIndex = 0;

        if (aXys.length > 1) {
            for (let n = 1; n < aXys.length; n++) {
                let dist: number;
                
                if (aXys[n].x !== aXys[n - 1].x) {
                    const a = (aXys[n].y - aXys[n - 1].y) / (aXys[n].x - aXys[n - 1].x);
                    const b = aXys[n].y - a * aXys[n].x;
                    dist = Math.abs(a * pXy.x + b - pXy.y) / Math.sqrt(a * a + 1);
                } else {
                    dist = Math.abs(pXy.x - aXys[n].x);
                }

                const rl2 = Math.pow(aXys[n].y - aXys[n - 1].y, 2) + Math.pow(aXys[n].x - aXys[n - 1].x, 2);
                const ln2 = Math.pow(aXys[n].y - pXy.y, 2) + Math.pow(aXys[n].x - pXy.x, 2);
                const lnm12 = Math.pow(aXys[n - 1].y - pXy.y, 2) + Math.pow(aXys[n - 1].x - pXy.x, 2);
                const dist2 = Math.pow(dist, 2);
                const calcrl2 = ln2 - dist2 + lnm12 - dist2;

                if (calcrl2 > rl2) {
                    dist = Math.sqrt(Math.min(ln2, lnm12));
                }

                if (minDist === null || minDist > dist) {
                    if (calcrl2 > rl2) {
                        if (lnm12 < ln2) {
                            fTo = 0;
                            fFrom = 1;
                        } else {
                            fFrom = 0;
                            fTo = 1;
                        }
                    } else {
                        fTo = Math.sqrt(lnm12 - dist2) / Math.sqrt(rl2);
                        fFrom = Math.sqrt(ln2 - dist2) / Math.sqrt(rl2);
                    }
                    minDist = dist;
                    bestIndex = n;
                }
            }

            const dx = aXys[bestIndex - 1].x - aXys[bestIndex].x;
            const dy = aXys[bestIndex - 1].y - aXys[bestIndex].y;
            x = aXys[bestIndex - 1].x - (dx * fTo);
            y = aXys[bestIndex - 1].y - (dy * fTo);
        }

        return { x, y, index: bestIndex, fTo, fFrom };
    }

    /**
     * Clean up drawing state and finalize
     */
    private cleanUp(): void {
        if (this._points.length === 0) return;

        const drawEss = this.createDrawEssentials(
            this._points.slice(),
            this._echelon,
            this._drawType,
            this._face_gap
        );
        
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
                symbolType: "BattlePosition",
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

export default BattlePosition; 