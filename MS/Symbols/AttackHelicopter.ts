import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
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

import SymbolEvents from "../Support/SymbolEvents";
export interface AttackHelicopterOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    HEAD_RATIO?: number;
    TAIL_FACTOR?: number;
    [key: string]: any;
}

export interface ArrowHeadResult {
    rings: Array<{ x: number, y: number }>;
    midPtLeft: { x: number, y: number };
    midPtRight: { x: number, y: number };
    newCandiadatePt: { x: number, y: number };
}

/**
 * AttackHelicopter symbol — the Main Attack arrow with a rotary-wing marker
 * (vertical stem, an up-arrow head and a crossbar) at the tail. Everything is
 * emitted as a single Polygon geometry (the arrow rings plus the marker rings).
 * Supports immediate placement and interactive drawing modes.
 */
export class AttackHelicopter {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;

    // Symbol properties
    private SID: string = "151402";          // Symbol Set: 25  →  code 25151402
    private symName: string = "Attack Helicopter";
    private symGeometricType: string = "Area";
    private _lineSym: SimpleLineSymbol | SimpleFillSymbol | null = null;
    private _points: Point[] = [];
    private amplifier: Amplifier;

    // Symbol parameters
    private _tailFactor: number = 0.05;
    private _headPercentage: number = 0.07;
    private _arrowHeadRatio: number = 1.07;

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
        this.events = new SymbolEvents(view, "AttackHelicopter");

        // Initialize layers if not already done
        this.layerManager.initializeLayers();

        // Initialize temporary graphic
        this.tempGraphic = new Graphic();
    }

    /**
     * Initialize the drawing
     */
    public init(options: AttackHelicopterOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void {
        this._lineSym = marker;

        // Set parameters from options
        this._headPercentage = GeoTools.setDefault(options, "HEAD_RATIO", this._headPercentage);
        this._tailFactor = GeoTools.setDefault(options, "TAIL_FACTOR", this._tailFactor);

        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
            // Immediate placement with both control points and geometry
            if (options.GEOM && this.tempGraphic) {
                try {
                    if (options.GEOM instanceof Polygon) {
                        this.tempGraphic.geometry = options.GEOM;
                    } else {
                        this.tempGraphic.geometry = new Polygon({
                            rings: options.GEOM as number[][][],
                            spatialReference: this.view.spatialReference
                        });
                    }
                } catch (error) {
                    console.error(this.symName, "Failed to create Polygon geometry:", error);
                }
            }

            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._headPercentage, this._tailFactor);
            if (this.tempGraphic && this.tempGraphic.geometry) {
                this.__drawEnd(this.tempGraphic.geometry as Polygon, drawEss);
            }
            this._clear();

        } else if (options.hasOwnProperty("CTRL_PTS")) {
            // Immediate placement with control points only
            const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), this._headPercentage, this._tailFactor);
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

        const drawEssentials = this.createDrawEssentials(
            this._points.concat([candidatePoint]),
            this._headPercentage,
            this._tailFactor
        );

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
    private createDrawEssentials(ctrlPts: Point[], headRatio: number, tailFactor: number): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.AMPLIFIER = this.amplifier.toString();

        // Store additional properties
        (drawEssentials as any).SCOPE = this;
        (drawEssentials as any).CTRL_PTS = ctrlPts;
        (drawEssentials as any).HEAD_RATIO = headRatio;
        (drawEssentials as any).TAIL_FACTOR = tailFactor;

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

            const result = new Polygon({
                spatialReference: this.view.spatialReference
            });

            if (pts.length <= 2) {
                return this.createSimpleArrow(pts, result);
            } else {
                return this.createComplexArrow(pts, result);
            }

        } catch (e) {
            console.log(this.constructor.name + ' Cannot create Symbol due to invalid geometry');
            return null;
        }
    }

    /**
     * Create simple arrow for 2 points or less
     */
    private createSimpleArrow(pts: Point[], result: Polygon): Polygon {
        const firstPoint = pts[0];
        const lastPoint = pts[pts.length - 1];

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

        // Tail two points
        const pt1 = {
            x: this._tailFactor * len * Math.cos(k) + firstPoint.x,
            y: this._tailFactor * len * Math.sin(k) + firstPoint.y
        };
        const partialLen = (1 - this._headPercentage) * len;
        const p1 = {
            x: this._tailFactor * partialLen * Math.cos(k) + firstPoint.x,
            y: this._tailFactor * partialLen * Math.sin(k) + firstPoint.y
        };
        const p2 = {
            x: -1 * this._tailFactor * partialLen * Math.cos(k) + firstPoint.x,
            y: -1 * this._tailFactor * partialLen * Math.sin(k) + firstPoint.y
        };

        // Create main arrow ring
        const ring: number[][] = [];
        ring.push([pt1.x, pt1.y]);

        const values = this.CreateArrowHeadPathEx(p1, lastPoint, p2, len, this._headPercentage, 15);
        const arrowHeadRing = values.rings.map(pt => [pt.x, pt.y]);
        ring.push(...arrowHeadRing);

        ring.push([p2.x, p2.y]);

        // Close the ring
        ring.push([pt1.x, pt1.y]);

        result.addRing(ring);

        // Inner line in Arrow
        const midPt = GeoTools.getMidPoint(
            new Point({ x: values.midPtLeft.x, y: values.midPtLeft.y, spatialReference: this.view.spatialReference }),
            new Point({ x: values.midPtRight.x, y: values.midPtRight.y, spatialReference: this.view.spatialReference })
        );
        const angle = GeoTools.twoPtsAngle(midPt, lastPoint);
        const headBaseLen = len * this._headPercentage / 1.3;

        const newCandidatePt = {
            x: midPt.x + headBaseLen * Math.cos(angle),
            y: midPt.y + headBaseLen * Math.sin(angle)
        };

        const innerRing: number[][] = [
            [values.midPtLeft.x, values.midPtLeft.y],
            [newCandidatePt.x, newCandidatePt.y],
            [values.midPtRight.x, values.midPtRight.y],
            [values.midPtLeft.x, values.midPtLeft.y] // Close ring
        ];

        result.addRing(innerRing);

        // Rotary-wing marker at the tail (same geometry)
        this.addTypeMarker(result, pts);

        return result;
    }

    /**
     * Create complex arrow for multiple points
     */
    private createComplexArrow(pts: Point[], result: Polygon): Polygon {
        const leftArray: { x: number, y: number }[] = [];
        const rightArray: { x: number, y: number }[] = [];
        const lastPoint = pts[pts.length - 1];

        const tempArray: { x: number, y: number }[] = [];
        pts.forEach(pt => {
            tempArray.push({ x: pt.x, y: pt.y });
        });

        const angleArray = GeoTools._vertexAngle(tempArray);
        const totalL = GeoTools._ptCollectionLen(tempArray, 0);

        for (let i = 0, len = tempArray.length - 1; i < len; i++) {
            let partialLen = GeoTools._ptCollectionLen(tempArray, i);
            partialLen += totalL / 2.4;

            const pt1 = {
                x: (this._tailFactor) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x,
                y: (this._tailFactor) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y
            };
            const pt2 = {
                x: -1 * (this._tailFactor) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x,
                y: -1 * (this._tailFactor) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y
            };

            leftArray.push(pt1);
            rightArray.push(pt2);
        }

        leftArray.push({ x: lastPoint.x, y: lastPoint.y });
        rightArray.push({ x: lastPoint.x, y: lastPoint.y });

        // Create Bezier paths
        let leftBezier = Shapes.CreateBezierPathPCOnly(leftArray, 70);
        leftBezier.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);

        let rightBezier = Shapes.CreateBezierPathPCOnly(rightArray, 70);
        rightBezier.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);

        const values = this.CreateArrowHeadPathEx(
            leftBezier[leftBezier.length - 1],
            lastPoint,
            rightBezier[rightBezier.length - 1],
            GeoTools._ptCollectionLen(tempArray, 0),
            this._headPercentage,
            15
        );

        const headPath = values.rings;

        // Combine all paths
        const ring: number[][] = [];

        // Add left bezier path
        leftBezier.forEach(pt => ring.push([pt.x, pt.y]));

        // Add arrow head
        headPath.forEach(pt => ring.push([pt.x, pt.y]));

        // Add reversed right bezier path
        rightBezier.reverse().forEach(pt => ring.push([pt.x, pt.y]));

        // Close the ring
        if (leftBezier.length > 0) {
            ring.push([leftBezier[0].x, leftBezier[0].y]);
        }

        result.addRing(ring);

        // Inner line in Arrow
        const innerRing: number[][] = [
            [values.midPtLeft.x, values.midPtLeft.y],
            [values.newCandiadatePt.x, values.newCandiadatePt.y],
            [values.midPtRight.x, values.midPtRight.y],
            [values.midPtLeft.x, values.midPtLeft.y] // Close ring
        ];

        result.addRing(innerRing);

        // Rotary-wing marker at the tail (same geometry)
        this.addTypeMarker(result, pts);

        return result;
    }

    /**
     * Type marker: a rotary-wing mark at the arrow tail — a stem standing
     * perpendicular to the shaft, an up-arrow head at its tip, and a crossbar.
     * Lines are drawn as thin filled bars so the whole thing stays one polygon.
     */
    private addTypeMarker(result: Polygon, pts: Point[]): void {
        if (pts.length < 2) return;

        const tail = pts[0];
        const fwd = pts[1];
        const len = GeoTools._2PtLen(tail, pts[pts.length - 1]);
        if (len <= 0) return;

        const ax = fwd.x - tail.x, ay = fwd.y - tail.y;
        const al = Math.hypot(ax, ay);
        if (al === 0) return;

        const dx = ax / al, dy = ay / al;       // unit shaft direction
        const px = -dy, py = dx;                 // perpendicular ("up" / left of travel)

        const u = len * 0.08;                    // base size
        const w = u * 0.22;                      // line thickness (thin filled bars)
        const stemLen = u * 2.2;
        const cx = tail.x, cy = tail.y;

        // Thin filled bar (rectangle) from A to B with thickness w.
        const bar = (axx: number, ayy: number, bxx: number, byy: number): void => {
            const vx = bxx - axx, vy = byy - ayy;
            const vl = Math.hypot(vx, vy) || 1;
            const nx = (-vy / vl) * (w / 2), ny = (vx / vl) * (w / 2);
            result.addRing([
                [axx + nx, ayy + ny],
                [bxx + nx, byy + ny],
                [bxx - nx, byy - ny],
                [axx - nx, ayy - ny],
                [axx + nx, ayy + ny]
            ]);
        };

        // Stem: from the tail outward along the perpendicular.
        const topX = cx + px * stemLen, topY = cy + py * stemLen;
        bar(cx, cy, topX, topY);

        // Crossbar near the top, along the shaft direction.
        const cbX = cx + px * (stemLen * 0.62), cbY = cy + py * (stemLen * 0.62);
        const crossHalf = u * 0.75;
        bar(cbX - dx * crossHalf, cbY - dy * crossHalf, cbX + dx * crossHalf, cbY + dy * crossHalf);

        // Up-arrow head at the stem tip, pointing outward (filled triangle).
        const aLen = u * 0.8, aHalf = u * 0.55;
        const apex = [topX + px * aLen, topY + py * aLen];
        const bL = [topX + dx * aHalf, topY + dy * aHalf];
        const bR = [topX - dx * aHalf, topY - dy * aHalf];
        result.addRing([bL, apex, bR, bL]);
    }

    /**
     * Create arrow head path
     */
    private CreateArrowHeadPathEx(
        pt1: { x: number, y: number },
        candidatePt: { x: number, y: number },
        pt2: { x: number, y: number },
        totalLen: number,
        headPercentage: number,
        headAngle: number,
        straight?: boolean
    ): ArrowHeadResult {
        const headSizeBaseRatio = this._arrowHeadRatio;
        const headBaseLen = totalLen * headPercentage;
        const headSideLen = headBaseLen * headSizeBaseRatio;

        const angle1 = GeoTools.twoPtsAngle(candidatePt, new Point({ x: pt1.x, y: pt1.y, spatialReference: this.view.spatialReference }));
        const angle2 = GeoTools.twoPtsAngle(candidatePt, new Point({ x: pt2.x, y: pt2.y, spatialReference: this.view.spatialReference }));

        let midAngle = (Math.abs(angle1 - angle2)) / 2;
        if (Math.abs(angle1 - angle2) > Math.PI * 1.88) {
            midAngle += Math.PI;
        }

        const len = Math.sqrt(headBaseLen * headBaseLen + headSideLen * headSideLen - 2 * headSideLen * headBaseLen * Math.cos(midAngle + headAngle / 180 * Math.PI));
        const upAngle = Math.asin(headBaseLen * Math.sin(midAngle + headAngle / 180 * Math.PI) / len);
        const centAngle = upAngle + headAngle / 180 * Math.PI;

        const result = (straight === false || straight === undefined) ?
            (headBaseLen * Math.sin(Math.PI - centAngle - midAngle) / Math.sin(centAngle)) : 0;

        const leftInnerPt = {
            x: candidatePt.x + result * Math.cos(angle1),
            y: candidatePt.y + result * Math.sin(angle1)
        };
        const leftOuterPt = {
            x: candidatePt.x + headSideLen * Math.cos(angle1 - headAngle / 180 * Math.PI),
            y: candidatePt.y + headSideLen * Math.sin(angle1 - headAngle / 180 * Math.PI)
        };

        const rightInnerPt = {
            x: candidatePt.x + result * Math.cos(angle2),
            y: candidatePt.y + result * Math.sin(angle2)
        };
        const rightOuterPt = {
            x: candidatePt.x + headSideLen * Math.cos(angle2 + headAngle / 180 * Math.PI),
            y: candidatePt.y + headSideLen * Math.sin(angle2 + headAngle / 180 * Math.PI)
        };

        const ring = [leftInnerPt, leftOuterPt, candidatePt, rightOuterPt, rightInnerPt];

        const intersectLineLeft = GeoTools.getMidPoint(
            new Point({ x: leftInnerPt.x, y: leftInnerPt.y, spatialReference: this.view.spatialReference }),
            new Point({ x: leftOuterPt.x, y: leftOuterPt.y, spatialReference: this.view.spatialReference })
        );
        const intersectLineRight = GeoTools.getMidPoint(
            new Point({ x: rightInnerPt.x, y: rightInnerPt.y, spatialReference: this.view.spatialReference }),
            new Point({ x: rightOuterPt.x, y: rightOuterPt.y, spatialReference: this.view.spatialReference })
        );

        const midPt = GeoTools.getMidPoint(
            new Point({ x: pt1.x, y: pt1.y, spatialReference: this.view.spatialReference }),
            new Point({ x: pt2.x, y: pt2.y, spatialReference: this.view.spatialReference })
        );
        const angle = GeoTools.twoPtsAngle(midPt, candidatePt);

        const newCandidatePt = {
            x: midPt.x + headBaseLen * Math.cos(angle),
            y: midPt.y + headBaseLen * Math.sin(angle)
        };

        return {
            rings: ring,
            midPtLeft: intersectLineLeft,
            midPtRight: intersectLineRight,
            newCandiadatePt: newCandidatePt
        };
    }

    /**
     * Clean up drawing state and finalize
     */
    private cleanUp(): void {
        if (this._points.length === 0) return;

        const drawEssentials = this.createDrawEssentials(
            this._points.slice(),
            this._headPercentage,
            this._tailFactor
        );

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

export default AttackHelicopter;
