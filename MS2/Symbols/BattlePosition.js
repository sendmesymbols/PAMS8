/**
 * Class Representing Battle Position.
 * @class
 * @author Abdul Razak
 */

define(["dojo/_base/declare", "dojo/_base/lang", "dojo/_base/array",
    "dojo/_base/connect", "dojo/_base/Color", "dojo/_base/window",
    "dojo/has", "dojo/keys", "dojo/dom-construct",
    "dojo/dom-style", "esri/kernel", "esri/sniff",
    "esri/toolbars/_toolbar", "esri/symbols/SimpleMarkerSymbol", "esri/symbols/SimpleLineSymbol",
    "esri/symbols/SimpleFillSymbol", "esri/graphic", "esri/geometry/jsonUtils",
    "esri/geometry/webMercatorUtils", "esri/geometry/Polyline", "esri/geometry/Polygon",
    "esri/geometry/Multipoint", "esri/geometry/Rect", "dojo/i18n!esri/nls/jsapi",
    "dojo/on", "esri/layers/GraphicsLayer", "dojo/Evented",
    "esri/SnappingManager", "esri/geometry/Point", "esri/geometry/geometryEngine",
    "esri/geometry/scaleUtils", "MilSymbologyComponents/BaseLine", "MilSymbologyExt/GeoTools", "MilSymbologySymbolsEngine/DrawEssentials",
    "MilSymbologyComponents/Shapes"],
    function (declare, lang, Array,
        connect, color, window,
        has, keys, domconstruct,
        domstyle, esriKernel, esriSniff,
        Toolbar, SimpleMarkerSymbol, SimpleLineSymbol,
        SimpleFillSymbol, _Graphic, jsonUtility,
        webMercatorUtils, _Polyline, _Polygon,
        Multipoint, Rect, dojoEsrijsapi,
        on, GraphicsLayer, Evented,
        SnappingManager, Point, geometryEngine,
        scaleUtils, BaseLine, GeoTools, DrawEssentials,
        Shapes) {



        var BattlePosition = declare([Evented], {
            declaredClass: "MilitarySymbology.Symbols.BattlePosition",
            SID: "151200",
            symName: "Battle Posn",
            symGeometricType: "Area",
            constructor: function (map, isLine) {
                this.map = map;
                this.isLine = isLine;

                this._lineSym;
                this._points = [];

                this._geometryType = null;
                this._arrowHeadRatio;
                this._echelon = 0;
                this._drawType = 1;
                this._face_gap = 0;
                this._FACE_GAP_CONTS = 5;
                this._FACE_GAP_CONTS_ELL = 2;




                this._onClk = this._onClckHdler;
                this._onDblClk = this._onDblClkHandler;
                this._onMM = this._onMMoveHdler;

                this._tGraphic = new _Graphic();




            },


            init: function (options, marker) {


                this._lineSym = marker;
                this.map.navigationManager.setImmediateClick(false);
                this.map.disableDoubleClickZoom();


                var drawEssentials = new DrawEssentials();
                var baseLine = new BaseLine(this.map, this._lineSym);

                this._echelon = options.ECHELON;
                this._drawType = options.DRAW_TYPE;
                this._face_gap = options.FACE_GAP;

                if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
                    this._tGraphic.setGeometry(options.GEOM);

                    drawEssentials = this.createDrawEssentials(lang.clone(options.CTRL_PTS), options.ECHELON, options.DRAW_TYPE, options.FACE_GAP);

                    this.__drawEnd(this._tGraphic.geometry, drawEssentials);
                    this._clear();

                } else if (options.hasOwnProperty("CTRL_PTS")) {
                    drawEssentials = this.createDrawEssentials(lang.clone(options.CTRL_PTS), options.ECHELON, options.DRAW_TYPE, options.FACE_GAP);
                    this._tGraphic.setGeometry(this.createSymbol(drawEssentials));

                    this.__drawEnd(this._tGraphic.geometry, drawEssentials);
                    this._clear();


                } else {

                    this._tGraphic = new _Graphic(null, this._lineSym);
                    this.map.graphics.add(this._tGraphic);


                    this._onClk = on(this.map, "click", lang.hitch(this, this._onClckHdler));
                    this._onDblClk = on(this.map, "dbl-click", lang.hitch(this, this._onDblClkHandler));


                }

            },

            createDrawEssentials: function (ctrlPts, echelon, drawType, face_gap) {
                var drawEssentials = new DrawEssentials();
                drawEssentials.SCOPE = this;
                drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
                drawEssentials.SID = this.SID;
                drawEssentials.SYM_NAME = this.symName;
                drawEssentials.CTRL_PTS = ctrlPts;
                drawEssentials.AMPLIFIER = this.amplifier;
                drawEssentials.ECHELON = echelon;
                drawEssentials.DRAW_TYPE = drawType;
                drawEssentials.FACE_GAP = face_gap;
                return drawEssentials;
            },



            createSymbol: function (drawEssentials) {
                try {

                    var pts, arrowHeadRatio;

                    if (drawEssentials.hasOwnProperty("CTRL_PTS")) {
                        pts = drawEssentials.CTRL_PTS;

                    } else {

                        throw "controlPoints not found"

                    }


                    var lastPoint = pts[pts.length - 1];
                    var firstPoint = pts[0];
                    var result = new _Polyline(this.map.spatialReference);



                    switch (drawEssentials.DRAW_TYPE) {
                        case 1:
                            result = this.createSymbolByLine(pts, firstPoint, lastPoint, drawEssentials, result);
                            break;

                        case 2:
                            result = this.createSymbolByCloseLine(pts, firstPoint, lastPoint, drawEssentials, result);
                            break;

                        case 3:
                            result = this.createSymbolByPerfectEllipse(pts, firstPoint, lastPoint, drawEssentials, result);
                            break;
                    }

                    return result;

                } catch (e) {
                    console.log(this.declaredClass + ' Can not create Symbol due to invalid geometry');

                }




            },

            _onMMoveHdler: function (inputPoint) {
                var candidatePoint = inputPoint.mapPoint;

                var drawEssentials = new DrawEssentials();

                drawEssentials.CTRL_PTS = this._points.concat(candidatePoint);
                drawEssentials.ECHELON = this._echelon;
                drawEssentials.DRAW_TYPE = this._drawType;
                drawEssentials.FACE_GAP = this._face_gap;

                this._tGraphic.setGeometry(this.createSymbol(drawEssentials));
                this.emit("onDrawProgress", { 'currentGeometry': this._tGraphic.geometry, 'currentDrawEssentials': drawEssentials, 'currentMarker': this._lineSym });
                

            },

            _onClckHdler: function (clickPoint) {
                this._points.push(clickPoint.mapPoint.offset(0, 0));
                if (this._points.length == 1) this._onMM = on(this.map, "mouse-move", lang.hitch(this, this._onMMoveHdler));
                this.emit("onDrawClick", { 'currentPts': this._points});
                if (this.isLine == true && this._points.length == 1) {
                    this.emit("onDrawClick", { 'currentPts': this._points});  
                    this.cleanUp();
                }


            },

            _onDblClkHandler: function (clickPoint) {
                this._points.push(clickPoint.mapPoint);
                this.cleanUp();
            },

            cleanUp: function () {


                var drawEss = new DrawEssentials();

                drawEss = this.createDrawEssentials(lang.clone(this._points), this._echelon, this._drawType, this._face_gap);

                this.__drawEnd(this._tGraphic.geometry, drawEss);
                this._clear();
                this._removeEvents();
            },

            __drawEnd: function (drawGeometry, drawEssentials) {
                if (drawGeometry) {

                    var spRef = this.map.spRef, geographicGeometry;

                    spRef && (spRef.isWebMercator() ? geographicGeometry = webMercatorUtils.webMercatorToGeographic(drawGeometry, !0) : 4326 === spRef.wkid && (geographicGeometry = jsonUtility.fromJson(drawGeometry.toJson())));
                    //this._onDrawComplete({ geometry: drawGeometry, geographicGeometry: geographicGeometry });
                    this.__onDrawEnd(drawGeometry, geographicGeometry, drawEssentials);
                }
            },


            __onDrawEnd: function (geometry, geoGeometry, drawEssParam) {

                this.emit("onDrawEnd", { 'geometry': geometry, 'geographicGeometry': geoGeometry, 'drawEssentials': drawEssParam, 'marker': this._lineSym });


            },

            _clear: function () {

                this._tGraphic && this.map.graphics.remove(this._tGraphic);

                this._tGraphic = null;
                this.map.snappingManager && this.map.snappingManager._setGraphic(null);
                this._points = [];



            },

            _removeEvents: function () {
                this._onClk.remove();
                this._onDblClk.remove();
                this._onMM.remove();
                this.map.enableDoubleClickZoom();
            },

            //Deactivates the toolbar and reactivates map navigation.
            deactivate: function () {
                this._clear();
                this._removeEvents();
                this._geometryType = null;

            },





            _onDrawComplete: function (event) {

            },

            CreateBezierPath: function (pointCollection, numberOfPts, map) {
                var position = { x: pointCollection[0].x, y: pointCollection[0].y };
                if (pointCollection[pointCollection.length - 1].x === pointCollection[pointCollection.length - 2].x && pointCollection[pointCollection.length - 1].y === pointCollection[pointCollection.length - 2].y) {
                    pointCollection.pop();
                }
                if (pointCollection[pointCollection.length - 1].x === pointCollection[pointCollection.length - 2].x && pointCollection[pointCollection.length - 1].y === pointCollection[pointCollection.length - 2].y) {
                    pointCollection.pop();
                }
                //pointCollection.push(pt);
                var tween = TweenMax.to(position, numberOfPts, { bezier: pointCollection, ease: Linear.easeNone });
                //ease:Power1.easeInOut  ease: Linear.easeNone
                var path = [];
                var i;
                for (i = 0; i <= numberOfPts; i++) {
                    tween.time(i);
                    path.push({ x: position.x, y: position.y });
                }

                var result = new _Polyline(map.spatialReference);
                result.addPath(path);
                return result;

            },



            getClosestPointOnLines2: function (pXy, aXys) {

                var minDist;
                var fTo;
                var fFrom;
                var x;
                var y;
                var i;
                var dist;

                if (aXys.length > 1) {

                    for (var n = 1; n < aXys.length; n++) {

                        if (aXys[n].x != aXys[n - 1].x) {
                            var a = (aXys[n].y - aXys[n - 1].y) / (aXys[n].x - aXys[n - 1].x);
                            var b = aXys[n].y - a * aXys[n].x;
                            dist = Math.abs(a * pXy.x + b - pXy.y) / Math.sqrt(a * a + 1);
                        }
                        else
                            dist = Math.abs(pXy.x - aXys[n].x)

                        // length^2 of line segment 
                        var rl2 = Math.pow(aXys[n].y - aXys[n - 1].y, 2) + Math.pow(aXys[n].x - aXys[n - 1].x, 2);

                        // distance^2 of pt to end line segment
                        var ln2 = Math.pow(aXys[n].y - pXy.y, 2) + Math.pow(aXys[n].x - pXy.x, 2);

                        // distance^2 of pt to begin line segment
                        var lnm12 = Math.pow(aXys[n - 1].y - pXy.y, 2) + Math.pow(aXys[n - 1].x - pXy.x, 2);

                        // minimum distance^2 of pt to infinite line
                        var dist2 = Math.pow(dist, 2);

                        // calculated length^2 of line segment
                        var calcrl2 = ln2 - dist2 + lnm12 - dist2;

                        // redefine minimum distance to line segment (not infinite line) if necessary
                        if (calcrl2 > rl2)
                            dist = Math.sqrt(Math.min(ln2, lnm12));

                        if ((minDist == null) || (minDist > dist)) {
                            if (calcrl2 > rl2) {
                                if (lnm12 < ln2) {
                                    fTo = 0;//nearer to previous point
                                    fFrom = 1;
                                }
                                else {
                                    fFrom = 0;//nearer to current point
                                    fTo = 1;
                                }
                            }
                            else {
                                // perpendicular from point intersects line segment
                                fTo = ((Math.sqrt(lnm12 - dist2)) / Math.sqrt(rl2));
                                fFrom = ((Math.sqrt(ln2 - dist2)) / Math.sqrt(rl2));
                            }
                            minDist = dist;
                            i = n;
                        }
                    }

                    var dx = aXys[i - 1].x - aXys[i].x;
                    var dy = aXys[i - 1].y - aXys[i].y;

                    x = aXys[i - 1].x - (dx * fTo);
                    y = aXys[i - 1].y - (dy * fTo);

                }

                return { 'x': x, 'y': y, 'index': i, 'fTo': fTo, 'fFrom': fFrom };
            },

            getClosestPointOnLines: function (pXy, aXys) {

                var minDist;
                var fTo;
                var fFrom;
                var x;
                var y;
                var i;
                var dist;

                if (aXys.length > 1) {
                    for (var n = 1; n < aXys.length; n++) {

                        if (aXys[n][0] != aXys[n - 1][0]) {
                            var a = (aXys[n][1] - aXys[n - 1][1]) / (aXys[n][0] - aXys[n - 1][0]);
                            var b = aXys[n][1] - a * aXys[n][0];
                            dist = Math.abs(a * pXy.x + b - pXy.y) / Math.sqrt(a * a + 1);
                        }
                        else
                            dist = Math.abs(pXy.x - aXys[n][0])

                        // length^2 of line segment 
                        var rl2 = Math.pow(aXys[n][1] - aXys[n - 1][1], 2) + Math.pow(aXys[n][0] - aXys[n - 1][0], 2);

                        // distance^2 of pt to end line segment
                        var ln2 = Math.pow(aXys[n][1] - pXy.y, 2) + Math.pow(aXys[n][0] - pXy.x, 2);

                        // distance^2 of pt to begin line segment
                        var lnm12 = Math.pow(aXys[n - 1][1] - pXy.y, 2) + Math.pow(aXys[n - 1][0] - pXy.x, 2);

                        // minimum distance^2 of pt to infinite line
                        var dist2 = Math.pow(dist, 2);

                        // calculated length^2 of line segment
                        var calcrl2 = ln2 - dist2 + lnm12 - dist2;

                        // redefine minimum distance to line segment (not infinite line) if necessary
                        if (calcrl2 > rl2)
                            dist = Math.sqrt(Math.min(ln2, lnm12));

                        if ((minDist == null) || (minDist > dist)) {
                            if (calcrl2 > rl2) {
                                if (lnm12 < ln2) {
                                    fTo = 0;//nearer to previous point
                                    fFrom = 1;
                                }
                                else {
                                    fFrom = 0;//nearer to current point
                                    fTo = 1;
                                }
                            }
                            else {
                                // perpendicular from point intersects line segment
                                fTo = ((Math.sqrt(lnm12 - dist2)) / Math.sqrt(rl2));
                                fFrom = ((Math.sqrt(ln2 - dist2)) / Math.sqrt(rl2));
                            }
                            minDist = dist;
                            i = n;
                        }
                    }

                    var dx = aXys[i - 1][0] - aXys[i][0];
                    var dy = aXys[i - 1][1] - aXys[i][1];

                    x = aXys[i - 1][0] - (dx * fTo);
                    y = aXys[i - 1][1] - (dy * fTo);

                }

                return { 'x': x, 'y': y, 'index': i, 'fTo': fTo, 'fFrom': fFrom };
            },


            createSymbolByLine: function (pts, firstPoint, lastPoint, drawEssentials) {
                var result = new _Polyline(this.map.spatialReference);
                if (pts.length === 2) {
                    result.addPath([lastPoint, firstPoint]);

                } else if (pts.length > 2) {

                    var tempArray = [];
                    Array.forEach(pts, function (e) {
                        tempArray.push({ x: e.x, y: e.y });
                    });

                    result = this.CreateBezierPath(tempArray, 100, this.map);
                    var lastPt = result.paths[0][result.paths[0].length - 1];

                    var midPt = GeoTools.getMidPoint(new Point(lastPt[0], lastPt[1], this.map.spatialReference), result.getPoint(0, 0));
                    var baseLineLen = GeoTools._2PtLen(new Point(lastPt[0], lastPt[1], this.map.spatialReference), result.getPoint(0, 0));

                    var cLenLimit = baseLineLen / 10;
                    if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
                    var echelons = Shapes.createEchelon(drawEssentials.ECHELON, midPt, cLenLimit, GeoTools.angleInRadians(firstPoint, lastPoint));

                    for (var j = 0; j <= echelons.length - 1; j++) {
                        result.addPath(echelons[j]);
                    }

                }

                return result;
            },






            createSymbolByCloseLine: function (pts, firstPoint, lastPoint, drawEssentials) {
                var result = new _Polyline(this.map.spatialReference);
                var paths = [];
                if (pts.length === 2) {
                    result.addPath([lastPoint, firstPoint]);

                } else if (pts.length > 2) {

                    var tempArray = [];
                    Array.forEach(pts, function (e) {
                        tempArray.push({ x: e.x, y: e.y });
                    });


                    tempArray.push({ x: firstPoint.x, y: firstPoint.y });
                    paths = this.CreateBezierPath(tempArray, 100, this.map).paths[0];


                    var midPt = this.getClosestPointOnLines(lastPoint, paths);

                    var frstEndPIndx = midPt.index - this._FACE_GAP_CONTS - Math.floor(GeoTools.setDefault(drawEssentials, "FACE_GAP", this._FACE_GAP_CONTS) / 2);
                    var secStartPIndx = midPt.index + this._FACE_GAP_CONTS + Math.floor(GeoTools.setDefault(drawEssentials, "FACE_GAP", this._FACE_GAP_CONTS) / 2);
                    if (secStartPIndx >= 100) secStartPIndx = 100;


                    result.addPath(paths.slice(0, frstEndPIndx));
                    result.addPath(paths.slice(secStartPIndx, 101));



                    var p1 = new Point(paths[frstEndPIndx][0], paths[frstEndPIndx][1], this.map.spatialReference);
                    var p2 = new Point(paths[secStartPIndx][0], paths[secStartPIndx][1], this.map.spatialReference);



                    var previousDist;
                    var baseLineLen = GeoTools._2PtLen(p1, p2);
                    var cLenLimit = baseLineLen / 10;

                    if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
                    if (isNaN(cLenLimit)) {
                        cLenLimit = previousDist;

                    } else {
                        previousDist = cLenLimit;
                    }
                    var echelons = Shapes.createEchelon(drawEssentials.ECHELON, midPt, cLenLimit, GeoTools.angleInRadians(p1, p2));


                    for (var j = 0; j <= echelons.length - 1; j++) {
                        result.addPath(echelons[j]);
                    }

                }

                return result;
            },

            createSymbolByPerfectEllipse: function (pts, firstPoint, lastPoint, drawEssentials) {
                var result = new _Polyline(this.map.spatialReference);

                if (pts.length === 2) {

                    var firstPtScreen = this.map.toScreen(firstPoint);
                    var lastPtScreen = this.map.toScreen(lastPoint);
                    var widthScreen = lastPtScreen.x - firstPtScreen.x;
                    var heightScreen = lastPtScreen.y - firstPtScreen.y;
                    var paths = Shapes.createEllipse({ center: firstPtScreen, longAxis: widthScreen, shortAxis: heightScreen, numberOfPoints: 60, map: this.map });
                    result.addPath(paths);


                } else if (pts.length > 2) {

                    var secondPt = pts[1];
                    var firstPtScreen = this.map.toScreen(firstPoint);
                    var lastPtScreen = this.map.toScreen(secondPt);
                    var widthScreen = lastPtScreen.x - firstPtScreen.x;
                    var heightScreen = lastPtScreen.y - firstPtScreen.y;
                    var paths = Shapes.createEllipse({ center: firstPtScreen, longAxis: widthScreen, shortAxis: heightScreen, numberOfPoints: 60, map: this.map });

                    var midPt = this.getClosestPointOnLines2(lastPoint, paths);


                    var frstEndPIndx = midPt.index - this._FACE_GAP_CONTS_ELL - Math.floor(GeoTools.setDefault(drawEssentials, "FACE_GAP", this._FACE_GAP_CONTS_ELL) / 2);
                    var secStartPIndx = midPt.index + this._FACE_GAP_CONTS_ELL + Math.floor(GeoTools.setDefault(drawEssentials, "FACE_GAP", this._FACE_GAP_CONTS_ELL) / 2);

                    if (frstEndPIndx <= 0) frstEndPIndx = 0;
                    if (secStartPIndx >= 60) secStartPIndx = 60;


                    result.addPath(paths.slice(0, frstEndPIndx));
                    result.addPath(paths.slice(secStartPIndx, 61));


                    var p1 = new Point(paths[frstEndPIndx].x, paths[frstEndPIndx].y, this.map.spatialReference);
                    var p2 = new Point(paths[secStartPIndx].x, paths[secStartPIndx].y, this.map.spatialReference);


                    var previousDist;
                    var baseLineLen = GeoTools._2PtLen(p1, p2);
                    var cLenLimit = baseLineLen / 10;
                    if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
                    if (isNaN(cLenLimit)) {
                        cLenLimit = previousDist;

                    } else {
                        previousDist = cLenLimit;
                    }
                    var echelons = Shapes.createEchelon(drawEssentials.ECHELON, midPt, cLenLimit, GeoTools.angleInRadians(p1, p2));
                    for (var j = 0; j <= echelons.length - 1; j++) {
                        result.addPath(echelons[j]);
                    }





                }

                return result;
            }


        });
        return BattlePosition;
    });
