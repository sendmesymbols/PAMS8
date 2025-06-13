    var map;

    require([
        "esri/InfoTemplate",
        "esri/layers/FeatureLayer",
        "esri/map",
        "esri/renderers/HeatmapRenderer",
        "esri/tasks/FeatureSet",
        "esri/geometry/Point",
        "esri/symbols/SimpleMarkerSymbol",
        "esri/Color",
        "esri/graphic",
        "esri/SpatialReference",
        "dojo/domReady!"
      ],
      function(InfoTemplate, FeatureLayer, Map, HeatmapRenderer, FeatureSet, Point, SimpleMarkerSymbol, Color, Graphic, SpatialReference) {



        map = new Map("map", {
          basemap: "gray",
          center: [-81.12468662, 41.42756484],
          zoom: 7
        });

        var features = [];
        var featureSet = new FeatureSet();
        var spatialReference = new SpatialReference(4326);
        var pt, attr, graphic;
        
        var sms = new SimpleMarkerSymbol().setStyle(
          SimpleMarkerSymbol.STYLE_SQUARE).setColor(
          new Color([255, 0, 0, 0.5]));

        pt = new Point(-80.12, 40.42, spatialReference);
                  
        attr = {
          OBJECTID: 1,
          text: 'a',
          magnitude: 10,
          x: -80.12,
          y: 40.42
        }

        graphic = new Graphic(pt, sms, attr);


        features.push(graphic);

        pt = new Point(11410247.806310548, 2765598.2877963777, spatialReference);

        attr = {
          OBJECTID: 2,
          text: 'b',
          magnitude: 100,
          x: -81.12,
          y: 40.42
        }

        graphic = new Graphic(pt, sms, attr);
        features.push(graphic);

        pt = new Point(-81.12, 41.42, spatialReference);
        
        attr = {
          OBJECTID: 3,
          text: 'C',
          magnitude: 200,
          x: -81.12,
          y: 41.42
        }

        graphic = new Graphic(pt, sms, attr);

        features.push(graphic);

        featureSet.features = features;
        
        featureSet.geometryType = "esriGeometryPoint";

        var featureCollection = {
          objectIdField: "OBJECTID",
          layerDefinition: {
            "geometryType": "esriGeometryPoint",
            "fields": [{
              "name": "OBJECTID",
              "type": "esriFieldTypeOID"
            }, {
              "name": "text",
              "type": "esriFieldTypeString"
            }, {
              "name": "magnitude",
              "type": "esriFieldTypeDouble"
            }, {
              "name": "x",
              "type": "esriFieldTypeDouble"
            }, {
              "name": "y",
              "type": "esriFieldTypeDouble"
            }]
          },
          featureSet: featureSet
        };


        //var serviceURL = "//services.arcgis.com/V6ZHFr6zdgNZuVG0/arcgis/rest/services/Earthquakes_Since_1970/FeatureServer/0";
        var heatmapFeatureLayerOptions = {
          mode: FeatureLayer.MODE_SNAPSHOT,
          outFields: ["text", "magnitude"],

        };
        var heatmapFeatureLayer = new FeatureLayer(featureCollection, heatmapFeatureLayerOptions);
        var heatmapRenderer = new HeatmapRenderer({
          field: "magnitude",
        });
        heatmapFeatureLayer.setRenderer(heatmapRenderer);
        map.addLayer(heatmapFeatureLayer);

        console.log(heatmapFeatureLayer);
      })
