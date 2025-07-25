import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Geometry from "@arcgis/core/geometry/Geometry";
import GraphicsLayerManager from "../Managers/GraphicsLayerManager";
import Amplifier from "../Support/Amplifier";
import DrawEssentials from "../Support/DrawEssentials";
interface LabelOptions {
    color?: number[];
    haloColorSize?: number;
    haloColor?: number[];
    textSize?: number;
    bold?: number;
    italic?: number;
    uLine?: number;
    oLine?: number;
    tLine?: number;
}
interface AnnotationOptions {
    opacity?: number;
}
/**
 * AnnotationEngine - TypeScript version for ArcGIS API 4.x
 * Handles creation of text annotations for military symbols
 */
declare class AnnotationEngine {
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
    static annotate(textGraphicsLayer: GraphicsLayer, geometry: Geometry, amplifier: Amplifier, drawEssentials: DrawEssentials, parentId: string, textSize: number, isFreeHand: number, labelOptions?: LabelOptions, options?: AnnotationOptions): void;
    /**
     * Annotate area (polygon) symbols
     */
    private static annotateAreaSymbol;
    /**
     * Annotate line (polyline) symbols
     */
    private static annotateLineSymbol;
    /**
     * Annotate point symbols
     */
    private static annotatePointSymbol;
    /**
     * Create a label from an amplifier property
     */
    private static createLabelFromProperty;
    /**
     * Remove all annotations for a given parent ID
     */
    static deAnnotate(textGraphicsLayer: GraphicsLayer, parentId: string): void;
    /**
     * Get the first point from a polyline
     */
    private static getFirstPoint;
    /**
     * Get the last point from a polyline
     */
    private static getLastPoint;
    /**
     * Get annotation layer from GraphicsLayerManager
     */
    static getAnnotationLayer(layerManager: GraphicsLayerManager): GraphicsLayer;
}
export default AnnotationEngine;
