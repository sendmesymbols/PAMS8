/**
 * TEST FILE - For demonstration and testing purposes only
 * This file demonstrates the seamless 2D/3D switching capabilities of the updated TacticalPoint class
 * Can be safely removed in production builds
 */

import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import Point from "@arcgis/core/geometry/Point";
import { TacticalPoint, MarkerOptions } from "./TacticalPoint";

/**
 * Test class to demonstrate seamless 2D/3D view switching with TacticalPoint
 */
export class TacticalPointTest {
    private mapView: MapView;
    private sceneView: SceneView;
    private tacticalPoint: TacticalPoint | null = null;
    private currentView: MapView | SceneView;

    constructor(mapView: MapView, sceneView: SceneView) {
        this.mapView = mapView;
        this.sceneView = sceneView;
        this.currentView = mapView;
    }

    /**
     * Test creating a tactical point that works seamlessly in both views
     */
    public testUnifiedSymbol(): void {
        // Clean up previous instance
        if (this.tacticalPoint) {
            this.tacticalPoint.deactivate();
        }

        // Create tactical point with current view
        this.tacticalPoint = new TacticalPoint(this.currentView);

        // Sample marker options with increased size for better visibility
        const markerOptions: MarkerOptions = {
            color: [255, 0, 0, 0.8], // Red color
            size: 32, // Increased from 24 for better visibility
            angle: 0,
            outline: {
                color: [255, 255, 255, 1], // White outline
                width: 2
            }
        };

        // Sample location (Los Angeles)
        const testPoint = new Point({
            longitude: -118.2437,
            latitude: 34.0522,
            spatialReference: { wkid: 4326 }
        });

        try {
            // Initialize tactical point - this should work the same for both 2D and 3D
            this.tacticalPoint.init(
                {
                    GEOM: testPoint,
                    SIZE: 32, // Increased for better visibility
                    ANGLE: 0
                },
                markerOptions,
                "100000", // SIC
                "TestTacticalPoint", // symName
                "0", // offset
                "SPGP------" // SIDC
            );

            console.log(`✓ Successfully created tactical point for ${this.currentView.type} view`);
        } catch (error) {
            console.error(`✗ Error creating tactical point for ${this.currentView.type} view:`, error);
        }
    }

    /**
     * Switch between 2D and 3D views to test seamless operation
     */
    public async switchView(to2D: boolean): Promise<boolean> {
        const newView = to2D ? this.mapView : this.sceneView;
        const oldView = this.currentView;

        try {
            // Store the current center and zoom for smooth transition
            const center = oldView.center;
            const zoom = oldView.zoom;

            // Update current view reference
            this.currentView = newView;

            // Set the same location in new view
            if (center) {
                await newView.goTo({ center, zoom });
            }

            // Test creating a new tactical point with the new view
            this.testUnifiedSymbol();

            console.log(`✓ Successfully switched to ${this.currentView.type} view`);
            return true;

        } catch (error) {
            console.error(`✗ Error switching to ${to2D ? '2D' : '3D'} view:`, error);
            return false;
        }
    }

    /**
     * Test multiple symbols with different properties
     */
    public testMultipleSymbols(): void {
        const testSymbols = [
            {
                color: [255, 0, 0, 0.8],
                size: 28, // Increased for better visibility
                position: { longitude: -118.2437, latitude: 34.0522 },
                name: "RedPoint"
            },
            {
                color: [0, 255, 0, 0.8],
                size: 36, // Increased for better visibility
                position: { longitude: -118.2537, latitude: 34.0622 },
                name: "GreenPoint"
            },
            {
                color: [0, 0, 255, 0.8],
                size: 32, // Increased for better visibility
                position: { longitude: -118.2337, latitude: 34.0422 },
                name: "BluePoint"
            }
        ];

        let successCount = 0;

        testSymbols.forEach((symbolData, index) => {
            try {
                const tactPoint = new TacticalPoint(this.currentView);
                const point = new Point({
                    longitude: symbolData.position.longitude,
                    latitude: symbolData.position.latitude,
                    spatialReference: { wkid: 4326 }
                });

                const markerOptions: MarkerOptions = {
                    color: symbolData.color,
                    size: symbolData.size,
                    outline: {
                        color: [255, 255, 255, 1],
                        width: 1
                    }
                };

                tactPoint.init(
                    {
                        GEOM: point,
                        SIZE: symbolData.size
                    },
                    markerOptions,
                    "100000",
                    symbolData.name,
                    "0",
                    "SPGP------"
                );

                console.log(`✓ Created ${symbolData.name} for ${this.currentView.type} view`);
                successCount++;
            } catch (error) {
                console.error(`✗ Error creating ${symbolData.name}:`, error);
            }
        });

        console.log(`✓ Successfully created ${successCount}/${testSymbols.length} test symbols`);
    }

    /**
     * Cleanup all tactical points
     */
    public cleanup(): void {
        if (this.tacticalPoint) {
            this.tacticalPoint.deactivate();
            this.tacticalPoint.clearSymbols();
            this.tacticalPoint = null;
        }
        console.log("✓ Cleanup completed");
    }

    /**
     * Run comprehensive test suite
     */
    public async runTestSuite(): Promise<void> {
        console.log("🧪 Starting TacticalPoint test suite...");

        // Test 1: Create symbol in 2D
        console.log("\n📍 Test 1: Creating symbol in 2D view");
        this.testUnifiedSymbol();

        // Test 2: Switch to 3D
        console.log("\n🌍 Test 2: Switching to 3D view");
        await this.switchView(false);

        // Test 3: Switch back to 2D
        console.log("\n🗺️  Test 3: Switching back to 2D view");
        await this.switchView(true);

        // Test 4: Multiple symbols
        console.log("\n🎯 Test 4: Creating multiple symbols");
        this.testMultipleSymbols();

        // Test 5: Cleanup
        console.log("\n🧹 Test 5: Cleanup");
        this.cleanup();

        console.log("\n✅ Test suite completed!");
    }
}

export default TacticalPointTest; 