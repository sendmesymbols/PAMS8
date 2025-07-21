/**
 * Class Representing Corridors.
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



        var Corridors = declare([Evented], {
            declaredClass: "MilitarySymbology.Symbols.Corridors",
            SID: "110101",
            symName: "Mob Corridors",
            symGeometricType: "Line",
            constructor: function (map, isLine) {
                this.map = map;
                this.isLine = isLine;

                this._lineSym;
                this._points = [];

                this._geometryType = null;

                this._echelon = 0;



                this._onClk = this._onClckHdler;
                this._onDblClk = this._onDblClkHandler;
                this._onMM = this._onMMoveHdler;

                this._tGraphic = new _Graphic();
                this._tailFactor = 0.17;




            },


            init: function (options, marker) {


                this._lineSym = marker;
                this.map.navigationManager.setImmediateClick(false);
                this.map.disableDoubleClickZoom();
                this._tailFactor = GeoTools.setDefault(options, "TAIL_FACTOR", this._tailFactor);


                var drawEssentials = new DrawEssentials();
                var baseLine = new BaseLine(this.map, this._lineSym);

                this._echelon = options.ECHELON;
                if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
                    this._tGraphic.setGeometry(options.GEOM);

                    drawEssentials = this.createDrawEssentials(lang.clone(options.CTRL_PTS), options.ECHELON, this._tailFactor);

                    this.__drawEnd(this._tGraphic.geometry, drawEssentials);
                    this._clear();

                } else if (options.hasOwnProperty("CTRL_PTS")) {
                    drawEssentials = this.createDrawEssentials(lang.clone(options.CTRL_PTS), options.ECHELON, this._tailFactor);
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

            createDrawEssentials: function (ctrlPts, echelon, tailFactor) {
                var drawEssentials = new DrawEssentials();
                drawEssentials.SCOPE = this;
                drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
                drawEssentials.SID = this.SID;
                drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
                drawEssentials.SYM_NAME = this.symName;
                drawEssentials.CTRL_PTS = ctrlPts;
                drawEssentials.AMPLIFIER = this.amplifier;
                drawEssentials.ECHELON = echelon;
                drawEssentials.TAIL_FACTOR = tailFactor;
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

                    var result = new _Polyline(this.map.spatialReference);
                    var lastPoint = pts[pts.length - 1];
                    var firstPoint = pts[0];

                    var midPoints = [];
                    var values = GeoTools._fracture(pts, 20, this.map.spatialReference);


                    //Write in between Fractures
                    for (var i = 0; i < values.midPoints.length; i++) {

                        var k = GeoTools.angleInRadians(pts[i], values.midPoints[i].midPt);
                        var length = GeoTools._2PtLen(pts[i], values.midPoints[i].midPt) / 10;
                        k += 15;
                        var angle = GeoTools.toDegrees(k); // In Degrees
                        k -= 30;
                        var angle2 = GeoTools.toDegrees(k); // In Degrees

                        var cLenLimit;
                        var baseLineLen = GeoTools._2PtLen(pts[i], values.midPoints[i].midPt) / 6;
                        cLenLimit = baseLineLen / 6;
                        if (cLenLimit > baseLineLen / 4) cLenLimit = baseLineLen / 4;

                        var echelons = Shapes.createEchelon(drawEssentials.ECHELON, values.midPoints[i].midPt, cLenLimit, GeoTools.angleInRadians(pts[i], values.midPoints[i].midPt));
                        for (var j = 0; j <= echelons.length - 1; j++) {
                            values.geometry.addPath(echelons[j]);
                        }

                    }


                    //Add Notches

                    var notches = this._createStNotches(firstPoint, pts[1], this._tailFactor);
                    notches[1] = firstPoint;
                    values.geometry.addPath(notches);


                    if (pts.length <= 2) {
                        notches = this._createStNotches(lastPoint, firstPoint, this._tailFactor);
                    } else {
                        notches = this._createStNotches(lastPoint, pts[pts.length - 2], this._tailFactor);
                    }

                    notches[1] = lastPoint;
                    values.geometry.addPath(notches);



                    //End of Notches




                    return values.geometry;

                } catch (e) {
                    console.log(this.declaredClass + ' Can not create Symbol due to invalid geometry');

                }




            },

            _onMMoveHdler: function (inputPoint) {
                var candidatePoint = inputPoint.mapPoint;

                var drawEssentials = new DrawEssentials();

                drawEssentials.CTRL_PTS = this._points.concat(candidatePoint);
                drawEssentials.ECHELON = this._echelon;

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

                drawEss = this.createDrawEssentials(lang.clone(this._points), this._echelon, this._tailFactor);

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

            _createStNotches: function (firstPoint, lastPoint, len) {
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

                k += GeoTools.toRad(45);
                var pt1 = { x: this._tailFactor * len * Math.cos(k) + firstPoint.x, y: this._tailFactor * len * Math.sin(k) + firstPoint.y };
                k -= GeoTools.toRad(90);
                var pt2 = { x: -1 * this._tailFactor * len * Math.cos(k) + firstPoint.x, y: -1 * this._tailFactor * len * Math.sin(k) + firstPoint.y };

                return [pt1, null, pt2]; // Null is space for center pt, to be filled by callee

            },





        });
        return Corridors;
    });
