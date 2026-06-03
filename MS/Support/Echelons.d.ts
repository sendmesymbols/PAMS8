import Point from "@arcgis/core/geometry/Point";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
/**
 * Echelons utility module for creating military echelon symbols
 */
export declare class Echelons {
    /**
     * Create SQUAD echelon symbol — single filled dot.
     * Rendered as an outer outline circle + an Archimedean spiral whose stroke
     * fills the disk. Polyline-only (carrier is a SimpleLineSymbol on a Polyline),
     * no self-intersecting strokes — renders cleanly in 2D and 3D.
     */
    static createSQUAD(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Create hollow oval echelon symbol
     */
    static createHollowOval(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Create SECTION echelon symbol — two filled dots.
     * Each dot = outline circle + spiral fill. Offsets preserved from the
     * original implementation.
     */
    static createSECTION(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Create PLATOON echelon symbol — three filled dots.
     * Each dot = outline circle + spiral fill. Offsets preserved from the
     * original implementation.
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
     * Create Brigade echelon symbol — single X (2 diagonal paths).
     */
    static createBRIGADE(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Create Division echelon symbol — two X's (4 diagonal paths total).
     */
    static createDIV(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Create Command echelon symbol (two plus signs)
     */
    static createComd(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Create Corps echelon symbol — three X's (6 diagonal paths total).
     */
    static createCORPS(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Create X shape — two separate diagonals as independent paths.
     * The previous single-polyline implementation backtracked through the
     * centre three times, which the 3D polyline tessellator collapses to a
     * single visible stroke (chevron). Splitting into two clean 2-point
     * segments eliminates the degenerate centre vertex.
     */
    static createX(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Create plus shape
     */
    static createPlus(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    /**
     * Build an Archimedean spiral from center outward. One continuous monotone
     * polyline path; carrier stroke overlaps the radial pitch (`r/turns`) and
     * reads as a uniform disk. No self-intersections — clean in 3D.
     */
    private static createSpiralDisk;
    /**
     * Build a closed-circle outline. Guarantees a crisp silhouette for the
     * filled-dot echelons regardless of stroke-width vs. spiral-pitch tuning.
     */
    private static createOutlineCircle;
}
export default Echelons;
