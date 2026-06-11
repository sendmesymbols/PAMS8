import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import Polyline from "@arcgis/core/geometry/Polyline";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";

class Utils {
    /*
    static calculateDistance(pt1: Point, pt2: Point): number {
        const dx = pt2.x - pt1.x;
        const dy = pt2.y - pt1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    static calculateAngle(fromPt: Point, toPt: Point): number {
        const dx = toPt.x - fromPt.x;
        const dy = toPt.y - fromPt.y;
        return Math.atan2(dy, dx);
    }
    */

    static getMidPoint(pt1: Point, pt2: Point, spatialReference: SpatialReference): Point {
        return new Point({
            x: (pt1.x + pt2.x) / 2,
            y: (pt1.y + pt2.y) / 2,
            spatialReference: spatialReference
        });
    }

    static calculateDistance(pt1: Point | { x: number, y: number }, pt2: Point | { x: number, y: number }): number {
        const dx = pt2.x - pt1.x;
        const dy = pt2.y - pt1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    static calculateAngle(fromPt: Point | { x: number, y: number }, toPt: Point | { x: number, y: number }): number {
        const dx = toPt.x - fromPt.x;
        const dy = toPt.y - fromPt.y;
        return Math.atan2(dy, dx);
    }

    static getTwoPointsRelationship(pt1: Point | { x: number, y: number }, pt2: Point | { x: number, y: number }): string {
        if (pt2.x >= pt1.x && pt2.y >= pt1.y) return "ne";
        if (pt2.x < pt1.x && pt2.y >= pt1.y) return "nw";
        if (pt2.x < pt1.x && pt2.y < pt1.y) return "sw";
        return "se";
    }


    /**
     * Create Bezier path from points
     * Uses a Catmull-Rom spline so smooth symbols do not depend on the legacy
     * TweenMax globals.
     */
    static createBezierPath(pointCollection: { x: number, y: number }[], numberOfPts: number, spatialReference:SpatialReference, isPloyLine: Boolean): Polygon | Polyline {
        const points = pointCollection.slice();
        while (
            points.length > 1 &&
            points[points.length - 1].x === points[points.length - 2].x &&
            points[points.length - 1].y === points[points.length - 2].y
        ) {
            points.pop();
        }

        const path: number[][] = [];
        if (points.length === 1) {
            path.push([points[0].x, points[0].y]);
        } else {
            const segmentCount = points.length - 1;
            for (let i = 0; i <= numberOfPts; i++) {
                const position = (i / numberOfPts) * segmentCount;
                const segment = Math.min(Math.floor(position), segmentCount - 1);
                const t = Math.min(position - segment, 1);
                const p0 = points[Math.max(0, segment - 1)];
                const p1 = points[segment];
                const p2 = points[Math.min(points.length - 1, segment + 1)];
                const p3 = points[Math.min(points.length - 1, segment + 2)];
                const t2 = t * t;
                const t3 = t2 * t;

                path.push([
                    0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
                    0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
                ]);
            }
        }

        if(isPloyLine) {
            const result:Polyline = new Polyline({"spatialReference": spatialReference});
            result.addPath(path);
            return result;
        } else {
            const result:Polygon = new Polygon({"spatialReference": spatialReference});
            result.addRing(path);
            return result;
        }
    }

}

export default Utils;
