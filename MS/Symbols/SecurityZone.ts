import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import { ____LabelledAreaBase } from "./____LabelledAreaBase.ts";

/**
 * Security Zone (the covering troops and screen ahead of the FDLs; its depth by echelon is in PlanDoctrine.json securityZone). A PAMS8 local symbol (catalog key 00000161, symbol set 00 like Imp Gr), not a MIL-STD-2525D code: the 2525D
 * control-measure table has no security zone (checked 15 Nov 2026). Added for the Deployment Mgr's Build tab (PlanBuilder_Plan.md section 12).
 */
export class SecurityZone extends ____LabelledAreaBase {
    constructor(view: MapView | SceneView, isLine: boolean = false) {
        super(view, isLine, {
            SID: "000161",
            symName: "Security Zone",
            symGeometricType: "Area",
            eventName: "SecurityZone",
        });
    }

    protected override areaWord(): string { return "SZ"; }
}

export default SecurityZone;
