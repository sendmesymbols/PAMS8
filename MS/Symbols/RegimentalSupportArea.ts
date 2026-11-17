import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import { ____LabelledAreaBase } from "./____LabelledAreaBase.ts";

/**
 * Regimental Support Area (MIL-STD-2525D control measure 25 310500, Sustainment Areas): an area with "RSA" written inside, as the
 * 2525D template draws it; the unit designation renders through the AnnotationEngine. RSA. Added for the Admin Area
 * finder's Create on Map (MS/Engines/AdminArea).
 */
export class RegimentalSupportArea extends ____LabelledAreaBase {
    constructor(view: MapView | SceneView, isLine: boolean = false) {
        super(view, isLine, {
            SID: "310500",
            symName: "Regimental Support Area",
            symGeometricType: "Area",
            eventName: "RegimentalSupportArea",
        });
    }

    protected override areaWord(): string { return "RSA"; }
}

export default RegimentalSupportArea;
