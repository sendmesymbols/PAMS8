import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Graphic from "@arcgis/core/Graphic";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import DrawEssentials from "../Support/DrawEssentials";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";
import BaseLine from "../Support/BaseLine.ts";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import Amplifier from "../Support/Amplifier";
import DrawSeam from "../Support/DrawSeam";

import SymbolEvents from "../Support/SymbolEvents";
export interface ObstacleBypassDifficultOptions {
    CTRL_PTS?: Point[];
    BASE_LN_PTS?: {
        startPt: Point;
        endPt: Point;
    };
    GEOM?: Polyline;
    [key: string]: any;
}

/**
 * Class Representing ObstacleBypassDifficult.
 * Same as ObstacleBypassEasy (a back line with two flanking arrows), except the back line
 * is drawn as a jagged triangle-wave (zigzag) to denote a difficult bypass.
 * @class
 * @author Abdul Razak
 */
class ObstacleBypassDifficult {
    public declaredClass: string = "MilitarySymbology.Symbols.ObstacleBypassDifficult";
    public SID: string = "270602";
    public symName: string = "Obs Bypass Difficult";
    public symGeometricType: string = "Area";

    private view: MapView | SceneView;
    private isLine: boolean;
    private layerManager: GraphicsLayerManager;
    private symbolLayer: GraphicsLayer;
    private amplifier: Amplifier;
    private _lineSymbol: SimpleLineSymbol | null = null;
    private _points: Point[] = [];
    private _baseLinePts: any = null;
    private _geometryType: string | null = null;
    private _tGraphic: Graphic | null = null;

    // Jagged back-line tuning: number of peaks and amplitude as a fraction of its length.
    private _jagCount: number = 8;
    private _jagAmplitudeRatio: number = 0.12;

    // Event handlers
    private _onClick: any = null;
    private _onDblClick: any = null;
    private _onMouseMove: any = null;
    private _onBaseLineEnd: any = null;
    private baseLineProgressHandler: any = null;
    private baseLineClickHandler: any = null;

    // Event emitter
    private events: SymbolEvents;

    constructor(view: MapView | SceneView, isLine: boolean) {
        this.view = view;
        this.isLine = isLine;
        this.layerManager = GraphicsLayerManager.getInstance(view);
        // All area symbols will go in TACT layer
        this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.TACT);
        this.amplifier = new Amplifier();
        this.events = new SymbolEvents(view, "ObstacleBypassDifficult");
        this.layerManager.initializeLayers();
        // Initialize temporary graphic
        this._tGraphic = new Graphic();
    }

  public init(options: ObstacleBypassDifficultOptions, marker: SimpleLineSymbol): void {
    this._lineSymbol = marker.clone();
    const drawEssentials = new DrawEssentials();

    if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("BASE_LN_PTS") && options.hasOwnProperty("GEOM") && options.GEOM !== null) {
      // Immediate placement with both control points and geometry
      if (options.GEOM && this._tGraphic) {
        try {
          // If GEOM is already a Polyline, use it directly; otherwise, build from paths
          this._tGraphic.geometry = (options.GEOM instanceof Polyline)
            ? options.GEOM
            : new Polyline({ paths: (options.GEOM as any), spatialReference: this.view.spatialReference });
        } catch (error) {
          console.error(this.symName, "Failed to create Polyline geometry:", error);
        }
      }

      const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.BASE_LN_PTS!);
      if (this._tGraphic && this._tGraphic.geometry) {
        this.__drawEnd(this._tGraphic.geometry as Polyline, drawEss);
      }
      this._clear();

    } else if (options.hasOwnProperty("CTRL_PTS")) {
      if (options.hasOwnProperty("BASE_LN_PTS")) {
        // Immediate placement with control points and baseline
        const drawEss = this.createDrawEssentials(options.CTRL_PTS!.slice(), options.BASE_LN_PTS!);
        const geometry = this.createSymbol(drawEss);
        if (geometry && this._tGraphic) {
          this._tGraphic.geometry = geometry;
          this.__drawEnd(geometry, drawEss);
          this._clear();
        }
      } else {
        throw new Error("Control Points and Baseline or Distance is required to create symbol non-interactively");
      }

    } else {
      // Interactive drawing mode - start with baseline
      this.startBaseLineDrawing();
    }
  }

  /**
   * Start baseline drawing
   */
  private startBaseLineDrawing(): void {
    const baseLine = new BaseLine(this.view, this._lineSymbol!);

    this.baseLineClickHandler = baseLine.on("onBaseLineClick", (evt: any) => {
      this.baseLineClick(evt);
    });

    this.baseLineProgressHandler = baseLine.on("onBaseLineProgress", (evt: any) => {
      this.baseLineDrawProgress(evt);
    });

    this._onBaseLineEnd = baseLine.on("drawEnd", (evt: any) => {
      this.baseLineDrawEnd(evt);
    });

    baseLine.init();
  }
    /**
     * Create draw essentials object
     */
    private createDrawEssentials(ctrlPts: Point[], baseLinePts: any): DrawEssentials {
        const drawEssentials = new DrawEssentials();
        drawEssentials.SCOPE = this;
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.CTRL_PTS = ctrlPts;
        drawEssentials.BASE_LN_PTS = baseLinePts;
        drawEssentials.AMPLIFIER = this.amplifier.toString();
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

        if (this._tGraphic) {
            this.symbolLayer.add(this._tGraphic);
        }

        this._baseLinePts = evt.geometry._baseLine;
        this._onMouseMove = this.view.on("pointer-move", this._onMouseMoveHandler.bind(this));
        this._onClick = this.view.on("click", this._onClickHandler.bind(this));
        this._onDblClick = this.view.on("double-click", this._onDblClickHandler.bind(this));

        this.events.emit("onBaseLineDrawEnd", { currentPts: evt.geometry.controlPoints });
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

        this.events.emit("onDrawProgress", {
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
        this.events.emit("onDrawClick", { currentPts: evt.currentGeometry, isBaseLine: true });
    }

    /**
     * Build a jagged (triangle-wave) path between two points — used for the back line so
     * the bypass reads as "difficult". p1/p2 stay the exact endpoints (the flanking arrows
     * still attach there); only the line between them zigzags.
     */
    private jaggedLine(pA: { x: number; y: number }, pB: { x: number; y: number }): number[][] {
        const dx = pB.x - pA.x, dy = pB.y - pA.y;
        const L = Math.hypot(dx, dy);
        if (L === 0) return [[pA.x, pA.y], [pB.x, pB.y]];

        const ux = dx / L, uy = dy / L;   // along the line
        const px = -uy, py = ux;          // perpendicular
        const amp = L * this._jagAmplitudeRatio;

        const out: number[][] = [[pA.x, pA.y]];
        for (let i = 1; i <= this._jagCount; i++) {
            const t = i / (this._jagCount + 1);
            const sign = (i % 2 === 1) ? 1 : -1;       // alternate sides -> zigzag
            const bx = pA.x + ux * L * t;
            const by = pA.y + uy * L * t;
            out.push([bx + px * amp * sign, by + py * amp * sign]);
        }
        out.push([pB.x, pB.y]);
        return out;
    }

    /**
     * Create the symbol geometry
     */
    private createSymbol(drawEssentials: DrawEssentials): Polyline {
        try {
            const toXYPath = (path: any[]): number[][] => {
                return path.map((pt: any) => {
                    if (Array.isArray(pt) && pt.length >= 2) {
                        return [pt[0], pt[1]];
                    }
                    if (pt && typeof pt.x === "number" && typeof pt.y === "number") {
                        return [pt.x, pt.y];
                    }
                    throw new Error("Invalid path point");
                });
            };

            const pts = drawEssentials.CTRL_PTS;
            if (!pts || pts.length === 0) {
                throw new Error("controlPoints not found");
            }

            const stPt = drawEssentials.BASE_LN_PTS?.startPt;
            const endPt = drawEssentials.BASE_LN_PTS?.endPt;
            let stPtCandidatePt: Point | null = null;
            let endPtCandidatePt: Point | null = null;

            if (!stPt || !endPt) {
                throw new Error("First Parameter of the Function is an Array with Start and End Point");
            }

            const firstPoint = pts[0];
            let lastPoint = pts[pts.length - 1];
            const leftArray: Point[] = [];
            const rightArray: Point[] = [];
            const midPt = GeoTools.getMidPoint(stPt, endPt);
            const result = new Polyline({ spatialReference: this.view.spatialReference });

            // Base Line
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

            // Jagged back line (this is the only difference from ObstacleBypassEasy).
            result.addPath(this.jaggedLine(p1, p2));

            // Front
            if (pts.length >= 1) {
                leftArray.push(new Point({ x: p1.x, y: p1.y, spatialReference: this.view.spatialReference }));
                rightArray.push(new Point({ x: p2.x, y: p2.y, spatialReference: this.view.spatialReference }));
            }

            for (let i = 0; i < pts.length; i++) {
                const length = GeoTools._2PtLen(midPt, pts[i]);
                const angle = GeoTools.angleInRadians(midPt, pts[i]);

                stPtCandidatePt = new Point({
                    x: p1.x + length * Math.cos(angle),
                    y: p1.y + length * Math.sin(angle),
                    spatialReference: this.view.spatialReference
                });
                endPtCandidatePt = new Point({
                    x: p2.x + length * Math.cos(angle),
                    y: p2.y + length * Math.sin(angle),
                    spatialReference: this.view.spatialReference
                });

                leftArray.push(stPtCandidatePt);
                rightArray.push(endPtCandidatePt);
            }

            result.addPath(toXYPath(leftArray));
            result.addPath(toXYPath(rightArray));

            // Arrows
            if (stPtCandidatePt && endPtCandidatePt && leftArray.length >= 2) {
                result.addPath(toXYPath(Shapes.arrowHead(
                    leftArray[leftArray.length - 1],
                    GeoTools.ArrowFlanksLen(
                        GeoTools._2PtLen(midPt, pts[pts.length - 1]),
                        GeoTools._2PtLen(stPtCandidatePt, endPtCandidatePt)
                    ),
                    GeoTools.angleInRadians(leftArray[leftArray.length - 2], leftArray[leftArray.length - 1])
                )));
            }

            if (stPtCandidatePt && endPtCandidatePt && rightArray.length >= 2) {
                result.addPath(toXYPath(Shapes.arrowHead(
                    rightArray[rightArray.length - 1],
                    GeoTools.ArrowFlanksLen(
                        GeoTools._2PtLen(midPt, pts[pts.length - 1]),
                        GeoTools._2PtLen(stPtCandidatePt, endPtCandidatePt)
                    ),
                    GeoTools.angleInRadians(rightArray[rightArray.length - 2], rightArray[rightArray.length - 1])
                )));
            }

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
        const candidatePoint = DrawSeam.resolvePoint(this.view, inputPoint);
        if (!candidatePoint) return;

        const drawEssentials = new DrawEssentials();
        drawEssentials.CTRL_PTS = [...this._points, candidatePoint];
        drawEssentials.BASE_LN_PTS = this._baseLinePts;

        if (this._tGraphic) {
            this._tGraphic.geometry = this.createSymbol(drawEssentials);
        }

        this.events.emit("onDrawProgress", {
            currentGeometry: this._tGraphic?.geometry,
            currentDrawEssentials: drawEssentials,
            currentMarker: this._lineSymbol
        });
    }

    /**
     * Handle click events
     */
    private _onClickHandler(clickPoint: any): void {
        const mapPoint = DrawSeam.resolvePoint(this.view, clickPoint);
        if (!mapPoint) return;

        this._points.push(new Point({
            x: mapPoint.x,
            y: mapPoint.y,
            spatialReference: this.view.spatialReference
        }));

        this.events.emit("onDrawClick", { currentPts: this._points });

        if (this.isLine && this._points.length === 1) {
            this.events.emit("onDrawClick", { currentPts: this._points });
            this.cleanUp();
        }
    }

    /**
     * Handle double click events
     */
    private _onDblClickHandler(clickPoint: any): void {
        const mapPoint = DrawSeam.resolvePoint(this.view, clickPoint);
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
        this.events.emit("onDrawEnd", {
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
        if (this._tGraphic) {
            this.symbolLayer.remove(this._tGraphic);
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
        //this.view.enableDoubleClickZoom();
    }

    /**
     * Deactivate the symbol
     */
    public deactivate(): void {
        this._clear();
        this._removeEvents();
        this._geometryType = null;
    }

    public on(eventName: string, callback: (data: any) => void): void {
        this.events.on(eventName, callback);
    }

    public off(eventName: string, callback?: (data: any) => void): void {
        this.events.off(eventName, callback);
    }

}

export default ObstacleBypassDifficult;
