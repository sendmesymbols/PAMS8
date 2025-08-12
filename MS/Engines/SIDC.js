/**
 * Class SIDC.
 *
 * @class
 * @author Abdul Razak
 */

define(["dojo/_base/declare", "dojo/_base/lang", "dojo/_base/array",
    "dojo/_base/connect", "dojo/_base/Color", "dojo/_base/window",
    "dojo/has", "dojo/keys", "dojo/dom-construct",
    "dojo/dom-style", "esri/kernel", "esri/sniff",
    "esri/toolbars/_toolbar", "esri/symbols/SimpleMarkerSymbol", "esri/symbols/SimpleLineSymbol",
    "esri/symbols/SimpleFillSymbol", "dojo/text!"+location.origin + "/" + "MilitarySymbology/Data/Settings.json"],
    function (declare, lang, Array,
        connect, Color, window,
        has, keys, domconstruct,
        domstyle, esriKernel, esriSniff,
        Toolbar, SimpleMarkerSymbol, SimpleLineSymbol,
        SimpleFillSymbol, Settings) {

        var SIDC = declare(null, { declaredClass: "MilitarySymbology.Engines.SIDC",
            symbolThickness : 0,
            standardIdentities : [
                {"00" : [{"Style" : SimpleLineSymbol.STYLE_DASH, "Color" : new Color([255, 255, 0])}]} , // Pending
                {"01" : [{"Style" : SimpleLineSymbol.STYLE_SOLID, "Color" : new Color([255, 255, 0])}]}, // Unknown
                {"02" : [{"Style" : SimpleLineSymbol.STYLE_DASH, "Color" : new Color([0, 51, 204])}]}, // Assumed Friend
                {"03" : [{"Style" : SimpleLineSymbol.STYLE_SOLID, "Color" : new Color([0, 51, 204])}]}, // Friend
                {"04" : [{"Style" : SimpleLineSymbol.STYLE_SOLID, "Color" : new Color([0, 226, 0])}]}, // Neutral
                {"05" : [{"Style" : SimpleLineSymbol.STYLE_DASH, "Color" : new Color([255, 48, 49])}]}, // Suspect  Joker
                {"06" : [{"Style" : SimpleLineSymbol.STYLE_SOLID, "Color" : new Color([255, 48, 49])}]}, // Hostile  Faker

                {"07" : [{"Style" : SimpleLineSymbol.STYLE_SOLID, "Color" : new Color([255, 0, 0])}]}, // Red
                {"08" : [{"Style" : SimpleLineSymbol.STYLE_SOLID, "Color" : new Color([34,139,34])}]}, // Green
                {"09" : [{"Style" : SimpleLineSymbol.STYLE_SOLID, "Color" : new Color([0, 0, 255])}]}, // Blue
                {"10" : [{"Style" : SimpleLineSymbol.STYLE_SOLID, "Color" : new Color([0, 0, 0])}]}, // Black
                {"11" : [{"Style" : SimpleLineSymbol.STYLE_SOLID, "Color" : new Color([128,0,128])}]}, // Purple
                {"12" : [{"Style" : SimpleLineSymbol.STYLE_SOLID, "Color" : new Color([255, 255, 0])}]}, // Yellow
                {"13" : [{"Style" : SimpleLineSymbol.STYLE_SOLID, "Color" : new Color([255, 0, 255])}]}, // Magenta
                {"14" : [{"Style" : SimpleLineSymbol.STYLE_SOLID, "Color" : new Color([165,42,42])}]}, // Light Brown
                {"15" : [{"Style" : SimpleLineSymbol.STYLE_SOLID, "Color" : new Color([0, 226, 0])}]}, // Olive Green
                {"16" : [{"Style" : SimpleLineSymbol.STYLE_SOLID, "Color" : new Color([255, 69, 0])}]}, // Orange

                {"17" : [{"Style" : SimpleLineSymbol.STYLE_SOLID, "Color" : new Color([128, 128, 128])}]}, // Gray
                {"18" : [{"Style" : SimpleLineSymbol.STYLE_SOLID, "Color" : new Color([128, 128, 0])}]}, // Olive
                {"19" : [{"Style" : SimpleLineSymbol.STYLE_SOLID, "Color" : new Color([0, 0, 128])}]}, // Navy
                {"20" : [{"Style" : SimpleLineSymbol.STYLE_SOLID, "Color" : new Color([0, 255, 0])}]}, // Lime
                {"21" : [{"Style" : SimpleLineSymbol.STYLE_SOLID, "Color" : new Color([0, 255, 255])}]}, // Cyan
                {"22" : [{"Style" : SimpleLineSymbol.STYLE_SOLID, "Color" : new Color([255, 228, 196])}]}, // Bisque
                {"23" : [{"Style" : SimpleLineSymbol.STYLE_SOLID, "Color" : new Color([139, 69, 19])}]}, // Dark Brown
                {"24" : [{"Style" : SimpleLineSymbol.STYLE_SOLID, "Color" : new Color([0, 206, 209])}]}, // Turquoise
                {"25" : [{"Style" : SimpleLineSymbol.STYLE_SOLID, "Color" : new Color([148, 0, 211])}]} // Dark Violet
    
                
            ],
        constructor: function (sidc, settings) {
            this._sidc = sidc;
            //this.settings = JSON.parse(Settings);
            this.settings = settings;

        },



         validateSIDC: function (sidc) {
             var res = false;
            if(this._sidc.length == 20) {
               res = true;
            }

             return res;
        },


        getSID: function() {
            return this._sidc.substring(10,16);
        },
        getIdentity: function() {
          //return this._sidc[3];
          return this._sidc.substring(2,4);
        },

        getStatus: function() {
          return this.getSIDC()[6];
        },


        getSIDC: function() {
            return this._sidc;
        },

        getHeight : function() {
            return this.settings.height;
        },

        getWidth : function() {
            return this.settings.width;
        },  


        getMarker: function (symGeometricType, isObs, fill) {
                var sLFs;
                                
                var style; 
                if(this.getStatus() === '1') {
                    style = this.standardIdentities[0]['00'][0].Style;
                    
                } else {
                    //style = this.standardIdentities[this.getIdentity()][this.getIdentity()][0].Style;
                    style = this.standardIdentities[Number(this.getIdentity())][this.getIdentity()][0].Style;
                }
                
                if(symGeometricType == "Area" || symGeometricType == "Line") {
             
                    if(isObs !== undefined && isObs==="1") {
                    
                    sLFs = new SimpleLineSymbol(style,
                        new Color(JSON.parse(this.settings.standardIdentities[4]['04'])),
                        this.settings.lineWidth);

                    } else {
                    
                    sLFs = new SimpleLineSymbol(style,
                        new Color(JSON.parse(this.settings.standardIdentities[Number(this.getIdentity())][this.getIdentity()])),
                        this.settings.lineWidth);


                    }


                     } else if(symGeometricType == "Point") {

                     var sL = new SimpleLineSymbol(style,
                        new Color(JSON.parse(this.settings.standardIdentities[Number(this.getIdentity())][this.getIdentity()])),
                        this.settings.PtlineWidth);    

                     sLFs = new SimpleMarkerSymbol(this.standardIdentities[Number(this.getIdentity())][this.getIdentity()][0].Style,
                        new Color(JSON.parse(this.settings.standardIdentities[Number(this.getIdentity())][this.getIdentity()])),
                        this.settings.PtlineWidth);
                        
                        


                    sLFs = new SimpleMarkerSymbol();
                    sLFs.setSize(this.settings.size);
                    if(fill !== undefined && fill === "1") {
                        sLFs.setColor(new Color(JSON.parse(this.settings.standardIdentities[Number(this.getIdentity())][this.getIdentity()]))); 

                        }
                    sLFs.setOutline(sL);
                    

                  }

        
            return sLFs;

            },

        /*

        getMarker: function (symGeometricType, isObs, fill) {
                var sLFs;
                if(symGeometricType == "Area" || symGeometricType == "Line") {
             
                    if(isObs !== undefined && isObs==="1") {
                    
                    sLFs = new SimpleLineSymbol(this.standardIdentities[this.getIdentity()][this.getIdentity()][0].Style,
                        new Color(JSON.parse(this.settings.standardIdentities[4][4])),
                        this.settings.lineWidth);

                    } else {
                    
                    sLFs = new SimpleLineSymbol(this.standardIdentities[this.getIdentity()][this.getIdentity()][0].Style,
                        new Color(JSON.parse(this.settings.standardIdentities[this.getIdentity()][this.getIdentity()])),
                        this.settings.lineWidth);
                    }


                     } else if(symGeometricType == "Point") {

                     var sL = new SimpleLineSymbol(this.standardIdentities[this.getIdentity()][this.getIdentity()][0].Style,
                        new Color(JSON.parse(this.settings.standardIdentities[this.getIdentity()][this.getIdentity()])),
                        this.settings.PtlineWidth);    

                     sLFs = new SimpleMarkerSymbol(this.standardIdentities[this.getIdentity()][this.getIdentity()][0].Style,
                        new Color(JSON.parse(this.settings.standardIdentities[this.getIdentity()][this.getIdentity()])),
                        this.settings.PtlineWidth);
                        
                        


                    sLFs = new SimpleMarkerSymbol();
                    sLFs.setSize(this.settings.size);
                    if(fill !== undefined && fill === "1") {
                        sLFs.setColor(new Color(JSON.parse(this.settings.standardIdentities[this.getIdentity()][this.getIdentity()]))); 
                        }
                    sLFs.setOutline(sL);
                    

                  }

            
            return sLFs;

            },
            */


        
   
        

        });
        return SIDC;
    });
