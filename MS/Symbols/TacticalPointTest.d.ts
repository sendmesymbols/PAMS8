/**
 * TEST FILE - For demonstration and testing purposes only
 * This file demonstrates the seamless 2D/3D switching capabilities of the updated TacticalPoint class
 * Can be safely removed in production builds
 */
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
/**
 * Test class to demonstrate seamless 2D/3D view switching with TacticalPoint
 */
export declare class TacticalPointTest {
    private mapView;
    private sceneView;
    private tacticalPoint;
    private currentView;
    constructor(mapView: MapView, sceneView: SceneView);
    /**
     * Test creating a tactical point that works seamlessly in both views
     */
    testUnifiedSymbol(): void;
    /**
     * Switch between 2D and 3D views to test seamless operation
     */
    switchView(to2D: boolean): Promise<boolean>;
    /**
     * Test multiple symbols with different properties
     */
    testMultipleSymbols(): void;
    /**
     * Cleanup all tactical points
     */
    cleanup(): void;
    /**
     * Run comprehensive test suite
     */
    runTestSuite(): Promise<void>;
}
export default TacticalPointTest;
