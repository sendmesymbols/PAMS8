import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Polygon from "@arcgis/core/geometry/Polygon";
/**
 * DrawEssentials class for military symbology drawing operations
 * Handles essential drawing parameters and geometry data
 */
export declare class DrawEssentials {
    BK_LN_DIST_RATIO?: number;
    BK_LN_ANGL_RATIO?: number;
    FRNT_LN_ANGL_RATIO?: number;
    FRNT_LN_DIST_RATIO?: number;
    FLAP_DIST_RATIO?: number;
    SCOPE: string;
    SID: string;
    SYM_NAME: string;
    SYM_GEO_TYPE: string;
    DRAW_TYPE?: number;
    AMPLIFIER: string;
    IS_LINE: boolean;
    GEOM: Point | Polyline | Polygon | null;
    IS_OBS: number;
    SIZE: number;
    ARROWHEAD_RATIO: number;
    ECHELON: string;
    OFFSET: string;
    ISFHAND?: number;
    opacity?: number;
    SIDC?: string;
    labelOptions: {
        haloColor: number[];
        haloColorSize: number;
        color: number[];
        textSize: number;
        bold: number;
        italic: number;
        uLine: number;
        oLine: number;
        tLine: number;
    };
    extraSettings: {
        lineWidth: number;
        size: number;
        textSize: number;
        opacity: number;
    };
    uniqueDesignation?: string;
    infoFields?: boolean;
    FLAP_ANGLE?: number;
    cim?: {
        style?: string;
        size?: number;
        color?: string;
        gridType?: "Fixed" | "Random";
        randomness?: number;
        stepX?: number;
        stepY?: number;
        shiftOddRows?: boolean;
    };
    constructor(options?: Partial<DrawEssentials>);
    /**
     * Reset all properties to default values
     */
    reset(): void;
    /**
     * Clone the current DrawEssentials instance
     */
    clone(): DrawEssentials;
    /**
     * Check if the DrawEssentials has valid geometry
     */
    hasGeometry(): boolean;
    /**
     * Check if the DrawEssentials has control points
     */
    hasControlPoints(): boolean;
    /**
     * Check if the DrawEssentials has base line points
     */
    hasBaseLinePoints(): boolean;
}
export default DrawEssentials;
