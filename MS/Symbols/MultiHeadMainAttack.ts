import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import * as geometryEngine from "@arcgis/core/geometry/geometryEngine";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import DrawEssentials from "../Support/DrawEssentials";
import Amplifier from "../Support/Amplifier";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";

export interface MultiHeadMainAttackOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    HEADER_CTRL_PTS?: Point[][];
    HEAD_RATIO?: number;
    TAIL_FACTOR?: number;
    [key: string]: any;
}

export interface ArrowHeadResult {
    rings: Array<{ x: number; y: number }>;
    midPtLeft: { x: number; y: number };
    midPtRight: { x: number; y: number };
    newCandiadatePt: { x: number; y: number };
}

export class MultiHeadMainAttack {
    private view: MapView | SceneView;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private isLine: boolean;

    private SID: string = "25151408";
    private symName: string = "Multi Head Main Attk";
    private symGeometricType: string = "Area";
    private _lineSym: SimpleLineSymbol | SimpleFillSymbol | null = null;
    private _geometryType: string | null = null;
    private amplifier: Amplifier;

    private _tailFactor: number = 0.05;
    private _headPercentage: number = 0.07;
    private _arrowHeadRatio: number = 1.07;

    // Drawing state — mirrors the original Draw.js MULTIHEAD logic exactly: - SHIFT+CLICK
    // _points is mutated in-place by both click and pointer-move.
    // All heads share _points[0] as their common root.
    // _headerCollection holds one Polygon slot per head (null = placeholder).
    // _newHead=true → next interaction resets _points to [_points[0], newPt].
    private _points: Point[] = [];
    private _headerCollection: (Polygon | null)[] = [];
    private _newHead: boolean = false;
    // Snapshot of each head's points at the moment it was sealed — used for save/load only..
    private _savedHeadPoints: Point[][] = [];

    private isDrawing: boolean = false;
    private tempGraphic: Graphic | null = null;

    private clickHandler: any = null;
    private doubleClickHandler: any = null;
    private mouseMoveHandler: any = null;

    private eventListeners: Map<string, Function[]> = new Map();

    constructor(view: MapView | SceneView, isLine: boolean = false) {
        this.view = view;
        this.isLine = isLine;
        this.layerManager = GraphicsLayerManager.getInstance(view);
        this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.FORCE);
        this.amplifier = new Amplifier();
        this.layerManager.initializeLayers();
        this.tempGraphic = new Graphic();
    }

    // ── Public API ──────────────────────────────────────────────────────────

    public init(options: MultiHeadMainAttackOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void {
        this._lineSym = marker;
        this._headPercentage = GeoTools.setDefault(options, "HEAD_RATIO", this._headPercentage);
        this._tailFactor     = GeoTools.setDefault(options, "TAIL_FACTOR", this._tailFactor);

        if (options.HEADER_CTRL_PTS && options.HEADER_CTRL_PTS.length > 0) {
            // Reconstruct from saved multi-head control points
            const merged = this._buildMergedFromPointArrays(options.HEADER_CTRL_PTS);
            if (merged) {
                const drawEss = this._makeDrawEssentials(options.HEADER_CTRL_PTS, merged);
                this.__drawEnd(merged, drawEss);
            }
            this._clearState();

        } else if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
            // Single-head with pre-built geometry (backward compat)
            let geom: Polygon | null = null;
            try {
                geom = options.GEOM instanceof Polygon
                    ? options.GEOM
                    : new Polygon({ rings: options.GEOM as any, spatialReference: this.view.spatialReference });
            } catch (e) {
                console.error(this.symName, "Failed to create Polygon geometry:", e);
            }
            if (geom) {
                const drawEss = this._makeDrawEssentials([options.CTRL_PTS!.slice()], null);
                this.__drawEnd(geom, drawEss);
            }
            this._clearState();

        } else if (options.hasOwnProperty("CTRL_PTS")) {
            // Single-head from control points
            const pts = options.CTRL_PTS!.slice();
            const geom = this._computeHeadGeom(pts);
            if (geom) {
                const drawEss = this._makeDrawEssentials([pts], null);
                this.__drawEnd(geom, drawEss);
            }
            this._clearState();

        } else {
            this._startInteractiveDrawing();
        }
    }

    public deactivate(): void {
        this._clearState();
        this._removeEvents();
        this._geometryType = null;
        this.isDrawing = false;
    }

    public getSymbolLayer(): GraphicsLayer { return this.symbolLayer; }
    public clearSymbols(): void { this.symbolLayer.removeAll(); }

    // ── Interactive drawing ─────────────────────────────────────────────────

    private _startInteractiveDrawing(): void {
        if (!this._lineSym) return;
        this.isDrawing = true;
        this.tempGraphic = new Graphic({ geometry: null, symbol: this._lineSym });
        this.symbolLayer.add(this.tempGraphic);
        this._bindEvents();
    }

    private _bindEvents(): void {
        this.clickHandler       = this.view.on("click",        (e: any) => this._onClick(e));
        this.doubleClickHandler = this.view.on("double-click", (e: any) => this._onDoubleClick(e));
        // pointer-move is always active (mirrors original activate() setup)
        this.mouseMoveHandler   = this.view.on("pointer-move", (e: any) => this._onMouseMove(e));
    }

    private _onClick(clickEvent: any): void {
        // Shift+Click = newHead() — commit current slot, open a new one from same root
        if (clickEvent.native?.shiftKey) {
            this._newHead = true;
            this._headerCollection.push(null);
            // Snapshot current head's points for save/load
            if (this._points.length >= 2) {
                this._savedHeadPoints.push(this._points.slice());
            }
            return;
        }

        const mapPoint = this.view.toMap(clickEvent);
        if (!mapPoint) return;

        const pt = new Point({ x: mapPoint.x, y: mapPoint.y, spatialReference: this.view.spatialReference });
        this._points.push(pt);

        if (this._points.length === 1) return; // need at least 2 points

        // If starting a new head: reset to [shared root, this click]
        if (this._newHead) {
            this._newHead = false;
            this._points = [this._points[0], pt];
        }

        const polygon = this._computeHeadGeom(this._points);
        if (!polygon) return;

        this._updateCollection(polygon);
        this._refreshDisplay();
        this.emit("onDrawClick", { currentPts: this._points });
    }

    private _onDoubleClick(clickEvent: any): void {
        clickEvent.stopPropagation?.();
        this._finalizeAndEmit();
    }

    private _onMouseMove(inputEvent: any): void {
        if (!this.isDrawing || !this.tempGraphic || this._points.length === 0) return;

        const mapPoint = this.view.toMap(inputEvent);
        if (!mapPoint) return;

        const pt = new Point({ x: mapPoint.x, y: mapPoint.y, spatialReference: this.view.spatialReference });

        // If new head pending: reset to [shared root, mouse] and clear flag
        if (this._newHead) {
            this._newHead = false;
            this._points = [this._points[0], pt];
        } else if (this._points.length === 1) {
            // First point placed, no click yet — preview with mouse as second
            this._points.push(pt);
        } else {
            // Replace last element with current mouse position
            this._points[this._points.length - 1] = pt;
        }

        const polygon = this._computeHeadGeom(this._points);
        if (!polygon) return;

        this._updateCollection(polygon);
        this._refreshDisplay();
        this.emit("onDrawProgress", { currentGeometry: this.tempGraphic?.geometry, currentMarker: this._lineSym });
    }

    // ── Collection helpers ──────────────────────────────────────────────────

    // Push or update the last slot in _headerCollection
    private _updateCollection(polygon: Polygon): void {
        if (this._headerCollection.length === 0) {
            this._headerCollection.push(polygon);
        } else {
            this._headerCollection[this._headerCollection.length - 1] = polygon;
        }
    }

    private _refreshDisplay(): void {
        if (!this.tempGraphic) return;
        const validPolys = this._headerCollection.filter((p): p is Polygon => p !== null);
        const merged = this._unionPolys(validPolys);
        if (merged) this.tempGraphic.geometry = merged;
    }

    private _finalizeAndEmit(): void {
        // Snapshot the last active head before finishing
        if (this._points.length >= 2) {
            this._savedHeadPoints.push(this._points.slice());
        }

        const validPolys = this._headerCollection.filter((p): p is Polygon => p !== null);
        if (validPolys.length === 0) {
            this._clearState();
            this._removeEvents();
            return;
        }

        const merged = this._unionPolys(validPolys);
        if (!merged) {
            this._clearState();
            this._removeEvents();
            return;
        }

        const drawEss = this._makeDrawEssentials(this._savedHeadPoints, merged);
        this.__drawEnd(merged, drawEss);
        this._clearState();
        this._removeEvents();
    }

    // ── Per-head geometry ───────────────────────────────────────────────────

    private _computeHeadGeom(pts: Point[]): Polygon | null {
        if (pts.length < 2) return null;
        try {
            const result = new Polygon({ spatialReference: this.view.spatialReference });
            return pts.length === 2
                ? this._createSimpleArrow(pts, result)
                : this._createComplexArrow(pts, result);
        } catch {
            return null;
        }
    }

    private _buildMergedFromPointArrays(headsPoints: Point[][]): Polygon | null {
        const polys = headsPoints
            .map(pts => this._computeHeadGeom(pts))
            .filter((p): p is Polygon => p !== null);
        return this._unionPolys(polys);
    }

    private _unionPolys(polys: Polygon[]): Polygon | null {
        if (polys.length === 0) return null;
        if (polys.length === 1) return polys[0];
        try {
            return geometryEngine.union(polys) as Polygon;
        } catch {
            return polys[polys.length - 1];
        }
    }

    // 2-point straight arrow shaft + head
    private _createSimpleArrow(pts: Point[], result: Polygon): Polygon {
        const firstPoint = pts[0];
        const lastPoint  = pts[pts.length - 1];

        const len = GeoTools._2PtLen(firstPoint, lastPoint);
        let k = Math.atan((firstPoint.y - lastPoint.y) / (firstPoint.x - lastPoint.x));

        switch (GeoTools.twoPtsRelationShip(firstPoint, lastPoint)) {
            case "ne": k += Math.PI / 2;     break;
            case "nw": k += Math.PI * 3 / 2; break;
            case "sw": k += Math.PI * 3 / 2; break;
            case "se": k += Math.PI / 2;     break;
        }

        const pt1 = { x:  this._tailFactor * len * Math.cos(k) + firstPoint.x, y:  this._tailFactor * len * Math.sin(k) + firstPoint.y };
        const pt2 = { x: -this._tailFactor * len * Math.cos(k) + firstPoint.x, y: -this._tailFactor * len * Math.sin(k) + firstPoint.y };
        const partialLen = (1 - this._headPercentage) * len;
        const p1 = { x:  this._tailFactor * partialLen * Math.cos(k) + firstPoint.x, y:  this._tailFactor * partialLen * Math.sin(k) + firstPoint.y };
        const p2 = { x: -this._tailFactor * partialLen * Math.cos(k) + firstPoint.x, y: -this._tailFactor * partialLen * Math.sin(k) + firstPoint.y };

        const ring: number[][] = [[pt1.x, pt1.y]];
        const values = this._createArrowHeadPath(p1, lastPoint, p2, len, this._headPercentage, 15);
        values.rings.forEach(pt => ring.push([pt.x, pt.y]));
        ring.push([p2.x, p2.y]);
        ring.push([pt1.x, pt1.y]);
        result.addRing(ring);

        // Inner notch
        const midPt = GeoTools.getMidPoint(
            new Point({ x: values.midPtLeft.x,  y: values.midPtLeft.y,  spatialReference: this.view.spatialReference }),
            new Point({ x: values.midPtRight.x, y: values.midPtRight.y, spatialReference: this.view.spatialReference })
        );
        const angle       = GeoTools.twoPtsAngle(midPt, lastPoint);
        const headBaseLen = len * this._headPercentage / 1.3;
        const newCandPt   = { x: midPt.x + headBaseLen * Math.cos(angle), y: midPt.y + headBaseLen * Math.sin(angle) };

        result.addRing([
            [values.midPtLeft.x,  values.midPtLeft.y],
            [newCandPt.x,         newCandPt.y],
            [values.midPtRight.x, values.midPtRight.y],
            [values.midPtLeft.x,  values.midPtLeft.y]
        ]);

        return result;
    }

    // 3+ point Bezier-curved shaft + head
    private _createComplexArrow(pts: Point[], result: Polygon): Polygon {
        const leftArray:  { x: number; y: number }[] = [];
        const rightArray: { x: number; y: number }[] = [];
        const lastPoint = pts[pts.length - 1];
        const tempArray = pts.map(pt => ({ x: pt.x, y: pt.y }));

        const angleArray = GeoTools._vertexAngle(tempArray);
        const totalL     = GeoTools._ptCollectionLen(tempArray, 0);

        for (let i = 0, len = tempArray.length - 1; i < len; i++) {
            let partialLen = GeoTools._ptCollectionLen(tempArray, i);
            partialLen += totalL / 2.4;
            leftArray.push({
                x:  this._tailFactor * partialLen * Math.cos(angleArray[i]) + tempArray[i].x,
                y:  this._tailFactor * partialLen * Math.sin(angleArray[i]) + tempArray[i].y
            });
            rightArray.push({
                x: -this._tailFactor * partialLen * Math.cos(angleArray[i]) + tempArray[i].x,
                y: -this._tailFactor * partialLen * Math.sin(angleArray[i]) + tempArray[i].y
            });
        }

        leftArray.push({ x: lastPoint.x, y: lastPoint.y });
        rightArray.push({ x: lastPoint.x, y: lastPoint.y });

        let leftBezier  = Shapes.CreateBezierPathPCOnly(leftArray,  70);
        leftBezier.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);

        let rightBezier = Shapes.CreateBezierPathPCOnly(rightArray, 70);
        rightBezier.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);

        const values = this._createArrowHeadPath(
            leftBezier[leftBezier.length - 1],
            lastPoint,
            rightBezier[rightBezier.length - 1],
            GeoTools._ptCollectionLen(tempArray, 0),
            this._headPercentage,
            15
        );

        const ring: number[][] = [];
        leftBezier.forEach(pt  => ring.push([pt.x, pt.y]));
        values.rings.forEach(pt => ring.push([pt.x, pt.y]));
        rightBezier.reverse().forEach(pt => ring.push([pt.x, pt.y]));
        if (leftBezier.length > 0) ring.push([leftBezier[0].x, leftBezier[0].y]);
        result.addRing(ring);

        result.addRing([
            [values.midPtLeft.x,       values.midPtLeft.y],
            [values.newCandiadatePt.x, values.newCandiadatePt.y],
            [values.midPtRight.x,      values.midPtRight.y],
            [values.midPtLeft.x,       values.midPtLeft.y]
        ]);

        return result;
    }

    private _createArrowHeadPath(
        pt1: { x: number; y: number },
        candidatePt: { x: number; y: number } | Point,
        pt2: { x: number; y: number },
        totalLen: number,
        headPercentage: number,
        headAngle: number,
        straight?: boolean
    ): ArrowHeadResult {
        const headBaseLen  = totalLen * headPercentage;
        const headSideLen  = headBaseLen * this._arrowHeadRatio;
        const cpt          = candidatePt as any;
        const headAngleRad = headAngle / 180 * Math.PI;

        const angle1 = GeoTools.twoPtsAngle(cpt, new Point({ x: pt1.x, y: pt1.y, spatialReference: this.view.spatialReference }));
        const angle2 = GeoTools.twoPtsAngle(cpt, new Point({ x: pt2.x, y: pt2.y, spatialReference: this.view.spatialReference }));

        let midAngle = Math.abs(angle1 - angle2) / 2;
        if (Math.abs(angle1 - angle2) > Math.PI * 1.88) midAngle += Math.PI;

        const len       = Math.sqrt(headBaseLen ** 2 + headSideLen ** 2 - 2 * headSideLen * headBaseLen * Math.cos(midAngle + headAngleRad));
        const upAngle   = Math.asin(headBaseLen * Math.sin(midAngle + headAngleRad) / len);
        const centAngle = upAngle + headAngleRad;
        const offset    = (straight === false || straight === undefined)
            ? headBaseLen * Math.sin(Math.PI - centAngle - midAngle) / Math.sin(centAngle)
            : 0;

        const leftInnerPt  = { x: cpt.x + offset     * Math.cos(angle1),               y: cpt.y + offset     * Math.sin(angle1) };
        const leftOuterPt  = { x: cpt.x + headSideLen * Math.cos(angle1 - headAngleRad), y: cpt.y + headSideLen * Math.sin(angle1 - headAngleRad) };
        const rightInnerPt = { x: cpt.x + offset     * Math.cos(angle2),               y: cpt.y + offset     * Math.sin(angle2) };
        const rightOuterPt = { x: cpt.x + headSideLen * Math.cos(angle2 + headAngleRad), y: cpt.y + headSideLen * Math.sin(angle2 + headAngleRad) };

        const midPtLeft  = GeoTools.getMidPoint(
            new Point({ x: leftInnerPt.x,  y: leftInnerPt.y,  spatialReference: this.view.spatialReference }),
            new Point({ x: leftOuterPt.x,  y: leftOuterPt.y,  spatialReference: this.view.spatialReference })
        );
        const midPtRight = GeoTools.getMidPoint(
            new Point({ x: rightInnerPt.x, y: rightInnerPt.y, spatialReference: this.view.spatialReference }),
            new Point({ x: rightOuterPt.x, y: rightOuterPt.y, spatialReference: this.view.spatialReference })
        );
        const midPt = GeoTools.getMidPoint(
            new Point({ x: pt1.x, y: pt1.y, spatialReference: this.view.spatialReference }),
            new Point({ x: pt2.x, y: pt2.y, spatialReference: this.view.spatialReference })
        );
        const angle          = GeoTools.twoPtsAngle(midPt, cpt);
        const newCandidatePt = { x: midPt.x + headBaseLen * Math.cos(angle), y: midPt.y + headBaseLen * Math.sin(angle) };

        return {
            rings: [leftInnerPt, leftOuterPt, cpt, rightOuterPt, rightInnerPt],
            midPtLeft,
            midPtRight,
            newCandiadatePt: newCandidatePt
        };
    }

    // ── DrawEssentials / save-load ──────────────────────────────────────────

    private _makeDrawEssentials(headerCtrlPts: Point[][], geom: Polygon | null): DrawEssentials {
        const de = new DrawEssentials();
        de.SYM_GEO_TYPE  = this.symGeometricType;
        de.SID           = this.SID;
        de.SYM_NAME      = this.symName;
        de.AMPLIFIER     = this.amplifier.toString();
        (de as any).SCOPE           = this;
        (de as any).HEADER_CTRL_PTS = headerCtrlPts;
        (de as any).HEAD_RATIO      = this._headPercentage;
        (de as any).TAIL_FACTOR     = this._tailFactor;
        if (geom) (de as any).GEOM  = geom;
        return de;
    }

    // ── Draw-end pipeline ───────────────────────────────────────────────────

    private __drawEnd(drawGeometry: Polygon, drawEssentials: DrawEssentials): void {
        if (!drawGeometry) return;
        const spatialRef         = this.view.spatialReference;
        const geographicGeometry = (spatialRef?.wkid === 4326) ? drawGeometry.clone() : drawGeometry;
        this.emit("onDrawEnd", {
            geometry: drawGeometry,
            geographicGeometry,
            drawEssentials,
            marker: this._lineSym
        });
    }

    // ── Cleanup ─────────────────────────────────────────────────────────────

    private _clearState(): void {
        if (this.tempGraphic && this.symbolLayer) {
            this.symbolLayer.remove(this.tempGraphic);
        }
        this.tempGraphic       = null;
        this._points           = [];
        this._headerCollection = [];
        this._savedHeadPoints  = [];
        this._newHead          = false;
    }

    private _removeEvents(): void {
        if (this.clickHandler)       { this.clickHandler.remove();       this.clickHandler       = null; }
        if (this.doubleClickHandler) { this.doubleClickHandler.remove(); this.doubleClickHandler  = null; }
        if (this.mouseMoveHandler)   { this.mouseMoveHandler.remove();   this.mouseMoveHandler    = null; }
    }

    // ── Event emitter ────────────────────────────────────────────────────────

    private emit(eventName: string, data: any): void {
        const listeners = this.eventListeners.get(eventName);
        if (listeners) listeners.forEach(l => l(data));

        const customEvent = new CustomEvent(eventName, {
            detail: { symbolType: "MultiHeadMainAttack", eventName, ...data },
            bubbles: true,
            cancelable: true
        });
        if (this.view?.container) {
            this.view.container.dispatchEvent(customEvent);
        } else {
            document.dispatchEvent(customEvent);
        }
    }

    public on(eventName: string, callback: Function): void {
        if (!this.eventListeners.has(eventName)) this.eventListeners.set(eventName, []);
        this.eventListeners.get(eventName)!.push(callback);
    }

    public off(eventName: string, callback?: Function): void {
        if (!callback) {
            this.eventListeners.delete(eventName);
        } else {
            const listeners = this.eventListeners.get(eventName);
            if (listeners) {
                const idx = listeners.indexOf(callback);
                if (idx > -1) listeners.splice(idx, 1);
            }
        }
    }
}

export default MultiHeadMainAttack;
