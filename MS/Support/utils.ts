import Point from "@arcgis/core/geometry/Point";
import Polygon from "@arcgis/core/geometry/Polygon";
import Polyline from "@arcgis/core/geometry/Polyline";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";

class Utils {
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

    /**
     * Create Bezier path from points
     * Note: This is a simplified implementation without TweenMax
     */
    static createBezierPath(pointCollection: { x: number, y: number }[], numberOfPts: number, spatialReference:SpatialReference, isPloyLine: Boolean): Polygon | Polyline {

        var position = { x: pointCollection[0].x, y: pointCollection[0].y };
        if (pointCollection[pointCollection.length - 1].x === pointCollection[pointCollection.length - 2].x && pointCollection[pointCollection.length - 1].y === pointCollection[pointCollection.length - 2].y) {
            pointCollection.pop();
        }
        if (pointCollection[pointCollection.length - 1].x === pointCollection[pointCollection.length - 2].x && pointCollection[pointCollection.length - 1].y === pointCollection[pointCollection.length - 2].y) {
            pointCollection.pop();
        }
        var tween = window.TweenMax.to(position, numberOfPts, { bezier: pointCollection, ease: window.Linear.easeNone });
        //ease:Power1.easeInOut  ease: Linear.easeNone
        var path = [];
        var i;
        for (i = 0; i <= numberOfPts; i++) {
            tween.time(i);
            path.push([position.x, position.y]);
        }
        if(isPloyLine) {
            var result:Polyline = new Polyline({"spatialReference": spatialReference});
            console.log("Polyline");
            result.addPath(path);
        } else {
            var result:Polygon = new Polygon({"spatialReference": spatialReference});
            console.log("Polygon");
            result.addRing(path);
        }

        return result;
    }

}

export default Utils;