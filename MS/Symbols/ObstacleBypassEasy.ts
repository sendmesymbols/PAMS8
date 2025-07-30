import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Polygon from "@arcgis/core/geometry/Polygon";
import Graphic from "@arcgis/core/Graphic";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import DrawEssentials from "../Support/DrawEssentials";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";
import BaseLine from "../Support/BaseLine.ts";
import BattlePosition from "./BattlePosition.ts";

export interface ObstacleBypassEasyOptions {
    CTRL_PTS?: Point[];
    BASE_LN_PTS?: {
        startPt: Point;
        endPt: Point;
    };
    GEOM?: Polyline;
    [key: string]: any;
}

/**
 * Class Representing ObstacleBypassEasy.
 * @class
 * @author Abdul Razak
 */
class ObstacleBypassEasy {
    public declaredClass: string = "MilitarySymbology.Symbols.ObstacleBypassEasy";
    public SID: string = "270601";
    public symName: string = "Obs Bypass Easy";
    public symGeometricType: string = "Area";

    private view: MapView | SceneView;
    private isLine: boolean;
    private _lineSymbol: SimpleLineSymbol | null = null;
    private _points: Point[] = [];
    private _baseLinePts: any = null;
    private _geometryType: string | null = null;
    private _tGraphic: Graphic | null = null;

    // Event handlers
    private _onClick: any = null;
    private _onDblClick: any = null;
    private _onMouseMove: any = null;
    private _onBaseLineEnd: any = null;
    private _onBaseLineProgress: any = null;
    private _onBaseLineClick: any = null;

    // Event emitter
    private eventListeners: Map<string, Function[]> = new Map();

    constructor(view: MapView | SceneView, isLine: boolean) {
        this.view = view;
        this.isLine = isLine;
    }

    /**
     * Initialize the symbol drawing
     */
    public init(options: ObstacleBypassEasyOptions, marker: SimpleLineSymbol): void {
        this._lineSymbol = marker;
        this.view.navigation.setImmediateClick(false);
        this.view.disableDoubleClickZoom();

        const drawEssentials = new DrawEssentials();
        const baseLine = new BaseLine(this.view, this._lineSymbol);

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("BASE_LN_PTS") && options.hasOwnProperty("GEOM")) {
            this._tGraphic = new Graphic({ geometry: options.GEOM });
            drawEssentials.CTRL_PTS = [...(options.CTRL_PTS || [])];
            drawEssentials.BASE_LN_PTS = { ...options.BASE_LN_PTS };
            this.__drawEnd(this._tGraphic.geometry as Polyline, drawEssentials);
            this._clear();
        } else if (options.hasOwnProperty("CTRL_PTS")) {
            if (options.hasOwnProperty("BASE_LN_PTS")) {
                drawEssentials.CTRL_PTS = [...(options.CTRL_PTS || [])];
                drawEssentials.BASE_LN_PTS = { ...options.BASE_LN_PTS };
            } else {
                throw new Error("Control Points and Baseline or Distance is required to create symbol non-interactively");
            }

            this._tGraphic = new Graphic({ 
                geometry: this.createSymbol(drawEssentials),
                symbol: this._lineSymbol 
            });
            this.__drawEnd(this._tGraphic.geometry as Polyline, drawEssentials);
            this._clear();
        } else {
            this._onBaseLineEnd = baseLine.on("drawEnd", this.baseLineDrawEnd.bind(this));
            this._onBaseLineClick = baseLine.on("onBaseLineClick", this.baseLineClick.bind(this));
            this._onBaseLineProgress = baseLine.on("onBaseLineProgress", this.baseLineDrawProgress.bind(this));
            baseLine.init();
        }
    }

    /**
     * Create draw essentials object
     */
    private createDrawEssentials(ctrlPts: Point[], baseLinePts: any): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SCOPE = this.declaredClass;
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.CTRL_PTS = ctrlPts;
        drawEssentials.BASE_LN_PTS = baseLinePts;
        drawEssentials.AMPLIFIER = (this as any).amplifier;
        return drawEssentials;
    }

    /**
     * Handle baseline draw end event
     */
    private baseLineDrawEnd(evt: any): void {
        if (this._onBaseLineEnd) {
            this._onBaseLineEnd.remove();
        }
        
        this._tGraphic = new Graphic({ 
            geometry: evt.geometry, 
            symbol: this._lineSymbol 
        });
        
        if ((this.view as any).graphics) {
            (this.view as any).graphics.add(this._tGraphic);
        }
        
        this._baseLinePts = evt.geometry._baseLine;
        this._onMouseMove = this.view.on("pointer-move", this._onMouseMoveHandler.bind(this));
        this._onClick = this.view.on("click", this._onClickHandler.bind(this));
        this._onDblClick = this.view.on("double-click", this._onDblClickHandler.bind(this));
        
        this.emit("onBaseLineDrawEnd", { currentPts: evt.geometry.controlPoints });
    }

    /**
     * Handle baseline draw progress event
     */
    private baseLineDrawProgress(evt: any): void {
        const localDrawEssentials: any = {};
        localDrawEssentials.CTRL_PTS = evt.currentGeometry;
        const pl = new Polyline({ 
            paths: [evt.currentGeometry],
            spatialReference: this.view.spatialReference 
        });
        
        this.emit("onDrawProgress", { 
            currentGeometry: pl, 
            currentDrawEssentials: localDrawEssentials, 
            currentMarker: evt.currentMarker, 
            isBaseLine: true 
        });
    }

    /**
     * Handle baseline click event
     */
    private baseLineClick(evt: any): void {
        this.emit("onDrawClick", { currentPts: evt.currentGeometry, isBaseLine: true });
    }

    /**
     * Create the symbol geometry
     */
    private createSymbol(drawEssentials: DrawEssentials): Polyline {
        try {
            const pts = drawEssentials.CTRL_PTS;
            if (!pts || pts.length === 0) {
                throw new Error("controlPoints not found");
            }

            const stPt = drawEssentials.BASE_LN_PTS?.startPt;
            const endPt = drawEssentials.BASE_LN_PTS?.endPt;

            if (!stPt || !endPt) {
                throw new Error("First Parameter of the Function is an Array with Start and End Point");
            }

            const midPt = GeoTools.getMidPoint(stPt, endPt);
            const result = new Polyline({ spatialReference: this.view.spatialReference });

            // Base Line
            const firstPoint = pts[0];
            let lastPoint = firstPoint;

            if (pts.length >= 1) {
                lastPoint = firstPoint;
            }

            const len = GeoTools._2PtLen(midPt, endPt);
            let k = Math.atan((midPt.y - lastPoint.y) / (midPt.x - lastPoint.x));

            switch (GeoTools.twoPtsRelationShip(midPt, lastPoint)) {
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
            const p1 = { 
                x: partialLen * Math.cos(k) + midPt.x, 
                y: partialLen * Math.sin(k) + midPt.y 
            };
            const p2 = { 
                x: -1 * partialLen * Math.cos(k) + midPt.x, 
                y: -1 * partialLen * Math.sin(k) + midPt.y 
            };

            const paths = [p1, p2];
            result.addPath(paths);

            // Front
            const leftArray: Point[] = [];
            const rightArray: Point[] = [];

            if (pts.length >= 1) {
                leftArray.push(new Point({ x: p1.x, y: p1.y, spatialReference: this.view.spatialReference }));
                rightArray.push(new Point({ x: p2.x, y: p2.y, spatialReference: this.view.spatialReference }));
            }

            for (let i = 0; i < pts.length; i++) {
                const length = GeoTools._2PtLen(midPt, pts[i]);
                const angle = GeoTools.angleInRadians(midPt, pts[i]);

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

                leftArray.push(stPtCandidatePt);
                rightArray.push(endPtCandidatePt);
            }

            result.addPath(leftArray);
            result.addPath(rightArray);

            // Arrows
            result.addPath(Shapes.arrowHead(
                leftArray[leftArray.length - 1],
                GeoTools.ArrowFlanksLen(
                    GeoTools._2PtLen(midPt, pts[pts.length - 1]),
                    GeoTools._2PtLen(stPtCandidatePt, endPtCandidatePt)
                ),
                GeoTools.angleInRadians(leftArray[leftArray.length - 2], leftArray[leftArray.length - 1])
            ));

            result.addPath(Shapes.arrowHead(
                rightArray[rightArray.length - 1],
                GeoTools.ArrowFlanksLen(
                    GeoTools._2PtLen(midPt, pts[pts.length - 1]),
                    GeoTools._2PtLen(stPtCandidatePt, endPtCandidatePt)
                ),
                GeoTools.angleInRadians(rightArray[rightArray.length - 2], rightArray[rightArray.length - 1])
            ));

            return result;
        } catch (e) {
            console.log(this.declaredClass + ' Can not create Symbol due to invalid geometry');
            throw e;
        }
    }

    /**
     * Get baseline points
     */
    public getBaseLinePts(): any {
        return this._baseLinePts;
    }

    /**
     * Handle mouse move events
     */
    private _onMouseMoveHandler(inputPoint: any): void {
        const candidatePoint = this.view.toMap(inputPoint);
        if (!candidatePoint) return;

        const drawEssentials = new DrawEssentials();
        drawEssentials.CTRL_PTS = [...this._points, candidatePoint];
        drawEssentials.BASE_LN_PTS = this._baseLinePts;

        if (this._tGraphic) {
            this._tGraphic.geometry = this.createSymbol(drawEssentials);
        }
        
        this.emit("onDrawProgress", { 
            currentGeometry: this._tGraphic?.geometry, 
            currentDrawEssentials: drawEssentials, 
            currentMarker: this._lineSymbol 
        });
    }

    /**
     * Handle click events
     */
    private _onClickHandler(clickPoint: any): void {
        const mapPoint = this.view.toMap(clickPoint);
        if (!mapPoint) return;

        this._points.push(new Point({
            x: mapPoint.x,
            y: mapPoint.y,
            spatialReference: this.view.spatialReference
        }));
        
        this.emit("onDrawClick", { currentPts: this._points });
        
        if (this.isLine && this._points.length === 1) {
            this.emit("onDrawClick", { currentPts: this._points });
            this.cleanUp();
        }
    }

    /**
     * Handle double click events
     */
    private _onDblClickHandler(clickPoint: any): void {
        const mapPoint = this.view.toMap(clickPoint);
        if (!mapPoint) return;

        this._points.push(new Point({
            x: mapPoint.x,
            y: mapPoint.y,
            spatialReference: this.view.spatialReference
        }));
        
        this.cleanUp();
    }

    /**
     * Clean up drawing state
     */
    private cleanUp(): void {
        const drawEss = this.createDrawEssentials([...this._points], { ...this._baseLinePts });
        this.__drawEnd(this._tGraphic?.geometry as Polyline, drawEss);
        this._clear();
        this._removeEvents();
    }

    /**
     * Handle draw end
     */
    private __drawEnd(drawGeometry: Polyline, drawEssentials: DrawEssentials): void {
        if (drawGeometry) {
            let geographicGeometry: Polyline | null = null;
            const spRef = this.view.spatialReference;
            
            if (spRef.isWebMercator) {
                // Handle web mercator conversion if needed
                geographicGeometry = drawGeometry.clone() as Polyline;
            } else if (spRef.wkid === 4326) {
                geographicGeometry = drawGeometry.clone() as Polyline;
            }
            
            this.__onDrawEnd(drawGeometry, geographicGeometry, drawEssentials);
        }
    }

    /**
     * Emit draw end event
     */
    private __onDrawEnd(geometry: Polyline, geoGeometry: Polyline | null, drawEssParam: DrawEssentials): void {
        this.emit("onDrawEnd", { 
            geometry: geometry, 
            geographicGeometry: geoGeometry, 
            drawEssentials: drawEssParam, 
            marker: this._lineSymbol 
        });
    }

    /**
     * Clear drawing state
     */
    private _clear(): void {
        if (this._tGraphic && (this.view as any).graphics) {
            (this.view as any).graphics.remove(this._tGraphic);
        }
        
        this._tGraphic = null;
        this._points = [];
        this._baseLinePts = null;
    }

    /**
     * Remove event listeners
     */
    private _removeEvents(): void {
        if (this._onClick) this._onClick.remove();
        if (this._onDblClick) this._onDblClick.remove();
        if (this._onMouseMove) this._onMouseMove.remove();
        if (this._onBaseLineEnd) this._onBaseLineEnd.remove();
        this.view.enableDoubleClickZoom();
    }

    /**
     * Deactivate the symbol
     */
    public deactivate(): void {
        this._clear();
        this._removeEvents();
        this._geometryType = null;
    }

    /**
     * Emit events
     */
    private emit(eventName: string, data: any): void {
        const listeners = this.eventListeners.get(eventName);
        if (listeners) {
            listeners.forEach(callback => callback(data));
        }
    }

    /**
     * Add event listener
     */
    public on(eventName: string, callback: Function): void {
        if (!this.eventListeners.has(eventName)) {
            this.eventListeners.set(eventName, []);
        }
        this.eventListeners.get(eventName)!.push(callback);
    }

    /**
     * Remove event listener
     */
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

export default ObstacleBypassEasy;