import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import { ____PolygonAreaBase } from "./____PolygonAreaBase.ts";

/**
 * Msn Area - ISR (catalog key 25150208).
 * Generic mission-area boundary (smooth polygon / polygon / rectangle);
 * name and designation render through the AnnotationEngine.
 */
export class ISRMsnArea extends ____PolygonAreaBase {
    constructor(view: MapView | SceneView, isLine: boolean = false) {
        super(view, isLine, {
            SID: "150208",
            symName: "Msn Area - ISR",
            symGeometricType: "Area",
            eventName: "ISRMsnArea",
        });
    }
}

export default ISRMsnArea;
