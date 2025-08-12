/**
 * Class Representing Ethernet.
 * @class
 * @author Naeem Ahmad
 */

define(["dojo/_base/declare", "dojo/_base/lang", "esri/graphic", "esri/geometry/jsonUtils",
    "esri/geometry/webMercatorUtils", "esri/geometry/Polyline", "dojo/on", "dojo/Evented", 
    "MilSymbologyExt/GeoTools", "MilSymbologySymbolsEngine/DrawEssentials",
    "MilSymbologyComponents/Shapes"],
    function (declare, lang, _Graphic, jsonUtility,
        webMercatorUtils, _Polyline, 
        on, Evented, GeoTools, DrawEssentials,
        Shapes) {

        var OFC = declare([Evented], {
            declaredClass: "MilitarySymbology.Symbols.OFC",
            SID: "150210",
            symName: "OFC",
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
                        throw "controlPoints not found";
                    }

                    var result = new _Polyline(this.map.spatialReference);
                    var startingPt = pts[0];
                    var lastPt = pts[pts.length - 1];
                    
                    var values = GeoTools._fracture(pts, 20, this.map.spatialReference);
                    result.paths = result.paths.concat(values.geometry.paths);

                    //Write in between Fractures

                    var cLenLimit;
                    var baseLineLen = GeoTools._2PtLen(startingPt, lastPt);
                    
                    for (var i = 0; i < values.midPoints.length; i++) {
                      cLenLimit = values.midPoints[i].len / 2;
                      if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
                      result.addPath(Shapes.createO(values.midPoints[i].midPt.x, values.midPoints[i].midPt.y, cLenLimit, this.map.spatialReference));
                      
                      var circleRadius = values.midPoints[i].len * 110000;
                      result.addPath(Shapes.createBufferCircle(values.midPoints[i].midPt, circleRadius));
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

                this._tGraphic.setGeometry(this.createSymbol(drawEssentials));
                this.emit("onDrawProgress", { 'currentGeometry': this._tGraphic.geometry, 'currentDrawEssentials': drawEssentials, 'currentMarker': this._lineSym });
            },

            _onClckHdler: function (clickPoint) {
                this._points.push(clickPoint.mapPoint.offset(0, 0));
                if (this._points.length === 1) this._onMM = on(this.map, "mouse-move", lang.hitch(this, this._onMMoveHdler));
                this.emit("onDrawClick", { 'currentPts': this._points});
                if (this.isLine === true && this._points.length === 1) {
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

            }
        });
        return OFC;
    });
