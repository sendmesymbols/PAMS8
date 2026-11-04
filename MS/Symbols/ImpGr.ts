import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import DrawEssentials from "../Support/DrawEssentials";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";
import { ____TacticalSymbolBase, TacticalSymbolOptions } from "./____TacticalSymbolBase.ts";

export interface ImpGrOptions extends TacticalSymbolOptions {
    CTRL_PTS?: Point[];
    GEOM?: Polygon;
    DRAW_TYPE?: number;
    [key: string]: any;
}

/**
 * Imp Gr — Important Ground (ITG, Important Tactical Ground): an area marked "IG", the companion of Vital Gr
 * ("VG", MITG). MIL-STD-2525D has no Important Ground symbol, so this is a PAMS8 local symbol (catalog key
 * 00000160, symbol set 00 like the Freehand symbols) and not a 2525D code.
 *
 * Built on ____TacticalSymbolBase: the base owns the draw scaffold; this class gives the identity and the
 * geometry (smooth polygon / polygon / rectangle, as Vital Gr, with "IG" inside).
 */
export class ImpGr extends ____TacticalSymbolBase {
    constructor(view: MapView | SceneView, isLine: boolean = false) {
        super(view, isLine, {
            SID: "000160",
            symName: "Imp Gr",
            symGeometricType: "Area",
            eventName: "ImpGr",
        });
    }

    public init(options: ImpGrOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void {
        this._lineSym = marker.clone();
        this._drawType = GeoTools.setDefault(options, "DRAW_TYPE", this._drawType);
        this.initFromOptions(options);
    }

    /** A rectangle is done after its second corner; the other draw types end on a double-click. */
    protected shouldFinishAfterClick(): boolean {
        return super.shouldFinishAfterClick() || (this._drawType === 3 && this._points.length === 2);
    }

    /** A saved plan stores the rings of the area. */
    protected geometryFromOptions(options: TacticalSymbolOptions): Polygon {
        return options.GEOM instanceof Polygon
            ? options.GEOM
            : new Polygon({ rings: options.GEOM as any, spatialReference: this.view.spatialReference });
    }

    public createSymbol(drawEssentials: DrawEssentials): Polygon | null {
        try {
            const pts: Point[] | undefined = (drawEssentials as any).CTRL_PTS;
            if (!pts) throw new Error("controlPoints not found");
            const first = pts[0];
            const last = pts[pts.length - 1];
            const sr = this.view.spatialReference;
            let result: Polygon | null;
            switch ((drawEssentials as any).DRAW_TYPE || 1) {
                case 1:
                    result = Shapes.createSymbolByBCurve(pts, first, last, drawEssentials, sr) as Polygon;
                    break;
                case 3:
                    result = Shapes.createSymbolByRect(pts, first, last, drawEssentials, sr);
                    break;
                default:
                    result = Shapes.createSymbolByPolygon(pts, first, last, drawEssentials, sr);
            }
            return result ? this.addInnerText(result, first, last) : null;
        } catch (e) {
            /* invalid geometry mid-draw is expected; ignore */
            return null;
        }
    }

    /** "IG" in the middle, sized like Vital Gr's "VG" so the two read as a pair. */
    private addInnerText(result: Polygon, first: Point, last: Point): Polygon {
        const mid = result.extent?.center;
        if (!mid) return result;
        const base = GeoTools._2PtLen(first, last);
        const size = Math.min(base / 10, base / 3.6);
        for (const ring of Shapes.createIGRings(mid.x, mid.y, size, mid.spatialReference)) {
            // a 2-point stroke closed minimally, so it draws as one segment of the outline
            if (ring.length === 2) result.addRing([ring[0], ring[1], ring[0]]);
            else if (ring.length >= 4) result.addRing(ring);
        }
        return result;
    }
}

export default ImpGr;
