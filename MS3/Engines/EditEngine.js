define(["dojo/_base/declare", "esri/toolbars/draw", "esri/toolbars/edit", "dojo/_base/Color",
    "dojo/Evented", "MilSymbologyExt/ControlPointsEditor", "MilSymbologySymbolsEngine/AnnotationEngine",
    "MilSymbologySymbolsEngine/TextBoxEngine", "esri/symbols/SimpleFillSymbol", "esri/symbols/SimpleLineSymbol"
],
        function (declare, Draw, Edit, Color, Evented,
                ControlPointsEditor, AnnotationEngine, TextBoxEngine, SimpleFillSymbol, SimpleLineSymbol) {

            var EditEngine = declare([Evented], {
                declaredClass: "MilitarySymbology.Engines.EditEngine",
                constructor: function (map, graphicLayer, textGraphicsLayer) {
                    this.graphicLayer = graphicLayer;
                    this.textGraphicsLayer = textGraphicsLayer;
                    this.map = map;
                    this.draw = new Draw();
                    this.editToolbar = new Edit(this.map);
                    this._controlPoints = [];
                    this.controlPtsEditor = new ControlPointsEditor(this.map, this.graphicLayer, this.editToolbar, this._controlPoints);
                    //this.wireUpEvents();

                },
                init: function () {

                },
                activateCp: function (oldThis, evt) {
                    oldThis.editToolbar.deactivate();
                    AnnotationEngine.deAnnotate(oldThis.textGraphicsLayer, evt.graphic.id);
                },
                deactivateCp: function (oldThis, evt) {
                    if (evt.graphic != undefined) {
                        var options = {'opacity': evt.graphic.symbol.color.a};
                        AnnotationEngine.annotate(oldThis.textGraphicsLayer, evt.graphic.geometry, evt.graphic.drawEssentials.AMPLIFIER, evt.graphic.drawEssentials, evt.graphic.id, evt.graphic.attributes.FRHNDSZ, evt.graphic.attributes.ISFHAND, undefined, options);
                        //oldThis.emit("changeInSymbol", { 'graphic' : evt.graphic });

                        oldThis.emit("CPchanged", {
                            'drawEssentials': evt.graphic.drawEssentials,
                            'amplifier': evt.graphic.drawEssentials.AMPLIFIER,
                            'geometry': evt.graphic.geometry,
                            'attributes': evt.graphic.attributes,
                            'id': evt.graphic.id,
                            'graphic': evt.graphic
                        });
                    }
                },
                scale: function (oldThis, evt) {
                    oldThis.controlPtsEditor._scaleRotateMove(evt);

                    //oldThis.controlPtsEditor._scaleRotateMove(evt);
                    var resGraphic = oldThis.removeCtrlPtsFromAttribs(evt.graphic, true);
                    /*
                     oldThis.emit("editEvent", {
                     'graphic': resGraphic
                     });
                     */

                },
                scaleStart: function (oldThis, evt) {
                    oldThis.controlPtsEditor._setGraphic(evt.graphic);
                    AnnotationEngine.deAnnotate(oldThis.textGraphicsLayer, evt.graphic.id);
                },
                scaleStop: function (oldThis, evt) {
                    var resGraphic = oldThis.removeCtrlPtsFromAttribs(evt.graphic, true);
                    /*
                     if (evt.graphic.attributes.hasOwnProperty('tempCpoints')) {
                     evt.graphic.drawEssentials.CTRL_PTS = evt.graphic.attributes.tempCpoints;
                     delete evt.graphic.attributes.tempCpoints;
                     }
                     
                     
                     if (evt.graphic.attributes.hasOwnProperty('tempBpoints')) {
                     if (evt.graphic.attributes.tempBpoints.hasOwnProperty('startPt')) evt.graphic.drawEssentials.BASE_LN_PTS.startPt = evt.graphic.attributes.tempBpoints.startPt;
                     if (evt.graphic.attributes.tempBpoints.hasOwnProperty('endPt')) evt.graphic.drawEssentials.BASE_LN_PTS.endPt = evt.graphic.attributes.tempBpoints.endPt;
                     if (evt.graphic.attributes.tempBpoints.hasOwnProperty('midPt')) evt.graphic.drawEssentials.BASE_LN_PTS.midPt = evt.graphic.attributes.tempBpoints.midPt;
                     
                     delete evt.graphic.attributes.tempBpoints;
                     }
                     
                     AnnotationEngine.annotate(oldThis.textGraphicsLayer, evt.graphic.geometry, evt.graphic.drawEssentials.AMPLIFIER, evt.graphic.drawEssentials, evt.graphic.id, evt.graphic.attributes.FRHNDSZ, evt.graphic.attributes.ISFHAND, undefined, oldThis.getOpacityValue(evt.graphic));
                     oldThis.emit("changeInSymbol", {
                     'graphic': evt.graphic
                     });
                     */

                    AnnotationEngine.annotate(oldThis.textGraphicsLayer, resGraphic.geometry, resGraphic.drawEssentials.AMPLIFIER, resGraphic.drawEssentials, resGraphic.id, resGraphic.attributes.FRHNDSZ, resGraphic.attributes.ISFHAND, undefined, oldThis.getOpacityValue(resGraphic));
                    oldThis.emit("changeInSymbol", {
                        'graphic': resGraphic
                    });

                },
                rotate: function (oldThis, evt) {
                    oldThis.controlPtsEditor._scaleRotateMove(evt);
                    var resGraphic = oldThis.removeCtrlPtsFromAttribs(evt.graphic, true);
                    /*
                     oldThis.emit("editEvent", {
                     'graphic': resGraphic
                     });
                     */

                },
                rotateStart: function (oldThis, evt) {
                    oldThis.controlPtsEditor._setGraphic(evt.graphic);
                    AnnotationEngine.deAnnotate(oldThis.textGraphicsLayer, evt.graphic.id);
                },
                rotateStop: function (oldThis, evt) {

                    var resGraphic = oldThis.removeCtrlPtsFromAttribs(evt.graphic, true);
                    /*
                     if (evt.graphic.attributes.hasOwnProperty('tempCpoints')) {
                     evt.graphic.drawEssentials.CTRL_PTS = evt.graphic.attributes.tempCpoints;
                     delete evt.graphic.attributes.tempCpoints;
                     }
                     
                     if (evt.graphic.attributes.hasOwnProperty('tempBpoints')) {
                     if (evt.graphic.attributes.tempBpoints.hasOwnProperty('startPt')) evt.graphic.drawEssentials.BASE_LN_PTS.startPt = evt.graphic.attributes.tempBpoints.startPt;
                     if (evt.graphic.attributes.tempBpoints.hasOwnProperty('endPt')) evt.graphic.drawEssentials.BASE_LN_PTS.endPt = evt.graphic.attributes.tempBpoints.endPt;
                     if (evt.graphic.attributes.tempBpoints.hasOwnProperty('midPt')) evt.graphic.drawEssentials.BASE_LN_PTS.midPt = evt.graphic.attributes.tempBpoints.midPt;
                     
                     delete evt.graphic.attributes.tempBpoints;
                     }
                     
                     
                     AnnotationEngine.annotate(oldThis.textGraphicsLayer, evt.graphic.geometry, evt.graphic.drawEssentials.AMPLIFIER, evt.graphic.drawEssentials, evt.graphic.id, evt.graphic.attributes.FRHNDSZ, evt.graphic.attributes.ISFHAND, undefined, oldThis.getOpacityValue(evt.graphic));
                     oldThis.emit("changeInSymbol", {
                     'graphic': evt.graphic
                     });
                     
                     */


                    AnnotationEngine.annotate(oldThis.textGraphicsLayer, resGraphic.geometry, resGraphic.drawEssentials.AMPLIFIER, resGraphic.drawEssentials, resGraphic.id, resGraphic.attributes.FRHNDSZ, resGraphic.attributes.ISFHAND, undefined, oldThis.getOpacityValue(resGraphic));
                    oldThis.emit("changeInSymbol", {
                        'graphic': resGraphic
                    });


                },
                graphicMove: function (oldThis, evt) {
                    if (evt.graphic.drawEssentials.SYM_GEO_TYPE) {
                        if (evt.graphic.drawEssentials.SYM_GEO_TYPE !== "Point") {
                            oldThis.controlPtsEditor._scaleRotateMove(evt);
                            oldThis.removeCtrlPtsFromAttribs(evt.graphic, true);
                        }
                    } else {
                        if (evt.graphic.geometry.type !== "point") {

                            oldThis.controlPtsEditor._scaleRotateMove(evt);
                            oldThis.removeCtrlPtsFromAttribs(evt.graphic, true);
                        }
                    }
                },
                graphicMoveStart: function (oldThis, evt) {
                    if (evt.graphic.drawEssentials.SYM_GEO_TYPE) {
                        if (evt.graphic.drawEssentials.SYM_GEO_TYPE !== "Point") {
                            oldThis.controlPtsEditor._setGraphic(evt.graphic);
                        }
                    } else {
                        if (evt.graphic.geometry.type !== "point") {
                            oldThis.controlPtsEditor._setGraphic(evt.graphic);
                        }
                    }
                    AnnotationEngine.deAnnotate(oldThis.textGraphicsLayer, evt.graphic.id);
                },
                graphicMoveStop: function (oldThis, evt) {
                    var resGraphic = oldThis.removeCtrlPtsFromAttribs(evt.graphic, true);
                    var textGraphicGeom = resGraphic.geometry;

                    if (resGraphic.drawEssentials.SYM_NAME === "Freehand - TextBox") {
                        var fontSize = 15;
                        var textAlign = "center";
                        if (resGraphic.drawEssentials.labelOptions) {
                            if (resGraphic.drawEssentials.labelOptions.textSize) {
                                fontSize = Number(resGraphic.drawEssentials.labelOptions.textSize);
                            }

                            if (resGraphic.drawEssentials.labelOptions.textAlign) {
                                textAlign = resGraphic.drawEssentials.labelOptions.textAlign;
                            }
                        }else{
                            if(resGraphic.drawEssentials.AMPLIFIER.MULTI_LINE_LABEL_ALIGN){
                                textAlign = resGraphic.drawEssentials.AMPLIFIER.MULTI_LINE_LABEL_ALIGN;
                            }
                        }

                        var centerPtGeom = resGraphic.drawEssentials.GEOM;
                        var labelText = resGraphic.drawEssentials.AMPLIFIER.MULTI_LINE_LABEL_TEXT;
                        if (labelText && labelText !== "") {
                            var tboxEngine = new TextBoxEngine(oldThis.map, centerPtGeom, fontSize, labelText, textAlign);
                            textGraphicGeom = tboxEngine.getTextPtGeom(textGraphicGeom);
                        } else {
                            textGraphicGeom = resGraphic.geometry;
                        }

                        resGraphic.drawEssentials.GEOM = textGraphicGeom;
                    }
//                    AnnotationEngine.annotate(oldThis.textGraphicsLayer, textGraphicGeom, resGraphic.drawEssentials.AMPLIFIER, resGraphic.drawEssentials, resGraphic.id, resGraphic.attributes.FRHNDSZ, resGraphic.attributes.ISFHAND, (resGraphic.drawEssentials.hasOwnProperty('labelOptions')) ? resGraphic.drawEssentials.labelOptions : {}, oldThis.getOpacityValue(resGraphic));
//                    oldThis.emit("changeInSymbol", {
//                        'graphic': evt.graphic
//                    });


                    AnnotationEngine.annotate(oldThis.textGraphicsLayer, resGraphic.geometry, resGraphic.drawEssentials.AMPLIFIER, resGraphic.drawEssentials, resGraphic.id, resGraphic.attributes.FRHNDSZ, resGraphic.attributes.ISFHAND, (resGraphic.drawEssentials.hasOwnProperty('labelOptions')) ? resGraphic.drawEssentials.labelOptions : {}, oldThis.getOpacityValue(resGraphic));
                    oldThis.emit("changeInSymbol", {
                        'graphic': resGraphic
                    });

                },
                getOpacityValue: function (graphic) {
                    var options = {};
                    if (graphic.geometry.type === 'polyline' || graphic.geometry.type === 'polygon') {
                        options.opacity = graphic.symbol.color.a;
                        /*
                         if(graphic.symbol.hasOwnProperty('outline')) {
                         options.opacity = graphic.symbol.outline.color.a;
                         }
                         */

                    } else if (graphic.drawEssentials.SYM_GEO_TYPE === 'Point') {
                        if (graphic.drawEssentials.SID === "000111") {
                            options.opacity = graphic.symbol.color.a;
                        } else {

                            options.opacity = graphic.symbol.outline.color.a;
                        }
                    }

                    return options;
                },
                cpMoved: function (oldThis, evt) {
                    evt.graphic.setGeometry(evt.drawEssentials.SCOPE.createSymbol(evt.drawEssentials));

                    oldThis.emit("controlPointMoved", {
                        'graphic': evt.graphic
                    });

                },
                removeCtrlPtsFromAttribs: function (graphic, emit) {
                    if (emit === undefined)
                        emit = false;
                    if (graphic.attributes.hasOwnProperty('tempCpoints')) {
                        graphic.drawEssentials.CTRL_PTS = graphic.attributes.tempCpoints;
                        delete graphic.attributes.tempCpoints;
                    }

                    if (graphic.attributes.hasOwnProperty('tempBpoints')) {
                        if (graphic.attributes.tempBpoints.hasOwnProperty('startPt'))
                            graphic.drawEssentials.BASE_LN_PTS.startPt = graphic.attributes.tempBpoints.startPt;
                        if (graphic.attributes.tempBpoints.hasOwnProperty('endPt'))
                            graphic.drawEssentials.BASE_LN_PTS.endPt = graphic.attributes.tempBpoints.endPt;
                        if (graphic.attributes.tempBpoints.hasOwnProperty('midPt'))
                            graphic.drawEssentials.BASE_LN_PTS.midPt = graphic.attributes.tempBpoints.midPt;

                        delete graphic.attributes.tempBpoints;
                    }

                    if (emit === true) {
                        this.emit("editEvent", {
                            'graphic': graphic
                        });
                    }



                    return graphic;



                },
                activateEdit: function (graphic) {
                    //this.wireUpEvents();
                    this.wireUpEditEvents();
                    if (graphic.drawEssentials.SYM_GEO_TYPE) {
                        if (graphic.drawEssentials.SYM_GEO_TYPE === "Point") {
                            this.editToolbar.activate(Edit.MOVE, graphic);
                        } else {
                            if (graphic.geometry.type === "point") {
                                //if ( graphic.symbol.declaredClass === "esri.symbol.TextSymbol" ) {
                                //this.editToolbar.activate(Edit.EDIT_TEXT, graphic);
                                this.editToolbar.activate(Edit.MOVE, graphic);
                            } else {

                                this.editToolbar.activate(Edit.ROTATE | Edit.SCALE | Edit.MOVE, graphic, {
                                    'uniformScaling': 'true'
                                });

                            }
                        }
                    } else {
                        if (graphic.geometry.type === "point") {
                            //if ( graphic.symbol.declaredClass === "esri.symbol.TextSymbol" ) {
                            //this.editToolbar.activate(Edit.EDIT_TEXT, graphic);
                            this.editToolbar.activate(Edit.MOVE, graphic);
                        } else {

                            this.editToolbar.activate(Edit.ROTATE | Edit.SCALE | Edit.MOVE, graphic, {
                                'uniformScaling': 'true'
                            });

                        }
                    }


                    //this.editToolbar.activate(EDIT_VERTICES, graphic);

                },
                deactivateEdit: function () {
                    //this.unWireUpEvents();
                    this.unWireUpEditEvents();
                    this.editToolbar.deactivate();
                },
                unWireUpEvents: function () {
                    if (this.cpMovedEvt !== undefined) {
                        this.cpMovedEvt.remove();
                        this.cpActivateEvt.remove();
                        this.cpDeActivateEvt.remove();

                    }

                },
                wireUpEditEvents: function () {



                    this.scaleEvt = this.editToolbar.on('scale', dojo.partial(this.scale, this));
                    this.scaleStartEvt = this.editToolbar.on('scale-start', dojo.partial(this.rotateStart, this));
                    this.scaleStopEvt = this.editToolbar.on('scale-stop', dojo.partial(this.scaleStop, this));

                    this.rotateEvt = this.editToolbar.on('rotate', dojo.partial(this.rotate, this));
                    this.rotateStartEvt = this.editToolbar.on('rotate-start', dojo.partial(this.rotateStart, this));
                    this.rotateStopEvt = this.editToolbar.on('rotate-stop', dojo.partial(this.rotateStop, this));

                    this.graphicMovEvt = this.editToolbar.on('graphic-move', dojo.partial(this.graphicMove, this));
                    this.graphicMoveStartEvt = this.editToolbar.on('graphic-move-start', dojo.partial(this.graphicMoveStart, this));
                    this.graphicMoveStopEvt = this.editToolbar.on('graphic-move-stop', dojo.partial(this.graphicMoveStop, this));


                },
                unWireUpEditEvents: function () {

                    if (this.scaleEvt !== undefined) {

                        this.scaleEvt.remove();
                        this.scaleStartEvt.remove();
                        this.scaleStopEvt.remove();


                        this.rotateEvt.remove();
                        this.rotateStartEvt.remove();
                        this.rotateStopEvt.remove();

                        this.graphicMovEvt.remove();
                        this.graphicMoveStartEvt.remove();
                        this.graphicMoveStopEvt.remove();

                    }




                },
                wireUpCPEvents: function () {
                    this.activateEvt = this.editToolbar.on('activate', dojo.partial(this.activate, this));
                    this.deActivateEvt = this.editToolbar.on('deactivate', dojo.partial(this.deactivate, this));
                },
                unWireUpCPEvents: function () {
                    if (this.activateEvt !== null) {
                        this.activateEvt.remove();
                        this.deActivateEvt.remove();
                    }
                },
                activateEditPts: function (evt) {

                    this.cpMovedEvt = this.controlPtsEditor.on('cpMoved', dojo.partial(this.cpMoved, this));
                    this.cpActivateEvt = this.controlPtsEditor.on('cpActivate', dojo.partial(this.activateCp, this));
                    this.cpDeActivateEvt = this.controlPtsEditor.on('cpDeActivate', dojo.partial(this.deactivateCp, this));

                    if (this.editToolbar.getCurrentState().tool == 0) {
                        this.wireUpCPEvents();
                        this.controlPtsEditor.activate(evt);
                    } else {
                        this.deactivateEdit();
                        this.controlPtsEditor.activate(evt);

                    }
                },
                deactivateEditPts: function (evt) {
                    this.controlPtsEditor.deactivate(evt);
                    this.cpMovedEvt.remove();
                    this.cpActivateEvt.remove();
                    this.cpDeActivateEvt.remove();

                },
                deactivateEngine: function (evt) {
                    this.unWireUpCPEvents();
                    this.unWireUpEditEvents();
                }




            });
            return EditEngine;
        });