import Polyline from "@arcgis/core/geometry/Polyline";
import Point from "@arcgis/core/geometry/Point";
import * as webMercatorUtils from "@arcgis/core/geometry/support/webMercatorUtils";
import Polygon from "@arcgis/core/geometry/Polygon";
import Circle from "@arcgis/core/geometry/Circle";
import Extent from "@arcgis/core/geometry/Extent";
import Multipoint from "@arcgis/core/geometry/Multipoint";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import TextSymbol from "@arcgis/core/symbols/TextSymbol";
import Color from "@arcgis/core/Color";
import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import * as geometryEngine from "@arcgis/core/geometry/geometryEngine";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";

/** Structural point shape — anything with .x and .y. Accepts Point and plain {x,y} objects. */
export type PtLike = { x: number; y: number; spatialReference?: SpatialReference };

/**
 * GeoTools utility module for common geometric calculations and operations
 * Updated for ArcGIS API for JavaScript 4.x
 */
export class GeoTools {
    // Distance conversion factors
    static readonly factors = {
        centimeters: 6371008.8 * 100,
        centimetres: 6371008.8 * 100,
        degrees: 6371008.8 / 111325,
        feet: 6371008.8 * 3.28084,
        inches: 6371008.8 * 39.370,
        kilometers: 6371008.8 / 1000,
        kilometres: 6371008.8 / 1000,
        meters: 6371008.8,
        metres: 6371008.8,
        miles: 6371008.8 / 1609.344,
        millimeters: 6371008.8 * 1000,
        millimetres: 6371008.8 * 1000,
        nauticalmiles: 6371008.8 / 1852,
        radians: 1,
        yards: 6371008.8 / 1.0936
    };

    /**
     * Calculate angle in radians between two points
     */
    static angleInRadians(pt1: Point, pt2: Point): number {
        return Math.atan2(pt2.y - pt1.y, pt2.x - pt1.x);
    }

    /**
     * Calculate angle in degrees between two points
     */
    static angleInDegrees(pt1: Point, pt2: Point): number {
        return Math.atan2(pt2.y - pt1.y, pt2.x - pt1.x) * 180 / Math.PI;
    }

    /**
     * Calculate two points angle
     */
    static twoPtsAngle(pt1: PtLike, pt2: PtLike): number {
        const angle = Math.acos((pt2.x - pt1.x) / this._2PtLen(pt1, pt2));
        if (pt2.y < pt1.y) {
            return 2 * Math.PI - angle;
        }
        return isNaN(angle) === true ? 0 : angle;
    }

    /**
     * Convert radians to degrees
     */
    static toDegrees(rad: number): string {
        const angleDeg = rad * (180 / Math.PI);
        const result = ((angleDeg + 360) % 360).toFixed(1);
        return isNaN(Number(result)) ? "0" : result;
    }

    /**
     * Convert degrees to radians
     */
    static toRad(deg: number): number {
        return deg * (Math.PI / 180);
    }

    /**
     * Convert degrees to radians
     */
    static degreesToRadians(degrees: number): number {
        const radians = degrees % 360;
        return radians * Math.PI / 180;
    }

    /**
     * Convert radians to degrees
     */
    static radiansToDegrees(radians: number): number {
        const degrees = radians % (2 * Math.PI);
        return degrees * 180 / Math.PI;
    }

    /**
     * Display a point on the map for debugging
     */
    static displayPoint(view: MapView | SceneView, pt: Point): void {
        const markerSymbol = new SimpleMarkerSymbol();
        const graphic = new Graphic({
            geometry: new Point({ x: pt.x, y: pt.y, spatialReference: view.spatialReference }),
            symbol: markerSymbol
        });
        (view as any).graphics?.add(graphic);
    }

    /**
     * Display a Polyline on the map for debugging
     */
    static displayPolyline(view: MapView | SceneView, polyline: Polyline): void {
        const lineSymbol = new SimpleLineSymbol({
            color: [0, 0, 255, 0.8], // Blue, semi-transparent
            width: 2
        });

        const graphic = new Graphic({
            geometry: polyline,
            symbol: lineSymbol
        });

        (view as any).graphics?.add(graphic);
    }

    /**
     * Display a point with text label
     */
    static displayPointText(view: MapView | SceneView, pt: Point, text: string): void {
        const textSymbol = new TextSymbol({ text });
        const textGraphic = new Graphic({
            geometry: new Point({ x: pt.x, y: pt.y, spatialReference: view.spatialReference }),
            symbol: textSymbol
        });
        
        const markerSymbol = new SimpleMarkerSymbol({
            style: "cross",
            size: 10,
            outline: new SimpleLineSymbol({
                style: "solid",
                color: new Color([255, 0, 0]),
                width: 1
            }),
            color: new Color([0, 255, 0])
        });
        
        const markerGraphic = new Graphic({
            geometry: new Point({ x: pt.x, y: pt.y, spatialReference: view.spatialReference }),
            symbol: markerSymbol
        });

        (view as any).graphics?.add(textGraphic);
        (view as any).graphics?.add(markerGraphic);
    }

    /**
     * Get midpoint between two points
     */
    static getMidPoint(p1: Point, p2: Point): Point {
        const polyline = new Polyline({
            paths: [[[p1.x, p1.y], [p2.x, p2.y]]],
            spatialReference: p1.spatialReference
        });
        return polyline.extent?.center || this._calculateMidPoint(p1, p2);
    }

    /**
     * Calculate midpoint using formula
     */
    static _calculateMidPoint(pt1: Point, pt2: Point): Point {
        const x = (pt1.x + pt2.x) / 2;
        const y = (pt1.y + pt2.y) / 2;
        return new Point({ x, y, spatialReference: pt1.spatialReference });
    }

    /**
     * Set default value for object property
     */
    static setDefault(object: any, property: string, defaults: any): any {
        const res = object.hasOwnProperty(property) ? object[property] : defaults;
        return res === undefined ? defaults : res;
    }

    /**
     * Calculate destination point given origin, distance, bearing, and units
     */
    static destination(origin: Point, distance: number, bearing: number, units: string): Point {
        const degrees2radians = Math.PI / 180;
        const radians2degrees = 180 / Math.PI;

        // The haversine formula works in geographic (lon/lat) degrees.
        // If the origin is in a projected SR (e.g. Web Mercator), convert to WGS-84 first.
        const originalSR = origin.spatialReference;
        const isProjected = originalSR && !originalSR.isGeographic;
        const geoOrigin = isProjected
            ? (webMercatorUtils.webMercatorToGeographic(origin) as Point)
            : origin;

        const longitude1 = degrees2radians * geoOrigin.x;
        const latitude1  = degrees2radians * geoOrigin.y;
        const bearing_rad = degrees2radians * bearing;
        const radians = this.distanceToRadians(distance, units);

        const latitude2 = Math.asin(Math.sin(latitude1) * Math.cos(radians) +
            Math.cos(latitude1) * Math.sin(radians) * Math.cos(bearing_rad));
        const longitude2 = longitude1 + Math.atan2(Math.sin(bearing_rad) * Math.sin(radians) * Math.cos(latitude1),
            Math.cos(radians) - Math.sin(latitude1) * Math.sin(latitude2));

        const geoResult = new Point({
            x: radians2degrees * longitude2,
            y: radians2degrees * latitude2,
            spatialReference: { wkid: 4326 }
        });

        // Convert result back to the original projected SR if needed
        return isProjected
            ? (webMercatorUtils.geographicToWebMercator(geoResult) as Point)
            : geoResult;
    }

    /**
     * Convert distance to radians
     */
    static distanceToRadians(distance: number, units: string): number {
        if (distance === undefined || distance === null) {
            throw new Error('Distance is Required');
        }
        if (units && typeof units !== 'string') {
            throw new Error('Units must be a string');
        }
        const factor = this.factors[units as keyof typeof this.factors] || this.factors.kilometers;
        if (!factor) {
            throw new Error(units + ' units is invalid');
        }
        return distance / factor;
    }

    /**
     * Convert radians to length
     */
    static radiansToLength(radians: number, units: string): number {
        const factor = this.factors[units as keyof typeof this.factors];
        if (!factor) {
            throw new Error(units + " units is invalid");
        }
        return radians * factor;
    }

        /**
         * Calculate distance between two points
         */
        static distance(from: Point, to: Point, unit: string): number {
            const gFrom = this._toGeographic(from);
            const gTo = this._toGeographic(to);
            const dLat = this.degreesToRadians(gTo.y - gFrom.y);
            const dLon = this.degreesToRadians(gTo.x - gFrom.x);
            const lat1 = this.degreesToRadians(gFrom.y);
            const lat2 = this.degreesToRadians(gTo.y);
            const a = Math.pow(Math.sin(dLat / 2), 2) + Math.pow(Math.sin(dLon / 2), 2) * Math.cos(lat1) * Math.cos(lat2);
            return this.radiansToLength(2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)), unit);
        }

    /**
     * Generate dashed points for a line
     */
    static getDashPts(pts: PtLike[], dashArray: number[]): Point[] {
        const result: Point[] = [];

        for (let j = 0; j < pts.length - 1; j++) {
            const p1 = pts[j];
            const p2 = pts[j + 1];
            result.push(...this.dashes(p1.x, p1.y, p2.x, p2.y, dashArray, p1.spatialReference as SpatialReference));
        }

        return result;
    }

    /**
     * Create dashed points between two coordinates
     */
    static dashes(x: number, y: number, x2: number, y2: number, dashArray: number[], spatialReference: SpatialReference): Point[] {
        const points: Point[] = [];
        const dashArrayFinal = dashArray.length ? dashArray : [10, 5];
        const dashLength = dashArrayFinal[0] === 0 ? 0.001 : dashArrayFinal[0];

        points.push(new Point({ x, y, spatialReference }));
        const dx = x2 - x;
        const dy = y2 - y;
        const slope = dx ? dy / dx : 1e15;
        let distRemaining = Math.sqrt(dx * dx + dy * dy);
        let dashIndex = 0;
        let draw = true;

        let currentDashLength = dashArrayFinal[dashIndex++ % dashArrayFinal.length];

        while (distRemaining > currentDashLength) {
            if (currentDashLength > distRemaining) {
                currentDashLength = distRemaining;
            }
            const xStep = Math.sqrt(currentDashLength * currentDashLength / (1 + slope * slope));
            const xIncrement = dx < 0 ? -xStep : xStep;
            x += xIncrement;
            y += slope * xIncrement;
            points.push(new Point({ x, y, spatialReference }));
            distRemaining -= currentDashLength;
            draw = !draw;
            currentDashLength = dashArrayFinal[dashIndex++ % dashArrayFinal.length];
        }

        // The loop stops one partial dash short of the endpoint; push a terminal
        // point so the dashed line actually reaches (x2, y2) instead of leaving a gap.
        if (distRemaining > 1e-9) {
            points.push(new Point({ x: x2, y: y2, spatialReference }));
        }

        return points;
    }


    /**
     * Calculate bearing between two points
     */
    /**
     * Convert a point to geographic (lon/lat) degrees when it is in a projected
     * spatial reference (e.g. Web Mercator). The great-circle formulas in
     * bearing()/distance() assume degrees, so a projected point fed in raw
     * (metres) produces a meaningless result. Mirrors the guard in destination().
     */
    private static _toGeographic(p: Point): Point {
        const sr = p.spatialReference;
        return sr && !sr.isGeographic
            ? (webMercatorUtils.webMercatorToGeographic(p) as Point)
            : p;
    }

    static bearing(start: Point, end: Point, final?: boolean): number {
        if (final === true) {
            return this.calculateFinalBearing(start, end);
        }

        const gStart = this._toGeographic(start);
        const gEnd = this._toGeographic(end);
        const lon1 = this.degreesToRadians(gStart.x);
        const lon2 = this.degreesToRadians(gEnd.x);
        const lat1 = this.degreesToRadians(gStart.y);
        const lat2 = this.degreesToRadians(gEnd.y);

        const a = Math.sin(lon2 - lon1) * Math.cos(lat2);
        const b = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);

        // atan2 returns [-180,180]; normalize to a 0-360 compass azimuth.
        return (this.radiansToDegrees(Math.atan2(a, b)) + 360) % 360;
    }

    /**
     * Calculate final bearing
     */
    static calculateFinalBearing(start: Point, end: Point): number {
        let bear = this.bearing(end, start);
        bear = (bear + 180) % 360;
        return bear;
    }

    /**
     * Calculate distance between two points (simple Euclidean)
     */
    static _2PtLen(pt1: PtLike, pt2: PtLike): number {
        if (pt1 !== undefined && pt2 !== undefined) {
            return Math.sqrt((pt1.x - pt2.x) * (pt1.x - pt2.x) + (pt1.y - pt2.y) * (pt1.y - pt2.y));
        }
        return 0;
    }

    /** Legacy alias used by ObstacleBypassEasy / min bundles - Euclidean distance between two points. */
    static B(pt1: PtLike, pt2: PtLike): number {
        return this._2PtLen(pt1, pt2);
    }

    /** Legacy alias used by CounterAttack min bundles - Euclidean distance between two points. */
    static k(pt1: Point, pt2: Point): number {
        return this._2PtLen(pt1, pt2);
    }

    /** Legacy alias used by BaseLine / min bundles - Euclidean distance between two points. */
    static R(pt1: Point, pt2: Point): number {
        return this._2PtLen(pt1, pt2);
    }

    /**
     * Determine relationship between two points (quadrant)
     */
    static twoPtsRelationShip(pt1: Point, pt2: Point): string {
        if (pt2.x > pt1.x && pt2.y >= pt1.y) return "ne";
        else if (pt2.x <= pt1.x && pt2.y > pt1.y) return "nw";
        else if (pt2.x < pt1.x && pt2.y <= pt1.y) return "sw";
        else return "se";
    }

    /**
     * Get area from extent
     */
    static getArea(extent?: Extent): number {
        if (extent !== undefined) {
            return extent.width * extent.height;
        }
        return 0;
    }

    /**
     * Translate geometry to new position
     */
    static translateGeometry(geometry: any, newPos: Point): any {
        let center: Point;
        let x: number, y: number;

        if (geometry.type === 'polyline') {
            const p = new Polygon({ rings: geometry.paths, spatialReference: geometry.spatialReference });
            center = p.extent?.center || new Point({ x: 0, y: 0, spatialReference: geometry.spatialReference });
            for (let i = 0; i < geometry.paths.length; i++) {
                for (let j = 0; j < geometry.paths[i].length; j++) {
                    x = geometry.paths[i][j][0] - center.x;
                    y = geometry.paths[i][j][1] - center.y;
                    geometry.paths[i][j][0] = newPos.x + x;
                    geometry.paths[i][j][1] = newPos.y + y;
                }
            }
        } else if (geometry.type === 'polygon') {
            const p = new Polygon({ rings: geometry.rings, spatialReference: geometry.spatialReference });
            center = p.extent?.center || new Point({ x: 0, y: 0, spatialReference: geometry.spatialReference });
            for (let i = 0; i < geometry.rings.length; i++) {
                for (let j = 0; j < geometry.rings[i].length; j++) {
                    x = geometry.rings[i][j][0] - center.x;
                    y = geometry.rings[i][j][1] - center.y;
                    geometry.rings[i][j][0] = newPos.x + x;
                    geometry.rings[i][j][1] = newPos.y + y;
                }
            }
        } else if (geometry.type === 'point') {
            center = geometry;
            geometry = this.translatePts([geometry], center, newPos)[0];
        }

        return geometry;
    }

    /**
     * Translate array of points
     */
    static translatePts(pts: Point[], center: Point, newPos: Point): Point[] {
        for (let j = 0; j < pts.length; j++) {
            const x = pts[j].x - center.x;
            const y = pts[j].y - center.y;
            pts[j].x = newPos.x + x;
            pts[j].y = newPos.y + y;
        }
        return pts;
    }

    /**
     * Move a point from old center to new center
     */
    static movePt(pt: Point, oldCenter: Point, newCenter: Point): Point {
        const centerDiff = {
            x: newCenter.x - oldCenter.x,
            y: newCenter.y - oldCenter.y
        };

        return new Point({
            x: pt.x + centerDiff.x,
            y: pt.y + centerDiff.y,
            spatialReference: oldCenter.spatialReference
        });
    }

    /**
     * Create dashed line between two points
     */
    static dashedLine(pt1: Point, pt2: Point, dashArray?: number[]): Point[] {
        const pts: Point[] = [];
        if (!dashArray) dashArray = [10, 5];
        
        const dashCount = dashArray.length;
        const dx = pt2.x - pt1.x;
        const dy = pt2.y - pt1.y;
        const slope = dx ? dy / dx : 1e15;
        let distRemaining = Math.sqrt(dx * dx + dy * dy);
        let dashIndex = 0;
        let draw = true;

        while (distRemaining >= 0.1) {
            const dashLength = dashArray[dashIndex++ % dashCount];
            const actualDashLength = dashLength > distRemaining ? distRemaining : dashLength;
            let xStep = Math.sqrt(actualDashLength * actualDashLength / (1 + slope * slope));
            
            if (dx < 0) xStep = -xStep;
            pt1.x += xStep;
            pt1.y += slope * xStep;

            pts.push(new Point({ x: pt1.x, y: pt1.y, spatialReference: pt1.spatialReference }));
            distRemaining -= actualDashLength;
            draw = !draw;
        }

        return pts;
    }

    /**
     * Create half circle points
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
     * Generate random points around a center
     */
    static generateRandomPoints(center: Point, radius: number, count: number): Point[] {
        const points: Point[] = [];
        for (let i = 0; i < count; i++) {
            points.push(this.generateRandomPoint(center, radius));
        }
        return points;
    }

    /**
     * Generate a single random point around a center
     */
    static generateRandomPoint(center: Point, radius: number): Point {
        const x0 = center.x;
        const y0 = center.y;
        // Convert Radius from meters to degrees
        const rd = radius / 111300;

        const u = Math.random();
        const v = Math.random();

        const w = rd * Math.sqrt(u);
        const t = 2 * Math.PI * v;
        const x = w * Math.cos(t);
        const y = w * Math.sin(t);

        const xp = x / Math.cos(y0 * Math.PI / 180);

        return new Point({
            x: xp + x0,
            y: y + y0,
            spatialReference: center.spatialReference
        });
    }

    /**
     * Fracture line between two points with gap
     */
    static _fracturePts(startPt: Point, endPoint: Point, gapLen: number, spatialReference: SpatialReference): any {
        const result = new Polyline({ spatialReference });
        const len = this._2PtLen(startPt, endPoint);
        const midPt = this.getMidPoint(startPt, endPoint);
        
        const adjustedLen = len / gapLen;
        const k = this.angleInRadians(startPt, endPoint);
        
        const pt1 = {
            x: -1 * adjustedLen * Math.cos(k) + midPt.x,
            y: -1 * adjustedLen * Math.sin(k) + midPt.y
        };
        const pt2 = {
            x: adjustedLen * Math.cos(k) + midPt.x,
            y: adjustedLen * Math.sin(k) + midPt.y
        };
        
        result.addPath([[startPt.x, startPt.y], [pt1.x, pt1.y]]);
        result.addPath([[pt2.x, pt2.y], [endPoint.x, endPoint.y]]);

        return {
            geometry: result,
            midPoint: midPt,
            len: adjustedLen
        };
    }

    /** Legacy alias used by BaseLine / Bypass min bundles for `_fracturePts`. */
    static P(startPt: Point, endPoint: Point, gapLen: number, spatialReference: SpatialReference): any {
        return this._fracturePts(startPt, endPoint, gapLen, spatialReference);
    }

    /** Legacy alias used by older min bundles for either `_fracturePts` or `_vertexAngle`. */
    static S(startPt: Point, endPoint: Point, gapLen: number, spatialReference: SpatialReference): any;
    static S(ptc: Array<{ x: number, y: number }>): number[];
    static S(
        startPtOrPtc: Point | Array<{ x: number, y: number }>,
        endPoint?: Point,
        gapLen?: number,
        spatialReference?: SpatialReference
    ): any {
        if (Array.isArray(startPtOrPtc) && endPoint === undefined) {
            return this._vertexAngle(startPtOrPtc);
        }

        return this._fracturePts(
            startPtOrPtc as Point,
            endPoint as Point,
            gapLen as number,
            spatialReference as SpatialReference
        );
    }

    /**
     * Fracture consecutive segments defined by points with given gap length
     * Returns a polyline containing fractured paths and an array of midPoints info
     */
    static _fracture(points: Point[], gapLen: number, spatialReference: SpatialReference): { geometry: Polyline, midPoints: Array<{ midPt: Point, len: number }> } {
        const result = new Polyline({ spatialReference });
        const midPts: Array<{ midPt: Point, len: number }> = [];

        if (!points || points.length <= 1) {
            throw new Error("points.length <= 1");
        }

        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];
            const values = this._fracturePts(p1, p2, gapLen, spatialReference);
            const innerPaths = values.geometry.paths as number[][][];

            midPts.push({ midPt: values.midPoint, len: values.len });

            for (let j = 0; j < innerPaths.length; j++) {
                result.addPath(innerPaths[j]);
            }
        }

        return {
            geometry: result,
            midPoints: midPts
        };
    }

    /** Legacy alias used by older min bundles for either `_fracture` or Euclidean distance. */
    static _(points: Point[], gapLen: number, spatialReference: SpatialReference): { geometry: Polyline, midPoints: Array<{ midPt: Point, len: number }> };
    static _(pt1: Point, pt2: Point): number;
    static _(
        pointsOrPt1: Point[] | Point,
        gapLenOrPt2: number | Point,
        spatialReference?: SpatialReference
    ): { geometry: Polyline, midPoints: Array<{ midPt: Point, len: number }> } | number {
        if (Array.isArray(pointsOrPt1)) {
            return this._fracture(pointsOrPt1, gapLenOrPt2 as number, spatialReference as SpatialReference);
        }

        return this._2PtLen(pointsOrPt1, gapLenOrPt2 as Point);
    }

    /**
     * Get centroid of points
     */
    static getCenteroid(pts: Point[], option: number): Point {
        const arr: number[][] = [];
        for (let n = 0; n <= pts.length - 1; n++) {
            arr.push([pts[n].x, pts[n].y]);
        }
        
        let result: Polygon | Polyline;
        if (option === 1) {
            result = new Polygon({ rings: [arr], spatialReference: pts[0].spatialReference });
        } else {
            result = new Polyline({ paths: [arr], spatialReference: pts[0].spatialReference });
        }

        return result.extent?.center || new Point({ x: 0, y: 0, spatialReference: pts[0].spatialReference });
    }

        /**
         * Create arrow head path
         */
        static CreateArrowHeadPathEx(pt1: { x: number, y: number }, candidatePt: Point, pt2: { x: number, y: number }, 
            totalLen: number, headPercentage: number, headAngle: number): { x: number, y: number }[] {
            const headSizeBaseRatio = 1.1;
            const headBaseLen = totalLen * headPercentage;
            const headSideLen = headBaseLen * headSizeBaseRatio;

            const angle1 = this.calculateAngle(candidatePt, new Point({ x: pt1.x, y: pt1.y }));
            const angle2 = this.calculateAngle(candidatePt, new Point({ x: pt2.x, y: pt2.y }));

            let midAngle = (Math.abs(angle1 - angle2)) / 2;
            if (Math.abs(angle1 - angle2) > Math.PI * 1.88) midAngle += Math.PI;

            const len = Math.sqrt(headBaseLen * headBaseLen + headSideLen * headSideLen - 
                2 * headSideLen * headBaseLen * Math.cos(midAngle + headAngle / 180 * Math.PI));
            const upAngle = Math.asin(headBaseLen * Math.sin(midAngle + headAngle / 180 * Math.PI) / len);
            const centAngle = upAngle + headAngle / 180 * Math.PI;

            const result = headBaseLen * Math.sin(Math.PI - centAngle - midAngle) / Math.sin(centAngle);

            const path: { x: number, y: number }[] = [];
            path.push({ x: candidatePt.x + result * Math.cos(angle1), y: candidatePt.y + result * Math.sin(angle1) });
            path.push({ x: candidatePt.x + headSideLen * Math.cos(angle1 - headAngle / 180 * Math.PI), 
            y: candidatePt.y + headSideLen * Math.sin(angle1 - headAngle / 180 * Math.PI) });
            path.push({ x: candidatePt.x, y: candidatePt.y });
            path.push({ x: candidatePt.x + headSideLen * Math.cos(angle2 + headAngle / 180 * Math.PI), 
            y: candidatePt.y + headSideLen * Math.sin(angle2 + headAngle / 180 * Math.PI) });
            path.push({ x: candidatePt.x + result * Math.cos(angle2), y: candidatePt.y + result * Math.sin(angle2) });

            return path;
    }

    static calculateAngle(fromPt: Point | { x: number, y: number }, toPt: Point | { x: number, y: number }): number {
        const dx = toPt.x - fromPt.x;
        const dy = toPt.y - fromPt.y;
        return Math.atan2(dy, dx);
    }

    /**
     * Calculate vertex angles for a point collection
     */
    static _vertexAngle(ptc: Array<{ x: number, y: number }>): number[] {
        const segmentAngle: number[] = [];
        const vertexAngle: number[] = [];
        
        for (let i = 0, len = ptc.length - 1; i < len; i++) {
            // 0 -2pi
            const x = this.twoPtsAngle(
                new Point({ x: ptc[i].x, y: ptc[i].y }),
                new Point({ x: ptc[i + 1].x, y: ptc[i + 1].y })
            );
            segmentAngle.push(x);
        }

        let x = this.twoPtsAngle(
            new Point({ x: ptc[0].x, y: ptc[0].y }),
            new Point({ x: ptc[1].x, y: ptc[1].y })
        );

        vertexAngle.push(x += Math.PI / 2);
        
        for (let i = 1; i < ptc.length - 1; i++) {
            x = (segmentAngle[i - 1] + segmentAngle[i]) / 2;
            if (segmentAngle[i - 1] < Math.PI && segmentAngle[i] - Math.PI > segmentAngle[i - 1]) {
                x += Math.PI;
            } else if (segmentAngle[i - 1] > Math.PI && segmentAngle[i] < segmentAngle[i - 1] - Math.PI) {
                x += Math.PI;
            }

            x += Math.PI / 2;
            vertexAngle.push(x);
        }
        return vertexAngle;
    }

    /** Legacy alias used by CounterAttack min bundles for `_vertexAngle`. */
    static v(ptc: Array<{ x: number, y: number }>): number[] {
        return this._vertexAngle(ptc);
    }

    /**
     * Calculate total length of point collection from start index
     */
    static _ptCollectionLen(ptc: Array<{ x: number, y: number }>, startIndex: number): number {
        let len = 0;
        for (let i = startIndex, pathLen = ptc.length - 1; i < pathLen; i++) {
            len += this._2PtLen(
                new Point({ x: ptc[i].x, y: ptc[i].y }),
                new Point({ x: ptc[i + 1].x, y: ptc[i + 1].y })
            );
        }
        return len;
    }

    /** Legacy alias used by CounterAttack min bundles for `_ptCollectionLen`. */
    static A(ptc: Array<{ x: number, y: number }>, startIndex: number): number {
        return this._ptCollectionLen(ptc, startIndex);
    }

    /** Legacy alias used by older min bundles for distance, `_fracture`, or `_fracturePts`. */
    static D(pt1: Point, pt2: Point): number;
    static D(points: Point[], gapLen: number, spatialReference: SpatialReference): { geometry: Polyline, midPoints: Array<{ midPt: Point, len: number }> };
    static D(startPt: Point, endPoint: Point, gapLen: number, spatialReference: SpatialReference): any;
    static D(
        ptOrPoints: Point | Point[],
        ptOrGapLen: Point | number,
        gapLenOrSpatialReference?: number | SpatialReference,
        spatialReference?: SpatialReference
    ): number | { geometry: Polyline, midPoints: Array<{ midPt: Point, len: number }> } | any {
        if (spatialReference !== undefined) {
            return this._fracturePts(
                ptOrPoints as Point,
                ptOrGapLen as Point,
                gapLenOrSpatialReference as number,
                spatialReference
            );
        }

        if (Array.isArray(ptOrPoints)) {
            return this._fracture(
                ptOrPoints,
                ptOrGapLen as number,
                gapLenOrSpatialReference as SpatialReference
            );
        }

        return this._2PtLen(ptOrPoints, ptOrGapLen as Point);
    }

    /**
     * Calculate arrow flanks length for attack by fire position
     */
    static ArrowFlanksLen(mainLength: number, baseLength: number): number {
        return Math.min(mainLength / 10, baseLength / 4);
    }

    /**
     * Compute circle parameters (center, radius) from three points in screen space
     * Ported from legacy 3.x _circleDrawEx; inputs are plain {x,y} objects
     */
    static circleFromThreeScreenPoints(
        pt1: { x: number, y: number },
        pt2: { x: number, y: number },
        pt3: { x: number, y: number }
    ): { radius: number, center: { x: number, y: number } } {
        // Helper to compute determinant
        const determinant = (a: number[][], n: number): number => {
            if (n === 2) {
                return a[0][0] * a[1][1] - a[1][0] * a[0][1];
            }
            let d = 0;
            const m: number[][] = [
                [0, 0, 0],
                [0, 0, 0],
                [0, 0, 0]
            ];
            for (let j1 = 0; j1 < n; j1++) {
                for (let i = 1; i < n; i++) {
                    let j2 = 0;
                    for (let j = 0; j < n; j++) {
                        if (j === j1) continue;
                        m[i - 1][j2] = a[i][j];
                        j2++;
                    }
                }
                d = d + Math.pow(-1.0, j1) * a[0][j1] * determinant(m, n - 1);
            }
            return d;
        };

        const P = [
            [pt1.x, pt1.y],
            [pt2.x, pt2.y],
            [pt3.x, pt3.y]
        ];
        let a = [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0]
        ];

        // m11
        for (let i = 0; i < 3; i++) {
            a[i][0] = P[i][0];
            a[i][1] = P[i][1];
            a[i][2] = 1;
        }
        const m11 = determinant(a, 3);

        // m12
        for (let i = 0; i < 3; i++) {
            a[i][0] = P[i][0] * P[i][0] + P[i][1] * P[i][1];
            a[i][1] = P[i][1];
            a[i][2] = 1;
        }
        const m12 = determinant(a, 3);

        // m13
        for (let i = 0; i < 3; i++) {
            a[i][0] = P[i][0] * P[i][0] + P[i][1] * P[i][1];
            a[i][1] = P[i][0];
            a[i][2] = 1;
        }
        const m13 = determinant(a, 3);

        // m14
        for (let i = 0; i < 3; i++) {
            a[i][0] = P[i][0] * P[i][0] + P[i][1] * P[i][1];
            a[i][1] = P[i][0];
            a[i][2] = P[i][1];
        }
        const m14 = determinant(a, 3);

        if (m11 === 0) {
            return { radius: 0, center: { x: 0, y: 0 } };
        } else {
            const Xo = 0.5 * m12 / m11;
            const Yo = -0.5 * m13 / m11;
            const r = Math.sqrt(Xo * Xo + Yo * Yo + m14 / m11);
            return { radius: r, center: { x: Xo, y: Yo } };
        }
    }
}

export default GeoTools; 