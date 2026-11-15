import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import { ____LabelledLineBase } from "./____LabelledLineBase.ts";

/**
 * Final Protective Fire (FPF), MIL-STD-2525D 25 240703 (Fires Areas / Linear Targets): the linear DF task close in front of a
 * locality. As the 2525D template: the line with a tick square to it at each end (both sides) and "FPF" under the
 * middle; the target number (T1) goes in the designation.
 */
export class Fpf extends ____LabelledLineBase {
    constructor(view: MapView | SceneView, isLine: boolean = false) {
        super(view, isLine, {
            SID: "240703",
            symName: "FPF",
            symGeometricType: "Line",
            eventName: "Fpf",
        });
    }

    protected lettering() { return { word: "FPF", place: "belowMiddle" as const, endTicks: true }; }
}

export default Fpf;
