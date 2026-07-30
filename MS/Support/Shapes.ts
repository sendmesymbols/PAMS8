import Polyline from "@arcgis/core/geometry/Polyline";
import Point from "@arcgis/core/geometry/Point";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
import GeoTools from './GeoTools.ts';
import Echelons from './Echelons.ts';
import Utils from "./utils";
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
    ): { geometry: Polyline; lastPoint: Point; backPoint: Point } {
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

        const result = new Polyline({ spatialReference: view.spatialReference });
        const pathCoords = path.map(p => [p.x, p.y]);
        result.addPath(pathCoords);

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
     * Letter B as clean 2-point strokes. Same point sequence as createB — including
     * the segment that bridges the two bowls, which is the B's left stem — just
     * emitted pairwise so strokes->rings consumers keep the glyph instead of closing
     * each bowl into a real-area ring (a hole the 3D tessellator cuts).
     * Takes (dx, dy, dr, sp) to match the other letter builders.
     */
    static createBStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts = this.createB(new Point({ x: dx, y: dy, spatialReference: sp }), dr, 60);
        const strokes: Point[][] = [];
        for (let i = 0; i < pts.length - 1; i++) {
            strokes.push([pts[i], pts[i + 1]]);
        }
        return strokes;
    }

    /**
     * Create P shape (letter P: stem going up + upper half circle)
     */
    static createP(pt: Point, radius: number, steps: number): Point[] {
        const sp = pt.spatialReference;
        const stemX = pt.x - radius / 5.6;

        const halfCircle = this.createHalfCircle(
            new Point({ x: stemX, y: pt.y + radius / 2, spatialReference: sp }),
            radius / 2, 4.4, 1.6, steps
        );

        // Prepend the bottom of the stem so the path reads:
        // bottom → (arc start near top = left stem) → arc → middle
        return [new Point({ x: stemX, y: pt.y - radius, spatialReference: sp }), ...halfCircle];
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
        // Clean L as one non-retracing path: stem top -> stem bottom -> base right.
        // The old version went bottom -> top -> bottom (back down the stem); that
        // doubled-over segment collapses in the 3D tessellator.
        return [
            new Point({ x: dx, y: dy + dr, spatialReference: sp }),
            new Point({ x: dx, y: dy - dr, spatialReference: sp }),
            new Point({ x: dx + dr, y: dy - dr, spatialReference: sp })
        ];
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
     * Create letter J as 2-point stroke segments to prevent auto-closing when used as polygon rings.
     * Each 2-point ring retraces itself on closure — visually invisible.
     */
    static createJStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const strokes: Point[][] = [];

        // Build the full J point sequence (same as createJ)
        const allPts: Point[] = [];
        allPts.push(new Point({ x: dx - (dr * 0.5), y: dy + dr, spatialReference: sp })); // Left Arm
        allPts.push(new Point({ x: dx + (dr * 0.5), y: dy + dr, spatialReference: sp })); // Right Arm
        allPts.push(new Point({ x: dx, y: dy + dr, spatialReference: sp })); // Top center

        const stPt = new Point({ x: dx - (dr * 0.5), y: dy - (dr / 2), spatialReference: sp });
        const halfCirclePts = this.createHalfCircle(stPt, dr / 2, 2 * Math.PI, Math.PI, 30);
        allPts.push(...halfCirclePts);

        // Emit each consecutive pair as its own 2-point stroke
        for (let i = 0; i < allPts.length - 1; i++) {
            strokes.push([allPts[i], allPts[i + 1]]);
        }

        return strokes;
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
    static createG(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
      const allPoints: Point[] = [];
      const step = 2 * Math.PI / 180;

      // Create the main arc (C-shaped curve) - vertically flipped
      for (let dtheta = 65 * Math.PI / 180; dtheta < 295 * Math.PI / 180; dtheta += step) {
        const x = dx + dr * Math.cos(dtheta);
        const y = dy + dr * Math.sin(dtheta); // Changed from - to + for vertical flip
        allPoints.push(new Point({ x, y, spatialReference: sp }));
      }

      // Get the first and last points of the arc to create the horizontal line
      const firstPt = allPoints[0];
      const lastPt = allPoints[allPoints.length - 1];

      // Calculate midpoint between first and last arc points
      const midPt = new Point({
        x: (firstPt.x + lastPt.x) / 2,
        y: (firstPt.y + lastPt.y) / 2,
        spatialReference: sp
      });

      // Create the horizontal leg (what makes it a G instead of C)
      const leg = new Point({
        x: midPt.x - (dr * 0.5), // Back to original direction
        y: midPt.y,
        spatialReference: sp
      });

      // Add the horizontal line points to complete the G
      // Add a small gap, then the horizontal line
      allPoints.push(new Point({ x: lastPt.x, y: lastPt.y, spatialReference: sp })); // Connection point
      allPoints.push(midPt);
      allPoints.push(leg);

      return allPoints;
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
        // Clean P as one non-retracing path: full-height stem, then a bowl arc on the
        // upper right. The old version reused createDD and then retraced its stem; that
        // doubled-over segment collapses in the 3D tessellator.
        const sx = dx - (dr / 6);   // stem x (matches the previous stem placement)
        const r = dr / 2;           // bowl radius
        const cy = dy + (dr / 2);   // bowl centre y (upper half)
        const pts: Point[] = [];
        pts.push(new Point({ x: sx, y: dy - dr, spatialReference: sp }));  // stem bottom
        pts.push(new Point({ x: sx, y: dy + dr, spatialReference: sp }));  // stem top
        const steps = 24;
        for (let i = 0; i <= steps; i++) {
            const t = (Math.PI * i) / steps;  // 0 (stem top) .. PI (mid stem)
            pts.push(new Point({ x: sx + r * Math.sin(t), y: cy + r * Math.cos(t), spatialReference: sp }));
        }
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

    /** Half-width of the U glyph — matches the A / N / M glyph width so U sits
     *  in the same cell as its neighbours instead of being twice as wide. */
    private static readonly U_HALF_WIDTH = 0.55;

    /** Bowl arc of the U: left side -> bottom -> right side, bottom resting on
     *  the baseline (dy - dr) and cap height at dy + dr, like every other letter.
     *  The stems read their x/y off arc[0] / arc[last] so they always meet the
     *  bowl exactly. */
    private static _uBowlArc(dx: number, dy: number, dr: number, sp: SpatialReference, steps: number): Point[] {
        const r = dr * this.U_HALF_WIDTH;   // bowl radius == half-width: bowl spans the full glyph
        const cy = dy - dr + r;             // bowl centre; bowl bottom sits on the baseline
        const arc: Point[] = [];
        for (let i = 0; i <= steps; i++) {
            const theta = Math.PI + (Math.PI * i) / steps;   // 180deg -> 360deg
            arc.push(new Point({
                x: dx + r * Math.cos(theta),
                y: cy + r * Math.sin(theta),
                spatialReference: sp
            }));
        }
        return arc;
    }

    /**
     * Create letter U
     */
    static createU(dx: number, dy: number, dr: number, sp: SpatialReference): Point[] {
        // One continuous, symmetric path: left stem down -> bowl -> right stem up.
        // The old version was 2dr wide (twice every other letter), had its two
        // stems at different x offsets and different heights, left a gap between
        // the bowl and the right stem, and ended on a duplicated point — a
        // zero-length segment the 3D tessellator collapses.
        const arc = this._uBowlArc(dx, dy, dr, sp, 24);
        const left = arc[0];
        const right = arc[arc.length - 1];

        return [
            new Point({ x: left.x, y: dy + dr, spatialReference: sp }),   // left stem, cap height
            ...arc,                                                       // down the left stem, round the bowl
            new Point({ x: right.x, y: dy + dr, spatialReference: sp })   // right stem, cap height
        ];
    }

    /**
     * Create letter U as separate strokes to avoid auto-closing.
     * Every stroke is a clean 2-point segment (the convention for *Strokes in
     * this file) so strokes->rings consumers keep the whole glyph.
     */
    static createUStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const arc = this._uBowlArc(dx, dy, dr, sp, 18);
        const left = arc[0];
        const right = arc[arc.length - 1];
        const strokes: Point[][] = [];

        // Left stem: cap height down to the start of the bowl
        strokes.push([
            new Point({ x: left.x, y: dy + dr, spatialReference: sp }),
            left
        ]);

        // Bowl, one 2-point segment per arc step
        for (let i = 0; i < arc.length - 1; i++) {
            strokes.push([arc[i], arc[i + 1]]);
        }

        // Right stem: end of the bowl back up to cap height
        strokes.push([
            right,
            new Point({ x: right.x, y: dy + dr, spatialReference: sp })
        ]);

        return strokes;
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
     * Letter Y as clean strokes — stem + two branches — with no retraced
     * segments. createY returns to the junction point twice, which the 3D
     * tessellator collapses. Three separate 2-point paths render identically
     * in 2D and 3D.
     */
    static createYStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [
            // Vertical stem: junction → bottom
            [
                new Point({ x: dx, y: dy, spatialReference: sp }),
                new Point({ x: dx, y: dy - dr, spatialReference: sp }),
            ],
            // Left branch: junction → upper-left
            [
                new Point({ x: dx, y: dy, spatialReference: sp }),
                new Point({ x: dx - (dr * 0.6), y: dy + dr, spatialReference: sp }),
            ],
            // Right branch: junction → upper-right
            [
                new Point({ x: dx, y: dy, spatialReference: sp }),
                new Point({ x: dx + (dr * 0.6), y: dy + dr, spatialReference: sp }),
            ],
        ];
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
        // Use stroke-based A so each letter renders as clean 2-point segments —
        // createA retraces its right diagonal, which collapses in the 3D
        // tessellator. Matches the createSAA / createFAA pattern.
        const a1Strokes = this.createAStrokes(dx - (dr * 1.3), dy, dr, sp);
        const a2Strokes = this.createAStrokes(dx + (dr * 1.3), dy, dr, sp);
        return [...a1Strokes, ...a2Strokes];
    }

    static createAO(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createA(dx - (dr * 1.3), dy, dr, sp);
        const pts2 = this.createO(dx + (dr * 1.3), dy, dr, sp);
        return [pts1, pts2];
    }

    static createAOStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [
            ...this.createAStrokes(dx - (dr * 1.3), dy, dr, sp),
            ...this.createOStrokes(dx + (dr * 1.3), dy, dr, sp)
        ];
    }
    static createAORings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        return this.strokesToSegments(this.createAOStrokes(dx, dy, dr, sp));
    }

    static createUA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        // Offsets tightened for the narrower U (it used to be 2dr wide, which left
        // a ~1dr hole between the two letters once U matched the A glyph width).
        const pts1 = this.createU(dx - (dr * 0.75), dy, dr, sp);
        const pts2 = this.createA(dx + (dr * 0.75), dy, dr, sp);
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

    static createZORStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const zStrokes = this.createZStrokes(dx - (dr * 1.8), dy, dr, sp);
        const oStrokes = this.createOStrokes(dx, dy, dr, sp);
        const rStrokes = this.createRStrokes(dx + (dr * 1.2), dy, dr, sp);
        return [...zStrokes, ...oStrokes, ...rStrokes];
    }

    static createZStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [
            // Top horizontal line
            [
                new Point({ x: dx, y: dy + dr, spatialReference: sp }),
                new Point({ x: dx + dr, y: dy + dr, spatialReference: sp })
            ],
            // Diagonal line
            [
                new Point({ x: dx + dr, y: dy + dr, spatialReference: sp }),
                new Point({ x: dx, y: dy - dr, spatialReference: sp })
            ],
            // Bottom horizontal line
            [
                new Point({ x: dx, y: dy - dr, spatialReference: sp }),
                new Point({ x: dx + dr, y: dy - dr, spatialReference: sp })
            ]
        ];
    }

    static createOStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        // Create O as separate arc segments to avoid auto-closing.
        // Stepped by integer index rather than accumulating a float angle: the old
        // `dtheta < 2*PI` loop overshot and emitted a final point on top of the first,
        // so the explicit closing segment came out zero-length.
        const steps = 36;
        const at = (i: number) => new Point({
            x: dx + 0.5 * dr * Math.cos((2 * Math.PI * i) / steps),
            y: dy - dr * Math.sin((2 * Math.PI * i) / steps),
            spatialReference: sp
        });

        const strokes: Point[][] = [];
        let prevPoint = at(0);
        for (let i = 1; i <= steps; i++) {
            const currentPoint = i === steps ? at(0) : at(i);   // last segment closes exactly on the first point
            strokes.push([prevPoint, currentPoint]);
            prevPoint = currentPoint;
        }

        return strokes;
    }

    static createRStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        // Create R as separate strokes - similar to createR but broken into segments
        const dStrokes = this.createDStrokes(dx, dy + (dr / 2), dr / 2, sp);
        const additionalStrokes = [
            // Vertical line
            [
                new Point({ x: dx - ((dr / 2) / 3), y: dy, spatialReference: sp }),
                new Point({ x: dx - ((dr / 2) / 3), y: dy - dr, spatialReference: sp })
            ],
            // Diagonal leg
            [
                new Point({ x: dx - ((dr / 2) / 3), y: dy, spatialReference: sp }),
                new Point({ x: dx + (dr / 2), y: dy - dr, spatialReference: sp })
            ]
        ];
        return [...dStrokes, ...additionalStrokes];
    }

    static createDStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        // Create D as separate arc segments to avoid auto-closing.
        // One index-driven sweep 270deg -> 450deg in 10deg steps, replacing the two
        // float-accumulating loops that met at 360/0 and duplicated a point there
        // (which produced a zero-length segment).
        const strokes: Point[][] = [];
        let prevPoint: Point | null = null;
        for (let i = 0; i <= 18; i++) {
            const dtheta = ((270 + i * 10) * Math.PI) / 180;
            const currentPoint = new Point({
                x: dx + dr * Math.cos(dtheta),
                y: dy - dr * Math.sin(dtheta),
                spatialReference: sp
            });

            if (prevPoint) {
                strokes.push([prevPoint, currentPoint]);
            }
            prevPoint = currentPoint;
        }

        // Add the vertical lines
        strokes.push([
            new Point({ x: dx - (dr / 3), y: dy + dr, spatialReference: sp }),
            new Point({ x: dx, y: dy + dr, spatialReference: sp })
        ]);
        strokes.push([
            new Point({ x: dx - (dr / 3), y: dy - dr, spatialReference: sp }),
            new Point({ x: dx, y: dy - dr, spatialReference: sp })
        ]);
        strokes.push([
            new Point({ x: dx - (dr / 3), y: dy - dr, spatialReference: sp }),
            new Point({ x: dx - (dr / 3), y: dy + dr, spatialReference: sp })
        ]);

        return strokes;
    }

    static createZORRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        // Return single-stroke line paths (not rectangles)
        const paths: number[][][] = [];
        const strokes = this.createZORStrokes(dx, dy, dr, sp);
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

    static createEAStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const eStrokes = this.createEStrokes(dx - (dr * 1.2), dy, dr, sp);
        const aStrokes = this.createAStrokes(dx + (dr * 0.6), dy, dr, sp);
        return [...eStrokes, ...aStrokes];
    }

    static createEARings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        // Return single-stroke line paths (not rectangles)
        const paths: number[][][] = [];
        const strokes = this.createEAStrokes(dx, dy, dr, sp);
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

    static createDZStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const dStrokes = this.createDStrokes(dx - (dr * 1.1), dy, dr, sp);
        const zStrokes = this.createZStrokes(dx + (dr * 0.3), dy, dr, sp);
        return [...dStrokes, ...zStrokes];
    }

    static createDZRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        // Emit every consecutive 2-point segment so multi-point arc strokes
        // (the D curve) are preserved rather than truncated to their endpoints.
        return this.strokesToSegments(this.createDZStrokes(dx, dy, dr, sp));
    }

    /**
     * Flatten a list of strokes (each an array of >=2 points) into single
     * 2-point line segments. Straight strokes yield one segment; arc strokes
     * yield one segment per consecutive point pair.
     */
    static strokesToSegments(strokes: Point[][]): number[][][] {
        const paths: number[][][] = [];
        for (let i = 0; i < strokes.length; i++) {
            const seg = strokes[i];
            if (!seg || seg.length < 2) continue;
            for (let k = 0; k < seg.length - 1; k++) {
                const p1 = seg[k];
                const p2 = seg[k + 1];
                paths.push([[p1.x, p1.y], [p2.x, p2.y]]);
            }
        }
        return paths;
    }

    static createEZStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const eStrokes = this.createEStrokes(dx - (dr * 1.2), dy, dr, sp);
        const zStrokes = this.createZStrokes(dx + (dr * 0.3), dy, dr, sp);
        return [...eStrokes, ...zStrokes];
    }

    static createEZRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        return this.strokesToSegments(this.createEZStrokes(dx, dy, dr, sp));
    }

    static createPZStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pStrokes = this.createPStrokes(dx - (dr * 1.0), dy, dr, sp);
        const zStrokes = this.createZStrokes(dx + (dr * 0.3), dy, dr, sp);
        return [...pStrokes, ...zStrokes];
    }

    static createPZRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        // Emit every consecutive 2-point segment so the P bowl arc is preserved.
        return this.strokesToSegments(this.createPZStrokes(dx, dy, dr, sp));
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


    // FUP letter offsets. F is left-anchored (spans dx..dx+dr), U is centred on
    // its dx (+/-0.55dr) and P spans dx-dr/6..dx+dr/2 — so these three offsets
    // give an even ~0.3dr gap between glyphs and centre the label on dx.
    private static readonly FUP_F_X = -1.7;
    private static readonly FUP_U_X = 0.15;
    private static readonly FUP_P_X = 1.2;

    static createFUP(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createF(dx + (dr * this.FUP_F_X), dy, dr, sp);
        const pts2 = this.createU(dx + (dr * this.FUP_U_X), dy, dr, sp);
        const pts3 = this.createPP(dx + (dr * this.FUP_P_X), dy, dr, sp);
        return [pts1, pts2, pts3];
    }

    /**
     * Create FUP text using stroke-based approach to avoid auto-closing in ArcGIS API 4.33+
     */
    static createFUPStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const fStrokes = this.createFStrokes(dx + (dr * this.FUP_F_X), dy, dr, sp);
        const uStrokes = this.createUStrokes(dx + (dr * this.FUP_U_X), dy, dr, sp);
        const pStrokes = this.createPStrokes(dx + (dr * this.FUP_P_X), dy, dr, sp);

        // Combine all strokes
        return [...fStrokes, ...uStrokes, ...pStrokes];
    }

    /**
     * Create FUP text as closed polygon rings (one degenerate [p1,p2,p1] ring per
     * 2-point segment), for symbols that carry inner text inside the polygon.
     */
    static createFUPRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        return this.strokesToSegments(this.createFUPStrokes(dx, dy, dr, sp));
    }

    static createDAA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createDD(dx - (dr * 1.8), dy, dr, sp);
        const pts2 = this.createA(dx, dy, dr, sp);
        const pts3 = this.createA(dx + (dr * 1.2), dy, dr, sp);
        return [pts1, pts2, pts3];
    }

    /** DAA as clean 2-point strokes (createDStrokes matches the createDD metrics). */
    static createDAAStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [
            ...this.createDStrokes(dx - (dr * 1.8), dy, dr, sp),
            ...this.createAStrokes(dx, dy, dr, sp),
            ...this.createAStrokes(dx + (dr * 1.2), dy, dr, sp)
        ];
    }
    static createDAARings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        return this.strokesToSegments(this.createDAAStrokes(dx, dy, dr, sp));
    }

    static createOBJ(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createO(dx - (dr * 1.5), dy, dr, sp);
        const pts2 = this.createB(new Point({ x: dx, y: dy, spatialReference: sp }), dr, 60);
        // J uses strokes (2-point segments) so polygon ring closure retraces each segment — no spurious closing line
        const jStrokes = this.createJStrokes(dx + (dr * 1.5), dy, dr, sp);
        return [pts1, pts2, ...jStrokes];
    }

    /** OBJ as clean 2-point strokes — same offsets as createOBJ. */
    static createOBJStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [
            ...this.createOStrokes(dx - (dr * 1.5), dy, dr, sp),
            ...this.createBStrokes(dx, dy, dr, sp),
            ...this.createJStrokes(dx + (dr * 1.5), dy, dr, sp)
        ];
    }
    static createOBJRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        return this.strokesToSegments(this.createOBJStrokes(dx, dy, dr, sp));
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

    /** BAA as clean 2-point strokes — same offsets as createBAA. */
    static createBAAStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [
            ...this.createBStrokes(dx - dr, dy, dr, sp),
            ...this.createAStrokes(dx, dy, dr, sp),
            ...this.createAStrokes(dx + (dr * 1.2), dy, dr, sp)
        ];
    }
    static createBAARings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        return this.strokesToSegments(this.createBAAStrokes(dx, dy, dr, sp));
    }

    static createACP(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createA(dx - (dr * 1.8), dy, dr, sp);
        const pts2 = this.createCC(dx, dy, dr, sp);
        // P glyph as clean strokes (stem + bowl) — createPP backtracks through
        // the stem and the 3D tessellator collapses part of it. Strokes render
        // identically in 2D and 3D.
        const pStrokes = this.createPStrokes(dx + (dr * 1.2), dy, dr, sp);
        return [pts1, pts2, ...pStrokes];
    }

    static createPL(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [
            ...this.createPStrokes(dx, dy, dr, sp),
            ...this.createLStrokes(dx + (dr * 1.3), dy, dr, sp),
        ];
    }

    static createSL(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [
            this.createS(dx, dy, dr, sp),
            ...this.createLStrokes(dx + (dr * 1.3), dy, dr, sp),
        ];
    }

    /**
     * Letter M as four clean strokes (left stem, V valley, right stem).
     * Modelled on createN; no single-letter createM existed before.
     */
    static createM(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const leftX = dx - (dr * 0.6);
        const rightX = dx + (dr * 0.6);
        return [
            // Left vertical
            [
                new Point({ x: leftX, y: dy - dr, spatialReference: sp }),
                new Point({ x: leftX, y: dy + dr, spatialReference: sp })
            ],
            // Left diagonal: top-left down to centre valley
            [
                new Point({ x: leftX, y: dy + dr, spatialReference: sp }),
                new Point({ x: dx, y: dy, spatialReference: sp })
            ],
            // Right diagonal: centre valley up to top-right
            [
                new Point({ x: dx, y: dy, spatialReference: sp }),
                new Point({ x: rightX, y: dy + dr, spatialReference: sp })
            ],
            // Right vertical
            [
                new Point({ x: rightX, y: dy + dr, spatialReference: sp }),
                new Point({ x: rightX, y: dy - dr, spatialReference: sp })
            ]
        ];
    }

    /**
     * "TC" label (Transit Corridors) — T + C, centred on (dx, dy).
     */
    static createTC(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [
            ...this.createTStrokes(dx - (dr * 0.7), dy, dr, sp),
            ...this.createCStrokes(dx + (dr * 0.7), dy, dr, sp)
        ];
    }

    /**
     * "MRR" label (Minimum Risk Route) — M + R + R, centred on (dx, dy).
     */
    static createMRR(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [
            ...this.createM(dx - (dr * 1.4), dy, dr, sp),
            ...this.createRStrokes(dx, dy, dr, sp),
            ...this.createRStrokes(dx + (dr * 1.4), dy, dr, sp)
        ];
    }

    /**
     * "LLTR" label (Low Level Transit Route) — L + L + T + R, centred on (dx, dy).
     */
    static createLLTR(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [
            ...this.createLStrokes(dx - (dr * 2.1), dy, dr, sp),
            ...this.createLStrokes(dx - (dr * 0.7), dy, dr, sp),
            ...this.createTStrokes(dx + (dr * 0.7), dy, dr, sp),
            ...this.createRStrokes(dx + (dr * 2.1), dy, dr, sp)
        ];
    }

    // ---------------------------------------------------------------------
    // Airspace / engagement-zone inner-text labels. Rendered as polygon rings
    // via createInnerText, mirroring createNAIStrokes / createNAIRings.
    // E, H, W had no *Strokes variant, so 2-point-segment versions are added
    // here so they survive the strokes->rings conversion.
    // ---------------------------------------------------------------------

    static createEStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [
            // Vertical stem
            [
                new Point({ x: dx, y: dy - dr, spatialReference: sp }),
                new Point({ x: dx, y: dy + dr, spatialReference: sp })
            ],
            // Top bar
            [
                new Point({ x: dx, y: dy + dr, spatialReference: sp }),
                new Point({ x: dx + dr, y: dy + dr, spatialReference: sp })
            ],
            // Middle bar
            [
                new Point({ x: dx, y: dy, spatialReference: sp }),
                new Point({ x: dx + (dr * 0.8), y: dy, spatialReference: sp })
            ],
            // Bottom bar
            [
                new Point({ x: dx, y: dy - dr, spatialReference: sp }),
                new Point({ x: dx + dr, y: dy - dr, spatialReference: sp })
            ]
        ];
    }

    static createHStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const leftX = dx - (dr * 0.6);
        const rightX = dx + (dr * 0.6);
        return [
            // Left vertical
            [
                new Point({ x: leftX, y: dy - dr, spatialReference: sp }),
                new Point({ x: leftX, y: dy + dr, spatialReference: sp })
            ],
            // Crossbar
            [
                new Point({ x: leftX, y: dy, spatialReference: sp }),
                new Point({ x: rightX, y: dy, spatialReference: sp })
            ],
            // Right vertical
            [
                new Point({ x: rightX, y: dy - dr, spatialReference: sp }),
                new Point({ x: rightX, y: dy + dr, spatialReference: sp })
            ]
        ];
    }

    static createWStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [
            // Left vertical
            [
                new Point({ x: dx - (dr * 0.7), y: dy - dr, spatialReference: sp }),
                new Point({ x: dx - (dr * 0.7), y: dy + dr, spatialReference: sp })
            ],
            // Left diagonal down to centre valley
            [
                new Point({ x: dx - (dr * 0.7), y: dy - dr, spatialReference: sp }),
                new Point({ x: dx, y: dy, spatialReference: sp })
            ],
            // Centre valley to bottom-right
            [
                new Point({ x: dx, y: dy, spatialReference: sp }),
                new Point({ x: dx + (dr * 0.7), y: dy - dr, spatialReference: sp })
            ],
            // Right vertical
            [
                new Point({ x: dx + (dr * 0.7), y: dy - dr, spatialReference: sp }),
                new Point({ x: dx + (dr * 0.7), y: dy + dr, spatialReference: sp })
            ]
        ];
    }

    /**
     * Convert 2-point letter strokes to ring paths (number[][][]) for polygon
     * inner text, mirroring the createNAIRings conversion.
     */
    static strokesToRings(strokes: Point[][]): number[][][] {
        const paths: number[][][] = [];
        for (let i = 0; i < strokes.length; i++) {
            const seg = strokes[i];
            if (seg && seg.length >= 2) {
                paths.push([[seg[0].x, seg[0].y], [seg[1].x, seg[1].y]]);
            }
        }
        return paths;
    }

    // --- 3-letter labels (full-size letters, 1.3*dr step, centred on dx,dy) ---

    static createROZStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [
            ...this.createRStrokes(dx - (dr * 1.3), dy, dr, sp),
            ...this.createOStrokes(dx, dy, dr, sp),
            ...this.createZStrokes(dx + (dr * 1.3), dy, dr, sp)
        ];
    }
    static createROZRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        return this.strokesToRings(this.createROZStrokes(dx, dy, dr, sp));
    }

    static createWEZStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [
            ...this.createWStrokes(dx - (dr * 1.3), dy, dr, sp),
            ...this.createEStrokes(dx, dy, dr, sp),
            ...this.createZStrokes(dx + (dr * 1.3), dy, dr, sp)
        ];
    }
    static createWEZRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        return this.strokesToRings(this.createWEZStrokes(dx, dy, dr, sp));
    }

    static createFEZStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [
            ...this.createFStrokes(dx - (dr * 1.3), dy, dr, sp),
            ...this.createEStrokes(dx, dy, dr, sp),
            ...this.createZStrokes(dx + (dr * 1.3), dy, dr, sp)
        ];
    }
    static createFEZRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        return this.strokesToRings(this.createFEZStrokes(dx, dy, dr, sp));
    }

    static createJEZStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [
            ...this.createJStrokes(dx - (dr * 1.3), dy, dr, sp),
            ...this.createEStrokes(dx, dy, dr, sp),
            ...this.createZStrokes(dx + (dr * 1.3), dy, dr, sp)
        ];
    }
    static createJEZRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        return this.strokesToRings(this.createJEZStrokes(dx, dy, dr, sp));
    }

    static createMEZStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [
            ...this.createM(dx - (dr * 1.3), dy, dr, sp),
            ...this.createEStrokes(dx, dy, dr, sp),
            ...this.createZStrokes(dx + (dr * 1.3), dy, dr, sp)
        ];
    }
    static createMEZRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        return this.strokesToRings(this.createMEZStrokes(dx, dy, dr, sp));
    }

    // --- 6-letter labels (letters shrunk to dr*0.6, 0.8*dr step, centred) ---

    static createHIDACZStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const ls = dr * 0.6;
        const st = dr * 0.8;
        return [
            ...this.createHStrokes(dx - (st * 2.5), dy, ls, sp),
            ...this.createIStrokes(dx - (st * 1.5), dy, ls, sp),
            ...this.createDStrokes(dx - (st * 0.5), dy, ls, sp),
            ...this.createAStrokes(dx + (st * 0.5), dy, ls, sp),
            ...this.createCStrokes(dx + (st * 1.5), dy, ls, sp),
            ...this.createZStrokes(dx + (st * 2.5), dy, ls, sp)
        ];
    }
    static createHIDACZRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        return this.strokesToRings(this.createHIDACZStrokes(dx, dy, dr, sp));
    }

    static createAARROZStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const ls = dr * 0.6;
        const st = dr * 0.8;
        return [
            ...this.createAStrokes(dx - (st * 2.5), dy, ls, sp),
            ...this.createAStrokes(dx - (st * 1.5), dy, ls, sp),
            ...this.createRStrokes(dx - (st * 0.5), dy, ls, sp),
            ...this.createRStrokes(dx + (st * 0.5), dy, ls, sp),
            ...this.createOStrokes(dx + (st * 1.5), dy, ls, sp),
            ...this.createZStrokes(dx + (st * 2.5), dy, ls, sp)
        ];
    }
    static createAARROZRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        return this.strokesToRings(this.createAARROZStrokes(dx, dy, dr, sp));
    }

    static createUARROZStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const ls = dr * 0.6;
        const st = dr * 0.8;
        return [
            ...this.createUStrokes(dx - (st * 2.5), dy, ls, sp),
            ...this.createAStrokes(dx - (st * 1.5), dy, ls, sp),
            ...this.createRStrokes(dx - (st * 0.5), dy, ls, sp),
            ...this.createRStrokes(dx + (st * 0.5), dy, ls, sp),
            ...this.createOStrokes(dx + (st * 1.5), dy, ls, sp),
            ...this.createZStrokes(dx + (st * 2.5), dy, ls, sp)
        ];
    }
    static createUARROZRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        return this.strokesToRings(this.createUARROZStrokes(dx, dy, dr, sp));
    }

    // --- WFZ (3 letters, full size) ---

    static createWFZStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [
            ...this.createWStrokes(dx - (dr * 1.3), dy, dr, sp),
            ...this.createFStrokes(dx, dy, dr, sp),
            ...this.createZStrokes(dx + (dr * 1.3), dy, dr, sp)
        ];
    }
    static createWFZRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        return this.strokesToRings(this.createWFZStrokes(dx, dy, dr, sp));
    }

    // --- 5-letter labels (letters shrunk to dr*0.7, 0.95*dr step, centred) ---

    static createLOMEZStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const ls = dr * 0.7;
        const st = dr * 0.95;
        return [
            ...this.createLStrokes(dx - (st * 2), dy, ls, sp),
            ...this.createOStrokes(dx - st, dy, ls, sp),
            ...this.createM(dx, dy, ls, sp),
            ...this.createEStrokes(dx + st, dy, ls, sp),
            ...this.createZStrokes(dx + (st * 2), dy, ls, sp)
        ];
    }
    static createLOMEZRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        return this.strokesToRings(this.createLOMEZStrokes(dx, dy, dr, sp));
    }

    static createHIMEZStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const ls = dr * 0.7;
        const st = dr * 0.95;
        return [
            ...this.createHStrokes(dx - (st * 2), dy, ls, sp),
            ...this.createIStrokes(dx - st, dy, ls, sp),
            ...this.createM(dx, dy, ls, sp),
            ...this.createEStrokes(dx + st, dy, ls, sp),
            ...this.createZStrokes(dx + (st * 2), dy, ls, sp)
        ];
    }
    static createHIMEZRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        return this.strokesToRings(this.createHIMEZStrokes(dx, dy, dr, sp));
    }

    // --- 8-letter label (letters shrunk to dr*0.5, 0.7*dr step, centred) ---

    static createSHORADEZStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const ls = dr * 0.5;
        const st = dr * 0.7;
        return [
            ...this.createSStrokes(dx - (st * 3.5), dy, ls, sp),
            ...this.createHStrokes(dx - (st * 2.5), dy, ls, sp),
            ...this.createOStrokes(dx - (st * 1.5), dy, ls, sp),
            ...this.createRStrokes(dx - (st * 0.5), dy, ls, sp),
            ...this.createAStrokes(dx + (st * 0.5), dy, ls, sp),
            ...this.createDStrokes(dx + (st * 1.5), dy, ls, sp),
            ...this.createEStrokes(dx + (st * 2.5), dy, ls, sp),
            ...this.createZStrokes(dx + (st * 3.5), dy, ls, sp)
        ];
    }
    static createSHORADEZRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        return this.strokesToRings(this.createSHORADEZStrokes(dx, dy, dr, sp));
    }


    /**
     * Letter P as clean strokes — vertical stem + upper-right bowl — with no
     * retraced segments. The original createDD-based bowl backtracked through
     * its stem, so the 3D tessellator collapsed part of it. Geometry matches
     * the original P (bowl centred at dy + dr/2, radius dr/2).
     */
    static createPStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const rr = dr / 2;
        const cy = dy + rr;          // bowl centre y
        const stemX = dx - rr / 3;   // left stem x (matches createDD)
        const steps = 18;            // bowl arc segments

        const strokes: Point[][] = [];

        // Vertical stem: top → bottom (single clean segment)
        strokes.push([
            new Point({ x: stemX, y: dy + dr, spatialReference: sp }),
            new Point({ x: stemX, y: dy - dr, spatialReference: sp }),
        ]);

        // Upper-right bowl: top of stem → top centre → arc → middle of stem.
        // Emitted as consecutive 2-point segments, like every other *Strokes
        // builder here: the bowl used to be one ~90-point path, which every
        // strokes->rings consumer reduced to its first segment (or closed into a
        // real-area ring the 3D tessellator cuts), losing the bowl entirely.
        const bowl: Point[] = [
            new Point({ x: stemX, y: dy + dr, spatialReference: sp }),
            new Point({ x: dx, y: dy + dr, spatialReference: sp }),
        ];
        for (let i = 1; i <= steps; i++) {
            const dtheta = (270 + (180 * i) / steps) * Math.PI / 180;   // 270deg -> 450deg (=90deg)
            bowl.push(new Point({ x: dx + rr * Math.cos(dtheta), y: cy - rr * Math.sin(dtheta), spatialReference: sp }));
        }
        bowl.push(new Point({ x: stemX, y: dy, spatialReference: sp }));

        for (let i = 0; i < bowl.length - 1; i++) {
            strokes.push([bowl[i], bowl[i + 1]]);
        }

        return strokes;
    }

    static createKG(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createK(dx - dr, dy, dr, sp);
        const temp = this.createG(dx + (dr * 1.5), dy, dr, sp);
        return [pts1, temp[0], temp[1]];
    }

    static createKGStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const kStrokes = this.createKStrokes(dx - dr, dy, dr, sp);
        const gStrokes = this.createGStrokes(dx + (dr * 1.5), dy, dr, sp);
        return [...kStrokes, ...gStrokes];
    }

    static createGStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        // Create G as separate arc segments to avoid auto-closing
        const step = 2 * Math.PI / 36; // Smaller steps for smoother curve
        const strokes: Point[][] = [];
        
        // Create the C part of G (main arc)
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

        // Add the horizontal bar and vertical leg of G
        if (prevPoint) {
            const firstPt = new Point({ 
                x: dx + dr * Math.cos(65 * Math.PI / 180), 
                y: dy - dr * Math.sin(65 * Math.PI / 180), 
                spatialReference: sp 
            });
            const lastPt = prevPoint;
            
            // Calculate midpoint for the horizontal bar
            const midPt = new Point({
                x: (firstPt.x + lastPt.x) / 2,
                y: (firstPt.y + lastPt.y) / 2,
                spatialReference: sp
            });

            // Horizontal bar from first point to midpoint
            strokes.push([firstPt, midPt]);
            
            // Vertical leg from midpoint downward
            const leg = new Point({ x: midPt.x - (dr * 0.5), y: midPt.y, spatialReference: sp });
            strokes.push([midPt, leg]);
        }
        
        return strokes;
    }

    static createKGRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        // Return single-stroke line paths (not rectangles)
        const paths: number[][][] = [];
        const strokes = this.createKGStrokes(dx, dy, dr, sp);
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

    static createKZ(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createK(dx - (dr * 1.2), dy, dr, sp);
        const pts2 = this.createZ(dx, dy, dr, sp);
        return [pts1, pts2];
    }

    static createKZStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const kStrokes = this.createKStrokes(dx - (dr * 1.2), dy, dr, sp);
        const zStrokes = this.createZStrokes(dx, dy, dr, sp);
        return [...kStrokes, ...zStrokes];
    }

    static createKZRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        // Return single-stroke line paths (not rectangles)
        const paths: number[][][] = [];
        const strokes = this.createKZStrokes(dx, dy, dr, sp);
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

    static createLZ(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createL(dx - (dr * 1.2), dy, dr, sp);
        const pts2 = this.createZ(dx, dy, dr, sp);
        return [pts1, pts2];
    }

    /**
     * Letter L as two clean strokes — vertical stem + horizontal foot. The
     * single-path createL retraces its vertical segment, which the 3D polyline
     * tessellator collapses; separate paths render identically in 2D and 3D.
     */
    static createLStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        return [
            // Vertical line
            [
                new Point({ x: dx, y: dy - dr, spatialReference: sp }),
                new Point({ x: dx, y: dy + dr, spatialReference: sp })
            ],
            // Horizontal line
            [
                new Point({ x: dx, y: dy - dr, spatialReference: sp }),
                new Point({ x: dx + dr, y: dy - dr, spatialReference: sp })
            ]
        ];
    }

    static createLZStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const lStrokes = this.createLStrokes(dx - (dr * 1.2), dy, dr, sp);
        const zStrokes = this.createZStrokes(dx, dy, dr, sp);
        return [...lStrokes, ...zStrokes];
    }

    static createLZRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        // Return single-stroke line paths (not rectangles)
        const paths: number[][][] = [];
        const strokes = this.createLZStrokes(dx, dy, dr, sp);
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

    static createVG(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const pts1 = this.createV(dx - dr, dy, dr, sp);
        const temp = this.createG(dx + (dr * 1.2), dy, dr, sp);
        return [pts1, temp[0], temp[1]];
    }

    static createVGStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        const vStrokes = this.createVStrokes(dx - dr, dy, dr, sp);
        const gStrokes = this.createGStrokes(dx + (dr * 1.2), dy, dr, sp);
        return [...vStrokes, ...gStrokes];
    }

    static createVGRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][] {
        // Return single-stroke line paths (not rectangles)
        const paths: number[][][] = [];
        const strokes = this.createVGStrokes(dx, dy, dr, sp);
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
        // W as clean strokes — single-path createW retraces its left vertical and the
        // 3D tessellator collapses it. createWStrokes is the same glyph as separate
        // non-retracing paths; createPP is already a clean single path.
        const wStrokes = this.createWStrokes(dx - (dr * 0.5), dy, dr, sp);
        const pts2 = this.createPP(dx + (dr * 0.7), dy, dr, sp);
        return [...wStrokes, pts2];
    }

    static createENY(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][] {
        // E and Y rendered as clean strokes — their single-path originals
        // retrace segments that the 3D tessellator collapses.
        const eStrokes = this.createEStrokes(dx - (dr * 1.667), dy, dr, sp);
        const pts2 = this.createN(dx + (dr * 0.083), dy, dr, sp);
        const yStrokes = this.createYStrokes(dx + (dr * 1.38), dy, dr, sp);
        return [...eStrokes, pts2, ...yStrokes];
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
     * Create forward arrow head
     */
    static arrowHead(candidatePoint: Point, length: number, angle: number): Point[] {
        // Build wings BEHIND the tip so the arrow points in 'angle' direction (-->), not inverted
        const headAngleRad = Math.PI / 6; // 30 degrees
        const rightWing = new Point({
            x: candidatePoint.x - length * Math.cos(angle - headAngleRad),
            y: candidatePoint.y - length * Math.sin(angle - headAngleRad),
            spatialReference: candidatePoint.spatialReference
        });
        const leftWing = new Point({
            x: candidatePoint.x - length * Math.cos(angle + headAngleRad),
            y: candidatePoint.y - length * Math.sin(angle + headAngleRad),
            spatialReference: candidatePoint.spatialReference
        });
        return [rightWing, candidatePoint, leftWing];
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
     * Oriented cross-mark(s) for wire-obstacle line symbols (Double Apron Fence,
     * Single/Double/High/Low wire fences, Unspecified wire).
     * Standalone: reproduces the brigade/division/corps "X" echelon glyphs
     * ('18'/'21'/'22') and rotates them to the supplied line bearing so the marks
     * stay perpendicular to the fence centerline. Does NOT touch createEchelon
     * (shared by ~124 symbols).
     *
     * @param pt     sample centre on the fence spine
     * @param radius half-size control (cLenLimit)
     * @param angle  local line bearing in radians (GeoTools.angleInRadians)
     * @param count  number of side-by-side X's: 1 = '18', 2 = '21', 3 = '22' (default 1)
     */
    static createOrientedCross(pt: Point, radius: number, angle: number, count: number = 1): Point[][] {
        const sp = pt.spatialReference;
        const cx = pt.x, cy = pt.y;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        // X centres along the local x-axis, matching Echelons.createDIV / createCORPS
        const centres = count === 2 ? [-radius * 0.75, radius * 0.75]
            : count === 3 ? [-radius * 1.5, 0, radius * 1.5]
            : [0];
        const out: Point[][] = [];
        for (const c of centres) {
            // one X per centre, matching Echelons.createX (tall X: ±r/2 in x, ±r in y)
            const base: [number, number][][] = [
                [[c - radius / 2, -radius], [c + radius / 2,  radius]],
                [[c + radius / 2, -radius], [c - radius / 2,  radius]],
            ];
            for (const seg of base) {
                out.push(seg.map(([ox, oy]) => new Point({
                    x: cx + ox * cos - oy * sin,
                    y: cy + ox * sin + oy * cos,
                    spatialReference: sp,
                })));
            }
        }
        return out;
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

    // ── Auto-shape (PowerPoint-style) generators ────────────────────────────────
    // All follow createSymbolByRect's signature and conventions: MAP coordinates,
    // Y-up, explicitly-closed ring, bare Polygon (no edit/selection metadata). The
    // frame is derived from the EXTENT of the whole control-point set so each shape
    // renders correctly whether it receives two drag corners or a full (simplified)
    // freehand point cloud.

    /** Axis-aligned bounding box of a control-point set, in map units. */
    static bboxOf(pts: Point[]): { xmin: number; ymin: number; xmax: number; ymax: number; cx: number; cy: number; w: number; h: number } {
        let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
        for (const p of pts) {
            if (p.x < xmin) xmin = p.x;
            if (p.x > xmax) xmax = p.x;
            if (p.y < ymin) ymin = p.y;
            if (p.y > ymax) ymax = p.y;
        }
        return { xmin, ymin, xmax, ymax, cx: (xmin + xmax) / 2, cy: (ymin + ymax) / 2, w: xmax - xmin, h: ymax - ymin };
    }

    /** Rounded rectangle — rectangle with quarter-arc corners. */
    static createRoundedRect(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials, spatialReference: SpatialReference): Polygon {
        const result = new Polygon({ spatialReference });
        const b = this.bboxOf(pts);
        const r = Math.min(b.w, b.h) * 0.18;
        if (!(r > 0)) { // degenerate frame — fall back to a plain rectangle
            result.addRing([[b.xmin, b.ymin], [b.xmin, b.ymax], [b.xmax, b.ymax], [b.xmax, b.ymin], [b.xmin, b.ymin]]);
            return result;
        }
        const seg = 6; // arc resolution per corner
        const ring: number[][] = [];
        const arc = (cx: number, cy: number, start: number, end: number) => {
            for (let i = 0; i <= seg; i++) {
                const a = start + (end - start) * (i / seg);
                ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
            }
        };
        // Corners (map coords, Y-up): BL, BR, TR, TL
        arc(b.xmin + r, b.ymin + r, Math.PI, Math.PI * 1.5);       // bottom-left
        arc(b.xmax - r, b.ymin + r, Math.PI * 1.5, Math.PI * 2);   // bottom-right
        arc(b.xmax - r, b.ymax - r, 0, Math.PI * 0.5);             // top-right
        arc(b.xmin + r, b.ymax - r, Math.PI * 0.5, Math.PI);       // top-left
        ring.push(ring[0].slice()); // close
        result.addRing(ring);
        return result;
    }

    /** Five-point star inscribed in the frame. */
    static createStar(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials, spatialReference: SpatialReference): Polygon {
        const result = new Polygon({ spatialReference });
        const b = this.bboxOf(pts);
        const rxO = b.w / 2, ryO = b.h / 2, rxI = rxO * 0.4, ryI = ryO * 0.4;
        const points = 5;
        const ring: number[][] = [];
        for (let i = 0; i < points * 2; i++) {
            const outer = i % 2 === 0;
            // Start at the top (+90°) and step by half-points.
            const a = Math.PI / 2 + (i * Math.PI) / points;
            const rx = outer ? rxO : rxI;
            const ry = outer ? ryO : ryI;
            ring.push([b.cx + rx * Math.cos(a), b.cy + ry * Math.sin(a)]);
        }
        ring.push(ring[0].slice()); // close
        result.addRing(ring);
        return result;
    }

    /** Rightward chevron (block "greater-than" with a back notch). */
    static createChevron(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials, spatialReference: SpatialReference): Polygon {
        const result = new Polygon({ spatialReference });
        const b = this.bboxOf(pts);
        const t = b.w * 0.4; // horizontal depth of the point / notch
        const ring: number[][] = [
            [b.xmin, b.ymax],            // top-left
            [b.xmax - t, b.ymax],        // top, before the tip
            [b.xmax, b.cy],              // right tip
            [b.xmax - t, b.ymin],        // bottom, after the tip
            [b.xmin, b.ymin],            // bottom-left
            [b.xmin + t, b.cy],          // inner back notch
            [b.xmin, b.ymax],            // close
        ];
        result.addRing(ring);
        return result;
    }

    /** Cloud — scalloped ellipse (lumpy lobes around the frame). */
    static createCloud(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials, spatialReference: SpatialReference): Polygon {
        const result = new Polygon({ spatialReference });
        const b = this.bboxOf(pts);
        const lobes = 9;
        const steps = 120;
        const ring: number[][] = [];
        for (let i = 0; i <= steps; i++) {
            const theta = (2 * Math.PI * i) / steps;
            const bump = Math.abs(Math.sin((lobes * theta) / 2));
            const rx = (b.w / 2) * (0.80 + 0.20 * bump);
            const ry = (b.h / 2) * (0.80 + 0.20 * bump);
            ring.push([b.cx + rx * Math.cos(theta), b.cy + ry * Math.sin(theta)]);
        }
        ring.push(ring[0].slice()); // explicit close (float sin(2π) ≠ 0)
        result.addRing(ring);
        return result;
    }

    /** Rightward block arrow (rectangular shaft + triangular head). */
    static createBlockArrow(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials, spatialReference: SpatialReference): Polygon {
        const result = new Polygon({ spatialReference });
        const b = this.bboxOf(pts);
        const sh = b.h * 0.5;        // shaft height (centred vertically)
        const headW = b.w * 0.4;     // triangular head width
        const top = b.cy + sh / 2, bot = b.cy - sh / 2, headX = b.xmax - headW;
        const ring: number[][] = [
            [b.xmin, top],           // shaft top-left
            [headX, top],            // shaft top-right
            [headX, b.ymax],         // head base top
            [b.xmax, b.cy],          // tip
            [headX, b.ymin],         // head base bottom
            [headX, bot],            // shaft bottom-right
            [b.xmin, bot],           // shaft bottom-left
            [b.xmin, top],           // close
        ];
        result.addRing(ring);
        return result;
    }

    /** Callout / speech box — rectangle with a pointer tail toward the bottom-left. */
    static createCalloutBox(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials, spatialReference: SpatialReference): Polygon {
        const result = new Polygon({ spatialReference });
        const b = this.bboxOf(pts);
        const boxBottom = b.ymin + b.h * 0.25; // box occupies the top 75%
        const ring: number[][] = [
            [b.xmin, b.ymax],                    // top-left
            [b.xmax, b.ymax],                    // top-right
            [b.xmax, boxBottom],                 // bottom-right of box
            [b.xmin + b.w * 0.45, boxBottom],    // box bottom edge, right of tail
            [b.xmin + b.w * 0.15, b.ymin],       // tail tip (points down)
            [b.xmin + b.w * 0.30, boxBottom],    // box bottom edge, left of tail
            [b.xmin, boxBottom],                 // bottom-left of box
            [b.xmin, b.ymax],                    // close
        ];
        result.addRing(ring);
        return result;
    }

    // ── Extended auto-shape generators (regular polygons, cross, cylinder,
    //    explosions, directional/compound block arrows) ─────────────────────────
    // All follow createSymbolByRect's convention: MAP coordinates, Y-up, explicitly
    // closed ring(s), bare Polygon, frame from the EXTENT of CTRL_PTS. Every shape is
    // a pure deterministic function of CTRL_PTS (+ fixed params) so it reshapes on
    // handle-drag and reproduces on reload.

    /** Rotate a ring's [x,y] pairs about (cx,cy) by angle (radians). */
    static rotateRing(ring: number[][], cx: number, cy: number, ang: number): number[][] {
        const c = Math.cos(ang), s = Math.sin(ang);
        return ring.map(([x, y]) => {
            const dx = x - cx, dy = y - cy;
            return [cx + dx * c - dy * s, cy + dx * s + dy * c];
        });
    }

    /** Regular N-gon inscribed in the frame; startDeg orients the first vertex. */
    static createRegularPolygon(pts: Point[], firstPoint: Point, lastPoint: Point, spatialReference: SpatialReference, sides: number, startDeg: number): Polygon {
        const result = new Polygon({ spatialReference });
        const b = this.bboxOf(pts);
        const rx = b.w / 2, ry = b.h / 2;
        const start = (startDeg || 0) * Math.PI / 180;
        const ring: number[][] = [];
        for (let i = 0; i <= sides; i++) {
            const a = start + (2 * Math.PI * i) / sides;
            ring.push([b.cx + rx * Math.cos(a), b.cy + ry * Math.sin(a)]);
        }
        result.addRing(ring);
        return result;
    }

    /** Plus / cross (12-vertex) inscribed in the frame. */
    static createCrossShape(pts: Point[], firstPoint: Point, lastPoint: Point, spatialReference: SpatialReference): Polygon {
        const result = new Polygon({ spatialReference });
        const b = this.bboxOf(pts);
        const hw = b.w / 2, hh = b.h / 2, aw = Math.min(b.w, b.h) * 0.2; // arm half-width
        const cx = b.cx, cy = b.cy;
        const ring: number[][] = [
            [cx - aw, cy + hh], [cx + aw, cy + hh],                 // top arm
            [cx + aw, cy + aw], [cx + hw, cy + aw],                 // to right arm
            [cx + hw, cy - aw], [cx + aw, cy - aw],                 // right arm
            [cx + aw, cy - hh], [cx - aw, cy - hh],                 // bottom arm
            [cx - aw, cy - aw], [cx - hw, cy - aw],                 // to left arm
            [cx - hw, cy + aw], [cx - aw, cy + aw],                 // left arm
            [cx - aw, cy + hh],                                     // close
        ];
        result.addRing(ring);
        return result;
    }

    /** Flat 2D cylinder ("can") glyph — vertical sides + elliptical top & bottom
     *  caps. NOT a 3D volume (that would be SceneView-only); this draped polygon
     *  renders identically in 2D and 3D. */
    static createCylinderGlyph(pts: Point[], firstPoint: Point, lastPoint: Point, spatialReference: SpatialReference): Polygon {
        const result = new Polygon({ spatialReference });
        const b = this.bboxOf(pts);
        const rx = b.w / 2, ry = b.h * 0.14; // cap ellipse vertical radius
        const topY = b.ymax - ry, botY = b.ymin + ry;
        const steps = 24;
        const ring: number[][] = [];
        // top cap: back half (bulge up) from left to right
        for (let i = 0; i <= steps; i++) {
            const a = Math.PI - (Math.PI * i) / steps; // π → 0
            ring.push([b.cx + rx * Math.cos(a), topY + ry * Math.sin(a)]);
        }
        // right side down
        ring.push([b.cx + rx, botY]);
        // bottom cap: front half (bulge down) from right to left
        for (let i = 0; i <= steps; i++) {
            const a = (Math.PI * i) / steps; // 0 → π
            ring.push([b.cx + rx * Math.cos(a), botY - ry * Math.sin(a)]);
        }
        // left side up
        ring.push([b.cx - rx, topY]);
        result.addRing(ring);
        return result;
    }

    /** Explosion / starburst: alternating outer/inner radii with a deterministic
     *  per-spike jitter so it reads as a jagged detonation (no randomness). */
    static createExplosion(pts: Point[], firstPoint: Point, lastPoint: Point, spatialReference: SpatialReference, spikes: number, innerRatio: number): Polygon {
        const result = new Polygon({ spatialReference });
        const b = this.bboxOf(pts);
        const rx = b.w / 2, ry = b.h / 2;
        const ring: number[][] = [];
        const n = spikes * 2;
        for (let i = 0; i < n; i++) {
            const outer = i % 2 === 0;
            // deterministic jitter: outer spikes alternate long/short, inner steady
            const jitter = outer ? (i % 4 === 0 ? 1.0 : 0.82) : innerRatio;
            const a = Math.PI / 2 + (2 * Math.PI * i) / n;
            ring.push([b.cx + rx * jitter * Math.cos(a), b.cy + ry * jitter * Math.sin(a)]);
        }
        ring.push(ring[0].slice()); // close
        result.addRing(ring);
        return result;
    }

    /** Canonical rightward block-arrow ring for a given frame. */
    static _blockArrowRing(b: { xmin: number; ymin: number; xmax: number; ymax: number; cx: number; cy: number; w: number; h: number }, headRatio: number, shaftRatio: number): number[][] {
        const sh = b.h * shaftRatio, headW = b.w * headRatio;
        const top = b.cy + sh / 2, bot = b.cy - sh / 2, headX = b.xmax - headW;
        return [
            [b.xmin, top], [headX, top], [headX, b.ymax], [b.xmax, b.cy],
            [headX, b.ymin], [headX, bot], [b.xmin, bot], [b.xmin, top],
        ];
    }

    /** Directional block arrow: canonical rightward arrow rotated by angle (rad). */
    static createDirBlockArrow(pts: Point[], firstPoint: Point, lastPoint: Point, spatialReference: SpatialReference, angle: number): Polygon {
        const result = new Polygon({ spatialReference });
        const b = this.bboxOf(pts);
        let ring = this._blockArrowRing(b, 0.4, 0.5);
        if (angle) ring = this.rotateRing(ring, b.cx, b.cy, angle);
        result.addRing(ring);
        return result;
    }

    /** Double-headed block arrow (heads on both ends). vertical=true → up-down. */
    static createDoubleBlockArrow(pts: Point[], firstPoint: Point, lastPoint: Point, spatialReference: SpatialReference, vertical: boolean): Polygon {
        const result = new Polygon({ spatialReference });
        const b = this.bboxOf(pts);
        const sh = b.h * 0.5, headW = b.w * 0.28;
        const top = b.cy + sh / 2, bot = b.cy - sh / 2;
        const lHeadX = b.xmin + headW, rHeadX = b.xmax - headW;
        let ring: number[][] = [
            [lHeadX, top], [rHeadX, top], [rHeadX, b.ymax], [b.xmax, b.cy],
            [rHeadX, b.ymin], [rHeadX, bot], [lHeadX, bot], [lHeadX, b.ymin],
            [b.xmin, b.cy], [lHeadX, b.ymax], [lHeadX, top],
        ];
        if (vertical) ring = this.rotateRing(ring, b.cx, b.cy, Math.PI / 2);
        result.addRing(ring);
        return result;
    }

    /** Quad (4-way) arrow: horizontal + vertical double arrows unioned. */
    static createQuadArrow(pts: Point[], firstPoint: Point, lastPoint: Point, spatialReference: SpatialReference): Polygon {
        const result = new Polygon({ spatialReference });
        const b = this.bboxOf(pts);
        const sh = Math.min(b.w, b.h) * 0.28, headW = Math.min(b.w, b.h) * 0.30;
        const top = b.cy + sh / 2, bot = b.cy - sh / 2;
        const lHeadX = b.xmin + headW, rHeadX = b.xmax - headW;
        const horiz: number[][] = [
            [lHeadX, top], [rHeadX, top], [rHeadX, b.ymax], [b.xmax, b.cy],
            [rHeadX, b.ymin], [rHeadX, bot], [lHeadX, bot], [lHeadX, b.ymin],
            [b.xmin, b.cy], [lHeadX, b.ymax], [lHeadX, top],
        ];
        result.addRing(horiz);
        result.addRing(this.rotateRing(horiz, b.cx, b.cy, Math.PI / 2)); // vertical (union)
        return result;
    }

    /** Pentagon arrow ("home plate"): rectangle with a pointed right end. */
    static createPentagonArrow(pts: Point[], firstPoint: Point, lastPoint: Point, spatialReference: SpatialReference): Polygon {
        const result = new Polygon({ spatialReference });
        const b = this.bboxOf(pts);
        const baseX = b.xmax - Math.min(b.w, b.h) * 0.5;
        const ring: number[][] = [
            [b.xmin, b.ymax], [baseX, b.ymax], [b.xmax, b.cy],
            [baseX, b.ymin], [b.xmin, b.ymin], [b.xmin, b.ymax],
        ];
        result.addRing(ring);
        return result;
    }

    /** Notched right arrow (concave V cut into the tail edge). */
    static createNotchedArrow(pts: Point[], firstPoint: Point, lastPoint: Point, spatialReference: SpatialReference): Polygon {
        const result = new Polygon({ spatialReference });
        const b = this.bboxOf(pts);
        const sh = b.h * 0.5, headW = b.w * 0.4, notch = b.w * 0.15;
        const top = b.cy + sh / 2, bot = b.cy - sh / 2, headX = b.xmax - headW;
        const ring: number[][] = [
            [b.xmin, top], [headX, top], [headX, b.ymax], [b.xmax, b.cy],
            [headX, b.ymin], [headX, bot], [b.xmin, bot],
            [b.xmin + notch, b.cy], [b.xmin, top], // V-notch tail
        ];
        result.addRing(ring);
        return result;
    }

    /** Striped right arrow: triangular head + 3 shaft blocks with gaps (union). */
    static createStripedArrow(pts: Point[], firstPoint: Point, lastPoint: Point, spatialReference: SpatialReference): Polygon {
        const result = new Polygon({ spatialReference });
        const b = this.bboxOf(pts);
        const sh = b.h * 0.5, headW = b.w * 0.4;
        const top = b.cy + sh / 2, bot = b.cy - sh / 2, headX = b.xmax - headW;
        // arrowhead
        result.addRing([[headX, b.ymax], [b.xmax, b.cy], [headX, b.ymin], [headX, b.ymax]]);
        // 3 shaft blocks with gaps across [xmin, headX]
        const shaftW = headX - b.xmin;
        const blockW = shaftW / 3.5, gap = (shaftW - blockW * 3) / 2;
        for (let i = 0; i < 3; i++) {
            const x0 = b.xmin + i * (blockW + gap);
            const x1 = x0 + blockW;
            result.addRing([[x0, top], [x1, top], [x1, bot], [x0, bot], [x0, top]]);
        }
        return result;
    }

    /** Curved / circular / U-turn block arrow: a ribbon following an elliptical arc
     *  (startRad→endRad) with a triangular head at the end. Pure map-coord math. */
    static createArcBlockArrow(pts: Point[], firstPoint: Point, lastPoint: Point, spatialReference: SpatialReference, startRad: number, endRad: number): Polygon {
        const result = new Polygon({ spatialReference });
        const b = this.bboxOf(pts);
        const halfW = Math.min(b.w, b.h) * 0.11;
        const rxMid = b.w / 2 - halfW, ryMid = b.h / 2 - halfW;
        const steps = 40;
        const headSpan = (endRad - startRad) * 0.14; // arc portion given to the head
        const arcEnd = endRad - headSpan;
        const outer: number[][] = [], inner: number[][] = [];
        for (let i = 0; i <= steps; i++) {
            const a = startRad + (arcEnd - startRad) * (i / steps);
            const ca = Math.cos(a), sa = Math.sin(a);
            outer.push([b.cx + (rxMid + halfW) * ca, b.cy + (ryMid + halfW) * sa]);
            inner.push([b.cx + (rxMid - halfW) * ca, b.cy + (ryMid - halfW) * sa]);
        }
        // arrowhead at arcEnd → endRad, widened
        const ah = Math.cos(arcEnd), ahs = Math.sin(arcEnd);
        const tip = [b.cx + rxMid * Math.cos(endRad), b.cy + ryMid * Math.sin(endRad)];
        const headOuter = [b.cx + (rxMid + halfW * 2) * ah, b.cy + (ryMid + halfW * 2) * ahs];
        const headInner = [b.cx + (rxMid - halfW * 2) * ah, b.cy + (ryMid - halfW * 2) * ahs];
        const ring: number[][] = [];
        outer.forEach(p => ring.push(p));      // outer edge forward
        ring.push(headOuter, tip, headInner);  // arrowhead
        for (let i = inner.length - 1; i >= 0; i--) ring.push(inner[i]); // inner edge back
        ring.push(ring[0].slice());            // close
        result.addRing(ring);
        return result;
    }

    // ── Decorated-line generators (Polyline; view-agnostic geometry) ────────────

    /** Railway: centre spine + perpendicular tie paths, all on one Polyline. */
    static createRailwayLine(pts: Point[], firstPoint: Point, lastPoint: Point, spatialReference: SpatialReference): Polyline {
        const result = new Polyline({ spatialReference });
        result.addPath(pts.map(p => [p.x, p.y])); // spine
        // total length → tie spacing as a fraction of length (scale-independent)
        let len = 0;
        for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        if (len <= 0) return result;
        const ties = Math.max(2, Math.round(len / (len / 12))); // ~12 ties
        const half = (len / 12) * 0.4;                          // tie half-length
        for (let t = 0; t <= ties; t++) {
            const target = (len * t) / ties;
            // walk to arc-length `target`
            let acc = 0, seg = 1;
            while (seg < pts.length && acc + Math.hypot(pts[seg].x - pts[seg - 1].x, pts[seg].y - pts[seg - 1].y) < target) {
                acc += Math.hypot(pts[seg].x - pts[seg - 1].x, pts[seg].y - pts[seg - 1].y); seg++;
            }
            if (seg >= pts.length) seg = pts.length - 1;
            const a = pts[seg - 1], bb = pts[seg];
            const segLen = Math.hypot(bb.x - a.x, bb.y - a.y) || 1;
            const f = Math.min(1, Math.max(0, (target - acc) / segLen));
            const mx = a.x + (bb.x - a.x) * f, my = a.y + (bb.y - a.y) * f;
            const ux = (bb.x - a.x) / segLen, uy = (bb.y - a.y) / segLen; // unit tangent
            const nx = -uy, ny = ux;                                      // perpendicular normal
            result.addPath([[mx - nx * half, my - ny * half], [mx + nx * half, my + ny * half]]);
        }
        return result;
    }

    /** Road: centre spine + two parallel casing paths, all on one Polyline. */
    static createRoadLine(pts: Point[], firstPoint: Point, lastPoint: Point, spatialReference: SpatialReference): Polyline {
        const result = new Polyline({ spatialReference });
        let len = 0;
        for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        const hw = (len > 0 ? len : 1) * 0.012; // casing half-width, scale-relative
        const left: number[][] = [], right: number[][] = [];
        for (let i = 0; i < pts.length; i++) {
            const a = pts[Math.max(0, i - 1)], bb = pts[Math.min(pts.length - 1, i + 1)];
            const segLen = Math.hypot(bb.x - a.x, bb.y - a.y) || 1;
            const ux = (bb.x - a.x) / segLen, uy = (bb.y - a.y) / segLen;
            const nx = -uy, ny = ux;
            left.push([pts[i].x + nx * hw, pts[i].y + ny * hw]);
            right.push([pts[i].x - nx * hw, pts[i].y - ny * hw]);
        }
        result.addPath(left);
        result.addPath(right);
        result.addPath(pts.map(p => [p.x, p.y])); // centreline
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