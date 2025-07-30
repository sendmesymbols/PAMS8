/**
 * @module Shapes
 * Common shapes for ArcGIS API for JavaScript 4.x
 * @author Abdul Razak
 * Converted to TypeScript for ArcGIS 4.x
 */

import Polyline from "@arcgis/core/geometry/Polyline";
import Point from "@arcgis/core/geometry/Point";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
import GeoTools from './GeoTools';
import Echelons from './Echelons';


// Interface for basic point structure
interface PointLike {
    x: number;
    y: number;
    spatialReference?: SpatialReference;
}

class Shapes3D {

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
            pts.push(new Point({x, y, spatialReference: pt.spatialReference}));
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
        const {center, longAxis, shortAxis, numberOfPoints, spatialReference} = options;
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
            pts.push(new Point({x, y, spatialReference: pt.spatialReference}));
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
            pts.push(new Point({x, y, spatialReference: pt.spatialReference}));
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
            pts.push(new Point({x, y, spatialReference: pt.spatialReference}));
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
        pts.push(new Point({x: dx - (dr / 1.75), y: dy - dr, spatialReference: sp})); // 1
        pts.push(new Point({x: dx, y: dy + dr, spatialReference: sp})); // 2
        pts.push(new Point({x: dx + (dr / 1.75), y: dy - dr, spatialReference: sp})); // 3
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
        pts.push(new Point({x: dx, y: dy - dr, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy + dr, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy - dr, spatialReference: sp}));
        pts.push(new Point({x: dx + dr, y: dy - dr, spatialReference: sp}));

        return pts;
    }

    /**
     * Create letter D
     */
    static createD(pt: Point, radius: number, steps: number): Point[] {
        const paths: Point[] = [];
        const halfCirclePts = this.createHalfCircle(pt, radius, 4.4, 2.0, 40);
        paths.push(...halfCirclePts);
        paths.push(new Point({x: pt.x - radius / 3, y: pt.y - radius, spatialReference: pt.spatialReference}));
        paths.push(new Point({x: pt.x - radius / 3, y: pt.y + radius, spatialReference: pt.spatialReference}));

        return paths;
    }

    /**
     * Create letter DD (alternative D implementation)
     */
    static createDD(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];
        const step = 2 * Math.PI / 180;

        pts.push(new Point({x: dx - (dr / 3), y: dy + dr, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy + dr, spatialReference: sp}));

        for (let dtheta = 270 * Math.PI / 180; dtheta < 360 * Math.PI / 180; dtheta += step) {
            const x = dx + dr * Math.cos(dtheta);
            const y = dy - dr * Math.sin(dtheta);
            pts.push(new Point({x, y, spatialReference: sp}));
        }

        for (let dtheta = 0 * Math.PI / 180; dtheta < 91 * Math.PI / 180; dtheta += step) {
            const x = dx + dr * Math.cos(dtheta);
            const y = dy - dr * Math.sin(dtheta);
            pts.push(new Point({x, y, spatialReference: sp}));
        }

        pts.push(new Point({x: dx - (dr / 3), y: dy - dr, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy - dr, spatialReference: sp}));
        pts.push(new Point({x: dx - (dr / 3), y: dy - dr, spatialReference: sp}));
        pts.push(new Point({x: dx - (dr / 3), y: dy + dr, spatialReference: sp}));

        return pts;
    }

    /**
     * Create letter H
     */
    static createH(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];

        pts.push(new Point({x: dx - (dr / 1.5), y: dy - dr, spatialReference: sp})); // Bottom Left
        pts.push(new Point({x: dx - (dr / 1.5), y: dy + dr, spatialReference: sp})); // Top Left
        pts.push(new Point({x: dx - (dr * 0.7), y: dy, spatialReference: sp})); // Left Center
        pts.push(new Point({x: dx + (dr * 0.3), y: dy, spatialReference: sp})); // Right Center
        pts.push(new Point({x: dx + (dr / 4), y: dy - dr, spatialReference: sp}));
        pts.push(new Point({x: dx + (dr / 4), y: dy + dr, spatialReference: sp}));

        return pts;
    }

    /**
     * Create letter T
     */
    static createT(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];

        pts.push(new Point({x: dx, y: dy - dr, spatialReference: sp})); // 4
        pts.push(new Point({x: dx, y: dy + dr, spatialReference: sp})); // 2
        pts.push(new Point({x: dx, y: dy + dr, spatialReference: sp})); // 2
        pts.push(new Point({x: dx - (dr * 0.7), y: dy + dr, spatialReference: sp})); // 1
        pts.push(new Point({x: dx, y: dy + dr, spatialReference: sp})); // 1
        pts.push(new Point({x: dx + (dr * 0.7), y: dy + dr, spatialReference: sp})); // 3

        return pts;
    }

    /**
     * Create letter J
     */
    static createJ(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];

        pts.push(new Point({x: dx - (dr * 0.5), y: dy + dr, spatialReference: sp})); // Left Arm
        pts.push(new Point({x: dx + (dr * 0.5), y: dy + dr, spatialReference: sp})); // Right Arm
        pts.push(new Point({x: dx, y: dy + dr, spatialReference: sp})); // Top center

        const stPt = new Point({x: dx - (dr * 0.5), y: dy - (dr / 2), spatialReference: sp});
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
            pts.push(new Point({x, y, spatialReference: sp}));
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
            pts.push(new Point({x, y, spatialReference: sp}));
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

        const leg = new Point({x: midPt.x - (dr * 0.5), y: midPt.y, spatialReference: sp});
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

        pts.push(new Point({x: dx, y: dy + dr, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy - dr, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy, spatialReference: sp}));
        pts.push(new Point({x: dx + (dr * 0.8), y: dy - dr, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy, spatialReference: sp}));
        pts.push(new Point({x: dx + (dr * 0.8), y: dy + dr, spatialReference: sp}));

        return pts;
    }

    /**
     * Create letter S
     */
    static createS(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];
        const step = 2 * Math.PI / 180;
        const ddr = dr / 2;

        pts.push(new Point({x: dx + (dr * 0.3), y: dy + dr, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy + dr, spatialReference: sp}));

        for (let dtheta = 90 * Math.PI / 180; dtheta < 270 * Math.PI / 180; dtheta += step) {
            const x = dx + ddr * Math.cos(dtheta);
            const y = (dy + ddr) + ddr * Math.sin(dtheta);
            pts.push(new Point({x, y, spatialReference: sp}));
        }

        for (let dtheta = 90 * Math.PI / 180; dtheta > 0 * Math.PI / 180; dtheta -= step) {
            const x = dx + ddr * Math.cos(dtheta);
            const y = (dy - ddr) + ddr * Math.sin(dtheta);
            pts.push(new Point({x, y, spatialReference: sp}));
        }

        for (let dtheta = 360 * Math.PI / 180; dtheta > 270 * Math.PI / 180; dtheta -= step) {
            const x = dx + ddr * Math.cos(dtheta);
            const y = (dy - ddr) + ddr * Math.sin(dtheta);
            pts.push(new Point({x, y, spatialReference: sp}));
        }

        pts.push(new Point({x: dx, y: dy - dr, spatialReference: sp}));
        pts.push(new Point({x: dx - (dr * 0.3), y: dy - dr, spatialReference: sp}));

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
            pts.push(new Point({x, y, spatialReference: sp}));
        }

        return pts;
    }

    /**
     * Create letter I
     */
    static createI(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];
        pts.push(new Point({x: dx, y: dy - dr, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy + dr, spatialReference: sp}));

        return pts;
    }

    /**
     * Create letter X
     */
    static createX(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];
        pts.push(new Point({x: dx - (dr / 2), y: dy - dr, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy, spatialReference: sp}));
        pts.push(new Point({x: dx + (dr / 2), y: dy + dr, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy, spatialReference: sp}));
        pts.push(new Point({x: dx + (dr / 2), y: dy - dr, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy, spatialReference: sp}));
        pts.push(new Point({x: dx - (dr / 2), y: dy + dr, spatialReference: sp}));

        return pts;
    }

    /**
     * Create letter W
     */
    static createW(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];

        pts.push(new Point({x: dx - (dr * 0.7), y: dy - dr, spatialReference: sp}));
        pts.push(new Point({x: dx - (dr * 0.7), y: dy + dr, spatialReference: sp}));
        pts.push(new Point({x: dx - (dr * 0.7), y: dy - dr, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy, spatialReference: sp}));
        pts.push(new Point({x: dx + (dr * 0.7), y: dy - dr, spatialReference: sp}));
        pts.push(new Point({x: dx + (dr * 0.7), y: dy - dr, spatialReference: sp}));
        pts.push(new Point({x: dx + (dr * 0.7), y: dy + dr, spatialReference: sp}));

        return pts;
    }

    /**
     * Create letter V
     */
    static createV(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];

        pts.push(new Point({x: dx - (dr * 0.7), y: dy + dr, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy - (dr * 0.9), spatialReference: sp}));
        pts.push(new Point({x: dx + (dr * 0.7), y: dy + dr, spatialReference: sp}));

        return pts;
    }

    /**
     * Create letter P (PP version)
     */
    static createPP(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts = this.createDD(dx, dy + (dr / 2), dr / 2, sp);
        pts.push(new Point({x: dx - ((dr / 2) / 3), y: dy, spatialReference: sp}));
        pts.push(new Point({x: dx - ((dr / 2) / 3), y: dy - dr, spatialReference: sp}));

        return pts;
    }

    /**
     * Create letter E
     */
    static createE(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];

        pts.push(new Point({x: dx, y: dy - dr, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy + dr, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy + dr, spatialReference: sp}));
        pts.push(new Point({x: dx + dr, y: dy + dr, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy + dr, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy, spatialReference: sp}));
        pts.push(new Point({x: dx + (dr * 0.8), y: dy, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy - dr, spatialReference: sp}));
        pts.push(new Point({x: dx + dr, y: dy - dr, spatialReference: sp}));

        return pts;
    }

    /**
     * Create letter F
     */
    static createF(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];

        pts.push(new Point({x: dx, y: dy - dr, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy + dr, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy + dr, spatialReference: sp}));
        pts.push(new Point({x: dx + dr, y: dy + dr, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy + dr, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy, spatialReference: sp}));
        pts.push(new Point({x: dx + (dr * 0.8), y: dy, spatialReference: sp}));

        return pts;
    }

    /**
     * Create letter N
     */
    static createN(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];

        pts.push(new Point({x: dx - (dr * 0.5), y: dy - dr, spatialReference: sp}));
        pts.push(new Point({x: dx - (dr * 0.5), y: dy + dr, spatialReference: sp}));
        pts.push(new Point({x: dx + (dr * 0.5), y: dy - dr, spatialReference: sp}));
        pts.push(new Point({x: dx + (dr * 0.5), y: dy + dr, spatialReference: sp}));

        return pts;
    }

    /**
     * Create letter U
     */
    static createU(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];
        pts.push(new Point({x: dx + dr / 0.97, y: dy + dr, spatialReference: sp}));

        // Note: You'll need to implement toRad in your GeoTools or use Math functions
        const halfCirclePts = this.createHalfCircle(
            new Point({x: dx, y: dy, spatialReference: sp}),
            dr,
            2 * Math.PI, // 360 degrees in radians
            Math.PI,     // 180 degrees in radians
            40
        );
        pts.push(...halfCirclePts);

        pts.push(new Point({x: dx - dr, y: dy + dr / 0.97, spatialReference: sp}));
        pts.push(pts[pts.length - 1]);

        return pts;
    }

    /**
     * Create letter Y
     */
    static createY(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];

        pts.push(new Point({x: dx, y: dy, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy - dr, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy, spatialReference: sp}));
        pts.push(new Point({x: dx - (dr * 0.6), y: dy + dr, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy, spatialReference: sp}));
        pts.push(new Point({x: dx + (dr * 0.6), y: dy + dr, spatialReference: sp}));

        return pts;
    }

    /**
     * Create letter Z
     */
    static createZ(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];

        pts.push(new Point({x: dx, y: dy + dr, spatialReference: sp}));
        pts.push(new Point({x: dx + dr, y: dy + dr, spatialReference: sp}));
        pts.push(new Point({x: dx, y: dy - dr, spatialReference: sp}));
        pts.push(new Point({x: dx + dr, y: dy - dr, spatialReference: sp}));

        return pts;
    }

    /**
     * Create letter R
     */
    static createR(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts = this.createDD(dx, dy + (dr / 2), dr / 2, sp);

        pts.push(new Point({x: dx - ((dr / 2) / 3), y: dy, spatialReference: sp}));
        pts.push(new Point({x: dx - ((dr / 2) / 3), y: dy - dr, spatialReference: sp}));
        pts.push(new Point({x: dx - ((dr / 2) / 3), y: dy, spatialReference: sp}));
        pts.push(new Point({x: dx + (dr / 2), y: dy - dr, spatialReference: sp}));

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
}

export default Shapes3D;