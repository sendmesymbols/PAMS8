import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import { ____PositionAreaArtilleryBase } from "./____PositionAreaArtilleryBase.ts";

/**
 * Position Area for Artillery, rectangular (PAA), MIL-STD-2525D 25 240501: the gun area. Two clicks: opposite corners.
 */
export class PaaRect extends ____PositionAreaArtilleryBase {
    constructor(view: MapView | SceneView, isLine: boolean = false) {
        super(view, isLine, {
            SID: "240501",
            symName: "PAA - Rectangular",
            symGeometricType: "Area",
            eventName: "PaaRect",
        });
    }

    protected shape() { return "rect" as const; }
}

export default PaaRect;
