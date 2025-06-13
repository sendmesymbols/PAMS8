var mapMain;
var widgetEditor;

// @formatter:off
require([
        "esri/map",
        "esri/layers/FeatureLayer",
        "esri/tasks/GeometryService",
        "esri/dijit/editing/Editor",
        "esri/dijit/editing/TemplatePicker",
        "esri/config",
        "esri/layers/ArcGISTiledMapServiceLayer",
        "esri/layers/ArcGISDynamicMapServiceLayer",

        "dojo/ready",
        "dojo/parser",
        "dojo/on",
        "dojo/_base/array",

        "dijit/layout/BorderContainer",
        "dijit/layout/ContentPane"],
    function (Map, FeatureLayer, GeometryService, Editor, TemplatePicker, config,
            ArcGISTiledMapServiceLayer, ArcGISDynamicMapServiceLayer,
              ready, parser, on, array,
              BorderContainer, ContentPane) {


        // Wait until DOM is ready *and* all outstanding require() calls have been resolved
        ready(function () {

            // Parse DOM nodes decorated with the data-dojo-type attribute
            parser.parse();

            /*
             * Step: Specify the proxy Url
             */
            //config.defaults.io.proxyUrl = "http://localhost/proxy/proxy.ashx";

            // Create the map
            mapMain = new Map("divMap", {
                center: [73, 34]
            });


             var tiled = new ArcGISTiledMapServiceLayer("http://20.60.50.22:6080/arcgis/rest/services/OSM_Tiled/MapServer");
            mapMain.addLayer(tiled);

            var flFirePoints, flFireLines, flFirePolygons;
            /*
             * Step: Construct the editable layers
             */
            flFirePoints = new FeatureLayer("http://20.60.50.32:6080/arcgis/rest/services/QtrLand_FSvc/FeatureServer/1", {
                outFields: ['*']
            });
            flFireLines = new FeatureLayer("http://sampleserver6.arcgisonline.com/arcgis/rest/services/Wildfire/FeatureServer/1", {
                outFields: ['*']
            });
            flFirePolygons = new FeatureLayer("http://20.60.50.32:6080/arcgis/rest/services/QtrLand_FSvc/FeatureServer/1", {
                outFields: ['*']
            });

            // Listen for the editable layers to finish loading
            mapMain.on("layers-add-result", initEditor);

            // add the editable layers to the map
            //mapMain.addLayers([flFirePolygons, flFireLines, flFirePoints]);
            mapMain.addLayers([flFirePolygons]);

            function initEditor(results) {

                // Map the event results into an array of layerInfo objects
                var layerInfosWildfire = array.map(results.layers, function (result) {
                    return {
                        featureLayer: result.layer
                    };
                });

                /*
                 * Step: Map the event results into an array of Layer objects
                 */
                var layersWildfire = array.map(results.layers, function (result) {
                    return result.layer;
                });

                /*
                 * Step: Add a custom TemplatePicker widget
                 */
                var tpCustom = new TemplatePicker({
                    featureLayers: layersWildfire,
                    columns: 2
                }, "divLeft");
                tpCustom.startup();

                /*
                 * Step: Prepare the Editor widget settings
                 */
                var editorSettings = {
                    map: mapMain,
                    geometryService: new GeometryService("http://20.60.201.20:6080/arcgis/rest/services/Utilities/Geometry/GeometryServer"),
                    layerInfos: layerInfosWildfire,
                    toolbarVisible: true,
                    templatePicker: tpCustom,
                    createOptions: {
                        polygonDrawTools: [Editor.CREATE_TOOL_FREEHAND_POLYGON, Editor.CREATE_TOOL_RECTANGLE, Editor.CREATE_TOOL_TRIANGLE, Editor.CREATE_TOOL_CIRCLE]
                    },
                    toolbarOptions: {
                        reshapeVisible: true
                    },
                    enableUndoRedo: true,
                    maxUndoRedoOperations: 20
                };

                /*
                 * Step: Build the Editor constructor's first parameter
                 */
                var editorParams = {
                    settings: editorSettings
                };

                /*
                 * Step: Construct the Editor widget
                 */
                widgetEditor = new Editor(editorParams, "divTop");
                widgetEditor.startup();

            };

        });
    });
