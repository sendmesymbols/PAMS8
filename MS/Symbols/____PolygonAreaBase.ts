import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import DrawEssentials from "../Support/DrawEssentials";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";
import {
    ____TacticalSymbolBase,
    TacticalSymbolConfig,
    TacticalSymbolOptions,
} from "./____TacticalSymbolBase.ts";

/**
 * Base for the generic polygon-area symbols whose catalog Tools are
 * "Smooth Polygon (1) / Polygon (2) / Rectangle (3)".
 *
 * Owns the standard area behavior on top of ____TacticalSymbolBase:
 * geometry built via Shapes.createSymbolByBCurve / ByPolygon / ByRect,
 * rectangle mode finishing after the second click, and Polygon (rings)
 * reconstruction on plan load. A subclass supplies its identity and may
 * override decorateSymbol() to add inner markings (see AssemblyArea's "AA").
 */
export abstract class ____PolygonAreaBase extends ____TacticalSymbolBase {
    protected constructor(view: MapView | SceneView, isLine: boolean, config: TacticalSymbolConfig) {
        super(view, isLine, config);
    }

    public init(options: TacticalSymbolOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void {
        this._lineSym = marker;
        this._drawType = GeoTools.setDefault(options, "DRAW_TYPE", this._drawType);
        this.initFromOptions(options);
    }

    /** Saved plans store area GEOM as rings. */
    protected override geometryFromOptions(options: TacticalSymbolOptions): Polygon {
        return new Polygon({
            rings: options.GEOM as any,
            spatialReference: this.view.spatialReference,
        });
    }

    /** Rectangle mode is fully defined by two corner clicks. */
    protected override shouldFinishAfterClick(): boolean {
        if (this._drawType === 3 && this._points.length === 2) return true;
        return super.shouldFinishAfterClick();
    }

    public createSymbol(drawEssentials: DrawEssentials): Polygon | Polyline | null {
        try {
            const pts: Point[] | undefined = (drawEssentials as any).CTRL_PTS;
            if (!pts || pts.length === 0) throw new Error("controlPoints not found");

            const firstPoint = pts[0];
            const lastPoint = pts[pts.length - 1];
            const drawType = (drawEssentials as any).DRAW_TYPE || 1;
            const sr = this.view.spatialReference;

            let result: Polygon | Polyline | null;
            switch (drawType) {
                case 2:
                    result = Shapes.createSymbolByPolygon(pts, firstPoint, lastPoint, drawEssentials, sr);
                    break;
                case 3:
                    result = Shapes.createSymbolByRect(pts, firstPoint, lastPoint, drawEssentials, sr);
                    break;
                case 1:
                default:
                    result = Shapes.createSymbolByBCurve(pts, firstPoint, lastPoint, drawEssentials, sr);
            }

            return result ? this.decorateSymbol(result, firstPoint, lastPoint) : result;
        } catch (e) {
            /* invalid geometry mid-draw is expected; ignore */
            return null;
        }
    }

    /** Hook for inner markings; the default area is the bare boundary. */
    protected decorateSymbol(
        result: Polygon | Polyline,
        _firstPoint: Point,
        _lastPoint: Point,
    ): Polygon | Polyline {
        return result;
    }
}

export default ____PolygonAreaBase;
