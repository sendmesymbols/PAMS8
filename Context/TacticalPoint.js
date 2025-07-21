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
    "MilSymbologyComponents/Shapes", "dojo/text!" + location.origin + "/" + "MilitarySymbology/Data/TacticalPointSymbols.json"],
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
        Shapes, TacticalPointSymbols) {



        var TacticalPoint = declare([Evented], {
            declaredClass: "MilitarySymbology.Symbols.TacticalPoint",
            SIC: "000000",
            symName: "TacticalPoint",
            symGeometricType: "Point",


            constructor: function (map) {
                this.map = map;
                this._ptSymbol;
                this._point;
                this._geometryType = null;
                this.size;
                this.angle;
                this._onClk = this._onClckHdler;
                this._onMM = this._onMMoveHdler;
                this._tGraphic = new _Graphic();
                this._path = "";
                this._offset = 0;
                this.tactPtSymData = JSON.parse(TacticalPointSymbols);



            },


            init: function (options, marker, sic, symName, offset, sidc) {

                this._path = this.tactPtSymData[sidc.substr(4, 2) + sic];
                this._offset = offset;


                if (this._path.length === undefined) {
                    throw "Symbol definition not found";
                } else {
                    this.SIC = sic;
                    this.symName = symName
                    this._ptSymbol = marker;

                    this._ptSymbol.setPath(this._path);
                    this._ptSymbol.setStyle(SimpleMarkerSymbol.STYLE_PATH);

                    if (options.SIZE !== 0) {
                        this._ptSymbol.setSize(options.SIZE);
                    } else {
                        this._ptSymbol.setSize(marker.size);
                    }

                    if (options.ANGLE !== undefined) {
                        this._ptSymbol.setAngle(options.ANGLE);
                    } else {
                        this._ptSymbol.setAngle(marker.angle);
                    }

                    //Center Bottom

                    if (this._offset === "1") {
                        this._ptSymbol.setOffset(0, this._ptSymbol.size / 2);
                    }

                    var drawEssentials = new DrawEssentials();

                    if (options.hasOwnProperty("GEOM")) {
                        this._point = options.GEOM;
                        drawEssentials = this.createDrawEssentials(lang.clone(options.GEOM), lang.clone(options.SIZE), lang.clone(options.ANGLE));
                        this.__drawEnd(options.GEOM, this._ptSymbol, drawEssentials);
                        this._clear();

                    } else {
                        this._tGraphic = new _Graphic(this.map.extent.getCenter(), this._ptSymbol);
                        this.map.graphics.add(this._tGraphic);

                        this._onMM = on(this.map, "mouse-move", lang.hitch(this, this._onMMoveHdler));
                        this._onClk = on(this.map, "click", lang.hitch(this, this._onClckHdler));
                    }




                }

            },

            createDrawEssentials: function (geom, size, angle) {
                var drawEssentials = new DrawEssentials();
                drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
                drawEssentials.SID = this.SIC;
                drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
                drawEssentials.SYM_NAME = this.symName;
                drawEssentials.SIZE = size;
                //drawEssentials.BK_LN_ANGL_RATIO = angle;
                drawEssentials.ANGLE = angle;
                drawEssentials.GEOM = geom;
                drawEssentials.AMPLIFIER = this.amplifier;
                drawEssentials.OFFSET = this._offset;


                return drawEssentials;

            },

            _onMMoveHdler: function (inputPoint) {
                this._tGraphic.setGeometry(inputPoint.mapPoint);
                this.emit("onDrawProgress", { 'currentGeometry': this._tGraphic.geometry, 'currentDrawEssentials': null, 'currentMarker': null });
            },


            _onClckHdler: function (clickPoint) {
                //if(this._offset === "1") {
                //this._point = clickPoint.mapPoint.offset(0, this._ptSymbol.size / 2);
                //} else {
                this._point = clickPoint.mapPoint.offset(0, 0);
                //}


                this.cleanUp();

            },



            cleanUp: function () {

                var drawEss = new DrawEssentials();
                drawEss = this.createDrawEssentials(lang.clone(this._point), this._ptSymbol.size, this._ptSymbol.angle);

                this.__drawEnd(this._point, this._ptSymbol, drawEss);

                this._clear();
                this._removeEvents();
            },

            __drawEnd: function (drawGeometry, symbol, drawEssentials) {
                if (drawGeometry) {

                    var spRef = this.map.spRef, geographicGeometry;

                    spRef && (spRef.isWebMercator() ? geographicGeometry = webMercatorUtils.webMercatorToGeographic(drawGeometry, !0) : 4326 === spRef.wkid && (geographicGeometry = jsonUtility.fromJson(drawGeometry.toJson())));
                    //this._onDrawComplete({ geometry: drawGeometry, geographicGeometry: geographicGeometry });
                    this.__onDrawEnd(drawGeometry, symbol, drawEssentials);
                }
            },


            __onDrawEnd: function (geometry, symbol, drawEssParam) {

                this.emit("onDrawEnd", { 'geometry': geometry, 'marker': symbol, 'drawEssentials': drawEssParam });


            },

            _clear: function () {
                this._point;
                this._tGraphic && this.map.graphics.remove(this._tGraphic);

            },

            _removeEvents: function () {
                this._onClk.remove();
                this._onMM.remove();
                this.map.enableDoubleClickZoom();
            },


            //Deactivates the toolbar and re-activates map navigation.
            deactivate: function () {
                this._clear();
                this._removeEvents();
                this._geometryType = null;

            },

            _onDrawComplete: function (event) {

            }



        });
        return TacticalPoint;
    });