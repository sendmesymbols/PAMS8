import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import { ____LabelledAreaBase } from "./____LabelledAreaBase.ts";

/**
 * Division Support Area (MIL-STD-2525D control measure 25 310700, Sustainment Areas): an area with "DSA" written inside, as the
 * 2525D template draws it; the unit designation renders through the AnnotationEngine. DSA (the Div Admin Area). Added for the Admin Area
 * finder's Create on Map (MS/Engines/AdminArea).
 */
export class DivisionSupportArea extends ____LabelledAreaBase {
    constructor(view: MapView | SceneView, isLine: boolean = false) {
        super(view, isLine, {
            SID: "310700",
            symName: "Division Support Area",
            symGeometricType: "Area",
            eventName: "DivisionSupportArea",
        });
    }

    protected override areaWord(): string { return "DSA"; }
}

export default DivisionSupportArea;
