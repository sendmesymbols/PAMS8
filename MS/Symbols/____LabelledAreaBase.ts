import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import { wordSegments, wordWidth } from "../Support/StrokeFont.ts";
import { TacticalSymbolConfig } from "./____TacticalSymbolBase.ts";
import { ____PolygonAreaBase } from "./____PolygonAreaBase.ts";

/**
 * Base for an area (smooth polygon / polygon / rectangle) with its name written inside in the geometry, as Imp Gr
 * writes "IG": GUN AREA, SZ, MASK. Each stroke is added as a minimal 2-point ring so it draws as a line in 2D and the
 * 3D tessellator keeps it. The word fits the area: at most 60 % of its width and a fifth of its height.
 */
export abstract class ____LabelledAreaBase extends ____PolygonAreaBase {
    protected constructor(view: MapView | SceneView, isLine: boolean, config: TacticalSymbolConfig) {
        super(view, isLine, config);
    }

    protected abstract areaWord(): string;

    protected override decorateSymbol(result: Polygon | Polyline, _first: Point, _last: Point): Polygon | Polyline {
        if (!(result instanceof Polygon)) return result;
        const ext = result.extent;
        if (!ext || !(ext.width > 0) || !(ext.height > 0)) return result;
        const word = this.areaWord();
        const dr = Math.min((ext.width * 0.6) / wordWidth(word, 1), ext.height / 10);
        if (!(dr > 0)) return result;
        const c = ext.center;
        for (const seg of wordSegments(word, c.x, c.y, dr, result.spatialReference)) result.addRing([seg[0], seg[1], seg[0]]);
        return result;
    }
}

export default ____LabelledAreaBase;
