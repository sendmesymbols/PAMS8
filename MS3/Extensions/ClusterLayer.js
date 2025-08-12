/**
 * Class Representing Cluster Layer.
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
    "esri/SnappingManager", "esri/geometry/Point",  
    "MilSymbologySymbolsThirdParty/Cluster", "esri/renderers/ClassBreaksRenderer"],
    function (declare, lang, Array,
        connect, color, window,
        has, keys, domconstruct,
        domstyle, esriKernel, esriSniff,
        Toolbar, SimpleMarkerSymbol, SimpleLineSymbol,
        SimpleFillSymbol, _Graphic, jsonUtility,
        webMercatorUtils, _Polyline, _Polygon,
        Multipoint, Rect, dojoEsrijsapi,
        on, GraphicsLayer, Evented,
        SnappingManager, Point, 
        Cluster, ClassBreaksRenderer
        ) {



        var ClusterLayer = declare([Evented], { declaredClass: "MilitarySymbology.Extentions.ClusterLayer",
		      cluster : {},
          className :"ClusterLayer",
          
         constructor: function (map, dataManager, subTypeProperty, options) {


          this.areaDisplayMode = options.areaDisplayMode || "hover";
          this.subTypeFlareProperty = subTypeProperty;
          this.displaySingleFlaresAtCount = options.displaySingleFlaresAtCount || 10;
          this.preClustered = false;
          this.dataManager = dataManager;

          this.clusterRatio = options.clusterRatio || 75;
          this.map = map;

          //set up a popup template
          this.template = options.template || null;

          
                cluster = new Cluster({
                    id: this.generateUUID(),
                    spatialReference: this.map.spatialReference,
                    subTypeFlareProperty: this.subTypeFlareProperty,
                    singleFlareTooltipProperty: "name",
                    displaySubTypeFlares: true,
                    displaySingleFlaresAtCount: this.displaySingleFlaresAtCount,
                    flareShowMode: "mouse",
                    preClustered: this.preClustered,
                    clusterRatio: this.clusterRatio,
                    clusterAreaDisplay: this.areaDisplayMode,
                    clusteringBegin: function () {
                        //console.log("clustering begin");
                    },
                    clusteringComplete: function () {
                        //console.log("clustering complete");
                    }
                });
 
                //set up a class breaks renderer to render different symbols based on the cluster count. Use the required clusterCount property to break on.
                var defaultSym = options.defaultSym || new SimpleMarkerSymbol().setSize(6).setColor("#FF0000").setOutline(null)
                var renderer = new ClassBreaksRenderer(defaultSym, "clusterCount");
                var xlSymbol =  options.xlSymbolClr || new SimpleMarkerSymbol(SimpleMarkerSymbol.STYLE_CIRCLE, 32, new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new dojo.Color([200, 52, 59, 0.9]), 1), new dojo.Color([250, 65, 74, 0.9]));
                var lgSymbol =  options.lgSymbolClr || new SimpleMarkerSymbol(SimpleMarkerSymbol.STYLE_CIRCLE, 28, new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new dojo.Color([41, 163, 41, 0.9]), 1), new dojo.Color([51, 204, 51, 0.9]));
                var mdSymbol =  options.mdSymbolClr || new SimpleMarkerSymbol(SimpleMarkerSymbol.STYLE_CIRCLE, 24, new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new dojo.Color([82, 163, 204, 0.9]), 1), new dojo.Color([0, 64, 128, 0.9]));
                var smSymbol =  options.smSymbolClr || new SimpleMarkerSymbol(SimpleMarkerSymbol.STYLE_CIRCLE, 22, new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new dojo.Color([230, 184, 92, 0.9]), 1), new dojo.Color([64, 0, 128, 0.9]));
                renderer.addBreak(0, 19, smSymbol);
                renderer.addBreak(20, 150, mdSymbol);
                renderer.addBreak(151, 1000, lgSymbol);
                renderer.addBreak(1001, Infinity, xlSymbol);

                if (this.areaDisplayMode) {
                    //if area display mode is set. Create a renderer to display cluster areas. Use SimpleFillSymbols as the areas are polygons
                    var defaultAreaSym = options.defaultAreaSym || new SimpleFillSymbol().setStyle(SimpleFillSymbol.STYLE_SOLID).setColor(new dojo.Color([0, 0, 0, 0.2])).setOutline(new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new dojo.Color([0, 0, 0, 0.3]), 1));
                    var areaRenderer = new ClassBreaksRenderer(defaultAreaSym, "clusterCount");
                    var xlAreaSymbol = options.xlAreaSymbol || new SimpleFillSymbol(SimpleFillSymbol.STYLE_SOLID, new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new dojo.Color([200, 52, 59, 0.9]), 1), new dojo.Color([250, 65, 74, 0.9]));
                    var lgAreaSymbol = options.lgAreaSymbol || new SimpleFillSymbol(SimpleFillSymbol.STYLE_SOLID, new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new dojo.Color([41, 163, 41, 0.9]), 1), new dojo.Color([51, 204, 51, 0.9]));
                    var mdAreaSymbol = options.mdAreaSymbol || new SimpleFillSymbol(SimpleFillSymbol.STYLE_SOLID, new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new dojo.Color([82, 163, 204, 0.9]), 1), new dojo.Color([0, 64, 128, 0.9]));
                    var smAreaSymbol = options.smAreaSymbol || new SimpleFillSymbol(SimpleFillSymbol.STYLE_SOLID, new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new dojo.Color([230, 184, 92, 0.9]), 1), new dojo.Color([64, 0, 128, 0.9]));

                    areaRenderer.addBreak(0, 19, smAreaSymbol);
                    areaRenderer.addBreak(20, 150, mdAreaSymbol);
                    areaRenderer.addBreak(151, 1000, lgAreaSymbol);
                    areaRenderer.addBreak(1001, Infinity, xlAreaSymbol);

                    //use the custom overload of setRenderer to include the renderer for areas.
                    cluster.setRenderer(renderer, areaRenderer);
                }
                else {
                    cluster.setRenderer(renderer); //use standard setRenderer.
                }

                
                
          

		},

    getLayer: function () { 
      return cluster;

    },


    setInfoTemplate: function (template) { 
      cluster.infoTemplate = template;

    },


    activate : function() {

      if(this.template !== null)  {
        cluster.infoTemplate = this.template;
        this.map.infoWindow.titleInBody = false;  
        }


      this.map.addLayer(cluster);
       if (this.preClustered) {
         this.getPreClusteredGraphics();
          } else {
            //not preclustered - just add the raw data to be clusted within the layer.
            var data = this.dataManager.getData();
            cluster.addData(data);
        }
    },



    deActivate : function() {
      this.map.removeLayer(cluster);
      this.cluster = null;
      this.dataManager = null;
    },

   getPreClusteredGraphics : function () {
                var maxSingleFlareCount = this.displaySingleFlaresAtCount;
                var clusterRatio = this.clusterRatio;
                var clusteredData = DataManager.fakeServerSideClustering(this.clusterRatio, this.maxSingleFlareCount, this.areaDisplayMode, this.map);
                cluster.addPreClusteredData(clusteredData);
            },

      
  generateUUID: function () {
            var fin = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                var r = Math.random() * 16 | 0,
                        v = c == 'x' ? r : (r & 0x3 | 0x8);
                return r.toString(16);

            });
            return fin;
        }
        

        });
        return ClusterLayer;
    });
