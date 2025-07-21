/**
 * Class Representing Freehand Supporting Attack Like Arrow.
 *
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



        var FreehandSupportingAttack = declare([Evented], {
            declaredClass: "MilitarySymbology.Symbols.FreehandSupportingAttack",
            SID: "000009",
            symName: "Freehand - Sp Attk Like Arrow",
            symGeometricType: "Area",
            constructor: function (map, isLine) {
                this.map = map;
                this.isLine = isLine;

                this._lineSym;
                this._points = [];

                this._geometryType = null;
                this._arrowHeadRatio;



                this._onClk = this._onClckHdler;
                this._onDblClk = this._onDblClkHandler;
                this._onMM = this._onMMoveHdler;

                this._tGraphic = new _Graphic();
                this._tailFactor = 0.05;
                this._headPercentage = 0.07;



            },


            init: function (options, marker) {


                this._lineSym = marker;
                this.map.navigationManager.setImmediateClick(false);
                this.map.disableDoubleClickZoom();

                this._headPercentage = GeoTools.setDefault(options, "HEAD_RATIO", 0.07);
                this._tailFactor = GeoTools.setDefault(options, "TAIL_FACTOR", 0.05);



                var drawEssentials = new DrawEssentials();
                var baseLine = new BaseLine(this.map, this._lineSym);


                if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
                    this._tGraphic.setGeometry(options.GEOM);

                    drawEssentials = this.createDrawEssentials(lang.clone(options.CTRL_PTS), this._headPercentage, this._tailFactor);

                    this.__drawEnd(this._tGraphic.geometry, drawEssentials);
                    this._clear();

                } else if (options.hasOwnProperty("CTRL_PTS")) {
                    drawEssentials = this.createDrawEssentials(lang.clone(options.CTRL_PTS), this._headPercentage, this._tailFactor);
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

            createDrawEssentials: function (ctrlPts, arrowHeadRatio, tailFactor) {
                var drawEssentials = new DrawEssentials();
                drawEssentials.SCOPE = this;
                drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
                drawEssentials.SID = this.SID;
                drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
                drawEssentials.SYM_NAME = this.symName;
                drawEssentials.CTRL_PTS = ctrlPts;
                drawEssentials.AMPLIFIER = this.amplifier;

                drawEssentials.HEAD_RATIO = arrowHeadRatio;
                drawEssentials.TAIL_FACTOR = tailFactor;
                drawEssentials.ISFHAND = 1;




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

                    arrowHeadRatio = GeoTools.setDefault(drawEssentials, "HEAD_RATIO", 5);
                    if (pts.length <= 2) {
                        var firstPoint = pts[0];
                        var lastPoint = pts[pts.length - 1];

                        var len = GeoTools._2PtLen(firstPoint, lastPoint);
                        var k = Math.atan((firstPoint.y - lastPoint.y) / (firstPoint.x - lastPoint.x));
                        switch (GeoTools.twoPtsRelationShip(firstPoint, lastPoint)) {
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
                        //tail two points
                        var pt1 = { x: this._tailFactor * len * Math.cos(k) + firstPoint.x, y: this._tailFactor * len * Math.sin(k) + firstPoint.y };
                        var pt2 = { x: -1 * this._tailFactor * len * Math.cos(k) + firstPoint.x, y: -1 * this._tailFactor * len * Math.sin(k) + firstPoint.y };
                        var partialLen = (1 - this._headPercentage) * len;
                        var p1 = { x: this._tailFactor * partialLen * Math.cos(k) + firstPoint.x, y: this._tailFactor * partialLen * Math.sin(k) + firstPoint.y };
                        var p2 = { x: -1 * this._tailFactor * partialLen * Math.cos(k) + firstPoint.x, y: -1 * this._tailFactor * partialLen * Math.sin(k) + firstPoint.y };


                        var result = new _Polygon(this.map.spatialReference);
                        var ring = [];
                        ring.push(pt1);


                        ring = ring.concat(this.CreateArrowHeadPathEx(p1, lastPoint, p2, len, this._headPercentage, 15));

                        ring.push(p2);

                        !_Polygon.prototype.isClockwise(ring) && !this.respectDrawingVertexOrder && (console.debug(this.declaredClass + " :  Polygons drawn in anti-clockwise direction will be reversed to be clockwise."), ring.reverse());
                        result.addRing(ring);





                    }
                    else {
                        var leftArray = [], rightArray = [];

                        var result = new _Polygon(this.map.spatialReference);

                        var lastPoint = pts[pts.length - 1];
                        tempArray = []; var leftArray = [], rightArray = [];
                        Array.forEach(pts, function (e) {
                            tempArray.push({ x: e.x, y: e.y });
                        });


                        angleArray = GeoTools._vertexAngle(tempArray);
                        var totalL = GeoTools._ptCollectionLen(tempArray, 0);
                        for (var i = 0, len = tempArray.length - 1; i < len; i++) {
                            partialLen = GeoTools._ptCollectionLen(tempArray, i);
                            partialLen += totalL / 2.4;
                            //console.log(partialLen);

                            pt1 = { x: (this._tailFactor) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x, y: (this._tailFactor) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y };
                            pt2 = { x: -1 * (this._tailFactor) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x, y: -1 * (this._tailFactor) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y };

                            leftArray.push(pt1);
                            rightArray.push(pt2);
                        }

                        leftArray.push({ x: lastPoint.x, y: lastPoint.y });
                        rightArray.push({ x: lastPoint.x, y: lastPoint.y });

                        leftArray = Shapes.CreateBezierPathPCOnly(leftArray, 70);
                        leftArray.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);

                        rightArray = Shapes.CreateBezierPathPCOnly(rightArray, 70);
                        rightArray.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);

                        var headPath = this.CreateArrowHeadPathEx(leftArray[leftArray.length - 1], lastPoint, rightArray[rightArray.length - 1], GeoTools._ptCollectionLen(tempArray, 0), this._headPercentage, 15);

                        ring = [];
                        ring = ring.concat(leftArray);
                        ring = ring.concat(headPath);
                        ring = ring.concat(rightArray.reverse());

                        result.addRing(ring);
                    }



                    return result;
                } catch (e) {
                    console.log(this.declaredClass + ' Can not create Symbol due to invalid geometry');

                }



            },

            getBaseLinePts: function () {
                return this._baseLinePts;
            },

            _onMMoveHdler: function (inputPoint) {
                var candidatePoint = inputPoint.mapPoint;

                var drawEssentials = new DrawEssentials();

                drawEssentials.CTRL_PTS = this._points.concat(candidatePoint);
                drawEssentials.BASE_LN_PTS = this._baseLinePts;

                drawEssentials.BK_LN_DIST_RATIO = this.backLineDist;
                drawEssentials.BK_LN_ANGL_RATIO = this.backLineAngle;

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

                drawEss = this.createDrawEssentials(lang.clone(this._points), this._headPercentage, this._tailFactor);

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
                this._baseLinePts = [];
                this._curvePt1 = this._curvePt2 = null;


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
            CreateArrowHeadPathEx: function (pt1, candidatePt, pt2, totalLen, headPercentage, headAngle, straight) {

                //var headSizeBaseRatio = 1.7;
                var headSizeBaseRatio = 1.07;
                //set result = 0 to create single line arrow like -------->
                var headBaseLen = totalLen * headPercentage;


                var headSideLen = headBaseLen * headSizeBaseRatio;
                var angle1 = GeoTools.twoPtsAngle(candidatePt, pt1);
                var angle2 = GeoTools.twoPtsAngle(candidatePt, pt2);

                var midAngle = (Math.abs(angle1 - angle2)) / 2;
                if (Math.abs(angle1 - angle2) > Math.PI * 1.88) midAngle += Math.PI;
                var len = Math.sqrt(headBaseLen * headBaseLen + headSideLen * headSideLen - 2 * headSideLen * headBaseLen * Math.cos(midAngle + headAngle / 180 * Math.PI));
                var upAngle = Math.asin(headBaseLen * Math.sin(midAngle + headAngle / 180 * Math.PI) / len);
                var centAngle = upAngle + headAngle / 180 * Math.PI;
                var result;
                result = (straight == false || straight == undefined) ? (headBaseLen * Math.sin(Math.PI - centAngle - midAngle) / Math.sin(centAngle)) : 0;
                var path = [];

                path.push({ x: candidatePt.x + result * Math.cos(angle1), y: candidatePt.y + result * Math.sin(angle1) });
                path.push({ x: candidatePt.x + headSideLen * Math.cos(angle1 - headAngle / 180 * Math.PI), y: candidatePt.y + headSideLen * Math.sin(angle1 - headAngle / 180 * Math.PI) });
                path.push(candidatePt);
                path.push({ x: candidatePt.x + headSideLen * Math.cos(angle2 + headAngle / 180 * Math.PI), y: candidatePt.y + headSideLen * Math.sin(angle2 + headAngle / 180 * Math.PI) });
                path.push({ x: candidatePt.x + result * Math.cos(angle2), y: candidatePt.y + result * Math.sin(angle2) });
                return path;

            },








        });
        return FreehandSupportingAttack;
    });
