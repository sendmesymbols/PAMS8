import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import { ____LabelledLineBase } from "./____LabelledLineBase.ts";

/**
 * Forward Edge of the Battle Area (FEBA), MIL-STD-2525D 25 140400: the line of the forward defended localities (FDL). As the
 * 2525D template: a line (straight or curved through the clicks) with "FEBA" past each end.
 */
export class Feba extends ____LabelledLineBase {
    constructor(view: MapView | SceneView, isLine: boolean = false) {
        super(view, isLine, {
            SID: "140400",
            symName: "FEBA",
            symGeometricType: "Line",
            eventName: "Feba",
        });
    }

    protected lettering() { return { word: "FEBA", place: "beyond" as const }; }
}

export default Feba;
