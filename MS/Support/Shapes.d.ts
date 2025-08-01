import Polyline from "@arcgis/core/geometry/Polyline";
import Point from "@arcgis/core/geometry/Point";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
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
    static createG(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    /**
     * Create letter K
     */
    static createK(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    /**
     * Create letter S
     */
    static createS(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
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
     * Create letter N
     */
    static createN(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
    /**
     * Create letter U
     */
    static createU(dx: number, dy: number, dr: number, sp: SpatialReference): Point[];
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
    static createFAA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createFUP(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createDAA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createOBJ(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createSAA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createDA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createCAA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createBAA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createACP(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createPL(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createSL(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createKG(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createKZ(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createLZ(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createVG(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
    static createVA(dx: number, dy: number, dr: number, sp: SpatialReference): Point[][];
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
     * Create arrow head
     */
    static arrowHead(candidatePoint: Point, length: number, angle: number): Point[];
    /**
     * Create backward arrow head
     */
    static arrowHeadBackward(candidatePoint: Point, length: number, angle: number): Point[];
    /**
     * Create extended arrow head path
     */
    static CreateArrowHeadPathEx(pt1: Point, candidatePt: Point, pt2: Point, totalLen: number, headPercentage: number, headAngle: number, straight?: boolean): PointLike[];
    static CreateBezierPathPCOnly(pointCollection: Point[], numberOfPts: number): Point[];
    /**
     * Rotation utility methods
     */
    static ownRotate(pointArray: Point[], centerX: number, centerY: number, rotateAngle: number): Point[];
    static rotate(pointArray: Point[], centerX: number, centerY: number, rotateAngle: number): Point[];
    /**
     * Create echelon (Note: This requires the Echelons module)
     */
    static createEchelon(ech: string, pt: Point, radius: number, angle?: number): Point[];
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
}
export default Shapes;
