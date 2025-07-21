/**
 * Class Representing Freehand Semi Circle.
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



    var FreehandSemiCircle = declare([Evented], {
      declaredClass: "MilitarySymbology.Symbols.FreehandSemiCircle",
      SID: "000130",
      symName: "Freehand - Semi Circle",
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




      },


      init: function (options, marker) {


        this._lineSym = marker;

        this.map.navigationManager.setImmediateClick(false);
        this.map.disableDoubleClickZoom();





        var drawEssentials = new DrawEssentials();
        var baseLine = new BaseLine(this.map, this._lineSym);


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

      find_angle: function (p0, p1, c) {
        var p0c = Math.sqrt(Math.pow(c.x - p0.x, 2) +
          Math.pow(c.y - p0.y, 2)); // p0->c (b)   
        var p1c = Math.sqrt(Math.pow(c.x - p1.x, 2) +
          Math.pow(c.y - p1.y, 2)); // p1->c (a)
        var p0p1 = Math.sqrt(Math.pow(p1.x - p0.x, 2) +
          Math.pow(p1.y - p0.y, 2)); // p0->p1 (c)
        return Math.acos((p1c * p1c + p0c * p0c - p0p1 * p0p1) / (2 * p1c * p0c));
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

          var result = new _Polygon(this.map.spatialReference);

          var startingPt = pts[0];
          var endPt = pts[1];

          if (pts.length === 2) {
            result.addRing([startingPt, endPt]);
          } else if (pts.length === 3) {
            var candidatePoint = pts[2];
            var values;
            var paths = [];
            var circle = this._circleDrawEx(this.map.toScreen(startingPt), this.map.toScreen(endPt), this.map.toScreen(candidatePoint));
            if (circle.radius > 0) {
              values = this.CreateCircleSegmentFromThreePoints(circle, this.map.toScreen(startingPt), this.map.toScreen(endPt), this.map.toScreen(candidatePoint), 60, this.map);
              paths = values.geometry.rings[0];
              result.addRing(paths.slice(0, 60));
              result.addRing([paths[1], paths[59]]);

            }

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


        this._tGraphic.setGeometry(this.createSymbol(drawEssentials));
        this.emit("onDrawProgress", { 'currentGeometry': this._tGraphic.geometry, 'currentDrawEssentials': drawEssentials, 'currentMarker': this._lineSym });

      },

      _onClckHdler: function (clickPoint) {
        this._points.push(clickPoint.mapPoint.offset(0, 0));
        if (this._points.length == 1) this._onMM = on(this.map, "mouse-move", lang.hitch(this, this._onMMoveHdler));
        this.emit("onDrawClick", { 'currentPts': this._points});
        if (this._points.length === 3) {
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

      },

      _circleDrawEx: function (pt1, pt2, pt3) {
        var i;
        var r, m11, m12, m13, m14;
        var a = [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0]
        ];
        var P = [
          [pt1.x, pt1.y],
          [pt2.x, pt2.y],
          [pt3.x, pt3.y]
        ];
        for (i = 0; i < 3; i++)                    // find minor 11
        {
          a[i][0] = P[i][0];
          a[i][1] = P[i][1];
          a[i][2] = 1;
        }
        m11 = this._determinantDrawEx(a, 3);

        for (i = 0; i < 3; i++)                    // find minor 12
        {
          a[i][0] = P[i][0] * P[i][0] + P[i][1] * P[i][1];
          a[i][1] = P[i][1];
          a[i][2] = 1;
        }
        m12 = this._determinantDrawEx(a, 3);

        for (i = 0; i < 3; i++)                    // find minor 13
        {
          a[i][0] = P[i][0] * P[i][0] + P[i][1] * P[i][1];
          a[i][1] = P[i][0];
          a[i][2] = 1;
        }
        m13 = this._determinantDrawEx(a, 3);

        for (i = 0; i < 3; i++)                    // find minor 14
        {
          a[i][0] = P[i][0] * P[i][0] + P[i][1] * P[i][1];
          a[i][1] = P[i][0];
          a[i][2] = P[i][1];
        }
        m14 = this._determinantDrawEx(a, 3);

        if (m11 == 0) {
          r = 0;                                 // not a circle
        }
        else {
          var Xo = 0.5 * m12 / m11;                 // center of circle
          var Yo = -0.5 * m13 / m11;
          r = Math.sqrt(Xo * Xo + Yo * Yo + m14 / m11);
        }



        return { radius: r, center: { x: Xo, y: Yo } };                                  // the radius
      },

      // Recursive definition of determinate using expansion by minors.
      _determinantDrawEx: function (a, n) {
        var i, j, j1, j2;
        var d = 0;
        var m = [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0]
        ];

        if (n == 2)                                // terminate recursion
        {
          d = a[0][0] * a[1][1] - a[1][0] * a[0][1];
        }
        else {
          d = 0;
          for (j1 = 0; j1 < n; j1++)            // do each column
          {
            for (i = 1; i < n; i++)            // create minor
            {
              j2 = 0;
              for (j = 0; j < n; j++) {
                if (j == j1) continue;
                m[i - 1][j2] = a[i][j];
                j2++;
              }
            }

            // sum (+/-)cofactor * minor
            d = d + Math.pow(-1.0, j1) * a[0][j1] * this._determinantDrawEx(m, n - 1);
          }
        }

        return d;
      },
      CreateCircleSegmentFromThreePoints: function (circle, pt1, pt2, pt3, numberOfPts, map) {
        //    var centerX = ellipseObject.center.x, centerY = ellipseObject.center.y, longAxis = ellipseObject.longAxis, shortAxis = ellipseObject.shortAxis, numberOfPoints = ellipseObject.numberOfPoints, map = ellipseObject.map, f, i, m;
        //    var centerX = ellipseObject.center.x, centerY = ellipseObject.center.y, longAxis = ellipseObject.longAxis, shortAxis = ellipseObject.shortAxis, numberOfPoints = ellipseObject.numberOfPoints, f, i, m;
        //    var ring = [];
        //    var angle = 2 * Math.PI / numberOfPoints;
        //    for (i = 0; i < numberOfPoints; i++)
        //    {
        //      f = Math.cos(i * angle), m = Math.sin(i * angle), f = map.toMap({x: longAxis * f + centerX, y: shortAxis * m + centerY}), ring.push(f);
        //    }
        //    ring.push(ring[0]);
        //    centerX = new l(map.spatialReference);
        //    centerX.addRing(ring);
        //    return centerX
        var center = circle.center, radius = circle.radius, path = [];
        pt1.x -= center.x;
        pt1.y -= center.y;
        pt2.x -= center.x;
        pt2.y -= center.y;
        pt3.x -= center.x;
        pt3.y -= center.y;
        var anglePt1 = Math.atan2(pt1.y, pt1.x), anglePt2 = Math.atan2(pt2.y, pt2.x), anglePt3 = Math.atan2(pt3.y, pt3.x);
        anglePt1 = anglePt1 < 0 ? 2 * Math.PI + anglePt1 : anglePt1;
        anglePt2 = anglePt2 < 0 ? 2 * Math.PI + anglePt2 : anglePt2;
        anglePt3 = anglePt3 < 0 ? 2 * Math.PI + anglePt3 : anglePt3;
        var startAngle = Math.min(anglePt1, anglePt2);
        var endAngle = Math.max(anglePt1, anglePt2);
        var swipeAngle = endAngle - startAngle;
        if (anglePt3 < startAngle || anglePt3 > endAngle) {
          swipeAngle -= (2 * Math.PI);
        }
        var angle = swipeAngle / numberOfPts, pt;

        for (var i = 0; i <= numberOfPts; i++) {

          pt = map.toMap({ x: radius * Math.cos(startAngle + i * angle) + center.x, y: radius * Math.sin(startAngle + i * angle) + center.y });
          path.push(pt);

        }


        var result = new _Polygon(map.spatialReference);
        result.addRing(path);



        return { "geometry": result, "lastPoint": path[numberOfPts], "backPoint": path[numberOfPts - 5] };

      },




    });
    return FreehandSemiCircle;
  });
