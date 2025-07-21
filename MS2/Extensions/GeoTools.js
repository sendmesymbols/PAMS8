/** @module GeoTools
 * Common functions used in Symbol for nifty calculations
 *@author Abdul Razak
 */

define(["esri/geometry/Polyline", "esri/graphic", "esri/geometry/Point", "esri/geometry/Polyline", "esri/geometry/Polygon",
        "esri/geometry/Circle", "esri/symbols/SimpleMarkerSymbol",
        "esri/symbols/SimpleLineSymbol", "esri/Color", "esri/layers/GraphicsLayer",
        "esri/symbols/SimpleFillSymbol", 'esri/geometry/geometryEngine', 'esri/units',
        "esri/geometry/ScreenPoint", "esri/geometry/Multipoint","esri/geometry/Extent",

        "esri/layers/FeatureLayer", "esri/renderers/HeatmapRenderer", "esri/tasks/FeatureSet",
        "esri/symbols/TextSymbol", "dojo/fx", "dojox/gfx/fx", "dojo/_base/lang",
        "dojo/aspect"

    ],
    function (_Polyline, _Graphic, Point, Polyline, Polygon, Circle, SimpleMarkerSymbol, SimpleLineSymbol,
        Color, GraphicsLayer, SimpleFillSymbol, geometryEngine, Units,
        ScreenPoint, Multipoint,Extent,
        FeatureLayer, HeatmapRenderer, FeatureSet, TextSymbol, coreFx, dojoxGfxFx, lang, aspect) {

        return {
            angleInRadians: function (pt1, pt2) {
                return Math.atan2(pt2.y - pt1.y, pt2.x - pt1.x);
            },
            angleInDegrees: function (pt1, pt2) {

                return Math.atan2(pt2.y - pt1.y, pt2.x - pt1.x) * 180 / Math.PI;
            },
            twoPtsAngle: function (pt1, pt2) {
                var angle = Math.acos((pt2.x - pt1.x) / this._2PtLen(pt1, pt2));
                if (pt2.y < pt1.y) {
                    angle = 2 * Math.PI - angle;
                }
                //return angle;
                return isNaN(angle) === true ? 0 : angle;
            },
            toDegrees: function (rad) {

                var angleDeg = rad * (180 / Math.PI);
                var result = ((angleDeg + 360) % 360).toFixed(1); //Converting -ve to +ve (0-360)
                if (isNaN(result))
                    result = 0;
                return result;

            },
            toRad: function (deg) {
                return deg * (Math.PI / 180);
            },


            degreesToRadians: function (degrees) {
                var radians = degrees % 360;
                return radians * Math.PI / 180;
            },
            radiansToDegrees: function (radians) {
                var degrees = radians % (2 * Math.PI);
                return degrees * 180 / Math.PI;
            },
            displayPoint: function (map, pt) {
                this._markerSymbol = new SimpleMarkerSymbol();
                map.graphics.add(new _Graphic(new Point(pt.x, pt.y, map.spatialReference), this._markerSymbol));
            },

            displayPointText: function (map, pt, text) {
                map.graphics.add(new _Graphic(new Point(pt.x, pt.y, map.spatialReference), new TextSymbol(text)));
                this._markerSymbol = new SimpleMarkerSymbol(SimpleMarkerSymbol.STYLE_CROSS, 10,
                    new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID,
                        new Color([255, 0, 0]), 1),
                    new Color([0, 255, 0]));
                map.graphics.add(new _Graphic(new Point(pt.x, pt.y, map.spatialReference), this._markerSymbol));
            },
            getMidPoint: function (p1, p2) {
                var path = [];
                var result = new _Polyline(map.spatialReference);
                path = path.concat(p1, p2);
                result.addPath(path);
                return result.getExtent().getCenter();
            },
            //New
            _calculateMidPoint: function (pt1, pt2) {
                // Use mid point formula
                var x = ((pt1.x + pt2.x) / 2);
                var y = ((pt1.y + pt2.y) / 2);
                var midPoint = new Point(x, y, map.spatialReference);
                return midPoint;
            },
            getLastPtFromPoly: function (polyline) {
                var lastPartIdx = polyline.paths.length - 1;
                var lastPntIdx = polyline.paths[lastPartIdx].length - 1;
                return polyline.getPoint(lastPartIdx, lastPntIdx);
            },
            getLastPtFromPolygon: function (polygon) {
                var lastPartIdx = polygon.rings.length - 1;
                var lastPntIdx = polygon.rings[lastPartIdx].length - 1;
                return polygon.getPoint(lastPartIdx, lastPntIdx);
            },
            addAllRings: function (rings, result) {
                var result = result;
                for (var i = 0; i < rings.length; i++) {
                    result.addRing(rings[i]);
                }

                return result;
            },
            setDefault: function (object, property, defaults) {
                var res = object.hasOwnProperty(property) ? object[property] : defaults;
                if (res === undefined) {
                    return defaults;
                } else {
                    return res;
                }
            },
            //Destination



            factors: {
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
                yards: 6371008.8 / 1.0936,

            },


            destination: function (origin, distance, bearing, units) {

                //var units = (typeof options === 'object') ? options.units : options;
                var degrees2radians = Math.PI / 180;
                var radians2degrees = 180 / Math.PI;
                var longitude1 = degrees2radians * origin.x;
                var latitude1 = degrees2radians * origin.y;
                var bearing_rad = degrees2radians * bearing;
                var radians = this.distanceToRadians(distance, units);
                var latitude2 = Math.asin(Math.sin(latitude1) * Math.cos(radians) +
                    Math.cos(latitude1) * Math.sin(radians) * Math.cos(bearing_rad));
                var longitude2 = longitude1 + Math.atan2(Math.sin(bearing_rad) * Math.sin(radians) * Math.cos(latitude1),
                    Math.cos(radians) - Math.sin(latitude1) * Math.sin(latitude2));

                return new Point(radians2degrees * longitude2, radians2degrees * latitude2);
            },
            distanceToRadians: function (distance, units) {
                if (distance === undefined || distance === null)
                    throw new Error('Distance is Required');
                if (units && typeof units !== 'string')
                    throw new Error('Units must be a string');
                var factor = this.factors[units || 'kilometers'];
                if (!factor)
                    throw new Error(units + 'units is invalid');
                return distance / factor;
            },
            //End of Destination


            //Distance

            radiansToLength: function (radians, units) {
                var factor = this.factors[units];
                if (!factor) {
                    throw new Error(units + " units is invalid");
                }
                return radians * factor;
            },

            distance: function (from, to, unit) {
                var dLat = this.degreesToRadians((to.y - from.y));
                var dLon = this.degreesToRadians((to.x - from.y));
                var lat1 = this.degreesToRadians(from.y);
                var lat2 = this.degreesToRadians(to.y);
                var a = Math.pow(Math.sin(dLat / 2), 2) + Math.pow(Math.sin(dLon / 2), 2) * Math.cos(lat1) * Math.cos(lat2);
                return this.radiansToLength(2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)), unit);
            },

            bearing: function (start, end, final) {
                if (final === undefined) final = false;
                // Reverse calculation
                if (final === true) {
                    return this.calculateFinalBearing(start, end);
                }

                var lon1 = this.degreesToRadians(start.x);
                var lon2 = this.degreesToRadians(end.x);
                var lat1 = this.degreesToRadians(start.y);
                var lat2 = this.degreesToRadians(end.y);

                var a = Math.sin(lon2 - lon1) * Math.cos(lat2);
                var b = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);

                return this.radiansToDegrees(Math.atan2(a, b));
            },
            calculateFinalBearing: function (start, end) {
                // Swap start & end
                var bear = this.bearing(end, start);
                bear = (bear + 180) % 360;
                return bear;
            },



            //End of Distance

            //New
            _calculateAngle: function (pt1, pt2) {
                //Find the angle based in two input pts
                var deltaX = (pt2.x - pt1.x);
                var deltaY = (pt2.y - pt1.y);
                var angle = (Math.atan2(deltaX, deltaY) * 180 / Math.PI) - 90;
                //to prevent the text from displaying upside down, reverse the angle it is less than -90 degrees
                if (angle < -90) {
                    angle += 180;
                }
                return angle;

            },
            translateGeometry: function (geometry, newPos) {
                var center = 0;
                var x, y;
                if (geometry.type === 'polyline') {
                    var p = new Polygon(geometry.paths);
                    center = p.getExtent().getCenter(p);
                    for (var i = 0; i < geometry.paths.length; i++) {
                        for (var j = 0; j < geometry.paths[i].length; j++) {

                            x = geometry.paths[i][j][0] - center.x;
                            y = geometry.paths[i][j][1] - center.y;

                            geometry.paths[i][j][0] = newPos.x + x;
                            geometry.paths[i][j][1] = newPos.y + y;



                        }
                    }

                } else if (geometry.type === 'polygon') {
                    var p = new Polygon(geometry.rings);
                    center = p.getExtent().getCenter();
                    for (var i = 0; i < geometry.rings.length; i++) {
                        for (var j = 0; j < geometry.rings[i].length; j++) {

                            x = geometry.rings[i][j][0] - center.x;
                            y = geometry.rings[i][j][1] - center.y;

                            geometry.rings[i][j][0] = newPos.x + x;
                            geometry.rings[i][j][1] = newPos.y + y;



                        }
                    }

                } else if (geometry.type === 'point') {
                    center = geometry;
                    geometry = this.translatePts(geometry, center, newPos);
                }

                return geometry;

            },
            translatePts: function (pts, center, newPos) {
                for (var j = 0; j < pts.length; j++) {

                    x = pts[j].x - center.x;
                    y = pts[j].y - center.y;

                    pts[j].x = newPos.x + x;
                    pts[j].y = newPos.y + y;
                }

                return pts;
            },


            movePt: function (pt, oldCenter, newCenter) {
                var centerDiff = new Point(oldCenter.spatialReference);
                //Difference
                centerDiff.x = newCenter.x - oldCenter.x;
                centerDiff.y = newCenter.y - oldCenter.y;

                //Addition
                pt.x = pt.x + centerDiff.x;
                pt.y = pt.y + centerDiff.y;
                return new Point(pt.x, pt.y, oldCenter.spatialReference);
            },

            moveGeometry: function (geometry, oldCenter, newCenter) {
                var centerDiff = new Point(oldCenter.spatialReference);
                //Difference
                centerDiff.x = newCenter.x - oldCenter.x;
                centerDiff.y = newCenter.y - oldCenter.y;

                var x, y;
                if (geometry.type === 'polyline') {

                    for (var i = 0; i < geometry.paths.length; i++) {
                        for (var j = 0; j < geometry.paths[i].length; j++) {

                            geometry.paths[i][j][0] = geometry.paths[i][j][0] + centerDiff.x;
                            geometry.paths[i][j][1] = geometry.paths[i][j][1] + centerDiff.y;
                        }
                    }

                } else if (geometry.type === 'polygon') {

                    for (var i = 0; i < geometry.rings.length; i++) {
                        for (var j = 0; j < geometry.rings[i].length; j++) {
                            geometry.rings[i][j][0] = geometry.rings[i][j][0] + centerDiff.x;
                            geometry.rings[i][j][1] = geometry.rings[i][j][1] + centerDiff.y;
                        }
                    }

                } else if (geometry.type === 'point') {

                    geometry = this.movePt(geometry, oldCenter, newCenter);
                }

                return geometry;

            },


            getCenteroid: function (pts, option) {

                var arr = [];
                var result;
                for (var n = 0; n <= pts.length - 1; n++) {
                    arr.push([pts[n].x, pts[n].y]);
                }
                if (option === 1) {
                    result = new Polygon(arr);
                } else {
                    result = new Polyline(arr);
                }

                return result.getExtent().getCenter();

            },
            createPolyFromObject: function (pts) {
                var result = [];

                for (var m = 0; m < pts.length; m++) {
                    result.push({
                        'x': pts[m][0],
                        'y': pts[m][1]
                    });
                }

                return result;

            },
            _2PtLen: function (pt1, pt2) {
                if (pt1 != undefined && pt2 != undefined)
                    return Math.sqrt((pt1.x - pt2.x) * (pt1.x - pt2.x) + (pt1.y - pt2.y) * (pt1.y - pt2.y));
            },
            twoPtsRelationShip: function (pt1, pt2) {
                if (pt2.x > pt1.x && pt2.y >= pt1.y)
                    return "ne";
                else if (pt2.x <= pt1.x && pt2.y > pt1.y)
                    return "nw";
                else if (pt2.x < pt1.x && pt2.y <= pt1.y)
                    return "sw";
                else
                    return "se";
            },
            getArea: function (extent) {
                if (extent !== undefined) {
                    return extent.getWidth() * extent.getWidth();
                } else {
                    return 0;
                }

            },
            getPolylineCenter: function (polyline) {

                var path = polyline.paths[polyline.paths.length / 2];
                var pointIndex = (path.length - 1) / 2;
                var startPoint = path[pointIndex];
                var endPoint = path[pointIndex + 1];
                return new Point((startPoint[0] + endPoint[0]) / 2.0, (startPoint[1] + endPoint[1]) / 2.0);

            },
            ArrowFlanksLen: function (totalLen, baseLineLen) {
                return (totalLen / 10 >= baseLineLen / 2.8) ? baseLineLen / 2.8 : totalLen / 10;

            },
            _fracturePts: function (startPt, endPoint, gapLen, spatialReference) {
                var path = [];
                var result = new _Polyline(spatialReference);

                var len = this._2PtLen(startPt, endPoint);
                var midPt = this.getMidPoint(startPt, endPoint);
                path = [];
                len = len / gapLen;
                k = this.angleInRadians(startPt, endPoint);
                var pt1 = {
                    x: -1 * len * Math.cos(k) + midPt.x,
                    y: -1 * len * Math.sin(k) + midPt.y
                };
                var pt2 = {
                    x: len * Math.cos(k) + midPt.x,
                    y: len * Math.sin(k) + midPt.y
                };
                path = path.concat(startPt, pt1);
                result.addPath(path);
                path = [];
                path = path.concat(pt2, endPoint);
                result.addPath(path);

                return {
                    geometry: result,
                    midPoint: midPt,
                    len: len
                };

            },
            getFracturedPts: function (points, gapLen, spatialReference) {


            },
            _fracture: function (points, gapLen, spatialReference) {

                var result = new _Polyline(spatialReference);
                var path = [];
                var values = [];
                var midPts = [];
                var p1, p2;
                var temp = [];
                var innerPaths = [];

                if (points.length <= 1) {
                    throw "points.length <= 1";
                }
                values = [];
                midPts = [];
                path = points;

                for (var i = 0; i < path.length - 1; i++) {
                    p1 = path[i];
                    if (path[i + 1] != undefined) {
                        p2 = path[i + 1];
                    }
                    /*else {
                                            p1 = path[i-1];
                                            p2 = path[i];
                                            } */

                    values = this._fracturePts(p1, p2, gapLen, spatialReference);

                    innerPaths = values.geometry.paths;

                    midPts.push({
                        midPt: values.midPoint,
                        len: values.len
                    });

                    for (var j = 0; j < innerPaths.length; j++) {
                        result.addPath(innerPaths[j]);
                    }

                }

                return {
                    geometry: result,
                    midPoints: midPts
                };
            },
            dashedLine: function (pt1, pt2, dashArray) {

                var pts = [];
                if (!dashArray)
                    dashArray = [10, 5];
                if (dashLength === 0)
                    dashLength = 0.001;
                var dashCount = dashArray.length;

                var dx = (pt2.x - pt1.x),
                    dy = (pt2.y - pt1.y);
                var slope = dx ? dy / dx : 1e15;
                var distRemaining = Math.sqrt(dx * dx + dy * dy);
                var dashIndex = 0,
                    draw = true;

                while (distRemaining >= 0.1) {

                    var dashLength = dashArray[dashIndex++ % dashCount];
                    if (dashLength > distRemaining)
                        dashLength = distRemaining;
                    var xStep = Math.sqrt(dashLength * dashLength / (1 + slope * slope));
                    if (dx < 0)
                        xStep = -xStep;
                    pt1.x += xStep;
                    pt1.y += slope * xStep;

                    draw ? pts.push({
                        "0": pt1.x,
                        "1": pt1.y
                    }) : pts.push({
                        "0": pt1.x,
                        "1": pt1.y
                    });

                    distRemaining -= dashLength;
                    draw = !draw;


                }

                return pts;
            },
            createHalfCircle: function (pt, radius, thetaStart, thetaEnd, steps) {

                var pts = [];
                var step = 2 * Math.PI / steps;
                var xh = pt.x;
                var yk = pt.y;
                var r = radius;

                for (var theta = thetaStart; theta < 2 * Math.PI + thetaEnd; theta += step) {
                    var x = xh + r * Math.cos(theta);
                    var y = yk - r * Math.sin(theta);
                    pts.push(new Point(x, y, pt.spatialReference));
                }
                return pts;
            },
            createDashLines: function (pts, dashArray) {
                var result = [];
                var lastPt = undefined;
                var pt1 = {};
                var pt2 = {};

                for (var i = 0; i < pts.length; i++) {

                    pt1.x = pts[i].x;
                    pt1.y = pts[i].y;

                    pt2.x = pts[i + 1].x;
                    pt2.y = pts[i + 1].y;


                    result = result.concat(this.dashedLine(pt1, pt2, dashArray));
                    i++;

                    /*  pt1.x = pts.paths[i][i][0];
                     pt1.y = pts.paths[i][i][1];
                     
                     pt2.x = pts.paths[i][i+1][0];
                     pt2.y = pts.paths[i][i+1][1];
                     
                     result = result.concat(dashedLine(pt1, pt2, dashArray));*/

                    /*
                     pt1.x = pts[i], pt1.y = pts[i+1], pt2.x = pts[i+2], pt2.y = pts[i+3];
                     result = result.concat(dashedLine(pt1, pt2, dashArray));
                     */

                }


                return result;

            },
            _vertexAngle: function (ptc) {
                var segmentAngle = [],
                    vertexAngle = [],
                    left = [];
                for (var i = 0, len = ptc.length - 1; i < len; i++) {
                    //0 -2pi
                    var x = this.twoPtsAngle(ptc[i], ptc[i + 1]);

                    segmentAngle.push(x);
                }


                x = this.twoPtsAngle(ptc[0], ptc[1]);

                vertexAngle.push(x += Math.PI / 2);
                for (i = 1; i < len; i++) {
                    //var x = segmentAngle[i - 1] < segmentAngle[i] ? segmentAngle[i - 1] : segmentAngle[i] + polyline._3PtAngleAngleHalf(ptc[i - 1], ptc[i], ptc[i + 1]);
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
            },
            _ptCollectionLen: function (ptc, startIndex) {
                var len = 0;
                for (var i = startIndex, pathLen = ptc.length - 1; i < pathLen; i++) {
                    len += this._2PtLen(ptc[i], ptc[i + 1]);
                }
                return len;
            },
            getDashPts: function (pts, dashArray, dashLength) {
                var result = [];

                for (var j = 0; j < pts.length; j++) {
                    p1 = pts[j];
                    if (pts[j + 1] != undefined) {
                        p2 = pts[j + 1];
                        result = result.concat(this.dashes(p1.x, p1.y, p2.x, p2.y, dashArray, dashLength));

                    }
                }


                return result;

            },
            dashes: function (x, y, x2, y2, dashArray, dashLength) {

                var points = [];

                if (!dashArray)
                    dashArray = [10, 5];
                if (dashLength === 0)
                    dashLength = 0.001;


                var dashCount = dashArray.length;
                points.push(new Point(x, y));
                var dx = (x2 - x),
                    dy = (y2 - y);
                var slope = dx ? dy / dx : 1e15;
                var distRemaining = Math.sqrt(dx * dx + dy * dy);
                var dashIndex = 0,
                    draw = true;

                var dashLength = dashArray[dashIndex++ % dashCount];
                while (distRemaining > dashLength) {

                    if (dashLength > distRemaining)
                        dashLength = distRemaining;
                    var xStep = Math.sqrt(dashLength * dashLength / (1 + slope * slope));

                    if (dx < 0)
                        xStep = -xStep;
                    x += xStep;
                    y += slope * xStep;
                    points.push(new Point(x, y));
                    distRemaining -= dashLength;
                    draw = !draw;
                    dashLength = dashArray[dashIndex++ % dashCount];
                }
                return points;
            },
            getDashPtsWithAngles: function (pts, dashArray) {
                var result = [];
                var midPts = [];
                var angles = [];

                for (var j = 0; j < pts.length; j++) {
                    p1 = pts[j];
                    if (pts[j + 1] != undefined) {
                        p2 = pts[j + 1];
                        result.push({
                            'midPt': this.dashesWithAngles(p1.x, p1.y, p2.x, p2.y, dashArray),
                            'angle': this.twoPtsAngle(p1, p2)
                        });

                    }
                }

                //debugger;
                return result;

            },
            dashesWithAngles: function (x, y, x2, y2, dashArray) {

                var points = [];

                if (!dashArray)
                    dashArray = [10, 5];
                if (dashLength === 0)
                    dashLength = 0.001;
                var dashCount = dashArray.length;
                points.push(new Point(x, y));
                var dx = (x2 - x),
                    dy = (y2 - y);
                var slope = dx ? dy / dx : 1e15;
                var distRemaining = Math.sqrt(dx * dx + dy * dy);
                var dashIndex = 0,
                    draw = true;

                var dashLength = dashArray[dashIndex++ % dashCount];
                while (distRemaining > dashLength) {

                    if (dashLength > distRemaining)
                        dashLength = distRemaining;
                    var xStep = Math.sqrt(dashLength * dashLength / (1 + slope * slope));

                    if (dx < 0)
                        xStep = -xStep;
                    x += xStep;
                    y += slope * xStep;
                    points.push(new Point(x, y));
                    distRemaining -= dashLength;
                    draw = !draw;
                    dashLength = dashArray[dashIndex++ % dashCount];
                }
                return points;
            },
            _circleDrawEx: function (pt1, pt2, pt3) {
                var i;
                var r, m11, m12, m13, m14;
                var a = [
                    [0, 0, 0],
                    [0, 0, 0],
                    [0, 0, 0]
                ];
                var P = [
                    [pt1.x, pt1.y],
                    [pt2.x, pt2.y],
                    [pt3.x, pt3.y]
                ];
                for (i = 0; i < 3; i++) // find minor 11
                {
                    a[i][0] = P[i][0];
                    a[i][1] = P[i][1];
                    a[i][2] = 1;
                }
                m11 = this._determinantDrawEx(a, 3);

                for (i = 0; i < 3; i++) // find minor 12
                {
                    a[i][0] = P[i][0] * P[i][0] + P[i][1] * P[i][1];
                    a[i][1] = P[i][1];
                    a[i][2] = 1;
                }
                m12 = this._determinantDrawEx(a, 3);

                for (i = 0; i < 3; i++) // find minor 13
                {
                    a[i][0] = P[i][0] * P[i][0] + P[i][1] * P[i][1];
                    a[i][1] = P[i][0];
                    a[i][2] = 1;
                }
                m13 = this._determinantDrawEx(a, 3);

                for (i = 0; i < 3; i++) // find minor 14
                {
                    a[i][0] = P[i][0] * P[i][0] + P[i][1] * P[i][1];
                    a[i][1] = P[i][0];
                    a[i][2] = P[i][1];
                }
                m14 = this._determinantDrawEx(a, 3);

                if (m11 == 0) {
                    r = 0; // not a circle
                } else {
                    var Xo = 0.5 * m12 / m11; // center of circle
                    var Yo = -0.5 * m13 / m11;
                    r = Math.sqrt(Xo * Xo + Yo * Yo + m14 / m11);
                }



                return {
                    radius: r,
                    center: {
                        x: Xo,
                        y: Yo
                    }
                }; // the radius
            },

            // Recursive definition of determinate using expansion by minors.
            _determinantDrawEx: function (a, n) {
                var i, j, j1, j2;
                var d = 0;
                var m = [
                    [0, 0, 0],
                    [0, 0, 0],
                    [0, 0, 0]
                ];

                if (n == 2) // terminate recursion
                {
                    d = a[0][0] * a[1][1] - a[1][0] * a[0][1];
                } else {
                    d = 0;
                    for (j1 = 0; j1 < n; j1++) // do each column
                    {
                        for (i = 1; i < n; i++) // create minor
                        {
                            j2 = 0;
                            for (j = 0; j < n; j++) {
                                if (j == j1) continue;
                                m[i - 1][j2] = a[i][j];
                                j2++;
                            }
                        }

                        // sum (+/-)cofactor * minor
                        d = d + Math.pow(-1.0, j1) * a[0][j1] * this._determinantDrawEx(m, n - 1);
                    }
                }

                return d;
            },
            CreateCircleSegmentFromThreePoints: function (circle, pt1, pt2, pt3, numberOfPts, map) {
                //    var centerX = ellipseObject.center.x, centerY = ellipseObject.center.y, longAxis = ellipseObject.longAxis, shortAxis = ellipseObject.shortAxis, numberOfPoints = ellipseObject.numberOfPoints, map = ellipseObject.map, f, i, m;
                //    var centerX = ellipseObject.center.x, centerY = ellipseObject.center.y, longAxis = ellipseObject.longAxis, shortAxis = ellipseObject.shortAxis, numberOfPoints = ellipseObject.numberOfPoints, f, i, m;
                //    var ring = [];
                //    var angle = 2 * Math.PI / numberOfPoints;
                //    for (i = 0; i < numberOfPoints; i++)
                //    {
                //      f = Math.cos(i * angle), m = Math.sin(i * angle), f = map.toMap({x: longAxis * f + centerX, y: shortAxis * m + centerY}), ring.push(f);
                //    }
                //    ring.push(ring[0]);
                //    centerX = new l(map.spatialReference);
                //    centerX.addRing(ring);
                //    return centerX
                var center = circle.center,
                    radius = circle.radius,
                    path = [];
                pt1.x -= center.x;
                pt1.y -= center.y;
                pt2.x -= center.x;
                pt2.y -= center.y;
                pt3.x -= center.x;
                pt3.y -= center.y;
                var anglePt1 = Math.atan2(pt1.y, pt1.x),
                    anglePt2 = Math.atan2(pt2.y, pt2.x),
                    anglePt3 = Math.atan2(pt3.y, pt3.x);
                anglePt1 = anglePt1 < 0 ? 2 * Math.PI + anglePt1 : anglePt1;
                anglePt2 = anglePt2 < 0 ? 2 * Math.PI + anglePt2 : anglePt2;
                anglePt3 = anglePt3 < 0 ? 2 * Math.PI + anglePt3 : anglePt3;
                var startAngle = Math.min(anglePt1, anglePt2);
                var endAngle = Math.max(anglePt1, anglePt2);
                var swipeAngle = endAngle - startAngle;
                if (anglePt3 < startAngle || anglePt3 > endAngle) {
                    swipeAngle -= (2 * Math.PI);
                }
                var angle = swipeAngle / numberOfPts,
                    pt;

                for (var i = 0; i <= numberOfPts; i++) {

                    pt = map.toMap({
                        x: radius * Math.cos(startAngle + i * angle) + center.x,
                        y: radius * Math.sin(startAngle + i * angle) + center.y
                    });
                    path.push(pt);

                }


                var result = new _Polyline(map.spatialReference);
                result.addPath(path);



                return {
                    "geometry": result,
                    "lastPoint": path[numberOfPts],
                    "backPoint": path[numberOfPts - 5]
                };

            },

            getHeatMapLayer: function (features, weightFd, minVal, maxVal, blrRad) {
                var result;
                var featureSet = new FeatureSet();
                featureSet.features = features;
                featureSet.geometryType = "esriGeometryPoint";
                var featureCollection = {
                    objectIdField: "OBJECTID",
                    layerDefinition: {
                        "geometryType": "esriGeometryPoint",
                        "fields": [{
                            "name": "OBJECTID",
                            "type": "esriFieldTypeOID"
                        }, {
                            "name": weightFd,
                            "type": "esriFieldTypeDouble"
                        }]
                    },
                    featureSet: featureSet
                };


                var heatmapFeatureLayerOptions = {
                    mode: FeatureLayer.MODE_SNAPSHOT,
                    outFields: [weightFd],
                    blurRadius: blrRad,
                    maxPixelIntensity: maxVal,
                    minPixelIntensity: minVal

                };
                var heatmapFeatureLayer = new FeatureLayer(featureCollection, heatmapFeatureLayerOptions);
                var heatmapRenderer = new HeatmapRenderer({
                    field: weightFd,
                    colorStops: [{
                            ratio: 0,
                            color: 'rgba(250,0,255,0)'
                        },
                        {
                            ratio: 0.25,
                            color: 'rgb(0,0,255)'
                        },
                        {
                            ratio: 0.50,
                            color: 'rgb(0,255,0)'
                        },
                        {
                            ratio: 0.75,
                            color: 'rgb(255,255,0)'
                        },
                        {
                            ratio: 1,
                            color: 'rgb(255,0,0)'
                        }
                    ]
                });
                heatmapFeatureLayer.setRenderer(heatmapRenderer);

                return heatmapFeatureLayer;
            },
            //Use with Caution -- Not Tested
            _calculateMidPointWithOffset: function (pt1, pt2) {
                // THIS DOESN'T WORK YET...  NEED TO GET BETTER FORMULA FOR CALCULATING OFFSET
                var midX = (pt1.x + pt2.x) / 2;
                var midY = (pt1.y + pt2.y) / 2;
                // offset the point from the line to do smooth tracking of the measurement
                var offset = this._calculateDistanceFromPixels(10); // convert 10 pixels into map units
                var dx = pt1.x - pt2.x;
                var slope = dx / (pt1.y - pt2.y);
                var x = (Math.sqrt(Math.abs(Math.pow(offset, 2) - Math.pow(dx, 2))) / slope) + midX;
                var y = (slope * (x - midX)) + midY;
                var midPoint = new Point(x, y, this.map.spatialReference);
                return midPoint;
            },

            _calculateDistanceFromPixels: function (pixels) {
                var screenPoint = this.map.toScreen(this.map.extent.getCenter());

                var upperLeftScreenPoint = new Point(screenPoint.x - pixels, screenPoint.y - pixels);
                var lowerRightScreenPoint = new Point(screenPoint.x + pixels, screenPoint.y + pixels);

                var upperLeftMapPoint = this.map.toMap(upperLeftScreenPoint);
                var lowerRightMapPoint = this.map.toMap(lowerRightScreenPoint);

                var ext = new Extent(upperLeftMapPoint.x, upperLeftMapPoint.y, lowerRightMapPoint.x, lowerRightMapPoint.y, this.map.spatialReference);
                return ext.getWidth();
            },
            //Use with Caution -- Not Tested

            getCenterOfExtent: function (extent) {
                var x = (extent.xmax - (extent.xmax - extent.xmin) / 2);
                var y = (extent.ymax - (extent.ymax - extent.ymin) / 2);
                var point = new Point(x, y, extent.spatialReference);
                return point;
            },
            getMidpointTop: function (extent) {
                var x = (extent.xmax - (extent.xmax - extent.xmin) / 2);
                var y = extent.ymax;
                var point = new Point(x, y, extent.spatialReference);
                return point;
            },
            getMidpointBottom: function (extent) {
                var x = (extent.xmax - (extent.xmax - extent.xmin) / 2);
                var y = extent.ymin;
                var point = new Point(x, y, extent.spatialReference);
                return point;
            },
            getMidpointLeft: function (extent) {
                var x = extent.xmax - (extent.xmax - extent.xmin);
                var y = (extent.ymax - (extent.ymax - extent.ymin) / 2);
                var point = new Point(x, y, extent.spatialReference);
                return point;
            },
            getMidpointRight: function (extent) {
                var x = extent.xmax;
                var y = (extent.ymax - (extent.ymax - extent.ymin) / 2);
                var point = new Point(x, y, extent.spatialReference);
                return point;
            },
            getLowerLeft: function (extent) {
                var x = extent.xmin;
                var y = extent.ymin;
                var point = new Point(x, y, extent.spatialReference);
                return point;
            },
            getUpperLeft: function (extent) {
                var x = extent.xmin;
                var y = extent.ymax;
                var point = new Point(x, y, extent.spatialReference);
                return point;
            },
            getLowerRight: function (extent) {
                var x = extent.xmax;
                var y = extent.ymin;
                var point = new Point(x, y, extent.spatialReference);
                return point;
            },
            getUpperRight: function (extent) {
                var x = extent.xmax;
                var y = extent.ymax;
                var point = new Point(x, y, extent.spatialReference);
                return point;
            },
            getTopLeftQuadrant: function (extent) {
                var tl = this.createExtentEnvelope(this.getMidpointLeft(), this.getMidpointTop());
                return tl;
            },
            getTopRightQuadrant: function (extent) {
                var tr = this.createExtentEnvelope(this.getCenterOfExtent(), this.getUpperRight());
                return tr;
            },
            getBottomLeftQuadrant: function (map, extent) {
                var bl = this.createExtentEnvelope(map, this.getLowerLeft(extent), this.getCenterOfExtent(extent));
                return bl;
            },
            getBottomRightQuadrant: function (map, extent) {
                var br = this.createExtentEnvelope(map, this.getMidpointBottom(extent), this.getMidpointRight(extent));
                return br;
            },
            getQuardrants: function (map, extent) {
                return {
                    "topLeft": this.getTopLeftQuadrant(),
                    "topRight": this.getTopRightQuadrant(),
                    "bottomLeft": this.getBottomLeftQuadrant(map),
                    "bottomRight": this.getBottomRightQuadrant(map)
                }
            },
            createExtentEnvelope: function (map, lowerLeft, upperRight) {
                var extent = new Extent({
                    "xmin": lowerLeft.x,
                    "ymin": lowerLeft.y,
                    "xmax": upperRight.x,
                    "ymax": upperRight.y,
                    "spatialReference": {
                        "wkid": map.spatialReference
                    }
                });
                return extent;
            },
            /**
             * Generates number of random geolocation points given a center and a radius.
             * @param  {Object} center A JS object with Point.
             * @param  {number} radius Radius in meters.
             * @param {number} count Number of points to generate.
             * @return {array} Array of Objects with Points.
             */
            generateRandomPoints: function (center, radius, count) {
                var points = [];
                for (var i = 0; i < count; i++) {
                    points.push(this.generateRandomPoint(center, radius));
                }
                return points;
            },


            /**
             * Generates number of random geolocation points given a center and a radius.
             * @param  {Object} center A JS object with Points.
             * @param  {number} radius Radius in meters.
             * @return {Object} The generated random points as JS object with Points.
             */
            generateRandomPoint: function (center, radius) {
                var x0 = center.x;
                var y0 = center.y;
                // Convert Radius from meters to degrees.
                var rd = radius / 111300;

                var u = Math.random();
                var v = Math.random();

                var w = rd * Math.sqrt(u);
                var t = 2 * Math.PI * v;
                var x = w * Math.cos(t);
                var y = w * Math.sin(t);

                var xp = x / Math.cos(y0);

                // Resulting point.
                return new Point(xp + x0, y + y0, center.spatialReference);
            },

            generateRandomLocations: function (pt, radiusInMeters, count, uniform) {

                var points = [];
                for (var i = 0; i < count; i++) {
                    points.push(this.getRandomLocation(pt.x, pt.y, radiusInMeters, uniform));
                }
                return points;
            },


            /***
             * map: Current Map
             * inGraphicsArr: Graphic Array to be animated
             ***/
            animate_graphics_as_flag: function (map, inGraphicsArr, circle, animDuration) {

                var graphicsLayer = new GraphicsLayer();
                graphicsLayer.id = "graphicsLayer1";
                map.addLayer(graphicsLayer);

                var ladderingLayer = new GraphicsLayer();
                ladderingLayer.id = "ladderingLayer";
                map.addLayer(ladderingLayer);


                if (animDuration === undefined) {
                    animDuration = 500
                };
                var inGraphicCount = inGraphicsArr.length;
                var circleGeometry = new Circle({
                    center: circle.center,
                    radius: circle.radius,
                    numberOfPoints: inGraphicsArr.length,
                    radiusUnit: circle.radiusUnit
                });

                for (var i = 0; i <= inGraphicsArr.length; i++) {
                    this.animate_feature_in_flag(map, inGraphicsArr[i], circleGeometry, inGraphicCount, i, animDuration);
                }


            },

            animate_feature_in_flag: function (map, graphic, circle, total, num, animDuration) {

                var layer = map.getLayer('graphicsLayer1');
                var plgn = this.getLadderExtent(map, layer.graphics, map.spatialReference);
                var g = new _Graphic(plgn, new SimpleFillSymbol());
                var ladderingLayer = map.getLayer('ladderingLayer');
                ladderingLayer.add(g);


                var lengthEach = this.getPtDistance(plgn.getPoint(0, 0), plgn.getPoint(0, 1));
                var widthEach = this.getPtDistance(plgn.getPoint(0, 2), plgn.getPoint(0, 3));

                this.displayPointText(map, plgn.getPoint(0, 0), "L1");
                this.displayPointText(map, plgn.getPoint(0, 1), "L2");


                this.displayPointText(map, plgn.getPoint(0, 2), "W1");
                this.displayPointText(map, plgn.getPoint(0, 3), "W2");



                //get total distance
                // These two points are wrong
                var totalLength = this.getPtDistance(new Point(map.extent.xmax, map.extent.ymin, map.spatialReference), new Point(map.extent.xmin, map.extent.ymax, map.spatialReference));

                var totalWidth = this.getPtDistance(new Point(map.extent.xmax, map.extent.ymin, map.spatialReference), new Point(map.extent.xmax, map.extent.ymax, map.spatialReference));

                var totalBoxesL = Math.ceil(totalLength / lengthEach);
                var totalBoxesW = Math.ceil(totalWidth / widthEach);


                console.log(totalLength)
                console.log(totalWidth)

                console.log('Total Dabbay L ' + totalLength / lengthEach);
                console.log('Total Dabbay W ' + totalWidth / widthEach);



                var startPt = map.toMap(new ScreenPoint(0, 0));
                var runningPt = map.toMap(new ScreenPoint(0, 0));
                //GeoTools.displayPointText(map, startPt, "Start Pt");
                for (var h = 0; h <= totalBoxesW + 2; h++) {
                    for (var i = 0; i < totalBoxesL; i++) {
                        this.displayPointText(map, runningPt, "RP " + i);
                        runningPt = this.destination(runningPt, lengthEach, 180, 'meters');


                    }

                    runningPt = this.destination(startPt, widthEach, 90, 'meters');
                    startPt = runningPt;
                    //GeoTools.displayPointText(map, startPt, i);


                }


                //Place the graphic


                //Place First Graphic
                //1. Get first Graphic
                var stemRootOffset = map.toMap(new ScreenPoint(0, 0));
                this.displayPointText(map, stemRootOffset, "START")

                var layer = map.getLayer('graphicsLayer1');
                var graphic;
                // 2. Add width for the first time so that symbols appear right aligned with the line
                var i, width, height;
                for (i = 0; i < layer.graphics.length; i++) {
                    graphic = layer.graphics[i];
                    var hw = this.getSymbolSize(graphic.drawEssentials.SIDC, {
                        "size": graphic.drawEssentials.OPTIONS.size
                    });
                    width = hw.width;
                    height = hw.height;
                    var screenPtStemOffset = map.toScreen(stemRootOffset);
                    //screenPtStemOffset.x += width * 2;
                    screenPtStemOffset.x += width * 1.5;
                    screenPtStemOffset.y -= height * 1.1;
                    var stemOffsetMap = map.toMap(screenPtStemOffset);
                    this.displayPointText(map, stemOffsetMap, i);

                    graphic.setGeometry(new Point(stemOffsetMap.x, stemOffsetMap.y, map.spatialReference));
                    graphic.draw();

                    //Gap Pt
                    screenPtStemOffset.x -= width * 1.5;

                    stemOffsetMap = map.toMap(screenPtStemOffset);
                    stemRootOffset = stemOffsetMap;
                }

                //End of place the graphic










                this.displayPointText(map, new Point(map.extent.xmin, map.extent.ymin, map.spatialReference), "BL")
                this.displayPointText(map, new Point(map.extent.xmin, map.extent.ymax, map.spatialReference), "TL");

                this.displayPointText(map, new Point(map.extent.xmax, map.extent.ymax, map.spatialReference), "TR");
                this.displayPointText(map, new Point(map.extent.xmax, map.extent.ymin, map.spatialReference), "BR");









                var startPtW = new Point(map.extent.xmin, map.extent.ymax, map.spatialReference);
                var startPtL = new Point(map.extent.xmin, map.extent.ymax, map.spatialReference);
                this.displayPointText(map, startPtW, "0");
                for (var index = 1; index <= totalBoxesW + 1; index++) {
                    startPtW = this.destination(startPtW, widthEach, 90, 'meters');
                    this.displayPointText(map, startPtW, "");
                    if (index !== 0) startPtL = startPtW;

                    for (var i = 1; i < totalBoxesL - 2; i++) {
                        startPtL = this.destination(startPtL, lengthEach, 180, 'meters');
                        this.displayPointText(map, startPtL, "**");

                    }


                }


                var startPtW = map.toMap(new ScreenPoint(0, 0));
                this.displayPointText(map, startPtW, "0");
                for (var index = 1; index <= totalBoxesW + 2; index++) {
                    startPtW = this.destination(startPtW, widthEach, 90, 'meters');
                    this.displayPointText(map, startPtW, index);
                }


                var startPtL = map.toMap(new ScreenPoint(0, 0));
                startPtL = this.destination(startPtL, lengthEach, 180, 'meters');
                this.displayPointText(map, startPtL, "0");
                for (var index = 1; index <= totalBoxesL + 2; index++) {
                    startPtL = this.destination(startPtL, lengthEach, 90, 'meters');
                    this.displayPointText(map, startPtL, index);
                }
                ladderingLayer.add(g);
            },


            animate_laddering: function (map, clickPt, lyr, labelLayer, startGraphic, animDuration, excludeOthers) {
                if (startGraphic.symbol.type === "textsymbol") return;
                if(excludeOthers === undefined) excludeOthers = false;
                if(animDuration === undefined) animDuration = 500;
                var inGraphicsArr = [];

                var coords = this.get_graphic_extent(map, startGraphic);
                var polygon = coords.polygon;
                var geomPoly;
                for (var j = 0; j < lyr.graphics.length; j++) {
                    if(excludeOthers === true && lyr.graphics[j].drawEssentials.SYM_GEO_TYPE === "FPoint" && lyr.graphics[j].drawEssentials.SIDC.substr(4,2) === "10") {
                        geomPoly = this.get_graphic_extent(map, lyr.graphics[j]);
                    } else if(excludeOthers === false) {
                       geomPoly = this.get_graphic_extent(map, lyr.graphics[j]);         
                    } else {
                                geomPoly = undefined;                                
                    }

                    
                    if (geomPoly !== undefined) {
                        //if(geometryEngine.overlaps(geomPoly, polygon) || geometryEngine.contains(geomPoly, polygon) || geometryEngine.crosses(geomPoly, polygon)) {
                        if (!geometryEngine.disjoint(geomPoly.polygon, polygon)) {
                            polygon = geometryEngine.union([geomPoly.polygon, polygon]);
                            inGraphicsArr.push(lyr.graphics[j]);
                        }
                    }
                }
                var inGraphicCount = inGraphicsArr.length;

                if (inGraphicCount > 1) {
                    //inGraphicsArr.push(startGraphic);
                } else {
                    return;
                }

                
                /*
                var circleGeometry = new Circle({
                    center: startGraphic.geometry,
                    radius: (map.getScale() / 1000) * inGraphicsArr.length * 2,
                    numberOfPoints: inGraphicsArr.length,
                    radiusUnit: "esriMeters"
                });
                */

                //(map.getNumLevels() - map.getLevel()) * inGraphicsArr.length / 2                
                /*
                var sfs = new SimpleFillSymbol(SimpleFillSymbol.STYLE_SOLID, new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new Color([255, 0, 0]), 2), new Color([255, 255, 0, 0.25]));
                map.graphics.clear();
                map.graphics.add(new _Graphic(this.getLadderExtent(map, inGraphicsArr), sfs));
                */


                /*
                var sfs = new SimpleFillSymbol(SimpleFillSymbol.STYLE_SOLID, new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new Color([255, 0, 0]), 2), new Color([255, 255, 0, 0.25]));
                map.graphics.clear();
                map.graphics.add(new _Graphic(polygon, sfs));
                */


                this.animate_graphics_in_ladder(map, labelLayer, inGraphicsArr, animDuration, clickPt);

            },



            animate_cartwheel: function (map, lyr, labelLayer, startGraphic) {
                if (startGraphic.symbol.type === "textsymbol") return;
                var inGraphicsArr = [];

                var coords = this.get_graphic_extent(map, startGraphic);
                var polygon = coords.polygon;
                for (var i = 0; i < lyr.graphics.length; i++) {
                    var geomPoly = this.get_graphic_extent(map, lyr.graphics[i]);
                    if (geomPoly !== undefined) {
                        //if(geometryEngine.overlaps(geomPoly, polygon) || geometryEngine.contains(geomPoly, polygon) || geometryEngine.crosses(geomPoly, polygon)) {
                        if (!geometryEngine.disjoint(geomPoly.polygon, polygon)) {
                            polygon = geometryEngine.union([geomPoly.polygon, polygon]);
                            inGraphicsArr.push(lyr.graphics[i]);
                        }
                    }
                }
                var inGraphicCount = inGraphicsArr.length;

                if (inGraphicCount > 1) {
                    //inGraphicsArr.push(startGraphic);
                } else {
                    return;
                }

                var circleGeometry = new Circle({
                    center: startGraphic.geometry,
                    radius: (map.getScale() / 1000) * inGraphicsArr.length * 2,
                    numberOfPoints: inGraphicsArr.length,
                    radiusUnit: "esriMeters"
                });



                //(map.getNumLevels() - map.getLevel()) * inGraphicsArr.length / 2


                /*
                var sfs = new SimpleFillSymbol(SimpleFillSymbol.STYLE_SOLID, new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new Color([255, 0, 0]), 2), new Color([255, 255, 0, 0.25]));
                map.graphics.clear();
                map.graphics.add(new _Graphic(polygon, sfs));
                */


                this.animate_graphics_in_circle(map, labelLayer, inGraphicsArr, circleGeometry);
            },


            get_graphic_extent: function (map, gr) {
                var x, y, height, width;
                var screen_coords = {};
                var map_coords = {};
                if (gr.symbol.type === 'textsymbol') return;

                if (gr.drawEssentials.SYM_GEO_TYPE === "Point") {
                    var screenPt = map.toScreen(gr.geometry);
                    x = screenPt.x;
                    y = screenPt.y;

                    height = gr.symbol.size;
                    width = gr.symbol.size;

                } else if (gr.drawEssentials.SYM_GEO_TYPE === "FPoint") {
                    var dojoShape = gr.getDojoShape();
                    if (dojoShape === null) return;
                    //x = dojoShape.shape.x;
                    //y = dojoShape.shape.y;

                    var screenPt = map.toScreen(gr.geometry);
                    x = screenPt.x;
                    y = screenPt.y;
                    
                    /*
                    height = gr.symbol.height;
                    width = gr.symbol.width;
                    */

                    var grHW = this.getSymbolSize(gr.drawEssentials.SIDC, {
                        "size": gr.drawEssentials.OPTIONS.size
                    });

                    height = grHW.height;
                    width = grHW.width;

                } else {
                    return;
                }

                //Top Left
                var top_left_screen_pt = new ScreenPoint(x, y)
                var top_left_map_pt = map.toMap(top_left_screen_pt);
                //this.displayPointText(map, top_left_map_pt, "TL");

                screen_coords.TL = {
                    'x': top_left_screen_pt.x,
                    'y': top_left_screen_pt.y
                };
                map_coords.TL = {
                    'x': top_left_map_pt.x,
                    'y': top_left_map_pt.y
                };


                //Bottom Left

                var bottom_left_screen_pt = new ScreenPoint(top_left_screen_pt.x, top_left_screen_pt.y + height)
                var bottom_left_map_pt = map.toMap(bottom_left_screen_pt);
                //this.displayPointText(map, bottom_left_map_pt, "BL");

                screen_coords.BL = {
                    'x': bottom_left_screen_pt.x,
                    'y': bottom_left_screen_pt.y
                };
                map_coords.BL = {
                    'x': bottom_left_map_pt.x,
                    'y': bottom_left_map_pt.y
                };



                //Top Right

                var top_right_screen_pt = new ScreenPoint(top_left_screen_pt.x + width, top_left_screen_pt.y)
                var top_right_map_pt = map.toMap(top_right_screen_pt);
                //this.displayPointText(map, top_right_map_pt, "TR");

                screen_coords.TR = {
                    'x': top_right_screen_pt.x,
                    'y': top_right_screen_pt.y
                };
                map_coords.TR = {
                    'x': top_right_map_pt.x,
                    'y': top_right_map_pt.y
                };



                //Bottom Right                    
                var bottom_right_screen_pt = new ScreenPoint(top_left_screen_pt.x + width, top_left_screen_pt.y + height)
                var bottom_right_map_pt = map.toMap(bottom_right_screen_pt);
                //this.displayPointText(map, bottom_right_map_pt, "BR");

                screen_coords.BR = {
                    'x': bottom_right_screen_pt.x,
                    'y': bottom_right_screen_pt.y
                };
                map_coords.BR = {
                    'x': bottom_right_map_pt.x,
                    'y': bottom_right_map_pt.y
                };

                //Create Polygon to be returned
                var polygon = new Polygon(map.spatialReference);

                /*
                polygon.addRing([map_coords.TL, map_coords.TR]);
                polygon.addRing([map_coords.TR, map_coords.BR]);
                polygon.addRing([map_coords.BR, map_coords.BL]);
                polygon.addRing([map_coords.BL, map_coords.TL]);
                */

                polygon.addRing([map_coords.TL, map_coords.TR, map_coords.BR, map_coords.BL, map_coords.TL]);

                /*
                var sfs = new SimpleFillSymbol(SimpleFillSymbol.STYLE_SOLID, new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new Color([255, 0, 0]), 2), new Color([255, 255, 0, 0.25]));
                map.graphics.add(new _Graphic(polygon, sfs));
                */



                return {
                    screen_coords,
                    map_coords,
                    polygon,
                    height,
                    width
                };

            },


            /***
             * map: Current Map
             * inGraphicsArr: Graphic Array to be animated
             * circle: Circle Geometry
             ***/
            animate_graphics_in_ladder: function (map, labelLayer, inGraphicsArr, animDuration, fromPt) {

                if (animDuration === undefined) {
                    animDuration = 500
                };               
                
                var dirPt;
                /*
                if(dir === "BR") {
                 dirPt = this.getBottomRightQuadrant(map, this.getBottomRightQuadrant(map, map.extent)).getCenter();           
                } else if(dir === "BL"){
                   dirPt = this.getBottomLeftQuadrant(map, this.getBottomLeftQuadrant(map, map.extent)).getCenter();           
                } */

                var dist = (map.getScale() / 800) * inGraphicsArr.length * 2;
                dirPt = this.destination(fromPt, dist, 60, 'meters');
                var res = this.getLadderExtent(map, dirPt, inGraphicsArr);
                
                for (var i = 0; i < inGraphicsArr.length; i++) {                    
                    this.animate_feature(map, labelLayer, inGraphicsArr[i], res.locs, inGraphicsArr.length, i, animDuration);
                }                

                var stemPtArr = [];
                for(var n = 0; n < res.locs.points.length; n++) {
                   var pt = new Point(res.locs.points[n][0], res.locs.points[n][1], map.spatialReference);
                   stemPtArr.push(pt);
                }

                stemPtArr.push(dirPt);
                stemPtArr.push(fromPt);
                
                //Draw Stem Line
                // Draw line from fromPt to dirPt and animate it.
                var stemLineSymbol = new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new Color([255,0,0, 0.5]), 2);
                var stemPolyline = new Polyline(map.spatialReference);
                stemPolyline.addPath(stemPtArr);
                
                var stemGraphic = new _Graphic(stemPolyline, stemLineSymbol);
                map.graphics.add(stemGraphic);

            },





            /***
             * map: Current Map
             * inGraphicsArr: Graphic Array to be animated
             * circle: Circle Geometry
             ***/
            animate_graphics_in_circle: function (map, labelLayer, inGraphicsArr, circle, animDuration) {
                if (circle.declaredClass !== 'esri.geometry.Circle') return;
                if (animDuration === undefined) {
                    animDuration = 500
                };
                var inGraphicCount = inGraphicsArr.length;
                var circleGeometry = new Circle({
                    center: circle.center,
                    radius: circle.radius,
                    numberOfPoints: inGraphicsArr.length,
                    radiusUnit: circle.radiusUnit
                });

                for (var i = 0; i < inGraphicsArr.length; i++) {
                    this.animate_feature(map, labelLayer, inGraphicsArr[i], circleGeometry, inGraphicCount, i, animDuration);
                }

            },



            animate_feature: function (map, labelLayer, graphic, placement_geom, total, num, animDuration) {

                var shape = graphic.getShape();
                if (!shape) return;
                var p1 = graphic.geometry;
                var p2;
                var geomIndex;
                if (placement_geom.type === "multipoint") {
                    p2 = placement_geom.getPoint(num);                    
                } else {
                    if (num === 0) {
                        geomIndex = 0;
                    } else {
                        geomIndex = Math.floor(placement_geom.rings[0].length / total);
                    }
                    p2 = new Point(placement_geom.rings[0][geomIndex * num]);
                }
                this.animate_transform_graphic(map, labelLayer, graphic, p1, p2, animDuration);

                //If graphic is Tactical Point, We need to move its corresponding labels also.
                if (graphic.drawEssentials.SYM_GEO_TYPE === "Point") {
                    //We search for label layer for now, this needs to be passed from callee
                    var child_label_graphics = this.get_child_labels(labelLayer, graphic.id);
                    if (child_label_graphics.length > 0) {
                        for (let index = 0; index < child_label_graphics.length; index++) {
                            const label_gra = child_label_graphics[index];
                            var screen_pt = map.toScreen(p2).offset(label_gra.symbol.xoffset, label_gra.symbol.yoffset);
                            this.animate_transform_graphic(map, labelLayer, label_gra, label_gra.geometry, map.toMap(screen_pt), animDuration);
                        }
                    }
                }
            },

            animate_transform_graphic: function (map, labelLayer, graphic, p1, p2, animDuration) {

                var shape = graphic.getShape();
                if (!shape) return;

                var sp1 = map.toScreen(p1);
                var sp2 = map.toScreen(p2);

                var animTranslate = dojoxGfxFx.animateTransform({
                    duration: animDuration,
                    shape: shape,
                    transform: [{
                            name: "translate",
                            start: [0, 0],
                            end: [sp2.x - sp1.x, sp2.y - sp1.y]
                        },
                        {
                            name: "original"
                        }
                    ],
                    onEnd: lang.hitch([map, graphic, p2], function () {
                        /*
                        var polyline = new Polyline(map.spatialReference);
                        polyline.addPath([graphic.geometry, p2]);
                        var sls = new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new Color([255, 0, 0, 0.4]), 3);
                        var polygraphic = new _Graphic(polyline, sls);
                        map.graphics.add(polygraphic);
                        */

                    })
                });


                var anim = coreFx.combine([animTranslate]).play();
                aspect.after(anim, "onEnd", function (e) {});


            },
            get_child_labels: function (textGraphicLayer, parentId) {
                var child_label_graphics = [];
                for (i = textGraphicLayer.graphics.length - 1; i >= 0; i--) {
                    if (textGraphicLayer.graphics[i].parentId == parentId) {
                        //textGraphicLayer.remove(textGraphicLayer.graphics[i]);
                        child_label_graphics.push(textGraphicLayer.graphics[i]);
                    }

                }
                return child_label_graphics;
            },
            getLadderExtent: function (map, dummyPt, graphics) {
                var graphic;
                var i, width, height;                
                
                var widths = [];
                var resPlgn = new Polygon(map.spatialReference);
                var bottomLeft, bottomRight, topLeft, topRight;
                var locs = new Multipoint(map.spatialReference);

                for (var i = 0; i < graphics.length; i++) {
                    graphic = graphics[i];
                    var hw;
                    if (graphic.drawEssentials.SYM_GEO_TYPE === "Point") {
                        hw = this.get_graphic_extent(map, graphic);
                    } else {
                        hw = this.getSymbolSize(graphic.drawEssentials.SIDC, {
                            "size": graphic.drawEssentials.OPTIONS.size
                        });
                    }

                    
                    width = hw.width;
                    height = hw.height;
                    
                    var dummyScPt = map.toScreen(dummyPt);
                    dummyScPt.x += width * 1.5;
                    dummyScPt.y -= height * 1.5;  //Vertical Gap
                    //Gap b/w each symbol
                    dummyScPt.x -= width * 1.5;
                    widths.push(width * 1.5);

                    dummyPt = map.toMap(dummyScPt);

                    /*
                  |-----------
                  |
                  |
                  * <-----
                  |
                  |
                  |
                    */
                    
                    //this.displayPointText(map, dummyPt, i); impo

                    locs.addPoint(new Point(dummyPt.x, dummyPt.y, map.spatialReference));
                    
                    if (i === 0) {
                        //Bottom Left Corner
                        bottomLeft = new Point(dummyPt.x, dummyPt.y, map.spatialReference);
                    }
                    

                }

                //Get the top right corner

                dummyPt = map.toScreen(dummyPt);
                dummyPt.y -= height;
                dummyPt = map.toMap(dummyPt);
                //this.displayPointText(map, dummyPt, "TL");
                topLeft = new Point(dummyPt.x, dummyPt.y, map.spatialReference);

                /*
                  |-----------*  <-----
                  |
                  |
                  |
                  |
                */

                //Inc last point horiz to cover all symbols

                //Check for largest width
                var largestWidth = widths.sort()[widths.length - 1];
                topRight = map.toScreen(dummyPt);
                topRight.x += largestWidth * 2;
                topRight = map.toMap(topRight);
                //this.displayPointText(map, topRight, "HL");
                //topRight = new Point(horizLast.x, horizLast.y, map.spatialReference);
                //End of Inc last point horiz to cover all symbols


                /*
            |-----------
            |
            |
            |
            |-----------*  <-----
          */

                //Inc stem root point horiz to cover all symbols
                bottomRight = map.toScreen(bottomLeft);
                bottomRight.x += largestWidth * 2;
                bottomRight = map.toMap(bottomRight);


                //End of Inc stem root point horiz to cover all symbols

                resPlgn.addRing([bottomRight, bottomLeft, topLeft, topRight, bottomRight]);
                return {
                    resPlgn,
                    locs
                };
            },

            /*
            Suitable when size of symbol is wanted without counting label size, in other cases use graphic.symbols.width
            */
            getSymbolSize: function (sidc, sizeObj) {
                var sym = new MS.symbol(sidc, sizeObj).getMarker();
                return {
                    'height': sym.height,
                    'width': sym.width
                };
            },


            getPtDistance: function (p1, p2) {
                return this.distance(p1, p2, 'meters');
                /*
                var plyLn = new Polyline(map.spatialReference);
                plyLn.addPath([p1, p2]);
                return geometryEngine.geodesicLength(plyLn, "meters");
                */
            },

            createFishNet : function(extent, precision) {

                //var fishNetSymbol = new SimpleLineSymbol().setColor(new Color([200,200,200, 0.3]));

              var upperLeftPoint;
              var lowerRightPoint;

              upperLeftPoint = new Point(extent.xmin, extent.ymax);
              lowerRightPoint = new Point(extent.xmax, extent.ymin);


              var mapXMin = Math.floor(upperLeftPoint.x, precision);
              var mapXMax = Math.ceil(lowerRightPoint.x, precision);
              var mapYMin = Math.floor(lowerRightPoint.y, precision);
              var mapYMax = Math.ceil(upperLeftPoint.y, precision); 


              
              mapXMin = parseFloat(mapXMin);
              mapYMax = parseFloat(mapYMax);
              mapXMax = parseFloat(mapXMax);
              mapYMin = parseFloat(mapYMin);
              precision = parseFloat(precision);

              var fishNets = [];

              for (var x = mapXMin + precision / 2; x < mapXMax; x = x + precision) {
                        var singlePathPolylineVertical = new Polyline();
                        singlePathPolylineVertical.addPath([[x, mapYMin], [x, mapYMax]]);
                        fishNets.push(singlePathPolylineVertical);

                        //var graphic = new esri.Graphic(singlePathPolylineVertical, fishNetSymbol);
                        //map.graphics.add(graphic);

                    }
                    for (var y = mapYMin + precision/2; y < mapYMax; y = y + precision) {
                        var singlePathPolylineHoriz = new Polyline();
                        singlePathPolylineHoriz.addPath([[mapXMin, y], [mapXMax, y]]);
                        fishNets.push(singlePathPolylineHoriz);


                        //var graphic = new esri.Graphic(singlePathPolylineHoriz, fishNetSymbol);
                        //map.graphics.add(graphic);
                    }

                    return fishNets;

            },

            getRandomLocation: function (latitude, longitude, radiusInMeters, uniform) {

                // Generate two random numbers
                var a = Math.random(),
                    b = Math.random();

                // Flip for more uniformity.
                if (uniform) {
                    if (b < a) {
                        var c = b;
                        b = a;
                        a = c;
                    }
                }

                // It's all triangles.

                // Offsets in meters.
                var northOffset = b * radiusInMeters * Math.cos(2 * Math.PI * a / b);
                var eastOffset = b * radiusInMeters * Math.sin(2 * Math.PI * a / b);

                // Earths radiusInMeters in meters via WGS 84 model.
                var earth = 6378137;
                // Offset coordinates in radians.
                var offsetLatitude = northOffset / earth,
                    offsetLongitude = eastOffset / (earth * Math.cos(Math.PI * (latitude / 180)));

                // Offset position in decimal degrees.
                return new Point(latitude + (offsetLatitude * (180 / Math.PI)), longitude + (offsetLongitude * (180 / Math.PI)))

            }
        };
    });