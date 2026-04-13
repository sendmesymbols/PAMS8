import Polyline from "@arcgis/core/geometry/Polyline";
import Point from "@arcgis/core/geometry/Point";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
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
declare class Shapes {
    /**
    * Create a C shape
    */
    static createC(pt: Point, radius: number, steps: number): Point[];
    /**
     * Create ellipse
     */
    static createEllipse(options: {
        center: Point;
        longAxis: number;
        shortAxis: number;
        numberOfPoints: number;
        spatialReference: SpatialReference;
    }): Point[];
    /**
     * Create circle segment polygon from three points using a precomputed circle (screen-space) and convert back to map-space
     */
    static createCircleSegmentFromThreePoints(view: MapView | SceneView, circle: {
        radius: number;
        center: {
            x: number;
            y: number;
        };
    }, pt1: any, pt2: any, pt3: any, numberOfPts: number): {
        geometry: Polyline;
        lastPoint: Point;
        backPoint: Point;
    };
    /**
     * Create circle
     */
    static createCircle(pt: Point, radius: number, steps: number): Point[];
    /**
     * Create half circle
     */
    static createHalfCircle(pt: Point, radius: number, thetaStart: number, thetaEnd: number, steps: number): Point[];
    /**
     * Create FLOT half circle
     */
    static createFLOTHalfCircle(pt: Point, angle: number, radius: number): Point[];
    /**
     * Create B shape
     */
    static createB(pt: Point, radius: number, steps: number): Point[];
    /**
     * Create ALD text
     */
    static createALD(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Create letter A
     */
    static createA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    /**
     * Create letter A as separate strokes to avoid auto-closing
     */
    static createAStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Create letter L
     */
    static createL(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    /**
     * Create letter D
     */
    static createD(pt: Point, radius: number, steps: number): Point[];
    /**
     * Create letter DD (alternative D implementation)
     */
    static createDD(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    /**
     * Create letter H
     */
    static createH(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    /**
     * Create letter T
     */
    static createT(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    /**
     * Create letter J
     */
    static createJ(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    /**
     * Create letter C (CC version)
     */
    static createCC(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    /**
     * Create letter G
     */
    static createG(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    /**
     * Create letter K
     */
    static createK(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    /**
     * Create letter S
     */
    static createS(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    /**
     * Create letter S as separate strokes to avoid auto-closing
     */
    static createSStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Create letter O
     */
    static createO(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    /**
     * Create letter I
     */
    static createI(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    /**
     * Create letter X
     */
    static createX(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    /**
     * Create letter W
     */
    static createW(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    /**
     * Create letter V
     */
    static createV(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    /**
     * Create letter P (PP version)
     */
    static createPP(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    /**
     * Create letter E
     */
    static createE(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    /**
     * Create letter F
     */
    static createF(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    /**
     * Create letter F as separate strokes to avoid auto-closing
     */
    static createFStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Create letter N
     */
    static createN(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    /**
     * Create letter U
     */
    static createU(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    /**
     * Create letter U as separate strokes to avoid auto-closing
     */
    static createUStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Create letter P as separate strokes to avoid auto-closing
     */
    static createPStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Create letter Y
     */
    static createY(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    /**
     * Create letter Z
     */
    static createZ(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    /**
     * Create letter R
     */
    static createR(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    static createAA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createAO(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createUA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createNAI(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createTAI(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createZOR(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createZORStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createZStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createOStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createRStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createDStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createZORRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][];
    static createFAA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createTStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createKStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createIStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createTAIStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createNStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createNAIStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createNAIRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][];
    static createVStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createVAStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createVARings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][];
    static createVA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Convert a line segment to a thin rectangle ring (closed) of given stroke width
     */
    static createStrokedRectRing(p1: Point, p2: Point, strokeWidth: number): number[][];
    /**
     * Create closed polygon rings for TAI text using thin rectangles per stroke
     */
    static createTAIRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][];
    static createFUP(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Create FUP text using stroke-based approach to avoid auto-closing in ArcGIS API 4.33+
     */
    static createFUPStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createDAA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createOBJ(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createSAA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createDA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createCAA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createCStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createCAAStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createCAARings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][];
    static createBAA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createACP(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createPL(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createSL(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createKG(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createKGStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createGStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createKGRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][];
    static createKZ(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createKZStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createKZRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][];
    static createLZ(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createLStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createLZStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createLZRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][];
    static createVG(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createVGStrokes(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createVGRings(dx: number, dy: number, dr: number, sp: SpatialReference): number[][][];
    static createBL(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createDLNP(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createLNP(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createCLD(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createBHOL(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createWP(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createENY(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static CATK(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createDash(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    /**
     * Create arrow head geometry
     */
    static createArrowHead(pts: Point[]): number[][] | null;
    /**
     * Create simple arrow head as fallback
     */
    static createSimpleArrowHead(tip: Point, base: Point, arrowLength: number): number[][];
    /**
     * Create backward arrow head
     */
    static arrowHeadBackward(candidatePoint: Point, length: number, angle: number): Point[];
    /**
     * Create forward arrow head
     */
    static arrowHead(candidatePoint: Point, length: number, angle: number): Point[];
    /**
     * Create extended arrow head path
     */
    static CreateArrowHeadPathEx(pt1: Point | PointLike, candidatePt: Point, pt2: Point | PointLike, totalLen: number, headPercentage: number, headAngle: number, straight?: boolean): PointLike[];
    static CreateBezierPathPCOnly(pointCollection: {
        x: number;
        y: number;
    }[], numberOfPts: number): {
        x: number;
        y: number;
    }[];
    static createEllipsePath(center: {
        x: number;
        y: number;
    }, width: number, height: number, numberOfPoints: number): number[][];
    static getClosestPointOnLinesFromPairs(pXy: {
        x: number;
        y: number;
    }, aXys: number[][]): {
        x: number;
        y: number;
        index: number;
        fTo: number;
        fFrom: number;
    };
    static getClosestPointOnLinesFromPoints(pXy: {
        x: number;
        y: number;
    }, aXys: {
        x: number;
        y: number;
    }[]): {
        x: number;
        y: number;
        index: number;
        fTo: number;
        fFrom: number;
    };
    /**
     * Rotation utility methods
     */
    static ownRotate(pointArray: Point[], centerX: number, centerY: number, rotateAngle: number): Point[];
    static rotate(pointArray: Point[], centerX: number, centerY: number, rotateAngle: number): Point[];
    /**
     * Create echelon (Note: This requires the Echelons module)
     */
    static createEchelon(ech: string, pt: Point, radius: number, angle?: number): Point[] | Point[][];
    /**
     * Create Bezier path from points
     * Note: This requires TweenMax library which may not be available in 4.x
     */
    static createBezierPath(points: {
        x: number;
        y: number;
    }[], numberOfPts: number, sp: SpatialReference): Polyline;
    private static toDegrees;
    private static toRad;
    private static twoPtsAngle;
    /**
     * Create Bezier curve symbol
     */
    static createSymbolByBCurve(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials, spatialReference: SpatialReference): Polyline | Polygon;
    /**
     * Create polygon symbol
     */
    static createSymbolByPolygon(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials, spatialReference: SpatialReference): Polygon;
    /**
     * Create rectangle symbol
     */
    static createSymbolByRect(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials, spatialReference: SpatialReference): Polygon;
    /**
     * Create perfect ellipse symbol
     */
    static createSymbolByPerfectEllipse(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials, view: any): Polygon;
    /**
     * Create simple ellipse as fallback
     */
    static createSimpleEllipse(centerPoint: Point, radiusPoint: Point, spatialReference: SpatialReference): Polygon;
    static createPolylineByLine(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials, spatialReference: SpatialReference): Polyline;
    static createPolylineByCloseLine(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials, spatialReference: SpatialReference, faceGapConst: number): Polyline;
    static createPolylineByPerfectEllipse(pts: Point[], firstPoint: Point, lastPoint: Point, drawEssentials: DrawEssentials, spatialReference: SpatialReference, faceGapConstEllipse: number): Polyline;
}
export default Shapes;
