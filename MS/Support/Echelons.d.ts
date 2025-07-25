import Point from "@arcgis/core/geometry/Point";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
/**
 * Echelons utility module for creating military echelon symbols
 */
export declare class Echelons {
    /**
     * Create SQUAD echelon symbol (filled circles with hatching)
     */
    static createSQUAD(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Create hollow oval echelon symbol
     */
    static createHollowOval(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Create SECTION echelon symbol (two filled circles)
     */
    static createSECTION(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Create PLATOON echelon symbol (three filled circles)
     */
    static createPLATOON(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Create Company echelon symbol (single vertical line)
     */
    static createCoy(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Create Battalion echelon symbol (two vertical lines)
     */
    static createBn(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Create Regiment echelon symbol (three vertical lines)
     */
    static createREGIMENT(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Create Brigade echelon symbol (single X)
     */
    static createBRIGADE(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Create Division echelon symbol (two X's)
     */
    static createDIV(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Create Command echelon symbol (two plus signs)
     */
    static createComd(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Create Corps echelon symbol (three X's)
     */
    static createCORPS(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Create X shape
     */
    static createX(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    /**
     * Create plus shape
     */
    static createPlus(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
}
export default Echelons;
