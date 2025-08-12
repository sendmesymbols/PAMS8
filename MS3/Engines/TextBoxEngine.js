/**
 * Class TextBoxEngine.
 *
 * @class
 * @author Naeem
 */
define(["dojo/_base/declare", 
    "esri/symbols/SimpleMarkerSymbol", 
    "esri/geometry/Point",
    "esri/geometry/Polygon", 
    "esri/geometry/ScreenPoint",
    "esri/graphic"],
    function (declare, SimpleMarkerSymbol, Point, Polygon, ScreenPoint, Graphic) {

        var TextBox = declare(null, { declaredClass: "MilitarySymbology.Engines.TextBoxEngine",

        map: null,
            fontSize: null,
            graphicText: null, 
            ptGeom: null,
            textAlign: null,
            symCenterScreenPt: null,
            markerSymbol: new SimpleMarkerSymbol(),
        constructor: function (map, geometry, fontSize, labelText, textAlign) {
            this.map = map;
            this.fontSize = fontSize;      
            this.graphicText = labelText; 
            this.ptGeom = geometry;
            this.textAlign = textAlign;
                                
            var labelPtGraphic = new Graphic(this.ptGeom, this.markerSymbol);            
            this.symCenterScreenPt = this.map.toScreen(labelPtGraphic.geometry);
        }, 
        drawTextBBox: function () {
            var textsArr = this.graphicText.replace(/<br\s*\/?>/ig, "\n").split("\n");
            var textLines = textsArr.length;
            var longestTextLine = "";
            var lineFactor = textLines + 1;
            if (textLines > 1) {
                for (var i = 0; i < textsArr.length; i++)
                {
                    var line = textsArr[i];
                    if (line.length > longestTextLine.length) {
                        longestTextLine = line;
                    }
                }
            } else {
                longestTextLine = this.graphicText;
            }
            var textWidth = Math.ceil(this.measureText(longestTextLine, this.fontSize));            
            var textBBoxGeom = this.getBBoxGeomAlignWise(textWidth, lineFactor);
            return textBBoxGeom;
        },
        getTextPtGeom: function(polygonGeom){
            var textsArr = this.graphicText.replace(/<br\s*\/?>/ig, "\n").split("\n");
            var textLines = textsArr.length;
            var lineFactor = textLines + 1;
            
            var lineHeight = this.fontSize + 5;
            var widthFactor = this.fontSize + 2;
            var lineHeightValue = Math.ceil(lineHeight * lineFactor);
            var lineHeightHalf = Math.ceil(lineHeightValue / 2);
            
            var textSymScreenPtX, textSymScreenPtY;            
            if(this.textAlign==="left"){
                var topPtGraphic = new Graphic(new Point(polygonGeom.rings[0][0][0], polygonGeom.rings[0][0][1], this.markerSymbol));
                var symScreenTopPt = this.map.toScreen(topPtGraphic.geometry);
                textSymScreenPtX = symScreenTopPt.x + widthFactor;
                textSymScreenPtY = symScreenTopPt.y + lineHeightHalf;      
            }else if(this.textAlign==="right"){
                topPtGraphic = new Graphic(new Point(polygonGeom.rings[0][1][0], polygonGeom.rings[0][1][1], this.markerSymbol));
                var symScreenTopPt = this.map.toScreen(topPtGraphic.geometry);
                textSymScreenPtX = symScreenTopPt.x - widthFactor;
                textSymScreenPtY = symScreenTopPt.y + lineHeightHalf;  
            }else{
                return polygonGeom.getExtent().getCenter();
            }         
            
            var textSymScreenPt = new ScreenPoint(textSymScreenPtX, textSymScreenPtY);
            var textSymMapPt = this.map.toMap(textSymScreenPt);
            return textSymMapPt;
        },
        getBBoxGeomAlignWise: function(textWidth, lineFactor){
            var lineHeight = this.fontSize + 5;
            var widthFactor = this.fontSize + 2;
            var lineHeightValue = Math.ceil(lineHeight * lineFactor);
            var lineHeightHalf = Math.ceil(lineHeightValue / 2);
            if(this.textAlign){
                if(this.textAlign==="left"){
                   return this.getBBoxGeomLeftAligned(lineHeightHalf, textWidth, widthFactor);
                }else if(this.textAlign==="right"){
                   return this.getBBoxGeomRightAligned(lineHeightHalf, textWidth, widthFactor);
                }else{
                    return this.getBBoxGeomCenterAligned(lineHeightHalf, textWidth, widthFactor);
                }
            }else{
                return this.getBBoxGeomCenterAligned(lineHeightHalf, textWidth, widthFactor);
            }
        },
        getBBoxGeomLeftAligned: function(lineHeightHalf, textWidth, widthFactor){           
            
            var topRightScreenPtX = this.symCenterScreenPt.x + textWidth + widthFactor;
            var topRightScreenPtY = this.symCenterScreenPt.y - lineHeightHalf;

            var topLeftScreenPtX = this.symCenterScreenPt.x - widthFactor;
            var topLeftScreenPtY = this.symCenterScreenPt.y - lineHeightHalf;

            var bottomRightScreenPtX = this.symCenterScreenPt.x + textWidth + widthFactor;
            var bottomRightScreenPtY = this.symCenterScreenPt.y + lineHeightHalf;	
            
            var bottomLeftScreenPtX = this.symCenterScreenPt.x - widthFactor;
            var bottomLeftScreenPtY = this.symCenterScreenPt.y + lineHeightHalf;            
            
            var polygonGeom = this.getBBoxPolygonGeom(topRightScreenPtX, topRightScreenPtY, bottomLeftScreenPtX, bottomLeftScreenPtY, 
            topLeftScreenPtX, topLeftScreenPtY, bottomRightScreenPtX, bottomRightScreenPtY);
            
            return polygonGeom;
        },
        getBBoxGeomRightAligned: function(lineHeightHalf, textWidth, widthFactor){
            var topRightScreenPtX = this.symCenterScreenPt.x + widthFactor;
            var topRightScreenPtY = this.symCenterScreenPt.y - lineHeightHalf;

            var topLeftScreenPtX = this.symCenterScreenPt.x - textWidth - widthFactor;
            var topLeftScreenPtY = this.symCenterScreenPt.y - lineHeightHalf;

            var bottomRightScreenPtX = this.symCenterScreenPt.x + widthFactor;
            var bottomRightScreenPtY = this.symCenterScreenPt.y + lineHeightHalf;	
            
            var bottomLeftScreenPtX = this.symCenterScreenPt.x - textWidth - widthFactor;
            var bottomLeftScreenPtY = this.symCenterScreenPt.y + lineHeightHalf;            

            var polygonGeom = this.getBBoxPolygonGeom(topRightScreenPtX, topRightScreenPtY, bottomLeftScreenPtX, bottomLeftScreenPtY, 
            topLeftScreenPtX, topLeftScreenPtY, bottomRightScreenPtX, bottomRightScreenPtY);
            
            return polygonGeom;
        },
        getBBoxGeomCenterAligned: function(lineHeightHalf, textWidth, widthFactor){
            
            var textWidthHalf = Math.ceil(textWidth / 2) + widthFactor;

            var topRightScreenPtX = this.symCenterScreenPt.x + textWidthHalf;
            var topRightScreenPtY = this.symCenterScreenPt.y - lineHeightHalf;

            var topLeftScreenPtX = this.symCenterScreenPt.x - textWidthHalf;
            var topLeftScreenPtY = this.symCenterScreenPt.y - lineHeightHalf;

            var bottomRightScreenPtX = this.symCenterScreenPt.x + textWidthHalf;
            var bottomRightScreenPtY = this.symCenterScreenPt.y + lineHeightHalf;	
            
            var bottomLeftScreenPtX = this.symCenterScreenPt.x - textWidthHalf;
            var bottomLeftScreenPtY = this.symCenterScreenPt.y + lineHeightHalf;  
            
            var polygonGeom = this.getBBoxPolygonGeom(topRightScreenPtX, topRightScreenPtY, bottomLeftScreenPtX, bottomLeftScreenPtY, 
            topLeftScreenPtX, topLeftScreenPtY, bottomRightScreenPtX, bottomRightScreenPtY);
            
            return polygonGeom;
        },
        getBBoxPolygonGeom: function(topRightScreenPtX, topRightScreenPtY, bottomLeftScreenPtX, bottomLeftScreenPtY, 
            topLeftScreenPtX, topLeftScreenPtY, bottomRightScreenPtX, bottomRightScreenPtY){
            var symTopRightScreenPt = new ScreenPoint(topRightScreenPtX, topRightScreenPtY);
            var symBottomLeftScreenPt = new ScreenPoint(bottomLeftScreenPtX, bottomLeftScreenPtY);

            var symTopLeftScreenPt = new ScreenPoint(topLeftScreenPtX, topLeftScreenPtY);
            var symBottomRightScreenPt = new ScreenPoint(bottomRightScreenPtX, bottomRightScreenPtY);

            var symTopRightMapPt = this.map.toMap(symTopRightScreenPt);
            var symBottomLeftMapPt = this.map.toMap(symBottomLeftScreenPt);

            var symTopLeftMapPt = this.map.toMap(symTopLeftScreenPt);
            var symBottomRightMapPt = this.map.toMap(symBottomRightScreenPt);

            var textBBoxGeom = new Polygon([[symTopLeftMapPt.x, symTopLeftMapPt.y], [symTopRightMapPt.x, symTopRightMapPt.y], [symBottomRightMapPt.x, symBottomRightMapPt.y], [symBottomLeftMapPt.x, symBottomLeftMapPt.y], [symTopLeftMapPt.x, symTopLeftMapPt.y]]);		
            return textBBoxGeom;  
        },
        measureText: function (str, fontSize) {
            const widths = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.2796875, 0.2765625, 0.3546875, 0.5546875, 0.5546875, 0.8890625, 0.665625, 0.190625, 0.3328125, 0.3328125, 0.3890625, 0.5828125, 0.2765625, 0.3328125, 0.2765625, 0.3015625, 0.5546875, 0.5546875, 0.5546875, 0.5546875, 0.5546875, 0.5546875, 0.5546875, 0.5546875, 0.5546875, 0.5546875, 0.2765625, 0.2765625, 0.584375, 0.5828125, 0.584375, 0.5546875, 1.0140625, 0.665625, 0.665625, 0.721875, 0.721875, 0.665625, 0.609375, 0.7765625, 0.721875, 0.2765625, 0.5, 0.665625, 0.5546875, 0.8328125, 0.721875, 0.7765625, 0.665625, 0.7765625, 0.721875, 0.665625, 0.609375, 0.721875, 0.665625, 0.94375, 0.665625, 0.665625, 0.609375, 0.2765625, 0.3546875, 0.2765625, 0.4765625, 0.5546875, 0.3328125, 0.5546875, 0.5546875, 0.5, 0.5546875, 0.5546875, 0.2765625, 0.5546875, 0.5546875, 0.221875, 0.240625, 0.5, 0.221875, 0.8328125, 0.5546875, 0.5546875, 0.5546875, 0.5546875, 0.3328125, 0.5, 0.2765625, 0.5546875, 0.5, 0.721875, 0.5, 0.5, 0.5, 0.3546875, 0.259375, 0.353125, 0.5890625];
            const avg = 0.5279276315789471;
            return str
                   .split('')
                   .map(c => c.charCodeAt(0) < widths.length ? widths[c.charCodeAt(0)] : avg)
                   .reduce((cur, acc) => acc + cur) * fontSize;
         }     

        });
        return TextBox;
    });
