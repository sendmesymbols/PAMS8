import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Polygon from "@arcgis/core/geometry/Polygon";

/**
 * DrawEssentials class for military symbology drawing operations
 * Handles essential drawing parameters and geometry data
 */
export class DrawEssentials {
    // Base line properties
    public BK_LN_DIST_RATIO?:number = 5;
    public BK_LN_ANGL_RATIO?:number = 5;
    public FRNT_LN_ANGL_RATIO?:number = 0.8;
    public FRNT_LN_DIST_RATIO?:number = 1.5;
    public FLAP_DIST_RATIO?:number = 3;

    // Control and scope properties
    public SCOPE: string = "";
    public BASE_LN_PTS: {
        startPt?: Point;
        midPt?: Point;
        endPt?: Point;
    } = {};
    public CTRL_PTS: Point[] = [];

    // Symbol identification
    public SID: string = "";
    public SYM_NAME: string = "";
    public SYM_GEO_TYPE: string = "";

    // Drawing properties
    public DRAW_TYPE?: number = undefined;
    public AMPLIFIER: string = "";
    public IS_LINE: boolean = false;
    public GEOM: Point | Polyline | Polygon | null = null;
    public IS_OBS: number = 0;
    public SIZE: number = 0;
    public ARROWHEAD_RATIO: number = 0;
    public ECHELON: string = "";

    // Additional properties for compatibility
    public ISFHAND?: number;
    public opacity?: number;
    public SIDC?: string;

    // Label settings
    public labelOptions: {
        haloColor: number[];
        haloColorSize: number;
        color: number[];
        textSize: number;
        bold: number;
        italic: number;
        uLine: number;
        oLine: number;
        tLine: number;
    } = {
        haloColor: [255, 0, 0],
        haloColorSize: 5,
        color: [0, 255, 0],
        textSize: 20,
        bold: 1,
        italic: 0,
        uLine: 0,
        oLine: 0,
        tLine: 0
    };

    // Extra settings
    public extraSettings: {
        lineWidth: number;
        size: number;
        textSize: number;
        opacity: number;
    } = {
        lineWidth: 3,
        size: 20,
        textSize: 12,
        opacity: 1
    };

    public uniqueDesignation?: string;
    public infoFields?: boolean;

    public FLAP_ANGLE?: number;

    constructor(options?: Partial<DrawEssentials>) {
        if (options) {
            Object.assign(this, options);
        }
    }

    /**
     * Reset all properties to default values
     */
    public reset(): void {
        this.BK_LN_DIST_RATIO = 5;
        this.BK_LN_ANGL_RATIO = 5;
        this.FRNT_LN_ANGL_RATIO = 0.8;
        this.SCOPE = "";
        this.BASE_LN_PTS = {};
        this.CTRL_PTS = [];
        this.SID = "";
        this.SYM_NAME = "";
        this.SYM_GEO_TYPE = "";
        this.DRAW_TYPE = undefined;
        this.AMPLIFIER = "";
        this.IS_LINE = false;
        this.GEOM = null;
        this.IS_OBS = 0;
        this.SIZE = 0;
        this.ARROWHEAD_RATIO = 0;
        this.ECHELON = "";
        this.ISFHAND = undefined;
        this.opacity = undefined;
        this.SIDC = undefined;
        this.labelOptions = {
            haloColor: [255, 0, 0],
            haloColorSize: 5,
            color: [0, 255, 0],
            textSize: 20,
            bold: 1,
            italic: 0,
            uLine: 0,
            oLine: 0,
            tLine: 0
        };
        this.extraSettings = {
            lineWidth: 3,
            size: 20,
            textSize: 12,
            opacity: 1
        };
        this.uniqueDesignation = "";
        this.infoFields = false;
        this.FLAP_ANGLE = undefined;
        this.FRNT_LN_DIST_RATIO = undefined;
        this.FLAP_DIST_RATIO = undefined;
    }

    /**
     * Clone the current DrawEssentials instance
     */
    public clone(): DrawEssentials {
        return new DrawEssentials({
            BK_LN_DIST_RATIO: this.BK_LN_DIST_RATIO,
            BK_LN_ANGL_RATIO: this.BK_LN_ANGL_RATIO,
            FRNT_LN_ANGL_RATIO: this.FRNT_LN_ANGL_RATIO,
            SCOPE: this.SCOPE,
            BASE_LN_PTS: { ...this.BASE_LN_PTS },
            CTRL_PTS: [...this.CTRL_PTS],
            SID: this.SID,
            SYM_NAME: this.SYM_NAME,
            SYM_GEO_TYPE: this.SYM_GEO_TYPE,
            DRAW_TYPE: this.DRAW_TYPE,
            AMPLIFIER: this.AMPLIFIER,
            IS_LINE: this.IS_LINE,
            GEOM: this.GEOM,
            IS_OBS: this.IS_OBS,
            SIZE: this.SIZE,
            ARROWHEAD_RATIO: this.ARROWHEAD_RATIO,
            ECHELON: this.ECHELON,
            ISFHAND: this.ISFHAND,
            opacity: this.opacity,
            SIDC: this.SIDC,
            labelOptions: this.labelOptions,
            extraSettings: this.extraSettings,
            uniqueDesignation: this.uniqueDesignation,
            infoFields: this.infoFields,
            FLAP_ANGLE: this.FLAP_ANGLE,
            FRNT_LN_DIST_RATIO : this.FRNT_LN_DIST_RATIO,
            FLAP_DIST_RATIO:  this.FLAP_DIST_RATIO,
        });
    }

    /**
     * Check if the DrawEssentials has valid geometry
     */
    public hasGeometry(): boolean {
        return this.GEOM !== null && this.GEOM !== undefined;
    }

    /**
     * Check if the DrawEssentials has control points
     */
    public hasControlPoints(): boolean {
        return this.CTRL_PTS.length > 0;
    }

    /**
     * Check if the DrawEssentials has base line points
     */
    public hasBaseLinePoints(): boolean {
        return this.BASE_LN_PTS.startPt !== undefined ||
            this.BASE_LN_PTS.midPt !== undefined ||
            this.BASE_LN_PTS.endPt !== undefined;
    }
}

export default DrawEssentials;
