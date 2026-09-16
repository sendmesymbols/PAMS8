import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import { ____PolygonAreaBase } from "./____PolygonAreaBase.ts";

/**
 * Msn Area - Medevac (catalog key 25120617).
 * Generic mission-area boundary (smooth polygon / polygon / rectangle);
 * name and designation render through the AnnotationEngine.
 */
export class MedevacMsnArea extends ____PolygonAreaBase {
    constructor(view: MapView | SceneView, isLine: boolean = false) {
        super(view, isLine, {
            SID: "120617",
            symName: "Msn Area - Medevac",
            symGeometricType: "Area",
            eventName: "MedevacMsnArea",
        });
    }
}

export default MedevacMsnArea;
