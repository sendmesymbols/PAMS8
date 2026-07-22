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
import settingsData from "../Data/Settings.json";

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
    fontFamily?: string; // font family (default Arial); must be a cross-platform, 3D-safe family
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

        // Create font for text symbols. Family resolves from the per-symbol
        // labelOptions, then the global Text Style setting, then Arial. This one
        // Font is threaded into all three annotators (and cloned downstream), so
        // it governs font-family for Point, Area, and Line labels.
        const font = new Font({
            family: labelOptions.fontFamily || (settingsData as any).textStyle?.fontFamily || "Arial",
            size: textSize + "pt"
        });

        const symGeoType = drawEssentials.SYM_GEO_TYPE;

        try {
            if (symGeoType === 'Area') {
                this.annotateAreaSymbol(textGraphicsLayer, geometry, amplifier, drawEssentials, parentId, font, opacity, isFreeHand, labelOptions);
            } else if (symGeoType === 'Line') {
                this.annotateLineSymbol(textGraphicsLayer, geometry, amplifier, drawEssentials, parentId, font, opacity, isFreeHand, labelOptions);
            } else if (symGeoType === 'Point') {
                this.annotatePointSymbol(textGraphicsLayer, geometry, amplifier, drawEssentials, parentId, font, opacity, isFreeHand, labelOptions);
            }
        } catch (error) {
            console.error("Error in AnnotationEngine.annotate:", error);
        }
    }

    /**
     * Build a TextSymbol honoring labelOptions (color, halo, size, bold, italic,
     * font family via the shared font, and text decoration) with sensible
     * defaults (black text / white halo, size 1) when a field is unset. Shared by
     * the Area, Line and Point annotators so every label styles consistently.
     * `extraProps` (offsets / alignment) merges last.
     */
    private static styledTextSymbol(
        text: string,
        font: Font,
        opacity: number,
        labelOptions: LabelOptions = {},
        extraProps: any = {}
    ): TextSymbol {
        const opts: any = {
            text,
            font,
            color: labelOptions.color ? new Color([...labelOptions.color]) : new Color([0, 0, 0, opacity]),
            haloColor: labelOptions.haloColor ? new Color([...labelOptions.haloColor]) : new Color([255, 255, 255, opacity]),
            haloSize: labelOptions.haloColorSize != null ? labelOptions.haloColorSize : 1,
        };

        // Size / bold / italic / decoration all live on the Font (not the
        // TextSymbol) — clone off the shared font so its family + size survive.
        // ArcGIS Font.decoration is single-valued and supports only 'underline' /
        // 'line-through' (there is no 'overline'), so uLine wins, then tLine.
        let f: Font | null = null;
        if (labelOptions.textSize) { f = (f || font).clone(); f.size = labelOptions.textSize + "pt"; }
        if (labelOptions.bold === 1) { f = (f || font).clone(); f.weight = "bold"; }
        if (labelOptions.italic === 1) { f = (f || font).clone(); f.style = "italic"; }
        const decoration = labelOptions.uLine === 1 ? "underline"
            : labelOptions.tLine === 1 ? "line-through"
            : null;
        if (decoration) { f = (f || font).clone(); (f as any).decoration = decoration; }
        if (f) opts.font = f;

        return new TextSymbol(Object.assign(opts, extraProps));
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
        isFreeHand: number,
        labelOptions: LabelOptions = {}
    ): void {
        if (!geometry.extent) {
            console.warn("Cannot annotate area symbol: geometry extent is null");
            return;
        }

        const extent = geometry.extent;

        // Calculate area (for potential future use)
        const area = GeoTools.getArea(extent);

        // Callout Box (AutoShape DRAW_TYPE 8) has a downward tail, so its box
        // region is only the top ~75% of the extent. Bias the centred text up so
        // it sits inside the box rather than over the tail. Ordinary areas keep
        // the true extent centre.
        const isCalloutBox = Number((drawEssentials as any).DRAW_TYPE) === 8;
        const centerY = isCalloutBox
            ? extent.ymin + extent.height * 0.625
            : extent.center.y;

        // Unique Designation - Center
        if (amplifier.hasOwnProperty("UNIQUE_DESIG") && amplifier.UNIQUE_DESIG && amplifier.UNIQUE_DESIG.length > 0) {
            try {
                const uniqueDesigPt = new Point({
                    x: extent.center.x,
                    y: centerY,
                    spatialReference: geometry.spatialReference
                });
                if (uniqueDesigPt && !isNaN(uniqueDesigPt.x) && !isNaN(uniqueDesigPt.y)) {
                    const uniqueDesigText = this.styledTextSymbol(amplifier.UNIQUE_DESIG, font, opacity, labelOptions);

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

                const dtgText = this.styledTextSymbol(amplifier.DTG, font, opacity, labelOptions);

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

                const edtgText = this.styledTextSymbol(amplifier.EDTG, font, opacity, labelOptions);

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
        isFreeHand: number,
        labelOptions: LabelOptions = {}
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

                // Special handling for Boundary symbols (offset the label off the line)
                if (drawEssentials.SYM_NAME === "Boundary") {
                    uniqueDesigText = this.styledTextSymbol(amplifier.UNIQUE_DESIG, font, opacity, labelOptions, { yoffset: 30, xoffset: -20 });
                } else {
                    uniqueDesigText = this.styledTextSymbol(amplifier.UNIQUE_DESIG, font, opacity, labelOptions);
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
                const highFormText = this.styledTextSymbol(amplifier.HIGHER_FORM, font, opacity, labelOptions, { yoffset: -30, xoffset: 30 });

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
                    const dtgText = this.styledTextSymbol(amplifier.DTG, font, opacity, labelOptions);

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
                    const edtgText = this.styledTextSymbol(amplifier.EDTG, font, opacity, labelOptions);

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

            // Alignment + offset go into extraProps; all colour/halo/font/decoration
            // styling is handled by the shared styledTextSymbol helper (so Point,
            // Area and Line labels style identically and the decoration mapping is
            // correct in one place).
            const extraProps: any = {};
            if (verticalAlignment) extraProps.verticalAlignment = verticalAlignment;
            if (horizontalAlignment) extraProps.horizontalAlignment = horizontalAlignment;

            if (drawEssentials.OFFSET === "0") {
                if (xOffset !== undefined) extraProps.xoffset = xOffset;
                if (yOffset !== undefined) extraProps.yoffset = yOffset;
            } else if (drawEssentials.OFFSET === "1") {
                extraProps.yoffset = (drawEssentials.SIZE || 35) / 2;
            } else {
                extraProps.yoffset = (drawEssentials.SIZE || 35) - 8;
            }

            const textSymbol = this.styledTextSymbol(text, font, opacity, labelOptions, extraProps);

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