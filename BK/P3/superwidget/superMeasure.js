require([
    "dojo/dom",
    "dojo/parser",

    "esri/map",
    "esri/dijit/Measurement",
    "esri/units",
    "esri/tasks/GeometryService",
    "esri/geometry/Point",
    "esri/symbols/TextSymbol",
    "esri/symbols/Font",
    "esri/layers/GraphicsLayer",
    "esri/graphic",

    "dijit/layout/BorderContainer",
    "dijit/layout/ContentPane",
    "dijit/TitlePane",
    "dijit/form/CheckBox", 
    "dojo/domReady!"
  ], function(
    dom, parser, Map, Measurement, Units, GeometryService, Point, TextSymbol, Font, GraphicsLayer, graphic
  ){
    parser.parse();

    var map = new Map("map", {
      basemap: "satellite",
      center: [-85.743, 38.256],
      zoom: 17
    });

    var precision = { // Number of decimal places for each unit
      'Kilometers': 4,
      'Feet': 1,
      'Meters': 1,
      'Yards': 1,
      'Nautical Miles': 4,
      'Miles': 4
    };
    var segs = []; // Holds the two most recent measurement points
    var prevLineLength = 0; // The total length of the line excluding the most recent segment
    var prevUnit = ''; // The unit the map was using before a unit change
    var measureText = new GraphicsLayer(); // Stores text graphics of segment lengths
    measureText.id = 'measureText';
    map.addLayer(measureText);

    // Hacky seeming way of getting the coordinates of the first point of the measure line
    function getCursorLocation(){
      var getCursorEvt = map.on('mouse-move', function(evt){
        segs.push(evt.mapPoint);
      });

      var removeGetCursorEvt = map.on('mouse-move', function(){
        getCursorEvt.remove();
        removeGetCursorEvt.remove();
      });
    }

    // Pass an array of two Point geometries, returns their midpoint as a new Point
    function getMidpoint(array){
      var pointX = (array[0].x+array[1].x)/2;
      var pointY = (array[0].y+array[1].y)/2;
      return new Point(pointX, pointY, array[0].spatialReference);
    }

    // Pass an array of two Point geometries, returns slope of the line that passes between them
    function getSlope(array){
        var m = (array[1].y-array[0].y)/(array[1].x-array[0].x);
        m = Math.atan(m)*(180/Math.PI);
        return m*-1;
    }

    // Returns a suitable label offset based on line slope
    function getOffset(slope){
      var x;
      if (slope > 0){
        x = 10;
      } else {
        x = -10;
      }
      return {x:x, y:10};
    }

    // Clears the graphics and resets the supporting variables to set up a new line
    function clearLineInfo(){
      prevLineLength = 0;
      segs = [];
      measureText.clear();
    }

    // Converts input from one linear unit to another
    // I'm sure there's a library that does this but I'm bored anyway
    function convertUnits(value, fromUnit, toUnit){
      if (fromUnit == toUnit){
        return value;
      }

      var factors = {
        'Miles': {'Kilometers': 1.60934, 'Feet': 5280, 'Meters': 1609.34, 'Yards': 1760, 'Nautical Miles': 0.868976},
        'Kilometers': {'Miles': 0.621371, 'Feet': 3280.84, 'Meters': 1000, 'Yards': 1093.61, 'Nautical Miles': 0.539957},
        'Feet': {'Miles': 0.000189394, 'Kilometers': 0.000304799, 'Meters': 0.3048, 'Yards': 0.333333, 'Nautical Miles': 0.000164579},
        'Meters': {'Miles': 0.000621371, 'Kilometers': 0.001, 'Feet': 3.28084, 'Yards': 1.09361, 'Nautical Miles': 0.000539957},
        'Yards': {'Miles': 0.000568182, 'Kilometers': 0.0009144, 'Feet': 3, 'Meters': 0.9144, 'Nautical Miles': 0.000493737},
        'Nautical Miles': {'Miles': 1.15078, 'Kilometers': 1.852, 'Feet': 6076.12, 'Meters': 1852, 'Yards': 2025.37}
      };

      value *= factors[fromUnit][toUnit];
      return value.toFixed(precision[toUnit]);
    }

    var measurement = new Measurement({
      map: map,
      defaultLengthUnit: Units.FEET
    }, dom.byId("measurementDiv"));
    measurement.startup();

    // Captures each completed segment and adds its length as a graphic
    measurement.on('measure', function(evt){
      // Only run if distance tool selected
      if (evt.toolName !== 'distance'){
        return;
      }

      // Add new segment endpoint to list, remove the old one
      segs.push(evt.geometry);
      if (segs.length > 2){
        segs.splice(0,1);
      }

      // Calculate and format current segment length
      var segLength = evt.values - prevLineLength;
      segLength = segLength.toFixed(precision[evt.unitName]);

      // Reset this value for the next segment's calculation
      prevLineLength = evt.values;

      // Gets/sets appropriate values for text symbol
      var slope = getSlope(segs);
      var offset = getOffset(slope);
      var font = new Font("12pt", Font.STYLE_NORMAL, Font.VARIANT_NORMAL, Font.WEIGHT_BOLD, "Helvetica");
      
      var textSymbol = new TextSymbol(segLength).setAngle(slope).setOffset(offset.x, offset.y).setFont(font);
      var midpoint = getMidpoint(segs);
      var segText = new graphic(midpoint, textSymbol);
      measureText.add(segText);
    });

    measurement.on('measure-start', function(){
      prevUnit = measurement.getUnit();
      clearLineInfo();
      getCursorLocation(); // This is needed because on('measure') doesn't capture the first coordinate :(
    });

    measurement.on('tool-change', clearLineInfo);

    // Iterates through the graphics and updates the units as necessary
    measurement.on('unit-change', function(evt){
      measureText.graphics.forEach(function(item){
        var value = Number(item.symbol.text);
        item.symbol.text = convertUnits(value, prevUnit, evt.unitName);
      });
      measureText.redraw();
      prevUnit = evt.unitName; // Reset this unit for the next calculation
    });
  }
);