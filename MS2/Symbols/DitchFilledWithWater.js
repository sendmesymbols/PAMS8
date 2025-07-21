/**
 * Class Representing Ditch Filled With Water.
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



        var DitchFilledWithWater = declare([Evented], {
            declaredClass: "MilitarySymbology.Symbols.DitchFilledWithWater",
            SID: "290202",
            symName: "DCB - Filled With Water",
            symGeometricType: "Line",
            isObstacle: "1",
            constructor: function (map, isLine) {
                this.map = map;
                this.isLine = isLine;

                this._lineSym;
                this._points = [];

                this._geometryType = null;


                this._teethSize = 3;
                this._teethGap = 20;
                this._headRatio = 10;
                this._tailRatio = 10;



                this._onClk = this._onClckHdler;
                this._onDblClk = this._onDblClkHandler;
                this._onMM = this._onMMoveHdler;

                this._tGraphic = new _Graphic();




            },


            init: function (options, marker) {


                 this._opacity = 1;

                 if(options.hasOwnProperty('opacity')) {
                    this._opacity = options.opacity;
                }

                this._lineSym = marker;
                this._lineSym = new SimpleFillSymbol(SimpleFillSymbol.STYLE_SOLID, new SimpleLineSymbol(SimpleLineSymbol.SOLID, new color([0, 0, 0, this._opacity]), marker.width), new color([0, 0, 255, this._opacity]));
                this.map.navigationManager.setImmediateClick(false);
                this.map.disableDoubleClickZoom();


                var drawEssentials = new DrawEssentials();
                this._teethSize = GeoTools.setDefault(options, "TEETH_SIZE", this._teethSize);
                this._teethGap = GeoTools.setDefault(options, "TEETH_GAP", this._teethGap);


                if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
                    this._tGraphic.setGeometry(options.GEOM);

                    drawEssentials = this.createDrawEssentials(lang.clone(options.CTRL_PTS), this._teethSize, this._teethGap, this._opacity);

                    this.__drawEnd(this._tGraphic.geometry, drawEssentials);
                    this._clear();

                } else if (options.hasOwnProperty("CTRL_PTS")) {
                    drawEssentials = this.createDrawEssentials(lang.clone(options.CTRL_PTS), this._teethSize, this._teethGap, this._opacity);
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

            createDrawEssentials: function (ctrlPts, teeth_size, teeth_gap, opacity) {
                var drawEssentials = new DrawEssentials();
                drawEssentials.SCOPE = this;
                drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
                drawEssentials.SID = this.SID;
                drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
                drawEssentials.SYM_NAME = this.symName;
                drawEssentials.CTRL_PTS = ctrlPts;
                drawEssentials.AMPLIFIER = this.amplifier;
                drawEssentials.IS_OBS = this.isObstacle;

                drawEssentials.TEETH_SIZE = teeth_size;
                drawEssentials.TEETH_GAP = teeth_gap;
                drawEssentials.opacity = opacity;



                return drawEssentials;
            },



            createSymbol: function (drawEssentials) {
                try {


                    var pts;

                    if (drawEssentials.hasOwnProperty("CTRL_PTS")) {
                        pts = drawEssentials.CTRL_PTS;

                    } else {

                        throw "controlPoints not found"

                    }

                    var result = new _Polygon(this.map.spatialReference);
                    var midPt;
                    var paths = [];
                    var chopPts = [];
                    var firstPoint = pts[0];
                    var secondPoint = pts[1];
                    var lastPoint = pts[pts.length - 1];
                    var secLastPoint = pts[pts.length - 2];
                    var lineStPt, lineEndPt, lineEndPt2;

                    //Shorten Pts according to head and tail ratio


                    var baseLineLen = GeoTools._2PtLen(firstPoint, lastPoint);
                    var cLenLimit = baseLineLen / 10;

                    chopPts = pts;

                    //Create Double Line
                    var firstChopPt = chopPts[0];
                    var lastChopPt = chopPts[chopPts.length - 1];
                    var leftArray = [], rightArray = [], middleArray = [];

                    var len = baseLineLen / 5 / this._teethSize;
                    var k = Math.atan((firstChopPt.y - lastChopPt.y) / (firstChopPt.x - lastChopPt.x));

                    switch (GeoTools.twoPtsRelationShip(firstChopPt, lastChopPt)) {
                        case "ne":
                            k += Math.PI / 2;
                            break;
                        case "nw":
                            k += Math.PI * 3 / 2;
                            break;
                        case "sw":
                            k += Math.PI * 3 / 2;
                            break;
                        case "se":
                            k += Math.PI / 2;
                            break;
                    }


                    var partialLen = len;

                    var p1 = { x: partialLen * Math.cos(k) + firstChopPt.x, y: partialLen * Math.sin(k) + firstChopPt.y };
                    var p2 = { x: -1 * partialLen * Math.cos(k) + firstChopPt.x, y: -1 * partialLen * Math.sin(k) + firstChopPt.y };

                    paths = [];
                    paths = paths.concat(p1, p2);

                    if (chopPts.length >= 1) {
                        leftArray.push(p1);
                        rightArray.push(p2);
                        middleArray.push(firstChopPt);

                        lastChopPt = firstChopPt;

                    }


                    for (i = 0; i < chopPts.length; i++) {

                        //Find distance between candidatePoint and Mid Point
                        var length = GeoTools._2PtLen(firstChopPt, chopPts[i]);
                        var angle = GeoTools.angleInRadians(firstChopPt, chopPts[i]);


                        var stPtCandidatePt = new Point(p1.x + length * Math.cos(angle), p1.y + length * Math.sin(angle), this.map.spatialReference);
                        var endPtCandidatePt = new Point(p2.x + length * Math.cos(angle), p2.y + length * Math.sin(angle), this.map.spatialReference);

                        //len = length / frontLineAgle;
                        len = length / 5;
                        var baseLineLen = GeoTools._2PtLen(stPtCandidatePt, endPtCandidatePt);

                        var baseLineLenLimit = baseLineLen / 4;
                        if (len > baseLineLenLimit) len = baseLineLenLimit;


                        angle = GeoTools.angleInRadians(stPtCandidatePt, endPtCandidatePt);

                        var pt1 = new Point(-1 * len * Math.cos(angle) + stPtCandidatePt.x, -1 * len * Math.sin(angle) + stPtCandidatePt.y, this.map.spatialReference);
                        var pt2 = new Point(len * Math.cos(angle) + endPtCandidatePt.x, len * Math.sin(angle) + endPtCandidatePt.y, this.map.spatialReference);



                        leftArray.push(stPtCandidatePt);
                        rightArray.push(endPtCandidatePt);
                        middleArray.push(chopPts[i]);


                    }

                    //result.addRing(leftArray);
                    //result.addRing(rightArray);
                    result.addRing(middleArray);



                    // End Of Create Double Line

                    //Create MidPts of Left and Right Array

                    var gapRatio = GeoTools._2PtLen(chopPts[0], chopPts[chopPts.length - 1]);

                    gapRatio = gapRatio / this._teethGap;

                    var cLenLimit, echelons;
                    var baseLineLen = GeoTools._2PtLen(chopPts[0], chopPts[chopPts.length - 1]) / 7;
                    cLenLimit = baseLineLen / 7;
                    if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
                    var rightResPts = GeoTools.getDashPts(rightArray, [gapRatio, gapRatio]);
                    var leftResPts = GeoTools.getDashPts(leftArray, [gapRatio, gapRatio]);
                    var middleResPts = GeoTools.getDashPts(middleArray, [gapRatio, gapRatio]);






                    paths = [];
                    for (var i = 1; i < middleResPts.length; i++) {
                        if (i % 2 === 0) {
                            paths.push(leftResPts[i]);
                        } else {
                            paths.push(middleResPts[i]);
                        }



                    }



                    result.addRing(paths);




                    return result;

                } catch (e) {
                    console.log(this.declaredClass + ' Can not create Symbol due to invalid geometry');

                }

            },

            _onMMoveHdler: function (inputPoint) {
                var candidatePoint = inputPoint.mapPoint;

                var drawEssentials = new DrawEssentials();

                drawEssentials.CTRL_PTS = this._points.concat(candidatePoint);


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

                drawEss = this.createDrawEssentials(lang.clone(this._points), this._teethSize, this._teethGap, this._opacity);

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


        });
        return DitchFilledWithWater;
    });
