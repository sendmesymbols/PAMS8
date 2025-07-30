import Polyline from "@arcgis/core/geometry/Polyline";
import Point from "@arcgis/core/geometry/Point";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
import GeoTools from './GeoTools.ts';
import Echelons from './Echelons.ts';


interface PointLike {
    x: number;
    y: number;
}
/**
 * Shapes utility class for creating various geometric shapes and paths
 * TypeScript version for ArcGIS API 4.x
 */
class Shapes {

     /**
     * Create a C shape
     */
    static createC(pt: Point, radius: number, steps: number): Point[] {
        const pts: Point[] = [];
        const step = 2 * Math.PI / steps;
        const xh = pt.x;
        const yk = pt.y;
        const r = radius;

        for (let theta = 1.1; theta < 1.1 + Math.PI; theta += step) {
            const x = xh + r * Math.cos(theta);
            const y = yk - r * Math.sin(theta);
            pts.push(new Point({ x, y, spatialReference: pt.spatialReference }));
        }

        return pts;
    }

    /**
     * Create ellipse
     */
    static createEllipse(options: {
        center: Point;
        longAxis: number;
        shortAxis: number;
        numberOfPoints: number;
        spatialReference: SpatialReference;
    }): Point[] {
        const { center, longAxis, shortAxis, numberOfPoints, spatialReference } = options;
        const x = center.x;
        const y = center.y;
        const paths: Point[] = [];
        const steps = 2 * Math.PI / numberOfPoints;

        for (let m = 0; m < numberOfPoints; m++) {
            const point = new Point({
                x: longAxis * Math.cos(m * steps) + x,
                y: shortAxis * Math.sin(m * steps) + y,
                spatialReference
            });
            paths.push(point);
        }

        paths.push(paths[0]); // Close the ellipse
        return paths;
    }

    /**
     * Create circle
     */
    static createCircle(pt: Point, radius: number, steps: number): Point[] {
        const pts: Point[] = [];
        const step = 2 * Math.PI / steps;
        const xh = pt.x;
        const yk = pt.y;
        const r = radius;

        for (let theta = 0; theta < 2 * Math.PI; theta += step) {
            const x = xh + r * Math.cos(theta);
            const y = yk - r * Math.sin(theta);
            pts.push(new Point({ x, y, spatialReference: pt.spatialReference }));
        }

        return pts;
    }

    /**
     * Create half circle
     */
    static createHalfCircle(pt: Point, radius: number, thetaStart: number, thetaEnd: number, steps: number): Point[] {
        const pts: Point[] = [];
        const step = 2 * Math.PI / steps;
        const xh = pt.x;
        const yk = pt.y;
        const r = radius;

        for (let theta = thetaStart; theta < 2 * Math.PI + thetaEnd; theta += step) {
            const x = xh + r * Math.cos(theta);
            const y = yk - r * Math.sin(theta);
            pts.push(new Point({ x, y, spatialReference: pt.spatialReference }));
        }

        return pts;
    }

    /**
     * Create FLOT half circle
     */
    static createFLOTHalfCircle(pt: Point, angle: number, radius: number): Point[] {
        const pts: Point[] = [];
        let steps = 30;
        steps = 2 * Math.PI / steps;
        const xh = pt.x;
        const yk = pt.y;
        const r = radius;

        for (let theta = 0; theta <= 3.1765; theta += steps) {
            const x = xh + r * Math.cos(theta);
            const y = yk - r * Math.sin(theta);
            pts.push(new Point({ x, y, spatialReference: pt.spatialReference }));
        }

        return this.ownRotate(pts, pt.x, pt.y, angle);
    }

    /**
     * Create B shape
     */
    static createB(pt: Point, radius: number, steps: number): Point[] {
        const paths: Point[] = [];
        const halfCircle1 = this.createHalfCircle(
            new Point({
                x: pt.x - radius / 5.6,
                y: pt.y - radius / 2,
                spatialReference: pt.spatialReference
            }),
            radius / 2, 4.7, 2.0, 40
        );
        const halfCircle2 = this.createHalfCircle(
            new Point({
                x: pt.x - radius / 5.6,
                y: pt.y + radius / 2,
                spatialReference: pt.spatialReference
            }),
            radius / 2, 4.4, 1.6, 40
        );

        return paths.concat(halfCircle1, halfCircle2);
    }

    /**
     * Create ALD text
     */
    static createALD(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const aPoints = this.createA(dx - (dr * 2.4), dy, dr, sp);
        const lPoints = this.createL(dx - (dr * 1.3), dy, dr, sp);
        const dPoints = this.createDD(dx + (dr * 0.5), dy, dr, sp);

        return [aPoints, lPoints, dPoints];
    }

    /**
     * Create letter A
     */
    static createA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];
        pts.push(new Point({ x: dx - (dr / 1.75), y: dy - dr, spatialReference: sp })); // 1
        pts.push(new Point({ x: dx, y: dy + dr, spatialReference: sp })); // 2
        pts.push(new Point({ x: dx + (dr / 1.75), y: dy - dr, spatialReference: sp })); // 3
        pts.push(new Point({
            x: ((dx) + (dx + (dr / 1.75))) / 2,
            y: ((dy + dr) + (dy - dr)) / 2,
            spatialReference: sp
        }));
        pts.push(new Point({
            x: ((dx - (dr / 1.75)) + (dx)) / 2,
            y: ((dy - dr) + (dy + dr)) / 2,
            spatialReference: sp
        }));

        return pts;
    }

    /**
     * Create letter L
     */
    static createL(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];
        pts.push(new Point({ x: dx, y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy + dr, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: dx + dr, y: dy - dr, spatialReference: sp }));

        return pts;
    }

    /**
     * Create letter D
     */
    static createD(pt: Point, radius: number, steps: number): Point[] {
        const paths: Point[] = [];
        const halfCirclePts = this.createHalfCircle(pt, radius, 4.4, 2.0, 40);
        paths.push(...halfCirclePts);
        paths.push(new Point({ x: pt.x - radius / 3, y: pt.y - radius, spatialReference: pt.spatialReference }));
        paths.push(new Point({ x: pt.x - radius / 3, y: pt.y + radius, spatialReference: pt.spatialReference }));

        return paths;
    }

    /**
     * Create letter DD (alternative D implementation)
     */
    static createDD(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];
        const step = 2 * Math.PI / 180;

        pts.push(new Point({ x: dx - (dr / 3), y: dy + dr, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy + dr, spatialReference: sp }));

        for (let dtheta = 270 * Math.PI / 180; dtheta < 360 * Math.PI / 180; dtheta += step) {
            const x = dx + dr * Math.cos(dtheta);
            const y = dy - dr * Math.sin(dtheta);
            pts.push(new Point({ x, y, spatialReference: sp }));
        }

        for (let dtheta = 0 * Math.PI / 180; dtheta < 91 * Math.PI / 180; dtheta += step) {
            const x = dx + dr * Math.cos(dtheta);
            const y = dy - dr * Math.sin(dtheta);
            pts.push(new Point({ x, y, spatialReference: sp }));
        }

        pts.push(new Point({ x: dx - (dr / 3), y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: dx - (dr / 3), y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: dx - (dr / 3), y: dy + dr, spatialReference: sp }));

        return pts;
    }

    /**
     * Create letter H
     */
    static createH(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];

        pts.push(new Point({ x: dx - (dr / 1.5), y: dy - dr, spatialReference: sp })); // Bottom Left
        pts.push(new Point({ x: dx - (dr / 1.5), y: dy + dr, spatialReference: sp })); // Top Left
        pts.push(new Point({ x: dx - (dr * 0.7), y: dy, spatialReference: sp })); // Left Center
        pts.push(new Point({ x: dx + (dr * 0.3), y: dy, spatialReference: sp })); // Right Center
        pts.push(new Point({ x: dx + (dr / 4), y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: dx + (dr / 4), y: dy + dr, spatialReference: sp }));

        return pts;
    }

    /**
     * Create letter T
     */
    static createT(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];

        pts.push(new Point({ x: dx, y: dy - dr, spatialReference: sp })); // 4
        pts.push(new Point({ x: dx, y: dy + dr, spatialReference: sp })); // 2
        pts.push(new Point({ x: dx, y: dy + dr, spatialReference: sp })); // 2
        pts.push(new Point({ x: dx - (dr * 0.7), y: dy + dr, spatialReference: sp })); // 1
        pts.push(new Point({ x: dx, y: dy + dr, spatialReference: sp })); // 1
        pts.push(new Point({ x: dx + (dr * 0.7), y: dy + dr, spatialReference: sp })); // 3

        return pts;
    }

    /**
     * Create letter J
     */
    static createJ(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];

        pts.push(new Point({ x: dx - (dr * 0.5), y: dy + dr, spatialReference: sp })); // Left Arm
        pts.push(new Point({ x: dx + (dr * 0.5), y: dy + dr, spatialReference: sp })); // Right Arm
        pts.push(new Point({ x: dx, y: dy + dr, spatialReference: sp })); // Top center

        const stPt = new Point({ x: dx - (dr * 0.5), y: dy - (dr / 2), spatialReference: sp });
        const halfCirclePts = this.createHalfCircle(stPt, dr / 2, 2 * Math.PI, Math.PI, 30);
        pts.push(...halfCirclePts);

        return pts;
    }

    /**
     * Create letter C (CC version)
     */
    static createCC(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];
        const step = 2 * Math.PI / 180;

        for (let dtheta = 65 * Math.PI / 180; dtheta < 295 * Math.PI / 180; dtheta += step) {
            const x = dx + dr * Math.cos(dtheta);
            const y = dy - dr * Math.sin(dtheta);
            pts.push(new Point({ x, y, spatialReference: sp }));
        }

        return pts;
    }

    /**
     * Create letter G
     */
    static createG(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts: Point[] = [];
        const pts2: Point[] = [];
        const step = 2 * Math.PI / 180;

        for (let dtheta = 65 * Math.PI / 180; dtheta < 295 * Math.PI / 180; dtheta += step) {
            const x = dx + dr * Math.cos(dtheta);
            const y = dy - dr * Math.sin(dtheta);
            pts.push(new Point({ x, y, spatialReference: sp }));
        }

        const firstPt = pts[0];
        const lastPt = pts[pts.length - 1];
        // Note: You'll need to implement getMidPoint in your GeoTools
        // const midPt = GeoTools.getMidPoint(firstPt, lastPt);
        const midPt = new Point({
            x: (firstPt.x + lastPt.x) / 2,
            y: (firstPt.y + lastPt.y) / 2,
            spatialReference: sp
        });

        const leg = new Point({ x: midPt.x - (dr * 0.5), y: midPt.y, spatialReference: sp });
        pts2.push(firstPt);
        pts2.push(midPt);
        pts2.push(leg);

        return [pts, pts2];
    }

    /**
     * Create letter K
     */
    static createK(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];

        pts.push(new Point({ x: dx, y: dy + dr, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy, spatialReference: sp }));
        pts.push(new Point({ x: dx + (dr * 0.8), y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy, spatialReference: sp }));
        pts.push(new Point({ x: dx + (dr * 0.8), y: dy + dr, spatialReference: sp }));

        return pts;
    }

    /**
     * Create letter S
     */
    static createS(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];
        const step = 2 * Math.PI / 180;
        const ddr = dr / 2;

        pts.push(new Point({ x: dx + (dr * 0.3), y: dy + dr, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy + dr, spatialReference: sp }));

        for (let dtheta = 90 * Math.PI / 180; dtheta < 270 * Math.PI / 180; dtheta += step) {
            const x = dx + ddr * Math.cos(dtheta);
            const y = (dy + ddr) + ddr * Math.sin(dtheta);
            pts.push(new Point({ x, y, spatialReference: sp }));
        }

        for (let dtheta = 90 * Math.PI / 180; dtheta > 0 * Math.PI / 180; dtheta -= step) {
            const x = dx + ddr * Math.cos(dtheta);
            const y = (dy - ddr) + ddr * Math.sin(dtheta);
            pts.push(new Point({ x, y, spatialReference: sp }));
        }

        for (let dtheta = 360 * Math.PI / 180; dtheta > 270 * Math.PI / 180; dtheta -= step) {
            const x = dx + ddr * Math.cos(dtheta);
            const y = (dy - ddr) + ddr * Math.sin(dtheta);
            pts.push(new Point({ x, y, spatialReference: sp }));
        }

        pts.push(new Point({ x: dx, y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: dx - (dr * 0.3), y: dy - dr, spatialReference: sp }));

        return pts;
    }

    /**
     * Create letter O
     */
    static createO(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];
        const step = 2 * Math.PI / 180;

        for (let dtheta = 0; dtheta < 360 * Math.PI / 180; dtheta += step) {
            const x = dx + 0.5 * dr * Math.cos(dtheta);
            const y = dy - dr * Math.sin(dtheta);
            pts.push(new Point({ x, y, spatialReference: sp }));
        }

        return pts;
    }

    /**
     * Create letter I
     */
    static createI(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];
        pts.push(new Point({ x: dx, y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy + dr, spatialReference: sp }));

        return pts;
    }

    /**
     * Create letter X
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
     * Create letter W
     */
    static createW(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];

        pts.push(new Point({ x: dx - (dr * 0.7), y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: dx - (dr * 0.7), y: dy + dr, spatialReference: sp }));
        pts.push(new Point({ x: dx - (dr * 0.7), y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy, spatialReference: sp }));
        pts.push(new Point({ x: dx + (dr * 0.7), y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: dx + (dr * 0.7), y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: dx + (dr * 0.7), y: dy + dr, spatialReference: sp }));

        return pts;
    }

    /**
     * Create letter V
     */
    static createV(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];

        pts.push(new Point({ x: dx - (dr * 0.7), y: dy + dr, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy - (dr * 0.9), spatialReference: sp }));
        pts.push(new Point({ x: dx + (dr * 0.7), y: dy + dr, spatialReference: sp }));

        return pts;
    }

    /**
     * Create letter P (PP version)
     */
    static createPP(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts = this.createDD(dx, dy + (dr / 2), dr / 2, sp);
        pts.push(new Point({ x: dx - ((dr / 2) / 3), y: dy, spatialReference: sp }));
        pts.push(new Point({ x: dx - ((dr / 2) / 3), y: dy - dr, spatialReference: sp }));

        return pts;
    }

    /**
     * Create letter E
     */
    static createE(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];

        pts.push(new Point({ x: dx, y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy + dr, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy + dr, spatialReference: sp }));
        pts.push(new Point({ x: dx + dr, y: dy + dr, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy + dr, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy, spatialReference: sp }));
        pts.push(new Point({ x: dx + (dr * 0.8), y: dy, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: dx + dr, y: dy - dr, spatialReference: sp }));

        return pts;
    }

    /**
     * Create letter F
     */
    static createF(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];

        pts.push(new Point({ x: dx, y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy + dr, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy + dr, spatialReference: sp }));
        pts.push(new Point({ x: dx + dr, y: dy + dr, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy + dr, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy, spatialReference: sp }));
        pts.push(new Point({ x: dx + (dr * 0.8), y: dy, spatialReference: sp }));

        return pts;
    }

    /**
     * Create letter N
     */
    static createN(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];

        pts.push(new Point({ x: dx - (dr * 0.5), y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: dx - (dr * 0.5), y: dy + dr, spatialReference: sp }));
        pts.push(new Point({ x: dx + (dr * 0.5), y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: dx + (dr * 0.5), y: dy + dr, spatialReference: sp }));

        return pts;
    }

    /**
     * Create letter U
     */
    static createU(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];
        pts.push(new Point({ x: dx + dr / 0.97, y: dy + dr, spatialReference: sp }));

        // Note: You'll need to implement toRad in your GeoTools or use Math functions
        const halfCirclePts = this.createHalfCircle(
            new Point({ x: dx, y: dy, spatialReference: sp }),
            dr,
            2 * Math.PI, // 360 degrees in radians
            Math.PI,     // 180 degrees in radians
            40
        );
        pts.push(...halfCirclePts);

        pts.push(new Point({ x: dx - dr, y: dy + dr / 0.97, spatialReference: sp }));
        pts.push(pts[pts.length - 1]);

        return pts;
    }

    /**
     * Create letter Y
     */
    static createY(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];

        pts.push(new Point({ x: dx, y: dy, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy, spatialReference: sp }));
        pts.push(new Point({ x: dx - (dr * 0.6), y: dy + dr, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy, spatialReference: sp }));
        pts.push(new Point({ x: dx + (dr * 0.6), y: dy + dr, spatialReference: sp }));

        return pts;
    }

    /**
     * Create letter Z
     */
    static createZ(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];

        pts.push(new Point({ x: dx, y: dy + dr, spatialReference: sp }));
        pts.push(new Point({ x: dx + dr, y: dy + dr, spatialReference: sp }));
        pts.push(new Point({ x: dx, y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: dx + dr, y: dy - dr, spatialReference: sp }));

        return pts;
    }

    /**
     * Create letter R
     */
    static createR(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts = this.createDD(dx, dy + (dr / 2), dr / 2, sp);

        pts.push(new Point({ x: dx - ((dr / 2) / 3), y: dy, spatialReference: sp }));
        pts.push(new Point({ x: dx - ((dr / 2) / 3), y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: dx - ((dr / 2) / 3), y: dy, spatialReference: sp }));
        pts.push(new Point({ x: dx + (dr / 2), y: dy - dr, spatialReference: sp }));

        return pts;
    }

    // Combination letter methods
    static createAA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createA(dx - (dr * 1.3), dy, dr, sp);
        const pts2 = this.createA(dx + (dr * 1.3), dy, dr, sp);
        return [pts1, pts2];
    }

    static createAO(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createA(dx - (dr * 1.3), dy, dr, sp);
        const pts2 = this.createO(dx + (dr * 1.3), dy, dr, sp);
        return [pts1, pts2];
    }

    static createUA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createU(dx - (dr * 1.3), dy, dr, sp);
        const pts2 = this.createA(dx + (dr * 0.85), dy, dr, sp);
        return [pts1, pts2];
    }

    static createNAI(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createN(dx - (dr * 1.3), dy, dr, sp);
        const pts2 = this.createA(dx, dy, dr, sp);
        const pts3 = this.createI(dx + (dr * 0.8), dy, dr, sp);
        return [pts1, pts2, pts3];
    }

    static createTAI(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createT(dx - (dr * 1.3), dy, dr, sp);
        const pts2 = this.createA(dx, dy, dr, sp);
        const pts3 = this.createI(dx + (dr * 0.8), dy, dr, sp);
        return [pts1, pts2, pts3];
    }

    static createZOR(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createZ(dx - (dr * 1.8), dy, dr, sp);
        const pts2 = this.createO(dx, dy, dr, sp);
        const pts3 = this.createR(dx + (dr * 1.2), dy, dr, sp);
        return [pts1, pts2, pts3];
    }

    static createFAA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createF(dx - (dr * 1.8), dy, dr, sp);
        const pts2 = this.createA(dx, dy, dr, sp);
        const pts3 = this.createA(dx + (dr * 1.2), dy, dr, sp);
        return [pts1, pts2, pts3];
    }

    static createFUP(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createF(dx - (dr * 2.5), dy, dr, sp);
        const pts2 = this.createU(dx, dy, dr, sp);
        const pts3 = this.createPP(dx + (dr * 1.7), dy, dr, sp);
        return [pts1, pts2, pts3];
    }

    static createDAA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createDD(dx - (dr * 1.8), dy, dr, sp);
        const pts2 = this.createA(dx, dy, dr, sp);
        const pts3 = this.createA(dx + (dr * 1.2), dy, dr, sp);
        return [pts1, pts2, pts3];
    }

    static createOBJ(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createO(dx - (dr * 1.5), dy, dr, sp);
        const pts2 = this.createB(new Point({ x: dx, y: dy, spatialReference: sp }), dr, 60);
        const pts3 = this.createJ(dx + (dr * 1.5), dy, dr, sp);
        return [pts1, pts2, pts3];
    }

    static createSAA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createS(dx - (dr * 1.6), dy, dr, sp);
        const pts2 = this.createA(dx, dy, dr, sp);
        const pts3 = this.createA(dx + (dr * 1.6), dy, dr, sp);
        return [pts1, pts2, pts3];
    }

    static createDA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createDD(dx - (dr * 2), dy, dr, sp);
        const pts2 = this.createA(dx, dy, dr, sp);
        return [pts1, pts2];
    }

    static createCAA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createCC(dx - (dr * 1.2), dy, dr, sp);
        const pts2 = this.createA(dx, dy, dr, sp);
        const pts3 = this.createA(dx + (dr * 1.2), dy, dr, sp);
        return [pts1, pts2, pts3];
    }

    static createBAA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createB(new Point({ x: dx - dr, y: dy, spatialReference: sp }), dr, 60);
        const pts2 = this.createA(dx, dy, dr, sp);
        const pts3 = this.createA(dx + (dr * 1.2), dy, dr, sp);
        return [pts1, pts2, pts3];
    }

    static createACP(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createA(dx - (dr * 1.8), dy, dr, sp);
        const pts2 = this.createCC(dx, dy, dr, sp);
        const pts3 = this.createPP(dx + (dr * 1.2), dy, dr, sp);
        return [pts1, pts2, pts3];
    }

    static createPL(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createDD(dx, dy + (dr / 2), dr / 2, sp);
        pts1.push(new Point({ x: dx - ((dr / 2) / 3), y: dy, spatialReference: sp }));
        pts1.push(new Point({ x: dx - ((dr / 2) / 3), y: dy - dr, spatialReference: sp }));

        const pts2 = this.createL(dx + (dr * 1.3), dy, dr, sp);
        return [pts1, pts2];
    }

    static createSL(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createS(dx, dy, dr, sp);
        const pts2 = this.createL(dx + (dr * 1.3), dy, dr, sp);
        return [pts1, pts2];
    }

    static createKG(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createK(dx - dr, dy, dr, sp);
        const temp = this.createG(dx + (dr * 1.5), dy, dr, sp);
        return [pts1, temp[0], temp[1]];
    }

    static createKZ(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createK(dx - (dr * 1.2), dy, dr, sp);
        const pts2 = this.createZ(dx, dy, dr, sp);
        return [pts1, pts2];
    }

    static createLZ(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createL(dx - (dr * 1.2), dy, dr, sp);
        const pts2 = this.createZ(dx, dy, dr, sp);
        return [pts1, pts2];
    }

    static createVG(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createV(dx - dr, dy, dr, sp);
        const temp = this.createG(dx + (dr * 1.2), dy, dr, sp);
        return [pts1, temp[0], temp[1]];
    }

    static createVA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createV(dx, dy, dr, sp);
        const pts2 = this.createA(dx + (dr * 1.2), dy, dr, sp);
        return [pts1, pts2];
    }

    static createBL(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createB(new Point({ x: dx, y: dy, spatialReference: sp }), dr, 60);
        const pts2 = this.createL(dx + (dr * 0.7), dy, dr, sp);
        return [pts1, pts2];
    }

    static createDLNP(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createDD(dx - (dr * 5), dy, dr, sp);
        const pts2 = this.createL(dx - (dr * 2.8), dy, dr, sp);
        const pts3 = this.createN(dx - (dr * 0.8), dy, dr, sp);
        const pts4 = this.createPP(dx + (dr * 0.8), dy, dr, sp);
        return [pts1, pts2, pts3, pts4];
    }

    static createLNP(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createL(dx - (dr * 2.4), dy, dr, sp);
        const pts2 = this.createN(dx - (dr * 0.5), dy, dr, sp);
        const pts3 = this.createPP(dx + (dr * 0.8), dy, dr, sp);
        return [pts1, pts2, pts3];
    }

    static createCLD(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createCC(dx - (dr * 2.4), dy, dr, sp);
        const pts2 = this.createL(dx - (dr * 1.3), dy, dr, sp);
        const pts3 = this.createDD(dx + (dr * 0.5), dy, dr, sp);
        return [pts1, pts2, pts3];
    }

    static createBHOL(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createB(new Point({ x: dx - (dr * 5), y: dy, spatialReference: sp }), dr, 60);
        const pts2 = this.createH(dx - (dr * 2.8), dy, dr, sp);
        const pts3 = this.createO(dx - (dr * 0.8), dy, dr, sp);
        const pts4 = this.createL(dx + (dr * 0.8), dy, dr, sp);
        return [pts1, pts2, pts3, pts4];
    }

    static createWP(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createW(dx - (dr * 0.5), dy, dr, sp);
        const pts2 = this.createPP(dx + (dr * 0.7), dy, dr, sp);
        return [pts1, pts2];
    }

    static createENY(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createE(dx - (dr * 1.667), dy, dr, sp);
        const pts2 = this.createN(dx + (dr * 0.083), dy, dr, sp);
        const pts3 = this.createY(dx + (dr * 1.38), dy, dr, sp);
        return [pts1, pts2, pts3];
    }

    static CATK(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const c = this.createCC(dx - (dr * 1.67), dy, dr, sp);
        const a = this.createA(dx - (dr * 0.5), dy, dr, sp);
        const t = this.createT(dx + (dr * 0.83), dy, dr, sp);
        const k = this.createK(dx + (dr * 1.83), dy, dr, sp);
        return [c, a, t, k];
    }

    // Utility methods for creating shapes and arrows
    static createDash(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];
        pts.push(new Point({
            x: ((dx) + (dx + (dr / 1.75))) / 2,
            y: ((dy + dr) + (dy - dr)) / 2,
            spatialReference: sp
        }));
        pts.push(new Point({
            x: ((dx - (dr / 1.75)) + (dx)) / 2,
            y: ((dy - dr) + (dy + dr)) / 2,
            spatialReference: sp
        }));
        return pts;
    }

    /**
     * Create arrow head
     */
    static arrowHead(candidatePoint: Point, length: number, angle: number): Point[] {
        const path: Point[] = [];

        angle += 15;
        const angle1 = this.toDegrees(angle);
        angle -= 30;
        const angle2 = this.toDegrees(angle);

        const rightWing = new Point({
            x: candidatePoint.x + length * Math.cos(this.toRad(angle1)),
            y: candidatePoint.y + length * Math.sin(this.toRad(angle1)),
            spatialReference: candidatePoint.spatialReference
        });

        const leftWing = new Point({
            x: candidatePoint.x + length * Math.cos(this.toRad(angle2)),
            y: candidatePoint.y + length * Math.sin(this.toRad(angle2)),
            spatialReference: candidatePoint.spatialReference
        });

        path.push(rightWing, candidatePoint, leftWing);
        return path;
    }

    /**
     * Create backward arrow head
     */
    static arrowHeadBackward(candidatePoint: Point, length: number, angle: number): Point[] {
        const path: Point[] = [];
        angle += 100;
        const angle1 = this.toDegrees(angle);
        angle -= 30;
        const angle2 = this.toDegrees(angle);

        const rightWing = new Point({
            x: candidatePoint.x + length * Math.cos(this.toRad(angle1)),
            y: candidatePoint.y + length * Math.sin(this.toRad(angle1)),
            spatialReference: candidatePoint.spatialReference
        });

        const leftWing = new Point({
            x: candidatePoint.x + length * Math.cos(this.toRad(angle2)),
            y: candidatePoint.y + length * Math.sin(this.toRad(angle2)),
            spatialReference: candidatePoint.spatialReference
        });

        path.push(rightWing, candidatePoint, leftWing);
        return path;
    }

    /**
     * Create extended arrow head path
     */
    static CreateArrowHeadPathEx(
        pt1: Point,
        candidatePt: Point,
        pt2: Point,
        totalLen: number,
        headPercentage: number,
        headAngle: number,
        straight?: boolean
    ): PointLike[] {
        const headSizeBaseRatio = 1.1;
        const headBaseLen = totalLen * headPercentage;
        const headSideLen = headBaseLen * headSizeBaseRatio;

        const angle1 = this.twoPtsAngle(candidatePt, pt1);
        const angle2 = this.twoPtsAngle(candidatePt, pt2);

        const midAngle = (Math.abs(angle1 - angle2)) / 2;
        const adjustedMidAngle = Math.abs(angle1 - angle2) > Math.PI * 1.88 ? midAngle + Math.PI : midAngle;

        const len = Math.sqrt(
            headBaseLen * headBaseLen + headSideLen * headSideLen -
            2 * headSideLen * headBaseLen * Math.cos(adjustedMidAngle + headAngle / 180 * Math.PI)
        );

        const upAngle = Math.asin(headBaseLen * Math.sin(adjustedMidAngle + headAngle / 180 * Math.PI) / len);
        const centAngle = upAngle + headAngle / 180 * Math.PI;

        const result = (straight === false || straight === undefined) ?
            (headBaseLen * Math.sin(Math.PI - centAngle - adjustedMidAngle) / Math.sin(centAngle)) : 0;

        const path: PointLike[] = [];

        path.push({
            x: candidatePt.x + result * Math.cos(angle1),
            y: candidatePt.y + result * Math.sin(angle1)
        });
        path.push({
            x: candidatePt.x + headSideLen * Math.cos(angle1 - headAngle / 180 * Math.PI),
            y: candidatePt.y + headSideLen * Math.sin(angle1 - headAngle / 180 * Math.PI)
        });
        path.push(candidatePt);
        path.push({
            x: candidatePt.x + headSideLen * Math.cos(angle2 + headAngle / 180 * Math.PI),
            y: candidatePt.y + headSideLen * Math.sin(angle2 + headAngle / 180 * Math.PI)
        });
        path.push({
            x: candidatePt.x + result * Math.cos(angle2),
            y: candidatePt.y + result * Math.sin(angle2)
        });

        return path;
    }

    static CreateBezierPathPCOnly(pointCollection: Point[], numberOfPts: number): Point[] {
        // Initial position set to the first point in the collection
        let position: Point = {
            x: pointCollection[0].x,
            y: pointCollection[0].y
        };

        // Remove duplicate last points if any
        if (pointCollection.length > 1) {
            while (
                pointCollection[pointCollection.length - 1].x === pointCollection[pointCollection.length - 2].x &&
                pointCollection[pointCollection.length - 1].y === pointCollection[pointCollection.length - 2].y
                ) {
                pointCollection.pop();
            }
        }

        // Tween the position based on the pointCollection
        const tween = window.TweenMax.to(position, numberOfPts, {
            bezier: pointCollection,
            ease: window.Linear.easeNone
        });

        // Store the computed path
        const path: Point[] = [];
        for (let i = 0; i <= numberOfPts; i++) {
            tween.time(i);
            path.push({ x: position.x, y: position.y });
        }

        return path;
    }

    /**
     * Rotation utility methods
     */
    static ownRotate(pointArray: Point[], centerX: number, centerY: number, rotateAngle: number): Point[] {
        for (let i = 0; i < pointArray.length; i++) {
            // Translate to origin
            const translatedX = pointArray[i].x - centerX;
            const translatedY = pointArray[i].y - centerY;

            // Rotate
            const rotatedX = translatedX * Math.cos(rotateAngle) - translatedY * Math.sin(rotateAngle);
            const rotatedY = translatedX * Math.sin(rotateAngle) + translatedY * Math.cos(rotateAngle);

            // Translate back
            pointArray[i] = new Point({
                x: rotatedX + centerX,
                y: rotatedY + centerY,
                spatialReference: pointArray[i].spatialReference
            });
        }
        return pointArray;
    }

    static rotate(pointArray: Point[], centerX: number, centerY: number, rotateAngle: number): Point[] {
        return this.ownRotate(pointArray, centerX, centerY, rotateAngle);
    }

    /**
     * Create echelon (Note: This requires the Echelons module)
     */


    static createEchelon(ech: string, pt: Point, radius: number, angle?: number): Point[] {

        var result :any = [];
        switch (ech) {
            case "12":
                result = Echelons.createSQUAD(pt.x, pt.y, radius, pt.spatialReference);
                break;
            case "120":
                result = Echelons.createHollowOval(pt.x, pt.y, radius, pt.spatialReference);
                break;
            case "13":
                result = Echelons.createSECTION(pt.x, pt.y, radius, pt.spatialReference);
                break;
            case "14":
                result = Echelons.createPLATOON(pt.x, pt.y, radius, pt.spatialReference);
                break;
            case "15":
                result = Echelons.createCoy(pt.x, pt.y, radius, pt.spatialReference);
                break;
            case "16":
                result = Echelons.createBn(pt.x, pt.y, radius, pt.spatialReference);
                break;
            case "17":
                result = Echelons.createREGIMENT(pt.x, pt.y, radius, pt.spatialReference);
                break;
            case "18":
                result = Echelons.createBRIGADE(pt.x, pt.y, radius, pt.spatialReference);
                break;
            case "21":
                result = Echelons.createDIV(pt.x, pt.y, radius, pt.spatialReference);
                break;
            case "22":
                result = Echelons.createCORPS(pt.x, pt.y, radius, pt.spatialReference);
                break;
            case "23":
                //result = Echelons.createArmy(pt.x, pt.y, radius, pt.spatialReference);
                break;
            case "26":
                result = Echelons.createComd(pt.x, pt.y, radius, pt.spatialReference);
                break;
        }

        if (angle !== undefined) {
            var paths = [];
            for (var r = 0; r < result.length; r++) {
                paths.push(this.rotate(result[r], pt.x, pt.y, angle));
            }
            return paths;
        } else {
            return result;
        }
    }

    // Utility helper methods (you may need to implement these or import from GeoTools)
    private static toDegrees(radians: number): number {
        return radians * (180 / Math.PI);
    }

    private static toRad(degrees: number): number {
        return degrees * (Math.PI / 180);
    }

    private static twoPtsAngle(fromPt: Point, toPt: Point): number {
        const dx = toPt.x - fromPt.x;
        const dy = toPt.y - fromPt.y;
        return Math.atan2(dy, dx);
    }
}

export default Shapes; 