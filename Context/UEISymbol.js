define(["dojo/_base/declare", "dojo/_base/lang", "dojo/_base/array",
    "dojo/_base/connect", "dojo/_base/Color", "dojo/_base/window",
    "dojo/has", "dojo/keys", "dojo/dom-construct",
    "dojo/dom-style", "esri/kernel", "esri/sniff",
    "esri/toolbars/_toolbar", "esri/symbols/PictureMarkerSymbol", "esri/symbols/SimpleLineSymbol",
    "esri/symbols/SimpleFillSymbol", "esri/graphic", "esri/geometry/jsonUtils",
    "esri/geometry/webMercatorUtils", "esri/geometry/Polyline", "esri/geometry/Polygon",
    "esri/geometry/Multipoint", "esri/geometry/Rect", "dojo/i18n!esri/nls/jsapi",
    "dojo/on", "esri/layers/GraphicsLayer", "dojo/Evented",
    "esri/SnappingManager", "esri/geometry/Point", "MilSymbologySymbolsEngine/DrawEssentials"],
    function (declare, lang, Array,
        connect, color, window,
        has, keys, domconstruct,
        domstyle, esriKernel, esriSniff,
        Toolbar, PictureMarkerSymbol, SimpleLineSymbol,
        SimpleFillSymbol, _Graphic, jsonUtility,
        webMercatorUtils, _Polyline, _Polygon,
        Multipoint, Rect, dojoEsrijsapi,
        on, GraphicsLayer, Evented,
        SnappingManager, Point, DrawEssentials) {



        var UEISymbol = declare([Evented], {
            declaredClass: "MilitarySymbology.Symbols.UEISymbol",
            SIC: "000000",
            symName: "UEISymbol",
            symGeometricType: "FPoint",

            constructor: function (map) {
                this.map = map;
                this._ptSymbol;
                this._point;
                this._geometryType = null;
                this.size;
                this._options;
                this._onClk = this._onClckHdler;
                this._onMM = this._onMMoveHdler;
                this._tGraphic = new _Graphic();

                this._height;
                this._width;


                this._ueiData = null;



            },



            init: function (options, marker, sic, symName, offset, sidc) {
                
                this._ueiData = new MS.symbol(sidc, options).getMarker();


                this._options = options;


                this.SIC = sic;
                this.symName = symName

                this._height = this._ueiData.height;
                this._width = this._ueiData.width;



                this._ptSymbol = new PictureMarkerSymbol(this._ueiData.asImage(), this._width, this._height);

                if (options.hasOwnProperty("ANGLE")) {
                    this._ptSymbol.setAngle(options.ANGLE);
                }


                var drawEssentials = new DrawEssentials();

                if (options.hasOwnProperty("GEOM")) {
                    this._point = options.GEOM;
                    drawEssentials = this.createDrawEssentials(lang.clone(options.GEOM), options);
                    this.__drawEnd(options.GEOM, this._ptSymbol, drawEssentials);
                    this._clear();

                } else {
                    this._tGraphic = new _Graphic(this.map.extent.getCenter(), this._ptSymbol);
                    this.map.graphics.add(this._tGraphic);

                    this._onMM = on(this.map, "mouse-move", lang.hitch(this, this._onMMoveHdler));
                    this._onClk = on(this.map, "click", lang.hitch(this, this._onClckHdler));
                }






            },

            createDrawEssentials: function (geom, options) {


                var drawEssentials = new DrawEssentials();
                drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
                drawEssentials.SID = this.SIC;
                drawEssentials.SYM_NAME = this.symName;
                drawEssentials.OPTIONS = options;
                drawEssentials.GEOM = geom;
                drawEssentials.AMPLIFIER = this.amplifier;
                drawEssentials.UEI = "1";

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
                drawEss = this.createDrawEssentials(lang.clone(this._point), this._options);


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
        return UEISymbol;
    });