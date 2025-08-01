import Point from "@arcgis/core/geometry/Point";
declare class Utils {
    static calculateDistance(pt1: Point, pt2: Point): number;
    static calculateAngle(fromPt: Point, toPt: Point): number;
}
export default Utils;
