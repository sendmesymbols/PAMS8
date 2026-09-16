import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import { ____CommsLineBase } from "./____CommsLineBase.ts";

/**
 * OFC communications link line (catalog key 25150211).
 */
export class OFC extends ____CommsLineBase {
    constructor(view: MapView | SceneView, isLine: boolean = false) {
        super(view, isLine, {
            SID: "150211",
            symName: "OFC",
            symGeometricType: "Line",
            eventName: "OFC",
        }, false);
    }
}

export default OFC;
