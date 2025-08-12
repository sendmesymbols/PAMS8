/**
 * Class Representing Bypass.
 *
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



		var Bypass = declare([Evented], {
			declaredClass: "MilitarySymbology.Symbols.Bypass",
			SID: "340300",
			symName: "Bypass",
			symGeometricType: "Area",
			constructor: function (map, isLine) {
				this.map = map;
				this.isLine = isLine;

				this._lineSym;
				this._points = [];
				this._baseLinePts = [];
				this._geometryType = null;



				this._onClk = this._onClckHdler;
				this._onDblClk = this._onDblClkHandler;
				this._onMM = this._onMMoveHdler;
				this._onClk = this._onClckHdler;
				this._onBaseLineEnd;
				this._onBaseLineProgress;
				this._onBaseLineClick;
				this._tGraphic = new _Graphic();





			},


			init: function (options, marker) {


				this._lineSym = marker;
				this.map.navigationManager.setImmediateClick(false);
				this.map.disableDoubleClickZoom();

				var drawEssentials = new DrawEssentials();
				var baseLine = new BaseLine(this.map, this._lineSym);


				if (options.hasOwnProperty("CTRL_PTS") && options.hasOwnProperty("BASE_LN_PTS") && options.hasOwnProperty("GEOM")) {
					this._tGraphic.setGeometry(options.GEOM);

					drawEssentials = this.createDrawEssentials(lang.clone(options.CTRL_PTS), lang.clone(options.BASE_LN_PTS));

					this.__drawEnd(this._tGraphic.geometry, drawEssentials);
					this._clear();

				} else if (options.hasOwnProperty("CTRL_PTS")) {

					if (options.hasOwnProperty("BASE_LN_PTS")) {
						drawEssentials = this.createDrawEssentials(lang.clone(options.CTRL_PTS), lang.clone(options.BASE_LN_PTS));


					} else {
						throw "Control Points and Baseline or Distance is required to create symbol non-interactively";

					}

					this._tGraphic.setGeometry(this.createSymbol(drawEssentials));

					this.__drawEnd(this._tGraphic.geometry, drawEssentials);
					this._clear();

				} else {

					this._onBaseLineEnd = baseLine.on("drawEnd", lang.hitch(this, this.baseLineDrawEnd));
					this._onBaseLineClick = baseLine.on("onBaseLineClick", lang.hitch(this, this.baseLineClick));					
					this._onBaseLineProgress = baseLine.on("onBaseLineProgress", lang.hitch(this, this.baseLineDrawProgress));
					baseLine.init("B");
				}

			},

			createDrawEssentials: function (ctrlPts, baseLinePts) {
				var drawEssentials = new DrawEssentials();
				drawEssentials.SCOPE = this;
				drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
				drawEssentials.SID = this.SID;
				drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
				drawEssentials.SYM_NAME = this.symName;
				drawEssentials.CTRL_PTS = ctrlPts;
				drawEssentials.BASE_LN_PTS = baseLinePts;
				drawEssentials.AMPLIFIER = this.amplifier;



				return drawEssentials;

			},


			baseLineDrawEnd: function (evt) {
				this._onBaseLineEnd.remove();
				this._tGraphic = new _Graphic(evt.geometry, this._lineSym);
				this.map.graphics.add(this._tGraphic);
				this._baseLinePts = evt.geometry._baseLine;
				this._onMM = on(this.map, "mouse-move", lang.hitch(this, this._onMMoveHdler));
				this._onClk = on(this.map, "click", lang.hitch(this, this._onClckHdler));
				this._onDblClk = on(this.map, "dbl-click", lang.hitch(this, this._onDblClkHandler));
				this.emit("onBaseLineDrawEnd", {"currentPts" : evt.geometry.controlPoints});
				
			},


			baseLineDrawProgress: function (evt) {
				var localDrawEssentials = [];
				localDrawEssentials.CTRL_PTS = evt.currentGeometry;
				var pl = new _Polyline(map.spatialReference);
				pl.addPath(evt.currentGeometry);				
				this.emit("onDrawProgress", { 'currentGeometry': pl, 'currentDrawEssentials': localDrawEssentials, 'currentMarker': evt.currentMarker, 'isBaseLine': true });
			},

			baseLineClick: function (evt) {
				this.emit("onDrawClick", { 'currentPts': evt.currentGeometry, 'isBaseLine': true}); 				
			},


			createSymbol: function (drawEssentials) {
				try {



					var pts;

					if (drawEssentials.hasOwnProperty("CTRL_PTS")) {
						pts = drawEssentials.CTRL_PTS;

					} else {

						throw "controlPoints not found"

					}


					var stPt = drawEssentials.BASE_LN_PTS.startPt;
					var endPt = drawEssentials.BASE_LN_PTS.endPt;

					var firstPoint = pts[0];
					var lastPoint = pts[pts.length - 1];
					var leftArray = [], rightArray = [];




					if (stPt === undefined || endPt === undefined) {
						throw "First Parameter of the Function is an Array with Start and End Point"

					}
					var midPt = GeoTools.getMidPoint(stPt, endPt);


					var result = new _Polyline(this.map.spatialReference);

					//Base Line

					if (pts.length >= 1) {
						lastPoint = firstPoint;
					}

					var len = GeoTools._2PtLen(midPt, endPt);
					var k = Math.atan((midPt.y - lastPoint.y) / (midPt.x - lastPoint.x));

					switch (GeoTools.twoPtsRelationShip(midPt, lastPoint)) {
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


					var partialLen = len;

					var p1 = { x: partialLen * Math.cos(k) + midPt.x, y: partialLen * Math.sin(k) + midPt.y };
					var p2 = { x: -1 * partialLen * Math.cos(k) + midPt.x, y: -1 * partialLen * Math.sin(k) + midPt.y };

					paths = [];
					paths = paths.concat(p1, p2);
					//Fracture Baseline


					var values;
					values = GeoTools._fracturePts(p1, p2, 10, this.map.spatialReference)
					result.paths = result.paths.concat(values.geometry.paths);

					var cLenLimit;
					var baseLineLen = GeoTools._2PtLen(p1, p2);

					cLenLimit = values.len / 2;
					if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;

					result.addPath(Shapes.createB(values.midPoint, cLenLimit, 40));


					//End of Base Line



					//Front 


					if (pts.length >= 1) {
						leftArray.push(p1);
						rightArray.push(p2);

					}



					for (i = 0; i < pts.length; i++) {

						//Find distance between candidatePoint and Mid Point
						var length = GeoTools._2PtLen(midPt, pts[i]);
						var angle = GeoTools.angleInRadians(midPt, pts[i]);


						var stPtCandidatePt = new Point(p1.x + length * Math.cos(angle), p1.y + length * Math.sin(angle), this.map.spatialReference);
						var endPtCandidatePt = new Point(p2.x + length * Math.cos(angle), p2.y + length * Math.sin(angle), this.map.spatialReference);



						leftArray.push(stPtCandidatePt);
						rightArray.push(endPtCandidatePt);



					}

					result.addPath(leftArray);
					result.addPath(rightArray);




					//End of Front


					//Arrows

					result.addPath(Shapes.arrowHead(leftArray[leftArray.length - 1], GeoTools.ArrowFlanksLen(GeoTools._2PtLen(midPt, pts[pts.length - 1]), GeoTools._2PtLen(stPtCandidatePt, endPtCandidatePt)),
						GeoTools.angleInRadians(leftArray[leftArray.length - 2],
							leftArray[leftArray.length - 1])));

					result.addPath(Shapes.arrowHead(rightArray[rightArray.length - 1], GeoTools.ArrowFlanksLen(GeoTools._2PtLen(midPt, pts[pts.length - 1]), GeoTools._2PtLen(stPtCandidatePt, endPtCandidatePt)),
						GeoTools.angleInRadians(rightArray[rightArray.length - 2],
							rightArray[rightArray.length - 1])));


					//End of Arrows





					return result;
				}
				catch (e) {
					console.log(this.declaredClass + ' Can not create Symbol due to invalid geometry');

				}



			},

			getBaseLinePts: function () {
				return this._baseLinePts;
			},

			_onMMoveHdler: function (inputPoint) {
				var candidatePoint = inputPoint.mapPoint;

				var drawEssentials = new DrawEssentials();
				drawEssentials.CTRL_PTS = this._points.concat(candidatePoint);
				drawEssentials.BASE_LN_PTS = this._baseLinePts;



				this._tGraphic.setGeometry(this.createSymbol(drawEssentials));
				this.emit("onDrawProgress", { 'currentGeometry': this._tGraphic.geometry, 'currentDrawEssentials': drawEssentials, 'currentMarker': this._lineSym });

			},

			_onClckHdler: function (clickPoint) {
				this._points.push(clickPoint.mapPoint.offset(0, 0));
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

				drawEss = this.createDrawEssentials(lang.clone(this._points), lang.clone(this._baseLinePts));


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
				this._baseLinePts = [];
				this._curvePt1 = this._curvePt2 = null;


			},

			_removeEvents: function () {
				this._onClk.remove();
				this._onDblClk.remove();
				this._onMM.remove();
				this._onBaseLineEnd.remove();
				this.map.enableDoubleClickZoom();
			},


			//Deactivates the toolbar and reactivates map navigation.
			deactivate: function () {
				this._clear();
				this._removeEvents();
				this._geometryType = null;

			},




			_flaps: function (candidatePoint, length, angle, side) {
				var path = [];
				if (side == 1) {

					angle -= 15;

					var angle1 = GeoTools.toDegrees(angle); // In Degrees

					var rightWing = new Point(candidatePoint.x + length * Math.cos(GeoTools.toRad(angle1)),
						candidatePoint.y + length * Math.sin(GeoTools.toRad(angle1)), this.map.spatialReference);


					var rightWing2 = new Point(-1 * length * Math.cos(GeoTools.toRad(angle1)) + candidatePoint.x,
						-1 * length * Math.sin(GeoTools.toRad(angle1)) + candidatePoint.y, this.map.spatialReference);

					path = path.concat(rightWing, candidatePoint, rightWing2);

				} else {
					angle += 15;
					var angle2 = GeoTools.toDegrees(angle); // In Degrees

					var rightWing = new Point(candidatePoint.x + length * Math.cos(GeoTools.toRad(angle2)),
						candidatePoint.y + length * Math.sin(GeoTools.toRad(angle2)), this.map.spatialReference);

					var rightWing2 = new Point(-1 * length * Math.cos(GeoTools.toRad(angle2)) + candidatePoint.x,
						-1 * length * Math.sin(GeoTools.toRad(angle2)) + candidatePoint.y, this.map.spatialReference);
					path = path.concat(rightWing, candidatePoint, rightWing2);
				}


				return path;
			},



			_onDrawComplete: function (event) {

			}







		});
		return Bypass;
	});
