/**
 * DEBUG UTILITY - For debugging TacticalPoint centering issues
 * This file helps visualize and test symbol positioning
 */

import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import Point from "@arcgis/core/geometry/Point";
import Graphic from "@arcgis/core/Graphic";
import PictureMarkerSymbol from "@arcgis/core/symbols/PictureMarkerSymbol";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";
import { TacticalPoint, MarkerOptions } from "./TacticalPoint";

export class TacticalPointDebug {
    private view: MapView | SceneView;

    constructor(view: MapView | SceneView) {
        this.view = view;
    }

    /**
     * Create test symbols at the same location to compare positioning
     */
    public async testSymbolCentering(location?: Point): Promise<void> {
        const testPoint = location || this.view.center || new Point({
            longitude: -118.2437,
            latitude: 34.0522,
            spatialReference: { wkid: 4326 }
        });

        console.log("🎯 Testing symbol centering at:", testPoint);

        // Create reference marker (simple red circle) - this should be perfectly centered
        const referenceSymbol = new SimpleMarkerSymbol({
            style: "circle",
            color: [255, 0, 0, 0.5],
            size: 8,
            outline: {
                color: [255, 255, 255, 1],
                width: 2
            }
        });

        const referenceGraphic = new Graphic({
            geometry: testPoint,
            symbol: referenceSymbol
        });

        // Create tactical point symbol
        const tacticalPoint = new TacticalPoint(this.view);
        
        const markerOptions: MarkerOptions = {
            color: [0, 0, 255, 0.8],
            size: 32,
            outline: {
                color: [255, 255, 255, 1],
                width: 2
            }
        };

        try {
            // Add reference marker first
            this.view.graphics.add(referenceGraphic);
            console.log("✓ Added reference marker (red circle)");

            // Add tactical point
            tacticalPoint.init(
                {
                    GEOM: testPoint,
                    SIZE: 32
                },
                markerOptions,
                "100000",
                "DebugTacticalPoint",
                "0", // Use center positioning
                "SPGP------"
            );

            console.log("✓ Added tactical point symbol");
            console.log("📍 Both symbols should be centered on the same point");
            console.log("🔍 Red circle = reference center");
            console.log("🔷 Blue tactical symbol = should align with red circle");

        } catch (error) {
            console.error("❌ Error creating test symbols:", error);
        }
    }

    /**
     * Test different offset values
     */
    public async testOffsetValues(location?: Point): Promise<void> {
        const testPoint = location || this.view.center || new Point({
            longitude: -118.2437,
            latitude: 34.0522,
            spatialReference: { wkid: 4326 }
        });

        console.log("🎯 Testing different offset values");

        const offsets = ["0", "1"]; // Center vs Bottom
        const colors = [[255, 0, 0, 0.8], [0, 255, 0, 0.8]]; // Red, Green

        for (let i = 0; i < offsets.length; i++) {
            const offset = offsets[i];
            const color = colors[i];
            
            // Create test point slightly offset for visibility
            const offsetTestPoint = new Point({
                longitude: (testPoint.longitude || -118.2437) + (i * 0.001),
                latitude: testPoint.latitude || 34.0522,
                spatialReference: testPoint.spatialReference
            });

            const tacticalPoint = new TacticalPoint(this.view);
            
            const markerOptions: MarkerOptions = {
                color: color,
                size: 32,
                outline: {
                    color: [255, 255, 255, 1],
                    width: 2
                }
            };

            try {
                tacticalPoint.init(
                    {
                        GEOM: offsetTestPoint,
                        SIZE: 32
                    },
                    markerOptions,
                    "100000",
                    `DebugOffset${offset}`,
                    offset,
                    "SPGP------"
                );

                console.log(`✓ Added tactical point with offset "${offset}" (${offset === "0" ? "center" : "bottom"})`);
            } catch (error) {
                console.error(`❌ Error creating symbol with offset ${offset}:`, error);
            }
        }
    }

    /**
     * Create manual PictureMarkerSymbol for comparison
     */
    public async testManualPictureSymbol(location?: Point): Promise<void> {
        const testPoint = location || this.view.center || new Point({
            longitude: -118.2437,
            latitude: 34.0522,
            spatialReference: { wkid: 4326 }
        });

        console.log("🎯 Testing manual PictureMarkerSymbol");

        // Create a simple manual SVG for comparison
        const manualSvg = `<svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
            <circle cx="32" cy="32" r="28" fill="purple" stroke="white" stroke-width="2"/>
            <text x="32" y="38" text-anchor="middle" fill="white" font-size="12">M</text>
        </svg>`;

        const base64Svg = btoa(manualSvg);
        const dataUrl = `data:image/svg+xml;base64,${base64Svg}`;

        const manualSymbol = new PictureMarkerSymbol({
            url: dataUrl,
            width: 64,
            height: 64,
            xoffset: 0,
            yoffset: 0
        });

        const manualGraphic = new Graphic({
            geometry: testPoint,
            symbol: manualSymbol
        });

        this.view.graphics.add(manualGraphic);
        console.log("✓ Added manual PictureMarkerSymbol (purple circle with 'M')");
        console.log("📍 This should be perfectly centered if PictureMarkerSymbol works correctly");
    }

    /**
     * Clear all debug graphics
     */
    public clearDebugGraphics(): void {
        this.view.graphics.removeAll();
        console.log("🧹 Cleared all debug graphics");
    }

    /**
     * Run comprehensive debug test suite
     */
    public async runDebugSuite(): Promise<void> {
        console.log("🧪 Starting TacticalPoint Debug Suite...");
        
        // Clear any existing graphics
        this.clearDebugGraphics();
        
        const testLocation = this.view.center || new Point({
            longitude: -118.2437,
            latitude: 34.0522,
            spatialReference: { wkid: 4326 }
        });

        console.log("\n1️⃣ Testing symbol centering comparison...");
        await this.testSymbolCentering(testLocation);

        console.log("\n2️⃣ Testing different offset values...");
        await this.testOffsetValues(testLocation);

        console.log("\n3️⃣ Testing manual PictureMarkerSymbol...");
        const manualTestLocation = new Point({
            longitude: (testLocation.longitude || -118.2437) + 0.003,
            latitude: testLocation.latitude || 34.0522,
            spatialReference: testLocation.spatialReference
        });
        await this.testManualPictureSymbol(manualTestLocation);

        console.log("\n✅ Debug suite completed!");
        console.log("📍 Check the map to see all test symbols");
        console.log("🔍 Compare positioning between different symbol types");
    }
}

export default TacticalPointDebug; 