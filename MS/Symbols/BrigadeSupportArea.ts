import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import { ____LabelledAreaBase } from "./____LabelledAreaBase.ts";

/**
 * Brigade Support Area (MIL-STD-2525D control measure 25 310600, Sustainment Areas): an area with "BSA" written inside, as the
 * 2525D template draws it; the unit designation renders through the AnnotationEngine. BSA (the Bde Admin Area). Added for the Admin Area
 * finder's Create on Map (MS/Engines/AdminArea).
 */
export class BrigadeSupportArea extends ____LabelledAreaBase {
    constructor(view: MapView | SceneView, isLine: boolean = false) {
        super(view, isLine, {
            SID: "310600",
            symName: "Brigade Support Area",
            symGeometricType: "Area",
            eventName: "BrigadeSupportArea",
        });
    }

    protected override areaWord(): string { return "BSA"; }
}

export default BrigadeSupportArea;
