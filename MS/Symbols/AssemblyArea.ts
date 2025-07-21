import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
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

export interface AssemblyAreaOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    DRAW_TYPE?: number;
    [key: string]: any;
}

/**
 * AssemblyArea class for drawing Assembly Area symbols
 * Supports multiple drawing types: Bezier curve (1), Polygon (2), Rectangle (3)
 * Includes inner text markers using createAA method
 */
export class AssemblyArea {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;
    
    // Symbol properties
    private SID: string = "150200";
    private symName: string = "Assy Area";
    private symGeometricType: string = "Area";
    private _lineSym: SimpleLineSymbol | null = null;
    private _points: Point[] = [];
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
     * Initialize the assembly area drawing
     */
    public init(options: AssemblyAreaOptions, marker: SimpleLineSymbol): void {
        this._lineSym = marker.clone();
        this._drawType = options.DRAW_TYPE || 1;
        
        // Set up event handlers
        this.setupEventHandlers();

        const drawEssentials = new DrawEssentials();

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
            // Immediate placement with both control points and geometry
            if (options.GEOM && this.tempGraphic) {
                this.tempGraphic.geometry = options.GEOM;
            }
            
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.DRAW_TYPE || 1);
            if (this.tempGraphic && this.tempGraphic.geometry) {
                this.__drawEnd(this.tempGraphic.geometry as Polygon, drawEss);
            }
            this._clear();

        } else if (options.hasOwnProperty("CTRL_PTS")) {
            // Immediate placement with control points only
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.DRAW_TYPE || 1);
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

        // For single line mode, finish after first click
        if (this.isLine === true && this._points.length === 1) {
            this.emit("onDrawClick", { currentPts: this._points });
            this.cleanUp();
        }

        // For rectangle draw type, finish after 2 points
        if (this._drawType === 3 && this._points.length === 2) {
            this.emit("onDrawClick", { currentPts: this._points });
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
    private createDrawEssentials(ctrlPts: Point[], drawType: number): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.GEOM = null;
        drawEssentials.AMPLIFIER = this.amplifier.toString();
        
        // Store additional properties
        (drawEssentials as any).SCOPE = this;
        (drawEssentials as any).CTRL_PTS = ctrlPts;
        (drawEssentials as any).DRAW_TYPE = drawType;

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

            const lastPoint = pts[pts.length - 1];
            const firstPoint = pts[0];
            const drawType = (drawEssentials as any).DRAW_TYPE || 1;

            let result: Polygon | null = null;

            switch (drawType) {
                case 1:
                    result = this.createSymbolByBCurve(pts, firstPoint, lastPoint, drawEssentials);
                    break;
                case 2:
                    result = this.createSymbolByPolygon(pts, firstPoint, lastPoint, drawEssentials);
                    break;
                case 3:
                    result = this.createSymbolByRect(pts, firstPoint, lastPoint, drawEssentials);
                    break;
                default:
                    result = this.createSymbolByPolygon(pts, firstPoint, lastPoint, drawEssentials);
            }

            return result;
            
        } catch (e) {
            console.log(this.constructor.name + ' Cannot create Symbol due to invalid geometry');
            return null;
        }
    }

    /**
     * Create symbol using Bezier curve
     */
    private createSymbolByBCurve(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials): Polygon {
        const tempArray = pts.map(e => ({ x: e.x, y: e.y }));
        tempArray.push({ x: firstPoint.x, y: firstPoint.y });
        
        let result = this.CreateBezierPath(tempArray, 130, this.view);
        result = this.createInnerText(result, firstPoint, lastPoint);
        return result;
    }

    /**
     * Create symbol using polygon
     */
    private createSymbolByPolygon(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials): Polygon {
        const result = new Polygon({ spatialReference: this.view.spatialReference });
        const tempArray = pts.map(e => ({ x: e.x, y: e.y }));
        tempArray.push({ x: firstPoint.x, y: firstPoint.y });
        
        result.addRing(tempArray.map(pt => [pt.x, pt.y]));
        return this.createInnerText(result, firstPoint, lastPoint);
    }

    /**
     * Create symbol using rectangle
     */
    private createSymbolByRect(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials): Polygon {
        let result = new Polygon({ spatialReference: this.view.spatialReference });
        const tempArray = pts.map(e => [e.x, e.y]);
        
        result.addRing(tempArray);
        const extent = result.extent;
        
        if (!extent) {
            return this.createSymbolByPolygon(pts, firstPoint, lastPoint, drawEssentials);
        }

        result = new Polygon({ spatialReference: this.view.spatialReference });
        const rectRing = [
            [firstPoint.x, firstPoint.y],
            [extent.xmin, extent.ymin],
            [lastPoint.x, lastPoint.y],
            [extent.xmax, extent.ymax],
            [firstPoint.x, firstPoint.y]
        ];
        
        result.addRing(rectRing);
        return this.createInnerText(result, firstPoint, lastPoint);
    }

    /**
     * Create Bezier path (fallback without TweenMax)
     */
    private CreateBezierPath(pointCollection: any[], numberOfPts: number, view: MapView | SceneView): Polygon {
        const result = new Polygon({ spatialReference: view.spatialReference });
        
        if (pointCollection.length < 2) {
            return result;
        }

        // Remove duplicate points
        while (pointCollection.length > 1 && 
               pointCollection[pointCollection.length - 1].x === pointCollection[pointCollection.length - 2].x && 
               pointCollection[pointCollection.length - 1].y === pointCollection[pointCollection.length - 2].y) {
            pointCollection.pop();
        }

        const path: number[][] = [];
        
        if (pointCollection.length === 2) {
            for (let i = 0; i <= numberOfPts; i++) {
                const t = i / numberOfPts;
                const x = pointCollection[0].x + t * (pointCollection[1].x - pointCollection[0].x);
                const y = pointCollection[0].y + t * (pointCollection[1].y - pointCollection[0].y);
                path.push([x, y]);
            }
        } else {
            for (let i = 0; i <= numberOfPts; i++) {
                const t = i / numberOfPts;
                const segmentLength = 1 / (pointCollection.length - 1);
                const segmentIndex = Math.floor(t / segmentLength);
                const localT = (t - segmentIndex * segmentLength) / segmentLength;
                
                const startIdx = Math.min(segmentIndex, pointCollection.length - 2);
                const endIdx = startIdx + 1;
                
                const x = pointCollection[startIdx].x + localT * (pointCollection[endIdx].x - pointCollection[startIdx].x);
                const y = pointCollection[startIdx].y + localT * (pointCollection[endIdx].y - pointCollection[startIdx].y);
                path.push([x, y]);
            }
        }
        
        result.addRing(path);
        return result;
    }

    /**
     * Create inner text markers for Assembly Area
     */
    private createInnerText(result: Polygon, firstPoint: Point, lastPoint: Point): Polygon {
        try {
            const extent = result.extent;
            if (!extent) {
                return result;
            }

            const midPt = extent.center;
            if (!midPt) {
                return result;
            }

            const baseLineLen = this.calculateDistance(firstPoint, lastPoint);
            let cLenLimit = baseLineLen / 10;
            if (cLenLimit > baseLineLen / 3.6) {
                cLenLimit = baseLineLen / 3.6;
            }

            // Try to use Shapes.createAA if available
            if (Shapes && (Shapes as any).createAA) {
                try {
                    const aaRings = (Shapes as any).createAA(midPt.x, midPt.y, cLenLimit, midPt.spatialReference);
                    if (aaRings && Array.isArray(aaRings)) {
                        for (let j = 0; j <= aaRings.length - 1; j++) {
                            if (aaRings[j]) {
                                result.addRing(aaRings[j]);
                            }
                        }
                    }
                } catch (e) {
                    console.log('Error creating AA inner text with Shapes utility, using fallback');
                    this.createSimpleAA(result, midPt, cLenLimit);
                }
            } else {
                // Fallback AA creation
                this.createSimpleAA(result, midPt, cLenLimit);
            }

            return result;
        } catch (e) {
            console.log('Cannot create Inner Text');
            return result;
        }
    }

    /**
     * Create simple AA text as fallback
     */
    private createSimpleAA(result: Polygon, midPt: Point, size: number): void {
        // Create simple "AA" text representation
        const letterHeight = size;
        const letterWidth = size * 0.6;
        const spacing = size * 0.2;

        // Create first "A" shape
        const a1Points = [
            [midPt.x - letterWidth - spacing, midPt.y + letterHeight/2],
            [midPt.x - letterWidth/2 - spacing, midPt.y - letterHeight/2],
            [midPt.x - spacing, midPt.y + letterHeight/2],
            [midPt.x - letterWidth*0.75 - spacing, midPt.y],
            [midPt.x - letterWidth*0.25 - spacing, midPt.y]
        ];
        
        // Create second "A" shape
        const a2Points = [
            [midPt.x, midPt.y + letterHeight/2],
            [midPt.x + letterWidth/2, midPt.y - letterHeight/2],
            [midPt.x + letterWidth + spacing, midPt.y + letterHeight/2],
            [midPt.x + letterWidth*0.25 + spacing/2, midPt.y],
            [midPt.x + letterWidth*0.75 + spacing/2, midPt.y]
        ];

        // Add as separate rings (inner text)
        result.addRing([a1Points[0], a1Points[1], a1Points[2]]);
        result.addRing([a1Points[3], a1Points[4]]);
        result.addRing([a2Points[0], a2Points[1], a2Points[2]]);
        result.addRing([a2Points[3], a2Points[4]]);
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
     * Clean up drawing state and finalize
     */
    private cleanUp(): void {
        if (this._points.length === 0) return;

        const drawEssentials = this.createDrawEssentials(this._points.slice(), this._drawType);
        
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
                symbolType: "AssemblyArea",
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

export default AssemblyArea; 