import Polyline from "@arcgis/core/geometry/Polyline";
import Point from "@arcgis/core/geometry/Point";
import Extent from "@arcgis/core/geometry/Extent";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
/**
 * GeoTools utility module for common geometric calculations and operations
 * Updated for ArcGIS API for JavaScript 4.x
 */
export declare class GeoTools {
    static readonly factors: {
        centimeters: number;
        centimetres: number;
        degrees: number;
        feet: number;
        inches: number;
        kilometers: number;
        kilometres: number;
        meters: number;
        metres: number;
        miles: number;
        millimeters: number;
        millimetres: number;
        nauticalmiles: number;
        radians: number;
        yards: number;
    };
    /**
     * Calculate angle in radians between two points
     */
    static angleInRadians(pt1: Point, pt2: Point): number;
    /**
     * Calculate angle in degrees between two points
     */
    static angleInDegrees(pt1: Point, pt2: Point): number;
    /**
     * Calculate two points angle
     */
    static twoPtsAngle(pt1: Point, pt2: Point): number;
    /**
     * Convert radians to degrees
     */
    static toDegrees(rad: number): string;
    /**
     * Convert degrees to radians
     */
    static toRad(deg: number): number;
    /**
     * Convert degrees to radians
     */
    static degreesToRadians(degrees: number): number;
    /**
     * Convert radians to degrees
     */
    static radiansToDegrees(radians: number): number;
    /**
     * Display a point on the map for debugging
     */
    static displayPoint(view: MapView | SceneView, pt: Point): void;
    /**
     * Display a Polyline on the map for debugging
     */
    static displayPolyline(view: MapView | SceneView, polyline: Polyline): void;
    /**
     * Display a point with text label
     */
    static displayPointText(view: MapView | SceneView, pt: Point, text: string): void;
    /**
     * Get midpoint between two points
     */
    static getMidPoint(p1: Point, p2: Point): Point;
    /**
     * Calculate midpoint using formula
     */
    static _calculateMidPoint(pt1: Point, pt2: Point): Point;
    /**
     * Set default value for object property
     */
    static setDefault(object: any, property: string, defaults: any): any;
    /**
     * Calculate destination point given origin, distance, bearing, and units
     */
    static destination(origin: Point, distance: number, bearing: number, units: string): Point;
    /**
     * Convert distance to radians
     */
    static distanceToRadians(distance: number, units: string): number;
    /**
     * Convert radians to length
     */
    static radiansToLength(radians: number, units: string): number;
    /**
     * Calculate distance between two points
     */
    static distance(from: Point, to: Point, unit: string): number;
    /**
     * Calculate bearing between two points
     */
    static bearing(start: Point, end: Point, final?: boolean): number;
    /**
     * Calculate final bearing
     */
    static calculateFinalBearing(start: Point, end: Point): number;
    /**
     * Calculate distance between two points (simple Euclidean)
     */
    static _2PtLen(pt1: Point, pt2: Point): number;
    /**
     * Determine relationship between two points (quadrant)
     */
    static twoPtsRelationShip(pt1: Point, pt2: Point): string;
    /**
     * Get area from extent
     */
    static getArea(extent?: Extent): number;
    /**
     * Translate geometry to new position
     */
    static translateGeometry(geometry: any, newPos: Point): any;
    /**
     * Translate array of points
     */
    static translatePts(pts: Point[], center: Point, newPos: Point): Point[];
    /**
     * Move a point from old center to new center
     */
    static movePt(pt: Point, oldCenter: Point, newCenter: Point): Point;
    /**
     * Create dashed line between two points
     */
    static dashedLine(pt1: Point, pt2: Point, dashArray?: number[]): Point[];
    /**
     * Create half circle points
     */
    static createHalfCircle(pt: Point, radius: number, thetaStart: number, thetaEnd: number, steps: number): Point[];
    /**
     * Generate random points around a center
     */
    static generateRandomPoints(center: Point, radius: number, count: number): Point[];
    /**
     * Generate a single random point around a center
     */
    static generateRandomPoint(center: Point, radius: number): Point;
    /**
     * Fracture line between two points with gap
     */
    static _fracturePts(startPt: Point, endPoint: Point, gapLen: number, spatialReference: SpatialReference): any;
    /**
     * Get centroid of points
     */
    static getCenteroid(pts: Point[], option: number): Point;
    /**
     * Calculate vertex angles for a point collection
     */
    static _vertexAngle(ptc: Array<{
        x: number;
        y: number;
    }>): number[];
    /**
     * Calculate total length of point collection from start index
     */
    static _ptCollectionLen(ptc: Array<{
        x: number;
        y: number;
    }>, startIndex: number): number;
}
export default GeoTools;
