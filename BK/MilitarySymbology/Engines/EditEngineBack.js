define(["dojo/_base/declare", "esri/toolbars/draw", "esri/toolbars/edit",
        "dojo/Evented", "MilSymbologyExt/ControlPointsEditor", "MilSymbologySymbolsEngine/AnnotationEngine"
    ],
    function(declare, Draw, Edit, Evented,
        ControlPointsEditor, AnnotationEngine) {

        var EditEngine = declare([Evented], {
            declaredClass: "MilitarySymbology.Engines.EditEngine",

            constructor: function(map, graphicLayer, textGraphicsLayer) {
                this.graphicLayer = graphicLayer;
                this.textGraphicsLayer = textGraphicsLayer;
                this.map = map;
                this.draw = new Draw();
                this.editToolbar = new Edit(this.map);
                this._controlPoints = [];
                this.controlPtsEditor = new ControlPointsEditor(this.map, this.graphicLayer, this.editToolbar, this._controlPoints);
                this.wireUpEvents();

            },


            init: function() {

            },

            activate: function(oldThis, evt) {
                oldThis.controlPtsEditor.deactivate(oldThis.graphicLayer);
            },

            deactivate: function(oldThis, evt) {
                oldThis.unWireUpEvents();
            },


            activateCp: function(oldThis, evt) {
                oldThis.editToolbar.deactivate();
                AnnotationEngine.deAnnotate(oldThis.textGraphicsLayer, evt.graphic.id);
            },

            deactivateCp: function(oldThis, evt) {
                if (evt.graphic != undefined) {
                    var options = {'opacity': evt.graphic.symbol.color.a};
                    AnnotationEngine.annotate(oldThis.textGraphicsLayer, evt.graphic.geometry, evt.graphic.drawEssentials.AMPLIFIER, evt.graphic.drawEssentials, evt.graphic.id, evt.graphic.attributes.FRHNDSZ, evt.graphic.attributes.ISFHAND, undefined, options);
                    //oldThis.emit("changeInSymbol", { 'graphic' : evt.graphic });

                    oldThis.emit("CPchanged", {
                        'drawEssentials': evt.graphic.drawEssentials,
                        'amplifier': evt.graphic.drawEssentials.AMPLIFIER,
                        'geometry': evt.graphic.geometry,
                        'attributes': evt.graphic.attributes,
                        'id': evt.graphic.id
                    });
                }
            },



            scale: function(oldThis, evt) {
                oldThis.controlPtsEditor._scaleRotateMove(evt);
            },

            scaleStart: function(oldThis, evt) {
                oldThis.controlPtsEditor._setGraphic(evt.graphic);
                AnnotationEngine.deAnnotate(oldThis.textGraphicsLayer, evt.graphic.id);
            },
            scaleStop: function(oldThis, evt) {
                if (evt.graphic.attributes.hasOwnProperty('tempCpoints')) {
                    evt.graphic.drawEssentials.CTRL_PTS = evt.graphic.attributes.tempCpoints;
                    delete evt.graphic.attributes.tempCpoints;
                }


                if (evt.graphic.attributes.hasOwnProperty('tempBpoints')) {
                    if(evt.graphic.attributes.tempBpoints.hasOwnProperty('startPt')) evt.graphic.drawEssentials.BASE_LN_PTS.startPt = evt.graphic.attributes.tempBpoints.startPt;
                    if(evt.graphic.attributes.tempBpoints.hasOwnProperty('endPt')) evt.graphic.drawEssentials.BASE_LN_PTS.endPt = evt.graphic.attributes.tempBpoints.endPt;
                    if(evt.graphic.attributes.tempBpoints.hasOwnProperty('midPt')) evt.graphic.drawEssentials.BASE_LN_PTS.midPt = evt.graphic.attributes.tempBpoints.midPt;
                    
                    delete evt.graphic.attributes.tempBpoints;
                }

                AnnotationEngine.annotate(oldThis.textGraphicsLayer, evt.graphic.geometry, evt.graphic.drawEssentials.AMPLIFIER, evt.graphic.drawEssentials, evt.graphic.id, evt.graphic.attributes.FRHNDSZ, evt.graphic.attributes.ISFHAND);
                oldThis.emit("changeInSymbol", {
                    'graphic': evt.graphic
                });

            },


            rotate: function(oldThis, evt) {
                oldThis.controlPtsEditor._scaleRotateMove(evt);
            },

            rotateStart: function(oldThis, evt) {
                oldThis.controlPtsEditor._setGraphic(evt.graphic);
                AnnotationEngine.deAnnotate(oldThis.textGraphicsLayer, evt.graphic.id);
            },

            rotateStop: function(oldThis, evt) {

                if (evt.graphic.attributes.hasOwnProperty('tempCpoints')) {
                    evt.graphic.drawEssentials.CTRL_PTS = evt.graphic.attributes.tempCpoints;
                    delete evt.graphic.attributes.tempCpoints;
                }

                if (evt.graphic.attributes.hasOwnProperty('tempBpoints')) {
                    if(evt.graphic.attributes.tempBpoints.hasOwnProperty('startPt')) evt.graphic.drawEssentials.BASE_LN_PTS.startPt = evt.graphic.attributes.tempBpoints.startPt;
                    if(evt.graphic.attributes.tempBpoints.hasOwnProperty('endPt')) evt.graphic.drawEssentials.BASE_LN_PTS.endPt = evt.graphic.attributes.tempBpoints.endPt;
                    if(evt.graphic.attributes.tempBpoints.hasOwnProperty('midPt')) evt.graphic.drawEssentials.BASE_LN_PTS.midPt = evt.graphic.attributes.tempBpoints.midPt;
                    
                    delete evt.graphic.attributes.tempBpoints;
                }

                AnnotationEngine.annotate(oldThis.textGraphicsLayer, evt.graphic.geometry, evt.graphic.drawEssentials.AMPLIFIER, evt.graphic.drawEssentials, evt.graphic.id, evt.graphic.attributes.FRHNDSZ, evt.graphic.attributes.ISFHAND);
                oldThis.emit("changeInSymbol", {
                    'graphic': evt.graphic
                });
            },



            graphicMove: function(oldThis, evt) {

                if (evt.graphic.geometry.type !== "point") oldThis.controlPtsEditor._scaleRotateMove(evt);
            },

            graphicMoveStart: function(oldThis, evt) {
                if (evt.graphic.geometry.type !== "point") {
                    oldThis.controlPtsEditor._setGraphic(evt.graphic);
                }

                AnnotationEngine.deAnnotate(oldThis.textGraphicsLayer, evt.graphic.id);

            },

            graphicMoveStop: function(oldThis, evt) {

                if (evt.graphic.attributes.hasOwnProperty('tempCpoints')) {
                    evt.graphic.drawEssentials.CTRL_PTS = evt.graphic.attributes.tempCpoints;
                    delete evt.graphic.attributes.tempCpoints;
                }

                if (evt.graphic.attributes.hasOwnProperty('tempBpoints')) {
                    if(evt.graphic.attributes.tempBpoints.hasOwnProperty('startPt')) evt.graphic.drawEssentials.BASE_LN_PTS.startPt = evt.graphic.attributes.tempBpoints.startPt;
                    if(evt.graphic.attributes.tempBpoints.hasOwnProperty('endPt')) evt.graphic.drawEssentials.BASE_LN_PTS.endPt = evt.graphic.attributes.tempBpoints.endPt;
                    if(evt.graphic.attributes.tempBpoints.hasOwnProperty('midPt')) evt.graphic.drawEssentials.BASE_LN_PTS.midPt = evt.graphic.attributes.tempBpoints.midPt;
                    


                    delete evt.graphic.attributes.tempBpoints;
                }

                AnnotationEngine.annotate(oldThis.textGraphicsLayer, evt.graphic.geometry, evt.graphic.drawEssentials.AMPLIFIER, evt.graphic.drawEssentials, evt.graphic.id, evt.graphic.attributes.FRHNDSZ, evt.graphic.attributes.ISFHAND, (evt.graphic.drawEssentials.hasOwnProperty('labelOptions')) ? evt.graphic.drawEssentials.labelOptions : {});
                oldThis.emit("changeInSymbol", {
                    'graphic': evt.graphic
                });

            },
            wireUpEvents: function() {

                console.log('Events Hooked Up');
                /*
                 this.cpMovedEvt = this.controlPtsEditor.on('cpMoved', dojo.partial(this.cpMoved, this));
                 this.cpActivateEvt = this.controlPtsEditor.on('cpActivate', dojo.partial(this.activateCp, this));
                 this.cpDeActivateEvt = this.controlPtsEditor.on('cpDeActivate', dojo.partial(this.deactivateCp, this));
                 */





                this.activateEvt = this.editToolbar.on('activate', dojo.partial(this.activate, this));
                this.deActivateEvt = this.editToolbar.on('deactivate', dojo.partial(this.deactivate, this));

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

            wireEditEvents : function() {

            },


            wireCPEvents : function() {

            },

            cpMoved: function(oldThis, evt) {
                evt.graphic.setGeometry(evt.drawEssentials.SCOPE.createSymbol(evt.drawEssentials));

            },

            activateEdit: function(graphic) {
                //this.wireUpEvents();
                if (graphic.geometry.type === "point") {
                    //if ( graphic.symbol.declaredClass === "esri.symbol.TextSymbol" ) {
                    //this.editToolbar.activate(Edit.EDIT_TEXT, graphic);
                    this.editToolbar.activate(Edit.MOVE, graphic);
                } else {

                    this.editToolbar.activate(Edit.ROTATE | Edit.SCALE | Edit.MOVE, graphic, {
                        'uniformScaling': 'true'
                    });

                }
                //this.editToolbar.activate(EDIT_VERTICES, graphic);

            },

            deactivateEdit: function() {
                //this.unWireUpEvents();
                this.editToolbar.deactivate();
            },
            unWireUpEvents: function() {

                this.cpMovedEvt.remove();
                this.cpActivateEvt.remove();
                this.cpDeActivateEvt.remove();
                this.activateEvt.remove();
                this.deActivateEvt.remove();

                this.scaleEvt.remove();
                this.scaleStartEvt.remove();
                this.scaleStopEvt.remove();


                this.rotateEvt.remove();
                this.rotateStartEvt.remove();
                this.rotateStopEvt.remove();

                this.graphicMovEvt.remove();
                this.graphicMoveStartEvt.remove();
                this.graphicMoveStopEvt.remove();





            },

            activateEditPts: function(evt) {

                this.cpMovedEvt = this.controlPtsEditor.on('cpMoved', dojo.partial(this.cpMoved, this));
                this.cpActivateEvt = this.controlPtsEditor.on('cpActivate', dojo.partial(this.activateCp, this));
                this.cpDeActivateEvt = this.controlPtsEditor.on('cpDeActivate', dojo.partial(this.deactivateCp, this));
                
                if (this.editToolbar.getCurrentState().tool == 0) {
                    this.wireUpEvents();
                    this.controlPtsEditor.activate(evt);
                } else {
                    this.deactivateEdit();
                    this.controlPtsEditor.activate(evt);

                }
            },

            deactivateEditPts: function(evt) {
                this.controlPtsEditor.deactivate(evt);

                this.cpMovedEvt.remove();
                this.cpActivateEvt.remove();
                this.cpDeActivateEvt.remove();

            },
            deactivateEngine: function(evt) {
                this.unWireUpEvents();

            }




        });
        return EditEngine;
    });