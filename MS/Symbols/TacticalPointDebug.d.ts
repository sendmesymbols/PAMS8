/**
 * DEBUG UTILITY - For debugging TacticalPoint centering issues
 * This file helps visualize and test symbol positioning
 */
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import Point from "@arcgis/core/geometry/Point";
export declare class TacticalPointDebug {
    private view;
    constructor(view: MapView | SceneView);
    /**
     * Create test symbols at the same location to compare positioning
     */
    testSymbolCentering(location?: Point): Promise<void>;
    /**
     * Test different offset values
     */
    testOffsetValues(location?: Point): Promise<void>;
    /**
     * Create manual PictureMarkerSymbol for comparison
     */
    testManualPictureSymbol(location?: Point): Promise<void>;
    /**
     * Clear all debug graphics
     */
    clearDebugGraphics(): void;
    /**
     * Run comprehensive debug test suite
     */
    runDebugSuite(): Promise<void>;
}
export default TacticalPointDebug;
