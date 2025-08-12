/**
 * Class Representing Tactical Point Text.
 *
 * @class
 * @author Abdul Razak
 */

define(["dojo/_base/declare", "dojo/_base/lang", "dojo/_base/Color", "esri/symbols/SimpleMarkerSymbol",
    "esri/symbols/SimpleLineSymbol", "esri/symbols/SimpleFillSymbol", "esri/graphic", "esri/geometry/jsonUtils",
    "esri/geometry/webMercatorUtils", "dojo/on", "dojo/Evented", "MilSymbologySymbolsEngine/TextBoxEngine",
    "MilSymbologySymbolsEngine/DrawEssentials",
    "dojo/text!" + location.origin + "/" + "MilitarySymbology/Data/TacticalPointSymbols.json"],
        function (declare, lang, color, SimpleMarkerSymbol, SimpleLineSymbol,
                SimpleFillSymbol, Graphic, jsonUtility,
                webMercatorUtils, on, Evented, TextBoxEngine,
                DrawEssentials, TacticalPointSymbols) {

            var TacticalPointTextBox = declare([Evented], {
                declaredClass: "MilitarySymbology.Symbols.TacticalPointTextBox",
                SIC: "000111",
                symName: "TacticalPointTextBox",
                symGeometricType: "Point",
                constructor: function (map) {
                    this.map = map;
                    this._ptSymbol;
                    this._point;
                    this._options;
                    this._onClk = this._onClckHdler;
                    this._onMM = this._onMMoveHdler;
                    this._tGraphic = new Graphic();
                    this._path = "";
                    this.tactPtSymData = JSON.parse(TacticalPointSymbols);
                },
                init: function (options, marker, sic, symName, offset, sidc) {

                    this._options = options;

                    this._path = this.tactPtSymData[sidc.substr(4, 2) + sic];

                    if (this._path.length === undefined) {
                        throw "Symbol definition not found";
                    } else {
                        this.SIC = sic;
                        this.symName = symName;
                        this._ptSymbol = marker;

                        this._ptSymbol.setPath(this._path);
                        this._ptSymbol.setStyle(SimpleMarkerSymbol.STYLE_PATH);

                        var drawEssentials = new DrawEssentials();

                        if (options.hasOwnProperty("GEOM")) {
                            this._point = options.GEOM;
                            drawEssentials = this.createDrawEssentials(lang.clone(options.GEOM));

                            this.__drawEnd(options.GEOM, this._ptSymbol, drawEssentials);
                            this._clear();

                        } else {
                            this._tGraphic = new Graphic(this.map.extent.getCenter(), this._ptSymbol);
                            this.map.graphics.add(this._tGraphic);

                            this._onMM = on(this.map, "mouse-move", lang.hitch(this, this._onMMoveHdler));
                            this._onClk = on(this.map, "click", lang.hitch(this, this._onClckHdler));
                        }

                    }

                },
                createDrawEssentials: function (geom) {
                    var drawEssentials = new DrawEssentials();
                    drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
                    drawEssentials.SID = this.SIC;
                    drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
                    drawEssentials.SYM_NAME = this.symName;
                    drawEssentials.GEOM = geom;
                    drawEssentials.AMPLIFIER = this.amplifier;
                    drawEssentials.ISFHAND = 1;
                    return drawEssentials;

                },
                _onMMoveHdler: function (inputPoint) {
                    this._tGraphic.setGeometry(inputPoint.mapPoint);
                    this.emit("onDrawProgress", {'currentGeometry': this._tGraphic.geometry, 'currentDrawEssentials': null, 'currentMarker': null});
                },
                _onClckHdler: function (clickPoint) {
                    this._point = clickPoint.mapPoint.offset(0, 0);
                    this.cleanUp();
                },
                cleanUp: function () {

                    var drawEss = new DrawEssentials();
                    drawEss = this.createDrawEssentials(lang.clone(this._point));

                    this._ptSymbol.setColor(new color([255, 255, 255, 1]));
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

                    var textBoxGeometry = geometry;
                    var labelText = drawEssParam.AMPLIFIER.MULTI_LINE_LABEL_TEXT;
                    if (labelText && labelText !== "" && drawEssParam.SYM_NAME === "Freehand - TextBox") {
                        var boxOutlineColor = [0, 0, 0];
                        var fontSize = 15;
                        var textAlign = "center";
                        var alphaOpacity = 1;

                        if (drawEssParam.AMPLIFIER.MULTI_LINE_LABEL_COLOR) {
                            boxOutlineColor = this.hexToRgb(drawEssParam.AMPLIFIER.MULTI_LINE_LABEL_COLOR);
                        }
                        if (drawEssParam.AMPLIFIER.MULTI_LINE_LABEL_ALIGN) {
                            textAlign = drawEssParam.AMPLIFIER.MULTI_LINE_LABEL_ALIGN;
                        }

                        if (this._options.labelOptions) {
                            if (this._options.labelOptions.textSize) {
                                fontSize = Number(this._options.labelOptions.textSize);
                            }
                            if (this._options.labelOptions.textAlign) {
                                alphaOpacity = this._options.labelOptions.alpha;
                            }
                        }

                        symbol = new SimpleFillSymbol();
                        symbol.setColor(new color([0, 0, 0, alphaOpacity]));
                        symbol.setStyle(SimpleFillSymbol.STYLE_NULL);
                        symbol.setOutline(new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new color([boxOutlineColor[0], boxOutlineColor[1], boxOutlineColor[2], alphaOpacity]), 3));

                        var tboxEngine = new TextBoxEngine(this.map, geometry, fontSize, labelText, textAlign);
                        textBoxGeometry = tboxEngine.drawTextBBox();
                    }
                    this.emit("onDrawEnd", {'geometry': textBoxGeometry, 'marker': symbol, 'drawEssentials': drawEssParam, 'textPtGeom': geometry});

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

                },
                _onDrawComplete: function (event) {

                },
                hexToRgb: function (hex) {
                    if (hex.charAt(0) === '#') {
                        hex = hex.substr(1);
                    }

                    if ((hex.length < 2) || (hex.length > 6)) {
                        return false;
                    }

                    var values = hex.split(''),
                            r, g, b;
                    if (hex.length === 6) {
                        r = parseInt(values[0].toString() + values[1].toString(), 16);
                        g = parseInt(values[2].toString() + values[3].toString(), 16);
                        b = parseInt(values[4].toString() + values[5].toString(), 16);
                    }

                    return [r, g, b];
                }

            });
            return TacticalPointTextBox;
        });