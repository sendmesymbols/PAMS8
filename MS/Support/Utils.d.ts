import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import Polyline from "@arcgis/core/geometry/Polyline";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
declare class Utils {
    static getMidPoint(pt1: Point, pt2: Point, spatialReference: SpatialReference): Point;
    static calculateDistance(pt1: Point | {
        x: number;
        y: number;
    }, pt2: Point | {
        x: number;
        y: number;
    }): number;
    static calculateAngle(fromPt: Point | {
        x: number;
        y: number;
    }, toPt: Point | {
        x: number;
        y: number;
    }): number;
    static getTwoPointsRelationship(pt1: Point | {
        x: number;
        y: number;
    }, pt2: Point | {
        x: number;
        y: number;
    }): string;
    /**
     * Create Bezier path from points
     * Note: This is a simplified implementation without TweenMax
     */
    static createBezierPath(pointCollection: {
        x: number;
        y: number;
    }[], numberOfPts: number, spatialReference: SpatialReference, isPloyLine: Boolean): Polygon | Polyline;
}
export default Utils;
