/**
 * Class Representing Freehand Dotted Arrow.
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



    var FreehandDottedArrow = declare([Evented], {
      declaredClass: "MilitarySymbology.Symbols.FreehandDottedArrow",
      SID: "000007",
      symName: "Freehand - Dotted Arrow",
      symGeometricType: "Line",
      constructor: function (map, isLine) {
        this.map = map;
        this.isLine = isLine;

        this._lineSym;
        this._points = [];
        this._drawType = 1;
        this._teethGap = 30;

        this._geometryType = null;




        this._onClk = this._onClckHdler;
        this._onDblClk = this._onDblClkHandler;
        this._onMM = this._onMMoveHdler;

        this._tGraphic = new _Graphic();




      },


      init: function (options, marker) {


        this._lineSym = marker;
        this._drawType = GeoTools.setDefault(options, "DRAW_TYPE", this._drawType);
        this._teethGap = GeoTools.setDefault(options, "TEETH_GAP", this._teethGap);

        this.map.navigationManager.setImmediateClick(false);
        this.map.disableDoubleClickZoom();


        var drawEssentials = new DrawEssentials();



        if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("GEOM")) {
          this._tGraphic.setGeometry(options.GEOM);

          drawEssentials = this.createDrawEssentials(lang.clone(options.CTRL_PTS), this._drawType, this._teethGap);

          this.__drawEnd(this._tGraphic.geometry, drawEssentials);
          this._clear();

        } else if (options.hasOwnProperty("CTRL_PTS")) {

          drawEssentials = this.createDrawEssentials(lang.clone(options.CTRL_PTS), this._drawType, this._teethGap);
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

      createDrawEssentials: function (ctrlPts, draw_type, teeth_gap) {
        var drawEssentials = new DrawEssentials();
        drawEssentials.SCOPE = this;
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SID = this.SID;
        drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
        drawEssentials.SYM_NAME = this.symName;
        drawEssentials.CTRL_PTS = ctrlPts;
        drawEssentials.AMPLIFIER = this.amplifier;
        drawEssentials.DRAW_TYPE = draw_type;
        drawEssentials.TEETH_GAP = teeth_gap;
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
        switch (drawEssentials.DRAW_TYPE) {
          case 1:
            result = this.createSymbolByLine(pts, drawEssentials, result);
            break;

          case 2:
            result = this.createSymbolByCurve(pts, drawEssentials, result);
            break;



        }

        //Arrow Head
        result.addPath(Shapes.arrowHead(pts[pts.length - 1], GeoTools.ArrowFlanksLen(GeoTools._2PtLen(pts[0], pts[pts.length - 1]), GeoTools._2PtLen(pts[0], pts[pts.length - 1])),
          GeoTools.angleInRadians(pts[pts.length - 2],
            pts[pts.length - 1])));
        //End of Arrow Head


        return result;
        } catch(e) {
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

      cleanUp: function () {


        var drawEss = new DrawEssentials();

        drawEss = this.createDrawEssentials(lang.clone(this._points), this._drawType, this._teethGap);

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

      createSymbolByLine: function (pts, drawEssentials, result) {

        var result = new _Polyline(this.map.spatialReference);
        var paths = [];
        var dottedPaths = [];
        var p1, p2;
        var gapRatio = GeoTools._2PtLen(pts[0], pts[pts.length - 1]);

        gapRatio = gapRatio / this._teethGap;

        var cLenLimit;
        var baseLineLen = GeoTools._2PtLen(pts[0], pts[pts.length - 1]) / 7;
        cLenLimit = baseLineLen / 7;
        if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;

        dottedPaths = GeoTools.getDashPts(pts, [gapRatio, gapRatio]);

        for (var i = 0; i < dottedPaths.length; i += 2) {
          p1 = dottedPaths[i];
          if (dottedPaths[i + 1] != undefined) {
            p2 = dottedPaths[i + 1];
          }
          result.addPath([p1, p2]);


        }




        return result;
      },


      createSymbolByCurve: function (pts, drawEssentials, result) {
        var firstPoint = pts[0];
        var lastPoint = pts[pts.length - 1];
        var res = [];
        var paths = [];
        var dottedPaths = [];
        var p1, p2;
        var gapRatio;
        var cLenLimit;
        var baseLineLen;

        var result = new _Polyline(this.map.spatialReference);
        if (pts.length === 2) {
          result.addPath([lastPoint, firstPoint]);

        } else if (pts.length > 2) {

          var tempArray = [];
          Array.forEach(pts, function (e) {
            tempArray.push({ x: e.x, y: e.y });
          });

          res = this.CreateBezierPath(tempArray, 100, this.map);


          gapRatio = GeoTools._2PtLen(res[0], res[res.length - 1]);

          gapRatio = gapRatio / this._teethGap;


          baseLineLen = GeoTools._2PtLen(res[0], res[res.length - 1]) / 7;
          cLenLimit = baseLineLen / 7;
          if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;

          dottedPaths = GeoTools.getDashPts(res, [gapRatio, gapRatio]);

          for (var i = 0; i < dottedPaths.length; i += 2) {
            p1 = dottedPaths[i];
            if (dottedPaths[i + 1] != undefined) {
              p2 = dottedPaths[i + 1];
            }
            result.addPath([p1, p2]);


          }



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
        return path;

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
    return FreehandDottedArrow;
  });
