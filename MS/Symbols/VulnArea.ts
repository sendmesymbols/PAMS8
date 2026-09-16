import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import { ____PolygonAreaBase } from "./____PolygonAreaBase.ts";

/**
 * Vuln Area — vulnerable area (catalog key 25214802).
 * Generic area boundary (smooth polygon / polygon / rectangle);
 * name and designation render through the AnnotationEngine.
 */
export class VulnArea extends ____PolygonAreaBase {
    constructor(view: MapView | SceneView, isLine: boolean = false) {
        super(view, isLine, {
            SID: "214802",
            symName: "Vuln Area",
            symGeometricType: "Area",
            eventName: "VulnArea",
        });
    }
}

export default VulnArea;
