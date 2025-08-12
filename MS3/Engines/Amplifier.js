/**
 * Class Amplifier.
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
    "esri/SnappingManager", "esri/geometry/Point",  "esri/geometry/geometryEngine",
    "esri/geometry/scaleUtils", "MilSymbologyComponents/BaseLine", "MilSymbologyExt/GeoTools"],
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
        scaleUtils, BaseLine, GeoTools) {

        var Amplifier = declare(null, { declaredClass: "MilitarySymbology.Engines.Amplifier",
            SYMBOL_ICON : "",
            ECHELON : "",
            QUANTITY : "",
            HOSTILE : "",
            DIR_OF_MOV_INDICATOR : "", //ONLY FOR PTS
            OFFSET_LOC_INDICATOR : "",//ONLY FOR PTS
            UNIQUE_DESIG : "",
            TYPE : "",
            DTG : "",
            EDTG : "",
            /*
             An alphanumeric designator for displaying a date-time group (DDHHMMSSZMONYYYY) or “O/O” for on order. The date-time group is composed of a group of six numeric digits with a time zone suffix and the standardized three-letter abbreviation for the month followed by four digits. The first pair of digits represents the day, the second pair, the hour, the third pair, the minutes. The last four digits after the month are the year. For automated systems, two digits may be added before the time zone suffix and after the minutes to designate seconds.
             */
            ALTITUDE_DEPTH : "",
            LOC : "",
            DISTANCE : "",
            AZIMUTH : "",
            TARGET_DESIGNATOR : "",
            COUNTRY : "",
            HIGHER_FORM : "",
            STAFF_COM : "",
            ADDL_INFO : "",




        constructor: function (sidc) {
            

        },

       


        
   
        

        });
        return Amplifier;
    });
