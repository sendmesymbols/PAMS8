/** @module AnnotationEngine
 *   Annotate and de-annotate symbol
 *   @author Abdul Razak
 */

define(["esri/geometry/Polyline", "esri/symbols/TextSymbol", "esri/graphic",
        "esri/symbols/Font", "MilSymbologyExt/GeoTools", "esri/geometry/Point", "esri/Color"
    ],
    function (_Polyline, TextSymbol, Graphic,
        Font, GeoTools, Point, Color
    ) {

        return {

            annotate: function (textGraphicLayer, geometry, amplifier, drawEssentials, parentId, textSize, isFreeHand, labelOptions, options) {

                //var opacity = options.opacity || 1;
                var opacity = 1;
                if (options !== undefined) {
                    if (options.hasOwnProperty('opacity')) {
                        opacity = options.opacity;
                    }
                }



                if (!drawEssentials.hasOwnProperty("UEI")) {

                    //var font = new Font(textGraphicLayer._map.getScale() / 30000);

                    //var font = new Font("9em");
                    var font = new Font({
                        "family": "Helvetica",
                        "size": textSize + "pt"
                    });


                    if (labelOptions === undefined) labelOptions = {};
                    if (drawEssentials.SYM_GEO_TYPE == 'Area') {
                        var len = GeoTools.getArea(geometry.getExtent());
                        //Unique Designation -- Center
                        //Time and Effective Time -- Below Unique Designation


                        //Unique Designation -- Center
                        if (amplifier.hasOwnProperty("UNIQUE_DESIG")) {
                            //if(geometry.getExtent() !== undefined) {
                            if (amplifier.UNIQUE_DESIG.length !== 0) {
                                try {

                                    var uniqueDesigPt = geometry.getExtent().getCenter();
                                    if (isNaN(uniqueDesigPt.x) === false || isNaN(uniqueDesigPt.x) === false) {

                                        //var uniqueDesigPt = GeoTools.getPolylineCenter(geometry);


                                        var uniqueDesigText = new TextSymbol(amplifier.UNIQUE_DESIG, font);


                                        uniqueDesigText.color.a = opacity;

                                        uniqueDesigText.setAlign(TextSymbol.ALIGN_MIDDLE);
                                        var uniqueDesigGraphic = new Graphic(uniqueDesigPt, uniqueDesigText);
                                        uniqueDesigGraphic.parentId = parentId;
                                        uniqueDesigGraphic.isFreeHand = isFreeHand;
                                        textGraphicLayer.add(uniqueDesigGraphic);

                                    } else {
                                        console.log('Can not calculate extent');
                                        //alertify.set('notifier', 'position', 'bottom-right');
                                        //alertify.error('One of your drawn symbols has wrong geometry. Please draw that Symbol Again.');
                                    }
                                } catch (e) {
                                    console.log('Malformed Geometry Found');
                                    //alertify.set('notifier', 'position', 'bottom-right');
                                    //alertify.error('One of your drawn symbols has wrong geometry. Please draw that Symbol Again.');
                                }
                            }


                        }



                        //Time and Effective Time -- Below Unique Designation

                        if (amplifier.hasOwnProperty("DTG") && amplifier.DTG !== undefined) {
                            if (amplifier.DTG.length !== 0) {
                                try {
                                    var centerTop = new Point(geometry.getExtent().getCenter().x, geometry.getExtent().getCenter().y + geometry.getExtent().getHeight() / 2);

                                    var DTGPt = centerTop;
                                    var DTGText = new TextSymbol(amplifier.DTG, font);
                                    DTGText.color.a = opacity;
                                    DTGText.setAlign(TextSymbol.ALIGN_MIDDLE);
                                    var DTGGraphic = new Graphic(DTGPt, DTGText);
                                    DTGGraphic.parentId = parentId;
                                    DTGGraphic.isFreeHand = isFreeHand;
                                    textGraphicLayer.add(DTGGraphic);
                                } catch (e) {
                                    console.log('Malformed Geometry Found');
                                }
                            }
                        }


                        if (amplifier.hasOwnProperty("EDTG") && amplifier.EDTG !== undefined) {
                            if (amplifier.EDTG.length !== 0) {
                                try {
                                    var centerBottom = new Point(geometry.getExtent().getCenter().x, geometry.getExtent().getCenter().y - geometry.getExtent().getHeight() / 2);
                                    var EDTGPt = centerBottom;
                                    var EDTGText = new TextSymbol(amplifier.EDTG, font);
                                    EDTGText.color.a = opacity;
                                    EDTGText.setAlign(TextSymbol.ALIGN_MIDDLE);
                                    var EDTGGraphic = new Graphic(EDTGPt, EDTGText);
                                    EDTGGraphic.parentId = parentId;
                                    EDTGGraphic.isFreeHand = isFreeHand;
                                    textGraphicLayer.add(EDTGGraphic);
                                } catch (e) {
                                    console.log('Malformed Geometry Found');
                                }
                            }
                        }




                    } else if (drawEssentials.SYM_GEO_TYPE == 'Line') {


                        var len = GeoTools.getArea(geometry.getExtent());
                        //Unique Designation -- Above Start and End of Line
                        //Time and Effective Time -- Below Start and End of Line


                        //Unique Designation -- Center
                        if (amplifier.hasOwnProperty("UNIQUE_DESIG")) {
                            try {
                                if (drawEssentials.SYM_NAME == "Boundary") {
                                    if (amplifier.UNIQUE_DESIG.length !== 0) {
                                        try {
                                            //Unique Desig
                                            var uniqueDesigPt = geometry.getExtent().getCenter();
                                            var uniqueDesigText = new TextSymbol(amplifier.UNIQUE_DESIG, font);
                                            uniqueDesigText.color.a = opacity;
                                            uniqueDesigText.setAlign(TextSymbol.ALIGN_MIDDLE);


                                            uniqueDesigText.yoffset = 30;
                                            uniqueDesigText.xoffset = -20;

                                            var uniqueDesigGraphic = new Graphic(uniqueDesigPt, uniqueDesigText);
                                            uniqueDesigGraphic.parentId = parentId;
                                            uniqueDesigGraphic.isFreeHand = isFreeHand;
                                            textGraphicLayer.add(uniqueDesigGraphic);


                                        } catch (e) {
                                            console.log('Malformed Geometry Found in Unique Designation');
                                        }
                                    }



                                    if (amplifier.hasOwnProperty("HIGHER_FORM")) {
                                        if (amplifier.HIGHER_FORM.length !== 0) {
                                            try {
                                                //Higher Formation
                                                var highFormPt = geometry.getExtent().getCenter();
                                                var highFormText = new TextSymbol(amplifier.HIGHER_FORM, font);
                                                highFormText.color.a = opacity;
                                                highFormText.setAlign(TextSymbol.ALIGN_MIDDLE);


                                                highFormText.yoffset = -30;
                                                highFormText.xoffset = 30;

                                                var highFormGraphic = new Graphic(highFormPt, highFormText);
                                                highFormGraphic.parentId = parentId;
                                                highFormGraphic.isFreeHand = isFreeHand;
                                                textGraphicLayer.add(highFormGraphic);


                                            } catch (e) {
                                                console.log('Malformed Geometry Found in Higher Formation');
                                            }
                                        }

                                    }





                                } else {
                                    var uniqueDesigPt = geometry.getExtent().getCenter();
                                    var uniqueDesigText = new TextSymbol(amplifier.UNIQUE_DESIG, font);
                                    uniqueDesigText.color.a = opacity;
                                    uniqueDesigText.setAlign(TextSymbol.ALIGN_MIDDLE);
                                    var uniqueDesigGraphic = new Graphic(uniqueDesigPt, uniqueDesigText);
                                    uniqueDesigGraphic.parentId = parentId;
                                    uniqueDesigGraphic.isFreeHand = isFreeHand;
                                    textGraphicLayer.add(uniqueDesigGraphic);
                                }
                            } catch (e) {
                                console.log('Malformed Geometry Found');
                            }
                        }


                        //Time and Effective Time -- Below Unique Designation

                        if (amplifier.hasOwnProperty("DTG") && amplifier.DTG !== undefined) {
                            if (amplifier.DTG.length !== 0) {
                                try {
                                    var centerTop = new Point(geometry.getPoint(0, 0));

                                    var DTGPt = centerTop;
                                    var DTGText = new TextSymbol(amplifier.DTG, font);
                                    DTGText.color.a = opacity;
                                    DTGText.setAlign(TextSymbol.ALIGN_MIDDLE);
                                    var DTGGraphic = new Graphic(DTGPt, DTGText);
                                    DTGGraphic.parentId = parentId;
                                    DTGGraphic.isFreeHand = isFreeHand;
                                    textGraphicLayer.add(DTGGraphic);
                                } catch (e) {
                                    console.log('Malformed Geometry Found');
                                }
                            }

                        }


                        if (amplifier.hasOwnProperty("EDTG") && amplifier.EDTG !== undefined) {
                            if (amplifier.EDTG.length !== 0) {
                                try {

                                    var lastRingOrPath = 0;
                                    var lastPt = 0;
                                    if (geometry.type === "polyline") {
                                        lastRingOrPath = geometry.paths.length - 1;
                                        lastPt = geometry.paths[lastRingOrPath].length - 1;
                                    } else {
                                        lastRingOrPath = geometry.rings.length - 1;
                                        lastPt = geometry.rings[lastRingOrPath].length - 1;
                                    }

                                    var centerBottom = new Point(geometry.getPoint(lastRingOrPath, lastPt));
                                    var EDTGPt = centerBottom;
                                    var EDTGText = new TextSymbol(amplifier.EDTG, font);
                                    EDTGText.color.a = opacity;
                                    EDTGText.setAlign(TextSymbol.ALIGN_MIDDLE);
                                    var EDTGGraphic = new Graphic(EDTGPt, EDTGText);
                                    EDTGGraphic.parentId = parentId;
                                    EDTGGraphic.isFreeHand = isFreeHand;
                                    textGraphicLayer.add(EDTGGraphic);
                                } catch (e) {
                                    console.log('Malformed Geometry Found');
                                }

                            }
                        }






                    } else if (drawEssentials.SYM_GEO_TYPE == 'Point') {


                        if (drawEssentials.SID === "160303") {
                            //Arty Tgt Symbol
                            drawEssentials.OFFSET = "0";
                            if (amplifier.hasOwnProperty("UNIQUE_DESIG")) {
                                this.createLabelFromPropoerty(textGraphicLayer, geometry, "UNIQUE_DESIG", isFreeHand, parentId, amplifier, drawEssentials, font, opacity, labelOptions, "bottom", "right", -5, 0);
                            }
                            if (amplifier.hasOwnProperty("TARGET_DESIGNATOR")) {
                                this.createLabelFromPropoerty(textGraphicLayer, geometry, "TARGET_DESIGNATOR", isFreeHand, parentId, amplifier, drawEssentials, font, opacity, labelOptions, "bottom", "left", 5, 0);
                            }
                            if (amplifier.hasOwnProperty("STAFF_COM")) {
                                this.createLabelFromPropoerty(textGraphicLayer, geometry, "STAFF_COM", isFreeHand, parentId, amplifier, drawEssentials, font, opacity, labelOptions, "top", "right", -5, -3);
                            }
                            if (amplifier.hasOwnProperty("ADDL_INFO")) {
                                this.createLabelFromPropoerty(textGraphicLayer, geometry, "ADDL_INFO", isFreeHand, parentId, amplifier, drawEssentials, font, opacity, labelOptions, "top", "left", 5, -3);
                            }


                        } else {
                            this.createLabelFromPropoerty(textGraphicLayer, geometry, "UNIQUE_DESIG", isFreeHand, parentId, amplifier, drawEssentials, font, opacity, labelOptions);
                        }









                        /*
                        //Unique Designation -- Center
                        if (amplifier.hasOwnProperty("UNIQUE_DESIG")) {
                          if (amplifier.UNIQUE_DESIG.length !== 0) {
                            var uniqueDesigText = new TextSymbol(amplifier.UNIQUE_DESIG, font);
                            uniqueDesigText.color.a = opacity;
                            uniqueDesigPt = geometry;
                            if (drawEssentials.OFFSET === "1") {
                              uniqueDesigText.setOffset(0, drawEssentials.SIZE / 2);
                            } else {
                              uniqueDesigText.setOffset(0, drawEssentials.SIZE - 8);
                            }

                            if (labelOptions.hasOwnProperty("color")) uniqueDesigText.setColor(new Color(labelOptions.color)); //Color Array

                            if (labelOptions.hasOwnProperty("haloColorSize")) {
                              uniqueDesigText.setHaloSize(labelOptions.haloColorSize); //haloColor Size
                              if (labelOptions.hasOwnProperty("haloColor")) uniqueDesigText.setHaloColor(new Color(labelOptions.haloColor)); //haloColor Array
                            }

                            if (labelOptions.hasOwnProperty("textSize")) {
                              font.setSize(labelOptions.textSize + "pt");
                            }

                            if (labelOptions.hasOwnProperty("bold")) {
                              if (labelOptions.bold === 1) font.setWeight(Font.WEIGHT_BOLDER);
                            }

                            if (labelOptions.hasOwnProperty("italic")) {
                              if (labelOptions.italic === 1) font.setStyle(Font.STYLE_ITALIC);
                            }


                            if (labelOptions.hasOwnProperty("uLine")) {
                              if (labelOptions.uLine === 1) uniqueDesigText.setDecoration(TextSymbol.DECORATION_UNDERLINE);
                            }

                            if (labelOptions.hasOwnProperty("oLine")) {
                              if (labelOptions.oLine === 1) uniqueDesigText.setDecoration(TextSymbol.DECORATION_OVERLINE);
                            }

                            if (labelOptions.hasOwnProperty("tLine")) {
                              if (labelOptions.tLine === 1) uniqueDesigText.setDecoration(TextSymbol.DECORATION_LINETHROUGH);
                            }

                            var uniqueDesigGraphic = new Graphic(uniqueDesigPt, uniqueDesigText);
                            uniqueDesigGraphic.parentId = parentId;
                            uniqueDesigGraphic.isFreeHand = isFreeHand;
                            textGraphicLayer.add(uniqueDesigGraphic);


                          }
                        }
                        */


                    }
                }


            },

            createLabelFromPropoerty: function (txtGLyr, geom, property, isFreehnd, parentID, amplfr, drwEssntls, fnt, opcty, lblOptions, vertAlgn, horzAlgn, xOff, yOff) {
                if (amplfr.hasOwnProperty(property)) {
                    if (amplfr[property].length !== 0) {
                        var txtSymbl = new TextSymbol(amplfr[property], fnt);
                        if (vertAlgn !== undefined) txtSymbl.setVerticalAlignment(vertAlgn);
                        if (horzAlgn !== undefined) txtSymbl.setHorizontalAlignment(horzAlgn);

                        txtSymbl.color.a = opcty;
                        ptGeom = geom;
                        if (drwEssntls.OFFSET === "0") {
                            txtSymbl.setOffset(xOff, yOff);
                        } else if (drwEssntls.OFFSET === "1") {
                            txtSymbl.setOffset(0, drwEssntls.SIZE / 2);
                        } else {
                            txtSymbl.setOffset(0, drwEssntls.SIZE - 8);
                        }

                        if (lblOptions.hasOwnProperty("color")) txtSymbl.setColor(new Color(lblOptions.color)); //Color Array

                        if (lblOptions.hasOwnProperty("haloColorSize")) {
                            txtSymbl.setHaloSize(lblOptions.haloColorSize); //haloColor Size
                            if (lblOptions.hasOwnProperty("haloColor")) txtSymbl.setHaloColor(new Color(lblOptions.haloColor)); //haloColor Array
                        }

                        if (lblOptions.hasOwnProperty("textSize")) {
                            fnt.setSize(lblOptions.textSize + "pt");
                        }

                        if (lblOptions.hasOwnProperty("bold")) {
                            if (lblOptions.bold === 1) fnt.setWeight(Font.WEIGHT_BOLDER);
                        }

                        if (lblOptions.hasOwnProperty("italic")) {
                            if (lblOptions.italic === 1) fnt.setStyle(Font.STYLE_ITALIC);
                        }


                        if (lblOptions.hasOwnProperty("uLine")) {
                            if (lblOptions.uLine === 1) txtSymbl.setDecoration(TextSymbol.DECORATION_UNDERLINE);
                        }

                        if (lblOptions.hasOwnProperty("oLine")) {
                            if (lblOptions.oLine === 1) txtSymbl.setDecoration(TextSymbol.DECORATION_OVERLINE);
                        }

                        if (lblOptions.hasOwnProperty("tLine")) {
                            if (lblOptions.tLine === 1) txtSymbl.setDecoration(TextSymbol.DECORATION_LINETHROUGH);
                        }

                        var gfx = new Graphic(ptGeom, txtSymbl);
                        gfx.parentId = parentID;
                        gfx.isFreehnd = isFreehnd;
                        txtGLyr.add(gfx);

                    }
                }


            },

            deAnnotate: function (textGraphicLayer, parentId) {
                for (i = textGraphicLayer.graphics.length - 1; i >= 0; i--) {
                    if (textGraphicLayer.graphics[i].parentId == parentId) {
                        textGraphicLayer.remove(textGraphicLayer.graphics[i]);
                    }

                }
            },



        };
    });