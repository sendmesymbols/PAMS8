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



        var FreehandLineDotted = declare([Evented], {
            declaredClass: "MilitarySymbology.Symbols.FreehandLineDotted",
            SID: "000003",
            symName: "Freehand - Line Dotted",
            symGeometricType: "Line",

            constructor: function (map, isLine) {
                this.map = map;
                this.isLine = isLine;
                this._lineSym;
                this._points = [];
                this._drawType = 1;
                this._geometryType = null;

                this._onClk = this._onClckHdler;
                this._onDblClk = this._onDblClkHandler;
                this._onMM = this._onMMoveHdler;

                this._tGraphic = new _Graphic();




            },


            init: function (options, marker) {


                this._lineSym = marker;
                this._lineSym.setStyle(SimpleLineSymbol.STYLE_DASH);


                this.map.navigationManager.setImmediateClick(false);
                this.map.disableDoubleClickZoom();


                var drawEssentials = new DrawEssentials();



                this._drawType = GeoTools.setDefault(options, "DRAW_TYPE", this._drawType);


                if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
                    this._tGraphic.setGeometry(options.GEOM);

                    drawEssentials = this.createDrawEssentials(lang.clone(options.CTRL_PTS), this._drawType);

                    this.__drawEnd(this._tGraphic.geometry, drawEssentials);
                    this._clear();

                } else if (options.hasOwnProperty("CTRL_PTS")) {
                    drawEssentials = this.createDrawEssentials(lang.clone(options.CTRL_PTS), this._drawType);
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

            createDrawEssentials: function (ctrlPts, drawType) {
                var drawEssentials = new DrawEssentials();
                drawEssentials.SCOPE = this;
                drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
                drawEssentials.SID = this.SID;
                drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
                drawEssentials.SYM_NAME = this.symName;
                drawEssentials.CTRL_PTS = ctrlPts;
                drawEssentials.AMPLIFIER = this.amplifier;
                drawEssentials.DRAW_TYPE = drawType;
                drawEssentials.ISFHAND = 1;


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

                    var p1 = pts[0];
                    var p2 = pts[pts.length - 1];


                    switch (drawEssentials.DRAW_TYPE) {
                        case 1:
                            result = this.createSymbolByStraightLine(pts);
                            break;

                        case 2:
                            result = this.createSymbolByLine(pts, p1, p2, drawEssentials, result);
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
                drawEssentials.DRAW_TYPE = this._drawType;


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

            createSymbolByStraightLine: function (pts) {
                var result = new _Polyline(this.map.spatialReference);
                result.addPath(pts);

                return result;
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


                }

                return result;
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

            cleanUp: function () {


                var drawEss = new DrawEssentials();

                drawEss = this.createDrawEssentials(lang.clone(this._points), this._drawType);

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
        return FreehandLineDotted;
    });
