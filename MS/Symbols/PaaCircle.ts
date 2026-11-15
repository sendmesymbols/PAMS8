import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import { ____PositionAreaArtilleryBase } from "./____PositionAreaArtilleryBase.ts";

/**
 * Position Area for Artillery, circular (PAA), MIL-STD-2525D 25 240502: the gun area. Two clicks: centre, then a point on the edge.
 */
export class PaaCircle extends ____PositionAreaArtilleryBase {
    constructor(view: MapView | SceneView, isLine: boolean = false) {
        super(view, isLine, {
            SID: "240502",
            symName: "PAA - Circular",
            symGeometricType: "Area",
            eventName: "PaaCircle",
        });
    }

    protected shape() { return "circle" as const; }
}

export default PaaCircle;
