import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import { ____LabelledLineBase } from "./____LabelledLineBase.ts";

/**
 * Limit of Advance (LOA), MIL-STD-2525D 25 140900, used for the limit of exploitation (LOE) of an attack. As the 2525D
 * template: a line (straight or curved through the clicks) with "LOA" above it, just inside each end.
 */
export class LimitOfAdvance extends ____LabelledLineBase {
    constructor(view: MapView | SceneView, isLine: boolean = false) {
        super(view, isLine, {
            SID: "140900",
            symName: "Limit of Advance",
            symGeometricType: "Line",
            eventName: "LimitOfAdvance",
        });
    }

    protected lettering() { return { word: "LOA", place: "aboveEnds" as const }; }
}

export default LimitOfAdvance;
