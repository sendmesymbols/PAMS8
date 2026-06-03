import Polyline from "@arcgis/core/geometry/Polyline";
import Polygon from "@arcgis/core/geometry/Polygon";
import TextSymbol from "@arcgis/core/symbols/TextSymbol";
import Graphic from "@arcgis/core/Graphic";
import Font from "@arcgis/core/symbols/Font";
import Point from "@arcgis/core/geometry/Point";
import Color from "@arcgis/core/Color";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Geometry from "@arcgis/core/geometry/Geometry";

// Import local utilities
import GeoTools from "../Support/GeoTools.ts";
import GraphicsLayerManager, { LAYER_NAMES } from "../Managers/GraphicsLayerManager";
import Amplifier from "../Support/Amplifier";
import DrawEssentials from "../Support/DrawEssentials";

// Interface for label options
interface LabelOptions {
    color?: number[];
    haloColorSize?: number;
    haloColor?: number[];
    textSize?: number;
    bold?: number;
    italic?: number;
    uLine?: number; // underline
    oLine?: number; // overline
    tLine?: number; // through line
}

// Interface for annotation options
interface AnnotationOptions {
    opacity?: number;
}

/**
 * AnnotationEngine - TypeScript version for ArcGIS API 4.x
 * Handles creation of text annotations for military symbols
 */
class AnnotationEngine {
    /**
     * Main annotation method - creates text labels for military symbols
     * @param textGraphicsLayer - The graphics layer to add text annotations to
     * @param geometry - The geometry to annotate
     * @param amplifier - The amplifier object containing label data
     * @param drawEssentials - Drawing essentials configuration
     * @param parentId - Parent ID for linking annotations to their symbols
     * @param textSize - Text size for labels
     * @param isFreeHand - Whether the symbol was drawn freehand
     * @param labelOptions - Label styling options
     * @param options - Additional options including opacity
     */
    static annotate(
        textGraphicsLayer: GraphicsLayer,
        geometry: Geometry,
        amplifier: Amplifier,
        drawEssentials: DrawEssentials,
        parentId: string,
        textSize: number,
        isFreeHand: number,
        labelOptions: LabelOptions = {},
        options: AnnotationOptions = {}
    ): void {
        // Set default opacity
        let opacity = 1;
        if (options && options.hasOwnProperty('opacity')) {
            opacity = options.opacity!;
        }

        // Skip UEI symbols (legacy check)
        if (drawEssentials.hasOwnProperty("UEI")) {
            return;
        }

        // Create font for text symbols
        const font = new Font({
            family: "Arial",
            size: textSize + "pt"
        });

        const symGeoType = drawEssentials.SYM_GEO_TYPE;

        try {
            if (symGeoType === 'Area') {
                this.annotateAreaSymbol(textGraphicsLayer, geometry, amplifier, drawEssentials, parentId, font, opacity, isFreeHand);
            } else if (symGeoType === 'Line') {
                this.annotateLineSymbol(textGraphicsLayer, geometry, amplifier, drawEssentials, parentId, font, opacity, isFreeHand);
            } else if (symGeoType === 'Point') {
                this.annotatePointSymbol(textGraphicsLayer, geometry, amplifier, drawEssentials, parentId, font, opacity, isFreeHand, labelOptions);
            }
        } catch (error) {
            console.error("Error in AnnotationEngine.annotate:", error);
        }
    }

    /**
     * Annotate area (polygon) symbols
     */
    private static annotateAreaSymbol(
        textGraphicsLayer: GraphicsLayer,
        geometry: Geometry,
        amplifier: Amplifier,
        drawEssentials: DrawEssentials,
        parentId: string,
        font: Font,
        opacity: number,
        isFreeHand: number
    ): void {
        if (!geometry.extent) {
            console.warn("Cannot annotate area symbol: geometry extent is null");
            return;
        }

        const extent = geometry.extent;
        
        // Calculate area (for potential future use)
        const area = GeoTools.getArea(extent);

        // Unique Designation - Center
        if (amplifier.hasOwnProperty("UNIQUE_DESIG") && amplifier.UNIQUE_DESIG && amplifier.UNIQUE_DESIG.length > 0) {
            try {
                const uniqueDesigPt = extent.center;
                if (uniqueDesigPt && !isNaN(uniqueDesigPt.x) && !isNaN(uniqueDesigPt.y)) {
                    const uniqueDesigText = new TextSymbol({
                        text: amplifier.UNIQUE_DESIG,
                        font: font,
                        color: new Color([0, 0, 0, opacity]),
                        haloColor: new Color([255, 255, 255, opacity]),
                        haloSize: 1
                    });

                    const uniqueDesigGraphic = new Graphic({
                        geometry: uniqueDesigPt,
                        symbol: uniqueDesigText,
                        attributes: {
                            parentId: parentId,
                            isFreeHand: isFreeHand
                        }
                    });

                    textGraphicsLayer.add(uniqueDesigGraphic);
                }
            } catch (e) {
                console.log('Malformed Geometry Found in Unique Designation');
            }
        }

        // DTG (Date Time Group) - Above center
        if (amplifier.hasOwnProperty("DTG") && amplifier.DTG && amplifier.DTG.length > 0) {
            try {
                const centerTop = new Point({
                    x: extent.center.x,
                    y: extent.center.y + extent.height / 2,
                    spatialReference: geometry.spatialReference
                });

                const dtgText = new TextSymbol({
                    text: amplifier.DTG,
                    font: font,
                    color: new Color([0, 0, 0, opacity]),
                    haloColor: new Color([255, 255, 255, opacity]),
                    haloSize: 1
                });

                const dtgGraphic = new Graphic({
                    geometry: centerTop,
                    symbol: dtgText,
                    attributes: {
                        parentId: parentId,
                        isFreeHand: isFreeHand
                    }
                });

                textGraphicsLayer.add(dtgGraphic);
            } catch (e) {
                console.log('Malformed Geometry Found in DTG');
            }
        }

        // EDTG (Effective Date Time Group) - Below center
        if (amplifier.hasOwnProperty("EDTG") && amplifier.EDTG && amplifier.EDTG.length > 0) {
            try {
                const centerBottom = new Point({
                    x: extent.center.x,
                    y: extent.center.y - extent.height / 2,
                    spatialReference: geometry.spatialReference
                });

                const edtgText = new TextSymbol({
                    text: amplifier.EDTG,
                    font: font,
                    color: new Color([0, 0, 0, opacity]),
                    haloColor: new Color([255, 255, 255, opacity]),
                    haloSize: 1
                });

                const edtgGraphic = new Graphic({
                    geometry: centerBottom,
                    symbol: edtgText,
                    attributes: {
                        parentId: parentId,
                        isFreeHand: isFreeHand
                    }
                });

                textGraphicsLayer.add(edtgGraphic);
            } catch (e) {
                console.log('Malformed Geometry Found in EDTG');
            }
        }
    }

    /**
     * Annotate line (polyline) symbols
     */
    private static annotateLineSymbol(
        textGraphicsLayer: GraphicsLayer,
        geometry: Geometry,
        amplifier: Amplifier,
        drawEssentials: DrawEssentials,
        parentId: string,
        font: Font,
        opacity: number,
        isFreeHand: number
    ): void {
        if (!geometry.extent) {
            console.warn("Cannot annotate line symbol: geometry extent is null");
            return;
        }

        const extent = geometry.extent;
        const polyline = geometry as Polyline;

        // Unique Designation - Center of line
        if (amplifier.hasOwnProperty("UNIQUE_DESIG") && amplifier.UNIQUE_DESIG && amplifier.UNIQUE_DESIG.length > 0) {
            try {
                let uniqueDesigText: TextSymbol;
                let position: Point = extent.center;

                // Special handling for Boundary symbols
                if (drawEssentials.SYM_NAME === "Boundary") {
                    uniqueDesigText = new TextSymbol({
                        text: amplifier.UNIQUE_DESIG,
                        font: font,
                        color: new Color([0, 0, 0, opacity]),
                        haloColor: new Color([255, 255, 255, opacity]),
                        haloSize: 1,
                        yoffset: 30,
                        xoffset: -20
                    });
                } else {
                    uniqueDesigText = new TextSymbol({
                        text: amplifier.UNIQUE_DESIG,
                        font: font,
                        color: new Color([0, 0, 0, opacity]),
                        haloColor: new Color([255, 255, 255, opacity]),
                        haloSize: 1
                    });
                }

                const uniqueDesigGraphic = new Graphic({
                    geometry: position,
                    symbol: uniqueDesigText,
                    attributes: {
                        parentId: parentId,
                        isFreeHand: isFreeHand
                    }
                });

                textGraphicsLayer.add(uniqueDesigGraphic);
            } catch (e) {
                console.log('Malformed Geometry Found in Unique Designation');
            }
        }

        // Higher Formation for Boundary symbols
        if (drawEssentials.SYM_NAME === "Boundary" && amplifier.hasOwnProperty("HIGHER_FORM") && amplifier.HIGHER_FORM && amplifier.HIGHER_FORM.length > 0) {
            try {
                const highFormText = new TextSymbol({
                    text: amplifier.HIGHER_FORM,
                    font: font,
                    color: new Color([0, 0, 0, opacity]),
                    haloColor: new Color([255, 255, 255, opacity]),
                    haloSize: 1,
                    yoffset: -30,
                    xoffset: 30
                });

                const highFormGraphic = new Graphic({
                    geometry: extent.center,
                    symbol: highFormText,
                    attributes: {
                        parentId: parentId,
                        isFreeHand: isFreeHand
                    }
                });

                textGraphicsLayer.add(highFormGraphic);
            } catch (e) {
                console.log('Malformed Geometry Found in Higher Formation');
            }
        }

        // DTG - Start of line
        if (amplifier.hasOwnProperty("DTG") && amplifier.DTG && amplifier.DTG.length > 0) {
            try {
                // Get first point of the polyline
                const firstPoint = this.getFirstPoint(polyline);
                if (firstPoint) {
                    const dtgText = new TextSymbol({
                        text: amplifier.DTG,
                        font: font,
                        color: new Color([0, 0, 0, opacity]),
                        haloColor: new Color([255, 255, 255, opacity]),
                        haloSize: 1
                    });

                    const dtgGraphic = new Graphic({
                        geometry: firstPoint,
                        symbol: dtgText,
                        attributes: {
                            parentId: parentId,
                            isFreeHand: isFreeHand
                        }
                    });

                    textGraphicsLayer.add(dtgGraphic);
                }
            } catch (e) {
                console.log('Malformed Geometry Found in DTG');
            }
        }

        // EDTG - End of line
        if (amplifier.hasOwnProperty("EDTG") && amplifier.EDTG && amplifier.EDTG.length > 0) {
            try {
                // Get last point of the polyline
                const lastPoint = this.getLastPoint(polyline);
                if (lastPoint) {
                    const edtgText = new TextSymbol({
                        text: amplifier.EDTG,
                        font: font,
                        color: new Color([0, 0, 0, opacity]),
                        haloColor: new Color([255, 255, 255, opacity]),
                        haloSize: 1
                    });

                    const edtgGraphic = new Graphic({
                        geometry: lastPoint,
                        symbol: edtgText,
                        attributes: {
                            parentId: parentId,
                            isFreeHand: isFreeHand
                        }
                    });

                    textGraphicsLayer.add(edtgGraphic);
                }
            } catch (e) {
                console.log('Malformed Geometry Found in EDTG');
            }
        }
    }

    /**
     * Annotate point symbols
     */
    private static annotatePointSymbol(
        textGraphicsLayer: GraphicsLayer,
        geometry: Geometry,
        amplifier: Amplifier,
        drawEssentials: DrawEssentials,
        parentId: string,
        font: Font,
        opacity: number,
        isFreeHand: number,
        labelOptions: LabelOptions
    ): void {
        // Special handling for Artillery Target Symbol (SIDC 160303)
        if (drawEssentials.SID === "160303") {
            drawEssentials.OFFSET = "0";
            
            if (amplifier.hasOwnProperty("UNIQUE_DESIG")) {
                this.createLabelFromProperty(textGraphicsLayer, geometry, "UNIQUE_DESIG", isFreeHand, parentId, amplifier, drawEssentials, font, opacity, labelOptions, "bottom", "right", -5, 0);
            }
            if (amplifier.hasOwnProperty("TARGET_DESIGNATOR")) {
                this.createLabelFromProperty(textGraphicsLayer, geometry, "TARGET_DESIGNATOR", isFreeHand, parentId, amplifier, drawEssentials, font, opacity, labelOptions, "bottom", "left", 5, 0);
            }
            if (amplifier.hasOwnProperty("STAFF_COM")) {
                this.createLabelFromProperty(textGraphicsLayer, geometry, "STAFF_COM", isFreeHand, parentId, amplifier, drawEssentials, font, opacity, labelOptions, "top", "right", -5, -3);
            }
            if (amplifier.hasOwnProperty("ADDL_INFO")) {
                this.createLabelFromProperty(textGraphicsLayer, geometry, "ADDL_INFO", isFreeHand, parentId, amplifier, drawEssentials, font, opacity, labelOptions, "top", "left", 5, -3);
            }
        } else {
            // Standard point symbol annotation
            this.createLabelFromProperty(textGraphicsLayer, geometry, "UNIQUE_DESIG", isFreeHand, parentId, amplifier, drawEssentials, font, opacity, labelOptions);
        }
    }

    /**
     * Create a label from an amplifier property
     */
    private static createLabelFromProperty(
        textGraphicsLayer: GraphicsLayer,
        geometry: Geometry,
        property: string,
        isFreeHand: number,
        parentId: string,
        amplifier: Amplifier,
        drawEssentials: DrawEssentials,
        font: Font,
        opacity: number,
        labelOptions: LabelOptions,
        verticalAlignment?: string,
        horizontalAlignment?: string,
        xOffset?: number,
        yOffset?: number
    ): void {
        if (!amplifier.hasOwnProperty(property) || !amplifier[property] || amplifier[property].length === 0) {
            return;
        }

        try {
            const text = amplifier[property];
            
            // Create text symbol with base properties
            const textSymbolOptions: any = {
                text: text,
                font: font,
                color: new Color([0, 0, 0, opacity]),
                haloColor: new Color([255, 255, 255, opacity]),
                haloSize: 1
            };

            // Apply alignment if specified
            if (verticalAlignment) {
                textSymbolOptions.verticalAlignment = verticalAlignment;
            }
            if (horizontalAlignment) {
                textSymbolOptions.horizontalAlignment = horizontalAlignment;
            }

            // Apply offsets
            if (drawEssentials.OFFSET === "0") {
                if (xOffset !== undefined) textSymbolOptions.xoffset = xOffset;
                if (yOffset !== undefined) textSymbolOptions.yoffset = yOffset;
            } else if (drawEssentials.OFFSET === "1") {
                textSymbolOptions.yoffset = (drawEssentials.SIZE || 35) / 2;
            } else {
                textSymbolOptions.yoffset = (drawEssentials.SIZE || 35) - 8;
            }

            // Apply label options
            if (labelOptions.color) {
                textSymbolOptions.color = new Color(labelOptions.color);
            }

            if (labelOptions.haloColorSize) {
                textSymbolOptions.haloSize = labelOptions.haloColorSize;
                if (labelOptions.haloColor) {
                    textSymbolOptions.haloColor = new Color(labelOptions.haloColor);
                }
            }

            if (labelOptions.textSize) {
                const newFont = font.clone();
                newFont.size = labelOptions.textSize + "pt";
                textSymbolOptions.font = newFont;
            }

            if (labelOptions.bold === 1) {
                const newFont = textSymbolOptions.font ? textSymbolOptions.font.clone() : font.clone();
                newFont.weight = "bold";
                textSymbolOptions.font = newFont;
            }

            if (labelOptions.italic === 1) {
                const newFont = textSymbolOptions.font ? textSymbolOptions.font.clone() : font.clone();
                newFont.style = "italic";
                textSymbolOptions.font = newFont;
            }

            // Apply decorations (underline, overline, line-through)
            const decorations: string[] = [];
            if (labelOptions.uLine === 1) decorations.push("underline");
            if (labelOptions.oLine === 1) decorations.push("line-through");
            if (labelOptions.tLine === 1) decorations.push("overline");
            if (decorations.length > 0) textSymbolOptions.decoration = decorations.join(" ");

            const textSymbol = new TextSymbol(textSymbolOptions);

            const graphic = new Graphic({
                geometry: geometry,
                symbol: textSymbol,
                attributes: {
                    parentId: parentId,
                    isFreeHand: isFreeHand
                }
            });

            textGraphicsLayer.add(graphic);
        } catch (error) {
            console.error(`Error creating label for property ${property}:`, error);
        }
    }

    /**
     * Remove all annotations for a given parent ID
     */
    static deAnnotate(textGraphicsLayer: GraphicsLayer, parentId: string): void {
        const graphics = textGraphicsLayer.graphics.toArray();
        for (let i = graphics.length - 1; i >= 0; i--) {
            const graphic = graphics[i];
            if (graphic.attributes && graphic.attributes.parentId === parentId) {
                textGraphicsLayer.remove(graphic);
            }
        }
    }

    /**
     * Get the first point from a polyline
     */
    private static getFirstPoint(polyline: Polyline): Point | null {
        if (!polyline.paths || polyline.paths.length === 0 || polyline.paths[0].length === 0) {
            return null;
        }

        const firstPath = polyline.paths[0];
        const firstCoord = firstPath[0];
        
        return new Point({
            x: firstCoord[0],
            y: firstCoord[1],
            spatialReference: polyline.spatialReference
        });
    }

    /**
     * Get the last point from a polyline
     */
    private static getLastPoint(polyline: Polyline): Point | null {
        if (!polyline.paths || polyline.paths.length === 0) {
            return null;
        }

        const lastPath = polyline.paths[polyline.paths.length - 1];
        if (lastPath.length === 0) {
            return null;
        }

        const lastCoord = lastPath[lastPath.length - 1];
        
        return new Point({
            x: lastCoord[0],
            y: lastCoord[1],
            spatialReference: polyline.spatialReference
        });
    }

    /**
     * Get annotation layer from GraphicsLayerManager
     */
    static getAnnotationLayer(layerManager: GraphicsLayerManager): GraphicsLayer {
        return layerManager.getOrCreateLayer(LAYER_NAMES.ANNOTATION_LAYER);
    }
}

export default AnnotationEngine; 