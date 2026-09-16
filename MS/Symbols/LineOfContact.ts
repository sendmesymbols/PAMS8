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

export interface LineOfContactOptions extends TacticalSymbolOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polyline;
    DRAW_TYPE?: number;
    [key: string]: any;
}

/**
 * Line of Contact (MIL-STD-2525D control measure, catalog key 25290310).
 *
 * Drawn like the Fwd Line of Tps (FLOT) scallop trace, but with the
 * half-circle bumps mirrored on BOTH sides of the line — contact runs along
 * the trace with forces on either side.
 *
 * Built on ____TacticalSymbolBase: the base owns the interactive draw,
 * placement modes, events and cleanup; this class contributes only the
 * double-scallop geometry.
 */
export class LineOfContact extends ____TacticalSymbolBase {
    constructor(view: MapView | SceneView, isLine: boolean = false) {
        super(view, isLine, {
            SID: "290310",
            symName: "Line of Contact",
            symGeometricType: "Line",
            eventName: "LineOfContact",
        });
    }

    public init(options: LineOfContactOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void {
        this._lineSym = marker;
        this._drawType = GeoTools.setDefault(options, "DRAW_TYPE", this._drawType);
        this.initFromOptions(options);
    }

    /**
     * Double-sided FLOT scallops along the control-point trace.
     * Sizing mirrors FwdLineOfTps so the two symbols read consistently.
     */
    public createSymbol(drawEssentials: DrawEssentials): Polyline | null {
        try {
            const pts: Point[] | undefined = (drawEssentials as any).CTRL_PTS;
            if (!pts || pts.length < 2) throw new Error("controlPoints not found");

            const spatialReference = this.view.spatialReference;
            const result = new Polyline({ spatialReference });

            const totalLen = GeoTools._2PtLen(pts[0], pts[pts.length - 1]);
            const gapRatio = totalLen / 20; // spacing between scallop centers

            const baseLineLen = totalLen / 6.58;
            let cLenLimit = baseLineLen / 6.58;
            if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;

            const resPts: Point[] = GeoTools.getDashPts(pts, [gapRatio, gapRatio]);
            for (let i = 1; i < resPts.length - 1; i++) {
                const center = resPts[i];
                const prev = resPts[i - 1];
                const angle = GeoTools.angleInRadians(center, prev);

                // Scallop toward one side…
                const near: Point[] = Shapes.createFLOTHalfCircle(center, angle, cLenLimit);
                if (near && near.length) {
                    result.addPath(near.map(p => [p.x, p.y]));
                }
                // …and its mirror on the far side.
                const far: Point[] = Shapes.createFLOTHalfCircle(center, angle + Math.PI, cLenLimit);
                if (far && far.length) {
                    result.addPath(far.map(p => [p.x, p.y]));
                }
            }

            return result;
        } catch (e) {
            /* invalid geometry mid-draw is expected; ignore */
            return null;
        }
    }
}

export default LineOfContact;
