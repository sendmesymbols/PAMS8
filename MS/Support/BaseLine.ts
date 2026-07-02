import Polyline from "@arcgis/core/geometry/Polyline";
import Point from "@arcgis/core/geometry/Point";
import Graphic from "@arcgis/core/Graphic";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import GeoTools from "./GeoTools.ts";
import Shapes from "./Shapes.ts";
import DrawSeam from "./DrawSeam";

export interface BaseLineOptions {
    letter?: string;
    [key: string]: any;
}

/**
 * BaseLine class for creating baseline drawing functionality
 * Supports interactive baseline creation with various letter modifiers
 */
export class BaseLine {
    private view: MapView | SceneView;
    private _lineSymbol: SimpleLineSymbol;
    private _points: Point[] = [];
    private _geometryType: string | null = null;
    private candidatePoint: Point;
    private letter?: string;
    private _tGraphic: Graphic | null = null;
    
    // Event handlers
    private _onClick: any = null;
    private _onMouseMove: any = null;
    
    // Event emitter
    private eventListeners: Map<string, Function[]> = new Map();

    constructor(view: MapView | SceneView, lineSymbol: SimpleLineSymbol) {
        this.view = view;
        this._lineSymbol = lineSymbol;
        this.candidatePoint = this.view.center;
        
        // Set up handler references
        this._onClick = this._onClickHandler.bind(this);
        this._onMouseMove = this._onMouseMoveHandler.bind(this);
    }

    /**
     * Initialize the baseline drawing
     */
    public init(letter?: string): void {
        this.letter = letter;
        
        // Set up click handler
        this._onClick = this.view.on("click", this._onClickHandler.bind(this));
    }

    /**
     * Handle click events
     */
    private _onClickHandler(clickEvent: any): void {
        const mapPoint = DrawSeam.resolvePoint(this.view, clickEvent);
        if (!mapPoint) return;

        this._points.push(new Point({
            x: mapPoint.x,
            y: mapPoint.y,
            spatialReference: this.view.spatialReference
        }));

        if (this._points.length === 1) {
            // Create initial graphic
            const initialPath = [
                [mapPoint.x, mapPoint.y],
                [mapPoint.x, mapPoint.y]
            ];
            
            const polyline = new Polyline({
                paths: [initialPath],
                spatialReference: this.view.spatialReference
            });

            this._tGraphic = new Graphic({
                geometry: polyline,
                symbol: this._lineSymbol
            });

            // Add to graphics layer
            const graphics = (this.view as any).graphics;
            if (graphics && graphics.add) {
                graphics.add(this._tGraphic);
            }

            // Set up mouse move handler based on letter type
            if (this.letter !== undefined) {
                this._onMouseMove = this.view.on("pointer-move", this._onMouseMoveHandlerC.bind(this));
            } else {
                this._onMouseMove = this.view.on("pointer-move", this._onMouseMoveHandler.bind(this));
            }

            this.emitClick(this._points, this._lineSymbol);

        } else if (this._points.length === 2) {
            // Complete the baseline
            if (this._tGraphic && this._tGraphic.geometry) {
                const geometry = this._tGraphic.geometry as Polyline;
                (geometry as any).controlPoints = this._points.slice();
                this._drawEnd(geometry);
            }
            this._clear();
            this._removeEvents();
        }
    }

    /**
     * Handle mouse move events (standard baseline)
     */
    private _onMouseMoveHandler(inputEvent: any): void {
        if (this._points.length === 0 || !this._tGraphic) return;

        const mapPoint = DrawSeam.resolvePoint(this.view, inputEvent);
        if (!mapPoint) return;

        const firstPoint = this._points[0];
        this.candidatePoint = new Point({
            x: mapPoint.x,
            y: mapPoint.y,
            spatialReference: this.view.spatialReference
        });

        const baseLinePath = this._baseLine(firstPoint, this.candidatePoint);
        const temp = [baseLinePath.startPt, baseLinePath.midPt, baseLinePath.endPt];
        
        const result = new Polyline({
            paths: [temp.map(pt => [pt.x, pt.y])],
            spatialReference: this.view.spatialReference
        });
        
        (result as any)._baseLine = baseLinePath;
        this._tGraphic.geometry = result;
        
        this.emitProgress([baseLinePath.startPt, baseLinePath.endPt], this._lineSymbol);
    }

    /**
     * Handle mouse move events with letter modifier (C, CC, B)
     */
    private _onMouseMoveHandlerC(inputEvent: any): void {
        if (this._points.length === 0 || !this._tGraphic) return;

        const mapPoint = DrawSeam.resolvePoint(this.view, inputEvent);
        if (!mapPoint) return;

        const firstPoint = this._points[0];
        const candidatePoint = new Point({
            x: mapPoint.x,
            y: mapPoint.y,
            spatialReference: this.view.spatialReference
        });

        const baseLinePath = this._baseLine(firstPoint, candidatePoint);
        const temp = [baseLinePath.startPt, baseLinePath.midPt, baseLinePath.endPt];
        
        const result = new Polyline({
            paths: [temp.map(pt => [pt.x, pt.y])],
            spatialReference: this.view.spatialReference
        });
        
        (result as any)._baseLine = baseLinePath;

        // Add fracture and letter-specific modifications
        const values = GeoTools._fracturePts(baseLinePath.startPt, baseLinePath.endPt, 10, this.view.spatialReference);
        if (values.geometry.paths) {
            result.paths = result.paths.concat(values.geometry.paths);
        }
        
        const baseLineLen = GeoTools._2PtLen(baseLinePath.startPt, baseLinePath.endPt);
        
        switch (this.letter) {
            case "C":
                this._createC(values, baseLineLen, result);
                break;
            case "CC":
                this._createCC(values, baseLineLen, result);
                break;
            case "B":
                this._createB(values, baseLineLen, result);
                break;
        }
        
        this._tGraphic.geometry = result;
        this.emitProgress([baseLinePath.startPt, baseLinePath.endPt], this._lineSymbol);
    }

    /**
     * Create C shape modifier
     */
    private _createC(values: any, baseLineLen: number, result: Polyline): void {
        let cLenLimit = values.len / 2;
        if (cLenLimit > baseLineLen / 3.6) {
            cLenLimit = baseLineLen / 3.6;
        }
        const cPath = Shapes.createCC(values.midPoint.x, values.midPoint.y, cLenLimit, result.spatialReference);
        result.addPath(cPath.map(pt => [pt.x, pt.y]));
    }

    /**
     * Create CC shape modifier
     */
    private _createCC(values: any, baseLineLen: number, result: Polyline): void {
        let cLenLimit = values.len / 2;
        if (cLenLimit > baseLineLen / 3.6) {
            cLenLimit = baseLineLen / 3.6;
        }
        const cPath = Shapes.createC(values.midPoint, cLenLimit, 40);
        result.addPath(cPath.map(pt => [pt.x, pt.y]));
    }

    /**
     * Create B shape modifier
     */
    private _createB(values: any, baseLineLen: number, result: Polyline): void {
        let cLenLimit = values.len / 2;
        if (cLenLimit > baseLineLen / 3.6) {
            cLenLimit = baseLineLen / 3.6;
        }
        const bPath = Shapes.createB(values.midPoint, cLenLimit, 40);
        result.addPath(bPath.map(pt => [pt.x, pt.y]));
    }

    /**
     * Create baseline between two points
     */
    private _baseLine(pt1: Point, pt2: Point): { startPt: Point, endPt: Point, midPt: Point } {
        const length = GeoTools._2PtLen(pt1, pt2);
        const angle = GeoTools.angleInRadians(pt1, pt2);
        
        const thirdPt = new Point({
            x: pt2.x + length * Math.cos(angle),
            y: pt2.y + length * Math.sin(angle),
            spatialReference: this.view.spatialReference
        });

        return {
            startPt: pt1,
            endPt: thirdPt,
            midPt: pt2
        };
    }

    /**
     * Emit progress event
     */
    private emitProgress(geometry: Point[], lineSymbol: SimpleLineSymbol): void {
        this.emit("onBaseLineProgress", {
            currentGeometry: geometry,
            currentMarker: lineSymbol
        });
    }

    /**
     * Emit click event
     */
    private emitClick(points: Point[], lineSymbol: SimpleLineSymbol): void {
        this.emit("onBaseLineClick", {
            currentGeometry: points,
            currentMarker: lineSymbol
        });
    }

    /**
     * Handle drawing completion
     */
    private _drawEnd(drawGeometry: Polyline): void {
        if (drawGeometry) {
            const spatialRef = this.view.spatialReference;
            let geographicGeometry = drawGeometry;

            if (spatialRef && spatialRef.isWebMercator) {
                // Geographic conversion would go here if needed
                // geographicGeometry = webMercatorUtils.webMercatorToGeographic(drawGeometry);
            } else if (spatialRef && spatialRef.wkid === 4326) {
                geographicGeometry = drawGeometry.clone();
            }

            this.onDrawEnd(drawGeometry, geographicGeometry);
        }
    }

    /**
     * Handle draw end event
     */
    private onDrawEnd(geometry: Polyline, geoGeometry: Polyline): void {
        console.log("BaseLine onDrawEnd sent");
        this.emit("drawEnd", {
            geometry: geometry,
            geographicGeometry: geoGeometry
        });
    }

    /**
     * Clean up graphics and state
     */
    private _clear(): void {
        if (this._tGraphic) {
            const graphics = (this.view as any).graphics;
            if (graphics && graphics.remove) {
                graphics.remove(this._tGraphic);
            }
        }

        this._tGraphic = null;
        this._points = [];
    }

    /**
     * Remove event handlers
     */
    private _removeEvents(): void {
        if (this._onClick) {
            this._onClick.remove();
            this._onClick = null;
        }
        if (this._onMouseMove) {
            this._onMouseMove.remove();
            this._onMouseMove = null;
        }
    }

    /**
     * Deactivate the baseline tool
     */
    public deactivate(): void {
        this._clear();
        this._removeEvents();
        this._geometryType = null;
    }

    /**
     * Event emitter functionality
     */
    private emit(eventName: string, data: any): void {
        const listeners = this.eventListeners.get(eventName);
        if (listeners) {
            listeners.forEach(listener => listener(data));
        }
    }

    public on(eventName: string, callback: Function): { remove: () => void } {
        if (!this.eventListeners.has(eventName)) {
            this.eventListeners.set(eventName, []);
        }
        this.eventListeners.get(eventName)!.push(callback);
        // Return a removable handle. ~20 symbol classes do
        // `this.baseLineClickHandler = baseLine.on(...)` then guard cleanup with
        // `if (handler) handler.remove()`; previously on() returned void, so that
        // cleanup was permanently dead. Callers that ignore the return are unaffected.
        return { remove: () => this.off(eventName, callback) };
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
}

export default BaseLine; 