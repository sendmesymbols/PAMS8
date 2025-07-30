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

export interface OccupyOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polyline;
    ECHLON?: number;
    [key: string]: any;
}

/**
 * Class Representing Occupy.
 * @class
 * @author Abdul Razak
 */
class Occupy {
    public declaredClass: string = "MilitarySymbology.Symbols.Occupy";
    public SID: string = "341700";
    public symName: string = "Occupy";
    public symGeometricType: string = "Area";

    private view: MapView | SceneView;
    private isLine: boolean;
    private _lineSymbol: SimpleLineSymbol | null = null;
    private _points: Point[] = [];
    private _geometryType: string | null = null;
    private _arrowHeadRatio: number = 0;
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
    public init(options: OccupyOptions, marker: SimpleLineSymbol): void {
        this._lineSymbol = marker;
        this.view.navigation.setImmediateClick(false);
        this.view.disableDoubleClickZoom();

        const drawEssentials = new DrawEssentials();
        this._echlon = options.ECHLON || 0;

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
            this._tGraphic = new Graphic({ geometry: options.GEOM });
            drawEssentials.CTRL_PTS = [...(options.CTRL_PTS || [])];
            drawEssentials.ECHLON = this._echlon;
            this.__drawEnd(this._tGraphic.geometry as Polyline, drawEssentials);
            this._clear();
        } else if (options.hasOwnProperty("CTRL_PTS")) {
            drawEssentials.CTRL_PTS = [...(options.CTRL_PTS || [])];
            drawEssentials.ECHLON = this._echlon;
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
     * Find angle between three points
     */
    private find_angle(p0: Point, p1: Point, c: Point): number {
        const p0c = Math.sqrt(Math.pow(c.x - p0.x, 2) + Math.pow(c.y - p0.y, 2));
        const p1c = Math.sqrt(Math.pow(c.x - p1.x, 2) + Math.pow(c.y - p1.y, 2));
        const p0p1 = Math.sqrt(Math.pow(p1.x - p0.x, 2) + Math.pow(p1.y - p0.y, 2));
        return Math.acos((p1c * p1c + p0c * p0c - p0p1 * p0p1) / (2 * p1c * p0c));
    }

    /**
     * Calculate angle between two points with fixed point
     */
    private angleBetweenTwoPointsWithFixedPoint(point1X: number, point1Y: number, point2X: number, point2Y: number, fixedX: number, fixedY: number): number {
        const angle1 = Math.atan2(point1Y - fixedY, point1X - fixedX);
        const angle2 = Math.atan2(point2Y - fixedY, point2X - fixedX);
        return angle1 - angle2;
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
            const startingPt = pts[0];
            const endPt = pts[1];

            if (pts.length === 2) {
                result.addPath([startingPt, endPt]);
            } else if (pts.length > 2) {
                const candidatePoint = pts[2];
                const circle = this._circleDrawEx(
                    this.view.toScreen(startingPt),
                    this.view.toScreen(endPt),
                    this.view.toScreen(candidatePoint)
                );

                if (circle.radius > 0) {
                    const values = this.CreateCircleSegmentFromThreePoints(
                        circle,
                        this.view.toScreen(startingPt),
                        this.view.toScreen(endPt),
                        this.view.toScreen(candidatePoint),
                        60,
                        this.view
                    );

                    const paths = values.geometry.paths[0];
                    result.addPath(paths.slice(0, 25));
                    result.addPath(paths.slice(35, 60));

                    // Create O
                    const cPoint = new Point({
                        x: paths[30][0],
                        y: paths[30][1],
                        spatialReference: this.view.spatialReference
                    });

                    const firstPoint = new Point({
                        x: paths[25][0],
                        y: paths[25][1],
                        spatialReference: this.view.spatialReference
                    });

                    const secondPoint = new Point({
                        x: paths[35][0],
                        y: paths[35][1],
                        spatialReference: this.view.spatialReference
                    });

                    const baseLineLen = GeoTools._2PtLen(firstPoint, secondPoint);
                    let cLenLimit = baseLineLen / 5;
                    if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;

                    result.addPath(Shapes.createO(cPoint.x, cPoint.y, cLenLimit, this.view.spatialReference));

                    // End of Create O
                    const length = GeoTools._2PtLen(endPt, cPoint) / 10;
                    let angle = GeoTools.twoPtsAngle(values.backPoint, values.lastPoint);

                    if (angle < 3.14159) {
                        angle += 2.35619;
                    } else {
                        angle -= 2.35619;
                    }

                    const innerWing = new Point({
                        x: endPt.x + length * Math.cos(angle),
                        y: endPt.y + length * Math.sin(angle),
                        spatialReference: this.view.spatialReference
                    });

                    const innerWingPlus = new Point({
                        x: -1 * length * Math.cos(angle) + endPt.x,
                        y: -1 * length * Math.sin(angle) + endPt.y,
                        spatialReference: this.view.spatialReference
                    });

                    angle = GeoTools.twoPtsAngle(values.backPoint, values.lastPoint);

                    if (angle > 3.14159) {
                        angle += 2.35619;
                    } else {
                        angle -= 2.35619;
                    }

                    const outerWing = new Point({
                        x: endPt.x + length * Math.cos(angle),
                        y: endPt.y + length * Math.sin(angle),
                        spatialReference: this.view.spatialReference
                    });

                    const outerWingPlus = new Point({
                        x: -1 * length * Math.cos(angle) + endPt.x,
                        y: -1 * length * Math.sin(angle) + endPt.y,
                        spatialReference: this.view.spatialReference
                    });

                    result.addPath([innerWingPlus, endPt, innerWing]);
                    result.addPath([outerWingPlus, endPt, outerWing]);
                }
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
     * Circle drawing helper
     */
    private _circleDrawEx(pt1: any, pt2: any, pt3: any): { radius: number; center: { x: number; y: number } } {
        let r, m11, m12, m13, m14;
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

        for (let i = 0; i < 3; i++) {
            a[i][0] = P[i][0];
            a[i][1] = P[i][1];
            a[i][2] = 1;
        }
        m11 = this._determinantDrawEx(a, 3);

        for (let i = 0; i < 3; i++) {
            a[i][0] = P[i][0] * P[i][0] + P[i][1] * P[i][1];
            a[i][1] = P[i][1];
            a[i][2] = 1;
        }
        m12 = this._determinantDrawEx(a, 3);

        for (let i = 0; i < 3; i++) {
            a[i][0] = P[i][0] * P[i][0] + P[i][1] * P[i][1];
            a[i][1] = P[i][0];
            a[i][2] = 1;
        }
        m13 = this._determinantDrawEx(a, 3);

        for (let i = 0; i < 3; i++) {
            a[i][0] = P[i][0] * P[i][0] + P[i][1] * P[i][1];
            a[i][1] = P[i][0];
            a[i][2] = P[i][1];
        }
        m14 = this._determinantDrawEx(a, 3);

        if (m11 === 0) {
            r = 0;
        } else {
            const Xo = 0.5 * m12 / m11;
            const Yo = -0.5 * m13 / m11;
            r = Math.sqrt(Xo * Xo + Yo * Yo + m14 / m11);
        }

        return { radius: r, center: { x: Xo, y: Yo } };
    }

    /**
     * Determinant calculation helper
     */
    private _determinantDrawEx(a: number[][], n: number): number {
        let d = 0;
        const m = [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0]
        ];

        if (n === 2) {
            d = a[0][0] * a[1][1] - a[1][0] * a[0][1];
        } else {
            d = 0;
            for (let j1 = 0; j1 < n; j1++) {
                for (let i = 1; i < n; i++) {
                    let j2 = 0;
                    for (let j = 0; j < n; j++) {
                        if (j === j1) continue;
                        m[i - 1][j2] = a[i][j];
                        j2++;
                    }
                }
                d = d + Math.pow(-1.0, j1) * a[0][j1] * this._determinantDrawEx(m, n - 1);
            }
        }

        return d;
    }

    /**
     * Create circle segment from three points
     */
    private CreateCircleSegmentFromThreePoints(circle: any, pt1: any, pt2: any, pt3: any, numberOfPts: number, view: MapView | SceneView): any {
        const center = circle.center;
        const radius = circle.radius;
        const path: Point[] = [];

        pt1.x -= center.x;
        pt1.y -= center.y;
        pt2.x -= center.x;
        pt2.y -= center.y;
        pt3.x -= center.x;
        pt3.y -= center.y;

        let anglePt1 = Math.atan2(pt1.y, pt1.x);
        let anglePt2 = Math.atan2(pt2.y, pt2.x);
        let anglePt3 = Math.atan2(pt3.y, pt3.x);

        anglePt1 = anglePt1 < 0 ? 2 * Math.PI + anglePt1 : anglePt1;
        anglePt2 = anglePt2 < 0 ? 2 * Math.PI + anglePt2 : anglePt2;
        anglePt3 = anglePt3 < 0 ? 2 * Math.PI + anglePt3 : anglePt3;

        const startAngle = Math.min(anglePt1, anglePt2);
        const endAngle = Math.max(anglePt1, anglePt2);
        let swipeAngle = endAngle - startAngle;

        if (anglePt3 < startAngle || anglePt3 > endAngle) {
            swipeAngle -= (2 * Math.PI);
        }

        const angle = swipeAngle / numberOfPts;

        for (let i = 0; i <= numberOfPts; i++) {
            const pt = view.toMap({
                x: radius * Math.cos(startAngle + i * angle) + center.x,
                y: radius * Math.sin(startAngle + i * angle) + center.y
            });
            path.push(pt);
        }

        const result = new Polyline({ spatialReference: view.spatialReference });
        result.addPath(path);

        return { 
            geometry: result, 
            lastPoint: path[numberOfPts], 
            backPoint: path[numberOfPts - 5] 
        };
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

export default Occupy;