import Polyline from "@arcgis/core/geometry/Polyline";
import Point from "@arcgis/core/geometry/Point";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";

/**
 * Echelons utility module for creating military echelon symbols
 */
export class Echelons {
    /**
     * Create SQUAD echelon symbol (filled circles with hatching)
     */
    static createSQUAD(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts: Point[] = [];
        const newPts: Point[] = [];
        const step = 2 * Math.PI / 180;

        // Create circle
        for (let dtheta = 0 * Math.PI / 180; dtheta < 360 * Math.PI / 180; dtheta += step) {
            const x = dx + dr * Math.cos(dtheta);
            const y = dy - dr * Math.sin(dtheta);
            pts.push(new Point({ x, y, spatialReference: sp }));
        }

        // Hatch pattern
        for (let i = 0, j = 180; i < pts.length; i++, j--) {
            newPts.push(new Point({ x: pts[i].x, y: pts[i].y, spatialReference: sp }));
            newPts.push(new Point({ x: pts[j].x, y: pts[j].y, spatialReference: sp }));
        }
        const allPts = pts.concat(newPts);

        return [allPts];
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
     * Create SECTION echelon symbol (two filled circles)
     */
    static createSECTION(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1: Point[] = [];
        const pts2: Point[] = [];
        const newPts1: Point[] = [];
        const newPts2: Point[] = [];

        const step = 2 * Math.PI / 180;
        const dx1 = dx - (dr / 4) - dr;
        const dx2 = dx + (dr / 4) + dr;

        // First circle
        for (let dtheta = 0 * Math.PI / 180; dtheta < 360 * Math.PI / 180; dtheta += step) {
            const x = dx1 + dr * Math.cos(dtheta);
            const y = dy - dr * Math.sin(dtheta);
            pts1.push(new Point({ x, y, spatialReference: sp }));
        }

        // Second circle
        for (let dtheta = 0 * Math.PI / 180; dtheta < 360 * Math.PI / 180; dtheta += step) {
            const x = dx2 + dr * Math.cos(dtheta);
            const y = dy - dr * Math.sin(dtheta);
            pts2.push(new Point({ x, y, spatialReference: sp }));
        }

        // Hatch patterns
        for (let i = 0, j = 180; i < pts1.length; i++, j--) {
            newPts1.push(new Point({ x: pts1[i].x, y: pts1[i].y, spatialReference: sp }));
            newPts1.push(new Point({ x: pts1[j].x, y: pts1[j].y, spatialReference: sp }));

            newPts2.push(new Point({ x: pts2[i].x, y: pts2[i].y, spatialReference: sp }));
            newPts2.push(new Point({ x: pts2[j].x, y: pts2[j].y, spatialReference: sp }));
        }

        const allPts1 = pts1.concat(newPts1);
        const allPts2 = pts2.concat(newPts2);

        return [allPts1, allPts2];
    }

    /**
     * Create PLATOON echelon symbol (three filled circles)
     */
    static createPLATOON(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1: Point[] = [];
        const pts2: Point[] = [];
        const pts3: Point[] = [];
        const newPts1: Point[] = [];
        const newPts2: Point[] = [];
        const newPts3: Point[] = [];

        const step = 2 * Math.PI / 180;
        const dx1 = dx - dr - (dr / 2) - dr;
        const dx2 = dx;
        const dx3 = dx + dr + (dr / 2) + dr;

        // First circle
        for (let dtheta = 0 * Math.PI / 180; dtheta < 360 * Math.PI / 180; dtheta += step) {
            const x = dx1 + dr * Math.cos(dtheta);
            const y = dy - dr * Math.sin(dtheta);
            pts1.push(new Point({ x, y, spatialReference: sp }));
        }

        // Second circle
        for (let dtheta = 0 * Math.PI / 180; dtheta < 360 * Math.PI / 180; dtheta += step) {
            const x = dx2 + dr * Math.cos(dtheta);
            const y = dy - dr * Math.sin(dtheta);
            pts2.push(new Point({ x, y, spatialReference: sp }));
        }

        // Third circle
        for (let dtheta = 0 * Math.PI / 180; dtheta < 360 * Math.PI / 180; dtheta += step) {
            const x = dx3 + dr * Math.cos(dtheta);
            const y = dy - dr * Math.sin(dtheta);
            pts3.push(new Point({ x, y, spatialReference: sp }));
        }

        // Hatch patterns
        for (let i = 0, j = 180; i < pts1.length; i++, j--) {
            newPts1.push(new Point({ x: pts1[i].x, y: pts1[i].y, spatialReference: sp }));
            newPts1.push(new Point({ x: pts1[j].x, y: pts1[j].y, spatialReference: sp }));

            newPts2.push(new Point({ x: pts2[i].x, y: pts2[i].y, spatialReference: sp }));
            newPts2.push(new Point({ x: pts2[j].x, y: pts2[j].y, spatialReference: sp }));

            newPts3.push(new Point({ x: pts3[i].x, y: pts3[i].y, spatialReference: sp }));
            newPts3.push(new Point({ x: pts3[j].x, y: pts3[j].y, spatialReference: sp }));
        }

        const allPts1 = pts1.concat(newPts1);
        const allPts2 = pts2.concat(newPts2);
        const allPts3 = pts3.concat(newPts3);

        return [allPts1, allPts2, allPts3];
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
     * Create Brigade echelon symbol (single X)
     */
    static createBRIGADE(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts = this.createX(dx, dy, dr, sp);
        return [pts];
    }

    /**
     * Create Division echelon symbol (two X's)
     */
    static createDIV(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const dx1 = dx - (dr * 0.75);
        const dx2 = dx + (dr * 0.75);

        const pts1 = this.createX(dx1, dy, dr, sp);
        const pts2 = this.createX(dx2, dy, dr, sp);
        return [pts1, pts2];
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
     * Create Corps echelon symbol (three X's)
     */
    static createCORPS(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const dx1 = dx - (dr * 1.5);
        const dx2 = dx;
        const dx3 = dx + (dr * 1.5);

        const pts1 = this.createX(dx1, dy, dr, sp);
        const pts2 = this.createX(dx2, dy, dr, sp);
        const pts3 = this.createX(dx3, dy, dr, sp);
        return [pts1, pts2, pts3];
    }

    /**
     * Create X shape
     */
    static createX(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];
        pts.push(new Point({ x: dx - (dr / 2), y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy, spatialReference: sp }));
        pts.push(new Point({ x: dx + (dr / 2), y: dy + dr, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy, spatialReference: sp }));
        pts.push(new Point({ x: dx + (dr / 2), y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy, spatialReference: sp }));
        pts.push(new Point({ x: dx - (dr / 2), y: dy + dr, spatialReference: sp }));
        return pts;
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
}

export default Echelons; 