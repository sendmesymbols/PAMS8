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
    "esri/geometry/scaleUtils"],
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
        scaleUtils) {



        var Mock = declare([Evented], { declaredClass: "MilitarySymbology.Extensions.Mock",

        constructor: function (map, options) {

			this._markerSymbol = new SimpleMarkerSymbol(SimpleMarkerSymbol.STYLE_SOLID, 10, new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new color([255, 0, 0]), 2), new color([0, 0, 0, 0.25]));
			this._lineSymbol = new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new color([255, 0, 0]), 1);
			this._lineSymbol2 = new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new color([255, 0, 0]), 5);
			this._fillSymbol = new SimpleFillSymbol(SimpleFillSymbol.STYLE_SOLID, new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new color([255, 0, 0]), 2), new color([0, 0, 0, 0.25]));
			this._points = [];
            this._geometryType = null;
            this._tailFactor = 0.05;
            this._headPercentage = 0.07;


            this._onClick = this._onClickHandler;
            this._onDblClick = this._onDblClickHandler;
            this._onMouseMove = this._onMouseMovekHandler;

            this._onClick2 = this._onClickHandler2;
            this._onMouseMove2 = this._onMouseMovekHandler2;




		},

        activate: function (geometryType, options) {
            this._geometryType = geometryType;
            map.navigationManager.setImmediateClick(false);
			switch (this._geometryType)
			{

				case "CURVE":
				case "BEZIER_CURVE":
				case "BEZIER_POLYGON":
				case "FREEHAND_ARROW":
        		case "POLYLINEEX":
			  	case "ARROW_POLYLINE":
			 	case "ARROW_SLIM":
        		case "ARROW_SIMPLE":
        		case "ARROW_SIMPLE_POLY":
        		case "SP_ATTK":
        		

        		 console.log("ACTIVATED", this._geometryType);
                 this._onClick = on(map, "click", lang.hitch(this, this._onClickHandler));
                 this._onDblClick = on(map, "dbl-click", lang.hitch(this, this._onDblClickHandler));
                 map.disableDoubleClickZoom();
					break;

				case "BOF_SP_BY_FIRE":
				
				 this._onClick2 = on(map, "click", lang.hitch(this, this._onClickHandler2));
				 //this._onClick = on(map, "click", lang.hitch(this, this._onClickHandler));
                 //this._onDblClick = on(map, "dbl-click", lang.hitch(this, this._onDblClickHandler));
					break;
            	default:
					console.error("Unsupported geometry type: " + geometryType);
					return;
			}

        },

        _onClickHandler2: function (clickPoint) {

        	  console.log("onClickHandler2");
        	  this._points.push(clickPoint.mapPoint.offset(0, 0));	
        	  switch (this._geometryType) {

                	case "BOF_SP_BY_FIRE":
                	if (this._points.length === 1) {
			            this._tGraphic = map.graphics.add(new _Graphic(new _Polyline({
			                paths: [
                                [
                                    [clickPoint.x, clickPoint.y],
                                    [clickPoint.x, clickPoint.y]
                                ]
			                ], spatialReference: map.spatialReference
			            }), this._lineSymbol), !0);
			            this._onMouseMove2 = on(map, "mouse-move", lang.hitch(this, this._onMouseMovekHandler2));
			        } else {
				            var geometry = this._tGraphic.geometry;
				            geometry.controlPoints = lang.clone(this._points);
				            geometry.drawExtendType = "BOF_SP_BY_FIRE";

							//this._drawEnd(geometry);
					        //this._clear();
					        this._removeEvents2();

                    }
                	break;

        }

        },

        _onClickHandler: function (clickPoint) {
            console.log("onClickHandler");

			this._points.push(clickPoint.mapPoint.offset(0, 0));
			switch (this._geometryType)
			{

                	case "CURVE":
					if (this._points.length === 1)
					{
						this._tGraphic = map.graphics.add(new _Graphic(new _Polyline({
							                                                            paths: [
								                                                            [
									                                                            [clickPoint.x, clickPoint.y],
									                                                            [clickPoint.x, clickPoint.y]
								                                                            ]
							                                                            ], spatialReference: map.spatialReference
						                                                            }), this._lineSymbol), !0);






						this._curvePt1 = this._points[this._points.length - 1];
						this._onMouseMove = on(map, "mouse-move", lang.hitch(this, this._onMouseMovekHandler));
					}
					else if (this._points.length === 2)
					{
						this._curvePt2 = this._points[this._points.length - 1];
					}
					//console.log("curve click event");

					break;


				case "BEZIER_CURVE":
					if (this._points.length === 1)
					{

						this._tGraphic = map.graphics.add(new _Graphic(new _Polyline({
							                                                            paths: [
								                                                            [
									                                                            [clickPoint.x, clickPoint.y],
									                                                            [clickPoint.x, clickPoint.y]
								                                                            ]
							                                                            ], spatialReference: map.spatialReference
						                                                            }), this._lineSymbol), !0);


						this._onMouseMove = on(map, "mouse-move", lang.hitch(this, this._onMouseMovekHandler));
					}

					break;


				case "BEZIER_POLYGON":
					if (this._points.length === 1)
					{


						this._tGraphic = map.graphics.add(new _Graphic(new _Polygon({
							                                                           rings: [
								                                                           [
									                                                           [clickPoint.x, clickPoint.y],
									                                                           [clickPoint.x, clickPoint.y]
								                                                           ]
							                                                           ], spatialReference: map.spatialReference
						                                                           }), this._fillSymbol), !0);
						this._onMouseMove = on(map, "mouse-move", lang.hitch(this, this._onMouseMovekHandler));
					}
					break;
				case "FREEHAND_ARROW":
					if (this._points.length === 1)
					{
						this._tGraphic = map.graphics.add(new _Graphic(new _Polygon({
							                                                           rings: [
								                                                           [
									                                                           [clickPoint.x, clickPoint.y],
									                                                           [clickPoint.x, clickPoint.y]
								                                                           ]
							                                                           ], spatialReference: map.spatialReference
						                                                           }), this._fillSymbol), !0);
						this._onMouseMove = on(map, "mouse-move", lang.hitch(this, this._onMouseMovekHandler));
					}
					break;

                    case "POLYLINEEX":
					if (this._points.length === 1)
					{


						this._tGraphic = map.graphics.add(new _Graphic(new _Polygon({
							                                                           rings: [
								                                                           [
									                                                           [clickPoint.x, clickPoint.y],
									                                                           [clickPoint.x, clickPoint.y]
								                                                           ]
							                                                           ], spatialReference: map.spatialReference
						                                                           }), this._fillSymbol), !0);
						this._onMouseMove = on(map, "mouse-move", lang.hitch(this, this._onMouseMovekHandler));
					}
					break;

					case "ARROW_POLYLINE":
					if (this._points.length === 1)
					{
						this._tGraphic = map.graphics.add(new _Graphic(new _Polyline({
							                                                           paths: [
								                                                           [
									                                                           [clickPoint.x, clickPoint.y],
									                                                           [clickPoint.x, clickPoint.y]
								                                                           ]
							                                                           ], spatialReference: map.spatialReference
						                                                           }), this._fillSymbol), !0);
						this._onMouseMove = on(map, "mouse-move", lang.hitch(this, this._onMouseMovekHandler));
					}

					break;

			    case "ARROW_SLIM":
			        if (this._points.length === 1) {
			            this._tGraphic = map.graphics.add(new _Graphic(new _Polyline({
			                paths: [
                                [
                                    [clickPoint.x, clickPoint.y],
                                    [clickPoint.x, clickPoint.y]
                                ]
			                ], spatialReference: map.spatialReference
			            }), this._lineSymbol), !0);
			            this._onMouseMove = on(map, "mouse-move", lang.hitch(this, this._onMouseMovekHandler));
			        }

			        break;

                    case "ARROW_SIMPLE":
			        if (this._points.length === 1) {
			            this._tGraphic = map.graphics.add(new _Graphic(new _Polyline({
			                paths: [
                                [
                                    [clickPoint.x, clickPoint.y],
                                    [clickPoint.x, clickPoint.y]
                                ]
			                ], spatialReference: map.spatialReference
			            }), this._lineSymbol), !0);
			            this._onMouseMove = on(map, "mouse-move", lang.hitch(this, this._onMouseMovekHandler));
			        } else {
				            var geometry = this._tGraphic.geometry;
				            geometry.controlPoints = lang.clone(this._points);
				            geometry.drawExtendType = "ARROW_SIMPLE";

							this._drawEnd(geometry);
					        this._clear();
					        this._removeEvents();

                    }


			        break;
              case "ARROW_SIMPLE_POLY":
        if (this._points.length === 1) {
            this._tGraphic = map.graphics.add(new _Graphic(new _Polyline({
                paths: [
                          [
                              [clickPoint.x, clickPoint.y],
                              [clickPoint.x, clickPoint.y]
                          ]
                ], spatialReference: map.spatialReference
            }), this._lineSymbol), !0);
            this._onMouseMove = on(map, "mouse-move", lang.hitch(this, this._onMouseMovekHandler));
        }
        break;


        case "SP_ATTK":
					if (this._points.length === 1)
					{
						this._tGraphic = map.graphics.add(new _Graphic(new _Polygon({
							                                                           rings: [
								                                                           [
									                                                           [clickPoint.x, clickPoint.y],
									                                                           [clickPoint.x, clickPoint.y]
								                                                           ]
							                                                           ], spatialReference: map.spatialReference
						                                                           }), this._lineSymbol), !0);
						this._onMouseMove = on(map, "mouse-move", lang.hitch(this, this._onMouseMovekHandler));
					}
					break;


					  case "BOF_SP_BY_FIRE":
					if (this._points.length === 1)
					{
						this._tGraphic = map.graphics.add(new _Graphic(new _Polygon({
							                                                           rings: [
								                                                           [
									                                                           [clickPoint.x, clickPoint.y],
									                                                           [clickPoint.x, clickPoint.y]
								                                                           ]
							                                                           ], spatialReference: map.spatialReference
						                                                           }), this._lineSymbol), !0);
						this._onMouseMove = on(map, "mouse-move", lang.hitch(this, this._onMouseMovekHandler));
					}
					break;

            }

		},

		 _onMouseMovekHandler2: function (inputPoint)
		{

			var lastPoint = this._points[this._points.length - 1];
			var firstPoint = this._points[0];
			var candidatePoint = inputPoint.mapPoint;
			var tempGraphic = this._tGraphic;
			var geometry = tempGraphic.geometry;

			switch (this._geometryType)
			{

				case "BOF_SP_BY_FIRE":
				var path = [];
				path = path.concat(firstPoint, candidatePoint);
				var result = new _Polyline(map.spatialReference);
				result.addPath(path)
				tempGraphic.setGeometry(result);

				break;
				
				default:
	    	  console.error("Unsupported Geometry Type ");
    	  	  return;

			}




		},


        _onMouseMovekHandler: function (inputPoint)
		{




			var lastPoint = this._points[this._points.length - 1];
			var firstPoint = this._points[0];
			var candidatePoint = inputPoint.mapPoint;
			var tempGraphic = this._tGraphic;
			var geometry = tempGraphic.geometry;

			switch (this._geometryType)
			{

				case "CURVE":
					if (this._curvePt1 && this._curvePt2)
					{


						var circle = this._circleDrawEx(map.toScreen(this._curvePt1), map.toScreen(this._curvePt2), map.toScreen(candidatePoint));
						if (circle.radius > 0)
						{

							tempGraphic.geometry = this.CreateCircleSegmentFromThreePoints(circle, map.toScreen(this._curvePt1), map.toScreen(this._curvePt2), map.toScreen(candidatePoint), 60, map);
							tempGraphic.setGeometry(tempGraphic.geometry);

						}
					}
					else
					{

						geometry.setPoint(0, 0, { x: lastPoint.x, y: lastPoint.y });
						geometry.setPoint(0, 1, { x: candidatePoint.x, y: candidatePoint.y });
						tempGraphic.setGeometry(geometry);
					}
					break;

				case "BEZIER_CURVE":

					if (this._points.length === 1) {
						geometry.setPoint(0, 0, { x: lastPoint.x, y: lastPoint.y });
						geometry.setPoint(0, 1, { x: candidatePoint.x, y: candidatePoint.y });
						tempGraphic.setGeometry(geometry);
					}
					else {
						var tempArray = [];
						Array.forEach(this._points, function (e)
						{
							tempArray.push({ x: e.x, y: e.y });
						});

						tempArray.push({ x: candidatePoint.x, y: candidatePoint.y });

						tempGraphic.geometry = this.CreateBezierPath(tempArray, 100, map);
						tempGraphic.setGeometry(tempGraphic.geometry);
					}
					break;

				case "BEZIER_POLYGON":

					if (this._points.length <= 1)
					{
						geometry.setPoint(0, 0, { x: lastPoint.x, y: lastPoint.y });
						geometry.setPoint(0, 1, { x: candidatePoint.x, y: candidatePoint.y });
						tempGraphic.setGeometry(geometry);
					}
					else
					{
						tempArray = [];
						Array.forEach(this._points, function (e)
						{
							tempArray.push({ x: e.x, y: e.y });
						});

						tempArray.push({ x: candidatePoint.x, y: candidatePoint.y });
						tempGraphic.geometry = this.CreateBezierPathPoly(tempArray, 130, map);
						tempGraphic.setGeometry(tempGraphic.geometry);
					}
					break;
				case "FREEHAND_ARROW":
					console.log("FREEHAND ARROW")
					if (this._points.length <= 1)
					{
						var len = this._2PtLen(this._points[0], candidatePoint);
						var k = Math.atan((this._points[0].y - candidatePoint.y) / (this._points[0].x - candidatePoint.x));
						switch (this.twoPtsRelationShip(this._points[0], candidatePoint))
						{
							case "ne":
								k += Math.PI / 2;
								break;
							case "nw":
								k += Math.PI * 3 / 2;
								break;
							case "sw":
								k += Math.PI * 3 / 2;
								break;
							case "se":
								k += Math.PI / 2;
								break;
						}
						//tail two points
						var pt1 = { x: this._tailFactor * len * Math.cos(k) + this._points[0].x, y: this._tailFactor * len * Math.sin(k) + this._points[0].y };
						var pt2 = { x: -1 * this._tailFactor * len * Math.cos(k) + this._points[0].x, y: -1 * this._tailFactor * len * Math.sin(k) + this._points[0].y };
						var partialLen = (1 - this._headPercentage) * len;
						var p1 = { x: this._tailFactor * partialLen * Math.cos(k) + this._points[0].x, y: this._tailFactor * partialLen * Math.sin(k) + this._points[0].y };
						var p2 = { x: -1 * this._tailFactor * partialLen * Math.cos(k) + this._points[0].x, y: -1 * this._tailFactor * partialLen * Math.sin(k) + this._points[0].y };


						var result = new _Polygon(map.spatialReference);
						var ring = [];
						ring.push(pt1);
						ring.push(p1);

						
						ring = ring.concat(this.CreateArrowHeadPathEx(p1, candidatePoint, p2, len, this._headPercentage, 15));
						
						//ring.push(candidatePoint);

						ring.push(p2);
						ring.push(pt2);

						ring.push(pt1);
						!_Polygon.prototype.isClockwise(ring) && !this.respectDrawingVertexOrder && (console.debug(this.declaredClass + " :  Polygons drawn in anti-clockwise direction will be reversed to be clockwise."), ring.reverse());
						result.addRing(ring);
						tempGraphic.geometry = result;
						tempGraphic.setGeometry(tempGraphic.geometry);
					}
					else
					{
						tempArray = [];var leftArray = [], rightArray = [];
						Array.forEach(this._points, function (e)
						{
							tempArray.push({ x: e.x, y: e.y });
						});
						tempArray.push({ x: candidatePoint.x, y: candidatePoint.y });
						angleArray = this._vertexAngle(tempArray);
						var totalL = this._ptCollectionLen(tempArray, 0);
						for (var i = 0, len = tempArray.length - 1; i < len; i++)
						{
							partialLen = this._ptCollectionLen(tempArray, i);
							partialLen += totalL / 2.4;
							//console.log(partialLen);

							pt1 = { x: (this._tailFactor) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x, y: (this._tailFactor) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y };
							pt2 = { x: -1 * (this._tailFactor) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x, y: -1 * (this._tailFactor) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y };

							leftArray.push(pt1);
							rightArray.push(pt2);
						}
						leftArray.push({ x: candidatePoint.x, y: candidatePoint.y });
						rightArray.push({ x: candidatePoint.x, y: candidatePoint.y });

						leftArray = this.CreateBezierPathPCOnly(leftArray, 70);
						leftArray.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);

						rightArray = this.CreateBezierPathPCOnly(rightArray, 70);
						rightArray.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);

						

						var headPath = this.CreateArrowHeadPathEx(leftArray[leftArray.length - 1], candidatePoint, rightArray[rightArray.length - 1], this._ptCollectionLen(tempArray, 0), this._headPercentage, 15);

						ring = [];
						ring = ring.concat(leftArray);
						ring = ring.concat(headPath);
						ring = ring.concat(rightArray.reverse());
						ring.push(ring[0]);

						result = new _Polygon(map.spatialReference);

						result.addRing(ring);
						tempGraphic.geometry = result;
						tempGraphic.setGeometry(tempGraphic.geometry);
					}
					break;



				case "POLYLINEEX":
					if (this._points.length <= 1)
					{
						len = this._2PtLen(this._points[0], candidatePoint);
						k = Math.atan((this._points[0].y - candidatePoint.y) / (this._points[0].x - candidatePoint.x));
						switch (this.twoPtsRelationShip(this._points[0], candidatePoint))
						{
							case "ne":
								k += Math.PI / 2;
								break;
							case "nw":
								k += Math.PI * 3 / 2;
								break;
							case "sw":
								k += Math.PI * 3 / 2;
								break;
							case "se":
								k += Math.PI / 2;
								break;
						}
						//tail two points
						pt1 = { x: this._tailFactor * len * Math.cos(k) + this._points[0].x, y: this._tailFactor * len * Math.sin(k) + this._points[0].y };
						pt2 = { x: -1 * this._tailFactor * len * Math.cos(k) + this._points[0].x, y: -1 * this._tailFactor * len * Math.sin(k) + this._points[0].y };


						result = new _Polygon(map.spatialReference);
						ring = [];
						ring.push(pt1);
						ring.push(candidatePoint);
						ring.push(pt2);

						ring.push(pt1);
						!_Polygon.prototype.isClockwise(ring) && !this.respectDrawingVertexOrder && (console.debug(this.declaredClass + " :  Polygons drawn in anti-clockwise direction will be reversed to be clockwise."), ring.reverse());
						result.addRing(ring);
						tempGraphic.geometry = result;
						tempGraphic.setGeometry(tempGraphic.geometry);
					}
					else
					{
						tempArray = [], leftArray = [], rightArray = [];
						Array.forEach(this._points, function (e)
						{
							tempArray.push({ x: e.x, y: e.y });
						});
						tempArray.push({ x: candidatePoint.x, y: candidatePoint.y });
						var angleArray = this._vertexAngle(tempArray);
						for (i = 0, len = tempArray.length - 1; i < len; i++)
						{
							partialLen = this._ptCollectionLen(tempArray, i);
							//console.log(partialLen);

							pt1 = { x: (this._tailFactor + i / 18 / len) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x, y: (this._tailFactor + i / 18 / len) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y };
							pt2 = { x: -1 * (this._tailFactor + i / 18 / len) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x, y: -1 * (this._tailFactor + i / 18 / len) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y };

							leftArray.push(pt1);
							rightArray.push(pt2);


						}
						ring = [];
						ring = ring.concat(leftArray);
						ring.push(candidatePoint);
						ring = ring.concat(rightArray.reverse());
						ring.push(ring[0]);
						result = new _Polygon(map.spatialReference);
						!_Polygon.prototype.isClockwise(ring) && !this.respectDrawingVertexOrder && (console.debug(this.declaredClass + " :  Polygons drawn in anti-clockwise direction will be reversed to be clockwise."), ring.reverse());
						result.addRing(ring);
						tempGraphic.geometry = result;
						tempGraphic.setGeometry(tempGraphic.geometry);
					}
					break;

					case "ARROW_POLYLINE":
					console.log("FARROW_POLYLINE")

					if (this._points.length <= 1)
					{
						var len = this._2PtLen(this._points[0], candidatePoint);
						var k = Math.atan((this._points[0].y - candidatePoint.y) / (this._points[0].x - candidatePoint.x));
						switch (this.twoPtsRelationShip(this._points[0], candidatePoint))
						{
							case "ne":
								k += Math.PI / 2;
								break;
							case "nw":
								k += Math.PI * 3 / 2;
								break;
							case "sw":
								k += Math.PI * 3 / 2;
								break;
							case "se":
								k += Math.PI / 2;
								break;
						}
						//tail two points
						var pt1 = { x: this._tailFactor * len * Math.cos(k) + this._points[0].x, y: this._tailFactor * len * Math.sin(k) + this._points[0].y };
						var pt2 = { x: -1 * this._tailFactor * len * Math.cos(k) + this._points[0].x, y: -1 * this._tailFactor * len * Math.sin(k) + this._points[0].y };
						
						var partialLen = (1 - this._headPercentage) * len;
						var p1 = { x: this._tailFactor * partialLen * Math.cos(k) + this._points[0].x, y: this._tailFactor * partialLen * Math.sin(k) + this._points[0].y };
						var p2 = { x: -1 * this._tailFactor * partialLen * Math.cos(k) + this._points[0].x, y: -1 * this._tailFactor * partialLen * Math.sin(k) + this._points[0].y };

						
						var result = new _Polyline(map.spatialReference);
						var path = [];
						path.push(pt1);
						path.push(p1);
						path = path.concat(this.CreateArrowHeadPathEx(p1, candidatePoint, p2, len, this._headPercentage, 15));

						path.push(p2);
						path.push(pt2);

						path.push(pt1);
						result.addPath(path);
						tempGraphic.geometry = result;
						tempGraphic.setGeometry(tempGraphic.geometry);
					}

					else
					{

						tempArray = [];var leftArray = [], rightArray = [];
						Array.forEach(this._points, function (e)
						{
							tempArray.push({ x: e.x, y: e.y });
						});
						tempArray.push({ x: candidatePoint.x, y: candidatePoint.y });
						angleArray = this._vertexAngle(tempArray);
						var totalL = this._ptCollectionLen(tempArray, 0);
						for (var i = 0, len = tempArray.length - 1; i < len; i++)
						{
							partialLen = this._ptCollectionLen(tempArray, i);
							partialLen += totalL / 2.4;
							//console.log(partialLen);

							pt1 = { x: (this._tailFactor) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x, y: (this._tailFactor) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y };
							pt2 = { x: -1 * (this._tailFactor) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x, y: -1 * (this._tailFactor) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y };

							leftArray.push(pt1);
							rightArray.push(pt2);
						}
						/*
						leftArray.push({ x: candidatePoint.x, y: candidatePoint.y });
						rightArray.push({ x: candidatePoint.x, y: candidatePoint.y });

						leftArray = this.CreateBezierPathPCOnly(leftArray, 70);
						leftArray.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);

						rightArray = this.CreateBezierPathPCOnly(rightArray, 70);
						rightArray.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);
						*/
						var headPath = this.CreateArrowHeadPathEx(leftArray[leftArray.length - 1], candidatePoint, rightArray[rightArray.length - 1], this._ptCollectionLen(tempArray, 0), this._headPercentage, 15);
						path = [];
						path = path.concat(leftArray);
						path = path.concat(headPath);
						path = path.concat(rightArray.reverse());
						path.push(path[0]);

						result = new _Polyline(map.spatialReference);

						result.addPath(path);
						tempGraphic.geometry = result;
						tempGraphic.setGeometry(tempGraphic.geometry);
					}
					break;

			    case "ARROW_SLIM":
			        console.log("ARROW_SLIM")

                  if (this._points.length <= 1) {
    			            var len = this._2PtLen(this._points[0], candidatePoint);
    			            var k = Math.atan((this._points[0].y - candidatePoint.y) / (this._points[0].x - candidatePoint.x));
                            switch (this.twoPtsRelationShip(this._points[0], candidatePoint)) {
    			                case "ne":
    			                    k += Math.PI / 2;
    			                    break;
    			                case "nw":
    			                    k += Math.PI * 3 / 2;
    			                    break;
    			                case "sw":
    			                    k += Math.PI * 3 / 2;
    			                    break;
    			                case "se":
    			                    k += Math.PI / 2;
    			                    break;
    			            }
                      //tail two points
                      var pt1 = { x: this._tailFactor * len * Math.cos(k) + this._points[0].x, y: this._tailFactor * len * Math.sin(k) + this._points[0].y };
                      var pt2 = { x: -1 * this._tailFactor * len * Math.cos(k) + this._points[0].x, y: -1 * this._tailFactor * len * Math.sin(k) + this._points[0].y };
                      var partialLen = (1 - this._headPercentage) * len;
                      var p1 = { x: this._tailFactor * partialLen * Math.cos(k) + this._points[0].x, y: this._tailFactor * partialLen * Math.sin(k) + this._points[0].y };
                      var p2 = { x: -1 * this._tailFactor * partialLen * Math.cos(k) + this._points[0].x, y: -1 * this._tailFactor * partialLen * Math.sin(k) + this._points[0].y };
                      var result = new _Polyline(map.spatialReference);


                      var path = [];
                      path = path.concat(this._points, candidatePoint, this.CreateArrowHeadPathEx(p1, candidatePoint, p2, len, this._headPercentage, 15, true));


                      result.addPath(path);

                      tempGraphic.geometry = result;
                      tempGraphic.setGeometry(tempGraphic.geometry);


			        }

			        else {
			            tempArray = []; var leftArray = [], rightArray = [];
			            Array.forEach(this._points, function (e) {
			                tempArray.push({ x: e.x, y: e.y });
			            });
			            tempArray.push({ x: candidatePoint.x, y: candidatePoint.y });
			            angleArray = this._vertexAngle(tempArray);
			            var totalL = this._ptCollectionLen(tempArray, 0);
			            for (var i = 0, len = tempArray.length - 1; i < len; i++) {
			                partialLen = this._ptCollectionLen(tempArray, i);
			                partialLen += totalL / 2.4;
			                console.log(partialLen);

			                pt1 = { x: (this._tailFactor) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x, y: (this._tailFactor) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y };
			                pt2 = { x: -1 * (this._tailFactor) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x, y: -1 * (this._tailFactor) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y };

			                leftArray.push(pt1);
			                rightArray.push(pt2);
			            }
			            var headPath = this.CreateArrowHeadPathEx(leftArray[leftArray.length - 1], candidatePoint, rightArray[rightArray.length - 1], this._ptCollectionLen(tempArray, 0), this._headPercentage, 15);


			            path = [];
                        path = path.concat(tempArray, headPath);
			            result = new _Polyline(map.spatialReference);

			            result.addPath(path);
			            tempGraphic.geometry = result;
			            tempGraphic.setGeometry(tempGraphic.geometry);
			        }
			        break;


                   case "ARROW_SIMPLE":

                    var path = [];
                  if (this._points.length <= 1) {
                    /* Option 1
                    var len = this._2PtLen(this._points[0], candidatePoint);
                    var k = Math.atan((this._points[0].y - candidatePoint.y) / (this._points[0].x - candidatePoint.x));
                    switch (this.twoPtsRelationShip(this._points[0], candidatePoint)) {
                        case "ne":
                            k += Math.PI / 2;
                            break;
                        case "nw":
                            k += Math.PI * 3 / 2;
                            break;
                        case "sw":
                            k += Math.PI * 3 / 2;
                            break;
                        case "se":
                            k += Math.PI / 2;
                            break;
                    }
                    var point1 = new LatLon(lastPoint.y, lastPoint.x),
                        point2 = new LatLon(candidatePoint.y, candidatePoint.x);
                   var pMid = point1.midpointTo(point2);
                   var midPoint = new Point(pMid.lon, pMid.lat, map.spatialReference);

                   k = this.angleRadians(lastPoint, candidatePoint);
                   var pt1 = { x: this._tailFactor * len * Math.cos(k) + midPoint.x, y: this._tailFactor * len * Math.sin(k) + midPoint.y };
                   var pt2 = { x: -1 * this._tailFactor * len * Math.cos(k) + midPoint.x, y: -1 * this._tailFactor * len * Math.sin(k) + midPoint.y };

                      //path = path.concat(lastPoint, pt1, pt2, candidatePoint);
                      var result = new _Polyline(map.spatialReference);
                      path = path.concat(lastPoint, pt2);
                      result.addPath(path);
                      path = [];
                      path = path.concat(pt1, candidatePoint);
                      result.addPath(path);
                      tempGraphic.geometry = result;
                      tempGraphic.setGeometry(tempGraphic.geometry);
                      */



                      //Option 2

                      this.drawArrow(tempGraphic, firstPoint, candidatePoint, 10);
                     /*
                     var result = new _Polyline(map.spatialReference);
                      var len = this._2PtLen(firstPoint, candidatePoint);

                      path = path.concat(firstPoint, candidatePoint);
                      result.addPath(path);
                      var midPoint = result.getExtent().getCenter();

                     path = [];
                     result = new _Polyline(map.spatialReference);
                     len = len / 10;

                     k = this.angleRadians(lastPoint, candidatePoint);

                     var pt1 = { x: -1 * len * Math.cos(k) + midPoint.x, y: -1 * len * Math.sin(k) + midPoint.y };
                     var pt2 = { x: len * Math.cos(k) + midPoint.x, y: len * Math.sin(k) + midPoint.y };



                    path = path.concat(lastPoint, pt1);
                    result.addPath(path);
                    path = [];
                    path = path.concat(pt2, candidatePoint);
                    result.addPath(path);

                    // Update Control Points



                    //Arrow Head
                    var length = this._2PtLen(firstPoint, candidatePoint) / 10;
                    k += 15;
                    var angle = this.toDegrres(k); // In Degrees
                    k-=30;
                    var angle2 = this.toDegrres(k); // In Degrees


                    var rightWing = new Point(candidatePoint.x + length * Math.cos(this.toRad(angle)),
                    candidatePoint.y + length * Math.sin(this.toRad(angle)), map.spatialReference);

                    var leftWing = new Point(candidatePoint.x + length * Math.cos(this.toRad(angle2)),
                    candidatePoint.y + length * Math.sin(this.toRad(angle2)), map.spatialReference);


                    path = [];
                    path = path.concat(candidatePoint, rightWing);
                    result.addPath(path);

                    path = [];
                    path = path.concat(candidatePoint, leftWing);
                    result.addPath(path);


                    tempGraphic.setGeometry(result);
                      */
                    /*
                   //TURF MidPoint
                    var tpt1 = {
                    "type": "Feature",
                    "properties": {},
                    "geometry": {
                      "type": "Point",
                      "coordinates": [firstPoint.x, firstPoint.y]
                    }
                  };
                  var tpt2 = {
                    "type": "Feature",
                    "properties": {},
                    "geometry": {
                      "type": "Point",
                      "coordinates": [candidatePoint.x, candidatePoint.y]
                    }
                  };


                  var midpointed = turf.midpoint(tpt1, tpt2);
                  var newMp = new Point(midpointed.geometry.coordinates[0],midpointed.geometry.coordinates[1], map.spatialReference);
                  map.graphics.add(new _Graphic(newMp, this._markerSymbol));
                  */



			        }

			        break;

              case "ARROW_SIMPLE_POLY":


              var geom = new _Polyline(map.spatialReference);
              var midPoints = [];
              var values = this._fracture(this._points, candidatePoint, 10);
             
              
              
			//Write in between Fractures
              for (var i = 0; i < values.midPoints.length; i++) {
              	//this.displayMapPoint(values.midPoints[i]);


              	var k = this.angleRadians(this._points[i], values.midPoints[i]);
              	var length = this._2PtLen(this._points[i], values.midPoints[i]) / 10;
              	k += 15;
                var angle = this.toDegrres(k); // In Degrees
                k-=30;
                var angle2 = this.toDegrres(k); // In Degrees
              	values.geometry.addPath(this._arrowHead(values.midPoints[i], length, angle, angle2));

              /*
              var path = [];

       			var rightWing = new Point(candidatePoint.x + length * Math.cos(this.toRad(angle)),
                candidatePoint.y + length * Math.sin(this.toRad(angle)), map.spatialReference);

                 var leftWing = new Point(candidatePoint.x + length * Math.cos(this.toRad(angle2)),
               candidatePoint.y + length * Math.sin(this.toRad(angle2)), map.spatialReference);

                    path = [];
                    path = path.concat(candidatePoint, rightWing);
                    path = path.concat(candidatePoint, leftWing);
                    */

              };

              //End of Write in between Fractures
              

              


              tempGraphic.setGeometry(values.geometry);


              /*
              if (this._points.length <= 1) {

             	this.drawArrow(tempGraphic, firstPoint, candidatePoint, 10);

              } else {

              var path = [];
              var result = new _Polyline(map.spatialReference);
              console.log(tempGraphic.geometry.paths)
              console.log(tempGraphic.geometry.getPoint(tempGraphic.geometry.paths.length -1, tempGraphic.geometry.paths[tempGraphic.geometry.paths.length -1].length-1))

              tempGraphic.geometry.setPoint(tempGraphic.geometry.paths.length -1, tempGraphic.geometry.paths[tempGraphic.geometry.paths.length -1].length-1,
              	candidatePoint)

               tempGraphic.draw();

              }


              var midPoint = this.getMidPoint(lastPoint, candidatePoint);

              */









              /*
              var path = [];
              var result = new _Polyline(map.spatialReference);
              var midPoint = this.getMidPoint(lastPoint, candidatePoint);

              path = path.concat(this._points, candidatePoint);
              result.addPath(path);
              tempGraphic.setGeometry(result);
              map.graphics.add(new _Graphic(midPoint, this._markerSymbol));
              //map.graphics.add(new _Graphic(tempGraphic.geometry.getPoint(tempGraphic.geometry.paths.length -1, tempGraphic.geometry.paths[tempGraphic.geometry.paths.length -1].length-1), this._markerSymbol));

              //tempGraphic.geometry.paths[tempGraphic.geometry.paths.length - 1][1][0] = 900
              */



              /*
               var path = [];
               var result = new _Polyline(map.spatialReference);
               path = path.concat(this._points, candidatePoint);
               result.addPath(path);
              tempGraphic.setGeometry(result);
              */

             if (this._points.length <= 1) {
               /* Option 1
               var len = this._2PtLen(this._points[0], candidatePoint);
               var k = Math.atan((this._points[0].y - candidatePoint.y) / (this._points[0].x - candidatePoint.x));
               switch (this.twoPtsRelationShip(this._points[0], candidatePoint)) {
                   case "ne":
                       k += Math.PI / 2;
                       break;
                   case "nw":
                       k += Math.PI * 3 / 2;
                       break;
                   case "sw":
                       k += Math.PI * 3 / 2;
                       break;
                   case "se":
                       k += Math.PI / 2;
                       break;
               }
               var point1 = new LatLon(lastPoint.y, lastPoint.x),
                   point2 = new LatLon(candidatePoint.y, candidatePoint.x);
              var pMid = point1.midpointTo(point2);
              var midPoint = new Point(pMid.lon, pMid.lat, map.spatialReference);

              k = this.angleRadians(lastPoint, candidatePoint);
              var pt1 = { x: this._tailFactor * len * Math.cos(k) + midPoint.x, y: this._tailFactor * len * Math.sin(k) + midPoint.y };
              var pt2 = { x: -1 * this._tailFactor * len * Math.cos(k) + midPoint.x, y: -1 * this._tailFactor * len * Math.sin(k) + midPoint.y };

                 //path = path.concat(lastPoint, pt1, pt2, candidatePoint);
                 var result = new _Polyline(map.spatialReference);
                 path = path.concat(lastPoint, pt2);
                 result.addPath(path);
                 path = [];
                 path = path.concat(pt1, candidatePoint);
                 result.addPath(path);
                 tempGraphic.geometry = result;
                 tempGraphic.setGeometry(tempGraphic.geometry);
                 */



                 //Option 2

                //this.drawArrow(tempGraphic, firstPoint, candidatePoint, 10);



                /*
                var result = new _Polyline(map.spatialReference);
                 var len = this._2PtLen(firstPoint, candidatePoint);

                 path = path.concat(firstPoint, candidatePoint);
                 result.addPath(path);
                 var midPoint = result.getExtent().getCenter();

                path = [];
                result = new _Polyline(map.spatialReference);
                len = len / 10;

                k = this.angleRadians(lastPoint, candidatePoint);

                var pt1 = { x: -1 * len * Math.cos(k) + midPoint.x, y: -1 * len * Math.sin(k) + midPoint.y };
                var pt2 = { x: len * Math.cos(k) + midPoint.x, y: len * Math.sin(k) + midPoint.y };



               path = path.concat(lastPoint, pt1);
               result.addPath(path);
               path = [];
               path = path.concat(pt2, candidatePoint);
               result.addPath(path);

               // Update Control Points



               //Arrow Head
               var length = this._2PtLen(firstPoint, candidatePoint) / 10;
               k += 15;
               var angle = this.toDegrres(k); // In Degrees
               k-=30;
               var angle2 = this.toDegrres(k); // In Degrees


               var rightWing = new Point(candidatePoint.x + length * Math.cos(this.toRad(angle)),
               candidatePoint.y + length * Math.sin(this.toRad(angle)), map.spatialReference);

               var leftWing = new Point(candidatePoint.x + length * Math.cos(this.toRad(angle2)),
               candidatePoint.y + length * Math.sin(this.toRad(angle2)), map.spatialReference);


               path = [];
               path = path.concat(candidatePoint, rightWing);
               result.addPath(path);

               path = [];
               path = path.concat(candidatePoint, leftWing);
               result.addPath(path);


               tempGraphic.setGeometry(result);


               /* TURF MidPoint
               var tpt1 = {
               "type": "Feature",
               "properties": {},
               "geometry": {
                 "type": "Point",
                 "coordinates": [firstPoint.x, firstPoint.y]
               }
             };
             var tpt2 = {
               "type": "Feature",
               "properties": {},
               "geometry": {
                 "type": "Point",
                 "coordinates": [candidatePoint.x, candidatePoint.y]
               }
             };


             var midpointed = turf.midpoint(tpt1, tpt2);
             var newMp = new Point(midpointed.geometry.coordinates[0],midpointed.geometry.coordinates[1], map.spatialReference);
             map.graphics.add(new _Graphic(newMp, this._markerSymbol));
             */



         }

         break;


         case "SP_ATTK":
					console.log("SP_ATTK")
						
					if (this._points.length <= 1)
					{
						var len = this._2PtLen(this._points[0], candidatePoint);
						var k = Math.atan((this._points[0].y - candidatePoint.y) / (this._points[0].x - candidatePoint.x));
						switch (this.twoPtsRelationShip(this._points[0], candidatePoint))
						{
							case "ne":
								k += Math.PI / 2;
								break;
							case "nw":
								k += Math.PI * 3 / 2;
								break;
							case "sw":
								k += Math.PI * 3 / 2;
								break;
							case "se":
								k += Math.PI / 2;
								break;
						}
						//tail two points

						
						var partialLen = (1 - this._headPercentage) * len;
						
						var p1 = { x: this._tailFactor * partialLen * Math.cos(k) + this._points[0].x, y: this._tailFactor * partialLen * Math.sin(k) + this._points[0].y };
						var p2 = { x: -1 * this._tailFactor * partialLen * Math.cos(k) + this._points[0].x, y: -1 * this._tailFactor * partialLen * Math.sin(k) + this._points[0].y };
						
						this.displayPoint(p1)
						this.displayPoint(p2)
						
						
						
						
						var p3 = { x: this._tailFactor * partialLen * Math.cos(k) + candidatePoint.x, y: this._tailFactor * partialLen * Math.sin(k) + candidatePoint.y };
						var p4 = { x: -1 * this._tailFactor * partialLen * Math.cos(k) + candidatePoint.x, y: -1 * this._tailFactor * partialLen * Math.sin(k) + candidatePoint.y };
						

						var length = len * this._headPercentage;

						var length = this._2PtLen(this._points[0], candidatePoint);
						length = length / 10;
                   		k = this.angleRadians(this._points[this._points.length - 1], candidatePoint);


						var p5 = { x: -1 * length * Math.cos(k) + p3.x, y: -1 * length * Math.sin(k) + p3.y };
						var p6 = { x: -1 * length * Math.cos(k) + p4.x, y: -1 * length * Math.sin(k) + p4.y };

					
						var result = new _Polygon(map.spatialReference);
						var ring = [];

						
						ring.push(p1);
						ring.push(p5);
						result.addRing(ring);
						ring = [];
						ring.push(p2);
						ring.push(p6);
						result.addRing(ring);


						ring = [];
						ring = ring.concat(this.CreateArrowHeadPathEx2(p5, candidatePoint, p6, len, this._headPercentage, 15));

										
						!_Polygon.prototype.isClockwise(ring) && !this.respectDrawingVertexOrder && (console.debug(this.declaredClass + " :  Polygons drawn in anti-clockwise direction will be reversed to be clockwise."), ring.reverse());
						result.addRing(ring);
						
						tempGraphic.setGeometry(result);
					}
					else
					{
						tempArray = []; var leftArray = [], rightArray = [];
						Array.forEach(this._points, function (e)
						{
							tempArray.push({ x: e.x, y: e.y });
						});
						if(candidatePoint !== undefined) {
						tempArray.push({ x: candidatePoint.x, y: candidatePoint.y });
						}

						angleArray = this._vertexAngle(tempArray);
						var totalL = this._ptCollectionLen(tempArray, 0);
						

						for (var i = 0; i < tempArray.length - 1; i++) {
							partialLen = this._ptCollectionLen(tempArray, i);
							partialLen += totalL / 2.4;
							pt1 = { x: (this._tailFactor) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x, y: (this._tailFactor) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y };
							pt2 = { x: -1 * (this._tailFactor) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x, y: -1 * (this._tailFactor) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y };
							
							leftArray.push(pt1);
							rightArray.push(pt2);
						}

						// Problem Area
					
						var len = this._2PtLen(this._points[0], candidatePoint);
						var k = Math.atan((this._points[0].y - candidatePoint.y) / (this._points[0].x - candidatePoint.x));
						switch (this.twoPtsRelationShip(this._points[0], candidatePoint))
						{
							case "ne":
								k += Math.PI / 2;
								break;
							case "nw":
								k += Math.PI * 3 / 2;
								break;
							case "sw":
								k += Math.PI * 3 / 2;
								break;
							case "se":
								k += Math.PI / 2;
								break;
						}
					
						
						var partialLen = (1 - this._headPercentage) * len;
						
						var p1 = { x: this._tailFactor * partialLen * Math.cos(k) + this._points[0].x, y: this._tailFactor * partialLen * Math.sin(k) + this._points[0].y };
						var p2 = { x: -1 * this._tailFactor * partialLen * Math.cos(k) + this._points[0].x, y: -1 * this._tailFactor * partialLen * Math.sin(k) + this._points[0].y };
						
						var p3 = { x: this._tailFactor * partialLen * Math.cos(k) + candidatePoint.x, y: this._tailFactor * partialLen * Math.sin(k) + candidatePoint.y };
						var p4 = { x: -1 * this._tailFactor * partialLen * Math.cos(k) + candidatePoint.x, y: -1 * this._tailFactor * partialLen * Math.sin(k) + candidatePoint.y };
						

						var length = len * this._headPercentage;

						var length = this._2PtLen(this._points[0], candidatePoint);
						length = length / 10;

                   		//k = this.angleRadians(this._points[this._points.length - 1], candidatePoint);
                   		k = this.angleRadians(this._points[this._points.length - 1], candidatePoint);



						var p5 = { x: -1 * length *  Math.cos(k) + p3.x, y: -1 * length * Math.sin(k) + p3.y };
						var p6 = { x: -1 * length * Math.cos(k) + p4.x, y: -1 * length * Math.sin(k) + p4.y };

						//var p5 = { x: -1 * length * this._tailFactor * partialLen * Math.cos(k) + p3.x, y: -1 * length * this._tailFactor * partialLen * Math.sin(k) + p3.y };
						//var p6 = { x: -1 * length * this._tailFactor * partialLen * Math.cos(k) + p4.x, y: -1 * length * this._tailFactor * partialLen * Math.sin(k) + p4.y };

						leftArray.push(p5);
						rightArray.push(p6);

						var ring = [];
						ring = ring.concat(this.CreateArrowHeadPathEx2(p5, candidatePoint, p6, len, this._headPercentage, 15));

						
						//End of Problem Area
						/*
						var len = this._2PtLen(this._points[0], candidatePoint);
						var k = Math.atan((this._points[0].y - candidatePoint.y) / (this._points[0].x - candidatePoint.x));
						switch (this.twoPtsRelationShip(this._points[0], candidatePoint))
						{
							case "ne":
								k += Math.PI / 2;
								break;
							case "nw":
								k += Math.PI * 3 / 2;
								break;
							case "sw":
								k += Math.PI * 3 / 2;
								break;
							case "se":
								k += Math.PI / 2;
								break;
						}
					
						
						var partialLen = (1 - this._headPercentage) * len;
						
						var p1 = { x: this._tailFactor * partialLen * Math.cos(k) + this._points[0].x, y: this._tailFactor * partialLen * Math.sin(k) + this._points[0].y };
						var p2 = { x: -1 * this._tailFactor * partialLen * Math.cos(k) + this._points[0].x, y: -1 * this._tailFactor * partialLen * Math.sin(k) + this._points[0].y };
						
						var p3 = { x: this._tailFactor * partialLen * Math.cos(k) + candidatePoint.x, y: this._tailFactor * partialLen * Math.sin(k) + candidatePoint.y };
						var p4 = { x: -1 * this._tailFactor * partialLen * Math.cos(k) + candidatePoint.x, y: -1 * this._tailFactor * partialLen * Math.sin(k) + candidatePoint.y };
						

						var length = len * this._headPercentage;

						var length = this._2PtLen(this._points[0], candidatePoint);
						length = length / 10;
                   		k = this.angleRadians(this._points[this._points.length - 1], candidatePoint);



						var p5 = { x: -1 * length * Math.cos(k) + p3.x, y: -1 * length * Math.sin(k) + p3.y };
						var p6 = { x: -1 * length * Math.cos(k) + p4.x, y: -1 * length * Math.sin(k) + p4.y };

						leftArray.push(p5);
						rightArray.push(p6);

						var ring = [];
						ring = ring.concat(this.CreateArrowHeadPathEx2(p5, candidatePoint, p6, len, this._headPercentage, 15));
						*/
						//Problem Area



						

						result = new _Polygon(map.spatialReference);

						leftArray = this.CreateBezierPathPCOnly(leftArray, 70);
						//leftArray.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);

						rightArray = this.CreateBezierPathPCOnly(rightArray, 70);
						//rightArray.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);
						
										
						// Add Head ring = ring.concat(headPath);
						
						result.addRing(leftArray);

						result.addRing(rightArray.reverse());
						result.addRing(ring);

						
						tempGraphic.setGeometry(result);
						} 
						/*
						//Phase 2

						tempArray = []; var leftArray = [], rightArray = [];
						Array.forEach(this._points, function (e)
						{
							tempArray.push({ x: e.x, y: e.y });
						});
						if(candidatePoint !== undefined) {
						tempArray.push({ x: candidatePoint.x, y: candidatePoint.y });
						}

						angleArray = this._vertexAngle(tempArray);
						var totalL = this._ptCollectionLen(tempArray, 0);
						
						var length = this._2PtLen(this._points[0], candidatePoint);
						length = length / 10;

						for (var i = 0, len = tempArray.length - 1; i < len; i++)
						{
							partialLen = this._ptCollectionLen(tempArray, i);
							partialLen += totalL / 2.4;
							//console.log(partialLen);

							k = this.angleRadians(this._points[this._points.length -1], candidatePoint);

							pt1 = { x: (this._tailFactor) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x, y: (this._tailFactor) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y };
							pt2 = { x: -1 * (this._tailFactor) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x, y: -1 * (this._tailFactor) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y };
							
							
							var p5 = { x: -1 * length * Math.cos(k) + pt1.x, y: -1 * length * Math.sin(k) + pt1.y };
							var p6 = { x: -1 * length * Math.cos(k) + pt2.x, y: -1 * length * Math.sin(k) + pt2.y };

							this.displayPoint(p5)
							this.displayPoint(p6)

							leftArray.push(pt1);
							rightArray.push(pt2);
						}

						// Problem Area



						
                   		


						


						//leftArray.push({ x: p5.x, y: p5.y });
						//rightArray.push({ x: p6.x, y: p6.y });

						//this.displayPoint(p5);
						//this.displayPoint(p6);
						


						//Problem Area

						
						//leftArray.push({ x: candidatePoint.x, y: candidatePoint.y });
						//rightArray.push({ x: candidatePoint.x, y: candidatePoint.y });
						


						
						
						

						
						leftArray = this.CreateBezierPathPCOnly(leftArray, 70);
						//leftArray.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);

						rightArray = this.CreateBezierPathPCOnly(rightArray, 70);
						//rightArray.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);
						

						var headPath = this.CreateArrowHeadPathEx2(leftArray[leftArray.length - 1], candidatePoint, rightArray[rightArray.length - 1], this._ptCollectionLen(tempArray, 0), this._headPercentage, 15);
						ring = [];
						ring = ring.concat(leftArray);
						
						// Add Head ring = ring.concat(headPath);
						
						ring = ring.concat(rightArray.reverse());
						//ring.push(ring[0]);


						result = new _Polygon(map.spatialReference);

						result.addRing(ring);
						tempGraphic.geometry = result;
						tempGraphic.setGeometry(tempGraphic.geometry);

						*/




						/*
						tempArray = []; var leftArray = [], rightArray = [];
						Array.forEach(this._points, function (e)
						{
							tempArray.push({ x: e.x, y: e.y });
						});
						tempArray.push({ x: candidatePoint.x, y: candidatePoint.y });

						angleArray = this._vertexAngle(tempArray);
						var totalL = this._ptCollectionLen(tempArray, 0);
						for (var i = 0, len = tempArray.length - 1; i < len; i++)
						{
							partialLen = this._ptCollectionLen(tempArray, i);
							partialLen += totalL / 2.4;
							//console.log(partialLen);

							pt1 = { x: (this._tailFactor) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x, y: (this._tailFactor) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y };
							pt2 = { x: -1 * (this._tailFactor) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x, y: -1 * (this._tailFactor) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y };

							leftArray.push(pt1);
							rightArray.push(pt2);
						}


						leftArray.push({ x: candidatePoint.x, y: candidatePoint.y });
						rightArray.push({ x: candidatePoint.x, y: candidatePoint.y });
				


						leftArray = this.CreateBezierPathPCOnly(leftArray, 70);
						leftArray.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);

						rightArray = this.CreateBezierPathPCOnly(rightArray, 70);
						rightArray.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);

						var headPath = this.CreateArrowHeadPathEx(leftArray[leftArray.length - 1], candidatePoint, rightArray[rightArray.length - 1], this._ptCollectionLen(tempArray, 0), this._headPercentage, 15);
						ring = [];
						ring = ring.concat(leftArray);
						
						// Add Head ring = ring.concat(headPath);
						
						ring = ring.concat(rightArray.reverse());
						ring.push(ring[0]);
						

						result = new _Polygon(map.spatialReference);

						result.addRing(ring);
						tempGraphic.geometry = result;
						tempGraphic.setGeometry(tempGraphic.geometry);
						*/

					
					break;

					 case "BOF_SP_BY_FIRE":
						var temp = [];
						var result = new _Polygon(map.spatialReference);
						var baseLinePath = this._baseLine(this._points[0], candidatePoint);		
						//var temp = this.baseOfFire(this._points[0], candidatePoint);		
						temp = temp.concat(baseLinePath.startPt, baseLinePath.endPt, baseLinePath.midPt);
						//


						result.addRing(temp);
						
						tempGraphic.setGeometry(result);




					break;

      default:
      console.error("Unsupported Geometry Type ");
      return;




			}
        },


        _onDblClickHandler: function (clickPoint)
		{
            console.log("Dbl Click");

			//console.log("i'm here!");
			var geometry, _points = this._points;
			has("esri-touch") && _points.push(clickPoint.mapPoint);
            //Added due to a bug
            _points.push(clickPoint.mapPoint);
            //End of added due to abug
			_points = _points.slice(0, _points.length);
			switch (this._geometryType)
			{

				case "CURVE":
                	if (_points.length > 2)
					{
						geometry = this._tGraphic.geometry;
                        var controlPts = lang.clone(this._points);
						geometry.controlPoints = controlPts;
                        geometry.drawExtendType = "CURVE";


					}

					break;

				case "BEZIER_CURVE":

					if (_points.length > 2)
					{
						geometry = this._tGraphic.geometry;
						geometry.controlPoints = lang.clone(this._points);
						geometry.drawExtendType = "BEZIER_CURVE";
					}

					break;


				case "BEZIER_POLYGON":
					if (_points.length > 2)
					{
						geometry = this._tGraphic.geometry;

						geometry.controlPoints = lang.clone(this._points);
						geometry.drawExtendType = "BEZIER_POLYGON";
					}
					break;
				case "FREEHAND_ARROW":
					if (_points.length > 1)
					{
						geometry = this._tGraphic.geometry;
						geometry.controlPoints = lang.clone(this._points);
						geometry.drawExtendType = "FREEHAND_ARROW";
					}
					break;

				case "POLYLINEEX":
					if (_points.length > 1)
					{
						geometry = this._tGraphic.geometry;
						geometry.controlPoints = lang.clone(this._points);
						geometry.drawExtendType = "POLYLINEEX";
					}
					break;

					case "ARROW_POLYLINE":
					if (_points.length > 1)
					{
						geometry = this._tGraphic.geometry;
						geometry.controlPoints = lang.clone(this._points);
						geometry.drawExtendType = "ARROW_POLYLINE";
					}
					break;

		          case "ARROW_SLIM":
		          if (_points.length > 1)
		          {
		            geometry = this._tGraphic.geometry;
		            geometry.controlPoints = lang.clone(this._points);
		            geometry.drawExtendType = "ARROW_SLIM";
		          }
		          break;

		          case "ARROW_SIMPLE":
		          if (_points.length > 1) {
		            geometry = this._tGraphic.geometry;
		            geometry.controlPoints = lang.clone(this._points);
		            geometry.drawExtendType = "ARROW_SIMPLE";
		          }
		          break;

		          case "ARROW_SIMPLE_POLY":
		          if (_points.length > 1) {
		            geometry = this._tGraphic.geometry;
		            geometry.controlPoints = lang.clone(this._points);
		            geometry.drawExtendType = "ARROW_SIMPLE_POLY";
		          }
		          break;

		          case "SP_ATTK":
		          if (_points.length > 1) {
		            geometry = this._tGraphic.geometry;
		            geometry.controlPoints = lang.clone(this._points);
		            geometry.drawExtendType = "SP_ATTK";
		          }
		          break;

					}



			this._drawEnd(geometry);
            this._clear();
            this._removeEvents();



        },

       _distanceBetweenPoints : function(x1, y1, x2, y2) {
	
    return Math.sqrt(Math.pow(x2 - x1, 2) + (Math.pow(y2 - y1, 2)));
},

getPointAlongLine : function(polyline, distance, pathIndex) {
	if (!pathIndex)
		pathIndex = 0;

	if (!distance)
		distance = 0;

	if ((pathIndex >= 0) && (pathIndex < polyline.paths.length)) {
		var path = polyline.paths[pathIndex];
		var x1, x2, x3, y1, y2, y3;
		var travelledDistance = 0;
		var pathDistance;
		var distanceDiff;
		var angle;

		if (distance === 0)
			return polyline.getPoint(pathIndex, 0);
		else if (distance > 0) {
			for (var i = 1; i < path.length; i++) {
				x1 = path[i-1][0];
				y1 = path[i-1][1];
				x2 = path[i][0];
				y2 = path[i][1];

				pathDistance = this._distanceBetweenPoints(x1, y1, x2, y2);
				travelledDistance += pathDistance;

				if (travelledDistance === distance)
					return polyline.getPoint(pathIndex, i);
				else if (travelledDistance > distance) {
					distanceDiff = pathDistance - (travelledDistance - distance);

					angle = Math.atan2(y2-y1, x2-x1);

					x3 = distanceDiff * Math.cos(angle);
					y3 = distanceDiff * Math.sin(angle);

					return new Point(x1 + x3, y1 + y3, polyline.spatialReference);
				}
			}
		}
	}

	return null;
},
        _onDrawComplete: function (event) {
            console.log(event);
            console.log("onDrawEnd");
		},
		onDrawEnd: function (geometry, geoGeometry) {
            console.log("onDrawEnd");
            this.emit("mockDrawEnd", { geometry: geometry, geographicGeometry: geoGeometry });


		},
        _removeEvents: function() {
             this._onClick.remove();
            this._onDblClick.remove();
            this._onMouseMove.remove();
            
            
            map.enableDoubleClickZoom();
        },

        _removeEvents2: function() {
        this._onClick2.remove();
        this._onMouseMove2.remove();
    	},

        _clear: function ()
		{

			this._graphic && map.graphics.remove(this._graphic, !0);
			this._tGraphic && map.graphics.remove(this._tGraphic, !0);

			this._graphic = this._tGraphic = null;
			map.snappingManager && map.snappingManager._setGraphic(null);
			this._points = [];
			this._curvePt1 = this._curvePt2 = null;
		},
        _drawEnd: function (drawGeometry)
		{
			if (drawGeometry)
			{

				var SpatialReference = map.spatialReference, geographicGeometry;

				SpatialReference && (SpatialReference.isWebMercator() ? geographicGeometry = webMercatorUtils.webMercatorToGeographic(drawGeometry, !0) : 4326 === SpatialReference.wkid && (geographicGeometry = jsonUtility.fromJson(drawGeometry.toJson())));
				//this._onDrawComplete({ geometry: drawGeometry, geographicGeometry: geographicGeometry });
                this.onDrawEnd(drawGeometry, geographicGeometry);
			}
		},

        //Mock caculate radius for curve between two points
		_circleDrawEx: function (pt1, pt2, pt3)
		{
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

			if (m11 == 0)
			{
				r = 0;                                 // not a circle
			}
			else
			{
				var Xo = 0.5 * m12 / m11;                 // center of circle
				var Yo = -0.5 * m13 / m11;
				r = Math.sqrt(Xo * Xo + Yo * Yo + m14 / m11);
			}



			return { radius: r, center: { x: Xo, y: Yo } };                                  // the radius
		},

		// Recursive definition of determinate using expansion by minors.
		_determinantDrawEx: function (a, n)
		{
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
			else
			{
				d = 0;
				for (j1 = 0; j1 < n; j1++)            // do each column
				{
					for (i = 1; i < n; i++)            // create minor
					{
						j2 = 0;
						for (j = 0; j < n; j++)
						{
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
        CreateCircleSegmentFromThreePoints: function (circle, pt1, pt2, pt3, numberOfPts, map)
		{
			//		var centerX = ellipseObject.center.x, centerY = ellipseObject.center.y, longAxis = ellipseObject.longAxis, shortAxis = ellipseObject.shortAxis, numberOfPoints = ellipseObject.numberOfPoints, map = ellipseObject.map, f, i, m;
            //		var centerX = ellipseObject.center.x, centerY = ellipseObject.center.y, longAxis = ellipseObject.longAxis, shortAxis = ellipseObject.shortAxis, numberOfPoints = ellipseObject.numberOfPoints, f, i, m;
			//		var ring = [];
			//		var angle = 2 * Math.PI / numberOfPoints;
			//		for (i = 0; i < numberOfPoints; i++)
			//		{
			//			f = Math.cos(i * angle), m = Math.sin(i * angle), f = map.toMap({x: longAxis * f + centerX, y: shortAxis * m + centerY}), ring.push(f);
			//		}
			//		ring.push(ring[0]);
			//		centerX = new l(map.spatialReference);
			//		centerX.addRing(ring);
			//		return centerX
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
			if (anglePt3 < startAngle || anglePt3 > endAngle)
			{
				swipeAngle -= (2 * Math.PI);
			}
			var angle = swipeAngle / numberOfPts, pt;
			for (var i = 0; i <= numberOfPts; i++)
			{
				pt = map.toMap({ x: radius * Math.cos(startAngle + i * angle) + center.x, y: radius * Math.sin(startAngle + i * angle) + center.y });
				path.push(pt);
			}
			//var firstPt = map.toMap({x: radius * Math.cos(startAngle) + center.x, y: radius * Math.sin(startAngle) + center.y});
			//var lastPt = map.toMap({x: radius * Math.cos(endAngle) + center.x, y: radius * Math.sin(endAngle) + center.y});
			//path.splice(0, 0, firstPt);
			//path.push(lastPt);
			var result = new _Polyline(map.spatialReference);
			result.addPath(path);



			return result;

		},
        CreateBezierPath: function (pointCollection, numberOfPts, map)
		{
			var position = { x: pointCollection[0].x, y: pointCollection[0].y };
			if (pointCollection[pointCollection.length - 1].x === pointCollection[pointCollection.length - 2].x && pointCollection[pointCollection.length - 1].y === pointCollection[pointCollection.length - 2].y)
			{
				pointCollection.pop();
			}
			if (pointCollection[pointCollection.length - 1].x === pointCollection[pointCollection.length - 2].x && pointCollection[pointCollection.length - 1].y === pointCollection[pointCollection.length - 2].y)
			{
				pointCollection.pop();
			}
			//pointCollection.push(pt);
			var tween = TweenMax.to(position, numberOfPts, { bezier: pointCollection, ease: Linear.easeNone });
			//ease:Power1.easeInOut  ease: Linear.easeNone
			var path = [];
			for (var i = 0; i <= numberOfPts; i++)
			{
				tween.time(i);
				path.push({ x: position.x, y: position.y });
			}
			var result = new _Polyline(map.spatialReference);
			result.addPath(path);
			return result;

		},

        //Deactivates the toolbar and reactivates map navigation.
		deactivate: function ()
		{
			this._clear();
            this._removeEvents();
            this._geometryType = null;

		},

 CreateBezierPathPoly : function (pointCollection, numberOfPts, map) {
	var position = {x: pointCollection[0].x, y: pointCollection[0].y};
	if (pointCollection[pointCollection.length - 1].x === pointCollection[pointCollection.length - 2].x && pointCollection[pointCollection.length - 1].y === pointCollection[pointCollection.length - 2].y)
	{
		pointCollection.pop();
	}
	if (pointCollection[pointCollection.length - 1].x === pointCollection[pointCollection.length - 2].x && pointCollection[pointCollection.length - 1].y === pointCollection[pointCollection.length - 2].y)
	{
		pointCollection.pop();
	}
	pointCollection.push(pointCollection[0]);

	var tween = TweenMax.to(position, numberOfPts, {bezier: pointCollection, ease: Linear.easeNone});

	var path = [];
	for (var i = 0; i <= numberOfPts; i++)
	{
		tween.time(i);
		path.push({x: position.x, y: position.y});
	}
	var result = new _Polygon(map.spatialReference);
	result.addRing(path);
	return result;


	

},
    _2PtLen: function (pt1, pt2)
		{
			return Math.sqrt((pt1.x - pt2.x) * (pt1.x - pt2.x) + (pt1.y - pt2.y) * (pt1.y - pt2.y));
		},

        	twoPtsRelationShip: function (pt1, pt2)
		{
			if (pt2.x > pt1.x && pt2.y >= pt1.y) return "ne";
			else if (pt2.x <= pt1.x && pt2.y > pt1.y) return "nw";
			else if (pt2.x < pt1.x && pt2.y <= pt1.y) return "sw";
			else return "se";
		},

        	CreateArrowHeadPathEx: function (pt1, candidatePt, pt2, totalLen, headPercentage, headAngle, straight) {

			//var headSizeBaseRatio = 1.7;
			var headSizeBaseRatio = 1.1;
            //set result = 0 to create single line arrow like -------->
			var headBaseLen = totalLen * headPercentage;
			
			
			var headSideLen = headBaseLen * headSizeBaseRatio;
			var angle1 = this.twoPtsAngle(candidatePt, pt1);
			var angle2 = this.twoPtsAngle(candidatePt, pt2);

			var midAngle = (Math.abs(angle1 - angle2)) / 2;
			if (Math.abs(angle1 - angle2) > Math.PI * 1.88) midAngle += Math.PI;
			var len = Math.sqrt(headBaseLen * headBaseLen + headSideLen * headSideLen - 2 * headSideLen * headBaseLen * Math.cos(midAngle + headAngle / 180 * Math.PI));
			var upAngle = Math.asin(headBaseLen * Math.sin(midAngle + headAngle / 180 * Math.PI) / len);
			var centAngle = upAngle + headAngle / 180 * Math.PI;
			var result;
            result = (straight == false || straight == undefined) ? (headBaseLen * Math.sin(Math.PI - centAngle - midAngle) / Math.sin(centAngle)) : 0;
			var path = [];

			path.push({ x: candidatePt.x + result * Math.cos(angle1), y: candidatePt.y + result * Math.sin(angle1) });
			path.push({ x: candidatePt.x + headSideLen * Math.cos(angle1 - headAngle / 180 * Math.PI), y: candidatePt.y + headSideLen * Math.sin(angle1 - headAngle / 180 * Math.PI) });
			path.push(candidatePt);
			path.push({ x: candidatePt.x + headSideLen * Math.cos(angle2 + headAngle / 180 * Math.PI), y: candidatePt.y + headSideLen * Math.sin(angle2 + headAngle / 180 * Math.PI) });
			path.push({ x: candidatePt.x + result * Math.cos(angle2), y: candidatePt.y + result * Math.sin(angle2) });
			return path;

		},


		CreateArrowHeadPathEx2: function (pt1, candidatePt, pt2, totalLen, headPercentage, headAngle, straight) {

			var headSizeBaseRatio = 1.9;
			//var headSizeBaseRatio = 1.1;
            //set result = 0 to create single line arrow like -------->
			var headBaseLen = totalLen * headPercentage;
			console.info(headBaseLen);
			console.info(totalLen);
			console.info(headPercentage);
			
			var headSideLen = headBaseLen * headSizeBaseRatio;
			var angle1 = this.twoPtsAngle(candidatePt, pt1);
			var angle2 = this.twoPtsAngle(candidatePt, pt2);

			var midAngle = (Math.abs(angle1 - angle2)) / 2;
			if (Math.abs(angle1 - angle2) > Math.PI * 1.88) midAngle += Math.PI;
			var len = Math.sqrt(headBaseLen * headBaseLen + headSideLen * headSideLen - 2 * headSideLen * headBaseLen * Math.cos(midAngle + headAngle / 180 * Math.PI));
			var upAngle = Math.asin(headBaseLen * Math.sin(midAngle + headAngle / 180 * Math.PI) / len);
			var centAngle = upAngle + headAngle / 180 * Math.PI;
			var result;
            result = (straight == false || straight == undefined) ? (headBaseLen * Math.sin(Math.PI - centAngle - midAngle) / Math.sin(centAngle)) : 0;
			var path = [];



			//path.push({ x: candidatePt.x + result * Math.cos(angle1), y: candidatePt.y + result * Math.sin(angle1) });
			path.push(pt1);
			path.push({ x: candidatePt.x + headSideLen * Math.cos(angle1 - headAngle / 180 * Math.PI), y: candidatePt.y + headSideLen * Math.sin(angle1 - headAngle / 180 * Math.PI) });
			



			
			path.push(candidatePt);
			path.push({ x: candidatePt.x + headSideLen * Math.cos(angle2 + headAngle / 180 * Math.PI), y: candidatePt.y + headSideLen * Math.sin(angle2 + headAngle / 180 * Math.PI) });
			path.push(pt2);
			//path.push({ x: candidatePt.x + result * Math.cos(angle2), y: candidatePt.y + result * Math.sin(angle2) });

			return path;

		},

        twoPtsAngle: function (pt1, pt2)
		{;
			var angle = Math.acos((pt2.x - pt1.x) / this._2PtLen(pt1, pt2));
			if (pt2.y < pt1.y)
			{
				angle = 2 * Math.PI - angle;
			}
			return angle;
		},

			_vertexAngle: function (ptc)
		{
			var segmentAngle = [], vertexAngle = [], left = [];
			for (var i = 0, len = ptc.length - 1; i < len; i++)
			{
				//0 -2pi
				var x = this.twoPtsAngle(ptc[i], ptc[i + 1]);

				segmentAngle.push(x);
			}


			x = this.twoPtsAngle(ptc[0], ptc[1]);

			vertexAngle.push(x += Math.PI / 2);
			for (i = 1; i < len; i++)
			{
				//var x = segmentAngle[i - 1] < segmentAngle[i] ? segmentAngle[i - 1] : segmentAngle[i] + polyline._3PtAngleAngleHalf(ptc[i - 1], ptc[i], ptc[i + 1]);
				x = (segmentAngle[i - 1] + segmentAngle[i]) / 2;
				if (segmentAngle[i - 1] < Math.PI && segmentAngle[i] - Math.PI > segmentAngle[i - 1])
				{
					x += Math.PI;
				}
				else if (segmentAngle[i - 1] > Math.PI && segmentAngle[i] < segmentAngle[i - 1] - Math.PI)
				{
					x += Math.PI;
				}

				x += Math.PI / 2;
				vertexAngle.push(x);
			}
			return vertexAngle;
		},

        	_ptCollectionLen: function (ptc, startIndex)
		{
			var len = 0;
			for (var i = startIndex, pathLen = ptc.length - 1; i < pathLen; i++)
			{
				len += this._2PtLen(ptc[i], ptc[i + 1]);
			}
			return len;
		},
        CreateBezierPathPCOnly: function (pointCollection, numberOfPts)
		{
			var position = { x: pointCollection[0].x, y: pointCollection[0].y };
			if (pointCollection[pointCollection.length - 1].x === pointCollection[pointCollection.length - 2].x && pointCollection[pointCollection.length - 1].y === pointCollection[pointCollection.length - 2].y)
			{
				pointCollection.pop();
			}
			if (pointCollection[pointCollection.length - 1].x === pointCollection[pointCollection.length - 2].x && pointCollection[pointCollection.length - 1].y === pointCollection[pointCollection.length - 2].y)
			{
				pointCollection.pop();
			}
			//pointCollection.push(pt);
			var tween = TweenMax.to(position, numberOfPts, { bezier: pointCollection, ease: Linear.easeNone });
			//ease:Power1.easeInOut  ease: Linear.easeNone
			var path = [];
			for (var i = 0; i <= numberOfPts; i++)
			{
				tween.time(i);
				path.push({ x: position.x, y: position.y });
			}

			return path;

		},

        _controlPointsUpdates: function (type, graphic, controlPoints)
		{

			switch (type)
			{

				case "BEZIER_POLYGON":
					var tempArray = [];
					Array.forEach(controlPoints, function (e)
					{
						tempArray.push({ x: e.x, y: e.y });
					});
					graphic.geometry = this.CreateBezierPathPoly(tempArray, 130, map);
					graphic.setGeometry(graphic.geometry);
					break;
				case "BEZIER_CURVE":
					var tempArray = [];
					Array.forEach(controlPoints, function (e)
					{
						tempArray.push({ x: e.x, y: e.y });
					});
					graphic.geometry = this.CreateBezierPath(tempArray, 100, map);
					graphic.setGeometry(graphic.geometry);
					break;
				case "CURVE":
					var circle = this._circleDrawEx(map.toScreen(controlPoints[0]), map.toScreen(controlPoints[1]), map.toScreen(controlPoints[2]));
					if (circle.radius > 0)
					{

						graphic.geometry = this.CreateCircleSegmentFromThreePoints(circle, map.toScreen(controlPoints[0]), map.toScreen(controlPoints[1]), map.toScreen(controlPoints[2]), 60, map);
						graphic.setGeometry(graphic.geometry);
						//tempGraphic.setSymbol(this.fillSymbol);
					}
					break;
				case "FREEHAND_ARROW":
					var tempArray = [], leftArray = [], rightArray = [];
					Array.forEach(controlPoints, function (e)
					{
						tempArray.push({ x: e.x, y: e.y });
					});
					//var summit = tempArray.pop();

					var angleArray = this._vertexAngle(tempArray), partialLen, pt1, pt2;
					var totalL = this._ptCollectionLen(tempArray, 0);
					for (var i = 0, len = tempArray.length - 1; i < len; i++)
					{
						partialLen = this._ptCollectionLen(tempArray, i);
						partialLen += totalL / 2.4;
						//console.log(partialLen);

						pt1 = { x: (this._tailFactor) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x, y: (this._tailFactor) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y };
						pt2 = { x: -1 * (this._tailFactor) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x, y: -1 * (this._tailFactor) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y };

						leftArray.push(pt1);
						rightArray.push(pt2);
					}
					leftArray.push({ x: tempArray[tempArray.length - 1].x, y: tempArray[tempArray.length - 1].y });
					rightArray.push({ x: tempArray[tempArray.length - 1].x, y: tempArray[tempArray.length - 1].y });

					leftArray = this.CreateBezierPathPCOnly(leftArray, 70);
					leftArray.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);

					rightArray = this.CreateBezierPathPCOnly(rightArray, 70);
					rightArray.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);

					var headPath = this.CreateArrowHeadPathEx(leftArray[leftArray.length - 1], { x: tempArray[tempArray.length - 1].x, y: tempArray[tempArray.length - 1].y }, rightArray[rightArray.length - 1], this._ptCollectionLen(tempArray, 0), this._headPercentage, 15);
					var ring = [];
					ring = ring.concat(leftArray);
					ring = ring.concat(headPath);
					ring = ring.concat(rightArray.reverse());
					ring.push(ring[0]);

					var result = new _Polygon(map.spatialReference);
					//!_Polygon.prototype.isClockwise(ring) && !this.respectDrawingVertexOrder && (console.debug(this.declaredClass + " :  Polygons drawn in anti-clockwise direction will be reversed to be clockwise."), ring.reverse());
					result.addRing(ring);
					graphic.geometry = result;
					graphic.setGeometry(graphic.geometry);
					break;

					case "POLYLINEEX":

						tempArray = [], leftArray = [], rightArray = [];
						Array.forEach(controlPoints, function (e)
						{
							tempArray.push({ x: e.x, y: e.y });
						});
						//tempArray.push({ x: candidatePoint.x, y: candidatePoint.y });
						//tempArray.push({ x: controlPoints[controlPoints.length - 1].x, y: controlPoints[controlPoints.length - 1].y });

						var angleArray = this._vertexAngle(tempArray), partialLen, pt1, pt2;
						for (i = 0, len = tempArray.length - 1; i < len; i++)
            				{

							partialLen = this._ptCollectionLen(tempArray, i);
							//console.log(partialLen);

							pt1 = { x: (this._tailFactor + i / 18 / len) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x, y: (this._tailFactor + i / 18 / len) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y };
							pt2 = { x: -1 * (this._tailFactor + i / 18 / len) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x, y: -1 * (this._tailFactor + i / 18 / len) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y };

							leftArray.push(pt1);
							rightArray.push(pt2);


						}
						ring = [];
						ring = ring.concat(leftArray);
						//ring.push(candidatePoint);
						ring.push({ x: controlPoints[controlPoints.length - 1].x, y: controlPoints[controlPoints.length - 1].y });
						ring = ring.concat(rightArray.reverse());
						ring.push(ring[0]);
						result = new _Polygon(map.spatialReference);
						!_Polygon.prototype.isClockwise(ring) && !this.respectDrawingVertexOrder && (console.debug(this.declaredClass + " :  Polygons drawn in anti-clockwise direction will be reversed to be clockwise."), ring.reverse());
						result.addRing(ring);
						graphic.geometry = result;
						graphic.setGeometry(graphic.geometry);

					break;
					case "ARROW_POLYLINE":
					var tempArray = [], leftArray = [], rightArray = [];
					Array.forEach(controlPoints, function (e)
					{
						tempArray.push({ x: e.x, y: e.y });
					});
					//var summit = tempArray.pop();

					var angleArray = this._vertexAngle(tempArray), partialLen, pt1, pt2;
					var totalL = this._ptCollectionLen(tempArray, 0);
					for (var i = 0, len = tempArray.length - 1; i < len; i++)
					{
						partialLen = this._ptCollectionLen(tempArray, i);
						partialLen += totalL / 2.4;
						//console.log(partialLen);

						pt1 = { x: (this._tailFactor) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x, y: (this._tailFactor) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y };
						pt2 = { x: -1 * (this._tailFactor) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x, y: -1 * (this._tailFactor) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y };

						leftArray.push(pt1);
						rightArray.push(pt2);
					}
					/*
					leftArray.push({ x: tempArray[tempArray.length - 1].x, y: tempArray[tempArray.length - 1].y });
					rightArray.push({ x: tempArray[tempArray.length - 1].x, y: tempArray[tempArray.length - 1].y });

					leftArray = this.CreateBezierPathPCOnly(leftArray, 70);
					leftArray.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);

					rightArray = this.CreateBezierPathPCOnly(rightArray, 70);
					rightArray.splice(Math.floor((1 - this._headPercentage) * 70), Number.MAX_VALUE);
					*/
					var headPath = this.CreateArrowHeadPathEx(leftArray[leftArray.length - 1], { x: tempArray[tempArray.length - 1].x, y: tempArray[tempArray.length - 1].y }, rightArray[rightArray.length - 1], this._ptCollectionLen(tempArray, 0), this._headPercentage, 15);
					var path = [];
					path = path.concat(leftArray);
					path = path.concat(headPath);
					path = path.concat(rightArray.reverse());
					path.push(path[0]);

					var result = new _Polyline(map.spatialReference);
					//!_Polygon.prototype.isClockwise(ring) && !this.respectDrawingVertexOrder && (console.debug(this.declaredClass + " :  Polygons drawn in anti-clockwise direction will be reversed to be clockwise."), ring.reverse());
					result.addPath(path);
					graphic.geometry = result;
					graphic.setGeometry(graphic.geometry);
					break;

			          case "ARROW_SLIM":

			          var tempArray = [], leftArray = [], rightArray = [];
			          Array.forEach(controlPoints, function (e)
			          {
			            tempArray.push({ x: e.x, y: e.y });
			          });

			          var angleArray = this._vertexAngle(tempArray), partialLen, pt1, pt2;
			          var totalL = this._ptCollectionLen(tempArray, 0);
			          for (var i = 0, len = tempArray.length - 1; i < len; i++)
			          {
			            partialLen = this._ptCollectionLen(tempArray, i);
			            partialLen += totalL / 2.4;

			            pt1 = { x: (this._tailFactor) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x, y: (this._tailFactor) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y };
			            pt2 = { x: -1 * (this._tailFactor) * partialLen * Math.cos(angleArray[i]) + tempArray[i].x, y: -1 * (this._tailFactor) * partialLen * Math.sin(angleArray[i]) + tempArray[i].y };

			            leftArray.push(pt1);
			            rightArray.push(pt2);
			          }

			          var headPath = this.CreateArrowHeadPathEx(leftArray[leftArray.length - 1], { x: tempArray[tempArray.length - 1].x, y: tempArray[tempArray.length - 1].y }, rightArray[rightArray.length - 1], this._ptCollectionLen(tempArray, 0), this._headPercentage, 15);
			          var path = [];
			          path = path.concat(tempArray, headPath);



			          var result = new _Polyline(map.spatialReference);

			          result.addPath(path);
			          graphic.geometry = result;
			          graphic.setGeometry(graphic.geometry);
			          break;


			         case "ARROW_SIMPLE":
			         this.drawArrow(graphic, graphic.geometry.controlPoints[0], graphic.geometry.controlPoints[1], 10);
			          break;

			         case "ARROW_SIMPLE_POLY":

			        var geom = new _Polyline(map.spatialReference);
              		var midPoints = [];
              		//var values = this._fracture(graphic.geometry.controlPoints, graphic.geometry.controlPoints[graphic.geometry.controlPoints.length-1], 10);
              		var values = this._fracture(graphic.geometry.controlPoints, undefined, 10);



              	
              		//Write in between Fractures
              for (var i = 0; i < values.midPoints.length; i++) {
              	//this.displayMapPoint(values.midPoints[i]);


              	var k = this.angleRadians(graphic.geometry.controlPoints[i], values.midPoints[i]);
              	var length = this._2PtLen(graphic.geometry.controlPoints[i], values.midPoints[i]) / 10;
              	 k += 15;
                    var angle = this.toDegrres(k); // In Degrees
                    k-=30;
                    var angle2 = this.toDegrres(k); // In Degrees
              	values.geometry.addPath(this._arrowHead(values.midPoints[i], length, angle, angle2));

              };

              	//End of Write in between Fractures
              	graphic.setGeometry(values.geometry);
		         
                break;


				default:
				break;
			}

		},
      getMidPoint: function(p1, p2) {
        var path = [];
        var result = new _Polyline(map.spatialReference);
       	path = path.concat(p1, p2);
       	result.addPath(path);
        return result.getExtent().getCenter();
      },
		drawArrow : function(graphic, firstPoint, candidatePoint, gapLen) {
					var path = [];
               		var result = new _Polyline(map.spatialReference);
                    var len = this._2PtLen(firstPoint, candidatePoint);

                    var midPoint = this.getMidPoint(firstPoint, candidatePoint);

                     path = [];
                     result = new _Polyline(map.spatialReference);
                     len = len / gapLen;

                     k = this.angleRadians(firstPoint, candidatePoint);

                     var pt1 = { x: -1 * len * Math.cos(k) + midPoint.x, y: -1 * len * Math.sin(k) + midPoint.y };
                     var pt2 = { x: len * Math.cos(k) + midPoint.x, y: len * Math.sin(k) + midPoint.y };



                    path = path.concat(firstPoint, pt1);
                    result.addPath(path);
                    path = [];
                    path = path.concat(pt2, candidatePoint);
                    result.addPath(path);


                    //Arrow Head
                    var length = this._2PtLen(firstPoint, candidatePoint) / 10;
                    
                    k += 15;
                    var angle = this.toDegrres(k); // In Degrees
                    k-=30;
                    var angle2 = this.toDegrres(k); // In Degrees

                     /*
                    var rightWing = new Point(candidatePoint.x + length * Math.cos(this.toRad(angle)),
                    candidatePoint.y + length * Math.sin(this.toRad(angle)), map.spatialReference);

                    var leftWing = new Point(candidatePoint.x + length * Math.cos(this.toRad(angle2)),
                    candidatePoint.y + length * Math.sin(this.toRad(angle2)), map.spatialReference);


                    path = [];
                    path = path.concat(candidatePoint, rightWing);
                    result.addPath(path);

                    path = [];
                    path = path.concat(candidatePoint, leftWing);
                    result.addPath(path);
                    */

                    result.addPath(this._arrowHead(candidatePoint, length, angle, angle2));

                    graphic.setGeometry(result);


                     /* Option 1
                    var len = this._2PtLen(this._points[0], candidatePoint);
                    var k = Math.atan((this._points[0].y - candidatePoint.y) / (this._points[0].x - candidatePoint.x));
                    switch (this.twoPtsRelationShip(this._points[0], candidatePoint)) {
                        case "ne":
                            k += Math.PI / 2;
                            break;
                        case "nw":
                            k += Math.PI * 3 / 2;
                            break;
                        case "sw":
                            k += Math.PI * 3 / 2;
                            break;
                        case "se":
                            k += Math.PI / 2;
                            break;
                    }
                    var point1 = new LatLon(lastPoint.y, lastPoint.x),
                        point2 = new LatLon(candidatePoint.y, candidatePoint.x);
                   var pMid = point1.midpointTo(point2);
                   var midPoint = new Point(pMid.lon, pMid.lat, map.spatialReference);

                   k = this.angleRadians(lastPoint, candidatePoint);
                   var pt1 = { x: this._tailFactor * len * Math.cos(k) + midPoint.x, y: this._tailFactor * len * Math.sin(k) + midPoint.y };
                   var pt2 = { x: -1 * this._tailFactor * len * Math.cos(k) + midPoint.x, y: -1 * this._tailFactor * len * Math.sin(k) + midPoint.y };

                      //path = path.concat(lastPoint, pt1, pt2, candidatePoint);
                      var result = new _Polyline(map.spatialReference);
                      path = path.concat(lastPoint, pt2);
                      result.addPath(path);
                      path = [];
                      path = path.concat(pt1, candidatePoint);
                      result.addPath(path);
                      tempGraphic.geometry = result;
                      tempGraphic.setGeometry(tempGraphic.geometry);
                      */



                      //Option 2


                     /*
                     var result = new _Polyline(map.spatialReference);
                      var len = this._2PtLen(firstPoint, candidatePoint);

                      path = path.concat(firstPoint, candidatePoint);
                      result.addPath(path);
                      var midPoint = result.getExtent().getCenter();

                     path = [];
                     result = new _Polyline(map.spatialReference);
                     len = len / 10;

                     k = this.angleRadians(lastPoint, candidatePoint);

                     var pt1 = { x: -1 * len * Math.cos(k) + midPoint.x, y: -1 * len * Math.sin(k) + midPoint.y };
                     var pt2 = { x: len * Math.cos(k) + midPoint.x, y: len * Math.sin(k) + midPoint.y };



                    path = path.concat(lastPoint, pt1);
                    result.addPath(path);
                    path = [];
                    path = path.concat(pt2, candidatePoint);
                    result.addPath(path);

                    // Update Control Points



                    //Arrow Head
                    var length = this._2PtLen(firstPoint, candidatePoint) / 10;
                    k += 15;
                    var angle = this.toDegrres(k); // In Degrees
                    k-=30;
                    var angle2 = this.toDegrres(k); // In Degrees


                    var rightWing = new Point(candidatePoint.x + length * Math.cos(this.toRad(angle)),
                    candidatePoint.y + length * Math.sin(this.toRad(angle)), map.spatialReference);

                    var leftWing = new Point(candidatePoint.x + length * Math.cos(this.toRad(angle2)),
                    candidatePoint.y + length * Math.sin(this.toRad(angle2)), map.spatialReference);


                    path = [];
                    path = path.concat(candidatePoint, rightWing);
                    result.addPath(path);

                    path = [];
                    path = path.concat(candidatePoint, leftWing);
                    result.addPath(path);


                    tempGraphic.setGeometry(result);
                      */

                    /* TURF MidPoint
                    var tpt1 = {
                    "type": "Feature",
                    "properties": {},
                    "geometry": {
                      "type": "Point",
                      "coordinates": [firstPoint.x, firstPoint.y]
                    }
                  };
                  var tpt2 = {
                    "type": "Feature",
                    "properties": {},
                    "geometry": {
                      "type": "Point",
                      "coordinates": [candidatePoint.x, candidatePoint.y]
                    }
                  };


                  var midpointed = turf.midpoint(tpt1, tpt2);
                  var newMp = new Point(midpointed.geometry.coordinates[0],midpointed.geometry.coordinates[1], map.spatialReference);
                  map.graphics.add(new _Graphic(newMp, this._markerSymbol));
                  */


		},


		_baseLine:  function(pt1, pt2) {
			
			var length = this._2PtLen(pt1, pt2);
			var angle = this.angleInRadians(pt1, pt2);
			var thirdPt = new Point(pt2.x + length * Math.cos(angle), pt2.y + length * Math.sin(angle), map.spatialReference);
			return {"startPt": pt1, "endPt": pt2, "midPt": thirdPt};
		},


		baseOfFire:  function(pt1, pt2) {
			var paths = [];
			var length = this._2PtLen(pt1, pt2);
			var angle = this.angleInRadians(pt1, pt2);
			var thirdPt = new Point(pt2.x + length * Math.cos(angle), pt2.y + length * Math.sin(angle), map.spatialReference);
			paths = paths.concat(pt1, pt2, thirdPt);
			return paths;
		},


		angleInDegrees:  function(pt1, pt2) {

			return Math.atan2(pt2.y - pt1.y, pt2.x - pt1.x) * 180 / Math.PI;
		},


		angleInRadians:  function(pt1, pt2) {

			return Math.atan2(pt2.y - pt1.y, pt2.x - pt1.x);;
		},


		 //========================ArrowLine Start===============================================================
                        ArrowLine: function(id, extraAttribs, P1, P2, graphicsLayer, outlineColoroption, centerText) {
                            //adjust r l u d size 
                            var distanceBw2Points = (Math.sqrt(Math.pow((P2.x - P1.x), 2) + Math.pow((P2.y - P1.y), 2))) / 2;

                            //// symbol outline color 
                            var changeOutlineColor;
                            if (outlineColoroption.outlineColor === "red") {
                                changeOutlineColor = [255, 0, 0];
                            } else if (outlineColoroption.outlineColor === "blue") {
                                changeOutlineColor = [0, 0, 255];
                            } else if (outlineColoroption.outlineColor === "black") {
                                changeOutlineColor = [0, 0, 0];
                            }






                            var rectExtentX = distanceBw2Points * .2;
                            var rectExtentY = distanceBw2Points * .2;
                            //adjust arrow size            
                            var rectExtentX1 = distanceBw2Points * .1;
                            var rectExtentY1 = -distanceBw2Points * .1;
                            var delta = 0.07;
                            var pointArray = [];
                            var x = 0;
                            var y = 1;

                            var centerX = (P1.x + P2.x) / 2;
                            var centerY = (P1.y + P2.y) / 2;

                            var symbolAngle = Math.atan((P2.y - P1.y) / (P2.x - P1.x));

                            var symbolAngleText = Math.atan((P2.y - P1.y) / (P2.x - P1.x)) * 180 / Math.PI;


                            var textSymbol = new esri.symbol.TextSymbol(centerText).setAngle(-(symbolAngleText)).setColor(
                                new esri.Color(changeOutlineColor)).setAlign(esri.symbol.Font.ALIGN_START).setFont(
                                new esri.symbol.Font("12pt"));

                            var point = new Point(centerX, centerY);
                            var gra = new _Graphic(point, textSymbol);
                            gra.id = id;
                            gra.attributes = extraAttribs;
                            graphicsLayer.add(gra);

                            pointArray.push([
                                centerX,
                                centerY,

                            ]);
                            pointArray.push([
                                centerX - distanceBw2Points,
                                centerY,

                            ]);

                            pointArray.push([
                                centerX - distanceBw2Points - rectExtentX,
                                centerY - rectExtentY,

                            ]);

                            //pointArray = this.ownRotate(pointArray, centerX, centerY, symbolAngle);

                            var temp = [];

                            temp.push([pointArray[0][x], pointArray[0][y]]);
                            temp.push([pointArray[1][x], pointArray[1][y]]);
                            temp.push([pointArray[2][x], pointArray[2][y]]);


                            var myPolygon = {
                                "geometry": {
                                    "rings": [
                                        temp
                                    ],
                                    "spatialReference": {
                                        "wkid": 4326
                                    }
                                },


                                "symbol": {
                                    "color": [0, 0, 0, 0],
                                    "outline": {
                                        "color": changeOutlineColor,
                                        "width": 2,
                                        "type": "esriSLS",
                                        "style": "esriSLSSolid"
                                    },
                                    "type": "esriSFS",
                                    "style": "esriSFSSolid"
                                }
                            };
                            /*
                            var gra = new _Graphic(myPolygon);
                            gra.id = id;
                            gra.attributes = extraAttribs;
                            graphicsLayer.add(gra);

                            pointArray = [];

                            pointArray.push([

                                centerX - distanceBw2Points,
                                centerY,

                            ]);
                            pointArray.push([

                                centerX - distanceBw2Points - rectExtentX,
                                centerY + rectExtentY,

                            ]);

                            pointArray.push([

                                centerX - distanceBw2Points - rectExtentX,
                                centerY - rectExtentY1,

                            ]);

                            pointArray = this.ownRotate(pointArray, centerX, centerY, symbolAngle);

                            var temp = [];

                            temp.push([pointArray[0][x], pointArray[0][y]]);
                            temp.push([pointArray[1][x], pointArray[1][y]]);
                            temp.push([pointArray[2][x], pointArray[2][y]]);

                            var myPolygon = {
                                "geometry": {
                                    "rings": [
                                        temp
                                    ],
                                    "spatialReference": {
                                        "wkid": 4326
                                    }
                                },

                                "symbol": {
                                    "color": [0, 0, 0, 0],
                                    "outline": {
                                        "color": changeOutlineColor,
                                        "width": 2,
                                        "type": "esriSLS",
                                        "style": "esriSLSSolid"
                                    },
                                    "type": "esriSFS",
                                    "style": "esriSFSSolid"
                                }
                            };

                            var gra = new _Graphic(myPolygon);
                            gra.id = id;
                            gra.attributes = extraAttribs;
                            graphicsLayer.add(gra);

                            pointArray = [];

                            pointArray.push([

                                centerX - distanceBw2Points - rectExtentX,
                                centerY + rectExtentY,

                            ]);

                            pointArray.push([

                                centerX - distanceBw2Points - rectExtentX1,
                                centerY + rectExtentY,

                            ]);

                            pointArray = this.ownRotate(pointArray, centerX, centerY, symbolAngle);

                            var temp = [];

                            temp.push([pointArray[0][x], pointArray[0][y]]);
                            temp.push([pointArray[1][x], pointArray[1][y]]);

                            var myPolygon = {
                                "geometry": {
                                    "rings": [
                                        temp
                                    ],
                                    "spatialReference": {
                                        "wkid": 4326
                                    }
                                },
                                "symbol": {
                                    "color": [0, 0, 0, 0],
                                    "outline": {
                                        "color": changeOutlineColor,
                                        "width": 2,
                                        "type": "esriSLS",
                                        "style": "esriSLSSolid"
                                    },
                                    "type": "esriSFS",
                                    "style": "esriSFSSolid"
                                }
                            };

                            var gra = new _Graphic(myPolygon);
                            gra.id = id;
                            gra.attributes = extraAttribs;
                            graphicsLayer.add(gra);

                            ////////////Right side//////////////////////
                            pointArray = [];

                            pointArray.push([

                                centerX,
                                centerY,

                            ]);

                            pointArray.push([
                                centerX + distanceBw2Points,
                                centerY,

                            ]);

                            pointArray.push([
                                centerX + distanceBw2Points + rectExtentX,
                                centerY - rectExtentY,


                            ]);

                            pointArray = this.ownRotate(pointArray, centerX, centerY, symbolAngle);

                            var temp = [];

                            temp.push([pointArray[0][x], pointArray[0][y]]);
                            temp.push([pointArray[1][x], pointArray[1][y]]);
                            temp.push([pointArray[2][x], pointArray[2][y]]);

                            var myPolygon = {
                                "geometry": {
                                    "rings": [
                                        temp
                                    ],
                                    "spatialReference": {
                                        "wkid": 4326
                                    }
                                },
                                "symbol": {
                                    "color": [0, 0, 0, 0],
                                    "outline": {
                                        "color": changeOutlineColor,
                                        "width": 2,
                                        "type": "esriSLS",
                                        "style": "esriSLSSolid"
                                    },
                                    "type": "esriSFS",
                                    "style": "esriSFSSolid"
                                }
                            };

                            var gra = new _Graphic(myPolygon);
                            gra.id = id;
                            gra.attributes = extraAttribs;
                            graphicsLayer.add(gra);

                            pointArray = [];

                            pointArray.push([

                                centerX + distanceBw2Points,
                                centerY,

                            ]);

                            pointArray.push([
                                centerX + distanceBw2Points + rectExtentX,
                                centerY + rectExtentY,

                            ]);

                            pointArray.push([
                                centerX + distanceBw2Points + rectExtentX1,
                                centerY + rectExtentY,

                            ]);

                            pointArray = this.ownRotate(pointArray, centerX, centerY, symbolAngle);

                            var temp = [];

                            temp.push([pointArray[0][x], pointArray[0][y]]);
                            temp.push([pointArray[1][x], pointArray[1][y]]);
                            temp.push([pointArray[2][x], pointArray[2][y]]);


                            var myPolygon = {
                                "geometry": {
                                    "rings": [
                                        temp
                                    ],
                                    "spatialReference": {
                                        "wkid": 4326
                                    }
                                },

                                "symbol": {
                                    "color": [0, 0, 0, 0],
                                    "outline": {
                                        "color": changeOutlineColor,
                                        "width": 2,
                                        "type": "esriSLS",
                                        "style": "esriSLSSolid"
                                    },
                                    "type": "esriSFS",
                                    "style": "esriSFSSolid"
                                }
                            };

                            var gra = new _Graphic(myPolygon);
                            gra.id = id;
                            gra.attributes = extraAttribs;
                            graphicsLayer.add(gra);

                            pointArray = [];

                            pointArray.push([
                                centerX + distanceBw2Points + rectExtentX,
                                centerY + rectExtentY,

                            ]);

                            pointArray.push([
                                centerX + distanceBw2Points + rectExtentX,
                                centerY - rectExtentY1,


                            ]);

                            pointArray = this.ownRotate(pointArray, centerX, centerY, symbolAngle);

                            var temp = [];

                            temp.push([pointArray[0][x], pointArray[0][y]]);
                            temp.push([pointArray[1][x], pointArray[1][y]]);

                            var myPolygon = {
                                "geometry": {
                                    "rings": [
                                        temp
                                    ],
                                    "spatialReference": {
                                        "wkid": 4326
                                    }
                                },

                                "symbol": {
                                    "color": [0, 0, 0, 0],
                                    "outline": {
                                        "color": changeOutlineColor,
                                        "width": 2,
                                        "type": "esriSLS",
                                        "style": "esriSLSSolid"
                                    },
                                    "type": "esriSFS",
                                    "style": "esriSFSSolid"
                                }
                            };

                            var gra = new _Graphic(myPolygon);
                            gra.id = id;
                            gra.attributes = extraAttribs;
                            graphicsLayer.add(gra);
                            */
                            return temp;

                        },
 
                            ownRotate: function(pointArray, centerX, centerY, rotateAngle) {
                            var x = 0;
                            var y = 1;
                            // translate to world cordinate
                            for (var i = 0; i < pointArray.length; i++) {
                                pointArray[i][x] -= centerX;
                            }
                            for (var i = 0; i < pointArray.length; i++) {
                                pointArray[i][y] -= centerY;
                            }
                            // rotation at angle
                            for (var i = 0; i < pointArray.length; i++) {
                                var tX = pointArray[i][x];
                                var tY = pointArray[i][y];
                                pointArray[i][x] = tX * Math.cos(rotateAngle) - tY * Math.sin(rotateAngle);
                                pointArray[i][y] = tX * Math.sin(rotateAngle) + tY * Math.cos(rotateAngle);
                            }
                            //translation back
                            for (var i = 0; i < pointArray.length; i++) {
                                pointArray[i][x] += centerX;
                            }
                            for (var i = 0; i < pointArray.length; i++) {
                                pointArray[i][y] += centerY;
                            }
                            return pointArray;
                        },

        _arrowHead: function(candidatePoint, length, angle, angle2) {
          	       
          			var path = [];
          			var rightWing = new Point(candidatePoint.x + length * Math.cos(this.toRad(angle)), 
          				candidatePoint.y + length * Math.sin(this.toRad(angle)), map.spatialReference);

                    var leftWing = new Point(candidatePoint.x + length * Math.cos(this.toRad(angle2)),
                    candidatePoint.y + length * Math.sin(this.toRad(angle2)), map.spatialReference);
      
					path = path.concat(rightWing, candidatePoint, leftWing);
			                    
          return path;
        },

        _getPtAt: function(candidatePoint, length, angle) {
        	angle = this.toDegrres(angle);

        	return new Point(candidatePoint.x + length * Math.cos(this.toRad(angle)),
                    candidatePoint.y + length * Math.sin(this.toRad(angle)), map.spatialReference);


        },

		_fracturePts: function(startPt, endPoint, gapLen) {
					var path = [];
					var result = new _Polyline(map.spatialReference);

			        var len = this._2PtLen(startPt, endPoint);
                    var midPt = this.getMidPoint(startPt, endPoint);

                    //Drawing in Gap

                    //End of Drawing in Gap



                    path = [];
                    len = len / gapLen;
                    k = this.angleRadians(startPt, endPoint);
                    var pt1 = { x: -1 * len * Math.cos(k) + midPt.x, y: -1 * len * Math.sin(k) + midPt.y };
                    var pt2 = { x: len * Math.cos(k) + midPt.x, y: len * Math.sin(k) + midPt.y };
				   	path = path.concat(startPt, pt1);
                    result.addPath(path);
                    path = [];
                    path = path.concat(pt2, endPoint);
                    result.addPath(path);

					return { geometry: result, midPoint: midPt };

		},

        _fracture: function(points, candidatePoint, gapLen) {

                var result = new _Polyline(map.spatialReference);
				var path = [];
				var values = [];
				var midPts = [];
				var p1,p2;
				var temp = [];
				var innerPaths = [];				

				if(points.length <= 1) {
					values = this._fracturePts(points[0], candidatePoint, gapLen);
					result = values.geometry;
					midPts.push(values.midPoint);
					


				} else {
					values = [];
					midPts = [];
					if(candidatePoint !== undefined)  { 
						path = path.concat(points, candidatePoint); 

					} else  {
						path = points;
					}
					
					for (var i = 0; i < path.length - 1; i++) {
					    p1 = path[i];
					    if(path[i+1] != undefined) {
					      p2 = path[i+1];
					    } else {
					    p1 = path[i-1];
					    p2 = path[i];
					    }
					 

					 

					values = this._fracturePts(p1, p2, gapLen);
					
					innerPaths = values.geometry.paths;
					midPts.push(values.midPoint);


					  for (var j = 0; j < innerPaths.length; j++) {
					  	result.addPath(innerPaths[j]);
					  }
					  
					}
				
				


					}

          //return { geometry: result, midPoints: midPts };
          return { geometry: result, midPoints: midPts };
        },

        displayMapPoint(pt) {
			map.graphics.add(new _Graphic(pt, this._markerSymbol));
        },
        displayPoint(pt) {
			map.graphics.add(new _Graphic(new Point(pt.x, pt.y, map.spatialReference), this._markerSymbol));
        },



           _gap: function(point1, point2, gapLen) {

                   var len = this._2PtLen(point1, point2);

                      var midPoint = this.getMidPoint(point1, point2);

                     path = [];

                     result = new _Polyline(map.spatialReference);
                     len = len / gapLen;

                     var k = this.angleRadians(point1, point2);

                     var pt1 = { x: -1 * len * Math.cos(k) + midPoint.x, y: -1 * len * Math.sin(k) + midPoint.y };
                     var pt2 = { x: len * Math.cos(k) + midPoint.x, y: len * Math.sin(k) + midPoint.y };

                    path = path.concat(point1, pt1);
                    result.addPath(path);
                    path = [];
                    path = path.concat(pt2, point2);
                    result.addPath(path);


                    /*
                    Working Code
                     var len = this._2PtLen(point1, point2);

                      var midPoint = this.getMidPoint(point1, point2);

                     path = [];

                     result = new _Polyline(map.spatialReference);
                     len = len / gapLen;

                     var k = this.angleRadians(point1, point2);

                     var pt1 = { x: -1 * len * Math.cos(k) + midPoint.x, y: -1 * len * Math.sin(k) + midPoint.y };
                     var pt2 = { x: len * Math.cos(k) + midPoint.x, y: len * Math.sin(k) + midPoint.y };

                    path = path.concat(point1, pt1);
                    result.addPath(path);
                    path = [];
                    path = path.concat(pt2, point2);
                    result.addPath(path);
                    */


                    /*
                    path = path.concat(point1, pt1);
                    result.addPath(path);
                    path = [];
                    path = path.concat(pt2, point2);
                    result.addPath(path);
                    */


                    /*
                    var len = this._2PtLen(point1, point2);
                      var midPoint = this.getMidPoint(point1, point2);
                     path = [];
                     result = new _Polyline(map.spatialReference);
                     len = len / gapLen;

                     var k = this.angleRadians(point1, point2);

                     var pt1 = { x: -1 * len * Math.cos(k) + midPoint.x, y: -1 * len * Math.sin(k) + midPoint.y };
                     var pt2 = { x: len * Math.cos(k) + midPoint.x, y: len * Math.sin(k) + midPoint.y };

                    path = path.concat(point1, pt1);
                    result.addPath(path);
                    path = [];
                    path = path.concat(pt2, point2);
                    result.addPath(path);
                    */

           //map.graphics.add(new _Graphic(result, this._lineSymbol));
          return result;
        },


		/*
		 _updatePolyGeometry: function (geometry, rings, graphicTransform)
		                           {

			                           var firstPoint = geometry.getPoint(0, 0);
			                           var mapfirstPoint = map.toMap(map.toScreen(firstPoint).offset(graphicTransform.dx, graphicTransform.dy));
			                           graphicTransform = mapfirstPoint.x - firstPoint.x;
			                           for (var e = mapfirstPoint.y - firstPoint.y, k, ring, h, i = 0; i < rings.length; i++)
			                           {
				                           ring = rings[i];
				                           for (k = 0; k < ring.length; k++)h = geometry.getPoint(i, k), geometry.setPoint(i, k, h.offset(graphicTransform, e));
			                           }
			                           return geometry;
		                           },
        _updateControlPt: function (geometry, point, graphicTransform)
        {

            var firstPoint = geometry.getPoint(0, 0);
            var mapfirstPoint = map.toMap(map.toScreen(firstPoint).offset(graphicTransform.dx, graphicTransform.dy));
            graphicTransform = mapfirstPoint.x - firstPoint.x;
            var e = mapfirstPoint.y - firstPoint.y;
            point = point.offset(graphicTransform, e);
            console.log(point);

            return point;



        }, */


        _updateControlPt: function (geometry, point, graphicTransform)
        {

            var firstPoint = geometry.getPoint(0, 0);
            var mapfirstPoint = map.toMap(map.toScreen(firstPoint).offset(graphicTransform.dx, graphicTransform.dy));
            graphicTransform = mapfirstPoint.x - firstPoint.x;
            var e = mapfirstPoint.y - firstPoint.y;
            point = point.offset(graphicTransform, e);
            console.log(point);

            return point;



        }, 
        
        computeAngle : function(pointA, pointB) {
            var dLon = (pointB.x - pointA.x) * Math.PI / 180;
            var lat1 = pointA.y * Math.PI / 180;
            var lat2 = pointB.y * Math.PI / 180;
            var y = Math.sin(dLon) * Math.cos(lat2);
            var x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
            var bearing = (Math.atan2(y, x) * 180 / Math.PI) + 180;
            bearing = ((bearing + 360) % 360).toFixed(1); //Converting -ve to +ve (0-360)
            if (isNaN(bearing)) bearing = 0;
            return bearing;
        },
        toDegrres  : function (rad) {


             //return rad*(180/Math.PI);
             var angleDeg = rad*(180/Math.PI);

              var result = ((angleDeg + 360) % 360).toFixed(1); //Converting -ve to +ve (0-360)
            if (isNaN(result)) result = 0;
            return result;

             },

            toRad : function (deg) {
             return deg * (Math.PI/180);
             },
             angleRadians : function(p1, p2) {
              //var res = Math.atan2(polylineGeom.getPoint(0,1).y - polylineGeom.getPoint(0,0).y, polylineGeom.getPoint(0,1).x - polylineGeom.getPoint(0,0).x);
              var res = Math.atan2(p2.y - p1.y, p2.x - p1.x);
              
              return res;

             },





              angleDeg : function(p1, p2) {
              //var res = Math.atan2(polylineGeom.getPoint(0,1).y -polylineGeom.getPoint(0,0).y, polylineGeom.getPoint(0,1).x - polylineGeom.getPoint(0,0).x) * 180 / Math.PI;
              var res = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
              var three60Angle = ((res % 360 ) + 360 ) % 360;
              console.info("three60Angle ", three60Angle);
              console.log("Angle in Degrees", res);
              return res;

             },

              slope : function(polylineGeom) {
              var res  = (polylineGeom.getPoint(0,1).y -polylineGeom.getPoint(0,0).y) /
               ( polylineGeom.getPoint(0,1).x - polylineGeom.getPoint(0,0).x);
               console.log("Slope "+ res);


              return res;

             },

     lineAtAngle : function(p1, length, angle) {
      return new Point(p1.x + length * Math.cos(angle), p1.y + length * Math.sin(angle));
    },

            primitiveVal: 50,
            objectVal: [1, 2, 3],
            myMethod: function () {
                console.log("Hello World!");
            }

        });
        return Mock;
    });
