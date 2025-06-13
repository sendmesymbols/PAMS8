
define(["dojo/_base/declare", "dojo/_base/lang", "dojo/_base/array",
    "dojo/_base/connect", "dojo/_base/Color", "dojo/_base/window",
    "dojo/has", "dojo/keys", "dojo/dom-construct",
    "dojo/dom-style", "esri/kernel", "esri/sniff",
    "esri/toolbars/_toolbar", "esri/symbols/SimpleMarkerSymbol", "esri/symbols/SimpleLineSymbol",
    "esri/symbols/SimpleFillSymbol", "esri/graphic", "esri/geometry/jsonUtils",
    "esri/geometry/webMercatorUtils", "esri/geometry/Polyline", "esri/geometry/Polygon",
    "esri/geometry/Multipoint", "esri/geometry/Rect", "dojo/i18n!esri/nls/jsapi"],
    function (declare, lang, Array,
        connect, color, window,
        has, keys, domconstruct,
        domstyle, esriKernel, esriSniff,
        Toolbar, SimpleMarkerSymbol, SimpleLineSymbol,
        SimpleFillSymbol, graphic, jsonUtility,
        webMercatorUtils, Polyline, Polygon,
        Multipoint, Rect, dojoEsrijsapi) {
            
           

        var Mock = declare(null, { declaredClass: "MilitarySymbology.Extensions.Mock",
		eventMap: { "draw-complete": !0, "draw-end": ["geometry"] },
        
        constructor: function (map, options)
		{
            
            
			this.markerSymbol = new SimpleMarkerSymbol(SimpleMarkerSymbol.STYLE_SOLID, 10, new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new color([255, 0, 0]), 2), new color([0, 0, 0, 0.25]));
			this.lineSymbol = new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new color([255, 0, 0]), 2);
			this.fillSymbol = new SimpleFillSymbol(SimpleFillSymbol.STYLE_SOLID, new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new color([255, 0, 0]), 2), new color([0, 0, 0, 0.25]));
			this._points = [];
			this._defaultOptions = { showTooltips: !0, drawTime: 75, tolerance: 8, tooltipOffset: 15 };
			this._options = lang.mixin(lang.mixin({}, this._defaultOptions), options || {});
			this._mouse = !has("esri-touch") && !has("esri-pointer");
			this._mouse || (this.options.showTooltips = !1);
            
			this._onKeyDownHandler = lang.hitch(this, this._onKeyDownHandler);
			this._onMouseDownHandler = lang.hitch(this, this._onMouseDownHandler);
			this._onMouseUpHandler = lang.hitch(this, this._onMouseUpHandler);
			this._onClickHandler = lang.hitch(this, this._onClickHandler);
			this._onMouseMoveHandler = lang.hitch(this, this._onMouseMoveHandler);
			this._onMouseDragHandler = lang.hitch(this, this._onMouseDragHandler);
			this._onDblClickHandler = lang.hitch(this, this._onDblClickHandler);
			this._updateTooltip = lang.hitch(this, this._updateTooltip);
			this._hideTooltip = lang.hitch(this, this._hideTooltip);
			this._redrawGraphic = lang.hitch(this, this._redrawGraphic)
            
		},
        
        //current drawing geometry type , null if not drawing
		_geometryType: null,
		respectDrawingVertexOrder: !1,
		setRespectDrawingVertexOrder: function (b)
		{
			this.respectDrawingVertexOrder = b
		},
		setMarkerSymbol: function (b)
		{
			this.markerSymbol = b
		},
		setLineSymbol: function (b)
		{
			this.lineSymbol = b
		},
		setFillSymbol: function (b)
		{
			this.fillSymbol = b
		},
        
        

            primitiveVal: 50,
            objectVal: [1, 2, 3],
            myMethod: function () {
                console.log("Hello World!");
            }

        });
        return Mock;
    });