import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import { ____CommsLineBase } from "./____CommsLineBase.ts";

/**
 * Ethernet communications link line (catalog key 25150209).
 */
export class Ethernet extends ____CommsLineBase {
    constructor(view: MapView | SceneView, isLine: boolean = false) {
        super(view, isLine, {
            SID: "150209",
            symName: "Ethernet",
            symGeometricType: "Line",
            eventName: "Ethernet",
        }, false);
    }
}

export default Ethernet;
