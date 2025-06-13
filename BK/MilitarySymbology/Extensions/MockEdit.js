
define(["dojo/_base/declare", "dojo/_base/lang", "dojo/_base/array",
    "dojo/_base/connect", "dojo/_base/Color", "dojo/_base/window",
    "dojo/has", "dojo/keys", "dojo/dom-construct",
    "dojo/dom-style", "esri/kernel", "esri/sniff",
    "esri/toolbars/_toolbar", "esri/symbols/SimpleMarkerSymbol", "esri/symbols/SimpleLineSymbol",
    "esri/symbols/SimpleFillSymbol", "esri/graphic", "esri/geometry/jsonUtils",
    "esri/geometry/webMercatorUtils", "esri/geometry/Polyline", "esri/geometry/Polygon",
    "esri/geometry/Multipoint", "esri/geometry/Rect", "dojo/i18n!esri/nls/jsapi",
    "dojo/on", "esri/layers/GraphicsLayer", "dojo/Evented", 
    "esri/SnappingManager", "esri/geometry/Point", "dojo/dom-style",
    "dojox/gfx/Moveable", "dojox/gfx/matrix", "esri/lang", 
    "MilSymbologyMockExt/Mock", "esri/geometry/jsonUtils", "dojo/_base/json"],
    function (declare, lang, Array,
        connect, color, window,
        has, keys, domconstruct,
        domstyle, esriKernel, esriSniff,
        Toolbar, SimpleMarkerSymbol, SimpleLineSymbol,
        SimpleFillSymbol, _Graphic, jsonUtility,
        webMercatorUtils, _Polyline, _Polygon,
        Multipoint, Rect, dojoEsrijsapi,
        on, GraphicsLayer, Evented, 
        SnappingManager, Point, domStyle,
        Moveable, matrix, esriLang,
        Mock, geometryJsonUtils, json) {
            
           
    	
        var MockEdit = declare([Evented], { declaredClass: "MilitarySymbology.Extensions.MockEdit",
		
        
        constructor: function (map, graphicLayer, toolbar) {
            
			       this._cpAnchors;
			       this._toolbar = toolbar;
			       this._scale = true;
			       this._rotate = true;
			       this._defaultEventArgs = {};
			       this._scaleEvent = "Scale";
			       this._rotateEvent = "Rotate";
			       this._uniformScaling = true;
			       var toolbarOptions = {};
			       
             this._markerSymbol2 = new SimpleMarkerSymbol(SimpleMarkerSymbol.STYLE_CROSS, 15, new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new color([0, 0, 0]), 2), new color([255, 0, 255, 0.25]));
			       this._markerSymbol = new SimpleMarkerSymbol(SimpleMarkerSymbol.STYLE_CIRCLE, 13, new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new color([0, 0, 0]), 2), new color([255, 255, 255, 0.25]));
			       this._controlSymbol = new SimpleMarkerSymbol(SimpleMarkerSymbol.STYLE_CIRCLE, 13, new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new color([0, 0, 0]), 2), new color([255, 0, 0, 1]));
			       this._lineSymbol = new SimpleLineSymbol(SimpleLineSymbol.STYLE_DASH, new color([64, 64, 64]), 1);
			       
			      this._moveStartHandler = lang.hitch(this, this._moveStartHandler);
		          this._firstMoveHandler = lang.hitch(this, this._firstMoveHandler);
		          this._moveStopHandler = lang.hitch(this, this._moveStopHandler);
		          this._moveHandler = lang.hitch(this, this._moveHandler);
                    
              this._scaleStopHandler = lang.hitch(this, this._scaleStop);
                    

		          this._defaultEventArgs = {};
		          this._mock = new Mock(map);
		            
		          this._scratchGL = graphicLayer;
                    
              if(toolbar) {
                        //onGraphicMove
                       //Unleash the beast
                       /*
                       this._onGraphicMoveHandler = lang.hitch(this, this._onGraphicMove);
                       toolbar.on("graphic-move", this._onGraphicMove);
						*/
						//
           /*    
          this._toolbar.on('graphic-move',function(evt){
            console.log(' *** --> Move');
          });


          this._toolbar.on('graphic-first-move',function(evt){
            console.log(' *** --> graphic-first-move');
          });


           this._toolbar.on('graphic-move-start',function(evt){
            console.log(' *** --> graphic-move-start');
          });


          this._toolbar.on('graphic-move-stop',function(evt){
            console.log(' *** --> graphic-move-stop');
          });

             this._toolbar.on('rotate',function(evt){
            console.log(' *** --> rotate');
          });


          this._toolbar.on('rotate-first-move',function(evt){
            console.log(' *** --> rotate-first-move');
          });


           this._toolbar.on('rotate-start',function(evt){
            console.log(' *** --> rotate-start');
          });

             this._toolbar.on('rotate-stop',function(evt){
            console.log(' *** --> rotate-stop');
          });


          this._toolbar.on('scale',function(evt){
            console.log(' *** --> scale');
          });


            this._toolbar.on('scale-first-move',function(evt){
            console.log(' *** --> scale-first-move');
          });

             this._toolbar.on('scale-start',function(evt){
            console.log(' *** --> scale-start');
          });


          
         this._toolbar.on('scale-stop',function(evt){
            console.log(' *** --> scale-stop');
            debugger;
            
          });
          */
          
           //this._scaleStopHandler = this._toolbar.on('scale-stop', this._scaleStop(, this));

          
          
         }

         /*
          this._test(this);
		*/
                    

			      	

            
		},


		/*
        _test:function(pointer){
        	pointer._toolbar.on('graphic-move', abc);
        	var bb = pointer;
        	function abc(evt)
        	{
        		  console.log(' *** --> Move');
            		debugger;
        	}
        },
        */
        _scaleStop: function(event, qthis) {
             console.log(' *** --> scale-stop');
           
            
        },

        _move: function(evt) {
          
        		 var a = evt.graphic;
			                          this._startTx = a.getDojoShape().getTransform();

        							   var graphic = this._graphic;
			                           var editToolbar = this._toolbar;
			                           var geometry = editToolbar._geo ? webMercatorUtils.geographicToWebMercator(evt.graphic.geometry) : evt.graphic.geometry;
			                           var geometryType = geometry.type;
			                           var graphicDojoShape = graphic.getDojoShape();
			                           var graphicTransform = graphicDojoShape.getTransform();
                                       if(evt.transform) {
			                            Array.forEach(this._graphic.geometry.controlPoints, function (item, index) {
			                            	
                                                    console.log("____", evt.graphic.geometry.controlPoints[index]);    
                                                        var a = this._updateControlPt(this._graphic.geometry, item, graphicTransform);
                                                        this._graphic.geometry.controlPoints[index].update(a.x, a.y);
                                                        //this._graphic.geometry.controlPoints[index].update(a.x, a.y);
                                                    console.log("__C__", evt.graphic.geometry.controlPoints[index]);    
                                                   }, this);
                                       }


                                      
			                         
				                           
				                           
			                          
			                           
			                           
        	/*
        							 var a = evt.graphic;
			                          this._startTx = a.getDojoShape().getTransform();

        							   var graphic = evt.graphic;
			                           var editToolbar = this._toolbar;
			                           var geometry = editToolbar._geo ? webMercatorUtils.geographicToWebMercator(evt.graphic.geometry) : evt.graphic.geometry;
			                           var geometryType = geometry.type;
			                           var graphicDojoShape = graphic.getDojoShape();
			                           var graphicTransform = graphicDojoShape.getTransform();
			                           if (json.toJson(graphicTransform) !== json.toJson(this._startTx))
			                           {
				                           this._moved = !0;
				                           switch (geometryType)
				                           {
					                           case "point":
						                           var transFormArray = [graphicTransform, matrix.invert(this._startTx)], snapPoint;
						                           map.snappingManager && (snapPoint = map.snappingManager._snappingPoint);
						                           geometry = snapPoint || map.toMap(matrix.multiplyPoint(transFormArray, map.toScreen(geometry, !0)));
						                           map.snappingManager && map.snappingManager._killOffSnapping();
						                           break;
					                           case "polyline":
						                           this.cpCount = 0;
						                           this.toolbar._scratchGL.graphics.forEach(function (item, index)
						                                                                    {
						                                                                    	debugger;
							                                                                    if (item.controlPoints)
							                                                                    {
								                                                                    var a = mock._updateControlPt(geometry, item.geometry, graphicTransform);
								                                                                    item.setGeometry(editToolbar._geo ? webMercatorUtils.webMercatorToGeographic(a, !0) : a);
								                                                                    this._controlPoints[this.cpCount++] = item.geometry;
							                                                                    }
						                                                                    }, this);
						                           geometry = mock._updatePolyGeometry(geometry, geometry.paths, graphicTransform);
						                           break;
					                           case "polygon":
						                           this.cpCount = 0;
						                           this.toolbar._scratchGL.graphics.forEach(function (item, index)
						                                                                    {
						                                                                    	debugger;
							                                                                    if (item.controlPoints)
							                                                                    {
								                                                                    var a = mock._updateControlPt(geometry, item.geometry, graphicTransform);
								                                                                    item.setGeometry(editToolbar._geo ? webMercatorUtils.webMercatorToGeographic(a, !0) : a);
								                                                                    this._controlPoints[this.cpCount++] = item.geometry;
							                                                                    }
						                                                                    }, this);
						                           //console.log("graphicMover update");
						                           geometry = this._updatePolyGeometry(geometry, geometry.rings, graphicTransform);
				                           }
				                           graphicDojoShape.setTransform(null);
				                           graphic.setGeometry(editToolbar._geo ? webMercatorUtils.webMercatorToGeographic(geometry, !0) : geometry);
			                           }
			                           else this._moved = !1;
			                           editToolbar._endOperation("MOVE");
			                           if (evt.graphic.geometry.type === "polyline")
				                           this._enableGraphicMover();
			                           this._toolbar._boxEditor._anchors.forEach(function (item)
			                                                                    {
				                                                                    item.graphic.getDojoShape().moveToFront();
			                                                                    });
			                           this._toolbar._scratchGL.graphics.forEach(function (item, index)
			                                                                    {
				                                                                    if (item.controlPoints)
				                                                                    {
					                                                                    item.getDojoShape().moveToFront();
					                                                                    //console.log("cp moved!")
				                                                                    }
			                                                                    });
			                           */
			                           

        },
        _setUp: function(evt) {
            this._graphic = (this._graphic == undefined) ? this._setGraphic(evt.graphic) : this._graphic;
        },
        _scaleRotateMove: function (evt) {
            
              var graphic = (this._graphic == undefined) ? this._setGraphic(evt.graphic) : this._graphic;
              var geometry = this._graphic.geometry;
				      var spatialReference = geometry.spatialReference;
				      var graphicDojoShape = this._graphic.getDojoShape();
				      var graphicTransform = graphicDojoShape.getTransform();
				      var layerTransform = this._graphic.getLayer()._div.getTransform();
                       
				       var geometryJson = geometry.toJson();
                        
                          for (var index in this._controlPoints) {
                              var geometry = this._controlPoints[index];
                              var wrapOffset = this._wrapOffset || 0;
                              var f = map.toScreen({x: geometry.x, y: geometry.y, spatialReference: spatialReference}, !0);
                                f.x += wrapOffset;
                                f = matrix.multiplyPoint([layerTransform, graphicTransform, matrix.invert(layerTransform)], f);
                                f.x -= wrapOffset;
                                f = map.toMap(f);
                                
                                this._controlPoints[index].x = f.x;
                                this._controlPoints[index].y = f.y;

                                
                          }
                       
              this._updateSegments(geometryJson.paths || geometryJson.rings, graphicTransform, layerTransform, spatialReference);
				       graphicDojoShape.setTransform(null);
				       var transformGeometry = geometryJsonUtils.fromJson(geometryJson);
				       this._graphic.setGeometry(transformGeometry);
                     
				       this._graphic.geometry.controlPoints = this._controlPoints;
				       this._graphic.geometry.drawExtendType = this._drawExtendType;
                        

                        
                       
				       /*  3 2 2016
                       Array.forEach(this._cpAnchors, function (item, index, layerTransform, graphicTransform)
				       {
					       //this._updateControlPoints(item, index, graphic);
                           
                                console.log("---------------------------");
                                var geometry = item.graphic.geometry;
                                var spatialReference = geometry.spatialReference;
                                var graphicDojoShape = graphic.getDojoShape();
                                var graphicTransform1 = graphicDojoShape.getTransform();
                                var layerTransform1 = graphic.getLayer()._div.getTransform();
                                
                               
                                
                                
                                var wrapOffset = this._wrapOffset || 0;


                                var f = map.toScreen({x: geometry.x, y: geometry.y, spatialReference: spatialReference}, !0);
                                f.x += wrapOffset;
                                f = matrix.multiplyPoint([layerTransform1, graphicTransform1, matrix.invert(layerTransform1)], f);
                                f.x -= wrapOffset;
                                f = map.toMap(f);
                                
                                item.graphic.geometry.x = f.x;
                                item.graphic.geometry.y = f.y;
                                this._controlPoints[index].x = f.x;
                                this._controlPoints[index].y = f.y;
                             
                   
				       }, this);
				       
                       
                       this._updateSegments(geometryJson.paths || geometryJson.rings, graphicTransform, layerTransform, spatialReference);
				       graphicDojoShape.setTransform(null);
				       var transformGeometry = geometryJsonUtils.fromJson(geometryJson);
				       graphic.setGeometry(transformGeometry);
				       graphic.geometry.controlPoints = this._controlPoints;
				       graphic.geometry.drawExtendType = this._drawExtendType;
                       
                        this._cpAnchors = [];
                       Array.forEach(this._controlPoints, function (item, index)
						       {
                      		       item = new Point(item, map.spatialReference);
							       var d = new _Graphic(item, this._controlSymbol);
							       d.controlPoints = !0;
							       //this._scratchGL.add(d);
							       this._cpAnchors.push({graphic: d, moveable: this._getMoveable(d, index, !0, index)})
						       }, this);
                               console.log("NEW CODE");
                       //this._draw();
                     */
                     
                     

        							       
        },
        
        _onGraphicMove: function (a, b) {
          console.warn("Moving....");
        },
        _setGraphic: function(graphic) {
            this._graphic = graphic;
			 if (graphic.geometry.controlPoints) this._controlPoints = graphic.geometry.controlPoints;
			 if (graphic.geometry.drawExtendType) this._drawExtendType = graphic.geometry.drawExtendType;  
        },
        
        activate: function (graphic) {
             this._setGraphic(graphic);
             this._init();
          
        },
          
           _draw: function ()
		       {
			       if (this._graphic.getDojoShape())
			       {
				       console.log("draw called");
               this._graphic.getDojoShape().moveToFront();
				       var boxCoords = this._getBoxCoords(), polyLine = new _Polyline(map.spatialReference),
					       filteredBoxCoords = lang.clone(Array.filter(boxCoords,
					                                                   function (item, index)
					                                                   {
						                                                   return 8 !== index && 0 === index % 2;
					                                                   }));
				       filteredBoxCoords[0] && filteredBoxCoords.push([filteredBoxCoords[0][0], filteredBoxCoords[0][1]]);
				       polyLine.addPath(filteredBoxCoords);
				       this._rotate && polyLine.addPath([boxCoords[1], boxCoords[8]]);
            	       this._box ? this._box.setGeometry(polyLine) : (this._box = new _Graphic(polyLine, this._lineSymbol), this._scratchGL.add(this._box));
				       
                       /*
				       this._anchors ?
					       Array.forEach(this._anchors, function (item, index)
					       {
						       this._scale || (index = 8);
						       var pt = new Point(boxCoords[index], map.spatialReference);
						       // item.graphic.controlPoints = !0;
						       item.graphic.setGeometry(pt);
						       var itemMoveable = item.moveable, itemDojoShape = item.graphic.getDojoShape();
						       //itemDojoShape && (itemMoveable ? itemDojoShape !== itemMoveable.shape && (itemMoveable.destroy(), item.moveable = this._getMoveable(item.graphic, index)) : item.moveable = this._getMoveable(item.graphic, index));
						       if (itemDojoShape)
						       {
							       if (itemMoveable)
							       {
								       if (itemDojoShape !== itemMoveable.shape)
								       {
									       itemMoveable.destroy();
									       item.moveable = this._getMoveable(item.graphic, index);
								       }
							       }
							       else
							       {
								       item.moveable = this._getMoveable(item.graphic, index)
							       }
						       }
					       }, this) :
					       (this._anchors = [], this._connects = [], Array.forEach(boxCoords, function (item, index)
					       {
						       if (this._scale || !(8 > index))
						       {
							       item = new Point(item, map.spatialReference);
							       var d = new _Graphic(item, this._markerSymbol);
							       // d.controlPoints = !0;
							       this._scratchGL.add(d);
							       this._anchors.push({graphic: d, moveable: this._getMoveable(d, index)})
						       }
					       }, this));
					       */
				       if (this._controlPoints)
				       {
					       if (this._cpAnchors)
					       {
                               
						       //console.log("_box cpAnchors redraw");
						       Array.forEach(this._cpAnchors, function (item, index)
						       {

							       var pt = new Point(this._cpAnchors[index].graphic.geometry, map.spatialReference);
							       item.graphic.controlPoints = !0;
							       item.graphic.setGeometry(pt);
							       var itemMoveable = item.moveable, itemDojoShape = item.graphic.getDojoShape();
							       if (itemDojoShape)
							       {
								       if (itemMoveable)
								       {
									       if (itemDojoShape !== itemMoveable.shape)
									       {
										       itemMoveable.destroy();
										       item.moveable = this._getMoveable(item.graphic, index, !0, index);
									       }
								       }
								       else
								       {
									       item.moveable = this._getMoveable(item.graphic, index, !0, index)
								       }
							       }
						       }, this);
					       }
					       else
					       {
						       this._cpAnchors = [], this._connects = [], Array.forEach(this._controlPoints, function (item, index)
						       {
                                   
							       item = new Point(item, map.spatialReference);
							       var d = new _Graphic(item, this._controlSymbol);
							       d.controlPoints = !0;
							       this._scratchGL.add(d);
							       this._cpAnchors.push({graphic: d, moveable: this._getMoveable(d, index, !0, index)})
						       }, this);
					       }
				       }


			       }
			       //else this._cleanUp();
		       },
		       //bbox in map coordinates with four middle points
		       _getBoxCoords: function (useScreen)
		       {
			       var screenBoundingBox = this._getTransformedBoundingBox(this._graphic),
				       a = [], currentItem, nextItem, middle;
			       Array.forEach(screenBoundingBox, function (item, index, arr)
			       {
				       currentItem = item;
				       (nextItem = arr[index + 1]) || (nextItem = arr[0]);
				       middle = {x: (currentItem.x + nextItem.x) / 2, y: (currentItem.y + nextItem.y) / 2};
				       useScreen || (currentItem = map.toMap(currentItem), middle = map.toMap(middle));
				       a.push([currentItem.x, currentItem.y]);
				       a.push([middle.x, middle.y])
			       });
			       //add rotate handle graphic
			       this._rotate && (screenBoundingBox = lang.clone(a[1]), screenBoundingBox = useScreen ? {x: screenBoundingBox[0], y: screenBoundingBox[1]} : map.toScreen({x: screenBoundingBox[0], y: screenBoundingBox[1], spatialReference: map.spatialReference}), screenBoundingBox.y -= 30, useScreen || (screenBoundingBox = map.toMap(screenBoundingBox)), a.push([screenBoundingBox.x, screenBoundingBox.y]));
			       return a;
		       },

		       //get screen coordinate bbox
		       _getTransformedBoundingBox: function (graphic)
		       {
			       var extent = graphic.geometry.getExtent(), spatialReference = graphic.geometry.spatialReference;
			       var upLeftPt = new Point(extent.xmin, extent.ymax,
			                                spatialReference);
			       var downRightPt = new Point(extent.xmax, extent.ymin, spatialReference);
			       upLeftPt = map.toScreen(upLeftPt);
			       downRightPt = map.toScreen(downRightPt);
			       return[
				       {x: upLeftPt.x, y: upLeftPt.y},
				       {x: downRightPt.x, y: upLeftPt.y},
				       {x: downRightPt.x, y: downRightPt.y},
				       {x: upLeftPt.x, y: downRightPt.y}
			       ]
		       },
		      
		       _getMoveable: function (graphic, index, controlMovable, controlPointIndex)
		       {
			       var dojoShape = graphic.getDojoShape();
			       if (dojoShape)
			       {
				       var moveAble = new Moveable(dojoShape);
				       moveAble._index = index;
				       moveAble.controlPointIndex = controlPointIndex;
				       moveAble._control = controlMovable;

				        moveAble.onMoveStart = lang.hitch(this, this._moveStartHandler);
                        moveAble.onFirstMove = lang.hitch(this, this._firstMoveHandler);
                        moveAble.onMoveStop = lang.hitch(this, this._moveStopHandler);
                        moveAble.onMove = lang.hitch(this, this._moveHandler);
                        
                        
                        
                        /*
				       !controlMovable && (dojoShape = dojoShape.getEventSource()) && domStyle.set(dojoShape, "cursor", this._toolbar._cursors["box" + index]);
				       controlMovable && (dojoShape = dojoShape.getEventSource()) && domStyle.set(dojoShape, "cursor", this._toolbar._cursors["move"]);
				       */
				       return moveAble;
			       }
		       },
		       _moveStartHandler: function (b)
		       {
			       
		       },
		       _firstMoveHandler: function (b)
		       {
			       var index = b.host._index, offset = this._wrapOffset = b.host.shape._wrapOffsets[0] || 0, transform = this._graphic.getLayer()._div.getTransform(), middeScreen;
			       var screenBbox = Array.map(this._getBoxCoords(!0), function (a)
			       {
				       return{x: a[0] + offset, y: a[1]}
			       });
			       middeScreen = {x: screenBbox[1].x, y: screenBbox[3].y};
			       this._centerCoord = matrix.multiplyPoint(matrix.invert(transform), middeScreen);
                   /*
			       if (8 === index)middeScreen = matrix.multiplyPoint(matrix.invert(transform), screenBbox[1]), this._startLine = [this._centerCoord, middeScreen], this._moveLine = lang.clone(this._startLine); else if (middeScreen = matrix.multiplyPoint(matrix.invert(transform), screenBbox[index]), transform = matrix.multiplyPoint(matrix.invert(transform), screenBbox[(index + 4) % 8]), this._firstMoverToCenter = Math.sqrt((middeScreen.x - this._centerCoord.x) * (middeScreen.x - this._centerCoord.x) + (middeScreen.y - this._centerCoord.y) * (middeScreen.y - this._centerCoord.y)), this._startBox = transform, this._startBox.width = screenBbox[4].x - screenBbox[0].x, this._startBox.height = screenBbox[4].y - screenBbox[0].y, this._moveBox =
				       lang.clone(this._startBox), this._xfactor = middeScreen.x > transform.x ? 1 : -1, this._yfactor = middeScreen.y > transform.y ? 1 : -1, 1 === index || 5 === index)this._xfactor = 0; else if (3 === index || 7 === index)this._yfactor = 0;
			       */
                   if (this._controlPoints)
			       {
				       this._cpScreen = [];
				       Array.forEach(this._controlPoints, function (item, index)
				       {
					       this._cpScreen.push(map.toScreen(item));
				       }, this);
			       }
		       },
		       _moveHandler: function (b, inputPt)
		       {

		       	console.info("Move Handler Single")
			       var index = b.host._index, eventArgs = this._defaultEventArgs, d, g, f, h, m = 0, k = 0;
			       eventArgs.angle = 0;
			       eventArgs.scaleX = 1;
			       eventArgs.scaleY = 1;
			       
			       if (8 === index && !b.host._control)
			       {
				       var startLine = this._startLine;
				       var moveLine = this._moveLine;
				       var moveLine2Pt = moveLine[1];
				       moveLine2Pt.x += inputPt.dx;
				       moveLine2Pt.y += inputPt.dy;
				       var movedAngle = this._getAngle(startLine, moveLine);
				       var startLinePt1AfterRotate = matrix.rotategAt(movedAngle, startLine[0]);
				       this._graphic.getDojoShape().setTransform(startLinePt1AfterRotate);
				       eventArgs.transform = startLinePt1AfterRotate;
				       eventArgs.angle = movedAngle;
				       eventArgs.around = startLine[0];
			       }
			       else if (!b.host._control)
			       {
				       d = this._startBox;
				       g = this._moveBox;
				       g.width += inputPt.dx * this._xfactor;
				       g.height += inputPt.dy * this._yfactor;
				       this._uniformScaling ? (f = g.x + this._xfactor * g.width, g = g.y + this._yfactor * g.height, g = Math.sqrt((f - this._centerCoord.x) * (f - this._centerCoord.x) + (g - this._centerCoord.y) * (g - this._centerCoord.y)), f = h = g / this._firstMoverToCenter, m = this._xfactor * d.width / 2, k = this._yfactor * d.height / 2) : (f = g.width / d.width, h = g.height / d.height);
				       if (isNaN(f) ||
					       Infinity === f || -Infinity === f)f = 1;
				       if (isNaN(h) || Infinity === h || -Infinity === h)h = 1;
				       g = matrix.scaleAt(f, h, d.x + m, d.y + k);
				       this._graphic.getDojoShape().setTransform(g);
				       eventArgs.transform = g;
				       eventArgs.scaleX = f;
				       eventArgs.scaleY = h;
				       eventArgs.around = {x: d.x + m, y: d.y + k}
			       }
			       else
			       {
				       var cpindex = b.host.controlPointIndex;
				       //console.log(cpindex);
				       this._cpScreen[cpindex].x += inputPt.dx;
				       this._cpScreen[cpindex].y += inputPt.dy;
				       this._controlPoints[cpindex] = map.toMap(this._cpScreen[cpindex]);
				       this._mock._controlPointsUpdates(this._drawExtendType, this._graphic, this._controlPoints);
				       //this._draw();
				       Array.forEach(this._cpAnchors, function (item, index)
				       {
					       if (index === cpindex)
					       {
						       var pt = new Point(this._controlPoints[cpindex], map.spatialReference);
						       item.graphic.controlPoints = !0;
						       item.graphic.setGeometry(pt);
						       item.graphic.getDojoShape().moveToFront();
					       }
						   //Bug
						   
					       else 
						         
						       item.graphic.getDojoShape().moveToFront();
							

				       }, this);
				       this._graphic.geometry.controlPoints = this._controlPoints;
			       }
			       //!this._controlPoints && this._toolbar["on" + (8 === index ? this._rotateEvent : this._scaleEvent)](this._graphic, eventArgs);
		       },
		       _moveStopHandler: function (b)
		       {
			       /*
                   if (!b.host._control)
			       {
                       debugger;
				       console.info("move stop");
				       var graphic = this._graphic;
				       var editToolbar = this._toolbar;
				       var geometry = editToolbar._geo ? webMercatorUtils.geographicToWebMercator(graphic.geometry) : graphic.geometry;
				       var spatialReference = geometry.spatialReference;
				       var graphicDojoShape = graphic.getDojoShape();
				       var graphicTransform = graphicDojoShape.getTransform();
				       var layerTransform = graphic.getLayer()._div.getTransform();

				       var geometryJson = geometry.toJson();
				       this._controlPoints && Array.forEach(this._cpAnchors, function (b, i)
				       {
					       this._updateControlPoints(b, i);
				       }, this);
				       this._updateSegments(geometryJson.paths || geometryJson.rings, graphicTransform, layerTransform, spatialReference);
				       graphicDojoShape.setTransform(null);
				       var transformGeometry = jsonUtils.fromJson(geometryJson);
				       graphic.setGeometry(editToolbar._geo ? webMercatorUtils.webMercatorToGeographic(transformGeometry, !0) : transformGeometry);
				       graphic.geometry.controlPoints = this._controlPoints;
				       graphic.geometry.drawExtendType = this._drawExtendType;

				       this._startLine = this._moveLine = this._startBox = this._moveBox = this._xfactor = this._yfactor = null;
				       editToolbar._endOperation("BOX");
				       this._draw();
				       Array.forEach(this._anchors, function (item)
				       {
					       item.graphic.getDojoShape().moveToFront();
				       });
				       Array.forEach(this._cpAnchors, function (item)
				       {
					       item.graphic.getDojoShape().moveToFront();
				       });
				       /*
				       if (this._graphic.geometry.type === "polyline")
					       this._toolbar._enableMove(this._graphic);
					   */
				       //this._box.getDojoShape().moveToBack();
                       /*
				       this._defaultEventArgs.transform = graphicTransform;
				       editToolbar["on" + (8 === b.host._index ? this._rotateEvent : this._scaleEvent) + "Stop"](this._graphic, this._defaultEventArgs);
			       }
			       else
			       {

				       this._graphic.geometry.controlPoints = this._controlPoints;
				       this._graphic.geometry.drawExtendType = this._drawExtendType;
				       this._draw();
				       Array.forEach(this._anchors, function (item)
				       {
					       item.graphic.getDojoShape().moveToFront();
				       });
				       Array.forEach(this._cpAnchors, function (item)
				       {
					       item.graphic.getDojoShape().moveToFront();
				       });

			       } */
                   
               this._graphic.geometry.controlPoints = this._controlPoints;
				       this._graphic.geometry.drawExtendType = this._drawExtendType;
				       this._draw();
				       Array.forEach(this._anchors, function (item)
				       {
					       item.graphic.getDojoShape().moveToFront();
				       });
				       Array.forEach(this._cpAnchors, function (item)
				       {
					       item.graphic.getDojoShape().moveToFront();
				       });
                       
		       },
		       _updateSegments: function (rings, graphicTransform, layerTransform, spatialReference)
		       {
			       //console.log(rings[0][15][0]);
			       var wrapOffset = this._wrapOffset || 0;
			       Array.forEach(rings,
			                     function (b)
			                     {
				                     Array.forEach(b, function (b)
				                     {
					                     var f = map.toScreen({x: b[0], y: b[1], spatialReference: spatialReference}, !0);
					                     f.x += wrapOffset;
					                     f = matrix.multiplyPoint([layerTransform, graphicTransform, matrix.invert(layerTransform)], f);
					                     f.x -= wrapOffset;
					                     f = map.toMap(f);
					                     b[0] = f.x;
					                     b[1] = f.y
				                     })
			                     });
			       //console.log(rings[0][15][0]);
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
                                       
                                       
                                       
		               },
		       _updateControlPoints: function (item, index, graphic, gt, lt)
		       {
                   
             var geometry = item.graphic.geometry;
			       var spatialReference = geometry.spatialReference;
			       var graphicDojoShape = graphic.getDojoShape();
			       var graphicTransform = graphicDojoShape.getTransform();
			       var layerTransform = graphic.getLayer()._div.getTransform();
			       
			       var wrapOffset = this._wrapOffset || 0;


			       var f = map.toScreen({x: geometry.x, y: geometry.y, spatialReference: spatialReference}, !0);
			       f.x += wrapOffset;
			       f = matrix.multiplyPoint([layerTransform, graphicTransform, matrix.invert(layerTransform)], f);
			       f.x -= wrapOffset;
			       f = map.toMap(f);
                   
			       item.graphic.geometry.x = f.x;
			       item.graphic.geometry.y = f.y;
			       this._controlPoints[index].x = f.x;
			       this._controlPoints[index].y = f.y;

		       	   
			       
                   /* 3 1 2016 
			       var geometry = item.graphic.geometry;
			       var spatialReference = geometry.spatialReference;
			       var graphicDojoShape = graphic.getDojoShape();
			       var graphicTransform = graphicDojoShape.getTransform();
			       var layerTransform = graphic.getLayer()._div.getTransform();
			       
			       var wrapOffset = this._wrapOffset || 0;


			       var f = map.toScreen({x: geometry.x, y: geometry.y, spatialReference: spatialReference}, !0);
			       f.x += wrapOffset;
			       f = matrix.multiplyPoint([layerTransform, graphicTransform, matrix.invert(layerTransform)], f);
			       f.x -= wrapOffset;
			       f = map.toMap(f);
                   
			       item.graphic.geometry.x = f.x;
			       item.graphic.geometry.y = f.y;
			       this._controlPoints[index].x = f.x;
			       this._controlPoints[index].y = f.y;
                   */
                   
                   
                   
                   
                   /*
                   29 2 2016
                   
                   var editToolbar = this._toolbar;
			       var geometry = item.graphic.geometry;
			       var spatialReference = geometry.spatialReference;
			       var graphicDojoShape = graphic.getDojoShape();
			       var graphicTransform = graphicDojoShape.getTransform();
			       var layerTransform = graphic.getLayer()._div.getTransform();
			       //console.log(ptc[1].x);
			       var wrapOffset = this._wrapOffset || 0;


			       var f = map.toScreen({x: geometry.x, y: geometry.y, spatialReference: spatialReference}, !0);
			       f.x += wrapOffset;
			       f = matrix.multiplyPoint([layerTransform, graphicTransform, matrix.invert(layerTransform)], f);
			       f.x -= wrapOffset;
			       f = map.toMap(f);
                   
			       item.graphic.geometry.x = f.x;
			       item.graphic.geometry.y = f.y;
			       this._controlPoints[index].x = f.x;
			       this._controlPoints[index].y = f.y;
                   */



		       		/*
	               var graphic = this._graphic;
			       var editToolbar = this._toolbar;
			       var geometry = item.graphic.geometry;
			       var spatialReference = geometry.spatialReference;
			       var graphicDojoShape = graphic.getDojoShape();
			       var graphicTransform = graphicDojoShape.getTransform();
			       var layerTransform = graphic.getLayer()._div.getTransform();
			       //console.log(ptc[1].x);
			       var wrapOffset = this._wrapOffset || 0;


			       var f = map.toScreen({x: geometry.x, y: geometry.y, spatialReference: spatialReference}, !0);
			       f.x += wrapOffset;
			       f = matrix.multiplyPoint([layerTransform, graphicTransform, matrix.invert(layerTransform)], f);
			       f.x -= wrapOffset;
			       f = map.toMap(f);
                   
			       item.graphic.geometry.x = f.x;
			       item.graphic.geometry.y = f.y;
			       this._controlPoints[index].x = f.x;
			       this._controlPoints[index].y = f.y;
			       */

			       
		       },
		       _getAngle: function (b, e)
		       {
			       var c = 180 * Math.atan2(b[0].y - b[1].y, b[0].x - b[1].x) / Math.PI;
			       return 180 * Math.atan2(e[0].y - e[1].y, e[0].x - e[1].x) / Math.PI - c
		       },
               
             
		       _init: function ()
		       {
			       this._draw();
		       },
                    
                    
                deactivate: function (graphicLayer)
                {
                    console.error("De activate");
                    this._cleanUp(graphicLayer);
                    this._removeEvents();
                    
                    
                    
                },
        
		       _cleanUp: function (_scratchGL)
		       {
                   
                   this._connects && Array.forEach(this._connects, connect.disconnect);
			       this._anchors && Array.forEach(this._anchors, function (e)
			       {
				      _scratchGL.remove(e.graphic);
				       (e = e.moveable) && e.destroy()
			       });
			       this._cpAnchors && Array.forEach(this._cpAnchors, function (e)
			       {
				       _scratchGL.remove(e.graphic);
				       (e = e.moveable) && e.destroy()
			       });
			       this._box && _scratchGL.remove(this._box);
			       this._box = this._anchors = this._connects = this._cpAnchors = null;
		       },
               
           _removeEvents: function() {
            /*
            this._moveStartHandler = null;
		    this._firstMoveHandler = null;
		    this._moveStopHandler = null;
		    this._moveHandler = null;
            */
           
        },
        
        

            primitiveVal: 50,
            objectVal: [1, 2, 3],
            myMethod: function () {
                console.log("Hello World!");
            }

        });
        return MockEdit;
    });