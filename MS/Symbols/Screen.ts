import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Polygon from "@arcgis/core/geometry/Polygon";
import Graphic from "@arcgis/core/Graphic";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import DrawEssentials from "../Support/DrawEssentials";
import GeoTools from "../Support/GeoTools";
import Shapes from "../Support/Shapes";
import BattlePosition from "./BattlePosition.ts";

export interface ScreenOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polyline;
    ECHLON?: number;
    [key: string]: any;
}

/**
 * Class Representing Screen.
 * @class
 * @author Abdul Razak
 */
class Screen {
    public declaredClass: string = "MilitarySymbology.Symbols.Screen";
    public SID: string = "342203";
    public symName: string = "Screen";
    public symGeometricType: string = "Area";

    private view: MapView | SceneView;
    private isLine: boolean;
    private _lineSymbol: SimpleLineSymbol | null = null;
    private _points: Point[] = [];
    private _geometryType: string | null = null;
    private _echlon: number = 0;
    private _tGraphic: Graphic | null = null;

    // Event handlers
    private _onClick: any = null;
    private _onDblClick: any = null;
    private _onMouseMove: any = null;

    // Event emitter
    private eventListeners: Map<string, Function[]> = new Map();

    constructor(view: MapView | SceneView, isLine: boolean) {
        this.view = view;
        this.isLine = isLine;
    }

    /**
     * Initialize the symbol drawing
     */
    public init(options: ScreenOptions, marker: SimpleLineSymbol): void {
        this._lineSymbol = marker;
        this.view.navigation.setImmediateClick(false);
        this.view.disableDoubleClickZoom();

        const drawEssentials = new DrawEssentials();
        this._echlon = options.ECHLON || 0;

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
            this._tGraphic = new Graphic({ geometry: options.GEOM });
            drawEssentials.CTRL_PTS = [...(options.CTRL_PTS || [])];
            drawEssentials.ECHELON = this._echlon.toString();
            this.__drawEnd(this._tGraphic.geometry as Polyline, drawEssentials);
            this._clear();
        } else if (options.hasOwnProperty("CTRL_PTS")) {
            drawEssentials.CTRL_PTS = [...(options.CTRL_PTS || [])];
            drawEssentials.ECHELON = this._echlon.toString();
            this._tGraphic = new Graphic({ 
                geometry: this.createSymbol(drawEssentials),
                symbol: this._lineSymbol 
            });
            this.__drawEnd(this._tGraphic.geometry as Polyline, drawEssentials);
            this._clear();
        } else {
            this._tGraphic = new Graphic({ symbol: this._lineSymbol });
            if ((this.view as any).graphics) {
                (this.view as any).graphics.add(this._tGraphic);
            }

            this._onClick = this.view.on("click", this._onClickHandler.bind(this));
            this._onDblClick = this.view.on("double-click", this._onDblClickHandler.bind(this));
        }
    }

    /**
     * Create draw essentials object
     */
    private createDrawEssentials(ctrlPts: Point[], echlon: number): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SCOPE = this.declaredClass;
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.CTRL_PTS = ctrlPts;
        drawEssentials.AMPLIFIER = (this as any).amplifier;
        drawEssentials.ECHELON = echlon.toString();
        return drawEssentials;
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

            const result = new Polyline({ spatialReference: this.view.spatialReference });
            const secondPoint = pts[1];
            const firstPoint = pts[0];

            // First Point - Arrow Head
            result.addPath(Shapes.arrowHeadBackward(
                firstPoint,
                GeoTools.ArrowFlanksLen(
                    GeoTools._2PtLen(firstPoint, secondPoint),
                    GeoTools._2PtLen(firstPoint, secondPoint)
                ),
                GeoTools.angleInRadians(firstPoint, secondPoint)
            ));

            const midPt = GeoTools.getMidPoint(firstPoint, secondPoint);
            let length = GeoTools._2PtLen(firstPoint, midPt) / 3;
            let angle = GeoTools.toDegrees(16);

            const rightWing = new Point({
                x: midPt.x + length * Math.cos(this.toRad(angle)),
                y: midPt.y + length * Math.sin(this.toRad(angle)),
                spatialReference: this.view.spatialReference
            });

            angle = GeoTools.angleInRadians(rightWing, secondPoint);
            const gapPt = new Point({
                x: rightWing.x + length * 2 * Math.cos(angle),
                y: rightWing.y + length * 2 * Math.sin(angle),
                spatialReference: this.view.spatialReference
            });

            // Create S
            let cLenLimit: number;
            const baseLineLen = GeoTools._2PtLen(firstPoint, secondPoint);
            cLenLimit = baseLineLen / 25;
            if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;

            const cPt = new Point({
                x: gapPt.x + cLenLimit * 1.5 * Math.cos(angle),
                y: gapPt.y + cLenLimit * 1.5 * Math.sin(angle),
                spatialReference: this.view.spatialReference
            });

            result.addPath(Shapes.createS(cPt.x, cPt.y, cLenLimit, this.view.spatialReference));
            result.addPath([firstPoint, midPt, rightWing, gapPt]);

            if (pts.length === 3) {
                const thirdPt = pts[2];

                const midPt2 = GeoTools.getMidPoint(thirdPt, secondPoint);
                length = GeoTools._2PtLen(thirdPt, midPt2) / 3;
                angle = GeoTools.toDegrees(-32);

                const leftWing = new Point({
                    x: midPt2.x + length * Math.cos(GeoTools.toRad(angle)),
                    y: midPt2.y + length * Math.sin(GeoTools.toRad(angle)),
                    spatialReference: this.view.spatialReference
                });

                angle = GeoTools.angleInRadians(leftWing, secondPoint);
                const gapPt2 = new Point({
                    x: leftWing.x + length * 2 * Math.cos(angle),
                    y: leftWing.y + length * 2 * Math.sin(angle),
                    spatialReference: this.view.spatialReference
                });

                // Create S
                const baseLineLen2 = GeoTools._2PtLen(thirdPt, secondPoint);
                cLenLimit = baseLineLen2 / 25;
                if (cLenLimit > baseLineLen2 / 3.6) cLenLimit = baseLineLen2 / 3.6;

                const cPt2 = new Point({
                    x: gapPt2.x + cLenLimit * 1.5 * Math.cos(angle),
                    y: gapPt2.y + cLenLimit * 1.5 * Math.sin(angle),
                    spatialReference: this.view.spatialReference
                });

                result.addPath(Shapes.createS(cPt2.x, cPt2.y, cLenLimit, this.view.spatialReference));
                result.addPath([thirdPt, midPt2, leftWing, gapPt2]);

                result.addPath(Shapes.arrowHead(
                    thirdPt,
                    GeoTools.ArrowFlanksLen(
                        GeoTools._2PtLen(secondPoint, thirdPt),
                        GeoTools._2PtLen(secondPoint, thirdPt)
                    ),
                    GeoTools.angleInRadians(secondPoint, thirdPt)
                ));
            }

            return result;
        } catch (e) {
            console.log(this.declaredClass + ' Can not create Symbol due to invalid geometry');
            throw e;
        }
    }

    /**
     * Handle mouse move events
     */
    private _onMouseMoveHandler(inputPoint: any): void {
        const candidatePoint = this.view.toMap(inputPoint);
        if (!candidatePoint) return;

        const drawEssentials = new DrawEssentials();
        drawEssentials.CTRL_PTS = [...this._points, candidatePoint];
        drawEssentials.ECHELON = this._echlon.toString();

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

        if (this._points.length === 1) {
            this._onMouseMove = this.view.on("pointer-move", this._onMouseMoveHandler.bind(this));
        }

        this.emit("onDrawClick", { currentPts: this._points });

        if (this._points.length === 3) {
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
        const drawEss = this.createDrawEssentials([...this._points], this._echlon);
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
    }

    /**
     * Remove event listeners
     */
    private _removeEvents(): void {
        if (this._onClick) this._onClick.remove();
        if (this._onDblClick) this._onDblClick.remove();
        if (this._onMouseMove) this._onMouseMove.remove();
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
     * Create arrow head
     */
    private _arrowHead(candidatePoint: Point, length: number, angle: number, angle2: number): Point[] {
        const path: Point[] = [];

        const rightWing = new Point({
            x: candidatePoint.x + length * Math.cos(this.toRad(angle)),
            y: candidatePoint.y + length * Math.sin(this.toRad(angle)),
            spatialReference: this.view.spatialReference
        });

        const leftWing = new Point({
            x: candidatePoint.x + length * Math.cos(this.toRad(angle2)),
            y: candidatePoint.y + length * Math.sin(this.toRad(angle2)),
            spatialReference: this.view.spatialReference
        });

        path.push(rightWing, candidatePoint, leftWing);
        return path;
    }

    /**
     * Convert radians to degrees
     */
    private toDegrres(rad: number): number {
        const angleDeg = rad * (180 / Math.PI);
        const result = ((angleDeg + 360) % 360).toFixed(1);
        if (isNaN(Number(result))) return 0;
        return Number(result);
    }

    /**
     * Convert degrees to radians
     */
    private toRad(deg: number): number {
        return deg * (Math.PI / 180);
    }

    /**
     * Calculate angle in radians between two points
     */
    private angleRadians(p1: Point, p2: Point): number {
        return Math.atan2(p2.y - p1.y, p2.x - p1.x);
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

export default Screen;