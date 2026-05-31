import Polyline from "@arcgis/core/geometry/Polyline";
import Point from "@arcgis/core/geometry/Point";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";

/**
 * Echelons utility module for creating military echelon symbols
 */
export class Echelons {
    /**
     * Create SQUAD echelon symbol — single filled dot.
     * Rendered as an outer outline circle + an Archimedean spiral whose stroke
     * fills the disk. Polyline-only (carrier is a SimpleLineSymbol on a Polyline),
     * no self-intersecting strokes — renders cleanly in 2D and 3D.
     */
    static createSQUAD(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [
            Echelons.createOutlineCircle(dx, dy, dr, sp),
            Echelons.createSpiralDisk(dx, dy, dr, sp),
        ];
    }

    /**
     * Create hollow oval echelon symbol
     */
    static createHollowOval(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts: Point[] = [];
        const step = 2 * Math.PI / 180;

        for (let dtheta = 0 * Math.PI / 180; dtheta < 360 * Math.PI / 180; dtheta += step) {
            const x = dx + 0.5 * dr * Math.cos(dtheta);
            const y = dy - dr * Math.sin(dtheta);
            pts.push(new Point({ x, y, spatialReference: sp }));
        }

        return [pts];
    }

    /**
     * Create SECTION echelon symbol — two filled dots.
     * Each dot = outline circle + spiral fill. Offsets preserved from the
     * original implementation.
     */
    static createSECTION(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const dx1 = dx - (dr / 4) - dr;
        const dx2 = dx + (dr / 4) + dr;
        return [
            Echelons.createOutlineCircle(dx1, dy, dr, sp),
            Echelons.createSpiralDisk(dx1, dy, dr, sp),
            Echelons.createOutlineCircle(dx2, dy, dr, sp),
            Echelons.createSpiralDisk(dx2, dy, dr, sp),
        ];
    }

    /**
     * Create PLATOON echelon symbol — three filled dots.
     * Each dot = outline circle + spiral fill. Offsets preserved from the
     * original implementation.
     */
    static createPLATOON(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const dx1 = dx - dr - (dr / 2) - dr;
        const dx2 = dx;
        const dx3 = dx + dr + (dr / 2) + dr;
        return [
            Echelons.createOutlineCircle(dx1, dy, dr, sp),
            Echelons.createSpiralDisk(dx1, dy, dr, sp),
            Echelons.createOutlineCircle(dx2, dy, dr, sp),
            Echelons.createSpiralDisk(dx2, dy, dr, sp),
            Echelons.createOutlineCircle(dx3, dy, dr, sp),
            Echelons.createSpiralDisk(dx3, dy, dr, sp),
        ];
    }

    /**
     * Create Company echelon symbol (single vertical line)
     */
    static createCoy(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts: Point[] = [];
        pts.push(new Point({ x: dx, y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy + dr, spatialReference: sp }));
        return [pts];
    }

    /**
     * Create Battalion echelon symbol (two vertical lines)
     */
    static createBn(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1: Point[] = [];
        const pts2: Point[] = [];

        pts1.push(new Point({ x: dx - (dr / 4), y: dy - dr, spatialReference: sp }));
        pts1.push(new Point({ x: dx - (dr / 4), y: dy + dr, spatialReference: sp }));

        pts2.push(new Point({ x: dx + (dr / 4), y: dy - dr, spatialReference: sp }));
        pts2.push(new Point({ x: dx + (dr / 4), y: dy + dr, spatialReference: sp }));

        return [pts1, pts2];
    }

    /**
     * Create Regiment echelon symbol (three vertical lines)
     */
    static createREGIMENT(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1: Point[] = [];
        const pts2: Point[] = [];
        const pts3: Point[] = [];

        pts1.push(new Point({ x: dx - (dr / 2), y: dy - dr, spatialReference: sp }));
        pts1.push(new Point({ x: dx - (dr / 2), y: dy + dr, spatialReference: sp }));

        pts2.push(new Point({ x: dx, y: dy - dr, spatialReference: sp }));
        pts2.push(new Point({ x: dx, y: dy + dr, spatialReference: sp }));

        pts3.push(new Point({ x: dx + (dr / 2), y: dy - dr, spatialReference: sp }));
        pts3.push(new Point({ x: dx + (dr / 2), y: dy + dr, spatialReference: sp }));

        return [pts1, pts2, pts3];
    }

    /**
     * Create Brigade echelon symbol — single X (2 diagonal paths).
     */
    static createBRIGADE(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return Echelons.createX(dx, dy, dr, sp);
    }

    /**
     * Create Division echelon symbol — two X's (4 diagonal paths total).
     */
    static createDIV(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const dx1 = dx - (dr * 0.75);
        const dx2 = dx + (dr * 0.75);
        return [
            ...Echelons.createX(dx1, dy, dr, sp),
            ...Echelons.createX(dx2, dy, dr, sp),
        ];
    }

    /**
     * Create Command echelon symbol (two plus signs)
     */
    static createComd(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const dx1 = dx - (dr * 0.75);
        const dx2 = dx + (dr * 0.75);

        const pts1 = this.createPlus(dx1, dy, dr, sp);
        const pts2 = this.createPlus(dx2, dy, dr, sp);
        return [pts1, pts2];
    }

    /**
     * Create Corps echelon symbol — three X's (6 diagonal paths total).
     */
    static createCORPS(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const dx1 = dx - (dr * 1.5);
        const dx2 = dx;
        const dx3 = dx + (dr * 1.5);
        return [
            ...Echelons.createX(dx1, dy, dr, sp),
            ...Echelons.createX(dx2, dy, dr, sp),
            ...Echelons.createX(dx3, dy, dr, sp),
        ];
    }

    /**
     * Create X shape — two separate diagonals as independent paths.
     * The previous single-polyline implementation backtracked through the
     * centre three times, which the 3D polyline tessellator collapses to a
     * single visible stroke (chevron). Splitting into two clean 2-point
     * segments eliminates the degenerate centre vertex.
     */
    static createX(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [
            [
                new Point({ x: dx - (dr / 2), y: dy - dr, spatialReference: sp }),
                new Point({ x: dx + (dr / 2), y: dy + dr, spatialReference: sp }),
            ],
            [
                new Point({ x: dx + (dr / 2), y: dy - dr, spatialReference: sp }),
                new Point({ x: dx - (dr / 2), y: dy + dr, spatialReference: sp }),
            ],
        ];
    }

    /**
     * Create plus shape
     */
    static createPlus(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];

        pts.push(new Point({ x: dx, y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy + dr, spatialReference: sp }));

        pts.push(new Point({ x: dx, y: dy, spatialReference: sp }));
        pts.push(new Point({ x: dx + (dr * 0.7), y: dy, spatialReference: sp }));

        pts.push(new Point({ x: dx, y: dy, spatialReference: sp }));
        pts.push(new Point({ x: dx - (dr * 0.7), y: dy, spatialReference: sp }));

        return pts;
    }

    /**
     * Build an Archimedean spiral from center outward. One continuous monotone
     * polyline path; carrier stroke overlaps the radial pitch (`r/turns`) and
     * reads as a uniform disk. No self-intersections — clean in 3D.
     */
    private static createSpiralDisk(
        cx: number,
        cy: number,
        r: number,
        sp: SpatialReference,
        turns: number = 8,
        ptsPerTurn: number = 16,
    ): Point[] {
        const pts: Point[] = [];
        const totalAngle = 2 * Math.PI * turns;
        const totalPts = turns * ptsPerTurn;
        for (let i = 0; i <= totalPts; i++) {
            const t = i / totalPts;
            const theta = totalAngle * t;
            const radius = r * t;
            pts.push(new Point({
                x: cx + radius * Math.cos(theta),
                y: cy - radius * Math.sin(theta),
                spatialReference: sp,
            }));
        }
        return pts;
    }

    /**
     * Build a closed-circle outline. Guarantees a crisp silhouette for the
     * filled-dot echelons regardless of stroke-width vs. spiral-pitch tuning.
     */
    private static createOutlineCircle(
        cx: number,
        cy: number,
        r: number,
        sp: SpatialReference,
        steps: number = 36,
    ): Point[] {
        const pts: Point[] = [];
        for (let i = 0; i <= steps; i++) {
            const theta = (2 * Math.PI * i) / steps;
            pts.push(new Point({
                x: cx + r * Math.cos(theta),
                y: cy - r * Math.sin(theta),
                spatialReference: sp,
            }));
        }
        return pts;
    }
}

export default Echelons; 