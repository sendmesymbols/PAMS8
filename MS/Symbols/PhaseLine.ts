import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import DrawEssentials from "../Support/DrawEssentials";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";
import { ____TacticalSymbolBase, TacticalSymbolOptions } from "./____TacticalSymbolBase.ts";

export interface PhaseLineOptions extends TacticalSymbolOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polyline;
    DRAW_TYPE?: number;
    [key: string]: any;
}

/**
 * PhaseLine class for drawing Phase Line symbols on MapView or SceneView.
 * Creates line symbols with "PL" text markers at both ends.
 *
 * Pilot migration onto ____TacticalSymbolBase: the interactive-draw scaffold,
 * init() placement modes, events and cleanup live in the base — this class
 * contributes only its identity and geometry (straight/bezier line + PL
 * markers).
 */
export class PhaseLine extends ____TacticalSymbolBase {
    constructor(view: MapView | SceneView, isLine: boolean = false) {
        super(view, isLine, {
            SID: "140300",
            symName: "Phase Line",
            symGeometricType: "Line",
            eventName: "PhaseLine",
        });
    }

    /**
     * Initialize the phase line drawing
     */
    public init(options: PhaseLineOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void {
        this._lineSym = marker;
        this._drawType = GeoTools.setDefault(options, "DRAW_TYPE", this._drawType);
        this.initFromOptions(options);
    }

    /**
     * Create symbol geometry from DrawEssentials
     */
    public createSymbol(drawEssentials: DrawEssentials): Polyline | null {
        try {
            const pts: Point[] | undefined = (drawEssentials as any).CTRL_PTS;
            if (!pts) throw new Error("controlPoints not found");

            const p1 = pts[0];
            const p2 = pts[pts.length - 1];
            const drawType = (drawEssentials as any).DRAW_TYPE || 1;

            let result: Polyline;
            switch (drawType) {
                case 2:
                    result = this.createSymbolByLine(pts, p1, p2);
                    break;
                case 1:
                default:
                    result = this.createSymbolByStraightLine(pts);
            }

            // Add PL text markers at both ends
            this.addPLMarkers(result, p1, p2);

            return result;
        } catch (e) {
            /* invalid geometry mid-draw is expected; ignore */
            return null;
        }
    }

    /**
     * Add PL markers at both ends of the line
     */
    private addPLMarkers(result: Polyline, p1: Point, p2: Point): void {
        try {
            const len = GeoTools._2PtLen(p1, p2) / 20;
            const k = GeoTools.angleInRadians(p1, p2);

            if ('createPL' in Shapes && typeof (Shapes as any).createPL === 'function') {
                // PL marker at start point
                const pt1 = {
                    x: -1 * len * Math.cos(k) + p1.x,
                    y: -1 * len * Math.sin(k) + p1.y,
                };
                const plPaths1 = (Shapes as any).createPL(pt1.x, pt1.y, len / 2, this.view.spatialReference);
                if (plPaths1 && Array.isArray(plPaths1)) {
                    plPaths1.forEach((path: any) => {
                        if (path && Array.isArray(path)) {
                            result.addPath(path);
                        }
                    });
                }

                // PL marker at end point
                const pt2 = {
                    x: len * Math.cos(k) + p2.x,
                    y: len * Math.sin(k) + p2.y,
                };
                const plPaths2 = (Shapes as any).createPL(pt2.x, pt2.y, len / 2, this.view.spatialReference);
                if (plPaths2 && Array.isArray(plPaths2)) {
                    plPaths2.forEach((path: any) => {
                        if (path && Array.isArray(path)) {
                            result.addPath(path);
                        }
                    });
                }
            }
        } catch (e) {
            console.log('Error adding PL markers');
        }
    }

    /**
     * Create symbol by straight line (draw type 1)
     */
    private createSymbolByStraightLine(pts: Point[]): Polyline {
        const result = new Polyline({ spatialReference: this.view.spatialReference });
        const path = pts.map(pt => [pt.x, pt.y]);
        result.addPath(path);
        return result;
    }

    /**
     * Create symbol by bezier line (draw type 2)
     */
    private createSymbolByLine(pts: Point[], firstPoint: Point, lastPoint: Point): Polyline {
        const result = new Polyline({ spatialReference: this.view.spatialReference });

        if (pts.length === 2) {
            result.addPath([[lastPoint.x, lastPoint.y], [firstPoint.x, firstPoint.y]]);
        } else if (pts.length > 2) {
            // Convert points to simple objects for Bezier path
            const tempArray = pts.map(pt => ({ x: pt.x, y: pt.y }));
            const bezierPoints = Shapes.CreateBezierPathPCOnly(tempArray, 100);
            const bezierPath = bezierPoints.map(pt => [pt.x, pt.y]);
            result.addPath(bezierPath);
        }

        return result;
    }
}

export default PhaseLine;
