import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import GeoTools from "./GeoTools.ts";

/**
 * Shapes utility class for creating various geometric shapes and paths
 * TypeScript version for ArcGIS API 4.x
 */
class Shapes {
    
    /**
     * Create Bezier path from point collection only (without TweenMax dependency)
     * This is a simplified version that creates a smooth curve through points
     */
    static CreateBezierPathPCOnly(pointCollection: Array<{ x: number, y: number }>, numberOfPts: number): Array<{ x: number, y: number }> {
        if (pointCollection.length < 2) {
            return pointCollection;
        }

        // Remove duplicate consecutive points
        const filteredPoints = pointCollection.filter((point, index) => {
            if (index === 0) return true;
            const prevPoint = pointCollection[index - 1];
            return !(point.x === prevPoint.x && point.y === prevPoint.y);
        });

        if (filteredPoints.length < 2) {
            return filteredPoints;
        }

        if (filteredPoints.length === 2) {
            // For 2 points, create a simple interpolation
            return this.linearInterpolation(filteredPoints[0], filteredPoints[1], numberOfPts);
        }

        // For more than 2 points, create a smooth curve using Catmull-Rom spline
        return this.catmullRomSpline(filteredPoints, numberOfPts);
    }

    /**
     * Linear interpolation between two points
     */
    private static linearInterpolation(start: { x: number, y: number }, end: { x: number, y: number }, steps: number): Array<{ x: number, y: number }> {
        const result: Array<{ x: number, y: number }> = [];
        
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            result.push({
                x: start.x + (end.x - start.x) * t,
                y: start.y + (end.y - start.y) * t
            });
        }
        
        return result;
    }

    /**
     * Catmull-Rom spline interpolation for smooth curves
     */
    private static catmullRomSpline(points: Array<{ x: number, y: number }>, numberOfPts: number): Array<{ x: number, y: number }> {
        const result: Array<{ x: number, y: number }> = [];
        
        // Add the first point
        result.push({ x: points[0].x, y: points[0].y });

        // For each segment between consecutive points
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = i > 0 ? points[i - 1] : points[i];
            const p1 = points[i];
            const p2 = points[i + 1];
            const p3 = i < points.length - 2 ? points[i + 2] : points[i + 1];

            const segmentSteps = Math.floor(numberOfPts / (points.length - 1));
            
            for (let j = 1; j <= segmentSteps && result.length < numberOfPts; j++) {
                const t = j / segmentSteps;
                const point = this.catmullRomPoint(p0, p1, p2, p3, t);
                result.push(point);
            }
        }

        // Ensure we have the exact number of points requested
        while (result.length < numberOfPts + 1) {
            result.push({ x: points[points.length - 1].x, y: points[points.length - 1].y });
        }

        return result.slice(0, numberOfPts + 1);
    }

    /**
     * Calculate a single point on Catmull-Rom spline
     */
    private static catmullRomPoint(
        p0: { x: number, y: number }, 
        p1: { x: number, y: number }, 
        p2: { x: number, y: number }, 
        p3: { x: number, y: number }, 
        t: number
    ): { x: number, y: number } {
        const t2 = t * t;
        const t3 = t2 * t;

        const x = 0.5 * (
            (2 * p1.x) +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
        );

        const y = 0.5 * (
            (2 * p1.y) +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
        );

        return { x, y };
    }

    /**
     * Create a circle of points
     */
    static createCircle(pt: Point, radius: number, steps: number): Point[] {
        const pts: Point[] = [];
        const step = 2 * Math.PI / steps;
        const xh = pt.x;
        const yk = pt.y;
        
        for (let theta = 0; theta < 2 * Math.PI; theta += step) {
            const x = xh + radius * Math.cos(theta);
            const y = yk - radius * Math.sin(theta);
            pts.push(new Point({ x, y, spatialReference: pt.spatialReference }));
        }
        
        return pts;
    }

    /**
     * Create a half circle of points
     */
    static createHalfCircle(pt: Point, radius: number, thetaStart: number, thetaEnd: number, steps: number): Point[] {
        const pts: Point[] = [];
        const step = 2 * Math.PI / steps;
        const xh = pt.x;
        const yk = pt.y;

        for (let theta = thetaStart; theta < 2 * Math.PI + thetaEnd; theta += step) {
            const x = xh + radius * Math.cos(theta);
            const y = yk - radius * Math.sin(theta);
            pts.push(new Point({ x, y, spatialReference: pt.spatialReference }));
        }
        return pts;
    }

    /**
     * Create arrow head path
     */
    static arrowHead(candidatePoint: Point, length: number, angle: number): Point[] {
        const path: Point[] = [];

        angle += 15;
        const angle1 = GeoTools.toDegrees(angle); // In Degrees
        angle -= 30;
        const angle2 = GeoTools.toDegrees(angle);

        const rightWing = new Point({
            x: candidatePoint.x + length * Math.cos(GeoTools.toRad(angle1)),
            y: candidatePoint.y + length * Math.sin(GeoTools.toRad(angle1)),
            spatialReference: candidatePoint.spatialReference
        });

        const leftWing = new Point({
            x: candidatePoint.x + length * Math.cos(GeoTools.toRad(angle2)),
            y: candidatePoint.y + length * Math.sin(GeoTools.toRad(angle2)),
            spatialReference: candidatePoint.spatialReference
        });

        path.push(rightWing, candidatePoint, leftWing);
        return path;
    }

    /**
     * Rotate an array of points around a center point
     */
    static rotate(pointArray: Array<{ x: number, y: number }>, centerX: number, centerY: number, rotateAngle: number): Array<{ x: number, y: number }> {
        const result = [...pointArray];

        for (let i = 0; i < result.length; i++) {
            // Translate to origin
            result[i].x -= centerX;
            result[i].y -= centerY;

            // Rotate
            const tX = result[i].x;
            const tY = result[i].y;
            result[i].x = tX * Math.cos(rotateAngle) - tY * Math.sin(rotateAngle);
            result[i].y = tX * Math.sin(rotateAngle) + tY * Math.cos(rotateAngle);

            // Translate back
            result[i].x += centerX;
            result[i].y += centerY;
        }

        return result;
    }
}

export default Shapes; 