/**
 * Class Representing Double Fence Wire.
 * @class
 * @author Abdul Razak
 */

define(["dojo/_base/declare", "dojo/_base/lang", "esri/graphic", "esri/geometry/jsonUtils",
    "esri/geometry/webMercatorUtils", "esri/geometry/Polyline", "dojo/on", "dojo/Evented",
    "MilSymbologyExt/GeoTools", "MilSymbologySymbolsEngine/DrawEssentials",
    "MilSymbologyComponents/Shapes"],
    function (declare, lang, _Graphic, jsonUtility,
        webMercatorUtils, _Polyline, on, Evented, GeoTools, DrawEssentials,
        Shapes) {
        var LineOfContact = declare([Evented], {
            declaredClass: "MilitarySymbology.Symbols.LineOfContact",
            SID: "25290310",
            symName: "Line of Contact",
            symGeometricType: "Line",
            constructor: function (map, isLine) {
                this.map = map;
                this.isLine = isLine;

                this._lineSym;
                this._points = [];

                this._geometryType = null;

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

                if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
                    this._tGraphic.setGeometry(options.GEOM);

                    drawEssentials = this.createDrawEssentials(lang.clone(options.CTRL_PTS));

                    this.__drawEnd(this._tGraphic.geometry, drawEssentials);
                    this._clear();

                } else if (options.hasOwnProperty("CTRL_PTS")) {
                    drawEssentials = this.createDrawEssentials(lang.clone(options.CTRL_PTS));
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

            createDrawEssentials: function (ctrlPts) {
                var drawEssentials = new DrawEssentials();
                drawEssentials.SCOPE = this;
                drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
                drawEssentials.SID = this.SID;
                drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
                drawEssentials.SYM_NAME = this.symName;
                drawEssentials.CTRL_PTS = ctrlPts;
                drawEssentials.AMPLIFIER = this.amplifier;
                drawEssentials.IS_OBS = this.isObstacle;

                return drawEssentials;
            },
            createSymbol: function (drawEssentials) {
                try {
                    var pts;

                    if (drawEssentials.hasOwnProperty("CTRL_PTS")) {
                        pts = drawEssentials.CTRL_PTS;
                    } else {
                        throw "controlPoints not found";
                    }

                    var result = new _Polyline(this.map.spatialReference);
                    result.addPath(pts);
                    
                    var gapRatio = GeoTools._2PtLen(pts[0], pts[pts.length - 1]);
                    console.log(gapRatio);
                    //var resPts = GeoTools.getDashPts(pts, [0.001, 0.001]);
                    gapRatio = gapRatio / 10;
                    console.log(gapRatio);
                    var cLenLimit, fins;
                    var baseLineLen = GeoTools._2PtLen(pts[0], pts[pts.length - 1]) / 7;
                    cLenLimit = baseLineLen / 7;
                    if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
                    var resPts = GeoTools.getDashPts(pts, [gapRatio, gapRatio]);
                    console.log(resPts);
                    for (var i = 0; i < resPts.length; i++) {
                        fins = Shapes.createCurvedFins(resPts[i], cLenLimit);
                        for (var j = 0; j <= fins.length - 1; j++) {
                            result.addPath(fins[j]);
                        }
                    }
                    return result;
                }
                catch (e) {
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

                drawEss = this.createDrawEssentials(lang.clone(this._points));

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

            }
        });
        return LineOfContact;
    });
