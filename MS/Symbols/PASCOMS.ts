import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import { ____CommsLineBase } from "./____CommsLineBase.ts";

/**
 * PASCOMS communications link line (catalog key 25150210).
 */
export class PASCOMS extends ____CommsLineBase {
    constructor(view: MapView | SceneView, isLine: boolean = false) {
        super(view, isLine, {
            SID: "150210",
            symName: "PASCOMS",
            symGeometricType: "Line",
            eventName: "PASCOMS",
        }, false);
    }
}

export default PASCOMS;
