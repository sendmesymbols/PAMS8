import Point from "@arcgis/core/geometry/Point";
/**
 * Shapes utility class for creating various geometric shapes and paths
 * TypeScript version for ArcGIS API 4.x
 */
declare class Shapes {
    /**
     * Create Bezier path from point collection only (without TweenMax dependency)
     * This is a simplified version that creates a smooth curve through points
     */
    static CreateBezierPathPCOnly(pointCollection: Array<{
        x: number;
        y: number;
    }>, numberOfPts: number): Array<{
        x: number;
        y: number;
    }>;
    /**
     * Linear interpolation between two points
     */
    private static linearInterpolation;
    /**
     * Catmull-Rom spline interpolation for smooth curves
     */
    private static catmullRomSpline;
    /**
     * Calculate a single point on Catmull-Rom spline
     */
    private static catmullRomPoint;
    /**
     * Create a circle of points
     */
    static createCircle(pt: Point, radius: number, steps: number): Point[];
    /**
     * Create a half circle of points
     */
    static createHalfCircle(pt: Point, radius: number, thetaStart: number, thetaEnd: number, steps: number): Point[];
    /**
     * Create arrow head path
     */
    static arrowHead(candidatePoint: Point, length: number, angle: number): Point[];
    /**
     * Rotate an array of points around a center point
     */
    static rotate(pointArray: Array<{
        x: number;
        y: number;
    }>, centerX: number, centerY: number, rotateAngle: number): Array<{
        x: number;
        y: number;
    }>;
}
export default Shapes;
