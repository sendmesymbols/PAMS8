import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import DrawEssentials from "../Support/DrawEssentials";
import GeoTools from "../Support/GeoTools.ts";
import {
    ____TacticalSymbolBase,
    TacticalSymbolConfig,
    TacticalSymbolOptions,
} from "./____TacticalSymbolBase.ts";

/**
 * Base for the signals/communications overlay lines (Ethernet, PASCOMS, OFC,
 * Wrls — catalog keys 25150209–25150212): a multi-point link line between
 * locations/HQs. The medium's name and any designation render through the
 * AnnotationEngine; wireless links additionally carry the conventional
 * radio-break zigzag at the middle of the trace (`radioBreak: true`).
 */
export abstract class ____CommsLineBase extends ____TacticalSymbolBase {
    private readonly radioBreak: boolean;

    protected constructor(
        view: MapView | SceneView,
        isLine: boolean,
        config: TacticalSymbolConfig,
        radioBreak: boolean = false,
    ) {
        super(view, isLine, config);
        this.radioBreak = radioBreak;
    }

    public init(options: TacticalSymbolOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void {
        this._lineSym = marker;
        this._drawType = GeoTools.setDefault(options, "DRAW_TYPE", this._drawType);
        this.initFromOptions(options);
    }

    public createSymbol(drawEssentials: DrawEssentials): Polyline | null {
        try {
            const pts: Point[] | undefined = (drawEssentials as any).CTRL_PTS;
            if (!pts || pts.length < 2) throw new Error("controlPoints not found");

            const sr = this.view.spatialReference;
            const path: number[][] = this.radioBreak
                ? this.pathWithRadioBreak(pts)
                : pts.map(pt => [pt.x, pt.y]);

            const result = new Polyline({ spatialReference: sr });
            result.addPath(path);
            return result;
        } catch (e) {
            /* invalid geometry mid-draw is expected; ignore */
            return null;
        }
    }

    /**
     * Straight path with the radio-link zigzag inserted at the midpoint of the
     * middle segment: … a — m1 /z1 z2\ m2 — b …
     */
    private pathWithRadioBreak(pts: Point[]): number[][] {
        const path: number[][] = [];
        const segIdx = Math.floor((pts.length - 1) / 2);

        for (let i = 0; i < pts.length - 1; i++) {
            path.push([pts[i].x, pts[i].y]);
            if (i !== segIdx) continue;

            const a = pts[i];
            const b = pts[i + 1];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len === 0) continue;

            const ux = dx / len, uy = dy / len;   // along the segment
            const px = -uy,      py = ux;         // perpendicular
            const w = len / 8;                     // half-width of the break
            const h = w;                           // zigzag amplitude
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;

            path.push([mx - ux * w, my - uy * w]);
            path.push([mx - ux * w / 3 + px * h, my - uy * w / 3 + py * h]);
            path.push([mx + ux * w / 3 - px * h, my + uy * w / 3 - py * h]);
            path.push([mx + ux * w, my + uy * w]);
        }
        path.push([pts[pts.length - 1].x, pts[pts.length - 1].y]);
        return path;
    }
}

export default ____CommsLineBase;
