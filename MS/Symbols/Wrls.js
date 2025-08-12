/**
 * Class Representing 25150212.
 * @class
 * @author Naeem Ahmad
 */

define(["dojo/_base/declare", "dojo/_base/lang", "esri/graphic", "esri/geometry/jsonUtils",
  "esri/geometry/webMercatorUtils", "esri/geometry/Polyline", 
  "dojo/on", "dojo/Evented",
  "esri/geometry/Point", "MilSymbologyExt/GeoTools", "MilSymbologySymbolsEngine/DrawEssentials",
  "MilSymbologyComponents/Shapes"],
  function (declare, lang, _Graphic, jsonUtility,
    webMercatorUtils, _Polyline, on, Evented,
    Point, GeoTools, DrawEssentials,
    Shapes) {

    var Wrls = declare([Evented], {
      declaredClass: "MilitarySymbology.Symbols.Wrls",
      SID: "150212",
      symName: "Wrls",
      symGeometricType: "Line",
      constructor: function (map, isLine) {
        this.map = map;
        this.isLine = isLine;

        this._lineSym;
        this._points = [];

        this._geometryType = null;

        this._echlon = 0;

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

        this._echlon = options.ECHLON;
        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
          this._tGraphic.setGeometry(options.GEOM);

          drawEssentials = this.createDrawEssentials(lang.clone(options.CTRL_PTS), options.ECHLON);

          this.__drawEnd(this._tGraphic.geometry, drawEssentials);
          this._clear();

        } else if (options.hasOwnProperty("CTRL_PTS")) {
          drawEssentials = this.createDrawEssentials(lang.clone(options.CTRL_PTS), options.ECHLON);
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

      createDrawEssentials: function (ctrlPts, echlon) {
        var drawEssentials = new DrawEssentials();
        drawEssentials.SCOPE = this;
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.CTRL_PTS = ctrlPts;
        drawEssentials.AMPLIFIER = this.amplifier;
        drawEssentials.ECHLON = echlon;
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
          var secondPoint = pts[1];
          var firstPoint = pts[0];

          //First Point

          var midPt = GeoTools.getMidPoint(firstPoint, secondPoint);
          var length = GeoTools._2PtLen(firstPoint, midPt) / 3;
          var angle = GeoTools.toDegrees(16); // In Degrees

          var rightWing = new Point(midPt.x + length * Math.cos(this.toRad(angle)),
            midPt.y + length * Math.sin(this.toRad(angle)), this.map.spatialReference);

          angle = GeoTools.angleInRadians(rightWing, secondPoint);
          var gapPt = new Point(rightWing.x + length * 2 * Math.cos(angle),
            rightWing.y + length * 2 * Math.sin(angle), this.map.spatialReference);

          result.addPath([firstPoint, midPt, rightWing, gapPt]);

          if (pts.length === 3) {
            var thirdPt = pts[2];

            midPt = GeoTools.getMidPoint(thirdPt, secondPoint);
            length = GeoTools._2PtLen(thirdPt, midPt) / 3;
            angle = GeoTools.toDegrees(-32); // In Degrees

            var leftWing = new Point(midPt.x + length * Math.cos(GeoTools.toRad(angle)),
              midPt.y + length * Math.sin(GeoTools.toRad(angle)), this.map.spatialReference);

            angle = GeoTools.angleInRadians(leftWing, secondPoint);
            gapPt = new Point(leftWing.x + length * 2 * Math.cos(angle),
              leftWing.y + length * 2 * Math.sin(angle), this.map.spatialReference);

            result.addPath([thirdPt, midPt, leftWing, gapPt]);
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
        drawEssentials.ECHLON = this._echlon;

        this._tGraphic.setGeometry(this.createSymbol(drawEssentials));
        this.emit("onDrawProgress", { 'currentGeometry': this._tGraphic.geometry, 'currentDrawEssentials': drawEssentials, 'currentMarker': this._lineSym });

      },

      _onClckHdler: function (clickPoint) {
        this._points.push(clickPoint.mapPoint.offset(0, 0));
        if (this._points.length == 1) this._onMM = on(this.map, "mouse-move", lang.hitch(this, this._onMMoveHdler));
        this.emit("onDrawClick", { 'currentPts': this._points});
        if (this._points.length == 3) {
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

        drawEss = this.createDrawEssentials(lang.clone(this._points), this._echlon);

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
      _arrowHead: function (candidatePoint, length, angle, angle2) {

        var path = [];
        var rightWing = new Point(candidatePoint.x + length * Math.cos(this.toRad(angle)),
          candidatePoint.y + length * Math.sin(this.toRad(angle)), this.map.spatialReference);

        var leftWing = new Point(candidatePoint.x + length * Math.cos(this.toRad(angle2)),
          candidatePoint.y + length * Math.sin(this.toRad(angle2)), this.map.spatialReference);

        path = path.concat(rightWing, candidatePoint, leftWing);
        return path;
      },
      toDegrres: function (rad) {
        //return rad*(180/Math.PI);
        var angleDeg = rad * (180 / Math.PI);

        var result = ((angleDeg + 360) % 360).toFixed(1); //Converting -ve to +ve (0-360)
        if (isNaN(result)) result = 0;
        return result;

      },
      toRad: function (deg) {
        return deg * (Math.PI / 180);
      },
      angleRadians: function (p1, p2) {
        //var res = Math.atan2(polylineGeom.getPoint(0,1).y - polylineGeom.getPoint(0,0).y, polylineGeom.getPoint(0,1).x - polylineGeom.getPoint(0,0).x);
        var res = Math.atan2(p2.y - p1.y, p2.x - p1.x);

        return res;
      }
    });
    return Wrls;
  });
