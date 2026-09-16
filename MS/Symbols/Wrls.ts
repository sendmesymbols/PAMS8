import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import { ____CommsLineBase } from "./____CommsLineBase.ts";

/**
 * Wrls communications link line (catalog key 25150212).
 * Carries the conventional radio-break zigzag mid-trace.
 */
export class Wrls extends ____CommsLineBase {
    constructor(view: MapView | SceneView, isLine: boolean = false) {
        super(view, isLine, {
            SID: "150212",
            symName: "Wrls",
            symGeometricType: "Line",
            eventName: "Wrls",
        }, true);
    }
}

export default Wrls;
