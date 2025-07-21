define(["dojo/_base/declare", "dojo/Evented", "esri/toolbars/draw", "esri/toolbars/edit",
        "esri/symbols/SimpleLineSymbol", "dojo/_base/Color",
        "esri/graphic", "MilSymbologySymbolsEngine/SIDC", "dojo/json",
        "MilSymbologySymbolsEngine/Mapper", "MilSymbologySymbolsEngine/AnnotationEngine",
        "esri/geometry/Point", "esri/geometry/Polyline", "esri/geometry/Polygon",
        "esri/SpatialReference",
        "dojo/text!" + location.origin + "/" + "MilitarySymbology/Data/Symbols.json",
        "dojo/text!" + location.origin + "/" + "MilitarySymbology/Data/Settings.json"
    ],
    function (declare, Evented, Draw, Edit, SimpleLineSymbol,
        Color, Graphic, SIDC,
        json, Mapper, AnnotationEngine,
        Point, Polyline, Polygon, SpatialReference,
        symData, settings) {

        var SymbolEngine = declare([Evented], {
            declaredClass: "MilitarySymbology.Engines.SymbolEngine",
            SIDC: "",
            amplifier: "",
            symbolData: "",
            settings: "",
            endEvent: "",
            drawProgressEvent: "",
            drawBaseLineEndEvent: "",
            drawClickEvent: "",
            isDrawing: true,
            map: "",
            attrs: "",
            LCC1SP: 'PROJCS["Lambert_Conformal_Conic",GEOGCS["GCS_EVEREST_INDIA_NEPAL",DATUM["D_EVEREST_INDIA_NEPAL",SPHEROID["Everest_1830_1975_Adjustment",6377299.151,300.8017254981305]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Conformal_Conic"],PARAMETER["false_easting",2743195.5],PARAMETER["false_northing",914398.5],PARAMETER["central_meridian",68.0],PARAMETER["standard_parallel_1",32.5],PARAMETER["standard_parallel_2",32.5],PARAMETER["scale_factor",0.99878641],PARAMETER["latitude_of_origin",32.5],UNIT["Meter",1.0]]',
            LCC2SP: 'PROJCS["Lambert_Conformal_Conic",GEOGCS["GCS_EVEREST_INDIA_NEPAL",DATUM["D_EVEREST_INDIA_NEPAL",SPHEROID["Everest_1830_1975_Adjustment",6377299.151,300.8017254981305]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Conformal_Conic"],PARAMETER["false_easting",2743195.5],PARAMETER["false_northing",914398.5],PARAMETER["central_meridian",74.0],PARAMETER["standard_parallel_1",26.0],PARAMETER["standard_parallel_2",26.0],PARAMETER["scale_factor",0.99878641],PARAMETER["latitude_of_origin",26.0],UNIT["Meter",1.0]]',
            WGS1SP: 4326,
            WGS1PROJSP: 'EPSG:4326',
            WGS2SP: 'GEOGCS["Geographic Coordinate System",DATUM["D_WGS84",SPHEROID["WGS84",6378137.0,298.257223560493]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',

            constructor: function (sidc, amplifier, map, graphicsLayer, textGraphicsLayer, attrs) {
                this.settings = JSON.parse(settings);
                this.SIDC = new SIDC(sidc, this.settings);
                this.attrs = attrs;

                try {
                    if (this.SIDC.validateSIDC(sidc) == true) {
                        this.amplifier = amplifier;
                        this.map = map;
                        this.graphicsLayer = graphicsLayer;
                        this.textGraphicsLayer = textGraphicsLayer;
                        this.init();
                    } else {
                        throw "Invalid SIDC Found";
                    }
                } catch (e) {
                    console.log("Can not initialize Symbol Engine");
                }



            },


            init: function () {

                this.symbolData = JSON.parse(symData);
                var reqSID = this.SIDC.getSID();
                var coSIDC = this.SIDC.getSIDC();
                var symSet = this.SIDC.getSIDC().substr(4, 2);
                this.currentSymbol = this.symbolData[symSet + reqSID];
            },

            getSymbol: function (isLine) {
                if (this.currentSymbol != undefined) {
                    this.mapper = new Mapper(this.currentSymbol.Class);
                    var sym = this.mapper.getInstance();
                    return new sym(this.map, isLine);
                } else {
                    throw "SIDC not found";
                }
            },

            getEchelon: function () {

                if (this.SIDC != undefined) {
                    return this.SIDC._sidc.substr(8, 2);
                } else {
                    throw "SIDC not found";
                }
            },


            /*
            extraSettings parameters is added to pass line width and force symbol size from interface, remove it and relevant conditions
            to let SIDC class read settings from settings.json
            */

            initialize: function (drawEssentials, extraSettings, labelOptions, isPassive) {

                try {

                    if (isPassive === undefined) {
                        isPassive = false;
                    }
                    var symbol = this.getSymbol(drawEssentials.IS_LINE);
                    symbol.amplifier = this.amplifier;
                    endEvent = symbol.on("onDrawEnd", dojo.partial(this.drawSymEnd, this));
                    drawProgressEvent = symbol.on("onDrawProgress", dojo.partial(this.symDrawProgress, this));
                    drawClickEvent = symbol.on("onDrawClick", dojo.partial(this.symDrawClick, this));
                    drawBaseLineEndEvent = symbol.on("onBaseLineDrawEnd", dojo.partial(this.baseLineDrawEnd, this));
                    var marker = null;

                    if (extraSettings !== undefined) {

                        if (extraSettings.hasOwnProperty('textSize')) {
                            this.settings.textSize = extraSettings.textSize;

                        }
                    }

                    this.labelOptions = labelOptions;

                    if (this.currentSymbol.SymGeoType === "Point" || this.currentSymbol.SymGeoType === "FPoint") {
                        marker = this.SIDC.getMarker(symbol.symGeometricType, symbol.isObstacle, this.currentSymbol.Fill);

                        /*
                        extraSettings parameters is added to pass line width and force symbol size from interface, remove it and relevant conditions
                        to let SIDC class read settings from settings.json
                        */

                        if (extraSettings !== undefined) {
                            if (this.currentSymbol.SymGeoType === "Point") {
                                if (extraSettings.hasOwnProperty('lineWidth')) {
                                    marker.outline.width = extraSettings.lineWidth;
                                }

                                if (extraSettings.hasOwnProperty('size')) {
                                    drawEssentials.SIZE = extraSettings.size;
                                }

                                if (extraSettings.hasOwnProperty('opacity')) {
                                    marker.outline.color.a = extraSettings.opacity;
                                    if (drawEssentials.SID !== "000110") marker.color.a = extraSettings.opacity;
                                    drawEssentials.opacity = extraSettings.opacity;
                                }

                            }
                            if (this.currentSymbol.SymGeoType === "FPoint") {
                                if (extraSettings.hasOwnProperty('size')) {
                                    drawEssentials.size = extraSettings.size;
                                }

                                if (extraSettings.hasOwnProperty('opacity')) {
                                    drawEssentials.opacity = extraSettings.opacity;
                                }

                            }

                        }


                        if (isPassive === true) {
                            if (drawEssentials.hasOwnProperty('GEOM')) {
                                drawEssentials.GEOM = this.reProject(drawEssentials.GEOM, this.map.spatialReference);
                            }
                            if (drawEssentials.hasOwnProperty('OPTIONS')) {
                                if (drawEssentials.OPTIONS.hasOwnProperty('GEOM')) {
                                    drawEssentials.OPTIONS.GEOM = this.reProject(drawEssentials.OPTIONS.GEOM, this.map.spatialReference);
                                }
                            }



                        }

                        symbol.init(drawEssentials, marker, this.SIDC.getSID(),
                            this.currentSymbol.Name, this.currentSymbol.Offset, this.SIDC._sidc);
                    } else {
                        marker = this.SIDC.getMarker(symbol.symGeometricType, symbol.isObstacle);

                        /*
                        extraSettings parameters is added to pass line width and force symbol size from interface, remove it and relevant conditions
                        to let SIDC class read settings from settings.json
                        */
                        if (extraSettings !== undefined) {

                            if (extraSettings.hasOwnProperty('lineWidth')) {
                                marker.width = extraSettings.lineWidth;
                            }

                            if (extraSettings.hasOwnProperty('opacity')) {
                                marker.color.a = extraSettings.opacity;
                                drawEssentials.opacity = extraSettings.opacity;

                            }

                        }

                        if (isPassive === true) {

                            if (drawEssentials.hasOwnProperty('CTRL_PTS')) {
                                for (var j = 0; j < drawEssentials.CTRL_PTS.length; j++) {
                                    drawEssentials.CTRL_PTS[j] = this.reProject(drawEssentials.CTRL_PTS[j], this.map.spatialReference);
                                }
                            }

                            if (drawEssentials.hasOwnProperty('BASE_LN_PTS')) {
                                if (drawEssentials.BASE_LN_PTS.hasOwnProperty('startPt')) drawEssentials.BASE_LN_PTS.startPt = this.reProject(drawEssentials.BASE_LN_PTS.startPt, this.map.spatialReference);
                                if (drawEssentials.BASE_LN_PTS.hasOwnProperty('midPt')) drawEssentials.BASE_LN_PTS.midPt = this.reProject(drawEssentials.BASE_LN_PTS.midPt, this.map.spatialReference);
                                if (drawEssentials.BASE_LN_PTS.hasOwnProperty('endPt')) drawEssentials.BASE_LN_PTS.endPt = this.reProject(drawEssentials.BASE_LN_PTS.endPt, this.map.spatialReference);
                            }




                        }

                        symbol.init(drawEssentials, marker);

                    }
                } catch (e) {}
            },

            drawSymEnd: function (oldThis, event) {
                //var t0 = performance.now();
                //for (var i = 0; i < 1000; i++) {
                var symbol;
                if (event.geometry.type == "polyline" || event.geometry.type == "point" || event.geometry.type == "polygon") {
                    symbol = event.marker;

                } else {

                    throw "Implement it, please";
                }

                var graphic = new Graphic(event.geometry, symbol);
                var tempId = oldThis.generateUUID();
                event.drawEssentials.SIDC = oldThis.SIDC.getSIDC();
                graphic.drawEssentials = event.drawEssentials;

                graphic.id = ((oldThis.attrs.hasOwnProperty('symbolId') === false) || (oldThis.attrs.symbolId === undefined) || oldThis.attrs.symbolId === null) ? tempId : oldThis.attrs.symbolId;

                graphic.attributes = oldThis.attrs;
                oldThis.graphicsLayer.add(graphic);
                isDrawing = false;
                endEvent.remove();
                drawProgressEvent.remove();
                drawClickEvent.remove();
                drawBaseLineEndEvent.remove();
                var isFreeHand = 0;
                if (graphic.drawEssentials.hasOwnProperty('ISFHAND')) {
                    isFreeHand = graphic.drawEssentials.ISFHAND;
                }
                event.drawEssentials.labelOptions = oldThis.labelOptions;

                var options = {};
                if (graphic.drawEssentials.SID === "000110") {
                    options.opacity = event.marker.color.a;
                } else {
                    options = oldThis.getOpacityValue(graphic);
                }

                AnnotationEngine.annotate(oldThis.textGraphicsLayer, event.geometry, event.drawEssentials.AMPLIFIER, event.drawEssentials, graphic.id, oldThis.settings.textSize, isFreeHand, oldThis.labelOptions, options);
                if (event.drawEssentials.hasOwnProperty('opacity')) delete event.drawEssentials.opacity;
                oldThis.emit("symDrawEnd", {
                    'isDone': "done",
                    'drawEssentials': event.drawEssentials,
                    'id': graphic.id,
                    'graphic': graphic
                });
                //}
                //var t1 = performance.now();
                //console.log("Call to create symbol took " + (t1 - t0) + " milliseconds.")
            },

            getOpacityValue: function (graphic) {
                var options = {};
                if (graphic.geometry.type === 'polyline' || graphic.geometry.type === 'polygon') {
                    options.opacity = graphic.symbol.color.a;
                } else if (graphic.drawEssentials.SYM_GEO_TYPE === 'Point') {
                    options.opacity = graphic.symbol.outline.color.a;
                }

                return options;
            },


            symDrawProgress: function (oldThis, event) {
                oldThis.emit("symDrawProgress", {
                    "currentDrawEssentials": event.currentDrawEssentials,
                    "currentGeometry": event.currentGeometry,
                    "currentMarker": event.currentMarker
                });
            },

            symDrawClick: function (oldThis, event) {
                oldThis.emit("symDrawClick", {
                    "currentPts": event.currentPts
                });
            },
            baseLineDrawEnd: function (oldThis, event) {
                oldThis.emit("baseLineDrawEnd", {
                    "currentPts": event.currentPts
                });
            },
            generateUUID: function () {
                var fin = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                    var r = Math.random() * 16 | 0,
                        v = c == 'x' ? r : (r & 0x3 | 0x8);
                    return r.toString(16);

                });
                return fin;
            },
            supplySpatialRef: function (x, y, spatialRef, sp) {

                var spRef = new SpatialReference();
                if (spatialRef !== undefined) {
                    //It is an old symbol requires no change
                    spRef = spatialRef;
                } else if (sp === 'WGS1SP') {
                    spRef = new SpatialReference(4326);

                } else if (sp === 'WGS2SP') {
                    spRef = new SpatialReference(this.WGS2SP);
                } else if (sp === 'LCC1SP') {
                    spRef = new SpatialReference(this.LCC1SP);
                } else if (sp === 'LCC2SP') {
                    spRef = new SpatialReference(this.LCC2SP);
                }

                var pt = new Point(x, y, spRef);
                return pt;
            },
            stripSpatialRef: function (pt) {
                var sp;
                if (pt.spatialReference.hasOwnProperty('wkid')) {
                    if (pt.spatialReference.wkid === this.WGS1SP) {
                        sp = 'WGS1SP';
                    }
                } else if (pt.spatialReference.hasOwnProperty('wkt')) {
                    if (pt.spatialReference.wkt === this.WGS2SP) {
                        sp = 'WGS2SP';
                    } else if (pt.spatialReference.wkt === this.LCC1SP) {
                        sp = 'LCC1SP';
                    } else if (pt.spatialReference.wkt === this.LCC2SP) {
                        sp = 'LCC2SP';
                    }
                }

                var p = new Point(pt.x, pt.y);
                delete p.spatialReference;
                p.sp = sp;

                return p;
            },
            reProject: function (pt, cRef) {

                var from, to;


                if (cRef.hasOwnProperty('wkid')) {
                    to = cRef.wkid;
                } else {
                    to = cRef.wkt;
                }



                if (pt.hasOwnProperty('spatialReference')) {
                    if (pt.spatialReference.hasOwnProperty('wkid')) {
                        from = pt.spatialReference.wkid;
                    } else if (pt.spatialReference.hasOwnProperty('wkt')) {
                        from = pt.spatialReference.wkt;
                    }

                } else if (pt.hasOwnProperty('sp')) { //This is for the ones who have sp property instead of Spatial Reference 
                    if (pt.sp === 'WGS1SP') {
                        from = this.WGS1PROJSP;

                    } else if (pt.sp === 'WGS2SP') {
                        from = this.WGS1PROJSP;

                    } else if (pt.sp === 'LCC1SP') {
                        from = this.LCC1SP;

                    } else if (pt.sp === 'LCC2SP') {
                        from = this.LCC2SP;

                    }


                    delete pt.sp;

                }
                if (to === this.WGS1SP) to = this.WGS1PROJSP;
                if (from === this.WGS1SP) from = this.WGS1PROJSP;
                var conv = proj4(from, to, [pt.x, pt.y]);
                pt.x = conv[0];
                pt.y = conv[1];



                /*
            //Check for the spatial reference of the pt
            if (pt.hasOwnProperty('spatialReference')) { //The check is for old symbols who have Spatial Reference Property
                if (pt.spatialReference.hasOwnProperty('wkid')) {
                    if (pt.spatialReference.wkid === this.WGS1SP) {
                        if(pt.spatialReference.wkid !== cRef.wkid) {
                            var conv = proj4(this.WGS1PROJSP, cRef.wkid, [pt.x, pt.y]);
                            pt.x = conv[0];
                            pt.y = conv[1];
                            
                        }
                        
                    }
                } else if (pt.spatialReference.hasOwnProperty('wkt')) {
                    if (pt.spatialReference.wkt === this.WGS2SP) {
                        var conv = proj4(this.WGS1PROJSP, cRef.wkt, [pt.x, pt.y]);
                        pt.x = conv[0];
                        pt.y = conv[1];
                        
                    } else if (pt.spatialReference.wkt === this.LCC1SP) {
                        var conv = proj4(this.LCC1SP, cRef.wkt, [pt.x, pt.y]);
                        pt.x = conv[0];
                        pt.y = conv[1];
                        
                    } else if (pt.spatialReference.wkt === this.LCC2SP) {
                        var conv = proj4(this.LCC2SP, cRef.wkt, [pt.x, pt.y]);
                        pt.x = conv[0];
                        pt.y = conv[1];
                        
                    }
        
                }
               
                //delete pt.spatialReference;
            } else if (pt.hasOwnProperty('sp')) { //This is for the ones who have sp property instead of Spatial Reference 
                if (pt.sp === 'WGS1SP') {
                    var conv = proj4(WGS1PROJSP, cRef.wkid, [pt.x, pt.y]);
                    pt.x = conv[0];
                    pt.y = conv[1];
                    
                } else if (pt.sp === 'WGS2SP') {
                    var conv = proj4(WGS1PROJSP, cRef.wkt, [pt.x, pt.y]);
                    pt.x = conv[0];
                    pt.y = conv[1];
                    
                } else if (pt.sp === 'LCC1SP') {
                    var conv = proj4(LCC1SP, cRef.wkt, [pt.x, pt.y]);
                    pt.x = conv[0];
                    pt.y = conv[1];
                    
                } else if (pt.sp === 'LCC2SP') {
                    var conv = proj4(LCC2SP, cRef.wkt, [pt.x, pt.y]);
                    pt.x = conv[0];
                    pt.y = conv[1];
                    
                }


                delete pt.sp;
        
            }*/

                pt.spatialReference = new SpatialReference(cRef);
                return pt;
            }



        });
        return SymbolEngine;
    });