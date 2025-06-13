define(["dojo/_base/declare", "dojo/_base/lang", "dojo/_base/array",
    "dojo/_base/connect", "dojo/_base/Color", "dojo/_base/window",
    "dojo/has", "dojo/keys", "dojo/dom-construct",
    "dojo/dom-style", "esri/kernel", "esri/sniff",
    "esri/toolbars/_toolbar", "esri/symbols/SimpleMarkerSymbol", "esri/symbols/SimpleLineSymbol",
    "esri/symbols/SimpleFillSymbol", "esri/graphic", "esri/geometry/jsonUtils",
    "esri/geometry/webMercatorUtils", "esri/geometry/Polyline", "esri/geometry/Polygon",
    "esri/geometry/Multipoint", "esri/geometry/Rect", "dojo/i18n!esri/nls/jsapi",
    "dojo/on", "esri/layers/GraphicsLayer", "dojo/Evented",
    "esri/SnappingManager", "esri/geometry/Point",  "esri/geometry/geometryEngine",
    "esri/geometry/scaleUtils", "MilSymbologyExt/GeoTools", "MilSymbologyComponents/Shapes"],
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
        scaleUtils, GeoTools, Shapes) {

        var BaseLine = declare([Evented], { declaredClass: "MilitarySymbology.Components.BaseLine",

        constructor: function (map, marker) {
			this.map = map;
			this._lineSymbol = marker;
			this._points = [];
            this._geometryType = null;
            this._onClick = this._onClickHandler;
            this._onMouseMove = this._onMouseMoveHandler;
            this.candidatePoint = map.extent.getCenter();

		},

		init: function (letter) {
			this._onClick = on(this.map, "click", lang.hitch(this, this._onClickHandler));
			this.letter = letter;
			},

        _onClickHandler: function (clickPoint) {

        	this._points.push(clickPoint.mapPoint.offset(0, 0));

        	
        	
               	if (this._points.length === 1) {
			         this._tGraphic = this.map.graphics.add(new _Graphic(new _Polyline({
			                paths: [
                                [
                                    [clickPoint.x, clickPoint.y],
                                    [clickPoint.x, clickPoint.y]
                                ]
			                ], spatialReference: this.map.spatialReference
			            }), this._lineSymbol), !0);

							if (this.letter != undefined) {
							    this._onMouseMove = on(this.map, "mouse-move", lang.hitch(this, this._onMouseMoveHandlerC));
							} else {
							  
							    this._onMouseMove = on(this.map, "mouse-move", lang.hitch(this, this._onMouseMoveHandler));
							}

							
							this.emitClick(this._points, this._lineSymbol);
							

			        } else {
				            var geometry = this._tGraphic.geometry;
				            geometry.controlPoints = lang.clone(this._points);
							this._drawEnd(geometry);
					        this._clear();
					        this._removeEvents();

        }

        },


        emitProgress : function(geometry, lineSymbol) {
        	this.emit("onBaseLineProgress", { 'currentGeometry': geometry, 'currentMarker': lineSymbol });        	
        },

        emitClick : function(geometry, lineSymbol) {
        	this.emit("onBaseLineClick", { 'currentGeometry': geometry, 'currentMarker': lineSymbol});
        },
		 _onMouseMoveHandler: function (inputPoint) {

			var firstPoint = this._points[0];
			//var candidatePoint = inputPoint.mapPoint;

			this.candidatePoint = inputPoint.mapPoint;
			var temp = [];
			var result = new _Polyline(this.map.spatialReference);
			//var baseLinePath = this._baseLine(firstPoint, candidatePoint);
			var baseLinePath = this._baseLine(firstPoint, this.candidatePoint);
			temp = temp.concat(baseLinePath.startPt,  baseLinePath.midPt, baseLinePath.endPt);
			result._baseLine = baseLinePath;
			
			result.addPath(temp);
			this._tGraphic.setGeometry(result);
			this.emitProgress([baseLinePath.startPt, baseLinePath.endPt], this._lineSymbol);
		},

		_onMouseMoveHandlerC: function (inputPoint) {
			
			var firstPoint = this._points[0];
			var candidatePoint = inputPoint.mapPoint;
			var temp = [];
			var result = new _Polyline(this.map.spatialReference);
			var baseLinePath = this._baseLine(firstPoint, candidatePoint);
			temp = temp.concat(baseLinePath.startPt,  baseLinePath.midPt, baseLinePath.endPt);
			result._baseLine = baseLinePath;
			
			var values;
			values = GeoTools._fracturePts(baseLinePath.startPt, baseLinePath.endPt, 10, this.map.spatialReference);
            result.paths = result.paths.concat(values.geometry.paths);
            var baseLineLen = GeoTools._2PtLen(baseLinePath.startPt, baseLinePath.endPt);
            switch (this.letter) {
				case "C":
				this._createC(values, baseLineLen, result);
				break;

				case "CC":
				this._createCC(values, baseLineLen, result);
				break;

				case "B":
				this._createB(values, baseLineLen, result);
				break;
				default:
				//this._onMouseMove = on(this.map, "mouse-move", lang.hitch(this, this._onMouseMoveHandler));
				}
			this._tGraphic.setGeometry(result);
			this.emitProgress([baseLinePath.startPt, baseLinePath.endPt], this._lineSymbol);

		},

		_createC : function(values, baseLineLen, result) {
			var cLenLimit; 
            cLenLimit = values.len / 2;
           if(cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
           result.addPath(Shapes.createCC(values.midPoint.x, values.midPoint.y, cLenLimit, result.spatialReference));
       		return result;
		},

		_createCC : function(values, baseLineLen, result) {
			var cLenLimit; 
            cLenLimit = values.len / 2;
           if(cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
       		result.addPath(Shapes.createC(values.midPoint, cLenLimit, 40));
       		return result;
		},

		_createB : function(values, baseLineLen, result) {
			var cLenLimit; 
            cLenLimit = values.len / 2;
            if(cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
           		result.addPath(Shapes.createB(values.midPoint, cLenLimit, 40));
           		return result;
          
		},



		_baseLine:  function(pt1, pt2) {

			var length = GeoTools._2PtLen(pt1, pt2);
			var angle = GeoTools.angleInRadians(pt1, pt2);
			var thirdPt = new Point(pt2.x + length * Math.cos(angle), pt2.y + length * Math.sin(angle), this.map.spatialReference);
			return {"startPt": pt1, "endPt": thirdPt, "midPt": pt2};
		},


		onDrawEnd: function (geometry, geoGeometry) {
            this.emit("drawEnd", { 'geometry': geometry, 'geographicGeometry': geoGeometry });
		},


        _removeEvents: function() {
        this._onClick.remove();
        this._onMouseMove.remove();
    	},

        _clear: function () {

			this._tGraphic && this.map.graphics.remove(this._tGraphic, !0);

			this._tGraphic = null;
			this.map.snappingManager && this.map.snappingManager._setGraphic(null);
			this._points = [];
			this._curvePt1 = this._curvePt2 = null;
		},
        _drawEnd: function (drawGeometry)
		{
			if (drawGeometry)
			{
				var sp = this.map.spatialReference, geographicGeometry;
				sp && (sp.isWebMercator() ? geographicGeometry = webMercatorUtils.webMercatorToGeographic(drawGeometry, !0) : 4326 === sp.wkid && (geographicGeometry = jsonUtility.fromJson(drawGeometry.toJson())));
			    this.onDrawEnd(drawGeometry, geographicGeometry);

			}
		},

		deactivate: function () {
			this._clear();
            this._removeEvents();
            this._geometryType = null;

		}
		



        });
        return BaseLine;
    });
