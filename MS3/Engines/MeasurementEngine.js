/**
 * Class MeasurementEngine.
 * @class
 * @author Abdul Razak
 * version 0.7
 * Dated: 26 Nov 2018
 * 
 */



define(["dojo/_base/declare", "dojo/Evented",
    "esri/symbols/SimpleLineSymbol", "dojo/_base/Color",
    "esri/graphic", "esri/layers/GraphicsLayer",
    "esri/geometry/Point", "esri/geometry/Polyline", "esri/geometry/Polygon", "esri/geometry/Extent",
    "esri/symbols/TextSymbol", 'esri/geometry/geometryEngine', "MilSymbologyExt/GeoTools",
    "esri/symbols/Font", "esri/Color"
  ],
  function (declare, Evented, SimpleLineSymbol,
    Color, Graphic, GraphicsLayer,
    Point, Polyline, Polygon, Extent,
    TextSymbol, geometryEngine, GeoTools,
    Font, Color) {

    var MeasurementEngine = declare([Evented], {
      declaredClass: "MilitarySymbology.Engines.MeasurementEngine",
      LCC1SP: 'PROJCS["Lambert_Conformal_Conic",GEOGCS["GCS_EVEREST_INDIA_NEPAL",DATUM["D_EVEREST_INDIA_NEPAL",SPHEROID["Everest_1830_1975_Adjustment",6377299.151,300.8017254981305]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Conformal_Conic"],PARAMETER["false_easting",2743195.5],PARAMETER["false_northing",914398.5],PARAMETER["central_meridian",68.0],PARAMETER["standard_parallel_1",32.5],PARAMETER["standard_parallel_2",32.5],PARAMETER["scale_factor",0.99878641],PARAMETER["latitude_of_origin",32.5],UNIT["Meter",1.0]]',
      LCC2SP: 'PROJCS["Lambert_Conformal_Conic",GEOGCS["GCS_EVEREST_INDIA_NEPAL",DATUM["D_EVEREST_INDIA_NEPAL",SPHEROID["Everest_1830_1975_Adjustment",6377299.151,300.8017254981305]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Conformal_Conic"],PARAMETER["false_easting",2743195.5],PARAMETER["false_northing",914398.5],PARAMETER["central_meridian",74.0],PARAMETER["standard_parallel_1",26.0],PARAMETER["standard_parallel_2",26.0],PARAMETER["scale_factor",0.99878641],PARAMETER["latitude_of_origin",26.0],UNIT["Meter",1.0]]',
      WGS1SP: 4326,
      WGS2SP: 'GEOGCS["Geographic Coordinate System",DATUM["D_WGS84",SPHEROID["WGS84",6378137.0,298.257223560493]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',
      isGeodesic: false,

      constructor: function (options) {
        this.measurementGraphicsLayer = null;
        this.measureExtentGraphic = null;
        this.measureLineGraphic = null;
        this.measureExtentHGraphic = null;
        this.measureExtentWGraphic = null;
        this.measureExtentAGraphic = null;
        this.measureExtentTGraphic = null;
        //meters | feet | kilometers | miles | nautical-miles | yards
        this.distanceUnits = [{
          "unit": "feet",
          "abbr": "'"
        }, {
          "unit": "miles",
          "abbr": "mi"
        }, {
          "unit": "kilometers",
          "abbr": "km"
        }, {
          "unit": "nautical-miles",
          "abbr": "nm"
        }, {
          "unit": "meters",
          "abbr": "m"
        }, {
          "unit": "yards",
          "abbr": "yd"
        }];

        //acres | ares | hectares | square-feet | square-meters | square-yards | square-kilometers | square-miles
        this.areaUnits = [{
          "unit": "square-miles",
          "abbr": "sq mi"
        }, {
          "unit": "acres",
          "abbr": "ac"
        }, {
          "unit": "square-kilometers",
          "abbr": "sq km"
        }, {
          "unit": "hectares",
          "abbr": "ha"
        }, {
          "unit": "square-meters",
          "abbr": "sq m"
        }, {
          "unit": "square-feet",
          "abbr": "sq ft"
        }, {
          "unit": "square-yards",
          "abbr": "sq yd"
        }];

        options = options || {};
        this.setOptions(options);

      },


      getGraphicLayer: function (map, id) {
        var tempLayer = map.getLayer(id);
        if (tempLayer === undefined) {
          tempLayer = new GraphicsLayer({
            id: id
          });

          map.addLayer(tempLayer, 0);
        }

        return tempLayer;


      },


      start: function (map) {

        measurementGraphicsLayer = this.getGraphicLayer(map, 'measurementGraphicsLayer');

        if (map.spatialReference.hasOwnProperty('wkid')) {
          if (map.spatialReference.wkid === this.WGS1SP) {
            isGeodesic = true;
          }
        } else if (map.spatialReference.hasOwnProperty('wkt')) {
          if (map.spatialReference.wkt === this.WGS2SP) {
            isGeodesic = true;
          } else if (map.spatialReference.wkt === this.LCC1SP) {
            isGeodesic = false;
          } else if (map.spatialReference.wkt === this.LCC2SP) {
            isGeodesic = false;
          }

        }


        /*
        if (map.spatialReference.wkid === 4326 || map.spatialReference.wkid === 3857) {
          measurementGraphicsLayer = this.getGraphicLayer(map, 'measurementGraphicsLayer');

        } else {
          console.error('Initialization Error : Measurement Engine currently works with WKID 4326 or 3857 only.');
        }
        */



      },


      setOptions: function (options) {

        //Extract Units
        this.dist_unit = options.dist_unit || 'miles';
        this.area_unit = options.area_unit || 'square-miles';
        this.font_size = options.font_size || 12;

        this.font_color = options.font_color || [255, 0, 0];
        this.font_opacity = options.font_opacity || 1;


        this.line_color = options.line_color || [0, 255, 0];
        this.line_width = options.line_width || 2;
        this.line_opacity = options.line_opacity || 0.5;
        (options.hasOwnProperty('show_bng')) ? this.show_bng = options.show_bng: this.show_bng = true;

        (options.hasOwnProperty('show_height')) ? this.show_height = options.show_height: this.show_height = true;
        (options.hasOwnProperty('show_width')) ? this.show_width = options.show_width: this.show_width = true;
        (options.hasOwnProperty('show_area')) ? this.show_area = options.show_area: this.show_area = true;

        (options.hasOwnProperty('show_total')) ? this.show_total = options.show_total: this.show_total = true;
        (options.hasOwnProperty('show_segment')) ? this.show_segment = options.show_segment: this.show_segment = true;

        (options.hasOwnProperty('show_extent')) ? this.show_extent = options.show_extent: this.show_extent = true;
        (options.hasOwnProperty('show_line')) ? this.show_line = options.show_line: this.show_line = true;

        (options.hasOwnProperty('show_last_seg_only')) ? this.show_last_seg_only = options.show_last_seg_only: this.show_last_seg_only = false;

        if (this.show_last_seg_only === true && this.show_segment === false) {
          console.info("Show Last Segment option is dependant on show Segment option, Turning Show Segment ON");
          this.show_segment = true;
        }


      },

      getOptions: function () {

        return {
          'dist_unit': this.dist_unit,
          'area_unit': this.area_unit,
          'font_size': this.font_size,
          'font_color': this.font_color,
          'font_opacity': this.font_opacity,
          'line_color': this.line_color,
          'line_width': this.line_width,
          'line_opacity': this.line_opacity,
          'show_bng': this.show_bng,
          'show_height': this.show_height,
          'show_width': this.show_width,
          'show_area': this.show_area,
          'show_total': this.show_total,
          'show_segment': this.show_segment,
          'show_extent': this.show_extent,
          'show_line': this.show_line,
          'show_last_seg_only': this.show_last_seg_only
        };



      },


      activateMeasurements: function(graphics, ctrlPts) {

        var temp = [];
        for (var z = 0; z < ctrlPts.length; z++) {
          temp.push(ctrlPts[z]);
          this.addSegment(temp);
          this.updateSegments(graphics.geometry, temp);
        }
       temp = null;
      },


      updateMeasurements: function(graphics, ctrlPts) {
        var temp = [];
          
        /*
         var prev = this.findGraphic('1', measurementGraphicsLayer);
            if (prev !== undefined) {
              measurementGraphicsLayer.remove(prev);              
            }
        */            
        for (var z = 0; z < ctrlPts.length; z++) {
          temp.push(ctrlPts[z]);
          this.updateSegments(graphics.geometry, temp, true);
        }
       temp = null;
      },

     
      addSegment: function (ctrlPts) {
        
        if (this.show_segment === true) {
          //Measure Segment Graphic

          if (this.show_last_seg_only === true) {
            var prev = this.findGraphic('1', measurementGraphicsLayer);
            if (prev !== undefined) {
              measurementGraphicsLayer.remove(prev);
            }
          }

          //if(measureSegGraphic !== null || measureSegGraphic !== undefined) measurementGraphicsLayer.remove(measureSegGraphic);
          var measureSegGeom = new Point(0, 0, map.spatialReference);
          measureSegGraphic = new Graphic(measureSegGeom, this.getMeasureSymbol(measureSegGeom, 45, ''), {});
          measureSegGraphic.id = '1';
          measurementGraphicsLayer.add(measureSegGraphic);
          //End of Measure Segment Graphic

        }
       
        if (ctrlPts.length <= 1) {
          this._addEmptyGraphics();
        }
        
        
      },


      updateSegments: function (geom, ctrlPts, isPassive) {
        if(isPassive === undefined) isPassive = false;
        if (geom.type === 'polyline' || geom.type === 'polygon') {
        
          
          if(isPassive === true) {
            if (ctrlPts.length > 1) {              
            this._updateGraphicForEdit(geom, ctrlPts);
          }

          } else {
          if (ctrlPts.length > 1) {              
            this._updateGraphic(geom, ctrlPts);
          }  
          }
        
          /*
          if (ctrlPts.length > 1) {              
            this._updateGraphic(geom, ctrlPts);
          } else {
            console.log("Control Points < 1");
          }

            */ 

          
          
        }


      },

      updateAllSegments: function (geom, ctrlPts, counter) {


        if (geom.type === 'polyline' || geom.type === 'polygon') {
          if (counter >= 1) {


            var firstPt = ctrlPts[counter];
            var lastPt = ctrlPts[counter-1];

            /*
            var firstPt = ctrlPts[ctrlPts.length - 2];
            var lastPt = ctrlPts[ctrlPts.length - 1];
            */


            var angle = this._calculateAngle(firstPt, lastPt);
            var measureExtentGeom = new Extent(geom.getExtent(), map.spatialReference);


            if (this.show_segment === true) {
              //Measure Segment Graphic

              var measureSegGeom = this._calculateMidPoint(firstPt, lastPt);
              var bng = '';
              if (this.show_bng === true) bng = this._getBearing(firstPt, lastPt);
              measureSegGraphic.setSymbol(this.getMeasureSymbol(measureSegGeom, angle, this._calculateSegmentLength(firstPt, lastPt, this.dist_unit, isGeodesic) + ' ' + bng));
              measureSegGraphic.setGeometry(measureSegGeom);
              //measureSegGraphic.getDojoShape().moveToFront();
              //End of Measure Segment Graphic
            }

            if (this.show_line === true) {
              var measureLineGeom = new Polyline();
              measureLineGeom.addPath(ctrlPts);

              measureLineGraphic.setGeometry(measureLineGeom);
              //this.measureLineGraphic.getDojoShape().moveToBack();
            }

            if (this.show_extent === true) {
              //Convert it into option of whole symbol area
              //var measureExtentGeom = new Extent(measureLineGeom.getExtent(), map.spatialReference);

              measureExtentGraphic.setGeometry(measureExtentGeom);
              //measureExtentGraphic.getDojoShape().moveToBack();
            }

            if (this.show_height === true) {
              //Measure H Graphic
              var measureExtentHGeom = GeoTools.getMidpointLeft(measureExtentGeom);

              var angle = this._calculateAngle(GeoTools.getLowerLeft(measureExtentGeom), GeoTools.getUpperLeft(measureExtentGeom));
              measureExtentHGraphic.setSymbol(this.getMeasureSymbol(measureExtentHGeom, angle, this._calculateSegmentLength(GeoTools.getLowerLeft(measureExtentGeom), GeoTools.getUpperLeft(measureExtentGeom), this.dist_unit, isGeodesic)));
              measureExtentHGraphic.setGeometry(measureExtentHGeom);
              //End of Measure H Graphic
            }


            if (this.show_width) {

              //Measure W Graphic
              var measureExtentWGeom = GeoTools.getMidpointTop(measureExtentGeom);

              //GeoTools.displayPoint(map, measureExtentWGeom);

              var angle = this._calculateAngle(GeoTools.getUpperLeft(measureExtentGeom), GeoTools.getUpperRight(measureExtentGeom));
              measureExtentWGraphic.setSymbol(this.getMeasureSymbol(measureExtentWGeom, angle, this._calculateSegmentLength(GeoTools.getLowerLeft(measureExtentGeom), GeoTools.getUpperRight(measureExtentGeom), this.dist_unit, isGeodesic)));
              measureExtentWGraphic.setGeometry(measureExtentWGeom);
              //End of Measure W Graphic
            }


            if (this.show_area) {
              //Measure A Graphic

              var measureExtentAGeom = GeoTools.getCenterOfExtent(measureExtentGeom);
              //var angle = this._calculateAngle(getUpperLeft(measureExtentGeom), getUpperRight(measureExtentGeom));
              measureExtentAGraphic.setSymbol(this.getMeasureSymbol(measureExtentAGeom, 0, this._calculateArea(measureExtentGeom, this.area_unit, isGeodesic)));
              measureExtentAGraphic.setGeometry(measureExtentAGeom);
              //measureExtentAGraphic.getDojoShape().moveToFront();
              //End of Measure A Graphic
            }



            if (this.show_total === true) {
              //Measure T Graphic
              var pt = ctrlPts[ctrlPts.length - 1];
              measureExtentTGraphic.symbol.setOffset(80, 30);

              var pl = new Polyline(pt.spatialReference);
              pl.addPath(ctrlPts);

              measureExtentTGraphic.setSymbol(this.getMeasureSymbol(pl, 0, this._calculatePolylineLength(pl, this.dist_unit, isGeodesic)));
              measureExtentTGraphic.setGeometry(pt);
            }

            //End of Measure T Graphic

          } else {
            console.log("Control Points < 1");
          }

        }


      },

      wrapUp: function (event) {

        measurementGraphicsLayer.clear();
        if (event !== undefined) this.addSegment(event);

        /*
        measureExtentGraphic = null;
        measureLineGraphic = null;
        measureExtentHGraphic = null;
        measureExtentWGraphic = null;
        measureExtentAGraphic = null;
        measureExtentTGraphic = null;
        */

      },
      destroy: function (map) {
        //Remove Graphics Layer
        map.removeLayer(measurementGraphicsLayer);
        measureExtentGraphic = null;
        measureLineGraphic = null;
        measureExtentHGraphic = null;
        measureExtentWGraphic = null;
        measureExtentAGraphic = null;
        measureExtentTGraphic = null;

      },

      _addEmptyGraphics: function () {


        var lc = new Color(this.line_color);
        lc.a = this.line_opacity;
        var ls = new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, lc, this.line_width);
        if (this.show_line === true) {
          //measureLineGeom = new Polyline([new Point(0,0,map.spatialReference), new Point(0,0,map.spatialReference)], map.spatialReference);
          var measureLineGeom = new Polyline(map.spatialReference);
          measureLineGeom.addPath([new Point(0, 0), new Point(0, 0)]);
          measureLineGraphic = new Graphic(measureLineGeom, ls, {});
          measurementGraphicsLayer.add(measureLineGraphic);
        }

        if (this.show_extent === true) {

          //Measure Extent Graphic
          var measureExtentGeom = new Extent(map.extent, map.spatialReference);
          measureExtentGraphic = new Graphic(measureExtentGeom, ls, {});
          measurementGraphicsLayer.add(measureExtentGraphic);
        }




        if (this.show_height === true) {
          //Measure Extent H Graphic
          var measureExtentHGeom = new Point(0, 0, map.spatialReference);
          measureExtentHGraphic = new Graphic(measureExtentHGeom, this.getMeasureSymbol(measureExtentHGeom, 45, ''), {});
          measurementGraphicsLayer.add(measureExtentHGraphic);
        }




        if (this.show_width === true) {
          //Measure Extent W Graphic
          var measureExtentWGeom = new Point(0, 0, map.spatialReference);
          measureExtentWGraphic = new Graphic(measureExtentWGeom, this.getMeasureSymbol(measureExtentWGeom, 45, ''), {});
          measurementGraphicsLayer.add(measureExtentWGraphic);

        }

        if (this.show_area === true) {
          //Measure Extent A Graphic
          var measureExtentAGeom = new Point(0, 0, map.spatialReference);
          measureExtentAGraphic = new Graphic(measureExtentAGeom, this.getMeasureSymbol(measureExtentAGeom, 45, ''), {});
          measurementGraphicsLayer.add(measureExtentAGraphic);
        }


        if (this.show_total === true) {
          //Measure Extent T Graphic
          var measureExtentTGeom = new Point(0, 0, map.spatialReference);
          measureExtentTGraphic = new Graphic(measureExtentTGeom, this.getMeasureSymbol(measureExtentTGeom, 45, ''), {});
          measurementGraphicsLayer.add(measureExtentTGraphic);
        }



      },

      _updateGraphic: function(geom, ctrlPts) {
            var firstPt = ctrlPts[ctrlPts.length - 2];
            var lastPt = ctrlPts[ctrlPts.length - 1];
            var angle = this._calculateAngle(firstPt, lastPt);
            var measureExtentGeom = new Extent(geom.getExtent(), map.spatialReference);

            if (this.show_segment === true) {
              //Measure Segment Graphic

              var measureSegGeom = this._calculateMidPoint(firstPt, lastPt);
              var bng = '';
              if (this.show_bng === true) bng = this._getBearing(firstPt, lastPt);
              measureSegGraphic.setSymbol(this.getMeasureSymbol(measureSegGeom, angle, this._calculateSegmentLength(firstPt, lastPt, this.dist_unit, isGeodesic) + ' ' + bng));
              measureSegGraphic.setGeometry(measureSegGeom);
              //measureSegGraphic.getDojoShape().moveToFront();
              //End of Measure Segment Graphic
            }

            if (this.show_line === true) {
              var measureLineGeom = new Polyline();
              measureLineGeom.addPath(ctrlPts);

              measureLineGraphic.setGeometry(measureLineGeom);
              //this.measureLineGraphic.getDojoShape().moveToBack();
            }

            if (this.show_extent === true) {
              //Convert it into option of whole symbol area
              //var measureExtentGeom = new Extent(measureLineGeom.getExtent(), map.spatialReference);

              measureExtentGraphic.setGeometry(measureExtentGeom);
              //measureExtentGraphic.getDojoShape().moveToBack();
            }

            if (this.show_height === true) {
              //Measure H Graphic
              var measureExtentHGeom = GeoTools.getMidpointLeft(measureExtentGeom);

              var angle = this._calculateAngle(GeoTools.getLowerLeft(measureExtentGeom), GeoTools.getUpperLeft(measureExtentGeom));
              measureExtentHGraphic.setSymbol(this.getMeasureSymbol(measureExtentHGeom, angle, this._calculateSegmentLength(GeoTools.getLowerLeft(measureExtentGeom), GeoTools.getUpperLeft(measureExtentGeom), this.dist_unit, isGeodesic)));
              measureExtentHGraphic.setGeometry(measureExtentHGeom);
              //End of Measure H Graphic
            }


            if (this.show_width) {

              //Measure W Graphic
              var measureExtentWGeom = GeoTools.getMidpointTop(measureExtentGeom);

              //GeoTools.displayPoint(map, measureExtentWGeom);

              var angle = this._calculateAngle(GeoTools.getUpperLeft(measureExtentGeom), GeoTools.getUpperRight(measureExtentGeom));
              measureExtentWGraphic.setSymbol(this.getMeasureSymbol(measureExtentWGeom, angle, this._calculateSegmentLength(GeoTools.getLowerLeft(measureExtentGeom), GeoTools.getUpperRight(measureExtentGeom), this.dist_unit, isGeodesic)));
              measureExtentWGraphic.setGeometry(measureExtentWGeom);
              //End of Measure W Graphic
            }


            if (this.show_area) {
              //Measure A Graphic

              var measureExtentAGeom = GeoTools.getCenterOfExtent(measureExtentGeom);
              //var angle = this._calculateAngle(getUpperLeft(measureExtentGeom), getUpperRight(measureExtentGeom));
              measureExtentAGraphic.setSymbol(this.getMeasureSymbol(measureExtentAGeom, 0, this._calculateArea(measureExtentGeom, this.area_unit, isGeodesic)));
              measureExtentAGraphic.setGeometry(measureExtentAGeom);
              //measureExtentAGraphic.getDojoShape().moveToFront();
              //End of Measure A Graphic
            }



            if (this.show_total === true) {
              //Measure T Graphic
              var pt = ctrlPts[ctrlPts.length - 1];
              measureExtentTGraphic.symbol.setOffset(80, 30);

              var pl = new Polyline(pt.spatialReference);
              pl.addPath(ctrlPts);

              measureExtentTGraphic.setSymbol(this.getMeasureSymbol(pl, 0, this._calculatePolylineLength(pl, this.dist_unit, isGeodesic)));
              measureExtentTGraphic.setGeometry(pt);
            }

            //End of Measure T Graphic

      },


      _updateGraphicForEdit: function(geom, ctrlPts) {

            var firstPt = ctrlPts[ctrlPts.length - 2];
            var lastPt = ctrlPts[ctrlPts.length - 1];
            
            var angle = this._calculateAngle(firstPt, lastPt);

            var prev = this.findGraphic('1', measurementGraphicsLayer);
            if (prev !== undefined) {
              measurementGraphicsLayer.remove(prev);
            }           

            var measureExtentGeom = new Extent(geom.getExtent(), map.spatialReference);

            if (this.show_segment === true) {
              //Measure Segment Graphic

              var measureSegGraphic = new Graphic();
              measureSegGraphic.id = '1';
              
              

              var measureSegGeom = this._calculateMidPoint(firstPt, lastPt);
              var bng = '';
              if (this.show_bng === true) bng = this._getBearing(firstPt, lastPt);
              measureSegGraphic.setSymbol(this.getMeasureSymbol(measureSegGeom, angle, this._calculateSegmentLength(firstPt, lastPt, this.dist_unit, isGeodesic) + ' ' + bng));
              measureSegGraphic.setGeometry(measureSegGeom);
              measurementGraphicsLayer.add(measureSegGraphic);
              



              //measureSegGraphic.getDojoShape().moveToFront();
              //End of Measure Segment Graphic
            }

            if (this.show_line === true) {
              var measureLineGeom = new Polyline();
              measureLineGeom.addPath(ctrlPts);

              measureLineGraphic.setGeometry(measureLineGeom);
              //this.measureLineGraphic.getDojoShape().moveToBack();
            }

            if (this.show_extent === true) {
              //Convert it into option of whole symbol area
              //var measureExtentGeom = new Extent(measureLineGeom.getExtent(), map.spatialReference);

              measureExtentGraphic.setGeometry(measureExtentGeom);
              //measureExtentGraphic.getDojoShape().moveToBack();
            }

            if (this.show_height === true) {
              //Measure H Graphic
              var measureExtentHGeom = GeoTools.getMidpointLeft(measureExtentGeom);

              var angle = this._calculateAngle(GeoTools.getLowerLeft(measureExtentGeom), GeoTools.getUpperLeft(measureExtentGeom));
              measureExtentHGraphic.setSymbol(this.getMeasureSymbol(measureExtentHGeom, angle, this._calculateSegmentLength(GeoTools.getLowerLeft(measureExtentGeom), GeoTools.getUpperLeft(measureExtentGeom), this.dist_unit, isGeodesic)));
              measureExtentHGraphic.setGeometry(measureExtentHGeom);
              //End of Measure H Graphic
            }


            if (this.show_width) {

              //Measure W Graphic
              var measureExtentWGeom = GeoTools.getMidpointTop(measureExtentGeom);

              //GeoTools.displayPoint(map, measureExtentWGeom);

              var angle = this._calculateAngle(GeoTools.getUpperLeft(measureExtentGeom), GeoTools.getUpperRight(measureExtentGeom));
              measureExtentWGraphic.setSymbol(this.getMeasureSymbol(measureExtentWGeom, angle, this._calculateSegmentLength(GeoTools.getLowerLeft(measureExtentGeom), GeoTools.getUpperRight(measureExtentGeom), this.dist_unit, isGeodesic)));
              measureExtentWGraphic.setGeometry(measureExtentWGeom);
              //End of Measure W Graphic
            }


            if (this.show_area) {
              //Measure A Graphic

              var measureExtentAGeom = GeoTools.getCenterOfExtent(measureExtentGeom);
              //var angle = this._calculateAngle(getUpperLeft(measureExtentGeom), getUpperRight(measureExtentGeom));
              
              measureExtentAGraphic.setSymbol(this.getMeasureSymbol(measureExtentAGeom, 0, this._calculateArea(measureExtentGeom, this.area_unit, isGeodesic)));
              measureExtentAGraphic.setGeometry(measureExtentAGeom);
              //measureExtentAGraphic.getDojoShape().moveToFront();
              //End of Measure A Graphic
              
            }



            if (this.show_total === true) {
              //Measure T Graphic
              var pt = ctrlPts[ctrlPts.length - 1];
              measureExtentTGraphic.symbol.setOffset(80, 30);

              var pl = new Polyline(pt.spatialReference);
              pl.addPath(ctrlPts);

              measureExtentTGraphic.setSymbol(this.getMeasureSymbol(pl, 0, this._calculatePolylineLength(pl, this.dist_unit, isGeodesic)));
              measureExtentTGraphic.setGeometry(pt);
            }

            //End of Measure T Graphic

      },

      

      // function to calculate and provide a bearing for the points being drawn.  Code provided by Dean Anderson of Polk County, OR
      _getBearing: function (point_a, point_b) {
        var bearing = '-';
        if (point_a && point_b) {
          var bearing = 'N0-0-0E';

          var rise = point_b.y - point_a.y;
          var run = point_b.x - point_a.x;
          if (rise == 0) {
            if (point_a.x > point_b.x) {
              bearing = 'Due West';
            } else {
              bearing = 'Due East';
            }
          } else if (run == 0) {
            if (point_a.y > point_b.y) {
              bearing = 'Due South';
            } else {
              bearing = 'Due North';
            }
          } else {
            var ns_quad = 'N';
            var ew_quad = 'E';
            if (rise < 0) {
              ns_quad = 'S';
            }
            if (run < 0) {
              ew_quad = 'W';
            }
            /* we've determined the quadrant, so we can make these absolute */
            rise = Math.abs(rise);
            run = Math.abs(run);
            /* convert to degrees */
            // var degrees = Math.atan(rise/run) / (2*Math.PI) * 360;
            // Calculation suggested by Dean Anderson, refs: #153
            var degrees = Math.atan(run / rise) / (2 * Math.PI) * 360;

            /* and to DMS ... */
            var d = parseInt(degrees);
            var t = (degrees - d) * 60;
            var m = parseInt(t);
            var s = parseInt(60 * (t - m));

            bearing = ns_quad + d + '-' + m + '-' + s + ew_quad;

          }
        }
        return bearing;
      },


      /***
       * meters | feet | kilometers | miles | nautical-miles | yards
       **/

      _calculateSegmentLength: function (pt1, pt2, unit, useGeodesic) {



        var pl = new Polyline(pt1.spatialReference);
        pl.addPath([pt1, pt2]);
        // we want the last point being drawn
        var geoLength = 0;
        if (useGeodesic === true) {
          geoLength = geometryEngine.geodesicLength(pl, unit);
        } else {
          geoLength = geometryEngine.planarLength(pl, unit);
        }
        return geoLength.toFixed(1) + ' ' + this._getDistanceUnitInfo(unit);
      },

      /***
       * meters | feet | kilometers | miles | nautical-miles | yards
       **/
      _calculatePolylineLength: function (pl, unit, useGeodesic) {

        // we want the last point being drawn

        var geoLength = 0;
        if (useGeodesic === true) {
          geoLength = geometryEngine.geodesicLength(pl, unit);
        } else {
          geoLength = geometryEngine.planarLength(pl, unit);
        }
        return geoLength.toFixed(1) + ' ' + this._getDistanceUnitInfo(unit);

      },

      /***
       * acres | ares | hectares | square-feet | square-meters | square-yards | square-kilometers | square-miles
       **/
      _calculateArea: function (geometry, unit, useGeodesic) {
        var geoArea = 0;
        if (useGeodesic === true) {
          geoArea = geometryEngine.geodesicArea(geometry, unit);
        } else {
          geoArea = geometryEngine.planarArea(geometry, unit);
        }
        return geoArea.toFixed(1) + ' ' + this._getAreaUnitInfo(unit);
      },

      _reorderGraphics: function (measureLayer) {
        // text for measurements needs to be on type all others
        var graArray = [];
        // make 2 pass through the graphics in the measure array move text to the top.
        // second pass adds text graphics
        for (var i = 0; i < measureLayer.graphics.length; i++) {
          var gra = measureLayer.graphics[i];
          if (gra.symbol.type === 'textsymbol') {
            graArray.push(gra);
          }
        }
        // first pass adds non text graphics
        for (var i = 0; i < measureLayer.graphics.length; i++) {
          var gra = measureLayer.graphics[i];
          if (gra.symbol.type !== 'textsymbol') {
            graArray.push(gra);
          }
        }
        measureLayer.graphics = graArray;
        measureLayer.redraw();


      },


      getMeasureSymbol: function (pt, angle, length) {
        var a = Font.STYLE_ITALIC;
        var b = Font.VARIANT_NORMAL;
        var c = Font.WEIGHT_BOLD;
        var symbolFont = new Font(this.font_size + "px", a, b, c, "Helvetica");
        var fontColor = new Color(this.font_color);
        fontColor.a = this.font_opacity;
        var textSymbol = new TextSymbol(length, symbolFont, fontColor);
        var xOff = 0;
        var yOff = 0;
        if (angle >= 0 && angle < 45) {
          xOff = 5;
          yOff = 10;
        } else if (angle > 45) {
          xOff = 10;
          yOff = 5;
        } else if (angle > -45 && angle < 0) {
          xOff = 5;
          yOff = 13;
        } else {
          xOff = -10;
          yOff = 5;
        }
        textSymbol.setOffset(xOff, yOff);
        textSymbol.setAngle(angle);
        return textSymbol;
      },


      _calculateAngle: function (pt1, pt2) {
        // some basic trig to calculate the angle for the text to be placed
        var y = pt2.y - pt1.y;
        var x = pt2.x - pt1.x;
        var r = y / x;
        var angle = Math.atan(r) * 180 / Math.PI * -1;
        return angle;
      },


      _calculateMidPoint: function (pt1, pt2) {
        var midX = (pt1.x + pt2.x) / 2;
        var midY = (pt1.y + pt2.y) / 2;
        var midPoint = new Point(midX, midY, pt1.spatialReference);
        return midPoint;
      },
      _getDistanceUnitInfo: function (unit) {
        for (var i = 0; i < this.distanceUnits.length; i++) {
          var unitInfo = this.distanceUnits[i];
          if (unitInfo.unit === unit) {
            return unitInfo.abbr;
          }
        }
        return null;
      },

      _getAreaUnitInfo: function (unit) {
        for (var i = 0; i < this.areaUnits.length; i++) {
          var unitInfo = this.areaUnits[i];
          if (unitInfo.unit === unit) {
            return unitInfo.abbr;
          }
        }
        return null;
      },
      findGraphic: function (id, lyr) {
        var g = undefined;
        for (var i = lyr.graphics.length - 1; i >= 0; i--) {
          if (lyr.graphics[i].id === id) {
            g = lyr.graphics[i];
          }
        }


        return g;
      }








    });
    return MeasurementEngine;
  });