import Polyline from "@arcgis/core/geometry/Polyline";
import Point from "@arcgis/core/geometry/Point";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
import GeoTools from './GeoTools.ts';
import Echelons from './Echelons.ts';
import Utils from "./Utils";
import DrawEssentials from "./DrawEssentials";
import Polygon from "@arcgis/core/geometry/Polygon";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";


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
     * Create circle segment polygon from three points using a precomputed circle (screen-space) and convert back to map-space
     */
    static createCircleSegmentFromThreePoints(
        view: MapView | SceneView,
        circle: { radius: number; center: { x: number; y: number } },
        pt1: any,
        pt2: any,
        pt3: any,
        numberOfPts: number
    ): { geometry: Polygon; lastPoint: Point; backPoint: Point } {
        const center = circle.center;
        const radius = circle.radius;
        const path: Point[] = [];

        // Normalize points relative to center
        pt1.x -= center.x; pt1.y -= center.y;
        pt2.x -= center.x; pt2.y -= center.y;
        pt3.x -= center.x; pt3.y -= center.y;

        // Calculate angles
        let anglePt1 = Math.atan2(pt1.y, pt1.x);
        let anglePt2 = Math.atan2(pt2.y, pt2.x);
        let anglePt3 = Math.atan2(pt3.y, pt3.x);

        // Normalize [0, 2PI]
        anglePt1 = anglePt1 < 0 ? 2 * Math.PI + anglePt1 : anglePt1;
        anglePt2 = anglePt2 < 0 ? 2 * Math.PI + anglePt2 : anglePt2;
        anglePt3 = anglePt3 < 0 ? 2 * Math.PI + anglePt3 : anglePt3;

        const startAngle = Math.min(anglePt1, anglePt2);
        const endAngle = Math.max(anglePt1, anglePt2);
        let swipeAngle = endAngle - startAngle;
        if (anglePt3 < startAngle || anglePt3 > endAngle) {
            swipeAngle -= (2 * Math.PI);
        }

        const angle = swipeAngle / numberOfPts;
        for (let i = 0; i <= numberOfPts; i++) {
            const screenPt = {
                x: radius * Math.cos(startAngle + i * angle) + center.x,
                y: radius * Math.sin(startAngle + i * angle) + center.y
            };
            const mapPt = (view as any).toMap(screenPt);
            if (mapPt) {
                path.push(new Point({ x: mapPt.x, y: mapPt.y, spatialReference: view.spatialReference }));
            }
        }

        const result = new Polygon({ spatialReference: view.spatialReference });
        const pathCoords = path.map(p => [p.x, p.y]);
        result.addRing(pathCoords);

        return {
            geometry: result,
            lastPoint: path[numberOfPts] || path[path.length - 1],
            backPoint: path[Math.max(0, numberOfPts - 5)] || path[0]
        };
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
     * Create letter A as separate strokes to avoid auto-closing
     */
    static createAStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [
            // Left diagonal line
            [
                new Point({ x: dx - (dr / 1.75), y: dy - dr, spatialReference: sp }),
                new Point({ x: dx, y: dy + dr, spatialReference: sp })
            ],
            // Right diagonal line
            [
                new Point({ x: dx, y: dy + dr, spatialReference: sp }),
                new Point({ x: dx + (dr / 1.75), y: dy - dr, spatialReference: sp })
            ],
            // Horizontal crossbar
            [
                new Point({ x: ((dx - (dr / 1.75)) + (dx)) / 2, y: ((dy - dr) + (dy + dr)) / 2, spatialReference: sp }),
                new Point({ x: ((dx) + (dx + (dr / 1.75))) / 2, y: ((dy + dr) + (dy - dr)) / 2, spatialReference: sp })
            ]
        ];
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
     * Create letter S as separate strokes to avoid auto-closing
     */
    static createSStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const step = 2 * Math.PI / 36; // Smaller steps for smoother curves
        const ddr = dr / 2;
        const strokes: Point[][] = [];

        // Create S as small line segments to avoid auto-closing issues
        // Top horizontal line
        strokes.push([
            new Point({ x: dx + (dr * 0.3), y: dy + dr, spatialReference: sp }),
            new Point({ x: dx, y: dy + dr, spatialReference: sp })
        ]);

        // Top curve - break into small segments
        let prevPoint: Point | null = null;
        for (let dtheta = 90 * Math.PI / 180; dtheta < 270 * Math.PI / 180; dtheta += step) {
            const x = dx + ddr * Math.cos(dtheta);
            const y = (dy + ddr) + ddr * Math.sin(dtheta);
            const currentPoint = new Point({ x, y, spatialReference: sp });

            if (prevPoint) {
                strokes.push([prevPoint, currentPoint]);
            }
            prevPoint = currentPoint;
        }

        // Middle transition - break into small segments
        prevPoint = null;
        for (let dtheta = 90 * Math.PI / 180; dtheta > 0 * Math.PI / 180; dtheta -= step) {
            const x = dx + ddr * Math.cos(dtheta);
            const y = (dy - ddr) + ddr * Math.sin(dtheta);
            const currentPoint = new Point({ x, y, spatialReference: sp });

            if (prevPoint) {
                strokes.push([prevPoint, currentPoint]);
            }
            prevPoint = currentPoint;
        }

        // Bottom curve - break into small segments
        prevPoint = null;
        for (let dtheta = 360 * Math.PI / 180; dtheta > 270 * Math.PI / 180; dtheta -= step) {
            const x = dx + ddr * Math.cos(dtheta);
            const y = (dy - ddr) + ddr * Math.sin(dtheta);
            const currentPoint = new Point({ x, y, spatialReference: sp });

            if (prevPoint) {
                strokes.push([prevPoint, currentPoint]);
            }
            prevPoint = currentPoint;
        }

        // Bottom horizontal line
        strokes.push([
            new Point({ x: dx, y: dy - dr, spatialReference: sp }),
            new Point({ x: dx - (dr * 0.3), y: dy - dr, spatialReference: sp })
        ]);
        
        return strokes;
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
     * Create letter F as separate strokes to avoid auto-closing
     */
    static createFStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [
            // Vertical line
            [
                new Point({ x: dx, y: dy - dr, spatialReference: sp }),
                new Point({ x: dx, y: dy + dr, spatialReference: sp })
            ],
            // Top horizontal line
            [
                new Point({ x: dx, y: dy + dr, spatialReference: sp }),
                new Point({ x: dx + dr, y: dy + dr, spatialReference: sp })
            ],
            // Middle horizontal line
            [
                new Point({ x: dx, y: dy, spatialReference: sp }),
                new Point({ x: dx + (dr * 0.8), y: dy, spatialReference: sp })
            ]
        ];
    }

    /**
     * Create letter N
     */
    static createN(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        const pts: Point[] = [];

        const leftX = dx - (dr * 0.5);
        const rightX = dx + (dr * 0.5);
        // Match 3.x source ordering: left top→bottom, right top→bottom
        pts.push(new Point({ x: leftX, y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: leftX, y: dy + dr, spatialReference: sp }));
        pts.push(new Point({ x: rightX, y: dy - dr, spatialReference: sp }));
        pts.push(new Point({ x: rightX, y: dy + dr, spatialReference: sp }));

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
        // Create F as separate strokes to avoid auto-closing
        const fStrokes = this.createFStrokes(dx - (dr * 1.8), dy, dr, sp);
        const a1Strokes = this.createAStrokes(dx, dy, dr, sp);
        const a2Strokes = this.createAStrokes(dx + (dr * 1.2), dy, dr, sp);
        
        // Combine all strokes
        return [...fStrokes, ...a1Strokes, ...a2Strokes];
    }

    static createTStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [
            // Vertical stroke
            [
                new Point({ x: dx, y: dy - dr, spatialReference: sp }),
                new Point({ x: dx, y: dy + dr, spatialReference: sp })
            ],
            // Single horizontal arm (avoid overlap at center)
            [
                new Point({ x: dx - (dr * 0.7), y: dy + dr, spatialReference: sp }),
                new Point({ x: dx + (dr * 0.7), y: dy + dr, spatialReference: sp })
            ]
        ];
    }


    static createKStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [
            // Vertical spine
            [
                new Point({ x: dx, y: dy + dr, spatialReference: sp }),
                new Point({ x: dx, y: dy - dr, spatialReference: sp })
            ],
            // Upper diagonal
            [
                new Point({ x: dx, y: dy, spatialReference: sp }),
                new Point({ x: dx + (dr * 0.8), y: dy + dr, spatialReference: sp })
            ],
            // Lower diagonal
            [
                new Point({ x: dx, y: dy, spatialReference: sp }),
                new Point({ x: dx + (dr * 0.8), y: dy - dr, spatialReference: sp })
            ]
        ];
    }


    static createIStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [[
            new Point({ x: dx, y: dy - dr, spatialReference: sp }),
            new Point({ x: dx, y: dy + dr, spatialReference: sp })
        ]];
    }


    static createTAIStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const tStrokes = this.createTStrokes(dx - (dr * 1.3), dy, dr, sp);
        const aStrokes = this.createAStrokes(dx, dy, dr, sp);
        const iStrokes = this.createIStrokes(dx + (dr * 0.8), dy, dr, sp);
        return [...tStrokes, ...aStrokes, ...iStrokes];
    }

    static createNStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const leftX = dx - (dr * 0.5);
        const rightX = dx + (dr * 0.5);
        return [
            // Left vertical
            [
                new Point({ x: leftX, y: dy + dr, spatialReference: sp }),
                new Point({ x: leftX, y: dy - dr, spatialReference: sp })
            ],
            // Diagonal (from left bottom to right top)
            [
                new Point({ x: leftX, y: dy + dr, spatialReference: sp }),
                new Point({ x: rightX, y: dy - dr, spatialReference: sp })
            ],
            // Right vertical
            [
                new Point({ x: rightX, y: dy + dr, spatialReference: sp }),
                new Point({ x: rightX, y: dy - dr, spatialReference: sp })
            ]
        ];
    }

    static createNAIStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const nStrokes = this.createNStrokes(dx - (dr * 1.3), dy, dr, sp);
        const aStrokes = this.createAStrokes(dx, dy, dr, sp);
        const iStrokes = this.createIStrokes(dx + (dr * 0.8), dy, dr, sp);
        return [...nStrokes, ...aStrokes, ...iStrokes];
    }

    static createNAIRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        // Return single-stroke line paths (not rectangles)
        const paths: number[][][] = [];
        const strokes = this.createNAIStrokes(dx, dy, dr, sp);
        for (let i = 0; i < strokes.length; i++) {
            const seg = strokes[i];
            if (seg && seg.length >= 2) {
                const p1 = seg[0];
                const p2 = seg[1];
                paths.push([[p1.x, p1.y], [p2.x, p2.y]]);
            }
        }
        return paths;
    }

    static createVStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [
            [
                new Point({ x: dx - (dr * 0.7), y: dy + dr, spatialReference: sp }),
                new Point({ x: dx, y: dy - (dr * 0.9), spatialReference: sp })
            ],
            [
                new Point({ x: dx, y: dy - (dr * 0.9), spatialReference: sp }),
                new Point({ x: dx + (dr * 0.7), y: dy + dr, spatialReference: sp })
            ]
        ];
    }

    static createVAStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const vStrokes = this.createVStrokes(dx - (dr * 0.6), dy, dr, sp);
        const aStrokes = this.createAStrokes(dx + (dr * 0.6), dy, dr, sp);
        return [...vStrokes, ...aStrokes];
    }

    static createVARings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        // Return single-stroke line paths (not rectangles)
        const paths: number[][][] = [];
        const strokes = this.createVAStrokes(dx, dy, dr, sp);
        for (let i = 0; i < strokes.length; i++) {
            const seg = strokes[i];
            if (seg && seg.length >= 2) {
                const p1 = seg[0];
                const p2 = seg[1];
                paths.push([[p1.x, p1.y], [p2.x, p2.y]]);
            }
        }
        return paths;
    }

    static createVA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const vPoints = this.createV(dx - (dr * 0.6), dy, dr, sp);
        const aPoints = this.createA(dx + (dr * 0.6), dy, dr, sp);
        return [vPoints, aPoints];
    }

    /**
     * Convert a line segment to a thin rectangle ring (closed) of given stroke width
     */
    static createStrokedRectRing(p1: Point, p2: Point, strokeWidth: number): number[][] {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const px = -uy;
        const py = ux;
        const hw = strokeWidth / 2;

        const p1l = [p1.x + px * hw, p1.y + py * hw];
        const p1r = [p1.x - px * hw, p1.y - py * hw];
        const p2r = [p2.x - px * hw, p2.y - py * hw];
        const p2l = [p2.x + px * hw, p2.y + py * hw];

        return [p1l, p2l, p2r, p1r, p1l];
    }

    /**
     * Create closed polygon rings for TAI text using thin rectangles per stroke
     */
    static createTAIRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        // Return single-stroke line paths (no rectangles)
        const paths: number[][][] = [];
        const strokes = this.createTAIStrokes(dx, dy, dr, sp);
        for (let i = 0; i < strokes.length; i++) {
            const seg = strokes[i];
            if (seg && seg.length >= 2) {
                const p1 = seg[0];
                const p2 = seg[1];
                paths.push([[p1.x, p1.y], [p2.x, p2.y]]);
            }
        }
        return paths;
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
        // Create S as separate strokes to avoid auto-closing
        const sStrokes = this.createSStrokes(dx - (dr * 1.6), dy, dr, sp);
        const a1Strokes = this.createAStrokes(dx, dy, dr, sp);
        const a2Strokes = this.createAStrokes(dx + (dr * 1.6), dy, dr, sp);
        
        // Combine all strokes
        return [...sStrokes, ...a1Strokes, ...a2Strokes];
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

    static createCStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        // Create C as separate arc segments to avoid auto-closing
        const step = 2 * Math.PI / 36; // Smaller steps for smoother curve
        const strokes: Point[][] = [];
        
        // Break C into small line segments to avoid auto-closing issues
        let prevPoint: Point | null = null;
        for (let dtheta = 65 * Math.PI / 180; dtheta < 295 * Math.PI / 180; dtheta += step) {
            const x = dx + dr * Math.cos(dtheta);
            const y = dy - dr * Math.sin(dtheta);
            const currentPoint = new Point({ x, y, spatialReference: sp });

            if (prevPoint) {
                strokes.push([prevPoint, currentPoint]);
            }
            prevPoint = currentPoint;
        }
        
        return strokes;
    }

    static createCAAStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        // Create C as separate strokes to avoid auto-closing
        const cStrokes = this.createCStrokes(dx - (dr * 1.2), dy, dr, sp);
        const a1Strokes = this.createAStrokes(dx, dy, dr, sp);
        const a2Strokes = this.createAStrokes(dx + (dr * 1.2), dy, dr, sp);
        
        // Combine all strokes
        return [...cStrokes, ...a1Strokes, ...a2Strokes];
    }

    static createCAARings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        // Return single-stroke line paths (not rectangles)
        const paths: number[][][] = [];
        const strokes = this.createCAAStrokes(dx, dy, dr, sp);
        for (let i = 0; i < strokes.length; i++) {
            const seg = strokes[i];
            if (seg && seg.length >= 2) {
                const p1 = seg[0];
                const p2 = seg[1];
                paths.push([[p1.x, p1.y], [p2.x, p2.y]]);
            }
        }
        return paths;
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
        const a = this.createAStrokes(dx - (dr * 0.5), dy, dr, sp);
        const t = this.createTStrokes(dx + (dr * 0.83), dy, dr, sp);
        const k = this.createKStrokes(dx + (dr * 1.83), dy, dr, sp);
        return [c, ...a, ...t, ...k];
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
     * Create arrow head geometry
     */
    static createArrowHead(pts: Point[]): number[][] | null {
        if (pts.length < 2) return null;

        try {
            const lastPoint = pts[pts.length - 1];
            const secondLastPoint = pts[pts.length - 2];

            // Calculate arrow dimensions
            const lineLength = GeoTools._2PtLen ? GeoTools._2PtLen(pts[0], lastPoint) : Math.hypot(lastPoint.x - pts[0].x, lastPoint.y - pts[0].y);
            const arrowLength = (GeoTools as any).ArrowFlanksLen ? (GeoTools as any).ArrowFlanksLen(lineLength, lineLength) : lineLength * 0.1;
            const angle = GeoTools.angleInRadians ? GeoTools.angleInRadians(secondLastPoint, lastPoint) : Math.atan2(lastPoint.y - secondLastPoint.y, lastPoint.x - secondLastPoint.x);

            // Use Shapes utility to create arrow head
            if (Shapes && (Shapes as any).arrowHead) {
                return (Shapes as any).arrowHead(lastPoint, arrowLength, angle);
            } else {
                // Fallback arrow head creation
                return this.createSimpleArrowHead(lastPoint, secondLastPoint, arrowLength);
            }
        } catch (e) {
            console.log('Error creating arrow head:', e);
            return null;
        }
    }

    /**
     * Create simple arrow head as fallback
     */
    static createSimpleArrowHead(tip: Point, base: Point, arrowLength: number): number[][] {
        // Calculate the angle from base to tip
        const dx = tip.x - base.x;
        const dy = tip.y - base.y;
        const angle = Math.atan2(dy, dx);

        // Arrow head angle (30 degrees on each side)
        const arrowAngle = Math.PI / 6;

        // Calculate arrow head points
        const leftX = tip.x - arrowLength * Math.cos(angle - arrowAngle);
        const leftY = tip.y - arrowLength * Math.sin(angle - arrowAngle);
        const rightX = tip.x - arrowLength * Math.cos(angle + arrowAngle);
        const rightY = tip.y - arrowLength * Math.sin(angle + arrowAngle);

        // Return arrow head path
        return [
            [leftX, leftY],
            [tip.x, tip.y],
            [rightX, rightY]
        ];
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
        pt1: Point | PointLike,
        candidatePt: Point,
        pt2: Point | PointLike,
        totalLen: number,
        headPercentage: number,
        headAngle: number,
        straight?: boolean
    ): PointLike[] {
        const headSizeBaseRatio = 1.1;
        const headBaseLen = totalLen * headPercentage;
        const headSideLen = headBaseLen * headSizeBaseRatio;

        const angle1 = GeoTools.twoPtsAngle(candidatePt, new Point({ x: pt1.x, y: pt1.y }));
        const angle2 = GeoTools.twoPtsAngle(candidatePt, new Point({ x: pt2.x, y: pt2.y }));

        let midAngle = (Math.abs(angle1 - angle2)) / 2;
        if (Math.abs(angle1 - angle2) > Math.PI * 1.88) midAngle += Math.PI;

        const len = Math.sqrt(
            headBaseLen * headBaseLen + headSideLen * headSideLen -
            2 * headSideLen * headBaseLen * Math.cos(midAngle + headAngle / 180 * Math.PI)
        );

        const upAngle = Math.asin(headBaseLen * Math.sin(midAngle + headAngle / 180 * Math.PI) / len);
        const centAngle = upAngle + headAngle / 180 * Math.PI;

        const result = (straight === false || straight === undefined) ?
            (headBaseLen * Math.sin(Math.PI - centAngle - midAngle) / Math.sin(centAngle)) : 0;

        const path: PointLike[] = [];

        path.push({
            x: candidatePt.x + result * Math.cos(angle1),
            y: candidatePt.y + result * Math.sin(angle1)
        });
        path.push({
            x: candidatePt.x + headSideLen * Math.cos(angle1 - headAngle / 180 * Math.PI),
            y: candidatePt.y + headSideLen * Math.sin(angle1 - headAngle / 180 * Math.PI)
        });
        path.push({ x: candidatePt.x, y: candidatePt.y });
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

    // (Removed duplicate arrowHead implementation that used GeoTools.toDegrees/toRad)

    static CreateBezierPathPCOnly(pointCollection: { x: number; y: number }[], numberOfPts: number): { x: number; y: number }[] {
        // Initial position set to the first point in the collection
        const position: { x: number; y: number } = {
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
        const tween = (window as any).TweenMax.to(position, numberOfPts, {
            bezier: pointCollection,
            ease: (window as any).Linear.easeNone
        });

        // Store the computed path
        const path: { x: number; y: number }[] = [];
        for (let i = 0; i <= numberOfPts; i++) {
            tween.time(i);
            path.push({ x: position.x, y: position.y });
        }

        return path;
    }

    // Shared helpers moved from symbol classes
    static createEllipsePath(center: { x: number; y: number }, width: number, height: number, numberOfPoints: number): number[][] {
        const paths: number[][] = [];
        const angleStep = (2 * Math.PI) / numberOfPoints;
        for (let i = 0; i <= numberOfPoints; i++) {
            const angle = i * angleStep;
            const x = center.x + (width / 2) * Math.cos(angle);
            const y = center.y + (height / 2) * Math.sin(angle);
            paths.push([x, y]);
        }
        return paths;
    }

    static getClosestPointOnLinesFromPairs(pXy: { x: number; y: number }, aXys: number[][]): { x: number; y: number; index: number; fTo: number; fFrom: number } {
        let minDist: number | null = null;
        let fTo = 0;
        let fFrom = 0;
        let x = 0;
        let y = 0;
        let bestIndex = 0;

        if (aXys.length > 1) {
            for (let n = 1; n < aXys.length; n++) {
                let dist: number;
                if (aXys[n][0] !== aXys[n - 1][0]) {
                    const a = (aXys[n][1] - aXys[n - 1][1]) / (aXys[n][0] - aXys[n - 1][0]);
                    const b = aXys[n][1] - a * aXys[n][0];
                    dist = Math.abs(a * pXy.x + b - pXy.y) / Math.sqrt(a * a + 1);
                } else {
                    dist = Math.abs(pXy.x - aXys[n][0]);
                }

                const rl2 = Math.pow(aXys[n][1] - aXys[n - 1][1], 2) + Math.pow(aXys[n][0] - aXys[n - 1][0], 2);
                const ln2 = Math.pow(aXys[n][1] - pXy.y, 2) + Math.pow(aXys[n][0] - pXy.x, 2);
                const lnm12 = Math.pow(aXys[n - 1][1] - pXy.y, 2) + Math.pow(aXys[n - 1][0] - pXy.x, 2);
                const dist2 = Math.pow(dist, 2);
                const calcrl2 = ln2 - dist2 + lnm12 - dist2;

                if (calcrl2 > rl2) {
                    dist = Math.sqrt(Math.min(ln2, lnm12));
                }

                if (minDist === null || minDist > dist) {
                    if (calcrl2 > rl2) {
                        if (lnm12 < ln2) {
                            fTo = 0; fFrom = 1;
                        } else {
                            fFrom = 0; fTo = 1;
                        }
                    } else {
                        fTo = Math.sqrt(lnm12 - dist2) / Math.sqrt(rl2);
                        fFrom = Math.sqrt(ln2 - dist2) / Math.sqrt(rl2);
                    }
                    minDist = dist;
                    bestIndex = n;
                }
            }

            const dx = aXys[bestIndex - 1][0] - aXys[bestIndex][0];
            const dy = aXys[bestIndex - 1][1] - aXys[bestIndex][1];
            x = aXys[bestIndex - 1][0] - (dx * fTo);
            y = aXys[bestIndex - 1][1] - (dy * fTo);
        }

        return { x, y, index: bestIndex, fTo, fFrom };
    }

    static getClosestPointOnLinesFromPoints(pXy: { x: number; y: number }, aXys: { x: number; y: number }[]): { x: number; y: number; index: number; fTo: number; fFrom: number } {
        let minDist: number | null = null;
        let fTo = 0;
        let fFrom = 0;
        let x = 0;
        let y = 0;
        let bestIndex = 0;

        if (aXys.length > 1) {
            for (let n = 1; n < aXys.length; n++) {
                let dist: number;
                if (aXys[n].x !== aXys[n - 1].x) {
                    const a = (aXys[n].y - aXys[n - 1].y) / (aXys[n].x - aXys[n - 1].x);
                    const b = aXys[n].y - a * aXys[n].x;
                    dist = Math.abs(a * pXy.x + b - pXy.y) / Math.sqrt(a * a + 1);
                } else {
                    dist = Math.abs(pXy.x - aXys[n].x);
                }

                const rl2 = Math.pow(aXys[n].y - aXys[n - 1].y, 2) + Math.pow(aXys[n].x - aXys[n - 1].x, 2);
                const ln2 = Math.pow(aXys[n].y - pXy.y, 2) + Math.pow(aXys[n].x - pXy.x, 2);
                const lnm12 = Math.pow(aXys[n - 1].y - pXy.y, 2) + Math.pow(aXys[n - 1].x - pXy.x, 2);
                const dist2 = Math.pow(dist, 2);
                const calcrl2 = ln2 - dist2 + lnm12 - dist2;

                if (calcrl2 > rl2) {
                    dist = Math.sqrt(Math.min(ln2, lnm12));
                }

                if (minDist === null || minDist > dist) {
                    if (calcrl2 > rl2) {
                        if (lnm12 < ln2) {
                            fTo = 0; fFrom = 1;
                        } else {
                            fFrom = 0; fTo = 1;
                        }
                    } else {
                        fTo = Math.sqrt(lnm12 - dist2) / Math.sqrt(rl2);
                        fFrom = Math.sqrt(ln2 - dist2) / Math.sqrt(rl2);
                    }
                    minDist = dist;
                    bestIndex = n;
                }
            }

            const dx = aXys[bestIndex - 1].x - aXys[bestIndex].x;
            const dy = aXys[bestIndex - 1].y - aXys[bestIndex].y;
            x = aXys[bestIndex - 1].x - (dx * fTo);
            y = aXys[bestIndex - 1].y - (dy * fTo);
        }

        return { x, y, index: bestIndex, fTo, fFrom };
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


    static createEchelon(ech: string, pt: Point, radius: number, angle?: number): Point[] | Point[][] {

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
            var paths: Point[][] = [];
            for (var r = 0; r < result.length; r++) {
                paths.push(this.rotate(result[r], pt.x, pt.y, angle));
            }
            return paths;
        } else {
            return result;
        }
    }

    /**
     * Create Bezier path from points
     * Note: This requires TweenMax library which may not be available in 4.x
     */
    static createBezierPath(points: { x: number; y: number }[], numberOfPts: number, sp: SpatialReference): Polyline {
        if (!points || points.length < 2) {
            throw new Error("At least two points are required to create a path.");
        }

        // Remove duplicate points at the end (up to 2 times)
        const isDuplicate = (a: { x: number; y: number }, b: { x: number; y: number }) =>
            a.x === b.x && a.y === b.y;

        while (
            points.length > 2 &&
            isDuplicate(points[points.length - 1], points[points.length - 2])
            ) {
            points.pop();
        }

        // Starting position for TweenMax
        const position = { x: points[0].x, y: points[0].y };

        // Create tween for bezier curve
        const tween = (window as any).TweenMax.to(position, numberOfPts, {
            bezier: points,
            ease: (window as any).Linear.easeNone,
        });

        // Interpolate bezier points
        const path: [number, number][] = [];
        for (let i = 0; i <= numberOfPts; i++) {
            tween.time(i);
            path.push([position.x, position.y]);
        }

        // Construct polyline
        const polyline = new Polyline({ spatialReference: sp });
        polyline.addPath(path);

        return polyline;
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


    /**
     * Create Bezier curve symbol
     */
    static createSymbolByBCurve(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials, spatialReference:SpatialReference): Polyline | Polygon {
        const tempArray: { x: number, y: number }[] = [];
        pts.forEach(pt => {
            tempArray.push({ x: pt.x, y: pt.y });
        });
        tempArray.push({ x: firstPoint.x, y: firstPoint.y });

        return Utils.createBezierPath(tempArray, 130, spatialReference, false);
    }

    /**
     * Create polygon symbol
     */
    static createSymbolByPolygon(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials, spatialReference:SpatialReference): Polygon {
        const result = new Polygon({ spatialReference: spatialReference });
        const tempArray: number[][] = [];

        pts.forEach(pt => {
            tempArray.push([pt.x, pt.y]);
        });
        tempArray.push([firstPoint.x, firstPoint.y]);

        result.addRing(tempArray);
        return result;
    }

    /**
     * Create rectangle symbol
     */
    static createSymbolByRect(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials, spatialReference:SpatialReference): Polygon {
        const result = new Polygon({ spatialReference: spatialReference });
        const tempArray: number[][] = [];

        pts.forEach(pt => {
            tempArray.push([pt.x, pt.y]);
        });

        // Create temporary polygon to get extent
        const tempPolygon = new Polygon({ spatialReference: spatialReference });
        tempPolygon.addRing(tempArray);
        const extent = tempPolygon.extent;

        if (!extent) {
            // Fallback to simple rectangle using first and last points
            const rectArray: number[][] = [
                [firstPoint.x, firstPoint.y],
                [firstPoint.x, lastPoint.y],
                [lastPoint.x, lastPoint.y],
                [lastPoint.x, firstPoint.y],
                [firstPoint.x, firstPoint.y]
            ];
            result.addRing(rectArray);
            return result;
        }

        // Create rectangle from extent
        const rectArray: number[][] = [
            [extent.xmin, extent.ymin],
            [extent.xmin, extent.ymax],
            [extent.xmax, extent.ymax],
            [extent.xmax, extent.ymin],
            [extent.xmin, extent.ymin]
        ];

        result.addRing(rectArray);
        return result;
    }

    /**
     * Create perfect ellipse symbol
     */
    static createSymbolByPerfectEllipse(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials, view:any): Polygon {
        const result = new Polygon({ spatialReference: view.spatialReference });

        // Convert points to screen coordinates for ellipse calculation
        const firstPtScreen = view.toScreen(firstPoint);
        const lastPtScreen = view.toScreen(lastPoint);

        if (!firstPtScreen || !lastPtScreen) {
            // Fallback to simple ellipse if screen conversion fails
            return this.createSimpleEllipse(firstPoint, lastPoint, firstPoint.spatialReference);
        }

        const widthScreen = Math.abs(lastPtScreen.x - firstPtScreen.x);
        const heightScreen = Math.abs(lastPtScreen.y - firstPtScreen.y);

        // Create ellipse using Shapes utility (assuming it exists and is compatible)
        if (Shapes && (Shapes as any).createEllipse) {
            try {
                const paths = (Shapes as any).createEllipse({
                    center: firstPtScreen,
                    longAxis: widthScreen,
                    shortAxis: heightScreen,
                    numberOfPoints: 60,
                    view: view
                });

                // Convert screen coordinates back to map coordinates
                const mapPath: number[][] = [];
                paths.forEach((screenPt: any) => {
                    const mapPt = view.toMap(screenPt);
                    if (mapPt) {
                        mapPath.push([mapPt.x, mapPt.y]);
                    }
                });

                result.addRing(mapPath);
            } catch (e) {
                // Fallback to simple circle if Shapes utility fails
                return this.createSimpleEllipse(firstPoint, lastPoint, firstPoint.spatialReference);
            }
        } else {
            // Fallback to simple circle
            return this.createSimpleEllipse(firstPoint, lastPoint, firstPoint.spatialReference);
        }

        return result;
    }

    /**
     * Create simple ellipse as fallback
     */
    static createSimpleEllipse(centerPoint: Point, radiusPoint: Point, spatialReference: SpatialReference): Polygon {
        const result = new Polygon({ spatialReference: spatialReference });
        const centerX = centerPoint.x;
        const centerY = centerPoint.y;
        const radiusX = Math.abs(radiusPoint.x - centerX);
        const radiusY = Math.abs(radiusPoint.y - centerY);

        const points: number[][] = [];
        const numberOfPoints = 60;

        for (let i = 0; i <= numberOfPoints; i++) {
            const angle = (2 * Math.PI * i) / numberOfPoints;
            const x = centerX + radiusX * Math.cos(angle);
            const y = centerY + radiusY * Math.sin(angle);
            points.push([x, y]);
        }

        result.addRing(points);
        return result;
    }

    // Polyline symbol creators moved from symbol classes
    static createPolylineByLine(
        pts: Point[],
        firstPoint: Point,
        lastPoint: Point,
        drawEssentials: DrawEssentials,
        spatialReference: SpatialReference
    ): Polyline {
        const result = new Polyline({ spatialReference });
        if (pts.length === 2) {
            result.addPath([[lastPoint.x, lastPoint.y], [firstPoint.x, firstPoint.y]]);
        } else if (pts.length > 2) {
            const tempArray = pts.map(pt => ({ x: pt.x, y: pt.y }));
            const bezierPoints = Shapes.CreateBezierPathPCOnly(tempArray, 100);
            const bezierPath = bezierPoints.map(pt => [pt.x, pt.y]);
            result.addPath(bezierPath);

            const lastPt = bezierPath[bezierPath.length - 1];
            const firstPt = bezierPath[0];
            const midPt = GeoTools.getMidPoint(
                new Point({ x: lastPt[0], y: lastPt[1], spatialReference }),
                new Point({ x: firstPt[0], y: firstPt[1], spatialReference })
            );
            const baseLineLen = GeoTools._2PtLen(
                new Point({ x: lastPt[0], y: lastPt[1], spatialReference }),
                new Point({ x: firstPt[0], y: firstPt[1], spatialReference })
            );
            let cLenLimit = baseLineLen / 10;
            if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;

            const echelons = Shapes.createEchelon(
                (drawEssentials as any).ECHELON || 0,
                midPt,
                cLenLimit,
                GeoTools.twoPtsAngle(firstPoint, lastPoint)
            );

            const echelonPaths = Array.isArray((echelons as any)[0]) ? (echelons as any) : [echelons as any];
            for (const path of echelonPaths) {
                const pathPairs = (path as Point[]).map(p => [p.x, p.y]);
                result.addPath(pathPairs);
            }
        }
        return result;
    }

    static createPolylineByCloseLine(
        pts: Point[],
        firstPoint: Point,
        lastPoint: Point,
        drawEssentials: DrawEssentials,
        spatialReference: SpatialReference,
        faceGapConst: number
    ): Polyline {
        const result = new Polyline({ spatialReference });
        if (pts.length === 2) {
            result.addPath([[lastPoint.x, lastPoint.y], [firstPoint.x, firstPoint.y]]);
        } else if (pts.length > 2) {
            const tempArray = pts.map(pt => ({ x: pt.x, y: pt.y }));
            tempArray.push({ x: firstPoint.x, y: firstPoint.y });
            const bezierPoints = Shapes.CreateBezierPathPCOnly(tempArray, 100);
            const paths = bezierPoints.map(pt => [pt.x, pt.y]);
            const midPt = Shapes.getClosestPointOnLinesFromPairs({ x: lastPoint.x, y: lastPoint.y }, paths);

            const faceGap = GeoTools.setDefault(drawEssentials, "FACE_GAP", faceGapConst);
            const frstEndPIndx = Math.max(0, midPt.index - faceGapConst - Math.floor(faceGap / 2));
            const secStartPIndx = Math.min(100, midPt.index + faceGapConst + Math.floor(faceGap / 2));

            if (frstEndPIndx > 0) {
                result.addPath(paths.slice(0, frstEndPIndx));
            }
            if (secStartPIndx < paths.length) {
                result.addPath(paths.slice(secStartPIndx));
            }

            if (frstEndPIndx < paths.length && secStartPIndx < paths.length) {
                const p1 = new Point({ x: paths[frstEndPIndx][0], y: paths[frstEndPIndx][1], spatialReference });
                const p2 = new Point({ x: paths[secStartPIndx][0], y: paths[secStartPIndx][1], spatialReference });
                const baseLineLen = GeoTools._2PtLen(p1, p2);
                let cLenLimit = baseLineLen / 10;
                if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;

                const midPointAsPoint = new Point({ x: midPt.x, y: midPt.y, spatialReference });
                const echelons = Shapes.createEchelon(
                    (drawEssentials as any).ECHELON || 0,
                    midPointAsPoint,
                    cLenLimit,
                    GeoTools.twoPtsAngle(p1, p2)
                );

                const echelonPaths = Array.isArray((echelons as any)[0]) ? (echelons as any) : [echelons as any];
                for (const path of echelonPaths) {
                    const pathPairs = (path as Point[]).map(p => [p.x, p.y]);
                    result.addPath(pathPairs);
                }
            }
        }
        return result;
    }

    static createPolylineByPerfectEllipse(
        pts: Point[],
        firstPoint: Point,
        lastPoint: Point,
        drawEssentials: DrawEssentials,
        spatialReference: SpatialReference,
        faceGapConstEllipse: number
    ): Polyline {
        const result = new Polyline({ spatialReference });
        if (pts.length === 2) {
            const center = { x: firstPoint.x, y: firstPoint.y };
            const widthMap = Math.abs(lastPoint.x - firstPoint.x);
            const heightMap = Math.abs(lastPoint.y - firstPoint.y);
            const paths = Shapes.createEllipsePath(center, widthMap, heightMap, 60);
            result.addPath(paths);
        } else if (pts.length > 2) {
            const secondPt = pts[1];
            const center = { x: firstPoint.x, y: firstPoint.y };
            const widthMap = Math.abs(secondPt.x - firstPoint.x);
            const heightMap = Math.abs(secondPt.y - firstPoint.y);
            const paths = Shapes.createEllipsePath(center, widthMap, heightMap, 60);
            const ellipsePoints = paths.map(pt => ({ x: pt[0], y: pt[1] }));
            const midPt = Shapes.getClosestPointOnLinesFromPoints({ x: lastPoint.x, y: lastPoint.y }, ellipsePoints);

            const faceGap = GeoTools.setDefault(drawEssentials, "FACE_GAP", faceGapConstEllipse);
            const frstEndPIndx = Math.max(0, midPt.index - faceGapConstEllipse - Math.floor(faceGap / 2));
            const secStartPIndx = Math.min(60, midPt.index + faceGapConstEllipse + Math.floor(faceGap / 2));

            if (frstEndPIndx > 0) {
                result.addPath(paths.slice(0, frstEndPIndx));
            }
            if (secStartPIndx < paths.length) {
                result.addPath(paths.slice(secStartPIndx));
            }

            if (frstEndPIndx < paths.length && secStartPIndx < paths.length) {
                const p1 = new Point({ x: paths[frstEndPIndx][0], y: paths[frstEndPIndx][1], spatialReference });
                const p2 = new Point({ x: paths[secStartPIndx][0], y: paths[secStartPIndx][1], spatialReference });
                const baseLineLen = GeoTools._2PtLen(p1, p2);
                let cLenLimit = baseLineLen / 10;
                if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;

                const midPointAsPoint = new Point({ x: midPt.x, y: midPt.y, spatialReference });
                const echelons = Shapes.createEchelon(
                    (drawEssentials as any).ECHELON || 0,
                    midPointAsPoint,
                    cLenLimit,
                    GeoTools.twoPtsAngle(firstPoint, lastPoint)
                );

                const echelonPaths = Array.isArray((echelons as any)[0]) ? (echelons as any) : [echelons as any];
                for (const path of echelonPaths) {
                    const pathPairs = (path as Point[]).map(p => [p.x, p.y]);
                    result.addPath(pathPairs);
                }
            }
        }
        return result;
    }
}



export default Shapes;